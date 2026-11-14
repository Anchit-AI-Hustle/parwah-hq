// EQUAL STANDING IN A FAMILY, behind /api/circle (no function of its own).
//
// Every member is heard equally. A few things the grown-ups decide, and the
// biggest of them two grown-ups decide together:
//
//   POST {code, memberId, action:'standing_state'}
//   POST {..., action:'adult_confirm', targetId, adult}      "Is Aarav an adult?"
//   POST {..., action:'remove_ask', targetId}                 one adult asks...
//   POST {..., action:'ask_vote', askId, yes}                 ...another answers
//   POST {..., action:'ask_cancel', askId}
//   POST {..., action:'family_delete_ask'} / {action:'family_delete_undo'}
//   POST {..., action:'tree_undo', editId}                    undo a change to my place
//   POST {..., action:'privacy_set', seePhone, seeBirth}            who sees my phone, my birth year
//   POST {..., action:'claim_review', choices}                what my family wrote about me
//
// The adult rule is ONE function, isAdultMember in _standingrules.mjs.
import { isUuid, rateLimit } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { ensureStandingSchema, standingRows, forgetMember, logEvent, finalizeAccount } from './_account.mjs';
import { isAdultMember, standingOf, isMinor, minorByBirth, ageOn, actingAdults, todayIn, removalRule, openJoinRule, deleteFamilyRule,
         codeIsWeak, cardFor, seeChoice, defaultSee, writtenAbout, CLAIM_CHOICES, HIDEABLE, UNDO_DAYS } from './_standingrules.mjs';

const bad = (error, status = 400, extra) => ({ status, json: { ok: false, error, ...(extra || {}) } });
const good = (json, status = 200) => ({ status, json: { ok: true, ...(json || {}) } });
const feed = (sql, circleId, memberId, text) => sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
const word = c => (c && c.kind === 'group' ? 'group' : 'family');

export const STANDING_ACTIONS = ['standing_state', 'adult_confirm', 'child_mark', 'remove_ask', 'ask_vote', 'ask_cancel',
  'family_delete_ask', 'family_delete_undo', 'tree_undo', 'privacy_set', 'claim_review'];

// Who is calling, as the adult rule sees them, with the whole family.
// → { rows, me, today, may } ; may is false for a child or a teen.
export async function standingOfCaller(sql, circle, memberId, nowMs) {
  await ensureStandingSchema(sql);
  const rows = await standingRows(sql, circle.id);
  const me = rows.find(r => r.id === memberId) || null;
  const today = todayIn(nowMs);
  return { rows, me, today, may: isAdultMember(me, today) };
}
export const ADULT_ONLY = 'A grown-up in the family decides this. Ask an adult to do it.';

async function pushAdults(sql, circle, rows, today, payload, exceptId) {
  for (const a of actingAdults(rows, today)) {
    if (a.id === exceptId) continue;
    await pushCircle(sql, circle.id, payload, { only: a.id });
  }
}

// ---- things decided together ------------------------------------------------
async function pendingAsk(sql, circleId, kind, targetId) {
  const r = await sql`select * from standing_asks where circle_id = ${circleId} and kind = ${kind} and status = 'pending' and expires_at > now()
                        and target_member is not distinct from ${targetId || null}::uuid order by created_at desc limit 1`;
  return r[0] || null;
}
async function vote(sql, askId, memberId, yes) {
  await sql`insert into standing_votes (ask_id, member_id, yes) values (${askId}, ${memberId}, ${yes})
            on conflict (ask_id, member_id) do update set yes = excluded.yes, at = now()`;
}

// One person is put out of the family. They are told first; what was
// recorded about them, and their own private things, go with them.
async function removeNow(sql, circle, target, askerName, confirmerName) {
  const by = confirmerName ? askerName + ' and ' + confirmerName + ' decided this together.' : askerName + ' decided this.';
  await pushCircle(sql, circle.id, { kind: 'other', title: 'You are no longer in ' + circle.name, body: by + ' Your other families are not changed.', url: '/' }, { only: target.id });
  if (target.user_id) await logEvent(sql, target.user_id, 'removed', 'You were removed from ' + circle.name + '. ' + by);
  await forgetMember(sql, target.id);
  await feed(sql, circle.id, null, target.name + ' is no longer in the ' + word(circle) + '. ' + by);
}

