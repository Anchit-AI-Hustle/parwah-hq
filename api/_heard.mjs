// BEING HEARD, AND ANSWERED. Behind /api/chats?area=heard (no new function:
// the project is at its cap). One read fills every "heard" card on Today,
// and each thing a member says here can be answered by someone.
//
//   GET  /api/chats?area=heard&view=today      -> { mood, baat, shukriya, sawaal, remember }
//   GET  /api/chats?area=heard&view=shukriya   -> { list }  what I may read
//   GET  /api/chats?area=heard&view=audio&kind=baat|baatreply|shukriya|sawaal|rcard&id=
//   POST /api/chats?area=heard {code, memberId, action, ...}
//        mood_set       {value, tell: self|one|family, toId?}       (api/_pulse.mjs)
//        baat_send / baat_reply / baat_seen / baat_close            (api/_baat.mjs)
//        shukriya_send  {toId, line?, audio?, mime?, secs?, audience: two|family}
//        shukriya_later {}                not this week
//        sawaal_answer  {text?, audio?, mime?, secs?, forId?}       forId: for someone not on the app
//        rcard_add      {cardId, kind: text|photo|voice, ...}       the shared memory card
//        rcard_remove   {entryId}
//
// WHO SEES WHAT is said by the queries, never only by the screen:
//   - how I feel today: me; plus one person, or the family, if I chose so;
//   - "I need to talk" and "Maaf karna": the two of us, nobody else;
//   - a shukriya: the two of us, or the family when the writer chose that;
//   - the weekly question: an answer is read only by someone who has
//     answered it themself;
//   - a memory card: the family, on and around the day it keeps.
// Someone marked as remembered is never suggested, asked or pushed.
import { db, ensureSchema, requireMember, isUuid, schemaOnce, rateLimit, spaceWord } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { noteRisk } from './_notesapi.mjs';
import { reqTz, validTz, dayIn } from './_recur.mjs';
import { placeOf } from './_places.mjs';
import { audioCheck } from './_memorybond.mjs';
import { pulseToday, pulseSave } from './_pulse.mjs';
import { pulseCallNudge } from './_familycare.mjs';
import { awardHeard } from './_coins.mjs';
import { ensureBaatSchema, baatList, baatAudio, baatAction, baatSweep } from './_baat.mjs';
import { ensureRememberSchema } from './_remember.mjs';
import { remembranceDue, remembranceLine, yearsLine } from './_rememberrules.mjs';
import { MOODS, MOOD_ASK, BAAT_KINDS, BAAT_REPLIES, BAAT_WHEN_DEFAULT, SHUKRIYA_REST_DAYS, shukriyaPick, shukriyaClean,
         questionFor, weekOfDay, SAWAAL_MAX, toldByLine, waitingFor, waitingLine } from './_heardrules.mjs';

const HOME_TZ = 'Asia/Kolkata';
export const RCARD_PER_PERSON = 3;
const PHOTO_URI = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const PHOTO_MAX = 220000;
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

let ready = false;
export async function ensureHeardSchema(sql) {
  if (ready) return;
  await schemaOnce(() => heardTables(sql));
  ready = true;
}
async function heardTables(sql) {
  await sql`create table if not exists shukriya (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    from_member uuid not null references members(id) on delete cascade,
    to_member uuid not null references members(id) on delete cascade,
    line text,
    audio text,
    audio_secs int,
    audience text not null default 'two' check (audience in ('two', 'family')),
    created_at timestamptz not null default now(),
    check (from_member <> to_member)
  )`;
  await sql`create index if not exists shukriya_circle on shukriya (circle_id, created_at desc)`;
  // The weekly quiet prompt: one per member per week, claimed by this key.
  await sql`create table if not exists shukriya_prompts (
    member_id uuid not null references members(id) on delete cascade,
    week date not null,
    target_id uuid references members(id) on delete cascade,
    status text not null default 'open',
    created_at timestamptz not null default now(),
    primary key (member_id, week)
  )`;
  // The family's weekly question, and everyone's answer to it.
  await sql`create table if not exists sawaal_weeks (
    circle_id uuid not null references circles(id) on delete cascade,
    week date not null,
    qno int not null,
    question text not null,
    primary key (circle_id, week)
  )`;
  await sql`create table if not exists sawaal_answers (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    week date not null,
    member_id uuid not null references members(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    answer_text text,
    audio text,
    audio_secs int,
    created_at timestamptz not null default now(),
    unique (circle_id, week, member_id)
  )`;
  // The memory card a day of remembrance opens: one per person per year.
  await sql`create table if not exists remember_cards (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    year int not null,
    day date not null,
    created_at timestamptz not null default now(),
    unique (member_id, year)
  )`;
  await sql`create table if not exists remember_entries (
    id uuid primary key default gen_random_uuid(),
    card_id uuid not null references remember_cards(id) on delete cascade,
    by_member uuid not null references members(id) on delete cascade,
    kind text not null,
    text text,
    data text,
    seconds int,
    created_at timestamptz not null default now()
  )`;
}

