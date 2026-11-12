// YAADON KI ALBUM, END TO END: real browsers, the real API handlers and a
// real PostgreSQL. What a family meets:
//
//   - Asha opens the album. It starts empty, with a first step. She picks a
//     12 megapixel camera photo (4000 by 3000, with a location written into
//     the file) and one of pure noise, the hardest picture to pack. The
//     browser makes each one smaller BEFORE it is sent: 1600 pixels at most,
//     under 600 KB, with a preview under 40 KB, and the location is gone.
//   - She adds a caption, the year 1987 and who is in it (Nani, who is not on
//     the app, and Rohan). Rohan sees both in his grid, and on Nani's page.
//   - He opens one full width: caption, people, who added it and when; next
//     and previous by button, arrow key and swipe; Save to my phone; close.
//     He takes his own name off it. He cannot remove it.
//   - A photo that does not send says so on its own row, with Retry.
//   - Asha changes a caption, then removes a photo after being asked.
//   - Her "only me" album is not in Rohan's list, and its picture cannot be
//     fetched by him by its address, thumbnail or full.
//   - Today offers Rohan "A photo from 1987" once, and "Not now" puts it away.
//   - Near the limit the count is said; at the limit adding is refused in
//     plain words, with a way to the oldest photos. Offline and a server
//     error are plain sentences.
//
// Nothing here waits a fixed time: every step waits for the element or the
// state it is about to check.
//
// Every new screen is measured: 44px targets, a 12px floor, WCAG AA in light
// and dark, nothing sideways at 320 and 390. With ALBUM_SHOT_DIR set, each
// is saved at 390, light and dark.
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('album.e2e: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('album.e2e: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.ANTHROPIC_API_KEY;

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('album.e2e: playwright-core is not installed.'); process.exit(process.env.CI ? 1 : 0); }

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const HANDLERS = {};
for (const n of ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games']) HANDLERS[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash, hashPin, SECRET_V } = await import('../../../api/_auth.mjs');
const { albumPutBytes, ensureAlbumSchema } = await import('../../../api/_album.mjs');
const { jpegInfo, ALBUM_MAX, ALBUM_LOCATION_LINE } = await import('../../../api/_albumrules.mjs');
await ensureSchema(db());

let n = 0;
async function person(circleId, code, circleName, name, role = 'family') {
  const phone = '+9198644' + String(++n).padStart(5, '0');
  const h = hashPin('4819');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, secret_v, toured_at)
                                values ($1,'+91',$2,$3,$4,$5,now(),$6,now()) returning id`, [phone, phone.slice(3), name, h.hash, h.salt, SECRET_V])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id, place, country) values ($1,$2,$3,$4,'Delhi','IN') returning id`, [circleId, name, role, u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { memberId: m.id, id: m.id, userId: u.id, name, token, phone, code, circleName, role };
}

const ROOT = new URL('../../public', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const photoGets = [];
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const h = HANDLERS[u.pathname.slice(5).replace(/\/$/, '')];
    if (!h) { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":false,"error":"not in this test"}'); return; }
    let raw = ''; for await (const c of req) raw += c;
    if (u.searchParams.get('view') === 'photo') photoGets.push(u.searchParams.get('id') + ':' + (u.searchParams.get('size') || 'thumb'));
    const r = { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '10.0.2.' + (++n % 250) }, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : {} };
    // A photo leaves through end(), as bytes; everything else is JSON.
    const w = { status(s) { res.statusCode = s; return this; }, setHeader(k, v) { res.setHeader(k, v); return this; },
                json(j) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j)); return this; },
                end(b) { res.end(b); return this; } };
    try { await h(r, w); } catch (e) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: String(e) })); }
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
const SHOTS = process.env.ALBUM_SHOT_DIR;
const T = { timeout: 20000 };

// The page has taken the new width and theme, and nothing is still moving.
async function settle(page, width, scheme) {
  await page.waitForFunction(([w, dark]) => innerWidth === w && matchMedia('(prefers-color-scheme: dark)').matches === dark
    && document.getAnimations().every(a => a.playState !== 'running' || (a.effect && a.effect.getComputedTiming().iterations === Infinity)), [width, scheme === 'dark'], T);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function shot(page, name) {
  if (!SHOTS) return;
  const was = page.viewportSize();
  for (const sc of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: sc }); await settle(page, 390, sc);
    await page.screenshot({ path: `${SHOTS}/${name}-390-${sc}.png` });
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' }); await settle(page, was.width, 'light');
}
async function phone(who, { big = false, block = null, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'Asia/Kolkata', hasTouch: touch, acceptDownloads: true });
  await ctx.addInitScript(([w, big]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('parwah-user', JSON.stringify({ id: w.userId, name: w.name, phone: w.phone, toured: true }));
    localStorage.setItem('parwah-token', w.token);
    localStorage.setItem('parwah-fr-hide', '1');
    localStorage.setItem('parwah-coach-done', '1');
    localStorage.setItem('parwah-big', big ? '1' : '0');
    localStorage.setItem('parwah', JSON.stringify({ code: w.code, memberId: w.memberId, name: w.name, role: w.role, circleName: w.circleName }));
  }, [who, big]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who.name + ': ' + e.message));
  if (block) await page.route('**/api/book?area=album**', block);
  await page.goto(BASE + '/');
  await home(page);
  return page;
}
// The app is in the family and the family has loaded (whichever screen a reload lands on).
const home = (P) => P.waitForFunction(() => { const w = document.getElementById('w-fam');
  return document.body.classList.contains('inapp') && w && !/Loading/.test(w.textContent); }, null, T);
// Open Family Memory, then the album; `until` is what must be on screen before going on.
async function album(P, until = '#ab-tools:not([hidden])') {
  await P.evaluate(() => { location.hash = '#memory'; });
  await P.waitForSelector('#pane-memory:not([hidden])', T);
  await P.click('#mb-switch [data-mbv="album"]');
  await P.waitForSelector('#ab-root:not([hidden])', T);
  await P.waitForSelector(until, T);
}
// The grid shows exactly this many photos, and each one near the screen has its picture.
const gridOf = (P, count, sel = '#ab-grid') => P.waitForFunction(([sel, count]) => {
  const tiles = [...document.querySelectorAll(sel + ' .abtile')];
  if (tiles.length !== count) return false;
  return tiles.every(t => { const r = t.getBoundingClientRect(), im = t.querySelector('img');
    return r.top > innerHeight + 250 || r.bottom < -250 || (im.getAttribute('data-abst') === 'ok' && im.complete && im.naturalWidth > 0); });
}, [sel, count], T);
const openPerson = async (P, id) => {
  await P.evaluate((id) => { const b = document.createElement('button'); b.setAttribute('data-person', id); document.body.appendChild(b); b.click(); b.remove(); }, id);
  await P.waitForSelector('#pane-person:not([hidden])', T);
};
// The photo in the viewer has arrived and is the one at this place.
const viewerAt = (P, pos) => P.waitForFunction((pos) => {
  const v = document.getElementById('ab-viewer'), im = document.getElementById('ab-v-img');
  return v && !v.hidden && !im.hidden && im.complete && im.naturalWidth > 0 && (pos === null || document.getElementById('ab-v-pos').textContent === pos);
}, pos, T);
const sheetOpen = (P, title) => P.waitForFunction((t) => { const s = document.getElementById('mbsheet'); return s && !s.hidden && document.getElementById('mbs-title').textContent === t; }, title, T);
const sheetShut = (P) => P.waitForSelector('#mbsheet', { state: 'hidden', ...T });
const toastSays = (P, re) => P.waitForFunction((src) => { const t = document.getElementById('toast'); return t.classList.contains('show') && new RegExp(src).test(t.textContent); }, re.source, T);
const one = async (q, p) => (await admin.query(q, p)).rows[0];
const rows = async (q, p) => (await admin.query(q, p)).rows;

