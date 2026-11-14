// THE WIDER FAMILY against a real database: linked families, family facts
// and days of remembrance, through the real /api/circle handler and the
// real sweeps.
//
// What it proves:
//   - a link needs a yes from an adult of the other family; a declined or an
//     ended link exposes nothing;
//   - only the allowed fields cross a link (name, he or she, the two tree
//     links, the YEAR of birth, the city, and a phone only when that side
//     ticked it); family facts and days of remembrance never cross;
//   - a member of a linked family is refused by every other route of the
//     other family: events, book, plans, chats, care, games, Ekta, circle;
//   - at most 6 active links per family;
//   - who sees a family fact is decided in SQL (whole family, people I
//     choose, only me), and who may change it (the writer, or an elder);
//   - someone marked as no longer with us gets no birthday card from
//     sweepBond, no check-in, no nudge and no recommendation;
//   - the yearly reminder is claimed once, even when the timer runs twice at
//     the same moment.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('widerfamily.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('widerfamily.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const api = {};
for (const n of ['circle', 'events', 'book', 'plans', 'chats', 'care', 'games', 'ekta']) api[n] = (await import(`../../../api/${n}.mjs`)).default;
const { runTick } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const Rm = await import('../../../api/_remember.mjs');
const Bond = await import('../../../api/_bond.mjs');
const Fc = await import('../../../api/_familycare.mjs');
const Mb = await import('../../../api/_memorybond.mjs');
const { ensureTaskSchema } = await import('../../../api/_tasks.mjs');
const { wallIn } = await import('../../../api/_rememberrules.mjs');
const { LINK_SLOW, LINK_COOL } = await import('../../../api/_famlink.mjs');
const sql = db();
await ensureSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

let n = 0;
async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-parwah-tz': 'Asia/Kolkata', 'x-forwarded-for': '10.7.' + (++n % 250) + '.' + (n % 199) }, query, body };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...(json || {}), status };
}
async function user(name) {
  const phone = '+9198720' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}
// A family made through the real API: the first person creates it, the rest join.
async function family(circleName, names, kind = 'family') {
  const out = {}; let code = null, circleId = null;
  for (const item of names) {
    const [name, role, existing] = Array.isArray(item) ? item : [item, 'family', null];
    const u = existing || await user(name);
    const r = code
      ? await call(api.circle, { token: u.token, body: { action: 'join', code, memberName: name, userId: u.userId, role } })
      : await call(api.circle, { token: u.token, body: { action: 'create', kind, memberName: name, circleName, userId: u.userId, role } });
    if (!code) { code = r.code; circleId = (await admin.query('select id from circles where code = $1', [code])).rows[0].id; await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]); }
    out[name] = { ...u, id: r.memberId, code };
  }
  return { code, id: circleId, name: circleName, m: out };
}
const act = (who, action, body, code) => call(api.circle, { token: who.token, body: { action, code: code || who.code, memberId: who.id, ...(body || {}) } });
const tree = async (who, action, name, place, ofId, gender) => {
  const body = { place, ofId, gender };
  if (action === 'add_person') body.personName = name; else body.targetId = name;
  const r = await act(who, action, body);
  return r.memberId;
};
const idOf = async (circleId, name) => (await admin.query('select id from members where circle_id = $1 and name = $2', [circleId, name])).rows[0].id;

// ---- the two families. Kavya is one person, a member of both.
const kavyaU = await user('Kavya');
const A = await family('Sharma Family', ['Arjun', ['Ramesh', 'parent'], ['Kavya', 'family', kavyaU], 'Bharat', 'Chintu', 'Nani']);
const B = await family('Verma Family', [['Kishan', 'parent'], 'Sarla', ['Kavya', 'family', kavyaU], 'Karan', 'Tinku']);
const a = A.m, b = B.m;
ok('one person is a member of both families', a.Kavya.id !== b.Kavya.id && a.Kavya.userId === b.Kavya.userId);
// The Sharma tree: Ramesh and Geeta, their sons Arjun and Bharat, Arjun's wife Kavya, her father added by name.
await tree(a.Arjun, 'place', a.Ramesh.id, 'parent', a.Arjun.id, 'm');
await act(a.Arjun, 'place', { targetId: a.Arjun.id, place: 'child', ofId: a.Ramesh.id, gender: 'm' });
await tree(a.Arjun, 'add_person', 'Geeta', 'spouse', a.Ramesh.id, 'f');
await tree(a.Arjun, 'place', a.Kavya.id, 'spouse', a.Arjun.id, 'f');
await tree(a.Arjun, 'place', a.Bharat.id, 'sibling', a.Arjun.id, 'm');
await tree(a.Arjun, 'add_person', 'Dadaji', 'parent', a.Ramesh.id, 'm');
await tree(a.Arjun, 'add_person', 'Kishan Verma', 'parent', a.Kavya.id, 'm');
// The Verma tree: Kishan and Sarla, their children Kavya and Karan, Karan's wife and daughter by name.
await tree(b.Kishan, 'place', b.Sarla.id, 'spouse', b.Kishan.id, 'f');
await act(b.Kishan, 'place', { targetId: b.Kishan.id, place: 'spouse', ofId: b.Sarla.id, gender: 'm' });
await tree(b.Kishan, 'place', b.Kavya.id, 'child', b.Kishan.id, 'f');
await tree(b.Kishan, 'place', b.Karan.id, 'child', b.Kishan.id, 'm');
await tree(b.Kishan, 'add_person', 'Meena', 'spouse', b.Karan.id, 'f');
await tree(b.Kishan, 'add_person', 'Tara', 'child', b.Karan.id, 'f');
const idA = (nm) => idOf(A.id, nm), idB = (nm) => idOf(B.id, nm);
ok('both trees are built through the real tree API', (await admin.query('select count(*)::int as n from members where parent_id is not null or spouse_id is not null')).rows[0].n >= 11);
// Profile details, set as the profile would. Chintu and Tinku are children.
await admin.query(`update members set dob = '2012-05-05' where id = any($1::uuid[])`, [[a.Chintu.id, b.Tinku.id]]);
await admin.query(`update members set dob = '1990-02-02', place = 'Pune', country = 'IN', relation = 'son', gift_info = '{"likes":"cricket-secret"}'::jsonb where id = $1`, [b.Karan.id]);
await admin.query(`update members set dob = '1988-09-30', place = 'Jaipur' where id = $1`, [a.Arjun.id]);
const C = await family('Other Family', ['Stranger']);
const G = await family('College friends', ['Asha'], 'group');

