// "WHAT NEEDS DOING", AGAINST A REAL DATABASE: the real handler behind
// /api/book?area=afterloss, the real register behind area=locator, and a
// real PostgreSQL. What it proves:
//
//   - one adult alone cannot start it when a second adult exists; a child,
//     the person themself and someone from another family cannot at all;
//   - the second adult who was asked is the only one who can confirm;
//   - a viewer's list never has a step for an entry they may not see:
//     "Only me" for nobody but its person and its writer, "People I choose"
//     only for the people named, "Only in an emergency" for the two who
//     started and confirmed it, and only while the list
//     is active: it closes again when the list is closed;
//   - starting, confirming, closing and reopening leave every unlock_policy
//     and every list of chosen people exactly as they were;
//   - ticks made at the same moment all hold; a tick, an assignment and a
//     note on one step never undo each other;
//   - a note refuses a card number, a CVV, an OTP, a PIN and a password;
//   - exactly two pushes: one to the adult asked, one to the family;
//   - opening a closed list again is the start rule again: a second adult
//     is asked, nothing opens while it waits, and the two who open it again
//     are the two the emergency entries open for;
//   - the person the list is about closes it: it is removed, the two who
//     started it are told, and it cannot be opened again;
//   - one adult alone is refused for someone who is on Parwah;
//   - a list in force marks the person as remembered, with no date; removing
//     it takes the mark off only if the list set it;
//   - the ask is sent at most three times an hour from one person about one.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_afterloss_test \
//     node --import ./site/tests/db/register.mjs site/tests/db/afterloss.dbtest.mjs
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('afterloss.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('afterloss.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
for (const k of Object.keys(process.env)) if (/^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|GROQ|MISTRAL|DEEPSEEK|XAI|TWILIO|CRON_SECRET)/.test(k)) delete process.env[k];
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('offline in this test'); };

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

// Every push is counted here instead of leaving the machine.
const webpush = (await import('web-push')).default;
const pushed = [];
webpush.sendNotification = async (sub, body) => { pushed.push({ endpoint: sub.endpoint, body: JSON.parse(body) }); return {}; };

const { default: auth } = await import('../../../api/auth.mjs');
const { default: circle } = await import('../../../api/circle.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { db } = await import('../../../api/_db.mjs');
const { ensurePushSchema } = await import('../../../api/_push.mjs');

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };

let ipn = 0;
async function call(handler, { method = 'POST', body, query, token, headers = {} } = {}) {
  const req = { method, body, query: query || {}, headers: { 'x-forwarded-for': '10.9.' + (++ipn % 250) + '.1', ...headers } };
  if (token) req.headers['x-parwah-token'] = token;
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { status, ...json };
}
const rows = async (text, args) => (await admin.query(text, args)).rows;

async function signUp(phone, name, pin) {
  const r = await call(auth, { body: { action: 'enter', phone, cc: '+91', name, pin } });
  if (!r.token) throw new Error('sign-up failed for ' + name + ': ' + JSON.stringify(r));
  return { userId: r.user.id, token: r.token, name };
}
const U = { papa: await signUp('9861000001', 'Papa', '4829'), rohan: await signUp('9861000002', 'Rohan', '7351'),
            meera: await signUp('9861000003', 'Meera', '6142'), priya: await signUp('9861000004', 'Priya', '9153'),
            kabir: await signUp('9861000005', 'Kabir', '8264') };
let r = await call(circle, { token: U.papa.token, body: { action: 'create', kind: 'family', memberName: 'Papa', circleName: 'Sharma', userId: U.papa.userId, role: 'parent', relation: 'father' } });
const code = r.code; U.papa.id = r.memberId;
await call(circle, { token: U.papa.token, body: { action: 'set_join_policy', code, memberId: U.papa.id, policy: 'open' } });
for (const k of ['rohan', 'meera', 'priya', 'kabir']) {
  const j = await call(circle, { token: U[k].token, body: { action: 'join', code, memberName: U[k].name, userId: U[k].userId, role: 'family', relation: k === 'rohan' || k === 'kabir' ? 'son' : 'daughter' } });
  U[k].id = j.memberId;
}
// Kabir is eleven. Dadi was added by name and is not on Parwah.
await rows(`update members set dob = '2015-06-01' where id = $1`, [U.kabir.id]);
const dadi = (await rows(`insert into members (circle_id, name, role) select circle_id, 'Dadi', 'parent' from members where id = $1 returning id`, [U.papa.id]))[0].id;
const other = await signUp('9861000009', 'Kamla', '5937');
r = await call(circle, { token: other.token, body: { action: 'create', kind: 'family', memberName: 'Kamla', circleName: 'Gupta', userId: other.userId, role: 'family' } });
other.id = r.memberId; other.code = r.code;
const bauji = (await rows(`insert into members (circle_id, name, role) select circle_id, 'Bauji', 'parent' from members where id = $1 returning id`, [other.id]))[0].id;
ok('setup: five on Parwah in the Sharma family and Dadi by name; Kamla alone in the Guptas', U.papa.id && U.rohan.id && U.meera.id && U.priya.id && U.kabir.id && dadi && other.id && bauji);
await ensurePushSchema(db());
const endpoint = (id) => 'https://fcm.googleapis.com/fcm/send/' + id;
for (const id of [U.papa.id, U.rohan.id, U.meera.id, U.priya.id, U.kabir.id, other.id]) {
  await rows(`insert into push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')`, [id, endpoint(id)]);
}
const whoGot = (from) => pushed.slice(from).map(p => Object.keys(U).find(k => endpoint(U[k].id) === p.endpoint) || 'other').sort().join();

