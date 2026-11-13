// BEING HEARD, AND ANSWERED against a real database, through the real
// handlers (/api/chats, /api/plans, /api/book, /api/games, /api/events) and
// the real sweeps.
//
// What it proves, in the order of the audit:
//   1. The mood is private by default. A low answer reaches the feed, and
//      anybody else's phone, only when the member chose the family.
//   2. "Mujhe baat karni hai" and "Maaf karna" are read by the two of them
//      and nobody else: not a third member, not an outsider, not the feed.
//      One reminder after a day, then silence.
//   3. Shukriya: kept for someone not on the app until they join; private
//      to the two unless the writer chose the family; the weekly prompt
//      never names the viewer or someone remembered, and carries no count.
//   4. Stories are heard and answered; a card is never handed over empty;
//      photos take a reaction and a voice caption, and one push a day.
//   5. Votes are equal: a secret ballot sends no name to any phone, one
//      reminder, a tally for the host, a recorded decision, a vote "for
//      Dadi, by Rohan", and a child's vote counts the same.
//   6. The family's weekly question: answers only after your own.
//   8. Chat: paging, delete my own, mute for me, pushes together.
//   9. Festivals change one at a time, with a feed line.
//  10. Coins for being heard, capped for the day.
//  11. Likes noted for someone not on the app; their own replace them.
//  12. A day of remembrance opens a memory card the family adds to.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('heard.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('heard.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

// Every push is counted here instead of leaving the machine.
const webpush = (await import('web-push')).default;
const pushed = [];
webpush.sendNotification = async (sub, body) => { pushed.push({ to: sub.endpoint.split('/').pop(), body: JSON.parse(body) }); return {}; };

