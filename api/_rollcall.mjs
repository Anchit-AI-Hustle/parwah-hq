// "SAB THEEK?" THE FAMILY ROLL-CALL. Behind /api/care?area=rollcall (no new
// function: the project is at its cap).
//
// A flood, a long power cut, an earthquake. Any adult starts a roll-call;
// every member gets a safety push and two buttons, "I am safe" and "I need
// help". "I need help" raises that person's own SOS, through the same
// handler as the SOS button. The family sees who has answered and who has
// not, and can call them. Someone who is not on Parwah (Dadi, added by name)
// is listed for an adult to tick after speaking to her: "Rohan says Dadi is
// safe". It closes itself after 24 hours.
//
//   GET  /api/care?area=rollcall&circle=CODE&member=ID
//        -> { open: null | { id, byName, reason, note, startedAt, closesAt, mine, board, canClose },
//             last, canStart, reasons, me: { adult } }
//   POST /api/care {action: 'rollcall_start', reason, note?}
//        {action: 'rollcall_answer', answer: 'safe'|'help', forId?, lat?, lng?}
//        {action: 'rollcall_close'}
//
// The rules, all on the server:
//   - one open roll-call a family (a unique index), three in 24 hours;
//   - an adult starts and closes one, and ticks for someone else;
//   - nobody marked as no longer with us is asked, listed or ticked;
//   - a child or a teenager is not shown that someone needs help (the SQL
//     of the read blanks that answer for them);
//   - a phone number is sent only as its owner lets this viewer see it.
import { db, ensureSchema, requireMember, isUuid, schemaOnce, rateLimit } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { ensureAudienceSchema, minorOf, pushAudience } from './_audience.mjs';
import { memberCards } from './_standing.mjs';
import { ROLLCALL_PER_DAY, ROLLCALL_REMIND_MIN, ROLLCALL_ANSWERS, ROLLCALL_REASONS, rollcallReason, rollcallIsOpen, rollcallClosesAt,
         rollcallMayStart, rollcallMayAnswerFor, rollcallBoard, rollcallLine,
         rollcallAskPush, rollcallRemindPush, rollcallHelpPush, rollcallDonePush } from './_rollcallrules.mjs';

// The clock can be handed in by a test; nothing else sets it.
export const rollcallSeams = { now: null };
const nowOf = () => (rollcallSeams.now ? rollcallSeams.now() : Date.now());
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';

let ready = false;
export async function ensureRollcallSchema(sql) {
  if (ready) return;
  await ensureAudienceSchema(sql);
  await schemaOnce(async () => {
    await sql`create table if not exists rollcalls (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      by_member uuid references members(id) on delete set null,
      reason text not null default 'other',
      note text,
      started_at timestamptz not null default now(),
      closes_at timestamptz not null,
      reminded_at timestamptz,
      all_safe_at timestamptz,
      closed_at timestamptz,
      closed_by uuid references members(id) on delete set null
    )`;
    // One open roll-call a family, whoever taps first.
    await sql`create unique index if not exists rollcalls_one_open on rollcalls (circle_id) where closed_at is null`;
    await sql`create table if not exists rollcall_answers (
      rollcall_id uuid not null references rollcalls(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      answer text not null check (answer in ('safe', 'help')),
      by_member uuid references members(id) on delete set null,
      at timestamptz not null default now(),
      primary key (rollcall_id, member_id)
    )`;
  });
  ready = true;
}

// The roll-call open in this family at this moment, if any. One that has
// run past its 24 hours is closed here, so a read never shows a stale one.
async function openOne(sql, circleId, nowMs) {
  const rc = (await sql`select r.*, m.name as by_name from rollcalls r left join members m on m.id = r.by_member
                        where r.circle_id = ${circleId} and r.closed_at is null`)[0];
  if (!rc) return null;
  if (rollcallIsOpen(rc, nowMs)) return rc;
  await sql`update rollcalls set closed_at = closes_at where id = ${rc.id} and closed_at is null`;
  return null;
}

