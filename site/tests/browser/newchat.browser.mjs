// THE FLOATING "NEW CHAT" BUTTON, IN A REAL BROWSER.
//
// Beside the Ekta button sits a second one that starts a chat from any
// screen. What has to hold:
//   - it is there once signed in, on a phone and on a wide screen, and it
//     never covers the Ekta button;
//   - it offers the family chat, a new group, and one to one with each
//     person in the family (never with yourself);
//   - each choice lands in that chat, including a one-to-one chat that did
//     not exist a moment ago;
//   - it steps aside inside an open chat and on Ekta's own screen, and comes
//     back when you leave;
//   - it closes with the close button, Escape, or a tap outside.
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
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const ME   = '11111111-1111-1111-1111-111111111111';
const PAPA = '22222222-2222-2222-2222-222222222222';
const DIDI = '33333333-3333-3333-3333-333333333333';
const FAM  = 'cccccccc-0000-4000-8000-000000000001';
const DM_P = 'cccccccc-0000-4000-8000-000000000002';
const now = new Date().toISOString();

const eventsJson = { ok:true, circleName:'Sharma Family', code:'ABCDEF', seenAt:now, joinRequests:[], joinPolicy:'approve',
  sos:[], sosEscalateMin:5, pulse:null, calls:[],
  members:[{ id:ME, name:'Rohan', role:'family', relation:'son', phone:'+91 9873945238', place:'Delhi', country:'IN', gift_info:{}, created_at:now },
           { id:PAPA, name:'Papa', role:'parent', relation:'father', phone:'+91 9812345678', place:'Pune', country:'IN', gift_info:{}, created_at:now },
           { id:DIDI, name:'Meera', role:'family', relation:'sister', phone:'+91 9812345679', place:'Delhi', country:'IN', gift_info:{}, created_at:now }],
  events:[] };

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('playwright-core is not installed - see site/tests/browser/day.browser.mjs.');
  server.close(); process.exit(process.env.CI ? 1 : 0);
}
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors = [];
let pass = 0, fail = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); cond ? pass++ : fail++; };

