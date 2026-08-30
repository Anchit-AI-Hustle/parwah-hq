// GET  /api/events?circle=CODE          — circle state: members + last 50 events
// POST /api/events {code, memberId, type, text} — record a check-in, SOS, pill or message
import { db, ensureSchema, circleByCode, isUuid } from './_db.mjs';

const TYPES = ['checkin', 'sos', 'pill', 'message'];

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  try {
    if (req.method === 'GET') {
      const circle = await circleByCode(sql, req.query && req.query.circle);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const members = await sql`select id, name, role, phone, created_at from members where circle_id = ${circle.id} order by created_at`;
      const events = await sql`
        select e.id, e.type, e.text, e.created_at, m.name as member_name, m.role as member_role
        from events e left join members m on m.id = e.member_id
        where e.circle_id = ${circle.id}
        order by e.created_at desc limit 50`;
      return res.status(200).json({ ok: true, circleName: circle.name, code: circle.code, members, events });
    }

    if (req.method === 'POST') {
      const { code, memberId, type, text } = req.body || {};
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      if (!TYPES.includes(type)) return res.status(400).json({ ok: false, error: 'Unknown event type' });
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const member = await sql`select id from members where id = ${memberId} and circle_id = ${circle.id}`;
      if (!member[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const t = String(text || '').trim().slice(0, type === 'message' ? 300 : 120);
      if (type === 'message' && !t) return res.status(400).json({ ok: false, error: 'Empty message' });
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${memberId}, ${type}, ${t || null})`;
      return res.status(201).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'GET or POST only' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
