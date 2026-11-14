// CLOSER TOGETHER (bonding round, Nov 2026): five ways for a family or a
// group to do things together, behind /api/plans?area=bond (no new function:
// the project is at its cap).
//
//   1. Date poll + who brings what. "Not sure of the date? Ask the family":
//      2 to 5 options, Yes / Maybe / No each, the host locks one and that
//      makes the plan (RSVP from the yes votes), told once. A plan carries
//      an item list that members claim and unclaim.
//   2. Sab milke: a shared card. Three days before a birthday (from dob) or
//      an anniversary (one date shared by a couple), everyone ELSE gets one
//      push and a Today card to add a line, a photo or a voice note. The
//      person celebrated can never read it before the day: the server never
//      sends it to them. On the day they get it, with every entry.
//   3. Tyohaar kit. Off until the circle picks its festivals. 14 days before
//      a chosen one: one card "Plan Diwali together" that makes a plan with
//      a video room, an item list and a "Make our greeting" card.
//   4. Things to do together on a call: a story read aloud, cooking, Antakshari,
//      photos; for groups also a quiz night and "watch together".
//   5. I'm in town (groups only): a city and two dates, never a location.
//      It goes away after the end date; "Let's meet" opens a poll for it.
//
// Time-based alerts ride on the polling the app already does (no crons):
// each is claimed by one insert or one conditional UPDATE, so it is sent
// once however many phones look at the same moment.
//
// BEING HEARD, AND ANSWERED (Nov 2026):
//   - a date poll can be a SECRET BALLOT (no name of who said what is sent
//     to any phone), says who it is "Waiting for", takes ONE reminder from
//     the host, shows the host the tally before the date is locked, and
//     the lock records what was decided. A vote can be given for someone
//     not on the app, kept as "for Dadi, by Rohan". Every vote counts once.
//   - a card: the evening before, people who have not written are reminded
//     once; if it is still empty the other adults are told, never the
//     person, and an empty card is never handed over. The person can say
//     thank you to everyone who wrote, in one tap or by voice.
//   - festivals are added and taken off one at a time, with a feed line
//     saying who changed what. Nobody can replace the whole list.
//
// GET  ?area=bond&circle=&member=            → state for this person
// GET  ?area=bond&thanks=CARD&by=MEMBER      → a voice thank-you, for the writers
// GET  ?area=bond&card=ID                    → one card with its entries
// GET  ?area=bond&entry=ID                   → one voice note's data
// POST {code, memberId, action:'bond_...'}   → see bondAction
import { randomBytes } from 'node:crypto';
import { schemaOnce, isUuid } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { placeOf } from './_places.mjs';
import { localDate, validTz, fromWall } from './_recur.mjs';
import { FESTIVALS, FEST_NOTE, festivalOf, festivalsDue, nextYearly, daysBetween, KIT_DAYS } from './_tyohaar.mjs';
import { isMinor } from './_standingrules.mjs';
import { awardHeard } from './_coins.mjs';
import { cardEveDue, dateTally, decidedLine, proxyLabel, waitingFor, waitingLine, festChangeLine } from './_heardrules.mjs';

export const CARD_DAYS_BEFORE = 3;
export const POLL_MIN = 2, POLL_MAX = 5;
export const ITEMS_MAX = 20;
export const VOICE_MAX_SEC = 60;
// ~32 kbps for 60 s is 240 KB, 320 KB as base64; anything bigger is refused.
export const VOICE_MAX_B64 = 340000;
export const VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'];
// A photo is shrunk on the phone to 640px; the cap keeps a row small.
export const PHOTO_MAX = 220000;
const PHOTO_URI = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const ENTRIES_PER_PERSON = 3;
export const ACTIVITIES = ['story', 'cook', 'antakshari', 'photos', 'quiz', 'watch'];
export const GROUP_ONLY_ACTIVITIES = ['quiz', 'watch'];
export const OCCASIONS = ['birthday', 'anniversary', 'festival', 'farewell', 'wedding', 'other'];
const KINDS = ['call', 'party', 'meet', 'appointment', 'function', 'trip', 'other'];

function roomUrl() { return 'https://meet.jit.si/parwah-' + randomBytes(16).toString('hex'); }
const first = (n) => String(n || '').split(' ')[0];

let ready = false;
export async function ensureBondSchema(sql) {
  if (ready) return;
  // Two "alter table members" on a first open can deadlock with another
  // screen's schema work; that is retried like a duplicate-table race.
  for (let i = 1; ; i++) {
    try { await bondTables(sql); break; }
    catch (e) { if (!(e && e.code === '40P01') || i >= 4) throw e; await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * 80))); }
  }
  ready = true;
}
async function bondTables(sql) {
  await schemaOnce(async () => {
    await sql`create table if not exists plan_polls (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      by_member uuid references members(id) on delete set null,
      title text not null,
      kind text not null default 'meet',
      place text,
      items jsonb not null default '[]',
      status text not null default 'open',
      plan_id uuid,
      locked_at timestamptz,
      created_at timestamptz not null default now()
    )`;
    await sql`create table if not exists plan_options (
      id uuid primary key default gen_random_uuid(),
      poll_id uuid not null references plan_polls(id) on delete cascade,
      at timestamptz not null
    )`;
    await sql`create table if not exists plan_votes (
      option_id uuid not null references plan_options(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      answer text not null,
      at timestamptz not null default now(),
      primary key (option_id, member_id)
    )`;
    await sql`create table if not exists plan_items (
      id uuid primary key default gen_random_uuid(),
      plan_id uuid not null references plans(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      label text not null,
      by_member uuid references members(id) on delete set null,
      claimed_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now()
    )`;
    await sql`alter table plans add column if not exists activity text`;
    await sql`alter table plans add column if not exists activity_note text`;
    await sql`alter table plans add column if not exists festival text`;
    // One anniversary per couple: both rows carry the date and point at
    // each other, so either person's page shows and edits the same day.
    await sql`alter table members add column if not exists anniversary date`;
    await sql`alter table members add column if not exists anniv_with uuid references members(id) on delete set null`;
    // Someone who is no longer with us (api/_remember.mjs, Family Memory)
    // gets no birthday or anniversary card. The column is made here too,
    // so this sweep never depends on which screen a family opened first.
    await sql`alter table members add column if not exists remembered boolean not null default false`;
    await sql`create table if not exists cards (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      for_member uuid references members(id) on delete cascade,
      for_member2 uuid references members(id) on delete cascade,
      for_name text,
      occasion text not null,
      title text not null,
      date date not null,
      by_member uuid references members(id) on delete set null,
      auto_key text,
      delivered_at timestamptz,
      created_at timestamptz not null default now()
    )`;
    await sql`create unique index if not exists cards_auto on cards (circle_id, auto_key) where auto_key is not null`;
    await sql`create table if not exists card_entries (
      id uuid primary key default gen_random_uuid(),
      card_id uuid not null references cards(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      kind text not null,
      text text,
      data text,
      mime text,
      seconds int,
      created_at timestamptz not null default now()
    )`;
    // The evening-before reminder, sent once; and the thank-you from the
    // person the card was for, one per person.
    await sql`alter table cards add column if not exists eve_at timestamptz`;
    await sql`create table if not exists card_thanks (
      card_id uuid not null references cards(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      audio text,
      mime text,
      seconds int,
      at timestamptz not null default now(),
      primary key (card_id, member_id)
    )`;
    // Equal votes: a secret ballot, the one reminder, what was decided, and
    // a vote given for someone who is not on the app.
    await sql`alter table plan_polls add column if not exists secret boolean not null default false`;
    await sql`alter table plan_polls add column if not exists reminded_at timestamptz`;
    await sql`alter table plan_polls add column if not exists decided jsonb`;
    await sql`alter table plan_votes add column if not exists by_member uuid references members(id) on delete set null`;
    await sql`create table if not exists circle_festivals (
      circle_id uuid not null references circles(id) on delete cascade,
      fkey text not null,
      primary key (circle_id, fkey)
    )`;
    await sql`create table if not exists festival_kits (
      circle_id uuid not null references circles(id) on delete cascade,
      fkey text not null,
      fdate date not null,
      alerted_at timestamptz not null default now(),
      kit_by uuid references members(id) on delete set null,
      kit_at timestamptz,
      plan_id uuid,
      card_id uuid,
      primary key (circle_id, fkey, fdate)
    )`;
    await sql`create table if not exists in_town (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      city text not null,
      from_date date not null,
      to_date date not null,
      created_at timestamptz not null default now()
    )`;
  });
}

