// The family drawing board — one shared canvas per circle, strokes synced
// by polling. Draw together on a call, grandkids doodle for Dadi, anyone
// can share the masterpiece into the family chat.
// GET  /api/board?circle=CODE&member=UUID&after=ISO → {ok, strokes[], clearedAt}
// POST /api/board {code, memberId, action:'stroke'|'clear', ...}
import { db, ensureSchema, circleByCode, isUuid , requireMember} from './_db.mjs';
import { tokenOf } from './_token.mjs';

export default async function handler(req, res) {
  let sql;
  try {
    sql = db(); await ensureSchema(sql);
    await sql`create table if not exists doodles (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid references members(id) on delete set null,
      stroke jsonb not null,
      created_at timestamptz not null default now()
    )`;
    await sql`create index if not exists doodles_circle_time on doodles (circle_id, created_at)`;
    await sql`create table if not exists board_meta (
      circle_id uuid primary key references circles(id) on delete cascade,
      cleared_at timestamptz not null default now()
    )`;
  } catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

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
      const metaR = await sql`select cleared_at from board_meta where circle_id = ${circle.id}`;
      const clearedAt = metaR[0] ? metaR[0].cleared_at : null;
      const after = q.after ? new Date(String(q.after)) : null;
      const strokes = (after && !isNaN(after))
        ? await sql`select id, stroke, created_at from doodles where circle_id = ${circle.id} and created_at > ${after.toISOString()} order by created_at asc limit 500`
        : await sql`select id, stroke, created_at from doodles where circle_id = ${circle.id} order by created_at asc limit 500`;
      return res.status(200).json({ ok: true, strokes, clearedAt });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    if (body.action === 'stroke') {
      const pts = Array.isArray(body.points) ? body.points.slice(0, 600) : null;
      if (!pts || pts.length < 2) return res.status(400).json({ ok: false, error: 'Empty stroke' });
      const clean = pts.map(p => [
        Math.max(0, Math.min(1, Number(p[0]) || 0)),
        Math.max(0, Math.min(1, Number(p[1]) || 0))
      ]);
      const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? body.color : '#241F17';
      const size = Math.max(1, Math.min(24, Number(body.size) || 4));
      const stroke = { p: clean, c: color, s: size };
      const r = await sql`insert into doodles (circle_id, member_id, stroke)
                          values (${circle.id}, ${me.id}, ${JSON.stringify(stroke)}::jsonb)
                          returning id, created_at`;
      return res.status(201).json({ ok: true, id: r[0].id, created_at: r[0].created_at });
    }

    if (body.action === 'clear') {
      await sql`delete from doodles where circle_id = ${circle.id}`;
      await sql`insert into board_meta (circle_id, cleared_at) values (${circle.id}, now())
                on conflict (circle_id) do update set cleared_at = now()`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' wiped the drawing board clean 🎨'})`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
