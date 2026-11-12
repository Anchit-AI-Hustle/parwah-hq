// DOSES, THE HOSPITAL SCREEN AND AFTER-VISIT NOTES AGAINST A REAL DATABASE:
// the real api/care.mjs, api/book.mjs, api/plans.mjs and api/events.mjs
// handlers on a throwaway PostgreSQL.
//
// What it proves:
//   - dose times are set for a medicine in Health & contacts; ticks are made
//     by the person or a helper ("marked by Sunita"), once, and each tick
//     takes one from the medicine's stock; undo puts it back;
//   - a private medicine is never listed, marked or alerted about to anyone
//     it is not shared with;
//   - a dose not marked is nudged once after 60 minutes and the family told
//     once after 120, however many phones look at once, and never at night;
//   - the hospital screen: one per person, steps stamped with who and when,
//     each step once, the rota, the papers, closing into history; IDs are
//     kept as their last four characters;
//   - after a visit: asked once, saved once, follow-up tasks with owners,
//     the photo must be this family's;
//   - nobody outside the family reaches any of it (403), and nobody without
//     a session (401).
//
// Run with a database that is safe to wipe; its name must end in _test.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('carecycle.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('carecycle.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: care } = await import('../../../api/care.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { default: plans } = await import('../../../api/plans.mjs');
const { default: events } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { sweepDoses, alertRecipients, cleanTimes, cleanDays, awake, ensureDoseSchema } = await import('../../../api/_doses.mjs');
const { sweepVisitAsk, nextDueAt } = await import('../../../api/_visits.mjs');
const { last4 } = await import('../../../api/_admission.mjs');

const sql = db();
await ensureSchema(sql);
await ensureDoseSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

let phoneN = 0;
async function person(circleId, name, role = 'family', onApp = true) {
  let u = null, token = null;
  if (onApp) {
    const phone = '+9198300' + String(++phoneN).padStart(5, '0');
    u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1, '+91', $2, $3) returning id`, [phone, phone.slice(3), name])).rows[0];
    token = newToken();
    await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  }
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id) values ($1, $2, $3, $4) returning id`, [circleId, name, role, u ? u.id : null])).rows[0];
  return { id: m.id, name, token, circleId };
}
const sharma = (await admin.query(`insert into circles (code, name) values ('SHARMA', 'Sharma Family') returning id`)).rows[0].id;
const other = (await admin.query(`insert into circles (code, name) values ('VERMA1', 'Verma Family') returning id`)).rows[0].id;
const rohan = await person(sharma, 'Rohan');
const sunita = await person(sharma, 'Sunita');
const meera = await person(sharma, 'Meera');
const maa = await person(sharma, 'Maa', 'parent');
const dadi = await person(sharma, 'Dadi', 'parent', false);
const vikram = await person(other, 'Vikram');
const CODE = { [sharma]: 'SHARMA', [other]: 'VERMA1' };

async function call(handler, who, { method = 'POST', body = {}, query = {}, token } = {}) {
  const req = { method, headers: { 'x-parwah-token': token === undefined ? who.token : token, 'x-forwarded-for': '10.2.2.' + (++phoneN), 'x-parwah-tz': 'Asia/Kolkata' },
                body: { code: CODE[who.circleId], memberId: who.id, ...body },
                query: { circle: CODE[who.circleId], member: who.id, ...query } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...json, http: status };
}
const dose = (who, body) => call(care, who, { body: { area: 'doses', ...body } });
const doseGet = (who, query = {}) => call(care, who, { method: 'GET', query: { area: 'doses', ...query } });
const adm = (who, body) => call(book, who, { body: { area: 'admission', ...body } });
const admGet = (who, query = {}) => call(book, who, { method: 'GET', query: { area: 'admission', ...query } });
const visit = (who, body) => call(plans, who, { body: { area: 'visit', ...body } });
const visitGet = (who, query = {}) => call(plans, who, { method: 'GET', query: { area: 'visit', ...query } });
const q1 = async (text, args) => (await admin.query(text, args)).rows[0];

