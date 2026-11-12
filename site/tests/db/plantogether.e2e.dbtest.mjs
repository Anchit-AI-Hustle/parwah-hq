// WATCH TOGETHER AND SPLITTING A COST, END TO END: real browsers, the real
// API handlers and a real PostgreSQL. What a family meets:
//
//   - Rohan recommends Panchayat to Meera. On her Today, Meera taps Watch
//     together: a small sheet with this Saturday 8pm and Rohan already
//     ticked. She sets it, and it is an ordinary plan in Plans, "On Prime
//     Video". At the time it offers Open it (the https link, a new tab) and
//     Call the family (the app's own family call). Rohan says I am in.
//   - Papa, in senior mode, makes "Watch something together" from the plan
//     form with a platform and a link; a link that is not https is refused
//     under its box.
//   - Meera makes a trip. Three costs go in (one with uneven shares). The
//     ledger gives the total, each share, what each paid, and who owes whom.
//     Rohan sees "Ask Meera for a UPI id" until Meera allows him her saved
//     id; then "Pay Meera" opens his own UPI app, with the line "Parwah does
//     not move money. This opens your own UPI app." He taps I have paid,
//     undoes it, taps it again; Meera taps Received and the line is closed.
//   - Someone not on the plan is told so in plain words. Offline and a
//     server error are said in plain words too.
//
// Nothing here waits a fixed time and then looks: every check waits for the
// element or the state it is about to read. Every new surface is measured:
// 44px targets, a 12px floor, WCAG AA in light and dark, nothing sideways
// at 320 and 390. With TOGETHER_SHOT_DIR set, each is saved at 390, light
// and dark.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('plantogether.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('plantogether.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('plantogether.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { SPLIT_NOTE } = await import('../../../api/_split.mjs');
await ensureSchema(db());