// Has enough been said? Applies the decision the moment it has.
async function settle(sql, circle, ask, rows, today) {
  const votes = await sql`select member_id, yes from standing_votes where ask_id = ${ask.id}`;
  const adults = actingAdults(rows, today);
  const isAdult = id => adults.some(a => a.id === id);
  const nameOf = id => (rows.find(r => r.id === id) || {}).name || 'An adult';
  const close = async status => (await sql`update standing_asks set status = ${status}, decided_at = now() where id = ${ask.id} and status = 'pending' returning id`)[0];
  const no = votes.find(v => !v.yes && isAdult(v.member_id));
  if (no) {
    if (await close('declined')) {
      const what = ask.kind === 'dob_change' ? 'the new date of birth for ' + nameOf(ask.target_member) : ask.kind === 'remove_member' ? 'removing ' + nameOf(ask.target_member) : ask.kind === 'child_mark' ? 'marking ' + nameOf(ask.target_member) + ' as under 18' : ask.kind === 'open_join' ? 'letting the code be enough' : 'deleting this ' + word(circle);
      await feed(sql, circle.id, no.member_id, nameOf(no.member_id) + ' said no to ' + what);
      if (ask.asked_by) await pushCircle(sql, circle.id, { kind: 'other', title: nameOf(no.member_id) + ' said no', body: 'Nothing has changed.', url: '/#people' }, { only: ask.asked_by });
    }
    return { status: 'declined' };
  }
  const yes = votes.filter(v => v.yes && isAdult(v.member_id)).map(v => v.member_id);
  if (ask.kind === 'open_join') {
    const second = yes.find(id => id !== ask.asked_by);
    if (!second) return { status: 'pending' };
    if (!(await close('done'))) return { status: 'done' };
    await sql`update circles set join_policy = 'open' where id = ${circle.id}`;
    await feed(sql, circle.id, second, nameOf(ask.asked_by) + ' and ' + nameOf(second) + ' let anyone with the code join straight away');
    await pushCircle(sql, circle.id, { kind: 'other', title: '🔓 Anyone with the code can now join', body: nameOf(ask.asked_by) + ' and ' + nameOf(second) + ' changed how people join ' + circle.name }, {});
    return { status: 'done', joinPolicy: 'open' };
  }
  if (ask.kind === 'remove_member') {
    const target = rows.find(r => r.id === ask.target_member);
    const second = yes.find(id => id !== ask.asked_by && id !== ask.target_member);
    if (!second || !target) return { status: 'pending' };
    if (!(await close('done'))) return { status: 'done' };
    await removeNow(sql, circle, target, nameOf(ask.asked_by), nameOf(second));
    return { status: 'done', removed: target.id };
  }
  if (ask.kind === 'child_mark') {
    // The person's own yes, or a second adult's: never the asker alone.
    const target = rows.find(r => r.id === ask.target_member);
    const second = yes.find(id => id !== ask.asked_by);
    if (!second || !target) return { status: 'pending' };
    if (!(await close('done'))) return { status: 'done' };
    await applyChildMark(sql, circle, target, ask.asked_by, nameOf(ask.asked_by), second === target.id ? null : nameOf(second));
    return { status: 'done', child: true };
  }
  if (ask.kind === 'dob_change') {
    // A child cannot make themself an adult: one adult, not them, says yes.
    const target = rows.find(r => r.id === ask.target_member);
    const second = yes.find(id => id !== ask.target_member);
    if (!second || !target) return { status: 'pending' };
    if (!(await close('done'))) return { status: 'done' };
    const dob = ask.detail && ask.detail.dob ? String(ask.detail.dob).slice(0, 10) : null;
    await sql`update members set dob = ${dob}, is_child = false, child_by = null,
                adult_confirmed = case when adult_confirmed is false then null else adult_confirmed end
              where id = ${target.id} and circle_id = ${circle.id}`;
    if (target.user_id) {
      await sql`update members set dob = ${dob} where user_id = ${target.user_id} and id <> ${target.id}`;
      await logEvent(sql, target.user_id, 'standing', nameOf(second) + ' agreed to the change to your date of birth in ' + circle.name + '.');
    }
    await pushCircle(sql, circle.id, { title: nameOf(second) + ' said yes to your date of birth', body: 'It is saved in your profile now.', url: '/#people', kind: 'other' }, { only: target.id });
    return { status: 'done' };
  }
  if (ask.kind === 'delete_family') {
    if (!adults.length || !adults.every(a => yes.includes(a.id))) return { status: 'pending' };
    if (!(await close('done'))) return { status: 'done' };
    const at = new Date(Date.now() + UNDO_DAYS * 86400000).toISOString();
    await sql`update circles set delete_at = ${at} where id = ${circle.id}`;
    await feed(sql, circle.id, null, 'Every adult said yes: this ' + word(circle) + ' will be deleted from Parwah in ' + UNDO_DAYS + ' days. Any adult can stop it before then.');
    await pushCircle(sql, circle.id, { kind: 'other', title: circle.name + ' will be deleted in ' + UNDO_DAYS + ' days', body: 'Every adult said yes. Any adult can stop it in the Family tab before then.', url: '/#people' }, {});
    return { status: 'done', deleteAt: at };
  }
  return { status: 'pending' };
}

