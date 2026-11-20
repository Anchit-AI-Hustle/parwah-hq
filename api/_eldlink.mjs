// A VOICE FOR THE FAMILY MEMBER WHO WILL NEVER INSTALL THE APP.
//
// Dadi has a basic smartphone and WhatsApp. Check-ins, cards, blessings,
// photos and votes all needed an account, so she had no voice. A family
// adult now makes one personal link for one person who is in the family by
// name only, and sends it THEMSELVES on WhatsApp (Parwah sends nothing: no
// SMS, no paid telephony). The link opens one page, site/public/apna/, with
// no sign-in.
//
// Behind /api/events?area=eldlink (no new function: the project is at its
// cap, and the SOS lives in that route).
//
//   The family, signed in (requireMember):
//   GET  ?area=eldlink&circle=CODE&member=ID   -> { adult, links, said }
//   POST {area:'eldlink', action}
//        eld_make {personId, contacts?}   an adult: make it, or make a fresh one
//        eld_renew {personId}             an adult: 90 more days
//        eld_off {personId}               an adult: turn it off
//        eld_contacts {personId, contacts}  the two people she can call
//        eld_audio {id}                   a voice note she sent me, or the family
//
//   The page, with no session at all. The key travels in the X-Parwah-Link
//   header, never in an address, so it is in no server log and no Referer.
//   POST {area:'eldlink', op}
//        open | consent | ok | card | audio | photo | say | bless | sawaal | vote
//        callme | sos | checkin | mine | forget | off
//
// THE RULES, all in the queries below:
//   - only the HASH of the key is stored; a copy of the table opens nothing;
//   - a key reaches one member of one family, and every read and write is
//     scoped by BOTH that member and that circle. An id sent by the page is
//     only ever looked up beside them;
//   - the page shows what was sent to HER or to the whole family: blessings,
//     thanks, cards, the newest photo of a whole-family album, the weekly
//     question, an open family poll. Never the chat, health, documents, the
//     register, costs or anyone's location (ELD_NEVER in _eldlinkrules.mjs);
//   - nobody remembered ever has a link, and a link stops the moment its
//     person is on Parwah or is marked as remembered;
//   - a child cannot make a link or turn one off (the one adult rule);
//   - a key that is wrong, old or turned off gets one plain answer, the same
//     for all three, that says nothing about any family.
import { createHash, randomBytes } from 'node:crypto';
import { db, ensureSchema, requireMember, isUuid, schemaOnce, rateLimit, clientIp } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { ensureAudienceSchema, audienceFor, pushAudience, minorOf } from './_audience.mjs';
import { memberCards } from './_standing.mjs';
import { checkVoice, ensureChatBond, votePoll } from './_chatbond.mjs';
import { ensureAshirwadSchema } from './_ashirwad.mjs';
import { ensureHeardSchema } from './_heard.mjs';
import { ensureFamilyCareSchema } from './_familycare.mjs';
import { albumGetBytes } from './_album.mjs';
import { noteRisk } from './_notesapi.mjs';
import { dayIn, validTz } from './_recur.mjs';
import { validHHMM } from './_carerules.mjs';
import { BLESS_LINES, blessLine } from './_consentrules.mjs';
import { questionFor, weekOfDay, SAWAAL_MAX } from './_heardrules.mjs';
import { ELD, ELD_LIMITS, tokenShape, expiryFrom, linkState, mayHaveLink, sayClean, contactsClean, linkPath, waDigits, inviteWords,
         linkLabel, madeLine, fineLine, callMeLine, offLine, CONSENT_SEES, SAY_WORDS, eldTables } from './_eldlinkrules.mjs';

const HOME_TZ = 'Asia/Kolkata';
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const hashOf = t => createHash('sha256').update(String(t)).digest('hex');
const newKey = () => randomBytes(ELD.tokenBytes).toString('base64url');
const lim = (sql, name, key) => rateLimit(sql, 'eld' + name, key, ELD_LIMITS[name][0], ELD_LIMITS[name][1], { failClosed: true });
// One sentence for every key that does not open a page: wrong, run out, or
// turned off. It names no family and no person.
const OFF_WORDS = 'This link is not on now. Ask your family to send you a new one.';

let ready = false;
export async function ensureEldSchema(sql) {
  if (ready) return;
  await ensureAudienceSchema(sql);
  await ensureChatBond(sql);
  await ensureAshirwadSchema(sql);
  await ensureHeardSchema(sql);
  await ensureFamilyCareSchema(sql);
  await schemaOnce(async () => {
    await eldTables(sql);
    // "from Dadi's link": the small label on what came through the page.
    await sql`alter table ashirwad add column if not exists via text`;
    await sql`alter table ashirwad_replies add column if not exists via text`;
    await sql`alter table sawaal_answers add column if not exists via text`;
    await sql`alter table poll_votes add column if not exists via text`;
  });
  ready = true;
}

// Is there a link that is on, and agreed to, for this person? Other modules
// ask this before sending something only a link could deliver.
export async function eldLinkOn(sql, circleId, memberId) {
  if (!isUuid(circleId) || !isUuid(memberId)) return false;
  try {
    await ensureEldSchema(sql);
    const r = await sql`select 1 as x from eld_links l join members m on m.id = l.member_id
                        where l.member_id = ${memberId} and l.circle_id = ${circleId} and m.circle_id = ${circleId}
                          and l.revoked_at is null and l.expires_at > now() and l.consent_at is not null
                          and m.user_id is null and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)`;
    return !!r[0];
  } catch (e) { return false; }
}

