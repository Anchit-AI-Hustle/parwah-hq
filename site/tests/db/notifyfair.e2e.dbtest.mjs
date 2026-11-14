// NOTIFICATIONS, "CAN BE REACHED", THE SELF-CHECK AND A LATE TAP - in a real
// browser, against the real handlers and a real database.
//
// What a person sees and does:
//   - Profile has a Notifications card in plain words: quiet hours with two
//     times, six switches, and every change is saved as it is made, for
//     every family the person is in;
//   - an adult sees a dot for each person (can an alert reach them), and on
//     Today a gentle card when someone looked after has nobody whose phone
//     would ring; a child sees neither;
//   - "Is Parwah working?" says, line by line, what is on and what to do;
//   - "All is well" pressed while the server cannot be reached waits on the
//     phone, then arrives once with the time it was pressed;
//   - all of it holds the design rules at 320 and 390, light and dark.
//
//   PW_CHROMIUM=/opt/pw-browsers/chromium PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_sf_e2e_test \
//     node --import ./site/tests/db/register.mjs site/tests/db/notifyfair.e2e.dbtest.mjs
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('notifyfair.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('notifyfair.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.CRON_SECRET;
delete process.env.VERCEL_ENV;
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'TWILIO_ACCOUNT_SID']) delete process.env[k];

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('notifyfair.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');
const rows = async (q, p) => (await admin.query(q, p)).rows;

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { ensurePushSchema, pushSeams } = await import('../../../api/_push.mjs');
await ensureSchema(db());
await ensurePushSchema(db());
pushSeams.send = async () => ({});   // nothing leaves this machine

let n = 0;
async function user(name) {
  const phone = '+9198640' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await rows(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                         values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V]))[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}
async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.6.0.' + (++n % 250) }, query, body };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...json, status };
}

// The server can be made unreachable for one kind of request.
const down = { events: false };
const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/\/$/, '');
    if (name === 'events' && req.method === 'POST' && down.events) { req.socket.destroy(); return; }
    const h = HANDLERS[name];
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

async function phone(who, { hash = '#profile', role = 'family', width = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([w, r]) => {
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: r, circleName: w.circleName }));
  }, [who, role]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  await page.waitForFunction(() => !document.getElementById('main').hidden, null, T);
  return page;
}
const sees = (page, sel, re, opts) => page.waitForFunction(([s, src, fl]) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && new RegExp(src, fl).test(e.textContent); },
  [sel, re.source, re.flags], opts || T).then(() => true, () => false);
const shown = (page, sel) => page.waitForSelector(sel, { state: 'visible', ...T }).then(() => true, () => false);
const gone = (page, sel) => page.waitForSelector(sel, { state: 'hidden', ...T }).then(() => true, () => false);
const untilDb = async (q, p, cond) => { const t0 = Date.now(); for (;;) { const r = await rows(q, p); if (cond(r)) return r; if (Date.now() - t0 > T.timeout) return r; await new Promise(x => setImmediate(x)); } };

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
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) {
      // The label is the target: it must itself be tall enough.
      const lr = el.closest('label').getBoundingClientRect();
      if (lr.height < 43.5) out.bad.push('small label ' + el.closest('label').textContent.trim().slice(0, 20) + ' ' + Math.round(lr.height));
      out.seen++; return;
    }
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
async function design(page, sel, label, widths = [320, 390]) {
  const was = page.viewportSize(); const bad = []; let seen = 0;
  for (const wd of widths) for (const sc of ['light', 'dark']) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc });
    await page.waitForFunction(([w, dark]) => innerWidth === w && matchMedia('(prefers-color-scheme: dark)').matches === dark, [wd, sc === 'dark'], T);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    // The card is drawn from a request: measure it once it is on screen.
    await page.waitForFunction(q => { const e = document.querySelector(q); return !!e && e.children.length > 0; }, sel, T).catch(() => {});
    const m = await page.evaluate(measureIn, sel);
    seen += m.seen;
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    if (m.inner > 1) bad.push(wd + ' sideways inside ' + m.inner + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction((w) => innerWidth === w, was.width, T);
  ok('design: ' + label + ' - 44px targets, 12px floor, AA contrast in light and dark, nothing sideways at ' + widths.join(', '), bad.length === 0 && seen > 0, bad.slice(0, 6).join(' | ') || 'nothing measured');
}

