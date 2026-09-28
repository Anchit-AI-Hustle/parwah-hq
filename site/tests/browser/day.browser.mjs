// The day section in a real browser: muhurat rendering, the twelve rashis,
// the missing-birthday path, and the honest "not available" path.
//
// NOT part of the deploy gate - Vercel's builders have no browser. Run it
// locally when the day screen changes:
//
//     npm i --no-save playwright-core && npx playwright install chromium
//     npm run test:browser
//
// PW_CHROMIUM can point at an existing Chromium if you already have one.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';
import { panchang } from '../../../api/_panchang.mjs';
import { SIGNS } from '../../../api/_horoscope.mjs';

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  try {
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
// Port 0, not a fixed one: these suites are run side by side and next to
// other tools, and a suite that dies on EADDRINUSE teaches people to
// ignore a red test run.
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const ME = '11111111-1111-1111-1111-111111111111';
const PAPA = '22222222-2222-2222-2222-222222222222';
const now = new Date().toISOString();

// A real Delhi panchang, shifted so that the third day-period is running right
// now - the rendering of "now" is what this test is for, not the astronomy.
function livePanchang(){
  const p = panchang(28.6139, 77.2090, new Date(new Date().toISOString().slice(0,10) + 'T00:00:00Z'));
  const target = p.day[2], mid = (+new Date(target.from) + +new Date(target.to)) / 2;
  const delta = Date.now() - mid;
  const sh = d => new Date(+new Date(d) + delta).toISOString();
  const shp = x => x && ({ ...x, from: sh(x.from), to: sh(x.to) });
  return { sunrise: sh(p.sunrise), sunset: sh(p.sunset),
    day: p.day.map(shp), night: p.night.map(shp),
    rahuKaal: shp(p.rahuKaal), gulikaKaal: shp(p.gulikaKaal),
    yamaganda: shp(p.yamaganda), abhijit: shp(p.abhijit) };
}
const LIVE = livePanchang();
const RUNNING = LIVE.day[2];

// Two signs deliberately missing, to prove the app says so rather than filling in.
const hsigns = SIGNS.map((s, i) => ({ key:s.k, name:s.en, hi:s.hi,
  dates: s.from.join('/') + ' – ' + s.to.join('/'),
  text: (i === 4 || i === 9) ? null : 'A steady day for ' + s.en + '. Say the thing you have been putting off.',
  source: (i === 4 || i === 9) ? null : 'horoscope-app-api' }));

let dayMode = 'normal';   // 'normal' | 'nodob' | 'guessed'
function dayJson(){
  return { ok:true, day: new Date().toISOString().slice(0,10),
    place: dayMode === 'guessed' ? { name:'Chhotapur', lat:28.6139, lon:77.2090, tz:'Asia/Kolkata', guessed:true }
                                 : { name:'Delhi', lat:28.6139, lon:77.2090, tz:'Asia/Kolkata', guessed:false },
    tz:'Asia/Kolkata', panchang: LIVE,
    current: RUNNING,
    mySign: dayMode === 'nodob' ? null : { key:'leo', name:'Leo', hi:'सिंह' },
    people: [
      { id:ME, name:'Rohan', sign: dayMode === 'nodob' ? null : 'leo', signName: dayMode === 'nodob' ? null : 'Leo', hasDob: dayMode !== 'nodob' },
      { id:PAPA, name:'Papa', sign:'capricorn', signName:'Capricorn', hasDob:true },
      { id:'33333333-3333-3333-3333-333333333333', name:'Chachi', sign:null, signName:null, hasDob:false }
    ],
    horoscope: { day:new Date().toISOString().slice(0,10), signs:hsigns, unavailable:2 },
    signBasis: { is:'sun sign (Western zodiac), from your date of birth',
                 isNot:'a Vedic rashi, which is a moon sign and needs your birth time and place' },
    signs: SIGNS.map(s => ({ key:s.k, name:s.en, hi:s.hi })) };
}

const eventsJson = { ok:true, circleName:'Test Family', code:'ABCDEF', seenAt:now, joinRequests:[], joinPolicy:'approve',
  sos:[], sosEscalateMin:5, pulse:null, calls:[],
  members:[{id:ME,name:'Rohan',role:'family',relation:'son',phone:'+91 9873945238',place:'Delhi',country:'IN',dob:'1990-08-05',gift_info:{},created_at:now},
           {id:PAPA,name:'Papa',role:'parent',relation:'father',phone:'+91 9812345678',place:'Pune',country:'IN',dob:'1958-01-05',gift_info:{},created_at:now}],
  events:[] };

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('playwright-core is not installed - see the note at the top of this file.');
  console.log('The deploy gate does not need it: run `npm test` for the checks that do gate a deploy.');
  process.exit(0);
}
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors = [];
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.log('FAIL  ' + name)); if (cond) console.log('PASS  ' + name); };

