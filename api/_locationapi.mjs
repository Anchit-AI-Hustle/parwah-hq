// FAMILY AND GROUP LOCATION SHARING - consent first.
//
//   GET  /api/settings?area=location&circle=CODE&member=UUID
//        -> { ok, me: {sharing, precision, updatedAt, until}, shares: [...] }
//   POST /api/settings?area=location {code, memberId, action, ...}
//        share     {lat, lng, accuracy, precision: 'exact'|'area', until?: ISO}
//                  until: when sharing ends by itself (5 minutes to 7 days
//                  on); left out, it lasts until the person stops
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
//
// The person whose location it is stays in charge of it (2026-11):
//   - ARRIVALS ARE ANNOUNCED ONLY WITH THAT PERSON'S YES. A saved place tells
//     the family "Asha arrived at Home" only for someone who turned on
//     "Announce my arrivals" on their own phone. It is off until they say
//     yes; saving a place asks each person once (announce_set answers).
//   - "ASK TO SHARE" HAS A "NOT NOW". The person asked sees who asked and
//     can answer Not now (ask_answer), which stops that asker asking again
//     for ASK_MUTE_DAYS days.
//   - WHO LOOKED. Positions of other people leave this server only on a
//     read with look=1, and every such read is written down
//     (location_looks). The person sees "Seen by Rohan, 10 min ago" on
//     their own screen.
//   - LAST SEEN. Each share says whether it is live (newer than
//     LIVE_MINUTES); an older one is shown as "Last seen", never as now.
import { db, ensureSchema, requireMember, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { PRECISIONS, validPosition, shareable, isStale, shareUntil, placeError, placesAt, placeMoves, batteryOf } from './_geo.mjs';
import { rateLimit } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { findAction, isLost, LOST_LOCK_MSG } from './_findme.mjs';
import { isLive, muteUntil, ASK_MUTE_DAYS, LOOK_EVERY_MIN, firstName } from './_consentrules.mjs';

let ready = false;
// The first loads arrive together; see schemaOnce for why that can fail.
export async function ensureLocationSchema(sql) {
  if (ready) return;
  await schemaOnce(() => locationTables(sql));
  ready = true;
}
async function locationTables(sql) {
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
  // Sharing for a set time ends by itself, like Find My: null is "until I stop".
  await sql`alter table location_shares add column if not exists expires_at timestamptz`;
  // An open SOS holds sharing on, exact, until someone in the family marks
  // the person safe (api/events.mjs). The id of that SOS, or null.
  await sql`alter table location_shares add column if not exists sos_lock uuid`;
  // What the phone says about its battery, and which saved places it is in.
  await sql`alter table location_shares add column if not exists battery integer`;
  await sql`alter table location_shares add column if not exists charging boolean`;
  await sql`alter table location_shares add column if not exists inside uuid[]`;
  // Places the family names - Home, School, Office - for arriving and leaving.
  await sql`create table if not exists location_places (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    name text not null,
    lat double precision not null,
    lng double precision not null,
    radius integer not null,
    by_member uuid references members(id) on delete set null,
    created_at timestamptz not null default now()
  )`;
  // "Announce my arrivals": the person's own yes, per family or group. No row,
  // or announce false, means their arrivals and departures are told to nobody.
  await sql`create table if not exists location_consent (
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    announce boolean not null default false,
    asked_by uuid references members(id) on delete set null,
    asked_at timestamptz,
    answered_at timestamptz,
    primary key (circle_id, member_id)
  )`;
  // An ask to share, waiting for its answer. "Not now" sets muted_until.
  await sql`create table if not exists location_asks (
    circle_id uuid not null references circles(id) on delete cascade,
    asker_id uuid not null references members(id) on delete cascade,
    target_id uuid not null references members(id) on delete cascade,
    status text not null default 'waiting',
    asked_at timestamptz not null default now(),
    muted_until timestamptz,
    primary key (circle_id, asker_id, target_id)
  )`;
  // Who looked at whose location, and when they last did.
  await sql`create table if not exists location_looks (
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    viewer_id uuid not null references members(id) on delete cascade,
    at timestamptz not null default now(),
    primary key (circle_id, member_id, viewer_id)
  )`;
}

// Locked by an SOS that is still open. A lock left by an SOS that is somehow
// gone or resolved does not hold anyone.
export async function sosLocked(sql, circleId, memberId) {
  try {
    const r = await sql`select s.id from location_shares l join sos s on s.id = l.sos_lock
                        where l.circle_id = ${circleId} and l.member_id = ${memberId} and s.status <> 'resolved'`;
    return !!r[0];
  } catch (e) { return false; }   // no SOS has ever been raised here
}
export const SOS_LOCK_MSG = 'Your SOS is still open, so your family can see exactly where you are. ' +
  'Sharing stays on until the SOS is closed: tap "I am safe" on the red bar, or anyone in the family can.';
// Turn sharing on, exact and with no end time, for an SOS. Used by the SOS
// itself, never by anyone else's request.
export async function lockForSos(sql, circleId, memberId, sosId, pos) {
  await ensureLocationSchema(sql);
  await sql`insert into location_shares (circle_id, member_id, enabled, precision, lat, lng, accuracy, updated_at, enabled_at, expires_at, sos_lock)
            values (${circleId}, ${memberId}, true, 'exact', ${pos ? pos.lat : null}, ${pos ? pos.lng : null}, ${pos ? pos.accuracy : null},
                    ${pos ? new Date() : null}, now(), null, ${sosId})
            on conflict (circle_id, member_id) do update set enabled = true, precision = 'exact', expires_at = null, sos_lock = ${sosId},
              lat = coalesce(${pos ? pos.lat : null}, location_shares.lat), lng = coalesce(${pos ? pos.lng : null}, location_shares.lng),
              accuracy = coalesce(${pos ? pos.accuracy : null}, location_shares.accuracy),
              updated_at = case when ${!!pos}::boolean then now() else location_shares.updated_at end,
              enabled_at = coalesce(case when location_shares.enabled then location_shares.enabled_at end, now())`;
}
export async function unlockSos(sql, circleId, memberId) {
  await ensureLocationSchema(sql);
  await sql`update location_shares set sos_lock = null where circle_id = ${circleId} and member_id = ${memberId}`;
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

    // Time is up: sharing stops and the position is deleted, exactly as if
    // the person had tapped Stop. Done on every read and write, so nobody is
    // ever shown a position past the time it was shared for.
    const ended = await sql`
      update location_shares s set enabled = false, lat = null, lng = null, accuracy = null,
        updated_at = null, enabled_at = null, expires_at = null
      from members m
      where s.circle_id = ${circle.id} and s.enabled and s.expires_at is not null and s.expires_at <= now()
        and s.sos_lock is null and m.id = s.member_id
      returning m.id, m.name`;
    for (const e of ended) await feed(sql, circle.id, e.id, `${e.name}'s location sharing ended, as they chose`);

    if (req.method === 'GET') {
      const rows = await sql`
        select s.member_id, s.precision, s.lat, s.lng, s.accuracy, s.updated_at, s.expires_at, m.name, m.relation,
               s.battery, s.charging, s.inside
        from location_shares s join members m on m.id = s.member_id
        where s.circle_id = ${circle.id} and s.enabled and s.lat is not null
        order by (s.member_id = ${me.id}) desc, s.updated_at desc`;
      const mine = await sql`select enabled, precision, updated_at, expires_at from location_shares
                             where circle_id = ${circle.id} and member_id = ${me.id}`;
      const locked = await sosLocked(sql, circle.id, me.id);
      const places = await sql`select id, name, lat, lng, radius from location_places where circle_id = ${circle.id} order by created_at`;
      const placeName = new Map(places.map(p => [p.id, p.name]));
      // A LOOK. Other people's positions are sent only when the reader asks
      // to look, and the look is written down in the same request: at most
      // one row per viewer per person, refreshed every LOOK_EVERY_MIN.
      const look = q.look === '1';
      if (look) {
        await sql`insert into location_looks (circle_id, member_id, viewer_id, at)
                  select s.circle_id, s.member_id, ${me.id}, now() from location_shares s
                  where s.circle_id = ${circle.id} and s.enabled and s.lat is not null and s.member_id <> ${me.id}
                  on conflict (circle_id, member_id, viewer_id) do update set at = now()
                    where location_looks.at < now() - make_interval(mins => ${LOOK_EVERY_MIN})`;
      }
      // Who looked at mine in the last week, newest first.
      const seen = await sql`select v.name, k.at from location_looks k join members v on v.id = k.viewer_id
                             where k.circle_id = ${circle.id} and k.member_id = ${me.id} and k.at > now() - interval '7 days'
                             order by k.at desc limit 6`;
      // Asks waiting for my answer, and my own "Announce my arrivals".
      const asks = await sql`select a.asker_id, m.name, a.asked_at from location_asks a join members m on m.id = a.asker_id
                             where a.circle_id = ${circle.id} and a.target_id = ${me.id} and a.status = 'waiting'
                               and a.asked_at > now() - interval '7 days'
                             order by a.asked_at desc limit 5`;
      const con = (await sql`select c.announce, c.asked_at, c.answered_at, b.name as asked_name
                             from location_consent c left join members b on b.id = c.asked_by
                             where c.circle_id = ${circle.id} and c.member_id = ${me.id}`)[0];
      const announcing = new Set((await sql`select member_id from location_consent where circle_id = ${circle.id} and announce`).map(r => r.member_id));
      return res.status(200).json({
        ok: true,
        places, look,
        me: { sharing: !!(mine[0] && mine[0].enabled), precision: mine[0] ? mine[0].precision : 'exact',
              updatedAt: mine[0] ? mine[0].updated_at : null, until: mine[0] && mine[0].enabled ? mine[0].expires_at : null,
              sosLock: locked, lostLock: await isLost(sql, me.user_id),
              announce: !!(con && con.announce),
              announceAsk: con && !con.announce && con.asked_at && !con.answered_at ? { by: con.asked_name || 'Your family', at: con.asked_at } : null,
              asks: asks.map(a => ({ askerId: a.asker_id, name: a.name, at: a.asked_at })),
              seenBy: seen.map(x => ({ name: x.name, at: x.at })) },
        shares: rows.map(r => {
          const own = r.member_id === me.id, open = own || look;
          return { memberId: r.member_id, name: r.name, relation: r.relation, mine: own,
                   lat: open ? r.lat : null, lng: open ? r.lng : null, accuracy: open ? r.accuracy : null, withheld: !open,
                   precision: r.precision,
                   updatedAt: r.updated_at, until: r.expires_at, stale: isStale(r.updated_at), live: isLive(r.updated_at),
                   announces: announcing.has(r.member_id),
                   battery: open ? r.battery : null, charging: open ? r.charging : null,
                   at: (open && r.precision === 'exact' ? (r.inside || []) : []).map(id => placeName.get(id)).filter(Boolean) };
        })
      });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    const action = body.action;
    // Ring a phone, and Lost mode (api/_findme.mjs).
    const fa = await findAction(sql, circle, me, body, tokenOf(req));
    if (fa) return res.status(fa.status).json(fa.json);
    const cur = (await sql`select * from location_shares where circle_id = ${circle.id} and member_id = ${me.id}`)[0];
    // During an open SOS the position keeps flowing, exact, with no end time.
    // Stopping, blurring it to the area, or setting a time limit waits until
    // the family has marked the person safe.
    const locked = cur && cur.sos_lock ? await sosLocked(sql, circle.id, me.id) : false;
    const holding = action === 'stop' || action === 'precision' || (action === 'share' && (body.precision === 'area' || body.until));
    if (locked && holding) {
      return res.status(423).json({ ok: false, sosLock: true, error: SOS_LOCK_MSG });
    }
    // Lost mode holds it the same way: a finder cannot switch it off.
    if (holding && await isLost(sql, me.user_id)) {
      return res.status(423).json({ ok: false, lostLock: true, error: LOST_LOCK_MSG });
    }

    if (action === 'share' || action === 'update') {
      if (action === 'update' && !(cur && cur.enabled)) return res.status(409).json({ ok: false, error: 'Turn on sharing first' });
      const pos = validPosition(body.lat, body.lng, body.accuracy);
      if (pos.error) return res.status(400).json({ ok: false, error: pos.error });
      if (action === 'update') {
        // A position already on its way when the person taps Stop must never
        // switch sharing back on: the write only lands on a row that is still
        // shared, at the precision it was rounded for.
        const s = shareable(pos, cur.precision);
        const done = await sql`update location_shares set lat = ${s.lat}, lng = ${s.lng}, accuracy = ${s.accuracy}, updated_at = now(),
                                 battery = ${batteryOf(body.battery)}, charging = ${typeof body.charging === 'boolean' ? body.charging : null}
                               where circle_id = ${circle.id} and member_id = ${me.id} and enabled and precision = ${cur.precision}
                               returning member_id`;
        if (!done.length) return res.status(409).json({ ok: false, error: 'Sharing changed a moment ago' });
        if (cur.precision === 'exact') await placeNews(sql, circle, me, pos, cur.inside);
        return res.status(200).json({ ok: true, sharing: true, precision: cur.precision });
      }
      const precision = PRECISIONS.includes(body.precision) ? body.precision : 'exact';
      const until = shareUntil(body.until);
      if (until && until.error) return res.status(400).json({ ok: false, error: until.error });
      const s = shareable(pos, precision);
      const bat = batteryOf(body.battery), chg = typeof body.charging === 'boolean' ? body.charging : null;
      await sql`insert into location_shares (circle_id, member_id, enabled, precision, lat, lng, accuracy, updated_at, enabled_at, expires_at, battery, charging)
                values (${circle.id}, ${me.id}, true, ${precision}, ${s.lat}, ${s.lng}, ${s.accuracy}, now(), now(), ${until}, ${bat}, ${chg})
                on conflict (circle_id, member_id) do update set enabled = true, precision = ${precision},
                  lat = ${s.lat}, lng = ${s.lng}, accuracy = ${s.accuracy}, updated_at = now(), expires_at = ${until},
                  battery = ${bat}, charging = ${chg},
                  enabled_at = coalesce(case when location_shares.enabled then location_shares.enabled_at end, now())`;
      // Starting fresh, nobody has "arrived" anywhere: the places it is in now
      // are where it is, quietly. After that, moves are news.
      if (precision === 'exact') {
        if (cur && cur.enabled && cur.precision === 'exact') await placeNews(sql, circle, me, pos, cur.inside);
        else await placeNews(sql, circle, me, pos, null, true);
      } else await sql`update location_shares set inside = null where circle_id = ${circle.id} and member_id = ${me.id}`;
      // Sharing answers every ask that was waiting.
      await sql`update location_asks set status = 'shared' where circle_id = ${circle.id} and target_id = ${me.id} and status = 'waiting'`;
      // Starting is everyone's business: the family should know it can see you.
      if (!(cur && cur.enabled)) {
        await feed(sql, circle.id, me.id, `${me.name} is sharing ${precision === 'area' ? 'their area' : 'their location'} with ${whoFor(circle)}` +
          (until ? ' for a set time' : ''));
      }
      return res.status(200).json({ ok: true, sharing: true, precision, until });
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

    // PLACES. Anyone in the family can name one; anyone can remove one.
    if (action === 'place_add') {
      const err = placeError(body);
      if (err) return res.status(400).json({ ok: false, error: err });
      const n = await sql`select count(*)::int as n from location_places where circle_id = ${circle.id}`;
      if (n[0].n >= 20) return res.status(400).json({ ok: false, error: 'A family can keep up to 20 places - remove one first.' });
      const name = String(body.name).replace(/\s+/g, ' ').trim();
      const r = await sql`insert into location_places (circle_id, name, lat, lng, radius, by_member)
                          values (${circle.id}, ${name}, ${Number(body.lat)}, ${Number(body.lng)}, ${Math.round(Number(body.radius))}, ${me.id})
                          returning id`;
      await feed(sql, circle.id, me.id, `${me.name} saved a place: ${name}`);
      // Nobody's arrivals are announced because a place exists. Each person
      // on Parwah who has never been asked is asked once, on their own phone.
      const asked = await sql`
        insert into location_consent (circle_id, member_id, announce, asked_by, asked_at)
        select ${circle.id}, m.id, false, ${me.id}, now() from members m
        where m.circle_id = ${circle.id} and m.user_id is not null and m.id <> ${me.id}
          and not coalesce((to_jsonb(m) ->> 'remembered')::boolean, false)
        on conflict (circle_id, member_id) do nothing returning member_id`;
      for (const a of asked) {
        await pushCircle(sql, circle.id, { title: '📍 ' + firstName(me.name) + ' saved a place: ' + name,
          body: 'Should the family be told when you arrive and leave? Only if you say yes.', url: '/#people' }, { only: a.member_id });
      }
      return res.status(201).json({ ok: true, id: r[0].id, asked: asked.length });
    }
    if (action === 'place_remove') {
      const r = await sql`delete from location_places where id = ${String(body.id || '')}::uuid and circle_id = ${circle.id} returning name`
        .catch(() => []);
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That place is not here any more' });
      await sql`update location_shares set inside = array_remove(inside, ${String(body.id)}::uuid) where circle_id = ${circle.id}`;
      return res.status(200).json({ ok: true });
    }

    // ANNOUNCE MY ARRIVALS. Only the person themself answers, yes or no.
    if (action === 'announce_set') {
      if (typeof body.on !== 'boolean') return res.status(400).json({ ok: false, error: 'Choose yes or no' });
      const was = (await sql`select announce from location_consent where circle_id = ${circle.id} and member_id = ${me.id}`)[0];
      await sql`insert into location_consent (circle_id, member_id, announce, answered_at) values (${circle.id}, ${me.id}, ${body.on}, now())
                on conflict (circle_id, member_id) do update set announce = ${body.on}, answered_at = now()`;
      if (body.on !== !!(was && was.announce)) {
        await feed(sql, circle.id, me.id, body.on ? `${me.name} said yes: ${whoFor(circle)} is told when they arrive at and leave saved places`
                                                  : `${me.name} turned off announcing their arrivals`);
      }
      return res.status(200).json({ ok: true, announce: body.on });
    }
    // Ask someone to announce theirs. It is only an ask: at most one a week
    // from one person to another, and never to someone who already said yes.
    if (action === 'announce_ask') {
      const t = await sql`select id, name, user_id from members where id = ${String(body.askWho || '')}::uuid and circle_id = ${circle.id}`
        .catch(() => []);
      if (!t[0] || t[0].id === me.id) return res.status(404).json({ ok: false, error: 'Choose someone else in this ' + (circle.kind === 'group' ? 'group' : 'family') });
      if (!t[0].user_id) return res.status(400).json({ ok: false, error: t[0].name + ' is not on Parwah, so cannot be asked.' });
      const c = (await sql`select announce from location_consent where circle_id = ${circle.id} and member_id = ${t[0].id}`)[0];
      if (c && c.announce) return res.status(409).json({ ok: false, error: t[0].name + ' already announces their arrivals' });
      if (!(await rateLimit(sql, 'locann', me.id + ':' + t[0].id, 1, 7 * 86400, { failClosed: true }))) {
        return res.status(429).json({ ok: false, error: 'You asked ' + t[0].name + ' this week. It is their choice.' });
      }
      await sql`insert into location_consent (circle_id, member_id, announce, asked_by, asked_at) values (${circle.id}, ${t[0].id}, false, ${me.id}, now())
                on conflict (circle_id, member_id) do update set asked_by = ${me.id}, asked_at = now(), answered_at = null`;
      await pushCircle(sql, circle.id, { title: '📍 ' + firstName(me.name) + ' asks: announce your arrivals?',
        body: 'The family would be told when you arrive at and leave saved places. Only if you say yes.', url: '/#people' }, { only: t[0].id });
      return res.status(200).json({ ok: true, asked: t[0].name });
    }
    // "NOT NOW" to an ask to share: the ask goes away, and that person
    // cannot ask again for ASK_MUTE_DAYS days. Nobody is told off.
    if (action === 'ask_answer') {
      if (body.answer !== 'notnow') return res.status(400).json({ ok: false, error: 'Share, or say Not now' });
      const until = muteUntil();
      const r = await sql`update location_asks set status = 'declined', muted_until = ${until}
                          where circle_id = ${circle.id} and target_id = ${me.id} and asker_id = ${String(body.askerId || '')}::uuid
                            and status = 'waiting' returning asker_id`.catch(() => []);
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That ask is not waiting any more' });
      return res.status(200).json({ ok: true, mutedUntil: until, days: ASK_MUTE_DAYS });
    }

    // ASK SOMEONE TO SHARE. Only they can turn it on; this asks them to.
    if (action === 'ask') {
      const t = await sql`select id, name, user_id from members where id = ${String(body.targetId || '')}::uuid and circle_id = ${circle.id}`
        .catch(() => []);
      if (!t[0]) return res.status(404).json({ ok: false, error: 'That person is not in this ' + (circle.kind === 'group' ? 'group' : 'family') });
      if (t[0].id === me.id) return res.status(400).json({ ok: false, error: 'That is you' });
      if (!t[0].user_id) return res.status(400).json({ ok: false, error: t[0].name + ' is not on Parwah, so cannot be asked. A call might help.' });
      const on = await sql`select 1 from location_shares where circle_id = ${circle.id} and member_id = ${t[0].id} and enabled`;
      if (on[0]) return res.status(409).json({ ok: false, error: t[0].name + ' is already sharing' });
      // They said "Not now" to this asker: no more asks until the time is up.
      const muted = await sql`select muted_until from location_asks where circle_id = ${circle.id} and asker_id = ${me.id}
                              and target_id = ${t[0].id} and muted_until > now()`;
      if (muted[0]) return res.status(429).json({ ok: false, notNow: true, mutedUntil: muted[0].muted_until,
        error: firstName(t[0].name) + ' said not now. You can ask again in a few days.' });
      if (!(await rateLimit(sql, 'locask', me.id + ':' + t[0].id, 1, 600))) {
        return res.status(429).json({ ok: false, error: 'You asked ' + t[0].name + ' a few minutes ago - give them a little time' });
      }
      await sql`insert into location_asks (circle_id, asker_id, target_id, status, asked_at) values (${circle.id}, ${me.id}, ${t[0].id}, 'waiting', now())
                on conflict (circle_id, asker_id, target_id) do update set status = 'waiting', asked_at = now(), muted_until = null`;
      await pushCircle(sql, circle.id, { title: '📍 ' + me.name + ' would like to know where you are',
        body: 'Tap to share your location with ' + whoFor(circle) + ', or say Not now. It is your choice.', url: '/#people' }, { only: t[0].id });
      return res.status(200).json({ ok: true, asked: t[0].name });
    }

    if (action === 'stop') {
      await sql`update location_shares set enabled = false, lat = null, lng = null, accuracy = null, updated_at = null, enabled_at = null, expires_at = null, inside = null, battery = null, charging = null
                where circle_id = ${circle.id} and member_id = ${me.id}`;
      if (cur && cur.enabled) await feed(sql, circle.id, me.id, `${me.name} stopped sharing their location`);
      // Nothing is left to look at, so the list of who looked goes too.
      await sql`delete from location_looks where circle_id = ${circle.id} and member_id = ${me.id}`;
      return res.status(200).json({ ok: true, sharing: false });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}

// Arriving and leaving a saved place: told to the family, once per move.
// "quiet" records where someone is without announcing it (sharing has just
// started: being at home is not news).
async function placeNews(sql, circle, me, pos, before, quiet) {
  try {
    const places = await sql`select id, name, lat, lng, radius from location_places where circle_id = ${circle.id}`;
    const now = placesAt(pos, places);
    // Saved only if nothing else moved it meanwhile, so two updates at once
    // cannot both announce the same arrival.
    const saved = await sql`update location_shares set inside = ${now}::uuid[]
                            where circle_id = ${circle.id} and member_id = ${me.id}
                              and coalesce(inside, '{}') = coalesce(${before || []}::uuid[], '{}')
                            returning member_id`;
    if (quiet || !saved[0]) return;
    // Told to the family only if this person said yes to "Announce my
    // arrivals". Without that yes the place is where they are, quietly.
    const yes = await sql`select 1 from location_consent where circle_id = ${circle.id} and member_id = ${me.id} and announce`;
    if (!yes[0]) return;
    const moves = placeMoves(before, now);
    const name = new Map(places.map(p => [p.id, p.name]));
    for (const id of moves.arrived) {
      await feed(sql, circle.id, me.id, `📍 ${me.name} arrived at ${name.get(id)}`);
      await pushCircle(sql, circle.id, { title: '📍 ' + me.name + ' arrived at ' + name.get(id), body: 'Open Parwah to see where everyone is', url: '/#people' }, { except: me.id });
    }
    for (const id of moves.left) {
      await feed(sql, circle.id, me.id, `📍 ${me.name} left ${name.get(id)}`);
      await pushCircle(sql, circle.id, { title: '📍 ' + me.name + ' left ' + name.get(id), body: 'Open Parwah to see where everyone is', url: '/#people' }, { except: me.id });
    }
  } catch (e) { /* the position is saved either way */ }
}
