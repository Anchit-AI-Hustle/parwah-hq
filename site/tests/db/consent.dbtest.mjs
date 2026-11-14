// CONSENT, CONTROL AND CARE BOTH WAYS against a real database, through the
// real handlers (/api/settings, /api/care, /api/events, /api/chats,
// /api/book) and the real timer.
//
// What it proves:
//   B1 location: arrivals are announced only for a person who said yes on
//      their own phone; "Ask to share" has a "Not now" that mutes that asker
//      for 7 days; other people's positions leave the server only on a look,
//      and the look is written down for the person to see; a position older
//      than 5 minutes is not "live".
//   B2 call rota: the person who is called is told, chooses the time, and
//      can say "No daily call, thank you"; nobody else can do either.
//   B3 costs: the ledger is read by the people who pay; the person cared for
//      reads only what they paid until they turn on "Show me the costs"; a
//      child reads nothing; no amount goes in the feed.
//   B4 home staff: one named owner hears a late alert, never the feed; a day
//      off marked ahead is skipped; salary and advances are for adults.
//   B5 a child's standing: audienceFor leaves a minor out of the frightening
//      and the money kinds, keeps them in the warm ones, and never includes
//      someone remembered or someone not on Parwah.
//   B6 Ashirwad and "How is your day?": a card is read by the person it is
//      for and the sender; one answer each; voice notes are checked.
//   B7 Reached safely: only the people chosen see a trip; the ask to call is
//      claimed once, 30 minutes after the expected time, by the real timer.
//   B8 the emergency card: the person, the adults they chose, the adults
//      during an SOS; never a child, never a remembered person.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('consent.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('consent.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const api = {};
for (const n of ['circle', 'events', 'book', 'chats', 'care', 'settings']) api[n] = (await import(`../../../api/${n}.mjs`)).default;
const { runTick } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const Aud = await import('../../../api/_audience.mjs');
const Ash = await import('../../../api/_ashirwad.mjs');
const Staff = await import('../../../api/_staff.mjs');
const Ec = await import('../../../api/_ecard.mjs');
const Rules = await import('../../../api/_consentrules.mjs');
const sql = db();
await ensureSchema(sql);
await Aud.ensureAudienceSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

let n = 0;
async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-parwah-tz': 'Asia/Kolkata', 'x-forwarded-for': '10.9.' + (++n % 250) + '.' + (n % 199) }, query, body };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...(json || {}), status };
}
async function user(name) {
  const phone = '+9198440' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}
async function family(circleName, names) {
  const out = {}; let code = null, circleId = null;
  for (const item of names) {
    const [name, role] = Array.isArray(item) ? item : [item, 'family'];
    const u = await user(name);
    const r = code
      ? await call(api.circle, { token: u.token, body: { action: 'join', code, memberName: name, userId: u.userId, role } })
      : await call(api.circle, { token: u.token, body: { action: 'create', kind: 'family', memberName: name, circleName, userId: u.userId, role } });
    if (!code) { code = r.code; circleId = (await admin.query('select id from circles where code = $1', [code])).rows[0].id; await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]); }
    out[name] = { ...u, id: r.memberId, code };
  }
  return { code, id: circleId, m: out };
}
const F = await family('Sharma Family', ['Rohan', 'Meera', ['Papa', 'parent'], 'Chintu', 'Tara']);
const { Rohan: rohan, Meera: meera, Papa: papa, Chintu: chintu, Tara: tara } = F.m;
const O = await family('Other Family', ['Stranger']);
const stranger = O.m.Stranger;
// Dadi is in the tree by name (not on Parwah); Dadaji is remembered.
const byName = async (name) => (await call(api.circle, { token: rohan.token, body: { action: 'add_person', code: F.code, memberId: rohan.id, personName: name, place: 'parent', ofId: papa.id, gender: name === 'Dadi' ? 'f' : 'm' } })).memberId;
const dadi = await byName('Dadi'), dadaji = await byName('Dadaji');
await admin.query(`update members set remembered = true where id = $1`, [dadaji]);
await admin.query(`update members set dob = '2012-05-05' where id = $1`, [chintu.id]);            // 14: a child by date of birth
await admin.query(`update members set dob = '1988-03-03', phone = '+919811100001' where id = $1`, [meera.id]);
await admin.query(`update members set dob = '1986-01-01', phone = '+919811100002' where id = $1`, [rohan.id]);
ok('the family is made through the real API', !!rohan.id && !!papa.id && !!dadi && !!dadaji);

const post = (h, who, body) => call(api[h], { token: who.token, body: { code: who.code, memberId: who.id, ...body } });
const get = (h, who, query) => call(api[h], { method: 'GET', token: who.token, query: { circle: who.code, member: who.id, ...query } });
const said = async (like) => (await admin.query(`select text from events where circle_id = $1 and text like $2 order by created_at`, [F.id, like])).rows.map(r => r.text);