// =================================================================== LINKS
let r = await act(a.Arjun, 'link_state');
ok('a family starts with no links, and a limit of 6', r.status === 200 && r.links.length === 0 && r.incoming.length === 0 && r.outgoing.length === 0 && r.max === 6, JSON.stringify(r));
ok('an outsider cannot read a family\'s links', (await act({ ...C.m.Stranger, id: a.Arjun.id }, 'link_state', {}, A.code)).status === 403);
ok('no session, no links', (await call(api.circle, { token: undefined, body: { action: 'link_state', code: A.code, memberId: a.Arjun.id } })).status === 403);
ok('a group of friends has no tree to link', (await act(G.m.Asha, 'link_state')).status === 400);
ok('a wrong code finds no family', (await act(a.Arjun, 'link_request', { otherCode: 'ZZZZ99', bridgeId: a.Kavya.id })).status === 404);
ok('your own code is refused', (await act(a.Arjun, 'link_request', { otherCode: A.code, bridgeId: a.Kavya.id })).status === 400);
ok('a group\'s code is refused', (await act(a.Arjun, 'link_request', { otherCode: G.code, bridgeId: a.Kavya.id })).status === 400);
ok('the bridge must be named', (await act(a.Arjun, 'link_request', { otherCode: B.code })).status === 400);
ok('and must be in the family that asks', (await act(a.Arjun, 'link_request', { otherCode: B.code, bridgeId: b.Karan.id })).status === 400);

r = await act(a.Arjun, 'link_request', { otherCode: B.code, bridgeId: a.Kavya.id });
ok('Arjun asks the Vermas to link, naming Kavya: it waits for them', r.status === 202 && r.pending === true && r.otherName === 'Verma Family', JSON.stringify(r));
const link1 = r.linkId;
let sa = await act(a.Arjun, 'link_state'), sb = await act(b.Karan, 'link_state');
ok('before a yes, the family that asked sees nothing of the other', sa.links.length === 0 && sa.outgoing.length === 1 && !/Sarla|Karan|Meena|Tara/.test(JSON.stringify(sa)), JSON.stringify(sa));
ok('the family that was asked sees who asks and who the bridge is, and nothing else', sb.links.length === 0 && sb.incoming.length === 1 && sb.incoming[0].fromName === 'Sharma Family'
   && sb.incoming[0].bridgeName === 'Kavya' && sb.incoming[0].askedBy === 'Arjun' && !/Ramesh|Bharat|Geeta|Dadaji/.test(JSON.stringify(sb)), JSON.stringify(sb));
ok('the same sign-in in both families is found as the bridge', sb.incoming[0].guess === b.Kavya.id);
ok('asking twice is refused', (await act(a.Bharat, 'link_request', { otherCode: B.code, bridgeId: a.Kavya.id })).status === 409);
ok('and so is asking back while one waits', (await act(b.Karan, 'link_request', { otherCode: A.code, bridgeId: b.Kavya.id })).status === 409);
ok('the family that asked cannot say yes to itself', (await act(a.Arjun, 'link_approve', { linkId: link1 })).status === 404);
ok('a stranger cannot say yes', (await act(C.m.Stranger, 'link_approve', { linkId: link1 })).status === 404);
ok('a child of the family cannot say yes', (await act(b.Tinku, 'link_approve', { linkId: link1 })).status === 403);
ok('nor no', (await act(b.Tinku, 'link_decline', { linkId: link1 })).status === 403);
ok('an adult says no', (await act(b.Sarla, 'link_decline', { linkId: link1 })).status === 200);
sa = await act(a.Arjun, 'link_state'); sb = await act(b.Karan, 'link_state');
ok('a declined link exposes nothing to either side', sa.links.length + sa.outgoing.length + sa.incoming.length === 0 && sb.links.length + sb.incoming.length + sb.outgoing.length === 0
   && !/Sarla|Karan|Meena/.test(JSON.stringify(sa)) && !/Ramesh|Bharat/.test(JSON.stringify(sb)));
ok('a no cannot be turned into a yes later', (await act(b.Kishan, 'link_approve', { linkId: link1 })).status === 404);

// Things in the Verma home that must never cross.
ok('the Vermas write a family fact', (await act(b.Kishan, 'fact_add', { kind: 'gotra', text: 'Kashyap-fact-secret' })).status === 201);
ok('and mark Kishan\'s late father, with a line', (await (async () => {
  const dadaV = await tree(b.Kishan, 'add_person', 'Dada Verma', 'parent', b.Kishan.id, 'm');
  return act(b.Sarla, 'remember_mark', { targetId: dadaV, year: 2011, month: 6, day: 9, line: 'remember-line-secret' });
})()).status === 200);