// A person's own today, from where they live (never from the phone that is
// asking, which anyone could set to the far side of the date line).
export function todayFor(m, nowMs = Date.now()) { return localDate(nowMs, placeOf(m && m.place, m && m.country, null).tz); }
const tzFor = (m) => placeOf(m && m.place, m && m.country, null).tz;
// A date column comes back as midnight on the server's own clock: read it
// with the local parts, never through toISOString, which can shift the day.
const dstr = (d) => d instanceof Date
  ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  : String(d || '').slice(0, 10);

// THE SECRET. A card for someone is sealed to them, and to them only, until
// their own day has come. Everyone else may read it at any time.
export function sealedTo(card, me) {
  if (!card || !me) return true;
  const forMe = card.for_member === me.id || card.for_member2 === me.id;
  return forMe && dstr(card.date) > todayFor(me);
}

async function pushOthers(sql, circleId, except, payload) {
  const rows = await sql`select id from members where circle_id = ${circleId} and user_id is not null`;
  await pushIds(sql, circleId, rows.map(r => r.id).filter(id => !except.includes(id)), payload);
}
// To each of these people, all at once.
async function pushIds(sql, circleId, ids, payload) {
  await Promise.allSettled([...new Set(ids)].map(id => pushCircle(sql, circleId, payload, { only: id })));
}

