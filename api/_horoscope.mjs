// DAILY HOROSCOPE for the twelve signs.
//
// Unlike Choghadiya, a horoscope is not computable - it is written. So this
// is the one part that genuinely needs a source, and the source is the open
// horoscope API (github.com/tapasweni-pathak/Horoscope-API lineage, hosted
// free, no key). Two rules:
//   1. Fetched ONCE per sign per day and kept in the database. Twelve calls a
//      day for a whole family, not twelve per person per screen.
//   2. If the source cannot be reached, the app SAYS so. It never invents a
//      reading - a made-up horoscope presented as a real one is a lie, and a
//      family that spots one stops trusting everything else on the screen.

// WHAT THIS ACTUALLY IS, said once, plainly, because the app shows it to people.
//
// signOf() below reads a date of birth against fixed calendar ranges. That is a
// TROPICAL SUN SIGN - the Western zodiac, the one newspapers print and the one
// this source writes for.
//
// A Vedic *rashi* is not that. It is a MOON sign: which of the twelve the Moon
// stood in at the moment of birth. Working it out needs the time and the place
// of birth, not just the date, and for most people it is a different sign from
// their sun sign. Parwah does not ask for a birth time, so Parwah does not know
// anyone's rashi and must not say that it does. The Hindi names are kept
// because they are the familiar ones; the screen says which basis is in use.
export const SIGN_BASIS = {
  is: 'sun sign (Western zodiac), from your date of birth',
  isNot: 'a Vedic rashi, which is a moon sign and needs your birth time and place'
};

export const SIGNS = [
  { k: 'aries',       en: 'Aries',       hi: 'मेष',    from: [3, 21],  to: [4, 19] },
  { k: 'taurus',      en: 'Taurus',      hi: 'वृषभ',   from: [4, 20],  to: [5, 20] },
  { k: 'gemini',      en: 'Gemini',      hi: 'मिथुन',  from: [5, 21],  to: [6, 20] },
  { k: 'cancer',      en: 'Cancer',      hi: 'कर्क',   from: [6, 21],  to: [7, 22] },
  { k: 'leo',         en: 'Leo',         hi: 'सिंह',   from: [7, 23],  to: [8, 22] },
  { k: 'virgo',       en: 'Virgo',       hi: 'कन्या',  from: [8, 23],  to: [9, 22] },
  { k: 'libra',       en: 'Libra',       hi: 'तुला',   from: [9, 23],  to: [10, 22] },
  { k: 'scorpio',     en: 'Scorpio',     hi: 'वृश्चिक', from: [10, 23], to: [11, 21] },
  { k: 'sagittarius', en: 'Sagittarius', hi: 'धनु',    from: [11, 22], to: [12, 21] },
  { k: 'capricorn',   en: 'Capricorn',   hi: 'मकर',    from: [12, 22], to: [1, 19] },
  { k: 'aquarius',    en: 'Aquarius',    hi: 'कुम्भ',  from: [1, 20],  to: [2, 18] },
  { k: 'pisces',      en: 'Pisces',      hi: 'मीन',    from: [2, 19],  to: [3, 20] }
];

// Date of birth → sign. Capricorn wraps the year end, which is the one case
// a naive range check gets wrong.
//
// The database driver hands a date column back as a Date, not as text, and
// String() of a Date is "Mon May 14 1990 ...", which never matched: every
// sign in every family was blank. A Date is read by its own calendar day
// (the driver makes it at local midnight), text as YYYY-MM-DD.
export function signOf(dob) {
  let mo, da;
  if (dob instanceof Date) {
    if (isNaN(+dob)) return null;
    mo = dob.getMonth() + 1; da = dob.getDate();
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob || ''));
    if (!m) return null;
    mo = +m[2]; da = +m[3];
  }
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  for (const sg of SIGNS) {
    const [fm, fd] = sg.from, [tm, td] = sg.to;
    if (fm <= tm) { if ((mo === fm && da >= fd) || (mo === tm && da <= td) || (mo > fm && mo < tm)) return sg; }
    else { if ((mo === fm && da >= fd) || (mo === tm && da <= td)) return sg; }   // Capricorn
  }
  return null;
}

