// ANALYTICS, IN A REAL BROWSER. The structural suite can read the markup;
// only a browser can prove the promise this file makes: that nothing reaches
// Google before a person says yes, and that the app is never instrumented.
//
// NOT part of the deploy gate - Vercel's builders have no browser.
//     npm run test:browser
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  try {
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
// Port 0: these suites run side by side, and EADDRINUSE teaches people to
// ignore a red run.
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('playwright-core is not installed - see the note at the top of this file.');
  console.log('The deploy gate does not need it: run `npm test` for the checks that do gate a deploy.');
  server.close(); process.exit(process.env.CI ? 1 : 0);
}
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log('FAIL  ' + n)); if (c) console.log('PASS  ' + n); };

const MARKETING = ['/welcome/', '/story/', '/story/aisle/', '/care/', '/get/', '/launch/', '/demo/'];

// Serve the file with an ID pasted in, exactly as the operator will do.
async function open(url, { withId = false, dnt = false, storage = null } = {}) {
  const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const google = [];
  pg.on('request', r => { if (/googletagmanager|google-analytics|analytics\.google/.test(r.url())) google.push(r.url()); });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  if (withId) {
    await pg.route('**/analytics.js', async route => {
      const res = await route.fetch();
      const body = (await res.text()).replace("var GA4 = '';", "var GA4 = 'G-TEST12345';");
      await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/javascript' } });
    });
  }
  if (dnt) await pg.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' }));
  if (storage) await pg.addInitScript(v => { try { localStorage.setItem('parwah-consent', v); } catch (e) {} }, storage);
  await pg.goto(BASE + url);
  await pg.waitForTimeout(600);
  return { pg, google, errs };
}

// ---- 1. shipped with no ID: inert, and no bar for a choice that is not real
for (const url of MARKETING) {
  const { pg, google, errs } = await open(url);
  ok(google.length === 0, `no ID: ${url} sends nothing to Google`);
  ok(await pg.locator('.pw-consent').count() === 0, `no ID: ${url} shows no consent bar`);
  ok(errs.length === 0, `no ID: ${url} has no page errors` + (errs.length ? ': ' + errs[0] : ''));
  await pg.close();
}

// ---- 2. THE APP IS NEVER INSTRUMENTED. This is the promise on the site's
// own home page: reassurance, never surveillance.
{
  const { pg, google } = await open('/', { withId: true });
  await pg.waitForTimeout(800);
  ok(google.length === 0, 'the app sends nothing to Google, even with an ID configured');
  const has = await pg.evaluate(() => !!document.querySelector('script[src*="analytics.js"]'));
  ok(!has, 'and does not load the analytics file at all');
  await pg.close();
}

// ---- 3. with an ID: the choice comes first
{
  const { pg, google } = await open('/welcome/', { withId: true });
  ok(await pg.locator('.pw-consent').isVisible(), 'with an ID, the choice is offered');
  ok(google.length === 0, 'and still nothing is fetched before the answer');
  const b = await pg.locator('.pw-yes').boundingBox();
  ok(b && b.height >= 44, `the buttons are thumb-sized (${Math.round(b ? b.height : 0)}px)`);
  const txt = await pg.locator('.pw-consent p').textContent();
  ok(/nothing from inside the app/i.test(txt), 'and it says the app is exempt, which is the actual promise');
  await pg.close();
}

// ---- 4. No thanks means no thanks, and it sticks
{
  const { pg, google } = await open('/welcome/', { withId: true });
  await pg.click('.pw-no'); await pg.waitForTimeout(600);
  ok(google.length === 0, 'No thanks sends nothing');
  ok(await pg.locator('.pw-consent').count() === 0, 'and the bar goes away');
  await pg.reload(); await pg.waitForTimeout(800);
  ok(await pg.locator('.pw-consent').count() === 0, 'and it is not asked again');
  ok(google.length === 0, 'and still nothing is sent');
  await pg.close();
}

