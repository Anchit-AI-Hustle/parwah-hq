// SOS, END TO END: a real browser per phone, the real API handlers and a
// real PostgreSQL. Papa presses the red button; Rohan's phone, open on
// Today, takes the whole screen with the alarm.
//
// What it proves: the button is on every screen; the 5-second countdown can
// be cancelled and nothing is sent; once sent, the SOS has Papa's position,
// the family chat has the message with a map link, location sharing is on,
// exact, and Papa cannot stop it; the live screen offers 112 and the family
// by phone, and WhatsApp, SMS and email filled in; a recording reaches the
// family; Rohan's alarm answers with I am on it; Papa saying he is safe does
// not close it; Rohan marking it sorted does, and hands Papa his location
// sharing back.
//
// Needs PARWAH_TEST_DATABASE_URL (a database ending in _test - it is wiped)
// and playwright-core. Run with: npm run test:db
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('sos.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('sos.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('sos.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['care', 'events', 'chats', 'auth', 'book', 'settings']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
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
const rohan = await person(circle, 'Rohan', 'family', 'son');
const papa = await person(circle, 'Papa', 'parent', 'father');
await admin.query(`update members set phone = '+919820000001' where id = $1`, [rohan.id]);
await admin.query(`update members set phone = '+919820000003' where id = $1`, [papa.id]);

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
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const HOME = { latitude: 28.5355, longitude: 77.2410, accuracy: 12 };
async function phone(who, hash = '#home') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'Asia/Kolkata',
                                         geolocation: HOME, permissions: ['geolocation', 'microphone'] });
  await ctx.route('**/maps.google.com/**', r => r.fulfill({ body: '<html></html>', contentType: 'text/html' }));
  await ctx.route('**/www.google.com/maps/**', r => r.fulfill({ body: '<html></html>', contentType: 'text/html' }));
  await ctx.addInitScript(([w]) => {
    if (window !== window.top) return;
    localStorage.setItem('parwah', JSON.stringify({ code: 'SHARMA', memberId: w.id, name: w.name, role: 'family', circleName: 'Sharma Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
    // What the phone would have buzzed, kept so the test can see it.
    window.__buzz = []; navigator.vibrate = (p) => { window.__buzz.push(p); return true; };
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/' + hash);
  await page.waitForTimeout(1500);
  return page;
}
const vis = (p, sel) => p.locator(sel).isVisible();
const q1 = async (sql, args) => (await admin.query(sql, args || [])).rows[0];
const api = (page, who, body) => page.evaluate(async ([b, tok]) => {
  const r = await fetch(b.__url || '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Parwah-Token': tok }, body: JSON.stringify(b) });
  return { status: r.status, ...(await r.json()) };
}, [{ code: 'SHARMA', memberId: who.id, ...body }, who.token]);

const P = await phone(papa);
const R = await phone(rohan);

// ---- 1. The red button is on every screen
for (const t of ['home', 'vault', 'care', 'people', 'chat', 'ekta', 'fun', 'memory', 'profile']) {
  await P.evaluate(h => { location.hash = '#' + h; }, t); await P.waitForTimeout(250);
  ok('the SOS button is on ' + t, await vis(P, '#sos-fab'));
}
const fab = await P.locator('#sos-fab').boundingBox();
ok('it is big enough to hit in a hurry (at least 56px)', fab && fab.width >= 56 && fab.height >= 56, fab && fab.width);
ok('and named for screen readers', (await P.getAttribute('#sos-fab', 'aria-label')) === 'SOS - get help now');
await P.evaluate(() => { location.hash = '#home'; }); await P.waitForTimeout(300);

if (process.env.SHOTS) await P.screenshot({ path: process.env.SHOTS + '/sos-fab.png' });
// ---- 2. The countdown can be cancelled, and then nothing is sent
await P.click('#sos-fab'); await P.waitForTimeout(300);
if (process.env.SHOTS) await P.screenshot({ path: process.env.SHOTS + '/sos-count.png' });
ok('a tap starts a countdown from 5, full screen', await vis(P, '#sosscreen') && (await P.textContent('#ss-n')) === '5');
ok('with Cancel ready under the thumb', await P.evaluate(() => document.activeElement && document.activeElement.id === 'ss-cancel'));
await P.waitForTimeout(1200);
ok('it counts down', Number(await P.textContent('#ss-n')) <= 4);
await P.click('#ss-cancel'); await P.waitForTimeout(5000);
ok('cancelled: the screen closes', !(await vis(P, '#sosscreen')));
ok('and no SOS was sent', (await q1('select count(*)::int as n from sos')).n === 0);

// ---- 3. Sent: everything at once
await P.click('#sos-fab'); await P.waitForTimeout(6500);
ok('after 5 seconds it sends by itself, and says so', await vis(P, '#ss-live') && /alerted/.test(await P.textContent('#ss-status')), await P.textContent('#ss-status'));
const sos = await q1('select * from sos order by created_at desc limit 1');
ok('the SOS carries where Papa is', sos && Math.abs(sos.lat - HOME.latitude) < 1e-4 && Math.abs(sos.lng - HOME.longitude) < 1e-4, sos && sos.lat + ',' + sos.lng);
const msg = await q1(`select m.text from messages m join chats c on c.id = m.chat_id where c.kind = 'circle' order by m.created_at desc limit 1`);
ok('the family chat has the message, with a map link', msg && /SOS from Papa/.test(msg.text) && /maps\.google\.com\/\?q=28\.5355/.test(msg.text), msg && msg.text);
const ls = await q1('select * from location_shares where member_id = $1', [papa.id]);
ok('location sharing is on, exact, with no end time, held by the SOS', ls && ls.enabled && ls.precision === 'exact' && ls.expires_at === null && ls.sos_lock === sos.id, JSON.stringify(ls && { e: ls.enabled, p: ls.precision, l: ls.sos_lock }));
ok('the screen says the location is shared', /exact location is shared/.test(await P.textContent('#ss-loc')), await P.textContent('#ss-loc'));
const calls = await P.$$eval('#ss-calls a', as => as.map(a => a.getAttribute('href')));
ok('one tap calls 112, and Rohan', calls[0] === 'tel:112' && calls.some(h => /9820000001/.test(h)), calls.join());
ok('WhatsApp is filled in with the message', /^https:\/\/wa\.me\/\?text=.*SOS%20from%20Papa/.test(await P.getAttribute('#ss-wa', 'href')));
ok('SMS is addressed to the family, with the message', /^sms:\+919820000001\?body=.*maps\.google\.com/.test(decodeURIComponent(await P.getAttribute('#ss-sms', 'href'))), await P.getAttribute('#ss-sms', 'href'));
ok('email is filled in too', /^mailto:\?subject=SOS%20from%20Papa&body=/.test(await P.getAttribute('#ss-mail', 'href')));
if (process.env.SHOTS) await P.screenshot({ path: process.env.SHOTS + '/sos-live.png', fullPage: true });
ok('the phone buzzed', (await P.evaluate(() => window.__buzz.length)) > 0);

// ---- 4. Papa cannot switch his location off mid-emergency
const stop = await api(P, papa, { __url: '/api/settings?area=location', action: 'stop' });
ok('Stop is refused while the SOS is open, and says how to end it', stop.status === 423 && /I am safe/.test(stop.error), JSON.stringify(stop));
const blur = await api(P, papa, { __url: '/api/settings?area=location', action: 'precision', precision: 'area' });
ok('so is blurring it to the area', blur.status === 423);
const still = await q1('select enabled, sos_lock from location_shares where member_id = $1', [papa.id]);
ok('and his location is still shared', still.enabled && still.sos_lock === sos.id);

// ---- 5. Rohan's phone: the alarm
await R.waitForTimeout(13000);
ok('Rohan\'s phone takes the whole screen', await vis(R, '#sosalert') && /Papa needs help/.test(await R.textContent('#sa-title')), await R.textContent('#sa-title').catch(() => ''));
if (process.env.SHOTS) await R.screenshot({ path: process.env.SHOTS + '/sos-alarm.png' });
ok('with Call Papa, already dialled in', (await R.getAttribute('#sa-call', 'href')) === 'tel:%2B919820000003');
ok('and See where he is', await vis(R, '#sa-map'));
ok('and it buzzes', (await R.evaluate(() => window.__buzz.length)) > 0);

// ---- 6. The recording reaches the family
await P.waitForTimeout(26000);
const media = await q1('select id, mime, length(data) as n, seconds from sos_media where sos_id = $1', [sos.id]);
ok('a short recording reached the family', media && media.n > 1000 && /^audio\//.test(media.mime), JSON.stringify(media));
ok('and Papa\'s screen says so', /recording is with the family/.test(await P.textContent('#ss-rec')), await P.textContent('#ss-rec'));
const heard = await R.evaluate(async ([id, tok, me]) => {
  const r = await fetch('/api/events?circle=SHARMA&member=' + me + '&sosAudio=' + id, { headers: { 'X-Parwah-Token': tok } });
  return r.json();
}, [media && media.id, rohan.token, rohan.id]);
ok('Rohan can play it', heard.ok && heard.data && heard.data.length === media.n);

// ---- 7. Rohan: I am on it
await R.click('#sa-ack'); await R.waitForTimeout(800);
ok('I am on it closes the alarm', !(await vis(R, '#sosalert')));
ok('and the SOS shows Rohan has it', (await q1('select status, acked_by from sos where id = $1', [sos.id])).acked_by === rohan.id);
await P.waitForTimeout(13000);
ok('Papa\'s screen says Rohan is on it', /Rohan is on it/.test(await P.textContent('#ss-who')), await P.textContent('#ss-who'));

// ---- 9. Rohan marks it sorted: over, and the location is Papa's again
await R.reload(); await R.waitForTimeout(1500);
ok('Rohan has Sorted on the SOS bar', await vis(R, '#sos-done'));
await R.click('#sos-done'); await R.waitForTimeout(200);
// Asked in the app's own sheet now, not the browser's confirm().
await R.click('#as-yes'); await R.waitForTimeout(1000);
const s9 = await q1('select status, resolved_by from sos where id = $1', [sos.id]);
ok('the SOS is sorted, by Rohan', s9.status === 'resolved' && s9.resolved_by === rohan.id);
ok('and the hold on Papa\'s location is lifted', (await q1('select sos_lock from location_shares where member_id = $1', [papa.id])).sos_lock === null);
await P.waitForTimeout(13000);
ok('Papa\'s SOS screen closes by itself', !(await vis(P, '#sosscreen')));
const stop2 = await api(P, papa, { __url: '/api/settings?area=location', action: 'stop' });
ok('and now he can stop sharing', stop2.status === 200 && stop2.sharing === false, JSON.stringify(stop2));

// ---- 10. Papa's own SOS, ended by Papa (owner, 2026-10-10: anyone in the
//          family or group ends it, the sender included), from the red bar,
//          which pushes the page down and never covers the header.
{
  const again = await api(P, papa, { type: 'sos', text: '', lat: 28.5355, lng: 77.391, accuracy: 9 });
  ok('a second SOS goes', again.status === 201 && !!again.sosId, JSON.stringify(again));
  await P.reload(); await P.waitForTimeout(1500);
  await P.evaluate(() => { const s = document.getElementById('sosscreen'); if (s) s.hidden = true; });
  ok('Papa sees his SOS bar, with I am safe', await vis(P, '#sosbar') && /I am safe/.test(await P.textContent('#sos-done')), await P.textContent('#sos-done').catch(() => ''));
  const lay = await P.evaluate(() => { const b = document.getElementById('sosbar').getBoundingClientRect(), h = document.querySelector('.bar').getBoundingClientRect(); return { barBottom: b.bottom, headTop: h.top }; });
  ok('the red bar sits above the header, never over it', lay.headTop >= lay.barBottom - 1, JSON.stringify(lay));
  await P.click('#sos-done'); await P.waitForTimeout(200);
  await P.click('#as-yes'); await P.waitForTimeout(1200);
  const s10 = await q1('select status, resolved_by from sos where id = $1', [again.sosId]);
  ok('Papa closes his own SOS', s10.status === 'resolved' && s10.resolved_by === papa.id, JSON.stringify(s10));
  ok('the hold on his location is lifted', (await q1('select sos_lock from location_shares where member_id = $1', [papa.id])).sos_lock === null);
  ok('and the family is told he is safe', !!(await q1("select 1 from events where text like 'Papa is safe now%'")));
  await P.waitForTimeout(500);
  ok('the bar is gone, and the page moves back up', !(await vis(P, '#sosbar')) && (await P.evaluate(() => !document.body.classList.contains('sosup'))));
}

ok('no script errors on either phone', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`sos.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`sos.e2e: ${pass}/${pass} checks pass`);