// "UNDER 18" SAID ABOUT SOMEONE. It takes away their say in who joins, who
// is removed and who is let back in, so about a person who is on Parwah and
// has no date of birth it is never one person's word: the person themself
// says yes, or a second adult does. About a name in the tree (nobody signs
// in as them) it is one adult's to say. A date of birth always decides.
async function applyChildMark(sql, circle, target, byId, byName, secondName) {
  await sql`update members set is_child = true, child_by = ${byId}, adult_confirmed = false, adult_confirmed_by = ${byId}
            where id = ${target.id} and circle_id = ${circle.id} and dob is null`;
  await feed(sql, circle.id, byId, byName + (secondName ? ' and ' + secondName : '') + ' marked ' + target.name + ' as a child in the family (under 18)');
  if (target.user_id) await logEvent(sql, target.user_id, 'standing', byName + ' told Parwah you are under 18 in ' + circle.name + '. Your date of birth in your profile decides it if you add it.');
}
export async function childMark(sql, circle, meId, targetId) {
  const s = await standingOfCaller(sql, circle, meId);
  if (!s.may) return bad('An adult in the family does this.', 403);
  const t = s.rows.find(r => r.id === targetId);
  if (!t) return bad('Choose someone in this family', 404);
  if (t.id === s.me.id) return bad('This is for someone else in the family.');
  if (t.remembered) return bad(t.name + ' is remembered here.');
  const age = ageOn(t.dob, s.today);
  if (age !== null) {
    return age >= 18 ? bad(t.name + ' is 18 or over by their date of birth, so cannot be marked as a child.', 409) : good({ child: true, already: true });
  }
  if (t.is_child && t.adult_confirmed === false) return good({ child: true, already: true });
  if (!t.user_id) {
    await applyChildMark(sql, circle, t, s.me.id, s.me.name, null);
    return good({ child: true });
  }
  let ask = await pendingAsk(sql, circle.id, 'child_mark', t.id);
  if (ask && ask.asked_by !== s.me.id) {
    await vote(sql, ask.id, s.me.id, true);
    const out = await settle(sql, circle, ask, s.rows, s.today);
    return good({ ...out, child: out.status === 'done' });
  }
  if (!ask) {
    if (!(await rateLimit(sql, 'standing_ask', circle.id + ':' + s.me.id, 6, 86400, { failClosed: true }))) return bad('That has been asked a lot today. Please try again tomorrow.', 429);
    ask = (await sql`insert into standing_asks (circle_id, kind, target_member, asked_by) values (${circle.id}, 'child_mark', ${t.id}, ${s.me.id}) returning *`)[0];
    await vote(sql, ask.id, s.me.id, true);
    await pushCircle(sql, circle.id, { title: s.me.name + ' says you are under 18', body: 'Is that right? Open the Family tab to say yes or no. Your date of birth in your profile decides it if you add it.', url: '/#people', kind: 'other' }, { only: t.id });
    for (const o of actingAdults(s.rows, s.today)) {
      if (o.id === s.me.id || o.id === t.id) continue;
      await pushCircle(sql, circle.id, { title: s.me.name + ' says ' + t.name + ' is under 18', body: 'Is that right? Open the Family tab to say yes or no.', url: '/#people', kind: 'other' }, { only: o.id });
    }
  }
  return good({ pending: true, child: false, askId: ask.id, message: t.name + ' or another adult has to agree first. They have been told.' }, 202);
}

