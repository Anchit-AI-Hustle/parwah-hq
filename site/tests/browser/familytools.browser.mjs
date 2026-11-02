// FAMILY TOOLS ON SCREEN: Costs, Home staff, Renewals, the nearby helpers on
// a person's page, Maa's one-tap staff card, the family's SOS alarm with the
// helpers to call, and the nearby person's own consent page.
//
// Each is measured the way design.browser.mjs measures the main screens (no
// sideways scroll, 44px targets on touch, 12px text floor, WCAG AA in both
// themes) at 320, 390 and 1440px, and drives the main action of each.
// FT_SHOTS=dir saves a full-page screenshot of every screen.
import http from 'http';
import { readFile, mkdir } from 'fs/promises';
import path from 'path';
import { consentHtml } from '../../../api/_ladder.mjs';

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
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

const SHOTS = process.env.FT_SHOTS || '';
if (SHOTS) await mkdir(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); c ? pass++ : fail++; };

const now = new Date().toISOString(), ME = '11111111-1111-1111-1111-111111111111', PAPA = '22222222-2222-2222-2222-222222222222', MEERA = '33333333-3333-3333-3333-333333333333';
const month = now.slice(0, 7), day = (k) => new Date(Date.now() + k * 86400000).toISOString().slice(0, 10);
const members = [{ id: ME, name: 'Rohan', role: 'family', relation: 'son', place: 'Dubai', country: 'AE', gift_info: {}, created_at: now },
  { id: PAPA, name: 'Papa', role: 'parent', relation: 'father', place: 'Pune', country: 'IN', gift_info: {}, created_at: now },
  { id: MEERA, name: 'Meera', role: 'family', relation: 'sister', place: 'Delhi', country: 'IN', gift_info: {}, created_at: now }];
const LADDER = [{ name: 'Mrs Khanna', phone: '+919811122222', distance: 'Two floors down', hasKey: true, hours: 'All day' }, { name: 'Ramesh', phone: '+919811133333', distance: 'Building gate', hasKey: false }];
const EV = (sos) => ({ ok: true, circleName: 'Sharma Family', code: 'ABCDEF', seenAt: now, joinRequests: [], joinPolicy: 'approve', calls: [], pulse: null, members, events: [],
  sos: sos ? [{ id: '99999999-9999-9999-9999-999999999999', member_id: PAPA, name: 'Papa', phone: '+919800000001', status: 'open', escalated: true, created_at: new Date(Date.now() - 6 * 60000).toISOString(), ladder: LADDER, ladderCalls: false }] : [] });
const EXP = { ok: true, month, split: { mode: 'equal', shares: { [ME]: 1, [MEERA]: 1 } },
  expenses: [
    { id: 'e1', amount: 6000, currency: 'INR', category: 'doctor', for_member: PAPA, for_name: 'Papa', paid_by: ME, paid_name: 'Rohan', spent_on: month + '-03', note: 'Dr Mehta, monthly visit', created_by: ME },
    { id: 'e2', amount: 1800, currency: 'INR', category: 'medicines', for_member: PAPA, for_name: 'Papa', paid_by: MEERA, paid_name: 'Meera', spent_on: month + '-02', created_by: MEERA, receipt_doc_id: 'r1' },
    { id: 'e3', amount: 120, currency: 'AED', category: 'travel', paid_by: ME, paid_name: 'Rohan', spent_on: month + '-01', created_by: ME }],
  summary: [
    { currency: 'INR', total: 7800, byPayer: [{ memberId: ME, name: 'Rohan', amount: 6000 }, { memberId: MEERA, name: 'Meera', amount: 1800 }],
      byCategory: [{ category: 'doctor', amount: 6000 }, { category: 'medicines', amount: 1800 }],
      balance: [{ name: 'Rohan', diff: 2100, line: 'Rohan has paid ₹2,100 more than their share' }, { name: 'Meera', diff: -2100, line: 'Meera has paid ₹2,100 less than their share' }] },
    { currency: 'AED', total: 120, byPayer: [{ memberId: ME, name: 'Rohan', amount: 120 }], byCategory: [{ category: 'travel', amount: 120 }], balance: [] }],
  settledBills: [{ id: 'b1', biller_name: 'Power company', amount: 840, currency: 'INR', category: 'bills', settled_name: 'Meera' }] };
