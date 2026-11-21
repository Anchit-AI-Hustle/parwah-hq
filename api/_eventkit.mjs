// THE FUNCTION KIT ("Shaadi / function kit"), built on a plan. Behind
// /api/plans?area=eventkit (no new function: the project is at its cap).
//
//   GET  /api/plans?area=eventkit&circle=CODE&member=ID&plan=PLAN_ID
//        -> { plan, kit: null | { hosts, canEdit, isMaker, sides, guests, counts, sheet, tasks, arrivals, budget }, people }
//   POST /api/plans {action: 'kit_start', planId}                        the plan's maker
//        kit_hosts_set   {planId, hosts: [MEMBER_ID]}                    the plan's maker
//        kit_sides_set   {planId, sides: [text]}                         a host
//        kit_guest_add   {planId, memberIds?: [ID], name?, side?, people?, status?, note?}
//        kit_guest_update {id, side?, people?, status?, note?, name?}    kit_guest_remove {id}
//        kit_task_add    {planId, title, ownerId?, dueDate?}             an ordinary task, listed here
//        kit_arrival_add {planId, who? | travellerId?, arriveAt, mode?, from?, receiverId?}
//        kit_arrival_receive {id}     "I will receive them"              any adult of the family
//        kit_arrival_remove {id}
//        kit_budget_set  {planId, amount}
//
// The rules, on the server:
//   - the plan's maker and the hosts they name change the kit; everyone in
//     the family reads it (a plan is seen by the whole family already);
//   - a guest is a name. No phone number is asked for or kept;
//   - someone who has passed away is never a guest: a member marked so is
//     refused and left out of every read, and a typed name that is theirs
//     (in this family or a linked one) is refused;
//   - the budget and what was spent are shown to the adults who are on the
//     plan's costs, by the cost split's own rule. A child reads no money;
//   - an arrival shows "Reached safely" only to someone that trip already
//     tells: the join is in the SQL.
import { isUuid, schemaOnce, rateLimit } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { ensureAudienceSchema, minorOf } from './_audience.mjs';
import { createTask, ensureTaskSchema } from './_tasks.mjs';
import { splitState, splitMoney } from './_split.mjs';
import { noteRisk } from './_notesapi.mjs';
import { KIT_STATUSES, KIT_STATUS_WORDS, KIT_SIDES_DEFAULT, KIT_MAX, KIT_MODE_WORDS,
         kitIsHost, kitIsMaker, kitSides, kitGuestClean, kitCounts, kitSheet, kitArrivalClean, kitBudgetClean } from './_eventkitrules.mjs';

const no = (status, error) => ({ status, json: { ok: false, error } });
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const maybe = async (f) => { try { return await f(); } catch (e) { if (e && e.code === '42P01') return []; throw e; } };

let ready = false;
export async function ensureEventkitSchema(sql) {
  if (ready) return;
  await ensureAudienceSchema(sql);
  await ensureTaskSchema(sql);
  await schemaOnce(async () => {
    await sql`create table if not exists plan_kits (
      plan_id uuid primary key references plans(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      hosts uuid[] not null default '{}',
      sides text[] not null default '{}',
      budget_paise bigint,
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now()
    )`;
    await sql`create table if not exists kit_guests (
      id uuid primary key default gen_random_uuid(),
      plan_id uuid not null references plans(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid references members(id) on delete cascade,
      name text,
      side text,
      status text not null default 'to_invite' check (status in ('to_invite', 'invited', 'coming', 'not_coming')),
      people int not null default 1,
      note text,
      added_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      check (member_id is not null or name is not null)
    )`;
    await sql`create unique index if not exists kit_guests_member on kit_guests (plan_id, member_id) where member_id is not null`;
    await sql`create index if not exists kit_guests_plan on kit_guests (plan_id)`;
    await sql`create table if not exists kit_tasks (
      plan_id uuid not null references plans(id) on delete cascade,
      task_id uuid not null references requests(id) on delete cascade,
      primary key (plan_id, task_id)
    )`;
    await sql`create table if not exists kit_arrivals (
      id uuid primary key default gen_random_uuid(),
      plan_id uuid not null references plans(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid references members(id) on delete cascade,
      who text,
      arrive_at timestamptz not null,
      mode text not null default 'other',
      from_place text,
      receiver_id uuid references members(id) on delete set null,
      added_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      check (member_id is not null or who is not null)
    )`;
  });
  ready = true;
}

