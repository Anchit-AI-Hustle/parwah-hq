// GET /api/settings?area=coins&circle=CODE&member=UUID
//   → { ok, balance, mine, ledger[], earn, spend }
// The ledger is the family's shared record: what was earned, by whom, and
// what the AI has cost. There is nothing to buy — coins are earned by
// looking after each other, and spent on Ekta.
import { db, ensureSchema, circleByCode, isUuid, serverError } from './_db.mjs';
import { ensureCoinSchema, balance, EARN, SPEND } from './_coins.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureCoinSchema(sql); }
  catch (e) { return serverError(res, e, 'coinsapi'); }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }
  try {
    const q = req.query || {};
    const circle = await circleByCode(sql, q.circle);
    if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
    if (!isUuid(q.member)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const meRow = await sql`select id from members where id = ${q.member} and circle_id = ${circle.id}`;
    if (!meRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });

    const bal = await balance(sql, circle.id);
    const mine = await sql`select coalesce(sum(delta), 0)::int as n from coins
                           where circle_id = ${circle.id} and member_id = ${meRow[0].id} and delta > 0`;
    const ledger = await sql`
      select c.delta, c.reason, c.created_at, m.name
      from coins c left join members m on m.id = c.member_id
      where c.circle_id = ${circle.id}
      order by c.created_at desc limit 40`;
    const top = await sql`
      select m.name, sum(c.delta)::int as n
      from coins c join members m on m.id = c.member_id
      where c.circle_id = ${circle.id} and c.delta > 0
      group by m.name order by n desc limit 5`;
    return res.status(200).json({ ok: true, balance: bal, mine: mine[0].n, ledger, top, earn: EARN, spend: SPEND });
  } catch (e) {
    return serverError(res, e, 'coinsapi');
  }
}
