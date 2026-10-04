// THE FAMILY TREE, END TO END: a real browser, the real API and a real
// PostgreSQL. Papa starts a joint family; a nuclear family is not offered
// in-law roles. Then the family is placed through the People screen - wife,
// sons, their wives, a grandson, a great-grandson - and each person sees the
// tree in their own words, four generations deep, on a 320px phone.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('tree.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('tree.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('tree.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

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
const sel = (page, box) => page.$eval('#' + box + ' .sel', b => b.getAttribute('data-role'));

// ---- a nuclear family is not offered in-law roles
const nu = await user('Nisha');
const N = await phone(nu);
await N.click('#pickkind [data-kind="family"]'); await N.waitForTimeout(300);
ok('a new family is asked joint or nuclear first', await N.isVisible('#c-ftype') && (await N.textContent('#c-ftype')).includes('Joint family') && (await N.textContent('#c-ftype')).includes('Nuclear family'));
ok('joint is chosen to start with, and offers daughter-in-law', await N.$eval('#c-ftype .sel', b => b.dataset.ft) === 'joint' && await N.isVisible('#c-role [data-role="daughter-in-law"]'));
await N.click('#c-ftype [data-ft="nuclear"]'); await N.waitForTimeout(200);
ok('a nuclear family does not offer daughter-in-law or grandchildren', !(await N.isVisible('#c-role [data-role="daughter-in-law"]')) && !(await N.isVisible('#c-role [data-role="grandson"]')) && await N.isVisible('#c-role [data-role="son"]'));
await N.fill('#c-circle', 'Nisha Family'); await N.click('#c-go'); await N.waitForTimeout(1500);
ok('and it is kept as nuclear', (await admin.query(`select family_type from circles where name = 'Nisha Family'`)).rows[0].family_type === 'nuclear');
const gr = await user('Gita');
const G = await phone(gr);
await G.click('#pickkind [data-kind="group"]'); await G.waitForTimeout(300);
ok('a group of friends is not asked joint or nuclear', !(await G.isVisible('#c-ftype')));

// ---- Papa starts a joint family
const papaU = await user('Papa');
const P1 = await phone(papaU);
await P1.click('#pickkind [data-kind="family"]'); await P1.waitForTimeout(300);
await P1.fill('#c-circle', 'Sachdeva Family');
await P1.click('#c-role [data-role="father"]');
await P1.click('#c-go'); await P1.waitForTimeout(1500);
const fam = (await admin.query(`select id, code, family_type from circles where name = 'Sachdeva Family'`)).rows[0];
ok('Papa starts a joint family', fam && fam.family_type === 'joint');
await admin.query(`update circles set join_policy = 'open' where id = $1`, [fam.id]);
// The rest of the family joins (by API, as their own phones would).
const { default: circleApi } = await import('../../../api/circle.mjs');
const join = async (u, relation) => {
  let out; const res = { status() { return this; }, json(j) { out = j; return this; }, setHeader() {} };
  await circleApi({ method: 'POST', headers: { 'x-parwah-token': u.token, 'x-forwarded-for': '10.2.0.' + (++n) }, query: {}, body: { action: 'join', code: fam.code, memberName: u.name, userId: u.userId, relation } }, res);
  return out.memberId;
};
const people = {};
for (const [name, rel] of [['Mumma', 'mother'], ['Rohan', 'son'], ['Priya', 'daughter-in-law'], ['Amit', 'son'], ['Neha', 'daughter-in-law'], ['Aarav', 'grandson'], ['Vihaan', null]]) {
  const u = await user(name); people[name] = { ...u, memberId: await join(u, rel) };
}
const papaId = (await admin.query(`select id from members where circle_id = $1 and name = 'Papa'`, [fam.id])).rows[0].id;