async function planOf(sql, circle, planId) {
  if (!isUuid(planId)) return null;
  return (await sql`select p.id, p.title, p.kind, p.at, p.place, p.by_member, b.name as by_name
                    from plans p left join members b on b.id = p.by_member where p.id = ${planId} and p.circle_id = ${circle.id}`)[0] || null;
}
const kitOf = async (sql, planId) => (await sql`select * from plan_kits where plan_id = ${planId}`)[0] || null;

// The names of people who have passed away, in this family and in the
// families linked to it: a typed guest of that name is refused.
async function goneNames(sql, circleId) {
  const own = await sql`select lower(name) as n from members where circle_id = ${circleId} and remembered`;
  const linked = await maybe(() => sql`
    select lower(m.name) as n from family_links l
    join members m on m.circle_id = (case when l.a_circle = ${circleId} then l.b_circle else l.a_circle end) and m.remembered
    where l.status = 'active' and (l.a_circle = ${circleId} or l.b_circle = ${circleId})`);
  return new Set([...own, ...linked].map(r => r.n));
}

export async function kitState(sql, circle, me, planId) {
  await ensureEventkitSchema(sql);
  const plan = await planOf(sql, circle, planId);
  if (!plan) return no(404, 'Plan not found');
  const kit = await kitOf(sql, plan.id);
  const meMinor = await minorOf(sql, circle.id, me.id);
  const out = { ok: true, plan: { id: plan.id, title: plan.title, kind: plan.kind, at: plan.at, place: plan.place, byMember: plan.by_member, byName: plan.by_name },
    kit: null, canStart: kitIsMaker(plan, me.id), statuses: KIT_STATUSES.map(s => [s, KIT_STATUS_WORDS[s]]) };
  if (!kit) return { status: 200, json: out };
  const gone = await goneNames(sql, circle.id);
  // A guest who is a member reads their name from the family, and is left
  // out the moment they are marked as no longer with us.
  const guests = (await sql`
    select g.id, g.member_id, coalesce(m.name, g.name) as name, g.side, g.status, g.people, g.note
    from kit_guests g left join members m on m.id = g.member_id
    where g.plan_id = ${plan.id} and g.circle_id = ${circle.id} and (g.member_id is null or (m.id is not null and not m.remembered))
    order by g.created_at`).filter(g => g.member_id || !gone.has(String(g.name || '').toLowerCase()));
  const hosts = kit.hosts.length ? await sql`select id, name from members where circle_id = ${circle.id} and id = any(${kit.hosts}::uuid[]) and not remembered order by created_at` : [];
  const tasks = await sql`
    select q.id, q.title, q.status, q.due_date::text as due_date, q.due_at, c.name as owner_name
    from kit_tasks k join requests q on q.id = k.task_id and q.circle_id = ${circle.id} and q.archived_at is null
    left join members c on c.id = q.claimed_by
    where k.plan_id = ${plan.id} order by q.due_at nulls last, q.created_at`;
  // "Reached safely" is joined only for someone that trip already tells.
  let arrivals;
  try {
    arrivals = await sql`
    select a.id, a.member_id, coalesce(m.name, a.who) as who, a.arrive_at, a.mode, a.from_place, a.receiver_id, r.name as receiver_name,
           t.status as trip_status, t.expect_at as trip_expect, t.reached_at as trip_reached
    from kit_arrivals a
    left join members m on m.id = a.member_id
    left join members r on r.id = a.receiver_id and not r.remembered
    left join lateral (select t.status, t.expect_at, t.reached_at from trips t
                       where t.circle_id = a.circle_id and t.member_id = a.member_id and t.started_at between a.arrive_at - interval '2 days' and a.arrive_at + interval '1 day'
                         and (t.member_id = ${me.id} or ${me.id}::uuid = any(t.tell))
                       order by t.started_at desc limit 1) t on true
    where a.plan_id = ${plan.id} and a.circle_id = ${circle.id} and (a.member_id is null or (m.id is not null and not m.remembered))
    order by a.arrive_at`;
  } catch (e) {
    // A family that has never used "Reached safely" has no trips table: the arrivals are listed without it.
    if (!e || e.code !== '42P01') throw e;
    arrivals = await sql`
    select a.id, a.member_id, coalesce(m.name, a.who) as who, a.arrive_at, a.mode, a.from_place, a.receiver_id, r.name as receiver_name,
           null::text as trip_status, null::timestamptz as trip_expect, null::timestamptz as trip_reached
    from kit_arrivals a
    left join members m on m.id = a.member_id
    left join members r on r.id = a.receiver_id and not r.remembered
    where a.plan_id = ${plan.id} and a.circle_id = ${circle.id} and (a.member_id is null or (m.id is not null and not m.remembered))
    order by a.arrive_at`;
  }
  const canEdit = kitIsHost(plan, kit, me.id);
  const sides = kit.sides.length ? kit.sides : KIT_SIDES_DEFAULT;
  // The money: by the cost split's own rule (the people on the plan), and never to a child.
  let budget = null;
  if (!meMinor) {
    const sp = await splitState(sql, circle, me, plan.id);
    if (sp.status === 200) {
      const cur = sp.json.currency, spent = sp.json.total || 0;
      budget = { planned: kit.budget_paise == null ? null : splitMoney(Number(kit.budget_paise), cur), spent: splitMoney(spent, cur),
        left: kit.budget_paise == null ? null : splitMoney(Math.abs(Number(kit.budget_paise) - spent), cur), over: kit.budget_paise != null && spent > Number(kit.budget_paise) };
    } else budget = { hidden: true };
  }
  out.kit = { hosts: hosts.map(h => ({ id: h.id, name: h.name })), canEdit, isMaker: kitIsMaker(plan, me.id), sides,
    guests: guests.map(g => ({ id: g.id, memberId: g.member_id, name: g.name, side: g.side, status: g.status, statusWords: KIT_STATUS_WORDS[g.status], people: g.people, note: g.note })),
    counts: kitCounts(guests), sheet: kitSheet(guests, sides),
    tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, dueDate: t.due_date, ownerName: t.owner_name || null })),
    arrivals: arrivals.map(a => ({ id: a.id, memberId: a.member_id, who: a.who, arriveAt: a.arrive_at, mode: a.mode, modeWords: KIT_MODE_WORDS[a.mode] || '', from: a.from_place,
      receiverId: a.receiver_id && a.receiver_name ? a.receiver_id : null, receiverName: a.receiver_name || null, mine: a.member_id === me.id,
      trip: a.trip_status ? { status: a.trip_status, expectAt: a.trip_expect, reachedAt: a.trip_reached } : null })),
    budget };
  if (canEdit) {
    // Who can be picked: everyone in the tree who is with us (on Parwah or by name).
    out.people = (await sql`select id, name, (user_id is not null) as on_app from members where circle_id = ${circle.id} and not remembered order by created_at`)
      .map(p => ({ id: p.id, name: p.name, onApp: p.on_app }));
  }
  return { status: 200, json: out };
}