// The link closes when its person joins Parwah ("This is me"), is marked as
// remembered, or is turned off. Called from api/circle.mjs on a join.
export async function eldCloseFor(sql, circleId, memberId, how = 'joined') {
  try {
    await ensureEldSchema(sql);
    const r = await sql`update eld_links set revoked_at = now(), revoked_how = ${how}
                        where member_id = ${memberId} and circle_id = ${circleId} and revoked_at is null returning id, created_by`;
    if (!r[0]) return false;
    // A daily check-in that ran through the link has nowhere to be answered now.
    if (how !== 'joined') await sql`update members set checkin_by = null, checkin_ask = null, checkin_ask_by = null where id = ${memberId} and circle_id = ${circleId} and user_id is null`;
    return true;
  } catch (e) { return false; }
}

async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
}

// ================================================================ the family
async function linksFor(sql, circle, nowMs) {
  const rows = await sql`
    select l.member_id, m.name, l.created_at, l.expires_at, l.last_used_at, l.consent_at, l.contacts, l.revoked_at, b.name as by_name,
           to_jsonb(m)->>'checkin_by' as checkin_by
    from eld_links l join members m on m.id = l.member_id left join members b on b.id = l.created_by
    where l.circle_id = ${circle.id} and m.circle_id = ${circle.id} and l.revoked_at is null
      and m.user_id is null and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)
    order by l.created_at`;
  return rows.map(r => ({ memberId: r.member_id, name: r.name, state: linkState(r, nowMs), agreed: !!r.consent_at, lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at, since: r.created_at, byName: r.by_name, contacts: r.contacts || [], checkinBy: r.checkin_by || null, label: linkLabel(r.name) }));
}

// People an adult may give her to call: in this family, on Parwah, adult,
// with us, and whose number this adult can already see.
async function callable(sql, circle, me) {
  const ms = await sql`select m.id, m.name, m.phone from members m
                       where m.circle_id = ${circle.id} and m.user_id is not null and m.phone is not null
                         and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)
                         and not (case when m.dob is not null then m.dob > current_date - interval '18 years'
                                       else (coalesce((to_jsonb(m)->>'is_child')::boolean, false) or (to_jsonb(m)->>'adult_confirmed') = 'false') end)
                       order by m.created_at limit 40`;
  const seen = await memberCards(sql, circle, me, ms);
  return seen.filter(c => c && c.phone).map(c => ({ id: c.id, name: c.name }));
}

async function familyApi(sql, req, res) {
  const q = req.query || {}, b = req.body || {};
  const g = await requireMember(sql, req.method === 'GET' ? q.circle : b.code, req.method === 'GET' ? q.member : b.memberId, tokenOf(req));
  if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
  const circle = g.circle, me = g.me, nowMs = Date.now();
  const no = (status, error) => res.status(status).json({ ok: false, error });
  const adult = !(await minorOf(sql, circle.id, me.id));

  if (req.method === 'GET') {
    // What came through a link, for me or for the whole family.
    const said = await sql`
      select s.id, s.member_id, m.name, s.kind, s.body, (s.audio is not null) as has_audio, s.audio_secs, s.about_kind, s.created_at
      from eld_says s join members m on m.id = s.member_id
      where s.circle_id = ${circle.id} and m.circle_id = ${circle.id} and (s.to_member = ${me.id} or s.to_member is null)
        and s.created_at > now() - interval '14 days'
      order by s.created_at desc limit 20`;
    const declined = await sql`
      select distinct on (l.member_id) l.member_id, l.revoked_at from eld_links l
      where l.circle_id = ${circle.id} and l.revoked_how in ('self', 'declined')
        and not exists (select 1 from eld_links x where x.member_id = l.member_id and x.revoked_at is null)
      order by l.member_id, l.revoked_at desc`;
    return res.status(200).json({ ok: true, adult, days: ELD.days,
      links: await linksFor(sql, circle, nowMs),
      declined: declined.map(d => ({ memberId: d.member_id, at: d.revoked_at })),
      callable: adult ? await callable(sql, circle, me) : [],
      said: said.map(s => ({ id: s.id, memberId: s.member_id, name: s.name, kind: s.kind, text: s.kind === 'text' ? s.body : (SAY_WORDS[s.kind] || null),
        hasVoice: !!s.has_audio, secs: s.audio_secs || null, about: s.about_kind, at: s.created_at, label: linkLabel(s.name) })) });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return no(405, 'GET or POST only'); }
  const action = String(b.action || '');

  if (action === 'eld_audio') {
    if (!isUuid(b.id)) return no(404, 'That voice note is not here');
    const a = await sql`select audio, audio_secs from eld_says where id = ${b.id} and circle_id = ${circle.id} and audio is not null
                        and (to_member = ${me.id} or to_member is null)`;
    if (!a[0]) return no(404, 'That voice note is not here');
    return res.status(200).json({ ok: true, audio: a[0].audio, secs: a[0].audio_secs });
  }

  // Everything below changes who can reach the family from outside the app:
  // an adult does it. The one adult rule, read in SQL by minorOf.
  if (!['eld_make', 'eld_renew', 'eld_off', 'eld_contacts'].includes(action)) return no(400, 'Unknown link action');
  if (!adult) return no(403, 'An adult in the family does this.');
  if (!isUuid(b.personId)) return no(400, 'Choose who the link is for');
  const p = (await sql`select m.id, m.name, m.phone, m.user_id, coalesce((to_jsonb(m)->>'remembered')::boolean, false) as remembered
                       from members m where m.id = ${b.personId} and m.circle_id = ${circle.id}`)[0];
  const why = mayHaveLink(p);
  if (why) return no(p ? 400 : 404, why);
  const have = (await sql`select id, expires_at, revoked_at, contacts from eld_links where member_id = ${p.id} and circle_id = ${circle.id} and revoked_at is null`)[0] || null;

  const cleanContacts = async (ids) => {
    const ok = new Set((await callable(sql, circle, me)).map(c => c.id));
    return contactsClean(ids).filter(id => ok.has(id));
  };

  if (action === 'eld_make') {
    if (!(await lim(sql, 'create', me.id)) || !(await lim(sql, 'createFamily', circle.id))) return no(429, 'That is a lot of links for one day. Try again tomorrow.');
    const key = newKey(), until = expiryFrom(nowMs);
    let contacts = b.contacts === undefined ? null : await cleanContacts(b.contacts);
    if (have) {
      // A fresh key for the same link: the old one stops working at once.
      await sql`update eld_links set token_hash = ${hashOf(key)}, expires_at = ${until}, contacts = coalesce(${contacts}::uuid[], contacts)
                where id = ${have.id}`;
    } else {
      if (contacts === null) contacts = await cleanContacts([me.id]);
      const ever = await sql`select 1 as x from eld_links where member_id = ${p.id} limit 1`;
      const made = await sql`insert into eld_links (circle_id, member_id, token_hash, created_by, expires_at, contacts)
                             values (${circle.id}, ${p.id}, ${hashOf(key)}, ${me.id}, ${until}, ${contacts}::uuid[])
                             on conflict do nothing returning id`;
      if (!made[0]) return no(409, 'Someone else just made this link. Open the page again.');
      // The family is told once that the link exists.
      if (!ever[0]) await feed(sql, circle.id, me.id, '🔗 ' + madeLine(me.name, p.name));
    }
    const path = linkPath(key);
    return res.status(201).json({ ok: true, path, digits: waDigits(p.phone), fresh: !!have, expiresAt: until,
      // The words go with the address the adult's own phone is on; the
      // server never guesses a host.
      words: inviteWords(p.name, me.name, '') });
  }
  if (!have) return no(404, first(p.name) + ' has no link that is on.');
  if (action === 'eld_renew') {
    if (!(await lim(sql, 'create', me.id))) return no(429, 'Try again tomorrow.');
    const until = expiryFrom(nowMs);
    await sql`update eld_links set expires_at = ${until} where id = ${have.id}`;
    return res.status(200).json({ ok: true, expiresAt: until });
  }
  if (action === 'eld_contacts') {
    const contacts = await cleanContacts(b.contacts);
    await sql`update eld_links set contacts = ${contacts}::uuid[] where id = ${have.id}`;
    return res.status(200).json({ ok: true, contacts });
  }
  // eld_off
  await eldCloseFor(sql, circle.id, p.id, 'adult');
  await feed(sql, circle.id, me.id, '🔗 ' + first(me.name) + ' turned off ' + first(p.name) + '\'s link');
  return res.status(200).json({ ok: true });
}