// ===================================================== B5: a child's standing
{
  let r = await post('chats', rohan, { area: 'ashirwad', action: 'standing_set', targetId: tara.id, child: true });
  ok('an adult marks Tara, who has no date of birth on file, as a child', r.status === 200 && r.child === true, JSON.stringify(r));
  ok('a child cannot mark anyone', (await post('chats', chintu, { area: 'ashirwad', action: 'standing_set', targetId: papa.id, child: true })).status === 403);
  ok('nobody marks themself', (await post('chats', rohan, { area: 'ashirwad', action: 'standing_set', targetId: rohan.id, child: true })).status === 400);
  r = await post('chats', rohan, { area: 'ashirwad', action: 'standing_set', targetId: meera.id, child: true });
  ok('an adult by date of birth cannot be marked as a child', r.status === 409 && (await admin.query('select is_child from members where id = $1', [meera.id])).rows[0].is_child === false, JSON.stringify(r));
  ok('a stranger cannot mark anyone', (await call(api.chats, { token: stranger.token, body: { area: 'ashirwad', code: F.code, memberId: rohan.id, action: 'standing_set', targetId: tara.id, child: false } })).status === 403);

  const aud = (kind, opts) => Aud.audienceFor(sql, F.id, kind, opts);
  const adults = [rohan.id, meera.id, papa.id].sort(), everyone = [rohan.id, meera.id, papa.id, chintu.id, tara.id].sort();
  for (const k of Rules.ADULT_ONLY_KINDS) {
    const got = (await aud(k)).sort();
    ok('audienceFor(' + k + ') is the adults on Parwah, and nobody else', JSON.stringify(got) === JSON.stringify(adults), JSON.stringify(got));
  }
  for (const k of Rules.WARM_KINDS) {
    const got = (await aud(k)).sort();
    ok('audienceFor(' + k + ') keeps the children in', JSON.stringify(got) === JSON.stringify(everyone), JSON.stringify(got));
  }
  ok('a kind nobody listed reaches adults only', JSON.stringify((await aud('brand_new_alert')).sort()) === JSON.stringify(adults));
  ok('someone remembered and someone not on Parwah are in no audience', !(await aud('card')).includes(dadaji) && !(await aud('card')).includes(dadi));
  ok('"except" leaves one person out', !(await aud('card', { except: rohan.id })).includes(rohan.id));
  ok('"only" cannot bring a child into an adult-only audience', (await aud('costs', { only: [chintu.id, tara.id, meera.id] })).join() === meera.id);
  ok('"only" cannot bring in someone remembered', (await aud('card', { only: [dadaji, dadi] })).length === 0);
  ok('minorOf agrees', await Aud.minorOf(sql, F.id, chintu.id) && await Aud.minorOf(sql, F.id, tara.id) && !(await Aud.minorOf(sql, F.id, papa.id)));
  ok('pushAudience says how many people it was for', (await Aud.pushAudience(sql, F.id, 'missed_dose', { title: 't', body: 'b' })) === 3
     && (await Aud.pushAudience(sql, F.id, 'card', { title: 't', body: 'b' }, { except: rohan.id })) === 4);

  // The family safe word.
  ok('Meera sets the safe word', (await post('events', meera, { type: 'safeword_set', word: 'Gulab jamun' })).status < 300);
  ok('an adult reads it', (await get('events', rohan)).familyCare.safeWord === 'Gulab jamun');
  const kid = await get('events', chintu), kid2 = await get('events', tara);
  ok('a child by date of birth is not sent it', kid.status === 200 && kid.familyCare && kid.familyCare.safeWord === null && !/Gulab jamun/.test(JSON.stringify(kid)), JSON.stringify(kid.familyCare && kid.familyCare.safeWord));
  ok('nor a child marked by an adult', kid2.familyCare.safeWord === null && !/Gulab jamun/.test(JSON.stringify(kid2)));

  // "Only in an emergency" entries of the family register.
  const add = await post('book', papa, { action: 'locator_add', personId: papa.id, category: 'HOUSE', institutionOrItem: 'Flat papers', physicalLocationNotes: 'Blue file, steel almirah', unlockPolicy: 'EMERGENCY_ONLY' });
  ok('Papa writes an entry for an emergency only', add.status < 300 && !!add.id, JSON.stringify(add));
  await admin.query(`insert into sos (circle_id, member_id, status) values ($1, $2, 'open')`, [F.id, papa.id]);
  const open = (who) => get('book', who, { area: 'locator', id: add.id });
  ok('during Papa\'s SOS an adult can open it', (await open(rohan)).status === 200);
  const co = await open(chintu);
  ok('a child cannot, and is sent none of it', co.status === 403 && !/almirah|Flat papers/.test(JSON.stringify(co)), JSON.stringify(co));
  await admin.query(`update sos set status = 'resolved' where circle_id = $1`, [F.id]);
}

