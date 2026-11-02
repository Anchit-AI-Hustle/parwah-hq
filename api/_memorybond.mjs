// FAMILY MEMORY, THE BONDING HALF: stories, yaadein, recipes and the private
// reach-out nudge. Behind /api/book?area=bond (the project is at its
// serverless-function cap, so nothing here is a route of its own).
//
//   GET  /api/book?area=bond&view=today   -> { teller, invites, ask, throwback, yaad, nudge }
//   GET  /api/book?area=bond&view=memory  -> { stories, tellers, members, questions, recipes, prefs, throwbacks }
//   GET  /api/book?area=bond&view=audio&kind=story|recipe&id=   -> { audio }
//   GET  /api/book?area=bond&view=recipe&id=   -> { recipe } (with photo and voice)
//   GET  /api/book?area=bond&view=yaadphoto&key=   -> { photo }
//   POST /api/book?area=bond {code, memberId, action, ...}
//        teller_invite {targetId}     the family picks a storyteller
//        teller_answer {yes}          the storyteller says yes on their own screen
//        teller_stop                  the storyteller stops, any time
//        story_answer  {id, text?, audio?, mime?, secs?, visibility?, shareWith?}
//        story_skip    {id}           not asked again for 8 weeks
//        story_visibility {id, visibility, shareWith?}
//        story_remove  {id}
//        question_suggest {text, forId?, kind?}
//        throwback_answer {text}      a group's weekly question
//        recipe_add / recipe_edit {id} / recipe_remove {id}
//        yaad_send {key} / yaad_hide {key}
//        prefs {nudgesOn?, nudgeWeeks?, nudgeSkip?, hidePeople?, hideRanges?}
//        remembered {targetId, on}    no automatic memories about this person
//        nudge_act {act: later|call|voice|never}
//
// EK SAWAAL. "Every Sunday Papa gets one question; he answers by voice; the
// grandchildren hear it." The family asks someone to be a storyteller; it
// stays off until that person says yes on their own screen (the quiet-day
// rule). Each storyteller then gets ONE question a week, claimed by one
// insert on the (person, week) unique index, so however many phones poll,
// it is asked once and pushed once. Skip is quiet, and a skipped question
// is not asked again for 8 weeks. The storyteller decides who hears each
// answer: the subject owns consent, as everywhere in Family Memory.
//
// YAADEIN. At most one a day per person, claimed by the (person, day) key:
// something from this date in past years. Never about anyone the family has
// marked "remembered", never a person or dates this person hid.
//
// THE NUDGE. Opt-in, private, at most weekly (the (person, week) key), never
// a score and never a word about how anyone feels. Computed while the app
// polls, like every timed thing here.
import { db, ensureSchema, requireMember, isUuid, schemaOnce, ensureCircleChat, spaceWord } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { safeImageUri } from './_sec.mjs';
import { dayIn, reqTz, validTz } from './_recur.mjs';
import { STORY_SEED, THROWBACK_SEED } from './_bondseed.mjs';

export const BOND = {
  skipWeeks: 8,                    // a skipped question rests this long
  audioTypes: ['audio/webm', 'audio/ogg', 'audio/mp4'],
  audioMaxBytes: 720000,           // 3 minutes at 24 kbps, with room to spare
  audioMaxSecs: 180,
  photoMaxChars: 160000,           // one small photo, about 120 KB
  nudgeWeeks: [2, 3, 4],
  answerMax: 4000
};
const HOME_TZ = 'Asia/Kolkata';
const clip = (v, n) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, n);
const first = (n) => String(n || '').split(' ')[0];

// Recipes are for food. A family that types a home cure gets a kind no.
const NOT_FOOD = /\b(nuskh\w*|gharelu\s+upay|remed(y|ies)|cures?|medicinal|ilaaj|upchar|dawa(i|ai)?)\b/i;
// A question about living, never about the end.
const MORBID = /(too late|\bdeath\b|\bdie\b|\bdying\b|funeral|last wish|\bantim\b|\bmaut\b|\bmarne\b|\bcure\b|\bdisease\b|\billness\b)/i;

// The family's day and week. A week starts on Sunday.
export function dayOf(nowMs, tz) { return dayIn(validTz(tz) || HOME_TZ, nowMs); }
export function weekOf(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return new Date(Date.UTC(y, m - 1, d - t.getUTCDay())).toISOString().slice(0, 10);
}
function addDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// A voice note: an allowed type, base64 and nothing else, under the cap.
export function audioCheck(mimeIn, dataIn, secsIn) {
  const mime = String(mimeIn || '').split(';')[0].trim().toLowerCase();
  if (!BOND.audioTypes.includes(mime)) return { err: 'That recording type is not supported' };
  const data = String(dataIn || '').replace(/^data:[^,]*,/, '');
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { err: 'That recording could not be read' };
  if (Math.floor(data.length * 3 / 4) > BOND.audioMaxBytes) return { err: 'That recording is too long. Keep it under 3 minutes.' };
  const secs = Math.max(1, Math.min(BOND.audioMaxSecs, parseInt(secsIn, 10) || 1));
  return { uri: 'data:' + mime + ';base64,' + data, secs };
}

