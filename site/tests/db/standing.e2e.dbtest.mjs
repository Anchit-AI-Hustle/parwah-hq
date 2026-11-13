// ACCOUNTS, JOINING AND EQUAL STANDING, END TO END: a real browser, the real
// API and a real PostgreSQL. The doors of the app, walked the way a family
// walks them:
//
//   1. the sign-in card asks "I have a profile" or "I am new here", and says
//      the same thing for a number nobody has as for one somebody has;
//   2. the Family tab: "Is Tara an adult?", a stronger family code, and two
//      adults letting the code be enough; what a child is not offered;
//   3. "This is me", and "What your family wrote about you";
//   4. a forgotten PIN: two numbers read out on a call, typed by an adult;
//   5. removing someone who is on Parwah takes two adults;
//   6. a change to my place in the tree, undone in one tap;
//   7. Profile: devices, who sees my details, recovery contact, my activity,
//      download my data, delete my account with a way back;
//   8. a sign-in on a new phone, "Not me", and a new PIN.
//
// Every new surface is measured like every other screen: 44px targets, a
// 12px floor, AA contrast in light and dark, nothing sideways at 320, 390
// or 1280. Nothing here waits a fixed time and then looks: each step waits
// for the element or the state it is about to check.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('standing.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('standing.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('standing.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games', 'ekta']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function user(name) {
  const phone = '+9198630' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}
async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.4.0.' + (++n % 250) }, query, body };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
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
const T = { timeout: 20000 };

async function phone(who, { scheme = 'light', width = 390, hash = '#people' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', colorScheme: scheme });
  await ctx.addInitScript(([w]) => {
    if (localStorage.getItem('parwah-token')) return;   // a reload keeps what the app itself saved
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: 'family', circleName: w.circleName }));
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  // The family has been read and the tree drawn: only then is the screen ready.
  if (hash === '#people') await page.waitForSelector('#tree .tperson', T);
  return page;
}
// Wait until some text is on the screen, then say whether it was. Never a fixed pause.
const sees = (page, sel, re, opts) => page.waitForFunction(([s, src, fl]) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && new RegExp(src, fl).test(e.textContent); },
  [sel, re.source, re.flags], opts || T).then(() => true, () => false);
const gone = (page, sel) => page.waitForSelector(sel, { state: 'hidden', ...T }).then(() => true, () => false);
const shown = (page, sel) => page.waitForSelector(sel, { state: 'visible', ...T }).then(() => true, () => false);

