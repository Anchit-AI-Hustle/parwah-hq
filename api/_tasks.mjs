// FAMILY TASKS: who is handling it, by when, and whether it is done.
//
// A task is a row in `requests` (the table the circle's "anyone can pick
// this up" jobs always lived in), grown into a whole lifecycle:
//
//   open      nobody owns it yet - anyone may take it
//   assigned  given to one person, waiting for their yes
//   claimed   someone owns it and has said yes
//   done      finished, by whom, when, with an optional note
//   archived  put away; kept for the history, never shown as to-do
//
// Times are stored in UTC (due_at, timestamptz) together with the family's
// time zone, so "every day at 9" stays 9 at home even where clocks change.
// A repeating task is one row per occurrence: finishing one creates the next,
// and a unique index makes sure finishing twice never creates two.
//
// Overdue alerts claim themselves with a single conditional UPDATE
// (overdue_alerted_for = due_at), so any number of phones checking at once
// send each alert exactly once per occurrence.
import { randomUUID } from 'node:crypto';
import { isUuid } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { REPEATS, validTz, fromWall, nextDue, localDate } from './_recur.mjs';
export { REPEATS, nextDue };

export const ESCALATE = ['people', 'everyone'];
const OPEN = ['open', 'assigned', 'claimed'];

let taskReady = false;
// Two requests creating the same table at the same instant can collide in
// Postgres even with "if not exists"; the loser simply runs it again.
export async function ensureTaskSchema(sql) {
  if (taskReady) return;
  try { await createTaskSchema(sql); }
  catch (e) {
    if (!['23505', '42P07', '42710'].includes(e && e.code)) throw e;
    await createTaskSchema(sql);
  }
  taskReady = true;
}
async function createTaskSchema(sql) {
  await sql`alter table requests add column if not exists due_date date`;
  await sql`alter table requests add column if not exists about_member uuid references members(id) on delete set null`;
  await sql`alter table requests add column if not exists due_at timestamptz`;
  await sql`alter table requests add column if not exists all_day boolean not null default false`;
  await sql`alter table requests add column if not exists tz text`;
  await sql`alter table requests add column if not exists recurrence text not null default 'once'`;
  await sql`alter table requests add column if not exists series_id uuid`;
  await sql`alter table requests add column if not exists series_anchor timestamptz`;
  await sql`alter table requests add column if not exists done_when text`;
  await sql`alter table requests add column if not exists notes text`;
  await sql`alter table requests add column if not exists escalate text not null default 'people'`;
  await sql`alter table requests add column if not exists acknowledged_at timestamptz`;
  await sql`alter table requests add column if not exists completed_at timestamptz`;
  await sql`alter table requests add column if not exists completed_by uuid references members(id) on delete set null`;
  await sql`alter table requests add column if not exists completion_note text`;
  await sql`alter table requests add column if not exists archived_at timestamptz`;
  await sql`alter table requests add column if not exists overdue_alerted_for timestamptz`;
  await sql`create unique index if not exists requests_series_due on requests (series_id, due_at) where series_id is not null`;
  await sql`create table if not exists task_log (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references requests(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid references members(id) on delete set null,
    action text not null,
    note text,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists task_log_task on task_log (task_id, created_at)`;
}

// Due time from what the form sends: an instant (dueAt), or a calendar date
// alone (dueDate), which means "by the end of that day" at home.
function parseDue(body, tz) {
  if (body.dueAt) {
    const t = Date.parse(body.dueAt);
    if (!isFinite(t)) return { error: 'That date and time could not be read' };
    if (t < Date.UTC(2020, 0, 1) || t > Date.now() + 5 * 366 * 86400000) return { error: 'Pick a date within the next five years' };
    return { at: t, allDay: false };
  }
  const d = String(body.dueDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, dd] = d.split('-').map(Number);
    return { at: fromWall({ y, m, d: dd, h: 23, mi: 59, s: 0 }, tz), allDay: true };
  }
  return { at: null, allDay: false };
}

