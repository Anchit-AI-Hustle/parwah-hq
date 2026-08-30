// FAMILY MEMORY — the structured, permissioned knowledge Parwah keeps for
// the family, organised around people: contacts (housework, doctors, vets,
// emergency), addresses, the meds-map, health facts (blood group, allergies,
// preferences), and insurance. WhatsApp is where the family talks; this is
// where the family KNOWS.
//
// Every entry can be ABOUT a specific person (about_member) or the whole
// family, carries who wrote and last touched it, and — critically — a
// last_verified_at: freshness is a first-class feature, and stale entries
// are surfaced, never silently assumed current.
//
// GET  /api/book?circle=CODE&member=UUID → { ok, entries[], prep[] }
//   prep = per-person information-readiness (NOT a medical score): which of
//   doctor / meds / allergies / blood group / emergency contact / insurance
//   are recorded, missing, or due a re-check.
// POST /api/book {code, memberId, action:'add'|'update'|'remove'|'verify'}
import { db, ensureSchema, circleByCode, isUuid, normPhone, phoneError } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import boardApi from './_boardapi.mjs';
import vaultApi from './_vaultapi.mjs';

const KINDS = ['contact', 'address', 'med', 'fact', 'insurance'];
const CATS = ['housework', 'doctor', 'vet', 'driver', 'shops', 'repairs', 'emergency', 'other'];
const FACTCATS = ['blood', 'allergy', 'preference', 'other'];
const STALE_DAYS = 180; // meds/insurance/facts older than this ask to be re-checked

function clean(v, max) { const s = String(v || '').trim().slice(0, max); return s || null; }

