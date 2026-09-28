// THE APP MOVED FROM /app/ TO THE ROOT. A PHONE THAT HAD IT BEFORE MUST FOLLOW.
//
// Families opened Parwah at /app/, and their browsers registered its offline
// worker for /app/. After the move three things have to happen on that phone,
// with nobody doing anything:
//
//   1. the old address, route and all, lands on the new one: /app/#day must
//      open /#day. Vercel answers /app/ with a redirect; browsers carry the
//      #route across a redirect that does not name one.
//   2. the old worker goes away. Left in place it would keep answering for
//      /app/ out of an old cache. The browser re-fetches /app/sw.js when the
//      old address is visited, and the new file there removes itself.
//   3. the new worker, at /sw.js, is the one looking after the app.
//
// This installs the REAL pre-move app and worker from git, then switches the
// server to the new layout and redirects exactly as vercel.json does.
import http from 'http';
import { readFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import path from 'path';

const ROOT = new URL('../../public', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
// The last commit with the app at /app/.
const BEFORE = '765aa9db261abea65487b6b49019c7f135d3027e';
const old = f => execFileSync('git', ['show', `${BEFORE}:site/public/app/${f}`], { cwd: REPO });
const OLD = { 'index.html': old('index.html'), 'sw.js': old('sw.js'),
              'manifest.webmanifest': old('manifest.webmanifest'), 'icon-192.png': old('icon-192.png') };
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.png':'image/png', '.svg':'image/svg+xml',
               '.webmanifest':'application/manifest+json' };

// The same redirects vercel.json sends, read from it so they cannot drift.
const vj = JSON.parse(await readFile(path.join(REPO, 'vercel.json'), 'utf8'));
function redirectFor(p) {
  for (const r of vj.redirects || []) {
    if (r.source === p) return r.destination;
    const m = r.source.match(/^\/app\/:file\((.*)\)$/);
    if (m && p.startsWith('/app/') && new RegExp('^(' + m[1] + ')$').test(p.slice(5))) return '/' + p.slice(5);
  }
  return null;
}

let moved = false;
const server = http.createServer(async (req, res) => {
  const p = req.url.split('?')[0];
  if (p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); return; }
  if (!moved && p.startsWith('/app/')) {
    const f = p.slice(5) || 'index.html';
    if (OLD[f]) { res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/html' }); res.end(OLD[f]); return; }
  }
  if (moved) {
    // Vercel carries the query string across a redirect (checked against a
    // real deployment before this shipped); the fragment is the browser's.
    const to = redirectFor(p);
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    if (to) { res.writeHead(307, { Location: to + q }); res.end(); return; }
  }
  let f = p.endsWith('/') ? p + 'index.html' : p;
  try {
    const data = await readFile(path.join(ROOT, f));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('playwright-core is not installed - see site/tests/browser/day.browser.mjs.'); server.close(); process.exit(0); }

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); c ? pass++ : fail++; };
const scopes = pg => pg.evaluate(async () =>
  (await navigator.serviceWorker.getRegistrations()).map(r => new URL(r.scope).pathname).sort());

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const pg = await ctx.newPage();

// Before the move: the family opens the app at /app/ and its worker installs.
await pg.goto(BASE + '/app/');
await pg.evaluate(() => navigator.serviceWorker.ready);
ok(JSON.stringify(await scopes(pg)) === '["/app/"]', 'before: the old app registers its worker for /app/');

// The move ships.
moved = true;

// The family taps an old link, straight to a screen. From a fresh tab: from
// /app/ itself, /app/#day would only change the # and never ask the server.
await pg.goto('about:blank');
await pg.goto(BASE + '/app/#day');
await pg.waitForTimeout(300);
const u = new URL(pg.url());
ok(u.pathname === '/' && u.hash === '#day', `/app/#day opens /#day (landed on ${u.pathname}${u.hash})`);
ok(await pg.evaluate(() => typeof window.parent !== 'undefined' && !!document.getElementById('au-why')),
   'and it is the app that opens there');

// Invite links carry their code across.
await pg.goto(BASE + '/app/?join=ABC123');
await pg.waitForTimeout(300);
ok(new URL(pg.url()).pathname === '/' && new URL(pg.url()).search === '?join=ABC123',
   'an old invite link keeps its code');

// The old worker removes itself; the root one takes over.
let s = [];
for (let i = 0; i < 40; i++) {
  s = await scopes(pg);
  if (!s.includes('/app/') && s.includes('/')) break;
  await pg.waitForTimeout(250);
}
ok(!s.includes('/app/'), 'after: the old /app/ worker is gone (' + JSON.stringify(s) + ')');
ok(s.includes('/'), 'and the new worker looks after the whole app from /sw.js');
const script = await pg.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration('/');
  return r && (r.active || r.waiting || r.installing) ? new URL((r.active || r.waiting || r.installing).scriptURL).pathname : null;
});
ok(script === '/sw.js', 'from the root worker file (' + script + ')');

// The old manifest and icon addresses follow the app too.
for (const f of ['manifest.webmanifest', 'icon-192.png']) {
  const r = await pg.request.get(BASE + '/app/' + f, { maxRedirects: 0 });
  ok(r.status() === 307 && r.headers()['location'] === '/' + f, `/app/${f} points at /${f}`);
}
// And the old worker file is served as itself, never redirected: a browser
// refuses a redirected worker, and it would never get the chance to leave.
const sw = await pg.request.get(BASE + '/app/sw.js', { maxRedirects: 0 });
ok(sw.status() === 200 && /unregister\(\)/.test(await sw.text()), '/app/sw.js is served, and removes itself');

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
