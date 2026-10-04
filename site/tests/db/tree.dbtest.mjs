// THE FAMILY TREE AGAINST A REAL DATABASE: the real /api/circle "place"
// action and the real /api/events read, on the real schema.
//
// What it proves:
//   - a joint family can be started, and says so;
//   - anyone in the family can place anyone, and the links land;
//   - each person sees the others in their own words (Father, Father-in-law,
//     Daughter-in-law, Chacha, Great-grandson) across four generations;
//   - what cannot be true is refused (two wives, being your own grandfather);
//   - nobody outside the family can place anyone;
//   - unplacing someone removes their links on both sides.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('tree.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('tree.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: circleApi } = await import('../../../api/circle.mjs');
const { default: eventsApi } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.1.1.1' }, query, body };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...json, status };
}
let n = 0;
async function user(name) {
  const phone = '+9198700' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token };
}

// Papa starts a joint family.
const U = { papa: await user('Papa') };
const made = await call(circleApi, { token: U.papa.token, body: { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Papa', circleName: 'Sachdeva Family', userId: U.papa.userId, relation: 'father' } });
ok('a joint family can be started', made.status === 201 && made.familyType === 'joint', JSON.stringify(made));
const code = made.code, circleId = (await admin.query('select id from circles where code = $1', [code])).rows[0].id;
ok('and the family remembers it is joint', (await admin.query('select family_type from circles where id = $1', [circleId])).rows[0].family_type === 'joint');
const papa = { id: made.memberId, token: U.papa.token };
ok('Papa is a man, read from "father"', (await admin.query('select gender from members where id = $1', [papa.id])).rows[0].gender === 'm');

// Everyone else joins (straight in, for the test) and is placed by Papa.
await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]);
const M = { papa };
for (const [name, rel] of [['Mumma', 'mother'], ['Rohan', 'son'], ['Priya', 'daughter-in-law'], ['Amit', 'son'], ['Neha', 'daughter-in-law'],
                           ['Aarav', 'grandson'], ['Kabir', 'grandson'], ['Vihaan', null], ['Outsider', null]]) {
  U[name] = await user(name);
  const j = await call(circleApi, { token: U[name].token, body: { action: 'join', code: name === 'Outsider' ? 'NOPE00' : code, memberName: name, userId: U[name].userId, relation: rel } });
  if (name !== 'Outsider') M[name] = { id: j.memberId, token: U[name].token };
}
ok('the new roles are kept: daughter-in-law and grandson', (await admin.query(`select count(*)::int as n from members where relation in ('daughter-in-law','grandson')`)).rows[0].n === 4);

const place = (who, body) => call(circleApi, { token: who.token, body: { action: 'place', code, memberId: who.id, ...body } });
const steps = [
  [papa, M.Mumma, 'spouse', papa],
  [papa, M.Rohan, 'child', papa],
  [papa, M.Amit, 'child', papa],
  [M.Rohan, M.Priya, 'spouse', M.Rohan],      // anyone can place anyone
  [M.Priya, M.Neha, 'spouse', M.Amit],
  [M.Priya, M.Aarav, 'child', M.Rohan],
  [M.Neha, M.Kabir, 'child', M.Amit],
];
for (const [actor, target, where, of] of steps) {
  const r = await place(actor, { targetId: target.id, place: where, ofId: of.id });
  ok(`placing works (${where})`, r.status === 200, JSON.stringify(r));
}
const r4 = await place(M.Aarav, { targetId: M.Vihaan.id, place: 'child', ofId: M.Aarav.id, gender: 'm' });
ok('a fourth generation can be added, with he or she', r4.status === 200 && (await admin.query('select gender from members where id = $1', [M.Vihaan.id])).rows[0].gender === 'm');
ok('the family is told who was added to the tree',
   (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like '%to the family tree as%'`, [circleId])).rows[0].n === 8);

// Each person sees the others in their own words.
const look = async (who) => {
  const r = await call(eventsApi, { method: 'GET', token: who.token, query: { circle: code, member: who.id } });
  const by = {}; for (const m of r.members) by[m.name] = m;
  return { r, by };
};
const priya = await look(M.Priya);
ok('Priya sees Papa as Father-in-law', priya.by.Papa.kin === 'Father-in-law', priya.by.Papa.kin);
ok('and Neha as Sister-in-law', priya.by.Neha.kin === 'Sister-in-law', priya.by.Neha.kin);
ok('and Aarav as Son', priya.by.Aarav.kin === 'Son', priya.by.Aarav.kin);
ok('and herself as You', priya.by.Priya.kin === 'You');
const papaSees = await look(papa);
ok('Papa sees Priya as Daughter-in-law', papaSees.by.Priya.kin === 'Daughter-in-law', papaSees.by.Priya.kin);
ok('and Vihaan as Great-grandson', papaSees.by.Vihaan.kin === 'Great-grandson', papaSees.by.Vihaan.kin);
ok('the read says it is a joint family', papaSees.r.familyType === 'joint' && papaSees.r.kind === 'family');
ok('four generations, numbered from the eldest', papaSees.by.Papa.gen === 1 && papaSees.by.Rohan.gen === 2 && papaSees.by.Aarav.gen === 3 && papaSees.by.Vihaan.gen === 4,
   ['Papa', 'Rohan', 'Aarav', 'Vihaan'].map(k => papaSees.by[k].gen).join());
const aarav = await look(M.Aarav);
ok('Aarav sees Amit as Chacha and Neha as Chachi', aarav.by.Amit.kin === 'Chacha' && aarav.by.Neha.kin === 'Chachi', aarav.by.Amit.kin + '/' + aarav.by.Neha.kin);
ok('and Kabir as Cousin', aarav.by.Kabir.kin === 'Cousin');

// What cannot be true is refused.
ok('Papa cannot have a second wife in the tree', (await place(papa, { targetId: M.Neha.id, place: 'spouse', ofId: papa.id })).status === 409);
ok('nobody becomes their own grandfather', (await place(papa, { targetId: papa.id, place: 'child', ofId: M.Vihaan.id })).status === 409);
ok('a place that is not a family word is refused', (await place(papa, { targetId: M.Vihaan.id, place: 'cousin', ofId: papa.id })).status === 400);

// Nobody outside the family can place anyone.
const outsider = await place({ id: M.Rohan.id, token: U.Outsider.token }, { targetId: M.Rohan.id, place: 'child', ofId: M.Amit.id });
ok('someone outside the family cannot place anyone', outsider.status === 403, outsider.status);
const other = (await admin.query(`insert into circles (code, name) values ('OTHERF','Other') returning id`)).rows[0].id;
const stranger = (await admin.query(`insert into members (circle_id, name) values ($1,'Stranger') returning id`, [other])).rows[0].id;
ok('nor place someone from another family into this one',
   (await place(papa, { targetId: stranger, place: 'child', ofId: papa.id })).status === 404 &&
   (await place(papa, { targetId: M.Kabir.id, place: 'child', ofId: stranger })).status === 404);

// Unplacing removes both sides of a marriage.
const un = await call(circleApi, { token: M.Neha.token, body: { action: 'unplace', code, memberId: M.Neha.id, targetId: M.Neha.id } });
const amitRow = (await admin.query('select spouse_id from members where id = $1', [M.Amit.id])).rows[0];
ok('taking someone out of the tree clears both sides', un.status === 200 && amitRow.spouse_id === null);
ok('and they are no longer labelled', (await look(M.Priya)).by.Neha.kin === null);

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`tree.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`tree.dbtest: ${pass}/${pass} checks pass`);
