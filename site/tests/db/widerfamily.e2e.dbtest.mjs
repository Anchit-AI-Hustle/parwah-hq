// THE WIDER FAMILY, END TO END: a real browser, the real API and a real
// PostgreSQL.
//
// Two families, the Sharmas and the Vermas, share one daughter: Kavya is
// Arjun's wife in one home and Kishan's daughter in the other. Arjun asks to
// link the trees, Kishan says yes on his own phone, and each then sees the
// other's tree, read only, and the right words in Rishtedaar (Saas and Saala
// for Arjun, Damaad for Kishan). Arjun writes a family fact for people he
// chooses, and someone he did not choose does not see it. The family marks
// Dadaji as no longer with us, and Today shows his day of remembrance.
//
// Every new surface is measured like every other screen: 44px targets, a
// 12px floor, AA contrast in light and dark, nothing sideways at 320 or 390.
// Nothing here waits a fixed time and then looks: each step waits for the
// element or the state it is about to check.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('widerfamily.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('widerfamily.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('widerfamily.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { wallIn } = await import('../../../api/_rememberrules.mjs');
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

// ---- two families, through the real API. Kavya is one person in both.
const circleApi = HANDLERS.circle;
const kavyaU = await user('Kavya');
async function family(circleName, names) {
  const out = {}; let code = null, circleId = null;
  for (const [name, role, existing] of names) {
    const u = existing || await user(name);
    const r = code
      ? await call(circleApi, { token: u.token, body: { action: 'join', code, memberName: name, userId: u.userId, role } })
      : await call(circleApi, { token: u.token, body: { action: 'create', kind: 'family', memberName: name, circleName, userId: u.userId, role } });
    if (!code) { code = r.code; circleId = (await admin.query('select id from circles where code = $1', [code])).rows[0].id; await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]); }
    out[name] = { ...u, memberId: r.memberId, code, circleName };
  }
  return { code, id: circleId, m: out };
}
const A = await family('Sharma Family', [['Arjun', 'family'], ['Ramesh', 'parent'], ['Kavya', 'family', kavyaU], ['Bharat', 'family']]);
const B = await family('Verma Family', [['Kishan', 'parent'], ['Sarla', 'family'], ['Kavya', 'family', kavyaU], ['Karan', 'family']]);
const a = A.m, b = B.m;
const steps = [];
const tree = async (who, action, name, place, ofId, gender) => {
  const body = { action, code: who.code, memberId: who.memberId, place, ofId, gender };
  if (action === 'add_person') body.personName = name; else body.targetId = name;
  const r = await call(circleApi, { token: who.token, body });
  steps.push(action + ' ' + r.status + (r.error ? ' ' + r.error : ''));
  return r.memberId;
};
await tree(a.Arjun, 'place', a.Ramesh.memberId, 'parent', a.Arjun.memberId, 'm');
await tree(a.Arjun, 'place', a.Arjun.memberId, 'child', a.Ramesh.memberId, 'm');
await tree(a.Arjun, 'add_person', 'Geeta', 'spouse', a.Ramesh.memberId, 'f');
await tree(a.Arjun, 'place', a.Kavya.memberId, 'spouse', a.Arjun.memberId, 'f');
await tree(a.Arjun, 'place', a.Bharat.memberId, 'sibling', a.Arjun.memberId, 'm');
const dadaji = await tree(a.Arjun, 'add_person', 'Dadaji', 'parent', a.Ramesh.memberId, 'm');
await tree(b.Kishan, 'place', b.Sarla.memberId, 'spouse', b.Kishan.memberId, 'f');
await tree(b.Kishan, 'place', b.Kishan.memberId, 'spouse', b.Sarla.memberId, 'm');
await tree(b.Kishan, 'place', b.Kavya.memberId, 'child', b.Kishan.memberId, 'f');
await tree(b.Kishan, 'place', b.Karan.memberId, 'child', b.Kishan.memberId, 'm');
await tree(b.Kishan, 'add_person', 'Meena', 'spouse', b.Karan.memberId, 'f');
ok('two families are built through the real tree API, sharing one daughter', steps.every(s => / 200$/.test(s)) && a.Kavya.userId === b.Kavya.userId && a.Kavya.memberId !== b.Kavya.memberId, steps.join(' | '));
await admin.query(`update members set place = 'Pune', dob = '1990-02-02' where id = $1`, [b.Karan.memberId]);

