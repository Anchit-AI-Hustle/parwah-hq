// WHEN IS A REPEATING FAMILY TASK DUE NEXT.
// api/_recur.mjs imports nothing, so this runs in the deploy gate before
// npm install. Every expectation is written as a wall-clock time at home,
// because that is what the family sees.
import { nextDue, fromWall, localDate, validTz, REPEATS } from '../../api/_recur.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };
const at = (tz, y, m, d, h = 9, mi = 0) => fromWall({ y, m, d, h, mi, s: 0 }, tz);
const home = (ms, tz) => {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const IN = 'Asia/Kolkata', NY = 'America/New_York', LON = 'Europe/London';

// UTC storage: 9:00 in India is 03:30 UTC.
ok('9:00 in India is 03:30 UTC', new Date(at(IN, 2026, 10, 1)).toISOString() === '2026-10-01T03:30:00.000Z',
   new Date(at(IN, 2026, 10, 1)).toISOString());
ok('the local date is the date at home, not in UTC',
   localDate(at(IN, 2026, 10, 1, 1, 0), IN) === '2026-10-01' && new Date(at(IN, 2026, 10, 1, 1, 0)).toISOString().startsWith('2026-09-30'));

// Daily, weekly, monthly, from a moment well before "now".
const before = at(IN, 2026, 10, 1) - 1;
ok('daily: the next morning at 9', home(nextDue(at(IN, 2026, 10, 1), 'daily', IN, null, before), IN) === '2026-10-02 09:00');
ok('weekly: the same weekday next week', home(nextDue(at(IN, 2026, 10, 1), 'weekly', IN, null, before), IN) === '2026-10-08 09:00');
ok('monthly: the same date next month', home(nextDue(at(IN, 2026, 10, 1), 'monthly', IN, null, before), IN) === '2026-11-01 09:00');
ok('once: there is no next', nextDue(at(IN, 2026, 10, 1), 'once', IN, null, before) === null);
ok('an unknown repeat is treated as once', nextDue(at(IN, 2026, 10, 1), 'hourly', IN, null, before) === null);

// Monthly on the 31st: shorter months get their last day, and the 31st comes back.
{
  const anchor = at(IN, 2027, 1, 31);
  const feb = nextDue(anchor, 'monthly', IN, anchor, anchor - 1);
  ok('the 31st in February is the 28th', home(feb, IN) === '2027-02-28 09:00', home(feb, IN));
  const mar = nextDue(feb, 'monthly', IN, anchor, feb - 1);
  ok('and it is the 31st again in March, not the 28th', home(mar, IN) === '2027-03-31 09:00', home(mar, IN));
  const apr = nextDue(mar, 'monthly', IN, anchor, mar - 1);
  ok('and the 30th in April', home(apr, IN) === '2027-04-30 09:00', home(apr, IN));
  const leap = nextDue(at(IN, 2028, 1, 31), 'monthly', IN, at(IN, 2028, 1, 31), at(IN, 2028, 1, 31) - 1);
  ok('the 29th in a leap February', home(leap, IN) === '2028-02-29 09:00', home(leap, IN));
}

// Clocks change abroad: 9:00 stays 9:00 at home on both sides of the change.
{
  const sat = at(NY, 2027, 3, 13);                       // the day before clocks go forward
  const sun = nextDue(sat, 'daily', NY, null, sat - 1);
  ok('New York, clocks forward: still 9:00 the next day', home(sun, NY) === '2027-03-14 09:00', home(sun, NY));
  ok('which is 23 hours later, not 24', sun - sat === 23 * 3600000, (sun - sat) / 3600000);
  // An hour just after the jump, where a one-step conversion lands an hour out.
  const three = at(NY, 2027, 3, 13, 3, 0);
  const three2 = nextDue(three, 'daily', NY, null, three - 1);
  ok('New York, 3:00 on the morning the clocks jump is still 3:00', home(three2, NY) === '2027-03-14 03:00', home(three2, NY));
  const oct = at(LON, 2026, 10, 24, 7, 30);              // the day before clocks go back
  const nxt = nextDue(oct, 'daily', LON, null, oct - 1);
  ok('London, clocks back: still 7:30 the next day', home(nxt, LON) === '2026-10-25 07:30', home(nxt, LON));
  ok('which is 25 hours later', nxt - oct === 25 * 3600000);
}

// Done late: the next one is in the future, never a pile of missed copies.
{
  const due = at(IN, 2026, 9, 20);
  const now = at(IN, 2026, 9, 23, 22, 0);                // three days late, at night
  const n = nextDue(due, 'daily', IN, due, now);
  ok('finished three days late: next is tomorrow morning', home(n, IN) === '2026-09-24 09:00', home(n, IN));
  ok('never in the past', n > now);
  const early = at(IN, 2026, 9, 23, 8, 0);               // done before 9 on a later day
  ok('finished early on a later day: later that same morning',
     home(nextDue(due, 'daily', IN, due, early), IN) === '2026-09-23 09:00');
  const m = nextDue(at(IN, 2026, 1, 31), 'monthly', IN, at(IN, 2026, 1, 31), at(IN, 2026, 6, 15));
  ok('a monthly task left for months: the next one after today, still on its own day', home(m, IN) === '2026-06-30 09:00', home(m, IN));
}

// Time zones from the phone are checked, and a bad one never throws.
ok('a real time zone is accepted', validTz('Asia/Kolkata') === 'Asia/Kolkata');
ok('a made-up one is refused', validTz('Mars/Olympus') === null && validTz('') === null && validTz(42) === null);
ok('a bad zone still gives a sensible next time (India)', home(nextDue(at(IN, 2026, 10, 1), 'daily', 'Nope/Zone', null, before), IN) === '2026-10-02 09:00');
ok('the four repeats', REPEATS.join() === 'once,daily,weekly,monthly');

if (fails.length) {
  console.error(`recurtest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`recurtest: ${pass}/${pass} checks pass`);
