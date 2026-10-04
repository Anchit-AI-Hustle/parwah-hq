// PANCHANG - the day's muhurat, computed rather than fetched.
//
// Choghadiya, Rahu Kaal and the rest are not opinions and not a feed: they
// are arithmetic on sunrise and sunset for one place on one date, plus the
// weekday. So this module has NO dependencies and NO network - it is fully
// deterministic and can be tested to the minute.
//
// Every period carries a plain-English meaning. A parent who has kept
// Choghadiya all their life does not need it explained; their grandchild in
// London does, and the guide's whole point is that the family shares one
// screen.

// --- sunrise and sunset (NOAA solar position algorithm) ------------------
const RAD = Math.PI / 180;
function julian(d) { return d.getTime() / 86400000 + 2440587.5; }
// The Julian day number at MIDNIGHT UTC of whatever date was handed in, so
// the arithmetic below does not quietly depend on the time of day in the
// caller's Date. Always ends in .5, which is what the day count assumes.
function julianMidnightUTC(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000 + 2440587.5;
}
function solarNoonAndHourAngle(lat, lon, date) {
  const jd = julianMidnightUTC(date);
  // CEIL, not floor. A Julian day at midnight UTC ends in .5, so flooring it
  // picked the day number whose solar noon had already PASSED - every
  // sunrise, sunset, Choghadiya, Rahu Kaal and Abhijit came out for
  // YESTERDAY. Successive days differ by about a minute, so the times still
  // looked right and no almanac check caught it; only the date was wrong.
  const n = Math.ceil(jd - 2451545.0 + 0.0008);
  const Jstar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.44 * RAD));
  // -0.833° accounts for refraction and the sun's disc, as almanacs do.
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) /
               (Math.cos(lat * RAD) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null;      // polar day or night
  const H = Math.acos(cosH) / RAD;
  return { Jtransit, H };
}
function jdToDate(jd) { return new Date((jd - 2440587.5) * 86400000); }

// → { sunrise, sunset, dayMs } as Date objects in UTC, or null above the circles.
export function sunTimes(lat, lon, date) {
  const s = solarNoonAndHourAngle(lat, lon, date);
  if (!s) return null;
  const rise = jdToDate(s.Jtransit - s.H / 360);
  const set  = jdToDate(s.Jtransit + s.H / 360);
  return { sunrise: rise, sunset: set, dayMs: set - rise };
}

// --- Choghadiya ----------------------------------------------------------
// Eight parts of the day and eight of the night. The sequence rotates by
// weekday, which is why the same clock time is Amrit one day and Rog the next.
// Each Choghadiya is ruled by a planet, and that is the whole logic of the
// thing: the first window of a day belongs to the lord of that weekday, and
// the rest follow the classical (Chaldean) order of the planets. Sunday
// belongs to the Sun, so Sunday opens with Udveg; Monday to the Moon, so it
// opens with Amrit. Nothing here is a table someone copied - CHALDEAN and
// WEEKDAY_LORD below regenerate DAY_SEQ and NIGHT_SEQ exactly, and the test
// suite checks that they do.
export const CHALDEAN = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];
export const WEEKDAY_LORD = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];
export const LORD_OF = { Kaal:'Saturn', Shubh:'Jupiter', Rog:'Mars', Udveg:'Sun',
                         Chal:'Venus', Labh:'Mercury', Amrit:'Moon' };
const NAME_OF_LORD = {};
for (const k of Object.keys(LORD_OF)) NAME_OF_LORD[LORD_OF[k]] = k;
// Day: start at the weekday's lord, step one place along the Chaldean order.
// Night: start five places on, and step five at a time. Both are just walks
// around the same seven planets.
export function derivedDaySeq(wd) {
  const i = CHALDEAN.indexOf(WEEKDAY_LORD[wd]);
  return Array.from({ length: 8 }, (_, n) => NAME_OF_LORD[CHALDEAN[(i + n) % 7]]);
}
export function derivedNightSeq(wd) {
  const i = (CHALDEAN.indexOf(WEEKDAY_LORD[wd]) + 5) % 7;
  return Array.from({ length: 8 }, (_, n) => NAME_OF_LORD[CHALDEAN[(i + n * 5) % 7]]);
}

