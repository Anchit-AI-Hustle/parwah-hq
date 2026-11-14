// CLOSER TOGETHER, against a real database: date polls and who brings what,
// the shared card and its secret, anniversaries, festivals, and "I'm in town".
//
// What it proves, per feature: the happy path; an outsider gets 403 and no
// session gets 401; and every time-based alert is made once however many
// phones poll. The card's secret is checked at the server: the person it is
// for cannot read it, its entries or its voice notes before their day.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('plansbond.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('plansbond.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: plans } = await import('../../../api/plans.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const B = await import('../../../api/_bond.mjs');
const T = await import('../../../api/_tyohaar.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

let n = 0;
async function person(circleId, name, code, extra = {}) {
  const p = '+9198711' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [p, p.slice(3), name])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, user_id, place, country) values ($1,$2,$3,$4,'IN') returning id`, [circleId, name, u.id, extra.place || 'Delhi'])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, name, token, code };
}
async function call(who, method, query, body) {
  const req = { method, headers: who && who.token ? { 'x-parwah-token': who.token, 'x-parwah-tz': 'Asia/Kolkata' } : {}, query: query || {}, body: body || undefined };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await plans(req, res);
  return { ...(json || {}), status };
}
const state = (who, extra) => call(who, 'GET', { area: 'bond', circle: who.code, member: who.id, ...(extra || {}) });
const act = (who, action, body) => call(who, 'POST', {}, { code: who.code, memberId: who.id, action, ...(body || {}) });
const dayPlus = (k) => { const d = new Date(Date.now() + 5.5 * 3600000 + k * 86400000); return d.toISOString().slice(0, 10); };
const TODAY = dayPlus(0);

const fam = (await admin.query(`insert into circles (code, name) values ('KAPOOR','Kapoor Family') returning id`)).rows[0].id;
const rohan = await person(fam, 'Rohan', 'KAPOOR');
const chachu = await person(fam, 'Chachu', 'KAPOOR');
const maa = await person(fam, 'Maa', 'KAPOOR');
const papa = await person(fam, 'Papa', 'KAPOOR');
const grp = (await admin.query(`insert into circles (code, name, kind) values ('FRIENDS','College friends','group') returning id`)).rows[0].id;
const asha = await person(grp, 'Asha', 'FRIENDS', { place: 'Mumbai' });
const vik = await person(grp, 'Vikram', 'FRIENDS', { place: 'Pune' });
const other = (await admin.query(`insert into circles (code, name) values ('OTHERS','Other Family') returning id`)).rows[0].id;
const outsider = await person(other, 'Stranger', 'OTHERS');
const intruder = { ...outsider, code: 'KAPOOR' };
const anon = { id: rohan.id, code: 'KAPOOR', token: null };
// The plans table is made by the plans route.
await call(rohan, 'GET', { circle: 'KAPOOR', member: rohan.id });

// ---------------------------------------------------------------- authz
ok('no session is 401', (await state(anon)).status === 401);
ok('an outsider is 403 on the state', (await state(intruder)).status === 403);
ok('an outsider is 403 on an action', (await act(intruder, 'bond_poll_create', { title: 'x', options: [dayPlus(2), dayPlus(3)] })).status === 403);
ok('an unknown bond action is refused', (await act(rohan, 'bond_nope')).status === 400);

// ---------------------------------------------------------------- 1. date poll
{
  const at = (k, h) => new Date(Date.now() + k * 86400000 + h * 3600000).toISOString();
  ok('one date is not a poll', (await act(rohan, 'bond_poll_create', { title: 'Sunday lunch', options: [at(3, 0)] })).status === 400);
  ok('six dates are too many', (await act(rohan, 'bond_poll_create', { title: 'Sunday lunch', options: [1, 2, 3, 4, 5, 6].map(k => at(k, 0)) })).status === 400);
  ok('a date in the past is refused', (await act(rohan, 'bond_poll_create', { title: 'Sunday lunch', options: [at(-2, 0), at(3, 0)] })).status === 400);
  const p = await act(rohan, 'bond_poll_create', { title: 'Sunday lunch', kind: 'meet', options: [at(3, 0), at(4, 0), at(5, 0)], items: ['Sweets', 'Plates', 'A speaker'] });
  ok('the host asks the family with three dates', p.status === 201 && p.id, JSON.stringify(p));
  let s = await state(chachu);
  const poll = s.polls.find(x => x.id === p.id);
  ok('everyone sees the poll with its dates in order', poll && poll.options.length === 3 && poll.status === 'open' && new Date(poll.options[0].at) < new Date(poll.options[1].at));
  const [o1, o2] = poll.options;
  ok('Yes / Maybe / No only', (await act(chachu, 'bond_poll_vote', { optionId: o1.id, answer: 'perhaps' })).status === 400);
  await act(chachu, 'bond_poll_vote', { optionId: o1.id, answer: 'yes' });
  await act(maa, 'bond_poll_vote', { optionId: o1.id, answer: 'maybe' });
  await act(maa, 'bond_poll_vote', { optionId: o1.id, answer: 'yes' });     // changed her mind
  await act(papa, 'bond_poll_vote', { optionId: o1.id, answer: 'no' });
  await act(papa, 'bond_poll_vote', { optionId: o2.id, answer: 'yes' });
  ok('an outsider cannot vote', (await act(intruder, 'bond_poll_vote', { optionId: o1.id, answer: 'yes' })).status === 403);
  s = await state(rohan);
  const o1s = s.polls.find(x => x.id === p.id).options[0];
  ok('the host sees the counts, one answer per person', o1s.yes.length === 2 && o1s.maybe.length === 0 && o1s.no.length === 1, JSON.stringify(o1s));
  ok('only the host can lock', (await act(chachu, 'bond_poll_lock', { pollId: p.id, optionId: o1.id })).status === 403);
  const locks = await Promise.all([1, 2, 3].map(() => act(rohan, 'bond_poll_lock', { pollId: p.id, optionId: o1.id })));
  ok('locking twice at once makes one plan', locks.filter(r => r.status === 200).length === 1 && locks.filter(r => r.status === 409).length === 2, locks.map(r => r.status).join());
  const planRows = (await admin.query(`select id, going, at from plans where title = 'Sunday lunch'`)).rows;
  ok('one plan, at the locked date, with the yes votes going', planRows.length === 1 && planRows[0].going.length === 3
     && planRows[0].going.includes(chachu.id) && planRows[0].going.includes(maa.id) && !planRows[0].going.includes(papa.id)
     && new Date(planRows[0].at).toISOString() === new Date(o1.at).toISOString(), JSON.stringify(planRows));
  const told = (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like '%locked the date for Sunday lunch%'`, [fam])).rows[0].n;
  ok('everyone is told once', told === 1, told);
  ok('no more votes once locked', (await act(papa, 'bond_poll_vote', { optionId: o2.id, answer: 'yes' })).status === 409);

  // ---- who brings what
  const planId = planRows[0].id;
  s = await state(maa);
  const items = s.items.filter(i => i.plan_id === planId);
  ok('the poll\'s list came with the plan', items.map(i => i.label).join() === 'Sweets,Plates,A speaker', items.map(i => i.label).join());
  const sweets = items[0];
  const c1 = await act(maa, 'bond_item_claim', { itemId: sweets.id });
  ok('Maa says she brings the sweets', c1.status === 200 && c1.claimed === true);
  ok('nobody else can take what is taken', (await act(chachu, 'bond_item_claim', { itemId: sweets.id })).status === 409);
  s = await state(rohan);
  const sw = s.items.find(i => i.id === sweets.id);
  ok('the plan shows who brings what and what is open', sw.claimed_name === 'Maa' && s.items.filter(i => i.plan_id === planId && !i.claimed_by).length === 2);
  ok('Maa can let it go', (await act(maa, 'bond_item_claim', { itemId: sweets.id })).claimed === false);
  ok('anyone can add to the list', (await act(chachu, 'bond_item_add', { planId, label: 'Ice cream' })).status === 201);
  ok('an outsider cannot add or claim', (await act(intruder, 'bond_item_add', { planId, label: 'x' })).status === 403 && (await act(intruder, 'bond_item_claim', { itemId: sweets.id })).status === 403);
  ok('another family\'s plan is not found', (await act(asha, 'bond_item_add', { planId, label: 'x' })).status === 404);
  const ice = (await state(rohan)).items.find(i => i.label === 'Ice cream');
  ok('only who added it, or the host, takes it off', (await act(maa, 'bond_item_remove', { itemId: ice.id })).status === 403 && (await act(rohan, 'bond_item_remove', { itemId: ice.id })).status === 200);

  // ---- 4. something to do together
  ok('a story on the call', (await act(rohan, 'bond_activity', { planId, activity: 'story', note: 'crow' })).status === 200);
  s = await state(papa);
  ok('everyone sees the chosen activity on the plan', s.plans.find(x => x.id === planId).activity === 'story' && s.plans.find(x => x.id === planId).activity_note === 'crow');
  ok('quiz night is for groups', (await act(rohan, 'bond_activity', { planId, activity: 'quiz' })).status === 400);
  ok('an unknown activity is refused', (await act(rohan, 'bond_activity', { planId, activity: 'karaoke' })).status === 400);
  ok('cooking takes free text', (await act(rohan, 'bond_activity', { planId, activity: 'cook', note: 'Rajma chawal' })).status === 200);
}