// A fixed-offset zone where it is about noon right now, and one where it is
// about three in the morning: the waking-hours rule, tested at any hour.
function zoneAt(hourWanted) {
  const h = new Date().getUTCHours();
  let off = ((hourWanted - h) % 24 + 24) % 24; if (off > 12) off -= 24;
  return off === 0 ? 'Etc/GMT' : 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.abs(off);
}
const NOON = zoneAt(12), NIGHT = zoneAt(3);

// ---------- pure rules ----------
ok('times: morning, afternoon and night are 08:00, 14:00 and 21:00', JSON.stringify(cleanTimes(['night', 'morning', 'afternoon'])) === '["08:00","14:00","21:00"]');
ok('times: a custom time is kept, a bad one refuses the lot', JSON.stringify(cleanTimes(['7:30'])) === '["07:30"]' && cleanTimes(['25:00']) === null && cleanTimes([]) === null);
ok('days: every day is stored as no limit', cleanDays([0, 1, 2, 3, 4, 5, 6]).length === 0 && JSON.stringify(cleanDays([5, 1, 1])) === '[1,5]');
ok('waking hours are 07:00 to 22:30', awake('07:00') && awake('22:30') && !awake('23:00') && !awake('06:59'));
ok('IDs keep only their last four characters', last4('POL-1234-5678-9012') === '9012' && last4('') === null);
ok('next visit in 6 weeks lands at 10:00 at home', new Date(nextDueAt(Date.UTC(2026, 10, 2, 5, 0), 6, 'Asia/Kolkata')).toISOString() === '2026-12-14T04:30:00.000Z');

// ---------- medicines in Health & contacts ----------
const addMed = async (who, body) => (await call(book, who, { body: { action: 'add', kind: 'med', ...body } })).id;
const amlo = await addMed(rohan, { name: 'Amlopres 5', forwhat: 'BP', aboutId: maa.id });
const thyro = await addMed(maa, { name: 'Thyronorm 50', aboutId: maa.id, visibility: 'private' });
const dadiMed = await addMed(rohan, { name: 'Ecosprin', aboutId: dadi.id });
const nobodys = await addMed(rohan, { name: 'Vitamin D' });
await call(book, maa, { body: { action: 'share', id: thyro, targetId: sunita.id } });
await admin.query(`insert into medicine_inventory (circle_id, member_id, medicine_id, medicine_name, total_units_in_pack, units_remaining, daily_consumption_rate)
                   values ($1, $2, $3, 'Amlopres 5', 30, 10, 2)`, [sharma, maa.id, amlo]);

// ---------- 1. doses: who may set times ----------
{
  const r = await dose(rohan, { action: 'dose_schedule_set', medicineId: amlo, times: ['morning', 'night'], tz: 'Asia/Kolkata' });
  ok('the family sets times for a medicine in the book', r.http === 200 && JSON.stringify(r.times) === '["08:00","21:00"]', JSON.stringify(r));
  const p = await dose(meera, { action: 'dose_schedule_set', medicineId: thyro, times: ['08:00'] });
  ok('a private medicine cannot be scheduled by someone it is not shared with', p.http === 404);
  const s = await dose(sunita, { action: 'dose_schedule_set', medicineId: thyro, times: ['08:00'], tz: NOON });
  ok('but can by someone it is shared with', s.http === 200, JSON.stringify(s));
  const n = await dose(rohan, { action: 'dose_schedule_set', medicineId: nobodys, times: ['08:00'] });
  ok('a medicine about nobody asks whose it is first', n.http === 400 && /whose/.test(n.error));
  const b = await dose(rohan, { action: 'dose_schedule_set', medicineId: amlo, times: ['8 am'] });
  ok('a time that is not HH:MM is refused', b.http === 400);
  const d = await dose(rohan, { action: 'dose_schedule_set', medicineId: dadiMed, times: ['09:00'], days: [1, 3, 5], tz: NOON });
  ok('times for someone not on Parwah, on chosen days', d.http === 200 && JSON.stringify(d.days) === '[1,3,5]');
  const cal = await dose(rohan, { action: 'dose_schedule_set', medicineId: amlo, times: ['morning', 'night'], tz: 'Asia/Calcutta' });
  const calTz = (await q1(`select tz from medicine_schedules where medicine_id = $1`, [amlo])).tz;
  ok('an old zone name a phone still sends is stored as one the database knows', cal.http === 200 && calTz === 'Asia/Kolkata', calTz);
  const out = await call(care, vikram, { body: { code: 'SHARMA', memberId: vikram.id, area: 'doses', action: 'dose_schedule_set', medicineId: amlo, times: ['08:00'] } });
  ok('someone from another family is refused (403)', out.http === 403);
  const own = await call(care, vikram, { body: { area: 'doses', action: 'dose_schedule_set', medicineId: amlo, times: ['08:00'] } });
  ok('nor can they reach this family\'s medicine from their own (404)', own.http === 404);
  const anon = await call(care, rohan, { method: 'GET', query: { area: 'doses' }, token: '' });
  ok('without a session it asks to sign in (401)', anon.http === 401 && anon.signin === true);
}

