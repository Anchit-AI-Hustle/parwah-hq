// FIVE FAMILY-CARE TOOLS AGAINST A REAL DATABASE: the real api/events.mjs and
// api/care.mjs handlers, the real schema and SQL, on a throwaway PostgreSQL.
//
//   1. Quiet day: the parent's own yes; a gentle nudge at the time, one
//      family alert 30 minutes later, each exactly once however many phones
//      look at the same moment; a check-in ends it; "away until" pauses it.
//   2. Ask family first: one tap tells the family; one person acknowledges;
//      the safe word is for members only and never in the feed.
//   3. Life certificate: a yearly task in the right window, a checklist, an
//      acknowledgement that finishes it and makes next year's, and never an
//      Aadhaar number.
//   4. Call rota: turns go round, skip passes today on, "Called Maa", a day
//      nobody marked moves on, and "a call would be nice" finds today's
//      person.
//   5. Help with the phone: into the family chat, with a picture; one person
//      takes it.
// And for each: nobody outside the family (403), nobody signed out (401).
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('caretools.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('caretools.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: care } = await import('../../../api/care.mjs');
const { default: events } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { ensureTaskSchema } = await import('../../../api/_tasks.mjs');
const { quietSweep, rotaSweep, ensureFamilyCareSchema } = await import('../../../api/_familycare.mjs');
const { fromWall, dayIn } = await import('../../../api/_recur.mjs');

const sql = db();
await ensureSchema(sql);
await ensureTaskSchema(sql);
await ensureFamilyCareSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

