// THE AUDIT'S SERVER FINDINGS, AGAINST A REAL DATABASE: each one tried the
// way a family meets it, so it cannot quietly come back.
//
//   - the care tools answered 503 on a fresh database (no family_book yet);
//   - a profile number already used by another account half-saved;
//   - Ekta in a chat read the whole transcript as the question: asked about
//     Papa she answered about Rohan, and an old "chest pain" set off an
//     emergency reply; photos went to the model as base64;
//   - every horoscope sign was blank (the driver returns a date as a Date),
//     and a feed that was down showed twelve "Not available today." rows;
//   - "When I'm Not Here": the author could not see their own entry, an
//     unknown policy was stored as "everyone, now", and "only in an
//     emergency" never opened during an SOS;
//   - a biomarker could be written onto another family's member;
//   - $29.99 was reserved as 30;
//   - every PIN code lookup was refused as "too many";
//   - editing the time of a daily task moved only that day;
//   - the timer ran for anyone, before its limit.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_test npm run test:db
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('fixes.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('fixes.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
// Ekta with no key at all: she answers from the records, with no model.
for (const k of Object.keys(process.env)) if (/^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|GROQ|MISTRAL|DEEPSEEK|XAI|TWILIO|CRON_SECRET)/.test(k)) delete process.env[k];
// Nothing here may reach the internet: horoscopes and India Post answer
// from this stub.
const realFetch = globalThis.fetch;
let pinCalls = 0;
globalThis.fetch = async (u) => {
  if (/postalpincode|pincode/i.test(String(u))) {
    pinCalls++;
    return { ok: true, status: 200, json: async () => ([{ Status: 'Success', PostOffice: [{ Name: 'Connaught Place', District: 'New Delhi', State: 'Delhi', Block: 'New Delhi' }] }]) };
  }
  throw new Error('offline in this test');
};

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: auth } = await import('../../../api/auth.mjs');
const { default: circle } = await import('../../../api/circle.mjs');
const { default: care } = await import('../../../api/care.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { default: settings } = await import('../../../api/settings.mjs');
const { default: chats } = await import('../../../api/chats.mjs');
const { default: events } = await import('../../../api/events.mjs');
const { default: plans } = await import('../../../api/plans.mjs');
const { default: games } = await import('../../../api/games.mjs');

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
const rows = async (text, args) => { try { return (await admin.query(text, args)).rows; } catch (e) { return []; } };

// ---- S4: the care tools on a database where nothing exists yet
{
  const r = await call(care, { method: 'GET', query: { area: 'refill', circle: 'NOPE42', member: '00000000-0000-4000-8000-000000000000' } });
  ok('a fresh database: the refill screen answers, it does not 503', r.status !== 503, JSON.stringify(r));
}

async function signUp(phone, name, pin) {
  const r = await call(auth, { body: { action: 'enter', phone, cc: '+91', name, pin } });
  if (!r.token) throw new Error('sign-up failed for ' + name + ': ' + JSON.stringify(r));
  return { userId: r.user.id, token: r.token, phone: '+91' + phone };
}
const U = { papa: await signUp('9850000001', 'Papa', '4829'), rohan: await signUp('9850000002', 'Rohan', '7351'), meera: await signUp('9850000003', 'Meera', '6142') };
let r = await call(circle, { token: U.papa.token, body: { action: 'create', kind: 'family', memberName: 'Papa', circleName: 'Sharma', userId: U.papa.userId, role: 'parent', relation: 'father' } });
const code = r.code; U.papa.id = r.memberId;
await call(circle, { token: U.papa.token, body: { action: 'set_join_policy', code, memberId: U.papa.id, policy: 'open' } });
for (const k of ['rohan', 'meera']) {
  const j = await call(circle, { token: U[k].token, body: { action: 'join', code, memberName: k[0].toUpperCase() + k.slice(1), userId: U[k].userId, role: 'family', relation: k === 'rohan' ? 'son' : 'daughter' } });
  U[k].id = j.memberId;
}
// Another family, for the cross-family checks.
const other = await signUp('9850000009', 'Kamla', '5937');
r = await call(circle, { token: other.token, body: { action: 'create', kind: 'family', memberName: 'Kamla', circleName: 'Gupta', userId: other.userId, role: 'family' } });
other.id = r.memberId; other.code = r.code;
ok('setup: three in the Sharma family, one in the Guptas', U.papa.id && U.rohan.id && U.meera.id && other.id);

// ---- S4: the first location loads, all at once on a fresh table set
{
  const many = await Promise.all([U.papa, U.rohan, U.meera, U.papa, U.rohan, U.meera].map(u =>
    call(settings, { method: 'GET', token: u.token, query: { area: 'location', circle: code, member: u.id } })));
  ok('six first location loads at once: none is a 503', many.every(x => x.status === 200), many.map(x => x.status).join());
}

// ---- 2: a number already registered to someone else is refused up front
{
  r = await call(circle, { token: U.rohan.token, body: { action: 'update_member', code, memberId: U.rohan.id, phone: '9850000001', phoneCc: '+91' } });
  ok("Rohan cannot take Papa's sign-in number", r.status === 409 && r.error === 'That number is already registered to another profile', JSON.stringify(r));
  const m = (await rows('select phone from members where id = $1', [U.rohan.id]))[0];
  ok('and nothing was half-saved', m && m.phone === U.rohan.phone, JSON.stringify(m));
  r = await call(circle, { token: U.rohan.token, body: { action: 'update_member', code, memberId: U.rohan.id, phone: '9850000044', phoneCc: '+91' } });
  ok('a number nobody has is still fine', r.status === 200 && r.phone === '+919850000044', JSON.stringify(r));
}

// ---- 3: Ekta in the family chat, with no AI key
{
  // Health & contacts opened once, as the app does, so the table exists.
  await call(book, { method: 'GET', token: U.rohan.token, query: { circle: code, member: U.rohan.id } });
  await rows(`insert into family_book (circle_id, kind, name, category, about_member) select circle_id, 'fact', 'B+', 'blood', id from members where id = $1`, [U.papa.id]);
  await rows(`insert into family_book (circle_id, kind, name, category, about_member) select circle_id, 'fact', 'O-', 'blood', id from members where id = $1`, [U.rohan.id]);
  const list = await call(chats, { method: 'GET', token: U.rohan.token, query: { circle: code, member: U.rohan.id } });
  const chatId = list.chats && list.chats[0] && list.chats[0].id;
  const send = (u, text, kind) => call(chats, { token: u.token, body: { code, memberId: u.id, action: 'send', chatId, text, kind } });
  await send(U.rohan, 'Rohan here, Papa had chest pain last week but he is fine now');
  await send(U.meera, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'image');
  const asked = await send(U.meera, "@Ekta what is Papa's blood group?");
  const last = (await rows(`select text from messages where chat_id = $1 and member_id is null order by created_at desc limit 1`, [chatId]))[0];
  const said = last ? last.text : '';
  ok('Ekta answers in the chat', asked.status === 201 && asked.ekta === true && !!said, JSON.stringify(asked));
  ok("about Papa's blood group: B+", /B\+/.test(said), said);
  ok('not Rohan\'s, though Rohan is the longest name in the chat', !/O-/.test(said) && !/Rohan's/.test(said), said);
  ok('and an old "chest pain" does not make a routine question an emergency', asked.ektaEmergency === false && !/sounds urgent/i.test(said), said);
  const sos = await send(U.meera, '@Ekta Papa gir gaye hain, uth nahi rahe');
  const last2 = (await rows(`select text from messages where chat_id = $1 and member_id is null order by created_at desc limit 1`, [chatId]))[0];
  ok('a fall said in Hinglish now is an emergency, with the flag for the Call and SOS buttons', sos.ektaEmergency === true && /112/.test(last2 && last2.text), JSON.stringify(sos) + ' ' + (last2 && last2.text));

  const { ektaChatTurns } = await import('../../../api/chats.mjs');
  const turns = !ektaChatTurns ? [{ content: '' }] : ektaChatTurns('Everyone', 'family', [
    { name: 'Rohan', text: 'Papa had chest pain last week', kind: 'text' },
    { name: 'Meera', text: 'data:image/png;base64,AAAA', kind: 'image' },
    { name: 'Meera', text: "@Ekta what is Papa's blood group?", kind: 'text' }], "@Ekta what is Papa's blood group?");
  ok('the question is the latest message alone, without her name', turns[turns.length - 1].content === "what is Papa's blood group?", JSON.stringify(turns[turns.length - 1]));
  ok('the earlier messages are context in their own turn', turns.length === 3 && /chest pain/.test(turns[0].content) && turns[1].role === 'assistant');
  ok('a photo is "[photo]", never its bytes', /Meera: \[photo\]/.test(turns[0].content) && !/base64/.test(JSON.stringify(turns)));
}

// ---- 6: horoscopes, with a date of birth from the database
{
  await admin.query(`update members set dob = '1990-05-14' where id = $1`, [U.papa.id]);
  const d = await call(settings, { method: 'GET', token: U.papa.token, query: { area: 'day', circle: code, member: U.papa.id } });
  const p = (d.people || []).find(x => x.name === 'Papa');
  ok("Papa's sign is read from his date of birth", p && p.sign === 'taurus', JSON.stringify(p));
  ok('and his own sign is shown', d.mySign && d.mySign.key === 'taurus', JSON.stringify(d.mySign));
  ok('the feed being down is one flag, not twelve blank rows', d.horoscope && d.horoscope.feedDown === true && d.horoscope.unavailable === 12, JSON.stringify(d.horoscope && { feedDown: d.horoscope.feedDown, unavailable: d.horoscope.unavailable }));
  ok('and there is always a period named now', d.status === 200 && 'currentFromLastNight' in d, Object.keys(d).join());
}

// ---- 8: "When I'm Not Here"
{
  const add = (u, body) => call(book, { token: u.token, body: { code, memberId: u.id, action: 'locator_add', ...body } });
  const look = async (u) => (await call(book, { method: 'GET', token: u.token, query: { area: 'locator', circle: code, member: u.id } })).locators || [];
  const entry = { personId: U.papa.id, category: 'LOCKER_KEY', institutionOrItem: 'SBI locker', identifierMask: 'Locker #42',
                  physicalLocationNotes: 'Key in the steel almirah, top shelf', unlockPolicy: 'EMERGENCY_ONLY' };
  r = await add(U.rohan, { ...entry, unlockPolicy: 'EVERYONE' });
  ok('a policy that is not one of the three is refused, not stored as "now"', r.status === 400 && /Choose who can see this/.test(r.error || ''), JSON.stringify(r));
  ok('and nothing was stored', (await rows('select id from legacy_asset_locators')).length === 0);
  r = await add(U.rohan, { ...entry, personId: other.id });
  ok("an entry about another family's member is refused", r.status === 403, JSON.stringify(r));
  r = await add(U.rohan, entry);
  ok('a real entry is saved', r.status === 200 && !!r.id, JSON.stringify(r));
  const savedId = r.id;
  const pick = (list) => list.find(x => x.id === savedId);
  let mine = pick(await look(U.rohan));
  ok('the person who wrote it can always see it', mine && mine.can_view === true && /almirah/.test(mine.physical_location_notes), JSON.stringify(mine));
  ok('with the number as typed', mine && mine.identifier_mask === 'Locker #42', mine && mine.identifier_mask);
  let hers = pick(await look(U.meera));
  ok('someone else sees it is there, but not where, with no SOS', hers && hers.can_view === false && !/almirah/.test(hers.physical_location_notes) && hers.identifier_mask !== 'Locker #42', JSON.stringify(hers));
  const s = await call(events, { token: U.papa.token, body: { code, memberId: U.papa.id, type: 'sos', lat: 28.6, lng: 77.2, accuracy: 20 } });
  hers = pick(await look(U.meera));
  ok('while Papa has an SOS open, the family can see it', s.status === 201 && hers && hers.can_view === true && /almirah/.test(hers.physical_location_notes), JSON.stringify(hers));
  await call(events, { token: U.papa.token, body: { code, memberId: U.papa.id, type: 'sos_safe', sosId: s.sosId } });
  hers = pick(await look(U.meera));
  ok('and not once it is closed', hers && hers.can_view === false, JSON.stringify(hers));
}

// ---- 9: biomarkers, the contract the app must use
{
  const save = (body) => call(book, { token: U.rohan.token, body: { code, memberId: U.rohan.id, action: 'biomarker_save', ...body } });
  r = await save({ personId: other.id, items: [{ biomarker_type: 'HBA1C', value: 6.1 }] });
  ok("a reading cannot be written onto another family's member", r.status === 403, JSON.stringify(r));
  r = await save({ personId: U.papa.id, items: [{ biomarker_type: 'MADE_UP', value: 6.1 }] });
  ok('an unknown test is refused', r.status === 400, JSON.stringify(r));
  r = await save({ personId: U.papa.id, items: [{ biomarker_type: 'HBA1C', value: 'abc' }] });
  ok('a value that is not a number is refused', r.status === 400, JSON.stringify(r));
  r = await save({ personId: U.papa.id, items: [{ biomarker_type: 'HBA1C', value: 6.1 }], testDate: '2026-10-01', labName: 'City Lab' });
  ok('a real reading is saved', r.status === 200 && r.saved_count === 1, JSON.stringify(r));
  const g = await call(book, { method: 'GET', token: U.rohan.token, query: { area: 'biomarkers', circle: code, member: U.rohan.id, person: U.papa.id } });
  ok('and read back for Papa', g.status === 200 && (g.records || []).length === 1 && Number(g.records[0].value) === 6.1, JSON.stringify(g.records));
  const p = await call(book, { method: 'GET', token: U.rohan.token, query: { area: 'preauth', circle: code, member: U.rohan.id, person: other.id } });
  ok("the hospital packet will not read another family's member", p.status === 403, JSON.stringify(p).slice(0, 200));
}

// ---- 10: the plan, to the cent
{
  r = await call(settings, { token: U.rohan.token, query: { area: 'plan' }, body: { code, memberId: U.rohan.id, action: 'reserve', plan: 'care', currency: 'USD' } });
  ok('reserving in dollars returns the exact amount', r.status === 201 && r.amount === 29.99, JSON.stringify(r));
  const g = await call(settings, { method: 'GET', token: U.rohan.token, query: { area: 'plan', circle: code, member: U.rohan.id } });
  ok('and the confirmation reads $29.99, not $30', g.mine && g.mine.amount === 29.99, JSON.stringify(g.mine));
  ok('the paid plan lists what it adds', JSON.stringify(g.plans && g.plans.care && g.plans.care.includes) === JSON.stringify(['Everything in the free plan', 'Priority help', 'Supporting Parwah']));
}

// ---- S1: a PIN code lookup is answered
{
  r = await call(settings, { method: 'GET', token: U.papa.token, query: { area: 'pin', circle: code, member: U.papa.id, pin: '110001' } });
  ok('the first PIN lookup is not "too many"', r.status === 200, JSON.stringify(r));
}

// ---- S2: moving the time of a daily task moves the series
{
  const IN = 'Asia/Kolkata';
  const tomorrow = new Date(Date.now() + 86400000);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: IN }).format(tomorrow);
  const at = (hm) => new Date(day + 'T' + hm + ':00+05:30').toISOString();
  const act = (u, action, body) => call(care, { token: u.token, body: { code, memberId: u.id, action, ...body } });
  const t = await act(U.meera, 'task_create', { title: 'Papa\'s walk', ownerId: 'me', recurrence: 'daily', dueAt: at('09:00'), tz: IN });
  const e = await act(U.meera, 'task_edit', { taskId: t.id, dueAt: at('10:30'), tz: IN });
  const d = await act(U.meera, 'task_done', { taskId: t.id });
  const next = (await rows(`select due_at from requests where series_id = (select series_id from requests where id = $1) and id <> $1 order by due_at desc limit 1`, [t.id]))[0];
  const hh = next ? new Intl.DateTimeFormat('en-GB', { timeZone: IN, hour: '2-digit', minute: '2-digit' }).format(new Date(next.due_at)) : null;
  ok('daily 09:00 moved to 10:30: the next one is at 10:30', !!t.id && e.ok && d.ok && hh === '10:30', [t.id, e.ok, d.ok, hh].join(' '));
}