// ---------------------------------------------------------------- 2. cards
{
  // Chachu's birthday is 3 days away (on his own Delhi calendar).
  const bd = dayPlus(3);
  await admin.query(`update members set dob = $1 where id = $2`, ['1975' + bd.slice(4), chachu.id]);
  // Papa's is 10 days away: no card yet.
  await admin.query(`update members set dob = $1 where id = $2`, ['1950' + dayPlus(10).slice(4), papa.id]);
  const sql = db();
  const circle = { id: fam, kind: 'family' };
  const made = await Promise.all([1, 2, 3, 4].map(() => B.sweepBond(sql, circle)));
  const cards = (await admin.query(`select * from cards where circle_id = $1 and occasion = 'birthday'`, [fam])).rows;
  ok('3 days before, one card, however many phones poll', cards.length === 1 && made.reduce((a, b) => a + b, 0) === 1, made.join());
  const card = cards[0];
  ok('it is Chachu\'s, not Papa\'s', card.for_member === chachu.id && card.title === "Chachu's birthday");
  ok('no feed line gives the surprise away', (await admin.query(`select count(*)::int as n from events where text ilike '%card%'`)).rows[0].n === 0);
  let rs = await state(rohan);
  ok('everyone else sees "add to the card" on Today', rs.cards.some(c => c.id === card.id && !c.forMe && c.inDays === 3));
  let cs = await state(chachu);
  ok('SECRET: Chachu does not even see that a card exists', !cs.cards.some(c => c.id === card.id));
  ok('SECRET: Chachu cannot open the card before the day', (await state(chachu, { card: card.id })).status === 403);
  ok('SECRET: Chachu cannot add to his own card', (await act(chachu, 'bond_card_add', { cardId: card.id, kind: 'text', text: 'peek' })).status === 403);
  ok('a line', (await act(rohan, 'bond_card_add', { cardId: card.id, kind: 'text', text: 'Happy birthday Chachu! Thank you for the cricket lessons.' })).status === 201);
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  ok('a photo', (await act(maa, 'bond_card_add', { cardId: card.id, kind: 'photo', data: PNG })).status === 201);
  ok('a photo that is not a photo is refused', (await act(maa, 'bond_card_add', { cardId: card.id, kind: 'photo', data: 'data:image/png;base64,x" onerror="alert(1)' })).status === 400);
  ok('a photo over the cap is refused', (await act(maa, 'bond_card_add', { cardId: card.id, kind: 'photo', data: 'data:image/jpeg;base64,' + 'A'.repeat(B.PHOTO_MAX) })).status === 400);
  const voice = Buffer.from('fake-opus-bytes').toString('base64');
  ok('a voice note', (await act(papa, 'bond_card_add', { cardId: card.id, kind: 'voice', mime: 'audio/webm;codecs=opus', data: voice, seconds: 12 })).status === 201);
  ok('a voice note of a type not on the list is refused', (await act(papa, 'bond_card_add', { cardId: card.id, kind: 'voice', mime: 'text/html', data: voice })).status === 400);
  ok('a voice note over the byte cap is refused', (await act(papa, 'bond_card_add', { cardId: card.id, kind: 'voice', mime: 'audio/webm', data: 'A'.repeat(B.VOICE_MAX_B64 + 4) })).status === 400);
  ok('an outsider cannot add or read', (await act(intruder, 'bond_card_add', { cardId: card.id, kind: 'text', text: 'x' })).status === 403 && (await state(intruder, { card: card.id })).status === 403);
  const view = await state(rohan, { card: card.id });
  ok('the family can read the card as it grows', view.status === 200 && view.entries.length === 3 && view.entries.find(e => e.kind === 'photo').data === PNG && !view.entries.find(e => e.kind === 'voice').data);
  const vid = view.entries.find(e => e.kind === 'voice').id;
  ok('the family can play a voice note', (await state(maa, { entry: vid })).data === voice);
  ok('SECRET: Chachu cannot play a voice note on it', (await state(chachu, { entry: vid })).status === 403);
  ok('a card from another family is not found', (await state(asha, { card: card.id })).status === 404);
  ok('no handing over before the day', (await admin.query(`select delivered_at from cards where id = $1`, [card.id])).rows[0].delivered_at === null);

  // ---- the day arrives
  await admin.query(`update cards set date = $1 where id = $2`, [TODAY, card.id]);
  await Promise.all([1, 2, 3].map(() => B.sweepBond(sql, circle)));
  const del = (await admin.query(`select delivered_at from cards where id = $1`, [card.id])).rows[0];
  ok('on the day it is handed over, once', del.delivered_at !== null);
  const again = await B.sweepBond(sql, circle);
  ok('and not again', again === 0, again);
  cs = await state(chachu);
  ok('ON THE DAY: Chachu sees his card', cs.cards.some(c => c.id === card.id && c.forMe));
  const mine = await state(chachu, { card: card.id });
  ok('ON THE DAY: with every entry', mine.status === 200 && mine.entries.length === 3 && mine.entries.map(e => e.name).sort().join() === 'Maa,Papa,Rohan');
  ok('ON THE DAY: and the voice note plays for him', (await state(chachu, { entry: vid })).status === 200);
  ok('only who added an entry can take it off', (await act(maa, 'bond_card_remove', { entryId: vid })).status === 403 && (await act(papa, 'bond_card_remove', { entryId: vid })).status === 200);

  // ---- a card for any occasion, in a group
  ok('a group starts a farewell card for a friend not on the app', (await act(asha, 'bond_card_start', { occasion: 'farewell', forName: 'Meera', date: dayPlus(5) })).status === 201);
  const gs = await state(vik);
  ok('the group sees it', gs.cards.some(c => c.title === "Meera's farewell"));
  ok('a card for a member is a secret to them', (await act(asha, 'bond_card_start', { occasion: 'wedding', forMember: vik.id, date: dayPlus(6) })).status === 201
     && !(await state(vik)).cards.some(c => c.occasion === 'wedding'));
  ok('a card for someone in another group is refused', (await act(asha, 'bond_card_start', { occasion: 'other', forMember: rohan.id, date: dayPlus(6) })).status === 403);
  ok('a card in the past is refused', (await act(asha, 'bond_card_start', { occasion: 'other', forName: 'X', date: dayPlus(-3) })).status === 400);
}