// ------------------------------------------------------------ the sweep
// Birthdays and anniversaries 3 days out make their card (one insert, once),
// a card is handed over on the day (one UPDATE, once), and a chosen
// festival 14 days out is announced (one insert, once).
export async function sweepBond(sql, circle, nowMs = Date.now()) {
  let sent = 0;
  const members = await sql`select m.id, m.name, m.dob, m.place, m.country, m.anniversary, m.anniv_with, m.remembered, m.user_id,
                                    coalesce((to_jsonb(m)->>'is_child')::boolean, false) as is_child, (to_jsonb(m)->>'adult_confirmed')::boolean as adult_confirmed
                             from members m where m.circle_id = ${circle.id}`;
  const byId = new Map(members.map(m => [m.id, m]));
  const make = async (key, occ, title, day, a, b) => {
    const row = await sql`insert into cards (circle_id, for_member, for_member2, occasion, title, date, auto_key)
                          values (${circle.id}, ${a}, ${b}, ${occ}, ${title}, ${day}, ${key})
                          on conflict (circle_id, auto_key) where auto_key is not null do nothing returning id`;
    if (!row[0]) return;
    sent++;
    // To everyone but the person (or couple) it is for. No feed line: the
    // feed is read by the person celebrated too.
    await pushOthers(sql, circle.id, [a, b].filter(Boolean), { title: '🎉 ' + title + ' in ' + CARD_DAYS_BEFORE + ' days', body: 'Add a line, a photo or a voice note to the card. It stays a surprise.', url: '/#home' });
  };
  for (const m of members) {
    if (!m.dob || m.remembered) continue;   // no birthday card for someone remembered
    const t = todayFor(m, nowMs), nx = nextYearly(dstr(m.dob), t);
    if (nx && nx.inDays <= CARD_DAYS_BEFORE) await make('bday:' + m.id + ':' + nx.year, 'birthday', m.name + "'s birthday", nx.day, m.id, null);
  }
  for (const m of members) {
    const w = m.anniv_with && byId.get(m.anniv_with);
    if (!m.anniversary || !w || m.id > w.id) continue;   // each couple once
    if (m.remembered || w.remembered) continue;          // nor an anniversary card
    const t = todayFor(m, nowMs), nx = nextYearly(dstr(m.anniversary), t);
    if (nx && nx.inDays <= CARD_DAYS_BEFORE) await make('anniv:' + m.id + ':' + w.id + ':' + nx.year, 'anniversary', first(m.name) + ' and ' + first(w.name) + "'s anniversary", nx.day, m.id, w.id);
  }
  // THE EVENING BEFORE (from 6pm where the person lives, or on the day if
  // no phone was awake): everyone who has not written yet is reminded,
  // once. If nobody has written at all, the other ADULTS are told the card
  // is still empty. The person it is for is never told either thing.
  const eve = await sql`select c.id, c.title, c.for_member, c.for_member2, c.date from cards c
                        where c.circle_id = ${circle.id} and c.for_member is not null and c.eve_at is null and c.delivered_at is null
                          and c.date between current_date - 1 and current_date + 2`;
  for (const c of eve) {
    const who = byId.get(c.for_member), who2 = c.for_member2 ? byId.get(c.for_member2) : null;
    if (!who || who.remembered || (who2 && who2.remembered)) continue;
    if (!cardEveDue(dstr(c.date), nowMs, tzFor(who))) continue;
    const got = await sql`update cards set eve_at = now() where id = ${c.id} and eve_at is null returning id`;
    if (!got[0]) continue;                 // another phone sent it
    const writers = (await sql`select distinct member_id from card_entries where card_id = ${c.id}`).map(r => r.member_id);
    const others = members.filter(m => m.user_id && !m.remembered && m.id !== c.for_member && m.id !== c.for_member2);
    const when = dstr(c.date) === todayFor(who, nowMs) ? 'today' : 'tomorrow';
    const remind = { title: '💌 ' + c.title + ' is ' + when, body: 'Your line is not on the card yet. Add a line, a photo or a voice note. It stays a surprise.', url: '/#home' };
    if (!writers.length) {
      const adults = others.filter(m => !isMinor(m, todayFor(m, nowMs)));
      await pushIds(sql, circle.id, adults.map(m => m.id), { title: '💌 ' + c.title + ' is ' + when + ', and the card is still empty',
        body: 'Nobody has written yet. Add a line tonight so there is a card to open. ' + first(who.name) + ' is not told.', url: '/#home' });
      await pushIds(sql, circle.id, others.filter(m => !adults.includes(m)).map(m => m.id), remind);
    } else {
      await pushIds(sql, circle.id, others.filter(m => !writers.includes(m.id)).map(m => m.id), remind);
    }
    sent++;
  }
  // On the day: the person gets their card, once. A card nobody wrote in is
  // NEVER marked as handed over and never announced: it waits (for three
  // days) until someone writes, and is handed over then.
  const due = await sql`select c.id, c.title, c.for_member, c.for_member2, c.date,
                               (select count(*)::int from card_entries e where e.card_id = c.id) as n
                        from cards c
                        where c.circle_id = ${circle.id} and c.for_member is not null and c.delivered_at is null
                          and c.date <= current_date + 1 and c.date >= current_date - 3`;
  for (const c of due) {
    const who = byId.get(c.for_member), who2 = c.for_member2 ? byId.get(c.for_member2) : null;
    // A card still waiting for someone since marked as remembered is never sent.
    if (!who || who.remembered || (who2 && who2.remembered) || dstr(c.date) > todayFor(who, nowMs)) continue;
    if (!c.n) continue;                    // empty: not delivered
    const got = await sql`update cards set delivered_at = now() where id = ${c.id} and delivered_at is null returning id`;
    if (!got[0]) continue;
    sent++;
    await pushIds(sql, circle.id, [c.for_member, c.for_member2].filter(Boolean), { title: '💌 Your ' + (circle.kind === 'group' ? 'group' : 'family') + ' made you a card', body: c.n + (c.n === 1 ? ' message is' : ' messages are') + ' waiting for you on Parwah', url: '/#home' });
  }
  // Festivals the circle chose, 14 days out, once each.
  const keys = (await sql`select fkey from circle_festivals where circle_id = ${circle.id}`).map(r => r.fkey);
  if (keys.length) {
    for (const f of festivalsDue(keys, localDate(Date.now(), 'Asia/Kolkata'))) {
      const row = await sql`insert into festival_kits (circle_id, fkey, fdate) values (${circle.id}, ${f.key}, ${f.date})
                            on conflict do nothing returning fkey`;
      if (!row[0]) continue;
      sent++;
      await pushCircle(sql, circle.id, { title: f.icon + ' ' + f.name + (f.inDays === 0 ? ' is today' : ' in ' + f.inDays + ' days'), body: 'Plan it together on Parwah: one plan, a call for anyone away, and who brings what.', url: '/#home' }, {});
    }
  }
  return sent;
}

