// "AAJ KYA HUA" AGAINST A REAL DATABASE: the real api/ekta.mjs handler and
// the real feature handlers on a throwaway PostgreSQL, with NO network and
// NO AI key, the way most families run it. Then again with a FAKE model put
// in through the test seam; the real API is never called.
//
// What it proves:
//   - with no key the digest is complete: plain sentences, most important first;
//   - a member never sees another member's private things in it: a private
//     note, an "only me" register entry, a recommendation between two other
//     people, a private medicine, a private story, a card meant for them;
//   - it is kept per member per day, and a new SOS adds one "Since then" line;
//   - thumbs up or down is one per member per day;
//   - the 8pm notification is claimed once, and never asks the model;
//   - someone from another family is refused;
//   - with a model: only the list is sent, one call per member per day, at
//     most 12 a circle a day, and a timeout, a refusal or a bad reply all
//     fall back to the plain version without a word.
//
// The time of day is never the real hour: the viewer's zone is picked so it
// is 7pm (or 10am) there right now, and the timer is given its own clock.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('digest.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('digest.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
for (const k of Object.keys(process.env)) if (/^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|GROQ|MISTRAL|DEEPSEEK|XAI|GROK|KIMI|MOONSHOT|OLLAMA|TWILIO|CRON_SECRET)/.test(k)) delete process.env[k];
const netCalls = [];
globalThis.fetch = async (u) => { netCalls.push(String(u)); throw new Error('offline in this test'); };

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: ekta } = await import('../../../api/ekta.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { default: games } = await import('../../../api/games.mjs');
const { default: plans } = await import('../../../api/plans.mjs');
const { default: events, runTick } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { ensureCoinSchema } = await import('../../../api/_coins.mjs');
const { ensureDoseSchema } = await import('../../../api/_doses.mjs');
const { ensureFamilyCareSchema } = await import('../../../api/_familycare.mjs');
const MB = await import('../../../api/_memorybond.mjs');
const BOND = await import('../../../api/_bond.mjs');
const D = await import('../../../api/_digest.mjs');
const R = await import('../../../api/_digestrules.mjs');
const RM = await import('../../../api/_remember.mjs');
const RR = await import('../../../api/_rememberrules.mjs');

const sql = db();
await ensureSchema(sql);
await ensureCoinSchema(sql);
await ensureDoseSchema(sql);
await ensureFamilyCareSchema(sql);
await MB.ensureBondSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail === undefined ? '' : ' -> ' + detail)); };
const rows = async (q, p) => (await admin.query(q, p)).rows;

// A zone where it is this hour right now. Etc/GMT-5 is five hours AHEAD of
// UTC. 27 whole-hour zones cover every hour of the day, so one always fits.
function zoneAt(hour) {
  for (let off = -12; off <= 14; off++) {
    const z = 'Etc/GMT' + (off <= 0 ? '+' + (-off) : '-' + off);
    if (R.digestHour(Date.now(), z) === hour) return { zone: z, off };
  }
  throw new Error('no zone is at hour ' + hour);
}
const EVE = zoneAt(19), MORN = zoneAt(10);
// Tomorrow at 1pm, and tomorrow's month and day, in the evening zone.
const local = new Date(Date.now() + EVE.off * 3600000);
const tomorrow1pm = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 13) - EVE.off * 3600000);
const tomorrowMd = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1)).toISOString().slice(5, 10);