// What one member is sent about a roll-call. The answers are read in ONE
// query that knows who is asking: to a child or a teenager, somebody else's
// "I need help" comes back as no answer at all.
async function boardFor(sql, circle, me, rc, meMinor) {
  const members = await sql`select m.id, m.name, m.phone, (m.user_id is not null) as on_app, m.remembered
                            from members m where m.circle_id = ${circle.id} and not m.remembered order by m.created_at`;
  const answers = await sql`
    select a.member_id, a.answer, a.by_member, b.name as by_name, a.at
    from rollcall_answers a
    join members m on m.id = a.member_id and m.circle_id = ${circle.id} and not m.remembered
    join members v on v.id = ${me.id} and v.circle_id = m.circle_id
    left join members b on b.id = a.by_member
    where a.rollcall_id = ${rc.id}
      and (a.answer = 'safe' or a.member_id = v.id
           or not (case when v.dob is not null then v.dob > current_date - interval '18 years' else (v.is_child or v.adult_confirmed is false) end))`;
  const board = rollcallBoard(members, answers, { viewerId: me.id, viewerMinor: meMinor });
  // A number to call, only as its owner lets this viewer see it.
  const shown = new Map((await memberCards(sql, circle, me, members.map(m => ({ id: m.id, phone: m.phone })))).map(c => [c.id, c.phone || null]));
  for (const list of [board.safe, board.help, board.waiting]) for (const r of list) r.phone = r.id === me.id ? null : (shown.get(r.id) || null);
  const mine = answers.find(a => a.member_id === me.id);
  return { board, mine: mine ? mine.answer : null };
}

async function stateFor(sql, circle, me, nowMs) {
  const meMinor = await minorOf(sql, circle.id, me.id);
  const rc = await openOne(sql, circle.id, nowMs);
  const dayAgo = new Date(nowMs - 86400000);
  const today = (await sql`select count(*)::int as n from rollcalls where circle_id = ${circle.id} and started_at > ${dayAgo}`)[0].n;
  const out = { ok: true, open: null, last: null, reasons: ROLLCALL_REASONS, me: { adult: !meMinor },
    canStart: rollcallMayStart({ adult: !meMinor, hasOpen: !!rc, startedToday: today }).ok, perDay: ROLLCALL_PER_DAY };
  if (rc) {
    const b = await boardFor(sql, circle, me, rc, meMinor);
    out.open = { id: rc.id, byId: rc.by_member, byName: rc.by_name || 'Someone', reason: rc.reason, reasonWords: rollcallReason(rc.reason),
      note: rc.note || null, startedAt: rc.started_at, closesAt: rc.closes_at, mine: b.mine, board: b.board, canClose: !meMinor };
  } else {
    const l = (await sql`select r.id, r.reason, r.started_at, r.closed_at, m.name as by_name from rollcalls r left join members m on m.id = r.by_member
                         where r.circle_id = ${circle.id} and r.closed_at > ${dayAgo} order by r.closed_at desc limit 1`)[0];
    if (l) out.last = { id: l.id, byName: l.by_name || 'Someone', reasonWords: rollcallReason(l.reason), startedAt: l.started_at, closedAt: l.closed_at };
  }
  return out;
}

// "I need help" raises this person's own SOS, through the SOS handler
// itself (the same checks, the same limits, the same alerts and calls).
async function raiseOwnSos(req, body) {
  let out = { status: 500, json: null };
  const res = { status(s) { out.status = s; return this; }, json(j) { out.json = j; return this; }, setHeader() { return this; }, end() { return this; } };
  try {
    const events = (await import('./events.mjs')).default;
    await events({ method: 'POST', headers: req.headers || {}, query: {},
      body: { code: body.code, memberId: body.memberId, type: 'sos', text: 'Needs help (roll-call)', tz: body.tz, lat: body.lat, lng: body.lng, acc: body.acc } }, res);
  } catch (e) { /* the family has still been told below */ }
  return out;
}

