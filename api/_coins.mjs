// PARWAH COINS - one shared pot per family, and the credit that Ekta and
// every other AI feature spends.
//
// Two decisions shape this:
//
//  * The pot is the FAMILY'S, not the individual's. A grandmother who asks
//    Ekta twenty questions is spending coins her grandson earned by keeping
//    the memory current, and that is exactly right - it is the same
//    arrangement as the rest of the product. The ledger still records who
//    earned what, so the family can see who is doing the keeping.
//
//  * There is no stored balance. The balance is the sum of the ledger,
//    always, so it can never drift from the truth of what happened.
//
// Earning is idempotent by (member, reason, ref): verifying the same entry
// twice in a month pays once, checking in twice in a day pays once. That is
// enforced by a unique index, not by remembering to check.
import { dayIn } from './_recur.mjs';
import { coinsLeftToday } from './_heardrules.mjs';

// Only what is really paid is listed: a rule shown on screen that never pays
// teaches the family the coins are not to be trusted. Check-ins and
// medicines earn nothing on purpose - an adult's health is not a score.
export const EARN = {
  welcome:    { n: 120, label: 'Welcome to Parwah' },
  reminder:   { n: 3,   label: 'Finished a reminder' },
  memory_add: { n: 5,   label: 'Added to Health & contacts' },
  memory_ok:  { n: 2,   label: 'Checked something is still current' },
  vault_add:  { n: 10,  label: 'Put a document in the vault' },
  welcomed:   { n: 5,   label: 'Welcomed someone into the family' },
  game:       { n: 3,   label: 'Finished a game together' },
  // Being heard, and answering (Nov 2026): small on purpose, each at most
  // once a day, and no more than HEARD_COIN_CAP a day for one person
  // altogether, so they cannot be farmed. See awardHeard below.
  story_told: { n: 2,   label: 'Told a story' },
  card_line:  { n: 2,   label: 'Wrote in a card' },
  sawaal:     { n: 2,   label: 'Answered the weekly question' },
  shukriya:   { n: 1,   label: 'Said shukriya' }
};
export const HEARD_EARN = ['story_told', 'card_line', 'sawaal', 'shukriya'];
// Rows from before those rules were dropped still read sensibly.
export const PAST_LABELS = { checkin: 'Checked in', pill: 'Took the medicines', game: 'Played together' };

// What the AI costs the family, per turn.
export const SPEND = { ekta: 2 };

export async function ensureCoinSchema(sql) {
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  const { schemaOnce } = await import('./_db.mjs');
  return schemaOnce(() => coinTables(sql));
}
async function coinTables(sql) {
  await sql`create table if not exists coins (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid references members(id) on delete set null,
    delta integer not null,
    reason text not null,
    ref text,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists coins_circle_time on coins (circle_id, created_at desc)`;
  // Pays once. The index is the rule; nothing has to remember to check.
  try { await sql`create unique index if not exists coins_once on coins (circle_id, member_id, reason, ref) where ref is not null`; } catch (e) {}
}

export async function balance(sql, circleId) {
  await ensureCoinSchema(sql);
  const r = await sql`select coalesce(sum(delta), 0)::int as n from coins where circle_id = ${circleId}`;
  return r[0].n;
}

// Credit the family for something a member did. `ref` makes it pay once -
// pass the thing's id, or a date for once-a-day actions. Awarding must never
// be able to break the action that earned it.
export async function award(sql, circleId, memberId, reason, ref = null) {
  const rule = EARN[reason];
  if (!rule) return 0;
  try {
    await ensureCoinSchema(sql);
    const rows = await sql`
      insert into coins (circle_id, member_id, delta, reason, ref)
      values (${circleId}, ${memberId}, ${rule.n}, ${reason}, ${ref})
      on conflict do nothing
      returning id`;
    return rows.length ? rule.n : 0;
  } catch (e) { return 0; }
}

// Coins for telling a story, writing in a card, answering the weekly
// question and saying shukriya. Each pays once a day at most (the day is
// the ref, and the unique index is the rule), and together they stop at the
// day's cap. Like award, this can never break the action that earned it.
export async function awardHeard(sql, circleId, memberId, reason, day) {
  const rule = EARN[reason];
  if (!rule || !HEARD_EARN.includes(reason) || !day) return 0;
  try {
    await ensureCoinSchema(sql);
    const got = await sql`select coalesce(sum(delta), 0)::int as n from coins
                          where circle_id = ${circleId} and member_id = ${memberId} and ref = ${day} and reason = any(${HEARD_EARN}::text[])`;
    if (coinsLeftToday(got[0].n) < rule.n) return 0;
    return await award(sql, circleId, memberId, reason, day);
  } catch (e) { return 0; }
}

// The day where the asker is (their phone sends its zone), UTC otherwise.
export function today(tz) { return dayIn(tz); }

// Take coins for an AI turn. Returns { ok, balance, cost } - a family with
// an empty pot is told how to fill it, never billed into the negative.
export async function spend(sql, circleId, memberId, reason) {
  const cost = SPEND[reason] || 1;
  await ensureCoinSchema(sql);
  const have = await balance(sql, circleId);
  if (have < cost) return { ok: false, balance: have, cost };
  await sql`insert into coins (circle_id, member_id, delta, reason) values (${circleId}, ${memberId}, ${-cost}, ${reason})`;
  return { ok: true, balance: have - cost, cost };
}
