// A CHILD'S PAGE ("Bachchon ka panna"). Behind /api/care?area=kids (no new
// function: the project is at its cap).
//
// For each member under 18 (by the ONE adult rule): school and class, the
// class teacher and the school's phone, fee dates with a reminder to the
// adults who asked for one (never the child), exam dates and results,
// who collects today and this week, the vaccination RECORD (the date
// given, the next date as the family wrote it; a record, no advice),
// allergies and the doctor's phone, and the week's classes.
//
//   GET  /api/care?area=kids&circle=CODE&member=ID            -> { kids: [{ id, name, rel, hasPage, mayStart }], me }
//   GET  ...&child=ID                                         -> { page } as this viewer may read it
//   POST /api/care {action: 'kid_page_save', childId, school, className, teacher, schoolPhone, allergies, doctorName, doctorPhone}
//        kid_share_set     {childId, section, who: parents|family}      a parent
//        kid_results_share {childId, who}                               the child (a parent, when the child is not on Parwah)
//        kid_item_add      {childId, kind: fee|exam|vaccine|activity|note, title, onDate?, atTime?, days?, nextDue?, result?, share?}
//        kid_item_update   {id, ...}    kid_item_remove {id}
//        kid_fee_sub       {childId, on}                                an adult who may see the fees
//        kid_pickup_set    {childId, days: [YYYY-MM-DD], byId, time: HH:MM}   kid_pickup_clear {childId, day}
//        kid_pickup_done   {childId, day?}                              one tap: "Picked up"
//
// WHO READS WHAT IS SAID BY THE SQL. One function in the database,
// kid_rel_v1(viewer, child), answers 'self', 'parent', 'adult', 'minor' or
// 'none' (the pure form is kidRelation in api/_kidsrules.mjs, and a
// database test walks both through every case). Every read below asks it:
//   - a parent by the tree (the parent link and that parent's spouse; with
//     no parent on Parwah, the adult who started the page) reads it all;
//   - the child reads a friendly page: school, exams, classes, who collects
//     them, their own notes. Never fees, never the health lines;
//   - another adult reads only the parts a parent marked "Whole family",
//     and exam results only if the child chose that;
//   - a brother, sister or cousin under 18 the same, and never fees,
//     vaccinations or the health lines.
// Nobody marked as no longer with us has a page, collects, or is told.
import { db, ensureSchema, requireMember, isUuid, schemaOnce, rateLimit } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { reqTz, validTz, fromWall, dayIn } from './_recur.mjs';
import { ensureAudienceSchema, audienceFor } from './_audience.mjs';
import { noteRisk } from './_notesapi.mjs';
import { RECORD_LEGAL, KID_SECTIONS, KID_SECTION_WORDS, KID_ITEM_KINDS, KID_WHO, KID_MAX, PICKUP_GRACE_MIN,
         kidMayWrite, kidResultsChooser, kidMayStart, feeStage, feePush, pickupDonePush, pickupLatePush, childNotePush,
         kidText, kidPhone, kidDate, kidClock, kidItemClean } from './_kidsrules.mjs';

const HOME_TZ = 'Asia/Kolkata';
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const bad = (res, status, error) => res.status(status).json({ ok: false, error });

