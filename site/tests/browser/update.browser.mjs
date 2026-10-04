// A PHONE NEVER KEEPS RUNNING AN OLD PARWAH.
//
// A family member sent a screenshot of a Today screen two versions old:
// the installed app, or a tab left open, keeps running the copy it first
// loaded. Parwah now asks whether a newer version is out when it comes back
// to the screen, and moves to it - at once when nothing is being typed,
// otherwise with a bar that says so. This serves version A, then B, and
// watches.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('update.browser: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const ROOT = new URL('../../public', import.meta.url).pathname;
let version = 'A', heads = 0, headDown = false, oldSw = null;
const server = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  if (p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"offline in test"}'); return; }
  if (p === '/' && req.method === 'HEAD') {
    heads++;
    if (headDown) { req.socket.destroy(); return; }   // as if offline
    res.writeHead(200, { ETag: 'W/"' + version + '"' }); res.end(); return;
  }
  if (p === '/sw.js' && oldSw) { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(oldSw); return; }
  if (p.endsWith('/')) p += 'index.html';
  try {
    const d = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', 'Cache-Control': 'no-store', ETag: 'W/"' + version + '"' });
    res.end(d);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (c, m, why) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m + (c || why === undefined ? '' : ' -> ' + why)); c ? pass++ : fail++; };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE + '/'); await page.waitForTimeout(800);
await page.evaluate(() => { window.__oldCopy = true; });

// Coming back to the screen with nothing new: nothing happens.
await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(500);
ok(await page.evaluate(() => window.__oldCopy === true), 'with no new version, coming back changes nothing');
ok(heads >= 1, 'it asked the server which version is current (' + heads + ')');

// While typing, a new version waits for the person.
version = 'B';
await page.fill('#au-phone', '98765');
await page.focus('#au-phone');
await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(600);
ok(await page.evaluate(() => window.__oldCopy === true) && await page.isVisible('#updbar'), 'mid-typing, it does not reload: it shows "A newer Parwah is ready"');
await page.click('#updbar'); await page.waitForTimeout(900);
ok(await page.evaluate(() => window.__oldCopy !== true), 'tapping the bar loads the new version');

// Otherwise it moves to the new version by itself.
await page.evaluate(() => { window.__oldCopy = true; });
await page.waitForTimeout(400);
version = 'C';
await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.dispatchEvent(new Event('focus')); });
await page.waitForTimeout(1200);
ok(await page.evaluate(() => window.__oldCopy !== true), 'coming back to the screen with a newer version out moves to it');

// Opened offline, from the saved copy: which version is running is unknown,
// so the first answer that does come moves it to the current one.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const P = await ctx.newPage(); P.on('pageerror', e => errors.push('offline: ' + e.message));
  headDown = true;
  await P.goto(BASE + '/'); await P.waitForTimeout(800);
  await P.evaluate(() => { window.__oldCopy = true; });
  headDown = false;
  await P.evaluate(() => window.dispatchEvent(new Event('focus'))); await P.waitForTimeout(1200);
  ok(await P.evaluate(() => window.__oldCopy !== true), 'started offline: once back online, it moves to the current version rather than assuming it is on it');
  await ctx.close();
}

// A phone still running a copy from before the page could update itself:
// the new service worker moves that window onto the new page.
{
  oldSw = "var CACHE='parwah-app-v40';self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.add('/')).then(()=>self.skipWaiting())));" +
          "self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));";
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const P = await ctx.newPage(); P.on('pageerror', e => errors.push('sw: ' + e.message));
  await P.goto(BASE + '/'); await P.waitForTimeout(800);
  await P.evaluate(() => navigator.serviceWorker.ready); await P.reload(); await P.waitForTimeout(800);
  ok(await P.evaluate(() => !!navigator.serviceWorker.controller), 'the old service worker is in charge of the page');
  await P.evaluate(() => { window.__oldCopy = true; });
  oldSw = null;   // the new sw.js is published
  await P.evaluate(() => { navigator.serviceWorker.getRegistration().then(r => r.update()); });
  await P.waitForFunction(() => window.__oldCopy !== true, null, { timeout: 8000 }).catch(() => {});
  ok(await P.evaluate(() => window.__oldCopy !== true), 'the new service worker moves the old window onto the new page');
  const caches = await P.evaluate(() => caches.keys());
  ok(caches.length === 1 && caches[0] === 'parwah-app-v41', 'and the old saved copy is gone (' + caches.join() + ')');
  // The next release (v42) finds a window already on a self-updating page,
  // and leaves it to update itself - it may be mid-typing.
  oldSw = (await readFile(path.join(ROOT, 'sw.js'), 'utf8')).replace("'parwah-app-v41'", "'parwah-app-v42'");
  await P.evaluate(() => { window.__newCopy = true; });
  await P.evaluate(() => { navigator.serviceWorker.getRegistration().then(r => r.update()); });
  // Activation takes a moment: ask until it is done (up to 10 seconds).
  for (let i = 0; i < 20 && await P.evaluate(() => caches.keys().then(k => k.join())) !== 'parwah-app-v42'; i++) await P.waitForTimeout(500);
  await P.waitForTimeout(800);
  ok(await P.evaluate(() => caches.keys().then(k => k.join())) === 'parwah-app-v42' && await P.evaluate(() => window.__newCopy === true),
     'the next release takes over without reloading a window that updates itself',
     await P.evaluate(() => caches.keys().then(k => k.join() + ' newCopy=' + window.__newCopy)));
  await ctx.close();
}

ok(errors.length === 0, 'no script errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
