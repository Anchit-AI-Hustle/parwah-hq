// THE VAULT, THE EMERGENCY CARD AND A PERSON'S PAGE, END TO END: a real
// browser, the real API and a real PostgreSQL.
//
// The journey is the one a family described: a car claim needs a brother's
// PAN and licence. From his profile, his sister opens his documents, asks
// for what she cannot open, he says yes with one tap, and she downloads it,
// named, while he is told. Around it: the emergency card on a 320px phone,
// and a parent's page that leads with what is missing.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('vault.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('vault.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('vault.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

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
  const phone = '+9198600' + String(++n).padStart(5, '0');
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


async function phone(who, { scheme = 'light', width = 390, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', colorScheme: scheme });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    if (w.memberId) localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: 'family', circleName: w.circleName }));
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  await page.waitForTimeout(1300);
  return page;
}


// ---- the family: Anchit, his brother Rahul, Papa (senior mode)
const call = async (name, body, query = {}, method = 'POST', token) => {
  let out, st = 200; const res = { status(s) { st = s; return this; }, json(j) { out = j; return this; }, setHeader() {} };
  await HANDLERS[name]({ method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.4.0.' + (++n) }, query, body }, res);
  return { ...out, http: st };
};
const U = { Anchit: await user('Anchit') };
const made = await call('circle', { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Anchit', circleName: 'Tandon Family', userId: U.Anchit.userId, relation: 'son' }, {}, 'POST', U.Anchit.token);
const code = made.code;
await admin.query(`update circles set join_policy = 'open' where code = $1`, [code]);
U.Anchit.memberId = made.memberId;
for (const [name, rel, role] of [['Rahul', 'son'], ['Papa', 'father', 'parent']]) {
  U[name] = await user(name);
  const j = await call('circle', { action: 'join', code, memberName: name, userId: U[name].userId, relation: rel, role }, {}, 'POST', U[name].token);
  U[name].memberId = j.memberId;
}
await admin.query(`update members set role = 'parent', place = 'Lucknow' where id = $1`, [U.Papa.memberId]);
const as = (name) => ({ ...U[name], code, circleName: 'Tandon Family' });
const book = (name, body) => call('book', { code, memberId: U[name].memberId, ...body }, {}, 'POST', U[name].token);
// Papa's health, as the family keeps it
await book('Anchit', { action: 'add', kind: 'fact', category: 'blood', name: 'Blood group', forwhat: 'B+', aboutId: U.Papa.memberId });
await book('Anchit', { action: 'add', kind: 'fact', category: 'allergy', name: 'Allergy', forwhat: 'Penicillin', aboutId: U.Papa.memberId });
await book('Anchit', { action: 'add', kind: 'med', name: 'Amlopres 5', forwhat: 'BP', aboutId: U.Papa.memberId });
await book('Anchit', { action: 'add', kind: 'contact', category: 'emergency', name: 'Rahul', phone: '9876543210', aboutId: U.Papa.memberId });
await book('Anchit', { action: 'add', kind: 'contact', category: 'local', name: 'Sharma ji next door', phone: '9876500000', aboutId: U.Papa.memberId });
await book('Anchit', { action: 'add', kind: 'address', name: "Papa's house", address: '12 Hazratganj, Lucknow 226001', aboutId: U.Papa.memberId });
// Rahul's papers
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const vadd = async (who, b) => (await call('book', { area: 'vault', action: 'add', code, memberId: U[who].memberId, file: png, fileMime: 'image/png', fileName: 'scan.png', ...b }, { area: 'vault' }, 'POST', U[who].token)).id;
const panId = await vadd('Rahul', { kind: 'pan', label: "Rahul's PAN", aboutId: U.Rahul.memberId, number: 'ABCDE1234F' });
const dlId = await vadd('Rahul', { kind: 'dl', label: "Rahul's licence", aboutId: U.Rahul.memberId });
await call('book', { area: 'vault', action: 'grant', code, memberId: U.Rahul.memberId, id: dlId, targetId: U.Anchit.memberId, level: 'view' }, { area: 'vault' }, 'POST', U.Rahul.token);

// ---- the emergency card fits a small phone: the name, the close button and
// the vital facts are on screen, and the rest scrolls
const S = await phone(as('Anchit'), { width: 320 });
await S.setViewportSize({ width: 320, height: 568 });
await S.click('#btn-ecard'); await S.waitForTimeout(400);
const box = async (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
let x = await box(S, '#ec-x'), v = await box(S, '.ec-vital');
ok('on a 320x568 phone the card opens with Close on screen', x.top >= 0 && x.bottom <= x.h, JSON.stringify(x));
ok('Papa\'s card, with the vital facts and who to ring near the top', /Papa/.test(await S.textContent('#ec-name')) && v.top >= 0 && v.top < 568, JSON.stringify(v));
ok('blood group is large: 24px or more', await S.$eval('.ec-vital b', b => parseFloat(getComputedStyle(b).fontSize)) >= 24 && /B\+/.test(await S.textContent('.ec-vital')));
ok('allergies are in the same first glance', /Penicillin/.test(await S.textContent('.ec-vital')));
ok('one tap calls the first emergency contact, and the ambulance', await S.$eval('.ec-call', c => !!c.querySelector('a[href^="tel:"]') && !!c.querySelector('a.amb[href="tel:112"]')));
const ecText = await S.textContent('#ec-body');
ok('the home address and the neighbour are on it', /12 Hazratganj/.test(ecText) && /Sharma ji next door/.test(ecText) && /near them/.test(ecText));
await S.$eval('#ecard', el => { el.scrollTop = el.scrollHeight; });
x = await box(S, '#ec-share');
ok('and the rest scrolls into view: Send to someone is reachable', x.bottom <= x.h && x.top >= 0, JSON.stringify(x));
if (process.env.VAULT_SHOT_DIR) { await S.screenshot({ path: process.env.VAULT_SHOT_DIR + '/ecard-320-light.png' }); await S.emulateMedia({ colorScheme: 'dark' }); await S.screenshot({ path: process.env.VAULT_SHOT_DIR + '/ecard-320-dark.png' }); await S.emulateMedia({ colorScheme: 'light' }); }
ok('another person\'s card is one tap away', /Me/.test(await S.textContent('#ec-who')));
await S.$eval('#ecard', el => { el.scrollTop = 0; });
await S.click('#ec-who [data-ecwho="' + U.Anchit.memberId + '"]'); await S.waitForTimeout(200);
ok('switching shows my own card', /Anchit/.test(await S.textContent('#ec-name')));
await S.click('#ec-x');

// ---- People > Rahul > his documents > ask for his PAN
const P = await phone(as('Anchit'), { hash: '#people' });
await P.click('#members [data-mprof="' + U.Rahul.memberId + '"]'); await P.waitForTimeout(300);
ok('Rahul\'s profile leads to his documents and his page', await P.isVisible('#mp-docs') && await P.isVisible('#mp-page'));
ok('and nobody is labelled admin', !/admin/i.test(await P.textContent('#mp-role')));
await P.click('#mp-gift'); await P.waitForTimeout(200);
await P.setViewportSize({ width: 320, height: 640 });
await P.$eval('#msheet', el => { el.scrollTop = 0; });
x = await box(P, '#mp-x');
ok('with the gift options open on a small phone, Close is still reachable', x.top >= 0, JSON.stringify(x));
await P.setViewportSize({ width: 390, height: 844 });
await P.click('#mp-docs'); await P.waitForTimeout(1200);
ok('his documents open in the vault, on him', await P.isVisible('#pane-vault') && await P.$eval('#vd-who', s => s.value) === U.Rahul.memberId);
ok('the licence he let me know about says I can ask', /Rahul's licence[\s\S]*ask to open it/.test(await P.textContent('#vdlist')), await P.textContent('#vdlist'));
ok('and I am offered his papers to ask for, by kind', await P.isVisible('#vd-ask') && /PAN card/.test(await P.textContent('#vd-ask-chips')));
if (process.env.VAULT_SHOT_DIR) { await P.screenshot({ path: process.env.VAULT_SHOT_DIR + '/vault-ask-390-light.png' }); await P.emulateMedia({ colorScheme: 'dark' }); await P.screenshot({ path: process.env.VAULT_SHOT_DIR + '/vault-ask-390-dark.png' }); await P.emulateMedia({ colorScheme: 'light' }); }
await P.click('#vd-ask-chips [data-vaskk="pan"]'); await P.waitForTimeout(1200);
ok('asking marks it asked', /PAN card · asked/.test(await P.textContent('#vd-ask-chips')));
// the licence: ask for that exact paper
await P.click('#vdlist [data-vopen="' + dlId + '"]'); await P.waitForTimeout(300);
ok('a paper I only know about says who decides, and offers to ask', /Rahul decides who can open this/.test(await P.textContent('#vdd-ask-note')) && await P.isVisible('#vdd-ask') && !(await P.isVisible('#vdd-open')));
await P.click('#vdd-ask'); await P.waitForTimeout(1200);
ok('and then that I asked', /Asked - waiting for Rahul/.test(await P.textContent('#vdd-ask')));

// ---- Rahul says yes with one tap
const R = await phone(as('Rahul'), { hash: '#vault' });
await R.waitForTimeout(800);
ok('Rahul sees what he was asked', await R.isVisible('#vd-requests') && /Anchit asks to open your PAN card/.test(await R.textContent('#vd-req-list')) && /Anchit asks to open Rahul's licence/.test(await R.textContent('#vd-req-list')), await R.textContent('#vd-req-list'));
if (process.env.VAULT_SHOT_DIR) { await R.locator('#vd-requests').screenshot({ path: process.env.VAULT_SHOT_DIR + '/vault-requests-390-light.png' }); await R.emulateMedia({ colorScheme: 'dark' }); await R.locator('#vd-requests').screenshot({ path: process.env.VAULT_SHOT_DIR + '/vault-requests-390-dark.png' }); await R.emulateMedia({ colorScheme: 'light' }); }
await R.click('#vd-req-list [data-vdoc="' + panId + '"]'); await R.waitForTimeout(1300);
await R.click('#vd-req-list [data-vno]'); await R.waitForTimeout(1300);
ok('one yes, one not now, and nothing left to answer', !(await R.isVisible('#vd-requests')));

// ---- Anchit downloads the PAN, with a name
await P.reload(); await P.waitForTimeout(1500);
await P.evaluate(() => { location.hash = '#vault'; }); await P.waitForTimeout(1200);
ok('the PAN now says I can download it', /Rahul's PAN[\s\S]*you can download it/.test(await P.textContent('#vdlist')), await P.textContent('#vdlist'));
await P.click('#vdlist [data-vopen="' + panId + '"]'); await P.waitForTimeout(300);
ok('it says Rahul is told each time', /Rahul is told each time it is opened/.test(await P.textContent('#vdd-ask-note')));
ok('the number reads as its last four', /Ending 234F/.test(await P.textContent('#vdd-num')));
ok('I cannot edit or remove his paper', !(await P.isVisible('#vdd-edit')) && !(await P.isVisible('#vdd-remove')));
const [dlEv] = await Promise.all([P.waitForEvent('download', { timeout: 8000 }), P.click('#vdd-open')]);
ok('Download saves a real file named for whose paper it is', dlEv.suggestedFilename() === "Rahul - Rahul's PAN.png", dlEv.suggestedFilename());

// ---- Papa's page: what is missing first, and each gap a tap from fixed
await P.evaluate(() => { location.hash = '#people'; }); await P.waitForTimeout(1200);
ok('no preparedness chip says undefined', !/undefined/.test(await P.textContent('#pane-people')));
await P.click('#members [data-mprof="' + U.Papa.memberId + '"]'); await P.waitForTimeout(300);
await P.click('#mp-page'); await P.waitForTimeout(500);
ok('Papa\'s page opens on the emergency card and what to complete', await P.isVisible('#pp-ecard') && await P.isVisible('#pp-todo-card') && /Doctor/.test(await P.textContent('#pp-todo')) && /Insurance/.test(await P.textContent('#pp-todo')), await P.textContent('#pp-todo'));
ok('the hero subtitle is readable in light mode', await P.$eval('#pp-sub', el => getComputedStyle(el).color) !== 'rgb(94, 75, 94)');
ok('Back says where it goes', /Family/.test(await P.textContent('#pp-back')));
if (process.env.VAULT_SHOT_DIR) { await P.screenshot({ path: process.env.VAULT_SHOT_DIR + '/person-papa-390-light.png' }); await P.emulateMedia({ colorScheme: 'dark' }); await P.screenshot({ path: process.env.VAULT_SHOT_DIR + '/person-papa-390-dark.png' }); await P.emulateMedia({ colorScheme: 'light' }); }
await P.click('#pp-todo [data-pptodo="doctor"]');
await P.waitForFunction((pid) => document.getElementById('b-cat').value === 'doctor' && document.getElementById('b-about').value === pid, U.Papa.memberId, { timeout: 5000 }).catch(() => {});
ok('a gap opens the form already set to fill it: a doctor, for Papa', await P.isVisible('#pane-memory') && await P.$eval('#b-cat', s => s.value) === 'doctor' && await P.$eval('#b-about', s => s.value) === U.Papa.memberId);
ok('an emergency contact can be recorded', await P.$$eval('#b-cat option', os => os.some(o => o.value === 'emergency')));

// ---- a phone-camera photo (over 2 MB) goes into the vault: made smaller here
await P.evaluate(() => { location.hash = '#vault'; }); await P.waitForTimeout(800);
if (await P.isVisible('#vd-back')) { await P.click('#vd-back'); await P.waitForTimeout(200); }
ok('the add form offers a camera and a file', await P.isVisible('label[for="vd-cam"]') && await P.isVisible('label[for="vd-file"]'));
const big = await P.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 3000; c.height = 2200;
  const g = c.getContext('2d'), img = g.createImageData(3000, 2200);
  for (let i = 0; i < img.data.length; i++) img.data[i] = (Math.random() * 255) | 0;
  g.putImageData(img, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'IMG_2041.png', { type: 'image/png' }));
  const inp = document.getElementById('vd-cam'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
  return blob.size;
});
await P.waitForFunction(() => /ready to go into the vault|larger than 2 MB/.test(document.getElementById('vd-fname').textContent), null, { timeout: 15000 });
ok('a ' + Math.round(big / 1048576) + ' MB photo is made small enough to keep', big > 2 * 1048576 && /IMG_2041\.jpg - ready to go into the vault/.test(await P.textContent('#vd-fname')), await P.textContent('#vd-fname'));
await P.selectOption('#vd-kind', 'aadhaar'); await P.fill('#vd-label', 'My Aadhaar'); await P.selectOption('#vd-about', U.Anchit.memberId);
await P.click('#vd-save'); await P.waitForTimeout(1500);
const saved = (await admin.query(`select file_mime, file_size from vault_docs where label = 'My Aadhaar'`)).rows[0];
ok('and it is saved as a photo under 2 MB', saved && saved.file_mime === 'image/jpeg' && saved.file_size < 2 * 1048576, JSON.stringify(saved));

// ---- More options: dates and notes fold away, and never hide what matters
ok('after saving, dates and notes are folded under More options', !(await P.$eval('#vd-more', d => d.open)) && !(await P.isVisible('#vd-expires')));
await P.click('#vd-more summary');
await P.fill('#vd-label', 'My passport'); await P.selectOption('#vd-about', U.Anchit.memberId);
await P.fill('#vd-issued', '2020-05-01'); await P.fill('#vd-expires', '2019-01-01');
await P.click('#vd-more summary');
await P.click('#vd-save'); await P.waitForTimeout(400);
ok('a wrong date inside the fold opens it and says so, on the box', await P.$eval('#vd-more', d => d.open) && await P.isVisible('#vd-expires-err') && (await P.evaluate(() => document.activeElement.id)) === 'vd-expires');
await P.fill('#vd-expires', '2030-01-01');
await P.click('#vd-save'); await P.waitForTimeout(1500);
const pp = (await admin.query(`select id, expires_on from vault_docs where label = 'My passport'`)).rows[0];
ok('fixed, it is saved with its dates, and the fold closes', pp && !!pp.expires_on && !(await P.$eval('#vd-more', d => d.open)));
await P.click('#vdlist [data-vopen="' + pp.id + '"]'); await P.waitForTimeout(300);
await P.click('#vdd-edit'); await P.waitForTimeout(300);
ok('editing it opens More options, so its dates are in view', await P.$eval('#vd-more', d => d.open) && (await P.inputValue('#vd-expires')) === '2030-01-01');

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`vault.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`vault.e2e: ${pass}/${pass} checks pass`);
