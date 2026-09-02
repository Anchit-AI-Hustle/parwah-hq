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
import { db, ensureSchema, circleByCode, isUuid, normPhone, phoneError, requireMember, serverError, writeGate, TOO_FAST } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import boardApi from './_boardapi.mjs';
import vaultApi from './_vaultapi.mjs';
import { award } from './_coins.mjs';

const KINDS = ['contact', 'address', 'med', 'fact', 'insurance'];
const CATS = ['housework', 'doctor', 'vet', 'driver', 'shops', 'repairs', 'emergency', 'local', 'other'];
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
    await ensureBookSchema(sql);
  } catch (e) { return serverError(res, e, 'book/schema'); }
  return bookHandler(req, res, sql);
}

// The memory tables, in one exported place: Care reads the same rows to work
// out what the family has not recorded yet, and a table that only exists once
// somebody has opened Memory is a table that silently breaks that screen.
export async function ensureBookSchema(sql) {
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
    // Consent, per entry. Default 'circle' keeps a plumber's number shared
    // with everyone; 'private' means only the person it is about, whoever
    // wrote it, and the people they have named one at a time.
    await sql`alter table family_book add column if not exists visibility text not null default 'circle'`;
    await sql`create table if not exists book_access (
      entry_id uuid not null references family_book(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      granted_by uuid references members(id) on delete set null,
      granted_at timestamptz not null default now(),
      primary key (entry_id, member_id)
    )`;
    // The ledger the subject of an entry can read: every change to who may
    // see something about them, and who made it.
    await sql`create table if not exists book_consent (
      id uuid primary key default gen_random_uuid(),
      entry_id uuid references family_book(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid references members(id) on delete set null,
      action text not null,
      at timestamptz not null default now()
    )`;
    await sql`create index if not exists book_consent_entry on book_consent (entry_id, at desc)`;
}

