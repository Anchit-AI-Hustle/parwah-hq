// The vault's number field, as a person actually uses it.
//
// NOT part of the deploy gate - Vercel's builders have no browser. Run it
// locally when the vault form changes:
//
//     npm i --no-save playwright-core && npx playwright install chromium
//     npm run test:browser
import http from 'http'; import { readFile } from 'fs/promises'; import path from 'path';
import { DOC_ID } from '../../../api/_docid.mjs';
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
  process.exit(0);
}
const b=await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors=[]; let pass=0, fail=0;
const ok=(c,n)=>{c?pass++:(fail++,console.log('FAIL  '+n)); if(c) console.log('PASS  '+n);};

const ME='11111111-1111-1111-1111-111111111111', now=new Date().toISOString();
const shapes={};
for (const k of Object.keys(DOC_ID)) { const d=DOC_ID[k];
  shapes[k]={label:d.label,chars:d.chars.source,group:d.group,len:d.len,sep:d.sep,
             example:d.example,inputmode:d.inputmode,upper:!!d.upper,hint:d.hint}; }
const kinds={aadhaar:{label:'Aadhaar',icon:'🆔'},pan:{label:'PAN card',icon:'🧾'},
  passport:{label:'Passport',icon:'🛂'},dl:{label:'Driving licence',icon:'🚗'},
  voter:{label:'Voter ID',icon:'🗳'},other:{label:'Other document',icon:'📄'}};
const events={ok:true,circleName:'T',code:'ABCDEF',seenAt:now,joinRequests:[],joinPolicy:'approve',sos:[],pulse:null,calls:[],
  members:[{id:ME,name:'Anchit Tandon',role:'family',relation:'son',place:'Delhi',country:'IN',gift_info:{},created_at:now}],events:[]};
let lastSave=null;
const pg=await b.newPage({viewport:{width:430,height:932},serviceWorkers:'block'});
pg.on('pageerror',e=>errors.push('pageerror: '+e.message));
pg.on('console',m=>{if(m.type()==='error'&&m.text().indexOf('net::')<0)errors.push('console: '+m.text());});
await pg.route('**/api/**',r=>r.fulfill({json:{ok:false,error:'stub'}}));
await pg.route('**/api/events*',r=>r.fulfill({json:events}));
await pg.route('**/api/book*area=vault*',r=>{
  if(r.request().method()==='POST'){lastSave=JSON.parse(r.request().postData()||'{}');return r.fulfill({json:{ok:true,id:'d1'}});}
  return r.fulfill({json:{ok:true,maxFile:2097152,kinds,idShapes:shapes,docs:[],grants:[],log:[],
    members:[{id:ME,name:'Anchit Tandon',relation:'son'}]}});});
await pg.route('**/api/book*area=pay*',r=>r.fulfill({json:{ok:true,kinds:{},methods:[],perms:[],log:[],members:[]}}));
await pg.addInitScript(()=>{localStorage.setItem('parwah',JSON.stringify({code:'ABCDEF',memberId:'11111111-1111-1111-1111-111111111111',name:'Anchit Tandon',role:'family',circleName:'T'}));localStorage.setItem('parwah-fr-hide','1');});
await pg.goto(BASE + '/#vault'); await pg.waitForTimeout(800);

const num=pg.locator('#vd-number'), st=pg.locator('#vd-numstate'), sw=pg.locator('#vd-swap');
await pg.selectOption('#vd-kind','aadhaar'); await pg.waitForTimeout(150);
ok((await num.getAttribute('placeholder'))==='e.g. 1234 5678 9012','the field shows what an Aadhaar looks like');
ok((await num.getAttribute('inputmode'))==='numeric','and asks a phone for the number keypad');
ok(/12 digits/.test(await st.textContent()),'and says so before a key is pressed');

// counting up
await num.fill(''); await num.type('1234'); await pg.waitForTimeout(120);
ok(await num.inputValue()==='1234','four digits so far');
ok(/^4 of 12/.test(await st.textContent()),'counted, not called wrong → '+(await st.textContent()));
await num.type('5678'); await pg.waitForTimeout(120);
ok(await num.inputValue()==='1234 5678','the grouping appears as you type');
// letters are KEPT, not silently eaten - that is what lets the app explain
await num.type('ABC'); await pg.waitForTimeout(150);
ok(await num.inputValue()==='12345678ABC','letters typed into an Aadhaar are kept, not swallowed → '+(await num.inputValue()));
ok(!/^11 of 12/.test(await st.textContent()),'and are not counted as progress');

// a whole valid one
await num.fill(''); await num.type('234123412346'); await pg.waitForTimeout(150);
ok(await num.inputValue()==='2341 2341 2346','a full Aadhaar is grouped 4-4-4');
ok(/✓/.test(await st.textContent()),'and confirmed → '+(await st.textContent()));
ok(await sw.isHidden(),'with nothing to switch to');

// one digit wrong
await num.fill(''); await num.type('234123412347'); await pg.waitForTimeout(150);
ok(/does not add up/.test(await st.textContent()),'a mistyped digit is caught at once, not at save time');

// THE case from the screenshot: a PAN typed under Aadhaar
await num.fill(''); await pg.waitForTimeout(80);
await pg.evaluate(()=>{const e=document.getElementById('vd-number');
  e.value='ALVPT2248R'; e.dispatchEvent(new Event('input',{bubbles:true}));});
await pg.waitForTimeout(150);
const msg=await st.textContent();
ok(/looks like a PAN card/.test(msg),'a PAN in the Aadhaar box is named for what it is → '+msg);
ok(await sw.isVisible(),'and switching is offered, not just refused');
ok(/PAN card/.test(await sw.textContent()),'by name → '+(await sw.textContent()));
await sw.click(); await pg.waitForTimeout(200);
ok(await pg.locator('#vd-kind').inputValue()==='pan','the switch changes the document kind');
ok(await num.inputValue()==='ALVPT 2248 R','and re-groups what was already typed');
ok(/✓/.test(await st.textContent()),'and it is now correct → '+(await st.textContent()));
ok(await sw.isHidden(),'the offer goes away once taken');

// changing kind reshapes the field
await pg.selectOption('#vd-kind','passport'); await pg.waitForTimeout(150);
ok((await num.getAttribute('placeholder'))==='e.g. A 1234567','choosing another document re-shapes the field');
await num.fill(''); await num.type('A1234567'); await pg.waitForTimeout(150);
ok(await num.inputValue()==='A 1234567','a passport splits the letter off');

// what actually gets sent
await pg.selectOption('#vd-kind','pan'); await pg.waitForTimeout(120);
await pg.fill('#vd-label',"Anchit's PAN");
await num.fill(''); await num.type('ALVPT2248R'); await pg.waitForTimeout(150);
ok(await pg.locator('#vd-about option').count() > 0,
   'opening straight on #vault still knows who the family are');
await pg.click('#vd-save'); await pg.waitForTimeout(400);
ok(lastSave && lastSave.kind==='pan','the document is saved as the kind it really is');
ok(lastSave && /ALVPT/.test(lastSave.number),'with the number the person typed');

ok(errors.length===0,'no page errors'+(errors.length?' - '+errors.slice(0,3).join(' | '):''));
console.log('\n'+pass+' passed, '+fail+' failed');
await b.close(); srv.close(); process.exit(fail?1:0);
