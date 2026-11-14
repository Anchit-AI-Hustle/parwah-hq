// SAFETY AND ALERTS, END TO END: a real browser, the real API and a real
// PostgreSQL.
//
// The Gupta family: Kamla and Vimla are sisters, Bauji is their father. He is
// on Parwah and has not opened it in 40 days.
//   - Profile says, in plain words, that calls and texts are not set up, and
//     when the timer last ran: a plain warning when it has not;
//   - Kamla is asked once, on her own phone, whether the family is told when
//     a medicine has no tick, and can change it under Profile;
//   - Vimla pausing Kamla's daily check-in is a question on Kamla's phone,
//     and only Kamla's yes pauses it;
//   - Kamla cannot mark Bauji as no longer with us alone: she names Vimla,
//     his card shows it waiting, and only Vimla's confirmation marks him;
//   - the SOS screen says calls and texts are not set up, and never offers
//     to call someone who has passed away.
//
// Every new surface is measured like every other screen: 44px targets, a
// 12px floor, AA contrast in light and dark, nothing sideways at 320, 390 or
// 1280. Nothing here waits a fixed time and then looks: each step waits for
// the element or the state it is about to check.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('safety.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('safety.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('safety.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { ensureDoseSchema } = await import('../../../api/_doses.mjs');
const { ensureFamilyCareSchema } = await import('../../../api/_familycare.mjs');
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
  const req = { method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.6.0.' + (++n % 250) }, query, body };
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
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: 'family', circleName: w.circleName }));
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  // The family has been read and the tree drawn: only then is the screen ready.
  if (hash === '#people') await page.waitForSelector('[data-mprof]', T);
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
  for (const [wd, sc] of [[320, 'light'], [320, 'dark'], [390, 'light'], [390, 'dark'], [1280, 'light']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc });
    // Wait for the new width and theme to be laid out and painted, not for a clock.
    await page.waitForFunction(([w, dark]) => innerWidth === w && matchMedia('(prefers-color-scheme: dark)').matches === dark, [wd, sc === 'dark'], T);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const m = await page.evaluate(measureIn, sel);
    seen += m.seen;
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    if (m.inner > 1) bad.push(wd + ' sideways inside ' + m.inner + 'px');
    m.bad.filter(b => wd < 1280 || /off the side|tiny|contrast/.test(b)).forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction((w) => innerWidth === w, was.width, T);
  ok('design: ' + label + ' - 44px targets, 12px floor, AA contrast in light and dark, nothing sideways at 320, 390 or 1280', bad.length === 0 && seen > 0, bad.slice(0, 6).join(' | ') || 'nothing measured');
}

// ---- one family, through the real API
const circleApi = HANDLERS.circle;
const F = {}; let code = null, circleId = null;
for (const [name, role, relation] of [['Kamla', 'family', 'daughter'], ['Vimla', 'family', 'sister'], ['Bauji', 'parent', 'father']]) {
  const u = await user(name);
  const r = code
    ? await call(circleApi, { token: u.token, body: { action: 'join', code, memberName: name, userId: u.userId, role, relation } })
    : await call(circleApi, { token: u.token, body: { action: 'create', kind: 'family', memberName: name, circleName: 'Gupta Family', userId: u.userId, role, relation } });
  if (!code) { code = r.code; circleId = (await admin.query('select id from circles where code = $1', [code])).rows[0].id; await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]); }
  F[name] = { ...u, memberId: r.memberId, code, circleName: 'Gupta Family' };
}
const { Kamla, Vimla, Bauji } = F;
const q1 = async (text, args) => (await admin.query(text, args)).rows[0];
await admin.query(`update members set dob = '1975-01-01' where id = any($1::uuid[])`, [[Kamla.memberId, Vimla.memberId]]);
await admin.query(`update members set dob = '1945-01-01', phone = '+919833300009' where id = $1`, [Bauji.memberId]);
// The feed's tables, the timer's row and the medicine tables exist once used.
await call(HANDLERS.events, { method: 'GET', token: Kamla.token, query: { circle: code, member: Kamla.memberId } });
await ensureDoseSchema(db()); await ensureFamilyCareSchema(db());
// Bauji is on Parwah and has not opened it in 40 days. Nothing he did is recent.
await admin.query(`update sessions set last_used_at = now() - interval '40 days' where user_id = $1`, [Bauji.userId]);
await admin.query(`update events set created_at = created_at - interval '40 days' where member_id = $1`, [Bauji.memberId]);
// The timer is held still for this test, so what the screen says about it is
// what the test wrote: a window that starts in the future never resets.
const holdTimer = () => admin.query(`insert into rate_limit (bucket, k, window_start, n) values ('tick', 'all', now() + interval '1 day', 99)
                                     on conflict (bucket, k) do update set window_start = excluded.window_start, n = 99`);
const timerRan = (minsAgo) => admin.query(`insert into kv (k, v) values ('tick_at', $1) on conflict (k) do update set v = excluded.v`, [String(Date.now() - minsAgo * 60000)]);
await holdTimer();