// ------------------------------------------------------------ state
export async function bondState(sql, circle, me) {
  await sweepBond(sql, circle);
  const today = todayFor(me);
  const kind = circle.kind === 'group' ? 'group' : 'family';
  const polls = await sql`
    select p.id, p.title, p.kind, p.place, p.items, p.status, p.plan_id, p.by_member, b.name as by_name, p.created_at,
           p.secret, p.reminded_at, p.decided
    from plan_polls p left join members b on b.id = p.by_member
    where p.circle_id = ${circle.id} and (p.status = 'open' or p.locked_at > now() - interval '2 days')
    order by p.created_at desc limit 10`;
  const opts = polls.length ? await sql`
    select o.id, o.poll_id, o.at,
           coalesce((select json_agg(json_build_object('m', v.member_id, 'a', v.answer, 'n', vm.name, 'by', v.by_member, 'bn', bm.name) order by v.at)
                     from plan_votes v join members vm on vm.id = v.member_id left join members bm on bm.id = v.by_member
                     where v.option_id = o.id), '[]') as votes
    from plan_options o where o.poll_id = any(${polls.map(p => p.id)}::uuid[]) order by o.at` : [];
  const voters = polls.length ? await sql`select m.id, m.name, (m.user_id is not null) as on_app from members m
                                          where m.circle_id = ${circle.id} and not m.remembered order by m.created_at` : [];
  for (const p of polls) {
    const mine = opts.filter(o => o.poll_id === p.id);
    const voted = [...new Set(mine.flatMap(o => (o.votes || []).map(x => x.m)))];
    const tally = dateTally(mine);
    p.options = mine.map(o => {
      const v = o.votes || [];
      const pick = a => v.filter(x => x.a === a).map(x => x.m);
      const nameOf = x => x.by && x.by !== x.m ? proxyLabel(x.n, x.bn) : x.m === me.id ? 'You' : x.n;
      const t = tally.rows.find(r => r.id === o.id);
      // A SECRET BALLOT: the counts, and my own answer. No id and no name of
      // anyone else is put in the reply, so no screen can show one.
      return { id: o.id, at: o.at, n: { yes: t.yes, maybe: t.maybe, no: t.no },
        yes: p.secret ? [] : pick('yes'), maybe: p.secret ? [] : pick('maybe'), no: p.secret ? [] : pick('no'),
        yesNames: p.secret ? [] : v.filter(x => x.a === 'yes').map(nameOf),
        mine: (v.find(x => x.m === me.id && !(x.by && x.by !== x.m)) || {}).a || null,
        mineFor: v.filter(x => x.by === me.id && x.by !== x.m).map(x => ({ id: x.m, name: x.n, answer: x.a, label: proxyLabel(x.n, x.bn) })) };
    });
    const waiting = p.status === 'open' ? waitingFor(voters.filter(x => x.on_app), voted) : [];
    p.secret = !!p.secret;
    p.waiting = p.status === 'open' ? waitingLine(waiting) : null;
    p.reminded = !!p.reminded_at; delete p.reminded_at;
    p.canRemind = p.status === 'open' && p.by_member === me.id && !p.reminded && waiting.length > 0;
    // The host sees the tally before locking a date: the counts for every
    // date, and the date most people can make.
    p.tally = p.by_member === me.id && p.status === 'open' ? tally : null;
    p.offApp = p.status === 'open' ? voters.filter(x => !x.on_app).map(x => ({ id: x.id, name: x.name })) : [];
  }
  const items = await sql`
    select i.id, i.plan_id, i.label, i.by_member, i.claimed_by, c.name as claimed_name
    from plan_items i join plans p on p.id = i.plan_id left join members c on c.id = i.claimed_by
    where i.circle_id = ${circle.id} and p.at > now() - interval '3 hours' order by i.created_at`;
  const plans = await sql`select id, activity, activity_note, festival from plans
                          where circle_id = ${circle.id} and at > now() - interval '3 hours'
                            and (activity is not null or festival is not null)`;
  // Cards: everything in its window, minus anything sealed to this person.
  const cardsAll = await sql`
    select c.id, c.occasion, c.title, c.date, c.for_member, c.for_member2, c.for_name, c.by_member, c.delivered_at,
           (select count(*)::int from card_entries e where e.card_id = c.id) as n,
           (select count(*)::int from card_entries e where e.card_id = c.id and e.member_id = ${me.id}) as mine,
           exists (select 1 from card_thanks t where t.card_id = c.id and t.member_id = ${me.id}) as thanked,
           (select string_agg(tm.name, ', ' order by t.at) from card_thanks t join members tm on tm.id = t.member_id where t.card_id = c.id) as thanks,
           -- Someone not on the app cannot open it here: the family shows, prints or sends it.
           (c.for_member is null or exists (select 1 from members fm where fm.id = c.for_member and fm.user_id is null)) as off_app
    from cards c where c.circle_id = ${circle.id} and c.date >= current_date - 3 and c.date <= current_date + 60
    order by c.date asc limit 30`;
  // A card nobody has written in yet is never shown to the person it is for.
  const cards = cardsAll.filter(c => !sealedTo(c, me) && !((c.for_member === me.id || c.for_member2 === me.id) && !c.n)).map(c => ({
    ...c, date: dstr(c.date), forMe: c.for_member === me.id || c.for_member2 === me.id, inDays: daysBetween(today, dstr(c.date))
  }));
  const chosen = (await sql`select fkey from circle_festivals where circle_id = ${circle.id}`).map(r => r.fkey);
  const kits = chosen.length ? await sql`select fkey, fdate, kit_by, plan_id, card_id from festival_kits where circle_id = ${circle.id} and fdate >= current_date - 1` : [];
  const due = festivalsDue(chosen, today).map(f => {
    const k = kits.find(x => x.fkey === f.key && dstr(x.fdate) === f.date) || {};
    return { ...f, planId: k.plan_id || null, cardId: k.card_id || null, started: !!k.kit_by };
  });
  const town = kind === 'group' ? await sql`
    select t.id, t.member_id, m.name, t.city, t.from_date, t.to_date from in_town t join members m on m.id = t.member_id
    where t.circle_id = ${circle.id} and t.to_date >= ${today}::date order by t.from_date limit 20` : [];
  const anniv = await sql`select id, anniversary, anniv_with from members where circle_id = ${circle.id} and anniversary is not null`;
  return {
    kind, today, polls, items, plans, cards,
    festivals: { chosen, list: FESTIVALS.map(f => ({ key: f.key, name: f.name, icon: f.icon, dates: f.dates })), due, note: FEST_NOTE, days: KIT_DAYS },
    inTown: town.map(t => ({ ...t, from_date: dstr(t.from_date), to_date: dstr(t.to_date) })),
    anniv: anniv.map(a => ({ id: a.id, date: dstr(a.anniversary), with: a.anniv_with }))
  };
}

export async function cardRead(sql, circle, me, cardId) {
  if (!isUuid(cardId)) return { status: 400, json: { ok: false, error: 'Bad card id' } };
  const c = (await sql`select id, occasion, title, date, for_member, for_member2, for_name, by_member from cards where id = ${cardId} and circle_id = ${circle.id}`)[0];
  if (!c) return { status: 404, json: { ok: false, error: 'That card is not here' } };
  if (sealedTo(c, me)) return { status: 403, json: { ok: false, error: 'This card is a surprise until the day' } };
  const entries = await sql`select e.id, e.member_id, m.name, e.kind, e.text, e.mime, e.seconds, e.created_at,
                                   case when e.kind = 'photo' then e.data else null end as data
                            from card_entries e join members m on m.id = e.member_id
                            where e.card_id = ${c.id} order by e.created_at`;
  const forMe = c.for_member === me.id || c.for_member2 === me.id;
  // An empty card is not shown to the person it is for.
  if (forMe && !entries.length) return { status: 404, json: { ok: false, error: 'That card is not here' } };
  const thanks = await sql`select t.member_id, m.name, (t.audio is not null) as has_audio, t.seconds from card_thanks t join members m on m.id = t.member_id
                           where t.card_id = ${c.id} order by t.at`;
  const off = !c.for_member || !!(await sql`select 1 as x from members where id = ${c.for_member} and user_id is null`)[0];
  return { status: 200, json: { ok: true, card: { ...c, date: dstr(c.date), forMe, offApp: off,
    canThank: forMe && entries.length > 0 && !thanks.some(t => t.member_id === me.id) }, entries,
    thanks: thanks.map(t => ({ memberId: t.member_id, name: t.name, hasAudio: t.has_audio, secs: t.seconds })) } };
}

