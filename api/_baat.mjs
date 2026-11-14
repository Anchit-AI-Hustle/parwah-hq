// "MUJHE BAAT KARNI HAI" and "MAAF KARNA": a private word from one member to
// ONE chosen person. Behind /api/chats?area=heard (api/_heard.mjs), by
// actions that start baat_. No new function: the project is at its cap.
//
// The quiet member's safe channel. A daughter-in-law, a teenager, a parent
// who does not want to worry everyone: each can tell one person "I need to
// talk", with a line or a voice note if they wish, and "when it suits you".
// The same door carries "Maaf karna" and "Can we talk?" after a hard word.
//
// ONLY THE TWO OF THEM EVER SEE IT. Every query that reads a row carries
// (from_member = me or to_member = me). It is never put on the family feed,
// never in the daily digest, never read by Ekta, and an admin of the family
// reads nothing: there is no query here without that rule, and the gate
// (site/tests/test_site.py) fails if another module names this table.
//
// The receiver answers with "I will call you at...", "Aao, baat karte
// hain" or a voice note. If there is no answer after a day the receiver
// gets ONE gentle reminder, claimed by one UPDATE; after that, silence. The
// sender is never told "they have not answered".
import { schemaOnce, isUuid, rateLimit } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { noteRisk } from './_notesapi.mjs';
import { audioCheck } from './_memorybond.mjs';
import { BAAT_KINDS, BAAT_REPLIES, BAAT_REMIND_MS, BAAT_PER_DAY, baatClean, baatReplyClean, baatPush } from './_heardrules.mjs';

let ready = false;
export async function ensureBaatSchema(sql) {
  if (ready) return;
  await schemaOnce(() => baatTables(sql));
  ready = true;
}
async function baatTables(sql) {
  await sql`create table if not exists baat (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    from_member uuid not null references members(id) on delete cascade,
    to_member uuid not null references members(id) on delete cascade,
    kind text not null default 'talk',
    line text,
    audio text,
    audio_secs int,
    when_note text,
    created_at timestamptz not null default now(),
    seen_at timestamptz,
    reply_kind text,
    reply_at text,
    reply_audio text,
    reply_secs int,
    replied_at timestamptz,
    reply_seen_at timestamptz,
    reminded_at timestamptz,
    closed_at timestamptz,
    check (from_member <> to_member)
  )`;
  await sql`create index if not exists baat_to on baat (to_member, created_at desc)`;
  await sql`create index if not exists baat_from on baat (from_member, created_at desc)`;
}

const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const bad = (error, status = 400, extra) => ({ status, json: { ok: false, error, ...(extra || {}) } });
const good = (json, status = 200) => ({ status, json: { ok: true, ...(json || {}) } });

// What the two of them see. Open ones, and anything from the last 14 days.
// The sound of a voice note is never in a list: it is fetched by baatAudio.
export async function baatList(sql, circle, me) {
  await ensureBaatSchema(sql);
  const rows = await sql`
    select b.id, b.kind, b.line, (b.audio is not null) as has_audio, b.audio_secs, b.when_note, b.created_at,
           b.from_member, f.name as from_name, b.to_member, t.name as to_name,
           b.reply_kind, b.reply_at, (b.reply_audio is not null) as reply_has_audio, b.reply_secs, b.replied_at, b.closed_at
    from baat b join members f on f.id = b.from_member join members t on t.id = b.to_member
    where b.circle_id = ${circle.id} and (b.from_member = ${me.id} or b.to_member = ${me.id})
      and b.closed_at is null and b.created_at > now() - interval '14 days'
    order by b.created_at desc limit 30`;
  return rows.map(b => {
    const k = BAAT_KINDS[b.kind] || BAAT_KINDS.talk, r = b.reply_kind ? BAAT_REPLIES[b.reply_kind] : null;
    return { id: b.id, kind: b.kind, title: k.title, en: k.en, emoji: k.e, line: b.line, hasAudio: b.has_audio, secs: b.audio_secs,
      when: b.when_note, at: b.created_at, mine: b.from_member === me.id,
      fromId: b.from_member, fromName: b.from_name, toId: b.to_member, toName: b.to_name,
      reply: r ? { kind: b.reply_kind, title: r.title, en: r.en, emoji: r.e, at: b.reply_at, hasAudio: b.reply_has_audio, secs: b.reply_secs, when: b.replied_at } : null };
  });
}

// One voice note, to one of the two of them. which: 'ask' or 'reply'.
export async function baatAudio(sql, circle, me, id, which) {
  await ensureBaatSchema(sql);
  if (!isUuid(id)) return bad('Bad id');
  const r = (await sql`select audio, reply_audio from baat
                       where id = ${id} and circle_id = ${circle.id} and (from_member = ${me.id} or to_member = ${me.id})`)[0];
  const a = r && (which === 'reply' ? r.reply_audio : r.audio);
  if (!a) return bad('That is not here', 404);
  return good({ audio: a });
}