async function open(viewport, members){
  // A fresh set of chats for each page: the family chat and one with Papa.
  const chats = [{ id:FAM, kind:'circle', name:null, memberCount:3, last:null },
                 { id:DM_P, kind:'dm', name:'Papa', others:'Papa', otherPhone:'+91 9812345678', memberCount:2, last:null }];
  const dms = [];
  const page = await browser.newPage({ viewport, serviceWorkers:'block' });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.route('**/api/**', r => r.fulfill({ json:{ ok:false, error:'stub' } }));
  await page.route('**/api/events*', r => r.fulfill({ json: r.request().method() === 'POST' ? { ok:true }
    : Object.assign({}, eventsJson, members ? { members } : {}) }));
  await page.route('**/api/chats*', r => {
    const req = r.request();
    if (req.method() === 'GET') {
      const one = new URL(req.url()).searchParams.get('chat');
      if (one) return r.fulfill({ json:{ ok:true, chat: chats.find(c => c.id === one), messages:[], reads:[], members:[] } });
      return r.fulfill({ json:{ ok:true, chats } });
    }
    const body = JSON.parse(req.postData() || '{}');
    if (body.action === 'open_dm') {
      dms.push(body.otherId);
      const had = chats.find(c => c.kind === 'dm' && c.others === (body.otherId === DIDI ? 'Meera' : 'Papa'));
      if (had) return r.fulfill({ json:{ ok:true, chatId: had.id } });
      const id = 'cccccccc-0000-4000-8000-00000000000' + (chats.length + 1);
      chats.push({ id, kind:'dm', name:'Meera', others:'Meera', otherPhone:'+91 9812345679', memberCount:2, last:null });
      return r.fulfill({ status:201, json:{ ok:true, chatId: id } });
    }
    return r.fulfill({ json:{ ok:true } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('parwah', JSON.stringify({ code:'ABCDEF', memberId:'11111111-1111-1111-1111-111111111111', name:'Rohan', role:'family', circleName:'Sharma Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id:'77777777-7777-4777-8777-777777777777', name:'Rohan', phone:'+919873945238' }));
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
  });
  await page.goto(BASE + '/#home');
  await page.waitForTimeout(900);
  page.dms = dms;
  return page;
}
const vis = (page, sel) => page.locator(sel).isVisible();
const box = (page, sel) => page.locator(sel).boundingBox();
const overlap = (a, b) => a && b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
async function sheetOpen(page){ await page.click('#chat-fab'); await page.waitForTimeout(150); }

for (const [label, viewport] of [['phone', { width:390, height:844 }]]) {
  const page = await open(viewport);
  // New chat sits in the top bar on every screen except Chat's own (owner,
  // 2026-10-13: one bottom bar, nothing floats). Ekta is a tab.
  ok(await vis(page, '#chat-fab'), `${label}: the New chat button is there on Today once signed in`);
  ok(await vis(page, '#tabs button[data-tab="ekta"]'), `${label}: and Ekta is a tab in the one bottom bar`);
  const a = await box(page, '#chat-fab'), bell = await box(page, '#bell');
  ok(a && a.y >= 0 && a.y + a.height <= 64, `${label}: it sits in the top bar`);
  ok(a && (!bell || !overlap(a, bell)), `${label}: beside the bell, never over it`);
  ok(a && a.y + a.height <= viewport.height && a.x + a.width <= viewport.width, `${label}: fully on screen`);

  // Scrolled to the very end, the last card still clears the bottom bar.
  const clear = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const cards = [...document.querySelectorAll('#pane-home > *')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0);
    const last = cards[cards.length - 1].getBoundingClientRect();
    return last.bottom <= document.getElementById('tabs').getBoundingClientRect().top + 1;
  });
  ok(clear, `${label}: at the bottom of the page, the last card is not hidden behind the bar`);
  await page.evaluate(() => window.scrollTo(0, 0));

  // The choices.
  await sheetOpen(page);
  ok(await vis(page, '#ncsheet'), `${label}: tapping it opens the choices`);
  ok(await vis(page, '#nc-family') && await vis(page, '#nc-group'), `${label}: family chat and new group are offered`);
  const people = await page.locator('#nc-list [data-dm]').evaluateAll(els => els.map(e => e.getAttribute('data-dm')));
  ok(people.length === 2 && people.includes(PAPA) && people.includes(DIDI) && !people.includes(ME),
     `${label}: one to one with each person in the family, never yourself (${people.length})`);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'nc-family'),
     `${label}: focus moves into the choices`);

  // Closing, three ways.
  await page.click('#nc-x'); await page.waitForTimeout(100);
  ok(!(await vis(page, '#ncsheet')), `${label}: the close button closes it`);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'chat-fab'),
     `${label}: and focus returns to the button`);
  await sheetOpen(page); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok(!(await vis(page, '#ncsheet')), `${label}: Escape closes it`);
  await sheetOpen(page); await page.mouse.click(8, 8); await page.waitForTimeout(100);
  ok(!(await vis(page, '#ncsheet')), `${label}: a tap outside closes it`);

  // Family chat.
  await sheetOpen(page); await page.click('#nc-family'); await page.waitForTimeout(400);
  ok(await vis(page, '#chatview') && (await page.textContent('#cv-name')).includes('family chat'),
     `${label}: Family chat opens the whole family's chat`);
  ok(!(await vis(page, '#chat-fab')), `${label}: inside a chat the New chat button steps aside`);
  await page.click('#chatback'); await page.waitForTimeout(200);
  ok(!(await vis(page, '#chat-fab')), `${label}: and stays aside on Chat's own screen`);
  ok(await vis(page, '#tabs button[data-tab="ekta"]'), `${label}: Ekta's tab is still right there`);
  const home = async () => { await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(300); };

  // An existing one-to-one chat.
  await home();
  await sheetOpen(page); await page.click(`#nc-list [data-dm="${PAPA}"]`); await page.waitForTimeout(500);
  ok(await vis(page, '#chatview') && (await page.textContent('#cv-name')) === 'Papa', `${label}: tapping Papa opens the chat with Papa`);
  ok(page.dms[page.dms.length - 1] === PAPA, `${label}: asking the server for that exact person`);
  await page.click('#chatback'); await page.waitForTimeout(200);
  await home();

  // A one-to-one chat that does not exist yet.
  await sheetOpen(page); await page.click(`#nc-list [data-dm="${DIDI}"]`); await page.waitForTimeout(600);
  ok(await vis(page, '#chatview') && (await page.textContent('#cv-name')) === 'Meera', `${label}: a first chat with Meera is created and opened`);
  await page.click('#chatback'); await page.waitForTimeout(200);
  await home();

  // New group.
  await sheetOpen(page); await page.click('#nc-group'); await page.waitForTimeout(300);
  ok(await vis(page, '#pane-chat') && await vis(page, '#groupform'), `${label}: New group chat opens the group form`);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'g-name'), `${label}: ready to type its name`);
  ok(await page.locator('#g-mem input[type=checkbox]').count() === 2, `${label}: with the family to pick from`);

  // Ekta's own screen, reached through its tab.
  await home();
  await page.click('#tabs button[data-tab="ekta"]'); await page.waitForTimeout(300);
  ok(await vis(page, '#pane-ekta'), `${label}: the Ekta tab opens Ekta`);
  ok(await vis(page, '#chat-fab'), `${label}: and the New chat button stays in the top bar`);
  const solo = await box(page, '#chat-fab'), send = await box(page, '#send');
  ok(solo && send && !overlap(solo, send), `${label}: nowhere near Send`);

  // Every other screen has both ways in.
  for (const t of ['vault', 'care', 'people', 'fun', 'day', 'profile', 'notifs', 'memory']) {
    await page.evaluate(h => { location.hash = '#' + h; }, t); await page.waitForTimeout(250);
    ok(await vis(page, '#chat-fab') && await vis(page, '#tabs button[data-tab="ekta"]'), `${label}: New chat and the Ekta tab are both on ${t}`);
  }
  await page.close();
}

