// THE BLOOD GROUP LOOKUP, and THE DOCTOR-READY SUMMARY. Behind
// /api/book?area=blood and /api/book?area=summary (no new function: the
// project is at its cap). Both read what the family already wrote in
// Health & contacts. Neither gives advice.
//
// BLOOD: "who in the family and linked families is O+?"
//   GET  /api/book?area=blood&circle=CODE&member=ID
//        -> { adult, mine: { group, consent, looks }, groups, consentLine, legal }
//   POST /api/book {action: 'blood_consent_set', on}     my own yes or no, on my own phone
//        {action: 'blood_find', group}                   -> { matches: [{ name, family, phone? }] }
//        {action: 'blood_ask', group, note?}             tell the people found that someone is looking
//   The answer holds ONLY people who wrote down a blood group AND said yes
//   to "Tell my family my blood group if someone needs blood". The yes is
//   in the SQL: no row, no person. Nothing at all about anyone else, not
//   even a count. Someone not on Parwah cannot say yes, so is never shown;
//   nor is a child, nor someone who has passed away.
//
// SUMMARY: one printable page for a doctor.
//   GET  /api/book?area=summary&circle=CODE&member=ID            -> { people }
//   GET  ...&person=ID                                           -> { summary }
//   Built ONLY from entries this viewer may already read, by the Family
//   book's own rule, written out again in the SQL below. For the person
//   themself and the adults; never a child. Nothing is stored.
import { db, ensureSchema, requireMember, isUuid, schemaOnce, rateLimit } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { reqTz, dayIn } from './_recur.mjs';
import { ensureAudienceSchema, minorOf } from './_audience.mjs';
import { ensureBookSchema } from './_bookschema.mjs';
import { memberCards } from './_standing.mjs';
import { ensureEcardSchema, mayOpen } from './_ecard.mjs';
import { BLOOD_GROUPS, BLOOD_CONSENT_LINE, BLOOD_LEGAL, BLOOD_ASKS_PER_DAY, bloodGroupOf, bloodMayAsk, bloodAskPush,
         SUMMARY_LINE, summaryMayOpen, summaryBuild } from './_needsrules.mjs';

const bad = (res, status, error) => res.status(status).json({ ok: false, error });
// A family that never used a feature has no table (or not yet its newer columns) for it: that source is empty.
const maybe = async (f) => { try { return await f(); } catch (e) { if (e && (e.code === '42P01' || e.code === '42703')) return []; throw e; } };
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

let ready = false;
export async function ensureBloodSchema(sql) {
  if (ready) return;
  await ensureAudienceSchema(sql);
  await schemaOnce(() => ensureBookSchema(sql));
  await schemaOnce(async () => {
    // The member's own answer. No row means not asked yet, and so no.
    await sql`create table if not exists blood_consent (
      member_id uuid primary key references members(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      tell boolean not null default false,
      set_at timestamptz not null default now()
    )`;
    // Who looked, so the person who said yes can see it.
    await sql`create table if not exists blood_lookups (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      by_member uuid references members(id) on delete set null,
      grp text not null,
      at timestamptz not null default now()
    )`;
  });
  ready = true;
}

// The circles linked to this one, both ways, by the consent of both.
async function linkedCircles(sql, circleId) {
  return (await maybe(() => sql`select (case when l.a_circle = ${circleId} then l.b_circle else l.a_circle end) as id
                                from family_links l where l.status = 'active' and (l.a_circle = ${circleId} or l.b_circle = ${circleId})`)).map(r => r.id);
}
// Everyone, in this family and the linked ones, who has a blood group on
// record AND has said yes. The join on blood_consent IS the consent: a
// person with no yes is not in the rows at all.
async function consenting(sql, circleId, exceptId) {
  const circles = [circleId, ...(await linkedCircles(sql, circleId))];
  return sql`
    select m.id, m.name, m.phone, m.circle_id, c.name as family, coalesce(fb.forwhat, fb.name) as said
    from members m
    join blood_consent bc on bc.member_id = m.id and bc.tell
    join family_book fb on fb.about_member = m.id and fb.circle_id = m.circle_id and fb.kind = 'fact' and fb.category = 'blood'
    join circles c on c.id = m.circle_id
    where m.circle_id = any(${circles}::uuid[]) and m.user_id is not null and not m.remembered and m.id <> ${exceptId}
      and not (case when m.dob is not null then m.dob > current_date - interval '18 years' else (m.is_child or m.adult_confirmed is false) end)
    order by (m.circle_id <> ${circleId}), m.created_at`;
}
async function matchesFor(sql, circle, me, group) {
  const rows = (await consenting(sql, circle.id, me.id)).filter(r => bloodGroupOf(r.said) === group);
  const seen = new Set(), out = [];
  for (const r of rows) { if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } }
  return out;
}

