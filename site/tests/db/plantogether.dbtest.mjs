// WATCH TOGETHER AND SPLITTING A COST, AGAINST A REAL DATABASE: the real
// handlers behind /api/plans (and /api/games for the recommendation, and
// /api/book for the saved UPI id), the real schema and SQL.
//
// What it proves:
//   - a `together` plan is made from a recommendation only by whoever sent
//     it or one of the people it was sent to; its name, platform and link
//     come from the recommendation, never from the phone;
//   - a link that is not plain https, or that carries a sign-in, is refused;
//   - I am in, Maybe, Cannot is one answer per person, on the plan's own
//     `going` list, so the hour-before reminder still reaches who said yes;
//   - a plan's costs are read only by the people on the plan; the rest of
//     the family and another circle are refused by the server;
//   - a cost is changed or removed only by whoever added it or whoever made
//     the plan;
//   - settling up is two-sided (I have paid, then Received, in either
//     order), and can be undone only before the other person confirms;
//   - a UPI id the viewer may not see is never in any answer; a plan that
//     is not in rupees gets no UPI link at all; a UPI PIN is never taken.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('plantogether.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('plantogether.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: plans } = await import('../../../api/plans.mjs');
const { default: games } = await import('../../../api/games.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { NO_PASSWORD } = await import('../../../api/_pasandrules.mjs');
const { SPLIT_NOTE, SPLIT_NO_PIN } = await import('../../../api/_split.mjs');
const { sweepPlanReminders } = await import('../../../api/_plansweep.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

let n = 0;
async function user(name) {
  const phone = '+9198511' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token };
}
async function seat(circleId, code, u, country = 'IN') {
  const m = (await admin.query(`insert into members (circle_id, name, user_id, country) values ($1,$2,$3,$4) returning id`, [circleId, u.name, u.userId, country])).rows[0];
  return { id: m.id, name: u.name, token: u.token, code };
}
const fam = (await admin.query(`insert into circles (code, name) values ('KAPOOR','Kapoor Family') returning id`)).rows[0].id;
const grp = (await admin.query(`insert into circles (code, name, kind) values ('COUSIN','Cousins','group') returning id`)).rows[0].id;
const lon = (await admin.query(`insert into circles (code, name) values ('LONDON','London Family') returning id`)).rows[0].id;
const U = { rohan: await user('Rohan'), meera: await user('Meera'), papa: await user('Papa'), bua: await user('Bua'), vikram: await user('Vikram'), anil: await user('Anil'), sara: await user('Sara') };
const rohan = await seat(fam, 'KAPOOR', U.rohan), meera = await seat(fam, 'KAPOOR', U.meera), papa = await seat(fam, 'KAPOOR', U.papa), bua = await seat(fam, 'KAPOOR', U.bua);
const vikram = await seat(grp, 'COUSIN', U.vikram);
const anil = await seat(lon, 'LONDON', U.anil, 'GB'), sara = await seat(lon, 'LONDON', U.sara, 'IN');
const dadi = (await admin.query(`insert into members (circle_id, name) values ($1,'Dadi') returning id`, [fam])).rows[0];

async function run(handler, who, method, query, body, as) {
  const req = { method, headers: { 'x-parwah-token': who.token }, query: { circle: who.code, member: as || who.id, ...query }, body: { code: who.code, memberId: as || who.id, ...body } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...json, status };
}
const P = (who, body, as) => run(plans, who, 'POST', {}, body, as);
const list = async (who) => (await run(plans, who, 'GET', {}, {})).plans || [];
const costs = (who, planId, as) => run(plans, who, 'GET', { area: 'split', plan: planId }, {}, as);
const pasand = (who, body) => run(games, who, 'POST', { area: 'pasand' }, { area: 'pasand', ...body });
const pay = (who, body) => run(book, who, 'POST', { area: 'pay' }, { area: 'pay', ...body });
const one = async (q, p) => (await admin.query(q, p)).rows[0];
const soon = (min) => new Date(Date.now() + min * 60000).toISOString();

// ================================================================ the route
{
  const r = await run(plans, rohan, 'GET', {}, {});
  ok('the plans list still answers', r.status === 200 && r.ok && Array.isArray(r.plans) && r.plans.length === 0);
  const cols = (await admin.query(`select column_name from information_schema.columns where table_name = 'plans'`)).rows.map(x => x.column_name);
  ok('plans gained the together columns and the cost currency', ['platform', 'link', 'rec_id', 'rec_kind', 'invited', 'maybe', 'cannot', 'cost_currency'].every(c => cols.includes(c)), cols.join());
  ok('the three cost tables exist', (await one(`select count(*)::int as n from information_schema.tables where table_name in ('plan_costs','plan_cost_shares','plan_settles')`)).n === 3);
}

// ================================================================ FEATURE 1: together, from a recommendation
const rec = await pasand(rohan, { action: 'rec_add', title: 'Panchayat', kind: 'show', platform: 'prime', link: 'https://www.primevideo.com/detail/Panchayat', note: 'You will love Pradhan ji.', to: [meera.id] });
ok('Rohan recommends Panchayat to Meera alone', rec.status === 201 && rec.id);
let tgPlan;
{
  // Papa was not sent it; Vikram is in another circle.
  const papaTry = await P(papa, { action: 'create', kind: 'together', recId: rec.id, at: soon(600) });
  ok('PAPA, who was not sent it, cannot make a plan from it', papaTry.status === 404 && /not here any more/.test(papaTry.error), JSON.stringify(papaTry));
  const out = await P(vikram, { action: 'create', kind: 'together', recId: rec.id, at: soon(600) });
  ok('an outsider with their own circle cannot either', out.status === 404);
  ok('an outsider using the family code is refused at the door', (await P({ ...vikram, code: 'KAPOOR' }, { action: 'create', kind: 'together', recId: rec.id, at: soon(600) })).status === 403);
  ok('nothing was made by any of them', (await one(`select count(*)::int as n from plans`)).n === 0);
  ok('a recommendation id that is not an id is refused', (await P(meera, { action: 'create', kind: 'together', recId: 'panchayat', at: soon(600) })).status === 400);

  // Meera, a recipient, makes it. What she sends for the name and the link is ignored.
  const made = await P(meera, { action: 'create', kind: 'together', recId: rec.id, at: soon(600), title: 'Something else', link: 'https://evil.example/x', platform: 'netflix', tz: 'Asia/Kolkata' });
  ok('MEERA, a recipient, makes a plan from it', made.status === 201 && made.id, JSON.stringify(made));
  tgPlan = made.id;
  const row = await one(`select title, kind, platform, link, rec_id, rec_kind, invited, going, room from plans where id = $1`, [tgPlan]);
  ok('the name, platform and link are the recommendation\'s own, not what the phone sent', row.title === 'Panchayat' && row.platform === 'prime' && row.link === 'https://www.primevideo.com/detail/Panchayat' && row.rec_id === rec.id && row.rec_kind === 'show', JSON.stringify(row));
  ok('it is an ordinary plan of kind together, with its maker already in', row.kind === 'together' && row.going.join() === meera.id);
  ok('by default it is for the people it was between: Rohan', row.invited.join() === rohan.id);
  const seen = (await list(rohan)).find(p => p.id === tgPlan);
  ok('the plans list carries the platform, the link and who it is for', seen && seen.kind === 'together' && seen.platform === 'prime' && seen.link === 'https://www.primevideo.com/detail/Panchayat' && seen.invited_names === 'Rohan' && seen.going_names === 'Meera', JSON.stringify(seen));

  // The sender makes one too, choosing who.
  const mine = await P(rohan, { action: 'create', kind: 'together', recId: rec.id, at: soon(900), invite: [meera.id, papa.id] });
  const r2 = await one(`select invited from plans where id = $1`, [mine.id]);
  ok('ROHAN, the sender, can make one and choose who', mine.status === 201 && r2.invited.slice().sort().join() === [meera.id, papa.id].sort().join());
  ok('someone from another circle cannot be invited', (await P(rohan, { action: 'create', kind: 'together', recId: rec.id, at: soon(900), invite: [vikram.id] })).status === 400);
  ok('a bad id in the invite list is refused', (await P(rohan, { action: 'create', kind: 'together', recId: rec.id, at: soon(900), invite: ['x'] })).status === 400);
  await P(rohan, { action: 'cancel', planId: mine.id });

  // A recipient does not learn who else it went to.
  const rec2 = await pasand(rohan, { action: 'rec_add', title: 'Gullak', kind: 'show', to: [meera.id, papa.id] });
  const p2 = await P(papa, { action: 'create', kind: 'together', recId: rec2.id, at: soon(900) });
  const r3 = await one(`select invited, link, platform from plans where id = $1`, [p2.id]);
  ok('a recipient\'s default is the sender only: the other recipients are not named', p2.status === 201 && r3.invited.join() === rohan.id && r3.link === null && r3.platform === null);
  await P(papa, { action: 'cancel', planId: p2.id });

  // A link that is not https could only be on a recommendation if it got
  // there some other way. A plan still will not carry it.
  const odd = await pasand(rohan, { action: 'rec_add', title: 'Odd one', kind: 'film', to: [meera.id] });
  await admin.query(`update pasand_recs set link = 'javascript:alert(1)' where id = $1`, [odd.id]);
  const p3 = await P(meera, { action: 'create', kind: 'together', recId: odd.id, at: soon(900) });
  ok('THE LINK IS CHECKED AGAIN when a plan is made from a recommendation: not https, no plan', p3.status === 400 && /start with https/.test(p3.error)
     && (await one(`select count(*)::int as n from plans where title = 'Odd one'`)).n === 0, JSON.stringify(p3));
  await admin.query(`delete from pasand_recs where id = $1`, [odd.id]);
}

// ---- together without a recommendation, and link validation
{
  const plain = await P(papa, { action: 'create', kind: 'together', title: 'Old Kishore songs', at: soon(700), platform: 'youtube', link: 'https://www.youtube.com/playlist?list=PL123', recKind: 'song' });
  const row = await one(`select title, platform, link, rec_id, rec_kind, invited from plans where id = $1`, [plain.id]);
  ok('"Watch something together" needs no recommendation', plain.status === 201 && row.title === 'Old Kishore songs' && row.platform === 'youtube' && row.link === 'https://www.youtube.com/playlist?list=PL123' && row.rec_id === null && row.rec_kind === 'song' && row.invited.length === 0);
  ok('the platform and the link are both optional', (await P(papa, { action: 'create', kind: 'together', title: 'A film, to be picked', at: soon(700) })).status === 201);
  const before = (await one(`select count(*)::int as n from plans`)).n;
  const http = await P(papa, { action: 'create', kind: 'together', title: 'A film', at: soon(700), link: 'http://example.com/film' });
  ok('a link that is not https is refused, with the reason', http.status === 400 && /start with https/.test(http.error), http.error);
  for (const l of ['javascript:alert(1)', 'upi://pay?pa=x@y', 'intent://x', 'https://', 'https://exa mple.com/x', 'ftp://example.com/x', 'data:text/html,hi'])
    ok('refused as a link: ' + l, (await P(papa, { action: 'create', kind: 'together', title: 'A film', at: soon(700), link: l })).status === 400);
  const cred = await P(papa, { action: 'create', kind: 'together', title: 'A film', at: soon(700), link: 'https://papa:hunter2@www.netflix.com/' });
  ok('a link with a sign-in inside it is refused in plain words', cred.status === 400 && cred.error === NO_PASSWORD, cred.error);
  ok('a password in the name is refused too', (await P(papa, { action: 'create', kind: 'together', title: 'Netflix password hunter2', at: soon(700) })).error === NO_PASSWORD);
  ok('a platform that is not on the list is refused', (await P(papa, { action: 'create', kind: 'together', title: 'A film', at: soon(700), platform: 'hbo' })).status === 400);
  ok('a together plan still needs a name', (await P(papa, { action: 'create', kind: 'together', title: '  ', at: soon(700) })).status === 400);
  ok('and a time that has not gone', (await P(papa, { action: 'create', kind: 'together', title: 'A film', at: soon(-600) })).status === 400);
  ok('nothing was kept from any refusal', (await one(`select count(*)::int as n from plans`)).n === before);
  ok('no link on the table is anything but https', (await one(`select count(*)::int as n from plans where link is not null and link !~ '^https://'`)).n === 0);
  ok('an ordinary plan carries no platform or link, whatever is sent', await (async () => {
    const o = await P(papa, { action: 'create', kind: 'meet', title: 'Chai at home', at: soon(700), platform: 'netflix', link: 'https://example.com/x' });
    const r = await one(`select platform, link from plans where id = $1`, [o.id]);
    return o.status === 201 && r.platform === null && r.link === null;
  })());
}

// ---- I am in, Maybe, Cannot: the plan's own answer
{
  const a1 = await P(rohan, { action: 'rsvp', planId: tgPlan, answer: 'maybe' });
  let row = await one(`select going, maybe, cannot from plans where id = $1`, [tgPlan]);
  ok('Rohan says Maybe', a1.status === 200 && a1.answer === 'maybe' && a1.going === false && row.maybe.join() === rohan.id && row.going.join() === meera.id && row.cannot.length === 0);
  const a2 = await P(rohan, { action: 'rsvp', planId: tgPlan, answer: 'in' });
  row = await one(`select going, maybe, cannot from plans where id = $1`, [tgPlan]);
  ok('then I am in: one answer, moved, never two', a2.going === true && row.maybe.length === 0 && row.going.slice().sort().join() === [meera.id, rohan.id].sort().join());
  await P(rohan, { action: 'rsvp', planId: tgPlan, answer: 'in' });
  row = await one(`select going from plans where id = $1`, [tgPlan]);
  ok('saying I am in twice does not list him twice', row.going.filter(x => x === rohan.id).length === 1);
  ok('and the feed says so once', (await one(`select count(*)::int as n from events where member_id = $1 and text like '%is in for: Panchayat%'`, [rohan.id])).n === 1);
  await P(papa, { action: 'rsvp', planId: tgPlan, answer: 'no' });
  const seen = (await list(meera)).find(p => p.id === tgPlan);
  ok('the list names who is in, who may come and who cannot', /Meera/.test(seen.going_names) && /Rohan/.test(seen.going_names) && seen.cannot_names === 'Papa' && !seen.maybe_names, JSON.stringify(seen));
  ok('an answer that is not one of the three is refused', (await P(rohan, { action: 'rsvp', planId: tgPlan, answer: 'perhaps' })).status === 400);
  ok('the old one-tap answer still works with no answer named', await (async () => {
    const off = await P(rohan, { action: 'rsvp', planId: tgPlan });
    const on = await P(rohan, { action: 'rsvp', planId: tgPlan });
    return off.going === false && on.going === true;
  })());
  ok('an outsider cannot answer', (await P(vikram, { action: 'rsvp', planId: tgPlan, answer: 'in' })).status === 404);
  // The reminder an hour before goes to who said yes: the existing sweep.
  await admin.query(`update plans set at = now() + interval '30 minutes', reminded_at = null where id = $1`, [tgPlan]);
  ok('the existing hour-before reminder claims a together plan, once', (await sweepPlanReminders(db(), fam)) === 1 && (await sweepPlanReminders(db(), fam)) === 0);
}

// ================================================================ FEATURE 2: the costs of a trip
const trip = (await P(meera, { action: 'create', kind: 'trip', title: 'Goa trip', at: soon(3000) })).id;
await P(rohan, { action: 'rsvp', planId: trip });
await P(papa, { action: 'rsvp', planId: trip });
{
  const start = await costs(meera, trip);
  ok('the costs start empty, in rupees, with the plain line about money', start.status === 200 && start.total === 0 && start.costs.length === 0 && start.owes.length === 0 && start.currency === 'INR' && start.upiOk === true
     && start.note === 'Parwah does not move money. This opens your own UPI app.' && start.note === SPLIT_NOTE, JSON.stringify(start));
  ok('BUA, in the family but not on the plan, cannot see its costs', await (async () => { const r = await costs(bua, trip); return r.status === 403 && /Only people on this plan/.test(r.error) && !r.costs; })());
  ok('nor add one', (await P(bua, { action: 'split_add', planId: trip, what: 'Snacks', amount: '100' })).status === 403);
  ok('AN OUTSIDER from another circle is refused: their own code finds no such plan', (await costs(vikram, trip)).status === 404);
  ok('and the family code with their own id is refused at the door', (await costs({ ...vikram, code: 'KAPOOR' }, trip)).status === 403);
  ok('and the family code with a member\'s id is refused too', (await costs({ ...vikram, code: 'KAPOOR' }, trip, rohan.id)).status === 403);
  ok('Meera cannot ask as Rohan', (await costs(meera, trip, rohan.id)).status === 403);
  ok('no token: sign in', (await costs({ ...meera, token: '' }, trip)).status === 401);
  ok('a plan id that is not an id is refused', (await costs(meera, 'goa')).status === 400);
  ok('an outsider cannot add a cost', (await P(vikram, { action: 'split_add', planId: trip, what: 'Snacks', amount: '100' })).status === 404);
}
let rooms, taxi, sweets;
{
  // What a cost may be.
  ok('a cost needs a name', (await P(meera, { action: 'split_add', planId: trip, what: ' ', amount: '100' })).status === 400);
  const long = await P(meera, { action: 'split_add', planId: trip, what: 'x'.repeat(81), amount: '100' });
  ok('81 letters is refused with a reason, never cut', long.status === 400 && /up to 80 letters/.test(long.error));
  for (const a of ['', '0', '-5', 'abc', '12.345', '1e5', '100000000.01'])
    ok('refused as an amount: "' + a + '"', (await P(meera, { action: 'split_add', planId: trip, what: 'Rooms', amount: a })).status === 400);
  const pin = await P(meera, { action: 'split_add', planId: trip, what: 'Rooms, my UPI PIN 4821', amount: '100' });
  ok('a UPI PIN typed into a cost is refused (the notes rule), and nothing is kept', pin.status === 400 && /never keeps a CVV, OTP or banking PIN/.test(pin.error), pin.error);
  const pin2 = await P(meera, { action: 'split_add', planId: trip, what: 'Rooms', amount: '100', upiPin: '4821' });
  ok('A PIN SENT AS A FIELD is never accepted', pin2.status === 400 && pin2.error === SPLIT_NO_PIN);
  ok('nor on settling up', (await P(rohan, { action: 'split_paid', planId: trip, to: meera.id, pin: '4821' })).error === SPLIT_NO_PIN);
  ok('someone from another circle cannot be the payer', (await P(meera, { action: 'split_add', planId: trip, what: 'Rooms', amount: '100', paidBy: vikram.id })).status === 400);
  ok('or share it', (await P(meera, { action: 'split_add', planId: trip, what: 'Rooms', amount: '100', between: [meera.id, vikram.id] })).status === 400);
  ok('nothing was kept from any refusal', (await one(`select count(*)::int as n from plan_costs`)).n === 0);

  // Three costs: rooms 6000 by Meera, taxi 2400 by Rohan, sweets 600 by Papa.
  rooms = await P(meera, { action: 'split_add', planId: trip, what: 'Rooms', amount: '6,000' });
  ok('Meera adds the rooms: shared between everyone going by default', rooms.status === 201 && (await one(`select count(*)::int as n from plan_cost_shares where cost_id = $1`, [rooms.id])).n === 3);
  taxi = await P(rohan, { action: 'split_add', planId: trip, what: 'Taxi from the airport', amount: '2400.00', paidBy: rohan.id });
  sweets = await P(meera, { action: 'split_add', planId: trip, what: 'Sweets', amount: 600, paidBy: papa.id, between: [meera.id, rohan.id, papa.id] });
  ok('a cost can be written down for someone else who paid', sweets.status === 201 && (await one(`select paid_by, added_by from plan_costs where id = $1`, [sweets.id])).paid_by === papa.id);
  ok('amounts are kept as whole paise', (await one(`select amount_paise::text as a, pg_typeof(amount_paise)::text as t from plan_costs where id = $1`, [rooms.id])).a === '600000'
     && (await one(`select data_type from information_schema.columns where table_name = 'plan_costs' and column_name = 'amount_paise'`)).data_type === 'bigint');
  ok('the currency is fixed on the plan from its maker\'s country', (await one(`select cost_currency from plans where id = $1`, [trip])).cost_currency === 'INR');

  const L = await costs(rohan, trip);
  const who = (id) => L.people.find(p => p.memberId === id);
  ok('THE LEDGER: total 9000', L.total === 900000 && L.costs.length === 3);
  ok('each person\'s share is 3000', [meera, rohan, papa].every(m => who(m.id).share === 300000));
  ok('what each has paid: Meera 6000, Rohan 2400, Papa 600', who(meera.id).paid === 600000 && who(rohan.id).paid === 240000 && who(papa.id).paid === 60000);
  ok('WHO OWES WHOM, in two transfers: Papa pays Meera 2400, Rohan pays Meera 600', L.owes.length === 2
     && L.owes.some(o => o.from === papa.id && o.to === meera.id && o.amount === 240000 && o.fromName === 'Papa' && o.toName === 'Meera')
     && L.owes.some(o => o.from === rohan.id && o.to === meera.id && o.amount === 60000), JSON.stringify(L.owes));
  ok('each line says whose it is to act on', L.owes.find(o => o.from === rohan.id).mine === 'pay' && L.owes.find(o => o.from === papa.id).mine === null
     && (await costs(meera, trip)).owes.every(o => o.mine === 'receive'));

  // A remainder: 100 between three.
  const odd = await P(meera, { action: 'split_add', planId: trip, what: 'Chai', amount: '100' });
  const sh = (await admin.query(`select share_paise::int as s from plan_cost_shares where cost_id = $1 order by member_id`, [odd.id])).rows.map(r => r.s);
  ok('100 between three is 33.34, 33.33, 33.33: the shares always add up', sh.join() === '3334,3333,3333' && sh.reduce((a, b) => a + b, 0) === 10000, sh.join());
  await P(meera, { action: 'split_remove', id: odd.id });

  // Uneven.
  const un = await P(meera, { action: 'split_add', planId: trip, what: 'Dinner', amount: '1000', mode: 'uneven', shares: { [meera.id]: '600', [rohan.id]: '300' } });
  ok('uneven shares that do not add up are refused, and the reason says both sums', un.status === 400 && un.error === 'The shares add up to 900.00. They must add up to 1000.00.', un.error);
  const un2 = await P(meera, { action: 'split_add', planId: trip, what: 'Dinner', amount: '1000', mode: 'uneven', shares: { [meera.id]: '600', [rohan.id]: '300.50', [papa.id]: '99.50' } });
  const us = (await admin.query(`select member_id, share_paise::int as s from plan_cost_shares where cost_id = $1`, [un2.id])).rows;
  ok('uneven shares that add up are kept as typed', un2.status === 201 && us.find(x => x.member_id === rohan.id).s === 30050 && us.find(x => x.member_id === papa.id).s === 9950 && us.reduce((a, x) => a + x.s, 0) === 100000);
  await P(meera, { action: 'split_remove', id: un2.id });
}

// ---- who can change or remove a cost
{
  ok('PAPA, who neither added the taxi nor made the plan, cannot change it', (await P(papa, { action: 'split_edit', id: taxi.id, what: 'Taxi', amount: '1' })).status === 403);
  ok('nor remove it', (await P(papa, { action: 'split_remove', id: taxi.id })).status === 403);
  ok('Bua, not on the plan, cannot either', (await P(bua, { action: 'split_remove', id: taxi.id })).status === 403);
  ok('an outsider cannot either', (await P(vikram, { action: 'split_remove', id: taxi.id })).status === 404);
  ok('the screen is told who may edit what', await (async () => {
    const forPapa = await costs(papa, trip), forRohan = await costs(rohan, trip), forMeera = await costs(meera, trip);
    return forPapa.costs.every(c => !c.canEdit) && forRohan.costs.find(c => c.id === taxi.id).canEdit && !forRohan.costs.find(c => c.id === rooms.id).canEdit && forMeera.costs.every(c => c.canEdit);
  })());
  const ed = await P(rohan, { action: 'split_edit', id: taxi.id, what: 'Taxi, both ways', amount: '2400', paidBy: rohan.id, between: [meera.id, rohan.id, papa.id] });
  ok('ROHAN, who added the taxi, can change it', ed.status === 200 && (await one(`select what from plan_costs where id = $1`, [taxi.id])).what === 'Taxi, both ways');
  const ed2 = await P(meera, { action: 'split_edit', id: taxi.id, what: 'Taxi', amount: '2400', paidBy: rohan.id, between: [meera.id, rohan.id] });
  ok('MEERA, who made the plan, can change it too, and the shares follow', ed2.status === 200
     && (await admin.query(`select share_paise::int as s from plan_cost_shares where cost_id = $1 order by member_id`, [taxi.id])).rows.map(r => r.s).join() === '120000,120000');
  await P(meera, { action: 'split_edit', id: taxi.id, what: 'Taxi from the airport', amount: '2400', paidBy: rohan.id, between: [meera.id, rohan.id, papa.id] });
  ok('an edit is checked like a new cost', (await P(rohan, { action: 'split_edit', id: taxi.id, what: 'Taxi', amount: 'lots' })).status === 400);
  const extra = await P(papa, { action: 'split_add', planId: trip, what: 'Water', amount: '60' });
  ok('whoever added a cost can remove it', (await P(papa, { action: 'split_remove', id: extra.id })).status === 200 && (await one(`select count(*)::int as n from plan_costs where plan_id = $1`, [trip])).n === 3);
  ok('a cost that is gone is not found', (await P(papa, { action: 'split_remove', id: extra.id })).status === 404);
}

// ---- someone who shares a cost can see the plan's costs, without being "going"
{
  const c = await P(meera, { action: 'split_add', planId: trip, what: 'Gift for Bua', amount: '500', between: [bua.id] });
  const r = await costs(bua, trip);
  ok('BUA now shares a cost, so she can see the costs', r.status === 200 && r.costs.length === 4);
  await P(meera, { action: 'split_remove', id: c.id });
  ok('and once that cost is gone, she cannot', (await costs(bua, trip)).status === 403);
  const d = await P(meera, { action: 'split_add', planId: trip, what: 'For Dadi', amount: '300', between: [dadi.id], paidBy: meera.id });
  ok('a relative who is not on the app can share a cost by name', d.status === 201);
  await P(meera, { action: 'split_remove', id: d.id });
}

// ================================================================ the UPI id: only what the viewer may already see
const everything = async (who) => JSON.stringify(await costs(who, trip)) + JSON.stringify(await list(who));
{
  let r = await costs(rohan, trip);
  const line = () => r.owes.find(o => o.from === rohan.id && o.to === meera.id);
  ok('with no UPI id saved, Rohan is told to ask Meera, and there is no link', line().askUpi === true && !line().upi);
  const m = await pay(meera, { action: 'add', kind: 'upi', label: 'Meera HDFC UPI', handle: 'meera.kapoor@okhdfcbank' });
  ok('Meera saves her UPI id in ways to pay', m.status === 201);
  r = await costs(rohan, trip);
  ok('SAVED BUT NOT SHARED: still no link, and Rohan is told to ask', line().askUpi === true && !line().upi);
  ok('THE ID APPEARS NOWHERE in what Rohan is sent', !/okhdfcbank|meera\.kapoor|upi:\/\//.test(await everything(rohan)));
  ok('nor in what Papa is sent', !/okhdfcbank|meera\.kapoor|upi:\/\//.test(await everything(papa)));
  await pay(meera, { action: 'allow', id: m.id, targetId: rohan.id });
  r = await costs(rohan, trip);
  ok('ONCE MEERA ALLOWS ROHAN, his line carries the link, exactly', line().upi === 'upi://pay?pa=meera.kapoor%40okhdfcbank&pn=Meera&am=600.00&cu=INR&tn=Goa%20trip' && !line().askUpi, line().upi);
  ok('PAPA, who was not allowed, still gets no id and no link anywhere', !/okhdfcbank|meera\.kapoor|upi:\/\//.test(await everything(papa)) && (await costs(papa, trip)).owes.find(o => o.from === papa.id).askUpi === true);
  ok('MEERA herself gets no link (she is the one being paid)', !/upi:\/\//.test(await everything(meera)));
  ok('the link is only on the line Rohan has to pay', r.owes.filter(o => o.upi).length === 1);
  // A saved id that is not shaped like one makes no link.
  await admin.query(`update pay_methods set handle = 'meera kapoor & am=1' where id = $1`, [m.id]);
  r = await costs(rohan, trip);
  ok('a saved id that is not shaped like a UPI id makes no link', !line().upi && line().askUpi === true && !/upi:\/\//.test(JSON.stringify(r)));
  await admin.query(`update pay_methods set handle = 'meera.kapoor@okhdfcbank' where id = $1`, [m.id]);
  // A card is not a UPI id.
  const card = await pay(meera, { action: 'add', kind: 'card', label: 'Meera card', handle: 'card@notupi' });
  await pay(meera, { action: 'allow', id: card.id, targetId: papa.id });
  ok('a way to pay that is not UPI never becomes a link', !/upi:\/\//.test(await everything(papa)));
  await pay(meera, { action: 'disallow', id: m.id, targetId: rohan.id });
  ok('WHEN MEERA TAKES IT BACK, the link goes too', !/okhdfcbank|upi:\/\//.test(await everything(rohan)));
  await pay(meera, { action: 'allow', id: m.id, targetId: rohan.id });
}

// ================================================================ settling up: two-sided, and undoable
{
  ok('a tap on I have paid marks the line of whoever tapped, never someone else\'s', (await P(papa, { action: 'split_paid', planId: trip, to: meera.id })).status === 201
     && (await one(`select from_member from plan_settles where plan_id = $1`, [trip])).from_member === papa.id);
  // That was Papa's own line (2400). Undo it so the story starts clean.
  const papaRow = await one(`select id from plan_settles where plan_id = $1 and from_member = $2`, [trip, papa.id]);
  ok('Rohan cannot undo Papa\'s mark', (await P(rohan, { action: 'split_undo', id: papaRow.id })).status === 403);
  ok('Meera cannot undo it either: she has not marked anything', (await P(meera, { action: 'split_undo', id: papaRow.id })).status === 403);
  ok('Papa undoes his own', (await P(papa, { action: 'split_undo', id: papaRow.id })).status === 200 && (await one(`select count(*)::int as n from plan_settles`)).n === 0);

  ok('nothing is owed from Meera to Rohan, so she cannot mark it paid', (await P(meera, { action: 'split_paid', planId: trip, to: rohan.id })).status === 409);
  ok('nobody pays themselves', (await P(rohan, { action: 'split_paid', planId: trip, to: rohan.id })).status === 400);
  ok('Bua and an outsider cannot mark anything', (await P(bua, { action: 'split_paid', planId: trip, to: meera.id })).status === 403 && (await P(vikram, { action: 'split_paid', planId: trip, to: meera.id })).status === 404);

  const paid = await P(rohan, { action: 'split_paid', planId: trip, to: meera.id, amount: '1' });
  let row = await one(`select amount_paise::int as a, paid_at, received_at from plan_settles where id = $1`, [paid.id]);
  ok('ROHAN TAPS "I have paid": the amount is the one the sums give, not one the phone sends', paid.status === 201 && paid.closed === false && row.a === 60000 && row.paid_at && !row.received_at);
  ok('a second tap is not a second line', (await P(rohan, { action: 'split_paid', planId: trip, to: meera.id })).status === 409 && (await one(`select count(*)::int as n from plan_settles`)).n === 1);
  let r = await costs(meera, trip);
  ok('THE DEBT IS NOT GONE: it shows as waiting for Meera, who can confirm', r.waiting.length === 1 && r.waiting[0].from === rohan.id && r.waiting[0].amount === 60000 && r.waiting[0].paid && !r.waiting[0].received
     && r.waiting[0].canConfirm === true && r.waiting[0].canUndo === false && r.settled.length === 0);
  ok('and it is no longer in "who owes whom", so it is not paid twice', !r.owes.some(o => o.from === rohan.id));
  r = await costs(rohan, trip);
  ok('Rohan can undo, and cannot confirm his own word', r.waiting[0].canUndo === true && r.waiting[0].canConfirm === false);
  ok('Rohan cannot tap Received for himself', (await P(rohan, { action: 'split_received', planId: trip, from: rohan.id })).status === 400);
  ok('Papa cannot confirm for Meera', (await P(papa, { action: 'split_received', planId: trip, from: rohan.id })).status === 409 && !(await one(`select received_at from plan_settles where id = $1`, [paid.id])).received_at);

  // Undo before the other confirms.
  ok('ROHAN UNDOES before Meera confirms', (await P(rohan, { action: 'split_undo', id: paid.id })).status === 200);
  r = await costs(rohan, trip);
  ok('and the line is back in "who owes whom"', r.waiting.length === 0 && r.owes.some(o => o.from === rohan.id && o.to === meera.id && o.amount === 60000));

  // Again, and this time Meera confirms.
  const again = await P(rohan, { action: 'split_paid', planId: trip, to: meera.id });
  const rec1 = await P(meera, { action: 'split_received', planId: trip, from: rohan.id });
  row = await one(`select paid_at, received_at from plan_settles where id = $1`, [again.id]);
  ok('MEERA TAPS "Received": the line is closed, by both', rec1.status === 200 && rec1.closed === true && rec1.id === again.id && row.paid_at && row.received_at);
  ok('once both have confirmed, neither can undo', (await P(rohan, { action: 'split_undo', id: again.id })).status === 409 && (await P(meera, { action: 'split_undo', id: again.id })).status === 409);
  r = await costs(papa, trip);
  ok('it is listed as settled, and only Papa still owes', r.settled.length === 1 && r.settled[0].from === rohan.id && r.waiting.length === 0 && r.owes.length === 1 && r.owes[0].from === papa.id && r.owes[0].amount === 240000);
  ok('Rohan is square', r.people.find(p => p.memberId === rohan.id).net === 0);

  // The other order: Meera says Received first, then Papa agrees.
  const first = await P(meera, { action: 'split_received', planId: trip, from: papa.id });
  row = await one(`select paid_at, received_at, amount_paise::int as a from plan_settles where id = $1`, [first.id]);
  ok('THE OTHER ORDER: Meera taps Received first, and it waits for Papa', first.status === 201 && first.closed === false && !row.paid_at && row.received_at && row.a === 240000);
  r = await costs(papa, trip);
  ok('Papa is asked to confirm; Meera can undo', r.waiting[0].canConfirm === true && r.waiting[0].canUndo === false && (await costs(meera, trip)).waiting[0].canUndo === true);
  ok('Papa cannot undo Meera\'s mark', (await P(papa, { action: 'split_undo', id: first.id })).status === 403);
  ok('Meera undoes it before Papa confirms', (await P(meera, { action: 'split_undo', id: first.id })).status === 200);
  const second = await P(meera, { action: 'split_received', planId: trip, from: papa.id });
  const agree = await P(papa, { action: 'split_paid', planId: trip, to: meera.id });
  ok('then Papa taps "I have paid" and it closes', agree.status === 200 && agree.closed === true && agree.id === second.id);
  r = await costs(meera, trip);
  ok('EVERYONE IS SQUARE: nothing owed, nothing waiting, two settled', r.owes.length === 0 && r.waiting.length === 0 && r.settled.length === 2 && r.people.every(p => p.net === 0), JSON.stringify(r.people));
  ok('an id that is not an id, or a line that is gone, is refused', (await P(meera, { action: 'split_undo', id: 'x' })).status === 400 && (await P(meera, { action: 'split_undo', id: first.id })).status === 404);
  ok('an unknown split action is refused', (await P(meera, { action: 'split_everything' })).status === 400);
  ok('nothing about money went to the family feed', (await one(`select count(*)::int as n from events where circle_id = $1 and (text ilike '%paid%' or text ilike '%owes%' or text ilike '%Rooms%')`, [fam])).n === 0);
}

// ================================================================ a plan that is not in rupees
{
  const t = (await P(anil, { action: 'create', kind: 'trip', title: 'Lake District', at: soon(3000) })).id;
  await P(sara, { action: 'rsvp', planId: t });
  await P(anil, { action: 'split_add', planId: t, what: 'Cottage', amount: '300', paidBy: anil.id });
  const sm = await pay(anil, { action: 'add', kind: 'upi', label: 'Anil UPI', handle: 'anil@okaxis' });
  await pay(anil, { action: 'allow', id: sm.id, targetId: sara.id });
  const r = await costs(sara, t);
  ok('the plan is in pounds: its maker lives in the UK', r.currency === 'GBP' && r.upiOk === false && (await one(`select cost_currency from plans where id = $1`, [t])).cost_currency === 'GBP');
  ok('Sara owes Anil 150', r.owes.length === 1 && r.owes[0].from === sara.id && r.owes[0].amount === 15000 && r.owes[0].mine === 'pay');
  ok('NO UPI LINK on a plan that is not in rupees, even with an id she may see', !r.owes[0].upi && !r.owes[0].askUpi && !/upi:\/\/|okaxis/.test(JSON.stringify(r)));
  ok('she can still say she has paid, and Anil can confirm', (await P(sara, { action: 'split_paid', planId: t, to: anil.id })).status === 201 && (await P(anil, { action: 'split_received', planId: t, from: sara.id })).closed === true);
  ok('the family in the other circle cannot see this plan\'s costs', (await costs(meera, t)).status === 404);
}

// ---- removing the plan removes its costs
{
  await P(meera, { action: 'cancel', planId: trip });
  ok('cancelling the plan takes its costs and lines with it', (await one(`select count(*)::int as n from plan_costs where plan_id = $1`, [trip])).n === 0 && (await one(`select count(*)::int as n from plan_settles where plan_id = $1`, [trip])).n === 0);
  ok('and its costs are not found any more', (await costs(meera, trip)).status === 404);
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`plantogether.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); fails.forEach(f => console.error('  FAIL ' + f)); process.exit(1); }
console.log(`plantogether.dbtest: ${pass}/${pass} checks pass`);
