// LOCATION SHARING, END TO END: a real browser with the phone's position,
// the real API and a real PostgreSQL. Rohan (in Pune) shares, Meera (in
// Delhi) sees him with how far away he is and a Maps link; he switches to
// area only, then stops, and his position is gone. A phone that refuses
// location is told how to allow it, and nothing is shared.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('location.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('location.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('location.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['care', 'events', 'chats', 'auth', 'settings']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { fromWall } = await import('../../../api/_recur.mjs');
await ensureSchema(db());

// ---- the family
let n = 0;
async function person(circleId, name) {
  const phone = '+9198500' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, relation, user_id) values ($1,$2,$3,$4) returning id`, [circleId, name, name === 'Rohan' ? 'son' : 'daughter', u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, userId: u.id, name, token, phone };
}
const circle = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const rohan = await person(circle, 'Rohan');
const meera = await person(circle, 'Meera');

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const h = HANDLERS[u.pathname.slice(5).replace(/\/$/, '')];
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
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };
const errors = [];
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const PUNE = { latitude: 18.520430, longitude: 73.856743, accuracy: 15 };
const DELHI = { latitude: 28.613939, longitude: 77.209023, accuracy: 20 };

async function phone(who, geo, allow = true) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', geolocation: geo,
                                         permissions: allow ? ['geolocation'] : [] });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah', JSON.stringify({ code: 'SHARMA', memberId: w.id, name: w.name, role: 'family', circleName: 'Sharma Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/#people');
  await page.waitForTimeout(900);
  page.ctx = ctx;
  return page;
}
const share = async () => (await admin.query('select * from location_shares where member_id = $1', [rohan.id])).rows[0];

const R = await phone(rohan, PUNE);
const M = await phone(meera, DELHI);

// ---- the card, before anyone shares
ok('People shows where everyone is', await R.isVisible('#loc-card') && /Where everyone is/.test(await R.textContent('#loc-card h3')));
ok('it says who would see it, and that stopping deletes it', /Sharma Family/.test(await R.textContent('#loc-why')) && /stopping deletes it/.test(await R.textContent('#loc-why')));
ok('nothing is shared until you choose to', /not sharing/.test(await R.textContent('#loc-status')) && /Nobody here is sharing yet/.test(await R.textContent('#loc-list')));

// ---- Rohan shares
await R.click('#loc-share');
await R.waitForTimeout(1200);
const s1 = await share();
ok('Rohan taps Share: his position from the phone is saved', s1 && s1.enabled && Math.abs(s1.lat - PUNE.latitude) < 1e-5 && s1.accuracy === 15);
ok('his screen says he is sharing, with whom', /You are sharing your exact location with Sharma Family/.test(await R.textContent('#loc-status')));
ok('and offers a way to stop', await R.isVisible('#loc-stop') && !(await R.isVisible('#loc-share')));
await M.reload(); await M.waitForTimeout(1000);
const row = M.locator('#loc-list .crow', { hasText: 'Rohan' });
ok('Meera sees Rohan', await row.count() === 1);
const sub = await row.textContent();
ok('with how precise and how fresh', /within 15 m/.test(sub) && /updated just now/.test(sub), sub);
ok('and how far from her, worked out on her phone although she is not sharing', /1,173 km away/.test(sub), sub);
const sent = (await admin.query('select count(*)::int as n from location_shares where member_id = $1', [meera.id])).rows[0].n;
ok('her own position was never sent', sent === 0);
const href = await row.locator('a').getAttribute('href');
ok('and one tap to open it in Maps', href.startsWith('https://www.google.com/maps/search/?api=1&query=18.52043'), href);
ok('the family feed says Rohan is sharing', (await admin.query(`select count(*)::int as n from events where type = 'location' and text like 'Rohan is sharing%'`)).rows[0].n === 1);

// ---- area only, on a connection that drops the reload straight after
let dropped = 0;
await R.route('**/api/settings?area=location&circle=*', (route) => {
  if (route.request().method() === 'GET' && dropped === 0) { dropped++; return route.abort(); }
  return route.continue();
});
await R.click('#loc-prec [data-prec="area"]');
await R.waitForTimeout(900);
const s2 = await share();
ok('Area only: the exact spot is no longer stored', s2.precision === 'area' && s2.accuracy === 1100 && Math.abs(s2.lat - PUNE.latitude) > 1e-4);
// Rohan leaves People and moves across Pune; the reload after switching failed.
await R.evaluate(() => { location.hash = '#home'; });
await R.waitForTimeout(400);
await R.context().setGeolocation({ latitude: 18.5590, longitude: 73.7868, accuracy: 15 });
await R.waitForTimeout(2500);
const s2m = await share();
ok('even when the reload after switching failed, his area keeps following him', dropped === 1 && s2m.precision === 'area' && s2m.lat === 18.555 && s2m.lng === 73.785, JSON.stringify({ dropped, lat: s2m.lat, lng: s2m.lng }));
await R.unroute('**/api/settings?area=location&circle=*');
await R.context().setGeolocation(PUNE);
await R.evaluate(() => { location.hash = '#people'; });
await R.waitForTimeout(900);
await M.reload(); await M.waitForTimeout(1000);
ok('Meera now sees only his area', /area only/.test(await M.locator('#loc-list .crow', { hasText: 'Rohan' }).textContent()));

// ---- back to exact: a fresh fix is sent, so "exact" is never a label on an area
await R.click('#loc-prec [data-prec="exact"]');
await R.waitForTimeout(1500);
const s2b = await share();
ok('switching back to exact sends a fresh position straight away', s2b.precision === 'exact' && s2b.accuracy === 15 && Math.abs(s2b.lat - PUNE.latitude) < 1e-5, JSON.stringify(s2b));

// ---- stop, seen by Meera without her doing anything
ok('Meera still sees Rohan before he stops', await M.locator('#loc-list .crow', { hasText: 'Rohan' }).count() === 1);
await R.click('#loc-stop');
await R.waitForTimeout(900);
const s3 = await share();
ok('Rohan stops: his position is deleted', s3.enabled === false && s3.lat === null && s3.lng === null);
ok('his screen says he is not sharing', /not sharing/.test(await R.textContent('#loc-status')) && await R.isVisible('#loc-share'));
let gone = false;
for (let i = 0; i < 34 && !gone; i++) { await M.waitForTimeout(1000); gone = await M.locator('#loc-list .crow', { hasText: 'Rohan' }).count() === 0; }
ok('Meera no longer sees him, within 30 seconds, without reloading or leaving People', gone);

// ---- Stop wins over a precision change still on its way, even offline after
await R.click('#loc-share');
await R.waitForTimeout(1200);
ok('Rohan shares again', (await share()).enabled === true);
await R.route('**/api/settings?area=location*', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') return route.abort();          // every reload fails
  const body = req.postDataJSON() || {};
  if (body.action === 'precision') {                          // the reply is slow
    const res = await route.fetch();
    await new Promise(r => setTimeout(r, 1500));
    return route.fulfill({ response: res });
  }
  return route.continue();
});
const sentAfter = [];
let stopped = false;
R.on('request', (req) => {
  if (stopped && req.method() === 'POST' && /area=location/.test(req.url()) && (req.postDataJSON() || {}).action === 'update') sentAfter.push(req.url());
});
await R.click('#loc-prec [data-prec="area"]');
await R.waitForTimeout(150);
await R.click('#loc-stop');
stopped = true;
await R.waitForTimeout(2200);                                 // the slow reply lands after Stop
await R.context().setGeolocation({ latitude: 18.5590, longitude: 73.7868, accuracy: 15 });
await R.waitForTimeout(2500);
const s4 = await share();
ok('after Stop, a late precision reply does not start reading the location again', sentAfter.length === 0, sentAfter.length);
ok('and nothing is stored', s4.enabled === false && s4.lat === null, JSON.stringify(s4));
await R.unroute('**/api/settings?area=location*');
await R.context().setGeolocation(PUNE);

// ---- while Stop is still on its way, a reload that reads "sharing" cannot restart it
await R.click('#loc-share');
await R.waitForTimeout(1500);
ok('Rohan shares once more', (await share()).enabled === true);
let stopAt = 0;
const readAfterStop = [];
await R.route('**/api/settings?area=location*', async (route) => {
  const req = route.request();
  const body = req.method() === 'POST' ? (req.postDataJSON() || {}) : {};
  if (body.action === 'update') {
    if (stopAt) readAfterStop.push(Date.now() - stopAt);
    const res = await route.fetch();                          // the server takes it at once...
    await new Promise(r => setTimeout(r, 800));               // ...the answer is slow
    return route.fulfill({ response: res });
  }
  if (body.action === 'stop') {
    await new Promise(r => setTimeout(r, 2500));              // Stop is slow to arrive
    return route.continue();
  }
  return route.continue();
});
await R.context().setGeolocation({ latitude: 18.5590, longitude: 73.7868, accuracy: 15 });   // a move: one update goes out
await R.waitForTimeout(150);
let stopsSent = 0;
R.on('request', (req) => { if (req.method() === 'POST' && (req.postDataJSON() || {}).action === 'stop') stopsSent++; });
await R.click('#loc-stop');
stopAt = Date.now();
await R.evaluate(() => document.getElementById('loc-stop').click());   // an impatient second tap
await R.waitForTimeout(100);
ok('a second tap on Stop while the first is on its way sends nothing more', stopsSent === 1, stopsSent);
await R.waitForTimeout(1300);                                  // the update's answer has come back and reloaded
await R.context().setGeolocation({ latitude: 18.6000, longitude: 73.7500, accuracy: 15 });   // moves again while Stop is on its way
await R.waitForTimeout(3000);
const s5 = await share();
ok('while Stop was on its way, the phone did not read the location again', readAfterStop.length === 0, readAfterStop.join(','));
ok('and once Stop lands, nothing is stored', s5.enabled === false && s5.lat === null, JSON.stringify(s5));
ok('his screen says he is not sharing', /not sharing/.test(await R.textContent('#loc-status')));
await R.unroute('**/api/settings?area=location*');
await R.context().setGeolocation(PUNE);

// ---- a phone that says no
const D = await phone(meera, DELHI, false);
await D.click('#loc-share');
await D.waitForTimeout(1500);
ok('when the phone refuses location, Parwah says how to allow it', /Allow location for Parwah/.test(await D.textContent('#loc-err')) && await D.isVisible('#loc-err'));
ok('and nothing is shared', !(await admin.query('select * from location_shares where member_id = $1 and enabled', [meera.id])).rows[0]);

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`location.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`location.e2e: ${pass}/${pass} checks pass`);