// ================================================================ the page
// The key, from the header only. Returns the link with its person and its
// family, or null. Everything after this uses link.member_id AND
// link.circle_id, and nothing the page sends can change either.
async function linkOf(sql, req) {
  const h = (req && req.headers) || {};
  const key = h[ELD.header] || h['X-Parwah-Link'];
  if (!tokenShape(key)) return null;
  const r = await sql`
    select l.id, l.circle_id, l.member_id, l.created_by, l.consent_at, l.contacts, l.expires_at,
           m.name, m.place, m.country, m.phone_cc, to_jsonb(m)->>'checkin_by' as checkin_by, to_jsonb(m)->>'checkin_ask' as checkin_ask,
           (to_jsonb(m)->>'checkin_ask_by')::uuid as checkin_ask_by,
           c.code, c.name as circle_name, c.kind as circle_kind, b.name as by_name
    from eld_links l
    join members m on m.id = l.member_id and m.circle_id = l.circle_id
    join circles c on c.id = l.circle_id
    left join members b on b.id = l.created_by
    where l.token_hash = ${hashOf(key)} and l.revoked_at is null and l.expires_at > now()
      and m.user_id is null and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)`;
  return r[0] || null;
}

const todayOf = (b) => dayIn(validTz(b && b.tz) || HOME_TZ, Date.now());

// What the family sent HER. Each query names her and her circle; a feature
// the family never opened has no table, and that is simply nothing from it.
async function itemsFor(sql, L, today) {
  const cid = L.circle_id, her = L.member_id, out = [];
  const tryq = async f => { try { return await f(); } catch (e) { return []; } };
  const bless = await tryq(() => sql`
    select a.id, f.name as from_name, a.line, (a.audio is not null) as has_audio, a.audio_secs, a.created_at, a.to_member
    from ashirwad a join members f on f.id = a.from_member
    where a.circle_id = ${cid} and f.circle_id = ${cid} and a.kind = 'bless' and a.from_member <> ${her}
      and (a.to_member = ${her} or a.to_member is null)
      and a.created_at > now() - make_interval(days => ${ELD.itemDays})
      and not coalesce((to_jsonb(f)->>'remembered')::boolean, false)
    order by a.created_at desc limit ${ELD.itemsMax}`);
  bless.forEach(a => out.push({ kind: 'ashirwad', id: a.id, from: first(a.from_name), text: a.line, hasVoice: !!a.has_audio, secs: a.audio_secs || null, toAll: !a.to_member, at: a.created_at }));
  const thanks = await tryq(() => sql`
    select s.id, f.name as from_name, s.line, (s.audio is not null) as has_audio, s.audio_secs, s.created_at
    from shukriya s join members f on f.id = s.from_member
    where s.circle_id = ${cid} and f.circle_id = ${cid} and s.to_member = ${her}
      and s.created_at > now() - make_interval(days => ${ELD.itemDays})
    order by s.created_at desc limit ${ELD.itemsMax}`);
  thanks.forEach(s => out.push({ kind: 'shukriya', id: s.id, from: first(s.from_name), text: s.line, hasVoice: !!s.has_audio, secs: s.audio_secs || null, at: s.created_at }));
  // A card is a surprise until its day, and is never handed over empty.
  const cards = await tryq(() => sql`
    select c.id, c.title, c.date, c.created_at,
           (select count(*)::int from card_entries e where e.card_id = c.id) as n
    from cards c
    where c.circle_id = ${cid} and (c.for_member = ${her} or c.for_member2 = ${her})
      and c.date <= ${today}::date and c.date > ${today}::date - ${ELD.itemDays}::int
      and exists (select 1 from card_entries e where e.card_id = c.id)
    order by c.date desc limit 4`);
  cards.forEach(c => out.push({ kind: 'card', id: c.id, from: 'Family', text: c.title, count: c.n, at: c.date }));
  const done = await tryq(() => sql`select about_kind, about_id from eld_says where circle_id = ${cid} and member_id = ${her} and about_id is not null`);
  const answered = new Set(done.map(d => d.about_kind + ':' + d.about_id));
  out.forEach(o => { o.answered = answered.has(o.kind + ':' + o.id); });
  out.sort((a, b) => new Date(b.at) - new Date(a.at));
  return out.slice(0, ELD.itemsMax);
}

