// EKTA'S DAY: "Aaj ka din", the morning note, and the private nudges.
// Behind /api/ekta (action ekta_morning, ekta_morning_vote) and the timer
// (ektaNudgeSweep, one line in runTick in api/events.mjs).
//
// AAJ KA DIN. What today holds for ONE member: medicine times of people
// they may see (times only, never a medicine's name), plans today, birthdays
// and anniversaries today, renewals due this week, and who is away. Each
// list is read with its own feature's rule, the same way the evening note
// does it (api/_digest.mjs digestGather). It is written by plain rules
// (morningWrite in api/_ektarules.mjs): no model, no key, no coins. With
// EKTA_MORNING_MODEL=on AND a server key, one model line may replace it,
// through digestModelOnce: the same one call per member per day and the same
// cap per family as the evening note, checked by digestCheck (names rule
// included). Any failure shows the plain version without a word.
//
// NUDGES. Private, model-free, off until the member turns each one on,
// never between 9pm and 8am where the member is, at most two a day:
//   "You have not spoken with Maa in 9 days"   (counted from your own 1:1
//      chat with them, voice notes included, a family call you started, and
//      a line you added to a card for them; never shown to Maa)
//   "Chachu's birthday is tomorrow"
//   "A renewal is due this week"
// Someone marked as remembered is never named in either.
import { rateLimit, spaceWord } from './_db.mjs';
import { fail } from './_fail.mjs';
import { dayIn, reqTz, validTz, fromWall } from './_recur.mjs';
import { pushCircle } from './_push.mjs';
import { digestHour } from './_digestrules.mjs';
import { digestModelOnce, ensureDigestSchema } from './_digest.mjs';
import { ensureEktaSchema, ektaSwitches, PAUSED_LINE } from './_ektaagent.mjs';
import { EKTA, morningFacts, morningWrite, morningPrompt, isMorning, nudgePick, quietHour } from './_ektarules.mjs';

const HOME_TZ = 'Asia/Kolkata';
// For tests only: a fixed clock and a push recorder. Production never sets these.
export const daySeams = { now: null, push: null };
const q = async (f) => { try { return (await f()) || []; } catch (e) { return []; } };

function dayWindow(tz, nowMs) {
  const zone = validTz(tz) || HOME_TZ, today = dayIn(zone, nowMs);
  const [y, m, d] = today.split('-').map(Number);
  const at = (k) => new Date(fromWall({ y, m, d: d + k, h: 0, mi: 0, s: 0 }, zone));
  return { zone, today, start: at(0), end: at(1), week: dayIn(zone, at(7).getTime() + 12 * 3600000), tomorrow: dayIn(zone, at(1).getTime() + 12 * 3600000) };
}
// Renewals due from today to seven days on, for what this member may know
// exists (the rule in api/_renewals.mjs listFor). A count, nothing more.
async function renewalsThisWeek(sql, cid, mid, w) {
  const own = await q(() => sql`select count(*)::int as n from renewals
    where circle_id = ${cid} and expires_on >= ${w.today}::date and expires_on <= ${w.week}::date`);
  const vault = await q(() => sql`
    select count(*)::int as n from vault_docs d
    left join vault_access va on va.doc_id = d.id and va.member_id = ${mid}
    where d.circle_id = ${cid} and d.expires_on is not null and d.expires_on >= ${w.today}::date and d.expires_on <= ${w.week}::date
      and (d.about_member = ${mid} or (d.by_member = ${mid} and d.uploader_access) or va.member_id is not null)
      and not exists (select 1 from renewals r where r.vault_doc_id = d.id)`);
  return ((own[0] || {}).n || 0) + ((vault[0] || {}).n || 0);
}