// A voice thank-you from the person the card was for: for anyone who may
// read the card (the writers, and the family once it is opened).
export async function thanksAudio(sql, circle, me, cardId, byId) {
  if (!isUuid(cardId) || !isUuid(byId)) return { status: 400, json: { ok: false, error: 'Bad id' } };
  const r = (await sql`select t.audio, t.mime, t.seconds, c.date, c.for_member, c.for_member2 from card_thanks t join cards c on c.id = t.card_id
                       where t.card_id = ${cardId} and t.member_id = ${byId} and c.circle_id = ${circle.id} and t.audio is not null`)[0];
  if (!r) return { status: 404, json: { ok: false, error: 'That voice note is not here' } };
  if (sealedTo(r, me)) return { status: 403, json: { ok: false, error: 'This card is a surprise until the day' } };
  return { status: 200, json: { ok: true, mime: r.mime, data: r.audio, seconds: r.seconds } };
}

export async function entryAudio(sql, circle, me, entryId) {
  if (!isUuid(entryId)) return { status: 400, json: { ok: false, error: 'Bad entry id' } };
  const r = (await sql`select e.mime, e.data, e.seconds, c.date, c.for_member, c.for_member2 from card_entries e join cards c on c.id = e.card_id
                       where e.id = ${entryId} and c.circle_id = ${circle.id} and e.kind = 'voice'`)[0];
  if (!r) return { status: 404, json: { ok: false, error: 'That voice note is not here' } };
  if (sealedTo(r, me)) return { status: 403, json: { ok: false, error: 'This card is a surprise until the day' } };
  return { status: 200, json: { ok: true, mime: r.mime, data: r.data, seconds: r.seconds } };
}

// ------------------------------------------------------------ actions
const bad = (error, status = 400) => ({ status, json: { ok: false, error } });
const good = (json, status = 200) => ({ status, json: { ok: true, ...json } });
const cleanText = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const dayOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(new Date(String(v) + 'T00:00:00Z'));

async function memberIn(sql, circle, id) {
  if (!isUuid(id)) return null;
  return (await sql`select id, name, place, country from members where id = ${id} and circle_id = ${circle.id}`)[0] || null;
}
async function planIn(sql, circle, id) {
  if (!isUuid(id)) return null;
  return (await sql`select id, title, by_member, kind from plans where id = ${id} and circle_id = ${circle.id}`)[0] || null;
}
async function addItems(sql, circle, planId, by, labels) {
  const list = (Array.isArray(labels) ? labels : []).map(x => cleanText(x, 60)).filter(Boolean).slice(0, ITEMS_MAX);
  for (const l of list) await sql`insert into plan_items (plan_id, circle_id, label, by_member) values (${planId}, ${circle.id}, ${l}, ${by})`;
  return list.length;
}
async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
}