const api = {};
for (const n of ['chats', 'plans', 'book', 'games', 'events', 'settings']) api[n] = (await import(`../../../api/${n}.mjs`)).default;
const { runTick } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { ensurePushSchema } = await import('../../../api/_push.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const Baat = await import('../../../api/_baat.mjs');
const Bond = await import('../../../api/_bond.mjs');
const Mb = await import('../../../api/_memorybond.mjs');
const Rm = await import('../../../api/_remember.mjs');
const Heard = await import('../../../api/_heard.mjs');
const R = await import('../../../api/_heardrules.mjs');
const { wallIn } = await import('../../../api/_rememberrules.mjs');
const { fromWall } = await import('../../../api/_recur.mjs');
const sql = db();
await ensureSchema(sql); await ensurePushSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

let n = 0;
async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-parwah-tz': 'Asia/Kolkata', 'x-forwarded-for': '10.9.' + (++n % 250) + '.' + (n % 199) }, query, body };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() { return this; }, end() { return this; } };
  await handler(req, res);
  return { ...(json || {}), status };
}
// The plans route makes its own tables on first use; then the modules that build on them.
await call(api.plans, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });
await Bond.ensureBondSchema(sql); await Mb.ensureBondSchema(sql); await Rm.ensureRememberSchema(sql); await Heard.ensureHeardSchema(sql);
async function user(name) {
  const phone = '+9198730' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token };
}
async function seat(circleId, code, u, role = 'family', dob = null) {
  const m = (await admin.query(`insert into members (circle_id, name, user_id, role, dob) values ($1,$2,$3,$4,$5) returning id`, [circleId, u.name, u.userId || null, role, dob])).rows[0];
  if (u.userId) await admin.query(`insert into push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')`,
    [m.id, 'https://fcm.googleapis.com/fcm/send/' + m.id]);
  return { id: m.id, name: u.name, token: u.token, code };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const grp = (await admin.query(`insert into circles (code, name, kind) values ('COUSIN','Cousins','group') returning id`)).rows[0].id;
const U = { rohan: await user('Rohan'), meena: await user('Meena'), papa: await user('Papa'), kabir: await user('Kabir'), vikram: await user('Vikram') };
const rohan = await seat(fam, 'SHARMA', U.rohan, 'family', '1988-03-04'), meena = await seat(fam, 'SHARMA', U.meena, 'family', '1990-07-09');
const papa = await seat(fam, 'SHARMA', U.papa, 'parent', '1958-01-20'), kabir = await seat(fam, 'SHARMA', U.kabir, 'family', '2013-05-05');
// Dadi is in the family tree by name only: she is not on the app.
const dadi = await seat(fam, 'SHARMA', { name: 'Dadi' }, 'parent', '1936-02-02');
// Dadaji is remembered, and today (in India) is the day the family keeps.
const today = wallIn(Date.now(), 'Asia/Kolkata').date;
const dadaji = await seat(fam, 'SHARMA', { name: 'Dadaji' }, 'parent', '1930-01-01');
await admin.query(`update members set remembered = true, passed_year = 2019, passed_month = $2, passed_day = $3 where id = $1`, [dadaji.id, +today.slice(5, 7), +today.slice(8, 10)]);
const rohanG = await seat(grp, 'COUSIN', U.rohan), vikramG = await seat(grp, 'COUSIN', U.vikram);
const outsider = { id: vikramG.id, token: vikramG.token, code: 'SHARMA' };
const posing = { id: meena.id, token: vikramG.token, code: 'SHARMA' };

const H = (who, action, body = {}) => call(api.chats, { token: who.token, body: { area: 'heard', code: who.code, memberId: who.id, action, ...body } });
const HG = (who, query = {}) => call(api.chats, { method: 'GET', token: who.token, query: { area: 'heard', circle: who.code, member: who.id, ...query } });
const C = (who, action, body = {}) => call(api.chats, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const CG = (who, query = {}) => call(api.chats, { method: 'GET', token: who.token, query: { circle: who.code, member: who.id, ...query } });
const P = (who, action, body = {}) => call(api.plans, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const PG = (who, query = {}) => call(api.plans, { method: 'GET', token: who.token, query: { area: 'bond', circle: who.code, member: who.id, ...query } });
const B = (who, action, body = {}) => call(api.book, { token: who.token, query: { area: 'bond' }, body: { area: 'bond', code: who.code, memberId: who.id, action, ...body } });
const BG = (who, query = {}) => call(api.book, { method: 'GET', token: who.token, query: { area: 'bond', circle: who.code, member: who.id, ...query } });
const A = (who, action, body = {}) => call(api.book, { token: who.token, query: { area: 'album' }, body: { area: 'album', code: who.code, memberId: who.id, action, ...body } });
const AG = (who, query = {}) => call(api.book, { method: 'GET', token: who.token, query: { area: 'album', circle: who.code, member: who.id, ...query } });
const G = (who, action, body = {}) => call(api.games, { token: who.token, query: { area: 'pasand' }, body: { area: 'pasand', code: who.code, memberId: who.id, action, ...body } });
const GG = (who) => call(api.games, { method: 'GET', token: who.token, query: { area: 'pasand', circle: who.code, member: who.id } });
const EV = (who) => call(api.events, { method: 'GET', token: who.token, query: { circle: who.code, member: who.id } });
const count = async (q, p) => (await admin.query(q, p)).rows[0].n;
const feed = async () => (await admin.query(`select text from events where circle_id = $1 order by created_at`, [fam])).rows.map(r => r.text);
const to = (who) => pushed.filter(p => p.to === who.id);
const AVOICE = { audio: 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC', voiceMime: 'audio/webm', secs: 4 };
const VOICE = { audio: 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC', mime: 'audio/webm', secs: 4 };

// ================================================================ 1. the mood
const remembrancePushes = [];
{
  pushed.length = 0;
  let r = await H(meena, 'mood_set', { value: 'udaas' });
  ok('1. Meena says "Mann udaas hai" and it is kept to her (the default)', r.status === 201 && r.tell === 'self', JSON.stringify(r));
  ok('1. A LOW ANSWER KEPT PRIVATE NEVER GOES ON THE FAMILY FEED', (await feed()).length === 0);
  ok('1. and nobody is pushed', pushed.length === 0, JSON.stringify(pushed));
  let t = await HG(rohan);
  ok('1. her husband\'s phone is told nothing', t.status === 200 && t.mood.told.length === 0 && t.mood.mine === null, JSON.stringify(t.mood.told));
  ok('1. the old feed read (/api/events) hides it too: the rule is in the query', !(await EV(rohan)).pulse.answers.some(a => a.memberId === meena.id));
  ok('1. she sees her own answer, and that it is private', (await HG(meena)).mood.mine.value === 'udaas' && (await HG(meena)).mood.mine.tell === 'self');
  ok('1. five choices, each a word with its emoji', t.mood.moods.length === 5 && t.mood.moods.every(m => m.e && m.t && m.en) && t.mood.ask === 'Aaj kaisa lag raha hai?');
  // (Reading the family's state ran the timer: today's day of remembrance was announced. Kept for part 12.)
  remembrancePushes.push(...pushed.filter(p => /remembrance/.test(p.body.title)));
  pushed.length = 0;

  r = await H(meena, 'mood_set', { value: 'udaas', tell: 'one', toId: rohan.id });
  ok('1. "Tell only Rohan": one push, to Rohan alone', r.status === 201 && pushed.length === 1 && to(rohan).length === 1 && /told only you/.test(pushed[0].body.title), JSON.stringify(pushed));
  ok('1. Rohan sees it, with the word next to the emoji', (await HG(rohan)).mood.told.some(x => x.name === 'Meena' && x.text === 'Mann udaas hai' && x.emoji && x.low));
  ok('1. Papa and Kabir do not', (await HG(papa)).mood.told.length === 0 && (await HG(kabir)).mood.told.length === 0);
  ok('1. still nothing on the feed', (await feed()).length === 0);

  pushed.length = 0;
  r = await H(meena, 'mood_set', { value: 'udaas', tell: 'family' });
  ok('1. "Tell the family": now, and only now, it is on the feed', r.status === 201 && (await feed()).some(x => /Meena is .* Mann udaas hai/.test(x)));
  ok('1. and the family is told she could do with a call (not Meena herself)', pushed.length === 3 && to(meena).length === 0 && pushed.every(p => /could do with a call/.test(p.body.title)), JSON.stringify(pushed.map(p => p.body.title)));
  ok('1. Papa now sees it', (await HG(papa)).mood.told.some(x => x.name === 'Meena'));
  r = await H(meena, 'mood_set', { value: 'mushkil', tell: 'self' });
  ok('1. "Keep to myself" takes the feed line away again', (await feed()).length === 0 && (await HG(papa)).mood.told.length === 0);

  ok('1. "tell only" someone not on the app is refused', (await H(meena, 'mood_set', { value: 'theek', tell: 'one', toId: dadi.id })).status === 400);
  ok('1. "tell only" someone who is remembered is refused', (await H(meena, 'mood_set', { value: 'theek', tell: 'one', toId: dadaji.id })).status === 400);
  ok('1. a mood that is not one of the five is refused', (await H(meena, 'mood_set', { value: 'furious' })).status === 400);
  // An older phone posts to /api/events with no choice of who to tell.
  r = await call(api.events, { token: kabir.token, body: { code: 'SHARMA', memberId: kabir.id, type: 'pulse', value: 'mushkil' } });
  ok('1. an older phone that sends no choice is private too', r.status === 201 && (await feed()).length === 0 && !(await EV(rohan)).pulse.answers.some(a => a.memberId === kabir.id));
  ok('1. an outsider reads nothing', (await HG(outsider)).status === 403 && (await HG(posing)).status === 403);
  ok('1. a group gets the mood card too, and no weekly family question', (await HG(rohanG)).sawaal === null && (await HG(rohanG)).mood.moods.length === 5);
}

// ================================================================ 2. a private word, and 7. sorry
{
  pushed.length = 0;
  let r = await H(meena, 'baat_send', { kind: 'talk', toId: rohan.id, line: 'Kal ki baat par thoda bura laga', when: 'After dinner' });
  ok('2. Meena tells Rohan "Mujhe baat karni hai"', r.status === 201 && !!r.id, JSON.stringify(r));
  const baatId = r.id;
  ok('2. one push, to Rohan alone, and the lock screen says nothing of what she wrote', pushed.length === 1 && to(rohan).length === 1
    && /Meena: Mujhe baat karni hai/.test(pushed[0].body.title) && !/bura/.test(JSON.stringify(pushed[0].body)), JSON.stringify(pushed));
  ok('2. NOT ON THE FEED', (await feed()).length === 0);
  ok('2. Rohan reads it', (await HG(rohan)).baat.list.some(b => b.id === baatId && b.line === 'Kal ki baat par thoda bura laga' && b.when === 'After dinner' && !b.mine));
  ok('2. Meena sees what she sent', (await HG(meena)).baat.list.some(b => b.id === baatId && b.mine));
  for (const [nm, who] of [['Papa (an elder of the family)', papa], ['Kabir', kabir]]) {
    const t = await HG(who);
    ok('2. ' + nm + ' SEES NOTHING OF IT', t.status === 200 && t.baat.list.length === 0 && !JSON.stringify(t).includes('bura laga'));
    ok('2. ' + nm + ' cannot answer it, close it or hear it', (await H(who, 'baat_reply', { id: baatId, reply: 'come' })).status === 404
      && (await H(who, 'baat_close', { id: baatId })).status === 404 && (await HG(who, { view: 'audio', kind: 'baat', id: baatId })).status === 404);
  }
  ok('2. an outsider is refused', (await H(outsider, 'baat_send', { kind: 'talk', toId: rohan.id })).status === 403 && (await HG(posing)).status === 403);
  ok('2. it cannot be sent to oneself', (await H(meena, 'baat_send', { kind: 'talk', toId: meena.id })).status === 400);
  ok('2. nor to someone not on the app (it would never reach them)', (await H(meena, 'baat_send', { kind: 'talk', toId: dadi.id })).status === 400);
  ok('2. nor to someone who is remembered', (await H(meena, 'baat_send', { kind: 'talk', toId: dadaji.id })).status === 400);
  ok('2. a card number in the line is refused', (await H(meena, 'baat_send', { kind: 'talk', toId: rohan.id, line: 'my card is 4111 1111 1111 1111' })).status === 400);
  ok('2. the sender cannot answer her own', (await H(meena, 'baat_reply', { id: baatId, reply: 'come' })).status === 404);

  pushed.length = 0;
  r = await H(rohan, 'baat_reply', { id: baatId, reply: 'call', at: '7 this evening' });
  ok('2. Rohan answers "I will call you at 7 this evening": one push, to Meena alone', r.status === 200 && pushed.length === 1 && to(meena).length === 1 && /I will call you at 7 this evening/.test(pushed[0].body.title), JSON.stringify(pushed));
  ok('2. Meena reads the answer', (await HG(meena)).baat.list.find(b => b.id === baatId).reply.at === '7 this evening');
  ok('2. "call" with no time is refused', (await H(rohan, 'baat_reply', { id: baatId, reply: 'call' })).status === 400);

  // A voice note, and a voice answer.
  r = await H(kabir, 'baat_send', { kind: 'talk', toId: papa.id, ...VOICE });
  const kId = r.id;
  ok('2. Kabir (13) sends Dada a voice note: any member, to any one person', r.status === 201);
  ok('2. only the two of them can play it', (await HG(papa, { view: 'audio', kind: 'baat', id: kId })).status === 200 && (await HG(kabir, { view: 'audio', kind: 'baat', id: kId })).status === 200
    && (await HG(rohan, { view: 'audio', kind: 'baat', id: kId })).status === 404 && (await HG(meena, { view: 'audio', kind: 'baat', id: kId })).status === 404);
  ok('2. a list never carries the sound itself', !JSON.stringify((await HG(papa)).baat).includes(VOICE.audio));

  // The reminder: once, after a day, to the receiver only. Then silence.
  pushed.length = 0;
  const made = new Date((await admin.query('select created_at from baat where id = $1', [kId])).rows[0].created_at).getTime();
  ok('2. no reminder before a day has passed', (await Baat.baatSweep(sql, made + 23 * 3600000)) === 0 && pushed.length === 0);
  const sent = await Promise.all([1, 2, 3].map(() => Baat.baatSweep(sql, made + 25 * 3600000)));
  ok('2. ONE gentle reminder after 24 hours, however many timers run at once', sent.reduce((a, b) => a + b, 0) === 1 && pushed.length === 1 && to(papa).length === 1 && /waiting to hear from you/.test(pushed[0].body.title), JSON.stringify(pushed));
  ok('2. THEN SILENCE: never a second reminder', (await Baat.baatSweep(sql, made + 9 * 86400000)) === 0 && pushed.length === 1);
  ok('2. an answered one is never reminded', (await count('select count(*)::int as n from baat where id = $1 and reminded_at is null', [baatId])) === 1);
  // And the real timer reaches it (one line in runTick).
  r = await H(meena, 'baat_send', { kind: 'cantalk', toId: papa.id });
  await admin.query(`update baat set created_at = now() - interval '25 hours' where id = $1`, [r.id]);
  pushed.length = 0;
  await runTick(sql);
  ok('2. the timer (runTick) sends the reminder', to(papa).filter(p => /waiting to hear from you/.test(p.body.title)).length === 1, JSON.stringify(pushed.map(p => p.body.title)));

  // 7. Sorry and repair: the same door, the same privacy.
  pushed.length = 0;
  r = await H(rohan, 'baat_send', { kind: 'sorry', toId: meena.id });
  ok('7. "Maaf karna", one tap, to Meena alone', r.status === 201 && pushed.length === 1 && to(meena).length === 1 && /Rohan: Maaf karna/.test(pushed[0].body.title));
  ok('7. nobody else sees it', !(await HG(papa)).baat.list.some(b => b.kind === 'sorry') && (await HG(meena)).baat.list.some(b => b.kind === 'sorry' && b.title === 'Maaf karna'));
  r = await H(meena, 'baat_reply', { id: r.id, reply: 'voice', ...VOICE });
  ok('7. she answers by voice', r.status === 200 && (await HG(rohan)).baat.list.find(b => b.kind === 'sorry').reply.hasAudio === true);
  ok('7. a voice answer with no recording is refused', (await H(papa, 'baat_reply', { id: kId, reply: 'voice' })).status === 400);
  ok('7. either of the two can put it away', (await H(meena, 'baat_close', { id: baatId })).status === 200 && !(await HG(rohan)).baat.list.some(b => b.id === baatId));

  // A few a day from one person to one person, counted on the server.
  let last = 0;
  for (let i = 0; i < R.BAAT_PER_DAY + 1; i++) last = (await H(kabir, 'baat_send', { kind: 'talk', toId: meena.id })).status;
  ok('2. one person cannot flood another: the server stops it', last === 429);
  ok('2. nothing about any of this ever reached the feed', (await feed()).length === 0);
}

// ================================================================ 3. shukriya
{
  pushed.length = 0;
  let r = await H(rohan, 'shukriya_send', { toId: dadi.id, line: 'Thank you for the lori you sang to Kabir' });
  ok('3. Rohan thanks Dadi, who is not on the app: it is kept', r.status === 201 && r.kept === true && pushed.length === 0, JSON.stringify(r));
  const sId = r.id;
  ok('3. private to the two by default: Meena does not see it', !(await HG(meena, { view: 'shukriya' })).list.some(s => s.id === sId));
  ok('3. Rohan can read it out or share it: it is in his own list', (await HG(rohan, { view: 'shukriya' })).list.some(s => s.id === sId && s.mine && !s.toOnApp));
  ok('3. not on the feed', (await feed()).length === 0);
  r = await H(meena, 'shukriya_send', { toId: papa.id, line: 'Papa, thank you for the chai every morning', audience: 'family' });
  ok('3. Meena thanks Papa and shows the family', r.status === 201 && to(papa).length === 1 && (await feed()).some(x => /Meena said shukriya to Papa/.test(x)));
  ok('3. Kabir sees that one, and still not the private one', (await HG(kabir, { view: 'shukriya' })).list.length === 1);
  r = await H(kabir, 'shukriya_send', { toId: meena.id, ...VOICE });
  ok('3. Kabir thanks his mother by voice', r.status === 201 && (await HG(meena, { view: 'audio', kind: 'shukriya', id: r.id })).status === 200
    && (await HG(papa, { view: 'audio', kind: 'shukriya', id: r.id })).status === 404);
  ok('3. nothing to say is refused', (await H(kabir, 'shukriya_send', { toId: meena.id })).status === 400);
  ok('3. someone remembered cannot be thanked here', (await H(rohan, 'shukriya_send', { toId: dadaji.id, line: 'x' })).status === 404);
  ok('3. nor oneself, nor a stranger', (await H(rohan, 'shukriya_send', { toId: rohan.id, line: 'x' })).status === 404 && (await H(rohan, 'shukriya_send', { toId: vikramG.id, line: 'x' })).status === 404);

  // The weekly quiet prompt. (Reading Today earlier in this test already made this week's prompts,
  // before anyone had thanked anyone; they are cleared so this part starts from what is true now.)
  await admin.query('delete from shukriya_prompts');
  const prompts = {};
  for (const who of [rohan, meena, papa, kabir]) prompts[who.name] = (await HG(who)).shukriya.prompt;
  ok('3. each member is quietly offered someone to thank', Object.values(prompts).every(p => p && p.toId && p.name));
  ok('3. never themself, NEVER SOMEONE WHO IS REMEMBERED', [rohan, meena, papa, kabir].every(w => prompts[w.name].toId !== w.id && prompts[w.name].toId !== dadaji.id));
  ok('3. never someone they thanked lately', prompts.Rohan.toId !== dadi.id && prompts.Meena.toId !== papa.id && prompts.Kabir.toId !== meena.id);
  ok('3. the same person all week, on every phone', (await HG(rohan)).shukriya.prompt.toId === prompts.Rohan.toId);
  ok('3. NO COUNT AND NO LEADERBOARD in what a phone is sent', !/count|total|score|rank|\bn\b/i.test(Object.keys(JSON.parse(JSON.stringify((await HG(rohan)).shukriya.prompt))).join()));
  const spread = (await admin.query('select target_id, count(*)::int as n from shukriya_prompts group by target_id')).rows.map(x => x.n);
  ok('3. the four suggestions are spread, not piled on one person', Math.max(...spread) - Math.min(...spread) <= 1 && spread.length >= 3, spread.join());
  r = await H(rohan, 'shukriya_send', { toId: prompts.Rohan.toId, line: 'Shukriya for everything' });
  ok('3. thanking that person closes the prompt for the week', r.status === 201 && (await HG(rohan)).shukriya.prompt === null);
  ok('3. "Not this week" closes it too', (await H(papa, 'shukriya_later')).status === 200 && (await HG(papa)).shukriya.prompt === null);
  // Marked as remembered after the prompt was made: gone at once.
  const kTarget = prompts.Kabir.toId;
  if (kTarget === dadi.id) {
    await admin.query('update members set remembered = true where id = $1', [dadi.id]);
    ok('3. a person marked as remembered after the prompt is taken off it at once', (await HG(kabir)).shukriya.prompt === null);
    await admin.query('update members set remembered = false where id = $1', [dadi.id]);
  } else ok('3. a person marked as remembered after the prompt is taken off it at once (not this week\'s pick: rule checked in the unit test)', true);
}

// ================================================================ 6. the family's weekly question
let sawaalWeek;
{
  let t = await HG(rohan);
  sawaalWeek = t.sawaal.week;
  ok('6. the family has one question this week, from the list', R.FAMILY_QUESTIONS.includes(t.sawaal.question) && t.sawaal.answered === false);
  ok('6. everyone gets the same one', (await HG(kabir)).sawaal.question === t.sawaal.question);
  let r = await H(meena, 'sawaal_answer', { text: 'Aloo paratha with white butter' });
  ok('6. Meena answers by typing', r.status === 200);
  r = await H(kabir, 'sawaal_answer', VOICE);
  ok('6. Kabir answers by voice', r.status === 200);
  t = await HG(rohan);
  ok('6. ROHAN HAS NOT ANSWERED, SO HE IS SENT NO ANSWERS (the rule is in the query)', t.sawaal.answers.length === 0 && !JSON.stringify(t.sawaal).includes('paratha') && t.sawaal.count === 2);
  const kAns = (await admin.query('select id from sawaal_answers where member_id = $1', [kabir.id])).rows[0].id;
  ok('6. nor can he play a voice answer yet', (await HG(rohan, { view: 'audio', kind: 'sawaal', id: kAns })).status === 404);
  ok('6. nothing to say is refused', (await H(rohan, 'sawaal_answer', {})).status === 400);
  r = await H(rohan, 'sawaal_answer', { text: 'Rajma chawal on a Sunday' });
  t = await HG(rohan);
  ok('6. once he answers, he reads everyone', r.status === 200 && t.sawaal.answered && t.sawaal.answers.length === 3 && t.sawaal.answers.some(a => a.name === 'Meena' && /paratha/.test(a.text)));
  ok('6. and can play Kabir\'s voice', (await HG(rohan, { view: 'audio', kind: 'sawaal', id: kAns })).status === 200);
  ok('6. it says who is still to answer', t.sawaal.waiting === 'Waiting for Papa', t.sawaal.waiting);
  ok('6. Dadi is offered as someone to answer for', t.sawaal.offApp.some(p => p.id === dadi.id) && !t.sawaal.offApp.some(p => p.id === dadaji.id));
  r = await H(rohan, 'sawaal_answer', { forId: dadi.id, text: 'Besan ke laddu, always' });
  t = await HG(meena);
  ok('6. Rohan answers FOR Dadi: "told by Dadi, recorded by Rohan"', r.status === 200 && t.sawaal.answers.some(a => a.name === 'Dadi' && a.told === 'told by Dadi, recorded by Rohan'), JSON.stringify(t.sawaal.answers));
  ok('6. nobody answers for someone who is on the app', (await H(rohan, 'sawaal_answer', { forId: papa.id, text: 'x' })).status === 400);
  ok('6. nor for someone who is remembered', (await H(rohan, 'sawaal_answer', { forId: dadaji.id, text: 'x' })).status === 404);
  ok('6. answering for Dadi is not answering for yourself', (await HG(papa)).sawaal.answers.length === 0);
  ok('6. a group has its own throwback question, not this one', (await H(rohanG, 'sawaal_answer', { text: 'x' })).status === 400);
  ok('6. at least forty questions', R.FAMILY_QUESTIONS.length >= 40);
}

// ================================================================ 12. the memory card
{
  let t = await HG(meena);
  ok('12. Dadaji\'s day of remembrance opens a memory card on Today', t.remember.length === 1 && t.remember[0].name === 'Dadaji' && /day of remembrance/.test(t.remember[0].title), JSON.stringify(t.remember));
  const cardId = t.remember[0].id;
  pushed.length = 0;
  await Promise.all([Rm.sweepRemember(sql, fam), Rm.sweepRemember(sql, fam)]);
  ok('12. the yearly reminder went once (to the four on Parwah) and points at the memory card', remembrancePushes.length === 4 && remembrancePushes.every(p => /memory card/.test(p.body.body)) && pushed.length === 0, JSON.stringify(remembrancePushes.map(p => p.body.body)));
  ok('12. however many phones and timers look, there is ONE card for the year', (await count('select count(*)::int as n from remember_cards where member_id = $1', [dadaji.id])) === 1);
  ok('12. Meena adds a line', (await H(meena, 'rcard_add', { cardId, kind: 'text', text: 'Dadaji ki chai aur unki kahaniyan' })).status === 201);
  ok('12. Kabir adds a voice note: a child can add too', (await H(kabir, 'rcard_add', { cardId, kind: 'voice', ...VOICE })).status === 201);
  ok('12. Papa adds a photo', (await H(papa, 'rcard_add', { cardId, kind: 'photo', data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==' })).status === 201);
  t = await HG(rohan);
  ok('12. the family reads it together', t.remember[0].entries.length === 3 && t.remember[0].entries.some(e => e.name === 'Meena' && /kahaniyan/.test(e.text)) && t.remember[0].entries.some(e => e.kind === 'photo' && /^data:image/.test(e.data)));
  const vId = t.remember[0].entries.find(e => e.kind === 'voice').id;
  ok('12. the voice note plays for the family, not for an outsider', (await HG(rohan, { view: 'audio', kind: 'rcard', id: vId })).status === 200 && (await HG(outsider, { view: 'audio', kind: 'rcard', id: vId })).status === 403);
  ok('12. only who added something can take it off', (await H(rohan, 'rcard_remove', { entryId: vId })).status === 403 && (await H(kabir, 'rcard_remove', { entryId: vId })).status === 200);
  for (let i = 0; i < 2; i++) await H(meena, 'rcard_add', { cardId, kind: 'text', text: 'line ' + i });
  ok('12. three things each', (await H(meena, 'rcard_add', { cardId, kind: 'text', text: 'a fourth' })).status === 400);
  ok('12. a card of another family is not reachable', (await H(vikramG, 'rcard_add', { cardId, kind: 'text', text: 'x' })).status === 404);
  ok('12. nothing about it is on the feed', !(await feed()).some(x => /kahaniyan/.test(x)));
  ok('12. a group has no memory card', (await HG(rohanG)).remember.length === 0);
}

// ================================================================ 4a. stories: heard, and answered
{
  await B(papa, 'teller_invite', { targetId: papa.id });
  let t = await BG(papa, { view: 'today' });
  let r = await B(papa, 'story_answer', { id: t.ask.id, text: 'We walked four kilometres to school, and raced the bus.' });
  ok('4. Papa tells this week\'s story', r.status === 200, JSON.stringify(r));
  const storyId = t.ask.id;
  pushed.length = 0;
  r = await B(meena, 'story_heard', { id: storyId });
  ok('4. Meena taps "Suna, bahut accha laga": pushed to the teller, and only him', r.status === 200 && r.first && pushed.length === 1 && to(papa).length === 1
    && /Meena heard your story/.test(pushed[0].body.title) && /Suna, bahut accha laga/.test(pushed[0].body.body), JSON.stringify(pushed));
  r = await B(meena, 'story_heard', { id: storyId });
  ok('4. a second tap does not push again', r.status === 200 && !r.first && pushed.length === 1);
  r = await B(kabir, 'story_heard', { id: storyId, ...VOICE });
  ok('4. Kabir leaves a voice reply', r.status === 200 && to(papa).length === 2 && /voice reply/.test(pushed[1].body.body));
  let mem = await BG(rohan, { view: 'memory' });
  let st = mem.stories.find(s => s.id === storyId);
  ok('4. "Heard by" names, for everyone who may read the story', st.heardBy.join() === 'Meena,Kabir' && st.heardByMe === false && st.replies.length === 0, JSON.stringify(st.heardBy));
  st = (await BG(papa, { view: 'memory' })).stories.find(s => s.id === storyId);
  ok('4. the teller sees who left a voice reply', st.replies.length === 1 && st.replies[0].name === 'Kabir');
  ok('4. the voice reply is for the teller and whoever left it', (await BG(papa, { view: 'audio', kind: 'heard', id: storyId, by: kabir.id })).status === 200
    && (await BG(kabir, { view: 'audio', kind: 'heard', id: storyId, by: kabir.id })).status === 200 && (await BG(rohan, { view: 'audio', kind: 'heard', id: storyId, by: kabir.id })).status === 403);
  ok('4. nobody "hears" their own story', (await B(papa, 'story_heard', { id: storyId })).status === 400);
  await B(papa, 'story_visibility', { id: storyId, visibility: 'private' });
  ok('4. a story kept private cannot be "heard" by anyone', (await B(rohan, 'story_heard', { id: storyId })).status === 403);
  await B(papa, 'story_visibility', { id: storyId, visibility: 'circle' });

  // Told by Dadi, recorded by Rohan.
  pushed.length = 0;
  r = await B(rohan, 'story_for', { targetId: dadi.id, question: 'How did you and Dadaji meet?', text: 'At my cousin\'s wedding in Kanpur. He would not stop staring.' });
  ok('4. Rohan records a story FOR Dadi', r.status === 201 && r.told === 'told by Dadi, recorded by Rohan', JSON.stringify(r));
  const told = (await BG(meena, { view: 'memory' })).stories.find(s => s.id === r.id);
  ok('4. it is shown as "told by Dadi, recorded by Rohan", under Dadi\'s name', told && told.about_name === 'Dadi' && told.told === 'told by Dadi, recorded by Rohan' && !told.mine);
  ok('4. the feed says the same, with both names', (await feed()).some(x => /A story told by Dadi, recorded by Rohan/.test(x)));
  ok('4. Meena can say she heard it: Rohan, who recorded it, is told', (await B(meena, 'story_heard', { id: r.id })).status === 200 && to(rohan).some(p => /heard your story/.test(p.body.title)));
  ok('4. the relative who recorded it can take it off; someone else cannot', (await B(meena, 'story_remove', { id: r.id })).status === 403);
  ok('4. nobody records for someone who is on the app', (await B(rohan, 'story_for', { targetId: papa.id, question: 'How did you meet?', text: 'x' })).status === 400);
  ok('4. nor for someone who is remembered', (await B(rohan, 'story_for', { targetId: dadaji.id, question: 'How did you meet?', text: 'x' })).status === 400);
  ok('4. a sad question is refused, as everywhere in stories', (await B(rohan, 'story_for', { targetId: dadi.id, question: 'What is your last wish?', text: 'x' })).status === 400);
}

// ================================================================ 4b. cards: reminded, never delivered empty, thanked
const ist = (day, h) => fromWall({ y: +day.slice(0, 4), m: +day.slice(5, 7), d: +day.slice(8, 10), h, mi: 0 }, 'Asia/Kolkata');
const plus = (day, k) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
{
  const circle = { id: fam, kind: 'family', name: 'Sharma Family', code: 'SHARMA' };
  const tomorrow = plus(today, 1);
  let r = await P(rohan, 'bond_card_start', { forMember: meena.id, occasion: 'birthday', date: tomorrow, title: "Meena's birthday" });
  ok('4. Rohan starts a card for Meena, for tomorrow', r.status === 201, JSON.stringify(r));
  const cardB = r.id;
  pushed.length = 0;
  await Bond.sweepBond(sql, circle, ist(today, 17));
  ok('4. at 5pm the day before, nobody is reminded yet', pushed.length === 0, JSON.stringify(pushed.map(p => p.body.title)));
  await Promise.all([Bond.sweepBond(sql, circle, ist(today, 19)), Bond.sweepBond(sql, circle, ist(today, 19))]);
  const empty = pushed.filter(p => /still empty/.test(p.body.title));
  ok('4. THE EVENING BEFORE, AN EMPTY CARD: the other ADULTS are told, once', empty.length === 2 && empty.some(p => p.to === rohan.id) && empty.some(p => p.to === papa.id), JSON.stringify(pushed.map(p => [p.to === kabir.id ? 'kabir' : p.to === meena.id ? 'MEENA' : 'adult', p.body.title])));
  ok('4. NEVER THE PERSON the card is for', to(meena).length === 0 && !JSON.stringify(pushed).includes(meena.id));
  ok('4. a child is reminded to write, but is not told it is empty', to(kabir).length === 1 && /is tomorrow$/.test(to(kabir)[0].body.title));
  ok('4. the message says she is not told', /Meena is not told/.test(empty[0].body.body));
  pushed.length = 0;
  await Bond.sweepBond(sql, circle, ist(today, 21));
  ok('4. the reminder goes once', pushed.length === 0);

  // A card that already has a line: only those who have not written are reminded.
  r = await P(meena, 'bond_card_start', { forMember: kabir.id, occasion: 'other', date: tomorrow, title: 'Well done Kabir' });
  const cardK = r.id;
  ok('4. writing in a card', (await P(meena, 'bond_card_add', { cardId: cardK, kind: 'text', text: 'So proud of you, beta' })).status === 201);
  pushed.length = 0;
  await Bond.sweepBond(sql, circle, ist(today, 19));
  ok('4. with one line written: only those who have not written are reminded, never the writer or the person', pushed.length === 2 && to(rohan).length === 1 && to(papa).length === 1
    && to(meena).length === 0 && to(kabir).length === 0 && pushed.every(p => /Your line is not on the card yet/.test(p.body.body)), JSON.stringify(pushed.map(p => p.body.title)));

  // On the day: an empty card is never handed over.
  r = await P(rohan, 'bond_card_start', { forMember: papa.id, occasion: 'birthday', date: today, title: "Papa's birthday" });
  const cardA = r.id;
  pushed.length = 0;
  await Bond.sweepBond(sql, circle);
  ok('4. ON THE DAY, AN EMPTY CARD IS NEVER MARKED AS DELIVERED', (await count('select count(*)::int as n from cards where id = $1 and delivered_at is null', [cardA])) === 1);
  ok('4. and Papa is told nothing', to(papa).filter(p => /made you a card/.test(p.body.title)).length === 0);
  ok('4. Papa does not see an empty card for himself, on Today or by its id', !(await PG(papa)).cards.some(c => c.id === cardA) && (await PG(papa, { card: cardA })).status === 404);
  ok('4. the others still see it, to write in', (await PG(meena)).cards.some(c => c.id === cardA && c.n === 0));
  await P(meena, 'bond_card_add', { cardId: cardA, kind: 'text', text: 'Happy birthday Papa' });
  await P(kabir, 'bond_card_add', { cardId: cardA, kind: 'text', text: 'Happy birthday Dada' });
  pushed.length = 0;
  await Promise.all([Bond.sweepBond(sql, circle), Bond.sweepBond(sql, circle)]);
  ok('4. once someone writes, it is handed over, once', to(papa).filter(p => /made you a card/.test(p.body.title)).length === 1 && /2 messages are waiting/.test(to(papa)[0].body.body), JSON.stringify(pushed.map(p => p.body)));
  let card = await PG(papa, { card: cardA });
  ok('4. Papa opens it and can say thank you', card.status === 200 && card.entries.length === 2 && card.card.canThank === true);
  ok('4. only the person the card is for can say thank you', (await P(rohan, 'bond_card_thanks', { cardId: cardA })).status === 403);
  pushed.length = 0;
  r = await P(papa, 'bond_card_thanks', { cardId: cardA });
  ok('4. "Say thank you", one tap: the writers are told, and only the writers', r.status === 201 && r.told === 2 && pushed.length === 2 && to(meena).length === 1 && to(kabir).length === 1 && to(rohan).length === 0
    && /Papa says thank you for the card/.test(pushed[0].body.title), JSON.stringify(pushed.map(p => p.body.title)));
  ok('4. a second tap tells nobody again', (await P(papa, 'bond_card_thanks', { cardId: cardA })).already === true && pushed.length === 2);
  ok('4. the writers see that he said thank you', (await PG(meena)).cards.find(c => c.id === cardA).thanks === 'Papa' && (await PG(meena, { card: cardA })).thanks[0].name === 'Papa');
  ok('4. the person is not thanked for a card still sealed to them', (await P(meena, 'bond_card_thanks', { cardId: cardB })).status === 403);
  // For someone not on the app: the family shows, prints or sends it.
  r = await P(rohan, 'bond_card_start', { forMember: dadi.id, occasion: 'birthday', date: plus(today, 5), title: "Dadi's birthday" });
  await P(rohan, 'bond_card_add', { cardId: r.id, kind: 'text', text: 'Pranam Dadi' });
  card = await PG(meena, { card: r.id });
  ok('4. a card for someone not on the app is marked so, for the print and share view', card.card.offApp === true && (await PG(meena)).cards.find(c => c.id === r.id).off_app === true
    && (await PG(meena)).cards.find(c => c.id === cardA).off_app === false);
}

// ================================================================ 4c. the album: reactions, a voice caption, one push a day
{
  const jpeg = (w, h, size) => {
    const head = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xC0, 0x00, 0x0B, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0];
    return Buffer.from([...head, ...new Array(Math.max(4, size - head.length - 2)).fill(0x11), 0xFF, 0xD9]).toString('base64');
  };
  const one = () => ({ photo: jpeg(1600, 1200, 5000), thumb: jpeg(320, 240, 900) });
  let list = await AG(rohan);
  const famAlbum = list.albums.find(a => a.isDefault).id;
  pushed.length = 0;
  let r = await A(rohan, 'photo_add', { albumId: famAlbum, photos: [one(), one()] });
  ok('4. Rohan adds two photos', r.status === 201 && r.ids.length === 2, JSON.stringify(r).slice(0, 200));
  const photoId = r.ids[0];
  ok('4. the family is pushed about new photos, once each', pushed.length === 3 && to(rohan).length === 0 && pushed.every(p => /New photos/.test(p.body.title)), JSON.stringify(pushed.map(p => p.body.title)));
  pushed.length = 0;
  await A(meena, 'photo_add', { albumId: famAlbum, photos: [one()] });
  await A(papa, 'photo_add', { albumId: famAlbum, photos: [one()] });
  ok('4. AT MOST ONE "new photos" PUSH A DAY for the family, whoever adds', pushed.length === 0, JSON.stringify(pushed.map(p => p.body.title)));
  r = await A(meena, 'photo_react', { id: photoId, emoji: '❤️' });
  ok('4. Meena reacts to a photo', r.status === 200 && r.photo.reactions[0].emoji === '❤️' && r.photo.reactions[0].mine && pushed.length === 0);
  await A(kabir, 'photo_react', { id: photoId, emoji: '❤️' });
  await A(meena, 'photo_react', { id: photoId, emoji: '🙏' });
  let ph = (await AG(papa)).photos.find(p => p.id === photoId);
  ok('4. one reaction per person, with names, and it can be changed', ph.reactions.map(x => x.emoji + x.count).sort().join() === '❤️1,🙏1' && ph.reactions.find(x => x.emoji === '🙏').names.join() === 'Meena');
  await A(meena, 'photo_react', { id: photoId, emoji: null });
  ok('4. and taken back', (await AG(papa)).photos.find(p => p.id === photoId).reactions.length === 1);
  ok('4. only the five reactions', (await A(meena, 'photo_react', { id: photoId, emoji: '💩' })).status === 400);
  ok('4. a reaction never goes on the feed', !(await feed()).some(x => /react/i.test(x)));
  ok('4. only whoever added the photo can give it a voice caption', (await A(meena, 'photo_voice', { id: photoId, ...AVOICE })).status === 403);
  r = await A(rohan, 'photo_voice', { id: photoId, ...AVOICE });
  ph = (await AG(kabir)).photos.find(p => p.id === photoId);
  ok('4. Rohan adds a voice caption; everyone the album is for can play it', r.status === 201 && ph.hasVoice === true && ph.voiceSecs === 4 && (await AG(kabir, { view: 'voice', id: photoId })).audio.startsWith('data:audio/webm'));
  // A private album: its photos take no reaction or listen from anyone else.
  r = await A(rohan, 'album_save', { name: 'Only mine', audience: 'me' });
  const mine = await A(rohan, 'photo_add', { albumId: r.id, photos: [one()] });
  await A(rohan, 'photo_voice', { id: mine.ids[0], ...AVOICE });
  ok('4. a photo in a private album takes no reaction and plays no caption for anyone else', (await A(meena, 'photo_react', { id: mine.ids[0], emoji: '❤️' })).status === 404
    && (await AG(meena, { view: 'voice', id: mine.ids[0] })).status === 404 && (await AG(outsider, { view: 'voice', id: photoId })).status === 403);
  ok('4. the voice caption can be taken off', (await A(rohan, 'photo_voice_remove', { id: photoId })).status === 200 && (await AG(kabir, { view: 'voice', id: photoId })).status === 404);
}

// ================================================================ 5. equal votes
let famChat;
{
  famChat = (await CG(rohan)).chats.find(c => c.kind === 'circle').id;
  const ask = (who, body) => C(who, 'poll_create', { chatId: famChat, ...body });
  const vote = (who, pollId, choices, extra = {}) => C(who, 'poll_vote', { chatId: famChat, pollId, choices, ...extra });
  const poll = async (who, pollId) => (await CG(who, { chat: famChat })).messages.filter(m => m.poll && m.poll.id === pollId)[0].poll;

  let r = await ask(rohan, { question: 'Where for the summer holidays?', options: ['Shimla', 'Goa', 'Stay home'], secret: true });
  ok('5. Rohan asks a SECRET BALLOT', r.status === 201);
  const sp = r.pollId;
  await vote(meena, sp, [1]); await vote(kabir, sp, [1]); await vote(papa, sp, [0]);
  for (const who of [rohan, meena, papa, kabir]) {
    const raw = await CG(who, { chat: famChat });
    const p = raw.messages.filter(m => m.poll && m.poll.id === sp)[0].poll;
    ok('5. ' + who.name + ': the counts are sent, and NO NAME OF WHO PICKED WHAT', p.secret === true && p.options.map(o => o.count).join() === '1,2,0' && p.options.every(o => o.names.length === 0), JSON.stringify(p.options));
    ok('5. ' + who.name + ': no voter id is anywhere in the poll', ![meena, kabir, papa].some(v => v.id !== who.id && JSON.stringify(p).includes(v.id)));
  }
  ok('5. each still sees their own vote', (await poll(meena, sp)).mine.join() === '1' && (await poll(rohan, sp)).mine.length === 0);
  ok('5. KABIR IS 13 AND HIS VOTE COUNTS THE SAME: Goa has two, his and his mother\'s', (await poll(papa, sp)).options[1].count === 2 && (await poll(papa, sp)).voters === 3);
  ok('5. "Waiting for" says who has not voted (not how anyone voted)', (await poll(meena, sp)).waiting === 'Waiting for Rohan', (await poll(meena, sp)).waiting);

  // An open poll, a proxy vote and the one reminder.
  r = await ask(rohan, { question: 'Sunday lunch at whose house?', options: ['Ours', 'Chacha ji'] });
  const op = r.pollId;
  await vote(meena, op, [0]);
  r = await vote(rohan, op, [1], { forId: dadi.id });
  let p = await poll(kabir, op);
  ok('5. Rohan votes FOR Dadi: kept and shown as "for Dadi, by Rohan"', r.status === 200 && p.options[1].names.join() === 'for Dadi, by Rohan' && p.options[1].count === 1, JSON.stringify(p.options));
  ok('5. that was not Rohan\'s own vote', (await poll(rohan, op)).mine.length === 0 && (await poll(rohan, op)).mineFor[0].label === 'for Dadi, by Rohan');
  ok('5. Dadi is offered as someone to vote for; Dadaji never', p.offApp.some(x => x.id === dadi.id && x.voted) && !p.offApp.some(x => x.id === dadaji.id));
  ok('5. nobody votes for someone who is on the app', (await vote(rohan, op, [0], { forId: papa.id })).status === 400);
  ok('5. nor for someone who is remembered, nor a stranger', (await vote(rohan, op, [0], { forId: dadaji.id })).status === 404 && (await vote(rohan, op, [0], { forId: vikramG.id })).status === 404);
  ok('5. Meena cannot take back the vote Rohan gave for Dadi', (await vote(meena, op, [], { forId: dadi.id })).status === 200 && (await poll(kabir, op)).options[1].count === 1);
  ok('5. Rohan can', (await vote(rohan, op, [], { forId: dadi.id })).status === 200 && (await poll(kabir, op)).options[1].count === 0);
  await vote(rohan, op, [1], { forId: dadi.id });
  ok('5. only the person who asked sends the reminder', (await C(meena, 'poll_remind', { chatId: famChat, pollId: op })).status === 403 && (await poll(rohan, op)).canRemind === true && (await poll(meena, op)).canRemind === false);
  pushed.length = 0;
  r = await C(rohan, 'poll_remind', { chatId: famChat, pollId: op });
  ok('5. ONE reminder, only to the people who have not voted', r.status === 200 && pushed.length === 2 && to(papa).length === 1 && to(kabir).length === 1 && to(meena).length === 0 && /waiting for your vote/.test(pushed[0].body.title), JSON.stringify(pushed.map(x => x.body.title)));
  ok('5. a second reminder is refused, and sends nothing', (await C(rohan, 'poll_remind', { chatId: famChat, pollId: op })).status === 409 && pushed.length === 2 && (await poll(rohan, op)).canRemind === false);
  // A group chat inside the family: no proxy there.
  const g = await C(rohan, 'create_group', { name: 'Parents', memberIds: [meena.id] });
  const gp = await C(rohan, 'poll_create', { chatId: g.chatId, question: 'Tuition or not?', options: ['Yes', 'No'], secret: true });
  ok('5. a vote for someone not on the app is for the family chat only', (await C(rohan, 'poll_vote', { chatId: g.chatId, pollId: gp.pollId, choices: [0], forId: dadi.id })).status === 400);

  // ---- date polls
  const d1 = new Date(Date.now() + 5 * 86400000).toISOString(), d2 = new Date(Date.now() + 6 * 86400000).toISOString();
  r = await P(rohan, 'bond_poll_create', { title: 'Diwali dinner', options: [d1, d2], kind: 'meet', secret: true });
  ok('5. Rohan asks for a date, as a secret ballot', r.status === 201);
  const dp = r.id;
  const opts = async (who) => (await PG(who)).polls.find(x => x.id === dp);
  let st = await opts(rohan);
  const o1 = st.options[0].id, o2 = st.options[1].id;
  await P(meena, 'bond_poll_vote', { optionId: o1, answer: 'yes' }); await P(kabir, 'bond_poll_vote', { optionId: o1, answer: 'yes' });
  await P(papa, 'bond_poll_vote', { optionId: o1, answer: 'maybe' }); await P(meena, 'bond_poll_vote', { optionId: o2, answer: 'no' });
  r = await P(meena, 'bond_poll_vote', { optionId: o2, answer: 'yes', forId: dadi.id });
  ok('5. Meena answers for Dadi', r.status === 200);
  ok('5. nobody answers for someone on the app, or remembered', (await P(meena, 'bond_poll_vote', { optionId: o2, answer: 'yes', forId: papa.id })).status === 400
    && (await P(meena, 'bond_poll_vote', { optionId: o2, answer: 'yes', forId: dadaji.id })).status === 404);
  for (const who of [meena, papa, kabir]) {
    st = await opts(who);
    ok('5. date poll, ' + who.name + ': counts only, no name and no id of anyone else', st.secret && st.options[0].n.yes === 2 && st.options[0].n.maybe === 1 && st.options[0].yes.length === 0 && st.options[0].yesNames.length === 0
      && ![meena, papa, kabir].some(v => v.id !== who.id && JSON.stringify(st.options).includes(v.id))
      && !/Kabir|Papa|Meena|Rohan/.test(JSON.stringify(st.options.map(o => ({ ...o, mineFor: [] }))).replace(who.name, ''))
      && (who.id === meena.id) === JSON.stringify(st.options).includes(dadi.id), JSON.stringify(st.options));
    ok('5. date poll, ' + who.name + ': the tally is for the host, not for them', st.tally === null);
  }
  st = await opts(rohan);
  ok('5. THE HOST IS SHOWN THE TALLY BEFORE LOCKING: every date, and the one most can make', st.tally && st.tally.rows.length === 2 && st.tally.best === o1 && st.tally.rows[0].yes === 2 && st.tally.rows[1].yes === 1 && st.tally.rows[1].no === 1, JSON.stringify(st.tally));
  ok('5. Kabir\'s yes counts as one, the same as his mother\'s', st.tally.rows[0].yes === 2);
  ok('5. "Waiting for" on the date poll', st.waiting === 'Waiting for Rohan' && (await opts(meena)).mineFor === undefined && (await opts(meena)).options[1].mineFor[0].label === 'for Dadi, by Meena', st.waiting);
  await P(rohan, 'bond_poll_vote', { optionId: o1, answer: 'yes' });
  ok('5. the reminder: nobody left to remind, so it is not offered', (await opts(rohan)).canRemind === false);
  pushed.length = 0;
  r = await P(rohan, 'bond_poll_lock', { pollId: dp, optionId: o1 });
  ok('5. THE LOCK RECORDS WHAT WAS DECIDED: the date, who locked it and the counts', r.status === 200 && r.decided.yes === 3 && r.decided.maybe === 1 && r.decided.no === 0 && r.decided.byName === 'Rohan' && r.decided.mostYes === true
    && /3 yes, 1 maybe, 0 no/.test(r.decided.line), JSON.stringify(r.decided));
  const kept = (await admin.query('select decided from plan_polls where id = $1', [dp])).rows[0].decided;
  ok('5. it is kept with the poll, counts only, no voter in it', kept.optionId === o1 && kept.tally.length === 2 && ![meena, papa, kabir, dadi].some(v => JSON.stringify(kept).includes(v.id)));
  ok('5. the feed says what was decided', (await feed()).some(x => /Rohan locked the date for Diwali dinner .*3 yes, 1 maybe, 0 no/.test(x)));
  ok('5. a secret ballot stays secret after the lock: nobody is put on the "going" list from their vote', r.going === 1);
  ok('5. everyone can read the decision', (await opts(kabir)).decided.line === r.decided.line);

  // An open date poll: names show, with the proxy label, and one reminder.
  r = await P(meena, 'bond_poll_create', { title: 'Picnic', options: [d1, d2], kind: 'meet' });
  const pp = r.id;
  st = (await PG(meena)).polls.find(x => x.id === pp);
  await P(rohan, 'bond_poll_vote', { optionId: st.options[0].id, answer: 'yes' });
  await P(rohan, 'bond_poll_vote', { optionId: st.options[0].id, answer: 'yes', forId: dadi.id });
  st = (await PG(kabir)).polls.find(x => x.id === pp);
  ok('5. an open date poll shows names, and a proxy as "for Dadi, by Rohan"', st.options[0].yesNames.slice().sort().join() === 'Rohan,for Dadi, by Rohan' && st.options[0].n.yes === 2, JSON.stringify(st.options[0].yesNames));
  ok('5. only the host reminds', (await P(rohan, 'bond_poll_remind', { pollId: pp })).status === 403);
  pushed.length = 0;
  r = await P(meena, 'bond_poll_remind', { pollId: pp });
  ok('5. ONE reminder to those who have not answered', r.status === 200 && r.reminded === 2 && to(papa).length === 1 && to(kabir).length === 1 && to(rohan).length === 0 && pushed.length === 2, JSON.stringify(pushed.map(x => x.body.title)));
  ok('5. and never a second', (await P(meena, 'bond_poll_remind', { pollId: pp })).status === 409 && pushed.length === 2);
}

// ================================================================ 8. chat basics
{
  // 120 more messages in the family chat, a second apart.
  await admin.query(`insert into messages (chat_id, member_id, text, created_at)
                     select $1, $2, 'old ' || g, now() - interval '3 hours' + make_interval(secs => g) from generate_series(1, 120) g`, [famChat, papa.id]);
  const total = await count('select count(*)::int as n from messages where chat_id = $1', [famChat]);
  let page = await CG(rohan, { chat: famChat });
  ok('8. the newest 50 messages, and a cursor for more', page.messages.length === 50 && page.more === true && page.before === page.messages[0].id);
  const seen = new Set(page.messages.map(m => m.id));
  let pages = 1, overlap = false, ordered = true;
  while (page.more && pages < 10) {
    page = await CG(rohan, { chat: famChat, before: page.before });
    pages++;
    for (let i = 1; i < page.messages.length; i++) if (new Date(page.messages[i].created_at) < new Date(page.messages[i - 1].created_at)) ordered = false;
    for (const m of page.messages) { if (seen.has(m.id)) overlap = true; seen.add(m.id); }
  }
  ok('8. paging back reaches every message, none twice, oldest first within a page', seen.size === total && !overlap && ordered && page.more === false, seen.size + ' of ' + total + ' in ' + pages + ' pages');
  ok('8. a bad cursor is refused', (await CG(rohan, { chat: famChat, before: 'abc' })).status === 400);
  ok('8. another chat\'s message is not a cursor into this one: it pages nothing', (await CG(rohanG, { chat: (await CG(rohanG)).chats[0].id, before: page.messages[0].id })).messages.length === 0);

  await C(rohan, 'send', { chatId: famChat, text: 'Oops, wrong chat' });
  const mine = (await CG(rohan, { chat: famChat })).messages.slice(-1)[0];
  ok('8. nobody deletes someone else\'s message', (await C(meena, 'delete_message', { chatId: famChat, messageId: mine.id })).status === 403);
  ok('8. I delete my own message', (await C(rohan, 'delete_message', { chatId: famChat, messageId: mine.id })).status === 200 && !(await CG(meena, { chat: famChat })).messages.some(m => m.id === mine.id));
  const ekta = (await admin.query(`insert into messages (chat_id, member_id, text) values ($1, null, 'Ekta here') returning id`, [famChat])).rows[0].id;
  ok('8. nor Ekta\'s', (await C(rohan, 'delete_message', { chatId: famChat, messageId: ekta })).status === 403);

  ok('8. Meena mutes the family chat, for herself', (await C(meena, 'mute', { chatId: famChat, on: true })).muted === true && (await CG(meena)).chats.find(c => c.id === famChat).muted === true
    && (await CG(rohan)).chats.find(c => c.id === famChat).muted === false && (await CG(meena, { chat: famChat })).chat.muted === true);
  pushed.length = 0;
  await C(rohan, 'send', { chatId: famChat, text: 'Dinner at 8' });
  ok('8. a muted chat stays quiet for her, and only her', pushed.length === 2 && to(meena).length === 0 && to(papa).length === 1 && to(kabir).length === 1, JSON.stringify(pushed.map(p => p.body.title)));
  pushed.length = 0;
  await C(rohan, 'send', { chatId: famChat, text: '@Meena can you pick up Kabir?' });
  ok('8. but a message that names her still reaches her', to(meena).length === 1 && /mentioned you/.test(to(meena)[0].body.title) && pushed.length === 3);
  ok('8. unmute', (await C(meena, 'mute', { chatId: famChat, on: false })).muted === false);
  ok('8. an outsider cannot mute or delete here', (await C(outsider, 'mute', { chatId: famChat, on: true })).status === 403);
}

// ================================================================ 9. festivals, one at a time
{
  const before = (await feed()).length;
  ok('9. replacing the whole list is no longer possible', (await P(meena, 'bond_fest_set', { keys: ['holi'] })).status === 400);
  let r = await P(meena, 'bond_fest_add', { key: 'onam' });
  ok('9. Meena adds Onam', r.status === 200 && r.changed && r.chosen.join() === 'onam');
  r = await P(rohan, 'bond_fest_add', { key: 'diwali' });
  ok('9. Rohan adds Diwali: Meena\'s Onam is still there', r.chosen.slice().sort().join() === 'diwali,onam');
  await P(rohan, 'bond_fest_add', { key: 'diwali' });
  r = await P(kabir, 'bond_fest_remove', { key: 'diwali' });
  ok('9. Kabir takes Diwali off: only that one goes', r.status === 200 && r.chosen.join() === 'onam');
  const lines = (await feed()).slice(before);
  ok('9. THE FEED SAYS WHO CHANGED WHAT, once per real change', lines.length === 3 && /^Meena added Onam to the family's festivals/.test(lines[0]) && /^Rohan added Diwali/.test(lines[1]) && /^Kabir took Diwali off/.test(lines[2]), JSON.stringify(lines));
  ok('9. an unknown festival is refused', (await P(meena, 'bond_fest_add', { key: 'made-up' })).status === 400);
  const list = (await PG(rohan)).festivals.list;
  ok('9. the festivals that were missing are there', ['janmashtami', 'dussehra', 'chhath', 'baisakhi', 'ugadi', 'onam', 'pongal', 'eidfitr', 'christmas', 'gurunanak'].every(k => list.some(f => f.key === k)));
  ok('9. with dates through 2030', list.filter(f => f.key !== 'navratri').every(f => f.dates.some(d => d.startsWith('2030-'))));
}

// ================================================================ 10. coins
{
  const coins = async (who) => (await admin.query(`select reason, delta from coins where member_id = $1 and reason = any($2)`, [who.id, ['story_told', 'card_line', 'sawaal', 'shukriya']])).rows;
  const r = await coins(rohan);
  ok('10. Rohan earned for shukriya (1), the weekly question (2) and a story (2)', r.some(x => x.reason === 'shukriya' && x.delta === 1) && ['story_told', 'sawaal'].every(k => r.some(x => x.reason === k && x.delta === 2)), JSON.stringify(r));
  ok('10. THE DAILY CAP: the card he then wrote in would have taken him past it, so it paid nothing', r.reduce((a, x) => a + x.delta, 0) === 5 && 5 + 2 > R.HEARD_COIN_CAP && !r.some(x => x.reason === 'card_line')
    && (await count('select count(*)::int as n from card_entries where member_id = $1', [rohan.id])) >= 1, JSON.stringify(r));
  const m = await coins(meena);
  ok('10. each reason pays once a day at most, however many times it is done', m.filter(x => x.reason === 'card_line').length === 1 && m.filter(x => x.reason === 'shukriya').length <= 1, JSON.stringify(m));
  const k = await coins(kabir);
  ok('10. Kabir earned for saying shukriya (1) and the weekly question (2)', k.some(x => x.reason === 'shukriya' && x.delta === 1) && k.some(x => x.reason === 'sawaal' && x.delta === 2), JSON.stringify(k));
  ok('10. no coins for how anyone feels, or for a private word', (await count(`select count(*)::int as n from coins where reason in ('pulse', 'mood', 'baat', 'checkin')`)) === 0);
  const c = await call(api.settings, { method: 'GET', token: rohan.token, query: { area: 'coins', circle: 'SHARMA', member: rohan.id } });
  ok('10. the coins screen lists the new ways to earn, in words', c.status === 200 && c.earn.shukriya.label === 'Said shukriya' && c.earn.sawaal.n === 2);
}

// ================================================================ 11. pasand for someone not on the app
{
  let r = await G(rohan, 'like_add', { kind: 'music', text: 'Old Lata songs', forId: dadi.id });
  ok('11. Rohan notes what Dadi likes', r.status === 201 && r.by === 'noted by Rohan', JSON.stringify(r));
  const noteId = r.id;
  let s = await GG(meena);
  const d = s.people.find(p => p.memberId === dadi.id);
  ok('11. the family sees it, labelled with who wrote it', d && d.likes.length === 1 && d.likes[0].text === 'Old Lata songs' && d.likes[0].by === 'noted by Rohan' && d.canNote === true, JSON.stringify(d));
  ok('11. nobody notes likes for someone who is on the app', (await G(rohan, 'like_add', { kind: 'music', text: 'Ghazals', forId: papa.id })).status === 400);
  ok('11. nor for someone who is remembered', (await G(rohan, 'like_add', { kind: 'music', text: 'Bhajans', forId: dadaji.id })).status === 400);
  ok('11. someone else cannot take Rohan\'s note off', (await G(meena, 'like_remove', { id: noteId })).status === 404);
  await G(meena, 'like_add', { kind: 'food', text: 'Besan laddu', forId: dadi.id });
  // Dadi joins: the same row of the family tree now signs in.
  const du = await user('Dadi');
  await admin.query('update members set user_id = $1 where id = $2', [du.userId, dadi.id]);
  const dadiOn = { id: dadi.id, name: 'Dadi', token: du.token, code: 'SHARMA' };
  s = await GG(dadiOn);
  ok('11. when Dadi joins she sees what the family noted, labelled', s.me.likes.length === 2 && s.me.likes.every(l => /^noted by /.test(l.by)));
  r = await G(dadiOn, 'like_add', { kind: 'music', text: 'Mohammed Rafi' });
  s = await GG(dadiOn);
  ok('11. HER OWN ENTRY REPLACES THE FAMILY\'S NOTES', r.status === 201 && s.me.likes.length === 1 && s.me.likes[0].text === 'Mohammed Rafi' && s.me.likes[0].by === null, JSON.stringify(s.me.likes));
  ok('11. and that is what the family now reads', (await GG(meena)).people.find(p => p.memberId === dadi.id).likes.map(l => l.text).join() === 'Mohammed Rafi');
  // 3. The shukriya kept for her is waiting.
  const mineNow = (await HG(dadiOn, { view: 'shukriya' })).list;
  ok('3. THE SHUKRIYA KEPT FOR DADI IS THERE THE DAY SHE JOINS', mineNow.some(x => x.forMe && /lori/.test(x.line) && x.fromName === 'Rohan'), JSON.stringify(mineNow));
}

// ================================================================ nobody else reads a private word
{
  const tables = (await admin.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'text' and table_name in ('events', 'messages')`)).rows.length;
  const leaked = await count(`select (select count(*) from events where text ilike '%bura laga%' or text ilike '%Maaf karna%' or text ilike '%baat karni%')::int
                                   + (select count(*) from messages where text ilike '%bura laga%' or text ilike '%Maaf karna%')::int as n`);
  ok('2. no private word, and no "Maaf karna", is in the feed or in any chat', tables === 2 && leaked === 0);
}

await admin.end();
for (const pl of globalThis.__parwahPools || []) await pl.end();
if (fails.length) { console.error(`heard.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`heard.dbtest: ${pass}/${pass} checks pass`);
