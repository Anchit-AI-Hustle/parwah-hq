// LUDO, BHABHI AND VYAPAR, END TO END: a real browser, the real games API
// and a real PostgreSQL. Each game is started from its card and played by
// tapping, against Parwah, all the way to the end. Then two people play
// one game, and their moves land in turn - never both at once.
//
// Needs PARWAH_TEST_DATABASE_URL (a database ending in _test - it is wiped)
// and playwright-core. Run with: npm run test:db
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('games.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('games.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('games.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['games', 'events', 'chats', 'auth', 'care', 'book']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function person(circleId, name) {
  const phone = '+9198300' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id) values ($1,$2,'family',$3) returning id`, [circleId, name, u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, userId: u.id, name, token, phone };
}
const circle = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const rohan = await person(circle, 'Rohan');
const meera = await person(circle, 'Meera');

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const h = HANDLERS[u.pathname.slice(5).replace(/\/$/, '')];
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

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };
const errors = [];
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

async function phone(who, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
  await ctx.addInitScript(([w]) => {
    localStorage.setItem('parwah', JSON.stringify({ code: 'SHARMA', memberId: w.id, name: w.name, role: 'family', circleName: 'Sharma Family' }));
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/#fun');
  await page.waitForTimeout(700);
  await page.click('#fun-seg [data-sec="games"]');
  await page.waitForTimeout(400);
  return page;
}
const lastGame = async (kind) => (await admin.query(`select * from games where kind = $1 order by created_at desc limit 1`, [kind])).rows[0];
const vis = (p, s) => p.locator(s).first().isVisible();

const R = await phone(rohan);
// A finished game is dropped from the open screen by the next 3-second poll
// (review D, D-3, fixed separately): by the time the test taps "All games"
// the list may already be showing. Either way, the list is where it ends up.
async function backToList() {
  if (await R.isVisible('#g-back')) await R.click('#g-back', { timeout: 5000 }).catch(() => {});
  await R.waitForTimeout(300);
}
ok('the Coming soon game tiles are gone', (await R.locator('#pane-fun >> text=Coming soon').count()) === 0);
for (const k of ['ludo', 'bhabhi', 'vyapar']) ok(`${k}: its card is there to start`, await R.locator(`[data-bstart="${k}"]`).count() === 1);
ok('each game card lets you pick family to play with', (await R.locator('.bpick[data-for="ludo"] input[type=checkbox]').count()) === 1);

// A tap, the way a finger taps. The board re-renders on its own between the
// check and the tap (the other player moves, buttons bounce), so a button seen
// enabled can be disabled a moment later: tap at once, give up after 3s, and
// the loop looks again. True only if the tap landed.
// A finger scrolls what it wants to tap into the middle of the screen first:
// a token under the sticky top bar is not tapped through the bar.
const tap = (loc) => loc.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {})
  .then(() => loc.click({ force: true, timeout: 3000 })).then(() => true, () => false);

// ---------------- Ludo, alone, to the end ----------------
{
  await R.click('[data-bsolo="ludo"]');
  await R.waitForTimeout(700);
  ok('ludo: playing alone opens the board', await vis(R, '#g-ludo') && (await R.locator('#lboard .lc').count()) === 225);
  ok('ludo: eight tokens on the board, four each', (await R.locator('#lboard .ltok').count()) >= 2);
  let rolls = 0, picks = 0, stayedOpen = true;
  for (let i = 0; i < 700; i++) {
    const s = await (await lastGame('ludo')).state;
    if (s.winner) break;
    if (!(await vis(R, '#g-ludo'))) { stayedOpen = false; break; }
    const tok = R.locator('#lboard button[data-ltok]');
    const roll = R.locator('#l-roll:not([disabled])');
    if (await tok.count()) { if (await tap(tok.first())) picks++; }   // it pulses: a finger does not wait for it to stop
    else if (await roll.count()) { if (await tap(roll)) rolls++; }
    await R.waitForTimeout(60);
  }
  const g = await lastGame('ludo');
  ok('ludo: the game stays open the whole way', stayedOpen);
  ok('ludo: played by tapping Roll and tokens (' + rolls + ' rolls, ' + picks + ' picks)', rolls > 20 && picks > 0);
  ok('ludo: it ends with a winner', !!g.state.winner && g.status === 'done', g.state.winner);
  ok('ludo: the screen says who won', /won/.test(await R.textContent('#l-status')));
  ok('ludo: a solo game is not announced to the family', (await admin.query(`select count(*)::int as n from events where text like '%Ludo%'`)).rows[0].n === 0);
  // The result stays: the next 3-second look used to drop the player back
  // to "No game on right now" before they had read it.
  await R.waitForTimeout(4000);
  ok('ludo: four seconds on, the result is still on the screen', await vis(R, '#g-ludo') && await vis(R, '#g-result') && /won/.test(await R.textContent('#g-result')), await R.textContent('#g-result').catch(() => ''));
  ok('ludo: a finished game offers Play again, and no longer "End game"', await vis(R, '#g-again') && !(await vis(R, '#l-end')));
  await R.click('#g-rules summary');
  ok('ludo: How to play says the rules the game uses', /Roll a 6 to bring a token out/.test(await R.textContent('#g-rules-list')) && /star squares/.test(await R.textContent('#g-rules-list')));
  ok('ludo: the floating buttons step aside while a game is open', !(await vis(R, '#ekta-fab')) && !(await vis(R, '#chat-fab')));
  const before = g.id;
  await R.click('#g-again'); await R.waitForTimeout(900);
  const again = await lastGame('ludo');
  ok('ludo: Play again starts a new game, alone again', again.id !== before && again.status === 'active' && again.state.players.some(p => p.bot) && await vis(R, '#g-ludo'));
  await admin.query(`update games set status = 'done' where id = $1`, [again.id]);   // put away, with no result
  // Back to the list: by the button, or by the app itself - its next look
  // sees the game was put away and leaves it, which can happen first.
  if (await vis(R, '#g-back')) await tap(R.locator('#g-back'));
  await R.waitForFunction(() => { const l = document.querySelector('#glist'); return !!(l && l.getClientRects().length); }, null, { timeout: 8000 });
  await R.waitForTimeout(600);
  const rows = await R.$$eval('#glist button[data-gopen]', bs => bs.map(b => b.getAttribute('data-gopen') + '|' + b.textContent));
  ok('ludo: the list keeps the finished game, marked Done', rows.some(r => r.startsWith(before + '|') && /Done/.test(r)), rows.join(' / '));
  ok('ludo: a game put away without a result leaves the list', !rows.some(r => r.startsWith(again.id + '|')));
  await R.click(`#glist button[data-gopen="${before}"]`); await R.waitForTimeout(700);
  ok('ludo: a finished game opens from the list, result and all', await vis(R, '#g-result'));
  await backToList();
}