const page = await browser.newPage({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && m.text().indexOf('net::') < 0) errors.push('console: ' + m.text()); });
await page.route('**/api/**', r => r.fulfill({ json:{ ok:false, error:'stub' } }));
await page.route('**/api/events*', r => r.fulfill({ json: r.request().method() === 'POST' ? { ok:true } : eventsJson }));
await page.route('**/api/circle', r => r.fulfill({ json:{ ok:true, code:'ABCDEF', circleName:'Test Family', memberId:ME, role:'family', name:'Rohan', relation:'son', place:'Delhi', country:'IN' } }));
await page.route('**/api/settings*area=day*', r => r.fulfill({ json: dayJson() }));

await page.addInitScript(() => {
  localStorage.setItem('parwah', JSON.stringify({ code:'ABCDEF', memberId:'11111111-1111-1111-1111-111111111111', name:'Rohan', role:'family', circleName:'Test Family' }));
  localStorage.setItem('parwah-user', JSON.stringify({ id:'77777777-7777-4777-8777-777777777777', name:'Rohan', phone:'+919873945238' }));
  localStorage.setItem('parwah-fr-hide', '1');
});
await page.goto(BASE + '/app/');
await page.waitForTimeout(600);

// ---- the Today widget knows what is running now ----
// The home widget answers the question, not the vocabulary: a parent does not
// need the word "Shubh" on their front page.
const w = (await page.locator('#w-day').textContent()).trim();
ok(/^(✓ Good time|✕ Better to wait) · until \d/.test(w),
   'the Today widget says whether now is a good time, and until when → ' + w);

// ---- the day tab ----
await page.evaluate(() => location.hash = '#day');
await page.waitForTimeout(500);
ok(await page.locator('#pane-day').isVisible(), 'the day section opens');
const place = await page.locator('#mu-place').textContent();
ok(place.includes('Delhi'), 'the heading names the city the timings are for → ' + place);
const sun = await page.locator('#mu-sun').textContent();
ok(/Sunrise \d/.test(sun) && /Sunset \d/.test(sun) && sun.includes('Delhi'), 'sunrise and sunset are shown for that city → ' + sun);
ok(await page.locator('#mu-guess').isHidden(), 'a known city carries no fallback warning');

// ---- the verdict, which is the whole point of the screen ----
const state = (await page.locator('#mu-state').textContent()).trim();
ok(/^(✓ A good time right now|✕ Better to wait|Between)/.test(state),
   'the screen opens with a verdict, in words → ' + state);
const good = state.startsWith('✓');
ok(await page.locator('#mu-verdict').getAttribute('class') === 'card verdict ' + (good ? 'ok' : 'no'),
   'and the card carries the matching status, not colour alone');
const vname = await page.locator('#mu-name').textContent();
ok(vname.includes(RUNNING.name) && /until \d/.test(vname),
   'the period is named, with when it ends → ' + vname);
const vmean = await page.locator('#mu-mean').textContent();
ok(vmean.length > 15 && !/-/.test(vmean.slice(0, 8)),
   'and what it is for, in a plain sentence → ' + vmean);
const vnext = await page.locator('#mu-next').textContent();
ok(/(Next good window|This window ends at|Good the rest)/.test(vnext),
   'followed by what happens next → ' + vnext);

