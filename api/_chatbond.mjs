// Chat bonding: voice notes, reactions ("Dekh liya") and quick polls.
// Routed behind /api/chats (no new serverless function).
//
// VOICE NOTES. "Nani can't type fast, so she holds a button and talks." A
// message of kind 'audio' whose text is a small data URI (opus/webm at about
// 24 kbps, or mp4 on Safari). The server refuses any other type, anything
// whose bytes do not start like that type, anything longer than a minute and
// anything bigger than a minute of speech can be. Never sent to Ekta: she
// reads "[voice note]".
//
// REACTIONS. One per person per message (the primary key says so), five to
// pick from. A reaction is a quiet thing: it never sends a push and never
// becomes a message, so it never moves a chat up the list.
//
// POLLS. A message of kind 'poll' (its text is the question, so previews and
// Ekta read it) plus one chat_polls row. A vote is one row per person per
// poll, holding every option they picked, so changing a vote is one upsert.
// One push when a poll is made; none per vote.
//
// EQUAL VOTES (Nov 2026). Every ballot counts once, whoever cast it and
// however old they are. A poll can be a SECRET BALLOT: then no name of who
// picked what is ever put in a reply to any phone (attachBond leaves them
// out, so there is nothing for a screen to hide). Every poll says who it is
// still "Waiting for", and the person who asked can send ONE reminder to
// those people (claimed by one UPDATE). In the family chat a member can
// vote for someone who is not on the app: it is kept, and shown, as
// "for Dadi, by Rohan".
import { schemaOnce } from './_db.mjs';
import { proxyLabel, waitingFor, waitingLine } from './_heardrules.mjs';
import { SOS_AUDIO_TYPES } from './_sos.mjs';

export const VOICE_MAX_SECS = 60;
// 60 s at 32 kbps is 240 KB. The cap leaves room for container overhead and
// a phone that rounds its bitrate up, and no more.
export const VOICE_MAX_BYTES = 384000;
// Per second of claimed length: 64 kbps, twice what the app records at, so a
// note cannot claim 2 seconds and carry a minute.
const VOICE_BYTES_PER_SEC = 8000;
const VOICE_SLACK = 16000;
export const REACTIONS = ['❤️', '🙏', '😂', '👏', '😮'];
export const POLL_MIN = 2, POLL_MAX = 6;

let ready = null;
export async function ensureChatBond(sql) {
  if (!ready) ready = schemaOnce(() => bondTables(sql)).catch(e => { ready = null; throw e; });
  return ready;
}
async function bondTables(sql) {
  await sql`alter table messages add column if not exists audio_secs integer`;
  await sql`create table if not exists message_reactions (
    message_id uuid not null references messages(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    emoji text not null,
    created_at timestamptz not null default now(),
    primary key (message_id, member_id)
  )`;
  await sql`create table if not exists chat_polls (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null unique references messages(id) on delete cascade,
    chat_id uuid not null references chats(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    question text not null,
    options jsonb not null,
    multi boolean not null default false,
    close_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists poll_votes (
    poll_id uuid not null references chat_polls(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    choices smallint[] not null,
    updated_at timestamptz not null default now(),
    primary key (poll_id, member_id)
  )`;
  await sql`alter table chat_polls add column if not exists secret boolean not null default false`;
  await sql`alter table chat_polls add column if not exists reminded_at timestamptz`;
  // A vote given for someone not on the app: member_id is that person,
  // by_member is who cast it for them.
  await sql`alter table poll_votes add column if not exists by_member uuid references members(id) on delete set null`;
  // A chat a member muted, for themself only.
  await sql`create table if not exists chat_mutes (
    chat_id uuid not null references chats(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (chat_id, member_id)
  )`;
}

// ---------- voice ----------
const AUDIO_URI = /^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;
// What the first bytes of each allowed type look like. A webm is EBML, an
// ogg says OggS, an mp4 has "ftyp" at byte 4, mpeg/aac start with ID3 or a
// frame sync. A file that only claims a type is refused.
function looksLike(mime, head) {
  if (mime === 'audio/webm') return head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3;
  if (mime === 'audio/ogg') return head.slice(0, 4).toString('latin1') === 'OggS';
  if (mime === 'audio/mp4') return head.slice(4, 8).toString('latin1') === 'ftyp';
  if (mime === 'audio/mpeg' || mime === 'audio/aac') return head.slice(0, 3).toString('latin1') === 'ID3' || (head[0] === 0xFF && (head[1] & 0xE0) === 0xE0);
  return false;
}
export function checkVoice(uri, secs) {
  const s = String(uri || '');
  const m = AUDIO_URI.exec(s);
  if (!m) return { err: 'That is not a voice note' };
  if (SOS_AUDIO_TYPES.indexOf(m[1]) < 0) return { err: 'That kind of recording cannot be sent' };
  const n = Number(secs);
  if (!Number.isInteger(n) || n < 1 || n > VOICE_MAX_SECS) return { err: 'A voice note is 1 to 60 seconds' };
  const bytes = Math.floor(m[2].length * 3 / 4);
  if (bytes > VOICE_MAX_BYTES || bytes > n * VOICE_BYTES_PER_SEC + VOICE_SLACK) return { err: 'That voice note is too big to send' };
  const head = Buffer.from(m[2].slice(0, 16), 'base64');
  if (!looksLike(m[1], head)) return { err: 'That kind of recording cannot be sent' };
  return { uri: s, secs: n };
}
export function voiceLabel(secs) {
  const n = Math.max(0, Math.round(Number(secs) || 0));
  return '🎙 Voice note (' + Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0') + ')';
}

