// THE TIMER RINGS FOR EVERYONE - against a real database.
//
// GitHub's scheduled timer starts hours late on a free account, so the
// alerts that matter when nobody in that family has Parwah open (a missed
// check-in, a late attendant, a renewal coming up) must not wait for it.
// What this proves, with the real api/events.mjs handler:
//   - the first signed-in poll of a minute, from ANY family, runs the whole
//     timer: another family's missed check-in is sent from it;
//   - only once a minute, whoever polls;
//   - the timer now covers the home staff and renewal alerts too;
//   - each alert is still claimed once, however often the timer runs;
//   - the tick reply keeps its counts-only shape.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_test npm run test:db
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('timer.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('timer.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.CRON_SECRET;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: events } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { ensureTaskSchema } = await import('../../../api/_tasks.mjs');
const { ensureFamilyCareSchema } = await import('../../../api/_familycare.mjs');
const { ensureStaffSchema } = await import('../../../api/_staff.mjs');
const { ensureRenewalSchema } = await import('../../../api/_renewals.mjs');
const { default: plansH } = await import('../../../api/plans.mjs');

const sql = db();
await ensureSchema(sql);
await ensureTaskSchema(sql);
await ensureFamilyCareSchema(sql);
await ensureStaffSchema(sql);
await ensureRenewalSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

// The alerts keep waking hours on the family's own clock, so the test picks
// a zone where it is daytime now: the same checks hold at any hour CI runs.
const hourIn = tz => +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()) % 24;
const TZ = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland', 'Asia/Dubai', 'America/Sao_Paulo']
  .find(tz => { const h = hourIn(tz); return h >= 10 && h <= 18; }) || 'Asia/Kolkata';
