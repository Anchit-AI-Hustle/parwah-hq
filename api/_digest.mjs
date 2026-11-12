// "AAJ KYA HUA": what happened in the family today, a daily digest from Ekta.
// Behind /api/ekta (the project is at its serverless-function cap, so this is
// a module, not a route). The caller has already passed requireMember there.
//
//   POST /api/ekta { code, memberId, action: 'digest' }
//        -> { digest: { day, text, since, writtenAt, by, how, final, quiet, vote, evening } }
//   POST /api/ekta { code, memberId, action: 'digest_vote', vote: 'up' | 'down' }
//   POST /api/ekta { code, memberId, action: 'digest_evening', on: true | false }
//
// WHAT GOES IN. Only what THIS member may already open: digestGather() reads
// each feature with that feature's own visibility rule in the SQL, and
// digestFacts() (api/_digestrules.mjs) checks again. Notes, the vault, the
// register and health numbers are never read here at all.
//
// TWO WAYS TO WRITE IT.
//   (a) digestWrite(): plain sentences from the list. No model, no key, free.
//       This is the default and it is complete on its own.
//   (b) With ANTHROPIC_API_KEY set on the server, the list (its sentences
//       only, never a database row) is sent once and the reply is checked by
//       digestCheck(). Any failure, a timeout or a refusal falls back to (a)
//       without a word.
//
// WHAT IT COSTS. At most ONE model call per member per day, made only when
// that member opens the digest in the evening (never by the timer, never for
// someone who does not look). The text is kept in digest_daily, so opening it
// again is free. A circle gets at most DG.capPerCircle model calls a day
// (digest_usage counts them, so the owner can see the usage); past that,
// everyone gets (a). NO COINS ARE CHARGED for the digest: the owner accepted
// this small cost, and a family should not pay to hear about its own day.
//
// Before 6pm the digest is "the day so far": always (a), rewritten on each
// look. From 6pm the first look writes the day's digest and keeps it. If
// something that matters happens later (an SOS, a missed check-in), the kept
// text is shown with one "Since then:" line written by (a). No second call.
import { schemaOnce, rateLimit, spaceWord } from './_db.mjs';
import { fail } from './_fail.mjs';
import { dayIn, reqTz, validTz, fromWall } from './_recur.mjs';
import { pushCircle } from './_push.mjs';
import { placeOf } from './_places.mjs';
import { remembranceDue } from './_rememberrules.mjs';
import { DG, digestFacts, digestWrite, digestFirst, digestSince, digestPrompt, digestCheck, digestHour } from './_digestrules.mjs';

const HOME_TZ = 'Asia/Kolkata';
export const DIGEST_HOW = 'Written by Ekta from what you can see in the family today.';

// For tests only: a stand-in model, a fixed clock, a short timeout and a
// push recorder. Production never sets these.
export const digestSeams = { callModel: null, now: null, timeoutMs: null, push: null };

let ready = false;
export async function ensureDigestSchema(sql) {
  if (ready) return;
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  await schemaOnce(() => digestTables(sql));
  ready = true;
}
async function digestTables(sql) {
  // One row per member per day: the kept text, what it was written from
  // (keys only), who wrote it, and that member's thumbs up or down.
  await sql`create table if not exists digest_daily (
    member_id uuid not null references members(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    day date not null,
    text text not null,
    fact_keys text[] not null default '{}',
    final boolean not null default false,
    by_model boolean not null default false,
    model_tried boolean not null default false,
    model text,
    written_at timestamptz not null default now(),
    vote smallint,
    voted_at timestamptz,
    primary key (member_id, day)
  )`;
  await sql`create index if not exists digest_daily_circle on digest_daily (circle_id, day)`;
  // The owner's counter: model calls made and digests the model wrote, per
  // circle per day (UTC). The cap is enforced on this row, in one statement.
  await sql`create table if not exists digest_usage (
    circle_id uuid not null references circles(id) on delete cascade,
    day date not null,
    calls int not null default 0,
    written int not null default 0,
    primary key (circle_id, day)
  )`;
  // ONE MODEL CALL PER MEMBER PER UTC DAY, as well as per local day. The
  // local day comes from a header the phone sends, so changing the zone
  // could make "a new day" and buy another call. This row cannot be bought:
  // it is keyed on the server's own clock.
  await sql`create table if not exists digest_model_claim (
    member_id uuid not null references members(id) on delete cascade,
    day date not null,
    at timestamptz not null default now(),
    primary key (member_id, day)
  )`;
  // The flag every digest reads, so its read can only fail for a real
  // reason (see digestGather), never because no other module made it yet.
  await sql`alter table members add column if not exists remembered boolean not null default false`;
  // "Tell me each evening": off until the member turns it on. pushed_for is
  // the claim, so the 8pm notification goes once a day however many timers run.
  await sql`create table if not exists digest_prefs (
    member_id uuid primary key references members(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    evening boolean not null default false,
    tz text,
    pushed_for date,
    updated_at timestamptz not null default now()
  )`;
}