// ---------- reading: reactions and polls for a page of messages ----------
export async function attachBond(sql, msgs, meId) {
  const ids = msgs.map(m => m.id);
  if (!ids.length) return msgs;
  const rx = await sql`
    select r.message_id, r.emoji, r.member_id, mem.name
    from message_reactions r join members mem on mem.id = r.member_id
    where r.message_id = any(${ids}) order by r.created_at`;
  const byMsg = {};
  rx.forEach(r => {
    const list = byMsg[r.message_id] || (byMsg[r.message_id] = []);
    let g = list.find(x => x.emoji === r.emoji);
    if (!g) { g = { emoji: r.emoji, count: 0, names: [], mine: false }; list.push(g); }
    g.count++; g.names.push(r.member_id === meId ? 'You' : r.name);
    if (r.member_id === meId) g.mine = true;
  });
  const pollIds = msgs.filter(m => m.kind === 'poll').map(m => m.id);
  const polls = {};
  if (pollIds.length) {
    const ps = await sql`
      select p.id, p.message_id, p.by_member, p.question, p.options, p.multi, p.close_at, p.closed_at, p.secret, p.reminded_at,
             p.chat_id, c.kind as chat_kind, c.circle_id,
             (p.closed_at is not null or (p.close_at is not null and p.close_at <= now())) as closed
      from chat_polls p join chats c on c.id = p.chat_id where p.message_id = any(${pollIds})`;
    const pids = ps.map(p => p.id);
    const votes = pids.length ? await sql`
      select v.poll_id, v.member_id, v.choices, v.by_member, mem.name, b.name as by_name
      from poll_votes v join members mem on mem.id = v.member_id left join members b on b.id = v.by_member
      where v.poll_id = any(${pids}) order by v.updated_at` : [];
    // Who is in each poll's chat: on Parwah (they can vote themself) or not
    // (someone can vote for them, in the family chat only).
    const people = {};
    for (const p of ps) {
      if (people[p.chat_id]) continue;
      people[p.chat_id] = p.chat_kind === 'circle'
        ? await sql`select m.id, m.name, (m.user_id is not null) as on_app from members m
                    where m.circle_id = ${p.circle_id} and not coalesce((to_jsonb(m)->>'remembered')::boolean, false) order by m.created_at`
        : await sql`select m.id, m.name, (m.user_id is not null) as on_app from chat_members cm join members m on m.id = cm.member_id
                    where cm.chat_id = ${p.chat_id} and not coalesce((to_jsonb(m)->>'remembered')::boolean, false) order by m.created_at`;
    }
    ps.forEach(p => {
      const opts = (Array.isArray(p.options) ? p.options : JSON.parse(p.options || '[]'))
        .map(t => ({ text: t, count: 0, names: [] }));
      let mine = [], voters = 0;
      const mineFor = [], voted = [];
      votes.filter(v => v.poll_id === p.id).forEach(v => {
        voters++; voted.push(v.member_id);
        const proxy = v.by_member && v.by_member !== v.member_id;
        // One ballot, one count. A SECRET ballot carries no name at all.
        (v.choices || []).forEach(i => { const o = opts[i]; if (o) { o.count++; if (!p.secret) o.names.push(proxy ? proxyLabel(v.name, v.by_name) : v.member_id === meId ? 'You' : v.name); } });
        if (v.member_id === meId) mine = (v.choices || []).map(Number);
        if (proxy && v.by_member === meId) mineFor.push({ id: v.member_id, name: v.name, choices: (v.choices || []).map(Number), label: proxyLabel(v.name, v.by_name) });
      });
      const here = people[p.chat_id] || [];
      const waiting = p.closed ? [] : waitingFor(here.filter(x => x.on_app), voted);
      // A SECRET BALLOT KEEPS ITS COUNTS UNTIL IT CLOSES. Live counts next
      // to "waiting for Meera" let anyone watching see a count go up the
      // moment Meera's name left the list, which is her vote. While it is
      // open, everyone is sent how many have voted and who is still to
      // vote, and no count at all; the counts come when the poll closes.
      const held = !!p.secret && !p.closed;
      if (held) opts.forEach(o => { o.count = null; });
      polls[p.message_id] = { id: p.id, question: p.question, options: opts, multi: p.multi, secret: !!p.secret,
        held, of: here.filter(x => x.on_app || p.chat_kind === 'circle').length,
        closeAt: p.close_at, closed: !!p.closed, mine, voters, canClose: p.by_member === meId && !p.closed,
        waiting: p.closed ? null : waitingLine(waiting), reminded: !!p.reminded_at,
        canRemind: p.by_member === meId && !p.closed && !p.reminded_at && waiting.length > 0,
        // People not on the app, whom someone here can vote for.
        offApp: p.closed || p.chat_kind !== 'circle' ? [] : here.filter(x => !x.on_app).map(x => ({ id: x.id, name: x.name, voted: voted.includes(x.id) })),
        mineFor };
    });
  }
  return msgs.map(m => {
    const out = Object.assign({}, m, { reactions: byMsg[m.id] || [] });
    if (m.kind === 'poll') out.poll = polls[m.id] || null;
    return out;
  });
}