let ready = false;
export async function ensureKidsSchema(sql) {
  if (ready) return;
  await ensureAudienceSchema(sql);
  await schemaOnce(async () => {
    // The two tree links, as /api/circle makes them; whichever runs first.
    await sql`alter table members add column if not exists parent_id uuid references members(id) on delete set null`;
    await sql`alter table members add column if not exists spouse_id uuid references members(id) on delete set null`;
    await sql`create table if not exists kid_pages (
      child_id uuid primary key references members(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      school text, class_name text, teacher text, school_phone text,
      allergies text, doctor_name text, doctor_phone text,
      share jsonb not null default '{}'::jsonb,
      results_share text not null default 'parents' check (results_share in ('parents', 'family')),
      started_by uuid references members(id) on delete set null,
      updated_at timestamptz not null default now()
    )`;
    await sql`create table if not exists kid_items (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      child_id uuid not null references members(id) on delete cascade,
      kind text not null check (kind in ('fee', 'exam', 'vaccine', 'activity', 'note')),
      title text not null,
      on_date date, at_time text, days int[] not null default '{}', next_due date,
      result text, paid boolean not null default false,
      share text not null default 'parents' check (share in ('parents', 'family')),
      by_member uuid references members(id) on delete set null,
      created_at timestamptz not null default now()
    )`;
    await sql`create index if not exists kid_items_child on kid_items (child_id, kind, on_date)`;
    // The adults who asked to be reminded of this child's fees.
    await sql`create table if not exists kid_fee_subs (
      child_id uuid not null references members(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      primary key (child_id, member_id)
    )`;
    // A reminder is sent once: one row per fee, per stage, per due date.
    await sql`create table if not exists kid_alerts (
      ref_id uuid not null, stage int not null, for_date date not null,
      at timestamptz not null default now(),
      primary key (ref_id, stage, for_date)
    )`;
    await sql`create table if not exists kid_pickups (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      child_id uuid not null references members(id) on delete cascade,
      day date not null,
      by_member uuid references members(id) on delete set null,
      expect_at timestamptz not null,
      set_by uuid references members(id) on delete set null,
      picked_at timestamptz, picked_by uuid references members(id) on delete set null,
      alerted_at timestamptz,
      unique (child_id, day)
    )`;
    await sql`create index if not exists kid_pickups_open on kid_pickups (expect_at) where picked_at is null and alerted_at is null`;
    // HOW THE VIEWER STANDS TO THE CHILD, in the database, so that every
    // query asks the same question the same way. Made once: a second
    // "create" racing the first is refused by the catalogue, and the
    // function is then there.
    const has = await sql`select 1 from pg_proc where proname = 'kid_rel_v1'`;
    if (!has[0]) {
      try {
        await sql`create function kid_rel_v1(viewer uuid, child uuid) returns text language sql stable as $fn$
          select case
            when v.id = c.id then 'self'
            when v.user_id is null or v.remembered then 'none'
            when (case when v.dob is not null then v.dob > current_date - interval '18 years' else (v.is_child or v.adult_confirmed is false) end) then 'minor'
            when c.parent_id = v.id
              or exists (select 1 from members p where p.id = c.parent_id and (p.spouse_id = v.id or v.spouse_id = p.id)) then 'parent'
            when pg.started_by = v.id and not exists (
              select 1 from members p where p.user_id is not null and not p.remembered and p.circle_id = c.circle_id
                and (p.id = c.parent_id or p.spouse_id = c.parent_id
                     or exists (select 1 from members q where q.id = c.parent_id and q.spouse_id = p.id))) then 'parent'
            else 'adult' end
          from members c
          join members v on v.id = viewer and v.circle_id = c.circle_id
          left join kid_pages pg on pg.child_id = c.id
          where c.id = child
        $fn$`;
      } catch (e) {
        const again = await sql`select 1 from pg_proc where proname = 'kid_rel_v1'`;
        if (!again[0]) throw e;
      }
    }
  });
  ready = true;
}

// The children of this family, as this member may know of them: every
// member under 18 who is with us, and how the viewer stands to each.
async function kidsFor(sql, circle, me) {
  return sql`
    select c.id, c.name, (c.user_id is not null) as on_app, (pg.child_id is not null) as has_page,
           coalesce(kid_rel_v1(${me.id}, c.id), 'none') as rel,
           exists (select 1 from members p where p.user_id is not null and not p.remembered and p.circle_id = c.circle_id
                   and (p.id = c.parent_id or p.spouse_id = c.parent_id
                        or exists (select 1 from members q where q.id = c.parent_id and q.spouse_id = p.id))) as has_parent
    from members c left join kid_pages pg on pg.child_id = c.id
    where c.circle_id = ${circle.id} and not c.remembered
      and (case when c.dob is not null then c.dob > current_date - interval '18 years' else (c.is_child or c.adult_confirmed is false) end)
    order by c.dob nulls last, c.created_at`;
}
async function kidOne(sql, circle, me, childId) {
  if (!isUuid(childId)) return null;
  return (await kidsFor(sql, circle, me)).find(k => k.id === childId) || null;
}

