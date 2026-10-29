// THE LAUNCH LIST AND THE PROOF, END TO END: a real browser, the real
// api/auth.mjs handler and a real PostgreSQL.
//
// A person fills the form on /launch/ and a row lands in the waitlist table
// with their yes and the time of it. A bot that fills the hidden field is
// thanked and stored nowhere. Two taps send one join. A server that fails
// and a network that fails are both said plainly, with WhatsApp offered.
// The home page shows the real counts when it can, and the marked sample
// when it cannot.
//
// Needs PARWAH_TEST_DATABASE_URL (a database ending in _test - it is wiped)
// and playwright-core. Run with: npm run test:db
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('waitlist.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('waitlist.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('waitlist.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const auth = (await import('../../../api/auth.mjs')).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
await ensureSchema(db());

// ---- a server: the site's files, and the real handler behind /api/auth
const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const posts = [];
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname.replace(/\/$/, '') !== '/api/auth') { res.statusCode = 404; res.end('{"ok":false}'); return; }
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    if (req.method === 'POST') posts.push(body);
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.0.' + posts.length }, query: Object.fromEntries(u.searchParams), body };
    const w = { status(s) { res.statusCode = s; return this; }, json(j) { res.end(JSON.stringify(j)); return this; }, setHeader(k, v) { res.setHeader(k, v); return this; } };
    // A beat of latency, so a second tap lands while the first is in flight.
    await new Promise(r => setTimeout(r, 300));
    try { await auth(r, w); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })); }
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

async function open(route, viewport = { width: 390, height: 844 }, scheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(route + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(route + ': ' + m.text()); });
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  return page;
}
const rows = async () => (await admin.query('select * from waitlist order by created_at')).rows;
const msgOf = (page) => page.locator('#wl-msg').innerText();

// ---- 1. the form refuses what the server would refuse, before a round trip
{
  const page = await open('/launch/');
  await page.click('#wl-submit');
  ok('an empty form asks for a name first', /tell us your name/.test(await msgOf(page)));
  ok('and marks the name box, with the cursor in it',
     await page.getAttribute('#wl-name', 'aria-invalid') === 'true' && await page.evaluate(() => document.activeElement.id) === 'wl-name');
  await page.fill('#wl-name', 'Priya Sharma');
  ok('typing clears the mark', await page.getAttribute('#wl-name', 'aria-invalid') === null);
  await page.fill('#wl-email', 'priya.example.com');
  await page.click('#wl-submit');
  ok('a broken email is caught', /does not look like an email/.test(await msgOf(page)));
  await page.fill('#wl-email', 'Priya@Example.com');
  ok('the consent box starts unticked', !(await page.isChecked('#wl-consent')));
  await page.click('#wl-submit');
  ok('and the form will not send without it', /tick the box/.test(await msgOf(page)));
  ok('nothing reached the server while the form said no', posts.length === 0, String(posts.length));
  ok('the privacy notice is linked right beside the form',
     await page.locator('#wl-form a[href="../privacy/#launch-list"]').count() === 1);
  ok('the bot trap is out of sight and out of the tab order',
     await page.evaluate(() => { const r = document.getElementById('wl-extra').getBoundingClientRect(); return r.right < 0 || r.width <= 1; })
     && await page.getAttribute('#wl-extra', 'tabindex') === '-1');

  // ---- 2. a real join, tapped twice
  await page.check('#wl-consent');
  await page.fill('#wl-city', 'Pune');
  await page.selectOption('#wl-interest', 'both');
  await page.evaluate(() => { const b = document.getElementById('wl-submit'); b.click(); b.click(); document.getElementById('wl-form').requestSubmit(); });
  ok('while it is on its way the button says so and cannot be pressed',
     await page.isDisabled('#wl-submit') && /Joining/.test(await page.innerText('#wl-submit')));
  await page.waitForSelector('#wl-msg.ok', { timeout: 10000 });
  ok('three taps sent one join', posts.length === 1, String(posts.length));
  ok('the success is said in a plain sentence', /You are on the list for both\. We will message you when we open\./.test(await msgOf(page)), await msgOf(page));
  ok('and the form is cleared, consent box included', await page.inputValue('#wl-name') === '' && !(await page.isChecked('#wl-consent')));
  const r1 = await rows();
  ok('one row was stored', r1.length === 1, String(r1.length));
  ok('with the address lowercased and the details given', r1[0] && r1[0].email === 'priya@example.com' && r1[0].city === 'Pune' && r1[0].interest === 'both' && r1[0].source === 'launch-page');
  ok('with the yes recorded', r1[0] && r1[0].consent === true);
  ok('and the time of the yes recorded', r1[0] && r1[0].consent_at instanceof Date && Math.abs(Date.now() - r1[0].consent_at.getTime()) < 120000, String(r1[0] && r1[0].consent_at));
  ok('the bot trap is not a column', r1[0] && !('pw_extra' in r1[0]));
  await page.context().close();

  // ---- 3. joining again keeps one row and the FIRST yes
  const first = r1[0].consent_at.getTime();
  await new Promise(r => setTimeout(r, 1100));
  const again = await open('/launch/');
  await again.fill('#wl-name', 'Priya S');
  await again.fill('#wl-email', 'PRIYA@example.com');
  await again.check('#wl-consent');
  await again.click('#wl-submit');
  await again.waitForSelector('#wl-msg.ok', { timeout: 10000 });
  const r2 = await rows();
  ok('the same person joining again is still one row', r2.length === 1, String(r2.length));
  ok('and the time of the first yes is kept', r2[0].consent_at.getTime() === first);
  ok('and the reply did not say they were already there', !/already/i.test(await msgOf(again)));
  await again.context().close();
}

