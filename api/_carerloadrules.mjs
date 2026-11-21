// CARER LOAD AND RESPITE ("Thoda sa haath batao"): the rules, with no
// database and no imports, so the unit test runs before npm install
// (site/tests/familyneedstest.mjs).
//
// Looking after a parent or a child is work, and in most families one
// person quietly does most of it. Parwah already knows who ticked the
// medicines for Maa, who did the task, who logged the visit, who made the
// rota call, who collected the child. From that:
//   - each adult sees, PRIVATELY, what they themself did this week;
//   - the family is shown one gentle line, with no numbers in it, only
//     when one person has carried most of it for two weeks running;
//   - anyone can tap "I need a day off" and ask for a named day.
// Never a leaderboard, never anyone else's counts, and a family can switch
// the whole thing off.
export const CARER_KINDS = ['tasks', 'medicines', 'visits', 'calls', 'pickups'];
export const CARER_WEEKS = 2;        // the line needs two weeks running
export const CARER_MIN_ACTS = 6;     // a week with less looking-after than this says nothing
export const CARER_SHARE = 0.6;      // "most of it": six parts in ten, or more
export const DAYOFF_PER_DAY = 3;
export const DAYOFF_AHEAD_DAYS = 14;

const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function weekdayOf(day) {
  const d = new Date(String(day || '').slice(0, 10) + 'T12:00:00Z');
  return isNaN(d) ? null : WEEKDAYS[d.getUTCDay()];
}

// Who has carried most of the looking-after, two weeks running, or null.
//   weeks:  [{ memberId: acts }, { memberId: acts }]   the last two weeks
//   adults: the ids of the adults who could share it (on Parwah, with us)
// Null when: fewer than two adults (nobody to ask), a quiet week, no one
// person at six parts in ten, or a different person in each week.
export function carerTop(weeks, adults) {
  const able = new Set(adults || []);
  if (able.size < 2 || !Array.isArray(weeks) || weeks.length < CARER_WEEKS) return null;
  let top = null;
  for (const w of weeks.slice(0, CARER_WEEKS)) {
    const rows = Object.entries(w || {}).filter(([id, n]) => able.has(id) && n > 0);
    const total = rows.reduce((a, [, n]) => a + n, 0);
    if (total < CARER_MIN_ACTS) return null;
    rows.sort((a, b) => b[1] - a[1]);
    const [id, n] = rows[0];
    if (n / total < CARER_SHARE) return null;
    if (top && top !== id) return null;
    top = id;
  }
  return top;
}

// The one line the family reads. No number is ever in it, nobody is
// compared with anybody, and nobody is told what they did not do.
//   viewerIsTop: the person themself reads a different, kinder line.
export function carerLine({ topName, forName, day, viewerIsTop = false }) {
  const who = forName ? ' for ' + first(forName) : '';
  if (viewerIsTop) return 'You have been doing a lot' + who + ' lately. It is fine to ask for a hand. Tap "I need a day off".';
  return first(topName) + ' has been doing a lot' + who + ' lately. Could someone take ' + (weekdayOf(day) || 'a day this week') + '?';
}
// What the line must never be: a count, a comparison, or a telling-off.
export const CARER_SHAME = /\b(only|lazy|never|nobody|no one|should|must|unfair|least|less|fewer|more than|most|compared|rank|ranking|score|behind|slack|blame|fault|shame|always)\b/i;
export function carerLineClean(line) {
  const s = String(line || '');
  return !!s && !/\d/.test(s) && !CARER_SHAME.test(s);
}

// What one adult did this week, in words, for their own eyes only.
//   counts: { tasks, medicines, visits, calls, pickups }
export function carerMine(counts) {
  const c = counts || {}, n = k => Math.max(0, Number(c[k]) || 0);
  const say = (k, one, many) => n(k) === 1 ? one : n(k) + ' ' + many;
  const lines = [];
  if (n('tasks')) lines.push(say('tasks', 'One thing done for the family', 'things done for the family'));
  if (n('medicines')) lines.push(say('medicines', 'One medicine tick for someone else', 'medicine ticks for someone else'));
  if (n('visits')) lines.push(say('visits', 'One doctor visit written down', 'doctor visits written down'));
  if (n('calls')) lines.push(say('calls', 'One call on the rota', 'calls on the rota'));
  if (n('pickups')) lines.push(say('pickups', 'One school pick-up', 'school pick-ups'));
  const total = CARER_KINDS.reduce((a, k) => a + n(k), 0);
  return { total, lines, note: total ? 'Thank you for this. Only you can see it.' : 'Nothing is written down for you this week. That is fine. Only you can see this.' };
}

// "I need a day off": a day from today to two weeks ahead.
export function dayoffClean(day, today) {
  const d = String(day || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + 'T00:00:00Z'))) return { error: 'Choose the day you need.' };
  const ahead = Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(String(today).slice(0, 10) + 'T00:00:00Z')) / 86400000);
  if (ahead < 0) return { error: 'That day has passed. Choose today or a day ahead.' };
  if (ahead > DAYOFF_AHEAD_DAYS) return { error: 'Choose a day in the next two weeks.' };
  return { value: d };
}
export function dayWords(day) {
  const d = new Date(String(day).slice(0, 10) + 'T12:00:00Z');
  return isNaN(d) ? '' : WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
}
export function dayoffPush(name, day, taskTitle) {
  return { kind: 'care', title: '🤲 ' + first(name) + ' needs a day off on ' + dayWords(day),
    body: (taskTitle ? 'Could you take "' + taskTitle + '" that day? ' : 'Could you take that day? ') + 'Tap to say yes.', url: '/#care' };
}
export function dayoffTakenPush(takerName, day) {
  return { kind: 'care', title: '🤲 ' + first(takerName) + ' will take ' + dayWords(day), body: 'Your day off is yours. Rest well.', url: '/#care' };
}
