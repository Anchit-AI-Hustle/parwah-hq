// SHARED CARE EXPENSES.
//
// "Bhaiya and I can see who paid what for Maa this month, without a
// spreadsheet fight."
//
// A record of money already spent on care: who paid, for whom, on what.
// Parwah never moves money and never makes a payment link here. Each amount
// stays in the currency it was paid in; totals and balances are per
// currency, never converted.
//
//   GET  /api/care?area=expenses&circle=CODE&member=ID&month=YYYY-MM
//   POST /api/care {action: expense_add | expense_remove | expense_from_bill | split_set}
import { db, requireMember, isUuid, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { money, currencyOf } from './_money.mjs';
import { reqTz } from './_recur.mjs';

export const EXPENSE_CATS = ['medicines', 'doctor', 'tests', 'staff', 'bills', 'groceries', 'travel', 'other'];
export const EXPENSE_CURS = ['INR', 'USD', 'AED', 'GBP', 'CAD'];
export const AMOUNT_MAX = 100000000;

let ready = false;
export async function ensureExpenseSchema(sql) {
  if (ready) return;
  // Bills and receipts are in the care-prep and vault tables, which this
  // points at; they are made first (see ensureCarePrepSchema).
  const { ensureCarePrepSchema } = await import('./_careprep.mjs');
  await ensureCarePrepSchema(sql);
  await schemaOnce(async () => {
    await sql`create table if not exists care_expenses (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      amount numeric(12,2) not null,
      currency text not null default 'INR',
      category text not null default 'other',
      for_member uuid references members(id) on delete set null,
      paid_by uuid references members(id) on delete set null,
      spent_on date not null default current_date,
      note text,
      receipt_doc_id uuid references vault_docs(id) on delete set null,
      bill_id uuid unique references care_bills(id) on delete set null,
      staff_id uuid,
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now()
    )`;
    await sql`create index if not exists care_expenses_month on care_expenses (circle_id, spent_on)`;
    // The family's agreed split: one row per family. shares is
    // {memberId: weight}; "equal" is every chosen person at weight 1.
    await sql`create table if not exists care_split (
      circle_id uuid primary key references circles(id) on delete cascade,
      mode text not null default 'none',
      shares jsonb not null default '{}'::jsonb,
      updated_by uuid references members(id) on delete set null,
      updated_at timestamptz not null default now()
    )`;
  });
  ready = true;
}

const clip = (s, n) => { const t = String(s == null ? '' : s).trim().slice(0, n); return t || null; };
function monthOf(v, tz) {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''))) return String(v);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7); }
  catch (e) { return new Date().toISOString().slice(0, 7); }
}
function dayOf(v, tz) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return String(v);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Kolkata' }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };

async function memberIn(sql, circleId, id) {
  if (!isUuid(id)) return null;
  const r = await sql`select id, name from members where id = ${id} and circle_id = ${circleId}`;
  return r[0] || null;
}

// Used by the staff register's "Mark paid" too.
export async function addExpense(sql, circle, me, b) {
  await ensureExpenseSchema(sql);
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount > 0) || amount > AMOUNT_MAX) return { status: 400, json: { ok: false, error: 'Write the amount as a number above 0' } };
  const cur = EXPENSE_CURS.includes(b.currency) ? b.currency : (b.currency && /^[A-Z]{3}$/.test(b.currency) && b.allowAnyCurrency ? b.currency : 'INR');
  const cat = EXPENSE_CATS.includes(b.category) ? b.category : 'other';
  const forM = b.forMemberId ? await memberIn(sql, circle.id, b.forMemberId) : null;
  if (b.forMemberId && !forM) return { status: 403, json: { ok: false, error: 'That person is not in this family' } };
  const payer = b.paidById ? await memberIn(sql, circle.id, b.paidById) : me;
  if (!payer) return { status: 403, json: { ok: false, error: 'That person is not in this family' } };
  let receipt = null;
  if (b.receiptDocId) {
    if (!isUuid(b.receiptDocId)) return { status: 400, json: { ok: false, error: 'That receipt could not be found' } };
    // Only a document the caller can already open may be attached.
    const d = await sql`select d.id from vault_docs d left join vault_access a on a.doc_id = d.id and a.member_id = ${me.id}
                        where d.id = ${b.receiptDocId} and d.circle_id = ${circle.id}
                          and (d.about_member = ${me.id} or d.by_member = ${me.id} or a.member_id is not null)`;
    if (!d[0]) return { status: 403, json: { ok: false, error: 'That receipt is not one you can open' } };
    receipt = d[0].id;
  }
  const day = dayOf(b.spentOn, b.tz);
  const r = await sql`insert into care_expenses (circle_id, amount, currency, category, for_member, paid_by, spent_on, note, receipt_doc_id, bill_id, staff_id, created_by)
                      values (${circle.id}, ${amount}, ${cur}, ${cat}, ${forM ? forM.id : null}, ${payer.id}, ${day}, ${clip(b.note, 140)},
                              ${receipt}, ${isUuid(b.billId) ? b.billId : null}, ${isUuid(b.staffId) ? b.staffId : null}, ${me.id})
                      on conflict (bill_id) do nothing returning id`;
  if (!r[0]) return { status: 200, json: { ok: true, already: true } };
  await sql`insert into events (circle_id, member_id, type, text)
            values (${circle.id}, ${me.id}, 'care', ${me.name + ' noted ' + money(amount, cur) + ' for ' + cat + (forM ? ' for ' + forM.name : '') + (payer.id !== me.id ? ', paid by ' + payer.name : '')})`;
  return { status: 201, json: { ok: true, id: r[0].id } };
}