export async function bondAction(sql, circle, me, body) {
  const a = String(body.action || '');
  const space = circle.kind === 'group' ? 'group' : 'family';

  // ---- 1. date poll
  if (a === 'bond_poll_create') {
    const title = cleanText(body.title, 100);
    if (!title) return bad('Give the plan a name');
    const raw = Array.isArray(body.options) ? body.options : [];
    const ats = [...new Set(raw.map(x => new Date(String(x || ''))).filter(d => !isNaN(d) && d > new Date(Date.now() - 60000)).map(d => d.toISOString()))];
    if (raw.length < POLL_MIN || raw.length > POLL_MAX) return bad('Give ' + POLL_MIN + ' to ' + POLL_MAX + ' dates to choose from');
    if (ats.length !== raw.length) return bad('Every date must be in the future, and each one different');
    const kind = KINDS.includes(body.kind) ? body.kind : 'meet';
    const items = (Array.isArray(body.items) ? body.items : []).map(x => cleanText(x, 60)).filter(Boolean).slice(0, ITEMS_MAX);
    const p = await sql`insert into plan_polls (circle_id, by_member, title, kind, place, items, secret)
                        values (${circle.id}, ${me.id}, ${title}, ${kind}, ${cleanText(body.place, 120) || null}, ${JSON.stringify(items)}::jsonb, ${!!body.secret}) returning id`;
    for (const at of ats) await sql`insert into plan_options (poll_id, at) values (${p[0].id}, ${at})`;
    await feed(sql, circle.id, me.id, `${me.name} asked: when can we do "${title}"? 🗳`);
    await pushCircle(sql, circle.id, { title: '🗳 ' + me.name + ' asks: which date?', body: title + ': tap Yes, Maybe or No on each date', url: '/#fun' }, { except: me.id });
    return good({ id: p[0].id }, 201);
  }
  if (a === 'bond_poll_vote') {
    if (!isUuid(body.optionId)) return bad('Bad option');
    const ans = ['yes', 'maybe', 'no'].includes(body.answer) ? body.answer : null;
    if (!ans) return bad('Answer Yes, Maybe or No');
    const o = (await sql`select o.id, p.status from plan_options o join plan_polls p on p.id = o.poll_id
                         where o.id = ${body.optionId} and p.circle_id = ${circle.id}`)[0];
    if (!o) return bad('That date is not here', 404);
    if (o.status !== 'open') return bad('The date is already chosen', 409);
    // A vote for someone not on the app: in this circle, cannot vote
    // themself, not remembered. Kept as "for Dadi, by Rohan"; counts once.
    let voter = me.id, by = null;
    if (body.forId) {
      if (!isUuid(body.forId)) return bad('Choose who you are answering for');
      const t = (await sql`select id, name, user_id from members where id = ${body.forId} and circle_id = ${circle.id} and not remembered`)[0];
      if (!t) return bad('Choose someone in this ' + space, 404);
      if (t.user_id) return bad(t.name + ' is on Parwah and answers for themself');
      voter = t.id; by = me.id;
    }
    await sql`insert into plan_votes (option_id, member_id, answer, by_member) values (${o.id}, ${voter}, ${ans}, ${by})
              on conflict (option_id, member_id) do update set answer = excluded.answer, by_member = excluded.by_member, at = now()`;
    return good({ answer: ans });
  }
  // ONE reminder from the host to the people who have not answered any
  // date. Claimed by one UPDATE: a second tap sends nothing.
  if (a === 'bond_poll_remind') {
    if (!isUuid(body.pollId)) return bad('Bad poll');
    const p = (await sql`select id, by_member, title, status from plan_polls where id = ${body.pollId} and circle_id = ${circle.id}`)[0];
    if (!p) return bad('That poll is not here', 404);
    if (p.by_member !== me.id) return bad('Only the person who asked can send the reminder', 403);
    if (p.status !== 'open') return bad('The date is already chosen', 409);
    const got = await sql`update plan_polls set reminded_at = now() where id = ${p.id} and reminded_at is null returning id`;
    if (!got[0]) return bad('The reminder has already been sent. It goes only once.', 409);
    const who = await sql`select m.id from members m where m.circle_id = ${circle.id} and m.user_id is not null and not m.remembered and m.id <> ${me.id}
                          and not exists (select 1 from plan_votes v join plan_options o on o.id = v.option_id where o.poll_id = ${p.id} and v.member_id = m.id)`;
    await pushIds(sql, circle.id, who.map(w => w.id), { title: '🗳 ' + me.name + ' is waiting for your answer', body: p.title + ': tap Yes, Maybe or No on each date', url: '/#fun' });
    return good({ reminded: who.length });
  }
  if (a === 'bond_poll_lock') {
    if (!isUuid(body.pollId) || !isUuid(body.optionId)) return bad('Bad poll');
    const p = (await sql`select id, by_member, title, kind, place, items, status, secret from plan_polls where id = ${body.pollId} and circle_id = ${circle.id}`)[0];
    if (!p) return bad('That poll is not here', 404);
    if (p.by_member !== me.id) return bad('Only the person who asked can lock the date', 403);
    const o = (await sql`select id, at from plan_options where id = ${body.optionId} and poll_id = ${p.id}`)[0];
    if (!o) return bad('That date is not in this poll', 404);
    // The claim: one UPDATE, so two taps (or two phones) make one plan.
    const got = await sql`update plan_polls set status = 'locked', locked_at = now() where id = ${p.id} and status = 'open' returning id`;
    if (!got[0]) return bad('The date is already locked', 409);
    // WHAT WAS DECIDED is written down with the lock: the date, who locked
    // it, and the count for every date as it stood. Counts only, never a
    // name, and every vote counted once, whoever cast it.
    const all = await sql`select o.id, o.at, coalesce((select json_agg(json_build_object('a', v.answer)) from plan_votes v join members m on m.id = v.member_id
                                                       where v.option_id = o.id and m.circle_id = ${circle.id}), '[]') as votes
                          from plan_options o where o.poll_id = ${p.id} order by o.at`;
    const tally = dateTally(all), row = tally.rows.find(r => r.id === o.id);
    const decided = { optionId: o.id, at: o.at, by: me.id, byName: me.name, yes: row.yes, maybe: row.maybe, no: row.no,
                      mostYes: tally.best === o.id, tally: tally.rows, line: decidedLine(p.title, row) };
    await sql`update plan_polls set decided = ${JSON.stringify(decided)}::jsonb where id = ${p.id}`;
    const yes = (await sql`select v.member_id from plan_votes v join members m on m.id = v.member_id
                           where v.option_id = ${o.id} and v.answer = 'yes' and m.circle_id = ${circle.id}`).map(r => r.member_id);
    // A secret ballot stays secret: nobody is put on the "going" list from
    // their vote. Each person says "I'm in" themself.
    const going = [...new Set([me.id, ...(p.secret ? [] : yes)])];
    const room = (p.kind === 'call' || p.kind === 'party') ? roomUrl() : null;
    const plan = await sql`insert into plans (circle_id, by_member, title, kind, at, place, room, going)
                           values (${circle.id}, ${me.id}, ${p.title}, ${p.kind}, ${o.at}, ${p.place}, ${room}, ${'{' + going.join(',') + '}'}) returning id`;
    await sql`update plan_polls set plan_id = ${plan[0].id} where id = ${p.id}`;
    await addItems(sql, circle, plan[0].id, me.id, p.items || []);
    await feed(sql, circle.id, me.id, `${me.name} locked the date for ${p.title} 🗓 (${row.yes} yes, ${row.maybe} maybe, ${row.no} no)`);
    await pushCircle(sql, circle.id, { title: '🗓 Date locked: ' + p.title, body: 'Open Parwah to see the day, in your own time', url: '/#fun' }, { except: me.id });
    return good({ planId: plan[0].id, going: going.length, decided });
  }
  if (a === 'bond_poll_cancel') {
    if (!isUuid(body.pollId)) return bad('Bad poll');
    const got = await sql`update plan_polls set status = 'cancelled', locked_at = now() where id = ${body.pollId} and circle_id = ${circle.id} and by_member = ${me.id} and status = 'open' returning id`;
    if (!got[0]) return bad('Only the person who asked can close an open poll', 403);
    return good({});
  }

  // ---- 1b. who brings what
  if (a === 'bond_item_add') {
    const p = await planIn(sql, circle, body.planId);
    if (!p) return bad('That plan is not here', 404);
    const n = (await sql`select count(*)::int as n from plan_items where plan_id = ${p.id}`)[0].n;
    if (n >= ITEMS_MAX) return bad('That list is full (' + ITEMS_MAX + ' things)');
    if (!(await addItems(sql, circle, p.id, me.id, [body.label]))) return bad('Write what is needed');
    return good({}, 201);
  }
  if (a === 'bond_item_claim') {
    if (!isUuid(body.itemId)) return bad('Bad item');
    const i = (await sql`select id, claimed_by, label from plan_items where id = ${body.itemId} and circle_id = ${circle.id}`)[0];
    if (!i) return bad('That is not on the list', 404);
    if (i.claimed_by === me.id) {
      await sql`update plan_items set claimed_by = null where id = ${i.id} and claimed_by = ${me.id}`;
      return good({ claimed: false });
    }
    const got = await sql`update plan_items set claimed_by = ${me.id} where id = ${i.id} and claimed_by is null returning id`;
    if (!got[0]) return bad('Someone is already bringing that', 409);
    return good({ claimed: true });
  }
  if (a === 'bond_item_remove') {
    if (!isUuid(body.itemId)) return bad('Bad item');
    const got = await sql`delete from plan_items i using plans p where i.id = ${body.itemId} and i.circle_id = ${circle.id} and p.id = i.plan_id
                          and (i.by_member = ${me.id} or p.by_member = ${me.id}) returning i.id`;
    if (!got[0]) return bad('Only who added it, or who made the plan, can take it off', 403);
    return good({});
  }

  // ---- 4. do something together
  if (a === 'bond_activity') {
    const p = await planIn(sql, circle, body.planId);
    if (!p) return bad('That plan is not here', 404);
    const act = body.activity === null || body.activity === '' ? null : String(body.activity || '');
    if (act !== null && !ACTIVITIES.includes(act)) return bad('Pick something to do together');
    if (act && GROUP_ONLY_ACTIVITIES.includes(act) && circle.kind !== 'group') return bad('That one is for groups');
    let note = cleanText(body.note, 300) || null;
    if (act === 'watch' && note && /^[a-z]+:/i.test(note) && !/^https?:\/\//i.test(note)) return bad('A link must start with https://');
    await sql`update plans set activity = ${act}, activity_note = ${act ? note : null} where id = ${p.id}`;
    return good({ activity: act });
  }

  // ---- 2. cards
  if (a === 'bond_card_start') {
    const occ = OCCASIONS.includes(body.occasion) ? body.occasion : 'other';
    if (!dayOk(body.date)) return bad('Pick the day');
    const today = todayFor(me);
    if (body.date < today) return bad('Pick a day from today on');
    if (daysBetween(today, body.date) > 366) return bad('Pick a day within a year');
    let forM = null, forName = null;
    if (body.forMember) {
      const m = await memberIn(sql, circle, body.forMember);
      if (!m) return bad('That person is not in this ' + space, 403);
      if (m.id === me.id) return bad('A card is made for someone else');
      forM = m.id; forName = m.name;
    } else forName = cleanText(body.forName, 60) || null;
    const title = cleanText(body.title, 80) || (forName ? forName + "'s " + (occ === 'other' ? 'card' : occ) : null);
    if (!title) return bad('Say who the card is for');
    const c = await sql`insert into cards (circle_id, for_member, for_name, occasion, title, date, by_member)
                        values (${circle.id}, ${forM}, ${forName}, ${occ}, ${title}, ${body.date}, ${me.id}) returning id`;
    await pushOthers(sql, circle.id, [me.id, forM].filter(Boolean), { title: '💌 ' + me.name + ' started a card: ' + title, body: 'Add a line, a photo or a voice note' + (forM ? '. It stays a surprise.' : ''), url: '/#home' });
    return good({ id: c[0].id }, 201);
  }
  if (a === 'bond_card_add') {
    if (!isUuid(body.cardId)) return bad('Bad card');
    const c = (await sql`select id, date, for_member, for_member2 from cards where id = ${body.cardId} and circle_id = ${circle.id}`)[0];
    if (!c) return bad('That card is not here', 404);
    if (c.for_member === me.id || c.for_member2 === me.id) return bad('This card is for you, so it is a surprise', 403);
    if (dstr(c.date) < localDate(Date.now() - 86400000 * 3, 'UTC')) return bad('That day has gone');
    const n = (await sql`select count(*)::int as n from card_entries where card_id = ${c.id} and member_id = ${me.id}`)[0].n;
    if (n >= ENTRIES_PER_PERSON) return bad('You have added ' + ENTRIES_PER_PERSON + ' things already. Remove one to add another.');
    const k = body.kind;
    if (k === 'text') {
      const t = String(body.text || '').trim().slice(0, 300);
      if (!t) return bad('Write a line');
      await sql`insert into card_entries (card_id, member_id, kind, text) values (${c.id}, ${me.id}, 'text', ${t})`;
    } else if (k === 'photo') {
      const d = String(body.data || '');
      if (!PHOTO_URI.test(d) || d.length > PHOTO_MAX) return bad('That photo is too big or not a photo');
      await sql`insert into card_entries (card_id, member_id, kind, data, text) values (${c.id}, ${me.id}, 'photo', ${d}, ${cleanText(body.text, 120) || null})`;
    } else if (k === 'voice') {
      const mime = String(body.mime || '').split(';')[0];
      if (!VOICE_TYPES.includes(mime)) return bad('That recording type is not supported');
      const d = String(body.data || '');
      if (!d || d.length > VOICE_MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(d)) return bad('A voice note can be up to ' + VOICE_MAX_SEC + ' seconds');
      const secs = Math.max(1, Math.min(VOICE_MAX_SEC, parseInt(body.seconds, 10) || 1));
      await sql`insert into card_entries (card_id, member_id, kind, data, mime, seconds) values (${c.id}, ${me.id}, 'voice', ${d}, ${mime}, ${secs})`;
    } else return bad('Add a line, a photo or a voice note');
    await awardHeard(sql, circle.id, me.id, 'card_line', todayFor(me));
    return good({}, 201);
  }
  // "Say thank you": from the person the card was for, to everyone who
  // wrote in it. One tap, or a voice note. Once per card per person.
  if (a === 'bond_card_thanks') {
    if (!isUuid(body.cardId)) return bad('Bad card');
    const c = (await sql`select id, title, date, for_member, for_member2 from cards where id = ${body.cardId} and circle_id = ${circle.id}`)[0];
    if (!c) return bad('That card is not here', 404);
    if (c.for_member !== me.id && c.for_member2 !== me.id) return bad('Only the person the card is for says thank you here', 403);
    if (sealedTo(c, me)) return bad('This card is a surprise until the day', 403);
    const writers = (await sql`select distinct e.member_id from card_entries e join members m on m.id = e.member_id
                               where e.card_id = ${c.id} and m.user_id is not null and not m.remembered and e.member_id <> ${me.id}`).map(r => r.member_id);
    if (!writers.length) return bad('Nobody has written in this card yet', 409);
    let audio = null, mime = null, secs = null;
    if (body.data) {
      mime = String(body.mime || '').split(';')[0];
      if (!VOICE_TYPES.includes(mime)) return bad('That recording type is not supported');
      audio = String(body.data || '');
      if (audio.length > VOICE_MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(audio)) return bad('A voice note can be up to ' + VOICE_MAX_SEC + ' seconds');
      secs = Math.max(1, Math.min(VOICE_MAX_SEC, parseInt(body.seconds, 10) || 1));
    }
    const got = await sql`insert into card_thanks (card_id, member_id, audio, mime, seconds) values (${c.id}, ${me.id}, ${audio}, ${mime}, ${secs})
                          on conflict (card_id, member_id) do nothing returning card_id`;
    if (!got[0]) return good({ already: true });
    await pushIds(sql, circle.id, writers, { title: '🙏 ' + first(me.name) + ' says thank you for the card',
      body: audio ? 'With a voice note. Open Parwah to hear it.' : 'Shukriya. It made the day.', url: '/#home' });
    return good({ told: writers.length }, 201);
  }
  if (a === 'bond_card_remove') {
    if (!isUuid(body.entryId)) return bad('Bad entry');
    const got = await sql`delete from card_entries e using cards c where e.id = ${body.entryId} and e.member_id = ${me.id}
                          and c.id = e.card_id and c.circle_id = ${circle.id} returning e.id`;
    if (!got[0]) return bad('You can take off only what you added', 403);
    return good({});
  }

  // ---- 2b. anniversaries: one date shared by a couple
  if (a === 'bond_anniv') {
    const p = await memberIn(sql, circle, body.personId);
    if (!p) return bad('That person is not in this ' + space, 403);
    if (!body.date) {
      await sql`update members set anniversary = null, anniv_with = null where circle_id = ${circle.id} and (id = ${p.id} or anniv_with = ${p.id})`;
      return good({ cleared: true });
    }
    const w = await memberIn(sql, circle, body.withId);
    if (!w) return bad('Pick who they are married to, from this ' + space, 403);
    if (w.id === p.id) return bad('Pick the other person in the couple');
    if (!dayOk(body.date) || body.date > todayFor(me)) return bad('Pick the wedding day, on or before today');
    // Anyone either of them was paired with before is unpaired first.
    await sql`update members set anniversary = null, anniv_with = null where circle_id = ${circle.id}
              and (anniv_with in (${p.id}, ${w.id}) or id in (${p.id}, ${w.id}))`;
    await sql`update members set anniversary = ${body.date}, anniv_with = ${w.id} where id = ${p.id}`;
    await sql`update members set anniversary = ${body.date}, anniv_with = ${p.id} where id = ${w.id}`;
    return good({});
  }

  // ---- 3. festivals
  // One festival at a time. Nobody replaces the whole family's list: a
  // member adds one or takes one off, and the feed says who changed what.
  if (a === 'bond_fest_add' || a === 'bond_fest_remove') {
    const f = festivalOf(body.key);
    if (!f) return bad('Pick a festival from the list');
    const add = a === 'bond_fest_add';
    const got = add
      ? await sql`insert into circle_festivals (circle_id, fkey) values (${circle.id}, ${f.key}) on conflict do nothing returning fkey`
      : await sql`delete from circle_festivals where circle_id = ${circle.id} and fkey = ${f.key} returning fkey`;
    // Only a real change is announced: a second tap says nothing twice.
    if (got[0]) await feed(sql, circle.id, me.id, festChangeLine(me.name, f.name, f.icon, add));
    const chosen = (await sql`select fkey from circle_festivals where circle_id = ${circle.id}`).map(r => r.fkey);
    return good({ chosen, changed: !!got[0] });
  }
  if (a === 'bond_fest_kit') {
    const f = festivalOf(body.key);
    if (!f || !f.dates.includes(body.date)) return bad('Pick a festival from the list');
    const chosen = await sql`select 1 from circle_festivals where circle_id = ${circle.id} and fkey = ${f.key}`;
    if (!chosen[0]) return bad('Your ' + space + ' has not picked ' + f.name + ' yet');
    const n = daysBetween(todayFor(me), body.date);
    if (n < 0 || n > KIT_DAYS) return bad(f.name + ' is not coming up yet');
    await sql`insert into festival_kits (circle_id, fkey, fdate) values (${circle.id}, ${f.key}, ${body.date}) on conflict do nothing`;
    const got = await sql`update festival_kits set kit_by = ${me.id}, kit_at = now()
                          where circle_id = ${circle.id} and fkey = ${f.key} and fdate = ${body.date} and kit_at is null returning fkey`;
    if (!got[0]) {
      const k = (await sql`select plan_id, card_id from festival_kits where circle_id = ${circle.id} and fkey = ${f.key} and fdate = ${body.date}`)[0];
      return good({ already: true, planId: k.plan_id, cardId: k.card_id });
    }
    const tz = validTz(body.tz) || placeOf(me.place, me.country, null).tz;
    const at = new Date(fromWall({ y: +body.date.slice(0, 4), m: +body.date.slice(5, 7), d: +body.date.slice(8, 10), h: 19, mi: 0 }, tz));
    const when = at > new Date() ? at : new Date(Date.now() + 3600000);
    const plan = await sql`insert into plans (circle_id, by_member, title, kind, at, room, going, festival)
                           values (${circle.id}, ${me.id}, ${f.name + ' together'}, 'function', ${when.toISOString()}, ${roomUrl()}, ${'{' + me.id + '}'}, ${f.key}) returning id`;
    await addItems(sql, circle, plan[0].id, me.id, ['Sweets', 'Plates and cups', 'Decorations', 'Music or a speaker']);
    const card = await sql`insert into cards (circle_id, occasion, title, date, by_member)
                           values (${circle.id}, 'festival', ${'Our ' + f.name + ' greeting'}, ${body.date}, ${me.id}) returning id`;
    await sql`update festival_kits set plan_id = ${plan[0].id}, card_id = ${card[0].id} where circle_id = ${circle.id} and fkey = ${f.key} and fdate = ${body.date}`;
    await feed(sql, circle.id, me.id, `${me.name} started: ${f.name} together ${f.icon}`);
    await pushCircle(sql, circle.id, { title: f.icon + ' ' + me.name + ' started: ' + f.name + ' together', body: 'Say you are in, pick what you bring, and add to the greeting', url: '/#fun' }, { except: me.id });
    return good({ planId: plan[0].id, cardId: card[0].id }, 201);
  }

  // ---- 5. I'm in town (groups only)
  if (a === 'bond_intown') {
    if (circle.kind !== 'group') return bad('"I\'m in town" is for groups. Families have Find my.', 400);
    const city = cleanText(body.city, 60);
    if (!city) return bad('Which city?');
    if (!dayOk(body.from) || !dayOk(body.to)) return bad('Pick the dates');
    const today = todayFor(me);
    if (body.to < today) return bad('Those dates have gone');
    if (body.to < body.from) return bad('The last day is before the first');
    if (daysBetween(body.from, body.to) > 60) return bad('Up to 60 days at a time');
    const r = await sql`insert into in_town (circle_id, member_id, city, from_date, to_date) values (${circle.id}, ${me.id}, ${city}, ${body.from}, ${body.to}) returning id`;
    await pushCircle(sql, circle.id, { title: '📍 ' + me.name + ' is in ' + city, body: 'From ' + body.from + ' to ' + body.to + '. Tap to meet up.', url: '/#home' }, { except: me.id });
    return good({ id: r[0].id }, 201);
  }
  if (a === 'bond_intown_end') {
    if (!isUuid(body.id)) return bad('Bad id');
    const got = await sql`delete from in_town where id = ${body.id} and circle_id = ${circle.id} and member_id = ${me.id} returning id`;
    if (!got[0]) return bad('Only the person who posted it can take it down', 403);
    return good({});
  }
  return bad('Unknown action');
}
