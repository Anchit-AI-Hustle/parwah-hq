// Adding an address: six digits fill in the rest, and a PIN we cannot check
// is never a locked door.
//
// NOT part of the deploy gate - Vercel's builders have no browser. Run it
// locally when the memory form changes:
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

const ME='11111111-1111-1111-1111-111111111111';
const now=new Date().toISOString();
let pinMode='ok', lastPin='', lastSave=null;
const events={ok:true,circleName:'T',code:'ABCDEF',seenAt:now,joinRequests:[],joinPolicy:'approve',sos:[],pulse:null,calls:[],
  members:[{id:ME,name:'Rohan',role:'family',relation:'son',place:'Delhi',country:'IN',gift_info:{},created_at:now}],events:[]};
const book={ok:true,staleDays:180,entries:[],prep:[],records:[],access:[],consent:[],
  family:{pct:0,ready:0,total:0,gapCount:0,gaps:[]}};

const pg=await b.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
pg.on('pageerror',e=>errors.push('pageerror: '+e.message));
pg.on('console',m=>{if(m.type()==='error'&&m.text().indexOf('net::')<0)errors.push('console: '+m.text());});
await pg.route('**/api/**',r=>r.fulfill({json:{ok:false,error:'stub'}}));
await pg.route('**/api/events*',r=>r.fulfill({json:events}));
await pg.route('**/api/book*',r=>{
  if(r.request().method()==='POST'){lastSave=JSON.parse(r.request().postData()||'{}');return r.fulfill({json:{ok:true,id:'x'}});}
  return r.fulfill({json:book});});
await pg.route('**/api/settings*area=pin*',r=>{
  lastPin=new URL(r.request().url(),'http://x').searchParams.get('pin');
  if(pinMode==='down') return r.abort();
  if(pinMode==='unknown') return r.fulfill({json:{ok:false,unknown:true,pin:lastPin,
    error:'We could not check that PIN code just now - type the city and state yourself and it will be saved as you write it.'}});
  return r.fulfill({json:{ok:true,pin:lastPin,state:'Delhi',district:'South Delhi',country:'India',source:'india-post',
    areas:[{name:'Greater Kailash',block:'New Delhi',kind:'Sub Post Office'},
           {name:'Kailash Colony',block:'New Delhi',kind:'Branch Post Office'}]}});});
await pg.addInitScript(()=>{localStorage.setItem('parwah',JSON.stringify({code:'ABCDEF',memberId:'11111111-1111-1111-1111-111111111111',name:'Rohan',role:'family',circleName:'T'}));localStorage.setItem('parwah-fr-hide','1');});
await pg.goto(BASE + '/#memory'); await pg.waitForTimeout(700);

// the filter row is readable, not a row of bare emoji
const chips=await pg.locator('#bk-filter button').allTextContents();
ok(chips.length===6 && chips.every(t=>/[A-Za-z]/.test(t)), 'every memory filter carries a word, not just an emoji → '+chips.join('|'));

await pg.click('#b-kind button[data-k="address"]'); await pg.waitForTimeout(200);
ok(await pg.locator('#b-pin').isVisible(), 'an address asks for a PIN code');
ok(await pg.locator('#b-pinout').isHidden(), 'and shows nothing it has not checked yet');

// ---- a PIN that resolves ----
await pg.fill('#b-name','The Tandons');
await pg.fill('#b-address','S-354, Block S');
await pg.fill('#b-pin','110048'); await pg.waitForTimeout(700);
ok(lastPin==='110048','the six digits are looked up → '+lastPin);
ok(await pg.locator('#b-pinout').isVisible(),'the locality, city and state appear');
const opts=await pg.locator('#b-area option').allTextContents();
ok(opts.length===3 && /Greater Kailash/.test(opts[0]), 'both localities are offered, plus a way out → '+opts.length);
ok(/I will type it/.test(opts[2]), 'and the way out is explicit');
ok(await pg.locator('#b-city').inputValue()==='South Delhi','the district fills itself in');
ok(await pg.locator('#b-state').inputValue()==='Delhi','so does the state');
const msg=await pg.locator('#b-pinmsg').textContent();
ok(/✓/.test(msg)&&/India Post/.test(msg),'and it says where that came from → '+msg.trim().slice(0,60));
const full=await pg.locator('#b-addrfull').textContent();
ok(full==='Saved as: S-354, Block S, Greater Kailash, South Delhi - Delhi 110048','the line it will save is shown → '+full);

await pg.click('#b-save'); await pg.waitForTimeout(300);
ok(lastSave && lastSave.address==='S-354, Block S, Greater Kailash, South Delhi - Delhi 110048',
   'and that exact line is what gets saved');
ok(lastSave.kind==='address' && lastSave.name==='The Tandons','with the place name it was given');

// ---- the form resets ----
await pg.click('#b-kind button[data-k="address"]'); await pg.waitForTimeout(200);
ok(await pg.locator('#b-pin').inputValue()==='' && await pg.locator('#b-pinout').isHidden(),
   'the next address starts from a clean form');

// ---- a PIN India Post does not know ----
pinMode='unknown';
await pg.fill('#b-name','Bua ka ghar');
await pg.fill('#b-address','12, Church Road');
await pg.fill('#b-pin','999999'); await pg.waitForTimeout(700);
ok(await pg.locator('#b-pinout').isVisible(),'an unknown PIN still lets you type the city yourself');
const m2=await pg.locator('#b-pinmsg').textContent();
ok(/could not check/.test(m2),'and says plainly that it could not be checked');
await pg.fill('#b-city','Panaji'); await pg.fill('#b-state','Goa'); await pg.waitForTimeout(200);
ok((await pg.locator('#b-addrfull').textContent())==='Saved as: 12, Church Road, Panaji - Goa 999999',
   'what they typed is what gets saved');
await pg.click('#b-save'); await pg.waitForTimeout(300);
ok(lastSave.address==='12, Church Road, Panaji - Goa 999999','an unchecked address saves exactly as written');

// ---- no connection at all ----
pinMode='down';
await pg.click('#b-kind button[data-k="address"]'); await pg.waitForTimeout(200);
await pg.fill('#b-name','X'); await pg.fill('#b-address','1 Main St');
await pg.fill('#b-pin','560001'); await pg.waitForTimeout(900);
ok(await pg.locator('#b-pinout').isVisible(),'a dead network is not a locked door either');
ok(/No connection/.test(await pg.locator('#b-pinmsg').textContent()),'and it says so');

// ---- a half-typed PIN is never looked up ----
lastPin='';
await pg.fill('#b-pin','1100'); await pg.waitForTimeout(600);
ok(lastPin==='','four digits are not a PIN and are not sent anywhere');

ok(errors.length===0,'no page errors'+(errors.length?' - '+errors.slice(0,3).join(' | '):''));
console.log('\n'+pass+' passed, '+fail+' failed');
await b.close(); srv.close(); process.exit(fail?1:0);