// ============================================================ B1: location
{
  const loc = (who, body) => post('settings', who, body), q = { area: 'location' };
  const look = (who) => call(api.settings, { method: 'GET', token: who.token, query: { area: 'location', circle: who.code, member: who.id, look: '1' } });
  const peek = (who) => call(api.settings, { method: 'GET', token: who.token, query: { area: 'location', circle: who.code, member: who.id } });
  const sloc = (who, body) => call(api.settings, { token: who.token, query: q, body: { code: who.code, memberId: who.id, ...body } });
  const HOME = { lat: 18.5204, lng: 73.8567 }, AWAY = { lat: 18.56, lng: 73.91, accuracy: 10 };
  let r = await sloc(meera, { action: 'place_add', name: 'Home', ...HOME, radius: 200 });
  ok('Meera saves Home, and each other person on Parwah is asked once', r.status === 201 && r.asked === 4, JSON.stringify(r));
  let me = (await peek(rohan)).me;
  ok('nobody announces until they say yes: Rohan is off, with Meera\'s ask waiting', me.announce === false && me.announceAsk && me.announceAsk.by === 'Meera', JSON.stringify(me));
  ok('the person who saved the place is not announcing either', (await peek(meera)).me.announce === false);
  const moved = () => said('📍 Rohan%');
  await sloc(rohan, { action: 'share', lat: HOME.lat, lng: HOME.lng, accuracy: 10 });
  await sloc(rohan, { action: 'update', ...AWAY });
  await sloc(rohan, { action: 'update', lat: HOME.lat, lng: HOME.lng, accuracy: 10 });
  ok('without his yes, leaving and arriving are told to nobody', (await moved()).length === 0, (await moved()).join(' | '));
  ok('there is no way to switch it on for someone else', (await sloc(meera, { action: 'announce_set', on: true, targetId: rohan.id, memberId: meera.id })).status === 200
     && (await peek(rohan)).me.announce === false && (await peek(meera)).me.announce === true);
  await sloc(meera, { action: 'announce_set', on: false });
  ok('a yes must be a yes', (await sloc(rohan, { action: 'announce_set', on: 'yes' })).status === 400);
  r = await sloc(rohan, { action: 'announce_set', on: true });
  ok('Rohan says yes on his own phone', r.status === 200 && r.announce === true && (await peek(rohan)).me.announce === true && (await peek(rohan)).me.announceAsk === null);
  await sloc(rohan, { action: 'update', ...AWAY });
  ok('now leaving Home is told, once', (await moved()).join(' | ') === '📍 Rohan left Home', (await moved()).join(' | '));
  await sloc(rohan, { action: 'announce_set', on: false });
  await sloc(rohan, { action: 'update', lat: HOME.lat, lng: HOME.lng, accuracy: 10 });
  ok('and after he turns it off, coming back is told to nobody', (await moved()).length === 1, (await moved()).join(' | '));
  ok('asking someone to announce is one ask a week', (await sloc(meera, { action: 'announce_ask', askWho: papa.id })).status === 200
     && (await sloc(meera, { action: 'announce_ask', askWho: papa.id })).status === 429 && (await peek(papa)).me.announce === false);

  // ---- who looked
  let seen = (await peek(rohan)).me.seenBy;
  ok('nobody has looked yet', seen.length === 0, JSON.stringify(seen));
  const p1 = (await peek(meera)).shares.find(x => x.name === 'Rohan');
  ok('without a look, Rohan\'s position is not sent', p1 && p1.lat === null && p1.lng === null && p1.withheld === true && p1.at.length === 0, JSON.stringify(p1));
  ok('and nothing is written down', (await peek(rohan)).me.seenBy.length === 0);
  const l1 = (await look(meera)).shares.find(x => x.name === 'Rohan');
  ok('with a look, it is', l1 && Math.abs(l1.lat - HOME.lat) < 0.001 && l1.withheld === false, JSON.stringify(l1));
  seen = (await peek(rohan)).me.seenBy;
  ok('and Rohan sees who looked: "Seen by Meera"', seen.length === 1 && seen[0].name === 'Meera' && /^Seen by Meera, /.test(Rules.seenByWords(seen[0].name, seen[0].at)), JSON.stringify(seen));
  const at1 = (await admin.query(`select at from location_looks where member_id = $1 and viewer_id = $2`, [rohan.id, meera.id])).rows[0].at;
  await look(meera);
  ok('a second look in the same ten minutes is the same line', +(await admin.query(`select at from location_looks where member_id = $1 and viewer_id = $2`, [rohan.id, meera.id])).rows[0].at === +at1);
  await admin.query(`update location_looks set at = now() - interval '11 minutes'`);
  await look(meera);
  ok('a look ten minutes later is a new time', +(await admin.query(`select at from location_looks where member_id = $1 and viewer_id = $2`, [rohan.id, meera.id])).rows[0].at > +at1 - 660000 + 1000);
  await look(rohan);
  ok('looking at your own is not written down', (await admin.query(`select count(*)::int as n from location_looks where viewer_id = $1 and member_id = $1`, [rohan.id])).rows[0].n === 0);
  ok('Meera is not shown who looked at Rohan', (await peek(meera)).me.seenBy.length === 0);
  ok('a stranger gets nothing', (await call(api.settings, { method: 'GET', token: stranger.token, query: { area: 'location', circle: F.code, member: rohan.id, look: '1' } })).status === 403);

  // ---- last seen
  ok('a fresh position is live', (await look(meera)).shares.find(x => x.name === 'Rohan').live === true);
  await admin.query(`update location_shares set updated_at = now() - interval '6 minutes' where member_id = $1`, [rohan.id]);
  const old = (await look(meera)).shares.find(x => x.name === 'Rohan');
  ok('six minutes on, it is not live, and says when it was last seen', old.live === false && /^Last seen [56] min ago$/.test(Rules.lastSeenWords(old.updatedAt)), JSON.stringify(old));
  await sloc(rohan, { action: 'stop' });
  ok('stopping deletes the list of who looked', (await admin.query(`select count(*)::int as n from location_looks where member_id = $1`, [rohan.id])).rows[0].n === 0);

  // ---- "Not now"
  r = await sloc(meera, { action: 'ask', targetId: papa.id });
  ok('Meera asks Papa to share', r.status === 200 && r.asked === 'Papa', JSON.stringify(r));
  let asks = (await peek(papa)).me.asks;
  ok('Papa sees who asked', asks.length === 1 && asks[0].name === 'Meera' && asks[0].askerId === meera.id, JSON.stringify(asks));
  ok('Rohan cannot answer for Papa', (await sloc(rohan, { action: 'ask_answer', askerId: meera.id, answer: 'notnow' })).status === 404);
  ok('the answer is Not now, or sharing', (await sloc(papa, { action: 'ask_answer', askerId: meera.id, answer: 'never' })).status === 400);
  r = await sloc(papa, { action: 'ask_answer', askerId: meera.id, answer: 'notnow' });
  ok('Papa says Not now: that asker is muted for 7 days', r.status === 200 && r.days === 7 && Math.abs(Date.parse(r.mutedUntil) - Date.now() - 7 * 86400000) < 60000, JSON.stringify(r));
  ok('the ask is gone from his screen', (await peek(papa)).me.asks.length === 0);
  await admin.query(`delete from rate_limit where bucket = 'locask'`);
  r = await sloc(meera, { action: 'ask', targetId: papa.id });
  ok('Meera cannot ask again, even after the ten minutes', r.status === 429 && r.notNow === true && /not now/i.test(r.error), JSON.stringify(r));
  ok('and Papa is not asked', (await peek(papa)).me.asks.length === 0);
  ok('Rohan, who was not answered, can still ask', (await sloc(rohan, { action: 'ask', targetId: papa.id })).status === 200 && (await peek(papa)).me.asks[0].name === 'Rohan');
  await admin.query(`update location_asks set muted_until = now() - interval '1 minute' where asker_id = $1`, [meera.id]);
  ok('after the 7 days Meera can ask again', (await sloc(meera, { action: 'ask', targetId: papa.id })).status === 200);
  await sloc(papa, { action: 'share', lat: HOME.lat, lng: HOME.lng, accuracy: 10 });
  ok('sharing answers every ask that was waiting', (await peek(papa)).me.asks.length === 0);
  await sloc(papa, { action: 'stop' });
}