// ---------------------------------------------------------------- 2b. anniversaries
{
  const sql = db(); const circle = { id: fam, kind: 'family' };
  const wed = '1980' + dayPlus(2).slice(4);
  ok('an outsider cannot set an anniversary', (await act(intruder, 'bond_anniv', { personId: maa.id, withId: papa.id, date: wed })).status === 403);
  ok('a partner from another family is refused', (await act(rohan, 'bond_anniv', { personId: maa.id, withId: asha.id, date: wed })).status === 403);
  ok('Rohan sets Maa and Papa\'s anniversary on Maa\'s page', (await act(rohan, 'bond_anniv', { personId: maa.id, withId: papa.id, date: wed })).status === 200);
  const rows = (await admin.query(`select id, anniversary::text as d, anniv_with from members where id in ($1,$2)`, [maa.id, papa.id])).rows;
  ok('both of the couple share the one date', rows.length === 2 && rows.every(r => r.d === wed) && rows.find(r => r.id === maa.id).anniv_with === papa.id && rows.find(r => r.id === papa.id).anniv_with === maa.id);
  const s = await state(chachu);
  ok('both pages can show it', s.anniv.filter(a => a.date === wed).length === 2);
  await Promise.all([1, 2].map(() => B.sweepBond(sql, circle)));
  const ac = (await admin.query(`select * from cards where occasion = 'anniversary'`)).rows;
  ok('one anniversary card for the couple, not two', ac.length === 1 && [ac[0].for_member, ac[0].for_member2].sort().join() === [maa.id, papa.id].sort().join(), ac.length);
  ok('SECRET: sealed to both of them', !(await state(maa)).cards.some(c => c.occasion === 'anniversary') && !(await state(papa)).cards.some(c => c.occasion === 'anniversary')
     && (await state(papa, { card: ac[0].id })).status === 403);
  ok('the rest of the family can add', (await act(chachu, 'bond_card_add', { cardId: ac[0].id, kind: 'text', text: 'Happy anniversary!' })).status === 201);
  ok('editing from Papa\'s page changes the same date', (await act(chachu, 'bond_anniv', { personId: papa.id, withId: maa.id, date: '1981-02-14' })).status === 200
     && (await admin.query(`select count(*)::int as n from members where anniversary = '1981-02-14'`)).rows[0].n === 2);
  ok('a wedding day in the future is refused', (await act(rohan, 'bond_anniv', { personId: maa.id, withId: papa.id, date: dayPlus(30) })).status === 400);
}

