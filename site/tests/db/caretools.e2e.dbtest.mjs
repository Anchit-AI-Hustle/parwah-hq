// FIVE FAMILY-CARE TOOLS, END TO END: a real browser, the real API and a real
// PostgreSQL. What a family meets:
//
//   - Papa, in elder mode, taps "Someone is asking for money or an OTP": the
//     family is told at once; he reads the rules, 1930, and who is calling.
//   - Anchit sees it first on Today and says "I've seen it, calling now".
//   - Papa asks for help with his phone; Anchit takes it.
//   - The daily check-in: Anchit asks, Papa says yes on his own screen; a
//     missed check-in shows on Anchit's Today with a Call button.
//   - The life certificate and the call rota, from To do's Ready-made card.
//
// With CARETOOLS_SHOT_DIR set, every new screen is saved at 390 and 1440,
// light and dark.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('caretools.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('caretools.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('caretools.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'ekta']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { quietSweep } = await import('../../../api/_familycare.mjs');
await ensureSchema(db());

let n = 0;
async function user(name) {
  const phone = '+9198600' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
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
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.0.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
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
const SHOTS = process.env.CARETOOLS_SHOT_DIR;
async function shotAll(page, name){
  if (!SHOTS) return;
  const was = page.viewportSize();
  for (const w of [390, 1440]) for (const sc of ['light', 'dark']) {
    await page.setViewportSize({ width: w, height: 900 }); await page.emulateMedia({ colorScheme: sc });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${w}-${sc}.png`, fullPage: false });
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
}
async function phone(who, { width = 390, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([w]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: w.role || 'family', circleName: w.circleName }));
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  await page.waitForTimeout(1300);
  return page;
}
const call = async (name, body, query = {}, method = 'POST', token) => {
  let out, st = 200; const res = { status(s) { st = s; return this; }, json(j) { out = j; return this; }, setHeader() {} };
  await HANDLERS[name]({ method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.4.0.' + (++n % 250) }, query, body }, res);
  return { ...out, http: st };
};

// The new sheets are not on any main screen, so the design rules are
// measured here, inside each one: 44px targets, a 12px floor, WCAG AA in
// light and dark, and nothing sideways at 320px.
function measureIn(sel) {
  const root = document.querySelector(sel);
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
    if (el.classList.contains('linkbtn') && getComputedStyle(el).display === 'inline') return;
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
  for (const [wd, sc] of [[320, 'light'], [390, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc }); await page.waitForTimeout(120);
    const m = await page.evaluate(measureIn, sel);
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
  ok('design: ' + label + ' - 44px targets, 12px floor, AA contrast in both themes, nothing sideways at 320', bad.length === 0, bad.slice(0, 5).join(' | '));
}
const reload = async (P) => { await P.reload(); await P.waitForTimeout(1400); };
const big = async (P, sel) => P.$$eval(sel, bs => bs.every(b => b.getBoundingClientRect().height >= 44));

// ---- the family: Anchit, his brother Rahul, Papa
const U = { Anchit: await user('Anchit') };
const made = await call('circle', { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Anchit', circleName: 'Tandon Family', userId: U.Anchit.userId, relation: 'son' }, {}, 'POST', U.Anchit.token);
const code = made.code;
await admin.query(`update circles set join_policy = 'open' where code = $1`, [code]);
U.Anchit.memberId = made.memberId;
for (const [name, rel] of [['Rahul', 'son'], ['Papa', 'father']]) {
  U[name] = await user(name);
  const j = await call('circle', { action: 'join', code, memberName: name, userId: U[name].userId, relation: rel }, {}, 'POST', U[name].token);
  U[name].memberId = j.memberId;
}
await admin.query(`update members set role = 'parent', gender = 'm', dob = '1944-03-10' where id = $1`, [U.Papa.memberId]);
await admin.query(`update members m set phone = u.phone from users u where u.id = m.user_id`);
const as = (name) => ({ ...U[name], code, circleName: 'Tandon Family', role: name === 'Papa' ? 'parent' : 'family' });

const P = await phone(as('Papa'), { hash: '#home' });
const A = await phone(as('Anchit'), { hash: '#home' });

// =====================================================================
// ASK FAMILY FIRST
// =====================================================================
ok('Papa\'s Today has the big "Someone is asking for money or an OTP" and "Help me with my phone"',
   await P.isVisible('#btn-askfirst') && await P.isVisible('#btn-phonehelp') && await big(P, '#btn-askfirst, #btn-phonehelp'));
await P.click('#btn-askfirst'); await P.waitForTimeout(1300);
ok('one tap tells the family, and the sheet says so', await P.isVisible('#fcafsheet') && /The family has been told/.test(await P.textContent('#fcaf-status')), await P.textContent('#fcaf-status'));
const rules = await P.textContent('#fcaf-rules');
ok('the plain rules: OTP and UPI PIN, video-call arrests, KYC on a call, call us', /OTP/.test(rules) && /UPI PIN/.test(rules) && /video call/.test(rules) && /KYC/.test(rules) && /call us/.test(rules));
ok('one tap to 1930 and the official site', (await P.getAttribute('#fcaf-1930', 'href')) === 'tel:1930' && !!(await P.$('#fcafsheet a[href="https://cybercrime.gov.in"]')));
ok('and a call to the family, by name', /Call Anchit/.test(await P.textContent('#fcaf-calls')));
await shotAll(P, 'askfirst-parent');
await design(P, '#fcafsheet', 'ask family first');
const askRow = (await admin.query(`select count(*)::int as n from askfirst where status = 'open'`)).rows[0].n;
ok('the server has one open question', askRow === 1);

await reload(A);
ok('Anchit\'s Today leads with it, with Call Papa', /Papa is asking the family first/.test(await A.textContent('#fcalerts')) && !!(await A.$('#fcalerts a[href^="tel:"]')));
await shotAll(A, 'askfirst-family');
await design(A, '#fcalerts', 'the alerts on Today');
await A.click('#fcalerts [data-fcafack]'); await A.waitForTimeout(1200);
ok('"I\'ve seen it, calling now" is recorded', (await admin.query(`select status from askfirst`)).rows[0].status === 'acked');
await reload(P);
await P.click('#fcalerts [data-fcafopen]'); await P.waitForTimeout(300);
ok('Papa sees "Anchit has seen it, calling you now"', /Anchit has seen it, calling you now/.test(await P.textContent('#fcaf-status')), await P.textContent('#fcaf-status'));
// The safe word, set from the sheet, shown to the family only.
await P.click('#fcaf-safe [data-fcwedit]'); await P.fill('#fcaf-word', 'Gulab jamun'); await P.click('#fcaf-wsave'); await P.waitForTimeout(1300);
ok('a family safe word is set and shown in the sheet', /Gulab jamun/.test(await P.textContent('#fcaf-safe')));
await shotAll(P, 'askfirst-safeword');
await P.click('#fcaf-sorted'); await P.waitForTimeout(1200);
ok('"All sorted" closes it', (await admin.query(`select status from askfirst`)).rows[0].status === 'closed' && await P.isHidden('#fcafsheet'));

// =====================================================================
// HELP WITH MY PHONE
// =====================================================================
await P.click('#btn-phonehelp'); await P.waitForTimeout(300);
const cards = await P.$$eval('#fcph-howto details.howto', d => d.length);
ok('six to eight short how-to cards', cards >= 6 && cards <= 8, String(cards));
await P.click('#fcph-send'); await P.waitForTimeout(200);
ok('sending nothing says what is needed, under the box', await P.isVisible('#fcph-note-err'));
await P.fill('#fcph-note', 'WhatsApp is asking for a code');
await P.click('#fcph-send'); await P.waitForTimeout(1300);
ok('sent to the family', (await admin.query(`select count(*)::int as n from help_asks`)).rows[0].n === 1);
await P.click('#fcph-howto details:nth-child(4) summary'); await P.waitForTimeout(150);
await shotAll(P, 'phonehelp');
await design(P, '#fcphsheet', 'help with my phone');
await P.keyboard.press('Escape');
await reload(A);
ok('Anchit sees "Papa needs help with the phone"', /Papa needs help with the phone/.test(await A.textContent('#fcalerts')));
await A.click('#fcalerts [data-fchelpclaim]'); await A.waitForTimeout(1200);
await reload(P);
ok('Papa sees "Anchit is on it"', /Anchit is on it/.test(await P.textContent('#fcalerts')), await P.textContent('#fcalerts'));

// =====================================================================
// THE DAILY CHECK-IN
// =====================================================================
await reload(A);
ok('Anchit sees Papa\'s check-in is off, with Ask Papa', /Papa: off/.test(await A.textContent('#fcquiet')));
await A.click('#fcquiet [data-fcqset]'); await A.waitForTimeout(300);
ok('the sheet says nothing turns on until Papa says yes', /until Papa says yes/.test(await A.textContent('#fcq-sub')));
await A.fill('#fcq-time', '11:00'); await A.click('#fcq-save'); await A.waitForTimeout(1200);
await reload(P);
ok('Papa sees the question first on his own screen', /Anchit asks: a daily check-in by 11:00\?/.test(await P.textContent('#fcalerts')));
await shotAll(P, 'checkin-ask');
await P.click('#fcalerts [data-fcqyes]'); await P.waitForTimeout(1300);
ok('Papa says yes: it is on', (await admin.query(`select checkin_by from members where id = $1`, [U.Papa.memberId])).rows[0].checkin_by === '11:00');
// The time comes and goes with no check-in (the sweep is told the time).
await admin.query(`update members set quiet_nudged_for = null, quiet_alerted_for = null where id = $1`, [U.Papa.memberId]);
await admin.query(`delete from events where member_id = $1 and type = 'checkin'`, [U.Papa.memberId]);
// Any sign of life that day counts as checked in now (stream A, A6), and
// earlier in this file Papa wrote to the family chat. For this part he has
// been silent all day.
await admin.query(`delete from messages where member_id = $1`, [U.Papa.memberId]);
const tz = (await admin.query(`select tz from members where id = $1`, [U.Papa.memberId])).rows[0].tz;
const { dayIn, fromWall } = await import('../../../api/_recur.mjs');
const [y, m, d] = dayIn(tz).split('-').map(Number);
await quietSweep(db(), (await admin.query(`select circle_id from members where id = $1`, [U.Papa.memberId])).rows[0].circle_id, fromWall({ y, m, d, h: 11, mi: 45, s: 0 }, tz));
await reload(A);
ok('Anchit\'s Today: "Papa has not checked in today", with Call Papa', /Papa has not checked in today/.test(await A.textContent('#fcalerts')) && /Give him a call\?/.test(await A.textContent('#fcalerts')), await A.textContent('#fcalerts'));
await shotAll(A, 'checkin-family');
await design(A, '#fcquiet', 'the daily check-in card');
await reload(P); await P.evaluate(() => scrollTo(0, 0));
await shotAll(P, 'checkin-parent');
await P.click('#fcquiet [data-fcqok]'); await P.waitForTimeout(1300);
await reload(A);
ok('Papa taps I\'m okay: the alert goes', !/has not checked in/.test(await A.textContent('#fcalerts')) && /Said okay at/.test(await A.textContent('#fcquiet')));
await A.click('#fcquiet [data-fcqset]'); await A.waitForTimeout(300);
await shotAll(A, 'checkin-away');
await design(A, '#fcqsheet', 'the daily check-in sheet');
const later = new Date(Date.now() + 3 * 86400000); const ld = later.getFullYear() + '-' + String(later.getMonth() + 1).padStart(2, '0') + '-' + String(later.getDate()).padStart(2, '0');
await A.fill('#fcq-away', ld); await A.click('#fcq-awaygo'); await A.waitForTimeout(1300);
// Someone else's check-in is paused only with their own yes (stream A, A7):
// Anchit's tap asks, Papa answers on his own phone, and only then is it paused.
const awayRow = async () => (await admin.query(`select to_char(away_until,'YYYY-MM-DD') as a, away_ask from members where id = $1`, [U.Papa.memberId])).rows[0];
ok('the family asking to pause it changes nothing by itself', (await awayRow()).a === null && (await awayRow()).away_ask === ld, JSON.stringify(await awayRow()));
await reload(P);
ok('Papa is asked on his own phone', /Anchit asks: pause your daily check-in until/.test(await P.textContent('#fcalerts')), await P.textContent('#fcalerts'));
await P.click('#fcalerts [data-sfawy]');
await P.waitForFunction(() => !/asks: pause/.test(document.querySelector('#fcalerts').textContent), null, { timeout: 15000 });
ok('the family can pause it while Papa travels, once Papa says yes', (await awayRow()).a === ld, JSON.stringify(await awayRow()));

// =====================================================================
// THE LIFE CERTIFICATE AND THE CALL ROTA
// =====================================================================
await A.goto(BASE + '/#care'); await A.waitForTimeout(1300);
ok('To do offers a Yearly repeat', !!(await A.$('#r-seg [data-rep="yearly"]')));
await A.click('#fc-lc-open'); await A.waitForTimeout(300);
await shotAll(A, 'lifecert-new');
await A.selectOption('#fct-lc-who', U.Papa.memberId); await A.click('#fct-lc-go'); await A.waitForTimeout(1500);
const lc = (await admin.query(`select id, template_data from requests where template = 'lifecert'`)).rows[0];
ok('the life certificate is on To do, with Papa\'s October window (80 and over)', lc && /-10-01$/.test(lc.template_data.opens));
await A.click(`[data-topen="${lc.id}"]`); await A.waitForTimeout(500);
ok('its checklist is in the task, with the official site only', await A.isVisible('#ts-tpl [data-fclc="ppo"]') && /jeevanpramaan\.gov\.in/.test(await A.textContent('#ts-tpl')));
await A.click('#ts-tpl [data-fclc="ppo"]'); await A.waitForTimeout(900);
ok('a tick is kept', (await admin.query(`select template_data from requests where id = $1`, [lc.id])).rows[0].template_data.checks.ppo === true);
await A.fill('#fclc-ack', '1234 5678 9012'); await A.click('#fclc-save'); await A.waitForTimeout(900);
ok('an Aadhaar number is refused under the box', await A.isVisible('#fclc-ack-err') && /Aadhaar/.test(await A.textContent('#fclc-ack-err')));
await A.click('[data-fclcrej]'); await A.waitForTimeout(1500);
ok('"It was rejected" shows the steps that usually sort it', /Update the Aadhaar photo/.test(await A.textContent('#ts-tpl')) && /doorstep banking/.test(await A.textContent('#ts-tpl')));
await shotAll(A, 'lifecert-task');
await design(A, '#ts-tpl', 'the life certificate checklist');
await A.fill('#fclc-ack', 'JP2026AB1234'); await A.click('#fclc-save'); await A.waitForTimeout(1500);
ok('the acknowledgement finishes it and next year\'s is made', (await admin.query(`select count(*)::int as n from requests where template = 'lifecert' and status = 'open'`)).rows[0].n === 1
   && (await admin.query(`select count(*)::int as n from requests where template = 'lifecert' and status = 'done'`)).rows[0].n === 1);
await A.click('#ts-x'); await A.waitForTimeout(200);

await A.click('#fc-rota-open'); await A.waitForTimeout(300);
await A.selectOption('#fct-r-who', U.Papa.memberId); await A.waitForTimeout(100);
await shotAll(A, 'rota-new');
await design(A, '#fctsheet', 'the call rota sheet');
await A.click('#fct-r-go'); await A.waitForTimeout(1500);
const rota = (await admin.query(`select id, claimed_by, template_data from requests where template = 'callrota'`)).rows[0];
ok('the call rota starts with the people picked', rota && rota.template_data.rota.length === 2 && rota.template_data.rota.includes(U.Rahul.memberId));
await A.click(`[data-topen="${rota.id}"]`); await A.waitForTimeout(500);
ok('the rota is visible in the task, today\'s person first', /Today: /.test(await A.textContent('#ts-tpl')) && /Called Papa/.test(await A.textContent('#ts-tpl')));
await shotAll(A, 'rota-task');
await design(A, '#ts-tpl', 'the call rota in the task');
await A.click(`#ts-tpl [data-fcrdone="${rota.id}"]`); await A.waitForTimeout(1400);
ok('"Called Papa" passes tomorrow to the next person', (await admin.query(`select count(*)::int as n from requests where template = 'callrota' and status = 'claimed' and claimed_by <> $1`, [rota.claimed_by])).rows[0].n === 1);

ok('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(`\ncaretools.e2e: ${pass} passed, ${fails.length} failed`);
await browser.close(); server.close(); await admin.end();
process.exit(fails.length ? 1 : 0);