// The month's picture, per currency: total, per payer, per category, and
// against the agreed split, how far each person is from their share.
export function monthSummary(rows, split, names) {
  const byCur = {};
  for (const e of rows) {
    const c = e.currency, a = Number(e.amount) || 0;
    const t = byCur[c] || (byCur[c] = { currency: c, total: 0, payers: {}, cats: {} });
    t.total += a;
    if (e.paid_by) t.payers[e.paid_by] = (t.payers[e.paid_by] || 0) + a;
    t.cats[e.category] = (t.cats[e.category] || 0) + a;
  }
  const shares = split && split.mode !== 'none' ? split.shares || {} : null;
  const weights = shares ? Object.keys(shares).filter(k => Number(shares[k]) > 0) : [];
  const W = weights.reduce((s, k) => s + Number(shares[k]), 0);
  return Object.values(byCur).map(t => {
    const round = (x) => Math.round(x * 100) / 100;
    const out = {
      currency: t.currency, total: round(t.total),
      byPayer: Object.keys(t.payers).map(id => ({ memberId: id, name: names[id] || 'Someone', amount: round(t.payers[id]) })).sort((a, b) => b.amount - a.amount),
      byCategory: Object.keys(t.cats).map(k => ({ category: k, amount: round(t.cats[k]) })).sort((a, b) => b.amount - a.amount),
      balance: []
    };
    if (W > 0) {
      const ids = new Set(weights.concat(Object.keys(t.payers)));
      for (const id of ids) {
        const share = weights.includes(id) ? t.total * Number(shares[id]) / W : 0;
        const diff = round((t.payers[id] || 0) - share);
        const nm = names[id] || 'Someone';
        out.balance.push({ memberId: id, name: nm, share: round(share), paid: round(t.payers[id] || 0), diff,
          line: Math.abs(diff) < 1 ? nm + ' has paid their share' : nm + ' has paid ' + money(Math.abs(diff), t.currency) + (diff > 0 ? ' more' : ' less') + ' than their share' });
      }
      out.balance.sort((a, b) => b.diff - a.diff);
    }
    return out;
  });
}

const BILL_CAT = { MAID_SALARY: 'staff', COOK_SALARY: 'staff', MEDICINE_DELIVERY: 'medicines' };

