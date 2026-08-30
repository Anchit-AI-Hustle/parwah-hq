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

    // one person across many circles: place/country/phone stay consistent
    const tphone = '+9198' + String(Date.now()).slice(-8);
    const u = await sql`insert into users (phone, name) values (${tphone}, 'Test User') returning id, phone`;
    await sql`update members set user_id = ${u[0].id}, phone = ${tphone} where id = ${papa[0].id}`;
    const c2 = await sql`insert into circles (code, name) values (${'T' + makeCode().slice(1)}, 'Selftest Circle 2') returning id`;
    const m2 = await sql`insert into members (circle_id, name, role, phone, user_id) values (${c2[0].id}, 'Test Papa', 'parent', ${tphone}, ${u[0].id}) returning id`;
    await sql`update members set place = 'Pune', country = 'IN' where id = ${papa[0].id}`;
    await sql`update members set place = 'Pune', country = 'IN' where user_id = ${u[0].id} and id <> ${papa[0].id}`;
    const nphone = tphone.slice(0, -1) + '9';
    await sql`update members set phone = ${nphone} where user_id = ${u[0].id} and (phone is null or phone = ${tphone})`;
    const synced = await sql`select place, country, phone from members where id in (${papa[0].id}, ${m2[0].id})`;
    steps.profile_sync = synced.length === 2 &&
      synced.every(x => x.place === 'Pune' && x.country === 'IN' && x.phone === nphone);

    // read receipts + notification cursor upserts are idempotent
    await sql`insert into chat_reads (chat_id, member_id) values (${everyoneId}, ${beta[0].id}) on conflict (chat_id, member_id) do update set read_at = now()`;
    await sql`insert into chat_reads (chat_id, member_id) values (${everyoneId}, ${beta[0].id}) on conflict (chat_id, member_id) do update set read_at = now()`;
    await sql`insert into notif_seen (member_id, seen_at) values (${beta[0].id}, now()) on conflict (member_id) do update set seen_at = now()`;
    await sql`insert into notif_seen (member_id, seen_at) values (${beta[0].id}, now()) on conflict (member_id) do update set seen_at = now()`;
    const reads = await sql`select count(*)::int as n from chat_reads where chat_id = ${everyoneId} and member_id = ${beta[0].id}`;
    const seen = await sql`select count(*)::int as n from notif_seen where member_id = ${beta[0].id}`;
    steps.reads_seen = reads[0].n === 1 && seen[0].n === 1;

    // custom invite codes: settable, unique across all circles
    const custom = 'TC' + String(Date.now()).slice(-6) + 'X';
    await sql`update circles set code = ${custom} where id = ${c2[0].id}`;
    const back = await sql`select code from circles where id = ${c2[0].id}`;
    let dupBlocked = false;
    try { await sql`update circles set code = ${custom} where id = ${circleId}`; } catch (e) { dupBlocked = true; }
    steps.custom_code = back[0].code === custom && dupBlocked;

    await sql`delete from circles where id = ${c2[0].id}`;
    await sql`delete from users where id = ${u[0].id}`;
    await sql`delete from circles where id = ${circleId}`;
    const leftover = await sql`select id from events where circle_id = ${circleId}`;
    const leftChats = await sql`select id from chats where circle_id = ${circleId}`;
    const leftReads = await sql`select chat_id from chat_reads where chat_id = ${everyoneId}`;
    steps.cleanup_cascade = leftover.length === 0 && leftChats.length === 0 && leftReads.length === 0;
    circleId = null;

    const ok = Object.values(steps).every(Boolean);
    return res.status(ok ? 200 : 500).json({ ok, steps });
  } catch (e) {
    if (circleId) { try { await sql`delete from circles where id = ${circleId}`; } catch (_) {} }
    return res.status(500).json({ ok: false, steps, error: String(e && e.message || e) });
  }
}
