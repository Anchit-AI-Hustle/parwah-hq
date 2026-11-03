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
import { schemaOnce } from './_db.mjs';
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
      select p.id, p.message_id, p.by_member, p.question, p.options, p.multi, p.close_at, p.closed_at,
             (p.closed_at is not null or (p.close_at is not null and p.close_at <= now())) as closed
      from chat_polls p where p.message_id = any(${pollIds})`;
    const pids = ps.map(p => p.id);
    const votes = pids.length ? await sql`
      select v.poll_id, v.member_id, v.choices, mem.name
      from poll_votes v join members mem on mem.id = v.member_id
      where v.poll_id = any(${pids}) order by v.updated_at` : [];
    ps.forEach(p => {
      const opts = (Array.isArray(p.options) ? p.options : JSON.parse(p.options || '[]'))
        .map(t => ({ text: t, count: 0, names: [] }));
      let mine = [], voters = 0;
      votes.filter(v => v.poll_id === p.id).forEach(v => {
        voters++;
        (v.choices || []).forEach(i => { const o = opts[i]; if (o) { o.count++; o.names.push(v.member_id === meId ? 'You' : v.name); } });
        if (v.member_id === meId) mine = (v.choices || []).map(Number);
      });
      polls[p.message_id] = { id: p.id, question: p.question, options: opts, multi: p.multi,
        closeAt: p.close_at, closed: !!p.closed, mine, voters, canClose: p.by_member === meId && !p.closed };
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
  return { question, options, multi: !!body.multi, closeAt };
}

// Returns the poll row and the message, so the caller can push once.
export async function createPoll(sql, chat, me, body) {
  const p = cleanPoll(body);
  if (p.err) return { status: 400, json: { ok: false, error: p.err } };
  const m = await sql`insert into messages (chat_id, member_id, text, kind) values (${chat.id}, ${me.id}, ${p.question}, 'poll') returning id`;
  const row = await sql`insert into chat_polls (message_id, chat_id, by_member, question, options, multi, close_at)
                        values (${m[0].id}, ${chat.id}, ${me.id}, ${p.question}, ${JSON.stringify(p.options)}::jsonb, ${p.multi}, ${p.closeAt})
                        returning id`;
  return { status: 201, json: { ok: true, pollId: row[0].id, messageId: m[0].id }, poll: p };
}

async function pollInChat(sql, chat, pollId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(pollId || ''))) return null;
  const r = await sql`select id, by_member, options, multi,
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
  if (!picks.length) {
    await sql`delete from poll_votes where poll_id = ${p.id} and member_id = ${me.id}`;
  } else {
    picks.sort((a, b) => a - b);
    await sql`insert into poll_votes (poll_id, member_id, choices) values (${p.id}, ${me.id}, ${picks})
              on conflict (poll_id, member_id) do update set choices = excluded.choices, updated_at = now()`;
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
