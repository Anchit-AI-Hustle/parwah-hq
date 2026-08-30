// The care protocol: reminders and requests, consent-first.
// GET  /api/care?circle=CODE — reminders + open/claimed requests for the circle
// POST /api/care {code, memberId, action, ...} — see ACTIONS below
import { db, ensureSchema, circleByCode, isUuid } from './_db.mjs';
import { pushCircle } from './_push.mjs';

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
  const requests = await sql`
    select q.id, q.title, q.status, q.created_at,
           b.name as by_name, c.name as claimed_name
    from requests q
    left join members b on b.id = q.by_member
    left join members c on c.id = q.claimed_by
    where q.circle_id = ${circleId} and q.status in ('open','claimed')
    order by q.created_at desc limit 30`;
  return { reminders, requests };
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
    await pushCircle(sql, circle.id, { title: '🔔 ' + me.name + ' set a reminder for you', body: t + when + ' — open Parwah to accept or decline' }, { only: target });
  }
  return { ok: true, id: r[0].id, status };
}

export async function createRequest(sql, circle, me, { title }) {
  const t = String(title || '').trim().slice(0, 200);
  if (!t) return { error: 'The request needs a description' };
  const r = await sql`insert into requests (circle_id, by_member, title) values (${circle.id}, ${me.id}, ${t}) returning id`;
  await feed(sql, circle.id, me.id, `${me.name} asked the circle: ${t}`);
  await pushCircle(sql, circle.id, { title: '🤝 ' + me.name + ' needs a hand', body: t + ' — first to tap "I\'m on it" takes it' }, { except: me.id });
  return { ok: true, id: r[0].id };
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  try {
    if (req.method === 'GET') {
      const circle = await circleByCode(sql, req.query && req.query.circle);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const state = await careState(sql, circle.id);
      return res.status(200).json({ ok: true, ...state });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    const { code, memberId, action } = req.body || {};
    const circle = await circleByCode(sql, code);
    if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
    if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const meRow = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
    if (!meRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const me = meRow[0];

    if (action === 'reminder_create') {
      const out = await createReminder(sql, circle, me, req.body);
      return res.status(out.error ? 400 : 201).json(out.error ? { ok: false, ...out } : out);
    }

    if (action === 'reminder_respond') {
      const { reminderId, accept } = req.body;
      if (!isUuid(reminderId)) return res.status(400).json({ ok: false, error: 'Bad reminder id' });
      const row = await sql`select id, title, for_member from reminders
                            where id = ${reminderId} and circle_id = ${circle.id} and status = 'pending'`;
      if (!row[0]) return res.status(404).json({ ok: false, error: 'Reminder not found or already answered' });
      if (row[0].for_member !== me.id) return res.status(403).json({ ok: false, error: 'Only the person it is for can answer' });
      const status = accept === true ? 'accepted' : 'declined';
      await sql`update reminders set status = ${status} where id = ${reminderId}`;
      await feed(sql, circle.id, me.id, `${me.name} ${status === 'accepted' ? 'accepted' : 'declined'} the reminder: ${row[0].title}`);
      return res.status(200).json({ ok: true, status });
    }

    if (action === 'reminder_done') {
      const { reminderId } = req.body;
      if (!isUuid(reminderId)) return res.status(400).json({ ok: false, error: 'Bad reminder id' });
      const row = await sql`select id, title, for_member, recurrence from reminders
                            where id = ${reminderId} and circle_id = ${circle.id} and status = 'accepted'`;
      if (!row[0]) return res.status(404).json({ ok: false, error: 'Reminder not found' });
      if (row[0].for_member !== me.id) return res.status(403).json({ ok: false, error: 'Only the person it is for can mark it done' });
      if (row[0].recurrence !== 'daily') await sql`update reminders set status = 'done' where id = ${reminderId}`;
      await feed(sql, circle.id, me.id, `${me.name} completed: ${row[0].title} ✔`);
      return res.status(200).json({ ok: true });
    }

    if (action === 'request_create') {
      const out = await createRequest(sql, circle, me, req.body);
      return res.status(out.error ? 400 : 201).json(out.error ? { ok: false, ...out } : out);
    }

    if (action === 'request_claim' || action === 'request_done') {
      const { requestId } = req.body;
      if (!isUuid(requestId)) return res.status(400).json({ ok: false, error: 'Bad request id' });
      const row = await sql`select id, title, status from requests where id = ${requestId} and circle_id = ${circle.id}`;
      if (!row[0]) return res.status(404).json({ ok: false, error: 'Request not found' });
      if (action === 'request_claim') {
        if (row[0].status !== 'open') return res.status(409).json({ ok: false, error: 'Someone already took this' });
        await sql`update requests set status = 'claimed', claimed_by = ${me.id} where id = ${requestId}`;
        await feed(sql, circle.id, me.id, `${me.name} is on it: ${row[0].title}`);
      } else {
        await sql`update requests set status = 'done' where id = ${requestId}`;
        await feed(sql, circle.id, me.id, `${me.name} finished: ${row[0].title} ✔`);
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
