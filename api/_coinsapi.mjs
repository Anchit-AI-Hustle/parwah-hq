// GET /api/settings?area=coins&circle=CODE&member=UUID
//   → { ok, balance, mine, ledger[], earn, spend }
// The ledger is the family's shared record: what was earned, by whom, and
// what the AI has cost. There is nothing to buy - coins are earned by
// looking after each other, and spent on Ekta.
import { db, ensureSchema, circleByCode, isUuid , requireMember} from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { ensureCoinSchema, balance, EARN, SPEND, PAST_LABELS } from './_coins.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureCoinSchema(sql); }
  catch (e) { return failDb(res, e); }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }
  try {
    const q = req.query || {};
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, q.circle, q.member, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const meRow = [_g.me];

    const bal = await balance(sql, circle.id);
    const mine = await sql`select coalesce(sum(delta), 0)::int as n from coins
                           where circle_id = ${circle.id} and member_id = ${meRow[0].id} and delta > 0`;
    const ledger = await sql`
      select c.delta, c.reason, c.created_at, m.name
      from coins c left join members m on m.id = c.member_id
      where c.circle_id = ${circle.id}
      order by c.created_at desc limit 40`;
    // Who has been looking after things this month - thanked, not ranked:
    // names only, in alphabetical order, and no totals to compare.
    const thanks = await sql`
      select distinct m.name
      from coins c join members m on m.id = c.member_id
      where c.circle_id = ${circle.id} and c.delta > 0 and c.reason <> 'welcome'
        and c.created_at > now() - interval '30 days'
      order by m.name limit 12`;
    return res.status(200).json({ ok: true, balance: bal, mine: mine[0].n, ledger, thanks: thanks.map(r => r.name),
      earn: EARN, past: PAST_LABELS, spend: SPEND });
  } catch (e) {
    return fail(res, e);
  }
}