function measureIn(sel) {
  const root = document.querySelector(sel);
  if (!root) return { overflow: 0, bad: ['missing ' + sel] };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]'); };
  const L = (c) => { const m = c.match(/[\d.]+/g); if (!m) return 1; return m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map(x => x.trim()); return p.length === 4 ? +p[3] : 1; };
  const bgOf = (el) => { let n = el; while (n) { const c = getComputedStyle(n);
      if (alpha(c.backgroundColor) > 0.9) return [c.backgroundColor];
      if (c.backgroundImage && c.backgroundImage !== 'none' && n !== document.body) { const st = (c.backgroundImage.match(/rgba?\([^)]+\)/g) || []).filter(x => alpha(x) > 0.5); if (st.length) return st; }
      n = n.parentElement; } return [getComputedStyle(document.body).backgroundColor]; };
  const out = { overflow: document.scrollingElement.scrollWidth - innerWidth, bad: [] };
  root.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, textarea, label[role=button]').forEach(el => {
    if (!vis(el)) return;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return;
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) return;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) out.bad.push('small ' + (el.id || el.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  // A tick box is reached through its label: the label is the target.
  root.querySelectorAll('label').forEach(el => {
    if (!vis(el) || !el.querySelector('input[type=checkbox], input[type=radio]')) return;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) out.bad.push('small label ' + el.textContent.trim().slice(0, 20) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const el = w.currentNode.parentElement; if (!w.currentNode.textContent.trim() || !el || !vis(el)) continue;
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
    if (size < 11.99) out.bad.push('tiny ' + el.textContent.trim().slice(0, 20));
    const a = L(cs.color), ratio = Math.min(...bgOf(el).map(bg => { const b = L(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5) - 0.01) out.bad.push('contrast ' + el.textContent.trim().slice(0, 24) + ' ' + ratio.toFixed(2));
  }
  return out;
}
async function design(page, sel, label) {
  const was = page.viewportSize(); const bad = [];
  for (const [wd, sc] of [[320, 'light'], [390, 'light'], [390, 'dark'], [320, 'dark']]) {
    await page.setViewportSize({ width: wd, height: 800 }); await page.emulateMedia({ colorScheme: sc }); await settle(page, wd, sc);
    const m = await page.evaluate(measureIn, sel);
    if (m.overflow > 0) bad.push(wd + ' sideways ' + m.overflow + 'px');
    m.bad.forEach(b => bad.push(wd + '/' + sc + ' ' + b));
  }
  await page.setViewportSize(was); await page.emulateMedia({ colorScheme: 'light' }); await settle(page, was.width, 'light');
  ok('design: ' + label + ' - 44px targets, 12px floor, AA in both themes, nothing sideways at 320/390', bad.length === 0, bad.slice(0, 6).join(' | '));
}

// Put pictures into the add sheet the way choosing them from the phone does.
// Each is drawn in the page at the size a phone camera makes.
//   scene: a 12 megapixel photo of a lit room, with a location written into the file
//   noise: every pixel random, which no JPEG can pack well
//   small: a little picture, for the steps where size is not the point
async function choose(P, kinds, input = '#ab-file') {
  return P.evaluate(async ([kinds, input]) => {
    const files = [], sizes = [];
    for (const [kind, name] of kinds) {
      const big = kind !== 'small', W = big ? 4000 : 640, H = big ? 3000 : 480;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      if (kind === 'noise') {
        const im = g.createImageData(W, H), d = im.data;
        let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (i & 3) === 3 ? 255 : (s >> 16) & 255; }
        g.putImageData(im, 0, 0);
      } else {
        const sky = g.createLinearGradient(0, 0, W, H); sky.addColorStop(0, '#2A1235'); sky.addColorStop(0.5, '#D9146F'); sky.addColorStop(1, '#FFB31A');
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        let s = name.length * 7919 + 1; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        for (let i = 0; i < (big ? 900 : 60); i++) {             // diyas, faces, a rangoli of shapes
          g.fillStyle = `hsla(${Math.floor(rnd() * 360)}, ${50 + Math.floor(rnd() * 40)}%, ${30 + Math.floor(rnd() * 50)}%, ${0.35 + rnd() * 0.6})`;
          g.beginPath(); g.arc(rnd() * W, rnd() * H, 8 + rnd() * (big ? 220 : 40), 0, Math.PI * 2); g.fill();
        }
        if (big) {                                                 // the grain a real sensor leaves
          const im = g.getImageData(0, 0, W, H), d = im.data;
          for (let i = 0; i < d.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const k = ((s >> 16) & 31) - 15; d[i] += k; d[i + 1] += k; d[i + 2] += k; }
          g.putImageData(im, 0, 0);
        }
        g.fillStyle = '#FFF6EA'; g.font = `bold ${big ? 220 : 40}px sans-serif`; g.fillText(name, W * 0.08, H * 0.5);
      }
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', kind === 'small' ? 0.85 : 0.95));
      let bytes = new Uint8Array(await blob.arrayBuffer());
      if (kind === 'scene') {
        // What a camera writes beside the picture: an Exif block, here with
        // a place in it. It goes straight after the first two bytes.
        const note = new TextEncoder().encode('GPSLatitude 28.6139 N GPSLongitude 77.2090 E');
        const tiff = [0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        const len = 2 + 6 + tiff.length + note.length;
        const seg = Uint8Array.from([0xFF, 0xE1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff, ...note]);
        const out = new Uint8Array(bytes.length + seg.length);
        out.set(bytes.slice(0, 2), 0); out.set(seg, 2); out.set(bytes.slice(2), 2 + seg.length);
        bytes = out;
      }
      sizes.push({ name, bytes: bytes.length, w: W, h: H });
      files.push(new File([bytes], name, { type: 'image/jpeg' }));
    }
    const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
    const inp = document.querySelector(input); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    return sizes;
  }, [kinds, input]);
}
// Every row on the add list has reached this state.
const queueIs = (P, count, state) => P.waitForFunction(([count, state]) => {
  const r = [...document.querySelectorAll('#ab-queue .abq')];
  return r.length === count && r.every(x => x.getAttribute('data-abst') === state);
}, [count, state], { timeout: 60000 });
const queue = (P) => P.$$eval('#ab-queue .abq', rs => rs.map(r => ({ st: r.getAttribute('data-abst'), bytes: +r.getAttribute('data-abbytes'), tbytes: +r.getAttribute('data-abtbytes'),
  w: +r.getAttribute('data-abw'), h: +r.getAttribute('data-abh'), text: r.textContent, retry: !!r.querySelector('[data-abqretry]') })));

// ---- a family
const fam = (await one(`insert into circles (code, name, kind) values ('KAPOOR','Kapoor Family','family') returning id`)).id;
const asha = await person(fam, 'KAPOOR', 'Kapoor Family', 'Asha');
const rohan = await person(fam, 'KAPOOR', 'Kapoor Family', 'Rohan');
const papa = await person(fam, 'KAPOOR', 'Kapoor Family', 'Papa', 'parent');
// Nani is in the family by name only, and she is in the old photos.
const nani = await one(`insert into members (circle_id, name, role) values ($1,'Nani','parent') returning id`, [fam]);

// ================================================================ 1. it starts empty, with a first step
const A = await phone(asha);
ok('Today has no photo row yet', (await A.textContent('#ab-today')).trim() === '');
await album(A);
ok('Family Memory has an Album section, and it is chosen', await A.$eval('#mb-switch [data-mbv="album"]', b => b.classList.contains('sel') && b.getAttribute('aria-pressed') === 'true'));
ok('the heading says whose photos these are', /Yaadon ki album: the family’s own photos/.test(await A.textContent('#pane-memory .ektahead small')));
ok('EMPTY: it says so, with a first step', /No photos yet\./.test(await A.textContent('#ab-state')) && /Start with one old photo/.test(await A.textContent('#ab-state')) && await A.isVisible('#ab-state [data-abadd]'));
ok('the count is said from the start', (await A.textContent('#ab-count')) === '0 of 400 photos, for the whole family.');
ok('there is one album, for everyone: Our family', await A.$$eval('#ab-f-album option', os => os.map(o => o.textContent).join('|')) === 'All albums|Our family (0)');
ok('nothing but the family\'s own photos: no picture is on the screen yet', (await A.$$('#ab-root img')).length === 0);
await design(A, '#ab-root', 'the album, empty');
await shot(A, 'album-empty');

// ================================================================ 2. the add sheet, and the browser making a photo smaller
await A.click('#ab-state [data-abadd]');
await sheetOpen(A, 'Add photos');
ok('THE LOCATION LINE is on the add sheet, word for word', (await A.textContent('#ab-a-loc')) === 'Parwah removes the location from your photos before saving them.' && ALBUM_LOCATION_LINE === 'Parwah removes the location from your photos before saving them.');
ok('photos can be chosen, several at once, or taken with the camera', await A.$eval('#ab-file', i => i.type === 'file' && i.accept === 'image/*' && i.multiple === true)
   && await A.$eval('#ab-cam', i => i.type === 'file' && i.accept === 'image/*' && i.getAttribute('capture') === 'environment' && !i.multiple)
   && await A.isVisible('label[for="ab-file"]') && await A.isVisible('label[for="ab-cam"]'));
ok('the album to add to is Our family, and everyone can be ticked, Nani included', /Our family \(whole family\)/.test(await A.$eval('#ab-a-album', s => s.selectedOptions[0].textContent))
   && (await A.$$('#ab-a-people [data-abwho]')).length === 4 && /Nani/.test(await A.textContent('#ab-a-people')) && /Asha \(me\)/.test(await A.textContent('#ab-a-people')));
await A.click('#ab-a-save');
await A.waitForSelector('#mbs-err:not([hidden])', T);
ok('adding with nothing chosen is refused under the form', /Choose a photo first/.test(await A.textContent('#mbs-err')));
await design(A, '#mbsheet', 'the add sheet, empty, with a refusal showing');

const src = await choose(A, [['scene', 'IMG_4000.jpg'], ['noise', 'IMG_NOISE.jpg']]);
ok('the camera photo is 4000 by 3000 and ' + (src[0].bytes / 1048576).toFixed(1) + ' MB: far over the 600 KB the server keeps', src[0].w === 4000 && src[0].h === 3000 && src[0].bytes > 1500000, JSON.stringify(src[0]));
ok('the noise photo is 4000 by 3000 and ' + (src[1].bytes / 1048576).toFixed(1) + ' MB', src[1].bytes > 5000000, JSON.stringify(src[1]));
ok('together they would not fit in one request to a Vercel function (4.5 MB)', src[0].bytes + src[1].bytes > 4500000);
await queueIs(A, 2, 'ready');
const q = await queue(A);
console.log(`      measured: a 4000x3000 photo of ${(src[0].bytes / 1000).toFixed(0)} KB became ${q[0].w}x${q[0].h}, ${(q[0].bytes / 1000).toFixed(1)} KB, with a ${(q[0].tbytes / 1000).toFixed(1)} KB thumbnail`);
console.log(`      measured: a 4000x3000 photo of pure noise (${(src[1].bytes / 1000).toFixed(0)} KB) became ${q[1].w}x${q[1].h}, ${(q[1].bytes / 1000).toFixed(1)} KB, with a ${(q[1].tbytes / 1000).toFixed(1)} KB thumbnail`);
ok('THE BROWSER SHRANK THE CAMERA PHOTO to 1600 by 1200, before anything was sent', q[0].w === 1600 && q[0].h === 1200, JSON.stringify(q[0]));
ok('to under 600 KB, with a thumbnail under 40 KB', q[0].bytes > 0 && q[0].bytes <= 600000 && q[0].tbytes > 0 && q[0].tbytes <= 40000, JSON.stringify(q[0]));
ok('the noise photo, which no JPEG packs well, was brought under both limits too', q[1].bytes > 0 && q[1].bytes <= 600000 && q[1].tbytes > 0 && q[1].tbytes <= 40000 && Math.max(q[1].w, q[1].h) <= 1600, JSON.stringify(q[1]));
ok('each row says it is ready, with its size', q.every(r => /Ready to add, \d+ KB/.test(r.text)) && /IMG_4000\.jpg/.test(q[0].text));
ok('nothing has been sent yet', (await one(`select count(*)::int as n from album_photos`)).n === 0);
await A.fill('#ab-a-cap', 'Diwali at Nani’s house');
await A.fill('#ab-a-year', '87');
await A.click('#ab-a-save');
await A.waitForFunction(() => /four digits/.test(document.getElementById('mbs-err').textContent), null, T);
ok('a year that is not four digits is refused under the form, and nothing is sent', (await one(`select count(*)::int as n from album_photos`)).n === 0);
await A.fill('#ab-a-year', '1987');
await A.check(`#ab-a-people [data-abwho="${nani.id}"]`);
await A.check(`#ab-a-people [data-abwho="${rohan.id}"]`);
await design(A, '#mbsheet', 'the add sheet with two photos ready, a caption, a year and people');
await shot(A, 'album-add');
await A.click('#ab-a-save');
await sheetShut(A);
await toastSays(A, /2 photos added to the album/);
await gridOf(A, 2);

// what the server kept
const kept = await rows(`select p.id, p.caption, p.taken_year, p.width, p.height, p.photo_bytes, p.thumb_bytes, octet_length(b.photo) as pl, octet_length(b.thumb) as tl,
                                encode(b.photo, 'base64') as photo, encode(b.thumb, 'base64') as thumb,
                                (select string_agg(m.name, ',' order by m.name) from album_people ap join members m on m.id = ap.member_id where ap.photo_id = p.id) as people
                         from album_photos p join album_bytes b on b.photo_id = p.id order by p.created_at`);
ok('two photos are kept, with the caption, the year and the people', kept.length === 2 && kept.every(k => k.caption === 'Diwali at Nani’s house' && k.taken_year === 1987 && k.people === 'Nani,Rohan'), JSON.stringify(kept.map(k => [k.caption, k.taken_year, k.people])));
ok('what is stored is what the browser made: under 600 KB and 40 KB, 1600 at most', kept.every(k => k.pl <= 600000 && k.tl <= 40000 && k.pl === k.photo_bytes && k.tl === k.thumb_bytes && Math.max(k.width, k.height) <= 1600)
   && kept[0].pl === q[0].bytes && kept[0].tl === q[0].tbytes && kept[0].width === 1600 && kept[0].height === 1200, JSON.stringify(kept.map(k => [k.pl, k.tl, k.width, k.height])));
const stored = kept.map(k => ({ p: Buffer.from(k.photo, 'base64'), t: Buffer.from(k.thumb, 'base64') }));
ok('every stored file is a real JPEG', stored.every(s => jpegInfo(s.p) && jpegInfo(s.t) && Math.max(jpegInfo(s.t).width, jpegInfo(s.t).height) <= 320));
ok('THE LOCATION DID NOT LEAVE THE PHONE: no camera details block, and no trace of the place, in what was stored',
   stored.every(s => jpegInfo(s.p).exif === false && jpegInfo(s.t).exif === false && !s.p.includes('GPSLatitude') && !s.p.includes('28.6139') && !s.t.includes('GPSLatitude') && !s.p.includes('Exif\0\0')));
ok('the count went up', (await A.textContent('#ab-count')) === '2 of 400 photos, for the whole family.');

// ================================================================ 3. the grid
const tiles = await A.$$eval('#ab-grid .abtile', ts => ts.map(t => { const r = t.getBoundingClientRect(), im = t.querySelector('img'); return { w: r.width, h: r.height, alt: im.alt, label: t.getAttribute('aria-label'), nat: im.naturalWidth, src: im.src.slice(0, 5) }; }));
ok('two thumbnails, each in a fixed square box', tiles.length === 2 && tiles.every(t => Math.abs(t.w - t.h) < 1 && t.w >= 96), JSON.stringify(tiles.map(t => [t.w, t.h])));
ok('ALT TEXT is built from the caption and the people', tiles.every(t => t.alt === 'Diwali at Nani’s house. With Nani and Rohan, 1987' && t.label === 'Open photo: ' + t.alt), tiles[0].alt);
ok('the grid shows the small previews, held in memory, never an address of their own', tiles.every(t => t.nat <= 320 && t.nat > 0 && t.src === 'blob:'));
ok('the newest is first', (await A.$eval('#ab-grid .abtile img', im => im.getAttribute('data-abimg'))) === kept[1].id);
await design(A, '#ab-root', 'the album with photos');
await shot(A, 'album-grid');

// ================================================================ 4. the other member: the grid, and Nani's page
const R = await phone(rohan, { touch: true });
await album(R);
await gridOf(R, 2);
ok('ROHAN SEES BOTH PHOTOS in his grid, pictures and all', (await R.$$('#ab-grid .abtile img[data-abst="ok"]')).length === 2);
ok('he can look by person: Nani and Rohan are offered', await R.$$eval('#ab-f-person option', os => os.map(o => o.textContent).join('|')) === 'Everyone|Nani|Rohan');
await openPerson(R, nani.id);
await R.waitForSelector('#ab-pp-card:not([hidden])', T);
await gridOf(R, 2, '#ab-pp-grid');
ok('ON NANI\'S PAGE: "Photos with Nani", with both', (await R.textContent('#ab-pp-h')) === 'Photos with Nani' && (await R.$$('#ab-pp-grid .abtile')).length === 2 && (await R.textContent('#ab-pp-all')) === 'See all photos with Nani');
await R.$eval('#ab-pp-card', el => el.scrollIntoView({ block: 'center' }));
await design(R, '#ab-pp-card', 'photos on a person\'s page');
await shot(R, 'album-person');
await R.click('#ab-pp-all');
await R.waitForSelector('#ab-root:not([hidden])', T);
await gridOf(R, 2);
ok('the link opens the album already on Nani', (await R.$eval('#ab-f-person', s => s.value)) === nani.id && await R.$eval('#mb-switch [data-mbv="album"]', b => b.classList.contains('sel')));
await openPerson(R, papa.id);
await R.waitForFunction(() => document.getElementById('pp-name').textContent === 'Papa', null, T);
const papaList = await R.evaluate(async ([code, me, token, who]) => (await (await fetch(`/api/book?area=album&circle=${code}&member=${me}&person=${who}&limit=6`, { headers: { 'X-Parwah-Token': token } })).json()).photos.length, ['KAPOOR', rohan.id, rohan.token, papa.id]);
ok('Papa is in no photo, so his page has no photo card', papaList === 0 && !(await R.isVisible('#ab-pp-card')));

// ================================================================ 5. one photo, full width
await album(R);
await R.selectOption('#ab-f-person', '');
await gridOf(R, 2);
await R.click('#ab-grid .abtile >> nth=0');
await viewerAt(R, 'Photo 1 of 2');
ok('TAP OPENS THE PHOTO full width, the 1600 pixel one', await R.$eval('#ab-v-img', im => im.naturalWidth) === kept[1].width && await R.$eval('#ab-v-img', im => { const r = im.getBoundingClientRect(); return r.width >= innerWidth - 40; }));
ok('with its caption, the people, who added it and when, and the year', (await R.textContent('#ab-v-cap')) === 'Diwali at Nani’s house' && (await R.textContent('#ab-v-people')) === 'With Nani and Rohan'
   && /^Added by Asha on .*\d{4} · Taken in 1987 · Album: Our family$/.test(await R.textContent('#ab-v-meta')), await R.textContent('#ab-v-meta'));
ok('the picture has the same alt text', (await R.$eval('#ab-v-img', im => im.alt)) === 'Diwali at Nani’s house. With Nani and Rohan, 1987');
ok('it is a dialog, and Close has the focus', await R.$eval('#ab-viewer', v => v.getAttribute('role') === 'dialog' && v.getAttribute('aria-modal') === 'true') && await R.evaluate(() => document.activeElement.id === 'ab-v-x'));
ok('Previous is off on the first photo', await R.$eval('#ab-v-prev', b => b.disabled) && !(await R.$eval('#ab-v-next', b => b.disabled)));
ok('Rohan, who is in it, can take his name off; he cannot change or remove it', await R.isVisible('#ab-v-acts [data-abuntag]') && !(await R.$('#ab-v-acts [data-abedit]')) && !(await R.$('#ab-v-acts [data-abdel]')));
await design(R, '#ab-viewer', 'one photo, full width');
await shot(R, 'album-viewer');
await R.click('#ab-v-next');
await viewerAt(R, 'Photo 2 of 2');
ok('NEXT moves along, and is off on the last', await R.$eval('#ab-v-next', b => b.disabled) && (await R.$eval('#ab-v-img', im => im.naturalWidth)) === kept[0].width);
await R.keyboard.press('ArrowLeft');
await viewerAt(R, 'Photo 1 of 2');
ok('the left arrow key goes back', true);
await R.keyboard.press('ArrowRight');
await viewerAt(R, 'Photo 2 of 2');
ok('the right arrow key goes on', true);
const swipe = (P, from, to) => P.evaluate(([from, to]) => {
  const el = document.getElementById('ab-v-pic');
  const t = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, changedTouches: [t(from)], touches: [t(from)] }));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [t(to)], touches: [] }));
}, [from, to]);
await swipe(R, 80, 300);
await viewerAt(R, 'Photo 1 of 2');
ok('a swipe to the right goes back', true);
await swipe(R, 300, 80);
await viewerAt(R, 'Photo 2 of 2');
ok('a swipe to the left goes on', true);
await swipe(R, 300, 80);
ok('a swipe past the last photo stays on it', (await R.textContent('#ab-v-pos')) === 'Photo 2 of 2');
ok('SAVE TO MY PHONE is the picture this phone already holds, as a file', await R.$eval('#ab-v-save', a => !a.hidden && a.href.startsWith('blob:') && a.hasAttribute('download')));
const [dl] = await Promise.all([R.waitForEvent('download', T), R.click('#ab-v-save')]);
ok('it saves one photo, named for its caption and year', dl.suggestedFilename() === 'parwah-diwali-at-nani-s-house-1987.jpg', dl.suggestedFilename());
ok('there is no public link, no sharing outside and no "download all" anywhere in the album', !/share|public link|download all|whatsapp/i.test(await R.textContent('#ab-viewer')) && !/share|public link|download all/i.test(await R.textContent('#ab-root'))
   && (await R.$$('#ab-viewer a[href^="http"], #ab-root a[href^="http"]')).length === 0);
