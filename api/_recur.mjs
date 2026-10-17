// WHEN IS IT DUE NEXT - the time arithmetic for repeating family tasks.
//
// Imports nothing, so the deploy gate checks it before npm install
// (site/tests/recurtest.mjs). Everything is computed on the family's own
// wall clock in their time zone and handed back as a UTC instant, so "every
// day at 9" stays 9 at home even where the clocks change twice a year.
export const REPEATS = ['once', 'daily', 'weekly', 'monthly'];
export function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (e) { return null; }
}
// The phone says its own time zone on every request, so "today" on the
// server is the family's today, not London's.
export function reqTz(req) {
  const h = req && req.headers ? (req.headers['x-parwah-tz'] || req.headers['X-Parwah-Tz']) : null;
  return validTz(Array.isArray(h) ? h[0] : h);
}
// The calendar date in a zone, YYYY-MM-DD; UTC when the zone is unknown.
export function dayIn(tz, at) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: validTz(tz) || 'UTC' }).format(at ? new Date(at) : new Date());
}
const fmtCache = {};
function wall(ms, tz) {
  const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const p = {};
  f.formatToParts(new Date(ms)).forEach(x => { p[x.type] = +x.value; });
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}
const offset = (ms, tz) => { const w = wall(ms, tz); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - ms; };
// A wall-clock time in a zone, as an instant.
export function fromWall(w, tz) {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s || 0);
  const o1 = offset(guess, tz);
  let t = guess - o1;
  const o2 = offset(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}
function addPeriod(w, rec, k) {
  if (rec === 'daily' || rec === 'weekly') {
    const n = new Date(Date.UTC(w.y, w.m - 1, w.d + k * (rec === 'weekly' ? 7 : 1)));
    return { ...w, y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate() };
  }
  // Monthly keeps its day: the 31st becomes the 30th or 28th in shorter
  // months, and comes back to the 31st when the month has one.
  const mm = (w.m - 1) + k, y = w.y + Math.floor(mm / 12), m = ((mm % 12) + 12) % 12 + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { ...w, y, m, d: Math.min(w.d, last) };
}
// The next occurrence after this one, never in the past: finishing a daily
// task three days late does not queue up three overdue copies.
export function nextDue(dueAtMs, rec, tz, anchorMs, nowMs = Date.now()) {
  if (!REPEATS.includes(rec) || rec === 'once') return null;
  const zone = validTz(tz) || 'UTC';
  const w0 = wall(anchorMs || dueAtMs, zone);
  const after = Math.max(dueAtMs, nowMs);
  const per = rec === 'daily' ? 86400000 : rec === 'weekly' ? 7 * 86400000 : 31 * 86400000;
  let k = Math.max(1, Math.floor((after - (anchorMs || dueAtMs)) / per) - 1);
  for (let i = 0; i < 500; i++, k++) {
    const t = fromWall(addPeriod(w0, rec, k), zone);
    if (t > after) return t;
  }
  return null;
}
export function localDate(ms, tz) { const w = wall(ms, tz); return w.y + '-' + String(w.m).padStart(2, '0') + '-' + String(w.d).padStart(2, '0'); }

