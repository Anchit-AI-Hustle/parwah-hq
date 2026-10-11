// FIND A PHONE: ring it, and Lost mode. Like Find My, without a new app.
//
// Both are actions on the location endpoint (POST /api/settings?area=location)
// and both are read with the family's state (GET /api/events, as `findme`), so
// every open Parwah hears within one poll, on any screen.
//
//   ring      {targetId}  Anyone in the family rings anyone on Parwah, their
//                         own phone too. Once a minute per pair. Their phones
//                         get a notification and, with Parwah open, ring out
//                         loud for RING_SECONDS or until "I found it".
//   found                 Stops the ringing, on every phone of that person.
//   lost_on   {message?, callId?}
//                         ONLY the person themselves. Every OTHER phone signed
//                         in as them shows a full screen: their message, a
//                         button to call someone in the family, and it shares
//                         its exact location with the family. The phone they
//                         turned it on from is the one in their hand, so it
//                         does not lock.
//   lost_off  {pin}       Their own 4-digit PIN, counted against the same five
//                         tries as signing in, so a finder cannot try PINs here
//                         instead.
// While Lost mode is on, location sharing cannot be stopped, blurred or given
// an end time, the same way an open SOS holds it.
import { tokenHash, verifyPin, MAX_TRIES, LOCK_MINUTES, lockMessage } from './_auth.mjs';
import { rateLimit } from './_db.mjs';
import { pushCircle } from './_push.mjs';

export const RING_SECONDS = 120;
export const LOST_MSG_MAX = 160;
export const LOST_LOCK_MSG = 'Lost mode is on for your phone, so your family can see exactly where it is. ' +
  'Sharing stays on until you turn Lost mode off with your PIN.';

let ready = false;
export async function ensureFindSchema(sql) {
  if (ready) return;
  await sql`create table if not exists find_ring (
    member_id uuid primary key references members(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    rang_at timestamptz not null default now()
  )`;
  await sql`alter table users add column if not exists lost_at timestamptz`;
  await sql`alter table users add column if not exists lost_msg text`;
  await sql`alter table users add column if not exists lost_session text`;
  await sql`alter table users add column if not exists lost_circle uuid`;
  await sql`alter table users add column if not exists lost_call uuid`;
  ready = true;
}

// A message for whoever finds the phone: plain words, one short line.
export function lostMessage(v) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > LOST_MSG_MAX) return { error: 'Keep the message to ' + LOST_MSG_MAX + ' letters - a finder reads it at a glance.' };
  return { text: s || 'This phone is lost. Please call my family using the button below.' };
}

export async function isLost(sql, userId) {
  if (!userId) return false;
  await ensureFindSchema(sql);
  const r = await sql`select lost_at from users where id = ${userId}`;
  return !!(r[0] && r[0].lost_at);
}

// What this phone should show: a ring for its person, Lost mode (on every
// phone of theirs except the one that turned it on), and who in the family
// has Lost mode on.
export async function findState(sql, circle, me, token) {
  await ensureFindSchema(sql);
  const ring = (await sql`select r.rang_at, m.name as by_name from find_ring r left join members m on m.id = r.by_member
                          where r.member_id = ${me.id} and r.rang_at > now() - make_interval(secs => ${RING_SECONDS})`)[0];
  let lost = null, lostHere = false;
  if (me.user_id) {
    const u = (await sql`select lost_at, lost_msg, lost_session, lost_circle, lost_call from users where id = ${me.user_id}`)[0];
    if (u && u.lost_at) {
      const here = !!token && u.lost_session === tokenHash(token);
      if (here) lostHere = true;
      else {
        const call = u.lost_call
          ? (await sql`select name, phone from members where id = ${u.lost_call} and phone is not null`)[0] : null;
        lost = { since: u.lost_at, message: u.lost_msg, call: call ? { name: call.name, phone: call.phone } : null };
      }
    }
  }
  const lostMembers = (await sql`select m.id from members m join users u on u.id = m.user_id
                                 where m.circle_id = ${circle.id} and u.lost_at is not null`).map(r => r.id);
  return { ring: ring ? { at: ring.rang_at, by: ring.by_name } : null, lost, lostHere, lostMembers };
}