await R.click('#ab-v-acts [data-abuntag]');
await R.waitForFunction(() => document.getElementById('ab-v-people').textContent === 'With Nani', null, T);
ok('ROHAN TAKES HIS OWN NAME OFF: the photo now says "With Nani"', (await one(`select string_agg(m.name, ',') as s from album_people ap join members m on m.id = ap.member_id where ap.photo_id = $1`, [kept[0].id])).s === 'Nani');
await R.waitForFunction(() => !document.querySelector('#ab-v-acts [data-abuntag]'), null, T);
ok('and the button to do it is gone', true);
await R.keyboard.press('Escape');
await R.waitForSelector('#ab-viewer', { state: 'hidden', ...T });
ok('ESCAPE CLOSES, and the focus goes back to the photo that was tapped', await R.evaluate(() => document.activeElement.classList.contains('abtile')));
await R.click('#ab-grid .abtile >> nth=1');
await viewerAt(R, 'Photo 2 of 2');
await R.click('#ab-v-x');
await R.waitForSelector('#ab-viewer', { state: 'hidden', ...T });
ok('Close closes', true);

// ================================================================ 6. a photo that does not send says so on its own row, with Retry
await A.click('#ab-add');
await sheetOpen(A, 'Add photos');
await choose(A, [['small', 'chai.jpg'], ['small', 'terrace.jpg']]);
await queueIs(A, 2, 'ready');
let dropped = 0;
await A.route('**/api/book?area=album', async (route) => {
  const body = route.request().postDataJSON();
  if (body && body.action === 'photo_add' && dropped++ === 0) return route.abort();
  return route.continue();
});
await A.fill('#ab-a-cap', 'Chai on the terrace');
await A.check(`#ab-a-people [data-abwho="${rohan.id}"]`);
await A.click('#ab-a-save');
await A.waitForFunction(() => { const r = [...document.querySelectorAll('#ab-queue .abq')].map(x => x.getAttribute('data-abst')); return r.join() === 'failed,done' && !document.getElementById('ab-a-save').disabled; }, null, T);
const q2 = await queue(A);
ok('PROGRESS PER PHOTO: the first says it did not go, with Retry; the second says Saved', q2[0].st === 'failed' && q2[0].retry && /No connection\. Try again when you are back online\./.test(q2[0].text) && q2[1].st === 'done' && /Saved/.test(q2[1].text) && !q2[1].retry, JSON.stringify(q2));
ok('the sheet stays open and says what is left', await A.isVisible('#mbsheet') && /1 photo was not added\. Tap Retry beside it\./.test(await A.textContent('#mbs-err')));
ok('one of the two is in the album', (await one(`select count(*)::int as n from album_photos where caption = 'Chai on the terrace'`)).n === 1);
await design(A, '#mbsheet', 'the add sheet with one photo saved and one to retry');
await shot(A, 'album-retry');
await A.unroute('**/api/book?area=album');
await A.click('#ab-queue [data-abqretry]');
await sheetShut(A);
await toastSays(A, /2 photos added to the album/);
ok('RETRY sends it, and nothing is added twice', (await one(`select count(*)::int as n from album_photos where caption = 'Chai on the terrace'`)).n === 2);
await gridOf(A, 4);

