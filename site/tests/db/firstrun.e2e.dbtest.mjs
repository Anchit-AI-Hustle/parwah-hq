// SIGNING IN, JOINING, A FIRST TODAY AND THE SHELL, END TO END: a real
// browser, the real API and a real PostgreSQL.
//
// From the page-by-page review: an invite link opened while signed in was
// lost; "Check again" let you into the wrong family; Back left the app; an
// elder's SOS was below the fold under an organiser's hero; big text was a
// role; Profile opened on pricing and API keys; the bell repeated the feed;
// the menu had three names for one place; the PIN screen named the person.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('firstrun.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('firstrun.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('firstrun.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

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
  await HANDLERS[name]({ method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.5.0.' + (++n) }, query, body }, res);
  return { ...out, http: st };
};
const U = { Anchit: await user('Anchit') };
const made = await call('circle', { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Anchit', circleName: 'Tandon Family', userId: U.Anchit.userId, relation: 'son' }, {}, 'POST', U.Anchit.token);
const code = made.code; U.Anchit.memberId = made.memberId;
await admin.query(`update circles set join_policy = 'open' where code = $1`, [code]);
U.Papa = await user('Papa');
U.Papa.memberId = (await call('circle', { action: 'join', code, memberName: 'Papa', userId: U.Papa.userId, relation: 'father', role: 'parent' }, {}, 'POST', U.Papa.token)).memberId;
await admin.query(`update members set role = 'parent' where id = $1`, [U.Papa.memberId]);
// A second family that asks before letting anyone in.
U.Meera = await user('Meera');
const other = await call('circle', { action: 'create', kind: 'family', familyType: 'nuclear', memberName: 'Meera', circleName: 'Verma Family', userId: U.Meera.userId, relation: 'mother' }, {}, 'POST', U.Meera.token);
await admin.query(`update circles set join_policy = 'approve' where code = $1`, [other.code]);
const as = (name, role = 'family') => ({ ...U[name], code, circleName: 'Tandon Family', role });

// ---- an invite opened while signed in: the join card, not the old family
const ctxJ = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await ctxJ.addInitScript(([w]) => {
  localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
  localStorage.setItem('parwah-token', w.token);
  localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: 'family', circleName: 'Tandon Family' }));
  localStorage.setItem('parwah-circles', JSON.stringify([{ code: w.code, circleName: 'Tandon Family', memberId: w.memberId, memberName: w.name, role: 'family' }]));
}, [{ ...U.Anchit, code }]);
const J = await ctxJ.newPage(); J.on('pageerror', e => errors.push('J: ' + e.message));
await J.goto(BASE + '/?join=' + other.code); await J.waitForTimeout(1300);
ok('signed in, an invite opens the join card with its code', await J.isVisible('#joincard') && await J.$eval('#j-code', i => i.value) === other.code && !(await J.isVisible('#main')));
ok('and the code leaves the address, so a reload does not ask again', !/join=/.test(J.url()));
await J.click('#j-go'); await J.waitForTimeout(1300);
ok('the family asks first: waiting', await J.isVisible('#pending-step'));
await J.click('#pend-check'); await J.waitForTimeout(1300);
ok('Check again does not pretend you got in because you are in another family', await J.isVisible('#pending-step') && !(await J.isVisible('#circle-step')));
await J.reload(); await J.waitForTimeout(1300);
ok('a reload while waiting comes back to the waiting screen, not the old family', await J.isVisible('#pending-step') && !(await J.isVisible('#main')));
const reqId = (await admin.query(`select id from join_requests where circle_id = (select id from circles where code = $1) and status = 'pending'`, [other.code])).rows[0]?.id;
if (reqId) await call('circle', { action: 'approve_join', code: other.code, memberId: other.memberId, requestId: reqId }, {}, 'POST', U.Meera.token);
await J.click('#pend-check'); await J.waitForTimeout(1600);
ok('once they say yes, Check again takes you in', reqId && await J.isVisible('#main') && /Verma Family/.test(await J.textContent('#m-title')), String(reqId));
ok('and only then is the invite used up', await J.evaluate(() => sessionStorage.getItem('parwah-join') === null && sessionStorage.getItem('parwah-join-wait') === null));