const add = (u, body) => call(book, { token: u.token, body: { code, memberId: u.id, action: 'locator_add', ...body } });
const act = (u, action, body, c = code) => call(book, { token: u.token, body: { code: c, memberId: u.id, action, ...body } });
const lists = (u, c = code) => call(book, { method: 'GET', token: u.token, query: { area: 'afterloss', circle: c, member: u.id } });
const see = (u, person = U.papa.id, c = code) => call(book, { method: 'GET', token: u.token, query: { area: 'afterloss', circle: c, member: u.id, person } });
const regList = (u) => call(book, { method: 'GET', token: u.token, query: { area: 'locator', circle: code, member: u.id, brief: '1' } });
const regOpen = (u, id) => call(book, { method: 'GET', token: u.token, query: { area: 'locator', circle: code, member: u.id, id } });
const fromReg = (v) => (v.steps || []).filter(s => s.part === 'register');
const names = (v) => fromReg(v).map(s => s.entry_id).sort().join();
const step = (v, key) => (v.steps || []).find(s => s.key === key);

// ---- the register, about Papa: every audience, written before anything starts
const base = { personId: U.papa.id, physicalLocationNotes: 'In the steel almirah, blue file' };
const E = {};
E.bank = (await add(U.papa, { ...base, category: 'BANK_ACCOUNT', institutionOrItem: 'SBI savings', nominee: 'Meera', unlockPolicy: 'IMMEDIATE', identifierMask: '482910244921' })).id;
E.diary = (await add(U.papa, { ...base, category: 'OTHER', institutionOrItem: 'Private diary', customLabel: 'My own things', unlockPolicy: 'ONLY_ME' })).id;
E.gold = (await add(U.rohan, { ...base, category: 'GOLD', institutionOrItem: 'Gold coins', unlockPolicy: 'ONLY_ME' })).id;
E.lic = (await add(U.papa, { ...base, category: 'INSURANCE', institutionOrItem: 'LIC policy', unlockPolicy: 'NOMINEES_ONLY', designatedRecipients: [U.priya.id], dueOn: '2027-01-15' })).id;
E.locker = (await add(U.papa, { ...base, category: 'LOCKER_KEY', institutionOrItem: 'SBI locker', unlockPolicy: 'EMERGENCY_ONLY' })).id;
E.ppf = (await add(U.papa, { ...base, category: 'PPF_EPF_NPS', institutionOrItem: 'PPF account', nominee: 'Priya Sharma', unlockPolicy: 'EMERGENCY_ONLY' })).id;
E.meeras = (await add(U.meera, { personId: U.meera.id, physicalLocationNotes: 'In her cupboard', category: 'VEHICLE', institutionOrItem: 'Meera scooter', unlockPolicy: 'IMMEDIATE' })).id;
ok('setup: seven register entries, six about Papa, one of each audience and two more', Object.values(E).every(Boolean), JSON.stringify(E));
const policies = async () => JSON.stringify(await rows(`select id, unlock_policy, designated_recipients, person_id, created_by from legacy_asset_locators order by id`));
const before = await policies();
const sortIds = (...ids) => ids.slice().sort().join();

// ---- nothing has started
{
  r = await lists(U.rohan);
  ok('no list yet; an adult may start one, and sees the other adults (never the child or a name)', r.status === 200 && r.lists.length === 0 && r.can_start === true
     && r.adults.map(a => a.name).sort().join() === 'Meera,Papa,Priya', JSON.stringify(r));
  ok('the words travel with it: the name, the sorry line and the not-legal-advice line', r.name === 'What needs doing' && r.sorry === 'We are sorry. This list is here so nothing is forgotten.'
     && r.legal === 'This is a list to help you remember, not legal advice. Rules differ by bank and state.');
  ok('a child is told he cannot start one', (await lists(U.kabir)).can_start === false);
  r = await see(U.rohan);
  ok('for Papa: no list, it needs a second adult, and who can be asked', r.status === 200 && r.list === null && r.start.can_start && r.start.needs_second
     && r.start.adults.map(a => a.name).join() === 'Meera,Priya' && r.steps.length === 0, JSON.stringify(r));
  ok('the writer of an "Only me" entry cannot widen it while its person is on Parwah', (await act(U.rohan, 'locator_share', { id: E.gold, unlockPolicy: 'IMMEDIATE' })).status === 403);
}

// ---- starting it
{
  const p0 = pushed.length;
  r = await act(U.rohan, 'afterloss_start', { personId: U.papa.id });
  ok('one adult alone cannot start it when a second adult exists', r.status === 400 && /second adult/.test(r.error) && r.field === 'ask', JSON.stringify(r));
  ok('the second adult cannot be the person themself', (await act(U.rohan, 'afterloss_start', { personId: U.papa.id, askId: U.papa.id })).status === 400);
  ok('nor himself', (await act(U.rohan, 'afterloss_start', { personId: U.papa.id, askId: U.rohan.id })).status === 400);
  ok('nor a child', (await act(U.rohan, 'afterloss_start', { personId: U.papa.id, askId: U.kabir.id })).status === 400);
  ok('nor someone added by name', (await act(U.rohan, 'afterloss_start', { personId: U.papa.id, askId: dadi })).status === 400);
  ok('nor someone from another family', (await act(U.rohan, 'afterloss_start', { personId: U.papa.id, askId: other.id })).status === 400);
  ok('a child cannot start it', (await act(U.kabir, 'afterloss_start', { personId: U.papa.id, askId: U.meera.id })).status === 403);
  ok('nobody starts it for themself', (await act(U.papa, 'afterloss_start', { personId: U.papa.id, askId: U.meera.id })).status === 400);
  r = await act(other, 'afterloss_start', { personId: U.papa.id, askId: U.meera.id });
  ok('an outsider using this family\'s code is refused', r.status === 403 && !r.id, JSON.stringify(r));
  r = await act(other, 'afterloss_start', { personId: U.papa.id }, other.code);
  ok('an outsider naming Papa from her own family is refused', r.status === 403 && /someone in this family/.test(r.error), JSON.stringify(r));
  ok('an outsider cannot read the lists or Papa\'s list', (await lists(other)).status === 403 && (await see(other)).status === 403 && (await see(other, U.papa.id, other.code)).status === 404);
  ok('a person id that is not an id is refused', (await act(U.rohan, 'afterloss_start', { personId: "x' or 1=1", askId: U.meera.id })).status === 403);
  ok('after all of that, nothing was started and nobody was told', (await rows('select 1 from afterloss_lists')).length === 0 && pushed.length === p0);

  r = await act(U.rohan, 'afterloss_start', { personId: U.papa.id, askId: U.meera.id });
  ok('Rohan asks Meera: it waits for her', r.status === 200 && r.state === 'pending' && (await rows('select status, ask_member, started_by, confirmed_by from afterloss_lists'))[0].status === 'pending', JSON.stringify(r));
  ok('one push, to Meera only, asking her to confirm', pushed.length === p0 + 1 && whoGot(p0) === 'meera' && pushed[p0].body.title === 'Rohan asks you to confirm'
     && /'What needs doing' for Papa/.test(pushed[p0].body.body), JSON.stringify(pushed.slice(p0)));
}
const listId = (await rows('select id from afterloss_lists'))[0].id;

