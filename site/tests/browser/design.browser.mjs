// DESIGN SANITY, MEASURED ON EVERY CHANGE.
//
// A design system only holds if something checks it. This walks every main
// screen at three widths (320px, 390px, 1280px) in light and dark and measures
// what a design review looks for by eye:
//   - nothing scrolls sideways;
//   - every control a finger uses is at least 44px in its smaller dimension
//     (36px on the desktop layout, where it is a mouse pointer)
//     (inline text links inside a sentence are exempt - they are text);
//   - no text is smaller than 12px;
//   - text passes WCAG AA contrast against what is really behind it;
//   - the top bar stays at the top while the page scrolls (phones).
// DESIGN_REPORT=1 prints every offender instead of only counting them.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0]; if (p.endsWith('/')) p += 'index.html';
  try { const d = await readFile(path.join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('playwright-core is not installed - see site/tests/browser/day.browser.mjs.'); server.close(); process.exit(process.env.CI ? 1 : 0); }

const REPORT = !!process.env.DESIGN_REPORT;
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); c ? pass++ : fail++; };

const now = new Date().toISOString(), ME = '11111111-1111-1111-1111-111111111111';
const EV = { ok:true, circleName:'Sharma Family', code:'ABCDEF', seenAt:now, joinRequests:[], joinPolicy:'approve', sos:[], calls:[], pulse:null,
  members:[{ id:ME, name:'Rohan', role:'family', relation:'son', place:'Delhi', country:'IN', gift_info:{}, created_at:now },
           { id:'22222222-2222-2222-2222-222222222222', name:'Papa', role:'parent', relation:'father', place:'Pune', country:'IN', gift_info:{}, created_at:now },
           { id:'33333333-3333-3333-3333-333333333333', name:'Meera', role:'family', relation:'sister', place:'Delhi', country:'IN', gift_info:{}, created_at:now }],
  events:[{ type:'checkin', member_name:'Papa', text:'', created_at:now }] };
const CARE = { ok:true, reminders:[], suggestions:[{ key:'k', title:"Record Papa's blood group", why:'Not written down anywhere yet', urgent:true }], requests:[
  { id:'t1', title:'Pay the electricity bill', status:'open', due_at:new Date(Date.now() - 3600e3).toISOString(), recurrence:'once', by_member:ME, by_name:'Rohan', created_at:now },
  { id:'t2', title:'Book the gas refill', status:'claimed', due_at:new Date(Date.now() + 86400e3).toISOString(), recurrence:'weekly', by_member:ME, by_name:'Rohan', claimed_by:'33333333-3333-3333-3333-333333333333', claimed_name:'Meera', about_name:'Papa', created_at:now }] };
const PANES = ['home', 'people', 'care', 'fun', 'memory', 'vault', 'day', 'chat', 'ekta', 'profile', 'notifs'];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

