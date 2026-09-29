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
  dates: s.from.join('/') + ' - ' + s.to.join('/'),
  text: (i === 4 || i === 9) ? null : 'A steady day for ' + s.en + '. Say the thing you have been putting off.',
  source: (i === 4 || i === 9) ? null : 'horoscope-app-api' }));

let dayMode = 'normal';   // 'normal' | 'nodob' | 'guessed' | 'unset'
function dayJson(){
  return { ok:true, day: new Date().toISOString().slice(0,10),
    place: dayMode === 'unset' ? { name:'New Delhi', lat:28.6139, lon:77.2090, tz:'Asia/Kolkata', guessed:true, unset:true }
         : dayMode === 'guessed' ? { name:'Chhotapur', lat:28.6139, lon:77.2090, tz:'Asia/Kolkata', guessed:true }
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
  process.exit(process.env.CI ? 1 : 0);
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
await page.goto(BASE + '/');
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

// ---- ONE ANSWER FOR EVERY MOMENT ----
// Rahu Kaal, Yamaganda and Gulika Kaal outrank the Choghadiya; Abhijit makes
// midday good; otherwise the Choghadiya decides. This is written here again,
// independently, so the app is checked against the rule rather than itself.
const SP = [['Rahu Kaal', LIVE.rahuKaal, false], ['Yamaganda', LIVE.yamaganda, false],
            ['Gulika Kaal', LIVE.gulikaKaal, false], ['Abhijit Muhurat', LIVE.abhijit, true]].filter(x => x[1]);
const SEQ = LIVE.day.concat(LIVE.night);
function truth(t){
  for (const [n, per, g] of SP) if (!g && t >= +new Date(per.from) && t < +new Date(per.to)) return { label: n, good: false };
  for (const [n, per, g] of SP) if (g && t >= +new Date(per.from) && t < +new Date(per.to)) return { label: n, good: true };
  const w = SEQ.find(x => t >= +new Date(x.from) && t < +new Date(x.to));
  return w ? { label: w.name, good: w.good !== false } : null;
}
const NOW = truth(Date.now());

const state = (await page.locator('#mu-state').textContent()).trim();
ok(/^(✓ A good time right now|✕ Better to wait|Between)/.test(state),
   'the screen opens with a verdict, in words → ' + state);
const good = state.startsWith('✓');
ok(good === NOW.good, `the verdict follows the one rule: ${NOW.label} is ${NOW.good ? 'good' : 'a time to wait'}`);
ok(await page.locator('#mu-verdict').getAttribute('class') === 'card verdict ' + (good ? 'ok' : 'no'),
   'and the card carries the matching status, not colour alone');
const vname = await page.locator('#mu-name').textContent();
ok(vname.startsWith(NOW.label) && /until \d/.test(vname),
   'what is running now is named, with when it ends → ' + vname);
const vmean = await page.locator('#mu-mean').textContent();
ok(vmean.length > 15 && !/-/.test(vmean.slice(0, 8)),
   'and what it is for, in a plain sentence → ' + vmean);
const vnext = await page.locator('#mu-next').textContent();
ok(/(Next good window|This window ends at|Good the rest)/.test(vnext),
   'followed by what happens next → ' + vnext);

// ---- the day in three lines, inside the answer ----
const facts = await page.locator('#mu-facts .mufact').allTextContents();
ok(facts.length === 3, 'three facts under the answer, not three more cards');
ok(/Best time ahead/.test(facts[0]) && /Next to avoid/.test(facts[1]) && /rises .* sets /.test(facts[2]),
   'best time ahead, next to avoid, and the sun → ' + facts.map(f => f.trim()).join(' | '));

// ---- five tabs, overview first ----
const tabs = page.locator('#mu-tabs [role="tab"]');
ok(await tabs.count() === 5, 'the detail is five tabs');
ok(await page.locator('#mu-tabs').getAttribute('role') === 'tablist', 'announced as tabs');
ok(await page.locator('#mt-overview').getAttribute('aria-selected') === 'true', 'Overview is chosen when the day opens');
const visiblePanels = async () => (await page.locator('#pane-day .mtab').evaluateAll(ps => ps.filter(p => !p.hidden).map(p => p.dataset.mt))).join();
ok(await visiblePanels() === 'overview', 'and only its panel shows');
const boxes = await tabs.evaluateAll(bs => bs.map(b => b.getBoundingClientRect().right));
ok(boxes.every(r => r <= 390), 'on a phone all five tabs fit on screen, none hidden off the edge');

// ---- the band, from the same answer ----
const segs = page.locator('#mu-tl button');
const n = await segs.count();
ok(n >= 8, 'the whole day is one band (' + n + ' parts)');
const shares = await page.locator('#mu-tl').evaluate(el => [...el.querySelectorAll('button')].map(b => parseFloat(b.style.flexBasis)));
ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 100) < 0.01, 'the parts add up to the whole day and night');
const t0 = +new Date(SEQ[0].from), span = +new Date(SEQ[SEQ.length - 1].to) - t0;
const titles = await segs.evaluateAll(bs => bs.map(b => [b.title, b.dataset.good]));
let acc = t0, agree = 0;
for (let i = 0; i < n; i++) {
  const mid = acc + shares[i] / 100 * span / 2;
  const t = truth(mid);
  if (t && titles[i][0].startsWith(t.label) && (titles[i][1] === '1') === t.good) agree++;
  acc += shares[i] / 100 * span;
}
ok(agree === n, `every part of the band is the rule's answer for that time (${agree}/${n})`);
ok(await page.locator('#mu-tl button.now').count() === 1, 'exactly one part is marked as now');
ok((await page.locator('#mu-tl button.now').getAttribute('title')).startsWith(NOW.label), 'and it is the same one the verdict names');
const key = await page.locator('.tlkey').textContent();
ok(/Good time/.test(key) && /Better to wait/.test(key) && /Now/.test(key), 'a key names every state the band uses');
ok((await page.locator('#mu-tl button .sr').first().textContent()).length > 20,
   'and every part carries its own words for a screen reader');
