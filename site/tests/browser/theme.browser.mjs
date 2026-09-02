// Light and dark, on every screen, with the contrast actually measured against
// what the browser really painted rather than what the CSS says it should.
//
// NOT part of the deploy gate - Vercel's builders have no browser. Run it
// locally when colours or the theme setting change:
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
  process.exit(0);
}
const b=await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
let pass=0,fail=0; const errors=[];
const ok=(c,n)=>{c?pass++:(fail++,console.log('FAIL  '+n)); if(c) console.log('PASS  '+n);};

const ME='11111111-1111-1111-1111-111111111111', now=new Date().toISOString();
const events={ok:true,circleName:'T',code:'ABCDEF',seenAt:now,joinRequests:[],joinPolicy:'approve',sos:[],
  pulse:{day:'2026-09-01',style:'weather',styleName:'Weather',ask:'How are you today?',
    options:[{k:'sunny',e:'☀️',t:'Sunny'},{k:'rainy',e:'🌧',t:'Rainy',call:true}],answers:[]},calls:[],
  members:[{id:ME,name:'Anchit Tandon',role:'family',relation:'son',place:'Delhi',country:'IN',dob:'1990-08-05',gift_info:{},created_at:now}],
  events:[{type:'checkin',member_name:'Papa',created_at:now},{type:'sos',member_name:'Papa',created_at:now}]};
const book={ok:true,staleDays:180,records:[],access:[],consent:[],family:{pct:60,ready:3,total:5,gapCount:2,gaps:[]},prep:[],
  entries:[{id:'b1',kind:'contact',name:'Dr Sharma',category:'doctor',phone:'+91 98100 33333',address:null,forwhat:null,
    notes:'cardiologist',by_name:'A',about_member:null,about_name:null,last_verified_at:now,created_at:now}]};

// contrast, measured the way WCAG defines it
const CONTRAST = `(fg,bg)=>{const L=c=>{const [r,g,b]=c.match(/\\d+(\\.\\d+)?/g).slice(0,3).map(Number)
  .map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
  return 0.2126*r+0.7152*g+0.0722*b;};
  const a=L(fg),c2=L(bg);return (Math.max(a,c2)+0.05)/(Math.min(a,c2)+0.05);}`;

for (const mode of ['light','dark']) {
  const pg=await b.newPage({viewport:{width:1280,height:900},colorScheme:mode,serviceWorkers:'block'});
  pg.on('pageerror',e=>errors.push(mode+' pageerror: '+e.message));
  await pg.route('**/api/**',r=>r.fulfill({json:{ok:false,error:'stub'}}));
  await pg.route('**/api/events*',r=>r.fulfill({json:events}));
  await pg.route('**/api/book*area=vault*',r=>r.fulfill({json:{ok:true,maxFile:1,kinds:{},idShapes:{},docs:[],grants:[],log:[],members:[]}}));
  await pg.route('**/api/book*',r=>r.fulfill({json:book}));
  await pg.addInitScript(()=>{localStorage.setItem('parwah',JSON.stringify({code:'ABCDEF',memberId:'11111111-1111-1111-1111-111111111111',name:'Anchit Tandon',role:'family',circleName:'T'}));localStorage.setItem('parwah-fr-hide','1');});
  await pg.goto(BASE + '/app/'); await pg.waitForTimeout(700);

  const bg=await pg.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  const dark = mode==='dark';
  const lum=await pg.evaluate(`(${CONTRAST})('rgb(255,255,255)','${bg}')`);
  ok(dark ? lum>10 : lum<2, `${mode}: the page ground is actually ${mode} (${bg})`);

  // contrast on real rendered text across panes
  for (const [hash,sel,label] of [['#home','.homehero h1','home heading'],
                                  ['#home','.homehero .hint','home hint text'],
                                  ['#memory','#blist .ev b','memory entry title'],
                                  ['#memory','#blist .ev small','memory entry detail'],
                                  ['#profile','#themeseg button','the appearance buttons'],
                                  ['#home','.homehero h1','hero heading on its gradient']]) {
    await pg.evaluate(h=>location.hash=h, hash); await pg.waitForTimeout(350);
    const r=await pg.evaluate(([s,C])=>{
      const el=[...document.querySelectorAll(s)].find(e=>e.offsetParent&&e.textContent.trim());
      if(!el) return null;
      const cs=getComputedStyle(el); let n=el, bg=cs.backgroundColor, grad=null;
      while(n){
        const c=getComputedStyle(n);
        // A gradient paints the box even though backgroundColor is transparent.
        if(c.backgroundImage && c.backgroundImage!=='none' && /gradient/.test(c.backgroundImage)){grad=c.backgroundImage;break;}
        if(c.backgroundColor!=='rgba(0, 0, 0, 0)' && c.backgroundColor!=='transparent'){bg=c.backgroundColor;break;}
        n=n.parentElement;
      }
      if(grad){ const stops=grad.match(/rgba?\([^)]+\)/g)||[]; bg=stops.length?stops[0]:bg; }
      return {fg:cs.color,bg,size:parseFloat(cs.fontSize),weight:cs.fontWeight,text:el.textContent.trim().slice(0,24)};
    },[sel,CONTRAST]);
    if(!r){ok(false,`${mode}: ${label} not found`);continue;}
    const ratio=await pg.evaluate(`(${CONTRAST})('${r.fg}','${r.bg}')`);
    const large = r.size>=24 || (r.size>=18.66 && +r.weight>=700);
    const need = large?3:4.5;
    ok(ratio>=need, `${mode}: ${label} passes WCAG AA (${ratio.toFixed(2)} vs ${need} needed)`);
  }
  // The accent chips are the reason --on-accent and --on-dark exist, and they
  // are easier to get wrong than anything else: in dark mode the accents
  // LIGHTEN, so white-on-red stops working. Measure the token pairs directly
  // rather than hunting for an element that happens to be on screen.
  const tok=await pg.evaluate(()=>{const c=getComputedStyle(document.documentElement);
    const g=n=>c.getPropertyValue(n).trim();
    return {onAccent:g('--on-accent'),onDark:g('--on-dark'),dusk:g('--dusk'),alert:g('--alert'),ok:g('--ok'),
            marigold:g('--marigold'),sindoor:g('--sindoor'),pine:g('--pine')};});
  const hex=h=>{h=h.replace('#','');return `rgb(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)})`;};
  // Marigold is a light amber and takes dark text, the same as every button
  // in the app; --dusk is the token that does that job in both themes.
  for (const [text,bgName] of [['onAccent','alert'],['onAccent','ok'],['dusk','marigold'],['onAccent','sindoor'],['onDark','dusk'],['onDark','pine']]) {
    const r=await pg.evaluate(`(${CONTRAST})('${hex(tok[text])}','${hex(tok[bgName])}')`);
    ok(r>=4.5, `${mode}: ${text} on ${bgName} is legible (${r.toFixed(2)})`);
  }
  await pg.close();
}

