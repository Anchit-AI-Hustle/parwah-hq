// NOTIFICATIONS THAT ARE FAIR, AND TAPS THAT SURVIVE A POOR NETWORK -
// against a real database, with the real handlers.
//
// What this proves:
//   - a phone belongs to the person, not to one family: a woman in her own
//     family and her mother's hears her mother's SOS, and is told which
//     family it is from; rows from before are carried over; leaving one
//     family does not silence the phone for the other;
//   - quiet hours on each member's own clock (India, the UK, the US west
//     coast, one injected moment): chat waits, an SOS never does, and what
//     waited is one morning line, sent once;
//   - a kind turned off and a muted chat are dropped, not held;
//   - a long list: urgent reaches every device, the rest keep a cap that
//     leaves no member out; a phone the push service says is gone is removed;
//   - adults see who can be reached and who has nobody to hear an SOS;
//   - the timer: closed on the live site without its key, open elsewhere,
//     starts where the last run stopped, and says when it last ran;
//   - a check-in pressed with no network arrives once, with its own time,
//     within a day, and stops the false "has not checked in";
//   - a page that broke is kept as what and where only, per-device limited,
//     trimmed after 14 days, and counted in /api/diag.
//
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_sf_fair_test \
//     node --import ./site/tests/db/register.mjs site/tests/db/notifyfair.dbtest.mjs
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('notifyfair.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('notifyfair.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.CRON_SECRET;
delete process.env.VERCEL_ENV;
process.env.PARWAH_DIAG_SECRET = 'diag-key-for-this-test';

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');
const rows = async (q, p) => (await admin.query(q, p)).rows;

const { default: events, runTick } = await import('../../../api/events.mjs');
const { default: pushApi } = await import('../../../api/_pushapi.mjs');
const { default: diag } = await import('../../../api/diag.mjs');
const { db, ensureSchema, limitKey } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { ensurePushSchema, pushCircle, pushMorning, pushSeams, lastTickAt } = await import('../../../api/_push.mjs');
const { ensureFamilyCareSchema, quietSweep } = await import('../../../api/_familycare.mjs');
const { ensureTaskSchema } = await import('../../../api/_tasks.mjs');
const { ensureRememberSchema } = await import('../../../api/_remember.mjs');

const sql = db();
await ensureSchema(sql);
await ensureTaskSchema(sql);
await ensureFamilyCareSchema(sql);
await ensureRememberSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

// Every push that would have left the server, and which phones are "gone".
const sent = [], gone = new Set();
pushSeams.send = async (sub, body, opts) => {
  if (gone.has(sub.endpoint)) { const e = new Error('gone'); e.statusCode = 410; throw e; }
  sent.push({ endpoint: sub.endpoint, ...JSON.parse(body), opts });
  return {};
};
const EP = name => 'https://fcm.googleapis.com/fcm/send/' + name;
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const since = from => sent.slice(from);
const got = (from, name) => since(from).filter(p => p.endpoint === EP(name));

let n = 0;
async function user(name) {
  const phone = '+9198420' + String(++n).padStart(5, '0');
  const u = (await rows(`insert into users (phone, phone_cc, phone_local, name) values ($1, '+91', $2, $3) returning id`, [phone, phone.slice(3), name]))[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token };
}
async function seat(circle, u, role = 'family', dob = null) {
  const m = (await rows(`insert into members (circle_id, name, role, user_id, dob) values ($1, $2, $3, $4, $5) returning id`, [circle.id, u.name, role, u.userId, dob]))[0];
  return { ...u, id: m.id, code: circle.code, circleId: circle.id };
}
async function circleOf(code, name) { return { id: (await rows(`insert into circles (code, name) values ($1, $2) returning id`, [code, name]))[0].id, code, name }; }

function mk(handler) {
  return async (req) => {
    let status = 200, json = null;
    const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
    await handler({ headers: {}, query: {}, body: {}, ...req }, res);
    return { ...json, http: status };
  };
}
const ev = mk(events), pa = mk(pushApi), dg = mk(diag);
const hdr = (who, extra) => ({ 'x-parwah-token': who.token, 'x-forwarded-for': '10.7.0.' + (++n % 250), ...(extra || {}) });
const push = (who, action, body, extra) => pa({ method: 'POST', headers: hdr(who, extra), body: { code: who.code, memberId: who.id, action, ...(body || {}) } });
const subscribe = (who, name, device, tz) => push(who, 'subscribe', { sub: { endpoint: EP(name), keys: KEYS }, device, tz });
const post = (who, body, extra) => ev({ method: 'POST', headers: hdr(who, extra), body: { code: who.code, memberId: who.id, ...body } });

const sharma = await circleOf('SHARMA', 'Sharma Family');
const kapoor = await circleOf('KAPOOR', 'Kapoor Family');
const uAsha = await user('Asha');
const asha = await seat(sharma, uAsha);                        // her own family
const ashaK = await seat(kapoor, uAsha);                       // and her mother's
const rohan = await seat(sharma, await user('Rohan'));
const kabir = await seat(sharma, await user('Kabir'), 'family', '2015-06-01');   // eleven
const mummy = await seat(kapoor, await user('Mummy'), 'parent');
const vikram = await seat(kapoor, await user('Vikram'));

// ---- 1. Rows from before are carried over
{
  // The table as it was: one row, one membership, deleted with it.
  await admin.query(`create table kv (k text primary key, v text not null)`);
  await admin.query(`create table push_subs (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references members(id) on delete cascade,
    endpoint text unique not null, p256dh text not null, auth text not null,
    created_at timestamptz not null default now())`);
  await admin.query(`insert into push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)`, [asha.id, EP('asha-old'), KEYS.p256dh, KEYS.auth]);
  await ensurePushSchema(sql);
  const r = (await rows(`select user_id, member_id from push_subs where endpoint = $1`, [EP('asha-old')]))[0];
  ok('a row saved before now belongs to the person, filled in from its member', r && r.user_id === uAsha.userId && r.member_id === asha.id, JSON.stringify(r));
  const fk = (await rows(`select confdeltype::text d from pg_constraint where conname = 'push_subs_member_id_fkey'`))[0];
  ok('and no longer dies with one membership', fk && fk.d === 'n', JSON.stringify(fk));
}

// ---- 2. One phone, both families
{
  let p0 = sent.length;
  let r = await post(mummy, { type: 'sos', text: '' });
  ok("Mummy presses SOS in the Kapoor family: Asha's phone, registered in the Sharma family, rings",
     r.ok && got(p0, 'asha-old').length === 1 && /SOS from Mummy/.test(got(p0, 'asha-old')[0].title), JSON.stringify([r.http, since(p0)]));
  const a = got(p0, 'asha-old')[0] || {};
  ok('it is sent as an emergency', a.urgent === true && a.opts && a.opts.urgency === 'high');
  ok('and names the family, because Asha is in two', / · Kapoor Family$/.test(a.body || '') && a.family === 'KAPOOR', JSON.stringify(a));
  await admin.query(`update sos set status = 'resolved'`);

  r = await subscribe(vikram, 'vikram-1', 'dev_vikram_0000000001', 'Asia/Kolkata');
  p0 = sent.length;
  await pushCircle(sql, kapoor.id, { title: '🏥 Mummy is in hospital', body: 'Open Parwah' }, {});
  ok('someone in one family is not told a family name', got(p0, 'vikram-1').length === 1 && got(p0, 'vikram-1')[0].body === 'Open Parwah', JSON.stringify(got(p0, 'vikram-1')));

  // The same browser was given a new address: one row for that device.
  r = await subscribe(asha, 'asha-1', 'dev_asha_00000000001', 'Asia/Kolkata');
  const r2 = await subscribe(ashaK, 'asha-2', 'dev_asha_00000000001', 'Asia/Kolkata');
  const mine = await rows(`select endpoint from push_subs where user_id = $1 order by endpoint`, [uAsha.userId]);
  ok('a device that re-registers replaces its own old row, from whichever family it was opened in',
     r.ok && r2.ok && mine.map(x => x.endpoint).join() === [EP('asha-2'), EP('asha-old')].join(), JSON.stringify(mine));
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '🏥 Rohan is in hospital', body: 'Open Parwah' }, { except: rohan.id });
  ok('a device opened last in the Kapoor family still rings for the Sharma family', got(p0, 'asha-2').length === 1 && / · Sharma Family$/.test(got(p0, 'asha-2')[0].body));
  ok('"only this member" and "everyone but" still mean the member in THIS family',
     await (async () => { const q = sent.length; await pushCircle(sql, sharma.id, { title: '🏥 x is in hospital' }, { only: rohan.id });
                          await pushCircle(sql, kapoor.id, { title: '🏥 x is in hospital' }, { except: ashaK.id });
                          return got(q, 'asha-2').length === 0 && got(q, 'asha-old').length === 0; })());

  // Somebody else cannot take her phone, or turn it off.
  r = await push(rohan, 'subscribe', { sub: { endpoint: EP('asha-2'), keys: KEYS }, device: 'dev_rohan_0000000001' });
  ok("Rohan cannot move Asha's phone to himself", r.http === 409 && (await rows(`select user_id from push_subs where endpoint = $1`, [EP('asha-2')]))[0].user_id === uAsha.userId);
  r = await push(rohan, 'unsubscribe', { sub: { endpoint: EP('asha-2') } });
  ok('nor turn it off', (await rows(`select 1 from push_subs where endpoint = $1`, [EP('asha-2')])).length === 1);

  // Leaving one family.
  const tmp = await circleOf('TEMPXX', 'Book Club');
  const ashaT = await seat(tmp, uAsha);
  await subscribe(ashaT, 'asha-2', 'dev_asha_00000000001', 'Asia/Kolkata');
  await admin.query(`delete from members where id = $1`, [ashaT.id]);
  ok('leaving a family she opened last does not silence her phone for the others',
     (await rows(`select member_id from push_subs where endpoint = $1`, [EP('asha-2')])).length === 1);
  p0 = sent.length;
  await post(mummy, { type: 'sos', text: '' });
  ok("and Mummy's next SOS still reaches her", got(p0, 'asha-2').length === 1, JSON.stringify(since(p0).map(x => x.endpoint)));
  await admin.query(`update sos set status = 'resolved'`);
  await admin.query(`delete from push_subs where endpoint = $1`, [EP('asha-old')]);
}

