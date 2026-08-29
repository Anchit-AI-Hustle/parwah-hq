// Family games — Saanp Seedhi (Snakes & Ladders), playable by the whole
// circle across any distance. Server-side dice; state in Postgres jsonb.
// GET  /api/games?circle=CODE&member=UUID → { ok, game|null }
// POST /api/games {code, memberId, action:'start'|'roll'|'end', gameId?}
import { db, ensureSchema, circleByCode, isUuid, ensureCircleChat } from './_db.mjs';

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

// ---------- Antakshari (call-companion: app is referee + scorekeeper) ----------
const LETTERS = 'ABCDGHJKMNPRSTV';
export function antakshariStart(members) {
  return {
    kind: 'antakshari',
    players: members.map(m => ({ id: m.id, name: m.name, score: 0 })),
    turn: 0,
    letter: LETTERS[Math.floor(Math.random() * LETTERS.length)],
    last: null, winner: null
  };
}
export function antakshariTurn(st, memberId, action, nextLetter) {
  const idx = st.players.findIndex(p => p.id === memberId);
  if (idx < 0) return { error: 'You are not in this game' };
  if (idx !== st.turn) return { error: 'Not your turn yet' };
  const me = st.players[idx];
  if (action === 'sang') {
    const L = String(nextLetter || '').trim().toUpperCase();
    if (!/^[A-Z]$/.test(L)) return { error: 'Type the single letter the song ended on' };
    me.score += 1;
    st.last = { by: me.name, did: 'sang', letter: st.letter };
    st.letter = L;
    st.turn = (idx + 1) % st.players.length;
    return { announce: '🎶 ' + me.name + ' sang on "' + st.last.letter + '"! Score +1. Next up: ' + st.players[st.turn].name + ' — letter "' + L + '"' };
  }
  if (action === 'pass') {
    st.last = { by: me.name, did: 'pass', letter: st.letter };
    st.turn = (idx + 1) % st.players.length;
    return { announce: '😅 ' + me.name + ' passed on "' + st.last.letter + '". ' + st.players[st.turn].name + ', your stage — same letter!' };
  }
  return { error: 'Unknown move' };
}

// ---------- Dumb Charades (app deals a secret movie to the actor) ----------
const MOVIES = ['Sholay','DDLJ','3 Idiots','Lagaan','Dangal','Mother India','Anand','Golmaal','Chupke Chupke','Hera Pheri','Munna Bhai MBBS','Swades','Taare Zameen Par','Chak De India','Queen','PK','Bajrangi Bhaijaan','Zindagi Na Milegi Dobara','Dil Chahta Hai','Kabhi Khushi Kabhie Gham','Hum Aapke Hain Koun','Andaz Apna Apna','Jab We Met','Barfi','Piku','Drishyam','Gully Boy','Mughal-e-Azam'];
export function charadesStart(members) {
  return {
    kind: 'charades',
    players: members.map(m => ({ id: m.id, name: m.name, score: 0 })),
    turn: 0, prompt: null, last: null, winner: null
  };
}
export function charadesTurn(st, memberId, action, rng) {
  const idx = st.players.findIndex(p => p.id === memberId);
  if (idx < 0) return { error: 'You are not in this game' };
  const me = st.players[idx];
  const R = rng || Math.random;
  if (action === 'draw') {
    if (idx !== st.turn) return { error: 'Only the actor can draw' };
    if (st.prompt) return { error: 'You already have a movie — act it out!' };
    st.prompt = MOVIES[Math.floor(R() * MOVIES.length) % MOVIES.length];
    return { announce: '🎭 ' + me.name + ' has drawn a movie and is about to act. No talking, ' + me.name + '!' };
  }
  if (action === 'guessed' || action === 'flop') {
    if (idx !== st.turn) return { error: 'Only the actor can close the round' };
    if (!st.prompt) return { error: 'Draw a movie first' };
    const movie = st.prompt;
    let announce;
    if (action === 'guessed') {
      me.score += 1;
      announce = '🎬 Got it! The movie was "' + movie + '" — ' + me.name + ' +1.';
    } else {
      announce = '🙈 Nobody guessed "' + movie + '"! Better luck, ' + me.name + '.';
    }
    st.prompt = null;
    st.last = { by: me.name, movie: movie, did: action };
    st.turn = (idx + 1) % st.players.length;
    return { announce: announce + ' Next actor: ' + st.players[st.turn].name };
  }
  return { error: 'Unknown move' };
}