// ---------------------------------------------------------------- 3. festivals
{
  ok('the dates are all inside Nov 2026 to Dec 2030', T.FESTIVALS.every(f => f.dates.every(d => d >= '2026-11-01' && d <= '2030-12-31')) && T.FESTIVALS.length === 21);
  const sql = db(); const circle = { id: fam, kind: 'family' };
  // Off until the family picks: nothing is assumed.
  let s = await state(rohan);
  ok('off until the family picks', s.festivals.chosen.length === 0 && s.festivals.due.length === 0 && s.festivals.list.length === 21);
  // A festival 10 days away, made up for the test so the clock does not matter.
  T.FESTIVALS.push({ key: 'testfest', name: 'Test Festival', icon: '🎉', dates: [dayPlus(10)] });
  T.FESTIVALS.push({ key: 'farfest', name: 'Far Festival', icon: '🎉', dates: [dayPlus(30)] });
  await B.sweepBond(sql, circle);
  ok('nothing is announced for a festival nobody picked', (await admin.query(`select count(*)::int as n from festival_kits`)).rows[0].n === 0);
  ok('an outsider cannot choose', (await act(intruder, 'bond_fest_add', { key: 'testfest' })).status === 403);
  // Festivals are added and taken off ONE AT A TIME (Nov 2026): nobody can
  // replace the whole family's list any more.
  ok('the old "replace the whole list" action is gone', (await act(maa, 'bond_fest_set', { keys: ['testfest'] })).status === 400);
  ok('an unknown festival is refused', (await act(maa, 'bond_fest_add', { key: 'not-a-festival' })).status === 400);
  let set = null;
  for (const k of ['testfest', 'farfest', 'diwali']) set = await act(maa, 'bond_fest_add', { key: k });
  ok('the family picks its festivals, one at a time', set.status === 200 && set.chosen.slice().sort().join() === 'diwali,farfest,testfest', JSON.stringify(set));
  const made = await Promise.all([1, 2, 3].map(() => B.sweepBond(sql, circle)));
  const kits = (await admin.query(`select fkey from festival_kits where circle_id = $1`, [fam])).rows.map(r => r.fkey);
  ok('14 days before: one card, once, however many phones poll', kits.filter(k => k === 'testfest').length === 1 && !kits.includes('farfest'), kits.join());
  s = await state(papa);
  const due = s.festivals.due.find(f => f.key === 'testfest');
  ok('Today shows "Plan Test Festival together"', due && due.inDays === 10 && !due.started);
  const kit = await Promise.all([rohan, maa].map(w => act(w, 'bond_fest_kit', { key: 'testfest', date: dayPlus(10), tz: 'Asia/Kolkata' })));
  const madeOne = kit.filter(k => k.status === 201), already = kit.filter(k => k.already);
  ok('two taps at once make one plan', madeOne.length === 1 && already.length === 1, kit.map(k => k.status).join());
  const fp = (await admin.query(`select * from plans where festival = 'testfest'`)).rows;
  ok('the plan has RSVP, a video room for anyone away, and a list', fp.length === 1 && /^https:\/\/meet\.jit\.si\/parwah-[0-9a-f]{32}$/.test(fp[0].room) && fp[0].going.length === 1
     && (await admin.query(`select count(*)::int as n from plan_items where plan_id = $1`, [fp[0].id])).rows[0].n === 4);
  const gc = (await admin.query(`select * from cards where occasion = 'festival'`)).rows;
  ok('and a "Make our greeting" card everyone can add to', gc.length === 1 && gc[0].title === 'Our Test Festival greeting' && gc[0].for_member === null
     && (await act(papa, 'bond_card_add', { cardId: gc[0].id, kind: 'text', text: 'Shubh ho!' })).status === 201);
  s = await state(chachu);
  ok('the card now says it is started, with the plan', s.festivals.due.find(f => f.key === 'testfest').planId === fp[0].id);
  ok('a festival not picked cannot be kitted', (await act(rohan, 'bond_fest_kit', { key: 'holi', date: '2027-03-22' })).status === 400);
  ok('nor one too far away', (await act(rohan, 'bond_fest_kit', { key: 'farfest', date: dayPlus(30) })).status === 400);
  ok('a group can pick too', (await act(asha, 'bond_fest_add', { key: 'christmas' })).chosen.join() === 'christmas');
}

