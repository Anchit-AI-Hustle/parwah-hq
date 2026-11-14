// CONSENT, CONTROL AND CARE BOTH WAYS, END TO END: a real browser, the real
// API and a real PostgreSQL.
//
// Papa, the person the family looks after, sends an Ashirwad from his own
// big button and asks Rohan how his day is; Rohan answers each with one tap.
// Rohan starts a trip and taps Reached safely; Meera, whom he chose, is the
// one who sees it and is asked to call when it runs late. Meera answers a
// late home-staff alert in one tap. Papa chooses his own call time, then
// says "No daily call, thank you". He turns on "Show me the costs" himself.
// Meera says "Not now" to an ask to share, answers "Announce my arrivals",
// and reads who looked at her location. Papa chooses who can open his
// emergency card; the one he chose opens it, also with no connection, and
// the one he did not is told why not. An adult marks a child, and the child
// is shown no costs and no salaries.
//
// Every new surface is measured like every other screen: 44px targets, a
// 12px floor, AA contrast in light and dark, nothing sideways at 320, 390
// or 1280. Nothing here waits a fixed time and then looks: each step waits
// for the element or the state it is about to check.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('consent.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('consent.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('consent.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function user(name) {
  const phone = '+9198450' + String(++n).padStart(5, '0');
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
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: w.role || 'family', circleName: w.circleName }));
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

