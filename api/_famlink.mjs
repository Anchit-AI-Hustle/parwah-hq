// LINKED FAMILIES: two families that are related (maika and sasural, two
// brothers' homes) agree to see each other's family tree and Rishtedaar
// list. Behind /api/circle, by actions that start link_.
//
//   POST {code, memberId, action:'link_state'}
//   POST {..., action:'link_request', otherCode, bridgeId, bridgeName?, sharePhones?}
//   POST {..., action:'link_approve', linkId, bridgeId?, sharePhones?}
//   POST {..., action:'link_decline', linkId}
//   POST {..., action:'link_end',     linkId}
//   POST {..., action:'link_phones',  linkId, on}
//
// One family asks, with the other family's code, and names the person who
// belongs to both (the bridge). An adult of the other family says yes or no.
// Either side ends it at any time, at once.
//
// WHAT CROSSES A LINK, and nothing else. For each person of the other family:
// their name, he or she, the two tree links (parent and husband or wife),
// the YEAR of birth (never the date), and their city. A phone number crosses
// only when that person's own family already sees it AND their side ticked
// "share phone numbers". No chat, vault, register, health, location, notes,
// family facts or days of remembrance ever cross: this file reads none of
// those tables, and a member of one family is refused by every other route
// of the other (requireMember), linked or not.
//
// Relations across the link are worked out by joining the two trees at the
// bridge, in memory (kinLinked in api/_kin.mjs). Nothing is copied.
import { schemaOnce, isUuid, circleByCode, rateLimit, clientIp } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { placeOf } from './_places.mjs';
import { cleanName, nameError } from './_valid.mjs';
import { index as kinIndex, generations, kinLinked } from './_kin.mjs';
import { wallIn, isAdult } from './_rememberrules.mjs';

export const LINKS_MAX = 6;

let ready = false;
export async function ensureFamlinkSchema(sql) {
  if (ready) return;
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  await schemaOnce(() => famlinkTables(sql));
  ready = true;
}
async function famlinkTables(sql) {
  // a_ is the family that asked, b_ the family that was asked. The bridge is
  // one person: a_member in the first family, b_member in the second.
  await sql`create table if not exists family_links (
    id uuid primary key default gen_random_uuid(),
    a_circle uuid not null references circles(id) on delete cascade,
    b_circle uuid not null references circles(id) on delete cascade,
    a_member uuid not null references members(id) on delete cascade,
    b_member uuid references members(id) on delete cascade,
    b_name text,
    status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'ended')),
    a_phones boolean not null default false,
    b_phones boolean not null default false,
    asked_by uuid references members(id) on delete set null,
    decided_by uuid references members(id) on delete set null,
    ended_by uuid references members(id) on delete set null,
    created_at timestamptz not null default now(),
    decided_at timestamptz,
    ended_at timestamptz,
    check (a_circle <> b_circle)
  )`;
  // Two families have one link between them, whoever asked.
  await sql`create unique index if not exists family_links_pair on family_links (least(a_circle, b_circle), greatest(a_circle, b_circle))
            where status in ('pending', 'active')`;
  await sql`create index if not exists family_links_a on family_links (a_circle, status)`;
  await sql`create index if not exists family_links_b on family_links (b_circle, status)`;
}

const bad = (error, status = 400, extra) => ({ status, json: { ok: false, error, ...(extra || {}) } });
const good = (json, status = 200) => ({ status, json: { ok: true, ...(json || {}) } });
const feed = (sql, circleId, memberId, text) => sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
const activeCount = async (sql, circleId) =>
  (await sql`select count(*)::int as n from family_links where status = 'active' and (a_circle = ${circleId} or b_circle = ${circleId})`)[0].n;
const FULL = 'has ' + LINKS_MAX + ' linked families already. End one to add another.';

