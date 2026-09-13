// GET /api/diag?probe=day
//
// "A testable source" is a requirement, not a nicety, so it is testable from
// production with one URL. Two halves, reported separately because they fail
// for completely different reasons:
//
//   arithmetic - Choghadiya, Rahu Kaal and the rest, checked against published
//                almanac times for Delhi on a fixed date. Offline, deterministic;
//                if this ever goes red the code is wrong, not the internet.
//   source     - one live call to the free open horoscope API, reporting the
//                status and the length of what came back. If this goes red the
//                app shows "not available today" rather than inventing a reading.
import { panchang, currentPeriod, derivedDaySeq, derivedNightSeq } from './_panchang.mjs';
import { placeOf } from './_places.mjs';
import { SIGNS, signOf, fetchSign, ENDPOINT } from './_horoscope.mjs';

const IST = 'Asia/Kolkata';
const hhmm = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: IST, hour12: false, hour: '2-digit', minute: '2-digit' });

export default async function handler(req, res) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });

  // --- arithmetic, against a published almanac -----------------------------
  // Delhi, Monday 31 August 2026: sunrise 05:58, sunset 18:46 IST.
  try {
    const p = panchang(28.6139, 77.2090, new Date('2026-08-31T00:00:00Z'));
    add('sunrise matches the almanac (Delhi, 31 Aug 2026)', hhmm(p.sunrise) === '05:58', hhmm(p.sunrise) + ' IST, expected 05:58');
    add('sunset matches the almanac', hhmm(p.sunset) === '18:46', hhmm(p.sunset) + ' IST, expected 18:46');
    add('Monday opens with Amrit', p.day[0].name === 'Amrit', p.day[0].name);
    add('Rahu Kaal is the second eighth on a Monday',
      hhmm(p.rahuKaal.from) === '07:34' && hhmm(p.rahuKaal.to) === '09:10',
      hhmm(p.rahuKaal.from) + '–' + hhmm(p.rahuKaal.to) + ' IST');
    add('eight day parts and eight night parts', p.day.length === 8 && p.night.length === 8);
    let sq = 0;
    for (let wd = 0; wd < 7; wd++) {
      const d = panchang(28.6139, 77.2090, new Date(Date.UTC(2026, 7, 30 + wd)));
      if (d.day.map(x => x.name).join() !== derivedDaySeq(wd).join()) sq++;
      if (d.night.map(x => x.name).join() !== derivedNightSeq(wd).join()) sq++;
    }
    add('every sequence regenerates from the planetary order', sq === 0, sq + ' of 14 did not');
    const abMin = (+p.abhijit.to - +p.abhijit.from) / 60000;
    add('Abhijit is one fifteenth of the day, not one eighth', abMin > 44 && abMin < 54,
      Math.round(abMin) + ' minutes');
    add('every period is explained in English', p.day.concat(p.night).every(x => x.en && x.en.length > 12));
    add('Wednesday has no Abhijit', panchang(28.6139, 77.2090, new Date('2026-09-02T00:00:00Z')).abhijit === null);
    const mid = new Date((+new Date(p.day[3].from) + +new Date(p.day[3].to)) / 2);
    add('the running period is found from a moment', currentPeriod(p, mid) === p.day[3]);
  } catch (e) { add('panchang arithmetic', false, String(e && e.message || e)); }

  // --- places --------------------------------------------------------------
  try {
    add('a known city resolves without guessing', placeOf('Pune, Maharashtra').lat === 18.5204 && !placeOf('Pune, Maharashtra').guessed);
    add('an unknown city is flagged, not passed off as known', placeOf('Nowhereville').guessed === true);
  } catch (e) { add('place lookup', false, String(e && e.message || e)); }

  // --- signs ---------------------------------------------------------------
  try {
    add('twelve signs, named in English and Hindi', SIGNS.length === 12 && SIGNS.every(s => s.en && s.hi));
    add('Capricorn wraps the year end correctly', signOf('1990-12-22').k === 'capricorn' && signOf('1991-01-19').k === 'capricorn' && signOf('1991-01-20').k === 'aquarius');
    add('a missing birthday returns nothing rather than a guess', signOf(null) === null && signOf('rubbish') === null);
  } catch (e) { add('sign lookup', false, String(e && e.message || e)); }

  // --- the one thing that genuinely depends on someone else -----------------
  const t0 = Date.now();
  let sample = null, srcErr = '';
  try { sample = await fetchSign('leo', new Date().toISOString().slice(0, 10)); }
  catch (e) { srcErr = String(e && e.message || e); }
  const source = {
    endpoint: ENDPOINT,
    reachable: !!sample,
    ms: Date.now() - t0,
    chars: sample ? sample.length : 0,
    sample: sample ? sample.slice(0, 120) : null,
    error: srcErr || (sample ? '' : 'no usable reading came back'),
    note: sample ? 'The daily readings are live.'
                 : 'Readings are unavailable right now. The app shows “not available today” for the affected signs - it never invents one, and the muhurat above is unaffected because it is computed, not fetched.'
  };

  const failed = checks.filter(c => !c.ok);
  return res.status(failed.length ? 500 : 200).json({
    ok: failed.length === 0,
    summary: (checks.length - failed.length) + '/' + checks.length + ' arithmetic checks pass; source ' + (source.reachable ? 'reachable' : 'UNREACHABLE'),
    arithmetic: { ok: failed.length === 0, checks },
    source
  });
}
