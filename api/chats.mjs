// The chat system: one default "Everyone" chat per circle, unlimited named
// group chats, and personal (1:1) chats — all private to the circle.
// Ekta is an automatic participant: mention "Ekta" in any chat and she
// replies into the chat itself (as a message with member_id null).
//
// GET  /api/chats?circle=CODE&member=UUID           → chat list (+ previews)
// GET  /api/chats?circle=CODE&member=UUID&chat=UUID → messages of one chat
// POST /api/chats {code, memberId, action, ...}
//   send         {chatId, text}
//   create_group {name, memberIds[]}
//   open_dm      {otherId}   (returns the existing 1:1 chat if there is one)
import { db, ensureSchema, circleByCode, isUuid, ensureCircleChat } from './_db.mjs';
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
      select distinct on (m.chat_id) m.chat_id, m.text, m.created_at,
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
    others: c.others, memberCount: c.member_count,
    last: pmap[c.id] || null
  }));
}

// She answers when a chat message speaks to her by name.
async function maybeEktaReply(sql, circle, me, chat, text) {
  if (!/\bekta\b|एकता/i.test(text)) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;
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
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  try {
    const q = req.query || {};
    const body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;

    const circle = await circleByCode(sql, code);
    if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
    if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const meRow = await sql`select id, name, role from members where id = ${memberId} and circle_id = ${circle.id}`;
    if (!meRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const me = meRow[0];

    if (req.method === 'GET') {
      if (q.chat) {
        const chat = await chatForMember(sql, circle, q.chat, me.id);
        if (!chat) return res.status(404).json({ ok: false, error: 'Chat not found' });
        const msgs = await sql`
          select m.id, m.text, m.created_at, m.member_id,
                 coalesce(mem.name, 'Ekta') as name
          from messages m left join members mem on mem.id = m.member_id
          where m.chat_id = ${chat.id}
          order by m.created_at desc limit 50`;
        return res.status(200).json({ ok: true, chat: { id: chat.id, kind: chat.kind, name: chat.name }, messages: msgs.reverse() });
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
      const text = String(body.text || '').trim().slice(0, 1000);
      if (!text) return res.status(400).json({ ok: false, error: 'Empty message' });
      await sql`insert into messages (chat_id, member_id, text) values (${chat.id}, ${me.id}, ${text})`;
      const ekta = await maybeEktaReply(sql, circle, me, chat, text);
      return res.status(201).json({ ok: true, ekta: ekta ? true : false });
    }

    if (action === 'create_group') {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ ok: false, error: 'The group needs a name' });
      const wanted = Array.isArray(body.memberIds) ? body.memberIds.filter(isUuid) : [];
      const valid = await sql`select id from members where circle_id = ${circle.id} and id = any(${wanted})`;
      const ids = valid.map(v => v.id);
      if (ids.indexOf(me.id) < 0) ids.push(me.id);
      const c = await sql`insert into chats (circle_id, kind, name) values (${circle.id}, 'group', ${name}) returning id`;
      for (const id of ids) {
        await sql`insert into chat_members (chat_id, member_id) values (${c[0].id}, ${id}) on conflict do nothing`;
      }
      return res.status(201).json({ ok: true, chatId: c[0].id });
    }

    if (action === 'open_dm') {
      const other = body.otherId;
      if (!isUuid(other) || other === me.id) return res.status(400).json({ ok: false, error: 'Pick a person to message' });
      const oRow = await sql`select id from members where id = ${other} and circle_id = ${circle.id}`;
      if (!oRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
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

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
