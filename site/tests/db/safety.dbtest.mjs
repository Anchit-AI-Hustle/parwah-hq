// SAFETY AND ALERTS, AGAINST A REAL DATABASE: the real handlers, the real
// schema and SQL, on a throwaway PostgreSQL. Twilio is a stand-in that
// records what would have been sent.
//
// What it proves:
//   A1  the timer itself (runTick) shouts "still nobody" for an SOS that
//       nobody answered, exactly once, and every function it calls exists;
//   A2  each SOS has its own push topic (the choice is in safetytest.mjs);
//   A3  someone who has passed away is never in the SOS contacts, never
//       texted or rung, never pushed, never the Lost-mode call person;
//   A4  an SOS reaches every family the person belongs to, and a group of
//       friends only when it is the one open; "I am safe" closes them all;
//   A5  with no Twilio keys the family is told so, in words;
//   A6  a chat message, a medicine tick, a pulse answer or "All is well"
//       each count as checked in for that day;
//   A7  pausing someone else's check-in waits for their own yes;
//   A8  a medicine with no tick tells the family only after the person's
//       own yes, only the carer for someone not on Parwah, and "Ran out"
//       makes a task instead;
//   A10 no "What needs doing" list about someone who used Parwah in the
//       last 30 days, at start or at confirm; no date of birth and no adult
//       role means not an adult;
//   A11 marking someone who is on Parwah needs a second adult's yes;
//   A12 the timer's last run is written down and read back honestly.
// (A9, tasks, is in tasks.dbtest.mjs.)
//
// Run with a database that is safe to wipe; its name must end in _test.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('safety.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('safety.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.CRON_SECRET;
for (const k of Object.keys(process.env)) if (k.startsWith('TWILIO_')) delete process.env[k];

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const EV = await import('../../../api/events.mjs');
const events = EV.default;
const { default: care } = await import('../../../api/care.mjs');
const { default: circleH } = await import('../../../api/circle.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { default: locationH } = await import('../../../api/_locationapi.mjs');
const { db, ensureSchema, ensureCircleChat } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { ensurePushSchema, pushTargets } = await import('../../../api/_push.mjs');
const { ensureBookSchema } = await import('../../../api/_bookschema.mjs');
const { ensureRememberSchema, rememberAsksFor } = await import('../../../api/_remember.mjs');
const { ensureFamilyCareSchema, okToday, quietSweep } = await import('../../../api/_familycare.mjs');
const { ensureDoseSchema, doseAlertTo, doseTellState, sweepDoses } = await import('../../../api/_doses.mjs');
const { ensureTaskSchema } = await import('../../../api/_tasks.mjs');
const { ensureSosSchema, sosContacts } = await import('../../../api/_sos.mjs');
const { ensurePulseSchema } = await import('../../../api/_pulse.mjs');
const D = await import('../../../api/_sosdial.mjs');
const { tickSeen } = await import('../../../api/_safety.mjs');
const R = await import('../../../api/_safetyrules.mjs');
const { dayIn } = await import('../../../api/_recur.mjs');

const sql = db();
await ensureSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };
const rows = async (text, args) => (await admin.query(text, args)).rows;
const one = async (text, args) => (await rows(text, args))[0];

let n = 0;
const CODE = {};
async function circle(code, name, kind = 'family') {
  const c = await one(`insert into circles (code, name, kind) values ($1, $2, $3) returning id`, [code, name, kind]);
  CODE[c.id] = code;
  return c.id;
}
// A person on Parwah. `as` joins an existing user to one more circle.
async function person(circleId, name, { role = 'family', relation = null, dob = '1985-05-05', phone, as = null } = {}) {
  const p = phone === undefined ? '+9198700' + String(++n).padStart(5, '0') : phone;
  let userId = as && as.userId, token = as && as.token;
  if (!userId) {
    const up = '+9198500' + String(++n).padStart(5, '0');
    userId = (await one(`insert into users (phone, phone_cc, phone_local, name) values ($1, '+91', $2, $3) returning id`, [up, up.slice(3), name])).id;
    token = newToken();
    await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(token), userId]);
  }
  const m = await one(`insert into members (circle_id, name, role, relation, user_id, phone, phone_cc, dob) values ($1, $2, $3, $4, $5, $6, '+91', $7) returning id`,
    [circleId, name, role, relation, userId, p, dob]);
  return { id: m.id, name, token, userId, circleId, phone: p };
}
// A name in the tree: not on Parwah.
async function named(circleId, name, phone, role = 'parent') {
  const m = await one(`insert into members (circle_id, name, role, phone) values ($1, $2, $3, $4) returning id`, [circleId, name, role, phone]);
  return { id: m.id, name, circleId, phone };
}
let ip = 0;
async function call(handler, who, { method = 'POST', body = {}, query = {} } = {}) {
  const req = { method, headers: { 'x-parwah-token': who.token, 'x-forwarded-for': '10.7.' + (++ip % 250) + '.' + (ip % 200 + 1) },
    query: method === 'GET' ? { circle: CODE[who.circleId], member: who.id, ...query } : query,
    body: method === 'GET' ? {} : { code: CODE[who.circleId], memberId: who.id, ...body } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...json, http: status };
}
const freshLimits = () => admin.query(`delete from rate_limit`);
const tail = p => R.phoneTail(p);

