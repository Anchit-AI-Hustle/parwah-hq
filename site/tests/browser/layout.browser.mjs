// THE PAGE MUST NOT SCROLL SIDEWAYS ON A PHONE.
//
// Most of the people this site is for will only ever see it on a phone, on
// mobile data, in India. A page that slides left and right under the thumb
// reads as broken before a word of it is read.
//
// This found a real one on its first run: .f-links, the footer navigation,
// was a flex row with no wrap. Every page scrolled sideways by exactly the
// width the footer links overran - 136px on the home page. It had been live
// that way, and no check could see it, because horizontal overflow is
// invisible to anything that only reads the HTML.
//
// A note on what is NOT a failure: .hero .ghost, the giant प watermark,
// sticks out past the viewport by design and is clipped by overflow:hidden
// on .hero. Measuring elements would flag it; measuring the DOCUMENT does
// not, which is why this asserts on scrollWidth rather than on rectangles.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.png':'image/png', '.svg':'image/svg+xml',
               '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  try {
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

// The deploy gate runs on Vercel's builders, which have no browser. A suite
// that throws on a missing module there turns a green tree red for a reason
// that has nothing to do with the site.
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('playwright-core is not installed - see the note at the top of this file.');
  console.log('The deploy gate does not need it: run `npm test` for the checks that do gate a deploy.');
  server.close(); process.exit(process.env.CI ? 1 : 0);
}

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); c ? pass++ : fail++; };

// Every page a person can be sent to, the app included: it is used on the
// same phones. 320px is the narrowest phone still in real use in India.
const ROUTES = ['/', '/welcome/', '/story/', '/story/aisle/', '/care/', '/get/', '/launch/', '/demo/'];
const WIDTHS = [[320, 'a 320px phone'], [390, 'a 390px phone']];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const [width, label] of WIDTHS) {
  for (const route of ROUTES) {
    const pg = await browser.newPage({ viewport: { width, height: 844 } });
    await pg.goto(BASE + route, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(400);
    const over = await pg.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 0, `${route} does not scroll sideways on ${label}` + (over > 0 ? ` (${over}px)` : ''));
    await pg.close();
  }
}
// NOTHING IS LEFT INVISIBLE AFTER A PERSON SCROLLS.
//
// .rv is reveal-on-scroll: opacity:0 until an IntersectionObserver adds .in.
// The observer lives in a script each page must carry. Both new pages were
// written without it, so seventeen elements on /care/ - every product card,
// every promise, the launch CTA - were set to opacity:0 with nothing in the
// page that would ever change that. It passed the HTML gate, the claims
// scan and the overflow check above, because all a blank page is missing is
// a class that JavaScript was supposed to add.
for (const route of ['/welcome/', '/story/', '/story/aisle/', '/care/', '/launch/', '/get/']) {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await pg.goto(BASE + route, { waitUntil: 'networkidle' });
  await pg.evaluate(async () => {
    const H = document.body.scrollHeight;
    for (let y = 0; y < H; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
    window.scrollTo(0, H);
  });
  await pg.waitForTimeout(800);
  const left = await pg.evaluate(() => [...document.querySelectorAll('.rv')]
    .filter(e => getComputedStyle(e).opacity === '0')
    .map(e => (e.textContent || '').trim().slice(0, 32)));
  ok(left.length === 0,
     `${route} has nothing still invisible after scrolling` +
     (left.length ? ` (${left.length}: ${left.slice(0, 2).join(' / ')})` : ''));
  await pg.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
