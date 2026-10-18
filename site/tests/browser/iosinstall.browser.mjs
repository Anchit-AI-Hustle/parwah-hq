// THE IPHONE APP IS THE HOME-SCREEN APP.
//
// An IPA cannot be opened on an iPhone: without a paid Apple account the
// running iPhone app is Safari's Add to Home Screen. So on an iPhone the
// download page leads with Get the iPhone app, never offers the IPA, and
// warns when it is open inside Instagram or WhatsApp; the app then shows the
// two taps, once, and never inside the installed app.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('iosinstall.browser: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const ROOT = new URL('../../public', import.meta.url).pathname;
const server = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  if (p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"offline in test"}'); return; }
  if (p.endsWith('/')) p += 'index.html';
  try {
    const d = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : p.endsWith('.css') ? 'text/css' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (c, m, why) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m + (c || why === undefined ? '' : ' -> ' + why)); c ? pass++ : fail++; };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const INSTA = SAFARI.replace('Safari/604.1', 'Instagram 350.0.0.0 (iPhone16,2; iOS 19_0)');
const DESK = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const errors = [];
async function page(ua, url, { standalone = false, scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, colorScheme: scheme, serviceWorkers: 'block' });
  if (standalone) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  await ctx.route('https://**', r => r.abort());           // fonts, the GitHub API: not needed here
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + url); await p.waitForTimeout(700);
  return p;
}

// ---- the download page
{
  const p = await page(SAFARI, '/get/');
  const order = await p.$$eval('.platform', ps => ps.map(x => x.id));
  ok(order[0] === 'p-ios', 'on an iPhone the iPhone section comes first', order.join());
  ok(await p.isVisible('#ios-get') && (await p.getAttribute('#ios-get', 'href')) === '../?install=ios', 'it leads with Get the iPhone app, which opens the guided install');
  ok(!(await p.isVisible('#ipa-dev')) && !(await p.isVisible('#ipa-link')), 'an iPhone is never offered the IPA it cannot open');
  ok(!(await p.isVisible('#ios-inapp')), 'in Safari there is no "open in Safari" warning');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'nothing scrolls sideways');
}
{
  const p = await page(INSTA, '/get/');
  ok(await p.isVisible('#ios-inapp'), 'inside Instagram it says to open the page in Safari first');
}
{
  const p = await page(DESK, '/get/');
  ok(await p.isVisible('#ipa-dev') && await p.isVisible('#ipa-link'), 'on a computer the IPA stays, as a link for developers');
  ok(await p.isVisible('#apk-link'), 'and the Android download is there');
}

// ---- the app, arriving from Get the iPhone app
{
  const p = await page(SAFARI, '/?install=ios');
  ok(await p.isVisible('#ioscoach'), 'the app shows how to add it to the Home Screen');
  ok(/Share/.test(await p.textContent('#ioscoach')) && /Add to Home Screen/.test(await p.textContent('#ioscoach')), 'with the Share and Add to Home Screen steps', await p.textContent('#ioscoach'));
  ok(!/install=ios/.test(await p.evaluate(() => location.href)), 'the address it saves to the Home Screen is clean, so the guide never comes back', await p.evaluate(() => location.href));
  const box = await p.$eval('#ioscoach', el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
  ok(box.l >= 0 && box.r <= box.w && box.b <= box.h, 'it sits fully on screen', JSON.stringify(box));
  await p.click('#ioscoach-x');
  ok(!(await p.isVisible('#ioscoach')), 'Close puts it away');
}
{
  const p = await page(SAFARI, '/?install=ios', { scheme: 'dark' });
  const c = await p.$eval('#ioscoach', el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
  ok(c[0] !== c[1], 'it is readable in dark mode too', c.join(' / '));
}
{
  const p = await page(INSTA, '/?install=ios');
  ok(/Open in Safari/.test(await p.textContent('#ioscoach')), 'inside Instagram the app says to open Safari first');
}
{
  const p = await page(SAFARI, '/?install=ios', { standalone: true });
  ok(!(await p.isVisible('#ioscoach')), 'never inside the installed app');
}
{
  const p = await page(SAFARI, '/');
  ok(!(await p.isVisible('#ioscoach')), 'never unasked');
}
{
  const p = await page(DESK, '/?install=ios');
  ok(!(await p.isVisible('#ioscoach')), 'never on a computer');
}
ok(errors.length === 0, 'no script errors', errors.join(' | '));

await browser.close(); server.close();
console.log(`iosinstall.browser: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
