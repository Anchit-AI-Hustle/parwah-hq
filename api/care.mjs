// The care protocol: reminders and requests, consent-first.
// GET  /api/care?circle=CODE - reminders + open/claimed requests for the circle
// POST /api/care {code, memberId, action, ...} - see ACTIONS below
import { db, ensureSchema, circleByCode, requireMember, isUuid } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { award, today } from './_coins.mjs';
import { ensureTaskSchema, taskList, taskHistory, taskAction, sweepOverdue } from './_tasks.mjs';

async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
}

export async function careState(sql, circleId) {
  const reminders = await sql`
    select r.id, r.title, r.time_of_day, r.due_date, r.recurrence, r.status, r.created_at,
           f.name as for_name, f.id as for_id, b.name as by_name
    from reminders r
    join members f on f.id = r.for_member
    left join members b on b.id = r.by_member
    where r.circle_id = ${circleId} and r.status in ('pending','accepted')
    order by r.created_at desc limit 30`;
  // The family's tasks: still to do, and what was finished in the last days.
  await ensureTaskSchema(sql);
  const requests = await taskList(sql, circleId);
  return { reminders, requests };
}

// WHAT PARWAH ALREADY KNOWS NEEDS DOING.
// The hard part of caring for someone is not claiming a job - it is noticing
// one exists. These are proposed, never created: the family taps to accept.
// Everything here comes from what the circle has already recorded.
export async function careSuggestions(sql, circleId, memberId) {
  const out = [];
  const seen = new Set();
  const add = (s) => { if (!seen.has(s.key)) { seen.add(s.key); out.push(s); } };
  try {
    // Documents about to run out, or already gone.
    const docs = await sql`
      select d.id, d.label, d.expires_on, d.about_member, m.name as about_name
      from vault_docs d join members m on m.id = d.about_member
      where d.circle_id = ${circleId} and d.expires_on is not null
        and d.expires_on < current_date + 90
      order by d.expires_on limit 8`;
    docs.forEach(d => {
      const days = Math.round((new Date(d.expires_on) - Date.now()) / 86400000);
      add({ key: 'doc:' + d.id, kind: 'request',
        title: 'Renew ' + d.label,
        why: days < 0 ? 'Expired ' + Math.abs(days) + ' days ago' : 'Expires in ' + days + ' days',
        urgent: days < 30, forMemberId: d.about_member, forName: d.about_name });
    });
  } catch (e) { /* no vault yet */ }
  try {
    // Things nobody has checked in half a year.
    const stale = await sql`
      select b.id, b.name, b.kind, b.about_member, b.last_verified_at, m.name as about_name
      from family_book b
      left join members m on m.id = b.about_member
      left join book_access ba on ba.entry_id = b.id and ba.member_id = ${memberId || null}
      where b.circle_id = ${circleId}
        and b.kind in ('med','fact','insurance')
        and b.last_verified_at < now() - interval '180 days'
        and (b.visibility = 'circle' or b.about_member = ${memberId || null}
             or b.by_member = ${memberId || null} or ba.member_id is not null)
      order by b.last_verified_at limit 6`;
    stale.forEach(b => {
      const months = Math.round((Date.now() - new Date(b.last_verified_at)) / 2592000000);
      add({ key: 'stale:' + b.id, kind: 'request',
        title: 'Check ' + b.name + ' is still right',
        why: 'Last checked ' + months + ' months ago',
        urgent: false, forMemberId: b.about_member, forName: b.about_name });
    });
  } catch (e) { /* no memory yet */ }
  try {
    // The gaps that matter at a hospital counter.
    const members = await sql`select id, name from members where circle_id = ${circleId} order by created_at limit 12`;
    const facts = await sql`select about_member, kind, category from family_book where circle_id = ${circleId}`;
    const NEED = [
      { cat: 'blood',     kind: 'fact',    label: 'blood group' },
      { cat: 'allergy',   kind: 'fact',    label: 'allergies' },
      { cat: 'doctor',    kind: 'contact', label: "doctor's number" },
      { cat: 'emergency', kind: 'contact', label: 'emergency contact' }
    ];
    members.forEach(m => {
      NEED.forEach(n => {
        const has = facts.some(f => f.about_member === m.id && f.kind === n.kind && f.category === n.cat);
        if (!has) add({ key: 'gap:' + m.id + ':' + n.cat, kind: 'request',
          title: 'Record ' + m.name + "'s " + n.label,
          why: 'Not written down anywhere yet',
          urgent: n.cat === 'blood' || n.cat === 'emergency',
          forMemberId: m.id, forName: m.name });
      });
    });
  } catch (e) { /* no memory yet */ }

  // Never propose something the family is already doing.
  try {
    const open = await sql`select lower(title) as t from requests where circle_id = ${circleId} and status in ('open','assigned','claimed')`;
    const openR = await sql`select lower(title) as t from reminders where circle_id = ${circleId} and status in ('pending','accepted')`;
    const busy = new Set(open.concat(openR).map(x => x.t));
    return out.filter(s => !busy.has(s.title.toLowerCase()))
              .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))
              .slice(0, 8);
  } catch (e) { return out.slice(0, 8); }
}

