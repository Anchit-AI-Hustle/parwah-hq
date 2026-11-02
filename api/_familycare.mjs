// FIVE FAMILY-CARE TOOLS, behind routes that already exist (the project is
// at its serverless-function cap, so nothing here is a route of its own):
//
//   /api/events POST type quiet_* / askfirst* / safeword_set / help_*
//   /api/events GET  -> familyCare: { quiet, askfirst, helps, safeWord }
//   /api/care   POST action lifecert_* / rota_*
//
// QUIET DAY. "If Papa hasn't said he's okay by 11, I want to know, without
// phoning him." The parent sets a check-in time themselves, or says yes on
// their own screen to a time the family asked for. At that time, if they
// have not said they are okay today, they get one gentle push; 30 minutes
// later the family gets one alert with a Call button. "I'm away until"
// pauses it. There is no scheduler: it fires while any family phone polls
// (GET /api/events) or the timer ticks, and each push is claimed by one
// conditional UPDATE (quiet_nudged_for / quiet_alerted_for = today), so it
// is sent once however many phones look at the same moment.
//
// ASK FAMILY FIRST. A parent being rushed to pay or share an OTP asks the
// family in one tap. Someone acknowledges ("I've seen it, calling you now");
// the parent reads the plain rules and can call 1930. Parwah never claims to
// spot a scam.
//
// PENSION LIFE CERTIFICATE. A yearly task with a checklist and the
// acknowledgement number. No face scan and no Aadhaar number, ever.
//
// CALL ROTA. A daily task that passes round the people who chose to be on
// it; skipping hands today to the next person, and a day nobody marked
// moves on by itself.
//
// HELP ME WITH MY PHONE. A screenshot and a few words to the family chat;
// one person says "I'm on it".
import { randomUUID } from 'node:crypto';
import { isUuid, rateLimit, schemaOnce, ensureCircleChat, requireMember } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { validTz, fromWall, dayIn, nextDue, localDate } from './_recur.mjs';
import { ensureTaskSchema, taskAction } from './_tasks.mjs';
import { safeImageUri } from './_sec.mjs';
import { tokenOf } from './_token.mjs';
import { validHHMM, validDay, addDays, quietPhase, quietFamilyText, QUIET_NUDGE, QUIET_GRACE_MIN, AWAY_MAX_DAYS,
         lifecertWindow, ackNoCheck, rotaNext, safeWordCheck, JEEVAN_SITE } from './_carerules.mjs';

const HOME_TZ = 'Asia/Kolkata';
const clip = (s, n) => { const t = String(s == null ? '' : s).trim().slice(0, n); return t || null; };
const first = (name) => String(name || '').split(' ')[0];

let fcReady = false;
export async function ensureFamilyCareSchema(sql) {
  if (fcReady) return;
  await schemaOnce(async () => {
    await sql`alter table members add column if not exists checkin_by text`;
    await sql`alter table members add column if not exists tz text`;
    await sql`alter table members add column if not exists quiet_alerted_for date`;
    await sql`alter table members add column if not exists quiet_nudged_for date`;
    await sql`alter table members add column if not exists away_until date`;
    await sql`alter table members add column if not exists checkin_ask text`;
    await sql`alter table members add column if not exists checkin_ask_by uuid references members(id) on delete set null`;
    await sql`create table if not exists askfirst (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      note text,
      status text not null default 'open',
      acked_by uuid references members(id) on delete set null,
      acked_at timestamptz,
      created_at timestamptz not null default now()
    )`;
    await sql`create index if not exists askfirst_circle on askfirst (circle_id, created_at desc)`;
    await sql`create table if not exists help_asks (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      note text,
      has_image boolean not null default false,
      status text not null default 'open',
      claimed_by uuid references members(id) on delete set null,
      claimed_at timestamptz,
      created_at timestamptz not null default now()
    )`;
    await sql`create index if not exists help_asks_circle on help_asks (circle_id, created_at desc)`;
    await sql`create table if not exists family_settings (
      circle_id uuid primary key references circles(id) on delete cascade,
      safe_word text,
      updated_by uuid references members(id) on delete set null,
      updated_at timestamptz not null default now()
    )`;
  });
  fcReady = true;
}

async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
}
async function chatSay(sql, circleId, memberId, text, kind = 'text') {
  try {
    const chatId = await ensureCircleChat(sql, circleId);
    await sql`insert into messages (chat_id, member_id, text, kind) values (${chatId}, ${memberId}, ${text}, ${kind})`;
  } catch (e) { /* the push still goes */ }
}
// One push to each of these people, nobody twice, never the skipped ones.
async function pushEach(sql, circleId, payload, skip) {
  const ms = await sql`select id from members where circle_id = ${circleId} and user_id is not null`;
  const no = new Set((skip || []).filter(Boolean));
  for (const m of ms) if (!no.has(m.id)) await pushCircle(sql, circleId, payload, { only: m.id });
}
async function memberIn(sql, circleId, id) {
  if (!isUuid(id)) return null;
  const r = await sql`select id, name, role, phone, gender, to_char(dob, 'YYYY-MM-DD') as dob, user_id is not null as on_app from members where id = ${id} and circle_id = ${circleId}`;
  return r[0] || null;
}
function tzOf(v) { return validTz(v) || HOME_TZ; }
function deadlineOf(today, hhmm, tz) {
  const [y, m, d] = today.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return fromWall({ y, m, d, h, mi, s: 0 }, tz);
}
function dayStart(today, tz) { const [y, m, d] = today.split('-').map(Number); return new Date(fromWall({ y, m, d, h: 0, mi: 0, s: 0 }, tz)); }

