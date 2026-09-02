// Audit driver: walks the real app against the real dev server + real Postgres,
// captures a screenshot of every screen, and records console/page errors.
import { chromium } from 'playwright-core';
import fs from 'fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp/shots';
const VIEW = process.env.VIEW === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const pg = await b.newPage({ viewport: VIEW, serviceWorkers: 'block', deviceScaleFactor: 2 });
const errors = [];
pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
const failed = [];
pg.on('response', async r => {
  if (r.url().includes('/api/') && r.status() >= 400) {
    let body = ''; try { body = (await r.text()).slice(0, 300); } catch {}
    failed.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(BASE, '') + ' :: ' + body);
  }
});

let n = 0;
const shot = async (name) => {
  n++;
  const f = OUT + '/' + String(n).padStart(2, '0') + '-' + name + '.png';
  await pg.screenshot({ path: f, fullPage: true });
  console.log('shot ' + f);
};
const log = (...a) => console.log('  •', ...a);

const phone = '9' + String(Math.floor(Math.random()*900000000)+100000000);

// ---------- sign in ----------
await pg.goto(BASE + '/app/');
await pg.waitForTimeout(600);
await shot('auth');
await pg.fill('#au-phone', phone);
await pg.click('#au-go');
await pg.waitForTimeout(1200);
await shot('auth-name');
const needName = await pg.locator('#au-namewrap').isVisible().catch(() => false);
log('name field shown for new number:', needName);
if (needName) { await pg.fill('#au-name', 'Rohan Test'); await pg.click('#au-go'); await pg.waitForTimeout(1500); }
await shot('after-auth');

// tour
for (let i = 0; i < 8; i++) {
  const vis = await pg.locator('#tour-step').isVisible().catch(() => false);
  if (!vis) break;
  await shot('tour-' + i);
  const nx = pg.locator('#tr-next');
  if (await nx.isVisible().catch(() => false)) { await nx.click(); await pg.waitForTimeout(500); } else break;
}
await pg.waitForTimeout(800);
await shot('setup');

// create a circle
if (await pg.locator('#setup-step').isVisible().catch(() => false)) {
  await pg.click('[data-kind="family"]');
  await pg.waitForTimeout(600);
  await pg.fill('#c-name', 'Rohan Test');
  await pg.fill('#c-circle', 'Tandon Family');
  const rf = pg.locator('#c-role button[data-role="son"]');
  if (await rf.count()) await rf.first().click();
  await pg.click('#c-go');
  await pg.waitForTimeout(3000);
}
const raw = await pg.evaluate(() => localStorage.getItem('parwah'));
if (!raw) { console.log('NOT IN A CIRCLE'); process.exit(1); }
const st = JSON.parse(raw);
const api = async (p, body) => pg.evaluate(async ([p, b]) => {
  const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { s: r.status, j: await r.json().catch(() => null) };
}, [p, body]);
await api('../api/book', { code: st.code, memberId: st.memberId, action: 'add', kind: 'contact', category: 'doctor', name: 'Dr Sharma', phone: '+919810033333', notes: 'Cardiologist at Max, Saket', aboutId: st.memberId });
await api('../api/book', { code: st.code, memberId: st.memberId, action: 'add', kind: 'fact', category: 'blood', name: 'B positive', aboutId: st.memberId });
await api('../api/book', { code: st.code, memberId: st.memberId, action: 'add', kind: 'med', name: 'Telmisartan 40mg', forwhat: 'blood pressure, one after breakfast', aboutId: st.memberId });
await api('../api/care', { code: st.code, memberId: st.memberId, action: 'request_create', title: 'Book the annual health check' });
await api('../api/events', { code: st.code, memberId: st.memberId, type: 'pulse', value: 'clear' });
await api('../api/circle', { code: st.code, memberId: st.memberId, action: 'update_member', place: 'Bengaluru', dob: '1990-08-05' });
await pg.reload(); await pg.waitForTimeout(2500);
await shot('in-app-home');

// dismiss coachmarks
for (let i = 0; i < 8; i++) {
  const vis = await pg.locator('#coach').isVisible().catch(() => false);
  if (!vis) break;
  await shot('coach-' + i);
  const skip = pg.locator('#cm-skip');
  if (await skip.isVisible().catch(() => false)) { await skip.click(); await pg.waitForTimeout(400); } else break;
}
await pg.waitForTimeout(600);
await shot('home');

// ---------- every pane ----------
const PANES = ['home', 'people', 'memory', 'vault', 'care', 'day', 'chat', 'ekta', 'fun', 'notifs', 'profile'];
for (const p of PANES) {
  await pg.evaluate(h => { location.hash = h; }, p);
  await pg.waitForTimeout(1800);
  await shot('pane-' + p);
}

// sub-sections
for (const [tab, sec] of [['care', 'req'], ['vault', 'pay'], ['day', 'rashi'], ['fun', 'games'], ['fun', 'board']]) {
  await pg.evaluate(h => { location.hash = h; }, tab);
  await pg.waitForTimeout(700);
  const btn = pg.locator(`[data-sec="${sec}"]`).first();
  if (await btn.isVisible().catch(() => false)) { await btn.click(); await pg.waitForTimeout(1400); await shot('sec-' + tab + '-' + sec); }
}

// mobile drawer
if (VIEW.width < 900) {
  await pg.evaluate(() => { location.hash = 'home'; });
  await pg.waitForTimeout(400);
  const h = pg.locator('#hamb');
  if (await h.isVisible().catch(() => false)) { await h.click(); await pg.waitForTimeout(500); await shot('drawer'); await pg.keyboard.press('Escape'); await pg.evaluate(() => { const d = document.getElementById('drawer'); if (d) d.hidden = true; }); }
}

console.log('\n=== FAILED API CALLS (' + failed.length + ') ===');
[...new Set(failed)].forEach(f => console.log('  ' + f));
console.log('\n=== PAGE / CONSOLE ERRORS (' + errors.length + ') ===');
[...new Set(errors)].forEach(e => console.log('  ' + e));

const sess = await pg.evaluate(() => localStorage.getItem('parwah'));
console.log('\nsession:', sess);
fs.writeFileSync('/tmp/session.json', sess || '{}');
await b.close();
