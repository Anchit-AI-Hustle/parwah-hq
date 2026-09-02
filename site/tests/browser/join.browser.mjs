// The launch list, end to end in a browser: the form validates, posts, and
// says what happened — and the measurement layer stays silent until it is
// configured.
//
// NOT part of the deploy gate — Vercel's builders have no browser. Run it
// locally when the funnel changes:
//
//     npm i --no-save playwright-core && npx playwright install chromium
//     npm run test:browser
import http from 'http'; import { readFile } from 'fs/promises'; import path from 'path';
const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };
const posted = [];
const srv = http.createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  if (u.pathname === '/api/settings' && u.searchParams.get('area') === 'join') {
    if (rq.method === 'POST') {
      let body = ''; for await (const c of rq) body += c;
      const j = JSON.parse(body || '{}');
      posted.push(j);
      rs.writeHead(j.email === 'taken@example.com' ? 200 : 201, { 'Content-Type': 'application/json' });
      return rs.end(JSON.stringify(j.email === 'taken@example.com' ? { ok: true, already: true } : { ok: true }));
    }
    rs.writeHead(200, { 'Content-Type': 'application/json' });
    return rs.end(JSON.stringify({ ok: true, waiting: 12 }));
  }
  let p = u.pathname; if (p.endsWith('/')) p += 'index.html';
  try {
    const d = await readFile(path.join(ROOT, p));
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    rs.end(d);
  } catch { rs.writeHead(404); rs.end('nf'); }
});
await new Promise(r => srv.listen(0, r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('playwright-core is not installed - see the note at the top of this file.');
  process.exit(0);
}
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log('FAIL  ' + n)); if (c) console.log('PASS  ' + n); };

for (const page of ['/', '/launch/']) {
  const third = [];
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  pg.on('request', r => {
    const h = new URL(r.url()).hostname;
    if (h !== '127.0.0.1' && !h.endsWith('fonts.googleapis.com') && !h.endsWith('fonts.gstatic.com')) third.push(h);
  });
  await pg.addInitScript(() => { window.PARWAH_TRACK_DEBUG = true; });
  await pg.goto(BASE + page);
  await pg.waitForTimeout(400);

  // Nothing is measured until somebody puts the IDs in config.js. This is the
  // state it ships in, and the state a privacy promise depends on.
  ok(third.length === 0, page + ': unconfigured, no third-party request is made' + (third.length ? ' — ' + [...new Set(third)].join(', ') : ''));

  ok(await pg.locator('#joinform').isVisible(), page + ': the launch-list form is on the page');
  // A form that throws the address away is worse than no form: prove it posts.
  await pg.click('#jf-go');
  ok((await pg.locator('#jf-say').textContent()).includes('name'), page + ': submitting empty asks for a name first');
  await pg.fill('#jf-name', 'Rohan Sharma');
  await pg.click('#jf-go');
  ok((await pg.locator('#jf-say').textContent()).includes('email'), page + ': then for an email address');
  await pg.fill('#jf-email', 'not-an-email');
  await pg.click('#jf-go');
  ok((await pg.locator('#jf-say').textContent()).includes('does not look like'), page + ': a typo is caught before the round trip');
  await pg.fill('#jf-email', 'rohan@example.com');
  await pg.click('#jf-go');
  ok((await pg.locator('#jf-say').textContent()).includes('tick the box'), page + ': consent is a real yes, never a default');
  await pg.check('#jf-consent');
  const before = posted.length;
  await pg.click('#jf-go');
  await pg.waitForTimeout(500);
  ok(posted.length === before + 1, page + ': it reaches the backend');
  const sent = posted[posted.length - 1];
  ok(sent && sent.email === 'rohan@example.com' && sent.consent === true && !!sent.source,
     page + ': and sends the name, the address, the consent and where from');
  ok((await pg.locator('#joinform').textContent()).includes('on the list'),
     page + ': the form is replaced by the answer, so nobody submits twice');
  const tracked = await pg.evaluate(() => (window.PARWAH_TRACKED || []).map(t => t[0]));
  ok(tracked.includes('join_waitlist'), page + ': the conversion is reported as join_waitlist');
  ok(errors.length === 0, page + ': no page errors' + (errors.length ? ' — ' + errors[0] : ''));
  await pg.close();
}

// The card a shared link arrives as, since WhatsApp is how this gets passed on.
const pg = await b.newPage();
for (const [page, img] of [['/', 'og/home.png'], ['/launch/', 'og/launch.png'], ['/story/', 'og/story.png']]) {
  await pg.goto(BASE + page);
  const url = await pg.getAttribute('meta[property="og:image"]', 'content');
  ok(!!url && url.endsWith(img), page + ': names its social card (' + img + ')');
  const r = await fetch(BASE + '/' + img);
  ok(r.ok, page + ': and that card is actually there');
  ok(!!(await pg.getAttribute('link[rel="canonical"]', 'href')), page + ': has a canonical url');
}
await pg.close();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close(); srv.close(); process.exit(fail ? 1 : 0);
