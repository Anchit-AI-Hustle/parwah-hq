// SPLITTING THE COST OF A TRIP OR A FUNCTION.
//
// "Meera booked the rooms, Rohan paid for the taxi, Papa bought the sweets.
// Who owes whom?" The family writes down who paid what on a plan, and Parwah
// does the sums: the total, each person's share, what each has paid, and who
// owes whom in the fewest transfers.
//
// PARWAH NEVER MOVES MONEY and never touches a payment. When asked, it opens
// the payer's own UPI app with the amount filled in, and that is all. A line
// is closed only when the payer says "I have paid" AND the other person says
// "Received", so nobody marks a debt gone alone.
//
//   GET  /api/plans?area=split&circle=CODE&member=UUID&plan=UUID
//   POST /api/plans {code, memberId, action, ...}
//        split_add      {planId, what, amount, paidBy?, between?: [memberId], mode?: equal|uneven, shares?: {memberId: amount}}
//        split_edit     {id, ...the same}
//        split_remove   {id}
//        split_paid     {planId, to}      the payer's side
//        split_received {planId, from}    the other side
//        split_undo     {id}              before the other person confirms
//
// WHO SEES A PLAN'S COSTS is said by the query, not by the screen: whoever
// made the plan, whoever is going, may come or was invited, and whoever paid
// or shares one of its costs. Nobody else in the circle, and nobody outside.
//
// EVERY AMOUNT IS A WHOLE NUMBER OF PAISE (api/_splitmath.mjs). One currency
// per plan, from the country of whoever made the plan.
//
// A UPI ID is put into a link only for the person who has to pay, only when
// the plan is in rupees, and only when the owner of that id has already
// allowed that person to use it (pay_perms). An id the viewer could not see
// in the vault is never in any answer from here. A UPI PIN is never asked
// for, never accepted and never kept.
import { isUuid, schemaOnce } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { noteRisk } from './_notesapi.mjs';
import { currencyOf, money } from './_money.mjs';
import { ensurePaySchema } from './_vaultapi.mjs';
import { SPLIT_MAX, parsePaise, equalShares, unevenShares, ledger, upiLink } from './_splitmath.mjs';

export const SPLIT_NOTE = 'Parwah does not move money. This opens your own UPI app.';
export const SPLIT_NO_PIN = 'Parwah never asks for a UPI PIN and never keeps one. Leave it out.';

