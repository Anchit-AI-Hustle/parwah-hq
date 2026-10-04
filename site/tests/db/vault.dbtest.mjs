// THE VAULT AGAINST A REAL DATABASE: the real /api/book?area=vault and
// area=pay handlers, on the real schema.
//
// The journey it proves is the one a family described: a car claim needs a
// brother's Aadhaar, PAN and licence. Instead of asking on WhatsApp for
// photos, his sister asks inside Parwah; he says yes with one tap; she
// downloads them, and he is told each time.
//
// Around it:
//   - asking never reveals what is in anyone's vault (asked by kind);
//   - "Can open it" is reading, not rewriting: only the owner or whoever
//     added it changes or removes it, and the owner is told;
//   - whoever added a paper about someone else keeps access only until the
//     owner takes it back;
//   - editing a note never wipes the last 4 digits;
//   - nobody verifies their own upload;
//   - for someone not on Parwah (Dadi), whoever added her papers decides;
//   - a payment's "ask first" has an answer, and the monthly limit holds.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('vault.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('vault.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: circleApi } = await import('../../../api/circle.mjs');
const { default: bookApi } = await import('../../../api/book.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.3.1.1' }, query, body };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...json, status };
}
let n = 0;
async function user(name) {
  const phone = '+9198500' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token };
}

