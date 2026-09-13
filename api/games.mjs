// Family games — Saanp Seedhi (Snakes & Ladders), playable by the whole
// circle across any distance. Server-side dice; state in Postgres jsonb.
// A circle can have SEVERAL games running at once, including two of the same
// kind: "Saanp Seedhi" and "Saanp Seedhi 2" are different games with their own
// players, turns and boards.
// GET  /api/games?circle=CODE&member=UUID          → { ok, games[], game|null }
// GET  /api/games?circle=CODE&member=UUID&game=ID  → { ok, game, games[] }
// POST /api/games {code, memberId, action:'start'|'roll'|'end', gameId?}
import { db, ensureSchema, circleByCode, isUuid, ensureCircleChat , requireMember} from './_db.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
// How games are named, numbered and listed. Its own dependency-free module so
// the deploy gate can unit-test it on a fresh clone, before npm install.
import { MAX_ACTIVE, gameName, numberAfter, gameSummary, isBot, teamList, currentPlayer } from './_gamelist.mjs';
export { MAX_ACTIVE, GAME_LABEL, gameName, numberAfter, gameSummary, isBot, currentPlayer } from './_gamelist.mjs';

const SNAKES  = { 99:41, 95:75, 92:88, 89:68, 74:53, 64:60, 62:19, 49:11, 46:25, 16:6 };
const LADDERS = { 2:38, 7:14, 8:31, 15:26, 21:42, 28:84, 36:44, 51:67, 71:91, 78:98, 87:94 };

// The twist: a snake costs you a truth-or-dare, a ladder earns a reward,
// and Ekta announces it in the family chat so the fun spills into talk.
const DARES = [
  'Sing two lines of your favourite old song in the family chat (voice note or text!)',
  'Share your funniest childhood photo in the family chat',
  'Say three genuinely nice things about the player just ahead of you, in chat',
  'Send your next 5 chat messages using only emojis',
  'Call the eldest member of the circle right now and say "I love you"',
  'Share a photo of the last thing you ate, with a chef-style description',
  'Tell your absolute worst joke in the family chat — no apologies',
  'Share one memory from a family trip that still makes you laugh',
  'Write a two-line shayari about this family in the chat',
  'Do 5 jumping jacks and get another member to vouch for you in chat'
];
const TRUTHS = [
  'What was your childhood nickname, and who gave it to you?',
  'What is the most mischievous thing you did as a kid that elders never found out?',
  'Who in the family do you call first when you get good news — and why?',
  'Which home-cooked dish do you miss the most, and whose hands made it best?',
  'When did you last cry happy tears?',
  'What was your first salary, and what did you do with it?',
  'What is your favourite festival memory with this family?',
  'Name one thing you secretly admire about each person in this circle'
];
const REWARDS = [
  'Everyone in the circle must send you a 🧡 in the family chat',
  'You may assign one mini-dare to any player of your choice',
  'Each family member must post one word that describes you best',
  'You earn the title "Sitara of the Day ⭐" — everyone must address you as Sitara till tomorrow',
  'On the next family call, you choose the game',
  'The next player must pay you a genuine compliment before their roll',
  'Everyone must post their favourite photo of you in the chat',
  'You get to pick the topic for tonight\'s family chat gupshup'
];
const WIN_REWARD = '🏆 Champion! Every member must post one favourite memory with the winner in the family chat 🧡';

// ---------- Party games (Antakshari + Dumb Charades): lobby, teams, admins ----------
// Modes: 'chat' (play via family chat / in person) or 'call' (a video room is
// attached — Dumb Charades acting mode). Creator is admin; admins can begin,
// kick, promote co-admins and end. Anyone in the circle can opt in any time;
// joiners auto-balance onto the smaller team. Turns alternate between teams.
export const TEAM_NAMES = ['Team Marigold 🧡', 'Team Pine 💚'];
const LETTERS = 'ABCDGHJKMNPRSTV';
const MOVIES = ['Sholay','DDLJ','3 Idiots','Lagaan','Dangal','Mother India','Anand','Golmaal','Chupke Chupke','Hera Pheri','Munna Bhai MBBS','Swades','Taare Zameen Par','Chak De India','Queen','PK','Bajrangi Bhaijaan','Zindagi Na Milegi Dobara','Dil Chahta Hai','Kabhi Khushi Kabhie Gham','Hum Aapke Hain Koun','Andaz Apna Apna','Jab We Met','Barfi','Piku','Drishyam','Gully Boy','Mughal-e-Azam'];