// ---- an invite to a family you are already in: you go there, and it is used
{
  const vm = (await admin.query(`select m.id from members m join circles c on c.id = m.circle_id where c.code = $1 and m.user_id = $2`, [other.code, U.Anchit.userId])).rows[0];
  const ctxK = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctxK.addInitScript(([w]) => {
    if (localStorage.getItem('parwah-user')) return;
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: 'family', circleName: 'Tandon Family' }));
    localStorage.setItem('parwah-circles', JSON.stringify([{ code: w.code, circleName: 'Tandon Family', memberId: w.memberId, memberName: w.name, role: 'family' },
                                                           { code: w.other, circleName: 'Verma Family', memberId: w.vm, memberName: w.name, role: 'family' }]));
  }, [{ ...U.Anchit, code, other: other.code, vm: vm && vm.id }]);
  const K = await ctxK.newPage(); K.on('pageerror', e => errors.push('K: ' + e.message));
  await K.goto(BASE + '/?join=' + other.code); await K.waitForTimeout(1300);
  ok('already in that family, the invite opens it', await K.isVisible('#main') && /Verma Family/.test(await K.textContent('#m-title')));
  ok('and the invite is used up', await K.evaluate(() => sessionStorage.getItem('parwah-join') === null));
  // Switching to the other family reloads: it must not be pulled back.
  await K.evaluate(([w]) => localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: 'family', circleName: 'Tandon Family' })), [{ ...U.Anchit, code }]);
  await K.reload(); await K.waitForTimeout(1300);
  ok('switching to another family afterwards stays there', await K.isVisible('#main') && /Tandon Family/.test(await K.textContent('#m-title')), await K.textContent('#m-title'));
  await ctxK.close();
}

// ---- a request the family turns down: the waiting screen does not come back
{
  const kap = await call('circle', { action: 'create', kind: 'family', familyType: 'nuclear', memberName: 'Meera', circleName: 'Kapoor Family', userId: U.Meera.userId, relation: 'mother' }, {}, 'POST', U.Meera.token);
  await admin.query(`update circles set join_policy = 'approve' where code = $1`, [kap.code]);
  const ctxD = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctxD.addInitScript(([w]) => {
    if (localStorage.getItem('parwah-user')) return;
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: 'family', circleName: 'Tandon Family' }));
    localStorage.setItem('parwah-circles', JSON.stringify([{ code: w.code, circleName: 'Tandon Family', memberId: w.memberId, memberName: w.name, role: 'family' }]));
  }, [{ ...U.Anchit, code }]);
  const D = await ctxD.newPage(); D.on('pageerror', e => errors.push('D: ' + e.message));
  await D.goto(BASE + '/?join=' + kap.code); await D.waitForTimeout(1300);
  await D.click('#j-go'); await D.waitForTimeout(1300);
  ok('asked to join a family that approves first: waiting', await D.isVisible('#pending-step'));
  // The family is told, in the bell, that someone is at the door.
  const M = await phone({ ...U.Meera, code: kap.code, memberId: kap.memberId, circleName: 'Kapoor Family' }, { hash: '#notifs' });
  await M.waitForTimeout(800);
  ok('the bell shows someone asking to join', /asked to join/.test(await M.textContent('#nlist')), await M.textContent('#nlist'));
  await M.context().close();
  const rq = (await admin.query(`select id from join_requests where circle_id = (select id from circles where code = $1) and status = 'pending'`, [kap.code])).rows[0];
  await call('circle', { action: 'decline_join', code: kap.code, memberId: kap.memberId, requestId: rq && rq.id }, {}, 'POST', U.Meera.token);
  await D.click('#pend-check'); await D.waitForTimeout(1500);
  ok('after a no, Check again says so instead of "not yet"', !(await D.isVisible('#pending-step')) && /did not take up your request/.test(await D.textContent('#ob-err')), await D.textContent('#ob-err'));
  ok('and the invite is put away', await D.evaluate(() => sessionStorage.getItem('parwah-join') === null && sessionStorage.getItem('parwah-join-wait') === null));
  await D.reload(); await D.waitForTimeout(1300);
  ok('a reload does not bring the waiting screen back', !(await D.isVisible('#pending-step')));
  await ctxD.close();
}

