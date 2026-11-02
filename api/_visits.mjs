// AFTER A DOCTOR'S VISIT: "After Papa's appointment, I can see what the
// doctor asked for and when the next visit is, without a 20-minute call."
//
// When an appointment plan's time has passed, whoever went is asked once
// "How did the visit go?": a photo of the prescription or notes (it goes into
// the vault through the vault's own upload), then three taps: next visit in
// so many weeks (or none), tests to do, anything new. That becomes follow-up
// tasks with owners (book the next visit, get the tests done) and a reminder
// for the next visit.
//
// Kept in audio_consultations, the table made for consultation summaries and
// never used until now, with the plan, the next date and the photo added.
//
// RECORD ONLY. Nothing here is read, summarised or explained by Ekta or by
// anything else: the words are the family's, kept as typed.
//
// GET  /api/plans?area=visit&circle&member[&person] -> { ok, pending[], visits[] }
// POST /api/plans {area:'visit', action:'visit_save'|'visit_skip', ...}
import { isUuid, schemaOnce } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { ensureCarePrepSchema } from './_careprep.mjs';
import { ensureTaskSchema, createTask } from './_tasks.mjs';
import { validTz, localDate, fromWall } from './_recur.mjs';

export const ASK_AFTER_MIN = 30;     // the visit is asked about this long after its time
export const ASK_FOR_DAYS = 7;       // and stays on Today this long, unless answered or skipped

let ready = false;
export async function ensureVisitSchema(sql) {
  if (ready) return;
  await schemaOnce(() => ensureCarePrepSchema(sql));
  await schemaOnce(async () => {
    await sql`alter table audio_consultations add column if not exists plan_id uuid references plans(id) on delete set null`;
    await sql`alter table audio_consultations add column if not exists next_due timestamptz`;
    await sql`alter table audio_consultations add column if not exists vault_doc_id uuid references vault_docs(id) on delete set null`;
    await sql`create unique index if not exists audio_consultations_plan on audio_consultations (plan_id) where plan_id is not null`;
    await sql`alter table plans add column if not exists visit_asked_at timestamptz`;
    await sql`alter table plans add column if not exists visit_done_at timestamptz`;
  });
  ready = true;
}

// Asked once: a conditional UPDATE claims the question, so however many
// phones look at the same moment, the people who went hear it once.
export async function sweepVisitAsk(sql, circleId) {
  let due = [];
  try {
    await ensureVisitSchema(sql);
    due = await sql`update plans set visit_asked_at = now()
                    where circle_id = ${circleId} and kind = 'appointment'
                      and visit_asked_at is null and visit_done_at is null
                      and at <= now() - make_interval(mins => ${ASK_AFTER_MIN}) and at > now() - interval '1 day'
                    returning id, title, going, by_member`;
  } catch (e) { return 0; }
  for (const p of due) {
    const to = (p.going && p.going.length) ? p.going : [p.by_member];
    for (const id of to) {
      if (!id) continue;
      await pushCircle(sql, circleId, {
        title: '🩺 How did the visit go?',
        body: p.title + ': a photo of the prescription and three taps, so nobody needs a long call.',
        url: '/#home'
      }, { only: id });
    }
  }
  return due.length;
}

