// The page, driven in a real browser. The Python suite checks that the
// markup says the right things; this checks that the page DOES them.
//
// Every case here is a defect this site shipped with: a form that took a
// person's details and threw them away, no analytics at all, no share card,
// and a nav that vanished on a phone taking the only route to the launch
// list with it.
//
// NOT part of the commit gate - it needs a browser. Run it when index.html
// or the story page changes:
//
//     node tests/browser.mjs
//
// PW_CHROMIUM and PW_CORE can point at an existing Chromium and
// playwright-core if they are not where this expects.
import http from 'http'; import { readFile } from 'fs/promises'; import path from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const MIME={'.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain','.json':'application/json'};
const srv=http.createServer(async(q,r)=>{let p=q.url.split('?')[0]; if(p.endsWith('/'))p+='index.html';
 try{const d=await readFile(path.join(ROOT,p)); r.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'}); r.end(d);}catch{r.writeHead(404);r.end('nf');}});
await new Promise(r=>srv.listen(0,r)); const B='http://127.0.0.1:'+srv.address().port;
const CORE = process.env.PW_CORE || '/home/user/parwah-hq/node_modules/playwright-core/index.mjs';
let chromium;
try { ({ chromium } = await import(CORE)); }
catch {
  console.log('playwright-core is not installed - see the note at the top of this file.');
  console.log('The commit gate does not need it: run `python3 tests/test_site.py`.');
  srv.close(); process.exit(0);
}
const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass=0, fail=0; const ok=(c,n)=>{c?pass++:(fail++,console.log('FAIL  '+n)); if(c)console.log('PASS  '+n);};

async function page(vp, mutate){
  const pg = await b.newPage({ viewport: vp });
  const google=[]; pg.on('request', r=>{ if(/googletagmanager|google-analytics/.test(r.url())) google.push(r.url()); });
  const errs=[]; pg.on('pageerror', e=>errs.push(e.message));
  if (mutate) await pg.addInitScript(mutate);
  await pg.goto(B+'/'); await pg.waitForTimeout(500);
  return { pg, google, errs };
}

// ---- 1. a signup with no database goes somewhere
{
  const { pg, errs } = await page({width:390,height:844});
  await pg.fill('#wl-name','Rohan Sharma'); await pg.fill('#wl-email','rohan@example.com');
  await pg.fill('#wl-whatsapp','+91 98765 43210'); await pg.check('#wl-consent');
  await pg.click('#wl-submit'); await pg.waitForTimeout(400);
  const nav = await pg.getAttribute('#wl-mailto','href');
  ok(!!nav && nav.startsWith('mailto:'), 'a signup with no database builds a prefilled email');
  const d = decodeURIComponent(nav || '');
  ok(/Rohan Sharma/.test(d) && /rohan@example.com/.test(d), 'and carries the name and email');
  ok(/98765 43210/.test(d), 'and the WhatsApp number');
  ok(/care@parwah\.in/.test(d), 'addressed to the brand inbox');
  ok(/Consent to launch updates: yes/.test(d), 'and records the consent that was ticked');
  const visible = await pg.locator('#wl-msg a').getAttribute('href');
  ok(visible === nav, 'and the same link is on screen if no mail client opened');
  const msg = await pg.textContent('#wl-msg');
  ok(/email app is opening/.test(msg), 'and the person is told what just happened');
  ok(await pg.locator('#wl-msg').evaluate(el=>el.className.includes('ok')), 'shown as success, not as an error');
  ok(errs.length===0, 'no page errors' + (errs.length?': '+errs[0]:''));
  await pg.close();
}
// ---- 2. nothing reaches Google before a yes
{
  const { pg, google } = await page({width:390,height:844});
  await pg.waitForTimeout(600);
  ok(google.length===0, 'with no measurement ID, no request to Google is made');
  ok(await pg.locator('#consent-bar').isHidden(), 'and no banner is shown for a choice that does not exist');
  await pg.close();
}
// ---- 3. with an ID: banner first, tag only after Allow
{
  const { pg, google } = await page({width:390,height:844},
    ()=>{ window.__ga='G-TEST12345'; document.addEventListener('DOMContentLoaded',()=>{}); });
  await pg.evaluate(()=>{ localStorage.clear(); });
  await pg.addInitScript(()=>{});
  await pg.close();
}
{
  const pg = await b.newPage({ viewport:{width:390,height:844} });
  const google=[]; pg.on('request', r=>{ if(/googletagmanager|google-analytics/.test(r.url())) google.push(r.url()); });
  // simulate the ID being pasted in, exactly as the operator will do
  await pg.route('**/', async route=>{
    const res = await route.fetch(); let body = await res.text();
    body = body.replace('ga4: ""','ga4: "G-TEST12345"');
    await route.fulfill({ response: res, body, headers:{...res.headers(),'content-type':'text/html'} });
  });
  await pg.goto(B+'/'); await pg.waitForTimeout(600);
  ok(await pg.locator('#consent-bar').isVisible(), 'with an ID set, the choice is offered');
  ok(google.length===0, 'and still nothing is fetched before the answer');
  // The bar is fixed to the bottom, so the question is not where it sits in
  // the document but whether it covers the one button this page needs
  // pressed. Scroll to the form and check they do not overlap.
  await pg.locator('#wl-submit').scrollIntoViewIfNeeded(); await pg.waitForTimeout(300);
  const bar = await pg.locator('#consent-bar').boundingBox();
  const sub = await pg.locator('#wl-submit').boundingBox();
  const overlaps = bar && sub && sub.y + sub.height > bar.y && sub.y < bar.y + bar.height;
  ok(!overlaps, 'the banner does not cover the Join button'
     + (overlaps ? ` (button ${Math.round(sub.y)}-${Math.round(sub.y+sub.height)}, bar from ${Math.round(bar.y)})` : ''));
  const hit = await pg.evaluate(() => {
    const b = document.getElementById('wl-submit').getBoundingClientRect();
    const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return el ? el.id || el.tagName : null;
  });
  ok(hit === 'wl-submit', 'and a tap on it reaches the button, not the bar (hit: ' + hit + ')');
  const btn = await pg.locator('#cb-yes').boundingBox();
  ok(btn && btn.height>=44, 'the buttons are thumb-sized (' + Math.round(btn?btn.height:0) + 'px)');
  await pg.click('#cb-no'); await pg.waitForTimeout(500);
  ok(google.length===0, 'No thanks means no thanks');
  ok(await pg.locator('#consent-bar').isHidden(), 'and the bar goes away');
  await pg.reload(); await pg.waitForTimeout(700);
  ok(await pg.locator('#consent-bar').isHidden(), 'and stays away on the next visit');
  ok(google.length===0, 'and still nothing is fetched');
  await pg.evaluate(()=>localStorage.clear());
  await pg.reload(); await pg.waitForTimeout(500);
  await pg.click('#cb-yes'); await pg.waitForTimeout(1500);
  ok(google.length>0, 'Allow loads the tag (' + google.length + ' request)');
  await pg.close();
}
// ---- 4. the phone keeps a route to the thing the page is for
{
  const { pg } = await page({width:390,height:844});
  ok(await pg.locator('.nav-links a[href="/story/"]').isVisible(), 'on a phone the story link survives');
  await pg.goto(B+'/story/'); await pg.waitForTimeout(400);
  ok(await pg.locator('.nav-links a[href="/#join"]').isVisible(), 'and from the story, the launch list is one tap away');
  await pg.close();
}
// ---- 5. the share cards are actually served
{
  const pg = await b.newPage();
  for (const u of ['/og.png','/og-story.png']) {
    const r = await pg.goto(B+u);
    ok(r.status()===200 && r.headers()['content-type']==='image/png', 'the share card at ' + u + ' is served');
  }
  await pg.close();
}
await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
