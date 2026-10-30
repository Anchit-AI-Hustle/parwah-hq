// SECURITY, AGAINST A REAL DATABASE: the holes a review found with real
// requests, each one tried again here so it cannot quietly come back.
//
//   - a relative added by name (Dadi, not on the app) has no user_id, and
//     that row was accepted as the caller for ANY token: an outsider in no
//     family read the whole family with Dadi's id;
//   - joining with a number that matched Dadi's row linked the caller to
//     it at once, unasked, and matched only the last 10 digits, so
//     +1 9876543210 became a +91 relative;
//   - a yes to a PIN reset let WHOEVER typed the number next choose the
//     PIN, and requests never ran out;
//   - any https address was taken as a push endpoint, and anyone's device
//     could be moved to, or deleted by, someone else;
//   - a lab reading could be saved onto, and a hospital packet read for,
//     a member of another family;
//   - SOS had no limit on how often it texted and rang the family;
//   - the address used for limits was the one the caller wrote.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_test npm run test:db
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('security.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('security.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
// No Twilio here: the SOS limit is about alerts, and nothing is sent.
for (const k of Object.keys(process.env)) if (/^TWILIO/.test(k)) delete process.env[k];

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: auth } = await import('../../../api/auth.mjs');
const { default: circle } = await import('../../../api/circle.mjs');
const { default: events } = await import('../../../api/events.mjs');
const { default: push } = await import('../../../api/_pushapi.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { clientIp } = await import('../../../api/_db.mjs');

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };

let ipn = 0;
async function call(handler, body, token, { method = 'POST', query } = {}) {
  const req = { method, body, query, headers: { 'x-forwarded-for': '10.7.' + (++ipn % 250) + '.1' } };
  if (token) req.headers['x-parwah-token'] = token;
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { status, ...json };
}
async function signUp(phone, name, pin, cc = '+91') {
  const r = await call(auth, { action: 'enter', phone, cc, name, pin });
  if (!r.token) throw new Error('sign-up failed for ' + name + ': ' + JSON.stringify(r));
  return { id: r.user.id, token: r.token };
}
// A column the old code never made reads as nothing, so the check fails
// rather than the whole run.
const q1 = async (text, args) => { try { return (await admin.query(text, args)).rows[0]; } catch (e) { return undefined; } };

// The Sharmas: Asha made the family, Ravi joined, Dadi is added by name.
const asha = await signUp('9830000001', 'Asha', '4829');
const ravi = await signUp('9830000002', 'Ravi', '7351');
const outsider = await signUp('9830000009', 'Stranger', '6142');
let r = await call(circle, { action: 'create', kind: 'family', memberName: 'Asha', circleName: 'Sharma', userId: asha.id, role: 'family' }, asha.token);
let code = r.code; const ashaM = r.memberId;
await call(circle, { action: 'set_join_policy', code, memberId: ashaM, policy: 'open' }, asha.token);
r = await call(circle, { action: 'join', code, memberName: 'Ravi', userId: ravi.id, role: 'family' }, ravi.token);
const raviM = r.memberId;
r = await call(circle, { action: 'add_person', code, memberId: ashaM, personName: 'Dadi', gender: 'f', place: 'parent', ofId: ashaM }, asha.token);
const dadi = await q1(`select id from members where name = 'Dadi'`);
ok('setup: Dadi is in the family, not on the app', dadi && raviM && ashaM, JSON.stringify(r));

