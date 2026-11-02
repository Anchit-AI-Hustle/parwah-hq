// TYOHAAR KIT - the festivals a family or a group may choose to celebrate
// together, with their dates from November 2026 to December 2027.
//
// Imports nothing, so the deploy gate checks it before npm install
// (site/tests/bondtest.mjs). The list is inclusive and nothing is assumed:
// a circle sees no festival at all until it picks the ones it keeps.
//
// Every date was checked against two published calendars (searched
// 2 November 2026): the source pair is written next to each one. Dates that
// follow the moon or a regional almanac can differ by a day by region or by
// sighting; the app says so under the list. Parwah makes no muhurat or
// religious claim about any of them: the Day screen is where good times live.
export const KIT_DAYS = 14;   // "Plan Diwali together" shows this many days before

export const FESTIVALS = [
  // Diwali: urbanmoney + navbharatlive (2026); calendarific + hindu-blog (2027)
  { key: 'diwali', name: 'Diwali', icon: '🪔', dates: ['2026-11-08', '2027-10-29'] },
  // Bhai Dooj: dekhopanchang + publicholidays.in, both years
  { key: 'bhaidooj', name: 'Bhai Dooj', icon: '🌼', dates: ['2026-11-11', '2027-10-31'] },
  // Guru Nanak Jayanti: urbanmoney + bankbazaar (2026); publicholidays.in + qppstudio (2027; Drik Panchang says 13 Nov)
  { key: 'gurunanak', name: 'Guru Nanak Jayanti', icon: '🙏', dates: ['2026-11-24', '2027-11-14'] },
  // Christmas and New Year: fixed dates
  { key: 'christmas', name: 'Christmas', icon: '🎄', dates: ['2026-12-25', '2027-12-25'] },
  { key: 'newyear', name: 'New Year', icon: '🎉', dates: ['2027-01-01'] },
  // Lohri: calendarlabs + hindutone
  { key: 'lohri', name: 'Lohri', icon: '🔥', dates: ['2027-01-13'] },
  // Makar Sankranti and Pongal: drikpanchang + truecalendar (some calendars say 14 Jan)
  { key: 'sankranti', name: 'Makar Sankranti', icon: '🪁', dates: ['2027-01-15'] },
  { key: 'pongal', name: 'Pongal', icon: '🍚', dates: ['2027-01-15'] },
  // Eid al-Fitr: calendarific + truecalendar (tentative, on sighting of the moon)
  { key: 'eidfitr', name: 'Eid al-Fitr', icon: '🌙', dates: ['2027-03-10'] },
  // Holi: calendarific + hindupad
  { key: 'holi', name: 'Holi', icon: '🎨', dates: ['2027-03-22'] },
  // Eid al-Adha: calendarific + truecalendar (tentative, on sighting of the moon)
  { key: 'eidadha', name: 'Eid al-Adha', icon: '🌙', dates: ['2027-05-17'] },
  // Raksha Bandhan: drikpanchang + dekhopanchang
  { key: 'rakhi', name: 'Raksha Bandhan', icon: '🧵', dates: ['2027-08-17'] },
  // Ganesh Chaturthi: calendarific + hindupad (Drik Panchang says 3 Sep)
  { key: 'ganesh', name: 'Ganesh Chaturthi', icon: '🐘', dates: ['2027-09-04'] },
  // Onam (Thiruvonam): truecalendar + drikpanchang
  { key: 'onam', name: 'Onam', icon: '🌸', dates: ['2027-09-12'] },
  // Navratri / Durga Puja, first day: days.to + drikpanchang
  { key: 'navratri', name: 'Navratri / Durga Puja', icon: '💃', dates: ['2027-09-30'] },
  // Karva Chauth: calendarific + outside.so
  { key: 'karvachauth', name: 'Karva Chauth', icon: '🌕', dates: ['2027-10-18'] }
];

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