export async function ensureHoroscopeSchema(sql) {
  await sql`create table if not exists horoscope (
    day date not null,
    sign text not null,
    text text not null,
    source text not null,
    fetched_at timestamptz not null default now(),
    primary key (day, sign)
  )`;
}

export const ENDPOINT = 'https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily';

// Someone else writes these, so they are read before a family sees them.
// A reading that strays into health, medicines or money is not shown at all:
// Parwah never gives that advice, and a horoscope does not get to either.
const ADVISES = /\b(health|medic\w*|doctor|diagnos\w*|illness|disease|surgery|hospital|cure[sd]?|heal(s|ed|ing)?|therap\w*|remed(y|ies)|diet|pills?|dose|invest\w*|stocks?|shares|lottery|loans?|gambl\w*|betting|speculat\w*|windfall|financial gains?|wealth|profits?)\b/i;
// The long dashes, by code point, so this file holds none itself.
const LONG_DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']', 'g');
export function cleanReading(text) {
  let s = String(text || '').replace(LONG_DASH, ' - ').replace(/\s+/g, ' ').trim();
  if (s.length <= 20 || ADVISES.test(s)) return null;
  if (s.length > 900) {
    // Cut at the last full sentence, never mid-word.
    const cut = s.slice(0, 900), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = end > 200 ? cut.slice(0, end + 1) : cut.slice(0, 897).replace(/\s+\S*$/, '') + '...';
  }
  return s;
}

// One sign, one day. Returns the text or null - never a fabrication. The
// source answers for its own "today"; a reading dated any other day than the
// India date it is stored under is refused rather than shown as today's.
export async function fetchSign(signKey, day) {
  try {
    const r = await fetch(`${ENDPOINT}?sign=${encodeURIComponent(signKey)}&day=TODAY`,
      { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const j = await r.json();
    const said = j && j.data && j.data.date;
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(String(said || '')) && said !== day) return null;
    const t = j && j.data && (j.data.horoscope_data || j.data.horoscope);
    return cleanReading(t);
  } catch (e) { return null; }
}

// "21 Mar - 19 Apr", the way the dates are read here.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const signDates = s => s.from[1] + ' ' + MON[s.from[0] - 1] + ' - ' + s.to[1] + ' ' + MON[s.to[0] - 1];

// Today's twelve, from the database, filling only what is missing. A failed
// fetch leaves that sign absent rather than storing something invented.
export async function horoscopeToday(sql, day) {
  await ensureHoroscopeSchema(sql);
  const have = await sql`select sign, text, source from horoscope where day = ${day}`;
  const bySign = {};
  have.forEach(r => { bySign[r.sign] = { text: r.text, source: r.source }; });
  const missing = SIGNS.filter(s => !bySign[s.k]);
  if (missing.length) {
    const got = await Promise.all(missing.map(async s => ({ s, text: await fetchSign(s.k, day) })));
    for (const g of got) {
      if (!g.text) continue;
      try {
        await sql`insert into horoscope (day, sign, text, source)
                  values (${day}, ${g.s.k}, ${g.text}, ${'horoscope-app-api'})
                  on conflict (day, sign) do nothing`;
        bySign[g.s.k] = { text: g.text, source: 'horoscope-app-api' };
      } catch (e) { /* another instance won the race - its row is as good */ }
    }
  }
  const signs = SIGNS.map(s => ({
    key: s.k, name: s.en, hi: s.hi,
    dates: signDates(s),
    text: bySign[s.k] ? bySign[s.k].text : null,
    source: bySign[s.k] ? bySign[s.k].source : null
  }));
  // feedDown: none of the twelve came, so the screen says so once instead
  // of "Not available today." twelve times.
  const unavailable = signs.filter(s => !s.text).length;
  return { day, signs, unavailable, feedDown: unavailable === signs.length };
}
