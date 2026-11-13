// PARWAH ON A POOR NETWORK, AND ON NONE.
//
// The page is over a megabyte. It used to be fetched in full on every open,
// and the saved copy was used only once the network had failed outright: on
// one bar of signal that was a blank screen. This runs the real service
// worker and the real page against a server that can be made slow, silent
// or unreachable, and checks:
//   - a network that answers is still asked first, and its copy is shown;
//   - one that has not answered in 3 seconds: the saved copy is shown, the
//     fresh one keeps coming, and "Updated. Tap to refresh" appears only if
//     it is different;
//   - no network at all: the app opens, the emergency card opens, the SOS
//     screen says the alert did not go and still offers Call buttons;
//   - nothing under /api/ is ever answered from a saved copy;
//   - "All is well" and "Medicines taken" pressed with no network are kept
//     on the phone, shown as waiting, and sent once with their own time when
//     the network is back, including when only the reply was lost and when
//     the network is so slow the request never finishes.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('offline.browser: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
// The network, as the test wants it.
const net = { version: 'A', rootDelay: 0, rootSent: 0, apiGets: 0, posts: [], dropReply: false, apiDelay: 0 };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = u.pathname;
  if (p.startsWith('/api/')) {
    if (req.method === 'GET') { net.apiGets++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'not in this test', n: net.apiGets })); return; }
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    if (p === '/api/events' && ['checkin', 'pill'].includes(body.type)) {
      net.posts.push(body);
      if (net.dropReply) { req.socket.destroy(); return; }             // it arrived; the reply is lost
      if (net.apiDelay) { const t = setTimeout(() => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }, net.apiDelay); req.on('close', () => clearTimeout(t)); return; }
      res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"not in this test"}'); return;
  }
  if (p === '/' && req.method === 'HEAD') { res.writeHead(200, { ETag: 'W/"' + net.version + '"' }); res.end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  try {
    let d = await readFile(path.join(ROOT, p));
    const v = net.version;
    if (p === '/index.html') d = Buffer.from(d.toString('utf8').replace('</head>', '<meta name="nt-test" content="' + v + '"></head>'));
    const send = () => { res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store', ETag: 'W/"' + v + '"' }); res.end(d); if (p === '/index.html') net.rootSent++; };
    if (p === '/index.html' && net.rootDelay) setTimeout(send, net.rootDelay); else send();
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (c, m, why) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m + (c || why === undefined ? '' : ' -> ' + why)); c ? pass++ : fail++; };
const T = { timeout: 25000 };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
// Papa, signed in on this phone, with the family this phone last saw.
const PAPA = '11111111-1111-4111-8111-111111111111', ROHAN = '22222222-2222-4222-8222-222222222222';
await ctx.addInitScript(([papa, rohan]) => {
  localStorage.setItem('parwah-user', JSON.stringify({ id: 'u1', name: 'Papa', phone: '+919811100001', toured: true }));
  localStorage.setItem('parwah-token', 'test-token');
  localStorage.setItem('parwah-fr-hide', '1');
  localStorage.setItem('parwah', JSON.stringify({ code: 'SHARMA', memberId: papa, name: 'Papa', role: 'parent', circleName: 'Sharma Family' }));
  if (!localStorage.getItem('parwah-ecard')) localStorage.setItem('parwah-ecard', JSON.stringify({ at: Date.now(), circle: 'SHARMA', entries: [],
    members: [{ id: papa, name: 'Papa', role: 'parent', phone: '+919811100001' }, { id: rohan, name: 'Rohan Sharma', role: 'son', phone: '+919811100002' }] }));
}, [PAPA, ROHAN]);
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const metaV = () => page.evaluate(() => { const m = document.querySelector('meta[name="nt-test"]'); return m ? m.content : null; });
const savedV = () => page.evaluate(() => caches.match('/', { ignoreSearch: true }).then(r => r ? r.text() : '').then(t => (t.match(/name="nt-test" content="(\w+)"/) || [])[1] || null));
const until = (fn, arg) => page.waitForFunction(fn, arg, T).then(() => true, () => false);
const untilNet = async (cond) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > T.timeout) return false; await new Promise(r => setImmediate(r)); await page.evaluate(() => new Promise(r => requestAnimationFrame(r))).catch(() => {}); } return true; };

