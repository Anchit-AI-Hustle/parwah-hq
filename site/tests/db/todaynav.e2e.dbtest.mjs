// TODAY FOR EACH PERSON, AND FIVE PLACES, END TO END: a real browser, the
// real API and a real PostgreSQL. The walk a family of five took by hand,
// now taken by a test.
//
// The Sharma family: Rohan (abroad), Priya, Papa (senior mode), Maa, Kabir
// who is 14, श्रीमती कमला देवी (Dadi, on the app), and Dadaji, who is
// remembered.
//   1. Papa (senior mode) sees Rohan's message on Today, right under his big
//      buttons, with no setup list above the family; answers it from there;
//      "Dekh liya"; hold to talk; the bubble carries a mark; the hero says
//      "You said all is well".
//   2. Rohan sees a card for each parent (never one for Dadaji), answers a
//      plan with "Going?" in place, and lets someone in from Today.
//   3. A 14-year-old's Today: games, polls, Pasand, stories and a question
//      for an elder first; no vault, no setup list, no request to join.
//   4. Five tabs and SOS on a phone; every old address still lands on its
//      screen; the menu is short; stories, recipes and the album are in
//      Together; To do opens on one list.
//   5. First run with an invite, counting the taps.
//   6. Offline: SOS says NOT sent with large Call and SMS; a chat message
//      is kept and retried.
//   7. The small words: a medicine asks when it is taken, a person's page
//      opens with what is recorded, a name is never cut after an honorific,
//      Mother is asked about the larger screen.
// Every new surface is measured: 44px targets, a 12px floor, AA contrast in
// light and dark, nothing sideways at 320 and 390, and Today at 1280.
// Nothing here waits a fixed time and then looks.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('todaynav.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('todaynav.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('todaynav.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

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
  const phone = '+9198750' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}
async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.6.0.' + (++n % 250) }, query, body };
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
// A microphone that is not a person: the browser's own test tone, so "hold
// to talk" records something real with nobody in the room.
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const T = { timeout: 20000 };

async function phone(who, { scheme = 'light', width = 390, hash = '#home', frHide = true, circles = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', colorScheme: scheme, permissions: ['microphone'] });
  await ctx.addInitScript(([w, hide, cs]) => {
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    if (hide) localStorage.setItem('parwah-fr-hide', '1');
    if (cs) localStorage.setItem('parwah-circles', JSON.stringify(cs));
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.id, name: w.name, role: w.role || 'family', circleName: 'Sharma Family' }));
  }, [who, frHide, circles]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  await page.waitForFunction(() => { const t = document.getElementById('m-title'); return !!t && /Sharma Family/.test(t.textContent); }, null, T);
  return page;
}
const sees = (page, sel, re, opts) => page.waitForFunction(([s, src, fl]) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && new RegExp(src, fl).test(e.textContent); },
  [sel, re.source, re.flags], opts || T).then(() => true, () => false);
const gone = (page, sel) => page.waitForSelector(sel, { state: 'hidden', ...T }).then(() => true, () => false);
const shown = (page, sel) => page.waitForSelector(sel, { state: 'visible', ...T }).then(() => true, () => false);
const q1 = async (text, p) => (await admin.query(text, p)).rows[0];
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await new Promise(r => setTimeout(r, 120)); } };
// Today's gathered read is asked for again at once (the app does this by
// itself after anything that changes it; a test cannot wait fifteen seconds).
const fresh = (page) => page.reload().then(() => page.waitForFunction(() => { const t = document.getElementById('m-title'); return !!t && /Sharma Family/.test(t.textContent); }, null, T));

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
const wide = async (page, sel, label) => {
  const was = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => innerWidth === 1280, null, T);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await page.evaluate(measureIn, sel);
  ok('design: ' + label + ' at 1280 - nothing sideways, 12px floor, AA contrast', m.overflow <= 0 && m.inner <= 1 && !m.bad.some(b => /tiny|contrast|off the side/.test(b)), m.overflow + ' ' + m.inner + ' ' + m.bad.slice(0, 4).join(' | '));
  await page.setViewportSize(was); await page.waitForFunction((w) => innerWidth === w, was.width, T);
};

// ---- the Sharma family, seated straight in the database
await call(HANDLERS.plans, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });
await call(HANDLERS.book, { method: 'GET', query: { area: 'bond', circle: 'NOPE00', member: 'x' } });
await call(HANDLERS.chats, { method: 'GET', query: { area: 'heard', circle: 'NOPE00', member: 'x' } });
await (await import('../../../api/_bond.mjs')).ensureBondSchema(db());
await (await import('../../../api/_remember.mjs')).ensureRememberSchema(db());
const CODE = 'SHARMA24';
const fam = (await admin.query(`insert into circles (code, name, kind, family_type) values ($1,'Sharma Family','family','joint') returning id`, [CODE])).rows[0].id;
async function seat(name, role = 'family', dob = null, onApp = true, phone = null) {
  const u = onApp ? await user(name) : { name };
  const m = (await admin.query(`insert into members (circle_id, name, user_id, role, dob, phone, created_at) values ($1,$2,$3,$4,$5,$6, now() - interval '40 days') returning id`,
    [fam, name, u.userId || null, role, dob, phone])).rows[0];
  return { ...u, id: m.id, code: CODE, role };
}
const rohan = await seat('Rohan', 'family', '1988-03-04', true, '+919811200001'), priya = await seat('Priya', 'family', '1990-07-09', true, '+919811200002');
const papa = await seat('Papa', 'parent', '1958-01-20', true, '+919811200003'), maa = await seat('Maa', 'parent', '1960-05-11', true, '+919811200004');
const kabir = await seat('Kabir', 'family', '2012-05-05');
const dadi = await seat('श्रीमती कमला देवी', 'parent', '1936-02-02', true, '+919811200005');
const dadaji = await seat('Dadaji', 'parent', '1930-01-01', false, '+919811200009');
await admin.query(`update members set remembered = true, passed_year = 2019 where id = $1`, [dadaji.id]);
const api = (who, handler, body, query) => call(HANDLERS[handler], { token: who.token, body: { code: CODE, memberId: who.id, ...body }, query: query || {} });
const today = (who) => call(HANDLERS.chats, { method: 'GET', token: who.token, query: { area: 'today', circle: CODE, member: who.id } });
const chatsOf = async (who) => (await call(HANDLERS.chats, { method: 'GET', token: who.token, query: { circle: CODE, member: who.id } })).chats;
const famChat = (await chatsOf(rohan)).find(c => c.kind === 'circle').id;
const dmRP = (await api(rohan, 'chats', { action: 'open_dm', otherId: papa.id })).chatId;