export default async function rollcallApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureRollcallSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, b = req.body || {};
    const get = req.method === 'GET';
    const g = await requireMember(sql, get ? q.circle : b.code, get ? q.member : b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me, nowMs = nowOf();
    if (get) return res.status(200).json(await stateFor(sql, circle, me, nowMs));
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    const meMinor = await minorOf(sql, circle.id, me.id);

    if (b.action === 'rollcall_start') {
      const rc0 = await openOne(sql, circle.id, nowMs);
      const dayAgo = new Date(nowMs - 86400000);
      const today = (await sql`select count(*)::int as n from rollcalls where circle_id = ${circle.id} and started_at > ${dayAgo}`)[0].n;
      const may = rollcallMayStart({ adult: !meMinor, hasOpen: !!rc0, startedToday: today });
      if (!may.ok) return res.status(may.status).json({ ok: false, error: may.error });
      // One member cannot ring the whole family over and over.
      if (!(await rateLimit(sql, 'rollcall', me.id, 6, 3600, { failClosed: true }))) {
        return res.status(429).json({ ok: false, error: 'Please wait a little before asking everyone again.' });
      }
      const reason = ROLLCALL_REASONS.some(r => r[0] === b.reason) ? b.reason : 'other';
      const note = clip(b.note, 120) || null;
      let rc;
      try {
        rc = (await sql`insert into rollcalls (circle_id, by_member, reason, note, started_at, closes_at)
                        values (${circle.id}, ${me.id}, ${reason}, ${note}, ${new Date(nowMs)}, ${rollcallClosesAt(nowMs)}) returning id`)[0];
      } catch (e) {
        if (e && e.code === '23505') return res.status(409).json({ ok: false, error: 'A roll-call is already open. Answer it, or close it first.' });
        throw e;
      }
      // Whoever asks is safe enough to ask.
      await sql`insert into rollcall_answers (rollcall_id, member_id, answer, by_member, at) values (${rc.id}, ${me.id}, 'safe', ${me.id}, ${new Date(nowMs)})
                on conflict do nothing`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${'🛟 ' + me.name + ' asked everyone: Sab theek? (' + rollcallReason(reason) + ')'})`;
      // Every member with us, children too: each has two buttons to tap.
      await pushCircle(sql, circle.id, rollcallAskPush(me.name, reason, note), { except: me.id });
      return res.status(201).json(await stateFor(sql, circle, me, nowMs));
    }

    if (b.action === 'rollcall_answer') {
      const rc = await openOne(sql, circle.id, nowMs);
      if (!rc) return res.status(409).json({ ok: false, error: 'That roll-call has closed.' });
      if (!ROLLCALL_ANSWERS.includes(b.answer)) return res.status(400).json({ ok: false, error: 'Tap "I am safe" or "I need help".' });
      const forId = b.forId === undefined || b.forId === null || b.forId === me.id ? me.id : b.forId;
      if (!isUuid(forId)) return res.status(404).json({ ok: false, error: 'Choose someone in this family' });
      const target = (await sql`select id, name, remembered, (user_id is not null) as on_app from members where id = ${forId} and circle_id = ${circle.id}`)[0];
      const existing = (await sql`select answer, by_member from rollcall_answers where rollcall_id = ${rc.id} and member_id = ${forId}`)[0] || null;
      const may = rollcallMayAnswerFor({ meId: me.id, meAdult: !meMinor, target, existing });
      if (!may.ok) return res.status(may.status).json({ ok: false, error: may.error });
      if (!(await rateLimit(sql, 'rollcallans', me.id, 60, 3600, { failClosed: true }))) {
        return res.status(429).json({ ok: false, error: 'Please wait a little and try again.' });
      }
      // A person's own answer always wins; a tick made for them never
      // replaces what they said themself.
      const saved = await sql`
        insert into rollcall_answers (rollcall_id, member_id, answer, by_member, at) values (${rc.id}, ${target.id}, ${b.answer}, ${me.id}, ${new Date(nowMs)})
        on conflict (rollcall_id, member_id) do update set answer = excluded.answer, by_member = excluded.by_member, at = excluded.at
          where rollcall_answers.by_member is distinct from rollcall_answers.member_id or excluded.by_member = rollcall_answers.member_id
        returning answer`;
      if (!saved[0]) return res.status(409).json({ ok: false, error: first(target.name) + ' has already answered themself.' });
      const changed = !existing || existing.answer !== b.answer;
      let sos = null;
      if (b.answer === 'help' && changed) {
        // Their own SOS when they asked themself. For someone ticked by
        // another person, the adults are told at once and asked to call.
        if (may.self) sos = await raiseOwnSos(req, b);
        if (!may.self || !sos || !sos.json || !sos.json.ok) {
          await pushAudience(sql, circle.id, 'sos_details', rollcallHelpPush(target.name, may.self ? null : me.name), { except: me.id });
        }
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${me.id}, 'care', ${'🛟 ' + rollcallLine(target.name, 'help', may.self ? null : me.name)})`;
      }
      // The moment the last person is accounted for, whoever asked is told, once.
      if (b.answer === 'safe') {
        const left = (await sql`select count(*)::int as n from members m where m.circle_id = ${circle.id} and not m.remembered
                                and not exists (select 1 from rollcall_answers a where a.rollcall_id = ${rc.id} and a.member_id = m.id and a.answer = 'safe')`)[0].n;
        if (left === 0) {
          const claim = await sql`update rollcalls set all_safe_at = ${new Date(nowMs)} where id = ${rc.id} and all_safe_at is null returning by_member`;
          if (claim[0] && claim[0].by_member && claim[0].by_member !== me.id) await pushCircle(sql, circle.id, rollcallDonePush(), { only: claim[0].by_member });
        }
      }
      const out = await stateFor(sql, circle, me, nowMs);
      out.sos = sos && sos.json && sos.json.ok ? { raised: true, sosId: sos.json.sosId, contacts: sos.json.contacts || [], message: sos.json.message || null } : null;
      return res.status(200).json(out);
    }

    if (b.action === 'rollcall_close') {
      if (meMinor) return res.status(403).json({ ok: false, error: 'An adult in the family closes a roll-call.' });
      const done = await sql`update rollcalls set closed_at = ${new Date(nowMs)}, closed_by = ${me.id}
                             where circle_id = ${circle.id} and closed_at is null returning id`;
      if (!done[0]) return res.status(409).json({ ok: false, error: 'That roll-call has already closed.' });
      await sql`insert into events (circle_id, member_id, type, text) values (${circle.id}, ${me.id}, 'care', ${'🛟 ' + me.name + ' closed the roll-call'})`;
      return res.status(200).json(await stateFor(sql, circle, me, nowMs));
    }
    return res.status(400).json({ ok: false, error: 'Unknown roll-call action' });
  } catch (e) { return fail(res, e); }
}

