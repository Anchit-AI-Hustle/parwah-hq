// BEING HEARD, AND ANSWERED, END TO END: a real browser, the real API and a
// real PostgreSQL.
//
// The Sharma family: Rohan and Meena, Papa (in senior mode), Kabir who is
// 13, Dadi who is not on the app, and Dadaji, who is remembered, on his day.
// Meena says how she feels and it stays hers until she chooses who to tell.
// She sends Rohan "Mujhe baat karni hai"; he answers; Papa's phone shows
// nothing of it. Rohan thanks Dadi and it is kept for her. The family
// answers the week's question, and adds to Dadaji's memory card. "Maaf
// karna" goes from a person's page and from a 1:1 chat. In the chat: earlier
// messages, delete my own, mute, a secret ballot, a vote for Dadi, one
// reminder. A date poll shows the host the tally before the lock. Festivals
// change one tap at a time. Papa says thank you for his card; Dadi's card is
// laid out to show or print. A story is heard; one is recorded for Dadi. A
// photo takes a reaction. Dadi's likes are noted, with who wrote them.
//
// Every new surface is measured like every other screen: 44px targets, a
// 12px floor, AA contrast in light and dark, nothing sideways at 320 or 390
// (and Today at 1280). Nothing here waits a fixed time and then looks: each
// step waits for the element or the state it is about to check.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('heard.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('heard.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('heard.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'plans', 'book', 'games']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { wallIn } = await import('../../../api/_rememberrules.mjs');
await ensureSchema(db());

let n = 0;
async function user(name) {
  const phone = '+9198740' + String(++n).padStart(5, '0');
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
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() { return this; }, end() { return this; } };
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
    const w = { status(s) { res.statusCode = s; return this; }, json(j) { res.end(JSON.stringify(j)); return this; }, setHeader(k, v) { res.setHeader(k, v); return this; }, end(x) { res.end(x); return this; } };
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

async function phone(who, { scheme = 'light', width = 390, hash = '#home', big = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', colorScheme: scheme });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.id, name: w.name, role: w.role || 'family', circleName: 'Sharma Family' }));
    if (w.big) localStorage.setItem('parwah-big', '1');
  }, [{ ...who, big }]);
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

// ---- the Sharma family, seated straight in the database
const { wallIn: wallNow } = await import('../../../api/_rememberrules.mjs');
const Bond = await import('../../../api/_bond.mjs');
await call(HANDLERS.plans, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });
await call(HANDLERS.book, { method: 'GET', query: { area: 'bond', circle: 'NOPE00', member: 'x' } });
await call(HANDLERS.chats, { method: 'GET', query: { area: 'heard', circle: 'NOPE00', member: 'x' } });
await Bond.ensureBondSchema(db());
await (await import('../../../api/_remember.mjs')).ensureRememberSchema(db());
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
async function seat(name, role = 'family', dob = null, onApp = true) {
  const u = onApp ? await user(name) : { name };
  const m = (await admin.query(`insert into members (circle_id, name, user_id, role, dob) values ($1,$2,$3,$4,$5) returning id`, [fam, name, u.userId || null, role, dob])).rows[0];
  return { ...u, id: m.id, code: 'SHARMA', role };
}
const rohan = await seat('Rohan', 'family', '1988-03-04'), meena = await seat('Meena', 'family', '1990-07-09');
const papa = await seat('Papa', 'parent', '1958-01-20'), kabir = await seat('Kabir', 'family', '2013-05-05');
const dadi = await seat('Dadi', 'parent', '1936-02-02', false), dadaji = await seat('Dadaji', 'parent', '1930-01-01', false);
const today = wallNow(Date.now(), 'Asia/Kolkata').date;
await admin.query(`update members set remembered = true, passed_year = 2019, passed_month = $2, passed_day = $3 where id = $1`, [dadaji.id, +today.slice(5, 7), +today.slice(8, 10)]);
const q1 = async (text, p) => (await admin.query(text, p)).rows[0];
const api = (who, handler, body, query) => call(HANDLERS[handler], { token: who.token, body: { code: 'SHARMA', memberId: who.id, ...body }, query: query || {} });
const heard = (who, action, body) => api(who, 'chats', { area: 'heard', action, ...(body || {}) });
const reloadHome = async (page) => { await page.reload(); await page.waitForSelector('#hd-today [data-hdmood]', T); };
const toastSays = (page, re) => sees(page, '#toast', re);
const wide = async (page, sel, label) => {
  const was = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => innerWidth === 1280, null, T);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await page.evaluate(measureIn, sel);
  ok('design: ' + label + ' at 1280 - nothing sideways, 12px floor, AA contrast', m.overflow <= 0 && m.inner <= 1 && !m.bad.some(b => /tiny|contrast|off the side/.test(b)), m.overflow + ' ' + m.inner + ' ' + m.bad.slice(0, 4).join(' | '));
  await page.setViewportSize(was); await page.waitForFunction((w) => innerWidth === w, was.width, T);
};

