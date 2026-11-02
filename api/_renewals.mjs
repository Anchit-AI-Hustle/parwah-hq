// RENEWAL RADAR.
//
// Every date that quietly runs out in a parent's life (health and vehicle
// insurance, driving licence, passport, property tax, an FD maturing, the
// gas connection's KYC) in one list, soonest first. The family is told 30
// days and 7 days ahead, once each, and one tap turns a renewal into a task
// for someone. Vault documents with an expiry date join the list on their
// own, for whoever may see them. Like the family book, each entry carries
// last_verified_at: an entry nobody has checked in six months says so.
//
//   GET  /api/care?area=renewals&circle=CODE&member=ID
//   POST /api/care {action: renewal_add | renewal_update | renewal_verify | renewal_remove | renewal_task}
import { db, requireMember, isUuid, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { reqTz } from './_recur.mjs';
import { createTask, ensureTaskSchema } from './_tasks.mjs';

export const RENEWAL_KINDS = {
  health_ins:   { label: 'Health insurance',   icon: '🛡' },
  vehicle_ins:  { label: 'Vehicle insurance',  icon: '🚗' },
  dl:           { label: 'Driving licence',    icon: '🪪' },
  passport:     { label: 'Passport',           icon: '🛂' },
  property_tax: { label: 'Property tax',       icon: '🏠' },
  fd:           { label: 'FD maturity',        icon: '🏦' },
  gas_kyc:      { label: 'Gas connection KYC', icon: '🔥' },
  other:        { label: 'Other',              icon: '📅' }
};
export const STAGES = [30, 7];
const STALE_DAYS = 180;

let ready = false;
export async function ensureRenewalSchema(sql) {
  if (ready) return;
  const { ensureCarePrepSchema } = await import('./_careprep.mjs');
  await ensureCarePrepSchema(sql);   // circles, members, family_book, vault_docs
  await ensureTaskSchema(sql);
  await schemaOnce(async () => {
    await sql`create table if not exists renewals (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      kind text not null default 'other',
      label text not null,
      about_member uuid references members(id) on delete set null,
      owner_member uuid references members(id) on delete set null,
      expires_on date not null,
      notes text,
      vault_doc_id uuid references vault_docs(id) on delete set null,
      book_entry_id uuid references family_book(id) on delete set null,
      task_id uuid,
      last_verified_at timestamptz not null default now(),
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now()
    )`;
    await sql`create index if not exists renewals_circle on renewals (circle_id, expires_on)`;
    // The alert-once claim, for renewals and vault documents alike: one row
    // per thing, per stage, per expiry date. A new date is a new cycle.
    await sql`create table if not exists renewal_alerts (
      ref_id uuid not null,
      stage integer not null,
      for_date date not null,
      at timestamptz not null default now(),
      primary key (ref_id, stage, for_date)
    )`;
  });
  ready = true;
}

const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n); return t || null; };
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(Date.parse(d));
const daysTo = (d, nowMs = Date.now()) => Math.round((Date.parse(String(d).slice(0, 10)) - Date.parse(new Date(nowMs).toISOString().slice(0, 10))) / 86400000);
// Which reminder is due for a date this many days away: 7, 30 or none.
export function stageFor(days) { return days < 0 ? null : days <= 7 ? 7 : days <= 30 ? 30 : null; }

async function memberIn(sql, circleId, id) {
  if (!isUuid(id)) return null;
  const r = await sql`select id, name, user_id is not null as on_app from members where id = ${id} and circle_id = ${circleId}`;
  return r[0] || null;
}