// The design rules, measured inside one part of the screen (as the other
// end-to-end tests do).
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
  const out = { overflow: document.scrollingElement.scrollWidth - innerWidth, inner: root.scrollWidth - root.clientWidth, bad: [], seen: 0 };
  root.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, textarea').forEach(el => {
    if (!vis(el)) return;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return;
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) return;
    out.seen++;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) out.bad.push('small ' + (el.id || el.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (r.right > innerWidth + 0.5 || r.left < -0.5) out.bad.push('off the side ' + (el.id || el.textContent.trim().slice(0, 20)));
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
  const was = page.viewportSize(); const bad = []; let seen = 0;
  for (const [wd, sc] of [[320, 'light'], [320, 'dark'], [390, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc });
    // Wait for the new width and theme to be laid out and painted, not for a clock.
    await page.waitForFunction(([w, dark]) => innerWidth === w && matchMedia('(prefers-color-scheme: dark)').matches === dark, [wd, sc === 'dark'], T);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const m = await page.evaluate(measureIn, sel);
    seen += m.seen;
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    if (m.inner > 1) bad.push(wd + ' sideways inside ' + m.inner + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction((w) => innerWidth === w, was.width, T);
  ok('design: ' + label + ' - 44px targets, 12px floor, AA contrast in light and dark, nothing sideways at 320 or 390', bad.length === 0 && seen > 0, bad.slice(0, 6).join(' | ') || 'nothing measured');
}

// Wide screens too: nothing sideways at 1280.
async function wide(page, label) {
  const was = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => innerWidth === 1280, null, T);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const over = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  await page.setViewportSize(was);
  await page.waitForFunction((w) => innerWidth === w, was.width, T);
  ok('design: ' + label + ' - nothing sideways at 1280', over <= 0, over + 'px');
}
const inApp = (page) => page.waitForFunction(() => document.body.classList.contains('inapp'), null, T).then(() => true, () => false);
async function open(who, hash) {
  const page = await phone(who, { hash: hash || '#home' });
  await inApp(page);
  return page;
}
const toastSays = (page, re) => sees(page, '#toast', re);
const confirmSheet = async (page) => { await shown(page, '#asksheet'); await page.click('#as-yes'); };
const q1 = async (text, args) => (await admin.query(text, args)).rows[0];

// ---- the Vermas, through the real API: Papa (an elder), Maa (mother),
// Rohan (born 1990), Aarav (born 2014), Tara (nobody wrote her age), and
// Chacha, whom the family added by name.
const circleApi = HANDLERS.circle;
const U = {};
for (const name of ['Papa', 'Maa', 'Rohan', 'Aarav', 'Tara']) U[name] = await user(name);
let r = await call(circleApi, { token: U.Papa.token, body: { action: 'create', kind: 'family', memberName: 'Papa', circleName: 'Verma Family', role: 'parent' } });
const code0 = r.code, circleId = (await q1('select id from circles where code = $1', [code0])).id;
await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]);
const M = { Papa: { ...U.Papa, memberId: r.memberId } };
for (const [name, rel] of [['Maa', 'mother'], ['Rohan', null], ['Aarav', null], ['Tara', null]]) {
  const j = await call(circleApi, { token: U[name].token, body: { action: 'join', code: code0, memberName: name, relation: rel } });
  M[name] = { ...U[name], memberId: j.memberId };
}
await admin.query(`update members set dob = '1990-05-05' where id = $1`, [M.Rohan.memberId]);
await admin.query(`update members set dob = '2014-02-02' where id = $1`, [M.Aarav.memberId]);
// An older, short, letters-only code, and joining by approval.
await admin.query(`update circles set join_policy = 'approve', code = 'VERMAS' where id = $1`, [circleId]);
for (const k of Object.keys(M)) { M[k].code = 'VERMAS'; M[k].circleName = 'Verma Family'; }
await call(circleApi, { token: M.Papa.token, body: { action: 'add_person', code: 'VERMAS', memberId: M.Papa.memberId, personName: 'Dadi', gender: 'f', place: 'parent', ofId: M.Papa.memberId } });
r = await call(circleApi, { token: M.Papa.token, body: { action: 'add_person', code: 'VERMAS', memberId: M.Papa.memberId, personName: 'Chacha', gender: 'm', place: 'sibling', ofId: M.Papa.memberId } });
const chachaM = r.memberId;
await admin.query(`update members set relation = 'brother', dob = '1962-04-10', place = 'Kanpur', gift_info = '{"clothes":"XL"}'::jsonb where id = $1`, [chachaM]);
ok('setup: the Vermas, five on Parwah and Chacha by name', !!chachaM && Object.keys(M).length === 5);