// When they said they were okay today: an "All is well" check-in, or a
// pulse answer. null when not yet.
async function okToday(sql, memberId, today, tz) {
  const r = await sql`select max(created_at) as at from events where member_id = ${memberId} and type = 'checkin' and created_at >= ${dayStart(today, tz)}`;
  if (r[0] && r[0].at) return r[0].at;
  try {
    const p = await sql`select at from pulse where member_id = ${memberId} and day = ${today} limit 1`;
    if (p[0]) return p[0].at;
  } catch (e) { /* no pulse table yet */ }
  return null;
}

// ---------------- quiet day: the sweep ----------------
export async function quietSweep(sql, circleId, nowMs = Date.now()) {
  await ensureFamilyCareSchema(sql);
  const ms = await sql`select id, name, gender, phone, checkin_by, tz,
                              to_char(away_until, 'YYYY-MM-DD') as away_until,
                              to_char(quiet_nudged_for, 'YYYY-MM-DD') as nudged,
                              to_char(quiet_alerted_for, 'YYYY-MM-DD') as alerted
                       from members where circle_id = ${circleId} and checkin_by is not null and user_id is not null`;
  let sent = 0;
  for (const m of ms) {
    const by = validHHMM(m.checkin_by); if (!by) continue;
    const tz = tzOf(m.tz), today = dayIn(tz, nowMs), deadline = deadlineOf(today, by, tz);
    if (m.away_until && m.away_until >= today) continue;
    if (nowMs < deadline) continue;
    if (m.nudged === today && m.alerted === today) continue;
    if (await okToday(sql, m.id, today, tz)) continue;
    if (m.nudged !== today) {
      const c = await sql`update members set quiet_nudged_for = ${today}
                          where id = ${m.id} and checkin_by is not null and quiet_nudged_for is distinct from ${today}::date returning id`;
      if (c[0]) { sent++; await pushCircle(sql, circleId, { ...QUIET_NUDGE, url: '/#home' }, { only: m.id }); }
    }
    if (nowMs >= deadline + QUIET_GRACE_MIN * 60000 && m.alerted !== today) {
      const c = await sql`update members set quiet_alerted_for = ${today}
                          where id = ${m.id} and checkin_by is not null and quiet_alerted_for is distinct from ${today}::date returning id`;
      if (c[0]) {
        sent++;
        const text = quietFamilyText(m.name, m.gender);
        await feed(sql, circleId, m.id, '🧡 ' + text);
        await pushEach(sql, circleId, { title: '🧡 ' + m.name + ' has not checked in today',
          body: text.slice(m.name.length + 1) + ' Their check-in time was ' + by + '.', url: '/#home' }, [m.id]);
      }
    }
  }
  return sent;
}
// The timer's share: every family where someone has a check-in time.
export async function quietSweepAll(sql) {
  await ensureFamilyCareSchema(sql);
  const cs = await sql`select distinct circle_id from members where checkin_by is not null limit 500`;
  let n = 0;
  for (const c of cs) { try { n += await quietSweep(sql, c.circle_id); } catch (e) { /* the next family still goes */ } }
  return n;
}

// ---------------- call rota: a day nobody marked moves on ----------------
export async function rotaSweep(sql, circleId, nowMs = Date.now()) {
  await ensureTaskSchema(sql);
  const ts = await sql`select id, circle_id, due_at, tz, series_anchor, template_data, claimed_by from requests
                       where circle_id = ${circleId} and template = 'callrota' and status in ('open','assigned','claimed') and due_at is not null`;
  let n = 0;
  for (const t of ts) {
    const tz = tzOf(t.tz), due = new Date(t.due_at).getTime();
    if (localDate(due, tz) >= dayIn(tz, nowMs)) continue;
    const next = nextDue(due, 'daily', tz, t.series_anchor ? new Date(t.series_anchor).getTime() : null, nowMs);
    // Today's call if its time is still ahead, otherwise tomorrow's: a call
    // missed yesterday is not owed twice.
    let at = next;
    const prev = next - 86400000;
    if (localDate(prev, tz) === dayIn(tz, nowMs)) at = prev;
    const d = t.template_data || {}, rota = Array.isArray(d.rota) ? d.rota : [];
    const idx = rotaNext(rota, d.idx);
    // Rolled onto a time already gone today: shown as late, but nobody is
    // woken for it, the same as a task written down after its time.
    const gone = at <= nowMs ? new Date(at) : null;
    const r = await sql`update requests set due_at = ${new Date(at)}, due_date = ${localDate(at, tz)},
                          overdue_alerted_for = ${gone}, reminded_for = ${gone},
                          claimed_by = ${rota[idx] || t.claimed_by}, status = 'claimed', acknowledged_at = now(),
                          template_data = ${JSON.stringify({ ...d, idx })}::jsonb
                        where id = ${t.id} and due_at = ${t.due_at} returning id`;
    if (r[0]) {
      n++;
      await sql`insert into task_log (task_id, circle_id, member_id, action, note) values (${t.id}, ${circleId}, null, 'assigned', ${'next on the rota'})`;
    }
  }
  return n;
}

