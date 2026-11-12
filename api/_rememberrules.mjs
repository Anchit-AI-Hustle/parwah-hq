// DAYS OF REMEMBRANCE - the date arithmetic, and nothing else.
// Imports nothing, so the deploy gate tests it before npm install
// (site/tests/remembertest.mjs).
//
// A family writes down when someone passed away: the year always, the month
// and the day when they know them. With a day and a month there is a day of
// remembrance each year after, on the calendar date (solar; a tithi is not
// worked out here). 29 February is kept on 28 February in other years.
//
// The family hears once a year: from 6 in the evening the day before
// ("Tomorrow is Dadaji's day of remembrance"), or on the day itself if no
// phone was awake that evening. Evening and day are read on the clock of
// where the person lived.
export const REMEMBER_LINE_MAX = 160;
export const REMEMBER_EVE_HOUR = 18;
export const REMEMBER_MIN_YEAR = 1800;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const z2 = n => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + z2(m) + '-' + z2(d);
const whole = v => (v === null || v === undefined || v === '' ? null : /^\d{1,4}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
function addDays(day, n) {
  const t = new Date(day + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

// What a family typed, checked: { value: { year, month, day } } or { error }.
// today is YYYY-MM-DD where the family is; bornYear, when known, is the year
// of birth.
export function passedClean(input, today, bornYear) {
  const i = input || {};
  const year = whole(i.year), month = whole(i.month), day = whole(i.day);
  if (year === null) return { error: 'Write the year. The day and the month can be added later.' };
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return { error: 'Write the date in numbers, like 2019.' };
  const ty = +String(today).slice(0, 4);
  if (year < REMEMBER_MIN_YEAR) return { error: 'Please check the year. That is before ' + REMEMBER_MIN_YEAR + '.' };
  if (year > ty) return { error: 'That year has not come yet. Please check it.' };
  if (bornYear && year < bornYear) return { error: 'That is before the year they were born. Please check it.' };
  if (month === null && day !== null) return { error: 'Choose the month as well, or leave the day empty.' };
  if (month !== null && (month < 1 || month > 12)) return { error: 'Choose a month from the list.' };
  if (day !== null && (day < 1 || day > daysIn(year, month))) return { error: 'That day is not in ' + MONTHS[month - 1] + ' ' + year + '. Please check it.' };
  if (month !== null) {
    const full = iso(year, month, day === null ? 1 : day);
    if (full > String(today)) return { error: 'That date has not come yet. Please check it.' };
  }
  return { value: { year, month, day } };
}

// The day of remembrance in one calendar year, or null when the day or the
// month is not known, or the year is not after the year of passing.
export function anniversaryIn(p, y) {
  if (!p || !p.year || !p.month || !p.day || y <= p.year) return null;
  return iso(y, p.month, Math.min(p.day, daysIn(y, p.month)));
}

// The next day of remembrance on or after today:
// { date, year, inDays, years } or null.
export function nextRemembrance(p, today) {
  const ty = +String(today).slice(0, 4);
  for (const y of [ty, ty + 1]) {
    const d = anniversaryIn(p, y);
    if (d && d >= today) return { date: d, year: y, inDays: daysBetween(today, d), years: y - p.year };
  }
  return null;
}

// The calendar date and the hour on a clock in a time zone.
export function wallIn(ms, tz) {
  let f;
  try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Kolkata', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric' }); }
  catch (e) { f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric' }); }
  const o = {};
  f.formatToParts(new Date(ms)).forEach(x => { o[x.type] = +x.value; });
  return { date: iso(o.year, o.month, o.day), hour: o.hour };
}

// Is the family to be told now? { when: 'eve' | 'day', date, year, years } or
// null. 'eve' from 6 in the evening the day before, 'day' all of the day.
// year is the calendar year of the day itself: the key the reminder is
// claimed by, so it is sent once a year however many phones look.
export function remembranceDue(p, nowMs, tz) {
  const w = wallIn(nowMs, tz), tomorrow = addDays(w.date, 1);
  for (const y of [...new Set([+w.date.slice(0, 4), +tomorrow.slice(0, 4)])]) {
    const d = anniversaryIn(p, y);
    if (!d) continue;
    if (d === w.date) return { when: 'day', date: d, year: y, years: y - p.year };
    if (d === tomorrow && w.hour >= REMEMBER_EVE_HOUR) return { when: 'eve', date: d, year: y, years: y - p.year };
  }
  return null;
}

// "12 March 2019", "March 2019" or "2019": as much as the family wrote.
export function passedWords(p) {
  if (!p || !p.year) return '';
  if (p.month && p.day) return p.day + ' ' + MONTHS[p.month - 1] + ' ' + p.year;
  if (p.month) return MONTHS[p.month - 1] + ' ' + p.year;
  return String(p.year);
}

// The one line the family reads. Plain and gentle, never clinical.
export function remembranceLine(name, when) {
  const n = String(name || '').trim() || 'someone dear';
  return (when === 'eve' ? 'Tomorrow is ' : 'Today is ') + n + "'s day of remembrance.";
}
export function yearsLine(name, years) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'They';
  if (!(years > 0)) return 'We remember ' + first + ' today.';
  return years === 1 ? 'One year without ' + first + '. We remember.' : years + ' years without ' + first + '. We remember.';
}

// Marking someone as no longer with us is for the grown-ups of a family: a
// member who is on Parwah, and not known to be under 18. With no date of
// birth on file a member is taken to be an adult, as joining already does.
export function isAdult(dob, today) {
  const d = dob instanceof Date
    ? (isNaN(dob) ? '' : dob.getFullYear() + '-' + z2(dob.getMonth() + 1) + '-' + z2(dob.getDate()))
    : String(dob || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;
  const t = String(today);
  let age = +t.slice(0, 4) - +d.slice(0, 4);
  if (t.slice(5) < d.slice(5)) age--;
  return age >= 18;
}