// seven chosen at once: six go on the list
await A.click('#ab-add');
await sheetOpen(A, 'Add photos');
await choose(A, [1, 2, 3, 4, 5, 6, 7].map(i => ['small', 'p' + i + '.jpg']));
await queueIs(A, 6, 'ready');
ok('seven chosen at once: six go on the list, and it says why', /You can add 6 photos at a time\. The first 6 are on the list\./.test(await A.textContent('#mbs-err')));
await A.click('#ab-queue [data-abqdrop] >> nth=0');
await queueIs(A, 5, 'ready');
ok('one can be taken off the list before sending', true);
await A.click('#mbs-x');
await sheetShut(A);
ok('closing the sheet sends nothing', (await one(`select count(*)::int as n from album_photos`)).n === 4);

// ================================================================ 7. change a caption, then remove after being asked
await A.click(`#ab-grid .abtile:has(img[data-abimg="${kept[1].id}"])`);
await viewerAt(A, null);
ok('Asha, who added it, can change it and remove it', await A.isVisible('#ab-v-acts [data-abedit]') && await A.isVisible('#ab-v-acts [data-abdel]') && !(await A.$('#ab-v-acts [data-abuntag]')));
await A.click('#ab-v-acts [data-abedit]');
await sheetOpen(A, 'Change this photo');
ok('the form opens with what is there', (await A.inputValue('#ab-e-cap')) === 'Diwali at Nani’s house' && (await A.inputValue('#ab-e-year')) === '1987' && await A.isChecked(`#ab-e-people [data-abwho="${nani.id}"]`) && await A.isChecked(`#ab-e-people [data-abwho="${rohan.id}"]`));
await A.fill('#ab-e-cap', 'my card 4111 1111 1111 1111');
await A.click('#ab-e-save');
await A.waitForFunction(() => /card number/.test(document.getElementById('mbs-err').textContent), null, T);
ok('a card number in a caption is refused under the form, in plain words', (await one(`select caption from album_photos where id = $1`, [kept[1].id])).caption === 'Diwali at Nani’s house');
await design(A, '#mbsheet', 'changing a photo, with a refusal showing');
await A.fill('#ab-e-cap', 'Diwali, the year the lights went out');
await A.fill('#ab-e-year', '1988');
await A.uncheck(`#ab-e-people [data-abwho="${rohan.id}"]`);
await A.check(`#ab-e-people [data-abwho="${papa.id}"]`);
await A.click('#ab-e-save');
await sheetShut(A);
await A.waitForFunction(() => document.getElementById('ab-v-cap').textContent === 'Diwali, the year the lights went out' && document.getElementById('ab-v-people').textContent === 'With Nani and Papa', null, T);
const ed = await one(`select caption, taken_year, (select string_agg(m.name, ',' order by m.name) from album_people ap join members m on m.id = ap.member_id where ap.photo_id = p.id) as people from album_photos p where id = $1`, [kept[1].id]);
ok('THE CAPTION, THE YEAR AND THE PEOPLE CHANGE, and the open photo shows it', ed.caption === 'Diwali, the year the lights went out' && ed.taken_year === 1988 && ed.people === 'Nani,Papa' && /Taken in 1988/.test(await A.textContent('#ab-v-meta')), JSON.stringify(ed));
await A.click('#ab-v-acts [data-abdel]');
await A.waitForSelector('#asksheet:not([hidden])', T);
ok('REMOVING ASKS FIRST, in the app\'s own sheet', (await A.textContent('#as-q')) === 'Remove this photo?' && /cannot be brought back/.test(await A.textContent('#as-sub')) && (await A.textContent('#as-yes')) === 'Yes, remove it' && (await A.textContent('#as-no')) === 'No, keep it');
ok('the question sits on top of the photo', await A.evaluate(() => { const r = document.getElementById('as-yes').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el && el.id === 'as-yes'; }));
await design(A, '#asksheet', 'the "remove this photo?" sheet');
await A.click('#as-no');
await A.waitForSelector('#asksheet', { state: 'hidden', ...T });
ok('"No, keep it" keeps it', (await one(`select count(*)::int as n from album_photos where id = $1`, [kept[1].id])).n === 1 && await A.isVisible('#ab-viewer'));
await A.click('#ab-v-acts [data-abdel]');
await A.waitForSelector('#asksheet:not([hidden])', T);
await A.click('#as-yes');
await toastSays(A, /Photo removed/);
await A.waitForFunction(() => document.querySelectorAll('#ab-grid .abtile').length === 3, null, T);
ok('"Yes, remove it" removes the photo and its bytes', (await one(`select count(*)::int as n from album_photos where id = $1`, [kept[1].id])).n === 0 && (await one(`select count(*)::int as n from album_bytes where photo_id = $1`, [kept[1].id])).n === 0);
ok('the viewer moves to the next photo, and the count goes down', await A.isVisible('#ab-viewer') && (await A.textContent('#ab-count')) === '3 of 400 photos, for the whole family.');
await A.click('#ab-v-x');
await A.waitForSelector('#ab-viewer', { state: 'hidden', ...T });