// =========================================================== 1. the sign-in card
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const S = await ctx.newPage();
  S.on('pageerror', e => errors.push('sign-in: ' + e.message));
  await S.goto(BASE + '/');
  await shown(S, '#auth-step');
  ok('sign-in: the card asks first: "I have a profile" or "I am new here"', await S.isVisible('#ac-mode [data-acmode="in"]') && await S.isVisible('#ac-mode [data-acmode="new"]')
    && await S.getAttribute('#ac-mode [data-acmode="in"]', 'aria-pressed') === 'true');
  await design(S, '#auth-step', 'the sign-in card');
  await wide(S, 'the sign-in card');
  // A number nobody has, and Papa's: the screen says the same thing.
  await S.fill('#au-phone', '98630 99999'); await S.click('#au-go');
  ok('sign-in: a number nobody has is asked for a PIN, like any other', await shown(S, '#au-pin') && await S.isHidden('#au-namewrap'));
  await S.fill('#au-pin', '4819'); await S.click('#au-go');
  ok('sign-in: and told only that the number and PIN do not match', await sees(S, '#ob-err', /number and PIN do not match/) && !/new|not registered|no account/i.test(await S.textContent('#ob-err')));
  // New here.
  await S.click('#ac-mode [data-acmode="new"]');
  ok('new here: the name and the PIN, twice, are asked together', await shown(S, '#au-name') && await S.isVisible('#au-pin') && await S.isVisible('#au-pin2'));
  await design(S, '#auth-step', 'the sign-in card, new here');
  await S.fill('#au-phone', U.Papa.phone.slice(3)); await S.fill('#au-name', 'Not Papa'); await S.fill('#au-pin', '2957'); await S.fill('#au-pin2', '2957');
  await S.click('#au-go');
  ok('new here: a number that already has a profile reads as a wrong PIN, with the way across', await sees(S, '#ob-err', /do not match.*I have a profile/) && !/already registered|exists/i.test(await S.textContent('#ob-err')));
  await S.fill('#au-phone', '98630 77777'); await S.fill('#au-name', 'Naya'); await S.fill('#au-pin', '2957'); await S.fill('#au-pin2', '2957');
  await S.click('#au-go');
  ok('new here: a free number makes the profile, and the introduction starts', await shown(S, '#tr-title'));
  // The introduction is another test's; here it has been seen.
  await admin.query(`update users set toured_at = now() where name = 'Naya'`);
  await S.reload(); await shown(S, '#setup-step');
  ok('this phone made its own id, and keeps it', /^[0-9a-f]{48}$/.test(await S.evaluate(() => localStorage.getItem('parwah-device'))));
  ok('and the server knows the phone only by a hash', !!(await q1(`select 1 as x from user_devices d join users u on u.id = d.user_id where u.name = 'Naya' and length(d.device_hash) = 64`)));
  // "This is me": Naya is not Chacha, but the real Chacha joins the same way below.
  await S.click('#pk-join'); await shown(S, '#j-code');
  await S.fill('#j-code', 'VERMAS'); await S.fill('#j-name', 'Naya');
  await S.click('#j-go');
  ok('joining: the waiting screen says the request has gone, and not whose family it is', await sees(S, '#pend-msg', /request has gone to the family/) && !/Verma/.test(await S.textContent('#pending-step')));
  await design(S, '#pending-step', 'waiting to be let in');
  await admin.query(`update join_requests set status = 'declined' where status = 'pending'`);
  await ctx.close();
}