// =========================================================== B2: call rota
{
  const care = (who, body) => post('care', who, body);
  let r = await care(rohan, { action: 'rota_create', aboutMemberId: papa.id, memberIds: [rohan.id, meera.id], time: '19:00', tz: 'Asia/Kolkata' });
  ok('a rota for Papa is set up, and Papa is told', r.status === 201 && r.toldPerson === true, JSON.stringify(r));
  const t1 = r.id;
  const hhmm = async (id) => (await admin.query(`select to_char(due_at at time zone 'Asia/Kolkata', 'HH24:MI') as t from requests where id = $1`, [id])).rows[0].t;
  ok('it starts at the time the family picked', (await hhmm(t1)) === '19:00');
  ok('only the person who is called chooses the time', (await care(meera, { action: 'rota_time', taskId: t1, time: '20:30' })).status === 403 && (await hhmm(t1)) === '19:00');
  ok('a time must be a time', (await care(papa, { action: 'rota_time', taskId: t1, time: 'evening' })).status === 400);
  r = await care(papa, { action: 'rota_time', taskId: t1, time: '20:30' });
  ok('Papa chooses 8:30 in the evening', r.status === 200 && r.time === '20:30' && (await hhmm(t1)) === '20:30', JSON.stringify(r));
  ok('the family reads that he chose it', (await said('%Papa chose 8:30 pm for the daily call%')).length === 1);
  r = await care(rohan, { action: 'rota_done', taskId: t1 });
  ok('the next day keeps his time', r.status === 200 && !!r.next && (await hhmm(r.next)) === '20:30', JSON.stringify(r));
  const t2 = r.next;
  ok('nobody else can say no for him', (await care(rohan, { action: 'rota_decline', taskId: t2 })).status === 403
     && (await admin.query(`select count(*)::int as n from requests where template = 'callrota' and about_member = $1 and status in ('open','assigned','claimed')`, [papa.id])).rows[0].n === 1);
  r = await care(papa, { action: 'rota_decline', taskId: t2 });
  ok('Papa says "No daily call, thank you": the rota stops', r.status === 200 && r.stopped === 1
     && (await admin.query(`select count(*)::int as n from requests where template = 'callrota' and about_member = $1 and status in ('open','assigned','claimed')`, [papa.id])).rows[0].n === 0, JSON.stringify(r));
  ok('the day that was done stays as the record', (await admin.query(`select status from requests where id = $1`, [t1])).rows[0].status === 'done');
  ok('the family reads it in his words', (await said('%Papa said: no daily call, thank you%')).length === 1);
  r = await care(meera, { action: 'rota_create', aboutMemberId: papa.id, memberIds: [meera.id] });
  ok('nobody can set one up for him again', r.status === 409 && /no daily call/i.test(r.error), JSON.stringify(r));
  ok('until he says he would like one', (await care(papa, { action: 'rota_welcome' })).status === 200
     && (await care(meera, { action: 'rota_create', aboutMemberId: papa.id, memberIds: [meera.id] })).status === 201);
  r = await care(rohan, { action: 'rota_create', aboutMemberId: dadi, memberIds: [rohan.id] });
  ok('someone not on Parwah has no phone to be told on', r.status === 201 && r.toldPerson === false, JSON.stringify(r));
}

// =============================================================== B3: costs
{
  const care = (who, body) => post('care', who, body);
  const led = (who) => get('care', who, { area: 'expenses' });
  ok('Rohan notes 500 for Papa', (await care(rohan, { action: 'expense_add', amount: 500, category: 'medicines', forMemberId: papa.id })).status === 201);
  ok('Meera notes 300 for Papa', (await care(meera, { action: 'expense_add', amount: 300, category: 'doctor', forMemberId: papa.id })).status === 201);
  ok('Papa notes 120 he paid himself', (await care(papa, { action: 'expense_add', amount: 120, category: 'groceries' })).status === 201);
  ok('Rohan notes 777 for Meera', (await care(rohan, { action: 'expense_add', amount: 777, category: 'tests', forMemberId: meera.id })).status === 201);
  let r = await led(rohan);
  ok('a person who pays reads the whole ledger', r.status === 200 && r.ledger === 'payers' && r.expenses.length === 4 && r.summary[0].total === 1697, JSON.stringify({ l: r.ledger, n: r.expenses && r.expenses.length, s: r.summary }));
  r = await led(papa);
  ok('Papa, by default, reads only what he paid himself', r.status === 200 && r.ledger === 'own' && r.showCosts === false && r.mayAsk === true && r.expenses.length === 1 && Number(r.expenses[0].amount) === 120, JSON.stringify(r.expenses));
  ok('with no totals, split or bills, and none of the other amounts', r.summary.length === 0 && r.settledBills.length === 0 && !/500|300|777|1697/.test(JSON.stringify(r)), JSON.stringify(r).slice(0, 300));
  r = await led(meera);
  ok('a cost noted for Meera is left out of her own list', r.ledger === 'payers' && r.expenses.length === 3 && !/777/.test(JSON.stringify(r.expenses)), JSON.stringify(r.expenses.map(e => e.amount)));
  ok('nobody can turn the switch on for Papa', (await care(rohan, { action: 'expense_show', on: true, targetId: papa.id })).status === 200 && (await led(papa)).ledger === 'own');
  await care(rohan, { action: 'expense_show', on: false });
  ok('the switch is on or off', (await care(papa, { action: 'expense_show', on: 'yes' })).status === 400);
  r = await care(papa, { action: 'expense_show', on: true });
  ok('Papa turns on "Show me the costs"', r.status === 200 && r.showCosts === true);
  r = await led(papa);
  ok('and now reads all of it', r.ledger === 'full' && r.showCosts === true && r.expenses.length === 4 && r.summary[0].total === 1697, JSON.stringify(r.summary));
  await care(papa, { action: 'expense_show', on: false });
  ok('and off again hides it again', (await led(papa)).expenses.length === 1);
  for (const [who, nm] of [[chintu, 'a child by date of birth'], [tara, 'a child marked by an adult']]) {
    r = await led(who);
    ok(nm + ' reads none of the ledger', r.status === 200 && r.ledger === 'none' && r.expenses.length === 0 && r.summary.length === 0 && r.mayAsk === false && !/500|300|120|777/.test(JSON.stringify(r)), JSON.stringify(r).slice(0, 200));
    ok(nm + ' cannot ask to see it, or add to it', (await care(who, { action: 'expense_show', on: true })).status === 403 && (await care(who, { action: 'expense_add', amount: 5 })).status === 403 && (await led(who)).ledger === 'none');
  }
  const feed = (await admin.query(`select text from events where circle_id = $1 and text like '%cost%'`, [F.id])).rows.map(x => x.text);
  ok('the feed everyone reads says a cost was noted, with no amount and not who it was for', feed.length === 4 && feed.every(t => /^(Rohan|Meera|Papa) noted a care cost$/.test(t)), feed.join(' | '));
  ok('and no amount is anywhere in the feed', (await said('%₹%')).length === 0 && (await said('%1697%')).length === 0 && (await said('%777%')).length === 0);
  ok('a stranger reads nothing', (await call(api.care, { method: 'GET', token: stranger.token, query: { area: 'expenses', circle: F.code, member: rohan.id } })).status === 403);
}

