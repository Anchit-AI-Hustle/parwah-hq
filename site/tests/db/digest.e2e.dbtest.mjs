// "AAJ KYA HUA", END TO END: real browsers, the real API handlers and a real
// PostgreSQL, with no AI key and the network to any model blocked.
//
//   - A family has a day: Papa checks in, Rohan plans Sunday lunch for
//     tomorrow, Priya recommends a show to Rohan.
//   - After 6pm (the phone's own clock) Rohan's Today shows "Aaj kya hua".
//     Before 6pm it does not; the button on Ekta's screen works at any hour
//     and says it is the day so far.
//   - The sheet opens with the note and when it was written. Thumbs up is
//     stored. "Tell me each evening" is off until ticked.
//   - Papa, in senior mode, reads the same note, larger, with one big
//     "Sunao" (read aloud) button and the two thumbs, and no setting.
//   - Loading, a quiet day, an error and offline each say what is happening.
//   - With a (fake) model the sheet says how the note was made.
//
// The time of day is never the real hour: each phone is given a time zone
// where it is 7pm, or 10am, at the moment the test runs. Nothing is checked
// after a fixed wait: each step waits for the thing it is about to read.
// Every screen is measured: 44px targets, a 12px floor, WCAG AA in light and
// dark, nothing sideways at 320 and 390.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('digest.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('digest.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
for (const k of Object.keys(process.env)) if (/^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|XAI|GROK|KIMI|MOONSHOT|OLLAMA|TWILIO|CRON_SECRET)/.test(k)) delete process.env[k];

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('digest.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games', 'ekta']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const D = await import('../../../api/_digest.mjs');
const R = await import('../../../api/_digestrules.mjs');
await ensureSchema(db());
// Nothing in this test may reach a model: the seam records, and fetch from
// the server side to anywhere is refused.
const modelCalls = [];
D.digestSeams.callModel = async (p) => { modelCalls.push(p); return { text: 'Aaj Papa checked in, and kal Sunday lunch hai.', model: 'fake-model' }; };
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('offline in this test'); };

let n = 0;
async function person(circleId, code, circleName, name, role = 'family') {
  const phone = '+9198722' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id, place, country, created_at) values ($1,$2,$3,$4,'Delhi','IN', now() - interval '40 days') returning id`, [circleId, name, role, u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { memberId: m.id, id: m.id, userId: u.id, name, token, phone, code, circleName, role };
}
// A real handler, called as that person's phone would call it.
async function api(name, who, body, tz) {
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await HANDLERS[name]({ method: 'POST', headers: { 'x-parwah-token': who.token, 'x-forwarded-for': '10.4.4.4', 'x-parwah-tz': tz || EVE.zone },
    body: { code: who.code, memberId: who.id, ...body }, query: { area: body.area || '' } }, res);
  return { ...json, status };
}

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const h = HANDLERS[u.pathname.slice(5).replace(/\/$/, '')];
    res.setHeader('Content-Type', 'application/json');
    if (!h) { res.end('{"ok":false,"error":"not in this test"}'); return; }
    let raw = ''; for await (const c of req) raw += c;
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.2.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
    const w = { status(s) { res.statusCode = s; return this; }, json(j) { res.end(JSON.stringify(j)); return this; }, setHeader(k, v) { res.setHeader(k, v); return this; } };
    try { await h(r, w); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })); }
    return;
  }
  let p = u.pathname; if (p.endsWith('/')) p += 'index.html';
  try { const d = await readFile(path.join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };
const errors = [];
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
// Two frames have been painted since the last change.
const settle = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
const SHOTS = process.env.DIGEST_SHOT_DIR;
async function shotAll(page, name) {
  if (!SHOTS) return;
  const was = page.viewportSize();
  for (const w of [390, 1440]) for (const sc of ['light', 'dark']) {
    await page.setViewportSize({ width: w, height: 900 }); await page.emulateMedia({ colorScheme: sc });
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/${name}-${w}-${sc}.png` });
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
}
// A zone where it is this hour right now (Etc/GMT-5 is five hours ahead of UTC).
function zoneAt(hour) {
  for (let off = -12; off <= 14; off++) {
    const z = 'Etc/GMT' + (off <= 0 ? '+' + (-off) : '-' + off);
    if (R.digestHour(Date.now(), z) === hour) return { zone: z, off };
  }
  throw new Error('no zone is at hour ' + hour);
}
const EVE = zoneAt(19), MORN = zoneAt(10);
async function phone(who, { hash = '', big = false, zone = EVE.zone } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: zone });
  await ctx.addInitScript(([w, big]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
    localStorage.setItem('parwah-big', big ? '1' : '0');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: w.role, circleName: w.circleName }));
  }, [who, big]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  // Today has drawn once the family has loaded: the status line is filled in.
  await page.waitForFunction(() => { const e = document.getElementById('hero-status'); return e && e.textContent && e.textContent !== '…'; }, null, { timeout: 15000 });
  return page;
}

