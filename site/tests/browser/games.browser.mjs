// Several games at once, in a real browser: the list, telling two games of
// the same kind apart, opening one, coming back, and starting another while
// one is already running.
//
// NOT part of the deploy gate - Vercel's builders have no browser. Run it
// locally when the games screen changes:
//
//     npm i --no-save playwright-core && npx playwright install chromium
//     npm run test:browser
//
// PW_CHROMIUM can point at an existing Chromium if you already have one.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';
import { gameSummary } from '../../../api/_gamelist.mjs';

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

const ME   = '11111111-1111-1111-1111-111111111111';
const PAPA = '22222222-2222-2222-2222-222222222222';
const BETA = '33333333-3333-3333-3333-333333333333';
const now = new Date().toISOString();

const seat = (id, name, extra) => Object.assign({ id, name, pos: 0 }, extra || {});
// Four games at once, two of them the same kind. This is the fixture the
// whole feature exists for: one Saanp Seedhi waiting on me, a second Saanp
// Seedhi waiting on Papa, a duel I am not in, and an open lobby.
const GAMES = {
  'aaaaaaaa-0000-4000-8000-000000000001': { kind:'snakes', n:1, by:'Rohan', players:[seat(ME,'Rohan'), seat(PAPA,'Papa'), seat(BETA,'Beta')], turn:0, last:null, winner:null },
  'aaaaaaaa-0000-4000-8000-000000000002': { kind:'snakes', n:2, by:'Papa',  players:[seat(ME,'Rohan'), seat(PAPA,'Papa')], turn:1, last:null, winner:null },
  'aaaaaaaa-0000-4000-8000-000000000003': { kind:'ttt', n:1, by:'Papa', players:[seat(PAPA,'Papa'), seat(BETA,'Beta')], turn:0, board:[null,null,null,null,null,null,null,null,null], winner:null, draw:false },
  'aaaaaaaa-0000-4000-8000-000000000004': { kind:'antakshari', n:1, by:'Beta', status:'lobby', admins:[BETA], players:[{ id:BETA, name:'Beta', team:0, score:0 }], teamScores:[0,0], teamTurn:0, ptr:[0,0], letter:'K', prompt:null, last:null, winner:null }
};
const rowOf = (id) => ({ id, kind: GAMES[id].kind, status: 'active', state: GAMES[id], created_at: now });
const listFor = (me) => Object.keys(GAMES).map(rowOf).map(g => gameSummary(g, me))
  .sort((a, b) => (a.myTurn ? 0 : a.mine ? 1 : 2) - (b.myTurn ? 0 : b.mine ? 1 : 2));