// A DATE OF BIRTH THAT WOULD MAKE A CHILD AN ADULT. A child or a teenager
// changing (or removing) their own date of birth so that Parwah no longer
// sees a child would hand themself every door the adults hold. That change
// waits for one adult's yes. Any other change is the member's own to make.
// → null (save it now) or { pending, message } (the old date stays).
export async function dobChangeGate(sql, circle, memberId, newDob) {
  const s = await standingOfCaller(sql, circle, memberId);
  if (!s.me || !isMinor(s.me, s.today)) return null;
  if (isMinor({ ...s.me, dob: newDob || null, is_child: false, adult_confirmed: null }, s.today)) return null;
  const adults = actingAdults(s.rows, s.today).filter(a => a.id !== s.me.id);
  if (!adults.length) {
    return { pending: false, message: 'Your date of birth was not changed. An adult in the ' + word(circle) + ' has to agree to that, and none is on Parwah here yet.' };
  }
  const detail = JSON.stringify({ dob: newDob || null });
  const had = await pendingAsk(sql, circle.id, 'dob_change', s.me.id);
  if (had) {
    await sql`update standing_asks set detail = ${detail}::jsonb where id = ${had.id} and status = 'pending'`;
    await sql`delete from standing_votes where ask_id = ${had.id}`;
  } else {
    if (!(await rateLimit(sql, 'standing_ask', circle.id + ':' + s.me.id, 6, 86400, { failClosed: true }))) {
      return { pending: false, message: 'Your date of birth was not changed. That has been asked a lot today. Please try again tomorrow.' };
    }
    await sql`insert into standing_asks (circle_id, kind, target_member, asked_by, detail) values (${circle.id}, 'dob_change', ${s.me.id}, ${s.me.id}, ${detail}::jsonb)`;
    for (const o of adults) {
      await pushCircle(sql, circle.id, { title: s.me.name + ' wants to change their date of birth', body: 'It would make them an adult in ' + circle.name + '. Open the Family tab to say yes or no.', url: '/#people', kind: 'other' }, { only: o.id });
    }
  }
  return { pending: true, message: 'Your date of birth will change when an adult in the ' + word(circle) + ' says yes. They have been told.' };
}

// HOW PEOPLE JOIN. Asking for a yes each time is always one adult's to
// set. Letting the code be enough needs a second adult when there is one.
export async function joinPolicyChange(sql, circle, memberId, policy) {
  const s = await standingOfCaller(sql, circle, memberId);
  if (!s.may) return bad(ADULT_ONLY, 403);
  if (policy !== 'open') {
    await sql`update circles set join_policy = 'approve' where id = ${circle.id}`;
    await sql`update standing_asks set status = 'cancelled', decided_at = now() where circle_id = ${circle.id} and kind = 'open_join' and status = 'pending'`;
    await feed(sql, circle.id, s.me.id, s.me.name + ' made joining need a family member to say yes');
    await pushCircle(sql, circle.id, { kind: 'other', title: '🔒 Joining now needs approval', body: s.me.name + ' changed how people join ' + circle.name }, { except: s.me.id });
    return good({ joinPolicy: 'approve' });
  }
  const rule = openJoinRule({ me: s.me, members: s.rows, today: s.today });
  if (rule.error) return bad(rule.error, rule.status);
  if (!rule.needs) {
    await sql`update circles set join_policy = 'open' where id = ${circle.id}`;
    await feed(sql, circle.id, s.me.id, s.me.name + ' let anyone with the code join straight away');
    return good({ joinPolicy: 'open' });
  }
  let ask = await pendingAsk(sql, circle.id, 'open_join', null);
  if (!ask) {
    if (!(await rateLimit(sql, 'standing_ask', circle.id + ':' + s.me.id, 6, 86400, { failClosed: true }))) return bad('That has been asked a lot today. Please try again tomorrow.', 429);
    ask = (await sql`insert into standing_asks (circle_id, kind, asked_by) values (${circle.id}, 'open_join', ${s.me.id}) returning *`)[0];
    await vote(sql, ask.id, s.me.id, true);
    await pushAdults(sql, circle, s.rows, s.today, { kind: 'other', title: s.me.name + ' wants the code to be enough to join', body: 'Anyone with the code would join ' + circle.name + ' with no questions asked. Open the Family tab to say yes or no.', url: '/#people' }, s.me.id);
    return good({ joinPolicy: 'approve', pending: true, askId: ask.id, message: 'Another adult in the family has to say yes first. They have been told.' }, 202);
  }
  // A second adult pressing the same button is the second yes.
  await vote(sql, ask.id, s.me.id, true);
  const out = await settle(sql, circle, ask, s.rows, s.today);
  return out.status === 'done' ? good({ joinPolicy: 'open' })
    : good({ joinPolicy: 'approve', pending: true, askId: ask.id, message: 'Another adult in the family has to say yes first. They have been told.' }, 202);
}