const local = (minsAgo) => {
  const d = new Date(Date.now() - minsAgo * 60000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return { hhmm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, mins: (+p.hour % 24) * 60 + +p.minute };
};
const nowLocal = local(0).mins;

let n = 0;
async function person(circleId, name, role = 'family') {
  const phone = '+9198410' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1, '+91', $2, $3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id, phone) values ($1, $2, $3, $4, $5) returning id`, [circleId, name, role, u.id, phone])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, token, circleId };
}
const sharma = (await admin.query(`insert into circles (code, name) values ('SHARMA', 'Sharma Family') returning id`)).rows[0].id;
const verma = (await admin.query(`insert into circles (code, name) values ('VERMA1', 'Verma Family') returning id`)).rows[0].id;
const CODE = { [sharma]: 'SHARMA', [verma]: 'VERMA1' };
const papa = await person(sharma, 'Papa', 'parent');
await person(sharma, 'Rohan');
const vikram = await person(verma, 'Vikram');

async function call(req) {
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await events(req, res);
  return { ...json, http: status };
}
const poll = who => call({ method: 'GET', headers: { 'x-parwah-token': who.token, 'x-forwarded-for': '10.9.0.' + (++n), 'x-parwah-tz': TZ },
                            query: { circle: CODE[who.circleId], member: who.id }, body: {} });
const tick = () => call({ method: 'GET', headers: { 'x-forwarded-for': '10.9.1.' + (++n) }, query: { tick: '1' }, body: {} });
const freshMinute = () => admin.query(`delete from rate_limit where bucket = 'tick'`);
const quietRow = async () => (await admin.query(`select to_char(quiet_nudged_for,'YYYY-MM-DD') nudged, to_char(quiet_alerted_for,'YYYY-MM-DD') alerted from members where id = $1`, [papa.id])).rows[0];

// ---- 1. Another family's poll sends Papa's missed check-in
{
  // Papa chose 9:00-ish; it is now 40 minutes past his time and he has not
  // said he is okay. Nobody in the Sharma family has Parwah open.
  await admin.query(`update members set checkin_by = $2, tz = $3 where id = $1`, [papa.id, local(40).hhmm, TZ]);
  await freshMinute();
  const r = await poll(vikram);
  ok('the Verma family\'s poll still answers its own family', r.http === 200 && r.ok, JSON.stringify(r).slice(0, 200));
  const q = await quietRow();
  ok('and it sent the Sharma family\'s missed check-in on the way', !!(q.nudged || q.alerted), JSON.stringify(q));
}

// ---- 2. Only once a minute, whoever polls
{
  await admin.query(`update members set quiet_nudged_for = null, quiet_alerted_for = null where id = $1`, [papa.id]);
  await poll(vikram); await poll(vikram);
  const q = await quietRow();
  ok('a second poll in the same minute does not run the timer again', !q.nudged && !q.alerted, JSON.stringify(q));
  const rl = (await admin.query(`select n from rate_limit where bucket = 'tick' and k = 'all'`)).rows[0];
  ok('the minute is counted in one shared bucket', rl && rl.n >= 3, JSON.stringify(rl));
}

// ---- 3. The scheduled tick covers home staff and renewals now
{
  // An attendant expected 90 minutes ago, not marked in, on every weekday.
  const lateOk = nowLocal >= 90;
  const st = (await admin.query(`insert into home_staff (circle_id, name, role, arrive_time, work_days, tz) values ($1, 'Sunita', 'attendant', $2, '0123456', $3) returning id`,
    [sharma, local(90).hhmm, TZ])).rows[0];
  // A policy that runs out in a week.
  const rn = (await admin.query(`insert into renewals (circle_id, kind, label, expires_on) values ($1, 'health_insurance', 'Papa health policy', current_date + 7) returning id`, [sharma])).rows[0];
  await freshMinute();
  const t = await tick();
  ok('the tick answers with counts only, as before', t.http === 200 && t.ok && ['circles', 'reminded', 'late', 'events'].every(k => typeof t[k] === 'number')
     && Object.keys(t).sort().join() === ['circles', 'events', 'http', 'late', 'ok', 'reminded'].sort().join(), JSON.stringify(t));
  ok('it looked at the family with staff and a renewal', t.circles >= 1, JSON.stringify(t));
  const ra = (await admin.query(`select count(*)::int c from renewal_alerts where ref_id = $1`, [rn.id])).rows[0].c;
  ok('the renewal reminder went out from the timer', ra >= 1, String(ra));
  if (lateOk) {
    const sa = (await admin.query(`select count(*)::int c from staff_late_alert where staff_id = $1`, [st.id])).rows[0].c;
    ok('the late attendant alert went out from the timer', sa === 1, String(sa));
  } else ok('the late attendant alert (skipped: too close to midnight in India to place it)', true);
  // Again, a minute later: nothing is sent twice.
  await freshMinute();
  await tick();
  const ra2 = (await admin.query(`select count(*)::int c from renewal_alerts where ref_id = $1 and stage = 7`, [rn.id])).rows[0].c;
  ok('running the timer again sends nothing twice', ra2 === 1, String(ra2));
  if (lateOk) {
    const sa2 = (await admin.query(`select count(*)::int c from staff_late_alert where staff_id = $1`, [st.id])).rows[0].c;
    ok('and the attendant alert stays one', sa2 === 1, String(sa2));
  }
}

// ---- 4. A tick inside the same minute is skipped, not repeated
{
  await freshMinute();
  const a = await tick(), b = await tick();
  ok('a second tick in the same minute is skipped', a.ok && !a.skipped && b.ok && b.skipped === true, JSON.stringify([a, b]));
}

// ---- 5. A birthday card is started from the timer, with every phone closed
{
  // The plans tables exist once anyone has opened Plans (as in production).
  await plansH({ method: 'GET', headers: { 'x-parwah-token': papa.token, 'x-forwarded-for': '10.9.2.1' }, query: { circle: 'SHARMA', member: papa.id }, body: {} },
    { status() { return this; }, json() { return this; }, setHeader() {} });
  // Rohan turns a year older in 2 days (born 1990): the card opens 3 days out.
  const d = new Date(Date.now() + 2 * 86400000);
  const dob = '1990-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  await admin.query(`update members set dob = $2 where circle_id = $1 and name = 'Rohan'`, [sharma, dob]);
  await freshMinute();
  const t = await tick();
  const c = (await admin.query(`select count(*)::int c from cards where circle_id = $1 and occasion = 'birthday'`, [sharma])).rows[0].c;
  ok('the timer starts the birthday card 3 days out, nobody\'s phone open', t.ok && c === 1, JSON.stringify([t, c]));
  await freshMinute(); await tick();
  const c2 = (await admin.query(`select count(*)::int c from cards where circle_id = $1 and occasion = 'birthday'`, [sharma])).rows[0].c;
  ok('and a second run does not start another', c2 === 1, String(c2));
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`timer.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) process.exit(1);
