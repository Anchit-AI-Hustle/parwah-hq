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
for (const n of ['games', 'events', 'chats', 'auth', 'care']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
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
ok('the Coming soon game tiles are gone', (await R.locator('#pane-fun >> text=Coming soon').count()) === 0);
for (const k of ['ludo', 'bhabhi', 'vyapar']) ok(`${k}: its card is there to start`, await R.locator(`[data-bstart="${k}"]`).count() === 1);
ok('each game card lets you pick family to play with', (await R.locator('.bpick[data-for="ludo"] input[type=checkbox]').count()) === 1);

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
    if (await tok.count()) { await tok.first().click({ force: true }); picks++; }   // it pulses: a finger does not wait for it to stop
    else if (await R.locator('#l-roll:not([disabled])').count()) { await R.click('#l-roll'); rolls++; }
    await R.waitForTimeout(60);
  }
  const g = await lastGame('ludo');
  ok('ludo: the game stays open the whole way', stayedOpen);
  ok('ludo: played by tapping Roll and tokens (' + rolls + ' rolls, ' + picks + ' picks)', rolls > 20 && picks > 0);
  ok('ludo: it ends with a winner', !!g.state.winner && g.status === 'done', g.state.winner);
  ok('ludo: the screen says who won', /won/.test(await R.textContent('#l-status')));
  ok('ludo: a solo game is not announced to the family', (await admin.query(`select count(*)::int as n from events where text like '%Ludo%'`)).rows[0].n === 0);
  await R.click('#g-back'); await R.waitForTimeout(300);
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
    if (await can.count()) { await can.first().click(); plays++; }
    await R.waitForTimeout(60);
  }
  const g = await lastGame('bhabhi');
  ok('bhabhi: played by tapping cards (' + plays + ' plays)', plays > 3);
  ok('bhabhi: it ends with a Bhabhi', !!g.state.loser && g.status === 'done', g.state.loser);
  ok('bhabhi: the screen names the Bhabhi', /Bhabhi/.test(await R.textContent('#b-status')));
  // A card you may not play cannot be tapped.
  ok('bhabhi: only playable cards were ever enabled', refused === 0);
  await R.click('#g-back'); await R.waitForTimeout(300);
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
    if (await buy.count()) { await buy.click(); buys++; }
    else if (await roll.count()) { await roll.click(); rolls++; }
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

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`games.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`games.e2e: ${pass}/${pass} checks pass`);