let phoneN = 0;
async function person(circleId, code, name, role = 'family') {
  const phone = '+9198300' + String(++phoneN).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1, '+91', $2, $3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id, created_at) values ($1, $2, $3, $4, now() - interval '40 days') returning id`, [circleId, name, role, u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, name, token, code, phone };
}
async function call(handler, who, body, { tz = EVE.zone, method = 'POST', query = {}, as = null } = {}) {
  const req = { method, headers: { 'x-parwah-token': who.token, 'x-forwarded-for': '10.3.3.3', 'x-parwah-tz': tz },
                body: { code: who.code, memberId: as || who.id, ...body }, query: { circle: who.code, member: as || who.id, ...query } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...json, status };
}
const digest = (who, opts) => call(ekta, who, { action: 'digest' }, opts);

const fam = (await admin.query(`insert into circles (code, name) values ('DIGEST', 'Kapoor Family') returning id`)).rows[0].id;
const rohan = await person(fam, 'DIGEST', 'Rohan');
const papa = await person(fam, 'DIGEST', 'Papa', 'parent');
const maa = await person(fam, 'DIGEST', 'Maa', 'parent');
const priya = await person(fam, 'DIGEST', 'Priya');
const chachu = await person(fam, 'DIGEST', 'Chachu');
const other = (await admin.query(`insert into circles (code, name) values ('GUPTA1', 'Gupta Family') returning id`)).rows[0].id;
const kamla = await person(other, 'GUPTA1', 'Kamla');

// The plans table is made by its own route; the cards table sits on top of it.
await call(plans, rohan, {}, { method: 'GET' });
await BOND.ensureBondSchema(sql);

// The model stand-in records every call. With no key it must never be reached.
const modelCalls = [];
let modelReply = async () => ({ text: '', model: 'fake-model' });
D.digestSeams.callModel = async (p) => { modelCalls.push(p); return modelReply(p); };
// The clock: a moment after now, so rows written through the real handlers
// (stamped by the database) are already in the past. Frozen where it matters.
let frozen = null;
D.digestSeams.now = () => frozen === null ? Date.now() + 3000 : frozen;
const pushes = [];
D.digestSeams.push = async (_sql, circleId, payload, opts) => { pushes.push({ circleId, ...payload, only: opts && opts.only }); };

// =====================================================================
// 1. NO KEY, NO NETWORK: a quiet day
// =====================================================================
{
  const r = await digest(rohan);
  ok('a quiet day: answered, with no key anywhere', r.status === 200 && r.ok && r.digest, JSON.stringify(r).slice(0, 200));
  ok('one kind line', r.digest.text === 'It was a quiet day in the family today, with nothing new to tell.' && r.digest.quiet === true, r.digest.text);
  ok('written plainly: no "Written by Ekta" line', r.digest.by === 'plain' && r.digest.how === '');
  ok('it is evening there (7pm in the zone the phone sent), so this is the day\'s digest', r.digest.final === true);
  ok('"Tell me each evening" is off until asked for', r.digest.evening === false);
  await admin.query(`delete from digest_daily`);
}

// =====================================================================
// 2. THE FAMILY HAS A DAY, through the real handlers
// =====================================================================
ok('Papa checks in', (await call(events, papa, { type: 'checkin', text: '' })).status === 201);
ok('Rohan makes a plan for tomorrow', (await call(plans, rohan, { action: 'create', title: 'Sunday lunch', kind: 'meet', at: tomorrow1pm.toISOString() })).status === 201);
await admin.query(`update members set dob = $1 where id = $2`, ['1975-' + tomorrowMd, chachu.id]);
// Priya recommends a show to Rohan, and another to Maa only.
const gcall = (who, body) => call(games, who, { area: 'pasand', ...body }, { query: { area: 'pasand' } });
ok('Priya recommends Panchayat to Rohan', (await gcall(priya, { action: 'rec_add', title: 'Panchayat', kind: 'show', to: [rohan.id] })).ok === true);
ok('and something else to Maa only', (await gcall(priya, { action: 'rec_add', title: 'SECRET-SHOW-4455', kind: 'show', to: [maa.id] })).ok === true);
// A private note (Priya's) and an "only me" register entry (Papa's).
{
  const n = await call(book, priya, { area: 'notes', action: 'add', title: 'PRIVATE-NOTE-9911', body: 'Gift ideas for Rohan', private: true }, { query: { area: 'notes' } });
  ok('Priya keeps a private note', n.status === 201, JSON.stringify(n));
  const l = await call(book, papa, { action: 'locator_add', personId: papa.id, category: 'LAND', institutionOrItem: 'REGISTER-LOCKER-7722',
    physicalLocationNotes: 'Papers in the steel almirah', unlockPolicy: 'ONLY_ME' });
  ok('Papa keeps an "only me" register entry', l.ok === true, JSON.stringify(l).slice(0, 200));
}
// Maa's medicine is shared with the family: one time not marked, three hours
// ago. Papa's is private to him: marked as taken.
async function med(about, name, visibility, status, hoursAgo) {
  const b = (await rows(`insert into family_book (circle_id, kind, name, by_member, about_member, visibility) values ($1, 'med', $2, $3, $3, $4) returning id`, [fam, name, about.id, visibility]))[0].id;
  const s = (await rows(`insert into medicine_schedules (circle_id, person_id, medicine_id, times, tz) values ($1, $2, $3, '{08:00}', 'UTC') returning id`, [fam, about.id, b]))[0].id;
  await rows(`insert into medicine_doses (circle_id, person_id, medicine_id, schedule_id, slot, tz, due_at, status, taken_at)
              values ($1, $2, $3, $4, '08:00', 'UTC', now() - make_interval(hours => $5), $6, case when $6 = 'taken' then now() end)`, [fam, about.id, b, s, hoursAgo, status]);
}
await med(maa, 'MEDNAME-THYRO', 'circle', 'due', 3);
await med(papa, 'MEDNAME-PRIVATE', 'private', 'taken', 2);
// Papa told a story for himself only; Maa told one for everyone.
await rows(`insert into stories (circle_id, about_member, question, answer_text, visibility, ask_week, answered_at) values ($1, $2, 'A day at school?', 'SECRET-STORY-TEXT', 'private', current_date, now())`, [fam, papa.id]);
await rows(`insert into stories (circle_id, about_member, question, answer_text, visibility, ask_week, answered_at) values ($1, $2, 'Your first job?', 'A bank in Kanpur', 'circle', current_date, now())`, [fam, maa.id]);
// Priya starts a card for Rohan: a surprise for him.
await rows(`insert into cards (circle_id, for_member, occasion, title, date, by_member) values ($1, $2, 'other', 'SURPRISE-CARD for Rohan', current_date + 5, $3)`, [fam, rohan.id, priya.id]);

const SECRETS = ['PRIVATE-NOTE-9911', 'Gift ideas', 'REGISTER-LOCKER-7722', 'almirah', 'SECRET-SHOW-4455', 'MEDNAME', 'SECRET-STORY-TEXT', 'SURPRISE-CARD', 'Kanpur'];
let rohanFirst;
{
  const r = await digest(rohan);
  rohanFirst = r.digest;
  const t = r.digest.text;
  ok('the digest works with no model', r.status === 200 && r.digest.by === 'plain' && r.digest.final === true, JSON.stringify(r).slice(0, 300));
  ok('the heaviest thing first: Maa\'s medicine time was not marked', t.startsWith("Maa's medicines were not marked today."), t);
  ok('then tomorrow: Chachu\'s birthday and the lunch at 1:00 pm', /Tomorrow is Chachu's birthday\./.test(t) && /Tomorrow at 1:00 pm: Sunday lunch\./.test(t), t);
  ok('Papa checked in, with the time in Rohan\'s zone', new RegExp('Papa checked in at ' + R.digestClock(Date.now(), EVE.zone).replace(/:\d\d /, ':\\d\\d ') + '\\.').test(t), t);
  ok('Priya\'s recommendation for Rohan is there', /Priya recommended something for you: Panchayat\./.test(t), t);
  ok('Maa\'s story for everyone is there (the fact, not its words)', /Maa told a new story\./.test(t) || /more small thing/.test(t), t);
  ok('the plan made today for tomorrow is said once', (t.match(/Sunday lunch/g) || []).length === 1);
  ok('3 to 6 sentences and a count of the rest', t.split(/(?<=\.)\s+/).length >= 3 && t.split(/(?<=\.)\s+/).length <= 7 && t.length <= 700, t);
  ok('NOTHING PRIVATE: no private note, no "only me" register entry, no recommendation between two other people, no private medicine or story, no card meant for him',
     SECRETS.every(s => t.indexOf(s) < 0), SECRETS.filter(s => t.indexOf(s) >= 0).join());
  ok('Papa\'s private medicine is not counted for Rohan', !/Papa's medicines/.test(t));
  ok('no model was called and nothing went to the network', modelCalls.length === 0 && netCalls.length === 0, netCalls.join());
  ok('no coin was spent on it', (await rows(`select count(*)::int as n from coins where circle_id = $1 and delta < 0`, [fam]))[0].n === 0);
  // The list itself, as the server gathered it for Rohan.
  const raw = await D.digestGather(sql, { id: fam, kind: 'family' }, { id: rohan.id }, EVE.zone, Date.now() + 3000);
  const list = R.digestFacts(raw);
  ok('the list for Rohan holds nothing private either', SECRETS.every(s => JSON.stringify(raw).indexOf(s) < 0) && SECRETS.every(s => JSON.stringify(list).indexOf(s) < 0));
  ok('the rows gathered carry no phone, no email and no medicine name', !/\+91|@|MEDNAME/.test(JSON.stringify(raw)));
  ok('every fact has kind, who, text and weight', list.length >= 5 && list.every(f => f.kind && f.text && f.weight > 0 && typeof f.who === 'string'));
}
{
  // The same day, as each of the others sees it.
  const p = (await digest(papa)).digest.text, m = (await digest(maa)).digest.text;
  ok('Papa sees his own: "You checked in", and his own private medicine', /You checked in at /.test(p) && /Your medicines were all marked as taken today\./.test(p), p);
  ok('Papa is not told about Priya\'s recommendations or her note', !/Panchayat|SECRET-SHOW|PRIVATE-NOTE/.test(p));
  ok('Maa sees the recommendation sent to her, not the one sent to Rohan', /SECRET-SHOW-4455/.test(m) && !/Panchayat/.test(m), m);
  ok('Maa sees that Priya started a card for Rohan; Rohan does not', /Priya started a card for Rohan\./.test(m) || /more small thing/.test(m), m);
  ok('Maa: "Your medicines were not marked today."', m.startsWith('Your medicines were not marked today.'), m);
  ok('nobody but Papa is told his "only me" entry or his private story exist', !/REGISTER|SECRET-STORY/.test(p + m));
}

// =====================================================================
// 3. KEPT PER MEMBER PER DAY, and "Since then"
// =====================================================================
{
  const again = (await digest(rohan)).digest;
  ok('opening it again gives the same text, written at the same time', again.text === rohanFirst.text && String(again.writtenAt) === String(rohanFirst.writtenAt));
  ok('nothing has changed, so no "Since then" line', again.since === '');
  ok('one row per member per day', (await rows(`select count(*)::int as n from digest_daily where member_id = $1`, [rohan.id]))[0].n === 1
     && (await rows(`select count(*)::int as n from digest_daily where circle_id = $1`, [fam]))[0].n === 3);
  // A small new thing does not disturb it.
  await rows(`insert into recipes (circle_id, by_member, title) values ($1, $2, 'Aloo paratha')`, [fam, maa.id]);
  ok('a new recipe does not earn a line', (await digest(rohan)).digest.since === '');
  // A new SOS does.
  const s = await call(events, papa, { type: 'sos', text: '' });
  ok('Papa raises an SOS', s.status === 201 && s.sosId, JSON.stringify(s).slice(0, 200));
  const after = (await digest(rohan)).digest;
  ok('the kept text is unchanged', after.text === rohanFirst.text && String(after.writtenAt) === String(rohanFirst.writtenAt));
  ok('with one line: "Since then: Papa raised an SOS at ... and it is still open."', /^Since then: Papa raised an SOS at \d{1,2}:\d\d [ap]m and it is still open\.$/.test(after.since), after.since);
  ok('still no model call', modelCalls.length === 0);
  await call(events, rohan, { type: 'sos_resolve', sosId: s.sosId });
  const closed = (await digest(rohan)).digest;
  ok('once it is closed, the line says so', /^Since then: Papa raised an SOS at .* and it was closed at \d{1,2}:\d\d [ap]m\.$/.test(closed.since), closed.since);
  // Someone who has not looked yet today gets it in the digest itself, first.
  const c = (await digest(chachu)).digest;
  ok('for someone opening now, the SOS leads the digest', c.text.startsWith('Papa raised an SOS at ') && c.since === '', c.text);
  ok('and tomorrow is "your birthday" for Chachu', /Tomorrow is your birthday\./.test(c.text), c.text);
}

// =====================================================================
// 4. BEFORE 6PM it is "the day so far": not kept, never the model
// =====================================================================
{
  const { ensureTaskSchema } = await import('../../../api/_tasks.mjs');
  await ensureTaskSchema(sql);
  const m1 = (await digest(priya, { tz: MORN.zone })).digest;
  ok('at 10am the digest is the day so far, not the day\'s final note', m1.final === false && m1.by === 'plain' && m1.since === '', JSON.stringify(m1).slice(0, 200));
  await rows(`insert into requests (circle_id, by_member, title, status, completed_by, completed_at) values ($1, $2, 'Book the gas refill', 'done', $2, now())`, [fam, priya.id]);
  const m2 = (await digest(priya, { tz: MORN.zone })).digest;
  ok('a look later in the morning is rewritten with what is new', m2.final === false && m2.text !== m1.text && /You finished a task today\./.test(m2.text + ' ' + m2.text), m2.text);
  ok('a task is a count, never its title', !/gas refill/.test(m2.text));
}

// =====================================================================
// 5. THUMBS: one per member per day
// =====================================================================
{
  const v = (who, vote, opts) => call(ekta, who, { action: 'digest_vote', vote }, opts);
  ok('thumbs up is stored', (await v(rohan, 'up')).vote === 'up' && (await rows(`select vote from digest_daily where member_id = $1`, [rohan.id]))[0].vote === 1);
  ok('and comes back with the digest', (await digest(rohan)).digest.vote === 'up');
  ok('a second tap changes it, it does not add one', (await v(rohan, 'down')).vote === 'down'
     && (await rows(`select count(*)::int as n, min(vote) as v from digest_daily where member_id = $1`, [rohan.id]))[0].v === -1);
  ok('anything else is refused', (await v(rohan, 'maybe')).status === 400);
  ok('there is nothing to judge before the note is opened', (await v(kamla, 'up')).status === 404);
}

// =====================================================================
// 6. AN OUTSIDER, AND SOMEONE ELSE'S MEMBERSHIP
// =====================================================================
{
  const a = await call(ekta, { ...kamla, code: 'DIGEST' }, { action: 'digest' });
  ok('someone from another family is refused', a.status === 403 && !a.digest, JSON.stringify(a));
  const b = await call(ekta, { ...kamla, code: 'DIGEST' }, { action: 'digest' }, { as: rohan.id });
  ok('and cannot read Rohan\'s digest by sending his id', b.status === 403 && !b.digest, JSON.stringify(b));
  const c = await call(ekta, { ...priya }, { action: 'digest' }, { as: rohan.id });
  ok('nor can another member of the same family', c.status === 403 && !c.digest);
  const d = await call(ekta, { ...rohan, token: 'not-a-token' }, { action: 'digest' });
  ok('no session, no digest', d.status === 401 && !d.digest);
  ok('an unknown digest action is refused in plain words', (await call(ekta, rohan, { action: 'digest_everything' })).status === 400);
  const own = (await digest(kamla)).digest;
  ok('Kamla\'s own family has a quiet day: nothing of the Kapoors', /quiet day/.test(own.text) && !/Papa|Maa|Rohan/.test(own.text), own.text);
}

// =====================================================================
// 7. "TELL ME EACH EVENING": once, at 8pm their time, never the model
// =====================================================================
{
  const set = (who, on, opts) => call(ekta, who, { action: 'digest_evening', on }, opts);
  ok('off by default: the timer has nobody to tell', (await D.digestSweep(sql, fam)) === 0 && pushes.length === 0);
  ok('Rohan turns it on', (await set(rohan, true, { tz: 'Asia/Kolkata' })).evening === true && (await digest(rohan)).digest.evening === true);
  await rows(`update digest_prefs set tz = 'Asia/Kolkata' where member_id = $1`, [rohan.id]);
  // The timer's own clock: 4 March 2031 in India, a day with nothing in it.
  const ist = (h, mi) => Date.UTC(2031, 2, 4, h, mi) - 5.5 * 3600000;
  ok('at 7:59pm nothing is sent', (await D.digestSweep(sql, fam, ist(19, 59))) === 0 && pushes.length === 0);
  const n = await Promise.all([1, 2, 3, 4, 5, 6].map(() => D.digestSweep(sql, fam, ist(20, 0))));
  ok('at 8:00pm, six timers at once send ONE', n.reduce((a, b) => a + b, 0) === 1 && pushes.length === 1, n.join());
  ok('to Rohan only, with the first sentence of the plain version', pushes[0].only === rohan.id && pushes[0].title === '🌙 Aaj kya hua'
     && pushes[0].body === 'It was a quiet day in the family today, with nothing new to tell.' && pushes[0].url === '/#home', JSON.stringify(pushes[0]));
  ok('and not again that evening', (await D.digestSweep(sql, fam, ist(20, 30))) === 0 && (await D.digestSweep(sql, fam, ist(21, 45))) === 0 && pushes.length === 1);
  ok('the next evening, once more', (await D.digestSweep(sql, fam, ist(20, 5) + 86400000)) === 1 && pushes.length === 2);
  ok('nobody is woken after 10pm', (await rows(`update digest_prefs set pushed_for = null where member_id = $1 returning 1`, [rohan.id])).length === 1
     && (await D.digestSweep(sql, fam, ist(22, 0))) === 0 && (await D.digestSweep(sql, fam, ist(23, 30))) === 0 && pushes.length === 2);
  // Through the real timer, with a zone where it is 8pm right now.
  const at8 = zoneAt(20).zone;
  await rows(`update digest_prefs set tz = $2, pushed_for = null where member_id = $1`, [rohan.id, at8]);
  await runTick(sql);
  ok('the real timer (runTick) sends it, with today\'s first sentence', pushes.length === 3 && pushes[2].only === rohan.id && /^Papa raised an SOS at \d{1,2}:\d\d [ap]m, and it was closed at /.test(pushes[2].body), JSON.stringify(pushes[2]));
  await runTick(sql);
  ok('and a second run of the timer sends nothing more', pushes.length === 3);
  ok('the timer never asked the model, and nothing went to the network', modelCalls.length === 0 && netCalls.length === 0);
  ok('Rohan turns it off, and the timer stops', (await set(rohan, false)).evening === false
     && (await rows(`update digest_prefs set pushed_for = null where member_id = $1 returning 1`, [rohan.id])).length === 1
     && (await D.digestSweep(sql, fam, Date.now())) === 0 && pushes.length === 3);
}

// =====================================================================
// 8. WITH A MODEL (a fake one, through the seam; the real API is never called)
// =====================================================================
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
const reset = async () => { await admin.query(`delete from digest_daily`); await admin.query(`delete from digest_usage`); await admin.query(`delete from digest_model_claim`); modelCalls.length = 0; };
await reset();
frozen = Date.now() + 3000;
const expectedFor = async (who, zone = EVE.zone) => R.digestFacts(await D.digestGather(sql, { id: fam, kind: 'family' }, { id: who.id }, zone, frozen));
{
  const facts = await expectedFor(rohan);
  const NOTE = 'Aaj Maa ki medicines were not marked. Papa raised an SOS and it was closed. Kal Chachu ka birthday hai, and Sunday lunch is at 1:00 pm.';
  modelReply = async () => ({ text: NOTE, model: 'fake-model' });
  const r = (await digest(rohan)).digest;
  ok('with a key, Ekta writes it', r.by === 'ekta' && r.text === NOTE && r.final === true, JSON.stringify(r).slice(0, 300));
  ok('and the sheet is told how it was made', r.how === 'Written by Ekta from what you can see in the family today.');
  ok('exactly one call', modelCalls.length === 1);
  const sent = modelCalls[0];
  ok('ONLY THE LIST IS SENT: the prompt is the numbered sentences of the list and nothing else',
     sent.user === 'Facts for today, most important first:\n' + facts.slice(0, 8).map((f, i) => (i + 1) + '. ' + f.text).join('\n') + '\n\nWrite the note now.', sent.user);
  ok('with the fixed rules, room for thinking plus the note (4000 tokens) and an 8 second limit', sent.system === R.DIGEST_SYSTEM && sent.maxTokens === 4000 && sent.timeoutMs === 8000
     && Object.keys(sent).sort().join() === 'maxTokens,system,timeoutMs,user');
  const all = sent.system + '\n' + sent.user;
  ok('no email, no phone number, no id, no code, no token', !/@/.test(all) && !/\+?91\d{8,}|\d{7,}/.test(all)
     && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(all) && all.indexOf('DIGEST') < 0 && all.indexOf(rohan.token) < 0 && all.indexOf('Kapoor') < 0);
  ok('nothing private: none of the things Rohan may not see', SECRETS.every(s => all.indexOf(s) < 0), SECRETS.filter(s => all.indexOf(s) >= 0).join());
  ok('every line sent is a line of the list', sent.user.split('\n').filter(l => /^\d+\. /.test(l)).every(l => facts.some(f => f.text === l.replace(/^\d+\. /, ''))));
  // One call per member per day.
  const again = (await digest(rohan)).digest;
  ok('opening it again is free: the same text, no second call', again.text === NOTE && modelCalls.length === 1);
  await call(events, maa, { type: 'sos', text: '' });
  frozen = Date.now() + 3000;
  const later = (await digest(rohan)).digest;
  ok('a new SOS adds "Since then", written plainly, with NO second call', later.text === NOTE && /^Since then: Maa raised an SOS at /.test(later.since) && modelCalls.length === 1, later.since);
  ok('the usage table counts it: 1 call, 1 written', JSON.stringify((await rows(`select calls, written from digest_usage where circle_id = $1`, [fam]))[0]) === '{"calls":1,"written":1}');
  ok('no coin is charged for a digest', (await rows(`select count(*)::int as n from coins where circle_id = $1 and delta < 0`, [fam]))[0].n === 0);
  // Another member is another call; the same member tomorrow is another call.
  await digest(papa);
  ok('another member: one more call, for them', modelCalls.length === 2 && /You checked in/.test(modelCalls[1].user));
  ok('Papa\'s list is his own: his private medicine, not Rohan\'s recommendation', /Your medicines were all marked as taken today\./.test(modelCalls[1].user) && !/Panchayat/.test(modelCalls[1].user));
  const five = await Promise.all([1, 2, 3, 4, 5].map(() => digest(maa)));
  ok('five phones opening at once make ONE call', modelCalls.length === 3 && five.every(x => x.status === 200), String(modelCalls.length));
  await rows(`insert into events (circle_id, member_id, type, created_at) values ($1, $2, 'checkin', $3)`, [fam, papa.id, new Date(frozen + 86400000 - 60000)]);
  frozen += 86400000;
  const next = (await digest(rohan)).digest;
  ok('the next day is a new digest and one new call', next.day !== later.day && modelCalls.length === 4 && /\d\. Papa checked in at /.test(modelCalls[3].user) && !/SOS|Sunday lunch/.test(modelCalls[3].user), modelCalls.length + ' ' + next.day + ' ' + (modelCalls[3] || {}).user);
  frozen -= 86400000;
  // Before 6pm: never the model.
  await reset();
  const morning = (await digest(rohan, { tz: MORN.zone })).digest;
  ok('before 6pm the model is not asked', morning.by === 'plain' && morning.final === false && modelCalls.length === 0);
  // A quiet day: nothing to write, so nothing is asked.
  const q = (await digest(kamla)).digest;
  ok('a quiet day is not sent to the model', q.by === 'plain' && modelCalls.length === 0);
}

// ---- fallbacks: each shows the plain version and says nothing about it
async function fallsBack(name, reply, extra) {
  await reset();
  modelReply = reply;
  if (extra) extra();
  const facts = await expectedFor(rohan);
  const r = await digest(rohan);
  ok(name + ': the plain version is shown, with no error', r.status === 200 && r.digest.by === 'plain' && r.digest.how === ''
     && r.digest.text === R.digestWrite(facts, 'family'), JSON.stringify(r).slice(0, 240));
  ok(name + ': the model was asked once', modelCalls.length === 1);
  await digest(rohan); await digest(rohan);
  ok(name + ': and is not asked again that day', modelCalls.length === 1
     && (await rows(`select model_tried, by_model from digest_daily where member_id = $1`, [rohan.id]))[0].model_tried === true);
  ok(name + ': counted as a call, not as written', JSON.stringify((await rows(`select calls, written from digest_usage where circle_id = $1`, [fam]))[0]) === '{"calls":1,"written":0}');
  D.digestSeams.timeoutMs = null;
}
await fallsBack('a timeout', () => new Promise(() => {}), () => { D.digestSeams.timeoutMs = 60; });
await fallsBack('a refusal', async () => ({ refusal: true }));
await fallsBack('an invented number', async () => ({ text: 'Papa walked 5000 steps and checked in. Maa was fine.', model: 'fake-model' }));
await fallsBack('a judgement', async () => ({ text: 'Maa forgot her medicines again.', model: 'fake-model' }));
await fallsBack('an empty reply', async () => ({ text: '   ', model: 'fake-model' }));
await fallsBack('a reply that is too long', async () => ({ text: 'Papa checked in. '.repeat(60), model: 'fake-model' }));
await fallsBack('an error from the provider', async () => { throw new Error('529 overloaded'); });

// ---- the cap: 12 model calls a circle a day
{
  await reset();
  const big = (await admin.query(`insert into circles (code, name) values ('BIGFAM', 'Big Family') returning id`)).rows[0].id;
  const many = [];
  for (let i = 1; i <= 14; i++) many.push(await person(big, 'BIGFAM', 'Member' + String.fromCharCode(64 + i)));
  await call(events, many[0], { type: 'checkin', text: '' });
  frozen = Date.now() + 3000;
  modelReply = async () => ({ text: 'There was a check-in today. Otherwise the day was quiet.', model: 'fake-model' });
  const out = [];
  for (const m of many) out.push((await digest(m)).digest.by);
  ok('the first 12 in a circle are written by Ekta', out.slice(1, 12).every(b => b === 'ekta') && out[0] === 'ekta', out.join());
  ok('past the cap everyone gets the plain version', out[12] === 'plain' && out[13] === 'plain', out.join());
  ok('12 calls were made, no more', modelCalls.length === 12 && (await rows(`select calls, written from digest_usage where circle_id = $1`, [big]))[0].calls === 12);
  ok('the cap is per circle: another family is still served', (await digest(rohan)).digest.by === 'ekta' && modelCalls.length === 13);
  ok('nothing went to the network in the whole test', netCalls.length === 0, netCalls.join());
}

// ---- one model call per member per UTC day, whatever local day the phone names
{
  await reset();
  // 06:00 UTC: 7pm on the 9th at UTC-11, and 7pm on the 10th at UTC+13. One instant, two local days, both evening.
  frozen = Date.UTC(2027, 2, 10, 6, 0, 0);
  await rows(`insert into events (circle_id, member_id, type, created_at) values ($1, $2, 'checkin', $3)`, [fam, papa.id, new Date(frozen - 3600000)]);
  modelReply = async () => ({ text: 'Papa checked in today. Otherwise the day was quiet.', model: 'fake-model' });
  const west = (await digest(rohan, { tz: 'Etc/GMT+11' })).digest;
  ok('7pm on the 9th, far west: the day\'s digest, written by Ekta, one call', west.day === '2027-03-09' && west.final === true && west.by === 'ekta' && modelCalls.length === 1, JSON.stringify(west).slice(0, 200) + ' ' + modelCalls.length);
  const east = (await digest(rohan, { tz: 'Etc/GMT-13' })).digest;
  ok('THE SAME MOMENT WITH ANOTHER ZONE is another local day, but buys no second model call', east.day === '2027-03-10' && east.final === true && east.by === 'plain' && modelCalls.length === 1, JSON.stringify(east).slice(0, 200) + ' ' + modelCalls.length);
  ok('nor does any other zone that day', (await digest(rohan, { tz: 'Etc/GMT-12' })).status === 200 && (await digest(rohan, { tz: 'Etc/GMT+10' })).status === 200 && modelCalls.length === 1);
  ok('one claim for that member on that UTC day, and the circle\'s counter says one call', (await rows(`select to_char(day, 'YYYY-MM-DD') as day from digest_model_claim where member_id = $1`, [rohan.id])).map(x => x.day).join() === '2027-03-10'
     && (await rows(`select sum(calls)::int as n from digest_usage where circle_id = $1`, [fam]))[0].n === 1);
  // Papa's own facts say "You", so a reply that names him would be refused.
  modelReply = async () => ({ text: 'You checked in today. Otherwise the day was quiet.', model: 'fake-model' });
  ok('another member is not held back by it', (await digest(papa, { tz: 'Etc/GMT-13' })).digest.by === 'ekta' && modelCalls.length === 2);
  await rows(`insert into events (circle_id, member_id, type, created_at) values ($1, $2, 'checkin', $3)`, [fam, papa.id, new Date(frozen + 86400000 - 3600000)]);
  frozen += 86400000;
  ok('the next UTC day is a new call, as before', (await digest(rohan, { tz: 'Etc/GMT-13' })).digest.by === 'ekta' && modelCalls.length === 3);
  await rows(`delete from events where circle_id = $1 and created_at > now() + interval '1 day'`, [fam]);
}

// ---- if who is remembered cannot be read, nobody but the viewer is named
{
  await reset();
  frozen = Date.now() + 3000;
  await rows(`insert into events (circle_id, member_id, type, created_at) values ($1, $2, 'checkin', $3)`, [fam, papa.id, new Date(frozen - 60000)]);
  const before = await D.digestGather(sql, { id: fam, kind: 'family' }, { id: rohan.id }, EVE.zone, frozen);
  ok('control: with the read working, Papa\'s check-in is in Rohan\'s list', before.unsure === false && R.digestFacts(before).some(f => /Papa checked in/.test(f.text)));
  // The stand-in model answers nothing of its own here, so the words are the plain writer's.
  modelReply = async () => ({ refusal: true });
  await admin.query(`alter table members rename column remembered to remembered_gone`);
  let raw, r;
  try {
    raw = await D.digestGather(sql, { id: fam, kind: 'family' }, { id: rohan.id }, EVE.zone, frozen);
    r = await D.digestOpen(sql, { id: fam, kind: 'family', name: 'Kapoor Family' }, { id: rohan.id, name: 'Rohan' }, EVE.zone, frozen);
  } finally { await admin.query(`alter table members rename column remembered_gone to remembered`); }
  const facts = R.digestFacts(raw);
  ok('THE READ OF WHO IS REMEMBERED FAILS: nobody but the viewer may be named', raw.unsure === true && raw.people.every(p => p.id === rohan.id ? p.remembered === false : p.remembered === true)
     && raw.remembrance.length === 0 && !facts.some(f => /Papa|Maa|Priya|Chachu/.test(f.text)), JSON.stringify(facts.map(f => f.text)));
  ok('the digest still answers, names nobody else, and the model is not asked about anyone', !!r && typeof r.text === 'string' && r.text.length > 0 && !/Papa|Maa|Priya|Chachu/.test(r.text) && modelCalls.every(c => !/Papa|Maa|Priya|Chachu/.test(c.user)), r && r.text);
  await reset();
}

// ---- "tomorrow is a day of remembrance": the reminder's own rule, on the person's own clock
{
  const add = async (name, y, m, d, place, country) => (await rows(`insert into members (circle_id, name, remembered, passed_year, passed_month, passed_day, place, country, created_at)
    values ($1, $2, true, $3, $4, $5, $6, $7, now() - interval '400 days') returning id`, [fam, name, y, m, d, place, country]))[0].id;
  await RM.ensureRememberSchema(sql);
  const dadi = await add('Dadi', 2020, 2, 29, null, 'IN'), nana = await add('Nana', 2019, 3, 12, 'Auckland', 'NZ');
  const ist = (y, mo, d, h) => Date.UTC(y, mo - 1, d, h - 5, -30);
  const tomorrowFor = async (ms) => (await D.digestGather(sql, { id: fam, kind: 'family' }, { id: rohan.id }, 'Asia/Kolkata', ms)).remembrance;
  ok('29 FEBRUARY IN A YEAR WITHOUT ONE: on the evening of the 27th, tomorrow is Dadi\'s day', (await tomorrowFor(ist(2027, 2, 27, 19))).join() === dadi);
  ok('and the words are in the digest', R.digestFacts(await D.digestGather(sql, { id: fam, kind: 'family' }, { id: rohan.id }, 'Asia/Kolkata', ist(2027, 2, 27, 19))).some(f => f.text === 'Tomorrow the family remembers Dadi.'));
  ok('not a day early, and not on the day itself', (await tomorrowFor(ist(2027, 2, 26, 19))).length === 0 && (await tomorrowFor(ist(2027, 2, 28, 19))).length === 0);
  ok('in a leap year it is the 29th: said on the 28th, not on the 27th', (await tomorrowFor(ist(2028, 2, 28, 19))).join() === dadi && (await tomorrowFor(ist(2028, 2, 27, 19))).length === 0);
  ok('it agrees with the reminder the family gets, at the same moments', RR.remembranceDue({ year: 2020, month: 2, day: 29 }, ist(2027, 2, 27, 19), 'Asia/Kolkata').when === 'eve'
     && RR.remembranceDue({ year: 2020, month: 2, day: 29 }, ist(2027, 2, 28, 9), 'Asia/Kolkata').when === 'day');
  // Nana lived in Auckland: 7pm on 10 March in India is already 11 March there, so his 12th is tomorrow.
  ok('THE PERSON\'S OWN PLACE decides the day: Nana\'s 12 March in Auckland', (await tomorrowFor(ist(2027, 3, 10, 19))).join() === nana && (await tomorrowFor(ist(2027, 3, 10, 9))).length === 0);
  ok('in the year they passed there is no day yet', (await tomorrowFor(ist(2019, 3, 10, 19))).length === 0);
  await rows(`delete from members where id = any($1::uuid[])`, [[dadi, nana]]);
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`digest.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