let n = 0;
async function person(circleId, code, circleName, name, role = 'family') {
  const phone = '+9198744' + String(++n).padStart(5, '0');
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
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.2.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
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
const SHOTS = process.env.TOGETHER_SHOT_DIR;
const WAIT = 10000;

// ---- waiting for a state, never for a length of time
const settled = (page) => page.waitForLoadState('networkidle', { timeout: WAIT }).catch(() => {});
const frames = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const see = (page, sel) => page.waitForSelector(sel, { state: 'visible', timeout: WAIT }).then(() => true).catch(() => false);
const gone = (page, sel) => page.waitForSelector(sel, { state: 'hidden', timeout: WAIT }).then(() => true).catch(() => false);
const when = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: WAIT }).then(() => true).catch(() => false);
const textHas = (page, sel, text) => when(page, ([s, t]) => { const e = document.querySelector(s); return !!e && e.textContent.includes(t); }, [sel, text]);
const one = async (q, p) => (await admin.query(q, p)).rows[0];
// The database reaching a state: asked again until it has, or the time is up.
async function dbWhen(q, p, pred) {
  const end = Date.now() + WAIT; let row;
  for (;;) { row = await one(q, p); if (pred(row)) return row; if (Date.now() > end) return row; await new Promise(r => setImmediate(r)); }
}
async function shot(page, name, sel) {
  if (!SHOTS) return;
  if (sel) await page.locator(sel).first().scrollIntoViewIfNeeded();
  for (const sc of ['light', 'dark']) { await page.emulateMedia({ colorScheme: sc }); await frames(page); await page.screenshot({ path: `${SHOTS}/${name}-390-${sc}.png` }); }
  await page.emulateMedia({ colorScheme: 'light' });
}
async function phone(who, { big = false, block = null } = {}) {
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
  if (block) await page.route('**/api/plans?area=split**', block);
  await page.goto(BASE + '/');
  await settled(page);
  return page;
}
// Plans: the tab, the section, and the list drawn from the server.
async function plans(P, { fresh = false } = {}) {
  if (fresh) { await P.reload(); await settled(P); }
  await P.evaluate(() => { location.hash = '#fun'; });
  await see(P, '#fun-seg [data-sec="plans"]');
  await P.click('#fun-seg [data-sec="plans"]');
  await when(P, () => { const l = document.querySelector('#plist'); return !!l && !/Loading/.test(l.textContent); });
}
const pasand = async (P) => {
  await P.evaluate(() => { location.hash = '#fun'; });
  await see(P, '#fun-seg [data-sec="pasand"]');
  await P.click('#fun-seg [data-sec="pasand"]');
  await when(P, () => { const l = document.querySelector('#ps-recs'); return !!l && l.textContent.trim().length > 0; });
};
const cardText = (P, planId) => P.evaluate(id => { const b = document.querySelector('#plist [data-spopen="' + id + '"]'); return b ? b.closest('.plan').textContent : ''; }, planId);
const costsOpen = async (P, planId) => { await see(P, `#plist [data-spopen="${planId}"]`); await P.click(`#plist [data-spopen="${planId}"]`); await see(P, '#sp-root'); await gone(P, '#sp-load'); };
const closeSheet = async (P) => { await P.click('#bs-x'); await gone(P, '#bondsheet'); };

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
  const out = { overflow: document.scrollingElement.scrollWidth - innerWidth, bad: [], seen: 0 };
  root.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, textarea').forEach(el => {
    if (!vis(el)) return;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return;
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) return;
    out.seen++;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) out.bad.push('small ' + (el.id || el.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    // Nothing a person taps may hang off the side of its own sheet.
    if (r.right > innerWidth + 0.5 || r.left < -0.5) out.bad.push('off the side ' + (el.id || el.textContent.trim().slice(0, 20)));
  });
  // A tick box is reached through its label: the label is the target.
  root.querySelectorAll('label').forEach(el => {
    if (!vis(el) || !el.querySelector('input[type=checkbox], input[type=radio]')) return;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) out.bad.push('small label ' + el.textContent.trim().slice(0, 20) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
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
  for (const [wd, sc] of [[320, 'light'], [390, 'light'], [390, 'dark'], [320, 'dark']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc });
    // The page has taken the new width and theme when its own answer says so.
    await when(page, ([w, s]) => innerWidth === w && matchMedia('(prefers-color-scheme: ' + s + ')').matches, [wd, sc]);
    await frames(page);
    const m = await page.evaluate(measureIn, sel);
    seen += m.seen || 0;
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
  await when(page, (w) => innerWidth === w, was.width); await frames(page);
  ok('design: ' + label + ' - 44px targets, 12px floor, AA in both themes, nothing sideways at 320/390', bad.length === 0 && seen > 0, bad.slice(0, 6).join(' | ') || 'nothing to tap was measured');
}

// ---- a family
const fam = (await one(`insert into circles (code, name, kind) values ('KAPOOR','Kapoor Family','family') returning id`)).id;
const rohan = await person(fam, 'KAPOOR', 'Kapoor Family', 'Rohan');
const meera = await person(fam, 'KAPOOR', 'Kapoor Family', 'Meera');
const papa = await person(fam, 'KAPOOR', 'Kapoor Family', 'Papa', 'parent');
const LINK = 'https://www.primevideo.com/detail/Panchayat';

// ================================================================ 1. Rohan recommends Panchayat to Meera
const R = await phone(rohan);
await pasand(R);
await R.click('#ps-rec-open'); await see(R, '#ps-r-title');
await R.fill('#ps-r-title', 'Panchayat');
await R.click('#ps-r-kind [data-psk="show"]');
await R.selectOption('#ps-r-plat', 'prime');
await R.fill('#ps-r-link', LINK);
await R.check(`#ps-r-to [data-psto="${meera.id}"]`);
await R.click('#ps-r-send');
const rec = await dbWhen(`select id from pasand_recs where title = 'Panchayat'`, [], r => !!r);
ok('Rohan recommends Panchayat, on Prime Video, to Meera', !!rec);
await gone(R, '#bondsheet');
ok('his own From me row offers Watch together', await see(R, '#ps-recs [data-tgrec]') && (await R.textContent('#ps-recs [data-tgrec]')).trim() === '🍿 Watch together');
await design(R, '#ps-recs', 'From me, with Watch together');

// ================================================================ 2. Meera taps Watch together on Today
const M = await phone(meera);
ok('MEERA\'S TODAY row has Watch together beside See it', await see(M, '#ps-today [data-tgrec]') && (await M.textContent('#ps-today [data-tgrec]')).trim() === '🍿 Watch together' && await M.isVisible('#ps-today [data-psopen]'));
await design(M, '#ps-today', 'the Today row with Watch together');
await M.click('#ps-today [data-tgrec]');
ok('one tap opens a small sheet named Watch together', await see(M, '#tg-send') && (await M.textContent('#bs-title')).trim() === '🍿 Watch together');
ok('it carries the name and where it is', /Panchayat/.test(await M.textContent('#bs-body .plan')) && /On Prime Video/.test(await M.textContent('#bs-body .plan')));
const def = await M.evaluate(() => {
  const v = document.querySelector('#tg-date').value, d = new Date(v + 'T12:00:00'), now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return { day: d.getDay(), ahead: Math.round((d - today) / 86400000), time: document.querySelector('#tg-time').value };
});
ok('the day is this Saturday in her own timezone, at 8pm', def.day === 6 && def.ahead >= 0 && def.ahead <= 7 && def.time === '20:00', JSON.stringify(def));
ok('the people it was between are ticked: Rohan, and not Papa', await M.isChecked(`#tg-who [data-tgwho="${rohan.id}"]`) && !(await M.isChecked(`#tg-who [data-tgwho="${papa.id}"]`)));
// It was sent to Meera alone, and a plan is seen by everyone: said once, above the button.
ok('A PRIVATE RECOMMENDATION: the sheet says, above the button, that everyone will see the plan and its link', await see(M, '#tg-share')
   && (await M.textContent('#tg-share')) === 'Everyone in the family will see this plan and its link.'
   && await M.evaluate(() => !!(document.getElementById('tg-share').compareDocumentPosition(document.getElementById('tg-send')) & Node.DOCUMENT_POSITION_FOLLOWING)));
await design(M, '#bondsheet .mp', 'the Watch together sheet');
await shot(M, 'together-sheet');
await M.fill('#tg-date', '2020-01-04');
await M.click('#tg-send');
ok('a time that has gone is refused under the form', await see(M, '#tg-err') && /already gone/.test(await M.textContent('#tg-err')));
ok('and nothing was made', (await one(`select count(*)::int as n from plans`)).n === 0);
await design(M, '#bondsheet .mp', 'the Watch together sheet, with a refusal showing');
// Five minutes from now, on her own clock: inside the "Open it" window.
const soon = await M.evaluate(() => { const d = new Date(Date.now() + 5 * 60000), z = (x) => ('0' + x).slice(-2);
  return { date: d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()), time: z(d.getHours()) + ':' + z(d.getMinutes()) }; });