let ready = false;
export async function ensureSplitSchema(sql) {
  if (ready) return;
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  await schemaOnce(() => splitTables(sql));
  ready = true;
}
async function splitTables(sql) {
  // A saved UPI id lives with the other ways to pay; its tables are made
  // first so the lookup below never meets a missing one.
  await ensurePaySchema(sql);
  await sql`alter table plans add column if not exists cost_currency text`;
  await sql`create table if not exists plan_costs (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references plans(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    what text not null,
    amount_paise bigint not null check (amount_paise > 0),
    paid_by uuid not null references members(id) on delete cascade,
    mode text not null default 'equal' check (mode in ('equal', 'uneven')),
    added_by uuid references members(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`create index if not exists plan_costs_plan on plan_costs (plan_id, created_at)`;
  await sql`create table if not exists plan_cost_shares (
    cost_id uuid not null references plan_costs(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    share_paise bigint not null check (share_paise >= 0),
    primary key (cost_id, member_id)
  )`;
  await sql`create index if not exists plan_cost_shares_member on plan_cost_shares (member_id)`;
  // One row per "this was paid". paid_at is the payer's word, received_at
  // the other person's; the line is closed only when both are there.
  await sql`create table if not exists plan_settles (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references plans(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    from_member uuid not null references members(id) on delete cascade,
    to_member uuid not null references members(id) on delete cascade,
    amount_paise bigint not null check (amount_paise > 0),
    paid_at timestamptz,
    received_at timestamptz,
    created_at timestamptz not null default now(),
    check (paid_at is not null or received_at is not null)
  )`;
  await sql`create index if not exists plan_settles_plan on plan_settles (plan_id)`;
  // Two taps on "I have paid" are one line, not two.
  await sql`create unique index if not exists plan_settles_open on plan_settles (plan_id, from_member, to_member)
            where paid_at is null or received_at is null`;
}

const bad = (error, status) => ({ status: status || 400, json: { ok: false, error } });
const good = (extra, status) => ({ status: status || 200, json: { ok: true, ...(extra || {}) } });
const num = (v) => Number(v) || 0;
const NOT_ON = 'Only people on this plan can see its costs. Say you are in first.';

// "₹1,250" or "₹1,250.50", for a notification to the one person it concerns.
export function splitMoney(paise, cur) {
  const c = cur && cur !== 'XXX' ? cur : null;
  const rest = paise % 100;
  if (!rest) return money((paise - rest) / 100, c);
  const text = String((paise - rest) / 100) + '.' + (rest < 10 ? '0' : '') + rest;
  // Only the words on the screen: the sums themselves stay in whole paise.
  try { if (c) return new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en', { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(text)); } catch (e) {}
  return c ? c + ' ' + text : text;
}

// The plan, and whether the caller is on it. The rule is in the query.
async function planFor(sql, circle, me, planId) {
  if (!isUuid(planId)) return { err: bad('Bad plan id') };
  const r = await sql`
    select p.id, p.title, p.kind, p.by_member, p.going, p.cost_currency, c.country as by_country,
           (p.by_member = ${me.id} or ${me.id}::uuid = any(p.going) or ${me.id}::uuid = any(p.maybe) or ${me.id}::uuid = any(p.invited)
            or exists (select 1 from plan_costs k where k.plan_id = p.id and (k.paid_by = ${me.id}
                       or exists (select 1 from plan_cost_shares s where s.cost_id = k.id and s.member_id = ${me.id})))) as on_plan
    from plans p left join members c on c.id = p.by_member
    where p.id = ${planId} and p.circle_id = ${circle.id}`;
  if (!r[0]) return { err: bad('Plan not found', 404) };
  if (!r[0].on_plan) return { err: bad(NOT_ON, 403) };
  const plan = r[0];
  // One currency per plan: kept from the first cost on, and until then
  // read from the country of whoever made the plan.
  plan.currency = plan.cost_currency || currencyOf(plan.by_member ? plan.by_country : me.country) || 'XXX';
  return { plan };
}

async function readAll(sql, circle, plan) {
  const costs = await sql`
    select k.id, k.what, k.amount_paise, k.paid_by, k.mode, k.added_by, k.created_at
    from plan_costs k where k.plan_id = ${plan.id} and k.circle_id = ${circle.id}
    order by k.created_at, k.id`;
  const shares = costs.length ? await sql`
    select s.cost_id, s.member_id, s.share_paise from plan_cost_shares s
    where s.cost_id = any(${costs.map(c => c.id)}::uuid[]) order by s.member_id` : [];
  const settles = await sql`
    select id, from_member, to_member, amount_paise, paid_at, received_at, created_at
    from plan_settles where plan_id = ${plan.id} and circle_id = ${circle.id} order by created_at, id`;
  const members = await sql`select id, name from members where circle_id = ${circle.id} order by name, id`;
  const names = {}; members.forEach(m => { names[m.id] = m.name; });
  const list = costs.map(c => {
    const sh = {}; shares.filter(s => s.cost_id === c.id).forEach(s => { sh[s.member_id] = num(s.share_paise); });
    return { id: c.id, what: c.what, amount: num(c.amount_paise), paidBy: c.paid_by, mode: c.mode, addedBy: c.added_by, shares: sh };
  });
  // Every row counts in the sums, the open ones too: an open row is shown
  // as "waiting", never as gone.
  const moves = settles.map(s => ({ id: s.id, from: s.from_member, to: s.to_member, amount: num(s.amount_paise), paid: !!s.paid_at, received: !!s.received_at }));
  return { costs: list, moves, members, names, book: ledger(list, moves) };
}

export async function splitState(sql, circle, me, planId) {
  const g = await planFor(sql, circle, me, planId);
  if (g.err) return g.err;
  const plan = g.plan;
  const d = await readAll(sql, circle, plan);
  const nm = (id) => d.names[id] || 'Someone';
  const rupees = plan.currency === 'INR';
  // A UPI id, only for a line I have to pay, only in rupees, and only when
  // its owner has already allowed me to use it.
  const payees = rupees ? d.book.owes.filter(o => o.from === me.id).map(o => o.to) : [];
  const upi = {};
  if (payees.length) {
    const rows = await sql`
      select p.owner_member, p.handle
      from pay_methods p
      join pay_perms pp on pp.method_id = p.id and pp.member_id = ${me.id}
      where p.circle_id = ${circle.id} and p.kind = 'upi' and p.handle is not null
        and p.owner_member = any(${payees}::uuid[])
      order by p.updated_at desc, p.id`;
    for (const r of rows) {
      if (upi[r.owner_member]) continue;
      const link = upiLink({ pa: String(r.handle).trim(), pn: nm(r.owner_member), amount: (d.book.owes.find(o => o.from === me.id && o.to === r.owner_member) || {}).amount, cu: plan.currency, tn: plan.title });
      if (link) upi[r.owner_member] = link;
    }
  }
  const owes = d.book.owes.map(o => {
    const line = { from: o.from, fromName: nm(o.from), to: o.to, toName: nm(o.to), amount: o.amount,
                   mine: o.from === me.id ? 'pay' : o.to === me.id ? 'receive' : null };
    if (line.mine === 'pay' && rupees) { if (upi[o.to]) line.upi = upi[o.to]; else line.askUpi = true; }
    return line;
  });
  const shape = (s) => ({ id: s.id, from: s.from, fromName: nm(s.from), to: s.to, toName: nm(s.to), amount: s.amount, paid: s.paid, received: s.received });
  const waiting = d.moves.filter(s => !(s.paid && s.received)).map(s => ({ ...shape(s),
    canUndo: (s.paid && s.from === me.id) || (s.received && s.to === me.id),
    canConfirm: (s.paid && !s.received && s.to === me.id) || (s.received && !s.paid && s.from === me.id) }));
  const settled = d.moves.filter(s => s.paid && s.received).map(shape);
  const people = Object.keys(d.book.people).map(id => ({ memberId: id, name: nm(id), ...d.book.people[id] }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.memberId < b.memberId ? -1 : 1));
  return good({
    plan: { id: plan.id, title: plan.title, kind: plan.kind, byMember: plan.by_member, going: plan.going || [] },
    currency: plan.currency, upiOk: rupees, note: SPLIT_NOTE,
    total: d.book.total, people, owes, waiting, settled,
    costs: d.costs.map(c => ({ id: c.id, what: c.what, amount: c.amount, paidBy: c.paidBy, paidName: nm(c.paidBy), mode: c.mode,
      shares: Object.keys(c.shares).map(id => ({ memberId: id, name: nm(id), amount: c.shares[id] })),
      canEdit: c.addedBy === me.id || plan.by_member === me.id })),
    members: d.members.map(m => ({ id: m.id, name: m.name }))
  });
}

// What a cost may be. Returns { error } or { what, amount, paidBy, mode, shares }.
async function cleanCost(sql, circle, me, plan, b) {
  const word = circle.kind === 'group' ? 'group' : 'family';
  const what = String(b.what == null ? '' : b.what).replace(/\s+/g, ' ').trim();
  if (!what) return { error: 'Write what it was for, like Taxi from the airport.' };
  if (what.length > SPLIT_MAX.what) return { error: 'What it was for can be up to ' + SPLIT_MAX.what + ' letters. Make it shorter.' };
  const risk = noteRisk(what);
  if (risk) return { error: risk };
  const amount = parsePaise(b.amount);
  if (amount === null || amount <= 0) return { error: 'Write the amount as a number above 0, like 1250 or 1250.50.' };
  const members = await sql`select id from members where circle_id = ${circle.id}`;
  const inCircle = new Set(members.map(m => m.id));
  const paidBy = b.paidBy == null || b.paidBy === '' ? me.id : b.paidBy;
  if (!isUuid(paidBy) || !inCircle.has(paidBy)) return { error: 'Pick who paid from this ' + word + '.' };
  const mode = b.mode === 'uneven' ? 'uneven' : 'equal';
  let shares;
  if (mode === 'uneven') {
    const src = b.shares && typeof b.shares === 'object' && !Array.isArray(b.shares) ? b.shares : {};
    const ids = Object.keys(src);
    if (ids.length > SPLIT_MAX.people || !ids.every(id => isUuid(id) && inCircle.has(id))) return { error: 'Pick people from this ' + word + '.' };
    const typed = {};
    for (const id of ids) {
      const blank = src[id] == null || String(src[id]).trim() === '';
      const p = blank ? 0 : parsePaise(src[id]);
      if (p === null) return { error: 'Write each share as an amount, like 500 or 499.50.' };
      typed[id] = p;
    }
    const u = unevenShares(amount, typed);
    if (u.error) return { error: u.error };
    shares = u.shares;
  } else {
    // Shared between everyone going, unless people were chosen.
    let ids = Array.isArray(b.between) && b.between.length ? [...new Set(b.between)] : (plan.going || []).slice();
    if (!ids.length) ids = [me.id];
    if (ids.length > SPLIT_MAX.people || !ids.every(id => isUuid(id) && inCircle.has(id))) return { error: 'Pick people from this ' + word + '.' };
    shares = equalShares(amount, ids);
  }
  return { what, amount, paidBy, mode, shares };
}

async function costFor(sql, circle, me, id) {
  if (!isUuid(id)) return { err: bad('That cost could not be found') };
  const r = await sql`select id, plan_id, added_by from plan_costs where id = ${id} and circle_id = ${circle.id}`;
  if (!r[0]) return { err: bad('That cost is not here any more', 404) };
  const g = await planFor(sql, circle, me, r[0].plan_id);
  if (g.err) return g;
  // Whoever added it, or whoever made the plan. Nobody else.
  if (r[0].added_by !== me.id && g.plan.by_member !== me.id) return { err: bad('Only the person who added it, or who made the plan, can change it.', 403) };
  return { cost: r[0], plan: g.plan };
}

export async function splitAction(sql, circle, me, b) {
  const action = b.action;
  // A PIN is never taken, under any name.
  for (const k of Object.keys(b)) if (/pin$/i.test(k)) return bad(SPLIT_NO_PIN);

  if (action === 'split_add') {
    const g = await planFor(sql, circle, me, b.planId);
    if (g.err) return g.err;
    const c = await cleanCost(sql, circle, me, g.plan, b);
    if (c.error) return bad(c.error);
    const n = await sql`select count(*)::int as n from plan_costs where plan_id = ${g.plan.id}`;
    if (n[0].n >= SPLIT_MAX.costs) return bad('This plan has ' + SPLIT_MAX.costs + ' costs. Remove one to add another.');
    await sql`update plans set cost_currency = ${g.plan.currency} where id = ${g.plan.id} and cost_currency is null`;
    const ids = Object.keys(c.shares);
    const r = await sql`
      with k as (insert into plan_costs (plan_id, circle_id, what, amount_paise, paid_by, mode, added_by)
                 values (${g.plan.id}, ${circle.id}, ${c.what}, ${c.amount}, ${c.paidBy}, ${c.mode}, ${me.id}) returning id)
      insert into plan_cost_shares (cost_id, member_id, share_paise)
      select k.id, x.member_id, x.share from k, unnest(${ids}::uuid[], ${ids.map(id => c.shares[id])}::bigint[]) as x(member_id, share)
      returning cost_id`;
    return good({ id: r[0].cost_id }, 201);
  }

  if (action === 'split_edit') {
    const g = await costFor(sql, circle, me, b.id);
    if (g.err) return g.err;
    const c = await cleanCost(sql, circle, me, g.plan, b);
    if (c.error) return bad(c.error);
    const ids = Object.keys(c.shares);
    await sql`
      with u as (update plan_costs set what = ${c.what}, amount_paise = ${c.amount}, paid_by = ${c.paidBy}, mode = ${c.mode}, updated_at = now()
                 where id = ${g.cost.id} returning id),
           gone as (delete from plan_cost_shares where cost_id = ${g.cost.id} and member_id <> all(${ids}::uuid[]) returning member_id)
      insert into plan_cost_shares (cost_id, member_id, share_paise)
      select u.id, x.member_id, x.share from u, unnest(${ids}::uuid[], ${ids.map(id => c.shares[id])}::bigint[]) as x(member_id, share)
      on conflict (cost_id, member_id) do update set share_paise = excluded.share_paise`;
    return good({ id: g.cost.id });
  }

  if (action === 'split_remove') {
    const g = await costFor(sql, circle, me, b.id);
    if (g.err) return g.err;
    await sql`delete from plan_costs where id = ${g.cost.id}`;
    return good();
  }

  if (action === 'split_paid' || action === 'split_received') {
    const payer = action === 'split_paid';
    const g = await planFor(sql, circle, me, b.planId);
    if (g.err) return g.err;
    const other = payer ? b.to : b.from;
    if (!isUuid(other) || other === me.id) return bad('Pick the person it is with.');
    const from = payer ? me.id : other, to = payer ? other : me.id;
    // The other side has already said so: this closes the line.
    const closed = payer
      ? await sql`update plan_settles set paid_at = now() where plan_id = ${g.plan.id} and from_member = ${from} and to_member = ${to}
                  and paid_at is null and received_at is not null returning id, amount_paise`
      : await sql`update plan_settles set received_at = now() where plan_id = ${g.plan.id} and from_member = ${from} and to_member = ${to}
                  and received_at is null and paid_at is not null returning id, amount_paise`;
    if (closed[0]) {
      await pushCircle(sql, circle.id, { title: '✅ Settled: ' + g.plan.title,
        body: me.name + (payer ? ' confirms paying ' : ' confirms receiving ') + splitMoney(num(closed[0].amount_paise), g.plan.currency) + '.', url: '/#fun' }, { only: other });
      return good({ id: closed[0].id, closed: true });
    }
    // Otherwise this is the first word on it. The amount is the one the
    // sums give, never one the phone sends.
    const d = await readAll(sql, circle, g.plan);
    const line = d.book.owes.find(o => o.from === from && o.to === to);
    if (!line) return bad('Nothing is owed there now. Open the costs again to see the latest.', 409);
    const r = payer
      ? await sql`insert into plan_settles (plan_id, circle_id, from_member, to_member, amount_paise, paid_at)
                  values (${g.plan.id}, ${circle.id}, ${from}, ${to}, ${line.amount}, now()) on conflict do nothing returning id`
      : await sql`insert into plan_settles (plan_id, circle_id, from_member, to_member, amount_paise, received_at)
                  values (${g.plan.id}, ${circle.id}, ${from}, ${to}, ${line.amount}, now()) on conflict do nothing returning id`;
    if (!r[0]) return bad('That is already marked. Open the costs again to see the latest.', 409);
    await pushCircle(sql, circle.id, { title: '💰 ' + g.plan.title,
      body: me.name + (payer ? ' says ' + splitMoney(line.amount, g.plan.currency) + ' is paid to you. Open Parwah and tap Received if it has come.'
                             : ' says ' + splitMoney(line.amount, g.plan.currency) + ' has come from you. Open Parwah and tap I have paid to agree.'), url: '/#fun' }, { only: other });
    return good({ id: r[0].id, closed: false }, 201);
  }

  if (action === 'split_undo') {
    if (!isUuid(b.id)) return bad('That line could not be found');
    const r = await sql`select id, plan_id, from_member, to_member, paid_at, received_at from plan_settles where id = ${b.id} and circle_id = ${circle.id}`;
    if (!r[0]) return bad('That line is not here any more', 404);
    const g = await planFor(sql, circle, me, r[0].plan_id);
    if (g.err) return g.err;
    if (r[0].paid_at && r[0].received_at) return bad('Both of you have confirmed this one, so it stays.', 409);
    const mine = (r[0].paid_at && r[0].from_member === me.id) || (r[0].received_at && r[0].to_member === me.id);
    if (!mine) return bad('Only the person who marked it can undo it.', 403);
    // Only while it is still open: a line the other person confirmed in the
    // same moment is not taken back.
    const gone = await sql`delete from plan_settles where id = ${r[0].id} and (paid_at is null or received_at is null) returning id`;
    if (!gone[0]) return bad('Both of you have confirmed this one, so it stays.', 409);
    return good();
  }

  return bad('Unknown action');
}