// ---------------------------------------------------------------- the Sharmas
const sharma = await circle('SHARMA', 'Sharma Family');
const papa = await person(sharma, 'Papa', { role: 'parent', relation: 'father', dob: '1950-01-01' });
const dada = await person(sharma, 'Dada', { role: 'parent', relation: 'grandfather', dob: '1930-01-01', phone: '+919811100002' });
const rohan = await person(sharma, 'Rohan', { relation: 'son', dob: '1982-03-03', phone: '+919811100004' });
const kabir = await person(sharma, 'Kabir', { relation: 'grandson', dob: '2014-06-01', phone: '+919811100003' });
const dadi = await named(sharma, 'Dadi', '+919811100001');
await call(events, papa, { method: 'GET' });          // the feed's own tables, made on first use
await ensureRememberSchema(sql); await ensureBookSchema(sql); await ensurePushSchema(sql); await ensureFamilyCareSchema(sql);
// Dada has passed away. He has a number, a session and a phone that takes pushes.
await admin.query(`update members set remembered = true, passed_year = 2025 where id = $1`, [dada.id]);
await admin.query(`insert into family_book (circle_id, kind, category, name, phone, about_member, by_member) values
  ($1, 'contact', 'emergency', 'Dr Mehta', '011-2345-6789', $2, $3),
  ($1, 'contact', 'emergency', 'Dada (old entry)', '98111 00002', $2, $3)`, [sharma, papa.id, rohan.id]);
for (const m of [dada, rohan, kabir]) {
  await admin.query(`insert into push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')`, [m.id, 'https://fcm.googleapis.com/fcm/send/' + m.id]);
}

let sent = [];
globalThis.fetch = async (u, o) => { sent.push({ url: String(u), form: Object.fromEntries(new URLSearchParams(o.body)) }); return { ok: true, json: async () => ({ sid: 'SM' + sent.length }) }; };
const KEYS = { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'tok', TWILIO_SMS_FROM: '+15005550006', TWILIO_VOICE_FROM: '+15005550006' };
const sos = (who, body = {}) => call(events, who, { body: { type: 'sos', text: '', lat: 18.52, lng: 73.85, accuracy: 10, ...body } });

// ---- A5 + A3: no keys, and the list
{
  const r = await sos(papa);
  ok('A5 with no keys the SOS still goes to the family', r.http === 201 && r.ok, JSON.stringify(r).slice(0, 200));
  ok('A5 and it says so in words, not silence', r.dialed && r.dialed.configured === false && r.dialed.line === 'Calls and texts are not set up. Family is told inside Parwah.', JSON.stringify(r.dialed));
  ok('A5 nothing was sent outside', sent.length === 0);
  const names = r.contacts.map(c => c.name);
  ok('A3 a remembered member with a phone number is never in the SOS contacts', !names.includes('Dada') && !r.contacts.some(c => tail(c.phone) === tail(dada.phone)), JSON.stringify(r.contacts));
  ok('A3 nor is their number as an emergency contact someone wrote down', !names.includes('Dada (old entry)'));
  ok('A3 the chosen emergency contact is first, then adults on Parwah, then the others', names.join() === 'Dr Mehta,Rohan,Kabir,Dadi', names.join());
  const g = await call(events, rohan, { method: 'GET' });
  ok('A5 the family state says calls are not set up', g.safety && g.safety.calls && g.safety.calls.on === false && /not set up/.test(g.safety.calls.line), JSON.stringify(g.safety && g.safety.calls));
  ok('A2 the open SOS is its own push topic', R.TOPIC_OK.test(R.pushTopic('sos', r.sosId)) && R.pushTopic('sos', r.sosId) !== R.pushTopic('sosesc', r.sosId));
  const direct = await sosContacts(sql, sharma, papa.id);
  ok('A3 the server list itself leaves them out', !direct.some(c => /Dada/.test(c.name)));
}

// ---- A3: pushes
{
  const all = await pushTargets(sql, sharma, { except: papa.id });
  ok('A3 a remembered member is never pushed', all.length === 2 && !all.some(s => s.member_id === dada.id), JSON.stringify(all.map(s => s.member_id)));
  ok('A3 not even when they are the only one asked for', (await pushTargets(sql, sharma, { only: dada.id })).length === 0);
  ok('A3 except the one note that lets a mistake be undone', (await pushTargets(sql, sharma, { only: dada.id, evenRemembered: true })).length === 1);
}

