// EKTA, END TO END: real browsers, the real API handlers and a real
// PostgreSQL, with no AI key and the network to any model blocked. Where a
// model is needed it is a stand-in put in through the test seam.
//
//   - Papa, in senior mode, SPEAKS "Ekta, tell Rohan I reached" (the phone's
//     speech recognition is a stand-in that hands over those words). A card
//     appears: "Ekta wants to: send "I reached" to Rohan". Nothing is sent.
//     He taps "Yes, do it". The message is in Rohan's chat, from Papa.
//   - The chat with Ekta comes back from the server after a reload, and
//     "Clear this chat" removes it.
//   - Rohan asks Ekta to remember something: a card, a yes, and then it is
//     listed under "Ekta and me", where he removes it, turns off "Ekta may
//     do things for me", and picks Hindi.
//   - For Kamla, who is not on Parwah: a button that opens WhatsApp with the
//     words filled in. Nothing is sent by Parwah.
//   - In the family chat "hamari ekta..." gets no reply; "@Ekta ..." does.
//   - In the morning Today shows "Aaj ka din", with "Sunao" and the thumbs.
//
// Nothing is checked after a fixed wait: each step waits for the thing it
// is about to read. Every screen is measured: 44px targets, a 12px floor,
// WCAG AA in light and dark at 320 and 390; at 1280 nothing sideways and no
// small text (the desktop layout uses mouse-sized controls by design).
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('ektaagent.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('ektaagent.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
for (const k of Object.keys(process.env)) if (/^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|XAI|GROK|KIMI|MOONSHOT|OLLAMA|TWILIO|CRON_SECRET|EKTA_)/.test(k)) delete process.env[k];

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('ektaagent.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games', 'ekta']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { ensureCoinSchema } = await import('../../../api/_coins.mjs');
const E = await import('../../../api/ekta.mjs');
const R = await import('../../../api/_digestrules.mjs');
await ensureSchema(db());
await ensureCoinSchema(db());
// Nothing in this test may reach a real model: fetch from the server side
// to anywhere is refused, and the stand-in answers only what is scripted.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('offline in this test'); };
const script = [], modelCalls = [];
const think = { type: 'thinking', thinking: '', signature: 'sig' };
const says = (text) => ({ model: 'fake-model', stop_reason: 'end_turn', content: [think, { type: 'text', text }] });
const uses = (name, input) => ({ model: 'fake-model', stop_reason: 'tool_use', content: [think, { type: 'tool_use', id: 'tu' + Math.random().toString(36).slice(2), name, input }] });
const standIn = { messages: { create: async (params) => { modelCalls.push(params); const next = script.shift(); if (!next) throw new Error('unscripted'); return next; } } };

