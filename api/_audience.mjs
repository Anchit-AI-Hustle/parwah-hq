// WHO IS TOLD WHAT. One helper for every push and every read that must not
// reach a child or a teenager.
//
//   audienceFor(sql, circleId, kind, { except, only })  -> [memberId, ...]
//   pushAudience(sql, circleId, kind, payload, { except, only })
//   minorOf(sql, circleId, memberId)                    -> true / false
//
// A member under 18 by date of birth, or marked as a child by an adult
// (members.is_child), is NOT sent the kinds in ADULT_ONLY_KINDS
// (api/_consentrules.mjs): the SOS siren details, missed-dose alerts, staff
// salaries, the family safe word, emergency items and cost ledgers. They are
// still sent the warm things: plans, cards, games, the album, stories,
// Ashirwad. A kind nobody listed is adult only, so a new alert reaches a
// child only when someone puts it on the warm list on purpose.
//
// Nobody marked as no longer with us is ever in an audience, and nobody who
// is not on Parwah (no sign-in) either: there is no phone to tell.
//
// The rule is one SQL condition, written out in each query that needs it
// (the gate refuses string-built SQL):
//   (m.is_child or (m.dob is not null and m.dob > current_date - interval '18 years'))
//
// The mark is set by an adult through /api/chats?area=ashirwad, action
// standing_set {targetId, child: true|false} (standingAction below).
import { schemaOnce, isUuid } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { adultOnly } from './_consentrules.mjs';

let ready = false;
export async function ensureAudienceSchema(sql) {
  if (ready) return;
  await schemaOnce(async () => {
    await sql`alter table members add column if not exists is_child boolean not null default false`;
    await sql`alter table members add column if not exists child_by uuid references members(id) on delete set null`;
    // Made by Family Memory and by days of remembrance too; whichever runs first.
    await sql`alter table members add column if not exists remembered boolean not null default false`;
  });
  ready = true;
}

// The members who may be sent this kind of thing, as ids.
export async function audienceFor(sql, circleId, kind, { except = null, only = null } = {}) {
  await ensureAudienceSchema(sql);
  const grown = adultOnly(kind);
  const onlyIds = Array.isArray(only) ? only.filter(isUuid) : (isUuid(only) ? [only] : null);
  const rows = await sql`
    select m.id from members m
    where m.circle_id = ${circleId} and m.user_id is not null and not m.remembered
      and (not ${grown}::boolean or not (m.is_child or (m.dob is not null and m.dob > current_date - interval '18 years')))
      and (${except}::uuid is null or m.id <> ${except})
      and (${onlyIds}::uuid[] is null or m.id = any(${onlyIds}::uuid[]))
    order by m.created_at`;
  return rows.map(r => r.id);
}

// A push to exactly that audience. Returns how many people it was for.
export async function pushAudience(sql, circleId, kind, payload, opts = {}) {
  let ids = [];
  try { ids = await audienceFor(sql, circleId, kind, opts); } catch (e) { return 0; }
  for (const id of ids) await pushCircle(sql, circleId, payload, { only: id });
  return ids.length;
}

// Is this member a child or a teenager? Read in SQL, so every module asks
// the same question the same way.
export async function minorOf(sql, circleId, memberId) {
  if (!isUuid(memberId)) return false;
  await ensureAudienceSchema(sql);
  const r = await sql`select (m.is_child or (m.dob is not null and m.dob > current_date - interval '18 years')) as minor
                      from members m where m.id = ${memberId} and m.circle_id = ${circleId}`;
  return !!(r[0] && r[0].minor);
}

const bad = (error, status = 400) => ({ status, json: { ok: false, error } });

// An adult marks someone with no date of birth on file as a child, or takes
// the mark off. A person whose date of birth says 18 or over cannot be
// marked: the mark must never be a way to shut an adult out.
export async function standingAction(sql, circle, me, body) {
  await ensureAudienceSchema(sql);
  if (await minorOf(sql, circle.id, me.id)) return bad('An adult in the family does this.', 403);
  if (!isUuid(body.targetId)) return bad('Choose someone in this family');
  if (body.targetId === me.id) return bad('This is for someone else in the family.');
  const t = (await sql`select id, name, remembered, is_child,
                              (dob is not null and dob <= current_date - interval '18 years') as grown
                       from members where id = ${body.targetId} and circle_id = ${circle.id}`)[0];
  if (!t) return bad('Choose someone in this family', 404);
  if (t.remembered) return bad(t.name + ' is remembered here.');
  const child = body.child === true;
  if (child && t.grown) return bad(t.name + ' is 18 or over by their date of birth, so cannot be marked as a child.', 409);
  await sql`update members set is_child = ${child}, child_by = ${child ? me.id : null} where id = ${t.id} and circle_id = ${circle.id}`;
  if (child !== !!t.is_child) {
    await sql`insert into events (circle_id, member_id, type, text)
              values (${circle.id}, ${me.id}, 'care', ${child ? me.name + ' marked ' + t.name + ' as a child in the family (under 18)'
                                                                 : me.name + ' took the child mark off ' + t.name})`;
  }
  return { status: 200, json: { ok: true, child } };
}