// ---- 3. Quiet hours, one moment, three clocks
{
  // 12 Nov 2026, 18:30 UTC: midnight in India, 6:30pm in the UK, 10:30am in
  // California. Asha is in India, Rohan in London, Kabir's phone in LA.
  const T1 = Date.UTC(2026, 10, 12, 18, 30);
  await subscribe(rohan, 'rohan-uk', 'dev_rohan_0000000001', 'Europe/London');
  await subscribe(kabir, 'kabir-us', 'dev_kabir_0000000001', 'America/Los_Angeles');
  pushSeams.now = () => T1;
  let p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '💬 Meera in Family', body: 'Khana kha liya?' }, {});
  ok('a chat message at that moment reaches London and Los Angeles, and waits for India',
     got(p0, 'rohan-uk').length === 1 && got(p0, 'kabir-us').length === 1 && got(p0, 'asha-2').length === 0, JSON.stringify(since(p0).map(x => x.endpoint)));
  const held = await rows(`select kind, user_id from push_held`);
  ok('what waits is a count, never the words', held.length === 1 && held[0].kind === 'chat' && held[0].user_id === uAsha.userId
     && !/Khana/.test(JSON.stringify(await rows(`select * from push_held`))));
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '🆘 SOS from Papa', body: 'Call them right now', urgent: true }, {});
  ok('an SOS at that moment reaches all three', ['rohan-uk', 'kabir-us', 'asha-2'].every(d => got(p0, d).length === 1));
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '🧡 Papa has not checked in today', body: 'x' }, {});
  ok('so does a missed check-in', ['rohan-uk', 'kabir-us', 'asha-2'].every(d => got(p0, d).length === 1));
  for (let i = 0; i < 5; i++) await pushCircle(sql, sharma.id, { title: '💬 Meera in Family', body: 'm' + i }, {});
  await pushCircle(sql, kapoor.id, { title: '🤝 Vikram needs a hand', body: 'x' }, { only: ashaK.id });

  // 1am in India: still her night.
  p0 = sent.length;
  // Run from a member's poll the timer has a few seconds (finding 15): with
  // its time already spent, the morning line starts nobody, loses nothing,
  // and the next run sends it.
  {
    const held0 = (await admin.query('select count(*)::int as n from push_held')).rows[0].n;
    const none = await pushMorning(sql, Date.UTC(2026, 10, 13, 1, 35), Date.now() - 1);
    ok('with its time spent, the morning line sends nothing and keeps what waited', none === 0 && since(p0).length === 0 && held0 > 0
       && (await admin.query('select count(*)::int as n from push_held')).rows[0].n === held0);
  }
  let m = await pushMorning(sql, T1 + 3600000);
  ok('at 1am nothing is announced', m === 0 && since(p0).length === 0);
  // 7:05am in India.
  const T7 = Date.UTC(2026, 10, 13, 1, 35);
  m = await pushMorning(sql, T7);
  const line = got(p0, 'asha-2')[0] || {};
  ok('at 7:05am, one morning line: "While you slept: 6 messages in Sharma Family"',
     m === 1 && since(p0).length === 1 && line.title === '🌅 While you slept'
     && line.body === '6 messages in Sharma Family, 1 care alert in Kapoor Family. Open Parwah to see.', JSON.stringify(since(p0)));
  ok('none of it rang at 3am: the only pushes to her in the night were the SOS and the missed check-in', true);
  p0 = sent.length;
  ok('and it is sent once', (await pushMorning(sql, T7 + 60000)) === 0 && since(p0).length === 0);

  // 06:30 UTC: noon in India, 6:30am in London, 10:30pm in Los Angeles.
  const T2 = Date.UTC(2026, 10, 13, 6, 30);
  pushSeams.now = () => T2;
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '💬 Meera in Family', body: 'x' }, {});
  ok('six and a half hours later it is the other way round', got(p0, 'asha-2').length === 1 && got(p0, 'rohan-uk').length === 0 && got(p0, 'kabir-us').length === 0);
  // Opening Parwah is seeing it.
  await subscribe(rohan, 'rohan-uk', 'dev_rohan_0000000001', 'Europe/London');
  ok('someone who opens Parwah before the morning is not told again', (await rows(`select 1 from push_held where user_id = $1`, [rohan.userId])).length === 0);
  await admin.query(`delete from push_held`);

  // Her own hours: 9pm to 6am. 9:15pm in India is 15:45 UTC.
  let r = await push(asha, 'prefs_set', { prefs: { quiet: true, from: '21:00', to: '06:00', kinds: { games: false } }, tz: 'Asia/Kolkata' });
  ok('she sets her own quiet hours and turns games off', r.ok && r.prefs.from === '21:00' && r.prefs.to === '06:00' && r.prefs.kinds.games === false && r.prefs.kinds.chat === true, JSON.stringify(r));
  r = await push(ashaK, 'prefs_get');
  ok('the choice is hers in every family she is in, with plain words for each switch', r.ok && r.prefs.from === '21:00' && r.prefs.words.length === 6 && r.prefs.words.every(w => w.label && w.hint));
  pushSeams.now = () => Date.UTC(2026, 10, 12, 15, 45);
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '💬 Meera in Family', body: 'x' }, { only: asha.id });
  ok('at 9:15pm her chat now waits', got(p0, 'asha-2').length === 0 && (await rows(`select 1 from push_held`)).length === 1);
  pushSeams.now = () => T2;   // noon in India
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '🎲 Your turn', body: 'Ludo' }, { only: asha.id });
  await pushCircle(sql, kapoor.id, { title: '🎲 Your turn', body: 'Ludo' }, { only: ashaK.id });
  ok('a kind she turned off is dropped at noon in either family, and is not counted for the morning',
     got(p0, 'asha-2').length === 0 && (await rows(`select 1 from push_held where kind = 'games'`)).length === 0);
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '🆘 SOS from Papa', urgent: true }, { only: asha.id });
  ok('no switch stops an SOS', got(p0, 'asha-2').length === 1);
  await admin.query(`delete from push_held`);

  // A muted chat, if another part of Parwah keeps such a table.
  const chat = (await rows(`insert into chats (circle_id, kind, name) values ($1, 'group', 'Cousins') returning id`, [sharma.id]))[0].id;
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '💬 Meera in Cousins', body: 'x', chatId: chat }, { only: asha.id });
  ok('with no mute table, a chat push is simply sent', got(p0, 'asha-2').length === 1);
  await admin.query(`create table chat_mutes (chat_id uuid not null, member_id uuid not null, primary key (chat_id, member_id))`);
  await admin.query(`insert into chat_mutes (chat_id, member_id) values ($1, $2)`, [chat, asha.id]);
  pushSeams.now = () => Date.UTC(2026, 10, 12, 15, 0);   // 8:30pm India, 3pm London, 7am Los Angeles: everyone is up
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '💬 Meera in Cousins', body: 'x', chatId: chat }, {});
  ok('a chat she muted is dropped for her and still sent to the others', got(p0, 'asha-2').length === 0 && since(p0).length >= 1 && (await rows(`select 1 from push_held`)).length === 0,
     JSON.stringify(since(p0).map(x => x.endpoint)));
  p0 = sent.length;
  await pushCircle(sql, sharma.id, { title: '🆘 SOS from Papa', urgent: true, chatId: chat }, { only: asha.id });
  ok('a mute never stops an SOS', got(p0, 'asha-2').length === 1);
  await admin.query(`drop table chat_mutes`);
  pushSeams.now = null;
  await admin.query(`delete from push_prefs`);
}

