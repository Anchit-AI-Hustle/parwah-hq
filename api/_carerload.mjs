// CARER LOAD AND RESPITE ("Thoda sa haath batao"). Behind
// /api/care?area=carerload (no new function: the project is at its cap).
//
// Nothing new is counted. From what the family already does in Parwah
// (a task marked done, a medicine ticked for someone else, a doctor visit
// written down, a call on the rota, a child collected) this:
//   - shows each adult, PRIVATELY, what they themself did in the last
//     seven days. Nobody is ever sent another person's numbers;
//   - shows the adults one gentle line with no number in it, only when one
//     person has carried most of the looking-after two weeks running:
//     "Priya has been doing a lot for Maa lately. Could someone take
//     Thursday?" The person looked after is not shown it;
//   - lets anyone tap "I need a day off" and ask the other adults for a
//     named day, and a named task if they choose one.
// Never a leaderboard. A family can switch the whole thing off.
//
//   GET  /api/care?area=carerload&circle=CODE&member=ID
//        -> { on, adult, mine: { total, lines, note }, line, duties, asks, days }
//   POST /api/care {action: 'carer_switch', on}
//        {action: 'carer_dayoff', day, taskId?}     {action: 'carer_take', id}     {action: 'carer_cancel', id}
//
// For the adults only: a child or a teenager is sent none of it.
import { db, ensureSchema, requireMember, isUuid, schemaOnce, rateLimit } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { reqTz, validTz, dayIn } from './_recur.mjs';
import { ensureAudienceSchema, audienceFor, minorOf } from './_audience.mjs';
import { ensureTaskSchema } from './_tasks.mjs';
import { CARER_KINDS, DAYOFF_PER_DAY, DAYOFF_AHEAD_DAYS, carerTop, carerLine, carerMine, dayoffClean, dayWords, dayoffPush, dayoffTakenPush } from './_carerloadrules.mjs';

// The clock can be handed in by a test; nothing else sets it.
export const carerSeams = { now: null };
const nowOf = () => (carerSeams.now ? carerSeams.now() : Date.now());
const HOME_TZ = 'Asia/Kolkata';
const WEEK = 7 * 86400000;
const bad = (res, status, error) => res.status(status).json({ ok: false, error });

let ready = false;
export async function ensureCarerSchema(sql) {
  if (ready) return;
  await ensureAudienceSchema(sql);
  await ensureTaskSchema(sql);
  await schemaOnce(async () => {
    // The family's own switch. No row means on.
    await sql`create table if not exists carer_prefs (
      circle_id uuid primary key references circles(id) on delete cascade,
      is_on boolean not null default true,
      set_by uuid references members(id) on delete set null,
      set_at timestamptz not null default now()
    )`;
    await sql`create table if not exists carer_asks (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      by_member uuid not null references members(id) on delete cascade,
      day date not null,
      task_id uuid references requests(id) on delete set null,
      status text not null default 'open' check (status in ('open', 'taken', 'cancelled')),
      taken_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      taken_at timestamptz
    )`;
    // One open ask per person per day.
    await sql`create unique index if not exists carer_asks_one on carer_asks (by_member, day) where status = 'open'`;
  });
  ready = true;
}

// A family that never used one of these features has no table for it:
// that source is simply empty.
const maybe = async (f) => { try { return await f(); } catch (e) { if (e && e.code === '42P01') return []; throw e; } };

// Every act of looking after someone else in a window: who did it, what
// kind, and for whom. Read on the server only; what leaves is the caller's
// own numbers and a line with no number in it.
export async function carerActs(sql, circleId, from, to) {
  const tasks = await maybe(() => sql`
    select l.member_id as who, (case when q.template = 'callrota' then 'calls' else 'tasks' end) as kind, q.about_member as for_id
    from task_log l join requests q on q.id = l.task_id
    where l.circle_id = ${circleId} and l.action = 'done' and l.member_id is not null
      and l.created_at >= ${from} and l.created_at < ${to} and q.about_member is distinct from l.member_id`);
  const meds = await maybe(() => sql`
    select d.marked_by as who, 'medicines' as kind, d.person_id as for_id from medicine_doses d
    where d.circle_id = ${circleId} and d.status = 'taken' and d.marked_by is not null and d.marked_by <> d.person_id
      and d.taken_at >= ${from} and d.taken_at < ${to}`);
  const visits = await maybe(() => sql`
    select a.created_by as who, 'visits' as kind, a.person_id as for_id from audio_consultations a
    where a.circle_id = ${circleId} and a.created_by is not null and a.created_by <> a.person_id
      and a.created_at >= ${from} and a.created_at < ${to}`);
  const pickups = await maybe(() => sql`
    select k.picked_by as who, 'pickups' as kind, k.child_id as for_id from kid_pickups k
    where k.circle_id = ${circleId} and k.picked_by is not null and k.picked_at >= ${from} and k.picked_at < ${to}`);
  return [...tasks, ...meds, ...visits, ...pickups];
}
const tally = (acts) => { const w = {}; for (const a of acts) w[a.who] = (w[a.who] || 0) + 1; return w; };

