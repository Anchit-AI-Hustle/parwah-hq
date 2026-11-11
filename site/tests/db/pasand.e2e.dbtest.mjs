// PASAND, END TO END: real browsers, the real API handlers and a real
// PostgreSQL. What a family meets:
//
//   - Rohan opens Together, Pasand. It starts empty, with a first step.
//     He adds likes, ticks Prime Video and adds a public link. A password
//     typed anywhere is refused under the form, and nothing is kept.
//   - He shares his likes with Meera only. Meera sees them; Papa does not.
//   - He recommends Panchayat to Meera. Meera's Today says "Rohan recommends
//     Panchayat for you. On Prime Video." Papa's Today says nothing.
//   - Meera answers Loved it with a line. Rohan sees who answered with what.
//   - On Rohan's page, Meera sees his likes and "Recommend something to
//     Rohan"; Papa sees that nothing is shared with him.
//   - Rohan removes what he sent. Offline and a server error are said in
//     plain words.
//
// Every new screen is measured: 44px targets, a 12px floor, WCAG AA in light
// and dark, nothing sideways at 320 and 390. With PASAND_SHOT_DIR set, each
// is saved at 390 and 1440, light and dark.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('pasand.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('pasand.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('pasand.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { NO_PASSWORD } = await import('../../../api/_pasandrules.mjs');
await ensureSchema(db());