// ---- two families through the real API. Asha is one person in both.
const circleApi = HANDLERS.circle;
const ashaU = await user('Asha');
async function family(circleName, names) {
  const out = {}; let code = null, circleId = null;
  for (const [name, role, existing] of names) {
    const u = existing || await user(name);
    const r = code
      ? await call(circleApi, { token: u.token, body: { action: 'join', code, memberName: name, userId: u.userId, role } })
      : await call(circleApi, { token: u.token, body: { action: 'create', kind: 'family', memberName: name, circleName, userId: u.userId, role } });
    if (!code) { code = r.code; circleId = (await rows('select id from circles where code = $1', [code]))[0].id; await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]); }
    out[name] = { ...u, memberId: r.memberId, code, circleName };
  }
  return { code, id: circleId, m: out };
}
const S = await family('Sharma Family', [['Asha', 'family', ashaU], ['Papa', 'parent'], ['Rohan', 'family'], ['Kabir', 'family']]);
const K = await family('Kapoor Family', [['Mummy', 'parent'], ['Asha', 'family', ashaU]]);
const s = S.m;
await admin.query(`update members set dob = '2015-06-01' where id = $1`, [s.Kabir.memberId]);
ok('setup: Asha is one person in two families; Papa is looked after; Kabir is eleven', s.Asha.userId === K.m.Asha.userId && s.Asha.memberId !== K.m.Asha.memberId && !!s.Papa.memberId);

// ============================================================ NOTIFICATIONS
const A = await phone(s.Asha);
ok('Profile has a Notifications card, with the choices in plain words', await shown(A, '#nt-prefs')
   && await sees(A, '#nt-card', /Quiet hours at night/) && await sees(A, '#nt-card', /An SOS, a missed check-in and your own medicine times always come through/));
ok('quiet hours start as 10pm to 7am, on', await A.isChecked('#nt-quiet') && await A.inputValue('#nt-from') === '22:00' && await A.inputValue('#nt-to') === '07:00');
ok('six switches, each with a line saying what it is, all on',
   await A.$$eval('#nt-kinds [data-ntkind]', els => els.length === 6 && els.every(e => e.checked))
   && await sees(A, '#nt-kinds', /Chat messages/) && await sees(A, '#nt-kinds', /Care alerts/) && await sees(A, '#nt-kinds', /Aaj kya hua/)
   && await A.$$eval('#nt-kinds small', els => els.length === 6 && els.every(e => e.textContent.trim().length > 8)));
await design(A, '#nt-card', 'the Notifications card');

await A.fill('#nt-from', '21:00');
await A.dispatchEvent('#nt-from', 'change');
ok('changing the time saves it, and says so in words', await sees(A, '#nt-saved', /Saved\. Quiet from 9 pm until 7 am\. An SOS always comes through\./));
let pref = (await untilDb(`select quiet, quiet_from, quiet_to, kinds, tz from push_prefs where user_id = $1`, [s.Asha.userId], r => r.length === 1 && r[0].quiet_from === 1260))[0];
ok('it is saved for the person, with the phone\'s time zone', pref && pref.quiet === true && pref.quiet_from === 1260 && pref.quiet_to === 420 && typeof pref.tz === 'string' && pref.tz.length > 2, JSON.stringify(pref));
await A.uncheck('#nt-kinds [data-ntkind="games"]');
pref = (await untilDb(`select kinds from push_prefs where user_id = $1`, [s.Asha.userId], r => r[0] && r[0].kinds.games === false))[0];
ok('turning Games off is saved, and the others stay on', pref.kinds.games === false && pref.kinds.chat === true && pref.kinds.care === true, JSON.stringify(pref));
await A.uncheck('#nt-quiet');
ok('turning quiet hours off says so, and the two times go grey', await sees(A, '#nt-saved', /Saved\. No quiet hours\./) && await A.isDisabled('#nt-from') && await A.isDisabled('#nt-to'));
await A.check('#nt-quiet');
ok('and on again', await sees(A, '#nt-saved', /Quiet from 9 pm until 7 am/) && !(await A.isDisabled('#nt-from')));

