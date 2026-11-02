// VOICE NOTES, REACTIONS AND POLLS, END TO END: real Chromium with a fake
// microphone, the real /api/chats handler and a real PostgreSQL.
//
// What it proves, in the app as a person uses it:
//   - Rohan taps the mic, sees a timer, stops, hears it first, sends it; a
//     second one is cancelled and never sent; nothing ever plays by itself;
//     play, pause and 1.5x work; a phone that says no to the microphone gets
//     a plain sentence, not a console error.
//   - He reacts with the small button and by a long press; tapping the
//     count shows who; tapping the same reaction again takes it back.
//   - He asks a poll, votes, sees who voted, closes it.
//   - Nani, in senior mode, holds the big bar to talk and lets go to send;
//     sliding away cancels; one big "Dekh liya"; poll choices are big.
//   - In a friends' group the same tools say "group", not "family".
//   - Every new screen: 44px targets, a 12px floor, AA contrast in light and
//     dark, and no sideways scroll at 320 and 390.
import http from 'http';
import { readFile, mkdir } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('chatbond.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('chatbond.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('chatbond.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['care', 'events', 'chats', 'auth', 'book', 'plans', 'settings', 'circle']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function person(circleId, code, name, role = 'family', relation = null, existing = null) {
  let u = existing;
  if (!u) {
    const phone = '+9198600' + String(++n).padStart(5, '0');
    const h = hashPin('4819');
    const row = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                    values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
    const token = newToken();
    await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), row.id]);
    u = { userId: row.id, token, phone };
  }
  const m = (await admin.query(`insert into members (circle_id, name, role, relation, user_id) values ($1,$2,$3,$4,$5) returning id`, [circleId, name, role, relation, u.userId])).rows[0];
  return { id: m.id, userId: u.userId, name, token: u.token, phone: u.phone, code, role };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const grp = (await admin.query(`insert into circles (code, name, kind) values ('YAARON','College Yaar','group') returning id`)).rows[0].id;
const rohan = await person(fam, 'SHARMA', 'Rohan', 'family', 'son');
const nani = await person(fam, 'SHARMA', 'Nani', 'parent', 'grandmother');
const rohanG = await person(grp, 'YAARON', 'Rohan', 'family', null, rohan);
await person(grp, 'YAARON', 'Kabir', 'family');

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
const SHOTS = process.env.SHOTS || '';
if (SHOTS) await mkdir(SHOTS, { recursive: true });

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || !detail ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };
const errors = [];
const q1 = async (sql, args) => (await admin.query(sql, args || [])).rows[0];
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

async function phone(who, { senior = false, width = 390, height = 844, circleName = 'Sharma Family' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Kolkata', serviceWorkers: 'block', permissions: ['microphone'] });
  await ctx.addInitScript(([w, senior, circleName]) => {
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.id, name: w.name, role: w.role, circleName }));
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
    localStorage.setItem('parwah-big', senior ? '1' : '0');
    // Every play() is counted: nothing may start by itself.
    window.__plays = 0;
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__plays++; window.__lastAudio = this; return orig.apply(this, arguments); };
  }, [who, senior, circleName]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|fonts\.g/.test(m.text())) errors.push(who.name + ' console: ' + m.text()); });
  await page.goto(BASE + '/#chat'); await page.waitForTimeout(1500);
  return page;
}
async function openFamilyChat(page, code = 'SHARMA') {
  await page.evaluate(() => { location.hash = '#chat'; }); await page.waitForTimeout(300);
  if (await page.isVisible('#chatback')) { await page.click('#chatback'); await page.waitForTimeout(300); }
  const id = (await q1(`select c.id from chats c join circles ci on ci.id = c.circle_id where ci.code = $1 and c.kind = 'circle'`, [code])).id;
  await page.click(`[data-open="${id}"]`); await page.waitForTimeout(1000);
  return id;
}
const count = async (sql, args) => (await q1(sql, args)).n;
const toastText = (p) => p.textContent('#toast');