// ============================================================ LINKED FAMILIES
const PA = await phone(a.Arjun);
ok('the ways in are on the family tree card', await PA.isVisible('#treecard #fl-open') && await PA.isVisible('#treecard #ff-open') && (await PA.textContent('#fl-open')).trim() === 'Linked families');
ok('with no link, the tree card shows no other family', (await PA.$$('#fl-trees [data-flfam]')).length === 0);
await design(PA, '#treecard', 'the tree card with its two new buttons');
await PA.click('#fl-open');
ok('empty: the sheet says what a link is, and gives one first step', await shown(PA, '#fl-sheet') && await sees(PA, '#fl-note', /No linked family yet\. Ask a related family for their family code/)
   && /Nothing else is shared/.test(await PA.textContent('#fl-sub')) && await PA.$eval('#fl-new', d => d.open));
await design(PA, '#fl-sheet', 'linked families, empty, with the form open');
await PA.click('#fl-send');
ok('no code: it says what to write', await sees(PA, '#fl-err', /Write the other family's code/));
await PA.fill('#fl-code', A.code); await PA.click('#fl-send');
ok('your own code: it says so', await sees(PA, '#fl-err', /That is the code of this family/));
await PA.fill('#fl-code', B.code.toLowerCase()); await PA.click('#fl-send');
ok('no bridge: it asks who belongs to both families', await sees(PA, '#fl-err', /Choose the person who belongs to both families/));
await PA.fill('#fl-code', 'ZZZZ99'); await PA.selectOption('#fl-bridge', a.Kavya.memberId); await PA.click('#fl-send');
ok('error: a code nobody has is told plainly, through humanFail', await sees(PA, '#fl-err', /No family found with that code/));
await design(PA, '#fl-sheet', 'linked families with a message under the form');
await PA.fill('#fl-code', B.code.toLowerCase()); await PA.click('#fl-send');
ok('Arjun asks the Vermas, naming Kavya: it shows as waiting, with a way to take it back', await shown(PA, '#fl-list [data-flback]') && await sees(PA, '#fl-list', /Verma Family.*You asked to link through Kavya/));
ok('and still nothing of the other family is on his phone', (await PA.$$('#fl-trees [data-flfam]')).length === 0 && !/Sarla|Karan|Meena/.test(await PA.textContent('#fl-sheet')));
await PA.click('#fl-x');

// Kishan, on a small phone in the dark, is asked.
const PK = await phone(b.Kishan, { scheme: 'dark', width: 320 });
ok('the other family sees a request waiting, on the button itself', await sees(PK, '#fl-open', /Linked families: 1 request waiting/));
await PK.click('#fl-open');
ok('the request says who asks, who the bridge is and what is shared', await shown(PK, '#fl-list [data-flyes]') && await sees(PK, '#fl-list', /Sharma Family asks to link family trees/)
   && /Arjun says Kavya belongs to both families/.test(await PK.textContent('#fl-list')) && /Nothing else is shared/.test(await PK.textContent('#fl-list')));
ok('the same sign-in in both families is already picked as the bridge', (await PK.$eval('#fl-list [data-flpick]', x => x.value)) === b.Kavya.memberId);
await design(PK, '#fl-sheet', 'a request waiting for an answer');
if (process.env.WF_SHOT_DIR) await PK.screenshot({ path: process.env.WF_SHOT_DIR + '/wider-request-320-dark.png' });
await PK.check('#fl-list [data-flshare]');
await PK.click('#fl-list [data-flyes]');
ok('Kishan says yes: the link shows as on, with a way to end it', await shown(PK, '#fl-list [data-flend]') && await sees(PK, '#fl-list', /Linked now: 1 of 6/));
await design(PK, '#fl-sheet', 'one linked family');
await PK.click('#fl-x');
ok('his tree card gains "Linked family: Sharma Family"', await sees(PK, '#fl-trees', /Linked family: Sharma Family/) && await gone(PK, '#fl-sheet'));
const linkedText = (page, name) => page.evaluate((nm) => { const b = [...document.querySelectorAll('#fl-trees .tperson')].find(x => x.querySelector('b').textContent === nm); return b ? b.querySelector('small').textContent : null; }, name);
ok('Kishan: his daughter\'s husband is Damaad, her father-in-law is Samdhi', (await linkedText(PK, 'Arjun')) === 'Damaad · Son-in-law' && (await linkedText(PK, 'Ramesh')) === "Samdhi · Son-in-law's father", [await linkedText(PK, 'Arjun'), await linkedText(PK, 'Ramesh')].join(' ; '));
ok('Kishan: his own daughter is marked as in both families', (await linkedText(PK, 'Kavya')) === 'Daughter · in both families', await linkedText(PK, 'Kavya'));
ok('the linked tree cannot be changed: no profile, no form, only a read-only sheet', (await PK.$$('#fl-trees [data-mprof]')).length === 0 && (await PK.$$('#fl-trees select, #fl-trees input')).length === 0);
await design(PK, '#treecard', 'the tree card with a linked family under it');
if (process.env.WF_SHOT_DIR) await PK.screenshot({ path: process.env.WF_SHOT_DIR + '/wider-linkedtree-320-dark.png' });

// Arjun sees the Vermas.
await PA.click('#fl-open');
ok('Arjun opens the sheet again: the link is on', await shown(PA, '#fl-list [data-flend]'));
await PA.click('#fl-x');
ok('his tree card gains "Linked family: Verma Family"', await sees(PA, '#fl-trees', /Linked family: Verma Family/));
ok('Arjun: Sarla is Saas, Karan is Saala, Meena is Salhaj', (await linkedText(PA, 'Sarla')) === 'Saas · Mother-in-law' && (await linkedText(PA, 'Karan')) === 'Saala · Brother-in-law' && (await linkedText(PA, 'Meena')) === 'Salhaj · Sister-in-law',
   [await linkedText(PA, 'Sarla'), await linkedText(PA, 'Karan'), await linkedText(PA, 'Meena')].join(' ; '));
ok('his own wife is marked as in both families', (await linkedText(PA, 'Kavya')) === 'Wife · in both families', await linkedText(PA, 'Kavya'));
await PA.click('#fl-trees [data-flwho$="' + b.Karan.memberId + '"]');
ok('tapping a linked person opens a small read-only sheet with the chain in words', await shown(PA, '#fl-who') && (await PA.textContent('#fl-who-name')) === 'Karan' && (await PA.textContent('#fl-who-kin')) === 'Saala · Brother-in-law'
   && (await PA.textContent('#fl-who-chain')) === "Your wife Kavya's brother" && (await PA.textContent('#fl-who-fam')) === 'Verma Family', await PA.textContent('#fl-who-chain'));
ok('only the year of birth and the city are shown', (await PA.textContent('#fl-who-born')) === '1990' && (await PA.textContent('#fl-who-city')) === 'Pune' && !/02-02|2 February/.test(await PA.textContent('#fl-who')));
ok('the Vermas ticked "share phone numbers": there is a Call button', await PA.isVisible('#fl-who-call') && (await PA.getAttribute('#fl-who-call', 'href')) === 'tel:' + encodeURIComponent(b.Karan.phone));
await design(PA, '#fl-who', 'a linked person');
if (process.env.WF_SHOT_DIR) await PA.screenshot({ path: process.env.WF_SHOT_DIR + '/wider-who-390-light.png' });
await PA.keyboard.press('Escape');
ok('Escape closes it', await gone(PA, '#fl-who'));
await PK.click('#fl-trees [data-flwho$="' + a.Arjun.memberId + '"]');
ok('the Sharmas did not tick it: Kishan has no Call button for Arjun', await shown(PK, '#fl-who') && await PK.isHidden('#fl-who-call') && !(await PK.getAttribute('#fl-who-call', 'href')));
await PK.click('#fl-who-x');

// Rishtedaar gains the other family, related through the bridge.
await PA.click('#rz-open');
const rowOf = (page, name) => page.evaluate((nm) => {
  const r = [...document.querySelectorAll('#rz-list .crow')].find(x => x.querySelector('b').textContent === nm);
  if (!r) return null;
  const head = (() => { let e = r.previousElementSibling; while (e && !e.classList.contains('eyebrow')) e = e.previousElementSibling; return e ? e.textContent.trim() : ''; })();
  return { head, kin: r.querySelector('.rz-kin') ? r.querySelector('.rz-kin').textContent : '', chain: r.querySelector('small') ? r.querySelector('small').textContent : '', linked: r.hasAttribute('data-flwho') };
}, name);
await PA.waitForFunction(() => [...document.querySelectorAll('#rz-list .crow b')].some(x => x.textContent === 'Sarla'), null, T).catch(() => {});
const rs = await rowOf(PA, 'Sarla'), rk = await rowOf(PA, 'Karan'), rg = await rowOf(PA, 'Geeta');
ok('Rishtedaar: Sarla is in close family, Saas, named with her family, the chain through Kavya', rs && rs.head.startsWith('Kareebi') && rs.kin === 'Saas · Mother-in-law · Verma Family' && rs.chain === "Your wife Kavya's mother" && rs.linked, JSON.stringify(rs));
ok('Rishtedaar: Karan is Saala', rk && rk.head.startsWith('Kareebi') && rk.kin === 'Saala · Brother-in-law · Verma Family', JSON.stringify(rk));
ok('his own family is listed as before', rg && rg.head.startsWith('Ghar') && rg.kin === 'Mother · not on Parwah' && !rg.linked, JSON.stringify(rg));
ok('Kavya is listed once, as his wife, not a second time from the other family', await PA.$$eval('#rz-list .crow b', bs => bs.filter(x => x.textContent === 'Kavya').length) === 1);
await design(PA, '#rz-sheet', 'Rishtedaar with a linked family in it');
if (process.env.WF_SHOT_DIR) await PA.screenshot({ path: process.env.WF_SHOT_DIR + '/wider-rishtedaar-390-light.png' });
await PA.fill('#rz-q', 'saala');
await PA.waitForFunction(() => document.querySelectorAll('#rz-list .crow').length === 1, null, T).catch(() => {});
ok('searching "saala" finds the Saala of the linked family', (await PA.$$eval('#rz-list .crow b', bs => bs.map(x => x.textContent))).join() === 'Karan');
await PA.click('#rz-list [data-flwho]');
ok('tapping him opens the linked person sheet over the list', await shown(PA, '#fl-who') && (await PA.textContent('#fl-who-name')) === 'Karan');
await PA.keyboard.press('Escape');
ok('Escape closes that sheet first, and the list stays', await gone(PA, '#fl-who') && await PA.isVisible('#rz-sheet'));
await PA.fill('#rz-q', '');
await PA.click('#rz-x');

// Kavya, in her husband's home, sees her own mother at home.
const PV = await phone(a.Kavya);
ok('Kavya (in the Sharma family) sees the Verma tree too', await sees(PV, '#fl-trees', /Linked family: Verma Family/));
ok('and her own mother as Mother', (await linkedText(PV, 'Sarla')) === 'Mother', await linkedText(PV, 'Sarla'));
await PV.close();

// Either side ends it, at once.
await PA.click('#fl-open');
await shown(PA, '#fl-list [data-flend]');
await PA.click('#fl-list [data-flend]');
ok('ending asks first, in the app\'s own sheet, and says what stops', await shown(PA, '#asksheet') && /End the link with Verma Family\?/.test(await PA.textContent('#as-q')) && /at once/.test(await PA.textContent('#as-sub')));
await design(PA, '#asksheet', 'the question before a link ends');
await PA.click('#as-yes');
ok('the link is gone from the sheet, and the first step is back', await sees(PA, '#fl-note', /No linked family yet/) && (await PA.$$('#fl-list [data-flend]')).length === 0);
await PA.click('#fl-x');
ok('and the other family\'s tree is gone from his tree card', await PA.waitForFunction(() => !document.querySelector('#fl-trees [data-flfam]'), null, T).then(() => true, () => false));
await PK.click('#fl-open');
ok('on the other side too: Kishan sees no linked family any more', await sees(PK, '#fl-note', /No linked family yet/));
await PK.click('#fl-x');
ok('and no Sharma is left on his tree card', await PK.waitForFunction(() => !document.querySelector('#fl-trees [data-flfam]'), null, T).then(() => true, () => false) && !/Arjun|Ramesh/.test(await PK.textContent('#treecard')));
await PK.close();

// ================================================================ FAMILY FACTS
await PA.click('#ff-open');
ok('empty: the sheet says these stay in this family, and gives a first step', await shown(PA, '#ff-sheet') && await sees(PA, '#ff-note', /Nothing is written down yet\. Start with one thing you know/)
   && await PA.isVisible('#ff-note [data-ffadd]') && /stay in this family, even when it is linked/.test(await PA.textContent('#ff-sub')));
await design(PA, '#ff-sheet', 'family facts, empty');
await PA.click('#ff-note [data-ffadd]');
ok('the first step opens the form on the native village or town', await shown(PA, '#ff-form') && (await PA.$eval('#ff-kind', x => x.value)) === 'native' && await PA.isHidden('#ff-add'));
ok('the three audiences are offered, whole family first', (await PA.$$eval('#ff-aud button', bs => bs.map(x => x.textContent + ':' + x.getAttribute('aria-pressed')))).join() === 'Whole family:true,People I choose:false,Only me:false');
await PA.click('#ff-save');
ok('nothing written: it says so', await sees(PA, '#ff-err', /Write it down first/));
await PA.fill('#ff-text', 'Our family is from Bikaner. The old house is near Kote Gate.');
await PA.click('#ff-aud [data-aud="chosen"]');
ok('"People I choose" shows who can be ticked: only people on Parwah, never yourself', await shown(PA, '#ff-people .gchk') && (await PA.$$eval('#ff-people .gchk', ls => ls.map(x => x.textContent.trim()))).join() === 'Ramesh,Kavya,Bharat');
await PA.click('#ff-save');
ok('nobody ticked: it asks for at least one person', await sees(PA, '#ff-err', /Tick at least one person/));
await design(PA, '#ff-sheet', 'the family facts form, with people to tick and a message');
await PA.check('#ff-people input[value="' + a.Kavya.memberId + '"]');
await PA.click('#ff-save');
ok('saved: the fact is listed under its kind, with who wrote it and who sees it', await sees(PA, '#ff-list', /Our family is from Bikaner/) && /Native village or town/i.test(await PA.textContent('#ff-list'))
   && /Written by you · People I choose/.test(await PA.textContent('#ff-list')) && await gone(PA, '#ff-form'));
await PA.click('#ff-add');
await PA.selectOption('#ff-kind', 'gotra'); await PA.fill('#ff-text', 'The locker OTP is 4455'); await PA.click('#ff-save');
ok('error: an OTP is refused, in plain words, through humanFail', await sees(PA, '#ff-err', /Parwah never keeps a CVV, OTP or banking PIN/));
await PA.fill('#ff-text', 'Bharadwaj'); await PA.click('#ff-save');
ok('a second fact, for the whole family', await sees(PA, '#ff-list', /Bharadwaj/) && /Written by you · Whole family/.test(await PA.textContent('#ff-list')));
await design(PA, '#ff-sheet', 'family facts with two facts');
if (process.env.WF_SHOT_DIR) await PA.screenshot({ path: process.env.WF_SHOT_DIR + '/wider-facts-390-light.png' });

const PB = await phone(a.Bharat, { width: 320 });
await PB.click('#ff-open');
ok('Bharat was not chosen: he sees the gotra, and not the fact for chosen people', await sees(PB, '#ff-list', /Bharadwaj/) && !/Bikaner/.test(await PB.textContent('#ff-sheet')));
ok('he did not write it and is not an elder: no Change, no Remove', (await PB.$$('#ff-list [data-ffedit], #ff-list [data-ffdel]')).length === 0 && /Written by Arjun · Whole family/.test(await PB.textContent('#ff-list')));
await PB.close();
const PV2 = await phone(a.Kavya, { scheme: 'dark' });
await PV2.click('#ff-open');
ok('Kavya was chosen: she sees both', await sees(PV2, '#ff-list', /Our family is from Bikaner/) && /Bharadwaj/.test(await PV2.textContent('#ff-list')));
await PV2.close();
const PR = await phone(a.Ramesh);
await PR.click('#ff-open');
ok('Ramesh, an elder who was not chosen, does not see the chosen fact either', await sees(PR, '#ff-list', /Bharadwaj/) && !/Bikaner/.test(await PR.textContent('#ff-sheet')));
ok('but as an elder he can change the fact the whole family sees', (await PR.$$('#ff-list [data-ffedit]')).length === 1);
await PR.click('#ff-list [data-ffedit]');
ok('an elder changes the words only: who sees it is not his to change', await shown(PR, '#ff-form') && await PR.isHidden('#ff-audwrap') && (await PR.$eval('#ff-kind', x => x.disabled)) && (await PR.inputValue('#ff-text')) === 'Bharadwaj');
await PR.fill('#ff-text', 'Bharadwaj gotra'); await PR.click('#ff-save');
ok('and it is saved', await sees(PR, '#ff-list', /Bharadwaj gotra/));
await PR.click('#ff-list [data-ffdel]');
ok('removing asks first', await shown(PR, '#asksheet') && /Remove this from the family facts\?/.test(await PR.textContent('#as-q')));
await PR.click('#as-no');
ok('keeping it keeps it', await gone(PR, '#asksheet') && /Bharadwaj gotra/.test(await PR.textContent('#ff-list')));
// The facts could not be read: say so, and keep what the phone has.
// A database message must never reach the screen: humanFail swaps it for plain words.
await PR.route('**/api/circle', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'relation "family_facts" does not exist' }) }));
await PR.click('#ff-x'); await PR.click('#ff-open');
ok('error: it says the facts could not be loaded, keeps the last ones, and offers Try again', await sees(PR, '#ff-note', /Could not load family facts\. Try again in a moment\. Showing what was loaded last\./) && await PR.isVisible('#ff-note [data-ffretry]') && /Bharadwaj gotra/.test(await PR.textContent('#ff-list')) && !/relation|does not exist/.test(await PR.textContent('#ff-sheet')), await PR.textContent('#ff-note'));
await design(PR, '#ff-sheet', 'family facts with an error message');
await PR.unroute('**/api/circle');
await PR.route('**/api/circle', r => r.abort());
await PR.click('#ff-note [data-ffretry]');
ok('offline: it says so plainly', await sees(PR, '#ff-note', /You are offline\. This is what this phone last saw\./));
await PR.click('#ff-x'); await PR.click('#fl-open');
ok('offline, linked families says so too', await sees(PR, '#fl-note', /You are offline/));
await PR.unroute('**/api/circle');
await PR.close();
// Loading: the sheet opened before the answer has come.
let release; const held = new Promise(r => { release = r; });
await PA.click('#ff-x');
const PL = await phone(a.Bharat);
await PL.route('**/api/circle', async r => { await held; await r.continue(); });
await PL.click('#ff-open');
ok('loading: it says so while the facts are being read', await sees(PL, '#ff-note', /Loading family facts/));
release();
ok('and fills in by itself when they arrive', await sees(PL, '#ff-list', /Bharadwaj gotra/) && await gone(PL, '#ff-note'));
await PL.close();

