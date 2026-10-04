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
let version = 'A', heads = 0;
const server = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  if (p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"offline in test"}'); return; }
  if (p === '/' && req.method === 'HEAD') { heads++; res.writeHead(200, { ETag: 'W/"' + version + '"' }); res.end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  try {
    const d = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream', ETag: 'W/"' + version + '"' });
    res.end(d);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); c ? pass++ : fail++; };
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

ok(errors.length === 0, 'no script errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