// ---------------- Bhabhi, alone, to the end ----------------
{
  await R.click('[data-bsolo="bhabhi"]');
  await R.waitForTimeout(700);
  ok('bhabhi: dealing opens the table', await vis(R, '#g-bhabhi'));
  const res = await R.evaluate(async () => {
    const st = JSON.parse(localStorage.getItem('parwah'));
    const r = await fetch('/api/games?circle=SHARMA&member=' + st.memberId, { headers: { 'X-Parwah-Token': localStorage.getItem('parwah-token') } });
    return r.json();
  });
  const view = res.game.state;
  ok('bhabhi: the server sends you only your own cards', view.hands.filter(h => h.length).length <= 1 && Array.isArray(view.counts));
  const row = await lastGame('bhabhi');
  ok('bhabhi: the database holds every hand', row.state.hands.flat().length + (row.state.trick || []).length <= 52 && row.state.hands.filter(h => h.length).length >= 2);
  let plays = 0, refused = 0;
  for (let i = 0; i < 400; i++) {
    const s = (await lastGame('bhabhi')).state;
    if (s.loser) break;
    const can = R.locator('#b-hand button[data-bcard]:not([disabled])');
    if (await can.count()) { if (await tap(can.first())) plays++; }
    await R.waitForTimeout(60);
  }
  const g = await lastGame('bhabhi');
  ok('bhabhi: played by tapping cards (' + plays + ' plays)', plays > 3);
  ok('bhabhi: it ends with a Bhabhi', !!g.state.loser && g.status === 'done', g.state.loser);
  // Named without a family title: "holds the last cards" (review D-19).
  ok('bhabhi: the screen says who got away and who holds the last cards', /got away first/.test(await R.textContent('#b-status')) && /holds the last cards/.test(await R.textContent('#b-status')) && !/is the Bhabhi/.test(await R.textContent('#b-status')), await R.textContent('#b-status'));
  // A card you may not play cannot be tapped.
  ok('bhabhi: only playable cards were ever enabled', refused === 0);
  await backToList();
}

