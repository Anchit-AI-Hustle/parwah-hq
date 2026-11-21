// DADI'S LINK against a real database, through the real handlers
// (/api/events, /api/chats, /api/book, /api/plans, /api/care, /api/circle).
//
// Dadi is in the Sharma family by name only. Rohan, an adult, makes her a
// link. What this proves, in the order of the brief:
//   I1. only a HASH of a long random key is stored; one link per person; it
//       runs out after 90 days and can be kept on; any adult turns it off,
//       and so can she; the family is told once; making one and every
//       action on the page is limited, and a limiter that cannot count says
//       no; a wrong, old or turned-off key gets one plain answer.
//   I2. the page: "I am fine" once a day (and the daily check-in), what the
//       family sent HER and nothing else, answering back, a blessing, the
//       weekly question, HER vote, "Call me", and the family's own SOS.
//   I3. consent first; "I do not want this" turns it off and tells the adult
//       kindly; she deletes what she sent; nobody remembered has a link; a
//       child can neither make one nor turn one off.
//   I4. it closes when she joins with "This is me", and what she sent stays.
//   Security: every read and write is tied to her AND her family. Another
//   family's key, and an id borrowed from someone else, get nothing.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('eldlink.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('eldlink.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const webpush = (await import('web-push')).default;
const pushed = [];
webpush.sendNotification = async (sub, body) => { pushed.push({ to: sub.endpoint.split('/').pop(), body: JSON.parse(body) }); return {}; };

const api = {};
for (const n of ['chats', 'plans', 'book', 'events', 'care', 'circle']) api[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { ensurePushSchema } = await import('../../../api/_push.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const Bond = await import('../../../api/_bond.mjs');
const Eld = await import('../../../api/_eldlink.mjs');
const R = await import('../../../api/_eldlinkrules.mjs');
const { quietSweep } = await import('../../../api/_familycare.mjs');
const { wallIn } = await import('../../../api/_rememberrules.mjs');
const { createHash } = await import('node:crypto');
const sql = db();
await ensureSchema(sql); await ensurePushSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

let n = 0;
async function call(handler, { method = 'POST', body = {}, query = {}, token, headers = {} }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-parwah-tz': 'Asia/Kolkata', 'x-forwarded-for': '10.9.' + (++n % 250) + '.' + (n % 199), ...headers }, query, body };
  let status = 200, json = null; const head = {};
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader(k, v) { head[k.toLowerCase()] = v; return this; }, end() { return this; } };
  await handler(req, res);
  return { ...(json || {}), status, head };
}
await call(api.plans, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });
await Bond.ensureBondSchema(sql); await Eld.ensureEldSchema(sql);
async function user(name) {
  const phone = '+9198760' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}