// ---- the worker takes charge and keeps a copy
await page.goto(BASE + '/');
await until(() => navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller));
ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the service worker is in charge of the page');
ok(await until(() => caches.match('/', { ignoreSearch: true }).then(r => !!r)), 'and a copy of the app is saved on the phone');

// ---- a network that answers is asked first
net.version = 'B';
await page.goto(BASE + '/');
ok(await metaV() === 'B', 'with a network that answers, the page comes from Parwah, not from the saved copy', await metaV());
ok(await until(() => caches.match('/', { ignoreSearch: true }).then(r => r.text()).then(t => t.includes('name="nt-test" content="B"'))), 'and the saved copy is brought up to date');

// ---- a slow network: the saved copy after 3 seconds
net.rootDelay = 8000;
let sent0 = net.rootSent, t0 = Date.now();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
let took = Date.now() - t0;
ok(await metaV() === 'B' && net.rootSent === sent0, 'on a slow network the saved copy is shown before the network has answered', 'sent=' + (net.rootSent - sent0));
ok(took >= 2800 && took < 7000, 'after waiting about three seconds for the network, not before and not for the whole wait (' + took + ' ms)');
ok(await untilNet(() => net.rootSent > sent0), 'the fresh copy keeps coming in the background');
await page.evaluate(() => fetch('/manifest.webmanifest').then(r => r.text()));   // one round trip through the worker
ok(await page.evaluate(() => document.getElementById('updbar').hidden), 'and when it is the same as the saved one, nothing is said');

// ---- a slow network and a new version: "Updated. Tap to refresh"
net.version = 'C';
sent0 = net.rootSent;
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
ok(await metaV() === 'B', 'a new version is out and the network is slow: the saved copy is shown meanwhile');
ok(await until(() => { const b = document.getElementById('updbar'); return !b.hidden && b.textContent === 'Updated. Tap to refresh'; }), 'when the new version has arrived, the page says "Updated. Tap to refresh"');
ok(await savedV() === 'C', 'the saved copy is now the new one', await savedV());
net.rootDelay = 0;
await page.click('#updbar');
ok(await until(() => { const m = document.querySelector('meta[name="nt-test"]'); return !!m && m.content === 'C'; }), 'tapping it shows the new version');

// ---- nothing under /api/ is ever saved or served from a saved copy
const a1 = await page.evaluate(() => fetch('/api/diag').then(r => r.json()).then(j => j.n));
const a2 = await page.evaluate(() => fetch('/api/diag').then(r => r.json()).then(j => j.n));
ok(a2 === a1 + 1, 'two reads of the same API address are two trips to the server', a1 + ',' + a2);
ok(await page.evaluate(() => caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys())))).then(all => all.flat().every(r => !new URL(r.url).pathname.startsWith('/api/')))),
   'and no API answer is kept in the saved copy');

// ---- no network at all
await ctx.setOffline(true);
await page.goto(BASE + '/#home', { waitUntil: 'domcontentloaded' });
ok(await metaV() === 'C' && await until(() => !document.getElementById('main').hidden), 'with no network, Parwah still opens from the saved copy');
ok(await page.evaluate(() => fetch('/api/diag').then(() => 'answered', () => 'failed')) === 'failed', 'an API read with no network fails honestly: it is not answered from a saved copy');
ok(await until(() => !document.getElementById('home-offline').hidden), 'and the screen says it could not reach Parwah');
await page.click('#btn-ecard');
ok(await until(() => { const e = document.getElementById('ecard'); return !e.hidden && /Papa/.test(e.textContent); }), 'the emergency card opens with no network, from what this phone last saw');
await page.click('#ec-x');
await page.click('#btn-sos');
await page.click('#ss-now');
ok(await until(() => !document.getElementById('ss-live').hidden && document.querySelectorAll('#ss-calls a[href^="tel:"]').length >= 2
   && [...document.querySelectorAll('#ss-calls a')].some(a => /Rohan/.test(a.textContent) && decodeURIComponent(a.getAttribute('href')) === 'tel:+919811100002')),
   'the SOS screen opens with no network and offers Call buttons at once: the emergency number and the family');