// ---- CRITICAL 1: a not-on-app relative is never the caller
{
  r = await call(events, null, outsider.token, { method: 'GET', query: { circle: code, member: dadi.id } });
  ok("an outsider cannot read the family with Dadi's id", r.status === 403 && !r.members && !r.events, r.status + ' ' + Object.keys(r).join(','));
  r = await call(events, null, ravi.token, { method: 'GET', query: { circle: code, member: dadi.id } });
  ok("nor can a family member act as Dadi", r.status === 403, String(r.status));
  r = await call(circle, { action: 'update_member', code, memberId: dadi.id, phone: '9830000009', phoneCc: '+91' }, outsider.token);
  ok("an outsider cannot change Dadi's number", r.status === 403, JSON.stringify(r));
  r = await call(circle, { action: 'set_code', code, memberId: dadi.id, newCode: 'TAKEN1' }, outsider.token);
  ok("nor change the family's code as Dadi", r.status === 403, JSON.stringify(r));
  r = await call(events, null, ravi.token, { method: 'GET', query: { circle: code, member: raviM } });
  ok('Ravi still reads his own family', r.status === 200, String(r.status));
  r = await call(circle, { action: 'unplace', code, memberId: raviM, targetId: dadi.id }, ravi.token);
  ok("and can still edit Dadi in the tree from his own membership", r.status === 200, JSON.stringify(r));
}

// On the old code the outsider really did change the code: read it back,
// so each section below is judged on its own.
code = (await q1('select c.code from circles c join members m on m.circle_id = c.id where m.id = $1', [ashaM])).code;

// ---- CRITICAL 2 and HIGH 3: a matching number is a request, never a link
{
  // As if her number had been saved for her by the family.
  await admin.query(`update members set phone = '+919830000077', phone_cc = '+91', phone_local = '9830000077' where id = $1`, [dadi.id]);
  // Anyone can sign up with any number: there is no SMS check.
  const fake = await signUp('9830000077', 'Not Dadi', '5937');
  r = await call(circle, { action: 'join', code, memberName: 'Not Dadi', userId: fake.id, role: 'family' }, fake.token);
  let d = await q1('select user_id from members where id = $1', [dadi.id]);
  ok("a number matching Dadi's does not make you Dadi", d && d.user_id === null, JSON.stringify(r));
  ok('it waits for the family instead, even with an open join policy', r.status === 202 && r.pending === true && !!r.requestId, JSON.stringify(r));
  const rq = await q1('select claim_member, status from join_requests where id = $1', [r.requestId || '00000000-0000-0000-0000-000000000000']);
  ok('the request says which row it asks to be', rq && rq.claim_member === dadi.id && rq.status === 'pending', JSON.stringify(rq));

  // Someone abroad with the same last 10 digits.
  const abroad = await signUp('9830000077', 'Abroad', '5937', '+1');
  r = await call(circle, { action: 'join', code, memberName: 'Abroad', userId: abroad.id, role: 'family' }, abroad.token);
  d = await q1('select user_id from members where id = $1', [dadi.id]);
  ok('+1 9830000077 is not matched to a +91 9830000077 relative', d && d.user_id === null && r.memberId !== dadi.id, JSON.stringify(r));

  // The family knows it really is her and says yes: now it links.
  const req2 = await q1(`select id from join_requests where user_id = $1 and status = 'pending'`, [fake.id]);
  r = req2 ? await call(circle, { action: 'approve_join', code, memberId: ashaM, requestId: req2.id }, asha.token) : { status: 0 };
  d = await q1('select user_id from members where id = $1', [dadi.id]);
  ok("a yes from the family links her to Dadi's own row", r.status === 200 && r.memberId === dadi.id && d && d.user_id === fake.id, JSON.stringify(r));
}

