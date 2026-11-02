// WHERE A JOIN CAME FROM, END TO END: a real browser, the real
// api/auth.mjs handler and a real PostgreSQL.
//
// A person lands from a LinkedIn post or a creator's reel. Every WhatsApp
// button then pre-fills that source code, on every page they visit in the
// tab, and a join on /launch/ stores the campaign labels with the row. A
// second join from another link keeps the first touch. With no labels each
// page uses its own code. Nothing is sent anywhere else.
//
// Needs PARWAH_TEST_DATABASE_URL (a database ending in _test - it is wiped)
// and playwright-core. Run with: npm run test:db
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('attrib.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('attrib.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('attrib.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const auth = (await import('../../../api/auth.mjs')).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
await ensureSchema(db());

// ---- a server: the site's files, and the real handler behind /api/auth
const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const posts = [];
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname.replace(/\/$/, '') !== '/api/auth') { res.statusCode = 404; res.end('{"ok":false}'); return; }
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    if (req.method === 'POST') posts.push(body);
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.0.' + posts.length }, query: Object.fromEntries(u.searchParams), body };
    const w = { status(s) { res.statusCode = s; return this; }, json(j) { res.end(JSON.stringify(j)); return this; }, setHeader(k, v) { res.setHeader(k, v); return this; } };
    // A beat of latency, so a second tap lands while the first is in flight.
    await new Promise(r => setTimeout(r, 300));
    try { await auth(r, w); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })); }
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

async function open(route, viewport = { width: 390, height: 844 }, scheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(route + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(route + ': ' + m.text()); });
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  return page;
}
const rows = async () => (await admin.query('select * from waitlist order by created_at')).rows;
const msgOf = (page) => page.locator('#wl-msg').innerText();


async function post(body) {
  const r = await fetch(BASE + '/api/auth/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

const waText = async (page) => page.$$eval('a[href^="https://wa.me/"]', as => as.map(a => new URL(a.href).searchParams.get('text')));
const thirdParty = [];

// ---- 1. no labels: each page says itself
{
  const page = await open('/care/');
  const t = await waText(page);
  ok('a page with no labels pre-fills its own code', t.length >= 2 && t.every(x => /^Hi Parwah \(CAR\) - /.test(x)), t.join(' | '));
  await page.context().close();
}

// ---- 2. a LinkedIn post: the code follows the person through the tab
{
  const page = await open('/story/?utm_source=linkedin&utm_medium=social&utm_campaign=1');
  let t = await waText(page);
  ok('a LinkedIn link becomes LI1 in the WhatsApp message', t.length >= 1 && t.every(x => x.startsWith('Hi Parwah (LI1) - ')), t.join(' | '));
  ok('and the message reads with spaces, not plus signs', t.every(x => !x.includes('+')) && (await page.$eval('a[href^="https://wa.me/"]', a => a.getAttribute('href'))).includes('%20'));
  await page.goto(BASE + '/care/', { waitUntil: 'networkidle' });
  t = await waText(page);
  ok('the next page in the same tab still says LI1 (first touch)', t.every(x => x.startsWith('Hi Parwah (LI1) - ')), t.join(' | '));
  await page.goto(BASE + '/launch/?utm_source=facebook&utm_campaign=9', { waitUntil: 'networkidle' });
  t = await waText(page);
  ok('a later link in the same tab does not overwrite the first touch', t.every(x => x.startsWith('Hi Parwah (LI1) - ')), t.join(' | '));
  await page.context().close();
}

// ---- 3. a creator reel: the join stores the labels
{
  const page = await open('/launch/?ref=CR7&utm_source=creator&utm_medium=reel&utm_campaign=papa');
  page.on('request', r => { const u = new URL(r.url()); if (u.origin !== BASE) thirdParty.push(u.host); });
  const t = await waText(page);
  ok('a ref code is used as it is', t.length >= 2 && t.every(x => x.startsWith('Hi Parwah (CR7) - ')), t.join(' | '));
  await page.fill('#wl-name', 'Asha Verma');
  await page.fill('#wl-email', 'Asha@Example.com');
  await page.check('#wl-consent');
  await page.click('#wl-submit');
  await page.waitForSelector('#wl-msg.ok', { timeout: 8000 });
  const r = (await rows()).find(x => x.email === 'asha@example.com');
  ok('the join is stored', !!r);
  ok('with the campaign labels from the landing address',
     r && r.utm_source === 'creator' && r.utm_medium === 'reel' && r.utm_campaign === 'papa' && r.ref === 'CR7', JSON.stringify(r && { s: r.utm_source, m: r.utm_medium, c: r.utm_campaign, ref: r.ref }));
  ok('and the source of the form itself is unchanged', r && r.source === 'launch-page');
  await page.context().close();
}

// ---- 4. the same person joins again from an ad: the first touch is kept
{
  const page = await open('/launch/?utm_source=facebook&utm_medium=paid&utm_campaign=angle2');
  await page.fill('#wl-name', 'Asha Verma');
  await page.fill('#wl-email', 'asha@example.com');
  await page.check('#wl-consent');
  await page.click('#wl-submit');
  await page.waitForSelector('#wl-msg.ok', { timeout: 8000 });
  const all = (await rows()).filter(x => x.email === 'asha@example.com');
  ok('still one row for one person', all.length === 1);
  ok('and it keeps the link that first brought her', all[0] && all[0].utm_source === 'creator' && all[0].ref === 'CR7', JSON.stringify(all[0] && all[0].utm_source));
  await page.context().close();
}

// ---- 5. no labels at all: the row says nothing rather than something made up
{
  const page = await open('/launch/');
  await page.fill('#wl-name', 'Ravi Kumar');
  await page.fill('#wl-email', 'ravi@example.com');
  await page.check('#wl-consent');
  await page.click('#wl-submit');
  await page.waitForSelector('#wl-msg.ok', { timeout: 8000 });
  const r = (await rows()).find(x => x.email === 'ravi@example.com');
  ok('an organic join stores no campaign labels', r && r.utm_source === null && r.ref === null);
  await page.context().close();
}

// ---- 6. junk in the address never reaches the message or the table
{
  const page = await open('/launch/?ref=%3Cimg%20src%3Dx%3E&utm_source=%22%3E%3Cscript%3E');
  const t = await waText(page);
  ok('markup in a ref is cut down to letters and digits', t.every(x => /^Hi Parwah \([A-Z0-9]{2,12}\) - /.test(x)), t.join(' | '));
  const r = await post({ action: 'waitlist', name: 'Test Person', email: 'junk@example.com', consent: true, ref: '<b>x</b>"', utm_source: "a'b c" });
  const row = (await rows()).find(x => x.email === 'junk@example.com');
  ok('and the server strips it again before storing', r.status === 200 && row && row.ref === 'bxb' && row.utm_source === 'abc', JSON.stringify(row && [row.ref, row.utm_source]));
  await page.context().close();
}

ok('the attribution sends nothing to anyone else', thirdParty.filter(h => !/fonts\.(googleapis|gstatic)\.com/.test(h)).length === 0, thirdParty.join(', '));
ok('no script errors on any page', errors.length === 0, errors.join(' | '));

await browser.close(); server.close(); await admin.end();
console.log(`attrib.e2e: ${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