export async function bloodApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureBloodSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, b = req.body || {};
    const get = req.method === 'GET';
    const g = await requireMember(sql, get ? q.circle : b.code, get ? q.member : b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;
    const meMinor = await minorOf(sql, circle.id, me.id);
    const mine = async () => {
      const fact = (await sql`select coalesce(forwhat, name) as said from family_book where circle_id = ${circle.id} and about_member = ${me.id} and kind = 'fact' and category = 'blood' order by updated_at desc limit 1`)[0];
      const c = (await sql`select tell from blood_consent where member_id = ${me.id}`)[0];
      const group = fact ? bloodGroupOf(fact.said) : null;
      // Who looked for my group while my yes was on, in the last 30 days.
      const looks = c && c.tell && group ? await sql`
        select m.name, fam.name as family, l.at from blood_lookups l
        join members m on m.id = l.by_member join circles fam on fam.id = l.circle_id
        where l.grp = ${group} and l.at > now() - interval '30 days' and l.by_member <> ${me.id}
          and (l.circle_id = ${circle.id} or l.circle_id = any(${await linkedCircles(sql, circle.id)}::uuid[]))
        order by l.at desc limit 10` : [];
      return { group, written: fact ? fact.said : null, consent: !!(c && c.tell), asked: !!c, looks: looks.map(l => ({ name: l.name, family: l.family, at: l.at })) };
    };
    if (get) return res.status(200).json({ ok: true, adult: !meMinor, mine: meMinor ? null : await mine(), groups: BLOOD_GROUPS, consentLine: BLOOD_CONSENT_LINE, legal: BLOOD_LEGAL });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    const may = bloodMayAsk({ adult: !meMinor });
    if (!may.ok) return bad(res, may.status, may.error);

    if (b.action === 'blood_consent_set') {
      // My own answer, about me, from my own sign-in. Nobody sets it for anyone else.
      const on = b.on === true;
      await sql`insert into blood_consent (member_id, circle_id, tell) values (${me.id}, ${circle.id}, ${on})
                on conflict (member_id) do update set tell = excluded.tell, set_at = now()`;
      return res.status(200).json({ ok: true, mine: await mine() });
    }
    if (b.action === 'blood_find' || b.action === 'blood_ask') {
      const group = BLOOD_GROUPS.includes(b.group) ? b.group : null;
      if (!group) return bad(res, 400, 'Choose a blood group from the list.');
      if (b.action === 'blood_find') {
        if (!(await rateLimit(sql, 'bloodfind', me.id, 20, 3600, { failClosed: true }))) return bad(res, 429, 'That is a lot of lookups. Try again in a little while.');
        const rows = await matchesFor(sql, circle, me, group);
        await sql`insert into blood_lookups (circle_id, by_member, grp) values (${circle.id}, ${me.id}, ${group})`;
        // A number, only as its owner lets this viewer see it, and only inside this family.
        const own = rows.filter(r => r.circle_id === circle.id);
        const shown = new Map((await memberCards(sql, circle, me, own.map(r => ({ id: r.id, phone: r.phone })))).map(c => [c.id, c.phone || null]));
        return res.status(200).json({ ok: true, group, legal: BLOOD_LEGAL,
          matches: rows.map(r => ({ id: r.id, name: r.name, family: r.circle_id === circle.id ? null : r.family, phone: r.circle_id === circle.id ? (shown.get(r.id) || null) : null })) });
      }
      // Telling the people found: limited, and a limiter that cannot count says no.
      if (!(await rateLimit(sql, 'bloodask', me.id, BLOOD_ASKS_PER_DAY, 86400, { failClosed: true }))) {
        return bad(res, 429, 'You have asked ' + BLOOD_ASKS_PER_DAY + ' times today. Please call the people on the list.');
      }
      const rows = await matchesFor(sql, circle, me, group);
      const note = clip(b.note, 100);
      for (const r of rows) await pushCircle(sql, r.circle_id, bloodAskPush(me.name, group, note), { only: r.id });
      return res.status(200).json({ ok: true, told: rows.length });
    }
    return bad(res, 400, 'Unknown action');
  } catch (e) { return fail(res, e); }
}

