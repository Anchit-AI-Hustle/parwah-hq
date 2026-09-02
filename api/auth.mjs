// Phone-first sign-in. One action does both directions:
//   POST /api/auth {action:'enter', phone, name?}
//   - phone known   → sign in: returns the profile + every circle membership
//   - phone unknown → if name given, creates the profile and signs in
//                     (sign-up and sign-in in one seamless step);
//                     without a name returns exists:false so the client
//                     can ask for it.
// No OTP yet (SMS provider is a roadmap item) — the shape is ready for an
// OTP check to slot in here without any client-flow change.
import { db, ensureSchema, isUuid, normPhone, phoneError, rateLimit, clientIp, serverError } from './_db.mjs';

// Every circle this number belongs to, each carrying what is waiting in it.
// A person in three families should be able to see, before opening any of
// them, which one actually needs them — that is the whole point of the list.
async function circlesOf(sql, userId) {
  return await sql`
    select c.code, c.name as "circleName", c.kind, m.id as "memberId", m.role, m.name as "memberName",
           (select count(*)::int from members mm where mm.circle_id = c.id) as "memberCount",
           (select count(*)::int from messages ms
              join chats ch on ch.id = ms.chat_id
              left join chat_members cm on cm.chat_id = ch.id and cm.member_id = m.id
              left join chat_reads cr on cr.chat_id = ch.id and cr.member_id = m.id
             where ch.circle_id = c.id
               and (ch.kind = 'circle' or cm.member_id is not null)
               and ms.member_id is distinct from m.id
               and (cr.read_at is null or ms.created_at > cr.read_at)) as "unread",
           (select count(*)::int from requests rq
             where rq.circle_id = c.id and rq.status = 'open') as "openRequests",
           (select count(*)::int from join_requests jq
             where jq.circle_id = c.id and jq.status = 'pending') as "waiting",
           (select count(*)::int from calls ca
             where ca.circle_id = c.id and ca.started_at > now() - interval '3 hours') as "live",
           (select max(ev.created_at) from events ev where ev.circle_id = c.id) as "lastAt",
           (select ev.text from events ev where ev.circle_id = c.id
             order by ev.created_at desc limit 1) as "lastText",
           (select ev.type from events ev where ev.circle_id = c.id
             order by ev.created_at desc limit 1) as "lastType"
    from members m join circles c on c.id = m.circle_id
    where m.user_id = ${userId}
    order by m.created_at desc`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return serverError(res, e, 'auth'); }

  try {
    const body = req.body || {};
    // Until SMS one-time codes are in, a phone number is the whole key — so
    // the number of tries from one device is capped.
    if (body.action === 'enter') {
      const allowed = await rateLimit(sql, 'auth', clientIp(req), 25, 600);
      if (!allowed) return res.status(429).json({ ok: false, error: 'Too many sign-in attempts from this device — please wait a few minutes' });
    }

    if (body.action === 'update') {
      if (!isUuid(body.userId)) return res.status(403).json({ ok: false, error: 'Sign in first' });
      const u = await sql`select id, name, phone from users where id = ${body.userId}`;
      if (!u[0]) return res.status(404).json({ ok: false, error: 'Profile not found' });
      const newName = String(body.name || '').trim().slice(0, 60) || u[0].name;
      let newPhone = u[0].phone, newCc = null, newLocal = null;
      if (body.phone) {
        const np = normPhone(body.phone, body.cc);
        if (!np) return res.status(400).json({ ok: false, error: phoneError(body.cc) });
        newPhone = np.e164; newCc = np.cc; newLocal = np.local;
      }
      try {
        if (newCc) await sql`update users set name = ${newName}, phone = ${newPhone}, phone_cc = ${newCc}, phone_local = ${newLocal} where id = ${u[0].id}`;
        else await sql`update users set name = ${newName} where id = ${u[0].id}`;
      } catch (e) {
        return res.status(409).json({ ok: false, error: 'That number is already registered to another profile' });
      }
      // Keep memberships that carried the old number in step with the profile.
      if (newCc && newPhone !== u[0].phone) {
        await sql`update members set phone = ${newPhone}, phone_cc = ${newCc}, phone_local = ${newLocal} where user_id = ${u[0].id} and (phone is null or phone = ${u[0].phone})`;
      }
      return res.status(200).json({ ok: true, user: { id: u[0].id, name: newName, phone: newPhone } });
    }

    // The introduction is shown once per PERSON, ever. Recorded here rather
    // than in the browser so a second phone does not mean a second tour.
    if (body.action === 'toured') {
      if (!isUuid(body.userId)) return res.status(403).json({ ok: false, error: 'Sign in first' });
      await sql`update users set toured_at = coalesce(toured_at, now()) where id = ${body.userId}`;
      return res.status(200).json({ ok: true });
    }

    if (body.action !== 'enter') return res.status(400).json({ ok: false, error: 'Unknown action' });
    const np = normPhone(body.phone, body.cc);
    if (!np) return res.status(400).json({ ok: false, error: phoneError(body.cc) });
    const phone = np.e164;

    let rows = await sql`select id, name, phone, toured_at from users where phone = ${phone}`;
    if (!rows[0]) {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return res.status(200).json({ ok: true, exists: false });
      try {
        rows = await sql`insert into users (phone, phone_cc, phone_local, name) values (${phone}, ${np.cc}, ${np.local}, ${name}) returning id, name, phone, toured_at`;
      } catch (e) {
        // raced with another signup for the same phone — fall through to sign-in
        rows = await sql`select id, name, phone, toured_at from users where phone = ${phone}`;
      }
    }
    const user = rows[0];
    const circles = await circlesOf(sql, user.id);
    return res.status(200).json({ ok: true, exists: true,
      user: { id: user.id, name: user.name, phone: user.phone },
      toured: !!user.toured_at, circles });
  } catch (e) {
    return serverError(res, e, 'auth');
  }
}
