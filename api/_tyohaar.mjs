// TYOHAAR KIT - the festivals a family or a group may choose to celebrate
// together, with their dates from November 2026 to December 2030.
//
// Imports nothing, so the deploy gate checks it before npm install
// (site/tests/bondtest.mjs). The list is inclusive and nothing is assumed:
// a circle sees no festival at all until it picks the ones it keeps.
//
// WHERE THE DATES COME FROM.
//   2026 and 2027 (the first list): each was checked against two published
//   calendars (searched 2 November 2026); the pair is written next to it.
//   2028, 2029 and 2030, and the five festivals added in November 2026
//   (Janmashtami, Dussehra, Chhath, Baisakhi, Ugadi): read on 12 November
//   2026 from Drik Panchang's "Indian Festivals and Holidays Calendar" for
//   each year, row by row with its weekday (the unit test checks every
//   weekday). The 2028 dates were also checked against calendarlabs.com's
//   India holidays for 2028, which agrees on every one it lists.
//   LEFT OUT, because no row for it could be read: the first day of
//   Navratri in 2028, 2029 and 2030. It is added when it can be checked.
//   Calendars can differ by a day (for 2027, calendarlabs gives Dussehra as
//   10 October and Ugadi as 8 April; Drik Panchang's dates are used).
// Dates that follow the moon or a regional almanac can differ by a day by
// region or by sighting; the app says so under the list. Parwah makes no
// muhurat or religious claim about any of them: the Day screen is where
// good times live.
export const KIT_DAYS = 14;   // "Plan Diwali together" shows this many days before