// A no stands for a week: the same two families cannot ask again at once, from either side.
const feedB = async () => (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like '%asked to link family trees%'`, [B.id])).rows[0].n;
const fb0 = await feedB();
r = await act(a.Arjun, 'link_request', { otherCode: B.code, bridgeId: a.Kavya.id });
ok('after a no, the same family cannot ask again for 7 days', r.status === 409 && r.error === 'A request between your two families was closed in the last 7 days. You can ask again after that.' && !r.linkId, JSON.stringify(r));
ok('nor can the other family ask back', (await act(b.Karan, 'link_request', { otherCode: A.code, bridgeId: b.Kavya.id })).status === 409);
ok('and the family that said no heard nothing more', (await feedB()) === fb0 && (await admin.query(`select count(*)::int as n from family_links where status = 'pending'`)).rows[0].n === 0);
await admin.query(`update family_links set decided_at = now() - interval '6 days 23 hours' where id = $1`, [link1]);
ok('six days and 23 hours later it is still too soon', (await act(a.Arjun, 'link_request', { otherCode: B.code, bridgeId: a.Kavya.id })).status === 409);
await admin.query(`update family_links set decided_at = now() - interval '8 days' where id = $1`, [link1]);
r = await act(a.Arjun, 'link_request', { otherCode: B.code, bridgeId: a.Kavya.id, sharePhones: false });
ok('after the week, Arjun asks again, without sharing phone numbers', r.status === 202);
const link2 = r.linkId;
ok('a bridge from another family is refused at the yes', (await act(b.Kishan, 'link_approve', { linkId: link2, bridgeId: a.Arjun.id })).status === 400);
r = await act(b.Kishan, 'link_approve', { linkId: link2, sharePhones: true });
ok('Kishan says yes, and ticks "share phone numbers" for his side', r.status === 200, JSON.stringify(r));
ok('a second yes does nothing', (await act(b.Sarla, 'link_approve', { linkId: link2 })).status === 404);

sa = await act(a.Arjun, 'link_state'); sb = await act(b.Karan, 'link_state');
const LA = sa.links[0], LB = sb.links[0];
ok('each side now has one linked family, by name', sa.links.length === 1 && LA.name === 'Verma Family' && sb.links.length === 1 && LB.name === 'Sharma Family');
const ALLOWED = ['born', 'city', 'gen', 'gender', 'id', 'kin', 'name', 'parent_id', 'phone', 'rz', 'same', 'spouse_id'];
const keysOk = (L) => L.people.every(p => Object.keys(p).sort().join() === ALLOWED.join());
ok('only the allowed fields cross, for every person, both ways', keysOk(LA) && keysOk(LB), JSON.stringify(LA.people[0]));
const pa = (nm) => LA.people.find(p => p.name === nm), pb = (nm) => LB.people.find(p => p.name === nm);
ok('everyone of the other family is there, people not on Parwah included', LA.people.length === 8 && !!pa('Meena') && !!pa('Tara') && LB.people.length === 9, LA.people.map(p => p.name).join());
ok('the year of birth crosses, never the date', pa('Karan').born === 1990 && !/1990-02-02|02-02/.test(JSON.stringify(sa)) && pb('Arjun').born === 1988 && !/1988-09-30|09-30/.test(JSON.stringify(sb)));
ok('the city crosses', pa('Karan').city === 'Pune' && pb('Arjun').city === 'Jaipur');
ok('the tree links cross', pa('Karan').parent_id === b.Kishan.id && pa('Meena').spouse_id === b.Karan.id && pa('Tara').parent_id === b.Karan.id);
ok('the Vermas ticked phones: the Sharmas see the numbers the Verma family already sees', pa('Karan').phone === b.Karan.phone && pa('Sarla').phone === b.Sarla.phone && pa('Meena').phone === null);
ok('the Sharmas did not tick: the Vermas see no Sharma number', LB.people.every(p => p.phone === null) && !JSON.stringify(sb).includes(a.Arjun.phone));
ok('each side is told what it shares and what the other shares', LA.weShare === false && LA.theyShare === true && LB.weShare === true && LB.theyShare === false);
const leak = JSON.stringify(sa) + JSON.stringify(await act(a.Kavya, 'link_state')) + JSON.stringify(await act(a.Ramesh, 'link_state'));
ok('family facts never cross a link', !/Kashyap-fact-secret|gotra/i.test(leak));
ok('nor a day of remembrance, its line, a gift list, a role, a country or a code', !/remember-line-secret|remembered|passed_|cricket-secret|gift|relation|country|"IN"/.test(leak) && !leak.includes(B.code));
ok('a child cannot change what the family shares', (await act(a.Chintu, 'link_phones', { linkId: link2, on: true })).status === 403);
ok('an adult can: the Sharmas now share numbers too', (await act(a.Ramesh, 'link_phones', { linkId: link2, on: true })).status === 200
   && (await act(b.Karan, 'link_state')).links[0].people.find(p => p.name === 'Arjun').phone === a.Arjun.phone);
ok('and can take it back, at once', (await act(a.Ramesh, 'link_phones', { linkId: link2, on: false })).status === 200
   && (await act(b.Karan, 'link_state')).links[0].people.every(p => p.phone === null));

// The relations, worked out through the bridge.
const rzOf = (p) => [p.kin, p.rz && p.rz.hindi, p.rz && p.rz.group, p.rz && p.rz.chain].map(String).join(' / ');
ok('Arjun: Sarla is Saas, through his wife', rzOf(pa('Sarla')) === "Mother-in-law / Saas / kareebi / Your wife Kavya's mother", rzOf(pa('Sarla')));
ok('Arjun: Karan is Saala, Meena is Salhaj, Tara a niece', pa('Karan').rz.hindi === 'Saala' && pa('Meena').rz.hindi === 'Salhaj' && pa('Tara').kin === 'Niece', [rzOf(pa('Karan')), rzOf(pa('Meena')), rzOf(pa('Tara'))].join(' ; '));
ok('Arjun: the Verma grandfather is Grandfather-in-law, with the chain through two people', rzOf(pa('Dada Verma')) === "Grandfather-in-law / null / kareebi / Your wife Kavya's father Kishan's father", rzOf(pa('Dada Verma')));
ok('the bridge, and her father added by name, are marked as the same person', pa('Kavya').same === a.Kavya.id && pa('Kishan').same === await idA('Kishan Verma'));
ok('Karan: Arjun is Jija, through his sister', rzOf(pb('Arjun')) === "Brother-in-law / Jija / kareebi / Your sister Kavya's husband", rzOf(pb('Arjun')));
ok('Karan: Arjun\'s brother has no single word, so the chain is told', pb('Bharat').rz.group === 'door' && pb('Bharat').rz.chain === "Your sister Kavya's husband Arjun's brother" && /Sister's husband's brother/.test(pb('Bharat').kin), rzOf(pb('Bharat')));
const kv = (await act(a.Kavya, 'link_state')).links[0].people;
ok('Kavya, in her husband\'s home, sees her own mother at home', kv.find(p => p.name === 'Sarla').kin === 'Mother' && kv.find(p => p.name === 'Sarla').rz.group === 'ghar');

// A member of one family can call NO other route of the family they are linked to.
const tries = [];
const refuse = async (label, handler, opts) => { const x = await call(handler, { token: a.Arjun.token, ...opts }); tries.push(label + ' ' + x.status); return x.status === 403 || x.status === 401; };
const asWho = [['his own id', a.Arjun.id], ['a Verma id he was shown', b.Karan.id], ['a by-name Verma', await idB('Meena')]];
let allRefused = true;
for (const [what, mid] of asWho) {
  const q = { circle: B.code, member: mid }, p = { code: B.code, memberId: mid };
  for (const [label, handler, opts] of [
    ['events GET', api.events, { method: 'GET', query: q }],
    ['events check-in', api.events, { body: { ...p, type: 'checkin' } }],
    ['events message', api.events, { body: { ...p, type: 'message', text: 'hello' } }],
    ['book GET', api.book, { method: 'GET', query: q }],
    ['book vault GET', api.book, { method: 'GET', query: { ...q, area: 'vault' } }],
    ['book register GET', api.book, { method: 'GET', query: { ...q, area: 'locator' } }],
    ['book notes GET', api.book, { method: 'GET', query: { ...q, area: 'notes' } }],
    ['book memory GET', api.book, { method: 'GET', query: { ...q, area: 'bond' } }],
    ['plans GET', api.plans, { method: 'GET', query: q }],
    ['plans bond GET', api.plans, { method: 'GET', query: { ...q, area: 'bond' } }],
    ['plans POST', api.plans, { body: { ...p, action: 'create', title: 'x' } }],
    ['chats GET', api.chats, { method: 'GET', query: q }],
    ['chats POST', api.chats, { body: { ...p, action: 'send', text: 'hello' } }],
    ['care GET', api.care, { method: 'GET', query: q }],
    ['care POST', api.care, { body: { ...p, action: 'request', title: 'x' } }],
    ['games GET', api.games, { method: 'GET', query: q }],
    ['pasand GET', api.games, { method: 'GET', query: { ...q, area: 'pasand' } }],
    ['ekta POST', api.ekta, { body: { ...p, messages: [{ role: 'user', content: 'who is in this family?' }] } }],
    ['circle fact_list', api.circle, { body: { ...p, action: 'fact_list' } }],
    ['circle fact_add', api.circle, { body: { ...p, action: 'fact_add', kind: 'custom', text: 'x' } }],
    ['circle link_state', api.circle, { body: { ...p, action: 'link_state' } }],
    ['circle remember_mark', api.circle, { body: { ...p, action: 'remember_mark', targetId: b.Sarla.id, year: 2020 } }],
    ['circle add_person', api.circle, { body: { ...p, action: 'add_person', personName: 'X', gender: 'm', place: 'child', ofId: b.Karan.id } }],
    ['circle set_code', api.circle, { body: { ...p, action: 'set_code', newCode: 'HACKED' } }],
  ]) if (!(await refuse(what + ': ' + label, handler, opts))) allRefused = false;
}
ok('a linked member is refused by every other route of the other family: events, book, vault, register, notes, plans, chats, care, games, Ekta, circle (' + tries.length + ' tries)', allRefused && tries.length === 72, tries.filter(t => !/ 40[13]$/.test(t)).join(' | '));
ok('nothing was written by any of them', (await admin.query(`select count(*)::int as n from members where circle_id = $1 and name = 'X'`, [B.id])).rows[0].n === 0
   && (await admin.query('select code from circles where id = $1', [B.id])).rows[0].code === B.code
   && (await admin.query(`select count(*)::int as n from family_facts where circle_id = $1`, [B.id])).rows[0].n === 1);
ok('while the bridge, a real member of both, still reads her own second family', (await call(api.events, { method: 'GET', token: kavyaU.token, query: { circle: B.code, member: b.Kavya.id } })).status === 200);

// At most 6 active links.
const extra = [];
for (let i = 1; i <= 6; i++) {
  const c = (await admin.query(`insert into circles (code, name, kind) values ($1, $2, 'family') returning id`, ['EXTRA' + i, 'Extra ' + i])).rows[0].id;
  const m = (await admin.query(`insert into members (circle_id, name) values ($1, 'Kavya') returning id`, [c])).rows[0].id;
  extra.push({ id: c, code: 'EXTRA' + i, member: m });
}
for (const e of extra.slice(0, 5)) await admin.query(`insert into family_links (a_circle, b_circle, a_member, b_member, status, decided_at) values ($1,$2,$3,$4,'active', now())`, [e.id, A.id, e.member, a.Kavya.id]);
ok('the Sharmas now have 6 linked families', (await act(a.Arjun, 'link_state')).links.length === 6);
await admin.query(`delete from rate_limit where bucket like 'link%'`);   // another day: this is about the limit of six links, not about how often one may ask
r = await act(a.Arjun, 'link_request', { otherCode: 'EXTRA6', bridgeId: a.Kavya.id });
ok('a seventh cannot be asked for', r.status === 409 && /6 linked families already/.test(r.error), JSON.stringify(r));
const waiting = (await admin.query(`insert into family_links (a_circle, b_circle, a_member, b_member, status) values ($1,$2,$3,$4,'pending') returning id`, [extra[5].id, A.id, extra[5].member, a.Kavya.id])).rows[0].id;
r = await act(a.Ramesh, 'link_approve', { linkId: waiting });
ok('nor said yes to', r.status === 409 && /6 linked families already/.test(r.error), JSON.stringify(r));
ok('the database allows one link between two families, whoever asked', await admin.query(`insert into family_links (a_circle, b_circle, a_member, b_member, status) values ($1,$2,$3,$4,'pending')`, [B.id, A.id, b.Kavya.id, a.Kavya.id]).then(() => false, e => e.code === '23505'));
await admin.query(`delete from family_links where a_circle = any($1::uuid[])`, [extra.map(e => e.id)]);

// Either side ends it, at once.
ok('a stranger cannot end a link', (await act(C.m.Stranger, 'link_end', { linkId: link2 })).status === 404);
ok('Karan, on the other side, ends the link', (await act(b.Karan, 'link_end', { linkId: link2 })).status === 200);
sa = await act(a.Arjun, 'link_state'); sb = await act(b.Sarla, 'link_state');
ok('an ended link exposes nothing, to either side, at once', sa.links.length === 0 && sb.links.length === 0 && !/Sarla|Karan|Meena|Tara/.test(JSON.stringify(sa)) && !/Ramesh|Bharat|Arjun/.test(JSON.stringify(sb)));
ok('ending twice is harmless', (await act(a.Arjun, 'link_end', { linkId: link2 })).already === true);
r = await act(b.Karan, 'link_request', { otherCode: A.code, bridgeId: b.Kavya.id });
ok('either family may ask again after a link that was ended; the one that asked can take it back', r.status === 202 && (await act(a.Arjun, 'link_end', { linkId: r.linkId })).status === 400 && (await act(b.Sarla, 'link_end', { linkId: r.linkId })).status === 200);
const back = r.linkId;
ok('a request taken back also stands for 7 days, for both families', (await act(b.Karan, 'link_request', { otherCode: A.code, bridgeId: b.Kavya.id })).error === LINK_COOL
   && (await act(a.Arjun, 'link_request', { otherCode: B.code, bridgeId: a.Kavya.id })).error === LINK_COOL);

// ---- asking is counted: nobody can ring a family all day, or guess codes
{
  const pushedTo = async (cid) => (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like '%asked to link family trees%'`, [cid])).rows[0].n;
  const newDay = () => admin.query(`delete from rate_limit where bucket like 'link%' or bucket = 'join'`);
  const clearLinks = () => admin.query(`delete from family_links where status in ('pending', 'ended', 'declined')`);
  await newDay(); await clearLinks();
  // Three a day from one family to one other family. An ended link is not a withdrawal, so only the count stops it.
  const askEnd = async () => {
    const x = await act(a.Arjun, 'link_request', { otherCode: B.code, bridgeId: a.Kavya.id });
    if (x.status === 202) await admin.query(`delete from family_links where id = $1`, [x.linkId]);
    return x;
  };
  const three = [await askEnd(), await askEnd(), await askEnd()];
  const before = await pushedTo(B.id);
  const fourth = await askEnd();
  ok('three requests a day from one family to another go through; the fourth is refused like any rate limit', three.every(x => x.status === 202) && fourth.status === 429 && fourth.error === LINK_SLOW && !fourth.linkId, JSON.stringify(fourth));
  ok('and the family that was asked hears nothing of the fourth', (await pushedTo(B.id)) === before && (await admin.query(`select count(*)::int as n from family_links where status = 'pending'`)).rows[0].n === 0);
  ok('the Sharmas can still ask a different family', await (async () => { const x = await act(a.Arjun, 'link_request', { otherCode: C.code, bridgeId: a.Kavya.id }); if (x.linkId) await admin.query(`delete from family_links where id = $1`, [x.linkId]); return x.status === 202; })());

  // Ten tries a day from one family, a wrong code counted like a right one.
  await newDay(); await clearLinks();
  const tries = [];
  for (let i = 0; i < 10; i++) tries.push(await act(a.Arjun, 'link_request', { otherCode: 'NOPE' + i, bridgeId: a.Kavya.id }));
  ok('a wrong code still says so, for ten tries', tries.every(x => x.status === 404 && x.error === 'No family found with that code'));
  const eleventh = await act(a.Arjun, 'link_request', { otherCode: 'NOPE11', bridgeId: a.Kavya.id });
  const right = await act(a.Bharat, 'link_request', { otherCode: B.code, bridgeId: a.Kavya.id });
  ok('the eleventh try of the day is refused whether the code is wrong or right, in the same words and status', eleventh.status === 429 && right.status === 429 && eleventh.error === LINK_SLOW && right.error === eleventh.error
     && JSON.stringify(Object.keys(eleventh).sort()) === JSON.stringify(Object.keys(right).sort()), JSON.stringify([eleventh, right]));
  ok('so guessing told them nothing, and nothing was made', (await admin.query(`select count(*)::int as n from family_links where status = 'pending'`)).rows[0].n === 0);
  ok('another family is not held back by the Sharmas\' tries', await (async () => { const x = await act(b.Karan, 'link_request', { otherCode: 'NOPE99', bridgeId: b.Kavya.id }); return x.status === 404; })());

  // Guessing here uses up the same allowance as guessing a code to join.
  await newDay();
  const ipCall = (who, action, extra) => { const req = { method: 'POST', headers: { 'x-parwah-token': who.token, 'x-forwarded-for': '10.99.99.99' }, query: {}, body: { action, code: who.code, memberId: who.id, ...extra } };
    let status = 200, json = null; const res = { status(x) { status = x; return this; }, json(j) { json = j; return this; }, setHeader() {} };
    return api.circle(req, res).then(() => ({ ...(json || {}), status })); };
  for (let i = 0; i < 6; i++) await ipCall(a.Arjun, 'link_request', { otherCode: 'GUESS' + i, bridgeId: a.Kavya.id });
  const joins = [];
  for (let i = 0; i < 7; i++) joins.push(await ipCall(a.Arjun, 'join', { code: 'WRONG' + i, memberName: 'Arjun', userId: a.Arjun.userId }));
  ok('wrong codes to link and wrong codes to join share one allowance per address', joins.slice(0, 6).every(x => x.status === 404) && joins[6].status === 429, joins.map(x => x.status).join());
  ok('and once it is used up, linking from that address is refused too', (await ipCall(b.Karan, 'link_request', { otherCode: A.code, bridgeId: b.Kavya.id })).status === 429);

  // Six a day reaching one family, from anyone. The seventh is not made and nobody is pushed.
  await newDay(); await clearLinks();
  const askers = [];
  for (let i = 0; i < 7; i++) {
    const F = await family('Asker ' + i, ['Head' + i]);
    askers.push(F);
  }
  const got = [];
  const heard0 = await pushedTo(C.id);
  for (const F of askers) {
    const head = Object.values(F.m)[0];
    const x = await act(head, 'link_request', { otherCode: C.code, bridgeId: head.id });
    got.push(x);
    if (x.linkId) await admin.query(`delete from family_links where id = $1`, [x.linkId]);
  }
  ok('six families reach one family in a day; the seventh is refused quietly, like any rate limit', got.slice(0, 6).every(x => x.status === 202) && got[6].status === 429 && got[6].error === LINK_SLOW, got.map(x => x.status).join());
  ok('the family heard of six, not seven', (await pushedTo(C.id)) === heard0 + 6);
  await newDay(); await clearLinks();
}
ok('both families were told in their own feed, never with the other\'s people', (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like '%family tree%'`, [A.id])).rows[0].n >= 3
   && (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text ~ 'Sarla|Karan|Meena'`, [A.id])).rows[0].n === 0);