await segs.nth(Math.min(5, n - 1)).click(); await page.waitForTimeout(150);
const picked = await page.locator('#mu-tlpick').textContent();
ok(/^[✓✕] /.test(picked) && picked.length > 25, 'tapping a part of the day says what it is → ' + picked);
ok(await segs.nth(Math.min(5, n - 1)).getAttribute('aria-pressed') === 'true', 'and the tapped part says it is selected');

// ---- coming up never contradicts the band ----
const soon = await page.locator('#mu-soon .murow').evaluateAll(rs => rs.map(r => ({
  label: r.querySelector('.what b').textContent, chip: r.querySelector('.chip').textContent })));
ok(soon.length >= 3, 'coming up lists the next changes in the day');
ok(soon.every(r => titles.some(t => t[0].startsWith(r.label))), 'each one is a part of the same band');
const nextGoodName = (vnext.match(/Next good window: ([^,]+),/) || [])[1];
if (nextGoodName) ok(soon.some(r => r.label === nextGoodName && /Good|Special/i.test(r.chip)),
  'the "next good window" in the answer is the same one coming up marks good → ' + nextGoodName);

// ---- hour by hour ----
await page.click('#mt-hours'); await page.waitForTimeout(150);
ok(await visiblePanels() === 'hours', 'the Hourly tab shows only the hours');
const hours = await page.locator('#mu-hours .murow').evaluateAll(rs => rs.map(r => ({
  now: r.classList.contains('now'), chip: r.querySelector('.chip').textContent, text: r.textContent })));
ok(hours.length >= 12, 'every hour from now to tomorrow\'s sunrise (' + hours.length + ')');
ok(hours[0].now, 'starting with the hour we are in, marked now');
ok(hours.every(h => /^(Good|Wait|Mixed)$/.test(h.chip)), 'each hour is Good, Wait or Mixed');
ok(hours.filter(h => h.chip === 'Mixed').every(h => /until|from/.test(h.text)), 'a mixed hour says exactly when it changes');
const before = hours.length;
await page.click('#mu-earlier'); await page.waitForTimeout(150);
ok(await page.locator('#mu-hours .murow').count() > before, 'earlier hours of today are one tap away');
ok(await page.locator('#mu-day .ev').first().isHidden(), 'the traditional sixteen stay folded: a reference, not the reading');
await page.locator('#mp-hours details.more summary').click(); await page.waitForTimeout(200);
ok(await page.locator('#mu-day .ev').count() === 8, 'opened, the eight day windows are there');
ok(await page.locator('#mu-night .ev').count() === 8, 'and the eight night ones');
const dayRows = await page.locator('#mu-day .ev').allTextContents();
ok(dayRows.every(t => /^[✓✕]/.test(t.trim())), 'each carries a tick or a cross, not just a colour');