function measureIn(sel) {
  const root = document.querySelector(sel);
  if (!root) return { overflow: 0, bad: ['missing ' + sel] };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]'); };
  const L = (c) => { const m = c.match(/[\d.]+/g); if (!m) return 1; return m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map(x => x.trim()); return p.length === 4 ? +p[3] : 1; };
  const bgOf = (el) => { let n = el; while (n) { const c = getComputedStyle(n);
      if (alpha(c.backgroundColor) > 0.9) return [c.backgroundColor];
      if (c.backgroundImage && c.backgroundImage !== 'none' && n !== document.body) { const st = (c.backgroundImage.match(/rgba?\([^)]+\)/g) || []).filter(x => alpha(x) > 0.5); if (st.length) return st; }
      n = n.parentElement; } return [getComputedStyle(document.body).backgroundColor]; };
  const out = { overflow: document.scrollingElement.scrollWidth - innerWidth, bad: [] };
  root.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, textarea').forEach(el => {
    if (!vis(el)) return;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return;
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) return;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) out.bad.push('small ' + (el.id || el.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const el = w.currentNode.parentElement; if (!w.currentNode.textContent.trim() || !el || !vis(el)) continue;
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
    if (size < 11.99) out.bad.push('tiny ' + el.textContent.trim().slice(0, 20));
    const a = L(cs.color), ratio = Math.min(...bgOf(el).map(bg => { const b = L(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5) - 0.01) out.bad.push('contrast ' + el.textContent.trim().slice(0, 24) + ' ' + ratio.toFixed(2));
  }
  return out;
}
async function design(page, sel, label) {
  const was = page.viewportSize(); const bad = [];
  for (const [wd, sc] of [[320, 'light'], [390, 'light'], [390, 'dark'], [320, 'dark']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc }); await settle(page);
    const m = await page.evaluate(measureIn, sel);
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
  ok('design: ' + label + ' - 44px targets, 12px floor, AA in both themes, nothing sideways at 320/390', bad.length === 0, bad.slice(0, 6).join(' | '));
}

// ---- a family, and a day
const fam = (await admin.query(`insert into circles (code, name, kind) values ('KAPOOR','Kapoor Family','family') returning id`)).rows[0].id;
const rohan = await person(fam, 'KAPOOR', 'Kapoor Family', 'Rohan');
const papa = await person(fam, 'KAPOOR', 'Kapoor Family', 'Papa', 'parent');
const priya = await person(fam, 'KAPOOR', 'Kapoor Family', 'Priya');
const chachu = await person(fam, 'KAPOOR', 'Kapoor Family', 'Chachu');
const gup = (await admin.query(`insert into circles (code, name, kind) values ('GUPTA2','Gupta Family','family') returning id`)).rows[0].id;
const kamla = await person(gup, 'GUPTA2', 'Gupta Family', 'Kamla');

const local = new Date(Date.now() + EVE.off * 3600000);
const tomorrow1pm = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 13) - EVE.off * 3600000);
ok('the day: Papa checks in', (await api('events', papa, { type: 'checkin', text: '' })).status === 201);
ok('the day: Rohan plans Sunday lunch for tomorrow', (await api('plans', rohan, { action: 'create', title: 'Sunday lunch', kind: 'meet', at: tomorrow1pm.toISOString() })).status === 201);
ok('the day: Priya recommends a show to Rohan', (await api('games', priya, { area: 'pasand', action: 'rec_add', title: 'Panchayat', kind: 'show', to: [rohan.id] })).ok === true);