// ================================================================ 1. Papa, in senior mode
await api(rohan, 'chats', { action: 'send', chatId: dmRP, text: 'Papa, kal subah doctor ke paas chalna hai. Dus baje tak tayyar rehna.' });
const P = await phone(papa, { frHide: false });
ok('1. Papa\'s Today shows "Rohan sent you a message", with its first words', await sees(P, '#tn-from', /Rohan sent you a message/) && await sees(P, '#tn-from', /Papa, kal subah doctor ke paas/));
ok('1. it is right under his big buttons, above the family\'s name and everything else',
  await P.evaluate(() => { const s = document.getElementById('seniorui'), f = document.getElementById('tn-from'), h = document.querySelector('.homehero');
    return !s.hidden && s.nextElementSibling === f && f.getBoundingClientRect().top >= s.getBoundingClientRect().bottom - 1 && f.getBoundingClientRect().bottom <= h.getBoundingClientRect().top + 1; }));
ok('1. no setup list sits above the family for an elder', await P.evaluate(() => document.getElementById('firstrun').hidden === true) && !(await P.isVisible('#firstrun')));
ok('1. the chat bubble carries a mark and says what it will do', await sees(P, '#tn-chat-dot', /^1$/) && (await P.getAttribute('#chat-fab', 'aria-label')) === '1 new message. Open chats');
ok('1. and so does the Chat tab', await P.isVisible('#tabs button[data-tab="chat"]') && await sees(P, '#tn-tab-dot', /^1$/));
ok('1. the mood card "Aaj kaisa lag raha hai?" is near the top for him too', await shown(P, '#hd-today [data-hdmood]')
  && await P.evaluate(() => document.getElementById('hd-today').getBoundingClientRect().top < document.getElementById('widgets').getBoundingClientRect().top));
await design(P, '#tn-from', 'From the family, in senior mode');
// All is well: the hero speaks TO him.
await P.click('#btn-checkin');
ok('1. the hero speaks to Papa: "You said all is well", never "Papa said"', await sees(P, '#hero-status', /You said all is well/) && !/Papa said/.test(await P.textContent('#hero-status')), await P.textContent('#hero-status'));
// He answers from Today.
await P.click('#tn-from [data-tnkind="message"] [data-tnchat]');
ok('1. "Open and reply" opens that chat, ready to type', await shown(P, '#chatview') && await sees(P, '#cmsgs', /doctor ke paas/) && await P.isVisible('#msg'));
await P.fill('#msg', 'Theek hai beta, tayyar rahunga'); await P.click('#send');
ok('1. his answer reaches Rohan', !!(await until(async () => (await q1(`select 1 as x from messages where chat_id = $1 and member_id = $2 and text = 'Theek hai beta, tayyar rahunga'`, [dmRP, papa.id])))));
await P.evaluate(() => { location.hash = '#home'; });
ok('1. and the message has left his Today', await until(async () => !(await today(papa)).items.some(x => x.kind === 'message')) && await P.waitForFunction(() => !document.querySelector('#tn-from [data-tnkind="message"]'), null, T).then(() => true, () => false));
// "Dekh liya", and hold to talk, on a second message.
await api(rohan, 'chats', { action: 'send', chatId: dmRP, text: 'Dawai le li?' });
await fresh(P);
ok('1. the next message has "Dekh liya", "Hold to talk" and "Open and reply"', await shown(P, '#tn-from [data-tnseen]') && await P.isVisible('#tn-from [data-tnhold]') && await P.isVisible('#tn-from [data-tnchat]'));
{
  const hb = await P.$('#tn-from [data-tnhold]'); await hb.scrollIntoViewIfNeeded(); const bx = await hb.boundingBox();
  await P.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await P.mouse.down();
  const talking = await sees(P, '#tn-from [data-tnhold]', /Talking/);
  // Held for a little over a second of real recording, then let go.
  await P.waitForFunction(() => { window.__t0 = window.__t0 || performance.now(); return performance.now() - window.__t0 > 1300; }, null, T);
  await P.mouse.up();
  const sent = await until(async () => (await q1(`select count(*)::int as n from messages where chat_id = $1 and member_id = $2 and kind = 'audio'`, [dmRP, papa.id])).n === 1);
  ok('1. hold to talk on Today records while held and sends on letting go', talking && sent, talking + ' ' + sent);
}
await fresh(P);
ok('1. the message is still waiting: a voice note back does not mark it read', await shown(P, '#tn-from [data-tnseen]'));
await P.click('#tn-from [data-tnseen]');
ok('1. "Dekh liya" marks it read, and it leaves Today', await until(async () => !(await today(papa)).items.some(x => x.kind === 'message'))
  && await P.waitForFunction(() => !document.querySelector('#tn-from [data-tnkind="message"]'), null, T).then(() => true, () => false));