// ---- keyboard: arrow keys move between tabs ----
await page.focus('#mt-hours'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
ok(await page.locator('#mt-good').getAttribute('aria-selected') === 'true' && await visiblePanels() === 'good',
   'the right arrow moves to the next tab');

// ---- good times ----
const goodRows = await page.locator('#mu-good .murow, #mu-good2 .murow').evaluateAll(rs => rs.map(r => ({
  label: r.querySelector('.what b').textContent, chip: r.querySelector('.chip').textContent, text: r.textContent })));
ok(goodRows.some(r => r.label === 'Abhijit Muhurat'), 'Abhijit Muhurat is among the special good times');
ok(goodRows.some(r => r.label === 'Amrit'), 'and Amrit, the best window');
ok(goodRows.filter(r => r.chip === 'Covered').every(r => /covers all of it/.test(r.text)),
   'a good window that a time to avoid covers is marked covered, not good');
// Independently: which good windows does a time to avoid cover completely?
const covered = SEQ.filter(w => w.good !== false && SP.some(([, per, g]) => !g && +new Date(per.from) <= +new Date(w.from) && +new Date(per.to) >= +new Date(w.to)));
ok(goodRows.filter(r => r.chip === 'Covered').length === covered.length,
   `and exactly those (${covered.length}) are marked covered`);

// ---- times to avoid ----
await page.click('#mt-avoid'); await page.waitForTimeout(150);
const avoid = await page.locator('#mu-avoid .murow').allTextContents();
ok(avoid.length === 3, 'the three times to avoid are listed together');
ok(avoid.some(t => t.includes('Rahu Kaal') && /Nothing new/i.test(t)), 'Rahu Kaal is explained, not just named');
ok(avoid.some(t => t.includes('Yamaganda')) && avoid.some(t => t.includes('Gulika Kaal')), 'with Yamaganda and Gulika Kaal');
ok(await page.locator('#mu-avoid2 .murow').count() === SEQ.filter(w => w.good === false).length,
   'and every Choghadiya that is better to wait');

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
ok(await page.locator('#mu-how').isHidden(), 'the explanation waits until asked for');
await page.click('#mt-how'); await page.waitForTimeout(200);
const how = await page.locator('#mu-how').textContent();
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

// ---- no city at all is not an unknown city ----
dayMode = 'unset';
await page.reload();
await page.waitForTimeout(400);
await page.evaluate(() => { location.hash = '#day'; });
await page.waitForTimeout(600);
const g2 = await page.locator('#mu-guess').textContent();
ok(/not in your profile yet/.test(g2) && !/don.t know/.test(g2), 'no city says "add your city", not "we don\'t know New Delhi" → ' + g2.slice(0, 80));
ok((await page.locator('#mu-place').textContent()).includes('New Delhi'), 'and names the city the timings are for');
await page.click('#mu-addcity'); await page.waitForTimeout(400);
ok(await page.locator('#editform').isVisible() && await page.locator('#e-place').evaluate(el => el === document.activeElement),
   '"Add my city" opens the profile with the city box ready to type in');

// ---- arriving again starts on the overview ----
await page.evaluate(() => { location.hash = '#day'; }); await page.waitForTimeout(400);
await page.click('#mt-avoid'); await page.waitForTimeout(100);
await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = '#day'; }); await page.waitForTimeout(400);
ok(await page.locator('#mt-overview').getAttribute('aria-selected') === 'true', 'coming back to the day starts on the overview again');

ok(errors.length === 0, 'no page errors' + (errors.length ? ' - ' + errors.slice(0,3).join(' | ') : ''));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