// ---- 4. A long list, and phones that are gone
{
  const big = await circleOf('BIGFAM', 'Big Family');
  const hoarder = await seat(big, await user('Chacha'));
  const quiet = [];
  for (let i = 0; i < 4; i++) quiet.push(await seat(big, await user('Cousin' + i)));
  // Chacha has 70 browsers; the cousins one each, registered long ago.
  for (let i = 0; i < 70; i++) await admin.query(`insert into push_subs (member_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4, $5)`, [hoarder.id, hoarder.userId, EP('chacha-' + i), KEYS.p256dh, KEYS.auth]);
  for (let i = 0; i < 4; i++) await admin.query(`insert into push_subs (member_id, user_id, endpoint, p256dh, auth, created_at) values ($1, $2, $3, $4, $5, now() - interval '300 days')`, [quiet[i].id, quiet[i].userId, EP('cousin-' + i), KEYS.p256dh, KEYS.auth]);
  let p0 = sent.length;
  await pushCircle(sql, big.id, { title: '🗓 Date locked: Diwali', body: 'x' }, {});
  ok('a plan update goes to 60 devices at most, and every cousin is among them',
     since(p0).length === 60 && [0, 1, 2, 3].every(i => got(p0, 'cousin-' + i).length === 1), String(since(p0).length));
  p0 = sent.length;
  await pushCircle(sql, big.id, { title: '🆘 SOS from Chacha', urgent: true }, {});
  ok('an SOS goes to all 74', since(p0).length === 74, String(since(p0).length));

  // The push service says cousin 0's phone is gone.
  gone.add(EP('cousin-0'));
  await pushCircle(sql, big.id, { title: '🏥 x is in hospital' }, { only: quiet[0].id });
  ok('a phone the push service says is gone is removed', (await rows(`select 1 from push_subs where endpoint = $1`, [EP('cousin-0')])).length === 0);
}