// One page, as this viewer may read it. Each line is cut in the SQL.
async function pageFor(sql, circle, me, kid, tz, nowMs) {
  const p = (await sql`
    select r.rel,
      case when r.rel in ('self', 'parent') or pg.share->>'school' = 'family' then pg.school end as school,
      case when r.rel in ('self', 'parent') or pg.share->>'school' = 'family' then pg.class_name end as class_name,
      case when r.rel in ('self', 'parent') or pg.share->>'school' = 'family' then pg.teacher end as teacher,
      case when r.rel in ('self', 'parent') or pg.share->>'school' = 'family' then pg.school_phone end as school_phone,
      case when r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'health' = 'family') then pg.allergies end as allergies,
      case when r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'health' = 'family') then pg.doctor_name end as doctor_name,
      case when r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'health' = 'family') then pg.doctor_phone end as doctor_phone,
      (r.rel in ('self', 'parent') or pg.share->>'school' = 'family') as see_school,
      (r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'health' = 'family')) as see_health,
      (r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'fees' = 'family')) as see_fees,
      (r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'vaccines' = 'family')) as see_vaccines,
      (r.rel in ('self', 'parent') or pg.share->>'exams' = 'family') as see_exams,
      (r.rel in ('self', 'parent') or pg.share->>'activities' = 'family') as see_activities,
      (r.rel in ('self', 'parent') or pg.share->>'pickup' = 'family') as see_pickup,
      case when r.rel = 'parent' then pg.share end as share,
      case when r.rel in ('self', 'parent') then pg.results_share end as results_share
    from kid_pages pg cross join lateral (select coalesce(kid_rel_v1(${me.id}, pg.child_id), 'none') as rel) r
    where pg.child_id = ${kid.id} and pg.circle_id = ${circle.id} and r.rel <> 'none'`)[0];
  if (!p) return null;
  const items = await sql`
    select i.id, i.kind, i.title, i.on_date::text as on_date, i.at_time, i.days, i.next_due::text as next_due, i.paid, i.share,
           i.by_member, b.name as by_name, i.created_at,
           case when r.rel in ('self', 'parent') or pg.results_share = 'family' then i.result end as result
    from kid_items i
    join kid_pages pg on pg.child_id = i.child_id
    cross join lateral (select coalesce(kid_rel_v1(${me.id}, i.child_id), 'none') as rel) r
    left join members b on b.id = i.by_member
    where i.child_id = ${kid.id} and i.circle_id = ${circle.id}
      and (case i.kind
             when 'fee' then r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'fees' = 'family')
             when 'vaccine' then r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'vaccines' = 'family')
             when 'exam' then r.rel in ('self', 'parent') or pg.share->>'exams' = 'family'
             when 'activity' then r.rel in ('self', 'parent') or pg.share->>'activities' = 'family'
             when 'note' then r.rel in ('self', 'parent') or i.share = 'family'
             else false end)
    order by i.on_date nulls last, i.created_at`;
  const today = dayIn(tz, nowMs);
  // Pick-up: today and the six days after. The collector always sees their own turn.
  const pickups = await sql`
    select k.id, k.day::text as day, k.by_member, m.name as by_name, (m.user_id is not null) as by_on_app, k.expect_at, k.picked_at, k.picked_by, pb.name as picked_name, k.alerted_at
    from kid_pickups k
    join kid_pages pg on pg.child_id = k.child_id
    cross join lateral (select coalesce(kid_rel_v1(${me.id}, k.child_id), 'none') as rel) r
    left join members m on m.id = k.by_member and not m.remembered
    left join members pb on pb.id = k.picked_by
    where k.child_id = ${kid.id} and k.circle_id = ${circle.id} and k.day >= ${today}::date and k.day < ${today}::date + 7
      and r.rel <> 'none' and (r.rel in ('self', 'parent') or pg.share->>'pickup' = 'family' or k.by_member = ${me.id})
    order by k.day`;
  const sub = (await sql`select 1 from kid_fee_subs where child_id = ${kid.id} and member_id = ${me.id}`)[0];
  const rel = p.rel, of = k => items.filter(i => i.kind === k);
  const out = { childId: kid.id, name: kid.name, rel, childOnApp: kid.on_app, legal: RECORD_LEGAL, today,
    sees: { school: p.see_school, health: p.see_health, fees: p.see_fees, vaccines: p.see_vaccines, exams: p.see_exams, activities: p.see_activities,
            pickup: p.see_pickup || pickups.length > 0 },
    school: p.see_school ? { name: p.school, className: p.class_name, teacher: p.teacher, phone: p.school_phone } : null,
    health: p.see_health ? { allergies: p.allergies, doctorName: p.doctor_name, doctorPhone: p.doctor_phone } : null,
    fees: p.see_fees ? of('fee') : null, feeReminder: p.see_fees && rel !== 'self' ? !!sub : null,
    vaccines: p.see_vaccines ? of('vaccine') : null,
    exams: p.see_exams ? of('exam') : null, activities: p.see_activities ? of('activity') : null,
    notes: of('note').map(i => ({ ...i, mine: i.by_member === me.id })),
    pickups: pickups.map(k => ({ id: k.id, day: k.day, byId: k.by_member, byName: k.by_name, byOnApp: !!k.by_on_app, expectAt: k.expect_at,
      pickedAt: k.picked_at, pickedName: k.picked_name, late: !k.picked_at && new Date(k.expect_at).getTime() + PICKUP_GRACE_MIN * 60000 <= nowMs,
      mine: k.by_member === me.id, canTap: rel === 'parent' || k.by_member === me.id || (rel === 'adult' && p.see_pickup) })),
    share: p.share || null, resultsShare: p.results_share || null,
    can: { edit: rel === 'parent', addExam: rel === 'parent' || rel === 'self', addNote: rel === 'parent' || rel === 'self',
           resultsShare: kidResultsChooser(rel, kid.on_app), feeReminder: !!p.see_fees && rel !== 'self' && rel !== 'minor' } };
  if (rel === 'parent') {
    // Who may collect: an adult of this family who is with us, on Parwah or by name.
    out.collectors = (await sql`
      select m.id, m.name, (m.user_id is not null) as on_app from members m
      where m.circle_id = ${circle.id} and not m.remembered and m.id <> ${kid.id}
        and not (case when m.dob is not null then m.dob > current_date - interval '18 years' else (m.is_child or m.adult_confirmed is false) end)
      order by (m.user_id is null), m.created_at`).map(m => ({ id: m.id, name: m.name, onApp: m.on_app }));
    out.sections = KID_SECTIONS.map(s => ({ key: s, label: KID_SECTION_WORDS[s], who: (p.share && p.share[s]) === 'family' ? 'family' : 'parents' }));
  }
  return out;
}

