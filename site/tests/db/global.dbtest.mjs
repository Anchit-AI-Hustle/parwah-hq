// A FAMILY SPREAD ACROSS COUNTRIES, AGAINST A REAL DATABASE: the real
// handlers, on a throwaway PostgreSQL. Priya lives in London, Arjun in New
// York, Papa in Pune, Lena in Berlin with no city saved.
//
// What it proves:
//   - a household bill saved from the app is really saved and settled, in
//     the money of whoever added it, and UPI is offered only for a rupee
//     bill with the biller's own UPI ID;
//   - a card's limits are said in its owner's money;
//   - a US passport is accepted for someone in the US, and the Indian shape
//     still applies to someone in India;
//   - the day screen falls back to the member's own country, not Delhi;
//   - a task with no zone takes the phone's;
//   - Ekta, with no AI key, gives a family in the US 911.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('global.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('global.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_WORKSPACE_ID', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
                 'XAI_API_KEY', 'GROK_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OLLAMA_URL']) delete process.env[k];

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: careApi } = await import('../../../api/care.mjs');
const { default: bookApi } = await import('../../../api/book.mjs');
const { default: settingsApi } = await import('../../../api/settings.mjs');
const { default: ekta } = await import('../../../api/ekta.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { ensureCoinSchema } = await import('../../../api/_coins.mjs');
const sql = db();
await ensureSchema(sql);
await ensureCoinSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };

const code = 'GLOB01';
const fam = (await admin.query(`insert into circles (code, name) values ($1, 'Mehta Family') returning id`, [code])).rows[0].id;
let n = 0;
async function person(name, country, place) {
  const phone = '+9198300' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1, '+91', $2, $3) returning id`,
                               [phone, phone.slice(3), name])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id, country, place) values ($1, $2, 'family', $3, $4, $5) returning id`,
                               [fam, name, u.id, country, place])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, name, token };
}
const priya = await person('Priya', 'GB', 'London');
const arjun = await person('Arjun', 'US', 'New York');
const papa = await person('Papa', 'IN', 'Pune');
const lena = await person('Lena', 'DE', null);

async function call(handler, who, { method = 'POST', body = {}, query = {}, tz } = {}) {
  const headers = { 'x-parwah-token': who.token, 'x-forwarded-for': '10.4.1.1' };
  if (tz) headers['x-parwah-tz'] = tz;
  const req = { method, headers, query, body: method === 'POST' ? { code, memberId: who.id, ...body } : undefined };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {}, end() { return this; } };
  await handler(req, res);
  return { ...json, status };
}

// The book and vault make their own tables on first use, as in production.
await call(bookApi, priya, { method: 'GET', query: { circle: code, member: priya.id } });
await call(bookApi, priya, { method: 'GET', query: { area: 'vault', circle: code, member: priya.id } });

// ---- household bills, sent exactly as the app sends them -----------------
const billLondon = await call(careApi, priya, { query: { area: 'bills' }, body: { action: 'create', biller_name: 'Thames Water',
  bill_category: 'WATER', consumer_number: '1234', amount_due: 45, due_date: '2026-11-01', assigned_payer_id: priya.id, upi_id: null } });
ok('a bill saved from the app is saved', billLondon.ok && billLondon.id, JSON.stringify(billLondon));
const billPune = await call(careApi, papa, { query: { area: 'bills' }, body: { action: 'create', biller_name: 'MSEDCL',
  bill_category: 'ELECTRICITY', amount_due: 1450, upi_id: 'msedcl@sbi' } });
ok('and one from India, with the biller\'s UPI ID', billPune.ok, JSON.stringify(billPune));
const badUpi = await call(careApi, papa, { query: { area: 'bills' }, body: { action: 'create', biller_name: 'X', amount_due: 10, upi_id: 'not a upi' } });
ok('a UPI ID that is not one is refused', badUpi.status === 400, JSON.stringify(badUpi));
const noAmt = await call(careApi, papa, { query: { area: 'bills' }, body: { action: 'create', biller_name: 'X', amount_due: 0 } });
ok('a bill with no amount is refused', noAmt.status === 400);
const list = await call(careApi, priya, { method: 'GET', query: { area: 'bills', circle: code, member: priya.id } });
const L = (list.bills || []).find(b => b.biller_name === 'Thames Water'), P = (list.bills || []).find(b => b.biller_name === 'MSEDCL');
ok('the London bill is in pounds, with no UPI', L && L.currency === 'GBP' && !L.upi_link, JSON.stringify(L));
ok('the Pune bill is in rupees and pays the biller\'s own UPI ID', P && P.currency === 'INR' && /pa=msedcl%40sbi/.test(P.upi_link || ''), P && P.upi_link);
const settled = await call(careApi, arjun, { query: { area: 'bills' }, body: { action: 'settle', id: billLondon.id } });
ok('settling it from the app works', settled.ok && /£45/.test(settled.notification || ''), JSON.stringify(settled));
const after = (await call(careApi, priya, { method: 'GET', query: { area: 'bills', circle: code, member: priya.id } })).bills.find(b => b.id === billLondon.id);
ok('and it shows as settled, by Arjun', after && after.payment_status === 'SETTLED' && after.settled_by_name === 'Arjun', JSON.stringify(after));

