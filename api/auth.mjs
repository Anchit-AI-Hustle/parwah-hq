// Sign-in: a mobile number and a 4-number PIN. No text message is ever sent
// (the owner's decision), so the family is the way back in.
//   POST /api/auth {action:'enter', phone, pin}            sign in
//   POST /api/auth {action:'enter', phone, name, pin}      "I am new here"
// A name means "make my profile". Without one it is a sign-in, and the reply
// to a number nobody has is the same as to one with an account: asked for a
// PIN, told the number and PIN do not match, locked after five tries. Nothing
// here says whether a number is registered. The rest of the account (devices,
// "Not me", recovery contact, download, delete) is in api/_account.mjs.
import { db, ensureSchema, isUuid, normPhone, phoneError, rateLimit, clientIp, sessionUser, sessionIs } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { pushCircle } from './_push.mjs';
import { pinError, hashPin, verifyPin, newToken, tokenHash, looksLikeToken, SECRET_V } from './_auth.mjs';
import { ensureStandingSchema, ACCOUNT_ACTIONS, accountAction, securityFor, deviceHashOf, uaOf, padTo, sayCode,
         lockKey, pinGate, lockReply, wrongReply, isKnownDevice, lockNotice, startSession, resetApprovers,
         vetoUntilFor, pushUser, logEvent, finalizeAccount } from './_account.mjs';
import { tokenOf } from './_token.mjs';
import { joinError, joinRow, joinedMessage, isBot, proofCounts } from './_waitlist.mjs';
import { cleanName, nameError } from './_valid.mjs';

// Every circle this number belongs to, each carrying what is waiting in it.
// A person in three families should be able to see, before opening any of
// them, which one actually needs them - that is the whole point of the list.
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

// HOW LONG A PIN RESET STAYS OPEN, asked or approved: long enough to ring
// someone in the family, short enough that a yes cannot be found and used
// later by somebody else.
const RESET_MINUTES = 15;
// A wrong two-number code this many times ends the request: the code is
// there to force a real call, not to be guessed.
const CODE_TRIES = 5;

// Requests I may say yes to, waiting for someone. Only an adult in a FAMILY
// the person belongs to, or the recovery contact they chose, is shown one.
// The same list on sign-in and on the background refresh: the refresh is
// what a family member's open app actually runs, so a list sent only at
// sign-in reached nobody.
async function resetsFor(sql, userId) {
  try {
    const rows = await sql`select distinct r.id, r.user_id, u.name from pin_resets r
                           join users u on u.id = r.user_id
                           where r.status = 'pending' and r.user_id <> ${userId}
                             and (r.expires_at is null or r.expires_at > now())
                             and (u.recovery_user = ${userId}
                               or exists (select 1 from members a join members b on b.circle_id = a.circle_id
                                          where a.user_id = r.user_id and b.user_id = ${userId}))`;
    const out = [];
    for (const r of rows) {
      const who = await resetApprovers(sql, r.user_id);
      if (who.some(w => w.user_id === userId)) out.push({ id: r.id, name: r.name });
    }
    return out;
  } catch (e) { return []; }
}

// WHAT THE PRIVACY PAGE PROMISES, KEPT IN CODE. A launch list entry goes 24
// months after it was last joined or changed, and the counters that stop
// one device flooding the list (they hold its internet address) go after a
// day. Run on the list's own traffic, so it needs no scheduler of its own.
async function purgeWaitlist(sql) {
  await sql`delete from waitlist where updated_at < now() - interval '24 months'`;
  await sql`delete from rate_limit where bucket = 'waitlist' and window_start < now() - interval '1 day'`;
}

// pending, holding, approved, denied or expired: what one reset request is
// now. 'holding' is a yes that is waiting out the ten minutes in which the
// owner's own signed-in phones can stop it.
function resetState(r) {
  if (!r) return 'expired';
  if (r.status === 'denied') return 'denied';
  if (r.status !== 'pending' && r.status !== 'approved') return 'expired';
  if (r.expires_at && new Date(r.expires_at) <= new Date()) return 'expired';
  if (r.status === 'approved' && r.veto_until && new Date(r.veto_until) > new Date()) return 'holding';
  return r.status;
}
function holdSeconds(r) {
  return r && r.veto_until ? Math.max(1, Math.ceil((new Date(r.veto_until) - Date.now()) / 1000)) : 0;
}

