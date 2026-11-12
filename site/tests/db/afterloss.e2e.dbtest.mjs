// "WHAT NEEDS DOING", END TO END: real browsers, the real API handlers and a
// real PostgreSQL. What a family meets:
//
//   - Papa keeps three things in the Family register: a bank account for
//     the whole family, a policy for Priya only, and a locker that opens
//     "only in an emergency". The form now says what that last one means.
//   - Rohan finds a quiet link under the register, picks Papa, and asks
//     Meera to confirm. Nothing opens while it waits.
//   - Meera sees one quiet line in the Vault, opens it and says yes.
//   - Each of them sees the nine first things and only the register steps
//     they could already see: the locker for Rohan and Meera (they started
//     it), the policy for Priya (she was chosen), never the other way.
//   - They tick, give a step to someone and leave a note; the count on the
//     other phones follows. A password in a note is refused under the step.
//   - Closing it shuts the locker again; it can be opened again.
//   - With no internet the list says so and offers "Try again".
//
// Nothing here looks at the page after a fixed delay: every check waits for
// the element or the words it is about to read. The screens are measured:
// 44px targets, a 12px floor, WCAG AA in light and dark, nothing sideways
// at 320 and 390. With AFTERLOSS_SHOT_DIR set, each is saved at 390 and 1440.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('afterloss.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('afterloss.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('afterloss.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function person(circleId, code, circleName, name, role = 'family') {
  const phone = '+9198633' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id, place, country) values ($1,$2,$3,$4,'Delhi','IN') returning id`, [circleId, name, role, u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { memberId: m.id, id: m.id, userId: u.id, name, token, phone, code, circleName, role };
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
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.2.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
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
const SHOTS = process.env.AFTERLOSS_SHOT_DIR;
// After a resize or a theme change: until the page has the new width and has painted twice.
const settled = (page, w) => page.evaluate((w) => new Promise(done => { const go = () => (innerWidth === w ? requestAnimationFrame(() => requestAnimationFrame(() => done(true))) : requestAnimationFrame(go)); go(); }), w);
async function shotAll(page, name, sel){
  if (!SHOTS) return;
  const was = page.viewportSize();
  for (const w of [390, 1440]) for (const sc of ['light', 'dark']) {
    await page.setViewportSize({ width: w, height: 900 }); await page.emulateMedia({ colorScheme: sc }); await settled(page, w);
    if (sel) await page.locator(sel).screenshot({ path: `${SHOTS}/${name}-${w}-${sc}.png` });
    else await page.screenshot({ path: `${SHOTS}/${name}-${w}-${sc}.png`, fullPage: true });
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' }); await settled(page, was.width);
}
async function phone(who, { hash = '', big = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' });
  await ctx.addInitScript(([w, big]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
    localStorage.setItem('parwah-big', big ? '1' : '0');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: w.role, circleName: w.circleName }));
  }, [who, big]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  // In the app, with the family known: the pickers are filled from it.
  await page.waitForFunction(() => document.body.classList.contains('inapp'), null, { timeout: 20000 });
  return page;
}

function measureIn(sel) {
  const root = document.querySelector(sel);
  if (!root) return { overflow: 0, bad: ['missing ' + sel] };
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
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) {
      // The label is the target: it must be 44px itself.
      const lr = el.closest('label').getBoundingClientRect();
      if (Math.min(lr.width, lr.height) < 43.5) out.bad.push('small label ' + el.closest('label').textContent.trim().slice(0, 20) + ' ' + Math.round(lr.width) + 'x' + Math.round(lr.height));
      return;
    }
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) out.bad.push('small ' + (el.id || el.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const el = w.currentNode.parentElement; if (!w.currentNode.textContent.trim() || !el || !vis(el) || el.tagName === 'OPTION') continue;
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
  for (const [wd, sc] of [[320, 'light'], [390, 'light'], [390, 'dark'], [320, 'dark']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc }); await settled(page, wd);
    const m = await page.evaluate(measureIn, sel);
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' }); await settled(page, was.width);
  ok('design: ' + label + ' - 44px targets, 12px floor, AA in both themes, nothing sideways at 320/390', bad.length === 0, bad.slice(0, 6).join(' | '));
}

// ---- waiting for what is about to be read, never for a clock
const T = 30000;
const has = (P, sel, re) => P.waitForFunction(([s, r]) => { const el = document.querySelector(s); return !!el && !el.closest('[hidden]') && new RegExp(r).test(el.textContent); }, [sel, re.source], { timeout: T }).then(() => true, () => false);
const lacks = (P, sel, re) => P.waitForFunction(([s, r]) => { const el = document.querySelector(s); return !el || !new RegExp(r).test(el.textContent); }, [sel, re.source], { timeout: T }).then(() => true, () => false);
const shown = (P, sel) => P.waitForSelector(sel, { state: 'visible', timeout: T }).then(() => true, () => false);
const hiddenNow = (P, sel) => P.waitForSelector(sel, { state: 'hidden', timeout: T }).then(() => true, () => false);
const progress = (P, text) => P.waitForFunction((t) => { const el = document.getElementById('al-progress'); return !!el && el.textContent === t; }, text, { timeout: T }).then(() => true, async () => { console.log('   progress was: ' + await P.textContent('#al-body').catch(() => '')); return false; });
const stepSel = (key) => `#al-body .alstep[data-alkey="${key}"]`;
const body = (P) => P.textContent('#al-body');
const yes = async (P) => { await shown(P, '#asksheet'); await P.click('#as-yes'); await hiddenNow(P, '#asksheet'); };

