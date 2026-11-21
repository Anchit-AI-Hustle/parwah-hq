// THE KIT the "remaining family needs" tests share (rollcall, kids,
// carerload, eventkit, home, summary and blood): a clean database, the real
// handlers, people with real sessions, and for the browser tests a real
// page with the design measurements every end-to-end test makes.
// Not a test itself: each *.dbtest.mjs beside it imports what it needs.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

export async function kit(label, handlerNames) {
  const url = process.env.PARWAH_TEST_DATABASE_URL;
  if (!url) { console.log(label + ': PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
  if (!/_test$/.test(new URL(url).pathname)) { console.error(label + ': the database name must end in _test, because this wipes it.'); process.exit(1); }
  process.env.DATABASE_URL = url;
  delete process.env.POSTGRES_URL;

  const pg = (await import('pg')).default;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('drop schema public cascade; create schema public;');

  // Every push is counted here instead of leaving the machine.
  const webpush = (await import('web-push')).default;
  const pushed = [];
  webpush.sendNotification = async (sub, body) => { pushed.push({ to: sub.endpoint.split('/').pop(), body: JSON.parse(body) }); return {}; };

  const api = {};
  for (const n of handlerNames) api[n] = (await import(`../../../api/${n}.mjs`)).default;
  const { db, ensureSchema } = await import('../../../api/_db.mjs');
  const { ensurePushSchema } = await import('../../../api/_push.mjs');
  const { ensureAudienceSchema } = await import('../../../api/_audience.mjs');
  const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
  const sql = db();
  await ensureSchema(sql); await ensurePushSchema(sql); await ensureAudienceSchema(sql);
  // The two tree links, as /api/circle makes them.
  await admin.query(`alter table members add column if not exists parent_id uuid references members(id) on delete set null;
                     alter table members add column if not exists spouse_id uuid references members(id) on delete set null;
                     alter table members add column if not exists gender text;
                     alter table users add column if not exists toured_at timestamptz`);

  let pass = 0; const fails = [];
  const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

  let n = 0;
  async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
    const req = { method, headers: { 'x-parwah-token': token, 'x-parwah-tz': 'Asia/Kolkata', 'x-forwarded-for': '10.7.' + (++n % 250) + '.' + (n % 199) }, query, body };
    let status = 200, json = null;
    const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() { return this; }, end() { return this; } };
    await handler(req, res);
    return { ...(json || {}), status };
  }
  async function user(name) {
    const phone = '+9198540' + String(++n).padStart(5, '0');
    const h = hashPin('4819');
    const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                  values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
    const token = newToken();
    await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
    return { userId: u.id, name, token, phone };
  }
  async function family(code, name, kind = 'family') {
    const id = (await admin.query(`insert into circles (code, name, kind) values ($1,$2,$3) returning id`, [code, name, kind])).rows[0].id;
    return { id, code, name };
  }
  // A seat in a family. u with no userId is someone added by name only.
  async function seat(fam, u, { role = 'family', dob = null, relation = null, phone = null, parent = null, spouse = null, sub = true } = {}) {
    const m = (await admin.query(`insert into members (circle_id, name, user_id, role, dob, relation, phone, parent_id, spouse_id)
                                  values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [fam.id, u.name, u.userId || null, role, dob, relation, phone || u.phone || null, parent, spouse])).rows[0];
    if (spouse) await admin.query(`update members set spouse_id = $1 where id = $2`, [m.id, spouse]);
    if (u.userId && sub) await admin.query(`insert into push_subs (member_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')`,
      [m.id, u.userId, 'https://fcm.googleapis.com/fcm/send/' + m.id]);
    return { id: m.id, memberId: m.id, name: u.name, token: u.token, code: fam.code, circleName: fam.name, userId: u.userId || null, phone: u.phone || null };
  }
  // Who a push went to since the mark, by member id.
  const pushedTo = (from, re) => pushed.slice(from).filter(p => !re || re.test(p.body.title)).map(p => p.to);
  const q1 = async (text, args) => (await admin.query(text, args)).rows[0];

  async function finish() {
    await admin.end();
    for (const pl of globalThis.__parwahPools || []) await pl.end();
    if (fails.length) { console.error(`${label}: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
    console.log(`${label}: ${pass}/${pass} checks pass`);
  }
  return { admin, sql, api, pushed, pushedTo, ok, call, user, family, seat, q1, finish, counts: () => ({ pass, fails }) };
}

// ------------------------------------------------------------ the browser
// The design rules, measured inside one part of the screen (as the other
// end-to-end tests do): 44px targets, a 12px floor, AA contrast.
function measureIn(sel) {
  const root = document.querySelector(sel);
  if (!root) return { overflow: 0, inner: 0, bad: ['missing ' + sel], seen: 0 };
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

export async function browserKit(label, k) {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); }
  catch { console.log(label + ': playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }
  const ROOT = new URL('../../public', import.meta.url).pathname;
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  let n = 0;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      const h = k.api[u.pathname.slice(5).replace(/\/$/, '')];
      res.setHeader('Content-Type', 'application/json');
      if (!h) { res.end('{"ok":false,"error":"not in this test"}'); return; }
      let raw = ''; for await (const c of req) raw += c;
      const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.0.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
      const w = { status(s) { res.statusCode = s; return this; }, json(j) { res.end(JSON.stringify(j)); return this; }, setHeader(a, v) { res.setHeader(a, v); return this; }, end() { res.end(); return this; } };
      try { await h(r, w); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })); }
      return;
    }
    let p = u.pathname; if (p.endsWith('/')) p += 'index.html';
    try { const d = await readFile(path.join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }
    catch { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const T = { timeout: 20000 };
  const errors = [];
  const ok = k.ok;

  // One person's phone, signed in, on one screen of the app.
  async function phone(who, { scheme = 'light', width = 390, hash = '#home' } = {}) {
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
    await page.waitForFunction(() => document.body.classList.contains('inapp'), null, T);
    return page;
  }
  // Wait until some text is on the screen, then say whether it was. Never a fixed pause.
  const sees = (page, sel, re, opts) => page.waitForFunction(([s, src, fl]) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && new RegExp(src, fl).test(e.textContent); },
    [sel, re.source, re.flags], opts || T).then(() => true, () => false);
  const gone = (page, sel) => page.waitForSelector(sel, { state: 'hidden', ...T }).then(() => true, () => false);
  const shown = (page, sel) => page.waitForSelector(sel, { state: 'visible', ...T }).then(() => true, () => false);

  async function design(page, sel, what) {
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
    await page.waitForFunction((w) => innerWidth === w && !matchMedia('(prefers-color-scheme: dark)').matches, was.width, T);
    ok('design: ' + what + ' - 44px targets, 12px floor, AA contrast in light and dark, nothing sideways at 320 or 390', bad.length === 0 && seen > 0, bad.slice(0, 6).join(' | ') || 'nothing measured');
  }
  // Wide screens too: nothing sideways at 1280.
  async function wide(page, what) {
    const was = page.viewportSize();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => innerWidth === 1280, null, T);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const over = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
    await page.setViewportSize(was);
    await page.waitForFunction((w) => innerWidth === w, was.width, T);
    ok('design: ' + what + ' - nothing sideways at 1280', over <= 0, over + 'px');
  }
  const toastSays = (page, re) => sees(page, '#toast', re);
  const confirmSheet = async (page) => { await shown(page, '#asksheet'); await page.click('#as-yes'); };
  async function finish() {
    ok('no script errors', errors.length === 0, errors.join(' | '));
    await browser.close();
    server.close();
    await k.finish();
  }
  return { BASE, T, phone, sees, gone, shown, design, wide, toastSays, confirmSheet, finish, errors };
}
