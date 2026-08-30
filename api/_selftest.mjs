// GET /api/selftest — end-to-end test of the app backend against the live
// database: creates a throwaway circle, exercises every event type, verifies
// reads, then deletes the circle (cascades to members and events).
import { db, ensureSchema, makeCode, ensureCircleChat } from './_db.mjs';
import { ensureVaultSchema, ensurePaySchema, checkNumber } from './_vaultapi.mjs';

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

    // THE VAULT — the access rules are proved against the real database,
    // not just asserted in the interface.
    await ensureVaultSchema(sql); await ensurePaySchema(sql);
    const nosy = await sql`insert into members (circle_id, name, role) values (${circleId}, 'Test Nosy', 'family') returning id`;
    steps.vault_schema = true;

    // A real Aadhaar shape passes; the same number with one digit changed does not.
    const good = checkNumber('aadhaar', '234567890124');
    const bad = checkNumber('aadhaar', '234567890125');
    steps.vault_checksum = good.ok === true && good.last4 === '0124' && bad.ok === false;

    const doc = await sql`
      insert into vault_docs (circle_id, about_member, kind, label, last4, format_ok, file_name, file_mime, file_size, by_member)
      values (${circleId}, ${papa[0].id}, 'passport', 'Selftest passport', '4567', true, 'p.pdf', 'application/pdf', 5, ${beta[0].id})
      returning id, last4`;
    await sql`insert into vault_files (doc_id, bytes) values (${doc[0].id}, decode(${'aGVsbG8='}, 'base64'))`;
    const back2 = await sql`select encode(bytes, 'base64') as b64 from vault_files where doc_id = ${doc[0].id}`;
    steps.vault_store = doc[0].last4 === '4567' && back2[0].b64 === 'aGVsbG8=';

    // The visibility rule itself: a member with no grant gets nothing back.
    const seenBy = (who) => sql`
      select d.id from vault_docs d
      left join vault_access a on a.doc_id = d.id and a.member_id = ${who}
      where d.circle_id = ${circleId}
        and (d.about_member = ${who} or d.by_member = ${who} or a.member_id is not null)`;
    const beforeGrant = await seenBy(nosy[0].id);
    await sql`insert into vault_access (doc_id, member_id, level, granted_by)
              values (${doc[0].id}, ${nosy[0].id}, 'view', ${papa[0].id})`;
    const afterGrant = await seenBy(nosy[0].id);
    const ownerSees = await seenBy(papa[0].id);
    steps.vault_permission = beforeGrant.length === 0 && afterGrant.length === 1 && ownerSees.length === 1;

    await sql`insert into vault_log (doc_id, member_id, action) values (${doc[0].id}, ${nosy[0].id}, 'opened')`;
    const alog = await sql`select action from vault_log where doc_id = ${doc[0].id}`;
    steps.vault_audit = alog.length === 1 && alog[0].action === 'opened';

    // Payment permissions: allowed for one person, not another.
    const pm = await sql`insert into pay_methods (circle_id, owner_member, kind, label, handle, per_txn_cap)
                         values (${circleId}, ${papa[0].id}, 'upi', 'Selftest UPI', 'test@okbank', 5000) returning id`;
    await sql`insert into pay_perms (method_id, member_id, per_txn_cap, granted_by)
              values (${pm[0].id}, ${beta[0].id}, 2000, ${papa[0].id})`;
    const canUse = (who) => sql`
      select (p.owner_member = ${who} or pp.member_id is not null) as can_use
      from pay_methods p left join pay_perms pp on pp.method_id = p.id and pp.member_id = ${who}
      where p.id = ${pm[0].id}`;
    const betaUse = await canUse(beta[0].id);
    const nosyUse = await canUse(nosy[0].id);
    const ownerUse = await canUse(papa[0].id);
    steps.pay_permission = betaUse[0].can_use === true && nosyUse[0].can_use === false && ownerUse[0].can_use === true;

    await sql`delete from circles where id = ${c2[0].id}`;
    await sql`delete from users where id = ${u[0].id}`;
    await sql`delete from circles where id = ${circleId}`;
    const leftover = await sql`select id from events where circle_id = ${circleId}`;
    const leftChats = await sql`select id from chats where circle_id = ${circleId}`;
    const leftReads = await sql`select chat_id from chat_reads where chat_id = ${everyoneId}`;
    const leftDocs = await sql`select id from vault_docs where circle_id = ${circleId}`;
    const leftFiles = await sql`select doc_id from vault_files where doc_id = ${doc[0].id}`;
    const leftPay = await sql`select id from pay_methods where circle_id = ${circleId}`;
    steps.cleanup_cascade = leftover.length === 0 && leftChats.length === 0 && leftReads.length === 0
      && leftDocs.length === 0 && leftFiles.length === 0 && leftPay.length === 0;
    circleId = null;

    const ok = Object.values(steps).every(Boolean);
    return res.status(ok ? 200 : 500).json({ ok, steps });
  } catch (e) {
    if (circleId) { try { await sql`delete from circles where id = ${circleId}`; } catch (_) {} }
    return res.status(500).json({ ok: false, steps, error: String(e && e.message || e) });
  }
}
