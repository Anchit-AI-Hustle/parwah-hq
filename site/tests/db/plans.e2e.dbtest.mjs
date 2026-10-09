// EVENTS, BIRTHDAYS AND QUICK ADD, END TO END: real browsers, the real API
// handlers and a real PostgreSQL.
//
// What it proves: one tap on Today reaches the form for a reminder, an
// event, a list, a contact or a document, cursor in place; an appointment
// is a kind of event; birthdays appear on the calendar and in the list from
// each person's date of birth, with a way to wish them; and everyone going
// to an event is reminded once, an hour before, however many phones look.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('plans.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('plans.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('plans.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['care', 'events', 'chats', 'auth', 'book', 'plans', 'settings']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

// ---- the family
let n = 0;
async function person(circleId, name, role = 'family', relation = null) {
  const phone = '+9198200' + String(++n).padStart(5, '0');
  // A settled account: a PIN chosen under the current rules.
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, relation, user_id) values ($1,$2,$3,$4,$5) returning id`, [circleId, name, role, relation, u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, userId: u.id, name, token, phone };
}
const circle = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const rohan = await person(circle, 'Rohan', 'family', 'son');
const papa = await person(circle, 'Papa', 'parent', 'father');
const bd = new Date(Date.now() + 3 * 86400000);
const BDAY = '1958-' + String(bd.getMonth() + 1).padStart(2, '0') + '-' + String(bd.getDate()).padStart(2, '0');
await admin.query('update members set dob = $1 where id = $2', [BDAY, papa.id]);

// ---- a server: the app's files, and the real handlers behind /api/
const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/\/$/, '');
    const h = HANDLERS[name];
    res.setHeader('Content-Type', 'application/json');
    if (!h) { res.end('{"ok":false,"error":"not in this test"}'); return; }
    let raw = ''; for await (const c of req) raw += c;
    const r = { method: req.method, headers: req.headers, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
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
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || !detail ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };
const errors = [];
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
async function phone(who, hash = '#home') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah', JSON.stringify({ code: 'SHARMA', memberId: w.id, name: w.name, role: 'family', circleName: 'Sharma Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash); await page.waitForTimeout(1500);
  return page;
}
const R = await phone(rohan);
const focused = () => R.evaluate(() => document.activeElement && document.activeElement.id);

// ---- 1. Quick add: one tap from Today to the right form
ok('Today has one row to add anything', (await R.$$eval('.quickadd button', bs => bs.map(b => b.textContent.trim()))).join('|') === '⏰ Reminder or task|🗓 Event or plan|📝 List or note|☎️ Contact or health|📄 Document');
for (const [k, pane, field] of [['task', '#pane-care', 'r-title'], ['event', '#pane-fun', 'p-title'], ['note', '#pane-care', 'n-title'], ['contact', '#pane-memory', 'b-name'], ['doc', '#pane-vault', 'vd-label']]) {
  await R.evaluate(() => { location.hash = '#home'; }); await R.waitForTimeout(400);
  await R.click(`.quickadd [data-qadd="${k}"]`); await R.waitForTimeout(800);
  ok(`"${k}" opens its form, ready to type`, await R.isVisible(pane) && (await focused()) === field, (await focused()));
}

// ---- 2. Events: an appointment is a kind of event
await R.evaluate(() => { location.hash = '#home'; }); await R.waitForTimeout(400);
await R.click('.quickadd [data-qadd="event"]'); await R.waitForTimeout(800);
ok('the kinds include appointments, functions and trips', (await R.$$eval('#p-kind button', bs => bs.map(b => b.getAttribute('data-kind')))).join() === 'call,party,meet,appointment,function,trip');
const tmr = new Date(Date.now() + 86400000), d = tmr.getFullYear() + '-' + String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0');
await R.fill('#p-title', "Papa's eye check-up");
await R.click('#p-kind [data-kind="appointment"]');
await R.fill('#p-date', d); await R.fill('#p-time', '10:30');
ok('place and how many wait under More options', !(await R.$eval('#p-more', d => d.open)) && !(await R.isVisible('#p-place')));
await R.click('#p-more summary');
await R.fill('#p-place', 'Centre for Sight, Pune');
await R.click('#p-add'); await R.waitForTimeout(1200);
const pl = (await admin.query(`select * from plans where title = $1`, ["Papa's eye check-up"])).rows[0];
ok('the appointment is saved as one', pl && pl.kind === 'appointment' && pl.place === 'Centre for Sight, Pune');
ok('and the form is cleared, More options folded again', (await R.inputValue('#p-place')) === '' && !(await R.$eval('#p-more', d => d.open)));
ok('and shows with its icon', /🩺 Papa's eye check-up/.test(await R.textContent('#plist')), await R.textContent('#plist'));

// ---- 3. Birthdays, from dates of birth
ok('Papa\'s birthday is at the top of the list, with his age', new RegExp("🎂 Papa's birthday on .* - turns " + (bd.getFullYear() - 1958)).test(await R.textContent('#plist')), await R.textContent('#plist'));
const bkey = BDAY.replace(/^1958/, String(bd.getFullYear()));
if (bd.getMonth() !== new Date().getMonth()) { await R.click('#cal-next'); await R.waitForTimeout(200); }
ok('and marked on the calendar', await R.locator(`[data-cday="${bkey}"] .bday`).count() === 1);
await R.click(`[data-cday="${bkey}"]`); await R.waitForTimeout(300);
ok('tapping that day shows it', /Papa's birthday/.test(await R.textContent('#plist')));
await R.click('[data-bdwish="Papa"]'); await R.waitForTimeout(1500);
ok('Wish them opens the family chat with the wish written', await R.isVisible('#chatview') && /Happy birthday, Papa/.test(await R.inputValue('#msg')), await R.inputValue('#msg').catch(() => ''));

if (process.env.SHOTS) {
  await R.evaluate(() => { location.hash = '#home'; }); await R.waitForTimeout(600); await R.screenshot({ path: process.env.SHOTS + '/today-quickadd.png' });
  await R.evaluate(() => { location.hash = '#fun'; }); await R.waitForTimeout(900); await R.screenshot({ path: process.env.SHOTS + '/plans.png', fullPage: true });
}
// ---- 4. An hour before, everyone going is reminded, once
{
  const { sweepPlanReminders } = await import('../../../api/_plansweep.mjs');
  const sql = db();
  await admin.query(`insert into plans (circle_id, by_member, title, kind, at, going) values ($1, $2, 'Family call', 'call', now() + interval '40 minutes', $3)`, [circle, rohan.id, '{' + rohan.id + ',' + papa.id + '}']);
  await admin.query(`insert into plans (circle_id, by_member, title, kind, at, going) values ($1, $2, 'Later call', 'call', now() + interval '3 hours', $3)`, [circle, rohan.id, '{' + rohan.id + '}']);
  const n = await Promise.all([1, 2, 3, 4].map(() => sweepPlanReminders(sql, circle)));
  ok('an event in 40 minutes is reminded exactly once, however many look', n.reduce((a, b) => a + b, 0) === 1, n.join());
  const rows = (await admin.query(`select title, reminded_at is not null as r from plans order by at`)).rows;
  ok('one three hours away is not reminded yet', rows.find(x => x.title === 'Later call').r === false && rows.find(x => x.title === 'Family call').r === true);
}

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`plans.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`plans.e2e: ${pass}/${pass} checks pass`);
