// Plans — family get-togethers of every kind: video calls, watch/listen
// parties, dinners, poojas, anything. Call-type plans carry their own video
// room; every plan renders in each member's local timezone client-side.
// GET  /api/plans?circle=CODE&member=UUID → { ok, plans[] } (upcoming)
// POST /api/plans {code, memberId, action:'create'|'rsvp'|'cancel', ...}
import { db, ensureSchema, circleByCode, isUuid, serverError } from './_db.mjs';
import { pushCircle } from './_push.mjs';

const KINDS = ['call', 'party', 'meet', 'other'];

async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
}

function roomUrl(code) {
  const rand = Math.random().toString(36).slice(2, 8);
  return 'https://meet.jit.si/parwah-' + String(code).toLowerCase() + '-' + rand;
}

export default async function handler(req, res) {
  let sql;
  try {
    sql = db(); await ensureSchema(sql);
    await sql`create table if not exists plans (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      by_member uuid references members(id) on delete set null,
      title text not null,
      kind text not null default 'call',
      at timestamptz not null,
      place text,
      room text,
      going uuid[] not null default '{}',
      created_at timestamptz not null default now()
    )`;
    await sql`alter table plans add column if not exists expected int`;
  } catch (e) { return serverError(res, e, 'plans'); }

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
      const plans = await sql`
        select p.id, p.title, p.kind, p.at, p.place, p.room, p.going, p.by_member, p.expected,
               b.name as by_name,
               (select string_agg(g.name, ', ') from members g where g.id = any(p.going)) as going_names
        from plans p left join members b on b.id = p.by_member
        where p.circle_id = ${circle.id} and p.at > now() - interval '3 hours'
        order by p.at asc limit 20`;
      return res.status(200).json({ ok: true, plans });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    if (body.action === 'create') {
      const title = String(body.title || '').trim().slice(0, 100);
      if (!title) return res.status(400).json({ ok: false, error: 'Give the plan a name' });
      const kind = KINDS.includes(body.kind) ? body.kind : 'other';
      const at = new Date(String(body.at || ''));
      if (isNaN(at) || at < new Date(Date.now() - 60000)) {
        return res.status(400).json({ ok: false, error: 'Pick a date and time in the future' });
      }
      const place = String(body.place || '').trim().slice(0, 120) || null;
      const room = (kind === 'call' || kind === 'party') ? roomUrl(circle.code) : null;
      let expected = parseInt(body.expected, 10);
      expected = (expected >= 2 && expected <= 50) ? expected : null;
      const p = await sql`insert into plans (circle_id, by_member, title, kind, at, place, room, going, expected)
                          values (${circle.id}, ${me.id}, ${title}, ${kind}, ${at.toISOString()}, ${place}, ${room}, ${'{' + me.id + '}'}, ${expected})
                          returning id`;
      await feed(sql, circle.id, me.id, `${me.name} planned: ${title} 🗓`);
      const whenTxt = at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
      await pushCircle(sql, circle.id, { title: '🗓 ' + me.name + ' planned: ' + title, body: whenTxt + ' — open Parwah to say you are in' }, { except: me.id });
      return res.status(201).json({ ok: true, id: p[0].id });
    }

    if (body.action === 'rsvp') {
      if (!isUuid(body.planId)) return res.status(400).json({ ok: false, error: 'Bad plan id' });
      const rows = await sql`select id, going, title, by_member from plans where id = ${body.planId} and circle_id = ${circle.id}`;
      if (!rows[0]) return res.status(404).json({ ok: false, error: 'Plan not found' });
      const going = rows[0].going || [];
      if (going.indexOf(me.id) >= 0) {
        await sql`update plans set going = array_remove(going, ${me.id}::uuid) where id = ${rows[0].id}`;
        return res.status(200).json({ ok: true, going: false });
      }
      await sql`update plans set going = array_append(going, ${me.id}::uuid) where id = ${rows[0].id}`;
      await feed(sql, circle.id, me.id, `${me.name} is in for: ${rows[0].title} 🙌`);
      if (rows[0].by_member && rows[0].by_member !== me.id) {
        await pushCircle(sql, circle.id, { title: '🙌 ' + me.name + ' is coming', body: rows[0].title }, { only: rows[0].by_member });
      }
      return res.status(200).json({ ok: true, going: true });
    }

    if (body.action === 'cancel') {
      if (!isUuid(body.planId)) return res.status(400).json({ ok: false, error: 'Bad plan id' });
      const rows = await sql`select id, by_member, title from plans where id = ${body.planId} and circle_id = ${circle.id}`;
      if (!rows[0]) return res.status(404).json({ ok: false, error: 'Plan not found' });
      // Every member is an equal admin of the circle — anyone can cancel.
      await sql`delete from plans where id = ${rows[0].id}`;
      await feed(sql, circle.id, me.id, `${me.name} cancelled: ${rows[0].title}`);
      await pushCircle(sql, circle.id, { title: '❌ Plan cancelled', body: me.name + ' cancelled: ' + rows[0].title }, { except: me.id });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return serverError(res, e, 'plans');
  }
}