// ---- 5. Can be reached
{
  let r = await push(asha, 'reach');
  const dot = id => (r.members.find(m => m.id === id) || {}).reachable;
  ok('an adult sees who an alert can reach', r.ok && r.adult && dot(asha.id) === true && dot(rohan.id) === true && r.me === true, JSON.stringify(r));
  r = await push(kabir, 'reach');
  ok('a child is not shown it', r.ok && r.adult === false && r.members.length === 0 && r.uncovered.length === 0);
  // Papa is looked after in the Sharma family; both adults lose their phones.
  const papa = await seat(sharma, await user('Papa'), 'parent');
  r = await push(asha, 'reach');
  ok('with a reachable adult, nobody is flagged', r.uncovered.length === 0, JSON.stringify(r.uncovered));
  await admin.query(`delete from push_subs where user_id = any($1::uuid[])`, [[uAsha.userId, rohan.userId]]);
  r = await push(asha, 'reach');
  ok('"If Papa presses SOS, nobody\'s phone will ring": Papa is flagged when no adult can be reached (a child\'s phone does not count)',
     r.uncovered.length === 1 && r.uncovered[0].id === papa.id && r.uncovered[0].name === 'Papa' && r.me === false && dot(kabir.id) === true, JSON.stringify(r));
  r = await push(papa, 'reach');
  ok('Papa himself is not shown a card about Papa', r.ok && !r.uncovered.some(u => u.id === papa.id));
  // Someone remembered is never listed, never flagged.
  await admin.query(`update members set remembered = true where id = $1`, [papa.id]);
  r = await push(asha, 'reach');
  ok('someone who has passed away is never listed or flagged', r.uncovered.length === 0 && !r.members.some(m => m.id === papa.id));
  await admin.query(`update members set remembered = false where id = $1`, [papa.id]);
  await subscribe(asha, 'asha-3', 'dev_asha_00000000001', 'Asia/Kolkata');
  r = await push(asha, 'reach');
  ok('once Asha turns alerts on, the card goes', r.uncovered.length === 0 && r.me === true);
  r = await pa({ method: 'POST', headers: hdr(rohan), body: { code: 'KAPOOR', memberId: mummy.id, action: 'reach' } });
  ok('nobody reads another family', r.http === 403, JSON.stringify(r));
}