// A CHANGE TO SOMEONE'S PLACE IN THE TREE. `before` is the family as it was
// read before the change. Anyone on Parwah whose parent or husband or wife
// changed, other than whoever did it, is told and can undo it in one tap.
export async function recordTreeEdit(sql, circle, me, before, note) {
  try {
    await ensureStandingSchema(sql);
    const after = await sql`select id, parent_id, spouse_id, user_id from members where circle_id = ${circle.id}`;
    const was = new Map((before || []).map(r => [r.id, r]));
    const changes = [];
    for (const a of after) {
      const b = was.get(a.id);
      if (!b) continue;
      if ((b.parent_id || null) !== (a.parent_id || null) || (b.spouse_id || null) !== (a.spouse_id || null)) {
        changes.push({ id: a.id, before: { parent_id: b.parent_id || null, spouse_id: b.spouse_id || null },
                       after: { parent_id: a.parent_id || null, spouse_id: a.spouse_id || null }, user_id: a.user_id || null });
      }
    }
    const people = changes.filter(c => c.user_id && c.id !== me.id);
    if (!people.length) return null;
    const made = await sql`insert into tree_edits (circle_id, by_member, people, changes, note)
                           values (${circle.id}, ${me.id}, ${people.map(p => p.id)}::uuid[], ${JSON.stringify(changes.map(({ user_id, ...c }) => c))}::jsonb, ${String(note || '').slice(0, 300)})
                           returning id`;
    for (const p of people) {
      await logEvent(sql, p.user_id, 'tree', me.name + ' changed your place in the family tree of ' + circle.name + '.');
      await pushCircle(sql, circle.id, { kind: 'other', title: '🌳 ' + me.name + ' changed your place in the family tree', body: 'Not right? Open Parwah and undo it in one tap.', url: '/#people' }, { only: p.id });
    }
    return made[0].id;
  } catch (e) { return null; /* telling someone never breaks the edit */ }
}

// WHAT ONE VIEWER IS SENT ABOUT EACH MEMBER (one call from api/events.mjs).
// Each member's own choices, read here; the rule itself is cardFor.
export async function memberCards(sql, circle, me, members) {
  try {
    await ensureStandingSchema(sql);
    const prefs = await sql`select m.id, m.see_phone, m.see_birth, m.hidden_fields, m.user_id, m.dob, m.role, m.relation, m.adult_confirmed, m.is_child, m.spouse_id, m.remembered,
                                   exists (select 1 from members c where c.parent_id = m.id) as has_child
                            from members m where m.circle_id = ${circle.id}`;
    const by = new Map(prefs.map(p => [p.id, p]));
    const viewer = { id: me.id, adult: isAdultMember(by.get(me.id), todayIn()) };
    return (members || []).map(m => {
      const p = by.get(m.id) || {};
      return cardFor({ ...m, see_phone: p.see_phone, see_birth: p.see_birth, hidden_fields: p.hidden_fields }, viewer, circle.kind);
    });
  } catch (e) {
    // If the choices cannot be read, nobody's phone or birthday is sent.
    return (members || []).map(m => (m.id === me.id ? m : { ...m, phone: null, dob: null }));
  }
}

// THE TIMER'S SHARE (one line in runTick): what was decided with a waiting
// time, once the time is up. Each step claims its row, so it happens once.
export async function standingSweepAll(sql) {
  await ensureStandingSchema(sql);
  let n = 0;
  const due = await sql`select id from circles where delete_at is not null and delete_at <= now() limit 20`;
  for (const c of due) {
    const gone = await sql`delete from circles where id = ${c.id} and delete_at is not null and delete_at <= now() returning id`;
    if (gone[0]) n++;
  }
  const users = await sql`select id from users where delete_at is not null and delete_at <= now() limit 20`;
  for (const u of users) { try { if (await finalizeAccount(sql, u.id)) n++; } catch (e) { /* the next run tries again */ } }
  await sql`update standing_asks set status = 'expired', decided_at = now() where status = 'pending' and expires_at <= now()`;
  try { const { activateDueLinks } = await import('./_famlink.mjs'); n += await activateDueLinks(sql); } catch (e) { /* no linked families yet */ }
  try { await sql`delete from pin_locks where updated_at < now() - interval '30 days'`; } catch (e) {}
  return n;
}

