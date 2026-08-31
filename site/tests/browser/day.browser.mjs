// The day section in a real browser: muhurat rendering, the twelve rashis,
// the missing-birthday path, and the honest "not available" path.
//
// NOT part of the deploy gate — Vercel's builders have no browser. Run it
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
await new Promise(r => server.listen(8791, r));

const ME = '11111111-1111-1111-1111-111111111111';
const PAPA = '22222222-2222-2222-2222-222222222222';
const now = new Date().toISOString();

// A real Delhi panchang, shifted so that the third day-period is running right
// now — the rendering of "now" is what this test is for, not the astronomy.
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
  console.log('playwright-core is not installed — see the note at the top of this file.');
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
await page.goto('http://localhost:8791/app/');
await page.waitForTimeout(600);

// ---- the Today widget knows what is running now ----
const w = (await page.locator('#w-day').textContent()).trim();
ok(w.includes(RUNNING.name), 'the Today widget names the Choghadiya running now → ' + w);

// ---- the day tab ----
await page.evaluate(() => location.hash = '#day');
await page.waitForTimeout(500);
ok(await page.locator('#pane-day').isVisible(), 'the day section opens');
const place = await page.locator('#mu-place').textContent();
ok(place.includes('Delhi'), 'the heading names the city the timings are for → ' + place);
const sun = await page.locator('#mu-sun').textContent();
ok(/Sunrise \d/.test(sun) && /Sunset \d/.test(sun) && sun.includes('Delhi'), 'sunrise and sunset are shown for that city → ' + sun);
ok(await page.locator('#mu-guess').isHidden(), 'a known city carries no fallback warning');

const nowTxt = await page.locator('#mu-now').textContent();
ok(nowTxt.includes('Right now: ' + RUNNING.name), 'the screen leads with the period running now');
ok(nowTxt.length > 60 && /—/.test(nowTxt), 'and explains in English what that period means → ' + nowTxt.slice(0, 90));

ok(await page.locator('#mu-day .ev').count() === 8, 'eight day Choghadiya are listed');
ok(await page.locator('#mu-night .ev').count() === 8, 'eight night Choghadiya are listed');
const dayRows = await page.locator('#mu-day .ev').allTextContents();
ok(dayRows.every(t => /\d:\d\d\s?(am|pm).+–/i.test(t.replace(/\u2009/g,' ')) || /–/.test(t)), 'every row carries its from–to time');
ok(dayRows.filter(t => t.includes('· now')).length === 1, 'exactly one row is marked as running now');
ok(dayRows[2].includes('· now'), 'and it is the right row');

const named = await page.locator('#mu-named .ev').allTextContents();
ok(named.some(t => t.includes('Rahu Kaal') && /nothing new/i.test(t)), 'Rahu Kaal is explained, not just named');
ok(named.some(t => t.includes('Gulika Kaal')), 'Gulika Kaal is listed');
ok(named.some(t => t.includes('Yamaganda')), 'Yamaganda is listed');
ok(named.some(t => t.includes('Abhijit')), 'Abhijit is listed');

// ---- rashifal ----
await page.click('#day-seg button[data-sec="rashi"]');
await page.waitForTimeout(200);
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

// ---- a city we do not know ----
dayMode = 'guessed';
await page.reload();
await page.waitForTimeout(400);
await page.evaluate(() => { location.hash = '#day'; });
await page.waitForTimeout(600);
ok(await page.locator('#mu-guess').isVisible(), 'an unknown city warns that these are fallback timings');
const g = await page.locator('#mu-guess').textContent();
ok(g.includes('Chhotapur') && g.includes('Delhi') && /profile/i.test(g), 'and says exactly what to do about it → ' + g.slice(0, 90));

ok(errors.length === 0, 'no page errors' + (errors.length ? ' — ' + errors.slice(0,3).join(' | ') : ''));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