// =================================================================== FACTS
const facts = async (who) => (await act(who, 'fact_list')).facts;
r = await act(a.Arjun, 'fact_add', { kind: 'gotra', text: 'Bharadwaj' });
ok('anyone in the family can add a fact; whole family is the default', r.status === 201 && (await facts(a.Bharat)).some(f => f.text === 'Bharadwaj' && f.audience === 'family' && f.by_name === 'Arjun'));
const gotraId = r.id;
ok('the same person writes each of the single facts once', (await act(a.Arjun, 'fact_add', { kind: 'gotra', text: 'Again' })).status === 409);
ok('an outsider is refused', (await act({ ...C.m.Stranger, id: a.Arjun.id }, 'fact_list', {}, A.code)).status === 403 && (await act(b.Karan, 'fact_list', {}, A.code)).status === 403);
ok('a group has no family facts', (await act(G.m.Asha, 'fact_list')).status === 400);
ok('a kind that is not on the list is refused', (await act(a.Arjun, 'fact_add', { kind: 'bank', text: 'x' })).status === 400);
ok('empty is refused', (await act(a.Arjun, 'fact_add', { kind: 'custom', text: '   ' })).status === 400);
ok('a custom is up to 600 letters', (await act(a.Arjun, 'fact_add', { kind: 'custom', text: 'x'.repeat(601) })).status === 400 && (await act(a.Arjun, 'fact_add', { kind: 'custom', text: 'y'.repeat(600) })).status === 201);
r = await act(a.Arjun, 'fact_add', { kind: 'custom', text: 'The locker OTP is 4455' });
ok('an OTP is never kept (the notes rule)', r.status === 400 && /never keeps/.test(r.error), JSON.stringify(r));
ok('nor a card number', (await act(a.Arjun, 'fact_add', { kind: 'surname', text: 'Card 4111 1111 1111 1111 was Dada\'s' })).status === 400);
ok('a wrong audience is refused', (await act(a.Arjun, 'fact_add', { kind: 'tongue', text: 'Hindi', audience: 'everyone' })).status === 400);
ok('someone marked as remembered cannot be chosen, and the reason is said', await (async () => {
  await admin.query(`update members set remembered = true where id = $1`, [a.Bharat.id]);
  const x = await act(a.Arjun, 'fact_add', { kind: 'tongue', text: 'Hindi', audience: 'chosen', chosen: [a.Kavya.id, a.Bharat.id] });
  const g = await act(a.Arjun, 'fact_add', { kind: 'custom', text: 'A custom kept for now', audience: 'me' });
  const y = await act(a.Arjun, 'fact_edit', { id: g.id, text: 'A custom kept for now', audience: 'chosen', chosen: [a.Bharat.id] });
  await act(a.Arjun, 'fact_remove', { id: g.id });
  await admin.query(`update members set remembered = false where id = $1`, [a.Bharat.id]);
  return x.status === 400 && x.error === 'Bharat is remembered here, so cannot be chosen.' && !x.id && g.status === 201 && y.status === 400 && y.error === x.error;
})());
ok('"people I choose" needs people', (await act(a.Arjun, 'fact_add', { kind: 'tongue', text: 'Hindi', audience: 'chosen', chosen: [] })).status === 400);
ok('and only people of this family, not yourself', (await act(a.Arjun, 'fact_add', { kind: 'tongue', text: 'Hindi', audience: 'chosen', chosen: [b.Karan.id] })).status === 400
   && (await act(a.Arjun, 'fact_add', { kind: 'tongue', text: 'Hindi', audience: 'chosen', chosen: [a.Arjun.id] })).status === 400);