// "A call would be nice": today's rota person hears first, and by name.
export async function pulseCallNudge(sql, circleId, who, line) {
  let rotaPerson = null;
  try {
    await ensureTaskSchema(sql);
    const r = await sql`select q.claimed_by from requests q join members m on m.id = q.claimed_by
                        where q.circle_id = ${circleId} and q.template = 'callrota' and q.about_member = ${who.id}
                          and q.status in ('open','assigned','claimed') and q.claimed_by is not null and q.claimed_by <> ${who.id}
                        order by q.due_at limit 1`;
    rotaPerson = r[0] ? r[0].claimed_by : null;
  } catch (e) { /* no tasks yet */ }
  if (rotaPerson) {
    await pushCircle(sql, circleId, { title: '🧡 ' + who.name + ' could do with a call - it is your turn today', body: line, url: '/#care' }, { only: rotaPerson });
    await pushEach(sql, circleId, { title: '🧡 ' + who.name + ' could do with a call', body: line }, [who.id, rotaPerson]);
  } else {
    await pushCircle(sql, circleId, { title: '🧡 ' + who.name + ' could do with a call', body: line }, { except: who.id });
  }
  return rotaPerson;
}

// ---------------- what a family phone reads ----------------
export async function familyCareState(sql, circleId, meId, nowMs = Date.now()) {
  await ensureFamilyCareSchema(sql);
  const ms = await sql`select m.id, m.name, m.role, m.phone, m.gender, m.checkin_by, m.tz, m.checkin_ask,
                              a.name as ask_by_name, m.checkin_ask_by,
                              to_char(m.away_until, 'YYYY-MM-DD') as away_until,
                              to_char(m.quiet_alerted_for, 'YYYY-MM-DD') as alerted
                       from members m left join members a on a.id = m.checkin_ask_by
                       where m.circle_id = ${circleId} and m.user_id is not null
                         and (m.checkin_by is not null or m.checkin_ask is not null or m.role = 'parent' or m.id = ${meId})
                       order by m.created_at`;
  const quiet = [];
  for (const m of ms) {
    const tz = tzOf(m.tz), today = dayIn(tz, nowMs), by = validHHMM(m.checkin_by);
    const okAt = by ? await okToday(sql, m.id, today, tz) : null;
    const phase = by ? quietPhase({ checkinBy: by, awayUntil: m.away_until, today, checkedIn: !!okAt, deadlineMs: deadlineOf(today, by, tz), nowMs }) : 'off';
    quiet.push({ memberId: m.id, name: m.name, role: m.role, phone: m.phone, gender: m.gender,
      checkinBy: by, tz, awayUntil: m.away_until && m.away_until >= today ? m.away_until : null,
      ask: m.checkin_ask, askBy: m.checkin_ask_by, askByName: m.ask_by_name,
      okAt, phase, alerted: m.alerted === today && !okAt, today });
  }
  const askfirst = await sql`select f.id, f.member_id, f.note, f.status, f.created_at, f.acked_at, f.acked_by,
                                    m.name, m.phone, a.name as acked_name
                             from askfirst f join members m on m.id = f.member_id left join members a on a.id = f.acked_by
                             where f.circle_id = ${circleId} and f.status <> 'closed' and f.created_at > now() - interval '12 hours'
                             order by f.created_at desc limit 5`;
  const helps = await sql`select h.id, h.member_id, h.note, h.has_image, h.status, h.created_at, h.claimed_by, h.claimed_at,
                                 m.name, m.phone, c.name as claimed_name
                          from help_asks h join members m on m.id = h.member_id left join members c on c.id = h.claimed_by
                          where h.circle_id = ${circleId} and h.status <> 'done' and h.created_at > now() - interval '3 days'
                          order by h.created_at desc limit 5`;
  const fs = await sql`select safe_word from family_settings where circle_id = ${circleId}`;
  return { quiet, askfirst, helps, safeWord: fs[0] ? fs[0].safe_word : null };
}