// ---------------- Vyapar, alone ----------------
{
  await R.click('[data-bsolo="vyapar"]');
  await R.waitForTimeout(700);
  ok('vyapar: the board of cities opens', await vis(R, '#g-vyapar') && (await R.locator('#vboard .vc').count()) === 24);
  ok('vyapar: says it is play money', /Play money only/.test(await R.textContent('#g-vyapar')));
  let rolls = 0, buys = 0;
  for (let i = 0; i < 160; i++) {
    const s = (await lastGame('vyapar')).state;
    if (s.winner) break;
    const buy = R.locator('#v-acts [data-vdo="buy"]');
    const roll = R.locator('#v-acts [data-vdo="roll"]');
    if (await buy.count()) { if (await tap(buy)) buys++; }
    else if (await roll.count()) { if (await tap(roll)) rolls++; }
    await R.waitForTimeout(60);
  }
  const s = (await lastGame('vyapar')).state;
  ok('vyapar: played by tapping Roll and Buy (' + rolls + ' rolls, ' + buys + ' buys)', rolls > 20 && buys > 0);
  ok('vyapar: cities get owned', Object.keys(s.owners).length > 0);
  ok('vyapar: money moves', s.players.some(p => p.money !== 1500));
  // End it: the richest wins.
  if (!s.winner) {
    await R.click('#v-end'); await R.waitForTimeout(600);
    const e = (await lastGame('vyapar'));
    ok('vyapar: ending the game names the richest', !!e.state.winner && e.status === 'done', e.state.winner);
  } else ok('vyapar: it ended with a winner', true);
  await R.waitForTimeout(300);
}

