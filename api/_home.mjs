// HOME: REPAIRS AND WARRANTIES ("Ghar ka saaman"). Behind
// /api/book?area=home (no new function: the project is at its cap).
//
// An appliance, a vehicle or a house paper: what it is, when and where it
// was bought, the warranty date, when its service is due, who to call (a
// contact from the Family book), the bill (a paper already in the Vault;
// nothing new is uploaded here), and "who fixed it last time". The family
// is reminded 30 and 7 days before a warranty runs out or a service is due,
// through the renewals sweep the timer already runs.
//
//   GET  /api/book?area=home&circle=CODE&member=ID  -> { items, kinds, who, contacts, docs, people }
//   POST /api/book {action: 'home_add' | 'home_update', id?, kind, title, boughtOn?, boughtWhere?, warrantyUntil?,
//                   serviceDue?, callContactId?, callText?, billDocId?, billNote?, fixedNote?, audience, people?}
//        {action: 'home_log', id, note, serviceDue?}     who fixed it last time
//        {action: 'home_remove', id}
//
// WHO SEES AN ENTRY IS SAID BY THE SQL (homeSeen below), with the same four
// choices as the Family Register: only me, people I choose, whole family,
// only in an emergency (the adults, while the person who wrote it has an
// SOS open). The contact and the bill are joined only if this viewer may
// already read that contact and that paper. Reminders go only to people
// who may see the entry, and for "whole family" to the adults.
import { db, ensureSchema, requireMember, isUuid, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { ensureAudienceSchema, audienceFor, minorOf } from './_audience.mjs';
import { noteRisk } from './_notesapi.mjs';
import { registerSecretRisk } from './_register.mjs';
import { openSos } from './_ecard.mjs';
import { dayIn } from './_recur.mjs';
import { HOME_KINDS, HOME_KIND_ICON, HOME_WHO, HOME_MAX, HOME_SERVICE_OFFSET, homeClean, homeLogClean, homeStage, homePush } from './_needsrules.mjs';

const bad = (res, status, error) => res.status(status).json({ ok: false, error });
// A family's day is the India day: at 1am in Lucknow it is still
// yesterday in UTC, and "days left" must not be a day out.
const dayOf = (ms) => dayIn('Asia/Kolkata', ms);

let ready = false;
export async function ensureHomeSchema(sql) {
  if (ready) return;
  await ensureAudienceSchema(sql);
  // family_book, vault_docs and the alert-once table the renewals keep.
  const { ensureVaultSchema } = await import('./_vaultapi.mjs');
  await schemaOnce(() => ensureVaultSchema(sql));
  const { ensureRenewalSchema } = await import('./_renewals.mjs');
  await ensureRenewalSchema(sql);
  await schemaOnce(async () => {
    await sql`create table if not exists home_items (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      kind text not null check (kind in ('appliance', 'vehicle', 'house_doc')),
      title text not null,
      bought_on date, bought_where text,
      warranty_until date, service_due date,
      call_contact uuid references family_book(id) on delete set null,
      call_text text,
      bill_doc uuid references vault_docs(id) on delete set null,
      bill_note text,
      fixed_note text, fixed_at timestamptz, fixed_by uuid references members(id) on delete set null,
      audience text not null default 'IMMEDIATE' check (audience in ('ONLY_ME', 'NOMINEES_ONLY', 'IMMEDIATE', 'EMERGENCY_ONLY')),
      people uuid[] not null default '{}',
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
    await sql`create index if not exists home_items_circle on home_items (circle_id, kind)`;
  });
  ready = true;
}

// The entries this member may read, each with its contact and its bill
// only as far as this member may already read those.
async function homeSeen(sql, circle, me, { id = null } = {}) {
  const sos = await openSos(sql, circle.id);
  return sql`
    select h.id, h.kind, h.title, h.bought_on::text as bought_on, h.bought_where, h.warranty_until::text as warranty_until, h.service_due::text as service_due,
           h.call_text, h.bill_note, h.fixed_note, h.fixed_at, fx.name as fixed_by_name, h.audience, h.people, h.created_by, cb.name as created_by_name, h.updated_at,
           (h.call_contact is not null) as has_contact, fb.id as contact_id, fb.name as contact_name, fb.phone as contact_phone,
           (h.bill_doc is not null) as has_bill, d.id as bill_id, d.label as bill_label
    from home_items h
    join members v on v.id = ${me.id} and v.circle_id = h.circle_id
    left join members cb on cb.id = h.created_by
    left join members fx on fx.id = h.fixed_by
    left join family_book fb on fb.id = h.call_contact and fb.circle_id = h.circle_id
      and (fb.visibility = 'circle' or fb.by_member = v.id or fb.about_member = v.id
           or exists (select 1 from book_access ba where ba.entry_id = fb.id and ba.member_id = v.id))
    left join vault_docs d on d.id = h.bill_doc and d.circle_id = h.circle_id
      and (d.about_member = v.id or (d.by_member = v.id and d.uploader_access)
           or exists (select 1 from vault_access va where va.doc_id = d.id and va.member_id = v.id))
    where h.circle_id = ${circle.id} and (${id}::uuid is null or h.id = ${id}::uuid)
      and (h.created_by = v.id
           or h.audience = 'IMMEDIATE'
           or (h.audience = 'NOMINEES_ONLY' and v.id = any(h.people))
           or (h.audience = 'EMERGENCY_ONLY' and h.created_by = any(${sos}::uuid[])
               and not (case when v.dob is not null then v.dob > current_date - interval '18 years' else (v.is_child or v.adult_confirmed is false) end)))
    order by h.kind, lower(h.title)`;
}
const shape = (r, me, today) => {
  const days = d => d ? Math.round((Date.parse(d) - Date.parse(today)) / 86400000) : null;
  return { id: r.id, kind: r.kind, icon: HOME_KIND_ICON[r.kind], title: r.title, boughtOn: r.bought_on, boughtWhere: r.bought_where,
    warrantyUntil: r.warranty_until, warrantyDays: days(r.warranty_until), serviceDue: r.service_due, serviceDays: days(r.service_due),
    // The contact and the bill: shown as far as this viewer may read them; otherwise only that there is one.
    contact: r.contact_id ? { id: r.contact_id, name: r.contact_name, phone: r.contact_phone || null } : null, contactKept: r.has_contact && !r.contact_id,
    callText: r.call_text, bill: r.bill_id ? { id: r.bill_id, label: r.bill_label } : null, billKept: r.has_bill && !r.bill_id, billNote: r.bill_note,
    fixedNote: r.fixed_note, fixedAt: r.fixed_at, fixedByName: r.fixed_by_name || null,
    audience: r.audience, people: r.created_by === me.id ? r.people : undefined, mine: r.created_by === me.id, byName: r.created_by_name || null };
};

async function stateFor(sql, circle, me, nowMs) {
  const meMinor = await minorOf(sql, circle.id, me.id);
  const rows = await homeSeen(sql, circle, me);
  const today = dayOf(nowMs);
  // What may be linked: contacts and papers this member can already read.
  const contacts = await sql`
    select fb.id, fb.name, fb.category from family_book fb
    where fb.circle_id = ${circle.id} and fb.kind = 'contact'
      and (fb.visibility = 'circle' or fb.by_member = ${me.id} or fb.about_member = ${me.id}
           or exists (select 1 from book_access ba where ba.entry_id = fb.id and ba.member_id = ${me.id}))
    order by lower(fb.name) limit 200`;
  const docs = meMinor ? [] : await sql`
    select d.id, d.label from vault_docs d
    where d.circle_id = ${circle.id}
      and (d.about_member = ${me.id} or (d.by_member = ${me.id} and d.uploader_access)
           or exists (select 1 from vault_access va where va.doc_id = d.id and va.member_id = ${me.id}))
    order by lower(d.label) limit 200`;
  const people = await sql`select id, name from members where circle_id = ${circle.id} and user_id is not null and not remembered and id <> ${me.id} order by created_at`;
  return { ok: true, items: rows.map(r => shape(r, me, today)), kinds: HOME_KINDS, who: HOME_WHO, canLog: !meMinor,
    contacts: contacts.map(c => ({ id: c.id, name: c.name })), docs: docs.map(d => ({ id: d.id, label: d.label })), people: people.map(p => ({ id: p.id, name: p.name })) };
}

export default async function homeApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureHomeSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, b = req.body || {};
    const get = req.method === 'GET';
    const g = await requireMember(sql, get ? q.circle : b.code, get ? q.member : b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me, nowMs = Date.now();
    if (get) return res.status(200).json(await stateFor(sql, circle, me, nowMs));
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    const done = async (status = 200) => res.status(status).json(await stateFor(sql, circle, me, Date.now()));
    const gone = 'That entry is not here any more';

    if (b.action === 'home_add' || b.action === 'home_update') {
      const c = homeClean(b);
      if (c.error) return bad(res, 400, c.error);
      const v = c.value;
      // Never a card number, a CVV, an OTP, a PIN or a password, in any box.
      for (const t of [v.title, v.boughtWhere, v.callText, v.billNote, v.fixedNote]) { const why = t && (noteRisk(t) || registerSecretRisk(t)); if (why) return bad(res, 400, why); }
      // People I choose: members of this family, on Parwah, who are with us.
      if (v.people.length) {
        if (!v.people.every(isUuid)) return bad(res, 400, 'Choose people in this family.');
        const okIds = (await sql`select id from members where circle_id = ${circle.id} and id = any(${v.people}::uuid[]) and user_id is not null and not remembered`).map(r => r.id);
        if (okIds.length !== v.people.length) return bad(res, 400, 'Choose people in this family who are on Parwah.');
      }
      // Who to call: a contact from the Family book that I can read.
      let contact = null;
      if (b.callContactId) {
        if (!isUuid(b.callContactId)) return bad(res, 400, 'Choose a contact from the Family book.');
        contact = (await sql`select fb.id from family_book fb where fb.id = ${b.callContactId} and fb.circle_id = ${circle.id} and fb.kind = 'contact'
                             and (fb.visibility = 'circle' or fb.by_member = ${me.id} or fb.about_member = ${me.id}
                                  or exists (select 1 from book_access ba where ba.entry_id = fb.id and ba.member_id = ${me.id}))`)[0];
        if (!contact) return bad(res, 400, 'Choose a contact from the Family book.');
      }
      // The bill: a paper already in the Vault that I can read. Nothing is uploaded here.
      let doc = null;
      if (b.billDocId) {
        if (!isUuid(b.billDocId)) return bad(res, 400, 'Choose a paper from the Vault.');
        doc = (await sql`select d.id from vault_docs d where d.id = ${b.billDocId} and d.circle_id = ${circle.id}
                         and (d.about_member = ${me.id} or (d.by_member = ${me.id} and d.uploader_access)
                              or exists (select 1 from vault_access va where va.doc_id = d.id and va.member_id = ${me.id}))`)[0];
        if (!doc) return bad(res, 400, 'Choose a paper from the Vault that you can open.');
      }
      if (b.action === 'home_add') {
        const n = (await sql`select count(*)::int as n from home_items where circle_id = ${circle.id}`)[0].n;
        if (n >= HOME_MAX.items) return bad(res, 400, 'This list is full. Remove an old entry first.');
        await sql`insert into home_items (circle_id, kind, title, bought_on, bought_where, warranty_until, service_due, call_contact, call_text, bill_doc, bill_note,
                                          fixed_note, fixed_at, fixed_by, audience, people, created_by)
                  values (${circle.id}, ${v.kind}, ${v.title}, ${v.boughtOn}, ${v.boughtWhere}, ${v.warrantyUntil}, ${v.serviceDue}, ${contact ? contact.id : null}, ${v.callText},
                          ${doc ? doc.id : null}, ${v.billNote}, ${v.fixedNote}, ${v.fixedNote ? new Date() : null}, ${v.fixedNote ? me.id : null}, ${v.audience}, ${v.people}::uuid[], ${me.id})`;
        return done(201);
      }
      if (!isUuid(b.id)) return bad(res, 404, gone);
      // Only whoever wrote it changes it. To anyone who may not see it, it does not exist.
      const row = (await homeSeen(sql, circle, me, { id: b.id }))[0];
      if (!row) return bad(res, 404, gone);
      if (row.created_by !== me.id) return bad(res, 403, 'Only ' + (row.created_by_name || 'the person who wrote it') + ' can change this. You can write down a repair.');
      await sql`update home_items set kind = ${v.kind}, title = ${v.title}, bought_on = ${v.boughtOn}, bought_where = ${v.boughtWhere}, warranty_until = ${v.warrantyUntil},
                  service_due = ${v.serviceDue}, call_contact = ${contact ? contact.id : null}, call_text = ${v.callText}, bill_doc = ${doc ? doc.id : null}, bill_note = ${v.billNote},
                  audience = ${v.audience}, people = ${v.people}::uuid[], updated_at = now()
                where id = ${row.id} and circle_id = ${circle.id}`;
      return done();
    }
    if (b.action === 'home_log' || b.action === 'home_remove') {
      if (!isUuid(b.id)) return bad(res, 404, gone);
      const row = (await homeSeen(sql, circle, me, { id: b.id }))[0];
      if (!row) return bad(res, 404, gone);
      if (b.action === 'home_remove') {
        if (row.created_by !== me.id) return bad(res, 403, 'Only ' + (row.created_by_name || 'the person who wrote it') + ' can remove this.');
        await sql`delete from home_items where id = ${row.id} and circle_id = ${circle.id}`;
        return done();
      }
      // "Who fixed it last time": any adult who may see the entry writes it down.
      if (await minorOf(sql, circle.id, me.id)) return bad(res, 403, 'An adult in the family writes down a repair.');
      const c = homeLogClean(b);
      if (c.error) return bad(res, 400, c.error);
      const why = noteRisk(c.value.note) || registerSecretRisk(c.value.note);
      if (why) return bad(res, 400, why);
      await sql`update home_items set fixed_note = ${c.value.note}, fixed_at = now(), fixed_by = ${me.id},
                  service_due = coalesce(${c.value.serviceDue}::date, service_due), updated_at = now()
                where id = ${row.id} and circle_id = ${circle.id}`;
      return done();
    }
    return bad(res, 400, 'Unknown action');
  } catch (e) { return fail(res, e); }
}

// THE TIMER'S SHARE, its own line in runTick (api/events.mjs), so an error
// here is written down by the timer and never hidden inside another
// sweep: 30 and 7 days before a warranty
// runs out or a service is due, once each, claimed in the same alert-once
// table the renewals use. Told only to people who may see the entry: the
// person who wrote it; the people they chose; for "whole family", the adults.
export async function sweepHome(sql, circleId, nowMs = Date.now()) {
  let n = 0;
  await ensureHomeSchema(sql);
  const today = dayOf(nowMs), until = dayOf(nowMs + 31 * 86400000);
  const rows = await sql`
    select h.id, h.title, h.audience, h.people, h.created_by, w.what, w.d::text as d
    from home_items h
    cross join lateral (values ('warranty', h.warranty_until), ('service', h.service_due)) as w(what, d)
    where h.circle_id = ${circleId} and w.d is not null and w.d between ${today}::date and ${until}::date`;
  for (const r of rows) {
    const days = Math.round((Date.parse(r.d) - Date.parse(today)) / 86400000), stage = homeStage(days);
    if (!stage) continue;
    const off = r.what === 'service' ? HOME_SERVICE_OFFSET : 0;
    const claim = await sql`insert into renewal_alerts (ref_id, stage, for_date) values (${r.id}, ${stage + off}, ${r.d}) on conflict do nothing returning stage`;
    if (!claim[0]) continue;
    // The 7-day reminder claims the 30-day one too: an entry added late is told once.
    if (stage === 7) await sql`insert into renewal_alerts (ref_id, stage, for_date) values (${r.id}, ${30 + off}, ${r.d}) on conflict do nothing`;
    let to = [];
    if (r.audience === 'IMMEDIATE') to = await audienceFor(sql, circleId, 'home_upkeep');
    else {
      const ids = [r.created_by, ...(r.audience === 'NOMINEES_ONLY' ? r.people : [])].filter(Boolean);
      to = ids.length ? await audienceFor(sql, circleId, 'home_upkeep', { only: ids }) : [];
    }
    for (const id of to) await pushCircle(sql, circleId, homePush(r.title, r.what, days), { only: id });
    if (to.length) n++;
  }
  return n;
}