// The viewer's day, as instants: today and tomorrow in their own zone.
function digestWindow(tz, nowMs) {
  const zone = validTz(tz) || HOME_TZ, today = dayIn(zone, nowMs);
  const [y, m, d] = today.split('-').map(Number);
  const at = (k) => new Date(fromWall({ y, m, d: d + k, h: 0, mi: 0, s: 0 }, zone));
  const tomorrow = dayIn(zone, at(1).getTime() + 12 * 3600000);
  return { zone, today, start: at(0), end: at(1), end2: at(2), tomorrowMd: tomorrow.slice(5) };
}

// EVERYTHING THE VIEWER MAY SEE ABOUT TODAY, AND NOTHING ELSE. Each read is
// on its own: a family that never opened a feature has no table for it, and
// that must not cost them the rest of the digest.
export async function digestGather(sql, circle, me, tz, nowMs = Date.now()) {
  const w = digestWindow(tz, nowMs), now = new Date(nowMs), cid = circle.id, mid = me.id;
  const q = async (f) => { try { return (await f()) || []; } catch (e) { return []; } };
  const people = await sql`select id, name, user_id is not null as on_app, created_at, to_char(dob, 'MM-DD') as bd
                           from members where circle_id = ${cid}`;
  // WHO IS REMEMBERED. If this one read fails, the digest must not go on as
  // if nobody were: it would name someone who has passed away as though
  // they had a day today. So it fails safe: nobody but the viewer may be
  // named, and no day of remembrance is announced from half-read data.
  let remembered = new Set(), unsure = false;
  try { remembered = new Set((await sql`select id from members where circle_id = ${cid} and remembered`).map(r => r.id)); }
  catch (e) { unsure = true; }
  const raw = { viewerId: mid, word: spaceWord(circle), tz: w.zone, unsure,
    people: people.map(p => ({ id: p.id, name: p.name, remembered: unsure ? p.id !== mid : remembered.has(p.id) })) };

  // Check-ins are on the family feed, which every member reads.
  raw.checkins = (await q(() => sql`
    select member_id as id, min(created_at) as at from events
    where circle_id = ${cid} and type = 'checkin' and member_id is not null
      and created_at >= ${w.start} and created_at < ${w.end} and created_at <= ${now}
    group by member_id`)).map(r => ({ id: r.id, at: r.at }));
  // A missed check-in: the whole family was told when it was missed.
  raw.missed = (await q(() => sql`
    select id from members where circle_id = ${cid}
      and quiet_alerted_at >= ${w.start} and quiet_alerted_at < ${w.end} and quiet_alerted_at <= ${now}`)).map(r => r.id);
  // Medicines: counts only, and only for medicines this member may read
  // (the rule api/_doses.mjs uses). A name of a medicine never leaves here.
  raw.meds = (await q(() => sql`
    select d.person_id as id,
           count(*) filter (where d.status = 'taken')::int as taken,
           count(*) filter (where d.status = 'skipped')::int as skipped,
           count(*) filter (where d.status = 'due' and d.due_at < ${new Date(nowMs - DG.graceMin * 60000)})::int as unmarked
    from medicine_doses d join family_book b on b.id = d.medicine_id
    where d.circle_id = ${cid} and d.due_at >= ${w.start} and d.due_at < ${w.end} and d.due_at <= ${now}
      and (b.visibility = 'circle' or b.about_member = ${mid} or b.by_member = ${mid}
           or exists (select 1 from book_access ba where ba.entry_id = b.id and ba.member_id = ${mid}))
    group by d.person_id`)).map(r => ({ id: r.id, taken: r.taken, skipped: r.skipped, unmarked: r.unmarked }));
  // An SOS goes to the whole family the moment it is raised.
  raw.sos = (await q(() => sql`
    select id, member_id, created_at, status, resolved_at from sos
    where circle_id = ${cid} and created_at >= ${w.start} and created_at < ${w.end} and created_at <= ${now}
    order by created_at limit 5`)).map(r => ({ sosId: r.id, id: r.member_id, at: r.created_at, open: r.status !== 'resolved', closedAt: r.resolved_at }));
  // Plans belong to the whole circle.
  raw.plansTomorrow = (await q(() => sql`
    select id, title, at from plans where circle_id = ${cid} and at >= ${w.end} and at < ${w.end2} order by at limit 3`))
    .map(r => ({ planId: r.id, title: r.title, at: r.at }));
  raw.plansMade = (await q(() => sql`
    select id, title, by_member from plans
    where circle_id = ${cid} and created_at >= ${w.start} and created_at < ${w.end} and created_at <= ${now} and at > ${now}
    order by created_at limit 3`)).map(r => ({ planId: r.id, title: r.title, by: r.by_member }));
  // Tomorrow: birthdays and anniversaries, which every member's page shows.
  raw.birthdays = people.filter(p => p.bd && p.bd === w.tomorrowMd).map(p => p.id);
  raw.anniversaries = (await q(() => sql`
    select id, anniv_with from members where circle_id = ${cid} and anniversary is not null
      and to_char(anniversary, 'MM-DD') = ${w.tomorrowMd}`)).map(r => [r.id, r.anniv_with].filter(Boolean));
  // A day of remembrance (api/_remember.mjs keeps the month and the day a
  // person passed). If those columns are not there yet on this database the
  // read fails and gives nothing. "Tomorrow" is worked out by the same rule
  // as the family's reminder (remembranceDue in _rememberrules.mjs), on the
  // clock of the person's own place: so 29 February falls on 28 February in
  // a year without one, here exactly as it does there.
  raw.remembrance = unsure ? [] : (await q(() => sql`
    select id, place, country, passed_year, passed_month, passed_day from members where circle_id = ${cid} and remembered
      and passed_month is not null and passed_day is not null`))
    .filter(m => {
      const due = remembranceDue({ year: m.passed_year, month: m.passed_month, day: m.passed_day }, nowMs + 86400000, placeOf(m.place, m.country, null).tz);
      return !!due && due.when === 'day';
    }).map(r => r.id);
  // Tasks: the family's shared list. Counts, not titles.
  raw.tasks = (await q(() => sql`
    select completed_by as id, count(*)::int as n from requests
    where circle_id = ${cid} and status = 'done' and completed_by is not null
      and completed_at >= ${w.start} and completed_at < ${w.end} and completed_at <= ${now}
    group by completed_by`)).map(r => ({ id: r.id, n: r.n }));
  // Stories: the storyteller chose who hears each one (api/_memorybond.mjs).
  raw.stories = (await q(() => sql`
    select s.id, s.about_member, s.visibility, s.share_with from stories s
    where s.circle_id = ${cid} and s.kind = 'story'
      and s.answered_at >= ${w.start} and s.answered_at < ${w.end} and s.answered_at <= ${now}
      and (s.visibility = 'circle' or s.about_member = ${mid} or (s.visibility = 'some' and ${mid} = any(s.share_with)))
    order by s.answered_at limit 3`)).map(r => ({ storyId: r.id, id: r.about_member, visibility: r.visibility, shareWith: r.share_with || [] }));
  raw.recipes = (await q(() => sql`
    select id, by_member, title from recipes
    where circle_id = ${cid} and created_at >= ${w.start} and created_at < ${w.end} and created_at <= ${now}
    order by created_at limit 3`)).map(r => ({ recipeId: r.id, by: r.by_member, title: r.title }));
  // Recommendations: only the ones sent to this member (api/_pasand.mjs).
  raw.recs = (await q(() => sql`
    select r.id, r.by_member, r.title from pasand_recs r
    join pasand_rec_to t on t.rec_id = r.id and t.member_id = ${mid}
    where r.circle_id = ${cid} and r.by_member <> ${mid}
      and r.created_at >= ${w.start} and r.created_at < ${w.end} and r.created_at <= ${now}
    order by r.created_at limit 3`)).map(r => ({ recId: r.id, by: r.by_member, title: r.title, to: [mid] }));
  // Shared cards: never one that is for this member (it is a surprise).
  raw.cards = (await q(() => sql`
    select id, by_member, for_member, for_member2, for_name from cards
    where circle_id = ${cid} and by_member is not null
      and created_at >= ${w.start} and created_at < ${w.end} and created_at <= ${now}
      and for_member is distinct from ${mid} and for_member2 is distinct from ${mid}
    order by created_at limit 3`)).map(r => ({ cardId: r.id, by: r.by_member, forIds: [r.for_member, r.for_member2].filter(Boolean), forName: r.for_name }));
  raw.joined = people.filter(p => p.id !== mid && new Date(p.created_at) >= w.start && new Date(p.created_at) < w.end && new Date(p.created_at) <= now)
    .map(p => ({ id: p.id, onApp: p.on_app }));
  return raw;
}

