// Family games — Saanp Seedhi (Snakes & Ladders), playable by the whole
// circle across any distance. Server-side dice; state in Postgres jsonb.
// GET  /api/games?circle=CODE&member=UUID → { ok, game|null }
// POST /api/games {code, memberId, action:'start'|'roll'|'end', gameId?}
import { db, ensureSchema, circleByCode, isUuid } from './_db.mjs';

const SNAKES  = { 99:41, 95:75, 92:88, 89:68, 74:53, 64:60, 62:19, 49:11, 46:25, 16:6 };
const LADDERS = { 2:38, 7:14, 8:31, 15:26, 21:42, 28:84, 36:44, 51:67, 71:91, 78:98, 87:94 };

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
      return res.status(200).json({ ok: true, game: g });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    if (body.action === 'start') {
      const existing = await activeGame(sql, circle.id);
      if (existing) return res.status(200).json({ ok: true, game: existing });
      const members = await sql`select id, name from members where circle_id = ${circle.id} order by created_at`;
      const state = {
        players: members.map(m => ({ id: m.id, name: m.name, pos: 0 })),
        turn: 0, last: null, winner: null
      };
      const g = await sql`insert into games (circle_id, kind, status, state)
                          values (${circle.id}, 'snakes', 'active', ${JSON.stringify(state)}::jsonb)
                          returning id, kind, status, state, created_at`;
      await feed(sql, circle.id, me.id, `${me.name} started Saanp Seedhi 🎲 — everyone's in, come play!`);
      return res.status(201).json({ ok: true, game: g[0] });
    }

    if (body.action === 'roll' || body.action === 'end') {
      if (!isUuid(body.gameId)) return res.status(400).json({ ok: false, error: 'Bad game id' });
      const rows = await sql`select id, status, state from games where id = ${body.gameId} and circle_id = ${circle.id}`;
      const g = rows[0];
      if (!g) return res.status(404).json({ ok: false, error: 'Game not found' });

      if (body.action === 'end') {
        await sql`update games set status = 'done' where id = ${g.id}`;
        return res.status(200).json({ ok: true });
      }

      if (g.status !== 'active') return res.status(409).json({ ok: false, error: 'The game is over' });
      const st = g.state;
      const idx = st.players.findIndex(p => p.id === me.id);
      if (idx < 0) return res.status(403).json({ ok: false, error: 'You are not in this game' });
      if (idx !== st.turn) return res.status(409).json({ ok: false, error: 'Not your turn yet' });

      const roll = 1 + Math.floor(Math.random() * 6);
      const from = st.players[idx].pos;
      let to = from + roll;
      let event = '';
      if (to > 100) { to = from; event = 'needs exactly ' + (100 - from); }
      else if (SNAKES[to]) { event = 'snake! down to ' + SNAKES[to]; to = SNAKES[to]; }
      else if (LADDERS[to]) { event = 'ladder! up to ' + LADDERS[to]; to = LADDERS[to]; }
      st.players[idx].pos = to;
      st.last = { by: me.name, roll, from, to, event };
      if (to === 100) {
        st.winner = me.name;
        await sql`update games set status = 'done', state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
        await feed(sql, circle.id, me.id, `${me.name} won Saanp Seedhi! 🎉🐍🪜`);
      } else {
        st.turn = (idx + 1) % st.players.length;
        await sql`update games set state = ${JSON.stringify(st)}::jsonb where id = ${g.id}`;
      }
      return res.status(200).json({ ok: true, game: { id: g.id, kind: 'snakes', status: to === 100 ? 'done' : 'active', state: st } });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