async function stateOf(sql, circle, s) {
  const asksRaw = await sql`select a.*, (select json_agg(json_build_object('member_id', v.member_id, 'yes', v.yes)) from standing_votes v where v.ask_id = a.id) as votes
                            from standing_asks a where a.circle_id = ${circle.id} and a.status = 'pending' and a.expires_at > now() order by a.created_at`;
  const nameOf = id => (s.rows.find(r => r.id === id) || {}).name || null;
  const adults = actingAdults(s.rows, s.today);
  const asks = asksRaw
    // A person is not shown the request to remove them; they are told if it happens.
    .filter(a => s.may && !(a.kind === 'remove_member' && a.target_member === s.me.id))
    .map(a => {
      const votes = a.votes || [];
      const mine = votes.find(v => v.member_id === s.me.id);
      return { id: a.id, kind: a.kind, askedBy: a.asked_by, askedByName: nameOf(a.asked_by), targetId: a.target_member, targetName: nameOf(a.target_member),
               aboutMe: a.target_member === s.me.id, newDob: a.kind === 'dob_change' && a.detail ? a.detail.dob || null : undefined, mine: a.asked_by === s.me.id, voted: mine ? (mine.yes ? 'yes' : 'no') : null,
               yes: votes.filter(v => v.yes).map(v => nameOf(v.member_id)).filter(Boolean),
               waitingFor: a.kind === 'delete_family' ? adults.filter(x => !votes.some(v => v.member_id === x.id && v.yes)).map(x => x.name) : [],
               at: a.created_at, expiresAt: a.expires_at };
    });
  const c = (await sql`select delete_at, join_policy, code from circles where id = ${circle.id}`)[0] || {};
  const edits = await sql`select e.id, e.note, e.created_at, m.name as by_name from tree_edits e left join members m on m.id = e.by_member
                          where e.circle_id = ${circle.id} and e.undone_at is null and e.created_at > now() - interval '7 days'
                            and ${s.me.id}::uuid = any(e.people) and e.by_member is distinct from ${s.me.id}
                          order by e.created_at desc limit 5`;
  const mine = (await sql`select see_phone, see_birth, hidden_fields, claim_review, name, relation, dob, phone, place, gift_info from members where id = ${s.me.id}`)[0] || {};
  // For the grown-ups who answer the door: which waiting request says
  // "this is me", and the profiles the family made by name.
  const joins = s.may ? await sql`select id, claim_member, wants_claim from join_requests where circle_id = ${circle.id} and status = 'pending' and user_id is not null` : [];
  return {
    joins: joins.map(j => ({ id: j.id, claimMember: j.claim_member, wantsClaim: !!j.wants_claim })),
    byName: s.may ? s.rows.filter(r => !r.user_id && !r.remembered).map(r => ({ id: r.id, name: r.name })) : [],
    me: { standing: standingOf(s.me, s.today), may: s.may },
    adults: adults.length,
    // Asked of the grown-ups, once per person: "Is Aarav an adult?"
    unsure: s.may ? s.rows.filter(r => r.id !== s.me.id && r.user_id && !r.remembered && standingOf(r, s.today) === 'unsure'
      && !asksRaw.some(a => a.kind === 'child_mark' && a.target_member === r.id)).map(r => ({ id: r.id, name: r.name })) : [],
    codeWeak: s.may && codeIsWeak(c.code),
    asks, deleteAt: c.delete_at || null,
    treeEdits: edits.map(e => ({ id: e.id, by: e.by_name || 'Someone in the family', note: e.note, at: e.created_at })),
    privacy: { phone: seeChoice(mine.see_phone) || defaultSee(circle.kind), birth: seeChoice(mine.see_birth) || defaultSee(circle.kind) },
    claimReview: mine.claim_review ? writtenAbout({ ...mine, phone: null }) : null
  };
}