// =============================================== A5 + A12: said honestly, under Profile
await timerRan(40);
let PK = await phone(Kamla, { hash: '#profile' });
ok('A5 Profile says calls and texts are not set up, in plain words', await sees(PK, '#sf-calls', /^Calls and texts are not set up\. Family is told inside Parwah\.$/), await PK.textContent('#sf-calls'));
ok('A12 a timer that has not run for 40 minutes is a plain warning', await sees(PK, '#sf-timer', /^Timed reminders are not running\. Family alerts may be late\.$/)
   && await PK.evaluate(() => document.querySelector('#sf-timer').classList.contains('sf-warn')), await PK.textContent('#sf-timer'));
await design(PK, '#sf-card', 'the Safety card, with the warning');
await timerRan(2);
await PK.reload();
ok('A12 when it ran two minutes ago, it says so quietly', await sees(PK, '#sf-timer', /^Reminders last ran: [23] minutes ago$/)
   && !(await PK.evaluate(() => document.querySelector('#sf-timer').classList.contains('sf-warn'))), await PK.textContent('#sf-timer'));
ok('A8 with no medicine times, the medicine choice is there and off', await sees(PK, '#sf-tell', /^Off \(not asked yet\)$/));

// =============================================== A8: asked once, on her own phone
const med = await q1(`insert into family_book (circle_id, kind, name, about_member, by_member) values ($1, 'med', 'Telma 40', $2, $3) returning id`, [circleId, Kamla.memberId, Vimla.memberId]);
await admin.query(`insert into medicine_schedules (circle_id, person_id, medicine_id, times, tz, created_by) values ($1, $2, $3, '{08:00}', 'Asia/Kolkata', $4)`, [circleId, Kamla.memberId, med.id, Vimla.memberId]);
await PK.close();
PK = await phone(Kamla, { hash: '#home' });
ok('A8 with medicine times set, Today asks her once: tell the family?', await sees(PK, '#sf-alerts', /Tell the family if I miss a medicine\?/) && await sees(PK, '#sf-alerts', /stays off unless you say yes/));
const PV0 = await phone(Vimla, { hash: '#home' });
ok('A8 nobody else is asked on her behalf', await PV0.waitForFunction(() => document.querySelector('#fcalerts') && !/Tell the family/.test(document.querySelector('#sf-alerts').textContent), null, T).then(() => true, () => false));
await PV0.close();
await design(PK, '#sf-alerts', 'the medicine question on Today');
await PK.click('#sf-alerts [data-sftell="1"]');
ok('A8 her yes is saved, and the question goes away', await PK.waitForFunction(() => !/Tell the family/.test(document.querySelector('#sf-alerts').textContent), null, T).then(() => true, () => false)
   && (await q1(`select dose_tell from members where id = $1`, [Kamla.memberId])).dose_tell === true);
await PK.close();
PK = await phone(Kamla, { hash: '#profile' });
ok('A8 Profile shows it on, and she can change it', await sees(PK, '#sf-tell', /^On$/) && (await PK.textContent('#sf-tellbtn')).trim() === 'Turn it off');
await PK.click('#sf-tellbtn');
ok('A8 turned off again from Profile', await sees(PK, '#sf-tell', /^Off$/) && (await q1(`select dose_tell from members where id = $1`, [Kamla.memberId])).dose_tell === false);
await design(PK, '#sf-card', 'the Safety card with the medicine choice');
await PK.close();

// =============================================== A7: a pause someone else asked for
const until = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
await admin.query(`update members set checkin_by = '23:59', tz = 'Asia/Kolkata' where id = $1`, [Kamla.memberId]);
const asked = await call(HANDLERS.events, { token: Vimla.token, body: { code, memberId: Vimla.memberId, type: 'quiet_away', targetId: Kamla.memberId, until, tz: 'Asia/Kolkata' } });
ok('A7 Vimla pausing Kamla\'s check-in only asks', asked.ok && asked.asked === true && (await q1(`select away_until from members where id = $1`, [Kamla.memberId])).away_until === null, JSON.stringify(asked));
const PV1 = await phone(Vimla, { hash: '#home' });
ok('A7 Vimla sees it is waiting for Kamla\'s yes', await sees(PV1, '#fcq-rows', /Asked Kamla to pause it until .*Waiting for .* yes\./), await PV1.textContent('#fcq-rows'));
await PV1.close();
PK = await phone(Kamla, { hash: '#home' });
ok('A7 Kamla gets the question on her own phone', await sees(PK, '#fcalerts', /Vimla asks: pause your daily check-in until /) && await sees(PK, '#fcalerts', /Nothing changes until you say yes/));
await design(PK, '#fcalerts', 'the pause question on Today');
await PK.click('#fcalerts [data-sfawy]');
ok('A7 her yes is what pauses it', await PK.waitForFunction(() => !/asks: pause/.test(document.querySelector('#fcalerts').textContent), null, T).then(() => true, () => false)
   && (await q1(`select to_char(away_until, 'YYYY-MM-DD') as d from members where id = $1`, [Kamla.memberId])).d === until);
