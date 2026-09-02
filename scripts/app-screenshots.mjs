#!/usr/bin/env node
/* The screenshots Android shows in the install prompt, taken from the real
   app rather than mocked up — seeds a small family through the real API, then
   photographs three screens at phone size.

     npm run dev                       (in another terminal, with DATABASE_URL)
     node scripts/app-screenshots.mjs

   Writes site/public/app/shot-*.png, which manifest.webmanifest names.
   Commit them: the deploy has no browser. Everything it creates in the
   database, it deletes. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || path.join(ROOT, 'site', 'public', 'app');
const BASE = process.env.BASE || 'http://localhost:3000';

const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!j || j.ok === false) throw new Error(p + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j;
};
const ph = () => '9' + String(Math.floor(Math.random() * 900000000) + 100000000);

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('playwright-core is not installed — see the note at the top of this file.'); process.exit(1); }

// ---- a family worth photographing: a son away, his parents at home ----
const rohanPhone = ph();
const rohan = await post('/api/circle', { action: 'create', memberName: 'Rohan', circleName: 'Tandon Family',
  role: 'family', relation: 'son', phone: rohanPhone });
const code = rohan.code, ME = rohan.memberId;
await post('/api/circle', { action: 'set_join_policy', code, memberId: ME, policy: 'open' });
const papa = await post('/api/circle', { action: 'join', code, memberName: 'Papa', role: 'parent', relation: 'father', phone: ph() });
const amma = await post('/api/circle', { action: 'join', code, memberName: 'Amma', role: 'parent', relation: 'mother', phone: ph() });

await post('/api/circle', { code, memberId: ME, action: 'update_member', place: 'Bengaluru', dob: '1990-08-05' });
await post('/api/circle', { code, memberId: papa.memberId, action: 'update_member', place: 'New Delhi', dob: '1958-03-12' });
await post('/api/circle', { code, memberId: amma.memberId, action: 'update_member', place: 'New Delhi', dob: '1961-11-02' });

const mem = (b) => post('/api/book', Object.assign({ code, memberId: ME, action: 'add' }, b));
await mem({ kind: 'contact', category: 'doctor', name: 'Dr Sharma', phone: '+919810033333', notes: 'Cardiologist, Max Saket', aboutId: papa.memberId });
await mem({ kind: 'contact', category: 'emergency', name: 'Meena Aunty (next door)', phone: '+919810044444', aboutId: papa.memberId });
await mem({ kind: 'contact', category: 'local', name: 'Suresh (driver)', phone: '+919810055555', aboutId: papa.memberId });
await mem({ kind: 'fact', category: 'blood', name: 'B positive', aboutId: papa.memberId });
await mem({ kind: 'fact', category: 'allergy', name: 'Penicillin', aboutId: papa.memberId });
await mem({ kind: 'med', name: 'Telmisartan 40mg', forwhat: 'blood pressure — one after breakfast', aboutId: papa.memberId });
await mem({ kind: 'insurance', name: 'Star Health family floater', forwhat: 'policy 8842-1190, renews in March', aboutId: papa.memberId });
await mem({ kind: 'fact', category: 'blood', name: 'O positive', aboutId: amma.memberId });
await mem({ kind: 'contact', category: 'doctor', name: 'Dr Iyer', phone: '+919810066666', notes: 'Physician, Apollo', aboutId: amma.memberId });
await mem({ kind: 'address', name: 'Home', address: 'B-42 Greater Kailash II, New Delhi 110048', aboutId: papa.memberId });
await mem({ kind: 'contact', category: 'repairs', name: 'Ramesh — plumber', phone: '+919810077777' });

await post('/api/events', { code, memberId: papa.memberId, type: 'pulse', value: 'clear' });
await post('/api/events', { code, memberId: amma.memberId, type: 'pulse', value: 'moving' });
await post('/api/care', { code, memberId: ME, action: 'request_create', title: 'Book Papa\u2019s annual health check' });
const r1 = await post('/api/care', { code, memberId: ME, action: 'reminder_create', title: 'BP tablet', forMemberId: papa.memberId, timeOfDay: '08:30', recurrence: 'daily' });
await post('/api/care', { code, memberId: papa.memberId, action: 'reminder_respond', reminderId: r1.id, accept: true });

const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const pg = await b.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', deviceScaleFactor: 2 });
await pg.addInitScript(([code, ME]) => {
  localStorage.setItem('parwah', JSON.stringify({ code, memberId: ME, name: 'Rohan', role: 'family', circleName: 'Tandon Family' }));
  localStorage.setItem('parwah-fr-hide', '1');
  localStorage.setItem('parwah-push-later', '1');
}, [code, ME]);

for (const [hash, file] of [['home', 'shot-today.png'], ['people', 'shot-people.png'], ['memory', 'shot-memory.png']]) {
  await pg.goto(BASE + '/app/#' + hash);
  await pg.waitForTimeout(2600);
  // The toast from a page load is not part of the screen.
  await pg.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('show'); });
  const f = path.join(OUT, file);
  await pg.screenshot({ path: f });
  console.log('wrote ' + path.relative(ROOT, f));
}
await b.close();

await post('/api/circle', { code, memberId: ME, action: 'leave' });
console.log('seed circle ' + code + ' left behind for review; delete it when done');