// ---- 3b. a yes from before the time was recorded is not stamped with today
await admin.query(`insert into waitlist (name, email, consent, source, created_at, updated_at) values ('Old Yes','old@example.com', true, 'site', now() - interval '3 months', now() - interval '3 months')`);
{
  const page = await open('/launch/');
  await page.fill('#wl-name', 'Old Yes');
  await page.fill('#wl-email', 'old@example.com');
  await page.check('#wl-consent');
  await page.click('#wl-submit');
  await page.waitForSelector('#wl-msg.ok', { timeout: 10000 });
  const r = (await admin.query("select consent_at from waitlist where email = 'old@example.com'")).rows[0];
  ok('an old yes keeps no time rather than gaining today\'s', r && r.consent_at === null, String(r && r.consent_at));
  await page.context().close();
}

// ---- 3c. what the privacy page promises about deleting is what happens
await admin.query(`insert into waitlist (name, email, consent, source, created_at, updated_at) values ('Long Gone','gone@example.com', true, 'site', now() - interval '25 months', now() - interval '25 months')`);
await admin.query(`insert into rate_limit (bucket, k, window_start, n) values ('waitlist', '203.0.113.9', now() - interval '2 days', 1)`);
{
  const r = { method: 'GET', headers: {}, query: { stats: 'proof' }, body: {} };
  let code = 0; const w = { status(s) { code = s; return this; }, json() { return this; }, setHeader() { return this; } };
  await auth(r, w);
  ok('the counts answer', code === 200, String(code));
  ok('an entry untouched for 24 months is deleted', (await admin.query("select count(*)::int n from waitlist where email = 'gone@example.com'")).rows[0].n === 0);
  ok('and a day-old address in the flood counter is deleted', (await admin.query("select count(*)::int n from rate_limit where k = '203.0.113.9'")).rows[0].n === 0);
  ok('while a recent entry stays', (await admin.query("select count(*)::int n from waitlist where email = 'priya@example.com'")).rows[0].n === 1);
}

// ---- 4. a bot fills everything, the trap included
{
  const page = await open('/launch/');
  await page.fill('#wl-name', 'Spam Bot');
  await page.fill('#wl-email', 'bot@spam.example');
  await page.check('#wl-consent');
  await page.evaluate(() => { document.getElementById('wl-extra').value = 'http://spam.example'; });
  await page.click('#wl-submit');
  await page.waitForSelector('#wl-msg.ok', { timeout: 10000 });
  ok('a bot is answered like a person', /You are on the list/.test(await msgOf(page)));
  ok('and nothing it sent was stored', (await admin.query("select count(*)::int n from waitlist where email = 'bot@spam.example'")).rows[0].n === 0);
  await page.context().close();
}