// The list, soonest first, from the caller's point of view.
async function listFor(sql, circleId, me) {
  const own = await sql`
    select r.id, r.kind, r.label, r.about_member, a.name as about_name, r.owner_member, o.name as owner_name,
           r.expires_on::text as expires_on, r.notes, r.vault_doc_id, r.task_id, r.last_verified_at,
           (t.id is not null and t.status in ('open','assigned','claimed')) as task_open, tc.name as task_name
    from renewals r
    left join members a on a.id = r.about_member
    left join members o on o.id = r.owner_member
    left join requests t on t.id = r.task_id
    left join members tc on tc.id = t.claimed_by
    where r.circle_id = ${circleId}`;
  // Vault papers with an expiry, only those this person may know exist.
  const vault = await sql`
    select d.id, d.kind, d.label, d.about_member, a.name as about_name, d.expires_on::text as expires_on, d.updated_at
    from vault_docs d join members a on a.id = d.about_member
    left join vault_access va on va.doc_id = d.id and va.member_id = ${me.id}
    where d.circle_id = ${circleId} and d.expires_on is not null
      and (d.about_member = ${me.id} or (d.by_member = ${me.id} and d.uploader_access) or va.member_id is not null)
      and not exists (select 1 from renewals r where r.vault_doc_id = d.id)`;
  const openTitles = new Set((await sql`select lower(title) as t from requests where circle_id = ${circleId} and status in ('open','assigned','claimed')`).map(x => x.t));
  const now = Date.now();
  const rows = own.map(r => ({ source: 'own', ...r, icon: (RENEWAL_KINDS[r.kind] || RENEWAL_KINDS.other).icon,
      kindLabel: (RENEWAL_KINDS[r.kind] || RENEWAL_KINDS.other).label, days: daysTo(r.expires_on),
      stale: new Date(r.last_verified_at).getTime() < now - STALE_DAYS * 86400000 }))
    .concat(vault.map(d => ({ source: 'vault', id: d.id, kind: d.kind, label: d.label, about_member: d.about_member, about_name: d.about_name,
      expires_on: d.expires_on, icon: '🔐', kindLabel: 'In the vault', days: daysTo(d.expires_on), last_verified_at: d.updated_at,
      stale: false, task_open: openTitles.has(('renew ' + d.label).toLowerCase()) })));
  return rows.sort((a, b) => a.expires_on < b.expires_on ? -1 : a.expires_on > b.expires_on ? 1 : 0);
}

