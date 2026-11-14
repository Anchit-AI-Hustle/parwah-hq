// VOICE NOTES, REACTIONS AND POLLS AGAINST A REAL DATABASE: the real
// /api/chats handler, the real schema and SQL (api/_chatbond.mjs).
//
// What it proves: a voice note is a small recording of an allowed type and
// nothing else, at most a minute; Ekta reads "[voice note]" and never the
// sound. A reaction is one per person per message, changes and comes back
// off, never pushes and never moves the chat. A poll takes 2 to 6 choices,
// one push when it is asked and none per vote, votes change, and only the
// person who asked closes it. Everything is for people in that chat only:
// an outsider is refused (403) and no session is asked to sign in (401).
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('chatbond.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('chatbond.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

// Every push is counted here instead of leaving the machine.
const webpush = (await import('web-push')).default;
const pushed = [];
webpush.sendNotification = async (sub, body) => { pushed.push({ endpoint: sub.endpoint, body: JSON.parse(body) }); return {}; };

const { default: chats, ektaChatTurns } = await import('../../../api/chats.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { ensurePushSchema } = await import('../../../api/_push.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
await ensureSchema(db());
await ensurePushSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

let n = 0;
async function user(name) {
  const phone = '+9198500' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [phone, phone.slice(3), name])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { userId: u.id, name, token };
}
async function seat(circleId, code, u, role = 'family') {
  const m = (await admin.query(`insert into members (circle_id, name, user_id, role) values ($1,$2,$3,$4) returning id`, [circleId, u.name, u.userId, role])).rows[0];
  await admin.query(`insert into push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')`,
    [m.id, 'https://fcm.googleapis.com/fcm/send/' + m.id]);
  return { id: m.id, name: u.name, token: u.token, code };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const grp = (await admin.query(`insert into circles (code, name, kind) values ('COUSIN','Cousins','group') returning id`)).rows[0].id;
const U = { rohan: await user('Rohan'), meera: await user('Meera'), nani: await user('Nani'), vikram: await user('Vikram') };
const rohan = await seat(fam, 'SHARMA', U.rohan), meera = await seat(fam, 'SHARMA', U.meera), nani = await seat(fam, 'SHARMA', U.nani, 'parent');
const rohanG = await seat(grp, 'COUSIN', U.rohan), vikramG = await seat(grp, 'COUSIN', U.vikram);
// Vikram knocking on the Sharma family with his own membership, and with Rohan's.
const outsider = { id: vikramG.id, token: vikramG.token, code: 'SHARMA' };
const posing = { id: rohan.id, token: vikramG.token, code: 'SHARMA' };
const noSession = { id: rohan.id, token: '', code: 'SHARMA' };

async function call(who, { method = 'POST', body = {}, query = {} } = {}) {
  const req = { method, headers: who.token ? { 'x-parwah-token': who.token } : {},
                query: { circle: who.code, member: who.id, ...query },
                body: { code: who.code, memberId: who.id, ...body } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await chats(req, res);
  return { ...json, status };
}
const list = async (who) => (await call(who, { method: 'GET' })).chats || [];
const msgs = async (who, chatId) => (await call(who, { method: 'GET', query: { chat: chatId } })).messages || [];
const q1 = async (text, args) => (await admin.query(text, args)).rows[0];

const famChat = (await list(rohan)).find(c => c.kind === 'circle').id;
const grpChat = (await list(rohanG)).find(c => c.kind === 'circle').id;
// A group inside the family that Nani is not in.
const cousins = (await call(rohan, { body: { action: 'create_group', name: 'Cousins only', memberIds: [meera.id] } })).chatId;

// A recording that starts the way a real one does.
const WEBM = [0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0xF7, 0x81, 0x01, 0x42, 0xF2, 0x81];
const fakeAudio = (bytes, head = WEBM, mime = 'audio/webm') => {
  const b = Buffer.alloc(bytes, 7); Buffer.from(head).copy(b);
  return 'data:' + mime + ';base64,' + b.toString('base64');
};
const voice = (who, chatId, text, secs) => call(who, { body: { action: 'send', chatId, kind: 'audio', text, secs } });

// ---- 1. voice notes
{
  pushed.length = 0;
  let r = await voice(nani, famChat, fakeAudio(9000), 3);
  ok('Nani sends a 3-second voice note', r.status === 201, JSON.stringify(r));
  const m = (await msgs(rohan, famChat)).pop();
  ok('it is kept as audio, with its length', m && m.kind === 'audio' && m.audio_secs === 3 && m.text.startsWith('data:audio/webm;base64,'));
  const last = (await list(meera)).find(c => c.id === famChat).last;
  ok('the chat list says "🎙 Voice note (0:03)"', last && last.text === '🎙 Voice note (0:03)', last && last.text);
  ok('the family hears about it once each, as a voice note', pushed.length === 2 && pushed.every(p => p.body.body.replace(/ · Sharma Family$/, '') === '🎙 Voice note (0:03)'), JSON.stringify(pushed.map(p => p.body)));
  r = await voice(nani, famChat, fakeAudio(4000, [0x4F, 0x67, 0x67, 0x53, 0, 0, 0, 0], 'audio/ogg'), 1);
  ok('an ogg recording is taken too', r.status === 201, JSON.stringify(r));
  r = await voice(nani, famChat, fakeAudio(9000, [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x41, 0x20], 'audio/mp4'), 2);
  ok('and Safari\'s mp4', r.status === 201, JSON.stringify(r));

  r = await voice(nani, famChat, fakeAudio(9000, WEBM, 'audio/wav'), 3);
  ok('a wav is refused (not on the list)', r.status === 400 && /kind of recording/.test(r.error), JSON.stringify(r));
  r = await voice(nani, famChat, fakeAudio(9000, [0x89, 0x50, 0x4E, 0x47], 'audio/webm'), 3);
  ok('a file that only claims to be webm is refused', r.status === 400, JSON.stringify(r));
  r = await voice(nani, famChat, 'data:image/png;base64,iVBORw0KGgo=', 3);
  ok('a picture sent as a voice note is refused', r.status === 400);
  r = await voice(nani, famChat, 'data:audio/webm;base64,GkXfo" onerror="x', 3);
  ok('anything that is not pure base64 is refused', r.status === 400);
  r = await voice(nani, famChat, 'https://example.com/a.webm', 3);
  ok('a link is not a voice note', r.status === 400);
  for (const s of [0, 61, 2.5, 'abc', null]) {
    r = await voice(nani, famChat, fakeAudio(4000), s);
    ok('a length of ' + JSON.stringify(s) + ' seconds is refused', r.status === 400 && /1 to 60 seconds/.test(r.error), JSON.stringify(r));
  }
  r = await voice(nani, famChat, fakeAudio(400000), 60);
  ok('more than the byte cap is refused, even at a minute', r.status === 400 && /too big/.test(r.error), JSON.stringify(r));
  r = await voice(nani, famChat, fakeAudio(120000), 2);
  ok('a minute of sound claiming to be 2 seconds is refused', r.status === 400 && /too big/.test(r.error));
  r = await voice(nani, famChat, fakeAudio(240000), 60);
  ok('a full minute at the app\'s bitrate goes', r.status === 201, JSON.stringify(r));
  ok('nothing refused was stored', (await q1(`select count(*)::int as n from messages where kind = 'audio'`)).n === 4);

  ok('no session: asked to sign in', (await voice(noSession, famChat, fakeAudio(4000), 1)).status === 401);
  ok('an outsider is refused', (await voice(outsider, famChat, fakeAudio(4000), 1)).status === 403);
  ok('an outsider using Rohan\'s id is refused', (await voice(posing, famChat, fakeAudio(4000), 1)).status === 403);
  ok('Nani cannot send into a group she is not in', (await voice(nani, cousins, fakeAudio(4000), 1)).status === 404);
  ok('a voice note works the same in a group circle', (await voice(vikramG, grpChat, fakeAudio(6000), 2)).status === 201);

  // Ekta's context: the words "[voice note]", never the sound.
  const recent = (await msgs(rohan, famChat)).map(x => ({ name: x.name, text: x.text, kind: x.kind }));
  recent.push({ name: 'Rohan', text: 'Ekta, what did we decide?', kind: 'text' });
  const turns = ektaChatTurns('Everyone', 'family', recent, 'Ekta, what did we decide?');
  const all = JSON.stringify(turns);
  ok('Ekta reads "[voice note]" and never the recording', all.includes('Nani: [voice note]') && !all.includes('base64') && !all.includes('data:audio'));
}

// ---- 2. reactions and Dekh liya
{
  await call(rohan, { body: { action: 'send', chatId: famChat, text: 'Reached Pune, all good' } });
  const target = (await msgs(rohan, famChat)).pop();
  const before = (await list(meera)).map(c => c.id + '|' + (c.last && c.last.at));
  pushed.length = 0;
  let r = await call(nani, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: '❤️' } });
  ok('Nani says Dekh liya with a ❤️', r.status === 200 && r.reactions.length === 1 && r.reactions[0].names[0] === 'You', JSON.stringify(r));
  let seen = (await msgs(rohan, famChat)).find(x => x.id === target.id).reactions;
  ok('Rohan sees ❤️ 1 from Nani', seen.length === 1 && seen[0].emoji === '❤️' && seen[0].count === 1 && seen[0].names.join() === 'Nani' && !seen[0].mine, JSON.stringify(seen));
  await call(nani, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: '🙏' } });
  seen = (await msgs(rohan, famChat)).find(x => x.id === target.id).reactions;
  ok('picking another changes it: still one from her', seen.length === 1 && seen[0].emoji === '🙏', JSON.stringify(seen));
  await Promise.all([
    call(meera, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: '😂' } }),
    call(meera, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: '👏' } }),
    call(meera, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: '😮' } })
  ]);
  ok('three at once from Meera leave one of hers', (await q1(`select count(*)::int as n from message_reactions where message_id = $1 and member_id = $2`, [target.id, meera.id])).n === 1);
  await call(rohan, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: '🙏' } });
  seen = (await msgs(meera, famChat)).find(x => x.id === target.id).reactions;
  const pray = seen.find(g => g.emoji === '🙏');
  ok('the same reaction from two people is one group with both names', pray && pray.count === 2 && pray.names.sort().join() === 'Nani,Rohan', JSON.stringify(seen));
  r = await call(nani, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: null } });
  ok('taken back with nothing picked', r.status === 200 && !(await q1(`select 1 as x from message_reactions where message_id = $1 and member_id = $2`, [target.id, nani.id])));
  ok('a reaction outside the five is refused', (await call(nani, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: '🔥' } })).status === 400);
  ok('a reaction never sends a push', pushed.length === 0, JSON.stringify(pushed));
  const after = (await list(meera)).map(c => c.id + '|' + (c.last && c.last.at));
  ok('and never moves a chat or changes its last message', JSON.stringify(before) === JSON.stringify(after));
  ok('and is never a message', (await q1(`select count(*)::int as n from messages where chat_id = $1 and created_at >= (select created_at from messages where id = $2) and id <> $2`, [famChat, target.id])).n === 0);

  const inCousins = (await call(rohan, { body: { action: 'send', chatId: cousins, text: 'Gift for Nani?' } }));
  const cm = (await msgs(rohan, cousins)).pop();
  ok('Nani cannot react in a group she is not in', (await call(nani, { body: { action: 'react', chatId: cousins, messageId: cm.id, emoji: '❤️' } })).status === 404 && inCousins.status === 201);
  ok('nor reach that message through a chat she is in', (await call(nani, { body: { action: 'react', chatId: famChat, messageId: cm.id, emoji: '❤️' } })).status === 404);
  ok('an outsider is refused', (await call(outsider, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: '❤️' } })).status === 403);
  ok('no session: asked to sign in', (await call(noSession, { body: { action: 'react', chatId: famChat, messageId: target.id, emoji: '❤️' } })).status === 401);
  ok('reactions work the same in a group circle', (await call(rohanG, { body: { action: 'react', chatId: grpChat, messageId: (await msgs(rohanG, grpChat)).pop().id, emoji: '👏' } })).status === 200);
}