// The same person, opened in her mother's family: the same choices.
const AK = await phone(K.m.Asha);
ok('in her other family the choices are the same: they are hers, not one family\'s',
   await shown(AK, '#nt-prefs') && await AK.inputValue('#nt-from') === '21:00' && !(await AK.isChecked('#nt-kinds [data-ntkind="games"]')) && await AK.isChecked('#nt-kinds [data-ntkind="chat"]'));
await AK.context().close();

// A wrong answer from the server is said, not swallowed.
await admin.query(`alter table push_prefs rename to push_prefs_gone`);
await A.uncheck('#nt-kinds [data-ntkind="album"]');
ok('when saving fails, the screen says it did not save', await sees(A, '#nt-saved', /Try again\./) || await sees(A, '#nt-saved', /not saved/));
await admin.query(`alter table push_prefs_gone rename to push_prefs`);

// ============================================================ CAN BE REACHED
ok('an adult sees a dot for each person on Parwah, with words beside it', await shown(A, '#nt-reachbox')
   && await A.$$eval('#nt-reachlist .nt-reach', els => els.length === 4) && await sees(A, '#nt-reachlist', /You.*Alerts are off on your phones/) && await sees(A, '#nt-reachlist', /Papa.*Alerts are off/));
ok('nobody has alerts on yet: every dot is empty', await A.$$eval('#nt-reachlist .nt-dot', els => els.length === 4 && els.every(e => !e.classList.contains('on'))));
// Rohan turns alerts on (on his own phone).
await admin.query(`insert into push_subs (member_id, user_id, endpoint, p256dh, auth) values ($1, $2, 'https://fcm.googleapis.com/fcm/send/rohan-e2e', 'k', 'a')`, [s.Rohan.memberId, s.Rohan.userId]);

