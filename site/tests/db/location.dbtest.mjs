// LOCATION SHARING AGAINST A REAL DATABASE: the real handler behind
// /api/settings?area=location, the real schema and SQL.
//
// What it proves:
//   - only the person themselves can turn sharing on; nobody can do it for them;
//   - the family sees exactly who is sharing; nobody outside the circle sees
//     anything; sharing in the family does not share in another group;
//   - "area only" never stores the exact position, from the start or after
//     switching;
//   - stopping deletes the position;
//   - starting and stopping are told to the circle.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('location.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('location.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: settings } = await import('../../../api/settings.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

let n = 0;
async function user(name) {
  const phone = '+9198400' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token };
}
async function seat(circleId, code, u) {
  const m = (await admin.query(`insert into members (circle_id, name, user_id) values ($1,$2,$3) returning id`, [circleId, u.name, u.userId])).rows[0];
  return { id: m.id, name: u.name, token: u.token, code };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const grp = (await admin.query(`insert into circles (code, name, kind) values ('COUSIN','Cousins','group') returning id`)).rows[0].id;
const U = { rohan: await user('Rohan'), meera: await user('Meera'), vikram: await user('Vikram') };
const rohan = await seat(fam, 'SHARMA', U.rohan), meera = await seat(fam, 'SHARMA', U.meera);
const rohanG = await seat(grp, 'COUSIN', U.rohan), vikramG = await seat(grp, 'COUSIN', U.vikram);

async function call(who, { method = 'POST', body = {}, token } = {}) {
  const req = { method, headers: { 'x-parwah-token': token || who.token },
                query: { area: 'location', circle: who.code, member: who.id },
                body: { code: who.code, memberId: who.id, ...body } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await settings(req, res);
  return { ...json, status };
}
const look = (who) => call(who, { method: 'GET' });
const row = async (m) => (await admin.query('select * from location_shares where member_id = $1', [m.id])).rows[0];
const PUNE = { lat: 18.520430, lng: 73.856743, accuracy: 12 };

// ---- nothing shared to begin with
{
  const r = await look(meera);
  ok('at first nobody is sharing', r.ok && r.shares.length === 0 && r.me.sharing === false);
  ok('an update before sharing is refused', (await call(rohan, { body: { action: 'update', ...PUNE } })).status === 409);
  ok('a position off the map is refused', (await call(rohan, { body: { action: 'share', lat: 95, lng: 10 } })).status === 400);
}

// ---- Rohan shares with the family
{
  const r = await call(rohan, { body: { action: 'share', ...PUNE, precision: 'exact' } });
  ok('Rohan turns sharing on', r.status === 200 && r.sharing === true);
  const m = await look(meera);
  const s = m.shares.find(x => x.name === 'Rohan');
  ok('Meera sees Rohan, exactly where he is', s && Math.abs(s.lat - PUNE.lat) < 1e-6 && s.accuracy === 12 && s.precision === 'exact');
  ok('and when it was updated', s && !!s.updatedAt && s.stale === false);
  const mine = await look(rohan);
  ok('Rohan sees that he is sharing, and his own row', mine.me.sharing === true && mine.shares.some(x => x.mine));
  const ev = (await admin.query(`select text from events where circle_id = $1 and type = 'location'`, [fam])).rows;
  ok('the family is told Rohan is sharing', ev.some(e => /Rohan is sharing their location with the family/.test(e.text)), JSON.stringify(ev));
  const upd = await call(rohan, { body: { action: 'update', lat: 18.53, lng: 73.86, accuracy: 20 } });
  ok('while sharing, a new position replaces the old', upd.status === 200 && Math.abs((await row(rohan)).lat - 18.53) < 1e-9);
  ok('an update is not announced again', (await admin.query(`select count(*)::int as n from events where circle_id = $1 and type = 'location'`, [fam])).rows[0].n === 1);
}

// ---- nobody else can switch it on, or see in
{
  const r = await call({ ...meera, token: U.rohan.token }, { body: { action: 'share', ...PUNE } });
  ok('Rohan cannot turn on sharing for Meera', r.status === 403 && !(await row(meera)));
  const v = await call({ ...vikramG, code: 'SHARMA' }, { method: 'GET' });
  ok('someone outside the family sees nothing', v.status === 403 && !v.shares);
  const g = await look(vikramG);
  ok('sharing in the family is not sharing in the Cousins group', g.ok && g.shares.length === 0);
  const rg = await look(rohanG);
  ok('Rohan in the Cousins group is not sharing there', rg.me.sharing === false);
}

// ---- area only
{
  await call(meera, { body: { action: 'share', ...PUNE, precision: 'area' } });
  const m = await row(meera);
  ok('area only from the start: the exact position is never stored', Math.abs(m.lat - PUNE.lat) > 1e-4 || Math.abs(m.lng - PUNE.lng) > 1e-4);
  ok('and the stored point is at most about a kilometre off, marked 1.1 km', m.accuracy === 1100);
  await call(rohan, { body: { action: 'precision', precision: 'area' } });
  const r = await row(rohan);
  ok('switching to area only coarsens what is stored now (18.53, 73.86 -> 18.535, 73.865)', r.precision === 'area' && r.accuracy === 1100 && r.lat === 18.535 && r.lng === 73.865, r.lat + ',' + r.lng);
  await call(rohan, { body: { action: 'update', lat: 18.531234, lng: 73.861234, accuracy: 8 } });
  const r2 = await row(rohan);
  ok('and later updates stay area only', r2.accuracy === 1100 && String(r2.lat).split('.')[1].length <= 4);
  await call(rohanG, { body: { action: 'share', ...PUNE, precision: 'exact' } });
  const g = await look(vikramG);
  ok('in the group, the group wording is used and Vikram now sees Rohan', g.shares.length === 1 &&
     (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like '%with the group%'`, [grp])).rows[0].n === 1);
}

// ---- stop deletes
{
  const r = await call(rohan, { body: { action: 'stop' } });
  ok('Rohan stops', r.status === 200 && r.sharing === false);
  const s = await row(rohan);
  ok('and his position is deleted, not hidden', s.enabled === false && s.lat === null && s.lng === null && s.accuracy === null && s.updated_at === null);
  const m = await look(meera);
  ok('Meera no longer sees him', !m.shares.some(x => x.name === 'Rohan'));
  ok('the family is told he stopped', (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like 'Rohan stopped sharing%'`, [fam])).rows[0].n === 1);
  const g = await look(vikramG);
  ok('stopping in the family leaves his choice in the group alone', g.shares.length === 1);
  ok('after stopping, updates are refused again', (await call(rohan, { body: { action: 'update', ...PUNE } })).status === 409);
  const left = (await admin.query(`select count(*)::int as n from location_shares where not enabled and lat is not null`)).rows[0].n;
  ok('no stopped share anywhere still holds a position', left === 0);
}

// ---- a position already on its way when Stop lands must not restart sharing
// The phone checks "still sharing?", then Stop is tapped and lands, then the
// position write runs. Replayed exactly: Stop is made to land between the
// check and the write.
{
  await call(meera, { body: { action: 'share', ...PUNE, precision: 'exact' } });
  const pool = globalThis.__parwahPools[0], real = pool.query.bind(pool);
  let armed = true;
  pool.query = async (text, params) => {
    if (armed && /^\s*(insert into location_shares|update location_shares set lat)/.test(text)) {
      armed = false;
      await admin.query('update location_shares set enabled = false, lat = null, lng = null, accuracy = null, updated_at = null, enabled_at = null where member_id = $1', [meera.id]);
    }
    return real(text, params);
  };
  const r = await call(meera, { body: { action: 'update', lat: 18.6, lng: 73.9, accuracy: 10 } });
  pool.query = real;
  const m = await row(meera);
  ok('the late position is refused', r.status === 409 && armed === false, r.status);
  ok('and sharing stays off, with nothing stored', m.enabled === false && m.lat === null && m.lng === null, JSON.stringify(m));
  ok('nobody sees Meera', !(await look(rohan)).shares.some(x => x.name === 'Meera'));
}

// ---- a precision switch that races an update never stores exact under "area"
{
  await call(meera, { body: { action: 'share', ...PUNE, precision: 'exact' } });
  const pool = globalThis.__parwahPools[0], real = pool.query.bind(pool);
  let armed = true;
  pool.query = async (text, params) => {
    if (armed && /^\s*update location_shares set lat/.test(text)) {
      armed = false;
      await call(meera, { body: { action: 'precision', precision: 'area' } });
    }
    return real(text, params);
  };
  const r = await call(meera, { body: { action: 'update', lat: 18.612345, lng: 73.912345, accuracy: 5 } });
  pool.query = real;
  const m = await row(meera);
  ok('an exact position that arrives after switching to area only is refused', r.status === 409 && armed === false, r.status);
  ok('and what is stored is still the area', m.precision === 'area' && m.accuracy === 1100 && String(m.lat).split('.')[1].length <= 4, JSON.stringify(m));
  ok('stopping or switching after the fact is refused cleanly too',
     (await call(meera, { body: { action: 'stop' } })).status === 200 &&
     (await call(meera, { body: { action: 'precision', precision: 'exact' } })).status === 409);
}

// ---- sharing for a set time ends by itself, and deletes the position
{
  await call(rohan, { body: { action: 'stop' } });
  ok('an end time under 5 minutes away is refused', (await call(rohan, { body: { action: 'share', ...PUNE, until: new Date(Date.now() + 60000).toISOString() } })).status === 400);
  const until = new Date(Date.now() + 3600000).toISOString();
  const r = await call(rohan, { body: { action: 'share', ...PUNE, until } });
  ok('Rohan shares for an hour', r.status === 200 && r.sharing === true);
  const m = await look(meera);
  const s = m.shares.find(x => x.name === 'Rohan');
  ok('Meera sees when his sharing ends', s && +new Date(s.until) === Date.parse(until), JSON.stringify(s));
  ok('and so does he', +new Date((await look(rohan)).me.until) === Date.parse(until));
  // The hour passes.
  await admin.query(`update location_shares set expires_at = now() - interval '1 second' where member_id = $1`, [rohan.id]);
  const after = await look(meera);
  ok('when the time is up, Meera no longer sees him', !after.shares.some(x => x.name === 'Rohan'));
  const gone = await row(rohan);
  ok('and his position is deleted, as if he had tapped Stop', gone.enabled === false && gone.lat === null && gone.lng === null && gone.expires_at === null, JSON.stringify(gone));
  ok('the family is told it ended, as he chose', (await admin.query(`select count(*)::int as n from events where type = 'location' and text like 'Rohan''s location sharing ended%'`)).rows[0].n === 1);
  ok('a position still on its way afterwards is refused', (await call(rohan, { body: { action: 'update', ...PUNE } })).status === 409);
  ok('his own screen says he is not sharing', (await look(rohan)).me.sharing === false);
  // Sharing again with no end time lasts until he stops.
  await call(rohan, { body: { action: 'share', ...PUNE } });
  ok('sharing again with no end time has none', (await row(rohan)).expires_at === null && (await look(rohan)).me.until === null);
  await call(rohan, { body: { action: 'stop' } });
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`location.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`location.dbtest: ${pass}/${pass} checks pass`);