export async function morningGather(sql, circle, me, tz, nowMs = Date.now()) {
  const w = dayWindow(tz, nowMs), cid = circle.id, mid = me.id, md = w.today.slice(5);
  const people = await sql`select id, name, to_char(dob, 'MM-DD') as bd from members where circle_id = ${cid}`;
  // If who is remembered cannot be read, nobody but the viewer is named.
  let remembered = new Set(), unsure = false;
  try { remembered = new Set((await sql`select id from members where circle_id = ${cid} and remembered`).map(r => r.id)); }
  catch (e) { unsure = true; }
  const raw = { viewerId: mid, word: spaceWord(circle), tz: w.zone,
    people: people.map(p => ({ id: p.id, name: p.name, remembered: unsure ? p.id !== mid : remembered.has(p.id) })) };
  // Medicine times today: only medicines this member may read (the rule
  // api/_doses.mjs uses). Times, never a name.
  const meds = await q(() => sql`
    select d.person_id as id, d.due_at from medicine_doses d join family_book b on b.id = d.medicine_id
    where d.circle_id = ${cid} and d.due_at >= ${w.start} and d.due_at < ${w.end}
      and (b.visibility = 'circle' or b.about_member = ${mid} or b.by_member = ${mid}
           or exists (select 1 from book_access ba where ba.entry_id = b.id and ba.member_id = ${mid}))
    order by d.due_at limit 200`);
  const byPerson = new Map();
  for (const r of meds) { if (!byPerson.has(r.id)) byPerson.set(r.id, []); byPerson.get(r.id).push(r.due_at); }
  raw.meds = [...byPerson].map(([id, times]) => ({ id, times }));
  // Plans belong to the whole circle.
  raw.plansToday = (await q(() => sql`select id, title, at from plans where circle_id = ${cid} and at >= ${w.start} and at < ${w.end} order by at limit 3`))
    .map(r => ({ planId: r.id, title: r.title, at: r.at }));
  raw.birthdays = people.filter(p => p.bd && p.bd === md).map(p => p.id);
  raw.anniversaries = (await q(() => sql`select id, anniv_with from members where circle_id = ${cid} and anniversary is not null
    and to_char(anniversary, 'MM-DD') = ${md}`)).map(r => [r.id, r.anniv_with].filter(Boolean));
  raw.renewals = { n: await renewalsThisWeek(sql, cid, mid, w) };
  // "I'm away until": the family is told on the check-in screen (api/_familycare.mjs).
  raw.away = (await q(() => sql`select id, to_char(away_until, 'YYYY-MM-DD') as until from members
    where circle_id = ${cid} and away_until is not null and away_until >= ${w.today}::date`)).map(r => ({ id: r.id, until: r.until }));
  return raw;
}

const morningModelOn = () => String(process.env.EKTA_MORNING_MODEL || '').toLowerCase() === 'on';

export async function morningOpen(sql, circle, me, tz, nowMs = Date.now()) {
  await ensureEktaSchema(sql);
  const zone = validTz(tz) || HOME_TZ, day = dayIn(zone, nowMs), word = spaceWord(circle);
  const facts = morningFacts(await morningGather(sql, circle, me, zone, nowMs));
  const keys = facts.map(f => f.key);
  const had = (await sql`select text, fact_keys, by_model, vote from ekta_morning where member_id = ${me.id} and day = ${day}::date`)[0];
  let text = morningWrite(facts, word), byModel = false;
  const same = had && JSON.stringify(had.fact_keys || []) === JSON.stringify(keys);
  if (had && had.by_model && same) { text = had.text; byModel = true; }
  else if (morningModelOn() && facts.length && !(had && had.by_model)) {
    await ensureDigestSchema(sql);
    const out = await digestModelOnce(sql, circle, me, facts, nowMs, { promptOf: morningPrompt });
    if (out) { text = out.text; byModel = true; }
  }
  await sql`insert into ekta_morning (member_id, circle_id, day, text, fact_keys, by_model, written_at)
            values (${me.id}, ${circle.id}, ${day}::date, ${text}, ${keys}::text[], ${byModel}, ${new Date(nowMs)})
            on conflict (member_id, day) do update set text = excluded.text, fact_keys = excluded.fact_keys, by_model = excluded.by_model, written_at = excluded.written_at`;
  return { day, text, quiet: !keys.length, by: byModel ? 'ekta' : 'plain', morning: isMorning(digestHour(nowMs, zone)),
    vote: had && had.vote === 1 ? 'up' : had && had.vote === -1 ? 'down' : null };
}

export async function morningHandle(sql, circle, me, req, res) {
  try {
    await ensureEktaSchema(sql);
    const body = req.body || {}, action = String(body.action || '');
    const tz = validTz(me.tz) || reqTz(req) || HOME_TZ;
    const nowMs = daySeams.now ? daySeams.now() : Date.now();
    if ((await ektaSwitches(sql, circle, me)).paused) return res.status(200).json({ ok: true, paused: true, morning: { text: PAUSED_LINE, quiet: true, paused: true } });
    if (action === 'ekta_morning') {
      if (!(await rateLimit(sql, 'ektamorning', me.id, 40, 600, { failClosed: true }))) {
        return res.status(429).json({ ok: false, error: 'You have opened this many times in a few minutes. Try again a little later.' });
      }
      return res.status(200).json({ ok: true, morning: await morningOpen(sql, circle, me, tz, nowMs) });
    }
    const v = body.vote === 'up' ? 1 : body.vote === 'down' ? -1 : 0;
    if (!v) return res.status(400).json({ ok: false, error: 'Choose thumbs up or thumbs down.' });
    const r = await sql`update ekta_morning set vote = ${v} where member_id = ${me.id} and day = ${dayIn(tz, nowMs)}::date returning vote`;
    if (!r[0]) return res.status(404).json({ ok: false, error: 'Open today\'s note first, then say what you think.' });
    return res.status(200).json({ ok: true, vote: v === 1 ? 'up' : 'down' });
  } catch (e) { return fail(res, e); }
}

