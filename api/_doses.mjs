// DOSE TIMES AND TICKS: "Show me which doses Maa marked today, and nudge her
// and then me if the evening one is missed."
//
// For a medicine already in Health & contacts (family_book, kind 'med'), the
// family sets the times (morning, afternoon, night or any HH:MM) and the
// days. Each time on each day becomes one row in medicine_doses, made lazily
// when someone looks, never ahead of the moment the times were set.
//
// A tick is what somebody MARKED, never proof that a medicine was taken, and
// Parwah never says whether a medicine or a dose is right. No dose advice.
//
// Not marked 60 minutes after its time: the person is nudged, once.
// Not marked 120 minutes after its time: the family is told, once.
// Both are claimed by one conditional UPDATE (the overdue_alerted_for
// pattern in _tasks.mjs), so any number of phones polling at once send each
// exactly once; and both only inside waking hours at home, and only in a
// short window, so nobody is woken at night or told at breakfast about last
// night.
//
// Private medicines stay private on every path: the list, the week strip and
// the alert go only to people who may read the entry (the same rule as
// book.mjs: shared with the family, about you, written by you, or shared
// with you by name). Feed lines never name a medicine.
//
// GET  /api/care?area=doses&circle&member[&person]  -> { ok, schedules, doses }
// POST /api/care {area:'doses', action:'dose_schedule_set'|'dose_schedule_off'|'dose_mark'|'dose_undo', ...}
import { db, ensureSchema, requireMember, isUuid, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { validTz, reqTz, dayIn, fromWall } from './_recur.mjs';
import { ensureBookSchema } from './_bookschema.mjs';
import { ensureCarePrepSchema } from './_careprep.mjs';

export const NUDGE_AFTER_MIN = 60;    // the person is nudged
export const ALERT_AFTER_MIN = 120;   // then the family is told
export const SEND_WINDOW_MIN = 120;   // a nudge or alert older than this is dropped, not sent late
export const WAKE_FROM = '07:00';     // waking hours at home: nothing is sent outside them
export const WAKE_TO = '22:30';
export const SLOTS = { morning: '08:00', afternoon: '14:00', night: '21:00' };
export const SKIP_REASONS = ['Doctor said to stop', 'Felt unwell', 'Ran out', 'Was away', 'Other'];
const HISTORY_DAYS = 7;

let ready = false;
export async function ensureDoseSchema(sql) {
  if (ready) return;
  await ensureSchema(sql);
  await schemaOnce(() => ensureBookSchema(sql));
  await schemaOnce(() => ensureCarePrepSchema(sql));   // medicine_inventory
  await schemaOnce(async () => {
    await sql`create table if not exists medicine_schedules (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      person_id uuid not null references members(id) on delete cascade,
      medicine_id uuid not null references family_book(id) on delete cascade,
      times text[] not null default '{}',
      days int[] not null default '{}',
      tz text not null default 'Asia/Kolkata',
      since timestamptz not null default now(),
      active boolean not null default true,
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
    await sql`create unique index if not exists medicine_schedules_med on medicine_schedules (medicine_id)`;
    await sql`create table if not exists medicine_doses (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      person_id uuid not null references members(id) on delete cascade,
      medicine_id uuid not null references family_book(id) on delete cascade,
      schedule_id uuid not null references medicine_schedules(id) on delete cascade,
      slot text not null,
      tz text not null,
      due_at timestamptz not null,
      status text not null default 'due',
      taken_at timestamptz,
      marked_by uuid references members(id) on delete set null,
      skip_reason text,
      nudged_at timestamptz,
      alerted_at timestamptz,
      created_at timestamptz not null default now()
    )`;
    await sql`create unique index if not exists medicine_doses_once on medicine_doses (schedule_id, due_at)`;
    await sql`create index if not exists medicine_doses_circle on medicine_doses (circle_id, status, due_at)`;
  });
  ready = true;
}

// HH:MM, 24 hour; "morning" and friends become their usual times.
export function cleanTimes(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const v = SLOTS[raw] || String(raw || '').trim();
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v);
    if (!m) return null;
    const t = m[1].padStart(2, '0') + ':' + m[2];
    if (!out.includes(t)) out.push(t);
  }
  if (!out.length || out.length > 6) return null;
  return out.sort();
}
export function cleanDays(list) {
  const out = [...new Set((Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  return out.length === 7 ? [] : out;   // every day is stored as "no limit"
}
// Is this wall-clock HH:MM inside waking hours?
// "21:00" said as "9:00 PM", the way the family says it.
export function slot12(hhmm) { const h = +hhmm.slice(0, 2); return (h % 12 || 12) + ':' + hhmm.slice(3, 5) + (h < 12 ? ' AM' : ' PM'); }
export function awake(hhmm) { return hhmm >= WAKE_FROM && hhmm <= WAKE_TO; }

// The doses each schedule owes, from `since` (never earlier) back over the
// last week and up to the end of today, made once each.
export async function fillDoses(sql, circleId, nowMs = Date.now()) {
  const scheds = await sql`select id, person_id, medicine_id, times, days, tz, since
                           from medicine_schedules where circle_id = ${circleId} and active`;
  if (!scheds.length) return 0;
  const ids = [], sch = [], people = [], meds = [], slots = [], tzs = [], dues = [];
  for (const s of scheds) {
    const tz = validTz(s.tz) || 'UTC';
    const since = new Date(s.since).getTime();
    for (let k = HISTORY_DAYS - 1; k >= 0; k--) {
      const [y, m, d] = dayIn(tz, nowMs - k * 86400000).split('-').map(Number);
      const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if ((s.days || []).length && !s.days.includes(wd)) continue;
      for (const t of s.times || []) {
        const [h, mi] = t.split(':').map(Number);
        const at = fromWall({ y, m, d, h, mi, s: 0 }, tz);
        if (at < since) continue;
        sch.push(s.id); people.push(s.person_id); meds.push(s.medicine_id);
        slots.push(t); tzs.push(tz); dues.push(new Date(at).toISOString()); ids.push(circleId);
      }
    }
  }
  if (!sch.length) return 0;
  const r = await sql`
    insert into medicine_doses (circle_id, schedule_id, person_id, medicine_id, slot, tz, due_at)
    select * from unnest(${ids}::uuid[], ${sch}::uuid[], ${people}::uuid[], ${meds}::uuid[],
                         ${slots}::text[], ${tzs}::text[], ${dues}::timestamptz[])
    on conflict (schedule_id, due_at) do nothing returning id`;
  return r.length;
}

// A zone the database also knows. Phones still say some old names (Chrome
// in India says "Asia/Calcutta") that the browser accepts and PostgreSQL
// may not; one such row would break every dose query for the family.
const TZ_ALIAS = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh',
                   'Asia/Rangoon': 'Asia/Yangon', 'Asia/Dacca': 'Asia/Dhaka', 'Asia/Thimbu': 'Asia/Thimphu', 'Asia/Ulan_Bator': 'Asia/Ulaanbaatar' };
export async function pgTz(sql, tz) {
  for (const z of [tz, TZ_ALIAS[tz], 'Asia/Kolkata']) {
    if (!z) continue;
    try { await sql`select now() at time zone ${z} as t`; return z; } catch (e) { /* not known here */ }
  }
  return 'UTC';
}

// May this member read this medicine entry? The rule book.mjs uses.
async function readableMed(sql, circleId, meId, medId) {
  if (!isUuid(medId)) return null;
  const r = await sql`
    select b.id, b.name, b.about_member, b.visibility, m.name as person_name
    from family_book b left join members m on m.id = b.about_member
    where b.id = ${medId} and b.circle_id = ${circleId} and b.kind = 'med'
      and (b.visibility = 'circle' or b.about_member = ${meId} or b.by_member = ${meId}
           or exists (select 1 from book_access ba where ba.entry_id = b.id and ba.member_id = ${meId}))`;
  return r[0] || null;
}

// Who hears that a dose is not marked: the family on Parwah, never the
// person themselves (they had the nudge), and only those who may read at
// least one of the medicines - a private one tells nobody it is not shared with.
export async function alertRecipients(sql, circleId, personId, medIds) {
  return sql`
    select distinct m.id from members m
    join family_book b on b.id = any(${medIds}::uuid[])
    where m.circle_id = ${circleId} and m.id <> ${personId} and m.user_id is not null
      and (b.visibility = 'circle' or b.about_member = m.id or b.by_member = m.id
           or exists (select 1 from book_access ba where ba.entry_id = b.id and ba.member_id = m.id))`;
}

// ---------- the sweep: nudge once, then tell the family once ----------
// Someone marked as remembered is never nudged, and the family is never
// told they missed a dose: both claims skip them. The flag is read through
// the row, so this works on a database where no module has added it yet.
export async function sweepDoses(sql, circleId) {
  try { await ensureDoseSchema(sql); await fillDoses(sql, circleId); } catch (e) { return 0; }
  const nudged = await sql`
    update medicine_doses d set nudged_at = now()
    where d.circle_id = ${circleId} and d.status = 'due' and d.nudged_at is null
      and d.due_at <= now() - make_interval(mins => ${NUDGE_AFTER_MIN})
      and d.due_at > now() - make_interval(mins => ${NUDGE_AFTER_MIN + SEND_WINDOW_MIN})
      and to_char(now() at time zone d.tz, 'HH24:MI') between ${WAKE_FROM} and ${WAKE_TO}
      and not exists (select 1 from members m where m.id = d.person_id and coalesce((to_jsonb(m)->>'remembered')::boolean, false))
    returning d.id, d.person_id, d.slot`;
  const alerted = await sql`
    update medicine_doses d set alerted_at = now()
    where d.circle_id = ${circleId} and d.status = 'due' and d.alerted_at is null
      and d.due_at <= now() - make_interval(mins => ${ALERT_AFTER_MIN})
      and d.due_at > now() - make_interval(mins => ${ALERT_AFTER_MIN + SEND_WINDOW_MIN})
      and to_char(now() at time zone d.tz, 'HH24:MI') between ${WAKE_FROM} and ${WAKE_TO}
      and not exists (select 1 from members m where m.id = d.person_id and coalesce((to_jsonb(m)->>'remembered')::boolean, false))
    returning d.id, d.person_id, d.slot, d.medicine_id`;
  // One message per person per time, however many medicines share it.
  const group = (rows) => { const g = new Map(); for (const r of rows) { const k = r.person_id + '|' + r.slot; if (!g.has(k)) g.set(k, []); g.get(k).push(r); } return g; };
  for (const [, rows] of group(nudged)) {
    await pushCircle(sql, circleId, {
      title: '💊 Your ' + slot12(rows[0].slot) + ' medicines',
      body: 'Tap the tick in Parwah once you have had them. If you skipped them, you can say so.',
      url: '/#home', urgent: true
    }, { only: rows[0].person_id });
  }
  for (const [, rows] of group(alerted)) {
    const who = (await sql`select name from members where id = ${rows[0].person_id}`)[0];
    const to = await alertRecipients(sql, circleId, rows[0].person_id, rows.map(r => r.medicine_id));
    for (const t of to) {
      await pushCircle(sql, circleId, {
        title: '💊 ' + (who ? who.name : 'Someone') + "'s " + slot12(rows[0].slot) + ' medicines are not marked',
        body: 'Not marked in 2 hours. A tick is what was marked, not a check, so a call may be the kind thing.',
        url: '/#people'
      }, { only: t.id });
    }
  }
  return nudged.length + alerted.length;
}

// ---------- reads ----------
export async function doseState(sql, circle, me, personId) {
  await fillDoses(sql, circle.id);
  const person = isUuid(personId) ? personId : null;
  const schedules = await sql`
    select s.id, s.person_id, s.medicine_id, s.times, s.days, s.tz, b.name, b.visibility, m.name as person_name
    from medicine_schedules s
    join family_book b on b.id = s.medicine_id
    join members m on m.id = s.person_id
    where s.circle_id = ${circle.id} and s.active
      and (${person}::uuid is null or s.person_id = ${person}::uuid)
      and (b.visibility = 'circle' or b.about_member = ${me.id} or b.by_member = ${me.id}
           or exists (select 1 from book_access ba where ba.entry_id = b.id and ba.member_id = ${me.id}))
    order by m.name, b.name`;
  const doses = await sql`
    select d.id, d.person_id, d.medicine_id, d.slot, d.due_at, d.status, d.taken_at, d.skip_reason,
           to_char(d.due_at at time zone d.tz, 'YYYY-MM-DD') as day,
           (d.due_at at time zone d.tz)::date = (now() at time zone d.tz)::date as today,
           (d.status = 'due' and d.due_at < now()) as passed,
           b.name, m.name as person_name, mb.name as marked_by_name, d.marked_by
    from medicine_doses d
    join family_book b on b.id = d.medicine_id
    join members m on m.id = d.person_id
    left join members mb on mb.id = d.marked_by
    where d.circle_id = ${circle.id}
      and (${person}::uuid is null or d.person_id = ${person}::uuid)
      and (d.due_at at time zone d.tz)::date > (now() at time zone d.tz)::date - ${HISTORY_DAYS}::int
      and (d.due_at at time zone d.tz)::date <= (now() at time zone d.tz)::date
      and (b.visibility = 'circle' or b.about_member = ${me.id} or b.by_member = ${me.id}
           or exists (select 1 from book_access ba where ba.entry_id = b.id and ba.member_id = ${me.id}))
    order by d.due_at, b.name limit 600`;
  return { schedules, doses, skipReasons: SKIP_REASONS };
}

// ---------- writes ----------
const no = (status, error) => ({ status, json: { ok: false, error } });
const yes = (json) => ({ status: 200, json: { ok: true, ...json } });

async function moveStock(sql, circleId, dose, by) {
  // The pack this medicine is counted in, if the family keeps one.
  await sql`
    update medicine_inventory set units_remaining = greatest(0, units_remaining + ${by}),
           estimated_depletion_date = now() + make_interval(days => floor(greatest(0, units_remaining + ${by}) / greatest(daily_consumption_rate, 0.1))::int),
           updated_at = now()
    where id = (select i.id from medicine_inventory i
                left join family_book b on b.id = ${dose.medicine_id}
                where i.circle_id = ${circleId}
                  and (i.medicine_id = ${dose.medicine_id}
                       or (i.medicine_id is null and i.member_id = ${dose.person_id} and lower(i.medicine_name) = lower(b.name)))
                order by (i.medicine_id = ${dose.medicine_id}) desc nulls last limit 1)`;
}

export async function doseAction(sql, circle, me, body, tzHint) {
  const action = body.action;

  if (action === 'dose_schedule_set') {
    const med = await readableMed(sql, circle.id, me.id, body.medicineId);
    if (!med) return no(404, 'That medicine is not in Health & contacts, or it is not shared with you');
    if (!med.about_member) return no(400, 'Say whose medicine this is first, in Health & contacts');
    const times = cleanTimes(body.times);
    if (!times) return no(400, 'Pick one to six times, like 08:00 or 21:00');
    const days = cleanDays(body.days);
    if (Array.isArray(body.days) && body.days.length && !days.length && body.days.length !== 7) return no(400, 'Pick at least one day');
    const tz = await pgTz(sql, validTz(body.tz) || tzHint || 'Asia/Kolkata');
    const r = await sql`
      insert into medicine_schedules (circle_id, person_id, medicine_id, times, days, tz, created_by)
      values (${circle.id}, ${med.about_member}, ${med.id}, ${times}::text[], ${days}::int[], ${tz}, ${me.id})
      on conflict (medicine_id) do update set times = excluded.times, days = excluded.days, tz = excluded.tz,
        person_id = excluded.person_id, active = true, since = now(), updated_at = now()
      returning id`;
    // Times that were changed away: what has not happened yet is dropped,
    // what already happened stays in the history as it was.
    await sql`delete from medicine_doses where schedule_id = ${r[0].id} and status = 'due' and due_at > now()`;
    await fillDoses(sql, circle.id);
    if (med.about_member !== me.id) {
      await pushCircle(sql, circle.id, { title: '💊 ' + me.name + ' set your medicine times', body: 'Open Parwah to see them. You can change them any time.', url: '/#home' }, { only: med.about_member });
    }
    return yes({ id: r[0].id, times, days });
  }

  if (action === 'dose_schedule_off') {
    const med = await readableMed(sql, circle.id, me.id, body.medicineId);
    if (!med) return no(404, 'That medicine is not in Health & contacts, or it is not shared with you');
    const r = await sql`update medicine_schedules set active = false, updated_at = now()
                        where medicine_id = ${med.id} and circle_id = ${circle.id} returning id`;
    if (r[0]) await sql`delete from medicine_doses where schedule_id = ${r[0].id} and status = 'due' and due_at > now()`;
    return yes({});
  }

  if (action === 'dose_mark') {
    const ids = (Array.isArray(body.doseIds) ? body.doseIds : [body.doseId]).filter(isUuid).slice(0, 30);
    if (!ids.length) return no(400, 'Pick a dose');
    const status = body.status === 'skipped' ? 'skipped' : 'taken';
    const reason = status === 'skipped' ? (String(body.reason || '').trim().slice(0, 120) || null) : null;
    const rows = await sql`
      select d.id, d.person_id, d.medicine_id, d.slot, d.status, d.due_at, m.name as person_name
      from medicine_doses d
      join family_book b on b.id = d.medicine_id
      join members m on m.id = d.person_id
      where d.id = any(${ids}::uuid[]) and d.circle_id = ${circle.id}
        and (b.visibility = 'circle' or b.about_member = ${me.id} or b.by_member = ${me.id}
             or exists (select 1 from book_access ba where ba.entry_id = b.id and ba.member_id = ${me.id}))`;
    if (rows.length !== ids.length) return no(404, 'That dose is not here, or it is not shared with you');
    if (rows.some(r => new Date(r.due_at).getTime() > Date.now() + 3 * 3600000)) return no(409, 'That one is later - mark it nearer the time');
    let marked = 0;
    for (const d of rows) {
      const u = await sql`update medicine_doses set status = ${status}, taken_at = now(), marked_by = ${me.id}, skip_reason = ${reason}
                          where id = ${d.id} and status = 'due' returning id`;
      if (!u[0]) continue;   // someone else marked it a moment ago
      marked++;
      if (status === 'taken') await moveStock(sql, circle.id, d, -1);
    }
    if (marked) {
      const d = rows[0];
      const what = status === 'taken' ? 'as taken' : 'as skipped' + (reason ? ' (' + reason + ')' : '');
      await sql`insert into events (circle_id, member_id, type, text) values (${circle.id}, ${me.id}, 'care',
        ${d.person_id === me.id ? me.name + ' marked the ' + slot12(d.slot) + ' medicines ' + what
                                : me.name + ' marked ' + d.person_name + "'s " + slot12(d.slot) + ' medicines ' + what})`;
    }
    return yes({ marked, status });
  }

  if (action === 'dose_undo') {
    if (!isUuid(body.doseId)) return no(400, 'Pick a dose');
    const r = await sql`select d.* from medicine_doses d where d.id = ${body.doseId} and d.circle_id = ${circle.id}`;
    const d = r[0];
    if (!d || !(await readableMed(sql, circle.id, me.id, d.medicine_id))) return no(404, 'That dose is not here, or it is not shared with you');
    if (d.status === 'due') return no(409, 'That one is not marked');
    if (d.marked_by !== me.id && d.person_id !== me.id) return no(403, 'Only whoever marked it, or the person it is for, can undo it');
    const u = await sql`update medicine_doses set status = 'due', taken_at = null, marked_by = null, skip_reason = null
                        where id = ${d.id} and status = ${d.status} returning id`;
    if (u[0] && d.status === 'taken') await moveStock(sql, circle.id, d, 1);
    return yes({});
  }

  return no(400, 'Unknown action');
}

export default async function dosesApi(req, res) {
  let sql;
  try { sql = db(); await ensureDoseSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const get = req.method === 'GET';
    const g = await requireMember(sql, get ? q.circle : body.code, get ? q.member : body.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    if (get) {
      if (q.person && !isUuid(q.person)) return res.status(400).json({ ok: false, error: 'Bad person' });
      return res.status(200).json({ ok: true, ...(await doseState(sql, g.circle, g.me, q.person)) });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    const out = await doseAction(sql, g.circle, g.me, body, reqTz(req));
    return res.status(out.status).json(out.json);
  } catch (e) { return fail(res, e); }
}
