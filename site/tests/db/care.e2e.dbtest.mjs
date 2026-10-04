// THE CARE SCREEN, END TO END: a real browser, the real API handlers and a
// real PostgreSQL. Two people in one family, each on their own phone.
//
// The journey from the product brief: Rohan asks his sister Meera to book
// the gas refill for Papa, by a time, with what "done" means. Meera sees it
// needs her yes, says yes, finishes it with a note. Rohan sees it done, by
// her, with the note and the whole history - and can reopen it. A task that
// runs late sits under "Needs attention" with the next step, and the family
// is told once. A daily one, once done, comes back tomorrow at the same time.
//
// Needs PARWAH_TEST_DATABASE_URL (a database ending in _test - it is wiped)
// and playwright-core. Run with: npm run test:db
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('care.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('care.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('care.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['care', 'events', 'chats', 'auth']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { fromWall } = await import('../../../api/_recur.mjs');
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
const meera = await person(circle, 'Meera', 'family', 'daughter');
const papa = await person(circle, 'Papa', 'parent', 'father');

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
const TZ = 'Asia/Kolkata';
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

async function phone(who, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: TZ, serviceWorkers: 'block' });
  await ctx.addInitScript(([w, circleCode]) => {
    localStorage.setItem('parwah', JSON.stringify({ code: circleCode, memberId: w.id, name: w.name, role: 'family', circleName: 'Sharma Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
  }, [who, 'SHARMA']);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/#care');
  await page.waitForSelector('#rlist .crow, #rlist .ev', { timeout: 15000 }).catch(async e => { await page.screenshot({ path: process.env.SHOT || '/tmp/e2e.png' }); console.log('URL', page.url(), await page.evaluate(() => [...document.querySelectorAll('section[id^=pane-]')].filter(x => !x.hidden).map(x => x.id).join())); throw e; });
  await page.waitForTimeout(600);
  return page;
}
const rowOf = (page, title) => page.locator('#rlist .crow', { hasText: title }).first();
const groupOf = (page, title) => page.evaluate(t => {
  const row = [...document.querySelectorAll('#rlist .crow')].find(r => r.textContent.includes(t));
  if (!row) return null;
  if (row.closest('details')) return 'g-done';
  let el = row.previousElementSibling;
  while (el && !el.classList.contains('gtitle')) el = el.previousElementSibling;
  return el ? el.id : null;
}, title);
const reload = async page => { await page.reload(); await page.waitForSelector('#rlist .crow, #rlist .ev', { state: 'attached' }); await page.waitForTimeout(600); };
const task = async title => (await admin.query('select * from requests where title = $1 order by created_at desc limit 1', [title])).rows[0];
const localDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

const R = await phone(rohan);
const M = await phone(meera);

// ---- 1. Rohan asks Meera, for Papa, by tomorrow 10:00, with what done means
const tomorrow = localDay(Date.now() + 86400000);
{
  await R.fill('#r-title', 'Book the gas refill');
  await R.selectOption('#r-for', meera.id);
  await R.selectOption('#r-about', papa.id);
  await R.fill('#r-date', tomorrow);
  await R.fill('#r-time', '10:00');
  await R.click('#r-more summary');
  await R.fill('#r-donewhen', 'Delivery date confirmed by the agency');
  ok('the hint says she will be asked', /asked to say yes/.test(await R.textContent('#r-hint')));
  await R.click('#r-add');
  await R.waitForTimeout(900);
  const t = await task('Book the gas refill');
  const [y, m, d] = tomorrow.split('-').map(Number);
  ok('the task is saved, given to Meera and waiting for her yes', t && t.status === 'assigned' && t.claimed_by === meera.id);
  ok('its time is stored in UTC: 10:00 in India is 04:30 UTC',
     t && new Date(t.due_at).getTime() === fromWall({ y, m, d, h: 10, mi: 0, s: 0 }, TZ) && new Date(t.due_at).toISOString().endsWith('T04:30:00.000Z'),
     t && new Date(t.due_at).toISOString());
  // Chromium reports India as Asia/Calcutta, the older name for the same zone.
  ok('with the phone\'s time zone, who it is for, and what done means',
     t && ['Asia/Kolkata', 'Asia/Calcutta'].includes(t.tz) && t.about_member === papa.id && t.done_when === 'Delivery date confirmed by the agency',
     t && JSON.stringify({ tz: t.tz, about: t.about_member === papa.id, done: t.done_when }));
  ok('the form is cleared for the next one', (await R.inputValue('#r-title')) === '');
  ok('Rohan sees it under Coming up', (await groupOf(R, 'Book the gas refill')) === 'g-soon', await groupOf(R, 'Book the gas refill'));
  const sub = await rowOf(R, 'Book the gas refill').textContent();
  ok('saying who it is for, when, and that it waits for Meera', /for Papa/.test(sub) && /Tomorrow, 10:00/i.test(sub) && /Waiting for Meera to say yes/.test(sub), sub);
}

// ---- 2. Meera: it needs her yes
{
  await reload(M);
  ok('on Meera\'s phone it is under Needs attention', (await groupOf(M, 'Book the gas refill')) === 'g-need');
  ok('the Care tab shows one thing waiting for her', (await M.textContent('#care-dot')).trim() === '1');
  await rowOf(M, 'Book the gas refill').locator('[data-tack]').click();
  await M.waitForTimeout(900);
  ok('she says yes: it is hers', (await task('Book the gas refill')).status === 'claimed');
  ok('and it moves out of Needs attention', (await groupOf(M, 'Book the gas refill')) === 'g-soon');
  ok('with "You have it"', /You have it/.test(await rowOf(M, 'Book the gas refill').textContent()));
}

// ---- 3. Meera finishes it, with a note
{
  await rowOf(M, 'Book the gas refill').locator('[data-tdone]').click();
  await M.waitForTimeout(300);
  ok('Done opens the task, asking for an optional note', await M.isVisible('#tsheet') && await M.isVisible('#ts-note'));
  ok('the task shows what done means', /Delivery date confirmed by the agency/.test(await M.textContent('#ts-facts')));
  await M.fill('#ts-note', 'Delivery on Thursday, receipt in the blue folder');
  await M.click('#ts-done-go');
  await M.waitForTimeout(1000);
  const t = await task('Book the gas refill');
  ok('it is done, by Meera, with her note', t.status === 'done' && t.completed_by === meera.id && t.completion_note === 'Delivery on Thursday, receipt in the blue folder');
  ok('the sheet now says Done', (await M.textContent('#ts-state')) === 'Done');
  await M.click('#ts-x');
}

// ---- 4. Rohan sees it done, and its story
{
  await reload(R);
  ok('Rohan sees it under Done in the last few days', (await groupOf(R, 'Book the gas refill')) === 'g-done');
  await R.click('#g-done');
  ok('done by Meera', /Done by Meera/.test(await rowOf(R, 'Book the gas refill').textContent()));
  await rowOf(R, 'Book the gas refill').locator('.tlink').click();
  await R.waitForTimeout(700);
  const facts = await R.textContent('#ts-facts');
  ok('the task shows her note', /receipt in the blue folder/.test(facts));
  const hist = await R.textContent('#ts-hist');
  ok('and what happened, in order', /Rohan added it[\s\S]*Rohan gave it to Meera[\s\S]*Meera said yes[\s\S]*Meera finished it/.test(hist), hist.slice(0, 200));
  await R.click('#ts-actions [data-ts="reopen"]');
  await R.waitForTimeout(900);
  ok('Rohan reopens it: it is Meera\'s again, not done', (await task('Book the gas refill')).status === 'claimed');
  ok('and the history says so', /Rohan reopened it/.test(await R.textContent('#ts-hist')));
  await R.click('#ts-x');
  ok('Escape and ✕ close the task; the list is there behind it', !(await R.isVisible('#tsheet')) && await R.isVisible('#rlist'));
}

// ---- 5. A task that ran late: Needs attention, the next step, told once
{
  const early = localDay(Date.now() - 86400000);   // yesterday: late at any hour this runs
  await R.fill('#r-title', 'Pay the electricity bill');
  await R.selectOption('#r-for', 'any');
  await R.fill('#r-date', early);
  await R.fill('#r-time', '18:00');
  await R.click('#r-add');
  await R.waitForTimeout(900);
  await Promise.all([reload(R), reload(M)]);
  // Written down after its time: it shows as late, but nobody is woken.
  ok('a task written down after its time wakes nobody', (await admin.query(`select count(*)::int as n from events where text like 'Running late%electricity%'`)).rows[0].n === 0);
  // It runs late after it was set (as if set yesterday morning for the evening).
  await admin.query(`update requests set overdue_alerted_for = null, due_at = now() - interval '2 minutes' where title = 'Pay the electricity bill'`);
  await Promise.all([reload(R), reload(M)]);
  ok('a task past its time is under Needs attention', (await groupOf(M, 'Pay the electricity bill')) === 'g-need');
  ok('marked as running late', /running late/.test(await rowOf(M, 'Pay the electricity bill').textContent()));
  ok('with a next step right there: I\'m on it', await rowOf(M, 'Pay the electricity bill').locator('[data-tack]').isVisible());
  const alerts = (await admin.query(`select count(*)::int as n from events where text like 'Running late%electricity%'`)).rows[0].n;
  ok('two phones opened: the family was told exactly once', alerts === 1, alerts);
  await rowOf(R, 'Pay the electricity bill').locator('.tlink').click();
  await R.waitForTimeout(600);
  ok('opened, it says what to do next', await R.isVisible('#ts-late') && /Nobody has it yet|new time/.test(await R.textContent('#ts-late')));
  ok('and its history records the alert', /Running late - the family was told/.test(await R.textContent('#ts-hist')));
  await R.keyboard.press('Escape');
  ok('Escape closes it', !(await R.isVisible('#tsheet')));
  ok('Home says what needs attention', /need(s)? attention/.test(await R.textContent('#w-rem')), await R.textContent('#w-rem'));
}

// ---- 6. A daily task: done today, back tomorrow at the same time
{
  await M.fill('#r-title', 'Evening walk with Papa');
  await M.selectOption('#r-for', '');
  await M.fill('#r-date', localDay(Date.now()));
  await M.fill('#r-time', '00:05');
  await M.click('#r-seg [data-rep="daily"]');
  await M.click('#r-add');
  await M.waitForTimeout(900);
  const first = await task('Evening walk with Papa');
  ok('a daily task of her own is hers straight away', first && first.status === 'claimed' && first.recurrence === 'daily' && first.claimed_by === meera.id);
  await reload(M);
  await rowOf(M, 'Evening walk with Papa').locator('[data-tdone]').click();
  await M.waitForTimeout(300);
  await M.click('#ts-done-go');
  await M.waitForTimeout(1000);
  const all = (await admin.query(`select * from requests where title = 'Evening walk with Papa' order by due_at`)).rows;
  ok('done: one next time is made', all.length === 2 && all[0].status === 'done' && all[1].status === 'claimed', all.length);
  const next = all[1] && new Date(all[1].due_at);
  const hm = next && new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(next);
  ok('tomorrow at 00:05 at home', next && localDay(next.getTime()) === tomorrow && hm === '00:05', next && next.toISOString());
  await M.click('#ts-x');
  await reload(M);
  const where = await M.evaluate(() => [...document.querySelectorAll('#rlist .crow')].filter(r => r.textContent.includes('Evening walk')).length);
  ok('the list shows the next one and the finished one', where === 2, where);
}

// ---- 7. Only the right buttons
{
  await reload(R);
  const row = rowOf(R, 'Book the gas refill');
  ok('Rohan has no Done button on a task Meera holds', (await row.locator('[data-tdone]').count()) === 0);
  await row.locator('.tlink').click();
  await R.waitForTimeout(500);
  const acts = await R.$$eval('#ts-actions [data-ts]', b => b.map(x => x.getAttribute('data-ts')));
  ok('but, as the one who asked, he can close, hand over, change or put it away', ['done', 'give', 'edit', 'archive'].every(k => acts.includes(k)) && !acts.includes('decline'), acts.join());
  await R.click('#ts-actions [data-ts="give"]');
  await R.selectOption('#ts-give-to', papa.id);
  await R.click('#ts-give-go');
  await R.waitForTimeout(900);
  const t = await task('Book the gas refill');
  ok('he gives it to Papa, who is asked to say yes', t.status === 'assigned' && t.claimed_by === papa.id);
  await R.click('#ts-x');
}

if (process.env.SHOTS) {
  await reload(R); await R.screenshot({ path: process.env.SHOTS + '/care-list.png', fullPage: true });
  await rowOf(R, 'Pay the electricity bill').locator('.tlink').click(); await R.waitForTimeout(700);
  await R.screenshot({ path: process.env.SHOTS + '/care-sheet.png' });
  await R.click('#ts-x');
  const W = await phone(rohan, { width: 1280, height: 860 });
  await W.screenshot({ path: process.env.SHOTS + '/care-wide.png' });
}
ok('no script errors on either phone', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`care.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`care.e2e: ${pass}/${pass} checks pass`);