export function partyStart(kind, mode, creator, room, rng) {
  const R = rng || Math.random;
  return {
    kind: kind, mode: mode === 'call' ? 'call' : 'chat', room: room || null,
    status: 'lobby',
    admins: [creator.id],
    players: [{ id: creator.id, name: creator.name, team: 0, score: 0 }],
    teamScores: [0, 0],
    teamTurn: 0, ptr: [0, 0],
    letter: kind === 'antakshari' ? LETTERS[Math.floor(R() * LETTERS.length)] : null,
    prompt: null, last: null, winner: null
  };
}
function advanceTurn(st) {
  const t = st.teamTurn;
  if (teamList(st, t).length) st.ptr[t] = (st.ptr[t] + 1) % teamList(st, t).length;
  if (teamList(st, 1 - t).length) st.teamTurn = 1 - t;
}
export function partyJoin(st, m) {
  if (st.players.some(p => p.id === m.id)) return { error: 'You are already in the game' };
  const team = teamList(st, 0).length <= teamList(st, 1).length ? 0 : 1;
  st.players.push({ id: m.id, name: m.name, team, score: 0 });
  return { announce: '🙋 ' + m.name + ' joined ' + TEAM_NAMES[team] + '!' };
}
function fixAdmins(st) {
  st.admins = st.admins.filter(a => st.players.some(p => p.id === a));
  if (!st.admins.length && st.players.length) st.admins = [st.players[0].id];
}
export function partyLeave(st, memberId) {
  const p = st.players.find(x => x.id === memberId);
  if (!p) return { error: 'You are not in the game' };
  const wasCurrent = currentPlayer(st) && currentPlayer(st).id === memberId;
  st.players = st.players.filter(x => x.id !== memberId);
  st.ptr = [st.ptr[0] % Math.max(1, teamList(st, 0).length), st.ptr[1] % Math.max(1, teamList(st, 1).length)];
  if (wasCurrent) st.prompt = null; // a departing actor takes the secret with them
  fixAdmins(st);
  return { announce: '👋 ' + p.name + ' left the game' };
}
export function partyKick(st, adminId, targetId) {
  if (!st.admins.includes(adminId)) return { error: 'Only an admin can remove players' };
  if (adminId === targetId) return { error: 'Use Leave to remove yourself' };
  const t = st.players.find(x => x.id === targetId);
  if (!t) return { error: 'They are not in the game' };
  const out = partyLeave(st, targetId);
  return { announce: '🚪 ' + t.name + ' was removed by the admin' + (out.error ? '' : '') };
}
export function partyPromote(st, adminId, targetId) {
  if (!st.admins.includes(adminId)) return { error: 'Only an admin can add co-admins' };
  const t = st.players.find(x => x.id === targetId);
  if (!t) return { error: 'They must join the game first' };
  if (st.admins.includes(targetId)) return { error: t.name + ' is already an admin' };
  st.admins.push(targetId);
  return { announce: '⭐ ' + t.name + ' is now a co-admin' };
}
export function partyBegin(st, adminId) {
  if (!st.admins.includes(adminId)) return { error: 'Only an admin can start the game' };
  if (st.status !== 'lobby') return { error: 'The game is already on' };
  if (st.players.length < 2) return { error: 'Need at least 2 players — invite the family!' };
  st.status = 'playing';
  const a = teamList(st, 0).map(p => p.name).join(', ');
  const b = teamList(st, 1).map(p => p.name).join(', ');
  return { announce: '🏁 Game on! ' + TEAM_NAMES[0] + ': ' + (a || '—') + '  vs  ' + TEAM_NAMES[1] + ': ' + (b || '—') + '. ' + (st.kind === 'antakshari' ? 'First letter: "' + st.letter + '"' : 'First actor draws a movie!') };
}
function needTurn(st, memberId) {
  if (st.status !== 'playing') return { error: 'The game has not started yet' };
  const cur = currentPlayer(st);
  if (!cur) return { error: 'No players on a team yet' };
  if (cur.id !== memberId) return { error: 'Not your turn — it is ' + cur.name + "'s" };
  return { cur };
}
export function antakshariTurn(st, memberId, action, nextLetter) {
  const chk = needTurn(st, memberId);
  if (chk.error) return chk;
  const me = chk.cur;
  if (action === 'sang') {
    const L = String(nextLetter || '').trim().toUpperCase();
    if (!/^[A-Z]$/.test(L)) return { error: 'Type the single letter the song ended on' };
    me.score += 1; st.teamScores[me.team] += 1;
    st.last = { by: me.name, did: 'sang', letter: st.letter };
    st.letter = L;
    advanceTurn(st);
    const nxt = currentPlayer(st);
    return { announce: '🎶 ' + me.name + ' sang on "' + st.last.letter + '"! ' + TEAM_NAMES[me.team] + ' +1 (now ' + st.teamScores[0] + '–' + st.teamScores[1] + '). Next: ' + (nxt ? nxt.name : '—') + ' on "' + L + '"' };
  }
  if (action === 'pass') {
    st.last = { by: me.name, did: 'pass', letter: st.letter };
    advanceTurn(st);
    const nxt = currentPlayer(st);
    return { announce: '😅 ' + me.name + ' passed on "' + st.letter + '". ' + (nxt ? nxt.name : '—') + ', your stage — same letter!' };
  }
  return { error: 'Unknown move' };
}
export function charadesTurn(st, memberId, action, rng) {
  const chk = needTurn(st, memberId);
  if (chk.error) return chk;
  const me = chk.cur;
  const R = rng || Math.random;
  if (action === 'draw') {
    if (st.prompt) return { error: 'You already have a movie — act it out!' };
    st.prompt = MOVIES[Math.floor(R() * MOVIES.length) % MOVIES.length];
    return { announce: '🎭 ' + me.name + ' (' + TEAM_NAMES[me.team] + ') has drawn a movie and is about to act. Team, eyes on ' + me.name + '!' };
  }
  if (action === 'guessed' || action === 'flop') {
    if (!st.prompt) return { error: 'Draw a movie first' };
    const movie = st.prompt;
    let announce;
    if (action === 'guessed') {
      me.score += 1; st.teamScores[me.team] += 1;
      announce = '🎬 ' + TEAM_NAMES[me.team] + ' got it! The movie was "' + movie + '" (' + st.teamScores[0] + '–' + st.teamScores[1] + ').';
    } else {
      announce = '🙈 Nobody guessed "' + movie + '"! Tough luck, ' + TEAM_NAMES[me.team] + '.';
    }
    st.prompt = null;
    st.last = { by: me.name, movie, did: action };
    advanceTurn(st);
    const nxt = currentPlayer(st);
    return { announce: announce + ' Next actor: ' + (nxt ? nxt.name : '—') };
  }
  return { error: 'Unknown move' };
}
export function partyEndSummary(st) {
  const a = st.teamScores[0], b = st.teamScores[1];
  const teamLine = a === b ? 'It is a tie, ' + a + '–' + b + '!' : (a > b ? TEAM_NAMES[0] : TEAM_NAMES[1]) + ' wins ' + Math.max(a, b) + '–' + Math.min(a, b) + '!';
  const top = st.players.slice().sort((x, y) => y.score - x.score)[0];
  return '🏆 Game over! ' + teamLine + (top && top.score > 0 ? ' Star of the match: ' + top.name + ' (' + top.score + ').' : '') + ' 🧡';
}