// =========================================================== 2. the family tab, for a grown-up and for a child
const PP = await open(M.Papa, '#people');
const PM = await open(M.Maa, '#people');
{
  ok('family: the grown-ups have a card for what they decide together', await shown(PP, '#ac-famcard'));
  ok('family: "Is Tara an adult?" is asked of an adult, about someone whose age nobody wrote', await sees(PP, '#ac-famlist', /Is Tara an adult\?/) && await sees(PP, '#ac-famlist', /Is Rohan an adult\?/).then(v => !v, () => true));
  ok('family: the code is short and letters only, so there is a gentle card', await sees(PP, '#ac-famlist', /Make your family code stronger/));
  await design(PP, '#ac-famcard', 'the card for what the family decides');
  await wide(PP, 'the Family tab');
  await PP.click('#ac-famlist [data-acadult="' + M.Tara.memberId + '"]');
  ok('family: Papa says yes, and the question goes', await PP.waitForFunction(() => !/Is Tara an adult/.test(document.getElementById('ac-famlist').textContent), null, T).then(() => true, () => false)
    && (await q1('select adult_confirmed from members where id = $1', [M.Tara.memberId])).adult_confirmed === true);
  // A stronger code.
  await PP.click('#ac-famlist [data-acfam="code"]'); await shown(PP, '#cc-code');
  await PP.fill('#cc-code', 'VERMAFAM'); await PP.click('#cc-save');
  ok('family code: 8 letters with no number is refused, with what to do', await toastSays(PP, /at least one number/));
  await PP.fill('#cc-code', 'VERMA2026'); await PP.click('#cc-save');
  ok('family code: a code of 8 or more with a number is saved', await sees(PP, '#p-code', /VERMA2026/) && !!(await q1(`select 1 as x from circles where code = 'VERMA2026'`)));
  for (const k of Object.keys(M)) M[k].code = 'VERMA2026';
  await PP.click('[data-tab="home"]').catch(() => {}); await PP.evaluate(() => { location.hash = '#people'; });
  ok('family code: and the card goes', await PP.waitForFunction(() => !/Make your family code stronger/.test(document.getElementById('ac-famlist').textContent), null, T).then(() => true, () => false));

}
await PM.close();
const PM2 = await open(M.Maa, '#people');
{
  // Letting the code be enough: Papa asks, Maa answers.
  await PP.click('#jp-toggle'); await confirmSheet(PP);
  ok('how people join: one adult asking is told another adult has to say yes', await toastSays(PP, /Another adult in the family has to say yes/) && (await q1('select join_policy from circles where id = $1', [circleId])).join_policy === 'approve');
  await PM2.evaluate(() => { location.hash = '#home'; }); await PM2.evaluate(() => { location.hash = '#people'; });
  await PM2.click('[data-tab="people"]').catch(() => {});
  ok('how people join: the other adult is asked, with who asked', await sees(PM2, '#ac-famlist', /Papa asks to let the code be enough/));
  await design(PM2, '#ac-famcard', 'a question for the second adult');
  await PM2.click('#ac-famlist [data-acyes]');
  ok('how people join: her yes opens the door', await PM2.waitForFunction(() => /Anyone with the code joins straight away/.test(document.getElementById('jp-state').textContent), null, T).then(() => true, () => false)
    && (await q1('select join_policy from circles where id = $1', [circleId])).join_policy === 'open');
  await call(circleApi, { token: M.Maa.token, body: { action: 'set_join_policy', code: 'VERMA2026', memberId: M.Maa.memberId, policy: 'approve' } });
}
{
  const PA = await open(M.Aarav, '#people');
  await sees(PA, '#jp-state', /adult already in the family/);
  ok('a child: no button to change how people join, none to change the code', await PA.isHidden('#jp-toggle') && await PA.isHidden('#code-edit'));
  ok('a child: no card of things to decide', await PA.isHidden('#ac-famcard'));
  await PA.evaluate(() => { location.hash = '#profile'; }); await shown(PA, '#ac-devcard');
  ok('a child: no "Delete this family"', await PA.isHidden('#ac-famdel'));
  await PA.close();
}

// =========================================================== 3. "This is me", and what the family wrote
{
  const chacha = await user('Chacha ji');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
  }, [chacha]);
  const C = await ctx.newPage();
  C.on('pageerror', e => errors.push('Chacha: ' + e.message));
  await C.goto(BASE + '/');
  await shown(C, '#setup-step'); await C.click('#pk-join'); await shown(C, '#j-code');
  ok('joining: "This is me" is offered, in plain words', await sees(C, '#joincard', /This is me: my family already added me by name/));
  await design(C, '#joincard', 'the join card');
  await C.fill('#j-code', 'VERMA2026'); await C.fill('#j-name', 'Chacha'); await C.check('#ac-jclaim');
  await C.click('#j-go');
  ok('this is me: he waits for the family, and is not told "someone is already called Chacha"', await shown(C, '#pending-step') && !/already called/.test(await C.textContent('#onboard')));
  // Papa sees who it says it is, and lets him in as that profile.
  await PP.evaluate(() => { location.hash = '#home'; }); await PP.evaluate(() => { location.hash = '#people'; });
  ok('this is me: the adult is shown which profile he says he is', await shown(PP, '#joinreqs [data-acclaim]') && await PP.$eval('#joinreqs [data-acclaim]', s => s.value) === chachaM);
  await design(PP, '#joinreq-card', 'a request that says "this is me"');
  await PP.click('#joinreqs [data-jok]');
  ok('this is me: a yes joins him to the profile the family wrote, not a second one', await PP.waitForFunction(() => document.getElementById('joinreq-card').hidden, null, T).then(() => true, () => false)
    && (await q1('select user_id from members where id = $1', [chachaM])).user_id === chacha.userId
    && (await admin.query(`select 1 from members where circle_id = $1 and lower(name) = 'chacha'`, [circleId])).rows.length === 1);
  await C.click('#pend-check');
  ok('what the family wrote: on his first visit he is shown it', await shown(C, '#ac-claimsheet') && await sees(C, '#ac-claimlist', /Kanpur/) && await sees(C, '#ac-claimlist', /1962-04-10/));
  await design(C, '#ac-claimsheet', 'what your family wrote about you');
  await C.selectOption('#ac-claimlist [data-acitem="dob"]', 'hide');
  await C.selectOption('#ac-claimlist [data-acitem="place"]', 'delete');
  await C.click('#ac-claim-save');
  ok('what the family wrote: keep, hide and delete are saved', await gone(C, '#ac-claimsheet')
    && await C.waitForFunction(() => true).then(async () => { const m = await q1('select place, dob, hidden_fields, claim_review from members where id = $1', [chachaM]); return m.place === null && !!m.dob && m.hidden_fields.join() === 'dob' && m.claim_review === false; }));
  await ctx.close();
}

