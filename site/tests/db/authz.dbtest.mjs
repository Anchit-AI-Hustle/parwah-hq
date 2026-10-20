// A userId IN A REQUEST IS A CLAIM, NOT A PROOF - against a real database.
//
// Four actions took the userId from the request body and acted as that
// person without checking who was signed in: renaming a profile (and
// changing its phone number), marking the tour seen, creating a family and
// joining one. Anyone who learned an id could rename someone, move their
// account to another number, or attach a family to it.
//
// What it proves, with the real api/auth.mjs and api/circle.mjs handlers:
//   - each of the four is refused with no session, and with another
//     person's session, and changes nothing;
//   - each still works for the person themselves;
//   - the refusal says "sign in", so the web app lands on the sign-in screen.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_test npm run test:db
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('authz.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('authz.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
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
  const req = { method: 'POST', body, headers: { 'x-forwarded-for': '10.1.0.' + (++ipn % 250) } };
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

const asha = await signUp('9820000001', 'Asha', '4829');
const ravi = await signUp('9820000002', 'Ravi', '7351');
const user = async id => (await admin.query('select name, phone, toured_at from users where id = $1', [id])).rows[0];

// ---- renaming a profile and changing its number
{
  let r = await call(auth, { action: 'update', userId: asha.id, name: 'Not Asha', phone: '9820000099', cc: '+91' });
  ok('update with no session is refused', r.status === 401 && r.signin === true, JSON.stringify(r));
  r = await call(auth, { action: 'update', userId: asha.id, name: 'Not Asha', phone: '9820000099', cc: '+91' }, ravi.token);
  ok("update with someone else's session is refused", r.status === 401, JSON.stringify(r));
  const a = await user(asha.id);
  ok('and neither changed her name or her number', a.name === 'Asha' && a.phone === '+919820000001', JSON.stringify(a));
  r = await call(auth, { action: 'update', userId: asha.id, name: 'Asha Rao' }, asha.token);
  ok('she can still rename herself', r.status === 200 && r.ok && (await user(asha.id)).name === 'Asha Rao', JSON.stringify(r));
}

// ---- the tour flag
{
  let r = await call(auth, { action: 'toured', userId: asha.id }, ravi.token);
  ok("marking someone else's tour seen is refused", r.status === 401 && !(await user(asha.id)).toured_at, JSON.stringify(r));
  r = await call(auth, { action: 'toured', userId: asha.id }, asha.token);
  ok('marking your own is not', r.status === 200 && !!(await user(asha.id)).toured_at, JSON.stringify(r));
}

// ---- creating a family as someone else
let code;
{
  const body = { action: 'create', kind: 'family', familyType: 'nuclear', memberName: 'Asha', circleName: 'Rao', userId: asha.id, role: 'family', relation: 'daughter' };
  let r = await call(circle, body);
  ok('creating a family with no session is refused', r.status === 401, JSON.stringify(r));
  r = await call(circle, body, ravi.token);
  ok("creating a family in someone else's name is refused", r.status === 401, JSON.stringify(r));
  const n = (await admin.query('select count(*)::int n from members where user_id = $1', [asha.id])).rows[0].n;
  ok('and no family was attached to her account', n === 0, String(n));
  r = await call(circle, body, asha.token);
  ok('she can create her own', r.status === 201 && r.ok && !!r.code, JSON.stringify(r));
  code = r.code;
}

// ---- joining a family as someone else
{
  const body = { action: 'join', code, memberName: 'Ravi', userId: ravi.id, role: 'family', relation: 'son' };
  let r = await call(circle, body, asha.token);
  ok("joining in someone else's name is refused", r.status === 401, JSON.stringify(r));
  const n = (await admin.query('select count(*)::int n from members where user_id = $1', [ravi.id])).rows[0].n;
  ok('and he was not put in the family', n === 0, String(n));
  r = await call(circle, body, ravi.token);
  ok('he can join it himself', (r.status === 200 || r.status === 202) && r.ok, JSON.stringify(r));
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`authz.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
