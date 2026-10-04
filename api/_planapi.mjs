// PRICING AND THE RESERVATION FLOW.
//
// Parwah has no payment rails and will not grow its own: money moves through
// licensed partners only. So this validates willingness to pay WITHOUT
// pretending to take money - a family reserves a place, and that reservation
// is the signal. Nothing here touches a card.
//
// NRI pricing is the point, not a footnote: the person paying usually lives
// abroad and the people cared for live in India. Same plan, same family, the
// price shown in the currency of whoever is looking.
//
// GET  /api/settings?area=plan&circle=CODE&member=UUID → plans, rate, reservations
// POST { action:'reserve'|'cancel', plan, currency }
import { db, ensureSchema, circleByCode, isUuid , requireMember} from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';

// The rate is fixed and stated, never a live lookup: a price that moves while
// a family thinks about it is not a price.
export const USD_RATE = 85;

export const PLANS = {
  free: {
    id: 'free', name: 'Parwah', inr: 0,
    tagline: 'Everything a family needs to look after each other.',
    includes: ['The family memory and preparedness', 'The emergency card, offline',
               'The vault - documents with a permission on each', 'Check-ins, reminders and help requests',
               'Chat, plans, calls and games', 'Ekta, on the coins the family earns']
  },
  care: {
    id: 'care', name: 'Parwah Family Plan', inr: 2499,
    tagline: 'One plan for the whole family, wherever each of you lives.',
    includes: ['Family Memory', 'Health & Emergency Information', 'Trusted Contacts',
               'Family Readiness', 'Ekta']
  }
};

export function priceOf(planId, currency) {
  const p = PLANS[planId] || PLANS.free;
  if (currency === 'USD') {
    // Rounded to a whole dollar, ending .99 - an exchange-rate remainder
    // printed to the cent reads like a mistake.
    const raw = p.inr / USD_RATE;
    const usd = raw === 0 ? 0 : Math.max(1, Math.round(raw + 0.5)) - 0.01;
    return { currency: 'USD', symbol: '$', amount: usd, per: 'year' };
  }
  return { currency: 'INR', symbol: '₹', amount: p.inr, per: 'year' };
}

async function ensurePlanSchema(sql) {
  await sql`create table if not exists plan_interest (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    plan text not null,
    currency text not null,
    amount integer not null,
    note text,
    created_at timestamptz not null default now()
  )`;
  try { await sql`create unique index if not exists plan_interest_one on plan_interest (circle_id, member_id)`; } catch (e) {}
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensurePlanSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, code, memberId, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const meRow = [_g.me];
    const me = meRow[0];

    if (req.method === 'GET') {
      const rows = await sql`
        select p.id, p.plan, p.currency, p.amount, p.created_at, m.name, m.id as member_id
        from plan_interest p join members m on m.id = p.member_id
        where p.circle_id = ${circle.id} order by p.created_at desc limit 20`;
      // Where the family lives decides which currency leads - an NRI child
      // should not have to convert their parents' price in their head.
      const abroad = (me.country || 'IN').toUpperCase() !== 'IN';
      const members = await sql`select country from members where circle_id = ${circle.id}`;
      const anyAbroad = members.some(m => (m.country || 'IN').toUpperCase() !== 'IN');
      return res.status(200).json({ ok: true, plans: PLANS, rate: USD_RATE,
        prefer: abroad ? 'USD' : 'INR', anyAbroad,
        prices: { INR: { care: priceOf('care', 'INR'), free: priceOf('free', 'INR') },
                  USD: { care: priceOf('care', 'USD'), free: priceOf('free', 'USD') } },
        reservations: rows, mine: rows.find(r => r.member_id === me.id) || null });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    if (body.action === 'cancel') {
      await sql`delete from plan_interest where circle_id = ${circle.id} and member_id = ${me.id}`;
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'reserve') {
      const plan = Object.prototype.hasOwnProperty.call(PLANS, body.plan) ? body.plan : null;
      if (!plan || plan === 'free') return res.status(400).json({ ok: false, error: 'Pick a plan to reserve' });
      const currency = body.currency === 'USD' ? 'USD' : 'INR';
      const price = priceOf(plan, currency);
      const note = String(body.note || '').trim().slice(0, 200) || null;
      await sql`insert into plan_interest (circle_id, member_id, plan, currency, amount, note)
                values (${circle.id}, ${me.id}, ${plan}, ${currency}, ${Math.round(price.amount)}, ${note})
                on conflict (circle_id, member_id)
                do update set plan = excluded.plan, currency = excluded.currency,
                              amount = excluded.amount, note = excluded.note, created_at = now()`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' reserved a place on ' + PLANS[plan].name})`;
      // Deliberately no payment: nothing is charged, and the reservation says so.
      return res.status(201).json({ ok: true, charged: false, price });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}
