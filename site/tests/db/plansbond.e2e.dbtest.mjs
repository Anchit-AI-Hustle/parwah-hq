// CLOSER TOGETHER, END TO END: real browsers, the real API handlers and a
// real PostgreSQL. What a family and a group meet:
//
//   - Rohan's Today: "Add to Chachu's birthday card". Chachu's Today: nothing.
//     Rohan writes a line. On the day, Chachu opens his card, in big text
//     with "Read the lines aloud" in senior mode.
//   - Rohan asks the family for a date; Papa (senior mode) answers from
//     Today; Rohan locks it; the plan shows who brings what and Papa takes
//     the sweets; Rohan adds a story to read aloud on the call.
//   - The family picks its festivals; 14 days before one, Today offers
//     "Plan it together", which makes the plan.
//   - Maa and Papa's anniversary, set once on Papa's page, shows on Maa's.
//   - The group: Asha says she is in Pune; Vikram taps "Let's meet" and a
//     date poll opens on her dates. Quiz night is offered to the group only.
//
// Every new screen is measured: 44px targets, a 12px floor, WCAG AA in light
// and dark, nothing sideways at 320 and 390. With BOND_SHOT_DIR set, each is
// saved at 390 and 1440, light and dark.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('plansbond.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('plansbond.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('plansbond.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const T = await import('../../../api/_tyohaar.mjs');
await ensureSchema(db());