// ---- call rooms: nothing about the family, nothing to guess
{
  const room = /^https:\/\/meet\.jit\.si\/parwah-[0-9a-f]{32}$/;
  const at = new Date(Date.now() + 3 * 86400000).toISOString();
  const p = await call(plans, { token: U.rohan.token, body: { code, memberId: U.rohan.id, action: 'create', title: 'Sunday call', kind: 'call', at } });
  const pr = (await rows('select room from plans where id = $1', [p.planId || p.id]))[0] || (await rows(`select room from plans where title = 'Sunday call'`))[0];
  ok('a plan call room is 128 random bits, without the family code', pr && room.test(pr.room) && !pr.room.toLowerCase().includes(code.toLowerCase()), pr && pr.room);
  const g = await call(games, { token: U.rohan.token, body: { code, memberId: U.rohan.id, action: 'start_antakshari', mode: 'call' } });
  const gr = JSON.stringify(g).match(/https:\/\/meet\.jit\.si\/[^"\\]*/);
  ok('so is a game call room', gr && room.test(gr[0]) && !gr[0].toLowerCase().includes(code.toLowerCase()), gr ? gr[0] : JSON.stringify(g).slice(0, 200));
}

// ---- the vault says how many family papers this person may open
{
  const v = await call(book, { method: 'GET', token: U.meera.token, query: { area: 'vault', circle: code, member: U.meera.id } });
  ok('the vault reply counts the family papers shared with you', v.status === 200 && v.familyDocs === 0, JSON.stringify({ s: v.status, f: v.familyDocs }));
}

// ---- T1: the timer's key
{
  process.env.CRON_SECRET = 'tick-secret-for-tests';
  r = await call(events, { method: 'GET', query: { tick: '1' } });
  ok('with a key set, a tick without it is refused', r.status === 401, JSON.stringify(r));
  await admin.query(`delete from rate_limit where bucket = 'tick'`);
  r = await call(events, { method: 'GET', query: { tick: '1' }, headers: { 'x-cron-secret': 'tick-secret-for-tests' } });
  ok('and runs with it', r.status === 200 && r.ok, JSON.stringify(r));
  await admin.query(`delete from rate_limit where bucket = 'tick'`);
  r = await call(events, { method: 'GET', query: { tick: '1' }, headers: { authorization: 'Bearer tick-secret-for-tests' } });
  ok('or as a Bearer token', r.status === 200 && r.ok, JSON.stringify(r));
  delete process.env.CRON_SECRET;
  await admin.query(`delete from rate_limit where bucket = 'tick'`);
  r = await call(events, { method: 'GET', query: { tick: '1' } });
  ok('with no key set it runs as before', r.status === 200 && r.ok, JSON.stringify(r));
}

globalThis.fetch = realFetch;
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`fixes.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