// ================================================================ 8. an album only for me
await A.click('#ab-new');
await sheetOpen(A, 'New album');
ok('a new album starts as the whole family\'s, and says what that means', await A.$eval('#ab-al-aud [data-abaud="family"]', b => b.getAttribute('aria-pressed') === 'true') && /Everyone in this family can see these photos and add their own\./.test(await A.textContent('#ab-al-note'))
   && await A.$$eval('#ab-al-aud button', bs => bs.map(b => b.textContent).join('|')) === 'Whole family|People I choose|Only me');
await A.click('#ab-al-save');
await A.waitForFunction(() => /Give the album a name/.test(document.getElementById('mbs-err').textContent), null, T);
ok('an album with no name is refused under the form', (await one(`select count(*)::int as n from album_albums`)).n === 1);
await A.fill('#ab-al-name', 'Letters I kept');
await A.fill('#ab-al-year', '2001');
await A.click('#ab-al-aud [data-abaud="chosen"]');
await A.waitForSelector('#ab-al-who:not([hidden])', T);
ok('"People I choose" lists the people on Parwah to tick, not Nani', (await A.$$('#ab-al-who [data-abwho]')).length === 2 && !/Nani/.test(await A.textContent('#ab-al-who')) && /Only you and the people you tick/.test(await A.textContent('#ab-al-note')));
await design(A, '#mbsheet', 'a new album, choosing who can see it');
await shot(A, 'album-new');
await A.click('#ab-al-aud [data-abaud="me"]');
await A.waitForSelector('#ab-al-who', { state: 'hidden', ...T });
ok('"Only me" says what it means', (await A.textContent('#ab-al-note')) === 'Only you can see these photos.');
await A.click('#ab-al-save');
await sheetShut(A);
const priv = await one(`select id, audience, year, by_member from album_albums where name = 'Letters I kept'`);
ok('ASHA MAKES AN ALBUM ONLY FOR HER, with a year', priv && priv.audience === 'me' && priv.year === 2001 && priv.by_member === asha.id, JSON.stringify(priv));
await A.waitForFunction((id) => document.getElementById('ab-f-album').value === id && !document.getElementById('ab-albumbar').hidden, priv.id, T);
ok('the album opens, saying who it is for, with its maker\'s buttons', /Letters I kept/.test(await A.textContent('#ab-albumbar')) && /2001 · Only me · 0 photos · Made by you/.test(await A.textContent('#ab-albumbar'))
   && await A.isVisible('#ab-albumbar [data-abaledit]') && await A.isVisible('#ab-albumbar [data-abaldel]') && /No photos here yet/.test(await A.textContent('#ab-state')));