// The child's parents who are on Parwah, plus whoever keeps the page.
async function parentsOf(sql, circleId, childId) {
  return (await sql`
    select m.id from members m
    where m.circle_id = ${circleId} and m.user_id is not null and not m.remembered and kid_rel_v1(m.id, ${childId}) = 'parent'`).map(r => r.id);
}

export default async function kidsApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureKidsSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, b = req.body || {};
    const get = req.method === 'GET';
    const g = await requireMember(sql, get ? q.circle : b.code, get ? q.member : b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me, nowMs = Date.now();
    const tz = reqTz(req) || validTz(b.tz) || HOME_TZ;

    if (get) {
      const kids = await kidsFor(sql, circle, me);
      if (q.child === undefined) {
        return res.status(200).json({ ok: true, legal: RECORD_LEGAL,
          kids: kids.filter(k => k.rel !== 'none').map(k => ({ id: k.id, name: k.name, rel: k.rel, hasPage: k.has_page,
            mayStart: !k.has_page && kidMayStart(k.rel, k.has_parent).ok })) });
      }
      const kid = kids.find(k => k.id === q.child);
      if (!kid || kid.rel === 'none') return bad(res, 404, 'That page is not here');
      const page = kid.has_page ? await pageFor(sql, circle, me, kid, tz, nowMs) : null;
      return res.status(200).json({ ok: true, legal: RECORD_LEGAL, page, mayStart: !kid.has_page && kidMayStart(kid.rel, kid.has_parent).ok,
        kid: { id: kid.id, name: kid.name, rel: kid.rel } });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }

    const act = String(b.action || '');
    // An entry is found by its own id; everything else names the child.
    let item = null;
    if (act === 'kid_item_update' || act === 'kid_item_remove') {
      if (!isUuid(b.id)) return bad(res, 404, 'That entry is not here any more');
      item = (await sql`select * from kid_items where id = ${b.id} and circle_id = ${circle.id}`)[0];
      if (!item) return bad(res, 404, 'That entry is not here any more');
    }
    const kid = await kidOne(sql, circle, me, item ? item.child_id : b.childId);
    if (!kid || kid.rel === 'none') return bad(res, 404, 'Choose a child in this family');
    const rel = kid.rel;
    const done = async (status = 200) => res.status(status).json({ ok: true, page: await pageFor(sql, circle, me, { ...kid, has_page: true }, tz, Date.now()) });

    if (act === 'kid_page_save') {
      if (!kid.has_page) { const may = kidMayStart(rel, kid.has_parent); if (!may.ok) return bad(res, may.status, may.error); }
      else if (rel !== 'parent') return bad(res, 403, 'A parent changes this page.');
      const sp = kidPhone(b.schoolPhone), dp = kidPhone(b.doctorPhone);
      if (sp.error || dp.error) return bad(res, 400, sp.error || dp.error);
      const f = { school: kidText(b.school), cls: kidText(b.className, 40), teacher: kidText(b.teacher), allergies: kidText(b.allergies, KID_MAX.long), doctor: kidText(b.doctorName) };
      for (const v of Object.values(f)) { const why = v && noteRisk(v); if (why) return bad(res, 400, why); }
      await sql`
        insert into kid_pages (child_id, circle_id, school, class_name, teacher, school_phone, allergies, doctor_name, doctor_phone, started_by)
        values (${kid.id}, ${circle.id}, ${f.school}, ${f.cls}, ${f.teacher}, ${sp.value}, ${f.allergies}, ${f.doctor}, ${dp.value}, ${me.id})
        on conflict (child_id) do update set school = excluded.school, class_name = excluded.class_name, teacher = excluded.teacher,
          school_phone = excluded.school_phone, allergies = excluded.allergies, doctor_name = excluded.doctor_name,
          doctor_phone = excluded.doctor_phone, updated_at = now()`;
      // The adult who starts a page is reminded of the fees unless they say no.
      if (!kid.has_page) await sql`insert into kid_fee_subs (child_id, member_id) values (${kid.id}, ${me.id}) on conflict do nothing`;
      return done(kid.has_page ? 200 : 201);
    }
    if (!kid.has_page) return bad(res, 409, 'This page has not been started yet.');

    if (act === 'kid_share_set') {
      if (rel !== 'parent') return bad(res, 403, 'A parent chooses who sees this.');
      if (!KID_SECTIONS.includes(b.section) || !KID_WHO.includes(b.who)) return bad(res, 400, 'Choose "Parents only" or "Whole family".');
      await sql`update kid_pages set share = share || jsonb_build_object(${b.section}::text, ${b.who}::text), updated_at = now() where child_id = ${kid.id}`;
      return done();
    }
    if (act === 'kid_results_share') {
      if (!kidResultsChooser(rel, kid.on_app)) return bad(res, 403, first(kid.name) + ' chooses who sees the exam results.');
      if (!KID_WHO.includes(b.who)) return bad(res, 400, 'Choose "Parents only" or "Whole family".');
      await sql`update kid_pages set results_share = ${b.who}, updated_at = now() where child_id = ${kid.id}`;
      return done();
    }
    if (act === 'kid_item_add') {
      if (!KID_ITEM_KINDS.includes(b.kind) || !kidMayWrite(rel, b.kind)) {
        return bad(res, 403, rel === 'self' ? 'You can add your exam dates and your notes. A parent adds the rest.' : 'A parent adds this.');
      }
      const c = kidItemClean(b.kind, b);
      if (c.error) return bad(res, 400, c.error);
      const why = noteRisk(c.value.title) || (c.value.result && noteRisk(c.value.result));
      if (why) return bad(res, 400, why);
      const n = (await sql`select count(*)::int as n from kid_items where child_id = ${kid.id}`)[0].n;
      if (n >= KID_MAX.items) return bad(res, 400, 'This page is full. Remove an old entry first.');
      const v = c.value;
      // A child's note tells the parents: limited, so it cannot be used to ring them over and over.
      if (rel === 'self' && v.kind === 'note' && !(await rateLimit(sql, 'kidnote', me.id, 6, 3600, { failClosed: true }))) {
        return bad(res, 429, 'That is a lot of notes at once. Try again in a little while.');
      }
      await sql`insert into kid_items (circle_id, child_id, kind, title, on_date, at_time, days, next_due, result, share, by_member)
                values (${circle.id}, ${kid.id}, ${v.kind}, ${v.title}, ${v.onDate}, ${v.atTime}, ${v.days}::int[], ${v.nextDue}, ${v.result}, ${v.share}, ${me.id})`;
      if (rel === 'self' && v.kind === 'note') {
        for (const id of await parentsOf(sql, circle.id, kid.id)) await pushCircle(sql, circle.id, childNotePush(kid.name), { only: id });
      }
      return done(201);
    }
    if (act === 'kid_item_update') {
      if (!kidMayWrite(rel, item.kind, { mine: item.by_member === me.id })) return bad(res, 403, 'A parent changes this.');
      const merged = { title: b.title !== undefined ? b.title : item.title, onDate: b.onDate !== undefined ? b.onDate : (item.on_date ? new Date(item.on_date).toISOString().slice(0, 10) : null),
        atTime: b.atTime !== undefined ? b.atTime : item.at_time, days: b.days !== undefined ? b.days : item.days,
        nextDue: b.nextDue !== undefined ? b.nextDue : (item.next_due ? new Date(item.next_due).toISOString().slice(0, 10) : null),
        result: b.result !== undefined ? b.result : item.result, share: b.share !== undefined ? b.share : item.share };
      const c = kidItemClean(item.kind, merged);
      if (c.error) return bad(res, 400, c.error);
      const why = noteRisk(c.value.title) || (c.value.result && noteRisk(c.value.result));
      if (why) return bad(res, 400, why);
      const v = c.value, paid = item.kind === 'fee' && b.paid !== undefined ? b.paid === true : item.paid;
      await sql`update kid_items set title = ${v.title}, on_date = ${v.onDate}, at_time = ${v.atTime}, days = ${v.days}::int[], next_due = ${v.nextDue},
                  result = ${v.result}, share = ${v.share}, paid = ${paid} where id = ${item.id}`;
      return done();
    }
    if (act === 'kid_item_remove') {
      if (!kidMayWrite(rel, item.kind, { mine: item.by_member === me.id })) return bad(res, 403, 'A parent removes this.');
      await sql`delete from kid_items where id = ${item.id}`;
      return done();
    }
    if (act === 'kid_fee_sub') {
      // Only an adult who may see the fees, and never the child.
      const may = (await sql`select (r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'fees' = 'family')) as ok
                             from kid_pages pg cross join lateral (select kid_rel_v1(${me.id}, pg.child_id) as rel) r where pg.child_id = ${kid.id}`)[0];
      if (!may || !may.ok) return bad(res, 403, 'Fee reminders are for the adults who can see the fees.');
      if (b.on === true) await sql`insert into kid_fee_subs (child_id, member_id) values (${kid.id}, ${me.id}) on conflict do nothing`;
      else await sql`delete from kid_fee_subs where child_id = ${kid.id} and member_id = ${me.id}`;
      return done();
    }
    if (act === 'kid_pickup_set') {
      if (rel !== 'parent') return bad(res, 403, 'A parent sets who collects.');
      const days = [...new Set((Array.isArray(b.days) ? b.days : [b.day]).map(kidDate).filter(Boolean))].slice(0, 14);
      const time = kidClock(b.time);
      if (!days.length || !time) return bad(res, 400, 'Choose the day and the time school ends.');
      if (!isUuid(b.byId)) return bad(res, 400, 'Choose who collects.');
      // An adult of this family who is with us: on Parwah, or trusted by name.
      const who = (await sql`select m.id from members m where m.id = ${b.byId} and m.circle_id = ${circle.id} and not m.remembered and m.id <> ${kid.id}
                             and not (case when m.dob is not null then m.dob > current_date - interval '18 years' else (m.is_child or m.adult_confirmed is false) end)`)[0];
      if (!who) return bad(res, 400, 'Choose an adult in this family to collect.');
      const today = dayIn(tz, nowMs);
      for (const d of days) {
        if (d < today) continue;
        const at = new Date(fromWall({ y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10), h: +time.slice(0, 2), mi: +time.slice(3, 5), s: 0 }, tz));
        await sql`insert into kid_pickups (circle_id, child_id, day, by_member, expect_at, set_by) values (${circle.id}, ${kid.id}, ${d}, ${who.id}, ${at}, ${me.id})
                  on conflict (child_id, day) do update set by_member = excluded.by_member, expect_at = excluded.expect_at, set_by = excluded.set_by,
                    picked_at = null, picked_by = null, alerted_at = null`;
      }
      return done();
    }
    if (act === 'kid_pickup_clear') {
      if (rel !== 'parent') return bad(res, 403, 'A parent sets who collects.');
      const d = kidDate(b.day);
      if (!d) return bad(res, 400, 'Choose the day.');
      await sql`delete from kid_pickups where child_id = ${kid.id} and day = ${d}`;
      return done();
    }
    if (act === 'kid_pickup_done') {
      const d = kidDate(b.day) || dayIn(tz, nowMs);
      // A parent, the person whose turn it is, or an adult the pick-up is shared with.
      const row = (await sql`
        select k.id, k.by_member, m.name as by_name from kid_pickups k
        join kid_pages pg on pg.child_id = k.child_id
        cross join lateral (select kid_rel_v1(${me.id}, k.child_id) as rel) r
        left join members m on m.id = k.by_member
        where k.child_id = ${kid.id} and k.day = ${d}
          and (r.rel = 'parent' or k.by_member = ${me.id} or (r.rel = 'adult' and pg.share->>'pickup' = 'family'))`)[0];
      if (!row) return bad(res, 403, 'No pick-up is set for you to mark today.');
      const claim = await sql`update kid_pickups set picked_at = now(), picked_by = ${me.id} where id = ${row.id} and picked_at is null returning id`;
      if (claim[0]) {
        // The other parent is told, and nobody else.
        for (const id of await parentsOf(sql, circle.id, kid.id)) {
          if (id !== me.id) await pushCircle(sql, circle.id, pickupDonePush(kid.name, me.name, row.by_name), { only: id });
        }
      }
      return done();
    }
    return bad(res, 400, 'Unknown action');
  } catch (e) { return fail(res, e); }
}

