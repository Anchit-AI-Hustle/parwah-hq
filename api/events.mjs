// GET  /api/events?circle=CODE          - circle state: members + last 50 events
// POST /api/events {code, memberId, type, text} - record a check-in, SOS, pill or message
import { db, ensureSchema, circleByCode, requireMember, isUuid, ensureCircleChat, rateLimit } from './_db.mjs';
import { ensureSosSchema, sosText, parsePos, sosContacts, mapLink, SOS_AUDIO_MAX, SOS_AUDIO_TYPES } from './_sos.mjs';
import { lockForSos, unlockSos, ensureLocationSchema } from './_locationapi.mjs';
import { findState } from './_findme.mjs';
import { dialOut } from './_sosdial.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { ownedMember } from './_owned.mjs';
import { pushCircle } from './_push.mjs';
import { ensureTaskSchema, sweepOverdue, sweepReminders } from './_tasks.mjs';
import { sweepPlanReminders } from './_plansweep.mjs';
import { award, today } from './_coins.mjs';

import { index as kinIndex, kinLabel, generations } from './_kin.mjs';
import { pulseToday, ensurePulseSchema, optionOf, styleFor, today as pulseDay } from './_pulse.mjs';

const SOS_ESCALATE_MIN = 5;   // nobody answered in this long → shout louder

const TYPES = ['checkin', 'sos', 'pill', 'message'];

