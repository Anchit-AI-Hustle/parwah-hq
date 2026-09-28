// SIGN UP, SIGN IN, AND MOVING BETWEEN FEATURES, in a real browser.
//
// Every check here is a defect a walk of the app actually found:
//   - the five-card introduction was INVISIBLE in dark, because .coachbox
//     used --cream as a background while --ink is the same value in dark
//   - submitting the name step empty repainted a byte-identical screen
//   - a new number never said it was new, so a mistyped digit silently
//     made a second profile
//   - the browser Back button left the app instead of stepping back a tab,
//     because every switch REPLACED the history entry
//   - Sign out, Edit profile, Leave this circle and "I have a code to join
//     instead" were 16 pixels tall; the senior's own switch was a 22px row
//   - the hamburger, a phone's only labelled route to the profile, was 27x26
//
// NOT part of the deploy gate - Vercel's builders have no browser. Run it
// locally when sign-in, the shell or navigation changes:
//     npm i --no-save playwright-core && npx playwright install chromium
//     npm run test:browser
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  try {
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
// Port 0, not a fixed one: these suites are run side by side and next to
// other tools, and a suite that dies on EADDRINUSE teaches people to
// ignore a red test run.
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const ME = '11111111-1111-1111-1111-111111111111';
const PAPA = '22222222-2222-2222-2222-222222222222';
const now = new Date().toISOString();
const KNOWN = '+919873945238';

const eventsJson = { ok:true, circleName:'Sharma Family', code:'ABCDEF', seenAt:now, joinRequests:[], joinPolicy:'approve',
  sos:[], sosEscalateMin:5, pulse:null, calls:[],
  members:[{ id:ME, name:'Rohan', role:'family', relation:'son', phone:'+91 9873945238', place:'Delhi', country:'IN', dob:'1990-08-05', gift_info:{}, created_at:now },
           { id:PAPA, name:'Papa', role:'parent', relation:'father', phone:'+91 9812345678', place:'Pune', country:'IN', dob:'1958-01-05', gift_info:{}, created_at:now }],
  events:[] };

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('playwright-core is not installed - see the note at the top of this file.');
  console.log('The deploy gate does not need it: run `npm test` for the checks that do gate a deploy.');
  server.close(); process.exit(0);
}
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors = [];
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.log('FAIL  ' + name)); if (cond) console.log('PASS  ' + name); };

// Contrast of an element's own text against the first painted ground behind it.
const contrastOf = (loc) => loc.evaluate(el => {
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number);
    const [r,g,b] = m.slice(0,3).map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
    return 0.2126*r + 0.7152*g + 0.0722*b; };
  const s = getComputedStyle(el);
  let bg = s.backgroundColor, node = el;
  while ((bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && node.parentElement) { node = node.parentElement; bg = getComputedStyle(node).backgroundColor; }
  const a = lum(s.color), b = lum(bg);
  return Math.round(((Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05)) * 100) / 100;
});