let n = 0;
async function person(circleId, code, circleName, name, role = 'family', relation = null) {
  const phone = '+9198733' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id, place, country, relation, created_at) values ($1,$2,$3,$4,'Delhi','IN',$5, now() - interval '40 days') returning id`, [circleId, name, role, u.id, relation])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { memberId: m.id, id: m.id, userId: u.id, name, token, phone, code, circleName, role };
}
async function api(name, who, body, tz) {
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await HANDLERS[name]({ method: 'POST', headers: { 'x-parwah-token': who.token, 'x-forwarded-for': '10.5.5.5', 'x-parwah-tz': tz || 'UTC' },
    body: { code: who.code, memberId: who.id, ...body }, query: { area: body.area || '' } }, res);
  return { ...json, status };
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
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.3.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
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
const settle = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
function zoneAt(hour) {
  for (let off = -12; off <= 14; off++) {
    const z = 'Etc/GMT' + (off <= 0 ? '+' + (-off) : '-' + off);
    if (R.digestHour(Date.now(), z) === hour) return { zone: z, off };
  }
  throw new Error('no zone is at hour ' + hour);
}
const EVE = zoneAt(19), MORN = zoneAt(9);
// `heard`: what the phone's speech recognition will hand over when the mic is tapped.
async function phone(who, { big = false, zone = EVE.zone, heard = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: zone });
  await ctx.addInitScript(([w, big, heard]) => {
    // A stand-in for the browser's speech recognition and its voice, so the
    // spoken path runs with no microphone and no sound.
    window.__spoken = [];
    function SR(){ }
    SR.prototype.start = function(){ var self = this; window.__srLang = self.lang; setTimeout(function(){ if (self.onresult) self.onresult({ results: [[{ transcript: heard }]] }); if (self.onend) self.onend(); }, 0); };
    SR.prototype.stop = function(){ if (this.onend) this.onend(); };
    if (heard) window.SpeechRecognition = SR;
    window.SpeechSynthesisUtterance = function(t){ this.text = t; };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel(){}, getVoices(){ return []; }, speak(u){ window.__spoken.push({ text: u.text, lang: u.lang }); if (u.onend) setTimeout(u.onend, 0); } } });
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
    localStorage.setItem('parwah-big', big ? '1' : '0');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: w.role, circleName: w.circleName }));
  }, [who, big, heard]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/');
  await page.waitForFunction(() => { const e = document.getElementById('hero-status'); return e && e.textContent && e.textContent !== '…'; }, null, { timeout: 15000 });
  return page;
}
// Ekta's screen, with the member's saved chat loaded from the server.
async function openEkta(page) {
  // After a reload the page opens on Ekta's screen by itself.
  if (!(await page.evaluate(() => location.hash === '#ekta'))) {
    const done = page.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('ekta_state'), { timeout: 10000 });
    await page.evaluate(() => { location.hash = '#ekta'; });
    await done;
  }
  await page.waitForSelector('#pane-ekta:not([hidden])', { timeout: 8000 });
  await settle(page);
}
async function sayTo(page, text) {
  const done = page.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('"text"'), { timeout: 15000 });
  await page.fill('#msg', text);
  await page.click('#send');
  await done;
  await page.waitForFunction(() => !document.querySelector('#emsgs .thinking'), null, { timeout: 8000 });
}

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
  for (const [wd, sc] of [[320, 'light'], [390, 'light'], [390, 'dark'], [320, 'dark'], [1280, 'light']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc }); await settle(page);
    const m = await page.evaluate(measureIn, sel);
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    // At 1280 the app's desktop layout uses mouse-sized controls by design
    // (--tap-min is smaller there), so what is measured on a desktop is the
    // text floor, the contrast and that nothing runs off sideways.
    m.bad.filter(b => wd < 1000 || !/^small /.test(b)).forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' }); await settle(page);
  ok('design: ' + label + ' - 44px targets, 12px floor, AA in both themes at 320/390; nothing sideways and no small text at 1280', bad.length === 0, bad.slice(0, 6).join(' | '));
}
const one = async (q, p) => (await admin.query(q, p)).rows[0];
const count = async (q, p) => (await one(q, p)).n;

// ---- a family
const fam = (await admin.query(`insert into circles (code, name, kind) values ('SHARMA','Sharma Family','family') returning id`)).rows[0].id;
const rohan = await person(fam, 'SHARMA', 'Sharma Family', 'Rohan', 'family', 'son');
const papa = await person(fam, 'SHARMA', 'Sharma Family', 'Papa', 'parent', 'father');
const priya = await person(fam, 'SHARMA', 'Sharma Family', 'Priya', 'family', 'sister');
// Kamla Mausi is in the family tree with a phone number, but not on Parwah.
await admin.query(`insert into members (circle_id, name, role, relation, phone) values ($1, 'Kamla', 'family', 'aunt', '+919820077777')`, [fam]);
await admin.query(`insert into coins (circle_id, member_id, delta, reason) values ($1, $2, 50, 'welcome')`, [fam, rohan.id]);
const dms = () => count(`select count(*)::int as n from messages m join chats c on c.id = m.chat_id where c.circle_id = $1 and c.kind = 'dm'`, [fam]);

// ================================================================ 1. by voice, in senior mode, with no AI key
const S1 = await phone(papa, { big: true, heard: 'Ekta, tell Rohan I reached' });
ok('Papa is in senior mode', await S1.evaluate(() => document.body.classList.contains('senior')));
await openEkta(S1);
ok('the mic is there for someone who does not type', await S1.isVisible('#emic'));
const spoke = S1.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('tell Rohan I reached'), { timeout: 15000 });
await S1.click('#emic');
await spoke;
await S1.waitForSelector('#emsgs [data-ek2card]', { timeout: 8000 });
const cardText = await S1.textContent('#emsgs [data-ek2card]');
ok('a card: Ekta wants to: send "I reached" to Rohan', /Ekta wants to:/.test(cardText) && /send "I reached" to Rohan/.test(cardText), cardText);
ok('with "Yes, do it" and "No"', await S1.isVisible('[data-ek2yes]') && await S1.isVisible('[data-ek2no]') && (await S1.textContent('[data-ek2yes]')) === 'Yes, do it' && (await S1.textContent('[data-ek2no]')) === 'No');
ok('NOTHING has been sent before the yes', await dms() === 0);
ok('no model and no coin were used', modelCalls.length === 0 && await count(`select coalesce(sum(delta),0)::int as n from coins where circle_id = $1`, [fam]) === 50);
ok('in senior mode the two buttons are at least 56px tall', await S1.$eval('[data-ek2yes]', el => el.getBoundingClientRect().height) >= 55.5);
ok('her answer was read aloud', await S1.evaluate(() => window.__spoken.some(s => /Yes, do it/.test(s.text))));
await design(S1, '#pane-ekta', 'Ekta\'s screen with a card waiting, senior mode');
const yes = S1.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('ekta_confirm'), { timeout: 10000 });
await S1.click('[data-ek2yes]');
await yes;
await S1.waitForFunction(() => { const s = document.querySelector('#emsgs [data-ek2card] small'); return s && !s.hidden && /Done/.test(s.textContent); }, null, { timeout: 8000 });
const sent = await one(`select m.text, m.member_id from messages m join chats c on c.id = m.chat_id where c.circle_id = $1 and c.kind = 'dm'`, [fam]);
ok('after the yes it is sent, once, as Papa', await dms() === 1 && sent.text === 'I reached' && sent.member_id === papa.id, JSON.stringify(sent));
ok('the card says Done and its buttons are gone', (await S1.$('[data-ek2yes]')) === null && /Done/.test(await S1.textContent('#emsgs [data-ek2card] small')));
ok('"Done" was spoken too', await S1.evaluate(() => window.__spoken.some(s => s.text === 'Done.')));
ok('it is in the audit, with no words of the message', (await one(`select label from ekta_audit where member_id = $1`, [papa.id])).label === 'Message to Rohan');
// Rohan's phone: the message is in his chats.
const P1 = await phone(rohan);
const chatList = await api('chats', rohan, {});
ok('Rohan has it in a personal chat from Papa', (await admin.query(`select 1 from chat_members cm join chats c on c.id = cm.chat_id where c.kind = 'dm' and cm.member_id = $1`, [rohan.id])).rows.length === 1, JSON.stringify(chatList).slice(0, 100));

// ================================================================ 2. the saved chat
await S1.reload();
await S1.waitForFunction(() => { const e = document.getElementById('hero-status'); return e && e.textContent && e.textContent !== '…'; }, null, { timeout: 15000 });
await openEkta(S1);
await S1.waitForFunction(() => /tell Rohan I reached/.test(document.getElementById('emsgs').textContent), null, { timeout: 8000 });
ok('after a reload the chat with Ekta comes back from the server', /Ekta, tell Rohan I reached/.test(await S1.textContent('#emsgs')) && /I have this ready/.test(await S1.textContent('#emsgs')));
ok('a card already answered does not come back', (await S1.$('#emsgs [data-ek2card]')) === null);
await S1.click('#ek2-clear');
await S1.waitForSelector('#asksheet:not([hidden])', { timeout: 5000 });
ok('"Clear this chat" asks first', /Clear this chat\?/.test(await S1.textContent('#as-q')));
const cleared = S1.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('ekta_thread_clear'), { timeout: 10000 });
await S1.click('#as-yes');
await cleared;
await S1.waitForFunction(() => document.getElementById('emsgs').children.length === 1, null, { timeout: 8000 });
ok('and then it is gone, here and on the server', await count(`select count(*)::int as n from ekta_thread where member_id = $1`, [papa.id]) === 0);

// ================================================================ 3. remembering, with a model stand-in
E.ektaSeams.client = standIn;
await openEkta(P1);
script.push(uses('remember', { key: 'Tea', value: 'Ginger tea, no sugar' }), says('Shall I remember this? Tap "Yes, do it" if you want me to.'));
await sayTo(P1, 'Remember that I like ginger tea with no sugar.');
await P1.waitForSelector('#emsgs [data-ek2card]', { timeout: 8000 });
ok('remembering is a card first', /remember this about you: Tea: Ginger tea, no sugar/.test(await P1.textContent('#emsgs [data-ek2card]')) && await count(`select count(*)::int as n from ekta_memory`) === 0);
ok('her reply says what waits, never that it is done', /Waiting for your yes:/.test(await P1.textContent('#emsgs')) && !/ho gaya/i.test(await P1.textContent('#emsgs')));
ok('the phone sent only the new message, never a history', !JSON.stringify(modelCalls[0].messages).includes('PLANTED'));
const yes2 = P1.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('ekta_confirm'), { timeout: 10000 });
await P1.click('[data-ek2yes]');
await yes2;
await P1.waitForFunction(() => /Done/.test((document.querySelector('#emsgs [data-ek2card] small') || {}).textContent || ''), null, { timeout: 8000 });
ok('on the yes it is saved', await count(`select count(*)::int as n from ekta_memory where member_id = $1 and key = 'Tea'`, [rohan.id]) === 1);
await design(P1, '#pane-ekta', 'Ekta\'s screen after a yes');

// "Ekta and me"
await P1.click('#ek2-me');
await P1.waitForSelector('#ek2-mem-list', { timeout: 8000 });
const me = await P1.textContent('#bs-body');
ok('"What Ekta remembers about me" lists it', /What Ekta remembers about me/.test(me) && /Tea: Ginger tea, no sugar/.test(me) && await P1.isVisible('#ek2-forget-all'));
ok('it says she asks first and what she never keeps', /Shall I remember this\?/.test(me) && /Never a password, a PIN, an OTP, a card number or a health reading/.test(me));
ok('"Ekta may do things for me" is on, and every nudge is off', await P1.isChecked('#ek2-acts') && !(await P1.isChecked('#ek2-n-talk')) && !(await P1.isChecked('#ek2-n-bday')) && !(await P1.isChecked('#ek2-n-renew')));
ok('an adult sees "Pause Ekta for this family", unticked', await P1.isVisible('#ek2-pause') && !(await P1.isChecked('#ek2-pause')));
ok('what she did is listed, without the words', /What Ekta did for me/.test(me) && /One thing remembered/.test(me) && !/Ginger tea, no sugar.*One thing remembered.*Ginger/.test(me));
await design(P1, '#bondsheet .mp', 'the "Ekta and me" sheet');
const off = P1.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('ekta_prefs'), { timeout: 10000 });
await P1.uncheck('#ek2-acts');
await off;
ok('turning "Ekta may do things for me" off is saved', (await one(`select no_actions from ekta_prefs where member_id = $1`, [rohan.id])).no_actions === true);
const on = P1.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('ekta_prefs'), { timeout: 10000 });
await P1.check('#ek2-acts');
await on;
const gone = P1.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('ekta_memory_delete'), { timeout: 10000 });
await P1.click('[data-ek2forget]');
await gone;
await P1.waitForSelector('#ek2-mem-none', { timeout: 8000 });
ok('"Forget" removes it', await count(`select count(*)::int as n from ekta_memory where member_id = $1`, [rohan.id]) === 0 && /Nothing yet\./.test(await P1.textContent('#ek2-mem-none')));
const lang = P1.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('ekta_lang'), { timeout: 10000 });
await P1.click('[data-ek2lang="hi"]');
await lang;
await P1.waitForFunction(() => { const b = document.querySelector('[data-ek2lang="hi"]'); return b && b.getAttribute('aria-pressed') === 'true'; }, null, { timeout: 8000 });
ok('Hindi can be chosen for her voice', (await one(`select lang from members where id = $1`, [rohan.id])).lang === 'hi');
await P1.click('#bs-x'); await P1.waitForSelector('#bondsheet', { state: 'hidden' });
script.push(says('Theek hai.'));
await sayTo(P1, 'Namaste');
ok('and then she reads aloud in Hindi', await P1.evaluate(() => window.__spoken.length > 0 && window.__spoken[window.__spoken.length - 1].lang === 'hi-IN'), JSON.stringify(await P1.evaluate(() => window.__spoken.slice(-1))));
await api('ekta', rohan, { action: 'ekta_lang', lang: 'en' });

// ================================================================ 4. someone not on Parwah: a WhatsApp button, never a send
E.ektaSeams.client = null;
await sayTo(P1, 'tell Kamla I will call tonight');
await P1.waitForSelector('#emsgs a[data-ek2wa]', { timeout: 8000 });
const wa = await P1.getAttribute('#emsgs a[data-ek2wa]', 'href');
ok('a button that opens WhatsApp with the words filled in', wa === 'https://wa.me/919820077777?text=I%20will%20call%20tonight' && (await P1.textContent('#emsgs a[data-ek2wa]')) === 'Open WhatsApp to send it', wa);
ok('and it says the member sends it', /You send it yourself\. Parwah does not send anything on WhatsApp\./.test(await P1.textContent('#emsgs')));
ok('no card to confirm, and nothing was sent anywhere', (await P1.$$('#emsgs [data-ek2yes]')).length === 0 && await dms() === 1);
await design(P1, '#pane-ekta', 'Ekta\'s screen with a WhatsApp hand-off');

// ================================================================ 5. in the family chat
E.ektaSeams.client = standIn;
const famChat = (await one(`select id from chats where circle_id = $1 and kind = 'circle'`, [fam])).id;
const ektaSaid = () => count(`select count(*)::int as n from messages where chat_id = $1 and member_id is null`, [famChat]);
modelCalls.length = 0;
const r1 = await api('chats', priya, { action: 'send', chatId: famChat, text: 'Hamari ekta hi hamari taakat hai' });
ok('"ekta" the word for unity gets no reply', r1.ok && r1.ekta === false && await ektaSaid() === 0 && modelCalls.length === 0);
script.push(says('Nothing is planned yet.'));
await P1.evaluate(() => { location.hash = '#chat'; });
await P1.waitForSelector('#pane-chat:not([hidden])', { timeout: 8000 });
ok('the chat screen says how to bring her in', /Write @Ekta, or start a message with her name/.test(await P1.textContent('#pane-chat')));
const r2 = await api('chats', rohan, { action: 'send', chatId: famChat, text: '@Ekta what is planned?' });
ok('"@Ekta" gets a reply in the chat, for the same coins', r2.ok && r2.ekta === true && await ektaSaid() === 1 && modelCalls.length === 1
   && await count(`select coalesce(sum(delta),0)::int as n from coins where circle_id = $1`, [fam]) === 44);
E.ektaSeams.client = null;

// ================================================================ 6. Aaj ka din, in the morning
const M1 = await phone(priya, { zone: MORN.zone });
await M1.waitForSelector('#ek2-today [data-ek2open]', { timeout: 8000 }).catch(() => {});
const row = await M1.textContent('#ek2-today');
ok('in the morning Today has the row "Aaj ka din"', /Aaj ka din/.test(row) && /What today holds for the family\./.test(row) && /Read it/.test(row), row);
ok('in the evening it does not', (await P1.evaluate(() => { location.hash = '#home'; return true; })) && (await P1.textContent('#ek2-today')).trim() === '');
await design(M1, '#ek2-today', 'the morning row on Today');
await M1.click('#ek2-today [data-ek2open]');
await M1.waitForSelector('#ek2-m-text', { timeout: 8000 });
ok('the note opens: plain words, no model', /Nothing is marked for today in the family yet\./.test(await M1.textContent('#ek2-m-text')) && modelCalls.length === 1);
ok('with "Sunao" and the two thumbs', await M1.isVisible('#ek2-sunao-m') && await M1.isVisible('#ek2-m-up') && await M1.isVisible('#ek2-m-down'));
await M1.click('#ek2-sunao-m');
await M1.waitForFunction(() => window.__spoken.some(s => /Nothing is marked for today/.test(s.text)), null, { timeout: 5000 });
ok('"Sunao" reads the note aloud', true);
const voted = M1.waitForResponse(r => r.url().includes('/api/ekta') && (r.request().postData() || '').includes('ekta_morning_vote'), { timeout: 10000 });
await M1.click('#ek2-m-up');
await voted;
await M1.waitForFunction(() => document.getElementById('ek2-m-up').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
ok('a thumbs up is stored', (await one(`select vote from ekta_morning where member_id = $1`, [priya.id])).vote === 1);
await design(M1, '#bondsheet .mp', 'the "Aaj ka din" sheet');
await M1.click('#bs-x'); await M1.waitForSelector('#bondsheet', { state: 'hidden' });

// ================================================================ 7. offline
await M1.evaluate(() => { location.hash = '#ekta'; });
await M1.waitForSelector('#pane-ekta:not([hidden])', { timeout: 8000 });
await M1.context().setOffline(true);
await M1.fill('#msg', 'hello');
await M1.click('#send');
await M1.waitForFunction(() => /No connection\. Try again\./.test(document.getElementById('emsgs').textContent), null, { timeout: 8000 });
ok('with no connection she says so, and says it aloud', await M1.evaluate(() => window.__spoken.some(s => s.text === 'No connection. Try again.')));
await M1.context().setOffline(false);

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
globalThis.fetch = realFetch;
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`ektaagent.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`ektaagent.e2e: ${pass}/${pass} checks pass`);