await design(A, '#ab-root', 'an album of my own, empty');
await A.click('#ab-add');
await sheetOpen(A, 'Add photos');
ok('adding from inside an album adds to that album', /Letters I kept \(only me\)/.test(await A.$eval('#ab-a-album', s => s.selectedOptions[0].textContent)));
await choose(A, [['small', 'letter.jpg']]);
await queueIs(A, 1, 'ready');
await A.fill('#ab-a-cap', 'A letter from Bombay');
await A.fill('#ab-a-year', '1990');
await A.check(`#ab-a-people [data-abwho="${rohan.id}"]`);
await A.click('#ab-a-save');
await sheetShut(A);
await gridOf(A, 1);
const secret = await one(`select id from album_photos where album_id = $1`, [priv.id]);
ok('her private photo is kept, and she sees it', !!secret && (await A.$eval('#ab-grid .abtile img', im => im.getAttribute('data-abimg'))) === secret.id);
ok('a private album stays out of the family feed', (await one(`select count(*)::int as n from events where text like '%Letters I kept%'`)).n === 0);

// Rohan is tagged in it, and still must not see it anywhere.
await R.reload(); await home(R);
await album(R);
await gridOf(R, 3);
ok('ROHAN\'S LIST has neither the album nor the photo', !(await R.$$eval('#ab-f-album option', os => os.map(o => o.textContent).join('|'))).includes('Letters') && !(await R.$(`#ab-grid img[data-abimg="${secret.id}"]`)) && !/Bombay/.test(await R.content()));
const direct = await R.evaluate(async ([code, me, token, id]) => {
  const out = {};
  for (const size of ['thumb', 'full']) {
    const r = await fetch(`/api/book?area=album&view=photo&size=${size}&id=${id}&circle=${code}&member=${me}`, { headers: { 'X-Parwah-Token': token } });
    out[size] = { status: r.status, type: r.headers.get('Content-Type'), len: (await r.arrayBuffer()).byteLength };
  }
  const anon = await fetch(`/api/book?area=album&view=photo&size=full&id=${id}&circle=${code}&member=${me}`);
  out.anon = anon.status;
  const img = new Image(); img.src = `/api/book?area=album&view=photo&size=full&id=${id}&circle=${code}&member=${me}`;
  out.tag = await new Promise(r => { img.onload = () => r('loaded'); img.onerror = () => r('refused'); });
  return out;
}, ['KAPOOR', rohan.id, rohan.token, secret.id]);
ok('HE CANNOT FETCH IT BY ITS ADDRESS, thumbnail or full, signed in as himself', direct.thumb.status === 404 && direct.full.status === 404 && !/image/.test(direct.thumb.type) && !/image/.test(direct.full.type) && direct.full.len < 200, JSON.stringify(direct));
ok('and with no sign-in the address gives nothing, even as a plain picture on a page', direct.anon === 401 && direct.tag === 'refused', JSON.stringify(direct));
const own = await A.evaluate(async ([code, me, token, id]) => {
  const r = await fetch(`/api/book?area=album&view=photo&size=full&id=${id}&circle=${code}&member=${me}`, { headers: { 'X-Parwah-Token': token } });
  return { status: r.status, type: r.headers.get('Content-Type'), cache: r.headers.get('Cache-Control'), len: (await r.arrayBuffer()).byteLength };
}, ['KAPOOR', asha.id, asha.token, secret.id]);
ok('Asha gets hers, as image/jpeg, with Cache-Control: private', own.status === 200 && own.type === 'image/jpeg' && /^private\b/.test(own.cache) && own.len > 1000, JSON.stringify(own));
await openPerson(R, rohan.id);
await R.waitForSelector('#ab-pp-card:not([hidden])', T);
await gridOf(R, 2, '#ab-pp-grid');
ok('on his own page Rohan sees "Photos with me": the two he may see, not the private one he is tagged in', (await R.textContent('#ab-pp-h')) === 'Photos with me' && !(await R.$(`#ab-pp-grid img[data-abimg="${secret.id}"]`))
   && (await one(`select count(*)::int as n from album_people where member_id = $1`, [rohan.id])).n === 3);