// ---------- Tic-Tac-Toe (quick 2-player duel) ----------
const TTT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
export function tttStart(a, b) {
  return { kind: 'ttt', players: [{ id: a.id, name: a.name }, { id: b.id, name: b.name }],
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

// Never leak the secret movie to anyone but the actor.
export function publicState(game, memberId) {
  if (!game || game.kind !== 'charades' || !game.state || !game.state.prompt) return game;
  const actor = game.state.players[game.state.turn];
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

async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
}

async function activeGame(sql, circleId) {
  const rows = await sql`select id, kind, status, state, created_at from games
                         where circle_id = ${circleId} and status = 'active'
                         order by created_at desc limit 1`;
  return rows[0] || null;
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
    const circle = await circleByCode(sql, code);
    if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
    if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const meRow = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
    if (!meRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const me = meRow[0];

    if (req.method === 'GET') {
      const g = await activeGame(sql, circle.id);
      return res.status(200).json({ ok: true, game: publicState(g ? { ...g, kind: g.state.kind || g.kind } : null, me.id) });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    const STARTS = {
      start:            { kind: 'snakes',     label: 'Saanp Seedhi 🎲' },
      start_antakshari: { kind: 'antakshari', label: 'Antakshari 🎤' },
      start_charades:   { kind: 'charades',   label: 'Dumb Charades 🎭' }
    };
    if (body.action === 'start_ttt') {
      const existing = await activeGame(sql, circle.id);
      if (existing) return res.status(200).json({ ok: true, game: publicState({ ...existing, kind: existing.state.kind || existing.kind }, me.id) });
      if (!isUuid(body.vsId) || body.vsId === me.id) return res.status(400).json({ ok: false, error: 'Pick who to challenge' });
      const vs = await sql`select id, name from members where id = ${body.vsId} and circle_id = ${circle.id}`;
      if (!vs[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
      const state = tttStart(me, vs[0]);
      const g = await sql`insert into games (circle_id, kind, status, state)
                          values (${circle.id}, 'ttt', 'active', ${JSON.stringify(state)}::jsonb)
                          returning id, kind, status, state, created_at`;
      await feed(sql, circle.id, me.id, `${me.name} challenged ${vs[0].name} to Tic-Tac-Toe ⭕✕`);
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
      const done = !!(st.winner || st.draw);
      await sql`update games set status = ${done ? 'done' : 'active'}, state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
      if (out.announce) {
        try {
          const chatId = await ensureCircleChat(sql, circle.id);
          await sql`insert into messages (chat_id, member_id, text) values (${chatId}, null, ${out.announce})`;
        } catch (e) {}
      }
      return res.status(200).json({ ok: true, game: { id: g.id, kind: 'ttt', status: done ? 'done' : 'active', state: st } });
    }
    if (STARTS[body.action]) {
      const existing = await activeGame(sql, circle.id);
      if (existing) return res.status(200).json({ ok: true, game: publicState({ ...existing, kind: existing.state.kind || existing.kind }, me.id) });
      const members = await sql`select id, name from members where circle_id = ${circle.id} order by created_at`;
      const kind = STARTS[body.action].kind;
      const state = kind === 'antakshari' ? antakshariStart(members)
        : kind === 'charades' ? charadesStart(members)
        : { kind: 'snakes', players: members.map(m => ({ id: m.id, name: m.name, pos: 0 })), turn: 0, last: null, winner: null };
      const g = await sql`insert into games (circle_id, kind, status, state)
                          values (${circle.id}, ${kind}, 'active', ${JSON.stringify(state)}::jsonb)
                          returning id, kind, status, state, created_at`;
      await feed(sql, circle.id, me.id, `${me.name} started ${STARTS[body.action].label} — everyone's in, come play!`);
      return res.status(201).json({ ok: true, game: publicState(g[0], me.id) });
    }

    if (body.action === 'sang' || body.action === 'pass' || body.action === 'draw' || body.action === 'guessed' || body.action === 'flop') {
      if (!isUuid(body.gameId)) return res.status(400).json({ ok: false, error: 'Bad game id' });
      const rows = await sql`select id, kind, status, state from games where id = ${body.gameId} and circle_id = ${circle.id}`;
      const g = rows[0];
      if (!g || g.status !== 'active') return res.status(404).json({ ok: false, error: 'Game not found or over' });
      const st = g.state;
      const out = (body.action === 'sang' || body.action === 'pass')
        ? antakshariTurn(st, me.id, body.action, body.letter)
        : charadesTurn(st, me.id, body.action);
      if (out.error) return res.status(409).json({ ok: false, error: out.error });
      await sql`update games set state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
      if (out.announce) {
        try {
          const chatId = await ensureCircleChat(sql, circle.id);
          await sql`insert into messages (chat_id, member_id, text) values (${chatId}, null, ${out.announce})`;
        } catch (e) { /* the move stands even if the announcement fails */ }
      }
      return res.status(200).json({ ok: true, game: publicState({ id: g.id, kind: g.kind, status: 'active', state: st }, me.id) });
    }

    if (body.action === 'roll' || body.action === 'end') {
      if (!isUuid(body.gameId)) return res.status(400).json({ ok: false, error: 'Bad game id' });
      const rows = await sql`select id, status, state from games where id = ${body.gameId} and circle_id = ${circle.id}`;
      const g = rows[0];
      if (!g) return res.status(404).json({ ok: false, error: 'Game not found' });

      if (body.action === 'end') {
        await sql`update games set status = 'done' where id = ${g.id}`;
        try {
          const st = g.state;
          if (st && st.players && st.players[0] && typeof st.players[0].score === 'number') {
            const top = st.players.slice().sort((a, b) => b.score - a.score)[0];
            if (top && top.score > 0) {
              const chatId = await ensureCircleChat(sql, circle.id);
              await sql`insert into messages (chat_id, member_id, text) values (${chatId}, null, ${'🏆 Game over! Top scorer: ' + top.name + ' with ' + top.score + ' — treat the family to something sweet 🧡'})`;
            }
          }
        } catch (e) {}
        return res.status(200).json({ ok: true });
      }

      if (g.status !== 'active') return res.status(409).json({ ok: false, error: 'The game is over' });
      const st = g.state;
      const out = playTurn(st, me.id);
      if (out.error) return res.status(409).json({ ok: false, error: out.error });
      if (out.won) {
        await sql`update games set status = 'done', state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
        await feed(sql, circle.id, me.id, `${me.name} won Saanp Seedhi! 🎉🐍🪜`);
      } else {
        await sql`update games set state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
      }
      if (out.announce) {
        try {
          const chatId = await ensureCircleChat(sql, circle.id);
          await sql`insert into messages (chat_id, member_id, text) values (${chatId}, null, ${out.announce})`;
        } catch (e) { /* the roll stands even if the announcement fails */ }
      }
      return res.status(200).json({ ok: true, game: { id: g.id, kind: 'snakes', status: out.won ? 'done' : 'active', state: st } });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
