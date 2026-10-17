// A FAMILY ACROSS TWO COUNTRIES, END TO END: real browsers, the real API
// handlers and a real PostgreSQL. Priya's phone is in Leicester, Papa's in
// Pune.
//
// What it proves: the SOS sheet rings 999 in the UK and 112 in India; a
// household bill is saved and settled from the app in pounds, with UPI
// offered only in India; an address in the UK takes a postcode, not an
// Indian PIN code; a card's cap is in its owner's money.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('global.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('global.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('global.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['care', 'events', 'chats', 'auth', 'book', 'plans', 'settings']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

// ---- the family
let n = 0;
async function person(circleId, name, role = 'family', relation = null) {
  const phone = '+9198200' + String(++n).padStart(5, '0');
  // A settled account: a PIN chosen under the current rules.
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, relation, user_id) values ($1,$2,$3,$4,$5) returning id`, [circleId, name, role, relation, u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, userId: u.id, name, token, phone };
}
const circle = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const priya = await person(circle, 'Priya', 'family', 'daughter');
const papa = await person(circle, 'Papa', 'parent', 'father');
await admin.query(`update members set country = 'GB', place = 'Leicester' where id = $1`, [priya.id]);
await admin.query(`update members set country = 'IN', place = 'Pune' where id = $1`, [papa.id]);

// ---- a server: the app's files, and the real handlers behind /api/
const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/\/$/, '');
    const h = HANDLERS[name];
    res.setHeader('Content-Type', 'application/json');
    if (!h) { res.end('{"ok":false,"error":"not in this test"}'); return; }
    let raw = ''; for await (const c of req) raw += c;
    const r = { method: req.method, headers: req.headers, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
    const w = { status(s) { res.statusCode = s; return this; }, json(j) { res.end(JSON.stringify(j)); return this; }, setHeader(k, v) { res.setHeader(k, v); return this; } };
    try { await h(r, w); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  }
  let p = u.pathname; if (p.endsWith('/')) p += 'index.html';
  try { const d = await readFile(path.join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;


let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || !detail ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };
const errors = [];
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
async function phone(who, tz, hash = '#home') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: tz, locale: 'en-GB', serviceWorkers: 'block' });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah', JSON.stringify({ code: 'SHARMA', memberId: w.id, name: w.name, role: 'family', circleName: 'Sharma Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash); await page.waitForTimeout(1500);
  return page;
}
const P = await phone(priya, 'Europe/London');

// ---- the SOS sheet rings the UK's number
ok('the SOS sheet calls 999 for a member in the UK', /tel:999/.test(await P.$eval('#ss-calls', e => e.innerHTML)), await P.$eval('#ss-calls', e => e.innerHTML));

// ---- a household bill, in pounds, with no UPI
await P.evaluate(() => { location.hash = '#care'; }); await P.waitForTimeout(600);
await P.click('#care-seg [data-sec="bills"]'); await P.waitForTimeout(900);
ok('the amount box says pounds', (await P.textContent('label:has(#bill-amount)')).includes('£'), await P.textContent('label:has(#bill-amount)'));
ok('UPI is not offered in the UK', !(await P.isVisible('#bill-upi')));
await P.fill('#bill-name', 'Severn Trent'); await P.fill('#bill-amount', '38');
await P.click('#btn-add-bill'); await P.waitForTimeout(1500);
const bill = (await admin.query(`select * from care_bills where biller_name = 'Severn Trent'`)).rows[0];
ok('the bill is really saved', bill && Number(bill.amount_due) === 38 && bill.created_by === priya.id, JSON.stringify(bill));
const feed = await P.textContent('#bill-feed');
ok('and shown in pounds, with no Pay via UPI', /£38/.test(feed) && !/Rs |₹|UPI/.test(feed), feed);
await P.click('[data-settlebill]'); await P.waitForTimeout(1500);
ok('Mark as Paid settles it', (await admin.query(`select payment_status from care_bills where id = $1`, [bill && bill.id])).rows[0].payment_status === 'SETTLED');
ok('and says who settled it', /Settled by Priya/.test(await P.textContent('#bill-feed')), await P.textContent('#bill-feed'));

// ---- an address in the UK has a postcode, not a PIN code
await P.evaluate(() => { location.hash = '#memory'; }); await P.waitForTimeout(700);
await P.evaluate(() => { const b = document.querySelector('#b-kind [data-k="address"]'); if (b) b.click(); });
await P.waitForTimeout(400);
ok('the address form starts on the member\'s own country', (await P.inputValue('#b-actry')) === 'GB', await P.inputValue('#b-actry'));
ok('and asks for a postcode, with no India Post check', (await P.textContent('#b-pin-l')) === 'Postcode / ZIP' && !(await P.isVisible('#b-pinlook')));
await P.fill('#b-address', '12 London Road'); await P.fill('#b-pin', 'le1 7rh');
await P.fill('#b-city', 'Leicester'); await P.fill('#b-state', 'Leicestershire');
await P.waitForTimeout(200);
ok('the line it will save is a UK address', (await P.textContent('#b-addrfull')) === 'Saved as: 12 London Road, Leicester - Leicestershire LE1 7RH - United Kingdom', await P.textContent('#b-addrfull'));
await P.selectOption('#b-actry', 'IN'); await P.waitForTimeout(200);
ok('switching to India brings back the PIN code check', (await P.textContent('#b-pin-l')) === 'PIN code' && await P.isVisible('#b-pinlook'));

// ---- a card's cap is in pounds
await P.evaluate(() => { location.hash = '#vault'; }); await P.waitForTimeout(800);
await P.evaluate(() => { const b = document.querySelector('#vault-seg [data-sec="pay"]'); if (b) b.click(); });
await P.waitForTimeout(900);
ok('the payment cap is in pounds', /£/.test(await P.textContent('label[for="vp-cap"]')), await P.textContent('label[for="vp-cap"]'));

// ---- Papa in Pune still sees India
const Q = await phone(papa, 'Asia/Kolkata');
ok('Papa\'s SOS sheet still calls 112', /tel:112/.test(await Q.$eval('#ss-calls', e => e.innerHTML)));
await Q.evaluate(() => { location.hash = '#care'; }); await Q.waitForTimeout(600);
await Q.click('#care-seg [data-sec="bills"]'); await Q.waitForTimeout(900);
ok('and the bill amount in rupees, with UPI offered', (await Q.textContent('label:has(#bill-amount)')).includes('₹') && await Q.isVisible('#bill-upi'));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`global.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`global.e2e: ${pass}/${pass} checks pass`);