// ---- HIGH 4: a PIN reset lets in the device that asked, once, for a while
{
  r = await call(auth, { action: 'reset_request', phone: '9830000002', cc: '+91' });
  const secret = r.resetSecret;
  ok('asking returns a one-time secret to this device', r.ok && typeof secret === 'string' && secret.length >= 40, JSON.stringify(r));
  const stored = await q1(`select secret_hash, expires_at from pin_resets where user_id = $1 and status = 'pending'`, [ravi.id]);
  ok('only its hash is stored, and it runs out', stored && stored.secret_hash && stored.secret_hash !== secret && stored.expires_at, JSON.stringify(stored));
  r = await call(auth, { action: 'reset_request', phone: '9830009999', cc: '+91' });
  ok('an unknown number gets the same kind of reply', r.ok && r.asked && typeof r.resetSecret === 'string', JSON.stringify(r));

  const pend = await q1(`select id from pin_resets where user_id = $1 and status = 'pending'`, [ravi.id]);
  r = await call(auth, { action: 'reset_approve', resetId: pend && pend.id, token: asha.token }, asha.token);
  ok('Asha says yes', r.ok && r.status === 'approved', JSON.stringify(r));

  // Someone else who knows the number tries to use the yes.
  r = await call(auth, { action: 'enter', phone: '9830000002', cc: '+91', pin: '2468' });
  ok('the yes does not let a stranger choose the PIN', !r.token && !r.setPin, JSON.stringify(r));
  r = await call(auth, { action: 'enter', phone: '9830000002', cc: '+91', newPin: '2579' });
  ok('nor with a new PIN and no secret', !r.token, JSON.stringify(r));
  r = await call(auth, { action: 'enter', phone: '9830000002', cc: '+91', resetSecret: 'x'.repeat(43), newPin: '2579' });
  ok('nor with a made-up secret', !r.token && r.reset === 'expired', JSON.stringify(r));
  const still = await q1('select pin_hash from users where id = $1', [ravi.id]);
  ok("and Ravi's PIN is still set", !!(still && still.pin_hash));

  r = await call(auth, { action: 'enter', phone: '9830000002', cc: '+91', resetSecret: secret, newPin: '2579' });
  ok('the device that asked chooses a new PIN and is in', r.ok && !!r.token, JSON.stringify(r));
  const old = await call(events, null, ravi.token, { method: 'GET', query: { circle: code, member: raviM } });
  ok('the old sessions stop working', old.status === 401, String(old.status));
  r = await call(auth, { action: 'enter', phone: '9830000002', cc: '+91', resetSecret: secret, newPin: '3581' });
  ok('the secret works once', !r.token, JSON.stringify(r));
  r = await call(auth, { action: 'enter', phone: '9830000002', cc: '+91', pin: '2579' });
  ok('and the new PIN signs in', r.ok && !!r.token, JSON.stringify(r));
  ravi.token = r.token;

  // A request nobody answered in time.
  r = await call(auth, { action: 'reset_request', phone: '9830000001', cc: '+91' });
  await q1(`update pin_resets set expires_at = now() - interval '1 minute' where user_id = $1 and status = 'pending'`, [asha.id]);
  const late = await q1(`select id from pin_resets where user_id = $1 and status = 'pending'`, [asha.id]);
  const ap = await call(auth, { action: 'reset_approve', resetId: late && late.id, token: ravi.token }, ravi.token);
  ok('a request that has run out cannot be approved', ap.status === 404, JSON.stringify(ap));
  const s2 = await call(auth, { action: 'reset_status', phone: '9830000001', cc: '+91', resetSecret: r.resetSecret });
  ok('and the waiting screen is told it ran out', s2.status === 200 && s2.reset === 'expired', JSON.stringify(s2));
}