// ---------------- writes from /api/events ----------------
export const FC_EVENT_TYPES = ['quiet_set', 'quiet_off', 'quiet_ask', 'quiet_answer', 'quiet_away',
  'askfirst', 'askfirst_ack', 'askfirst_close', 'safeword_set', 'help_ask', 'help_claim', 'help_done'];

const send = (res, status, json) => res.status(status).json(json);
const no = (res, status, error) => res.status(status).json({ ok: false, error });

export async function familyCarePost(sql, req, res, reqTzValue) {
  const b = req.body || {};
  const g = await requireMember(sql, b.code, b.memberId, tokenOf(req));
  if (g.err) return send(res, g.status, { ok: false, error: g.err, signin: g.signin });
  await ensureFamilyCareSchema(sql);
  const circle = g.circle;
  const me = (await sql`select id, name, role, phone, gender from members where id = ${g.me.id}`)[0];
  const type = b.type;
  const tz = validTz(b.tz) || reqTzValue || HOME_TZ;
  const today = dayIn(tz);

  // ---- quiet day ----
  if (type === 'quiet_set') {
    const by = validHHMM(b.checkinBy);
    if (!by) return no(res, 400, 'Pick a time, like 11:00');
    const past = Date.now() >= deadlineOf(today, by, tz);
    // Turned on after today's time has gone: it starts tomorrow, nobody is
    // told today about a check-in that was never asked for.
    await sql`update members set checkin_by = ${by}, tz = ${tz}, checkin_ask = null, checkin_ask_by = null,
                quiet_nudged_for = case when ${past} then ${today}::date else quiet_nudged_for end,
                quiet_alerted_for = case when ${past} then ${today}::date else quiet_alerted_for end
              where id = ${me.id}`;
    await feed(sql, circle.id, me.id, '🕚 ' + me.name + ' turned on the daily check-in: by ' + by + ' each day');
    return send(res, 200, { ok: true, checkinBy: by, startsTomorrow: past });
  }
  if (type === 'quiet_off') {
    await sql`update members set checkin_by = null, checkin_ask = null, checkin_ask_by = null where id = ${me.id}`;
    await feed(sql, circle.id, me.id, me.name + ' turned off the daily check-in');
    return send(res, 200, { ok: true });
  }
  if (type === 'quiet_ask') {
    const by = validHHMM(b.checkinBy);
    if (!by) return no(res, 400, 'Pick a time, like 11:00');
    const t = await memberIn(sql, circle.id, b.targetId);
    if (!t) return no(res, 404, 'That person is not in this family');
    if (t.id === me.id) return no(res, 400, 'Set your own time with Turn on');
    if (!t.on_app) return no(res, 400, t.name + ' is not on Parwah, so cannot check in here');
    if (!(await rateLimit(sql, 'quietask', t.id, 3, 86400))) return no(res, 429, t.name + ' has been asked already today');
    await sql`update members set checkin_ask = ${by}, checkin_ask_by = ${me.id} where id = ${t.id}`;
    await pushCircle(sql, circle.id, { title: '🕚 ' + me.name + ' asks: a daily check-in by ' + by + '?',
      body: 'It stays off until you say yes on your phone.', url: '/#home' }, { only: t.id });
    return send(res, 200, { ok: true });
  }
  if (type === 'quiet_answer') {
    const r = (await sql`select checkin_ask, checkin_ask_by from members where id = ${me.id}`)[0];
    if (!r || !r.checkin_ask) return no(res, 404, 'Nothing is waiting for your answer');
    if (b.yes === true) {
      const by = validHHMM(r.checkin_ask);
      const past = Date.now() >= deadlineOf(today, by, tz);
      await sql`update members set checkin_by = ${by}, tz = ${tz}, checkin_ask = null, checkin_ask_by = null,
                  quiet_nudged_for = case when ${past} then ${today}::date else quiet_nudged_for end,
                  quiet_alerted_for = case when ${past} then ${today}::date else quiet_alerted_for end
                where id = ${me.id}`;
      await feed(sql, circle.id, me.id, '🕚 ' + me.name + ' said yes to the daily check-in: by ' + by + ' each day');
      if (r.checkin_ask_by) await pushCircle(sql, circle.id, { title: '🕚 ' + me.name + ' said yes to the daily check-in', body: 'By ' + by + ' each day', url: '/#home' }, { only: r.checkin_ask_by });
      return send(res, 200, { ok: true, checkinBy: by, startsTomorrow: past });
    }
    await sql`update members set checkin_ask = null, checkin_ask_by = null where id = ${me.id}`;
    if (r.checkin_ask_by) await pushCircle(sql, circle.id, { title: me.name + ' said not now to the daily check-in', body: 'Nothing has been turned on.', url: '/#home' }, { only: r.checkin_ask_by });
    return send(res, 200, { ok: true, declined: true });
  }
  if (type === 'quiet_away') {
    const t = b.targetId && b.targetId !== me.id ? await memberIn(sql, circle.id, b.targetId) : me;
    if (!t) return no(res, 404, 'That person is not in this family');
    let until = null;
    if (b.until) {
      until = validDay(b.until);
      if (!until || until < today) return no(res, 400, 'Pick today or a day after it');
      if (until > addDays(today, AWAY_MAX_DAYS)) return no(res, 400, 'Pick a day within the next three months');
    }
    await sql`update members set away_until = ${until} where id = ${t.id}`;
    const whose = t.id === me.id ? me.name : me.name + ' for ' + t.name;
    await feed(sql, circle.id, me.id, until ? '🧳 Away until ' + until + ' (' + whose + '): the daily check-in is paused' : '🏠 ' + t.name + ' is back: the daily check-in is on again');
    if (t.id !== me.id) await pushCircle(sql, circle.id, { title: until ? '🧳 ' + me.name + ' paused your daily check-in' : '🏠 Your daily check-in is on again',
      body: until ? 'Until ' + until + '. Change it any time on Today.' : 'Turned back on by ' + me.name, url: '/#home' }, { only: t.id });
    return send(res, 200, { ok: true, awayUntil: until });
  }

  // ---- ask family first ----
  if (type === 'askfirst') {
    const note = clip(b.text, 200);
    const open = await sql`select id from askfirst where circle_id = ${circle.id} and member_id = ${me.id} and status = 'open'
                           and created_at > now() - interval '30 minutes' order by created_at desc limit 1`;
    let id = open[0] ? open[0].id : null;
    // Counted, but open: a limiter that cannot count must never keep the
    // family from hearing. Past the limit the family has already been told.
    const loud = await rateLimit(sql, 'askfirst', me.id, 4, 600);
    if (!id) {
      id = (await sql`insert into askfirst (circle_id, member_id, note) values (${circle.id}, ${me.id}, ${note}) returning id`)[0].id;
      await feed(sql, circle.id, me.id, '🛡 ' + me.name + ' is asking the family first: someone wants money or an OTP' + (note ? ' ("' + note + '")' : ''));
      await chatSay(sql, circle.id, me.id, '🛡 Someone is asking me for money or an OTP. I am checking with you first. Please call me.' + (note ? ' ' + note : ''));
    }
    if (loud) {
      await pushCircle(sql, circle.id, { title: '🛡 ' + me.name + ' is asking the family first',
        body: 'Someone wants money or an OTP. Please call ' + me.name + ' before anything is paid.', url: '/#home', urgent: true }, { except: me.id });
    }
    return send(res, 201, { ok: true, id, again: !!open[0] });
  }
  if (type === 'askfirst_ack' || type === 'askfirst_close') {
    if (!isUuid(b.askId)) return no(res, 400, 'Bad id');
    const r = (await sql`select f.id, f.member_id, f.status, m.name from askfirst f join members m on m.id = f.member_id
                         where f.id = ${b.askId} and f.circle_id = ${circle.id}`)[0];
    if (!r) return no(res, 404, 'That is not here any more');
    if (type === 'askfirst_close') {
      await sql`update askfirst set status = 'closed' where id = ${r.id}`;
      await feed(sql, circle.id, me.id, '✅ ' + me.name + ' marked ' + (r.member_id === me.id ? 'their' : r.name + "'s") + ' money question as sorted');
      return send(res, 200, { ok: true });
    }
    if (r.member_id === me.id) return no(res, 400, 'Someone else in the family answers this one');
    const c = await sql`update askfirst set status = 'acked', acked_by = ${me.id}, acked_at = now()
                        where id = ${r.id} and status = 'open' returning id`;
    if (!c[0]) {
      const who = (await sql`select a.name from askfirst f left join members a on a.id = f.acked_by where f.id = ${r.id}`)[0];
      return send(res, 200, { ok: true, already: true, ackedName: who ? who.name : null });
    }
    await feed(sql, circle.id, me.id, '🧡 ' + me.name + ' has seen ' + r.name + "'s money question and is calling");
    await pushCircle(sql, circle.id, { title: "🧡 " + me.name + " has seen it, calling you now",
      body: 'Do not pay or share any code until you talk.', url: '/#home', urgent: true }, { only: r.member_id });
    await pushEach(sql, circle.id, { title: '🧡 ' + me.name + ' is calling ' + r.name, body: 'About the money question. You do not need to call as well.', url: '/#home' }, [me.id, r.member_id]);
    return send(res, 200, { ok: true });
  }
  if (type === 'safeword_set') {
    const w = safeWordCheck(b.word);
    if (w.error) return no(res, 400, w.error);
    await sql`insert into family_settings (circle_id, safe_word, updated_by, updated_at) values (${circle.id}, ${w.value}, ${me.id}, now())
              on conflict (circle_id) do update set safe_word = excluded.safe_word, updated_by = excluded.updated_by, updated_at = now()`;
    // The word itself never goes in the feed or a push.
    await feed(sql, circle.id, me.id, w.value ? '🔑 ' + me.name + ' set the family safe word. Ask them for it on a call.' : me.name + ' removed the family safe word');
    return send(res, 200, { ok: true, set: !!w.value });
  }

  // ---- help me with my phone ----
  if (type === 'help_ask') {
    const note = clip(b.text, 300);
    let img = null;
    if (b.image) {
      img = safeImageUri(b.image);
      if (!img || img.length > 800000) return no(res, 400, 'That picture could not be sent - try a smaller one');
    }
    if (!note && !img) return no(res, 400, 'Add a few words or a picture of the screen');
    if (!(await rateLimit(sql, 'helpask', me.id, 5, 600))) return no(res, 429, 'The family has your last few - give them a moment');
    const id = (await sql`insert into help_asks (circle_id, member_id, note, has_image) values (${circle.id}, ${me.id}, ${note}, ${!!img}) returning id`)[0].id;
    await chatSay(sql, circle.id, me.id, '📱 I need help with my phone' + (note ? ': ' + note : '.') + ' Who can help?');
    if (img) await chatSay(sql, circle.id, me.id, img, 'image');
    await feed(sql, circle.id, me.id, '📱 ' + me.name + ' needs help with the phone');
    await pushCircle(sql, circle.id, { title: '📱 ' + me.name + ' needs help with the phone',
      body: (note || 'Sent a picture of the screen') + ' - tap to say you are on it', url: '/#home' }, { except: me.id });
    return send(res, 201, { ok: true, id });
  }
  if (type === 'help_claim' || type === 'help_done') {
    if (!isUuid(b.helpId)) return no(res, 400, 'Bad id');
    const h = (await sql`select h.id, h.member_id, h.status, h.claimed_by, m.name, c.name as claimed_name
                         from help_asks h join members m on m.id = h.member_id left join members c on c.id = h.claimed_by
                         where h.id = ${b.helpId} and h.circle_id = ${circle.id}`)[0];
    if (!h) return no(res, 404, 'That is not here any more');
    if (type === 'help_done') {
      if (h.member_id !== me.id && h.claimed_by !== me.id) return no(res, 403, 'Only ' + h.name + ' or the person helping can close this');
      await sql`update help_asks set status = 'done' where id = ${h.id}`;
      return send(res, 200, { ok: true });
    }
    if (h.member_id === me.id) return no(res, 400, 'Someone else in the family takes this one');
    const c = await sql`update help_asks set status = 'claimed', claimed_by = ${me.id}, claimed_at = now()
                        where id = ${h.id} and status = 'open' returning id`;
    if (!c[0]) return no(res, 409, (h.claimed_name || 'Someone') + ' is already on it');
    await chatSay(sql, circle.id, me.id, '🙋 ' + me.name + ' is on it, ' + first(h.name) + '.');
    await pushCircle(sql, circle.id, { title: '🙋 ' + me.name + ' is on it', body: 'They will call or message you soon.', url: '/#home' }, { only: h.member_id });
    return send(res, 200, { ok: true });
  }
  return no(res, 400, 'Unknown event type');
}