async function bookHandler(req, res, sql) {
  try {
    const q = req.query || {};
    const body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const g = await requireMember(sql, code, memberId);
    if (g.error) return res.status(g.status).json({ ok: false, error: g.error });
    const circle = g.circle, me = g.me;
    if (req.method === 'POST') {
      const allowed = await writeGate(sql, 'book', memberId, 60, 60);
      if (!allowed) return res.status(429).json({ ok: false, error: TOO_FAST });
    }

    if (req.method === 'GET') {
      // Everything in this circle, each row marked with whether the caller
      // may actually read it. Private rows are stripped below rather than
      // filtered out of the count, so preparedness stays truthful without
      // leaking what is inside.
      const all = await sql`
        select b.id, b.kind, b.name, b.category, b.phone, b.address, b.forwhat, b.notes,
               b.about_member, b.by_member, b.visibility, b.last_verified_at, b.created_at, b.updated_at,
               m.name as by_name, am.name as about_name, um.name as updated_by_name,
               (b.visibility = 'circle' or b.about_member = ${memberId} or b.by_member = ${memberId}
                or ba.member_id is not null) as can_see
        from family_book b
        left join members m on m.id = b.by_member
        left join members am on am.id = b.about_member
        left join members um on um.id = b.updated_by
        left join book_access ba on ba.entry_id = b.id and ba.member_id = ${memberId}
        where b.circle_id = ${circle.id}
        order by b.kind, lower(b.name) limit 500`;
      const entries = all.filter(e => e.can_see).map(e => {
        const { can_see, ...rest } = e; return rest;
      });
      // Who the caller has shared their own entries with, and the ledger of
      // every consent change on anything recorded about them.
      const mineIds = all.filter(e => e.about_member === memberId).map(e => e.id);
      const access = mineIds.length
        ? await sql`select ba.entry_id, ba.member_id, m.name
                    from book_access ba join members m on m.id = ba.member_id
                    where ba.entry_id = any(${mineIds}::uuid[])`
        : [];
      const consent = mineIds.length
        ? await sql`select c.entry_id, c.action, c.at, m.name
                    from book_consent c left join members m on m.id = c.member_id
                    where c.entry_id = any(${mineIds}::uuid[]) order by c.at desc limit 60`
        : [];
      const members = await sql`select id, name, relation from members where circle_id = ${circle.id} order by created_at`;
      const staleBefore = Date.now() - STALE_DAYS * 86400000;
      const isStale = (e) => new Date(e.last_verified_at).getTime() < staleBefore;
      // Preparedness: information readiness per person — never a medical score.
      const prep = members.map(mm => {
        // Deliberately computed over every entry, not only the readable ones:
        // the family should know Papa HAS recorded his medicines even when
        // he has kept what they are to himself.
        const mine = all.filter(e => e.about_member === mm.id);
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
          insurance: chk(e => e.kind === 'insurance'),
          // Somebody NEAR this person, for the hours you cannot reach them.
          local: chk(e => e.kind === 'contact' && e.category === 'local')
        };
        const keys = Object.keys(items);
        const okN = keys.filter(k => items[k] === 'ok').length;
        const attention = keys.filter(k => items[k] !== 'ok').length;
        return { memberId: mm.id, name: mm.name, relation: mm.relation,
                 pct: Math.round(okN / keys.length * 100), attention, items };
      });
      // Screen 2's "Records" row: what documents exist for each person that
      // the caller is allowed to know about. Counts and labels only — never
      // the documents themselves, which stay behind the vault's permissions.
      let records = [];
      try {
        records = await sql`
          select d.about_member, d.kind, d.label, d.expires_on, d.status,
                 (d.file_name is not null) as has_file
          from vault_docs d
          left join vault_access va on va.doc_id = d.id and va.member_id = ${memberId}
          where d.circle_id = ${circle.id}
            and (d.about_member = ${memberId} or d.by_member = ${memberId} or va.member_id is not null)
          order by d.kind limit 200`;
      } catch (e) { records = []; }

      // A family-level readiness figure, and the specific things behind it.
      // Deliberately one number: "78% ready" is a question a family can act
      // on, where six separate per-person bars are a report nobody reads.
      const LABEL = {
        doctor: 'doctor recorded', meds: 'medicine list', allergies: 'allergies noted',
        blood: 'blood group', emergency: 'emergency contact', insurance: 'insurance details',
        local: 'someone near them to call'
      };
      let ok = 0, total = 0;
      const gaps = [];
      prep.forEach(pp => {
        Object.keys(pp.items).forEach(k => {
          total++;
          if (pp.items[k] === 'ok') { ok++; return; }
          gaps.push({ memberId: pp.memberId, name: pp.name, key: k,
                      label: LABEL[k] || k, state: pp.items[k] });
        });
      });
      // Missing beats stale: an absent blood group is worse than one nobody
      // has re-checked this year.
      gaps.sort((a, b) => (a.state === 'missing' ? 0 : 1) - (b.state === 'missing' ? 0 : 1));
      const family = { pct: total ? Math.round(ok / total * 100) : 0,
                       ready: ok, total, gaps: gaps.slice(0, 12), gapCount: gaps.length };
      return res.status(200).json({ ok: true, entries, prep, family, records, access, consent, staleDays: STALE_DAYS });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    // Consent lives with the person a thing is about — not with whoever
    // happened to type it in, and not with an admin, because there isn't one.
    async function subjectOf(id) {
      if (!isUuid(id)) return { err: 'Bad entry id' };
      const r = await sql`select id, name, about_member, by_member, visibility from family_book
                          where id = ${id} and circle_id = ${circle.id}`;
      if (!r[0]) return { err: 'Entry not found' };
      const owner = r[0].about_member || r[0].by_member;
      if (owner !== me.id) {
        return { err: r[0].about_member
          ? 'Only the person this is about can decide who sees it'
          : 'Only whoever added this can decide who sees it' };
      }
      return { e: r[0] };
    }

    if (body.action === 'visibility') {
      const found = await subjectOf(body.id);
      if (found.err) return res.status(403).json({ ok: false, error: found.err });
      const vis = body.visibility === 'private' ? 'private' : 'circle';
      await sql`update family_book set visibility = ${vis}, updated_at = now() where id = ${found.e.id}`;
      await sql`insert into book_consent (entry_id, circle_id, member_id, action)
                values (${found.e.id}, ${circle.id}, ${me.id}, ${vis === 'private'
                  ? 'made it private' : 'shared it with the whole circle'})`;
      return res.status(200).json({ ok: true, visibility: vis });
    }

    if (body.action === 'share' || body.action === 'unshare') {
      const found = await subjectOf(body.id);
      if (found.err) return res.status(403).json({ ok: false, error: found.err });
      if (!isUuid(body.memberId)) return res.status(400).json({ ok: false, error: 'Pick a family member' });
      const t = await sql`select id, name from members where id = ${body.memberId} and circle_id = ${circle.id}`;
      if (!t[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
      if (t[0].id === me.id) return res.status(400).json({ ok: false, error: 'It is already yours' });
      if (body.action === 'unshare') {
        await sql`delete from book_access where entry_id = ${found.e.id} and member_id = ${t[0].id}`;
        await sql`insert into book_consent (entry_id, circle_id, member_id, action)
                  values (${found.e.id}, ${circle.id}, ${me.id}, ${'took access back from ' + t[0].name})`;
        return res.status(200).json({ ok: true });
      }
      await sql`insert into book_access (entry_id, member_id, granted_by)
                values (${found.e.id}, ${t[0].id}, ${me.id})
                on conflict (entry_id, member_id) do nothing`;
      await sql`insert into book_consent (entry_id, circle_id, member_id, action)
                values (${found.e.id}, ${circle.id}, ${me.id}, ${'shared it with ' + t[0].name})`;
      await pushCircle(sql, circle.id, {
        title: '📒 ' + me.name + ' shared something with you',
        body: found.e.name + ' — open Family memory to see it'
      }, { only: t[0].id });
      return res.status(200).json({ ok: true });
    }

    // Reading, editing and verifying all require the caller to be allowed to
    // see the entry in the first place.
    async function readable(id) {
      if (!isUuid(id)) return { err: 'Bad entry id' };
      const r = await sql`
        select b.id, b.name, b.about_member, b.by_member, b.visibility,
               (b.visibility = 'circle' or b.about_member = ${me.id} or b.by_member = ${me.id}
                or ba.member_id is not null) as can_see
        from family_book b
        left join book_access ba on ba.entry_id = b.id and ba.member_id = ${me.id}
        where b.id = ${id} and b.circle_id = ${circle.id}`;
      if (!r[0]) return { err: 'Entry not found' };
      if (!r[0].can_see) return { err: 'That is not shared with you' };
      return { e: r[0] };
    }

    if (body.action === 'verify') {
      const rd = await readable(body.id);
      if (rd.err) return res.status(rd.err === 'Entry not found' ? 404 : 403).json({ ok: false, error: rd.err });
      const ex = [rd.e];
      await sql`update family_book set last_verified_at = now(), updated_by = ${me.id} where id = ${ex[0].id}`;
      // Freshness is the whole point of the memory — pay for it, once a month per entry.
      await award(sql, circle.id, me.id, 'memory_ok', ex[0].id + ':' + new Date().toISOString().slice(0, 7));
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

      const vis = body.visibility === 'private' ? 'private' : 'circle';
      if (body.action === 'add') {
        const r = await sql`insert into family_book (circle_id, kind, name, category, phone, address, forwhat, notes, by_member, about_member, updated_by, visibility)
                            values (${circle.id}, ${kind}, ${name}, ${category}, ${phone}, ${address}, ${forwhat}, ${notes}, ${me.id}, ${about}, ${me.id}, ${vis})
                            returning id`;
        const label = kind === 'contact' ? '☎️' : kind === 'address' ? '📍' : kind === 'med' ? '💊' : kind === 'fact' ? '🩸' : '🛡';
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${me.id}, 'care', ${me.name + ' added ' + name + ' to the family memory ' + label})`;
        // information recorded ABOUT someone is that person's business first
        if (about && about !== me.id) {
          await pushCircle(sql, circle.id, { title: '📒 ' + me.name + ' noted something about you', body: label + ' ' + name + ' — open Family memory to check it is right' }, { only: about });
        }
        await award(sql, circle.id, me.id, 'memory_add', r[0].id);
        return res.status(201).json({ ok: true, id: r[0].id });
      }
      const rdU = await readable(body.id);
      if (rdU.err) return res.status(rdU.err === 'Entry not found' ? 404 : 403).json({ ok: false, error: rdU.err });
      const ex = [rdU.e];
      // editing an entry re-verifies it: someone just looked and confirmed
      await sql`update family_book set kind = ${kind}, name = ${name}, category = ${category}, phone = ${phone},
                address = ${address}, forwhat = ${forwhat}, notes = ${notes}, about_member = ${about},
                updated_at = now(), last_verified_at = now(), updated_by = ${me.id}
                where id = ${ex[0].id}`;
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'remove') {
      const rdR = await readable(body.id);
      if (rdR.err) return res.status(rdR.err === 'Entry not found' ? 404 : 403).json({ ok: false, error: rdR.err });
      const ex = [rdR.e];
      await sql`delete from family_book where id = ${ex[0].id}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' removed ' + ex[0].name + ' from the family memory'})`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return serverError(res, e, 'book');
  }
}
