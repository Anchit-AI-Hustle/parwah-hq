// DADI'S LINK, END TO END: a real browser, the real API and a real PostgreSQL.
//
// Rohan opens Dadi's page in the app and makes her a link. The "Send on
// WhatsApp" button is a wa.me address with her number and the link in it.
// That link is then opened in a FRESH browser with no session at all, at
// 320 and 390 wide: the first screen asks her, in Hindi and English, with
// who set it up and what the family can see. She taps "All right", then
// "I am fine" and the family's feed says so. She answers a thank-you with a
// heart and it shows on Meena's Today as "from Dadi's link". She blesses
// everyone with one tap and Meena by voice. Her vote counts. "Call me" tells
// Meena. "I need help" waits five seconds: Cancel tells nobody, and letting
// it run raises the family's SOS with 112 and Rohan to call. She deletes
// something she sent. Rohan turns the link off and the page says so kindly.
//
// The page is measured like every other screen and a little harder: 56px
// targets (the floor is 44), both languages on every button, AA contrast in
// light and dark, nothing sideways at 320 or 390. Nothing here waits a fixed
// time and then looks: each step waits for the element or state it checks.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('eldlink.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('eldlink.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('eldlink.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'plans', 'book', 'games']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function user(name) {
  const phone = '+9198770' + String(++n).padStart(5, '0');
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

// What the server was asked for, so the test can show the key never rode in an address.
const asked = [];
const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  asked.push({ url: req.url, referer: req.headers.referer || '' });
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
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const T = { timeout: 25000 };

const familyRead = (page) => page.waitForFunction(() => { const e = document.getElementById('pane-people'); return !!e && !e.hidden && /Dadi/.test(e.textContent); }, null, T);
async function phone(who, { width = 390, hash = '#home' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', colorScheme: 'light', timezoneId: 'Asia/Kolkata' });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.id, name: w.name, role: w.role || 'family', circleName: 'Sharma Family' }));
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  // The family has been read: only then is the screen ready.
  if (hash === '#people') await familyRead(page);
  return page;
}
const sees = (page, sel, re, opts) => page.waitForFunction(([s, src, fl]) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && new RegExp(src, fl).test(e.textContent); },
  [sel, re.source, re.flags], opts || T).then(() => true, () => false);
const shown = (page, sel) => page.waitForSelector(sel, { state: 'visible', ...T }).then(() => true, () => false);
const toastSays = (page, re) => sees(page, '#toast', re);