// ---- while it waits: nothing is open, nothing can be ticked
{
  const p0 = pushed.length;
  r = await see(U.rohan);
  ok('waiting: Rohan sees that Meera was asked, and no steps', r.list.status === 'pending' && r.list.ask_name === 'Meera' && r.list.can_cancel && !r.list.can_confirm && r.steps.length === 0, JSON.stringify(r.list));
  r = await see(U.meera);
  ok('waiting: Meera sees she can confirm', r.list.can_confirm === true && r.list.started_by_name === 'Rohan');
  ok('waiting: "Only in an emergency" is still shut for Rohan in the register', (await regList(U.rohan)).locators.find(l => l.id === E.locker).can_view === false && (await regOpen(U.rohan, E.locker)).status === 403);
  ok('waiting: a tick is refused', (await act(U.rohan, 'afterloss_tick', { listId, key: 'f:bank', done: true })).status === 409);
  ok('waiting: a second start for Papa is refused', (await act(U.priya, 'afterloss_start', { personId: U.papa.id, askId: U.meera.id })).status === 409);
  ok('Rohan cannot confirm his own start', (await act(U.rohan, 'afterloss_confirm', { listId })).status === 403);
  ok('Priya was not asked, so cannot confirm', (await act(U.priya, 'afterloss_confirm', { listId })).status === 403);
  ok('Kabir cannot confirm or take it back', (await act(U.kabir, 'afterloss_confirm', { listId })).status === 403 && (await act(U.kabir, 'afterloss_cancel', { listId })).status === 403);
  ok('an outsider cannot confirm it, with either code', (await act(other, 'afterloss_confirm', { listId })).status === 403 && (await act(other, 'afterloss_confirm', { listId }, other.code)).status === 404);
  ok('still waiting, and nobody else was told', (await rows('select status from afterloss_lists'))[0].status === 'pending' && pushed.length === p0);

  r = await act(U.meera, 'afterloss_confirm', { listId });
  const l = (await rows('select * from afterloss_lists'))[0];
  ok('Meera confirms: it is active, started by Rohan, confirmed by Meera', r.status === 200 && l.status === 'active' && l.started_by === U.rohan.id && l.confirmed_by === U.meera.id && !!l.confirmed_at, JSON.stringify(l));
  ok('one push to the rest of the family: "Rohan started \'What needs doing\' for Papa"', pushed.length === p0 + 1 + 3 && whoGot(p0) === 'kabir,papa,priya,rohan'
     && pushed.slice(p0).every(p => p.body.title === "Rohan started 'What needs doing' for Papa" && /^Meera confirmed\./.test(p.body.body)), whoGot(p0) + ' ' + JSON.stringify(pushed[p0]));
  ok('confirming twice changes nothing and tells nobody', (await act(U.meera, 'afterloss_confirm', { listId })).status === 409 && pushed.length === p0 + 4);
}
const pushesAfterStart = pushed.length;

// ---- a confirmed list marks the person as remembered, with no date made up
{
  const m = (await rows(`select to_jsonb(m) as j from members m where id = $1`, [U.papa.id]))[0].j;
  ok('confirmed: Papa is marked as remembered, and no date of passing was invented', m.remembered === true && m.passed_year == null && m.passed_month == null && m.passed_day == null, JSON.stringify(m));
  ok('the list records that it set the mark', (await rows('select set_remembered, solo from afterloss_lists where id = $1', [listId]))[0].set_remembered === true);
  ok('nobody else in the family was marked', (await rows(`select 1 from members where remembered and id <> $1`, [U.papa.id])).length === 0);
}

// ---- starting it left every entry's audience exactly as it was
ok('starting and confirming changed no unlock_policy and no chosen people', (await policies()) === before);