// me: the caller's own membership (ownedMember proved it). circle: {id, name, kind, code}.
export async function standingAction(sql, circle, me, body) {
  const s = await standingOfCaller(sql, circle, me.id);
  if (!s.me) return bad('Not a member of this family', 403);
  const a = String(body.action || '');

  if (a === 'standing_state') return good(await stateOf(sql, circle, s));

  if (a === 'privacy_set') {
    const phone = seeChoice(body.seePhone), birth = seeChoice(body.seeBirth);
    if (!phone && !birth) return bad('Choose who can see it: the family, only adults, or only you.');
    await sql`update members set see_phone = coalesce(${phone}, see_phone), see_birth = coalesce(${birth}, see_birth) where id = ${s.me.id}`;
    if (s.me.user_id) await logEvent(sql, s.me.user_id, 'privacy', 'You changed who can see your phone or your birth year in ' + circle.name + '.');
    return good({ privacy: (await stateOf(sql, circle, s)).privacy });
  }

  // "What your family wrote about you": keep, hide or delete, item by item.
  if (a === 'claim_review') {
    const ch = body.choices && typeof body.choices === 'object' ? body.choices : {};
    const row = (await sql`select relation, dob, place, country, gift_info, hidden_fields, claim_review from members where id = ${s.me.id}`)[0];
    if (!row) return bad('Not a member of this family', 403);
    const hidden = new Set(Array.isArray(row.hidden_fields) ? row.hidden_fields : []);
    let { relation, dob, place, country } = row;
    let gift = row.gift_info ? { ...row.gift_info } : null;
    for (const key of Object.keys(ch)) {
      if (!HIDEABLE.includes(key) || key === 'phone' || !CLAIM_CHOICES.includes(ch[key])) continue;
      if (ch[key] === 'hide') hidden.add(key);
      if (ch[key] === 'keep') hidden.delete(key);
      if (ch[key] !== 'delete') continue;
      hidden.delete(key);
      if (key === 'relation') relation = null;
      // A child by date of birth cannot delete the date and stop being one:
      // it is hidden from the others instead.
      if (key === 'dob') { if (minorByBirth({ dob }, s.today)) hidden.add('dob'); else dob = null; }
      if (key === 'place') { place = null; country = null; }
      if (key === 'sizes' && gift) ['clothes', 'shoe', 'ring'].forEach(k => { delete gift[k]; });
      if (key === 'likes' && gift) ['color', 'likes', 'wishlist'].forEach(k => { delete gift[k]; });
    }
    if (gift && !Object.keys(gift).length) gift = null;
    await sql`update members set relation = ${relation}, dob = ${dob}, place = ${place}, country = ${country},
                gift_info = ${gift ? JSON.stringify(gift) : null}::jsonb, hidden_fields = ${JSON.stringify([...hidden])}::jsonb, claim_review = false
              where id = ${s.me.id}`;
    return good({});
  }

  // One tap: put my place in the tree back as it was.
  if (a === 'tree_undo') {
    if (!isUuid(body.editId)) return bad('That change is not here any more', 404);
    const e = (await sql`select * from tree_edits where id = ${body.editId} and circle_id = ${circle.id} and undone_at is null
                           and created_at > now() - interval '7 days' and ${s.me.id}::uuid = any(people)`)[0];
    if (!e) return bad('That change is not here any more', 404);
    const changes = Array.isArray(e.changes) ? e.changes : [];
    const cur = await sql`select id, parent_id, spouse_id from members where circle_id = ${circle.id}`;
    const now = new Map(cur.map(r => [r.id, r]));
    const same = changes.every(c => { const r = now.get(c.id); return r && (r.parent_id || null) === c.after.parent_id && (r.spouse_id || null) === c.after.spouse_id; });
    if (!same) return bad('The tree has changed again since then. Please set it right in the Family tab.', 409);
    const claimed = await sql`update tree_edits set undone_at = now() where id = ${e.id} and undone_at is null returning id`;
    if (!claimed[0]) return good({ already: true });
    for (const c of changes) {
      await sql`update members set parent_id = ${c.before.parent_id}::uuid, spouse_id = ${c.before.spouse_id}::uuid where id = ${c.id} and circle_id = ${circle.id}`;
    }
    await feed(sql, circle.id, s.me.id, s.me.name + ' put their place in the family tree back as it was');
    if (e.by_member) await pushCircle(sql, circle.id, { kind: 'other', title: '🌳 ' + s.me.name + ' undid a change to the family tree', body: 'Their place is back as it was. Talk to them before changing it again.', url: '/#people' }, { only: e.by_member });
    return good({});
  }

  // Everything below is for the grown-ups of the family.
  if (!s.may) return bad(ADULT_ONLY, 403);

  // "Is Aarav an adult?" Asked once, of an adult, about someone whose age
  // nobody has written down. The answer is kept.
  if (a === 'adult_confirm') {
    const t = s.rows.find(r => r.id === body.targetId);
    if (!t || t.id === s.me.id || !t.user_id) return bad('Choose someone in this family', 404);
    if (standingOf(t, s.today) !== 'unsure') return good({ already: true });
    // "No, under 18" takes their say away: their own yes, or a second adult's.
    if (body.adult !== true) return childMark(sql, circle, s.me.id, t.id);
    await sql`update members set adult_confirmed = true, adult_confirmed_by = ${s.me.id} where id = ${t.id} and adult_confirmed is null`;
    await logEvent(sql, t.user_id, 'standing', s.me.name + ' told Parwah you are an adult in ' + circle.name + '. Your date of birth in your profile decides it if you add it.');
    return good({});
  }

  if (a === 'child_mark') return childMark(sql, circle, s.me.id, body.targetId);

  if (a === 'remove_ask') {
    const target = s.rows.find(r => r.id === body.targetId) || null;
    const rule = removalRule({ me: s.me, target, members: s.rows, today: s.today });
    if (rule.error) return bad(rule.error, rule.status);
    if (!rule.needs) {
      // The only adult, and the person is a child: one person's decision.
      await removeNow(sql, circle, target, s.me.name, null);
      return good({ removed: target.id });
    }
    let ask = await pendingAsk(sql, circle.id, 'remove_member', target.id);
    if (ask && ask.asked_by !== s.me.id) {
      // A second adult asking for the same thing is the second yes.
      await vote(sql, ask.id, s.me.id, true);
      const out = await settle(sql, circle, ask, s.rows, s.today);
      return good(out);
    }
    if (!ask) {
      if (!(await rateLimit(sql, 'standing_ask', circle.id + ':' + s.me.id, 6, 86400, { failClosed: true }))) return bad('That has been asked a lot today. Please try again tomorrow.', 429);
      ask = (await sql`insert into standing_asks (circle_id, kind, target_member, asked_by) values (${circle.id}, 'remove_member', ${target.id}, ${s.me.id}) returning *`)[0];
      await vote(sql, ask.id, s.me.id, true);
      for (const o of rule.others) {
        await pushCircle(sql, circle.id, { kind: 'other', title: s.me.name + ' asks to remove ' + target.name + ' from ' + circle.name, body: 'Two adults decide this together. Open the Family tab to say yes or no.', url: '/#people' }, { only: o.id });
      }
    }
    return good({ pending: true, askId: ask.id, message: 'Another adult has to agree. They have been told.' }, 202);
  }

  if (a === 'family_delete_ask') {
    const rule = deleteFamilyRule({ me: s.me, members: s.rows, today: s.today });
    if (rule.error) return bad(rule.error, rule.status);
    let ask = await pendingAsk(sql, circle.id, 'delete_family', null);
    if (!ask) {
      if (!(await rateLimit(sql, 'standing_ask', circle.id + ':' + s.me.id, 6, 86400, { failClosed: true }))) return bad('That has been asked a lot today. Please try again tomorrow.', 429);
      ask = (await sql`insert into standing_asks (circle_id, kind, asked_by) values (${circle.id}, 'delete_family', ${s.me.id}) returning *`)[0];
      await feed(sql, circle.id, s.me.id, s.me.name + ' asked to delete this ' + word(circle) + ' from Parwah. Every adult has to say yes.');
      await pushCircle(sql, circle.id, { kind: 'other', title: s.me.name + ' asked to delete ' + circle.name, body: 'Every adult has to say yes. Open the Family tab to answer.', url: '/#people' }, { except: s.me.id });
    }
    await vote(sql, ask.id, s.me.id, true);
    const out = await settle(sql, circle, ask, s.rows, s.today);
    return good({ ...out, askId: ask.id }, out.status === 'pending' ? 202 : 200);
  }
  if (a === 'family_delete_undo') {
    const done = await sql`update circles set delete_at = null where id = ${circle.id} and delete_at is not null returning id`;
    if (done[0]) {
      await feed(sql, circle.id, s.me.id, s.me.name + ' stopped the delete. This ' + word(circle) + ' stays.');
      await pushCircle(sql, circle.id, { kind: 'other', title: circle.name + ' stays', body: s.me.name + ' stopped the delete.', url: '/#people' }, { except: s.me.id });
    }
    return good({ deleteAt: null });
  }

  if (a === 'ask_vote' || a === 'ask_cancel') {
    if (!isUuid(body.askId)) return bad('That request is not here any more', 404);
    const ask = (await sql`select * from standing_asks where id = ${body.askId} and circle_id = ${circle.id} and status = 'pending' and expires_at > now()`)[0];
    if (!ask) return bad('That request has already been dealt with', 404);
    if (a === 'ask_cancel') {
      if (ask.asked_by !== s.me.id) return bad('Only the person who asked can take it back. You can say no.', 403);
      await sql`update standing_asks set status = 'cancelled', decided_at = now() where id = ${ask.id} and status = 'pending'`;
      return good({ status: 'cancelled' });
    }
    if ((ask.kind === 'remove_member' || ask.kind === 'dob_change') && ask.target_member === s.me.id) return bad('This one is not yours to answer.', 403);
    await vote(sql, ask.id, s.me.id, body.yes === true);
    return good(await settle(sql, circle, ask, s.rows, s.today));
  }
  return bad('Unknown action');
}