// ---- the family changes its invite code while someone waits: still found
{
  const fam = await call('circle', { action: 'create', kind: 'family', familyType: 'nuclear', memberName: 'Meera', circleName: 'Sood Family', userId: U.Meera.userId, relation: 'mother' }, {}, 'POST', U.Meera.token);
  await admin.query(`update circles set join_policy = 'approve' where code = $1`, [fam.code]);
  const ctxE = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctxE.addInitScript(([w]) => {
    if (localStorage.getItem('parwah-user')) return;
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: 'family', circleName: 'Tandon Family' }));
  }, [{ ...U.Anchit, code }]);
  const E = await ctxE.newPage(); E.on('pageerror', e => errors.push('E: ' + e.message));
  await E.goto(BASE + '/?join=' + fam.code); await E.waitForTimeout(1300);
  await E.click('#j-go'); await E.waitForTimeout(1300);
  await admin.query(`update circles set code = 'NEWC0D' where code = $1`, [fam.code]);
  const rq = (await admin.query(`select id from join_requests where circle_id = (select id from circles where code = 'NEWC0D') and status = 'pending'`)).rows[0];
  await call('circle', { action: 'approve_join', code: 'NEWC0D', memberId: fam.memberId, requestId: rq && rq.id }, {}, 'POST', U.Meera.token);
  await E.click('#pend-check'); await E.waitForTimeout(1600);
  ok('the code changed while waiting: once they say yes, Check again still takes you in', await E.isVisible('#main') && /Sood Family/.test(await E.textContent('#m-title')), await E.textContent('#m-title').catch(() => ''));
  await ctxE.close();
}

// ---- signed out: the invite is said, and the PIN screen never names anyone
const ctxO = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const O = await ctxO.newPage(); O.on('pageerror', e => errors.push('O: ' + e.message));
await O.goto(BASE + '/?join=' + code); await O.waitForTimeout(800);
ok('signed out, the entry says you have been invited, with the code', await O.isVisible('#ob-invite') && (await O.textContent('#ob-invite-sub')).includes(code));
await O.reload(); await O.waitForTimeout(800);
ok('a reload before joining keeps the invite', await O.isVisible('#ob-invite') && (await O.textContent('#ob-invite-sub')).includes(code));
ok('the pitch is the five things, and the hint is true', /papers, health, things to do and an emergency card/i.test(await O.textContent('#onboard > .lede')) && /your number and your PIN or password\. New here\? You will choose one next/.test(await O.textContent('#auth-step')));
await O.fill('#au-phone', U.Papa.phone.slice(3)); await O.click('#au-go'); await O.waitForTimeout(900);
ok('a known number is asked for its PIN without saying whose it is', await O.isVisible('#au-pinwrap') && !/Papa/.test(await O.textContent('#auth-step')), await O.textContent('#au-pinnote'));

// ---- onboarding steps: in-page Back and the phone's Back
const N = await phone({ ...U.Meera, memberId: null });
await N.waitForTimeout(500);
if (await N.isVisible('#circle-step')) {
  await N.click('#cs-new'); await N.waitForTimeout(300);
  ok('"Join with a code" opens the join card', await N.isVisible('#joincard') && !(await N.isVisible('#pickkind')));
  await N.click('#jc-back'); await N.waitForTimeout(300);
}
if (await N.isVisible('#circle-step')) { await N.click('#cs-newfam'); await N.waitForTimeout(300); }
else { await N.click('#pickkind [data-kind="family"]'); await N.waitForTimeout(300); }
ok('the create card has a Back', await N.isVisible('#createcard') && await N.isVisible('#c-back'));
await N.goBack(); await N.waitForTimeout(400);
ok('and the phone\'s Back steps back inside Parwah instead of leaving it', N.url().startsWith(BASE) && (await N.isVisible('#pickkind') || await N.isVisible('#circle-step')), N.url());
ok('the pitch is only on the sign-in screen', !(await N.isVisible('#onboard > h1')));