export async function expensesApi(req, res) {
  let sql;
  try { sql = db(); await ensureExpenseSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
      const month = monthOf(q.month, reqTz(req));
      const rows = await sql`
        select e.id, e.amount, e.currency, e.category, e.for_member, f.name as for_name, e.paid_by, p.name as paid_name,
               e.spent_on::text as spent_on, e.note, e.receipt_doc_id, e.bill_id, e.staff_id, e.created_by, e.created_at
        from care_expenses e
        left join members f on f.id = e.for_member
        left join members p on p.id = e.paid_by
        where e.circle_id = ${g.circle.id} and e.spent_on between ${month + '-01'} and ${monthEnd(month)}
        order by e.spent_on desc, e.created_at desc`;
      const sp = await sql`select mode, shares from care_split where circle_id = ${g.circle.id}`;
      const split = sp[0] ? { mode: sp[0].mode, shares: sp[0].shares || {} } : { mode: 'none', shares: {} };
      const mem = await sql`select id, name from members where circle_id = ${g.circle.id}`;
      const names = {}; mem.forEach(m => { names[m.id] = m.name; });
      // Settled bills not yet in the record: one tap each.
      const bills = await sql`
        select b.id, b.biller_name, b.amount_due, b.bill_category, b.settled_at, b.settled_by, s.name as settled_name, c.country
        from care_bills b left join members s on s.id = b.settled_by left join members c on c.id = b.created_by
        where b.circle_id = ${g.circle.id} and b.payment_status = 'SETTLED'
          and not exists (select 1 from care_expenses x where x.bill_id = b.id)
        order by b.settled_at desc nulls last limit 10`;
      return res.status(200).json({ ok: true, month, expenses: rows, split, summary: monthSummary(rows, split, names),
        settledBills: bills.map(b => ({ id: b.id, biller_name: b.biller_name, amount: Number(b.amount_due), currency: currencyOf(b.country) || 'INR',
          category: BILL_CAT[b.bill_category] || 'bills', settled_at: b.settled_at, settled_name: b.settled_name })),
        categories: EXPENSE_CATS, currencies: EXPENSE_CURS });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    const b = req.body || {};
    const g = await requireMember(sql, b.code, b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;

    if (b.action === 'expense_add') {
      const out = await addExpense(sql, circle, me, { ...b, billId: null, staffId: null, tz: reqTz(req) });
      return res.status(out.status).json(out.json);
    }
    if (b.action === 'expense_from_bill') {
      if (!isUuid(b.billId)) return res.status(400).json({ ok: false, error: 'That bill could not be found' });
      const r = await sql`select b.*, c.country from care_bills b left join members c on c.id = b.created_by
                          where b.id = ${b.billId} and b.circle_id = ${circle.id}`;
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That bill is not in this family' });
      if (r[0].payment_status !== 'SETTLED') return res.status(400).json({ ok: false, error: 'Mark the bill paid first' });
      const day = r[0].settled_at ? new Date(r[0].settled_at).toISOString().slice(0, 10) : null;
      const out = await addExpense(sql, circle, me, {
        amount: r[0].amount_due, currency: currencyOf(r[0].country) || 'INR', allowAnyCurrency: true,
        category: BILL_CAT[r[0].bill_category] || 'bills', forMemberId: r[0].person_id, paidById: r[0].settled_by || me.id,
        spentOn: day, note: r[0].biller_name, billId: r[0].id, tz: reqTz(req) });
      return res.status(out.status).json(out.json);
    }
    if (b.action === 'expense_remove') {
      if (!isUuid(b.id)) return res.status(400).json({ ok: false, error: 'That entry could not be found' });
      const r = await sql`select id, created_by, paid_by from care_expenses where id = ${b.id} and circle_id = ${circle.id}`;
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That entry is not here any more' });
      if (r[0].created_by !== me.id && r[0].paid_by !== me.id) return res.status(403).json({ ok: false, error: 'Only the person who wrote it or who paid can remove it' });
      await sql`delete from care_expenses where id = ${r[0].id}`;
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'split_set') {
      const mode = ['none', 'equal', 'shares'].includes(b.mode) ? b.mode : null;
      if (!mode) return res.status(400).json({ ok: false, error: 'Pick how the family shares costs' });
      const mem = await sql`select id from members where circle_id = ${circle.id}`;
      const ids = new Set(mem.map(m => m.id));
      const shares = {};
      const src = b.shares && typeof b.shares === 'object' ? b.shares : {};
      for (const k of Object.keys(src)) {
        if (!ids.has(k)) return res.status(403).json({ ok: false, error: 'That person is not in this family' });
        const w = mode === 'equal' ? (src[k] ? 1 : 0) : Math.round(Number(src[k]) * 100) / 100;
        if (!(w >= 0) || w > 100) return res.status(400).json({ ok: false, error: 'A share is a number from 0 to 100' });
        if (w > 0) shares[k] = w;
      }
      if (mode !== 'none' && !Object.keys(shares).length) return res.status(400).json({ ok: false, error: 'Choose at least one person to share with' });
      await sql`insert into care_split (circle_id, mode, shares, updated_by, updated_at)
                values (${circle.id}, ${mode}, ${JSON.stringify(mode === 'none' ? {} : shares)}::jsonb, ${me.id}, now())
                on conflict (circle_id) do update set mode = excluded.mode, shares = excluded.shares, updated_by = excluded.updated_by, updated_at = now()`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + (mode === 'none' ? ' turned off the shared split for care costs' : ' set how the family shares care costs')})`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown expense action' });
  } catch (e) { return fail(res, e); }
}