// ================================================================ 1. Today, after 6pm
const P1 = await phone(rohan);
await P1.waitForSelector('#dg-today [data-dgopen]', { timeout: 8000 }).catch(() => {});
const row = await P1.textContent('#dg-today');
ok('after 6pm, Rohan\'s Today has the row "Aaj kya hua"', /Aaj kya hua/.test(row) && /What happened in the family today\./.test(row) && /Read it/.test(row), row);
ok('it sits on Today, after the recommendation row', await P1.evaluate(() => {
  const a = document.getElementById('ps-today'), b = document.getElementById('dg-today');
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && b.closest('#pane-home') !== null; }));
ok('nothing was written, and no model asked, before he opens it', (await admin.query(`select to_regclass('digest_daily') as t`)).rows[0].t === null && modelCalls.length === 0);
await design(P1, '#dg-today', 'the Today row');
await shotAll(P1, 'today-row');

// Before 6pm there is no row.
const M1 = await phone(priya, { zone: MORN.zone });
ok('before 6pm, Priya\'s Today has no row', (await M1.textContent('#dg-today')).trim() === '' && (await M1.$('#dg-today [data-dgopen]')) === null);

// ================================================================ 2. the sheet
// Loading: hold the answer back and look.
let release; const held = new Promise(r => { release = r; });
await P1.route('**/api/ekta', async route => { await held; await route.continue(); });
await P1.click('#dg-today [data-dgopen]');
await P1.waitForSelector('#dg-load', { timeout: 5000 });
ok('loading: the sheet opens at once and says Ekta is putting today together', await P1.isVisible('#bondsheet') && (await P1.textContent('#bs-title')) === 'Aaj kya hua'
   && /Ekta is putting today together\./.test(await P1.textContent('#dg-load')));
await design(P1, '#bondsheet .mp', 'the sheet, loading');
release(); await P1.unroute('**/api/ekta');
await P1.waitForSelector('#dg-text', { timeout: 8000 });
const note = await P1.textContent('#dg-text');
ok('the note: tomorrow\'s lunch first, then Papa\'s check-in and Priya\'s recommendation',
   note.startsWith('Tomorrow at 1:00 pm: Sunday lunch.') && /Papa checked in at \d{1,2}:\d\d [ap]m\./.test(note) && /Priya recommended something for you: Panchayat\./.test(note), note);
ok('it says when it was written', /^Written today at \d{1,2}:\d\d/.test(await P1.textContent('#dg-when')), await P1.textContent('#dg-when'));
ok('written plainly: no line about how it was made', (await P1.$('#dg-how')) === null);
ok('no "Since then" line when nothing has changed', (await P1.$('#dg-since')) === null);
ok('thumbs, and "Tell me each evening" unticked', await P1.isVisible('#dg-up') && await P1.isVisible('#dg-down') && !(await P1.isChecked('#dg-eve'))
   && (await P1.getAttribute('#dg-up', 'aria-pressed')) === 'false');
await design(P1, '#bondsheet .mp', 'the sheet with the note');
await shotAll(P1, 'sheet');

await P1.click('#dg-up');
await P1.waitForSelector('#dg-up[aria-pressed="true"]', { timeout: 5000 });
ok('thumbs up is stored, one for Rohan today', (await admin.query(`select vote from digest_daily where member_id = $1`, [rohan.id])).rows.map(r => r.vote).join() === '1');
ok('and the sheet says thank you', await P1.isVisible('#dg-thanks') && (await P1.getAttribute('#dg-down', 'aria-pressed')) === 'false');
await P1.click('#dg-down');
await P1.waitForSelector('#dg-down[aria-pressed="true"]', { timeout: 5000 });
ok('changing his mind changes the one answer', (await admin.query(`select vote from digest_daily where member_id = $1`, [rohan.id])).rows.map(r => r.vote).join() === '-1'
   && (await P1.getAttribute('#dg-up', 'aria-pressed')) === 'false');