// ========================================================== B4: home staff
{
  const care = (who, body) => post('care', who, body);
  const reg = (who) => get('care', who, { area: 'staff' });
  let r = await care(rohan, { action: 'staff_add', name: 'Sunita Devi', role: 'cook', salary: 9000, arriveTime: '08:00', workDays: [0, 1, 2, 3, 4, 5, 6], idLast4: '4321', ownerId: meera.id });
  ok('Rohan adds Sunita and names Meera as the one who hears', r.status === 201 && r.ownerId === meera.id, JSON.stringify(r));
  const sid = r.id;
  await admin.query(`update home_staff set tz = 'UTC' where id = $1`, [sid]);
  ok('a child cannot be the owner', (await care(rohan, { action: 'staff_add', name: 'X', ownerId: chintu.id })).status === 400);
  ok('nor someone who is not on Parwah', (await care(rohan, { action: 'staff_add', name: 'X', ownerId: dadi })).status === 400);
  ok('nor someone remembered', (await care(rohan, { action: 'staff_add', name: 'X', ownerId: dadaji })).status === 400);
  ok('an advance is noted by an adult', (await care(meera, { action: 'staff_advance', staffId: sid, amount: 1500 })).status === 201);

  r = await reg(rohan);
  let s = r.staff.find(x => x.id === sid);
  ok('an adult reads the salary, the advance and what is due', r.adult === true && Number(s.salary) === 9000 && s.advanceList.length === 1 && s.pay && s.pay.payable === 7500 && s.id_last4 === '4321' && s.owner_name === 'Meera', JSON.stringify(s));
  for (const [who, nm] of [[chintu, 'a child by date of birth'], [tara, 'a child marked by an adult']]) {
    r = await reg(who);
    s = r.staff.find(x => x.id === sid);
    ok(nm + ' sees who helps at home, with no money', r.adult === false && s && s.name === 'Sunita Devi' && s.salary === null && s.pay === null && s.advanceList.length === 0 && s.paid === null && s.id_last4 === null
       && !/9000|1500|7500|4321/.test(JSON.stringify(r)), JSON.stringify(s));
    ok(nm + ' cannot note an advance, mark paid, add or remove', (await care(who, { action: 'staff_advance', staffId: sid, amount: 10 })).status === 403
       && (await care(who, { action: 'staff_pay', staffId: sid })).status === 403 && (await care(who, { action: 'staff_add', name: 'Y' })).status === 403
       && (await care(who, { action: 'staff_remove', staffId: sid })).status === 403);
  }
  ok('but anyone at home can tap who came today', (await care(chintu, { action: 'staff_mark', staffId: sid, status: 'came' })).status === 200
     && (await care(chintu, { action: 'staff_mark', staffId: sid, status: 'clear' })).status === 200);
  ok('the advance is in the feed with no amount', (await said('%noted an advance in the home staff register%')).length === 1 && (await said('%1,500%')).length === 0 && (await said('%1500%')).length === 0);

  // ---- late: one person, once, never the feed
  await admin.query(`delete from staff_late_alert`);
  const tue = Date.UTC(2026, 10, 3, 9, 5);       // a Tuesday, 65 minutes after 08:00 UTC
  const both = await Promise.all([Staff.sweepStaffLate(sql, F.id, tue), Staff.sweepStaffLate(sql, F.id, tue)]);
  ok('the late alert is claimed once, with two phones looking', both[0] + both[1] === 1, JSON.stringify(both));
  ok('nothing about it goes in the family feed', (await said('%not marked in yet%')).length === 0 && (await said('%Sunita%expected%')).length === 0);
  const tgt = async () => (await Aud.audienceFor(sql, F.id, 'staff_late', { only: (await admin.query(`select coalesce(owner_id, created_by) as o from home_staff where id = $1`, [sid])).rows[0].o }));
  ok('it is for the named owner, and only her', (await tgt()).join() === meera.id);
  await admin.query(`update home_staff set owner_id = $2 where id = $1`, [sid, chintu.id]);
  ok('an owner who is a child is never the one told', (await tgt()).length === 0 && (await Aud.audienceFor(sql, F.id, 'staff_late')).slice(0, 1).join() === rohan.id);
  await admin.query(`update home_staff set owner_id = $2 where id = $1`, [sid, meera.id]);
  ok('the owner can be changed by an adult', (await care(rohan, { action: 'staff_update', staffId: sid, ownerId: rohan.id })).status === 200
     && (await reg(rohan)).staff.find(x => x.id === sid).owner_id === rohan.id);
  await care(rohan, { action: 'staff_update', staffId: sid, ownerId: meera.id });

  // ---- the one-tap answer, on the owner's screen only
  await admin.query(`delete from staff_late_alert`);
  await admin.query(`delete from staff_attendance where staff_id = $1`, [sid]);
  const todayUtc = new Date().toISOString().slice(0, 10);
  await admin.query(`insert into staff_late_alert (staff_id, day) values ($1, $2)`, [sid, todayUtc]);
  ok('the owner sees "not in yet" with her answer to give', (await reg(meera)).staff.find(x => x.id === sid).lateToday === true && (await reg(meera)).staff.find(x => x.id === sid).mineToAnswer === true);
  ok('nobody else is shown it', (await reg(rohan)).staff.find(x => x.id === sid).lateToday === false && (await reg(chintu)).staff.find(x => x.id === sid).lateToday === false);
  ok('"On leave today" is one tap', (await care(meera, { action: 'staff_mark', staffId: sid, status: Rules.STAFF_ANSWERS.leave })).status === 200
     && (await reg(meera)).staff.find(x => x.id === sid).lateToday === false && (await reg(meera)).staff.find(x => x.id === sid).todayStatus === 'leave');
  await care(meera, { action: 'staff_mark', staffId: sid, status: 'clear' });
  ok('and so is "Sunita came"', (await care(meera, { action: 'staff_mark', staffId: sid, status: Rules.STAFF_ANSWERS.came })).status === 200
     && (await reg(meera)).staff.find(x => x.id === sid).todayStatus === 'came' && Rules.staffAnswerWords('Sunita Devi').came === 'Sunita came');

  // ---- a day off marked ahead is skipped
  await admin.query(`delete from staff_late_alert`);
  await admin.query(`delete from staff_attendance where staff_id = $1`, [sid]);
  const ahead = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  ok('tomorrow can be marked as a day off', (await care(meera, { action: 'staff_mark', staffId: sid, status: 'off', day: ahead(1) })).status === 200);
  ok('but not a day more than a month ahead', (await care(meera, { action: 'staff_mark', staffId: sid, status: 'off', day: ahead(40) })).status === 400);
  ok('and "came" cannot be marked ahead', (await care(meera, { action: 'staff_mark', staffId: sid, status: 'came', day: ahead(1) })).status === 400);
  const offMorning = Date.parse(ahead(1) + 'T09:05:00Z');
  ok('that morning brings no alert', (await Staff.sweepStaffLate(sql, F.id, offMorning)) === 0 && (await admin.query(`select count(*)::int as n from staff_late_alert`)).rows[0].n === 0);
  ok('the day after it does', (await Staff.sweepStaffLate(sql, F.id, offMorning + 86400000)) === 1);
  ok('a day off costs no pay', (await reg(rohan)).staff.find(x => x.id === sid).pay.unpaidDays === 0);
}