export async function createReminder(sql, circle, me, { forMemberId, title, timeOfDay, dueDate, recurrence }) {
  const t = String(title || '').trim().slice(0, 140);
  if (!t) return { error: 'The reminder needs a title' };
  const target = isUuid(forMemberId) ? forMemberId : me.id;
  const forRow = await sql`select id, name from members where id = ${target} and circle_id = ${circle.id}`;
  if (!forRow[0]) return { error: 'That person is not in this circle' };
  const self = target === me.id;
  const rec = recurrence === 'daily' ? 'daily' : 'once';
  // Time arrives from a standard time input (HH:MM or HH:MM:SS, 24h);
  // legacy free text (e.g. from older clients) is kept as-is, capped.
  let tod = String(timeOfDay || '').trim().slice(0, 20) || null;
  if (tod && /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(tod)) tod = tod.slice(0, 8);
  // Date arrives from a calendar input as YYYY-MM-DD; daily reminders have no date.
  let due = String(dueDate || '').trim();
  due = (rec === 'once' && /^\d{4}-\d{2}-\d{2}$/.test(due)) ? due : null;
  const status = self ? 'accepted' : 'pending'; // for someone else it is a REQUEST until they accept
  const r = await sql`insert into reminders (circle_id, for_member, by_member, title, time_of_day, due_date, recurrence, status)
            values (${circle.id}, ${target}, ${me.id}, ${t}, ${tod}, ${due}, ${rec}, ${status}) returning id`;
  const when = (due ? ' · ' + due : '') + (tod ? ' · ' + tod : '') + (rec === 'daily' ? ' · daily' : '');
  await feed(sql, circle.id, me.id, self
    ? `${me.name} set a reminder: ${t}${when}`
    : `${me.name} asked ${forRow[0].name} to accept a reminder: ${t}${when}`);
  if (!self) {
    await pushCircle(sql, circle.id, { title: '🔔 ' + me.name + ' set a reminder for you', body: t + when + ' - open Parwah to accept or decline' }, { only: target });
  }
  return { ok: true, id: r[0].id, status };
}

export async function createRequest(sql, circle, me, { title, dueDate, aboutMemberId }) {
  const t = String(title || '').trim().slice(0, 200);
  if (!t) return { error: 'The request needs a description' };
  let due = String(dueDate || '').trim();
  due = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
  let about = null;
  if (isUuid(aboutMemberId)) {
    const a = await sql`select id from members where id = ${aboutMemberId} and circle_id = ${circle.id}`;
    if (a[0]) about = a[0].id;
  }
  const r = await sql`insert into requests (circle_id, by_member, title, due_date, about_member)
                      values (${circle.id}, ${me.id}, ${t}, ${due}, ${about}) returning id`;
  await feed(sql, circle.id, me.id, `${me.name} asked the circle: ${t}`);
  await pushCircle(sql, circle.id, { title: '🤝 ' + me.name + ' needs a hand', body: t + (due ? ' · by ' + due : '') + ' - first to tap "I\'m on it" takes it' }, { except: me.id });
  return { ok: true, id: r[0].id };
}