await P1.check('#dg-eve');
await P1.waitForFunction(() => /^(On\.|Saved\.)/.test(document.getElementById('dg-eve-note').textContent), null, { timeout: 5000 });
const pref = (await admin.query(`select evening, tz from digest_prefs where member_id = $1`, [rohan.id])).rows[0];
ok('"Tell me each evening" is saved, with his phone\'s zone', pref && pref.evening === true && pref.tz === EVE.zone, JSON.stringify(pref));
await design(P1, '#bondsheet .mp', 'the sheet after thumbs and the evening setting');
await P1.click('#bs-x');
await P1.waitForSelector('#bondsheet', { state: 'hidden', timeout: 5000 });
ok('the sheet closes', !(await P1.isVisible('#bondsheet')));

// A new SOS after the note was written: the kept note, and one line.
const sos = await api('events', papa, { type: 'sos', text: '' });
await P1.click('#dg-today [data-dgopen]');
await P1.waitForSelector('#dg-since', { timeout: 8000 });
ok('after a new SOS: the same note, his thumb kept, and "Since then"', (await P1.textContent('#dg-text')) === note
   && /^Since then: Papa raised an SOS at \d{1,2}:\d\d [ap]m and it is still open\.$/.test(await P1.textContent('#dg-since'))
   && (await P1.getAttribute('#dg-down', 'aria-pressed')) === 'true' && await P1.isChecked('#dg-eve'), await P1.textContent('#dg-since'));
await design(P1, '#bondsheet .mp', 'the sheet with Since then');
await shotAll(P1, 'sheet-since');
await api('events', rohan, { type: 'sos_resolve', sosId: sos.sosId });

// ================================================================ 3. error and offline
await P1.click('#bs-x'); await P1.waitForSelector('#bondsheet', { state: 'hidden' });
await P1.route('**/api/ekta', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'relation "digest_daily" does not exist' }) }));
await P1.click('#dg-today [data-dgopen]');
await P1.waitForSelector('#dg-retry', { timeout: 8000 });
const errText = await P1.textContent('#dg-err');
ok('an error is said in plain words, never the server\'s own', errText === 'Could not load today\'s note. Try again in a moment.', errText);
ok('with the note as the phone last loaded it, and Try again', await P1.isVisible('#dg-last') && (await P1.textContent('#dg-text')) === note && await P1.isVisible('#dg-retry'));
await design(P1, '#bondsheet .mp', 'the sheet, error');
await P1.unroute('**/api/ekta');
await P1.context().setOffline(true);
await P1.click('#dg-retry');
await P1.waitForFunction(() => { const e = document.getElementById('dg-err'); return e && /offline/.test(e.textContent); }, null, { timeout: 8000 });
ok('offline says so, and what will happen', (await P1.textContent('#dg-err')) === 'You are offline. Aaj kya hua will load when the internet is back.');
await design(P1, '#bondsheet .mp', 'the sheet, offline');
await P1.context().setOffline(false);
await P1.click('#dg-retry');
await P1.waitForSelector('#dg-when', { timeout: 8000 });
ok('Try again loads it once the internet is back', (await P1.textContent('#dg-text')) === note && (await P1.$('#dg-err[hidden]')) !== null);
await P1.click('#bs-x'); await P1.waitForSelector('#bondsheet', { state: 'hidden' });

// ================================================================ 4. from Ekta's screen, at any hour
await M1.evaluate(() => { location.hash = '#ekta'; });
await M1.waitForSelector('#dg-ekta', { state: 'visible', timeout: 5000 });
await design(M1, '#pane-ekta', 'Ekta\'s screen with the button');
await M1.click('#dg-ekta');
await M1.waitForSelector('#dg-when', { timeout: 8000 });
ok('at 10am the button on Ekta\'s screen opens the day so far', /^This is the day so far, at \d{1,2}:\d\d.*The full note comes after 6 pm\.$/.test(await M1.textContent('#dg-when')), await M1.textContent('#dg-when'));
const pNote = await M1.textContent('#dg-text');
ok('Priya\'s note is hers: the plan and the check-in, not the recommendation she sent', /Sunday lunch/.test(pNote) && /Papa checked in/.test(pNote) && !/Panchayat/.test(pNote), pNote);
await design(M1, '#bondsheet .mp', 'the day so far');
await M1.click('#bs-x'); await M1.waitForSelector('#bondsheet', { state: 'hidden' });