await M.fill('#tg-date', soon.date); await M.fill('#tg-time', soon.time);
await M.click('#tg-send');
const tg = await dbWhen(`select id, title, kind, platform, link, rec_id, invited, going from plans where kind = 'together'`, [], r => !!r);
ok('MEERA SETS IT: an ordinary plan of kind together, with the name, the platform and the link of the recommendation',
   tg && tg.title === 'Panchayat' && tg.platform === 'prime' && tg.link === LINK && tg.rec_id === rec.id && tg.invited.join() === rohan.id && tg.going.join() === meera.id, JSON.stringify(tg));
ok('the sheet closes', await gone(M, '#bondsheet'));

// ================================================================ 3. the plan card, at the time
await plans(M);
await see(M, `#plist [data-spopen="${tg.id}"]`);
const mCard = await cardText(M, tg.id);
ok('THE PLAN CARD says "On Prime Video"', /🍿 Panchayat/.test(mCard) && /On Prime Video/.test(mCard), mCard);
ok('at the time it offers Open it: the https link, a new tab, rel noopener', await M.$eval('#plist a[data-tgopen]', (a, link) => a.getAttribute('href') === link && a.target === '_blank' && a.rel.split(' ').includes('noopener') && /Open it/.test(a.textContent), LINK));
ok('and Call the family', await M.isVisible('#plist [data-tgcall]') && /Call the family/.test(await M.textContent('#plist [data-tgcall]')));
ok('Meera, who made it, is already in: said with a tick and aria-pressed, not colour alone', await M.$eval('#plist [data-tgans="in"]', b => b.getAttribute('aria-pressed') === 'true' && b.textContent.trim() === '✔ I am in')
   && await M.$eval('#plist [data-tgans="maybe"]', b => b.getAttribute('aria-pressed') === 'false' && b.textContent.trim() === 'Maybe'));
ok('the card says who was asked', /Asked: Rohan/.test(mCard));
ok('a plan that is not a trip offers "Add costs", quietly', /Add costs/.test(await M.textContent(`#plist [data-spopen="${tg.id}"]`)));
await design(M, '#plist', 'the together plan card, at the time');
await shot(M, 'together-card', '#plist [data-tgans]');
await M.click('#plist [data-tgcall]');
ok('CALL THE FAMILY is the app\'s own family call: it asks first', await see(M, '#asksheet') && /Start a family video call\?/.test(await M.textContent('#as-q')));
await M.click('#as-no');
ok('and "Not now" starts nothing', await gone(M, '#asksheet') && (await one(`select count(*)::int as n from calls`)).n === 0);

// ================================================================ 4. the other person says I am in
await plans(R, { fresh: true });
await see(R, '#plist [data-tgans="in"]');
ok('ROHAN sees the plan, with three answers and none chosen yet', (await R.$$('#plist [data-tgans]')).length === 3 && (await R.$$('#plist [data-tgans][aria-pressed="true"]')).length === 0);
await R.click('#plist [data-tgans="maybe"]');
ok('he taps Maybe', await see(R, '#plist [data-tgans="maybe"][aria-pressed="true"]') && (await dbWhen(`select maybe from plans where id = $1`, [tg.id], r => r.maybe.length === 1)).maybe.join() === rohan.id);
await R.click('#plist [data-tgans="in"]');
ok('ROHAN SAYS "I am in"', await see(R, '#plist [data-tgans="in"][aria-pressed="true"]') && (await R.textContent('#plist [data-tgans="in"]')).trim() === '✔ I am in');
const after = await dbWhen(`select going, maybe from plans where id = $1`, [tg.id], r => r.going.includes(rohan.id));
ok('one answer, moved: he is going, and no longer a maybe', after.going.includes(rohan.id) && after.going.includes(meera.id) && after.maybe.length === 0);
ok('his card names who is going', await textHas(R, '#plist', 'Going: ') && /Going: [^<]*Rohan/.test(await cardText(R, tg.id)));
await design(R, '#plist', 'the together plan card, answered');
await plans(M, { fresh: true });
ok('and Meera sees that he is in', await textHas(M, '#plist', 'Rohan') && /Going: [^A]*Rohan|Going: Meera, Rohan|Going: Rohan, Meera/.test(await cardText(M, tg.id)));