let n = 0;
async function person(circleId, code, circleName, name, role = 'family') {
  const phone = '+9198611' + String(++n).padStart(5, '0');
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
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.1.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
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
const SHOTS = process.env.BOND_SHOT_DIR;
async function shotAll(page, name, full){
  if (!SHOTS) return;
  const was = page.viewportSize();
  for (const w of [390, 1440]) for (const sc of ['light', 'dark']) {
    await page.setViewportSize({ width: w, height: 900 }); await page.emulateMedia({ colorScheme: sc });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${w}-${sc}.png`, fullPage: !!full });
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
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
  await page.waitForTimeout(1500);
  return page;
}
const go = async (P, hash) => { await P.evaluate(h => { location.hash = h; }, hash); await P.waitForTimeout(900); };
const reload = async (P) => { await P.reload(); await P.waitForTimeout(1500); };

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
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) return;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) out.bad.push('small ' + (el.id || el.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
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
  const was = page.viewportSize(); const bad = [];
  for (const [wd, sc] of [[320, 'light'], [390, 'light'], [390, 'dark'], [320, 'dark']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc }); await page.waitForTimeout(150);
    const m = await page.evaluate(measureIn, sel);
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
  ok('design: ' + label + ' - 44px targets, 12px floor, AA in both themes, nothing sideways at 320/390', bad.length === 0, bad.slice(0, 6).join(' | '));
}
const dayPlus = (k) => { const d = new Date(Date.now() + 5.5 * 3600000 + k * 86400000); return d.toISOString().slice(0, 10); };

// ---- a family and a group
const fam = (await admin.query(`insert into circles (code, name, kind) values ('KAPOOR','Kapoor Family','family') returning id`)).rows[0].id;
const rohan = await person(fam, 'KAPOOR', 'Kapoor Family', 'Rohan');
const chachu = await person(fam, 'KAPOOR', 'Kapoor Family', 'Chachu');
const papa = await person(fam, 'KAPOOR', 'Kapoor Family', 'Papa', 'parent');
const maa = await person(fam, 'KAPOOR', 'Kapoor Family', 'Maa', 'parent');
await admin.query(`update members set dob = $1 where id = $2`, ['1975' + dayPlus(3).slice(4), chachu.id]);
const grp = (await admin.query(`insert into circles (code, name, kind) values ('YAARON','College friends','group') returning id`)).rows[0].id;
const asha = await person(grp, 'YAARON', 'College friends', 'Asha');
const vik = await person(grp, 'YAARON', 'College friends', 'Vikram');
// A made-up festival 10 days away, so the test does not depend on the calendar.
T.FESTIVALS.push({ key: 'testfest', name: 'Test Festival', icon: '🎉', dates: [dayPlus(10)] });

// ================================================================ 1. the card
const R = await phone(rohan);
await R.waitForSelector('#bond-today .crow', { timeout: 8000 }).catch(() => {});
const rToday = await R.textContent('#bond-today');
ok('Rohan\'s Today: "Add to Chachu\'s birthday card", a surprise', /Add to Chachu's birthday card/.test(rToday) && /surprise/.test(rToday), rToday);
const C = await phone(chachu);
ok('Chachu\'s Today does not give it away', !/Chachu's birthday/.test(await C.textContent('#bond-today')) && !/card/i.test(await C.textContent('#bond-today')));
await design(R, '#bond-today', 'Today cards');
await shotAll(R, 'today-card');
await R.click('#bond-today [data-bcopen]'); await R.waitForTimeout(900);
ok('the card opens in a sheet', await R.isVisible('#bondsheet') && /Chachu's birthday/.test(await R.textContent('#bs-title')));
ok('it says Chachu sees it on the day, not before', /will see it on the day, not before/.test(await R.textContent('#bs-body')));
await R.fill('#bcv-text', 'Happy birthday Chachu! Thank you for the cricket lessons.');
await R.click('#bcv-send'); await R.waitForTimeout(1300);
const ent = (await admin.query(`select e.text from card_entries e join cards c on c.id = e.card_id where c.for_member = $1`, [chachu.id])).rows;
ok('Rohan\'s line is on the card', ent.length === 1 && /cricket/.test(ent[0].text));
ok('and shows in the sheet, with a voice note and a photo on offer', /cricket lessons/.test(await R.textContent('#bcv-entries')) && await R.isVisible('#bcv-rec') && await R.isVisible('#bcv-photo-btn'));
await design(R, '#bondsheet .mp', 'the card sheet');
await shotAll(R, 'card-sheet');
await R.click('#bs-x'); await R.waitForTimeout(200);
ok('the sheet closes', !(await R.isVisible('#bondsheet')));

// ================================================================ 2. date poll
await go(R, '#fun'); await R.waitForTimeout(600);
await R.click('#bp-open'); await R.waitForTimeout(300);
ok('"Not sure of the date?" opens the poll with 2 dates to start', (await R.$$('#bp-opts .pickrow')).length === 2 && /Ask the family/.test(await R.textContent('#bp-send')));
await R.click('#bp-send'); await R.waitForTimeout(300);
ok('an empty poll is refused under the form, not in a toast', await R.isVisible('#bp-err') && /name/.test(await R.textContent('#bp-err')));
await R.fill('#bp-title', 'Sunday lunch');
const dIn = (k) => dayPlus(k);
const rowsIn = await R.$$('#bp-opts .bp-d');
await rowsIn[0].fill(dIn(4)); await rowsIn[1].fill(dIn(5));
await R.click('#bp-more'); await R.waitForTimeout(100);
await (await R.$$('#bp-opts .bp-d'))[2].fill(dIn(6));
await R.fill('#bp-items', 'sweets, plates, a speaker');
await design(R, '#bondsheet .mp', 'the poll sheet');
await shotAll(R, 'poll-sheet');
await R.click('#bp-send'); await R.waitForTimeout(1500);
const poll = (await admin.query(`select p.id, p.items, (select count(*)::int from plan_options o where o.poll_id = p.id) as n from plan_polls p where title = 'Sunday lunch'`)).rows[0];
ok('the poll is asked with three dates and a list', poll && poll.n === 3 && poll.items.length === 3, JSON.stringify(poll));

const P = await phone(papa, { big: true });
ok('Papa is in senior mode', await P.evaluate(() => document.body.classList.contains('senior')));
await P.waitForSelector('#bond-today [data-bpgo]', { timeout: 8000 }).catch(() => {});
ok('Papa\'s Today: "Rohan asks: which date?"', /Rohan asks: which date\?/.test(await P.textContent('#bond-today')));
await design(P, '#bond-today', 'Today cards, senior mode');
await P.click('#bond-today [data-bpgo]'); await P.waitForTimeout(1500);
ok('Answer takes him to the poll', await P.isVisible('#bpoll-' + poll.id));
await P.click(`#bpoll-${poll.id} .opt:first-of-type [data-bpv$="|yes"]`); await P.waitForTimeout(1200);
const v = (await admin.query(`select answer from plan_votes where member_id = $1`, [papa.id])).rows;
ok('Papa says Yes to the first date', v.length === 1 && v[0].answer === 'yes');
ok('his answer shows as chosen', await P.$eval(`#bpoll-${poll.id} .opt:first-of-type [data-bpv$="|yes"]`, b => b.getAttribute('aria-pressed') === 'true'));
await design(P, '#bond-polls', 'the poll, senior mode');

await reload(R); await go(R, '#fun'); await R.waitForTimeout(1200);
ok('Rohan sees the count and who said yes', /1 yes \(Papa\)/.test(await R.textContent('#bpoll-' + poll.id)), await R.textContent('#bpoll-' + poll.id));
await design(R, '#bond-polls', 'the poll');
await shotAll(R, 'poll');
await R.click(`#bpoll-${poll.id} .opt:first-of-type [data-bplock]`); await R.waitForTimeout(300);
await R.click('#as-yes'); await R.waitForTimeout(2000);
const plan = (await admin.query(`select id, going from plans where title = 'Sunday lunch'`)).rows[0];
ok('locking makes the plan, with Papa going', plan && plan.going.includes(papa.id) && plan.going.includes(rohan.id));

// ---- who brings what
await reload(P); await go(P, '#fun'); await P.waitForTimeout(1500);
const plistP = await P.textContent('#plist');
ok('the plan shows who brings what, all still open', /Who brings what · 3 still open/.test(plistP) && /sweets/.test(plistP), plistP.slice(0, 300));
await P.click('#plist [data-biclaim]'); await P.waitForTimeout(1500);
ok('Papa takes the sweets', (await admin.query(`select claimed_by from plan_items where label = 'sweets'`)).rows[0].claimed_by === papa.id);
ok('the list says so', /You bring it/.test(await P.textContent('#plist')));
await design(P, '#plist', 'the plan with its list, senior mode');

// ---- something to do together
await reload(R); await go(R, '#fun'); await R.waitForTimeout(1500);
ok('Papa\'s sweets show on Rohan\'s plan', /Papa brings it/.test(await R.textContent('#plist')));
await R.click('#plist [data-baset]'); await R.waitForTimeout(300);
const kinds = await R.$$eval('#ba-kinds [data-bak]', bs => bs.map(b => b.getAttribute('data-bak')).join());
ok('a family gets story, cooking, Antakshari and photos (no quiz)', kinds === 'story,cook,antakshari,photos', kinds);
await R.click('#ba-kinds [data-bak="story"]'); await R.waitForTimeout(150);
await R.selectOption('#ba-note', 'monkey');
await design(R, '#bondsheet .mp', 'something to do together');
await R.click('#ba-save'); await R.waitForTimeout(1500);
ok('the story is on the plan', (await admin.query(`select activity, activity_note from plans where id = $1`, [plan.id])).rows[0].activity_note === 'monkey');
await reload(P); await go(P, '#fun'); await P.waitForTimeout(1500);
ok('Papa sees it on the plan', /Read a story aloud/.test(await P.textContent('#plist')));
await P.click('#plist [data-baview]'); await P.waitForTimeout(400);
const fs = await P.$eval('#ba-story', el => parseFloat(getComputedStyle(el).fontSize));
ok('the story is shown large for everyone (24px in senior mode)', /monkey and the crocodile/i.test(await P.textContent('#ba-story')) && fs >= 23.9, fs);
ok('with Read it aloud, started by a tap', await P.isVisible('[data-bspeak="story"]'));
await design(P, '#bondsheet .mp', 'the story, senior mode');
await shotAll(P, 'story-senior');
await P.click('#bs-x');

// ================================================================ 3. festivals
await go(R, '#fun'); await R.waitForTimeout(400);
ok('festivals: nothing chosen until the family picks', (await R.$$('#bf-chips .sel')).length === 0 && (await R.$$('#bf-chips [data-bfk]')).length === 22);
ok('the region note is shown', /differ by a day by region/.test(await R.textContent('#bf-note')));
// One tap adds one festival, saved at once (Nov 2026): there is no "save the whole list" any more.
for (const k of ['testfest', 'diwali']) {
  await R.click('#bf-chips [data-bfk="' + k + '"]');
  await R.waitForFunction((key) => { const b = document.querySelector('#bf-chips [data-bfk="' + key + '"]'); return !!b && b.classList.contains('sel'); }, k, { timeout: 8000 });
  for (let i = 0; i < 40 && !(await admin.query('select 1 from circle_festivals where fkey = $1', [k])).rows.length; i++) await R.waitForFunction(() => true);
}
ok('the family keeps its pick', (await admin.query(`select fkey from circle_festivals order by fkey`)).rows.map(r => r.fkey).join() === 'diwali,testfest');
await design(R, '#bond-cards', 'the cards list');
await design(R, '#bond-fests', 'the festivals picker');
await shotAll(R, 'together', true);
await go(R, '#home'); await reload(R);
await R.waitForSelector('#bond-today [data-bfkit]', { timeout: 8000 }).catch(() => {});
ok('14 days before: "Plan Test Festival together" on Today', /Plan Test Festival together/.test(await R.textContent('#bond-today')));
await R.click('#bond-today [data-bfkit^="testfest"]'); await R.waitForTimeout(2000);
const fp = (await admin.query(`select id, room from plans where festival = 'testfest'`)).rows;
ok('one tap makes the plan, with a video room', fp.length === 1 && /meet\.jit\.si/.test(fp[0].room));
ok('and lands on it', await R.isVisible('#pane-fun') && /Test Festival together/.test(await R.textContent('#plist')));

// ================================================================ 2b. anniversary
await R.evaluate((id) => { const b = document.createElement('button'); b.setAttribute('data-person', id); document.body.appendChild(b); b.click(); b.remove(); }, papa.id);
await R.waitForTimeout(1200);
ok('Papa\'s page has an anniversary card', await R.isVisible('#pp-anniv-card') && /Not added/.test(await R.textContent('#pa-now')));
await R.click('#pa-edit summary');
await R.selectOption('#pa-with', maa.id);
await R.fill('#pa-date', '1980-02-14');
await design(R, '#pp-anniv-card', 'the anniversary card');
await R.click('#pa-save'); await R.waitForTimeout(1500);
ok('saved for both of them', (await admin.query(`select count(*)::int as n from members where anniversary = '1980-02-14'`)).rows[0].n === 2);
await R.evaluate((id) => { const b = document.createElement('button'); b.setAttribute('data-person', id); document.body.appendChild(b); b.click(); b.remove(); }, maa.id);
await R.waitForTimeout(900);
ok('Maa\'s page shows the same day, married to Papa', /Married to Papa, on (14 February 1980|February 14, 1980)/.test(await R.textContent('#pa-now')), await R.textContent('#pa-now'));
await shotAll(R, 'anniversary');

// ================================================================ the card on the day
await admin.query(`update cards set date = $1 where for_member = $2`, [dayPlus(0), chachu.id]);
const C2 = await phone(chachu, { big: true });
await C2.waitForSelector('#bond-today [data-bcopen]', { timeout: 8000 }).catch(() => {});
ok('ON THE DAY: Chachu\'s Today says the family made him a card', /Your family made you a card/.test(await C2.textContent('#bond-today')));
await C2.click('#bond-today [data-bcopen]'); await C2.waitForTimeout(1000);
ok('with every line', /cricket lessons/.test(await C2.textContent('#bcv-entries')) && /From Rohan/.test(await C2.textContent('#bcv-entries')));
ok('senior mode: big lines, and "Read the lines aloud" for him to start', await C2.isVisible('[data-bspeak="card"]')
   && (await C2.$eval('.bondline', el => parseFloat(getComputedStyle(el).fontSize))) >= 19.9);
ok('nothing to add to his own card', !(await C2.isVisible('#bcv-send')));
await design(C2, '#bondsheet .mp', 'my card on the day, senior mode');
await shotAll(C2, 'my-card-senior');

// ================================================================ 5. the group
const A = await phone(asha, { hash: '#fun' });
await A.waitForTimeout(800);
ok('a group sees "I\'m in town"', await A.isVisible('#bond-town'));
const famTown = await R.evaluate(() => document.getElementById('bond-town').hidden);
ok('a family does not', famTown === true);
await A.fill('#bt-city', 'Pune'); await A.fill('#bt-from', dayPlus(2)); await A.fill('#bt-to', dayPlus(4));
await A.click('#bt-post'); await A.waitForTimeout(1300);
ok('Asha posts a city and two dates', (await admin.query(`select city from in_town`)).rows[0]?.city === 'Pune');
ok('the group wording is used', /Ask the group/.test(await A.textContent('#bp-open')));
await design(A, '#bond-town', 'I\'m in town');
await shotAll(A, 'in-town', true);
const V = await phone(vik);
await V.waitForSelector('#bond-today [data-btmeet]', { timeout: 8000 }).catch(() => {});
ok('Vikram\'s Today: "Asha is in Pune"', /Asha is in Pune/.test(await V.textContent('#bond-today')));
await V.click('#bond-today [data-btmeet]'); await V.waitForTimeout(400);
const pre = await V.$$eval('#bp-opts .bp-d', is => is.map(i => i.value));
ok('"Let\'s meet" opens a date poll on her dates', (await V.inputValue('#bp-title')) === 'Meet Asha in Pune' && pre.join() === [dayPlus(2), dayPlus(3), dayPlus(4)].join(), pre.join());
await V.click('#bp-send'); await V.waitForTimeout(1300);
const gpoll = (await admin.query(`select id from plan_polls where title = 'Meet Asha in Pune'`)).rows;
ok('and asks the group', gpoll.length === 1);
// Quiz night is for groups: lock the poll into a plan and look.
await admin.query(`insert into plans (circle_id, by_member, title, kind, at, going) values ($1, $2, 'Friday call', 'call', now() + interval '2 days', $3)`, [grp, vik.id, '{' + vik.id + '}']);
await go(V, '#fun'); await V.waitForTimeout(1500);
await V.click('#plist [data-baset]'); await V.waitForTimeout(300);
ok('a group also gets quiz night and watch together', (await V.$$eval('#ba-kinds [data-bak]', bs => bs.map(b => b.getAttribute('data-bak')).join())) === 'story,cook,antakshari,photos,quiz,watch');
await V.click('#ba-kinds [data-bak="quiz"]'); await V.click('#ba-save'); await V.waitForTimeout(1300);
await V.click('#plist [data-baview]'); await V.waitForTimeout(300);
ok('quiz night: 10 questions, answers on a tap', (await V.$$('#bs-body .bondquiz details')).length === 10);
await design(V, '#bondsheet .mp', 'quiz night');
await shotAll(V, 'quiz');

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`plansbond.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`plansbond.e2e: ${pass}/${pass} checks pass`);