// ---- 3. quick polls
{
  const ask = (who, chatId, extra) => call(who, { body: { action: 'poll_create', chatId, ...extra } });
  ok('a poll needs a question', (await ask(rohan, famChat, { question: ' ', options: ['A', 'B'] })).status === 400);
  ok('and at least two choices', (await ask(rohan, famChat, { question: 'Lunch?', options: ['Only one', ' '] })).status === 400);
  ok('and at most six', (await ask(rohan, famChat, { question: 'Lunch?', options: ['1', '2', '3', '4', '5', '6', '7'] })).status === 400);
  ok('two choices that say the same thing are refused', (await ask(rohan, famChat, { question: 'Lunch?', options: ['Pune', 'pune'] })).status === 400);
  ok('a closing time in the past is refused', (await ask(rohan, famChat, { question: 'Lunch?', options: ['A', 'B'], closeAt: new Date(Date.now() - 3600e3).toISOString() })).status === 400);
  ok('nothing refused was stored', (await q1(`select count(*)::int as n from chat_polls`)).n === 0);

  pushed.length = 0;
  let r = await ask(rohan, famChat, { question: 'Sunday lunch at whose house?', options: ['Nani\'s', 'Meera\'s', 'Order in'] });
  ok('Rohan asks the family', r.status === 201 && !!r.pollId, JSON.stringify(r));
  const poll = r.pollId;
  ok('one push to each of the others, saying what he asked', pushed.length === 2 && pushed.every(p => p.body.body.replace(/ · Sharma Family$/, '') === 'Sunday lunch at whose house?' && /Rohan asked/.test(p.body.title)), JSON.stringify(pushed.map(p => p.body)));
  ok('the chat list says "📊 Poll: ..."', (await list(meera)).find(c => c.id === famChat).last.text === '📊 Poll: Sunday lunch at whose house?');

  pushed.length = 0;
  const vote = (who, choices, pollId = poll, chatId = famChat) => call(who, { body: { action: 'poll_vote', chatId, pollId, choices } });
  ok('Meera votes', (await vote(meera, [0])).status === 200);
  ok('Nani votes', (await vote(nani, [1])).status === 200);
  ok('Meera changes her vote', (await vote(meera, [1])).status === 200);
  let p = (await msgs(rohan, famChat)).find(m => m.kind === 'poll').poll;
  ok('two votes, both on Meera\'s, with names', p.voters === 2 && p.options.map(o => o.count).join() === '0,2,0' && p.options[1].names.sort().join() === 'Meera,Nani', JSON.stringify(p));
  ok('Rohan has not voted and may close it', p.mine.length === 0 && p.canClose && !p.closed && !p.multi);
  ok('Meera sees her own vote', (await msgs(meera, famChat)).find(m => m.kind === 'poll').poll.mine.join() === '1');
  ok('one vote per person: two rows', (await q1(`select count(*)::int as n from poll_votes where poll_id = $1`, [poll])).n === 2);
  ok('a single-choice poll takes one choice', (await vote(meera, [0, 1])).status === 400);
  ok('a choice that is not there is refused', (await vote(meera, [3])).status === 400 && (await vote(meera, [-1])).status === 400);
  ok('a vote taken back', (await vote(nani, [])).status === 200 && (await q1(`select count(*)::int as n from poll_votes where poll_id = $1`, [poll])).n === 1);
  ok('voting never sends a push', pushed.length === 0, JSON.stringify(pushed));

  ok('Nani cannot vote in a poll of a group she is not in', await (async () => {
    const g = await ask(rohan, cousins, { question: 'Surprise for Nani?', options: ['Cake', 'Flowers'] });
    return g.status === 201 && (await vote(nani, [0], g.pollId, cousins)).status === 404 && (await vote(nani, [0], g.pollId, famChat)).status === 404;
  })());
  ok('an outsider cannot vote', (await vote(outsider, [0])).status === 403);
  ok('or ask', (await ask(outsider, famChat, { question: 'x', options: ['a', 'b'] })).status === 403);
  ok('no session: asked to sign in', (await vote(noSession, [0])).status === 401 && (await ask(noSession, famChat, { question: 'x', options: ['a', 'b'] })).status === 401);

  r = await call(meera, { body: { action: 'poll_close', chatId: famChat, pollId: poll } });
  ok('only the person who asked can close it', r.status === 403, JSON.stringify(r));
  ok('an outsider cannot close it', (await call(outsider, { body: { action: 'poll_close', chatId: famChat, pollId: poll } })).status === 403);
  r = await call(rohan, { body: { action: 'poll_close', chatId: famChat, pollId: poll } });
  ok('Rohan closes it', r.status === 200);
  p = (await msgs(meera, famChat)).find(m => m.kind === 'poll').poll;
  ok('it reads closed, results kept', p.closed && p.options[1].count === 1 && !p.canClose);
  ok('no votes after it closes', (await vote(nani, [2])).status === 409);

  const multi = await ask(meera, famChat, { question: 'What to bring?', options: ['Sweets', 'Fruit', 'Flowers'], multi: true, closeAt: new Date(Date.now() + 86400e3).toISOString() });
  ok('a pick-more-than-one poll with a closing time', multi.status === 201);
  ok('takes several choices', (await vote(nani, [0, 2], multi.pollId)).status === 200);
  p = (await msgs(rohan, famChat)).find(m => m.poll && m.poll.id === multi.pollId).poll;
  ok('and counts each', p.multi && p.options.map(o => o.count).join() === '1,0,1' && p.closeAt && !p.closed, JSON.stringify(p));
  await admin.query(`update chat_polls set close_at = now() - interval '1 minute' where id = $1`, [multi.pollId]);
  ok('once its time passes it is closed by itself', (await vote(rohan, [1], multi.pollId)).status === 409
     && (await msgs(rohan, famChat)).find(m => m.poll && m.poll.id === multi.pollId).poll.closed);

  const g = await ask(vikramG, grpChat, { question: 'Movie on Friday?', options: ['Yes', 'No'] });
  ok('polls work the same in a group circle', g.status === 201 && (await vote(rohanG, [0], g.pollId, grpChat)).status === 200);
}

await admin.end();
for (const pl of globalThis.__parwahPools || []) await pl.end();
if (fails.length) { console.error(`chatbond.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`chatbond.dbtest: ${pass}/${pass} checks pass`);