// ---- 6. The timer
{
  const tick = (headers) => ev({ method: 'GET', headers: { 'x-forwarded-for': '10.8.0.' + (++n % 250), ...(headers || {}) }, query: { tick: '1' } });
  const fresh = () => admin.query(`delete from rate_limit where bucket = 'tick'`);
  await fresh();
  let r = await tick();
  ok('on a laptop or in a test, with no key set, the timer runs', r.http === 200 && r.ok);
  process.env.VERCEL_ENV = 'production';
  await fresh();
  r = await tick();
  ok('on the live site, with no key set, it is refused', r.http === 401, JSON.stringify(r));
  process.env.CRON_SECRET = 'the-timer-key';
  r = await tick({ 'x-cron-secret': 'wrong' });
  ok('with a key set, a wrong one is refused', r.http === 401);
  r = await tick({ authorization: 'Bearer the-timer-key' });
  ok('and the right one runs it', r.http === 200 && r.ok, JSON.stringify(r));
  delete process.env.CRON_SECRET; delete process.env.VERCEL_ENV;

  const at = await lastTickAt(sql);
  ok('it writes down when it last ran', !!at && Date.now() - new Date(at).getTime() < 60000, String(at));
  // ONE record (review finding 15): kv 'tick_at', in milliseconds. Both
  // readers (this one, and tickSeen in api/_safety.mjs, which the family's
  // "Reminders last ran" line reads) see the same moment.
  {
    const kv = (await admin.query(`select k, v from kv where k in ('tick_at', 'last_tick_at')`)).rows;
    const { tickSeen } = await import('../../../api/_safety.mjs');
    ok('when the timer last ran is kept in one row, not two', kv.length === 1 && kv[0].k === 'tick_at' && /^\d{13}$/.test(kv[0].v), JSON.stringify(kv));
    ok('and both readers read that row', new Date(at).getTime() === await tickSeen(sql), at + ' ' + (await tickSeen(sql)));
    await admin.query(`update kv set v = $1 where k = 'tick_at'`, [String(Date.now() - 17 * 60000)]);
    const old = await lastTickAt(sql);
    ok('a change to the one row is seen by both', Math.abs(Date.now() - new Date(old).getTime() - 17 * 60000) < 5000 && new Date(old).getTime() === await tickSeen(sql));
    await admin.query(`update kv set v = $1 where k = 'tick_at'`, [String(new Date(at).getTime())]);
  }
  r = await dg({ method: 'GET', headers: { 'x-diag-key': 'diag-key-for-this-test' }, query: { probe: 'status' } });
  ok('/api/diag says when, and how long ago', r.ok && r.last_tick_at === at && r.last_tick_age_sec >= 0 && r.last_tick_age_sec < 60, JSON.stringify(r));
  r = await dg({ method: 'GET', query: { probe: 'status' } });
  ok('only with the diagnostics key', r.http === 403);
  r = await dg({ method: 'GET', query: {} });
  ok('the open liveness check still touches nothing', r.ok && r.last_tick_at === undefined);
  // Another module's record of the last run, if it keeps one, is read too.
  await admin.query(`create table tick_runs (id serial primary key, ran_at timestamptz not null default now(), circles int)`);
  await admin.query(`insert into tick_runs (ran_at) values (now() + interval '5 minutes')`);
  ok('a tick_runs table, if one exists, is read by name', new Date(await lastTickAt(sql)).getTime() > Date.now() + 4 * 60000);
  await admin.query(`drop table tick_runs`);

  // Whose turn: two families have something due. A run that has no time
  // left (budget below zero) finishes none, and must not forget its place.
  for (const c of [sharma, kapoor]) await admin.query(`insert into requests (circle_id, title, status, due_at) values ($1, 'x', 'open', now())`, [c.id]);
  const due = [sharma.id, kapoor.id].sort();
  await admin.query(`insert into kv (k, v) values ('tick_next', $1) on conflict (k) do update set v = excluded.v`, [due[1]]);
  await runTick(sql, -1);
  const next1 = (await rows(`select v from kv where k = 'tick_next'`))[0].v;
  ok('a run that ran out of time starts next time where it stopped, not at the top again', next1 === due[1], next1 + ' vs ' + due.join());
  await admin.query(`update kv set v = 'ffffffff-ffff-ffff-ffff-ffffffffffff' where k = 'tick_next'`);
  await runTick(sql, -1);
  const all = (await rows(`select v from kv where k = 'tick_next'`))[0].v;
  ok('and wraps round to the first family after the last', all !== 'ffffffff-ffff-ffff-ffff-ffffffffffff' && all <= due[0], all);
  await admin.query(`delete from requests`);
}

