// THE DAY - muhurat and rashi, tested to the minute.
//
// Choghadiya is arithmetic, so it can be checked against a published almanac
// rather than trusted. These three modules import nothing, so this test runs
// on a fresh clone before npm install, exactly like phonetest.mjs.
import { sunTimes, panchang, currentPeriod, periodNow, CHALDEAN, WEEKDAY_LORD, LORD_OF,
         derivedDaySeq, derivedNightSeq } from '../../api/_panchang.mjs';
import { placeOf, CITIES, CAPITALS } from '../../api/_places.mjs';
import { SIGNS, signOf, fetchSign, ENDPOINT } from '../../api/_horoscope.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log('FAIL', n)); };
const hhmm = (d, tz) => new Date(d).toLocaleTimeString('en-IN', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
const IST = 'Asia/Kolkata';

// ---- sunrise and sunset against published almanac times -----------------
// Delhi, 31 Aug 2026: 05:58 / 18:45 IST.
//
// This block used to expect 18:46, which is 30 August's sunset, because the
// day number was floored from a Julian day ending in .5 and every answer
// came out for the day BEFORE the one asked for. Successive days differ by
// about a minute, so the times still looked almanac-shaped and only the
// DATE was wrong - which is why the first assertion below now exists.
const ymd = (d, tz) => new Date(d).toLocaleDateString('en-CA', { timeZone: tz });
const del = panchang(28.6139, 77.2090, new Date('2026-08-31T00:00:00Z'));
ok(ymd(del.sunrise, IST) === '2026-08-31' && ymd(del.sunset, IST) === '2026-08-31',
   'the day asked for is the day answered → ' + ymd(del.sunrise, IST));
ok(hhmm(del.sunrise, IST) === '05:58', 'Delhi sunrise matches the almanac → ' + hhmm(del.sunrise, IST));
ok(hhmm(del.sunset, IST) === '18:45', 'Delhi sunset matches the almanac → ' + hhmm(del.sunset, IST));
// Sunset moves about a minute a day here, so three consecutive days must
// step, not repeat: the off-by-one made day N return day N-1 exactly.
const d30 = panchang(28.6139, 77.2090, new Date('2026-08-30T00:00:00Z'));
const d01 = panchang(28.6139, 77.2090, new Date('2026-09-01T00:00:00Z'));
ok(ymd(d30.sunrise, IST) === '2026-08-30' && ymd(d01.sunrise, IST) === '2026-09-01',
   'consecutive days answer for themselves, not for the day before');
// Compare the CLOCK time, not the timestamp: 31 Aug 18:45 is of course a
// later moment than 30 Aug 18:46, and that is not what is being checked.
ok(hhmm(d30.sunset, IST) > hhmm(del.sunset, IST) && hhmm(del.sunset, IST) > hhmm(d01.sunset, IST),
   'and sunset walks earlier day by day, as it does in late August ('
   + hhmm(d30.sunset, IST) + ' → ' + hhmm(del.sunset, IST) + ' → ' + hhmm(d01.sunset, IST) + ')');
// A Date carrying a time of day must not shift the answer to another date.
const noonUTC = panchang(28.6139, 77.2090, new Date('2026-08-31T12:00:00Z'));
const lateUTC = panchang(28.6139, 77.2090, new Date('2026-08-31T23:30:00Z'));
ok(+noonUTC.sunrise === +del.sunrise && +lateUTC.sunrise === +del.sunrise,
   'the time of day in the Date handed in changes nothing');
// Mumbai the same day: 06:23 / 18:55 IST. Same clock, different sky - which is
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
// The same clock time is a different Choghadiya on a different day - the
// single fact that makes a lookup table wrong.
ok(panchang(28.6139, 77.2090, new Date('2026-09-01T00:00:00Z')).day[0].name !== del.day[0].name,
  'the sequence rotates with the weekday');

// ---- the sequence is DERIVED, not a table someone copied ----------------
// Every Choghadiya is ruled by a planet; the day's first belongs to the lord of
// that weekday and the rest walk the classical (Chaldean) order. If the shipped
// tables ever stop matching that walk, one of them is wrong - and the screen
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

// ---- before sunrise it is still last night ---------------------------------
// 03:00 in Delhi on a Thursday, 2026-09-03: today's sunrise is hours away,
// so the period running is the end of Wednesday night, by Wednesday's order.
{
  const day = new Date('2026-09-03T00:00:00Z');
  const at3 = new Date('2026-09-02T21:30:00Z');   // 03:00 IST, 3 Sept
  const pn = periodNow(28.6139, 77.2090, day, at3);
  const wed = panchang(28.6139, 77.2090, new Date('2026-09-02T00:00:00Z'));
  ok(pn.current && pn.current.name, 'at 3 am a period is named, not "between windows" -> ' + (pn.current && pn.current.name));
  ok(pn.lastNight === true && wed.night.some(x => x.name === pn.current.name && +x.from === +pn.current.from), 'and it is one of last night\'s, by Wednesday\'s order');
  ok(at3 >= pn.current.from && at3 < pn.current.to, 'and it really is running at 3 am');
  ok(+pn.panchang.sunrise === +panchang(28.6139, 77.2090, day).sunrise, 'the rest of the card is still today\'s');
  const noon = new Date('2026-09-03T06:30:00Z');
  ok(periodNow(28.6139, 77.2090, day, noon).current && !periodNow(28.6139, 77.2090, day, noon).lastNight, 'after sunrise it is today\'s as before');
}

// ---- where a family member lives ----------------------------------------
ok(placeOf('Delhi').lat === 28.6139 && !placeOf('Delhi').guessed, 'exact city match');
ok(placeOf('  DELHI ').lat === 28.6139, 'case and spaces do not matter');
ok(placeOf('Pune, Maharashtra').lat === 18.5204, 'a comma part matches');
ok(placeOf('Greater Noida').lat === 28.5355, 'a city named inside a string matches');
ok(placeOf('Bengaluru').lat === placeOf('Bangalore').lat, 'both names of one city land in one place');
ok(placeOf('Dubai').tz === 'Asia/Dubai', 'an NRI city keeps its own timezone');
ok(placeOf('Nowhereville').guessed === true, 'an unknown place is flagged, never passed off as known');
ok(placeOf('').guessed === true && placeOf('').lat === 28.6139, 'no place at all falls back to Delhi, and says it is a fallback');
ok(placeOf('').unset === true && !placeOf('Chhotapur').unset && !placeOf('Pune').unset,
   'no city at all is told apart from a city we do not know, so the app can say "add your city"');
ok(placeOf('Nowhereville').name === 'Nowhereville', 'the flagged fallback still echoes what was typed');
ok(Object.values(CITIES).every(c => c.length === 4 && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180 && /\//.test(c[2]) && /^[A-Z]{2}$/.test(c[3])),
  'every city has a sane latitude, longitude, IANA timezone and country');
ok(Object.values(CAPITALS).every(c => c.length === 4 && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180 && /\//.test(c[2]) && c[3]),
  'every capital has a sane latitude, longitude, timezone and name');
ok(Object.values(CITIES).concat(Object.values(CAPITALS)).every(c => { try { new Intl.DateTimeFormat('en', { timeZone: c[2] }); return true; } catch (e) { return false; } }),
  'every timezone in the tables is one the runtime knows');
ok(placeOf('', 'US').tz === 'America/New_York' && placeOf('', 'US').unset && placeOf('', 'US').usedName === 'Washington',
  'no city but a country: the capital of that country, not Delhi');
ok(placeOf('Nowhereville', 'DE').tz === 'Europe/Berlin' && placeOf('Nowhereville', 'DE').guessed,
  'an unknown city abroad falls back to that country, still flagged');
ok(placeOf('', '', 'Europe/Paris').tz === 'Europe/Paris', 'no city or country: a city in the phone timezone');
ok(placeOf('London', 'CA').tz === 'America/Toronto' && placeOf('London', 'GB').tz === 'Europe/London',
  'a name shared by two countries follows the member country');
ok(placeOf('Toronto', 'IN').tz === 'America/Toronto' && !placeOf('Toronto', 'IN').guessed,
  'a city that exists only once wins over the profile country');
ok(placeOf('Malerkotla').usedName === 'New Delhi', 'a short city name inside a longer word does not match (Male is not Malerkotla)');
ok(placeOf('Sao Paulo').tz === 'America/Sao_Paulo' && placeOf('Tokyo').tz === 'Asia/Tokyo', 'cities far from India resolve');

// ---- rashi from date of birth -------------------------------------------
ok(SIGNS.length === 12, 'twelve signs');
ok(SIGNS.every(s => s.hi && s.en && s.k), 'every sign is named in English and Hindi');
// The database driver returns a date column as a Date. String() of that is
// "Mon May 14 1990 ...", which matched nothing: every sign was blank.
ok(signOf(new Date(1990, 4, 14)) && signOf(new Date(1990, 4, 14)).k === 'taurus', 'a Date from the database gives its sign');
ok(signOf(new Date(1958, 0, 1)).k === 'capricorn' && signOf(new Date(1958, 11, 31)).k === 'capricorn', 'a Date on either side of the year end is Capricorn');
ok(signOf(new Date('x')) === null && signOf(null) === null, 'a broken date gives no sign rather than a wrong one');
ok(signOf('1958-03-21').k === 'aries', 'first day of Aries');
ok(signOf('1958-04-19').k === 'aries', 'last day of Aries');
ok(signOf('1958-04-20').k === 'taurus', 'the boundary moves on the right day');
ok(signOf('1990-12-21').k === 'sagittarius', 'last day of Sagittarius');
ok(signOf('1990-12-22').k === 'capricorn', 'Capricorn starts in December');
ok(signOf('1991-01-19').k === 'capricorn', 'Capricorn still runs in January - the year-end wrap');
ok(signOf('1991-01-20').k === 'aquarius', 'Aquarius takes over');
ok(signOf('1962-07-22').k === 'cancer' && signOf('1962-07-23').k === 'leo', 'Cancer into Leo');
ok(signOf('1962-03-20').k === 'pisces', 'Pisces ends the wheel');
ok(signOf(null) === null && signOf('') === null && signOf('not a date') === null, 'a missing birthday is null, not a guess');
ok(signOf('1958-13-01') === null && signOf('1958-02-32') === null, 'an impossible date is null');
ok(signOf(new Date('1958-03-21T00:00:00Z').toISOString()).k === 'aries', 'a full timestamp works as well as a date');
// Every day of a leap year lands on exactly one sign - no gaps, no overlaps.
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
// handles every answer it can give - most importantly the ones where it must
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
{ const long = await fetchSign('leo', '2026-08-31'); ok(long.length <= 900 && long.length > 200, 'an enormous reading is trimmed rather than shipped whole'); }
// Read before a family sees it.
stub(() => body({ data: { date: '2026-08-31', horoscope_data: 'A calm day. Avoid medicines without advice and see a doctor if the pain returns.' } }));
ok(await fetchSign('leo', '2026-08-31') === null, 'a reading that strays into health or medicines is not shown');
stub(() => body({ data: { date: '2026-08-31', horoscope_data: 'Expect a windfall today; a good time to invest in shares and lottery tickets.' } }));
ok(await fetchSign('leo', '2026-08-31') === null, 'nor one that promises money');
stub(() => body({ data: { date: '2026-08-30', horoscope_data: READING } }));
ok(await fetchSign('leo', '2026-08-31') === null, 'a reading dated another day is not shown as today\'s');
stub(() => body({ data: { date: '2026-08-31', horoscope_data: 'Talk to family \u2014 they listen. A good evening for old songs and long calls with cousins.' } }));
ok(await fetchSign('leo', '2026-08-31') === 'Talk to family - they listen. A good evening for old songs and long calls with cousins.', 'dashes become a plain hyphen');
stub(() => body({ data: { horoscope_data: ('A long and pleasant day with the family around you. ').repeat(30) } }));
{ const cut = await fetchSign('leo', '2026-08-31'); ok(cut.length <= 900 && /\.$/.test(cut), 'a long reading ends at a full sentence, not mid-word'); }
globalThis.fetch = realFetch;

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
