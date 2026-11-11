// RISHTEDAAR, END TO END: a real browser, the real API and a real PostgreSQL.
// Arjun's family is built through the real tree API, five generations, both
// his father's and his mother's side and his wife's own family, most of them
// people who are not on Parwah. Then Arjun and his wife Kavya each open
// Rishtedaar and must see the same people in their own words: Mama, Saala
// and Dada for him; Jeth, Sasur and her own father for her. The list, the
// chain sheet and the line on a person's page are measured like every other
// screen: 44px targets, a 12px floor, AA contrast in light and dark, and
// nothing sideways at 320px.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('rishtedaar.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('rishtedaar.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('rishtedaar.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function user(name) {
  const phone = '+9198610' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}
async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.3.0.' + (++n) }, query, body };
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
  await page.waitForTimeout(1500);
  return page;
}

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
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc }); await page.waitForTimeout(150);
    const m = await page.evaluate(measureIn, sel);
    seen += m.seen;
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    if (m.inner > 1) bad.push(wd + ' sideways inside ' + m.inner + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(100);
  ok('design: ' + label + ' - 44px targets, 12px floor, AA contrast in light and dark, nothing sideways at 320 or 390', bad.length === 0 && seen > 0, bad.slice(0, 6).join(' | ') || 'nothing measured');
}