// ---- A1: the timer escalates, once
{
  ok('A1 the escalation is a module-scope function the timer can reach', typeof EV.escalateStaleSos === 'function' && typeof EV.runTick === 'function');
  const still = () => rows(`select id from events where circle_id = $1 and text like '%Nobody has answered Papa%'`, [sharma]);
  await EV.runTick(sql);
  ok('A1 an SOS a minute old is not escalated', (await still()).length === 0);
  await admin.query(`update sos set created_at = now() - interval '6 minutes' where circle_id = $1`, [sharma]);
  await EV.runTick(sql);
  const s1 = await one(`select escalated from sos where circle_id = $1`, [sharma]);
  ok('A1 runTick escalates an unanswered SOS', s1.escalated === true && (await still()).length === 1, JSON.stringify([s1, (await still()).length]));
  await Promise.all([EV.runTick(sql), EV.runTick(sql)]);
  await call(events, rohan, { method: 'GET' });
  ok('A1 exactly once, however often the timer runs', (await still()).length === 1, String((await still()).length));
}

// ---- A12: the timer's last run
{
  const at = await tickSeen(sql);
  ok('A12 the run is written down', typeof at === 'number' && Date.now() - at < 60000, String(at));
  await admin.query(`update kv set v = $1 where k = 'tick_at'`, [String(Date.now() - 3 * 60000)]);
  await admin.query(`update rate_limit set n = 99 where bucket = 'tick'`);       // this poll does not run the timer itself
  await admin.query(`insert into rate_limit (bucket, k, n, reset_at) values ('tick', 'all', 99, now() + interval '50 seconds') on conflict (bucket, k) do update set n = 99, reset_at = excluded.reset_at`).catch(() => {});
  let g = await call(events, rohan, { method: 'GET' });
  ok('A12 an adult reads when reminders last ran', g.safety && g.safety.timer && g.safety.timer.text === 'Reminders last ran: 3 minutes ago' && g.safety.timer.warn === false, JSON.stringify(g.safety && g.safety.timer));
  await admin.query(`update kv set v = $1 where k = 'tick_at'`, [String(Date.now() - 40 * 60000)]);
  g = await call(events, rohan, { method: 'GET' });
  ok('A12 more than 15 minutes old is a plain warning', g.safety.timer.warn === true && g.safety.timer.text === 'Timed reminders are not running. Family alerts may be late.', JSON.stringify(g.safety.timer));
  const k = await call(events, kabir, { method: 'GET' });
  ok('A12 a child is not shown it', k.ok && k.safety && k.safety.timer === null, JSON.stringify(k.safety));
  await freshLimits();
  g = await call(events, rohan, { method: 'GET' });
  const after = await tickSeen(sql);
  ok('A12 the phone that opens Parwah runs the timer, and that run is written down', Date.now() - after < 60000, String(after));
}

// ---- A3: with keys, nobody who has passed away is texted or rung
{
  await call(events, rohan, { body: { type: 'sos_resolve', sosId: (await one(`select id from sos where circle_id = $1`, [sharma])).id } });
  await freshLimits(); sent = [];
  Object.assign(process.env, KEYS);
  const r = await sos(papa);
  const to = sent.map(s => s.form.To);
  ok('A3 with keys, texts and calls do go out', r.dialed.configured === true && r.dialed.sms >= 3 && r.dialed.call >= 1 && !r.dialed.line, JSON.stringify(r.dialed));
  ok('A3 never to the number of someone who has passed away', !to.some(t => tail(t) === tail(dada.phone)), to.join());
  // Even if a caller hands the dialler that number itself.
  sent = [];
  const sid = r.sosId;
  await D.dialOut(sql, sid, [{ name: 'Dada', phone: dada.phone }, { name: 'New', phone: '+919811100077' }], { name: 'Papa', text: 'x', map: null, cc: '+91' });
  ok('A3 the dialler refuses that number whoever lists it', sent.length > 0 && !sent.some(s => tail(s.form.To) === tail(dada.phone)), sent.map(s => s.form.To).join());
  for (const k of Object.keys(KEYS)) delete process.env[k];
  await call(events, papa, { body: { type: 'sos_safe', sosId: sid } });
}

// ---- A3: Lost mode and ringing
{
  // Only Dada and Dadi have numbers now: Dada is first on Parwah.
  await admin.query(`update members set phone = null where id = any($1)`, [[rohan.id, kabir.id]]);
  const lost = (who, body) => call(locationH, who, { body });
  const on = await lost(papa, { action: 'lost_on', message: 'Please call my family' });
  const u = await one(`select lost_call from users where id = $1`, [papa.userId]);
  ok('A3 the Lost-mode default call person is never someone who has passed away', on.ok && u.lost_call === dadi.id, JSON.stringify([on, u, dada.id]));
  const pick = await lost(papa, { action: 'lost_on', callId: dada.id });
  ok('A3 and they cannot be picked for it either', pick.http === 400 && pick.field === 'call', JSON.stringify(pick));
  await admin.query(`update users set lost_at = null, lost_call = null where id = $1`, [papa.userId]);
  const ring = await lost(rohan, { action: 'ring', targetId: dada.id });
  ok('A3 their phone is never rung', ring.http === 400 && /remembered/.test(ring.error), JSON.stringify(ring));
  await admin.query(`update members set phone = $2 where id = $1`, [rohan.id, rohan.phone]);
  await admin.query(`update members set phone = $2 where id = $1`, [kabir.id, kabir.phone]);
  const lad = await call(care, rohan, { body: { action: 'ladder_add', personId: dada.id, name: 'Neighbour', phone: '+919811100088' } });
  ok('A3 nobody nearby is asked to watch over them', lad.http === 400, JSON.stringify(lad));
  const tk = await call(care, rohan, { body: { action: 'task_create', title: 'Fetch the post', ownerId: dada.id } });
  ok('A3 and no task is given to them', tk.http === 400 && /remembered/.test(tk.error), JSON.stringify(tk));
}