// ---- 5. the server fails, then the network fails
for (const [what, route, want] of [
  ['the server fails', r => r.fulfill({ status: 500, body: 'oops' }), /went wrong on our side, and you are not on the list yet/],
  ['the network fails', r => r.abort(), /could not reach Parwah.*not on the list yet/],
]) {
  const page = await open('/launch/');
  await page.route('**/api/auth/', route);
  await page.fill('#wl-name', 'Meera Rao');
  await page.fill('#wl-email', 'meera@example.com');
  await page.check('#wl-consent');
  await page.click('#wl-submit');
  await page.waitForSelector('#wl-msg.err', { timeout: 10000 });
  ok(`when ${what}, the person is told plainly`, want.test(await msgOf(page)), await msgOf(page));
  ok(`when ${what}, WhatsApp is offered instead`, await page.locator('#wl-msg a[href^="https://wa.me/"]').count() === 1);
  ok(`when ${what}, what they typed is kept and they can try again`,
     await page.inputValue('#wl-name') === 'Meera Rao' && !(await page.isDisabled('#wl-submit')));
  await page.context().close();
}
ok('neither failure stored a row', (await admin.query("select count(*)::int n from waitlist where email = 'meera@example.com'")).rows[0].n === 0);

// ---- 6. a refusal from the server is shown, not swallowed
{
  const page = await open('/launch/');
  await page.fill('#wl-name', 'Ravi Kumar');
  await page.fill('#wl-email', 'ravi@example.com');
  await page.fill('#wl-phone', '98765 43210 1');
  await page.check('#wl-consent');
  await page.click('#wl-submit');
  await page.waitForSelector('#wl-msg.err', { timeout: 10000 });
  const said = await msgOf(page);
  ok("the server's own refusal reaches the person", /not on the list yet/.test(said) && posts.length >= 3, said);
  ok('and it reads as sentences: no stray dash, no double full stop', !/ - |\.\./.test(said), said);
  ok('and the box it is about is marked', await page.getAttribute('#wl-phone', 'aria-invalid') === 'true');
  await page.fill('#wl-phone', '');
  ok('fixing the box clears its mark and its description', await page.getAttribute('#wl-phone', 'aria-invalid') === null && await page.getAttribute('#wl-phone', 'aria-describedby') === null);
  await page.context().close();
}

// ---- 7. the proof on the home page: real counts when it can
// 7a. Small real counts are not shown at all: "1 person on the launch list"
// reads as an empty room. Nothing is put in their place.
{
  const page = await open('/welcome/', { width: 1440, height: 900 });
  await page.waitForSelector('#proof[data-proof-source]', { timeout: 6000 });
  ok('the home page reads the live counts', await page.getAttribute('#proof', 'data-proof-source') === 'live');
  ok('a live count too small to mean anything is not shown', await page.locator('.pf-stats').isHidden());
  ok('and no sample number is shown in its place', !/214|63/.test(await page.innerText('#proof')));
  const note = await page.innerText('[data-proof="note"]');
  ok('the quotes are still marked as examples', /quotes are examples/.test(note) && !/Live counts|Example figures/.test(note), note);
  ok('every quote carries an Example tag', await page.locator('.pf-quote').count() === 3 && await page.locator('.pf-quote .pf-tag').count() === 3);
  ok('the proof sits above the features', await page.evaluate(() => document.getElementById('proof').getBoundingClientRect().top < document.getElementById('features').getBoundingClientRect().top));
  await page.context().close();
}
// 7b. Once a count is worth showing, it is the real one, in the right words.
await admin.query(`insert into users (phone, name) select '+91980' || lpad(g::text, 7, '0'), 'P' || g from generate_series(1, 40) g`);
{
  const want = (await admin.query('select (select count(*)::int from waitlist where consent) w, (select count(*)::int from users) u')).rows[0];
  const page = await open('/welcome/', { width: 1440, height: 900 });
  await page.waitForSelector('#proof[data-proof-source]', { timeout: 6000 });
  ok('a real count worth showing is shown', await page.locator('[data-proof="users"]').isVisible() && await page.innerText('[data-proof="users"]') === String(want.u), await page.innerText('[data-proof="users"]'));
  ok('in the plural when it is more than one', await page.innerText('[data-proof="users"] + .pf-lbl') === 'Parwah app accounts made');
  ok('while the launch list, still small, stays hidden', want.w < 25 && await page.locator('[data-proof="waitlist"]').isHidden());
  ok('and the note says the count shown is live', /Live counts/.test(await page.innerText('[data-proof="note"]')));
  await page.context().close();
}