// (b) THE MODEL, ONCE. The same client and the same model choice as a
// conversation with Ekta (api/ekta.mjs: anthropicClient, MODEL_PRIMARY).
// Loaded only when a call is really made, so the timer never loads the SDK.
async function digestAnthropic({ system, user, maxTokens, timeoutMs }) {
  const { anthropicClient, MODEL_PRIMARY } = await import('./ekta.mjs');
  const client = anthropicClient({ anthropic: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL_PRIMARY,
    max_tokens: maxTokens,
    system: system,
    messages: [{ role: 'user', content: user }]
  }, { timeout: timeoutMs, maxRetries: 0 });
  if (response.stop_reason === 'refusal') return { refusal: true };
  return { text: response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), model: response.model || MODEL_PRIMARY };
}
// Returns { text, model } for a reply that passed the check, otherwise null.
// It never throws: a failure here is a reason to show (a), not an error.
async function digestAskModel(facts) {
  const sent = facts.slice(0, 8), prompt = digestPrompt(sent);
  const ms = digestSeams.timeoutMs || DG.timeoutMs;
  let timer = null;
  try {
    const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error('digest: the model took too long')), ms); });
    const out = await Promise.race([
      (digestSeams.callModel || digestAnthropic)({ system: prompt.system, user: prompt.user, maxTokens: DG.maxTokens, timeoutMs: ms }),
      late]);
    if (!out || out.refusal) return null;
    const checked = digestCheck(out.text, sent);
    return checked.ok ? { text: checked.text, model: String(out.model || 'model').slice(0, 80) } : null;
  } catch (e) { return null; }
  finally { if (timer) clearTimeout(timer); }
}