async function fresh(opts){
  const page = await browser.newPage({ viewport: opts.viewport, serviceWorkers:'block', colorScheme: opts.theme || 'light' });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && m.text().indexOf('net::') < 0 && m.text().indexOf('Failed to load resource') < 0) errors.push('console: ' + m.text()); });
  await page.route('**/api/**', r => r.fulfill({ json:{ ok:false, error:'stub' } }));
  await page.route('**/api/events*', r => r.fulfill({ json: r.request().method() === 'POST' ? { ok:true } : eventsJson }));
  await page.route('**/api/care*', r => r.fulfill({ json:{ ok:true, reminders:[], requests:[] } }));
  await page.route('**/api/chats*', r => r.fulfill({ json:{ ok:true, chats:[] } }));
  await page.route('**/api/games*', r => r.fulfill({ json:{ ok:true, games:[], game:null } }));
  await page.route('**/api/plans*', r => r.fulfill({ json:{ ok:true, plans:[] } }));
  await page.route('**/api/book*', r => r.fulfill({ json:{ ok:true, entries:[], prep:[] } }));
  // The server this stands in for now demands a PIN and hands back a
  // session token. Anything looser would let this suite pass against a
  // sign-in that still lets a bare phone number in.
  const GOOD_PIN = '481920';
  await page.route('**/api/auth', async (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    if (b.action === 'signout') return r.fulfill({ json:{ ok:true } });
    if (b.action === 'reset_request') return r.fulfill({ json:{ ok:true, asked:true } });
    const phone = (b.cc || '+91') + String(b.phone || '').replace(/\D/g, '');
    if (phone === KNOWN) {
      if (!b.pin) return r.fulfill({ json:{ ok:true, exists:true, needPin:true, name:'Rohan' } });
      if (b.pin !== GOOD_PIN) return r.fulfill({ status:401, json:{ ok:false, wrongPin:true, left:4, error:'That PIN is not right. 4 tries left.' } });
      return r.fulfill({ json:{ ok:true, exists:true, toured:true, token:'tok_'+'x'.repeat(40),
        user:{ id:'77777777-7777-4777-8777-777777777777', name:'Rohan', phone:KNOWN },
        circles:[{ code:'ABCDEF', circleName:'Sharma Family', memberId:ME, memberName:'Rohan', members:2 }] } });
    }
    if (!b.name) return r.fulfill({ json:{ ok:true, exists:false } });
    if (!b.pin) return r.fulfill({ json:{ ok:true, exists:false, needPin:true, error:'Your PIN is 6 numbers.' } });
    return r.fulfill({ json:{ ok:true, exists:true, toured:true, token:'tok_'+'y'.repeat(40),
      user:{ id:'88888888-8888-4888-8888-888888888888', name:b.name, phone }, circles:[] } });
  });
  if (opts.theme) await page.addInitScript(t => localStorage.setItem('parwah-theme', t), opts.theme);
  if (opts.signedIn) {
    await page.addInitScript(() => {
      localStorage.setItem('parwah', JSON.stringify({ code:'ABCDEF', memberId:'11111111-1111-1111-1111-111111111111', name:'Rohan', role:'family', circleName:'Sharma Family' }));
      localStorage.setItem('parwah-user', JSON.stringify({ id:'77777777-7777-4777-8777-777777777777', name:'Rohan', phone:'+919873945238' }));
      localStorage.setItem('parwah-fr-hide', '1');
    });
  }
  await page.goto(BASE + '/');
  await page.waitForTimeout(700);
  return page;
}

// ---------- SIGN UP: a number nobody has seen before ----------
{
  const pg = await fresh({ viewport:{ width:390, height:844 } });
  await pg.locator('#au-phone').fill('98111 22333');
  await pg.locator('#au-go').click();
  await pg.waitForTimeout(500);
  ok(await pg.locator('#au-namewrap').isVisible(), 'a new number is asked for a name');
  ok(await pg.locator('#au-newnote').isVisible(), 'and is TOLD the number is new, so a typo is catchable');
  ok(/new to Parwah/i.test(await pg.locator('#au-newnote').textContent()), 'in words, not just a field appearing');

  // The dead stop: submitting the name empty used to repaint the same screen.
  await pg.locator('#au-go').click();
  await pg.waitForTimeout(400);
  const err = (await pg.locator('#ob-err').textContent()).trim();
  ok(err.length > 0, 'an empty name is refused out loud, not silently');
  ok(/name/i.test(err), 'and the message says what is missing');
  ok(await pg.locator('#au-name').evaluate(el => el === document.activeElement), 'and the cursor is put where the fix is');
  ok(await pg.locator('#au-namewrap').isVisible(), 'the form is still there to finish');

  // A NUMBER IS NO LONGER THE KEY. A new person picks a PIN in the same
  // breath as their name, because a later, skippable step is how an account
  // ends up without one.
  await pg.locator('#au-name').fill('Rohan Sharma');
  await pg.locator('#au-go').click();
  await pg.waitForTimeout(500);
  ok(await pg.locator('#au-pinwrap').isVisible(), 'a new sign-up must choose a PIN');
  await pg.locator('#au-pin').fill('1234');
  await pg.locator('#au-go').click(); await pg.waitForTimeout(300);
  ok(/6 numbers/.test(await pg.locator('#ob-err').textContent()), 'a short PIN is refused before it is sent');
  ok(await pg.locator('#auth-step').isVisible(), 'and nobody gets in on a bad PIN');
  await pg.locator('#au-pin').fill('481920');
  await pg.locator('#au-go').click();
  await pg.waitForTimeout(800);
  ok(await pg.locator('#auth-step').isHidden(), 'a name and a PIN get through');
  const tok = await pg.evaluate(() => { try { return localStorage.getItem('parwah-token'); } catch (e) { return null; } });
  ok(!!tok && tok.length > 20, 'and a session token is kept for every later request');
  await pg.close();
}