// ---------- Tic-Tac-Toe (quick 2-player duel) ----------
const TTT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
export function tttStart(a, b) {
  // Carry the bot flag through. Copying only id and name silently dropped it,
  // which left a solo duel frozen after the first move: the app's turn came
  // round and nothing knew it was the app's.
  const seat = (p) => (p && p.bot ? { id: p.id, name: p.name, bot: true } : { id: p.id, name: p.name });
  return { kind: 'ttt', players: [seat(a), seat(b)],
           turn: 0, board: [null,null,null,null,null,null,null,null,null], winner: null, draw: false, last: null };
}
export function tttMove(st, memberId, cell) {
  const idx = st.players.findIndex(p => p.id === memberId);
  if (idx < 0) return { error: 'This duel is between ' + st.players[0].name + ' and ' + st.players[1].name };
  if (st.winner || st.draw) return { error: 'The game is over' };
  if (idx !== st.turn) return { error: 'Not your turn yet' };
  const c = Number(cell);
  if (!(c >= 0 && c <= 8) || st.board[c] !== null) return { error: 'Pick an empty square' };
  st.board[c] = idx;
  st.last = { by: st.players[idx].name, cell: c };
  const won = TTT_LINES.some(L => L.every(i => st.board[i] === idx));
  if (won) {
    st.winner = st.players[idx].name;
    return { announce: '⭕ ' + st.winner + ' beat ' + st.players[1 - idx].name + ' at Tic-Tac-Toe! Rematch, anyone?' };
  }
  if (st.board.every(v => v !== null)) {
    st.draw = true;
    return { announce: '🤝 Tic-Tac-Toe ends in a draw between ' + st.players[0].name + ' and ' + st.players[1].name + '!' };
  }
  st.turn = 1 - idx;
  return {};
}