// THE TIMER'S SHARE (one line in runTick). Two things, each claimed by its
// own UPDATE so that however many timers run, each happens once:
//   1. half an hour in, the people on Parwah who have not answered are
//      asked once more;
//   2. after 24 hours the roll-call closes itself.
export async function sweepRollcallAll(sql, nowMs = Date.now()) {
  await ensureRollcallSchema(sql);
  let n = 0;
  const closed = await sql`update rollcalls set closed_at = ${new Date(nowMs)} where closed_at is null and closes_at <= ${new Date(nowMs)} returning id, circle_id`;
  for (const r of closed) {
    await sql`insert into events (circle_id, member_id, type, text) values (${r.circle_id}, null, 'care', '🛟 The roll-call closed after 24 hours')`;
    n++;
  }
  const remindBy = new Date(nowMs - ROLLCALL_REMIND_MIN * 60000);
  const due = await sql`update rollcalls set reminded_at = ${new Date(nowMs)}
                        where closed_at is null and reminded_at is null and started_at <= ${remindBy} and closes_at > ${new Date(nowMs)}
                        returning id, circle_id, by_member`;
  for (const r of due) {
    const starter = (await sql`select name from members where id = ${r.by_member}`)[0];
    const waiting = await sql`select m.id from members m where m.circle_id = ${r.circle_id} and m.user_id is not null and not m.remembered
                              and not exists (select 1 from rollcall_answers a where a.rollcall_id = ${r.id} and a.member_id = m.id)`;
    for (const w of waiting) await pushCircle(sql, r.circle_id, rollcallRemindPush(starter ? starter.name : 'Your family'), { only: w.id });
    if (waiting.length) n++;
  }
  return n;
}