async function digestRow(sql, memberId, day) {
  return (await sql`select text, fact_keys, final, by_model, written_at, vote from digest_daily
                    where member_id = ${memberId} and day = ${day}::date`)[0] || null;
}

export async function digestOpen(sql, circle, me, tz, nowMs = Date.now()) {
  const zone = validTz(tz) || HOME_TZ, day = dayIn(zone, nowMs), word = spaceWord(circle);
  const facts = digestFacts(await digestGather(sql, circle, me, zone, nowMs));
  const keys = facts.map(f => f.key);
  const evening = digestHour(nowMs, zone) >= DG.eveningHour;
  let row = await digestRow(sql, me.id, day);
  if (!row || !row.final) {
    // The day so far, or (from 6pm) the day's digest. The update only wins
    // while the row is not final, so two phones opening at once make one
    // digest and, below, one model call.
    const mine = await sql`
      insert into digest_daily (member_id, circle_id, day, text, fact_keys, final, written_at)
      values (${me.id}, ${circle.id}, ${day}::date, ${digestWrite(facts, word)}, ${keys}::text[], ${evening}, ${new Date(nowMs)})
      on conflict (member_id, day) do update
        set text = excluded.text, fact_keys = excluded.fact_keys, final = excluded.final, written_at = excluded.written_at
        where digest_daily.final = false
      returning text, fact_keys, final, by_model, written_at, vote`;
    if (mine[0] && evening) row = await digestByModel(sql, circle, me, day, facts, nowMs) || mine[0];
    else row = mine[0] || await digestRow(sql, me.id, day);
  }
  const pref = (await sql`select evening from digest_prefs where member_id = ${me.id}`)[0];
  // The phone's zone today, so the 8pm notification is 8pm where they are.
  if (pref) await sql`update digest_prefs set tz = ${zone} where member_id = ${me.id} and tz is distinct from ${zone}`;
  return {
    day, text: row.text, since: row.final ? digestSince(facts, row.fact_keys) : '',
    writtenAt: row.written_at, by: row.by_model ? 'ekta' : 'plain', how: row.by_model ? DIGEST_HOW : '',
    final: !!row.final, quiet: !(row.fact_keys || []).length,
    vote: row.vote === 1 ? 'up' : row.vote === -1 ? 'down' : null, evening: !!(pref && pref.evening)
  };
}