// ---- 5. Allow loads the tag, once, and is remembered
{
  const { pg, google } = await open('/welcome/', { withId: true });
  await pg.click('.pw-yes'); await pg.waitForTimeout(1500);
  ok(google.length > 0, `Allow loads the tag (${google.length} request)`);
  ok(await pg.locator('.pw-consent').count() === 0, 'and the bar goes away');
  await pg.close();
  const second = await open('/welcome/', { withId: true, storage: 'yes' });
  await second.pg.waitForTimeout(1200);
  ok(second.google.length > 0, 'a returning visitor who said yes is not asked again');
  ok(await second.pg.locator('.pw-consent').count() === 0, 'and sees no bar');
  await second.pg.close();
}

// ---- 6. Do Not Track is already an answer
{
  const { pg, google } = await open('/welcome/', { withId: true, dnt: true });
  await pg.waitForTimeout(700);
  ok(google.length === 0, 'Do Not Track is honoured without asking');
  ok(await pg.locator('.pw-consent').count() === 0, 'and no bar is shown');
  await pg.close();
}

// ---- 7. the conversion this site exists to cause
// The launch list lives on /launch/; /welcome/ sends people there.
{
  const { pg } = await open('/launch/', { withId: true, storage: 'yes' });
  await pg.waitForTimeout(900);
  const sent = [];
  await pg.exposeFunction('__ev', (n, p) => sent.push([n, p]));
  await pg.evaluate(() => {
    const real = window.gtag;
    window.gtag = function (kind, name, params) { if (kind === 'event') window.__ev(name, params); return real && real.apply(this, arguments); };
  });
  // The WhatsApp button is the launch list on this site.
  await pg.evaluate(() => {
    const a = document.querySelector('a[href^="https://wa.me/"]');
    a.setAttribute('target', '_blank');   // do not navigate away mid-test
    a.click();
  });
  await pg.waitForTimeout(400);
  ok(sent.some(e => e[0] === 'join_waitlist' && e[1] && e[1].method === 'whatsapp'),
     'a WhatsApp click is counted as joining the launch list');
  await pg.evaluate(() => { const a = document.querySelector('a[href="../"]'); if (a) { a.setAttribute('target','_blank'); a.click(); } });
  await pg.waitForTimeout(300);
  ok(sent.some(e => e[0] === 'open_app'), 'opening the app is counted');
  await pg.close();
}

// ---- 7b. the walk-through is a demo open, not an app open
{
  const { pg } = await open('/welcome/', { withId: true, storage: 'yes' });
  await pg.waitForTimeout(900);
  const sent = [];
  await pg.exposeFunction('__ev', (n, p) => sent.push([n, p]));
  await pg.evaluate(() => {
    const real = window.gtag;
    window.gtag = function (kind, name, params) { if (kind === 'event') window.__ev(name, params); return real && real.apply(this, arguments); };
  });
  await pg.evaluate(() => { const a = document.querySelector('a[href="../?demo=1"]'); a.setAttribute('target', '_blank'); a.click(); });
  await pg.waitForTimeout(400);
  ok(sent.some(e => e[0] === 'open_demo') && !sent.some(e => e[0] === 'open_app'),
     '"See it first" (../?demo=1) is counted as opening the walk-through, not the app');
  await pg.close();
}
// ---- 7c. an old /demo/ link: counted (after a yes), then on to the walk-through
{
  const { pg, google } = await open('/demo/', { withId: true, storage: 'yes' });
  await pg.waitForTimeout(2200);
  ok(google.some(u => /gtag\/js/.test(u)), 'an old /demo/ link, after a yes, is counted before it moves on');
  ok(/\/\?demo=1$/.test(pg.url()), 'and then lands on the walk-through');
  await pg.close();
  const n = await open('/demo/');
  ok(/\/\?demo=1$/.test(n.pg.url()), 'with no yes, /demo/ moves on at once');
  await n.pg.close();
}

// ---- 8. an event raised before consent is held, not lost
{
  const { pg, google } = await open('/launch/', { withId: true });
  await pg.evaluate(() => window.parwahTrack('join_waitlist', { method: 'email' }));
  ok(google.length === 0, 'an event before consent sends nothing');
  await pg.click('.pw-yes'); await pg.waitForTimeout(1500);
  ok(google.length > 0, 'and after Allow the tag loads, so the click is not lost');
  await pg.close();
}

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
