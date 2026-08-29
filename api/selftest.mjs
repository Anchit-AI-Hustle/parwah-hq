// GET /api/selftest — end-to-end test of the app backend against the live
// database: creates a throwaway circle, exercises every event type, verifies
// reads, then deletes the circle (cascades to members and events).
import { db, ensureSchema, makeCode, ensureCircleChat } from './_db.mjs';

export default async function handler(req, res) {
  const steps = {};
  let sql;
  try { sql = db(); await ensureSchema(sql); steps.schema = true; }
  catch (e) { return res.status(500).json({ ok: false, failed: 'schema', error: String(e && e.message || e) }); }

  let circleId = null;
  try {
    const code = 'T' + makeCode().slice(1);
    const c = await sql`insert into circles (code, name) values (${code}, 'Selftest Circle') returning id, code`;
    circleId = c[0].id; steps.create_circle = true;

    const papa = await sql`insert into members (circle_id, name, role) values (${circleId}, 'Test Papa', 'parent') returning id`;
    const beta = await sql`insert into members (circle_id, name, role) values (${circleId}, 'Test Beta', 'family') returning id`;
    steps.add_members = true;

    await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${papa[0].id}, 'checkin', null)`;
    await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${papa[0].id}, 'sos', null)`;
    await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${papa[0].id}, 'pill', null)`;
    await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${beta[0].id}, 'message', 'Papa, all okay?')`;
    steps.write_events = true;

    const feed = await sql`
      select e.type, m.name from events e left join members m on m.id = e.member_id
      where e.circle_id = ${circleId} order by e.created_at`;
    steps.read_feed = feed.length === 4 &&
      feed.map(f => f.type).sort().join(',') === 'checkin,message,pill,sos';

    // chats: default circle chat, a group, a 1:1, and messages in each
    const everyoneId = await ensureCircleChat(sql, circleId);
    const again = await ensureCircleChat(sql, circleId);
    steps.chat_default = !!everyoneId && everyoneId === again;

    const g = await sql`insert into chats (circle_id, kind, name) values (${circleId}, 'group', 'Test Group') returning id`;
    await sql`insert into chat_members (chat_id, member_id) values (${g[0].id}, ${papa[0].id})`;
    await sql`insert into chat_members (chat_id, member_id) values (${g[0].id}, ${beta[0].id})`;
    const d = await sql`insert into chats (circle_id, kind, name) values (${circleId}, 'dm', null) returning id`;
    await sql`insert into chat_members (chat_id, member_id) values (${d[0].id}, ${papa[0].id})`;
    await sql`insert into chat_members (chat_id, member_id) values (${d[0].id}, ${beta[0].id})`;
    steps.chat_create = true;

    await sql`insert into messages (chat_id, member_id, text) values (${everyoneId}, ${beta[0].id}, 'Hello everyone')`;
    await sql`insert into messages (chat_id, member_id, text) values (${g[0].id}, ${papa[0].id}, 'Group hello')`;
    await sql`insert into messages (chat_id, member_id, text) values (${d[0].id}, null, 'Namaste from Ekta')`;
    const msgs = await sql`
      select coalesce(m2.name, 'Ekta') as name from messages m
      left join members m2 on m2.id = m.member_id
      join chats c on c.id = m.chat_id where c.circle_id = ${circleId}`;
    steps.chat_messages = msgs.length === 3 && msgs.some(m => m.name === 'Ekta');

    await sql`delete from circles where id = ${circleId}`;
    const leftover = await sql`select id from events where circle_id = ${circleId}`;
    const leftChats = await sql`select id from chats where circle_id = ${circleId}`;
    steps.cleanup_cascade = leftover.length === 0 && leftChats.length === 0;
    circleId = null;

    const ok = Object.values(steps).every(Boolean);
    return res.status(ok ? 200 : 500).json({ ok, steps });
  } catch (e) {
    if (circleId) { try { await sql`delete from circles where id = ${circleId}`; } catch (_) {} }
    return res.status(500).json({ ok: false, steps, error: String(e && e.message || e) });
  }
}