r = await act(a.Kavya, 'fact_add', { kind: 'custom', text: 'only-me custom', audience: 'me' });
const onlyMe = r.id;
ok('only me: the writer reads it back, nobody else does, an elder included', r.status === 201 && (await facts(a.Kavya)).some(f => f.id === onlyMe)
   && !(await facts(a.Arjun)).some(f => f.id === onlyMe) && !(await facts(a.Ramesh)).some(f => f.id === onlyMe));
r = await act(a.Kavya, 'fact_add', { kind: 'custom', text: 'chosen custom', audience: 'chosen', chosen: [a.Arjun.id] });
const chosenId = r.id;
ok('people I choose: the chosen person reads it, the others do not', r.status === 201 && (await facts(a.Arjun)).some(f => f.id === chosenId)
   && !(await facts(a.Bharat)).some(f => f.id === chosenId) && !(await facts(a.Ramesh)).some(f => f.id === chosenId));
ok('who else was chosen is told to the writer only', (await facts(a.Kavya)).find(f => f.id === chosenId).chosen.join() === a.Arjun.id && (await facts(a.Arjun)).find(f => f.id === chosenId).chosen.length === 0);
ok('someone who is neither the writer nor an elder cannot change a fact', (await act(a.Bharat, 'fact_edit', { id: gotraId, text: 'Changed' })).status === 403 && (await act(a.Bharat, 'fact_remove', { id: gotraId })).status === 403);
ok('nor can the chosen person change what they were shown', (await act(a.Arjun, 'fact_edit', { id: chosenId, text: 'Changed' })).status === 403);
ok('an elder (role parent) can change the words', (await act(a.Ramesh, 'fact_edit', { id: gotraId, text: 'Bharadwaj gotra' })).status === 200 && (await facts(a.Bharat)).some(f => f.text === 'Bharadwaj gotra'));
ok('but not who sees it: that stays the writer\'s', (await act(a.Ramesh, 'fact_edit', { id: gotraId, text: 'Bharadwaj gotra', audience: 'me' })).status === 200 && (await facts(a.Bharat)).some(f => f.id === gotraId && f.audience === 'family'));
ok('an elder cannot change or remove a fact they cannot read: it is not there for them', (await act(a.Ramesh, 'fact_edit', { id: onlyMe, text: 'x' })).status === 404 && (await act(a.Ramesh, 'fact_remove', { id: onlyMe })).status === 404
   && (await act(a.Ramesh, 'fact_remove', { id: chosenId })).status === 404 && (await facts(a.Kavya)).some(f => f.id === onlyMe && f.text === 'only-me custom'));