let n = 0;
async function person(circleId, code, circleName, name, role = 'family') {
  const phone = '+9198633' + String(++n).padStart(5, '0');
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
const SHOTS = process.env.PASAND_SHOT_DIR;
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
async function phone(who, { hash = '', big = false, block = null } = {}) {
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
  if (block) await page.route('**/api/games?area=pasand**', block);
  await page.goto(BASE + '/' + hash);
  await page.waitForTimeout(1500);
  return page;
}
const go = async (P, hash) => { await P.evaluate(h => { location.hash = h; }, hash); await P.waitForTimeout(900); };
const reload = async (P) => { await P.reload(); await P.waitForTimeout(1500); };
const SEC = '#pane-fun .subsec[data-sec="pasand"]';
const pasand = async (P) => { await go(P, '#fun'); await P.click('#fun-seg [data-sec="pasand"]'); await P.waitForTimeout(1200); };
const openPerson = async (P, id) => { await P.evaluate((id) => { const b = document.createElement('button'); b.setAttribute('data-person', id); document.body.appendChild(b); b.click(); b.remove(); }, id); await P.waitForTimeout(1300); };
const one = async (q, p) => (await admin.query(q, p)).rows[0];

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

// ---- a family
const fam = (await one(`insert into circles (code, name, kind) values ('KAPOOR','Kapoor Family','family') returning id`)).id;
const rohan = await person(fam, 'KAPOOR', 'Kapoor Family', 'Rohan');
const meera = await person(fam, 'KAPOOR', 'Kapoor Family', 'Meera');
const papa = await person(fam, 'KAPOOR', 'Kapoor Family', 'Papa', 'parent');

// ================================================================ 1. it starts empty, with a first step
const R = await phone(rohan);
ok('Today has nothing from Pasand yet', (await R.textContent('#ps-today')).trim() === '');
await pasand(R);
ok('Together has a Pasand section', await R.isVisible(SEC) && await R.$eval('#fun-seg [data-sec="pasand"]', b => b.classList.contains('sel')));
ok('empty likes offer a first step', /Start with one show/.test(await R.textContent('#ps-likes')));
ok('empty recommendations say what to do', /Nothing for you yet/.test(await R.textContent('#ps-recs')));
ok('nobody else has shared yet', /Nobody else has shared/.test(await R.textContent('#ps-people')));
ok('all thirteen platforms are listed, none ticked', (await R.$$('#ps-plats [data-psplat]')).length === 13 && (await R.$$('#ps-plats [data-psplat]:checked')).length === 0);
ok('the screen says no password is asked for', /Tick what you have so the family knows where to watch together\. Parwah never asks for your password\./.test(await R.textContent(SEC)));
ok('likes go to the whole family unless changed', await R.$eval('#ps-aud [data-psaud="family"]', b => b.getAttribute('aria-pressed') === 'true') && /Everyone in this family/.test(await R.textContent('#ps-aud-note')));
ok('there is no password box anywhere in it', (await R.$$(SEC + ' input[type=password]')).length === 0);
await design(R, SEC, 'Pasand, empty');
await shotAll(R, 'pasand-empty', true);

// ================================================================ 2. my likes
await R.click('#ps-like-add'); await R.waitForTimeout(200);
ok('an empty like is refused under the form', await R.isVisible('#ps-like-err') && /Write what you like/.test(await R.textContent('#ps-like-err')));
await R.selectOption('#ps-like-kind', 'shows');
await R.fill('#ps-like-text', 'Panchayat');
await R.click('#ps-like-add'); await R.waitForTimeout(1300);
ok('Rohan adds Panchayat', (await one(`select count(*)::int as n from pasand_likes where member_id = $1 and kind = 'shows' and text = 'Panchayat'`, [rohan.id])).n === 1);
ok('it shows as his like, under Shows and films', /Shows and films/.test(await R.textContent('#ps-likes')) && /Panchayat/.test(await R.textContent('#ps-likes')) && (await R.inputValue('#ps-like-text')) === '');
await R.selectOption('#ps-like-kind', 'music');
await R.fill('#ps-like-text', 'Kishore Kumar');
await R.press('#ps-like-text', 'Enter'); await R.waitForTimeout(1300);
ok('Enter adds one too', (await one(`select count(*)::int as n from pasand_likes where member_id = $1`, [rohan.id])).n === 2);
await R.selectOption('#ps-like-kind', 'other');
await R.fill('#ps-like-text', 'Netflix password hunter2');
await R.click('#ps-like-add'); await R.waitForTimeout(1200);
ok('a password typed as a like is refused under the form, in plain words', await R.isVisible('#ps-like-err') && (await R.textContent('#ps-like-err')) === NO_PASSWORD, await R.textContent('#ps-like-err'));
ok('and it was not kept', (await one(`select count(*)::int as n from pasand_likes where text ilike '%hunter%'`)).n === 0);
await R.fill('#ps-like-text', '');

// ================================================================ 3. where I watch and listen
await R.check('#ps-plats [data-psplat="prime"]'); await R.waitForTimeout(1300);
ok('Rohan ticks Prime Video', (await one(`select count(*)::int as n from pasand_platforms where member_id = $1 and platform = 'prime'`, [rohan.id])).n === 1);
ok('a ticked one offers "Add a link"', await R.isVisible('#ps-plats [data-pslink="prime"]') && /Add a link/.test(await R.textContent('#ps-plats [data-pslink="prime"]')));
await R.click('#ps-plats [data-pslink="prime"]'); await R.waitForTimeout(400);
ok('the link sheet opens and says no password again', await R.isVisible('#bondsheet') && /Prime Video link/.test(await R.textContent('#bs-title')) && /never asks for your password/.test(await R.textContent('#bs-body')));
await R.fill('#ps-link-in', 'http://www.primevideo.com/profile/rohan');
await R.click('#ps-link-save'); await R.waitForTimeout(300);
ok('a link that is not https is refused under the box', await R.isVisible('#ps-link-err') && /start with https/.test(await R.textContent('#ps-link-err')));
await R.fill('#ps-link-in', 'https://rohan:hunter2@www.primevideo.com/');
await R.click('#ps-link-save'); await R.waitForTimeout(1200);
ok('a link with a sign-in inside it is refused by the server, in plain words', await R.isVisible('#ps-link-err') && (await R.textContent('#ps-link-err')) === NO_PASSWORD, await R.textContent('#ps-link-err'));
ok('nothing was kept from either', (await one(`select link from pasand_platforms where member_id = $1 and platform = 'prime'`, [rohan.id])).link === null);
await design(R, '#bondsheet .mp', 'the link sheet, with a refusal showing');
await R.fill('#ps-link-in', 'https://www.primevideo.com/profile/rohan');
await R.click('#ps-link-save'); await R.waitForTimeout(1400);
ok('a plain https link is saved, and the sheet closes', (await one(`select link from pasand_platforms where member_id = $1 and platform = 'prime'`, [rohan.id])).link === 'https://www.primevideo.com/profile/rohan' && !(await R.isVisible('#bondsheet')));
ok('the row now offers Open and Change link', /Change link/.test(await R.textContent('#ps-plats')) && await R.$eval('#ps-plats a.pstap', a => a.getAttribute('href') === 'https://www.primevideo.com/profile/rohan' && a.rel.includes('noopener')));
await R.check('#ps-plats [data-psplat="spotify"]'); await R.waitForTimeout(1200);
await R.uncheck('#ps-plats [data-psplat="spotify"]'); await R.waitForTimeout(1200);
ok('unticking takes it away', (await one(`select count(*)::int as n from pasand_platforms where member_id = $1`, [rohan.id])).n === 1);

// ================================================================ 4. who sees them
await R.click('#ps-aud [data-psaud="chosen"]'); await R.waitForTimeout(300);
ok('"People I choose" lists the others to tick', (await R.$$('#ps-aud-who [data-pswho]')).length === 2 && await R.isVisible('#ps-aud-save'));
await R.click('#ps-aud-save'); await R.waitForTimeout(300);
ok('saving with nobody ticked is refused there', await R.isVisible('#ps-aud-err') && /at least one/.test(await R.textContent('#ps-aud-err')));
ok('and nothing changed on the server', (await one(`select count(*)::int as n from pasand_prefs`)).n === 0);
await R.check(`#ps-aud-who [data-pswho="${meera.id}"]`);
await design(R, SEC, 'Pasand with likes, a platform and people to choose');
await R.click('#ps-aud-save'); await R.waitForTimeout(1400);
const pref = await one(`select audience, chosen from pasand_prefs where member_id = $1`, [rohan.id]);
ok('Rohan shares with Meera only', pref && pref.audience === 'chosen' && pref.chosen.join() === meera.id, JSON.stringify(pref));
await shotAll(R, 'pasand-mine', true);

const M = await phone(meera);
await pasand(M);
ok('MEERA, who was chosen, sees Rohan\'s likes and where he watches', /Rohan/.test(await M.textContent('#ps-people')) && /Panchayat/.test(await M.textContent('#ps-people')) && /Kishore Kumar/.test(await M.textContent('#ps-people')) && /Prime Video/.test(await M.textContent('#ps-people')));
ok('with a button to recommend something to him', /Recommend something to Rohan/.test(await M.textContent('#ps-people')));
await design(M, '#ps-people', 'what the family likes');
const P = await phone(papa, { big: true });
ok('Papa is in senior mode', await P.evaluate(() => document.body.classList.contains('senior')));
await pasand(P);
ok('PAPA, who was not chosen, is shown nothing of Rohan\'s', !/Panchayat|Kishore|Rohan/.test(await P.textContent('#ps-people')) && /Nobody else has shared/.test(await P.textContent('#ps-people')));
await design(P, SEC, 'Pasand, senior mode');

// ================================================================ 5. recommend to one person
await R.click('#ps-rec-open'); await R.waitForTimeout(400);
ok('the sheet opens with eight kinds and the whole family ticked', (await R.$$('#ps-r-kind [data-psk]')).length === 8 && await R.isChecked('#ps-r-all') && (await R.$$('#ps-r-to [data-psto]')).length === 2);
await R.click('#ps-r-send'); await R.waitForTimeout(200);
ok('with no name it is refused under the form', await R.isVisible('#ps-r-err') && /Write what you recommend/.test(await R.textContent('#ps-r-err')));
await R.fill('#ps-r-title', 'Panchayat');
await R.click('#ps-r-kind [data-psk="show"]');
await R.selectOption('#ps-r-plat', 'prime');
await R.fill('#ps-r-note', 'my login: rohan@example.com');
await R.check(`#ps-r-to [data-psto="${meera.id}"]`);
ok('ticking a person unticks the whole family', !(await R.isChecked('#ps-r-all')));
await R.click('#ps-r-send'); await R.waitForTimeout(1200);
ok('a sign-in in the note is refused, in plain words, and nothing is sent', (await R.textContent('#ps-r-err')) === NO_PASSWORD && (await one(`select count(*)::int as n from pasand_recs`)).n === 0);
await R.fill('#ps-r-note', 'You will love Pradhan ji.');
await R.fill('#ps-r-link', 'https://www.primevideo.com/detail/Panchayat');
await design(R, '#bondsheet .mp', 'recommend something');
await shotAll(R, 'pasand-recommend');
await R.click('#ps-r-send'); await R.waitForTimeout(1600);
const rec = await one(`select r.id, r.title, r.kind, r.platform, r.to_all, (select array_agg(member_id::text) from pasand_rec_to t where t.rec_id = r.id) as tos from pasand_recs r`);
ok('Rohan recommends Panchayat, on Prime Video, to Meera alone', rec && rec.title === 'Panchayat' && rec.kind === 'show' && rec.platform === 'prime' && rec.to_all === false && rec.tos.join() === meera.id, JSON.stringify(rec));
ok('the sheet closes and From me shows it, not answered yet', !(await R.isVisible('#bondsheet')) && await R.$eval('#ps-tabs [data-pstab="fromme"]', b => b.classList.contains('sel'))
   && /Panchayat/.test(await R.textContent('#ps-recs')) && /To Meera/.test(await R.textContent('#ps-recs')) && /Meera: no answer yet/.test(await R.textContent('#ps-recs')), await R.textContent('#ps-recs'));

// ================================================================ 6. the recipient: Today, and an answer
await go(M, '#home'); await reload(M);
await M.waitForSelector('#ps-today [data-psopen]', { timeout: 8000 }).catch(() => {});
const mToday = await M.textContent('#ps-today');
ok('MEERA\'S TODAY: "Rohan recommends Panchayat for you. On Prime Video."', mToday.includes('Rohan recommends Panchayat for you. On Prime Video.') && /Pradhan ji/.test(mToday), mToday);
await design(M, '#ps-today', 'the Today row');
await shotAll(M, 'pasand-today');
await go(P, '#home'); await reload(P);
ok('PAPA\'S TODAY has nothing: it was not for him', (await P.textContent('#ps-today')).trim() === '');
await pasand(P);
ok('and nothing under his For me', /Nothing for you yet/.test(await P.textContent('#ps-recs')) && !/Panchayat/.test(await P.textContent(SEC)));
await M.click('#ps-today [data-psopen]'); await M.waitForTimeout(500);
ok('See it opens the recommendation, with four answers and the link', await M.isVisible('#bondsheet') && /Rohan recommends/.test(await M.textContent('#bs-title')) && (await M.$$('#ps-ans [data-psans]')).length === 4
   && await M.$eval('#bs-body a.bondwide', a => a.getAttribute('href') === 'https://www.primevideo.com/detail/Panchayat'));
await M.click('#ps-ans-save'); await M.waitForTimeout(200);
ok('sending with no answer picked is refused there', await M.isVisible('#ps-ans-err') && /Pick one answer/.test(await M.textContent('#ps-ans-err')));
await M.click('#ps-ans [data-psans="saved"]');
await design(M, '#bondsheet .mp', 'answering a recommendation');
await shotAll(M, 'pasand-answer');
await M.click('#ps-ans-save'); await M.waitForTimeout(1500);
ok('Meera says Will try it', (await one(`select response from pasand_rec_to where rec_id = $1 and member_id = $2`, [rec.id, meera.id])).response === 'saved');
ok('once answered, it leaves her Today', (await M.textContent('#ps-today')).trim() === '');
await pasand(M);
ok('it stays under For me, with her answer', /Panchayat/.test(await M.textContent('#ps-recs')) && /Your answer: Will try it/.test(await M.textContent('#ps-recs')) && /From Rohan/.test(await M.textContent('#ps-recs')));
await M.click('#ps-recs [data-psopen]'); await M.waitForTimeout(400);
ok('her answer is shown as chosen when she opens it again', await M.$eval('#ps-ans [data-psans="saved"]', b => b.getAttribute('aria-pressed') === 'true'));
await M.click('#ps-ans [data-psans="loved"]');
await M.fill('#ps-ans-reply', 'Watched it all in two days.');
await M.click('#ps-ans-save'); await M.waitForTimeout(1500);
const ans = (await admin.query(`select response, reply from pasand_rec_to where rec_id = $1`, [rec.id])).rows;
ok('she changes it to Loved it, with a line: still one answer', ans.length === 1 && ans[0].response === 'loved' && ans[0].reply === 'Watched it all in two days.');
await design(M, '#ps-recs', 'For me, answered');

// ================================================================ 7. the sender sees the answer
await reload(R); await pasand(R);
await R.click('#ps-tabs [data-pstab="fromme"]'); await R.waitForTimeout(300);
const rFrom = await R.textContent('#ps-recs');
ok('ROHAN SEES WHO ANSWERED WITH WHAT: "Meera: Loved it" and her line', /Meera: Loved it/.test(rFrom) && /Watched it all in two days/.test(rFrom), rFrom);
await design(R, '#ps-recs', 'From me, answered');
await shotAll(R, 'pasand-fromme', true);

// ================================================================ 8. a person's page
await openPerson(M, rohan.id);
ok('ROHAN\'S PAGE, for Meera: his likes and where he watches', await M.isVisible('#ps-person-card') && /What Rohan likes/.test(await M.textContent('#ps-person-h'))
   && /Panchayat/.test(await M.textContent('#ps-person')) && /Prime Video/.test(await M.textContent('#ps-person')));
ok('with "Recommend something to Rohan"', (await M.textContent('#ps-person-rec')) === 'Recommend something to Rohan' && await M.isVisible('#ps-person-rec'));
await design(M, '#ps-person-card', 'likes on a person\'s page');
await shotAll(M, 'pasand-person');
await M.click('#ps-person-rec'); await M.waitForTimeout(400);
ok('it opens the sheet with Rohan already ticked', await M.isVisible('#bondsheet') && await M.isChecked(`#ps-r-to [data-psto="${rohan.id}"]`) && !(await M.isChecked('#ps-r-all')));
await M.fill('#ps-r-title', 'Gullak');
await M.click('#ps-r-send'); await M.waitForTimeout(1600);
ok('Meera recommends Gullak back to Rohan', (await one(`select count(*)::int as n from pasand_recs r join pasand_rec_to t on t.rec_id = r.id where r.title = 'Gullak' and r.by_member = $1 and t.member_id = $2`, [meera.id, rohan.id])).n === 1);
await openPerson(P, rohan.id);
ok('ROHAN\'S PAGE, for Papa: nothing is shared with him', /Rohan has not shared any likes with you yet/.test(await P.textContent('#ps-person')) && !/Panchayat/.test(await P.textContent('#ps-person-card')));
ok('Papa can still recommend something to Rohan', await P.isVisible('#ps-person-rec'));
await design(P, '#ps-person-card', 'likes on a person\'s page, nothing shared, senior mode');
await openPerson(R, rohan.id);
ok('on his own page Rohan sees his own, with a way to change them', /What I like/.test(await R.textContent('#ps-person-h')) && /Panchayat/.test(await R.textContent('#ps-person')) && (await R.textContent('#ps-person-rec')) === 'Add or change my likes');
await R.click('#ps-person-rec'); await R.waitForTimeout(900);
ok('which takes him to Pasand', await R.isVisible(SEC));

// ================================================================ 9. Today for the sender of the first one, and removal
await go(R, '#home'); await reload(R);
await R.waitForSelector('#ps-today [data-psopen]', { timeout: 8000 }).catch(() => {});
ok('Rohan\'s Today now has Meera\'s Gullak, with no platform named', /Meera recommends Gullak for you\./.test(await R.textContent('#ps-today')) && !/ On /.test(await R.textContent('#ps-today')));
await pasand(R);
await R.click('#ps-tabs [data-pstab="fromme"]'); await R.waitForTimeout(300);
await R.click('#ps-recs [data-psdel]'); await R.waitForTimeout(300);
await R.click('#as-yes'); await R.waitForTimeout(1500);
ok('Rohan removes what he sent, after being asked once', (await one(`select count(*)::int as n from pasand_recs where id = $1`, [rec.id])).n === 0 && /You have not recommended anything yet/.test(await R.textContent('#ps-recs')));
await reload(M); await pasand(M);
ok('and it is gone for Meera', !/Panchayat/.test(await M.textContent('#ps-recs')));

// ================================================================ 10. removing a like, and going back to the whole family
await R.click('#ps-likes [data-pslikedel]'); await R.waitForTimeout(1300);
ok('tapping a like removes it', (await one(`select count(*)::int as n from pasand_likes where member_id = $1`, [rohan.id])).n === 1);
await R.click('#ps-aud [data-psaud="me"]'); await R.waitForTimeout(1300);
ok('"Only me" is one tap', (await one(`select audience from pasand_prefs where member_id = $1`, [rohan.id])).audience === 'me' && /Only you can see/.test(await R.textContent('#ps-aud-note')));
await reload(M); await pasand(M);
ok('and now even Meera is shown nothing of Rohan\'s', !/Kishore|Prime Video/.test(await M.textContent('#ps-people')));

// ================================================================ 11. offline, and a server error
const OFF = await phone(rohan, { block: route => route.abort() });
await pasand(OFF);
ok('OFFLINE: said in plain words, in every list', /No connection\. Pasand will show when you are back online\./.test(await OFF.textContent('#ps-recs')) && /No connection/.test(await OFF.textContent('#ps-likes')) && /No connection/.test(await OFF.textContent('#ps-people')));
await OFF.fill('#ps-like-text', 'Gullak'); await OFF.click('#ps-like-add'); await OFF.waitForTimeout(600);
ok('OFFLINE: adding says so under the form', await OFF.isVisible('#ps-like-err') && /No connection/.test(await OFF.textContent('#ps-like-err')));
await design(OFF, SEC, 'Pasand, offline');
const ERR = await phone(rohan, { block: route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'relation "pasand_likes" does not exist' }) }) });
await pasand(ERR);
const errText = await ERR.textContent('#ps-recs');
ok('A SERVER ERROR is a plain sentence, never the database\'s words', /Could not load Pasand\. Try again in a moment\./.test(errText) && !/relation|does not exist/.test(await ERR.textContent(SEC)), errText);

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`pasand.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`pasand.e2e: ${pass}/${pass} checks pass`);