// ---- A4: every family, and a group only when it is open
const verma = await circle('VERMA1', 'Verma Family');
const friends = await circle('FRND01', 'College friends', 'group');
const priya = await person(sharma, 'Priya', { relation: 'daughter-in-law', dob: '1986-07-07' });
const priyaV = await person(verma, 'Priya', { relation: 'daughter', dob: '1986-07-07', as: priya });
const priyaF = await person(friends, 'Priya', { relation: 'friend', dob: '1986-07-07', as: priya });
const mummy = await person(verma, 'Mummy', { role: 'parent', relation: 'mother', dob: '1958-02-02' });
const nisha = await person(friends, 'Nisha', { relation: 'friend' });
for (const who of [priyaV, priyaF]) await call(events, who, { method: 'GET' });
{
  await freshLimits();
  const openIn = async c => rows(`select s.id, s.member_id from sos s where s.circle_id = $1 and s.status <> 'resolved'`, [c]);
  const r = await sos(priya);
  ok('A4 an SOS from one family reaches both of her families', r.ok && r.families === 2 && (await openIn(sharma)).length === 1 && (await openIn(verma)).length === 1,
    JSON.stringify([r.families, (await openIn(sharma)).length, (await openIn(verma)).length]));
  ok('A4 in the other family it is hers, under her membership there', (await openIn(verma))[0].member_id === priyaV.id);
  ok('A4 a group of friends does not hear when it is not the one open', (await openIn(friends)).length === 0);
  ok('A4 the other family reads it in its chat and its feed',
    (await rows(`select 1 from messages m join chats c on c.id = m.chat_id where c.circle_id = $1 and m.text like '🆘 SOS from Priya%'`, [verma])).length === 1
    && (await rows(`select 1 from events where circle_id = $1 and type = 'sos'`, [verma])).length === 1);
  ok('A4 the people to call come from both families, nobody twice', r.contacts.some(c => c.name === 'Mummy') && r.contacts.some(c => c.name === 'Rohan')
    && new Set(r.contacts.map(c => tail(c.phone))).size === r.contacts.length, JSON.stringify(r.contacts.map(c => c.name)));
  const g = await call(events, mummy, { method: 'GET' });
  ok('A4 her mother sees the SOS open on her own phone', g.sos && g.sos.length === 1 && g.sos[0].member_id === priyaV.id, JSON.stringify(g.sos));
  const again = await sos(priya);
  ok('A4 pressing again is the same SOS in each family, not a second one', again.again === true && (await openIn(verma)).length === 1 && (await openIn(sharma)).length === 1);
  const safe = await call(events, priya, { body: { type: 'sos_safe', sosId: r.sosId } });
  ok('A4 "I am safe" closes it in every family', safe.ok && (await openIn(sharma)).length === 0 && (await openIn(verma)).length === 0,
    JSON.stringify([(await openIn(sharma)).length, (await openIn(verma)).length]));
  await freshLimits();
  const fromGroup = await sos(priyaF);
  ok('A4 pressed with the group open: the group hears, and so do both families', fromGroup.families === 3 && (await openIn(friends)).length === 1
    && (await openIn(sharma)).length === 1 && (await openIn(verma)).length === 1, String(fromGroup.families));
  await call(events, priyaF, { body: { type: 'sos_safe', sosId: fromGroup.sosId } });
  ok('A4 and all three close together', (await openIn(friends)).length + (await openIn(sharma)).length + (await openIn(verma)).length === 0);
  void nisha;
}

