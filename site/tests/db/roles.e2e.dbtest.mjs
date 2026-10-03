// ROLES, END TO END: a real browser, the real API and a real PostgreSQL.
// Anchit starts a group of friends: the form asks for his role in the
// group, starts on Friend, and Friend is what the group keeps. A family
// still starts on Family, and Friend can be chosen when joining too.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('roles.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('roles.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('roles.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

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

// Signed in, in no family or group yet: the app offers to start one.
async function phone(who, scheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: scheme });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/');
  await page.waitForTimeout(1200);
  return page;
}
const sel = (page, box) => page.$eval('#' + box + ' .sel', b => b.getAttribute('data-role'));
const memberOf = async (code, name) => (await admin.query(
  `select m.relation from members m join circles c on c.id = m.circle_id where c.code = $1 and m.name = $2`, [code, name])).rows[0];

// ---- a group of friends
const anchit = await user('Anchit Tandon');
const A = await phone(anchit, 'dark');
ok('a signed-in person with no family or group is offered to start one', await A.isVisible('#pickkind'));
await A.click('#pickkind [data-kind="group"]');
await A.waitForTimeout(300);
ok('the form says it is a group', (await A.textContent('#c-go')) === 'Create the group' && /in the group/.test(await A.textContent('#c-role-label')), await A.textContent('#c-role-label'));
ok('Friend is one of the roles', await A.isVisible('#c-role [data-role="friend"]'));
ok('and in a group it is already picked', await sel(A, 'c-role') === 'friend');
await A.fill('#c-circle', 'Hustlers');
if (process.env.ROLES_SHOT_DIR) await A.locator('#createcard').screenshot({ path: process.env.ROLES_SHOT_DIR + '/roles-group-dark.png' });
await A.click('#c-go');
await A.waitForTimeout(1500);
const gcode = (await admin.query(`select code, kind from circles where name = 'Hustlers'`)).rows[0];
ok('the group is created', !!gcode && gcode.kind === 'group', JSON.stringify(gcode));
ok('and Anchit is kept as a friend in it', gcode && (await memberOf(gcode.code, 'Anchit Tandon')).relation === 'friend');

// ---- a family still starts on Family
const meera = await user('Meera');
const M = await phone(meera);
await M.click('#pickkind [data-kind="family"]');
await M.waitForTimeout(300);
ok('a family asks for your role in the family and starts on Family',
   /in the family/.test(await M.textContent('#c-role-label')) && await sel(M, 'c-role') === 'family');
if (process.env.ROLES_SHOT_DIR) { await M.setViewportSize({ width: 320, height: 800 }); await M.locator('#createcard').screenshot({ path: process.env.ROLES_SHOT_DIR + '/roles-family-light-320.png' }); }
await M.click('#c-role [data-role="friend"]');
await M.fill('#c-circle', 'Sharma Family');
await M.click('#c-go');
await M.waitForTimeout(1500);
const fcode = (await admin.query(`select code from circles where name = 'Sharma Family'`)).rows[0];
ok('a family friend can be kept as Friend too', fcode && (await memberOf(fcode.code, 'Meera')).relation === 'friend');

// ---- joining a group as a friend
const ravi = await user('Ravi');
const R = await phone(ravi);
await R.click('#pk-join');
await R.waitForTimeout(300);
ok('joining asks for your role without assuming a family', (await R.textContent('#joincard')).includes('Your role (everyone is an equal admin)'));
await R.fill('#j-code', gcode.code);
await R.click('#j-role [data-role="friend"]');
await R.click('#j-go');
await R.waitForTimeout(1500);
const rv = await memberOf(gcode.code, 'Ravi');
const rq = (await admin.query(`select relation from join_requests where name = 'Ravi'`)).rows[0];
ok('Ravi joins the group as a friend (or waits to be let in, as a friend)',
   (rv && rv.relation === 'friend') || (!rv && rq && rq.relation === 'friend'), JSON.stringify({ rv, rq }));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`roles.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`roles.e2e: ${pass}/${pass} checks pass`);