// me: the caller's own membership (requireMember proved it).
export async function baatAction(sql, circle, me, body) {
  await ensureBaatSchema(sql);
  const a = String(body.action || '');

  if (a === 'baat_send') {
    const c = baatClean(body);
    if (c.error) return bad(c.error);
    if (c.toId === me.id) return bad('Choose someone else in the family');
    const risk = noteRisk(c.line || '') || noteRisk(c.when);
    if (risk) return bad(risk);
    // On Parwah (so they can read it), in this family, and not remembered.
    const t = (await sql`select m.id, m.name, m.user_id, coalesce((to_jsonb(m)->>'remembered')::boolean, false) as remembered
                         from members m where m.id = ${c.toId} and m.circle_id = ${circle.id}`)[0];
    if (!t) return bad('Choose someone in this family', 404);
    if (t.remembered) return bad(first(t.name) + ' is remembered here.', 400);
    if (!t.user_id) return bad(first(t.name) + ' is not on Parwah yet, so this would not reach them. A call may be better.', 400);
    let audio = null, secs = null;
    if (body.audio) {
      const v = audioCheck(body.mime, body.audio, body.secs);
      if (v.err) return bad(v.err);
      audio = v.uri; secs = v.secs;
    }
    // One person cannot flood another: a few a day, counted on the server.
    if (!(await rateLimit(sql, 'baat', me.id + ':' + t.id, BAAT_PER_DAY, 86400, { failClosed: true }))) {
      return bad('You have sent ' + first(t.name) + ' a few of these today. Give it a little time, or call.', 429);
    }
    const r = await sql`insert into baat (circle_id, from_member, to_member, kind, line, audio, audio_secs, when_note)
                        values (${circle.id}, ${me.id}, ${t.id}, ${c.kind}, ${c.line}, ${audio}, ${secs}, ${c.when}) returning id`;
    // To that one phone only. The words on a lock screen say nothing of what was written.
    await pushCircle(sql, circle.id, { ...baatPush(c.kind, me.name), url: '/#home' }, { only: t.id });
    return good({ id: r[0].id }, 201);
  }

  if (a === 'baat_reply') {
    if (!isUuid(body.id)) return bad('Bad id');
    const c = baatReplyClean(body);
    if (c.error) return bad(c.error);
    const risk = noteRisk(c.at || '');
    if (risk) return bad(risk);
    let audio = null, secs = null;
    if (c.kind === 'voice') {
      const v = audioCheck(body.mime, body.audio, body.secs);
      if (v.err) return bad(v.err);
      audio = v.uri; secs = v.secs;
    }
    // Only the person it was sent to answers it.
    const got = await sql`update baat set reply_kind = ${c.kind}, reply_at = ${c.at}, reply_audio = ${audio}, reply_secs = ${secs},
                                          replied_at = now(), seen_at = coalesce(seen_at, now())
                          where id = ${body.id} and circle_id = ${circle.id} and to_member = ${me.id} and closed_at is null
                          returning from_member`;
    if (!got[0]) return bad('That is not yours to answer', 404);
    const r = BAAT_REPLIES[c.kind];
    await pushCircle(sql, circle.id, { title: r.e + ' ' + first(me.name) + ': ' + r.title + (c.at ? ' ' + c.at : ''),
      body: 'Only you can see this.', url: '/#home' }, { only: got[0].from_member });
    return good({});
  }

  // The receiver opened it. Nothing is told to the sender.
  if (a === 'baat_seen') {
    if (!isUuid(body.id)) return bad('Bad id');
    await sql`update baat set seen_at = coalesce(seen_at, now()) where id = ${body.id} and circle_id = ${circle.id} and to_member = ${me.id}`;
    return good({});
  }

  // Either of the two puts it away. It then shows for neither.
  if (a === 'baat_close') {
    if (!isUuid(body.id)) return bad('Bad id');
    const got = await sql`update baat set closed_at = now() where id = ${body.id} and circle_id = ${circle.id}
                            and (from_member = ${me.id} or to_member = ${me.id}) and closed_at is null returning id`;
    if (!got[0]) return bad('That is not here', 404);
    return good({});
  }
  return bad('Unknown action');
}

// THE TIMER'S SHARE, for every family at once: a word that has waited a day
// with no answer gets one gentle reminder, to the receiver only. Claimed by
// one UPDATE, so it is sent once however many phones or timers look. The
// clock is passed in, so a test can move it.
export async function baatSweep(sql, nowMs = Date.now()) {
  await ensureBaatSchema(sql);
  const cut = new Date(nowMs - BAAT_REMIND_MS).toISOString();
  const due = await sql`
    update baat b set reminded_at = ${new Date(nowMs).toISOString()}::timestamptz
    from members f, members t
    where b.replied_at is null and b.reminded_at is null and b.closed_at is null
      and b.created_at <= ${cut}::timestamptz and b.created_at > ${cut}::timestamptz - interval '6 days'
      and f.id = b.from_member and t.id = b.to_member
      and t.user_id is not null and not coalesce((to_jsonb(t)->>'remembered')::boolean, false)
      and not coalesce((to_jsonb(f)->>'remembered')::boolean, false)
    returning b.id, b.circle_id, b.to_member, b.kind, f.name as from_name`;
  for (const b of due) {
    const k = BAAT_KINDS[b.kind] || BAAT_KINDS.talk;
    await pushCircle(sql, b.circle_id, { title: k.e + ' ' + first(b.from_name) + ' is waiting to hear from you',
      body: 'A gentle reminder, just this once. Only you can see this.', url: '/#home' }, { only: b.to_member });
  }
  return due.length;
}