ok(await until(() => /No connection - the SOS could not be sent\. Call /.test(document.getElementById('ss-status').textContent)), 'it says plainly that the alert did not go, and to call');
ok(await page.evaluate(() => /^sms:\+919811100002\?body=/.test(document.getElementById('ss-sms').getAttribute('href') || '') && /^https:\/\/wa\.me\//.test(document.getElementById('ss-wa').getAttribute('href') || '')),
   'and the text-message and WhatsApp buttons are ready with the family numbers');
ok(await page.evaluate(() => !JSON.parse(localStorage.getItem('parwah-queue') || '[]').some(x => x.type === 'sos')), 'an SOS is never put in the waiting list');
await page.click('#ss-hide');

// ---- a tap with no network is kept, shown, and sent later with its own time
const before = net.posts.length;
await page.click('#btn-checkin');
ok(await until(() => !document.getElementById('nt-queue').hidden && /Will send when the network is back/.test(document.getElementById('nt-queue').textContent)
   && /All is well, /.test(document.getElementById('nt-queue-list').textContent)), '"All is well" with no network: "Will send when the network is back"');
ok(await page.evaluate(() => /Saved on this phone/.test(document.getElementById('btn-checkin').textContent) && !/reached the whole family/.test(document.getElementById('btn-checkin').textContent)),
   'the button says it is saved on this phone, and does not claim it reached the family');
const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('parwah-queue'))[0]);
ok(queued && queued.type === 'checkin' && /^q_[\w-]{8,}$/.test(queued.id) && Math.abs(Date.now() - new Date(queued.at).getTime()) < 30000 && net.posts.length === before,
   'it is kept on the phone with the time it was pressed, and nothing has reached the server', JSON.stringify(queued));
await page.goto(BASE + '/#home', { waitUntil: 'domcontentloaded' });
ok(await until(() => !document.getElementById('nt-queue').hidden), 'closing and opening Parwah, still with no network, keeps it waiting');
await ctx.setOffline(false);
ok(await untilNet(() => net.posts.length === before + 1), 'when the network is back it is sent by itself');
const got = net.posts[before] || {};
ok(got.type === 'checkin' && got.clientId === queued.id && got.at === queued.at && got.code === 'SHARMA', 'with its own id and the time it was pressed', JSON.stringify(got));
ok(await until(() => document.getElementById('nt-queue').hidden), 'and it is no longer shown as waiting');
ok(net.posts.length === before + 1, 'it is sent once');

// ---- the reply was lost: the same tap, the same id
net.dropReply = true;
let n0 = net.posts.length;
await page.click('#btn-pill');
ok(await until(() => !document.getElementById('nt-queue').hidden && /Medicines taken, /.test(document.getElementById('nt-queue-list').textContent)), 'the server got "Medicines taken" but the reply was lost: it waits');
ok(await page.evaluate(() => /Medicines taken ✔ · /.test(document.getElementById('btn-pill').textContent)), 'the button shows it as taken, with the time');
net.dropReply = false;
await page.click('#nt-queue-try');
ok(await until(() => document.getElementById('nt-queue').hidden), '"Try now" sends it');
const two = net.posts.slice(n0);
// (The browser may itself retry a request whose connection was cut, so there can be more than two.)
ok(two.length >= 2 && !!two[0].clientId && two.every(x => x.clientId === two[0].clientId) && !two[0].at && !!two[two.length - 1].at,
   'every send of it carries the same id, so the server counts one tap, and the last one says when it was pressed', JSON.stringify(two));

// ---- a network so slow the request never finishes
net.apiDelay = 60000;
n0 = net.posts.length;
t0 = Date.now();
await page.click('#btn-checkin');
ok(await until(() => !document.getElementById('nt-queue').hidden), 'on a network too slow to finish, the tap is given up on and kept instead of hanging');
took = Date.now() - t0;
ok(took >= 9000 && took < 20000, 'after ten seconds, not a minute (' + took + ' ms)');
net.apiDelay = 0;
await page.click('#nt-queue-try');
ok(await until(() => document.getElementById('nt-queue').hidden) && net.posts.slice(n0).length === 2 && net.posts[n0].clientId === net.posts[n0 + 1].clientId, 'and sent, once counted, when the network is usable again');

const real = errors.filter(e => !/Failed to fetch|NetworkError|Load failed|aborted/i.test(e));
ok(real.length === 0, 'no script errors along the way', real.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
