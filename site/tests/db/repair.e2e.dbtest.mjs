// THE PRE-LAUNCH REPAIRS, END TO END: a real browser, the real API and a
// real PostgreSQL. Each journey here was broken before the audit of
// 2026-10-30, and each says what a family would have met:
//
// - a forgotten PIN: the family was asked, and nothing showed the question
// - the offline emergency card: wiped by an empty copy when the family list
//   had not loaded yet
// - "When I'm not here": the form posted an action the server never had
// - lab numbers: invented values queued after an upload, and a read the
//   server refused
// - medicine stock: no way to record it, and buttons the server did not know
// - a voice note to a to-do: the wrong action, the question as the title
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('repair.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('repair.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
// Ekta answers from the family's own records here: no key, no network.
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('repair.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'ekta']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function user(name) {
  const phone = '+9198700' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
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
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.0.' + (++n) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
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
const SHOTS = process.env.REPAIR_SHOT_DIR;
// With REPAIR_SHOT_DIR set: the screen at 390 and 1440, light and dark.
async function shotAll(page, name){
  if (!SHOTS) return;
  const was = page.viewportSize();
  for (const w of [390, 1440]) for (const sc of ['light', 'dark']) {
    await page.setViewportSize({ width: w, height: 900 }); await page.emulateMedia({ colorScheme: sc });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${w}-${sc}.png`, fullPage: false });
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
}

async function phone(who, { scheme = 'light', width = 390, hash = '', ctx = null } = {}) {
  ctx = ctx || await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', colorScheme: scheme });
  await ctx.addInitScript(([w]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    if (w.memberId) localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: w.role || 'family', circleName: w.circleName }));
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  await page.waitForTimeout(1300);
  return page;
}
const call = async (name, body, query = {}, method = 'POST', token) => {
  let out, st = 200; const res = { status(s) { st = s; return this; }, json(j) { out = j; return this; }, setHeader() {} };
  await HANDLERS[name]({ method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.4.0.' + (++n) }, query, body }, res);
  return { ...out, http: st };
};

// ---- the family: Anchit, his brother Rahul, Papa
const U = { Anchit: await user('Anchit') };
const made = await call('circle', { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Anchit', circleName: 'Tandon Family', userId: U.Anchit.userId, relation: 'son' }, {}, 'POST', U.Anchit.token);
const code = made.code;
await admin.query(`update circles set join_policy = 'open' where code = $1`, [code]);
U.Anchit.memberId = made.memberId;
for (const [name, rel] of [['Rahul', 'son'], ['Papa', 'father']]) {
  U[name] = await user(name);
  const j = await call('circle', { action: 'join', code, memberName: name, userId: U[name].userId, relation: rel }, {}, 'POST', U[name].token);
  U[name].memberId = j.memberId;
}
await admin.query(`update members set role = 'parent' where id = $1`, [U.Papa.memberId]);
const as = (name) => ({ ...U[name], code, circleName: 'Tandon Family' });
const book = (name, body) => call('book', { code, memberId: U[name].memberId, ...body }, {}, 'POST', U[name].token);
await book('Anchit', { action: 'add', kind: 'fact', category: 'blood', name: 'Blood group', forwhat: 'B+', aboutId: U.Papa.memberId });
await book('Anchit', { action: 'add', kind: 'med', name: 'Amlopres 5', forwhat: 'BP', aboutId: U.Papa.memberId });

// =====================================================================
// 1. A FORGOTTEN PIN: the family sees the question and answers it
// =====================================================================
const asked = await call('auth', { action: 'reset_request', phone: U.Rahul.phone.slice(3), cc: '+91' });
ok('Rahul asks the family to let him back in', asked.ok && asked.asked, JSON.stringify(asked));

// Anchit signs in on a new phone, with his number and PIN.
const ctxS = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const S = await ctxS.newPage(); S.on('pageerror', e => errors.push('S: ' + e.message));
await S.goto(BASE + '/'); await S.waitForTimeout(700);
await S.fill('#au-phone', U.Anchit.phone.slice(3)); await S.click('#au-go'); await S.waitForTimeout(900);
await S.fill('#au-pin', '4819'); await S.click('#au-go'); await S.waitForTimeout(1200);
// Signing in lands on the list of families; the question waits for Today.
await S.click('[data-encircle="0"]'); await S.waitForTimeout(1500);
ok('signed in, Today shows "Rahul cannot get in. Let them back in?"', await S.isVisible('#pinresets [data-resetok]') && /Rahul cannot get in\. Let them back in\?/.test(await S.textContent('#pinresets')), await S.textContent('#pinresets'));
ok('with "Let them in" and "Not now", 44px or more', await S.$$eval('#pinresets button', bs => bs.length === 2 && bs.every(b => b.getBoundingClientRect().height >= 44)));
await S.click('#bell'); await S.waitForTimeout(300);
ok('the same question is in Notifications', /Rahul cannot get in/.test(await S.textContent('#npinresets')));
await shotAll(S, 'pinreset-notifs');
await S.click('#npinresets [data-resetok]'); await S.waitForTimeout(200);
ok('"Let them in" asks once more, in the app\'s own sheet', await S.isVisible('#asksheet') && /Let Rahul back in\?/.test(await S.textContent('#as-q')));
await S.click('#as-yes'); await S.waitForTimeout(900);
let rr = (await admin.query(`select status from pin_resets r join users u on u.id = r.user_id where u.name = 'Rahul' order by r.created_at desc limit 1`)).rows[0];
ok('the server records the yes', rr && rr.status === 'approved', JSON.stringify(rr));
ok('the card goes from both places', !(await S.$('#pinresets [data-resetok]')) && !(await S.$('#npinresets [data-resetok]')));

// "Not now" says no without a second question.
await call('auth', { action: 'reset_request', phone: U.Papa.phone.slice(3), cc: '+91' });
await S.goto(BASE + '/#home'); await S.reload(); await S.waitForTimeout(1500);
// The refresh reply carries the requests too, when the server sends them;
// a fresh sign-in always does.
if (!(await S.$('#pinresets [data-resetno]'))) {
  await S.evaluate(() => { localStorage.removeItem('parwah'); localStorage.removeItem('parwah-user'); localStorage.removeItem('parwah-token'); });
  await S.reload(); await S.waitForTimeout(700);
  await S.fill('#au-phone', U.Anchit.phone.slice(3)); await S.click('#au-go'); await S.waitForTimeout(900);
  await S.fill('#au-pin', '4819'); await S.click('#au-go'); await S.waitForTimeout(1200);
  await S.click('[data-encircle="0"]'); await S.waitForTimeout(1500);
}
ok('Papa\'s request shows', /Papa cannot get in/.test(await S.textContent('#pinresets')));
await shotAll(S, 'pinreset-today');
await S.click('#pinresets [data-resetno]'); await S.waitForTimeout(900);
rr = (await admin.query(`select status from pin_resets r join users u on u.id = r.user_id where u.name = 'Papa' order by r.created_at desc limit 1`)).rows[0];
ok('"Not now" is a no, recorded by the server', rr && rr.status === 'denied', JSON.stringify(rr));
await ctxS.close();

// ---- THE WHOLE WAY BACK IN, from the phone that forgot: ask, wait, the
// family says yes on another phone, choose a new PIN, signed in. The old PIN
// stops working. A reload while waiting comes back to the waiting screen.
const ctxF = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const F = await ctxF.newPage(); F.on('pageerror', e => errors.push('F: ' + e.message));
await F.goto(BASE + '/'); await F.waitForTimeout(700);
await F.fill('#au-phone', U.Papa.phone.slice(3)); await F.click('#au-go'); await F.waitForTimeout(900);
await F.fill('#au-pin', '1111'); await F.click('#au-go'); await F.waitForTimeout(900);
ok('a wrong PIN offers "Forgotten your PIN?"', await F.isVisible('#au-forgot'));
await F.click('#au-forgot'); await F.waitForTimeout(200);
ok('it asks in the app\'s sheet, not the browser\'s confirm()', await F.isVisible('#asksheet'));
await F.click('#as-yes'); await F.waitForTimeout(900);
ok('the phone waits: "Asked. Waiting for someone in your family to say yes"', await F.isVisible('#au-reset') && /^Asked\. Waiting for someone in your family/.test(await F.textContent('#au-rs-msg')) && await F.isHidden('#au-go'), await F.textContent('#au-rs-msg'));
const kept1 = await F.evaluate(() => ({ s: sessionStorage.getItem('parwah-reset'), l: Object.keys(localStorage).map(k => localStorage.getItem(k)).join('|') }));
const secret1 = kept1.s && JSON.parse(kept1.s).secret;
ok('the secret is kept for this tab only, never in localStorage', !!secret1 && kept1.l.indexOf(secret1) < 0);
await shotAll(F, 'reset-waiting');
await F.reload(); await F.waitForTimeout(1200);
ok('a reload comes back to the waiting screen', await F.isVisible('#au-reset') && /Waiting for someone/.test(await F.textContent('#au-rs-msg')));
await F.click('#au-rs-check'); await F.waitForTimeout(600);
ok('"Check now" before anyone answers says not yet, and keeps waiting', await F.isVisible('#au-reset') && /Not yet/.test(await F.textContent('#toast')));
// Anchit, already signed in on his own phone, sees the question appear.
const A2 = await phone(as('Anchit'), { hash: '#home' });
await A2.waitForTimeout(800);
ok('on another phone, the family sees "Papa cannot get in" (from the background refresh)', /Papa cannot get in/.test(await A2.textContent('#pinresets')), await A2.textContent('#pinresets'));
await A2.click('#pinresets [data-resetok]'); await A2.click('#as-yes'); await A2.waitForTimeout(900);
await F.click('#au-rs-check'); await F.waitForTimeout(900);
ok('the yes reaches the phone that asked: choose a new PIN', await F.isVisible('#au-pin') && await F.isVisible('#au-pin2') && /family said yes/.test(await F.textContent('#au-pinnote')) && /Save my new PIN/.test(await F.textContent('#au-go')));
await shotAll(F, 'reset-newpin');
await F.fill('#au-pin', '1234'); await F.fill('#au-pin2', '1234'); await F.click('#au-go'); await F.waitForTimeout(900);
ok('a PIN the server will not take says why, and the yes is kept', (await F.textContent('#ob-err')).length > 5 && await F.isVisible('#au-pin') && !!(await F.evaluate(() => sessionStorage.getItem('parwah-reset'))), await F.textContent('#ob-err'));
await F.fill('#au-pin', '5927'); await F.fill('#au-pin2', '5927'); await F.click('#au-go'); await F.waitForTimeout(1500);
ok('a good PIN signs Papa in', await F.isVisible('#circle-step') && !!(await F.evaluate(() => localStorage.getItem('parwah-token'))));
ok('and the secret is gone from the phone', !(await F.evaluate(() => sessionStorage.getItem('parwah-reset'))));
let pe = await call('auth', { action: 'enter', phone: U.Papa.phone.slice(3), cc: '+91', pin: '4819' });
ok('the old PIN no longer works', !pe.ok && pe.wrongPin, JSON.stringify(pe));
pe = await call('auth', { action: 'enter', phone: U.Papa.phone.slice(3), cc: '+91', pin: '5927' });
ok('the new one does', pe.ok && !!pe.token, JSON.stringify(pe).slice(0, 120));
const reuse = await call('auth', { action: 'enter', phone: U.Papa.phone.slice(3), cc: '+91', resetSecret: secret1, newPin: '6283' });
ok('the same secret cannot be used twice', !reuse.token, JSON.stringify(reuse));
U.Papa.token = pe.token;
await ctxF.close();

// ---- the family says no: the phone that asked is told, and can ask again.
const ctxG = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const G = await ctxG.newPage(); G.on('pageerror', e => errors.push('G: ' + e.message));
await G.goto(BASE + '/'); await G.waitForTimeout(700);
await G.fill('#au-phone', U.Rahul.phone.slice(3)); await G.click('#au-go'); await G.waitForTimeout(900);
await G.fill('#au-pin', '1111'); await G.click('#au-go'); await G.waitForTimeout(900);
await G.click('#au-forgot'); await G.click('#as-yes'); await G.waitForTimeout(900);
await A2.reload(); await A2.waitForTimeout(1500);
ok('the family sees Rahul\'s request', /Rahul cannot get in/.test(await A2.textContent('#pinresets')));
await A2.click('#pinresets [data-resetno]'); await A2.waitForTimeout(900);
await G.click('#au-rs-check'); await G.waitForTimeout(900);
ok('"Your family said no", with Ask again', /said no/.test(await G.textContent('#au-rs-msg')) && await G.isVisible('#au-rs-again') && await G.isHidden('#au-rs-check'));
ok('and the refused secret is cleared', !(await G.evaluate(() => sessionStorage.getItem('parwah-reset'))));
await shotAll(G, 'reset-denied');
// Asking again, when the server refuses, shows the error and not "Asked".
await G.route('**/api/auth', r => r.request().postDataJSON().action === 'reset_request'
  ? r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'A request is already waiting. Ask your family to open Parwah and approve it.' }) })
  : r.continue());
await G.click('#au-rs-again'); await G.waitForTimeout(600);
ok('a request that fails shows the error, and does not say Asked', /already waiting/.test(await G.textContent('#ob-err')) && !/^Asked/.test(await G.textContent('#au-rs-msg')));
await ctxG.close();

// =====================================================================
// 3. THE OFFLINE EMERGENCY CARD survives a load where the family list fails
// =====================================================================
const ctxE = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const E = await phone(as('Anchit'), { ctx: ctxE });
await E.waitForTimeout(800);
const saved = await E.evaluate(() => JSON.parse(localStorage.getItem('parwah-ecard') || 'null'));
ok('online, the card is saved with the family and the book', saved && saved.members.length === 3 && saved.entries.length >= 2, saved && saved.members.length + '/' + saved.entries.length);
await E.route('**/api/events*', r => r.abort());
await E.reload(); await E.waitForTimeout(1800);
const kept = await E.evaluate(() => JSON.parse(localStorage.getItem('parwah-ecard') || 'null'));
ok('a reload where the family list fails does not write an empty card over it', kept && kept.members.length === 3 && kept.entries.length >= 2, kept && kept.members.length + '/' + kept.entries.length);
await ctxE.setOffline(true);
await E.click('#btn-ecard'); await E.waitForTimeout(400);
ok('offline, the card still opens from the saved copy, with Papa\'s blood group', await E.isVisible('#ecard') && /B\+/.test(await E.textContent('#ecard')), await E.textContent('#ec-name'));
await ctxE.setOffline(false);
await ctxE.close();

// =====================================================================
// 11. "WHEN I'M NOT HERE": saved with the server's own action and fields
// =====================================================================
const L = await phone(as('Anchit'), { hash: '#vault' });
await L.click('#vault-seg [data-sec="locator"]'); await L.waitForTimeout(800);
ok('the policies are the server\'s: anyone in the family, or only during an SOS', JSON.stringify(await L.$$eval('#loc-policy option', os => os.map(o => o.value))) === '["IMMEDIATE","EMERGENCY_ONLY"]');
await L.fill('#loc-item', 'SBI locker, Hazratganj'); await L.selectOption('#loc-cat', 'LOCKER_KEY');
await L.selectOption('#loc-about', U.Papa.memberId);
await L.fill('#loc-mask', 'Locker 42'); await L.fill('#loc-notes', 'Key in the steel almirah, brown folder');
await L.selectOption('#loc-policy', 'IMMEDIATE');
await L.click('#btn-add-locator'); await L.waitForTimeout(1000);
await L.fill('#loc-item', 'Will'); await L.selectOption('#loc-cat', 'WILL');
await L.fill('#loc-notes', 'With Mr Kapoor, the lawyer'); await L.selectOption('#loc-policy', 'EMERGENCY_ONLY');
await L.click('#btn-add-locator'); await L.waitForTimeout(1000);
const locs = (await admin.query(`select institution_or_item, unlock_policy, person_id, identifier_mask from legacy_asset_locators order by created_at`)).rows;
ok('both are saved with their policies, for Papa', locs.length === 2 && locs[0].unlock_policy === 'IMMEDIATE' && locs[1].unlock_policy === 'EMERGENCY_ONLY' && locs[0].person_id === U.Papa.memberId && locs[0].identifier_mask === 'Locker 42', JSON.stringify(locs));
const feed = await L.textContent('#locator-feed');
ok('the family-wide one shows where it is kept', /steel almirah/.test(feed));
ok('whoever wrote the SOS-only one can still read it, labelled with its rule', /Mr Kapoor/.test(feed) && /Only during an SOS/.test(feed));
// Rahul did not write it and it is not about him: the server hides it.
const LR = await phone(as('Rahul'), { hash: '#vault' });
await LR.click('#vault-seg [data-sec="locator"]'); await LR.waitForTimeout(900);
const feedR = await LR.textContent('#locator-feed');
ok('to the rest of the family, the SOS-only one says so instead of showing the notes', /steel almirah/.test(feedR) && !/Mr Kapoor/.test(feedR) && /Shown to the family only during an SOS/.test(feedR), feedR);
ok('and there is no Unlock button: the server decides', !(await L.$('[data-unlockloc]')) && !/Unlock/.test(feed));
await shotAll(L, 'locator');

// =====================================================================
// 13. LAB NUMBERS: real ones only, read with the member, saved by the server
// =====================================================================
const B = await phone(as('Anchit'), { hash: '#people' });
await B.waitForTimeout(500);
await B.click('[data-person="' + U.Papa.memberId + '"]'); await B.waitForTimeout(1000);
ok('no invented numbers wait for confirmation on Papa\'s page', await B.isHidden('#biomarker-confirm-banner') && !/Lal PathLabs|6\.8/.test(await B.textContent('#pane-person')));
await B.click('#btn-add-biomarker'); await B.waitForTimeout(200);
await B.selectOption('#bm-new-type', 'HBA1C');
await B.$eval('#bm-new-unit', s => { if (s.querySelector('option[value="conv"]')) s.value = 'conv'; });
await B.fill('#bm-new-val', '6.1'); await B.fill('#bm-new-lab', 'City Lab');
await B.click('#btn-save-biomarker'); await B.waitForTimeout(1200);
let bm = (await admin.query(`select biomarker_type, value::float as v, person_id, lab_name from biomarker_records order by created_at`)).rows;
ok('a typed number is saved for Papa through biomarker_save', bm.length === 1 && bm[0].biomarker_type === 'HBA1C' && Math.abs(bm[0].v - 6.1) < 0.01 && bm[0].person_id === U.Papa.memberId && bm[0].lab_name === 'City Lab', JSON.stringify(bm));
ok('and read back (the read now names the member, so it is not refused)', /HbA1c/.test(await B.textContent('#biomarker-history-list')) && /6\.1/.test(await B.textContent('#biomarker-history-list')));
await B.click('#btn-add-biomarker'); await B.waitForTimeout(200);
await B.fill('#bm-paste', 'Serum Creatinine: 0.9 mg/dL'); await B.click('#btn-parse-biomarker'); await B.waitForTimeout(800);
ok('pasted lines are read by the server and shown to check first', await B.isVisible('#biomarker-confirm-banner') && /Creatinine 0\.9/.test(await B.textContent('#biomarker-confirm-text')));
await B.click('#btn-confirm-extracted'); await B.waitForTimeout(1200);
bm = (await admin.query(`select biomarker_type from biomarker_records order by created_at`)).rows;
ok('and saved only after Save', bm.length === 2 && bm[1].biomarker_type === 'CREATININE', JSON.stringify(bm));
// The server refusing must not be reported as saved.
await B.route('**/api/book?area=biomarkers', r => r.request().method() === 'POST'
  ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Person and at least one biomarker required' }) })
  : r.continue());
await B.fill('#bm-new-val', '5.5'); await B.click('#btn-save-biomarker'); await B.waitForTimeout(500);
ok('a refused save shows the server\'s reason, not "saved"', /at least one biomarker/.test(await B.textContent('#toast')));
await B.unroute('**/api/book?area=biomarkers');

// 12. Who can see this: wired, in sentences, with the trail
await B.click('#pp-audit'); await B.waitForTimeout(1000);
ok('"Who can see this?" opens', await B.isVisible('#audit-drawer'));
const aud = await B.textContent('#audit-drawer');
ok('it says what is shared with the family, not "Access active" for everyone', /seen by everyone in the family/.test(aud) && !/Access active/.test(aud));
ok('and who looked, as a sentence', /You looked at the lab numbers/.test(await B.textContent('#aud-logs')), await B.textContent('#aud-logs'));
await shotAll(B, 'audit');
await B.click('#aud-x');

// =====================================================================
// 14. MEDICINE STOCK: recorded, warned about, refilled, snoozed
// =====================================================================
const R = await phone(as('Anchit'), { hash: '#care' });
await R.click('#refill-more summary'); await R.waitForTimeout(200);
await R.selectOption('#rf-who', U.Papa.memberId);
await R.fill('#rf-name', 'Amlopres 5'); await R.fill('#rf-left', '3'); await R.fill('#rf-rate', '1');
await R.click('#rf-add'); await R.waitForTimeout(1200);
let inv = (await admin.query(`select id, medicine_name, units_remaining::float as u, member_id from medicine_inventory`)).rows;
ok('stock is recorded with refill_add', inv.length === 1 && inv[0].u === 3 && inv[0].member_id === U.Papa.memberId, JSON.stringify(inv));
ok('3 tablets at 1 a day: the warning shows, from the server\'s days_left', await R.isVisible('#refill-alerts') && /Papa has 3 days of Amlopres 5 left/.test(await R.textContent('#refill-alert-text')), await R.textContent('#refill-alert-text'));
await shotAll(R, 'refill');
await R.click('#btn-refill-done'); await R.waitForTimeout(1200);
inv = (await admin.query(`select units_remaining::float as u from medicine_inventory`)).rows;
ok('"Bought 30 more" is refill_mark: 33 left, and the warning goes', inv[0].u === 33 && await R.isHidden('#refill-alerts'), JSON.stringify(inv));
await R.fill('#rf-name', 'Ecosprin'); await R.fill('#rf-left', '1'); await R.fill('#rf-rate', '1');
await R.click('#rf-add'); await R.waitForTimeout(1200);
await R.click('#btn-refill-snooze'); await R.waitForTimeout(1000);
const sn = (await admin.query(`select snoozed_until from medicine_inventory where medicine_name = 'Ecosprin'`)).rows[0];
ok('"Remind me in 2 days" is refill_snooze', sn && sn.snoozed_until && new Date(sn.snoozed_until) > new Date(Date.now() + 86400000));
// The filters used to throw (renderReminders did not exist).
const before = errors.length;
await R.click('#task-filter-seg [data-tfilter="me"]'); await R.click('#task-filter-seg [data-tfilter="all"]'); await R.waitForTimeout(200);
ok('the To do filters work without an error', errors.length === before, errors.slice(before).join(' | '));

// A voice note becomes a to-do with its own words, through task_create.
const V = await phone(as('Anchit'), { hash: '#ekta' });
await V.fill('#msg', 'Kal Papa ko doctor appointment ke liye le jaana hai'); await V.click('#send'); await V.waitForTimeout(1500);
ok('Ekta offers to add it to the to-do list, in its own words', await V.isVisible('[data-vconfirm]') && /Add this to the family to-do list\?/.test(await V.textContent('#emsgs')));
await V.click('[data-vconfirm]'); await V.waitForTimeout(1200);
const tk = (await admin.query(`select title from requests order by created_at desc limit 1`)).rows[0];
ok('confirming creates the task with task_create, titled with what was said', tk && /doctor appointment/.test(tk.title) && !/I understood|\?$/.test(tk.title), JSON.stringify(tk));
ok('and says so only after the server agreed', /Added to the family to-do list/.test(await V.textContent('#emsgs')));

if (SHOTS) {
  // The other changed screens, for a person to look at.
  if (await B.isHidden('#bm-paste')) await B.click('#btn-add-biomarker');
  await B.fill('#bm-paste', 'HbA1c: 6.0 %'); await B.click('#btn-parse-biomarker'); await B.waitForTimeout(800);
  await B.$eval('#biomarker-confirm-banner', el => el.scrollIntoView({ block: 'center' }));
  await shotAll(B, 'labs-confirm');
  const T = await phone(as('Papa'), { hash: '#home' });
  await T.evaluate(() => localStorage.removeItem('parwah-fr-hide')); await T.reload(); await T.waitForTimeout(1500);
  await shotAll(T, 'today-firstrun');
  await T.evaluate(() => localStorage.setItem('parwah-fr-hide', '1')); await T.reload(); await T.waitForTimeout(1500);
  await T.$eval('#readycard', el => el.scrollIntoView({ block: 'center' }));
  await shotAll(T, 'today-ready');
  await T.click('#more summary'); await T.click('#callnow'); await T.waitForTimeout(300);
  await shotAll(T, 'call-confirm');
  await T.click('#as-no');
  await T.goto(BASE + '/#people'); await T.waitForTimeout(1200);
  await shotAll(T, 'family');
  const D = await (await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' })).newPage();
  await D.goto(BASE + '/?demo=1'); await D.waitForTimeout(600);
  await shotAll(D, 'demo-1');
  for (let i = 0; i < 5; i++) { await D.click('#dm-next'); await D.waitForTimeout(150); }
  await shotAll(D, 'demo-6');
  await D.goto(BASE + '/'); await D.waitForTimeout(600);
  await shotAll(D, 'signin');
}

ok('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close(); server.close(); await admin.end();
process.exit(fails.length ? 1 : 0);