// ---------- writing ----------
async function messageInChat(sql, chat, messageId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(messageId || ''))) return null;
  const r = await sql`select id from messages where id = ${messageId} and chat_id = ${chat.id}`;
  return r[0] || null;
}

// emoji: one of REACTIONS sets (or changes) mine; null or '' removes it.
export async function react(sql, chat, me, body) {
  const msg = await messageInChat(sql, chat, body.messageId);
  if (!msg) return { status: 404, json: { ok: false, error: 'That message is not here' } };
  const e = body.emoji;
  if (e === null || e === undefined || e === '') {
    await sql`delete from message_reactions where message_id = ${msg.id} and member_id = ${me.id}`;
  } else {
    if (REACTIONS.indexOf(e) < 0) return { status: 400, json: { ok: false, error: 'Pick one of the five reactions' } };
    await sql`insert into message_reactions (message_id, member_id, emoji) values (${msg.id}, ${me.id}, ${e})
              on conflict (message_id, member_id) do update set emoji = excluded.emoji, created_at = now()`;
  }
  const [withRx] = await attachBond(sql, [{ id: msg.id, kind: 'text' }], me.id);
  return { status: 200, json: { ok: true, reactions: withRx.reactions } };
}

export function cleanPoll(body) {
  const question = String(body.question || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!question) return { err: 'Write the question first' };
  const raw = Array.isArray(body.options) ? body.options : [];
  if (raw.length > POLL_MAX) return { err: 'A poll has 2 to 6 choices' };
  const options = [];
  for (const o of raw) {
    const t = String(o === null || o === undefined ? '' : o).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!t) continue;
    if (options.some(x => x.toLowerCase() === t.toLowerCase())) return { err: 'Two choices say the same thing' };
    options.push(t);
  }
  if (options.length < POLL_MIN) return { err: 'A poll has 2 to 6 choices' };
  let closeAt = null;
  if (body.closeAt) {
    const d = new Date(body.closeAt);
    if (isNaN(d.getTime())) return { err: 'That closing time is not a date' };
    if (d.getTime() < Date.now() + 60000) return { err: 'Pick a closing time in the future' };
    if (d.getTime() > Date.now() + 90 * 86400000) return { err: 'A poll can stay open for 90 days at most' };
    closeAt = d.toISOString();
  }
  return { question, options, multi: !!body.multi, closeAt, secret: !!body.secret };
}

// Returns the poll row and the message, so the caller can push once.
export async function createPoll(sql, chat, me, body) {
  const p = cleanPoll(body);
  if (p.err) return { status: 400, json: { ok: false, error: p.err } };
  const m = await sql`insert into messages (chat_id, member_id, text, kind) values (${chat.id}, ${me.id}, ${p.question}, 'poll') returning id`;
  const row = await sql`insert into chat_polls (message_id, chat_id, by_member, question, options, multi, close_at, secret)
                        values (${m[0].id}, ${chat.id}, ${me.id}, ${p.question}, ${JSON.stringify(p.options)}::jsonb, ${p.multi}, ${p.closeAt}, ${p.secret})
                        returning id`;
  return { status: 201, json: { ok: true, pollId: row[0].id, messageId: m[0].id }, poll: p };
}

async function pollInChat(sql, chat, pollId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(pollId || ''))) return null;
  const r = await sql`select id, by_member, options, multi, question, reminded_at,
                        (closed_at is not null or (close_at is not null and close_at <= now())) as closed
                      from chat_polls where id = ${pollId} and chat_id = ${chat.id}`;
  return r[0] || null;
}