ok('a fact of another family is not there either', (await act(a.Ramesh, 'fact_remove', { id: (await admin.query('select id from family_facts where circle_id = $1', [B.id])).rows[0].id })).status === 404);
ok('the writer changes who sees it: now only me', (await act(a.Arjun, 'fact_edit', { id: gotraId, text: 'Bharadwaj gotra', audience: 'me' })).status === 200 && !(await facts(a.Bharat)).some(f => f.id === gotraId));
ok('and back to the whole family', (await act(a.Arjun, 'fact_edit', { id: gotraId, text: 'Bharadwaj gotra', audience: 'family' })).status === 200 && (await facts(a.Bharat)).some(f => f.id === gotraId));
ok('an edit is checked like an add', (await act(a.Arjun, 'fact_edit', { id: gotraId, text: 'my upi pin is 1234' })).status === 400 && (await act(a.Arjun, 'fact_edit', { id: gotraId, text: 'x'.repeat(81) })).status === 400);
ok('an elder removes a fact the whole family reads', (await act(a.Ramesh, 'fact_remove', { id: gotraId })).status === 200 && !(await facts(a.Arjun)).some(f => f.id === gotraId));
for (let i = (await admin.query(`select count(*)::int as n from family_facts where circle_id = $1 and kind = 'custom'`, [A.id])).rows[0].n; i < 20; i++) await act(a.Bharat, 'fact_add', { kind: 'custom', text: 'Custom ' + i });
ok('a family keeps up to 20 customs', (await act(a.Bharat, 'fact_add', { kind: 'custom', text: 'One too many' })).status === 409
   && (await admin.query(`select count(*)::int as n from family_facts where circle_id = $1 and kind = 'custom'`, [A.id])).rows[0].n === 20);
ok('the feed hears of a whole-family fact, never of a private one, and never the words', (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like '%family fact%'`, [A.id])).rows[0].n >= 1
   && (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text ~ 'only-me|chosen custom|Bharadwaj'`, [A.id])).rows[0].n === 0);

// ============================================================ REMEMBRANCE
const dadaji = await idA('Dadaji');
const row = async (id) => (await admin.query('select * from members where id = $1', [id])).rows[0];
const look = async (who) => call(api.events, { method: 'GET', token: who.token, query: { circle: who.code, member: who.id } });
ok('a child of the family cannot mark someone', (await act(a.Chintu, 'remember_mark', { targetId: dadaji, year: 2019 })).status === 403);
ok('nor a stranger, nor a member of the other family', (await act({ ...C.m.Stranger, id: a.Arjun.id }, 'remember_mark', { targetId: dadaji, year: 2019 }, A.code)).status === 403
   && (await act(b.Karan, 'remember_mark', { targetId: dadaji, year: 2019 }, A.code)).status === 403);
ok('the year is needed', (await act(a.Arjun, 'remember_mark', { targetId: dadaji, month: 3, day: 12 })).status === 400);
ok('a date that cannot be is refused', (await act(a.Arjun, 'remember_mark', { targetId: dadaji, year: 2019, month: 2, day: 30 })).status === 400
   && (await act(a.Arjun, 'remember_mark', { targetId: dadaji, year: 2999 })).status === 400);
ok('nobody marks themselves', (await act(a.Arjun, 'remember_mark', { targetId: a.Arjun.id, year: 2019 })).status === 400);
ok('nor someone of another family', (await act(a.Arjun, 'remember_mark', { targetId: b.Sarla.id, year: 2019 })).status === 404);
ok('the line keeps no OTP', (await act(a.Arjun, 'remember_mark', { targetId: dadaji, year: 2019, line: 'his OTP was 1234' })).status === 400);
r = await act(a.Arjun, 'remember_mark', { targetId: dadaji, year: 2019 });
ok('an adult marks Dadaji with the year alone', r.status === 200 && r.words === '2019' && (await row(dadaji)).remembered === true && (await row(dadaji)).passed_year === 2019 && (await row(dadaji)).passed_month === null);
let ev = await look(a.Bharat);
const evD = () => ev.members.find(m => m.id === dadaji);
ok('the family read carries the mark and the year', evD().remembered === true && evD().passed_year === 2019 && ev.remembrance.length === 0);
ok('a year alone gives no reminder, ever', (await Rm.sweepRemember(sql, A.id)) === 0 && (await admin.query('select count(*)::int as n from remember_sent')).rows[0].n === 0);

// Today is the day, in India.
const NOW = Date.now(), today = wallIn(NOW, 'Asia/Kolkata').date;
const [ty, tm, td] = today.split('-').map(Number);
r = await act(a.Kavya, 'remember_mark', { targetId: dadaji, year: ty - 7, month: tm, day: td, line: 'He taught us all to ride a cycle.' });
ok('another adult adds the day and a line', r.status === 200 && (await row(dadaji)).passed_day === td);
ev = await look(a.Bharat);
ok('Today has one calm reminder, in plain words', ev.remembrance.length === 1 && ev.remembrance[0].title === "Today is Dadaji's day of remembrance." && ev.remembrance[0].sub === '7 years without Dadaji. We remember.'
   && ev.remembrance[0].line === 'He taught us all to ride a cycle.', JSON.stringify(ev.remembrance));