// ---------- SIGN IN: a number we know ----------
{
  const pg = await fresh({ viewport:{ width:390, height:844 } });
  await pg.locator('#au-phone').fill('98739 45238');
  await pg.locator('#au-go').click();
  await pg.waitForTimeout(700);
  // THE HOLE THIS CLOSES: a known number used to sign straight in.
  ok(await pg.locator('#auth-step').isVisible(), 'a known number does NOT get in on the number alone');
  ok(await pg.locator('#au-pinwrap').isVisible(), 'it asks for the PIN');
  ok(await pg.locator('#au-namewrap').isHidden(), 'and does not ask it to make a profile it already has');
  ok(await pg.locator('#au-forgot').isVisible(), 'with a way out if the PIN is forgotten');

  await pg.locator('#au-pin').fill('111111');
  await pg.locator('#au-go').click(); await pg.waitForTimeout(600);
  ok(await pg.locator('#auth-step').isVisible(), 'a wrong PIN does not get in');
  ok(/not right/.test(await pg.locator('#ob-err').textContent()), 'and says so, with the tries left');
  ok((await pg.locator('#au-pin').inputValue()) === '', 'and clears the box for the next try');

  // Watch BEFORE signing in: the app fetches the circle the moment it lands,
  // and a listener attached afterwards sees nothing and proves nothing.
  const sent = [];
  pg.on('request', r => {
    if (!r.url().includes('/api/')) return;
    if (r.url().includes('/api/auth')) return;          // the call that issues the token
    if (/\/api\/settings\?area=push$/.test(r.url())) return;  // the public VAPID key
    sent.push({ url: r.url().split('?')[0], tok: r.headers()['x-parwah-token'] || '' });
  });
  await pg.locator('#au-pin').fill('481920');
  await pg.locator('#au-go').click(); await pg.waitForTimeout(2500);
  ok(await pg.locator('#auth-step').isHidden(), 'the right PIN signs in');
  const t2 = await pg.evaluate(() => { try { return localStorage.getItem('parwah-token'); } catch (e) { return null; } });
  ok(!!t2, 'and a token is issued');

  // Signing in lands on the list of your families and waits. Tap in, which
  // is what makes the app actually start reading.
  const circleRow = pg.locator('#cs-list button[data-encircle]').first();
  if (await circleRow.count()) { await circleRow.click(); await pg.waitForTimeout(2200); }

  // EVERY later request must carry it, read or write, or the server is back
  // to trusting a member UUID that every member can see.
  const naked = sent.filter(r => !r.tok);
  ok(sent.length > 0, `the app made API calls to check (${sent.length})`);
  ok(naked.length === 0,
     `every API call carries the token (${sent.length - naked.length} of ${sent.length})`
     + (naked.length ? ' - bare: ' + naked.slice(0, 3).map(r => r.url).join(', ') : ''));
  await pg.close();
}

// ---------- THE INTRODUCTION, IN DARK ----------
// It rendered as five blank cards: --cream is the token for text ON a dark
// ground, so in dark it equals --ink, and the card painted white on white.
for (const theme of ['light', 'dark']) {
  const pg = await fresh({ viewport:{ width:390, height:844 }, theme, signedIn:true });
  const box = pg.locator('.coachbox').first();
  if (await box.count() && await box.isVisible()) {
    const c = await contrastOf(box.locator('h3, b, p').first().or(box));
    ok(c >= 4.5, `the introduction is legible in ${theme} (${c}:1)`);
  } else {
    const c = await pg.evaluate(() => {
      const d = document.createElement('div'); d.className = 'coachbox';
      d.style.position = 'fixed'; d.textContent = 'x'; document.body.appendChild(d);
      const s = getComputedStyle(d); const out = [s.backgroundColor, s.color]; d.remove(); return out;
    });
    ok(c[0] !== c[1], `the introduction card is not text-on-itself in ${theme} (bg ${c[0]}, text ${c[1]})`);
  }
  await pg.close();
}

