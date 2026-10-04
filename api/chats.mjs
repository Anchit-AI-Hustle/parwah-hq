// The chat system: one default "Everyone" chat per circle, unlimited named
// group chats, and personal (1:1) chats - all private to the circle.
// Ekta is an automatic participant: mention "Ekta" in any chat and she
// replies into the chat itself (as a message with member_id null).
//
// GET  /api/chats?circle=CODE&member=UUID           → chat list (+ previews)
// GET  /api/chats?circle=CODE&member=UUID&chat=UUID → messages of one chat
// POST /api/chats {code, memberId, action, ...}
//   send         {chatId, text}
//   create_group {name, memberIds[]}
//   open_dm      {otherId}   (returns the existing 1:1 chat if there is one)
import { db, ensureSchema, circleByCode, isUuid, ensureCircleChat , requireMember} from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { safeImageUri } from './_sec.mjs';
import { pushCircle } from './_push.mjs';
import { ektaTurn } from './ekta.mjs';

async function chatForMember(sql, circle, chatId, memberId) {
  if (!isUuid(chatId)) return null;
  const rows = await sql`select id, kind, name from chats where id = ${chatId} and circle_id = ${circle.id}`;
  const chat = rows[0];
  if (!chat) return null;
  if (chat.kind === 'circle') return chat;
  const m = await sql`select 1 as x from chat_members where chat_id = ${chat.id} and member_id = ${memberId}`;
  return m[0] ? chat : null;
}

async function listChats(sql, circle, me) {
  await ensureCircleChat(sql, circle.id);
  const chats = await sql`
    select c.id, c.kind, c.name, c.created_at,
      (select string_agg(mm.name, ', ')
         from chat_members cm join members mm on mm.id = cm.member_id
        where cm.chat_id = c.id and mm.id <> ${me.id}) as others,
      (select mm2.phone from chat_members cm3 join members mm2 on mm2.id = cm3.member_id
        where cm3.chat_id = c.id and mm2.id <> ${me.id} and mm2.phone is not null limit 1) as other_phone,
      (select count(*)::int from chat_members cm2 where cm2.chat_id = c.id) as member_count
    from chats c
    where c.circle_id = ${circle.id}
      and (c.kind = 'circle'
           or exists (select 1 from chat_members x where x.chat_id = c.id and x.member_id = ${me.id}))
    order by (c.kind = 'circle') desc, c.created_at`;
  const ids = chats.map(c => c.id);
  let previews = [];
  if (ids.length) {
    previews = await sql`
      select distinct on (m.chat_id) m.chat_id,
             (case when m.kind = 'image' then '📷 Photo' else m.text end) as text,
             m.created_at,
             coalesce(mem.name, 'Ekta') as name
      from messages m left join members mem on mem.id = m.member_id
      where m.chat_id = any(${ids})
      order by m.chat_id, m.created_at desc`;
  }
  const pmap = {};
  previews.forEach(p => { pmap[p.chat_id] = { text: p.text, name: p.name, at: p.created_at }; });
  return chats.map(c => ({
    id: c.id, kind: c.kind,
    name: c.kind === 'dm' ? (c.others || 'Personal chat') : (c.name || 'Group'),
    others: c.others, otherPhone: c.kind === 'dm' ? c.other_phone : null,
    memberCount: c.member_count,
    last: pmap[c.id] || null
  }));
}