// ================================================================ 2. Rohan, abroad
await api(papa, 'chats', { action: 'send', chatId: famChat, text: 'Sab theek hai, chinta mat karo' });
const planAt = new Date(Date.now() + 3 * 86400000).toISOString();
const plan = await api(priya, 'plans', { action: 'create', title: "Papa's birthday dinner", kind: 'party', at: planAt });
const R = await phone(rohan);
ok('2. Rohan\'s Today has a card for each parent', await shown(R, '#tn-parents .tn-pcard') && (await R.$$eval('#tn-parents .tn-pcard h3', hs => hs.map(h => h.textContent))).join('|') === 'Papa|Maa|श्रीमती कमला देवी',
  (await R.$$eval('#tn-parents .tn-pcard h3', hs => hs.map(h => h.textContent))).join('|'));
ok('2. never one for Dadaji, who is remembered, and his number is nowhere', !/Dadaji/.test(await R.textContent('#tn-parents')) && !(await R.$eval('#pane-home', e => e.innerHTML)).includes('9811200009'));
const pcard = `#tn-parents [data-tnparent="${papa.id}"]`;
ok('2. Papa\'s card: he said all is well today', await sees(R, pcard, /Said all is well today/));
ok('2. Maa\'s card: not checked in yet', await sees(R, `#tn-parents [data-tnparent="${maa.id}"]`, /Not checked in yet today/));
ok('2. the last thing Papa wrote that Rohan may read', await sees(R, pcard, /Sab theek hai, chinta mat karo/));
ok('2. Call and Message, by name', (await R.getAttribute(pcard + ' a[href^="tel:"]', 'href')) === 'tel:' + encodeURIComponent('+919811200003') && /Call Papa/.test(await R.textContent(pcard + ' a[href^="tel:"]')) && /Message Papa/.test(await R.textContent(pcard + ' [data-tndm]')));
ok('2. A NAME IS NEVER CUT AFTER AN HONORIFIC: "Call श्रीमती कमला देवी", not "Call श्रीमती"', /Call श्रीमती कमला देवी/.test(await R.textContent(`#tn-parents [data-tnparent="${dadi.id}"]`)));
await design(R, '#tn-parents', 'a card for each parent');
await design(R, '#tn-from', 'From the family');
await wide(R, '#pane-home', 'Today');
// A plan to answer, in place.
ok('2. the plan for Papa\'s birthday asks "Going?" on Today', await sees(R, '#tn-from [data-tnkind="plan"]', /Papa's birthday dinner/) && await sees(R, '#tn-from [data-tnkind="plan"]', /Going\?/)
  && (await R.$$eval('#tn-from [data-tnkind="plan"] [data-tnrsvp]', bs => bs.map(b => b.textContent))).join() === 'Yes,Maybe,No');
await R.click('#tn-from [data-tnkind="plan"] [data-tnrsvp="in"]');
ok('2. "Yes" answers it there: Rohan is going', !!(await until(async () => (await q1(`select 1 as x from plans where id = $1 and $2 = any(going)`, [plan.id, rohan.id])))));
ok('2. and the card leaves his Today', await R.waitForFunction(() => !document.querySelector('#tn-from [data-tnkind="plan"]'), null, T).then(() => true, () => false));
// The message in the family chat opens from Today.
ok('2. Papa\'s message in the family chat is on Rohan\'s Today', await sees(R, '#tn-from [data-tnkind="message"]', /Papa wrote in the family chat/));
await R.click('#tn-from [data-tnkind="message"]');
ok('2. tapping the row opens it', await shown(R, '#chatview') && await sees(R, '#cmsgs', /chinta mat karo/));
// Message Papa from his card.
await R.evaluate(() => { location.hash = '#home'; });
await shown(R, pcard + ' [data-tndm]'); await R.click(pcard + ' [data-tndm]');
ok('2. "Message Papa" opens the chat with Papa', await shown(R, '#chatview') && await sees(R, '#cv-name', /Papa/));
await R.evaluate(() => { location.hash = '#home'; });

// ================================================================ 3. Kabir, who is 14
await api(priya, 'chats', { action: 'poll_create', chatId: famChat, question: 'Sunday ko kya khayenge?', options: ['Chole bhature', 'Dosa'] });
const K = await phone(kabir, { frHide: false });
ok('3. Kabir\'s Today is the young one', await K.waitForFunction(() => document.body.classList.contains('tn-isyoung'), null, T).then(() => true, () => false) && await shown(K, '#tn-young .widget'));
ok('3. games, polls, Pasand, stories, a question for an elder and his plans come first',
  (await K.$$eval('#tn-young .widget b', bs => bs.map(b => b.textContent))).join('|').replace(/Ask .+ a question/, 'Ask') === 'Games|Polls|Pasand|Stories|Ask|My plans',
  (await K.$$eval('#tn-young .widget b', bs => bs.map(b => b.textContent))).join('|'));
ok('3. and they are above the family\'s papers', await K.evaluate(() => document.getElementById('tn-young').getBoundingClientRect().top < document.getElementById('widgets').getBoundingClientRect().top));
ok('3. no vault tile, no setup list, no readiness score, no "add a document"', !(await K.isVisible('#widgets [data-goto="vault"]')) && !(await K.isVisible('#firstrun')) && !(await K.isVisible('#readycard')) && !(await K.isVisible('.quickadd [data-qadd="doc"]')));
ok('3. no card for each parent on a child\'s Today', (await K.$$('#tn-parents .tn-pcard')).length === 0);
ok('3. the poll his mother started is on his Today', await sees(K, '#tn-from [data-tnkind="poll"]', /Sunday ko kya khayenge/));
ok('3. the mood card stays near the top for him too', await shown(K, '#hd-today [data-hdmood]'));
await design(K, '#tn-young', 'a young member\'s Today');
await K.click('#tn-young [data-tnyoung="ask"]');
ok('3. "Ask ... a question" opens a chat with an elder, with the first words written', await shown(K, '#chatview') && await K.waitForFunction(() => /ek sawaal hai: $/.test(document.getElementById('msg').value), null, T).then(() => true, () => false),
  await K.inputValue('#msg').catch(() => ''));
await K.evaluate(() => { location.hash = '#home'; });
await shown(K, '#tn-young [data-goto="fun"][data-sec="games"]'); await K.click('#tn-young [data-goto="fun"][data-sec="games"]');
ok('3. Games opens the games', await shown(K, '#pane-fun') && await K.waitForFunction(() => { const s = document.querySelector('#fun-seg .sel'); return s && s.getAttribute('data-sec') === 'games'; }, null, T).then(() => true, () => false));

// Someone asks to join: adults see it on Today, a child does not.
const bua = await user('Bua');
const asked = await call(HANDLERS.circle, { token: bua.token, body: { action: 'join', code: CODE, memberName: 'Bua', userId: bua.userId, role: 'family', relation: 'sister' } });
await fresh(R);
ok('3. "Bua is asking to join" is on Rohan\'s Today, with "Let them in"' + (asked.status === 202 ? '' : ' (' + asked.status + ')'), await sees(R, '#tn-from [data-tnkind="join"]', /Bua is asking to join/) && await R.isVisible('#tn-from [data-tnjoin]'));
ok('3. it is the first thing in From the family', await R.evaluate(() => document.querySelector('#tn-from .tn-row').getAttribute('data-tnkind') === 'join'));
await fresh(K);
await shown(K, '#tn-young .widget');
ok('3. A CHILD IS NEVER SHOWN IT', !(await K.$('#tn-from [data-tnkind="join"]')) && !(await today(kabir)).items.some(x => x.kind === 'join'));
await R.click('#tn-from [data-tnjoin]');
ok('3. one tap lets her in', !!(await until(async () => (await q1(`select 1 as x from members where circle_id = $1 and user_id = $2`, [fam, bua.userId])))));
ok('3. and the card leaves Today', await R.waitForFunction(() => !document.querySelector('#tn-from [data-tnkind="join"]'), null, T).then(() => true, () => false));

// ================================================================ 4. five places
{
  const tabs = await R.evaluate(() => [...document.querySelectorAll('#tabs .inner > button, #sos-fab')].filter(b => b.getBoundingClientRect().width > 0)
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(b => b.getAttribute('data-tab') || b.id));
  ok('4. a phone has five tabs and SOS: Today, Chat, Together, Family, More', tabs.join() === 'sos-fab,home,chat,fun,people,menu', tabs.join());
  ok('4. SOS is still docked beside them', await R.isVisible('#sos-fab') && await R.evaluate(() => { const s = document.getElementById('sos-fab').getBoundingClientRect(), t = document.getElementById('tabs').getBoundingClientRect(); return s.top >= t.top - 1 && s.bottom <= t.bottom + 1; }));
  for (const [tab, pane] of [['chat', 'pane-chat'], ['fun', 'pane-fun'], ['people', 'pane-people'], ['menu', 'pane-menu'], ['home', 'pane-home']]) {
    await R.click(`#tabs button[data-tab="${tab}"]`);
    ok(`4. the ${tab} tab opens its screen, and is the one lit`, await shown(R, '#' + pane) && await R.$eval(`#tabs button[data-tab="${tab}"]`, b => b.classList.contains('sel')) && (await R.$$eval('#tabs .inner > button.sel', bs => bs.filter(b => b.getBoundingClientRect().width > 0).length)) === 1);
  }
  // Every old address still lands on its screen, and lights the place it is in.
  const PLACE = { home: 'home', people: 'people', memory: 'people', vault: 'menu', care: 'menu', day: 'menu', chat: 'chat', ekta: 'menu', profile: 'menu', fun: 'fun', notifs: 'menu', menu: 'menu' };
  const bad = [];
  for (const h of Object.keys(PLACE)) {
    await R.evaluate((x) => { location.hash = '#' + x; }, h);
    const landed = await R.waitForFunction((x) => { const p = document.getElementById('pane-' + x); return p && !p.hidden && [...document.querySelectorAll('#main > section')].filter(s => !s.hidden).length === 1; }, h, T).then(() => true, () => false);
    const lit = await R.$$eval('#tabs .inner > button.sel', bs => bs.filter(b => b.getBoundingClientRect().width > 0).map(b => b.getAttribute('data-tab')).join());
    if (!landed || lit !== PLACE[h]) bad.push(h + ':' + landed + ':' + lit);
  }
  ok('4. EVERY OLD ADDRESS STILL LANDS ON ITS SCREEN (#home #people #memory #vault #care #day #chat #ekta #profile #fun #notifs), and the right tab is lit', bad.length === 0, bad.join(' '));
  await R.evaluate(() => { location.hash = '#nonsense'; });
  ok('4. an address nobody knows lands on Today', await shown(R, '#pane-home'));
  // A fresh load straight on an old address.
  const V = await phone(rohan, { hash: '#vault' });
  ok('4. opening the app straight on #vault opens the Vault, with More lit', await shown(V, '#pane-vault') && await V.$eval('#tabs button[data-tab="menu"]', b => b.classList.contains('sel')));
  await V.context().close();
  // More holds the vault, the register, to do, Ekta and profile.
  await R.click('#tabs button[data-tab="menu"]');
  ok('4. More holds Vault, Family register, To do, Ekta and Profile', (await R.$$eval('#pane-menu .widget b', bs => bs.map(b => b.textContent))).join('|') === 'Vault|Family register|To do|Ask Ekta|The day|Notifications|Profile and settings|Health & contacts',
    (await R.$$eval('#pane-menu .widget b', bs => bs.map(b => b.textContent))).join('|'));
  await design(R, '#pane-menu', 'the More screen');
  await design(R, '#tabs', 'the five tabs and SOS');
  await R.click('#pane-menu [data-goto="vault"][data-sec="locator"]');
  ok('4. Family register opens from More', await shown(R, '#pane-vault') && await R.waitForFunction(() => { const s = document.querySelector('#vault-seg .sel'); return s && s.getAttribute('data-sec') === 'locator'; }, null, T).then(() => true, () => false));
  // Ekta: from Today and from Chat.
  await R.evaluate(() => { location.hash = '#home'; }); await shown(R, '#tn-ekta-today'); await R.click('#tn-ekta-today');
  const fromToday = await shown(R, '#pane-ekta');
  await R.evaluate(() => { location.hash = '#chat'; }); await shown(R, '#tn-ekta-chat'); await R.click('#tn-ekta-chat');
  ok('4. Ekta is one tap from Today and one tap from Chat', fromToday && await shown(R, '#pane-ekta'));
  // Together holds album, stories, recipes, festivals and the question.
  await R.evaluate(() => { location.hash = '#home'; }); await shown(R, '#pane-home');
  await R.click('#hamb');
  await shown(R, '#drawer .dpanel');
  const menu = await R.$$eval('#drawer .ditem', bs => bs.filter(b => b.getBoundingClientRect().height > 0).map(b => b.textContent.replace(/[▾\s]+/g, ' ').trim()));
  ok('4. the menu is a short list by the same five places, not thirty rows', menu.length <= 12 && ['Today', 'Chat', 'Together', 'Family', 'More'].every(x => menu.includes(x)) && !menu.includes('Vault'), menu.length + ': ' + menu.join(' / '));
  ok('4. Photo album and Family register are in the menu now', await R.$$eval('#drawer .ditem', bs => ['Photo album', 'Family register'].every(t => bs.some(b => b.textContent.trim() === t))));
  await design(R, '#drawer .dpanel', 'the menu');
  await R.click('#drawer .dparent[data-grp="fun"]');
  await shown(R, '#drawer [data-mbv="album"]'); await R.click('#drawer [data-mbv="album"]');
  ok('4. Photo album opens from the menu, under Together', await shown(R, '#ab-root') && await R.$eval('#tabs button[data-tab="fun"]', b => b.classList.contains('sel')));
  await R.evaluate(() => { location.hash = '#fun'; });
  ok('4. Together holds Album, Stories, Recipes, Festivals and the week\'s question', (await R.$$eval('#tn-together button', bs => bs.map(b => b.textContent.replace(/^\S+\s/, '')))).join('|') === 'Album|Stories|Recipes|Festivals|This week\'s question'
    && (await R.$$eval('#fun-seg button', bs => bs.map(b => b.getAttribute('data-sec')))).join() === 'plans,games,board,pasand');
  await design(R, '#tn-together', 'Together\'s shortcuts');
  for (const [v, root] of [['stories', '#mb-stories'], ['recipes', '#mb-recipes'], ['album', '#ab-root']]) {
    await R.evaluate(() => { location.hash = '#fun'; }); await shown(R, `#tn-together [data-mbv="${v}"]`);
    await R.click(`#tn-together [data-mbv="${v}"]`);
    ok(`4. ${v} opens from Together, with Together lit and a way back`, await shown(R, root) && await R.$eval('#tabs button[data-tab="fun"]', b => b.classList.contains('sel')) && await R.isVisible('#tn-mem-back'));
  }
  await R.click('#tn-mem-back');
  ok('4. "← Together" goes back', await shown(R, '#pane-fun'));
  await R.click('#tabs button[data-tab="people"]'); await shown(R, '#pane-people [data-goto="memory"][data-mbv="health"]');
  await R.click('#pane-people [data-goto="memory"][data-mbv="health"]');
  ok('4. Health & contacts opens from Family, and no longer carries stories, recipes or the album', await shown(R, '#book-list-view') && await R.$eval('#tabs button[data-tab="people"]', b => b.classList.contains('sel'))
    && !(await R.isVisible('#mb-switch')) && !(await R.isVisible('#pane-memory [data-mbv="stories"]')) && !(await R.isVisible('#pane-memory [data-mbv="album"]')));
  await R.click('#tn-tog-fest').catch(() => {});
  await R.evaluate(() => { location.hash = '#fun'; }); await shown(R, '#tn-tog-fest'); await R.click('#tn-tog-fest');
  ok('4. Festivals opens the family\'s festivals', await R.waitForFunction(() => { const f = document.getElementById('bond-fests'); const r = f.getBoundingClientRect(); return !f.closest('[hidden]') && r.top < innerHeight && r.bottom > 0; }, null, T).then(() => true, () => false));
  await R.click('#tn-tog-q');
  ok('4. "This week\'s question" opens it on Today', await shown(R, '#pane-home') && await shown(R, '#hd-today [data-hdsawaal]'));
  // To do: one list.
  await R.evaluate(() => { location.hash = '#care'; }); await shown(R, '#care-seg');
  const segs = await R.$$eval('#care-seg button', bs => bs.filter(b => b.getBoundingClientRect().width > 0).length);
  const filters = await R.$$eval('#task-filter-seg button', bs => bs.filter(b => b.getBoundingClientRect().width > 0).length);
  ok('4. To do opens on one list: three sections and three filters, not seven and eight', segs === 3 && filters <= 3 && await R.isVisible('#rlist'), segs + ' ' + filters);
  await R.click('#tn-care-more');
  ok('4. bills, costs, home staff and renewals are one tap away', (await R.$$eval('#care-seg button', bs => bs.filter(b => b.getBoundingClientRect().width > 0).length)) === 7 && (await R.getAttribute('#tn-care-more', 'aria-expanded')) === 'true');
  await R.click('#care-seg [data-sec="bills"]');
  ok('4. and each opens', await R.waitForFunction(() => { const d = document.querySelector('#pane-care .subsec[data-sec="bills"]'); return d && !d.hidden; }, null, T).then(() => true, () => false));
  await design(R, '#care-seg', 'To do\'s sections');
  await R.click('#tn-care-more');
  ok('4. folding them goes back to the list', await R.waitForFunction(() => { const d = document.querySelector('#pane-care .subsec[data-sec="rem"]'); return d && !d.hidden; }, null, T).then(() => true, () => false));
  // A laptop: the same five places group the sidebar.
  const W = await phone(rohan, { width: 1280 });
  const side = await W.$$eval('#tabs .inner > button, #tabs .subnav button', bs => bs.filter(b => b.getBoundingClientRect().height > 0).map(b => b.textContent.replace(/\d+\+?$/, '').trim()));
  ok('4. on a laptop the sidebar is the same grouping, and short', side.length <= 16 && side.slice(0, 5).join('|') === 'Today|Chat|Together|Family|Health & contacts' && side.includes('Vault') && side.includes('Profile') && !side.includes('More'), side.length + ': ' + side.join(' / '));
  await W.click('#tabs button[data-tab="fun"]');
  ok('4. a place shows its own shortcuts while you are in it', await shown(W, '#tabs .subnav[data-parent="fun"] [data-mbv="album"]') && !(await W.isVisible('#tabs .subnav[data-parent="care"] button')));
  await W.click('#tabs .subnav[data-parent="fun"] [data-mbv="stories"]');
  ok('4. Stories opens from the sidebar, under Together', await shown(W, '#mb-stories') && await W.$eval('#tabs button[data-tab="fun"]', b => b.classList.contains('sel')) && !(await W.$eval('#tabs button[data-tab="memory"]', b => b.classList.contains('sel'))));
  await wide(W, '#tabs', 'the sidebar');
  await W.context().close();
}

// ================================================================ 5. first run with an invite
{
  let taps = 0;
  const tap = async (page, sel) => { await page.click(sel); taps++; };
  // Rohan invites Papa's brother by name, as "Brother".
  await R.evaluate(() => { location.hash = '#people'; }); await shown(R, '#tn-invite-one');
  await R.evaluate(() => { navigator.share = undefined; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); });
  await R.click('#tn-invite-one');
  await shown(R, '#tn-inv-name'); await R.fill('#tn-inv-name', 'Chacha'); await R.selectOption('#tn-inv-role', 'brother');
  ok('5. the button says who is being invited: "Invite Chacha"', await sees(R, '#tn-inv-go', /^Invite Chacha$/));
  await R.click('#tn-inv-go');
  const link = await R.waitForFunction(() => window.__copied, null, T).then(h => h.jsonValue(), () => '');
  const href = (String(link).match(/https?:\/\/\S+/) || [''])[0];
  ok('5. the invite carries who they are to the family', /[?&]join=SHARMA24/.test(href) && /[?&]as=brother/.test(href) && /[?&]nm=Chacha/.test(href), href);
  await design(R, '#famcard', 'the family card with "Invite one person by name"');
  // A phone that has never seen Parwah opens the link.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const N = await ctx.newPage(); N.on('pageerror', e => errors.push('N: ' + e.message));
  await N.goto(href);
  ok('5. the link opens on the invite, not a pitch for strangers', await shown(N, '#ob-invite') && await sees(N, '#ob-invite-sub', /SHARMA24/));
  await tap(N, '#ac-mode [data-acmode="new"]');
  await N.fill('#au-phone', '98750 99001'); await N.fill('#au-name', 'Suresh'); await N.fill('#au-pin', '2957'); await N.fill('#au-pin2', '2957');
  await tap(N, '#au-go');
  ok('5. no tour for someone who came by an invite: straight to the join form', await shown(N, '#joincard') && !(await N.isVisible('#tour-step')));
  ok('5. it asks "Who are you to this family?" in plain words', /Who are you to this family\?/.test(await N.textContent('#joincard')) && !/equal admin/.test(await N.textContent('#joincard')));
  ok('5. and "Brother" is already chosen, with the code filled in', await N.$eval('#j-role .sel', b => b.getAttribute('data-role')) === 'brother' && (await N.inputValue('#j-code')) === 'SHARMA24' && await sees(N, '#tn-jrole-hint', /invited you as Brother/));
  await design(N, '#joincard', 'the join form');
  // Mother or Father is ASKED about the larger screen; nothing switches by itself.
  await N.click('#j-role [data-role="mother"]');
  ok('5. choosing "Mother" ASKS "Use the simpler, larger screen?" and switches nothing on', await shown(N, '#tn-j-ask') && /Use the simpler, larger screen\?/.test(await N.textContent('#tn-j-ask')) && !(await N.isChecked('#j-senior')));
  await N.click('#tn-j-ask [data-tnsenior="1"]');
  ok('5. "Yes, larger" turns it on', await N.isChecked('#j-senior'));
  await N.click('#tn-j-ask [data-tnsenior="0"]');
  ok('5. "No, the usual one" leaves it off', !(await N.isChecked('#j-senior')));
  await N.click('#j-role [data-role="grandmother"]');
  ok('5. a grandparent still starts with the big buttons on', await N.isChecked('#j-senior') && !(await N.isVisible('#tn-j-ask')));
  await N.click('#j-role [data-role="brother"]');
  await tap(N, '#j-go');
  ok('5. the family asks first: he waits', await shown(N, '#pending-step'));
  // Rohan sees it on Today and lets him in: one tap.
  await R.evaluate(() => { location.hash = '#home'; }); await fresh(R);
  ok('5. "Suresh is asking to join" is on Rohan\'s Today, saying who he is', await sees(R, '#tn-from [data-tnkind="join"]', /Suresh is asking to join/) && await sees(R, '#tn-from [data-tnkind="join"]', /brother/i));
  await R.click('#tn-from [data-tnjoin]');
  const joined = await until(async () => (await q1(`select id, created_at from members where circle_id = $1 and name = 'Suresh' and user_id is not null`, [fam])));
  await tap(N, '#pend-check');
  const inApp = await N.waitForFunction(() => { const m = document.getElementById('main'), t = document.getElementById('m-title'); return m && !m.hidden && t && /Sharma Family/.test(t.textContent); }, null, T).then(() => true, () => false);
  ok(`5. FIRST RUN WITH AN INVITE: ${taps} taps from the link to the family's Today (it was 21 taps and 16 screens)`, !!joined && inApp && taps <= 5, taps + ' taps');
  ok('5. with one family he goes straight in: no picker, no tour', inApp && !(await N.isVisible('#circle-step')) && !(await N.isVisible('#tour-step')));
  ok('5. the tour is written down as done, so it never comes back', !!(await until(async () => (await q1(`select toured_at from users where phone = '+919875099001'`)).toured_at)));
  // Signing in again later: straight in.
  const tok = await N.evaluate(() => localStorage.getItem('parwah-token'));
  await N.evaluate(() => { localStorage.removeItem('parwah'); }); await N.goto(BASE + '/');
  ok('5. opening Parwah again with one family goes straight in, with no "tap any one to open it"', await N.waitForFunction(() => { const m = document.getElementById('main'); return m && !m.hidden; }, null, T).then(() => true, () => false) && !(await N.isVisible('#circle-step')) && !!tok);
  // His bell: nothing from before he joined, and not his own asking.
  await N.evaluate(() => { location.hash = '#notifs'; }); await shown(N, '#pane-notifs');
  await N.waitForFunction(() => document.getElementById('nlist').textContent.length > 0, null, T);
  ok('5. a new member\'s bell shows nothing from before he joined, and not his own "asked to join"', !/asked to join/.test(await N.textContent('#nlist')) && !/Bua/.test(await N.textContent('#nlist')) && (await N.isHidden('#bell-dot')), await N.textContent('#nlist'));
  // On an older member's bell, "asked" and "joined" about Suresh are one line.
  await R.click('#bell'); await shown(R, '#pane-notifs');
  await R.waitForFunction(() => /Suresh/.test(document.getElementById('nlist').textContent), null, T).catch(() => {});
  ok('5. on Rohan\'s bell "asked to join" and "joined" fold into one line', ((await R.textContent('#nlist')).match(/Suresh/g) || []).length === 1 && /Suresh joined/.test(await R.textContent('#nlist')), await R.textContent('#nlist'));
  // The setup list ticks "Invite someone" by itself.
  const F = await phone(priya, { frHide: false });
  await shown(F, '#firstrun .frstep');
  ok('5. "Invite someone to the family" ticks itself once others are here', await F.$$eval('#firstrun .frstep', bs => bs.some(b => /Invite someone to the family/.test(b.textContent) && b.classList.contains('done'))));
  await F.context().close();
  await ctx.close();
}

