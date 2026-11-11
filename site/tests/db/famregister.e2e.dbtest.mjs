// THE FAMILY REGISTER, END TO END: real browsers, the real API handlers and
// a real PostgreSQL. What a family meets:
//
//   - Papa opens the Vault's "Family register" (still "When I'm not here"
//     underneath). It is empty and says where to start.
//   - He adds his flat as "People I choose" and ticks Rohan. A password
//     typed into the note is refused under that box, in plain words.
//   - Rohan opens it and reads where the papers are. Meera sees only a
//     locked row: a house, Papa's, nothing else.
//   - Papa sees "Seen by Rohan" on his entry.
//   - He finds it again by search and by person, changes it to "Only me"
//     (it vanishes for Rohan and Meera), edits it, and removes it after
//     being asked.
//   - With no internet the screen says so and offers "Try again".
//
// The screen and the form are measured: 44px targets, a 12px floor, WCAG AA
// in light and dark, nothing sideways at 320 and 390. With FAMREG_SHOT_DIR
// set, each is saved at 390 and 1440, light and dark.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('famregister.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('famregister.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('famregister.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function person(circleId, code, circleName, name, role = 'family') {
  const phone = '+9198622' + String(++n).padStart(5, '0');
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
const SHOTS = process.env.FAMREG_SHOT_DIR;
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

// ---- a family of four
const fam = (await admin.query(`insert into circles (code, name, kind) values ('SHARMA','Sharma Family','family') returning id`)).rows[0].id;
const papa = await person(fam, 'SHARMA', 'Sharma Family', 'Papa', 'parent');
const rohan = await person(fam, 'SHARMA', 'Sharma Family', 'Rohan');
const meera = await person(fam, 'SHARMA', 'Sharma Family', 'Meera');
const priya = await person(fam, 'SHARMA', 'Sharma Family', 'Priya');
const SEC = '#pane-vault .subsec[data-sec="locator"]';
const openRegister = async (who, opts) => {
  const P = await phone(who, { hash: '#vault', ...(opts || {}) });
  await P.click('#vault-seg [data-sec="locator"]');
  // Until the list has been read, not for a fixed second: the very first
  // read also makes the tables, and takes as long as it takes.
  await P.waitForFunction(() => { const f = document.getElementById('locator-feed'); return f && !/Loading/.test(f.textContent); }, null, { timeout: 15000 });
  await P.waitForTimeout(300);
  return P;
};
const feed = (P) => P.textContent('#locator-feed');
const rowOf = (P, text) => P.locator('#locator-feed .frrow', { hasText: text }).first();
const dbRows = async () => (await admin.query(`select * from legacy_asset_locators order by created_at`)).rows;
const refresh = async (P) => { await P.click('#vault-seg [data-sec="docs"]'); await P.click('#vault-seg [data-sec="locator"]'); await P.waitForTimeout(1000); };

