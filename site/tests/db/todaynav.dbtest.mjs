// TODAY, FOR EACH PERSON against a real database, through the real handlers
// (/api/chats, /api/plans, /api/circle).
//
// The one read behind "From the family" (GET /api/chats?area=today) gathers
// what is waiting for a member from the modules that own each part. What
// this proves is that gathering never widens what anybody may see:
//   1. Nothing waiting is an empty list, and an outsider is refused.
//   2. A message to Papa is on Papa's Today and nobody else's; a message in
//      the family chat is on everyone's but the writer's; opening the chat
//      clears it; a muted chat stays quiet; a new member sees nothing from
//      before they joined.
//   3. A private word between two others never appears: not to a third
//      member, not to a child, not to a member of another family.
//   4. An Ashirwad, "How is your day?" and a shukriya reach the person they
//      were for, and leave once answered.
//   5. A plan waits with "Going?" until it is answered; a poll until voted.
//   6. A card to write in is never shown to the person it is for.
//   7. Someone asking to join is shown to adults only. A child gets none,
//      and no adult-only item of any kind.
//   8. A card for each parent, for a grown-up only: checked in today or
//      not, today's medicines as the viewer may see them (a private
//      medicine is left out), the last message, and a number only when the
//      parent lets this person see it. Never for someone remembered.
//   9. A member of another family gets nothing of this family's.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('todaynav.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('todaynav.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const webpush = (await import('web-push')).default;
webpush.sendNotification = async () => ({});