// ====================================== B6: Ashirwad and "How is your day?"
// A tiny WebM header: enough for the server's "does it look like audio" check.
const VOICE = 'data:audio/webm;base64,' + Buffer.concat([Buffer.from([0x1A, 0x45, 0xDF, 0xA3]), Buffer.alloc(600, 7)]).toString('base64');
{
  const ash = (who, body) => post('chats', who, { area: 'ashirwad', ...body });
  const box = (who, query) => get('chats', who, { area: 'ashirwad', ...(query || {}) });
  let r = await box(papa);
  ok('the screen is told the one-tap lines and who can be sent to', r.status === 200 && r.lines.some(l => l.t === 'Khush raho') && r.pranam === '🙏 Pranam'
     && r.people.includes(chintu.id) && !r.people.includes(dadaji) && !r.people.includes(dadi) && !r.people.includes(papa.id), JSON.stringify(r.people));
  r = await ash(papa, { action: 'bless', to: chintu.id, line: 'exam' });
  ok('Papa sends Chintu "All the best for the exam"', r.status === 201 && !!r.id, JSON.stringify(r));
  const c1 = r.id;
  let inb = (await box(chintu)).inbox;
  ok('it arrives as a card for Chintu, a child', inb.length === 1 && inb[0].line === 'All the best for the exam' && inb[0].fromName === 'Papa' && inb[0].kind === 'bless', JSON.stringify(inb));
  ok('and for nobody else', (await box(meera)).inbox.length === 0 && (await box(rohan)).inbox.length === 0);
  ok('only the person it is for can answer', (await ash(meera, { action: 'reply', id: c1, pranam: true })).status === 404 && (await ash(papa, { action: 'reply', id: c1, pranam: true })).status === 404);
  ok('the one-tap answer is Pranam, nothing else', (await ash(chintu, { action: 'reply', id: c1, answer: 'good' })).status === 400);
  r = await ash(chintu, { action: 'reply', id: c1, pranam: true });
  ok('Chintu answers with one tap', r.status === 201 && r.kind === 'pranam');
  ok('a second tap is the same answer', (await ash(chintu, { action: 'reply', id: c1, pranam: true })).already === true
     && (await admin.query(`select count(*)::int as n from ashirwad_replies where ashirwad_id = $1`, [c1])).rows[0].n === 1);
  ok('the card leaves his Today', (await box(chintu)).inbox.length === 0);
  const sent = (await box(papa)).sent.find(x => x.id === c1);
  ok('Papa sees who answered', sent && sent.toName === 'Chintu' && sent.replies.length === 1 && sent.replies[0].name === 'Chintu' && sent.replies[0].line === '🙏 Pranam', JSON.stringify(sent));

  ok('a line nobody wrote is refused', (await ash(papa, { action: 'bless', to: chintu.id, line: 'Send money' })).status === 400);
  ok('nothing is sent to yourself', (await ash(papa, { action: 'bless', to: papa.id, line: 'khush' })).status === 400);
  ok('nor to someone who is no longer with us', (await ash(papa, { action: 'bless', to: dadaji, line: 'khush' })).status === 400);
  ok('nor to someone with no phone to receive it', (await ash(papa, { action: 'bless', to: dadi, line: 'khush' })).status === 400);
  ok('a stranger cannot send into the family', (await call(api.chats, { token: stranger.token, body: { area: 'ashirwad', code: F.code, memberId: papa.id, action: 'bless', to: chintu.id, line: 'khush' } })).status === 403);

  // To everyone, in his own voice.
  ok('a voice note must be a voice note', (await ash(papa, { action: 'bless', to: 'all', voice: 'data:text/html;base64,PGI+', secs: 3 })).status === 400
     && (await ash(papa, { action: 'bless', to: 'all', voice: VOICE, secs: 90 })).status === 400);
  r = await ash(papa, { action: 'bless', to: 'all', voice: VOICE, secs: 4 });
  ok('Papa records a blessing for everyone', r.status === 201, JSON.stringify(r));
  const c2 = r.id;
  inb = (await box(rohan)).inbox;
  ok('everyone else has the card, marked as a voice note', inb.length === 1 && inb[0].hasVoice === true && inb[0].secs === 4 && inb[0].toAll === true && (await box(tara)).inbox.length === 1 && (await box(papa)).inbox.length === 0, JSON.stringify(inb));
  ok('the list never carries the sound itself', !/data:audio/.test(JSON.stringify(await box(rohan))));
  ok('Rohan can listen', (await box(rohan, { audio: c2 })).audio === VOICE);
  ok('a stranger cannot', (await call(api.chats, { method: 'GET', token: stranger.token, query: { area: 'ashirwad', circle: O.code, member: stranger.id, audio: c2 } })).status === 404);
  r = await ash(rohan, { action: 'reply', id: c2, voice: VOICE, secs: 3 });
  ok('Rohan answers in his own voice', r.status === 201 && r.kind === 'voice');
  ok('Papa can hear the reply', (await box(papa, { reply: c2, by: rohan.id })).audio === VOICE);
  ok('Meera cannot hear Rohan\'s reply to Papa', (await box(meera, { reply: c2, by: rohan.id })).status === 404);
  // One to one, in voice: nobody else can listen.
  r = await ash(papa, { action: 'bless', to: rohan.id, voice: VOICE, secs: 2 });
  ok('a voice note for Rohan alone cannot be heard by Meera', r.status === 201 && (await box(meera, { audio: r.id })).status === 404 && (await box(rohan, { audio: r.id })).audio === VOICE);

  // "How is your day?" from the parent to a child.
  r = await ash(papa, { action: 'howday', to: rohan.id });
  ok('Papa asks Rohan "How is your day?"', r.status === 201, JSON.stringify(r));
  const h1 = r.id;
  const hb = (await box(rohan)).inbox.find(x => x.id === h1);
  ok('Rohan gets the ask', hb && hb.kind === 'howday' && hb.line === 'How is your day?', JSON.stringify(hb));
  ok('asking again a minute later waits', (await ash(papa, { action: 'howday', to: rohan.id })).status === 429);
  ok('the ask is for one person, not for everyone', (await ash(papa, { action: 'howday', to: 'all' })).status === 400);
  ok('Pranam is not an answer to it', (await ash(rohan, { action: 'reply', id: h1, pranam: true })).status === 400);
  r = await ash(rohan, { action: 'reply', id: h1, answer: 'busy' });
  ok('Rohan answers with one tap', r.status === 201 && r.kind === 'answer');
  ok('Papa reads the answer', (await box(papa)).sent.find(x => x.id === h1).replies[0].line === 'Busy, but all fine');
  ok('a child can ask a parent the same way', (await ash(chintu, { action: 'howday', to: papa.id })).status === 201 && (await box(papa)).inbox.some(x => x.kind === 'howday' && x.fromName === 'Chintu'));
}

