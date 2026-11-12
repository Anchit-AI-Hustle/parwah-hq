// WATCH OR LISTEN TOGETHER: a recommendation turned into a shared moment.
//
// "Rohan recommends Panchayat" becomes "Saturday 8pm, Panchayat, on Prime
// Video", with the link ready at the time. It is an ordinary plan of kind
// `together`: the same table, the same create and answer path in
// api/plans.mjs, and the same one-hour reminder. This module only says what
// such a plan may carry (a platform from Pasand's list and one plain https
// link, under Pasand's own rules) and who may make one from a recommendation
// (its sender or one of the people it was sent to, nobody else).
//
// The top of this file imports only the Pasand rules, which import nothing,
// so the pure parts are checked in the gate before npm install.
import { isPlatform, isRecKind, platformName, cleanLink, credRisk } from './_pasandrules.mjs';

export const TOGETHER_KIND = 'together';
export const TOGETHER_ANSWERS = [['in', 'I am in'], ['maybe', 'Maybe'], ['no', 'Cannot']];
export const isTogetherAnswer = (a) => TOGETHER_ANSWERS.some(x => x[0] === a);

// The words on the button and the plan: by what kind of thing it is.
const VERBS = { show: ['watch', '🍿', 'Watch'], film: ['watch', '🍿', 'Watch'], song: ['listen', '🎧', 'Listen'], album: ['listen', '🎧', 'Listen'],
                game: ['play', '🎮', 'Play'], eat: ['go', '📍', 'Go'], book: ['read', '📚', 'Read'], other: ['do', '🤝', 'Do it'] };
export function togetherVerb(recKind) {
  const v = VERBS[recKind] || VERBS.show;
  return { key: v[0], icon: v[1], label: v[2] + ' together' };
}

// "Open it" shows from 10 minutes before the time until 3 hours after.
export const TOGETHER_OPEN = { beforeMin: 10, afterMin: 180 };
export function togetherOpenNow(at, now) {
  const t = new Date(at).getTime(), n = now == null ? Date.now() : new Date(now).getTime();
  if (isNaN(t) || isNaN(n)) return false;
  return n >= t - TOGETHER_OPEN.beforeMin * 60000 && n <= t + TOGETHER_OPEN.afterMin * 60000;
}

// "On Prime Video", or nothing when no platform (or "Other") was named.
export function togetherOn(platform) {
  const on = platform && platform !== 'other' ? platformName(platform) : '';
  return on ? 'On ' + on : '';
}

// The default day and time: this Saturday at 8pm on the viewer's own clock,
// or next Saturday when that has already gone. Works on plain numbers so the
// app and the tests agree. day: 0 Sunday .. 6 Saturday.
export function togetherDaysToSaturday(day, hour, minute) {
  const d = (6 - day + 7) % 7;
  return d === 0 && (hour > 20 || (hour === 20 && minute > 0)) ? 7 : d;
}

// Said above the button, and by the server when the yes is missing.
export const togetherShareLine = (word) => 'Everyone in the ' + (word === 'group' ? 'group' : 'family') + ' will see this plan and its link.';

let ready = false;
export async function ensureTogetherSchema(sql) {
  if (ready) return;
  const { schemaOnce } = await import('./_db.mjs');
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  await schemaOnce(() => togetherColumns(sql));
  ready = true;
}
async function togetherColumns(sql) {
  await sql`alter table plans add column if not exists platform text`;
  await sql`alter table plans add column if not exists link text`;
  await sql`alter table plans add column if not exists rec_id uuid`;
  await sql`alter table plans add column if not exists rec_kind text`;
  await sql`alter table plans add column if not exists invited uuid[] not null default '{}'`;
  await sql`alter table plans add column if not exists maybe uuid[] not null default '{}'`;
  await sql`alter table plans add column if not exists cannot uuid[] not null default '{}'`;
}

