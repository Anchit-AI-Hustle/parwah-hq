// FIND A PHONE AGAINST A REAL DATABASE: ringing a phone and Lost mode,
// through the real handlers behind /api/settings?area=location and
// /api/events, the real schema and SQL.
//
// What it proves:
//   - anyone in the family rings anyone on Parwah, their own phone too; only
//     that person's phones hear it; once a minute; "I found it" stops it;
//     it stops by itself after two minutes; nobody outside can ring;
//   - only the person turns Lost mode on, for themselves; every other phone
//     signed in as them shows it, the one they used does not; the finder is
//     shown the message and someone to call;
//   - while lost, sharing cannot be stopped, blurred or time-limited;
//   - only their own PIN turns it off, with the same five tries as signing
//     in, and the lock holds for sign-in too.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('findme.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('findme.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: settings } = await import('../../../api/settings.mjs');
const { default: events } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { lostMessage, LOST_MSG_MAX } = await import('../../../api/_findme.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

let n = 0;
async function session(userId) {
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), userId]);
  return token;
}
async function user(name, phone) {
  const p = phone || '+9198500' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6) returning id`, [p, p.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  return { userId: u.id, name, phone: p, token: await session(u.id) };
}
async function seat(circleId, code, u) {
  const m = (await admin.query(`insert into members (circle_id, name, user_id, phone) values ($1,$2,$3,$4) returning id`, [circleId, u.name, u.userId, u.phone])).rows[0];
  return { id: m.id, name: u.name, token: u.token, code, userId: u.userId };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const other = (await admin.query(`insert into circles (code, name) values ('VERMA','Verma Family') returning id`)).rows[0].id;
const U = { papa: await user('Papa'), rohan: await user('Rohan'), meera: await user('Meera'), stranger: await user('Stranger') };
const papa = await seat(fam, 'SHARMA', U.papa), rohan = await seat(fam, 'SHARMA', U.rohan), meera = await seat(fam, 'SHARMA', U.meera);
const stranger = await seat(other, 'VERMA', U.stranger);
const dadi = (await admin.query(`insert into members (circle_id, name) values ($1,'Dadi') returning id`, [fam])).rows[0];
// Papa's second phone: the one he will lose.
const papaPhone2 = { ...papa, token: await session(papa.userId) };

async function loc(who, body, method = 'POST') {
  const req = { method, headers: { 'x-parwah-token': who.token },
                query: { area: 'location', circle: who.code, member: who.id },
                body: { code: who.code, memberId: who.id, ...body } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await settings(req, res);
  return { ...json, status };
}
async function find(who) {
  const req = { method: 'GET', headers: { 'x-parwah-token': who.token }, query: { circle: who.code, member: who.id }, body: {} };
  let json = null;
  const res = { status() { return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await events(req, res);
  return json.findme;
}
const PUNE = { lat: 18.520430, lng: 73.856743, accuracy: 12 };

// ---- ringing
{
  const r = await loc(rohan, { action: 'ring', targetId: papa.id });
  ok('Rohan rings Papa\'s phone', r.status === 200 && r.rang === 'Papa' && r.seconds === 120, JSON.stringify(r));
  const p = await find(papa), p2 = await find(papaPhone2), m = await find(meera);
  ok('both of Papa\'s phones hear it, and who is looking', p.ring && p.ring.by === 'Rohan' && p2.ring && p2.ring.by === 'Rohan', JSON.stringify(p));
  ok('nobody else\'s phone rings', !m.ring);
  ok('ringing again within a minute is refused', (await loc(rohan, { action: 'ring', targetId: papa.id })).status === 429);
  ok('someone else may ring it meanwhile', (await loc(meera, { action: 'ring', targetId: papa.id })).status === 200);
  ok('Dadi is not on Parwah, so her phone cannot ring', (await loc(rohan, { action: 'ring', targetId: dadi.id })).status === 400);
  ok('nobody outside the family can ring Papa', (await loc(stranger, { action: 'ring', targetId: papa.id })).status === 404);
  ok('nor make up a target', (await loc(rohan, { action: 'ring', targetId: 'not-a-uuid' })).status === 404);
  const ev = (await admin.query(`select text from events where circle_id = $1 and type = 'location' order by created_at`, [fam])).rows.map(x => x.text);
  ok('the family can see who rang whom', ev.some(t => /Rohan rang Papa's phone/.test(t)));
  ok('"I found it" stops it, on every phone of his', (await loc(papaPhone2, { action: 'found' })).status === 200 && !(await find(papa)).ring);
  ok('you can ring your own phone', (await loc(meera, { action: 'ring', targetId: meera.id })).status === 200 && !!(await find(meera)).ring);
  await admin.query(`update find_ring set rang_at = now() - interval '121 seconds' where member_id = $1`, [meera.id]);
  ok('it stops ringing by itself after two minutes', !(await find(meera)).ring);
}

// ---- Lost mode
{
  ok('the message is checked: too long is refused', (await loc(papa, { action: 'lost_on', message: 'x'.repeat(LOST_MSG_MAX + 1) })).status === 400);
  ok('an empty message becomes a plain one', /call my family/.test(lostMessage('  ').text));
  ok('control characters never reach the screen', lostMessage('call\u0000 me').text === 'call me');
  ok('the person to call must be in the family with a number', (await loc(papa, { action: 'lost_on', callId: stranger.id })).status === 400);
  ok('Dadi has no number, so she cannot be the one to call', (await loc(papa, { action: 'lost_on', callId: dadi.id })).status === 400);
  await loc(papaPhone2, { action: 'share', ...PUNE, precision: 'exact' });
  const r = await loc(papa, { action: 'lost_on', message: 'Please call my son', callId: rohan.id });
  ok('Papa turns Lost mode on, from the phone in his hand', r.status === 200 && r.lost === true, JSON.stringify(r));
  const here = await find(papa), lost = await find(papaPhone2);
  ok('the phone he used is not locked', !here.lost && here.lostHere === true);
  ok('his other phone shows Lost mode, his message, and Rohan to call',
     lost.lost && lost.lost.message === 'Please call my son' && lost.lost.call && lost.lost.call.name === 'Rohan' && lost.lost.call.phone === U.rohan.phone,
     JSON.stringify(lost));
  ok('the family sees that Papa has Lost mode on', (await find(meera)).lostMembers.includes(papa.id) && !(await find(meera)).lost);
  ok('nobody outside the family does', !(await find(stranger)).lostMembers.includes(papa.id));
  ok('a finder cannot stop the sharing', (await loc(papaPhone2, { action: 'stop' })).status === 423);
  ok('nor blur it to the area', (await loc(papaPhone2, { action: 'precision', precision: 'area' })).status === 423);
  ok('nor give it an end time', (await loc(papaPhone2, { action: 'share', ...PUNE, until: new Date(Date.now() + 3600000).toISOString() })).status === 423);
  ok('the lost phone keeps sending where it is', (await loc(papaPhone2, { action: 'update', ...PUNE })).status === 200);
  ok('and the location read says it is held', (await loc(papaPhone2, {}, 'GET')).me.lostLock === true);
  ok('Rohan cannot turn Papa\'s Lost mode off: only Papa\'s own PIN does', (await loc(rohan, { action: 'lost_off', pin: '4819' })).lost === false
     && !!(await find(papaPhone2)).lost);
  ok('a PIN must be 4 digits', (await loc(papaPhone2, { action: 'lost_off', pin: '48' })).status === 400);
  const w = await loc(papaPhone2, { action: 'lost_off', pin: '0000' });
  ok('a wrong PIN is refused and counted', w.status === 401 && w.left === 4, JSON.stringify(w));
  const rt = await loc(papaPhone2, { action: 'lost_off', pin: '4819' });
  ok('his own PIN turns it off', rt.status === 200 && rt.lost === false && !(await find(papaPhone2)).lost && !(await find(meera)).lostMembers.length);
  ok('and sharing is his to stop again', (await loc(papaPhone2, { action: 'stop' })).status === 200);
  const ev = (await admin.query(`select text from events where circle_id = $1 and type = 'location' order by created_at`, [fam])).rows.map(x => x.text);
  ok('the family is told when it goes on and off', ev.some(t => /Papa marked their phone as lost/.test(t)) && ev.some(t => /Papa found their phone/.test(t)));
}

// ---- five wrong PINs lock it, the same lock as signing in
{
  await loc(papa, { action: 'lost_on' });
  let last;
  for (let i = 0; i < 5; i++) last = await loc(papaPhone2, { action: 'lost_off', pin: '1111' });
  ok('the fifth wrong PIN locks it', last.status === 429 && last.locked === true, JSON.stringify(last));
  ok('then even the right PIN waits', (await loc(papaPhone2, { action: 'lost_off', pin: '4819' })).status === 429 && !!(await find(papaPhone2)).lost);
  const u = (await admin.query('select locked_until from users where id = $1', [papa.userId])).rows[0];
  ok('the lock is the sign-in lock, so a finder cannot try PINs there instead', u.locked_until && new Date(u.locked_until) > new Date());
  await admin.query('update users set locked_until = null, pin_tries = 0 where id = $1', [papa.userId]);
  ok('after the wait, his PIN works', (await loc(papaPhone2, { action: 'lost_off', pin: '4819' })).status === 200);
}

for (const p of globalThis.__parwahPools || []) await p.end();
await admin.end();
if (fails.length) { for (const f of fails) console.log('FAIL  ' + f); console.error(`findme.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`findme.dbtest: ${pass}/${pass} checks pass`);
