// FAMILY AND GROUP LOCATION SHARING - consent first.
//
//   GET  /api/settings?area=location&circle=CODE&member=UUID
//        -> { ok, me: {sharing, precision, updatedAt}, shares: [...] }
//   POST /api/settings?area=location {code, memberId, action, ...}
//        share     {lat, lng, accuracy, precision: 'exact'|'area'}
//        update    {lat, lng, accuracy}      only while sharing
//        precision {precision}
//        stop                                deletes the position
//
// The rules, all enforced here rather than in the app:
//   - Only the person themselves turns sharing on. Nobody can switch it on
//     for someone else, and there is no action that could.
//   - Sharing is per circle: turning it on in the family shares with the
//     family, not with any other group the person is in.
//   - Everyone in the circle sees who is sharing, including themselves.
//     Nobody outside the circle sees anything.
//   - "Area only" is rounded on the server, so an exact position is never
//     stored for someone who chose the area.
//   - Stopping deletes the position. Nothing is kept "just in case".
import { db, ensureSchema, requireMember } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { PRECISIONS, validPosition, shareable, isStale } from './_geo.mjs';

let ready = false;
export async function ensureLocationSchema(sql) {
  if (ready) return;
  await sql`create table if not exists location_shares (
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    enabled boolean not null default false,
    precision text not null default 'exact',
    lat double precision,
    lng double precision,
    accuracy integer,
    updated_at timestamptz,
    enabled_at timestamptz,
    primary key (circle_id, member_id)
  )`;
  ready = true;
}

async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'location', ${text})`;
}
const whoFor = (circle) => (circle.kind === 'group' ? 'the group' : 'the family');

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureLocationSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const g = await requireMember(sql, code, memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;
    const kind = await sql`select kind from circles where id = ${circle.id}`;
    circle.kind = kind[0] ? kind[0].kind : 'family';

    if (req.method === 'GET') {
      const rows = await sql`
        select s.member_id, s.precision, s.lat, s.lng, s.accuracy, s.updated_at, m.name, m.relation
        from location_shares s join members m on m.id = s.member_id
        where s.circle_id = ${circle.id} and s.enabled and s.lat is not null
        order by (s.member_id = ${me.id}) desc, s.updated_at desc`;
      const mine = await sql`select enabled, precision, updated_at from location_shares
                             where circle_id = ${circle.id} and member_id = ${me.id}`;
      return res.status(200).json({
        ok: true,
        me: { sharing: !!(mine[0] && mine[0].enabled), precision: mine[0] ? mine[0].precision : 'exact',
              updatedAt: mine[0] ? mine[0].updated_at : null },
        shares: rows.map(r => ({ memberId: r.member_id, name: r.name, relation: r.relation, mine: r.member_id === me.id,
                                 lat: r.lat, lng: r.lng, accuracy: r.accuracy, precision: r.precision,
                                 updatedAt: r.updated_at, stale: isStale(r.updated_at) }))
      });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    const action = body.action;
    const cur = (await sql`select * from location_shares where circle_id = ${circle.id} and member_id = ${me.id}`)[0];

    if (action === 'share' || action === 'update') {
      if (action === 'update' && !(cur && cur.enabled)) return res.status(409).json({ ok: false, error: 'Turn on sharing first' });
      const pos = validPosition(body.lat, body.lng, body.accuracy);
      if (pos.error) return res.status(400).json({ ok: false, error: pos.error });
      if (action === 'update') {
        // A position already on its way when the person taps Stop must never
        // switch sharing back on: the write only lands on a row that is still
        // shared, at the precision it was rounded for.
        const s = shareable(pos, cur.precision);
        const done = await sql`update location_shares set lat = ${s.lat}, lng = ${s.lng}, accuracy = ${s.accuracy}, updated_at = now()
                               where circle_id = ${circle.id} and member_id = ${me.id} and enabled and precision = ${cur.precision}
                               returning member_id`;
        if (!done.length) return res.status(409).json({ ok: false, error: 'Sharing changed a moment ago' });
        return res.status(200).json({ ok: true, sharing: true, precision: cur.precision });
      }
      const precision = PRECISIONS.includes(body.precision) ? body.precision : 'exact';
      const s = shareable(pos, precision);
      await sql`insert into location_shares (circle_id, member_id, enabled, precision, lat, lng, accuracy, updated_at, enabled_at)
                values (${circle.id}, ${me.id}, true, ${precision}, ${s.lat}, ${s.lng}, ${s.accuracy}, now(), now())
                on conflict (circle_id, member_id) do update set enabled = true, precision = ${precision},
                  lat = ${s.lat}, lng = ${s.lng}, accuracy = ${s.accuracy}, updated_at = now(),
                  enabled_at = coalesce(case when location_shares.enabled then location_shares.enabled_at end, now())`;
      // Starting is everyone's business: the family should know it can see you.
      if (!(cur && cur.enabled)) {
        await feed(sql, circle.id, me.id, `${me.name} is sharing ${precision === 'area' ? 'their area' : 'their location'} with ${whoFor(circle)}`);
      }
      return res.status(200).json({ ok: true, sharing: true, precision });
    }

    if (action === 'precision') {
      if (!PRECISIONS.includes(body.precision)) return res.status(400).json({ ok: false, error: 'Pick exact or area only' });
      if (!(cur && cur.enabled)) return res.status(409).json({ ok: false, error: 'Turn on sharing first' });
      // Moving to "area only" coarsens what is stored now, not just what is shown.
      let lat = cur.lat, lng = cur.lng, acc = cur.accuracy;
      if (body.precision === 'area' && lat !== null) { const s = shareable({ lat, lng, accuracy: acc }, 'area'); lat = s.lat; lng = s.lng; acc = s.accuracy; }
      // Moving to "exact" keeps the rounded point (and its 1.1 km accuracy)
      // until the phone sends a fresh fix, so nobody is shown a false "exact".
      const done = await sql`update location_shares set precision = ${body.precision}, lat = ${lat}, lng = ${lng}, accuracy = ${acc}
                             where circle_id = ${circle.id} and member_id = ${me.id} and enabled returning member_id`;
      if (!done.length) return res.status(409).json({ ok: false, error: 'Turn on sharing first' });
      return res.status(200).json({ ok: true, precision: body.precision });
    }

    if (action === 'stop') {
      await sql`update location_shares set enabled = false, lat = null, lng = null, accuracy = null, updated_at = null, enabled_at = null
                where circle_id = ${circle.id} and member_id = ${me.id}`;
      if (cur && cur.enabled) await feed(sql, circle.id, me.id, `${me.name} stopped sharing their location`);
      return res.status(200).json({ ok: true, sharing: false });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}