// SINGLE PLAYER.
// Some evenings there is nobody free, and a game you cannot start alone is a
// game nobody opens twice. The opponent is a player like any other, marked
// `bot`, so every rule — turns, snakes, winning — stays exactly the same.
export const BOT = { id: 'bot', name: 'Parwah', bot: true };
export function soloPlayers(me) { return [{ id: me.id, name: me.name }, { ...BOT }]; }

// A competent, beatable opponent: win if it can, block if it must, then take
// the centre, a corner, a side. Not unbeatable — losing every game is not fun.
export function tttBotCell(st, botIdx) {
  const b = st.board, opp = 1 - botIdx;
  const wins = (who) => {
    for (const L of TTT_LINES) {
      const vals = L.map(i => b[i]);
      if (vals.filter(v => v === who).length === 2 && vals.some(v => v === null)) {
        return L[vals.indexOf(null)];
      }
    }
    return -1;
  };
  const win = wins(botIdx); if (win >= 0) return win;
  const block = wins(opp);  if (block >= 0) return block;
  for (const c of [4, 0, 2, 6, 8, 1, 3, 5, 7]) if (b[c] === null) return c;
  return -1;
}

// Play out every bot turn until it is a human's turn again, or the game ends.
// Returns the lines to announce, in order.
export function runBots(st, rng) {
  const out = [];
  for (let guard = 0; guard < 12; guard++) {
    const p = st.players[st.turn];
    if (!p || !isBot(p) || st.winner || st.draw) break;
    if (st.kind === 'ttt') {
      const cell = tttBotCell(st, st.turn);
      if (cell < 0) break;
      const r = tttMove(st, p.id, cell);
      if (r.error) break;
      if (r.announce) out.push(r.announce);
    } else {
      const r = playTurn(st, p.id, rng);
      if (r.error) break;
      if (r.announce) out.push(r.announce);
    }
  }
  return out;
}

// Never leak the secret movie to anyone but the actor.
export function publicState(game, memberId) {
  if (!game || !game.state || game.state.kind !== 'charades' || !game.state.prompt) return game;
  const actor = currentPlayer(game.state);
  if (actor && actor.id === memberId) return game;
  const st = JSON.parse(JSON.stringify(game.state));
  st.prompt = '(hidden — only the actor sees it)';
  return { ...game, state: st };
}

