#!/usr/bin/env node
/* Builds the 1200x630 social cards from the brand system, so a link shared on
   WhatsApp — which is how this product is actually passed between families —
   arrives as a card instead of a bare URL.

   Rendered from HTML through the Chromium that already runs the browser tests,
   rather than drawn by hand in a design tool, so the palette and the type can
   never drift from styles.css.

     npm i --no-save playwright-core && npx playwright install chromium
     node scripts/og-cards.mjs

   Commit the PNGs it writes: the deploy has no browser. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site', 'public', 'og');

const CARDS = [
  { file: 'home.png', eyebrow: 'परवाह · Parwah',
    title: 'Apni family ki parwah karein.',
    sub: 'One private circle for your family — check-ins, the emergency card, and everything a doctor asks for, in one place.' },
  { file: 'launch.png', eyebrow: 'Launching soon · India',
    title: 'Put your family first in line.',
    sub: 'Early access to the app, founding-member pricing for the first 500 families.' },
  { file: 'story.png', eyebrow: 'Our story',
    title: 'The 11pm phone call.',
    sub: 'Why we are building Parwah — and what it is for.' },
  { file: 'app.png', eyebrow: 'The Parwah app',
    title: 'Ready before the emergency.',
    sub: 'Blood group, allergies, medicines, doctor, insurance — per person, checked for freshness, on one screen with no internet.' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const page = (c) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Albert+Sans:wght@400;600;700&family=Tiro+Devanagari+Hindi&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;overflow:hidden;background:#182622;color:#EFE8D8;
    font-family:"Albert Sans",system-ui,sans-serif;position:relative}
  .ghost{position:absolute;right:-30px;top:-40px;font-family:"Tiro Devanagari Hindi",serif;
    font-size:460px;line-height:1;color:#1E3A31;user-select:none}
  .glow{position:absolute;right:-120px;top:-160px;width:620px;height:620px;border-radius:50%;
    background:radial-gradient(circle,rgba(232,162,61,.22),transparent 65%)}
  .in{position:relative;padding:74px 80px;height:100%;display:flex;flex-direction:column}
  .eyebrow{font-size:22px;letter-spacing:.22em;text-transform:uppercase;color:#E8A23D;font-weight:700}
  h1{font-family:"Fraunces",Georgia,serif;font-weight:560;font-size:82px;line-height:1.05;
    letter-spacing:-.01em;margin-top:26px;max-width:16ch}
  p{margin-top:26px;font-size:27px;line-height:1.45;color:#A8B3A6;max-width:42ch}
  .foot{margin-top:auto;display:flex;align-items:center;gap:16px;font-size:24px;color:#A8B3A6}
  .dev{font-family:"Tiro Devanagari Hindi",serif;color:#E8A23D;font-size:30px;letter-spacing:.28em}
  .thread{position:absolute;left:38px;top:0;bottom:0;width:3px;
    background:linear-gradient(#E8A23D 60%,transparent 0) top/3px 18px repeat-y;opacity:.55}
</style></head><body>
  <div class="glow"></div><div class="ghost">प</div><div class="thread"></div>
  <div class="in">
    <div class="eyebrow">${esc(c.eyebrow)}</div>
    <h1>${esc(c.title)}</h1>
    <p>${esc(c.sub)}</p>
    <div class="foot"><span class="dev">परवाह</span><span>parwah-hq.anchit-tandon.com</span></div>
  </div>
</body></html>`;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('playwright-core is not installed — see the note at the top of this file.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const pg = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const c of CARDS) {
  await pg.setContent(page(c), { waitUntil: 'load' });
  try { await pg.evaluate(() => document.fonts.ready); } catch {}
  await pg.waitForTimeout(400);
  const f = path.join(OUT, c.file);
  await pg.screenshot({ path: f });
  console.log('wrote ' + path.relative(ROOT, f));
}
await b.close();
