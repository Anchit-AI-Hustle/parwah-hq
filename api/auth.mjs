// Phone-first sign-in. One action does both directions:
//   POST /api/auth {action:'enter', phone, name?}
//   - phone known   → sign in: returns the profile + every circle membership
//   - phone unknown → if name given, creates the profile and signs in
//                     (sign-up and sign-in in one seamless step);
//                     without a name returns exists:false so the client
//                     can ask for it.
// No OTP yet (SMS provider is a roadmap item) — the shape is ready for an
// OTP check to slot in here without any client-flow change.
import { db, ensureSchema, isUuid, normPhone, phoneError, rateLimit, clientIp, sessionUser } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { pushCircle } from './_push.mjs';
import { pinError, hashPin, verifyPin, newToken, tokenHash, looksLikeToken,
         MAX_TRIES, LOCK_MINUTES, lockMessage, SESSION_DAYS } from './_auth.mjs';

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
  catch (e) { return failDb(res, e); }

  try {
    const body = req.body || {};
    // Until SMS one-time codes are in, a phone number is the whole key — so
    // the number of tries from one device is capped.
    // A SIGN-IN ATTEMPT AND A BACKGROUND REFRESH ARE NOT THE SAME EVENT. The
    // app re-reads the circle list for a number it already holds every 60
    // seconds, and that spent the sign-in budget: three phones in one house,
    // on one connection, locked the household out of signing in at all.
    //
    // Typing a number is still capped per device. A refresh for a number the
    // caller already has is capped per NUMBER, generously, which no attacker
    // can use to work through other people's numbers.
    if (body.action === 'enter') {
      if (body.refresh === true) {
        const key = String(body.phone || '').replace(/\D/g, '').slice(-12) || clientIp(req);
        const allowed = await rateLimit(sql, 'authrefresh', key, 60, 600);
        if (!allowed) return res.status(429).json({ ok: false, error: 'Refreshing too often — please wait a moment' });
      } else {
        const allowed = await rateLimit(sql, 'auth', clientIp(req), 25, 600);
        if (!allowed) return res.status(429).json({ ok: false, error: 'Too many sign-in attempts from this device — please wait a few minutes' });
      }
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

    // Sign out: the token stops working immediately, on this device only.
    if (body.action === 'signout') {
      if (body.token) { try { await sql`delete from sessions where token_hash = ${tokenHash(body.token)}`; } catch (e) {} }
      return res.status(200).json({ ok: true });
    }
    // Sign out everywhere, for a lost phone.
    if (body.action === 'signout_all') {
      const u = await sessionUser(sql, body.token);
      if (!u) return res.status(401).json({ ok: false, error: 'Please sign in again' });
      await sql`delete from sessions where user_id = ${u.user_id}`;
      return res.status(200).json({ ok: true });
    }
    // FORGOTTEN THE PIN, WITH NO SMS TO FALL BACK ON. Someone already in
    // your circle vouches for you. They know your face and your voice,
    // which is a better check than a text message to a number that may be
    // the very thing that was lost.
    if (body.action === 'reset_request') {
      const npr = normPhone(body.phone, body.cc);
      if (!npr) return res.status(400).json({ ok: false, error: phoneError(body.cc) });
      if (!(await rateLimit(sql, 'pinreset', npr.e164, 3, 3600))) {
        return res.status(429).json({ ok: false, error: 'A request is already waiting. Ask your family to open Parwah and approve it.' });
      }
      const ur = await sql`select id, name from users where phone = ${npr.e164}`;
      // Never reveal whether a number is registered.
      if (!ur[0]) return res.status(200).json({ ok: true, asked: true });
      const circles = await sql`select circle_id from members where user_id = ${ur[0].id} limit 1`;
      if (!circles[0]) {
        return res.status(200).json({ ok: true, asked: true, noFamily: true });
      }
      await sql`insert into pin_resets (user_id, circle_id) values (${ur[0].id}, ${circles[0].circle_id})`;
      await pushCircle(sql, circles[0].circle_id,
        { title: '🔑 ' + ur[0].name + ' cannot get in', body: 'They have asked the family to let them back in. Open Parwah to approve.' },
        { except: null });
      return res.status(200).json({ ok: true, asked: true });
    }
    // A member of the circle approves, and only then may the PIN be replaced.
    if (body.action === 'reset_approve' || body.action === 'reset_deny') {
      const approver = await sessionUser(sql, body.token);
      if (!approver) return res.status(401).json({ ok: false, error: 'Please sign in again' });
      if (!isUuid(body.resetId)) return res.status(400).json({ ok: false, error: 'Bad request' });
      const r = await sql`select id, user_id, circle_id, status from pin_resets where id = ${body.resetId}`;
      if (!r[0] || r[0].status !== 'pending') return res.status(404).json({ ok: false, error: 'That request is already decided' });
      const mem = await sql`select id from members where circle_id = ${r[0].circle_id} and user_id = ${approver.user_id}`;
      if (!mem[0]) return res.status(403).json({ ok: false, error: 'Only someone in that family can decide this' });
      if (r[0].user_id === approver.user_id) return res.status(403).json({ ok: false, error: 'Someone else in the family has to approve this, not you' });
      const status = body.action === 'reset_approve' ? 'approved' : 'denied';
      await sql`update pin_resets set status = ${status}, decided_by = ${mem[0].id}, decided_at = now() where id = ${r[0].id}`;
      if (status === 'approved') {
        // Clear the lock so they can set a new PIN at the next sign-in.
        await sql`update users set pin_hash = null, pin_salt = null, pin_tries = 0, locked_until = null where id = ${r[0].user_id}`;
        await sql`delete from sessions where user_id = ${r[0].user_id}`;
      }
      return res.status(200).json({ ok: true, status });
    }

    if (body.action !== 'enter') return res.status(400).json({ ok: false, error: 'Unknown action' });
    const np = normPhone(body.phone, body.cc);
    if (!np) return res.status(400).json({ ok: false, error: phoneError(body.cc) });
    const phone = np.e164;

    let rows = await sql`select id, name, phone, toured_at, pin_hash, pin_salt, pin_tries, locked_until
                         from users where phone = ${phone}`;
    const isNew = !rows[0];
    if (isNew) {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return res.status(200).json({ ok: true, exists: false });
      // A new person chooses a PIN in the same breath as their name. Making
      // it a later, skippable step is how an account ends up with none.
      const perr = pinError(body.pin);
      if (perr) return res.status(200).json({ ok: true, exists: false, needPin: true, error: perr });
      const h = hashPin(body.pin);
      try {
        rows = await sql`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at)
                         values (${phone}, ${np.cc}, ${np.local}, ${name}, ${h.hash}, ${h.salt}, now())
                         returning id, name, phone, toured_at, pin_hash, pin_salt, pin_tries, locked_until`;
      } catch (e) {
        // raced with another signup for the same phone — fall through to sign-in
        rows = await sql`select id, name, phone, toured_at, pin_hash, pin_salt, pin_tries, locked_until
                         from users where phone = ${phone}`;
      }
    }
    const user = rows[0];

    if (!isNew) {
      // An account made before PINs existed, or one the family has just let
      // back in. Set one now; there is nothing to check it against yet.
      if (!user.pin_hash) {
        const perr = pinError(body.pin);
        if (perr) return res.status(200).json({ ok: true, exists: true, setPin: true, name: user.name, error: body.pin ? perr : null });
        const h = hashPin(body.pin);
        await sql`update users set pin_hash = ${h.hash}, pin_salt = ${h.salt}, pin_set_at = now(),
                  pin_tries = 0, locked_until = null where id = ${user.id}`;
      } else {
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
          return res.status(429).json({ ok: false, locked: true, error: lockMessage(user.locked_until) });
        }
        if (!body.pin) return res.status(200).json({ ok: true, exists: true, needPin: true, name: user.name });
        if (!verifyPin(body.pin, user.pin_salt, user.pin_hash)) {
          const tries = (user.pin_tries || 0) + 1;
          if (tries >= MAX_TRIES) {
            const until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
            await sql`update users set pin_tries = 0, locked_until = ${until} where id = ${user.id}`;
            return res.status(429).json({ ok: false, locked: true, error: lockMessage(until) });
          }
          await sql`update users set pin_tries = ${tries} where id = ${user.id}`;
          return res.status(401).json({ ok: false, wrongPin: true, left: MAX_TRIES - tries,
            error: 'That PIN is not right. ' + (MAX_TRIES - tries) + ' ' + (MAX_TRIES - tries === 1 ? 'try' : 'tries') + ' left.' });
        }
        if (user.pin_tries) await sql`update users set pin_tries = 0, locked_until = null where id = ${user.id}`;
      }
    }

    // Signed in. From here the token is what proves who this is; the member
    // UUIDs the app receives are addresses, not credentials.
    const token = newToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await sql`insert into sessions (token_hash, user_id, device, expires_at)
              values (${tokenHash(token)}, ${user.id}, ${String(body.device || '').slice(0, 80) || null}, ${expires})`;
    // Old sessions are pruned opportunistically, so the table does not grow
    // for ever on a deployment nobody is running a cron against.
    try { await sql`delete from sessions where expires_at < now()`; } catch (e) {}

    const circles = await circlesOf(sql, user.id);
    // Anything the family has been asked to approve for someone else.
    let resets = [];
    try {
      resets = await sql`select r.id, u.name from pin_resets r
                         join users u on u.id = r.user_id
                         join members m on m.circle_id = r.circle_id and m.user_id = ${user.id}
                         where r.status = 'pending' and r.user_id <> ${user.id}`;
    } catch (e) { resets = []; }
    return res.status(200).json({ ok: true, exists: true, token,
      user: { id: user.id, name: user.name, phone: user.phone },
      toured: !!user.toured_at, circles, pinResets: resets });
  } catch (e) {
    return fail(res, e);
  }
}
