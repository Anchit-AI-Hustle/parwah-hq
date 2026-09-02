// POST /api/circle — create a care circle or join one with its code.
import { db, ensureSchema, makeCode, circleByCode, isUuid, normPhone, phoneError, rateLimit, clientIp, serverError } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { award } from './_coins.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return serverError(res, e, 'circle'); }

  const { action, circleName, code, memberName, role, phone, userId } = req.body || {};
  // Family role labels — purely descriptive; every member is an equal admin.
  const RELATIONS = ['father', 'mother', 'grandfather', 'grandmother', 'son', 'daughter', 'brother', 'sister', 'family'];
  const relation = RELATIONS.includes(req.body.relation) ? req.body.relation : null;
  // Gifting details — sizes and tastes so anyone in the family can gift
  // confidently. Whitelisted keys, each a short free-text field.
  const GIFT_KEYS = ['clothes', 'shoe', 'ring', 'color', 'likes', 'wishlist'];
  let giftInfo;
  if (req.body.giftInfo && typeof req.body.giftInfo === 'object') {
    giftInfo = {};
    GIFT_KEYS.forEach(k => {
      const v = String(req.body.giftInfo[k] || '').trim().slice(0, 120);
      if (v) giftInfo[k] = v;
    });
  }
  const uid = isUuid(userId) ? userId : null;
  const name = String(memberName || '').trim().slice(0, 60);
  const r = role === 'parent' ? 'parent' : 'family';
  // Optional phone — country code kept separate, local number validated
  // against that country's rules. Invalid input is REJECTED, never silently
  // dropped, so a typo cannot masquerade as "no number".
  let ph = null, phCc = null, phLocal = null;
  if (String(phone || '').trim()) {
    const pp = normPhone(phone, req.body.phoneCc);
    if (!pp) return res.status(400).json({ ok: false, error: phoneError(req.body.phoneCc) });
    ph = pp.e164; phCc = pp.cc; phLocal = pp.local;
  }
  // An invite code is short enough to guess if you are allowed to keep
  // trying. You are not: joining is capped per address, per ten minutes.
  if (action === 'join') {
    const allowed = await rateLimit(sql, 'join', clientIp(req), 12, 600);
    if (!allowed) return res.status(429).json({ ok: false, error: 'Too many join attempts from this device — please wait a few minutes and try again' });
  }

  const NAMELESS = ['update_member', 'leave', 'set_code', 'approve_join', 'decline_join', 'set_join_policy'];
  if (!name && !NAMELESS.includes(action)) return res.status(400).json({ ok: false, error: 'Please tell us your name' });

  try {
    // A signed-in user carries their profile phone into every membership.
    let user = null;
    if (uid) {
      const u = await sql`select id, name, phone from users where id = ${uid}`;
      user = u[0] || null;
    }
    const memberPhone = ph || (user && user.phone) || null;
    const mp = memberPhone ? normPhone(memberPhone) : null;
    const memberCc = mp ? mp.cc : null, memberLocal = mp ? mp.local : null;
    if (action === 'create') {
      const kind = req.body.kind === 'group' ? 'group' : 'family';
      const cname = String(circleName || '').trim().slice(0, 60) || (name + (kind === 'group' ? "'s group" : "'s family"));
      let circle = null;
      for (let i = 0; i < 5 && !circle; i++) {
        const c = makeCode();
        try {
          const rows = await sql`insert into circles (code, name, kind) values (${c}, ${cname}, ${kind}) returning id, code, name, kind`;
          circle = rows[0];
        } catch (e) { /* code collision — retry with a new code */ }
      }
      if (!circle) return res.status(500).json({ ok: false, error: 'Could not create the circle, please try again' });
      const m = await sql`insert into members (circle_id, name, role, phone, phone_cc, phone_local, user_id, relation) values (${circle.id}, ${name}, ${r}, ${memberPhone}, ${memberCc}, ${memberLocal}, ${user ? user.id : null}, ${relation}) returning id`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${m[0].id}, 'join', ${name + ' created the ' + kind})`;
      // Ekta works from the first minute — a new family is not asked to earn
      // its way to a working assistant.
      await award(sql, circle.id, m[0].id, 'welcome', 'circle');
      return res.status(201).json({ ok: true, code: circle.code, circleName: circle.name, kind: circle.kind, memberId: m[0].id, role: r });
    }

    if (action === 'join') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      if (user) {
        // Already a member of this circle? Sign back into that membership.
        const ex = await sql`select id, role from members where circle_id = ${circle.id} and user_id = ${user.id}`;
        if (ex[0]) return res.status(200).json({ ok: true, code: circle.code, circleName: circle.name, memberId: ex[0].id, role: ex[0].role });
        // A membership created before phone sign-in existed carries no user
        // link — claim it by matching phone digits instead of duplicating.
        const unlinked = await sql`select id, role, phone from members where circle_id = ${circle.id} and user_id is null and phone is not null`;
        const myDigits = String(user.phone).replace(/\D/g, '').slice(-10);
        const legacy = unlinked.find(x => String(x.phone).replace(/\D/g, '').slice(-10) === myDigits);
        if (legacy) {
          const lp = normPhone(user.phone);
          await sql`update members set user_id = ${user.id}, phone = ${user.phone}, phone_cc = ${lp ? lp.cc : null}, phone_local = ${lp ? lp.local : null} where id = ${legacy.id}`;
          return res.status(200).json({ ok: true, code: circle.code, circleName: circle.name, memberId: legacy.id, role: legacy.role });
        }
      }
      // One person, one seat: a name can appear only once in a circle, and a
      // mobile number can hold only one membership in it.
      const dupName = await sql`select id from members where circle_id = ${circle.id} and lower(name) = lower(${name})`;
      if (dupName[0]) return res.status(409).json({ ok: false, error: 'Someone in this circle is already called ' + name + ' — add a surname or initial' });
      if (memberPhone) {
        const dupPhone = await sql`select id from members where circle_id = ${circle.id} and phone = ${memberPhone}`;
        if (dupPhone[0]) return res.status(409).json({ ok: false, error: 'This mobile number is already in the circle — sign in with it instead' });
      }

      // The code opens the door; the family decides who comes in. Anyone
      // already inside can say yes — no owner, no hierarchy.
      const pol = await sql`select join_policy from circles where id = ${circle.id}`;
      if (pol[0] && pol[0].join_policy === 'approve') {
        const already = user
          ? await sql`select id from join_requests where circle_id = ${circle.id} and user_id = ${user.id} and status = 'pending'`
          : await sql`select id from join_requests where circle_id = ${circle.id} and status = 'pending' and lower(name) = lower(${name})`;
        if (!already[0]) {
          await sql`insert into join_requests (circle_id, user_id, name, phone, phone_cc, phone_local, relation, role)
                    values (${circle.id}, ${user ? user.id : null}, ${name}, ${memberPhone}, ${memberCc}, ${memberLocal}, ${relation}, ${r})`;
          await sql`insert into events (circle_id, member_id, type, text)
                    values (${circle.id}, null, 'care', ${name + ' has asked to join — any member can let them in'})`;
          await pushCircle(sql, circle.id, {
            title: '🙋 ' + name + ' wants to join ' + circle.name,
            body: 'Open Parwah to let them in — or say no if you do not know them'
          }, {});
        }
        return res.status(202).json({ ok: true, pending: true, circleName: circle.name, code: circle.code,
          message: 'Your request has gone to ' + circle.name + '. Anyone in the family can let you in.' });
      }

      const m = await sql`insert into members (circle_id, name, role, phone, phone_cc, phone_local, user_id, relation) values (${circle.id}, ${name}, ${r}, ${memberPhone}, ${memberCc}, ${memberLocal}, ${user ? user.id : null}, ${relation}) returning id`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${m[0].id}, 'join', ${name + ' joined the circle'})`;
      await pushCircle(sql, circle.id, { title: '🧡 ' + name + ' joined ' + circle.name, body: 'Say hello in the family chat' }, { except: m[0].id });
      return res.status(200).json({ ok: true, code: circle.code, circleName: circle.name, memberId: m[0].id, role: r });
    }

    // Any member can decide on a request; there is no owner in a Parwah circle.
    if (action === 'approve_join' || action === 'decline_join') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      if (!isUuid(req.body.requestId)) return res.status(400).json({ ok: false, error: 'Bad request' });
      const rq = await sql`select * from join_requests where id = ${req.body.requestId} and circle_id = ${circle.id} and status = 'pending'`;
      if (!rq[0]) return res.status(404).json({ ok: false, error: 'That request has already been dealt with' });
      const q = rq[0];

      if (action === 'decline_join') {
        await sql`update join_requests set status = 'declined', decided_by = ${mRow[0].id}, decided_at = now() where id = ${q.id}`;
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${mRow[0].id}, 'care', ${mRow[0].name + ' said no to ' + q.name + "'s request to join"})`;
        return res.status(200).json({ ok: true });
      }

      const dupName2 = await sql`select id from members where circle_id = ${circle.id} and lower(name) = lower(${q.name})`;
      if (dupName2[0]) {
        await sql`update join_requests set status = 'declined', decided_by = ${mRow[0].id}, decided_at = now() where id = ${q.id}`;
        return res.status(409).json({ ok: false, error: 'Someone in this circle is already called ' + q.name });
      }
      const nm = await sql`insert into members (circle_id, name, role, phone, phone_cc, phone_local, user_id, relation)
                           values (${circle.id}, ${q.name}, ${q.role}, ${q.phone}, ${q.phone_cc}, ${q.phone_local}, ${q.user_id}, ${q.relation})
                           returning id`;
      await sql`update join_requests set status = 'approved', decided_by = ${mRow[0].id}, decided_at = now() where id = ${q.id}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${nm[0].id}, 'join', ${q.name + ' joined the circle — ' + mRow[0].name + ' let them in'})`;
      await award(sql, circle.id, mRow[0].id, 'welcomed', q.id);
      await pushCircle(sql, circle.id, { title: '🧡 ' + q.name + ' joined ' + circle.name, body: 'Say hello in the family chat' }, { except: nm[0].id });
      await pushCircle(sql, circle.id, { title: '🧡 You are in — ' + circle.name, body: mRow[0].name + ' let you in. Open Parwah to say hello.' }, { only: nm[0].id });
      return res.status(200).json({ ok: true, memberId: nm[0].id });
    }

    if (action === 'set_join_policy') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const policy = req.body.policy === 'open' ? 'open' : 'approve';
      await sql`update circles set join_policy = ${policy} where id = ${circle.id}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${mRow[0].id}, 'care', ${mRow[0].name + (policy === 'open'
                  ? ' let anyone with the code join straight away'
                  : ' made joining need a family member to say yes')})`;
      await pushCircle(sql, circle.id, {
        title: policy === 'open' ? '🔓 Anyone with the code can now join' : '🔒 Joining now needs approval',
        body: mRow[0].name + ' changed how people join ' + circle.name
      }, { except: mRow[0].id });
      return res.status(200).json({ ok: true, joinPolicy: policy });
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
      // the code is how people join — everyone needs to know it changed
      await pushCircle(sql, circle.id, { title: '🔑 Invite code is now ' + newCode, body: mRow[0].name + ' changed it — old invite links no longer work' }, { except: mRow[0].id });
      return res.status(200).json({ ok: true, code: newCode });
    }

    if (action === 'leave') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      await pushCircle(sql, circle.id, { title: '👋 ' + mRow[0].name + ' left ' + circle.name, body: 'They will no longer see this circle' }, { except: mRow[0].id });
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
      const mRow = await sql`select id, name, role, phone, place, country, relation, dob, user_id from members where id = ${memberId} and circle_id = ${circle.id}`;
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const cur = mRow[0];
      const newName = name || cur.name;
      if (newName.toLowerCase() !== cur.name.toLowerCase()) {
        const dup = await sql`select id from members where circle_id = ${circle.id} and lower(name) = lower(${newName}) and id <> ${cur.id}`;
        if (dup[0]) return res.status(409).json({ ok: false, error: 'Someone in this circle is already called ' + newName + ' — add a surname or initial' });
      }
      const newRole = (role === 'parent' || role === 'family') ? role : cur.role;
      const newPhone = ph !== null ? ph : cur.phone;
      const newRelation = relation || cur.relation;
      const newGift = giftInfo !== undefined ? (Object.keys(giftInfo).length ? giftInfo : null) : cur.gift_info;
      // Place of stay — free text; country as a 2-letter code drives regional gifting.
      const newPlace = req.body.place !== undefined ? (String(req.body.place || '').trim().slice(0, 80) || null) : cur.place;
      const newCountry = req.body.country !== undefined
        ? (/^[A-Z]{2}$/.test(String(req.body.country || '')) ? req.body.country : null)
        : cur.country;
      // Date of birth: a real calendar date or nothing. A half-parsed date
      // would give a confidently wrong rashi.
      let newDob = cur.dob;
      if (req.body.dob !== undefined) {
        const d = String(req.body.dob || '').trim();
        newDob = /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + 'T00:00:00Z')) ? d : null;
      }
      const npm = newPhone ? normPhone(newPhone) : null;
      await sql`update members set name = ${newName}, role = ${newRole}, phone = ${newPhone}, phone_cc = ${npm ? npm.cc : null}, phone_local = ${npm ? npm.local : null}, place = ${newPlace}, country = ${newCountry}, relation = ${newRelation}, dob = ${newDob}, gift_info = ${newGift ? JSON.stringify(newGift) : null}::jsonb where id = ${cur.id}`;
      // One person, one home, one number — keep their other family/group
      // memberships consistent. Place/country always follow the person;
      // the phone follows only rows still carrying the old value (a circle
      // can keep a deliberately different contact number).
      if (cur.user_id) {
        if (req.body.place !== undefined || req.body.country !== undefined) {
          await sql`update members set place = ${newPlace}, country = ${newCountry} where user_id = ${cur.user_id} and id <> ${cur.id}`;
        }
        if (req.body.dob !== undefined) {
          await sql`update members set dob = ${newDob} where user_id = ${cur.user_id} and id <> ${cur.id}`;
        }
        if (giftInfo !== undefined) {
          // one person, one set of sizes — every membership shows the same
          await sql`update members set gift_info = ${newGift ? JSON.stringify(newGift) : null}::jsonb where user_id = ${cur.user_id} and id <> ${cur.id}`;
        }
        if (ph !== null && ph !== cur.phone) {
          await sql`update members set phone = ${ph}, phone_cc = ${phCc}, phone_local = ${phLocal} where user_id = ${cur.user_id} and id <> ${cur.id} and (phone is null or phone = ${cur.phone})`;
        }
      }
      if (newName !== cur.name || newRole !== cur.role) {
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${cur.id}, 'care', ${cur.name + ' updated their profile' + (newName !== cur.name ? ' — now ' + newName : '')})`;
      }
      return res.status(200).json({ ok: true, name: newName, role: newRole, relation: newRelation, phone: newPhone, place: newPlace, country: newCountry, gift_info: newGift });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return serverError(res, e, 'circle');
  }
}