let ready = false;
export async function ensureBondSchema(sql) {
  if (ready) return;
  await schemaOnce(async () => {
    await sql`alter table members add column if not exists remembered boolean not null default false`;
    await sql`create table if not exists story_questions (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid references circles(id) on delete cascade,
      seed_key text unique,
      seed_no int,
      kind text not null default 'story',
      text text not null,
      for_member uuid references members(id) on delete cascade,
      by_member uuid references members(id) on delete set null,
      created_at timestamptz not null default now()
    )`;
    await sql`create table if not exists story_tellers (
      member_id uuid primary key references members(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      status text not null default 'asked',
      asked_by uuid references members(id) on delete set null,
      asked_at timestamptz not null default now(),
      decided_at timestamptz
    )`;
    await sql`create table if not exists stories (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      kind text not null default 'story',
      about_member uuid not null references members(id) on delete cascade,
      question_id uuid references story_questions(id) on delete set null,
      question text not null,
      answer_text text,
      audio text,
      audio_secs int,
      visibility text not null default 'circle',
      share_with uuid[] not null default '{}',
      ask_week date not null,
      asked_at timestamptz not null default now(),
      answered_at timestamptz,
      skipped_at timestamptz
    )`;
    await sql`create unique index if not exists stories_week_once on stories (about_member, ask_week) where kind = 'story'`;
    await sql`create unique index if not exists stories_throwback_once on stories (about_member, ask_week) where kind = 'throwback'`;
    await sql`create index if not exists stories_circle on stories (circle_id, answered_at desc)`;
    await sql`create table if not exists throwback_weeks (
      circle_id uuid not null references circles(id) on delete cascade,
      week date not null,
      question_id uuid references story_questions(id) on delete set null,
      question text not null,
      primary key (circle_id, week)
    )`;
    await sql`create table if not exists recipes (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      by_member uuid references members(id) on delete set null,
      title text not null,
      from_whom text,
      memory text,
      ingredients text,
      steps text,
      audio text,
      audio_secs int,
      photo text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
    await sql`create index if not exists recipes_circle on recipes (circle_id, updated_at desc)`;
    await sql`create table if not exists bond_prefs (
      member_id uuid primary key references members(id) on delete cascade,
      nudges_on boolean not null default false,
      nudge_weeks int not null default 3,
      nudge_skip uuid[] not null default '{}',
      hide_people uuid[] not null default '{}',
      hide_ranges jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now()
    )`;
    await sql`create table if not exists yaad_days (
      member_id uuid not null references members(id) on delete cascade,
      day date not null,
      item_key text,
      status text not null default 'shown',
      primary key (member_id, day)
    )`;
    await sql`create table if not exists yaad_hidden (
      member_id uuid not null references members(id) on delete cascade,
      item_key text not null,
      primary key (member_id, item_key)
    )`;
    await sql`create table if not exists bond_nudges (
      member_id uuid not null references members(id) on delete cascade,
      week date not null,
      target_id uuid references members(id) on delete cascade,
      status text not null default 'open',
      at timestamptz not null default now(),
      primary key (member_id, week)
    )`;
    const keys = [], nos = [], kinds = [], texts = [];
    STORY_SEED.forEach((t, i) => { keys.push('s' + (i + 1)); nos.push(i + 1); kinds.push('story'); texts.push(t); });
    THROWBACK_SEED.forEach((t, i) => { keys.push('t' + (i + 1)); nos.push(i + 1); kinds.push('throwback'); texts.push(t); });
    await sql`insert into story_questions (seed_key, seed_no, kind, text)
              select * from unnest(${keys}::text[], ${nos}::int[], ${kinds}::text[], ${texts}::text[])
              on conflict (seed_key) do update set text = excluded.text, seed_no = excluded.seed_no, kind = excluded.kind`;
  });
  ready = true;
}

async function prefsOf(sql, memberId) {
  const r = await sql`select nudges_on, nudge_weeks, nudge_skip, hide_people, hide_ranges from bond_prefs where member_id = ${memberId}`;
  return r[0] || { nudges_on: false, nudge_weeks: 3, nudge_skip: [], hide_people: [], hide_ranges: [] };
}

// ---------------- Ek sawaal: the weekly ask ----------------
// Picks a question for one storyteller: a question suggested for them, then
// one suggested for anyone in the family, then the seed list in order. Never
// one they answered, one they skipped in the last 8 weeks, or one still
// recent and unanswered.
async function pickQuestion(sql, circleId, memberId, week) {
  const restSince = addDays(week, -7 * BOND.skipWeeks);
  const r = await sql`
    select q.id, q.text from story_questions q
    where q.kind = 'story'
      and (q.circle_id is null or q.circle_id = ${circleId})
      and (q.for_member is null or q.for_member = ${memberId})
      and not exists (select 1 from stories s where s.about_member = ${memberId} and s.question_id = q.id
                        and (s.answered_at is not null
                             or s.skipped_at > ${restSince}::date
                             or s.ask_week > ${restSince}::date))
    order by (q.for_member is not null) desc, (q.circle_id is not null) desc, q.seed_no nulls last, q.created_at
    limit 1`;
  return r[0] || null;
}

// Every storyteller in this circle who said yes gets this week's question,
// once. The push goes only to the storyteller, only when the insert wins.
export async function storySweep(sql, circleId, nowMs = Date.now(), tz = HOME_TZ) {
  const week = weekOf(dayOf(nowMs, tz));
  const tellers = await sql`select t.member_id, m.name from story_tellers t join members m on m.id = t.member_id
                            where t.circle_id = ${circleId} and t.status = 'yes' and not m.remembered
                              and not exists (select 1 from stories s where s.about_member = t.member_id and s.ask_week = ${week}::date and s.kind = 'story')`;
  let asked = 0;
  for (const t of tellers) {
    const q = await pickQuestion(sql, circleId, t.member_id, week);
    if (!q) continue;
    const ins = await sql`insert into stories (circle_id, kind, about_member, question_id, question, ask_week)
                          values (${circleId}, 'story', ${t.member_id}, ${q.id}, ${q.text}, ${week}::date)
                          on conflict (about_member, ask_week) where kind = 'story' do nothing returning id`;
    if (ins[0]) {
      asked++;
      await pushCircle(sql, circleId, { title: '📖 This week\'s question', body: q.text, url: '/#home' }, { only: t.member_id });
    }
  }
  return asked;
}

// A group's throwback for the week: a suggested one first, then the seeds in
// turn. Claimed once per group per week.
async function throwbackOf(sql, circle, week) {
  const have = await sql`select question, question_id from throwback_weeks where circle_id = ${circle.id} and week = ${week}::date`;
  if (have[0]) return have[0];
  const used = await sql`select question_id from throwback_weeks where circle_id = ${circle.id} and week > ${addDays(week, -7 * THROWBACK_SEED.length)}::date`;
  const usedIds = used.map(u => u.question_id).filter(Boolean);
  const c = await sql`select id, text from story_questions
                      where kind = 'throwback' and (circle_id is null or circle_id = ${circle.id})
                        and not (id = any(${usedIds}::uuid[]))
                      order by (circle_id is not null) desc, seed_no nulls last, created_at limit 1`;
  const pick = c[0] || (await sql`select id, text from story_questions where kind = 'throwback' and circle_id is null order by random() limit 1`)[0];
  if (!pick) return null;
  await sql`insert into throwback_weeks (circle_id, week, question_id, question) values (${circle.id}, ${week}::date, ${pick.id}, ${pick.text})
            on conflict (circle_id, week) do nothing`;
  const r = await sql`select question, question_id from throwback_weeks where circle_id = ${circle.id} and week = ${week}::date`;
  return r[0] || null;
}

// ---------------- Yaadein: on this day ----------------
function inRanges(day, ranges) {
  return (Array.isArray(ranges) ? ranges : []).some(r => r && r.from && r.to && day >= r.from && day <= r.to);
}
async function yaadCandidates(sql, circle, me, today, tz, prefs) {
  const md = today.slice(5), year = +today.slice(0, 4);
  const hide = (prefs.hide_people || []).filter(isUuid);
  const out = [];
  const st = await sql`
    select s.id, s.question, s.answer_text, s.answered_at, s.about_member, m.name,
           to_char(s.answered_at at time zone ${tz}, 'YYYY-MM-DD') as day
    from stories s join members m on m.id = s.about_member
    where s.circle_id = ${circle.id} and s.answered_at is not null and not m.remembered
      and to_char(s.answered_at at time zone ${tz}, 'MM-DD') = ${md}
      and extract(year from s.answered_at at time zone ${tz}) < ${year}
      and (s.visibility = 'circle' or s.about_member = ${me.id} or (s.visibility = 'some' and ${me.id} = any(s.share_with)))
      and not (s.about_member = any(${hide}::uuid[]))
    order by s.answered_at desc limit 10`;
  st.forEach(s => out.push({ key: 'story:' + s.id, kind: 'story', day: s.day, title: s.name + ' told the family a story',
    text: s.question + (s.answer_text ? ' ' + String(s.answer_text).slice(0, 200) : ''), about: s.about_member }));
  try {
    const pl = await sql`
      select p.id, p.title, p.kind, p.at, p.by_member, to_char(p.at at time zone ${tz}, 'YYYY-MM-DD') as day
      from plans p left join members m on m.id = p.by_member
      where p.circle_id = ${circle.id} and p.at < now()
        and to_char(p.at at time zone ${tz}, 'MM-DD') = ${md}
        and extract(year from p.at at time zone ${tz}) < ${year}
        and coalesce(m.remembered, false) = false
        and (p.by_member is null or not (p.by_member = any(${hide}::uuid[])))
      order by p.at desc limit 10`;
    pl.forEach(p => out.push({ key: 'plan:' + p.id, kind: 'plan', day: p.day, title: p.title,
      text: p.kind === 'call' ? 'A family call' : 'A day the ' + spaceWord(circle) + ' got together', about: p.by_member }));
  } catch (e) { /* no plans yet */ }
  const ph = await sql`
    select msg.id, msg.member_id, m.name, to_char(msg.created_at at time zone ${tz}, 'YYYY-MM-DD') as day
    from messages msg join chats c on c.id = msg.chat_id
    left join members m on m.id = msg.member_id
    where c.circle_id = ${circle.id} and c.kind = 'circle' and msg.kind = 'image'
      and to_char(msg.created_at at time zone ${tz}, 'MM-DD') = ${md}
      and extract(year from msg.created_at at time zone ${tz}) < ${year}
      and coalesce(m.remembered, false) = false
      and (msg.member_id is null or not (msg.member_id = any(${hide}::uuid[])))
    order by msg.created_at desc limit 10`;
  ph.forEach(p => out.push({ key: 'photo:' + p.id, kind: 'photo', day: p.day, title: 'A photo ' + (p.name ? first(p.name) + ' shared' : 'from the ' + spaceWord(circle) + ' chat'),
    text: '', about: p.member_id }));
  const hidden = new Set((await sql`select item_key from yaad_hidden where member_id = ${me.id}`).map(h => h.item_key));
  return out.filter(c => !hidden.has(c.key) && !inRanges(c.day, prefs.hide_ranges))
            .sort((a, b) => (b.day > a.day ? 1 : b.day < a.day ? -1 : 0));
}
async function yaadFor(sql, circle, me, today, tz, prefs) {
  const have = await sql`select item_key, status from yaad_days where member_id = ${me.id} and day = ${today}::date`;
  let row = have[0];
  if (!row) {
    const c = await yaadCandidates(sql, circle, me, today, tz, prefs);
    await sql`insert into yaad_days (member_id, day, item_key) values (${me.id}, ${today}::date, ${c[0] ? c[0].key : null})
              on conflict (member_id, day) do nothing`;
    row = (await sql`select item_key, status from yaad_days where member_id = ${me.id} and day = ${today}::date`)[0];
  }
  if (!row || !row.item_key || row.status !== 'shown') return null;
  // Checked again on every look: hiding a person or a date, or marking
  // someone remembered, takes the card away at once.
  const c = (await yaadCandidates(sql, circle, me, today, tz, prefs)).find(x => x.key === row.item_key);
  if (!c) return null;
  return { key: c.key, kind: c.kind, day: c.day, years: +today.slice(0, 4) - +c.day.slice(0, 4), title: c.title, text: c.text };
}

// ---------------- the reach-out nudge ----------------
async function lastTouch(sql, circleId, meId) {
  const last = {};
  const dm = await sql`
    select cm2.member_id as other, max(m.created_at) as at
    from chats c
    join chat_members cm1 on cm1.chat_id = c.id and cm1.member_id = ${meId}
    join chat_members cm2 on cm2.chat_id = c.id and cm2.member_id <> ${meId}
    join messages m on m.chat_id = c.id
    where c.circle_id = ${circleId} and c.kind = 'dm'
    group by cm2.member_id`;
  dm.forEach(r => { last[r.other] = new Date(r.at).getTime(); });
  try {
    const pl = await sql`select o as other, max(at) as at from plans, unnest(going) as o
                         where circle_id = ${circleId} and kind = 'call' and ${meId} = any(going) and o <> ${meId} and at <= now()
                         group by o`;
    pl.forEach(r => { last[r.other] = Math.max(last[r.other] || 0, new Date(r.at).getTime()); });
  } catch (e) { /* no plans yet */ }
  return last;
}
async function nudgeFor(sql, circle, me, today, prefs, nowMs) {
  if (!prefs.nudges_on) return null;
  const week = weekOf(today);
  let row = (await sql`select target_id, status from bond_nudges where member_id = ${me.id} and week = ${week}::date`)[0];
  if (!row) {
    const skip = (prefs.nudge_skip || []).filter(isUuid);
    const weeks = BOND.nudgeWeeks.includes(prefs.nudge_weeks) ? prefs.nudge_weeks : 3;
    const cut = nowMs - weeks * 7 * 86400000;
    const others = await sql`select id, name, created_at from members
                             where circle_id = ${circle.id} and id <> ${me.id} and not remembered
                               and (user_id is not null or phone is not null)
                               and not (id = any(${skip}::uuid[]))`;
    const meRow = (await sql`select created_at from members where id = ${me.id}`)[0];
    const touch = await lastTouch(sql, circle.id, me.id);
    const since = (o) => Math.max(touch[o.id] || 0, new Date(o.created_at).getTime(), new Date(meRow.created_at).getTime());
    const due = others.filter(o => since(o) < cut).sort((a, b) => since(a) - since(b));
    let pick = null;
    // A family with a call rota: the person the rota is about comes first.
    if (circle.kind !== 'group' && due.length) {
      try {
        const rota = await sql`select about_member from requests where circle_id = ${circle.id} and template = 'callrota'
                                 and status in ('open','assigned','claimed') and template_data->'rota' ? ${me.id}`;
        pick = due.find(o => rota.some(r => r.about_member === o.id)) || null;
      } catch (e) { pick = null; }
    }
    pick = pick || due[0] || null;
    await sql`insert into bond_nudges (member_id, week, target_id, status) values (${me.id}, ${week}::date, ${pick ? pick.id : null}, ${pick ? 'open' : 'none'})
              on conflict (member_id, week) do nothing`;
    row = (await sql`select target_id, status from bond_nudges where member_id = ${me.id} and week = ${week}::date`)[0];
  }
  if (!row || row.status !== 'open' || !row.target_id) return null;
  const t = (await sql`select id, name, phone, user_id is not null as on_app, remembered from members where id = ${row.target_id} and circle_id = ${circle.id}`)[0];
  if (!t || t.remembered || (prefs.nudge_skip || []).includes(t.id)) return null;
  return { targetId: t.id, name: t.name, phone: t.phone || null, onApp: t.on_app };
}

// ---------------- Today ----------------
export async function bondToday(sql, circle, me, nowMs = Date.now(), tz = HOME_TZ) {
  const today = dayOf(nowMs, tz), week = weekOf(today);
  await storySweep(sql, circle.id, nowMs, tz);
  const prefs = await prefsOf(sql, me.id);
  const tRow = (await sql`select t.status, t.asked_by, a.name as asked_name from story_tellers t left join members a on a.id = t.asked_by
                          where t.member_id = ${me.id}`)[0];
  const teller = tRow ? { status: tRow.status, askedBy: tRow.asked_name || null } : null;
  const askR = await sql`select id, question, asked_at from stories where about_member = ${me.id} and kind = 'story'
                         and ask_week = ${week}::date and answered_at is null and skipped_at is null`;
  const ask = tRow && tRow.status === 'yes' && askR[0] ? { id: askR[0].id, question: askR[0].question } : null;
  let throwback = null;
  if (circle.kind === 'group') {
    const tb = await throwbackOf(sql, circle, week);
    if (tb) {
      const ans = await sql`select s.answer_text, s.about_member, m.name from stories s join members m on m.id = s.about_member
                            where s.circle_id = ${circle.id} and s.kind = 'throwback' and s.ask_week = ${week}::date and s.answered_at is not null
                            order by s.answered_at`;
      throwback = { question: tb.question, week, answers: ans.map(a => ({ name: a.name, text: a.answer_text, mine: a.about_member === me.id })) };
    }
  }
  const yaad = await yaadFor(sql, circle, me, today, tz, prefs);
  const nudge = await nudgeFor(sql, circle, me, today, prefs, nowMs);
  return { kind: circle.kind || 'family', teller, ask, throwback, yaad, nudge };
}

// ---------------- Memory ----------------
async function memoryView(sql, circle, me) {
  const stories = await sql`
    select s.id, s.kind, s.about_member, m.name as about_name, s.question, s.answer_text, (s.audio is not null) as has_audio,
           s.audio_secs, s.visibility, s.share_with, s.answered_at, s.ask_week
    from stories s join members m on m.id = s.about_member
    where s.circle_id = ${circle.id} and s.answered_at is not null
      and (s.visibility = 'circle' or s.about_member = ${me.id} or (s.visibility = 'some' and ${me.id} = any(s.share_with)))
    order by s.answered_at desc limit 400`;
  const tellers = await sql`select t.member_id, t.status, m.name, a.name as asked_name from story_tellers t
                            join members m on m.id = t.member_id left join members a on a.id = t.asked_by
                            where t.circle_id = ${circle.id} order by m.name`;
  const members = await sql`select id, name, user_id is not null as on_app, remembered, relation from members where circle_id = ${circle.id} order by created_at`;
  const questions = await sql`select q.id, q.text, q.kind, q.for_member, b.name as by_name from story_questions q left join members b on b.id = q.by_member
                              where q.circle_id = ${circle.id} order by q.created_at desc limit 60`;
  const recipes = await sql`select r.id, r.title, r.from_whom, r.memory, r.ingredients, r.steps, (r.audio is not null) as has_audio,
                                   r.audio_secs, (r.photo is not null) as has_photo, r.by_member, b.name as by_name, r.updated_at
                            from recipes r left join members b on b.id = r.by_member
                            where r.circle_id = ${circle.id} order by r.updated_at desc limit 300`;
  const prefs = await prefsOf(sql, me.id);
  return {
    ok: true, kind: circle.kind || 'family', me: me.id,
    stories: stories.map(s => ({ ...s, mine: s.about_member === me.id, share_with: s.about_member === me.id ? s.share_with : [] })),
    tellers: tellers.map(t => ({ memberId: t.member_id, name: t.name, status: t.status, askedBy: t.asked_name })),
    members, questions,
    recipes: recipes.map(r => ({ ...r, mine: r.by_member === me.id })),
    prefs: { nudgesOn: prefs.nudges_on, nudgeWeeks: prefs.nudge_weeks, nudgeSkip: prefs.nudge_skip || [],
             hidePeople: prefs.hide_people || [], hideRanges: prefs.hide_ranges || [] }
  };
}

export default async function bondApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureBondSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const g = await requireMember(sql, code, memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;
    const tz = validTz(reqTz(req)) || HOME_TZ;
    const nowMs = Date.now();
    const word = spaceWord(circle);

    if (req.method === 'GET') {
      const view = String(q.view || 'today');
      if (view === 'today') return res.status(200).json({ ok: true, ...(await bondToday(sql, circle, me, nowMs, tz)) });
      if (view === 'memory') return res.status(200).json(await memoryView(sql, circle, me));
      if (view === 'audio' || view === 'recipe') {
        if (!isUuid(q.id)) return res.status(400).json({ ok: false, error: 'Bad id' });
        if (view === 'recipe' || q.kind === 'recipe') {
          const r = await sql`select r.*, b.name as by_name from recipes r left join members b on b.id = r.by_member where r.id = ${q.id} and r.circle_id = ${circle.id}`;
          if (!r[0]) return res.status(403).json({ ok: false, error: 'That is not in your ' + word });
          if (view === 'audio') return res.status(200).json({ ok: true, audio: r[0].audio });
          const { circle_id, ...rest } = r[0];
          return res.status(200).json({ ok: true, recipe: { ...rest, mine: r[0].by_member === me.id } });
        }
        const s = await sql`select s.audio from stories s where s.id = ${q.id} and s.circle_id = ${circle.id}
                            and (s.visibility = 'circle' or s.about_member = ${me.id} or (s.visibility = 'some' and ${me.id} = any(s.share_with)))`;
        if (!s[0]) return res.status(403).json({ ok: false, error: 'That is not shared with you' });
        return res.status(200).json({ ok: true, audio: s[0].audio });
      }
      if (view === 'yaadphoto') {
        const key = String(q.key || '');
        const today = dayOf(nowMs, tz);
        const d = (await sql`select item_key, status from yaad_days where member_id = ${me.id} and day = ${today}::date`)[0];
        if (!d || d.item_key !== key || !/^photo:/.test(key) || !isUuid(key.slice(6))) return res.status(403).json({ ok: false, error: 'Not today\'s memory' });
        const p = await sql`select msg.text from messages msg join chats c on c.id = msg.chat_id
                            where msg.id = ${key.slice(6)} and c.circle_id = ${circle.id} and c.kind = 'circle' and msg.kind = 'image'`;
        return res.status(200).json({ ok: true, photo: p[0] ? safeImageUri(p[0].text) : null });
      }
      return res.status(400).json({ ok: false, error: 'Unknown view' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }
    const action = String(body.action || '');
    const bad = (s, e) => res.status(s).json({ ok: false, error: e });
    const memberIn = async (id) => {
      if (!isUuid(id)) return null;
      return (await sql`select id, name, user_id is not null as on_app, remembered from members where id = ${id} and circle_id = ${circle.id}`)[0] || null;
    };
    const sharePick = async (list) => {
      const ids = (Array.isArray(list) ? list : []).filter(isUuid).slice(0, 40);
      if (!ids.length) return [];
      return (await sql`select id from members where circle_id = ${circle.id} and id = any(${ids}::uuid[]) and id <> ${me.id}`).map(r => r.id);
    };

    // ---- storytellers
    if (action === 'teller_invite') {
      const t = await memberIn(body.targetId);
      if (!t) return bad(403, 'That person is not in this ' + word);
      if (!t.on_app) return bad(400, t.name + ' is not on Parwah, so cannot say yes yet');
      if (t.remembered) return bad(400, t.name + ' is remembered here, so is not asked');
      const cur = (await sql`select status, decided_at from story_tellers where member_id = ${t.id}`)[0];
      if (cur && cur.status === 'yes') return res.status(200).json({ ok: true, status: 'yes' });
      if (cur && cur.status === 'asked') return res.status(200).json({ ok: true, status: 'asked' });
      if (cur && cur.status === 'no' && cur.decided_at && new Date(cur.decided_at).getTime() > nowMs - BOND.skipWeeks * 7 * 86400000) {
        return bad(409, first(t.name) + ' said not now. You can ask again in a few weeks.');
      }
      if (t.id === me.id) {
        await sql`insert into story_tellers (member_id, circle_id, status, asked_by, decided_at) values (${me.id}, ${circle.id}, 'yes', ${me.id}, now())
                  on conflict (member_id) do update set status = 'yes', decided_at = now()`;
        await storySweep(sql, circle.id, nowMs, tz);
        return res.status(200).json({ ok: true, status: 'yes' });
      }
      await sql`insert into story_tellers (member_id, circle_id, status, asked_by, asked_at, decided_at) values (${t.id}, ${circle.id}, 'asked', ${me.id}, now(), null)
                on conflict (member_id) do update set status = 'asked', asked_by = ${me.id}, asked_at = now(), decided_at = null`;
      await pushCircle(sql, circle.id, { title: '📖 ' + first(me.name) + ' asks: one story a week?', body: 'Open Parwah to say yes or not now', url: '/#home' }, { only: t.id });
      return res.status(200).json({ ok: true, status: 'asked' });
    }
    if (action === 'teller_answer' || action === 'teller_stop') {
      const yes = action === 'teller_answer' && body.yes === true;
      const cur = (await sql`select status from story_tellers where member_id = ${me.id}`)[0];
      if (!cur && action === 'teller_answer' && !yes) return bad(404, 'Nobody has asked you yet');
      await sql`insert into story_tellers (member_id, circle_id, status, asked_by, decided_at) values (${me.id}, ${circle.id}, ${yes ? 'yes' : 'no'}, ${me.id}, now())
                on conflict (member_id) do update set status = ${yes ? 'yes' : 'no'}, decided_at = now()`;
      if (yes) await storySweep(sql, circle.id, nowMs, tz);
      return res.status(200).json({ ok: true, status: yes ? 'yes' : 'no' });
    }

    // ---- one story
    const ownStory = async (id) => {
      if (!isUuid(id)) return { s: 400, e: 'Bad story' };
      const r = (await sql`select id, about_member, kind, question, answered_at, skipped_at, visibility from stories where id = ${id} and circle_id = ${circle.id}`)[0];
      if (!r) return { s: 403, e: 'That is not in your ' + word };
      if (r.about_member !== me.id) return { s: 403, e: 'Only the storyteller can do that' };
      return { r };
    };
    if (action === 'story_answer') {
      const o = await ownStory(body.id);
      if (o.e) return bad(o.s, o.e);
      if (o.r.kind !== 'story') return bad(400, 'Bad story');
      const text = clip(body.text, BOND.answerMax);
      let audio = null, secs = null;
      if (body.audio) {
        const a = audioCheck(body.mime, body.audio, body.secs);
        if (a.err) return bad(400, a.err);
        audio = a.uri; secs = a.secs;
      }
      if (!text && !audio) return bad(400, 'Say it or type it first');
      const vis = ['circle', 'some', 'private'].includes(body.visibility) ? body.visibility : 'circle';
      const share = vis === 'some' ? await sharePick(body.shareWith) : [];
      if (vis === 'some' && !share.length) return bad(400, 'Pick who can hear it');
      const firstTime = !o.r.answered_at;
      await sql`update stories set answer_text = ${text || null}, audio = coalesce(${audio}, audio), audio_secs = coalesce(${secs}, audio_secs),
                  visibility = ${vis}, share_with = ${share}::uuid[], answered_at = coalesce(answered_at, now()), skipped_at = null
                where id = ${o.r.id}`;
      if (firstTime) {
        if (vis === 'circle') {
          await sql`insert into events (circle_id, member_id, type, text) values (${circle.id}, ${me.id}, 'care', ${me.name + ' answered this week\'s question 📖'})`;
          await pushCircle(sql, circle.id, { title: '📖 ' + first(me.name) + ' told a story', body: o.r.question, url: '/#memory' }, { except: me.id });
        } else {
          for (const id of share) await pushCircle(sql, circle.id, { title: '📖 ' + first(me.name) + ' told you a story', body: o.r.question, url: '/#memory' }, { only: id });
        }
      }
      return res.status(200).json({ ok: true });
    }
    if (action === 'story_skip') {
      const o = await ownStory(body.id);
      if (o.e) return bad(o.s, o.e);
      if (o.r.answered_at) return bad(400, 'That one is already answered');
      await sql`update stories set skipped_at = now() where id = ${o.r.id}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'story_visibility') {
      const o = await ownStory(body.id);
      if (o.e) return bad(o.s, o.e);
      const vis = ['circle', 'some', 'private'].includes(body.visibility) ? body.visibility : 'circle';
      const share = vis === 'some' ? await sharePick(body.shareWith) : [];
      if (vis === 'some' && !share.length) return bad(400, 'Pick who can hear it');
      await sql`update stories set visibility = ${vis}, share_with = ${share}::uuid[] where id = ${o.r.id}`;
      return res.status(200).json({ ok: true, visibility: vis });
    }
    if (action === 'story_remove') {
      const o = await ownStory(body.id);
      if (o.e) return bad(o.s, o.e);
      await sql`delete from stories where id = ${o.r.id}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'question_suggest') {
      const text = clip(body.text, 160);
      if (text.length < 8) return bad(400, 'Write the question in a few words, like "How did you meet?"');
      if (MORBID.test(text)) return bad(400, 'Keep it to a happy question about life, like school, work or a festival.');
      const kind = body.kind === 'throwback' || (body.kind !== 'story' && circle.kind === 'group' && !body.forId) ? 'throwback' : 'story';
      let forId = null;
      if (body.forId) {
        const t = await memberIn(body.forId);
        if (!t) return bad(403, 'That person is not in this ' + word);
        forId = t.id;
      }
      const n = (await sql`select count(*)::int as n from story_questions where circle_id = ${circle.id}`)[0].n;
      if (n >= 300) return bad(400, 'That is a lot of questions already');
      const r = await sql`insert into story_questions (circle_id, kind, text, for_member, by_member) values (${circle.id}, ${kind}, ${text}, ${forId}, ${me.id}) returning id`;
      return res.status(201).json({ ok: true, id: r[0].id, kind });
    }
    if (action === 'throwback_answer') {
      if (circle.kind !== 'group') return bad(400, 'Throwback questions are for groups');
      const text = clip(body.text, 600);
      if (!text) return bad(400, 'Write your answer first');
      const week = weekOf(dayOf(nowMs, tz));
      const tb = await throwbackOf(sql, circle, week);
      if (!tb) return bad(404, 'No question this week');
      await sql`insert into stories (circle_id, kind, about_member, question_id, question, answer_text, ask_week, answered_at)
                values (${circle.id}, 'throwback', ${me.id}, ${tb.question_id}, ${tb.question}, ${text}, ${week}::date, now())
                on conflict (about_member, ask_week) where kind = 'throwback' do update set answer_text = excluded.answer_text`;
      return res.status(200).json({ ok: true });
    }

    // ---- recipes
    if (action === 'recipe_add' || action === 'recipe_edit') {
      const title = clip(body.title, 80);
      if (!title) return bad(400, 'Give the dish a name, like Rajma chawal');
      const from = clip(body.fromWhom, 60), memory = clip(body.memory, 160);
      const ingredients = clip(body.ingredients, 2000), steps = clip(body.steps, 4000);
      if (NOT_FOOD.test([title, from, memory, ingredients, steps].join(' '))) {
        return bad(400, 'Parwah keeps recipes for food only: the dish, who made it, and how to make it.');
      }
      let audio = null, secs = null, photo = null;
      if (body.audio) {
        const a = audioCheck(body.mime, body.audio, body.secs);
        if (a.err) return bad(400, a.err);
        audio = a.uri; secs = a.secs;
      }
      if (body.photo) {
        photo = safeImageUri(body.photo);
        if (!photo || photo.length > BOND.photoMaxChars) return bad(400, 'That photo is too big. Try a smaller one.');
      }
      if (action === 'recipe_add') {
        if (!ingredients && !steps && !audio) return bad(400, 'Add the ingredients, the steps or a voice note');
        const n = (await sql`select count(*)::int as n from recipes where circle_id = ${circle.id}`)[0].n;
        if (n >= 300) return bad(400, 'That is a full cookbook. Remove an old recipe first.');
        const r = await sql`insert into recipes (circle_id, by_member, title, from_whom, memory, ingredients, steps, audio, audio_secs, photo)
                            values (${circle.id}, ${me.id}, ${title}, ${from || null}, ${memory || null}, ${ingredients || null}, ${steps || null}, ${audio}, ${secs}, ${photo})
                            returning id`;
        await sql`insert into events (circle_id, member_id, type, text) values (${circle.id}, ${me.id}, 'care', ${me.name + ' added a recipe: ' + title + ' 🍲'})`;
        return res.status(201).json({ ok: true, id: r[0].id });
      }
      if (!isUuid(body.id)) return bad(400, 'Bad recipe');
      const ex = (await sql`select id, by_member from recipes where id = ${body.id} and circle_id = ${circle.id}`)[0];
      if (!ex) return bad(403, 'That is not in your ' + word);
      if (ex.by_member !== me.id) return bad(403, 'Only whoever added this recipe can change it');
      await sql`update recipes set title = ${title}, from_whom = ${from || null}, memory = ${memory || null}, ingredients = ${ingredients || null},
                  steps = ${steps || null}, audio = case when ${!!body.dropAudio}::boolean then null else coalesce(${audio}, audio) end,
                  audio_secs = case when ${!!body.dropAudio}::boolean then null else coalesce(${secs}, audio_secs) end,
                  photo = case when ${!!body.dropPhoto}::boolean then null else coalesce(${photo}, photo) end, updated_at = now()
                where id = ${ex.id}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'recipe_remove') {
      if (!isUuid(body.id)) return bad(400, 'Bad recipe');
      const ex = (await sql`select id, by_member from recipes where id = ${body.id} and circle_id = ${circle.id}`)[0];
      if (!ex) return bad(403, 'That is not in your ' + word);
      if (ex.by_member !== me.id) return bad(403, 'Only whoever added this recipe can remove it');
      await sql`delete from recipes where id = ${ex.id}`;
      return res.status(200).json({ ok: true });
    }

    // ---- yaadein
    if (action === 'yaad_send' || action === 'yaad_hide') {
      const key = String(body.key || '');
      const today = dayOf(nowMs, tz);
      const d = (await sql`select item_key, status from yaad_days where member_id = ${me.id} and day = ${today}::date`)[0];
      if (!d || d.item_key !== key) return bad(403, 'That is not today\'s memory');
      if (action === 'yaad_hide') {
        await sql`insert into yaad_hidden (member_id, item_key) values (${me.id}, ${key}) on conflict do nothing`;
        await sql`update yaad_days set status = 'hidden' where member_id = ${me.id} and day = ${today}::date`;
        return res.status(200).json({ ok: true });
      }
      if (d.status !== 'shown') return bad(409, 'Already sent');
      const prefs = await prefsOf(sql, me.id);
      const c = (await yaadCandidates(sql, circle, me, today, tz, prefs)).find(x => x.key === key);
      if (!c) return bad(404, 'That memory is not here any more');
      const years = +today.slice(0, 4) - +c.day.slice(0, 4);
      const chatId = await ensureCircleChat(sql, circle.id);
      const line = '🌼 Yaadein: ' + years + (years === 1 ? ' year' : ' years') + ' ago today. ' + c.title + (c.text ? ': ' + c.text : '');
      await sql`insert into messages (chat_id, member_id, text) values (${chatId}, ${me.id}, ${line.slice(0, 1000)})`;
      if (c.kind === 'photo') {
        const p = (await sql`select text from messages where id = ${key.slice(6)}`)[0];
        if (p && safeImageUri(p.text)) await sql`insert into messages (chat_id, member_id, text, kind) values (${chatId}, ${me.id}, ${p.text}, 'image')`;
      }
      await sql`update yaad_days set status = 'sent' where member_id = ${me.id} and day = ${today}::date`;
      return res.status(200).json({ ok: true, chatId });
    }

    // ---- settings
    if (action === 'prefs') {
      const cur = await prefsOf(sql, me.id);
      const inCircle = async (list) => {
        const ids = (Array.isArray(list) ? list : []).filter(isUuid).slice(0, 60);
        if (!ids.length) return [];
        return (await sql`select id from members where circle_id = ${circle.id} and id = any(${ids}::uuid[])`).map(r => r.id);
      };
      const on = body.nudgesOn !== undefined ? !!body.nudgesOn : cur.nudges_on;
      const weeks = body.nudgeWeeks !== undefined ? (BOND.nudgeWeeks.includes(+body.nudgeWeeks) ? +body.nudgeWeeks : 3) : cur.nudge_weeks;
      const skip = body.nudgeSkip !== undefined ? await inCircle(body.nudgeSkip) : (cur.nudge_skip || []);
      const hide = body.hidePeople !== undefined ? await inCircle(body.hidePeople) : (cur.hide_people || []);
      let ranges = cur.hide_ranges || [];
      if (body.hideRanges !== undefined) {
        const ok = /^\d{4}-\d{2}-\d{2}$/;
        ranges = (Array.isArray(body.hideRanges) ? body.hideRanges : []).slice(0, 20)
          .filter(r => r && ok.test(r.from) && ok.test(r.to))
          .map(r => r.from <= r.to ? { from: r.from, to: r.to } : { from: r.to, to: r.from });
      }
      await sql`insert into bond_prefs (member_id, nudges_on, nudge_weeks, nudge_skip, hide_people, hide_ranges, updated_at)
                values (${me.id}, ${on}, ${weeks}, ${skip}::uuid[], ${hide}::uuid[], ${JSON.stringify(ranges)}::jsonb, now())
                on conflict (member_id) do update set nudges_on = excluded.nudges_on, nudge_weeks = excluded.nudge_weeks,
                  nudge_skip = excluded.nudge_skip, hide_people = excluded.hide_people, hide_ranges = excluded.hide_ranges, updated_at = now()`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'remembered') {
      const t = await memberIn(body.targetId);
      if (!t) return bad(403, 'That person is not in this ' + word);
      if (t.id === me.id) return bad(400, 'This is for someone the ' + word + ' remembers');
      await sql`update members set remembered = ${!!body.on} where id = ${t.id}`;
      if (body.on) await sql`update story_tellers set status = 'no', decided_at = now() where member_id = ${t.id}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'nudge_act') {
      const act = String(body.act || '');
      if (!['later', 'call', 'voice', 'never'].includes(act)) return bad(400, 'Bad choice');
      const week = weekOf(dayOf(nowMs, tz));
      const r = (await sql`select target_id from bond_nudges where member_id = ${me.id} and week = ${week}::date and status = 'open'`)[0];
      if (!r) return bad(404, 'Nothing here this week');
      await sql`update bond_nudges set status = ${act === 'call' || act === 'voice' ? 'done' : 'later'}, at = now()
                where member_id = ${me.id} and week = ${week}::date`;
      if (act === 'never' && r.target_id) {
        await sql`insert into bond_prefs (member_id, nudge_skip) values (${me.id}, ${[r.target_id]}::uuid[])
                  on conflict (member_id) do update set nudge_skip = array(select distinct unnest(bond_prefs.nudge_skip || ${[r.target_id]}::uuid[])), updated_at = now()`;
      }
      return res.status(200).json({ ok: true });
    }
    return bad(400, 'Unknown action');
  } catch (e) {
    return fail(res, e);
  }
}