// Measured on what this feature adds, in one pass (as design.browser.mjs does).
function measure([minTap, sel]) {
  const roots = [...document.querySelectorAll(sel)];
  const inRoots = (el) => roots.some(r => r.contains(el));
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && !el.closest('[hidden]'); };
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '')) + ' "' + (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 24) + '"';
  const L = (c) => { const m = c.match(/[\d.]+/g); if (!m) return 1; return m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map(s => s.trim()); return p.length === 4 ? +p[3] : 1; };
  const bgOf = (el) => { let n = el; while (n) { const c = getComputedStyle(n);
      if (alpha(c.backgroundColor) > 0.9) return [c.backgroundColor];
      if (n !== document.body && n !== document.documentElement && c.backgroundImage && c.backgroundImage !== 'none') {
        if (/url\(/.test(c.backgroundImage)) return null;
        const stops = (c.backgroundImage.match(/rgba?\([^)]+\)/g) || []).filter(s => alpha(s) > 0.5);
        if (stops.length) return stops;
      }
      n = n.parentElement; }
    return [getComputedStyle(document.body).backgroundColor]; };
  const out = { overflow: document.scrollingElement.scrollWidth - innerWidth, small: [], tiny: [], lowc: [], controls: 0 };
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary').forEach(el => {
    if (!vis(el) || !inRoots(el)) return;
    if (el.type === 'checkbox' || el.type === 'radio') { const lab = el.closest('label'); if (lab) return; }
    out.controls++;
    const r = el.getBoundingClientRect();
    if (Math.min(r.height, r.width) < minTap - 0.5) out.small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el || seen.has(el) || !vis(el) || !inRoots(el)) continue; seen.add(el);
    if (el.closest('svg, [aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
    if (size < 12 - 0.01) out.tiny.push(name(el) + ' ' + size.toFixed(1) + 'px');
    const bgs = bgOf(el); if (!bgs) continue;
    const a = L(cs.color);
    const op = +cs.opacity < 1 ? +cs.opacity : 1;
    const ratio = Math.min(...bgs.map(bg => { const b = L(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    if (op >= 1 && alpha(cs.color) > 0.5 && ratio < (large ? 3 : 4.5) - 0.01) out.lowc.push(name(el) + ' ' + ratio.toFixed(2));
  }
  return out;
}
const SEL = '#chatview, #composer, #rxsheet:not([hidden]) .mp, #pollsheet:not([hidden]) .mp, #bondsheet:not([hidden]) .mp';
async function sane(page, label) {
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme }); await page.waitForTimeout(150);
    for (const w of [320, 390]) {
      await page.setViewportSize({ width: w, height: 844 }); await page.waitForTimeout(200);
      const m = await page.evaluate(measure, [44, SEL]);
      ok(`${label}, ${theme} ${w}px: nothing scrolls sideways`, m.overflow <= 0, m.overflow + 'px');
      ok(`${label}, ${theme} ${w}px: every control is 44px (${m.controls} measured)`, m.small.length === 0 && m.controls > 0, m.small.join(' | '));
      ok(`${label}, ${theme} ${w}px: no text under 12px`, m.tiny.length === 0, m.tiny.join(' | '));
      ok(`${label}, ${theme} ${w}px: every text passes AA`, m.lowc.length === 0, m.lowc.join(' | '));
    }
  }
  await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 390, height: 844 });
}
async function shots(page, name) {
  if (!SHOTS) return;
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: w > 900 ? 900 : 844 }); await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/${name}-${w}-${theme}.png` });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 390, height: 844 });
}

// A message from Nani for Rohan to react to.
await (async () => {
  const sql = db();
  const { ensureCircleChat } = await import('../../../api/_db.mjs');
  await ensureCircleChat(sql, fam);
  const c = (await admin.query(`select id from chats where circle_id = $1 and kind = 'circle'`, [fam])).rows[0].id;
  await admin.query(`insert into messages (chat_id, member_id, text, created_at) values ($1, $2, 'Khana kha liya, beta?', now() - interval '5 minutes')`, [c, nani.id]);
})();

// ---- 1. Rohan: a voice note, tap to record, hear it, send
const R = await phone(rohan);
const famChat = await openFamilyChat(R);
ok('the mic sits beside the photo button', await R.isVisible('#cmic') && await R.isVisible('#ecam'));
ok('nothing has played by itself', (await R.evaluate(() => window.__plays)) === 0);
await R.click('#cmic'); await R.waitForTimeout(1400);
ok('recording shows a timer out of a minute, with Cancel and Stop', await R.isVisible('#vnbar') && /^Recording 0:0\d of 1:00$/.test(await R.textContent('#vn-clock'))
   && await R.isVisible('#vn-cancel') && await R.isVisible('#vn-stop') && !(await R.isVisible('#msg')), await R.textContent('#vn-clock'));
await R.waitForTimeout(1300);
if (SHOTS) await shots(R, 'voice-recording');
await R.click('#vn-stop'); await R.waitForTimeout(800);
ok('stopped: heard first, with Delete and Send', await R.isVisible('#vn-prev .vn-play') && await R.isVisible('#vn-send') && (await R.textContent('#vn-cancel')) === 'Delete');
ok('and still nothing played by itself', (await R.evaluate(() => window.__plays)) === 0);
await R.click('#vn-prev .vn-play'); await R.waitForTimeout(600);
ok('Rohan plays it back before sending', (await R.evaluate(() => window.__plays)) === 1 && /^Pause/.test(await R.getAttribute('#vn-prev .vn-play', 'aria-label')));
if (SHOTS) await shots(R, 'voice-preview');
await R.click('#vn-send'); await R.waitForTimeout(1500);
const sent = await q1(`select kind, audio_secs, length(text) as len, text like 'data:audio/webm;base64,%' as webm from messages where kind = 'audio'`);
ok('it is sent as a small webm, 2 to 4 seconds long', sent && sent.webm && sent.audio_secs >= 2 && sent.audio_secs <= 4 && sent.len < 60000, JSON.stringify(sent));
ok('the composer is back', await R.isVisible('#msg') && !(await R.isVisible('#vnbar')));
ok('the chat shows a player with its length', /^0:0[2-4]$/.test((await R.textContent('#cmsgs .vn .vn-time')).trim()));
const plays0 = await R.evaluate(() => window.__plays);
await R.click('#cmsgs .vn .vn-play'); await R.waitForTimeout(700);
ok('tap to play: it plays', (await R.evaluate(() => window.__plays)) === plays0 + 1 && /^Pause/.test(await R.getAttribute('#cmsgs .vn .vn-play', 'aria-label')));
await R.click('#cmsgs .vn .vn-speed');
ok('1x becomes 1.5x', (await R.textContent('#cmsgs .vn .vn-speed')) === '1.5x' && await R.evaluate(() => window.__lastAudio && window.__lastAudio.playbackRate === 1.5));
await R.click('#cmsgs .vn .vn-play'); await R.waitForTimeout(200);
ok('and pauses', /^Play/.test(await R.getAttribute('#cmsgs .vn .vn-play', 'aria-label')));
await R.click('#cmsgs .vn .vn-speed');
const last = (await (await fetch(BASE + '/api/chats?circle=SHARMA&member=' + rohan.id, { headers: { 'x-parwah-token': rohan.token } })).json()).chats.find(c => c.id === famChat).last;
ok('the chat list reads "🎙 Voice note (0:0N)"', /^🎙 Voice note \(0:0[2-4]\)$/.test(last.text), last.text);

// Cancelled: never sent.
await R.click('#cmic'); await R.waitForTimeout(1200);
await R.click('#vn-cancel'); await R.waitForTimeout(600);
ok('Cancel throws it away: nothing sent', (await count(`select count(*)::int as n from messages where kind = 'audio'`)) === 1 && await R.isVisible('#msg'));

// The microphone refused: a plain sentence.
const errsBefore = errors.length;
await R.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
await R.click('#cmic'); await R.waitForTimeout(400);
ok('microphone not allowed: a plain sentence, no error', /microphone is off for Parwah/.test(await toastText(R)) && errors.length === errsBefore && await R.isVisible('#msg'), await toastText(R));
await sane(R, 'chat with a voice note');

// ---- 2. Reactions
const naniMsg = (await q1(`select id from messages where text = 'Khana kha liya, beta?'`)).id;
await R.click(`.em[data-mid="${naniMsg}"] .rx-add`); await R.waitForTimeout(300);
ok('the small react button opens five reactions', await R.isVisible('#rxsheet') && (await R.$$eval('#rx-row button', bs => bs.map(b => b.textContent).join(''))) === '❤️🙏😂👏😮');
await sane(R, 'reaction picker');
if (SHOTS) await shots(R, 'reaction-picker');
await R.click('#rx-row [data-rxpick="🙏"]'); await R.waitForTimeout(1000);
ok('🙏 1 under Nani\'s message', (await R.textContent(`.em[data-mid="${naniMsg}"] .rx-chip`)).trim() === '🙏 1');
// A long press opens the same choice.
const bub = await R.locator(`.em[data-mid="${naniMsg}"] .from`).boundingBox();
await R.mouse.move(bub.x + 5, bub.y + 5); await R.mouse.down(); await R.waitForTimeout(700); await R.mouse.up(); await R.waitForTimeout(300);
ok('a long press opens it too, showing his 🙏', await R.isVisible('#rxsheet') && (await R.getAttribute('#rx-row [data-rxpick="🙏"]', 'aria-pressed')) === 'true');
await R.click('#rx-row [data-rxpick="❤️"]'); await R.waitForTimeout(1000);
ok('picking another changes it: one reaction from him', (await count(`select count(*)::int as n from message_reactions where message_id = $1`, [naniMsg])) === 1
   && (await R.textContent(`.em[data-mid="${naniMsg}"] .rx-chip`)).trim() === '❤️ 1');
await R.click(`.em[data-mid="${naniMsg}"] .rx-chip`); await R.waitForTimeout(300);
ok('tapping the count shows who reacted', /❤️ You/.test(await R.textContent('#rx-who')));
await R.click('#rx-row [data-rxpick="❤️"]'); await R.waitForTimeout(1000);
ok('the same one again takes it back', (await count(`select count(*)::int as n from message_reactions where message_id = $1`, [naniMsg])) === 0
   && (await R.locator(`.em[data-mid="${naniMsg}"] .rx-chip`).count()) === 0);
await R.click(`.em[data-mid="${naniMsg}"] .rx-add`); await R.waitForTimeout(300);
await R.click('#rx-row [data-rxpick="❤️"]'); await R.waitForTimeout(1000);
await R.click('#chatback'); await R.waitForTimeout(500);
ok('the chat list does not change for a reaction', /Rohan: 🎙 Voice note/.test(await R.textContent('#clist .chatrow >> nth=0')), await R.textContent('#clist .chatrow >> nth=0'));
await openFamilyChat(R);

// ---- 3. A poll
await R.click('#cv-poll'); await R.waitForTimeout(300);
ok('Poll opens a sheet: "Ask the family", two choices to start', await R.isVisible('#pollsheet') && (await R.textContent('#pl-title')) === 'Ask the family'
   && (await R.locator('#pl-opts input').count()) === 2);
await R.click('#pl-create'); await R.waitForTimeout(200);
ok('an empty poll says what is missing', (await R.textContent('#pl-err')) === 'Write the question first');
await R.fill('#pl-q', 'Sunday lunch at whose house?');
const ins = R.locator('#pl-opts input');
await ins.nth(0).fill("Nani's"); await ins.nth(1).fill("Meera's");
await R.click('#pl-more'); await R.locator('#pl-opts input').nth(2).fill('Order in');
await sane(R, 'poll sheet');
if (SHOTS) await shots(R, 'poll-sheet');
await R.click('#pl-create'); await R.waitForTimeout(1500);
ok('the poll is asked', !(await R.isVisible('#pollsheet')) && (await count(`select count(*)::int as n from chat_polls`)) === 1);
ok('and shows its three choices', (await R.locator('#cmsgs .pl-opt').count()) === 3);
await R.click('#cmsgs .pl-opt >> nth=0'); await R.waitForTimeout(1000);
ok('Rohan votes: ticked, counted', (await R.getAttribute('#cmsgs .pl-opt >> nth=0', 'aria-pressed')) === 'true' && (await R.textContent('#cmsgs .pl-opt >> nth=0 >> .pl-n')) === '1');
await R.click('#cmsgs .pl-opt >> nth=2'); await R.waitForTimeout(1000);
ok('and changes his vote', (await R.getAttribute('#cmsgs .pl-opt >> nth=2', 'aria-pressed')) === 'true' && (await R.textContent('#cmsgs .pl-opt >> nth=0 >> .pl-n')) === '0');
await R.click('#cmsgs [data-plwho]'); await R.waitForTimeout(300);
ok('Who voted lists names per choice', /Order in\s*You/.test(await R.textContent('#bd-list')) && /Nobody yet/.test(await R.textContent('#bd-list')));
await sane(R, 'who voted');
await R.click('#bd-x');
await sane(R, 'chat with a poll');
if (SHOTS) await shots(R, 'chat-normal');

// ---- 4. Nani, in senior mode
const N = await phone(nani, { senior: true });
await openFamilyChat(N);
ok('senior mode: the big hold bar, not the small mic', await N.isVisible('#vnhold') && !(await N.isVisible('#cmic'))
   && (await N.textContent('#vnhold')) === '🎙 Hold to talk, let go to send');
const dekh = N.locator('#dekhwrap .dekh');
ok('one big "Dekh liya" for the latest message', await dekh.isVisible() && /Dekh liya\s*Tell Rohan you saw it/.test(await dekh.textContent()) && (await dekh.boundingBox()).height >= 64);
const pl = await N.locator('#cmsgs .pl-opt >> nth=0').boundingBox();
ok('poll choices are big buttons', pl.height >= 56, pl.height);
await sane(N, 'senior chat');
if (SHOTS) await shots(N, 'chat-senior');
await dekh.click(); await N.waitForTimeout(1200);
const latest = (await q1(`select id from messages where member_id = $1 order by created_at desc limit 1`, [rohan.id])).id;
ok('Dekh liya puts her ❤️ on it', (await q1(`select emoji from message_reactions where member_id = $1 and message_id = $2`, [nani.id, latest]) || {}).emoji === '❤️');
ok('and says so', /You told Rohan you saw it/.test(await N.textContent('#dekhwrap')));
await N.click('#cmsgs .pl-opt >> nth=1'); await N.waitForTimeout(1000);
ok('Nani votes with one tap', (await count(`select count(*)::int as n from poll_votes`)) === 2);

let cx, cy;
const press = async () => {
  await N.locator('#vnhold').scrollIntoViewIfNeeded();
  const box = await N.locator('#vnhold').boundingBox();
  cx = box.x + box.width / 2; cy = box.y + box.height / 2;
  await N.mouse.move(cx, cy); await N.mouse.down();
};
await press(); await N.waitForTimeout(2600);
ok('holding: it records, and says how to send or cancel', /Let go to send, slide away to cancel/.test(await N.textContent('#vnhold')));
if (SHOTS) await N.screenshot({ path: `${SHOTS}/hold-to-talk-390-light.png` });
await N.mouse.up(); await N.waitForTimeout(1800);
ok('let go: it is sent, no preview', (await count(`select count(*)::int as n from messages where kind = 'audio' and member_id = $1`, [nani.id])) === 1);
await press(); await N.waitForTimeout(1500);
await N.mouse.move(cx, cy - 160, { steps: 5 }); await N.waitForTimeout(200);
ok('sliding away says let go to cancel', (await N.textContent('#vnhold')) === 'Let go to cancel');
await N.mouse.up(); await N.waitForTimeout(1200);
ok('and nothing is sent', (await count(`select count(*)::int as n from messages where kind = 'audio' and member_id = $1`, [nani.id])) === 1
   && (await N.textContent('#vnhold')) === '🎙 Hold to talk, let go to send');
await press(); await N.waitForTimeout(150); await N.mouse.up(); await N.waitForTimeout(800);
ok('a tap that is too short says to keep holding', /Keep holding the button/.test(await toastText(N))
   && (await count(`select count(*)::int as n from messages where kind = 'audio' and member_id = $1`, [nani.id])) === 1);
ok('nothing played by itself on Nani\'s phone either', (await N.evaluate(() => window.__plays)) === 0);

// Rohan closes the poll.
await openFamilyChat(R);
await R.click('#cmsgs [data-plclose]'); await R.waitForTimeout(300);
await R.click('#as-yes'); await R.waitForTimeout(1200);
ok('the person who asked closes it; the results stay', (await R.locator('#cmsgs button.pl-opt').count()) === 0 && (await R.locator('#cmsgs .pl-opt').count()) === 3
   && /Closed/.test(await R.textContent('#cmsgs .pl-meta')));

// ---- 5. A friends' group says "group"
const G = await phone(rohanG, { circleName: 'College Yaar' });
await openFamilyChat(G, 'YAARON');
await G.click('#cv-poll'); await G.waitForTimeout(300);
ok('in a group circle the poll asks "the group"', (await G.textContent('#pl-title')) === 'Ask the group');
await G.click('#pl-x');
ok('and the mic is there too', await G.isVisible('#cmic'));

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`chatbond.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`chatbond.e2e: ${pass}/${pass} checks pass`);
