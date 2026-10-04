// The concept screens, without an account: reachable, complete, and free of
// everything the validation guide says must not appear on them.
//
// NOT part of the deploy gate - Vercel's builders have no browser. Run it
// locally when the entry screen changes:
//
//     npm i --no-save playwright-core && npx playwright install chromium
//     npm run test:browser

import http from 'http'; import { readFile } from 'fs/promises'; import path from 'path';
const ROOT=new URL('../../public', import.meta.url).pathname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const srv=http.createServer(async(rq,rs)=>{let p=rq.url.split('?')[0];if(p.endsWith('/'))p+='index.html';
 try{const d=await readFile(path.join(ROOT,p));rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);}catch{rs.writeHead(404);rs.end('nf');}});
// Port 0, not a fixed one: these suites are run side by side and next to
// other tools, and a suite that dies on EADDRINUSE teaches people to
// ignore a red test run.
await new Promise(r => srv.listen(0, r));
const BASE = 'http://127.0.0.1:' + srv.address().port;
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('playwright-core is not installed - see the note at the top of this file.');
  console.log('The deploy gate does not need it: run `npm test` for the checks that do gate a deploy.');
  process.exit(process.env.CI ? 1 : 0);
}
const b=await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors=[]; let pass=0, fail=0;
const ok=(c,n)=>{c?pass++:(fail++,console.log('FAIL  '+n)); if(c) console.log('PASS  '+n);};

async function fresh(vp){
  const pg=await b.newPage({viewport:vp,serviceWorkers:'block'});
  pg.on('pageerror',e=>errors.push('pageerror: '+e.message));
  pg.on('console',m=>{if(m.type()==='error'&&m.text().indexOf('net::')<0)errors.push('console: '+m.text());});
  await pg.route('**/api/**',r=>r.fulfill({json:{ok:false,error:'stub'}}));
  return pg;
}

// ---- a phone gets the explanation, not just a phone field ----
let pg=await fresh({width:390,height:844});
await pg.goto(BASE + '/'); await pg.waitForTimeout(500);
ok(await pg.locator('.obpoints').isVisible(), 'a phone sees what Parwah is, not only a sign-in box');
ok((await pg.locator('.obpoint').count())===3, 'all three points are on the phone screen');
ok(await pg.locator('#au-see').isVisible(), 'and a way to see it properly without signing in');

// ---- the five screens ----
await pg.click('#au-see'); await pg.waitForTimeout(300);
ok(await pg.locator('#demo-step').isVisible() && await pg.locator('#auth-step').isHidden(),
   'the concept opens without asking for anything');
ok(await pg.locator('.obpoints').isHidden() && await pg.locator('#onboard > h1').isHidden(),
   'and replaces the summary rather than stacking on top of it');
ok((await pg.locator('#dm-body h3').boundingBox()).y < 400,
   'so the first screen is above the fold on a phone');
const seen=[];
for (let i=0;i<6;i++){
  const t=(await pg.locator('#dm-count').textContent()).trim();
  const body=await pg.locator('#dm-body').textContent();
  seen.push(body);
  ok(t === (i+1)+' of 6', 'screen '+(i+1)+' of 6 is numbered → '+t);
  ok((await pg.locator('#dm-dots i.on').count())===1, 'exactly one dot is lit on screen '+(i+1));
  if (i===0) ok(await pg.locator('#dm-back').isHidden(), 'no Back on the first screen');
  if (i<5) { await pg.click('#dm-next'); await pg.waitForTimeout(200); }
}
// guide screen 1
ok(/nobody should have to scramble/i.test(seen[0]), 'screen 1 leads with the guide’s promise');
['Mum','Dad','Anya','Rohan'].forEach(n=>ok(seen[0].includes(n),'screen 1 shows '+n+' as a card'));
ok(/Important information up to date/.test(seen[0]) && /to complete/.test(seen[0]),
   'each card carries only a short status line');