// What a `together` plan carries, checked. Returns { error, status } or
// { title, platform, link, recId, recKind, invited }.
export async function togetherPrepare(sql, circle, me, body) {
  const [{ isUuid }, { noteRisk }] = await Promise.all([import('./_db.mjs'), import('./_notesapi.mjs')]);
  const bad = (error, status) => ({ error, status: status || 400 });
  const word = circle.kind === 'group' ? 'group' : 'family';
  let title = String(body.title || '').replace(/\s+/g, ' ').trim();
  let platform = null, link = null, recId = null, recKind = null, between = [];

  if (body.recId != null && body.recId !== '') {
    if (!isUuid(body.recId)) return bad('Bad recommendation');
    const { ensurePasandSchema } = await import('./_pasand.mjs');
    await ensurePasandSchema(sql);
    // Only whoever sent it, or one of the people it was sent to, can read a
    // recommendation; so only they can make a plan from it.
    const r = await sql`
      select r.id, r.title, r.kind, r.platform, r.link, r.by_member, r.to_all,
             (select coalesce(array_agg(t.member_id), '{}') from pasand_rec_to t where t.rec_id = r.id) as tos
      from pasand_recs r
      where r.id = ${body.recId} and r.circle_id = ${circle.id}
        and (r.by_member = ${me.id} or exists (select 1 from pasand_rec_to t where t.rec_id = r.id and t.member_id = ${me.id}))`;
    if (!r[0]) return bad('That recommendation is not here any more', 404);
    // A plan is seen by the whole circle. A recommendation that went to
    // some people only becomes public this way, name and link, so it takes
    // an explicit yes; one that went to everyone already is.
    if (!r[0].to_all && body.shareConfirmed !== true) return bad(togetherShareLine(word), 409);
    // The name, the platform and the link come from the recommendation as
    // it was saved, never from what the phone sends.
    title = r[0].title; platform = r[0].platform || null; link = r[0].link || null;
    recId = r[0].id; recKind = r[0].kind;
    // The people it was between, as this person knows them: the sender sees
    // everyone it went to; a recipient sees only the sender.
    between = r[0].by_member === me.id ? (r[0].tos || []) : [r[0].by_member];
  } else {
    if (body.platform != null && body.platform !== '') {
      if (!isPlatform(body.platform)) return bad('Pick where it is from the list.');
      platform = body.platform;
    }
    const l = cleanLink(body.link);
    if (l.error) return bad(l.error);
    link = l.value;
    if (body.recKind != null && body.recKind !== '') {
      if (!isRecKind(body.recKind)) return bad('Pick what kind of thing it is.');
      recKind = body.recKind;
    }
  }
  if (!title) return bad('Give the plan a name');
  if (title.length > 100) return bad('The name can be up to 100 letters. Make it shorter.');
  // The link is checked again even when it came from a recommendation: one
  // rule, in one place, for every link a plan can open.
  const again = cleanLink(link);
  if (again.error) return bad(again.error);
  for (const v of [title, link]) { const risk = noteRisk(v) || credRisk(v); if (risk) return bad(risk); }

  let invited;
  if (Array.isArray(body.invite)) {
    const ids = [...new Set(body.invite)].filter(id => id !== me.id);
    if (ids.length > 60 || !ids.every(isUuid)) return bad('Bad person');
    // In this circle AND not marked as remembered: the picker leaves such a
    // person out, and this is the rule itself, for a request made by hand.
    const rows = ids.length ? await sql`select m.id, m.name, coalesce((to_jsonb(m)->>'remembered')::boolean, false) as remembered
                                        from members m where m.circle_id = ${circle.id} and m.id = any(${ids}::uuid[])` : [];
    if (rows.length !== ids.length) return bad('Pick people from this ' + word + '.');
    const lost = rows.find(m => m.remembered);
    if (lost) return bad(lost.name + ' is remembered here, so cannot be invited.');
    invited = ids;
  } else {
    // The people a recommendation was between, minus anyone since marked.
    const ids = between.filter(id => id && id !== me.id);
    const gone = ids.length ? await sql`select m.id from members m where m.circle_id = ${circle.id} and m.id = any(${ids}::uuid[])
                                          and coalesce((to_jsonb(m)->>'remembered')::boolean, false)` : [];
    invited = ids.filter(id => !gone.some(g => g.id === id));
  }
  return { title, platform, link, recId, recKind, invited };
}

// I am in, Maybe, Cannot: one answer per person, changed in place. The
// existing `going` list is still the "in" list, so the reminder an hour
// before reaches exactly the people who said yes.
export async function togetherAnswer(sql, circle, me, planId, answer) {
  const a = isTogetherAnswer(answer) ? answer : null;
  if (!a) return { status: 400, json: { ok: false, error: 'Pick one answer.' } };
  const r = await sql`
    update plans set
      going  = case when ${a} = 'in'    then array_append(array_remove(going, ${me.id}::uuid), ${me.id}::uuid)  else array_remove(going, ${me.id}::uuid) end,
      maybe  = case when ${a} = 'maybe' then array_append(array_remove(maybe, ${me.id}::uuid), ${me.id}::uuid)  else array_remove(maybe, ${me.id}::uuid) end,
      cannot = case when ${a} = 'no'    then array_append(array_remove(cannot, ${me.id}::uuid), ${me.id}::uuid) else array_remove(cannot, ${me.id}::uuid) end
    where id = ${planId} and circle_id = ${circle.id}
    returning id, title, by_member`;
  if (!r[0]) return { status: 404, json: { ok: false, error: 'Plan not found' } };
  return { status: 200, json: { ok: true, answer: a, going: a === 'in' }, plan: r[0] };
}