// ================================================================ 5. Papa, senior mode: Watch something together, from the plan form
const P = await phone(papa, { big: true });
ok('Papa is in senior mode', await P.evaluate(() => document.body.classList.contains('senior')));
await plans(P);
ok('the plan form offers "Watch something together"', await P.isVisible('#p-kind [data-kind="together"]') && /Watch something together/.test(await P.textContent('#p-kind [data-kind="together"]')));
ok('its platform and link stay out of the way until it is picked', !(await P.isVisible('#tg-more')));
await P.click('#p-kind [data-kind="together"]');
ok('picking it shows where it is and a link, both optional', await see(P, '#tg-plat') && await P.isVisible('#tg-link') && /Both are optional/.test(await P.textContent('#tg-more'))
   && (await P.$$('#tg-plat option')).length === 14);
const later = await P.evaluate(() => { const d = new Date(Date.now() + 2 * 86400000), z = (x) => ('0' + x).slice(-2); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); });
await P.fill('#p-title', 'Old Kishore songs');
await P.fill('#p-date', later); await P.fill('#p-time', '19:30');
await P.selectOption('#tg-plat', 'youtube');
await P.fill('#tg-link', 'http://www.youtube.com/playlist?list=PL123');
await P.click('#p-add');
ok('a link that is not https is refused under its own box', await see(P, '#tg-link-err') && /start with https/.test(await P.textContent('#tg-link-err')));
ok('and no plan was made', (await one(`select count(*)::int as n from plans where title = 'Old Kishore songs'`)).n === 0);
await design(P, '#pane-fun .subsec[data-sec="plans"] .card:has(#p-add)', 'the plan form with Watch something together, a refusal showing, senior mode');
await P.fill('#tg-link', 'https://www.youtube.com/playlist?list=PL123');
await P.click('#p-add');
const songs = await dbWhen(`select id, kind, platform, link, rec_id from plans where title = 'Old Kishore songs'`, [], r => !!r);
ok('PAPA MAKES ONE WITH NO RECOMMENDATION: together, on YouTube, with the https link', songs && songs.kind === 'together' && songs.platform === 'youtube' && songs.link === 'https://www.youtube.com/playlist?list=PL123' && songs.rec_id === null, JSON.stringify(songs));
await see(P, `#plist [data-spopen="${songs.id}"]`);
const sCard = await cardText(P, songs.id);
ok('two days ahead, its card says "On YouTube" and when the buttons will show, with no Open it yet', /On YouTube/.test(sCard) && /show here 10 minutes before/.test(sCard)
   && await P.evaluate(id => !document.querySelector('#plist [data-spopen="' + id + '"]').closest('.plan').querySelector('[data-tgopen],[data-tgcall]'), songs.id), sCard);
await design(P, '#plist', 'together plan cards, senior mode');

// ================================================================ 6. a trip, and who is on it
await M.fill('#p-title', 'Goa trip');
await M.click('#p-kind [data-kind="trip"]');
await M.fill('#p-date', later); await M.fill('#p-time', '09:00');
await M.click('#p-add');
const trip = await dbWhen(`select id from plans where title = 'Goa trip'`, [], r => !!r);
ok('Meera makes a trip', !!trip);
await see(M, `#plist [data-spopen="${trip.id}"]`);
ok('a trip offers "Split the costs"', /Split the costs/.test(await M.textContent(`#plist [data-spopen="${trip.id}"]`)));
// Papa has not said he is coming: the costs are not his to see.
await plans(P, { fresh: true });
await P.click(`#plist [data-spopen="${trip.id}"]`);
ok('PAPA, not on the trip yet, is told so in plain words, and shown nothing', await see(P, '#sp-fail') && /Only people on this plan can see its costs\. Say you are in first\./.test(await P.textContent('#sp-fail')) && !(await P.$('#sp-add')));
await design(P, '#bondsheet .mp', 'costs refused to someone not on the plan, senior mode');
await closeSheet(P);
for (const [W, who] of [[P, papa], [R, rohan]]) {
  if (W === R) await plans(R, { fresh: true });
  const sel = await W.evaluate(id => { const c = document.querySelector('#plist [data-spopen="' + id + '"]').closest('.plan'); return '#plist [data-rsvp="' + c.querySelector('[data-rsvp]').getAttribute('data-rsvp') + '"]'; }, trip.id);
  await W.click(sel);
  await dbWhen(`select going from plans where id = $1`, [trip.id], r => r.going.includes(who.id));
}
ok('Rohan and Papa say they are in', (await one(`select going from plans where id = $1`, [trip.id])).going.length === 3);

// ================================================================ 7. three costs
await costsOpen(M, trip.id);
ok('THE COSTS START EMPTY, with a first step', await see(M, '#sp-empty') && /No costs yet\. Add the first one/.test(await M.textContent('#sp-empty')) && /Costs: Goa trip/.test(await M.textContent('#bs-title')));
ok('and say who can see them', /Only the people on this plan can see this/.test(await M.textContent('#sp-root')));
await design(M, '#bondsheet .mp', 'costs, empty');
await M.click('#sp-add');
ok('Add a cost: what, how much (in INR), who paid, and everyone going already ticked', await see(M, '#sp-what') && /in INR/.test(await M.textContent('label[for="sp-amount"]'))
   && (await M.$$('#sp-between [data-spwho]:checked')).length === 3 && await M.$eval('#sp-paidby', (s, id) => s.value === id, meera.id)
   && await M.$eval('#sp-mode [data-spmode="equal"]', b => b.getAttribute('aria-pressed') === 'true'));