// She answers when a chat message speaks to her by name.
async function maybeEktaReply(sql, circle, me, chat, text) {
  if (!/\bekta\b|एकता/i.test(text)) return null;
  // any configured provider (env or vault) is enough for her to reply
  try {
    const recent = await sql`
      select coalesce(mem.name, 'Ekta') as name, m.text
      from messages m left join members mem on mem.id = m.member_id
      where m.chat_id = ${chat.id} order by m.created_at desc limit 10`;
    const transcript = recent.reverse().map(r => r.name + ': ' + r.text).join('\n');
    const history = [{
      role: 'user',
      content: 'You are a participant in the chat "' + (chat.name || 'family chat') + '" of this circle. Recent messages:\n' +
        transcript + '\n\nThe latest message mentions you. Reply to it directly as yourself, for the whole chat to read. Do not prefix your name.'
    }];
    const out = await ektaTurn(sql, circle, me, history);
    if (out && out.reply) {
      await sql`insert into messages (chat_id, member_id, text) values (${chat.id}, null, ${String(out.reply).slice(0, 2000)})`;
      return { replied: true, model: out.model, actions: out.actions };
    }
  } catch (e) { /* Ekta being unreachable must never block the human message */ }
  return null;
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return failDb(res, e); }

  try {
    const q = req.query || {};
    const body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;

    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, code, memberId, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const meRow = [_g.me];
    const me = meRow[0];

    if (req.method === 'GET') {
      if (q.chat) {
        const chat = await chatForMember(sql, circle, q.chat, me.id);
        if (!chat) return res.status(404).json({ ok: false, error: 'Chat not found' });
        const msgs = await sql`
          select m.id, m.text, m.kind, m.created_at, m.member_id,
                 coalesce(mem.name, 'Ekta') as name
          from messages m left join members mem on mem.id = m.member_id
          where m.chat_id = ${chat.id}
          order by m.created_at desc limit 50`;
        // Viewing the chat marks it read - receipts are always on, by design.
        await sql`insert into chat_reads (chat_id, member_id, read_at) values (${chat.id}, ${me.id}, now())
                  on conflict (chat_id, member_id) do update set read_at = now()`;
        const reads = await sql`
          select r.member_id, r.read_at, m.name
          from chat_reads r join members m on m.id = r.member_id
          where r.chat_id = ${chat.id}`;
        const participants = chat.kind === 'circle'
          ? await sql`select id, name from members where circle_id = ${circle.id} order by created_at`
          : await sql`select m.id, m.name from chat_members cm join members m on m.id = cm.member_id where cm.chat_id = ${chat.id} order by m.created_at`;
        return res.status(200).json({ ok: true, chat: { id: chat.id, kind: chat.kind, name: chat.name }, messages: msgs.reverse(), reads, members: participants });
      }
      const chats = await listChats(sql, circle, me);
      return res.status(200).json({ ok: true, chats });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    const action = body.action;

    if (action === 'send') {
      const chat = await chatForMember(sql, circle, body.chatId, me.id);
      if (!chat) return res.status(404).json({ ok: false, error: 'Chat not found' });
      const kind = body.kind === 'image' ? 'image' : 'text';
      let text;
      if (kind === 'image') {
        text = String(body.text || '');
        // The whole string must be base64, not merely start like it: a
        // correct prefix followed by `x" onerror=...` used to be stored and
        // then written into an src attribute in every member's browser.
        if (!safeImageUri(text) || text.length > 800000) {
          return res.status(400).json({ ok: false, error: 'Bad image' });
        }
      } else {
        text = String(body.text || '').trim().slice(0, 1000);
        if (!text) return res.status(400).json({ ok: false, error: 'Empty message' });
      }
      await sql`insert into messages (chat_id, member_id, text, kind) values (${chat.id}, ${me.id}, ${text}, ${kind})`;
      // device alerts: personal chats always ping the other person; in any
      // chat, an @mention pings the person named.
      try {
        const label = chat.kind === 'dm' ? me.name : (chat.name || 'family chat');
        const preview = kind === 'image' ? '📷 Photo' : text.slice(0, 90);
        if (chat.kind === 'dm') {
          const others = await sql`select member_id from chat_members where chat_id = ${chat.id} and member_id <> ${me.id}`;
          if (others[0]) await pushCircle(sql, circle.id, { title: '💬 ' + me.name, body: preview }, { only: others[0].member_id });
        } else {
          // everyone in this conversation hears about it - the people named
          // with @ get the louder "mentioned you" version, once each.
          const audience = chat.kind === 'circle'
            ? await sql`select id, name from members where circle_id = ${circle.id} and id <> ${me.id}`
            : await sql`select m.id, m.name from chat_members cm join members m on m.id = cm.member_id
                        where cm.chat_id = ${chat.id} and m.id <> ${me.id}`;
          const pinged = {};
          if (kind === 'text' && text.indexOf('@') >= 0) {
            for (const p of audience) {
              if (new RegExp('@' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
                pinged[p.id] = true;
                await pushCircle(sql, circle.id, { title: '💬 ' + me.name + ' mentioned you in ' + label, body: preview }, { only: p.id });
              }
            }
          }
          for (const p of audience) {
            if (pinged[p.id]) continue;
            await pushCircle(sql, circle.id, { title: '💬 ' + me.name + ' in ' + label, body: preview }, { only: p.id });
          }
        }
      } catch (e) { /* alerts never block the message */ }
      const ekta = kind === 'text' ? await maybeEktaReply(sql, circle, me, chat, text) : null;
      return res.status(201).json({ ok: true, ekta: ekta ? true : false });
    }

    if (action === 'create_group') {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ ok: false, error: 'The group needs a name' });
      const wanted = Array.isArray(body.memberIds) ? body.memberIds.filter(isUuid) : [];
      // Someone added to the tree by name never signs in: never in a chat.
      const valid = await sql`select id from members where circle_id = ${circle.id} and id = any(${wanted}) and user_id is not null`;
      const ids = valid.map(v => v.id);
      if (ids.indexOf(me.id) < 0) ids.push(me.id);
      const c = await sql`insert into chats (circle_id, kind, name) values (${circle.id}, 'group', ${name}) returning id`;
      for (const id of ids) {
        await sql`insert into chat_members (chat_id, member_id) values (${c[0].id}, ${id}) on conflict do nothing`;
        if (id !== me.id) {
          await pushCircle(sql, circle.id, { title: '👥 ' + me.name + ' started "' + name + '"', body: 'You have been added to the group' }, { only: id });
        }
      }
      return res.status(201).json({ ok: true, chatId: c[0].id });
    }

    if (action === 'open_dm') {
      const other = body.otherId;
      if (!isUuid(other) || other === me.id) return res.status(400).json({ ok: false, error: 'Pick a person to message' });
      const oRow = await sql`select id, name, user_id from members where id = ${other} and circle_id = ${circle.id}`;
      if (!oRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
      if (!oRow[0].user_id) return res.status(400).json({ ok: false, error: oRow[0].name + ' is not on Parwah, so cannot be messaged here' });
      const existing = await sql`
        select c.id from chats c
        where c.circle_id = ${circle.id} and c.kind = 'dm'
          and exists (select 1 from chat_members a where a.chat_id = c.id and a.member_id = ${me.id})
          and exists (select 1 from chat_members b where b.chat_id = c.id and b.member_id = ${other})`;
      if (existing[0]) return res.status(200).json({ ok: true, chatId: existing[0].id });
      const c = await sql`insert into chats (circle_id, kind, name) values (${circle.id}, 'dm', null) returning id`;
      await sql`insert into chat_members (chat_id, member_id) values (${c[0].id}, ${me.id})`;
      await sql`insert into chat_members (chat_id, member_id) values (${c[0].id}, ${other})`;
      return res.status(201).json({ ok: true, chatId: c[0].id });
    }

    if (action === 'add_member') {
      const chat = await chatForMember(sql, circle, body.chatId, me.id);
      if (!chat) return res.status(404).json({ ok: false, error: 'Chat not found' });
      if (chat.kind !== 'group') return res.status(400).json({ ok: false, error: chat.kind === 'circle' ? 'Everyone is already in the circle chat' : 'Personal chats stay 1:1 - make a group instead' });
      const addId = body.addId;
      if (!isUuid(addId)) return res.status(400).json({ ok: false, error: 'Pick a person to add' });
      const aRow = await sql`select id, name, user_id from members where id = ${addId} and circle_id = ${circle.id}`;
      if (!aRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
      if (!aRow[0].user_id) return res.status(400).json({ ok: false, error: aRow[0].name + ' is not on Parwah, so cannot be in a chat' });
      await sql`insert into chat_members (chat_id, member_id) values (${chat.id}, ${addId}) on conflict do nothing`;
      await sql`insert into messages (chat_id, member_id, text) values (${chat.id}, ${me.id}, ${'➕ Added ' + aRow[0].name + ' to the group'})`;
      // the person added is told; so is everyone already in the group
      await pushCircle(sql, circle.id, { title: '➕ ' + me.name + ' added you to ' + (chat.name || 'a group'), body: 'Open Parwah to say hello' }, { only: addId });
      const inGroup = await sql`select m.id from chat_members cm join members m on m.id = cm.member_id
                                where cm.chat_id = ${chat.id} and m.id <> ${me.id} and m.id <> ${addId}`;
      for (const p of inGroup) {
        await pushCircle(sql, circle.id, { title: '➕ ' + aRow[0].name + ' joined ' + (chat.name || 'the group'), body: 'Added by ' + me.name }, { only: p.id });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}