// Pure turn engine — deterministic under an injected rng, so it is testable.
export function playTurn(st, memberId, rng) {
  const idx = st.players.findIndex(p => p.id === memberId);
  if (idx < 0) return { error: 'You are not in this game' };
  if (st.winner) return { error: 'The game is over' };
  if (idx !== st.turn) return { error: 'Not your turn yet' };
  const R = rng || Math.random;
  const pick = arr => arr[Math.floor(R() * arr.length) % arr.length];
  const roll = 1 + Math.floor(R() * 6);
  const me = st.players[idx];
  const from = me.pos;
  let to = from + roll;
  let event = '', challenge = null, reward = null, announce = null;
  if (to > 100) { to = from; event = 'needs exactly ' + (100 - from); }
  else if (SNAKES[to]) {
    event = 'snake! down to ' + SNAKES[to]; to = SNAKES[to];
    const truth = R() < 0.4;
    challenge = { type: truth ? 'truth' : 'dare', text: pick(truth ? TRUTHS : DARES) };
    announce = '🐍 Saanp! ' + me.name + ' slid down to ' + to + '. ' +
      (truth ? '🎤 Truth for ' : '🎭 Dare for ') + me.name + ': ' + challenge.text;
  }
  else if (LADDERS[to]) {
    event = 'ladder! up to ' + LADDERS[to]; to = LADDERS[to];
    reward = pick(REWARDS);
    announce = '🪜 Ladder! ' + me.name + ' climbed to ' + to + '. 🎁 Reward: ' + reward;
  }
  me.pos = to;
  st.last = { by: me.name, roll, from, to, event, challenge, reward };
  if (to === 100) {
    st.winner = me.name;
    st.last.reward = WIN_REWARD;
    announce = '🎉 ' + me.name + ' WON Saanp Seedhi! ' + WIN_REWARD;
  } else {
    st.turn = (idx + 1) % st.players.length;
  }
  return { roll, to, announce, won: to === 100 };
}

function gameRoomUrl(code) {
  return 'https://meet.jit.si/parwah-' + String(code).toLowerCase() + '-' + Math.random().toString(36).slice(2, 8);
}

// A game between two people is not the family's business. Notify the players
// in THIS game and nobody else — and never the bot, or a solo player, who is
// looking at the screen already.
async function pushPlayers(sql, circleId, st, payload, exceptId) {
  const ids = (st.players || [])
    .filter(p => p && !isBot(p) && p.id !== exceptId && isUuid(p.id))
    .map(p => p.id);
  for (const id of ids) {
    await pushCircle(sql, circleId, payload, { only: id });
  }
}

async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
}

