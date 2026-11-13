// CARE THAT FLOWS BACK. Behind /api/chats?area=ashirwad (no new function;
// it shares the chat's voice-note rules and storage form, api/_chatbond.mjs).
//
// ASHIRWAD. Anyone in the family, and most of all a parent, sends a blessing
// to one person or to everyone: a voice note, or one of a few one-tap lines
// ("Khush raho", "All the best for the exam", "Reach safely"). It arrives as
// a card the receiver answers with one tap ("🙏 Pranam") or a voice reply.
//
// HOW IS YOUR DAY? The same way children check on a parent, a parent checks
// on a child: a one-tap ask, answered with one tap or a voice note.
//
// REACHED SAFELY. Anyone starts a trip ("Leaving for Delhi, by train") with
// the time they expect to reach, and chooses who is told. One tap, "Reached
// safely", tells those people. If it is not tapped by the expected time plus
// TRIP_GRACE_MIN minutes, those people are asked, gently and once, to call
// (sweepTripsAll, from the timer in api/events.mjs).
//
//   GET  ?area=ashirwad&circle=CODE&member=ID
//        -> { inbox, sent, trips: { mine, watching }, lines, dayAnswers, me }
//   GET  ...&audio=CARD_ID                the voice note of a card I may hear
//   GET  ...&reply=CARD_ID&by=MEMBER_ID   a voice reply (the sender, or whoever replied)
//   POST {area:'ashirwad', action, ...}
//        bless        {to: MEMBER_ID | 'all', line: KEY}  or  {to, voice: data URI, secs}
//        howday       {to: MEMBER_ID}
//        reply        {id, pranam: true} | {id, answer: KEY} | {id, voice, secs}
//        trip_start   {to, by, expectAt, tell: [MEMBER_ID]}
//        trip_reached {id}     trip_cancel {id}     trip_extend {id, expectAt}
//        standing_set {targetId, child}             (api/_audience.mjs)
//
// The rules, all here and in the SQL:
//   - a card is read only by the person it is for (or the family, when it
//     was for everyone) and by the person who sent it;
//   - a trip is seen only by the traveller and the people they chose;
//   - nobody marked as no longer with us is ever sent to, chosen, told or
//     asked to call: every list of people is read through audienceFor;
//   - whatever one member can send at another is rate limited, fail closed.
import { db, ensureSchema, requireMember, isUuid, rateLimit, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { reqTz, validTz } from './_recur.mjs';
import { checkVoice, ensureChatBond } from './_chatbond.mjs';
import { ensureAudienceSchema, audienceFor, pushAudience, minorOf, standingAction } from './_audience.mjs';
import { BLESS_LINES, DAY_ANSWERS, DAY_ASK, PRANAM, blessLine, dayAnswer, firstName,
         tripClean, tripLine, tripAskLine, tripPhase, TRIP_GRACE_MIN, TRIP_TELL_MAX, TRIP_MODE_WORDS } from './_consentrules.mjs';

let ready = false;
export async function ensureAshirwadSchema(sql) {
  if (ready) return;
  await ensureAudienceSchema(sql);
  await schemaOnce(async () => {
    await sql`create table if not exists ashirwad (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      from_member uuid not null references members(id) on delete cascade,
      to_member uuid references members(id) on delete cascade,
      kind text not null default 'bless',
      line text,
      audio text,
      audio_secs integer,
      created_at timestamptz not null default now()
    )`;
    await sql`create index if not exists ashirwad_circle_time on ashirwad (circle_id, created_at desc)`;
    await sql`create table if not exists ashirwad_replies (
      ashirwad_id uuid not null references ashirwad(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      kind text not null,
      line text,
      audio text,
      audio_secs integer,
      at timestamptz not null default now(),
      primary key (ashirwad_id, member_id)
    )`;
    await sql`create table if not exists trips (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      dest text not null,
      mode text not null default 'other',
      expect_at timestamptz not null,
      tell uuid[] not null,
      status text not null default 'open',
      started_at timestamptz not null default now(),
      reached_at timestamptz,
      asked_at timestamptz
    )`;
    await sql`create index if not exists trips_open on trips (status, expect_at)`;
    // One trip at a time for one person in one family.
    await sql`create unique index if not exists trips_one_open on trips (circle_id, member_id) where status = 'open'`;
  });
  ready = true;
}

const clockIn = (at, tz) => {
  try { return new Intl.DateTimeFormat('en-IN', { timeZone: validTz(tz) || 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(at)); }
  catch (e) { return ''; }
};

// THE TIMER'S SHARE, for every family at once: trips whose "Reached safely"
// was not tapped by the expected time plus the grace. Each is claimed by the
// one UPDATE below, so however many phones and timers look, the people
// chosen are asked once. Never a remembered person: the traveller is
// skipped if marked, and the people asked are read through audienceFor.
export async function sweepTripsAll(sql, nowMs = Date.now()) {
  await ensureAshirwadSchema(sql);
  const lateBy = new Date(nowMs - TRIP_GRACE_MIN * 60000);
  const due = await sql`update trips set asked_at = ${new Date(nowMs)}
                        where status = 'open' and asked_at is null and expect_at <= ${lateBy}
                        returning id, circle_id, member_id, dest, tell`;
  let n = 0;
  for (const t of due) {
    const who = (await sql`select name, phone, remembered from members where id = ${t.member_id}`)[0];
    if (!who || who.remembered) continue;
    const sent = await pushAudience(sql, t.circle_id, 'trip', {
      title: '🧡 ' + tripAskLine(who.name),
      body: 'They were expected in ' + t.dest + ' a little while ago. A gentle call to check is enough.', url: '/#home'
    }, { only: t.tell, except: t.member_id });
    if (sent) n++;
  }
  return n;
}

const cardOut = (r, meId) => ({ id: r.id, kind: r.kind, line: r.line, hasVoice: !!r.has_audio, secs: r.audio_secs || null,
  fromId: r.from_member, fromName: r.from_name, toId: r.to_member, toName: r.to_name || null, toAll: !r.to_member,
  mine: r.from_member === meId, at: r.created_at });
const tripOut = (t, nowMs) => ({ id: t.id, memberId: t.member_id, name: t.name, phone: t.phone || null, to: t.dest, by: t.mode,
  byWords: TRIP_MODE_WORDS[t.mode] || '', expectAt: t.expect_at, status: t.status, phase: tripPhase(t, nowMs),
  reachedAt: t.reached_at, tell: t.tell });

export default async function ashirwadApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureChatBond(sql); await ensureAshirwadSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, b = req.body || {};
    const g = await requireMember(sql, req.method === 'GET' ? q.circle : b.code, req.method === 'GET' ? q.member : b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;
    const no = (status, error, extra) => res.status(status).json({ ok: false, error, ...(extra || {}) });

    if (req.method === 'GET') {
      // One voice note: only for the person it was sent to, or who sent it.
      if (q.audio !== undefined) {
        if (!isUuid(q.audio)) return no(404, 'That voice note is not here');
        const a = await sql`select audio, audio_secs from ashirwad
                            where id = ${q.audio} and circle_id = ${circle.id} and audio is not null
                              and (from_member = ${me.id} or to_member = ${me.id} or to_member is null)`;
        if (!a[0]) return no(404, 'That voice note is not here');
        return res.status(200).json({ ok: true, audio: a[0].audio, secs: a[0].audio_secs });
      }
      if (q.reply !== undefined) {
        if (!isUuid(q.reply) || !isUuid(q.by)) return no(404, 'That voice note is not here');
        const a = await sql`select r.audio, r.audio_secs from ashirwad_replies r join ashirwad a on a.id = r.ashirwad_id
                            where r.ashirwad_id = ${q.reply} and r.member_id = ${q.by} and a.circle_id = ${circle.id} and r.audio is not null
                              and (a.from_member = ${me.id} or r.member_id = ${me.id})`;
        if (!a[0]) return no(404, 'That voice note is not here');
        return res.status(200).json({ ok: true, audio: a[0].audio, secs: a[0].audio_secs });
      }
      // Waiting for my answer: sent to me, or to everyone by someone else.
      const inbox = await sql`
        select a.id, a.kind, a.line, a.audio is not null as has_audio, a.audio_secs, a.from_member, f.name as from_name,
               a.to_member, null::text as to_name, a.created_at
        from ashirwad a join members f on f.id = a.from_member
        where a.circle_id = ${circle.id} and a.created_at > now() - interval '7 days' and a.from_member <> ${me.id}
          and (a.to_member = ${me.id} or a.to_member is null) and not f.remembered
          and not exists (select 1 from ashirwad_replies r where r.ashirwad_id = a.id and r.member_id = ${me.id})
        order by a.created_at desc limit 12`;
      // What I sent, with who answered.
      const sent = await sql`
        select a.id, a.kind, a.line, a.audio is not null as has_audio, a.audio_secs, a.from_member, ${me.name}::text as from_name,
               a.to_member, t.name as to_name, a.created_at
        from ashirwad a left join members t on t.id = a.to_member
        where a.circle_id = ${circle.id} and a.from_member = ${me.id} and a.created_at > now() - interval '7 days'
        order by a.created_at desc limit 12`;
      const sentIds = sent.map(s => s.id);
      const replies = sentIds.length ? await sql`
        select r.ashirwad_id, r.member_id, m.name, r.kind, r.line, r.audio is not null as has_audio, r.audio_secs, r.at
        from ashirwad_replies r join members m on m.id = r.member_id
        where r.ashirwad_id = any(${sentIds}) order by r.at` : [];
      const now = Date.now();
      const trips = await sql`
        select t.id, t.member_id, m.name, m.phone, t.dest, t.mode, t.expect_at, t.status, t.reached_at, t.tell
        from trips t join members m on m.id = t.member_id
        where t.circle_id = ${circle.id} and not m.remembered
          and (t.member_id = ${me.id} or ${me.id} = any(t.tell))
          and (t.status = 'open' or (t.status = 'reached' and t.reached_at > now() - interval '3 hours'))
        order by t.expect_at`;
      // The people who can be sent to, chosen or told: on Parwah, with us.
      const people = await audienceFor(sql, circle.id, 'ashirwad', { except: me.id });
      const kids = await sql`select m.id, m.is_child from members m where m.circle_id = ${circle.id} and not m.remembered
                             and (m.is_child or (m.dob is not null and m.dob > current_date - interval '18 years'))`;
      return res.status(200).json({ ok: true,
        lines: BLESS_LINES, dayAnswers: DAY_ANSWERS, dayAsk: DAY_ASK, pranam: PRANAM, graceMin: TRIP_GRACE_MIN,
        me: { minor: await minorOf(sql, circle.id, me.id),
              // "No daily call, thank you" (api/_rotaconsent.mjs): only they can lift it.
              rotaNo: !!((await sql`select to_jsonb(m) ->> 'rota_no_at' as no from members m where m.id = ${me.id}`)[0] || {}).no },
        people, names: Object.fromEntries((await sql`select id, name from members where circle_id = ${circle.id} and not remembered`).map(m => [m.id, m.name])), minors: kids.map(k => k.id), marked: kids.filter(k => k.is_child).map(k => k.id),
        inbox: inbox.map(r => cardOut(r, me.id)),
        sent: sent.map(r => ({ ...cardOut(r, me.id),
          replies: replies.filter(x => x.ashirwad_id === r.id).map(x => ({ memberId: x.member_id, name: x.name, kind: x.kind, line: x.line, hasVoice: !!x.has_audio, secs: x.audio_secs || null, at: x.at })) })),
        trips: { mine: trips.filter(t => t.member_id === me.id && t.status === 'open').map(t => tripOut(t, now))[0] || null,
                 watching: trips.filter(t => t.member_id !== me.id).map(t => tripOut(t, now)) } });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return no(405, 'GET or POST only'); }

    const action = String(b.action || '');
    if (action === 'standing_set') {
      const out = await standingAction(sql, circle, me, b);
      return res.status(out.status).json(out.json);
    }

    // ---- Ashirwad and "How is your day?"
    if (action === 'bless' || action === 'howday') {
      const toAll = b.to === 'all' && action === 'bless';
      let to = null;
      if (!toAll) {
        if (!isUuid(b.to) || b.to === me.id) return no(400, 'Choose who it is for');
        // Someone on Parwah, in this family, who is with us.
        const okTo = await audienceFor(sql, circle.id, action === 'bless' ? 'ashirwad' : 'howday', { only: b.to });
        if (!okTo[0]) return no(400, 'They are not on Parwah, so it cannot reach them. A call may be nicer.');
        to = okTo[0];
      }
      let line = null, voice = null;
      if (action === 'howday') line = DAY_ASK;
      else if (b.voice) {
        voice = checkVoice(b.voice, b.secs);
        if (voice.err) return no(400, voice.err);
      } else {
        line = blessLine(b.line);
        if (!line) return no(400, 'Choose a blessing, or record one');
      }
      // At most 20 an hour from one person; the same ask to the same person
      // once in three hours. Fail closed: a limiter that cannot count says no.
      if (!(await rateLimit(sql, 'ashirwad', me.id, 20, 3600, { failClosed: true }))) return no(429, 'That is a lot of love for one hour. Send the next one a little later.');
      if (action === 'howday' && !(await rateLimit(sql, 'howday', me.id + ':' + to, 1, 3 * 3600, { failClosed: true }))) {
        return no(429, 'You asked a little while ago. Give them some time to answer.');
      }
      const r = await sql`insert into ashirwad (circle_id, from_member, to_member, kind, line, audio, audio_secs)
                          values (${circle.id}, ${me.id}, ${to}, ${action}, ${line}, ${voice ? voice.uri : null}, ${voice ? voice.secs : null})
                          returning id`;
      const payload = action === 'howday'
        ? { title: '🧡 ' + firstName(me.name) + ' asks: how is your day?', body: 'One tap to answer, or say it in your own voice.', url: '/#home' }
        : { title: '🙏 Ashirwad from ' + firstName(me.name), body: voice ? 'A voice note for you. Tap to listen.' : line, url: '/#home' };
      await pushAudience(sql, circle.id, action === 'bless' ? 'ashirwad' : 'howday', payload, toAll ? { except: me.id } : { only: to });
      return res.status(201).json({ ok: true, id: r[0].id });
    }

    if (action === 'reply') {
      if (!isUuid(b.id)) return no(404, 'That card is not here any more');
      const a = (await sql`select a.id, a.kind, a.from_member from ashirwad a
                           where a.id = ${b.id} and a.circle_id = ${circle.id} and a.from_member <> ${me.id}
                             and (a.to_member = ${me.id} or a.to_member is null)`)[0];
      if (!a) return no(404, 'That card is not here any more');
      let kind, line = null, voice = null;
      if (b.voice) {
        voice = checkVoice(b.voice, b.secs);
        if (voice.err) return no(400, voice.err);
        kind = 'voice';
      } else if (a.kind === 'howday') {
        line = dayAnswer(b.answer);
        if (!line) return no(400, 'Choose an answer, or say it in your own voice');
        kind = 'answer';
      } else {
        if (b.pranam !== true) return no(400, 'Tap Pranam, or send a voice reply');
        kind = 'pranam'; line = PRANAM;
      }
      if (!(await rateLimit(sql, 'ashirwadreply', me.id, 40, 3600, { failClosed: true }))) return no(429, 'Try again in a little while.');
      const first = await sql`insert into ashirwad_replies (ashirwad_id, member_id, kind, line, audio, audio_secs)
                              values (${a.id}, ${me.id}, ${kind}, ${line}, ${voice ? voice.uri : null}, ${voice ? voice.secs : null})
                              on conflict (ashirwad_id, member_id) do nothing returning ashirwad_id`;
      if (!first[0]) return res.status(200).json({ ok: true, already: true });
      await pushAudience(sql, circle.id, 'ashirwad', {
        title: (kind === 'pranam' ? '🙏 ' : '🧡 ') + firstName(me.name) + (kind === 'voice' ? ' sent a voice reply' : ': ' + line.replace('🙏 ', '')),
        body: a.kind === 'howday' ? 'Their answer to "How is your day?"' : 'For your Ashirwad.', url: '/#home' }, { only: a.from_member });
      return res.status(201).json({ ok: true, kind });
    }

    // ---- Reached safely
    if (action === 'trip_start') {
      const c = tripClean({ to: b.to, by: b.by, expectAt: b.expectAt });
      if (c.error) return no(400, c.error, { field: /time|when/i.test(c.error) ? 'expectAt' : 'to' });
      const want = [...new Set((Array.isArray(b.tell) ? b.tell : []).filter(isUuid))].filter(id => id !== me.id);
      if (!want.length) return no(400, 'Choose at least one person to tell', { field: 'tell' });
      if (want.length > TRIP_TELL_MAX) return no(400, 'Choose up to ' + TRIP_TELL_MAX + ' people', { field: 'tell' });
      // Only people on Parwah who are with us can be told.
      const tell = await audienceFor(sql, circle.id, 'trip', { only: want });
      if (tell.length !== want.length) return no(400, 'Someone you chose is not on Parwah, so cannot be told', { field: 'tell' });
      if (!(await rateLimit(sql, 'trip', me.id, 6, 3600, { failClosed: true }))) return no(429, 'Try again in a little while.');
      const v = c.value;
      const r = await sql`insert into trips (circle_id, member_id, dest, mode, expect_at, tell)
                          values (${circle.id}, ${me.id}, ${v.to}, ${v.by}, ${v.expectAt}, ${tell}::uuid[])
                          on conflict do nothing returning id`;
      if (!r[0]) return no(409, 'You already have a trip on. Tap Reached safely, or cancel it first.');
      await pushAudience(sql, circle.id, 'trip', { title: '🧳 ' + tripLine(me.name, v.to, v.by),
        body: 'Expected by ' + clockIn(v.expectAt, reqTz(req)) + '. You will hear when they reach.', url: '/#home' }, { only: tell });
      return res.status(201).json({ ok: true, id: r[0].id, tell });
    }
    if (action === 'trip_reached' || action === 'trip_cancel' || action === 'trip_extend') {
      if (!isUuid(b.id)) return no(404, 'That trip is not here any more');
      // Only the traveller: nobody else says they reached.
      const t = (await sql`select id, dest, tell, status from trips where id = ${b.id} and circle_id = ${circle.id} and member_id = ${me.id}`)[0];
      if (!t) return no(404, 'That trip is not here any more');
      if (t.status !== 'open') return res.status(200).json({ ok: true, already: true, status: t.status });
      if (action === 'trip_extend') {
        const c = tripClean({ to: t.dest, by: 'other', expectAt: b.expectAt });
        if (c.error) return no(400, c.error, { field: 'expectAt' });
        await sql`update trips set expect_at = ${c.value.expectAt}, asked_at = null where id = ${t.id} and status = 'open'`;
        await pushAudience(sql, circle.id, 'trip', { title: '🧳 ' + firstName(me.name) + ' is running a little late',
          body: 'Now expected in ' + t.dest + ' by ' + clockIn(c.value.expectAt, reqTz(req)) + '.', url: '/#home' }, { only: t.tell });
        return res.status(200).json({ ok: true, expectAt: c.value.expectAt });
      }
      const status = action === 'trip_reached' ? 'reached' : 'cancelled';
      const done = await sql`update trips set status = ${status}, reached_at = ${action === 'trip_reached' ? new Date() : null}
                             where id = ${t.id} and status = 'open' returning id`;
      if (!done[0]) return res.status(200).json({ ok: true, already: true });
      await pushAudience(sql, circle.id, 'trip', action === 'trip_reached'
        ? { title: '✅ ' + firstName(me.name) + ' reached ' + t.dest + ' safely', body: 'They tapped Reached safely just now.', url: '/#home' }
        : { title: '🧳 ' + firstName(me.name) + ' is not travelling to ' + t.dest + ' after all', body: 'The trip was taken off.', url: '/#home' },
        { only: t.tell });
      return res.status(200).json({ ok: true, status });
    }
    return no(400, 'Unknown action');
  } catch (e) { return fail(res, e); }
}