await PK.close();

// =============================================== A11: two adults, never one
PK = await phone(Kamla, { hash: '#people' });
await PK.click('[data-mprof="' + Bauji.memberId + '"]');
ok('A11 Bauji\'s card opens with the quiet way in', await shown(PK, '#msheet') && await PK.isVisible('#rm-mp-open') && await PK.isHidden('#sf-mp-ask'));
await PK.click('#rm-mp-open');
ok('A11 because he is on Parwah, the sheet asks for a second adult', await shown(PK, '#rm-sheet') && await PK.isVisible('#sf-rm-ask') && await sees(PK, '#sf-rm-askhint', /two adults decide this together\. Nothing changes until the second adult says yes\./)
   && (await PK.textContent('#rm-save')).trim() === 'Ask them to confirm');
ok('A11 the choices are the other people on Parwah, never him or me', (await PK.$$eval('#sf-rm-ask option', os => os.map(o => o.textContent).join())) === 'Choose…,Vimla');
await design(PK, '#rm-sheet', 'the sheet that asks for a second adult');
await PK.fill('#rm-year', '2026');
await PK.click('#rm-save');
ok('A11 with nobody chosen it says what is needed, and saves nothing', await sees(PK, '#rm-err', /Choose a second adult/) && !(await q1(`select 1 as x from remember_asks`)));
await PK.selectOption('#sf-rm-ask', Vimla.memberId);
await PK.click('#rm-save');
ok('A11 it waits: Bauji is not marked', await gone(PK, '#rm-sheet') && await PK.waitForFunction(() => /Waiting for Vimla to confirm about Bauji/.test(document.querySelector('#sf-alerts').textContent), null, T).then(() => true, () => false)
   && (await q1(`select remembered from members where id = $1`, [Bauji.memberId])).remembered === false && !!(await q1(`select 1 as x from remember_asks where member_id = $1`, [Bauji.memberId])));
await PK.click('[data-mprof="' + Bauji.memberId + '"]');
ok('A11 his card shows it is waiting, with a way to take it back', await shown(PK, '#sf-mp-ask') && await sees(PK, '#sf-mp-asktext', /^Waiting for Vimla to confirm\. Nothing has changed yet\.$/)
   && await PK.isHidden('#sf-mp-yes') && (await PK.textContent('#sf-mp-no')).trim() === 'Take it back' && await PK.isHidden('#rm-mp-open'));
await design(PK, '#msheet', 'a person\'s card with a mark that is waiting');
await PK.close();

const PV = await phone(Vimla, { hash: '#home' });
ok('A11 Vimla is asked on Today, with who asked and the year', await sees(PV, '#sf-alerts', /Kamla asks you to confirm: Bauji is no longer with us/) && await sees(PV, '#sf-alerts', /2026\. Two adults decide this together/));
await design(PV, '#sf-alerts', 'the second adult\'s question on Today');
await PV.click('#sf-alerts [data-sfrmyes]');
ok('A11 confirming asks once more, in the app\'s own sheet', await shown(PV, '#asksheet') && /Confirm that Bauji is no longer with us\?/.test(await PV.textContent('#as-q')));
await design(PV, '#asksheet', 'the question before a mark is confirmed');
await PV.click('#as-yes');
ok('A11 only now is he marked', await PV.waitForFunction(() => !/asks you to confirm/.test(document.querySelector('#sf-alerts').textContent), null, T).then(() => true, () => false)
   && (await q1(`select remembered, passed_year from members where id = $1`, [Bauji.memberId])).remembered === true && !(await q1(`select 1 as x from remember_asks`)));

// =============================================== A5 + A3: the SOS screen
await PV.context().grantPermissions(['geolocation']);
await PV.context().setGeolocation({ latitude: 18.52, longitude: 73.85 });
await PV.click('#sos-fab');
await PV.waitForSelector('#ss-now', { state: 'visible', ...T });
await PV.click('#ss-now');
ok('A5 the SOS screen says calls and texts are not set up', await sees(PV, '#ss-status', /Your family has been alerted.*Calls and texts are not set up\. Family is told inside Parwah\./), await PV.textContent('#ss-status'));
const callBtns = await PV.$$eval('#ss-calls a', as => as.map(a => a.textContent.trim() + ' ' + a.getAttribute('href')).join(' | '));
ok('A3 the SOS screen never offers to call someone who has passed away', /Call 112/.test(callBtns) && !/Bauji|9833300009/.test(callBtns), callBtns);
ok('A3 nor is his number in the text message', !/9833300009/.test(await PV.getAttribute('#ss-sms', 'href')));
await design(PV, '#ss-live', 'the SOS screen with the calls line');
await PV.close();

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`safety.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`safety.e2e: ${pass}/${pass} checks pass`);