// ---------------------------------------------------------------- 5. I'm in town
{
  ok('a family cannot post "in town" (they have Find my)', (await act(rohan, 'bond_intown', { city: 'Pune', from: dayPlus(1), to: dayPlus(3) })).status === 400);
  ok('dates in the wrong order are refused', (await act(asha, 'bond_intown', { city: 'Pune', from: dayPlus(4), to: dayPlus(2) })).status === 400);
  const r = await act(asha, 'bond_intown', { city: 'Pune', from: dayPlus(1), to: dayPlus(3) });
  ok('Asha says she is in Pune for three days', r.status === 201);
  let s = await state(vik);
  ok('the group sees a card with the city only', s.inTown.length === 1 && s.inTown[0].city === 'Pune' && s.inTown[0].name === 'Asha' && !('lat' in s.inTown[0]));
  ok('a family never sees "in town"', (await state(rohan)).inTown.length === 0);
  ok('an outsider is 403', (await act({ ...outsider, code: 'FRIENDS' }, 'bond_intown', { city: 'X', from: dayPlus(1), to: dayPlus(2) })).status === 403);
  ok('only Asha can take it down', (await act(vik, 'bond_intown_end', { id: r.id })).status === 403);
  // "Let's meet" opens a poll on those dates.
  const at = (k) => new Date(dayPlus(k) + 'T19:00:00+05:30').toISOString();
  ok('"Let\'s meet" is a date poll on her dates', (await act(vik, 'bond_poll_create', { title: 'Meet Asha in Pune', options: [at(1), at(2), at(3)] })).status === 201);
  await admin.query(`update in_town set from_date = current_date - 5, to_date = current_date - 1`);
  s = await state(vik);
  ok('it goes away after the end date', s.inTown.length === 0);
}

for (const p of globalThis.__parwahPools || []) await p.end();
await admin.end();
if (fails.length) { console.error(`plansbond.dbtest: ${fails.length} FAILED of ${pass + fails.length}:\n  ` + fails.join('\n  ')); process.exit(1); }
console.log(`plansbond.dbtest: ${pass}/${pass} checks pass`);