export async function kitAction(sql, circle, me, b) {
  await ensureEventkitSchema(sql);
  const act = String(b.action || '');
  // An entry is found by its own id; everything else names the plan.
  let row = null, planId = b.planId;
  if (act === 'kit_guest_update' || act === 'kit_guest_remove') {
    if (!isUuid(b.id)) return no(404, 'That guest is not on the list any more.');
    row = (await sql`select * from kit_guests where id = ${b.id} and circle_id = ${circle.id}`)[0];
    if (!row) return no(404, 'That guest is not on the list any more.');
    planId = row.plan_id;
  }
  if (act === 'kit_arrival_receive' || act === 'kit_arrival_remove') {
    if (!isUuid(b.id)) return no(404, 'That arrival is not here any more.');
    row = (await sql`select * from kit_arrivals where id = ${b.id} and circle_id = ${circle.id}`)[0];
    if (!row) return no(404, 'That arrival is not here any more.');
    planId = row.plan_id;
  }
  const plan = await planOf(sql, circle, planId);
  if (!plan) return no(404, 'Plan not found');
  let kit = await kitOf(sql, plan.id);
  const done = async (status = 200) => { const s = await kitState(sql, circle, me, plan.id); return { status: s.status === 200 ? status : s.status, json: s.json }; };

  if (act === 'kit_start') {
    if (!kitIsMaker(plan, me.id)) return no(403, 'Whoever made the plan starts its kit. Ask ' + first(plan.by_name) + '.');
    await sql`insert into plan_kits (plan_id, circle_id, sides, created_by) values (${plan.id}, ${circle.id}, ${KIT_SIDES_DEFAULT}::text[], ${me.id}) on conflict (plan_id) do nothing`;
    return done(201);
  }
  if (!kit) return no(409, 'This plan has no kit yet.');
  const host = kitIsHost(plan, kit, me.id);
  const hostOnly = 'The hosts change this. Ask ' + first(plan.by_name) + ' to add you as a host.';

  if (act === 'kit_hosts_set') {
    if (!kitIsMaker(plan, me.id)) return no(403, 'Whoever made the plan names the hosts.');
    const want = [...new Set((Array.isArray(b.hosts) ? b.hosts : []).filter(isUuid))].filter(id => id !== me.id);
    if (want.length > KIT_MAX.hosts) return no(400, 'Choose up to ' + KIT_MAX.hosts + ' hosts.');
    // A host is someone on Parwah who is with us.
    const okIds = want.length ? (await sql`select id from members where circle_id = ${circle.id} and id = any(${want}::uuid[]) and user_id is not null and not remembered`).map(r => r.id) : [];
    if (okIds.length !== want.length) return no(400, 'A host is someone in this family who is on Parwah.');
    const added = okIds.filter(id => !kit.hosts.includes(id));
    await sql`update plan_kits set hosts = ${okIds}::uuid[] where plan_id = ${plan.id}`;
    // Telling someone they are a host is limited, so it cannot be used to ring them.
    for (const id of added) {
      if (await rateLimit(sql, 'kithost', me.id + ':' + id, 3, 86400, { failClosed: true })) {
        await pushCircle(sql, circle.id, { kind: 'plans', title: '🎊 ' + first(me.name) + ' made you a host of ' + plan.title, body: 'You can now add guests, tasks and arrivals.', url: '/#fun' }, { only: id });
      }
    }
    return done();
  }
  if (act === 'kit_arrival_receive') {
    // Any adult of the family who is on Parwah can say "I will receive them".
    if (await minorOf(sql, circle.id, me.id)) return no(403, 'An adult in the family receives a guest.');
    const r = await sql`update kit_arrivals set receiver_id = ${me.id} where id = ${row.id} and (receiver_id is null or receiver_id = ${me.id}) returning id`;
    if (!r[0]) return no(409, 'Someone is already receiving them.');
    return done();
  }
  // A traveller may add or remove their own arrival; everything else is for the hosts.
  const ownArrival = (act === 'kit_arrival_add' && b.travellerId === me.id) || (act === 'kit_arrival_remove' && row.member_id === me.id);
  if (!host && !ownArrival) return no(403, hostOnly);

  if (act === 'kit_sides_set') {
    const sides = kitSides(b.sides);
    if (!sides.length) return no(400, 'Write at least one side, like "Our family".');
    await sql`update plan_kits set sides = ${sides}::text[] where plan_id = ${plan.id}`;
    return done();
  }
  if (act === 'kit_budget_set') {
    const v = kitBudgetClean(b.amount);
    if (v.error) return no(400, v.error);
    await sql`update plan_kits set budget_paise = ${v.value} where plan_id = ${plan.id}`;
    return done();
  }
  const sides = kit.sides.length ? kit.sides : KIT_SIDES_DEFAULT;
  if (act === 'kit_guest_add') {
    const n = (await sql`select count(*)::int as n from kit_guests where plan_id = ${plan.id}`)[0].n;
    const ids = [...new Set((Array.isArray(b.memberIds) ? b.memberIds : []).filter(isUuid))];
    if (n + Math.max(1, ids.length) > KIT_MAX.guests) return no(400, 'The guest list is full at ' + KIT_MAX.guests + ' invites.');
    if (ids.length) {
      const c = kitGuestClean({ memberId: ids[0], side: b.side, people: b.people, status: b.status }, { sides });
      if (c.error) return no(400, c.error);
      // Members of this family who are with us. Anyone marked as no longer
      // with us is refused in words, never added quietly.
      const found = await sql`select id, name, remembered from members where circle_id = ${circle.id} and id = any(${ids}::uuid[])`;
      const lost = found.find(m => m.remembered);
      if (lost) return no(400, lost.name + ' is remembered here, so is not on a guest list.');
      if (found.length !== ids.length) return no(400, 'Pick people from this family, or type a name.');
      for (const m of found) {
        await sql`insert into kit_guests (plan_id, circle_id, member_id, side, status, people, added_by)
                  values (${plan.id}, ${circle.id}, ${m.id}, ${c.value.side}, ${c.value.status}, ${c.value.people}, ${me.id})
                  on conflict (plan_id, member_id) where member_id is not null do nothing`;
      }
      return done(201);
    }
    // body.memberId is the caller. A typed guest has no member behind it.
    const c = kitGuestClean({ ...b, memberId: null }, { sides, goneNames: await goneNames(sql, circle.id) });
    if (c.error) return no(400, c.error);
    const why = noteRisk(c.value.name) || (c.value.note && noteRisk(c.value.note));
    if (why) return no(400, why);
    await sql`insert into kit_guests (plan_id, circle_id, name, side, status, people, note, added_by)
              values (${plan.id}, ${circle.id}, ${c.value.name}, ${c.value.side}, ${c.value.status}, ${c.value.people}, ${c.value.note}, ${me.id})`;
    return done(201);
  }
  if (act === 'kit_guest_update') {
    const merged = { memberId: row.member_id, name: b.name !== undefined && !row.member_id ? b.name : row.name, side: b.side !== undefined ? b.side : row.side,
      people: b.people !== undefined ? b.people : row.people, status: b.status !== undefined ? b.status : row.status, note: b.note !== undefined ? b.note : row.note };
    if (b.status !== undefined && !KIT_STATUSES.includes(b.status)) return no(400, 'Choose where this invite stands.');
    const c = kitGuestClean(merged, { sides, goneNames: row.member_id ? new Set() : await goneNames(sql, circle.id) });
    if (c.error) return no(400, c.error);
    await sql`update kit_guests set name = ${row.member_id ? row.name : c.value.name}, side = ${c.value.side}, people = ${c.value.people}, status = ${c.value.status}, note = ${c.value.note}
              where id = ${row.id}`;
    return done();
  }
  if (act === 'kit_guest_remove') { await sql`delete from kit_guests where id = ${row.id}`; return done(); }

  if (act === 'kit_task_add') {
    const n = (await sql`select count(*)::int as n from kit_tasks where plan_id = ${plan.id}`)[0].n;
    if (n >= KIT_MAX.tasks) return no(400, 'This kit has ' + KIT_MAX.tasks + ' tasks already.');
    // An ordinary family task, through the task module's own door: its
    // owner is told, reminded and can hand it on like any other.
    const t = await createTask(sql, circle, me, { title: b.title, ownerId: b.ownerId || null, dueDate: b.dueDate || null, tz: b.tz || 'Asia/Kolkata', notes: 'For: ' + plan.title });
    if (!t.json.ok) return t;
    await sql`insert into kit_tasks (plan_id, task_id) values (${plan.id}, ${t.json.id}) on conflict do nothing`;
    return done(201);
  }
  if (act === 'kit_arrival_add') {
    const n = (await sql`select count(*)::int as n from kit_arrivals where plan_id = ${plan.id}`)[0].n;
    if (n >= KIT_MAX.arrivals) return no(400, 'This kit has ' + KIT_MAX.arrivals + ' arrivals already.');
    const c = kitArrivalClean({ ...b, memberId: b.travellerId || null });
    if (c.error) return no(400, c.error);
    let memberId = null;
    if (b.travellerId) {
      if (!isUuid(b.travellerId)) return no(400, 'Pick someone from this family, or type a name.');
      const m = (await sql`select id, name, remembered from members where id = ${b.travellerId} and circle_id = ${circle.id}`)[0];
      if (!m) return no(400, 'Pick someone from this family, or type a name.');
      if (m.remembered) return no(400, m.name + ' is remembered here.');
      memberId = m.id;
    } else if ((await goneNames(sql, circle.id)).has(String(c.value.who).toLowerCase())) return no(400, c.value.who + ' is remembered here.');
    let receiver = null;
    if (b.receiverId) {
      // Whoever receives a guest is an adult of this family who is with us.
      if (!isUuid(b.receiverId)) return no(400, 'Choose who receives them from this family.');
      const r = (await sql`select m.id from members m where m.id = ${b.receiverId} and m.circle_id = ${circle.id} and not m.remembered
                           and not (case when m.dob is not null then m.dob > current_date - interval '18 years' else (m.is_child or m.adult_confirmed is false) end)`)[0];
      if (!r) return no(400, 'Choose an adult in this family to receive them.');
      receiver = r.id;
    }
    await sql`insert into kit_arrivals (plan_id, circle_id, member_id, who, arrive_at, mode, from_place, receiver_id, added_by)
              values (${plan.id}, ${circle.id}, ${memberId}, ${memberId ? null : c.value.who}, ${c.value.arriveAt}, ${c.value.mode}, ${c.value.from}, ${receiver}, ${me.id})`;
    // Being asked to receive someone is told once, and limited.
    if (receiver && receiver !== me.id && await rateLimit(sql, 'kitrecv', me.id + ':' + receiver, 10, 86400, { failClosed: true })) {
      await pushCircle(sql, circle.id, { kind: 'plans', title: '🎊 Could you receive ' + first(memberId ? (await sql`select name from members where id = ${memberId}`)[0].name : c.value.who) + '?',
        body: 'For ' + plan.title + '. Open the kit to see when they arrive.', url: '/#fun' }, { only: receiver });
    }
    return done(201);
  }
  if (act === 'kit_arrival_remove') { await sql`delete from kit_arrivals where id = ${row.id}`; return done(); }
  return no(400, 'Unknown action');
}