// ---- what each person sees
{
  const R = await see(U.rohan), M = await see(U.meera), P = await see(U.priya), K = await see(U.kabir), PA = await see(U.papa);
  ok('everyone gets the nine first things, in order', [R, M, P, K, PA].every(v => v.status === 200 && v.steps.slice(0, 9).every(s => s.part === 'first') && v.steps[0].key === 'f:certificate'));
  ok('Rohan (started it, wrote the gold): the bank, his "Only me" entry, and both emergency entries', names(R) === sortIds(E.bank, E.gold, E.locker, E.ppf), fromReg(R).map(s => s.title).join(' | '));
  ok('Meera (confirmed it): the bank and both emergency entries', names(M) === sortIds(E.bank, E.locker, E.ppf), fromReg(M).map(s => s.title).join(' | '));
  ok('Priya (chosen for the policy; the PPF nominee has her name, and a name opens nothing): the bank and the policy, not the PPF or the locker', names(P) === sortIds(E.bank, E.lic), fromReg(P).map(s => s.title).join(' | '));
  ok('Kabir (a child in the family): only the whole-family entry', names(K) === E.bank, fromReg(K).map(s => s.title).join(' | '));
  ok('"Only me" entries: hidden from everyone but the person and the writer', [M, P, K].every(v => !/Private diary|Gold coins/.test(JSON.stringify(v))) && !/Private diary/.test(JSON.stringify(R)));
  ok('"People I choose": only for the person named', [R, M, K].every(v => !/LIC policy/.test(JSON.stringify(v))));
  ok('nothing about Meera\'s own entry is on Papa\'s list', [R, M, P, K, PA].every(v => !/Meera scooter/.test(JSON.stringify(v))));
  ok('the person the list is about still sees every entry about himself', names(PA) === sortIds(E.bank, E.diary, E.gold, E.lic, E.locker, E.ppf));
  ok('the writer is told how many entries only he can see; nobody else is', R.only_mine === 1 && M.only_mine === 0 && P.only_mine === 0 && K.only_mine === 0 && step(R, 'e:' + E.gold).only_you === true);
  ok('the wording comes from the entry: the bank and its nominee', step(M, 'e:' + E.bank).title === 'Tell SBI savings. Ask for the claim form for the nominee Meera.'
     && /Papers: In the steel almirah, blue file\. Number or label: Ending in \.\.\.4921\./.test(step(M, 'e:' + E.bank).how), JSON.stringify(step(M, 'e:' + E.bank)));
  ok('the policy, with its date', step(P, 'e:' + E.lic).title === 'Claim on LIC policy.' && /15 Jan 2027/.test(step(P, 'e:' + E.lic).how));
  ok('progress counts what each can see', R.progress.text === '0 of 13 done' && M.progress.text === '0 of 12 done' && P.progress.text === '0 of 11 done' && K.progress.text === '0 of 10 done',
     [R, M, P, K].map(v => v.progress.text).join());
  ok('who may close it: any adult, not the child', R.list.can_close && P.list.can_close && !K.list.can_close && PA.list.can_close);

  // The register gives the same answers: one rule, two screens.
  const rl = (await regList(U.rohan)).locators, pl = (await regList(U.priya)).locators, kl = (await regList(U.kabir)).locators;
  ok('register: the emergency entries are open to Rohan now', rl.find(l => l.id === E.locker).can_view === true && rl.find(l => l.id === E.ppf).can_view === true && (await regOpen(U.meera, E.locker)).status === 200);
  ok('register: for Priya the locker and the PPF are both still locked', pl.find(l => l.id === E.locker).can_view === false && pl.find(l => l.id === E.ppf).can_view === false && (await regOpen(U.priya, E.locker)).status === 403);
  ok('register: for Kabir both are still locked', kl.find(l => l.id === E.locker).can_view === false && kl.find(l => l.id === E.ppf).can_view === false);
  ok('register: "Only me" still does not exist for anyone else', !pl.some(l => l.id === E.diary || l.id === E.gold) && (await regOpen(U.meera, E.diary)).status === 404);
  const seenBy = await rows(`select viewer_id from legacy_asset_views where locator_id = $1`, [E.locker]);
  ok('reading a step is written in the register\'s view log, never for the person it is about', seenBy.some(v => v.viewer_id === U.rohan.id) && seenBy.some(v => v.viewer_id === U.meera.id)
     && !seenBy.some(v => v.viewer_id === U.priya.id || v.viewer_id === U.papa.id), JSON.stringify(seenBy));
}

// ---- a step I may not see is not there to tick, assign or annotate
{
  const hidden = await act(U.priya, 'afterloss_tick', { listId, key: 'e:' + E.locker, done: true });
  const never = await act(U.priya, 'afterloss_tick', { listId, key: 'e:11111111-1111-4111-8111-111111111111', done: true });
  ok('ticking a step for an entry I may not see answers exactly as one that was never there', hidden.status === 404 && never.status === 404 && hidden.error === never.error, JSON.stringify([hidden, never]));
  ok('the same for "Only me"', (await act(U.meera, 'afterloss_tick', { listId, key: 'e:' + E.diary, done: true })).status === 404);
  ok('and for a note or an assignment', (await act(U.kabir, 'afterloss_note', { listId, key: 'e:' + E.lic, note: 'hello' })).status === 404
     && (await act(U.kabir, 'afterloss_assign', { listId, key: 'e:' + E.ppf, assignId: U.kabir.id })).status === 404);
  ok('an entry about someone else is not a step on Papa\'s list', (await act(U.rohan, 'afterloss_tick', { listId, key: 'e:' + E.meeras, done: true })).status === 404);
  ok('a made-up step is refused', (await act(U.rohan, 'afterloss_tick', { listId, key: 'f:everything', done: true })).status === 404);
  ok('an outsider cannot tick, with either code', (await act(other, 'afterloss_tick', { listId, key: 'f:bank', done: true })).status === 403
     && (await act(other, 'afterloss_tick', { listId, key: 'f:bank', done: true }, other.code)).status === 404);
  ok('none of that left a mark', (await rows('select 1 from afterloss_steps')).length === 0);
}

// ---- ticks at the same moment all hold
{
  const firsts = ['f:certificate', 'f:bank', 'f:insurer', 'f:employer', 'f:phone', 'f:will', 'f:landlord', 'f:ids', 'f:subs'];
  const who = [U.rohan, U.meera, U.priya];
  const all = await Promise.all([
    ...firsts.map((key, i) => act(who[i % 3], 'afterloss_tick', { listId, key, done: true })),
    // One step, three people, three different changes, at once.
    act(U.rohan, 'afterloss_tick', { listId, key: 'e:' + E.bank, done: true }),
    act(U.meera, 'afterloss_assign', { listId, key: 'e:' + E.bank, assignId: U.priya.id }),
    act(U.priya, 'afterloss_note', { listId, key: 'e:' + E.bank, note: 'Branch opens at ten.' })
  ]);
  ok('twelve changes at once all answer yes', all.every(x => x.status === 200), all.map(x => x.status).join());
  const marks = await rows('select * from afterloss_steps where list_id = $1', [listId]);
  ok('all nine ticks held, each with who ticked', firsts.every((k, i) => marks.some(m => m.step_key === k && m.done && m.done_by === who[i % 3].id)), JSON.stringify(marks.map(m => [m.step_key, m.done])));
  const b = marks.find(m => m.step_key === 'e:' + E.bank);
  ok('the tick, the assignment and the note on one step all held', b && b.done === true && b.done_by === U.rohan.id && b.assigned_to === U.priya.id && b.note === 'Branch opens at ten.' && b.note_by === U.priya.id, JSON.stringify(b));
  // Two people ticking the same step at once: one row, done, never an error.
  const same = await Promise.all([U.rohan, U.meera, U.rohan, U.meera, U.rohan].map(u => act(u, 'afterloss_tick', { listId, key: 'e:' + E.ppf, done: true })));
  ok('five ticks on one step at once: one row, ticked', same.every(x => x.status === 200) && (await rows(`select done from afterloss_steps where list_id = $1 and step_key = $2`, [listId, 'e:' + E.ppf])).map(x => x.done).join() === 'true');
  r = await see(U.kabir);
  ok('progress updates for everyone, by what each can see', r.progress.text === '10 of 10 done' && (await see(U.meera)).progress.text === '11 of 12 done' && (await see(U.rohan)).progress.text === '11 of 13 done', r.progress.text);
  ok('everyone who can see a step sees who ticked it, who is doing it and the note', step(r, 'e:' + E.bank).done_by_name === 'Rohan' && step(r, 'e:' + E.bank).assigned_name === 'Priya'
     && step(r, 'e:' + E.bank).note === 'Branch opens at ten.' && step(r, 'e:' + E.bank).note_by_name === 'Priya' && step(r, 'f:bank').done_by_name === 'Meera', JSON.stringify(step(r, 'e:' + E.bank)));
  ok('unticking is one change too, and keeps the note and who is doing it', (await act(U.kabir, 'afterloss_tick', { listId, key: 'e:' + E.bank, done: false })).status === 200
     && step(await see(U.meera), 'e:' + E.bank).done === false && step(await see(U.meera), 'e:' + E.bank).done_by_name === null
     && step(await see(U.meera), 'e:' + E.bank).assigned_name === 'Priya' && step(await see(U.meera), 'e:' + E.bank).note === 'Branch opens at ten.');
}