// ================================================================ 1. empty
const P = await openRegister(papa);
ok('the Vault tab is called Family register', /Family register/.test(await P.textContent('#vault-seg [data-sec="locator"]')));
ok('the screen is the family\'s register, and still says "When I\'m not here"', /Family register/.test(await P.textContent(SEC + ' .ektahead b')) && /When I'm not here/.test(await P.textContent(SEC + ' .ektahead small')));
ok('empty: it says so, with a first step', /Nothing here yet/.test(await feed(P)) && await P.isVisible('#locator-feed [data-frstart]'));
ok('empty: no search box to search nothing', !(await P.isVisible('#fr-search')));
ok('the picker groups the kinds under six plain headings', (await P.$$eval('#loc-cat optgroup', gs => gs.map(g => g.label).join('|'))) === 'Home and land|Money|Papers|Things|Online|Other'
   && (await P.$$eval('#loc-cat option', os => os.length)) === 22);
ok('four choices of who can see it, as one labelled group', (await P.$$eval('#fr-who input[type=radio]', rs => rs.map(r => r.value).join())) === 'ONLY_ME,NOMINEES_ONLY,IMMEDIATE,EMERGENCY_ONLY'
   && (await P.textContent('#fr-who legend')) === 'Who can see it'
   && (await P.$$eval('#fr-who b', bs => bs.map(b => b.textContent).join('|'))) === 'Only me|People I choose|Whole family|Only in an emergency');
await design(P, SEC, 'the empty register and its form');
await shotAll(P, 'register-empty', true);

// ================================================================ 2. add a house, for people I choose
await P.click('#locator-feed [data-frstart]'); await P.waitForTimeout(300);
ok('"Add the first one" puts the cursor in the form', await P.evaluate(() => document.activeElement && document.activeElement.id === 'loc-item'));
await P.click('#btn-add-locator'); await P.waitForTimeout(200);
ok('saving nothing says what is missing, under the box', /Say what it is/.test(await P.textContent('#loc-item-err')));
await P.fill('#loc-item', 'Flat in Indiranagar');
await P.selectOption('#loc-cat', 'HOUSE');
ok('it is about Papa himself unless he says otherwise', (await P.inputValue('#loc-about')) === papa.id);
await P.fill('#loc-notes', 'Sale deed in the steel almirah, blue file');
ok('the people picker is not shown until it is needed', !(await P.isVisible('#fr-people')));
await P.click('#fr-who label:has-text("People I choose")'); await P.waitForTimeout(150);
const pickable = await P.$$eval('#fr-people-list label', ls => ls.map(l => l.textContent.trim()).join());
ok('choosing "People I choose" shows the family to tick, without Papa himself', await P.isVisible('#fr-people') && pickable === 'Rohan,Meera,Priya', pickable);
await P.click('#btn-add-locator'); await P.waitForTimeout(250);
ok('with nobody ticked it is refused in words, and nothing is saved', /Tick at least one person/.test(await P.textContent('#fr-err')) && (await dbRows()).length === 0);
await P.click('#fr-people-list label:has-text("Rohan")');
await P.click('#fr-more summary'); await P.waitForTimeout(150);
await P.fill('#loc-mask', '482910244921');
await P.selectOption('#fr-inname', papa.id);
await P.fill('#fr-inname-text', 'jointly with Sunita Sharma');
await P.fill('#fr-nominee', 'Rohan Sharma');
await P.fill('#fr-value', '85,00,000');
await P.fill('#fr-due', '2027-03-31');
ok('the Renewals offer is only for an entry the whole family sees', !(await P.isVisible('#fr-renewwrap')));
await P.fill('#fr-note', 'Locker password: tiger@77');
await design(P, '#fr-form', 'the form, filled, with more options and the people picker open');
await shotAll(P, 'register-form', true);
await P.click('#btn-add-locator'); await P.waitForTimeout(900);
ok('a password in the note is refused under that box, with a plain reason', /never keeps a password or a PIN/.test(await P.textContent('#fr-note-err')) && (await dbRows()).length === 0, await P.textContent('#fr-form'));
await P.fill('#fr-note', 'Property tax is paid every March.');
await P.click('#btn-add-locator'); await P.waitForTimeout(1300);
let all = await dbRows();
ok('the house is saved for the people chosen, with its details', all.length === 1 && all[0].unlock_policy === 'NOMINEES_ONLY' && JSON.stringify(all[0].designated_recipients) === JSON.stringify([rohan.id])
   && all[0].asset_category === 'HOUSE' && all[0].person_id === papa.id && all[0].nominee === 'Rohan Sharma' && String(all[0].approx_value) === '8500000' && all[0].value_currency === 'INR', JSON.stringify(all[0]));
ok('the long number kept only its last 4', all[0].identifier_mask === 'Ending in ...4921', all[0].identifier_mask);
const houseId = all[0].id;
ok('the form is clear again for the next one', (await P.inputValue('#loc-item')) === '' && (await P.inputValue('#fr-note')) === '' && (await P.$eval('#fr-who input:checked', r => r.value)) === 'IMMEDIATE');
ok('Papa sees it in the list with a chip that says who sees it', /Flat in Indiranagar/.test(await feed(P)) && (await rowOf(P, 'Flat in Indiranagar').locator('.frchip').textContent()) === 'People I choose');
ok('and that nobody else has opened it yet', /Nobody else has opened this yet/.test(await rowOf(P, 'Flat in Indiranagar').textContent()));
ok('the search box is here now', await P.isVisible('#fr-search') && await P.isVisible('#fr-person'));
ok('the details are not on the page until he opens it', !/steel almirah/.test(await feed(P)));
await rowOf(P, 'Flat in Indiranagar').locator('[data-fropen]').click(); await P.waitForTimeout(900);
const mine = await feed(P);
ok('opened: where it is kept, the number, the name, nominee, value, date and note', /steel almirah/.test(mine) && /Ending in \.\.\.4921/.test(mine) && /Papa, jointly with Sunita Sharma/.test(mine)
   && /Rohan Sharma/.test(mine) && /₹85,00,000/.test(mine) && /31 Mar 2027|Mar 31, 2027/.test(mine) && /every March/.test(mine), mine);
ok('and who he chose', /Who can see it\s*Rohan/.test(mine), mine);
ok('with Edit, Change who sees it, and Remove', await P.isVisible('[data-fredit]') && await P.isVisible('[data-frshare]') && await P.isVisible('[data-frremove]'));
ok('the owner opening his own entry is not written in the log', (await admin.query('select 1 from legacy_asset_views')).rows.length === 0);

// ================================================================ 3. the chosen person opens it
const R = await openRegister(rohan);
ok('Rohan sees the house by name', /Flat in Indiranagar/.test(await feed(R)) && /House or flat · For Papa/.test(await feed(R)));
ok('but not the details, until he opens it', !/steel almirah/.test(await feed(R)));
await rowOf(R, 'Flat in Indiranagar').locator('[data-fropen]').click(); await R.waitForTimeout(900);
ok('he opens it and reads where the papers are', /steel almirah, blue file/.test(await R.textContent('#locator-feed [data-locnotes]')));
ok('he is not offered Edit, Change who sees it or Remove', !(await R.$('[data-fredit]')) && !(await R.$('[data-frshare]')) && !(await R.$('[data-frremove]')));
ok('nor told who else can see it, or who has seen it', !/Who can see it/.test(await feed(R)) && !/Seen by/.test(await feed(R)));
let seenRows = (await admin.query('select viewer_id from legacy_asset_views where locator_id = $1', [houseId])).rows;
ok('his visit is written down once', seenRows.length === 1 && seenRows[0].viewer_id === rohan.id);
await rowOf(R, 'Flat in Indiranagar').locator('[data-fropen]').click(); await R.waitForTimeout(200);
await rowOf(R, 'Flat in Indiranagar').locator('[data-fropen]').click(); await R.waitForTimeout(500);
ok('closing and opening again the same day is still one row', (await admin.query('select 1 from legacy_asset_views where locator_id = $1', [houseId])).rows.length === 1);
await design(R, '#locator-feed', 'an entry opened by someone it is shared with');

// ================================================================ 4. another member sees it locked
const M = await openRegister(meera);
const mFeed = await feed(M);
ok('Meera sees a locked row: a house, Papa\'s', /House or flat/.test(mFeed) && /For Papa/.test(mFeed) && /Only the people chosen can read this/.test(mFeed), mFeed);
ok('with no name, no number, no notes', !/Indiranagar|almirah|4921|Sunita|March|85,00,000/.test(mFeed), mFeed);
ok('and nothing to tap: the server decides', (await M.$$('#locator-feed [data-fropen]')).length === 0 && !/Unlock/.test(mFeed));
ok('the chip still says the rule', (await M.locator('#locator-feed .frchip').first().textContent()) === 'People I choose');
await design(M, '#locator-feed', 'a locked row');
await shotAll(M, 'register-locked');

// ================================================================ 5. the owner sees "Seen by"
await refresh(P);
const seenLine = await rowOf(P, 'Flat in Indiranagar').locator('[data-frseen]').textContent();
ok('Papa sees "Seen by Rohan" with the day', /^Seen by Rohan, \d{1,2} [A-Z][a-z]{2}|^Seen by Rohan, [A-Z][a-z]{2} \d{1,2}/.test(seenLine), seenLine);
ok('what he had open is still open after the refresh', /steel almirah/.test(await feed(P)));
await design(P, SEC, 'the register with an entry open, its log and its actions');
await shotAll(P, 'register-open', true);

// ================================================================ 7. find it again
await P.fill('#loc-item', 'LIC policy'); await P.selectOption('#loc-cat', 'INSURANCE');
await P.selectOption('#loc-about', meera.id);
await P.fill('#loc-notes', 'Bond in the grey box');
await P.click('#fr-more summary'); await P.fill('#fr-due', '2027-01-15'); await P.waitForTimeout(150);
ok('for a whole-family entry with a date, Renewals is offered', await P.isVisible('#fr-renewwrap'));
await P.check('#fr-renew');
await P.click('#btn-add-locator'); await P.waitForTimeout(1600);
all = await dbRows();
ok('a second entry, about Meera, for the whole family', all.length === 2 && all[1].unlock_policy === 'IMMEDIATE' && all[1].person_id === meera.id && all[1].created_by === papa.id);
const rn = (await admin.query(`select label, to_char(expires_on, 'YYYY-MM-DD') as d, about_member from renewals`)).rows;
ok('and its date is in Renewals, once', rn.length === 1 && rn[0].label === 'LIC policy' && rn[0].d === '2027-01-15' && rn[0].about_member === meera.id, JSON.stringify(rn));
await P.fill('#fr-search', 'lic'); await P.waitForTimeout(200);
ok('search by name', /LIC policy/.test(await feed(P)) && !/Indiranagar/.test(await feed(P)) && /1 of 2 shown/.test(await P.textContent('#fr-count')));
await P.fill('#fr-search', 'house'); await P.waitForTimeout(200);
ok('search by kind', /Indiranagar/.test(await feed(P)) && !/LIC policy/.test(await feed(P)));
await P.fill('#fr-search', 'meera'); await P.waitForTimeout(200);
ok('search by person', /LIC policy/.test(await feed(P)) && !/Indiranagar/.test(await feed(P)));
await P.fill('#fr-search', 'zebra'); await P.waitForTimeout(200);
ok('a search with no match says so and offers a way back', /Nothing matches/.test(await feed(P)) && await P.isVisible('[data-frclear]'));
await design(P, SEC, 'a search with no match');
await P.click('[data-frclear]'); await P.waitForTimeout(200);
ok('"Show everything" brings both back', /LIC policy/.test(await feed(P)) && /Indiranagar/.test(await feed(P)) && (await P.inputValue('#fr-search')) === '');
await P.selectOption('#fr-person', papa.id); await P.waitForTimeout(200);
ok('filter by person', /Indiranagar/.test(await feed(P)) && !/LIC policy/.test(await feed(P)) && /1 of 2 shown/.test(await P.textContent('#fr-count')));
await P.selectOption('#fr-person', ''); await P.waitForTimeout(200);
// Meera did not write the LIC entry, but it is about her: it is hers to manage.
await refresh(M);
await rowOf(M, 'LIC policy').locator('[data-fropen]').click(); await M.waitForTimeout(900);
ok('an entry about Meera is hers to edit, even though Papa wrote it', /grey box/.test(await feed(M)) && await M.isVisible('[data-fredit]') && /Yours/.test(await rowOf(M, 'LIC policy').textContent()));

// ================================================================ 8. change who sees it
await P.click(`[data-frshare="${houseId}"]`); await P.waitForTimeout(300);
ok('"Change who sees it" shows only that question, with the choice he made', /Who can see: Flat in Indiranagar/.test(await P.textContent('#fr-ftitle')) && !(await P.isVisible('#loc-item'))
   && (await P.$eval('#fr-who input:checked', r => r.value)) === 'NOMINEES_ONLY' && await P.isChecked('#fr-people-list input[value="' + rohan.id + '"]'));
await design(P, '#fr-form', 'the form when only who sees it is being changed');
await P.click('#fr-who label:has-text("Only me")');
await P.click('#btn-add-locator'); await P.waitForTimeout(1300);
all = await dbRows();
ok('it is now "Only me", and the people chosen are forgotten', all[0].unlock_policy === 'ONLY_ME' && JSON.stringify(all[0].designated_recipients) === '[]', JSON.stringify(all[0]));
ok('his chip says so', (await rowOf(P, 'Flat in Indiranagar').locator('.frchip').textContent()) === 'Only me');
ok('he still sees who had opened it before', /Seen by Rohan/.test(await rowOf(P, 'Flat in Indiranagar').textContent()));
await refresh(R); await refresh(M);
ok('for Rohan it is gone, not locked', !/Indiranagar|House or flat/.test(await feed(R)) && /LIC policy/.test(await feed(R)), await feed(R));
ok('for Meera too: not even a locked row', !/House or flat|Only me/.test(await feed(M)) && (await M.$$('#locator-feed .frrow')).length === 1, await feed(M));

// ================================================================ 9. edit
await rowOf(P, 'Flat in Indiranagar').locator('[data-fropen]').click(); await P.waitForTimeout(900);
await P.click(`[data-fredit="${houseId}"]`); await P.waitForTimeout(300);
ok('Edit fills the form with what was saved, more options open', (await P.inputValue('#loc-item')) === 'Flat in Indiranagar' && (await P.inputValue('#fr-nominee')) === 'Rohan Sharma'
   && (await P.inputValue('#fr-value')) === '8500000' && (await P.inputValue('#fr-due')) === '2027-03-31' && await P.isVisible('#fr-nominee') && await P.isDisabled('#loc-about')
   && (await P.$eval('#fr-who input:checked', r => r.value)) === 'ONLY_ME');
await P.fill('#loc-item', 'Flat in Indiranagar, 2nd floor');
await P.fill('#fr-nominee', 'Meera Sharma');
await P.click('#btn-add-locator'); await P.waitForTimeout(1300);
all = await dbRows();
ok('the edit is saved, and nothing else moved', all[0].institution_or_item === 'Flat in Indiranagar, 2nd floor' && all[0].nominee === 'Meera Sharma' && all[0].unlock_policy === 'ONLY_ME'
   && String(all[0].approx_value) === '8500000' && all[0].identifier_mask === 'Ending in ...4921' && all[0].person_id === papa.id, JSON.stringify(all[0]));
ok('the list shows the new name, and the form is back to adding', /2nd floor/.test(await feed(P)) && /Add to the register/.test(await P.textContent('#fr-ftitle')) && !(await P.isDisabled('#loc-about')));

// ================================================================ 10. remove, after being asked
await rowOf(P, '2nd floor').locator('[data-fropen]').click(); await P.waitForTimeout(900);
await P.click(`[data-frremove="${houseId}"]`); await P.waitForTimeout(300);
ok('Remove asks first, in the app\'s own sheet, naming the entry', await P.isVisible('#asksheet') && /Remove this from the register/.test(await P.textContent('#as-q')) && /2nd floor/.test(await P.textContent('#as-sub')));
await design(P, '#asksheet', 'the "remove?" sheet');
await P.click('#as-no'); await P.waitForTimeout(400);
ok('"No, keep it" keeps it', (await dbRows()).length === 2 && /2nd floor/.test(await feed(P)));
await P.click(`[data-frremove="${houseId}"]`); await P.waitForTimeout(300);
await P.click('#as-yes'); await P.waitForTimeout(1300);
all = await dbRows();
ok('"Yes, remove it" removes it, and its log with it', all.length === 1 && all[0].institution_or_item === 'LIC policy' && (await admin.query('select 1 from legacy_asset_views where locator_id = $1', [houseId])).rows.length === 0);
ok('and it is gone from the list', !/Indiranagar/.test(await feed(P)) && /LIC policy/.test(await feed(P)));

// ================================================================ senior mode, and no internet
const S = await openRegister(priya, { big: true });
ok('Priya is in senior mode', await S.evaluate(() => document.body.classList.contains('senior')));
await rowOf(S, 'LIC policy').locator('[data-fropen]').click(); await S.waitForTimeout(900);
ok('she opens the whole-family entry', /grey box/.test(await feed(S)));
await design(S, SEC, 'the register in senior mode');
await S.context().setOffline(true);
await refresh(S);
ok('with no internet it says so, and offers Try again', /offline|No connection/.test(await feed(S)) && await S.isVisible('[data-frretry]'), await feed(S));
await design(S, '#locator-feed', 'the offline message, senior mode');
await S.context().setOffline(false);
await S.click('[data-frretry]'); await S.waitForTimeout(1200);
ok('Try again brings the register back', /LIC policy/.test(await feed(S)));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`famregister.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`famregister.e2e: ${pass}/${pass} checks pass`);