// Everything measured in the page, in one pass.
function measure(minTap) {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && !el.closest('[hidden]'); };
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '')) + ' "' + (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 24) + '"';
  const L = (c) => { const m = c.match(/[\d.]+/g); if (!m) return 1; return m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map(s => s.trim()); return p.length === 4 ? +p[3] : 1; };
  // Everything the text could be sitting on: a solid colour, or every stop
  // of a gradient (primary buttons are gradients; the text must pass on the
  // worst of them). A photo behind text cannot be measured and is skipped.
  const bgOf = (el) => { let n = el; while (n) { const c = getComputedStyle(n);
      if (alpha(c.backgroundColor) > 0.9) return [c.backgroundColor];
      if (n !== document.body && n !== document.documentElement && c.backgroundImage && c.backgroundImage !== 'none') {
        if (/url\(/.test(c.backgroundImage)) return null;
        const stops = (c.backgroundImage.match(/rgba?\([^)]+\)/g) || []).filter(s => alpha(s) > 0.5);
        if (stops.length) return stops;
      }
      n = n.parentElement; }
    return [getComputedStyle(document.body).backgroundColor]; };
  const out = { overflow: document.scrollingElement.scrollWidth - innerWidth, small: [], tiny: [], lowc: [] };
  // Controls a finger uses.
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=tab], summary').forEach(el => {
    if (!vis(el)) return;
    if (el.closest('.lboard, .vboard, #tboard, #board, .dboard')) return;          // game boards size to the screen
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (inline || el.classList.contains('linkbtn') && getComputedStyle(el).display === 'inline') return;
    if (el.type === 'checkbox' || el.type === 'radio') { const lab = el.closest('label'); if (lab) return; }
    const r = el.getBoundingClientRect();
    if (Math.min(r.height, r.width) < minTap - 0.5) out.small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  // Text.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el || seen.has(el) || !vis(el)) continue; seen.add(el);
    if (el.closest('svg, [aria-hidden="true"]')) continue;          // board text counts: a floor is a floor
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
    if (size < 12 - 0.01) out.tiny.push(name(el) + ' ' + size.toFixed(1) + 'px');
    const bgs = bgOf(el); if (!bgs) continue;
    const a = L(cs.color);
    const ratio = Math.min(...bgs.map(bg => { const b = L(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    if (alpha(cs.color) > 0.5 && ratio < (large ? 3 : 4.5) - 0.01) out.lowc.push(name(el) + ' ' + ratio.toFixed(2));
  }
  return out;
}

const totals = {};
for (const theme of ['light', 'dark']) {
  for (const [w, h] of [[320, 682], [390, 844], [1280, 860]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block', colorScheme: theme });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/api/**', r => r.fulfill({ json: { ok: false, error: 'stub' } }));
    await page.route('**/api/events*', r => r.fulfill({ json: EV }));
    await page.route('**/api/care*', r => r.fulfill({ json: CARE }));
    await page.route('**/api/settings?area=location*', r => r.fulfill({ json: { ok:true, me:{ sharing:true, precision:'exact', updatedAt:now },
      shares:[{ memberId:ME, name:'Rohan', mine:true, lat:28.61, lng:77.2, accuracy:15, precision:'exact', updatedAt:now, stale:false },
              { memberId:'22222222-2222-2222-2222-222222222222', name:'Papa', relation:'father', lat:18.52, lng:73.85, accuracy:1100, precision:'area', updatedAt:new Date(Date.now() - 7200e3).toISOString(), stale:true }] } }));
    await page.addInitScript(() => {
      localStorage.setItem('parwah', JSON.stringify({ code:'ABCDEF', memberId:'11111111-1111-1111-1111-111111111111', name:'Rohan', role:'family', circleName:'Sharma Family' }));
      localStorage.setItem('parwah-user', JSON.stringify({ id:'7', name:'Rohan', toured:true }));
      localStorage.setItem('parwah-fr-hide', '1'); localStorage.setItem('parwah-token', 't');
    });
    await page.goto(BASE + '/#home'); await page.waitForTimeout(800);
    for (const pane of PANES) {
      await page.evaluate(p => { location.hash = '#' + p; }, pane);
      await page.waitForTimeout(350);
      // Today's More is measured open: what is under it is still Parwah.
      if (pane === 'home') await page.evaluate(() => { const d = document.getElementById('more'); if (d) d.open = true; });
      await page.evaluate(() => window.scrollTo(0, 0));
      // Touch layouts need 44px; the desktop layout (900px+) is used with a
      // mouse, where 36px is comfortable (WCAG AA asks for 24).
      const m = await page.evaluate(measure, w >= 900 ? 36 : 44);
      const key = `${theme} ${w}px ${pane}`;
      totals[key] = m;
      // Sticky bar on phones: scroll to the end, the bar is still at the top.
      if (w < 900) {
        const top = await page.evaluate(() => { window.scrollTo(0, document.scrollingElement.scrollHeight); return document.querySelector('.bar').getBoundingClientRect().top; });
        // Nothing in the bar touches: the brand and the first icon keep a gap.
        if (pane === 'home') {
          const gap = await page.evaluate(() => { const n = document.querySelector('.bar .appname'); const rg = document.createRange(); rg.selectNodeContents(n); const b = rg.getBoundingClientRect();   // the text itself, which can overflow its box
            const first = [...document.querySelectorAll('.bar-actions > *')].find(e => e.getBoundingClientRect().width > 0);
            return first ? first.getBoundingClientRect().left - b.right : 99; });
          ok(gap >= 8, `${key}: the bar's name and icons do not touch (${Math.round(gap)}px apart)`);
        }
        if (pane === 'home' || pane === 'fun') ok(Math.abs(top) < 1, `${key}: the top bar stays at the top when the page is scrolled (${Math.round(top)}px)`);
      }
    }
    // Keyboard: tab through the first controls of Today; each shows a ring.
    await page.evaluate(() => { location.hash = '#home'; window.scrollTo(0, 0); });
    await page.waitForTimeout(300);
    let rings = 0, seen = 0;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null;
        const c = getComputedStyle(e); return { ring: c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2 }; });
      if (f) { seen++; if (f.ring) rings++; }
    }
    ok(seen > 5 && rings === seen, `${theme} ${w}px: every focused control shows a focus ring (${rings}/${seen})`);
    ok(errs.length === 0, `${theme} ${w}px: no script errors` + (errs.length ? ' - ' + errs[0] : ''));
    await page.close();
  }
}

const sum = (k) => Object.values(totals).reduce((a, m) => a + (k === 'overflow' ? (m.overflow > 0 ? 1 : 0) : m[k].length), 0);
for (const [key, m] of Object.entries(totals)) {
  if (m.overflow > 0) console.log('  overflow ' + key + ': ' + m.overflow + 'px');
  if (REPORT) {
    if (m.small.length) console.log('  small targets ' + key + ': ' + m.small.join(' | '));
    if (m.tiny.length) console.log('  tiny text ' + key + ': ' + m.tiny.join(' | '));
    if (m.lowc.length) console.log('  low contrast ' + key + ': ' + m.lowc.join(' | '));
  }
}
const O = sum('overflow'), S = sum('small'), T = sum('tiny'), C = sum('lowc');
console.log(`\nscreens measured: ${Object.keys(totals).length}; overflow ${O}; small targets ${S}; tiny text ${T}; low contrast ${C}`);
ok(O === 0, 'no screen scrolls sideways at 320, 390 or 1280px (' + O + ')');
ok(S === 0, 'every control is at least 44px to tap on touch, 36px on desktop (' + S + ' too small)');
ok(T === 0, 'no text is smaller than 12px (' + T + ')');
ok(C === 0, 'all text passes WCAG AA contrast in light and dark (' + C + ' below)');

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