// ================================================================ 1. the mood card
const M = await phone(meena);
ok('1. Today asks "Aaj kaisa lag raha hai?"', await sees(M, '#hd-today', /Aaj kaisa lag raha hai\?/));
const moodWords = await M.$$eval('#hd-today [data-hdmood]', bs => bs.map(b => b.textContent.trim()));
ok('1. five big choices, each a word next to its emoji (never an emoji alone)', moodWords.length === 5 && moodWords.every(t => /[A-Za-z]{4,}/.test(t)) && /Mann udaas hai/.test(moodWords.join('|')) && /A bit low/.test(moodWords.join('|')), moodWords.join(' | '));
ok('1. before she answers, it says only she sees it', await sees(M, '#hd-today', /Only you see your answer/));
await design(M, '#hd-today', 'the Today cards (mood, shukriya, weekly question, memory card)');
await wide(M, '#hd-today', 'the Today cards');
await M.click('#hd-today [data-hdmood="udaas"]');
ok('1. she taps "Mann udaas hai": it is saved, kept to herself', await sees(M, '#hd-today', /Kept to yourself\. Nobody else can see it\./) && await toastSays(M, /Only you can see it/));
ok('1. the choice of who to tell is there, with "Keep to myself" chosen', await M.$eval('#hd-today [data-hdtell="self"]', b => b.getAttribute('aria-pressed')) === 'true'
  && (await M.$$eval('#hd-today [data-hdtell]', bs => bs.map(b => b.textContent.trim()))).join('|') === '🔒 Keep to myself|👤 Tell only...|👪 Tell the family');
ok('1. the database kept it private, and the family feed has nothing', (await q1('select tell from pulse where member_id = $1', [meena.id])).tell === 'self' && (await q1('select count(*)::int as n from events where circle_id = $1', [fam])).n === 0);
const R = await phone(rohan);
await R.waitForSelector('#hd-today [data-hdmood]', T);
ok('1. Rohan\'s Today shows nothing about how Meena feels', !(await R.$('#hd-today .hdline')) && !/Meena/.test(await R.textContent('#hd-today .hdcard')));
await M.click('#hd-today [data-hdtell="one"]');
await shown(M, '#hd-m-to');
await design(M, '#mbsheet', 'the "tell only one person" sheet');
await M.selectOption('#hd-m-to', rohan.id); await M.click('#hd-m-save');
ok('1. "Tell only..." Rohan', await sees(M, '#hd-today', /You told only Rohan\./) && (await q1('select tell, to_member from pulse where member_id = $1', [meena.id])).to_member === rohan.id);
await reloadHome(R);
ok('1. now Rohan, and only Rohan, sees it, in words', await sees(R, '#hd-today .hdline', /Meena.*Mann udaas hai \(A bit low\)\. A call would be nice\./));
const PP = await phone(papa, { big: true, width: 320 });
await PP.waitForSelector('#hd-today [data-hdmood]', T);
ok('1. Papa does not see it', !(await PP.$('#hd-today .hdline')));
ok('1. still nothing on the family feed', (await q1('select count(*)::int as n from events where circle_id = $1', [fam])).n === 0);
ok('1. SENIOR MODE gets the mood card too, with bigger choices', await PP.evaluate(() => document.body.classList.contains('senior'))
  && (await PP.$$eval('#hd-today [data-hdmood]', bs => Math.min(...bs.map(b => b.getBoundingClientRect().height)))) >= 56);
await design(PP, '#hd-today', 'the Today cards in senior mode');

// ================================================================ 2. a private word
await M.click('#hd-today [data-hdbaat="talk|"]');
await shown(M, '#hd-b-to');
ok('2. the sheet says who will see it, and only people on Parwah can be chosen', await sees(M, '#mbs-body', /Only the one person you choose will see this\. Not the family, not the feed, not Ekta\./)
  && (await M.$$eval('#hd-b-to option', os => os.map(o => o.textContent))).join() === 'Rohan,Papa,Kabir');
ok('2. three things to say, in words', (await M.$$eval('#hd-b-kind button', bs => bs.map(b => b.textContent.trim()))).join('|') === '🫶 Mujhe baat karni hai|🙏 Maaf karna|🤝 Can we talk?');
await design(M, '#mbsheet', 'the private word sheet');
await M.selectOption('#hd-b-to', rohan.id);
await M.fill('#hd-b-line', 'Kal ki baat par thoda bura laga'); await M.fill('#hd-b-when', 'After dinner');
await M.click('#hd-b-send');
ok('2. Meena sends "Mujhe baat karni hai" to Rohan', await toastSays(M, /Only Rohan can see it/) && await sees(M, '#hd-today', /You told Rohan: Mujhe baat karni hai/));
await reloadHome(R);
ok('2. Rohan sees it on Today, with three ways to answer in words', await sees(R, '#hd-today', /Only you and Meena can see this/) && await sees(R, '#hd-today', /Meena: Mujhe baat karni hai \(I need to talk\)/)
  && await sees(R, '#hd-today', /Kal ki baat par thoda bura laga After dinner/)
  && (await R.$$eval('#hd-today [data-hdbreply]', bs => bs.map(b => b.textContent.trim()))).join('|') === '📞 I will call you at...|🫶 Aao, baat karte hain (Come, let us talk)|🎙 Answer by voice');