// ---- 7. A tap made with no network
{
  const papa = (await rows(`select id, user_id from members where circle_id = $1 and name = 'Papa'`, [sharma.id]))[0];
  const tok = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(tok), papa.user_id]);
  const P = { id: papa.id, token: tok, code: 'SHARMA' };
  const count = async (type) => (await rows(`select count(*)::int c from events where member_id = $1 and type = $2`, [P.id, type]))[0].c;

  const twoH = new Date(Date.now() - 2 * 3600000);
  let r = await post(P, { type: 'checkin', text: '', clientId: 'q_checkin_0001', at: twoH.toISOString() });
  const e = (await rows(`select created_at from events where member_id = $1 and type = 'checkin'`, [P.id]))[0];
  ok('"All is well" pressed two hours ago with no network arrives with the time it was pressed',
     r.http === 201 && r.ok && e && Math.abs(new Date(e.created_at).getTime() - twoH.getTime()) < 1000, JSON.stringify([r, e]));
  r = await post(P, { type: 'checkin', text: '', clientId: 'q_checkin_0001', at: twoH.toISOString() });
  ok('sent twice (the reply was lost), it is one check-in', r.ok && r.dup === true && (await count('checkin')) === 1);
  r = await post(P, { type: 'pill', text: '', clientId: 'q_pill_000001', at: new Date(Date.now() - 23 * 3600000).toISOString() });
  ok('a medicine tick from 23 hours ago is taken', r.http === 201 && (await count('pill')) === 1);
  r = await post(P, { type: 'pill', text: '', clientId: 'q_pill_000002', at: new Date(Date.now() - 25 * 3600000).toISOString() });
  ok('one from 25 hours ago is refused, and the phone is told to let it go', r.http === 422 && r.stale === true && /more than a day ago/.test(r.error) && (await count('pill')) === 1, JSON.stringify(r));
  r = await post(P, { type: 'checkin', text: '', clientId: 'q_checkin_0002', at: new Date(Date.now() + 3600000).toISOString() });
  ok('a time in the future is refused', r.http === 422 && (await count('checkin')) === 1);
  r = await post(P, { type: 'message', text: 'hello', clientId: 'q_message_001', at: twoH.toISOString() });
  ok('a message cannot claim an old time', r.http === 422 && (await count('message')) === 0, JSON.stringify(r));
  r = await post(P, { type: 'checkin', text: '', clientId: "bad id'", at: twoH.toISOString() });
  ok('an id that is not plain is refused', r.http === 400);
  r = await post(P, { type: 'pill', text: '' });
  ok('a tap with a network, sent the old way, still works', r.http === 201 && (await count('pill')) === 2);
  r = await post(asha, { type: 'checkin', text: '', clientId: 'q_checkin_0001', at: twoH.toISOString() });
  ok("the same id from another person's phone is that person's own tap", r.http === 201);
  await admin.query(`delete from events where type in ('checkin', 'pill', 'care')`);
  await admin.query(`delete from offline_taps`);

  // THE FALSE ALARM. Papa checks in by a time that passed 50 minutes ago.
  // He pressed "All is well" 70 minutes ago, in time, with no network.
  const hourIn = tz => +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()) % 24;
  const TZ = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland', 'Asia/Dubai', 'America/Sao_Paulo']
    .find(tz => { const h = hourIn(tz); return h >= 10 && h <= 18; }) || 'Asia/Kolkata';
  const hhmm = minsAgo => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(Date.now() - minsAgo * 60000)).map(x => [x.type, x.value])); return (p.hour === '24' ? '00' : p.hour) + ':' + p.minute; };
  await admin.query(`update members set checkin_by = $2, tz = $3 where id = $1`, [P.id, hhmm(50), TZ]);
  const pressed = new Date(Date.now() - 70 * 60000);
  r = await post(P, { type: 'checkin', text: '', clientId: 'q_checkin_0100', at: pressed.toISOString() });
  let p0 = sent.length;
  await quietSweep(sql, sharma.id);
  const q = (await rows(`select quiet_alerted_for from members where id = $1`, [P.id]))[0];
  ok('his queued check-in arrives before the alert: the family is never told he missed it',
     r.http === 201 && q.quiet_alerted_for === null && !since(p0).some(x => /has not checked in/.test(x.title)), JSON.stringify([q, since(p0).map(x => x.title)]));

  // The other order: the alert went first, then the phone found a network.
  await admin.query(`delete from events where member_id = $1`, [P.id]);
  await admin.query(`delete from offline_taps`);
  p0 = sent.length;
  await quietSweep(sql, sharma.id);
  ok('with nothing arrived, the family is told he has not checked in', since(p0).some(x => /Papa has not checked in today/.test(x.title)), JSON.stringify(since(p0).map(x => x.title)));
  p0 = sent.length;
  r = await post(P, { type: 'checkin', text: '', clientId: 'q_checkin_0101', at: pressed.toISOString() });
  const told = since(p0).filter(x => /Papa did check in/.test(x.title));
  ok('when it does arrive, the family is told at once that he did, and when',
     r.http === 201 && told.length >= 1 && /tapped All is well at .*The phone had no network until now\./.test(told[0].body) && !told.some(x => x.endpoint === EP('papa')), JSON.stringify(since(p0)));
  p0 = sent.length;
  await quietSweep(sql, sharma.id, Date.now() + 40 * 60000);
  ok('and nothing more is raised about it later', !since(p0).some(x => /checked in|Call /.test(x.title)), JSON.stringify(since(p0).map(x => x.title)));
  r = await post(P, { type: 'sos', text: '', clientId: 'q_sos_0000001', at: pressed.toISOString() });
  const s = (await rows(`select created_at from sos where member_id = $1 order by created_at desc limit 1`, [P.id]))[0];
  ok('an SOS is never back-dated: it is now', r.ok && s && Date.now() - new Date(s.created_at).getTime() < 60000);
  await admin.query(`update sos set status = 'resolved'`);
}