// ---- a family of four
const fam = (await admin.query(`insert into circles (code, name, kind) values ('SHARMA','Sharma Family','family') returning id`)).rows[0].id;
const papa = await person(fam, 'SHARMA', 'Sharma Family', 'Papa', 'parent');
const rohan = await person(fam, 'SHARMA', 'Sharma Family', 'Rohan');
const meera = await person(fam, 'SHARMA', 'Sharma Family', 'Meera');
const priya = await person(fam, 'SHARMA', 'Sharma Family', 'Priya');
const SEC = '#pane-vault .subsec[data-sec="locator"]';
const registerRead = (P) => P.waitForFunction(() => { const f = document.getElementById('locator-feed'); return f && !/Loading/.test(f.textContent); }, null, { timeout: T });
const openRegister = async (who, opts) => {
  const P = await phone(who, { hash: '#vault', ...(opts || {}) });
  await P.click('#vault-seg [data-sec="locator"]');
  // Until the list has been read: the very first read also makes the tables.
  await registerRead(P);
  // And until the family is known, so the pickers are filled.
  await P.waitForFunction(() => document.querySelectorAll('#loc-about option').length >= 4, null, { timeout: T });
  return P;
};
const rowOf = (P, text) => P.locator('#locator-feed .frrow', { hasText: text }).first();
const dbRows = async () => (await admin.query(`select * from legacy_asset_locators order by created_at`)).rows;
const policies = async () => JSON.stringify((await admin.query(`select id, unlock_policy, designated_recipients from legacy_asset_locators order by id`)).rows);
const lists = async () => (await admin.query(`select * from afterloss_lists order by started_at`)).rows;

// ================================================================ 1. Papa's register
const P = await openRegister(papa);
ok('the form says what "Only in an emergency" means now', (await P.textContent('#fr-who label:has(input[value="EMERGENCY_ONLY"]) small')) === "Opens during an emergency, or when the family starts 'What needs doing' for this person.");
async function addEntry(page, { item, cat, where, who, tick, nominee }) {
  await page.fill('#loc-item', item);
  await page.selectOption('#loc-cat', cat);
  await page.fill('#loc-notes', where);
  if (nominee) { await page.click('#fr-more summary'); await shown(page, '#fr-nominee'); await page.fill('#fr-nominee', nominee); }
  await page.click(`#fr-who label:has(input[value="${who}"])`);
  if (tick) { await shown(page, '#fr-people-list'); await page.click(`#fr-people-list label:has-text("${tick}")`); }
  await page.click('#btn-add-locator');
  await page.waitForFunction((t) => [...document.querySelectorAll('#locator-feed .frrow')].some(r => r.textContent.includes(t)) && document.getElementById('loc-item').value === '', item, { timeout: T });
}
await addEntry(P, { item: 'SBI savings', cat: 'BANK_ACCOUNT', where: 'Passbook in the steel almirah', who: 'IMMEDIATE', nominee: 'Meera' });
await addEntry(P, { item: 'SBI locker', cat: 'LOCKER_KEY', where: 'Key in the blue pouch', who: 'EMERGENCY_ONLY' });
await addEntry(P, { item: 'LIC policy', cat: 'INSURANCE', where: 'Bond in the grey box', who: 'NOMINEES_ONLY', tick: 'Priya' });
let all = await dbRows();
ok('Papa has three entries about himself: whole family, only in an emergency, and people he chose', all.length === 3 && all.every(r => r.person_id === papa.id)
   && all.map(r => r.unlock_policy).join() === 'IMMEDIATE,EMERGENCY_ONLY,NOMINEES_ONLY' && JSON.stringify(all[2].designated_recipients) === JSON.stringify([priya.id]), JSON.stringify(all.map(r => [r.institution_or_item, r.unlock_policy])));