// ========================================================= DAYS OF REMEMBRANCE
const today = wallIn(Date.now(), 'Asia/Kolkata').date, [ty, tm, td] = today.split('-').map(Number);
await PA.click('#tree [data-mprof="' + dadaji + '"]');
ok('a person\'s sheet has a quiet way in, and no mark yet', await shown(PA, '#msheet') && await PA.isVisible('#rm-mp-open') && (await PA.textContent('#rm-mp-open')).trim() === '🪔 No longer with us?' && await PA.isHidden('#rm-mp-row'));
await design(PA, '#msheet', 'a person\'s sheet with the new button');
await PA.click('#rm-mp-open');
ok('the sheet asks for the year, and says what follows, gently', await shown(PA, '#rm-sheet') && (await PA.textContent('#rm-title')) === 'Dadaji is no longer with us' && /one gentle reminder each year, the evening before/.test(await PA.textContent('#rm-hint'))
   && !/\b(deceased|death|died|dead|expired)\b/i.test(await PA.textContent('#rm-sheet')));
await PA.click('#rm-save');
ok('no year: it asks for it', await sees(PA, '#rm-err', /Write the year in four numbers/));
await PA.fill('#rm-year', '2019'); await PA.fill('#rm-day', '12'); await PA.click('#rm-save');
ok('a day with no month: it asks for the month', await sees(PA, '#rm-err', /Choose the month as well/));
await PA.selectOption('#rm-month', '2'); await PA.fill('#rm-day', '30'); await PA.click('#rm-save');
ok('error: a date that cannot be is refused by the server, in plain words', await sees(PA, '#rm-err', /That day is not in February 2019/));
await design(PA, '#rm-sheet', 'the remembrance sheet, with a message');
if (process.env.WF_SHOT_DIR) await PA.screenshot({ path: process.env.WF_SHOT_DIR + '/wider-remember-sheet-390-light.png' });
await PA.fill('#rm-year', String(ty - 7)); await PA.selectOption('#rm-month', String(tm)); await PA.fill('#rm-day', String(td));
await PA.fill('#rm-line', 'He taught us all to ride a cycle.');
await PA.click('#rm-save');
ok('saved: the sheet closes', await gone(PA, '#rm-sheet'));
ok('the tree shows him with a marker in words, not a colour alone', await sees(PA, '#tree [data-mprof="' + dadaji + '"] small', /🪔 No longer with us/)
   && !/not on Parwah/.test(await PA.textContent('#tree [data-mprof="' + dadaji + '"]')));