// The design rules, measured inside one part of the screen. `floor` is the
// smallest touch target allowed: 44 in the app, 56 on Dadi's page.
function measureIn([sel, floor]) {
  const root = document.querySelector(sel);
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]'); };
  const L = (c) => { const m = c.match(/[\d.]+/g); if (!m) return 1; return m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map(x => x.trim()); return p.length === 4 ? +p[3] : 1; };
  const bgOf = (el) => { let n = el; while (n) { const c = getComputedStyle(n);
      if (alpha(c.backgroundColor) > 0.9) return [c.backgroundColor];
      if (c.backgroundImage && c.backgroundImage !== 'none' && n !== document.body) { const st = (c.backgroundImage.match(/rgba?\([^)]+\)/g) || []).filter(x => alpha(x) > 0.5); if (st.length) return st; }
      n = n.parentElement; } return [getComputedStyle(document.body).backgroundColor]; };
  const out = { overflow: document.scrollingElement.scrollWidth - innerWidth, inner: root.scrollWidth - root.clientWidth, bad: [], seen: 0, oneLang: [] };
  root.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, textarea').forEach(el => {
    if (!vis(el)) return;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return;
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) return;
    out.seen++;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < floor - 0.5) out.bad.push('small ' + (el.id || el.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (r.right > innerWidth + 0.5 || r.left < -0.5) out.bad.push('off the side ' + (el.id || el.textContent.trim().slice(0, 20)));
    // On Dadi's page every button says it in Hindi AND in English.
    if (floor > 44 && el.classList.contains('b')) {
      const hi = el.querySelector('.hi'), en = el.querySelector('.en');
      if (!hi || !en || !/[ऀ-ॿ]|[A-Za-z0-9]/.test(hi.textContent) || !/[A-Za-z]/.test(en.textContent)) out.oneLang.push(el.textContent.trim().slice(0, 24));
    }
  });
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const el = w.currentNode.parentElement; if (!w.currentNode.textContent.trim() || !el || !vis(el)) continue;
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
    if (size < (floor > 44 ? 15.99 : 11.99)) out.bad.push('tiny ' + el.textContent.trim().slice(0, 20) + ' ' + size);
    const a = L(cs.color), ratio = Math.min(...bgOf(el).map(bg => { const b = L(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5) - 0.01) out.bad.push('contrast ' + el.textContent.trim().slice(0, 24) + ' ' + ratio.toFixed(2));
  }
  return out;
}
async function design(page, sel, label, floor = 44, textOnly = false) {
  const was = page.viewportSize(); const bad = []; let seen = 0;
  for (const [wd, sc] of [[320, 'light'], [320, 'dark'], [390, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc });
    await page.waitForFunction(([w, dark]) => innerWidth === w && matchMedia('(prefers-color-scheme: dark)').matches === dark, [wd, sc === 'dark'], T);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const m = await page.evaluate(measureIn, [sel, floor]);
    seen += m.seen;
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    if (m.inner > 1) bad.push(wd + ' sideways inside ' + m.inner + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
    m.oneLang.forEach(b => bad.push('one language only: ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction((w) => innerWidth === w, was.width, T);
  ok('design: ' + label + ' - ' + floor + 'px targets, ' + (floor > 44 ? '16px floor, both languages on every button' : '12px floor') + ', AA contrast in light and dark, nothing sideways at 320 or 390',
    bad.length === 0 && (seen > 0 || textOnly), bad.slice(0, 6).join(' | ') || 'nothing measured');
}
const wide = async (page, sel, label) => {
  const was = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => innerWidth === 1280, null, T);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await page.evaluate(measureIn, [sel, 44]);
  ok('design: ' + label + ' at 1280 - nothing sideways, 12px floor, AA contrast', m.overflow <= 0 && m.inner <= 1 && !m.bad.some(b => /tiny|contrast|off the side/.test(b)), m.overflow + ' ' + m.inner + ' ' + m.bad.slice(0, 4).join(' | '));
  await page.setViewportSize(was); await page.waitForFunction((w) => innerWidth === w, was.width, T);
};

// ---- the Sharma family
await call(HANDLERS.plans, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });
await call(HANDLERS.chats, { method: 'GET', query: { area: 'heard', circle: 'NOPE00', member: 'x' } });
await call(HANDLERS.events, { method: 'GET', query: { area: 'eldlink', circle: 'NOPE00', member: 'x' } });
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
async function seat(name, role = 'family', dob = null, onApp = true, phoneNo = null) {
  const u = onApp ? await user(name) : { name };
  const m = (await admin.query(`insert into members (circle_id, name, user_id, role, dob, phone, phone_cc) values ($1,$2,$3,$4,$5,$6,'+91') returning id`, [fam, name, u.userId || null, role, dob, phoneNo || u.phone || null])).rows[0];
  return { ...u, id: m.id, code: 'SHARMA', role };
}
const rohan = await seat('Rohan', 'family', '1988-03-04'), meena = await seat('Meena', 'family', '1990-07-09'), kabir = await seat('Kabir', 'family', '2013-05-05');
const dadi = await seat('Dadi', 'parent', '1946-02-02', false, '+919811100001');
const q1 = async (text, p) => (await admin.query(text, p)).rows[0];
const api = (who, handler, body, query) => call(HANDLERS[handler], { token: who.token, body: { code: 'SHARMA', memberId: who.id, ...body }, query: query || {} });
const openPersonPage = async (page, id) => {
  await page.evaluate((pid) => { const b = document.createElement('button'); b.setAttribute('data-person', pid); b.textContent = 'open'; document.body.appendChild(b); b.click(); b.remove(); }, id);
  await page.waitForSelector('#pane-person:not([hidden]) #el-card:not([hidden])', T);
};

// What the family already sent: a thank-you to Dadi, a blessing to everyone, a poll in the family chat.
await api(meena, 'chats', { area: 'heard', action: 'shukriya_send', toId: dadi.id, line: 'Thank you for the pickle, Dadi', audience: 'two' });
await api(rohan, 'chats', { area: 'ashirwad', action: 'bless', to: 'all', line: 'khush' });
const famChat = (await call(HANDLERS.chats, { method: 'GET', token: rohan.token, query: { circle: 'SHARMA', member: rohan.id } })).chats.find(c => c.kind === 'circle').id;
const poll = (await api(rohan, 'chats', { action: 'poll_create', chatId: famChat, question: 'Diwali at whose home?', options: ['Rohan and Meena', 'Dadi'] })).pollId;

// ================================================================ I1/I4. the adult makes the link and "sends" it
const R = await phone(rohan, { hash: '#people' });
await openPersonPage(R, dadi.id);
ok('I4. on Dadi\'s page an adult is offered "Send Dadi a link", with what the page never shows', await sees(R, '#el-card', /Send Dadi a link/) && await sees(R, '#el-card', /never shows the chat, health details, documents or costs/));
await design(R, '#el-card', 'the link card before a link exists');
await R.click('#el-card [data-elmake]');
ok('I1. the link is ready, and the app says a person sends it, not Parwah', await shown(R, '#el-wa') && await sees(R, '#el-card', /Parwah does not send it: you do, from your own WhatsApp/) && await toastSays(R, /The link is ready/));
const href = await R.getAttribute('#el-wa', 'href');
const sentText = decodeURIComponent(href.split('?text=')[1] || '');
const link = (sentText.match(/http:\/\/127\.0\.0\.1:\d+\/apna\/#k=[A-Za-z0-9_-]{43}/) || [''])[0];
ok('I1. "Send on WhatsApp" is a wa.me address with her number and nothing else before the text', /^https:\/\/wa\.me\/919811100001\?text=/.test(href) && (await R.getAttribute('#el-wa', 'rel')).includes('noopener'));
ok('I1. the message is plain words with her own link at the end, the key after the #', /^Namaste Dadi, Rohan here\./.test(sentText) && !!link && sentText.endsWith(link), sentText);
ok('I1. the family is told once, in the feed', /Rohan set up Dadi's link/.test((await q1(`select string_agg(text, ' | ') as t from events where circle_id = $1`, [fam])).t));
await design(R, '#el-card', 'the link card with Send on WhatsApp, the two people to call, and Turn off');
await wide(R, '#el-card', 'the link card');
const K = await phone(kabir, { hash: '#people' });
await openPersonPage(K, dadi.id);
ok('I3. a child sees that the link exists, and no button to send it or turn it off', await sees(K, '#el-card', /An adult in the family can send it again or turn it off/) && !(await K.$('#el-card [data-elmake], #el-card [data-eloff], #el-card [data-elrenew]')));

// ================================================================ I2/I3. the page, in a fresh browser with no session
const fresh = await browser.newContext({ viewport: { width: 320, height: 720 }, serviceWorkers: 'block', colorScheme: 'light', timezoneId: 'Asia/Kolkata', permissions: ['microphone'] });
const D = await fresh.newPage();
D.on('pageerror', e => errors.push('Dadi: ' + e.message));
const offSite = [];
D.on('request', rq => { if (!rq.url().startsWith(BASE) && !rq.url().startsWith('data:') && !rq.url().startsWith('blob:')) offSite.push(rq.url()); });
asked.length = 0;
await D.goto(link);
ok('I3. the first open asks her, in both languages, saying who set it up', await sees(D, '#view', /Rohan ने यह पन्ना आपके लिए बनाया है/) && await sees(D, '#view', /Rohan set up this page for you/) && await sees(D, '#view', /ठीक है[\s\S]*All right/) && await sees(D, '#view', /नहीं चाहिए[\s\S]*I do not want this/));
ok('I3. and what the family can see, in both languages', await sees(D, '#view', /परिवार यह देख सकता है/) && await sees(D, '#view', /When you tap "I am fine"/) && await sees(D, '#view', /Where you are, only if you send it yourself/) && (await D.$$('#view li')).length === 4);
ok('SEC. opening the link signs nobody in: the page holds no session, no account and no family code', await D.evaluate(() => !localStorage.getItem('parwah-token') && !localStorage.getItem('parwah-user') && !localStorage.getItem('parwah') && document.cookie === ''));
ok('SEC. the key is taken out of the address bar as soon as it is read', await D.evaluate(() => location.hash === '' && !/k=/.test(location.href)));
ok('SEC. the key never rode in an address or a Referer sent to the server', asked.length > 0 && asked.every(a => !/k=|[A-Za-z0-9_-]{43}/.test(a.url) && !/k=/.test(a.referer)), JSON.stringify(asked.slice(0, 4)));
ok('I2. it works with nothing from outside: no font, script or stylesheet is fetched from another site', offSite.length === 0, offSite.join(' '));
ok('SEC. the page asks not to be indexed and to send no referrer', await D.evaluate(() => /noindex/.test(document.querySelector('meta[name=robots]').content) && document.querySelector('meta[name=referrer]').content === 'no-referrer'));
await design(D, '#apna', 'Dadi\'s page: the consent screen', 56);
await D.click('#view [data-act="yes"]');
ok('I2a. her page opens: "मैं ठीक हूँ / I am fine" first', await sees(D, '#view [data-act="ok"]', /मैं ठीक हूँ[\s\S]*I am fine/) && await sees(D, '#h', /नमस्ते Dadi/));
ok('I2. no menus: one column of big buttons, every one in both languages', (await D.$$('#apna nav, #apna select, #apna details')).length === 0 && (await D.$$('#view .b')).length >= 7);
await design(D, '#apna', 'Dadi\'s page: home', 56);

// ---- (a) I am fine
await D.click('#view [data-act="ok"]');
ok('I2a. one tap, and a soft "family has been told"', await sees(D, '#view', /परिवार को बता दिया[\s\S]*Your family has been told you are fine/) && !(await D.$('#view [data-act="ok"]')));
ok('I2a. it is a check-in under her own name', (await q1(`select count(*)::int as n from events where member_id = $1 and type = 'checkin'`, [dadi.id])).n === 1);
const RH = await phone(rohan);
ok('I2a. THE FAMILY SEES IT: Rohan\'s feed says "Dadi said: I am fine (from Dadi\'s link)"', await sees(RH, '#feed', /Dadi said: I am fine ✅ \(from Dadi's link\)/));
await D.reload();
ok('I2. the page opens again without the key in the address (it is kept on her phone), still done for today', await sees(D, '#view', /Your family has been told you are fine/));

// ---- (b)(c) what the family sent her, and answering back
await D.click('#view [data-act="inbox"]');
ok('I2b. "From your family": one message on the screen, with who it is from', await sees(D, '#view .card', /From (Rohan|Meena)/) && (await D.$$('#view .card')).length === 1);
ok('I2. a read-aloud button on the message', await shown(D, '#view [data-act="speak"]') && /सुनिए[\s\S]*Listen/.test(await D.textContent('#view [data-act="speak"]')));
await design(D, '#apna', 'Dadi\'s page: one message with Listen and the three ways to answer', 56);
// Find the thank-you from Meena and answer it with a heart.
if (!/Thank you for the pickle/.test(await D.textContent('#view .card'))) { await D.click('#view [data-act="next"]'); await sees(D, '#view .card', /Thank you for the pickle/); }
await D.click('#view [data-act="heart"]');
ok('I2c. a heart answers Meena\'s thank-you', await sees(D, '#view', /आपने जवाब भेज दिया[\s\S]*You answered this/) && (await q1(`select count(*)::int as n from eld_says where member_id = $1 and kind = 'heart' and to_member = $2`, [dadi.id, meena.id])).n === 1);
const M = await phone(meena);
ok('I2c. IN THE APP: Meena\'s Today shows it under Dadi\'s name, marked "from Dadi\'s link"', await sees(M, '#el-today', /Dadi: ❤️ Bahut accha laga/) && await sees(M, '#el-today', /for your shukriya · from Dadi's link/));
await design(M, '#el-today', 'what came from a link, on Today (words only)', 44, true);
ok('I2c. Rohan, who it was not for, is not shown it', !(await RH.$('#el-said')));
await D.click('#view [data-act="home"]');

// ---- (d) a blessing by one tap, and by voice
await D.click('#view [data-act="bless"]');
ok('I2d. "A blessing for whom?": everyone, or one person by name', await sees(D, '#view', /सबको[\s\S]*Everyone/) && (await D.$$('#view [data-act="blessto"]')).length === 4);
await D.click('#view [data-act="blessto"][data-to="all"]');
await design(D, '#apna', 'Dadi\'s page: choosing a blessing', 56);
await D.click('#view [data-act="blessline"][data-line="khush"]');
ok('I2d. one tap: "Your blessing has been sent"', await sees(D, '#hs', /Your blessing has been sent/));
const KH = await phone(kabir);
ok('I2d. A BLESSING ARRIVES IN THE APP: Kabir\'s Today shows "Ashirwad from Dadi, for everyone", from her link', await sees(KH, '#cn-today', /Ashirwad from Dadi, for everyone/) && await sees(KH, '#cn-today', /from Dadi's link/) && await sees(KH, '#cn-today', /Khush raho/));
await design(KH, '#cn-today', 'a blessing that came from a link');
await D.click('#view [data-act="home"]');
await D.click('#view [data-act="bless"]');
await D.click('#view [data-act="blessto"][data-to="' + meena.id + '"]');
await D.click('#view [data-act="blessvoice"]');
await D.waitForFunction(() => { const e = document.getElementById('rec-n'); return !!e && +e.textContent >= 1; }, null, T);
await design(D, '#apna', 'Dadi\'s page: recording a voice note', 56);
await D.click('#view [data-act="recsend"]');
ok('I2d. a blessing in her own voice goes to Meena', await sees(D, '#hs', /Your blessing has been sent/) && (await q1(`select count(*)::int as n from ashirwad where from_member = $1 and to_member = $2 and audio is not null and via = 'link'`, [dadi.id, meena.id])).n === 1);
await D.click('#view [data-act="home"]');

// ---- (d) the weekly question, written
await D.click('#view [data-act="question"]');
ok('I2d. the week\'s family question, with Listen, voice and writing', await shown(D, '#view [data-act="qvoice"]') && await shown(D, '#view [data-act="qtext"]') && await shown(D, '#view [data-act="speak"]'));
await D.click('#view [data-act="qtext"]');
await D.fill('#words', 'Aam ka achaar, garmiyon mein');
await design(D, '#apna', 'Dadi\'s page: writing a few words', 56);
await D.click('#view [data-act="sendwords"]');
ok('I2d. her answer is kept as HER answer', await sees(D, '#view', /Your family has your answer/) && (await q1(`select answer_text, by_member, via from sawaal_answers where member_id = $1`, [dadi.id])).via === 'link');
await D.click('#view [data-act="home"]');

// ---- (d) her vote
await D.click('#view [data-act="poll"]');
ok('I2d. the open family poll, with who asked', await sees(D, '#view', /Rohan asks/) && await sees(D, '#view', /Diwali at whose home\?/) && (await D.$$('#view [data-act="vote"]')).length === 2);
await D.click('#view [data-act="vote"][data-k="1"]');
ok('I2d. A VOTE COUNTS: recorded as her own, and shown as her choice', await sees(D, '#view [data-act="vote"][data-k="1"]', /✓ Dadi[\s\S]*Your choice/) && await toastSays(D, /Your vote is counted/)
  && (await q1(`select choices, by_member, via from poll_votes where poll_id = $1 and member_id = $2`, [poll, dadi.id])).via === 'link');
await design(D, '#apna', 'Dadi\'s page: a poll with her choice', 56);
await D.click('#view [data-act="home"]');

// ---- (e) Call me
await D.click('#view [data-act="callme"]');
ok('I2e. "Who should call you?": whoever is calling today, or a person', await sees(D, '#view', /जो भी आज फ़ोन करने वाला है[\s\S]*Whoever is calling today/));
await D.click('#view [data-act="callto"][data-to="' + meena.id + '"]');
ok('I2e. CALL ME: Meena is told, and the page says so, with a Call button for the person she was given', await sees(D, '#view', /Meena has been told you would like a call/) && await shown(D, '#view a[href^="tel:"]')
  && /Dadi would like a call from Meena \(from Dadi's link\)/.test((await q1(`select string_agg(text, ' | ') as t from events where circle_id = $1`, [fam])).t));
ok('I2e. the Call button is a tel: link to Rohan, the one person she was given', (await D.getAttribute('#view a[href^="tel:"]', 'href')) === 'tel:' + rohan.phone && /Call Rohan/.test(await D.textContent('#view a[href^="tel:"]')));
await design(D, '#apna', 'Dadi\'s page: "they have been told", with Call Rohan', 56);
await D.click('#view [data-act="home"]');

// ---- (f) I need help, with a five-second Cancel
await D.click('#view [data-act="help"]');
ok('I2f. "I need help" counts down first, with a big Cancel', await shown(D, '#sos-n') && await sees(D, '#view [data-act="helpstop"]', /रुकिए, गलती से दब गया[\s\S]*Stop, I pressed by mistake/));
await design(D, '#apna', 'Dadi\'s page: the five-second wait', 56);
await D.click('#view [data-act="helpstop"]');
ok('I2f. CANCEL: nobody is told and no SOS is raised', await toastSays(D, /Stopped\. Nobody was told/) && await shown(D, '#view [data-act="ok"], #view .b.done') && (await q1(`select count(*)::int as n from sos where member_id = $1`, [dadi.id])).n === 0);
await D.click('#view [data-act="help"]');
ok('I2f. left to run, it raises the family\'s SOS as Dadi', await sees(D, '#hs', /Your family has been told/, { timeout: 30000 }) && (await q1(`select count(*)::int as n from sos where member_id = $1 and status = 'open' and lat is null`, [dadi.id])).n === 1);
ok('I2f. big tel: buttons: 112 first, then family; her place only if she taps to send it', (await D.getAttribute('#view a.help', 'href')) === 'tel:112' && (await D.$$('#view a[href^="tel:"]')).length === 2 && await shown(D, '#view [data-act="helpwhere"]'));
await design(D, '#apna', 'Dadi\'s page: help has been called, with 112 and family to ring', 56);
const RS = await phone(rohan);
ok('I2f. Rohan\'s phone rings with the family\'s own SOS alarm, for Dadi', await shown(RS, '#sosalert') && await sees(RS, '#sosalert', /Dadi/) && (await q1(`select count(*)::int as n from messages m join chats c on c.id = m.chat_id where c.circle_id = $1 and m.member_id = $2 and m.text like '🆘%'`, [fam, dadi.id])).n === 1);
await api(rohan, 'events', { type: 'sos_resolve', sosId: (await q1(`select id from sos where member_id = $1`, [dadi.id])).id });
await RS.close();
await D.click('#view [data-act="home"]');

// ---- I3. what she sent, and deleting it
await D.click('#view [data-act="mine"]');
ok('I3. she sees what SHE sent, each with Delete', await sees(D, '#view', /Aam ka achaar, garmiyon mein/) && (await D.$$('#view [data-act="forget"]')).length >= 4);
await design(D, '#apna', 'Dadi\'s page: what I sent', 56);
const before = (await q1(`select count(*)::int as n from sawaal_answers where member_id = $1`, [dadi.id])).n;
await D.click('#view .card:has-text("Aam ka achaar") [data-act="forget"]');
ok('I3. Delete takes it out of the family\'s app too', await toastSays(D, /Deleted/) && before === 1
  && await D.waitForFunction(() => !/Aam ka achaar/.test(document.getElementById('view').textContent), null, T).then(() => true, () => false)
  && (await q1(`select count(*)::int as n from sawaal_answers where member_id = $1`, [dadi.id])).n === 0);
await D.click('#view [data-act="home"]');

// ================================================================ I4/I5. in the app
await R.evaluate(() => { location.hash = '#people'; }); await R.reload(); await familyRead(R); await openPersonPage(R, dadi.id);
ok('I4. the adult sees the link is On, when it was last used and until when', await sees(R, '#el-card', /On/) && await sees(R, '#el-card', /Last used .*On until/) && await shown(R, '#el-card [data-eloff]') && await sees(R, '#el-card', /Send again on WhatsApp/));
ok('I4. and the two people she can call, and a daily "I am fine" to ask for', await shown(R, '#el-contacts [data-elcontact][aria-pressed="true"]') && await shown(R, '#el-checktime'));
await design(R, '#el-card', 'the link card when the link is on');
await M.reload(); await M.waitForSelector('#hd-today [data-hdmood]', T);
ok('I5. the weekly question tells people it is also on Dadi\'s link', await sees(M, '#hd-today', /This question is also on Dadi's link\./));
await M.evaluate((pid) => { const b = document.createElement('button'); b.setAttribute('data-person', pid); document.body.appendChild(b); b.click(); b.remove(); }, dadi.id);
await M.waitForSelector('#hd-person [data-hdshuk]', T); await M.click('#hd-person [data-hdshuk]');
ok('I5. writing a thank-you to Dadi says it will also show on her link', await sees(M, '#el-s-note', /It will also show on Dadi's link, where it can be heard and answered\./));
await design(M, '#mbsheet', 'the thank-you sheet with the link note');
await M.click('#mbs-x');
await M.evaluate(() => { location.hash = '#home'; });
await M.waitForSelector('#cn-bless-open', { state: 'attached', ...T });
await M.evaluate(() => document.getElementById('cn-bless-open').click());
ok('I5. a blessing can be sent to Dadi, who is not on Parwah, because her link is on', await sees(M, '#cn-who', /Dadi \(on their link\)/));
await M.click('#cn-who [data-cnto="' + dadi.id + '"]');
await M.click('#cn-lines [data-cnline="khush"]');
await M.waitForFunction(() => document.getElementById('cn-sheet').hidden, null, T);
await D.reload();
ok('I5. and it shows on her page, with no extra work for Meena', await sees(D, '#view [data-act="inbox"]', /From your family \(2 new\)/));

// ================================================================ revoke
await R.click('#el-card [data-eloff]');
await shown(R, '#asksheet #as-yes');
ok('I1. "Turn off Dadi\'s link" asks first, and says what stays', await sees(R, '#asksheet', /The page stops opening at once\. What Dadi already sent stays in the family\./));
await design(R, '#asksheet', 'the "turn off the link" question');
await R.click('#as-yes');
ok('I1. REVOKE: the card goes back to "Send Dadi a link"', await toastSays(R, /Turned off/) && await sees(R, '#el-card', /Send Dadi a link/));
await D.reload();
ok('I1. her page now says, kindly and in both languages, that the link is not on', await sees(D, '#h', /यह लिंक अब बंद है/) && await sees(D, '#hs', /This link is not on now/) && await sees(D, '#view', /Ask your family to send you a new link/));
ok('I1. and nothing about the family is on that screen', !/Sharma|Rohan|Meena|Dadi/.test(await D.textContent('#apna')));
await design(D, '#apna', 'Dadi\'s page: the link is not on (words only)', 56, true);
ok('SEC. the key is forgotten by her phone once the link is off', await D.evaluate(() => !localStorage.getItem('parwah-apna')));

// A key that was never real gets the very same page.
const X = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
X.on('pageerror', e => errors.push('stranger: ' + e.message));
await X.goto(BASE + '/apna/#k=' + 'A'.repeat(43));
ok('I1. a wrong key gets the same kind page: no error dump, nothing that says a family exists', await sees(X, '#hs', /This link is not on now/) && (await X.textContent('#apna')) === (await D.textContent('#apna')));
await X.goto(BASE + '/apna/');
ok('I1. and so does the page with no key at all', await sees(X, '#hs', /This link is not on now/));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`eldlink.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`eldlink.e2e: ${pass}/${pass} checks pass`);