// ======================================================= B7: Reached safely
{
  const ash = (who, body) => post('chats', who, { area: 'ashirwad', ...body });
  const box = (who) => get('chats', who, { area: 'ashirwad' });
  const inMin = (m) => new Date(Date.now() + m * 60000).toISOString();
  ok('a trip needs someone to tell', (await ash(rohan, { action: 'trip_start', to: 'Delhi', by: 'train', expectAt: inMin(60), tell: [] })).status === 400);
  ok('never someone who is no longer with us', (await ash(rohan, { action: 'trip_start', to: 'Delhi', by: 'train', expectAt: inMin(60), tell: [meera.id, dadaji] })).status === 400);
  ok('nor someone with no phone', (await ash(rohan, { action: 'trip_start', to: 'Delhi', by: 'train', expectAt: inMin(60), tell: [dadi] })).status === 400);
  ok('and a time that has not gone', (await ash(rohan, { action: 'trip_start', to: 'Delhi', by: 'train', expectAt: inMin(-5), tell: [meera.id] })).status === 400);
  let r = await ash(rohan, { action: 'trip_start', to: 'Delhi', by: 'train', expectAt: inMin(60), tell: [meera.id, papa.id] });
  ok('Rohan leaves for Delhi, by train, and tells Meera and Papa', r.status === 201 && r.tell.length === 2, JSON.stringify(r));
  const t1 = r.id;
  ok('one trip at a time', (await ash(rohan, { action: 'trip_start', to: 'Agra', by: 'car', expectAt: inMin(60), tell: [meera.id] })).status === 409);
  let b = await box(rohan);
  ok('Rohan sees his trip, travelling', b.trips.mine && b.trips.mine.to === 'Delhi' && b.trips.mine.phase === 'travelling' && b.trips.mine.byWords === 'by train', JSON.stringify(b.trips));
  ok('the people he chose see it', (await box(meera)).trips.watching.length === 1 && (await box(papa)).trips.watching[0].name === 'Rohan');
  ok('the people he did not choose do not', (await box(chintu)).trips.watching.length === 0 && (await box(tara)).trips.watching.length === 0 && !/Delhi/.test(JSON.stringify(await box(chintu))));
  ok('only the traveller says they reached', (await ash(meera, { action: 'trip_reached', id: t1 })).status === 404);

  const exp = new Date((await admin.query(`select expect_at from trips where id = $1`, [t1])).rows[0].expect_at).getTime();
  ok('before the expected time nobody is asked', (await Ash.sweepTripsAll(sql, exp - 60000)) === 0);
  ok('nor 29 minutes after it', (await Ash.sweepTripsAll(sql, exp + 29 * 60000)) === 0);
  const two = await Promise.all([Ash.sweepTripsAll(sql, exp + 30 * 60000), Ash.sweepTripsAll(sql, exp + 30 * 60000)]);
  ok('30 minutes after, the people chosen are asked to call, once, with two timers running', two[0] + two[1] === 1, JSON.stringify(two));
  ok('and never again for that trip', (await Ash.sweepTripsAll(sql, exp + 300 * 60000)) === 0);
  ok('nothing about a trip goes in the family feed', (await said('%Delhi%')).length === 0);
  r = await ash(rohan, { action: 'trip_extend', id: t1, expectAt: inMin(120) });
  ok('"running late" moves the time, and the ask can happen again for the new time', r.status === 200
     && (await admin.query(`select asked_at from trips where id = $1`, [t1])).rows[0].asked_at === null);
  r = await ash(rohan, { action: 'trip_reached', id: t1 });
  ok('Rohan taps Reached safely', r.status === 200 && r.status !== 'open');
  ok('it is off his screen, and shown as reached to the people he told', (await box(rohan)).trips.mine === null && (await box(meera)).trips.watching[0].phase === 'reached');
  ok('a trip that reached is never asked about', (await Ash.sweepTripsAll(sql, Date.now() + 10 * 86400000)) === 0);
  ok('tapping twice is fine', (await ash(rohan, { action: 'trip_reached', id: t1 })).already === true);

  // The real timer runs it.
  r = await ash(meera, { action: 'trip_start', to: 'Pune', by: 'bus', expectAt: inMin(30), tell: [rohan.id] });
  await admin.query(`update trips set expect_at = now() - interval '45 minutes' where id = $1`, [r.id]);
  await admin.query(`delete from rate_limit where bucket = 'tick'`);
  await runTick(sql);
  ok('the timer in api/events.mjs asks for a trip that is 45 minutes late', (await admin.query(`select asked_at from trips where id = $1`, [r.id])).rows[0].asked_at !== null);
  ok('Rohan sees Meera\'s trip as late', (await box(rohan)).trips.watching.find(x => x.to === 'Pune').phase === 'late');
  ok('a cancelled trip is never asked about', (await ash(meera, { action: 'trip_cancel', id: r.id })).status === 200 && (await box(rohan)).trips.watching.every(x => x.to !== 'Pune'));
  // A traveller since marked as no longer with us is left in peace.
  r = await ash(tara, { action: 'trip_start', to: 'School', by: 'bus', expectAt: inMin(30), tell: [meera.id] });
  ok('a child can use Reached safely too', r.status === 201);
  await admin.query(`update trips set expect_at = now() - interval '45 minutes' where id = $1`, [r.id]);
  await admin.query(`update members set remembered = true where id = $1`, [tara.id]);
  ok('nobody is asked to call someone remembered', (await Ash.sweepTripsAll(sql)) === 0 && (await box(meera)).trips.watching.every(x => x.to !== 'School'));
  await admin.query(`update members set remembered = false where id = $1`, [tara.id]);
}