export async function summaryApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureBloodSchema(sql); await ensureEcardSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {};
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false, error: 'GET only' }); }
    const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;
    const meMinor = await minorOf(sql, circle.id, me.id);
    if (q.person === undefined) {
      const may = summaryMayOpen({ viewerMinor: meMinor, personRemembered: false });
      if (!may.ok) return res.status(200).json({ ok: true, adult: false, people: [], line: SUMMARY_LINE });
      const people = await sql`select id, name from members where circle_id = ${circle.id} and not remembered order by (id <> ${me.id}), created_at`;
      return res.status(200).json({ ok: true, adult: true, people: people.map(p => ({ id: p.id, name: p.name, me: p.id === me.id })), line: SUMMARY_LINE });
    }
    if (!isUuid(q.person)) return bad(res, 404, 'That page is not here.');
    const person = (await sql`select id, name, remembered from members where id = ${q.person} and circle_id = ${circle.id}`)[0];
    if (!person) return bad(res, 404, 'That page is not here.');
    const may = summaryMayOpen({ viewerMinor: meMinor, personRemembered: person.remembered });
    if (!may.ok) return bad(res, may.status, may.error);
    // THE FAMILY BOOK'S OWN RULE, in the query: an entry about me, one I
    // wrote, one shared with me by name, or one the family shares. A child
    // or a teenager gets no row at all, whatever was asked above.
    const entries = await sql`
      select b.kind, b.category, b.name, b.forwhat, b.notes, b.phone
      from family_book b
      join members v on v.id = ${me.id} and v.circle_id = b.circle_id
      left join book_access ba on ba.entry_id = b.id and ba.member_id = v.id
      where b.circle_id = ${circle.id} and b.about_member = ${person.id}
        and not (case when v.dob is not null then v.dob > current_date - interval '18 years' else (v.is_child or v.adult_confirmed is false) end)
        and (b.about_member = v.id or b.by_member = v.id or ba.member_id is not null or b.visibility = 'circle')
        and (b.kind = 'med' or (b.kind = 'fact' and b.category in ('blood', 'allergy')) or (b.kind = 'contact' and b.category in ('doctor', 'emergency')))
      order by b.kind, lower(b.name) limit 200`;
    // Past visits and follow-ups: the family's, the ones I wrote, and my own.
    const visits = await maybe(() => sql`
      select a.recorded_at, a.next_due, a.transcript_raw as new_notes, p.title as plan_title
      from audio_consultations a
      join members v on v.id = ${me.id} and v.circle_id = a.circle_id
      left join plans p on p.id = a.plan_id
      where a.circle_id = ${circle.id} and a.person_id = ${person.id}
        and not (case when v.dob is not null then v.dob > current_date - interval '18 years' else (v.is_child or v.adult_confirmed is false) end)
        and (a.visibility = 'family' or a.created_by = v.id or a.person_id = v.id)
        and a.recorded_at > now() - interval '400 days'
      order by a.recorded_at desc limit 12`);
    // Who to call: the emergency contacts written for this person, and the
    // two people on their emergency card when this viewer may open it.
    const contacts = entries.filter(e => e.kind === 'contact' && e.category === 'emergency').map(e => ({ name: e.name, phone: e.phone, note: e.forwhat }));
    if ((await mayOpen(sql, circle.id, me.id)).includes(person.id)) {
      const prefs = (await sql`select contacts from ecard_prefs where circle_id = ${circle.id} and member_id = ${person.id}`)[0];
      if (prefs && prefs.contacts.length) {
        const cs = await sql`select m.id, m.name, m.phone, m.relation from members m where m.circle_id = ${circle.id} and m.id = any(${prefs.contacts}::uuid[]) and not m.remembered`;
        const shown = new Map((await memberCards(sql, circle, me, cs.map(c => ({ id: c.id, phone: c.phone })))).map(c => [c.id, c.phone || null]));
        for (const c of cs) contacts.push({ name: c.name, phone: shown.get(c.id) || null, note: c.relation || 'Family' });
      }
    }
    const summary = summaryBuild({ person, entries, visits, contacts, today: dayIn(reqTz(req) || 'Asia/Kolkata') });
    return res.status(200).json({ ok: true, summary });
  } catch (e) { return fail(res, e); }
}