ok('the other family reads none of it', !JSON.stringify(await look(b.Karan)).includes('Dadaji'));
// The read above already ran the sweep once (every open phone is the timer).
ok('the reminder was claimed once for this year', (await admin.query('select year from remember_sent where member_id = $1', [dadaji])).rows.map(x => x.year).join() === String(ty));
await admin.query('delete from remember_sent');
const four = await Promise.all([1, 2, 3, 4].map(() => Rm.sweepRemember(sql, A.id)));
ok('four sweeps at the same moment send one reminder', four.reduce((x, y) => x + y, 0) === 1 && (await admin.query('select count(*)::int as n from remember_sent')).rows[0].n === 1, four.join());
await admin.query('delete from remember_sent');
await ensureTaskSchema(sql);
const two = await Promise.all([runTick(sql), runTick(sql)]);
ok('the timer run twice at once claims it once', (await admin.query('select count(*)::int as n from remember_sent where member_id = $1', [dadaji])).rows[0].n === 1 && two.every(t => t.circles >= 1), JSON.stringify(two));
ok('and a third run sends nothing more', (await runTick(sql)) && (await Rm.sweepRemember(sql, A.id)) === 0 && (await admin.query('select count(*)::int as n from remember_sent')).rows[0].n === 1);

// The evening before, on the family's clock.
const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const [my, mm, md] = tomorrow.split('-').map(Number);
await act(a.Arjun, 'remember_mark', { targetId: dadaji, year: 2000, month: mm, day: md });
await admin.query('delete from remember_sent');
const istAt = (hh) => Date.parse(today + 'T' + hh + ':00:00+05:30');
ok('5 in the evening the day before: not yet', (await Rm.sweepRemember(sql, A.id, istAt('17'))) === 0);
ok('6 in the evening the day before: the family is told', (await Rm.sweepRemember(sql, A.id, istAt('18'))) === 1);
ok('and not again on the day itself', (await Rm.sweepRemember(sql, A.id, istAt('23') + 3 * 3600000)) === 0
   && (await admin.query('select year from remember_sent')).rows.map(x => x.year).join() === String(my));
ok('on the eve, Today stays quiet: the card is for the day', Rm.rememberToday([await row(dadaji)], istAt('20')).length === 0 && Rm.rememberToday([await row(dadaji)], istAt('23') + 3 * 3600000).length === 1);