const NATURE = {
  Udveg:  { good: false, en: 'Restless - routine work only, avoid anything new' },
  Chal:   { good: true,  en: 'Moving - good for travel and errands' },
  Labh:   { good: true,  en: 'Gain - good for money matters and paperwork' },
  Amrit:  { good: true,  en: 'Nectar - the most auspicious; best for anything important' },
  Kaal:   { good: false, en: 'Loss - avoid starting anything you care about' },
  Shubh:  { good: true,  en: 'Auspicious - good for ceremonies, meetings, new beginnings' },
  Rog:    { good: false, en: 'By custom, a time to avoid new starts and disputes' }
};
// Day sequences, Sunday first (JS getDay(): 0 = Sunday).
const DAY_SEQ = [
  ['Udveg','Chal','Labh','Amrit','Kaal','Shubh','Rog','Udveg'],       // Sun
  ['Amrit','Kaal','Shubh','Rog','Udveg','Chal','Labh','Amrit'],       // Mon
  ['Rog','Udveg','Chal','Labh','Amrit','Kaal','Shubh','Rog'],         // Tue
  ['Labh','Amrit','Kaal','Shubh','Rog','Udveg','Chal','Labh'],        // Wed
  ['Shubh','Rog','Udveg','Chal','Labh','Amrit','Kaal','Shubh'],       // Thu
  ['Chal','Labh','Amrit','Kaal','Shubh','Rog','Udveg','Chal'],        // Fri
  ['Kaal','Shubh','Rog','Udveg','Chal','Labh','Amrit','Kaal']         // Sat
];
const NIGHT_SEQ = [
  ['Shubh','Amrit','Chal','Rog','Kaal','Labh','Udveg','Shubh'],       // Sun
  ['Chal','Rog','Kaal','Labh','Udveg','Shubh','Amrit','Chal'],        // Mon
  ['Kaal','Labh','Udveg','Shubh','Amrit','Chal','Rog','Kaal'],        // Tue
  ['Udveg','Shubh','Amrit','Chal','Rog','Kaal','Labh','Udveg'],       // Wed
  ['Amrit','Chal','Rog','Kaal','Labh','Udveg','Shubh','Amrit'],       // Thu
  ['Rog','Kaal','Labh','Udveg','Shubh','Amrit','Chal','Rog'],         // Fri
  ['Labh','Udveg','Shubh','Amrit','Chal','Rog','Kaal','Labh']         // Sat
];

function slice(startMs, totalMs, names) {
  const step = totalMs / 8;
  return names.map((n, i) => ({
    name: n, lord: LORD_OF[n], ...NATURE[n],
    from: new Date(startMs + i * step),
    to:   new Date(startMs + (i + 1) * step)
  }));
}

// --- the named periods everyone asks about -------------------------------
// Each is the Nth eighth of the daylight span, by weekday. Stated as an
// eighth rather than a clock time because the day is not 12 hours long.
const RAHU_PART     = [8, 2, 7, 5, 6, 4, 3];   // Sun..Sat, 1-indexed eighth
const GULIKA_PART   = [7, 6, 5, 4, 3, 2, 1];
const YAMAGANDA_PART= [5, 4, 3, 2, 1, 7, 6];

function nth(sunriseMs, dayMs, part) {
  const step = dayMs / 8;
  return { from: new Date(sunriseMs + (part - 1) * step), to: new Date(sunriseMs + part * step) };
}

export function panchang(lat, lon, date) {
  const t = sunTimes(lat, lon, date);
  if (!t) return null;
  const wd = date.getUTCDay();
  const riseMs = +t.sunrise, setMs = +t.sunset, dayMs = t.dayMs;
  // Night runs from sunset to the NEXT sunrise.
  const next = sunTimes(lat, lon, new Date(+date + 86400000));
  const nightMs = next ? (+next.sunrise - setMs) : (86400000 - dayMs);

  // Abhijit is the EIGHTH MUHURTA OF FIFTEEN - the day split fifteen ways, not
  // eight - so it is roughly 48 minutes centred on solar noon, not 90. Being
  // the middle one of fifteen is exactly why it lands on noon. Traditionally
  // skipped on Wednesday.
  const noonMs = riseMs + dayMs / 2, half = dayMs / 30;

  return {
    sunrise: t.sunrise, sunset: t.sunset,
    day:   slice(riseMs, dayMs, DAY_SEQ[wd]),
    night: slice(setMs, nightMs, NIGHT_SEQ[wd]),
    rahuKaal:  { ...nth(riseMs, dayMs, RAHU_PART[wd]),
      en: 'Rahu Kaal - the inauspicious hour. By custom nothing new is begun in it; ongoing work carries on.' },
    gulikaKaal: { ...nth(riseMs, dayMs, GULIKA_PART[wd]),
      en: 'Gulika Kaal - also avoided for new beginnings, though held to be milder than Rahu Kaal.' },
    yamaganda: { ...nth(riseMs, dayMs, YAMAGANDA_PART[wd]),
      en: 'Yamaganda - avoided for travel and important starts.' },
    abhijit: wd === 3 ? null : { from: new Date(noonMs - half), to: new Date(noonMs + half),
      en: 'Abhijit Muhurat - the short auspicious window around midday, good for anything important.' }
  };
}

// Which period is running right now, so the screen answers the real question.
export function currentPeriod(p, now) {
  const all = (p.day || []).concat(p.night || []);
  return all.find(x => now >= x.from && now < x.to) || null;
}