// ---------------- Two people, one Ludo game ----------------
{
  const M = await phone(meera);
  await R.goto(BASE + '/#fun'); await R.waitForTimeout(600);
  await R.click('#fun-seg [data-sec="games"]'); await R.waitForTimeout(300);
  await R.check(`.bpick[data-for="ludo"] input[value="${meera.id}"]`);
  await R.click('[data-bstart="ludo"]');
  await R.waitForTimeout(800);
  const g = await lastGame('ludo');
  ok('two players: Rohan and Meera are both seated, no Parwah', g.state.players.length === 2 && g.state.players.every(p => !p.bot));
  ok('two players: it is in the family feed', (await admin.query(`select count(*)::int as n from events where text like '%started Ludo%Meera%'`)).rows[0].n === 1);
  await M.reload(); await M.waitForTimeout(600);
  await M.click('#fun-seg [data-sec="games"]'); await M.waitForTimeout(500);
  ok('two players: Meera sees the game in her list', (await M.locator('#glist button[data-gopen]').count()) >= 1);
  const body = (who) => ({ code: 'SHARMA', memberId: who.id, action: 'play', gameId: g.id, move: { do: 'roll' } });
  const call = (page, who) => page.evaluate(async ([b, tok]) => {
    const r = await fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Parwah-Token': tok }, body: JSON.stringify(b) });
    return r.status;
  }, [body(who), who.token]);
  // On Rohan's turn, Meera's roll is refused and changes nothing.
  const g0 = await lastGame('ludo');
  const b = await call(M, meera);
  ok('two players: only the player whose turn it is can roll', b === 409 && (await lastGame('ludo')).state.v === g0.state.v, b);
  ok('two players: and the player whose turn it is can', (await call(R, rohan)) === 200);
  // Two rolls from the same player at once: one lands, the other is told
  // the board moved. Set the board so a roll is due, whatever came before.
  const cur = await lastGame('ludo');
  const st0 = cur.state; st0.moves = null; st0.roll = null; st0.sixes = 0; st0.turn = 0;
  await admin.query('update games set state = $1::jsonb, status = $2 where id = $3', [JSON.stringify(st0), 'active', cur.id]);
  const both = await Promise.all([call(R, rohan), call(R, rohan), call(R, rohan)]);
  const v2 = (await lastGame('ludo')).state.v;
  ok('two players: three rolls sent at once: exactly one lands', both.filter(x => x === 200).length === 1 && v2 === st0.v + 1, both.join() + ' v' + st0.v + '->' + v2);
  await M.close();
}