// ---------- MOVING BETWEEN FEATURES ----------
{
  const pg = await fresh({ viewport:{ width:390, height:844 }, signedIn:true });
  // Only four tabs are reachable on a phone without opening the drawer:
  // home, people, memory, care. Everything else is behind the hamburger,
  // which is why its size (checked below) matters so much.
  const tabs = ['people', 'memory', 'care'];
  for (const t of tabs) {
    await pg.locator('#tabs [data-tab="' + t + '"]:visible').first().click();
    await pg.waitForTimeout(350);
  }
  ok((await pg.evaluate(() => location.hash)) === '#care', 'the address bar says which feature you are on');

  // Back used to leave the app entirely, because every switch REPLACED
  // the history entry instead of pushing one.
  await pg.goBack(); await pg.waitForTimeout(450);
  ok((await pg.evaluate(() => location.hash)) === '#memory', 'Back steps back a feature');
  await pg.goBack(); await pg.waitForTimeout(450);
  ok((await pg.evaluate(() => location.hash)) === '#people', 'and again');
  ok(await pg.locator('#pane-people').isVisible(), 'and the screen follows the address, not just the URL');
  await pg.goForward(); await pg.waitForTimeout(450);
  ok((await pg.evaluate(() => location.hash)) === '#memory', 'Forward works too');
  ok(await pg.locator('#app').count() > 0 || await pg.locator('#tabs').isVisible(), 'Back never left the app');
  await pg.close();
}

// ---------- CONTROLS A PARENT CAN ACTUALLY HIT ----------
{
  const pg = await fresh({ viewport:{ width:390, height:844 }, signedIn:true });
  const hamb = pg.locator('#hamb');
  if (await hamb.isVisible()) {
    const b = await hamb.boundingBox();
    ok(b && b.width >= 44 && b.height >= 44, `the menu button is thumb-sized (${Math.round(b?b.width:0)}x${Math.round(b?b.height:0)})`);
  } else ok(true, 'the menu button is not shown at this width');

  // Seven of the eleven features live behind that button on a phone, so it
  // has to open, and what it opens has to be reachable without a fight.
  if (await hamb.isVisible()) {
    await hamb.click(); await pg.waitForTimeout(400);
    const items = pg.locator('#drawer [data-tab]:visible');
    ok(await items.count() >= 8, 'the drawer carries the features the tab bar cannot');
    const prof = pg.locator('#drawer [data-tab="profile"]');
    const pb = await prof.boundingBox();
    ok(pb !== null, 'Profile is in the drawer');
    await prof.scrollIntoViewIfNeeded();
    await prof.click(); await pg.waitForTimeout(500);
    ok((await pg.evaluate(() => location.hash)) === '#profile', 'and the drawer actually gets you there');
  }

  // We are already on the profile: the drawer took us there above.
  await pg.waitForTimeout(300);
  const small = await pg.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.linkbtn').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.height < 44) bad.push((el.textContent || el.id).trim().slice(0, 30) + ' ' + Math.round(r.height) + 'px');
    });
    return bad;
  });
  ok(small.length === 0, 'no text control is under 44px tall' + (small.length ? ': ' + small.slice(0,4).join(', ') : ''));
  await pg.close();
}

// ---------- THE SENIOR'S OWN SWITCH ----------
{
  const pg = await fresh({ viewport:{ width:390, height:844 } });
  await pg.locator('#au-phone').fill('98111 22444');
  await pg.locator('#au-go').click(); await pg.waitForTimeout(400);
  await pg.locator('#au-name').fill('Papa'); await pg.locator('#au-go').click();
  await pg.waitForTimeout(800);
  const chk = pg.locator('.seniorchk').first();
  if (await chk.count() && await chk.isVisible()) {
    const row = await chk.boundingBox();
    const box = await chk.locator('input').boundingBox();
    ok(row && row.height >= 44, `the senior-mode row is tappable (${Math.round(row?row.height:0)}px)`);
    ok(box && box.width >= 24, `and its box is not a pinprick (${Math.round(box?box.width:0)}px)`);
  } else {
    const m = await pg.evaluate(() => {
      const d = document.createElement('label'); d.className = 'seniorchk';
      d.innerHTML = '<input type="checkbox"> x'; document.body.appendChild(d);
      const out = [parseFloat(getComputedStyle(d).minHeight), parseFloat(getComputedStyle(d.firstChild).width)];
      d.remove(); return out;
    });
    ok(m[0] >= 44, `the senior-mode row is tappable (${m[0]}px)`);
    ok(m[1] >= 24, `and its box is not a pinprick (${m[1]}px)`);
  }
  await pg.close();
}