// THE TIMER'S SHARE (one line in runTick), each claimed by its own write so
// it happens once however many timers run:
//   1. a pick-up not marked by the expected time plus 20 minutes is told to
//      the adults of the family, as a safety alert;
//   2. a fee is told to the adults who asked, a week before and the day
//      before. Never to the child: the list is read through audienceFor.
export async function sweepKidsAll(sql, nowMs = Date.now()) {
  await ensureKidsSchema(sql);
  let n = 0;
  const lateBy = new Date(nowMs - PICKUP_GRACE_MIN * 60000);
  const late = await sql`update kid_pickups set alerted_at = ${new Date(nowMs)}
                         where picked_at is null and alerted_at is null and expect_at <= ${lateBy} and expect_at > ${new Date(nowMs - 12 * 3600000)}
                         returning id, circle_id, child_id, by_member, expect_at`;
  for (const k of late) {
    const child = (await sql`select name, remembered from members where id = ${k.child_id}`)[0];
    if (!child || child.remembered) continue;
    const who = k.by_member ? (await sql`select name, remembered from members where id = ${k.by_member}`)[0] : null;
    const at = new Intl.DateTimeFormat('en-IN', { timeZone: HOME_TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(k.expect_at));
    const adults = await audienceFor(sql, k.circle_id, 'kid_pickup', { except: k.child_id });
    for (const id of adults) await pushCircle(sql, k.circle_id, pickupLatePush(child.name, who && !who.remembered ? who.name : null, at), { only: id });
    if (adults.length) n++;
  }
  const today = dayIn(HOME_TZ, nowMs);
  const fees = await sql`select i.id, i.circle_id, i.child_id, i.title, i.on_date::text as d, (i.on_date - ${today}::date) as days, c.name
                         from kid_items i join members c on c.id = i.child_id and not c.remembered
                         where i.kind = 'fee' and not i.paid and i.on_date between ${today}::date and ${today}::date + 7`;
  for (const f of fees) {
    const stage = feeStage(f.days);
    if (!stage) continue;
    const claim = await sql`insert into kid_alerts (ref_id, stage, for_date) values (${f.id}, ${stage}, ${f.d}) on conflict do nothing returning stage`;
    if (!claim[0]) continue;
    // The day-before reminder claims the week-before one too: a fee added late is told once.
    if (stage === 1) await sql`insert into kid_alerts (ref_id, stage, for_date) values (${f.id}, 7, ${f.d}) on conflict do nothing`;
    const subs = (await sql`
      select s.member_id from kid_fee_subs s
      join kid_pages pg on pg.child_id = s.child_id
      cross join lateral (select kid_rel_v1(s.member_id, s.child_id) as rel) r
      where s.child_id = ${f.child_id} and (r.rel = 'parent' or (r.rel = 'adult' and pg.share->>'fees' = 'family'))`).map(r => r.member_id);
    const to = subs.length ? await audienceFor(sql, f.circle_id, 'kid_fee', { only: subs, except: f.child_id }) : [];
    for (const id of to) await pushCircle(sql, f.circle_id, feePush(f.name, f.title, f.days), { only: id });
    if (to.length) n++;
  }
  return n;
}