async function log(sql, task, me, action, note) {
  await sql`insert into task_log (task_id, circle_id, member_id, action, note)
            values (${task.id}, ${task.circle_id}, ${me ? me.id : null}, ${action}, ${note || null})`;
}
async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
}
async function tell(sql, circleId, ids, payload, notMe) {
  const seen = new Set();
  for (const id of ids) {
    if (!id || id === notMe || seen.has(id)) continue;
    seen.add(id);
    await pushCircle(sql, circleId, payload, { only: id });
  }
}
async function memberIn(sql, circleId, id) {
  if (!isUuid(id)) return null;
  const r = await sql`select id, name, role, user_id is not null as on_app from members where id = ${id} and circle_id = ${circleId}`;
  return r[0] || null;
}
// Someone added to the family tree by name never signs in: a task can be
// ABOUT them, never given TO them.
function offApp(m) { return m && m.on_app === false ? m.name + ' is not on Parwah, so cannot take a task. Give it to someone who is.' : null;
}
const clip = (s, n) => { const t = String(s == null ? '' : s).trim().slice(0, n); return t || null; };

// ---------- reads ----------
export async function taskList(sql, circleId) {
  return sql`
    select q.id, q.title, q.status, q.created_at, q.due_date, q.due_at, q.all_day, q.tz, q.recurrence,
           q.done_when, q.notes, q.escalate, q.acknowledged_at, q.completed_at, q.completion_note,
           q.about_member, q.by_member, q.claimed_by, q.completed_by,
           (q.due_at is not null and q.due_at < now() and q.status in ('open','assigned','claimed')) as overdue,
           b.name as by_name, c.name as claimed_name, a.name as about_name, d.name as completed_name
    from requests q
    left join members b on b.id = q.by_member
    left join members c on c.id = q.claimed_by
    left join members a on a.id = q.about_member
    left join members d on d.id = q.completed_by
    where q.circle_id = ${circleId}
      and (q.status in ('open','assigned','claimed')
           or (q.status = 'done' and q.completed_at > now() - interval '3 days'))
    order by (q.status = 'done'), q.due_at nulls last, q.due_date nulls last, q.created_at desc
    limit 80`;
}

export async function taskHistory(sql, circleId, taskId) {
  if (!isUuid(taskId)) return null;
  const t = await sql`select id from requests where id = ${taskId} and circle_id = ${circleId}`;
  if (!t[0]) return null;
  return sql`select l.action, l.note, l.created_at, m.name
             from task_log l left join members m on m.id = l.member_id
             where l.task_id = ${taskId} order by l.created_at, l.id limit 100`;
}

// ---------- overdue ----------
// Each occurrence alerts once. The UPDATE is the lock: a second sweep, even
// a simultaneous one, finds overdue_alerted_for already equal to due_at.
export async function sweepOverdue(sql, circleId) {
  const due = await sql`
    update requests set overdue_alerted_for = due_at
    where circle_id = ${circleId} and status in ('open','assigned','claimed')
      and due_at is not null and due_at < now()
      and overdue_alerted_for is distinct from due_at
    returning id, circle_id, title, status, by_member, claimed_by, escalate`;
  for (const t of due) {
    const who = t.claimed_by ? await memberIn(sql, circleId, t.claimed_by) : null;
    await log(sql, t, null, 'overdue', null);
    await feed(sql, circleId, null, who
      ? `Running late: ${t.title} (${who.name} has it)`
      : `Running late and nobody has it yet: ${t.title}`);
    const payload = {
      title: '⏰ Running late: ' + t.title,
      body: who
        ? (t.status === 'assigned' ? who.name + ' has not said yes yet. ' : who.name + ' has it. ')
          + 'Open Parwah to mark it done, set a new time or hand it to someone.'
        : 'Nobody has taken it yet. Open Parwah to take it or give it to someone.',
      url: '/#care'
    };
    if (t.escalate === 'everyone' || !t.claimed_by) await pushCircle(sql, circleId, payload, {});
    else await tell(sql, circleId, [t.claimed_by, t.by_member], payload, null);
  }
  return due.length;
}

// ---------- writes ----------
const ok = (status, json) => ({ status, json: { ok: true, ...json } });
const no = (status, error) => ({ status, json: { ok: false, error } });