// ---------------------------------------------------------------- the timer's share
// Whole days since this member last reached that person, or null if never.
async function daysSince(sql, cid, mid, otherId, nowMs) {
  const last = [];
  // Their own 1:1 chat: a message or a voice note from this member.
  last.push(...await q(() => sql`
    select max(m.created_at) as at from messages m join chats c on c.id = m.chat_id
    where c.circle_id = ${cid} and c.kind = 'dm' and m.member_id = ${mid}
      and exists (select 1 from chat_members a where a.chat_id = c.id and a.member_id = ${mid})
      and exists (select 1 from chat_members b where b.chat_id = c.id and b.member_id = ${otherId})`));
  // A family call this member started: it rings everyone in the family.
  last.push(...await q(() => sql`select max(started_at) as at from calls where circle_id = ${cid} and by_member = ${mid}`));
  // A line, a photo or a voice note this member added to a card for them.
  last.push(...await q(() => sql`
    select max(e.created_at) as at from card_entries e join cards c on c.id = e.card_id
    where c.circle_id = ${cid} and e.member_id = ${mid} and (c.for_member = ${otherId} or c.for_member2 = ${otherId})`));
  const ms = last.map(r => r && r.at ? new Date(r.at).getTime() : 0).filter(Boolean);
  return ms.length ? Math.floor((nowMs - Math.max(...ms)) / 86400000) : null;
}

export async function ektaNudgeSweep(sql, circleId, nowMs = Date.now()) {
  await ensureEktaSchema(sql);
  const who = await sql`
    select p.member_id, p.tz, p.nudge_talk, p.nudge_bday, p.nudge_renewal, to_char(p.nudged_day, 'YYYY-MM-DD') as nudged_day, p.nudged_n, m.created_at
    from ekta_prefs p join members m on m.id = p.member_id
    where p.circle_id = ${circleId} and (p.nudge_talk or p.nudge_bday or p.nudge_renewal)
      and m.circle_id = ${circleId} and m.user_id is not null and not m.remembered`;
  if (!who.length) return 0;
  if (((await sql`select paused from ekta_circle where circle_id = ${circleId}`)[0] || {}).paused) return 0;
  const people = await sql`select id, name, role, remembered, to_char(dob, 'MM-DD') as bd, created_at from members where circle_id = ${circleId}`;
  let sent = 0;
  for (const p of who) {
    const zone = validTz(p.tz) || HOME_TZ, hour = digestHour(nowMs, zone);
    if (quietHour(hour)) continue;
    const w = dayWindow(zone, nowMs);
    const sentToday = p.nudged_day === w.today ? p.nudged_n : 0;
    if (sentToday >= EKTA.nudgeCap) continue;
    const seen = new Set((await sql`select key from ekta_nudges where member_id = ${p.member_id}`).map(r => r.key));
    const others = people.filter(o => o.id !== p.member_id && !o.remembered);
    const talk = [];
    if (p.nudge_talk) {
      // The people this is about: the parents in the family.
      for (const o of others.filter(o => o.role === 'parent')) {
        const d = await daysSince(sql, circleId, p.member_id, o.id, nowMs);
        // Never spoken here: counted from the day the later of the two joined.
        const since = d == null ? Math.floor((nowMs - Math.max(new Date(o.created_at).getTime(), new Date(p.created_at).getTime())) / 86400000) : d;
        talk.push({ id: o.id, name: o.name, days: since });
      }
    }
    const bdays = p.nudge_bday ? others.filter(o => o.bd && o.bd === w.tomorrow.slice(5)).map(o => ({ id: o.id, name: o.name })) : [];
    const renewals = p.nudge_renewal ? await renewalsThisWeek(sql, circleId, p.member_id, w) : 0;
    // The week, so "not spoken" comes at most once in seven days per person.
    const week = dayIn('UTC', Math.floor(nowMs / (7 * 86400000)) * 7 * 86400000);
    const picks = nudgePick({ hour, sentToday, on: { talk: p.nudge_talk, bday: p.nudge_bday, renewal: p.nudge_renewal },
      seen, talk, bdays, renewals, week, year: w.tomorrow.slice(0, 4) });
    for (const n of picks) {
      // Two claims, each in one statement: this nudge once, and the day's cap.
      const mine = await sql`insert into ekta_nudges (member_id, key, at) values (${p.member_id}, ${n.key}, ${new Date(nowMs)}) on conflict do nothing returning key`;
      if (!mine[0]) continue;
      const slot = await sql`
        update ekta_prefs set nudged_n = case when nudged_day = ${w.today}::date then nudged_n + 1 else 1 end, nudged_day = ${w.today}::date
        where member_id = ${p.member_id} and (nudged_day is distinct from ${w.today}::date or nudged_n < ${EKTA.nudgeCap}) returning nudged_n`;
      if (!slot[0]) { await sql`delete from ekta_nudges where member_id = ${p.member_id} and key = ${n.key}`; break; }
      // To this member only. The person it is about is never told.
      await (daySeams.push || pushCircle)(sql, circleId, { title: n.title, body: n.body, url: '/#home' }, { only: p.member_id });
      sent++;
    }
  }
  return sent;
}
