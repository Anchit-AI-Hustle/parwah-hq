// TEMPORARY one-shot housekeeping endpoint — removed after running once.
// GET  /api/tidy                    → dry-run report (masked phones)
// POST /api/tidy {confirm:'TANDONS'} → perform the founder-requested cleanup:
//   keep one family (code TANDONS, renamed "Tandons"), merge the duplicate
//   Anchit member, pull every real signed-up profile into the family,
//   drop test circles and orphan users.
import { db, ensureSchema } from './_db.mjs';

const KEEP_CODE = 'TANDONS';
const KEEP_PHONE = '+919873945238';

function mask(p){ return p ? p.slice(0, 3) + '•••••' + p.slice(-4) : null; }

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  try {
    const applyViaGet = req.method === 'GET' && (req.query || {}).confirm === KEEP_CODE && (req.query || {}).apply === '1';
    if (req.method === 'GET' && !applyViaGet) {
      const users = await sql`select u.id, u.name, u.phone,
        (select count(*)::int from members m where m.user_id = u.id) as memberships
        from users u order by u.created_at`;
      const circles = await sql`select c.id, c.code, c.name,
        (select string_agg(m.name, ', ' order by m.created_at) from members m where m.circle_id = c.id) as members
        from circles c order by c.created_at`;
      return res.status(200).json({ ok: true, dryRun: true,
        users: users.map(u => ({ name: u.name, phone: mask(u.phone), memberships: u.memberships })),
        circles: circles.map(c => ({ code: c.code, name: c.name, members: c.members })) });
    }
    if (!applyViaGet && (req.method !== 'POST' || (req.body || {}).confirm !== KEEP_CODE)) {
      return res.status(400).json({ ok: false, error: 'POST {confirm} required' });
    }

    const out = { renamed: false, merged: 0, added: [], circlesDeleted: 0, usersDeleted: 0 };
    const cRow = await sql`select id, name from circles where code = ${KEEP_CODE}`;
    if (!cRow[0]) return res.status(404).json({ ok: false, error: 'Keep-circle not found' });
    const cid = cRow[0].id;

    await sql`update circles set name = 'Tandons' where id = ${cid}`;
    out.renamed = cRow[0].name !== 'Tandons';

    // merge duplicate members of the kept person (same name, no phone/user link)
    const keepU = await sql`select id from users where phone = ${KEEP_PHONE}`;
    const keep = await sql`select id from members where circle_id = ${cid} and phone = ${KEEP_PHONE}`;
    if (keep[0]) {
      if (keepU[0]) await sql`update members set user_id = ${keepU[0].id} where id = ${keep[0].id}`;
      const dups = await sql`select id from members where circle_id = ${cid}
                             and lower(name) = 'anchit tandon' and id <> ${keep[0].id}`;
      for (const d of dups) {
        await sql`update events set member_id = ${keep[0].id} where member_id = ${d.id}`;
        await sql`update messages set member_id = ${keep[0].id} where member_id = ${d.id}`;
        await sql`update reminders set for_member = ${keep[0].id} where for_member = ${d.id}`;
        await sql`update reminders set by_member = ${keep[0].id} where by_member = ${d.id}`;
        await sql`update requests set by_member = ${keep[0].id} where by_member = ${d.id}`;
        await sql`update requests set claimed_by = ${keep[0].id} where claimed_by = ${d.id}`;
        await sql`update plans set by_member = ${keep[0].id} where by_member = ${d.id}`;
        await sql`delete from members where id = ${d.id}`;
        out.merged++;
      }
    }

    // every signed-up profile gets its seat in the family (unless the name is taken)
    const allU = await sql`select id, name, phone from users order by created_at`;
    for (const u of allU) {
      const already = await sql`select id from members where circle_id = ${cid} and (user_id = ${u.id} or lower(name) = lower(${u.name}))`;
      if (already[0]) continue;
      await sql`insert into members (circle_id, name, role, phone, user_id) values (${cid}, ${u.name}, 'family', ${u.phone}, ${u.id})`;
      await sql`insert into events (circle_id, member_id, type, text)
                select ${cid}, id, 'join', ${u.name + ' joined the circle'} from members where circle_id = ${cid} and user_id = ${u.id}`;
      out.added.push(u.name);
    }

    // real people who only exist in doomed test circles get their seat too
    const stray = await sql`select distinct on (lower(name)) name, phone, user_id, relation
                            from members where circle_id <> ${cid} order by lower(name), created_at`;
    for (const m of stray) {
      const clash = await sql`select id from members where circle_id = ${cid}
        and (lower(name) = lower(${m.name})
             or (phone is not null and phone = ${m.phone})
             or (user_id is not null and user_id = ${m.user_id}))`;
      if (clash[0]) continue;
      await sql`insert into members (circle_id, name, role, phone, user_id, relation)
                values (${cid}, ${m.name}, 'family', ${m.phone}, ${m.user_id}, ${m.relation})`;
      out.added.push(m.name);
    }

    // collapse two seats that are really one person: same last-10 phone digits
    const seats = await sql`select id, name, phone, user_id from members where circle_id = ${cid} order by created_at`;
    const byDigits = {};
    for (const m of seats) {
      const d = String(m.phone || '').replace(/\D/g, '').slice(-10);
      if (!d) continue;
      if (!byDigits[d]) { byDigits[d] = m; continue; }
      let keepS = byDigits[d], dropS = m;
      if (!keepS.user_id && m.user_id) { keepS = m; dropS = byDigits[d]; byDigits[d] = m; }
      await sql`update events set member_id = ${keepS.id} where member_id = ${dropS.id}`;
      await sql`update messages set member_id = ${keepS.id} where member_id = ${dropS.id}`;
      await sql`update reminders set for_member = ${keepS.id} where for_member = ${dropS.id}`;
      await sql`update reminders set by_member = ${keepS.id} where by_member = ${dropS.id}`;
      await sql`update requests set by_member = ${keepS.id} where by_member = ${dropS.id}`;
      await sql`update requests set claimed_by = ${keepS.id} where claimed_by = ${dropS.id}`;
      await sql`update plans set by_member = ${keepS.id} where by_member = ${dropS.id}`;
      await sql`delete from members where id = ${dropS.id}`;
      out.merged++;
    }

    // test circles out; orphan users out
    const gone = await sql`delete from circles where id <> ${cid} returning id`;
    out.circlesDeleted = gone.length;
    const goneU = await sql`delete from users u where u.phone <> ${KEEP_PHONE}
                            and not exists (select 1 from members m where m.user_id = u.id) returning id`;
    out.usersDeleted = goneU.length;

    // with duplicates gone, the integrity indexes can take hold
    try { await sql`create unique index if not exists members_circle_user on members (circle_id, user_id) where user_id is not null`; } catch (e) {}
    try { await sql`create unique index if not exists members_circle_name on members (circle_id, lower(name))`; } catch (e) {}

    const finalMembers = await sql`select name, phone, relation from members where circle_id = ${cid} order by created_at`;
    return res.status(200).json({ ok: true, done: out,
      family: 'Tandons', members: finalMembers.map(m => ({ name: m.name, phone: mask(m.phone), relation: m.relation })) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