await M.click('#sp-save');
ok('saving with nothing written is refused under the form', await see(M, '#sp-err') && /Write what it was for/.test(await M.textContent('#sp-err')));
await M.fill('#sp-what', 'Rooms'); await M.fill('#sp-amount', 'lots');
await M.click('#sp-save');
ok('an amount that is not a number is refused there too', await textHas(M, '#sp-err', 'Write the amount as a number above 0'));
await design(M, '#bondsheet .mp', 'the cost form, with a refusal showing');
await M.fill('#sp-amount', '6,000');
await M.click('#sp-save');
ok('ROOMS, 6000, paid by Meera', await see(M, '#sp-total') && !!(await dbWhen(`select id from plan_costs where what = 'Rooms' and amount_paise = 600000 and paid_by = $1`, [meera.id], r => !!r)));
await M.click('#sp-add'); await see(M, '#sp-what');
await M.fill('#sp-what', 'Taxi from the airport'); await M.fill('#sp-amount', '2400');
await M.selectOption('#sp-paidby', rohan.id);
await M.click('#sp-save');
ok('TAXI, 2400, paid by Rohan (written down by Meera)', await textHas(M, '#sp-costs', 'Taxi from the airport') && !!(await dbWhen(`select id from plan_costs where what = 'Taxi from the airport' and paid_by = $1`, [rohan.id], r => !!r)));
// The third with uneven shares.
await M.click('#sp-add'); await see(M, '#sp-what');
await M.fill('#sp-what', 'Sweets'); await M.fill('#sp-amount', '600');
await M.selectOption('#sp-paidby', papa.id);
await M.click('#sp-mode [data-spmode="uneven"]');
ok('"Uneven shares" gives one box per person ticked', await see(M, '#sp-uneven [data-spshare]') && (await M.$$('#sp-uneven [data-spshare]')).length === 3);
await M.fill(`#sp-uneven [data-spshare="${meera.id}"]`, '200');
await M.fill(`#sp-uneven [data-spshare="${rohan.id}"]`, '200');
await M.fill(`#sp-uneven [data-spshare="${papa.id}"]`, '100');
ok('the running sum says, in words and a mark, that they do not add up', await textHas(M, '#sp-sum', '! The shares add up to ₹500. They must add up to ₹600.'));
await M.click('#sp-save');
ok('and saving is refused with the same reason', await textHas(M, '#sp-err', 'The shares add up to ₹500. They must add up to ₹600.') && (await one(`select count(*)::int as n from plan_costs where what = 'Sweets'`)).n === 0);
await design(M, '#bondsheet .mp', 'the cost form, uneven shares that do not add up');
await shot(M, 'split-form-uneven');
await M.fill(`#sp-uneven [data-spshare="${papa.id}"]`, '200');
ok('once they add up it says so', await textHas(M, '#sp-sum', '✓ The shares add up to ₹600.'));
await M.click('#sp-save');
await textHas(M, '#sp-costs', 'Sweets');
const sweets = await dbWhen(`select k.id, k.mode, (select sum(share_paise)::int from plan_cost_shares s where s.cost_id = k.id) as s from plan_costs k where what = 'Sweets'`, [], r => !!r);
ok('SWEETS, 600, paid by Papa, uneven shares that add up to the paisa', sweets && sweets.mode === 'uneven' && sweets.s === 60000, JSON.stringify(sweets));

// ================================================================ 8. the ledger, and who owes whom
{
  const people = await M.textContent('#sp-people'), owes = await M.textContent('#sp-owes');
  ok('THE LEDGER: total ₹9,000', (await M.textContent('#sp-total')).replace(/\s+/g, ' ').trim() === 'Total₹9,000', await M.textContent('#sp-total'));
  ok('each share is ₹3,000, and what each has paid', /YouShare ₹3,000 · Paid ₹6,000/.test(people) && /RohanShare ₹3,000 · Paid ₹2,400/.test(people) && /PapaShare ₹3,000 · Paid ₹600/.test(people), people);
  ok('where each stands, in words and a mark', /✓ Is owed ₹3,000/.test(people) && /! Owes ₹600/.test(people) && /! Owes ₹2,400/.test(people));
  ok('WHO OWES WHOM, in two lines: Papa owes you ₹2,400, Rohan owes you ₹600', (await M.$$('#sp-owes .spline')).length === 2 && /Papa owes you ₹2,400/.test(owes) && /Rohan owes you ₹600/.test(owes), owes);
  ok('Meera, who is owed, is offered Received and no Pay button', (await M.$$('#sp-owes [data-spgot]')).length === 2 && !(await M.$('#sp-owes [data-spupi]')) && !(await M.$('#sp-owes [data-sppaid]')));
  ok('she is told, once, that Parwah does not move money', (await M.$$('#sp-note')).length === 1 && /^Parwah does not move money\./.test(await M.textContent('#sp-note')));
  ok('Meera, who made the plan, can change every cost', (await M.$$('#sp-costs [data-spedit]')).length === 3 && (await M.$$('#sp-costs [data-spdel]')).length === 3);
  ok('the uneven cost shows each share', /Uneven: /.test(await M.textContent('#sp-costs')) && /Shared equally: /.test(await M.textContent('#sp-costs')));
}
await design(M, '#bondsheet .mp', 'the ledger with three costs and who owes whom');
await shot(M, 'split-ledger');