// THE ONLY READ OF ANOTHER FAMILY. The columns are named here and nowhere
// else: name, he or she, the two tree links, the date of birth (cut to its
// year before it leaves this function), the city, and the phone only when
// that side said yes to sharing numbers.
async function peopleOf(sql, circleId, withPhones) {
  const rows = await sql`select id, name, gender, parent_id, spouse_id, to_char(dob, 'YYYY') as born, place,
                                case when ${!!withPhones}::boolean then phone else null end as phone
                         from members where circle_id = ${circleId} order by created_at, id`;
  return rows.map(r => ({ id: r.id, name: r.name, gender: r.gender || null, parent_id: r.parent_id || null, spouse_id: r.spouse_id || null,
                          born: r.born ? +r.born : null, city: (r.place && String(r.place).trim()) || null, phone: r.phone || null }));
}

async function linkState(sql, circle, me) {
  const rows = await sql`
    select l.id, l.a_circle, l.b_circle, l.a_member, l.b_member, l.b_name, l.status, l.a_phones, l.b_phones, l.created_at, l.decided_at,
           ca.name as a_name, cb.name as b_name_circle, am.name as a_member_name, bm.name as b_member_name, ab.name as asked_by_name
    from family_links l
    join circles ca on ca.id = l.a_circle join circles cb on cb.id = l.b_circle
    join members am on am.id = l.a_member left join members bm on bm.id = l.b_member left join members ab on ab.id = l.asked_by
    where (l.a_circle = ${circle.id} or l.b_circle = ${circle.id}) and l.status in ('pending', 'active')
    order by l.created_at, l.id`;
  const links = [], incoming = [], outgoing = [];
  let own = null;
  for (const l of rows) {
    const iAmA = l.a_circle === circle.id;
    if (l.status === 'pending') {
      if (iAmA) outgoing.push({ id: l.id, toName: l.b_name_circle, bridgeName: l.a_member_name, created_at: l.created_at });
      else incoming.push({ id: l.id, fromName: l.a_name, askedBy: l.asked_by_name || null, bridgeName: l.a_member_name,
                           theirName: l.b_name || l.a_member_name, guess: l.b_member || null, theyShare: !!l.a_phones, created_at: l.created_at });
      continue;
    }
    const otherCircle = iAmA ? l.b_circle : l.a_circle;
    const mine = iAmA ? l.a_member : l.b_member, theirs = iAmA ? l.b_member : l.a_member;
    const theyShare = iAmA ? l.b_phones : l.a_phones, weShare = iAmA ? l.a_phones : l.b_phones;
    if (!own) own = await sql`select id, name, gender, parent_id, spouse_id, to_char(dob, 'YYYY') as born from members where circle_id = ${circle.id}`;
    const people = await peopleOf(sql, otherCircle, theyShare);
    const shape = p => ({ id: p.id, gender: p.gender, parentId: p.parent_id, spouseId: p.spouse_id, dob: p.born ? p.born + '-01-01' : null });
    const ownShape = own.map(p => shape({ ...p, born: p.born ? +p.born : null }));
    const kin = kinLinked(ownShape, people.map(shape), { own: mine, other: theirs }, me.id,
                          new Map(own.map(p => [p.id, p.name])), new Map(people.map(p => [p.id, p.name])));
    const gens = generations(kinIndex(people.map(shape)));
    links.push({
      id: l.id, name: iAmA ? l.b_name_circle : l.a_name, since: l.decided_at, bridge: { mine, theirs },
      bridgeName: iAmA ? l.a_member_name : l.b_member_name, weShare: !!weShare, theyShare: !!theyShare,
      people: people.map(p => {
        const k = kin.get(p.id) || null;
        return { id: p.id, name: p.name, gender: p.gender, parent_id: p.parent_id, spouse_id: p.spouse_id, born: p.born, city: p.city, phone: p.phone,
                 gen: (p.parent_id || p.spouse_id || people.some(x => x.parent_id === p.id)) ? gens.get(p.id) : null,
                 same: k ? k.same : null, kin: k ? k.label : null,
                 rz: k ? { hindi: k.hindi, english: k.english, side: k.side, group: k.group, chain: k.words } : null };
      })
    });
  }
  return good({ max: LINKS_MAX, links, incoming, outgoing });
}