// ================================================================ 6. offline
{
  // SOS with no network.
  await P.evaluate(() => { location.hash = '#home'; });
  await P.context().setOffline(true);
  await P.click('#sos-fab'); await shown(P, '#ss-now'); await P.click('#ss-now');
  ok('6. with no network the heading says "SOS NOT sent"', await sees(P, '#ss-live-title', /SOS NOT sent/) && !/SOS sent/.test(await P.textContent('#ss-live-title')));
  ok('6. and nothing on the screen says it went, or that anyone is waiting to answer', !(await P.isVisible('#ss-loc')) && !(await P.isVisible('#ss-rec')) && !(await P.isVisible('#ss-who'))
    && !/alert still went|Waiting for someone|has been alerted/.test(await P.evaluate(() => [...document.querySelectorAll('#ss-live *')].filter(e => !e.closest('[hidden]') && e.children.length === 0).map(e => e.textContent).join(' '))));
  ok('6. it says plainly that the family has NOT been told', /Your family has NOT been told/.test(await P.textContent('#ss-status')));
  const calls = await P.$$eval('#ss-calls a', as => as.map(a => a.textContent.trim() + '=' + a.getAttribute('href')));
  ok('6. Call 112 and "Call Rohan" (the first family contact who can be reached), never Dadaji', /Call 112=tel:112/.test(calls[0]) && /📞 Call Rohan=tel:/.test(calls[1]) && !calls.some(c => /Dadaji|9811200009/.test(c)), calls.join(' | '));
  ok('6. Call and SMS are the largest things on the screen', await P.evaluate(() => { const h = s => document.querySelector(s).getBoundingClientRect().height;
    return h('#ss-calls a') >= 72 && h('#ss-sms') >= 72 && /^sms:/.test(document.getElementById('ss-sms').getAttribute('href')) && h('#ss-wa') < h('#ss-sms'); }));
  ok('6. no SOS was made', (await q1(`select count(*)::int as n from sos where member_id = $1`, [papa.id]).catch(() => ({ n: 0 }))).n === 0);
  await design(P, '#ss-live', 'the SOS screen when it did not go');
  await P.context().setOffline(false);
  await P.click('#tn-sos-retry');
  ok('6. "Try to send it again" sends it once the network is back', await sees(P, '#ss-live-title', /SOS sent/) && !!(await until(async () => (await q1(`select 1 as x from sos where member_id = $1`, [papa.id]).catch(() => null)))) && await P.isVisible('#ss-who'));
  await P.click('#ss-safe');
  await gone(P, '#sosscreen');
  // The SOS in the family chat is read on the reader's own clock.
  await R.evaluate(() => { location.hash = '#chat'; });
  await R.evaluate((id) => { const b = document.querySelector('#clist [data-open="' + id + '"]'); if (b) b.click(); }, famChat);
  ok('6. the SOS message in the chat names no far-away clock ("UTC")', await sees(R, '#cmsgs', /SOS from Papa at \d{1,2}:\d{2}/) && !/SOS from Papa at [^.]*(UTC|GMT)/.test(await R.textContent('#cmsgs')), (await R.textContent('#cmsgs')).slice(-300));
  // Chat with no network.
  await R.context().setOffline(true);
  await R.fill('#msg', 'Papa aap theek ho?'); await R.click('#send');
  ok('6. offline, the typed message is kept on the screen: "Not sent. Tap to retry"', await sees(R, '#cmsgs .tn-unsent.failed', /Papa aap theek ho\?/) && await sees(R, '#cmsgs .tn-unsent.failed', /Not sent\. Tap to retry/));
  ok('6. nothing reached the server', (await q1(`select count(*)::int as n from messages where text = 'Papa aap theek ho?'`)).n === 0);
  await design(R, '#chatview', 'the chat, with the bubble that did not go');
  await R.click('#cmsgs .tn-unsent.failed');
  ok('6. a tap tries again; still no network, so it is still kept', await sees(R, '#cmsgs .tn-unsent.failed', /Not sent\. Tap to retry/) && (await q1(`select count(*)::int as n from messages where text = 'Papa aap theek ho?'`)).n === 0);
  await R.context().setOffline(false);
  await R.evaluate(() => { const b = document.querySelector('#cmsgs .tn-unsent.failed'); if (b) b.click(); });
  ok('6. back on the network it goes, once', !!(await until(async () => (await q1(`select count(*)::int as n from messages where text = 'Papa aap theek ho?'`)).n === 1)) && await gone(R, '#cmsgs .tn-unsent'));
}