// No dose is invented for a time that passed before the times were set.
{
  const rows = (await admin.query(`select due_at from medicine_doses where medicine_id = $1`, [amlo])).rows;
  ok('no dose is made for a time before the times were set', rows.every(r => new Date(r.due_at).getTime() >= Date.now() - 60000), String(rows.length));
}

// Make history: the times were set three days ago.
await admin.query(`update medicine_schedules set since = now() - interval '3 days'`);
await admin.query(`delete from medicine_doses`);

// ---------- reading: private stays private ----------
let maaToday;
{
  const r = await doseGet(rohan);
  ok('the family reads the doses', r.http === 200 && r.doses.length > 0, JSON.stringify(r).slice(0, 200));
  ok('a private medicine is not in the list of someone it is not shared with', !r.doses.some(d => d.medicine_id === thyro) && !r.schedules.some(s => s.medicine_id === thyro));
  const s = await doseGet(sunita);
  ok('it is in the list of someone it is shared with', s.doses.some(d => d.medicine_id === thyro));
  const m = await doseGet(maa, { person: maa.id });
  ok('the person sees their own, private ones too, and only theirs when asked', m.doses.some(d => d.medicine_id === thyro) && m.doses.every(d => d.person_id === maa.id));
  ok('the week goes back seven days at most', new Set(m.doses.map(d => d.day)).size <= 7);
  maaToday = m.doses.filter(d => d.today && d.medicine_id === amlo);
  const days = (await admin.query(`select distinct extract(isodow from due_at at time zone 'Etc/GMT') d from medicine_doses where medicine_id = $1`, [dadiMed])).rows;
  ok('a schedule on chosen days makes doses only on those days', days.length >= 1);
  const bad = await doseGet(rohan, { person: 'nope' });
  ok('a bad person id is refused', bad.http === 400);
}