// ---- an elder's Today: SOS first and on screen; no coach marks stacked on top
const P = await phone(as('Papa', 'parent'), { width: 390 });
await P.waitForTimeout(800);
if (process.env.FR_SHOT_DIR) { await P.screenshot({ path: process.env.FR_SHOT_DIR + '/today-papa-390-light.png' }); await P.emulateMedia({ colorScheme: 'dark' }); await P.waitForTimeout(100); await P.screenshot({ path: process.env.FR_SHOT_DIR + '/today-papa-390-dark.png' }); await P.emulateMedia({ colorScheme: 'light' }); }
const sos = await P.$eval('#btn-sos', b => b.getBoundingClientRect());
ok('for Papa, SOS is on screen without scrolling', await P.isVisible('#btn-sos') && sos.height > 40 && sos.top >= 0 && sos.bottom <= 844, JSON.stringify(sos));
ok('his buttons come before the family name', await P.evaluate(() => document.getElementById('seniorui').getBoundingClientRect().top < document.querySelector('.homehero').getBoundingClientRect().top));
ok('big text is on for him', await P.evaluate(() => document.body.classList.contains('senior') && parseFloat(getComputedStyle(document.documentElement).fontSize) > 16));
ok('no coach marks on top of it', !(await P.isVisible('#coach')));
await P.click('#btn-pill'); await P.waitForTimeout(900);
const pillTxt = await P.textContent('#btn-pill');
ok('medicines taken says when, in an adult\'s words', /Medicines taken ✔ · \d/.test(pillTxt) && !/Well done/.test(pillTxt), pillTxt);
await P.reload(); await P.waitForTimeout(1200);
ok('and stays pressed today after a reload', /Medicines taken ✔ · \d/.test(await P.textContent('#btn-pill')));
ok('no coins for taking medicines', (await admin.query(`select count(*)::int as n from coins where reason = 'pill'`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n === 0);
await P.click('#btn-sos'); await P.waitForTimeout(200);
ok('SOS asks in Parwah\'s own sheet, with big answers', await P.isVisible('#asksheet') && /Yes, send SOS/.test(await P.textContent('#as-yes')));
await P.click('#as-no'); await P.waitForTimeout(200);
ok('and No sends nothing', !(await P.isVisible('#asksheet')) && (await admin.query(`select count(*)::int as n from events where type = 'sos'`)).rows[0].n === 0);

// ---- a family member's Today: the hero is one line; tiles named like the tabs
const A = await phone(as('Anchit'));
await A.waitForTimeout(800);
if (process.env.FR_SHOT_DIR) { await A.screenshot({ path: process.env.FR_SHOT_DIR + '/today-anchit-390-light.png' }); await A.emulateMedia({ colorScheme: 'dark' }); await A.waitForTimeout(100); await A.screenshot({ path: process.env.FR_SHOT_DIR + '/today-anchit-390-dark.png' }); await A.emulateMedia({ colorScheme: 'light' }); }
ok('the hero is the family name and a status, without the code, invite or call', !(await A.$('.homehero .invitebtn')) && !(await A.$('#m-code')) && !(await A.$('.homehero #callnow')));
ok('Family call is under More', !!(await A.$('#more #callnow')));
const tiles = await A.$$eval('#widgets .widget b', bs => bs.map(b => b.textContent));
const tabs = await A.$$eval('#tabs .inner > button:not(.deskonly)', bs => bs.map(b => b.textContent.trim()));
ok('the tiles and tabs use the same names', tiles.join() === 'Vault,Health,To do,Family' && tabs.some(t => /To do$/.test(t)) && tabs.some(t => /Family$/.test(t)), tiles.join() + ' / ' + tabs.join());
ok('no floating chat button over the five things on a phone', !(await A.isVisible('#chat-fab')));
ok('the round profile tile goes straight to Profile', await A.isVisible('#metile'));
await A.click('#metile'); await A.waitForTimeout(400);
ok('Profile opens on You', await A.isVisible('#pane-profile') && (await A.$eval('#pane-profile .card h3', h => h.textContent)) === 'You');
if (process.env.FR_SHOT_DIR) { await A.screenshot({ path: process.env.FR_SHOT_DIR + '/profile-390-light.png' }); await A.emulateMedia({ colorScheme: 'dark' }); await A.waitForTimeout(100); await A.screenshot({ path: process.env.FR_SHOT_DIR + '/profile-390-dark.png' }); await A.emulateMedia({ colorScheme: 'light' }); }
await A.click('#pedit'); await A.waitForTimeout(300);
ok('Edit opens right under You, not in another card', await A.evaluate(() => document.getElementById('editform').closest('.card').querySelector('h3').textContent === 'You'));
ok('the AI keys are tucked under Advanced', await A.evaluate(() => !!document.getElementById('k-key').closest('details.advanced')));
ok('nothing says coming soon, beta, or Language', !/coming soon|Free · Beta|Hindi toggle/i.test(await A.textContent('#pane-profile')));
await A.check('#ap-big'); await A.waitForTimeout(200);
ok('big text is its own setting: anyone can have it without the elder\'s buttons', await A.evaluate(() => document.body.classList.contains('senior')) && !(await A.isVisible('#seniorui')));
await A.uncheck('#ap-big');
await A.click('#signout'); await A.waitForTimeout(200);
ok('Sign out asks in Parwah\'s own sheet', await A.isVisible('#asksheet') && /Sign out on this phone/.test(await A.textContent('#as-q')));
await A.click('#as-no'); await A.waitForTimeout(200);
ok('and Stay signed in stays', !(await A.isVisible('#asksheet')) && await A.isVisible('#pane-profile'));

// ---- notifications: what needs you, as buttons, no log lines
await call('events', { code, memberId: U.Anchit.memberId, type: 'message', text: 'chai?' }, {}, 'POST', U.Anchit.token);
await A.evaluate(() => { location.hash = '#notifs'; }); await A.waitForTimeout(1200);
await call('events', { code, memberId: U.Papa.memberId, type: 'pill', text: '' }, {}, 'POST', U.Papa.token);
await admin.query(`insert into events (circle_id, member_id, type, text) values ((select id from circles where code = $1), null, 'care', 'Running late and nobody has it yet: Pay the bill')`, [code]);
await A.reload(); await A.waitForTimeout(1200); await A.evaluate(() => { location.hash = '#notifs'; }); await A.waitForTimeout(800);
const nl = await A.textContent('#nlist');
ok('routine activity (Papa took his medicines) is not in the bell; something running late is', !/pills|medicines/i.test(nl) && /Running late/.test(nl), nl.slice(0, 200));
ok('my own actions and chat messages are not in the bell', !/chai\?/.test(nl) && !/Anchit created/.test(nl), nl.slice(0, 200));
ok('each row is a button', await A.$$eval('#nlist .nrow', rs => rs.every(r => r.tagName === 'BUTTON')));
if (await A.$('#nlist .nrow')) { await A.click('#nlist .nrow'); await A.waitForTimeout(200); ok('the detail has no "Type:" log line', !/Type:/.test(await A.textContent('#ndetail'))); }

// ---- the drawer: Escape closes it, focus goes in and comes back
await A.evaluate(() => { location.hash = '#home'; }); await A.waitForTimeout(400);
await A.click('#hamb'); await A.waitForTimeout(200);
if (process.env.FR_SHOT_DIR) { await A.screenshot({ path: process.env.FR_SHOT_DIR + '/drawer-390-light.png' }); await A.emulateMedia({ colorScheme: 'dark' }); await A.waitForTimeout(100); await A.screenshot({ path: process.env.FR_SHOT_DIR + '/drawer-390-dark.png' }); await A.emulateMedia({ colorScheme: 'light' }); }
ok('the menu takes focus', await A.evaluate(() => document.getElementById('drawer').contains(document.activeElement)));
const dnames = await A.$$eval('#drawer .ditem:not(.sub)', bs => bs.map(b => b.textContent.replace('▾', '').trim()));
ok('the menu uses the same names, with the rest under More', dnames.slice(0, 5).join('|') === '🏠 Today|🔐 Vault|🩺 Health & contacts|✅ To do|👨‍👩‍👧 Family' && /More/.test(await A.textContent('#drawer')), dnames.join('|'));
await A.keyboard.press('Escape'); await A.waitForTimeout(200);
ok('Escape closes it and focus returns to the menu button', await A.isHidden('#drawer') && await A.evaluate(() => document.activeElement && document.activeElement.id === 'hamb'));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`firstrun.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`firstrun.e2e: ${pass}/${pass} checks pass`);
