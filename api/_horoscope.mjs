// DAILY HOROSCOPE for the twelve signs.
//
// Unlike Choghadiya, a horoscope is not computable — it is written. So this
// is the one part that genuinely needs a source, and the source is the open
// horoscope API (github.com/tapasweni-pathak/Horoscope-API lineage, hosted
// free, no key). Two rules:
//   1. Fetched ONCE per sign per day and kept in the database. Twelve calls a
//      day for a whole family, not twelve per person per screen.
//   2. If the source cannot be reached, the app SAYS so. It never invents a
//      reading — a made-up horoscope presented as a real one is a lie, and a
//      family that spots one stops trusting everything else on the screen.

// WHAT THIS ACTUALLY IS, said once, plainly, because the app shows it to people.
//
// signOf() below reads a date of birth against fixed calendar ranges. That is a
// TROPICAL SUN SIGN — the Western zodiac, the one newspapers print and the one
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
export function signOf(dob) {
  const s = String(dob || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const mo = +m[2], da = +m[3];
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

// One sign, one day. Returns the text or null — never a fabrication.
export async function fetchSign(signKey, day) {
  try {
    const r = await fetch(`${ENDPOINT}?sign=${encodeURIComponent(signKey)}&day=TODAY`,
      { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const j = await r.json();
    const t = j && j.data && (j.data.horoscope_data || j.data.horoscope);
    const s = String(t || '').trim();
    return s.length > 20 ? s.slice(0, 900) : null;
  } catch (e) { return null; }
}

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
      } catch (e) { /* another instance won the race — its row is as good */ }
    }
  }
  const signs = SIGNS.map(s => ({
    key: s.k, name: s.en, hi: s.hi,
    dates: s.from.join('/') + ' – ' + s.to.join('/'),
    text: bySign[s.k] ? bySign[s.k].text : null,
    source: bySign[s.k] ? bySign[s.k].source : null
  }));
  return { day, signs, unavailable: signs.filter(s => !s.text).length };
}