// ---- MEDIUM 5: push goes only to push services, and only to your device
{
  const ashaT = (await call(auth, { action: 'enter', phone: '9830000001', cc: '+91', pin: '4829' })).token;
  const keys = { p256dh: 'BOr' + 'a'.repeat(80), auth: 'b'.repeat(22) };
  r = await call(push, { code, memberId: ashaM, action: 'subscribe', sub: { endpoint: 'https://169.254.169.254/latest/meta-data', keys } }, ashaT);
  ok('an address that is not a push service is refused', r.status === 400, JSON.stringify(r));
  r = await call(push, { code, memberId: ashaM, action: 'subscribe', sub: { endpoint: 'https://evil.example/fcm.googleapis.com/x', keys } }, ashaT);
  ok('even one that names a push service in its path', r.status === 400, JSON.stringify(r));
  const ep = 'https://fcm.googleapis.com/fcm/send/asha-device-123';
  r = await call(push, { code, memberId: ashaM, action: 'subscribe', sub: { endpoint: ep, keys } }, ashaT);
  ok('a real push service is taken', r.status === 200 && r.ok, JSON.stringify(r));
  r = await call(push, { code, memberId: raviM, action: 'subscribe', sub: { endpoint: ep, keys } }, ravi.token);
  let row = await q1('select member_id from push_subs where endpoint = $1', [ep]);
  ok("Ravi cannot move Asha's device to himself", row && row.member_id === ashaM && r.status === 409, JSON.stringify(r));
  r = await call(push, { code, memberId: raviM, action: 'unsubscribe', sub: { endpoint: ep } }, ravi.token);
  row = await q1('select member_id from push_subs where endpoint = $1', [ep]);
  ok("nor delete it", !!row, JSON.stringify(r));
  r = await call(push, { code, memberId: ashaM, action: 'unsubscribe', sub: { endpoint: ep } }, ashaT);
  row = await q1('select member_id from push_subs where endpoint = $1', [ep]);
  ok('Asha can turn her own off', !row && r.ok, JSON.stringify(r));
}

// ---- another family's member, through the care tools
{
  const ashaT = (await call(auth, { action: 'enter', phone: '9830000001', cc: '+91', pin: '4829' })).token;
  const g = await call(circle, { action: 'create', kind: 'family', memberName: 'Stranger', circleName: 'Other', userId: outsider.id, role: 'family' }, outsider.token);
  // Health & contacts and the vault opened once, as the app does first.
  await call(book, null, ashaT, { method: 'GET', query: { circle: code, member: ashaM } });
  await call(book, null, ashaT, { method: 'GET', query: { area: 'vault', circle: code, member: ashaM } });
  r = await call(book, { code, memberId: ashaM, action: 'biomarker_save', personId: g.memberId, items: [{ biomarker_type: 'HBA1C', value: 6 }] }, ashaT);
  const wrote = await q1('select count(*)::int as n from biomarker_records where person_id = $1', [g.memberId]);
  ok("a lab reading cannot be saved onto another family's member", r.status === 403 && (!wrote || wrote.n === 0), JSON.stringify(r));
  r = await call(book, { code, memberId: ashaM, action: 'biomarker_save', personId: raviM, items: [{ biomarker_type: 'HBA1C', value: 6 }] }, ashaT);
  ok('one for her own family still saves', r.status === 200 && r.saved_count === 1, JSON.stringify(r));
  r = await call(book, null, ashaT, { method: 'GET', query: { area: 'preauth', circle: code, member: ashaM, person: g.memberId } });
  ok("nor a hospital packet read for another family's member", r.status === 403 && !r.packet, JSON.stringify(r).slice(0, 160));
}

// ---- MEDIUM 6: SOS alerts are limited, the SOS itself is not
{
  const outs = [];
  for (let i = 0; i < 4; i++) {
    outs.push(await call(events, { code, memberId: raviM, type: 'sos', lat: 28.6, lng: 77.2, accuracy: 20 }, ravi.token));
  }
  ok('the first three presses alert the family', outs.slice(0, 3).every(o => o.status === 201 && !o.throttled), JSON.stringify(outs.slice(0, 3).map(o => o.status + ':' + !!o.throttled)));
  ok('the fourth in ten minutes does not alert again', outs[3].status === 201 && outs[3].throttled === true, JSON.stringify(outs[3]));
  ok('but still keeps the SOS and its position', !!outs[3].sosId && outs[3].located === true);
}

// ---- LOW 7: the address used for limits is the one the platform saw
{
  const ip = clientIp({ headers: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '9.9.9.9', 'x-vercel-forwarded-for': '9.9.9.9' } });
  ok('a forwarded-for the caller wrote does not choose the address', ip === '9.9.9.9', ip);
  ok('with no platform header, forwarded-for is still read', clientIp({ headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' } }) === '5.6.7.8');
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`security.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