// ---- A6: any sign of life counts as checked in
{
  const TZ = 'Asia/Kolkata', today = dayIn(TZ);
  await ensurePulseSchema(sql); await ensureDoseSchema(sql);
  const clean = async () => {
    await admin.query(`delete from events where member_id = $1`, [mummy.id]);
    await admin.query(`delete from messages where member_id = $1`, [mummy.id]);
    await admin.query(`delete from pulse where member_id = $1`, [mummy.id]);
    await admin.query(`delete from medicine_doses where marked_by = $1`, [mummy.id]);
  };
  await clean();
  ok('A6 no sign today: not checked in', (await okToday(sql, mummy.id, today, TZ)) === null);
  const chat = await ensureCircleChat(sql, verma);
  await admin.query(`insert into messages (chat_id, member_id, text, created_at) values ($1, $2, 'Good night beta', now() - interval '2 days')`, [chat, mummy.id]);
  ok('A6 a message from two days ago is not today', (await okToday(sql, mummy.id, today, TZ)) === null);
  await admin.query(`insert into messages (chat_id, member_id, text) values ($1, $2, 'Chai ho gayi')`, [chat, mummy.id]);
  ok('A6 a chat message today counts', !!(await okToday(sql, mummy.id, today, TZ)));
  // The sweep, an hour past her time: nobody is told she is missing.
  await admin.query(`update members set checkin_by = '00:01', tz = $2, quiet_nudged_for = null, quiet_alerted_for = null where id = $1`, [mummy.id, TZ]);
  const hour = +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()) % 24;
  if (hour >= 1) {
    const sentN = await quietSweep(sql, verma);
    const q = await one(`select quiet_nudged_for, quiet_alerted_for from members where id = $1`, [mummy.id]);
    ok('A6 so a parent who chatted is not reported as missing', sentN === 0 && !q.quiet_nudged_for && !q.quiet_alerted_for, JSON.stringify([sentN, q]));
    const st = await call(events, priyaV, { method: 'GET' });
    const row = st.familyCare.quiet.find(x => x.memberId === mummy.id);
    ok('A6 and the family sees her as checked in', row && row.phase === 'ok' && !row.alerted, JSON.stringify(row));
  } else { ok('A6 (sweep skipped in the first hour after midnight in India)', true); ok('A6 (sweep skipped)', true); }
  await clean();
  await admin.query(`insert into messages (chat_id, member_id, text) values ($1, $2, '🆘 SOS from Mummy at 9:00 AM. I need help now.')`, [chat, mummy.id]);
  ok('A6 an SOS message is not "I am alright"', (await okToday(sql, mummy.id, today, TZ)) === null);
  await clean();
  const med = await one(`insert into family_book (circle_id, kind, name, about_member, by_member) values ($1, 'med', 'Amlodipine', $2, $3) returning id`, [verma, mummy.id, priyaV.id]);
  const sch = await one(`insert into medicine_schedules (circle_id, person_id, medicine_id, times, tz, created_by) values ($1, $2, $3, '{08:00}', $4, $5) returning id`, [verma, mummy.id, med.id, TZ, priyaV.id]);
  await admin.query(`insert into medicine_doses (circle_id, person_id, medicine_id, schedule_id, slot, tz, due_at, status, taken_at, marked_by)
                     values ($1, $2, $3, $4, '08:00', $5, now() - interval '1 minute', 'taken', now(), $2)`, [verma, mummy.id, med.id, sch.id, TZ]);
  ok('A6 a medicine she ticked today counts', !!(await okToday(sql, mummy.id, today, TZ)));
  await clean();
  await call(events, mummy, { body: { type: 'pulse', value: (await call(events, mummy, { method: 'GET' })).pulse.options[0].k, tz: TZ } });
  ok('A6 a pulse answer counts', !!(await okToday(sql, mummy.id, today, TZ)));
  await clean();
  await call(events, mummy, { body: { type: 'checkin', text: 'All is well' } });
  ok('A6 and the tap itself, "All is well", still does', !!(await okToday(sql, mummy.id, today, TZ)));
  await admin.query(`update members set checkin_by = null where id = $1`, [mummy.id]);
  await admin.query(`delete from medicine_schedules where id = $1`, [sch.id]);
}

// ---- A7: someone else's check-in is paused only with their yes
{
  const TZ = 'Asia/Kolkata', today = dayIn(TZ);
  const until = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await admin.query(`update members set checkin_by = '11:00', tz = $2 where id = $1`, [mummy.id, TZ]);
  const away = async () => (await one(`select to_char(away_until, 'YYYY-MM-DD') as d, away_ask from members where id = $1`, [mummy.id]));
  const ask = await call(events, priyaV, { body: { type: 'quiet_away', targetId: mummy.id, until, tz: TZ } });
  ok('A7 pausing someone else\'s check-in is a question, not a change', ask.ok && ask.asked === true && (await away()).d === null && (await away()).away_ask === until, JSON.stringify([ask, await away()]));
  let st = await call(events, mummy, { method: 'GET' });
  let row = st.familyCare.quiet.find(x => x.memberId === mummy.id);
  ok('A7 she sees who asked, on her own phone', row && row.awayAsk === until && row.awayAskByName === 'Priya' && !row.awayUntil, JSON.stringify(row));
  const wrong = await call(events, priyaV, { body: { type: 'quiet_away_answer', yes: true } });
  ok('A7 nobody else can answer for her', wrong.http === 404 && (await away()).d === null, JSON.stringify(wrong));
  const no = await call(events, mummy, { body: { type: 'quiet_away_answer', yes: false } });
  ok('A7 "not now" leaves it exactly as it was', no.ok && no.declined && (await away()).d === null && (await away()).away_ask === null);
  await call(events, priyaV, { body: { type: 'quiet_away', targetId: mummy.id, until, tz: TZ } });
  const yes = await call(events, mummy, { body: { type: 'quiet_away_answer', yes: true, tz: TZ } });
  ok('A7 her yes is what pauses it', yes.ok && yes.awayUntil === until && (await away()).d === until, JSON.stringify([yes, await away()]));
  const back = await call(events, priyaV, { body: { type: 'quiet_away', targetId: mummy.id, until: null, tz: TZ } });
  ok('A7 turning it back on for her is asked too', back.asked === true && (await away()).d === until);
  const own = await call(events, mummy, { body: { type: 'quiet_away', until: null, tz: TZ } });
  ok('A7 she can always change her own, at once', own.ok && !own.asked && (await away()).d === null && (await away()).away_ask === null);
  const mine = await call(events, mummy, { body: { type: 'quiet_away', until: today, tz: TZ } });
  ok('A7 and pause her own, at once', mine.ok && mine.awayUntil === today && (await away()).d === today);
  await admin.query(`update members set checkin_by = null, away_until = null where id = $1`, [mummy.id]);
}