export async function createTask(sql, circle, me, body) {
  const title = clip(body.title, 200);
  if (!title) return no(400, 'Say what needs doing');
  const tz = validTz(body.tz) || 'Asia/Kolkata';
  const due = parseDue(body, tz);
  if (due.error) return no(400, due.error);
  const rec = REPEATS.includes(body.recurrence) ? body.recurrence : 'once';
  if (rec !== 'once' && !due.at) return no(400, 'A repeating task needs a first date and time');
  const esc = ESCALATE.includes(body.escalate) ? body.escalate : 'people';
  const about = body.aboutMemberId ? await memberIn(sql, circle.id, body.aboutMemberId) : null;
  if (body.aboutMemberId && !about) return no(404, 'That person is not in this family');
  let owner = null;
  if (body.ownerId === 'me') owner = me;
  else if (body.ownerId) { owner = await memberIn(sql, circle.id, body.ownerId); if (!owner) return no(404, 'That person is not in this family'); }
  if (offApp(owner)) return no(400, offApp(owner));
  const status = !owner ? 'open' : owner.id === me.id ? 'claimed' : 'assigned';
  const dueAt = due.at ? new Date(due.at) : null;
  // A task written down after its time has passed is not news to the
  // family: it shows as late, but nobody is woken up about it.
  const r = await sql`
    insert into requests (circle_id, by_member, title, status, claimed_by, due_at, all_day, tz, due_date,
                          recurrence, series_id, series_anchor, done_when, notes, escalate, about_member,
                          acknowledged_at, overdue_alerted_for)
    values (${circle.id}, ${me.id}, ${title}, ${status}, ${owner ? owner.id : null}, ${dueAt}, ${due.allDay}, ${tz},
            ${due.at ? localDate(due.at, tz) : null}, ${rec},
            ${rec !== 'once' ? randomUUID() : null}, ${rec !== 'once' ? dueAt : null},
            ${clip(body.doneWhen, 200)}, ${clip(body.notes, 500)}, ${esc}, ${about ? about.id : null},
            ${status === 'claimed' ? new Date() : null},
            ${dueAt && dueAt.getTime() < Date.now() ? dueAt : null})
    returning id, circle_id`;
  const t = r[0];
  await log(sql, t, me, 'created', null);
  if (owner && owner.id !== me.id) await log(sql, t, me, 'assigned', owner.name);
  if (status === 'claimed') await log(sql, t, me, 'acknowledged', null);
  await feed(sql, circle.id, me.id, owner && owner.id !== me.id
    ? `${me.name} asked ${owner.name}: ${title}`
    : owner ? `${me.name} is doing: ${title}` : `${me.name} asked the family: ${title}`);
  if (owner && owner.id !== me.id) {
    await pushCircle(sql, circle.id, { title: '🤝 ' + me.name + ' asked you', body: title + ' - open Parwah to say yes or hand it back', url: '/#care' }, { only: owner.id });
  } else if (!owner) {
    await pushCircle(sql, circle.id, { title: '🤝 ' + me.name + ' needs a hand', body: title + ' - first to tap "I\'m on it" takes it', url: '/#care' }, { except: me.id });
  }
  return ok(201, { id: t.id, status });
}

async function load(sql, circle, id) {
  if (!isUuid(id)) return null;
  const r = await sql`select * from requests where id = ${id} and circle_id = ${circle.id}`;
  return r[0] || null;
}
const isMine = (t, me) => t.by_member === me.id || t.claimed_by === me.id;

