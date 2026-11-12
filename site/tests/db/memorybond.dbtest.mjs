// FAMILY MEMORY, THE BONDING HALF, AGAINST A REAL DATABASE: the real handler
// behind /api/book?area=bond, the real schema and SQL.
//
// What it proves: a storyteller is asked only after saying yes on their own
// screen; each gets one question a week however many phones poll; a skipped
// question rests for 8 weeks; the storyteller decides who hears each answer;
// Yaadein comes at most once a day and obeys every hide rule and the
// "remembered" flag; recipes are the family's, changed only by whoever added
// them, and are for food; the nudge is opt-in, weekly, once, and private;
// a group gets its throwback question; outsiders get 403 and no session 401.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('memorybond.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('memorybond.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: book } = await import('../../../api/book.mjs');
const { default: plans } = await import('../../../api/plans.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { ensureTaskSchema } = await import('../../../api/_tasks.mjs');
const { bondToday, storySweep, ensureBondSchema, weekOf, dayOf, BOND } = await import('../../../api/_memorybond.mjs');
const { STORY_SEED, THROWBACK_SEED } = await import('../../../api/_bondseed.mjs');
await ensureSchema(db());
await ensureTaskSchema(db());
await ensureBondSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

let n = 0;
async function user(name) {
  const phone = '+9198500' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}
async function seat(circleId, code, u) {
  const m = (await admin.query(`insert into members (circle_id, name, user_id, phone) values ($1,$2,$3,$4) returning id`, [circleId, u.name, u.userId, u.phone])).rows[0];
  return { id: m.id, name: u.name, token: u.token, code };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id, code, name, kind`)).rows[0];
const grp = (await admin.query(`insert into circles (code, name, kind) values ('COUSIN','Cousins','group') returning id, code, name, kind`)).rows[0];
const U = { rohan: await user('Rohan'), papa: await user('Papa'), meera: await user('Meera'), vikram: await user('Vikram'), priya: await user('Priya') };
const rohan = await seat(fam.id, 'SHARMA', U.rohan), papa = await seat(fam.id, 'SHARMA', U.papa), meera = await seat(fam.id, 'SHARMA', U.meera);
const dadi = { id: (await admin.query(`insert into members (circle_id, name) values ($1, 'Dadi') returning id`, [fam.id])).rows[0].id };
const rohanG = await seat(grp.id, 'COUSIN', U.rohan), vikramG = await seat(grp.id, 'COUSIN', U.vikram), priyaG = await seat(grp.id, 'COUSIN', U.priya);

async function call(who, { method = 'POST', body = {}, query = {}, token } = {}) {
  const req = { method, headers: { 'x-parwah-token': token === undefined ? who.token : token, 'x-parwah-tz': 'Asia/Kolkata' },
                query: { area: 'bond', circle: who.code, member: who.id, ...query },
                body: { area: 'bond', code: who.code, memberId: who.id, ...body } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await book(req, res);
  return { ...json, status };
}
const today = (who) => call(who, { method: 'GET', query: { view: 'today' } });
const memory = (who) => call(who, { method: 'GET', query: { view: 'memory' } });
const q1 = async (s, p) => (await admin.query(s, p)).rows[0];
const WEEK = 7 * 86400000;
const NOW = Date.now();
const sqlc = db();

// ---- no session, outsiders
{
  ok('no session: 401', (await call(rohan, { method: 'GET', query: { view: 'today' }, token: '' })).status === 401);
  ok('someone from another group, with this family\'s code: 403',
     (await call({ ...vikramG, code: 'SHARMA' }, { method: 'GET', query: { view: 'memory' } })).status === 403);
  ok('a relative not on the app is never the caller: 403', (await call({ id: dadi.id, code: 'SHARMA', token: U.rohan.token }, { method: 'GET' })).status === 403);
}

// ---- seed questions are warm, grade-6, about half Hinglish
{
  ok('about 52 story questions, about half in Hinglish', STORY_SEED.length >= 50 && STORY_SEED.filter(q => /\b(aap|kya|kaise|kab|kaun|kaunsa|kaunsi|mein|tha|thi|the)\b/i.test(q)).length >= 22);
  ok('the group gets throwback questions', THROWBACK_SEED.length >= 15 && THROWBACK_SEED.includes('Who was the strictest teacher in 10th?'));
  ok('never morbid', ![...STORY_SEED, ...THROWBACK_SEED].some(q => /too late|death|\bdie\b|dying|funeral|last wish/i.test(q)));
}

// ---- storyteller consent
let s1;
{
  let r = await call(rohan, { body: { action: 'teller_invite', targetId: dadi.id } });
  ok('Dadi is not on the app, so she cannot be asked to say yes', r.status === 400, r.error);
  r = await call(vikramG, { body: { action: 'teller_invite', targetId: papa.id } });
  ok('someone in another group cannot pick Papa', r.status === 403);
  r = await call(rohan, { body: { action: 'teller_invite', targetId: papa.id } });
  ok('Rohan asks Papa to be a storyteller', r.status === 200 && r.status === 200 && r.ok);
  let t = await today(papa);
  ok('Papa sees the ask on his own Today, by name, and no question yet', t.teller && t.teller.status === 'asked' && t.teller.askedBy === 'Rohan' && !t.ask);
  ok('nothing is asked before he says yes', (await q1(`select count(*)::int as n from stories`)).n === 0);
  r = await call(papa, { body: { action: 'teller_answer', yes: true } });
  ok('Papa says yes on his own screen', r.status === 200 && r.status === 200);
  t = await today(papa);
  ok('this week\'s question is waiting for him: the first in the list', t.ask && t.ask.question === STORY_SEED[0], JSON.stringify(t.ask));
  s1 = t.ask.id;
  ok('Rohan never sees Papa\'s question on his Today', !(await today(rohan)).ask);
}

// ---- weekly ask once, however many phones poll
{
  await Promise.all([today(papa), today(rohan), today(meera), storySweep(sqlc, fam.id), storySweep(sqlc, fam.id)]);
  ok('one question a week, however many phones poll at once', (await q1(`select count(*)::int as n from stories where about_member = $1`, [papa.id])).n === 1);
  const again = await storySweep(sqlc, fam.id, NOW + 3600000);
  ok('later the same week, nothing new is asked', again === 0 || weekOf(dayOf(NOW + 3600000)) !== weekOf(dayOf(NOW)));
}

// ---- answer by typing: the family hears it
{
  let r = await call(rohan, { body: { action: 'story_answer', id: s1, text: 'Not mine to answer' } });
  ok('only the storyteller answers', r.status === 403);
  r = await call(papa, { body: { action: 'story_answer', id: s1, text: '  ' } });
  ok('an empty answer is asked for again', r.status === 400);
  r = await call(papa, { body: { action: 'story_answer', id: s1, text: 'At Chandni Chowk, 1971. She laughed at my cycle.' } });
  ok('Papa answers by typing', r.status === 200);
  const m = await memory(meera);
  const st = m.stories.find(s => s.id === s1);
  ok('Meera sees it under Stories, with Papa\'s name', st && st.about_name === 'Papa' && /Chandni Chowk/.test(st.answer_text));
  ok('the family feed says a question was answered, not what was said', (await q1(`select count(*)::int as n from events where text = 'Papa answered this week''s question 📖'`)).n === 1);
  ok('the question is off Papa\'s Today once answered', !(await today(papa)).ask);
  ok('the group never sees the family\'s stories', (await memory(rohanG)).stories.length === 0);
}

// ---- next week, skip, the 8-week rest
let s2text;
{
  await storySweep(sqlc, fam.id, NOW + WEEK);
  const w1 = await q1(`select id, question from stories where about_member = $1 and ask_week = $2::date`, [papa.id, weekOf(dayOf(NOW + WEEK))]);
  ok('next week brings a new question, never the answered one', w1 && w1.question === STORY_SEED[1], w1 && w1.question);
  s2text = w1.question;
  ok('a skip from someone else is refused', (await call(meera, { body: { action: 'story_skip', id: w1.id } })).status === 403);
  ok('Papa skips it', (await call(papa, { body: { action: 'story_skip', id: w1.id } })).status === 200);
  await storySweep(sqlc, fam.id, NOW + 2 * WEEK);
  const w2 = await q1(`select question from stories where about_member = $1 and ask_week = $2::date`, [papa.id, weekOf(dayOf(NOW + 2 * WEEK))]);
  ok('the week after brings another, not the skipped one', w2 && w2.question !== s2text);
  await storySweep(sqlc, fam.id, NOW + 6 * WEEK);
  const w6 = await q1(`select question from stories where about_member = $1 and ask_week = $2::date`, [papa.id, weekOf(dayOf(NOW + 6 * WEEK))]);
  ok('six weeks on, the skipped question is still resting', w6 && w6.question !== s2text);
  await storySweep(sqlc, fam.id, NOW + 10 * WEEK);
  const w10 = await q1(`select question from stories where about_member = $1 and ask_week = $2::date`, [papa.id, weekOf(dayOf(NOW + 10 * WEEK))]);
  ok('after 8 weeks it may be asked again', w10 && w10.question === s2text, w10 && w10.question);
  // a suggested question for Papa comes first
  let r = await call(meera, { body: { action: 'question_suggest', text: 'What should we do before it is too late?', forId: papa.id } });
  ok('a morbid suggestion is turned away kindly', r.status === 400 && /happy question/.test(r.error));
  r = await call(meera, { body: { action: 'question_suggest', text: 'Which was your first scooter?', forId: papa.id } });
  ok('Meera suggests a question for Papa', r.status === 201 && r.kind === 'story');
  await storySweep(sqlc, fam.id, NOW + 11 * WEEK);
  const w11 = await q1(`select question from stories where about_member = $1 and ask_week = $2::date`, [papa.id, weekOf(dayOf(NOW + 11 * WEEK))]);
  ok('the family\'s own question is asked next', w11 && w11.question === 'Which was your first scooter?');
  await admin.query(`delete from stories where about_member = $1 and ask_week > $2::date`, [papa.id, weekOf(dayOf(NOW))]);
}

// ---- who can see each story: the storyteller decides
{
  let r = await call(rohan, { body: { action: 'story_visibility', id: s1, visibility: 'private' } });
  ok('Rohan cannot change who hears Papa\'s story', r.status === 403);
  r = await call(papa, { body: { action: 'story_visibility', id: s1, visibility: 'private' } });
  ok('Papa keeps it to himself', r.status === 200);
  ok('Meera and Rohan no longer see it, Papa still does',
     !(await memory(meera)).stories.some(s => s.id === s1) && !(await memory(rohan)).stories.some(s => s.id === s1) && (await memory(papa)).stories.some(s => s.id === s1));
  r = await call(papa, { body: { action: 'story_visibility', id: s1, visibility: 'some', shareWith: [meera.id] } });
  ok('Papa shares it with Meera only', r.status === 200);
  ok('Meera sees it, Rohan does not', (await memory(meera)).stories.some(s => s.id === s1) && !(await memory(rohan)).stories.some(s => s.id === s1));
  ok('Meera does not learn who else it is shared with', (await memory(meera)).stories.find(s => s.id === s1).share_with.length === 0);
  ok('"some" with nobody picked is refused', (await call(papa, { body: { action: 'story_visibility', id: s1, visibility: 'some', shareWith: [] } })).status === 400);
  await call(papa, { body: { action: 'story_visibility', id: s1, visibility: 'circle' } });
}

// ---- a voice answer: type allow-list and byte cap
{
  await admin.query(`update stories set ask_week = ask_week - 7 where id = $1`, [s1]);
  await storySweep(sqlc, fam.id);
  const w = (await today(papa)).ask;
  ok('a new question arrives for the voice answer', !!w);
  const small = Buffer.alloc(3000, 7).toString('base64');
  let r = await call(papa, { body: { action: 'story_answer', id: w.id, audio: small, mime: 'audio/x-wav', secs: 4 } });
  ok('a recording type off the list is refused', r.status === 400 && /type/.test(r.error));
  r = await call(papa, { body: { action: 'story_answer', id: w.id, audio: Buffer.alloc(BOND.audioMaxBytes + 1000, 1).toString('base64'), mime: 'audio/webm', secs: 170 } });
  ok('a recording over the byte cap is refused', r.status === 400 && /3 minutes/.test(r.error));
  r = await call(papa, { body: { action: 'story_answer', id: w.id, audio: 'abc"onerror=x', mime: 'audio/webm' } });
  ok('a recording that is not base64 is refused', r.status === 400);
  r = await call(papa, { body: { action: 'story_answer', id: w.id, audio: small, mime: 'audio/webm;codecs=opus', secs: 999 } });
  ok('a short voice answer is kept', r.status === 200);
  const st = (await memory(meera)).stories.find(s => s.id === w.id);
  ok('the family sees it has a voice note, capped at 3 minutes', st && st.has_audio && st.audio_secs === 180 && st.audio === undefined);
  const a = await call(meera, { method: 'GET', query: { view: 'audio', id: w.id } });
  ok('the voice is fetched only when someone taps play', /^data:audio\/webm;base64,/.test(a.audio));
  await call(papa, { body: { action: 'story_visibility', id: w.id, visibility: 'private' } });
  ok('a private voice note is never sent to anyone else', (await call(meera, { method: 'GET', query: { view: 'audio', id: w.id } })).status === 403);
  ok('nor to another group', (await call(rohanG, { method: 'GET', query: { view: 'audio', id: w.id } })).status === 403);
}

// ---- Yaadein: once a day, and every hide rule
{
  await plans({ method: 'GET', headers: { 'x-parwah-token': rohan.token }, query: { circle: 'SHARMA', member: rohan.id }, body: {} },
              { status() { return this; }, json() { return this; }, setHeader() {} });
  // A story Papa told two years ago today, a family trip three years ago today,
  // and a photo Rohan shared in the family chat a year ago today.
  const old = (await q1(`insert into stories (circle_id, about_member, question, answer_text, ask_week, asked_at, answered_at)
                          values ($1, $2, 'What was your school like?', 'A tin roof and a big neem tree.', current_date - 730, now() - interval '2 years', now() - interval '2 years') returning id`, [fam.id, papa.id])).id;
  const trip = (await q1(`insert into plans (circle_id, by_member, title, kind, at) values ($1, $2, 'Shimla trip', 'meet', now() - interval '3 years') returning id`, [fam.id, meera.id])).id;
  const chatId = (await q1(`insert into chats (circle_id, kind, name) values ($1, 'circle', 'Everyone') returning id`, [fam.id])).id;
  const photo = (await q1(`insert into messages (chat_id, member_id, text, kind, created_at) values ($1, $2, 'data:image/png;base64,iVBORw0KGgo=', 'image', now() - interval '1 year') returning id`, [chatId, rohan.id])).id;
  // Everyone has looked at Today already, and found nothing: a new day.
  await admin.query(`delete from yaad_days`);

  let t = await today(rohan);
  ok('Rohan\'s Today brings back the newest: last year\'s photo', t.yaad && t.yaad.key === 'photo:' + photo && t.yaad.years === 1, JSON.stringify(t.yaad));
  const p = await call(rohan, { method: 'GET', query: { view: 'yaadphoto', key: t.yaad.key } });
  ok('the photo comes only for today\'s card', /^data:image\/png/.test(p.photo) && (await call(meera, { method: 'GET', query: { view: 'yaadphoto', key: t.yaad.key } })).status === 403);
  await admin.query(`insert into messages (chat_id, member_id, text, kind, created_at) values ($1, $2, 'data:image/png;base64,iVBORw0KGgo=', 'image', now() - interval '4 years')`, [chatId, meera.id]);
  ok('at most once a day: the same card all day, even when more turns up', (await today(rohan)).yaad.key === 'photo:' + photo);
  ok('one row for today', (await q1(`select count(*)::int as n from yaad_days where member_id = $1`, [rohan.id])).n === 1);
  let r = await call(rohan, { body: { action: 'yaad_hide', key: 'story:' + old } });
  ok('only today\'s card can be acted on', r.status === 403);
  r = await call(rohan, { body: { action: 'yaad_send', key: t.yaad.key } });
  ok('"Send to everyone" posts it to the family chat, with the photo', r.status === 200
     && (await q1(`select count(*)::int as n from messages where chat_id = $1 and text like '🌼 Yaadein: 1 year ago today.%'`, [chatId])).n === 1
     && (await q1(`select count(*)::int as n from messages where chat_id = $1 and kind = 'image' and created_at > now() - interval '1 minute'`, [chatId])).n === 1);
  ok('and the card is done for today', !(await today(rohan)).yaad);
  ok('sending twice is refused', (await call(rohan, { body: { action: 'yaad_send', key: t.yaad.key } })).status === 409);

  // "Not this one": never again
  t = await today(meera);
  ok('Meera gets her own card', !!t.yaad);
  const first = t.yaad.key;
  await call(meera, { body: { action: 'yaad_hide', key: first } });
  ok('"Not this one" takes it away', !(await today(meera)).yaad);
  await admin.query(`delete from yaad_days where member_id = $1`, [meera.id]);    // a new day
  t = await today(meera);
  ok('and it never comes back', !t.yaad || t.yaad.key !== first);

  // hide a person, hide a date range
  await admin.query(`delete from yaad_days`);
  await admin.query(`insert into yaad_hidden (member_id, item_key) select $1, 'photo:' || id from messages where kind = 'image'`, [papa.id]);
  r = await call(papa, { body: { action: 'prefs', hidePeople: [meera.id] } });
  ok('Papa hides Meera from his memories', r.status === 200);
  t = await today(papa);
  ok('so her trip does not come back to him: his own story does', t.yaad && t.yaad.key === 'story:' + old, JSON.stringify(t.yaad));
  await admin.query(`delete from yaad_days`);
  const y2 = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
  await call(papa, { body: { action: 'prefs', hidePeople: [], hideRanges: [{ from: addD(y2, -3), to: addD(y2, 3) }] } });
  t = await today(papa);
  ok('a hidden date range is skipped: the trip comes instead', t.yaad && t.yaad.key === 'plan:' + trip, JSON.stringify(t.yaad));
  await admin.query(`delete from yaad_days`);
  await call(papa, { body: { action: 'prefs', hideRanges: [] } });

  // remembered: nothing automatic about them, ever
  ok('nobody can mark themselves remembered', (await call(rohan, { body: { action: 'remembered', targetId: rohan.id, on: true } })).status === 400);
  ok('another group cannot touch Papa', (await call(vikramG, { body: { action: 'remembered', targetId: papa.id, on: true } })).status === 403);
  // Adults only, as for days of remembrance: a child in the family cannot set it.
  await admin.query(`update members set dob = current_date - interval '12 years' where id = $1`, [rohan.id]);
  ok('a child cannot mark someone remembered', (await call(rohan, { body: { action: 'remembered', targetId: papa.id, on: true } })).status === 403);
  await admin.query(`update members set dob = null where id = $1`, [rohan.id]);
  r = await call(rohan, { body: { action: 'remembered', targetId: papa.id, on: true } });
  ok('the family marks Papa remembered', r.status === 200);
  t = await today(meera);
  ok('his story never comes back by itself', !t.yaad || t.yaad.key !== 'story:' + old);
  ok('and he is asked no more questions', (await q1(`select status from story_tellers where member_id = $1`, [papa.id])).status === 'no');
  await call(rohan, { body: { action: 'remembered', targetId: papa.id, on: false } });
  function addD(d, k) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); }
}

// ---- recipes: the family's, changed only by whoever added them, for food
let rec;
{
  let r = await call(meera, { body: { action: 'recipe_add', title: '', steps: 'x' } });
  ok('a recipe needs a name', r.status === 400);
  r = await call(meera, { body: { action: 'recipe_add', title: 'Haldi doodh nuskha', steps: 'For a cold' } });
  ok('a home cure is turned away: recipes are for food', r.status === 400 && /for food only/.test(r.error));
  r = await call(meera, { body: { action: 'recipe_add', title: 'Rajma chawal', fromWhom: 'Mummy', memory: 'Mummy made this every Sunday',
    ingredients: 'Rajma, onion, tomato', steps: 'Soak overnight. Cook slow.', photo: 'data:image/svg+xml;base64,PHN2Zz4=' } });
  ok('an SVG photo is refused', r.status === 400);
  r = await call(meera, { body: { action: 'recipe_add', title: 'Rajma chawal', fromWhom: 'Mummy', memory: 'Mummy made this every Sunday',
    ingredients: 'Rajma, onion, tomato', steps: 'Soak overnight. Cook slow.', photo: 'data:image/jpeg;base64,' + 'A'.repeat(BOND.photoMaxChars) } });
  ok('a photo over the cap is refused', r.status === 400);
  r = await call(meera, { body: { action: 'recipe_add', title: 'Rajma chawal', fromWhom: 'Mummy', memory: 'Mummy made this every Sunday',
    ingredients: 'Rajma, onion, tomato', steps: 'Soak overnight. Cook slow.', photo: 'data:image/jpeg;base64,/9j/4AAQ', audio: Buffer.alloc(800, 3).toString('base64'), mime: 'audio/ogg', secs: 20 } });
  ok('Meera adds Mummy\'s rajma, with a photo and a voice note', r.status === 201);
  rec = r.id;
  const list = (await memory(rohan)).recipes;
  ok('Rohan sees it in the family recipes, light (no photo or voice in the list)', list.length === 1 && list[0].has_photo && list[0].has_audio && list[0].photo === undefined && list[0].audio === undefined);
  const one = await call(rohan, { method: 'GET', query: { view: 'recipe', id: rec } });
  ok('opening it brings the photo and the voice', /^data:image\/jpeg/.test(one.recipe.photo) && /^data:audio\/ogg/.test(one.recipe.audio) && one.recipe.circle_id === undefined);
  ok('Rohan cannot change Meera\'s recipe', (await call(rohan, { body: { action: 'recipe_edit', id: rec, title: 'Mine now', steps: 'x' } })).status === 403);
  ok('nor remove it', (await call(rohan, { body: { action: 'recipe_remove', id: rec } })).status === 403);
  ok('another group cannot read it', (await call(rohanG, { method: 'GET', query: { view: 'recipe', id: rec } })).status === 403);
  ok('nor change it', (await call(vikramG, { body: { action: 'recipe_edit', id: rec, title: 'x', steps: 'y' } })).status === 403);
  r = await call(meera, { body: { action: 'recipe_edit', id: rec, title: 'Rajma chawal', fromWhom: 'Mummy', memory: 'Every Sunday, without fail', ingredients: 'Rajma, onion, tomato, ghee', steps: 'Soak overnight. Cook slow.', dropAudio: true } });
  ok('Meera edits it and drops the voice note', r.status === 200 && !(await memory(rohan)).recipes[0].has_audio && /ghee/.test((await memory(rohan)).recipes[0].ingredients));
  r = await call(rohanG, { body: { action: 'recipe_add', title: 'Hostel Maggi', fromWhom: 'Vikram', steps: 'Kettle. Two packets. Patience.' } });
  ok('the group cookbook works the same', r.status === 201 && (await memory(vikramG)).recipes.length === 1 && (await memory(rohan)).recipes.length === 1);
  ok('Meera removes her recipe', (await call(meera, { body: { action: 'recipe_remove', id: rec } })).status === 200 && (await memory(rohan)).recipes.length === 0);
}

// ---- reach-out nudges: opt-in, weekly, once, private
{
  await admin.query(`update members set created_at = now() - interval '60 days'`);
  ok('off until you turn it on', !(await today(rohan)).nudge);
  ok('a bad week count falls back to 3', (await call(rohan, { body: { action: 'prefs', nudgesOn: true, nudgeWeeks: 9 } })).status === 200
     && (await q1(`select nudge_weeks from bond_prefs where member_id = $1`, [rohan.id])).nudge_weeks === 3);
  // Rohan is on the call rota for Papa, so Papa comes first.
  await admin.query(`insert into requests (circle_id, by_member, title, status, template, template_data, about_member, claimed_by)
                     values ($1, $2, 'Call Papa', 'claimed', 'callrota', $3::jsonb, $4, $2)`, [fam.id, rohan.id, JSON.stringify({ rota: [rohan.id, meera.id] }), papa.id]);
  const t = await today(rohan);
  ok('Rohan gets one nudge: the person on his call rota', t.nudge && t.nudge.targetId === papa.id && t.nudge.name === 'Papa', JSON.stringify(t.nudge));
  ok('it never carries a score or a feeling', !/score|lonely|alone|sad|miss/i.test(JSON.stringify(t.nudge)));
  ok('only Rohan sees it: Meera has it off, Papa sees nothing', !(await today(meera)).nudge && !(await today(papa)).nudge);
  await Promise.all([today(rohan), today(rohan), today(rohan)]);
  ok('once a week, however often he looks', (await q1(`select count(*)::int as n from bond_nudges where member_id = $1`, [rohan.id])).n === 1);
  ok('Later takes it away', (await call(rohan, { body: { action: 'nudge_act', act: 'later' } })).status === 200 && !(await today(rohan)).nudge);
  ok('and nothing else comes this week', (await call(rohan, { body: { action: 'nudge_act', act: 'later' } })).status === 404);
  const next = await bondToday(sqlc, fam, { id: rohan.id }, NOW + WEEK);
  ok('next week, one more', next.nudge && next.nudge.targetId === papa.id);
  // A message to Papa this week: he is not "a while" any more.
  const dm = (await q1(`insert into chats (circle_id, kind) values ($1, 'dm') returning id`, [fam.id])).id;
  await admin.query(`insert into chat_members (chat_id, member_id) values ($1, $2), ($1, $3)`, [dm, rohan.id, papa.id]);
  await admin.query(`insert into messages (chat_id, member_id, text) values ($1, $2, 'Namaste Papa')`, [dm, papa.id]);
  const wk2 = await bondToday(sqlc, fam, { id: rohan.id }, NOW + 2 * WEEK);
  ok('after a 1:1 message, the nudge moves to someone else', wk2.nudge && wk2.nudge.targetId !== papa.id, JSON.stringify(wk2.nudge));
  const before = wk2.nudge.targetId;
  // "Don't nudge me about X", on this week's card.
  await admin.query(`delete from bond_nudges where member_id = $1`, [rohan.id]);
  await admin.query(`insert into bond_nudges (member_id, week, target_id) values ($1, $2::date, $3)`, [rohan.id, weekOf(dayOf(NOW)), before]);
  ok('"Don\'t nudge me about" adds that person to the skip list', (await call(rohan, { body: { action: 'nudge_act', act: 'never' } })).status === 200
     && (await q1(`select nudge_skip from bond_prefs where member_id = $1`, [rohan.id])).nudge_skip.includes(before));
  await call(rohan, { body: { action: 'prefs', nudgesOn: false } });
  ok('the global off switch: nothing next week', !(await bondToday(sqlc, fam, { id: rohan.id }, NOW + 3 * WEEK)).nudge);
  // A group: the member you have not talked to 1:1 in a while.
  await call(rohanG, { body: { action: 'prefs', nudgesOn: true, nudgeWeeks: 2 } });
  const gdm = (await q1(`insert into chats (circle_id, kind) values ($1, 'dm') returning id`, [grp.id])).id;
  await admin.query(`insert into chat_members (chat_id, member_id) values ($1, $2), ($1, $3)`, [gdm, rohanG.id, vikramG.id]);
  await admin.query(`insert into messages (chat_id, member_id, text) values ($1, $2, 'Match tonight?')`, [gdm, vikramG.id]);
  const g = await today(rohanG);
  ok('in a group, the friend you have not talked to 1:1 in a while', g.nudge && g.nudge.targetId === priyaG.id, JSON.stringify(g.nudge));
  ok('nudge_act with a made-up choice is refused', (await call(rohanG, { body: { action: 'nudge_act', act: 'score' } })).status === 400);
}

// ---- a group's throwback question
{
  const t = await today(priyaG);
  ok('the group has one throwback question this week, for everyone', t.throwback && THROWBACK_SEED.includes(t.throwback.question) && t.throwback.answers.length === 0);
  ok('a family has none', !(await today(rohan)).throwback);
  ok('a family cannot answer one', (await call(rohan, { body: { action: 'throwback_answer', text: 'x' } })).status === 400);
  await call(rohanG, { body: { action: 'throwback_answer', text: 'Sharma sir, without a doubt' } });
  await call(vikramG, { body: { action: 'throwback_answer', text: 'Mrs Iyer' } });
  await call(vikramG, { body: { action: 'throwback_answer', text: 'Mrs Iyer. Definitely.' } });
  const t2 = await today(priyaG);
  ok('answers show side by side, one per person, the latest kept', t2.throwback.answers.length === 2 && t2.throwback.answers.some(a => a.text === 'Mrs Iyer. Definitely.'));
  ok('the same question for everyone in the group', (await today(vikramG)).throwback.question === t.throwback.question);
  const s = await call(priyaG, { body: { action: 'question_suggest', text: 'Who cried at the farewell?' } });
  ok('a group suggestion becomes a throwback question', s.status === 201 && s.kind === 'throwback');
}

ok('an unknown action is refused', (await call(rohan, { body: { action: 'nope' } })).status === 400);
console.log(`\nmemorybond.dbtest: ${pass} passed, ${fails.length} failed`);
if (fails.length) console.log('FAILED:\n  ' + fails.join('\n  '));
await admin.end();
process.exit(fails.length ? 1 : 0);