async function questionFor_(sql, L, today) {
  if (L.circle_kind === 'group') return null;
  const week = weekOfDay(today);
  let q = (await sql`select question from sawaal_weeks where circle_id = ${L.circle_id} and week = ${week}::date`)[0];
  if (!q) {
    const pick = questionFor(week, L.circle_id);
    await sql`insert into sawaal_weeks (circle_id, week, qno, question) values (${L.circle_id}, ${week}::date, ${pick.no}, ${pick.text})
              on conflict (circle_id, week) do nothing`;
    q = (await sql`select question from sawaal_weeks where circle_id = ${L.circle_id} and week = ${week}::date`)[0];
  }
  if (!q) return null;
  const mine = (await sql`select id from sawaal_answers where circle_id = ${L.circle_id} and week = ${week}::date and member_id = ${L.member_id}`)[0];
  return { week, text: q.question, answered: !!mine };
}

async function pollsFor(sql, L) {
  try {
    const rows = await sql`
      select p.id, p.question, p.options, p.multi, b.name as by_name,
             (select v.choices from poll_votes v where v.poll_id = p.id and v.member_id = ${L.member_id}) as mine
      from chat_polls p join chats c on c.id = p.chat_id left join members b on b.id = p.by_member
      where c.circle_id = ${L.circle_id} and c.kind = 'circle'
        and p.closed_at is null and (p.close_at is null or p.close_at > now())
        and p.created_at > now() - make_interval(days => ${ELD.pollDays})
      order by p.created_at desc limit 3`;
    return rows.map(p => ({ id: p.id, question: p.question, by: first(p.by_name), multi: !!p.multi,
      options: Array.isArray(p.options) ? p.options : JSON.parse(p.options || '[]'), mine: (p.mine || []).map(Number) }));
  } catch (e) { return []; }
}

// THE ONE PHOTO RULE FOR A LINK: an album whose audience is the WHOLE family.
// A link holder made no album and is nobody's "chosen" here, even if a
// family named her in one: a private or chosen album never reaches the page.
// With no id, the newest such photo; with an id, that photo or nothing.
async function familyPhoto(sql, circleId, photoId = null) {
  const r = await sql`
    select p.id, p.caption, p.created_at, b.name as by_name
    from album_photos p join album_albums a on a.id = p.album_id left join members b on b.id = p.by_member
    where p.circle_id = ${circleId} and a.circle_id = ${circleId} and a.audience = 'family'
      and (${photoId}::uuid is null or p.id = ${photoId}::uuid)
    order by p.created_at desc limit 1`;
  return r[0] || null;
}
// The picture itself, through the album's own reader (the only place the
// stored pictures are read), and only after the rule above has said yes.
async function familyPhotoData(sql, circleId, herId, photoId, size) {
  if (!(await familyPhoto(sql, circleId, photoId))) return null;
  const buf = await albumGetBytes(sql, circleId, herId, photoId, size === 'full' ? 'full' : 'thumb');
  return buf ? 'data:image/jpeg;base64,' + buf.toString('base64') : null;
}

// Who is on today's call rota for her, if the family keeps one.
async function rotaToday(sql, L) {
  try {
    const r = await sql`select q.claimed_by from requests q join members m on m.id = q.claimed_by
                        where q.circle_id = ${L.circle_id} and q.template = 'callrota' and q.about_member = ${L.member_id}
                          and q.status in ('open','assigned','claimed') and q.claimed_by is not null
                          and m.circle_id = ${L.circle_id} and m.user_id is not null
                          and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)
                        order by q.due_at limit 1`;
    return r[0] ? r[0].claimed_by : null;
  } catch (e) { return null; }
}