// ---- change and remove
await M.click('#sp-add'); await see(M, '#sp-what');
await M.fill('#sp-what', 'Water'); await M.fill('#sp-amount', '90');
await M.click('#sp-save'); await textHas(M, '#sp-costs', 'Water');
const water = await dbWhen(`select id from plan_costs where what = 'Water'`, [], r => !!r);
await M.click(`#sp-costs [data-spdel="${water.id}"]`);
ok('removing a cost asks first, in the app\'s own sheet', await see(M, '#asksheet') && /Remove this cost\?/.test(await M.textContent('#as-q')));
await M.click('#as-yes');
ok('and then it is gone, and the total is ₹9,000 again', await when(M, () => !/Water/.test(document.querySelector('#sp-costs').textContent)) && (await one(`select count(*)::int as n from plan_costs where what = 'Water'`)).n === 0 && /₹9,000/.test(await M.textContent('#sp-total')));
await closeSheet(M);

await costsOpen(R, trip.id);
ok('ROHAN can change the taxi? No: Meera wrote it down. He can change nothing here', (await R.$$('#sp-costs [data-spedit]')).length === 0 && (await R.$$('#sp-costs [data-spdel]')).length === 0);
await R.click('#sp-add'); await see(R, '#sp-what');
await R.fill('#sp-what', 'Chai at the station'); await R.fill('#sp-amount', '90');
await R.click('#sp-save'); await textHas(R, '#sp-costs', 'Chai at the station');
const chai = await dbWhen(`select id from plan_costs where what = 'Chai at the station'`, [], r => !!r);
ok('a cost he adds himself is his to change', (await R.$$('#sp-costs [data-spedit]')).length === 1 && await R.isVisible(`#sp-costs [data-spedit="${chai.id}"]`));
await R.click(`#sp-costs [data-spedit="${chai.id}"]`);
ok('Change opens the form filled in', await see(R, '#sp-what') && (await R.inputValue('#sp-what')) === 'Chai at the station' && (await R.inputValue('#sp-amount')) === '90' && /Change a cost/.test(await R.textContent('#bs-title')));
await R.fill('#sp-what', 'Chai for everyone');
await R.click('#sp-save');
ok('and saves the change, not a second cost', await textHas(R, '#sp-costs', 'Chai for everyone') && (await one(`select count(*)::int as n from plan_costs where plan_id = $1`, [trip.id])).n === 4 && (await one(`select what from plan_costs where id = $1`, [chai.id])).what === 'Chai for everyone');
await R.click(`#sp-costs [data-spdel="${chai.id}"]`); await see(R, '#asksheet'); await R.click('#as-yes');
await when(R, () => !/Chai/.test(document.querySelector('#sp-costs').textContent));
ok('he removes it again', (await one(`select count(*)::int as n from plan_costs where plan_id = $1`, [trip.id])).n === 3);