const tzOf = m => placeOf(m && m.place, m && m.country, null).tz;

// ------------------------------------------------------------ shukriya
// The weekly prompt for this member: someone they have not thanked lately,
// chosen so that over time everyone in the family is suggested about
// equally often (shukriyaPick in _heardrules.mjs). No count leaves here.
async function shukriyaPrompt(sql, circle, me, week) {
  let row = (await sql`select target_id, status from shukriya_prompts where member_id = ${me.id} and week = ${week}::date`)[0];
  if (!row) {
    const members = await sql`select m.id, coalesce((to_jsonb(m)->>'remembered')::boolean, false) as remembered
                              from members m where m.circle_id = ${circle.id}`;
    const thanked = (await sql`select distinct to_member from shukriya where from_member = ${me.id}
                               and created_at > now() - make_interval(days => ${SHUKRIYA_REST_DAYS})`).map(r => r.to_member);
    const counts = {};
    (await sql`select p.target_id, count(*)::int as n from shukriya_prompts p join members m on m.id = p.member_id
               where m.circle_id = ${circle.id} and p.target_id is not null group by p.target_id`).forEach(r => { counts[r.target_id] = r.n; });
    const pick = shukriyaPick({ viewerId: me.id, members, thanked, suggested: counts, week });
    await sql`insert into shukriya_prompts (member_id, week, target_id, status) values (${me.id}, ${week}::date, ${pick}, ${pick ? 'open' : 'none'})
              on conflict (member_id, week) do nothing`;
    row = (await sql`select target_id, status from shukriya_prompts where member_id = ${me.id} and week = ${week}::date`)[0];
  }
  if (!row || row.status !== 'open' || !row.target_id) return null;
  // Looked at again each time: someone since marked as remembered is never shown.
  const t = (await sql`select m.id, m.name, (m.user_id is not null) as on_app from members m
                       where m.id = ${row.target_id} and m.circle_id = ${circle.id}
                         and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)`)[0];
  return t ? { toId: t.id, name: t.name, onApp: t.on_app } : null;
}
// What this member may read: sent by them, sent to them, or shown to the family.
async function shukriyaList(sql, circle, me, limit = 40) {
  const rows = await sql`
    select s.id, s.line, (s.audio is not null) as has_audio, s.audio_secs, s.audience, s.created_at,
           s.from_member, f.name as from_name, s.to_member, t.name as to_name, (t.user_id is not null) as to_on_app
    from shukriya s join members f on f.id = s.from_member join members t on t.id = s.to_member
    where s.circle_id = ${circle.id}
      and (s.from_member = ${me.id} or s.to_member = ${me.id} or s.audience = 'family')
    order by s.created_at desc limit ${limit}`;
  return rows.map(s => ({ id: s.id, line: s.line, hasAudio: s.has_audio, secs: s.audio_secs, audience: s.audience, at: s.created_at,
    fromId: s.from_member, fromName: s.from_name, toId: s.to_member, toName: s.to_name, toOnApp: s.to_on_app,
    mine: s.from_member === me.id, forMe: s.to_member === me.id }));
}