// ---- A8: medicines
{
  const TZ = 'Asia/Kolkata';
  await ensureTaskSchema(sql);
  const med = await one(`insert into family_book (circle_id, kind, name, about_member, by_member) values ($1, 'med', 'Telma 40', $2, $3) returning id`, [sharma, papa.id, rohan.id]);
  const sch = await one(`insert into medicine_schedules (circle_id, person_id, medicine_id, times, tz, created_by, since) values ($1, $2, $3, '{08:00}', $4, $5, now() - interval '3 days') returning id`,
    [sharma, papa.id, med.id, TZ, rohan.id]);
  const dose = async (personId, medId, schId, minsAgo) => (await one(`insert into medicine_doses (circle_id, person_id, medicine_id, schedule_id, slot, tz, due_at)
    values ($1, $2, $3, $4, '08:00', $5, now() - make_interval(mins => $6)) returning id`, [sharma, personId, medId, schId, TZ, minsAgo])).id;
  const ids = async (personId, medId) => (await doseAlertTo(sql, sharma, personId, [medId])).map(r => r.id).sort();
  const st0 = await doseTellState(sql, sharma, papa.id);
  ok('A8 he is asked once, because he has medicine times and has not answered', st0 && st0.on === null && st0.ask === true, JSON.stringify(st0));
  ok('A8 until he answers, nobody in the family is told', (await ids(papa.id, med.id)).length === 0);
  const g0 = await call(events, papa, { method: 'GET' });
  ok('A8 the question reaches his own phone with the family state', g0.safety && g0.safety.doseTell && g0.safety.doseTell.ask === true, JSON.stringify(g0.safety && g0.safety.doseTell));
  const other = await call(care, rohan, { body: { action: 'dose_tell_set', on: true } });
  const pv = await one(`select dose_tell from members where id = $1`, [papa.id]);
  ok('A8 nobody else can answer for him', other.ok && pv.dose_tell === null, JSON.stringify([other, pv]));
  await admin.query(`update members set dose_tell = null where id = $1`, [rohan.id]);
  const no = await call(care, papa, { body: { action: 'dose_tell_set', on: false } });
  ok('A8 he says no: nobody is told, and he is not asked again', no.ok && (await ids(papa.id, med.id)).length === 0 && (await doseTellState(sql, sharma, papa.id)).ask === false);
  const yes = await call(care, papa, { body: { action: 'dose_tell_set', on: true } });
  const told = await ids(papa.id, med.id);
  ok('A8 he says yes: the family on Parwah is told', yes.ok && told.includes(rohan.id) && told.includes(priya.id) && !told.includes(papa.id), JSON.stringify(told));
  ok('A8 never someone who has passed away', !told.includes(dada.id));
  // Dadi is not on Parwah: only Rohan, who set her times and marks them.
  const medD = await one(`insert into family_book (circle_id, kind, name, about_member, by_member) values ($1, 'med', 'Calcium', $2, $3) returning id`, [sharma, dadi.id, rohan.id]);
  const schD = await one(`insert into medicine_schedules (circle_id, person_id, medicine_id, times, tz, created_by, since) values ($1, $2, $3, '{08:00}', $4, $5, now() - interval '3 days') returning id`,
    [sharma, dadi.id, medD.id, TZ, rohan.id]);
  ok('A8 for someone not on Parwah, only the one carer who marks is told', (await ids(dadi.id, medD.id)).join() === rohan.id, JSON.stringify(await ids(dadi.id, medD.id)));
  await admin.query(`update medicine_schedules set created_by = null where id = $1`, [schD.id]);
  ok('A8 and with no carer named, nobody: never the whole family', (await ids(dadi.id, medD.id)).length === 0);
  // The sweep claims the alert either way, so it is decided once.
  await admin.query(`update members set dose_tell = false where id = $1`, [papa.id]);
  const late = await dose(papa.id, med.id, sch.id, 150);
  await sweepDoses(sql, sharma);
  const lateRow = await one(`select alerted_at, status from medicine_doses where id = $1`, [late]);
  const hourIn = +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()) % 24;
  ok('A8 the sweep runs without telling anyone he said not to tell', lateRow.status === 'due' && (hourIn < 7 || hourIn >= 22 || lateRow.alerted_at !== null), JSON.stringify(lateRow));
  // Ran out: a task for the family, not a missed dose.
  const d1 = await dose(papa.id, med.id, sch.id, 10);
  const skip = await call(care, papa, { body: { action: 'dose_mark', doseId: d1, status: 'skipped', reason: 'Ran out', tz: TZ } });
  const task = await rows(`select id, title, status, about_member, claimed_by from requests where circle_id = $1 and title like 'Get more%'`, [sharma]);
  ok('A8 "Ran out" makes one open task for the family', skip.ok && task.length === 1 && task[0].title === 'Get more Telma 40 for Papa' && task[0].status === 'open' && task[0].about_member === papa.id && !task[0].claimed_by,
    JSON.stringify([skip, task]));
  const d1row = await one(`select status, alerted_at from medicine_doses where id = $1`, [d1]);
  ok('A8 and that dose is skipped, never a missed alert', d1row.status === 'skipped' && d1row.alerted_at === null);
  const d2 = await dose(papa.id, med.id, sch.id, 5);
  await call(care, rohan, { body: { action: 'dose_mark', doseId: d2, status: 'skipped', reason: 'Ran out', tz: TZ } });
  ok('A8 ran out again while the task is open: still one task', (await rows(`select id from requests where circle_id = $1 and title like 'Get more%'`, [sharma])).length === 1);
  await admin.query(`update family_book set visibility = 'private' where id = $1`, [med.id]);
  const d3 = await dose(papa.id, med.id, sch.id, 3);
  await call(care, papa, { body: { action: 'dose_mark', doseId: d3, status: 'skipped', reason: 'Ran out', tz: TZ } });
  const priv = await rows(`select title from requests where circle_id = $1 and title like 'Get more%' order by created_at`, [sharma]);
  ok('A8 a private medicine is never named in the family task', priv.length === 2 && priv[1].title === 'Get more medicines for Papa', JSON.stringify(priv));
  const d4 = await dose(papa.id, med.id, sch.id, 2);
  await call(care, papa, { body: { action: 'dose_mark', doseId: d4, status: 'skipped', reason: 'Felt unwell', tz: TZ } });
  ok('A8 any other reason makes no task', (await rows(`select id from requests where circle_id = $1 and title like 'Get more%'`, [sharma])).length === 2);
}