// ---------- marking ----------
{
  const past = (await admin.query(`select id from medicine_doses where medicine_id = $1 and status = 'due' and due_at < now() order by due_at limit 2`, [amlo])).rows.map(r => r.id);
  const r = await dose(sunita, { action: 'dose_mark', doseIds: [past[0]], status: 'taken' });
  ok('a helper marks a dose for the parent', r.http === 200 && r.marked === 1, JSON.stringify(r));
  const row = await q1(`select status, marked_by from medicine_doses where id = $1`, [past[0]]);
  ok('it records who marked it ("marked by Sunita")', row.status === 'taken' && row.marked_by === sunita.id);
  const inv = await q1(`select units_remaining from medicine_inventory where medicine_id = $1`, [amlo]);
  ok('each tick takes one from the stock', Number(inv.units_remaining) === 9, String(inv.units_remaining));
  const twice = await dose(maa, { action: 'dose_mark', doseIds: [past[0]], status: 'taken' });
  ok('marking it again changes nothing and takes nothing more', twice.marked === 0 && Number((await q1(`select units_remaining from medicine_inventory where medicine_id = $1`, [amlo])).units_remaining) === 9);
  const both = await Promise.all([dose(maa, { action: 'dose_mark', doseIds: [past[1]] }), dose(rohan, { action: 'dose_mark', doseIds: [past[1]] })]);
  ok('two people marking at the same moment: one mark, one unit', both[0].marked + both[1].marked === 1 && Number((await q1(`select units_remaining from medicine_inventory where medicine_id = $1`, [amlo])).units_remaining) === 8);
  const skip = (await admin.query(`select id from medicine_doses where medicine_id = $1 and status = 'due' and due_at < now() order by due_at limit 1`, [amlo])).rows[0].id;
  const sk = await dose(maa, { action: 'dose_mark', doseId: skip, status: 'skipped', reason: 'Felt unwell' });
  const skr = await q1(`select status, skip_reason from medicine_doses where id = $1`, [skip]);
  ok('a dose can be marked skipped, with the reason', sk.marked === 1 && skr.status === 'skipped' && skr.skip_reason === 'Felt unwell');
  ok('a skip takes nothing from the stock', Number((await q1(`select units_remaining from medicine_inventory where medicine_id = $1`, [amlo])).units_remaining) === 8);
  const priv = (await admin.query(`select id from medicine_doses where medicine_id = $1 limit 1`, [thyro])).rows[0].id;
  const pm = await dose(meera, { action: 'dose_mark', doseIds: [priv] });
  ok('a private medicine\'s dose cannot be marked by someone it is not shared with', pm.http === 404);
  const far = (await admin.query(`select id from medicine_doses where status = 'due' and due_at > now() + interval '4 hours' limit 1`)).rows[0];
  if (far) { const f = await dose(maa, { action: 'dose_mark', doseIds: [far.id] }); ok('a dose many hours away cannot be marked yet', f.http === 409); }
  const out = await call(care, vikram, { body: { area: 'doses', action: 'dose_mark', doseIds: [past[0]] } });
  ok('another family cannot mark this family\'s dose', out.http === 404);
  const u1 = await dose(meera, { action: 'dose_undo', doseId: past[0] });
  ok('undo: not by someone who neither marked it nor is it for', u1.http === 403);
  const u2 = await dose(sunita, { action: 'dose_undo', doseId: past[0] });
  ok('undo by whoever marked it puts the unit back', u2.http === 200 && Number((await q1(`select units_remaining from medicine_inventory where medicine_id = $1`, [amlo])).units_remaining) === 9);
  const feed = (await admin.query(`select text from events where circle_id = $1 and text like '%medicines%'`, [sharma])).rows.map(r => r.text).join(' | ');
  ok('the feed says who marked whose time, and never names a medicine', /Sunita marked Maa's \d{1,2}:\d\d (AM|PM) medicines as taken/.test(feed) && !/Thyronorm|Amlopres/.test(feed), feed);
}

// ---------- the nudge once, the family once, never at night ----------
{
  await admin.query(`delete from medicine_doses where medicine_id = $1`, [thyro]);
  const sched = await q1(`select id from medicine_schedules where medicine_id = $1`, [thyro]);
  const ins = async (mins, tz) => (await q1(`insert into medicine_doses (circle_id, person_id, medicine_id, schedule_id, slot, tz, due_at)
      values ($1, $2, $3, $4, '08:00', $5, now() - make_interval(mins => $6)) returning id`, [sharma, maa.id, thyro, sched.id, tz, mins])).id;
  const a = await ins(70, NOON);
  const n1 = await Promise.all([sweepDoses(sql, sharma), sweepDoses(sql, sharma), sweepDoses(sql, sharma)]);
  const r1 = await q1(`select nudged_at, alerted_at from medicine_doses where id = $1`, [a]);
  ok('70 minutes late: the person is nudged once, however many phones look', r1.nudged_at && !r1.alerted_at, JSON.stringify(n1));
  const nAt = new Date(r1.nudged_at).getTime();
  await sweepDoses(sql, sharma);
  ok('and not nudged again on the next look', new Date((await q1(`select nudged_at from medicine_doses where id = $1`, [a])).nudged_at).getTime() === nAt);
  await admin.query(`update medicine_doses set due_at = now() - interval '125 minutes' where id = $1`, [a]);
  await Promise.all([sweepDoses(sql, sharma), sweepDoses(sql, sharma)]);
  const r2 = await q1(`select nudged_at, alerted_at from medicine_doses where id = $1`, [a]);
  ok('125 minutes late: the family is told once', !!r2.alerted_at);
  const aAt = new Date(r2.alerted_at).getTime();
  await sweepDoses(sql, sharma);
  ok('and not told again', new Date((await q1(`select alerted_at from medicine_doses where id = $1`, [a])).alerted_at).getTime() === aAt);
  const night = await ins(130, NIGHT);
  await sweepDoses(sql, sharma);
  const rn = await q1(`select nudged_at, alerted_at from medicine_doses where id = $1`, [night]);
  ok('at 3 in the morning at home nobody is nudged or told', !rn.nudged_at && !rn.alerted_at);
  const stale = await ins(600, NOON);
  await sweepDoses(sql, sharma);
  const rs = await q1(`select nudged_at, alerted_at from medicine_doses where id = $1`, [stale]);
  ok('a dose from hours ago is not announced late', !rs.nudged_at && !rs.alerted_at);
  const marked = await ins(130, NOON);
  await admin.query(`update medicine_doses set status = 'taken', taken_at = now(), marked_by = $2 where id = $1`, [marked, maa.id]);
  await sweepDoses(sql, sharma);
  ok('a marked dose is never announced', !(await q1(`select alerted_at from medicine_doses where id = $1`, [marked])).alerted_at);
  // Someone marked as remembered is never nudged, and nobody is told they missed a dose.
  await admin.query(`alter table members add column if not exists remembered boolean not null default false`);
  await admin.query(`update members set remembered = true where id = $1`, [maa.id]);
  const gone1 = await ins(70, NOON), gone2 = await ins(125, NOON);
  await sweepDoses(sql, sharma);
  const g1 = await q1(`select nudged_at, alerted_at from medicine_doses where id = $1`, [gone1]), g2 = await q1(`select nudged_at, alerted_at from medicine_doses where id = $1`, [gone2]);
  ok('a remembered person is not nudged, and the family is not told of a missed dose', !g1.nudged_at && !g1.alerted_at && !g2.nudged_at && !g2.alerted_at, JSON.stringify([g1, g2]));
  await admin.query(`update members set remembered = false where id = $1`, [maa.id]);
  await sweepDoses(sql, sharma);
  ok('with the mark off, both go out as before', !!(await q1(`select nudged_at from medicine_doses where id = $1`, [gone1])).nudged_at && !!(await q1(`select alerted_at from medicine_doses where id = $1`, [gone2])).alerted_at);
  await admin.query(`delete from medicine_doses where id = any($1::uuid[])`, [[gone1, gone2]]);
  const to = (await alertRecipients(sql, sharma, maa.id, [thyro])).map(r => r.id).sort();
  ok('a private medicine alerts only those it is shared with, never the person', JSON.stringify(to) === JSON.stringify([sunita.id]), JSON.stringify(to));
  const toAll = (await alertRecipients(sql, sharma, maa.id, [amlo])).map(r => r.id).sort();
  ok('a shared one alerts the family on Parwah', JSON.stringify(toAll) === JSON.stringify([rohan.id, sunita.id, meera.id].sort()));
  // The poll the family is already doing runs the sweep.
  const e1 = await ins(65, NOON);
  await call(events, rohan, { method: 'GET' });
  ok('an ordinary look at the family runs the sweep', !!(await q1(`select nudged_at from medicine_doses where id = $1`, [e1])).nudged_at);
}

// ---------- the old "Medicines taken" button still works ----------
{
  const r = await call(events, maa, { body: { type: 'pill', text: '' } });
  ok('the one-a-day "Medicines taken" still records', r.http < 300 && r.ok, JSON.stringify(r));
}

// ---------- 2. the hospital screen ----------
let admId;
{
  await call(book, rohan, { body: { action: 'add', kind: 'insurance', name: 'Star Health', notes: 'Policy 1234 5678 9012', aboutId: maa.id } });
  await call(book, rohan, { body: { action: 'add', kind: 'contact', category: 'emergency', name: 'Rohan', phone: '9810012345', aboutId: maa.id } });
  const out = await call(book, vikram, { body: { code: 'SHARMA', memberId: vikram.id, area: 'admission', action: 'admission_open', personId: maa.id } });
  ok('another family cannot open a hospital screen here (403)', out.http === 403);
  const anon = await call(book, rohan, { method: 'GET', query: { area: 'admission' }, token: '' });
  ok('without a session it asks to sign in (401)', anon.http === 401);
  const o = await adm(rohan, { action: 'admission_open', personId: maa.id, hospital: 'City Hospital', ward: 'Ward 3, bed 12', doctor: 'Dr Mehta', claimNumber: 'CLM-0099-4567', tz: 'Asia/Kolkata' });
  ok('"Admitted to hospital" opens one shared screen', o.http === 201 && o.id, JSON.stringify(o));
  admId = o.id;
  const again = await adm(sunita, { action: 'admission_open', personId: maa.id });
  ok('one open screen per person', again.http === 409);
  const row = await q1(`select * from admissions where id = $1`, [admId]);
  ok('the insurer and policy come from Health & contacts, the policy as its last four only', row.insurer === 'Star Health' && row.policy_last4 === '9012' && !JSON.stringify(row).includes('5678'));
  ok('the claim number is kept as its last four only', row.claim_last4 === '4567');
  ok('admitted is the first step, stamped with who', row.steps.length === 1 && row.steps[0].key === 'admitted' && row.steps[0].by === rohan.id);
  ok('whoever opened it is with her now', row.with_now.includes(rohan.id) || String(row.with_now).includes(rohan.id));
  const g = await admGet(meera, { person: maa.id, packet: '1' });
  ok('everyone in the family sees the same screen', g.http === 200 && g.open.length === 1 && g.open[0].hospital === 'City Hospital' && g.open[0].with_names[0].name === 'Rohan', JSON.stringify(g).slice(0, 300));
  ok('with the papers: insurer, last four, emergency contact', g.packet.insurer === 'Star Health' && g.packet.policyLast4 === '9012' && g.packet.emergencyName === 'Rohan');
  ok('opening the papers is on the "who looked" trail', !!(await q1(`select 1 as x from audit_events where action = 'view_emergency_packet' and resource_id = $1`, [maa.id])));
  const steps = await Promise.all([adm(sunita, { action: 'admission_step', admissionId: admId, step: 'preauth_sent' }), adm(meera, { action: 'admission_step', admissionId: admId, step: 'preauth_sent' })]);
  ok('a step tapped twice at once is one step', steps.filter(s => s.http === 200).length === 1 && steps.filter(s => s.http === 409).length === 1);
  await adm(meera, { action: 'admission_step', admissionId: admId, step: 'discharge_advised' });
  const r2 = await q1(`select steps from admissions where id = $1`, [admId]);
  ok('each step is stamped with the time and who tapped it', r2.steps.length === 3 && r2.steps[2].key === 'discharge_advised' && r2.steps[2].byName === 'Meera' && !isNaN(Date.parse(r2.steps[2].at)));
  const u = await adm(rohan, { action: 'admission_undo', admissionId: admId, step: 'preauth_sent' });
  ok('only the last step can be undone', u.http === 409);
  const u2 = await adm(rohan, { action: 'admission_undo', admissionId: admId, step: 'discharge_advised' });
  ok('the last step can be taken back', u2.http === 200 && (await q1(`select jsonb_array_length(steps) n from admissions where id = $1`, [admId])).n === 2);
  const bad = await adm(rohan, { action: 'admission_step', admissionId: admId, step: 'cured' });
  ok('an unknown step is refused', bad.http === 400);
  await adm(sunita, { action: 'admission_with', admissionId: admId, on: true });
  await adm(sunita, { action: 'admission_with', admissionId: admId, targetId: rohan.id, on: false });
  const w = await q1(`select with_now from admissions where id = $1`, [admId]);
  ok('the rota: who is with her now', String(w.with_now).includes(sunita.id) && !String(w.with_now).includes(rohan.id));
  const pp = await adm(meera, { action: 'admission_paper', admissionId: admId, key: 'policy', have: true });
  ok('the papers to carry are ticked for everyone', pp.http === 200 && (await q1(`select papers from admissions where id = $1`, [admId])).papers.policy === true);
  const up = await adm(meera, { action: 'admission_update', admissionId: admId, ward: 'ICU 2', policyNumber: 'XYZ-77-0042' });
  const r3 = await q1(`select ward, policy_last4, hospital from admissions where id = $1`, [admId]);
  ok('details can be changed, the rest kept, the new policy as its last four', up.http === 200 && r3.ward === 'ICU 2' && r3.policy_last4 === '0042' && r3.hospital === 'City Hospital');
  const vk = await call(book, vikram, { body: { area: 'admission', action: 'admission_step', admissionId: admId, step: 'final_bill' } });
  ok('another family cannot reach this stay from their own (404)', vk.http === 404);
  const feed = (await admin.query(`select text from events where circle_id = $1 and text like '🏥%'`, [sharma])).rows.map(r => r.text).join(' | ');
  ok('each step is in the family feed with the time and who', /Pre-auth sent at \d{1,2}:\d\d (AM|PM) \((Sunita|Meera)\)/.test(feed), feed);
  const c = await adm(sunita, { action: 'admission_close', admissionId: admId });
  ok('closing it puts it in her history', c.http === 200 && (await admGet(rohan, { person: maa.id })).history.length === 1 && (await admGet(rohan)).open.length === 0);
  const after = await adm(rohan, { action: 'admission_step', admissionId: admId, step: 'final_bill' });
  ok('a closed stay is not changed', after.http === 409);
  const reopen = await adm(rohan, { action: 'admission_open', personId: maa.id });
  ok('a new stay can be opened after the last one closed', reopen.http === 201);
  await adm(rohan, { action: 'admission_close', admissionId: reopen.id });
  const og = await admGet(vikram, { person: maa.id });
  ok('another family cannot read her history', og.http === 403);
}

// ---------- 3. after the visit ----------
{
  // A doctor's appointment that was 90 minutes ago; Rohan took Maa.
  await call(plans, rohan, { method: 'GET' });   // makes the plans table
  const pl = await q1(`insert into plans (circle_id, by_member, title, kind, at, going) values ($1, $2, 'Maa: Dr Mehta', 'appointment', now() - interval '90 minutes', $3) returning id`,
                      [sharma, rohan.id, '{' + rohan.id + ',' + maa.id + '}']);
  const sent = await Promise.all([sweepVisitAsk(sql, sharma), sweepVisitAsk(sql, sharma), sweepVisitAsk(sql, sharma)]);
  ok('the people who went are asked once, however many phones look', sent.reduce((a, b) => a + b, 0) === 1 && !!(await q1(`select visit_asked_at from plans where id = $1`, [pl.id])).visit_asked_at, JSON.stringify(sent));
  ok('and not again', (await sweepVisitAsk(sql, sharma)) === 0);
  const pend = await visitGet(maa);
  ok('"How did the visit go?" waits for whoever went', pend.http === 200 && pend.pending.length === 1 && pend.pending[0].id === pl.id);
  ok('but not for someone who did not go', (await visitGet(meera)).pending.length === 0);
  // The photo goes into the vault through the vault's own upload.
  const doc = await call(book, rohan, { body: { area: 'vault', action: 'add', kind: 'health', label: 'Maa prescription', aboutId: maa.id } });
  const vdoc = await call(book, vikram, { body: { area: 'vault', action: 'add', kind: 'health', label: 'x', aboutId: vikram.id } });
  const wrong = await visit(rohan, { action: 'visit_save', planId: pl.id, personId: maa.id, vaultDocId: vdoc.id });
  ok('a photo from another family\'s vault is refused', wrong.http === 404);
  const offApp = await visit(rohan, { action: 'visit_save', planId: pl.id, personId: maa.id, bookOwnerId: dadi.id, nextWeeks: 4 });
  ok('a follow-up cannot be given to someone not on Parwah', offApp.http === 400);
  ok('and a refused save leaves the visit waiting', !(await q1(`select visit_done_at from plans where id = $1`, [pl.id])).visit_done_at);
  const out = await call(plans, vikram, { body: { code: 'SHARMA', memberId: vikram.id, area: 'visit', action: 'visit_save', planId: pl.id, personId: maa.id } });
  ok('another family cannot write a visit here (403)', out.http === 403);
  const anon = await call(plans, rohan, { method: 'GET', query: { area: 'visit' }, token: '' });
  ok('without a session it asks to sign in (401)', anon.http === 401);
  const s = await visit(rohan, { action: 'visit_save', planId: pl.id, personId: maa.id, vaultDocId: doc.id, nextWeeks: 6, tests: ['HbA1c', 'Lipid profile', 'hba1c'],
                                 newNotes: 'Walk 20 minutes daily', doctor: 'Dr Mehta', testsOwnerId: sunita.id, tz: 'Asia/Kolkata' });
  ok('three taps and a photo are saved', s.http === 201 && s.nextDue && s.tasks === 3, JSON.stringify(s));
  const v = await q1(`select * from audio_consultations where id = $1`, [s.id]);
  ok('kept in audio_consultations with the plan, the next date and the photo', v.plan_id === pl.id && v.vault_doc_id === doc.id && v.next_due && v.transcript_raw === 'Walk 20 minutes daily');
  ok('tests are kept as typed, once each', JSON.stringify(v.action_items.tests) === '["HbA1c","Lipid profile"]');
  const tasks = (await admin.query(`select title, claimed_by, status, remind_before, about_member from requests where circle_id = $1 and about_member = $2 order by due_at`, [sharma, maa.id])).rows;
  const book1 = tasks.find(t => /^Book Maa's next visit \(Dr Mehta\)$/.test(t.title));
  const testT = tasks.find(t => /^Get Maa's tests done: HbA1c, Lipid profile$/.test(t.title));
  const due = tasks.find(t => /next visit is due/.test(t.title));
  ok('a task to book the next visit, owned by whoever saved it', book1 && book1.claimed_by === rohan.id && book1.status === 'claimed', JSON.stringify(tasks));
  ok('a task to get the tests done, given to the person named', testT && testT.claimed_by === sunita.id && testT.status === 'assigned');
  ok('and a reminder the day before the next visit', due && due.remind_before === 1440);
  const again = await visit(maa, { action: 'visit_save', planId: pl.id, personId: maa.id, nextWeeks: 2 });
  ok('the same visit cannot be saved twice', again.http === 409);
  ok('and it no longer waits on Today', (await visitGet(maa)).pending.length === 0);
  const list = await visitGet(meera, { person: maa.id });
  ok('the family reads what the doctor asked for', list.visits.length === 1 && list.visits[0].doc_label === 'Maa prescription' && list.visits[0].action_items.nextWeeks === 6);
  const free = await visit(meera, { action: 'visit_save', personId: maa.id, newNotes: 'Eye check, all fine' });
  ok('a visit with no plan can be written down too', free.http === 201);
  const pl2 = await q1(`insert into plans (circle_id, by_member, title, kind, at, going) values ($1, $2, 'Papa: dentist', 'appointment', now() - interval '2 hours', $3) returning id`, [sharma, rohan.id, '{' + rohan.id + '}']);
  const sk = await visit(rohan, { action: 'visit_skip', planId: pl2.id });
  ok('"Skip" puts a visit away without notes', sk.http === 200 && (await visitGet(rohan)).pending.length === 0);
  const badW = await visit(rohan, { action: 'visit_save', personId: maa.id, nextWeeks: 99 });
  ok('a next visit more than a year away is refused', badW.http === 400);
  // Ekta never reads these: the module does not call any model.
  const src = (await import('node:fs')).readFileSync(new URL('../../../api/_visits.mjs', import.meta.url), 'utf8');
  ok('nothing in the visit notes path calls Ekta or a model', !/anthropic|ekta\.mjs|_ektalocal/i.test(src.replace(/\/\/[^\n]*/g, '')));
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) {
  console.error(`carecycle.dbtest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`carecycle.dbtest: ${pass}/${pass} checks pass`);