export async function taskAction(sql, circle, me, body) {
  const action = body.action;
  if (action === 'task_create') return createTask(sql, circle, me, body);
  const t = await load(sql, circle, body.taskId || body.requestId);
  if (!t) return no(404, 'That task is not here any more');

  // I'm on it: take an open task, or say yes to one given to me.
  if (action === 'task_ack' || action === 'request_claim') {
    if (t.status === 'assigned' && t.claimed_by !== me.id) return no(403, 'This one is waiting for the person it was given to');
    if (t.status !== 'open' && t.status !== 'assigned') return no(409, t.claimed_by === me.id ? 'You already have this one' : 'Someone already took this');
    const r = await sql`update requests set status = 'claimed', claimed_by = ${me.id}, acknowledged_at = now()
                        where id = ${t.id} and status = ${t.status}
                          and (claimed_by is null or claimed_by = ${me.id}) returning id`;
    if (!r[0]) return no(409, 'Someone already took this');
    await log(sql, t, me, 'acknowledged', null);
    await feed(sql, circle.id, me.id, `${me.name} is on it: ${t.title}`);
    await tell(sql, circle.id, [t.by_member], { title: '🙌 ' + me.name + ' is on it', body: t.title, url: '/#care' }, me.id);
    return ok(200, { status: 'claimed' });
  }

  // Hand it back: the owner lets go, and it is open to anyone again.
  if (action === 'task_decline') {
    if (t.claimed_by !== me.id || !OPEN.includes(t.status)) return no(403, 'Only the person who has it can hand it back');
    const r = await sql`update requests set status = 'open', claimed_by = null, acknowledged_at = null
                        where id = ${t.id} and claimed_by = ${me.id} and status in ('assigned','claimed') returning id`;
    if (!r[0]) return no(409, 'This changed a moment ago - have another look');
    await log(sql, t, me, 'declined', clip(body.note, 280));
    await feed(sql, circle.id, me.id, `${me.name} handed back: ${t.title}. Anyone can take it.`);
    await pushCircle(sql, circle.id, { title: '🤝 Needs someone: ' + t.title, body: me.name + ' cannot do it. Tap "I\'m on it" to take it.', url: '/#care' }, { except: me.id });
    return ok(200, { status: 'open' });
  }

  // Give it to someone (or to nobody, so anyone can take it).
  if (action === 'task_assign') {
    if (!OPEN.includes(t.status)) return no(409, 'Only a task that is still to do can be handed over');
    if (!isMine(t, me)) return no(403, 'Only the person who asked or the person who has it can hand it over');
    let to = null;
    if (body.ownerId) { to = await memberIn(sql, circle.id, body.ownerId); if (!to) return no(404, 'That person is not in this family'); }
    if (offApp(to)) return no(400, offApp(to));
    const status = !to ? 'open' : to.id === me.id ? 'claimed' : 'assigned';
    await sql`update requests set status = ${status}, claimed_by = ${to ? to.id : null},
                acknowledged_at = ${status === 'claimed' ? new Date() : null}
              where id = ${t.id}`;
    await log(sql, t, me, 'assigned', to ? to.name : 'anyone');
    await feed(sql, circle.id, me.id, to ? `${me.name} gave ${to.name}: ${t.title}` : `${me.name} opened up to anyone: ${t.title}`);
    if (to && to.id !== me.id) await pushCircle(sql, circle.id, { title: '🤝 ' + me.name + ' asked you', body: t.title + ' - open Parwah to say yes or hand it back', url: '/#care' }, { only: to.id });
    return ok(200, { status });
  }

  if (action === 'task_edit') {
    if (!OPEN.includes(t.status)) return no(409, 'Reopen it first to change it');
    if (!isMine(t, me)) return no(403, 'Only the person who asked or the person who has it can change it');
    const title = body.title !== undefined ? clip(body.title, 200) : t.title;
    if (!title) return no(400, 'Say what needs doing');
    const tz = validTz(body.tz) || t.tz || 'Asia/Kolkata';
    let dueAt = t.due_at, allDay = t.all_day, dueDate = t.due_date;
    if (body.dueAt !== undefined || body.dueDate !== undefined) {
      if (!body.dueAt && !body.dueDate) { dueAt = null; allDay = false; dueDate = null; }
      else {
        const d = parseDue(body, tz); if (d.error) return no(400, d.error);
        dueAt = new Date(d.at); allDay = d.allDay; dueDate = localDate(d.at, tz);
      }
    }
    const rec = body.recurrence !== undefined ? (REPEATS.includes(body.recurrence) ? body.recurrence : 'once') : t.recurrence;
    if (rec !== 'once' && !dueAt) return no(400, 'A repeating task needs a date and time');
    const esc = body.escalate !== undefined ? (ESCALATE.includes(body.escalate) ? body.escalate : 'people') : t.escalate;
    const doneWhen = body.doneWhen !== undefined ? clip(body.doneWhen, 200) : t.done_when;
    const notes = body.notes !== undefined ? clip(body.notes, 500) : t.notes;
    // Who it is for can change too ("For whom": anyone in the family, or
    // the whole family when empty).
    let aboutId = t.about_member;
    if (body.aboutMemberId !== undefined) {
      if (!body.aboutMemberId) aboutId = null;
      else { const a = await memberIn(sql, circle.id, body.aboutMemberId); if (!a) return no(404, 'That person is not in this family'); aboutId = a.id; }
    }
    const series = rec === 'once' ? null : (t.series_id || randomUUID());
    await sql`update requests set title = ${title}, due_at = ${dueAt}, all_day = ${allDay}, due_date = ${dueDate},
                tz = ${tz}, recurrence = ${rec}, series_id = ${series},
                series_anchor = ${rec === 'once' ? null : (t.recurrence === rec && t.series_anchor ? t.series_anchor : dueAt)},
                escalate = ${esc}, done_when = ${doneWhen}, notes = ${notes}, about_member = ${aboutId}
              where id = ${t.id}`;
    await log(sql, t, me, 'edited', null);
    return ok(200, {});
  }

  // Done. The owner finishes it; an open task can be finished by anyone;
  // the person who asked can close it too.
  if (action === 'task_done' || action === 'request_done') {
    if (!OPEN.includes(t.status)) return no(409, t.status === 'done' ? 'Already done' : 'This one was put away');
    if (t.claimed_by && t.claimed_by !== me.id && t.by_member !== me.id) return no(403, 'Only the person who has it, or who asked, can mark it done');
    const note = clip(body.note, 280);
    const r = await sql`update requests set status = 'done', completed_at = now(), completed_by = ${me.id},
                          completion_note = ${note}, claimed_by = coalesce(claimed_by, ${me.id})
                        where id = ${t.id} and status in ('open','assigned','claimed') returning id`;
    if (!r[0]) return no(409, 'Already done');
    await log(sql, t, me, 'done', note);
    await feed(sql, circle.id, me.id, `${me.name} finished: ${t.title} ✔` + (note ? ' - ' + note : ''));
    await tell(sql, circle.id, [t.by_member, t.claimed_by], { title: '✔ ' + me.name + ' finished it', body: t.title + (note ? ' - ' + note : ''), url: '/#care' }, me.id);
    let next = null;
    if (t.recurrence !== 'once' && t.due_at && t.series_id) {
      const n = nextDue(new Date(t.due_at).getTime(), t.recurrence, t.tz, t.series_anchor ? new Date(t.series_anchor).getTime() : null);
      if (n) {
        // The next one goes to whoever had this one; an open one stays open.
        const owner = t.claimed_by || null;
        const nextStatus = !owner ? 'open' : t.status === 'assigned' ? 'assigned' : 'claimed';
        const ins = await sql`
          insert into requests (circle_id, by_member, title, status, claimed_by, acknowledged_at, due_at, all_day, tz, due_date,
                                recurrence, series_id, series_anchor, done_when, notes, escalate, about_member)
          values (${t.circle_id}, ${t.by_member}, ${t.title}, ${nextStatus}, ${owner}, ${nextStatus === 'claimed' ? new Date() : null}, ${new Date(n)}, ${t.all_day}, ${t.tz},
                  ${localDate(n, t.tz || 'Asia/Kolkata')}, ${t.recurrence}, ${t.series_id}, ${t.series_anchor},
                  ${t.done_when}, ${t.notes}, ${t.escalate}, ${t.about_member})
          on conflict do nothing returning id, circle_id`;
        if (ins[0]) { next = ins[0].id; await log(sql, ins[0], me, 'created', 'next time'); }
      }
    }
    return ok(200, { status: 'done', next });
  }

  if (action === 'task_reopen') {
    if (t.status !== 'done') return no(409, 'Only a finished task can be reopened');
    if (!isMine(t, me) && t.completed_by !== me.id) return no(403, 'Only the person who asked, had it or finished it can reopen it');
    const status = t.claimed_by ? 'claimed' : 'open';
    const r = await sql`update requests set status = ${status}, completed_at = null, completed_by = null, completion_note = null
                        where id = ${t.id} and status = 'done' returning id`;
    if (!r[0]) return no(409, 'This changed a moment ago - have another look');
    await log(sql, t, me, 'reopened', clip(body.note, 280));
    await feed(sql, circle.id, me.id, `${me.name} reopened: ${t.title}`);
    await tell(sql, circle.id, [t.claimed_by, t.by_member], { title: '↩ Reopened: ' + t.title, body: me.name + ' reopened it' + (body.note ? ' - ' + clip(body.note, 120) : ''), url: '/#care' }, me.id);
    return ok(200, { status });
  }

  if (action === 'task_archive') {
    if (t.status === 'archived') return ok(200, { status: 'archived' });
    if (!isMine(t, me)) return no(403, 'Only the person who asked or the person who has it can put it away');
    await sql`update requests set status = 'archived', archived_at = now() where id = ${t.id}`;
    await log(sql, t, me, 'archived', null);
    return ok(200, { status: 'archived' });
  }

  return no(400, 'Unknown action');
}