// ---- who is doing it
{
  r = await act(U.rohan, 'afterloss_assign', { listId, key: 'e:' + E.locker, assignId: U.priya.id });
  ok('a step cannot be given to someone who may not see its entry', r.status === 400 && /Priya cannot see this entry/.test(r.error), JSON.stringify(r));
  ok('and Priya\'s list still has no such step', !step(await see(U.priya), 'e:' + E.locker));
  ok('it can be given to someone who may', (await act(U.rohan, 'afterloss_assign', { listId, key: 'e:' + E.locker, assignId: U.meera.id })).status === 200 && step(await see(U.meera), 'e:' + E.locker).assigned_name === 'Meera');
  ok('not to someone added by name', (await act(U.rohan, 'afterloss_assign', { listId, key: 'f:will', assignId: dadi })).status === 400);
  ok('not to someone from another family', (await act(U.rohan, 'afterloss_assign', { listId, key: 'f:will', assignId: other.id })).status === 403);
  ok('not to the person the list is about', (await act(U.rohan, 'afterloss_assign', { listId, key: 'f:will', assignId: U.papa.id })).status === 400);
  ok('a first-things step can be given to anyone on Parwah in the family', (await act(U.meera, 'afterloss_assign', { listId, key: 'f:will', assignId: U.kabir.id })).status === 200 && step(await see(U.rohan), 'f:will').assigned_name === 'Kabir');
  ok('and taken back', (await act(U.meera, 'afterloss_assign', { listId, key: 'f:will', assignId: null })).status === 200 && step(await see(U.rohan), 'f:will').assigned_to === null && step(await see(U.rohan), 'f:will').done === true);
}

// ---- notes never keep a secret
{
  const note = (text) => act(U.rohan, 'afterloss_note', { listId, key: 'f:bank', note: text });
  r = await note('Card 4111 1111 1111 1111 is in his wallet');
  ok('a card number is refused, in words', r.status === 400 && /card number/.test(r.error) && r.field === 'note', JSON.stringify(r));
  ok('a CVV is refused', (await note('cvv 123')).status === 400);
  ok('an OTP is refused', (await note('The OTP is 482910')).status === 400);
  r = await note('Net banking password: tiger@77');
  ok('a password is refused', r.status === 400 && /never keeps/.test(r.error), JSON.stringify(r));
  ok('a PIN is refused', (await note('ATM pin 4821')).status === 400 && (await note('his pin is 4821')).status === 400);
  ok('a note that is too long is refused', (await note('x'.repeat(301))).status === 400);
  ok('nothing of those was saved', (await rows(`select note from afterloss_steps where list_id = $1 and step_key = 'f:bank'`, [listId]))[0].note === null);
  ok('where the password is kept is fine', (await note('The password is in the red diary. Manager is Mr Rao.')).status === 200 && step(await see(U.priya), 'f:bank').note === 'The password is in the red diary. Manager is Mr Rao.');
  ok('an empty note clears it', (await note('  ')).status === 200 && step(await see(U.priya), 'f:bank').note === null && step(await see(U.priya), 'f:bank').done === true);
}

// ---- "Only me": the writer may choose to share it now, and only then
{
  ok('still unchanged: nothing so far has touched who can see an entry', (await policies()) === before);
  ok('Meera cannot widen an entry she cannot even see', (await act(U.meera, 'locator_share', { id: E.gold, unlockPolicy: 'IMMEDIATE' })).status === 404);
  r = await act(U.rohan, 'locator_share', { id: E.gold, unlockPolicy: 'IMMEDIATE' });
  ok('the writer chooses to share his "Only me" entry now: it is his act, and it is allowed', r.status === 200 && (await rows('select unlock_policy from legacy_asset_locators where id = $1', [E.gold]))[0].unlock_policy === 'IMMEDIATE');
  ok('then, and only then, the family gets its step', !!step(await see(U.meera), 'e:' + E.gold) && (await see(U.rohan)).only_mine === 0 && !step(await see(U.meera), 'e:' + E.diary));
}
const afterShare = await policies();

