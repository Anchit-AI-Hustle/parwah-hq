// POST /api/circle - create a care circle or join one with its code.
import { db, ensureSchema, makeCode, circleByCode, isUuid, normPhone, phoneError, rateLimit, clientIp, sessionUser } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { ownedMember } from './_owned.mjs';
import { pushCircle } from './_push.mjs';
import { award } from './_coins.mjs';
import { index as kinIndex, placement, PLACES, GENDERS, FAMILY_TYPES, genderFromRelation } from './_kin.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return failDb(res, e); }

  const { action, circleName, code, memberName, role, phone, userId } = req.body || {};
  // Family role labels - purely descriptive; every member is an equal admin.
  const RELATIONS = ['father', 'mother', 'grandfather', 'grandmother', 'son', 'daughter', 'brother', 'sister',
                     'daughter-in-law', 'son-in-law', 'grandson', 'granddaughter', 'friend', 'family'];
  const relation = RELATIONS.includes(req.body.relation) ? req.body.relation : null;
  // He or she, so the tree can say son or daughter. Asked when placing someone;
  // until then, read from the one-word role where it says.
  const gender = GENDERS.includes(req.body.gender) ? req.body.gender : genderFromRelation(relation);
  // Gifting details - sizes and tastes so anyone in the family can gift
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
  // Optional phone - country code kept separate, local number validated
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
    if (!allowed) return res.status(429).json({ ok: false, error: 'Too many join attempts from this device - please wait a few minutes and try again' });
  }

  const NAMELESS = ['join_status', 'update_member', 'leave', 'set_code', 'approve_join', 'decline_join', 'set_join_policy', 'place', 'unplace', 'add_person', 'remove_person'];
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
      // Joint or nuclear is a family's question; a group of friends is neither.
      const familyType = kind === 'family' && FAMILY_TYPES.includes(req.body.familyType) ? req.body.familyType : null;
      const cname = String(circleName || '').trim().slice(0, 60) || (name + (kind === 'group' ? "'s group" : "'s family"));
      let circle = null;
      for (let i = 0; i < 5 && !circle; i++) {
        const c = makeCode();
        try {
          const rows = await sql`insert into circles (code, name, kind, family_type) values (${c}, ${cname}, ${kind}, ${familyType}) returning id, code, name, kind, family_type`;
          circle = rows[0];
        } catch (e) { /* code collision - retry with a new code */ }
      }
      if (!circle) return res.status(500).json({ ok: false, error: 'Could not create the circle, please try again' });
      const m = await sql`insert into members (circle_id, name, role, phone, phone_cc, phone_local, user_id, relation, gender) values (${circle.id}, ${name}, ${r}, ${memberPhone}, ${memberCc}, ${memberLocal}, ${user ? user.id : null}, ${relation}, ${gender}) returning id`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${m[0].id}, 'join', ${name + ' created the ' + (familyType ? familyType + ' family' : kind)})`;
      // Ekta works from the first minute - a new family is not asked to earn
      // its way to a working assistant.
      await award(sql, circle.id, m[0].id, 'welcome', 'circle');
      return res.status(201).json({ ok: true, code: circle.code, circleName: circle.name, kind: circle.kind, familyType: circle.family_type, memberId: m[0].id, role: r });
    }

    if (action === 'join') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      if (user) {
        // Already a member of this circle? Sign back into that membership.
        const ex = await sql`select id, role from members where circle_id = ${circle.id} and user_id = ${user.id}`;
        if (ex[0]) return res.status(200).json({ ok: true, code: circle.code, circleName: circle.name, memberId: ex[0].id, role: ex[0].role });
        // A membership created before phone sign-in existed carries no user
        // link - claim it by matching phone digits instead of duplicating.
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
      if (dupName[0]) return res.status(409).json({ ok: false, error: 'Someone in this circle is already called ' + name + ' - add a surname or initial' });
      if (memberPhone) {
        const dupPhone = await sql`select id from members where circle_id = ${circle.id} and phone = ${memberPhone}`;
        if (dupPhone[0]) return res.status(409).json({ ok: false, error: 'This mobile number is already in the circle - sign in with it instead' });
      }

      // The code opens the door; the family decides who comes in. Anyone
      // already inside can say yes - no owner, no hierarchy.
      const pol = await sql`select join_policy from circles where id = ${circle.id}`;
      if (pol[0] && pol[0].join_policy === 'approve') {
        const already = user
          ? await sql`select id from join_requests where circle_id = ${circle.id} and user_id = ${user.id} and status = 'pending'`
          : await sql`select id from join_requests where circle_id = ${circle.id} and status = 'pending' and lower(name) = lower(${name})`;
        if (!already[0]) {
          await sql`insert into join_requests (circle_id, user_id, name, phone, phone_cc, phone_local, relation, role)
                    values (${circle.id}, ${user ? user.id : null}, ${name}, ${memberPhone}, ${memberCc}, ${memberLocal}, ${relation}, ${r})`;
          await sql`insert into events (circle_id, member_id, type, text)
                    values (${circle.id}, null, 'care', ${name + ' has asked to join - any member can let them in'})`;
          await pushCircle(sql, circle.id, {
            title: '🙋 ' + name + ' wants to join ' + circle.name,
            body: 'Open Parwah to let them in - or say no if you do not know them'
          }, {});
        }
        return res.status(202).json({ ok: true, pending: true, circleName: circle.name, code: circle.code,
          message: 'Your request has gone to ' + circle.name + '. Anyone in the family can let you in.' });
      }

      const m = await sql`insert into members (circle_id, name, role, phone, phone_cc, phone_local, user_id, relation, gender) values (${circle.id}, ${name}, ${r}, ${memberPhone}, ${memberCc}, ${memberLocal}, ${user ? user.id : null}, ${relation}, ${gender}) returning id`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${m[0].id}, 'join', ${name + ' joined the circle'})`;
      await pushCircle(sql, circle.id, { title: '🧡 ' + name + ' joined ' + circle.name, body: 'Say hello in the family chat' }, { except: m[0].id });
      return res.status(200).json({ ok: true, code: circle.code, circleName: circle.name, memberId: m[0].id, role: r });
    }

    // Any member can decide on a request; there is no owner in a Parwah circle.
    // "Check again" on the waiting screen: in, still waiting, or declined.
    // Only the signed-in person's own request, found by their session.
    if (action === 'join_status') {
      const su = await sessionUser(sql, tokenOf(req));
      if (!su) return res.status(401).json({ ok: false, signin: true, error: 'Please sign in again' });
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const m = await sql`select id from members where circle_id = ${circle.id} and user_id = ${su.user_id}`;
      if (m[0]) return res.status(200).json({ ok: true, status: 'in' });
      const q = await sql`select status from join_requests where circle_id = ${circle.id} and user_id = ${su.user_id}
                          order by created_at desc limit 1`;
      return res.status(200).json({ ok: true, status: q[0] ? q[0].status : 'none' });
    }

    if (action === 'approve_join' || action === 'decline_join') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
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
      const nm = await sql`insert into members (circle_id, name, role, phone, phone_cc, phone_local, user_id, relation, gender)
                           values (${circle.id}, ${q.name}, ${q.role}, ${q.phone}, ${q.phone_cc}, ${q.phone_local}, ${q.user_id}, ${q.relation}, ${genderFromRelation(q.relation)})
                           returning id`;
      await sql`update join_requests set status = 'approved', decided_by = ${mRow[0].id}, decided_at = now() where id = ${q.id}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${nm[0].id}, 'join', ${q.name + ' joined the circle - ' + mRow[0].name + ' let them in'})`;
      await award(sql, circle.id, mRow[0].id, 'welcomed', q.id);
      await pushCircle(sql, circle.id, { title: '🧡 ' + q.name + ' joined ' + circle.name, body: 'Say hello in the family chat' }, { except: nm[0].id });
      await pushCircle(sql, circle.id, { title: '🧡 You are in - ' + circle.name, body: mRow[0].name + ' let you in. Open Parwah to say hello.' }, { only: nm[0].id });
      return res.status(200).json({ ok: true, memberId: nm[0].id });
    }

    if (action === 'set_join_policy') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
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
      const mRow = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const newCode = String(req.body.newCode || '').toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z0-9]{4,12}$/.test(newCode)) {
        return res.status(400).json({ ok: false, error: 'Codes are 4-12 letters and numbers, e.g. SHARMAS' });
      }
      if (newCode === circle.code) return res.status(200).json({ ok: true, code: newCode });
      try {
        await sql`update circles set code = ${newCode} where id = ${circle.id}`;
      } catch (e) {
        return res.status(409).json({ ok: false, error: 'That code is already taken by another circle - try a different one' });
      }
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${mRow[0].id}, 'care', ${mRow[0].name + ' set the circle invite code to ' + newCode})`;
      // the code is how people join - everyone needs to know it changed
      await pushCircle(sql, circle.id, { title: '🔑 Invite code is now ' + newCode, body: mRow[0].name + ' changed it - old invite links no longer work' }, { except: mRow[0].id });
      return res.status(200).json({ ok: true, code: newCode });
    }

    if (action === 'leave') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      // LEAVING USED TO DESTROY RECORDS SILENTLY. vault_docs.about_member,
      // pay_methods.owner_member and family_book.about_member all cascade on
      // the member row, so one tap took the leaver's documents, files,
      // payment methods and memory entries with it - while the confirm box
      // said only that they would stop seeing chats, plans and reminders.
      //
      // Nothing is deleted until the person has been told exactly what goes.
      const counts = {};
      const countOf = async (label, run) => { try { const r = await run(); counts[label] = r[0] ? r[0].n : 0; } catch (e) { counts[label] = 0; } };
      await countOf('documents', () => sql`select count(*)::int as n from vault_docs where circle_id = ${circle.id} and about_member = ${mRow[0].id}`);
      await countOf('payment methods', () => sql`select count(*)::int as n from pay_methods where circle_id = ${circle.id} and owner_member = ${mRow[0].id}`);
      await countOf('family memory entries', () => sql`select count(*)::int as n from family_book where circle_id = ${circle.id} and about_member = ${mRow[0].id}`);
      const willGo = Object.keys(counts).filter(k => counts[k] > 0).map(k => counts[k] + ' ' + k);
      if (willGo.length && req.body.confirmDelete !== true) {
        return res.status(409).json({ ok: false, needsConfirm: true, counts,
          error: 'Leaving will also delete ' + willGo.join(', ') + ' recorded about you in this circle. That cannot be undone.' });
      }
      await pushCircle(sql, circle.id, { title: '👋 ' + mRow[0].name + ' left ' + circle.name, body: 'They will no longer see this circle' }, { except: mRow[0].id });
      // What the leaver merely WROTE about other people belongs to the
      // family and stays; only what is about the leaver goes with them.
      await sql`delete from members where id = ${mRow[0].id}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, null, 'care', ${mRow[0].name + ' left the circle 👋'})`;
      return res.status(200).json({ ok: true, deleted: counts });
    }

    // THE FAMILY TREE. Anyone in the family may place anyone - every member
    // is an equal admin - and the arithmetic in _kin.mjs refuses only what
    // cannot be true (two husbands, someone their own grandfather).
    if (['place', 'unplace', 'add_person', 'remove_person'].includes(action)) {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name`);
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const told = (text) => sql`insert into events (circle_id, member_id, type, text) values (${circle.id}, ${mRow[0].id}, 'care', ${text})`;
      // Dadi without a phone, a grandfather who has passed away, a child of
      // six: a family tree needs people who will never sign in. They are
      // added by name, belong to the family, and can be placed like anyone.
      let added = null;
      if (action === 'add_person') {
        const kindRow = await sql`select kind from circles where id = ${circle.id}`;
        if (kindRow[0] && kindRow[0].kind === 'group') return res.status(400).json({ ok: false, error: 'A group of friends has no family tree' });
        const pn = String(req.body.personName || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (!pn) return res.status(400).json({ ok: false, error: 'Write their name' });
        if (!GENDERS.includes(req.body.gender)) return res.status(400).json({ ok: false, error: 'Choose he or she, so Parwah can say son or daughter' });
        const dup = await sql`select id from members where circle_id = ${circle.id} and lower(name) = lower(${pn})`;
        if (dup[0]) return res.status(409).json({ ok: false, error: 'Someone in this family is already called ' + pn + ' - add a surname or initial' });
        const cnt = await sql`select count(*)::int as n from members where circle_id = ${circle.id}`;
        if (cnt[0].n >= 80) return res.status(409).json({ ok: false, error: 'This family already has 80 people' });
        // Not written yet: they are written together with their place and
        // the family's note, in one statement, or not at all.
        added = { id: globalThis.crypto.randomUUID(), name: pn, gender: req.body.gender };
        req.body.targetId = added.id;
      }
      const targetId = req.body.targetId || memberId;
      if (!isUuid(targetId)) return res.status(400).json({ ok: false, error: 'Choose someone in this family' });
      const all = await sql`select id, name, gender, parent_id, spouse_id, user_id from members where circle_id = ${circle.id}`;
      if (added) all.push({ id: added.id, name: added.name, gender: added.gender, parent_id: null, spouse_id: null, user_id: null });
      const target = all.find(x => x.id === targetId);
      if (!target) return res.status(404).json({ ok: false, error: 'Choose someone in this family' });
      // Undo one link at a time, so fixing a wrong wife never cuts off the
      // children: link 'spouse' clears the marriage on both sides, link
      // 'parent' clears whose child they are. With no link named, the
      // person leaves the tree; their children stay, under the other parent
      // when there is one.
      if (action === 'unplace') {
        const link = req.body.link;
        if (link === 'spouse') {
          if (!target.spouse_id) return res.status(409).json({ ok: false, error: target.name + ' has no husband or wife in the tree' });
          const sp = all.find(x => x.id === target.spouse_id);
          await sql`update members set spouse_id = null where circle_id = ${circle.id} and (id = ${targetId} or spouse_id = ${targetId})`;
          await told(mRow[0].name + ' removed the link between ' + target.name + ' and ' + (sp ? sp.name : 'their husband or wife') + ' in the family tree');
          return res.status(200).json({ ok: true });
        }
        if (link === 'parent') {
          if (!target.parent_id) return res.status(409).json({ ok: false, error: target.name + ' has no parent in the tree' });
          const pa = all.find(x => x.id === target.parent_id);
          await sql`update members set parent_id = null where id = ${targetId}`;
          await told(mRow[0].name + ' removed ' + target.name + ' as a child of ' + (pa ? pa.name : 'their parent') + ' in the family tree');
          return res.status(200).json({ ok: true });
        }
        if (link) return res.status(400).json({ ok: false, error: 'Choose which link to remove' });
        const other = target.spouse_id && all.find(x => x.id === target.spouse_id && x.spouse_id === targetId);
        await sql`update members set spouse_id = null where circle_id = ${circle.id} and spouse_id = ${targetId}`;
        await sql`update members set parent_id = ${other ? other.id : null} where circle_id = ${circle.id} and parent_id = ${targetId}`;
        await sql`update members set parent_id = null, spouse_id = null where id = ${targetId}`;
        await told(mRow[0].name + ' took ' + target.name + ' out of the family tree');
        return res.status(200).json({ ok: true });
      }
      // Someone added by name can be removed again - but only while nothing
      // is kept about them, so a slip never deletes a document or a record.
      if (action === 'remove_person') {
        if (target.user_id) return res.status(409).json({ ok: false, error: target.name + ' is on Parwah; only they can leave the family' });
        // A family that never opened the vault has no vault table yet; that,
        // and only that, counts as nothing kept. Any other error stops the
        // removal rather than risk deleting what this guard protects.
        // A table or column not created yet (To do never opened: 42P01 or
        // 42703) means nothing can be kept there.
        const keptIn = async (run) => { try { const r = await run(); return r[0] ? r[0].n : 0; } catch (e) { if (e && (e.code === '42P01' || e.code === '42703')) return 0; throw e; } };
        const kept = await keptIn(() => sql`select count(*)::int as n from vault_docs where circle_id = ${circle.id} and about_member = ${targetId}`)
                   + await keptIn(() => sql`select count(*)::int as n from family_book where circle_id = ${circle.id} and about_member = ${targetId}`)
                   + await keptIn(() => sql`select count(*)::int as n from requests where circle_id = ${circle.id} and about_member = ${targetId}`);
        if (kept > 0) return res.status(409).json({ ok: false, error: 'Documents, records or things to do are kept about ' + target.name + '. Remove those first, or keep them in the family.' });
        const other = target.spouse_id && all.find(x => x.id === target.spouse_id && x.spouse_id === targetId);
        if (other) await sql`update members set parent_id = ${other.id} where circle_id = ${circle.id} and parent_id = ${targetId}`;
        await sql`delete from members where id = ${targetId} and circle_id = ${circle.id} and user_id is null`;
        await told(mRow[0].name + ' removed ' + target.name + ' from the family');
        return res.status(200).json({ ok: true });
      }
      // A new person is added and placed in one step; if the place cannot
      // be true, they are not added either.
      const undo = (status, error) => res.status(status).json({ ok: false, error });
      const ofId = req.body.ofId;
      if (!isUuid(ofId)) return undo(400, 'Choose who they are related to');
      const of = all.find(x => x.id === ofId);
      if (!of) return undo(404, 'Choose someone in this family');
      const place = PLACES.includes(req.body.place) ? req.body.place : null;
      if (!place) return undo(400, 'Choose son or daughter, husband or wife, father or mother, or brother or sister');
      const by = kinIndex(all.map(x => ({ id: x.id, gender: x.gender, parentId: x.parent_id, spouseId: x.spouse_id })));
      const plan = placement(by, targetId, place, ofId);
      if (plan.error) return undo(409, plan.error);
      const word = { child: 'a child of', spouse: 'the husband or wife of', parent: 'a parent of', sibling: 'a brother or sister of' }[place];
      const note = mRow[0].name + ' added ' + target.name + ' to the family tree as ' + word + ' ' + of.name + (added ? ' (not on Parwah)' : '');
      // The links (at most the person and one other), the person themselves
      // when new, and the family's note: one statement, all or nothing.
      const t = plan.set.find(w => w.id === targetId) || {};
      const o = plan.set.find(w => w.id !== targetId) || null;
      const g = GENDERS.includes(req.body.gender) ? req.body.gender : null;
      // He or she for the other person too, when the family did not know.
      const ofG = !of.gender && GENDERS.includes(req.body.ofGender) ? req.body.ofGender : null;
      const oIsOf = !!o && o.id === ofId;
      const tP = 'parentId' in t, tS = 'spouseId' in t, oP = !!o && 'parentId' in o, oS = !!o && 'spouseId' in o;
      if (added) {
        await sql`
          with ins as (insert into members (id, circle_id, name, role, gender, parent_id, spouse_id)
                       values (${added.id}::uuid, ${circle.id}, ${added.name}, 'family', ${added.gender},
                               ${tP ? t.parentId : null}::uuid, ${tS ? t.spouseId : null}::uuid) returning id),
               up as (update members set parent_id = case when ${oP} then ${oP ? o.parentId : null}::uuid else parent_id end,
                                         spouse_id = case when ${oS} then ${oS ? o.spouseId : null}::uuid else spouse_id end,
                                         gender = case when ${oIsOf} then coalesce(gender, ${ofG}) else gender end
                      where id = ${o ? o.id : null}::uuid and circle_id = ${circle.id} returning id),
               og as (update members set gender = coalesce(gender, ${ofG})
                      where id = ${ofId} and circle_id = ${circle.id} and ${!oIsOf} and ${!!ofG} returning id)
          insert into events (circle_id, member_id, type, text)
          select ${circle.id}, ${mRow[0].id}, 'care', ${note} from ins`;
      } else {
        await sql`
          with a as (update members set parent_id = case when ${tP} then ${tP ? t.parentId : null}::uuid else parent_id end,
                                        spouse_id = case when ${tS} then ${tS ? t.spouseId : null}::uuid else spouse_id end,
                                        gender = coalesce(${g}, gender)
                     where id = ${targetId} and circle_id = ${circle.id} returning id),
               b as (update members set parent_id = case when ${oP} then ${oP ? o.parentId : null}::uuid else parent_id end,
                                        spouse_id = case when ${oS} then ${oS ? o.spouseId : null}::uuid else spouse_id end,
                                        gender = case when ${oIsOf} then coalesce(gender, ${ofG}) else gender end
                     where id = ${o ? o.id : null}::uuid and circle_id = ${circle.id} returning id),
               og as (update members set gender = coalesce(gender, ${ofG})
                      where id = ${ofId} and circle_id = ${circle.id} and ${!oIsOf} and ${!!ofG} returning id)
          insert into events (circle_id, member_id, type, text)
          select ${circle.id}, ${mRow[0].id}, 'care', ${note} from a`;
      }
      return res.status(200).json({ ok: true, memberId: targetId });
    }

    if (action === 'update_member') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const memberId = req.body.memberId;
      if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const mRow = await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name, role, phone, place, country, relation, dob, user_id`);
      if (!mRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
      const cur = mRow[0];
      const newName = name || cur.name;
      if (newName.toLowerCase() !== cur.name.toLowerCase()) {
        const dup = await sql`select id from members where circle_id = ${circle.id} and lower(name) = lower(${newName}) and id <> ${cur.id}`;
        if (dup[0]) return res.status(409).json({ ok: false, error: 'Someone in this circle is already called ' + newName + ' - add a surname or initial' });
      }
      const newRole = (role === 'parent' || role === 'family') ? role : cur.role;
      const newPhone = ph !== null ? ph : cur.phone;
      const newRelation = relation || cur.relation;
      const newGift = giftInfo !== undefined ? (Object.keys(giftInfo).length ? giftInfo : null) : cur.gift_info;
      // Place of stay - free text; country as a 2-letter code drives regional gifting.
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
      // One person, one home, one number - keep their other family/group
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
          // one person, one set of sizes - every membership shows the same
          await sql`update members set gift_info = ${newGift ? JSON.stringify(newGift) : null}::jsonb where user_id = ${cur.user_id} and id <> ${cur.id}`;
        }
        if (ph !== null && ph !== cur.phone) {
          await sql`update members set phone = ${ph}, phone_cc = ${phCc}, phone_local = ${phLocal} where user_id = ${cur.user_id} and id <> ${cur.id} and (phone is null or phone = ${cur.phone})`;
        }
      }
      if (newName !== cur.name || newRole !== cur.role) {
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${cur.id}, 'care', ${cur.name + ' updated their profile' + (newName !== cur.name ? ' - now ' + newName : '')})`;
      }
      return res.status(200).json({ ok: true, name: newName, role: newRole, relation: newRelation, phone: newPhone, place: newPlace, country: newCountry, gift_info: newGift });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}