// ---- the day as one band, in real time ----
const segs = page.locator('#mu-tl button');
ok(await segs.count() === 16, 'the whole day is one band of sixteen windows');
// Each segment's share of the band must be its share of the day and night.
// This compared ROUNDED PIXEL widths, which failed for a fortnight around
// every equinox: on 28 September a day period is 89.9 minutes and a night
// one 90.1, so all sixteen really are about 21 px wide and the correct band
// looked like a regression. Comparing the shares to the durations holds in
// every season - and still catches equal boxes, which would put 6.250% on
// every segment where the real day share is 6.243%.
const shares = await page.locator('#mu-tl').evaluate(el =>
  [...el.querySelectorAll('button')].map(b => parseFloat(b.style.flexBasis)));
const seq = LIVE.day.concat(LIVE.night);
const t0 = +new Date(seq[0].from), span = +new Date(seq[seq.length - 1].to) - t0;
const want = seq.map(x => (+new Date(x.to) - +new Date(x.from)) / span * 100);
ok(shares.length === 16 && shares.every((w, i) => Math.abs(w - want[i]) < 0.001),
   'the segments are real durations, not equal boxes');
ok(await page.locator('#mu-tl button.now').count() === 1, 'exactly one segment is marked as now');
const key = await page.locator('.tlkey').textContent();
ok(/Good time/.test(key) && /Better to wait/.test(key) && /Now/.test(key),
   'a key names every state the band uses');
ok((await page.locator('#mu-tl button .sr').first().textContent()).length > 20,
   'and every segment carries its own words for a screen reader');
await segs.nth(5).click(); await page.waitForTimeout(150);
const picked = await page.locator('#mu-tlpick').textContent();
ok(/^[✓✕] /.test(picked) && picked.length > 25, 'tapping a part of the day says what it is → ' + picked);
ok(await segs.nth(5).getAttribute('aria-pressed') === 'true', 'and the tapped segment says it is selected');

// ---- the sixteen are a reference, not the reading ----
ok(await page.locator('#mu-day .ev').first().isHidden(),
   'the full list starts closed - it is a reference, not the answer');
await page.locator('details.more summary').first().click(); await page.waitForTimeout(200);
ok(await page.locator('#mu-day .ev').count() === 8, 'opened, the eight day windows are there');
ok(await page.locator('#mu-night .ev').count() === 8, 'and the eight night ones');
const dayRows = await page.locator('#mu-day .ev').allTextContents();
ok(dayRows.every(t => /^[✓✕]/.test(t.trim())), 'each carries a tick or a cross, not just a colour');
ok(dayRows.filter(t => t.includes('· now')).length === 1, 'exactly one is marked as running now');

const named = await page.locator('#mu-named .avoidrow').allTextContents();
ok(named.some(t => t.includes('Rahu Kaal') && /nothing new/i.test(t)), 'Rahu Kaal is explained, not just named');
ok(named.length === 4, 'the three to avoid and the one to use sit in one card, not four');
ok(named.some(t => t.includes('Gulika Kaal')), 'Gulika Kaal is listed');
ok(named.some(t => t.includes('Yamaganda')), 'Yamaganda is listed');
ok(named.some(t => t.includes('Abhijit')), 'Abhijit is listed');

// ---- rashifal ----
await page.click('#day-seg button[data-sec="rashi"]');
await page.waitForTimeout(200);
// Yours first and open; the other eleven only if asked for.
ok(await page.locator('#ho-mine').isVisible(), 'your own rashi is the first thing on the screen');
ok(await page.locator('#ho-all .ev').first().isHidden(),
   'the other twelve start closed - nobody reads twelve horoscopes');
const famRows = await page.locator('#ho-people .ev').allTextContents();
ok(famRows.every(t => t.length < 240), 'the family are one line each, not a second wall of text');
await page.locator('#pane-day .subsec[data-sec="rashi"] details.more summary').first().click();
await page.waitForTimeout(200);
ok(await page.locator('#ho-all .ev').first().isVisible(), 'opened, all twelve are there');
ok(await page.locator('#ho-all .ev').count() === 12, 'all twelve rashis are shown');
const all = await page.locator('#ho-all .ev').allTextContents();
ok(all.filter(t => t.includes('· yours')).length === 1, 'your own rashi is marked, once');
ok(all.some(t => t.includes('सिंह')) && all.some(t => t.includes('मकर')), 'the rashis are named in Hindi too');
ok(all.filter(t => t.includes('Not available today.')).length === 2, 'a reading that did not arrive says so instead of being invented');
const src = await page.locator('#ho-src').textContent();
ok(src.includes('2 of 12') && /inventing/i.test(src), 'the count of missing readings is stated plainly → ' + src.slice(0, 80));
ok(await page.locator('#ho-mine').isVisible() && (await page.locator('#ho-myname').textContent()).includes('Leo'), 'your own reading is called out at the top');
ok(await page.locator('#ho-nodob').isHidden(), 'no birthday prompt when the birthday is known');
const ppl = await page.locator('#ho-people .ev').allTextContents();
ok(ppl.length === 2 && ppl.some(t => t.includes('Papa') && t.includes('Capricorn')), "the family's rashis are listed, without repeating your own");
ok(ppl.some(t => t.includes('Chachi') && t.includes('birthday not added yet')), 'a missing birthday is named rather than guessed');