let phoneN = 0;
async function person(circleId, name, role = 'family', gender = null) {
  const phone = '+9198300' + String(++phoneN).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1, '+91', $2, $3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id, gender, phone) values ($1, $2, $3, $4, $5, $6) returning id`, [circleId, name, role, u.id, gender, phone])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, name, token, circleId };
}
const sharma = (await admin.query(`insert into circles (code, name) values ('SHARMA', 'Sharma Family') returning id`)).rows[0].id;
const verma = (await admin.query(`insert into circles (code, name) values ('VERMA1', 'Verma Family') returning id`)).rows[0].id;
const rohan = await person(sharma, 'Rohan', 'family', 'm');
const meera = await person(sharma, 'Meera', 'family', 'f');
const priya = await person(sharma, 'Priya', 'family', 'f');
const papa = await person(sharma, 'Papa', 'parent', 'm');
const maa = await person(sharma, 'Maa', 'parent', 'f');
const vikram = await person(verma, 'Vikram');
const CODE = { [sharma]: 'SHARMA', [verma]: 'VERMA1' };

async function call(handler, who, { method = 'POST', body = {}, query = {}, token } = {}) {
  const req = { method, headers: { 'x-parwah-token': token === undefined ? who.token : token, 'x-forwarded-for': '10.2.2.' + (++phoneN), 'x-parwah-tz': 'Asia/Kolkata' },
                body: { code: CODE[who.circleId], memberId: who.id, ...body },
                query: { circle: CODE[who.circleId], member: who.id, ...query } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...json, http: status };
}
const ev = (who, type, extra = {}, opt = {}) => call(events, who, { body: { type, ...extra }, ...opt });
const act = (who, action, extra = {}, opt = {}) => call(care, who, { body: { action, ...extra }, ...opt });
const state = async who => (await call(events, who, { method: 'GET' })).familyCare;
const feedHas = async (re) => (await admin.query(`select text from events where circle_id = $1`, [sharma])).rows.filter(r => re.test(r.text || '')).length;
const mrow = async id => (await admin.query(`select checkin_by, tz, checkin_ask, to_char(away_until,'YYYY-MM-DD') as away_until,
  to_char(quiet_nudged_for,'YYYY-MM-DD') as nudged, to_char(quiet_alerted_for,'YYYY-MM-DD') as alerted from members where id = $1`, [id])).rows[0];

// A zone where it is daytime now, so the test's times all fall today.
const ZONES = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'Pacific/Auckland', 'Asia/Tokyo', 'America/Los_Angeles'];
const hourIn = tz => +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date());
const TZ = ZONES.find(z => hourIn(z) >= 2 && hourIn(z) <= 19);
const wallNow = () => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date()).forEach(x => { p[x.type] = +x.value; }); return p; };
const w = wallNow();
const checkinBy = String(w.hour + 2).padStart(2, '0') + ':' + String(w.minute).padStart(2, '0');
const today = dayIn(TZ);
const [Y, M, Dd] = today.split('-').map(Number);
const deadline = fromWall({ y: Y, m: M, d: Dd, h: w.hour + 2, mi: w.minute, s: 0 }, TZ);

// =====================================================================
// 1. QUIET DAY
// =====================================================================
{
  // The family asks; nothing is on until Papa says yes on his own phone.
  const asked = await ev(rohan, 'quiet_ask', { targetId: papa.id, checkinBy });
  ok('the family can ask for a daily check-in time', asked.http === 200 && asked.ok, JSON.stringify(asked));
  let r = await mrow(papa.id);
  ok('but asking turns nothing on', r.checkin_by === null && r.checkin_ask === checkinBy);
  const st = await state(papa);
  const mine = st.quiet.find(q => q.memberId === papa.id);
  ok('Papa sees who asked, on his own screen', mine && mine.ask === checkinBy && mine.askByName === 'Rohan' && mine.phase === 'off', JSON.stringify(mine));
  const forOther = await ev(rohan, 'quiet_answer', { yes: true });
  ok('only Papa can say yes for Papa', forOther.http === 404);
  const yes = await ev(papa, 'quiet_answer', { yes: true, tz: TZ });
  r = await mrow(papa.id);
  ok('Papa says yes: it is on, in his time zone', yes.ok && r.checkin_by === checkinBy && r.tz === TZ && r.checkin_ask === null, JSON.stringify(r));

  // Before the time: nothing.
  ok('before the time, nothing is sent', (await quietSweep(sql, sharma, deadline - 60000)) === 0 && (await mrow(papa.id)).nudged === null);
  // At the time: a nudge to Papa only, once, however many phones look.
  const n = await Promise.all([1, 2, 3, 4, 5].map(() => quietSweep(sql, sharma, deadline + 60000)));
  r = await mrow(papa.id);
  ok('at the time, Papa is nudged exactly once (five phones polling at once)', n.reduce((a, b) => a + b, 0) === 1 && r.nudged === today && r.alerted === null, JSON.stringify([n, r]));
  ok('and the family is not told yet', (await feedHas(/has not checked in today/)) === 0);
  // 30 minutes later: one alert to the family.
  const a = await Promise.all([1, 2, 3, 4, 5, 6].map(() => quietSweep(sql, sharma, deadline + 31 * 60000)));
  r = await mrow(papa.id);
  ok('30 minutes on, the family is told exactly once', a.reduce((x, y) => x + y, 0) === 1 && r.alerted === today && (await feedHas(/Papa has not checked in today\. Give him a call\?/)) === 1, JSON.stringify(a));
  ok('and never again today', (await quietSweep(sql, sharma, deadline + 3 * 3600000)) === 0 && (await feedHas(/has not checked in today/)) === 1);
  const fam = (await state(rohan)).quiet.find(q => q.memberId === papa.id);
  ok('the family sees it with a number to call', fam.alerted === true && !!fam.phone && fam.checkinBy === checkinBy, JSON.stringify(fam));
  // Papa says he is okay: it ends.
  await call(events, papa, { body: { type: 'checkin', text: '' } });
  const after = (await state(rohan)).quiet.find(q => q.memberId === papa.id);
  ok('once Papa checks in, the alert is over', after.alerted === false && !!after.okAt && after.phase === 'ok', JSON.stringify(after));

  // Maa sets her own, then is away: paused.
  const set = await ev(maa, 'quiet_set', { checkinBy, tz: TZ });
  ok('Maa can set her own time', set.ok && (await mrow(maa.id)).checkin_by === checkinBy);
  const bad = await ev(maa, 'quiet_set', { checkinBy: '25:00' });
  ok('a time that is not a time is refused', bad.http === 400);
  const away = await ev(maa, 'quiet_away', { until: today, tz: TZ });
  ok('"I\'m away until" pauses it', away.ok && (await mrow(maa.id)).away_until === today);
  ok('and nothing is sent while away', (await quietSweep(sql, sharma, deadline + 40 * 60000)) === 0 && (await mrow(maa.id)).nudged === null);
  const tooFar = await ev(maa, 'quiet_away', { until: '2099-01-01', tz: TZ });
  ok('away for years is refused', tooFar.http === 400);
  await ev(maa, 'quiet_away', { until: null, tz: TZ });
  ok('back home: it is on again', (await mrow(maa.id)).away_until === null);
  // Set after today's time has gone: it starts tomorrow, nobody is woken.
  const early = String(Math.max(0, w.hour - 1)).padStart(2, '0') + ':00';
  const late = await ev(meera, 'quiet_set', { checkinBy: early, tz: TZ });
  const mr = await mrow(meera.id);
  ok('turned on after its time today: it starts tomorrow', late.startsTomorrow === true && mr.nudged === today && mr.alerted === today, JSON.stringify(mr));
  await ev(meera, 'quiet_off', {});
  ok('and anyone can turn their own off', (await mrow(meera.id)).checkin_by === null);
  // Authz
  const out = await ev(vikram, 'quiet_ask', { targetId: papa.id, checkinBy }, { body: { code: 'SHARMA', memberId: vikram.id, type: 'quiet_ask', targetId: papa.id, checkinBy } });
  ok('someone from another family cannot ask (403)', out.http === 403, JSON.stringify(out));
  const cross = await ev(vikram, 'quiet_ask', { targetId: papa.id, checkinBy });
  ok('nor reach this family\'s parent from their own (404)', cross.http === 404);
  const anon = await ev(papa, 'quiet_set', { checkinBy }, { token: '' });
  ok('signed out: 401', anon.http === 401);
}

// =====================================================================
// 2. ASK FAMILY FIRST, and the safe word
// =====================================================================
{
  const sw = await ev(meera, 'safeword_set', { word: 'Gulab jamun' });
  ok('a member sets the family safe word', sw.ok && sw.set);
  ok('it is never written in the feed', (await feedHas(/Gulab/)) === 0 && (await feedHas(/set the family safe word/)) === 1);
  ok('members read it', (await state(papa)).safeWord === 'Gulab jamun');
  const outsider = await call(events, vikram, { method: 'GET', query: { circle: 'SHARMA', member: vikram.id } });
  ok('nobody outside the family can read it', outsider.http === 403 && !outsider.familyCare);
  const badw = await ev(meera, 'safeword_set', { word: '<b>x</b>' });
  ok('a safe word is plain words only', badw.http === 400);

  const a = await ev(papa, 'askfirst', { text: 'Caller says KYC will lapse today' });
  ok('one tap asks the family first', a.http === 201 && a.ok && a.id);
  ok('the family chat hears it', (await admin.query(`select count(*)::int as n from messages where text like '%checking with you first%'`)).rows[0].n === 1);
  const again = await ev(papa, 'askfirst', {});
  ok('a second tap is the same question, not a new one', again.id === a.id && again.again === true);
  const st = await state(rohan);
  ok('the family sees it waiting', st.askfirst.length === 1 && st.askfirst[0].status === 'open' && st.askfirst[0].name === 'Papa');
  const self = await ev(papa, 'askfirst_ack', { askId: a.id });
  ok('Papa does not answer his own question', self.http === 400);
  const [x1, x2] = await Promise.all([ev(rohan, 'askfirst_ack', { askId: a.id }), ev(meera, 'askfirst_ack', { askId: a.id })]);
  ok('two answer at once: one of them has it, the other is told who', [x1, x2].filter(x => x.ok && !x.already).length === 1 && [x1, x2].filter(x => x.already).length === 1);
  const pst = (await state(papa)).askfirst[0];
  ok('Papa sees who is calling', pst.status === 'acked' && ['Rohan', 'Meera'].includes(pst.acked_name));
  const xo = await ev(vikram, 'askfirst_ack', { askId: a.id });
  ok('another family cannot answer it', xo.http === 404);
  const anon = await ev(papa, 'askfirst', {}, { token: '' });
  ok('signed out: 401', anon.http === 401);
  const closed = await ev(papa, 'askfirst_close', { askId: a.id });
  ok('sorted: it closes', closed.ok && (await state(rohan)).askfirst.length === 0);
}

// =====================================================================
// 3. LIFE CERTIFICATE
// =====================================================================
let lc;
{
  await admin.query(`update members set dob = '1944-03-10' where id = $1`, [papa.id]);
  await admin.query(`update members set dob = '1958-07-20' where id = $1`, [maa.id]);
  const r = await act(rohan, 'lifecert_create', { aboutMemberId: papa.id, tz: 'Asia/Kolkata' });
  ok('one tap makes the life certificate task', r.http === 201 && r.ok, JSON.stringify(r));
  lc = r.id;
  const t = (await admin.query(`select title, recurrence, template, template_data, notes, to_char(due_date,'YYYY-MM-DD') as due from requests where id = $1`, [lc])).rows[0];
  const y = +dayIn('Asia/Kolkata').slice(0, 4) + (dayIn('Asia/Kolkata').slice(5) > '11-30' ? 1 : 0);
  ok('yearly, due 30 November, for 80 and over from 1 October', t.recurrence === 'yearly' && t.template === 'lifecert' && t.due === y + '-11-30'
     && t.template_data.opens === y + '-10-01' && t.template_data.superSenior === true, JSON.stringify(t));
  ok('and it says to confirm the dates on the official site', /confirm on jeevanpramaan\.gov\.in/.test(t.notes) && /as announced each year/.test(t.notes));
  const m = await act(rohan, 'lifecert_create', { aboutMemberId: maa.id, tz: 'Asia/Kolkata' });
  const mt = (await admin.query(`select template_data from requests where id = $1`, [m.id])).rows[0].template_data;
  ok('under 80: 1 to 30 November', mt.opens === y + '-11-01' && mt.superSenior === false, JSON.stringify(mt));
  const dup = await act(meera, 'lifecert_create', { aboutMemberId: papa.id });
  ok('never twice for the same person', dup.http === 409);
  const list = (await call(care, rohan, { method: 'GET' })).requests;
  ok('the list carries the checklist', list.some(q => q.id === lc && q.template === 'lifecert' && q.template_data && q.template_data.closes));
  const ch = await act(meera, 'lifecert_update', { taskId: lc, check: { ppo: true, aadhaar: true } });
  ok('ticks are kept', ch.ok && ch.checks.ppo === true && ch.checks.aadhaar === true && !ch.checks.face);
  const aad = await act(meera, 'lifecert_update', { taskId: lc, result: 'ack', ackNo: '1234 5678 9012' });
  ok('an Aadhaar number is refused as the acknowledgement', aad.http === 400 && /Aadhaar/.test(aad.error));
  const rej = await act(meera, 'lifecert_update', { taskId: lc, result: 'rejected' });
  ok('"rejected" is recorded and the task stays open', rej.ok && rej.result === 'rejected'
     && (await admin.query(`select status, template_data from requests where id = $1`, [lc])).rows[0].status === 'open');
  const done = await act(meera, 'lifecert_update', { taskId: lc, result: 'ack', ackNo: 'JP2026AB1234' });
  const row = (await admin.query(`select status, completion_note from requests where id = $1`, [lc])).rows[0];
  ok('the acknowledgement finishes it', done.ok && done.done && row.status === 'done' && /JP2026AB1234/.test(row.completion_note), JSON.stringify(done));
  const nx = (await admin.query(`select template, template_data, to_char(due_date,'YYYY-MM-DD') as due from requests where id = $1`, [done.next])).rows[0];
  ok('and next year\'s is ready, with a fresh checklist', nx && nx.template === 'lifecert' && nx.due === (y + 1) + '-11-30' && nx.template_data.result === null
     && Object.keys(nx.template_data.checks).length === 0 && nx.template_data.opens === (y + 1) + '-10-01', JSON.stringify(nx));
  const out = await act(vikram, 'lifecert_update', { taskId: done.next, check: { ppo: true } });
  ok('another family cannot touch it', out.http === 404);
  const anon = await act(rohan, 'lifecert_create', { aboutMemberId: papa.id }, { token: '' });
  ok('signed out: 401', anon.http === 401);
  const out2 = await call(care, vikram, { body: { code: 'SHARMA', memberId: vikram.id, action: 'lifecert_create', aboutMemberId: papa.id } });
  ok('outsider into this family: 403', out2.http === 403);
}

// =====================================================================
// 4. CALL ROTA, and "a call would be nice"
// =====================================================================
{
  const r = await act(rohan, 'rota_create', { aboutMemberId: maa.id, memberIds: [rohan.id, meera.id, priya.id], time: '19:00', tz: 'Asia/Kolkata' });
  ok('a call rota for Maa', r.http === 201 && r.first === rohan.id, JSON.stringify(r));
  let t = (await admin.query(`select * from requests where id = $1`, [r.id])).rows[0];
  ok('a daily task, Rohan first, done reads "Called Maa"', t.recurrence === 'daily' && t.claimed_by === rohan.id && t.status === 'claimed' && t.done_when === 'Called Maa' && t.title === 'Call Maa');
  const dup = await act(meera, 'rota_create', { aboutMemberId: maa.id, memberIds: [meera.id] });
  ok('one rota per person', dup.http === 409);
  const noOne = await act(meera, 'rota_create', { aboutMemberId: papa.id, memberIds: [] });
  ok('a rota needs someone on it', noOne.http === 400);
  const notMine = await act(meera, 'rota_skip', { taskId: r.id });
  ok('only the person whose turn it is passes it on', notMine.http === 403);
  const sk = await act(rohan, 'rota_skip', { taskId: r.id });
  t = (await admin.query(`select claimed_by, template_data from requests where id = $1`, [r.id])).rows[0];
  ok('skip passes today to the next person', sk.ok && t.claimed_by === meera.id && t.template_data.idx === 1);

  // Maa says a call would be nice: Meera's turn today.
  const pulse = await call(events, maa, { body: { type: 'pulse', value: 'x' } });
  ok('the pulse still refuses an answer that is not today\'s', pulse.http === 400);
  const { pulseCallNudge } = await import('../../../api/_familycare.mjs');
  const who = await pulseCallNudge(sql, sharma, { id: maa.id, name: 'Maa' }, 'Rainy');
  ok('"a call would be nice" finds today\'s rota person first', who === meera.id);

  const d = await act(meera, 'rota_done', { taskId: r.id });
  const nt = (await admin.query(`select claimed_by, status, template, template_data from requests where id = $1`, [d.next])).rows[0];
  ok('"Called Maa": done, and tomorrow is the next person\'s', d.ok && d.nextBy === priya.id && nt.claimed_by === priya.id && nt.template === 'callrota' && nt.template_data.idx === 2, JSON.stringify(d));
  ok('the feed says who called', (await feedHas(/Meera called Maa/)) === 1);
  const twice = await act(meera, 'rota_done', { taskId: r.id });
  ok('marking it twice does nothing more', twice.http === 409);
  // A day nobody marked moves on to the next person.
  await admin.query(`update requests set due_at = due_at - interval '3 days', due_date = due_date - 3 where id = $1`, [d.next]);
  const rolled = await Promise.all([1, 2, 3].map(() => rotaSweep(sql, sharma)));
  const rt = (await admin.query(`select claimed_by, template_data, due_at from requests where id = $1`, [d.next])).rows[0];
  ok('a missed day moves on once, to the next person, never into the past twice', rolled.reduce((a, b) => a + b, 0) === 1 && rt.claimed_by === rohan.id && rt.template_data.idx === 0
     && new Date(rt.due_at).getTime() > Date.now() - 86400000, JSON.stringify([rolled, rt]));
  const out = await act(vikram, 'rota_done', { taskId: d.next });
  ok('another family cannot mark it', out.http === 404);
  const anon = await act(rohan, 'rota_done', { taskId: d.next }, { token: '' });
  ok('signed out: 401', anon.http === 401);
}

// =====================================================================
// 5. HELP WITH MY PHONE
// =====================================================================
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const empty = await ev(papa, 'help_ask', {});
  ok('a help request needs words or a picture', empty.http === 400);
  const badImg = await ev(papa, 'help_ask', { image: 'data:image/svg+xml;base64,PHN2Zz4=' });
  ok('only a real photo is taken', badImg.http === 400);
  const h = await ev(papa, 'help_ask', { text: 'WhatsApp is asking me something', image: png });
  ok('Papa asks for help with a screenshot', h.http === 201 && h.id);
  const msgs = (await admin.query(`select text, kind from messages order by created_at`)).rows;
  ok('it lands in the family chat, words and picture', msgs.some(m => /I need help with my phone: WhatsApp is asking me something/.test(m.text)) && msgs.some(m => m.kind === 'image' && m.text === png));
  const self = await ev(papa, 'help_claim', { helpId: h.id });
  ok('Papa does not take his own', self.http === 400);
  const [c1, c2] = await Promise.all([ev(rohan, 'help_claim', { helpId: h.id }), ev(priya, 'help_claim', { helpId: h.id })]);
  ok('one person takes it, the other is told', [c1, c2].filter(x => x.ok).length === 1 && [c1, c2].filter(x => x.http === 409).length === 1);
  const st = (await state(papa)).helps[0];
  ok('Papa sees who is on it', st.status === 'claimed' && ['Rohan', 'Priya'].includes(st.claimed_name));
  ok('"is on it" is said in the chat', (await admin.query(`select count(*)::int as n from messages where text like '%is on it, Papa.'`)).rows[0].n === 1);
  const out = await ev(vikram, 'help_claim', { helpId: h.id });
  ok('another family cannot take it', out.http === 404);
  const fin = await ev(meera, 'help_done', { helpId: h.id });
  ok('only Papa or the helper closes it', fin.http === 403);
  const fin2 = await ev(papa, 'help_done', { helpId: h.id });
  ok('Papa closes it', fin2.ok && (await state(papa)).helps.length === 0);
  const anon = await ev(papa, 'help_ask', { text: 'x' }, { token: '' });
  ok('signed out: 401', anon.http === 401);
}

// The timer tick runs the quiet sweep too, and counts it.
{
  const early = String(Math.max(0, w.hour - 1)).padStart(2, '0') + ':00';
  await admin.query(`update members set checkin_by = $2, tz = $3, quiet_nudged_for = null, quiet_alerted_for = null, away_until = null where id = $1`, [maa.id, early, TZ]);
  await admin.query(`delete from events where member_id = $1 and type = 'checkin'`, [maa.id]);
  const r = await call(events, rohan, { method: 'GET', query: { tick: '1' } });
  ok('the timer sweeps missed check-ins too, with every phone closed', r.ok && r.events >= 1 && (await mrow(maa.id)).nudged === today, JSON.stringify(r));
}

await admin.end();
console.log(`\ncaretools.dbtest: ${pass}/${pass + fails.length} checks pass`);
if (fails.length) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
process.exit(0);