// Several games at once. The cap is a guard rail, not a feature: it stops a
// stuck client filling the family's list with abandoned lobbies.
async function activeGames(sql, circleId) {
  return await sql`select id, kind, status, state, created_at from games
                   where circle_id = ${circleId} and status = 'active'
                   order by created_at desc limit ${MAX_ACTIVE * 3}`;
}
async function atCap(sql, circleId) {
  const rows = await sql`select count(*)::int as n from games
                         where circle_id = ${circleId} and status = 'active'`;
  return (rows[0] ? rows[0].n : 0) >= MAX_ACTIVE;
}
const CAP_MSG = 'There are already ' + MAX_ACTIVE + ' games on the go. Finish one before starting another.';
async function nextNumber(sql, circleId, kind) {
  const rows = await sql`select state from games
                         where circle_id = ${circleId} and kind = ${kind} and status = 'active'`;
  return numberAfter(rows.map(r => r.state));
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  try {
    const q = req.query || {};
    const body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, code, memberId, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const meRow = [_g.me];
    const me = meRow[0];

    if (req.method === 'GET') {
      const rows = await activeGames(sql, circle.id);
      const live = [];
      for (const g of rows) {
        // A party game saved before the lobby/teams engine existed has an old
        // state shape the app can no longer play — retire it so the family
        // starts a fresh lobby instead of hitting a broken game.
        if ((g.state.kind === 'antakshari' || g.state.kind === 'charades') && !Array.isArray(g.state.admins)) {
          await sql`update games set status = 'done' where id = ${g.id}`;
          continue;
        }
        live.push(g);
      }
      // Ordered by what each game is asking of you, not by when it started:
      // waiting on your move, then games you are in, then everyone else's.
      const rank = (g) => { const s = gameSummary(g, me.id); return s.myTurn ? 0 : s.mine ? 1 : 2; };
      live.sort((a, b) => rank(a) - rank(b) || (a.created_at < b.created_at ? 1 : -1));
      const games = live.map(g => gameSummary(g, me.id));
      const full = (g) => publicState(g ? { ...g, kind: g.state.kind || g.kind } : null, me.id);
      if (isUuid(q.game)) {
        const one = live.filter(x => x.id === q.game)[0];
        if (!one) return res.status(404).json({ ok: false, error: 'That game is over or was ended' });
        return res.status(200).json({ ok: true, game: full(one), games });
      }
      // `game` is what an older client would have opened: kept so it still
      // finds a game where it has always looked.
      return res.status(200).json({ ok: true, games, game: full(live[0] || null) });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    async function announce(text) {
      if (!text) return;
      try {
        const chatId = await ensureCircleChat(sql, circle.id);
        await sql`insert into messages (chat_id, member_id, text) values (${chatId}, null, ${text})`;
      } catch (e) { /* the move stands even if the announcement fails */ }
    }

    if (body.action === 'start_ttt') {
      if (await atCap(sql, circle.id)) return res.status(409).json({ ok: false, error: CAP_MSG });
      const solo = body.vsId === 'bot' || body.solo === true;
      let state, vsName = null;
      if (solo) {
        state = tttStart(me, BOT);
      } else {
        if (!isUuid(body.vsId) || body.vsId === me.id) return res.status(400).json({ ok: false, error: 'Pick who to challenge' });
        const vs = await sql`select id, name from members where id = ${body.vsId} and circle_id = ${circle.id}`;
        if (!vs[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
        state = tttStart(me, vs[0]); vsName = vs[0].name;
      }
      state.n = await nextNumber(sql, circle.id, 'ttt'); state.by = me.name; state.byId = me.id;
      const nm = gameName('ttt', state.n);
      const g = await sql`insert into games (circle_id, kind, status, state)
                          values (${circle.id}, 'ttt', 'active', ${JSON.stringify(state)}::jsonb)
                          returning id, kind, status, state, created_at`;
      // Playing alone is nobody else's business: no feed line, no notification.
      if (!solo) {
        await feed(sql, circle.id, me.id, `${me.name} challenged ${vsName} to ${nm}`);
        await pushPlayers(sql, circle.id, state, { title: '⭕✕ ' + me.name + ' challenged you', body: nm + ' - your move' }, me.id);
      }
      return res.status(201).json({ ok: true, game: g[0] });
    }
    if (body.action === 'move') {
      if (!isUuid(body.gameId)) return res.status(400).json({ ok: false, error: 'Bad game id' });
      const rows = await sql`select id, kind, status, state from games where id = ${body.gameId} and circle_id = ${circle.id}`;
      const g = rows[0];
      if (!g || g.status !== 'active') return res.status(404).json({ ok: false, error: 'Game not found or over' });
      const st = g.state;
      const out = tttMove(st, me.id, body.cell);
      if (out.error) return res.status(409).json({ ok: false, error: out.error });
      // The opponent answers in the same request, so a solo game never waits.
      const botLines = runBots(st);
      const done = !!(st.winner || st.draw);
      const solo = (st.players || []).some(isBot);
      await sql`update games set status = ${done ? 'done' : 'active'}, state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
      const lines = [out.announce].concat(botLines).filter(Boolean);
      // A game played alone is not announced to the family.
      if (lines.length && !solo) {
        try {
          const chatId = await ensureCircleChat(sql, circle.id);
          for (const t of lines) {
            await sql`insert into messages (chat_id, member_id, text) values (${chatId}, null, ${t})`;
          }
        } catch (e) {}
      }
      // Only the person whose turn it now is hears about it.
      if (!done && !solo) {
        const nxt = st.players[st.turn];
        if (nxt && !isBot(nxt)) {
          await pushCircle(sql, circle.id, { title: '⭕✕ Your turn', body: me.name + ' has moved' }, { only: nxt.id });
        }
      }
      return res.status(200).json({ ok: true, game: { id: g.id, kind: 'ttt', status: done ? 'done' : 'active', state: st } });
    }
    if (body.action === 'start_antakshari' || body.action === 'start_charades') {
      if (await atCap(sql, circle.id)) return res.status(409).json({ ok: false, error: CAP_MSG });
      const kind = body.action === 'start_antakshari' ? 'antakshari' : 'charades';
      const mode = body.mode === 'call' ? 'call' : 'chat';
      const room = mode === 'call' ? gameRoomUrl(circle.code) : null;
      const state = partyStart(kind, mode, me, room);
      state.n = await nextNumber(sql, circle.id, kind); state.by = me.name; state.byId = me.id;
      const g = await sql`insert into games (circle_id, kind, status, state)
                          values (${circle.id}, ${kind}, 'active', ${JSON.stringify(state)}::jsonb)
                          returning id, kind, status, state, created_at`;
      // Named, not just typed: with two lobbies open, "join the game" is not
      // an instruction anybody can follow.
      const label = gameName(kind, state.n);
      await announce('🎪 ' + me.name + ' opened a game of ' + label + (mode === 'call' ? ' on a video call, join the room: ' + room : ' in chat mode') + '. Everyone can join: open Together, Games, pick ' + label + ' and tap "I\'m in!" 🙋');
      await feed(sql, circle.id, me.id, `${me.name} opened ${label} — lobby is open, come join!`);
      // an open lobby is an invitation to the whole circle
      await pushCircle(sql, circle.id, { title: '🎪 ' + me.name + ' opened ' + label, body: 'Lobby is open — tap to join the game' }, { except: me.id });
      return res.status(201).json({ ok: true, game: publicState(g[0], me.id) });
    }

    if (body.action === 'start') {
      if (await atCap(sql, circle.id)) return res.status(409).json({ ok: false, error: CAP_MSG });
      const solo = body.solo === true;
      let players;
      if (solo) {
        players = soloPlayers(me).map(p => ({ ...p, pos: 0 }));
      } else {
        const members = await sql`select id, name from members where circle_id = ${circle.id} order by created_at`;
        players = members.map(m => ({ id: m.id, name: m.name, pos: 0 }));
      }
      const n = await nextNumber(sql, circle.id, 'snakes');
      const state = { kind: 'snakes', n, by: me.name, byId: me.id, players, turn: 0, last: null, winner: null, solo: solo || undefined };
      const g = await sql`insert into games (circle_id, kind, status, state)
                          values (${circle.id}, 'snakes', 'active', ${JSON.stringify(state)}::jsonb)
                          returning id, kind, status, state, created_at`;
      // A game you started alone is not announced to the family.
      if (!solo) await feed(sql, circle.id, me.id, `${me.name} started ${gameName('snakes', n)} 🎲 - everyone's in, come play!`);
      return res.status(201).json({ ok: true, game: g[0] });
    }

    const PARTY_ACTS = ['join_game', 'leave_game', 'kick', 'promote', 'begin', 'sang', 'pass', 'draw', 'guessed', 'flop'];
    if (PARTY_ACTS.includes(body.action)) {
      if (!isUuid(body.gameId)) return res.status(400).json({ ok: false, error: 'Bad game id' });
      const rows = await sql`select id, kind, status, state from games where id = ${body.gameId} and circle_id = ${circle.id}`;
      const g = rows[0];
      if (!g || g.status !== 'active') return res.status(404).json({ ok: false, error: 'Game not found or over' });
      const st = g.state;
      if (st.kind !== 'antakshari' && st.kind !== 'charades') return res.status(400).json({ ok: false, error: 'Not that kind of game' });
      let out;
      if (body.action === 'join_game') out = partyJoin(st, me);
      else if (body.action === 'leave_game') out = partyLeave(st, me.id);
      else if (body.action === 'kick') out = isUuid(body.targetId) ? partyKick(st, me.id, body.targetId) : { error: 'Pick who to remove' };
      else if (body.action === 'promote') out = isUuid(body.targetId) ? partyPromote(st, me.id, body.targetId) : { error: 'Pick who to promote' };
      else if (body.action === 'begin') out = partyBegin(st, me.id);
      else if (body.action === 'sang' || body.action === 'pass') out = antakshariTurn(st, me.id, body.action, body.letter);
      else out = charadesTurn(st, me.id, body.action);
      if (out.error) return res.status(409).json({ ok: false, error: out.error });
      const empty = st.players.length === 0;
      await sql`update games set status = ${empty ? 'done' : 'active'}, state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
      await announce(out.announce);
      return res.status(200).json({ ok: true, game: publicState({ id: g.id, kind: g.kind, status: empty ? 'done' : 'active', state: st }, me.id) });
    }

    if (body.action === 'roll' || body.action === 'end') {
      if (!isUuid(body.gameId)) return res.status(400).json({ ok: false, error: 'Bad game id' });
      const rows = await sql`select id, status, state from games where id = ${body.gameId} and circle_id = ${circle.id}`;
      const g = rows[0];
      if (!g) return res.status(404).json({ ok: false, error: 'Game not found' });

      if (body.action === 'end') {
        const st = g.state || {};
        if ((st.kind === 'antakshari' || st.kind === 'charades') && !(st.admins || []).includes(me.id)) {
          return res.status(403).json({ ok: false, error: 'Only an admin can end the game' });
        }
        // With several games listed side by side, ending one you are not
        // playing is a mis-tap on the wrong card, not a decision.
        if (st.kind !== 'antakshari' && st.kind !== 'charades') {
          const inIt = (st.players || []).some(p => p && p.id === me.id) || st.byId === me.id;
          if (!inIt) return res.status(403).json({ ok: false, error: 'Only someone playing this game can end it' });
        }
        await sql`update games set status = 'done' where id = ${g.id}`;
        try {
          if (st.kind === 'antakshari' || st.kind === 'charades') {
            const chatId = await ensureCircleChat(sql, circle.id);
            await sql`insert into messages (chat_id, member_id, text) values (${chatId}, null, ${partyEndSummary(st)})`;
          }
        } catch (e) {}
        return res.status(200).json({ ok: true });
      }

      if (g.status !== 'active') return res.status(409).json({ ok: false, error: 'The game is over' });
      const st = g.state;
      const out = playTurn(st, me.id);
      if (out.error) return res.status(409).json({ ok: false, error: out.error });
      const botLines = runBots(st);
      const solo = (st.players || []).some(isBot);
      const over = !!st.winner;
      if (over) {
        await sql`update games set status = 'done', state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
        if (!solo) await feed(sql, circle.id, me.id, `${st.winner} won Saanp Seedhi! 🎉🐍🪜`);
      } else {
        await sql`update games set state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
      }
      const lines = [out.announce].concat(botLines).filter(Boolean);
      if (lines.length && !solo) {
        try {
          const chatId = await ensureCircleChat(sql, circle.id);
          for (const t of lines) {
            await sql`insert into messages (chat_id, member_id, text) values (${chatId}, null, ${t})`;
          }
        } catch (e) { /* the roll stands even if the announcement fails */ }
      }
      // Whose turn it is now is that person's business, not the family's.
      if (!over && !solo) {
        const nxt = st.players[st.turn];
        if (nxt && !isBot(nxt) && nxt.id !== me.id) {
          await pushCircle(sql, circle.id, { title: '🎲 Your roll', body: 'Saanp Seedhi — ' + me.name + ' has played' }, { only: nxt.id });
        }
      }
      return res.status(200).json({ ok: true, game: { id: g.id, kind: 'snakes', status: over ? 'done' : 'active', state: st } });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