// ---- the family, through the real API
const circleApi = HANDLERS.circle, eventsApi = HANDLERS.events;
const arjunU = await user('Arjun');
const made = await call(circleApi, { token: arjunU.token, body: { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Arjun', circleName: 'Sharma Family', userId: arjunU.userId, relation: 'son' } });
ok('Arjun starts a joint family', made.status === 201, JSON.stringify(made));
const code = made.code, circleId = (await admin.query('select id from circles where code = $1', [code])).rows[0].id;
await admin.query(`update circles set join_policy = 'open' where id = $1`, [circleId]);
const M = { Arjun: { ...arjunU, memberId: made.memberId, code, circleName: 'Sharma Family' } };
for (const [name, rel] of [['Ramesh', 'father'], ['Kavya', 'daughter-in-law'], ['Karan', null], ['Guest', null]]) {
  const u = await user(name);
  const j = await call(circleApi, { token: u.token, body: { action: 'join', code, memberName: name, userId: u.userId, relation: rel } });
  M[name] = { ...u, memberId: j.memberId, code, circleName: 'Sharma Family' };
}
const id = {};
const idOf = async (name) => id[name] || (id[name] = (await admin.query(`select id from members where circle_id = $1 and name = $2`, [circleId, name])).rows[0].id);
const steps = [];
const doStep = async (action, name, place, of, gender, ofGender) => {
  const body = { action, code, memberId: M.Arjun.memberId, place, ofId: await idOf(of), gender, ofGender };
  if (action === 'add_person') body.personName = name; else body.targetId = await idOf(name);
  const r = await call(circleApi, { token: M.Arjun.token, body });
  steps.push(name + ' ' + r.status + (r.error ? ' ' + r.error : ''));
  return r.status === 200 || r.status === 201;
};
const built = [
  await doStep('place', 'Ramesh', 'parent', 'Arjun', 'm', 'm'),
  await doStep('add_person', 'Geeta', 'parent', 'Arjun', 'f'),          // the second parent: Ramesh's wife
  await doStep('place', 'Kavya', 'spouse', 'Arjun', 'f'),
  await doStep('add_person', 'Kishan', 'parent', 'Kavya', 'm'),         // her own father, not on Parwah
  await doStep('place', 'Karan', 'sibling', 'Kavya', 'm'),
  await doStep('add_person', 'Dada', 'parent', 'Ramesh', 'm'),
  await doStep('add_person', 'Nana', 'parent', 'Geeta', 'm'),
  await doStep('add_person', 'Anil', 'sibling', 'Geeta', 'm'),
  await doStep('add_person', 'Seema', 'spouse', 'Anil', 'f'),
  await doStep('add_person', 'Bharat', 'sibling', 'Arjun', 'm'),
  await doStep('add_person', 'Pardada', 'parent', 'Dada', 'm'),
  await doStep('add_person', 'Shyamlal', 'sibling', 'Dada', 'm'),
  await doStep('add_person', 'Girish', 'child', 'Shyamlal', 'm'),
  await doStep('add_person', 'Om', 'child', 'Arjun', 'm'),
];
ok('the family is built through the real tree API, people not on Parwah included', built.every(Boolean), steps.join(' | '));
ok('eleven of them are not on Parwah', (await admin.query(`select count(*)::int as n from members where circle_id = $1 and user_id is null`, [circleId])).rows[0].n === 11);
// Dates of birth and a city are profile details; set as the profile would.
await admin.query(`update members set dob = '1988-09-30' where id = $1`, [await idOf('Arjun')]);
await admin.query(`update members set dob = '1985-04-11' where id = $1`, [await idOf('Bharat')]);
await admin.query(`update members set place = 'Jaipur' where id = $1`, [await idOf('Anil')]);

// ---- what the server says, for two different people
const look = async (who) => {
  const r = await call(eventsApi, { method: 'GET', token: who.token, query: { circle: code, member: who.memberId } });
  const by = {}; for (const m of r.members) by[m.name] = m;
  return by;
};
const a = await look(M.Arjun), k = await look(M.Kavya);
const rz = (m) => m.rz ? [m.kin, m.rz.hindi, m.rz.english, m.rz.group, m.rz.chain].map(String).join(' / ') : String(m.kin) + ' / none';
ok('server: Arjun sees Anil as Mama, with the chain in words', rz(a.Anil) === "Mama / Mama / Uncle / kareebi / Your mother Geeta's brother", rz(a.Anil));
ok('server: and Seema as Mami, Karan as Saala, Kishan as Sasur', a.Seema.rz.hindi === 'Mami' && a.Karan.rz.hindi === 'Saala' && a.Karan.kin === 'Brother-in-law' && a.Kishan.rz.hindi === 'Sasur' && a.Kishan.kin === 'Father-in-law', [rz(a.Seema), rz(a.Karan), rz(a.Kishan)].join(' ; '));
ok('server: Dada and Nana keep the label Grandfather and gain their home names', a.Dada.kin === 'Grandfather' && a.Dada.rz.hindi === 'Dada' && a.Nana.kin === 'Grandfather' && a.Nana.rz.hindi === 'Nana' && a.Dada.rz.side === 'paternal' && a.Nana.rz.side === 'maternal', rz(a.Dada) + ' ; ' + rz(a.Nana));
ok('server: a parent\'s cousin is an uncle, far out', rz(a.Girish) === "Uncle (Papa's cousin) / null / Uncle (Papa's cousin) / door / Your father Ramesh's father Dada's brother Shyamlal's son", rz(a.Girish));
ok('server: someone not placed is in no group and has no made-up chain', a.Guest.kin === null && a.Guest.rz.group === 'unplaced' && a.Guest.rz.chain === 'Not connected in the family tree yet' && a.Arjun.rz === null, rz(a.Guest));
ok('server: Kavya sees Bharat as Jeth (he is older than her husband) and Ramesh as Sasur', k.Bharat.kin === 'Brother-in-law' && k.Bharat.rz.hindi === 'Jeth' && k.Ramesh.rz.hindi === 'Sasur', rz(k.Bharat));
ok('server: and her own father as Father, at home', k.Kishan.kin === 'Father' && k.Kishan.rz.group === 'ghar' && k.Karan.kin === 'Brother', rz(k.Kishan));
ok('server: her husband\'s Mama is told as that', k.Anil.kin === "Husband's Mama" && k.Anil.rz.group === 'door', rz(k.Anil));
await admin.query(`update members set dob = null where id = $1`, [await idOf('Bharat')]);
ok('server: with no date of birth, Jeth is not guessed', (await look(M.Kavya)).Bharat.rz.hindi === null && (await look(M.Kavya)).Bharat.kin === 'Brother-in-law');
await admin.query(`update members set dob = '1985-04-11' where id = $1`, [await idOf('Bharat')]);

// ---- Arjun opens Rishtedaar
const A = await phone(M.Arjun, { hash: '#people' });
ok('the way in is on the family tree', await A.isVisible('#treecard #rz-open'));
await A.click('#rz-open'); await A.waitForTimeout(400);
ok('Rishtedaar opens, with its plain subtitle', await A.isVisible('#rz-sheet') && (await A.textContent('#rz-title')).trim() === 'Rishtedaar' && (await A.textContent('#rz-sub')).trim() === 'Everyone you are related to, near and far');
const sections = (page) => page.evaluate(() => {
  const out = {}; let cur = null;
  document.querySelectorAll('#rz-list > *').forEach(el => {
    if (el.classList.contains('eyebrow')) { cur = el.textContent.trim(); out[cur] = []; }
    else if (cur) out[cur].push(el.querySelector('.txt').textContent.replace(/\s+/g, ' ').trim());
  });
  return out;
});
const rowOf = (page, name) => page.evaluate((nm) => {
  const r = [...document.querySelectorAll('#rz-list .crow')].find(x => x.querySelector('b').textContent === nm);
  if (!r) return null;
  const head = (() => { let e = r.previousElementSibling; while (e && !e.classList.contains('eyebrow')) e = e.previousElementSibling; return e ? e.textContent.trim() : ''; })();
  return { head, kin: r.querySelector('.rz-kin') ? r.querySelector('.rz-kin').textContent : '', chain: r.querySelector('small') ? r.querySelector('small').textContent : '' };
}, name);
const S = await sections(A);
const heads = Object.keys(S);
ok('three groups, near to far, then who is not in the tree', heads.join(' | ') === 'Ghar: your own home | Kareebi: close family | Door ke rishtedaar: the wider family | Not in the tree yet', heads.join(' | '));
const want = {
  Kavya: ['Ghar', 'Wife', 'Your wife'], Ramesh: ['Ghar', 'Father', 'Your father'], Geeta: ['Ghar', 'Mother · not on Parwah', 'Your mother'],
  Bharat: ['Ghar', 'Brother · not on Parwah', 'Your brother'], Om: ['Ghar', 'Son · not on Parwah', 'Your son'],
  Dada: ['Ghar', 'Dada · Grandfather · not on Parwah', "Your father Ramesh's father"], Nana: ['Ghar', 'Nana · Grandfather · not on Parwah', "Your mother Geeta's father"],
  Pardada: ['Ghar', 'Pardada · Great-grandfather · not on Parwah', "Your father Ramesh's father Dada's father"],
  Anil: ['Kareebi', 'Mama · Uncle · not on Parwah', "Your mother Geeta's brother"], Seema: ['Kareebi', 'Mami · Aunt · not on Parwah', "Your mother Geeta's brother Anil's wife"],
  Kishan: ['Kareebi', 'Sasur · Father-in-law · not on Parwah', "Your wife Kavya's father"], Karan: ['Kareebi', 'Saala · Brother-in-law', "Your wife Kavya's brother"],
  Shyamlal: ['Door', 'Grand-uncle · not on Parwah', "Your father Ramesh's father Dada's brother"],
  Girish: ['Door', "Uncle (Papa's cousin) · not on Parwah", "Your father Ramesh's father Dada's brother Shyamlal's son"],
};
const got = {}; for (const nm of Object.keys(want)) got[nm] = await rowOf(A, nm);
const wrong = Object.keys(want).filter(nm => !got[nm] || !got[nm].head.startsWith(want[nm][0]) || got[nm].kin !== want[nm][1] || got[nm].chain !== want[nm][2]);
ok('Arjun sees each person in the right group, home name first, with one line of chain', wrong.length === 0, wrong.map(nm => nm + ': ' + JSON.stringify(got[nm])).join(' ; '));
ok('he is not in his own list', !(await rowOf(A, 'Arjun')));
ok('Guest is listed as not in the tree yet, with a button to place them', (await rowOf(A, 'Guest')).head === 'Not in the tree yet' && await A.isVisible('#rz-list [data-rzplace="' + await idOf('Guest') + '"]'));
await design(A, '#rz-sheet', 'the Rishtedaar list');
if (process.env.RZ_SHOT_DIR) await A.screenshot({ path: process.env.RZ_SHOT_DIR + '/rishtedaar-arjun-390-light.png' });

// ---- search by a relation word, or a name
const shownNames = (page) => page.$$eval('#rz-list .crow b', bs => bs.map(b => b.textContent));
await A.fill('#rz-q', 'mama'); await A.waitForTimeout(250);
ok('searching "mama" finds the Mama and nobody else', (await shownNames(A)).join() === 'Anil', (await shownNames(A)).join());
await A.fill('#rz-q', 'cousin'); await A.waitForTimeout(250);
ok('searching "cousin" finds Papa\'s cousin', (await shownNames(A)).join() === 'Girish', (await shownNames(A)).join());
await A.fill('#rz-q', 'KAV'); await A.waitForTimeout(250);
ok('searching a name works in any letter case', (await shownNames(A)).join() === 'Kavya', (await shownNames(A)).join());
await A.fill('#rz-q', 'zzzz'); await A.waitForTimeout(250);
ok('nothing found says so, and suggests what to try', (await shownNames(A)).length === 0 && /Nobody matches "zzzz"\. Try a name, or a word like mama or cousin\./.test(await A.textContent('#rz-note')), await A.textContent('#rz-note'));
await A.fill('#rz-q', ''); await A.waitForTimeout(250);
ok('clearing the search brings everyone back', (await shownNames(A)).length === 15 && await A.isHidden('#rz-note'), String((await shownNames(A)).length));

// ---- the chain sheet
await A.click('#rz-list [data-rz="' + await idOf('Anil') + '"]'); await A.waitForTimeout(350);
ok('tapping a row opens a small sheet with the full chain in words', await A.isVisible('#rz-who') && (await A.textContent('#rz-who-name')) === 'Anil' &&
   (await A.textContent('#rz-who-kin')) === 'Mama · Uncle · not on Parwah' && (await A.textContent('#rz-who-chain')) === "Your mother Geeta's brother", await A.textContent('#rz-who-chain'));
ok('with their city when it is known', await A.isVisible('#rz-who-city-row') && /Jaipur/.test(await A.textContent('#rz-who-city')));
ok('no phone on file: no call button, and no number in the page', await A.isHidden('#rz-who-call') && !(await A.getAttribute('#rz-who-call', 'href')));
await design(A, '#rz-who', 'the chain sheet');
await A.keyboard.press('Escape'); await A.waitForTimeout(200);
ok('Escape closes the small sheet first, and the list stays', await A.isHidden('#rz-who') && await A.isVisible('#rz-sheet'));
await A.click('#rz-list [data-rz="' + await idOf('Ramesh') + '"]'); await A.waitForTimeout(350);
const rameshPhone = (await admin.query(`select phone from members where id = $1`, [await idOf('Ramesh')])).rows[0].phone;
ok('a phone the family read already shows becomes a call button; no city, no city row', (rameshPhone
     ? await A.isVisible('#rz-who-call') && (await A.getAttribute('#rz-who-call', 'href')) === 'tel:' + encodeURIComponent(rameshPhone)
     : await A.isHidden('#rz-who-call')) && await A.isHidden('#rz-who-city-row'), String(rameshPhone));
await A.click('#rz-who-x'); await A.waitForTimeout(200);

// ---- a person's page: how are we related?
await A.click('#rz-list [data-rz="' + await idOf('Anil') + '"]'); await A.waitForTimeout(300);
await A.click('#rz-who-page'); await A.waitForTimeout(600);
ok('Their page opens the person, and both sheets close', await A.isVisible('#pane-person') && await A.isHidden('#rz-who') && await A.isHidden('#rz-sheet') && (await A.textContent('#pp-name')) === 'Anil');
ok('one line under the name says the relation', await A.isVisible('#rz-pp-kin') && (await A.textContent('#rz-pp-kin')) === 'Mama · Uncle: how are we related?' && await A.isHidden('#rz-pp-chain'), await A.textContent('#rz-pp-kin'));
await A.click('#rz-pp-kin'); await A.waitForTimeout(200);
ok('a tap shows the chain in words', await A.isVisible('#rz-pp-chain') && (await A.textContent('#rz-pp-chain')) === "Your mother Geeta's brother" && (await A.getAttribute('#rz-pp-kin', 'aria-expanded')) === 'true');
await design(A, '.personhero', 'how are we related, on a person page');
await A.click('#rz-pp-kin'); await A.waitForTimeout(150);
ok('and a second tap folds it away', await A.isHidden('#rz-pp-chain'));
const pageOf = async (page, mid) => {
  await page.evaluate(() => { location.hash = '#people'; }); await page.waitForTimeout(700);
  await page.locator('[data-mprof="' + mid + '"]').first().click(); await page.waitForTimeout(350);
  await page.click('#mp-page'); await page.waitForTimeout(500);
};
await pageOf(A, M.Arjun.memberId);
ok('your own page does not ask how you are related to yourself', await A.isHidden('#rz-pp-kin'));
await pageOf(A, M.Guest.memberId);
ok('someone not in the tree: the line says so, and never invents a link', (await A.textContent('#rz-pp-kin')) === 'Not in the tree yet: how are we related?' &&
   await A.evaluate(() => { document.getElementById('rz-pp-kin').click(); return /Not connected in the family tree yet/.test(document.getElementById('rz-pp-chain').textContent); }));

// ---- placing someone, and adding a relative, go to the existing tree form
await A.evaluate(() => { location.hash = '#people'; }); await A.waitForTimeout(900);
await A.click('#rz-open'); await A.waitForTimeout(300);
await A.click('#rz-list [data-rzplace="' + M.Guest.memberId + '"]'); await A.waitForTimeout(500);
ok('Place in the tree opens the existing form on that person', await A.isHidden('#rz-sheet') && await A.$eval('#tree-more', d => d.open) && (await A.$eval('#tr-who', x => x.value)) === M.Guest.memberId);
ok('a long family gets a search box on the "of" list', await A.isVisible('#rz-offind'));
await A.fill('#rz-offind', 'ani'); await A.waitForTimeout(250);
ok('typing shortens the list to who matches', (await A.$$eval('#tr-of option', os => os.map(o => o.textContent))).join() === 'Choose…,Anil', (await A.$$eval('#tr-of option', os => os.map(o => o.textContent))).join());
await A.selectOption('#tr-of', await idOf('Anil')); await A.fill('#rz-offind', 'zz'); await A.waitForTimeout(250);
ok('a choice already made is never dropped by the search', (await A.$eval('#tr-of', x => x.value)) === await idOf('Anil'));
await A.fill('#rz-offind', ''); await A.waitForTimeout(200);
await A.click('#tr-gender [data-g="f"]'); await A.selectOption('#tr-place', 'child');
await A.click('#tr-go'); await A.waitForTimeout(1500);
await A.click('#rz-open'); await A.waitForTimeout(400);
const g1 = await rowOf(A, 'Guest');
ok('once placed, Guest moves out of "not in the tree yet": Anil\'s daughter is a cousin', g1 && g1.head.startsWith('Kareebi') && g1.kin === 'Cousin' && g1.chain === "Your mother Geeta's brother Anil's daughter", JSON.stringify(g1));
await A.click('#rz-add'); await A.waitForTimeout(500);
ok('Add a relative opens the existing form on someone not on Parwah', await A.isHidden('#rz-sheet') && (await A.$eval('#tr-who', x => x.value)) === 'new' && await A.isVisible('#tr-name'));
await A.fill('#tr-name', 'Ritu'); await A.click('#tr-gender [data-g="f"]'); await A.selectOption('#tr-place', 'child'); await A.selectOption('#tr-of', await idOf('Shyamlal'));
await A.click('#tr-go'); await A.waitForTimeout(1500);
await A.click('#rz-open'); await A.waitForTimeout(400);
const ritu = await rowOf(A, 'Ritu');
ok('the new relative appears, named: Papa\'s cousin is an Aunt', ritu && ritu.head.startsWith('Door') && ritu.kin === "Aunt (Papa's cousin) · not on Parwah", JSON.stringify(ritu));

// ---- the family could not be read: say so, and keep what the phone has
await A.route('**/api/events*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"down"}' }));
await A.waitForTimeout(13500);   // the screen refreshes every 12 seconds
ok('error: it says Parwah could not be reached, keeps the last family, and offers Try again', /Could not reach Parwah just now/.test(await A.textContent('#rz-note')) && await A.isVisible('[data-rzretry]') && (await shownNames(A)).length === 16, await A.textContent('#rz-note'));
await design(A, '#rz-sheet', 'the list with a message');
await A.unroute('**/api/events*');
await A.route('**/api/events*', r => r.abort());
await A.click('[data-rzretry]'); await A.waitForTimeout(900);
ok('offline: it says so plainly, and still shows the family as last seen', /You are offline\. This is your family as this phone last saw it\./.test(await A.textContent('#rz-note')) && (await shownNames(A)).length === 16, await A.textContent('#rz-note'));
await A.unroute('**/api/events*');
await A.waitForTimeout(13500);
ok('and when the family loads again the message goes', await A.isHidden('#rz-note') && (await shownNames(A)).length === 16);
await A.click('#rz-x'); await A.waitForTimeout(200);
ok('closing puts the keyboard back on the button that opened it', await A.isHidden('#rz-sheet') && await A.evaluate(() => document.activeElement && document.activeElement.id === 'rz-open'));

// ---- Kavya, on a small phone in the dark: the same family in her words
const K2 = await phone(M.Kavya, { scheme: 'dark', width: 320, hash: '#people' });
await K2.click('#rz-open'); await K2.waitForTimeout(400);
const wantK = {
  Arjun: ['Ghar', 'Husband'], Kishan: ['Ghar', 'Father · not on Parwah'], Karan: ['Ghar', 'Brother'], Om: ['Ghar', 'Son · not on Parwah'],
  Ramesh: ['Kareebi', 'Sasur · Father-in-law'], Geeta: ['Kareebi', 'Saas · Mother-in-law · not on Parwah'], Bharat: ['Kareebi', 'Jeth · Brother-in-law · not on Parwah'],
  Dada: ['Kareebi', 'Grandfather-in-law · not on Parwah'], Anil: ['Door', "Husband's Mama · not on Parwah"],
};
const gotK = {}; for (const nm of Object.keys(wantK)) gotK[nm] = await rowOf(K2, nm);
const wrongK = Object.keys(wantK).filter(nm => !gotK[nm] || !gotK[nm].head.startsWith(wantK[nm][0]) || gotK[nm].kin !== wantK[nm][1]);
ok('Kavya sees her own father at home, her husband\'s father as Sasur, his elder brother as Jeth', wrongK.length === 0, wrongK.map(nm => nm + ': ' + JSON.stringify(gotK[nm])).join(' ; '));
ok('her chain to Bharat runs through her husband', gotK.Bharat && gotK.Bharat.chain === "Your husband Arjun's brother", gotK.Bharat && gotK.Bharat.chain);
ok('the list fits a 320px phone without scrolling sideways', await K2.evaluate(() => document.scrollingElement.scrollWidth - innerWidth) <= 0 &&
   await K2.$$eval('#rz-list .crow', rs => rs.every(r => { const b = r.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; })));
await K2.fill('#rz-q', 'jeth'); await K2.waitForTimeout(250);
ok('she can search "jeth"', (await shownNames(K2)).join() === 'Bharat', (await shownNames(K2)).join());
await K2.fill('#rz-q', ''); await K2.waitForTimeout(200);
await K2.click('#rz-list [data-rz="' + await idOf('Kishan') + '"]'); await K2.waitForTimeout(300);
ok('her sheet for her father says Your father', (await K2.textContent('#rz-who-chain')) === 'Your father' && /^Father/.test(await K2.textContent('#rz-who-kin')));
await design(K2, '#rz-who', 'the chain sheet, for Kavya');
if (process.env.RZ_SHOT_DIR) await K2.screenshot({ path: process.env.RZ_SHOT_DIR + '/rishtedaar-kavya-sheet-320-dark.png' });

// ---- a family with nobody placed yet: one helpful first step
const nishaU = await user('Nisha');
const made2 = await call(circleApi, { token: nishaU.token, body: { action: 'create', kind: 'family', familyType: 'nuclear', memberName: 'Nisha', circleName: 'Nisha Family', userId: nishaU.userId, relation: 'mother' } });
const N = await phone({ ...nishaU, memberId: made2.memberId, code: made2.code, circleName: 'Nisha Family' }, { width: 320, hash: '#people' });
await N.click('#rz-open'); await N.waitForTimeout(400);
ok('empty: a family with nobody placed gets a first step, not a blank list', /You are not in the tree yet\. Start with yourself/.test(await N.textContent('#rz-note')) && await N.isVisible('#rz-note [data-rzplace]') && (await shownNames(N)).length === 0, await N.textContent('#rz-note'));
await design(N, '#rz-sheet', 'the empty Rishtedaar');
await N.click('#rz-note [data-rzplace]'); await N.waitForTimeout(500);
ok('and the first step opens the tree form on yourself', await N.isHidden('#rz-sheet') && (await N.$eval('#tr-who', x => x.value)) === made2.memberId && await N.$eval('#tree-more', d => d.open));
ok('a small family has no search box on the "of" list', await N.isHidden('#rz-offind-wrap'));
// Loading: the sheet opened before the family has been read.
const slow = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await slow.addInitScript(([w]) => {
  localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
  localStorage.setItem('parwah-token', w.token); localStorage.setItem('parwah-fr-hide', '1');
  localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: 'family', circleName: w.circleName }));
}, [M.Arjun]);
const SL = await slow.newPage();
SL.on('pageerror', e => errors.push('slow: ' + e.message));
let release; const held = new Promise(r => { release = r; });
await SL.route('**/api/events*', async r => { await held; await r.continue(); });
await SL.goto(BASE + '/#people'); await SL.waitForTimeout(1200);
await SL.click('#rz-open'); await SL.waitForTimeout(200);
ok('loading: it says so while the family is being read', /Loading your family/.test(await SL.textContent('#rz-note')) && (await shownNames(SL)).length === 0, await SL.textContent('#rz-note'));
release(); await SL.waitForTimeout(1500);
ok('and fills in by itself when it arrives', await SL.isHidden('#rz-note') && (await shownNames(SL)).length === 16, String((await shownNames(SL)).length));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`rishtedaar.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`rishtedaar.e2e: ${pass}/${pass} checks pass`);