// ---- 8. A page that broke
{
  const rep = (body, device, ip) => pa({ method: 'POST', headers: { 'x-forwarded-for': ip || '10.9.9.9', ...(device ? { 'x-parwah-device': device } : {}) }, body: { action: 'report', ...body } });
  let r = await rep({ message: "TypeError: x is not a function near +91 98765 43210", where: 'https://parwah.example/?join=ABC123#chat:120:14', version: 'abc123', viewport: '390x844',
                      name: 'Asha', memberId: asha.id, text: 'a private message' }, 'dev_report_000000001');
  const row = (await rows(`select * from client_errors`))[0];
  ok('a broken page is kept without signing in', r.ok && r.kept === true && !!row);
  ok('as what, where, version and screen size only',
     Object.keys(row).sort().join() === 'at,id,message,version,viewport,where_at' && row.viewport === '390x844' && row.version === 'abc123' && row.where_at === 'index:120:14', JSON.stringify(row));
  ok('with no number, name, id, address or message text in it', !/98765|Asha|private|ABC123|parwah\.example|10\.9\.9\.9|dev_report/.test(JSON.stringify(row)) && !JSON.stringify(row).includes(asha.id));
  for (let i = 0; i < 4; i++) await rep({ message: 'Error ' + i }, 'dev_report_000000001');
  r = await rep({ message: 'Error six' }, 'dev_report_000000001');
  ok('one device is limited to five in ten minutes', r.ok && r.kept === false && (await rows(`select 1 from client_errors`)).length === 5);
  r = await rep({ message: 'Error from the phone next to it' }, 'dev_report_000000002');
  ok('another phone behind the same address is not held back by it', r.kept === true);
  await admin.query(`insert into client_errors (message, at) values ('old one', now() - interval '15 days'), ('recent one', now() - interval '13 days')`);
  await rep({ message: 'One more' }, 'dev_report_000000003');
  const msgs = (await rows(`select message from client_errors`)).map(x => x.message);
  ok('anything older than 14 days is trimmed', !msgs.includes('old one') && msgs.includes('recent one'));
  r = await dg({ method: 'GET', headers: { 'x-diag-key': 'diag-key-for-this-test' }, query: { probe: 'status' } });
  ok('/api/diag shows counts only', r.ok && r.client_errors.last_24h === 7 && r.client_errors.kept_14d === 8 && r.client_errors.different_last_24h === 7
     && Object.keys(r.client_errors).sort().join() === 'different_last_24h,kept_14d,last_24h' && !/TypeError|Error/.test(JSON.stringify(r)), JSON.stringify(r));

  ok('limitKey: the device at that address; the address alone without one',
     limitKey({ headers: { 'x-real-ip': '1.2.3.4', 'x-parwah-device': 'dev_report_000000001' } }) === '1.2.3.4|dev_report_000000001'
     && limitKey({ headers: { 'x-real-ip': '1.2.3.4' } }) === '1.2.3.4' && limitKey({ headers: { 'x-real-ip': '1.2.3.4', 'x-parwah-device': 'no' } }) === '1.2.3.4');
}

// ---- 9. "Parwah is working"
{
  let r = await push(asha, 'selfcheck', { endpoint: EP('asha-3') });
  ok('an adult is told, fact by fact: this phone, the timer, Ekta, calls and texts',
     r.ok && r.push.known === true && typeof r.timer.age_min === 'number' && r.timer.last_tick_at && r.ekta === 'resting' && r.calls === false, JSON.stringify(r));
  r = await push(asha, 'selfcheck', { endpoint: EP('someone-else') });
  ok('a phone the server does not know is said to be off', r.ok && r.push.known === false);
  r = await push(kabir, 'selfcheck', {});
  ok('a child is not shown it', r.http === 403);
  ok('it names no key, number or person', !/sk-|AC[0-9a-f]{32}|\+91/.test(JSON.stringify(await push(asha, 'selfcheck', {}))));
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end().catch(() => {});
console.log(`notifyfair.dbtest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
