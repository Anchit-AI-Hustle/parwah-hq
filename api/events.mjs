// GET  /api/events?circle=CODE          — circle state: members + last 50 events
// POST /api/events {code, memberId, type, text} — record a check-in, SOS, pill or message
import { db, ensureSchema, circleByCode, isUuid } from './_db.mjs';
import { pushCircle } from './_push.mjs';

const TYPES = ['checkin', 'sos', 'pill', 'message'];

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  try {
    if (req.method === 'GET') {
      const circle = await circleByCode(sql, req.query && req.query.circle);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const members = await sql`select id, name, role, phone, place, country, relation, created_at from members where circle_id = ${circle.id} order by created_at`;
      const events = await sql`
        select e.id, e.type, e.text, e.created_at, m.name as member_name, m.role as member_role
        from events e left join members m on m.id = e.member_id
        where e.circle_id = ${circle.id}
        order by e.created_at desc limit 50`;
      // live calls: everyone in the family sees what is on right now
      const calls = await sql`
        select c.id, c.room, c.label, c.started_at, m.name as by_name
        from calls c left join members m on m.id = c.by_member
        where c.circle_id = ${circle.id} and c.started_at > now() - interval '3 hours'
        order by c.started_at desc limit 3`;
      let seenAt = null;
      const member = req.query && req.query.member;
      if (isUuid(member)) {
        const sr = await sql`select ns.seen_at from notif_seen ns join members m on m.id = ns.member_id
                             where ns.member_id = ${member} and m.circle_id = ${circle.id}`;
        seenAt = sr[0] ? sr[0].seen_at : null;
      }
      return res.status(200).json({ ok: true, circleName: circle.name, code: circle.code, members, events, seenAt, calls });
    }

    if (req.method === 'POST') {
      const { code, memberId, type, text } = req.body || {};
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      if (type === 'seen') {
        if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
        const mm = await sql`select id from members where id = ${memberId} and circle_id = ${circle.id}`;
        if (!mm[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
        await sql`insert into notif_seen (member_id, seen_at) values (${memberId}, now())
                  on conflict (member_id) do update set seen_at = now()`;
        return res.status(200).json({ ok: true });
      }
      if (type === 'call_start' || type === 'call_end') {
        if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
        const cm = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
        if (!cm[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
        if (type === 'call_start') {
          const room = String(req.body.room || '');
          if (room.indexOf('https://meet.jit.si/') !== 0 || room.length > 300) return res.status(400).json({ ok: false, error: 'Bad room' });
          const label = String(req.body.label || '').trim().slice(0, 60) || null;
          const r = await sql`insert into calls (circle_id, room, label, by_member) values (${circle.id}, ${room}, ${label}, ${memberId}) returning id`;
          await pushCircle(sql, circle.id, { title: (label || '📞 Family call') + ' on now', body: cm[0].name + ' started it — tap to join everyone' }, { except: memberId });
          return res.status(201).json({ ok: true, callId: r[0].id });
        }
        // anyone in the circle can end it — every member is an equal admin
        if (!isUuid(req.body.callId)) return res.status(400).json({ ok: false, error: 'Bad call id' });
        await sql`delete from calls where id = ${req.body.callId} and circle_id = ${circle.id}`;
        return res.status(200).json({ ok: true });
      }
      if (!TYPES.includes(type)) return res.status(400).json({ ok: false, error: 'Unknown event type' });
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const member = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
      if (!member[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const t = String(text || '').trim().slice(0, type === 'message' ? 300 : 120);
      if (type === 'message' && !t) return res.status(400).json({ ok: false, error: 'Empty message' });
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${memberId}, ${type}, ${t || null})`;
      if (type === 'sos') {
        await pushCircle(sql, circle.id, { title: '🆘 SOS from ' + member[0].name, body: 'They pressed the SOS button — call them right now' }, { except: memberId });
      }
      return res.status(201).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'GET or POST only' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