async function pageState(sql, L, body) {
  const today = todayOf(body), cid = L.circle_id, her = L.member_id;
  const me = { name: L.name, first: first(L.name) };
  if (!L.consent_at) {
    // Before she has said "All right" the page is told who set this up and
    // what the family can see, and nothing else.
    return { ok: true, agreed: false, me, setBy: first(L.by_name || 'Your family'), sees: CONSENT_SEES };
  }
  const okDone = !!(await sql`select 1 as x from eld_days where member_id = ${her} and day = ${today}::date and kind = 'ok'`)[0];
  const peopleIds = await audienceFor(sql, cid, 'ashirwad', {});
  const people = peopleIds.length ? await sql`select id, name from members where circle_id = ${cid} and id = any(${peopleIds}::uuid[]) order by created_at` : [];
  // The people she was given to call. Each one's own choice about who sees
  // their number is read again every time (memberCards), so a number its
  // owner has since kept to themself leaves the page too.
  const given = (L.contacts || []).length
    ? await sql`select m.id, m.name, m.phone from members m
                where m.circle_id = ${cid} and m.id = any(${L.contacts}::uuid[]) and m.phone is not null and m.user_id is not null
                  and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)`
    : [];
  const contacts = (await memberCards(sql, { id: cid, kind: L.circle_kind }, { id: her }, given)).filter(c => c && c.phone);
  let photo = null;
  try { const p = await familyPhoto(sql, cid); if (p) photo = { id: p.id, caption: p.caption || null, by: first(p.by_name), at: p.created_at }; } catch (e) { /* no album yet */ }
  const sosOpen = !!(await sql`select 1 as x from sos where circle_id = ${cid} and member_id = ${her} and status <> 'resolved' limit 1`.catch(() => []))[0];
  const askBy = L.checkin_ask && L.checkin_ask_by ? (await sql`select name from members where id = ${L.checkin_ask_by} and circle_id = ${cid}`)[0] : null;
  return { ok: true, agreed: true, me, setBy: first(L.by_name || 'Your family'), family: L.circle_name, expiresAt: L.expires_at,
    okToday: okDone, checkin: { by: validHHMM(L.checkin_by) || null, ask: L.checkin_ask ? { by: validHHMM(L.checkin_ask), from: first(askBy && askBy.name) } : null },
    items: await itemsFor(sql, L, today), photo,
    question: await questionFor_(sql, L, today), polls: await pollsFor(sql, L),
    people: people.map(p => ({ id: p.id, name: first(p.name) })),
    contacts: contacts.map(c => ({ id: c.id, name: first(c.name), phone: c.phone })),
    lines: BLESS_LINES, sosOpen, cancelSecs: ELD.sosCancelSecs };
}

// A response object that keeps what a shared handler wrote, so the page is
// sent only what it may have.
function capture() {
  const c = { code: 200, body: null, status(s) { c.code = s; return c; }, json(j) { c.body = j; return c; }, setHeader() { return c; }, end() { return c; } };
  return c;
}

