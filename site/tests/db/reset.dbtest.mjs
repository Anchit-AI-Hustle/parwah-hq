// A FORGOTTEN PIN, AGAINST A REAL DATABASE: the whole way back in.
//
// The sign-in reply listed waiting requests, but the background refresh
// (what a family member's open app actually runs every minute) did not, so
// a request reached nobody. And every tap on "ask my family" made another
// row, so three taps were three requests.
//
// What it proves, with the real api/auth.mjs and api/circle.mjs:
//   - asking shows up on a family member's next background refresh;
//   - a yes lets the person choose a new PIN from the device that asked;
//   - asking again and again is still one request;
//   - someone outside the family cannot approve it, and neither can the
//     person asking.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_test npm run test:db
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('reset.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('reset.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: auth } = await import('../../../api/auth.mjs');
const { default: circle } = await import('../../../api/circle.mjs');

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };

let ipn = 0;
async function call(handler, body, token) {
  const req = { method: 'POST', body, headers: { 'x-forwarded-for': '10.8.' + (++ipn % 250) + '.1' } };
  if (token) req.headers['x-parwah-token'] = token;
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { status, ...json };
}
async function signUp(phone, name, pin) {
  const r = await call(auth, { action: 'enter', phone, cc: '+91', name, pin });
  if (!r.token) throw new Error('sign-up failed for ' + name + ': ' + JSON.stringify(r));
  return { id: r.user.id, token: r.token };
}
const rows = async (text, args) => { try { return (await admin.query(text, args)).rows; } catch (e) { return []; } };

const papa = await signUp('9840000001', 'Papa', '4829');
const rohan = await signUp('9840000002', 'Rohan', '7351');
const outsider = await signUp('9840000009', 'Stranger', '6142');
let r = await call(circle, { action: 'create', kind: 'family', memberName: 'Papa', circleName: 'Verma', userId: papa.id, role: 'parent' }, papa.token);
const code = r.code;
await call(circle, { action: 'set_join_policy', code, memberId: r.memberId, policy: 'open' }, papa.token);
r = await call(circle, { action: 'join', code, memberName: 'Rohan', userId: rohan.id, role: 'family' }, rohan.token);
ok('setup: Rohan is in Papa\'s family', !!r.memberId, JSON.stringify(r));

// ---- Papa forgets his PIN and asks the family
let secret;
{
  r = await call(auth, { action: 'reset_request', phone: '9840000001', cc: '+91' });
  secret = r.resetSecret;
  ok('Papa\'s request is taken', r.ok && r.asked, JSON.stringify(r));

  // What Rohan's open app runs every minute, with no PIN, on his session.
  const refresh = await call(auth, { action: 'enter', phone: '9840000002', cc: '+91', refresh: true }, rohan.token);
  const seen = (refresh.pinResets || []).find(x => x.name === 'Papa');
  ok("Rohan's background refresh shows Papa's request", refresh.ok && !!seen, JSON.stringify(refresh.pinResets));
  ok('in the same shape as at sign-in: an id and a name', seen && /^[0-9a-f-]{36}$/.test(seen.id) && Object.keys(seen).sort().join() === 'id,name',
     JSON.stringify(seen));
  const own = await call(auth, { action: 'enter', phone: '9840000001', cc: '+91', refresh: true }, papa.token);
  ok('Papa does not see his own request to approve', own.ok && !(own.pinResets || []).length, JSON.stringify(own.pinResets));
  const out = await call(auth, { action: 'enter', phone: '9840000009', cc: '+91', refresh: true }, outsider.token);
  ok('nor does someone outside the family', out.ok && !(out.pinResets || []).length, JSON.stringify(out.pinResets));
}

// ---- tapping "ask" again is still one request
{
  await call(auth, { action: 'reset_request', phone: '9840000001', cc: '+91' });
  r = await call(auth, { action: 'reset_request', phone: '9840000001', cc: '+91' });
  secret = r.resetSecret || secret;
  const pend = await rows(`select id from pin_resets where user_id = $1 and status = 'pending'`, [papa.id]);
  ok('three taps are one waiting request', pend.length === 1, String(pend.length));
  const refresh = await call(auth, { action: 'enter', phone: '9840000002', cc: '+91', refresh: true }, rohan.token);
  ok('and Rohan sees it once', (refresh.pinResets || []).filter(x => x.name === 'Papa').length === 1, JSON.stringify(refresh.pinResets));
}

// ---- who may say yes
const pend = (await rows(`select id from pin_resets where user_id = $1 and status = 'pending'`, [papa.id]))[0];
{
  r = await call(auth, { action: 'reset_approve', resetId: pend && pend.id, token: outsider.token }, outsider.token);
  ok('someone outside the family cannot approve it', r.status === 403, JSON.stringify(r));
  r = await call(auth, { action: 'reset_approve', resetId: pend && pend.id, token: papa.token }, papa.token);
  ok('Papa cannot approve his own', r.status === 403, JSON.stringify(r));
  const still = await rows(`select status from pin_resets where id = $1`, [pend && pend.id]);
  ok('and the request is still waiting', still[0] && still[0].status === 'pending', JSON.stringify(still));
}

// ---- Rohan says yes, and Papa chooses a new PIN
{
  r = await call(auth, { action: 'reset_approve', resetId: pend && pend.id, token: rohan.token }, rohan.token);
  // The reply's own status field ('approved') is spread over the HTTP one here.
  ok('Rohan approves it', r.ok && r.status === 'approved', JSON.stringify(r));
  const s = await call(auth, { action: 'reset_status', phone: '9840000001', cc: '+91', resetSecret: secret });
  ok("Papa's waiting screen is told", s.reset === 'approved', JSON.stringify(s));
  r = await call(auth, { action: 'enter', phone: '9840000001', cc: '+91', resetSecret: secret });
  ok('it asks him for the new PIN', r.ok && r.setPin === true && !r.token, JSON.stringify(r));
  r = await call(auth, { action: 'enter', phone: '9840000001', cc: '+91', resetSecret: secret, newPin: '5927' });
  ok('he chooses one and is in', r.ok && !!r.token, JSON.stringify(r));
  r = await call(auth, { action: 'enter', phone: '9840000001', cc: '+91', pin: '5927' });
  ok('and the new PIN is the one that works', r.ok && !!r.token, JSON.stringify(r));
  r = await call(auth, { action: 'enter', phone: '9840000001', cc: '+91', pin: '4829' });
  ok('not the old one', !r.token, JSON.stringify(r));
  const refresh = await call(auth, { action: 'enter', phone: '9840000002', cc: '+91', refresh: true }, rohan.token);
  ok('and the request has left Rohan\'s list', refresh.ok && !(refresh.pinResets || []).length, JSON.stringify(refresh.pinResets));
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`reset.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
