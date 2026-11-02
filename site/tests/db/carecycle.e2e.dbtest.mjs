// DOSES, THE HOSPITAL SCREEN AND AFTER-VISIT NOTES, END TO END: a real
// browser, the real API and a real PostgreSQL.
//
// - Maa, in elder mode, sees "Morning medicines, 8:00. Tap when taken" as one
//   big tick in place of "Medicines taken", and taps it;
// - Anchit sees on Maa's page that she marked it, marks one for her, reads
//   the week strip and sets a medicine's times;
// - Anchit opens the hospital screen; Sunita sees it on Today and taps the
//   steps; "waiting since" appears after discharge is advised; it closes
//   into Maa's history;
// - after a doctor's appointment, Today asks "How did the visit go?", and a
//   photo and three taps become a vault paper and follow-up tasks.
//
// With CC_SHOT_DIR set, every new screen is saved at 390 and 1440, light and dark.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('carecycle.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('carecycle.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('carecycle.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'ekta']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
await ensureSchema(db());

let n = 0;
async function user(name) {
  const phone = '+9198600' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const h = HANDLERS[u.pathname.slice(5).replace(/\/$/, '')];
    res.setHeader('Content-Type', 'application/json');
    if (!h) { res.end('{"ok":false,"error":"not in this test"}'); return; }
    let raw = ''; for await (const c of req) raw += c;
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.0.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
    const w = { status(s) { res.statusCode = s; return this; }, json(j) { res.end(JSON.stringify(j)); return this; }, setHeader(k, v) { res.setHeader(k, v); return this; } };
    try { await h(r, w); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })); }
    if (res.statusCode >= 500) errors.push('server ' + res.statusCode + ' on ' + req.method + ' ' + u.pathname + u.search.slice(0, 40));
    return;
  }
  let p = u.pathname; if (p.endsWith('/')) p += 'index.html';
  try { const d = await readFile(path.join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };
const errors = [];
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const SHOTS = process.env.CC_SHOT_DIR;
async function shotAll(page, name, sel) {
  if (!SHOTS) return;
  const was = page.viewportSize();
  for (const w of [390, 1440]) for (const sc of ['light', 'dark']) {
    await page.setViewportSize({ width: w, height: 900 }); await page.emulateMedia({ colorScheme: sc });
    if (sel) await page.$eval(sel, el => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${name}-${w}-${sc}.png`, fullPage: false });
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' });
}
// No sideways scroll, and every button in view at least 44px tall.
async function fits(page, scope, label) {
  const r = await page.evaluate((sc) => {
    const wide = document.documentElement.scrollWidth > window.innerWidth + 1;
    const root = document.querySelector(sc);
    const small = root ? [...root.querySelectorAll('button')].filter(b => { const x = b.getBoundingClientRect(); return x.width > 0 && x.height < 44; }).map(b => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 30)) : ['no ' + sc];
    return { wide, small };
  }, scope);
  ok(label + ': no sideways scroll at 390px, and every button is 44px or more', !r.wide && !r.small.length, JSON.stringify(r));
}

async function phone(who, { hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' });
  await ctx.addInitScript(([w]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: w.role || 'family', circleName: w.circleName }));
  }, [who]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  await page.goto(BASE + '/' + hash);
  await page.waitForTimeout(1500);
  return page;
}
const call = async (name, body, query = {}, method = 'POST', token) => {
  let out, st = 200; const res = { status(s) { st = s; return this; }, json(j) { out = j; return this; }, setHeader() {} };
  await HANDLERS[name]({ method, headers: { 'x-parwah-token': token, 'x-forwarded-for': '10.4.0.' + (++n % 250), 'x-parwah-tz': 'Asia/Kolkata' }, query, body }, res);
  return { ...out, http: st };
};

// ---- the family: Anchit, Sunita, Maa
const U = { Anchit: await user('Anchit') };
const made = await call('circle', { action: 'create', kind: 'family', familyType: 'joint', memberName: 'Anchit', circleName: 'Tandon Family', userId: U.Anchit.userId, relation: 'son' }, {}, 'POST', U.Anchit.token);
const code = made.code;
await admin.query(`update circles set join_policy = 'open' where code = $1`, [code]);
U.Anchit.memberId = made.memberId;
for (const [name, rel] of [['Sunita', 'daughter-in-law'], ['Maa', 'mother']]) {
  U[name] = await user(name);
  const j = await call('circle', { action: 'join', code, memberName: name, userId: U[name].userId, relation: rel }, {}, 'POST', U[name].token);
  U[name].memberId = j.memberId;
}
await admin.query(`update members set role = 'parent' where id = $1`, [U.Maa.memberId]);
const as = (name) => ({ ...U[name], code, circleName: 'Tandon Family', role: name === 'Maa' ? 'parent' : 'family' });
const api = (name, who, body, query, method) => call(name, { code, memberId: U[who].memberId, ...body }, { circle: code, member: U[who].memberId, ...(query || {}) }, method || 'POST', U[who].token);
const amlo = (await api('book', 'Anchit', { action: 'add', kind: 'med', name: 'Amlopres 5', forwhat: 'BP', aboutId: U.Maa.memberId })).id;
const shelcal = (await api('book', 'Anchit', { action: 'add', kind: 'med', name: 'Shelcal 500', aboutId: U.Maa.memberId })).id;
await api('book', 'Anchit', { action: 'add', kind: 'insurance', name: 'Star Health', notes: 'Policy 4410 2231 9012', aboutId: U.Maa.memberId });
await api('book', 'Anchit', { action: 'add', kind: 'contact', category: 'emergency', name: 'Anchit', phone: '9810012345', aboutId: U.Maa.memberId });

// Times: one that passed 30 minutes ago at home (India), one later today.
const ist = new Date(Date.now() + 5.5 * 3600000);
const hh = (d) => String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
const pastT = hh(new Date(ist.getTime() - 30 * 60000));
const laterT = hh(new Date(ist.getTime() + 150 * 60000));
const crossesMidnight = laterT < pastT || ist.getUTCHours() < 1;
let r = await api('care', 'Anchit', { area: 'doses', action: 'dose_schedule_set', medicineId: amlo, times: [pastT, laterT], tz: 'Asia/Kolkata' });
ok('times are set through the API the app uses', r.ok, JSON.stringify(r));
r = await api('care', 'Anchit', { area: 'doses', action: 'dose_schedule_set', medicineId: shelcal, times: [pastT], tz: 'Asia/Kolkata' });
// A week of history: the times were set four days ago; some marked, one skipped.
await admin.query(`update medicine_schedules set since = now() - interval '4 days'`);
await admin.query(`delete from medicine_doses`);
await api('care', 'Anchit', { area: 'doses' }, {}, 'GET');
await admin.query(`update medicine_doses set status = 'taken', taken_at = due_at + interval '5 minutes', marked_by = $1
                   where due_at < now() - interval '20 hours' and due_at > now() - interval '3 days'`, [U.Maa.memberId]);
await admin.query(`update medicine_doses set status = 'skipped', taken_at = due_at, marked_by = $1, skip_reason = 'Ran out'
                   where id = (select id from medicine_doses where due_at < now() - interval '3 days' and medicine_id = $2 order by due_at limit 1)`, [U.Maa.memberId, shelcal]);

// =====================================================================
// 1. MAA'S BIG TICK
// =====================================================================
const M = await phone(as('Maa'), { hash: '#home' });
await M.waitForTimeout(600);
const elder = await M.textContent('#dose-elder').catch(() => '');
ok('elder mode shows the time as one big tick: "… medicines, H:MM. Tap when taken"', await M.isVisible('#dose-elder') && /(Morning|Afternoon|Evening|Night) medicines, \d{1,2}:\d\d (AM|PM)\s*Tap when taken/.test(elder), elder);
ok('and it stands in for the one-a-day "Medicines taken"', await M.isHidden('#btn-pill'));
await fits(M, '#dose-elder', 'Today in elder mode');
await shotAll(M, 'b1-elder-today', '#seniorui');
await M.click('#dose-elder [data-ccmark]'); await M.waitForTimeout(1200);
const marked = (await admin.query(`select count(*)::int n from medicine_doses where person_id = $1 and status = 'taken' and marked_by = $1 and taken_at > now() - interval '1 minute'`, [U.Maa.memberId])).rows[0].n;
ok('one tap marks every medicine at that time', marked === 2, String(marked));
ok('the tick shows it is marked, with the time', /Marked at \d/.test(await M.textContent('#dose-elder')));
ok('and says plainly it is a note, not a check', /a note, not a check/.test(await M.textContent('#dose-elder')));

// =====================================================================
// 2. ANCHIT ON MAA'S PAGE
// =====================================================================
const A = await phone(as('Anchit'), { hash: '#people' });
await A.click(`[data-person="${U.Maa.memberId}"]`); await A.waitForTimeout(1500);
const doses = await A.textContent('#pp-doses');
ok('Maa\'s page shows which doses she marked today', /Amlopres 5/.test(doses) && /Marked by Maa/.test(doses), doses);
ok('with the honest line about what a tick means', /A tick is what was marked, not a check that the medicine was taken\./.test(await A.textContent('#pp-doses-card')));
const cells = await A.$$eval('#pp-week .cc-day', bs => bs.map(b => b.getAttribute('aria-label')));
ok('a week strip of seven days, each said in words', cells.length === 7 && cells.every(c => /:/.test(c)), JSON.stringify(cells));
ok('a skipped day says so', cells.some(c => /skipped/.test(c)), JSON.stringify(cells));
await fits(A, '#pp-doses-card', 'Maa\'s medicines');
await shotAll(A, 'b2-person-doses', '#pp-doses-card');
// A tap on a day shows that day.
await A.click('#pp-week .cc-day:first-child'); await A.waitForTimeout(200);
ok('tapping a day lists that day', (await A.textContent('#pp-weekday')).length > 0);
// Set times for a medicine: the sheet.
await A.click(`[data-ccsched="${amlo}"]`); await A.waitForTimeout(300);
ok('"Change times" opens the times sheet for that medicine', await A.isVisible('#dsheet') && /When does Maa have Amlopres 5\?/.test(await A.textContent('#ds-title')));
await fits(A, '#dsheet', 'The times sheet');
await shotAll(A, 'b3-times-sheet', '#ds-title');
await A.click('#ds-days [data-d="0"]'); await A.click('#ds-save'); await A.waitForTimeout(900);
const days = (await admin.query(`select days from medicine_schedules where medicine_id = $1`, [amlo])).rows[0].days;
ok('saving the sheet changes the days (Sunday off)', Array.isArray(days) && days.length === 6 && !days.includes(0), JSON.stringify(days));

// =====================================================================
// 3. THE HOSPITAL SCREEN
// =====================================================================
await A.click('#pp-admit'); await A.waitForTimeout(300);
ok('"Admitted to hospital" opens a short form first', await A.isVisible('#ad-new') && /Maa is in hospital/.test(await A.textContent('#ad-title')));
await A.fill('#ad-n-hosp', 'City Hospital'); await A.fill('#ad-n-ward', 'Ward 3, bed 12'); await A.fill('#ad-n-doc', 'Dr Mehta');
await A.click('#ad-n-go'); await A.waitForTimeout(1500);
ok('then the shared screen: where, who is with her, the steps, the papers', await A.isVisible('#ad-live') && /City Hospital/.test(await A.textContent('#ad-facts')) && /You/.test(await A.textContent('#ad-with')));
ok('the policy shows only its last four', /ending 9012/.test(await A.textContent('#ad-facts')) && !(await A.textContent('#admsheet')).includes('2231'));
ok('the medicines from the book are in the papers to carry', /Amlopres 5 \(BP\)/.test(await A.textContent('#ad-papers')));
const S = await phone(as('Sunita'), { hash: '#home' });
ok('Sunita sees it on Today', /Maa is in hospital/.test(await S.textContent('#cc-today')), await S.textContent('#cc-today'));
await S.click('#cc-today [data-ccadm]'); await S.waitForTimeout(800);
for (let i = 0; i < 3; i++) { await S.click('#ad-steps [data-ccstep]'); await S.waitForTimeout(900); }
const steps = (await admin.query(`select steps from admissions where status = 'open'`)).rows[0].steps;
ok('Sunita taps through: pre-auth sent, approved, discharge advised, each stamped with her name', steps.length === 4 && steps[3].key === 'discharge_advised' && steps.slice(1).every(s => s.byName === 'Sunita'), JSON.stringify(steps.map(s => s.key)));
ok('the papers at the counter show the insurer and the emergency contact', /Star Health/.test(await S.textContent('#ad-packet')) && /Policy ending 9012/.test(await S.textContent('#ad-packet')) && /Anchit/.test(await S.textContent('#ad-packet')), await S.textContent('#ad-packet'));
ok('"Waiting since" appears after discharge is advised', await S.isVisible('#ad-wait') && /Waiting since \d{1,2}:\d\d/.test(await S.textContent('#ad-wait')), await S.textContent('#ad-wait'));
await S.click('#ad-papers [data-ccpaper="policy"]'); await S.waitForTimeout(700);
ok('a paper ticked is ticked for everyone', (await admin.query(`select papers from admissions where status = 'open'`)).rows[0].papers.policy === true);
await fits(S, '#admsheet', 'The hospital screen');
await shotAll(S, 'b4-hospital-screen', '#ad-title');
await shotAll(S, 'b5-hospital-papers', '#ad-papers');
await S.click('#ad-close'); await S.click('#as-yes'); await S.waitForTimeout(1200);
ok('closing it keeps it in Maa\'s history', (await admin.query(`select count(*)::int n from admissions where status = 'closed'`)).rows[0].n === 1 && await S.isHidden('#admsheet'));

// =====================================================================
// 4. AFTER THE VISIT
// =====================================================================
await admin.query(`insert into plans (circle_id, by_member, title, kind, at, going)
                   select id, $1, 'Maa: Dr Mehta', 'appointment', now() - interval '90 minutes', $2 from circles where code = $3`,
                  [U.Anchit.memberId, '{' + U.Anchit.memberId + ',' + U.Maa.memberId + '}', code]);
await A.close();
const A2 = await phone(as('Anchit'), { hash: '#home' });
ok('Today asks once the appointment has passed: "How did the visit go?"', /How did the visit go\?/.test(await A2.textContent('#cc-today')), await A2.textContent('#cc-today'));
await fits(A2, '#cc-today', 'Today with the visit question');
await shotAll(A2, 'b6-today-visit', '#cc-today');
await A2.click('#cc-today [data-ccvisit]'); await A2.waitForTimeout(400);
ok('the sheet is about Maa\'s visit', await A2.isVisible('#vsheet') && /How did Maa’s visit go\?/.test(await A2.textContent('#vs-title')), await A2.textContent('#vs-title'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await A2.setInputFiles('#vs-photo', { name: 'prescription.png', mimeType: 'image/png', buffer: png }); await A2.waitForTimeout(300);
await A2.click('#vs-next [data-w="6"]');
await A2.fill('#vs-test', 'HbA1c'); await A2.click('#vs-addtest');
await A2.fill('#vs-test', 'Lipid profile'); await A2.press('#vs-test', 'Enter');
await A2.fill('#vs-new', 'Walk 20 minutes a day');
await A2.fill('#vs-doc', 'Dr Mehta');
await fits(A2, '#vsheet', 'The visit sheet');
await shotAll(A2, 'b7-visit-sheet', '#vs-title');
await A2.click('#vs-save'); await A2.waitForTimeout(1800);
const v = (await admin.query(`select v.*, d.label, d.kind from audio_consultations v left join vault_docs d on d.id = v.vault_doc_id`)).rows[0];
ok('the photo went into the vault as a health record for Maa, and the note points at it', v && v.vault_doc_id && v.kind === 'health' && /Maa’s prescription/.test(v.label), JSON.stringify(v && { label: v.label, kind: v.kind }));
ok('next visit in 6 weeks, two tests, the new note: saved as typed', v && v.action_items.nextWeeks === 6 && v.action_items.tests.join() === 'HbA1c,Lipid profile' && v.transcript_raw === 'Walk 20 minutes a day');
const tasks = (await admin.query(`select title from requests order by due_at`)).rows.map(t => t.title);
ok('follow-ups land in To do with owners', tasks.some(t => /^Book Maa's next visit \(Dr Mehta\)$/.test(t)) && tasks.some(t => /^Get Maa's tests done: HbA1c, Lipid profile$/.test(t)) && tasks.some(t => /next visit is due/.test(t)), JSON.stringify(tasks));
ok('and Today stops asking', !/How did the visit go\?/.test(await A2.textContent('#cc-today')));
await A2.goto(BASE + '/#people'); await A2.waitForTimeout(1200);
await A2.click(`[data-person="${U.Maa.memberId}"]`); await A2.waitForTimeout(1500);
const vis = await A2.textContent('#pp-visits');
ok('Maa\'s page shows what the doctor asked for', /Next visit around/.test(vis) && /HbA1c, Lipid profile/.test(vis) && /Walk 20 minutes a day/.test(vis), vis);
ok('and the hospital stay in her history', await A2.isVisible('#pp-adm-card') && /City Hospital/.test(await A2.textContent('#pp-adm-hist')));
await shotAll(A2, 'b8-person-visits', '#pp-visits-card');

if (crossesMidnight) console.log('note: run near midnight in India; the "later today" dose may fall on tomorrow');
ok('no page errors and no server errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(`\ncarecycle.e2e: ${pass} passed, ${fails.length} failed`);
await browser.close(); server.close(); await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
process.exit(fails.length ? 1 : 0);
