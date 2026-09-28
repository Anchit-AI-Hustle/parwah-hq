// THE PHONE APPS SHOW THIS APP INSIDE A FRAME.
//
// The iPhone and Android apps are a thin Floot shell (parwah.floot.app) that
// shows the app (the root of the domain) full-screen in a frame from another origin. Three things have
// to hold for that to be the same app and not a broken copy of it:
//
//   1. the app tells the shell it has started. The shell shows its own
//      loading screen until then, and a retry screen if it never hears it -
//      a frame's load event cannot be trusted, because it also fires for a
//      blocked or failed page.
//   2. that message says nothing else. It goes to any origin, so it must
//      never carry anything about the family.
//   3. a family that signed in stays signed in when the app is reopened.
//      Inside a frame from another origin the browser keeps storage
//      separately, and if it did not persist, every opening would ask for
//      the phone number and PIN again.
//
// This runs Chromium, which is what Android's WebView is. iPhone's WebKit
// keeps frame storage by its own rules and has to be checked on a device.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.png':'image/png', '.svg':'image/svg+xml',
               '.webmanifest':'application/manifest+json' };

// The app, on one origin.
const app = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  if (p.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":false,"error":"offline in test"}');
    return;
  }
  if (p.endsWith('/')) p += 'index.html';
  try {
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => app.listen(0, '127.0.0.1', r));
const APP_ORIGIN = 'http://127.0.0.1:' + app.address().port;

// The shell, on a different origin (a different host name is a different
// origin), doing what the Floot page does: frame the app, and accept the
// ready message only from the app's origin.
const SHELL_HTML = `<!doctype html><meta charset="utf-8"><title>shell</title>
<body style="margin:0"><iframe id="f" src="${APP_ORIGIN}/" style="border:0;width:390px;height:844px"></iframe>
<script>
  window.heard = [];
  window.addEventListener('message', function (e) {
    window.heard.push({ origin: e.origin, data: e.data });
  });
</script>`;
const shell = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(SHELL_HTML);
});
await new Promise(r => shell.listen(0, 'localhost', r));
const SHELL_URL = 'http://localhost:' + shell.address().port + '/';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('playwright-core is not installed - see site/tests/browser/day.browser.mjs.');
  app.close(); shell.close(); process.exit(0);
}

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); c ? pass++ : fail++; };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

async function readyMessages() {
  await page.waitForFunction(() => window.heard.length > 0, null, { timeout: 15000 }).catch(() => {});
  return page.evaluate(() => window.heard);
}

await page.goto(SHELL_URL);
let heard = await readyMessages();
ok(heard.length === 1, `the app tells the shell once that it has started (heard ${heard.length})`);
ok(heard.every(h => h.origin === APP_ORIGIN), 'the message comes from the app itself');
ok(heard.every(h => h.data && typeof h.data === 'object'
                  && Object.keys(h.data).join() === 'parwah' && h.data.parwah === 'ready'),
   'and says nothing but that it is ready: ' + JSON.stringify(heard.map(h => h.data)));

const frame = page.frames().find(f => f.url().startsWith(APP_ORIGIN));
ok(!!frame, 'the app is running inside the frame');
const visible = frame && await frame.evaluate(() =>
  !!document.body && document.body.innerText.trim().length > 40);
ok(!!visible, 'and shows a screen rather than a blank frame');

// Sign-in survives the app being closed and opened again. The token is what
// the app keeps; write one the way saveToken does and reopen the shell.
await frame.evaluate(() => localStorage.setItem('parwah-token', 'test-token-123'));
await page.goto('about:blank');
await page.goto(SHELL_URL);
await readyMessages();
const frame2 = page.frames().find(f => f.url().startsWith(APP_ORIGIN));
const kept = frame2 && await frame2.evaluate(() => localStorage.getItem('parwah-token'));
ok(kept === 'test-token-123', 'a family that signed in is still signed in when the app is reopened');

// A page that is NOT framed must not send anything at all.
const solo = await ctx.newPage();
await solo.addInitScript(() => {
  window.sent = 0;
  const orig = window.postMessage.bind(window);
  window.postMessage = function () { window.sent++; return orig.apply(null, arguments); };
});
await solo.goto(APP_ORIGIN + '/');
await solo.waitForTimeout(800);
ok(await solo.evaluate(() => window.sent) === 0, 'opened directly in a browser, the app sends no message');

await browser.close();
app.close(); shell.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