export default async function handler(req, res) {
  let sql;
  try {
    sql = db(); await ensureSchema(sql);
    // An SOS is not an event that scrolls away - it is an open state with
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
    await ensureSosSchema(sql);
  } catch (e) { return failDb(res, e); }

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
                values (${circleId}, ${s.member_id}, 'care', ${'🆘 Nobody has answered ' + s.name + "'s SOS yet - please call them now"})`;
      await pushCircle(sql, circleId, {
        title: '🆘 STILL NOBODY - ' + s.name + ' needs help',
        body: 'No one has picked this up in ' + SOS_ESCALATE_MIN + ' minutes. Call ' + (s.phone || 'them') + ' now.',
        url: '/#home', urgent: true
      }, {});
    }
  } catch (e) { /* escalation must never break a read */ }
}

  try {
    // THE TIMER. Reminders and late tasks are also checked every 10 minutes
    // by .github/workflows/tick.yml, so an alarm rings when nobody in the
    // family has Parwah open. It reads nothing and returns only counts;
    // each alert is claimed in the database, so it is never sent twice;
    // and it runs at most once a minute whoever calls it.
    if (req.method === 'GET' && req.query && req.query.tick !== undefined) {
      if (!(await rateLimit(sql, 'tick', 'all', 1, 50))) return res.status(200).json({ ok: true, skipped: true });
      await ensureTaskSchema(sql);
      const circles = await sql`select distinct circle_id from requests
                                where status in ('open','assigned','claimed') and due_at is not null
                                  and due_at between now() - interval '2 days' and now() + interval '2 days'
                                union select distinct circle_id from sos where status = 'open'
                                union select distinct circle_id from plans where at between now() and now() + interval '2 hours'
                                limit 500`.catch(async () => sql`select distinct circle_id from requests
                                where status in ('open','assigned','claimed') and due_at is not null
                                  and due_at between now() - interval '2 days' and now() + interval '2 days' limit 500`);
      let reminded = 0, late = 0, events = 0;
      for (const c of circles) {
        try {
          reminded += await sweepReminders(sql, c.circle_id);
          late += await sweepOverdue(sql, c.circle_id);
          events += await sweepPlanReminders(sql, c.circle_id);
          await escalateStaleSos(sql, c.circle_id);
        } catch (e) { /* one family's trouble never stops the others */ }
      }
      return res.status(200).json({ ok: true, circles: circles.length, reminded, late, events });
    }
    if (req.method === 'GET') {
      // An invite code alone used to read this: every member's phone, date of
      // birth, the feed, live call rooms, and every member UUID - which is
      // exactly what the write routes below accept as proof of who you are.
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });
      const circle = g.circle;
      // The recording made when someone pressed SOS: for the family only.
      if (q.sosAudio) {
        if (!isUuid(q.sosAudio)) return res.status(400).json({ ok: false, error: 'Bad recording id' });
        const a = await sql`select m.mime, m.data, m.seconds from sos_media m join sos s on s.id = m.sos_id
                            where m.id = ${q.sosAudio} and s.circle_id = ${circle.id}`;
        if (!a[0]) return res.status(404).json({ ok: false, error: 'That recording is not here' });
        return res.status(200).json({ ok: true, mime: a[0].mime, data: a[0].data, seconds: a[0].seconds });
      }
      const members = await sql`select id, name, role, phone, place, country, relation, dob, gift_info, created_at,
                                       parent_id, spouse_id, gender, user_id is not null as on_app
                                from members where circle_id = ${circle.id} order by created_at`;
      // The family tree, read from where the person looking stands: Papa is
      // "Father" to Rohan and "Father-in-law" to Priya. null = not placed yet.
      const by = kinIndex(members.map(m => ({ id: m.id, gender: m.gender, parentId: m.parent_id, spouseId: m.spouse_id })));
      const gens = generations(by);
      for (const m of members) {
        m.kin = kinLabel(by, g.me.id, m.id);
        m.gen = (m.parent_id || m.spouse_id || members.some(x => x.parent_id === m.id)) ? gens.get(m.id) : null;
      }
      const ck = await sql`select kind, family_type from circles where id = ${circle.id}`;
      // member_id is returned so the client can tell YOUR events from
      // everyone else's; without it your own check-in came back to you as an
      // unread notification and bumped your own badge.
      const events = await sql`
        select e.id, e.type, e.text, e.created_at, e.member_id, m.name as member_name, m.role as member_role
        from events e left join members m on m.id = e.member_id
        where e.circle_id = ${circle.id}
        order by e.created_at desc limit 50`;
      // live calls: everyone in the family sees what is on right now
      const calls = await sql`
        select c.id, c.room, c.label, c.started_at, m.name as by_name
        from calls c left join members m on m.id = c.by_member
        where c.circle_id = ${circle.id} and c.started_at > now() - interval '3 hours'
        order by c.started_at desc limit 3`;
      // Requests waiting on the family - any member can decide.
      const joinReqs = await sql`
        select id, name, phone, relation, created_at from join_requests
        where circle_id = ${circle.id} and status = 'pending'
        order by created_at limit 20`;
      const pol = await sql`select join_policy from circles where id = ${circle.id}`;
      await escalateStaleSos(sql, circle.id);
      // Every open phone looks, so a late task is announced within a poll;
      // the sweep claims each alert, so it is still announced only once.
      try { await ensureTaskSchema(sql); await sweepReminders(sql, circle.id); await sweepOverdue(sql, circle.id); await sweepPlanReminders(sql, circle.id); } catch (e) { /* never break a read */ }
      const pulse = await pulseToday(sql, circle.id);
      const sosOpen = await sql`
        select s.id, s.member_id, s.status, s.escalated, s.created_at, s.acked_at, s.safe_at,
               s.lat, s.lng, s.accuracy,
               m.name, m.phone, a.name as acked_name,
               (select md.id from sos_media md where md.sos_id = s.id order by md.created_at desc limit 1) as audio_id
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
      return res.status(200).json({ ok: true, circleName: circle.name, code: circle.code,
        kind: ck[0] ? ck[0].kind : 'family', familyType: ck[0] ? ck[0].family_type : null, members, events, seenAt, calls,
        joinRequests: joinReqs, joinPolicy: (pol[0] && pol[0].join_policy) || 'approve',
        sos: sosOpen.map(x => ({ ...x, map: mapLink(x.lat === null ? null : { lat: x.lat, lng: x.lng }) })),
        sosEscalateMin: SOS_ESCALATE_MIN, pulse,
        findme: await findState(sql, circle, g.me, tokenOf(req)).catch(() => null) });
    }

    if (req.method === 'POST') {
      const { code, memberId, type, text } = req.body || {};
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No family found with that code' });
      if (type === 'seen') {
        if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
        const mm = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id`);
        if (!mm[0]) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
        await sql`insert into notif_seen (member_id, seen_at) values (${memberId}, now())
                  on conflict (member_id) do update set seen_at = now()`;
        return res.status(200).json({ ok: true });
      }
      // How you actually are, in today's vocabulary. One answer per person per
      // day, replaceable - a day can turn.
      if (type === 'pulse') {
        if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
        const pm = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
        if (!pm[0]) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
        await ensurePulseSchema(sql);
        const day = pulseDay(), styleKey = styleFor(day);
        const opt = optionOf(styleKey, String(req.body.value || ''));
        if (!opt) return res.status(400).json({ ok: false, error: 'Pick how you are today' });
        const note = String(req.body.note || '').trim().slice(0, 120) || null;
        await sql`insert into pulse (circle_id, member_id, day, style, value, note)
                  values (${circle.id}, ${pm[0].id}, ${day}, ${styleKey}, ${opt.k}, ${note})
                  on conflict (circle_id, member_id, day)
                  do update set style = excluded.style, value = excluded.value, note = excluded.note, at = now()`;
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${pm[0].id}, 'checkin', ${pm[0].name + ' is ' + opt.e + ' ' + opt.t})`;
        // No coins for saying how you are: an adult's check-in is not a game.
        // "A call would be nice" is the reason this feature exists - it lets
        // someone say they are not fine without having to say it.
        if (opt.call) {
          await pushCircle(sql, circle.id, { title: '🧡 ' + pm[0].name + ' could do with a call',
            body: opt.e + ' ' + opt.t + (note ? ' - ' + note : '') }, { except: pm[0].id });
        }
        return res.status(201).json({ ok: true });
      }

      // Somebody is on it - everyone else stops worrying, and the person who
      // pressed the button finds out that help is coming.
      if (type === 'sos_ack' || type === 'sos_resolve') {
        if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
        const am = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
        if (!am[0]) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
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
            body: 'They are helping ' + row[0].name + ' - you do not need to call as well' }, { except: memberId });
          return res.status(200).json({ ok: true });
        }
        // Anyone in this family or group on Parwah ends it, the person who
        // sent it included (owner, 2026-10-10): an SOS nobody else answers
        // must never stay on for ever. It ends here only, not in their other
        // families or groups.
        if (row[0].status === 'resolved') return res.status(200).json({ ok: true, already: true });
        await sql`update sos set status = 'resolved', resolved_at = now(), resolved_by = ${memberId} where id = ${row[0].id}`;
        await unlockSos(sql, circle.id, row[0].member_id);
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${memberId}, 'care', ${am[0].name + ' marked ' + row[0].name + "'s SOS as sorted ✅"})`;
        if (row[0].member_id !== memberId) {
          await pushCircle(sql, circle.id, { title: '✅ ' + am[0].name + ' marked you safe',
            body: 'Your location sharing is yours again - stop it whenever you like', url: '/#people' }, { only: row[0].member_id });
        }
        await pushCircle(sql, circle.id, { title: '✅ ' + row[0].name + ' is alright',
          body: am[0].name + ' marked the SOS as sorted' }, { except: memberId });
        return res.status(200).json({ ok: true });
      }

      // The person who pressed SOS says they are alright: that ends it, and
      // the family is told.
      if (type === 'sos_safe' || type === 'sos_audio') {
        if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
        const sm = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
        if (!sm[0]) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
        if (!isUuid(req.body.sosId)) return res.status(400).json({ ok: false, error: 'Bad SOS id' });
        const r = await sql`select id, member_id, status from sos where id = ${req.body.sosId} and circle_id = ${circle.id}`;
        if (!r[0] || r[0].status === 'resolved') return res.status(404).json({ ok: false, error: 'That SOS is not open' });
        if (r[0].member_id !== memberId) return res.status(403).json({ ok: false, error: 'Only the person who sent the SOS can do that' });
        if (type === 'sos_safe') {
          await sql`update sos set status = 'resolved', resolved_at = now(), resolved_by = ${memberId}, safe_at = now() where id = ${r[0].id}`;
          await unlockSos(sql, circle.id, memberId);
          await sql`insert into events (circle_id, member_id, type, text)
                    values (${circle.id}, ${memberId}, 'care', ${sm[0].name + ' is safe now - the SOS is closed ✅'})`;
          await pushCircle(sql, circle.id, { title: '✅ ' + sm[0].name + ' is safe',
            body: 'They closed their SOS themselves. A call to check in never hurts.', url: '/#home' }, { except: memberId });
          return res.status(200).json({ ok: true, resolved: true });
        }
        // A short recording from the phone that pressed SOS, so the family can
        // hear what was happening. Kept with the SOS, read only by the family.
        const mime = String(req.body.mime || '').split(';')[0].trim().toLowerCase();
        if (!SOS_AUDIO_TYPES.includes(mime)) return res.status(400).json({ ok: false, error: 'That recording type is not supported' });
        const data = String(req.body.data || '');
        if (!data || data.length > SOS_AUDIO_MAX || !/^[A-Za-z0-9+/=]+$/.test(data)) {
          return res.status(400).json({ ok: false, error: 'That recording is too long or could not be read' });
        }
        const secs = Math.max(0, Math.min(600, parseInt(req.body.seconds, 10) || 0)) || null;
        const ins = await sql`insert into sos_media (sos_id, member_id, mime, data, seconds)
                              values (${r[0].id}, ${memberId}, ${mime}, ${data}, ${secs}) returning id`;
        await pushCircle(sql, circle.id, { title: '🎙 A recording from ' + sm[0].name + "'s SOS",
          body: 'Open Parwah to listen', url: '/#home', urgent: true }, { except: memberId });
        return res.status(201).json({ ok: true, audioId: ins[0].id });
      }

      if (type === 'call_start' || type === 'call_end') {
        if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
        const cm = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
        if (!cm[0]) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
        if (type === 'call_start') {
          const room = String(req.body.room || '');
          if (room.indexOf('https://meet.jit.si/') !== 0 || room.length > 300) return res.status(400).json({ ok: false, error: 'Bad room' });
          const label = String(req.body.label || '').trim().slice(0, 60) || null;
          const r = await sql`insert into calls (circle_id, room, label, by_member) values (${circle.id}, ${room}, ${label}, ${memberId}) returning id`;
          await pushCircle(sql, circle.id, { title: (label || '📞 Family call') + ' on now', body: cm[0].name + ' started it - tap to join everyone' }, { except: memberId });
          return res.status(201).json({ ok: true, callId: r[0].id });
        }
        // anyone in the circle can end it - every member is an equal admin
        if (!isUuid(req.body.callId)) return res.status(400).json({ ok: false, error: 'Bad call id' });
        await sql`delete from calls where id = ${req.body.callId} and circle_id = ${circle.id}`;
        return res.status(200).json({ ok: true });
      }
      if (!TYPES.includes(type)) return res.status(400).json({ ok: false, error: 'Unknown event type' });
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
      const member = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
      if (!member[0]) return res.status(403).json({ ok: false, error: 'Not a member of this family' });
      const t = String(text || '').trim().slice(0, type === 'message' ? 300 : 120);
      if (type === 'message' && !t) return res.status(400).json({ ok: false, error: 'Empty message' });
      if (type === 'sos') return raiseSos(sql, res, circle, member[0], t, req.body);
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${memberId}, ${type}, ${t || null})`;
      // An adult's medicines and check-ins are not a game: no coins for them.
      return res.status(201).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'GET or POST only' });
  } catch (e) {
    return fail(res, e);
  }
}