const eventsJson = { ok:true, circleName:'Test Family', code:'ABCDEF', seenAt:now, joinRequests:[], joinPolicy:'approve',
  sos:[], sosEscalateMin:5, pulse:null, calls:[],
  members:[{ id:ME, name:'Rohan', role:'family', relation:'son', phone:'+91 9873945238', place:'Delhi', country:'IN', dob:'1990-08-05', gift_info:{}, created_at:now },
           { id:PAPA, name:'Papa', role:'parent', relation:'father', phone:'+91 9812345678', place:'Pune', country:'IN', dob:'1958-01-05', gift_info:{}, created_at:now },
           { id:BETA, name:'Beta', role:'family', relation:'daughter', phone:'+91 9812345679', place:'Delhi', country:'IN', dob:'1994-02-02', gift_info:{}, created_at:now }],
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

let started = [];                       // every start_* the app sent
const notFound = [];                    // every 4xx the app actually received
async function open(viewport){
  const page = await browser.newPage({ viewport, serviceWorkers:'block' });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // A resource 404 is asserted on directly through the response stream
  // below, so it does not also need to come through the console.
  page.on('console', m => { if (m.type() === 'error' && m.text().indexOf('net::') < 0 && m.text().indexOf('Failed to load resource') < 0) errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) notFound.push(r.status() + ' ' + r.url()); });
  await page.route('**/api/**', r => r.fulfill({ json:{ ok:false, error:'stub' } }));
  await page.route('**/api/events*', r => r.fulfill({ json: r.request().method() === 'POST' ? { ok:true } : eventsJson }));
  await page.route('**/api/plans*', r => r.fulfill({ json:{ ok:true, plans:[] } }));
  await page.route('**/api/games*', async (r) => {
    const req = r.request();
    if (req.method() === 'GET') {
      const u = new URL(req.url());
      const one = u.searchParams.get('game');
      const games = listFor(ME);
      if (one) {
        if (!GAMES[one]) return r.fulfill({ status:404, json:{ ok:false, error:'That game is over or was ended' } });
        return r.fulfill({ json:{ ok:true, game: rowOf(one), games } });
      }
      return r.fulfill({ json:{ ok:true, games, game: rowOf(Object.keys(GAMES)[0]) } });
    }
    const body = JSON.parse(req.postData() || '{}');
    if (String(body.action || '').indexOf('start') === 0) {
      started.push(body.action);
      // A new game, never a handback of an existing one.
      const id = 'aaaaaaaa-0000-4000-8000-00000000000' + (Object.keys(GAMES).length + 1);
      GAMES[id] = { kind:'snakes', n:3, by:'Rohan', players:[seat(ME,'Rohan'), { id:'bot', name:'Parwah', bot:true, pos:0 }], turn:0, last:null, winner:null };
      return r.fulfill({ status:201, json:{ ok:true, game: rowOf(id) } });
    }
    return r.fulfill({ json:{ ok:true, game: rowOf(body.gameId || Object.keys(GAMES)[0]) } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('parwah', JSON.stringify({ code:'ABCDEF', memberId:'11111111-1111-1111-1111-111111111111', name:'Rohan', role:'family', circleName:'Test Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id:'77777777-7777-4777-8777-777777777777', name:'Rohan', phone:'+919873945238' }));
    localStorage.setItem('parwah-fr-hide', '1');
  });
  await page.goto(BASE + '/app/');
  await page.waitForTimeout(700);
  return page;
}
async function toGames(page){
  // The way a person actually gets there: the Games card on Home. This is
  // the navigation the feature is judged on, so the test uses it too.
  await page.locator('button[data-goto="fun"][data-sec="games"]').first().click();
  await page.waitForTimeout(900);
}

// ---------------- phone ----------------
const pg = await open({ width:390, height:844 });
await toGames(pg);

const rows = pg.locator('#glist button[data-gopen]');
ok(await pg.locator('#game-list').isVisible(), 'the games tab opens on the list, not inside a game');
ok(await rows.count() === 4, 'every game on the go is listed (4)');
ok(await pg.locator('#game-on').isHidden(), 'no game is opened for you');

const names = (await rows.locator('.txt b').allTextContents()).map(t => t.trim());
ok(names.filter(n => n.indexOf('Saanp Seedhi') === 0).length === 2, 'two Saanp Seedhi games are both listed');
ok(names.some(n => /Saanp Seedhi .* 2$/.test(n)), 'the second one is numbered so they can be told apart');
ok(new Set(names).size === names.length, 'no two rows carry the same name');

const first = rows.first();
ok((await first.locator('.txt b').textContent()).indexOf('Saanp Seedhi') === 0, 'the game waiting on you is first');
ok(await first.locator('.gturn').textContent() === 'Your turn', 'and it says it is your turn');
ok(await first.evaluate(el => el.className.indexOf('needsyou') >= 0), 'and it is marked for the eye, not by colour alone');
const box = await first.boundingBox();
ok(box && box.height >= 44, 'a row is big enough for a senior to tap (' + Math.round(box ? box.height : 0) + 'px)');

const subs = (await rows.locator('.txt small').allTextContents()).join(' | ');
ok(subs.indexOf('Waiting for Papa') >= 0, 'a row you are in says who it is waiting for');
ok(subs.indexOf('Lobby open') >= 0, 'an open lobby says so');
ok(subs.indexOf('Papa, Beta') >= 0, 'a row names who is playing');

// open one, and know which one you opened
await first.click();
await pg.waitForTimeout(500);
ok(await pg.locator('#game-on').isVisible(), 'tapping a row opens that game');
ok(await pg.locator('#game-list').isHidden() && await pg.locator('#game-none').isHidden(), 'the list and the menu step aside');
ok((await pg.locator('#gm-name').textContent()).indexOf('Saanp Seedhi') === 0, 'the open game says which game it is');
ok(await pg.locator('#g-snakes').isVisible(), 'the board is the right board');

// and get back out
await pg.locator('#g-back').click();
await pg.waitForTimeout(500);
ok(await pg.locator('#game-list').isVisible() && await pg.locator('#game-on').isHidden(), 'there is a way back to the list');
ok(await pg.locator('#game-none').isVisible(), 'and the way to start another is there too');

// open the SECOND Saanp Seedhi and confirm it is a different game
const second = pg.locator('#glist button[data-gopen]').filter({ hasText:'Saanp Seedhi' }).nth(1);
const secondName = (await second.locator('.txt b').textContent()).trim();
await second.click();
await pg.waitForTimeout(500);
ok((await pg.locator('#gm-name').textContent()).trim() === secondName, 'the second Saanp Seedhi opens as itself, not the first');

// start another while games are already running
await pg.locator('#g-back').click();
await pg.waitForTimeout(400);
const before = await pg.locator('#glist button[data-gopen]').count();
await pg.locator('#g-solo').click();
await pg.waitForTimeout(700);
ok(started.indexOf('start') >= 0, 'starting is allowed while other games are on');
ok(await pg.locator('#game-on').isVisible(), 'the game you just started is the one you are looking at');
await pg.locator('#g-back').click();
await pg.waitForTimeout(600);
ok(await pg.locator('#glist button[data-gopen]').count() === before + 1, 'the new game joins the list beside the others');

// a game someone else ended while you were in it
await pg.locator('#glist button[data-gopen]').first().click();
await pg.waitForTimeout(500);
const gone = await pg.locator('#gm-name').textContent();
await pg.evaluate(() => {});
delete GAMES[Object.keys(GAMES)[0]];
await pg.waitForTimeout(3600);   // the fun tab polls every 3s
ok(await pg.locator('#game-list').isVisible(), 'a game ended under you drops you back to the list, not a blank screen');
// The only thing the app was ever refused is the game that was taken away.
ok(notFound.length > 0 && notFound.every(u => u.indexOf('404') === 0 && u.indexOf('/api/games') > 0),
   'nothing 404s except the game that was ended' + (notFound.length ? ' (' + notFound.length + ' seen)' : ' (none seen)'));

// ---------------- desktop ----------------
const dt = await open({ width:1440, height:900 });
await toGames(dt);
ok(await dt.locator('#glist button[data-gopen]').count() >= 4, 'the list is there on the desktop too');
const dbox = await dt.locator('#glist button[data-gopen]').first().boundingBox();
ok(dbox && dbox.width > 380, 'and it uses the width it has (' + Math.round(dbox ? dbox.width : 0) + 'px)');

// ---------------- dark ----------------
const dk = await browser.newPage({ viewport:{ width:390, height:844 }, serviceWorkers:'block', colorScheme:'dark' });
dk.on('pageerror', e => errors.push('dark pageerror: ' + e.message));
await dk.addInitScript(() => localStorage.setItem('parwah-theme', 'dark'));
await dk.route('**/api/**', r => r.fulfill({ json:{ ok:false, error:'stub' } }));
await dk.route('**/api/events*', r => r.fulfill({ json: eventsJson }));
await dk.route('**/api/games*', r => r.fulfill({ json:{ ok:true, games: listFor(ME), game: null } }));
await dk.addInitScript(() => {
  localStorage.setItem('parwah', JSON.stringify({ code:'ABCDEF', memberId:'11111111-1111-1111-1111-111111111111', name:'Rohan', role:'family', circleName:'Test Family' }));
  localStorage.setItem('parwah-fr-hide', '1');
});
await dk.goto(BASE + '/app/');
await dk.waitForTimeout(700);
await toGames(dk);
const contrast = await dk.locator('#glist .gturn').first().evaluate(el => {
  const lum = (c) => { const [r,g,b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*r + 0.7152*g + 0.0722*b; };
  const s = getComputedStyle(el);
  let bg = s.backgroundColor, node = el;
  while (bg === 'rgba(0, 0, 0, 0)' && node.parentElement) { node = node.parentElement; bg = getComputedStyle(node).backgroundColor; }
  const a = lum(s.color), b = lum(bg);
  return Math.round(((Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05)) * 100) / 100;
});
ok(contrast >= 4.5, 'the turn badge is legible in dark (' + contrast + ':1)');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0,3).join(' / ') : ''));
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
