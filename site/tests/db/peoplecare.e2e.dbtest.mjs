// TO DO AND PEOPLE, END TO END: a real browser, the real API and a real
// PostgreSQL. From the page-by-page review: a time already gone made a task
// late at once and woke the family; the add form kept last time's choices;
// a task not yet agreed showed six buttons; Suggested could not be waved
// away or filled; People buried who was waiting under a card per person;
// the profile sheet was not a dialog and called people "senior mode".
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('peoplecare.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('peoplecare.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('peoplecare.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

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


async function phone(who, { scheme = 'light', width = 390, hash = '', tz, fixedTime } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', colorScheme: scheme, ...(tz ? { timezoneId: tz } : {}) });
  if (fixedTime) await ctx.clock.setFixedTime(new Date(fixedTime));
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
  await HANDLERS[name]({ method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.6.0.' + (++n) }, query, body }, res);
  return { ...out, http: st };
};
const U = { Rohan: await user('Rohan') };
const made = await call('circle', { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Rohan', circleName: 'Sachdeva Family', userId: U.Rohan.userId, relation: 'son' }, {}, 'POST', U.Rohan.token);
const code = made.code; U.Rohan.memberId = made.memberId;
await admin.query(`update circles set join_policy = 'open' where code = $1`, [code]);
for (const [name, rel] of [['Papa', 'family'], ['Priya', 'daughter-in-law']]) {
  U[name] = await user(name);
  U[name].memberId = (await call('circle', { action: 'join', code, memberName: name, userId: U[name].userId, relation: rel }, {}, 'POST', U[name].token)).memberId;
}
await admin.query(`update members set role = 'parent', phone = '+919811111111' where id = $1`, [U.Papa.memberId]);
await admin.query(`update circles set join_policy = 'approve' where code = $1`, [code]);
const as = (name) => ({ ...U[name], code, circleName: 'Sachdeva Family' });

// ---- To do: a time that has passed means tomorrow, and the form resets
const R = await phone(as('Rohan'), { hash: '#care' });
await R.waitForTimeout(800);
const past = new Date(Date.now() - 2 * 3600000); const hh = String(past.getHours()).padStart(2, '0') + ':' + String(past.getMinutes()).padStart(2, '0');
await R.fill('#r-title', "Papa's tablets");
await R.fill('#r-time', hh);
await R.click('#r-seg [data-rep="daily"]');
await R.click('#r-more summary').catch(() => {});
await R.selectOption('#r-about', U.Papa.memberId).catch(() => {});
await R.click('#r-add'); await R.waitForTimeout(1200);
const tb = (await admin.query(`select due_at, overdue_alerted_for from requests where title = $1`, ["Papa's tablets"])).rows[0];
ok('a time that already went by today is set for tomorrow', tb && new Date(tb.due_at) > new Date(), JSON.stringify(tb));
ok('so nobody is told it is running late', (await admin.query(`select count(*)::int as n from events where text like 'Running late%tablets%'`)).rows[0].n === 0);
ok('the form goes back to Once, anyone, the whole family', await R.$eval('#r-seg .sel', b => b.dataset.rep) === 'once' && await R.$eval('#r-for', s => s.value) === 'any' && await R.$eval('#r-about', s => s.value) === '');
ok('options read as sentences', (await R.textContent('#r-for')).includes('Anyone in the family'));
ok('with nobody given it, a late task tells everyone, and says so', /Everyone \(nobody has it yet\)/.test(await R.textContent('#r-esc')));
{
  // Where clocks go back overnight, "9:00" written in the afternoon is 9:00
  // on tomorrow's clock, not 24 hours on (which would read 8:00).
  const NY = await phone(as('Rohan'), { hash: '#care', tz: 'America/New_York', fixedTime: '2026-10-31T19:00:00Z' });
  await NY.fill('#r-title', 'Water the plants'); await NY.fill('#r-time', '09:00'); await NY.click('#r-add');
  await NY.waitForFunction(() => document.querySelector('#r-title').value === '', null, { timeout: 10000 }).catch(() => {});
  const wp = (await admin.query(`select due_at from requests where title = 'Water the plants'`)).rows[0];
  ok('across a clock change, tomorrow 9:00 stays 9:00', wp && new Date(wp.due_at).toISOString() === '2026-11-01T14:00:00.000Z', wp && new Date(wp.due_at).toISOString());
  await admin.query(`delete from requests where title = 'Water the plants'`);
  await NY.context().close();
}

// ---- a task given to Priya: before she says yes, one decision
await call('care', { action: 'task_create', code, memberId: U.Rohan.memberId, title: 'Book the gas', ownerId: U.Priya.memberId }, {}, 'POST', U.Rohan.token);
const P = await phone(as('Priya'), { hash: '#care' });
await P.waitForTimeout(900);
const taskId = (await admin.query(`select id from requests where title = 'Book the gas'`)).rows[0].id;
await P.evaluate((id) => { document.querySelector('[data-topen="' + id + '"]') ? document.querySelector('[data-topen="' + id + '"]').click() : null; }, taskId);
await P.waitForTimeout(400);
const acts = await P.$$eval('#ts-actions [data-ts], #ts-actions a', bs => bs.map(b => b.textContent));
ok('asked and not yet agreed: Yes, I can\'t, or talk - nothing more', acts.join('|') === 'Yes, I’ll do it|I can’t - hand it back|💬 Talk about it', acts.join('|'));

// ---- late, for the one who asked: Set a new time, and a call
await admin.query(`update requests set status = 'claimed', due_at = now() - interval '1 hour', overdue_alerted_for = now() - interval '1 hour' where id = $1`, [taskId]);
await admin.query(`update members set phone = '+919822222222' where id = $1`, [U.Priya.memberId]);
await R.reload(); await R.waitForTimeout(1200);
await R.evaluate((id) => { const b = document.querySelector('[data-topen="' + id + '"]'); if (b) b.click(); }, taskId);
await R.waitForTimeout(400);
const late = await R.$$eval('#ts-actions [data-ts], #ts-actions a', bs => bs.map(b => b.textContent + (b.className.includes('go') ? '*' : '')));
ok('late, for the person who asked: Set a new time first, and Call Priya', late[0] === 'Set a new time*' && late.some(x => /Call Priya/.test(x)), late.join('|'));
await R.click('#ts-actions [data-ts="edit"]'); await R.waitForTimeout(200);
await R.selectOption('#ts-e-about', U.Papa.memberId);
await R.click('#ts-e-save'); await R.waitForTimeout(900);
ok('For whom can be changed', (await admin.query(`select about_member from requests where id = $1`, [taskId])).rows[0].about_member === U.Papa.memberId);
await R.click('#ts-x').catch(() => {});

// ---- Suggested: fill a gap now, or wave it away
await R.evaluate(() => { location.hash = '#care'; }); await R.click('#care-seg [data-sec="req"]').catch(() => {}); await R.waitForTimeout(600);
const sug = await R.textContent('#sugglist');
ok('a gap offers Fill it now, and Not needed', /Fill it now/.test(sug) && /Not needed/.test(sug), sug.slice(0, 200));
{
  const v = await R.$$eval('#sugglist .crow', rs => rs.filter(r => r.checkVisibility()).length);
  const all = await R.$$eval('#sugglist .crow', rs => rs.length);
  ok('three suggestions at a time, the rest one tap away', v === Math.min(3, all) && (all <= 3 || await R.isVisible('#sugg-more summary')), v + ' of ' + all);
}
await R.click('#sugglist [data-snot]'); await R.waitForTimeout(200);
const n1 = await R.$$eval('#sugglist [data-snot]', x => x.length);
await R.reload(); await R.waitForTimeout(1200); await R.evaluate(() => { location.hash = '#care'; }); await R.click('#care-seg [data-sec="req"]').catch(() => {}); await R.waitForTimeout(500);
ok('Not needed stays gone', (await R.$$eval('#sugglist [data-snot]', x => x.length)) === n1);
await R.click('#sugglist [data-sfill]'); await R.waitForTimeout(600);
ok('Fill it now opens the form already set for that gap', await R.isVisible('#pane-memory') && !!(await R.$eval('#b-about', s => s.value)));

// ---- People in order of use; one line per person looked after
U.Kabir = await user('Kabir');
await call('circle', { action: 'join', code, memberName: 'Kabir', userId: U.Kabir.userId, relation: 'grandson' }, {}, 'POST', U.Kabir.token);
await R.reload(); await R.waitForTimeout(800);
await R.evaluate(() => { location.hash = '#people'; }); await R.waitForTimeout(1500);
await R.waitForSelector('#joinreqs [data-jok]', { timeout: 15000 }).catch(() => {});
const order = await R.evaluate(() => ['joinreq-card', 'famcard', 'prepcard', 'loc-card', 'treecard'].map(id => document.getElementById(id).getBoundingClientRect().top));
ok('People runs: who is waiting, the family itself, how ready, where everyone is, the tree last', await R.isVisible('#joinreq-card') && order.every((t, i) => !i || order[i - 1] < t), order.join());
if (process.env.PC_SHOT_DIR) { await R.screenshot({ path: process.env.PC_SHOT_DIR + '/people-light.png', fullPage: false }); await R.emulateMedia({ colorScheme: 'dark' }); await R.locator('#prepcard').screenshot({ path: process.env.PC_SHOT_DIR + '/prep-dark.png' }); await R.emulateMedia({ colorScheme: 'light' }); }
ok('the waiting person says what they say they are', /says they are: grandson/.test(await R.textContent('#joinreqs')), await R.textContent('#joinreqs'));
const prep = await R.$$eval('#preplist .crow', rs => rs.map(r => r.textContent));
ok('how ready: one line for Papa, the elder, with what is missing', prep.length === 1 && /Papa/.test(prep[0]) && /to complete/.test(prep[0]), prep.join(' / '));
{
  // On a slow connection the papers can arrive before the family list: the
  // card is drawn again once it is known whom the family looks after.
  const slow = await phone(as('Rohan'), { hash: '#people' });
  await slow.route('**/api/events*', async r => { await new Promise(x => setTimeout(x, 2500)); r.continue(); });
  await slow.reload(); await slow.waitForTimeout(4500);
  const p2 = await slow.$$eval('#preplist .crow', rs => rs.map(r => r.textContent));
  ok('even when the papers arrive before the family list, only Papa is listed', p2.length === 1 && /Papa/.test(p2[0]), p2.join(' / '));
  await slow.context().close();
}
await R.click('#joinreqs [data-jok]'); await R.waitForTimeout(2500);
const kabirId = (await admin.query(`select id from members where name = 'Kabir'`)).rows[0].id;
ok('after letting him in, the tree form is ready to place him', await R.$eval('#tr-who', s => s.value) === kabirId);
// Papa joined as "family": the tree asks his he or she before it can say Father.
await R.click('#tr-gender [data-g="m"]'); await R.selectOption('#tr-place', 'child'); await R.selectOption('#tr-of', U.Papa.memberId);
ok('the tree asks whether Papa is he or she, since nobody said', await R.isVisible('#tr-ofg-wrap'));
await R.click('#tr-go'); await R.waitForTimeout(400);
ok('and will not guess', /Papa he or she/.test(await R.textContent('#tr-err')));
ok('and Add still works once it is answered', !(await R.$eval('#tr-go', b => b.disabled)));
// An answer about Papa is not kept for someone else.
await R.click('#tr-ofg [data-g="f"]');
await R.selectOption('#tr-of', U.Priya.memberId); await R.selectOption('#tr-of', U.Papa.memberId);
ok('choosing another person clears the he or she said about the last one', (await R.$$eval('#tr-ofg .sel', x => x.length)) === 0);
await R.click('#tr-ofg [data-g="m"]'); await R.click('#tr-go'); await R.waitForTimeout(1500);
ok('his answer is kept', (await admin.query('select gender from members where id = $1', [U.Papa.memberId])).rows[0].gender === 'm');

// ---- the member sheet: a dialog, plain words, Call first
await R.click('#members [data-mprof="' + U.Priya.memberId + '"]').catch(async () => { await R.click('[data-mprof="' + U.Priya.memberId + '"]'); });
await R.waitForTimeout(300);
ok('the profile is a dialog with focus on Close', await R.getAttribute('#msheet', 'role') === 'dialog' && await R.evaluate(() => document.activeElement && document.activeElement.id === 'mp-x'));
ok('it calls her by the family word only', !/admin|senior/i.test(await R.textContent('#mp-role')));
const firstBtn = await R.$eval('#msheet .prow2 > :not([hidden])', b => b.textContent);
ok('Call comes first', /Call/.test(firstBtn), firstBtn);
await R.keyboard.press('Escape'); await R.waitForTimeout(200);
ok('Escape closes it', await R.isHidden('#msheet'));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`peoplecare.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`peoplecare.e2e: ${pass}/${pass} checks pass`);