// ================================================================ 5. senior mode
const S1 = await phone(papa, { big: true });
ok('Papa is in senior mode', await S1.evaluate(() => document.body.classList.contains('senior')));
await S1.waitForSelector('#dg-today [data-dgopen]', { timeout: 8000 }).catch(() => {});
ok('senior mode shows the row on Today too', /Aaj kya hua/.test(await S1.textContent('#dg-today')));
await design(S1, '#dg-today', 'the Today row, senior mode');
await S1.click('#dg-today [data-dgopen]');
await S1.waitForSelector('#dg-text', { timeout: 8000 });
const sNote = await S1.textContent('#dg-text');
const fs = await S1.$eval('#dg-text', el => parseFloat(getComputedStyle(el).fontSize));
const fsR = await P1.evaluate(() => { const d = document.createElement('div'); d.className = 'bondtext'; document.body.appendChild(d); const v = parseFloat(getComputedStyle(d).fontSize); d.remove(); return v; });
ok('the same kind of note, in his words ("You checked in")', /You checked in at \d{1,2}:\d\d [ap]m\./.test(sNote) && /Sunday lunch/.test(sNote), sNote);
ok('larger: ' + fs + 'px against ' + fsR + 'px', fs >= 23.9 && fs > fsR, fs + ' ' + fsR);
ok('senior mode: a big "Sunao" button and the two thumbs, no setting to work out', await S1.isVisible('#ek2-sunao-dg') && await S1.isVisible('#dg-up') && await S1.isVisible('#dg-down')
   && (await S1.$('#dg-eve')) === null && await S1.isVisible('#bs-x') && (await S1.$$('#bs-body button')).length === 3 && (await S1.$$('#bs-body input')).length === 0);
ok('"Sunao" is at least 56px tall', await S1.$eval('#ek2-sunao-dg', el => el.getBoundingClientRect().height) >= 55.5);
await S1.click('#dg-up');
await S1.waitForFunction(() => document.getElementById('dg-up').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
ok('his thumbs up is stored', (await admin.query(`select vote from digest_daily where member_id = $1`, [papa.id])).rows[0].vote === 1);
await design(S1, '#bondsheet .mp', 'the sheet, senior mode');
await shotAll(S1, 'sheet-senior');
await S1.click('#bs-x'); await S1.waitForSelector('#bondsheet', { state: 'hidden' });

// ================================================================ 6. a quiet day
const Q1 = await phone(kamla);
await Q1.waitForSelector('#dg-today [data-dgopen]', { timeout: 8000 }).catch(() => {});
await Q1.click('#dg-today [data-dgopen]');
await Q1.waitForSelector('#dg-text', { timeout: 8000 });
ok('a quiet day says so kindly, in one line, with nothing of another family', (await Q1.textContent('#dg-text')) === 'It was a quiet day in the family today, with nothing new to tell.');
await design(Q1, '#bondsheet .mp', 'the sheet on a quiet day');
ok('all of this with no model call', modelCalls.length === 0);

// ================================================================ 7. written by Ekta (a fake model through the seam)
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
const C1 = await phone(chachu);
await C1.waitForSelector('#dg-today [data-dgopen]', { timeout: 8000 }).catch(() => {});
await C1.click('#dg-today [data-dgopen]');
await C1.waitForSelector('#dg-how', { timeout: 8000 });
ok('with a model the note is Ekta\'s, and the sheet says how it was made', (await C1.textContent('#dg-text')) === 'Aaj Papa checked in, and kal Sunday lunch hai.'
   && (await C1.textContent('#dg-how')) === 'Written by Ekta from what you can see in the family today.' && modelCalls.length === 1);
ok('only the list was sent', /^Facts for today, most important first:\n1\. /.test(modelCalls[0].user) && !/@|\+91|KAPOOR/.test(modelCalls[0].system + modelCalls[0].user));
await design(C1, '#bondsheet .mp', 'the sheet, written by Ekta');
await shotAll(C1, 'sheet-ekta');
await C1.click('#bs-x'); await C1.waitForSelector('#bondsheet', { state: 'hidden' });
await C1.click('#dg-today [data-dgopen]');
await C1.waitForSelector('#dg-how', { timeout: 8000 });
ok('opening it again is free: still one call', modelCalls.length === 1);
delete process.env.ANTHROPIC_API_KEY;

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
globalThis.fetch = realFetch;
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`digest.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`digest.e2e: ${pass}/${pass} checks pass`);
