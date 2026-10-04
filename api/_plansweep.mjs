// An hour before a plan or an event - a family call, a doctor's
// appointment, a wedding - everyone who said they are going is reminded.
// Claimed with a conditional UPDATE, so it is sent once however many phones
// and the 10-minute timer look at the same moment.
import { pushCircle } from './_push.mjs';

export const PLAN_REMIND_MIN = 60;
export const PLAN_ICON = { call: '📹', party: '🎶', meet: '🤗', appointment: '🩺', function: '🪔', trip: '✈️', other: '🗓' };

export function whenText(at, tz) {
  return new Date(at).toLocaleString('en-IN', { timeZone: tz || 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export async function sweepPlanReminders(sql, circleId) {
  let due = [];
  try {
    await sql`alter table plans add column if not exists reminded_at timestamptz`;
    due = await sql`update plans set reminded_at = now()
                     where circle_id = ${circleId} and reminded_at is null
                       and at > now() and at <= now() + make_interval(mins => ${PLAN_REMIND_MIN})
                     returning id, title, kind, at, going, room`;
  } catch (e) { return 0; }   // no plans table yet: nothing planned
  for (const p of due) {
    const mins = Math.max(1, Math.round((new Date(p.at) - Date.now()) / 60000));
    const payload = { title: (PLAN_ICON[p.kind] || '🗓') + ' In ' + mins + ' minutes: ' + p.title,
                      body: p.room ? 'Tap to open Parwah and join' : 'Open Parwah for the details', url: '/#fun', urgent: true };
    for (const id of p.going || []) await pushCircle(sql, circleId, payload, { only: id });
  }
  return due.length;
}
