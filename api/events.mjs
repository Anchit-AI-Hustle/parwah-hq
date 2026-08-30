// GET  /api/events?circle=CODE          — circle state: members + last 50 events
// POST /api/events {code, memberId, type, text} — record a check-in, SOS, pill or message
import { db, ensureSchema, circleByCode, isUuid } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { award, today } from './_coins.mjs';

const SOS_ESCALATE_MIN = 5;   // nobody answered in this long → shout louder

const TYPES = ['checkin', 'sos', 'pill', 'message'];

export default async function handler(req, res) {
  let sql;
  try {
    sql = db(); await ensureSchema(sql);
    // An SOS is not an event that scrolls away — it is an open state with
    // someone waiting at the end of it.
    await sql`create table if not exists sos (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      status text not null default 'open',
      escalated boolean not null default false,
      acked_by uuid references members(id) on delete set null,
      acked_at timestamptz,
      resolved_at timestamptz,
      created_at timestamptz not null default now()
    )`;
    await sql`create index if not exists sos_circle_open on sos (circle_id, status, created_at desc)`;
  } catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

// There is no scheduler on this platform, so escalation rides on the polling
// the family is already doing: any read of the circle checks for an SOS that
// nobody has answered and shouts once, louder. The `escalated` flag makes it
// exactly once, however many devices are polling.
async function escalateStaleSos(sql, circleId) {
  try {
    const stale = await sql`
      select s.id, s.member_id, m.name, m.phone
      from sos s join members m on m.id = s.member_id
      where s.circle_id = ${circleId} and s.status = 'open' and s.escalated = false
        and s.created_at < now() - make_interval(mins => ${SOS_ESCALATE_MIN})`;
    for (const s of stale) {
      const claimed = await sql`update sos set escalated = true
                                where id = ${s.id} and escalated = false returning id`;
      if (!claimed[0]) continue;   // another instance got there first
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circleId}, ${s.member_id}, 'care', ${'🆘 Nobody has answered ' + s.name + "'s SOS yet — please call them now"})`;
      await pushCircle(sql, circleId, {
        title: '🆘 STILL NOBODY — ' + s.name + ' needs help',
        body: 'No one has picked this up in ' + SOS_ESCALATE_MIN + ' minutes. Call ' + (s.phone || 'them') + ' now.'
      }, {});
    }
  } catch (e) { /* escalation must never break a read */ }
}

  try {
    if (req.method === 'GET') {
      const circle = await circleByCode(sql, req.query && req.query.circle);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const members = await sql`select id, name, role, phone, place, country, relation, gift_info, created_at from members where circle_id = ${circle.id} order by created_at`;
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
      // Requests waiting on the family — any member can decide.
      const joinReqs = await sql`
        select id, name, phone, relation, created_at from join_requests
        where circle_id = ${circle.id} and status = 'pending'
        order by created_at limit 20`;
      const pol = await sql`select join_policy from circles where id = ${circle.id}`;
      await escalateStaleSos(sql, circle.id);
      const sosOpen = await sql`
        select s.id, s.member_id, s.status, s.escalated, s.created_at, s.acked_at,
               m.name, m.phone, a.name as acked_name
        from sos s join members m on m.id = s.member_id
        left join members a on a.id = s.acked_by
        where s.circle_id = ${circle.id} and s.status <> 'resolved'
        order by s.created_at desc limit 3`;
      let seenAt = null;
      const member = req.query && req.query.member;
      if (isUuid(member)) {
        const sr = await sql`select ns.seen_at from notif_seen ns join members m on m.id = ns.member_id
                             where ns.member_id = ${member} and m.circle_id = ${circle.id}`;
        seenAt = sr[0] ? sr[0].seen_at : null;
      }
      return res.status(200).json({ ok: true, circleName: circle.name, code: circle.code, members, events, seenAt, calls,
        joinRequests: joinReqs, joinPolicy: (pol[0] && pol[0].join_policy) || 'approve',
        sos: sosOpen, sosEscalateMin: SOS_ESCALATE_MIN });
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
      // Somebody is on it — everyone else stops worrying, and the person who
      // pressed the button finds out that help is coming.
      if (type === 'sos_ack' || type === 'sos_resolve') {
        if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
        const am = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
        if (!am[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
        if (!isUuid(req.body.sosId)) return res.status(400).json({ ok: false, error: 'Bad SOS id' });
        const row = await sql`select s.id, s.member_id, s.status, m.name
                              from sos s join members m on m.id = s.member_id
                              where s.id = ${req.body.sosId} and s.circle_id = ${circle.id}`;
        if (!row[0]) return res.status(404).json({ ok: false, error: 'That SOS is not open' });
        if (type === 'sos_ack') {
          if (row[0].status !== 'open') return res.status(200).json({ ok: true, already: true });
          await sql`update sos set status = 'acked', acked_by = ${memberId}, acked_at = now()
                    where id = ${row[0].id} and status = 'open'`;
          await sql`insert into events (circle_id, member_id, type, text)
                    values (${circle.id}, ${memberId}, 'care', ${am[0].name + ' is on their way to ' + row[0].name + ' 🧡'})`;
          await pushCircle(sql, circle.id, { title: '🧡 ' + am[0].name + ' is on it',
            body: 'They are helping ' + row[0].name + ' — you do not need to call as well' }, { except: memberId });
          return res.status(200).json({ ok: true });
        }
        await sql`update sos set status = 'resolved', resolved_at = now() where id = ${row[0].id}`;
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${memberId}, 'care', ${am[0].name + ' marked ' + row[0].name + "'s SOS as sorted ✅"})`;
        await pushCircle(sql, circle.id, { title: '✅ ' + row[0].name + ' is alright',
          body: am[0].name + ' marked the SOS as sorted' }, { except: memberId });
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
      // Looking after each other is what earns the family its AI credit.
      if (type === 'checkin' || type === 'pill') await award(sql, circle.id, memberId, type, today());
      if (type === 'sos') {
        await sql`insert into sos (circle_id, member_id) values (${circle.id}, ${memberId})`;
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