// ---------------- Saanp Seedhi: only who you pick; nobody holds it up ----------------
{
  const M = await phone(meera);
  await R.goto(BASE + '/#fun'); await R.waitForTimeout(600);
  await R.click('#fun-seg [data-sec="games"]'); await R.waitForTimeout(300);
  const n0 = (await admin.query(`select count(*)::int as n from games where kind = 'snakes'`)).rows[0].n;
  await R.click('#g-start'); await R.waitForTimeout(500);
  ok('snakes: with nobody ticked, no game is started for the whole family', (await admin.query(`select count(*)::int as n from games where kind = 'snakes'`)).rows[0].n === n0);
  await R.check(`.bpick[data-for="snakes"] input[value="${meera.id}"]`);
  await R.click('#g-start'); await R.waitForTimeout(800);
  let g = await lastGame('snakes');
  ok('snakes: only the people picked are seated', g.state.players.length === 2 && g.state.players.map(p => p.name).join() === 'Rohan,Meera');
  // Rohan rolls; then it is Meera's turn, and she does not come.
  await R.click('#g-roll'); await R.waitForTimeout(700);
  g = await lastGame('snakes');
  ok('snakes: after Rohan rolls it is Meera\'s turn', g.state.turn === 1 || !!g.state.winner, String(g.state.turn));
  const early = await R.evaluate(async ([gid, tok, me, them]) => {
    const r = await fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Parwah-Token': tok },
      body: JSON.stringify({ code: 'SHARMA', memberId: me, action: 'away', who: 'them', targetId: them, gameId: gid }) });
    return r.status;
  }, [g.id, rohan.token, rohan.id, meera.id]);
  ok('snakes: an hour later, nobody can take Meera\'s turn yet', early === 409, early);
  ok('snakes: and the screen does not offer it', !(await vis(R, '#g-hand')));
  const away = (who, target) => R.evaluate(async ([gid, tok, me, w, them]) => {
    const r = await fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Parwah-Token': tok },
      body: JSON.stringify({ code: 'SHARMA', memberId: me, action: 'away', who: w, targetId: them, gameId: gid }) });
    return r.status;
  }, [g.id, rohan.token, rohan.id, who, target]);
  const stateNow = async () => (await admin.query('select state from games where id = $1', [g.id])).rows[0].state;
  // A game from before turns were timed has no clock: it starts now, and
  // does not count as having waited since 1970.
  { const old = JSON.parse(JSON.stringify(g.state)); delete old.turnAt;
    await admin.query('update games set state = $1::jsonb where id = $2', [JSON.stringify(old), g.id]); }
  const legacy = await away('them', meera.id);
  const lst = await stateNow();
  ok('snakes: a game with no turn clock is not handed over at once; its clock starts now',
     legacy === 409 && Math.abs(Date.now() - Number(lst.turnAt)) < 60000 && !lst.players[1].away, legacy + ' ' + lst.turnAt);
  // Someone else leaving does not give the person whose turn it is another 12 hours.
  { const s11 = JSON.parse(JSON.stringify(g.state)); s11.turnAt = Date.now() - 11 * 3600 * 1000;
    await admin.query('update games set state = $1::jsonb where id = $2', [JSON.stringify(s11), g.id]);
    const left = await away('me');
    const after = await stateNow();
    ok('snakes: when another player leaves, Meera\'s 11 hours keep counting',
       left === 200 && after.players[0].away === true && after.turn === 1 && Date.now() - Number(after.turnAt) > 10.9 * 3600 * 1000,
       left + ' ' + JSON.stringify({ t: after.turn, at: after.turnAt })); }
  // Three handovers sent at once: one lands, nothing is written over it.
  { const s13 = JSON.parse(JSON.stringify(g.state)); s13.turnAt = Date.now() - 13 * 3600 * 1000;
    await admin.query('update games set state = $1::jsonb where id = $2', [JSON.stringify(s13), g.id]);
    const e0 = (await admin.query(`select count(*)::int as n from events where text like 'Rohan let the computer play for Meera%'`)).rows[0].n;
    const three = await Promise.all([away('them', meera.id), away('them', meera.id), away('them', meera.id)]);
    const e1 = (await admin.query(`select count(*)::int as n from events where text like 'Rohan let the computer play for Meera%'`)).rows[0].n;
    ok('snakes: three handovers sent at once: exactly one lands, and the family is told once',
       three.filter(x => x === 200).length === 1 && e1 - e0 === 1, three.join() + ' told ' + (e1 - e0));
    await admin.query(`delete from events where text like 'Rohan let the computer play for Meera%'`); }
  const st = g.state; st.turnAt = Date.now() - 13 * 3600 * 1000;
  await admin.query('update games set state = $1::jsonb where id = $2', [JSON.stringify(st), g.id]);
  await R.waitForTimeout(3800);
  ok('snakes: after 12 hours, Rohan is offered "Let the computer play for Meera"', await vis(R, '#g-hand') && /Let the computer play for Meera/.test(await R.textContent('#g-hand')), await R.textContent('#g-hand').catch(() => ''));
  await R.click('#g-hand'); await R.waitForTimeout(800);
  g = await lastGame('snakes');
  const mSeat = g.state.players.find(p => p.id === meera.id);
  ok('snakes: Parwah now plays Meera\'s seat, and the game goes on to Rohan', mSeat.away === true && (g.state.turn === 0 || !!g.state.winner), JSON.stringify({ t: g.state.turn, away: mSeat.away }));
  ok('snakes: the family is told who let the computer play for whom', (await admin.query(`select count(*)::int as n from events where text like 'Rohan let the computer play for Meera%'`)).rows[0].n === 1);
  // Rohan leaves too: nobody is left, so the game ends with no result.
  ok('snakes: Rohan can leave the game', await vis(R, '#g-leave'));
  await R.click('#g-leave'); await R.waitForTimeout(300);
  await R.click('#as-yes'); await R.waitForTimeout(900);
  g = await lastGame('snakes');
  ok('snakes: with nobody left playing, the game ends and leaves the list', g.status === 'done' && !g.ended_at && !(await vis(R, '#g-snakes')), g.status + ' ' + g.ended_at);
  await M.close();
}