// ------------------------------------------------------------ the weekly question
async function sawaalWeek(sql, circle, week) {
  const have = (await sql`select qno, question from sawaal_weeks where circle_id = ${circle.id} and week = ${week}::date`)[0];
  if (have) return have;
  const q = questionFor(week, circle.id);
  await sql`insert into sawaal_weeks (circle_id, week, qno, question) values (${circle.id}, ${week}::date, ${q.no}, ${q.text})
            on conflict (circle_id, week) do nothing`;
  return (await sql`select qno, question from sawaal_weeks where circle_id = ${circle.id} and week = ${week}::date`)[0];
}
async function sawaalState(sql, circle, me, week) {
  if (circle.kind === 'group') return null;          // a group of friends has its throwback question
  const q = await sawaalWeek(sql, circle, week);
  if (!q) return null;
  const mine = (await sql`select id, answer_text, (audio is not null) as has_audio from sawaal_answers
                          where circle_id = ${circle.id} and week = ${week}::date and member_id = ${me.id}`)[0] || null;
  // THE RULE: other people's answers are read only by someone who has
  // answered. It is in the query, so a phone that asks early gets nothing.
  const answers = await sql`
    select a.id, a.member_id, m.name, a.by_member, b.name as by_name, a.answer_text, (a.audio is not null) as has_audio, a.audio_secs, a.created_at
    from sawaal_answers a join members m on m.id = a.member_id left join members b on b.id = a.by_member
    where a.circle_id = ${circle.id} and a.week = ${week}::date
      and exists (select 1 from sawaal_answers x where x.circle_id = a.circle_id and x.week = a.week and x.member_id = ${me.id})
    order by a.created_at`;
  const people = await sql`select m.id, m.name, (m.user_id is not null) as on_app from members m
                           where m.circle_id = ${circle.id} and not coalesce((to_jsonb(m)->>'remembered')::boolean, false) order by m.created_at`;
  const done = (await sql`select member_id from sawaal_answers where circle_id = ${circle.id} and week = ${week}::date`).map(r => r.member_id);
  const waiting = waitingFor(people.filter(p => p.on_app), done);
  return { week, question: q.question, answered: !!mine,
    answers: answers.map(a => ({ id: a.id, memberId: a.member_id, name: a.name, text: a.answer_text, hasAudio: a.has_audio, secs: a.audio_secs,
      mine: a.member_id === me.id, told: a.by_member && a.by_member !== a.member_id ? toldByLine(a.name, a.by_name) : null })),
    // Who can be answered for: in the family, not on the app, no answer yet.
    offApp: people.filter(p => !p.on_app && !done.includes(p.id)).map(p => ({ id: p.id, name: p.name })),
    waiting: mine ? waitingLine(waiting) : null, count: done.length };
}

// ------------------------------------------------------------ the memory card
// A day of remembrance opens one card for the family to add to together:
// a line, a photo or a voice note. One card per person per year.
export async function rememberCardOpen(sql, circleId, memberId, year, day) {
  await ensureHeardSchema(sql);
  await sql`insert into remember_cards (circle_id, member_id, year, day) values (${circleId}, ${memberId}, ${year}, ${day}::date)
            on conflict (member_id, year) do nothing`;
  return (await sql`select id from remember_cards where member_id = ${memberId} and year = ${year}`)[0] || null;
}
async function rememberCards(sql, circle, me, nowMs) {
  await ensureRememberSchema(sql);
  const people = await sql`select id, name, place, country, passed_year, passed_month, passed_day, remember_line from members
                           where circle_id = ${circle.id} and remembered and passed_month is not null and passed_day is not null`;
  for (const m of people) {
    const due = remembranceDue({ year: m.passed_year, month: m.passed_month, day: m.passed_day }, nowMs, tzOf(m));
    if (due) await rememberCardOpen(sql, circle.id, m.id, due.year, due.date);
  }
  const today = dayIn(tzOf(me), nowMs);
  // The card stays for the evening before, the day, and two days after.
  const cards = await sql`
    select c.id, c.member_id, m.name, c.year, to_char(c.day, 'YYYY-MM-DD') as day, m.passed_year, m.remember_line
    from remember_cards c join members m on m.id = c.member_id
    where c.circle_id = ${circle.id} and m.remembered
      and c.day between ${today}::date - 2 and ${today}::date + 1
    order by c.day limit 6`;
  if (!cards.length) return [];
  const entries = await sql`
    select e.id, e.card_id, e.by_member, b.name, e.kind, e.text, e.seconds, e.created_at,
           case when e.kind = 'photo' then e.data else null end as data
    from remember_entries e join members b on b.id = e.by_member
    where e.card_id = any(${cards.map(c => c.id)}::uuid[]) order by e.created_at limit 200`;
  return cards.map(c => ({ id: c.id, memberId: c.member_id, name: c.name, day: c.day,
    title: c.day === today ? remembranceLine(c.name, 'day') : c.day > today ? remembranceLine(c.name, 'eve') : 'Remembering ' + c.name,
    sub: yearsLine(c.name, c.year - (c.passed_year || c.year)), line: c.remember_line || null,
    entries: entries.filter(e => e.card_id === c.id).map(e => ({ id: e.id, name: e.name, kind: e.kind, text: e.text, secs: e.seconds, data: e.data, mine: e.by_member === me.id })),
    left: Math.max(0, RCARD_PER_PERSON - entries.filter(e => e.card_id === c.id && e.by_member === me.id).length) }));
}