export const FESTIVALS = [
  // Diwali: urbanmoney + navbharatlive (2026); calendarific + hindu-blog (2027)
  { key: 'diwali', name: 'Diwali', icon: '🪔', dates: ['2026-11-08', '2027-10-29', '2028-10-17', '2029-11-05', '2030-10-26'] },
  // Bhai Dooj: dekhopanchang + publicholidays.in, both years
  { key: 'bhaidooj', name: 'Bhai Dooj', icon: '🌼', dates: ['2026-11-11', '2027-10-31', '2028-10-19', '2029-11-07', '2030-10-28'] },
  // Chhath Puja: Drik Panchang (2026 from its "coming up" line, Sunday 15 November)
  { key: 'chhath', name: 'Chhath Puja', icon: '🌅', dates: ['2026-11-15', '2027-11-04', '2028-10-23', '2029-11-11', '2030-11-01'] },
  // Guru Nanak Jayanti: urbanmoney + bankbazaar (2026); publicholidays.in + qppstudio (2027; Drik Panchang says 13 Nov)
  { key: 'gurunanak', name: 'Guru Nanak Jayanti', icon: '🙏', dates: ['2026-11-24', '2027-11-14', '2028-11-02', '2029-11-21', '2030-11-10'] },
  // Christmas and New Year: fixed dates
  { key: 'christmas', name: 'Christmas', icon: '🎄', dates: ['2026-12-25', '2027-12-25', '2028-12-25', '2029-12-25', '2030-12-25'] },
  { key: 'newyear', name: 'New Year', icon: '🎉', dates: ['2027-01-01', '2028-01-01', '2029-01-01', '2030-01-01'] },
  // Lohri: calendarlabs + hindutone
  { key: 'lohri', name: 'Lohri', icon: '🔥', dates: ['2027-01-13', '2028-01-14', '2029-01-13', '2030-01-13'] },
  // Makar Sankranti and Pongal: drikpanchang + truecalendar (some calendars say 14 Jan)
  { key: 'sankranti', name: 'Makar Sankranti', icon: '🪁', dates: ['2027-01-15', '2028-01-15', '2029-01-14', '2030-01-14'] },
  { key: 'pongal', name: 'Pongal', icon: '🍚', dates: ['2027-01-15', '2028-01-15', '2029-01-14', '2030-01-14'] },
  // Eid al-Fitr: calendarific + truecalendar (tentative, on sighting of the moon)
  { key: 'eidfitr', name: 'Eid al-Fitr', icon: '🌙', dates: ['2027-03-10', '2028-02-27', '2029-02-15', '2030-02-05'] },
  // Holi: calendarific + hindupad
  { key: 'holi', name: 'Holi', icon: '🎨', dates: ['2027-03-22', '2028-03-11', '2029-03-01', '2030-03-20'] },
  // Ugadi and Gudi Padwa: Drik Panchang
  { key: 'ugadi', name: 'Ugadi / Gudi Padwa', icon: '🌿', dates: ['2027-04-07', '2028-03-27', '2029-04-14', '2030-04-03'] },
  // Baisakhi: Drik Panchang
  { key: 'baisakhi', name: 'Baisakhi', icon: '🌾', dates: ['2027-04-14', '2028-04-13', '2029-04-14', '2030-04-14'] },
  // Eid al-Adha: calendarific + truecalendar (tentative, on sighting of the moon)
  { key: 'eidadha', name: 'Eid al-Adha', icon: '🌙', dates: ['2027-05-17', '2028-05-05', '2029-04-24', '2030-04-14'] },
  // Raksha Bandhan: drikpanchang + dekhopanchang
  { key: 'rakhi', name: 'Raksha Bandhan', icon: '🧵', dates: ['2027-08-17', '2028-08-05', '2029-08-23', '2030-08-13'] },
  // Janmashtami: Drik Panchang (calendarlabs agrees for 2027 and 2028)
  { key: 'janmashtami', name: 'Janmashtami', icon: '🦚', dates: ['2027-08-25', '2028-08-13', '2029-09-01', '2030-08-21'] },
  // Ganesh Chaturthi: calendarific + hindupad (Drik Panchang says 3 Sep)
  { key: 'ganesh', name: 'Ganesh Chaturthi', icon: '🐘', dates: ['2027-09-04', '2028-08-23', '2029-09-11', '2030-09-01'] },
  // Onam (Thiruvonam): truecalendar + drikpanchang
  { key: 'onam', name: 'Onam', icon: '🌸', dates: ['2027-09-12', '2028-09-01', '2029-08-22', '2030-09-09'] },
  // Navratri / Durga Puja, first day: days.to + drikpanchang. 2028 to 2030 are left out (see the top).
  { key: 'navratri', name: 'Navratri / Durga Puja', icon: '💃', dates: ['2027-09-30'] },
  // Dussehra (Vijayadashami): Drik Panchang (calendarlabs agrees for 2028)
  { key: 'dussehra', name: 'Dussehra', icon: '🏹', dates: ['2027-10-09', '2028-09-27', '2029-10-16', '2030-10-06'] },
  // Karva Chauth: calendarific + outside.so
  { key: 'karvachauth', name: 'Karva Chauth', icon: '🌕', dates: ['2027-10-18', '2028-10-07', '2029-10-26', '2030-10-15'] }
];
// The weekday each date added in November 2026 was printed with, so a
// mistyped date fails the unit test (0 is Sunday).
export const FEST_WEEKDAYS = {
  '2028-01-14': 5, '2028-01-15': 6, '2028-02-27': 0, '2028-03-11': 6, '2028-03-27': 1, '2028-04-13': 4, '2028-05-05': 5,
  '2028-08-05': 6, '2028-08-13': 0, '2028-08-23': 3, '2028-09-01': 5, '2028-09-27': 3, '2028-10-07': 6, '2028-10-17': 2,
  '2028-10-19': 4, '2028-10-23': 1, '2028-11-02': 4,
  '2029-01-13': 6, '2029-01-14': 0, '2029-02-15': 4, '2029-03-01': 4, '2029-04-14': 6, '2029-04-24': 2, '2029-08-22': 3,
  '2029-08-23': 4, '2029-09-01': 6, '2029-09-11': 2, '2029-10-16': 2, '2029-10-26': 5, '2029-11-05': 1, '2029-11-07': 3,
  '2029-11-11': 0, '2029-11-21': 3,
  '2030-01-13': 0, '2030-01-14': 1, '2030-02-05': 2, '2030-03-20': 3, '2030-04-03': 3, '2030-04-14': 0, '2030-08-13': 2,
  '2030-08-21': 3, '2030-09-01': 0, '2030-09-09': 1, '2030-10-06': 0, '2030-10-15': 2, '2030-10-26': 6, '2030-10-28': 1,
  '2030-11-01': 5, '2030-11-10': 0,
  '2026-11-15': 0, '2027-04-07': 3, '2027-04-14': 3, '2027-08-25': 3, '2027-10-09': 6, '2027-11-04': 4
};

export const FEST_NOTE = 'Dates can differ by a day by region, and Eid follows the moon. Change the plan date if yours is different.';

export function festivalOf(key) { return FESTIVALS.find(f => f.key === key) || null; }

// Whole days from one YYYY-MM-DD to another.
export function daysBetween(fromDay, toDay) {
  const a = Date.UTC(+fromDay.slice(0, 4), +fromDay.slice(5, 7) - 1, +fromDay.slice(8, 10));
  const b = Date.UTC(+toDay.slice(0, 4), +toDay.slice(5, 7) - 1, +toDay.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// The festivals a circle chose that fall within KIT_DAYS of today.
export function festivalsDue(keys, today, within = KIT_DAYS) {
  const out = [];
  for (const k of keys || []) {
    const f = festivalOf(k); if (!f) continue;
    for (const d of f.dates) {
      const n = daysBetween(today, d);
      if (n >= 0 && n <= within) out.push({ key: f.key, name: f.name, icon: f.icon, date: d, inDays: n });
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

// The next birthday or anniversary on or after today, from a stored date.
// 29 February is kept on the 28th in other years.
export function nextYearly(stored, today) {
  const s = String(stored || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const m = +s.slice(5, 7), d = +s.slice(8, 10);
  for (const y of [+today.slice(0, 4), +today.slice(0, 4) + 1]) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = y + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
    if (day >= today) return { day, year: y, inDays: daysBetween(today, day) };
  }
  return null;
}