// A laptop already has Chat and Ask Ekta in the sidebar. Floating copies
// sat on the page. SOS is not a place, so it stays in the rail.
{
  const page = await open({ width:1280, height:860 });
  const label = 'wide screen';
  ok(!(await vis(page, '#chat-fab')) && !(await vis(page, '#ekta-fab')),
     `${label}: Chat and Ekta do not float over the page`);
  ok(await vis(page, '#tabs button[data-tab="chat"]') && await vis(page, '#tabs button[data-tab="ekta"]'),
     `${label}: they are in the sidebar`);
  const sos = await box(page, '#sos-fab'), tabs = await box(page, '#tabs');
  ok(sos && sos.width >= 56 && sos.height >= 56,
     `${label}: SOS is a full control (${sos && Math.round(sos.width)} by ${sos && Math.round(sos.height)})`);
  ok(sos && tabs && sos.x >= tabs.x - 1 && sos.x + sos.width <= tabs.x + tabs.width + 1 && sos.y >= tabs.y - 1,
     `${label}: SOS sits in the sidebar, not over the page`);
  await page.evaluate(() => { location.hash = '#care'; });
  await page.waitForTimeout(250);
  const lane = await page.evaluate(() => {
    const pane = document.getElementById('pane-care').getBoundingClientRect();
    const r = document.getElementById('sos-fab').getBoundingClientRect();
    const list = document.getElementById('rlist').getBoundingClientRect().width;
    // The add form, found by its title box: the first .card on To do is
    // now whatever the family keeps (refill alerts and the like), not the form.
    const card = document.getElementById('r-title').closest('.card').getBoundingClientRect().width;
    const overlap = !(pane.right <= r.left + 1 || pane.left >= r.right - 1 || pane.bottom <= r.top + 1 || pane.top >= r.bottom - 1);
    return { overlap, same: Math.abs(list - card) < 2, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  });
  ok(!lane.overlap, `${label}: To do does not run under SOS`);
  ok(lane.same, `${label}: the to-do list and the add form are the same width`);
  ok(!lane.overflow, `${label}: the page does not scroll sideways`);
  await page.click('#tabs button[data-tab="chat"]');
  await page.waitForTimeout(300);
  ok(await vis(page, '#pane-chat') && !(await vis(page, '#ncsheet')),
     `${label}: Chat in the sidebar opens the chat list, not the phone sheet`);
  await page.click('#tabs button[data-tab="ekta"]');
  await page.waitForTimeout(300);
  ok(await vis(page, '#pane-ekta'), `${label}: Ask Ekta in the sidebar opens Ekta`);
  await page.close();
}

// The smallest phone: New chat is a bar icon with a full tap target, SOS is
// docked in the tab bar, and nothing floats over the page at all.
{
  const page = await open({ width:320, height:682 });
  const fab = await box(page, '#chat-fab'), sos = await box(page, '#sos-fab'), tabs = await box(page, '#tabs');
  ok(fab && fab.width >= 44 && fab.height >= 44 && fab.y + fab.height <= 64, 'small phone: New chat is a top-bar icon with a full tap target (' + (fab && Math.round(fab.width)) + 'px)');
  ok(sos && sos.width >= 56 && tabs && sos.y >= tabs.y - 1 && sos.y + sos.height <= tabs.y + tabs.height + 1, 'small phone: SOS is docked inside the bottom bar');
  ok(await page.getAttribute('#chat-fab', 'aria-label') === 'Start a new chat' && (await page.getAttribute('#tabs button[data-tab="ekta"]', 'aria-label')) === 'Ask Ekta',
     'small phone: both still have their names for screen readers');
  ok(await page.evaluate(() => document.querySelectorAll('.fab').length === 0), 'small phone: nothing floats over the page');
  await page.close();
}

// Alone in the circle: no dead end, a way to invite.
{
  const page = await open({ width:390, height:844 }, [eventsJson.members[0]]);
  await sheetOpen(page);
  ok(await page.locator('#nc-list [data-dm]').count() === 0, 'alone in the circle: nobody to pick');
  ok(await vis(page, '#nc-invite'), 'and an Invite family button instead of an empty list');
  await page.close();
}

// Signed out: not there at all.
{
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  await page.route('**/api/**', r => r.fulfill({ json:{ ok:false } }));
  await page.goto(BASE + '/');
  await page.waitForTimeout(600);
  ok(!(await vis(page, '#chat-fab')), 'signed out, there is no New chat button');
  await page.close();
}

ok(errors.length === 0, 'no script errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