// ==================================================== B8: the emergency card
{
  const card = (who, person) => get('book', who, { area: 'ecard', ...(person ? { person } : {}) });
  const set = (who, body) => post('book', who, { action: 'ecard_set', ...body });
  let r = await card(papa, papa.id);
  ok('Papa opens his own card, with the legal line', r.status === 200 && r.card.mine === true && /not medical advice/.test(r.legal) && r.card.contacts.length === 0, JSON.stringify(r));
  ok('and is offered the family to choose from, never someone remembered', r.card.candidates.some(c => c.id === rohan.id && c.adultOnApp) && r.card.candidates.some(c => c.id === chintu.id && !c.adultOnApp)
     && !r.card.candidates.some(c => c.id === dadaji), JSON.stringify(r.card.candidates));
  r = await card(rohan, papa.id);
  ok('until Papa chooses, nobody else opens it', r.status === 403 && r.locked === true && !r.card && /has not chosen you/.test(r.error), JSON.stringify(r));
  ok('nobody chooses for him', (await set(rohan, { viewers: [meera.id], contacts: [] })).status === 200 && (await card(meera, papa.id)).status === 403);
  ok('a child cannot be chosen to see it', (await set(papa, { viewers: [chintu.id], contacts: [] })).status === 400);
  ok('nor someone not on Parwah', (await set(papa, { viewers: [dadi], contacts: [] })).status === 400);
  ok('a remembered person is never an emergency contact', (await set(papa, { viewers: [], contacts: [dadaji] })).status === 400);
  ok('two contacts, no more', (await set(papa, { viewers: [], contacts: [rohan.id, meera.id, chintu.id] })).status === 400);
  r = await set(papa, { viewers: [rohan.id], contacts: [meera.id, rohan.id] });
  ok('Papa chooses Rohan to see it, and Meera then Rohan to call', r.status === 200 && r.viewers.join() === rohan.id && r.contacts.join() === [meera.id, rohan.id].join(), JSON.stringify(r));
  r = await card(rohan, papa.id);
  ok('Rohan opens it, with the two contacts in Papa\'s order', r.status === 200 && r.card.contacts.map(c => c.name).join() === 'Meera,Rohan' && r.card.contacts[0].phone === '+919811100001' && r.card.mine === false, JSON.stringify(r.card));
  ok('but is not told who else Papa chose', r.card.viewers === undefined && r.card.candidates === undefined);
  ok('Meera, a contact but not chosen to see it, does not open it', (await card(meera, papa.id)).status === 403);
  ok('the list of cards Rohan may open is his own, Papa\'s and Dadi\'s', JSON.stringify((await card(rohan)).mayOpen.sort()) === JSON.stringify([rohan.id, papa.id, dadi].sort()), JSON.stringify((await card(rohan)).mayOpen));
  ok('a child may open only their own', (await card(chintu)).mayOpen.join() === chintu.id && (await card(chintu, papa.id)).status === 403 && (await card(chintu, dadi)).status === 403 && (await card(chintu, chintu.id)).status === 200);
  ok('the adults keep the card of someone not on Parwah', (await card(meera, dadi)).status === 200);
  ok('nobody opens the card of someone remembered', (await card(rohan, dadaji)).status === 404);
  ok('a stranger opens nothing', (await call(api.book, { method: 'GET', token: stranger.token, query: { area: 'ecard', circle: F.code, member: rohan.id, person: papa.id } })).status === 403
     && (await call(api.book, { method: 'GET', token: stranger.token, query: { area: 'ecard', circle: O.code, member: stranger.id, person: papa.id } })).status === 404);
  await admin.query(`insert into sos (circle_id, member_id, status) values ($1, $2, 'open')`, [F.id, papa.id]);
  ok('while Papa\'s SOS is open, an adult he did not choose can open it', (await card(meera, papa.id)).status === 200);
  ok('a child still cannot', (await card(chintu, papa.id)).status === 403);
  await admin.query(`update sos set status = 'resolved' where circle_id = $1`, [F.id]);
  ok('when the SOS is closed, it is closed to her again', (await card(meera, papa.id)).status === 403);
  // A contact who has since passed away is left off the card.
  await set(papa, { viewers: [rohan.id], contacts: [dadi, meera.id] });
  await admin.query(`update members set remembered = true where id = $1`, [dadi]);
  ok('a contact later marked as no longer with us is left off the card', (await card(rohan, papa.id)).card.contacts.map(c => c.name).join() === 'Meera');
  await admin.query(`update members set remembered = false where id = $1`, [dadi]);
  ok('mayOpen is the same rule the unit test checks', (await Ec.mayOpen(sql, F.id, rohan.id)).includes(papa.id) && !(await Ec.mayOpen(sql, F.id, meera.id)).includes(papa.id));
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`consent.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`consent.dbtest: ${pass}/${pass} checks pass`);