const H = await phone(s.Asha, { hash: '#home' });
ok('before that reload, Today showed nothing false; now, with Rohan reachable, there is no card', await H.$$eval('#nt-reach .crow', els => els.length) === 0);
await admin.query(`delete from push_subs`);
await H.reload();
await H.waitForFunction(() => !document.getElementById('main').hidden, null, T);
ok('with no adult reachable, Today shows a gentle card: "If Papa presses SOS, nobody\'s phone will ring."',
   await sees(H, '#nt-reach', /If Papa presses SOS, nobody's phone will ring\./), await H.textContent('#nt-reach'));
ok('it says what to do, and never shames', await sees(H, '#nt-reach', /Turn on alerts|ask another adult/) && !/must|should have|forgot|fail/i.test(await H.textContent('#nt-reach')));
await design(H, '#nt-reach', 'the "nobody\'s phone will ring" card');
await admin.query(`insert into push_subs (member_id, user_id, endpoint, p256dh, auth) values ($1, $2, 'https://fcm.googleapis.com/fcm/send/rohan-e2e', 'k', 'a')`, [s.Rohan.memberId, s.Rohan.userId]);
await H.reload();
await H.waitForFunction(() => !document.getElementById('main').hidden, null, T);
await H.click('#metile');
ok('once one adult can be reached, his dot is filled', await H.waitForFunction(() => { const r = [...document.querySelectorAll('#nt-reachlist .nt-reach')].find(e => /Rohan/.test(e.textContent));
   return !!r && r.querySelector('.nt-dot').classList.contains('on') && /Alerts can reach them/.test(r.textContent); }, null, T).then(() => true, () => false));
ok('and the card on Today is gone', await H.$$eval('#nt-reach .crow', els => els.length) === 0);
await H.context().close();

// A child sees neither.
const C = await phone(s.Kabir);
await C.waitForFunction(() => document.getElementById('nt-prefs') && !document.getElementById('nt-prefs').hidden, null, T);
ok('a child may choose his own quiet hours, but is not shown who can be reached or the self-check',
   await C.isHidden('#nt-reachbox') && await C.isHidden('#nt-check') && await C.$$eval('#nt-reach .crow', els => els.length) === 0);
await C.context().close();

// ============================================================ IS PARWAH WORKING?
ok('adults have "Is Parwah working?" in Profile, empty until asked', await shown(A, '#nt-check') && (await A.textContent('#nt-check-out')).trim() === '');
await A.click('#nt-check-run');
ok('it answers line by line', await sees(A, '#nt-check-out', /App version/) && await A.$$eval('#nt-check-out .nt-line', els => els.length === 6));
const lines = await A.$$eval('#nt-check-out .nt-line', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
ok('alerts on this phone, with what to do', /Alerts on this phone: (off|not possible here|blocked)/.test(lines[0]) && /Turn on alerts|home screen|allow notifications/.test(lines[0]), lines[0]);
ok('the timer, in words', /^.?\s*Timer: (ran|last ran|has not run yet)/.test(lines[1].replace(/^[✓!]\s*/, '')), lines[1]);
ok('Ekta: resting, and how to wake her', /Ekta: resting/.test(lines[2]) && /add an AI key under Advanced/.test(lines[2]), lines[2]);
ok('calls and texts: not set up, and that an SOS still rings phones', /Calls and texts: not set up/.test(lines[3]) && /An SOS still rings every phone that has alerts on/.test(lines[3]), lines[3]);
ok('nothing waiting, and the app version', /Nothing is waiting to send/.test(lines[4]) && /App version: /.test(lines[5]), lines.slice(4).join(' | '));
ok('every line carries a mark and a word, not colour alone', await A.$$eval('#nt-check-out .nt-line', els => els.every(e => /^[✓!]$/.test(e.querySelector('.nt-mark').textContent) && e.querySelector('b').textContent.includes(':') || /waiting to send/.test(e.textContent))));
ok('no dash in any of it', !new RegExp('[' + String.fromCharCode(8211, 8212) + ']').test(lines.join(' ')));
await design(A, '#nt-check', 'the self-check, answered');
await A.context().close();

// ============================================================ A TAP WITH NO NETWORK
const P = await phone(s.Papa, { hash: '#home', role: 'parent' });
ok('Papa sees his big buttons', await shown(P, '#btn-checkin'));
down.events = true;
const pressedAt = Date.now();
await P.click('#btn-checkin');
ok('the server cannot be reached: "Will send when the network is back", with what and when', await shown(P, '#nt-queue')
   && await sees(P, '#nt-queue', /Will send when the network is back/) && await sees(P, '#nt-queue-list', /All is well, .*Kept on this phone\./));
ok('the button says it is saved here, not that it reached the family', await sees(P, '#btn-checkin', /Saved on this phone/) && !/reached the whole family/.test(await P.textContent('#btn-checkin')));
ok('nothing is in the family feed yet', (await rows(`select 1 from events where member_id = $1 and type = 'checkin'`, [s.Papa.memberId])).length === 0);
await design(P, '#nt-queue', 'the waiting row');
await P.click('#nt-queue-try');
ok('"Try now" with the server still away keeps it, and says it is safe', await sees(P, '#toast', /Still no network\. It is safe on this phone\./) && await P.isVisible('#nt-queue'));
down.events = false;
await P.click('#nt-queue-try');
ok('when the server is back, it goes', await gone(P, '#nt-queue') && await sees(P, '#btn-checkin', /Your check-in reached the whole family/));
const ev = await rows(`select created_at from events where member_id = $1 and type = 'checkin'`, [s.Papa.memberId]);
ok('it arrived once, with the time it was pressed', ev.length === 1 && Math.abs(new Date(ev[0].created_at).getTime() - pressedAt) < 15000, JSON.stringify(ev));
await P.context().close();

// ============================================================ A PAGE THAT BREAKS
{
  const B = await phone(s.Rohan, { hash: '#home' });
  await B.evaluate(() => { setTimeout(() => { throw new Error('nt test: something broke for 9876543210'); }, 0); });
  const r = await untilDb(`select message, where_at, viewport from client_errors`, [], x => x.length >= 1);
  ok('a script error on the page is reported: what, where and the screen size', r.length === 1 && /nt test: something broke/.test(r[0].message) && r[0].viewport === '390x844', JSON.stringify(r));
  ok('with no phone number, name, token or family in it', !/9876543210|Rohan|Sharma/.test(JSON.stringify(r)) && !JSON.stringify(r).includes(s.Rohan.token));
  await B.context().close();
}

ok('no script errors in any window (other than the one thrown on purpose)', errors.filter(e => !/nt test: something broke/.test(e)).length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`notifyfair.e2e: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