// =========================================================== 4. a forgotten PIN: the two numbers, on a real call
{
  // Rohan is signed out everywhere, on the one phone he has.
  await admin.query('delete from sessions where user_id = $1', [U.Rohan.userId]);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const F = await ctx.newPage();
  F.on('pageerror', e => errors.push('forgot: ' + e.message));
  await F.goto(BASE + '/'); await shown(F, '#auth-step');
  await F.fill('#au-phone', U.Rohan.phone.slice(3)); await F.click('#au-go'); await shown(F, '#au-pin');
  ok('forgot: the way back is there before a wrong try', await F.isVisible('#au-forgot') && /never set one/.test(await F.textContent('#au-forgot')));
  await F.click('#au-forgot'); await confirmSheet(F);
  ok('forgot: the phone waits, and shows two numbers to read out', await shown(F, '#ac-rs-code') && /^\d \d$/.test((await F.textContent('#ac-rs-code')).trim()) && await sees(F, '#au-rs-msg', /^Asked\. Waiting for someone in your family/));
  await design(F, '#auth-step', 'waiting to be let back in');
  const said = (await F.textContent('#ac-rs-code')).replace(/\s/g, '');
  // Papa's Today shows it. Without the numbers nothing happens.
  await PP.evaluate(() => { location.hash = '#home'; }); await PP.reload(); await inApp(PP);
  ok('let back in: the adult is asked, and told to call', await shown(PP, '#pinresets [data-resetcode]') && await sees(PP, '#pinresets', /Rohan cannot get in/) && await sees(PP, '#pinresets', /two numbers/));
  await design(PP, '#pinresets', 'the card that lets someone back in');
  await PP.click('#pinresets [data-resetok]');
  ok('let back in: a yes with no numbers is stopped on the phone', await toastSays(PP, /type the two numbers/));
  await PP.fill('#pinresets [data-resetcode]', said === '11' ? '12' : '11');
  await PP.click('#pinresets [data-resetok]'); await confirmSheet(PP);
  ok('let back in: the wrong two numbers are refused by the server', await toastSays(PP, /not the two numbers on their screen/) && (await q1(`select status from pin_resets where user_id = $1 order by created_at desc limit 1`, [U.Rohan.userId])).status === 'pending');
  await PP.fill('#pinresets [data-resetcode]', said);
  await PP.click('#pinresets [data-resetok]'); await confirmSheet(PP);
  ok('let back in: the right two numbers, and Papa has let him in', await toastSays(PP, /can choose a new PIN now/));
  // Rohan had no phone signed in, so there is nothing to wait for.
  await F.click('#au-rs-check').catch(() => {});
  ok('forgot: the yes reaches the phone that asked: choose a new PIN', await shown(F, '#au-pin2') && await sees(F, '#au-pinnote', /family said yes/));
  await F.fill('#au-pin', '5927'); await F.fill('#au-pin2', '5927'); await F.click('#au-go');
  ok('forgot: and he is back, at the list of his families', await shown(F, '#circle-step') && await sees(F, '#cs-list', /Verma Family/));
  await ctx.close();
}