// ONE PRESS OF SOS (see api/_sos.mjs for what it does and why).
async function raiseSos(sql, res, circle, me, said, body) {
  const pos = parsePos(body);
  // Already open: a second press is a fresh position and a fresh alert, not
  // a second emergency.
  const open = await sql`select id from sos where circle_id = ${circle.id} and member_id = ${me.id} and status <> 'resolved'
                         order by created_at desc limit 1`;
  let sosId, again = false;
  if (open[0]) {
    sosId = open[0].id; again = true;
    if (pos) await sql`update sos set lat = ${pos.lat}, lng = ${pos.lng}, accuracy = ${pos.accuracy} where id = ${sosId}`;
  } else {
    const r = await sql`insert into sos (circle_id, member_id, lat, lng, accuracy)
                        values (${circle.id}, ${me.id}, ${pos ? pos.lat : null}, ${pos ? pos.lng : null}, ${pos ? pos.accuracy : null})
                        returning id, created_at`;
    sosId = r[0].id;
    await sql`insert into events (circle_id, member_id, type, text) values (${circle.id}, ${me.id}, 'sos', ${said || null})`;
  }
  // Location on, exact, held on until the family marks them safe.
  await ensureLocationSchema(sql);
  await lockForSos(sql, circle.id, me.id, sosId, pos);
  const text = sosText(me.name, pos, Date.now()) + (said ? ' "' + said + '"' : '');
  // In the family chat, where everyone looks, with the map link.
  try {
    const chatId = await ensureCircleChat(sql, circle.id);
    await sql`insert into messages (chat_id, member_id, text) values (${chatId}, ${me.id}, ${text})`;
  } catch (e) { /* the alert below still goes */ }
  await pushCircle(sql, circle.id, {
    title: '🆘 SOS from ' + me.name + (again ? ' (again)' : ''),
    body: (pos ? 'Tap to see where they are and call them now' : 'Call them right now'),
    url: '/#home', urgent: true
  }, { except: me.id });
  const contacts = await sosContacts(sql, circle.id, me.id);
  // Texts, WhatsApp and calls sent by Parwah itself, once a Twilio account
  // is added (api/_sosdial.mjs). Without one, this sends nothing.
  const dialed = await dialOut(sql, sosId, contacts, { name: me.name, text, map: mapLink(pos) });
  return res.status(201).json({ ok: true, sosId, again, text, map: mapLink(pos), located: !!pos, contacts, dialed });
}