// me: the caller's own membership (ownedMember proved it). circle: {id, name, kind, code}.
export async function famlinkAction(sql, req, circle, me, body) {
  await ensureFamlinkSchema(sql);
  const a = String(body.action || '');
  if (circle.kind === 'group') return bad('A group of friends has no family tree to link.');
  const adult = () => isAdult(me.dob, wallIn(Date.now(), placeOf(me.place, me.country, null).tz).date);

  if (a === 'link_state') return linkState(sql, circle, me);

  if (a === 'link_request') {
    // A family code is short enough to guess if you may keep trying. You may not.
    if (!(await rateLimit(sql, 'link', clientIp(req), 12, 600))) return bad('Too many tries on this device. Please wait a few minutes and try again.', 429);
    const other = await circleByCode(sql, body.otherCode);
    if (!other) return bad('No family found with that code', 404, { field: 'code' });
    if (other.id === circle.id) return bad('That is the code of this family. Write the code of the other family.', 400, { field: 'code' });
    if (other.kind === 'group') return bad('That code is for a group of friends. It has no family tree to link.', 400, { field: 'code' });
    if (!isUuid(body.bridgeId)) return bad('Choose the person who belongs to both families.', 400, { field: 'bridge' });
    const bridge = (await sql`select id, name, user_id from members where id = ${body.bridgeId} and circle_id = ${circle.id}`)[0];
    if (!bridge) return bad('Choose the person who belongs to both families.', 400, { field: 'bridge' });
    const theirName = cleanName(body.bridgeName).slice(0, 60);
    if (theirName && nameError(theirName)) return bad(nameError(theirName), 400, { field: 'name' });
    const dup = await sql`select status from family_links where status in ('pending', 'active')
                          and least(a_circle, b_circle) = least(${circle.id}::uuid, ${other.id}::uuid)
                          and greatest(a_circle, b_circle) = greatest(${circle.id}::uuid, ${other.id}::uuid)`;
    if (dup[0]) return bad(dup[0].status === 'active' ? 'Your two families are already linked.' : 'A request between your two families is already waiting.', 409);
    if (await activeCount(sql, circle.id) >= LINKS_MAX) return bad('Your family ' + FULL, 409);
    const waiting = await sql`select count(*)::int as n from family_links where a_circle = ${circle.id} and status = 'pending'`;
    if (waiting[0].n >= LINKS_MAX) return bad('Your family has ' + LINKS_MAX + ' requests waiting already. Wait for an answer, or take one back.', 409);
    // Who the bridge is in the other family, when it can be told: the same
    // sign-in, or the same name. Otherwise whoever says yes picks them.
    let theirs = null;
    if (bridge.user_id) theirs = (await sql`select id from members where circle_id = ${other.id} and user_id = ${bridge.user_id}`)[0] || null;
    if (!theirs) theirs = (await sql`select id from members where circle_id = ${other.id} and lower(name) = lower(${theirName || bridge.name})`)[0] || null;
    let made;
    try {
      made = await sql`insert into family_links (a_circle, b_circle, a_member, b_member, b_name, a_phones, asked_by)
                       values (${circle.id}, ${other.id}, ${bridge.id}, ${theirs ? theirs.id : null}, ${theirName || null}, ${!!body.sharePhones}, ${me.id})
                       returning id`;
    } catch (e) {
      if (e && e.code === '23505') return bad('A request between your two families is already waiting.', 409);
      throw e;
    }
    await feed(sql, other.id, null, circle.name + ' has asked to link family trees with yours. Any adult here can say yes or no.');
    await feed(sql, circle.id, me.id, me.name + ' asked ' + other.name + ' to link family trees');
    await pushCircle(sql, other.id, { title: '🌳 ' + circle.name + ' asks to link family trees',
      body: 'Open the Family tab to say yes or no. Only the tree and the Rishtedaar list are shared.', url: '/#people' }, {});
    return good({ pending: true, linkId: made[0].id, otherName: other.name,
                  message: 'Your request has gone to ' + other.name + '. An adult there can say yes.' }, 202);
  }

  if (!isUuid(body.linkId)) return bad('That link is not here any more', 404);
  const l = (await sql`select l.*, ca.name as a_name, cb.name as b_name_circle from family_links l
                       join circles ca on ca.id = l.a_circle join circles cb on cb.id = l.b_circle
                       where l.id = ${body.linkId} and (l.a_circle = ${circle.id} or l.b_circle = ${circle.id})`)[0];
  if (!l) return bad('That link is not here any more', 404);
  const iAmA = l.a_circle === circle.id;
  const otherId = iAmA ? l.b_circle : l.a_circle, otherName = iAmA ? l.b_name_circle : l.a_name;

  if (a === 'link_approve' || a === 'link_decline') {
    // Only the family that was asked answers, and an adult of it.
    if (iAmA || l.status !== 'pending') return bad('That request has already been dealt with', 404);
    if (!adult()) return bad('An adult in the family answers this.', 403);
    if (a === 'link_decline') {
      const got = await sql`update family_links set status = 'declined', decided_by = ${me.id}, decided_at = now()
                            where id = ${l.id} and status = 'pending' returning id`;
      if (!got[0]) return bad('That request has already been dealt with', 404);
      await feed(sql, circle.id, me.id, me.name + ' said no to linking family trees with ' + otherName);
      await feed(sql, otherId, null, circle.name + ' did not link family trees this time');
      return good({});
    }
    const pick = body.bridgeId || l.b_member;
    if (!isUuid(pick)) return bad('Choose who this person is in your family.', 400, { field: 'bridge', needsBridge: true });
    const b = (await sql`select id from members where id = ${pick} and circle_id = ${circle.id}`)[0];
    if (!b) return bad('Choose who this person is in your family.', 400, { field: 'bridge', needsBridge: true });
    if (await activeCount(sql, circle.id) >= LINKS_MAX) return bad('Your family ' + FULL, 409);
    if (await activeCount(sql, otherId) >= LINKS_MAX) return bad(otherName + ' ' + FULL, 409);
    const got = await sql`update family_links set status = 'active', b_member = ${b.id}, b_phones = ${!!body.sharePhones}, decided_by = ${me.id}, decided_at = now()
                          where id = ${l.id} and status = 'pending' returning id`;
    if (!got[0]) return bad('That request has already been dealt with', 404);
    await feed(sql, circle.id, me.id, me.name + ' linked family trees with ' + otherName + ' 🌳');
    await feed(sql, otherId, null, circle.name + ' said yes: your family trees are linked 🌳');
    // The answer goes to the person who asked; the rest of that family reads it in the feed.
    if (l.asked_by) await pushCircle(sql, otherId, { title: '🌳 ' + circle.name + ' said yes',
      body: 'You can now see each other\'s family tree and Rishtedaar list. Nothing else is shared.', url: '/#people' }, { only: l.asked_by });
    return good({ linkId: l.id });
  }

  // Either side, any member, at once. A request still waiting is taken back
  // the same way by the family that sent it.
  if (a === 'link_end') {
    if (l.status === 'pending' && !iAmA) return bad('Say yes or no to a request; only the family that asked can take it back.', 400);
    const was = l.status;
    const got = await sql`update family_links set status = 'ended', ended_by = ${me.id}, ended_at = now()
                          where id = ${l.id} and status in ('pending', 'active') returning id`;
    if (!got[0]) return good({ already: true });
    if (was === 'active') {
      await feed(sql, circle.id, me.id, me.name + ' ended the family tree link with ' + otherName);
      await feed(sql, otherId, null, 'The family tree link with ' + circle.name + ' has ended');
    }
    return good({});
  }

  // Each side decides about its own numbers, and can change its mind.
  if (a === 'link_phones') {
    if (l.status !== 'active') return bad('That link is not here any more', 404);
    if (!adult()) return bad('An adult in the family decides this.', 403);
    const on = !!body.on;
    if (iAmA) await sql`update family_links set a_phones = ${on} where id = ${l.id} and status = 'active'`;
    else await sql`update family_links set b_phones = ${on} where id = ${l.id} and status = 'active'`;
    return good({ weShare: on });
  }
  return bad('Unknown action');
}