// =========================================================== 5. removing someone: two adults
{
  await PP.evaluate(() => { location.hash = '#people'; }); await PP.waitForSelector('#pane-people [data-mprof="' + M.Tara.memberId + '"]', T);
  await sees(PP, '#jp-state', /adult/);
  await PP.click('#pane-people [data-mprof="' + M.Tara.memberId + '"]'); await shown(PP, '#msheet');
  ok('remove: an adult is offered it on the page of someone who is on Parwah', await shown(PP, '#ac-mp-remove'));
  await design(PP, '#msheet', 'a member page with "Remove from this family"');
  await PP.click('#ac-mp-remove'); await confirmSheet(PP);
  ok('remove: one adult asking is told another has to agree', await toastSays(PP, /Another adult has to agree/) && !!(await q1('select 1 as x from members where id = $1', [M.Tara.memberId])));
  await PP.click('#pane-people [data-mprof="' + M.Papa.memberId + '"]'); await shown(PP, '#msheet');
  ok('remove: nobody is offered it about themselves', await PP.isHidden('#ac-mp-remove'));
  await PP.click('#mp-x');
  const PT = await open(M.Tara, '#people');
  await sees(PT, '#jp-state', /adult/);
  ok('remove: the person it is about is not shown the request', !/remove Tara/i.test(await PT.textContent('#ac-famlist')));
  await PM2.evaluate(() => { location.hash = '#home'; }); await PM2.evaluate(() => { location.hash = '#people'; });
  ok('remove: the second adult is asked', await sees(PM2, '#ac-famlist', /Papa asks to remove Tara/));
  await PM2.click('#ac-famlist [data-acyes]');
  ok('remove: she agrees, and Tara is no longer in the family', await PM2.waitForFunction((id) => !document.querySelector('#pane-people [data-mprof="' + id + '"]'), M.Tara.memberId, T).then(() => true, () => false)
    && !(await q1('select 1 as x from members where id = $1', [M.Tara.memberId])));
  await PT.close();
}

// =========================================================== 6. a change to my place in the tree
{
  r = await call(circleApi, { token: M.Rohan.token = (await call(HANDLERS.auth, { body: { action: 'enter', phone: U.Rohan.phone.slice(3), cc: '+91', pin: '5927' } })).token,
    body: { action: 'place', code: 'VERMA2026', memberId: M.Rohan.memberId, targetId: M.Maa.memberId, place: 'spouse', ofId: M.Papa.memberId, gender: 'f', ofGender: 'm' } });
  await PM2.evaluate(() => { location.hash = '#home'; }); await PM2.evaluate(() => { location.hash = '#people'; });
  ok('tree: Maa is told Rohan changed her place, with one button', r.status === 200 && await sees(PM2, '#ac-famlist', /Rohan changed your place in the family tree/) && await shown(PM2, '#ac-famlist [data-acundo]'));
  await design(PM2, '#ac-famcard', 'undo a change to my place in the tree');
  await PM2.click('#ac-famlist [data-acundo]');
  ok('tree: one tap puts it back', await toastSays(PM2, /back as it was/) && (await q1('select spouse_id from members where id = $1', [M.Maa.memberId])).spouse_id === null);
}

