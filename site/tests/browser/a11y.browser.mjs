// The keyboard, and the screen reader, on the real app.
//
// Everything here was true before it was written: rows you could focus but not
// press, and sheets that covered the page while Tab walked out behind them.
// Measured by driving the keyboard, not by looking for attributes in the HTML.
//
// NOT part of the deploy gate — Vercel's builders have no browser.
//
//     npm i --no-save playwright-core && npx playwright install chromium
//     npm run test:browser
import http from 'http'; import { readFile } from 'fs/promises'; import path from 'path';
const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer(async (rq, rs) => {
  let p = rq.url.split('?')[0]; if (p.endsWith('/')) p += 'index.html';
  try {
    const d = await readFile(path.join(ROOT, p));
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
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

const ME = '11111111-1111-1111-1111-111111111111', now = new Date().toISOString();
const members = [{ id: ME, name: 'Rohan', role: 'family', relation: 'son', place: 'Delhi', country: 'IN', dob: '1990-08-05', gift_info: {}, created_at: now }];
const events = { ok: true, circleName: 'Tandon Family', code: 'ABCDEF', seenAt: now, joinRequests: [], joinPolicy: 'approve', sos: [], calls: [], members,
  pulse: { day: '2026-09-02', style: 'weather', styleName: 'Weather', ask: 'How are you today?', options: [{ k: 'sunny', e: '☀️', t: 'Sunny' }], answers: [] },
  events: [{ id: 'e1', type: 'checkin', member_name: 'Rohan', created_at: now }] };
const book = { ok: true, staleDays: 180, records: [], access: [], consent: [], family: { pct: 40, ready: 2, total: 5, gapCount: 7, gaps: [
    { memberId: ME, name: 'Rohan', key: 'blood', label: 'blood group', state: 'missing' },
    { memberId: ME, name: 'Rohan', key: 'doctor', label: 'doctor recorded', state: 'missing' },
    { memberId: ME, name: 'Rohan', key: 'meds', label: 'medicine list', state: 'missing' },
    { memberId: ME, name: 'Rohan', key: 'local', label: 'someone near them to call', state: 'missing' }] },
  prep: [{ memberId: ME, name: 'Rohan', relation: 'son', pct: 28, attention: 5,
           items: { doctor: 'missing', meds: 'ok', allergies: 'verify', blood: 'missing', emergency: 'missing', insurance: 'missing', local: 'missing' } }],
  entries: [{ id: 'b1', kind: 'contact', name: 'Dr Sharma', category: 'doctor', phone: '+91 98100 33333', address: null, forwhat: null,
              notes: 'cardiologist', by_name: 'Rohan', about_member: null, about_name: null, visibility: 'circle', last_verified_at: now, created_at: now }] };

const pg = await b.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.route('**/api/**', r => r.fulfill({ json: { ok: false, error: 'stub' } }));
await pg.route('**/api/events*', r => r.fulfill({ json: events }));
await pg.route('**/api/book*area=vault*', r => r.fulfill({ json: { ok: true, maxFile: 1, kinds: {}, idShapes: {}, docs: [], grants: [], log: [], members } }));
await pg.route('**/api/book*', r => r.fulfill({ json: book }));
await pg.route('**/api/care*', r => r.fulfill({ json: { ok: true, reminders: [], requests: [], suggestions: [] } }));
await pg.addInitScript(() => {
  localStorage.setItem('parwah', JSON.stringify({ code: 'ABCDEF', memberId: '11111111-1111-1111-1111-111111111111', name: 'Rohan', role: 'family', circleName: 'Tandon Family' }));
  localStorage.setItem('parwah-fr-hide', '1');
});
await pg.goto(BASE + '/app/#memory');
await pg.waitForTimeout(900);

// ---- a row you can reach with the keyboard is a row you can press ----
const row = pg.locator('#blist .ev[role="button"]').first();
ok(await row.count() > 0, 'the memory list renders rows that behave like buttons');
ok(await row.getAttribute('tabindex') === '0', 'and they can be reached with the keyboard');
await row.focus();
await pg.keyboard.press('Enter');
await pg.waitForTimeout(350);
ok(!(await pg.locator('#book-detail').isHidden()), 'Enter on a focused row opens it');
await pg.locator('#bd-back').click();
await pg.waitForTimeout(250);
await row.focus();
await pg.keyboard.press('Space');
await pg.waitForTimeout(350);
ok(!(await pg.locator('#book-detail').isHidden()), 'Space does the same');
await pg.locator('#bd-back').click();
await pg.waitForTimeout(200);

// ---- an open sheet holds focus, and gives it back ----
await pg.goto(BASE + '/app/#people');
await pg.waitForTimeout(900);
const ecard = pg.locator('[data-ecard]').first();
ok(await ecard.count() > 0, 'the emergency card can be opened from People');
await ecard.focus();
await pg.keyboard.press('Enter');
await pg.waitForTimeout(400);
ok(await pg.locator('#ecard').isVisible(), 'the emergency card opens');
ok(await pg.getAttribute('#ecard', 'aria-modal') === 'true', 'and announces itself as a dialog');
const inside = async () => pg.evaluate(() => !!(document.activeElement && document.activeElement.closest('#ecard')));
ok(await inside(), 'focus moves into it');
for (let i = 0; i < 25; i++) await pg.keyboard.press('Tab');
ok(await inside(), 'and 25 tabs later focus is still inside it, not on the page behind');
await pg.keyboard.press('Escape');
await pg.waitForTimeout(300);
ok(!(await pg.locator('#ecard').isVisible()), 'Escape closes it');
ok(await pg.evaluate(() => document.activeElement === document.querySelector('[data-ecard]')),
   'and focus goes back to what opened it');

// ---- the tab bar and the section tabs say where you are ----
await pg.goto(BASE + '/app/#care');
await pg.waitForTimeout(800);
ok(await pg.getAttribute('#tabs button[data-tab="care"]', 'aria-current') === 'page',
   'the current app section is announced, not only coloured');
ok(await pg.getAttribute('#tabs button[data-tab="home"]', 'aria-current') === null,
   'and only the current one');
const segBtn = pg.locator('#care-seg button').first();
ok(await segBtn.getAttribute('role') === 'tab', 'a tablist contains tabs');
ok(await segBtn.getAttribute('aria-selected') === 'true', 'and says which is selected');
ok(!!(await segBtn.getAttribute('aria-controls')), 'and which panel it controls');
await segBtn.focus();
await pg.keyboard.press('ArrowRight');
await pg.waitForTimeout(300);
ok(await pg.getAttribute('#care-seg button[data-sec="req"]', 'aria-selected') === 'true',
   'arrow keys move between sections, as a tablist promises');

// ---- the readiness card counts what it shows ----
await pg.goto(BASE + '/app/#home');
await pg.waitForTimeout(900);
const gaps = await pg.locator('#rd-gaps .rdgap').count();
const cta = (await pg.locator('#rd-cta').textContent()).trim();
ok(gaps > 0 && cta.includes(String(gaps)), `the readiness call to action names the ${gaps} rows it shows ("${cta}")`);
ok(/and 3 more/.test(cta), 'and says how many are behind them, rather than a different number');

// ---- nothing on People renders the word "undefined" ----
await pg.goto(BASE + '/app/#people');
await pg.waitForTimeout(900);
const preptext = await pg.locator('#preplist').innerText();
ok(!/undefined/i.test(preptext), 'no readiness item renders as "undefined"');
ok(/Someone near them/.test(preptext), 'and the one that used to is named properly');

// ---- the memory filters keep their words on a phone ----
await pg.close();
const ph = await b.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
ph.on('pageerror', e => errors.push('mobile: ' + e.message));
await ph.route('**/api/**', r => r.fulfill({ json: { ok: false, error: 'stub' } }));
await ph.route('**/api/events*', r => r.fulfill({ json: events }));
await ph.route('**/api/book*', r => r.fulfill({ json: book }));
await ph.addInitScript(() => {
  localStorage.setItem('parwah', JSON.stringify({ code: 'ABCDEF', memberId: '11111111-1111-1111-1111-111111111111', name: 'Rohan', role: 'family', circleName: 'Tandon Family' }));
  localStorage.setItem('parwah-fr-hide', '1');
});
await ph.goto(BASE + '/app/#memory');
await ph.waitForTimeout(800);
const words = await ph.locator('#bk-filter .bkw').evaluateAll(els => els.map(e => ({ t: e.textContent.trim(), shown: e.offsetParent !== null })));
ok(words.length >= 5, 'every memory filter carries a word in the markup');
ok(words.every(w => w.shown), 'and on a 390px phone every one of those words is actually painted');
// The row must still fit rather than pushing the page sideways.
const overflow = await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
ok(overflow, 'and the filter row does not push the page sideways');
await ph.close();

ok(errors.length === 0, 'no page errors' + (errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close(); srv.close(); process.exit(fail ? 1 : 0);
