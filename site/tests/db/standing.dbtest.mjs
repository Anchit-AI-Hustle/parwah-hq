// ACCOUNTS, JOINING AND EQUAL STANDING, AGAINST A REAL DATABASE: the real
// api/auth.mjs, api/circle.mjs, api/events.mjs and api/book.mjs, the real
// schema, on a throwaway PostgreSQL. These are the doors of the whole app.
//
// Three people are kept in mind all the way through, and each has a section
// of their own near the end:
//   - the parent with one cheap phone (never locked out by a stranger, never
//     blocked by a step that needs a second phone);
//   - the person in two families (one account, two standings, one delete);
//   - the family with a single adult (nothing waits for a second yes that
//     nobody can give).
//
// What it proves:
//   E1  the PIN lock grows (15 minutes, 1 hour, 24 hours), forgets after 7
//       clean days, and never locks a phone that has signed in before;
//   E2  a sign-in on a new phone is told to the older phones, "Not me" signs
//       it out and asks for a new PIN, and nothing is ever blocked;
//   E3  an account with no PIN, in a family, cannot be taken by typing its
//       number first;
//   E4  nothing says whether a number is registered: sign-in, a wrong PIN,
//       the lock and a reset read the same for a number nobody has;
//   E5  a family is created or joined only with a session;
//   E6  a PIN reset needs the two numbers, a grown-up of a FAMILY, and can
//       be stopped by the owner;
//   E7  family codes: random, 8 with a number for new ones, no family name
//       before a yes, at most 10 waiting, adults change the door;
//   E8  removing someone on Parwah takes two adults;
//   E9  what a child or a teen cannot do;
//   E10 "This is me", and what the family wrote about you;
//   E11 who is sent a member's phone and birth year;
//   E12 a change to your place in the tree can be undone; linking two
//       households waits 48 hours;
//   E13 the audit trail shows a member only their own rows, and My activity;
//   E14 devices; E15 download, delete my account, delete the family;
//   E16 the recovery contact.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_se_standing_test npm run test:db
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('standing.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('standing.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
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
const { default: events, runTick } = await import('../../../api/events.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { db, makeCode } = await import('../../../api/_db.mjs');
const { lockKey } = await import('../../../api/_account.mjs');

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

let ipn = 0;
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
async function call(handler, body, token, { method = 'POST', query, ua } = {}) {
  ipn++;
  const req = { method, body, query, headers: { 'x-forwarded-for': '10.' + (9 + Math.floor(ipn / 60000)) + '.' + (Math.floor(ipn / 250) % 250) + '.' + (ipn % 250), 'user-agent': ua || UA_ANDROID } };
  if (token) req.headers['x-parwah-token'] = token;
  let status = 200, json = null;
  // As it goes over the wire: dates arrive as text, the way the app gets them.
  const res = { status(s) { status = s; return this; }, json(j) { json = JSON.parse(JSON.stringify(j)); return this; }, setHeader() {} };
  await handler(req, res);
  return { status, ...json, http: status };
}
const enter = (phone, extra = {}, opts = {}) => call(auth, { action: 'enter', phone, cc: '+91', ...extra }, opts.token, opts);
const A = (token, body, opts) => call(auth, body, token, opts);
const C = (token, body) => call(circle, body, token);
const DEV = n => 'device-' + String(n).padStart(4, '0') + '-' + 'x'.repeat(24);
async function signUp(phone, name, pin, extra = {}) {
  const r = await enter(phone, { name, pin, ...extra });
  if (!r.token) throw new Error('sign-up failed for ' + name + ': ' + JSON.stringify(r));
  return { id: r.user.id, token: r.token, phone, pin, name };
}
const rows = async (text, args) => (await admin.query(text, args)).rows;
const one = async (text, args) => (await rows(text, args))[0];
const forgetLimits = () => admin.query('delete from rate_limit');
const keysOf = o => Object.keys(o).filter(k => k !== 'http').sort().join();
const state = async (u, code, memberId) => C(u.token, { action: 'standing_state', code, memberId });
const feedOf = async (u, code, memberId) => call(events, null, u.token, { method: 'GET', query: { circle: code, member: memberId } });

// A family, made the way the app makes one. `people` join and Papa lets them in.
async function makeFamily(founder, circleName, extra = {}) {
  const r = await C(founder.token, { action: 'create', kind: 'family', memberName: founder.name, circleName, role: 'parent', ...extra });
  if (!r.code) throw new Error('create failed: ' + JSON.stringify(r));
  return { code: r.code, id: (await one('select id from circles where code = $1', [r.code])).id, founderM: r.memberId };
}
async function joinIn(fam, by, who, extra = {}) {
  const j = await C(who.token, { action: 'join', code: fam.code, memberName: extra.as || who.name, role: 'family', relation: extra.relation });
  if (j.memberId) return j.memberId;
  if (!j.requestId) throw new Error('join failed for ' + who.name + ': ' + JSON.stringify(j));
  const a = await C(by.token, { action: 'approve_join', code: fam.code, memberId: by.m, requestId: j.requestId });
  if (!a.memberId) throw new Error('approve failed for ' + who.name + ': ' + JSON.stringify(a));
  if (extra.dob) await admin.query('update members set dob = $1 where id = $2', [extra.dob, a.memberId]);
  return a.memberId;
}

// ============================================================ THE VERMAS
// Papa (an elder the family looks after), Maa (mother), Rohan (born 1990),
// Aarav (born 2014, a child), Tara (nothing written down about her age).
const papa = await signUp('9850000001', 'Papa', '4829', { deviceId: DEV(1) });
const maa = await signUp('9850000002', 'Maa', '7351');
const rohan = await signUp('9850000003', 'Rohan', '6142');
const aarav = await signUp('9850000004', 'Aarav', '5937');
const tara = await signUp('9850000005', 'Tara', '8264');
const stranger = await signUp('9850000099', 'Stranger', '3719');
const verma = await makeFamily(papa, 'Verma');
papa.m = verma.founderM;
maa.m = await joinIn(verma, papa, maa, { relation: 'mother' });
rohan.m = await joinIn(verma, papa, rohan, { dob: '1990-05-05' });
aarav.m = await joinIn(verma, papa, aarav, { dob: '2014-02-02' });
tara.m = await joinIn(verma, papa, tara);
const code = verma.code;
ok('setup: five Vermas', (await rows('select id from members where circle_id = $1', [verma.id])).length === 5);

// ============================================================ E5: a session, always
{
  let r = await C(null, { action: 'create', kind: 'family', memberName: 'Ghost', circleName: 'Nobody' });
  ok('E5: a family cannot be created with no session, even with no userId sent', r.http === 401 && r.signin === true, JSON.stringify(r));
  ok('E5: and nothing was made', !(await one(`select 1 as x from circles where name = 'Nobody'`)));
  r = await C(null, { action: 'join', code, memberName: 'Ghost' });
  ok('E5: nor joined', r.http === 401, JSON.stringify(r));
  ok('E5: no request reached the family', !(await one(`select 1 as x from join_requests where name = 'Ghost'`)));
  r = await C('made-up-token-' + 'z'.repeat(40), { action: 'join', code, memberName: 'Ghost' });
  ok('E5: a made-up token is no session', r.http === 401);
  r = await C(stranger.token, { action: 'create', kind: 'family', memberName: 'Stranger', circleName: 'Theirs', userId: papa.id });
  ok('E5: a userId that is not the session\'s own is refused', r.http === 401, JSON.stringify(r));
  r = await C(stranger.token, { action: 'create', kind: 'group', memberName: 'Stranger', circleName: 'Chai friends' });
  const made = await one('select m.user_id from members m where m.id = $1', [r.memberId]);
  ok('E5: with a session and no userId, it is made as the person signed in', r.http === 201 && made && made.user_id === stranger.id, JSON.stringify(r));
  stranger.group = { code: r.code, m: r.memberId };
}

// ============================================================ E4: nothing says whether a number is registered
{
  await forgetLimits();
  const known = await enter('9850000003'), unknown = await enter('9850055555');
  ok('E4: the number alone: the same reply for a number with an account and one without', JSON.stringify({ ...known, http: 0 }) === JSON.stringify({ ...unknown, http: 0 }) && known.needPin === true, JSON.stringify(unknown));
  ok('E4: and it names nobody', !JSON.stringify(known).includes('Rohan'));
  // Five wrong PINs on each: the same words, the same count, the same lock.
  const seq = async phone => { const out = []; for (let i = 0; i < 6; i++) { const r = await enter(phone, { pin: '9' + (100 + i) }); out.push(r.http + ':' + (r.left === undefined ? '' : r.left) + ':' + keysOf(r) + ':' + String(r.error).replace(/\d+ (minutes|hours)/, 'N')); } return out; };
  const k = await seq('9850000003'), u = await seq('9850055555');
  ok('E4: five wrong PINs read the same for both', k.join('|') === u.join('|'), k.join('|') + ' VS ' + u.join('|'));
  ok('E4: 4, 3, 2, 1 left, then locked, for a number nobody has', u.slice(0, 5).map(x => x.split(':').slice(0, 2).join(':')).join() === '401:4,401:3,401:2,401:1,429:', u.join('|'));
  ok('E4: the wrong-PIN words do not say the number exists', /number and PIN do not match/.test(k[0]));
  ok('E4: no account was made for the number nobody has', !(await one(`select 1 as x from users where phone = '+919850055555'`)));
  // "I am new here" with a number that is taken: the same as a wrong PIN.
  await admin.query('delete from pin_locks');
  const taken = await enter('9850000003', { name: 'Someone Else', pin: '2847' });
  ok('E4: registering a number that is taken reads as a wrong PIN, not "already registered"', taken.http === 401 && taken.wrongPin === true && !/already|registered|exists/i.test(taken.error), JSON.stringify(taken));
  ok('E4: and Rohan is still Rohan', (await one('select name from users where id = $1', [rohan.id])).name === 'Rohan');
  const mine = await enter('9850000003', { name: 'Rohan again', pin: rohan.pin });
  ok('E4: with the right PIN it is simply a sign-in', mine.ok && mine.user && mine.user.id === rohan.id && mine.user.name === 'Rohan');
  // What is typed is checked before the number is looked at.
  const b1 = await enter('9850000003', { name: 'X Y', pin: '12' }), b2 = await enter('9850055555', { name: 'X Y', pin: '12' });
  ok('E4: a bad new PIN gets the same answer either way', JSON.stringify({ ...b1, http: 0 }) === JSON.stringify({ ...b2, http: 0 }) && b1.needPin === true);
  // Forgotten PIN.
  await forgetLimits();
  const r1 = await A(null, { action: 'reset_request', phone: '9850000003', cc: '+91' }), r2 = await A(null, { action: 'reset_request', phone: '9850055555', cc: '+91' });
  ok('E4: asking the family reads the same for both', keysOf(r1) === keysOf(r2) && r1.http === r2.http && r1.asked && r2.asked, keysOf(r1) + ' VS ' + keysOf(r2));
  ok('E4: both are given a secret and two numbers', r2.resetSecret.length >= 40 && /^[1-9][0-9]$/.test(r2.sayCode) && /^[1-9][0-9]$/.test(r1.sayCode));
  const lone = await A(null, { action: 'reset_request', phone: '9850000099', cc: '+91' });
  ok('E4: and for someone in no family (it used to say noFamily)', keysOf(lone) === keysOf(r1) && !('noFamily' in lone), keysOf(lone));
  const s1 = await A(null, { action: 'reset_status', phone: '9850055555', cc: '+91', resetSecret: r2.resetSecret });
  ok('E4: the waiting screen of a number nobody has is told it ran out, in time', s1.reset === 'expired');
  await admin.query(`update pin_resets set status = 'denied' where status = 'pending'`);
}

// ============================================================ E1: the lock grows; a known phone is never locked out by others
{
  await forgetLimits(); await admin.query('delete from pin_locks');
  const K = lockKey('+919850000001', null);
  const wrong5 = async (extra = {}) => { let r; for (let i = 0; i < 5; i++) r = await enter('9850000001', { pin: '1' + (300 + i), ...extra }); return r; };
  const until = async k => { const l = await one('select locked_until, level from pin_locks where k = $1', [k]); return l ? { mins: (new Date(l.locked_until) - Date.now()) / 60000, level: l.level } : {}; };
  const free = k => admin.query(`update pin_locks set locked_until = now() - interval '1 second' where k = $1`, [k]);
  let r = await wrong5();
  let l = await until(K);
  ok('E1: the first lock is 15 minutes', r.http === 429 && l.mins > 14 && l.mins <= 15.1 && l.level === 1 && /15 minutes/.test(r.error), JSON.stringify(l));
  // A stranger did that. Papa's own phone (it signed in at sign-up) still works.
  r = await enter('9850000001', { pin: papa.pin, deviceId: DEV(1) });
  ok('E1: the phone Papa already uses is not locked out by a stranger\'s tries', r.ok && !!r.token, JSON.stringify(r).slice(0, 200));
  r = await enter('9850000001', { pin: papa.pin, deviceId: DEV(77) });
  ok('E1: a phone Parwah has never seen is locked, even with the right PIN', r.http === 429);
  r = await enter('9850000001', { pin: papa.pin });
  ok('E1: and so is a request that names no phone', r.http === 429);
  const notice = await one(`select text from account_events where user_id = $1 and kind = 'lock' order by created_at desc limit 1`, [papa.id]);
  ok('E1: Papa is told in plain words, and that his own phones still work', notice && /wrong PIN for your number 5 times/.test(notice.text) && /already use still work/.test(notice.text), JSON.stringify(notice));
  await free(K); r = await wrong5(); l = await until(K);
  ok('E1: the second lock is 1 hour', l.mins > 59 && l.mins <= 60.1 && l.level === 2, JSON.stringify(l));
  await free(K); r = await wrong5(); l = await until(K);
  ok('E1: the third is 24 hours', l.mins > 1439 && l.mins <= 1440.1 && l.level === 3 && /24 hours/.test(r.error), JSON.stringify(l) + r.error);
  await free(K); r = await wrong5(); l = await until(K);
  ok('E1: and 24 hours each time after', l.mins > 1439 && l.mins <= 1440.1 && l.level === 4, JSON.stringify(l));
  // Seven days with no lock.
  await admin.query(`update pin_locks set locked_until = now() - interval '7 days 1 minute' where k = $1`, [K]);
  r = await wrong5(); l = await until(K);
  ok('E1: after 7 clean days it starts again at 15 minutes', l.mins > 14 && l.mins <= 15.1 && l.level === 1, JSON.stringify(l));
  // The known phone has its own count: a thief holding it gets five tries.
  r = await wrong5({ deviceId: DEV(1) });
  ok('E1: the known phone has its own five tries and its own lock', r.http === 429 && !!(await one('select 1 as x from pin_locks where k = $1 and locked_until > now()', [lockKey('+919850000001', (await one('select device_hash from user_devices where user_id = $1 order by first_seen limit 1', [papa.id])).device_hash)])));
  await admin.query('delete from pin_locks');
}

// ============================================================ E2 + E14: a new phone, "Not me", devices
{
  await forgetLimits();
  // Papa's first phone is DEV(1). A second phone signs in with his PIN.
  const first = await enter('9850000001', { pin: papa.pin, deviceId: DEV(1) }, { ua: UA_ANDROID });
  papa.token = first.token;
  ok('E2: signing in again on a phone already known raises nothing', !(await one(`select 1 as x from account_alerts where user_id = $1`, [papa.id])));
  const second = await enter('9850000001', { pin: papa.pin, deviceId: DEV(2) }, { ua: UA_IPHONE });
  ok('E2: the new phone is let in at once: nothing waits for an approval', second.ok && !!second.token);
  const al = await one(`select id, text, status from account_alerts where user_id = $1 and kind = 'new_device'`, [papa.id]);
  ok('E2: and the older phone is told, with the question', al && /New sign-in on another phone/.test(al.text) && /Was this you\?/.test(al.text) && /Safari on iPhone/.test(al.text), JSON.stringify(al));
  let st = await A(papa.token, { action: 'account_state' });
  ok('E2: the older phone sees the alert', st.ok && st.alerts.length === 1 && st.alerts[0].id === al.id, JSON.stringify(st.alerts));
  const st2 = await A(second.token, { action: 'account_state' });
  ok('E2: the new phone is not asked about itself', st2.ok && st2.alerts.length === 0);
  ok('E14: the Devices list names both, and marks this one', st.devices.length >= 2 && st.devices.filter(d => d.current).length === 1
    && st.devices.some(d => d.name === 'Safari on iPhone') && st.devices.some(d => d.name === 'Chrome on Android phone') && st.devices.every(d => d.firstSeen && d.lastUsed), JSON.stringify(st.devices));
  let r = await A(second.token, { action: 'alert_notme', alertId: al.id });
  ok('E2: the new phone cannot say "Not me" about itself', r.http === 403, JSON.stringify(r));
  r = await A(maa.token, { action: 'alert_notme', alertId: al.id });
  ok('E2: nor can anybody else', r.already === true && (await one('select status from account_alerts where id = $1', [al.id])).status === 'open');
  r = await A(papa.token, { action: 'alert_notme', alertId: al.id });
  ok('E2: "Not me" from the older phone', r.ok && r.changeSecret === true, JSON.stringify(r));
  ok('E2: signs the new phone out', (await feedOf({ token: second.token }, code, papa.m)).http === 401);
  ok('E2: and forgets it as a known phone', !(await one('select 1 as x from user_devices d join sessions s on s.device_hash = d.device_hash where s.token_hash is null')) && (await rows('select 1 from user_devices where user_id = $1', [papa.id])).length === 1);
  r = await enter('9850000001', { refresh: true }, { token: papa.token });
  ok('E2: the older phone is asked to choose a new PIN', r.ok && r.changeSecret === true && r.mustChange === true);
  r = await enter('9850000001', { pin: papa.pin, deviceId: DEV(1) });
  ok('E2: the old PIN proves who it is, once, with no session', r.ok && r.changeSecret && !r.token);
  r = await enter('9850000001', { pin: papa.pin, newPin: papa.pin, deviceId: DEV(1) });
  ok('E2: the same PIN again is not a new PIN', r.changeSecret && /different PIN/.test(r.error || '') && !r.token, JSON.stringify(r));
  r = await enter('9850000001', { pin: papa.pin, newPin: '4862', deviceId: DEV(1) });
  ok('E2: a new one, and Papa is in', r.ok && !!r.token && !r.changeSecret, JSON.stringify(r).slice(0, 200));
  papa.pin = '4862'; papa.token = r.token;
  r = await enter('9850000001', { pin: '4829', deviceId: DEV(2) });
  ok('E2: whoever had the old PIN no longer gets in', r.http === 401);
  await admin.query('delete from pin_locks');
  // E14: sign out one device, and everywhere.
  const other = await enter('9850000001', { pin: papa.pin, deviceId: DEV(3) });
  st = await A(papa.token, { action: 'account_state' });
  const sid = st.devices.find(d => !d.current).sid;
  r = await A(papa.token, { action: 'device_signout', sid });
  ok('E14: signing out one device ends that session only', r.ok && (await feedOf({ token: other.token }, code, papa.m)).http === 401 && (await feedOf(papa, code, papa.m)).http === 200);
  r = await A(maa.token, { action: 'device_signout', sid: st.devices.find(d => d.current).sid });
  ok('E14: nobody signs out someone else\'s device', (await feedOf(papa, code, papa.m)).http === 200);
  const again = await enter('9850000001', { pin: papa.pin, deviceId: DEV(3) });
  r = await A(papa.token, { action: 'signout_all', token: papa.token });
  ok('E14: "Sign out everywhere" ends every session', r.ok && (await feedOf({ token: again.token }, code, papa.m)).http === 401 && (await feedOf(papa, code, papa.m)).http === 401);
  papa.token = (await enter('9850000001', { pin: papa.pin, deviceId: DEV(1) })).token;
  await admin.query(`update account_alerts set status = 'ok'`);
}

// ============================================================ E6: letting someone back in
{
  await forgetLimits();
  // Rohan forgets his PIN. Who is asked, and who may say yes?
  let r = await A(null, { action: 'reset_request', phone: '9850000003', cc: '+91' });
  const secret = r.resetSecret, say = r.sayCode;
  const rs = await one(`select id, veto_until from pin_resets where user_id = $1 and status = 'pending'`, [rohan.id]);
  const sees = async u => ((await enter(u.phone, { refresh: true }, { token: u.token })).pinResets || []).some(x => x.id === rs.id);
  ok('E6: Papa and Maa, grown-ups of his family, are asked', await sees(papa) && await sees(maa));
  ok('E6: Tara, whose age nobody wrote down, is asked too (so nobody is left with no one to ask)', await sees(tara));
  ok('E6: Aarav, a child, is not', !(await sees(aarav)));
  ok('E6: nor is someone outside the family', !(await sees(stranger)));
  r = await A(aarav.token, { action: 'reset_approve', resetId: rs.id, sayCode: say });
  ok('E6: a child cannot say yes, even with the two numbers', r.http === 403, JSON.stringify(r));
  r = await A(tara.token, { action: 'reset_approve', resetId: rs.id, sayCode: say });
  ok('E6: not knowing Tara\'s age is a no for this door, and she is told how to fix it', r.http === 403 && r.needDob === true && /date of birth/.test(r.error), JSON.stringify(r));
  r = await A(maa.token, { action: 'reset_approve', resetId: rs.id });
  ok('E6: a grown-up without the two numbers is not taken', r.http === 400 && r.wrongCode === true);
  r = await A(maa.token, { action: 'reset_approve', resetId: rs.id, sayCode: say === '55' ? '56' : '55' });
  ok('E6: nor with the wrong two numbers', r.http === 400 && r.wrongCode === true);
  ok('E6: the request is still waiting', (await one('select status, code_tries from pin_resets where id = $1', [rs.id])).status === 'pending');
  // Tara adds her date of birth, and now her yes counts.
  await C(tara.token, { action: 'update_member', code, memberId: tara.m, dob: '1996-03-03' });
  r = await A(tara.token, { action: 'reset_approve', resetId: rs.id, sayCode: say });
  ok('E6: with her date of birth and the two numbers, Tara lets him in', r.ok && r.status === 'approved', JSON.stringify(r));
  ok('E6: Rohan is signed in on a phone, so the yes waits out ten minutes', !!rs.veto_until && (await A(null, { action: 'reset_status', phone: '9850000003', cc: '+91', resetSecret: secret })).reset === 'holding');
  // Rohan, on his own signed-in phone, sees it and stops it.
  let st = await A(rohan.token, { action: 'account_state' });
  ok('E6: Rohan\'s own phone shows that someone asked', st.myResets.some(x => x.id === rs.id), JSON.stringify(st.myResets));
  r = await A(maa.token, { action: 'reset_veto', resetId: rs.id });
  ok('E6: only the owner can stop it', r.already === true && (await one('select status from pin_resets where id = $1', [rs.id])).status === 'approved');
  r = await A(rohan.token, { action: 'reset_veto', resetId: rs.id });
  ok('E6: "Not me": the owner stops it', r.ok && (await one('select status from pin_resets where id = $1', [rs.id])).status === 'denied');
  r = await enter('9850000003', { resetSecret: secret, newPin: '2957' });
  ok('E6: and the device that asked cannot choose a PIN', !r.token && r.reset === 'denied');
  // Five wrong codes end a request.
  await forgetLimits();
  r = await A(null, { action: 'reset_request', phone: '9850000003', cc: '+91' });
  const rs2 = await one(`select id from pin_resets where user_id = $1 and status = 'pending'`, [rohan.id]);
  let last;
  for (let i = 0; i < 5; i++) last = await A(papa.token, { action: 'reset_approve', resetId: rs2.id, sayCode: r.sayCode === '11' ? '12' : '11' });
  ok('E6: five wrong codes end the request', last.http === 404 && (await one('select status from pin_resets where id = $1', [rs2.id])).status === 'denied', JSON.stringify(last));
  // A group of friends never lets anyone back in.
  await forgetLimits();
  const grp = stranger.group;
  await C(stranger.token, { action: 'set_join_policy', code: grp.code, memberId: grp.m, policy: 'open' });
  const friend = await signUp('9850000098', 'Friend', '6831');
  const fj = await C(friend.token, { action: 'join', code: grp.code, memberName: 'Friend' });
  await admin.query(`update members set dob = '1980-01-01' where id = $1`, [fj.memberId]);
  r = await A(null, { action: 'reset_request', phone: '9850000099', cc: '+91' });
  ok('E6: a friend in a group is not asked, however old they are', !(await one(`select 1 as x from pin_resets where user_id = $1 and status = 'pending'`, [stranger.id])) && r.asked === true);
  stranger.friend = { ...friend, m: fj.memberId };
}

// ============================================================ E16: the recovery contact
{
  await forgetLimits();
  const friend = stranger.friend;
  let r = await A(stranger.token, { action: 'account_state' });
  ok('E16: the people who could be chosen are the grown-ups I share a circle with', r.recoveryChoices.length === 1 && r.recoveryChoices[0].userId === friend.id && r.recovery === null, JSON.stringify(r.recoveryChoices));
  r = await A(stranger.token, { action: 'recovery_set', contactUserId: papa.id });
  ok('E16: someone I share no circle with cannot be chosen', r.http === 400);
  r = await A(stranger.token, { action: 'recovery_set', contactUserId: stranger.id });
  ok('E16: nor myself', r.http === 400);
  r = await A(stranger.token, { action: 'recovery_set', contactUserId: friend.id });
  ok('E16: a friend is chosen', r.ok && r.recovery.name === 'Friend', JSON.stringify(r));
  // Now the reset reaches the friend, across a group of friends.
  r = await A(null, { action: 'reset_request', phone: '9850000099', cc: '+91' });
  const rs = await one(`select id from pin_resets where user_id = $1 and status = 'pending'`, [stranger.id]);
  ok('E16: a reset now reaches the recovery contact', !!rs && ((await enter(friend.phone, { refresh: true }, { token: friend.token })).pinResets || []).some(x => x.id === rs.id));
  const a = await A(friend.token, { action: 'reset_approve', resetId: rs.id, sayCode: r.sayCode });
  ok('E16: and their yes counts, with the two numbers', a.ok && a.status === 'approved', JSON.stringify(a));
  await admin.query(`update pin_resets set veto_until = now() - interval '1 second' where id = $1`, [rs.id]);
  const inn = await enter('9850000099', { resetSecret: r.resetSecret, newPin: '3728' });
  ok('E16: the person is back in with a new PIN', inn.ok && !!inn.token);
  stranger.token = inn.token; stranger.pin = '3728';
  r = await A(stranger.token, { action: 'recovery_clear' });
  ok('E16: the contact can be removed', r.ok && (await one('select recovery_user from users where id = $1', [stranger.id])).recovery_user === null);
}

// ============================================================ E3: an account with no PIN
{
  await forgetLimits();
  // Dadu's account is from before PINs. He is in the family; Papa added him.
  const dadu = (await one(`insert into users (phone, phone_cc, phone_local, name) values ('+919850000010', '+91', '9850000010', 'Dadu') returning id`)).id;
  await admin.query(`insert into members (circle_id, name, role, user_id, phone) values ($1, 'Dadu', 'parent', $2, '+919850000010')`, [verma.id, dadu]);
  let r = await enter('9850000010');
  ok('E3: a number with no PIN, in a family, is asked for a PIN like any other', r.needPin === true && !r.setPin, JSON.stringify(r));
  r = await enter('9850000010', { pin: '2957' });
  ok('E3: whoever types the number first can no longer set the PIN', r.http === 401 && !r.token && (await one('select pin_hash from users where id = $1', [dadu])).pin_hash === null, JSON.stringify(r));
  r = await A(null, { action: 'reset_request', phone: '9850000010', cc: '+91' });
  const rs = await one(`select id from pin_resets where user_id = $1 and status = 'pending'`, [dadu]);
  const a = await A(maa.token, { action: 'reset_approve', resetId: rs.id, sayCode: r.sayCode });
  ok('E3: he asks the family, and a grown-up says yes', a.ok && a.status === 'approved');
  const inn = await enter('9850000010', { resetSecret: r.resetSecret, newPin: '2957' });
  ok('E3: he has no phone signed in, so there is no ten-minute wait, and he chooses his PIN', inn.ok && !!inn.token, JSON.stringify(inn).slice(0, 200));
  // With no family to vouch, it is as before.
  await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ('+919850000011', '+91', '9850000011', 'Alone')`);
  r = await enter('9850000011');
  ok('E3: an account with no PIN and no family chooses its first PIN, as before', r.setPin === true);
  r = await enter('9850000011', { pin: '6391' });
  ok('E3: and is in', r.ok && !!r.token);
  await admin.query('delete from members where user_id = $1', [dadu]);
  await admin.query('delete from pin_locks');
}

// ============================================================ E7: family codes and the door
{
  await forgetLimits();
  const codes = Array.from({ length: 300 }, () => makeCode());
  ok('E7: a new code is 8 long, with a letter and a number, no look-alikes', codes.every(c => /^[A-HJKMNP-Z2-9]{8}$/.test(c) && /[A-Z]/.test(c) && /[2-9]/.test(c)), codes.find(c => !/^[A-HJKMNP-Z2-9]{8}$/.test(c)));
  ok('E7: and 300 of them are all different', new Set(codes).size === 300);
  ok('E7: the Vermas\' own code is one of these', /^[A-HJKMNP-Z2-9]{8}$/.test(code), code);
  let r = await C(papa.token, { action: 'set_code', code, memberId: papa.m, newCode: 'VERMAS' });
  ok('E7: a new custom code of 6 letters is refused', r.http === 400 && /at least 8/.test(r.error), JSON.stringify(r));
  r = await C(papa.token, { action: 'set_code', code, memberId: papa.m, newCode: 'VERMAFAM' });
  ok('E7: 8 letters with no number is refused', r.http === 400 && /at least one number/.test(r.error));
  r = await C(aarav.token, { action: 'set_code', code, memberId: aarav.m, newCode: 'VERMA2026' });
  ok('E7: a child cannot change the code', r.http === 403);
  ok('E7: the code is unchanged', !!(await one('select 1 as x from circles where code = $1', [code])));
  // An older, shorter code keeps working, and the adults get a gentle card.
  const old = await makeFamily(stranger, 'Old code');
  await admin.query(`update circles set code = 'SHARMAS', join_policy = 'open' where id = $1`, [old.id]);
  r = await C(tara.token, { action: 'join', code: 'SHARMAS', memberName: 'Tara' });
  ok('E7: a family with an older 7-letter code is still joined with it', r.ok && !!r.memberId, JSON.stringify(r));
  let st = await state(stranger, 'SHARMAS', old.founderM);
  ok('E7: its adults are told the code could be stronger', st.codeWeak === true);
  st = await state(papa, code, papa.m);
  ok('E7: a family with a new code is not', st.codeWeak === false);
  st = await state(aarav, code, aarav.m);
  ok('E7: a child is not shown the card', st.codeWeak === false && st.me.may === false);
  // No family name before a yes.
  const newcomer = await signUp('9850000020', 'Naya', '4826');
  r = await C(newcomer.token, { action: 'join', code, memberName: 'Naya' });
  ok('E7: a request to join says it has gone, and nothing about whose door it was', r.http === 202 && r.pending && !('circleName' in r) && !/Verma/.test(JSON.stringify(r)), JSON.stringify(r));
  const js = await C(newcomer.token, { action: 'join_status', code, requestId: r.requestId });
  ok('E7: nor does "check again" while waiting', js.status === 'pending' && !/Verma/.test(JSON.stringify(js)), JSON.stringify(js));
  // At most ten wait at one door.
  const waiters = [];
  for (let i = 0; i < 10; i++) waiters.push(await signUp('98500003' + String(i).padStart(2, '0'), 'Waiter ' + String.fromCharCode(65 + i), '4826'));
  const outs = [];
  for (const w of waiters) outs.push((await C(w.token, { action: 'join', code, memberName: w.name })).http);
  ok('E7: nine more may wait (ten in all), and the eleventh is asked to try later', outs.slice(0, 9).every(s => s === 202) && outs[9] === 429, outs.join());
  ok('E7: ten requests are waiting, no more', (await one(`select count(*)::int as n from join_requests where circle_id = $1 and status = 'pending'`, [verma.id])).n === 10);
  r = await C(aarav.token, { action: 'approve_join', code, memberId: aarav.m, requestId: r.requestId });
  ok('E9: a child cannot let someone in', r.http === 403 && /grown-up/.test(r.error));
  r = await C(aarav.token, { action: 'decline_join', code, memberId: aarav.m, requestId: (await one(`select id from join_requests where circle_id = $1 and status = 'pending' limit 1`, [verma.id])).id });
  ok('E9: nor say no to them', r.http === 403);
  await admin.query(`update join_requests set status = 'declined' where circle_id = $1 and status = 'pending'`, [verma.id]);
  // How people join.
  r = await C(aarav.token, { action: 'set_join_policy', code, memberId: aarav.m, policy: 'open' });
  ok('E7: a child cannot change how people join', r.http === 403);
  r = await C(papa.token, { action: 'set_join_policy', code, memberId: papa.m, policy: 'open' });
  ok('E7: letting the code be enough needs a second adult: it waits', r.http === 202 && r.pending === true && r.joinPolicy === 'approve' && (await one('select join_policy from circles where id = $1', [verma.id])).join_policy === 'approve', JSON.stringify(r));
  st = await state(maa, code, maa.m);
  const ask = st.asks.find(x => x.kind === 'open_join');
  ok('E7: the other adults see the question, with who asked', ask && ask.askedByName === 'Papa' && ask.mine === false && ask.voted === null, JSON.stringify(st.asks));
  ok('E7: a child does not', (await state(aarav, code, aarav.m)).asks.length === 0);
  r = await C(aarav.token, { action: 'ask_vote', code, memberId: aarav.m, askId: ask.id, yes: true });
  ok('E7: and cannot answer it', r.http === 403);
  r = await C(papa.token, { action: 'ask_vote', code, memberId: papa.m, askId: ask.id, yes: true });
  ok('E7: the one who asked saying yes again is not a second yes', r.status === 'pending' && (await one('select join_policy from circles where id = $1', [verma.id])).join_policy === 'approve');
  r = await C(maa.token, { action: 'ask_vote', code, memberId: maa.m, askId: ask.id, yes: true });
  ok('E7: Maa says yes, and now the code is enough', r.status === 'done' && (await one('select join_policy from circles where id = $1', [verma.id])).join_policy === 'open', JSON.stringify(r));
  r = await C(rohan.token, { action: 'set_join_policy', code, memberId: rohan.m, policy: 'approve' });
  ok('E7: asking for a yes again is one adult\'s to set, at once', r.ok && r.joinPolicy === 'approve' && (await one('select join_policy from circles where id = $1', [verma.id])).join_policy === 'approve');
  // A no.
  r = await C(papa.token, { action: 'set_join_policy', code, memberId: papa.m, policy: 'open' });
  r = await C(rohan.token, { action: 'ask_vote', code, memberId: rohan.m, askId: r.askId, yes: false });
  ok('E7: one adult saying no stops it', r.status === 'declined' && (await one('select join_policy from circles where id = $1', [verma.id])).join_policy === 'approve');
  r = await C(papa.token, { action: 'set_code', code, memberId: papa.m, newCode: 'verma 2026' });
  ok('E7: an adult sets a strong custom code', r.ok && r.code === 'VERMA2026', JSON.stringify(r));
  await C(papa.token, { action: 'set_code', code: 'VERMA2026', memberId: papa.m, newCode: code });
}

// ============================================================ E9: a child, a teen, and "is Tara an adult?"
{
  await forgetLimits();
  // Tara had no date of birth: reset it to that for this section.
  await admin.query('update members set dob = null where user_id = $1', [tara.id]);
  let st = await state(papa, code, papa.m);
  ok('E9: an adult is asked, once, about someone whose age nobody wrote down', st.unsure.length === 1 && st.unsure[0].id === tara.m, JSON.stringify(st.unsure));
  ok('E9: Tara herself may act meanwhile, and is told her standing is not known', (await state(tara, code, tara.m)).me.standing === 'unsure' && (await state(tara, code, tara.m)).me.may === true);
  let r = await C(aarav.token, { action: 'adult_confirm', code, memberId: aarav.m, targetId: tara.m, adult: true });
  ok('E9: a child cannot answer for her', r.http === 403);
  r = await C(tara.token, { action: 'adult_confirm', code, memberId: tara.m, targetId: tara.m, adult: true });
  ok('E9: nor she for herself', r.http === 404);
  r = await C(papa.token, { action: 'adult_confirm', code, memberId: papa.m, targetId: tara.m, adult: false });
  ok('E9: Papa says she is under 18, and it is kept', r.ok && (await one('select adult_confirmed, adult_confirmed_by from members where id = $1', [tara.m])).adult_confirmed === false);
  ok('E9: nobody is asked again', (await state(maa, code, maa.m)).unsure.length === 0);
  ok('E9: and now Tara is a teen for every gate', (await state(tara, code, tara.m)).me.may === false);
  // What a teen cannot do.
  const dadi = await C(papa.token, { action: 'add_person', code, memberId: papa.m, personName: 'Dadi', gender: 'f', place: 'parent', ofId: papa.m });
  r = await C(tara.token, { action: 'place', code, memberId: tara.m, targetId: rohan.m, place: 'child', ofId: papa.m });
  ok('E9: a teen cannot move someone else in the tree', r.http === 403, JSON.stringify(r));
  r = await C(tara.token, { action: 'add_person', code, memberId: tara.m, personName: 'Made Up', gender: 'm', place: 'child', ofId: papa.m });
  ok('E9: nor add someone to it', r.http === 403);
  r = await C(tara.token, { action: 'remove_person', code, memberId: tara.m, targetId: dadi.memberId });
  ok('E9: nor remove someone from it', r.http === 403);
  r = await C(tara.token, { action: 'place', code, memberId: tara.m, place: 'spouse', ofId: rohan.m });
  ok('E9: nor marry herself to someone in it', r.http === 403);
  r = await C(tara.token, { action: 'place', code, memberId: tara.m, place: 'child', ofId: papa.m });
  ok('E9: she can say whose child she is', r.ok, JSON.stringify(r));
  r = await C(tara.token, { action: 'unplace', code, memberId: tara.m, link: 'parent' });
  ok('E9: and take that back', r.ok, JSON.stringify(r));
  r = await C(tara.token, { action: 'link_request', code, memberId: tara.m, otherCode: 'SHARMAS', bridgeId: tara.m });
  ok('E9: a teen cannot ask to link two households', r.http === 403, JSON.stringify(r));
  r = await C(tara.token, { action: 'remove_ask', code, memberId: tara.m, targetId: rohan.m });
  ok('E9: nor ask for someone to be removed', r.http === 403);
  r = await C(tara.token, { action: 'family_delete_ask', code, memberId: tara.m });
  ok('E9: nor for the family to be deleted', r.http === 403);
  // Her own date of birth decides it in the end.
  await C(tara.token, { action: 'update_member', code, memberId: tara.m, dob: '1996-03-03' });
  ok('E9: her date of birth, once written, is what counts', (await state(tara, code, tara.m)).me.standing === 'adult');
}

// ============================================================ E12: the tree can be undone; linking waits 48 hours
{
  await forgetLimits();
  // Maa is placed as Papa's wife by Rohan. Both are on Parwah.
  let r = await C(rohan.token, { action: 'place', code, memberId: rohan.m, targetId: maa.m, place: 'spouse', ofId: papa.m, gender: 'f', ofGender: 'm' });
  ok('E12: Rohan places Maa as Papa\'s wife', r.ok, JSON.stringify(r));
  const edit = await one('select id, people from tree_edits where circle_id = $1 order by created_at desc limit 1', [verma.id]);
  ok('E12: both of them, on Parwah, are the people it is about', edit && edit.people.includes(maa.m) && edit.people.includes(papa.m) && !edit.people.includes(rohan.m), JSON.stringify(edit));
  let st = await state(maa, code, maa.m);
  ok('E12: Maa is shown the change, with who made it', st.treeEdits.length === 1 && st.treeEdits[0].by === 'Rohan', JSON.stringify(st.treeEdits));
  ok('E12: Rohan, who made it, is not offered an undo', (await state(rohan, code, rohan.m)).treeEdits.length === 0);
  ok('E12: Aarav, whom it is not about, is not either', (await state(aarav, code, aarav.m)).treeEdits.length === 0);
  ok('E12: and it is in Maa\'s activity', (await A(maa.token, { action: 'activity' })).activity.some(a => /Rohan changed your place in the family tree/.test(a.text)));
  r = await C(aarav.token, { action: 'tree_undo', code, memberId: aarav.m, editId: edit.id });
  ok('E12: someone it is not about cannot undo it', r.http === 404);
  r = await C(maa.token, { action: 'tree_undo', code, memberId: maa.m, editId: edit.id });
  const after = await rows('select id, spouse_id from members where id = any($1)', [[maa.m, papa.m]]);
  ok('E12: one tap puts it back, for both of them', r.ok && after.every(x => x.spouse_id === null), JSON.stringify(after));
  r = await C(papa.token, { action: 'tree_undo', code, memberId: papa.m, editId: edit.id });
  ok('E12: it is undone once', r.http === 404);
  // A change made by the person themselves is not "someone else's".
  r = await C(rohan.token, { action: 'place', code, memberId: rohan.m, place: 'child', ofId: papa.m });
  ok('E12: placing yourself under a parent records nothing to undo for you', r.ok && !(await one('select 1 as x from tree_edits where $1 = any(people) and undone_at is null', [rohan.m])));
  // The tree moved on: the older change can no longer be undone blindly.
  r = await C(rohan.token, { action: 'place', code, memberId: rohan.m, targetId: aarav.m, place: 'child', ofId: rohan.m });
  const e2 = await one('select id from tree_edits where $1 = any(people) and undone_at is null order by created_at desc limit 1', [aarav.m]);
  await admin.query('update members set parent_id = $1 where id = $2', [papa.m, aarav.m]);
  r = await C(aarav.token, { action: 'tree_undo', code, memberId: aarav.m, editId: e2.id });
  ok('E12: if the tree has changed again since, undo says so and changes nothing', r.http === 409 && (await one('select parent_id from members where id = $1', [aarav.m])).parent_id === papa.m, JSON.stringify(r));
  await admin.query('update members set parent_id = $1 where id = $2', [rohan.m, aarav.m]);

  // ---- two households. The Sharmas: Stranger (single adult) and Tara.
  await admin.query(`update circles set code = 'SHARMA24' where code = 'SHARMAS'`);
  const sh = { code: 'SHARMA24', founder: stranger, founderM: (await one(`select m.id from members m join circles c on c.id = m.circle_id where c.code = 'SHARMA24' and m.user_id = $1`, [stranger.id])).id };
  const taraSh = (await one(`select m.id from members m join circles c on c.id = m.circle_id where c.code = 'SHARMA24' and m.user_id = $1`, [tara.id])).id;
  r = await C(stranger.token, { action: 'link_request', code: sh.code, memberId: sh.founderM, otherCode: code, bridgeId: taraSh });
  ok('E12: the Sharmas ask to link with the Vermas', r.http === 202 && !!r.linkId, JSON.stringify(r));
  const linkId = r.linkId;
  r = await C(aarav.token, { action: 'link_approve', code, memberId: aarav.m, linkId, bridgeId: tara.m });
  ok('E12: a child cannot say yes', r.http === 403);
  r = await C(papa.token, { action: 'link_approve', code, memberId: papa.m, linkId, bridgeId: tara.m });
  ok('E12: Papa\'s yes starts a 48-hour wait, not the link', r.ok && r.active === false && r.holdHours === 48, JSON.stringify(r));
  const lk = async () => one('select status, agreed_at, effective_at from family_links where id = $1', [linkId]);
  let l = await lk();
  ok('E12: it starts 48 hours from the yes', l.status === 'pending' && Math.abs((new Date(l.effective_at) - new Date(l.agreed_at)) / 3600000 - 48) < 0.01, JSON.stringify(l));
  let ls = await C(maa.token, { action: 'link_state', code, memberId: maa.m });
  ok('E12: every adult sees it waiting, and can say yes or object', ls.agreed.length === 1 && ls.agreed[0].iSaidYes === false && ls.links.length === 0 && ls.incoming.length === 0, JSON.stringify(ls.agreed));
  ok('E12: nothing of the other family is shown while it waits', !JSON.stringify(ls).includes('Stranger'));
  r = await C(aarav.token, { action: 'link_object', code, memberId: aarav.m, linkId });
  ok('E12: a child cannot object or agree', r.http === 403);
  // Every adult of both families says yes: at once.
  for (const u of [maa, rohan]) r = await C(u.token, { action: 'link_yes', code, memberId: u.m, linkId });
  ok('E12: not until the last adult has said yes', r.active === false && (await lk()).status === 'pending');
  r = await C(tara.token, { action: 'link_yes', code, memberId: tara.m, linkId });
  ok('E12: when every adult of both families has said yes, it starts at once', r.active === true && (await lk()).status === 'active', JSON.stringify(r));
  await C(papa.token, { action: 'link_end', code, memberId: papa.m, linkId });
  // An objection.
  await forgetLimits();
  r = await C(stranger.token, { action: 'link_request', code: sh.code, memberId: sh.founderM, otherCode: code, bridgeId: taraSh });
  const link2 = r.linkId;
  await C(papa.token, { action: 'link_approve', code, memberId: papa.m, linkId: link2, bridgeId: tara.m });
  r = await C(rohan.token, { action: 'link_object', code, memberId: rohan.m, linkId: link2 });
  ok('E12: one adult objects, and the trees are not linked', r.ok && (await one('select status from family_links where id = $1', [link2])).status === 'declined');
  // 48 hours pass with nobody objecting. (The 7-day wait after a no is
  // skipped here by removing that row.)
  await admin.query('delete from family_links where id = $1', [link2]); await forgetLimits();
  r = await C(stranger.token, { action: 'link_request', code: sh.code, memberId: sh.founderM, otherCode: code, bridgeId: taraSh });
  const link3 = r.linkId;
  await C(papa.token, { action: 'link_approve', code, memberId: papa.m, linkId: link3, bridgeId: tara.m });
  await admin.query(`update family_links set effective_at = now() - interval '1 minute' where id = $1`, [link3]);
  await runTick(db(), 20000);
  ok('E12: after 48 hours with no objection the timer links them', (await one('select status from family_links where id = $1', [link3])).status === 'active');
  await C(papa.token, { action: 'link_end', code, memberId: papa.m, linkId: link3 });
}

// ============================================================ E10: "This is me"
{
  await forgetLimits();
  // The family wrote Chacha's profile before he had Parwah.
  let r = await C(papa.token, { action: 'add_person', code, memberId: papa.m, personName: 'Chacha', gender: 'm', place: 'sibling', ofId: papa.m });
  const chachaM = r.memberId;
  await admin.query(`update members set relation = 'brother', dob = '1962-04-10', place = 'Kanpur', country = 'IN', gift_info = '{"clothes":"XL","shoe":"9","likes":"old film songs"}'::jsonb where id = $1`, [chachaM]);
  const chacha = await signUp('9850000040', 'Chacha', '4826');
  r = await C(chacha.token, { action: 'join', code, memberName: 'Chacha' });
  ok('E10: joining under the name the family wrote is a request to be that profile', r.http === 202 && r.pending, JSON.stringify(r));
  ok('E10: it does not say "someone is already called Chacha"', !/already called/.test(JSON.stringify(r)));
  const rq = await one('select id, claim_member, wants_claim from join_requests where id = $1', [r.requestId]);
  ok('E10: the request names the profile it asks to be', rq.claim_member === chachaM && rq.wants_claim === true);
  ok('E10: nothing is linked until an adult says yes', (await one('select user_id from members where id = $1', [chachaM])).user_id === null);
  r = await C(maa.token, { action: 'approve_join', code, memberId: maa.m, requestId: rq.id });
  ok('E10: an adult says yes, and he is that same profile, not a second one', r.ok && r.memberId === chachaM && (await rows(`select 1 from members where circle_id = $1 and lower(name) = 'chacha'`, [verma.id])).length === 1, JSON.stringify(r));
  chacha.m = chachaM;
  let st = await state(chacha, code, chacha.m);
  ok('E10: on his first visit he is shown what the family wrote about him', Array.isArray(st.claimReview) && st.claimReview.map(i => i.key).join() === 'name,relation,dob,place,sizes,likes', JSON.stringify(st.claimReview));
  r = await C(chacha.token, { action: 'claim_review', code, memberId: chacha.m, choices: { relation: 'keep', dob: 'hide', place: 'delete', sizes: 'hide', likes: 'keep', name: 'delete' } });
  const row = await one('select name, relation, dob, place, gift_info, hidden_fields, claim_review from members where id = $1', [chacha.m]);
  ok('E10: keep, hide and delete, item by item', r.ok && row.relation === 'brother' && row.place === null && !!row.dob && row.gift_info.clothes === 'XL' && row.hidden_fields.sort().join() === 'dob,sizes' && row.claim_review === false, JSON.stringify(row));
  ok('E10: the name stays', row.name === 'Chacha');
  ok('E10: and he is not asked again', (await state(chacha, code, chacha.m)).claimReview === null);
  const seen = (await feedOf(rohan, code, rohan.m)).members.find(m => m.id === chacha.m);
  ok('E10: what he hid is not sent to the family: his date of birth and his sizes', seen.dob === null && !seen.gift_info.clothes && seen.gift_info.likes === 'old film songs' && seen.relation === 'brother', JSON.stringify(seen));
  const own = (await feedOf(chacha, code, chacha.m)).members.find(m => m.id === chacha.m);
  ok('E10: he still sees his own', String(own.dob).length >= 10 && own.gift_info.clothes === 'XL');
  // A different name: the adult says who this is.
  r = await C(papa.token, { action: 'add_person', code, memberId: papa.m, personName: 'Bua ji', gender: 'f', place: 'sibling', ofId: papa.m });
  const buaM = r.memberId;
  const bua = await signUp('9850000041', 'Kamla Devi', '4826');
  r = await C(bua.token, { action: 'join', code, memberName: 'Kamla Devi', claim: true });
  ok('E10: "This is me" with a different name is flagged for the adults', r.http === 202 && (await one('select wants_claim, claim_member from join_requests where id = $1', [r.requestId])).wants_claim === true);
  const a = await C(papa.token, { action: 'approve_join', code, memberId: papa.m, requestId: r.requestId, claimMember: buaM });
  ok('E10: the adult says "this is Bua ji", and she becomes that profile', a.ok && a.memberId === buaM && (await one('select user_id, claim_review from members where id = $1', [buaM])).user_id === bua.id);
  // Two people with one name, both on Parwah.
  const twin = await signUp('9850000042', 'Rohan', '4826');
  r = await C(twin.token, { action: 'join', code, memberName: 'Rohan' });
  ok('E10: a name someone ON Parwah already has is not told to the person asking', r.http === 202 && !/already called/.test(JSON.stringify(r)));
  const a2 = await C(papa.token, { action: 'approve_join', code, memberId: papa.m, requestId: r.requestId });
  ok('E10: the family is told, and the request waits for them to sort it out', a2.http === 409 && a2.dupName === true && (await one('select status from join_requests where id = $1', [r.requestId])).status === 'pending', JSON.stringify(a2));
  await C(papa.token, { action: 'decline_join', code, memberId: papa.m, requestId: r.requestId });
  await admin.query('delete from members where id = any($1)', [[buaM]]);
}

// ============================================================ E11: who sees my phone and birth year
{
  const card = async (viewer, vm, id, c = code) => (await feedOf(viewer, c, vm)).members.find(m => m.id === id);
  let c = await card(aarav, aarav.m, rohan.m);
  ok('E11: in a family, by default, everyone sees a phone and a birthday', c.phone === '+919850000003' && String(c.dob).slice(0, 4) === '1990', JSON.stringify(c));
  ok('E11: the choices themselves are never sent to anyone', !('see_phone' in c) && !('see_birth' in c) && !('hidden_fields' in c) && !('adult_confirmed' in c));
  let r = await C(rohan.token, { action: 'privacy_set', code, memberId: rohan.m, seePhone: 'adults', seeBirth: 'adults' });
  ok('E11: Rohan chooses "only adults"', r.ok && r.privacy.phone === 'adults' && r.privacy.birth === 'adults', JSON.stringify(r));
  c = await card(aarav, aarav.m, rohan.m);
  ok('E11: a child is no longer sent his phone', c.phone === null);
  ok('E11: nor his birth year, but the birthday stays for wishes', c.dob === null && c.dob_md === '05-05');
  c = await card(maa, maa.m, rohan.m);
  ok('E11: an adult still is', c.phone === '+919850000003' && String(c.dob).slice(0, 4) === '1990');
  await C(rohan.token, { action: 'privacy_set', code, memberId: rohan.m, seePhone: 'me', seeBirth: 'me' });
  c = await card(maa, maa.m, rohan.m);
  ok('E11: "only me": nobody else is sent them', c.phone === null && c.dob === null);
  c = await card(rohan, rohan.m, rohan.m);
  ok('E11: he still sees his own', c.phone === '+919850000003' && String(c.dob).slice(0, 4) === '1990');
  r = await C(rohan.token, { action: 'privacy_set', code, memberId: rohan.m, seePhone: 'everyone' });
  ok('E11: a choice outside the three is refused', r.http === 400);
  r = await C(maa.token, { action: 'privacy_set', code, memberId: rohan.m, seePhone: 'family' });
  ok('E11: nobody chooses for someone else', r.http === 403 && (await one('select see_phone from members where id = $1', [rohan.m])).see_phone === 'me');
  await C(rohan.token, { action: 'privacy_set', code, memberId: rohan.m, seePhone: 'family', seeBirth: 'family' });
  // A group of friends.
  const g = stranger.group, f = stranger.friend;
  c = await card(stranger, g.m, f.m, g.code);
  ok('E11: in a group of friends, a phone and a date of birth are hidden by default', c.phone === null && c.dob === null && c.dob_md === null && c.name === 'Friend', JSON.stringify(c));
  await C(f.token, { action: 'privacy_set', code: g.code, memberId: f.m, seePhone: 'family' });
  c = await card(stranger, g.m, f.m, g.code);
  ok('E11: unless the member chooses to show them', c.phone === '+919850000098' && c.dob === null);
  ok('E11: the choice is per circle: the group default is "only me"', (await state(stranger, g.code, g.m)).privacy.phone === 'me' && (await state(papa, code, papa.m)).privacy.phone === 'family');
}

// ============================================================ E13: the audit trail, and My activity
{
  await call(book, null, papa.token, { method: 'GET', query: { area: 'audit', circle: code, member: papa.m } });
  // Rohan opened Papa's hospital papers; Maa opened Rohan's lab numbers.
  await admin.query(`insert into audit_events (circle_id, actor_id, action, resource, resource_id) values ($1, $2, 'view_emergency_packet', 'insurance_preauth_packet', $3)`, [verma.id, rohan.m, papa.m]);
  await admin.query(`insert into audit_events (circle_id, actor_id, action, resource, resource_id) values ($1, $2, 'view_biomarkers', 'biomarker_records', $3)`, [verma.id, maa.m, rohan.m]);
  const trail = async u => (await call(book, null, u.token, { method: 'GET', query: { area: 'audit', circle: code, member: u.m } })).events || [];
  const about = (list, who) => list.filter(e => e.resource_id === who).length;
  const tp = await trail(papa), tr = await trail(rohan), tm = await trail(maa), tt = await trail(tara);
  ok('E13: Papa sees that his papers were opened (he is the subject)', about(tp, papa.m) === 1 && tp.length === 1, String(tp.length));
  ok('E13: Rohan sees what he opened (he did it) and what was opened about him', tr.length === 2);
  ok('E13: Maa sees only what she did', tm.length === 1 && about(tm, rohan.m) === 1);
  ok('E13: Tara, neither the subject nor the one who did it, sees nothing', tt.length === 0, JSON.stringify(tt));
  const one1 = await call(book, null, tara.token, { method: 'GET', query: { area: 'audit', circle: code, member: tara.m, resource: 'insurance_preauth_packet', resourceId: papa.m } });
  ok('E13: nor by asking for Papa\'s trail by name', one1.http === 200 && one1.events.length === 0);
  const act = (await A(papa.token, { action: 'activity' })).activity;
  ok('E13: My activity says who opened what about me', act.some(a => a.text === 'Rohan opened your hospital papers'), JSON.stringify(act.slice(0, 5)));
  ok('E13: and my sign-ins, new phones and PIN changes', act.some(a => a.kind === 'signin') && act.some(a => /new phone/.test(a.text)) && act.some(a => /new PIN/.test(a.text)));
  ok('E13: newest first', act.every((a, i) => i === 0 || act[i - 1].at >= a.at));
  const actT = (await A(tara.token, { action: 'activity' })).activity;
  ok('E13: nobody\'s activity shows another person\'s', !actT.some(a => /hospital papers|wrong PIN/.test(a.text)));
  ok('E13: it needs a session', (await A(null, { action: 'activity' })).http === 401);
}

// ============================================================ E8: removing someone who is on Parwah
{
  await forgetLimits();
  // Rohan has a private note, a shared note and a message in the family chat.
  await call(book, null, rohan.token, { method: 'GET', query: { area: 'notes', circle: code, member: rohan.m } });
  await admin.query(`insert into notes (circle_id, by_member, title, body, private) values ($1, $2, 'My own list', 'private words', true), ($1, $2, 'Shopping', 'atta, dal', false)`, [verma.id, rohan.m]);
  const chat = (await one(`insert into chats (circle_id, kind, name) values ($1, 'circle', 'Everyone') returning id`, [verma.id])).id;
  await admin.query(`insert into messages (chat_id, member_id, text) values ($1, $2, 'Namaste sab ko')`, [chat, rohan.m]);
  let r = await C(aarav.token, { action: 'remove_ask', code, memberId: aarav.m, targetId: rohan.m });
  ok('E8: a child cannot ask', r.http === 403);
  r = await C(papa.token, { action: 'remove_ask', code, memberId: papa.m, targetId: papa.m });
  ok('E8: nobody removes themselves this way', r.http === 400 && /Leave this family/.test(r.error));
  r = await C(papa.token, { action: 'remove_ask', code, memberId: papa.m, targetId: rohan.m });
  ok('E8: one adult asking is not enough: it waits for a second', r.http === 202 && r.pending === true && !!(await one('select 1 as x from members where id = $1', [rohan.m])), JSON.stringify(r));
  const askId = r.askId;
  ok('E8: Rohan is not shown the request about himself', !(await state(rohan, code, rohan.m)).asks.some(a => a.kind === 'remove_member'));
  ok('E8: the other adults are', (await state(maa, code, maa.m)).asks.some(a => a.id === askId && a.targetName === 'Rohan'));
  r = await C(rohan.token, { action: 'ask_vote', code, memberId: rohan.m, askId, yes: false });
  ok('E8: and Rohan cannot answer it', r.http === 403);
  r = await C(papa.token, { action: 'ask_vote', code, memberId: papa.m, askId, yes: true });
  ok('E8: the one who asked cannot be the second yes', r.status === 'pending' && !!(await one('select 1 as x from members where id = $1', [rohan.m])));
  r = await C(aarav.token, { action: 'ask_vote', code, memberId: aarav.m, askId, yes: true });
  ok('E8: nor can a child', r.http === 403);
  r = await C(maa.token, { action: 'ask_vote', code, memberId: maa.m, askId, yes: true });
  ok('E8: a second adult agrees, and Rohan is no longer in the family', r.status === 'done' && !(await one('select 1 as x from members where id = $1', [rohan.m])), JSON.stringify(r));
  ok('E8: his session no longer opens this family', (await feedOf(rohan, code, rohan.m)).http === 403);
  ok('E8: but he is still signed in, and his account is his', (await enter('9850000003', { refresh: true }, { token: rohan.token })).ok === true);
  ok('E8: he is told, with who decided', (await A(rohan.token, { action: 'activity' })).activity.some(a => /removed from Verma/.test(a.text) && /Papa and Maa decided this together/.test(a.text)));
  ok('E8: his private note is gone, not handed to the family', !(await one(`select 1 as x from notes where title = 'My own list'`)));
  ok('E8: what he shared stays', !!(await one(`select 1 as x from notes where title = 'Shopping' and by_member is null`)) && !!(await one(`select 1 as x from messages where text = E'\u2063Namaste sab ko' and member_id is null`)));
  ok('E8: the family reads who decided it', !!(await one(`select 1 as x from events where circle_id = $1 and text like 'Rohan is no longer in the family. Papa and Maa decided this together.%'`, [verma.id])));
  // A no from the second adult.
  r = await C(maa.token, { action: 'remove_ask', code, memberId: maa.m, targetId: tara.m });
  r = await C(papa.token, { action: 'ask_vote', code, memberId: papa.m, askId: r.askId, yes: false });
  ok('E8: a no from the second adult, and nothing changes', r.status === 'declined' && !!(await one('select 1 as x from members where id = $1', [tara.m])));
  // Rohan comes back for the later sections.
  rohan.m = await joinIn(verma, papa, rohan, { dob: '1990-05-05' });
}

// ============================================================ E15: download, delete my account, delete the family
{
  await forgetLimits();
  const chat = (await one(`select id from chats where circle_id = $1 and kind = 'circle'`, [verma.id])).id;
  await admin.query(`insert into messages (chat_id, member_id, text) values ($1, $2, 'Tara ka message'), ($1, $3, 'Maa ka message')`, [chat, tara.m, maa.m]);
  await admin.query(`insert into notes (circle_id, by_member, title, body, private) values ($1, $2, 'Tara private', 'x', true), ($1, $3, 'Maa private', 'y', true)`, [verma.id, tara.m, maa.m]);
  let r = await A(tara.token, { action: 'export_me' });
  const txt = JSON.stringify(r.json || {});
  ok('E15: Download my data: my profile, my families, what I wrote', r.ok && r.json.profile.name === 'Tara' && r.json.families.length === 2 && /Tara ka message/.test(txt) && /Tara private/.test(txt), txt.slice(0, 300));
  ok('E15: nothing written by someone else, and nobody else\'s private note', !/Maa ka message/.test(txt) && !/Maa private/.test(txt));
  ok('E15: no PIN, no hash, no session, no push address', !/pin_hash|pin_salt|token_hash|secret_hash|p256dh|device_hash/.test(txt) && !txt.includes(tara.pin + '"'));
  ok('E15: a readable page comes with it', /^<!doctype html>/.test(r.html) && /<h1>My Parwah data<\/h1>/.test(r.html) && /Tara ka message/.test(r.html) && !/[\u2013\u2014]/.test(r.html.replace(/Tara ka message/g, '')));
  ok('E15: the page cannot run anything a message says', !/<script/i.test(r.html));
  await A(tara.token, { action: 'export_me' }); await A(tara.token, { action: 'export_me' });
  r = await A(tara.token, { action: 'export_me' });
  ok('E15: three downloads a day', r.http === 429);
  ok('E15: it needs a session', (await A(null, { action: 'export_me' })).http === 401);

  // ---- delete my account. Tara is in two families (the Vermas, the Sharmas).
  r = await A(tara.token, { action: 'delete_me', pin: '0000' });
  ok('E15: deleting needs the PIN again: a wrong one is a wrong try', r.http === 401 && r.wrongPin === true && (await one('select delete_at from users where id = $1', [tara.id])).delete_at === null);
  r = await A(tara.token, { action: 'delete_me', pin: tara.pin });
  const at = (await one('select delete_at from users where id = $1', [tara.id])).delete_at;
  ok('E15: with the PIN, the account is set to be deleted in 7 days', r.ok && Math.abs((new Date(at) - Date.now()) / 86400000 - 7) < 0.01, JSON.stringify(r));
  ok('E15: nothing is deleted yet, and she can still sign in', (await rows('select 1 from members where user_id = $1', [tara.id])).length === 2 && (await enter(tara.phone, { pin: tara.pin })).ok === true);
  ok('E15: every screen is told when', (await enter(tara.phone, { refresh: true }, { token: tara.token })).security.deleteAt !== null);
  r = await A(tara.token, { action: 'delete_me_undo' });
  ok('E15: "Keep my account" stops it', r.ok && (await one('select delete_at from users where id = $1', [tara.id])).delete_at === null);
  await runTick(db(), 20000);
  ok('E15: and the timer leaves a kept account alone', !!(await one('select 1 as x from users where id = $1', [tara.id])));
  // For real this time, keeping what she shared.
  await A(tara.token, { action: 'delete_me', pin: tara.pin, removePosts: false });
  await admin.query(`update users set delete_at = now() - interval '1 minute' where id = $1`, [tara.id]);
  await runTick(db(), 20000);
  ok('E15: after 7 days the timer deletes the account', !(await one('select 1 as x from users where id = $1', [tara.id])));
  ok('E15: in both families', !(await one('select 1 as x from members where id = $1', [tara.m])) && (await rows(`select 1 from members m join circles c on c.id = m.circle_id where c.code = 'SHARMA24'`)).length === 1);
  ok('E15: her private note went with her', !(await one(`select 1 as x from notes where title = 'Tara private'`)));
  ok('E15: what she shared stays, with no name on it', !!(await one(`select 1 as x from messages where text = E'\u2063Tara ka message' and member_id is null`)));
  ok('E15: other people\'s things are untouched', !!(await one(`select 1 as x from notes where title = 'Maa private'`)) && !!(await one(`select 1 as x from messages where text = 'Maa ka message' and member_id = $1`, [maa.m])));
  ok('E15: her number is free again, and tells nobody it was ever used', (await enter(tara.phone)).needPin === true && (await enter(tara.phone, { pin: tara.pin })).http === 401);
  // "Remove my posts too".
  await admin.query(`insert into messages (chat_id, member_id, text) values ($1, $2, 'Chacha ka message')`, [chat, (await one(`select id from members where circle_id = $1 and name = 'Chacha'`, [verma.id])).id]);
  const chacha = { phone: '9850000040', pin: '4826' };
  const ct = (await enter(chacha.phone, { pin: chacha.pin })).token;
  await A(ct, { action: 'delete_me', pin: chacha.pin, removePosts: true });
  await admin.query(`update users set delete_at = now() - interval '1 minute' where phone = '+919850000040'`);
  r = await enter(chacha.phone, { pin: chacha.pin });
  ok('E15: a sign-in after the 7 days finds the account gone, even before the timer runs', r.http === 401 && !(await one(`select 1 as x from users where phone = '+919850000040'`)));
  ok('E15: and with "remove my posts", what he shared went too', !(await one(`select 1 as x from messages where text = 'Chacha ka message'`)));

  // ---- delete this family: every adult. The Vermas now: Papa, Maa, Rohan (adults), Aarav.
  r = await C(aarav.token, { action: 'family_delete_ask', code, memberId: aarav.m });
  ok('E15: a child cannot ask to delete the family', r.http === 403);
  r = await C(papa.token, { action: 'family_delete_ask', code, memberId: papa.m });
  ok('E15: one adult asking does not delete it', r.http === 202 && r.status === 'pending' && (await one('select delete_at from circles where id = $1', [verma.id])).delete_at === null, JSON.stringify(r));
  const askId = r.askId;
  let st = await state(maa, code, maa.m);
  ok('E15: the others see who is still to answer', st.asks.find(a => a.id === askId).waitingFor.sort().join() === 'Maa,Rohan', JSON.stringify(st.asks));
  r = await C(maa.token, { action: 'ask_vote', code, memberId: maa.m, askId, yes: true });
  ok('E15: two of three adults is not every adult', r.status === 'pending' && (await one('select delete_at from circles where id = $1', [verma.id])).delete_at === null);
  r = await C(rohan.token, { action: 'ask_vote', code, memberId: rohan.m, askId, yes: true });
  const dat = (await one('select delete_at from circles where id = $1', [verma.id])).delete_at;
  ok('E15: when every adult has said yes, it is set to be deleted in 7 days', r.status === 'done' && Math.abs((new Date(dat) - Date.now()) / 86400000 - 7) < 0.01, JSON.stringify(r));
  ok('E15: everyone, a child too, is shown the date', (await state(aarav, code, aarav.m)).deleteAt !== null);
  await runTick(db(), 20000);
  ok('E15: nothing is deleted before the 7 days', !!(await one('select 1 as x from circles where id = $1', [verma.id])));
  r = await C(aarav.token, { action: 'family_delete_undo', code, memberId: aarav.m });
  ok('E15: a child cannot stop it', r.http === 403);
  r = await C(maa.token, { action: 'family_delete_undo', code, memberId: maa.m });
  ok('E15: any adult can', r.ok && (await one('select delete_at from circles where id = $1', [verma.id])).delete_at === null);
  // One adult says no.
  r = await C(papa.token, { action: 'family_delete_ask', code, memberId: papa.m });
  r = await C(rohan.token, { action: 'ask_vote', code, memberId: rohan.m, askId: r.askId, yes: false });
  ok('E15: one adult saying no ends the request', r.status === 'declined' && (await one('select delete_at from circles where id = $1', [verma.id])).delete_at === null);
}

// ============================================================ THE PARENT WITH ONE CHEAP PHONE
{
  await forgetLimits(); await admin.query('delete from pin_locks');
  // Amma: one Android phone, no second device, nobody to press a button for her.
  const amma = await signUp('9850000050', 'Amma', '5936', { deviceId: DEV(50) });
  const beta = await signUp('9850000051', 'Beta', '7284');
  const fam = await makeFamily(amma, 'Iyer'); amma.m = fam.founderM;
  beta.m = await joinIn(fam, amma, beta, { dob: '1988-08-08' });
  // A stranger hammers her number all day.
  for (let i = 0; i < 12; i++) await enter('9850000050', { pin: '2' + (400 + i) });
  let r = await enter('9850000050', { pin: amma.pin, deviceId: DEV(50) });
  ok('one phone: a stranger guessing all day never locks her out of her own phone', r.ok && !!r.token, JSON.stringify(r).slice(0, 160));
  amma.token = r.token;
  // Her phone breaks. She signs in on a new one: no alert can reach the old
  // phone, and nothing waits for it.
  await admin.query('delete from pin_locks');
  await A(amma.token, { action: 'signout_all', token: amma.token });
  r = await enter('9850000050', { pin: amma.pin, deviceId: DEV(51) });
  ok('one phone: a new phone, with the old one gone, is let straight in', r.ok && !!r.token);
  ok('one phone: and no alert is raised that nobody could answer', !(await one(`select 1 as x from account_alerts where user_id = $1 and status = 'open'`, [amma.id])));
  amma.token = r.token;
  // She forgets her PIN while signed out everywhere.
  await A(amma.token, { action: 'signout_all', token: amma.token });
  await forgetLimits();
  r = await A(null, { action: 'reset_request', phone: '9850000050', cc: '+91' });
  const rs = await one(`select id, veto_until from pin_resets where user_id = $1 and status = 'pending'`, [amma.id]);
  ok('one phone: with no phone signed in, there is no ten-minute wait', rs.veto_until === null);
  const a = await A(beta.token, { action: 'reset_approve', resetId: rs.id, sayCode: r.sayCode });
  const inn = await enter('9850000050', { resetSecret: r.resetSecret, newPin: '6047', deviceId: DEV(51) });
  ok('one phone: her son says yes with the two numbers she reads out, and she is in', a.ok && inn.ok && !!inn.token);
  amma.token = inn.token; amma.pin = '6047';
  // A family with a single adult, from the child's side: see below.
  globalThis.__iyer = { fam, amma, beta };
}

// ============================================================ THE PERSON IN TWO FAMILIES
{
  await forgetLimits();
  // Priya: a daughter in her parents' family, a daughter-in-law in her husband's.
  const priya = await signUp('9850000060', 'Priya', '5936');
  const { fam: iyer, amma } = globalThis.__iyer;
  const pm1 = await joinIn(iyer, amma, priya);                                    // nothing written about her age
  const sas = await signUp('9850000061', 'Sasu ji', '7284');
  const rao = await makeFamily(sas, 'Rao'); sas.m = rao.founderM;
  const pm2 = await joinIn(rao, sas, priya, { relation: 'daughter-in-law' });
  ok('two families: one account, two memberships', (await enter(priya.phone, { refresh: true }, { token: priya.token })).circles.length === 2);
  ok('two families: a daughter-in-law is a known grown-up in one', (await state(priya, rao.code, pm2)).me.standing === 'adult');
  ok('two families: and "not known yet" in the other, where nobody wrote her age', (await state(priya, iyer.code, pm1)).me.standing === 'unsure');
  // Her date of birth, written once, follows her to both.
  await C(priya.token, { action: 'update_member', code: rao.code, memberId: pm2, dob: '1991-01-01' });
  ok('two families: her date of birth, written once, settles it in both', (await state(priya, iyer.code, pm1)).me.standing === 'adult');
  // Her privacy choice is per family.
  await C(priya.token, { action: 'privacy_set', code: rao.code, memberId: pm2, seePhone: 'me' });
  ok('two families: hiding her phone in one does not hide it in the other', (await feedOf(amma, iyer.code, amma.m)).members.find(m => m.id === pm1).phone === '+919850000060'
    && (await feedOf(sas, rao.code, sas.m)).members.find(m => m.id === pm2).phone === null);
  // Removed from one family, she keeps the other and her account.
  let r = await C(sas.token, { action: 'remove_ask', code: rao.code, memberId: sas.m, targetId: pm2 });
  ok('two families: with two adults there, one cannot put the other out', r.http === 409 && /one cannot remove the other/.test(r.error), JSON.stringify(r));
  // Sign out everywhere is one account, both families.
  const t2 = (await enter(priya.phone, { pin: priya.pin })).token;
  await A(priya.token, { action: 'signout_all', token: priya.token });
  ok('two families: "sign out everywhere" ends her sessions in both', (await feedOf({ token: t2 }, iyer.code, pm1)).http === 401 && (await feedOf({ token: t2 }, rao.code, pm2)).http === 401);
  priya.token = (await enter(priya.phone, { pin: priya.pin })).token;
  // Either family's grown-ups can let her back in; a reset is one request.
  await forgetLimits();
  r = await A(null, { action: 'reset_request', phone: priya.phone, cc: '+91' });
  ok('two families: a forgotten PIN is one request, and reaches a grown-up in each', (await rows(`select 1 from pin_resets where user_id = $1 and status = 'pending'`, [priya.id])).length === 1
    && ((await enter(amma.phone, { refresh: true }, { token: amma.token })).pinResets || []).length === 1
    && ((await enter(sas.phone, { refresh: true }, { token: sas.token })).pinResets || []).length === 1);
  await A(priya.token, { action: 'reset_veto', resetId: (await one(`select id from pin_resets where user_id = $1 and status = 'pending'`, [priya.id])).id });
  // Leaving one family by deleting the account: the family with others in
  // it stays; one where she was the only person goes.
  const solo = await makeFamily(priya, 'Just me');
  await A(priya.token, { action: 'delete_me', pin: priya.pin });
  await admin.query(`update users set delete_at = now() - interval '1 minute' where id = $1`, [priya.id]);
  await runTick(db(), 20000);
  ok('two families: deleting her account leaves both families standing', !!(await one('select 1 as x from circles where id = $1', [iyer.id])) && !!(await one('select 1 as x from circles where id = $1', [rao.id])));
  ok('two families: and takes a family that held only her', !(await one('select 1 as x from circles where id = $1', [solo.id])));
}

// ============================================================ THE FAMILY WITH A SINGLE ADULT
{
  await forgetLimits();
  // Meena and her two children. Nobody else to give a second yes.
  const meena = await signUp('9850000070', 'Meena', '5936');
  const kid = await signUp('9850000071', 'Chintu', '7284'), teen = await signUp('9850000072', 'Pinky', '6193');
  const fam = await makeFamily(meena, 'Joshi'); meena.m = fam.founderM;
  kid.m = await joinIn(fam, meena, kid, { dob: '2015-06-06' });
  teen.m = await joinIn(fam, meena, teen, { dob: '2010-06-06' });
  ok('single adult: the family has one grown-up', (await state(meena, fam.code, meena.m)).adults === 1);
  let r = await C(meena.token, { action: 'set_join_policy', code: fam.code, memberId: meena.m, policy: 'open' });
  ok('single adult: she opens the door alone, with nobody to wait for', r.http === 200 && r.joinPolicy === 'open' && !r.pending, JSON.stringify(r));
  await C(meena.token, { action: 'set_join_policy', code: fam.code, memberId: meena.m, policy: 'approve' });
  r = await C(teen.token, { action: 'set_join_policy', code: fam.code, memberId: teen.m, policy: 'open' });
  ok('single adult: her teenager still cannot', r.http === 403);
  // A stranger her child let slip the code to.
  const odd = await signUp('9850000073', 'Odd One', '4826');
  const j = await C(odd.token, { action: 'join', code: fam.code, memberName: 'Odd One' });
  ok('single adult: only she is asked to let someone in', (await C(teen.token, { action: 'approve_join', code: fam.code, memberId: teen.m, requestId: j.requestId })).http === 403);
  const a = await C(meena.token, { action: 'approve_join', code: fam.code, memberId: meena.m, requestId: j.requestId });
  await admin.query(`update members set dob = '2012-01-01' where id = $1`, [a.memberId]);
  r = await C(meena.token, { action: 'remove_ask', code: fam.code, memberId: meena.m, targetId: a.memberId });
  ok('single adult: she can remove a child alone, with nobody to wait for', r.ok && r.removed === a.memberId && !(await one('select 1 as x from members where id = $1', [a.memberId])), JSON.stringify(r));
  // Her PIN: nobody in the family can let her back in, so the recovery
  // contact matters. Without one, the request reaches nobody and says so
  // in the same words as any other.
  r = await A(null, { action: 'reset_request', phone: meena.phone, cc: '+91' });
  ok('single adult: her children cannot let her back in', !(await one(`select 1 as x from pin_resets where user_id = $1`, [meena.id])) && r.asked === true);
  // She names her sister, who is in a group of friends with her.
  const didi = await signUp('9850000074', 'Didi', '4826');
  const g = await C(meena.token, { action: 'create', kind: 'group', memberName: 'Meena', circleName: 'Sisters' });
  await C(meena.token, { action: 'set_join_policy', code: g.code, memberId: g.memberId, policy: 'open' });
  await C(didi.token, { action: 'join', code: g.code, memberName: 'Didi' });
  r = await A(meena.token, { action: 'recovery_set', contactUserId: didi.id });
  ok('single adult: she names her sister as her recovery contact', r.ok);
  r = await A(meena.token, { action: 'recovery_set', contactUserId: kid.id });
  ok('single adult: a child cannot be the recovery contact', r.http === 400 && /grown-up/.test(r.error));
  await forgetLimits();
  r = await A(null, { action: 'reset_request', phone: meena.phone, cc: '+91' });
  const rs = await one(`select id from pin_resets where user_id = $1 and status = 'pending'`, [meena.id]);
  const ap = rs ? await A(didi.token, { action: 'reset_approve', resetId: rs.id, sayCode: r.sayCode }) : {};
  ok('single adult: and now her sister can let her back in', !!rs && ap.ok && ap.status === 'approved', JSON.stringify(ap));
  // Deleting the family is hers alone, and still waits 7 days.
  r = await C(meena.token, { action: 'family_delete_ask', code: fam.code, memberId: meena.m });
  ok('single adult: she alone is "every adult": the 7 days start at once', r.status === 'done' && !!r.deleteAt, JSON.stringify(r));
  await admin.query(`update circles set delete_at = now() - interval '1 minute' where id = $1`, [fam.id]);
  await runTick(db(), 20000);
  ok('single adult: after 7 days the timer deletes the family', !(await one('select 1 as x from circles where id = $1', [fam.id])));
  ok('single adult: and everything in it', !(await one('select 1 as x from members where id = $1', [kid.m])));
  ok('single adult: her account, and her other circle, are untouched', (await enter(meena.phone, { refresh: true }, { token: meena.token })).circles.length === 1);
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`standing.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