// No birthday card, however near the birthday.
const plus2 = new Date(Date.parse(today + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10);
await call(api.plans, { method: 'GET', token: a.Arjun.token, query: { area: 'bond', circle: A.code, member: a.Arjun.id } });   // makes the plans and card tables
await act(a.Arjun, 'remember_undo', { targetId: dadaji });
await admin.query(`update members set dob = $2 where id = any($1::uuid[])`, [[dadaji, a.Bharat.id], '1950' + plus2.slice(4)]);
const circleRow = (await admin.query('select id, name, kind, code from circles where id = $1', [A.id])).rows[0];
await Bond.ensureBondSchema(sql);
await Bond.sweepBond(sql, circleRow);
const cardsFor = async (id) => (await admin.query(`select count(*)::int as n from cards where circle_id = $1 and for_member = $2 and occasion = 'birthday'`, [A.id, id])).rows[0].n;
ok('control: with nobody marked, both birthdays two days away get a card', (await cardsFor(dadaji)) === 1 && (await cardsFor(a.Bharat.id)) === 1);
r = await act(a.Arjun, 'remember_mark', { targetId: dadaji, year: 2019, month: 3, day: 12 });
ok('marking Dadaji takes his waiting birthday card away', r.status === 200 && (await cardsFor(dadaji)) === 0);
await Promise.all([1, 2, 3].map(() => Bond.sweepBond(sql, circleRow)));
ok('and sweepBond never makes him another, while Bharat keeps his', (await cardsFor(dadaji)) === 0 && (await cardsFor(a.Bharat.id)) === 1);
await runTick(sql);
ok('nor does the timer', (await cardsFor(dadaji)) === 0);
ok('no anniversary card for a couple when one of them is remembered', await (async () => {
  const geeta = await idA('Geeta');
  await admin.query(`update members set anniversary = $3, anniv_with = $2 where id = $1`, [geeta, dadaji, '1970' + plus2.slice(4)]);
  await admin.query(`update members set anniversary = $3, anniv_with = $2 where id = $1`, [dadaji, geeta, '1970' + plus2.slice(4)]);
  await Bond.sweepBond(sql, circleRow);
  return (await admin.query(`select count(*)::int as n from cards where circle_id = $1 and occasion = 'anniversary'`, [A.id])).rows[0].n === 0;
})());

// No check-in, asked or swept.
await Fc.ensureFamilyCareSchema(sql);
await admin.query(`update members set checkin_by = '09:00' where id = any($1::uuid[])`, [[a.Nani.id, a.Bharat.id]]);
// Nani signed in today: one person alone cannot mark someone who used Parwah in the last 30 days.
const webpush = (await import('web-push')).default;
const pushed = [];
webpush.sendNotification = async (sub, body) => { pushed.push({ endpoint: sub.endpoint, body: JSON.parse(body) }); return {}; };
const { ensurePushSchema } = await import('../../../api/_push.mjs');
await ensurePushSchema(sql);
for (const m of [a.Nani, a.Arjun, a.Bharat]) await admin.query(`insert into push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')`, [m.id, 'https://fcm.googleapis.com/fcm/send/' + m.id]);
r = await act(a.Arjun, 'remember_mark', { targetId: a.Nani.id, year: 2024 });
ok('someone who used Parwah in the last 30 days cannot be marked', r.status === 409 && r.error === 'Nani used Parwah recently. If this is right, ask them or an elder to check.' && (await row(a.Nani.id)).remembered === false
   && (await row(a.Nani.id)).checkin_by === '09:00', JSON.stringify(r));
// A session last used 40 days ago, and nothing done since: now the family may.
await admin.query(`update sessions set last_used_at = now() - interval '40 days' where user_id = $1`, [a.Nani.userId]);
await admin.query(`update events set created_at = created_at - interval '40 days' where member_id = $1`, [a.Nani.id]);
await admin.query(`update members set checkin_ask = '10:00', checkin_ask_by = $2 where id = $1`, [a.Nani.id, a.Arjun.id]);
const p0 = pushed.length;
// Quiet for 40 days, but ON Parwah: one adult alone still cannot. A second
// adult is named, and the mark waits for their yes (stream A, A11).
r = await act(a.Arjun, 'remember_mark', { targetId: a.Nani.id, year: 2024 });
ok('someone on Parwah is not marked by one adult alone, however long they have been quiet', r.status === 400 && r.field === 'ask' && r.needsSecond === true
   && (await row(a.Nani.id)).remembered === false && pushed.length === p0, JSON.stringify(r));
r = await act(a.Arjun, 'remember_mark', { targetId: a.Nani.id, year: 2024, askId: a.Bharat.id });
ok('with a second adult named, it waits: nothing about Nani changes, and only that adult is asked', r.status === 200 && r.pending === true && (await row(a.Nani.id)).remembered === false
   && pushed.length === p0 + 1 && pushed[p0].endpoint.endsWith(a.Bharat.id), JSON.stringify([r, pushed.slice(p0)]));
r = await act(a.Bharat, 'remember_confirm', { targetId: a.Nani.id });
ok('marking someone who is on Parwah keeps their check-in time: undo could not put it back', r.status === 200 && (await row(a.Nani.id)).remembered === true && (await row(a.Nani.id)).checkin_by === '09:00'
   && (await row(a.Nani.id)).checkin_ask === '10:00' && (await row(a.Nani.id)).checkin_ask_by === a.Arjun.id, JSON.stringify(r));
ok('Nani is told once, and how to undo it; nobody else is pushed', pushed.length === p0 + 2 && pushed[p0 + 1].endpoint.endsWith(a.Nani.id)
   && pushed[p0 + 1].body.body === 'Arjun marked you as no longer with us. If this is a mistake, open Parwah to undo it.', JSON.stringify(pushed.slice(p0)));
await Fc.quietSweep(sql, A.id, istAt('23'));
ok('the check-in sweep nudges Bharat, and never the person who is remembered', (await row(a.Bharat.id)).quiet_nudged_for !== null && (await row(a.Nani.id)).quiet_nudged_for === null && (await row(a.Nani.id)).quiet_alerted_for === null);
r = await call(api.events, { token: a.Arjun.token, body: { code: A.code, memberId: a.Arjun.id, type: 'quiet_ask', targetId: a.Nani.id, checkinBy: '10:00' } });
ok('nobody can ask them for a check-in', r.status === 400 && /remembered here/.test(r.error), JSON.stringify(r));
const fc = await Fc.familyCareState(sql, A.id, a.Arjun.id);
ok('and the check-in card does not list them', !JSON.stringify(fc).includes(a.Nani.id));
// No recommendation.
r = await call(api.games, { token: a.Arjun.token, query: { area: 'pasand' }, body: { area: 'pasand', code: A.code, memberId: a.Arjun.id, action: 'rec_add', title: 'Panchayat', kind: 'show', to: [a.Nani.id] } });
ok('nobody can send them a recommendation', r.status === 400 && /remembered here/.test(r.error), JSON.stringify(r));
r = await call(api.games, { token: a.Arjun.token, query: { area: 'pasand' }, body: { area: 'pasand', code: A.code, memberId: a.Arjun.id, action: 'rec_add', title: 'Panchayat', kind: 'show', toAll: true } });
ok('"everyone" leaves them out', r.status === 201 && (await admin.query('select count(*)::int as n from pasand_rec_to where member_id = $1', [a.Nani.id])).rows[0].n === 0, JSON.stringify(r));
// No reach-out nudge (Family Memory reads the same flag).
await Mb.ensureBondSchema(sql);
const D = await family('Mehta Family', ['Meera']);
const baba = await tree(D.m.Meera, 'add_person', 'Baba', 'parent', D.m.Meera.id, 'm');
await admin.query(`update members set phone = '+919812300099', created_at = now() - interval '90 days' where circle_id = $1`, [D.id]);
await admin.query(`insert into bond_prefs (member_id, nudges_on, nudge_weeks) values ($1, true, 3)`, [D.m.Meera.id]);
const dRow = (await admin.query('select id, name, kind, code from circles where id = $1', [D.id])).rows[0];
const meRow = { id: D.m.Meera.id, name: 'Meera' };
let bt = await Mb.bondToday(sql, dRow, meRow);
ok('control: before the mark, Meera is nudged to call Baba', !!bt.nudge && bt.nudge.targetId === baba, JSON.stringify(bt.nudge));
await act(D.m.Meera, 'remember_mark', { targetId: baba, year: 2025 });
bt = await Mb.bondToday(sql, dRow, meRow);
ok('after it, the nudge is gone at once', bt.nudge === null, JSON.stringify(bt.nudge));
await admin.query('delete from bond_nudges');
bt = await Mb.bondToday(sql, dRow, meRow);
ok('and no new nudge ever picks them', bt.nudge === null, JSON.stringify(bt.nudge));

// The marked person is here after all: she undoes her own mark, and nothing was lost.
ok('nobody marks themself, even when already marked', (await act(a.Nani, 'remember_mark', { targetId: a.Nani.id, year: 2024 })).status === 400 && (await row(a.Nani.id)).remembered === true);
r = await act(a.Nani, 'remember_undo', { targetId: a.Nani.id });
ok('the marked person undoes their own mark', r.status === 200 && (await row(a.Nani.id)).remembered === false && (await row(a.Nani.id)).passed_year === null);
ok('and her check-in is as it was before the mark', (await row(a.Nani.id)).checkin_by === '09:00' && (await row(a.Nani.id)).checkin_ask === '10:00');
await admin.query(`update members set quiet_nudged_for = null, quiet_alerted_for = null where id = $1`, [a.Nani.id]);
await Fc.quietSweep(sql, A.id, istAt('23'));
ok('so the check-in sweep looks after her again', (await row(a.Nani.id)).quiet_nudged_for !== null);
ok('a child may undo a mark on themself, and only on themself', await (async () => {
  await admin.query(`update members set remembered = true where id = $1`, [a.Chintu.id]);
  const x = await act(a.Chintu, 'remember_undo', { targetId: a.Chintu.id });
  return x.status === 200 && (await row(a.Chintu.id)).remembered === false;
})());
// A card that was already waiting when the mark was set another way is never delivered.
ok('a waiting card for someone marked as remembered is not sent on the day', await (async () => {
  await admin.query(`update members set remembered = false where id = $1`, [dadaji]);
  const c = (await admin.query(`insert into cards (circle_id, for_member, occasion, title, date, auto_key) values ($1, $2, 'birthday', 'Dadaji''s birthday', current_date - 1, 'test:late') returning id`, [A.id, dadaji])).rows[0].id;
  await admin.query(`update members set remembered = true where id = $1`, [dadaji]);
  await Bond.sweepBond(sql, circleRow);
  const kept = (await admin.query('select delivered_at from cards where id = $1', [c])).rows[0].delivered_at === null;
  await admin.query('delete from cards where id = $1', [c]);
  await admin.query(`update members set remembered = true, passed_year = 2019, passed_month = 3, passed_day = 12 where id = $1`, [dadaji]);
  return kept;
})());

// Any adult can undo it.
ok('a child cannot undo', (await act(a.Chintu, 'remember_undo', { targetId: dadaji })).status === 403);
r = await act(a.Bharat, 'remember_undo', { targetId: dadaji });
const dr = await row(dadaji);
ok('any adult can undo, and the date goes with the mark', r.status === 200 && dr.remembered === false && dr.passed_year === null && dr.passed_month === null && dr.remember_line === null);
ok('undoing twice is harmless', (await act(a.Kavya, 'remember_undo', { targetId: dadaji })).already === true);
ok('the feed says it gently, in the family\'s own words', (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like '%no longer with us%'`, [A.id])).rows[0].n >= 2
   && (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text ~* '\\m(deceased|died|dead|death|expired)\\M'`, [A.id])).rows[0].n === 0);

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`\nwiderfamily.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`\nwiderfamily.dbtest: ${pass}/${pass} checks pass`);