// ================================================================ 9. Today: one older photo a week
await R.evaluate(() => { location.hash = '#home'; });
await R.waitForSelector('#ab-today .crow', T);
await R.waitForFunction(() => { const im = document.querySelector('#ab-today img'); return im && !im.hidden && im.naturalWidth > 0; }, null, T);
const rToday = await R.textContent('#ab-today');
ok('ROHAN\'S TODAY: "A photo from 1987", with its caption and its picture', /A photo from 1987/.test(rToday) && /Diwali at Nani’s house/.test(rToday) && await R.isVisible('#ab-today [data-abtoday="see"]') && await R.isVisible('#ab-today [data-abtoday="hide"]'), rToday);
ok('it is one he may see: never Asha\'s private photo from 1990', (await one(`select photo_id from album_weeks where member_id = $1`, [rohan.id])).photo_id === kept[0].id);
await R.$eval('#ab-today', el => el.scrollIntoView({ block: 'center' }));
await design(R, '#ab-today', 'the Today row');
await shot(R, 'album-today');
await R.click('#ab-today [data-abtoday="see"]');
await viewerAt(R, '');
ok('See it opens that photo', (await R.textContent('#ab-v-cap')) === 'Diwali at Nani’s house' && !(await R.isVisible('#ab-v-nav')));
await R.click('#ab-v-x');
await R.waitForSelector('#ab-viewer', { state: 'hidden', ...T });
await R.reload(); await home(R);
await R.waitForSelector('#ab-today .crow', T);
ok('it is the same photo after a reload: one a week', /A photo from 1987/.test(await R.textContent('#ab-today')) && (await one(`select count(*)::int as n from album_weeks where member_id = $1`, [rohan.id])).n === 1);
await Promise.all([R.waitForResponse(r => r.url().includes('area=album') && r.request().method() === 'POST', T), R.click('#ab-today [data-abtoday="hide"]')]);
ok('"Not now" puts it away', (await R.textContent('#ab-today')).trim() === '' && (await one(`select status from album_weeks where member_id = $1`, [rohan.id])).status === 'hidden');
const [again] = await Promise.all([R.waitForResponse(r => r.url().includes('area=album') && r.url().includes('view=today'), T), R.reload()]);
const againJson = await again.json();
await home(R);
await R.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
ok('and it does not come back this week', againJson.ok === true && againJson.pick === null && (await R.textContent('#ab-today')).trim() === '', JSON.stringify(againJson).slice(0, 200) + ' | ' + await R.textContent('#ab-today'));

// ================================================================ 10. senior mode
const P = await phone(papa, { big: true });
ok('Papa is in senior mode', await P.evaluate(() => document.body.classList.contains('senior')));
await album(P);
await gridOf(P, 3);
await design(P, '#ab-root', 'the album, senior mode');
await P.click('#ab-grid .abtile >> nth=2');
await viewerAt(P, 'Photo 3 of 3');
ok('Papa, who added nothing, can look and save, and is offered nothing else', await P.isVisible('#ab-v-save') && (await P.$$('#ab-v-acts button')).length === 0);
await design(P, '#ab-viewer', 'one photo, senior mode');
await P.keyboard.press('Escape');
await P.waitForSelector('#ab-viewer', { state: 'hidden', ...T });

