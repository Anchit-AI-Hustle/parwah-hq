// NOTES AND CHECKLISTS: the grocery list, the packing list for the trip,
// what to ask the doctor, the wifi password for Dadi's flat.
//
//   GET  /api/book?area=notes&circle=CODE&member=UUID   -> { ok, notes }
//   POST /api/book?area=notes {code, memberId, action, ...}
//        add          {title, body?, items?: [text], private?}
//        edit         {id, title?, body?}
//        item_add     {id, text}
//        item_toggle  {id, itemId, done}
//        item_remove  {id, itemId}
//        pin          {id, pinned}
//        remove       {id}
//
// A family note is the family's: anyone in it can tick, add to, change or
// remove it. A private note is only ever read or written by whoever wrote
// it - the query itself says so, not the screen. Each tick is one atomic
// change to one item, so two people ticking at the same moment never undo
// each other.
//
// Never for a card number, a CVV, an OTP or a banking PIN or password: a
// note is easy to share, which is the opposite of what those need. A phone
// number, a PIN code (postal) or the wifi password for Dadi's flat are
// fine - that is what notes are for.
import { randomUUID } from 'node:crypto';
import { db, ensureSchema, requireMember, isUuid } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';

export const NOTE_MAX = { title: 80, body: 2000, item: 120, items: 100, notes: 200 };
// A card number is 13 to 19 digits that pass the Luhn check; a phone number
// (10 digits, or 12 with 91) never does by accident often enough to matter,
// and is shorter anyway.
function luhn(d) {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
export function noteRisk(v) {
  const s = String(v || '');
  for (const m of s.match(/\d[\d -]{11,24}\d/g) || []) {
    const d = m.replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return 'That looks like a card number - Parwah never keeps those. Write only the last four digits.';
  }
  if (/\b(cvv|cvc|otp|upi ?pin|atm ?pin|card ?pin|m-?pin|net ?banking password|bank(ing)? password)\b/i.test(s)) {
    return 'Parwah never keeps a CVV, OTP or banking PIN or password - leave those out.';
  }
  return null;
}
const clip = (v, n) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, n);