// ---------- DESKTOP ----------
{
  const pg = await fresh({ viewport:{ width:1440, height:900 }, signedIn:true });
  await pg.locator('#tabs [data-tab="care"]:visible').first().click();
  await pg.waitForTimeout(400);
  const sel = await pg.evaluate(() => {
    const s = document.querySelector('#tabs [data-tab].sel');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { text: (s.textContent || '').trim().slice(0, 20), visible: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  ok(sel && sel.visible, 'on the desktop the feature you are on is marked, and that mark is on screen');
  await pg.close();
}

// ONE H1 AT A TIME. The gate checks that a marketing page has exactly one
// h1; the app has three, one per screen, which is correct for an app and
// wrong for a document. The property that actually matters to a screen
// reader is that only one of them is ever on screen, and that can only be
// known in a browser, so it is asserted here rather than exempted there.
{
  const pg = await fresh({ viewport:{ width:390, height:844 }, signedIn:true });
  const seen = [];
  const countVisible = () => pg.evaluate(() =>
    [...document.querySelectorAll('h1')].filter(h => {
      const r = h.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(h).visibility !== 'hidden';
    }).map(h => (h.textContent || '').trim().slice(0, 30)));
  seen.push(await countVisible());
  for (const tab of ['care', 'together', 'day']) {
    const t = pg.locator(`#tabs [data-tab="${tab}"]:visible`).first();
    if (await t.count()) { await t.click(); await pg.waitForTimeout(350); seen.push(await countVisible()); }
  }
  const worst = seen.reduce((a, b) => (b.length > a.length ? b : a), []);
  ok(worst.length <= 1,
     'never more than one h1 on screen at once' + (worst.length > 1 ? ': ' + worst.join(' | ') : ''));
  ok(seen.some(v => v.length === 1), 'and a screen does have one, rather than none');
  await pg.close();
}

// UPGRADING FROM BEFORE SIGN-IN TOKENS.
// Every browser that used Parwah before tokens existed holds a circle but no
// session. The first visit after tokens shipped got "please sign in" from the
// server; the app cleared the ACCOUNT, left the CIRCLE, reloaded, booted
// straight back into the circle, was told to sign in again - and reloaded
// for ever. Production, every existing family, the page never settling. No
// check here covered it, because every other case starts clean or signed in.
{
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const pg = await ctx.newPage();
  let loads = 0;
  // Count the page being FETCHED. Two counters were tried first and both
  // were wrong: 'framenavigated' also fires for #home and location.hash = '',
  // which are not reloads, and 'load' never fires inside the loop at all,
  // because each reload is torn down by the next before it finishes - it
  // reported one load on the broken app, and would have passed it. Every
  // reload, finished or not, has to request the document.
  pg.on('request', r => { if (r.resourceType() === 'document') loads++; });
  // Exactly what the server sends a request with no session.
  await pg.route('**/api/**', r => r.fulfill({ status: 401, json:{ ok:false, error:'Please sign in again', signin:true } }));
  await pg.addInitScript(() => {
    // Seed ONCE. An init script runs again on every reload, and re-seeding
    // would manufacture the very loop this is checking for.
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('parwah', JSON.stringify({ code:'ABCDEF', memberId:'11111111-1111-1111-1111-111111111111', name:'Rohan', role:'family', circleName:'Test Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id:'77777777-7777-4777-8777-777777777777', name:'Rohan', phone:'+919873945238' }));
  });
  await pg.goto(BASE + '/').catch(() => {});
  await pg.waitForTimeout(3500);
  ok(loads <= 2, 'an old session reloads at most once, never in a loop (' + loads + ' real page loads in 3.5 s)');
  ok(await pg.locator('#auth-step').isVisible().catch(() => false), 'and it lands on sign-in');
  ok(await pg.evaluate(() => localStorage.getItem('parwah')).catch(() => 'x') === null,
     'with the stale circle cleared from this device, so the boot cannot go back into it');
  ok(await pg.locator('#au-why').isVisible().catch(() => false),
     'and it says why it is asking, rather than looking like a crash');
  await ctx.close();
}

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0,3).join(' / ') : ''));
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