const staffRow = (o) => ({ id: 's1', name: 'Sunita', role: 'attendant', phone: '+919811155555', salary: 12000, currency: 'INR', pay_day: 1, arrive_time: '08:00',
  work_days: '123456', paid_leave: 1, id_last4: '4321', tz: 'Asia/Kolkata', today: day(0), todayStatus: null, workingToday: true,
  marks: [], advanceList: [{ id: 'a1', on_date: month + '-05', amount: 1000, note: 'Diwali' }],
  pay: { month, came: 18, half: 1, leave: 2, advances: 1000, perDay: 400, unpaidDays: 1.5, payable: 10400, formula: '₹12,000 salary, less 1.5 unpaid days at ₹400 a day (₹600), less ₹1,000 advance = ₹10,400', note: '1 day of leave a month is paid. A day\'s pay is the salary divided by 30.' },
  paid: null, ...o });
const STAFF = { ok: true, month, roles: [], staff: [staffRow({}), staffRow({ id: 's2', name: 'Didi', role: 'cook', arrive_time: '07:00', todayStatus: 'came', phone: null, id_last4: null, paid: { amount: 6000, paid_name: 'Meera' },
  pay: { month, came: 20, half: 0, leave: 0, advances: 0, perDay: 200, unpaidDays: 0, payable: 6000, formula: '₹6,000 salary = ₹6,000', note: 'A day\'s pay is the salary divided by 30.' }, advanceList: [] })] };
const KINDS = { health_ins: { label: 'Health insurance', icon: '🛡' }, vehicle_ins: { label: 'Vehicle insurance', icon: '🚗' }, dl: { label: 'Driving licence', icon: '🪪' }, passport: { label: 'Passport', icon: '🛂' }, property_tax: { label: 'Property tax', icon: '🏠' }, fd: { label: 'FD maturity', icon: '🏦' }, gas_kyc: { label: 'Gas connection KYC', icon: '🔥' }, other: { label: 'Other', icon: '📅' } };
const REN = { ok: true, kinds: KINDS, staleDays: 180, renewals: [
  { source: 'own', id: 'r0', kind: 'gas_kyc', label: 'Gas connection KYC', expires_on: day(-3), days: -3, icon: '🔥', kindLabel: 'Gas connection KYC', last_verified_at: now, stale: false },
  { source: 'own', id: 'r1', kind: 'vehicle_ins', label: 'Vehicle insurance', expires_on: day(5), days: 5, icon: '🚗', kindLabel: 'Vehicle insurance', owner_member: MEERA, owner_name: 'Meera', last_verified_at: new Date(Date.now() - 200 * 86400000).toISOString(), stale: true },
  { source: 'own', id: 'r2', kind: 'health_ins', label: "Papa's health policy", about_member: PAPA, about_name: 'Papa', expires_on: day(20), days: 20, icon: '🛡', kindLabel: 'Health insurance', last_verified_at: now, stale: false, task_open: true, task_name: 'Meera' },
  { source: 'vault', id: 'v1', kind: 'passport', label: 'Papa passport', about_member: PAPA, about_name: 'Papa', expires_on: day(25), days: 25, icon: '🔐', kindLabel: 'In the vault', last_verified_at: now, stale: false },
  { source: 'own', id: 'r3', kind: 'fd', label: 'SBI FD', expires_on: day(200), days: 200, icon: '🏦', kindLabel: 'FD maturity', last_verified_at: now, stale: false }] };
const LAD = { ok: true, calls: false, rungs: 2, nearby: [{ id: 'n1', name: 'Dr Joshi next door', phone: '+919811166666', about_member: PAPA }], ladder: [
  { id: 'l1', person_id: PAPA, name: 'Mrs Khanna', phone: '+919811122222', distance_note: 'Two floors down', has_key: true, hours: 'All day', position: 1, consent: 'yes' },
  { id: 'l2', person_id: PAPA, name: 'Ramesh', phone: '+919811133333', distance_note: 'Building gate', has_key: false, hours: 'Nights', position: 2, consent: 'yes' },
  { id: 'l3', person_id: PAPA, name: 'Chachi', phone: '+919811144444', distance_note: 'Ten minutes away', has_key: false, position: 3, consent: 'pending' }] };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