// ---- 8. and the marked sample when it cannot
{
  const page = await (async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const pg2 = await ctx.newPage();
    pg2.on('pageerror', e => errors.push('/welcome/ sample: ' + e.message));
    await pg2.route('**/api/auth/?stats=proof', r => r.fulfill({ status: 503, body: '{"ok":false}' }));
    await pg2.goto(BASE + '/welcome/', { waitUntil: 'networkidle' });
    return pg2;
  })();
  await page.waitForSelector('#proof[data-proof-source]', { timeout: 6000 });
  ok('with no count to be had, the sample is shown', await page.getAttribute('#proof', 'data-proof-source') === 'sample'
     && await page.innerText('[data-proof="waitlist"]') === '214' && await page.innerText('[data-proof="users"]') === '63');
  ok('and the page says, in words, that the figures are examples',
     /Example figures, to be replaced with live numbers\./.test(await page.innerText('[data-proof="note"]')));
  ok('and the note can be read: not hidden, not tiny',
     await page.evaluate(() => { const n = document.querySelector('[data-proof="note"]'); const cs = getComputedStyle(n);
       return n.getBoundingClientRect().height > 0 && parseFloat(cs.fontSize) >= 12 && cs.visibility === 'visible' && +cs.opacity > 0.9; }));
  await page.context().close();
}

// ---- 9. every page this touched, at phone, tablet and desktop, in both themes
const lum = (c) => { const m = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// The text colour of an element and the colour really behind it: translucent
// layers (the night theme's tints are) blended down to the first solid one.
const COLOURS = (sel) => {
  const el = document.querySelector(sel);
  const parse = (c) => { const m = (c.match(/[\d.]+/g) || []).map(Number); return [m[0] || 0, m[1] || 0, m[2] || 0, m.length > 3 ? m[3] : 1]; };
  const layers = []; let n = el;
  while (n && n.nodeType === 1) { const b = parse(getComputedStyle(n).backgroundColor); if (b[3] > 0) { layers.push(b); if (b[3] >= 1) break; } n = n.parentElement; }
  let out = [255, 255, 255];
  if (!layers.length || layers[layers.length - 1][3] < 1) out = parse(getComputedStyle(document.body).backgroundColor).slice(0, 3);
  for (let i = layers.length - 1; i >= 0; i--) { const [r, g, b, a] = layers[i]; out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)]; }
  return [getComputedStyle(el).color, 'rgb(' + out.map(Math.round).join(',') + ')'];
};
for (const scheme of ['light', 'dark']) {
  for (const [w, h, label] of [[390, 844, 'phone'], [820, 1180, 'tablet'], [1440, 900, 'desktop']]) {
    for (const route of ['/welcome/', '/launch/', '/privacy/']) {
      const page = await open(route, { width: w, height: h }, scheme);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`${route} does not scroll sideways on a ${label} (${scheme})`, over <= 0, over + 'px');
      if (route === '/launch/') {
        const c = await page.evaluate(`(${COLOURS})('#wl-name')`);
        ok(`the form's text can be read in its boxes on a ${label} (${scheme})`, ratio(c[0], c[1]) >= 4.5, c.join(' on '));
        await page.click('#wl-submit');
        const m = await page.evaluate(`(${COLOURS})('#wl-msg')`);
        ok(`and so can its error message (${label}, ${scheme})`, ratio(m[0], m[1]) >= 4.5, m.join(' on '));
        const small = await page.evaluate(() => [...document.querySelectorAll('#wl-form input:not(#wl-extra), #wl-form select, #wl-form button')]
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && Math.max(r.height, r.width) < 20; }).length);
        ok(`every control a finger uses is a fair size (${label}, ${scheme})`, small === 0, String(small));
      }
      if (route === '/welcome/') {
        await page.waitForSelector('#proof[data-proof-source]', { timeout: 6000 });
        const c = await page.evaluate(`(${COLOURS})('.pf-tag')`);
        ok(`the Example tag can be read (${label}, ${scheme})`, ratio(c[0], c[1]) >= 4.5, c.join(' on '));
        if (w === 390 || w === 1440) await page.locator('#proof').screenshot({ path: `${process.env.SHOTS || '/tmp'}/proof-${label}-${scheme}.png` }).catch(() => {});
      }
      if (route === '/launch/' && (w === 390 || w === 1440)) await page.locator('.wl-card').screenshot({ path: `${process.env.SHOTS || '/tmp'}/form-${label}-${scheme}.png` }).catch(() => {});
      await page.context().close();
    }
  }
}

ok('no page threw an error or logged one', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`waitlist.e2e: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : (pass + '/' + pass + ' checks pass')}`);
process.exit(fails.length ? 1 : 0);