// ---- closing it shuts "Only in an emergency" again
{
  const p0 = pushed.length;
  ok('a child cannot close it', (await act(U.kabir, 'afterloss_close', { listId })).status === 403);
  ok('an outsider cannot close it', (await act(other, 'afterloss_close', { listId })).status === 403 && (await act(other, 'afterloss_close', { listId }, other.code)).status === 404);
  r = await act(U.priya, 'afterloss_close', { listId });
  ok('an adult closes it', r.status === 200 && (await rows('select status, closed_by from afterloss_lists'))[0].closed_by === U.priya.id);
  const R = await see(U.rohan), M = await see(U.meera), P = await see(U.priya);
  ok('closed: the emergency entries are gone from the lists of the two who started it', R.list.status === 'closed' && !step(R, 'e:' + E.locker) && !step(R, 'e:' + E.ppf) && !step(M, 'e:' + E.locker), names(R));
  ok('closed: Priya still has the policy she was chosen for', !step(P, 'e:' + E.ppf) && !!step(P, 'e:' + E.lic));
  ok('closed: the register has shut them again for Rohan and Meera', (await regList(U.rohan)).locators.find(l => l.id === E.locker).can_view === false && (await regOpen(U.meera, E.locker)).status === 403
     && (await regOpen(U.priya, E.ppf)).status === 403);
  ok('closed: what was ticked is still shown', step(R, 'f:certificate').done === true && R.progress.done >= 9);
  ok('closed: nothing can be ticked, given or noted', (await act(U.rohan, 'afterloss_tick', { listId, key: 'f:bank', done: false })).status === 409
     && (await act(U.rohan, 'afterloss_assign', { listId, key: 'f:bank', assignId: U.meera.id })).status === 409 && (await act(U.rohan, 'afterloss_note', { listId, key: 'f:bank', note: 'x' })).status === 409);
  ok('closed: the writer can no longer widen an "Only me" entry about someone on Parwah', (await act(U.papa, 'locator_share', { id: E.diary, unlockPolicy: 'ONLY_ME' })).status === 200
     && (await add(U.rohan, { ...base, category: 'HEIRLOOM', institutionOrItem: 'Old watch', unlockPolicy: 'ONLY_ME' })).status === 200
     && (await act(U.rohan, 'locator_share', { id: (await rows(`select id from legacy_asset_locators where institution_or_item = 'Old watch'`))[0].id, unlockPolicy: 'IMMEDIATE' })).status === 403);
  await rows(`delete from legacy_asset_locators where institution_or_item = 'Old watch'`);
  ok('closing changed no unlock_policy', (await policies()) === afterShare);
  ok('a child cannot open it again', (await act(U.kabir, 'afterloss_reopen', { listId })).status === 403);
  ok('closing it twice is refused', (await act(U.priya, 'afterloss_close', { listId })).status === 409);
  ok('closing it normally leaves Papa marked as remembered', (await rows('select remembered from members where id = $1', [U.papa.id]))[0].remembered === true);
  ok('closing told nobody', pushed.length === p0);

  // Opening it again is the start rule again.
  r = await act(U.priya, 'afterloss_reopen', { listId });
  ok('one adult alone cannot open it again when a second adult exists', r.status === 400 && r.field === 'ask' && /second adult/.test(r.error) && (await rows('select status from afterloss_lists'))[0].status === 'closed', JSON.stringify(r));
  ok('the second adult cannot be the person, herself, a child, a name or an outsider', (await act(U.priya, 'afterloss_reopen', { listId, askId: U.papa.id })).status === 400
     && (await act(U.priya, 'afterloss_reopen', { listId, askId: U.priya.id })).status === 400 && (await act(U.priya, 'afterloss_reopen', { listId, askId: U.kabir.id })).status === 400
     && (await act(U.priya, 'afterloss_reopen', { listId, askId: dadi })).status === 400 && (await act(U.priya, 'afterloss_reopen', { listId, askId: other.id })).status === 400);
  ok('the person the list is about cannot open it again', (await act(U.papa, 'afterloss_reopen', { listId, askId: U.meera.id })).status === 403);
  ok('after all of that it is still closed and nobody was told', (await rows('select status from afterloss_lists'))[0].status === 'closed' && pushed.length === p0);
  r = await act(U.priya, 'afterloss_reopen', { listId, askId: U.rohan.id });
  let l = (await rows('select * from afterloss_lists where id = $1', [listId]))[0];
  ok('Priya asks Rohan to open it again: it waits, Priya is the starter, and the old confirmation is cleared', r.status === 200 && r.state === 'pending' && l.status === 'pending' && l.started_by === U.priya.id
     && l.ask_member === U.rohan.id && l.confirmed_by === null && l.confirmed_at === null && l.reopened_by === U.priya.id, JSON.stringify(l));
  ok('the same confirm request is pushed, to Rohan only', pushed.length === p0 + 1 && whoGot(p0) === 'rohan' && pushed[p0].body.title === 'Priya asks you to confirm' && /'What needs doing' for Papa/.test(pushed[p0].body.body));
  const W = await see(U.rohan);
  ok('waiting to open again: no steps, Rohan may confirm, and it says it is a request to open again', W.list.status === 'pending' && W.list.reopening === true && W.list.can_confirm === true && W.steps.length === 0, JSON.stringify(W.list));
  ok('waiting to open again: the emergency entries are shut for everyone but Papa', (await regList(U.rohan)).locators.find(x => x.id === E.locker).can_view === false && (await regOpen(U.priya, E.locker)).status === 403
     && (await regOpen(U.meera, E.locker)).status === 403);
  ok('waiting to open again: nothing can be ticked', (await act(U.priya, 'afterloss_tick', { listId, key: 'f:bank', done: false })).status === 409);
  ok('waiting to open again: the writer of an "Only me" entry cannot widen it', (await add(U.rohan, { ...base, category: 'HEIRLOOM', institutionOrItem: 'Old pen', unlockPolicy: 'ONLY_ME' })).status === 200
     && (await act(U.rohan, 'locator_share', { id: (await rows(`select id from legacy_asset_locators where institution_or_item = 'Old pen'`))[0].id, unlockPolicy: 'IMMEDIATE' })).status === 403);
  await rows(`delete from legacy_asset_locators where institution_or_item = 'Old pen'`);
  ok('Priya cannot confirm her own request, and Meera was not asked', (await act(U.priya, 'afterloss_confirm', { listId })).status === 403 && (await act(U.meera, 'afterloss_confirm', { listId })).status === 403);
  ok('Priya takes the request back: the list is closed again, with its ticks, and is not deleted', (await act(U.priya, 'afterloss_cancel', { listId })).status === 200
     && (await rows('select status from afterloss_lists where id = $1', [listId]))[0].status === 'closed' && (await rows('select 1 from afterloss_steps where list_id = $1 and done', [listId])).length >= 9);
  ok('she asks again, and Rohan confirms: it is active', (await act(U.priya, 'afterloss_reopen', { listId, askId: U.rohan.id })).status === 200 && (await act(U.rohan, 'afterloss_confirm', { listId })).status === 200);
  l = (await rows('select * from afterloss_lists where id = $1', [listId]))[0];
  ok('active again only after that confirmation: started by Priya, confirmed by Rohan', l.status === 'active' && l.started_by === U.priya.id && l.confirmed_by === U.rohan.id && !!l.confirmed_at, JSON.stringify(l));
  ok('the family is told once that it is open again', pushed.filter(x => x.body.title === "Priya opened 'What needs doing' for Papa again" && /^Rohan confirmed\./.test(x.body.body)).length === 4, pushed.slice(p0).map(x => x.body.title).join(' | '));
  const R2 = await see(U.rohan), P2 = await see(U.priya), M2 = await see(U.meera);
  ok('reopened: the emergency entries are open for the two who opened it again, with their ticks', !!step(R2, 'e:' + E.locker) && step(R2, 'e:' + E.ppf).done === true && step(R2, 'e:' + E.locker).assigned_name === 'Meera' && !!step(P2, 'e:' + E.locker) && !!step(P2, 'e:' + E.ppf));
  ok('reopened: Meera confirmed the first start but not this one, so the locker and the PPF stay shut for her', !step(M2, 'e:' + E.locker) && !step(M2, 'e:' + E.ppf)
     && (await regList(U.meera)).locators.find(x => x.id === E.locker).can_view === false);
  ok('closing and reopening changed no unlock_policy', (await policies()) === afterShare);
}