export default async function handler(req, res) {
  // THE PROOF ON THE HOME PAGE: two counts, read from the real tables so the
  // page never has to make a number up. A GET, so the CDN can hold the
  // answer for ten minutes and a busy day costs the database one query in
  // ten minutes rather than one per visitor. Counts only: no name, no row.
  if (req.method === 'GET' && req.query && req.query.stats === 'proof') {
    // No ensureSchema here: on a cold instance it is dozens of statements,
    // and the page gives up waiting long before that. A table that is not
    // there yet is an error, and an error shows the marked sample.
    try {
      const sql = db();
      await purgeWaitlist(sql);
      const w = await sql`select count(*)::int as n from waitlist where consent`;
      const u = await sql`select count(*)::int as n from users`;
      const counts = proofCounts(w[0] && w[0].n, u[0] && u[0].n);
      if (!counts) return res.status(503).json({ ok: false, error: 'No count right now' });
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      return res.status(200).json({ ok: true, ...counts });
    } catch (e) { return res.status(503).json({ ok: false, error: 'No count right now' }); }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureStandingSchema(sql); }
  catch (e) { return failDb(res, e); }

  try {
    const body = req.body || {};
    const t0 = Date.now();
    // A number and a 4-number PIN are the whole key (no text message), so
    // the number of tries from one device is capped.
    // A SIGN-IN ATTEMPT AND A BACKGROUND REFRESH ARE NOT THE SAME EVENT. The
    // app re-reads the circle list for a number it already holds every 60
    // seconds, and that spent the sign-in budget: three phones in one house,
    // on one connection, locked the household out of signing in at all.
    //
    // Typing a number is still capped per device. A refresh for a number the
    // caller already has is capped per NUMBER, generously, which no attacker
    // can use to work through other people's numbers.
    // THE LAUNCH LIST. It lives here because this is the front door: the
    // route a person reaches before they have an account. It is not its own
    // function because the Hobby plan allows twelve and eleven are spent, and
    // the twelfth is worth more held in reserve than spent on one insert.
    if (body.action === 'waitlist') {
      // One device, six joins an hour. Generous for a family filling it in
      // together on one connection, useless for stuffing the list.
      const allowed = await rateLimit(sql, 'waitlist', clientIp(req), 6, 3600);
      if (!allowed) {
        return res.status(429).json({ ok: false, error: 'That is a lot of sign-ups from one device - please try again in a little while' });
      }
      // A bot is told what a person would be told, and nothing is stored.
      if (isBot(body)) return res.status(200).json({ ok: true, message: joinedMessage(body.interest) });
      const bad = joinError(body);
      if (bad) return res.status(400).json({ ok: false, error: bad });
      const row = joinRow(body);
      // Joining twice is not an error, it is someone correcting a typo or
      // changing their mind about which half they want. Last answer wins,
      // except consent, which can be given but never silently withdrawn by
      // a later form - withdrawing is a request to a person, not a checkbox.
      await sql`
        insert into waitlist (name, email, phone, city, interest, consent, consent_at, source,
                              utm_source, utm_medium, utm_campaign, ref)
        values (${row.name}, ${row.email}, ${row.phone}, ${row.city}, ${row.interest}, ${row.consent},
                case when ${row.consent} then now() end, ${row.source},
                ${row.utm_source}, ${row.utm_medium}, ${row.utm_campaign}, ${row.ref})
        on conflict (lower(email)) do update set
          name = excluded.name,
          phone = coalesce(excluded.phone, waitlist.phone),
          city = coalesce(excluded.city, waitlist.city),
          interest = excluded.interest,
          -- First touch is kept: the link that first brought a person here
          -- is the one that earned the join, not the one they came back by.
          utm_source = coalesce(waitlist.utm_source, excluded.utm_source),
          utm_medium = coalesce(waitlist.utm_medium, excluded.utm_medium),
          utm_campaign = coalesce(waitlist.utm_campaign, excluded.utm_campaign),
          ref = coalesce(waitlist.ref, excluded.ref),
          consent = waitlist.consent or excluded.consent,
          -- A row that said yes before the time was recorded keeps no time
          -- rather than gaining today's, which would misstate when it said yes.
          consent_at = case when waitlist.consent then waitlist.consent_at
                            else coalesce(waitlist.consent_at, excluded.consent_at) end,
          updated_at = now()`;
      await purgeWaitlist(sql);
      // The same answer whether the row was new or not. See joinedMessage.
      return res.status(200).json({ ok: true, message: joinedMessage(row.interest) });
    }

    if (body.action === 'enter') {
      if (body.refresh === true) {
        const key = String(body.phone || '').replace(/\D/g, '').slice(-12) || clientIp(req);
        const allowed = await rateLimit(sql, 'authrefresh', key, 60, 600);
        if (!allowed) return res.status(429).json({ ok: false, error: 'Refreshing too often - please wait a moment' });
      } else {
        const allowed = await rateLimit(sql, 'auth', clientIp(req), 25, 600);
        if (!allowed) return res.status(429).json({ ok: false, error: 'Too many sign-in attempts from this device - please wait a few minutes' });
      }
    }

    if (body.action === 'update') {
      if (!isUuid(body.userId)) return res.status(403).json({ ok: false, error: 'Sign in first' });
      if (!(await sessionIs(sql, tokenOf(req), body.userId))) return res.status(401).json({ ok: false, signin: true, error: 'Please sign in again' });
      const u = await sql`select id, name, phone from users where id = ${body.userId}`;
      if (!u[0]) return res.status(404).json({ ok: false, error: 'Profile not found' });
      const newName = cleanName(body.name).slice(0, 60) || u[0].name;
      if (cleanName(body.name) && nameError(newName)) return res.status(400).json({ ok: false, error: nameError(newName) });
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
      if (!(await sessionIs(sql, tokenOf(req), body.userId))) return res.status(401).json({ ok: false, signin: true, error: 'Please sign in again' });
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
      const u = await sessionUser(sql, body.token || tokenOf(req));
      if (!u) return res.status(401).json({ ok: false, error: 'Please sign in again' });
      await sql`delete from sessions where user_id = ${u.user_id}`;
      await logEvent(sql, u.user_id, 'device', 'You signed out of every phone.');
      return res.status(200).json({ ok: true });
    }
    // Devices, "Not me", my activity, recovery contact, download, delete:
    // each needs a session, and lives in api/_account.mjs.
    if (ACCOUNT_ACTIONS.includes(body.action)) {
      const out = await accountAction(sql, req, body, body.token || tokenOf(req));
      return res.status(out.status).json(out.json);
    }
    // FORGOTTEN THE PIN, WITH NO SMS TO FALL BACK ON. Someone already in
    // your family vouches for you. They know your face and your voice,
    // which is a better check than a text message to a number that may be
    // the very thing that was lost.
    if (body.action === 'reset_request') {
      const npr = normPhone(body.phone, body.cc);
      if (!npr) return res.status(400).json({ ok: false, error: phoneError(body.cc) });
      if (!(await rateLimit(sql, 'pinreset', npr.e164, 3, 3600))) {
        return res.status(429).json({ ok: false, error: 'A request is already waiting. Ask your family to open Parwah and approve it.' });
      }
      // The secret and the two-number code go back to this device only.
      // Every reply carries both and looks the same, for a number with no
      // account, one with no family, and one with a family: it says nothing about
      // whether a number is registered.
      const secret = newToken(), code2 = sayCode();
      const same = { ok: true, asked: true, resetSecret: secret, sayCode: code2, expiresInMinutes: RESET_MINUTES };
      const ur = await sql`select id, name from users where phone = ${npr.e164}`;
      const who = ur[0] ? await resetApprovers(sql, ur[0].id) : [];
      if (!ur[0] || !who.length) { await padTo(t0, 500); return res.status(200).json(same); }
      const until = new Date(Date.now() + RESET_MINUTES * 60000).toISOString();
      // The owner's own signed-in phones get ten minutes to say "not me".
      const veto = await vetoUntilFor(sql, ur[0].id);
      const home = who.find(w => w.circle_id) || {};
      // One open request per person. Asking again replaces the secret and
      // the code, so only the device that asked last can use the yes.
      const again = await sql`update pin_resets set secret_hash = ${tokenHash(secret)}, say_code = ${code2}, code_tries = 0,
                                expires_at = ${until}, veto_until = ${veto}, circle_id = ${home.circle_id || null}, created_at = now()
                              where user_id = ${ur[0].id} and status = 'pending' returning id`;
      if (!again[0]) {
        try {
          await sql`insert into pin_resets (user_id, circle_id, secret_hash, say_code, expires_at, veto_until)
                    values (${ur[0].id}, ${home.circle_id || null}, ${tokenHash(secret)}, ${code2}, ${until}, ${veto})`;
        } catch (e) {
          // Two taps at once: the other one made the row, so update it.
          await sql`update pin_resets set secret_hash = ${tokenHash(secret)}, say_code = ${code2}, code_tries = 0, expires_at = ${until}, veto_until = ${veto}
                    where user_id = ${ur[0].id} and status = 'pending'`;
        }
      }
      // Only the people who can say yes are told, never a whole group.
      for (const w of who) {
        if (!w.circle_id || !w.member_id) continue;
        await pushCircle(sql, w.circle_id,
          { title: '🔑 ' + ur[0].name + ' cannot get in', body: 'They have asked to be let back in. Call them, ask for the two numbers on their screen, then open Parwah.' },
          { only: w.member_id });
      }
      await logEvent(sql, ur[0].id, 'reset', 'Someone asked the family to reset your PIN.');
      await pushUser(sql, ur[0].id, { title: '🔑 Someone asked to reset your PIN', body: 'Was this you? If not, open Parwah and tap "Not me" to stop it.', url: '/#home' });
      await padTo(t0, 500);
      return res.status(200).json(same);
    }
    // The waiting screen asks whether the family has said yes yet.
    if (body.action === 'reset_status') {
      const npr = normPhone(body.phone, body.cc);
      if (!npr || !looksLikeToken(body.resetSecret)) return res.status(400).json({ ok: false, error: 'Bad request' });
      const r = await sql`select r.status, r.expires_at, r.decided_at, r.veto_until from pin_resets r join users u on u.id = r.user_id
                          where u.phone = ${npr.e164} and r.secret_hash = ${tokenHash(body.resetSecret)}
                          order by r.created_at desc limit 1`;
      const st = resetState(r[0]);
      return res.status(200).json({ ok: true, reset: st, readyInSeconds: st === 'holding' ? holdSeconds(r[0]) : undefined });
    }
    // An adult in one of their families (or their recovery contact) says
    // yes, with the two numbers the asking phone shows, and only then may
    // the device that asked choose a new PIN.
    if (body.action === 'reset_approve' || body.action === 'reset_deny') {
      const approver = await sessionUser(sql, body.token || tokenOf(req));
      if (!approver) return res.status(401).json({ ok: false, error: 'Please sign in again' });
      if (!isUuid(body.resetId)) return res.status(400).json({ ok: false, error: 'Bad request' });
      const r = await sql`select id, user_id, circle_id, status, expires_at, say_code, code_tries, veto_until from pin_resets where id = ${body.resetId}`;
      if (!r[0] || r[0].status !== 'pending') return res.status(404).json({ ok: false, error: 'That request is already decided' });
      if (r[0].expires_at && new Date(r[0].expires_at) <= new Date()) {
        return res.status(404).json({ ok: false, error: 'That request has run out. They can ask again.' });
      }
      if (r[0].user_id === approver.user_id) return res.status(403).json({ ok: false, error: 'Someone else in the family has to approve this, not you' });
      const who = (await resetApprovers(sql, r[0].user_id)).find(w => w.user_id === approver.user_id);
      if (!who) return res.status(403).json({ ok: false, error: 'Only a grown-up in their family, or the person they chose, can decide this' });
      const status = body.action === 'reset_approve' ? 'approved' : 'denied';
      // Not knowing someone's age is a no for this one door. It is theirs
      // to fix in a minute, so the person waiting is not left stuck.
      if (status === 'approved' && !who.sure) {
        return res.status(403).json({ ok: false, needDob: true,
          error: 'First add your date of birth in your profile, so Parwah knows a grown-up is saying yes. Then come back and let them in.' });
      }
      if (status === 'approved') {
        // The two numbers are on the asking phone only, so a yes needs a
        // real call. A few wrong tries end the request.
        if (String(body.sayCode || '').trim() !== String(r[0].say_code || '')) {
          const t = await sql`update pin_resets set code_tries = code_tries + 1 where id = ${r[0].id} and status = 'pending' returning code_tries`;
          if (t[0] && t[0].code_tries >= CODE_TRIES) {
            await sql`update pin_resets set status = 'denied', decided_at = now() where id = ${r[0].id} and status = 'pending'`;
            return res.status(404).json({ ok: false, error: 'Too many wrong codes. They can ask again.' });
          }
          return res.status(400).json({ ok: false, wrongCode: true, error: 'Those are not the two numbers on their screen. Call them and ask.' });
        }
      }
      // The yes opens a fresh window: the device that asked has that long
      // to choose its new PIN, counted from when the ten minutes end.
      const from = Math.max(Date.now(), r[0].veto_until ? new Date(r[0].veto_until).getTime() : 0);
      const until = new Date(from + RESET_MINUTES * 60000).toISOString();
      const done = await sql`update pin_resets set status = ${status}, decided_by = ${who.member_id}, decided_at = now(), expires_at = ${until}
                             where id = ${r[0].id} and status = 'pending' returning id`;
      if (!done[0]) return res.status(404).json({ ok: false, error: 'That request is already decided' });
      if (status === 'approved') {
        await logEvent(sql, r[0].user_id, 'reset', approver.name + ' said yes to resetting your PIN.');
        await pushUser(sql, r[0].user_id, { title: '🔑 ' + approver.name + ' said yes to a new PIN for you', body: 'Was this you? If not, open Parwah and tap "Not me" to stop it.', url: '/#home' });
      }
      return res.status(200).json({ ok: true, status });
    }

    if (body.action !== 'enter') return res.status(400).json({ ok: false, error: 'Unknown action' });
    const np = normPhone(body.phone, body.cc);
    if (!np) return res.status(400).json({ ok: false, error: phoneError(body.cc) });
    const phone = np.e164;
    const COLS = sql`select id, name, phone, toured_at, pin_hash, pin_salt, secret_v, must_change_pin, delete_at from users where phone = ${phone}`;
    let rows = await COLS;
    // An account whose 7 days have passed is gone before anyone signs in.
    if (rows[0] && rows[0].delete_at && new Date(rows[0].delete_at) <= new Date()) {
      await finalizeAccount(sql, rows[0].id);
      rows = [];
    }
    let user = rows[0] || null;
    const deviceHash = deviceHashOf(body.deviceId), ua = uaOf(req);
    const signedIn = async (extra = {}, opts = {}) => {
      const s = await startSession(sql, user, { device: body.device, deviceHash, ua, ...opts });
      const circles = await circlesOf(sql, user.id);
      return res.status(200).json({ ok: true, exists: true, token: s.token,
        user: { id: user.id, name: user.name, phone: user.phone },
        toured: !!user.toured_at, circles, pinResets: await resetsFor(sql, user.id),
        security: await securityFor(sql, user.id, s.token), ...extra });
    };

    // A BACKGROUND REFRESH FROM A DEVICE ALREADY SIGNED IN. The app re-reads
    // the circle list for the number it holds; it has no PIN to send, and
    // must not need one. Its session token says who it is.
    if (user && body.refresh === true) {
      const su = await sessionUser(sql, tokenOf(req));
      if (su && su.user_id === user.id) {
        const circles = await circlesOf(sql, user.id);
        return res.status(200).json({ ok: true, exists: true,
          user: { id: user.id, name: user.name, phone: user.phone },
          toured: !!user.toured_at, circles, pinResets: await resetsFor(sql, user.id),
          security: await securityFor(sql, user.id, tokenOf(req)),
          // An older PIN or a password, or a "Not me" on a new sign-in:
          // the app asks for a new 4-number PIN.
          changeSecret: !user.pin_hash || user.secret_v !== SECRET_V || !!user.must_change_pin,
          mustChange: !!user.must_change_pin });
      }
    }

    // LET BACK IN BY THE FAMILY. The device that asked shows its secret and
    // the new PIN together. Nothing else gets past the PIN: not the number,
    // not a yes from the family on its own. A number with no account gets
    // the same words as a request that ran out.
    if (body.resetSecret != null) {
      const r = user && looksLikeToken(body.resetSecret)
        ? await sql`select id, status, expires_at, decided_at, veto_until from pin_resets
                    where user_id = ${user.id} and secret_hash = ${tokenHash(body.resetSecret)}
                    order by created_at desc limit 1`
        : [];
      const state = resetState(r[0]);
      if (state !== 'approved') {
        return res.status(200).json({ ok: true, exists: true, reset: state,
          readyInSeconds: state === 'holding' ? holdSeconds(r[0]) : undefined,
          error: state === 'pending' ? 'Your family has not said yes yet.'
            : state === 'holding' ? 'Your family said yes. For safety, the new PIN can be chosen in a few minutes.'
            : state === 'denied' ? 'Your family said no to this request.'
            : 'That request has run out. Please ask your family again.' });
      }
      const perr = pinError(body.newPin);
      if (perr) return res.status(200).json({ ok: true, exists: true, reset: 'approved', setPin: true, error: body.newPin ? perr : null });
      // Used once: claimed before the PIN is written, so two devices with
      // the same secret cannot both get in.
      const used = await sql`update pin_resets set status = 'used' where id = ${r[0].id} and status = 'approved' returning id`;
      if (!used[0]) return res.status(200).json({ ok: true, exists: true, reset: 'expired', error: 'That request has run out. Please ask your family again.' });
      const h = hashPin(body.newPin);
      await sql`update users set pin_hash = ${h.hash}, pin_salt = ${h.salt}, pin_set_at = now(),
                pin_tries = 0, locked_until = null, secret_v = ${SECRET_V}, must_change_pin = false where id = ${user.id}`;
      // A lost phone stays signed in no longer, and no old lock is kept.
      await sql`delete from sessions where user_id = ${user.id}`;
      await sql`delete from pin_locks where k = ${lockKey(phone, null)}`;
      await logEvent(sql, user.id, 'reset', 'Your PIN was reset with a yes from your family. Every phone was signed out.');
      return signedIn({}, { quiet: true });
    }

    // WHAT WAS TYPED IS CHECKED BEFORE THE NUMBER IS LOOKED AT, so these
    // replies are the same for a number that has an account and one that
    // does not. A name means "I am new here"; no name means "sign me in".
    const name = cleanName(body.name).slice(0, 60);
    const registering = !!name;
    if (registering) {
      const nerr = nameError(name, 'name');
      if (nerr) return res.status(200).json({ ok: true, exists: false, badName: true, error: nerr });
      // A new person chooses a PIN in the same breath as their name. Making
      // it a later, skippable step is how an account ends up with none.
      const perr = pinError(body.pin);
      if (perr) return res.status(200).json({ ok: true, exists: false, needPin: true, error: perr });
    }
    // An account made before PINs existed, in no family that could vouch
    // for it: it chooses its first PIN here, as it always has. One that
    // belongs to a family goes through "ask my family" instead, so whoever
    // types the number first can no longer take it.
    const pinless = !!user && !user.pin_hash;
    const vouched = pinless ? (await resetApprovers(sql, user.id)).length > 0 : false;
    if (pinless && !vouched) {
      const perr = pinError(body.pin);
      if (perr) return res.status(200).json({ ok: true, exists: true, setPin: true, error: body.pin ? perr : null });
      const h = hashPin(body.pin);
      await sql`update users set pin_hash = ${h.hash}, pin_salt = ${h.salt}, pin_set_at = now(),
                pin_tries = 0, locked_until = null, secret_v = ${SECRET_V} where id = ${user.id}`;
      return signedIn();
    }
    // The number alone: every number is asked for its PIN, in the same
    // words. Nothing here says whose it is, or whether it is anyone's.
    if (!registering && !body.pin) {
      return res.status(200).json({ ok: true, exists: true, needPin: true, older: false });
    }

    // NEW HERE, and the number is free: the profile is made.
    if (!user && registering) {
      // Each new profile from one address is counted: making accounts is
      // the one way left to learn which numbers are free.
      if (!(await rateLimit(sql, 'signup', clientIp(req), 10, 3600))) {
        return res.status(429).json({ ok: false, error: 'Too many new profiles from this device. Please try again in an hour.' });
      }
      const h = hashPin(body.pin);
      let made = [];
      try {
        made = await sql`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v)
                         values (${phone}, ${np.cc}, ${np.local}, ${name}, ${h.hash}, ${h.salt}, now(), ${SECRET_V})
                         returning id, name, phone, toured_at, pin_hash, pin_salt, secret_v, must_change_pin, delete_at`;
      } catch (e) { /* raced with another sign-up for the same number: checked as a sign-in below */ }
      if (made[0]) { user = made[0]; return signedIn({}, { quiet: true }); }
      user = (await sql`select id, name, phone, toured_at, pin_hash, pin_salt, secret_v, must_change_pin, delete_at from users where phone = ${phone}`)[0] || null;
    }

    // THE PIN. One path for a number with an account and one without: the
    // same count, the same lock, the same words, and the same slow hash, so
    // neither the reply nor how long it took says which it was.
    const trusted = user ? await isKnownDevice(sql, user.id, deviceHash) : false;
    const key = lockKey(phone, trusted ? deviceHash : null);
    const g = await pinGate(sql, key, () => {
      if (!user || !user.pin_hash) { hashPin(String(body.pin || ''), '00'); return false; }
      return verifyPin(body.pin, user.pin_salt, user.pin_hash);
    });
    if (g.locked) {
      if (g.lockedNow && user) await lockNotice(sql, user, g.minutes, trusted);
      if (g.lockedNow) await padTo(t0, 400);
      const out = lockReply(g.until);
      return res.status(out.status).json(out.json);
    }
    if (g.wrong) { const out = wrongReply(g.left); return res.status(out.status).json(out.json); }

    // An older PIN or password has just proved who this is, once; or the
    // owner said "Not me" to a new sign-in. Before any session is issued,
    // they choose a 4-number PIN; the old secret has to come with it, so
    // this cannot be skipped.
    if (user.secret_v !== SECRET_V || user.must_change_pin) {
      if (body.newPin == null || body.newPin === '') {
        return res.status(200).json({ ok: true, exists: true, changeSecret: true, mustChange: !!user.must_change_pin, name: user.name });
      }
      let nerr = pinError(body.newPin);
      if (!nerr && user.must_change_pin && String(body.newPin) === String(body.pin)) nerr = 'Choose a different PIN from the one you had.';
      if (nerr) return res.status(200).json({ ok: true, exists: true, changeSecret: true, mustChange: !!user.must_change_pin, name: user.name, error: nerr });
      const h = hashPin(body.newPin);
      await sql`update users set pin_hash = ${h.hash}, pin_salt = ${h.salt}, pin_set_at = now(),
                pin_tries = 0, locked_until = null, secret_v = ${SECRET_V}, must_change_pin = false where id = ${user.id}`;
      // After "Not me", whoever else was signed in is signed out.
      if (user.must_change_pin) await sql`delete from sessions where user_id = ${user.id}`;
      await logEvent(sql, user.id, 'pin', 'You chose a new PIN.');
      return signedIn({}, { quiet: !!user.must_change_pin });
    }

    // Signed in. From here the token is what proves who this is; the member
    // UUIDs the app receives are addresses, not credentials.
    return signedIn();
  } catch (e) {
    return fail(res, e);
  }
}