const A = await user('Anchit');
const made = await call(circleApi, { token: A.token, body: { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Anchit', circleName: 'Tandon Family', userId: A.userId, relation: 'son' } });
const code = made.code;
const circleId = (await admin.query('select id from circles where code = $1', [code])).rows[0].id;
await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]);
const M = { Anchit: { id: made.memberId, token: A.token } };
for (const name of ['Rahul', 'Papa', 'Sunita']) {
  const u = await user(name);
  const j = await call(circleApi, { token: u.token, body: { action: 'join', code, memberName: name, userId: u.userId } });
  M[name] = { id: j.memberId, token: u.token };
}
const vault = (who, body) => call(bookApi, { token: who.token, query: { area: 'vault' }, body: { area: 'vault', code, memberId: who.id, ...body } });
const look = async (who) => call(bookApi, { method: 'GET', token: who.token, query: { area: 'vault', circle: code, member: who.id } });
const pay = (who, body) => call(bookApi, { token: who.token, query: { area: 'pay' }, body: { area: 'pay', code, memberId: who.id, ...body } });
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// ---- Rahul keeps his papers; nobody else can see them yet
const add = async (who, body) => (await vault(who, { action: 'add', file: pngB64, fileMime: 'image/png', fileName: 'scan.png', ...body }));
const pan = await add(M.Rahul, { kind: 'pan', label: "Rahul's PAN", aboutId: M.Rahul.id, number: 'ABCDE1234F' });
const dl = await add(M.Rahul, { kind: 'dl', label: "Rahul's licence", aboutId: M.Rahul.id });
ok('Rahul adds his PAN and licence', pan.status === 201 && dl.status === 201, JSON.stringify(pan));
let a = await look(M.Anchit);
ok('Anchit cannot see that they exist', !a.docs.some(d => d.about_member === M.Rahul.id));

// ---- Anchit asks for the PAN by kind: nothing is revealed
const ask = await vault(M.Anchit, { action: 'request', toId: M.Rahul.id, kind: 'pan' });
ok('Anchit asks for Rahul\'s PAN, by kind', ask.status === 201, JSON.stringify(ask));
ok('asking twice does not ask twice', (await vault(M.Anchit, { action: 'request', toId: M.Rahul.id, kind: 'pan' })).already === true);
ok('nobody asks themselves', (await vault(M.Anchit, { action: 'request', toId: M.Anchit.id, kind: 'pan' })).status === 400);
ok('a kind that does not exist is refused', (await vault(M.Anchit, { action: 'request', toId: M.Rahul.id, kind: 'diary' })).status === 400);
let r = await look(M.Rahul);
const inbox = r.requests.filter(x => x.to_member === M.Rahul.id && x.status === 'open');
ok('Rahul sees who asked for what', inbox.length === 1 && inbox[0].from_name === 'Anchit' && inbox[0].kind === 'pan');
ok('only Rahul can answer it', (await vault(M.Papa, { action: 'answer', requestId: ask.id, allow: true, docId: pan.id })).status === 404);
ok('Rahul cannot give away a paper that is not his', (await vault(M.Rahul, { action: 'answer', requestId: ask.id, allow: true, docId: (await add(M.Papa, { kind: 'aadhaar', label: "Papa's Aadhaar", aboutId: M.Papa.id })).id })).status === 403);
const yes = await vault(M.Rahul, { action: 'answer', requestId: ask.id, allow: true, docId: pan.id });
ok('Rahul says yes with one tap', yes.status === 200, JSON.stringify(yes));
a = await look(M.Anchit);
const aPan = a.docs.find(d => d.id === pan.id);
ok('and Anchit can now download it', aPan && aPan.my_level === 'full');
const opened = await vault(M.Anchit, { action: 'open', id: pan.id });
ok('the file comes back, named', opened.status === 200 && opened.file && opened.mime === 'image/png' && !!opened.name);
ok('and the open is written down for Rahul', (await admin.query(`select count(*)::int as n from vault_log where doc_id = $1 and action = 'opened' and member_id = $2`, [pan.id, M.Anchit.id])).rows[0].n === 1);
ok('a yes cannot be given twice', (await vault(M.Rahul, { action: 'answer', requestId: ask.id, allow: true, docId: pan.id })).status === 409);

// ---- the licence: Rahul lets her know it exists; she asks for that one
await vault(M.Rahul, { action: 'grant', id: dl.id, targetId: M.Anchit.id, level: 'view' });
ok('a paper she only knows exists cannot be opened', (await vault(M.Anchit, { action: 'open', id: dl.id })).status === 403);
const ask2 = await vault(M.Anchit, { action: 'request', docId: dl.id });
ok('she asks for that exact paper', ask2.status === 201);
ok('it is in its history', (await admin.query(`select count(*)::int as n from vault_log where doc_id = $1 and action = 'asked to open it'`, [dl.id])).rows[0].n === 1);
ok('Rahul says not now', (await vault(M.Rahul, { action: 'answer', requestId: ask2.id, allow: false })).status === 200 &&
   (await admin.query(`select status from vault_requests where id = $1`, [ask2.id])).rows[0].status === 'declined');
const ask3 = await vault(M.Anchit, { action: 'request', docId: dl.id });
await vault(M.Rahul, { action: 'grant', id: dl.id, targetId: M.Anchit.id, level: 'full' });
ok('sharing it in full answers the open ask too', (await admin.query(`select status from vault_requests where id = $1`, [ask3.id])).rows[0].status === 'allowed');

// ---- "can open it" is reading, not rewriting
ok('Anchit cannot edit Rahul\'s PAN', (await vault(M.Anchit, { action: 'update', id: pan.id, kind: 'pan', label: 'Changed', aboutId: M.Rahul.id })).status === 403);
ok('nor remove it', (await vault(M.Anchit, { action: 'remove', id: pan.id })).status === 403);
const edit = await vault(M.Rahul, { action: 'update', id: pan.id, kind: 'pan', label: "Rahul's PAN card", aboutId: M.Rahul.id, number: '', notes: 'for the car claim' });
const panRow = (await admin.query(`select last4, label from vault_docs where id = $1`, [pan.id])).rows[0];
ok('editing the name and notes keeps the last 4 digits', edit.status === 200 && panRow.last4 === '234F' && panRow.label === "Rahul's PAN card", JSON.stringify(panRow));

// ---- whoever added it: visible, and revocable
const papaPolicy = await add(M.Anchit, { kind: 'policy', label: "Papa's health policy", aboutId: M.Papa.id });
let p = await look(M.Papa);
const pol = p.docs.find(d => d.id === papaPolicy.id);
ok('Papa sees that Anchit added it, and can open it himself', pol && pol.by_member === M.Anchit.id && pol.uploader_access === true && pol.my_level === 'full');
ok('Anchit cannot check his own upload', (await vault(M.Anchit, { action: 'verify', id: papaPolicy.id })).status === 400);
ok('Sunita cannot see it until Papa says', !(await look(M.Sunita)).docs.some(d => d.id === papaPolicy.id));
ok('Papa takes Anchit\'s access back', (await vault(M.Papa, { action: 'revoke', id: papaPolicy.id, targetId: M.Anchit.id })).status === 200);
a = await look(M.Anchit);
ok('and Anchit can no longer see or open it', !a.docs.some(d => d.id === papaPolicy.id) && (await vault(M.Anchit, { action: 'open', id: papaPolicy.id })).status === 403);
ok('nor change or remove it', (await vault(M.Anchit, { action: 'remove', id: papaPolicy.id })).status === 403);
await vault(M.Papa, { action: 'grant', id: papaPolicy.id, targetId: M.Anchit.id, level: 'full' });
ok('given back in full, he can open it again', (await vault(M.Anchit, { action: 'open', id: papaPolicy.id })).status === 200);

// ---- Dadi is not on Parwah: whoever keeps her papers decides
const dadi = await call(circleApi, { token: M.Anchit.token, body: { action: 'add_person', code, memberId: M.Anchit.id, personName: 'Dadi', gender: 'f', place: 'parent', ofId: M.Papa.id } });
const dadiDoc = await add(M.Anchit, { kind: 'aadhaar', label: "Dadi's Aadhaar", aboutId: dadi.memberId });
ok('Anchit keeps Dadi\'s Aadhaar and can share it', (await vault(M.Anchit, { action: 'grant', id: dadiDoc.id, targetId: M.Sunita.id, level: 'full' })).status === 200);
ok('a paper cannot be shared with someone not on Parwah', (await vault(M.Anchit, { action: 'grant', id: dadiDoc.id, targetId: dadi.memberId, level: 'full' })).status === 400);
ok('asking Dadi herself is refused, kindly', /not on Parwah/.test((await vault(M.Sunita, { action: 'request', toId: dadi.memberId, kind: 'pan' })).error || ''));
const askD = await vault(M.Rahul, { action: 'request', docId: (await vault(M.Anchit, { action: 'grant', id: dadiDoc.id, targetId: M.Rahul.id, level: 'view' }), dadiDoc.id) });
ok('asking for Dadi\'s paper goes to whoever keeps it', askD.status === 201 && (await admin.query(`select to_member from vault_requests where id = $1`, [askD.id])).rows[0].to_member === M.Anchit.id);

// Codex, on #30: whoever keeps Dadi's papers sees who opened them.
await vault(M.Anchit, { action: 'grant', id: dadiDoc.id, targetId: M.Sunita.id, level: 'full' });
await vault(M.Sunita, { action: 'open', id: dadiDoc.id });
const keeper = await look(M.Anchit);
ok('the keeper of Dadi\'s papers sees Sunita opened her Aadhaar', keeper.log.some(l => l.doc_id === dadiDoc.id && l.action === 'opened' && l.name === 'Sunita'));
// Two answers at once (two taps, two phones): the result is consistent.
const race = await vault(M.Sunita, { action: 'request', toId: M.Rahul.id, kind: 'dl' });
const [yesA, noA] = await Promise.all([
  vault(M.Rahul, { action: 'answer', requestId: race.id, allow: true, docId: dl.id }),
  vault(M.Rahul, { action: 'answer', requestId: race.id, allow: false })
]);
const st = (await admin.query('select status from vault_requests where id = $1', [race.id])).rows[0].status;
const hasAccess = (await admin.query('select count(*)::int as n from vault_access where doc_id = $1 and member_id = $2', [dl.id, M.Sunita.id])).rows[0].n === 1;
ok('two answers at once: exactly one wins, and access matches what it says', [yesA.status, noA.status].sort().join() === '200,409' && (st === 'allowed') === hasAccess, [yesA.status, noA.status, st, hasAccess].join());

// ---- the person page reads which papers can be opened
const book = await call(bookApi, { method: 'GET', token: M.Anchit.token, query: { circle: code, member: M.Anchit.id } });
const rec = (book.records || []).find(x => x.id === pan.id);
ok('the person page knows each paper\'s id and whether you can open it', rec && rec.my_level === 'full' && (book.records || []).every(x => x.id && 'my_level' in x));

// ---- payments: ask first has an answer; the monthly limit holds
const card = await pay(M.Papa, { action: 'add', kind: 'card', label: 'ICICI card', bank: 'ICICI', perTxnCap: 5000, monthlyCap: 6000 });
ok('Papa adds a card label, with a monthly limit', card.status === 201 || card.status === 200, JSON.stringify(card));
const cardId = card.id || (await admin.query(`select id from pay_methods where label = 'ICICI card'`)).rows[0].id;
await pay(M.Papa, { action: 'allow', id: cardId, targetId: M.Rahul.id, perTxnCap: 4000, needsOk: true });
const askPay = await pay(M.Rahul, { action: 'use', id: cardId, amount: 3000, note: 'car service' });
ok('Rahul asks first, as Papa set', askPay.status === 200, JSON.stringify(askPay));
const logRow = (await admin.query(`select id, action from pay_log where method_id = $1 and action = 'asked'`, [cardId])).rows[0];
ok('the ask is written down as an ask', !!logRow);
ok('only Papa answers it', (await pay(M.Rahul, { action: 'approve', logId: logRow.id })).status === 403);
ok('Papa says yes', (await pay(M.Papa, { action: 'approve', logId: logRow.id })).status === 200 &&
   (await admin.query(`select action from pay_log where id = $1`, [logRow.id])).rows[0].action === 'approved');
ok('an answered ask cannot be answered again', (await pay(M.Papa, { action: 'decline', logId: logRow.id })).status === 404);
const over = await pay(M.Papa, { action: 'use', id: cardId, amount: 3500 });
ok('the monthly limit holds: 3,000 + 3,500 is over 6,000', over.status === 400 && /limit for this month/.test(over.error), JSON.stringify(over));
ok('within it is fine', (await pay(M.Papa, { action: 'use', id: cardId, amount: 2500 })).status === 200);
// Two payments at the same moment cannot both slip under the limit.
await admin.query(`delete from pay_log where method_id = $1`, [cardId]); await admin.query(`delete from pay_month where method_id = $1`, [cardId]);
const both = await Promise.all([pay(M.Papa, { action: 'use', id: cardId, amount: 3500 }), pay(M.Papa, { action: 'use', id: cardId, amount: 3500 })]);
const spentNow = (await admin.query(`select coalesce(sum(amount),0)::int as n from pay_log where method_id = $1 and action = 'used'`, [cardId])).rows[0].n;
ok('two payments at once: only one fits under 6,000', both.map(b => b.status).sort().join() === '200,400' && spentNow === 3500, both.map(b => b.status).join() + ' / ' + spentNow);
ok('nobody not on Parwah can be allowed to pay', (await pay(M.Papa, { action: 'allow', id: cardId, targetId: dadi.memberId })).status === 400);
const pl = await call(bookApi, { method: 'GET', token: M.Papa.token, query: { area: 'pay', circle: code, member: M.Papa.id } });
ok('the activity carries each line\'s id and who', (pl.log || []).every(l => l.id && 'member_id' in l));

await admin.end();
for (const pool of globalThis.__parwahPools || []) await pool.end();
if (fails.length) { console.error(`vault.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`vault.dbtest: ${pass}/${pass} checks pass`);