// ---- A10 + A11: the Guptas. Bauji is on Parwah and has not opened it in 40 days.
const gupta = await circle('GUPTA1', 'Gupta Family');
const kamla = await person(gupta, 'Kamla', { relation: 'daughter', dob: '1975-01-01' });
const vimla = await person(gupta, 'Vimla', { relation: 'sister', dob: '1978-01-01' });
const bauji = await person(gupta, 'Bauji', { role: 'parent', relation: 'father', dob: '1945-01-01' });
const chintu = await person(gupta, 'Chintu', { relation: 'son', dob: null });
const bahu = await person(gupta, 'Bahu', { relation: 'daughter-in-law', dob: null });
const amma = await named(gupta, 'Amma', '+919822200001');
for (const who of [kamla]) await call(events, who, { method: 'GET' });
const quietFor = (who, days) => admin.query(`update sessions set last_used_at = now() - make_interval(days => $2) where user_id = $1`, [who.userId, days]);
const isGone = async who => (await one(`select remembered from members where id = $1`, [who.id])).remembered;
const al = (who, body) => call(book, who, { body });
await quietFor(bauji, 40);
{
  const kid = await al(chintu, { action: 'afterloss_start', personId: amma.id });
  ok('A10 no date of birth and no adult role: cannot start the list', kid.http === 403 && /date of birth/.test(kid.error), JSON.stringify(kid));
  const asKid = await al(kamla, { action: 'afterloss_start', personId: amma.id, askId: chintu.id });
  ok('A10 and cannot be the second adult either', asKid.http === 400 && asKid.field === 'ask', JSON.stringify(asKid));
  const byRole = await al(kamla, { action: 'afterloss_start', personId: amma.id, askId: bahu.id });
  ok('A10 no date of birth but an adult role (a daughter-in-law): counts', byRole.ok && byRole.state === 'pending', JSON.stringify(byRole));
  await al(kamla, { action: 'afterloss_cancel', listId: byRole.id });

  await quietFor(bauji, 3);
  const recent = await al(kamla, { action: 'afterloss_start', personId: bauji.id, askId: vimla.id });
  ok('A10 someone who used Parwah this month: no list is started about them', recent.http === 409 && recent.recent === true && /used Parwah recently/.test(recent.error), JSON.stringify(recent));
  ok('A10 and nothing was made', (await rows(`select id from afterloss_lists where person_id = $1`, [bauji.id])).length === 0);
  await quietFor(bauji, 40);
  const start = await al(kamla, { action: 'afterloss_start', personId: bauji.id, askId: vimla.id });
  ok('A10 quiet for 40 days: the first adult can ask the second', start.ok && start.state === 'pending', JSON.stringify(start));
  // Before Vimla answers, Bauji opens Parwah.
  await quietFor(bauji, 0);
  const confirm = await al(vimla, { action: 'afterloss_confirm', listId: start.id });
  const l = await one(`select status from afterloss_lists where id = $1`, [start.id]);
  ok('A10 he opened Parwah before the second adult answered: the confirm is refused', confirm.http === 409 && confirm.recent === true && l.status === 'pending' && !(await isGone(bauji)), JSON.stringify([confirm, l]));
  await al(kamla, { action: 'afterloss_cancel', listId: start.id });
}
{
  const mark = (who, body) => call(circleH, who, { body: { action: 'remember_mark', year: 2026, ...body } });
  await quietFor(bauji, 40);
  const alone = await mark(kamla, { targetId: bauji.id });
  ok('A11 one adult alone cannot mark someone who is on Parwah', alone.http === 400 && alone.field === 'ask' && alone.needsSecond === true && !(await isGone(bauji)), JSON.stringify(alone));
  ok('A11 the reply lists who can be the second adult', alone.adults.map(a => a.name).sort().join() === 'Bahu,Vimla', JSON.stringify(alone.adults));
  const kidAsk = await mark(kamla, { targetId: bauji.id, askId: chintu.id });
  ok('A11 a member with no date of birth and no adult role cannot be the second', kidAsk.http === 400 && kidAsk.field === 'ask');
  const selfAsk = await mark(kamla, { targetId: bauji.id, askId: kamla.id });
  ok('A11 nor can the first adult name themself', selfAsk.http === 400);
  const asked = await mark(kamla, { targetId: bauji.id, askId: vimla.id, month: 10, day: 2, line: 'He taught us all to ride a cycle' });
  ok('A11 with a second adult named it waits, and nothing about him changes', asked.ok && asked.pending === true && asked.askName === 'Vimla' && !(await isGone(bauji)), JSON.stringify(asked));
  const forV = await rememberAsksFor(sql, gupta, vimla.id), forC = await rememberAsksFor(sql, gupta, chintu.id), forB = await rememberAsksFor(sql, gupta, bauji.id);
  ok('A11 the second adult sees it waiting, with who asked', forV.length === 1 && forV[0].canConfirm && forV[0].byName === 'Kamla' && forV[0].name === 'Bauji', JSON.stringify(forV));
  ok('A11 the person it is about can see it too; the rest of the family cannot', forB.length === 1 && !forB[0].canConfirm && forC.length === 0);
  const gv = await call(events, vimla, { method: 'GET' });
  ok('A11 and it comes with the family state', gv.safety.rememberAsks.length === 1 && gv.safety.rememberAsks[0].canConfirm === true);
  const byStarter = await call(circleH, kamla, { body: { action: 'remember_confirm', targetId: bauji.id } });
  const byOther = await call(circleH, bahu, { body: { action: 'remember_confirm', targetId: bauji.id } });
  ok('A11 only the adult who was asked can confirm', byStarter.http === 403 && byOther.http === 403 && !(await isGone(bauji)));
  // He opens Parwah while it waits: it cannot be confirmed.
  await quietFor(bauji, 0);
  const tooLate = await call(circleH, vimla, { body: { action: 'remember_confirm', targetId: bauji.id } });
  ok('A11 if he opens Parwah while it waits, the confirm is refused', tooLate.http === 409 && tooLate.recent === true && !(await isGone(bauji)), JSON.stringify(tooLate));
  const stop = await call(circleH, bauji, { body: { action: 'remember_cancel', targetId: bauji.id } });
  ok('A11 and he can take the request back himself', stop.ok && (await rememberAsksFor(sql, gupta, vimla.id)).length === 0, JSON.stringify(stop));
  await quietFor(bauji, 40);
  await mark(kamla, { targetId: bauji.id, askId: vimla.id, month: 10, day: 2 });
  const [c1, c2] = await Promise.all([call(circleH, vimla, { body: { action: 'remember_confirm', targetId: bauji.id } }),
                                      call(circleH, vimla, { body: { action: 'remember_confirm', targetId: bauji.id } })]);
  const b = await one(`select remembered, passed_year, passed_month, passed_day, remembered_by from members where id = $1`, [bauji.id]);
  ok('A11 the second adult confirms: now he is marked, with the day the first adult wrote', (c1.ok || c2.ok) && b.remembered && b.passed_year === 2026 && b.passed_month === 10 && b.passed_day === 2 && b.remembered_by === kamla.id,
    JSON.stringify([c1, c2, b]));
  ok('A11 two taps confirm once', [c1, c2].filter(x => x.ok).length === 1 && (await rows(`select id from events where circle_id = $1 and text like '%marked Bauji as no longer with us%'`, [gupta])).length === 1);
  const undo = await call(circleH, bauji, { body: { action: 'remember_undo', targetId: bauji.id } });
  ok('A11 and the person who was marked can still undo it', undo.ok && !(await isGone(bauji)), JSON.stringify(undo));
  const byName = await mark(kamla, { targetId: amma.id });
  ok('A11 a name in the tree, who is not on Parwah, is still marked by one adult', byName.ok && !byName.pending && (await isGone(amma)), JSON.stringify(byName));
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`safety.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
