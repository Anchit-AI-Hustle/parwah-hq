// The Family Book — the circle's shared little black book: contacts for
// housework and repairs, doctors and vets, saved addresses, and the
// meds-map (which dawai is for which problem, exactly as the doctor said).
// Every member is an equal admin: anyone can add, edit or remove entries.
// GET  /api/book?circle=CODE&member=UUID → { ok, entries[] }
// POST /api/book {code, memberId, action:'add'|'update'|'remove', ...}
import { db, ensureSchema, circleByCode, isUuid } from './_db.mjs';

const KINDS = ['contact', 'address', 'med'];
const CATS = ['housework', 'doctor', 'vet', 'driver', 'shops', 'repairs', 'other'];

function clean(v, max) { const s = String(v || '').trim().slice(0, max); return s || null; }

export default async function handler(req, res) {
  let sql;
  try {
    sql = db(); await ensureSchema(sql);
    await sql`create table if not exists family_book (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      kind text not null,
      name text not null,
      category text,
      phone text,
      address text,
      forwhat text,
      notes text,
      by_member uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
    await sql`create index if not exists family_book_circle on family_book (circle_id, kind, name)`;
  } catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  try {
    const q = req.query || {};
    const body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const circle = await circleByCode(sql, code);
    if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
    if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const meRow = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
    if (!meRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const me = meRow[0];

    if (req.method === 'GET') {
      const entries = await sql`
        select b.id, b.kind, b.name, b.category, b.phone, b.address, b.forwhat, b.notes,
               b.created_at, b.updated_at, m.name as by_name
        from family_book b left join members m on m.id = b.by_member
        where b.circle_id = ${circle.id}
        order by b.kind, lower(b.name) limit 500`;
      return res.status(200).json({ ok: true, entries });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    if (body.action === 'add' || body.action === 'update') {
      const kind = KINDS.includes(body.kind) ? body.kind : null;
      const name = clean(body.name, 80);
      if (!kind) return res.status(400).json({ ok: false, error: 'Pick what kind of entry this is' });
      if (!name) return res.status(400).json({ ok: false, error: 'Give the entry a name' });
      const category = kind === 'contact' ? (CATS.includes(body.category) ? body.category : 'other') : null;
      let phone = clean(body.phone, 20);
      if (phone && !/^[+()\-\s0-9]{7,20}$/.test(phone)) return res.status(400).json({ ok: false, error: 'That does not look like a phone number' });
      const address = clean(body.address, 300);
      const forwhat = clean(body.forwhat, 160);
      const notes = clean(body.notes, 300);

      if (body.action === 'add') {
        const r = await sql`insert into family_book (circle_id, kind, name, category, phone, address, forwhat, notes, by_member)
                            values (${circle.id}, ${kind}, ${name}, ${category}, ${phone}, ${address}, ${forwhat}, ${notes}, ${me.id})
                            returning id`;
        const label = kind === 'contact' ? '☎️' : kind === 'address' ? '📍' : '💊';
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${me.id}, 'care', ${me.name + ' added ' + name + ' to the family book ' + label})`;
        return res.status(201).json({ ok: true, id: r[0].id });
      }
      if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: 'Bad entry id' });
      const ex = await sql`select id from family_book where id = ${body.id} and circle_id = ${circle.id}`;
      if (!ex[0]) return res.status(404).json({ ok: false, error: 'Entry not found' });
      await sql`update family_book set kind = ${kind}, name = ${name}, category = ${category}, phone = ${phone},
                address = ${address}, forwhat = ${forwhat}, notes = ${notes}, updated_at = now()
                where id = ${ex[0].id}`;
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'remove') {
      if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: 'Bad entry id' });
      const ex = await sql`select id, name from family_book where id = ${body.id} and circle_id = ${circle.id}`;
      if (!ex[0]) return res.status(404).json({ ok: false, error: 'Entry not found' });
      await sql`delete from family_book where id = ${ex[0].id}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' removed ' + ex[0].name + ' from the family book'})`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