// ================================================================ 9. paying: only an id he may already see
ok('ROHAN\'S LINE: "You owe Meera ₹600"', await textHas(R, '#sp-owes', 'You owe Meera ₹600'));
ok('with no UPI id he may see: "Ask Meera for a UPI id", and no pay link', /Ask Meera for a UPI id\./.test(await R.textContent('#sp-owes')) && !(await R.$('#sp-root [data-spupi]')) && !/upi:\/\//.test(await R.innerHTML('#sp-root')));
ok('he can still say he has paid', await R.isVisible(`#sp-owes [data-sppaid="${meera.id}"]`));
ok('the line about money does not promise a UPI app when there is none to open', !(await R.textContent('#sp-note')).includes('This opens your own UPI app') && /^Parwah does not move money\./.test(await R.textContent('#sp-note')));
await design(R, '#bondsheet .mp', 'the ledger for someone who owes, no UPI id to see');
await closeSheet(R);
// Meera saves her UPI id in ways to pay, and allows Rohan to use it.
const api = async (who, name, body) => {
  let json = null; const res = { status() { return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await HANDLERS[name]({ method: 'POST', headers: { 'x-parwah-token': who.token }, query: { area: body.area }, body: { code: who.code, memberId: who.id, ...body } }, res);
  return json;
};
const method = await api(meera, 'book', { area: 'pay', action: 'add', kind: 'upi', label: 'Meera HDFC UPI', handle: 'meera.kapoor@okhdfcbank' });
await costsOpen(R, trip.id);
ok('SAVED BUT NOT SHARED WITH HIM: still no link, and the id is nowhere on his screen', !(await R.$('#sp-root [data-spupi]')) && !/okhdfcbank|upi:\/\//.test(await R.innerHTML('#bs-body')));
await closeSheet(R);
await api(meera, 'book', { area: 'pay', action: 'allow', id: method.id, targetId: rohan.id });
await costsOpen(R, trip.id);
ok('ONCE MEERA ALLOWS HIM: "Pay Meera" opens his own UPI app with the amount filled in', await see(R, '#sp-owes a[data-spupi]')
   && await R.$eval('#sp-owes a[data-spupi]', a => a.getAttribute('href') === 'upi://pay?pa=meera.kapoor%40okhdfcbank&pn=Meera&am=600.00&cu=INR&tn=Goa%20trip' && a.textContent.trim() === 'Pay Meera' && !a.target),
   await R.$eval('#sp-owes a[data-spupi]', a => a.getAttribute('href')).catch(() => 'no link'));
ok('PARWAH SAYS IT PLAINLY, ONCE, near the button', (await R.$$('#sp-note')).length === 1 && (await R.textContent('#sp-note')) === 'Parwah does not move money. This opens your own UPI app.' && (await R.textContent('#sp-note')) === SPLIT_NOTE
   && (await R.textContent('#sp-root')).split('Parwah does not move money').length === 2);
ok('"Ask Meera" is gone now that there is a link', !/Ask Meera for a UPI id/.test(await R.textContent('#sp-owes')));
ok('nothing here asks for a PIN', (await R.$$('#sp-root input')).length === 0 && !/PIN/i.test(await R.textContent('#sp-root')));
await design(R, '#bondsheet .mp', 'the ledger with Pay Meera and I have paid');
await shot(R, 'split-pay');

// ---- I have paid, undo, again, Received
await R.click(`#sp-owes [data-sppaid="${meera.id}"]`);
ok('ROHAN TAPS "I have paid": it waits for Meera, it is not closed', await textHas(R, '#sp-owes', 'You say ₹600 is paid to Meera') && /⏳ Waiting for Meera to tap Received\. It is not closed yet\./.test(await R.textContent('#sp-owes')));
let st = await dbWhen(`select paid_at, received_at, amount_paise::int as a from plan_settles where from_member = $1`, [rohan.id], r => !!r);
ok('the server has his word only', st && st.paid_at && !st.received_at && st.a === 60000);
ok('he is offered Undo, and not Received', await R.isVisible('#sp-owes [data-spundo]') && !(await R.$('#sp-owes [data-spgot]')));
await design(R, '#bondsheet .mp', 'a line that is waiting, with Undo');
await R.click('#sp-owes [data-spundo]');
ok('HE UNDOES IT before she confirms: the line is back', await textHas(R, '#sp-owes', 'You owe Meera ₹600') && (await dbWhen(`select count(*)::int as n from plan_settles`, [], r => r.n === 0)).n === 0);
await R.click(`#sp-owes [data-sppaid="${meera.id}"]`);
await textHas(R, '#sp-owes', 'You say ₹600 is paid to Meera');
await costsOpen(M, trip.id);
ok('MEERA SEES "Rohan says ₹600 is paid to you", waiting for her', await textHas(M, '#sp-owes', 'Rohan says ₹600 is paid to you') && /Waiting for you to tap Received/.test(await M.textContent('#sp-owes')));
ok('she cannot undo his word; she can confirm it', !(await M.$('#sp-owes [data-spundo]')) && await M.isVisible(`#sp-owes .spline [data-spgot="${rohan.id}"]`));
await M.click(`#sp-owes [data-spgot="${rohan.id}"]`);
ok('MEERA TAPS "Received": the line is closed, said with a tick and words', await textHas(M, '#sp-owes', 'Rohan paid you ₹600') && /✓ Settled\. Both of you confirmed\./.test(await M.textContent('#sp-owes')));
st = await dbWhen(`select paid_at, received_at from plan_settles where from_member = $1`, [rohan.id], r => r && r.received_at);
ok('both sides are on the server', st && st.paid_at && st.received_at);
ok('Rohan is all square; only Papa still owes', /RohanShare ₹3,000 · Paid ₹2,400✓ All square/.test(await M.textContent('#sp-people')) && (await M.$$('#sp-owes [data-spgot]')).length === 1 && /Papa owes you ₹2,400/.test(await M.textContent('#sp-owes')));
await design(M, '#bondsheet .mp', 'the ledger with one line settled and one owed');

// ---- Papa, senior mode: the other order (Meera says Received first)
await M.click(`#sp-owes [data-spgot="${papa.id}"]`);
ok('MEERA TAPS Received for Papa first: it waits for Papa', await textHas(M, '#sp-owes', 'You say ₹2,400 has come from Papa') && /Waiting for Papa to tap I have paid/.test(await M.textContent('#sp-owes')) && await M.isVisible('#sp-owes [data-spundo]'));
await costsOpen(P, trip.id);
ok('PAPA is asked to agree, in senior mode', await textHas(P, '#sp-owes', 'Meera says ₹2,400 has come from you') && await P.isVisible(`#sp-owes [data-sppaid="${meera.id}"]`) && !(await P.$('#sp-owes [data-spundo]')));
ok('Papa was never allowed Meera\'s UPI id: it is nowhere on his screen', !/okhdfcbank|upi:\/\//.test(await P.innerHTML('#bs-body')));
await design(P, '#bondsheet .mp', 'a line waiting for me, senior mode');
await P.click(`#sp-owes [data-sppaid="${meera.id}"]`);
ok('PAPA TAPS "I have paid": everyone is square', await see(P, '#sp-owes') && await textHas(P, '#sp-owes', 'You paid Meera ₹2,400') && !(await P.$('#sp-note'))
   && (await P.$$('#sp-people .spstate')).length === 3 && (await P.$$eval('#sp-people .spstate', els => els.every(e => e.textContent === '✓ All square'))));
ok('two lines closed on the server, by both sides each', (await dbWhen(`select count(*)::int as n from plan_settles where paid_at is not null and received_at is not null`, [], r => r.n === 2)).n === 2);
await design(P, '#bondsheet .mp', 'everyone square, senior mode');
await shot(P, 'split-square-senior');
await closeSheet(P);

// ================================================================ 10. offline, and a server error
const OFF = await phone(rohan, { block: route => route.abort() });
await plans(OFF);
await OFF.click(`#plist [data-spopen="${trip.id}"]`);
ok('OFFLINE: said in plain words, with Try again', await see(OFF, '#sp-fail') && (await OFF.textContent('#sp-fail')) === 'No connection. The costs will show when you are back online.' && await OFF.isVisible('#sp-retry'));
await design(OFF, '#bondsheet .mp', 'costs, offline');
await OFF.unroute('**/api/plans?area=split**');
await OFF.click('#sp-retry');
ok('Try again loads them once the connection is back', await see(OFF, '#sp-total') && /₹9,000/.test(await OFF.textContent('#sp-total')));
const ERR = await phone(rohan, { block: route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'relation "plan_costs" does not exist' }) }) });
await plans(ERR);
await ERR.click(`#plist [data-spopen="${trip.id}"]`);
ok('A SERVER ERROR is a plain sentence, never the database\'s words', await see(ERR, '#sp-fail') && (await ERR.textContent('#sp-fail')) === 'Could not load the costs. Try again in a moment.' && !/relation|does not exist/.test(await ERR.textContent('#bs-body')));

// ================================================================ 11. a plan with costs cannot be cancelled, and stays reachable after its time
const R2 = await phone(rohan);
await plans(R2);
await see(R2, `#plist [data-pcancel="${trip.id}"]`);
await R2.click(`#plist [data-pcancel="${trip.id}"]`);
await see(R2, '#asksheet'); await R2.click('#as-yes');
ok('CANCELLING A PLAN WITH COSTS is refused in plain words, and the plan stays', await textHas(R2, '#toast', 'This plan has costs on it. Remove the costs first, or settle up.')
   && (await one(`select count(*)::int as n from plans where id = $1`, [trip.id])).n === 1 && (await one(`select count(*)::int as n from plan_costs where plan_id = $1`, [trip.id])).n === 3
   && await see(R2, `#plist [data-spopen="${trip.id}"]`));
// The trip is over, everyone is square: it leaves the list. Then one more cost is written down.
await admin.query(`update plans set at = now() - interval '2 days' where id = $1`, [trip.id]);
await plans(R2);
ok('a trip that is over and square is not listed', await when(R2, (id) => !document.querySelector(`#plist [data-spopen="${id}"]`), trip.id) && !(await R2.$('#plist-settle')));
const lateCost = (await admin.query(`insert into plan_costs (plan_id, circle_id, what, amount_paise, paid_by, added_by) values ($1, $2, 'Taxi home', 80000, $3, $3) returning id`, [trip.id, fam, meera.id])).rows[0].id;
await admin.query(`insert into plan_cost_shares (cost_id, member_id, share_paise) values ($1, $2, 40000), ($1, $3, 40000)`, [lateCost, meera.id, rohan.id]);
await plans(R2);
ok('A TRIP THAT IS OVER BUT NOT SETTLED is under a quiet heading, "Costs to settle"', await see(R2, '#plist-settle') && (await R2.textContent('#plist-settle')) === 'Costs to settle'
   && await see(R2, `#plist [data-psettle="${trip.id}"] [data-spopen="${trip.id}"]`) && /Goa/.test(await R2.textContent(`#plist [data-psettle="${trip.id}"]`)));
ok('with its costs button and none of the RSVP controls', await R2.evaluate((id) => { const c = document.querySelector(`#plist [data-psettle="${id}"]`);
  return !!c && c.querySelectorAll('button').length === 1 && !c.querySelector('[data-rsvp],[data-pcancel],[data-tgans],a'); }, trip.id));
await design(R2, '#plist', 'the plans list with Costs to settle');
await R2.click(`#plist [data-psettle="${trip.id}"] [data-spopen="${trip.id}"]`);
ok('the button opens the costs, where Rohan sees what he owes', await see(R2, '#sp-owes') && await textHas(R2, '#sp-owes', '₹400'));
await closeSheet(R2);

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`plantogether.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`plantogether.e2e: ${pass}/${pass} checks pass`);
