// FIND A PHONE, END TO END: real browsers, the real API handlers and a real
// PostgreSQL. Rohan's phone, and two phones signed in as Papa.
//
// What it proves: Rohan rings Papa's phone from the Family screen and both
// of Papa's phones ring out loud, on whatever screen is open, until "I found
// it"; Papa turns Lost mode on from one phone and the OTHER one locks with his
// message, a button to call Rohan, and shares exactly where it is; a finder
// cannot stop that sharing; only Papa's PIN unlocks it; it fits a 320px phone.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('findme.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('findme.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('findme.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

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
const rohan = await person(circle, 'Rohan', 'family', 'son');
const papa = await person(circle, 'Papa', 'parent', 'father');
await admin.query('update members set phone = $1 where id = $2', [rohan.phone, rohan.id]);
// Papa's second phone: its own session, the phone he will lose.
const papa2 = { ...papa, token: newToken() };
await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(papa2.token), papa.userId]);

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
const PUNE = { latitude: 18.520430, longitude: 73.856743, accuracy: 15 };
async function phone(who, hash, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', serviceWorkers: 'block', geolocation: PUNE, permissions: ['geolocation'] });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah', JSON.stringify({ code: 'SHARMA', memberId: w.id, name: w.name, role: 'family', circleName: 'Sharma Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
    // Count the tones this phone makes.
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { const make = AC.prototype.createOscillator; window.__tones = 0; AC.prototype.createOscillator = function(){ window.__tones++; return make.apply(this, arguments); }; }
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash); await page.waitForTimeout(1500);
  return page;
}
const R = await phone(rohan, '#people');
const P = await phone(papa, '#home');
const P2 = await phone(papa2, '#care');
const tones = pg => pg.evaluate(() => window.__tones);

// ---- 1. Rohan rings Papa's phone
await R.waitForSelector('#loc-ask [data-locring]', { timeout: 8000 }).catch(() => {});
ok('Papa\'s row on the Family screen has Ring', await R.isVisible(`#loc-ask [data-locring="${papa.id}"]`));
await R.click(`#loc-ask [data-locring="${papa.id}"]`); await R.waitForTimeout(800);
ok('Rohan is told it is ringing', /Ringing Papa's phone for two minutes/.test(await R.textContent('#toast').catch(() => '')), await R.textContent('#toast').catch(() => ''));
await P.reload(); await P2.reload(); await P.waitForTimeout(1800); await P2.waitForTimeout(400);
ok('Papa\'s phone takes the screen: Rohan is looking for it', await P.isVisible('#ringscreen') && /Rohan is looking for this phone/.test(await P.textContent('#rg-title')));
ok('his other phone rings too, on whatever screen is open', await P2.isVisible('#ringscreen'));
ok('and it rings out loud', (await tones(P)) > 0 && (await tones(P2)) > 0);
ok('Rohan\'s own phone does not ring', !(await R.isVisible('#ringscreen')));
await P.click('#rg-found'); await P.waitForTimeout(600);
const t0 = await tones(P); await P.waitForTimeout(3200);
ok('"I found it" closes it and the sound stops', !(await P.isVisible('#ringscreen')) && (await tones(P)) === t0);
ok('and it is stopped for all his phones', !(await admin.query('select 1 from find_ring where member_id = $1', [papa.id])).rows.length);
await P2.reload(); await P2.waitForTimeout(1500);
ok('so the other phone stops ringing at its next look', !(await P2.isVisible('#ringscreen')));

// ---- 2. Papa turns on Lost mode from the phone in his hand
await P.evaluate(() => { location.hash = '#people'; }); await P.waitForTimeout(1200);
await P.click('#loc-lost-sum'); await P.waitForTimeout(200);
ok('the form offers a message and who to call, Rohan first', await P.isVisible('#ll-msg') && (await P.$eval('#ll-call', s => s.options[0] && s.options[0].textContent)) === 'Rohan');
await P.fill('#ll-msg', 'x'.repeat(10)); await P.fill('#ll-msg', 'This phone is lost. Please call my son Rohan.');
await P.click('#ll-on'); await P.waitForTimeout(300);
ok('it asks before turning on', await P.isVisible('#asksheet'));
await P.click('#as-yes'); await P.waitForTimeout(1200);
ok('the phone in his hand says Lost mode is on for his other phones', await P.isVisible('#loc-lostnow') && await P.isVisible('#ll-pin'));
await P.reload(); await P.waitForTimeout(1800);
ok('and never locks itself', !(await P.isVisible('#lostscreen')));

await R.reload(); await R.waitForTimeout(2000);
ok('before the lost phone is online, Rohan already sees Papa marked Lost mode', /Lost mode on · its location shows once it is online/.test(await R.textContent('#loc-ask')), await R.textContent('#loc-ask'));

// ---- 3. The lost phone
await P2.reload(); await P2.waitForTimeout(2500);
ok('the lost phone takes the whole screen', await P2.isVisible('#lostscreen'));
ok('with his message', (await P2.textContent('#ls-msg')) === 'This phone is lost. Please call my son Rohan.');
ok('and one tap calls Rohan', await P2.isVisible('#ls-call') && (await P2.getAttribute('#ls-call', 'href')) === 'tel:' + encodeURIComponent(rohan.phone) && /Call Rohan/.test(await P2.textContent('#ls-call')));
await P2.waitForTimeout(1500);
const sh = (await admin.query('select enabled, precision, lat from location_shares where member_id = $1', [papa.id])).rows[0];
ok('it shares exactly where it is with the family', sh && sh.enabled && sh.precision === 'exact' && Math.abs(sh.lat - PUNE.latitude) < 1e-4, JSON.stringify(sh));
const stop = await P2.evaluate(async () => (await fetch('/api/settings?area=location', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Parwah-Token': localStorage.getItem('parwah-token') },
  body: JSON.stringify({ action: 'stop', code: 'SHARMA', memberId: JSON.parse(localStorage.getItem('parwah')).memberId }) })).status);
ok('a finder cannot stop the sharing, even by hand', stop === 423, String(stop));
await R.reload(); await R.waitForTimeout(2000);
ok('Rohan sees Papa\'s phone on the list, marked Lost mode', /📵 Lost mode on/.test(await R.textContent('#loc-list')), await R.textContent('#loc-list'));

// ---- 4. Only Papa's PIN unlocks it
await P2.click('#ls-off'); await P2.waitForTimeout(300);
ok('an empty PIN is caught on the phone', await P2.isVisible('#ls-pin-err') && /4-digit PIN/.test(await P2.textContent('#ls-pin-err')));
await P2.fill('#ls-pin', '0000'); await P2.click('#ls-off'); await P2.waitForTimeout(900);
ok('a wrong PIN is refused, with the tries left', /not right. 4 tries left/.test(await P2.textContent('#ls-pin-err')) && await P2.isVisible('#lostscreen'));
await P2.fill('#ls-pin', '4819'); await P2.click('#ls-off'); await P2.waitForTimeout(1500);
ok('his PIN unlocks it', !(await P2.isVisible('#lostscreen')));
ok('and Lost mode is off for him everywhere', !(await admin.query('select lost_at from users where id = $1', [papa.userId])).rows[0].lost_at);

// ---- 5. On a 320px phone the lost screen fits, unlock in reach
{
  await admin.query(`update users set lost_at = now(), lost_msg = 'This phone is lost.', lost_session = null, lost_call = $1 where id = $2`, [rohan.id, papa.userId]);
  const S = await phone(papa2, '#home', { width: 320, height: 568 });
  await S.waitForTimeout(800);
  const fit = await S.evaluate(() => { const d = document.documentElement; return { over: d.scrollWidth > d.clientWidth, call: document.getElementById('ls-call').getBoundingClientRect().bottom, h: innerHeight }; });
  ok('at 320px nothing scrolls sideways and Call is on the first screen', await S.isVisible('#lostscreen') && !fit.over && fit.call <= fit.h, JSON.stringify(fit));
  await S.locator('#ls-off').scrollIntoViewIfNeeded();
  ok('and Turn off is reachable', await S.isVisible('#ls-off'));
  await admin.query(`update users set lost_at = null where id = $1`, [papa.userId]);
}

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`findme.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`findme.e2e: ${pass}/${pass} checks pass`);