// ------------------------------------------------------------ Today
export async function heardToday(sql, circle, me, nowMs, tz) {
  const week = weekOfDay(dayIn(tz, nowMs));
  const pulse = await pulseToday(sql, circle.id, tz, me.id);
  const mineP = pulse.answers.find(a => a.memberId === me.id) || null;
  const names = new Map((await sql`select id, name from members where circle_id = ${circle.id}`).map(m => [m.id, m.name]));
  const mood = { ask: MOOD_ASK, moods: MOODS, mine: mineP ? { value: mineP.value, tell: mineP.tell, toId: mineP.toId, toName: mineP.toId ? names.get(mineP.toId) || null : null, mood: mineP.style === 'mood' } : null,
    // What others chose to tell me today: to me alone, or to the family.
    told: pulse.answers.filter(a => a.memberId !== me.id).map(a => ({ name: names.get(a.memberId) || 'Someone', emoji: a.emoji, text: a.text, en: a.en, low: a.call })) };
  const people = await sql`select m.id, m.name, (m.user_id is not null) as on_app from members m
                           where m.circle_id = ${circle.id} and m.id <> ${me.id}
                             and not coalesce((to_jsonb(m)->>'remembered')::boolean, false) order by m.created_at`;
  return { ok: true, kind: circle.kind || 'family', me: me.id, mood,
    people: people.map(p => ({ id: p.id, name: p.name, onApp: p.on_app })),
    baat: { list: await baatList(sql, circle, me), kinds: BAAT_KINDS, replies: BAAT_REPLIES, whenDefault: BAAT_WHEN_DEFAULT },
    shukriya: { prompt: await shukriyaPrompt(sql, circle, me, week), recent: (await shukriyaList(sql, circle, me, 6)).filter(s => s.forMe || s.audience === 'family').slice(0, 3) },
    sawaal: await sawaalState(sql, circle, me, week),
    remember: circle.kind === 'group' ? [] : await rememberCards(sql, circle, me, nowMs) };
}

// THE TIMER'S SHARE: called once from runTick (api/events.mjs), for every
// family at once. Today that is the one reminder for a private word that
// has waited a day. Module scope, so the timer can reach it.
export async function heardSweepAll(sql, nowMs = Date.now()) {
  return baatSweep(sql, nowMs);
}