export function cleanTests(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const s = String(t || '').trim().slice(0, 60);
    if (s && !out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}
// "In 6 weeks" from the visit, at 10 in the morning at home.
export function nextDueAt(visitMs, weeks, tz) {
  const w = Number(weeks);
  if (!Number.isInteger(w) || w < 1 || w > 52) return null;
  const zone = validTz(tz) || 'Asia/Kolkata';
  const [y, m, d] = localDate(visitMs + w * 7 * 86400000, zone).split('-').map(Number);
  return fromWall({ y, m, d, h: 10, mi: 0, s: 0 }, zone);
}

export async function visitState(sql, circle, me, personId) {
  const person = isUuid(personId) ? personId : null;
  const pending = await sql`
    select p.id, p.title, p.at, p.place, p.going, p.by_member
    from plans p
    where p.circle_id = ${circle.id} and p.kind = 'appointment' and p.visit_done_at is null
      and p.at <= now() and p.at > now() - make_interval(days => ${ASK_FOR_DAYS})
      and (${me.id}::uuid = any(p.going) or p.by_member = ${me.id})
    order by p.at desc limit 5`;
  const visits = await sql`
    select v.id, v.person_id, v.plan_id, v.recorded_at, v.next_due, v.transcript_raw as new_notes,
           v.action_items, v.vault_doc_id, d.label as doc_label, m.name as person_name, c.name as by_name,
           p.title as plan_title
    from audio_consultations v
    join members m on m.id = v.person_id
    left join members c on c.id = v.created_by
    left join vault_docs d on d.id = v.vault_doc_id
    left join plans p on p.id = v.plan_id
    where v.circle_id = ${circle.id} and (${person}::uuid is null or v.person_id = ${person}::uuid)
      and v.recorded_at > now() - interval '400 days'
    order by v.recorded_at desc limit 20`;
  return { pending, visits };
}

const no = (status, error) => ({ status, json: { ok: false, error } });
const yes = (json, status = 200) => ({ status, json: { ok: true, ...json } });

export async function visitAction(sql, circle, me, body) {
  const action = body.action;
  const tz = validTz(body.tz) || 'Asia/Kolkata';

  if (action === 'visit_skip') {
    if (!isUuid(body.planId)) return no(400, 'Pick a visit');
    const r = await sql`update plans set visit_done_at = now()
                        where id = ${body.planId} and circle_id = ${circle.id} and kind = 'appointment' and visit_done_at is null
                        returning id`;
    if (!r[0]) return no(404, 'That visit is not waiting any more');
    return yes({});
  }

  if (action !== 'visit_save') return no(400, 'Unknown action');

  if (!isUuid(body.personId)) return no(400, 'Say whose visit it was');
  const p = (await sql`select id, name from members where id = ${body.personId} and circle_id = ${circle.id}`)[0];
  if (!p) return no(404, 'That person is not in this family');
  let plan = null;
  if (body.planId !== undefined && body.planId !== null && body.planId !== '') {
    if (!isUuid(body.planId)) return no(400, 'Pick a visit');
    plan = (await sql`select id, title, at, kind from plans where id = ${body.planId} and circle_id = ${circle.id}`)[0];
    if (!plan || plan.kind !== 'appointment') return no(404, 'That visit is not in this family');
  }
  let docId = null;
  if (body.vaultDocId) {
    if (!isUuid(body.vaultDocId)) return no(400, 'Bad photo');
    const d = await sql`select id from vault_docs where id = ${body.vaultDocId} and circle_id = ${circle.id}`;
    if (!d[0]) return no(404, 'That photo is not in this family\'s vault');
    docId = d[0].id;
  }
  const tests = cleanTests(body.tests);
  const newNotes = String(body.newNotes || '').trim().slice(0, 500) || null;
  const doctor = String(body.doctor || '').trim().slice(0, 80) || null;
  const weeks = Number(body.nextWeeks) || 0;
  if (weeks && (!Number.isInteger(weeks) || weeks < 1 || weeks > 52)) return no(400, 'Next visit: pick 1 to 52 weeks, or none');
  const visitMs = plan ? Math.min(new Date(plan.at).getTime(), Date.now()) : Date.now();
  const next = weeks ? nextDueAt(visitMs, weeks, tz) : null;

  // Owners are checked before anything is written: a task can only go to
  // someone in this family who is on Parwah.
  for (const k of ['bookOwnerId', 'testsOwnerId']) {
    const v = body[k];
    if (v === undefined || v === null || v === '' || v === 'me') continue;
    if (!isUuid(v)) return no(400, 'Pick who will do it');
    const o = await sql`select name, user_id from members where id = ${v} and circle_id = ${circle.id}`;
    if (!o[0]) return no(404, 'That person is not in this family');
    if (!o[0].user_id) return no(400, o[0].name + ' is not on Parwah, so cannot take a task. Pick someone who is.');
  }

  // Answered once: the plan is claimed first, so a second phone saving the
  // same visit is told it is already noted rather than making a twin.
  if (plan) {
    const c = await sql`update plans set visit_done_at = now() where id = ${plan.id} and visit_done_at is null returning id`;
    if (!c[0]) return no(409, 'This visit is already noted');
  }
  const r = await sql`
    insert into audio_consultations (circle_id, person_id, plan_id, next_due, vault_doc_id, transcript_raw, action_items, recorded_at, created_by)
    values (${circle.id}, ${p.id}, ${plan ? plan.id : null}, ${next ? new Date(next) : null}, ${docId}, ${newNotes},
            ${JSON.stringify({ tests, nextWeeks: weeks || null, doctor })}::jsonb, ${new Date(visitMs)}, ${me.id})
    returning id`;

  // The follow-ups, each with an owner. "me" unless someone else was named.
  await ensureTaskSchema(sql);
  const owner = (v) => (isUuid(v) ? v : 'me');
  const withDr = doctor ? ' (' + doctor + ')' : '';
  const taskIds = [];
  const make = async (b) => {
    const t = await createTask(sql, circle, me, { tz, aboutMemberId: p.id, ...b });
    if (t.status === 201) taskIds.push(t.json.id);
    return t;
  };
  if (next) {
    const bookBy = Math.max(Date.now() + 86400000, next - 7 * 86400000);
    await make({ title: 'Book ' + p.name + "'s next visit" + withDr, dueAt: new Date(bookBy).toISOString(), ownerId: owner(body.bookOwnerId),
                            notes: 'Next visit due around ' + localDate(next, tz) + '. Written down after the last visit.', remindBefore: 0 });
    await make({ title: p.name + "'s next visit is due" + withDr, dueAt: new Date(next).toISOString(), ownerId: owner(body.bookOwnerId), remindBefore: 1440 });
  }
  if (tests.length) {
    await make({ title: 'Get ' + p.name + "'s tests done: " + tests.join(', '), dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
                            ownerId: owner(body.testsOwnerId), notes: 'Asked for at the visit. Written as the family typed it.', remindBefore: 0 });
  }
  await sql`update audio_consultations set action_items = action_items || ${JSON.stringify({ taskIds })}::jsonb where id = ${r[0].id}`;

  const bits = [];
  if (weeks) bits.push('next visit in ' + weeks + ' week' + (weeks === 1 ? '' : 's'));
  if (tests.length) bits.push(tests.length + ' test' + (tests.length === 1 ? '' : 's') + ' to do');
  if (newNotes) bits.push('a note');
  if (docId) bits.push('a photo in the vault');
  const line = me.name + ' noted ' + (p.id === me.id ? 'their' : p.name + "'s") + ' visit' + (bits.length ? ': ' + bits.join(', ') : '');
  await sql`insert into events (circle_id, member_id, type, text) values (${circle.id}, ${me.id}, 'care', ${'🩺 ' + line})`;
  await pushCircle(sql, circle.id, { title: '🩺 After ' + p.name + "'s visit", body: line + '. Open Parwah to see it.', url: '/#people' }, { except: me.id });
  return yes({ id: r[0].id, nextDue: next ? new Date(next).toISOString() : null, tasks: taskIds.length }, 201);
}