// ---- an entry removed from the register takes its step with it
{
  ok('Papa removes the PPF entry from the register', (await act(U.papa, 'locator_remove', { id: E.ppf })).status === 200);
  ok('its step is gone, and the rest of the list is as it was', !step(await see(U.rohan), 'e:' + E.ppf) && !!step(await see(U.rohan), 'e:' + E.locker)
     && (await act(U.rohan, 'afterloss_tick', { listId, key: 'e:' + E.ppf, done: true })).status === 404);
}

// ---- taking a request back, and a family with one adult
let baujiList = null;
{
  const p0 = pushed.length;
  r = await act(U.rohan, 'afterloss_start', { personId: dadi, askId: U.priya.id });
  const id2 = r.id;
  ok('a second list, for Dadi, waits for Priya', r.status === 200 && (await lists(U.meera)).lists.length === 2 && whoGot(p0) === 'priya');
  ok('Meera was not asked, so cannot take it back', (await act(U.meera, 'afterloss_cancel', { listId: id2 })).status === 403);
  ok('Priya says not now: the request is gone', (await act(U.priya, 'afterloss_cancel', { listId: id2 })).status === 200 && (await rows('select 1 from afterloss_lists where person_id = $1', [dadi])).length === 0);
  r = await act(U.rohan, 'afterloss_start', { personId: dadi, askId: U.priya.id });
  ok('it can be asked again, and Rohan can take his own request back', r.status === 200 && (await act(U.rohan, 'afterloss_cancel', { listId: r.id })).status === 200 && (await lists(U.meera)).lists.length === 1);
  // Start, take back, start again must not ring Priya's phone all day.
  const p2 = pushed.length;
  r = await act(U.rohan, 'afterloss_start', { personId: dadi, askId: U.priya.id });
  ok('a third ask in the hour still reaches Priya', r.status === 200 && pushed.length === p2 + 1 && (await act(U.rohan, 'afterloss_cancel', { listId: r.id })).status === 200);
  r = await act(U.rohan, 'afterloss_start', { personId: dadi, askId: U.priya.id });
  ok('a fourth ask in the hour is still made, but no push is sent', r.status === 200 && r.state === 'pending' && pushed.length === p2 + 1 && (await see(U.priya, dadi)).list.can_confirm === true, JSON.stringify(r));
  ok('and Rohan takes it back', (await act(U.rohan, 'afterloss_cancel', { listId: r.id })).status === 200 && (await lists(U.meera)).lists.length === 1);
  ok('Dadi was never marked as remembered: nothing was confirmed for her', (await rows('select remembered from members where id = $1', [dadi]))[0].remembered === false);
  ok('an active list cannot be taken back, only closed', (await act(U.rohan, 'afterloss_cancel', { listId })).status === 409);

  const p1 = pushed.length;
  r = await see(other, bauji, other.code);
  ok('Kamla is the only adult in her family: no second adult is asked for', r.start.can_start && r.start.needs_second === false && r.start.adults.length === 0, JSON.stringify(r.start));
  r = await act(other, 'afterloss_start', { personId: bauji }, other.code);
  baujiList = r.id;
  ok('with only one adult, she starts it alone and it is active at once', r.status === 200 && r.state === 'active' && (await see(other, bauji, other.code)).list.status === 'active' && (await see(other, bauji, other.code)).steps.length === 9, JSON.stringify(r));
  ok('nobody else is in her family to tell, and the Sharmas hear nothing', pushed.length === p1);
  ok('a start by the only adult marks Bauji as remembered too', (await rows('select remembered from members where id = $1', [bauji]))[0].remembered === true
     && (await rows('select solo, set_remembered from afterloss_lists where id = $1', [r.id]))[0].solo === true);
  // Someone who is on Parwah could be alive and reading: never one adult alone.
  const vimla = await signUp('9861000010', 'Vimla', '4417');
  await call(circle, { token: other.token, body: { action: 'set_join_policy', code: other.code, memberId: other.id, policy: 'open' } });
  vimla.id = (await call(circle, { token: vimla.token, body: { action: 'join', code: other.code, memberName: 'Vimla', userId: vimla.userId, role: 'family', relation: 'sister' } })).memberId;
  const p3 = pushed.length;
  const solo = await act(other, 'afterloss_start', { personId: vimla.id }, other.code);
  ok('one adult alone is refused for someone who is on Parwah', !!vimla.id && solo.status === 400 && solo.error === 'This needs a second adult on Parwah to confirm.' && !solo.id
     && (await rows('select 1 from afterloss_lists where person_id = $1', [vimla.id])).length === 0, JSON.stringify(solo));
  const sv = await see(other, vimla.id, other.code);
  ok('and the screen is told why it cannot start', sv.start.can_start === false && sv.start.why === 'This needs a second adult on Parwah to confirm.', JSON.stringify(sv.start));
  ok('Vimla is not marked, and nobody was told', (await rows('select remembered from members where id = $1', [vimla.id]))[0].remembered === false && pushed.length === p3);
  ok('the Sharmas cannot see the Guptas\' list, or tick it', (await lists(U.rohan)).lists.every(l => l.person_name !== 'Bauji') && (await act(U.rohan, 'afterloss_tick', { listId: r.id, key: 'f:bank', done: true })).status === 404);
}