ok(/You decide who can see what/.test(seen[0]), 'screen 1 carries the reassurance the guide names');
// guide screen 2
['Health','Records','People to call','Useful to know','Freshness'].forEach(s=>
  ok(seen[1].includes(s), 'screen 2 has the guide’s section: '+s));
ok(/Dr Mehra/.test(seen[1]) && /Penicillin/.test(seen[1]) && /B\+/.test(seen[1]), 'with the guide’s own examples');
ok(/never the document itself/.test(seen[1]), 'and Records shows that a document exists, not the document');
// guide screen 3
ok(/78% ready/i.test(seen[2]), 'screen 3 is the readiness number');
ok((seen[2].match(/✓/g)||[]).length===3 && (seen[2].match(/⚠/g)||[]).length===3, 'three done, three outstanding');
// guide screen 4
ok(/Ask Ekta/i.test(seen[3]) && /Prepare summary/.test(seen[3]), 'screen 4 is Ekta, including the doctor-visit summary');
ok(/does not diagnose/i.test(seen[3]), 'and states that Ekta does not diagnose');
// guide screen 5
ok(/Things to do/.test(seen[4]) && /Nobody has it yet/.test(seen[4]) && /emergency card/i.test(seen[4]) && /no internet/.test(seen[4]),
   'screen 5 is things to do (who has what) and the emergency card');
ok(!/pulse|sunny|rainy/i.test(seen.join(' ')), 'the removed mood question is not sold anywhere in the demo');
// the price, last
ok(/2,499/.test(seen[5]) && /per family/.test(seen[5]), 'the price comes last, per family');
ok(/29\.99/.test(seen[5]), 'and in dollars too');

// ---- what the guide says must NOT be here ----
const all=seen.join(' ').toLowerCase();
['chat','game','gift','video call'].forEach(w=>
  ok(all.indexOf(w)<0, 'the concept screens never mention '+w));

// ---- the way back ----
await pg.click('#dm-next'); await pg.waitForTimeout(300);
ok(await pg.locator('#auth-step').isVisible(), 'the last screen leads into signing in');
await pg.click('#au-see'); await pg.waitForTimeout(200);
ok((await pg.locator('#dm-count').textContent()).trim()==='1 of 6', 'reopening starts at the beginning');
await pg.click('#dm-out'); await pg.waitForTimeout(200);
ok(await pg.locator('#auth-step').isVisible(), '“Sign in instead” always works');
ok(await pg.locator('.obpoints').isVisible() && await pg.locator('#onboard > h1').isVisible(),
   'and going back restores the summary');
await pg.close();

// ---- ?demo=1 opens straight into it ----
pg=await fresh({width:390,height:844});
await pg.goto(BASE + '/?demo=1'); await pg.waitForTimeout(600);
ok(await pg.locator('#demo-step').isVisible(), '?demo=1 opens on the concept, for an interview');
ok(await pg.locator('#auth-step').isHidden(), 'and not on a request for a phone number');
await pg.close();

// ---- a signed-in person is unaffected ----
pg=await fresh({width:390,height:844});
await pg.route('**/api/events*',r=>r.fulfill({json:{ok:true,circleName:'T',code:'ABCDEF',members:[],events:[],seenAt:null,joinRequests:[],sos:[],calls:[]}}));
await pg.addInitScript(()=>{localStorage.setItem('parwah',JSON.stringify({code:'ABCDEF',memberId:'11111111-1111-1111-1111-111111111111',name:'R',role:'family',circleName:'T'}));localStorage.setItem('parwah-fr-hide','1');});
await pg.goto(BASE + '/?demo=1'); await pg.waitForTimeout(600);
ok(await pg.locator('#onboard').isHidden(), 'someone already in a circle is not sent to the demo');
await pg.close();

ok(errors.length===0,'no page errors'+(errors.length?' - '+errors.slice(0,3).join(' | '):''));
console.log('\n'+pass+' passed, '+fail+' failed');
await b.close(); srv.close(); process.exit(fail?1:0);