export async function renewalsApi(req, res) {
  let sql;
  try { sql = db(); await ensureRenewalSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
      await sweepRenewals(sql, g.circle.id);
      return res.status(200).json({ ok: true, renewals: await listFor(sql, g.circle.id, g.me), kinds: RENEWAL_KINDS, staleDays: STALE_DAYS });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    const b = req.body || {};
    const g = await requireMember(sql, b.code, b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;

    if (b.action === 'renewal_add' || b.action === 'renewal_update') {
      const kind = Object.prototype.hasOwnProperty.call(RENEWAL_KINDS, b.kind) ? b.kind : 'other';
      const label = clip(b.label, 100) || (kind !== 'other' ? RENEWAL_KINDS[kind].label : null);
      if (!label) return res.status(400).json({ ok: false, error: 'Say what needs renewing' });
      if (!isDate(b.expiresOn)) return res.status(400).json({ ok: false, error: 'Pick the date it runs out from the calendar' });
      const about = b.aboutMemberId ? await memberIn(sql, circle.id, b.aboutMemberId) : null;
      if (b.aboutMemberId && !about) return res.status(403).json({ ok: false, error: 'That person is not in this family' });
      const owner = b.ownerId ? await memberIn(sql, circle.id, b.ownerId) : null;
      if (b.ownerId && !owner) return res.status(403).json({ ok: false, error: 'That person is not in this family' });
      if (b.action === 'renewal_add') {
        const r = await sql`insert into renewals (circle_id, kind, label, about_member, owner_member, expires_on, notes, created_by)
                            values (${circle.id}, ${kind}, ${label}, ${about ? about.id : null}, ${owner ? owner.id : null},
                                    ${b.expiresOn}, ${clip(b.notes, 200)}, ${me.id}) returning id`;
        return res.status(201).json({ ok: true, id: r[0].id });
      }
      if (!isUuid(b.id)) return res.status(400).json({ ok: false, error: 'That renewal could not be found' });
      // A new date is a checked date: renewing it is checking it.
      const r = await sql`update renewals set kind = ${kind}, label = ${label}, about_member = ${about ? about.id : null},
                          owner_member = ${owner ? owner.id : null}, expires_on = ${b.expiresOn}, notes = ${clip(b.notes, 200)},
                          last_verified_at = now() where id = ${b.id} and circle_id = ${circle.id} returning id`;
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That renewal is not here any more' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'renewal_verify') {
      if (!isUuid(b.id)) return res.status(400).json({ ok: false, error: 'That renewal could not be found' });
      const r = await sql`update renewals set last_verified_at = now() where id = ${b.id} and circle_id = ${circle.id} returning id`;
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That renewal is not here any more' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'renewal_remove') {
      if (!isUuid(b.id)) return res.status(400).json({ ok: false, error: 'That renewal could not be found' });
      const r = await sql`delete from renewals where id = ${b.id} and circle_id = ${circle.id} returning id`;
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That renewal is not here any more' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'renewal_task') {
      // One tap: "Renew <it>" as a task, due a week before it runs out (or
      // today, if that week has already begun), for whoever is picked.
      if (!isUuid(b.id)) return res.status(400).json({ ok: false, error: 'That renewal could not be found' });
      let item;
      if (b.source === 'vault') {
        const v = (await listFor(sql, circle.id, me)).find(x => x.source === 'vault' && x.id === b.id);
        if (!v) return res.status(404).json({ ok: false, error: 'That document is not one you can see' });
        item = { label: v.label, about: v.about_member, expires: v.expires_on };
      } else {
        const r = await sql`select * from renewals where id = ${b.id} and circle_id = ${circle.id}`;
        if (!r[0]) return res.status(404).json({ ok: false, error: 'That renewal is not here any more' });
        item = { id: r[0].id, label: r[0].label, about: r[0].about_member, expires: new Date(r[0].expires_on).toISOString().slice(0, 10) };
      }
      const today = new Date().toISOString().slice(0, 10);
      const week = new Date(Date.parse(item.expires) - 7 * 86400000).toISOString().slice(0, 10);
      const out = await createTask(sql, circle, me, { title: 'Renew ' + item.label, dueDate: week > today ? week : today,
        ownerId: b.ownerId || null, aboutMemberId: item.about || null, tz: reqTz(req) || 'Asia/Kolkata',
        doneWhen: 'Renewed, and the new date written in Renewals' });
      if (out.json.ok && item.id) await sql`update renewals set task_id = ${out.json.id}, owner_member = coalesce(${isUuid(b.ownerId) ? b.ownerId : null}, owner_member) where id = ${item.id}`;
      return res.status(out.status).json(out.json);
    }
    return res.status(400).json({ ok: false, error: 'Unknown renewal action' });
  } catch (e) { return fail(res, e); }
}

// 30 and 7 days ahead, once each per expiry date. A renewal tells its
// owner (or everyone, with no owner); a vault paper tells the person it is
// about and whoever added it, the people who can already see it.
export async function sweepRenewals(sql, circleId, nowMs = Date.now()) {
  let n = 0;
  try {
    await ensureRenewalSchema(sql);
    const items = (await sql`select id, label, owner_member, about_member, null::uuid as by_member, expires_on::text as d, 'own' as src
                             from renewals where circle_id = ${circleId} and expires_on between current_date and current_date + 31`)
      .concat(await sql`select id, label, null::uuid as owner_member, about_member, by_member, expires_on::text as d, 'vault' as src
                        from vault_docs where circle_id = ${circleId} and expires_on between current_date and current_date + 31`);
    for (const it of items) {
      const days = daysTo(it.d, nowMs), stage = stageFor(days);
      if (!stage) continue;
      // The 7-day alert claims the 30-day one too, so a renewal added late
      // is told about once, not twice in a row.
      const claim = await sql`insert into renewal_alerts (ref_id, stage, for_date) values (${it.id}, ${stage}, ${it.d})
                              on conflict do nothing returning stage`;
      if (!claim[0]) continue;
      if (stage === 7) await sql`insert into renewal_alerts (ref_id, stage, for_date) values (${it.id}, 30, ${it.d}) on conflict do nothing`;
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
      const payload = { title: '📅 ' + it.label + ' runs out ' + when, body: 'Open Renewals to make it a task for someone', url: '/#care' };
      if (it.src === 'own' && !it.owner_member) await pushCircle(sql, circleId, payload, {});
      else {
        const to = Array.from(new Set([it.owner_member, it.about_member, it.by_member].filter(Boolean)));
        for (const id of (it.src === 'own' ? [it.owner_member] : to)) await pushCircle(sql, circleId, payload, { only: id });
      }
      if (it.src === 'own') await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, null, 'care', ${'📅 ' + it.label + ' runs out ' + when})`;
      n++;
    }
  } catch (e) { /* never breaks a read */ }
  return n;
}