// the setting itself
const pg=await b.newPage({viewport:{width:1280,height:900},colorScheme:'light',serviceWorkers:'block'});
pg.on('pageerror',e=>errors.push('pageerror: '+e.message));
await pg.route('**/api/**',r=>r.fulfill({json:{ok:false,error:'stub'}}));
await pg.route('**/api/events*',r=>r.fulfill({json:events}));
await pg.addInitScript(()=>{localStorage.setItem('parwah',JSON.stringify({code:'ABCDEF',memberId:'11111111-1111-1111-1111-111111111111',name:'A',role:'family',circleName:'T'}));localStorage.setItem('parwah-fr-hide','1');});
await pg.goto(BASE + '/app/#profile'); await pg.waitForTimeout(700);
ok(await pg.locator('#themeseg button.sel').textContent()==='Automatic','it starts on Automatic');
const lightBg=await pg.evaluate(()=>getComputedStyle(document.body).backgroundColor);
await pg.click('[data-theme-set="dark"]'); await pg.waitForTimeout(250);
const darkBg=await pg.evaluate(()=>getComputedStyle(document.body).backgroundColor);
ok(darkBg!==lightBg,'choosing Dark repaints the page');
ok(await pg.evaluate(()=>document.documentElement.getAttribute('data-theme'))==='dark','and stamps the choice on the root');
ok(await pg.evaluate(()=>document.querySelector('meta[name="theme-color"]').content)==='#0C100D',
   'and tells the browser chrome, which CSS cannot reach');
ok(await pg.evaluate(()=>localStorage.getItem('parwah-theme'))==='dark','the choice is remembered');
await pg.reload(); await pg.waitForTimeout(500);
ok(await pg.evaluate(()=>getComputedStyle(document.body).backgroundColor)===darkBg,'and survives a reload');
ok(await pg.evaluate(()=>document.documentElement.getAttribute('data-theme'))==='dark',
   'applied before the first paint, so there is no flash of light');
// a chosen light must beat a dark device
await pg.close();
const pg2=await b.newPage({viewport:{width:1280,height:900},colorScheme:'dark',serviceWorkers:'block'});
await pg2.route('**/api/**',r=>r.fulfill({json:{ok:false,error:'stub'}}));
await pg2.route('**/api/events*',r=>r.fulfill({json:events}));
await pg2.addInitScript(()=>{localStorage.setItem('parwah',JSON.stringify({code:'ABCDEF',memberId:'11111111-1111-1111-1111-111111111111',name:'A',role:'family',circleName:'T'}));
  localStorage.setItem('parwah-fr-hide','1'); localStorage.setItem('parwah-theme','light');});
await pg2.goto(BASE + '/app/#profile'); await pg2.waitForTimeout(600);
const l=await pg2.evaluate(`(${CONTRAST})('rgb(255,255,255)',getComputedStyle(document.body).backgroundColor)`);
ok(l<2,'choosing Light beats a device set to dark');
await pg2.close();

ok(errors.length===0,'no page errors'+(errors.length?' - '+errors.slice(0,3).join(' | '):''));
console.log('\n'+pass+' passed, '+fail+' failed');
await b.close(); srv.close(); process.exit(fail?1:0);