async function seat(circleId, code, u, role = 'family', dob = null, phone = null) {
  const m = (await admin.query(`insert into members (circle_id, name, user_id, role, dob, phone, phone_cc) values ($1,$2,$3,$4,$5,$6,'+91') returning id`,
    [circleId, u.name, u.userId || null, role, dob, phone || u.phone || null])).rows[0];
  if (u.userId) await admin.query(`insert into push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')`,
    [m.id, 'https://fcm.googleapis.com/fcm/send/' + m.id]);
  return { id: m.id, name: u.name, token: u.token, code, userId: u.userId };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const fam2 = (await admin.query(`insert into circles (code, name) values ('VERMA9','Verma Family') returning id`)).rows[0].id;
const U = { rohan: await user('Rohan'), meena: await user('Meena'), kabir: await user('Kabir'), asha: await user('Asha'), dadiLater: await user('Dadi') };
const rohan = await seat(fam, 'SHARMA', U.rohan, 'family', '1988-03-04'), meena = await seat(fam, 'SHARMA', U.meena, 'family', '1990-07-09');
const kabir = await seat(fam, 'SHARMA', U.kabir, 'family', '2013-05-05');
const dadi = await seat(fam, 'SHARMA', { name: 'Dadi' }, 'parent', '1946-02-02', '+919811100001');
const dadaji = await seat(fam, 'SHARMA', { name: 'Dadaji' }, 'parent', '1940-01-01');
await admin.query(`update members set remembered = true where id = $1`, [dadaji.id]);
const asha = await seat(fam2, 'VERMA9', U.asha, 'family', '1985-01-01');
const nani = await seat(fam2, 'VERMA9', { name: 'Nani' }, 'parent', '1944-01-01', '+919811100002');
const today = wallIn(Date.now(), 'Asia/Kolkata').date;

const E = (who, action, body = {}) => call(api.events, { token: who.token, query: { area: 'eldlink' }, body: { area: 'eldlink', code: who.code, memberId: who.id, action, ...body } });
const EG = (who) => call(api.events, { method: 'GET', token: who.token, query: { area: 'eldlink', circle: who.code, member: who.id } });
const page = (key, op, body = {}, headers = {}) => call(api.events, { query: { area: 'eldlink' }, body: { area: 'eldlink', op, tz: 'Asia/Kolkata', ...body }, headers: { 'x-parwah-link': key, ...headers } });
const keyOf = (r) => r.path.split('#k=')[1];
const count = async (q, p) => (await admin.query(q, p)).rows[0].n;
const feed = async (c = fam) => (await admin.query(`select text from events where circle_id = $1 order by created_at`, [c])).rows.map(r => r.text || '');
const to = (who) => pushed.filter(p => p.to === who.id);
const VOICE = 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC';
const clearRate = (like = 'eld%') => admin.query(`delete from rate_limit where bucket like $1`, [like]);

// ================================================================ I1. making the link
let key;
{
  let r = await E(kabir, 'eld_make', { personId: dadi.id });
  ok('I3. a child cannot make a link (the one adult rule)', r.status === 403 && /adult/i.test(r.error), JSON.stringify(r));
  r = await E(rohan, 'eld_make', { personId: dadaji.id });
  ok('I3. someone remembered can never have a link: the server refuses', r.status === 400 && /remembered/.test(r.error), JSON.stringify(r));
  r = await E(rohan, 'eld_make', { personId: meena.id });
  ok('I1. someone on Parwah has the app, not a link', r.status === 400 && /on Parwah already/.test(r.error));
  r = await E(rohan, 'eld_make', { personId: nani.id });
  ok('I1. a person in another family cannot be given a link from here', r.status === 404, JSON.stringify(r));
  r = await E(asha, 'eld_make', { personId: dadi.id });
  ok('I1. and an adult of another family cannot make one for Dadi', r.status === 404);
  r = await call(api.events, { token: asha.token, query: { area: 'eldlink' }, body: { area: 'eldlink', code: 'SHARMA', memberId: rohan.id, action: 'eld_make', personId: dadi.id } });
  ok('I1. nor by naming Rohan as the caller: the session decides who is asking', r.status === 403, JSON.stringify(r));

  pushed.length = 0;
  r = await E(rohan, 'eld_make', { personId: dadi.id });
  key = keyOf(r);
  ok('I1. Rohan makes Dadi\'s link: a path that ends in a key after the #', r.status === 201 && /^\/apna\/#k=[A-Za-z0-9_-]{43}$/.test(r.path) && r.fresh === false, JSON.stringify(r));
  ok('I1. the key is 256 bits from the secure source (43 base64url characters)', R.tokenShape(key) && Buffer.from(key, 'base64url').length === 32);
  ok('I1. her number comes back as digits only, for a wa.me address the app builds', r.digits === '919811100001' && /^Namaste Dadi, Rohan here\./.test(r.words));
  const row = (await admin.query(`select * from eld_links where member_id = $1`, [dadi.id])).rows[0];
  ok('I1. ONLY A HASH IS STORED: the key itself is in no column of the row', row.token_hash === createHash('sha256').update(key).digest('hex') && !JSON.stringify(row).includes(key));
  ok('I1. it is tied to her, her family and who made it, and runs out in 90 days', row.member_id === dadi.id && row.circle_id === fam && row.created_by === rohan.id
    && Math.abs(new Date(row.expires_at) - Date.now() - 90 * 86400000) < 60000 && row.last_used_at === null && row.consent_at === null);
  ok('I1. the family is told once that it exists (a feed line)', (await feed()).filter(t => /Rohan set up Dadi's link/.test(t)).length === 1, JSON.stringify(await feed()));
  ok('I1. the key is in no feed line, no push and no event', !(await feed()).join(' ').includes(key) && !JSON.stringify(pushed).includes(key));
  ok('I1. Rohan is the first person she can call (his own number, which he may see)', JSON.stringify(row.contacts) === JSON.stringify([rohan.id]));

  // One link per person: a second "make" is a fresh key for the same row.
  const r2 = await E(meena, 'eld_make', { personId: dadi.id });
  ok('I1. ONE LINK PER PERSON: a second make gives a fresh key on the same row', r2.status === 201 && r2.fresh === true && keyOf(r2) !== key
    && (await count(`select count(*)::int as n from eld_links where member_id = $1`, [dadi.id])) === 1);
  ok('I1. the old key stops working at once', (await page(key, 'open')).status === 404);
  ok('I1. and the family is not told a second time', (await feed()).filter(t => /set up Dadi's link/.test(t)).length === 1);
  key = keyOf(r2);
  ok('I1. the database refuses a second link that is on for one person', await admin.query(`insert into eld_links (circle_id, member_id, token_hash, expires_at) values ($1,$2,'x', now() + interval '1 day')`, [fam, dadi.id]).then(() => false, e => e.code === '23505'));

  const g = await EG(kabir);
  ok('I4. everyone in the family sees that the link is on; only an adult is offered the controls', g.status === 200 && g.adult === false && g.links.length === 1 && g.links[0].memberId === dadi.id && g.links[0].state === 'on' && g.links[0].agreed === false && g.callable.length === 0);
  ok('I4. an adult sees who she can be given to call', (await EG(rohan)).adult === true && (await EG(rohan)).callable.some(c => c.id === meena.id));
  ok('I1. another family sees nothing of it', (await EG(asha)).links.length === 0);
}

// ================================================================ a key that is not on
{
  const bad = await page('A'.repeat(43), 'open');
  const junk = await page('not-a-key', 'open');
  const none = await call(api.events, { query: { area: 'eldlink' }, body: { area: 'eldlink', op: 'open' } });
  ok('I1. a wrong key, a malformed one and no key at all get the SAME plain answer', bad.status === 404 && junk.status === 404 && none.status === 404 && bad.error === junk.error && junk.error === none.error && bad.off === true);
  ok('I1. it names no family and no person, and is not an error dump', !/Sharma|Dadi|Rohan|sql|stack|relation|ref /i.test(JSON.stringify(bad)) && /not on now/.test(bad.error));
  ok('I1. the page API tells browsers to keep and send nothing: no-store, no-referrer, noindex', bad.head['cache-control'] === 'no-store' && bad.head['referrer-policy'] === 'no-referrer' && bad.head['x-robots-tag'] === 'noindex');
  ok('I1. a GET with a key is refused: the key never travels in an address', (await call(api.events, { method: 'GET', query: { area: 'eldlink' }, headers: { 'x-parwah-link': key } })).status === 405);
  // Guessing is limited by address, and the limiter fails closed.
  await clearRate();
  let last = null;
  for (let i = 0; i < 31; i++) last = await page('B'.repeat(43), 'open', {}, { 'x-forwarded-for': '10.77.0.1' });
  ok('I1. wrong keys from one address are limited (30 in ten minutes), with kind words', last.status === 429 && last.wait === true && /wait a few minutes/.test(last.error), JSON.stringify(last));
  await clearRate();
}

// ================================================================ I3. consent first
{
  let s = await page(key, 'open');
  ok('I3. the first open says who set it up and what the family can see, in both languages, and nothing else', s.status === 200 && s.agreed === false && s.setBy === 'Rohan' && s.me.first === 'Dadi'
    && s.sees.length === 4 && s.sees.every(x => /[ऀ-ॿ]/.test(x.hi) && x.en) && s.items === undefined && s.people === undefined && s.contacts === undefined, JSON.stringify(s).slice(0, 300));
  for (const op of ['ok', 'bless', 'say', 'sawaal', 'vote', 'callme', 'sos', 'mine', 'photo', 'card', 'audio']) {
    const r = await page(key, op, { to: 'all', line: 'khush' });
    if (r.status !== 403 || !r.consent) ok('I3. before "All right", ' + op + ' is refused', false, JSON.stringify(r));
  }
  ok('I3. before "All right" nothing else happens: no check-in, no blessing, no SOS', (await count(`select count(*)::int as n from events where member_id = $1`, [dadi.id])) === 0
    && (await count(`select count(*)::int as n from sos where member_id = $1`, [dadi.id])) === 0);
  s = await page(key, 'consent', { yes: true });
  ok('I3. "All right" opens her page', s.status === 200 && s.agreed === true && Array.isArray(s.people) && s.okToday === false);
  ok('I1. last used is written down', (await admin.query(`select last_used_at, consent_at from eld_links where member_id = $1`, [dadi.id])).rows[0].last_used_at !== null);
  ok('I4. the family sees she has agreed', (await EG(rohan)).links[0].agreed === true && (await EG(rohan)).links[0].lastUsedAt !== null);
}

// ================================================================ I2 (a) "I am fine"
{
  pushed.length = 0;
  let r = await page(key, 'ok');
  ok('I2a. "I am fine": the family has been told', r.status === 201 && r.told === true);
  const ev = (await admin.query(`select type, text from events where member_id = $1 and type = 'checkin'`, [dadi.id])).rows;
  ok('I2a. it is a real check-in under her own name, marked "from Dadi\'s link"', ev.length === 1 && ev[0].text === "from Dadi's link");
  ok('I2a. with no daily check-in set, everyone on the app hears "Dadi said: I am fine"', [rohan, meena, kabir].every(m => to(m).some(p => /Dadi said: I am fine/.test(p.body.title))), JSON.stringify(pushed.map(p => p.body.title)));
  r = await page(key, 'ok');
  ok('I2a. ONCE A DAY: a second tap changes nothing and tells nobody again', r.status === 200 && r.already === true && (await count(`select count(*)::int as n from events where member_id = $1 and type = 'checkin'`, [dadi.id])) === 1
    && to(rohan).filter(p => /I am fine/.test(p.body.title)).length === 1);
  ok('I2a. the page shows it as done', (await page(key, 'open')).okToday === true);

  // The daily check-in: the family asks, she answers on her own page.
  pushed.length = 0;
  r = await call(api.events, { token: rohan.token, body: { code: 'SHARMA', memberId: rohan.id, type: 'quiet_ask', targetId: dadi.id, checkinBy: '11:00' } });
  ok('I2a. the family can ask Dadi for a daily check-in time, because her link is on', r.status === 200 && r.onLink === true, JSON.stringify(r));
  r = await call(api.events, { token: asha.token, body: { code: 'VERMA9', memberId: asha.id, type: 'quiet_ask', targetId: nani.id, checkinBy: '11:00' } });
  ok('I2a. someone with no link still cannot be asked (unchanged)', r.status === 400 && /is not on Parwah, so cannot check in here/.test(r.error));
  let s = await page(key, 'open');
  ok('I2a. her page shows the question, with who asked and the time', s.checkin.ask && s.checkin.ask.by === '11:00' && s.checkin.ask.from === 'Rohan' && s.checkin.by === null);
  r = await page(key, 'checkin', { yes: true });
  ok('I2a. her own yes turns it on; the asker is told', r.status === 200 && r.by === '11:00' && to(rohan).some(p => /Dadi said yes to the daily check-in/.test(p.body.title))
    && (await admin.query(`select checkin_by from members where id = $1`, [dadi.id])).rows[0].checkin_by === '11:00');
  // Tomorrow at 11:31 with no tap: the family is told once. With a tap: silence.
  const tomorrow = new Date(Date.now() + 86400000);
  const day2 = wallIn(tomorrow.getTime(), 'Asia/Kolkata').date;
  const at = new Date(day2 + 'T06:01:00Z').getTime() + 31 * 60000;       // 11:31 + in India
  pushed.length = 0;
  const sent = await quietSweep(sql, fam, at);
  ok('I2a. a day with no "I am fine" by her time tells the family, as for anyone', sent >= 1 && to(rohan).some(p => /Dadi has not checked in today/.test(p.body.title)), JSON.stringify(pushed.map(p => p.body.title)));
  await admin.query(`update members set quiet_alerted_for = null, quiet_nudged_for = null where id = $1`, [dadi.id]);
  await admin.query(`insert into events (circle_id, member_id, type, text, created_at) values ($1,$2,'checkin','from Dadi''s link',$3)`, [fam, dadi.id, new Date(at - 3600000)]);
  pushed.length = 0;
  ok('I2a. her tap on the page COUNTS as that day\'s sign of life: nobody is alerted', (await quietSweep(sql, fam, at)) === 0 && pushed.length === 0);
  await admin.query(`delete from events where member_id = $1 and created_at > now() + interval '1 hour'`, [dadi.id]);
  // With a check-in set, "I am fine" is quiet: a feed line, no push to everyone.
  await admin.query(`delete from eld_days where member_id = $1`, [dadi.id]);
  pushed.length = 0;
  r = await page(key, 'ok');
  ok('I2a. with a check-in set, the tap is recorded and nobody is pushed', r.status === 201 && pushed.length === 0);
  r = await page(key, 'checkin', { stop: true });
  ok('I2a. she can stop the daily check-in herself', r.status === 200 && (await admin.query(`select checkin_by from members where id = $1`, [dadi.id])).rows[0].checkin_by === null);
}

// ================================================================ I2 (b) what the family sent HER
const H = (who, action, body = {}) => call(api.chats, { token: who.token, body: { area: 'heard', code: who.code, memberId: who.id, action, ...body } });
const AS = (who, action, body = {}) => call(api.chats, { token: who.token, body: { area: 'ashirwad', code: who.code, memberId: who.id, action, ...body } });
const P = (who, action, body = {}) => call(api.plans, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const A = (who, action, body = {}) => call(api.book, { token: who.token, query: { area: 'album' }, body: { area: 'album', code: who.code, memberId: who.id, action, ...body } });
const AG = (who) => call(api.book, { method: 'GET', token: who.token, query: { area: 'album', circle: who.code, member: who.id } });
const C = (who, action, body = {}) => call(api.chats, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const CG = (who, query = {}) => call(api.chats, { method: 'GET', token: who.token, query: { circle: who.code, member: who.id, ...query } });
function makeJpeg(w, h, size) {
  const head = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xC0, 0x00, 0x0B, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xFF, 0xDA, 0x00, 0x08, 1, 1, 0, 0, 0x3F, 0];
  return Buffer.from([...head, ...new Array(Math.max(4, size - head.length - 2)).fill(0x11), 0xFF, 0xD9]).toString('base64');
}
let blessAll, thanks, thanksOther, card, cardOther, famPhoto, privPhoto, chosenPhoto, poll, pollPrivate;
{
  // Sent to her, or to everyone.
  let r = await AS(rohan, 'bless', { to: 'all', line: 'khush' }); blessAll = r.id;
  r = await AS(rohan, 'bless', { to: meena.id, line: 'proud' }); const blessMeena = r.id;
  r = await H(meena, 'shukriya_send', { toId: dadi.id, line: 'Thank you for the pickle, Dadi', audience: 'two' }); thanks = r.id;
  r = await H(meena, 'shukriya_send', { toId: rohan.id, line: 'A private thank you to Rohan', audience: 'two' }); thanksOther = r.id;
  r = await P(rohan, 'bond_card_start', { forMember: dadi.id, occasion: 'birthday', date: today, title: "Dadi's birthday" }); card = r.id;
  await P(rohan, 'bond_card_add', { cardId: card, kind: 'text', text: 'Pranam Dadi, janamdin mubarak' });
  await P(meena, 'bond_card_add', { cardId: card, kind: 'voice', mime: 'audio/webm', data: 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC', seconds: 3 });
  r = await P(rohan, 'bond_card_start', { forMember: meena.id, occasion: 'birthday', date: today, title: "Meena's birthday" }); cardOther = r.id;
  await P(rohan, 'bond_card_add', { cardId: cardOther, kind: 'text', text: 'For Meena only' });
  const tomorrow = wallIn(Date.now() + 86400000, 'Asia/Kolkata').date;
  r = await P(rohan, 'bond_card_start', { forMember: dadi.id, occasion: 'other', date: tomorrow, title: 'A surprise for tomorrow' }); const sealed = r.id;
  await P(rohan, 'bond_card_add', { cardId: sealed, kind: 'text', text: 'Not yet' });
  // Photos: one in the whole-family album, one private, one "chosen" that names her.
  const albums = await AG(rohan); const famAlbum = albums.albums.find(a => a.isDefault).id;
  await A(rohan, 'photo_add', { albumId: famAlbum, photos: [{ photo: makeJpeg(1600, 1200, 5000), thumb: makeJpeg(320, 240, 900) }], caption: 'Shimla, 1987' });
  famPhoto = (await admin.query(`select id from album_photos where album_id = $1`, [famAlbum])).rows[0].id;
  const mine = await A(meena, 'album_save', { name: 'Only me', audience: 'me' });
  // The app does not let a "chosen" album name someone who is not on Parwah.
  // The row is forced to name Dadi here, so the page's own rule is what holds.
  await A(meena, 'album_save', { name: 'For Dadi and me', audience: 'chosen', chosen: [rohan.id] });
  const privId = (await admin.query(`select id from album_albums where name = 'Only me'`)).rows[0].id;
  const chosenId = (await admin.query(`select id from album_albums where name = 'For Dadi and me'`)).rows[0].id;
  await admin.query(`update album_albums set chosen = array[$2::uuid] where id = $1`, [chosenId, dadi.id]);
  ok('(setup) a private album and a chosen album exist beside the family one', !!mine.ok && !!privId && !!chosenId);
  // Newer than the family photo, so "the newest photo" would pick them if the rule slipped.
  await A(meena, 'photo_add', { albumId: privId, photos: [{ photo: makeJpeg(1600, 1200, 5100), thumb: makeJpeg(320, 240, 910) }], caption: 'PRIVATE PHOTO' });
  privPhoto = (await admin.query(`select id from album_photos where album_id = $1`, [privId])).rows[0].id;
  await A(meena, 'photo_add', { albumId: chosenId, photos: [{ photo: makeJpeg(1600, 1200, 5200), thumb: makeJpeg(320, 240, 920) }], caption: 'CHOSEN PHOTO' });
  chosenPhoto = (await admin.query(`select id from album_photos where album_id = $1`, [chosenId])).rows[0].id;
  // The family chat, a private chat, a poll in each.
  const chats = (await CG(rohan)).chats;
  const famChat = chats.find(c => c.kind === 'circle').id;
  await C(rohan, 'send', { chatId: famChat, text: 'CHAT HISTORY she must never read' });
  r = await C(rohan, 'poll_create', { chatId: famChat, question: 'Diwali at whose home?', options: ['Rohan and Meena', 'Dadi'] }); poll = r.pollId;
  await C(rohan, 'open_dm', { otherId: meena.id });
  const dmId = (await admin.query(`select id from chats where circle_id = $1 and kind <> 'circle' limit 1`, [fam])).rows[0].id;
  r = await C(rohan, 'poll_create', { chatId: dmId, question: 'PRIVATE POLL', options: ['a', 'b'] }); pollPrivate = r.pollId;
  ok('(setup) a poll in the family chat and one in a private chat', !!poll && !!pollPrivate && !!privPhoto && !!chosenPhoto);

  const s = await page(key, 'open');
  const kinds = s.items.map(i => i.kind + ':' + i.id);
  ok('I2b. she sees the blessing sent to everyone, the thank-you to her and her card', kinds.includes('ashirwad:' + blessAll) && kinds.includes('shukriya:' + thanks) && kinds.includes('card:' + card), JSON.stringify(s.items));
  ok('I2b. NOT a blessing to Meena, a thank-you to Rohan, Meena\'s card, or a card whose day has not come', !kinds.includes('ashirwad:' + blessMeena) && !kinds.includes('shukriya:' + thanksOther)
    && !kinds.includes('card:' + cardOther) && !kinds.includes('card:' + sealed) && s.items.length === 3);
  ok('I2b. the newest photo is from the WHOLE-FAMILY album, never a private or a chosen one', s.photo && s.photo.id === famPhoto && s.photo.caption === 'Shimla, 1987', JSON.stringify(s.photo));
  ok('I2b. the weekly question and the open family poll are there', s.question && s.question.text.length > 10 && s.question.answered === false && s.polls.length === 1 && s.polls[0].id === poll && s.polls[0].options.length === 2);
  const whole = JSON.stringify(s);
  ok('I2b. NOTHING ELSE: no chat history, no private poll, no phone but the people she was given, no health, costs or location',
    !/CHAT HISTORY|PRIVATE POLL|PRIVATE PHOTO|CHOSEN PHOTO|For Meena only|Not yet/.test(whole) && s.contacts.length === 1 && s.contacts[0].id === rohan.id
    && !whole.includes(U.meena.phone) && !/"(lat|lng|dob|events|members|register|expenses|vault)"/.test(whole));
  ok('I2b. people she can bless or ask to call are names only: on the app, with us, never Dadaji', s.people.map(p => p.name).sort().join() === 'Kabir,Meena,Rohan' && s.people.every(p => Object.keys(p).sort().join() === 'id,name'));

  r = await page(key, 'card', { id: card });
  ok('I2b. her card opens with who wrote each line', r.status === 200 && r.entries.length === 2 && r.entries[0].from === 'Rohan' && /janamdin mubarak/.test(r.entries[0].text) && r.entries[1].kind === 'voice');
  ok('I2b. the voice note on her card plays', (await page(key, 'audio', { kind: 'cardentry', id: r.entries[1].id })).audio.startsWith('data:audio/webm;base64,'));
  r = await page(key, 'photo', { id: famPhoto });
  ok('I2b. the family photo opens, small first and bigger when asked', r.status === 200 && r.data.startsWith('data:image/jpeg;base64,') && (await page(key, 'photo', { id: famPhoto, size: 'full' })).data.length > r.data.length);

  // ---- id tampering: every id she sends is looked up beside HER and HER family
  ok('SEC. Meena\'s card cannot be opened by sending its id', (await page(key, 'card', { id: cardOther })).status === 404);
  ok('SEC. a card whose day has not come stays a surprise', (await page(key, 'card', { id: sealed })).status === 404);
  ok('SEC. A PRIVATE ALBUM\'S PHOTO IS NEVER SHOWN, even by its id', (await page(key, 'photo', { id: privPhoto })).status === 404 && (await page(key, 'photo', { id: privPhoto, size: 'full' })).status === 404);
  ok('SEC. nor a "chosen" album\'s photo, even one that names her', (await page(key, 'photo', { id: chosenPhoto })).status === 404 && (await page(key, 'say', { about: { kind: 'photo', id: chosenPhoto }, kind: 'heart' })).status === 404);
  ok('SEC. a thank-you to someone else cannot be answered, and its voice cannot be fetched', (await page(key, 'say', { about: { kind: 'shukriya', id: thanksOther }, kind: 'heart' })).status === 404
    && (await page(key, 'audio', { kind: 'shukriya', id: thanksOther })).status === 404);
  ok('SEC. a blessing to Meena cannot be answered as Dadi', (await page(key, 'say', { about: { kind: 'ashirwad', id: blessMeena }, kind: 'heart' })).status === 404);
  ok('SEC. a poll in a private chat cannot be voted in', (await page(key, 'vote', { pollId: pollPrivate, choices: [0] })).status === 404);
  ok('SEC. sending a memberId, a code or a circle in the body changes nothing: the key decides who she is',
    (await page(key, 'open', { memberId: meena.id, code: 'VERMA9', circle: fam2, member: meena.id })).me.first === 'Dadi');
}

// ================================================================ another family's key
{
  const r = await E(asha, 'eld_make', { personId: nani.id });
  const naniKey = keyOf(r);
  await page(naniKey, 'consent', { yes: true });
  const s = await page(naniKey, 'open');
  ok('SEC. Nani\'s key opens Nani\'s page in her family, with nothing of the Sharmas', s.me.first === 'Nani' && s.family === 'Verma Family' && s.items.length === 0 && s.photo === null && s.polls.length === 0
    && s.people.map(p => p.name).join() === 'Asha');
  ok('SEC. ANOTHER FAMILY\'S KEY reads none of Dadi\'s things by id: card, photo, voice, poll', (await page(naniKey, 'card', { id: card })).status === 404 && (await page(naniKey, 'photo', { id: famPhoto })).status === 404
    && (await page(naniKey, 'audio', { kind: 'shukriya', id: thanks })).status === 404 && (await page(naniKey, 'vote', { pollId: poll, choices: [0] })).status === 404
    && (await page(naniKey, 'say', { about: { kind: 'ashirwad', id: blessAll }, kind: 'heart' })).status === 404);
  ok('SEC. and cannot bless or ring someone in the other family', (await page(naniKey, 'bless', { to: rohan.id, line: 'khush' })).status === 400 && (await page(naniKey, 'callme', { to: rohan.id })).status === 400);
  ok('SEC. an adult of one family cannot turn off, renew or read the other family\'s link', (await E(asha, 'eld_off', { personId: dadi.id })).status === 404 && (await E(asha, 'eld_renew', { personId: dadi.id })).status === 404
    && (await page(key, 'open')).status === 200);
}

// ================================================================ I2 (c) answering back
let sayHeart, sayVoice;
{
  pushed.length = 0;
  let r = await page(key, 'say', { about: { kind: 'shukriya', id: thanks }, kind: 'heart' }); sayHeart = r.id;
  ok('I2c. one tap answers Meena\'s thank-you: only Meena is told, "from Dadi\'s link"', r.status === 201 && to(meena).some(p => /Dadi answered, from Dadi's link/.test(p.body.title)) && to(rohan).length === 0, JSON.stringify(pushed.map(p => p.body.title)));
  r = await page(key, 'say', { about: { kind: 'ashirwad', id: blessAll }, kind: 'voice', voice: VOICE, secs: 4 }); sayVoice = r.id;
  ok('I2c. a voice note answers Rohan\'s blessing', r.status === 201 && to(rohan).some(p => /A voice note for you/.test(p.body.body)));
  ok('I2c. the answer also shows where Rohan already looks (the blessing\'s replies), marked as from the link',
    (await admin.query(`select kind, via from ashirwad_replies where ashirwad_id = $1 and member_id = $2`, [blessAll, dadi.id])).rows[0]?.via === 'link');
  r = await page(key, 'say', { about: { kind: 'card', id: card }, kind: 'text', text: 'Bahut   sundar card, sab khush raho' });
  ok('I2c. a few words answer her card: the whole family may read it', r.status === 201 && (await admin.query(`select to_member, body from eld_says where id = $1`, [r.id])).rows[0].to_member === null);
  r = await page(key, 'say', { about: { kind: 'photo', id: famPhoto }, kind: 'heart' });
  ok('I2c. and a heart for the family photo', r.status === 201);
  const again = await page(key, 'say', { about: { kind: 'photo', id: famPhoto }, kind: 'heart' });
  ok('I2c. IDEMPOTENT: a second tap on the same heart adds nothing', again.status === 200 && again.already === true && again.id === r.id
    && (await count(`select count(*)::int as n from eld_says where member_id = $1 and about_kind = 'photo'`, [dadi.id])) === 1);
  // In the app, under her own name.
  let g = await EG(meena);
  ok('I2c. IN THE APP: Meena sees Dadi\'s heart, her words and her photo heart, each "from Dadi\'s link"', g.said.length === 3 && g.said.every(x => x.name === 'Dadi' && x.label === "from Dadi's link")
    && g.said.some(x => x.text === 'Bahut sundar card, sab khush raho') && g.said.some(x => x.about === 'shukriya'), JSON.stringify(g.said));
  g = await EG(rohan);
  ok('I2c. Rohan sees the voice note for him and the family ones, NOT the private answer to Meena', g.said.length === 3 && g.said.some(x => x.hasVoice && x.id === sayVoice) && !g.said.some(x => x.about === 'shukriya'));
  ok('I2c. Rohan can play her voice note; Kabir, who it was not for, cannot', (await E(rohan, 'eld_audio', { id: sayVoice })).audio === VOICE && (await E(kabir, 'eld_audio', { id: sayVoice })).status === 404);
  ok('I2c. and another family cannot', (await E(asha, 'eld_audio', { id: sayVoice })).status === 404);
  ok('I2c. her page shows those things as answered', (await page(key, 'open')).items.filter(i => i.answered).length === 3);

  // ---- upload limits: the chat's own voice rules
  const big = 'data:audio/webm;base64,GkXfo59C' + 'A'.repeat(600000);
  ok('SEC. a voice note over the size cap is refused', (await page(key, 'say', { about: { kind: 'card', id: card }, kind: 'voice', voice: big, secs: 60 })).status === 400);
  ok('SEC. one that claims 2 seconds and carries far more is refused', (await page(key, 'say', { about: { kind: 'card', id: card }, kind: 'voice', voice: 'data:audio/webm;base64,GkXfo59C' + 'A'.repeat(60000), secs: 2 })).status === 400);
  ok('SEC. over 60 seconds is refused', (await page(key, 'say', { about: { kind: 'card', id: card }, kind: 'voice', voice: VOICE, secs: 61 })).status === 400);
  ok('SEC. a file that only claims to be audio is refused', (await page(key, 'say', { about: { kind: 'card', id: card }, kind: 'voice', voice: 'data:audio/webm;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', secs: 3 })).status === 400);
  ok('SEC. "a few words" is cut at 240 characters', (await admin.query(`select length(body) as n from eld_says where id = $1`, [(await page(key, 'say', { about: { kind: 'card', id: card }, kind: 'text', text: 'x'.repeat(900) })).id])).rows[0].n === 240);
  ok('SEC. a card number or an OTP in her words is refused, as everywhere', (await page(key, 'say', { about: { kind: 'card', id: card }, kind: 'text', text: 'my otp is 4455' })).status === 400);
}

// ================================================================ I2 (d) blessing, the question, a vote
let blessOne;
{
  pushed.length = 0;
  let r = await page(key, 'bless', { to: kabir.id, line: 'exam' }); blessOne = r.id;
  ok('I2d. a one-tap blessing to Kabir arrives as a real Ashirwad from Dadi', r.status === 201 && to(kabir).some(p => /Ashirwad from Dadi/.test(p.body.title) && /from Dadi's link/.test(p.body.body)) && to(rohan).length === 0);
  let inbox = (await call(api.chats, { method: 'GET', token: kabir.token, query: { area: 'ashirwad', circle: 'SHARMA', member: kabir.id } })).inbox;
  ok('I2d. it is in Kabir\'s app, under her own name, marked as from her link', inbox.some(c => c.id === blessOne && c.fromName === 'Dadi' && c.line === 'All the best for the exam' && c.via === 'link'), JSON.stringify(inbox));
  r = await AS(kabir, 'reply', { id: blessOne, pranam: true });
  ok('I2d. Kabir answers with Pranam, as for any blessing', r.status === 201);
  r = await page(key, 'bless', { to: 'all', voice: VOICE, secs: 4 });
  ok('I2d. a voice blessing to everyone reaches every phone', r.status === 201 && [rohan, meena, kabir].every(m => to(m).some(p => /A voice note for you/.test(p.body.body))));
  ok('I2d. a blessing to someone remembered, or outside the family, is refused', (await page(key, 'bless', { to: dadaji.id, line: 'khush' })).status === 400 && (await page(key, 'bless', { to: asha.id, line: 'khush' })).status === 400);
  ok('I2d. a made-up line is refused: only the family\'s own one-tap lines', (await page(key, 'bless', { to: 'all', line: 'buy now' })).status === 400);

  r = await page(key, 'sawaal', { voice: VOICE, secs: 4 });
  const ans = (await admin.query(`select member_id, by_member, via, audio from sawaal_answers where member_id = $1`, [dadi.id])).rows[0];
  ok('I2d. the weekly question, answered by voice: HER answer, recorded by nobody', r.status === 201 && ans.member_id === dadi.id && ans.by_member === null && ans.via === 'link' && ans.audio === VOICE);
  await H(meena, 'sawaal_answer', { text: 'Meena\'s own answer to the week\'s question' });
  const sw = (await call(api.chats, { method: 'GET', token: meena.token, query: { area: 'heard', view: 'today', circle: 'SHARMA', member: meena.id } })).sawaal;
  ok('I2d. in the app her answer sits beside the family\'s, marked "from Dadi\'s link"', sw.answers.some(a => a.memberId === dadi.id && a.hasAudio && a.told === "from Dadi's link") && !sw.offApp.some(p => p.id === dadi.id), JSON.stringify(sw.answers));
  ok('I2d. her page shows the question as answered', (await page(key, 'open')).question.answered === true);

  // A proxy vote first, then her own.
  const famChat = (await CG(rohan)).chats.find(c => c.kind === 'circle').id;
  await C(rohan, 'poll_vote', { chatId: famChat, pollId: poll, choices: [0], forId: dadi.id });
  ok('I2d. (before) Rohan voted FOR Dadi: a proxy vote', (await admin.query(`select by_member from poll_votes where poll_id = $1 and member_id = $2`, [poll, dadi.id])).rows[0].by_member === rohan.id);
  r = await page(key, 'vote', { pollId: poll, choices: [1] });
  const v = (await admin.query(`select choices, by_member, via from poll_votes where poll_id = $1 and member_id = $2`, [poll, dadi.id])).rows[0];
  ok('I2d. HER OWN VOTE takes its place: recorded as hers, not a proxy', r.status === 200 && v.by_member === null && v.via === 'link' && JSON.stringify(v.choices) === '[1]');
  await C(meena, 'poll_vote', { chatId: famChat, pollId: poll, choices: [1] });
  const msgs = (await CG(rohan, { chat: famChat })).messages || [];
  const pm = msgs.find(m => m.poll && m.poll.id === poll);
  ok('I2d. THE VOTE COUNTS: two for "Dadi", and her name carries the label', pm && pm.poll.options[1].count === 2 && pm.poll.options[1].names.some(x => /Dadi/.test(x) && /link/.test(x)) && pm.poll.options[0].count === 0, JSON.stringify(pm && pm.poll.options));
  ok('I2d. a choice that is not in the poll is refused', (await page(key, 'vote', { pollId: poll, choices: [7] })).status === 400);
  ok('I2d. her page shows her choice', (await page(key, 'open')).polls[0].mine.join() === '1');
}

// ================================================================ I2 (e) "Call me"
{
  await clearRate(); pushed.length = 0;
  let r = await page(key, 'callme', { to: meena.id });
  ok('I2e. "Call me" to Meena: one push, to Meena only, and a feed line', r.status === 201 && r.to === 'Meena' && to(meena).filter(p => /Dadi would like a call/.test(p.body.title)).length === 1 && to(rohan).length === 0
    && (await feed()).some(t => /Dadi would like a call from Meena \(from Dadi's link\)/.test(t)));
  r = await page(key, 'callme', { to: meena.id });
  ok('I2e. RATE LIMITED: a second ask inside three hours sends nothing, and says so kindly', r.status === 429 && r.told === true && /told already/.test(r.error) && to(meena).filter(p => /would like a call/.test(p.body.title)).length === 1);
  // Whoever is on the call rota today.
  await clearRate(); pushed.length = 0;
  const rota = await call(api.care, { token: rohan.token, body: { code: 'SHARMA', memberId: rohan.id, action: 'rota_create', aboutMemberId: dadi.id, memberIds: [meena.id, rohan.id], time: '19:00', tz: 'Asia/Kolkata' } });
  r = await page(key, 'callme', {});
  ok('I2e. with nobody chosen, today\'s person on the call rota is asked', rota.status === 201 && r.status === 201 && r.to === 'Meena' && to(meena).filter(p => /would like a call/.test(p.body.title)).length === 1 && !to(rohan).some(p => /would like a call/.test(p.body.title)), JSON.stringify({ rota, r }));
  ok('I2e. her two call buttons carry only the numbers she was given', (await page(key, 'open')).contacts.map(c => c.phone).join() === U.rohan.phone);
  r = await E(rohan, 'eld_contacts', { personId: dadi.id, contacts: [meena.id, rohan.id, kabir.id, dadaji.id] });
  ok('I2e. an adult chooses up to two: adults on the app with a number, never a child or someone remembered', r.status === 200 && r.contacts.join() === [meena.id, rohan.id].join());
  ok('I2e. a child cannot change them', (await E(kabir, 'eld_contacts', { personId: dadi.id, contacts: [kabir.id] })).status === 403);
  await admin.query(`update members set see_phone = 'me' where id = $1`, [meena.id]);
  ok('I2e. a number its owner later keeps to themself leaves her page too', (await page(key, 'open')).contacts.map(c => c.id).join() === rohan.id);
  await admin.query(`update members set see_phone = null where id = $1`, [meena.id]);
  await clearRate();
}

// ================================================================ I2 (f) SOS-lite
{
  pushed.length = 0;
  let r = await page(key, 'sos', { lat: 28.61, lng: 77.2 });
  const s1 = (await admin.query(`select id, lat, status from sos where member_id = $1`, [dadi.id])).rows;
  ok('I2f. "I need help" raises the family\'s own SOS, as Dadi', r.status === 201 && r.again === false && s1.length === 1 && s1[0].status === 'open');
  ok('I2f. NO LOCATION unless she taps to send it: a position in the request is ignored', s1[0].lat === null && r.located === false);
  ok('I2f. every phone in the family gets the emergency push', [rohan, meena, kabir].every(m => to(m).some(p => /SOS from Dadi/.test(p.body.title))));
  ok('I2f. the family\'s numbers the SOS route hands an app are NOT passed to the page', r.contacts === undefined && r.text === undefined && r.map === undefined && !JSON.stringify(r).includes('+91'));
  r = await page(key, 'sos', {});
  ok('I2f. IDEMPOTENT: a second press is the same SOS, not a second emergency', r.status === 201 && r.again === true && (await count(`select count(*)::int as n from sos where member_id = $1`, [dadi.id])) === 1);
  r = await page(key, 'sos', { share: true, lat: 28.61, lng: 77.2, accuracy: 30 });
  ok('I2f. "send where I am" adds her place to that same SOS', r.status === 201 && r.located === true && Math.abs((await admin.query(`select lat from sos where member_id = $1`, [dadi.id])).rows[0].lat - 28.61) < 1e-6);
  ok('I2f. her page knows help has been called', (await page(key, 'open')).sosOpen === true);
  const st = await call(api.events, { method: 'GET', token: rohan.token, query: { circle: 'SHARMA', member: rohan.id } });
  ok('I2f. the family\'s alarm shows it like any SOS, and Rohan can close it', st.sos.some(x => x.member_id === dadi.id)
    && (await call(api.events, { token: rohan.token, body: { code: 'SHARMA', memberId: rohan.id, type: 'sos_resolve', sosId: s1[0].id } })).status === 200);
}

// ================================================================ I3. she sees and deletes what she sent
{
  let m = await page(key, 'mine');
  ok('I3. she sees everything SHE sent: answers, blessings, the question', m.status === 200 && m.list.filter(x => x.kind === 'say').length >= 4 && m.list.filter(x => x.kind === 'ashirwad').length === 2 && m.list.filter(x => x.kind === 'sawaal').length === 1, JSON.stringify(m.list.map(x => x.kind)));
  ok('I3. deleting her voice answer removes it from the app, and from the blessing\'s replies', (await page(key, 'forget', { kind: 'say', id: sayVoice })).status === 200
    && !(await EG(rohan)).said.some(x => x.id === sayVoice) && (await count(`select count(*)::int as n from ashirwad_replies where ashirwad_id = $1 and member_id = $2`, [blessAll, dadi.id])) === 0);
  ok('I3. deleting her blessing to Kabir removes it', (await page(key, 'forget', { kind: 'ashirwad', id: blessOne })).status === 200 && (await count(`select count(*)::int as n from ashirwad where id = $1`, [blessOne])) === 0);
  ok('I3. and her answer to the question', (await page(key, 'forget', { kind: 'sawaal', id: m.list.find(x => x.kind === 'sawaal').id })).status === 200 && (await count(`select count(*)::int as n from sawaal_answers where member_id = $1`, [dadi.id])) === 0);
  ok('SEC. she cannot delete what someone else sent by naming its id', (await page(key, 'forget', { kind: 'ashirwad', id: blessAll })).status === 404 && (await count(`select count(*)::int as n from ashirwad where id = $1`, [blessAll])) === 1
    && (await page(key, 'forget', { kind: 'sawaal', id: (await admin.query(`select id from sawaal_answers where member_id = $1`, [meena.id])).rows[0].id })).status === 404);
}

// ================================================================ I1. rate limits, fail closed
{
  await clearRate();
  let last = null;
  for (let i = 0; i < 21; i++) last = await page(key, 'bless', { to: 'all', line: 'khush' });
  ok('I1. blessings from one link are limited (20 an hour)', last.status === 429 && last.wait === true);
  await clearRate();
  for (let i = 0; i < 11; i++) last = await E(rohan, 'eld_renew', { personId: dadi.id });
  ok('I1. making and renewing is limited for one adult (10 a day)', last.status === 429);
  await clearRate();
  // A limiter that cannot count says no: the table is taken away for a moment.
  await admin.query(`alter table rate_limit rename to rate_limit_away`);
  const closedPage = await page(key, 'open');
  const closedWrong = await page('C'.repeat(43), 'open');
  const closedMake = await E(rohan, 'eld_renew', { personId: dadi.id });
  await admin.query(`alter table rate_limit_away rename to rate_limit`);
  ok('I1. FAIL CLOSED: with the limiter unable to count, the page, a wrong key and making a link are all refused', closedPage.status === 429 && closedWrong.status === 429 && closedMake.status === 429, JSON.stringify([closedPage.status, closedWrong.status, closedMake.status]));
  await admin.query(`delete from ashirwad where from_member = $1`, [dadi.id]);
}

// ================================================================ I1. expiry and renewal
{
  await admin.query(`update eld_links set expires_at = now() - interval '1 minute' where member_id = $1`, [dadi.id]);
  const r = await page(key, 'open');
  ok('I1. EXPIRY: after its 90 days the key opens nothing, with the same plain answer as a wrong key', r.status === 404 && r.off === true && r.error === (await page('D'.repeat(43), 'open')).error);
  ok('I1. the family sees it has run out', (await EG(rohan)).links[0].state === 'expired');
  ok('I1. and it no longer counts as a way to check in', (await call(api.events, { token: rohan.token, body: { code: 'SHARMA', memberId: rohan.id, type: 'quiet_ask', targetId: dadi.id, checkinBy: '10:00' } })).status === 400);
  ok('I1. a child cannot keep it on', (await E(kabir, 'eld_renew', { personId: dadi.id })).status === 403);
  const k = await E(meena, 'eld_renew', { personId: dadi.id });
  ok('I1. RENEWABLE: any adult keeps it on for 90 more days, and the same key works again', k.status === 200 && (await page(key, 'open')).status === 200 && (await EG(rohan)).links[0].state === 'on');
}

// ================================================================ revocation
{
  ok('I3. a child cannot turn the link off', (await E(kabir, 'eld_off', { personId: dadi.id })).status === 403 && (await page(key, 'open')).status === 200);
  let r = await E(meena, 'eld_off', { personId: dadi.id });
  ok('I1. REVOCATION: any adult turns it off (Meena did not make it)', r.status === 200 && (await page(key, 'open')).status === 404 && (await EG(rohan)).links.length === 0);
  ok('I1. after that every action is refused, not only reading', (await page(key, 'ok')).status === 404 && (await page(key, 'sos')).status === 404 && (await page(key, 'bless', { to: 'all', line: 'khush' })).status === 404);
  ok('I1. what she sent stays in the app after the link is off', (await EG(meena)).said.length >= 2);
  // She turns it off herself.
  r = await E(rohan, 'eld_make', { personId: dadi.id }); key = keyOf(r);
  ok('I1. a new link after an old one is a new row; the family is not told again', r.status === 201 && r.fresh === false && (await feed()).filter(t => /set up Dadi's link/.test(t)).length === 1);
  await page(key, 'consent', { yes: true });
  pushed.length = 0;
  r = await page(key, 'off');
  ok('I1. SHE turns it off from the page: it stops at once, and the adult who made it is told kindly', r.status === 200 && r.off === true && (await page(key, 'open')).status === 404
    && to(rohan).some(p => /Dadi turned off their link/.test(p.body.title) && /Nothing is wrong/.test(p.body.body)) && to(meena).length === 0, JSON.stringify(pushed.map(p => p.body)));
  ok('I4. the family is shown that she said no, so they ask before sending another', (await EG(meena)).declined.some(d => d.memberId === dadi.id));
  // "I do not want this" on the first screen.
  r = await E(rohan, 'eld_make', { personId: dadi.id }); key = keyOf(r);
  pushed.length = 0;
  r = await page(key, 'consent', { yes: false });
  ok('I3. "I do not want this" turns the link off and tells the adult kindly', r.status === 200 && r.off === true && (await page(key, 'open')).status === 404
    && to(rohan).some(p => /Dadi does not want the link/.test(p.body.title)) && (await admin.query(`select revoked_how from eld_links where member_id = $1 order by created_at desc limit 1`, [dadi.id])).rows[0].revoked_how === 'declined');
}

// ================================================================ remembered, and "This is me"
{
  let r = await E(rohan, 'eld_make', { personId: dadi.id }); key = keyOf(r);
  await page(key, 'consent', { yes: true });
  await page(key, 'bless', { to: meena.id, line: 'khush' });
  // Marked as remembered while a link is on: it stops by itself.
  await admin.query(`update members set remembered = true where id = $1`, [dadi.id]);
  ok('I3. a link stops the moment its person is marked as remembered', (await page(key, 'open')).status === 404 && (await EG(rohan)).links.length === 0 && !(await Eld.eldLinkOn(sql, fam, dadi.id)));
  await admin.query(`update members set remembered = false where id = $1`, [dadi.id]);
  ok('(undone) the link is on again', (await page(key, 'open')).status === 200 && (await Eld.eldLinkOn(sql, fam, dadi.id)));

  // She joins Parwah and says "This is me": the family lets her in as that row.
  const jr = await call(api.circle, { token: U.dadiLater.token, body: { action: 'join', code: 'SHARMA', memberName: 'Dadi', userId: U.dadiLater.userId, claimMember: dadi.id } });
  const pending = (await admin.query(`select id from join_requests where circle_id = $1 and status = 'pending' order by created_at desc limit 1`, [fam])).rows[0];
  const ap = pending ? await call(api.circle, { token: rohan.token, body: { action: 'approve_join', code: 'SHARMA', memberId: rohan.id, requestId: pending.id, claimMember: dadi.id } }) : { status: 0 };
  const now = (await admin.query(`select user_id from members where id = $1`, [dadi.id])).rows[0];
  ok('I4. Dadi joins with "This is me" and is let in as her own row', !!pending && ap.status < 300 && now.user_id === U.dadiLater.userId, JSON.stringify({ jr, ap }));
  const link = (await admin.query(`select revoked_at, revoked_how from eld_links where member_id = $1 order by created_at desc limit 1`, [dadi.id])).rows[0];
  ok('I4. THE LINK IS CLOSED when she joins, and the key opens nothing', link.revoked_at !== null && link.revoked_how === 'joined' && (await page(key, 'open')).status === 404);
  ok('I4. WHAT SHE SENT STAYS HERS: her blessing and her answers are still under her name', (await count(`select count(*)::int as n from ashirwad where from_member = $1 and via = 'link'`, [dadi.id])) === 1
    && (await count(`select count(*)::int as n from eld_says where member_id = $1`, [dadi.id])) >= 2);
  ok('I4. and nobody can make her a link now: she has the app', (await E(rohan, 'eld_make', { personId: dadi.id })).status === 400);
}

// ================================================================ nothing leaked
{
  const all = (await admin.query(`select coalesce(string_agg(text, ' '), '') as t from events`)).rows[0].t + JSON.stringify(pushed);
  const keys = (await admin.query(`select token_hash from eld_links`)).rows;
  ok('SEC. no key is in any feed line or push, and every stored value is a 64-character hash', !/#k=/.test(all) && keys.every(k => /^[0-9a-f]{64}$/.test(k.token_hash)));
}

await admin.end();
for (const pl of globalThis.__parwahPools || []) await pl.end();
if (fails.length) { console.error(`eldlink.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`eldlink.dbtest: ${pass}/${pass} checks pass`);