// ---- placing the family through the People screen
await P1.evaluate(() => { location.hash = '#people'; }); await P1.waitForTimeout(1500);
ok('People leads with the family tree', await P1.isVisible('#treecard') && /Joint family tree/.test(await P1.textContent('#tree-title')));
ok('before anyone is placed, it explains how to start', /Start the tree/.test(await P1.textContent('#tree-sub')));
const idOf = async (name) => (await admin.query(`select id from members where circle_id = $1 and name = $2`, [fam.id, name])).rows[0].id;
async function place(page, who, where, of, g) {
  await page.selectOption('#tr-who', await idOf(who));
  await page.selectOption('#tr-place', where);
  await page.selectOption('#tr-of', await idOf(of));
  await page.click('#tr-gender [data-g="' + g + '"]');
  await page.click('#tr-go'); await page.waitForTimeout(1300);
}
await place(P1, 'Mumma', 'spouse', 'Papa', 'f');
await place(P1, 'Rohan', 'child', 'Papa', 'm');
await place(P1, 'Amit', 'child', 'Papa', 'm');
await place(P1, 'Priya', 'spouse', 'Rohan', 'f');
await place(P1, 'Neha', 'spouse', 'Amit', 'f');
await place(P1, 'Aarav', 'child', 'Rohan', 'm');
// He or she must be chosen: Parwah does not guess for the great-grandson.
await P1.selectOption('#tr-who', await idOf('Vihaan')); await P1.selectOption('#tr-place', 'child'); await P1.selectOption('#tr-of', await idOf('Aarav'));
await P1.$$eval('#tr-gender button', bs => bs.forEach(b => b.classList.remove('sel')));
await P1.click('#tr-go'); await P1.waitForTimeout(500);
ok('without he or she, it asks rather than guesses', /Choose he or she/.test(await P1.textContent('#tr-err')));
await place(P1, 'Vihaan', 'child', 'Aarav', 'm');
const links = (await admin.query(`select name, parent_id, spouse_id from members where circle_id = $1`, [fam.id])).rows;
const L = Object.fromEntries(links.map(r => [r.name, r]));
ok('the links land in the database', L.Rohan.parent_id === papaId && L.Mumma.spouse_id === papaId && L.Priya.spouse_id === await idOf('Rohan') && L.Rohan.spouse_id === await idOf('Priya') && L.Vihaan.parent_id === await idOf('Aarav'),
   JSON.stringify({ rohan: L.Rohan.parent_id === papaId, mumma: L.Mumma.spouse_id === papaId }));
ok('a place that cannot be true is refused with a reason', await (async () => {
  await P1.selectOption('#tr-who', await idOf('Neha')); await P1.selectOption('#tr-place', 'spouse'); await P1.selectOption('#tr-of', papaId);
  await P1.click('#tr-gender [data-g="f"]'); await P1.click('#tr-go'); await P1.waitForTimeout(900);
  return /already ha(s|ve) a husband or wife/.test(await P1.textContent('#tr-err'));
})());

// ---- the tree, in Papa's words
const tree = await P1.textContent('#tree');
ok('Papa sees four generations', /4 generations/.test(await P1.textContent('#tree-sub')), await P1.textContent('#tree-sub'));
ok('with his daughters-in-law and great-grandson named as such', /Daughter-in-law/.test(tree) && /Great-grandson/.test(tree) && /Grandson/.test(tree), tree);
ok('couples sit together: Rohan with Priya', await P1.$$eval('.tunit', us => us.some(u => /Rohan/.test(u.textContent) && /Priya/.test(u.textContent))));
ok('and children sit under their parents: Vihaan under Aarav', await P1.$$eval('.tnode', ns => ns.some(n => /^Aarav/.test(n.querySelector('.tunit').textContent) && /Vihaan/.test(n.querySelector('.tkids') ? n.querySelector('.tkids').textContent : ''))));

// ---- the same tree in Priya's words, on a small phone, in the dark
const P2 = await phone({ ...people.Priya, code: fam.code, circleName: 'Sachdeva Family' , memberId: people.Priya.memberId }, { scheme: 'dark', width: 320, hash: '#people' });
const t2 = await P2.textContent('#tree');
ok('Priya sees Papa as Father-in-law and Neha as Sister-in-law', /Father-in-law/.test(t2) && /Sister-in-law/.test(t2), t2);
ok('and Amit as Brother-in-law, Aarav as Son', /Brother-in-law/.test(t2) && /Son/.test(t2));
ok('four generations fit a 320px phone without scrolling sideways', await P2.evaluate(() => document.scrollingElement.scrollWidth - innerWidth) <= 0);
if (process.env.TREE_SHOT_DIR) await P2.locator('#treecard').screenshot({ path: process.env.TREE_SHOT_DIR + '/tree-priya-320-dark.png' });
const priyaSheet = P2.locator('.tperson', { hasText: 'Papa' });
await priyaSheet.click(); await P2.waitForTimeout(500);
ok('tapping someone opens their profile, with the same word for them', await P2.isVisible('#msheet') && /Father-in-law/.test(await P2.textContent('#mp-role')), await P2.textContent('#mp-role'));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`tree.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`tree.e2e: ${pass}/${pass} checks pass`);