const api = {};
for (const n of ['chats', 'plans', 'circle', 'care', 'book', 'events']) api[n] = (await import(`../../../api/${n}.mjs`)).default;
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { ensurePushSchema } = await import('../../../api/_push.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const Bond = await import('../../../api/_bond.mjs');
const Heard = await import('../../../api/_heard.mjs');
const Today = await import('../../../api/_today.mjs');
const sql = db();
await ensureSchema(sql); await ensurePushSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

let n = 0;
async function call(handler, { method = 'POST', body = {}, query = {}, token }) {
  const req = { method, headers: { 'x-parwah-token': token, 'x-parwah-tz': 'Asia/Kolkata', 'x-forwarded-for': '10.7.' + (++n % 250) + '.' + (n % 199) }, query, body };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() { return this; }, end() { return this; } };
  await handler(req, res);
  return { ...(json || {}), status };
}
await call(api.plans, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });
await Bond.ensureBondSchema(sql); await Heard.ensureHeardSchema(sql);
await (await import('../../../api/_remember.mjs')).ensureRememberSchema(sql);
async function user(name) {
  const phone = '+9198760' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token, phone };
}
async function seat(circleId, code, u, role = 'family', dob = null, phone = null) {
  const m = (await admin.query(`insert into members (circle_id, name, user_id, role, dob, phone, created_at) values ($1,$2,$3,$4,$5,$6, now() - interval '30 days') returning id`,
    [circleId, u.name, u.userId || null, role, dob, phone])).rows[0];
  return { id: m.id, name: u.name, token: u.token, code };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA24','Sharma Family') returning id`)).rows[0].id;
const other = (await admin.query(`insert into circles (code, name) values ('VERMA247','Verma Family') returning id`)).rows[0].id;
const U = { rohan: await user('Rohan'), priya: await user('Priya'), papa: await user('Papa'), maa: await user('Maa'), kabir: await user('Kabir'), vikram: await user('Vikram') };
const rohan = await seat(fam, 'SHARMA24', U.rohan, 'family', '1988-03-04', '+919811100001');
const priya = await seat(fam, 'SHARMA24', U.priya, 'family', '1990-07-09', '+919811100002');
const papa = await seat(fam, 'SHARMA24', U.papa, 'parent', '1958-01-20', '+919811100003');
const maa = await seat(fam, 'SHARMA24', U.maa, 'parent', '1960-05-11', '+919811100004');
const kabir = await seat(fam, 'SHARMA24', U.kabir, 'family', '2012-05-05');      // 14
// Dadaji is remembered: never a card, never a call.
const dadaji = await seat(fam, 'SHARMA24', { name: 'Dadaji' }, 'parent', '1930-01-01', '+919811100009');
await admin.query(`update members set remembered = true, passed_year = 2019 where id = $1`, [dadaji.id]);
const vikram = await seat(other, 'VERMA247', U.vikram, 'family', '1985-01-01');
// Vikram's own token, pointed at the Sharmas: an outsider. And Vikram's
// token posing as Priya: a member id that is real, with somebody else's key.
const outsider = { id: vikram.id, token: vikram.token, code: 'SHARMA24' };
const posing = { id: priya.id, token: vikram.token, code: 'SHARMA24' };

const T = (who) => call(api.chats, { method: 'GET', token: who.token, query: { area: 'today', circle: who.code, member: who.id } });
const C = (who, action, body = {}) => call(api.chats, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const CG = (who, query = {}) => call(api.chats, { method: 'GET', token: who.token, query: { circle: who.code, member: who.id, ...query } });
const H = (who, action, body = {}) => call(api.chats, { token: who.token, body: { area: 'heard', code: who.code, memberId: who.id, action, ...body } });
const ASH = (who, body = {}) => call(api.chats, { token: who.token, body: { area: 'ashirwad', code: who.code, memberId: who.id, ...body } });
const P = (who, action, body = {}) => call(api.plans, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const kinds = (r, k) => (r.items || []).filter(x => x.kind === k);
const all = async (whos) => Object.fromEntries(await Promise.all(Object.entries(whos).map(async ([k, w]) => [k, await T(w)])));
const blob = (r) => JSON.stringify(r);
const famChat = (await CG(rohan)).chats.find(c => c.kind === 'circle').id;

// ================================================================ 1. nothing waiting
{
  const r = await T(rohan);
  ok('1. nothing waiting is an empty list', r.status === 200 && r.ok && Array.isArray(r.items) && r.items.length === 0 && r.unread.messages === 0, blob(r));
  ok('1. the read says who I am to Today: a grown-up, not in senior mode', r.me.minor === false && r.me.senior === false && !!r.me.joinedAt);
  ok('1. Papa is in senior mode; Kabir is under 18 by the one adult rule', (await T(papa)).me.senior === true && (await T(kabir)).me.minor === true && (await T(kabir)).me.senior === false);
  ok('1. an outsider is refused', (await T(outsider)).status === 403, String((await T(outsider)).status));
  ok('1. a real member id with somebody else\'s key is refused', (await T(posing)).status === 403);
  ok('1. no key at all is refused', (await call(api.chats, { method: 'GET', query: { area: 'today', circle: 'SHARMA24', member: rohan.id } })).status === 401);
  ok('1. a member id that is not one is refused', (await call(api.chats, { method: 'GET', token: rohan.token, query: { area: 'today', circle: 'SHARMA24', member: 'x' } })).status === 400);
  ok('1. it only reads', (await call(api.chats, { method: 'POST', token: rohan.token, body: { area: 'today', code: 'SHARMA24', memberId: rohan.id } })).status === 405);
}

// ================================================================ 2. messages
let dmRP;
{
  dmRP = (await C(rohan, 'open_dm', { otherId: papa.id })).chatId;
  await C(rohan, 'send', { chatId: dmRP, text: 'Papa, kal subah doctor ke paas chalna hai. Dus baje tak tayyar rehna.' });
  let r = await all({ papa, priya, kabir, maa, rohan });
  const m = kinds(r.papa, 'message');
  ok('2. Rohan\'s message to Papa is on Papa\'s Today: who, the first words, how many', m.length === 1 && m[0].fromName === 'Rohan' && /^Papa, kal subah doctor/.test(m[0].text) && m[0].n === 1 && m[0].chatId === dmRP && m[0].chatKind === 'dm', blob(m));
  ok('2. and Papa\'s chat bubble has something to show', r.papa.unread.chats === 1 && r.papa.unread.messages === 1);
  ok('2. NOBODY ELSE SEES A MESSAGE BETWEEN THE TWO OF THEM: not Priya, not Maa, not Kabir', ['priya', 'maa', 'kabir'].every(k => !kinds(r[k], 'message').length && !/doctor ke paas/.test(blob(r[k]))));
  ok('2. the writer is not told about their own message', !kinds(r.rohan, 'message').length);
  await C(priya, 'send', { chatId: famChat, text: 'Sunday ko sab ghar aa rahe ho na?' });
  await C(priya, 'send', { chatId: famChat, text: 'Main kheer bana rahi hoon' });
  r = await all({ papa, priya, kabir, maa, rohan });
  ok('2. a message in the family chat is on everyone\'s Today but the writer\'s', ['papa', 'kabir', 'maa', 'rohan'].every(k => kinds(r[k], 'message').some(x => x.chatKind === 'circle' && x.fromName === 'Priya' && x.n === 2 && /kheer/.test(x.text)))
    && !kinds(r.priya, 'message').length, blob(kinds(r.kabir, 'message')));
  ok('2. Papa has two chats waiting, newest first', kinds(r.papa, 'message').length === 2 && kinds(r.papa, 'message')[0].chatKind === 'circle' && r.papa.unread.messages === 3);
  await CG(papa, { chat: dmRP });
  r = await T(papa);
  ok('2. opening the chat clears it from Today', kinds(r, 'message').length === 1 && kinds(r, 'message')[0].chatKind === 'circle');
  await C(maa, 'mute', { chatId: famChat, on: true });
  ok('2. a chat Maa muted stays quiet on her Today', !kinds(await T(maa), 'message').length, blob(kinds(await T(maa), 'message')));
  await C(maa, 'mute', { chatId: famChat, on: false });
  // Someone who joins today sees nothing from before they joined.
  const late = await user('Chacha');
  const chacha = { id: (await admin.query(`insert into members (circle_id, name, user_id, role, dob) values ($1,'Chacha',$2,'family','1970-01-01') returning id`, [fam, late.userId])).rows[0].id, token: late.token, code: 'SHARMA24' };
  ok('2. a new member\'s Today has nothing from before they joined', !kinds(await T(chacha), 'message').length, blob((await T(chacha)).items));
  await C(rohan, 'send', { chatId: famChat, text: 'Welcome Chacha' });
  ok('2. and has what was written after', kinds(await T(chacha), 'message').length === 1 && kinds(await T(chacha), 'message')[0].n === 1);
  await admin.query(`delete from members where id = $1`, [chacha.id]);
  // A photo and a voice note are named, never sent whole.
  await C(rohan, 'send', { chatId: dmRP, kind: 'audio', text: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC', secs: 4 });
  r = await T(papa);
  ok('2. a voice note is named as one; its sound is never in the list', kinds(r, 'message').some(x => x.text === 'A voice note' && x.voice) && !/GkXfo59/.test(blob(r)));
  await CG(papa, { chat: dmRP }); await CG(papa, { chat: famChat });
}

// ================================================================ 3. a private word
{
  let r0 = await H(priya, 'baat_send', { kind: 'talk', toId: rohan.id, line: 'Kal ki baat par thoda bura laga' });
  ok('3. Priya sends Rohan "Mujhe baat karni hai"', r0.status === 201, blob(r0));
  const r = await all({ rohan, priya, papa, maa, kabir });
  const w = kinds(r.rohan, 'word');
  ok('3. it waits on Rohan\'s Today', w.length === 1 && w[0].fromName === 'Priya' && /bura laga/.test(w[0].text), blob(w));
  ok('3. A PRIVATE WORD BETWEEN TWO OTHERS NEVER APPEARS: not to Papa, Maa or Kabir', ['papa', 'maa', 'kabir'].every(k => !kinds(r[k], 'word').length && !/bura laga/.test(blob(r[k])) && !/baat karni/.test(blob(r[k]))));
  ok('3. the sender is not asked to answer their own word', !kinds(r.priya, 'word').length);
  ok('3. a member of another family sees none of it', !/bura laga/.test(blob(await T(vikram))) && (await T(vikram)).items.length === 0);
  const br = await H(rohan, 'baat_reply', { id: w[0].id, reply: 'call', at: '7 this evening' });
  ok('3. Rohan answers it', br.status === 200 || br.status === 201, blob(br));
  const after = await T(rohan);
  ok('3. once answered it leaves Today', !kinds(after, 'word').length, blob(kinds(after, 'word')));
}

// ================================================================ 4. ashirwad, how is your day, shukriya
{
  let a = await ASH(papa, { action: 'bless', to: rohan.id, line: 'khush' });
  ok('4. Papa blesses Rohan', a.status === 201 || a.status === 200, blob(a));
  a = await ASH(rohan, { action: 'howday', to: maa.id });
  ok('4. Rohan asks Maa "How is your day?"', a.status === 201 || a.status === 200, blob(a));
  let r = await all({ rohan, maa, priya, kabir, papa });
  ok('4. the blessing waits on Rohan\'s Today, from Papa', kinds(r.rohan, 'blessing').length === 1 && kinds(r.rohan, 'blessing')[0].fromName === 'Papa');
  ok('4. "How is your day?" waits on Maa\'s Today, from Rohan', kinds(r.maa, 'day').length === 1 && kinds(r.maa, 'day')[0].fromName === 'Rohan');
  ok('4. neither is on anybody else\'s Today', ['priya', 'kabir', 'papa'].every(k => !kinds(r[k], 'blessing').length && !kinds(r[k], 'day').length));
  const s = await H(kabir, 'shukriya_send', { toId: maa.id, line: 'Thank you for the aloo paratha' });
  ok('4. Kabir thanks Maa', s.status === 201, blob(s));
  r = await all({ rohan, maa, priya, kabir, papa });
  ok('4. the thank-you is on Maa\'s Today', kinds(r.maa, 'thanks').length === 1 && kinds(r.maa, 'thanks')[0].fromName === 'Kabir' && /aloo paratha/.test(kinds(r.maa, 'thanks')[0].text));
  ok('4. a thank-you between two people is on nobody else\'s Today', ['rohan', 'priya', 'papa', 'kabir'].every(k => !kinds(r[k], 'thanks').length && !/aloo paratha/.test(blob(r[k]))));
  await admin.query(`update shukriya set created_at = now() - interval '4 days'`);
  ok('4. after three days the thank-you steps off Today', !kinds(await T(maa), 'thanks').length);
}

// ================================================================ 5. plans and polls
let planId;
{
  const at = new Date(Date.now() + 3 * 86400000).toISOString();
  const p = await P(priya, 'create', { title: "Papa's birthday dinner", kind: 'party', at });
  ok('5. Priya makes a plan', p.status === 201, blob(p));
  planId = p.id;
  let r = await all({ rohan, papa, kabir, priya, maa });
  ok('5. it waits on everyone\'s Today with "Going?": Rohan, Papa, Maa and Kabir', ['rohan', 'papa', 'maa', 'kabir'].every(k => kinds(r[k], 'plan').length === 1 && kinds(r[k], 'plan')[0].id === planId && kinds(r[k], 'plan')[0].fromName === 'Priya'), blob(kinds(r.kabir, 'plan')));
  ok('5. the person who made it is not asked', !kinds(r.priya, 'plan').length);
  await P(papa, 'rsvp', { planId, answer: 'in' });
  await P(kabir, 'rsvp', { planId, answer: 'maybe' });
  await P(maa, 'rsvp', { planId, answer: 'no' });
  r = await all({ rohan, papa, kabir, maa });
  ok('5. Yes, Maybe or No each answer it, and it leaves that person\'s Today', !kinds(r.papa, 'plan').length && !kinds(r.kabir, 'plan').length && !kinds(r.maa, 'plan').length && kinds(r.rohan, 'plan').length === 1);
  await admin.query(`update plans set at = now() - interval '1 hour' where id = $1`, [planId]);
  ok('5. a plan whose time has gone no longer asks', !kinds(await T(rohan), 'plan').length);
  await admin.query(`update plans set at = $2 where id = $1`, [planId, at]);
  // A poll in the family chat, started by the teenager.
  const poll = await C(kabir, 'poll_create', { chatId: famChat, question: 'Sunday ko kya khayenge?', options: ['Chole bhature', 'Dosa', 'Biryani'] });
  ok('5. Kabir starts a poll in the family chat', poll.status === 201, blob(poll));
  r = await all({ rohan, papa, kabir, maa, priya });
  ok('5. A QUIETER MEMBER\'S POLL REACHES EVERY TODAY: Rohan, Papa, Maa and Priya', ['rohan', 'papa', 'maa', 'priya'].every(k => kinds(r[k], 'poll').some(x => x.poll === 'chat' && /kya khayenge/.test(x.text) && x.fromName === 'Kabir')), blob(kinds(r.papa, 'poll')));
  ok('5. not the one who asked', !kinds(r.kabir, 'poll').length);
  const pid = kinds(r.papa, 'poll')[0].id;
  await C(papa, 'poll_vote', { chatId: famChat, pollId: pid, choices: [2] });
  ok('5. once Papa votes it leaves his Today, and stays on Maa\'s', !kinds(await T(papa), 'poll').length && kinds(await T(maa), 'poll').length === 1);
  // A poll in a chat between two people never reaches a third.
  const dm = (await C(priya, 'open_dm', { otherId: maa.id })).chatId;
  await C(priya, 'poll_create', { chatId: dm, question: 'Surprise gift for Papa?', options: ['Watch', 'Kurta'] });
  r = await all({ rohan, papa, kabir, maa });
  ok('5. a poll in a chat of two is on the other one\'s Today only', kinds(r.maa, 'poll').some(x => /Surprise gift/.test(x.text)) && ['rohan', 'papa', 'kabir'].every(k => !/Surprise gift/.test(blob(r[k]))));
  // A date poll for a plan.
  const dp = await P(rohan, 'bond_poll_create', { title: 'Diwali get-together', options: [new Date(Date.now() + 9 * 86400000).toISOString(), new Date(Date.now() + 10 * 86400000).toISOString()] });
  ok('5. Rohan asks which date suits', dp.status === 201, blob(dp));
  r = await all({ priya, kabir });
  ok('5. the date poll waits on Priya\'s and Kabir\'s Today', ['priya', 'kabir'].every(k => kinds(r[k], 'poll').some(x => x.poll === 'date' && /Diwali/.test(x.text))), blob(kinds(r.priya, 'poll')));
}

// ================================================================ 6. a card
{
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const c = await P(rohan, 'bond_card_start', { forMember: papa.id, occasion: 'birthday', date: day, title: "Papa's birthday card" });
  ok('6. Rohan starts a card for Papa', c.status === 201, blob(c));
  const r = await all({ rohan, priya, papa, kabir, maa });
  ok('6. it waits on Priya\'s, Maa\'s and Kabir\'s Today: "a card you have not written in yet"', ['priya', 'maa', 'kabir'].every(k => kinds(r[k], 'card').some(x => /Papa's birthday card/.test(x.text))));
  ok('6. THE CARD IS NEVER SHOWN TO THE PERSON IT IS FOR', !kinds(r.papa, 'card').length && !/birthday card/.test(blob(r.papa)));
  await P(priya, 'bond_card_add', { cardId: c.id, kind: 'text', text: 'Happy birthday Papa' });
  ok('6. once Priya has written in it, it leaves her Today', !kinds(await T(priya), 'card').length && kinds(await T(maa), 'card').length === 1);
}

// ================================================================ 7. someone at the door
{
  const nu = await user('Bua');
  const j = await call(api.circle, { token: nu.token, body: { action: 'join', code: 'SHARMA24', memberName: 'Bua', userId: nu.userId, role: 'family', relation: 'sister' } });
  ok('7. Bua asks to join and waits', j.status === 202 && j.pending === true, blob(j));
  const r = await all({ rohan, priya, papa, kabir, maa });
  ok('7. "Bua is asking to join" is first on every adult\'s Today', ['rohan', 'priya', 'papa', 'maa'].every(k => r[k].items[0] && r[k].items[0].kind === 'join' && r[k].items[0].fromName === 'Bua'), blob(r.rohan.items[0]));
  ok('7. A CHILD IS NEVER SENT IT: Kabir gets no adults-only item at all', !kinds(r.kabir, 'join').length && !/Bua/.test(blob(r.kabir.items)));
  ok('7. no phone number of someone not in the family yet is in any Today', !blob(r).includes(nu.phone));
  ok('7. the order is one order: join, then messages, then the rest', (() => { const o = r.rohan.items.map(x => x.kind); const rank = ['join', 'word', 'message', 'day', 'blessing', 'thanks', 'plan', 'poll', 'card'];
    return o.every((k, i) => i === 0 || rank.indexOf(o[i - 1]) <= rank.indexOf(k)); })(), r.rohan.items.map(x => x.kind).join(','));
  const yes = await call(api.circle, { token: rohan.token, body: { action: 'approve_join', code: 'SHARMA24', memberId: rohan.id, requestId: r.rohan.items[0].id } });
  ok('7. Rohan lets her in' + (yes.status === 200 ? '' : ' (' + yes.status + ' ' + yes.error + ')'), yes.status === 200 || yes.status === 201, blob(yes));
  ok('7. and the card is gone from every Today', !kinds(await T(priya), 'join').length);
}

// ================================================================ 8. a card for each parent
{
  let r = await all({ rohan, priya, papa, kabir });
  ok('8. Rohan gets a card for Papa and one for Maa', r.rohan.parents.length === 2 && r.rohan.parents.map(p => p.name).join() === 'Papa,Maa', blob(r.rohan.parents.map(p => p.name)));
  ok('8. never one for Dadaji, who is remembered', !r.rohan.parents.some(p => p.name === 'Dadaji') && !blob(r.rohan.parents).includes('9811100009'));
  ok('8. a child gets no parent cards', r.kabir.parents.length === 0);
  ok('8. Papa, in senior mode, gets none on his calm screen', r.papa.parents.length === 0);
  // Papa wrote in the family chat today, which is a sign that he is alright.
  await C(papa, 'send', { chatId: famChat, text: 'Sab theek hai beta' });
  r = await all({ rohan, priya });
  const pc = r.rohan.parents.find(p => p.name === 'Papa'), mc = r.rohan.parents.find(p => p.name === 'Maa');
  ok('8. Papa is seen to be alright today; Maa not yet', !!pc.ok && !!pc.ok.at && mc.ok === null, blob([pc.ok, mc.ok]));
  ok('8. the last thing Papa wrote, where Rohan can read it', pc.last && pc.last.text === 'Sab theek hai beta' && pc.last.chatId === famChat, blob(pc.last));
  // What Maa wrote to Priya alone is not Rohan's to read.
  const dm = (await C(maa, 'open_dm', { otherId: priya.id })).chatId;
  await C(maa, 'send', { chatId: dm, text: 'Beta yeh sirf tumhare liye hai' });
  r = await all({ rohan, priya });
  ok('8. WHAT MAA WROTE TO PRIYA ALONE IS NOT ON ROHAN\'S CARD', !/sirf tumhare liye/.test(blob(r.rohan)) && r.priya.parents.find(p => p.name === 'Maa').last.text === 'Beta yeh sirf tumhare liye hai');
  ok('8. a number is on the card when the parent shares it with the family', pc.phone === '+919811100003', String(pc.phone));
  await admin.query(`update members set see_phone = 'me' where id = $1`, [maa.id]).catch(() => {});
  r = await all({ rohan });
  ok('8. and is left out when Maa keeps her number to herself', r.rohan.parents.find(p => p.name === 'Maa').phone === null, String(r.rohan.parents.find(p => p.name === 'Maa').phone));
  // Medicines: a shared one counts, a private one is left out.
  const book = (who, body) => call(api.book, { token: who.token, body: { code: who.code, memberId: who.id, ...body } });
  const med1 = await book(rohan, { action: 'add', kind: 'med', name: 'Amlopres 5', aboutId: papa.id, visibility: 'circle' });
  const med2 = await book(papa, { action: 'add', kind: 'med', name: 'Private tablet', aboutId: papa.id, visibility: 'private' });
  ok('8. two medicines for Papa: one shared, one he keeps private', med1.status === 201 && med2.status === 201, blob([med1, med2]));
  const care = (who, body) => call(api.care, { token: who.token, body: { area: 'doses', code: who.code, memberId: who.id, tz: 'Asia/Kolkata', ...body } });
  const s1 = await care(rohan, { action: 'dose_schedule_set', medicineId: med1.id, times: ['00:01', '23:58'], days: [0, 1, 2, 3, 4, 5, 6] });
  const s2 = await care(papa, { action: 'dose_schedule_set', medicineId: med2.id, times: ['00:02'], days: [0, 1, 2, 3, 4, 5, 6] });
  ok('8. each has its times', s1.status === 200 && s2.status === 200, blob([s1, s2]));
  // The times count from when they were set: here, as if set two days ago.
  await admin.query(`update medicine_schedules set since = now() - interval '2 days'`);
  r = await all({ rohan });
  const meds = r.rohan.parents.find(p => p.name === 'Papa').meds;
  ok('8. Rohan\'s card counts today\'s medicines he may see: the shared one only', !!meds && meds.total === 2 && meds.taken === 0, blob(meds));
  ok('8. THE PRIVATE MEDICINE IS NOT COUNTED AND NOT NAMED', !/Private tablet/.test(blob(r.rohan)));
  ok('8. no medicine is named on the card at all, only counted', !/Amlopres/.test(blob(r.rohan.parents)));
}

// ================================================================ 9. another family
{
  const v = await T(vikram);
  ok('9. A MEMBER OF ANOTHER FAMILY GETS NOTHING OF THIS ONE', v.status === 200 && v.items.length === 0 && v.parents.length === 0 && !/Papa|Sharma|kheer|Diwali|Bua/.test(blob(v)), blob(v));
  ok('9. the read still works when called straight, with a member of that family', (await Today.todayState(sql, { id: other, kind: 'family' }, { id: vikram.id })).items.length === 0);
}

// ================================================================ 10. a parent with no app, and her link
{
  const Eld = await import('../../../api/_eldlink.mjs');
  await Eld.ensureEldSchema(sql);
  const nani = await seat(fam, 'SHARMA24', { name: 'Nani' }, 'parent', '1940-01-01');
  const card = async () => (await T(rohan)).parents.find(p => p.name === 'Nani');
  let c = await card();
  ok('10. someone not on Parwah, with no link: no check-in to show, and the card says there is no link', !!c && c.onApp === false && c.link === false && c.ok === null, blob(c));
  await admin.query(`insert into eld_links (circle_id, member_id, token_hash, created_by, expires_at, consent_at) values ($1,$2,$3,$4, now() + interval '30 days', now())`, [fam, nani.id, 'h-' + nani.id, rohan.id]);
  c = await card();
  ok('10. with her link on: not checked in yet today', c.link === true && c.ok === null, blob(c));
  // "I am fine" on her page writes this row (api/_eldlink.mjs).
  await admin.query(`insert into events (circle_id, member_id, type, text) values ($1,$2,'checkin','from Nani''s link')`, [fam, nani.id]);
  c = await card();
  ok('10. A CHECK-IN MADE FROM HER LINK IS ON HER CARD', c.link === true && !!c.ok && !!c.ok.at, blob(c));
  await admin.query(`update eld_links set revoked_at = now() where member_id = $1`, [nani.id]);
  c = await card();
  ok('10. a link turned off is not shown as on (today\'s check-in still stands)', c.link === false && !!c.ok);
  // A message from someone since marked as remembered is never "who wrote last".
  await C(rohan, 'read', { chatId: famChat }).catch(() => {});
  await admin.query(`insert into messages (chat_id, member_id, text) values ($1,$2,'An old line from Dadaji')`, [famChat, dadaji.id]);
  const r = await T(priya);
  ok('10. SOMEONE WHO HAS PASSED AWAY IS NEVER NAMED AS WHO WROTE LAST', !kinds(r, 'message').some(m => m.fromName === 'Dadaji') && !/An old line from Dadaji/.test(blob(r.items)), blob(kinds(r, 'message')));
}

await admin.end();
for (const pl of globalThis.__parwahPools || []) await pl.end();
if (fails.length) { console.error(`todaynav.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`todaynav.dbtest: ${pass}/${pass} checks pass`);
