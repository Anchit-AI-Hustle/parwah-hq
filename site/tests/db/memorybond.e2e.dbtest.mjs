// FAMILY MEMORY, END TO END: a real browser, the real API and a real
// PostgreSQL, with a fake microphone. What a family meets:
//
//   - Anchit picks Papa as a storyteller; Papa says yes on his own screen.
//   - Papa, in elder mode, answers this week's question by typing, and next
//     week by voice (recorded for real, kept small, never auto-played).
//   - The answers sit in Family Memory under Stories, grouped by person,
//     each heard only by whom Papa chose; the family book prints them.
//   - A family recipe, searchable, with a photo; a home cure is turned away.
//   - Yaadein and a private nudge on Anchit's Today.
//   - A group: the weekly throwback, answers side by side; the group cookbook.
//
// Every new screen is measured: 44px targets, 12px text, AA in light and
// dark, nothing sideways at 320 and 390. With MEMORYBOND_SHOT_DIR set, each
// is saved at 390 and 1440, light and dark.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('memorybond.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('memorybond.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('memorybond.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'ekta', 'plans']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { storySweep } = await import('../../../api/_memorybond.mjs');
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
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.0.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
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
// A fake microphone, so "Answer by voice" records for real in a headless browser.
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=user-gesture-required'] });
const SHOTS = process.env.MEMORYBOND_SHOT_DIR;
async function shotAll(page, name){
  if (!SHOTS) return;
  const was = page.viewportSize();
  for (const w of [390, 1440]) for (const sc of ['light', 'dark']) {
    await page.setViewportSize({ width: w, height: 900 }); await page.emulateMedia({ colorScheme: sc });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${w}-${sc}.png`, fullPage: false });
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
}
async function phone(who, { width = 390, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block', permissions: ['microphone'] });
  await ctx.addInitScript(([w]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: w.role || 'family', circleName: w.circleName }));
    if (w.kind) localStorage.setItem('parwah-circles', JSON.stringify([{ code: w.code, memberId: w.memberId, name: w.circleName, kind: w.kind, role: w.role || 'family' }]));
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  await page.waitForTimeout(1300);
  return page;
}
const call = async (name, body, query = {}, method = 'POST', token) => {
  let out, st = 200; const res = { status(s) { st = s; return this; }, json(j) { out = j; return this; }, setHeader() {} };
  await HANDLERS[name]({ method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.4.0.' + (++n % 250) }, query, body }, res);
  return { ...out, http: st };
};

// The new sheets are not on any main screen, so the design rules are
// measured here, inside each one: 44px targets, a 12px floor, WCAG AA in
// light and dark, and nothing sideways at 320px.
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
  const out = { overflow: document.scrollingElement.scrollWidth - innerWidth, bad: [] };
  root.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, textarea').forEach(el => {
    if (!vis(el)) return;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return;
    if (el.classList.contains('linkbtn') && getComputedStyle(el).display === 'inline') return;
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
  for (const [wd, sc] of [[320, 'light'], [390, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc }); await page.waitForTimeout(120);
    const m = await page.evaluate(measureIn, sel);
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
  ok('design: ' + label + ' - 44px targets, 12px floor, AA contrast in both themes, nothing sideways at 320', bad.length === 0, bad.slice(0, 5).join(' | '));
}
const reload = async (P) => { await P.reload(); await P.waitForTimeout(1400); };
const big = async (P, sel) => P.$$eval(sel, bs => bs.every(b => b.getBoundingClientRect().height >= 44));

// ---- the family: Anchit, his brother Rahul, Papa (elder mode)
const U = { Anchit: await user('Anchit') };
const made = await call('circle', { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Anchit', circleName: 'Tandon Family', userId: U.Anchit.userId, relation: 'son' }, {}, 'POST', U.Anchit.token);
const code = made.code;
await admin.query(`update circles set join_policy = 'open' where code = $1`, [code]);
U.Anchit.memberId = made.memberId;
for (const [name, rel] of [['Rahul', 'son'], ['Papa', 'father']]) {
  U[name] = await user(name);
  const j = await call('circle', { action: 'join', code, memberName: name, userId: U[name].userId, relation: rel }, {}, 'POST', U[name].token);
  U[name].memberId = j.memberId;
}
await admin.query(`update members set role = 'parent', gender = 'm' where id = $1`, [U.Papa.memberId]);
await admin.query(`update members m set phone = u.phone from users u where u.id = m.user_id`);
const famId = (await admin.query(`select id from circles where code = $1`, [code])).rows[0].id;
const as = (name) => ({ ...U[name], code, circleName: 'Tandon Family', role: name === 'Papa' ? 'parent' : 'family' });
const bond = (who, body) => call('book', { area: 'bond', code: who.code || code, memberId: who.memberId, ...body }, { area: 'bond' }, 'POST', who.token);

const A = await phone(as('Anchit'), { hash: '#home' });
const P = await phone(as('Papa'), { hash: '#home' });

// =====================================================================
// EK SAWAAL: the family picks a storyteller; Papa says yes on his screen
// =====================================================================
await A.click('#more summary'); await A.waitForTimeout(200);
await A.click('#morewidgets [data-mbv="stories"]'); await A.waitForTimeout(1400);
ok('More has Stories & recipes, and it opens Family Memory on Stories', await A.isVisible('#mb-stories') && /Family Memory/.test(await A.textContent('#pane-memory .ektahead')));
ok('an empty Stories says what to do next', /No stories yet\. Pick a storyteller/.test(await A.textContent('#mb-stories')));
await shotAll(A, 'stories-empty');
await A.click('#mb-stories [data-mbtool="teller"]'); await A.waitForTimeout(300);
ok('the storyteller sheet says nothing is asked until they say yes', /Nothing is asked until they say yes/.test(await A.textContent('#mbsheet')));
await design(A, '#mbsheet', 'pick a storyteller sheet');
await shotAll(A, 'teller-pick');
await A.click(`#mbsheet [data-mbinvite="${U.Papa.memberId}"]`); await A.waitForTimeout(1300);
ok('Anchit asks Papa', (await admin.query(`select status from story_tellers where member_id = $1`, [U.Papa.memberId])).rows[0].status === 'asked');
ok('nothing is asked before Papa says yes', (await admin.query(`select count(*)::int as n from stories`)).rows[0].n === 0);

await reload(P);
ok('Papa is in big, calm elder mode', await P.evaluate(() => document.body.classList.contains('senior')));
ok('Papa sees the ask on his own Today, by name', /Anchit asks: will you tell the family one story a week\?/.test(await P.textContent('#mb-today')));
await shotAll(P, 'teller-ask-elder');
await design(P, '#mb-today', 'the storyteller ask on an elder\'s Today');
await P.click('#mb-today [data-mbteller="yes"]'); await P.waitForTimeout(1500);
const q1 = await P.textContent('#mb-today');
ok('Papa says yes: "This week\'s question" is on his Today', /This week’s question/.test(q1) && /What is your earliest memory\?/.test(q1), q1.slice(0, 120));
ok('with Answer by voice, Type it and Skip, each a big button', await big(P, '#mb-today .cbtn') && (await P.$$('#mb-today [data-mbans], #mb-today [data-mbskip]')).length === 3);
await shotAll(P, 'question-elder');
await design(P, '#mb-today', 'this week\'s question, elder mode');

// ---- answer by typing
await P.click('#mb-today [data-mbans="type"]'); await P.waitForTimeout(500);
await P.click('#mbs-save'); await P.waitForTimeout(200);
ok('saving nothing says what is needed, in the sheet', await P.isVisible('#mbs-err'));
await P.fill('#mbs-text', 'Our house in Amritsar. Ma would sing while drying the clothes on the roof.');
await shotAll(P, 'answer-type');
await design(P, '#mbsheet', 'the answer sheet');
await P.click('#mbs-save'); await P.waitForTimeout(1500);
ok('the typed answer is saved, for the whole family', (await admin.query(`select visibility from stories where answered_at is not null and about_member = $1`, [U.Papa.memberId])).rows[0]?.visibility === 'circle');
ok('and the question leaves Papa\'s Today', !/This week’s question/.test(await P.textContent('#mb-today')));

// ---- next week: answer by voice, with the fake microphone
await admin.query(`update stories set ask_week = ask_week - 7, asked_at = asked_at - interval '7 days' where about_member = $1`, [U.Papa.memberId]);
await storySweep(db(), famId);
await reload(P);
ok('next week brings the next question', /What games did you play as a child\?/.test(await P.textContent('#mb-today')));
await P.click('#mb-today [data-mbans="voice"]'); await P.waitForTimeout(500);
await P.click('#mbs-rec [data-mbrec]'); await P.waitForTimeout(2600);
ok('recording shows the time and that it stops by itself', /Recording… 0:0\d \(stops by itself at 3:00\)/.test(await P.textContent('#mbs-rec')), await P.textContent('#mbs-rec'));
await P.click('#mbs-rec [data-mbrec]'); await P.waitForTimeout(1200);
ok('stopped: recorded, with a player that does not play by itself', /Recorded 0:0\d/.test(await P.textContent('#mbs-rec')) && await P.$eval('#mbs-rec audio', a => !a.autoplay && a.paused));
await shotAll(P, 'answer-voice');
await P.selectOption('#mbs-vis', 'some'); await P.waitForTimeout(100);
await P.check(`#mbs-some input[value="${U.Anchit.memberId}"]`);
await P.click('#mbs-save'); await P.waitForTimeout(1800);
const v = (await admin.query(`select audio, audio_secs, visibility, share_with from stories where about_member = $1 and audio is not null`, [U.Papa.memberId])).rows[0];
ok('the voice answer is kept: webm or ogg, a few seconds, for Anchit only', v && /^data:audio\/(webm|ogg);base64,/.test(v.audio) && v.audio_secs >= 2 && v.audio_secs <= 5 && v.visibility === 'some' && v.share_with.length === 1, v && (v.audio.slice(0, 30) + ' ' + v.audio_secs));

// ---- Anchit sees both in Stories, grouped under Papa; Rahul sees one
await A.goto(BASE + '/#memory'); await A.waitForTimeout(1300);
await A.click('#mb-switch [data-mbv="stories"]'); await A.waitForTimeout(1300);
const st = await A.textContent('#mb-stories');
ok('Stories: Papa, 2 stories, newest first', /Papa · 2 stories/.test(st) && st.indexOf('What games did you play') < st.indexOf('What is your earliest memory'), st.slice(0, 200));
await A.click('#mb-stories [data-mblisten]'); await A.waitForTimeout(900);
ok('Listen loads the voice only on a tap, and never plays it by itself', await A.$eval('#mb-stories audio', a => a.paused && /^data:audio/.test(a.src)));
await shotAll(A, 'stories-list');
await design(A, '#mb-stories', 'Stories in Family Memory');
const R = await phone(as('Rahul'), { hash: '#memory' });
await R.click('#mb-switch [data-mbv="stories"]'); await R.waitForTimeout(1300);
ok('Rahul sees only the story Papa shared with everyone', /Papa · 1 story/.test(await R.textContent('#mb-stories')));
await R.close();

// ---- the family book: prints nicely
await A.click('#mb-stories [data-mbtool="book"]'); await A.waitForTimeout(400);
const bk = await A.textContent('#mb-book');
ok('the family book lays out every story Anchit may read, by person', /Tandon Family: our book of stories/.test(bk) && /Papa/.test(bk) && /Amritsar/.test(bk) && /Told by voice/.test(bk));
await shotAll(A, 'family-book');
await design(A, '#mb-book', 'the family book');
await A.emulateMedia({ media: 'print' });
const pr = await A.evaluate(() => ({ book: getComputedStyle(document.getElementById('mb-book')).display, bar: getComputedStyle(document.querySelector('.mbbook-bar')).display,
  others: [...document.body.children].filter(e => e.id !== 'mb-book' && getComputedStyle(e).display !== 'none').map(e => e.id || e.className) }));
ok('in print, only the book shows: no app, no buttons', pr.book !== 'none' && pr.bar === 'none' && pr.others.length === 0, JSON.stringify(pr));
await A.emulateMedia({ media: 'screen' });
await A.click('#mbb-close'); await A.waitForTimeout(200);
ok('Close takes the book away', await A.isHidden('#mb-book') && !(await A.evaluate(() => document.body.classList.contains('mbprint'))));

// =====================================================================
// RASOI: a family recipe
// =====================================================================
await A.click('#mb-switch [data-mbv="recipes"]'); await A.waitForTimeout(400);
ok('Recipes start empty, with what to add', /No recipes yet/.test(await A.textContent('#mb-recipes')));
await A.click('#mb-recipes [data-mbtool="recipe"]'); await A.waitForTimeout(300);
ok('the add form says recipes are for food', /Recipes here are for food/.test(await A.textContent('#mbsheet')));
await design(A, '#mbsheet', 'the recipe form');
await shotAll(A, 'recipe-form');
await A.fill('#mbr-title', 'Haldi doodh nuskha'); await A.fill('#mbr-steps', 'Warm milk');
await A.click('#mbs-save'); await A.waitForTimeout(1200);
ok('a home cure is turned away kindly, in the sheet', /for food only/.test(await A.textContent('#mbs-err')));
await A.fill('#mbr-title', 'Rajma chawal'); await A.fill('#mbr-from', 'Mummy'); await A.fill('#mbr-mem', 'Mummy made this every Sunday');
await A.fill('#mbr-ing', 'Rajma\nOnion\nTomato'); await A.fill('#mbr-steps', 'Soak overnight.\nCook slow, with love.');
await A.setInputFiles('#mbr-photo', { name: 'r.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8Dwn4EIwDiqkL4KAZKsBf9n7YqmAAAAAElFTkSuQmCC', 'base64') });
await A.waitForTimeout(500);
await A.click('#mbs-save'); await A.waitForTimeout(1500);
const rc = (await admin.query(`select title, photo from recipes`)).rows;
ok('Mummy\'s rajma is saved, with a small photo', rc.length === 1 && rc[0].title === 'Rajma chawal' && /^data:image\/jpeg/.test(rc[0].photo || ''));
await A.fill('#mb-rsearch', 'rajma'); await A.waitForTimeout(150);
ok('search finds it', (await A.$$('#mb-rlist [data-mbrecipe]')).length === 1);
await A.fill('#mb-rsearch', 'biryani'); await A.waitForTimeout(150);
ok('and says when nothing matches', /No recipe matches/.test(await A.textContent('#mb-rlist')));
await A.fill('#mb-rsearch', ''); await A.waitForTimeout(150);
await shotAll(A, 'recipes-list');
await design(A, '#mb-recipes', 'the recipe list');
await A.click('#mb-rlist [data-mbrecipe]'); await A.waitForTimeout(900);
ok('opening it shows the photo, the memory and the steps', await A.isVisible('#mbsheet img.mbphoto') && /Mummy made this every Sunday/.test(await A.textContent('#mbsheet')) && /Cook slow/.test(await A.textContent('#mbsheet')));
await shotAll(A, 'recipe-open');
await design(A, '#mbsheet', 'a recipe');
await A.click('#mbs-x'); await A.waitForTimeout(200);

// =====================================================================
// YAADEIN and the NUDGE on Today
// =====================================================================
const chat = (await admin.query(`select id from chats where circle_id = $1 and kind = 'circle'`, [famId])).rows[0]
  || (await admin.query(`insert into chats (circle_id, kind, name) values ($1, 'circle', 'Everyone') returning id`, [famId])).rows[0];
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8Dwn4EIwDiqkL4KAZKsBf9n7YqmAAAAAElFTkSuQmCC';
await admin.query(`insert into messages (chat_id, member_id, text, kind, created_at) values ($1, $2, $3, 'image', now() - interval '2 years')`, [chat.id, U.Rahul.memberId, png]);
await admin.query(`delete from yaad_days`);
await A.click('#mb-switch [data-mbv="settings"]'); await A.waitForTimeout(400);
ok('Settings: nudges are off until you turn them on', !(await A.isChecked('#mb-n-on')));
await shotAll(A, 'memory-settings');
await design(A, '#mb-settings', 'Memory settings');
await A.check('#mb-n-on'); await A.selectOption('#mb-n-weeks', '2'); await A.click('#mb-n-save'); await A.waitForTimeout(1200);
ok('Anchit turns nudges on, 2 weeks', (await admin.query(`select nudges_on, nudge_weeks from bond_prefs where member_id = $1`, [U.Anchit.memberId])).rows[0].nudge_weeks === 2);
await admin.query(`update members set created_at = now() - interval '60 days' where circle_id = $1`, [famId]);
await admin.query(`delete from bond_nudges`);
await A.goto(BASE + '/#home'); await reload(A);
const td = await A.textContent('#mb-today');
ok('Yaadein: "2 years ago today", a photo Rahul shared', /Yaadein: 2 years ago today/.test(td) && /A photo Rahul shared/.test(td) && await A.isVisible('#mb-yaadimg'), td.slice(0, 200));
ok('the nudge: "It has been a while with", Call, Voice note, Later', /It has been a while with (Papa|Rahul)\./.test(td) && /Only you see this/.test(td) && !!(await A.$('#mb-today a[href^="tel:"]')) && !/lonely|score/i.test(td), td);
await shotAll(A, 'today-yaad-nudge');
await design(A, '#mb-today', 'Yaadein and the nudge on Today');
ok('Papa sees no nudge: it is Anchit\'s alone', !/It has been a while/.test(await (async () => { await reload(P); return P.textContent('#mb-today'); })()));
await A.click('#mb-today [data-mbyaad="send"]'); await A.waitForTimeout(1500);
ok('"Send to everyone who was there" posts it to the family chat', (await admin.query(`select count(*)::int as n from messages where chat_id = $1 and text like '🌼 Yaadein: 2 years ago today%'`, [chat.id])).rows[0].n === 1
   && !/Yaadein/.test(await A.textContent('#mb-today')));
await A.click('#mb-today [data-mbnudge="later"]'); await A.waitForTimeout(1500);
ok('Later puts the nudge away for the week', !/It has been a while/.test(await A.textContent('#mb-today')) && (await admin.query(`select status from bond_nudges where member_id = $1`, [U.Anchit.memberId])).rows[0].status === 'later');

// =====================================================================
// A GROUP: the throwback question, answers side by side; the group cookbook
// =====================================================================
const g = await call('circle', { action: 'create', kind: 'group', memberName: 'Anchit', circleName: 'Hostel B', userId: U.Anchit.userId }, {}, 'POST', U.Anchit.token);
await admin.query(`update circles set join_policy = 'open' where code = $1`, [g.code]);
U.Vikram = await user('Vikram');
const vj = await call('circle', { action: 'join', code: g.code, memberName: 'Vikram', userId: U.Vikram.userId }, {}, 'POST', U.Vikram.token);
await bond({ ...U.Vikram, memberId: vj.memberId, code: g.code }, { action: 'throwback_answer', text: 'Mrs Iyer, no contest' });
const G = await phone({ ...U.Anchit, memberId: g.memberId, code: g.code, circleName: 'Hostel B', kind: 'group' }, { hash: '#home' });
const gt = await G.textContent('#mb-today');
ok('the group\'s Today has this week\'s throwback, with Vikram\'s answer', /Throwback question/.test(gt) && /Mrs Iyer, no contest/.test(gt), gt.slice(0, 160));
await G.click('#mb-today [data-mbtb]'); await G.waitForTimeout(300);
await G.fill('#as-in', 'Sharma sir. Still scared.'); await G.click('#as-yes'); await G.waitForTimeout(1500);
ok('Anchit answers: both answers side by side', (await G.$$('#mb-today .mbside div')).length === 2 && /Change my answer/.test(await G.textContent('#mb-today')));
await shotAll(G, 'group-throwback');
await design(G, '#mb-today', 'the group throwback on Today');
await G.goto(BASE + '/#memory'); await G.waitForTimeout(1300);
await G.click('#mb-switch [data-mbv="recipes"]'); await G.waitForTimeout(1300);
ok('the group gets a group cookbook', /group cookbook/.test(await G.textContent('#mb-recipes')) && /hostel classic/.test(await G.textContent('#mb-recipes')));
await G.click('#mb-switch [data-mbv="stories"]'); await G.waitForTimeout(400);
ok('group Stories keep the throwback answers', /Throwback answers/.test(await G.textContent('#mb-stories')) && /Sharma sir/.test(await G.textContent('#mb-stories')));
await shotAll(G, 'group-stories');
await design(G, '#mb-stories', 'group Stories');

ok('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(`\nmemorybond.e2e: ${pass} passed, ${fails.length} failed`);
await browser.close(); server.close(); await admin.end();
process.exit(fails.length ? 1 : 0);