async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'location', ${text})`;
}

// Returns a response object { status, json } for the find actions, or null if
// the action is not one of them.
export async function findAction(sql, circle, me, body, token) {
  const action = body.action;
  if (!['ring', 'found', 'lost_on', 'lost_off'].includes(action)) return null;
  await ensureFindSchema(sql);
  const fam = circle.kind === 'group' ? 'group' : 'family';

  if (action === 'ring') {
    const t = (await sql`select id, name, user_id from members where id = ${String(body.targetId || '')}::uuid and circle_id = ${circle.id}`
      .catch(() => []))[0];
    if (!t) return { status: 404, json: { ok: false, error: 'That person is not in this ' + fam } };
    if (!t.user_id) return { status: 400, json: { ok: false, error: t.name + ' is not on Parwah, so their phone cannot ring from here. A call might help.' } };
    if (!(await rateLimit(sql, 'findring', me.id + ':' + t.id, 1, 60))) {
      return { status: 429, json: { ok: false, error: 'It is already ringing - give it a minute before ringing again' } };
    }
    await sql`insert into find_ring (member_id, circle_id, by_member, rang_at) values (${t.id}, ${circle.id}, ${me.id}, now())
              on conflict (member_id) do update set by_member = ${me.id}, rang_at = now(), circle_id = ${circle.id}`;
    const self = t.id === me.id;
    await feed(sql, circle.id, me.id, self ? `🔔 ${me.name} rang their own phone to find it` : `🔔 ${me.name} rang ${t.name}'s phone to find it`);
    await pushCircle(sql, circle.id, {
      title: '🔔 ' + (self ? 'You are' : me.name + ' is') + ' looking for this phone',
      body: 'Open Parwah and tap I found it', url: '/#home', ring: true
    }, { only: t.id });
    return { status: 200, json: { ok: true, rang: t.name, seconds: RING_SECONDS } };
  }

  if (action === 'found') {
    await sql`delete from find_ring where member_id = ${me.id}`;
    return { status: 200, json: { ok: true } };
  }

  if (!me.user_id) return { status: 400, json: { ok: false, error: 'Sign in to use Lost mode' } };

  if (action === 'lost_on') {
    const m = lostMessage(body.message);
    if (m.error) return { status: 400, json: { ok: false, error: m.error, field: 'message' } };
    let call = null;
    if (body.callId) {
      call = (await sql`select id from members where id = ${String(body.callId)}::uuid and circle_id = ${circle.id}
                          and id <> ${me.id} and phone is not null`.catch(() => []))[0];
      if (!call) return { status: 400, json: { ok: false, error: 'Pick someone in the ' + fam + ' who has a phone number', field: 'call' } };
    } else {
      call = (await sql`select id from members where circle_id = ${circle.id} and id <> ${me.id} and phone is not null
                        order by (user_id is not null) desc, created_at limit 1`)[0] || null;
    }
    await sql`update users set lost_at = now(), lost_msg = ${m.text}, lost_session = ${token ? tokenHash(token) : null},
              lost_circle = ${circle.id}, lost_call = ${call ? call.id : null} where id = ${me.user_id}`;
    await feed(sql, circle.id, me.id, `📵 ${me.name} marked their phone as lost. If it is found, it shows how to reach the ${fam}.`);
    await pushCircle(sql, circle.id, { title: '📵 ' + me.name + ' has lost their phone',
      body: 'Its location shows in Parwah once it is back online', url: '/#people' }, { except: me.id });
    return { status: 200, json: { ok: true, lost: true } };
  }

  // lost_off: the same lockout as signing in, claimed before it is checked.
  const u = (await sql`select lost_at, pin_hash, pin_salt, locked_until from users where id = ${me.user_id}`)[0];
  if (!u || !u.lost_at) return { status: 200, json: { ok: true, lost: false } };
  if (!/^\d{4}$/.test(String(body.pin || ''))) return { status: 400, json: { ok: false, error: 'Type your 4-number PIN', field: 'pin' } };
  const claim = await sql`update users set pin_tries = pin_tries + 1
                          where id = ${me.user_id} and (locked_until is null or locked_until <= now()) returning pin_tries`;
  const lock = async () => {
    const until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    await sql`update users set pin_tries = 0, locked_until = ${until} where id = ${me.user_id} and (locked_until is null or locked_until <= now())`;
    const l = (await sql`select locked_until from users where id = ${me.user_id}`)[0];
    return { status: 429, json: { ok: false, locked: true, error: lockMessage((l && l.locked_until) || until) } };
  };
  if (!claim[0]) {
    const l = (await sql`select locked_until from users where id = ${me.user_id}`)[0];
    return { status: 429, json: { ok: false, locked: true, error: lockMessage(l && l.locked_until) } };
  }
  const tries = claim[0].pin_tries;
  if (tries > MAX_TRIES) return lock();
  if (!verifyPin(String(body.pin), u.pin_salt, u.pin_hash)) {
    if (tries >= MAX_TRIES) return lock();
    const left = MAX_TRIES - tries;
    return { status: 401, json: { ok: false, wrongPin: true, left, field: 'pin',
      error: 'That PIN is not right. ' + left + ' ' + (left === 1 ? 'try' : 'tries') + ' left.' } };
  }
  await sql`update users set lost_at = null, lost_msg = null, lost_session = null, lost_circle = null, lost_call = null,
            pin_tries = 0 where id = ${me.user_id}`;
  await feed(sql, circle.id, me.id, `📱 ${me.name} found their phone - Lost mode is off`);
  return { status: 200, json: { ok: true, lost: false } };
}