const bankId = all[0].id, lockerId = all[1].id, licId = all[2].id;
const before = await policies();
ok('Papa has no line about any list at the top of his Vault', !(await P.isVisible('#al-top')));

// ================================================================ 2. Rohan finds the quiet link and asks Meera
const R = await openRegister(rohan);
ok('before anything: the locker is locked for Rohan, and says so', await has(R, '#locator-feed', /Shown to the family only during an SOS/) && !(await rowOf(R, 'Locker or locker key').locator('[data-fropen]').count()));
ok('the way in is a quiet text link under the register, not a button', await R.isVisible('#al-open') && (await R.textContent('#al-open')) === 'When someone passes away: what needs doing'
   && await R.$eval('#al-open', b => b.classList.contains('linkbtn') && !b.classList.contains('go') && !b.classList.contains('cbtn') && getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)'));
ok('the list is not on the screen until he asks for it', !(await R.isVisible('#al-panel')) && (await R.getAttribute('#al-open', 'aria-expanded')) === 'false');
await R.click('#al-open');
ok('it opens with its name, and says it is sorry', await shown(R, '#al-panel') && (await R.textContent('#al-head')) === 'What needs doing'
   && (await R.textContent('#al-sorry')) === 'We are sorry. This list is here so nothing is forgotten.' && (await R.getAttribute('#al-open', 'aria-expanded')) === 'true');
ok('and once, plainly, that it is not legal advice', (await R.textContent('#al-legal')) === 'This is a list to help you remember, not legal advice. Rules differ by bank and state.'
   && (await R.textContent(SEC)).split('not legal advice').length === 2);
ok('empty: it asks him to choose a person, and says nothing starts until two adults agree', await has(R, '#al-body', /Choose a person above\..*Nothing starts until two adults agree/));
ok('he can choose anyone in the family but himself', (await R.$$eval('#al-person option', os => os.map(o => o.textContent).join())) === 'Choose a person,Papa,Meera,Priya');
await design(R, '#al-wrap', 'the list before a person is chosen');
await R.selectOption('#al-person', papa.id);
ok('for Papa: nothing has been started, and it says when to start it', await has(R, '#al-body', /Nothing has been started for Papa\..*Start this only when Papa has passed away/));
ok('it asks who should confirm: the other adults, never Papa or Rohan', await shown(R, '#al-ask') && (await R.$$eval('#al-ask option', os => os.map(o => o.textContent).join())) === 'Meera,Priya');
ok('it says two people start it, and that starting changes nothing in the register', /Two people start this together, so it is never started by mistake/.test(await body(R))
   && /Starting it does not change who can see any entry in the register/.test(await body(R)));
ok('the button to ask is a plain one, not the bright primary', await R.$eval('#al-body [data-alstart]', b => b.classList.contains('ghost') && !b.classList.contains('go') && b.textContent === 'Ask them to confirm'));
await design(R, '#al-wrap', 'starting the list: who it is for and who confirms');
await shotAll(R, 'afterloss-start', '#al-wrap');
await R.selectOption('#al-ask', meera.id);
await R.click('#al-body [data-alstart]');
ok('it asks first, in the app\'s own sheet, naming Papa and Meera', await shown(R, '#asksheet') && /Start 'What needs doing' for Papa\?/.test(await R.textContent('#as-q'))
   && /Meera will be asked to confirm\. The family is told only after that\./.test(await R.textContent('#as-sub')) && (await R.textContent('#as-yes')) === 'Yes, ask Meera');
await design(R, '#asksheet', 'the "start it?" sheet');
await R.click('#as-no'); await hiddenNow(R, '#asksheet');
ok('"Not now" starts nothing', (await lists()).length === 0);
await R.click('#al-body [data-alstart]'); await yes(R);
ok('Rohan sees that he asked Meera, and that nothing is open yet', await has(R, '#al-body [data-alpending]', /You asked Meera to confirm this list for Papa\..*It starts only if Meera agrees\. Nothing is open yet\./));
let L = await lists();
ok('the list waits: asked by Rohan, of Meera, not confirmed', L.length === 1 && L[0].status === 'pending' && L[0].started_by === rohan.id && L[0].ask_member === meera.id && L[0].confirmed_by === null, JSON.stringify(L));
ok('he can take the request back, and cannot confirm it himself', await R.isVisible('#al-body [data-alcancel]') && !(await R.$('#al-body [data-alconfirm]')));
ok('the top of his Vault says who it is waiting for', await has(R, '#al-top', /Waiting for Meera to confirm 'What needs doing' for Papa\./));
ok('while it waits there are no steps, and the locker is still locked for him', !(await R.$('#al-body .alstep')) && /Shown to the family only during an SOS/.test(await R.textContent('#locator-feed')));
await design(R, '#al-wrap', 'waiting for the second adult');

// ================================================================ 3. Meera is asked, and says yes
const M = await phone(meera, { hash: '#vault' });
ok('Meera sees one quiet line at the top of the Vault, on any of its tabs', await has(M, '#al-top', /Rohan asks you to confirm 'What needs doing' for Papa\./) && await M.isVisible('#vault-seg [data-sec="docs"].sel'));
ok('the line is plain text with a text link, no alert colour', await M.$eval('#al-top .linkbtn', b => getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)' && b.textContent === 'Open the list'));
await design(M, '#al-top', 'the line at the top of the Vault');
await M.click('#al-top [data-algoto]');
ok('"Open the list" takes her to the register, with the list open on Papa', await shown(M, '#al-panel') && await M.isVisible('#vault-seg [data-sec="locator"].sel') && (await M.inputValue('#al-person')) === papa.id);
ok('she is told who asked, and to say yes only if Papa has passed away', await has(M, '#al-body', /Rohan asked you to confirm this list for Papa\..*Say yes only if Papa has passed away\. The family is told when you agree\./));
ok('she can say yes or not now; neither is the bright primary', await M.$eval('#al-body [data-alconfirm]', b => b.classList.contains('ghost')) && await M.$eval('#al-body [data-alcancel]', b => b.classList.contains('no')));
await design(M, '#al-wrap', 'being asked to confirm');
await shotAll(M, 'afterloss-confirm', '#al-wrap');
await M.click('#al-body [data-alconfirm]');
ok('saying yes asks once more, plainly', await shown(M, '#asksheet') && /Say yes only if Papa has passed away\. The family will be told\./.test(await M.textContent('#as-sub')));
await M.click('#as-yes'); await hiddenNow(M, '#asksheet');
ok('the list starts: 0 of 11 done for Meera (nine first things, the bank, the locker)', await progress(M, '0 of 11 done'));
L = await lists();
ok('active: started by Rohan, confirmed by Meera', L[0].status === 'active' && L[0].started_by === rohan.id && L[0].confirmed_by === meera.id, JSON.stringify(L[0]));
ok('starting it changed no entry\'s audience', (await policies()) === before);
ok('it says who started it', /Started by Rohan and Meera\./.test(await body(M)));

// ================================================================ 4. each sees the right steps
ok('first things: nine, the death certificate first', (await M.$$eval('#al-first .alstep', xs => xs.length)) === 9 && /Get the death certificate.*municipal office or the hospital.*several copies/.test(await M.textContent('#al-first .alstep')));
ok('Meera, from the register: the bank with its nominee, and the locker', (await M.$$eval('#al-reg .alstep', xs => xs.length)) === 2
   && /Tell SBI savings\. Ask for the claim form for the nominee Meera\./.test(await M.textContent(stepSel('e:' + bankId)))
   && /Tell the bank about SBI locker\..*Key: Key in the blue pouch\./.test(await M.textContent(stepSel('e:' + lockerId))), await M.textContent('#al-reg'));
ok('Meera has no step for the policy that was shared only with Priya', !(await M.$(stepSel('e:' + licId))) && !/LIC/.test(await body(M)));
ok('Rohan\'s phone follows on its own: the list is open, 0 of 11 done', await progress(R, '0 of 11 done'));
ok('Rohan: the bank and the locker, not the policy', !!(await R.$(stepSel('e:' + bankId))) && !!(await R.$(stepSel('e:' + lockerId))) && !(await R.$(stepSel('e:' + licId))) && !/LIC/.test(await body(R)));
const Y = await openRegister(priya);
ok('Priya sees that the list is open for Papa', await has(Y, '#al-top', /'What needs doing' is open for Papa\./));
await Y.click('#al-top [data-algoto]');
ok('Priya: 0 of 11 done too, but a different eleven', await progress(Y, '0 of 11 done'));
ok('Priya: the bank and the policy she was chosen for, never the locker', !!(await Y.$(stepSel('e:' + bankId))) && /Claim on LIC policy\..*Papers: Bond in the grey box\./.test(await Y.textContent(stepSel('e:' + licId)))
   && !(await Y.$(stepSel('e:' + lockerId))) && !/SBI locker|blue pouch/.test(await body(Y)), await Y.textContent('#al-reg'));
ok('in the register, the locker is now open to Rohan (he started it) and still locked for Priya', await has(R, '#al-top', /is open for Papa/)
   && (await (async () => { await R.selectOption('#fr-person', papa.id); await R.selectOption('#fr-person', ''); await R.click('#vault-seg [data-sec="docs"]'); await R.click('#vault-seg [data-sec="locator"]'); await registerRead(R);
        return R.waitForFunction(() => [...document.querySelectorAll('#locator-feed .frrow')].some(r => /SBI locker/.test(r.textContent) && r.querySelector('[data-fropen]')), null, { timeout: T }).then(() => true, () => false); })())
   && /Shown to the family only during an SOS/.test(await Y.textContent('#locator-feed')) && !/SBI locker/.test(await Y.textContent('#locator-feed')));
await design(M, '#al-wrap', 'the list, just started');

// ================================================================ 5. working it together
await M.check(`#al-body [data-altick="f:bank"]`);
ok('Meera ticks "Tell the bank or banks": 1 of 11 done, and it says who', await progress(M, '1 of 11 done') && await has(M, stepSel('f:bank') + ' [data-almeta]', /^Done by Meera$/)
   && await M.$eval(stepSel('f:bank'), el => el.classList.contains('done')));
ok('the progress bar moves with it', await M.$eval('#al-body .albar i', i => i.style.width === '9%'));
await M.selectOption(`#al-body [data-alassign="e:${lockerId}"]`, rohan.id);
ok('she gives the locker step to Rohan', await has(M, stepSel('e:' + lockerId) + ' [data-almeta]', /Rohan is doing this/));
ok('progress updates on Rohan\'s phone without him touching it', await progress(R, '1 of 11 done') && await has(R, stepSel('f:bank') + ' [data-almeta]', /Done by Meera/));
ok('and he sees the locker step is his', await has(R, stepSel('e:' + lockerId) + ' [data-almeta]', /You are doing this/) && (await R.inputValue(`#al-body [data-alassign="e:${lockerId}"]`)) === rohan.id);
await R.check(`#al-body [data-altick="e:${bankId}"]`);
ok('Rohan ticks the bank account step: 2 of 11 done', await progress(R, '2 of 11 done'));
await R.click(`#al-body [data-alnote="e:${bankId}"]`);
ok('a note is typed in the app\'s own sheet, and told never to hold a password', await shown(R, '#asksheet') && /A note for this step/.test(await R.textContent('#as-q')) && /Never a password, a PIN or a card number/.test(await R.textContent('#as-inlbl')));
await design(R, '#asksheet', 'the note sheet');
await R.fill('#as-in', 'Locker password: tiger@77');
await R.click('#as-yes'); await hiddenNow(R, '#asksheet');
ok('a password in a note is refused under that step, in plain words, and not saved', await has(R, stepSel('e:' + bankId) + ' .alwhy', /never keeps a password or a PIN/)
   && (await admin.query(`select note from afterloss_steps where step_key = $1`, ['e:' + bankId])).rows.every(x => x.note === null));
await design(R, '#al-wrap', 'the list with ticks, a step given to someone, and a refusal under a step');
await R.click(`#al-body [data-alnote="e:${bankId}"]`); await shown(R, '#asksheet');
await R.fill('#as-in', 'Branch opens at ten. Ask for Mr Rao.');
await R.click('#as-yes'); await hiddenNow(R, '#asksheet');
ok('a plain note is kept, with who wrote it, and the refusal is gone', await has(R, stepSel('e:' + bankId) + ' [data-alnotetext]', /^Note from Rohan: Branch opens at ten\. Ask for Mr Rao\.$/) && !(await R.$(stepSel('e:' + bankId) + ' .alwhy')));
ok('Meera\'s phone follows: 2 of 11 done, with Rohan\'s tick and note', await progress(M, '2 of 11 done') && await has(M, stepSel('e:' + bankId) + ' [data-almeta]', /Done by Rohan/)
   && await has(M, stepSel('e:' + bankId) + ' [data-alnotetext]', /Note from Rohan: Branch opens at ten/));
ok('Priya\'s phone follows too: both are steps she can see', await progress(Y, '2 of 11 done') && await has(Y, stepSel('e:' + bankId) + ' [data-alnotetext]', /Branch opens at ten/));
ok('Priya cannot be given the locker step: it is not on her list, and she is told nothing of it', !(await Y.$(`[data-alassign="e:${lockerId}"]`)) && !/Rohan is doing this/.test(await body(Y)));
await Y.check(`#al-body [data-altick="e:${licId}"]`);
ok('Priya ticks the policy: 3 of 11 for her, still 2 of 11 for Meera, who cannot see it', await progress(Y, '3 of 11 done') && await has(Y, stepSel('e:' + licId) + ' [data-almeta]', /Done by Priya/)
   && await progress(M, '2 of 11 done') && !(await M.$(stepSel('e:' + licId))));
ok('ticks, the assignment and the note are in the database once each', await (async () => { const s = (await admin.query(`select step_key, done, assigned_to, note from afterloss_steps order by step_key`)).rows;
   return s.length === 4 && s.find(x => x.step_key === 'f:bank').done && s.find(x => x.step_key === 'e:' + bankId).done && s.find(x => x.step_key === 'e:' + bankId).note === 'Branch opens at ten. Ask for Mr Rao.'
     && s.find(x => x.step_key === 'e:' + lockerId).assigned_to === rohan.id && s.find(x => x.step_key === 'e:' + licId).done; })());
ok('nothing so far has changed who can see any entry', (await policies()) === before);
await design(M, '#al-wrap', 'the list in use, on the other phone');
await design(Y, '#al-wrap', 'the list as someone who did not start it sees it');
await shotAll(M, 'afterloss-list', '#al-wrap');
// No status wears a vibe or alert colour: the tick and the bar are the status green.
ok('the tick and the bar are the status green, and nothing in the list is the alert colour', await M.evaluate(() => {
  const css = getComputedStyle(document.documentElement), okc = css.getPropertyValue('--ok').trim().toLowerCase(), alert = css.getPropertyValue('--alert').trim().toLowerCase();
  const hex = (c) => { const m = c.match(/\d+/g); return m ? '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('') : ''; };
  const bar = hex(getComputedStyle(document.querySelector('#al-body .albar i')).backgroundColor);
  const tick = hex(getComputedStyle(document.querySelector('#al-body [data-altick]')).accentColor);
  const any = [...document.querySelectorAll('#al-wrap *')].some(el => { const c = getComputedStyle(el); return [c.color, c.backgroundColor, c.borderLeftColor].some(x => hex(x) === alert); });
  return bar === okc && tick === okc && !any;
}));

// ================================================================ 6. from a person's page
// Papa is marked as remembered now (the list is in force), so he is no longer
// in the "looked after" rows; his page is reached the way the tree reaches it.
const openPerson = (pg, id) => pg.evaluate((pid) => { const b = document.createElement('button'); b.setAttribute('data-person', pid); b.hidden = true; document.body.appendChild(b); b.click(); b.remove(); }, id);
ok('a list in force marks Papa as remembered, and he leaves the "looked after" rows', (await admin.query('select remembered, passed_year from members where id = $1', [papa.id])).rows[0].remembered === true
   && (await admin.query('select passed_year from members where id = $1', [papa.id])).rows[0].passed_year == null
   && await Y.waitForFunction((id) => !!document.querySelector('[data-person]') && !document.querySelector(`[data-person="${id}"]`), papa.id, { timeout: T }).then(() => true, () => false));
await openPerson(Y, papa.id);
ok('on Papa\'s page there is the same quiet link, last on the page', await shown(Y, '#pane-person') && await shown(Y, '#al-pp-link') && (await Y.textContent('#al-pp-link')) === 'When someone passes away: what needs doing'
   && await Y.$eval('#al-pp-link', b => b.classList.contains('linkbtn') && getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)' && !b.closest('section').querySelector('.alpp ~ *')));
await design(Y, '.alpp', 'the link on a person\'s page');
await Y.click('#al-pp-link');
ok('it opens the list for that person in the register', await shown(Y, '#al-panel') && (await Y.inputValue('#al-person')) === papa.id && await progress(Y, '3 of 11 done'));
await openPerson(Y, papa.id); await shown(Y, '#pane-person');
ok('nobody is offered it on their own page', await (async () => { const S2 = await phone(priya, { hash: '#profile' }); await S2.waitForSelector('[data-person]', { state: 'attached', timeout: T });
  await S2.evaluate((id) => { const b = document.createElement('button'); b.setAttribute('data-person', id); b.hidden = true; document.body.appendChild(b); b.click(); b.remove(); }, priya.id);
  const there = await shown(S2, '#pane-person'); const hid = !(await S2.isVisible('#al-pp-link')); await S2.context().close(); return there && hid; })());

// ================================================================ 7. closing shuts the emergency entries again
await R.click('#al-body [data-alclose]');
ok('closing asks first, and says what closes with it', await shown(R, '#asksheet') && /Close this list\?/.test(await R.textContent('#as-q')) && /it can be opened again\. Entries marked "Only in an emergency" close again\./.test(await R.textContent('#as-sub')));
await R.click('#as-yes'); await hiddenNow(R, '#asksheet');
ok('closed: it says so, and keeps what was ticked', await has(R, '#al-body [data-alclosed]', /This list is closed\..*What was ticked is kept/) && await R.$eval(stepSel('f:bank'), el => el.classList.contains('done')));
ok('closed: the locker step is gone from Rohan\'s list, and the count is of what he can see now', await lacks(R, '#al-body', /SBI locker/) && await progress(R, '2 of 10 done'));
ok('closed: nothing can be ticked, given or noted', (await R.$$eval('#al-body [data-altick]', xs => xs.every(x => x.disabled))) && !(await R.$('#al-body [data-alassign]')) && !(await R.$('#al-body [data-alnote]')));
ok('closed: the line at the top of the Vault is gone', await hiddenNow(R, '#al-top'));
await R.click('#vault-seg [data-sec="docs"]'); await R.click('#vault-seg [data-sec="locator"]'); await registerRead(R);
ok('closed: the register has locked the locker for Rohan again', await has(R, '#locator-feed', /Shown to the family only during an SOS/) && !/SBI locker/.test(await R.textContent('#locator-feed')));
ok('closing changed no entry\'s audience', (await policies()) === before && (await lists())[0].status === 'closed');
await design(R, '#al-wrap', 'a closed list');
ok('Meera\'s phone follows: closed, and the locker step is gone', await has(M, '#al-body [data-alclosed]', /This list is closed/) && await lacks(M, '#al-body', /SBI locker/));
// Opening it again is the start rule again: a second adult is asked.
ok('closed: opening it again asks who should confirm', await shown(M, '#al-body #al-ask') && await has(M, '#al-body [data-alreopen]', /Ask them to open this list again/)
   && await has(M, '#al-body', /Two people open this again together/));
await M.selectOption('#al-ask', rohan.id);
await design(M, '#al-wrap', 'a closed list, with who should confirm');
await M.click('#al-body [data-alreopen]');
ok('Meera asks Rohan: it waits, and nothing is open yet', await has(M, '#al-body [data-alpending]', /You asked Rohan to confirm this list for Papa.*Nothing is open yet/) && (await lists())[0].status === 'pending'
   && (await lists())[0].started_by === meera.id && (await lists())[0].confirmed_by === null);
ok('Rohan\'s phone shows the request, and no steps', await has(R, '#al-body [data-alpending]', /Meera asked you to confirm/) && await shown(R, '#al-body [data-alconfirm]') && !(await R.$('#al-body [data-altick]')));
await R.click('#al-body [data-alconfirm]'); await yes(R);
ok('Rohan says yes: it is open again, the locker step is back, still given to Rohan, the ticks kept', await progress(M, '2 of 11 done') && await has(M, stepSel('e:' + lockerId) + ' [data-almeta]', /Rohan is doing this/)
   && (await lists())[0].status === 'active' && (await lists())[0].confirmed_by === rohan.id);

// ================================================================ 8. senior mode, and no internet
const S = await openRegister(priya, { big: true });
ok('Priya is in senior mode', await S.evaluate(() => document.body.classList.contains('senior')));
await S.click('#al-open'); await shown(S, '#al-panel');
await S.selectOption('#al-person', papa.id);
ok('the list reads the same in senior mode', await progress(S, '3 of 11 done'));
await design(S, '#al-wrap', 'the list in senior mode');
await S.context().setOffline(true);
await S.selectOption('#al-person', meera.id);
ok('with no internet it says so, and offers Try again', await has(S, '#al-body', /offline|No connection/) && await shown(S, '#al-body [data-alretry]'), await body(S));
await design(S, '#al-wrap', 'the offline message, senior mode');
await S.context().setOffline(false);
await S.click('#al-body [data-alretry]');
ok('Try again brings it back: nothing has been started for Meera', await has(S, '#al-body', /Nothing has been started for Meera/));
// A server that answers with an error: said in plain words, never the raw one.
await S.route('**/api/book?area=afterloss**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'relation "afterloss_lists" does not exist' }) }));
await S.selectOption('#al-person', papa.id);
ok('an error from the server is said plainly, with Try again, never the raw words', await has(S, '#al-body', /Could not load this\. Try again in a moment\./) && !/relation|afterloss_lists/.test(await body(S)) && await S.isVisible('#al-body [data-alretry]'));
await S.unroute('**/api/book?area=afterloss**');
await S.click('#al-body [data-alretry]');
ok('and Try again brings the list back', await progress(S, '3 of 11 done'));

// ================================================================ 9. the person it is about closes it: removed
await P.click('#al-open').catch(() => {}); await shown(P, '#al-panel');
await P.selectOption('#al-person', papa.id);
ok('Papa sees that the list was started for him, and that he can close it', await has(P, '#al-body', /This list was started for you\. If that was a mistake, you can close it below\./) && await shown(P, '#al-body [data-alclose]'));
await P.click('#al-body [data-alclose]');
ok('closing it as the person says it will be removed, and who is told', await shown(P, '#asksheet') && /Closing it removes it, and the people who started it are told\./.test(await P.textContent('#as-sub')));
await P.click('#as-yes'); await hiddenNow(P, '#asksheet');
ok('it is gone: no list for Papa, in the page and in the database', await has(P, '#al-body', /This list is started by the family, for someone else\./) && (await lists()).length === 0
   && (await admin.query('select 1 from afterloss_steps')).rows.length === 0);
ok('the mark the list set is off Papa', (await admin.query('select remembered from members where id = $1', [papa.id])).rows[0].remembered === false);
ok('Meera\'s phone follows: nothing has been started for Papa, and it would take two again', await has(M, '#al-body', /Nothing has been started for Papa/) && await shown(M, '#al-body #al-ask'));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`afterloss.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`afterloss.e2e: ${pass}/${pass} checks pass`);