// =========================================================== 7. Profile: devices, who sees what, recovery, activity, my data
{
  await PM2.evaluate(() => { location.hash = '#profile'; });
  ok('devices: this phone is listed, and marked', await sees(PM2, '#ac-devs', /this one/) && await sees(PM2, '#ac-devs', /First seen/));
  ok('devices: "Sign out everywhere" has a button now', await PM2.isVisible('#ac-outall'));
  await PM2.selectOption('#ac-seephone', 'adults');
  ok('who sees my details: "Only adults" is saved for this family', await toastSays(PM2, /Saved/) && (await q1('select see_phone from members where id = $1', [M.Maa.memberId])).see_phone === 'adults');
  ok('who sees my details: it says the choice is per family', await sees(PM2, '#ac-seehint', /Verma Family/));
  await PM2.selectOption('#ac-recpick', { label: 'Papa · Verma Family' });
  await PM2.click('#ac-recsave');
  ok('recovery contact: Papa is chosen', await sees(PM2, '#ac-recnow', /Papa can let you back in/) && (await q1('select recovery_user from users where id = $1', [U.Maa.userId])).recovery_user === U.Papa.userId);
  await PM2.click('#ac-actshow');
  ok('my activity: what was changed about me is listed', await sees(PM2, '#ac-act', /Rohan changed your place in the family tree/) && await sees(PM2, '#ac-act', /recovery contact/));
  await PM2.click('#ac-export');
  ok('my data: two files are offered, a readable page and the data', await shown(PM2, '#ac-exhtml') && /^blob:/.test(await PM2.getAttribute('#ac-exhtml', 'href')) && /^blob:/.test(await PM2.getAttribute('#ac-exjson', 'href')));
  for (const id of ['#ac-devcard', '#ac-seecard', '#ac-reccard', '#ac-actcard', '#ac-datacard']) await design(PM2, id, 'Profile ' + id);
  await wide(PM2, 'Profile');
  // Delete my account: the PIN again, 7 days, and a way back.
  await PM2.click('#ac-del'); await shown(PM2, '#ac-delsheet');
  await design(PM2, '#ac-delsheet', 'delete my account');
  await PM2.fill('#ac-del-pin', '0000'); await PM2.click('#ac-del-yes');
  ok('delete my account: a wrong PIN is refused, and nothing is set', await sees(PM2, '#ac-del-err', /not right/) && (await q1('select delete_at from users where id = $1', [U.Maa.userId])).delete_at === null);
  await PM2.fill('#ac-del-pin', '4819'); await PM2.click('#ac-del-yes');
  ok('delete my account: with the PIN it is set for 7 days from now, and says so', await gone(PM2, '#ac-delsheet') && await sees(PM2, '#ac-deltxt', /will be deleted on/)
    && Math.abs((new Date((await q1('select delete_at from users where id = $1', [U.Maa.userId])).delete_at) - Date.now()) / 86400000 - 7) < 0.01);
  await PM2.evaluate(() => { location.hash = '#home'; });
  ok('delete my account: Today says it too, with "Keep my account"', await sees(PM2, '#ac-sec', /Your account will be deleted on/) && await shown(PM2, '#ac-sec [data-ackeep]'));
  await design(PM2, '#ac-sec', 'the account notices on Today');
  await PM2.click('#ac-sec [data-ackeep]');
  ok('delete my account: one tap keeps it', await toastSays(PM2, /Your account stays/) && (await q1('select delete_at from users where id = $1', [U.Maa.userId])).delete_at === null);
}

// =========================================================== 8. a new phone, and "Not me"
{
  // Someone signs in as Maa on a phone Parwah has not seen.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const N = await ctx.newPage();
  N.on('pageerror', e => errors.push('new phone: ' + e.message));
  await N.goto(BASE + '/'); await shown(N, '#auth-step');
  await N.fill('#au-phone', U.Maa.phone.slice(3)); await N.click('#au-go'); await shown(N, '#au-pin');
  await N.fill('#au-pin', '4819'); await N.click('#au-go');
  ok('new phone: it is let in at once, nothing waits for an approval', await shown(N, '#circle-step').then(v => v || inApp(N)));
  await PM2.reload(); await inApp(PM2);
  ok('new phone: Maa\'s own phone asks "Was this you?"', await sees(PM2, '#ac-sec', /New sign-in on another phone/) && await sees(PM2, '#ac-sec', /Was this you\?/));
  await design(PM2, '#ac-sec', 'the new sign-in card');
  await PM2.click('#ac-sec [data-acnotme]'); await confirmSheet(PM2);
  ok('not me: her phone asks for a new PIN, and says why', await shown(PM2, '#auth-step') && await sees(PM2, '#au-pinnote', /new sign-in was not you/));
  ok('not me: the other phone is signed out', !(await q1(`select 1 as x from sessions s join user_devices d on d.device_hash = s.device_hash and d.user_id = s.user_id where s.user_id = $1`, [U.Maa.userId])));
  await PM2.fill('#au-pin', '4819'); await PM2.click('#au-go');
  await sees(PM2, '#au-pinnote', /different from the old one/);
  await PM2.fill('#au-pin', '4819'); await PM2.fill('#au-pin2', '4819'); await PM2.click('#au-go');
  ok('not me: the old PIN again is not a new PIN', await sees(PM2, '#ob-err', /different PIN/));
  await PM2.fill('#au-pin', '6385'); await PM2.fill('#au-pin2', '6385'); await PM2.click('#au-go');
  ok('not me: a new PIN, and she is back in', await shown(PM2, '#circle-step').then(v => v || inApp(PM2)));
  await ctx.close();
}

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`standing.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`standing.e2e: ${pass}/${pass} checks pass`);