// choices: the option numbers picked. [] takes the vote back.
export async function votePoll(sql, chat, me, body) {
  const p = await pollInChat(sql, chat, body.pollId);
  if (!p) return { status: 404, json: { ok: false, error: 'That poll is not here' } };
  if (p.closed) return { status: 409, json: { ok: false, error: 'This poll is closed' } };
  const n = (Array.isArray(p.options) ? p.options : JSON.parse(p.options || '[]')).length;
  const raw = Array.isArray(body.choices) ? body.choices : [];
  const picks = [...new Set(raw.map(Number))];
  if (picks.some(i => !Number.isInteger(i) || i < 0 || i >= n)) return { status: 400, json: { ok: false, error: 'That choice is not in the poll' } };
  if (!p.multi && picks.length > 1) return { status: 400, json: { ok: false, error: 'Pick one choice' } };
  // A vote for someone who is not on the app. Only in the family chat (the
  // one chat they belong to), only for someone in this family who cannot
  // vote themself, and never for someone who is remembered. It counts
  // once, the same as any vote, and is kept as "for Dadi, by Rohan".
  let voter = me.id, by = null;
  if (body.forId) {
    if (chat.kind !== 'circle') return { status: 400, json: { ok: false, error: 'You can vote for someone only in the family chat' } };
    if (!/^[0-9a-f-]{36}$/i.test(String(body.forId))) return { status: 400, json: { ok: false, error: 'Choose who you are voting for' } };
    const t = (await sql`select m.id, m.name, m.user_id from members m join chats c on c.circle_id = m.circle_id
                         where m.id = ${body.forId} and c.id = ${chat.id}
                           and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)`)[0];
    if (!t) return { status: 404, json: { ok: false, error: 'Choose someone in this family' } };
    if (t.user_id) return { status: 400, json: { ok: false, error: t.name + ' is on Parwah and votes for themself' } };
    voter = t.id; by = me.id;
  }
  if (!picks.length) {
    // My own vote, or a vote I gave for someone: never anyone else's.
    await sql`delete from poll_votes where poll_id = ${p.id} and member_id = ${voter} and (${by}::uuid is null or by_member = ${by}::uuid)`;
  } else {
    picks.sort((a, b) => a - b);
    await sql`insert into poll_votes (poll_id, member_id, choices, by_member) values (${p.id}, ${voter}, ${picks}, ${by})
              on conflict (poll_id, member_id) do update set choices = excluded.choices, by_member = excluded.by_member, updated_at = now()`;
  }
  return { status: 200, json: { ok: true } };
}

export async function closePoll(sql, chat, me, body) {
  const p = await pollInChat(sql, chat, body.pollId);
  if (!p) return { status: 404, json: { ok: false, error: 'That poll is not here' } };
  if (p.by_member !== me.id) return { status: 403, json: { ok: false, error: 'Only the person who asked can close it' } };
  await sql`update chat_polls set closed_at = now() where id = ${p.id} and closed_at is null`;
  return { status: 200, json: { ok: true } };
}

// ONE reminder, from the person who asked, to the people who have not voted
// yet. Claimed by one UPDATE, so a second tap (or a second phone) sends
// nothing. Returns who to tell; the route sends the pushes.
export async function remindPoll(sql, chat, me, body) {
  const p = await pollInChat(sql, chat, body.pollId);
  if (!p) return { status: 404, json: { ok: false, error: 'That poll is not here' } };
  if (p.by_member !== me.id) return { status: 403, json: { ok: false, error: 'Only the person who asked can send the reminder' } };
  if (p.closed) return { status: 409, json: { ok: false, error: 'This poll is closed' } };
  const got = await sql`update chat_polls set reminded_at = now() where id = ${p.id} and reminded_at is null returning id`;
  if (!got[0]) return { status: 409, json: { ok: false, error: 'The reminder has already been sent. It goes only once.' } };
  const who = chat.kind === 'circle'
    ? await sql`select m.id from members m join chats c on c.circle_id = m.circle_id
                where c.id = ${chat.id} and m.user_id is not null and m.id <> ${me.id}
                  and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)
                  and not exists (select 1 from poll_votes v where v.poll_id = ${p.id} and v.member_id = m.id)`
    : await sql`select m.id from chat_members cm join members m on m.id = cm.member_id
                where cm.chat_id = ${chat.id} and m.user_id is not null and m.id <> ${me.id}
                  and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)
                  and not exists (select 1 from poll_votes v where v.poll_id = ${p.id} and v.member_id = m.id)`;
  return { status: 200, json: { ok: true, reminded: who.length }, ids: who.map(w => w.id), question: p.question };
}