export default async function handler(req, res) {
  // The drawing board and the family vault ride along on this function: the
  // plan allows 12 serverless functions, so related surfaces share a route.
  const area = String((req.query && req.query.area) || (req.body && req.body.area) || '');
  if (area === 'board') return boardApi(req, res);
  if (area === 'vault' || area === 'pay') return vaultApi(req, res);
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
    await sql`alter table family_book add column if not exists about_member uuid references members(id) on delete cascade`;
    await sql`alter table family_book add column if not exists last_verified_at timestamptz not null default now()`;
    await sql`alter table family_book add column if not exists updated_by uuid references members(id) on delete set null`;
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
               b.about_member, b.last_verified_at, b.created_at, b.updated_at,
               m.name as by_name, am.name as about_name, um.name as updated_by_name
        from family_book b
        left join members m on m.id = b.by_member
        left join members am on am.id = b.about_member
        left join members um on um.id = b.updated_by
        where b.circle_id = ${circle.id}
        order by b.kind, lower(b.name) limit 500`;
      const members = await sql`select id, name, relation from members where circle_id = ${circle.id} order by created_at`;
      const staleBefore = Date.now() - STALE_DAYS * 86400000;
      const isStale = (e) => new Date(e.last_verified_at).getTime() < staleBefore;
      // Preparedness: information readiness per person — never a medical score.
      const prep = members.map(mm => {
        const mine = entries.filter(e => e.about_member === mm.id);
        const chk = (pred) => {
          const hits = mine.filter(pred);
          if (!hits.length) return 'missing';
          return hits.some(e => !isStale(e)) ? 'ok' : 'verify';
        };
        const items = {
          doctor: chk(e => e.kind === 'contact' && e.category === 'doctor'),
          meds: chk(e => e.kind === 'med'),
          allergies: chk(e => e.kind === 'fact' && e.category === 'allergy'),
          blood: chk(e => e.kind === 'fact' && e.category === 'blood'),
          emergency: chk(e => e.kind === 'contact' && e.category === 'emergency'),
          insurance: chk(e => e.kind === 'insurance')
        };
        const keys = Object.keys(items);
        const okN = keys.filter(k => items[k] === 'ok').length;
        const attention = keys.filter(k => items[k] !== 'ok').length;
        return { memberId: mm.id, name: mm.name, relation: mm.relation,
                 pct: Math.round(okN / keys.length * 100), attention, items };
      });
      return res.status(200).json({ ok: true, entries, prep, staleDays: STALE_DAYS });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    if (body.action === 'verify') {
      if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: 'Bad entry id' });
      const ex = await sql`select id, name from family_book where id = ${body.id} and circle_id = ${circle.id}`;
      if (!ex[0]) return res.status(404).json({ ok: false, error: 'Entry not found' });
      await sql`update family_book set last_verified_at = now(), updated_by = ${me.id} where id = ${ex[0].id}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' checked that "' + ex[0].name + '" is still current ✅'})`;
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'add' || body.action === 'update') {
      const kind = KINDS.includes(body.kind) ? body.kind : null;
      const name = clean(body.name, 80);
      if (!kind) return res.status(400).json({ ok: false, error: 'Pick what kind of entry this is' });
      if (!name) return res.status(400).json({ ok: false, error: 'Give the entry a name' });
      const category = kind === 'contact' ? (CATS.includes(body.category) ? body.category : 'other')
                     : kind === 'fact' ? (FACTCATS.includes(body.category) ? body.category : 'other')
                     : null;
      let about = null;
      if (body.aboutId !== undefined && body.aboutId !== '' && body.aboutId !== null) {
        if (!isUuid(body.aboutId)) return res.status(400).json({ ok: false, error: 'Bad person' });
        const aRow = await sql`select id from members where id = ${body.aboutId} and circle_id = ${circle.id}`;
        if (!aRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
        about = aRow[0].id;
      }
      let phone = clean(body.phone, 20);
      if (phone) {
        const pp = normPhone(phone, body.phoneCc);
        if (!pp) return res.status(400).json({ ok: false, error: phoneError(body.phoneCc) });
        phone = pp.e164;
      }
      const address = clean(body.address, 300);
      const forwhat = clean(body.forwhat, 160);
      const notes = clean(body.notes, 300);

      if (body.action === 'add') {
        const r = await sql`insert into family_book (circle_id, kind, name, category, phone, address, forwhat, notes, by_member, about_member, updated_by)
                            values (${circle.id}, ${kind}, ${name}, ${category}, ${phone}, ${address}, ${forwhat}, ${notes}, ${me.id}, ${about}, ${me.id})
                            returning id`;
        const label = kind === 'contact' ? '☎️' : kind === 'address' ? '📍' : kind === 'med' ? '💊' : kind === 'fact' ? '🩸' : '🛡';
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${me.id}, 'care', ${me.name + ' added ' + name + ' to the family memory ' + label})`;
        // information recorded ABOUT someone is that person's business first
        if (about && about !== me.id) {
          await pushCircle(sql, circle.id, { title: '📒 ' + me.name + ' noted something about you', body: label + ' ' + name + ' — open Family memory to check it is right' }, { only: about });
        }
        return res.status(201).json({ ok: true, id: r[0].id });
      }
      if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: 'Bad entry id' });
      const ex = await sql`select id from family_book where id = ${body.id} and circle_id = ${circle.id}`;
      if (!ex[0]) return res.status(404).json({ ok: false, error: 'Entry not found' });
      // editing an entry re-verifies it: someone just looked and confirmed
      await sql`update family_book set kind = ${kind}, name = ${name}, category = ${category}, phone = ${phone},
                address = ${address}, forwhat = ${forwhat}, notes = ${notes}, about_member = ${about},
                updated_at = now(), last_verified_at = now(), updated_by = ${me.id}
                where id = ${ex[0].id}`;
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'remove') {
      if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: 'Bad entry id' });
      const ex = await sql`select id, name from family_book where id = ${body.id} and circle_id = ${circle.id}`;
      if (!ex[0]) return res.status(404).json({ ok: false, error: 'Entry not found' });
      await sql`delete from family_book where id = ${ex[0].id}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' removed ' + ex[0].name + ' from the family memory'})`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
