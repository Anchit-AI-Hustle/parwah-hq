// POST /api/circle — create a care circle or join one with its code.
import { db, ensureSchema, makeCode, circleByCode, isUuid } from './_db.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  const { action, circleName, code, memberName, role, phone, userId } = req.body || {};
  // Family role labels — purely descriptive; every member is an equal admin.
  const RELATIONS = ['father', 'mother', 'grandfather', 'grandmother', 'son', 'daughter', 'brother', 'sister', 'family'];
  const relation = RELATIONS.includes(req.body.relation) ? req.body.relation : null;
  const uid = isUuid(userId) ? userId : null;
  const name = String(memberName || '').trim().slice(0, 60);
  const r = role === 'parent' ? 'parent' : 'family';
  // Optional phone number — powers the 📞 call buttons; digits/+/()/-/space only.
  let ph = String(phone || '').trim();
  ph = /^[+()\-\s0-9]{7,20}$/.test(ph) ? ph : null;
  const NAMELESS = ['update_member', 'leave', 'set_code'];
  if (!name && !NAMELESS.includes(action)) return res.status(400).json({ ok: false, error: 'Please tell us your name' });

  try {
    // A signed-in user carries their profile phone into every membership.
    let user = null;
    if (uid) {
      const u = await sql`select id, name, phone from users where id = ${uid}`;
      user = u[0] || null;
    }
    const memberPhone = ph || (user && user.phone) || null;
    if (action === 'create') {
      const cname = String(circleName || '').trim().slice(0, 60) || (name + "'s family");
      let circle = null;
      for (let i = 0; i < 5 && !circle; i++) {
        const c = makeCode();
        try {
          const rows = await sql`insert into circles (code, name) values (${c}, ${cname}) returning id, code, name`;
          circle = rows[0];
        } catch (e) { /* code collision — retry with a new code */ }
      }
      if (!circle) return res.status(500).json({ ok: false, error: 'Could not create the circle, please try again' });
      const m = await sql`insert into members (circle_id, name, role, phone, user_id, relation) values (${circle.id}, ${name}, ${r}, ${memberPhone}, ${user ? user.id : null}, ${relation}) returning id`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${m[0].id}, 'join', ${name + ' created the circle'})`;
      return res.status(201).json({ ok: true, code: circle.code, circleName: circle.name, memberId: m[0].id, role: r });
    }

    if (action === 'join') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      if (user) {
        // Already a member of this circle? Sign back into that membership.
        const ex = await sql`select id, role from members where circle_id = ${circle.id} and user_id = ${user.id}`;
        if (ex[0]) return res.status(200).json({ ok: true, code: circle.code, circleName: circle.name, memberId: ex[0].id, role: ex[0].role });
        // A membership created before phone sign-in existed carries no user
        // link — claim it by matching phone instead of inserting a duplicate.
        const legacy = await sql`select id, role from members where circle_id = ${circle.id} and user_id is null and phone = ${user.phone}`;
        if (legacy[0]) {
          await sql`update members set user_id = ${user.id} where id = ${legacy[0].id}`;
          return res.status(200).json({ ok: true, code: circle.code, circleName: circle.name, memberId: legacy[0].id, role: legacy[0].role });
        }
      }
      const m = await sql`insert into members (circle_id, name, role, phone, user_id, relation) values (${circle.id}, ${name}, ${r}, ${memberPhone}, ${user ? user.id : null}, ${relation}) returning id`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${m[0].id}, 'join', ${name + ' joined the circle'})`;
      return res.status(200).json({ ok: true, code: circle.code, circleName: circle.name, memberId: m[0].id, role: r });
    }

    if (action === 'set_code') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const newCode = String(req.body.newCode || '').toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z0-9]{4,12}$/.test(newCode)) {
        return res.status(400).json({ ok: false, error: 'Codes are 4-12 letters and numbers, e.g. SHARMAS' });
      }
      if (newCode === circle.code) return res.status(200).json({ ok: true, code: newCode });
      try {
        await sql`update circles set code = ${newCode} where id = ${circle.id}`;
      } catch (e) {
        return res.status(409).json({ ok: false, error: 'That code is already taken by another circle — try a different one' });
      }
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${mRow[0].id}, 'care', ${mRow[0].name + ' set the circle invite code to ' + newCode})`;
      return res.status(200).json({ ok: true, code: newCode });
    }

    if (action === 'leave') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      await sql`delete from members where id = ${mRow[0].id}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, null, 'care', ${mRow[0].name + ' left the circle 👋'})`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'update_member') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await sql`select id, name, role, phone, place, country, relation, user_id from members where id = ${memberId} and circle_id = ${circle.id}`;
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const cur = mRow[0];
      const newName = name || cur.name;
      const newRole = (role === 'parent' || role === 'family') ? role : cur.role;
      const newPhone = ph !== null ? ph : cur.phone;
      const newRelation = relation || cur.relation;
      // Place of stay — free text; country as a 2-letter code drives regional gifting.
      const newPlace = req.body.place !== undefined ? (String(req.body.place || '').trim().slice(0, 80) || null) : cur.place;
      const newCountry = req.body.country !== undefined
        ? (/^[A-Z]{2}$/.test(String(req.body.country || '')) ? req.body.country : null)
        : cur.country;
      await sql`update members set name = ${newName}, role = ${newRole}, phone = ${newPhone}, place = ${newPlace}, country = ${newCountry}, relation = ${newRelation} where id = ${cur.id}`;
      // One person, one home, one number — keep their other family/group
      // memberships consistent. Place/country always follow the person;
      // the phone follows only rows still carrying the old value (a circle
      // can keep a deliberately different contact number).
      if (cur.user_id) {
        if (req.body.place !== undefined || req.body.country !== undefined) {
          await sql`update members set place = ${newPlace}, country = ${newCountry} where user_id = ${cur.user_id} and id <> ${cur.id}`;
        }
        if (ph !== null && ph !== cur.phone) {
          await sql`update members set phone = ${ph} where user_id = ${cur.user_id} and id <> ${cur.id} and (phone is null or phone = ${cur.phone})`;
        }
      }
      if (newName !== cur.name || newRole !== cur.role) {
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${cur.id}, 'care', ${cur.name + ' updated their profile' + (newName !== cur.name ? ' — now ' + newName : '')})`;
      }
      return res.status(200).json({ ok: true, name: newName, role: newRole, relation: newRelation, phone: newPhone, place: newPlace, country: newCountry });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