// ---- a card's limits, in its owner's money --------------------------------
const pay = (who, body) => call(bookApi, who, { query: { area: 'pay' }, body: { area: 'pay', ...body } });
const card = await pay(priya, { action: 'add', kind: 'card', label: "Priya's Monzo", perTxnCap: '£500', monthlyCap: '2000' });
ok('a UK card is added with a cap written with a pound sign', card.status === 201, JSON.stringify(card));
await pay(priya, { action: 'allow', id: card.id, targetId: arjun.id, perTxnCap: '500' });
const over = await pay(arjun, { action: 'use', id: card.id, amount: 600, note: 'groceries' });
ok('going over it is refused, in pounds', over.status === 400 && /£500/.test(over.error || '') && !/₹/.test(over.error || ''), over.error);
const look = await call(bookApi, priya, { method: 'GET', query: { area: 'pay', circle: code, member: priya.id } });
ok('the card says which money it is in', (look.methods || []).some(m => m.id === card.id && m.currency === 'GBP'), JSON.stringify(look.methods));

// ---- a passport from another country -------------------------------------
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const doc = (who, body) => call(bookApi, who, { query: { area: 'vault' }, body: { area: 'vault', action: 'add', file: pngB64, fileMime: 'image/png', fileName: 'p.png', ...body } });
const usp = await doc(arjun, { kind: 'passport', label: "Arjun's passport", aboutId: arjun.id, number: '533380006' });
ok('a US passport is accepted for someone in the US', usp.status === 201 || usp.ok, JSON.stringify(usp));
const inp = await doc(papa, { kind: 'passport', label: "Papa's passport", aboutId: papa.id, number: '533380006' });
ok('the same number for someone in India is checked as an Indian passport', inp.status === 400 && /Indian passport/.test(inp.error || ''), JSON.stringify(inp));
const oci = await doc(arjun, { kind: 'oci', label: "Arjun's OCI card", aboutId: arjun.id, number: 'A1234567' });
ok('an OCI card can be kept', oci.status === 201 || oci.ok, JSON.stringify(oci));

// ---- the day, where they are ---------------------------------------------
const dayOf = (who, tz) => call(settingsApi, who, { method: 'GET', query: { area: 'day', circle: code, member: who.id, tz } });
const dl = await dayOf(lena, 'Europe/Berlin');
ok('no city saved in Germany: Berlin timings, said as a guess', dl.ok && dl.tz === 'Europe/Berlin' && dl.place.usedName === 'Berlin' && dl.place.unset, JSON.stringify(dl.place));
const dp = await dayOf(priya);
ok('London is London', dp.ok && dp.tz === 'Europe/London' && !dp.place.guessed, JSON.stringify(dp.place));
const dn = await dayOf(papa);
ok('and Pune is still Pune', dn.ok && dn.tz === 'Asia/Kolkata' && !dn.place.guessed);

// ---- a task with no zone takes the phone's -------------------------------
const t = await call(careApi, arjun, { tz: 'America/New_York', body: { action: 'task_create', title: 'Call the pharmacy', dueAt: '2026-11-02T14:00:00.000Z' } });
const tz = t.id ? (await admin.query('select tz from requests where id = $1', [t.id])).rows[0] : null;
ok('a task made in New York keeps New York time', tz && tz.tz === 'America/New_York', JSON.stringify(t) + ' ' + JSON.stringify(tz));

// ---- Ekta, with no AI key, in the US -------------------------------------
const e = await call(ekta, arjun, { tz: 'America/New_York', body: { messages: [{ role: 'user', content: 'Papa has chest pain and cannot breathe' }] } });
ok('an emergency in the US is told 911', /911/.test(e.reply || '') && !/\b108\b/.test(e.reply || ''), e.reply);
const ep = await call(ekta, papa, { body: { messages: [{ role: 'user', content: 'Papa has chest pain and cannot breathe' }] } });
ok('and in India 112 with 108', /112/.test(ep.reply || '') && /108/.test(ep.reply || ''), ep.reply);

await admin.end();
for (const f of fails) console.log('FAIL  ' + f);
console.log('global.dbtest: ' + pass + '/' + (pass + fails.length) + ' checks pass');
process.exit(fails.length ? 1 : 0);