async function pageApi(sql, req, res, hooks) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex');
  const b = req.body || {}, op = String(b.op || '');
  const no = (status, error, extra) => res.status(status).json({ ok: false, error, ...(extra || {}) });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return no(405, 'POST only'); }
  const L = await linkOf(sql, req);
  if (!L) {
    if (!(await lim(sql, 'wrong', clientIp(req)))) return no(429, 'Please wait a few minutes and open the link again.', { wait: true });
    return no(404, OFF_WORDS, { off: true });
  }
  if (!(await lim(sql, 'act', L.id))) return no(429, 'Please wait a little and try again.', { wait: true });
  await sql`update eld_links set last_used_at = now() where id = ${L.id} and (last_used_at is null or last_used_at < now() - interval '1 minute')`;
  const cid = L.circle_id, her = L.member_id;
  const herRow = { id: her, name: L.name, user_id: null, place: L.place, country: L.country, phone_cc: L.phone_cc };
  const circle = { id: cid, code: L.code, name: L.circle_name, kind: L.circle_kind };
  const today = todayOf(b);
  const good = (extra, status = 200) => res.status(status).json({ ok: true, ...(extra || {}) });
  const tellMaker = async (title, body) => { if (L.created_by) await pushCircle(sql, cid, { kind: 'care', title, body, url: '/#people' }, { only: L.created_by }); };

  if (op === 'open') return res.status(200).json(await pageState(sql, L, b));

  // ---- the first screen: all right, or I do not want this
  if (op === 'consent') {
    if (b.yes === true) {
      await sql`update eld_links set consent_at = coalesce(consent_at, now()) where id = ${L.id}`;
      return res.status(200).json(await pageState(sql, { ...L, consent_at: L.consent_at || new Date() }, b));
    }
    await eldCloseFor(sql, cid, her, 'declined');
    await tellMaker('🔗 ' + first(L.name) + ' does not want the link', offLine(L.name, 'declined'));
    return good({ off: true });
  }
  if (op === 'off') {
    await eldCloseFor(sql, cid, her, 'self');
    await tellMaker('🔗 ' + first(L.name) + ' turned off their link', offLine(L.name, 'self'));
    return good({ off: true });
  }
  // Nothing else happens until she has agreed.
  if (!L.consent_at) return no(403, 'Please read the first page and tap All right.', { consent: true });

  // ---- "I am fine": once a day, and the family is told
  if (op === 'ok') {
    const claim = await sql`insert into eld_days (member_id, day, kind) values (${her}, ${today}::date, 'ok') on conflict do nothing returning day`;
    if (!claim[0]) return good({ already: true });
    // The same row an app check-in makes, so it counts as today's sign of
    // life in the family's daily check-in (okToday in api/_familycare.mjs).
    await sql`insert into events (circle_id, member_id, type, text) values (${cid}, ${her}, 'checkin', ${linkLabel(L.name)})`;
    // With a daily check-in set, the check-in stays quiet as it does for
    // everyone. With none, the family hears that she said she is fine.
    if (!validHHMM(L.checkin_by)) {
      await pushCircle(sql, cid, { kind: 'care', title: '✅ ' + fineLine(L.name), body: 'Sent ' + linkLabel(L.name) + '.', url: '/#home' }, {});
    }
    return good({ told: true }, 201);
  }

  // ---- a daily check-in the family asked for: her own yes or no
  if (op === 'checkin') {
    if (b.stop === true) {
      await sql`update members set checkin_by = null, checkin_ask = null, checkin_ask_by = null where id = ${her} and circle_id = ${cid}`;
      await feed(sql, cid, her, first(L.name) + ' turned off the daily check-in');
      return good({});
    }
    const ask = validHHMM(L.checkin_ask);
    if (!ask) return no(404, 'Nothing is waiting for your answer');
    if (b.yes === true) {
      // It starts tomorrow: nobody is told today about a check-in that was not on.
      await sql`update members set checkin_by = ${ask}, tz = ${validTz(b.tz) || HOME_TZ}, checkin_ask = null, checkin_ask_by = null,
                  quiet_nudged_for = ${today}::date, quiet_alerted_for = ${today}::date
                where id = ${her} and circle_id = ${cid}`;
      await feed(sql, cid, her, '🕚 ' + first(L.name) + ' said yes to the daily check-in: by ' + ask + ' each day (' + linkLabel(L.name) + ')');
      if (L.checkin_ask_by) await pushCircle(sql, cid, { kind: 'care', title: '🕚 ' + first(L.name) + ' said yes to the daily check-in', body: 'By ' + ask + ' each day, from their link.', url: '/#home' }, { only: L.checkin_ask_by });
      return good({ by: ask });
    }
    await sql`update members set checkin_ask = null, checkin_ask_by = null where id = ${her} and circle_id = ${cid}`;
    if (L.checkin_ask_by) await pushCircle(sql, cid, { kind: 'care', title: first(L.name) + ' said not now to the daily check-in', body: 'Nothing has been turned on.', url: '/#home' }, { only: L.checkin_ask_by });
    return good({ declined: true });
  }

  // ---- reading one thing that was sent to her
  if (op === 'card') {
    if (!isUuid(b.id)) return no(404, 'That card is not here');
    const c = (await sql`select c.id, c.title, c.date from cards c
                         where c.id = ${b.id} and c.circle_id = ${cid} and (c.for_member = ${her} or c.for_member2 = ${her})
                           and c.date <= ${today}::date`.catch(() => []))[0];
    if (!c) return no(404, 'That card is not here');
    const entries = await sql`select e.id, m.name, e.kind, e.text, e.seconds, case when e.kind = 'photo' then e.data else null end as data
                              from card_entries e join members m on m.id = e.member_id
                              where e.card_id = ${c.id} and m.circle_id = ${cid} order by e.created_at limit 40`;
    if (!entries.length) return no(404, 'That card is not here');
    return good({ card: { id: c.id, title: c.title }, entries: entries.map(e => ({ id: e.id, from: first(e.name), kind: e.kind, text: e.text, secs: e.seconds || null, data: e.data })) });
  }
  if (op === 'audio') {
    if (!isUuid(b.id) || !(await lim(sql, 'audio', L.id))) return no(404, 'That voice note is not here');
    let r = null;
    if (b.kind === 'ashirwad') {
      r = (await sql`select a.audio from ashirwad a where a.id = ${b.id} and a.circle_id = ${cid} and a.kind = 'bless' and a.audio is not null
                     and a.from_member <> ${her} and (a.to_member = ${her} or a.to_member is null)`)[0];
    } else if (b.kind === 'shukriya') {
      r = (await sql`select s.audio from shukriya s where s.id = ${b.id} and s.circle_id = ${cid} and s.to_member = ${her} and s.audio is not null`)[0];
    } else if (b.kind === 'cardentry') {
      r = (await sql`select 'data:' || e.mime || ';base64,' || e.data as audio from card_entries e join cards c on c.id = e.card_id
                     where e.id = ${b.id} and e.kind = 'voice' and c.circle_id = ${cid} and (c.for_member = ${her} or c.for_member2 = ${her})
                       and c.date <= ${today}::date`.catch(() => []))[0];
    } else if (b.kind === 'mine') {
      r = (await sql`select s.audio from eld_says s where s.id = ${b.id} and s.circle_id = ${cid} and s.member_id = ${her} and s.audio is not null`)[0];
    }
    if (!r || !r.audio) return no(404, 'That voice note is not here');
    return good({ audio: r.audio });
  }
  if (op === 'photo') {
    if (!isUuid(b.id)) return no(404, 'That photo is not here');
    let data = null;
    try { data = await familyPhotoData(sql, cid, her, b.id, b.size); } catch (e) { /* no album yet */ }
    if (!data) return no(404, 'That photo is not here');
    return good({ data });
  }

  // ---- answering back: a heart, a blessing, a few words, a voice note
  if (op === 'say') {
    const c = sayClean(b);
    if (c.error) return no(400, c.error);
    if (!isUuid(c.about.id)) return no(404, 'That is not here any more');
    // The thing answered must be one SHE was sent. Its sender is who hears.
    let to = null, found = false;
    if (c.about.kind === 'ashirwad') {
      const a = (await sql`select a.from_member from ashirwad a where a.id = ${c.about.id} and a.circle_id = ${cid} and a.kind = 'bless'
                           and a.from_member <> ${her} and (a.to_member = ${her} or a.to_member is null)`)[0];
      if (a) { found = true; to = a.from_member; }
    } else if (c.about.kind === 'shukriya') {
      const s = (await sql`select s.from_member from shukriya s where s.id = ${c.about.id} and s.circle_id = ${cid} and s.to_member = ${her}`)[0];
      if (s) { found = true; to = s.from_member; }
    } else if (c.about.kind === 'card') {
      const k = (await sql`select c.id from cards c where c.id = ${c.about.id} and c.circle_id = ${cid} and (c.for_member = ${her} or c.for_member2 = ${her})
                           and c.date <= ${today}::date`.catch(() => []))[0];
      if (k) found = true;                    // a card has many writers: the family hears
    } else if (c.about.kind === 'photo') {
      let p = null; try { p = await familyPhoto(sql, cid, c.about.id); } catch (e) { /* no album yet */ }
      if (p) found = true;                    // a whole-family photo: the family hears
    }
    if (!found) return no(404, 'That is not here any more');
    let voice = null;
    if (c.kind === 'voice') {
      voice = checkVoice(b.voice, b.secs);
      if (voice.err) return no(400, voice.err);
    }
    if (c.text) { const risk = noteRisk(c.text); if (risk) return no(400, risk); }
    // One heart is one heart: a second tap on the same thing changes nothing.
    if (c.kind === 'heart' || c.kind === 'pranam') {
      const had = (await sql`select id from eld_says where circle_id = ${cid} and member_id = ${her} and about_kind = ${c.about.kind}
                             and about_id = ${c.about.id} and kind = ${c.kind} limit 1`)[0];
      if (had) return good({ id: had.id, already: true });
    }
    if (!(await lim(sql, 'say', L.id))) return no(429, 'That is a lot for one day. More tomorrow.', { wait: true });
    const r = await sql`insert into eld_says (circle_id, member_id, to_member, about_kind, about_id, kind, body, audio, audio_secs)
                        values (${cid}, ${her}, ${to}, ${c.about.kind}, ${c.about.id}, ${c.kind}, ${c.text}, ${voice ? voice.uri : null}, ${voice ? voice.secs : null})
                        returning id`;
    // A blessing answered here also shows where the sender already looks.
    if (c.about.kind === 'ashirwad') {
      await sql`insert into ashirwad_replies (ashirwad_id, member_id, kind, line, audio, audio_secs, via)
                values (${c.about.id}, ${her}, ${c.kind === 'voice' ? 'voice' : 'pranam'}, ${c.kind === 'voice' ? null : (c.text || SAY_WORDS[c.kind] || SAY_WORDS.heart)},
                        ${voice ? voice.uri : null}, ${voice ? voice.secs : null}, 'link')
                on conflict (ashirwad_id, member_id) do nothing`;
    }
    const words = c.kind === 'voice' ? 'A voice note for you. Tap to listen.' : c.kind === 'text' ? c.text.slice(0, 120) : SAY_WORDS[c.kind];
    await pushCircle(sql, cid, { kind: 'chat', title: '🧡 ' + first(L.name) + ' answered, ' + linkLabel(L.name), body: words, url: '/#home' }, to ? { only: to } : {});
    return good({ id: r[0].id }, 201);
  }

  // ---- Ashirwad: to one person or to everyone, by one tap or by voice
  if (op === 'bless') {
    const toAll = b.to === 'all';
    let to = null;
    if (!toAll) {
      if (!isUuid(b.to)) return no(400, 'Choose who it is for');
      const okTo = await audienceFor(sql, cid, 'ashirwad', { only: b.to });
      if (!okTo[0]) return no(400, 'Choose someone in the family');
      to = okTo[0];
    }
    let line = null, voice = null;
    if (b.voice) { voice = checkVoice(b.voice, b.secs); if (voice.err) return no(400, voice.err); }
    else { line = blessLine(b.line); if (!line) return no(400, 'Choose a blessing, or record one'); }
    if (!(await lim(sql, 'bless', L.id))) return no(429, 'That is a lot of love for one hour. Send the next one a little later.', { wait: true });
    const r = await sql`insert into ashirwad (circle_id, from_member, to_member, kind, line, audio, audio_secs, via)
                        values (${cid}, ${her}, ${to}, 'bless', ${line}, ${voice ? voice.uri : null}, ${voice ? voice.secs : null}, 'link') returning id`;
    await pushAudience(sql, cid, 'ashirwad', { kind: 'chat', title: '🙏 Ashirwad from ' + first(L.name),
      body: (voice ? 'A voice note for you. Tap to listen.' : line) + ' (' + linkLabel(L.name) + ')', url: '/#home' }, toAll ? {} : { only: to });
    return good({ id: r[0].id }, 201);
  }

  // ---- the family's weekly question, by voice or in a few words
  if (op === 'sawaal') {
    const q = await questionFor_(sql, L, today);
    if (!q) return no(404, 'No question this week');
    const text = String(b.text == null ? '' : b.text).replace(/\s+/g, ' ').trim().slice(0, SAWAAL_MAX);
    if (text) { const risk = noteRisk(text); if (risk) return no(400, risk); }
    let voice = null;
    if (b.voice) { voice = checkVoice(b.voice, b.secs); if (voice.err) return no(400, voice.err); }
    if (!text && !voice) return no(400, 'Say it or write it first');
    if (!(await lim(sql, 'say', L.id))) return no(429, 'That is a lot for one day. More tomorrow.', { wait: true });
    // Her own answer: member_id is her, and nobody "recorded" it for her.
    await sql`insert into sawaal_answers (circle_id, week, member_id, by_member, answer_text, audio, audio_secs, via)
              values (${cid}, ${q.week}::date, ${her}, null, ${text || null}, ${voice ? voice.uri : null}, ${voice ? voice.secs : null}, 'link')
              on conflict (circle_id, week, member_id) do update set answer_text = excluded.answer_text, by_member = null, via = 'link',
                audio = excluded.audio, audio_secs = excluded.audio_secs, created_at = now()`;
    return good({}, 201);
  }

  // ---- an open family poll: HER vote, not one given for her
  if (op === 'vote') {
    if (!isUuid(b.pollId)) return no(404, 'That poll is not here');
    const p = (await sql`select p.id, p.chat_id from chat_polls p join chats c on c.id = p.chat_id
                         where p.id = ${b.pollId} and c.circle_id = ${cid} and c.kind = 'circle'`)[0];
    if (!p) return no(404, 'That poll is not here');
    if (!(await lim(sql, 'vote', L.id))) return no(429, 'Please wait a little and try again.', { wait: true });
    const out = await votePoll(sql, { id: p.chat_id, kind: 'circle' }, { id: her }, { pollId: p.id, choices: b.choices });
    if (out.status === 200) await sql`update poll_votes set via = 'link', by_member = null where poll_id = ${p.id} and member_id = ${her}`;
    return res.status(out.status).json(out.json);
  }

  // ---- "Call me": one push, to the person she chose or today's caller
  if (op === 'callme') {
    let to = null;
    if (b.to) {
      if (!isUuid(b.to)) return no(400, 'Choose someone in the family');
      const okTo = await audienceFor(sql, cid, 'ashirwad', { only: b.to });
      if (!okTo[0]) return no(400, 'Choose someone in the family');
      to = okTo[0];
    } else {
      to = await rotaToday(sql, L);
    }
    if (!(await lim(sql, 'callmeGap', L.id)) || !(await lim(sql, 'callme', L.id))) {
      return no(429, 'They have been told already. Please give them a little time.', { wait: true, told: true });
    }
    const toName = to ? ((await sql`select name from members where id = ${to} and circle_id = ${cid}`)[0] || {}).name : null;
    await feed(sql, cid, her, '📞 ' + callMeLine(L.name) + (toName ? ' from ' + first(toName) : '') + ' (' + linkLabel(L.name) + ')');
    await pushCircle(sql, cid, { kind: 'care', title: '📞 ' + callMeLine(L.name), body: (to ? 'They asked for you.' : 'Whoever is free, please ring.') + ' Sent ' + linkLabel(L.name) + '.', url: '/#home' },
      to ? { only: to } : {});
    return good({ to: toName ? first(toName) : null }, 201);
  }

  // ---- "I need help": the family's own SOS, raised as her
  if (op === 'sos') {
    // Where she is goes only when she tapped "send where I am".
    const pos = b.share === true ? { lat: b.lat, lng: b.lng, accuracy: b.accuracy } : {};
    const cap = capture();
    await hooks.raiseSos(sql, cap, circle, herRow, '', { ...pos, tz: validTz(b.tz) || HOME_TZ });
    const j = cap.body || {};
    if (!j.ok) return no(cap.code >= 400 ? cap.code : 500, 'Please call 112 now.');
    // The family's numbers that the SOS route hands an app are NOT passed
    // on: the page has only the two people she was given to call.
    return good({ again: !!j.again, located: !!j.located, throttled: !!j.throttled }, 201);
  }

  // ---- what she sent, and taking any of it back
  if (op === 'mine') {
    const says = await sql`select s.id, s.kind, s.body, (s.audio is not null) as has_audio, s.about_kind, s.created_at, t.name as to_name
                           from eld_says s left join members t on t.id = s.to_member
                           where s.circle_id = ${cid} and s.member_id = ${her} order by s.created_at desc limit 30`;
    const bless = await sql`select a.id, a.line, (a.audio is not null) as has_audio, a.created_at, t.name as to_name
                            from ashirwad a left join members t on t.id = a.to_member
                            where a.circle_id = ${cid} and a.from_member = ${her} order by a.created_at desc limit 30`;
    const ans = await sql`select a.id, a.answer_text, (a.audio is not null) as has_audio, a.created_at
                          from sawaal_answers a where a.circle_id = ${cid} and a.member_id = ${her} and a.via = 'link' order by a.created_at desc limit 10`;
    const list = []
      .concat(says.map(s => ({ kind: 'say', id: s.id, text: s.kind === 'text' ? s.body : s.kind === 'voice' ? null : SAY_WORDS[s.kind], hasVoice: !!s.has_audio, to: s.to_name ? first(s.to_name) : null, at: s.created_at })))
      .concat(bless.map(a => ({ kind: 'ashirwad', id: a.id, text: a.line, hasVoice: !!a.has_audio, to: a.to_name ? first(a.to_name) : null, at: a.created_at })))
      .concat(ans.map(a => ({ kind: 'sawaal', id: a.id, text: a.answer_text, hasVoice: !!a.has_audio, to: null, at: a.created_at })));
    list.sort((x, y) => new Date(y.at) - new Date(x.at));
    return good({ list, checkinBy: validHHMM(L.checkin_by) || null });
  }
  if (op === 'forget') {
    if (!isUuid(b.id)) return no(404, 'That is not here any more');
    let gone = [];
    if (b.kind === 'say') {
      gone = await sql`delete from eld_says where id = ${b.id} and circle_id = ${cid} and member_id = ${her} returning about_kind, about_id`;
      if (gone[0] && gone[0].about_kind === 'ashirwad' && gone[0].about_id) {
        await sql`delete from ashirwad_replies where ashirwad_id = ${gone[0].about_id} and member_id = ${her} and via = 'link'`;
      }
    } else if (b.kind === 'ashirwad') {
      gone = await sql`delete from ashirwad where id = ${b.id} and circle_id = ${cid} and from_member = ${her} returning id`;
    } else if (b.kind === 'sawaal') {
      gone = await sql`delete from sawaal_answers where id = ${b.id} and circle_id = ${cid} and member_id = ${her} and via = 'link' returning id`;
    }
    if (!gone[0]) return no(404, 'That is not here any more');
    return good({});
  }
  return no(400, 'Unknown action');
}

// ================================================================ the route
// hooks.raiseSos is the family's own SOS (api/events.mjs), handed in so this
// module never copies it.
export async function eldlinkApi(req, res, hooks = {}) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureEldSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const h = (req && req.headers) || {};
    const paged = h[ELD.header] !== undefined || h['X-Parwah-Link'] !== undefined || (req.body && typeof req.body.op === 'string');
    if (paged) return await pageApi(sql, req, res, hooks);
    return await familyApi(sql, req, res);
  } catch (e) { return fail(res, e); }
}