export async function carerState(sql, circle, me, nowMs, tz) {
  const on = ((await sql`select is_on from carer_prefs where circle_id = ${circle.id}`)[0] || { is_on: true }).is_on;
  const adult = !(await minorOf(sql, circle.id, me.id));
  const today = dayIn(tz, nowMs);
  const out = { ok: true, on, adult, today, mine: null, line: null, duties: [], asks: [], days: [] };
  if (!adult || !on) return out;
  const now = new Date(nowMs), weekAgo = new Date(nowMs - WEEK), twoAgo = new Date(nowMs - 2 * WEEK);
  const thisWeek = await carerActs(sql, circle.id, weekAgo, now);
  const lastWeek = await carerActs(sql, circle.id, twoAgo, weekAgo);
  // Mine, and only mine.
  const counts = {}; for (const k of CARER_KINDS) counts[k] = thisWeek.filter(a => a.who === me.id && a.kind === k).length;
  out.mine = carerMine(counts);
  // The gentle line: the adults who could share the load, two weeks running.
  const adults = await audienceFor(sql, circle.id, 'carerload');
  const top = carerTop([tally(thisWeek), tally(lastWeek)], adults);
  if (top) {
    const forTally = {};
    for (const a of [...thisWeek, ...lastWeek]) if (a.who === top && a.for_id) forTally[a.for_id] = (forTally[a.for_id] || 0) + 1;
    const forId = Object.keys(forTally).sort((a, b) => forTally[b] - forTally[a])[0] || null;
    const people = await sql`select id, name, remembered from members where circle_id = ${circle.id} and id = any(${[top, forId].filter(Boolean)}::uuid[])`;
    const topM = people.find(p => p.id === top), forM = people.find(p => p.id === forId && !p.remembered);
    // The soonest thing the person has on their plate in the coming week names the day.
    const next = (await sql`select due_at from requests where circle_id = ${circle.id} and claimed_by = ${top} and status in ('assigned', 'claimed')
                            and due_at > ${now} and due_at < ${new Date(nowMs + WEEK)} order by due_at limit 1`)[0];
    // The person looked after is not shown a line about the work of looking after them.
    if (topM && me.id !== forId) {
      out.line = { text: carerLine({ topName: topM.name, forName: forM ? forM.name : null, day: next ? dayIn(tz, next.due_at) : null, viewerIsTop: me.id === top }), mine: me.id === top };
    }
  }
  // What is on my plate in the next two weeks, to name in an ask.
  out.duties = (await sql`select q.id, q.title, q.due_at, a.name as about_name from requests q left join members a on a.id = q.about_member
                          where q.circle_id = ${circle.id} and q.claimed_by = ${me.id} and q.status in ('assigned', 'claimed')
                            and q.due_at > ${now} and q.due_at < ${new Date(nowMs + DAYOFF_AHEAD_DAYS * 86400000)} order by q.due_at limit 20`)
    .map(d => ({ id: d.id, title: d.title, day: dayIn(tz, d.due_at), aboutName: d.about_name || null }));
  // Open asks, read only by the adults (this whole read is refused to a child above).
  out.asks = (await sql`
    select k.id, k.day::text as day, k.by_member, m.name as by_name, k.status, k.taken_by, t.name as taken_name, q.title as task_title
    from carer_asks k join members m on m.id = k.by_member and not m.remembered
    left join members t on t.id = k.taken_by left join requests q on q.id = k.task_id
    where k.circle_id = ${circle.id} and k.day >= ${today}::date and k.status in ('open', 'taken')
    order by k.day, k.created_at`).map(a => ({ id: a.id, day: a.day, dayWords: dayWords(a.day), byId: a.by_member, byName: a.by_name, mine: a.by_member === me.id,
      status: a.status, takenByName: a.taken_name || null, takenByMe: a.taken_by === me.id, taskTitle: a.task_title || null }));
  for (let i = 0; i <= 7; i++) { const d = new Date(Date.parse(today + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10); out.days.push({ day: d, words: i === 0 ? 'Today' : dayWords(d) }); }
  return out;
}

export default async function carerloadApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureCarerSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, b = req.body || {};
    const get = req.method === 'GET';
    const g = await requireMember(sql, get ? q.circle : b.code, get ? q.member : b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me, nowMs = nowOf();
    const tz = reqTz(req) || validTz(b.tz) || HOME_TZ;
    if (get) return res.status(200).json(await carerState(sql, circle, me, nowMs, tz));
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    if (await minorOf(sql, circle.id, me.id)) return bad(res, 403, 'This is for the adults of the family.');
    const done = async (status = 200) => res.status(status).json(await carerState(sql, circle, me, nowMs, tz));

    if (b.action === 'carer_switch') {
      const on = b.on === true;
      await sql`insert into carer_prefs (circle_id, is_on, set_by) values (${circle.id}, ${on}, ${me.id})
                on conflict (circle_id) do update set is_on = excluded.is_on, set_by = excluded.set_by, set_at = now()`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + (on ? ' turned on' : ' turned off') + ' "Thoda sa haath batao" for the family'})`;
      return done();
    }
    const on = ((await sql`select is_on from carer_prefs where circle_id = ${circle.id}`)[0] || { is_on: true }).is_on;
    if (!on) return bad(res, 409, 'This is switched off for your family. An adult can switch it on again.');

    if (b.action === 'carer_dayoff') {
      const d = dayoffClean(b.day, dayIn(tz, nowMs));
      if (d.error) return bad(res, 400, d.error);
      let task = null;
      if (b.taskId) {
        if (!isUuid(b.taskId)) return bad(res, 404, 'That task is not on your list.');
        task = (await sql`select id, title from requests where id = ${b.taskId} and circle_id = ${circle.id} and claimed_by = ${me.id} and status in ('assigned', 'claimed')`)[0];
        if (!task) return bad(res, 404, 'That task is not on your list.');
      }
      const others = await audienceFor(sql, circle.id, 'carerload', { except: me.id });
      if (!others.length) return bad(res, 409, 'There is no other adult on Parwah in this family to ask yet.');
      const dup = await sql`select 1 from carer_asks where by_member = ${me.id} and day = ${d.value} and status = 'open'`;
      if (dup[0]) return bad(res, 409, 'You have already asked for that day. The family can see it.');
      // What one member can send at the others is limited, and a limiter that cannot count says no.
      if (!(await rateLimit(sql, 'dayoff', me.id, DAYOFF_PER_DAY, 86400, { failClosed: true }))) {
        return bad(res, 429, 'You have asked ' + DAYOFF_PER_DAY + ' times today. A call to someone in the family may be quicker.');
      }
      try {
        await sql`insert into carer_asks (circle_id, by_member, day, task_id) values (${circle.id}, ${me.id}, ${d.value}, ${task ? task.id : null})`;
      } catch (e) {
        if (e && e.code === '23505') return bad(res, 409, 'You have already asked for that day. The family can see it.');
        throw e;
      }
      for (const id of others) await pushCircle(sql, circle.id, dayoffPush(me.name, d.value, task ? task.title : null), { only: id });
      return done(201);
    }
    if (b.action === 'carer_take' || b.action === 'carer_cancel') {
      if (!isUuid(b.id)) return bad(res, 404, 'That ask is not here any more.');
      const ask = (await sql`select k.*, k.day::text as day_text, m.remembered from carer_asks k join members m on m.id = k.by_member where k.id = ${b.id} and k.circle_id = ${circle.id}`)[0];
      if (!ask || ask.remembered) return bad(res, 404, 'That ask is not here any more.');
      if (b.action === 'carer_cancel') {
        if (ask.by_member !== me.id) return bad(res, 403, 'Only the person who asked can take it back.');
        await sql`update carer_asks set status = 'cancelled' where id = ${ask.id} and status = 'open'`;
        return done();
      }
      if (ask.by_member === me.id) return bad(res, 400, 'This is your own ask. Someone else in the family can take it.');
      const claim = await sql`update carer_asks set status = 'taken', taken_by = ${me.id}, taken_at = now() where id = ${ask.id} and status = 'open' returning id`;
      if (!claim[0]) return bad(res, 409, 'Someone has already taken this one.');
      if (ask.task_id) {
        // The named task changes hands, and its history says why.
        const moved = await sql`update requests set claimed_by = ${me.id}, status = 'claimed', acknowledged_at = now()
                                where id = ${ask.task_id} and circle_id = ${circle.id} and claimed_by = ${ask.by_member} and status in ('assigned', 'claimed') returning id`;
        if (moved[0]) await sql`insert into task_log (task_id, circle_id, member_id, action, note) values (${ask.task_id}, ${circle.id}, ${me.id}, 'assigned', 'taken for a day off')`;
      }
      const dayText = ask.day_text;
      await pushCircle(sql, circle.id, dayoffTakenPush(me.name, dayText), { only: ask.by_member });
      return done();
    }
    return bad(res, 400, 'Unknown action');
  } catch (e) { return fail(res, e); }
}