export default async function handler(req, res) {
  let sql;
  try {
    sql = db(); await ensureSchema(sql);
    await ensureTaskSchema(sql);
  } catch (e) { return failDb(res, e); }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });
      // One task's history, when asked for.
      if (q.task) {
        const history = await taskHistory(sql, g.circle.id, q.task);
        if (!history) return res.status(404).json({ ok: false, error: 'That task is not here any more' });
        return res.status(200).json({ ok: true, history });
      }
      // Anything that just ran late is announced once, here or on any
      // other phone's next look - whichever comes first.
      await sweepOverdue(sql, g.circle.id);
      const state = await careState(sql, g.circle.id);
      // Scoped to the caller: the suggestions used to name private entries.
      const suggestions = await careSuggestions(sql, g.circle.id, g.me.id);
      return res.status(200).json({ ok: true, ...state, suggestions });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    const { code, memberId, action } = req.body || {};
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, code, memberId, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const meRow = [_g.me];
    const me = meRow[0];

    if (action === 'reminder_create') {
      const out = await createReminder(sql, circle, me, req.body);
      return res.status(out.error ? 400 : 201).json(out.error ? { ok: false, ...out } : out);
    }

    if (action === 'reminder_respond') {
      const { reminderId, accept } = req.body;
      if (!isUuid(reminderId)) return res.status(400).json({ ok: false, error: 'Bad reminder id' });
      const row = await sql`select id, title, for_member, by_member from reminders
                            where id = ${reminderId} and circle_id = ${circle.id} and status = 'pending'`;
      if (!row[0]) return res.status(404).json({ ok: false, error: 'Reminder not found or already answered' });
      if (row[0].for_member !== me.id) return res.status(403).json({ ok: false, error: 'Only the person it is for can answer' });
      const status = accept === true ? 'accepted' : 'declined';
      await sql`update reminders set status = ${status} where id = ${reminderId}`;
      await feed(sql, circle.id, me.id, `${me.name} ${status === 'accepted' ? 'accepted' : 'declined'} the reminder: ${row[0].title}`);
      if (row[0].by_member && row[0].by_member !== me.id) {
        await pushCircle(sql, circle.id, {
          title: (status === 'accepted' ? '✅ ' : '🙅 ') + me.name + ' ' + status + ' your reminder',
          body: row[0].title
        }, { only: row[0].by_member });
      }
      return res.status(200).json({ ok: true, status });
    }

    if (action === 'reminder_done') {
      const { reminderId } = req.body;
      if (!isUuid(reminderId)) return res.status(400).json({ ok: false, error: 'Bad reminder id' });
      const row = await sql`select id, title, for_member, by_member, recurrence from reminders
                            where id = ${reminderId} and circle_id = ${circle.id} and status = 'accepted'`;
      if (!row[0]) return res.status(404).json({ ok: false, error: 'Reminder not found' });
      if (row[0].for_member !== me.id) return res.status(403).json({ ok: false, error: 'Only the person it is for can mark it done' });
      if (row[0].recurrence !== 'daily') await sql`update reminders set status = 'done' where id = ${reminderId}`;
      await feed(sql, circle.id, me.id, `${me.name} completed: ${row[0].title} ✔`);
      // A daily reminder earns once a day; a one-off earns once, ever.
      await award(sql, circle.id, me.id, 'reminder',
        row[0].recurrence === 'daily' ? reminderId + ':' + today() : reminderId);
      if (row[0].by_member && row[0].by_member !== me.id) {
        await pushCircle(sql, circle.id, { title: '✔ ' + me.name + ' did it', body: row[0].title }, { only: row[0].by_member });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'request_create') {
      const out = await createRequest(sql, circle, me, req.body);
      return res.status(out.error ? 400 : 201).json(out.error ? { ok: false, ...out } : out);
    }

    // Tasks, and the older claim/done calls, share one lifecycle with its
    // permission checks: a job can no longer be claimed twice at once, or
    // closed by someone who neither asked for it nor has it.
    if (/^task_/.test(action) || action === 'request_claim' || action === 'request_done') {
      const out = await taskAction(sql, circle, me, req.body);
      if (out.json.ok && out.json.status === 'done') {
        await award(sql, circle.id, me.id, 'reminder', req.body.taskId || req.body.requestId);
      }
      return res.status(out.status).json(out.json);
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}