await design(R, '#hd-today', 'Today with a private word to answer');
await reloadHome(PP);
ok('2. PAPA\'S PHONE SHOWS NOTHING OF IT', !/bura laga|baat karni hai:|Only you and/.test(await PP.textContent('#hd-today')));
ok('2. it is not on the feed', (await q1('select count(*)::int as n from events where circle_id = $1', [fam])).n === 0);
await R.click('#hd-today [data-hdbreply^="call|"]');
await shown(R, '#hd-r-at'); await R.fill('#hd-r-at', '7 this evening'); await R.click('#hd-r-send');
ok('2. Rohan answers "I will call you at 7 this evening"', await toastSays(R, /Answered/) && await sees(R, '#hd-today', /You answered:.*I will call you at 7 this evening/));
await reloadHome(M);
ok('2. Meena reads his answer', await sees(M, '#hd-today', /Rohan answered:.*I will call you at 7 this evening/));
await M.click('#hd-today [data-hdbclose]');
ok('2. she puts it away, and it is gone from both', await M.waitForFunction(() => !document.querySelector('#hd-today [data-hdbclose]'), null, T).then(() => true, () => false));

// ================================================================ 3. shukriya
const promptTo = await R.$eval('#hd-today [data-hdshuk]', b => b.getAttribute('data-hdshuk')).catch(() => null);
ok('3. Rohan is quietly offered someone to thank: never himself, never Dadaji, and no count on the card', !!promptTo && promptTo !== rohan.id && promptTo !== dadaji.id
  && await sees(R, '#hd-today', /Is there something to thank \w+ for\?/) && !/\d/.test((await R.$eval('#hd-today [data-hdshuk]', b => b.closest('.mbcard').textContent))));
await R.click('#hd-today [data-hdshuk]');
await shown(R, '#hd-s-to');
ok('3. anyone in the family can be thanked, on Parwah or not; never someone remembered', (await R.$$eval('#hd-s-to option', os => os.map(o => o.textContent))).join() === 'Meena,Papa,Kabir,Dadi (not on Parwah)');
ok('3. private to the two unless the writer chooses the family', await R.$eval('#hd-s-aud [data-hdsa="two"]', b => b.getAttribute('aria-pressed')) === 'true');
await design(R, '#mbsheet', 'the shukriya sheet');
await R.selectOption('#hd-s-to', dadi.id); await R.fill('#hd-s-line', 'Thank you for the lori you sang to Kabir');
await R.click('#hd-s-send');
ok('3. thanking Dadi, who is not on Parwah: it is kept, to read out or share', await sees(R, '#mbs-title', /Kept for Dadi/) && await sees(R, '#hd-s-kept', /lori you sang to Kabir/) && await shown(R, '#hd-s-share'));
await R.click('#hd-s-ok');
ok('3. it is in the database for the day she joins, private to the two', (await q1('select audience, to_member from shukriya where from_member = $1', [rohan.id])).audience === 'two');
await M.click('#hd-today [data-hdshuk]').catch(() => {});
if (await shown(M, '#hd-s-to')) {
  await M.selectOption('#hd-s-to', papa.id); await M.fill('#hd-s-line', 'Papa, thank you for the chai every morning'); await M.click('#hd-s-aud [data-hdsa="family"]'); await M.click('#hd-s-send');
  ok('3. Meena thanks Papa and shows the family', await toastSays(M, /Shukriya sent/));
  await reloadHome(PP);
  ok('3. Papa sees it on Today', await sees(PP, '#hd-today', /Meena says shukriya to you/) && await sees(PP, '#hd-today', /chai every morning/));
} else ok('3. Meena opens the shukriya sheet', false);

// ================================================================ 6. the weekly question
await heard(meena, 'sawaal_answer', { text: 'Aloo paratha with white butter' });
await reloadHome(R);
ok('6. Rohan has the family\'s question, and is told he reads the others after answering', await sees(R, '#hd-today', /This week, for the whole family/i) && await sees(R, '#hd-today', /You read the others once you have answered/));
ok('6. Meena\'s answer is not on his screen yet', !/Aloo paratha/.test(await R.textContent('#hd-today')));
await R.click('#hd-today [data-hdsawaal="type"]');
await shown(R, '#hd-q-text'); await R.fill('#hd-q-text', 'Rajma chawal on a Sunday'); await R.click('#hd-q-send');
ok('6. once he answers, he reads Meena\'s, and who is still to answer', await sees(R, '#hd-today', /Aloo paratha with white butter/) && await sees(R, '#hd-today', /Waiting for Papa and Kabir/));
await R.click('#hd-today [data-hdsawaal="for"]');
await shown(R, '#hd-q-for');
ok('6. he can answer for Dadi, who is not on Parwah (never for Dadaji)', (await R.$$eval('#hd-q-for option', os => os.map(o => o.textContent))).join() === 'Dadi');
await R.fill('#hd-q-text', 'Besan ke laddu, always'); await R.click('#hd-q-send');
ok('6. it shows both names: "told by Dadi, recorded by Rohan"', await sees(R, '#hd-today', /Besan ke laddu, always\s*\(told by Dadi, recorded by Rohan\)/));
await design(R, '#hd-today', 'Today with the weekly answers');