// ---- one family, through the real API
const circleApi = HANDLERS.circle;
async function family(circleName, names) {
  const out = {}; let code = null, circleId = null;
  for (const [name, role] of names) {
    const u = await user(name);
    const r = code
      ? await call(circleApi, { token: u.token, body: { action: 'join', code, memberName: name, userId: u.userId, role } })
      : await call(circleApi, { token: u.token, body: { action: 'create', kind: 'family', memberName: name, circleName, userId: u.userId, role } });
    if (!code) { code = r.code; circleId = (await admin.query('select id from circles where code = $1', [code])).rows[0].id; await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]); }
    out[name] = { ...u, memberId: r.memberId, code, circleName, role };
  }
  return { code, id: circleId, m: out };
}
const F = await family('Sharma Family', [['Rohan', 'family'], ['Meera', 'family'], ['Papa', 'parent'], ['Chintu', 'family']]);
const { Rohan: rohan, Meera: meera, Papa: papa, Chintu: chintu } = F.m;
await admin.query(`update members set dob = '1986-01-01', phone = '+919811100002' where id = $1`, [rohan.memberId]);
await admin.query(`update members set dob = '1988-03-03', phone = '+919811100001' where id = $1`, [meera.memberId]);
await admin.query(`update members set dob = '1955-06-06' where id = $1`, [papa.memberId]);
const api = (h, who, body) => call(HANDLERS[h], { token: who.token, body: { code: who.code, memberId: who.memberId, ...body } });
const one = async (q, p) => (await admin.query(q, p)).rows[0];
const until = async (fn) => { for (let i = 0; i < 100; i++) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const home = (who, opts) => phone(who, { hash: '#home', ...(opts || {}) });
const toastSays = (page, re) => sees(page, '#toast', re);

// =================================================== B6: Ashirwad, from Papa
const PP = await home(papa);
ok('Papa\'s Today has the big Ashirwad button with his other big buttons', await shown(PP, '#seniorui #cn-bless-big'));
await PP.click('#cn-bless-big');
ok('it opens the Ashirwad sheet, with the family to choose from', await shown(PP, '#cn-sheet') && await sees(PP, '#cn-who', /Everyone.*Rohan.*Meera/s), await PP.textContent('#cn-who'));
ok('and the one-tap lines', await sees(PP, '#cn-lines', /Khush raho.*All the best for the exam.*Reach safely/s));
ok('"How is your day?" waits until one person is chosen', await PP.isDisabled('#cn-howday'));
await design(PP, '#cn-sheet .mp', 'the Ashirwad sheet');
await PP.click('#cn-who [data-cnto="' + rohan.memberId + '"]');
await PP.click('#cn-lines [data-cnline="exam"]');
ok('one tap sends it, and says so', await toastSays(PP, /Ashirwad sent/) && await gone(PP, '#cn-sheet'));
ok('it is saved for Rohan alone', await until(async () => (await one(`select count(*)::int as n from ashirwad where to_member = $1 and line = 'All the best for the exam'`, [rohan.memberId])).n === 1));

const PR = await home(rohan);
ok('Rohan sees the card on Today', await sees(PR, '#cn-today [data-cncard]', /Ashirwad from Papa.*All the best for the exam/s));
ok('with a one-tap Pranam and a voice reply', await shown(PR, '#cn-today [data-cnpranam]') && await shown(PR, '#cn-today [data-cnvoice]'));
await design(PR, '#cn-today', 'an Ashirwad card on Today');
await PR.click('#cn-today [data-cnvoice]');
ok('the voice reply opens the recorder only, with no list of people', await shown(PR, '#cn-sheet') && await PR.isHidden('#cn-compose') && await PR.isHidden('#cn-howday-box') && /Voice reply/.test(await PR.textContent('#cn-title')));
await PR.click('#cn-x');
await PR.click('#cn-today [data-cnpranam]');
ok('Pranam is one tap', await toastSays(PR, /Pranam sent/) && await until(async () => (await one(`select count(*)::int as n from ashirwad_replies where member_id = $1 and kind = 'pranam'`, [rohan.memberId])).n === 1));
ok('and the card leaves his Today', await PR.waitForFunction(() => !document.querySelector('#cn-today [data-cncard]'), null, T).then(() => true, () => false));
await PP.reload(); await PP.waitForSelector('#seniorui #cn-bless-big', T);
ok('Papa sees that Rohan answered', await sees(PP, '#cn-today [data-cnanswers]', /Rohan.*Pranam/s));

// "How is your day?": the parent checks on the child.
await PP.click('#cn-bless-big');
await PP.click('#cn-who [data-cnto="' + rohan.memberId + '"]');
ok('with Rohan chosen, the ask names him', await sees(PP, '#cn-howday', /Ask Rohan: how is your day/));
await PP.click('#cn-howday');
ok('Papa asks Rohan how his day is', await toastSays(PP, /Asked Rohan/));
await PR.reload();
ok('Rohan gets the ask, with one-tap answers', await sees(PR, '#cn-today [data-cncard]', /Papa asks.*How is your day/s) && await PR.locator('#cn-today [data-cnanswer]').count() >= 3);
await design(PR, '#cn-today', 'a How is your day card on Today');
await PR.click('#cn-today [data-cnanswer][data-k="busy"]');
ok('he answers with one tap', await toastSays(PR, /answer is sent/) && await until(async () => (await one(`select count(*)::int as n from ashirwad_replies where kind = 'answer' and line = 'Busy, but all fine'`)).n === 1));

// ======================================================= B7: Reached safely
ok('anyone can start a trip from Today', await shown(PR, '#cn-trip-open'));
await PR.click('#cn-trip-open');
ok('the sheet asks where, how, by when and who to tell', await shown(PR, '#cn-tripsheet') && await sees(PR, '#cn-trip-tell', /Meera.*Papa/s));
await design(PR, '#cn-tripsheet .mp', 'the Reached safely sheet');
await PR.click('#cn-trip-go');
ok('a trip with no place says so, in words', await sees(PR, '#cn-trip-err', /where you are going/));
await PR.fill('#cn-trip-to', 'Delhi');
await PR.click('#cn-trip-go');
ok('a trip with nobody to tell says so', await sees(PR, '#cn-trip-err', /at least one person/));
await PR.check('#cn-trip-tell input[value="' + meera.memberId + '"]');
await PR.click('#cn-trip-go');
ok('the trip starts', await gone(PR, '#cn-tripsheet') && await sees(PR, '#cn-today [data-cntrip]', /On your way to Delhi.*Meera/s));
await design(PR, '#cn-today', 'my trip on Today');
const PM = await home(meera);
ok('Meera, who was chosen, sees it', await sees(PM, '#cn-today', /Rohan is on the way to Delhi, by train/));
ok('Papa, who was not, does not', await (async () => { await PP.reload(); await PP.waitForSelector('#seniorui #cn-bless-big', T); await sees(PP, '#cn-today [data-cnanswers]', /Rohan/); return !/Delhi/.test(await PP.textContent('#cn-today')); })());
await admin.query(`update trips set expect_at = now() - interval '45 minutes'`);
await PM.reload();
ok('45 minutes past the time, Meera is asked gently to call', await sees(PM, '#cn-today', /Rohan has not tapped Reached safely yet.*A call may help/s) && await shown(PM, '#cn-today a[href^="tel:"]'));
await design(PM, '#cn-today', 'a late trip on Today');
await PR.reload();
await PR.waitForSelector('#cn-today [data-cnreached]', T);
await PR.click('#cn-today [data-cnreached]');
ok('Rohan taps Reached safely', await toastSays(PR, /told you reached/) && await until(async () => (await one(`select status from trips`)).status === 'reached'));
await PM.reload();
ok('and Meera sees he reached', await sees(PM, '#cn-today', /Rohan reached Delhi safely/));

// ============================================================ B4: home staff
let r = await api('care', rohan, { action: 'staff_add', name: 'Sunita Devi', role: 'cook', salary: 9000, arriveTime: '08:00', workDays: [0, 1, 2, 3, 4, 5, 6], ownerId: meera.memberId });
const sid = r.id;
const sday = (await one(`select to_char(now() at time zone tz, 'YYYY-MM-DD') as d from home_staff where id = $1`, [sid])).d;
await admin.query(`delete from staff_attendance where staff_id = $1`, [sid]);
await admin.query(`insert into staff_late_alert (staff_id, day) values ($1, $2) on conflict do nothing`, [sid, sday]);
await PM.reload();
ok('the named owner sees "not marked in yet" on Today, with two one-tap answers', await sees(PM, '#cn-today [data-cnlate]', /Sunita is not marked in yet.*Sunita came.*On leave today/s));
await design(PM, '#cn-today', 'the staff answer on Today');
await PR.reload(); await PR.waitForSelector('#cn-ways', T);
ok('nobody else is asked', await (async () => { await sees(PR, '#cn-today', /./, { timeout: 1500 }); return !(await PR.locator('#cn-today [data-cnlate]').count()); })());
await PM.click('#cn-today [data-cnstaff][data-st="leave"]');
ok('"On leave today" is one tap', await toastSays(PM, /on leave today/) && await until(async () => ((await one(`select status from staff_attendance where staff_id = $1 and day = $2`, [sid, sday])) || {}).status === 'leave'));
ok('and the card goes', await PM.waitForFunction(() => !document.querySelector('#cn-today [data-cnlate]'), null, T).then(() => true, () => false));

// ============================================================ B2: call rota
r = await api('care', rohan, { action: 'rota_create', aboutMemberId: papa.memberId, memberIds: [rohan.memberId, meera.memberId], time: '19:00', tz: 'Asia/Kolkata' });
ok('a rota is set up for Papa', r.status === 201 && r.toldPerson === true, JSON.stringify(r));
await PP.reload();
ok('Papa is told on his own Today, with his two choices', await sees(PP, '#cn-today [data-cnrota]', /Your family calls you each day.*Save my time.*No daily call, thank you/s));
await design(PP, '#cn-today', 'the call rota card for the person who is called');
await PP.fill('#cn-today [data-cnrotatime]', '20:30');
await PP.click('#cn-today [data-cnrotasave]');
ok('he chooses the time that suits him', await toastSays(PP, /time is saved/) && await until(async () => {
  const d = await one(`select due_at from requests where template = 'callrota' and about_member = $1 and status in ('open','assigned','claimed')`, [papa.memberId]);
  return !!d && await PP.evaluate((iso) => { const x = new Date(iso); return x.getHours() === 20 && x.getMinutes() === 30; }, new Date(d.due_at).toISOString());
}));
await PP.waitForSelector('#cn-today [data-cnrotano]', T);
await PP.click('#cn-today [data-cnrotano]');
ok('saying no asks first', await shown(PP, '#asksheet') && await sees(PP, '#as-q', /No daily call/));
await PP.click('#as-yes');
ok('"No daily call, thank you" stops the rota', await until(async () => (await one(`select count(*)::int as n from requests where template = 'callrota' and about_member = $1 and status in ('open','assigned','claimed')`, [papa.memberId])).n === 0));
await PP.reload();
ok('and his Today says so, with a way back', await sees(PP, '#cn-today [data-cnrotaoff]', /No daily call, as you asked.*I would like a daily call again/s));

// =============================================================== B3: costs
await api('care', rohan, { action: 'expense_add', amount: 500, category: 'medicines', forMemberId: papa.memberId });
await api('care', papa, { action: 'expense_add', amount: 120, category: 'groceries' });
const careSec = async (page, sec) => { await page.evaluate(() => { location.hash = '#care'; }); await page.waitForSelector('#care-seg [data-sec="' + sec + '"]', { state: 'visible', ...T }); await page.click('#care-seg [data-sec="' + sec + '"]'); };
await careSec(PP, 'expenses');
ok('Papa has a "Show me the costs" switch, off', await shown(PP, '#cn-costs-row') && !(await PP.isChecked('#cn-costs')) && await sees(PP, '#cn-costs-hint', /only what you paid yourself/));
ok('and reads only what he paid', await sees(PP, '#ex-list', /120/) && !/500/.test(await PP.textContent('#ex-list')) && !/500/.test(await PP.textContent('#ex-sum')));
await design(PP, '#pane-care', 'Costs for the person cared for');
await PP.check('#cn-costs');
ok('he turns it on himself and reads everything', await sees(PP, '#ex-list', /500/) && await sees(PP, '#cn-costs-hint', /every cost/) && (await one(`select show from care_cost_prefs where member_id = $1`, [papa.memberId])).show === true);

// ============================================================ B1: location
await call(HANDLERS.settings, { token: rohan.token, query: { area: 'location' }, body: { code: rohan.code, memberId: rohan.memberId, action: 'place_add', name: 'Home', lat: 18.5204, lng: 73.8567, radius: 200 } });
await call(HANDLERS.settings, { token: rohan.token, query: { area: 'location' }, body: { code: rohan.code, memberId: rohan.memberId, action: 'ask', targetId: meera.memberId } });
await PM.evaluate(() => { location.hash = '#people'; });
ok('Meera sees who asked, with Share and Not now', await sees(PM, '#cn-loc-asks [data-cnask]', /Rohan would like to know where you are.*Share my location.*Not now/s));
ok('and is asked, once, about announcing her arrivals', await sees(PM, '#cn-loc-asks [data-cnannask]', /Announce your arrivals.*Yes, announce.*No, thank you/s));
ok('"Announce my arrivals" is off until she says yes', !(await PM.isChecked('#cn-ann')));
await design(PM, '#loc-card', 'the location card with an ask and the switch');
await PM.click('#cn-loc-asks [data-cnasknot]');
ok('Not now is one tap, and mutes that asker for 7 days', await toastSays(PM, /not ask again for 7 days/) && await until(async () => {
  const a = await one(`select status, muted_until from location_asks where target_id = $1`, [meera.memberId]);
  return a && a.status === 'declined' && new Date(a.muted_until).getTime() - Date.now() > 6.9 * 86400000;
}));
ok('the ask leaves her screen', await PM.waitForFunction(() => !document.querySelector('#cn-loc-asks [data-cnask]'), null, T).then(() => true, () => false));
await PM.click('#cn-loc-asks [data-cnann="yes"]');
ok('she says yes to announcing her arrivals', await until(async () => ((await one(`select announce from location_consent where member_id = $1`, [meera.memberId])) || {}).announce === true)
   && await PM.waitForFunction(() => document.getElementById('cn-ann').checked && !document.querySelector('#cn-loc-asks [data-cnannask]'), null, T).then(() => true, () => false));
await PM.uncheck('#cn-ann');
ok('and can switch it off again herself', await until(async () => (await one(`select announce from location_consent where member_id = $1`, [meera.memberId])).announce === false));
// Meera shares; Rohan looks; Meera sees who looked.
await call(HANDLERS.settings, { token: meera.token, query: { area: 'location' }, body: { code: meera.code, memberId: meera.memberId, action: 'share', lat: 18.5204, lng: 73.8567, accuracy: 10 } });
await PR.evaluate(() => { location.hash = '#people'; });
ok('Rohan opens Family and sees Meera on the list', await sees(PR, '#loc-list', /Meera/));
ok('his look is written down', await until(async () => (await one(`select count(*)::int as n from location_looks where member_id = $1 and viewer_id = $2`, [meera.memberId, rohan.memberId])).n === 1));
await PM.reload(); await PM.waitForSelector('#loc-list .crow', T);
ok('Meera reads "Seen by Rohan" on her own screen', await sees(PM, '#cn-seen', /Seen by Rohan, (just now|\d+ min ago)/));
await design(PM, '#loc-card', 'the location card with who looked');
await admin.query(`update location_shares set updated_at = now() - interval '12 minutes' where member_id = $1`, [meera.memberId]);
await PR.reload(); await PR.waitForSelector('#loc-list .crow', T);
ok('a position 12 minutes old says "Last seen", on its own line, never "updated"', await sees(PR, '#loc-list [data-cnlast="' + meera.memberId + '"]', /^Last seen 1[23] min ago$/)
   && !/updated/.test(await PR.textContent('#loc-list .crow.late small')));
await design(PR, '#loc-card', 'the location card with a last seen line');

// ==================================================== B8: the emergency card
await PP.evaluate(() => { location.hash = '#home'; });
await PP.click('#btn-ecard');
ok('Papa opens his own card, with the legal line', await shown(PP, '#ecard') && /Papa/.test(await PP.textContent('#ec-name')) && await sees(PP, '#cn-ec-legal', /record your family keeps.*not medical advice/s));
ok('and chooses who can open it and who to call', await sees(PP, '#cn-ec-mine', /Who can open my card.*Rohan.*Who to call first/s));
await design(PP, '#cn-ec-mine', 'my choices on my own emergency card');
await PP.check('#cn-ec-mine [data-cnecv] input[value="' + rohan.memberId + '"]');
await PP.check('#cn-ec-mine [data-cnecc] input[value="' + meera.memberId + '"]');
await PP.click('#cn-ec-mine [data-cnecsave]');
ok('his choices are saved', await toastSays(PP, /Saved/) && await until(async () => { const e = await one(`select viewers, contacts from ecard_prefs where member_id = $1`, [papa.memberId]); return e && e.viewers.join() === rohan.memberId && e.contacts.join() === meera.memberId; }));
ok('and the card now says who to call first', await sees(PP, '#ec-body .cn-ec-contacts', /Call first.*Meera/s));
ok('the card has a Print button', await shown(PP, '#ec-print'));
// Printed: the card, the legal line, and not the choices.
await PP.emulateMedia({ media: 'print' });
ok('on paper there is the card and the legal line, and not his private choices', await PP.evaluate(() => {
  const vis = (s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; };
  return vis('#ecard') && vis('#cn-ec-legal') && !vis('#cn-ec-mine') && !vis('#ec-print');
}));
await PP.emulateMedia({ media: 'screen' });
await PP.click('#ec-x');
// Rohan, chosen, opens Papa's card from the family tree; Meera, not chosen, cannot.
const openFromTree = async (page, id) => { await page.evaluate(() => { location.hash = '#home'; }); await page.evaluate(() => { location.hash = '#people'; }); await page.waitForSelector('#members [data-mprof="' + id + '"]', T); await page.click('#members [data-mprof="' + id + '"]'); await page.waitForSelector('#msheet', { state: 'visible', ...T }); await page.click('#mp-ecard'); };
await openFromTree(PR, papa.memberId);
ok('Rohan, whom Papa chose, opens it and sees who to call first', await shown(PR, '#ecard') && /Papa/.test(await PR.textContent('#ec-name')) && await sees(PR, '#ec-body .cn-ec-contacts', /Meera/));
ok('he is not shown Papa\'s choices', await PR.isHidden('#cn-ec-mine'));
await PR.click('#ec-x');
// Offline, once opened: it still opens.
await PR.context().setOffline(true);
await PR.evaluate(() => { document.getElementById('msheet').hidden = true; });
await PR.click('#members [data-mprof="' + papa.memberId + '"]'); await PR.waitForSelector('#msheet', { state: 'visible', ...T }); await PR.click('#mp-ecard');
ok('with no connection, a card opened once still opens, with who to call', await shown(PR, '#ecard') && await sees(PR, '#ec-body .cn-ec-contacts', /Meera/));
await PR.context().setOffline(false);
await PR.click('#ec-x');
await openFromTree(PM, papa.memberId);
ok('Meera, whom Papa did not choose, is told why it stays shut', await toastSays(PM, /has not chosen you/) && await PM.isHidden('#ecard'));

// ===================================================== B5: a child's standing
await admin.query(`update members set dob = null where id = $1`, [chintu.memberId]);
await PR.reload(); await PR.waitForSelector('#members [data-mprof="' + chintu.memberId + '"]', T);
await PR.waitForSelector('#cn-today[data-ready]', { state: 'attached', ...T });
await PR.click('#members [data-mprof="' + chintu.memberId + '"]');
ok('an adult can mark someone with no date of birth as a child', await shown(PR, '#cn-child') && /Mark as a child/.test(await PR.textContent('#cn-child')));
await design(PR, '#msheet .mp', 'a person\'s sheet with the child button');
await PR.click('#cn-child');
ok('it says plainly what a child is and is not sent', await sees(PR, '#as-sub', /plans, cards, games.*not sent SOS details.*the costs/s));
await PR.click('#as-yes');
// Chintu is on Parwah, so it is not one person's word: he, or a second
// adult, has to agree. Rohan is told so, and nothing changes until then.
ok('Rohan is told that Chintu or another adult has to agree first', await toastSays(PR, /another adult has to agree first/)
  && (await one(`select is_child from members where id = $1`, [chintu.memberId])).is_child === false);
const cnAsk = await one(`select id from standing_asks where kind = 'child_mark' and status = 'pending' and target_member = $1`, [chintu.memberId]);
ok('the request is waiting for a second voice', !!cnAsk);
// Meera, another adult, is asked in the Family tab and says yes there.
{
  const PM2 = await home(meera);
  await PM2.evaluate(() => { location.hash = '#people'; });
  await PM2.waitForSelector('#ac-famlist [data-acyes="' + cnAsk.id + '"]', T);
  ok('a second adult is asked in the Family tab, in plain words', await sees(PM2, '#ac-famlist', /Rohan says Chintu is under 18\. Is that right\?/));
  await design(PM2, '#ac-famcard', 'the family card asking a second adult about a child mark');
  await PM2.click('#ac-famlist [data-acyes="' + cnAsk.id + '"]');
  await PM2.close();
}
ok('Chintu is marked', await until(async () => (await one(`select is_child from members where id = $1`, [chintu.memberId])).is_child === true));
const PC = await home(chintu);
ok('Chintu still gets the warm things: Ashirwad and Reached safely are on his Today', await shown(PC, '#cn-bless-open') && await shown(PC, '#cn-trip-open'));
await careSec(PC, 'expenses');
ok('the costs screen tells him they are kept by the adults, with nothing to read or add', await sees(PC, '#cn-costs-hint', /kept by the adults/) && await PC.isHidden('#cn-ex-addcard') && await PC.isHidden('#cn-costs-row') && !/500|120/.test(await PC.textContent('#ex-list')));
await PC.click('#care-seg [data-sec="staff"]');
ok('the home staff list shows him who helps, with no salary', await sees(PC, '#st-list', /Sunita Devi/) && !/9,000|9000|Mark paid|advance/i.test(await PC.textContent('#st-list')));
await design(PC, '#pane-care', 'Home staff for a child');

// ---- at a laptop width nothing scrolls sideways either
for (const [page, hash, sel] of [[PP, '#home', '#cn-today'], [PM, '#people', '#loc-card']]) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(sel, { state: 'attached', ...T });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await page.evaluate(measureIn, sel);
  ok('design at 1280px: ' + sel + ' has nothing sideways, 12px text and AA contrast', m.overflow <= 0 && m.inner <= 1 && m.bad.filter(b => !/^small /.test(b)).length === 0, JSON.stringify(m).slice(0, 300));
}

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`consent.e2e: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`consent.e2e: ${pass}/${pass} checks pass`);