// ------------------------------------------------------------ the route
export default async function heardApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureHeardSchema(sql); await ensureBaatSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const g = await requireMember(sql, code, memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;
    const tz = validTz(reqTz(req)) || HOME_TZ, nowMs = Date.now();
    const word = spaceWord(circle);
    const bad = (error, status = 400, extra) => res.status(status).json({ ok: false, error, ...(extra || {}) });
    const good = (extra, status = 200) => res.status(status).json({ ok: true, ...(extra || {}) });
    const send = r => res.status(r.status).json(r.json);
    const voiceOf = () => {
      if (!body.audio) return { audio: null, secs: null };
      const v = audioCheck(body.mime, body.audio, body.secs);
      return v.err ? { error: v.err } : { audio: v.uri, secs: v.secs };
    };
    // Someone in this family who is not me and is not remembered.
    const personIn = async (id) => {
      if (!isUuid(id) || id === me.id) return null;
      return (await sql`select m.id, m.name, m.user_id, (m.user_id is not null) as on_app from members m
                        where m.id = ${id} and m.circle_id = ${circle.id}
                          and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)`)[0] || null;
    };

    if (req.method === 'GET') {
      const view = String(q.view || 'today');
      if (view === 'today') return res.status(200).json(await heardToday(sql, circle, me, nowMs, tz));
      if (view === 'shukriya') return good({ list: await shukriyaList(sql, circle, me) });
      if (view === 'audio') {
        const kind = String(q.kind || '');
        if (!isUuid(q.id)) return bad('Bad id');
        if (kind === 'baat' || kind === 'baatreply') return send(await baatAudio(sql, circle, me, q.id, kind === 'baat' ? 'ask' : 'reply'));
        let r = null;
        if (kind === 'shukriya') {
          r = (await sql`select audio from shukriya where id = ${q.id} and circle_id = ${circle.id}
                         and (from_member = ${me.id} or to_member = ${me.id} or audience = 'family')`)[0];
        } else if (kind === 'sawaal') {
          r = (await sql`select a.audio from sawaal_answers a where a.id = ${q.id} and a.circle_id = ${circle.id}
                         and exists (select 1 from sawaal_answers x where x.circle_id = a.circle_id and x.week = a.week and x.member_id = ${me.id})`)[0];
        } else if (kind === 'rcard') {
          r = (await sql`select e.data as audio from remember_entries e join remember_cards c on c.id = e.card_id
                         where e.id = ${q.id} and c.circle_id = ${circle.id} and e.kind = 'voice'`)[0];
        } else return bad('Unknown kind');
        if (!r || !r.audio) return bad('That is not here, or it is not shared with you.', 404);
        return good({ audio: r.audio });
      }
      return bad('Unknown view');
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return bad('GET or POST only', 405);
    }
    const action = String(body.action || '');

    // ---- how I feel today: private unless I say otherwise
    if (action === 'mood_set') {
      const saved = await pulseSave(sql, circle, me, body, tz);
      if (saved.call) await pulseCallNudge(sql, circle.id, me, saved.call);
      if (saved.one) await pushCircle(sql, circle.id, { title: '🧡 ' + me.name + ' told only you how today is', body: saved.one.line + (saved.one.low ? '. A call would be nice.' : ''), url: '/#home' }, { only: saved.one.id });
      return send(saved);
    }

    // ---- a private word to one person, and "Maaf karna"
    if (/^baat_/.test(action)) return send(await baatAction(sql, circle, me, body));

    // ---- shukriya
    if (action === 'shukriya_send') {
      const c = shukriyaClean(body);
      if (c.error) return bad(c.error);
      const risk = noteRisk(c.line || '');
      if (risk) return bad(risk);
      const t = await personIn(c.toId);
      if (!t) return bad('Choose someone in this ' + word + ' to thank', 404);
      const v = voiceOf();
      if (v.error) return bad(v.error);
      if (!c.line && !v.audio) return bad('Write a line, or say it by voice');
      if (!(await rateLimit(sql, 'shukriya', me.id, 20, 86400, { failClosed: true }))) return bad('That is a lot of thank-yous for one day. More tomorrow.', 429);
      const r = await sql`insert into shukriya (circle_id, from_member, to_member, line, audio, audio_secs, audience)
                          values (${circle.id}, ${me.id}, ${t.id}, ${c.line}, ${v.audio}, ${v.secs}, ${c.audience}) returning id`;
      await sql`update shukriya_prompts set status = 'done' where member_id = ${me.id} and target_id = ${t.id} and status = 'open'`;
      if (c.audience === 'family') {
        // The family feed says that it happened, in the writer's own choice. No count, ever.
        await sql`insert into events (circle_id, member_id, type, text) values (${circle.id}, ${me.id}, 'care', ${first(me.name) + ' said shukriya to ' + first(t.name) + ' 🙏' + (c.line ? ' "' + c.line.slice(0, 140) + '"' : '')})`;
      }
      // The person thanked hears of it, if they are on Parwah. If not, it is
      // kept for the day they join, and the writer can read it out or share it.
      if (t.on_app) await pushCircle(sql, circle.id, { title: '🙏 ' + first(me.name) + ' says shukriya', body: c.line ? c.line.slice(0, 120) : 'A voice note is waiting for you', url: '/#home' }, { only: t.id });
      await awardHeard(sql, circle.id, me.id, 'shukriya', dayIn(tz, nowMs));
      return good({ id: r[0].id, kept: !t.on_app }, 201);
    }
    if (action === 'shukriya_later') {
      const week = weekOfDay(dayIn(tz, nowMs));
      await sql`update shukriya_prompts set status = 'later' where member_id = ${me.id} and week = ${week}::date and status = 'open'`;
      return good({});
    }

    // ---- the family's weekly question
    if (action === 'sawaal_answer') {
      if (circle.kind === 'group') return bad('The weekly question is for a family. A group has its throwback question.');
      const week = weekOfDay(dayIn(tz, nowMs));
      const qn = await sawaalWeek(sql, circle, week);
      if (!qn) return bad('No question this week', 404);
      const text = clip(body.text, SAWAAL_MAX);
      const risk = noteRisk(text);
      if (risk) return bad(risk);
      const v = voiceOf();
      if (v.error) return bad(v.error);
      if (!text && !v.audio) return bad('Say it or type it first');
      let about = me.id;
      if (body.forId) {
        // For someone who is not on the app: told by them, typed or recorded by me.
        const t = await personIn(body.forId);
        if (!t) return bad('Choose someone in this family', 404);
        if (t.on_app) return bad(first(t.name) + ' is on Parwah and can answer for themself.', 400);
        about = t.id;
      }
      await sql`insert into sawaal_answers (circle_id, week, member_id, by_member, answer_text, audio, audio_secs)
                values (${circle.id}, ${week}::date, ${about}, ${me.id}, ${text || null}, ${v.audio}, ${v.secs})
                on conflict (circle_id, week, member_id) do update set answer_text = excluded.answer_text, by_member = excluded.by_member,
                  audio = coalesce(excluded.audio, sawaal_answers.audio), audio_secs = coalesce(excluded.audio_secs, sawaal_answers.audio_secs)`;
      if (about === me.id) await awardHeard(sql, circle.id, me.id, 'sawaal', dayIn(tz, nowMs));
      return good({});
    }

    // ---- the shared memory card
    if (action === 'rcard_add') {
      if (!isUuid(body.cardId)) return bad('Bad card');
      const c = (await sql`select c.id from remember_cards c join members m on m.id = c.member_id
                           where c.id = ${body.cardId} and c.circle_id = ${circle.id} and m.remembered`)[0];
      if (!c) return bad('That card is not here', 404);
      const n = (await sql`select count(*)::int as n from remember_entries where card_id = ${c.id} and by_member = ${me.id}`)[0].n;
      if (n >= RCARD_PER_PERSON) return bad('You have added ' + RCARD_PER_PERSON + ' things already. Remove one to add another.');
      const k = body.kind;
      if (k === 'text') {
        const t = clip(body.text, 300);
        if (!t) return bad('Write a line');
        const risk = noteRisk(t);
        if (risk) return bad(risk);
        await sql`insert into remember_entries (card_id, by_member, kind, text) values (${c.id}, ${me.id}, 'text', ${t})`;
      } else if (k === 'photo') {
        const d = String(body.data || '');
        if (!PHOTO_URI.test(d) || d.length > PHOTO_MAX) return bad('That photo is too big or not a photo');
        await sql`insert into remember_entries (card_id, by_member, kind, data, text) values (${c.id}, ${me.id}, 'photo', ${d}, ${clip(body.text, 120) || null})`;
      } else if (k === 'voice') {
        const v = voiceOf();
        if (v.error || !v.audio) return bad(v.error || 'Record a voice note first');
        await sql`insert into remember_entries (card_id, by_member, kind, data, seconds) values (${c.id}, ${me.id}, 'voice', ${v.audio}, ${v.secs})`;
      } else return bad('Add a line, a photo or a voice note');
      return good({}, 201);
    }
    if (action === 'rcard_remove') {
      if (!isUuid(body.entryId)) return bad('Bad entry');
      const got = await sql`delete from remember_entries e using remember_cards c where e.id = ${body.entryId} and e.by_member = ${me.id}
                            and c.id = e.card_id and c.circle_id = ${circle.id} returning e.id`;
      if (!got[0]) return bad('You can take off only what you added', 403);
      return good({});
    }
    return bad('Unknown action');
  } catch (e) {
    return fail(res, e);
  }
}
