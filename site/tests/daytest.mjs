// THE DAY — muhurat and rashi, tested to the minute.
//
// Choghadiya is arithmetic, so it can be checked against a published almanac
// rather than trusted. These three modules import nothing, so this test runs
// on a fresh clone before npm install, exactly like phonetest.mjs.
import { sunTimes, panchang, currentPeriod, CHALDEAN, WEEKDAY_LORD, LORD_OF,
         derivedDaySeq, derivedNightSeq } from '../../api/_panchang.mjs';
import { placeOf, CITIES } from '../../api/_places.mjs';
import { SIGNS, signOf, fetchSign, ENDPOINT } from '../../api/_horoscope.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log('FAIL', n)); };
const hhmm = (d, tz) => new Date(d).toLocaleTimeString('en-IN', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
const IST = 'Asia/Kolkata';

// ---- sunrise and sunset against published almanac times -----------------
// Delhi, 31 Aug 2026: almanacs give 05:58 / 18:46 IST.
const del = panchang(28.6139, 77.2090, new Date('2026-08-31T00:00:00Z'));
ok(hhmm(del.sunrise, IST) === '05:58', 'Delhi sunrise matches the almanac → ' + hhmm(del.sunrise, IST));
ok(hhmm(del.sunset, IST) === '18:46', 'Delhi sunset matches the almanac → ' + hhmm(del.sunset, IST));
// Mumbai the same day: 06:23 / 18:55 IST. Same clock, different sky — which is
// the whole reason muhurat is computed per city and not per country.
const mum = panchang(19.0760, 72.8777, new Date('2026-08-31T00:00:00Z'));
ok(hhmm(mum.sunrise, IST) === '06:23', 'Mumbai sunrise differs from Delhi → ' + hhmm(mum.sunrise, IST));
ok(hhmm(mum.sunset, IST) === '18:55', 'Mumbai sunset differs from Delhi → ' + hhmm(mum.sunset, IST));
ok(+mum.sunrise !== +del.sunrise, 'two cities never share one sunrise');
// Above the Arctic circle in midsummer there is no sunrise, and that is not a crash.
ok(sunTimes(78.2, 15.6, new Date('2026-06-21T00:00:00Z')) === null, 'polar day returns null, not NaN');
ok(panchang(78.2, 15.6, new Date('2026-06-21T00:00:00Z')) === null, 'panchang above the circle is null');

// ---- Choghadiya structure ------------------------------------------------
ok(del.day.length === 8 && del.night.length === 8, 'eight day parts and eight night parts');
ok(+del.day[0].from === +del.sunrise, 'the day begins at sunrise');
ok(+del.day[7].to === +del.sunset, 'the day ends at sunset');
ok(+del.night[0].from === +del.sunset, 'the night begins at sunset');
let gap = false;
del.day.concat(del.night).forEach((p, i, a) => { if (i && +a[i - 1].to !== +p.from) gap = true; });
ok(!gap, 'no minute of the day falls outside a period');
ok(del.day.every(p => p.en && p.en.length > 12), 'every day period carries a plain-English meaning');
ok(del.night.every(p => p.en && p.en.length > 12), 'every night period carries a plain-English meaning');
ok(del.day.every(p => typeof p.good === 'boolean'), 'every period says whether it is auspicious');

// ---- the weekday rotation, which is the part that is easy to get wrong ---
// 31 Aug 2026 is a Monday: the first Choghadiya of a Monday is Amrit.
ok(del.day[0].name === 'Amrit', 'Monday opens with Amrit → ' + del.day[0].name);
// Sunday opens with Udveg; Saturday with Kaal.
ok(panchang(28.6139, 77.2090, new Date('2026-08-30T00:00:00Z')).day[0].name === 'Udveg', 'Sunday opens with Udveg');
ok(panchang(28.6139, 77.2090, new Date('2026-09-05T00:00:00Z')).day[0].name === 'Kaal', 'Saturday opens with Kaal');
// The same clock time is a different Choghadiya on a different day — the
// single fact that makes a lookup table wrong.
ok(panchang(28.6139, 77.2090, new Date('2026-09-01T00:00:00Z')).day[0].name !== del.day[0].name,
  'the sequence rotates with the weekday');

// ---- the sequence is DERIVED, not a table someone copied ----------------
// Every Choghadiya is ruled by a planet; the day's first belongs to the lord of
// that weekday and the rest walk the classical (Chaldean) order. If the shipped
// tables ever stop matching that walk, one of them is wrong — and the screen
// explains the walk to the family, so it had better be the truth.
ok(CHALDEAN.length === 7 && CHALDEAN[0] === 'Saturn' && CHALDEAN[6] === 'Moon',
   'the Chaldean order is the classical one');
ok(WEEKDAY_LORD.join() === 'Sun,Moon,Mars,Mercury,Jupiter,Venus,Saturn',
   'each weekday has its classical lord, Sunday first');
ok(Object.keys(LORD_OF).length === 7 && LORD_OF.Amrit === 'Moon' && LORD_OF.Kaal === 'Saturn',
   'each of the seven Choghadiya has its planet');
ok(new Set(Object.values(LORD_OF)).size === 7, 'and no two share one');
let seqBad = 0;
for (let wd = 0; wd < 7; wd++) {
  const d = panchang(28.6139, 77.2090, new Date(Date.UTC(2026, 7, 30 + wd)));
  if (d.day.map(x => x.name).join() !== derivedDaySeq(wd).join()) seqBad++;
  if (d.night.map(x => x.name).join() !== derivedNightSeq(wd).join()) seqBad++;
}
ok(seqBad === 0, 'all fourteen shipped sequences regenerate from the planets (' + seqBad + ' did not)');
ok(derivedDaySeq(0)[0] === 'Udveg' && derivedDaySeq(1)[0] === 'Amrit',
   'Sunday opens with the Sun\u2019s window, Monday with the Moon\u2019s');
ok(panchang(28.6139, 77.2090, new Date('2026-08-31T00:00:00Z')).day[0].lord === 'Moon',
   'and every period carries its planet, so the screen can show why');

// ---- Rahu Kaal and friends ----------------------------------------------
// Monday's Rahu Kaal is the second eighth of the day. Delhi almanacs publish
// roughly 07:30–09:00 for this date; computed from this sunrise it is 07:34.
ok(hhmm(del.rahuKaal.from, IST) === '07:34' && hhmm(del.rahuKaal.to, IST) === '09:10',
  'Monday Rahu Kaal is the second eighth → ' + hhmm(del.rahuKaal.from, IST) + '–' + hhmm(del.rahuKaal.to, IST));
ok(+del.rahuKaal.from === +del.day[1].from, 'Rahu Kaal lines up with a Choghadiya boundary');
ok(/Rahu Kaal/.test(del.rahuKaal.en) && /nothing new/i.test(del.rahuKaal.en), 'Rahu Kaal is explained in English, not just named');
ok(/Gulika/.test(del.gulikaKaal.en) && /Yamaganda/.test(del.yamaganda.en), 'Gulika and Yamaganda are explained too');
ok(+del.rahuKaal.from !== +del.gulikaKaal.from && +del.rahuKaal.from !== +del.yamaganda.from,
  'the three inauspicious hours are three different hours');
// Abhijit sits around midday and is traditionally skipped on Wednesday.
ok(del.abhijit && /Abhijit/.test(del.abhijit.en), 'Abhijit is named and explained');
ok(+del.abhijit.from > +del.sunrise && +del.abhijit.to < +del.sunset, 'Abhijit falls inside the day');
// It is the 8th muhurta of FIFTEEN, not an eighth of the day: ~48 minutes, not
// ~96. It was the wider one until this was checked.
const abMin = (+del.abhijit.to - +del.abhijit.from) / 60000;
ok(abMin > 44 && abMin < 54, 'Abhijit is one fifteenth of the day, about 48 minutes \u2192 ' + Math.round(abMin));
const abMid = (+del.abhijit.from + +del.abhijit.to) / 2, solarNoon = (+del.sunrise + +del.sunset) / 2;
ok(Math.abs(abMid - solarNoon) < 60000, 'and being the middle muhurta, it is centred on solar noon');
ok(panchang(28.6139, 77.2090, new Date('2026-09-02T00:00:00Z')).abhijit === null, 'Wednesday has no Abhijit');

// ---- which period is running now ----------------------------------------
const mid = new Date((+del.day[3].from + +del.day[3].to) / 2);
ok(currentPeriod(del, mid) === del.day[3], 'currentPeriod finds the period around a moment inside it');
ok(currentPeriod(del, new Date(+del.day[0].from - 60000)) === null, 'before sunrise nothing is running');
ok(currentPeriod(del, del.night[7].to) === null, 'after the last night part nothing is running');

// ---- where a family member lives ----------------------------------------
ok(placeOf('Delhi').lat === 28.6139 && !placeOf('Delhi').guessed, 'exact city match');
ok(placeOf('  DELHI ').lat === 28.6139, 'case and spaces do not matter');
ok(placeOf('Pune, Maharashtra').lat === 18.5204, 'a comma part matches');
ok(placeOf('Greater Noida').lat === 28.5355, 'a city named inside a string matches');
ok(placeOf('Bengaluru').lat === placeOf('Bangalore').lat, 'both names of one city land in one place');
ok(placeOf('Dubai').tz === 'Asia/Dubai', 'an NRI city keeps its own timezone');
ok(placeOf('Nowhereville').guessed === true, 'an unknown place is flagged, never passed off as known');
ok(placeOf('').guessed === true && placeOf('').lat === 28.6139, 'no place at all falls back to Delhi, and says it is a fallback');
ok(placeOf('Nowhereville').name === 'Nowhereville', 'the flagged fallback still echoes what was typed');
ok(Object.values(CITIES).every(c => c.length === 3 && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180 && /\//.test(c[2])),
  'every city has a sane latitude, longitude and IANA timezone');

// ---- rashi from date of birth -------------------------------------------
ok(SIGNS.length === 12, 'twelve signs');
ok(SIGNS.every(s => s.hi && s.en && s.k), 'every sign is named in English and Hindi');
ok(signOf('1958-03-21').k === 'aries', 'first day of Aries');
ok(signOf('1958-04-19').k === 'aries', 'last day of Aries');
ok(signOf('1958-04-20').k === 'taurus', 'the boundary moves on the right day');
ok(signOf('1990-12-21').k === 'sagittarius', 'last day of Sagittarius');
ok(signOf('1990-12-22').k === 'capricorn', 'Capricorn starts in December');
ok(signOf('1991-01-19').k === 'capricorn', 'Capricorn still runs in January — the year-end wrap');
ok(signOf('1991-01-20').k === 'aquarius', 'Aquarius takes over');
ok(signOf('1962-07-22').k === 'cancer' && signOf('1962-07-23').k === 'leo', 'Cancer into Leo');
ok(signOf('1962-03-20').k === 'pisces', 'Pisces ends the wheel');
ok(signOf(null) === null && signOf('') === null && signOf('not a date') === null, 'a missing birthday is null, not a guess');
ok(signOf('1958-13-01') === null && signOf('1958-02-32') === null, 'an impossible date is null');
ok(signOf(new Date('1958-03-21T00:00:00Z').toISOString()).k === 'aries', 'a full timestamp works as well as a date');
// Every day of a leap year lands on exactly one sign — no gaps, no overlaps.
let missing = 0, seen = {};
for (let d = new Date(Date.UTC(2024, 0, 1)); d.getUTCFullYear() === 2024; d.setUTCDate(d.getUTCDate() + 1)) {
  const s = signOf(d.toISOString().slice(0, 10));
  if (!s) missing++; else seen[s.k] = (seen[s.k] || 0) + 1;
}
ok(missing === 0, 'every day of a leap year has a sign (' + missing + ' without one)');
ok(Object.keys(seen).length === 12, 'all twelve signs are reachable');


// ---- the one thing that comes from someone else -------------------------
// The horoscope source is the only part of the day that is fetched. It cannot
// be reached from a build machine, so what IS tested here is how the app
// handles every answer it can give — most importantly the ones where it must
// say "not available" instead of writing something plausible.
const realFetch = globalThis.fetch;
let lastUrl = '';
const stub = (impl) => { globalThis.fetch = async (u) => { lastUrl = String(u); return impl(); }; };
const body = (data) => ({ ok: true, json: async () => data });
const READING = 'A steady day. Say the thing you have been putting off and ring the person you keep meaning to ring.';

stub(() => body({ data: { horoscope_data: READING } }));
ok(await fetchSign('leo', '2026-08-31') === READING, 'a good reading comes back intact');
ok(lastUrl.startsWith(ENDPOINT) && lastUrl.includes('sign=leo'), 'the sign is asked for by name → ' + lastUrl.slice(ENDPOINT.length));
stub(() => body({ data: { horoscope: READING } }));
ok(await fetchSign('leo', '2026-08-31') === READING, 'the older field name is accepted too');
stub(() => ({ ok: false, status: 500, json: async () => ({}) }));
ok(await fetchSign('leo', '2026-08-31') === null, 'a server error yields nothing, never a stand-in');
stub(() => body({ data: { horoscope_data: 'Good day.' } }));
ok(await fetchSign('leo', '2026-08-31') === null, 'a suspiciously short body is refused');
stub(() => body({ nonsense: true }));
ok(await fetchSign('leo', '2026-08-31') === null, 'an unexpected shape yields nothing');
stub(() => { throw new Error('network down'); });
ok(await fetchSign('leo', '2026-08-31') === null, 'a dead network is caught, not thrown at the family');
stub(() => body({ data: { horoscope_data: 'x'.repeat(5000) } }));
ok((await fetchSign('leo', '2026-08-31')).length === 900, 'an enormous reading is trimmed rather than shipped whole');
globalThis.fetch = realFetch;

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
