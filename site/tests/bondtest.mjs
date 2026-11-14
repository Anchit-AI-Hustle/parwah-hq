// The tyohaar list and the yearly-date arithmetic behind cards and festival
// kits. api/_tyohaar.mjs imports nothing, so this runs before npm install.
import { FESTIVALS, festivalsDue, nextYearly, daysBetween, KIT_DAYS, FEST_NOTE, FEST_WEEKDAYS } from '../../api/_tyohaar.mjs';
let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c) pass++; else fails.push(n + (d !== undefined ? ' -> ' + d : '')); };

ok('21 festivals, every key unique', FESTIVALS.length === 21 && new Set(FESTIVALS.map(f => f.key)).size === 21);
ok('the inclusive list is all there',
  ['Diwali', 'Holi', 'Eid al-Fitr', 'Eid al-Adha', 'Christmas', 'Raksha Bandhan', 'Bhai Dooj', 'Onam', 'Pongal', 'Makar Sankranti', 'Lohri',
   'Navratri / Durga Puja', 'Ganesh Chaturthi', 'Guru Nanak Jayanti', 'Karva Chauth', 'New Year',
   'Janmashtami', 'Dussehra', 'Chhath Puja', 'Baisakhi', 'Ugadi / Gudi Padwa'].every(n => FESTIVALS.some(f => f.name === n)));
ok('every date is a real day from Nov 2026 to Dec 2030, in order, none twice', FESTIVALS.every(f => f.dates.length && f.dates.every((d, i) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2026-11-01' && d <= '2030-12-31' && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d
  && (i === 0 || d > f.dates[i - 1]))));
// Every date added in November 2026 was read with its weekday. A mistyped
// date would land on another weekday, and fails here.
const wrongDay = Object.entries(FEST_WEEKDAYS).filter(([d, w]) => new Date(d + 'T00:00:00Z').getUTCDay() !== w).map(([d]) => d);
ok('every date from 2028 on falls on the weekday the calendar printed', wrongDay.length === 0, wrongDay.join());
const unchecked = [...new Set(FESTIVALS.flatMap(f => f.dates))].filter(d => d >= '2028-01-01' && !(d in FEST_WEEKDAYS) && !/-(12-25|01-01)$/.test(d));
ok('no date from 2028 on is there without a weekday to check it by (fixed days aside)', unchecked.length === 0, unchecked.join());
ok('every festival reaches 2030, except Navratri, which is left out until it can be checked',
  FESTIVALS.every(f => f.key === 'navratri' ? f.dates.join() === '2027-09-30' : f.dates.some(d => d.startsWith('2030-'))));
ok('at most one date a year for each festival', FESTIVALS.every(f => new Set(f.dates.map(d => d.slice(0, 4))).size === f.dates.length));
ok('Diwali 2026 is 8 November and 2027 is 29 October, then 2028 to 2030', FESTIVALS.find(f => f.key === 'diwali').dates.join() === '2026-11-08,2027-10-29,2028-10-17,2029-11-05,2030-10-26');
ok('the note says dates differ by region', /region/.test(FEST_NOTE) && /moon/.test(FEST_NOTE));
ok('14 days ahead', KIT_DAYS === 14);
ok('nothing is due for a circle that picked nothing', festivalsDue([], '2026-11-01').length === 0);
const due = festivalsDue(['diwali', 'christmas', 'nope'], '2026-11-01');
ok('Diwali is due 7 days out, Christmas is not yet', due.length === 1 && due[0].key === 'diwali' && due[0].inDays === 7, JSON.stringify(due));
ok('on the day itself it is still due, the day after it is not', festivalsDue(['diwali'], '2026-11-08')[0].inDays === 0 && festivalsDue(['diwali'], '2026-11-09').length === 0);
ok('exactly 14 days out is due, 15 is not', festivalsDue(['diwali'], '2026-10-25').length === 1 && festivalsDue(['diwali'], '2026-10-24').length === 0);
ok('days between two dates', daysBetween('2026-12-30', '2027-01-02') === 3);
ok('a birthday later this year', JSON.stringify(nextYearly('1975-11-05', '2026-11-02')) === JSON.stringify({ day: '2026-11-05', year: 2026, inDays: 3 }));
ok('a birthday today is 0 days away', nextYearly('1975-11-02', '2026-11-02').inDays === 0);
ok('a birthday already gone is next year', nextYearly('1975-01-10', '2026-11-02').day === '2027-01-10');
ok('29 February is kept on the 28th in other years', nextYearly('1980-02-29', '2027-02-01').day === '2027-02-28' && nextYearly('1980-02-29', '2028-02-01').day === '2028-02-29');
ok('across the new year', nextYearly('1990-01-01', '2026-12-30').inDays === 2);
ok('no date, no occasion', nextYearly(null, '2026-11-02') === null && nextYearly('soon', '2026-11-02') === null);
if (fails.length) { console.error('bondtest: ' + fails.length + ' FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`bondtest: ${pass}/${pass} checks pass`);
