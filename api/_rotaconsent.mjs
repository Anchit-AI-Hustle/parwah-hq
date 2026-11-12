// THE CALL ROTA, FROM THE SIDE OF THE PERSON WHO IS CALLED.
//
// A rota used to be something the family arranged about a parent. The
// parent now has a say in it, on their own phone:
//   - they are told when a rota is set up for them (rotaTellPerson);
//   - they choose the time that suits them:      action rota_time {taskId, time}
//   - they can say "No daily call, thank you":   action rota_decline {taskId}
//     which ends the rota, and nobody else can start one for them again
//     until they say they would like one:        action rota_welcome
//
// Behind /api/care, through familyTaskAction in api/_familycare.mjs, which
// hands in its own helpers (deadlineOf, memberIn, loadTask, log, feed) so
// the time arithmetic stays in one place.
import { schemaOnce } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { validHHMM, addDays } from './_carerules.mjs';
import { dayIn, localDate, validTz } from './_recur.mjs';
import { firstName } from './_consentrules.mjs';

export const ROTA_CONSENT_ACTIONS = ['rota_time', 'rota_decline', 'rota_welcome'];
export const ROTA_NO_THANKS = 'No daily call, thank you';

let ready = false;
export async function ensureRotaConsentSchema(sql) {
  if (ready) return;
  await schemaOnce(async () => {
    // Set when the person says no; cleared when they say they would like one.
    await sql`alter table members add column if not exists rota_no_at timestamptz`;
  });
  ready = true;
}

const ok = (status, json) => ({ status, json: { ok: true, ...json } });
const bad = (status, error) => ({ status, json: { ok: false, error } });
const clock = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return ((h % 12) || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm');
};

// May someone else set up a rota for this person? Not after they said no.
export async function rotaRefused(sql, circleId, aboutId) {
  await ensureRotaConsentSchema(sql);
  const r = await sql`select rota_no_at from members where id = ${aboutId} and circle_id = ${circleId}`;
  return !!(r[0] && r[0].rota_no_at);
}

// The person being called hears about it first, in plain words, with what
// they can do about it. Only someone on Parwah has a phone to be told on.
export async function rotaTellPerson(sql, circleId, me, about, time) {
  if (!about || !about.on_app || about.remembered || about.id === me.id) return false;
  await pushCircle(sql, circleId, { title: '📞 ' + firstName(me.name) + ' set up a daily call for you',
    body: 'Someone in the family will call you each day at ' + clock(time) + '. You can choose a time that suits you, or say no thank you.',
    url: '/#care' }, { only: about.id });
  return true;
}

export async function rotaConsentAction(sql, circle, me, body, tz, h) {
  await ensureRotaConsentSchema(sql);
  const action = body.action;

  if (action === 'rota_welcome') {
    await sql`update members set rota_no_at = null where id = ${me.id} and circle_id = ${circle.id}`;
    await h.feed(sql, circle.id, me.id, '📞 ' + me.name + ' would like a daily call again');
    return ok(200, { welcome: true });
  }

  const t = await h.loadTask(sql, circle, body.taskId, 'callrota');
  if (!t) return bad(404, 'That call rota is not here any more');
  if (!['open', 'assigned', 'claimed'].includes(t.status)) return bad(409, 'That day is already done. Open the newest one.');
  // Only the person who is called decides these two.
  if (t.about_member !== me.id) return bad(403, 'Only the person who is called can choose this');
  const d = t.template_data || {}, rota = Array.isArray(d.rota) ? d.rota : [];

  if (action === 'rota_time') {
    const time = validHHMM(body.time);
    if (!time) return bad(400, 'Choose a time, like 7:30 in the evening');
    const zone = validTz(t.tz) || validTz(tz) || 'Asia/Kolkata';
    const today = dayIn(zone);
    let at = h.deadlineOf(today, time, zone);
    if (at <= Date.now()) at = h.deadlineOf(addDays(today, 1), time, zone);
    const dueAt = new Date(at);
    const r = await sql`update requests set due_at = ${dueAt}, due_date = ${localDate(at, zone)}, series_anchor = ${dueAt},
                          template_data = ${JSON.stringify({ ...d, time, timeBy: me.id })}::jsonb
                        where id = ${t.id} and status in ('open','assigned','claimed') returning id`;
    if (!r[0]) return bad(409, 'This changed a moment ago. Have another look.');
    await h.log(sql, t, me, 'edited', 'Call time chosen: ' + time);
    await h.feed(sql, circle.id, me.id, '📞 ' + me.name + ' chose ' + clock(time) + ' for the daily call');
    for (const id of rota) {
      if (id === me.id) continue;
      await pushCircle(sql, circle.id, { title: '📞 ' + firstName(me.name) + ' chose ' + clock(time) + ' for the daily call',
        body: 'That is the time that suits them. The rota follows it from now.', url: '/#care' }, { only: id });
    }
    return ok(200, { time, dueAt });
  }

  if (action === 'rota_decline') {
    // Every open day of this rota goes; finished days stay as the record.
    const gone = await sql`delete from requests where circle_id = ${circle.id} and template = 'callrota' and about_member = ${me.id}
                             and status in ('open','assigned','claimed') returning id`;
    await sql`update members set rota_no_at = now() where id = ${me.id} and circle_id = ${circle.id}`;
    await h.feed(sql, circle.id, me.id, '📞 ' + me.name + ' said: no daily call, thank you. The call rota has stopped.');
    for (const id of rota) {
      if (id === me.id) continue;
      await pushCircle(sql, circle.id, { title: '📞 ' + firstName(me.name) + ': no daily call, thank you',
        body: 'The call rota has stopped, as they asked. A call when you feel like it is still welcome.', url: '/#care' }, { only: id });
    }
    return ok(200, { stopped: gone.length });
  }
  return bad(400, 'Unknown action');
}