// Called only by the one request that just made the day's digest final.
async function digestByModel(sql, circle, me, day, facts, nowMs) {
  // A quiet day needs no model, and with no key on the server there is none.
  if (!facts.length || !process.env.ANTHROPIC_API_KEY) return null;
  const utcDay = new Date(nowMs).toISOString().slice(0, 10);
  // At most one call per member per UTC day, whatever local day the phone
  // names. Taken before the circle's cap, so a refused try costs nothing.
  const once = await sql`insert into digest_model_claim (member_id, day) values (${me.id}, ${utcDay}::date)
                         on conflict do nothing returning member_id`;
  if (!once[0]) return null;
  // The cap, taken in one statement so two members cannot both be the 12th.
  const slot = await sql`
    insert into digest_usage (circle_id, day, calls) values (${circle.id}, ${utcDay}::date, 1)
    on conflict (circle_id, day) do update set calls = digest_usage.calls + 1
      where digest_usage.calls < ${DG.capPerCircle}
    returning calls`;
  if (!slot[0]) return null;
  await sql`update digest_daily set model_tried = true where member_id = ${me.id} and day = ${day}::date`;
  const out = await digestAskModel(facts);
  if (!out) return null;
  const up = await sql`update digest_daily set text = ${out.text}, by_model = true, model = ${out.model}
                       where member_id = ${me.id} and day = ${day}::date
                       returning text, fact_keys, final, by_model, written_at, vote`;
  await sql`update digest_usage set written = written + 1 where circle_id = ${circle.id} and day = ${utcDay}::date`;
  return up[0] || null;
}

export async function digestHandle(sql, circle, me, req, res) {
  try {
    await ensureDigestSchema(sql);
    const body = req.body || {}, action = String(body.action || '');
    const tz = validTz(me.tz) || reqTz(req) || HOME_TZ;
    const nowMs = digestSeams.now ? digestSeams.now() : Date.now();
    if (action === 'digest') {
      if (!(await rateLimit(sql, 'digest', me.id, 40, 600))) {
        return res.status(429).json({ ok: false, error: 'You have opened this many times in a few minutes. Try again a little later.' });
      }
      return res.status(200).json({ ok: true, digest: await digestOpen(sql, circle, me, tz, nowMs) });
    }
    if (action === 'digest_vote') {
      const v = body.vote === 'up' ? 1 : body.vote === 'down' ? -1 : 0;
      if (!v) return res.status(400).json({ ok: false, error: 'Choose thumbs up or thumbs down.' });
      // One per member per day: the row is the day, so a second tap changes it.
      const r = await sql`update digest_daily set vote = ${v}, voted_at = now()
                          where member_id = ${me.id} and day = ${dayIn(tz, nowMs)}::date returning vote`;
      if (!r[0]) return res.status(404).json({ ok: false, error: 'Open today\'s note first, then say what you think.' });
      return res.status(200).json({ ok: true, vote: v === 1 ? 'up' : 'down' });
    }
    if (action === 'digest_evening') {
      const on = body.on === true;
      await sql`insert into digest_prefs (member_id, circle_id, evening, tz) values (${me.id}, ${circle.id}, ${on}, ${tz})
                on conflict (member_id) do update set evening = excluded.evening, tz = excluded.tz, circle_id = excluded.circle_id, updated_at = now()`;
      return res.status(200).json({ ok: true, evening: on });
    }
    return res.status(400).json({ ok: false, error: 'Ekta does not know that request.' });
  } catch (e) { return fail(res, e); }
}

// THE TIMER'S SHARE (runTick in api/events.mjs): for a member who turned on
// "Tell me each evening", ONE notification at 8pm their time, with the first
// sentence of the plain version. The timer never asks the model for anything.
export async function digestSweep(sql, circleId, nowMs = Date.now()) {
  await ensureDigestSchema(sql);
  const who = await sql`select p.member_id, p.tz from digest_prefs p join members m on m.id = p.member_id
                        where p.circle_id = ${circleId} and p.evening and m.user_id is not null`;
  if (!who.length) return 0;
  const circle = (await sql`select id, name, kind, code from circles where id = ${circleId}`)[0];
  if (!circle) return 0;
  let sent = 0;
  for (const p of who) {
    const zone = validTz(p.tz) || HOME_TZ, hour = digestHour(nowMs, zone);
    if (hour < DG.pushHour || hour >= DG.pushUntilHour) continue;
    const day = dayIn(zone, nowMs);
    const claim = await sql`update digest_prefs set pushed_for = ${day}::date
                            where member_id = ${p.member_id} and evening and pushed_for is distinct from ${day}::date returning member_id`;
    if (!claim[0]) continue;      // another timer got there first
    const facts = digestFacts(await digestGather(sql, circle, { id: p.member_id }, zone, nowMs));
    await (digestSeams.push || pushCircle)(sql, circleId,
      { title: '🌙 Aaj kya hua', body: digestFirst(facts, spaceWord(circle)), url: '/#home' }, { only: p.member_id });
    sent++;
  }
  return sent;
}