// ================================================================ 7. the small words
{
  // A new medicine asks when it is taken.
  await R.evaluate(() => { location.hash = '#memory'; }); await shown(R, '#b-kind [data-k="med"]');
  await R.click('#b-kind [data-k="med"]');
  await R.selectOption('#b-about', papa.id); await R.fill('#b-name', 'Amlopres 5');
  await R.click('#b-save');
  ok('7. after saving a medicine for Papa it asks "When does Papa take it?"', await shown(R, '#dsheet') && await sees(R, '#ds-title', /^When does Papa take it\?$/));
  await R.click('#ds-save');
  ok('7. and the times are saved there', !!(await until(async () => (await q1(`select 1 as x from medicine_schedules s join family_book b on b.id = s.medicine_id where b.name = 'Amlopres 5'`).catch(() => null)))));
  // A person's page opens with what is recorded.
  await R.evaluate((id) => { const b = document.createElement('button'); b.setAttribute('data-person', id); b.hidden = true; document.body.appendChild(b); b.click(); b.remove(); }, papa.id);
  await shown(R, '#pane-person');
  ok('7. Papa\'s page opens with what IS recorded: his medicine', await sees(R, '#pp-health', /Amlopres 5/));
  ok('7. what is not recorded yet is folded under "Add more", last on the page', await R.$eval('#pp-todo-card', d => d.tagName === 'DETAILS' && !d.open && !d.hidden && /^Add more/.test(d.querySelector('summary').textContent))
    && !/❌/.test(await R.textContent('#pane-person')) && !(await R.isVisible('#pp-todo [data-pptodo]')));
  ok('7. no empty card says "Nothing recorded" above it', await R.$$eval('#pane-person .card', cs => !cs.some(c => !c.hidden && c.getBoundingClientRect().height > 0 && /^Nobody recorded|^Nothing recorded yet/.test((c.querySelector('.feed') || c).textContent.trim()))));
  ok('7. "When someone passes away" is not on a living person\'s page', !(await R.isVisible('#al-pp-link')));
  await R.click('#pp-todo-card summary');
  ok('7. "Add more" opens to each thing, a tap from being added', await shown(R, '#pp-todo [data-pptodo]'));
  await design(R, '#pp-todo-card', 'a person\'s page: Add more');
}

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`todaynav.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`todaynav.e2e: ${pass}/${pass} checks pass`);
