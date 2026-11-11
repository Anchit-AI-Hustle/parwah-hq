// THE FAMILY REGISTER, AGAINST A REAL DATABASE: the real handler behind
// /api/book?area=locator and a real PostgreSQL. What it proves:
//
//   - "Only me" does not exist for anyone else, in the list or by its id;
//   - "People I choose" opens only for the people chosen;
//   - "Only in an emergency" opens only while the person has an SOS open;
//   - someone from another family is refused;
//   - only the person it is about, or whoever wrote it, can edit, re-share
//     or remove it;
//   - the view log records a viewer once a day, and never the owner;
//   - a card number, a CVV, an OTP, a PIN or a password is refused in every
//     box, and an account number keeps only its last 4;
//   - rows saved before the register, with the old kinds, still read.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_famreg_test \
//     node --import ./site/tests/db/register.mjs site/tests/db/famregister.dbtest.mjs
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('famregister.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('famregister.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
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

const { default: auth } = await import('../../../api/auth.mjs');
const { default: circle } = await import('../../../api/circle.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { default: events } = await import('../../../api/events.mjs');

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };

let ipn = 0;
async function call(handler, { method = 'POST', body, query, token, headers = {} } = {}) {
  const req = { method, body, query: query || {}, headers: { 'x-forwarded-for': '10.8.' + (++ipn % 250) + '.1', ...headers } };
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
const U = { papa: await signUp('9860000001', 'Papa', '4829'), rohan: await signUp('9860000002', 'Rohan', '7351'),
            meera: await signUp('9860000003', 'Meera', '6142'), priya: await signUp('9860000004', 'Priya', '9153') };
let r = await call(circle, { token: U.papa.token, body: { action: 'create', kind: 'family', memberName: 'Papa', circleName: 'Sharma', userId: U.papa.userId, role: 'parent', relation: 'father' } });
const code = r.code; U.papa.id = r.memberId;
await call(circle, { token: U.papa.token, body: { action: 'set_join_policy', code, memberId: U.papa.id, policy: 'open' } });
for (const k of ['rohan', 'meera', 'priya']) {
  const j = await call(circle, { token: U[k].token, body: { action: 'join', code, memberName: U[k].name, userId: U[k].userId, role: 'family', relation: k === 'rohan' ? 'son' : 'daughter' } });
  U[k].id = j.memberId;
}
const other = await signUp('9860000009', 'Kamla', '5937');
r = await call(circle, { token: other.token, body: { action: 'create', kind: 'family', memberName: 'Kamla', circleName: 'Gupta', userId: other.userId, role: 'family' } });
other.id = r.memberId; other.code = r.code;
ok('setup: four in the Sharma family, one in the Guptas', U.papa.id && U.rohan.id && U.meera.id && U.priya.id && other.id);

const add = (u, body) => call(book, { token: u.token, body: { code, memberId: u.id, action: 'locator_add', ...body } });
const act = (u, action, body) => call(book, { token: u.token, body: { code, memberId: u.id, action, ...body } });
const list = async (u, extra = {}) => (await call(book, { method: 'GET', token: u.token, query: { area: 'locator', circle: code, member: u.id, brief: '1', ...extra } }));
const open = (u, id) => call(book, { method: 'GET', token: u.token, query: { area: 'locator', circle: code, member: u.id, id } });
const views = (id) => rows('select viewer_id, day from legacy_asset_views where locator_id = $1 order by day', [id]);
const base = { personId: U.papa.id, category: 'HOUSE', institutionOrItem: 'Flat in Indiranagar', physicalLocationNotes: 'Sale deed in the steel almirah, blue file' };

// ---- the list tells the app the kinds and the four choices
{
  r = await list(U.papa);
  ok('an empty register answers with the kinds and the four choices', r.status === 200 && r.locators.length === 0
     && r.groups.map(g => g.label).join('|') === 'Home and land|Money|Papers|Things|Online|Other'
     && r.who.map(w => w[1]).join('|') === 'Only me|People I choose|Whole family|Only in an emergency', JSON.stringify(r).slice(0, 300));
  const all = r.groups.flatMap(g => g.kinds.map(k => k[0]));
  ok('every kind is in exactly one group, and all of them are accepted', all.length === new Set(all).size && all.slice().sort().join() === r.categories.slice().sort().join(), all.join());
}

// ---- rows saved before the register still read
let oldId;
{
  const ins = await rows(`insert into legacy_asset_locators (circle_id, person_id, asset_category, institution_or_item, identifier_mask, physical_location_notes, unlock_policy, created_by)
    select circle_id, id, 'DEMAT', 'Zerodha demat', 'Folio 12', 'Statement in the grey box', 'IMMEDIATE', id from members where id = $1 returning id`, [U.papa.id]);
  oldId = ins[0].id;
  await rows(`insert into legacy_asset_locators (circle_id, person_id, asset_category, institution_or_item, physical_location_notes, unlock_policy, designated_recipients, created_by)
    select circle_id, id, 'OTHER', 'Old trunk', 'Under the stairs', 'NOMINEES_ONLY', $2::jsonb, id from members where id = $1`, [U.papa.id, JSON.stringify([U.rohan.id])]);
  const mine = (await list(U.papa)).locators;
  ok('the old rows are in the list, with their kinds said plainly', mine.length === 2 && mine[0].kind_label === 'Demat or share papers' && mine[1].kind_label === 'Anything else', JSON.stringify(mine));
  const o = await open(U.meera, oldId);
  ok('an old whole-family row opens for the family, as typed, with empty new details', o.status === 200 && o.entry.physical_location_notes === 'Statement in the grey box'
     && o.entry.identifier_mask === 'Folio 12' && o.entry.nominee === null && o.entry.approx_value === null && o.entry.due_on === null, JSON.stringify(o));
  const legacy = await call(book, { method: 'GET', token: U.rohan.token, query: { area: 'locator', circle: code, member: U.rohan.id } });
  const trunk = legacy.locators.find(x => x.institution_or_item === 'Old trunk');
  ok('the old list (no brief) still carries the notes for someone chosen', trunk && trunk.can_view === true && trunk.physical_location_notes === 'Under the stairs', JSON.stringify(trunk));
  const lockedTrunk = (await list(U.meera)).locators.find(x => x.asset_category === 'OTHER');
  ok('and someone not chosen gets a locked row with no title', lockedTrunk && lockedTrunk.can_view === false && lockedTrunk.institution_or_item === null, JSON.stringify(lockedTrunk));
  await admin.query('delete from legacy_asset_locators where institution_or_item = $1', ['Old trunk']);
}

// ---- who can see it must be one of the four
{
  r = await add(U.papa, { ...base, unlockPolicy: 'EVERYONE' });
  ok('a rule that is not one of the four is refused', r.status === 400 && /Choose who can see this/.test(r.error || ''), JSON.stringify(r));
  r = await add(U.papa, { ...base });
  ok('and so is no rule at all', r.status === 400 && /Choose who can see this/.test(r.error || ''), JSON.stringify(r));
  r = await add(U.papa, { ...base, unlockPolicy: 'NOMINEES_ONLY', designatedRecipients: [] });
  ok('"People I choose" with nobody chosen is refused', r.status === 400 && /at least one person/.test(r.error || ''), JSON.stringify(r));
  r = await add(U.papa, { ...base, unlockPolicy: 'NOMINEES_ONLY', designatedRecipients: [other.id] });
  ok("someone from another family cannot be chosen", r.status === 403, JSON.stringify(r));
  r = await add(U.papa, { ...base, personId: other.id, unlockPolicy: 'IMMEDIATE' });
  ok("an entry about another family's member is refused", r.status === 403, JSON.stringify(r));
  r = await add(U.papa, { ...base, unlockPolicy: 'IMMEDIATE', inNameMemberId: other.id });
  ok("it cannot be in the name of another family's member", r.status === 403, JSON.stringify(r));
  ok('nothing was stored by any of those', (await rows('select id from legacy_asset_locators')).length === 1);
}

// ---- 1. Only me
let onlyId;
{
  r = await add(U.papa, { ...base, institutionOrItem: 'My private plot', category: 'LAND', unlockPolicy: 'ONLY_ME' });
  ok('an "Only me" entry is saved', r.status === 200 && !!r.id, JSON.stringify(r));
  onlyId = r.id;
  const mine = (await list(U.papa)).locators.find(x => x.id === onlyId);
  ok('its owner sees it in the list', mine && mine.can_view && mine.can_manage && mine.institution_or_item === 'My private plot', JSON.stringify(mine));
  for (const u of [U.rohan, U.meera, U.priya]) {
    const l = await list(u);
    ok(u.name + ': it is not in the list at all, not even locked', l.status === 200 && !l.locators.some(x => x.id === onlyId) && !JSON.stringify(l).includes('private plot'), JSON.stringify(l.locators));
    const legacy = await call(book, { method: 'GET', token: u.token, query: { area: 'locator', circle: code, member: u.id } });
    ok(u.name + ': nor in the old list', !JSON.stringify(legacy).includes(onlyId));
    const o = await open(u, onlyId);
    ok(u.name + ': by its id it answers as if it was never written', o.status === 404 && !o.entry && !JSON.stringify(o).includes('plot'), JSON.stringify(o));
    for (const a of ['locator_update', 'locator_share', 'locator_remove']) {
      const x = await act(u, a, { id: onlyId, ...base, unlockPolicy: 'IMMEDIATE' });
      ok(u.name + ': ' + a + ' is answered the same way', x.status === 404, JSON.stringify(x));
    }
  }
  const never = await open(U.rohan, '00000000-0000-4000-8000-000000000000');
  const hidden = await open(U.rohan, onlyId);
  ok('hidden and never-written are the same answer, word for word', never.status === 404 && never.error === hidden.error);
  ok('nobody but the owner left a mark on it', (await views(onlyId)).length === 0);
  ok('and it is still there, unchanged', (await rows('select unlock_policy from legacy_asset_locators where id = $1', [onlyId]))[0].unlock_policy === 'ONLY_ME');
}

// ---- 2. People I choose, with every optional detail
let houseId;
{
  r = await add(U.papa, { ...base, unlockPolicy: 'NOMINEES_ONLY', designatedRecipients: [U.rohan.id, U.rohan.id, U.papa.id],
    identifierMask: 'Khata 482910244921', inNameMemberId: U.papa.id, inNameText: 'jointly with Sunita Sharma', nominee: 'Rohan Sharma',
    approxValue: '85,00,000', dueOn: '2027-03-31', note: 'Property tax is paid every March.' });
  ok('a house for "People I choose" is saved', r.status === 200 && !!r.id, JSON.stringify(r));
  houseId = r.id;
  const stored = (await rows('select * from legacy_asset_locators where id = $1', [houseId]))[0];
  ok('the people chosen are stored once each, without the owner', JSON.stringify(stored.designated_recipients) === JSON.stringify([U.rohan.id]), JSON.stringify(stored.designated_recipients));
  ok('a long number keeps only its last 4', stored.identifier_mask === 'Ending in ...4921', stored.identifier_mask);
  ok('the value is a whole number in the owner\'s currency', String(stored.approx_value) === '8500000' && stored.value_currency === 'INR', stored.approx_value + ' ' + stored.value_currency);

  const forRohan = await open(U.rohan, houseId);
  ok('the chosen person opens it and reads everything', forRohan.status === 200 && /blue file/.test(forRohan.entry.physical_location_notes)
     && forRohan.entry.nominee === 'Rohan Sharma' && forRohan.entry.in_name_member_name === 'Papa' && forRohan.entry.in_name_text === 'jointly with Sunita Sharma'
     && forRohan.entry.due_on === '2027-03-31' && /85,00,000/.test(forRohan.entry.value_text) && /March/.test(forRohan.entry.note), JSON.stringify(forRohan));
  ok('but is not told who else was chosen, and cannot manage it', forRohan.entry.can_manage === false && !('designated_recipients' in forRohan.entry) && !('seen_by' in forRohan.entry));

  for (const u of [U.meera, U.priya]) {
    const row = (await list(u)).locators.find(x => x.id === houseId);
    ok(u.name + ': sees a locked row with whose it is and the kind, nothing else', row && row.can_view === false && row.person_name === 'Papa' && row.kind_label === 'House or flat'
       && row.institution_or_item === null && row.identifier_mask === null && row.physical_location_notes === null
       && !/Indiranagar|almirah|4921|Sunita|March|8500000/.test(JSON.stringify(row)), JSON.stringify(row));
    const legacy = await call(book, { method: 'GET', token: u.token, query: { area: 'locator', circle: code, member: u.id } });
    ok(u.name + ': and the old list gives away no more', !/Indiranagar|almirah|4921|Sunita|March|8500000/.test(JSON.stringify(legacy)));
    const o = await open(u, houseId);
    ok(u.name + ': opening it is refused', o.status === 403 && o.locked === true && !o.entry && !/Indiranagar|almirah/.test(JSON.stringify(o)), JSON.stringify(o));
  }
  const brief = (await list(U.rohan)).locators.find(x => x.id === houseId);
  ok('the brief list carries the title but none of the details', brief && brief.institution_or_item === 'Flat in Indiranagar' && brief.has_details === false
     && !('physical_location_notes' in brief) && !('nominee' in brief) && !('approx_value' in brief), JSON.stringify(brief));
}

// ---- 5. the view log
{
  let v = await views(houseId);
  ok('Rohan opening it was written down once', v.length === 1 && v[0].viewer_id === U.rohan.id, JSON.stringify(v));
  await open(U.rohan, houseId); await open(U.rohan, houseId);
  ok('three opens on one day are one row', (await views(houseId)).length === 1);
  await list(U.rohan); await list(U.meera);
  ok('reading the brief list is not opening anything', (await views(houseId)).length === 1);
  await open(U.meera, houseId);
  ok('a refused open is not a view', (await views(houseId)).length === 1);
  await admin.query(`update legacy_asset_views set day = day - 1, at = at - interval '1 day' where locator_id = $1`, [houseId]);
  await open(U.rohan, houseId);
  v = await views(houseId);
  ok('the next day is a new row', v.length === 2 && v.every(x => x.viewer_id === U.rohan.id), JSON.stringify(v));
  await open(U.papa, houseId); await open(U.papa, houseId); await list(U.papa);
  await call(book, { method: 'GET', token: U.papa.token, query: { area: 'locator', circle: code, member: U.papa.id } });
  ok('the owner is never in the log, however he reads it', (await views(houseId)).every(x => x.viewer_id !== U.papa.id) && (await views(houseId)).length === 2);
  const own = await open(U.papa, houseId);
  ok('the owner reads "seen by Rohan" on the entry', own.status === 200 && own.entry.seen_by.length === 1 && own.entry.seen_by[0].name === 'Rohan' && !!own.entry.seen_by[0].at, JSON.stringify(own.entry.seen_by));
  const inList = (await list(U.papa)).locators.find(x => x.id === houseId);
  ok('and in his list', inList.seen_by.length === 1 && inList.seen_by[0].name === 'Rohan', JSON.stringify(inList.seen_by));
  const rohans = (await list(U.rohan)).locators.find(x => x.id === houseId);
  ok('nobody else is shown the log', !('seen_by' in rohans));
  // The old list sends details, so it counts as a view of each entry sent.
  await admin.query('delete from legacy_asset_views where locator_id = $1 and viewer_id = $2', [oldId, U.priya.id]);
  const before = (await views(oldId)).length;
  await call(book, { method: 'GET', token: U.priya.token, query: { area: 'locator', circle: code, member: U.priya.id } });
  const after = await views(oldId);
  ok('the old list, which sends details, writes a view for what it sent', after.length === before + 1 && after.some(x => x.viewer_id === U.priya.id), JSON.stringify(after));
  ok('and none for what it kept locked', !(await views(houseId)).some(x => x.viewer_id === U.priya.id));
}

// ---- 3. Only in an emergency
let emId;
{
  r = await add(U.rohan, { personId: U.papa.id, category: 'LOCKER_KEY', institutionOrItem: 'SBI locker', identifierMask: 'Locker #42',
    physicalLocationNotes: 'Key in the steel almirah, top shelf', unlockPolicy: 'EMERGENCY_ONLY' });
  emId = r.id;
  ok('an emergency-only entry, written by Rohan about Papa, is saved', r.status === 200 && !!emId, JSON.stringify(r));
  let o = await open(U.rohan, emId);
  ok('whoever wrote it reads it back, with the label as typed', o.status === 200 && o.entry.identifier_mask === 'Locker #42' && o.entry.can_manage === true, JSON.stringify(o));
  ok('and that visit is in the log: he is not the person it is about', (await views(emId)).some(x => x.viewer_id === U.rohan.id));
  o = await open(U.papa, emId);
  ok('the person it is about reads it too, and manages it', o.status === 200 && o.entry.can_manage === true && o.entry.seen_by.some(x => x.name === 'Rohan'), JSON.stringify(o));
  o = await open(U.meera, emId);
  ok('with no SOS, Meera cannot open it', o.status === 403 && o.locked === true, JSON.stringify(o));
  const s = await call(events, { token: U.papa.token, body: { code, memberId: U.papa.id, type: 'sos', lat: 28.6, lng: 77.2, accuracy: 20 } });
  o = await open(U.meera, emId);
  ok('while Papa has an SOS open, she can', s.status === 201 && o.status === 200 && /almirah/.test(o.entry.physical_location_notes), JSON.stringify(o));
  ok('and that is written down', (await views(emId)).some(x => x.viewer_id === U.meera.id));
  ok('his SOS does not open "Only me"', (await open(U.meera, onlyId)).status === 404);
  ok('nor "People I choose" for someone not chosen', (await open(U.meera, houseId)).status === 403);
  await call(events, { token: U.papa.token, body: { code, memberId: U.papa.id, type: 'sos_safe', sosId: s.sosId } });
  o = await open(U.meera, emId);
  ok('once he is safe, it is closed again', o.status === 403, JSON.stringify(o));
  const s2 = await call(events, { token: U.rohan.token, body: { code, memberId: U.rohan.id, type: 'sos', lat: 28.6, lng: 77.2, accuracy: 20 } });
  ok("someone else's SOS does not open Papa's entry", s2.status === 201 && (await open(U.meera, emId)).status === 403);
  await call(events, { token: U.rohan.token, body: { code, memberId: U.rohan.id, type: 'sos_safe', sosId: s2.sosId } });
}

// ---- an outsider from another family
{
  const asOther = (query) => call(book, { method: 'GET', token: other.token, query: { area: 'locator', ...query } });
  r = await asOther({ circle: code, member: other.id });
  ok("an outsider cannot list this family's register", r.status === 403 && !r.locators, JSON.stringify(r));
  r = await asOther({ circle: code, member: other.id, id: oldId });
  ok('nor open an entry by its id', r.status === 403 && !r.entry, JSON.stringify(r));
  r = await asOther({ circle: code, member: U.papa.id, id: oldId });
  ok("nor by sending a member's id with their own token", r.status === 403 && !r.entry, JSON.stringify(r));
  r = await asOther({ circle: other.code, member: other.id, id: oldId });
  ok('from their own family, the entry does not exist', r.status === 404 && !r.entry, JSON.stringify(r));
  r = await asOther({ circle: other.code, member: other.id });
  ok('and their own register is empty', r.status === 200 && r.locators.length === 0, JSON.stringify(r));
  for (const a of ['locator_update', 'locator_share', 'locator_remove']) {
    r = await call(book, { token: other.token, body: { code: other.code, memberId: other.id, action: a, id: oldId, ...base, unlockPolicy: 'IMMEDIATE' } });
    ok('an outsider: ' + a + ' finds nothing to change', r.status === 404, JSON.stringify(r));
    r = await call(book, { token: other.token, body: { code, memberId: U.papa.id, action: a, id: oldId, ...base, unlockPolicy: 'IMMEDIATE' } });
    ok('an outsider: ' + a + ' as Papa is refused', r.status === 403, JSON.stringify(r));
  }
  r = await call(book, { method: 'GET', query: { area: 'locator', circle: code, member: U.papa.id } });
  ok('with no token at all, nothing', r.status === 401 && !r.locators, JSON.stringify(r));
  ok('the outsider left no mark', (await rows('select 1 from legacy_asset_views where viewer_id = $1', [other.id])).length === 0);
}

// ---- 4. edit, change who sees it, remove
{
  const edit = { ...base, institutionOrItem: 'Flat in Indiranagar, 2nd floor', unlockPolicy: 'IMMEDIATE', nominee: 'Meera Sharma', approxValue: 9000000 };
  for (const u of [U.rohan, U.meera]) {
    r = await act(u, 'locator_update', { id: houseId, ...edit });
    ok(u.name + ' (not owner, not author) cannot edit the house', r.status === 403, JSON.stringify(r));
    r = await act(u, 'locator_share', { id: houseId, unlockPolicy: 'IMMEDIATE' });
    ok(u.name + ' cannot change who sees it', r.status === 403, JSON.stringify(r));
    r = await act(u, 'locator_remove', { id: houseId });
    ok(u.name + ' cannot remove it', r.status === 403, JSON.stringify(r));
  }
  let st = (await rows('select institution_or_item, unlock_policy from legacy_asset_locators where id = $1', [houseId]))[0];
  ok('and it is untouched', st.institution_or_item === 'Flat in Indiranagar' && st.unlock_policy === 'NOMINEES_ONLY', JSON.stringify(st));

  r = await act(U.papa, 'locator_update', { id: houseId, ...edit, unlockPolicy: 'NOPE' });
  ok('an edit with a bad rule is refused', r.status === 400 && /Choose who can see this/.test(r.error), JSON.stringify(r));
  r = await act(U.papa, 'locator_update', { id: houseId, ...edit, personId: U.meera.id });
  ok('the owner edits it', r.status === 200, JSON.stringify(r));
  st = (await rows('select * from legacy_asset_locators where id = $1', [houseId]))[0];
  ok('the new words, value and rule are stored, and whose it is did not move', st.institution_or_item === 'Flat in Indiranagar, 2nd floor' && st.nominee === 'Meera Sharma'
     && String(st.approx_value) === '9000000' && st.unlock_policy === 'IMMEDIATE' && st.person_id === U.papa.id, JSON.stringify(st));
  ok('what was left blank in the edit is cleared', st.in_name_text === null && st.note === null && st.due_on === null && JSON.stringify(st.designated_recipients) === '[]');
  ok('now the whole family opens it', (await open(U.meera, houseId)).status === 200);

  r = await act(U.papa, 'locator_share', { id: houseId, unlockPolicy: 'NOMINEES_ONLY', designatedRecipients: [U.priya.id] });
  ok('the owner changes who sees it to Priya alone', r.status === 200, JSON.stringify(r));
  ok('Priya opens it', (await open(U.priya, houseId)).status === 200);
  ok('Rohan, chosen before, no longer can', (await open(U.rohan, houseId)).status === 403);
  ok('the owner is told who is chosen now', JSON.stringify((await open(U.papa, houseId)).entry.designated_recipients) === JSON.stringify([U.priya.id]));
  r = await act(U.papa, 'locator_share', { id: houseId, unlockPolicy: 'ONLY_ME' });
  ok('and then to "Only me"', r.status === 200 && (await open(U.priya, houseId)).status === 404 && !(await list(U.priya)).locators.some(x => x.id === houseId), JSON.stringify(r));
  ok('the people chosen are forgotten with the rule', JSON.stringify((await rows('select designated_recipients from legacy_asset_locators where id = $1', [houseId]))[0].designated_recipients) === '[]');
  ok('the log of who had seen it stays for the owner', (await open(U.papa, houseId)).entry.seen_by.map(x => x.name).sort().join() === 'Meera,Priya,Rohan');

  // The author of an entry about someone else manages it too.
  r = await act(U.meera, 'locator_remove', { id: emId });
  ok('Meera cannot remove the entry Rohan wrote about Papa', r.status === 403, JSON.stringify(r));
  r = await act(U.rohan, 'locator_share', { id: emId, unlockPolicy: 'IMMEDIATE' });
  ok('its author can re-share it', r.status === 200, JSON.stringify(r));
  r = await act(U.rohan, 'locator_remove', { id: emId });
  ok('and remove it', r.status === 200 && (await rows('select 1 from legacy_asset_locators where id = $1', [emId])).length === 0, JSON.stringify(r));
  ok('its view log goes with it', (await views(emId)).length === 0);
  r = await act(U.rohan, 'locator_remove', { id: emId });
  ok('removing it twice says it is gone', r.status === 404, JSON.stringify(r));
  r = await act(U.papa, 'locator_remove', { id: houseId });
  ok('the owner removes the house', r.status === 200 && (await open(U.papa, houseId)).status === 404, JSON.stringify(r));
  r = await act(U.papa, 'locator_remove', { id: 'not-an-id' });
  ok('an id that is not an id is a plain "not here"', r.status === 404, JSON.stringify(r));
  const trail = (await rows(`select action from audit_events where resource = 'legacy_asset_locator' order by timestamp`)).map(x => x.action);
  ok('adds, edits, re-shares and removals are in the audit trail', ['add_asset_locator', 'edit_asset_locator', 'share_asset_locator', 'remove_asset_locator'].every(a => trail.includes(a)), trail.join());
}

// ---- 6. never a secret
{
  const count = async () => (await rows('select id from legacy_asset_locators')).length;
  const before = await count();
  const good = { ...base, unlockPolicy: 'ONLY_ME' };
  const tries = [
    ['a card number in the title', { institutionOrItem: 'HDFC card 4111 1111 1111 1111' }, /card number/],
    ['a card number in the number box', { identifierMask: '4111-1111-1111-1111' }, /card number/],
    ['a card number in where it is kept', { physicalLocationNotes: 'Card 4111111111111111 in the wallet' }, /card number/],
    ['a CVV in the note', { note: 'CVV 123 is on the back' }, /CVV/],
    ['an OTP in the nominee box', { nominee: 'OTP goes to Rohan' }, /OTP/],
    ['an ATM PIN in whose name it is in', { inNameText: 'atm pin with Maa' }, /PIN/],
    ['a net banking password in the label', { category: 'OTHER', customLabel: 'net banking password' }, /password/],
    ['a password written out', { category: 'DIGITAL_ACCOUNT', note: 'Gmail password: tiger@77' }, /never keeps a password/],
    ['a PIN written out', { physicalLocationNotes: 'Locker PIN is 4821' }, /never keeps a password or a PIN/]
  ];
  for (const [name, patch, why] of tries) {
    r = await add(U.papa, { ...good, ...patch });
    ok(name + ' is refused with a plain reason', r.status === 400 && why.test(r.error || '') && !/\bat \S+ \(|constraint|relation/.test(r.error), JSON.stringify(r));
  }
  ok('none of those was stored', (await count()) === before);
  r = await add(U.papa, { ...good, category: 'DIGITAL_ACCOUNT', institutionOrItem: 'Gmail', physicalLocationNotes: 'The password is in the red diary, second drawer. PIN code 560038.' });
  ok('where a password is kept is fine, and so is a postal PIN code', r.status === 200, JSON.stringify(r));
  const digId = r.id;
  r = await act(U.papa, 'locator_update', { id: digId, ...good, note: 'cvv 999' });
  ok('an edit cannot bring a secret in either', r.status === 400 && /CVV/.test(r.error), JSON.stringify(r));
  r = await add(U.papa, { ...good, category: 'INSURANCE', institutionOrItem: 'LIC policy', identifierMask: 'Policy 123456789' });
  const pol = (await rows('select identifier_mask from legacy_asset_locators where id = $1', [r.id]))[0];
  ok('a policy number keeps only its last 4', r.status === 200 && pol.identifier_mask === 'Ending in ...6789', JSON.stringify(pol));
  r = await add(U.papa, { ...good, category: 'OTHER', customLabel: 'x'.repeat(41) });
  ok('your own label over 40 letters is refused', r.status === 400 && /40/.test(r.error), JSON.stringify(r));
  r = await add(U.papa, { ...good, nominee: 'x'.repeat(81) });
  ok('a nominee over 80 letters is refused', r.status === 400 && /80/.test(r.error), JSON.stringify(r));
  r = await add(U.papa, { ...good, note: 'x'.repeat(501) });
  ok('a note over 500 letters is refused', r.status === 400 && /500/.test(r.error), JSON.stringify(r));
  r = await add(U.papa, { ...good, approxValue: 'about ten lakh' });
  ok('a value that is not a number is refused', r.status === 400 && /whole number/.test(r.error), JSON.stringify(r));
  r = await add(U.papa, { ...good, dueOn: '2027-02-30' });
  ok('a date that does not exist is refused', r.status === 400 && /calendar/.test(r.error), JSON.stringify(r));
  r = await add(U.papa, { ...good, institutionOrItem: '   ' });
  ok('no title is refused', r.status === 400 && /what it is/.test(r.error), JSON.stringify(r));
  r = await add(U.papa, { ...good, category: 'OTHER', customLabel: "Dadi's sewing machine", institutionOrItem: 'Usha machine' });
  const custom = (await list(U.papa)).locators.find(x => x.id === r.id);
  ok('"Anything else" carries the person\'s own label', r.status === 200 && custom.kind_label === "Dadi's sewing machine", JSON.stringify(custom));
  r = await add(U.papa, { ...good, category: 'MADE_UP_KIND', institutionOrItem: 'Odd thing' });
  ok('a kind nobody knows is kept as "Anything else", as before', r.status === 200 && (await rows('select asset_category from legacy_asset_locators where id = $1', [r.id]))[0].asset_category === 'OTHER', JSON.stringify(r));
}

// ---- the person filter on the server, and a first load that races
{
  await add(U.rohan, { personId: U.rohan.id, category: 'VEHICLE', institutionOrItem: 'Scooter', physicalLocationNotes: 'RC book in the bag', unlockPolicy: 'IMMEDIATE' });
  const only = (await list(U.meera, { person: U.rohan.id })).locators;
  ok('the list can be asked for one person', only.length === 1 && only[0].institution_or_item === 'Scooter', JSON.stringify(only));
  const many = await Promise.all([U.papa, U.rohan, U.meera, U.priya, U.papa, U.rohan].map(u => list(u)));
  ok('six loads at once all answer', many.every(x => x.status === 200), many.map(x => x.status).join());
  r = await call(book, { method: 'PUT', token: U.papa.token, query: { area: 'locator' }, body: { code, memberId: U.papa.id } });
  ok('a method it does not know is refused, not left hanging', r.status === 405, JSON.stringify(r));
}

// ---- the independent review of 2026-11-11: each finding, kept fixed
{
  // Rohan writes an entry about Papa; Papa makes it his alone. Rohan can
  // still read what he wrote, but cannot widen it again.
  const a = await add(U.rohan, { ...base, institutionOrItem: 'Plot in Mysuru', unlockPolicy: 'IMMEDIATE' });
  ok('review: Papa makes an entry about him his alone', (await act(U.papa, 'locator_share', { id: a.id, unlockPolicy: 'ONLY_ME' })).status === 200);
  const widen = await act(U.rohan, 'locator_share', { id: a.id, unlockPolicy: 'IMMEDIATE' });
  ok('review: whoever wrote it cannot widen it again', widen.status === 403 && /person it is about/.test(widen.error || ''), JSON.stringify(widen));
  ok('review: but can still read what they wrote', (await open(U.rohan, a.id)).status === 200);
  ok('review: and Papa can widen it himself', (await act(U.papa, 'locator_share', { id: a.id, unlockPolicy: 'ONLY_ME' })).status === 200);

  // The audit list says nothing about an entry that is someone's alone.
  const audit = (u) => call(book, { method: 'GET', token: u.token, query: { area: 'audit', circle: code, member: u.id } });
  const seen = (j) => (j.events || []).filter(e => e.resource === 'legacy_asset_locator' && e.resource_id === a.id).length;
  const am = await audit(U.meera), ap = await audit(U.papa), ar = await audit(U.rohan);
  ok('review: the audit list does not tell Meera an "Only me" entry exists', am.status === 200 && seen(am) === 0, String(seen(am)));
  ok('review: Papa and Rohan, who can read it, still see its history', seen(ap) > 0 && seen(ar) > 0, seen(ap) + '/' + seen(ar));

  // Someone not on Parwah can never press SOS: "Only in an emergency"
  // about them would never open, so it is refused with what to pick.
  const dadi = (await rows(`insert into members (circle_id, name, role) select id, 'Dadi', 'parent' from circles where code = $1 returning id`, [code]))[0].id;
  const em = await add(U.rohan, { ...base, personId: dadi, institutionOrItem: 'Dadi gold', category: 'GOLD', unlockPolicy: 'EMERGENCY_ONLY' });
  ok('review: "Only in an emergency" about someone not on Parwah is refused, with what to pick', em.status === 400 && /not on Parwah/.test(em.error || '') && /People I choose/.test(em.error || ''), JSON.stringify(em));
  ok('review: the same entry as "People I choose" is fine', (await add(U.rohan, { ...base, personId: dadi, institutionOrItem: 'Dadi gold', category: 'GOLD', unlockPolicy: 'NOMINEES_ONLY', designatedRecipients: [U.meera.id] })).status === 200);
  // For someone not on Parwah, whoever wrote it is the only one who can manage it at all.
  const solo = await add(U.rohan, { ...base, personId: dadi, institutionOrItem: 'Dadi pension book', unlockPolicy: 'ONLY_ME' });
  ok('review: an "Only me" entry about someone not on Parwah can still be re-shared by whoever wrote it', (await act(U.rohan, 'locator_share', { id: solo.id, unlockPolicy: 'IMMEDIATE' })).status === 200);

  // An account number that happens to pass the card check is an account
  // number: it is kept as its last four, not refused.
  const luhnOk = '50100234567128';   // 14 digits, passes the card check by chance
  const acct = await add(U.papa, { ...base, unlockPolicy: 'IMMEDIATE', institutionOrItem: 'HDFC savings', category: 'BANK_ACCOUNT', identifierMask: luhnOk });
  const got = acct.id ? await open(U.papa, acct.id) : {};
  ok('review: a long account number is kept as its last four, never refused as a card', acct.status === 200 && JSON.stringify(got).includes('7128') && !JSON.stringify(got).includes(luhnOk), JSON.stringify(acct));
  ok('review: a card number in the note is still refused', (await add(U.papa, { ...base, unlockPolicy: 'IMMEDIATE', institutionOrItem: 'Card', note: 'card 4111 1111 1111 1111' })).status === 400);

  // A password phrased any way is refused; where it is kept is fine.
  for (const t of ['password is Tiger@77', 'Password - Tiger@77', 'pwd Tiger@77', 'Netbanking pass: Tiger@77', 'login: rohan / Tiger@77']) {
    const bad = await add(U.papa, { ...base, unlockPolicy: 'IMMEDIATE', institutionOrItem: 'Net banking', note: t });
    ok('review: refused in a note: ' + t, bad.status === 400 && /never keeps a password/.test(bad.error || ''), JSON.stringify(bad));
  }
  ok('review: where the password is kept is fine', (await add(U.papa, { ...base, unlockPolicy: 'IMMEDIATE', institutionOrItem: 'Net banking', note: 'The password is in the red diary' })).status === 200);
}

globalThis.fetch = realFetch;
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`famregister.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