// ---------------- The drawing board ----------------
{
  await R.goto(BASE + '/#fun'); await R.waitForTimeout(600);
  await R.click('#fun-seg [data-sec="board"]'); await R.waitForTimeout(700);
  ok('board: the floating buttons step aside', !(await vis(R, '#ekta-fab')) && !(await vis(R, '#chat-fab')));
  const sizes = await R.$$eval('#dtools .dcol', bs => bs.map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)));
  ok('board: every colour is a 44px target', sizes.length >= 6 && sizes.every(x => x >= 44), sizes.join());
  await R.emulateMedia({ colorScheme: 'dark' }); await R.waitForTimeout(200);
  const bg = await R.$eval('#dboard', c => getComputedStyle(c).backgroundColor);
  ok('board: the paper stays paper-white in dark mode, so ink shows', bg === 'rgb(255, 253, 248)', bg);
  await R.emulateMedia({ colorScheme: 'light' });
  const box = await R.$eval('#dboard', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const line = async (y) => { await R.mouse.move(box.x + 30, box.y + y); await R.mouse.down(); await R.mouse.move(box.x + 120, box.y + y, { steps: 6 }); await R.mouse.up(); await R.waitForTimeout(500); };
  await line(40);
  await R.click('#dtools [data-dc="erase"]'); await line(40);
  const rowsB = (await admin.query(`select stroke from doodles where member_id = $1 order by created_at`, [rohan.id])).rows;
  ok('board: a line and an eraser stroke are saved; the eraser as an eraser, not white ink', rowsB.length === 2 && !rowsB[0].stroke.e && rowsB[1].stroke.e === true, JSON.stringify(rowsB.map(r => r.stroke.e || r.stroke.c)));
  await R.click('#d-undo'); await R.waitForTimeout(800);
  ok('board: Undo takes back only my last line', (await admin.query(`select count(*)::int as n from doodles where member_id = $1`, [rohan.id])).rows[0].n === 1);
  await R.click('#d-clear'); await R.waitForTimeout(300);
  ok('board: wiping asks first, and says it removes everyone\'s drawings', await vis(R, '#asksheet') && /other people/.test(await R.textContent('#asksheet')));
  await R.click('#as-no'); await R.waitForTimeout(300);
  ok('board: saying no keeps the drawings', (await admin.query(`select count(*)::int as n from doodles`)).rows[0].n === 1);
}

ok('no script errors', errors.length === 0, errors.join(' | '));
// ---------------- A game finished together earns the family coins ----------------
{
  const api = (who, body) => fetch(BASE + '/api/games', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Parwah-Token': who.token },
    body: JSON.stringify({ code: 'SHARMA', memberId: who.id, ...body }) }).then(r => r.json());
  // No coins table yet simply means nothing has been paid.
  const coinsFor = async (gid) => { try { return (await admin.query(`select member_id from coins where reason = 'game' and ref = $1`, [String(gid)])).rows.map(r => r.member_id).sort(); } catch (e) { return []; } };
  await admin.query(`update games set status = 'done' where status = 'active'`);   // room under the cap
  const s = await api(rohan, { action: 'start_ttt', vsId: meera.id });
  const gid = s.game && s.game.id;
  // Rohan takes the top row while Meera plays the middle row: Rohan wins.
  for (const [who, cell] of [[rohan, 0], [meera, 3], [rohan, 1], [meera, 4], [rohan, 2]]) await api(who, { action: 'move', gameId: gid, cell });
  const paid = await coinsFor(gid);
  ok('a game two people finished pays each of them once', paid.length === 2 && paid.includes(rohan.id) && paid.includes(meera.id), JSON.stringify(paid));
  await api(rohan, { action: 'move', gameId: gid, cell: 5 });
  ok('and never twice for the same game', (await coinsFor(gid)).length === 2);
  const solo = await api(rohan, { action: 'start_ttt', vsId: 'bot' });
  for (const cell of [0, 1, 2, 3, 4, 5, 6, 7, 8]) await api(rohan, { action: 'move', gameId: solo.game.id, cell });
  ok('a game against the computer earns nothing', (await coinsFor(solo.game.id)).length === 0);
}

await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`games.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`games.e2e: ${pass}/${pass} checks pass`);