let ready = false;
export async function ensureNotesSchema(sql) {
  if (ready) return;
  await sql`create table if not exists notes (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    title text not null,
    body text,
    items jsonb not null default '[]'::jsonb,
    private boolean not null default false,
    pinned boolean not null default false,
    updated_by uuid references members(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`create index if not exists notes_circle on notes (circle_id, updated_at desc)`;
  ready = true;
}

function itemsFrom(list) {
  return (Array.isArray(list) ? list : []).map(t => clip(t, NOTE_MAX.item)).filter(Boolean)
    .slice(0, NOTE_MAX.items).map(t => ({ id: randomUUID(), t, done: false }));
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureNotesSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const g = await requireMember(sql, code, memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;

    if (req.method === 'GET') {
      const notes = await sql`
        select n.id, n.title, n.body, n.items, n.private, n.pinned, n.created_at, n.updated_at, n.by_member,
               b.name as by_name, u.name as updated_name
        from notes n left join members b on b.id = n.by_member left join members u on u.id = n.updated_by
        where n.circle_id = ${circle.id} and (not n.private or n.by_member = ${me.id})
        order by n.pinned desc, n.updated_at desc limit ${NOTE_MAX.notes}`;
      return res.status(200).json({ ok: true, notes });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    const action = body.action;
    const risky = (...vs) => vs.map(v => noteRisk(v)).find(Boolean);

    if (action === 'add') {
      const title = clip(body.title, NOTE_MAX.title);
      if (!title) return res.status(400).json({ ok: false, error: 'Give the note a title, like Groceries.' });
      const text = clip(body.body, NOTE_MAX.body);
      const items = itemsFrom(body.items);
      const bad = risky(title, text, ...items.map(i => i.t));
      if (bad) return res.status(400).json({ ok: false, error: bad });
      const n = await sql`select count(*)::int as n from notes where circle_id = ${circle.id}`;
      if (n[0].n >= NOTE_MAX.notes) return res.status(400).json({ ok: false, error: 'That is a lot of notes - remove some old ones first.' });
      const r = await sql`insert into notes (circle_id, by_member, title, body, items, private, updated_by)
                          values (${circle.id}, ${me.id}, ${title}, ${text || null}, ${JSON.stringify(items)}::jsonb, ${!!body.private}, ${me.id})
                          returning id`;
      if (!body.private) {
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${me.id}, 'care', ${me.name + (items.length ? ' started a list: ' : ' wrote a note: ') + title})`;
      }
      return res.status(201).json({ ok: true, id: r[0].id });
    }

    // Everything else acts on one note this person may see.
    if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: 'Bad note' });
    const found = await sql`select id, by_member, private, items from notes
                            where id = ${body.id} and circle_id = ${circle.id} and (not private or by_member = ${me.id})`;
    const note = found[0];
    if (!note) return res.status(404).json({ ok: false, error: 'That note is not here any more' });

    if (action === 'edit') {
      const title = body.title !== undefined ? clip(body.title, NOTE_MAX.title) : null;
      if (body.title !== undefined && !title) return res.status(400).json({ ok: false, error: 'A note needs a title.' });
      const text = body.body !== undefined ? clip(body.body, NOTE_MAX.body) : null;
      const bad = risky(title, text);
      if (bad) return res.status(400).json({ ok: false, error: bad });
      await sql`update notes set title = coalesce(${title}, title),
                  body = case when ${body.body !== undefined}::boolean then ${text || null} else body end,
                  updated_at = now(), updated_by = ${me.id}
                where id = ${note.id}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'item_add') {
      const t = clip(body.text, NOTE_MAX.item);
      if (!t) return res.status(400).json({ ok: false, error: 'Write the item first.' });
      const bad = risky(t);
      if (bad) return res.status(400).json({ ok: false, error: bad });
      const item = { id: randomUUID(), t, done: false };
      const r = await sql`update notes set items = items || ${JSON.stringify([item])}::jsonb, updated_at = now(), updated_by = ${me.id}
                          where id = ${note.id} and jsonb_array_length(items) < ${NOTE_MAX.items} returning id`;
      if (!r[0]) return res.status(400).json({ ok: false, error: 'A list can have up to ' + NOTE_MAX.items + ' items.' });
      return res.status(201).json({ ok: true, itemId: item.id });
    }
    if (action === 'item_toggle' || action === 'item_remove') {
      if (!isUuid(body.itemId)) return res.status(400).json({ ok: false, error: 'Bad item' });
      const r = action === 'item_toggle'
        ? await sql`update notes set items = (
                      select coalesce(jsonb_agg(case when e->>'id' = ${body.itemId}
                        then e || jsonb_build_object('done', ${!!body.done}::boolean, 'by', ${me.name}::text) else e end order by o), '[]'::jsonb)
                      from jsonb_array_elements(items) with ordinality as x(e, o)),
                    updated_at = now(), updated_by = ${me.id}
                    where id = ${note.id} and items @> ${JSON.stringify([{ id: body.itemId }])}::jsonb returning id`
        : await sql`update notes set items = (
                      select coalesce(jsonb_agg(e order by o), '[]'::jsonb)
                      from jsonb_array_elements(items) with ordinality as x(e, o) where e->>'id' <> ${body.itemId}),
                    updated_at = now(), updated_by = ${me.id}
                    where id = ${note.id} and items @> ${JSON.stringify([{ id: body.itemId }])}::jsonb returning id`;
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That item is not on the list any more' });
      return res.status(200).json({ ok: true });
    }
    if (action === 'pin') {
      await sql`update notes set pinned = ${!!body.pinned} where id = ${note.id}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'remove') {
      await sql`delete from notes where id = ${note.id}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}