await design(PA, '#tree', 'the tree with a remembered person');
await PA.click('#tree [data-mprof="' + dadaji + '"]');
ok('his sheet says it, with the date and the line, and asks nothing of him', await shown(PA, '#msheet') && await PA.isVisible('#rm-mp-row') && /No longer with us/.test(await PA.textContent('#rm-mp-row'))
   && new RegExp('^' + td + ' \\w+ ' + (ty - 7) + '$').test(await PA.textContent('#rm-mp-when')) && /He taught us all to ride a cycle/.test(await PA.textContent('#rm-mp-say'))
   && await PA.isHidden('#mp-remind') && await PA.isHidden('#mp-dm') && await PA.isHidden('#mp-gift') && (await PA.textContent('#rm-mp-open')).trim() === '🪔 Day of remembrance', await PA.textContent('#rm-mp-when'));
await design(PA, '#msheet', 'the sheet of someone who is remembered');
await PA.click('#mp-x');
await PA.evaluate(() => { location.hash = '#home'; });
ok('on the day, Today has one calm reminder', await sees(PA, '#rm-today', /Today is Dadaji's day of remembrance\./) && /7 years without Dadaji\. We remember\./.test(await PA.textContent('#rm-today'))
   && /He taught us all to ride a cycle/.test(await PA.textContent('#rm-today')) && (await PA.$$('#rm-today .crow')).length === 1);
ok('in plain words, never clinical', !/\b(deceased|death|died|dead|expired|anniversary)\b/i.test(await PA.textContent('#rm-today')));
await design(PA, '#rm-today', 'the day of remembrance on Today');
if (process.env.WF_SHOT_DIR) await PA.screenshot({ path: process.env.WF_SHOT_DIR + '/wider-today-390-light.png' });
ok('the reminder was claimed once, however many phones were open', (await admin.query('select count(*)::int as n from remember_sent where member_id = $1', [dadaji])).rows[0].n === 1);
await PA.click('#rm-today [data-rmsee]');
ok('the button opens his sheet', await shown(PA, '#msheet') && (await PA.textContent('#mp-name')) === 'Dadaji');
// Any adult can take the mark off.
await PA.click('#rm-mp-open');
ok('the same sheet now offers to take the mark off', await shown(PA, '#rm-sheet') && await PA.isVisible('#rm-undo') && (await PA.textContent('#rm-title')) === 'Remembering Dadaji' && (await PA.inputValue('#rm-year')) === String(ty - 7));
await PA.click('#rm-undo');
ok('taking it off asks first', await shown(PA, '#asksheet') && /Take this mark off Dadaji\?/.test(await PA.textContent('#as-q')));
await PA.click('#as-yes');
ok('the mark is off: Today is quiet again', await gone(PA, '#rm-sheet') && await PA.waitForFunction(() => !document.querySelector('#rm-today .crow'), null, T).then(() => true, () => false));
await PA.evaluate(() => { location.hash = '#people'; });
ok('and the tree says "not on Parwah" for him as before', await sees(PA, '#tree [data-mprof="' + dadaji + '"] small', /not on Parwah/) && !/No longer with us/.test(await PA.textContent('#tree')));

// Someone marked by mistake is here, on their own phone: they take the mark off themself.
await admin.query(`update members set remembered = true, passed_year = 2025 where id = $1`, [a.Arjun.memberId]);
await PA.waitForFunction((id) => { const r = document.querySelector('#tree [data-mprof="' + id + '"]'); return !!r && /No longer with us|Remembered/i.test(r.textContent); }, a.Arjun.memberId, T).catch(() => {});
await PA.click('#tree [data-mprof="' + a.Arjun.memberId + '"]');
ok('my own sheet, when I was marked, offers to take the mark off', await shown(PA, '#msheet') && await shown(PA, '#rm-mp-open') && (await PA.textContent('#rm-mp-open')).trim() === 'This is a mistake. Take the mark off');
await design(PA, '#msheet', 'my own sheet when I was marked by mistake');
await PA.click('#rm-mp-open');
ok('it asks first, in plain words, and never opens the date sheet', await shown(PA, '#asksheet') && /Take this mark off yourself\?/.test(await PA.textContent('#as-q')) && await PA.isHidden('#rm-sheet'));
await PA.click('#as-yes');
ok('the mark is off me, in the database and on the tree', await PA.waitForFunction(() => /The mark is off/.test(document.getElementById('toast').textContent), null, T).then(() => true, () => false)
   && (await admin.query('select remembered, passed_year from members where id = $1', [a.Arjun.memberId])).rows[0].remembered === false
   && (await admin.query('select passed_year from members where id = $1', [a.Arjun.memberId])).rows[0].passed_year === null);
ok('nobody can mark themself: with no mark there is no such button on my own sheet', await (async () => {
  await admin.query(`update members set remembered = false where id = $1`, [a.Arjun.memberId]);
  await PA.evaluate(() => { location.hash = '#home'; }); await PA.evaluate(() => { location.hash = '#people'; });
  await PA.waitForFunction((id) => { const r = document.querySelector('#tree [data-mprof="' + id + '"]'); return !!r && !/No longer with us/i.test(r.textContent); }, a.Arjun.memberId, T).catch(() => {});
  await PA.click('#tree [data-mprof="' + a.Arjun.memberId + '"]');
  return await shown(PA, '#msheet') && await PA.isHidden('#rm-mp-open');
})());

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`widerfamily.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`widerfamily.e2e: ${pass}/${pass} checks pass`);