function measure(minTap) {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && !el.closest('[hidden]'); };
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase()) + ' "' + (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 24) + '"';
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
  const scope = document.querySelector('[data-measure]') || document.body;
  const out = { overflow: document.scrollingElement.scrollWidth - innerWidth, small: [], tiny: [], lowc: [] };
  scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary').forEach(el => {
    if (!vis(el)) return;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return;
    if (el.classList.contains('linkbtn') && getComputedStyle(el).display === 'inline') return;
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) return;
    const r = el.getBoundingClientRect();
    if (Math.min(r.height, r.width) < minTap - 0.5) out.small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT), seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el || seen.has(el) || !vis(el)) continue; seen.add(el);
    if (el.closest('svg, [aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
    if (size < 11.99) out.tiny.push(name(el) + ' ' + size.toFixed(1) + 'px');
    const bgs = bgOf(el); if (!bgs) continue;
    const a = L(cs.color);
    const ratio = Math.min(...bgs.map(bg => { const b = L(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    if (alpha(cs.color) > 0.5 && ratio < (large ? 3 : 4.5) - 0.01) out.lowc.push(name(el) + ' ' + ratio.toFixed(2));
  }
  return out;
}

async function app(theme, w, h, { role = 'family', sos = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block', colorScheme: theme });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const posts = [];
  await page.route('**/api/**', r => r.fulfill({ json: { ok: false, error: 'stub' } }));
  await page.route('**/api/events*', r => r.fulfill({ json: EV(sos) }));
  await page.route('**/api/book?area=vault*', r => r.fulfill({ json: { ok: true, docs: [{ id: 'r1', label: 'Pharmacy bill', my_level: 'full', about_name: 'Papa' }], grants: [], log: [], members, requests: [], kinds: {} } }));
  await page.route('**/api/care*', r => {
    const u = r.request().url();
    if (r.request().method() === 'POST') { posts.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ json: { ok: true, id: 'new', link: '/api/circle?consent=abcdefghijklmnopqrstuvwxyz' } }); }
    const a = (u.match(/area=(\w+)/) || [])[1];
    r.fulfill({ json: a === 'expenses' ? EXP : a === 'staff' ? STAFF : a === 'renewals' ? REN : a === 'ladder' ? LAD : { ok: true, reminders: [], requests: [], suggestions: [] } });
  });
  await page.addInitScript((role) => {
    localStorage.setItem('parwah', JSON.stringify({ code: 'ABCDEF', memberId: role === 'parent' ? '22222222-2222-2222-2222-222222222222' : '11111111-1111-1111-1111-111111111111', name: role === 'parent' ? 'Papa' : 'Rohan', role, circleName: 'Sharma Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id: '7', name: 'Rohan', toured: true }));
    localStorage.setItem('parwah-fr-hide', '1'); localStorage.setItem('parwah-token', 't');
  }, role);
  await page.goto(BASE + '/#home'); await page.waitForTimeout(700);
  return { page, errs, posts };
}
const careSec = async (page, sec) => { await page.evaluate(() => { location.hash = '#care'; }); await page.waitForTimeout(250); await page.click('#care-seg [data-sec="' + sec + '"]'); await page.waitForTimeout(400); };
async function check(page, key, scopeSel) {
  await page.evaluate((s) => { document.querySelectorAll('[data-measure]').forEach(x => x.removeAttribute('data-measure')); const el = s && document.querySelector(s); if (el) el.setAttribute('data-measure', '1'); window.scrollTo(0, 0); }, scopeSel || null);
  const w = page.viewportSize().width;
  const m = await page.evaluate(measure, w >= 900 ? 36 : 44);
  ok(m.overflow <= 0, key + ': nothing scrolls sideways' + (m.overflow > 0 ? ' (' + m.overflow + 'px)' : ''));
  ok(!m.small.length, key + ': every control is big enough' + (m.small.length ? ' - ' + m.small.slice(0, 3).join(' | ') : ''));
  ok(!m.tiny.length, key + ': no text under 12px' + (m.tiny.length ? ' - ' + m.tiny.slice(0, 3).join(' | ') : ''));
  ok(!m.lowc.length, key + ': all text passes AA contrast' + (m.lowc.length ? ' - ' + m.lowc.slice(0, 3).join(' | ') : ''));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, key.replace(/[^\w-]+/g, '-') + '.png'), fullPage: true });
}

for (const theme of ['light', 'dark']) {
  for (const [w, h] of [[320, 700], [390, 844], [1440, 900]]) {
    const tag = theme + '-' + w;
    // Costs
    { const { page, errs, posts } = await app(theme, w, h);
      await careSec(page, 'expenses');
      const t = await page.textContent('#ex-sum');
      ok(/₹7,800/.test(t) && /Rohan has paid ₹2,100 more than their share/.test(t) && /AED/.test(t), tag + ' costs: month total, per currency, and the neutral balance line');
      ok(/Power company/.test(await page.textContent('#ex-bills')), tag + ' costs: a paid bill is one tap from Costs');
      await check(page, tag + '-costs', '#pane-care');
      if (w === 390 && theme === 'light') {
        await page.fill('#ex-amt', '0'); await page.click('#ex-add');
        ok(await page.getAttribute('#ex-amt', 'aria-invalid') === 'true', 'costs: a zero amount is refused beside the box');
        await page.fill('#ex-amt', '450'); await page.click('#ex-add'); await page.waitForTimeout(200);
        const p = posts.find(x => x.action === 'expense_add');
        ok(p && p.amount === 450 && p.paidById === ME && p.category === 'medicines', 'costs: Save the cost sends the amount, who paid and what for');
        await page.click('[data-exbill="b1"]'); await page.waitForTimeout(200);
        ok(posts.some(x => x.action === 'expense_from_bill' && x.billId === 'b1'), 'costs: Add to costs turns the bill into a cost');
      }
      ok(!errs.length, tag + ' costs: no script errors' + (errs.length ? ' - ' + errs[0] : ''));
      await page.close(); }
    // Home staff
    { const { page, errs, posts } = await app(theme, w, h);
      await careSec(page, 'staff');
      const t = await page.textContent('#st-list');
      ok(/₹12,000 salary, less 1.5 unpaid days/.test(t) && /Sunita/.test(t) && /ID ending 4321/.test(t), tag + ' staff: the month and the sum, written out');
      await page.evaluate(() => { document.getElementById('st-addcard').open = true; });
      ok(/Tell them what you record here/.test(await page.textContent('#st-addcard')), tag + ' staff: the add form says to tell them what is recorded');
      await check(page, tag + '-staff', '#pane-care');
      if (w === 390 && theme === 'light') {
        await page.click('[data-stmark="s1"][data-st="came"]'); await page.waitForTimeout(200);
        ok(posts.some(x => x.action === 'staff_mark' && x.staffId === 's1' && x.status === 'came'), 'staff: one tap marks Came');
        await page.evaluate(() => { document.getElementById('st-more').open = true; });
        await page.fill('#st-last4', '123456'); await page.fill('#st-name', 'Raju');
        ok(await page.inputValue('#st-last4') === '1234', 'staff: the ID box takes 4 characters only');
        await page.click('#st-add'); await page.waitForTimeout(200);
        const a = posts.find(x => x.action === 'staff_add');
        ok(a && a.name === 'Raju' && a.idLast4 === '1234' && a.workDays.join() === '1,2,3,4,5,6', 'staff: Add to the register sends the form');
      }
      ok(!errs.length, tag + ' staff: no script errors' + (errs.length ? ' - ' + errs[0] : ''));
      await page.close(); }
    // Renewals
    { const { page, errs, posts } = await app(theme, w, h);
      await careSec(page, 'renewals');
      const labels = await page.$$eval('#rn-list .crow b', bs => bs.map(b => b.textContent));
      ok(labels.length === 5 && /Gas/.test(labels[0]) && /SBI/.test(labels[4]), tag + ' renewals: soonest first, vault papers in the list');
      ok(/checked 7 months ago/.test(await page.textContent('#rn-list')), tag + ' renewals: an unchecked entry says so');
      await check(page, tag + '-renewals', '#pane-care');
      if (w === 390 && theme === 'light') {
        await page.selectOption('select[data-rnowner="own:r1"]', MEERA);
        await page.click('[data-rntask="own:r1"]'); await page.waitForTimeout(200);
        ok(posts.some(x => x.action === 'renewal_task' && x.id === 'r1' && x.ownerId === MEERA), 'renewals: one tap makes it a task for the person chosen');
      }
      ok(!errs.length, tag + ' renewals: no script errors' + (errs.length ? ' - ' + errs[0] : ''));
      await page.close(); }
    // A person's page: nearby helpers
    { const { page, errs, posts } = await app(theme, w, h);
      await page.evaluate((id) => { const b = document.createElement('button'); b.setAttribute('data-person', id); document.body.appendChild(b); b.click(); b.remove(); }, PAPA);
      await page.waitForTimeout(500);
      const t = await page.textContent('#pp-ladder-card');
      ok(/Nearby helpers for Papa/.test(t) && /1\. Mrs Khanna/.test(t) && /2\. Ramesh/.test(t) && /Waiting for their answer/.test(t), tag + ' ladder: in order, with each answer');
      await page.evaluate(() => { document.getElementById('ld-addcard').open = true; });
      await check(page, tag + '-ladder', '#pp-ladder-card');
      if (w === 390 && theme === 'light') {
        await page.click('[data-ldmove="l2"][data-dir="-1"]'); await page.waitForTimeout(200);
        const o = posts.find(x => x.action === 'ladder_order');
        ok(o && o.ids.join() === 'l2,l1,l3' && o.personId === PAPA, 'ladder: the arrow moves them up');
        await page.selectOption('#ld-pick', 'n1');
        ok(await page.inputValue('#ld-name') === 'Dr Joshi next door', 'ladder: a "Someone near them" contact fills the form');
        await page.click('#ld-add'); await page.waitForTimeout(400);
        ok(posts.some(x => x.action === 'ladder_add' && x.bookEntryId === 'n1' && x.personId === PAPA), 'ladder: Make their link asks the server for one');
      }
      ok(!errs.length, tag + ' ladder: no script errors' + (errs.length ? ' - ' + errs[0] : ''));
      await page.close(); }
    // Papa's Today: one tap per person who helps
    { const { page, errs } = await app(theme, w, h, { role: 'parent' });
      await page.waitForTimeout(400);
      ok(await page.isVisible('#staff-today') && /Who came today/.test(await page.textContent('#staff-today')), tag + ' elder: Who came today on Today');
      await check(page, tag + '-elder-today', '#staff-today');
      ok(!errs.length, tag + ' elder: no script errors' + (errs.length ? ' - ' + errs[0] : ''));
      await page.close(); }
    // The family's SOS alarm with the helpers to call
    { const { page, errs } = await app(theme, w, h, { sos: true });
      await page.waitForTimeout(600);
      const hrefs = await page.$$eval('#sa-ladder a', as => as.map(a => a.getAttribute('href')));
      ok(await page.isVisible('#sosalert') && hrefs.length === 2 && hrefs[0] === 'tel:%2B919811122222', tag + ' SOS: the nearby helpers, one tap to call');
      await check(page, tag + '-sos-alarm', '#sosalert');
      ok(!errs.length, tag + ' SOS: no script errors' + (errs.length ? ' - ' + errs[0] : ''));
      await page.close(); }
    // The nearby person's own page
    { const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme });
      await page.setContent(consentHtml({ name: 'Mrs Khanna', phone: '+919811122222', distance_note: 'Two floors down', has_key: true, hours: 'All day', consent: 'pending', person_name: 'Papa Sharma', by_name: 'Rohan' }));
      ok(/ending 2222/.test(await page.textContent('body')), tag + ' consent: only the last 4 digits');
      await check(page, tag + '-consent', null);
      await page.close(); }
  }
}
await browser.close(); server.close();
console.log(`\nfamilytools.browser: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