// ---------------- writes from /api/care: ready-made tasks ----------------
export const FC_CARE_ACTIONS = ['lifecert_create', 'lifecert_update', 'rota_create', 'rota_done', 'rota_skip'];
const ok = (status, json) => ({ status, json: { ok: true, ...json } });
const bad = (status, error) => ({ status, json: { ok: false, error } });

async function loadTask(sql, circle, id, template) {
  if (!isUuid(id)) return null;
  const r = await sql`select * from requests where id = ${id} and circle_id = ${circle.id} and template = ${template}`;
  return r[0] || null;
}
async function log(sql, t, me, action, note) {
  await sql`insert into task_log (task_id, circle_id, member_id, action, note) values (${t.id}, ${t.circle_id}, ${me ? me.id : null}, ${action}, ${note || null})`;
}

export async function familyTaskAction(sql, circle, me, body, reqTzValue) {
  await ensureTaskSchema(sql);
  const action = body.action;
  const tz = validTz(body.tz) || reqTzValue || HOME_TZ;

  if (action === 'lifecert_create') {
    const who = await memberIn(sql, circle.id, body.aboutMemberId);
    if (!who) return bad(404, 'Pick whose pension it is');
    const dup = await sql`select id from requests where circle_id = ${circle.id} and template = 'lifecert' and about_member = ${who.id}
                          and status in ('open','assigned','claimed') limit 1`;
    if (dup[0]) return bad(409, 'The life certificate for ' + who.name + ' is already on the list');
    const w = lifecertWindow(who.dob, dayIn(tz));
    const opensWord = w.superSenior ? '1 October' : '1 November';
    const out = await taskAction(sql, circle, me, {
      action: 'task_create', title: 'Life certificate for ' + who.name + ' (Jeevan Pramaan)', dueDate: w.closes, tz,
      recurrence: 'yearly', aboutMemberId: who.id, ownerId: body.ownerId === 'me' ? 'me' : undefined,
      doneWhen: 'Acknowledgement number noted',
      notes: 'Can be given from ' + opensWord + ' to 30 November' + (w.superSenior ? ' (80 and over)' : '') +
             '. Dates are as announced each year: confirm on jeevanpramaan.gov.in.' });
    if (!out.json.ok) return out;
    const data = { opens: w.opens, closes: w.closes, superSenior: w.superSenior, dobKnown: w.dobKnown, checks: {}, result: null, ackNo: null };
    await sql`update requests set template = 'lifecert', template_data = ${JSON.stringify(data)}::jsonb where id = ${out.json.id}`;
    return ok(201, { id: out.json.id, window: w });
  }

  if (action === 'lifecert_update') {
    const t = await loadTask(sql, circle, body.taskId, 'lifecert');
    if (!t) return bad(404, 'That task is not here any more');
    if (!['open', 'assigned', 'claimed'].includes(t.status)) return bad(409, 'This one is already done');
    const d = { ...(t.template_data || {}) };
    d.checks = { ...(d.checks || {}) };
    if (body.check && typeof body.check === 'object') {
      for (const k of ['ppo', 'aadhaar', 'face']) if (k in body.check) d.checks[k] = body.check[k] === true;
    }
    let ackNo = null;
    if (body.result === 'ack') {
      const a = ackNoCheck(body.ackNo);
      if (a.error) return bad(400, a.error);
      ackNo = a.value; d.result = 'ack'; d.ackNo = ackNo;
    } else if (body.result === 'rejected') { d.result = 'rejected'; d.ackNo = null; }
    else if (body.result === null) { d.result = null; d.ackNo = null; }
    await sql`update requests set template_data = ${JSON.stringify(d)}::jsonb where id = ${t.id}`;
    if (body.result === 'rejected') {
      await log(sql, t, me, 'edited', 'Not accepted this time - fix steps are in the task');
      await feed(sql, circle.id, me.id, 'The life certificate was not accepted this time. The steps to fix it are in the task.');
      return ok(200, { result: 'rejected' });
    }
    if (body.result !== 'ack') return ok(200, { checks: d.checks });
    // Noted: that finishes it, and next year's is made with a fresh list.
    const done = await taskAction(sql, circle, me, { action: 'task_done', taskId: t.id, note: 'Acknowledgement noted: ' + ackNo });
    if (!done.json.ok) return ok(200, { result: 'ack', done: false, why: done.json.error });
    if (done.json.next) {
      const who = t.about_member ? (await sql`select to_char(dob, 'YYYY-MM-DD') as dob from members where id = ${t.about_member}`)[0] : null;
      const nxt = (await sql`select to_char(due_date, 'YYYY-MM-DD') as due_date from requests where id = ${done.json.next}`)[0];
      const nd = nxt && nxt.due_date;
      const w = lifecertWindow(who ? who.dob : null, nd ? nd.slice(0, 4) + '-01-01' : addDays(dayIn(tz), 60));
      await sql`update requests set template = 'lifecert',
                  template_data = ${JSON.stringify({ opens: w.opens, closes: w.closes, superSenior: w.superSenior, dobKnown: w.dobKnown, checks: {}, result: null, ackNo: null })}::jsonb
                where id = ${done.json.next}`;
    }
    return ok(200, { result: 'ack', done: true, next: done.json.next || null });
  }

  if (action === 'rota_create') {
    const about = await memberIn(sql, circle.id, body.aboutMemberId);
    if (!about) return bad(404, 'Pick who the calls are for');
    const time = validHHMM(body.time) || '19:00';
    const want = Array.isArray(body.memberIds) ? body.memberIds.filter(isUuid) : [];
    const rota = [];
    for (const id of want) {
      if (rota.includes(id) || id === about.id) continue;
      const m = await memberIn(sql, circle.id, id);
      if (!m) return bad(404, 'Someone on the rota is not in this family');
      if (!m.on_app) return bad(400, m.name + ' is not on Parwah, so cannot be on the rota');
      rota.push(id);
    }
    if (!rota.length) return bad(400, 'Pick at least one person to take turns');
    if (rota.length > 8) return bad(400, 'Up to eight people can share a rota');
    const dup = await sql`select id from requests where circle_id = ${circle.id} and template = 'callrota' and about_member = ${about.id}
                          and status in ('open','assigned','claimed') limit 1`;
    if (dup[0]) return bad(409, 'There is already a call rota for ' + about.name);
    const today = dayIn(tz);
    let at = deadlineOf(today, time, tz);
    if (at <= Date.now()) at = deadlineOf(addDays(today, 1), time, tz);
    const dueAt = new Date(at), owner = rota[0];
    const title = 'Call ' + about.name;
    const t = (await sql`
      insert into requests (circle_id, by_member, title, status, claimed_by, acknowledged_at, due_at, all_day, tz, due_date,
                            recurrence, series_id, series_anchor, done_when, escalate, about_member, remind_before,
                            template, template_data)
      values (${circle.id}, ${me.id}, ${title}, 'claimed', ${owner}, now(), ${dueAt}, false, ${tz}, ${localDate(at, tz)},
              'daily', ${randomUUID()}, ${dueAt}, ${'Called ' + about.name}, 'people', ${about.id}, 0,
              'callrota', ${JSON.stringify({ rota, idx: 0 })}::jsonb)
      returning id, circle_id`)[0];
    await log(sql, t, me, 'created', null);
    const names = (await sql`select id, name from members where id = any(${rota})`);
    const nameOf = id => (names.find(n => n.id === id) || {}).name || 'someone';
    await feed(sql, circle.id, me.id, '📞 ' + me.name + ' set up a call rota for ' + about.name + ': ' + rota.map(nameOf).join(', '));
    for (const id of rota) {
      if (id === me.id) continue;
      await pushCircle(sql, circle.id, { title: '📞 You are on the call rota for ' + about.name,
        body: (id === owner ? 'Your turn is first, at ' + time + '.' : 'Turns go round one day each.') + ' Skip passes your day on.', url: '/#care' }, { only: id });
    }
    return ok(201, { id: t.id, rota, first: owner });
  }

  if (action === 'rota_done' || action === 'rota_skip') {
    const t = await loadTask(sql, circle, body.taskId, 'callrota');
    if (!t) return bad(404, 'That task is not here any more');
    if (!['open', 'assigned', 'claimed'].includes(t.status)) return bad(409, 'Already done for today');
    const d = t.template_data || {}, rota = Array.isArray(d.rota) ? d.rota : [];
    const about = t.about_member ? await memberIn(sql, circle.id, t.about_member) : null;
    const aboutName = about ? about.name : 'them';
    const idx = rotaNext(rota, d.idx);
    if (action === 'rota_skip') {
      if (t.claimed_by !== me.id && t.by_member !== me.id) return bad(403, 'Only the person whose turn it is can pass it on');
      if (rota.length < 2) return bad(409, 'Nobody else is on the rota yet');
      const r = await sql`update requests set claimed_by = ${rota[idx]}, status = 'claimed', acknowledged_at = now(),
                            template_data = ${JSON.stringify({ ...d, idx })}::jsonb
                          where id = ${t.id} and claimed_by is not distinct from ${t.claimed_by} and status in ('open','assigned','claimed') returning id`;
      if (!r[0]) return bad(409, 'This changed a moment ago - have another look');
      const nextName = (await memberIn(sql, circle.id, rota[idx]) || {}).name || 'the next person';
      await log(sql, t, me, 'assigned', nextName);
      await feed(sql, circle.id, me.id, '📞 ' + me.name + ' passed today\'s call with ' + aboutName + ' to ' + nextName);
      if (rota[idx] !== me.id) await pushCircle(sql, circle.id, { title: '📞 Your turn to call ' + aboutName + ' today',
        body: me.name + ' passed today on to you.', url: '/#care' }, { only: rota[idx] });
      return ok(200, { claimedBy: rota[idx] });
    }
    // Anyone who called counts: the record says who did.
    const r = await sql`update requests set status = 'done', completed_at = now(), completed_by = ${me.id},
                          completion_note = ${'Called ' + aboutName}
                        where id = ${t.id} and status in ('open','assigned','claimed') returning id`;
    if (!r[0]) return bad(409, 'Already done for today');
    await log(sql, t, me, 'done', 'Called ' + aboutName);
    await feed(sql, circle.id, me.id, '📞 ' + me.name + ' called ' + aboutName + ' ✔');
    const tz2 = tzOf(t.tz);
    const n = nextDue(new Date(t.due_at).getTime(), 'daily', tz2, t.series_anchor ? new Date(t.series_anchor).getTime() : null);
    let next = null;
    if (n && rota.length) {
      const ins = await sql`
        insert into requests (circle_id, by_member, title, status, claimed_by, acknowledged_at, due_at, all_day, tz, due_date,
                              recurrence, series_id, series_anchor, done_when, escalate, about_member, remind_before, template, template_data)
        values (${t.circle_id}, ${t.by_member}, ${t.title}, 'claimed', ${rota[idx]}, now(), ${new Date(n)}, false, ${t.tz}, ${localDate(n, tz2)},
                'daily', ${t.series_id}, ${t.series_anchor}, ${t.done_when}, ${t.escalate}, ${t.about_member}, ${t.remind_before},
                'callrota', ${JSON.stringify({ ...d, idx })}::jsonb)
        on conflict do nothing returning id, circle_id`;
      if (ins[0]) { next = ins[0].id; await log(sql, ins[0], me, 'created', 'next time'); }
    }
    return ok(200, { status: 'done', next, nextBy: rota[idx] || null });
  }
  return bad(400, 'Unknown action');
}
export { JEEVAN_SITE };