// ---- no birthday of your own ----
dayMode = 'nodob';
await page.reload();
await page.waitForTimeout(400);
await page.evaluate(() => { location.hash = '#day'; });
await page.waitForTimeout(600);
await page.click('#day-seg button[data-sec="rashi"]');
await page.waitForTimeout(200);
ok(await page.locator('#ho-nodob').isVisible() && await page.locator('#ho-mine').isHidden(), 'without a birthday the app asks for one instead of showing a rashi');
await page.click('#ho-adddob');
await page.waitForTimeout(400);
ok(await page.locator('#pane-profile').isVisible() && await page.locator('#editform').isVisible(), 'the prompt lands on the profile with the form open');
ok(await page.locator('#e-dob').isVisible() && (await page.locator('#e-dob').getAttribute('type')) === 'date', 'and the date-of-birth field is right there');

// ---- the explainers: the family can find out how any of this works ----
await page.reload(); await page.waitForTimeout(400);
await page.evaluate(() => { location.hash = '#day'; }); await page.waitForTimeout(600);
ok(await page.locator('#mu-how .explain').first().isHidden(), 'the explanation waits until asked for');
await page.locator('#mu-how summary').click(); await page.waitForTimeout(200);
const how = await page.locator('#mu-how .explain').textContent();
ok(/eight equal parts/.test(how), 'it says the day is split into eight');
ok(/lord of that weekday/.test(how), 'and why the sequence moves with the weekday');
ok(/fifteen/.test(how) && /48 minutes/.test(how), 'and that Abhijit is a fifteenth, not an eighth');
ok(/NOAA/.test(how) && /refraction/.test(how), 'and where sunrise itself comes from');
const lords = await page.locator('#mu-lords .lordrow').allTextContents();
ok(lords.length === 7, 'all seven Choghadiya are named with their planet');
ok(lords.some(t => /Amrit/.test(t) && /Moon/.test(t)), 'Amrit belongs to the Moon → ' + (lords.find(t=>/Amrit/.test(t))||''));
ok(lords.some(t => /Kaal/.test(t) && /Saturn/.test(t)), 'Kaal belongs to Saturn');

await page.click('#day-seg button[data-sec="rashi"]'); await page.waitForTimeout(200);
await page.locator('#ho-how summary').click(); await page.waitForTimeout(200);
const what = await page.locator('#ho-how .explain').textContent();
ok(/sun sign/.test(what), 'the rashi screen says it is showing a sun sign');
ok(/moon sign/.test(what) && /birth time/.test(what),
   'and that a real rashi is a moon sign needing a birth time');
ok(/does not claim/.test(what), 'and refuses to claim what it cannot know');
ok(/left blank/.test(what), 'and repeats that a missing reading is left blank');
ok((await page.locator('#ho-basis').textContent()).includes('sun sign'),
   'the basis line is filled from the server, not hardcoded twice');

// ---- a city we do not know ----
dayMode = 'guessed';
await page.reload();
await page.waitForTimeout(400);
await page.evaluate(() => { location.hash = '#day'; });
await page.waitForTimeout(600);
ok(await page.locator('#mu-guess').isVisible(), 'an unknown city warns that these are fallback timings');
const g = await page.locator('#mu-guess').textContent();
ok(g.includes('Chhotapur') && g.includes('Delhi') && /profile/i.test(g), 'and says exactly what to do about it → ' + g.slice(0, 90));

ok(errors.length === 0, 'no page errors' + (errors.length ? ' - ' + errors.slice(0,3).join(' | ') : ''));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