// ================================================================ 12. the memory card
ok('12. Dadaji\'s day of remembrance opens a memory card on Today', await sees(M, '#hd-today', /A memory card, together/i) && await sees(M, '#hd-today', /Today is Dadaji's day of remembrance/));
await M.click('#hd-today [data-hdrc^="text|"]');
await shown(M, '#hd-c-text'); await M.fill('#hd-c-text', 'Dadaji ki chai aur unki kahaniyan'); await M.click('#hd-c-send');
ok('12. Meena adds a line', await sees(M, '#hd-today', /Dadaji ki chai aur unki kahaniyan/));
await reloadHome(R);
ok('12. Rohan reads it on the same card, and can add his own', await sees(R, '#hd-today', /Dadaji ki chai aur unki kahaniyan/) && await sees(R, '#hd-today', /From Meena/) && await shown(R, '#hd-today [data-hdrc^="voice|"]'));

// ================================================================ 7. sorry, from a person's page and from a 1:1 chat
await R.evaluate((id) => { const b = document.createElement('button'); b.setAttribute('data-person', id); b.id = 'tmp-open'; b.textContent = 'open'; document.body.appendChild(b); b.click(); b.remove(); }, meena.id);
ok('7. on Meena\'s page: shukriya, and three private words, each in words', await shown(R, '#hd-person') && (await R.$$eval('#hd-person button', bs => bs.map(b => b.textContent.trim()))).join('|') === '🙏 Say shukriya|🫶 Mujhe baat karni hai|🙏 Maaf karna|🤝 Can we talk?');
await design(R, '#hd-person', 'the "say it" card on a person\'s page');
await R.click('#hd-person [data-hdbaat^="sorry|"]');
await shown(R, '#hd-b-send');
ok('7. "Maaf karna" opens ready, for Meena', await R.$eval('#hd-b-to', s => s.value) === meena.id && await R.$eval('#hd-b-kind .sel', b => b.textContent.trim()) === '🙏 Maaf karna');
await R.click('#hd-b-send');
ok('7. one tap sends it, privately', await toastSays(R, /Only Meena can see it/) && (await q1(`select count(*)::int as n from baat where kind = 'sorry' and from_member = $1 and to_member = $2`, [rohan.id, meena.id])).n === 1);
await reloadHome(M);
ok('7. Meena sees "Maaf karna" from Rohan', await sees(M, '#hd-today', /Rohan: Maaf karna \(I am sorry\)/));
await M.click('#hd-today [data-hdbreply^="come|"]');
ok('7. she answers "Aao, baat karte hain"', await sees(M, '#hd-today', /You answered:.*Aao, baat karte hain/));

// ================================================================ 8. chat: earlier messages, delete, mute; 5. a secret ballot
const dm = await api(rohan, 'chats', { action: 'open_dm', otherId: meena.id });
const famChat = (await call(HANDLERS.chats, { method: 'GET', token: rohan.token, query: { circle: 'SHARMA', member: rohan.id } })).chats.find(c => c.kind === 'circle').id;
await admin.query(`insert into messages (chat_id, member_id, text, created_at) select $1, $2, 'old ' || g, now() - interval '3 hours' + make_interval(secs => g) from generate_series(1, 70) g`, [famChat, papa.id]);
await api(rohan, 'chats', { action: 'send', chatId: famChat, text: 'Oops, wrong chat' });
await R.evaluate(() => { location.hash = '#chat'; });
await R.waitForSelector('#chatlist [data-open]', T);
await R.click('#chatlist [data-open="' + famChat + '"]');
await R.waitForSelector('#cmsgs .em[data-mid]', T);
ok('8. the chat opens on the newest 50, with "Earlier messages" at the top', (await R.$$('#cmsgs .em[data-mid]')).length === 50 && await shown(R, '#hd-earlier'));
await R.click('#hd-earlier');
ok('8. tapping it brings the older ones in, above', await R.waitForFunction(() => document.querySelectorAll('#cmsgs .em[data-mid]').length === 71, null, T).then(() => true, () => false)
  && !(await R.$('#hd-earlier')), String((await R.$$('#cmsgs .em[data-mid]')).length));
await design(R, '#chatview', 'the chat, with its header and "More"');
const lastMid = await R.$$eval('#cmsgs .em.u[data-mid]', es => es[es.length - 1].getAttribute('data-mid'));
await R.click('#cmsgs .em[data-mid="' + lastMid + '"] [data-rx]');
await shown(R, '#rx-who [data-hddelmsg]');
ok('8. my own message offers "Delete my message", in words', /Delete my message/.test(await R.textContent('#rx-who [data-hddelmsg]')));
await design(R, '#rxsheet', 'the reaction sheet with delete');
await R.click('#rx-who [data-hddelmsg]'); await shown(R, '#as-yes'); await R.click('#as-yes');
ok('8. it is deleted for everyone', await R.waitForFunction((id) => !document.querySelector('#cmsgs .em[data-mid="' + id + '"]'), lastMid, T).then(() => true, () => false)
  && (await q1('select count(*)::int as n from messages where id = $1', [lastMid])).n === 0);
const papaMid = await R.$$eval('#cmsgs .em.a[data-mid]', es => es[es.length - 1].getAttribute('data-mid'));
await R.click('#cmsgs .em[data-mid="' + papaMid + '"] [data-rx]'); await shown(R, '#rx-row');
ok('8. someone else\'s message offers no delete', !(await R.$('#rx-who [data-hddelmsg]')));
await R.click('#rx-x');
await R.click('#hd-cv-more'); await shown(R, '#hd-mute');
await design(R, '#mbsheet', 'the "More for this chat" sheet');
await R.click('#hd-mute');
ok('8. mute this chat, for me', await toastSays(R, /Muted for you/) && await sees(R, '#hd-cv-more', /Muted/) && (await q1('select count(*)::int as n from chat_mutes where chat_id = $1 and member_id = $2', [famChat, rohan.id])).n === 1);
// A secret ballot, asked from the chat.
await R.click('#cv-poll'); await shown(R, '#pl-q');
await R.fill('#pl-q', 'Where for the summer holidays?');
const ins = await R.$$('#pl-opts input'); await ins[0].fill('Shimla'); await ins[1].fill('Goa');
await R.check('#hd-pl-secret');
await design(R, '#pollsheet', 'the poll sheet with the secret ballot choice');
await R.click('#pl-create');
await R.waitForSelector('#cmsgs .pl', T);
const pollId = (await q1('select id, secret from chat_polls order by created_at desc limit 1')).id;
await api(meena, 'chats', { action: 'poll_vote', chatId: famChat, pollId, choices: [1] });
await api(kabir, 'chats', { action: 'poll_vote', chatId: famChat, pollId, choices: [1] });
await R.click('#cmsgs .pl [data-plvote][data-i="0"]');
// While a secret ballot is open no count is shown at all (a count that moves
// beside "Waiting for Papa" gives a vote away): how many have voted, who is
// still to vote, and the words that say why.
ok('5. a secret ballot, while open: "3 of N have voted", "Waiting for Papa", no counts and no "Who voted"', await sees(R, '#cmsgs .pl', /counts stay hidden until the poll closes/) && await sees(R, '#cmsgs .pl', /Waiting for Papa/)
  && await sees(R, '#cmsgs .pl', /3 of \d+ have voted/) && !(await R.$('#cmsgs .pl [data-plwho]')) && !(await R.$('#cmsgs .pl .pl-n')) && !/Meena|Kabir/.test(await R.textContent('#cmsgs .pl')));
ok('5. no bar is drawn for a choice while it is open', (await R.$$eval('#cmsgs .pl .pl-fill', els => els.map(e => e.style.width))).every(w => w === '0%'));
await R.click('#cmsgs .pl [data-hdplfor]'); await shown(R, '#hd-pf-who');
ok('5. a vote for someone not on Parwah: Dadi is offered, never Dadaji', (await R.$$eval('#hd-pf-who option', os => os.map(o => o.textContent))).join() === 'Dadi');
await R.click('#hd-pf-opts [data-hdpfo="0"]'); await R.click('#hd-pf-save');
ok('5. it is kept as "for Dadi, by Rohan"', await sees(R, '#cmsgs .pl', /You voted for Dadi, by Rohan/) && (await q1('select by_member from poll_votes where poll_id = $1 and member_id = $2', [pollId, dadi.id])).by_member === rohan.id);
await R.click('#cmsgs .pl [data-hdplremind]');
ok('5. "Remind them once": sent, and the button is gone', await sees(R, '#cmsgs .pl', /Reminder sent/) && !(await R.$('#cmsgs .pl [data-hdplremind]')) && !!(await q1('select reminded_at from chat_polls where id = $1', [pollId])).reminded_at);
await design(R, '#cmsgs .pl', 'a secret ballot in the chat');
// Rohan closes it: now the counts are shown, still with no names.
await R.click('#cmsgs .pl [data-plclose]');
if (await shown(R, '#as-yes')) await R.click('#as-yes');
ok('5. when it closes the counts are shown: Kabir is 13, and Goa has two votes, his and his mother\'s', await sees(R, '#cmsgs .pl', /Secret ballot: only the counts are shown/)
  && await R.waitForSelector('#cmsgs .pl [data-i="1"] .pl-n, #cmsgs .pl .pl-opt:nth-of-type(2) .pl-n', T).then(() => true, () => false)
  && (await R.$$eval('#cmsgs .pl .pl-n', els => els.map(e => e.textContent.trim()))).join() === '2,2'
  && !/Meena|Kabir/.test(await R.textContent('#cmsgs .pl')));
// From a 1:1 chat: "Maaf karna" and "Can we talk?".
await R.click('#chatback'); await R.waitForSelector('#chatlist [data-open="' + dm.chatId + '"]', T);
await R.click('#chatlist [data-open="' + dm.chatId + '"]');
await R.waitForFunction(() => /Personal chat/.test(document.querySelector('#cv-sub').textContent), null, T);
await R.click('#hd-cv-more');
ok('7. a 1:1 chat offers "Maaf karna" and "Can we talk?" to that person', await shown(R, '#mbs-body [data-hdbaat^="cantalk|' + meena.id + '"]') && await sees(R, '#mbs-body', /A private word to Meena/));
await R.click('#mbs-body [data-hdbaat^="cantalk|"]'); await shown(R, '#hd-b-send');
ok('7. "Can we talk?" opens ready for her', await R.$eval('#hd-b-kind .sel', b => b.textContent.trim()) === '🤝 Can we talk?' && await R.$eval('#hd-b-to', s => s.value) === meena.id);
await R.click('#mbs-x');

// ================================================================ 5. a date poll: tally, lock, decision
const d1 = new Date(Date.now() + 5 * 86400000).toISOString(), d2 = new Date(Date.now() + 6 * 86400000).toISOString();
const dp = await api(rohan, 'plans', { action: 'bond_poll_create', title: 'Diwali dinner', options: [d1, d2], kind: 'meet', secret: true });
const os = (await admin.query('select id from plan_options where poll_id = $1 order by at', [dp.id])).rows.map(r => r.id);
await api(meena, 'plans', { action: 'bond_poll_vote', optionId: os[0], answer: 'yes' }); await api(kabir, 'plans', { action: 'bond_poll_vote', optionId: os[0], answer: 'yes' });
await api(papa, 'plans', { action: 'bond_poll_vote', optionId: os[1], answer: 'no' });
await R.evaluate(() => { location.hash = '#fun'; });
await R.waitForSelector('#bpoll-' + dp.id, T);
ok('5. the date poll: a secret ballot, counts only, and who is still to answer', await sees(R, '#bpoll-' + dp.id, /Secret ballot: only the counts are shown/) && await sees(R, '#bpoll-' + dp.id, /2 yes · 0 maybe · 0 no/)
  && await sees(R, '#bpoll-' + dp.id, /Waiting for Rohan/) && !/Meena|Kabir|Papa/.test(await R.textContent('#bpoll-' + dp.id)));
await design(R, '#bpoll-' + dp.id, 'a date poll with a secret ballot');
await R.click('#bpoll-' + dp.id + ' [data-bplock^="' + dp.id + '|' + os[0] + '"]');
await shown(R, '#as-yes');
ok('5. BEFORE LOCKING, THE HOST IS SHOWN THE TALLY for every date', await sees(R, '#asksheet', /The count so far\./) && await sees(R, '#asksheet', /2 yes, 0 maybe, 0 no \(most can make this\) \(the one you are locking\)/) && await sees(R, '#asksheet', /0 yes, 0 maybe, 1 no/));
await design(R, '#asksheet', 'the lock question with the tally');
await R.click('#as-yes');
ok('5. the lock records what was decided, and the poll says so', await sees(R, '#bond-polls', /The date for Diwali dinner is locked: 2 yes, 0 maybe, 0 no\. Locked by Rohan\./)
  && (await q1('select decided from plan_polls where id = $1', [dp.id])).decided.yes === 2);

// ================================================================ 9. festivals, one at a time
await R.waitForSelector('#bf-chips [data-bfk="onam"]', T);
ok('9. the festivals that were missing are offered, and there is no "save the whole list" button', (await R.$$('#bf-chips [data-bfk]')).length === 21 && !!(await R.$('#bf-chips [data-bfk="janmashtami"]')) && !!(await R.$('#bf-chips [data-bfk="chhath"]')) && !(await R.$('#bf-save')));
await R.click('#bf-chips [data-bfk="onam"]');
ok('9. one tap adds Onam, and the feed says who', await toastSays(R, /Added/) && await R.waitForFunction(() => document.querySelector('#bf-chips [data-bfk="onam"]').classList.contains('sel'), null, T).then(() => true, () => false)
  && /Rohan added Onam to the family's festivals/.test((await q1(`select text from events where circle_id = $1 and text like '%festivals%' order by created_at desc limit 1`, [fam])).text));
await api(meena, 'plans', { action: 'bond_fest_add', key: 'diwali' });
await R.click('#bf-chips [data-bfk="onam"]');
ok('9. taking Onam off leaves Meena\'s Diwali alone', await toastSays(R, /Taken off/) && (await admin.query('select fkey from circle_festivals where circle_id = $1', [fam])).rows.map(r => r.fkey).join() === 'diwali');
await design(R, '#bond-fests', 'the festivals, one tap each');

// ================================================================ 4. a card: thank you, and print for someone not on Parwah
const circle = { id: fam, kind: 'family', name: 'Sharma Family', code: 'SHARMA' };
const cardA = await api(rohan, 'plans', { action: 'bond_card_start', forMember: papa.id, occasion: 'birthday', date: today, title: "Papa's birthday" });
await Bond.sweepBond(db(), circle);
await reloadHome(PP);
ok('4. an empty card is not shown to Papa', !(await PP.$('#bond-today [data-bcopen="' + cardA.id + '"]')) && (await q1('select delivered_at from cards where id = $1', [cardA.id])).delivered_at === null);
await api(meena, 'plans', { action: 'bond_card_add', cardId: cardA.id, kind: 'text', text: 'Happy birthday Papa' });
await Bond.sweepBond(db(), circle);
await reloadHome(PP);
await PP.waitForSelector('#bond-today [data-bcopen="' + cardA.id + '"]', T);
await PP.click('#bond-today [data-bcopen="' + cardA.id + '"]');
await shown(PP, '#bs-body [data-hdthanks="tap"]');
ok('4. Papa opens his card and is offered "Say thank you", by a tap or by voice', await sees(PP, '#bs-body', /Happy birthday Papa/) && /Say thank you to everyone who wrote/.test(await PP.textContent('#bs-body [data-hdthanks="tap"]')) && await shown(PP, '#bs-body [data-hdthanks="voice"]'));
await design(PP, '#bondsheet', 'the card with "Say thank you", senior mode');
await PP.click('#bs-body [data-hdthanks="tap"]');
ok('4. one tap: the writers are told, and the card says so', await sees(PP, '#bs-body', /You said thank you for this card/) && !(await PP.$('#bs-body [data-hdthanks]'))
  && (await q1('select count(*)::int as n from card_thanks where card_id = $1 and member_id = $2', [cardA.id, papa.id])).n === 1);
await PP.click('#bs-x');
const cardD = await api(rohan, 'plans', { action: 'bond_card_start', forMember: dadi.id, occasion: 'birthday', date: today, title: "Dadi's birthday" });
await api(rohan, 'plans', { action: 'bond_card_add', cardId: cardD.id, kind: 'text', text: 'Pranam Dadi, janamdin mubarak' });
await reloadHome(M);
await M.waitForSelector('#bond-today [data-bcopen="' + cardD.id + '"]', T);
await M.click('#bond-today [data-bcopen="' + cardD.id + '"]');
await shown(M, '#bs-body [data-hdcardprint]');
ok('4. a card for Dadi, who is not on Parwah: show or print it, or share the words', await sees(M, '#bs-body', /Dadi is not on Parwah\. Show it on this phone, print it, or send the words\./) && await shown(M, '#bs-body [data-hdcardshare]'));
await design(M, '#bondsheet', 'the card for someone not on Parwah');
await M.click('#bs-body [data-hdcardprint]');
ok('4. the print view carries the card, with who wrote each line', await shown(M, '#mb-book') && await sees(M, '#mbb-body', /Dadi's birthday/) && await sees(M, '#mbb-body', /Pranam Dadi, janamdin mubarak/) && await sees(M, '#mbb-body', /From Rohan/) && await shown(M, '#mbb-print'));
await design(M, '#mb-book', 'the card laid out to show or print');
await M.click('#mbb-close');

// ================================================================ 4. stories: heard by, and told for someone
await call(HANDLERS.book, { token: papa.token, query: { area: 'bond' }, body: { area: 'bond', code: 'SHARMA', memberId: papa.id, action: 'teller_invite', targetId: papa.id } });
const ask = (await call(HANDLERS.book, { method: 'GET', token: papa.token, query: { area: 'bond', view: 'today', circle: 'SHARMA', member: papa.id } })).ask;
await call(HANDLERS.book, { token: papa.token, query: { area: 'bond' }, body: { area: 'bond', code: 'SHARMA', memberId: papa.id, action: 'story_answer', id: ask.id, text: 'We walked four kilometres to school, and raced the bus.' } });
await M.evaluate(() => { location.hash = '#memory'; });
await M.waitForSelector('#pane-memory [data-mbv="stories"]', T); await M.click('#pane-memory [data-mbv="stories"]');
await M.waitForSelector('#mb-stories [data-hdheard="' + ask.id + '"]', T);
ok('4. Papa\'s story offers "Suna, bahut accha laga" and a voice reply, in words', /Suna, bahut accha laga/.test(await M.textContent('#mb-stories [data-hdheard="' + ask.id + '"]')) && /Reply by voice/.test(await M.textContent('#mb-stories [data-hdheardv="' + ask.id + '"]')));
await M.click('#mb-stories [data-hdheard="' + ask.id + '"]');
ok('4. one tap: "Heard by You", and Papa is told', await sees(M, '#mb-stories', /Heard by You/) && await toastSays(M, /told you heard it/) && (await q1('select count(*)::int as n from story_heard where story_id = $1 and member_id = $2', [ask.id, meena.id])).n === 1);
await M.click('#mb-stories [data-hdstoryfor]'); await shown(M, '#hd-f-who');
ok('4. a story can be recorded for Dadi, who is not on Parwah (never Dadaji)', (await M.$$eval('#hd-f-who option', os => os.map(o => o.textContent))).join() === 'Dadi');
await design(M, '#mbsheet', 'the "story for someone" sheet');
await M.fill('#hd-f-q', 'How did you and Dadaji meet?'); await M.fill('#hd-f-text', 'At my cousin\'s wedding in Kanpur.'); await M.click('#hd-f-save');
ok('4. it is kept and shown as "told by Dadi, recorded by Meena"', await toastSays(M, /told by Dadi, recorded by Meena/) && await sees(M, '#mb-stories', /told by Dadi, recorded by Meena/) && await sees(M, '#mb-stories', /At my cousin's wedding in Kanpur\./));
await design(M, '#mb-stories', 'stories with "heard by" and "told by"');

// ================================================================ 4. a photo: reactions in words, a voice caption, share
const jpeg = (w, h, size) => {
  const head = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xC0, 0x00, 0x0B, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0];
  return Buffer.from([...head, ...new Array(Math.max(4, size - head.length - 2)).fill(0x11), 0xFF, 0xD9]).toString('base64');
};
const albums = await call(HANDLERS.book, { method: 'GET', token: meena.token, query: { area: 'album', circle: 'SHARMA', member: meena.id } });
await call(HANDLERS.book, { token: meena.token, query: { area: 'album' }, body: { area: 'album', code: 'SHARMA', memberId: meena.id, action: 'photo_add', albumId: albums.albums.find(a => a.isDefault).id, photos: [{ photo: jpeg(1600, 1200, 5000), thumb: jpeg(320, 240, 900) }], caption: 'Shimla, 1987' } });
await M.click('#pane-memory [data-mbv="album"]');
await M.waitForSelector('[data-abopen]', T); await M.click('[data-abopen]');
await M.waitForSelector('#ab-v-acts [data-hdabrx]', T);
const rxWords = await M.$$eval('#ab-v-acts [data-hdabrx]', bs => bs.map(b => b.textContent.trim()));
ok('4. five reactions on a photo, each with its word', rxWords.join('|') === '❤️ Love|🙏 Pranam|😂 Haha|👏 Shabash|😮 Wah', rxWords.join('|'));
ok('4. whoever added the photo can add a voice caption; anyone who sees it can share this one photo', /Add a voice caption/.test(await M.textContent('#ab-v-acts [data-hdabvoice]')) && /Share this photo/.test(await M.textContent('#ab-v-acts [data-hdabshare]')));
await M.click('#ab-v-acts [data-hdabrx="❤️"]');
ok('4. a tap reacts, and shows who', await M.waitForFunction(() => { const b = document.querySelector('#ab-v-acts [data-hdabrx="❤️"]'); return !!b && b.classList.contains('sel') && /Love · 1/.test(b.textContent); }, null, T).then(() => true, () => false)
  && await sees(M, '#ab-v-acts .hdfull', /You/) && (await q1('select count(*)::int as n from album_reactions where member_id = $1', [meena.id])).n === 1);
await design(M, '#ab-v-acts', 'the photo\'s reactions and actions');
await M.click('#ab-v-x');

// ================================================================ 11. pasand, noted for someone not on Parwah
await M.evaluate(() => { location.hash = '#fun'; });
await M.waitForSelector('#fun-seg [data-sec="pasand"]', T); await M.click('#fun-seg [data-sec="pasand"]');
await M.waitForSelector('#ps-people [data-hdpsnote="' + dadi.id + '"]', T);
await M.click('#ps-people [data-hdpsnote="' + dadi.id + '"]'); await shown(M, '#hd-p-text');
ok('11. the sheet says the notes are the family\'s, and are replaced when she joins', await sees(M, '#mbs-body', /When they join, their own likes take the place of these/));
await design(M, '#mbsheet', 'the "note what Dadi likes" sheet');
await M.selectOption('#hd-p-kind', 'music'); await M.fill('#hd-p-text', 'Old Lata songs'); await M.click('#hd-p-save');
ok('11. the note shows with who wrote it', await sees(M, '#ps-people', /Old Lata songs \(noted by Meena\)/) && (await q1('select by_member from pasand_likes where member_id = $1', [dadi.id])).by_member === meena.id);
await design(M, '#ps-people', 'what the family likes, with a note');


ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`heard.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`heard.e2e: ${pass}/${pass} checks pass`);