// ================================================================ 11. near the limit, and at it
await ensureAlbumSchema(db());
const defAlbum = (await one(`select id from album_albums where circle_id = $1 and is_default`, [fam])).id;
const TINY = '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAMABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAhEAABAwQCAwEAAAAAAAAAAAARAQQSAgMTFAAGBTFRcf/EABQBAQAAAAAAAAAAAAAAAAAAAAf/xAAhEQABAgQHAAAAAAAAAAAAAAATABIDBBSBESEiI1FSsf/aAAwDAQACEQMRAD8Ao+7dgdeC0tS3YrzTllpVQIgBU+rx0nsDrzu7t27FGGEcVKoTIkqvxOUDtk1eQ221i/Axy20qB9g/icNGTVnPUbWLExLFbSkj0R+rwvq5ShALd7Xx8ySESEFjdXN1/9k=';
ok('the filler picture is a real JPEG', !!jpegInfo(Buffer.from(TINY, 'base64')));
async function fillTo(target) {
  const have = (await one(`select count(*)::int as n from album_photos where circle_id = $1`, [fam])).n;
  for (let i = have; i < target; i++) {
    const id = (await one(`insert into album_photos (circle_id, album_id, by_member, caption, width, height, photo_bytes, thumb_bytes, created_at)
                           values ($1,$2,$3,$4,16,12,600,600, now() - interval '900 days' + ($5 || ' minutes')::interval) returning id`, [fam, defAlbum, asha.id, 'Old photo ' + i, String(i)])).id;
    await albumPutBytes(db(), id, TINY, TINY);
  }
}
await fillTo(372);
photoGets.length = 0;
await A.reload(); await home(A);
await album(A, '#ab-near:not([hidden])');
await A.waitForFunction(() => document.querySelectorAll('#ab-grid .abtile').length === 372, null, T);
ok('NEAR THE LIMIT it says so, plainly, with the count', (await A.textContent('#ab-near b')) === 'The album is nearly full: 372 of 400 photos. You can add 28 more.' && await A.isVisible('#ab-near [data-abold]'));
ok('Asha\'s grid has every photo she may see: 372 in all albums', (await A.$$('#ab-grid .abtile')).length === 372);
await A.waitForFunction(() => { const first = document.querySelector('#ab-grid .abtile img'); return first && first.getAttribute('data-abst') === 'ok'; }, null, T);
const asked = await A.$$eval('#ab-grid .abtile img', ims => ims.filter(im => im.getAttribute('data-abst')).length);
ok('THE GRID IS LAZY: with 372 photos, only the ones near the screen are fetched (' + asked + ' asked for)', asked > 0 && asked < 80 && photoGets.length < 80, asked + ' in the page, ' + photoGets.length + ' at the server');
ok('every tile is the same fixed square, picture or no picture yet', await A.$$eval('#ab-grid .abtile', ts => { const w = ts[0].getBoundingClientRect().width; return ts.every(t => { const r = t.getBoundingClientRect(); return Math.abs(r.width - w) < 1 && Math.abs(r.height - w) < 1; }); }));
await design(A, '#ab-root', 'the album, nearly full');
await shot(A, 'album-near');
await fillTo(400);
await A.click('#ab-add');
await sheetOpen(A, 'Add photos');
await choose(A, [['small', 'one-more.jpg']]);
await queueIs(A, 1, 'ready');
await A.click('#ab-a-save');
await A.waitForSelector('#ab-a-full:not([hidden])', T);
const fullRow = (await queue(A))[0];
ok('AT THE LIMIT adding is refused on the photo\'s own row, in plain words', fullRow.st === 'failed' && /The album is full: 400 photos\. Remove some older ones to add more\./.test(fullRow.text), fullRow.text);
ok('the sheet says the same, and offers the way out', /The album is full, so 1 photo was not added\. Remove some older ones to make room\./.test(await A.textContent('#mbs-err')) && await A.isVisible('#ab-a-full [data-abold]'));
ok('nothing went past 400', (await one(`select count(*)::int as n from album_photos where circle_id = $1`, [fam])).n === 400);
await design(A, '#mbsheet', 'the add sheet when the album is full');
await A.click('#ab-a-full [data-abold]');
await sheetShut(A);
await A.waitForFunction(() => /Oldest first\. Only the photos you may remove are shown\./.test(document.getElementById('ab-state').textContent), null, T);
await A.waitForFunction(() => /400 of 400/.test(document.getElementById('ab-near').textContent), null, T);
const oldestAlt = await A.$eval('#ab-grid .abtile img', im => im.alt);
ok('"Show the oldest photos I can remove" puts the oldest first', oldestAlt === 'Old photo 4' && (await A.textContent('#ab-near b')) === 'The album is full: 400 of 400 photos. Remove some older ones to add more.', oldestAlt);
await A.click('#ab-grid .abtile >> nth=0');
await viewerAt(A, null);
await A.click('#ab-v-acts [data-abdel]');
await A.waitForSelector('#asksheet:not([hidden])', T);
await A.click('#as-yes');
await A.waitForFunction(() => /399 of 400/.test(document.getElementById('ab-near').textContent), null, T);
ok('removing one makes room, and the count says so', (await A.textContent('#ab-near b')) === 'The album is nearly full: 399 of 400 photos. You can add 1 more.');
await A.click('#ab-v-x');
await A.waitForSelector('#ab-viewer', { state: 'hidden', ...T });
await A.click('#ab-state [data-abold="0"]');
await A.waitForFunction(() => !/Oldest first/.test(document.getElementById('ab-state').textContent), null, T);
ok('"Back to all photos" goes back to newest first', true);

// ================================================================ 12. removing an album
await A.selectOption('#ab-f-album', priv.id);
await A.waitForSelector('#ab-albumbar [data-abaldel]', T);
await A.click('#ab-albumbar [data-abaldel]');
await A.waitForSelector('#asksheet:not([hidden])', T);
ok('removing an album asks first, and says how many photos go with it', (await A.textContent('#as-q')) === 'Remove the album Letters I kept?' && /Its 1 photo goes with it/.test(await A.textContent('#as-sub')));
await A.click('#as-yes');
await toastSays(A, /Album removed/);
ok('the album and its photo are gone', (await one(`select count(*)::int as n from album_albums where id = $1`, [priv.id])).n === 0 && (await one(`select count(*)::int as n from album_photos where id = $1`, [secret.id])).n === 0);

// ================================================================ 13. offline, and a server error
const OFF = await phone(asha, { block: route => route.abort() });
await album(OFF, '#ab-state [data-abretry]');
ok('OFFLINE: said in plain words, with a way to try again', /You are offline\. The album will show when you are back online\./.test(await OFF.textContent('#ab-state')) && await OFF.isVisible('#ab-state [data-abretry]') && !(await OFF.isVisible('#ab-tools')));
await design(OFF, '#ab-root', 'the album, offline');
await OFF.unroute('**/api/book?area=album**');
await OFF.click('#ab-state [data-abretry]');
await OFF.waitForSelector('#ab-tools:not([hidden])', T);
ok('Try again loads it once the connection is back', (await OFF.$$('#ab-grid .abtile')).length > 0);
const ERR = await phone(asha, { block: route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'relation "album_photos" does not exist' }) }) });
await album(ERR, '#ab-state [data-abretry]');
const errText = await ERR.textContent('#ab-state');
ok('A SERVER ERROR is a plain sentence, never the database\'s words', /Could not load the album\. Try again in a moment\./.test(errText) && !/relation|does not exist/.test(await ERR.textContent('#ab-root')), errText);
ok('Today is quiet about it: no row, no error', (await ERR.textContent('#ab-today')).trim() === '');

ok('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) { console.error(`album.e2e: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`album.e2e: ${pass}/${pass} checks pass`);