// ---- a list that is active but was never confirmed opens nothing (rows from before this rule)
{
  await rows(`update afterloss_lists set confirmed_by = null where id = $1`, [listId]);
  ok('active without a confirmation: the emergency entries are shut, in the list and in the register', !step(await see(U.priya), 'e:' + E.locker) && (await regOpen(U.priya, E.locker)).status === 403
     && (await regList(U.rohan)).locators.find(x => x.id === E.locker).can_view === false);
  ok('and the writer of an "Only me" entry cannot widen it', (await add(U.priya, { ...base, category: 'HEIRLOOM', institutionOrItem: 'Old ring', unlockPolicy: 'ONLY_ME' })).status === 200
     && (await act(U.priya, 'locator_share', { id: (await rows(`select id from legacy_asset_locators where institution_or_item = 'Old ring'`))[0].id, unlockPolicy: 'IMMEDIATE' })).status === 403);
  await rows(`update afterloss_lists set confirmed_by = $2 where id = $1`, [listId, U.rohan.id]);
  ok('confirmed again, the same writer may', (await act(U.priya, 'locator_share', { id: (await rows(`select id from legacy_asset_locators where institution_or_item = 'Old ring'`))[0].id, unlockPolicy: 'IMMEDIATE' })).status === 200);
  await rows(`delete from legacy_asset_locators where institution_or_item = 'Old ring'`);
}

// ---- the person the list is about closes it: they are alive, so it is removed
{
  const p0 = pushed.length;
  r = await act(U.papa, 'afterloss_close', { listId });
  ok('Papa closes the list that was started for him: it is removed', r.status === 200 && r.state === 'removed' && (await rows('select 1 from afterloss_lists where id = $1', [listId])).length === 0
     && (await rows('select 1 from afterloss_steps where list_id = $1', [listId])).length === 0, JSON.stringify(r));
  ok('the two who started and confirmed it are told, once, calmly, and nobody else', pushed.length === p0 + 2 && whoGot(p0) === 'priya,rohan'
     && pushed.slice(p0).every(x => x.body.body === 'Papa closed the list that was started for them.'), whoGot(p0) + ' ' + JSON.stringify(pushed.slice(p0)));
  ok('the mark this list set is taken off Papa', (await rows('select remembered from members where id = $1', [U.papa.id]))[0].remembered === false);
  ok('it cannot be opened again, by anyone', (await act(U.priya, 'afterloss_reopen', { listId, askId: U.rohan.id })).status === 404 && (await act(U.rohan, 'afterloss_confirm', { listId })).status === 404);
  ok('the emergency entries are shut again', (await regOpen(U.priya, E.locker)).status === 403 && (await regOpen(U.rohan, E.locker)).status === 403);
  ok('a fresh start goes through the whole rule: alone is refused', (await act(U.rohan, 'afterloss_start', { personId: U.papa.id })).status === 400);
  // Someone else had already marked Papa: removing a list must not undo that.
  await rows(`update members set remembered = true where id = $1`, [U.papa.id]);
  r = await act(U.meera, 'afterloss_start', { personId: U.papa.id, askId: U.priya.id });
  const id3 = r.id;
  ok('a new list, asked and confirmed', r.status === 200 && r.state === 'pending' && (await act(U.priya, 'afterloss_confirm', { listId: id3 })).status === 200
     && (await rows('select set_remembered from afterloss_lists where id = $1', [id3]))[0].set_remembered === false);
  ok('Papa removes it again, and the mark it did not set stays', (await act(U.papa, 'afterloss_close', { listId: id3 })).status === 200 && (await rows('select remembered from members where id = $1', [U.papa.id]))[0].remembered === true);
  await rows(`update members set remembered = false where id = $1`, [U.papa.id]);
  // A request to open a closed list again, and Papa says no: removed too.
  r = await act(U.meera, 'afterloss_start', { personId: U.papa.id, askId: U.priya.id });
  const id4 = r.id;
  ok('a list is confirmed, closed by an adult, and asked open again', (await act(U.priya, 'afterloss_confirm', { listId: id4 })).status === 200 && (await act(U.meera, 'afterloss_close', { listId: id4 })).status === 200
     && (await act(U.meera, 'afterloss_reopen', { listId: id4, askId: U.priya.id })).status === 200);
  ok('Papa takes that request back himself: the list is removed and his mark comes off', (await act(U.papa, 'afterloss_cancel', { listId: id4 })).status === 200
     && (await rows('select 1 from afterloss_lists where id = $1', [id4])).length === 0 && (await rows('select remembered from members where id = $1', [U.papa.id]))[0].remembered === false);
}

// ---- in all, the Sharma list sent exactly two kinds of push, once each
ok('from start to here the Sharma list for Papa sent one ask and one "started", and nothing since', pushesAfterStart === 5 && pushed.filter(p => p.body.title === "Rohan started 'What needs doing' for Papa").length === 4
   && pushed.filter(p => p.body.title === 'Rohan asks you to confirm').length === 4, pushed.map(p => p.body.title).join(' | '));
ok('an unknown action is refused', (await act(other, 'afterloss_everything', { listId: baujiList }, other.code)).status === 400);

globalThis.fetch = realFetch;
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`afterloss.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
