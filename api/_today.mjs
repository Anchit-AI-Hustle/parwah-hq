// TODAY, FOR EACH PERSON. Behind /api/chats?area=today (no new function:
// the project is at its cap). One read fills "From the family" at the top
// of Today and the card for each parent a far-away adult looks after.
//
//   GET /api/chats?area=today&circle=&member=
//     -> { me: { minor, senior, joinedAt }, kind,
//          items: [ what is waiting for this person, in one order ],
//          unread: { chats, messages },
//          parents: [ one card for each person the family looks after ] }
//
// NOTHING HERE WIDENS WHAT A MEMBER MAY SEE. Every part is read through the
// module that owns it, by that module's own rule:
//   - messages: only the chats api/chats.mjs lists for this member (the
//     family chat, and the chats they are in), never a muted one;
//   - a private word: api/_baat.mjs (the two of them, nobody else);
//   - an Ashirwad or "How is your day?": api/_ashirwad.mjs (sent to me, or
//     to everyone);
//   - a shukriya: api/_heard.mjs, and only one written FOR me;
//   - a plan and a date poll: the whole family sees these (api/plans.mjs,
//     api/_bond.mjs); a plan made for named people only reaches them;
//   - a chat poll: only in a chat this member is in;
//   - a card: never one sealed to the person it is for (api/_bond.mjs);
//   - someone asking to join: adults only, by the one adult rule
//     (api/_standing.mjs). A child or a teenager is never sent one;
//   - medicines on a parent's card: api/_doses.mjs, so a private medicine
//     stays private; the phone number: the member's own choice
//     (api/_standing.mjs).
// Someone marked as remembered is never listed, counted or offered a call.
import { db, ensureSchema, requireMember, isUuid } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { validTz, dayIn } from './_recur.mjs';
import { ensureChatBond } from './_chatbond.mjs';
import { listChats } from './chats.mjs';
import { baatList } from './_baat.mjs';
import { ashirwadInbox } from './_ashirwad.mjs';
import { ensureHeardSchema, shukriyaList } from './_heard.mjs';
import { ensureBondSchema, sealedTo } from './_bond.mjs';
import { minorOf } from './_audience.mjs';
import { standingOfCaller, memberCards } from './_standing.mjs';
import { okToday, ensureFamilyCareSchema } from './_familycare.mjs';
import { doseState, ensureDoseSchema } from './_doses.mjs';
import { ensureTogetherSchema } from './_together.mjs';
import { fromFamily, firstWords, lookedAfter } from './_todayrules.mjs';

const HOME_TZ = 'Asia/Kolkata';
const THANKS_DAYS = 3;       // a thank-you waits on Today for three days
const CARD_DAYS = 14;        // a card to write in, when its day is this near
// A part whose feature the family never opened has no table yet: that is
// simply nothing waiting from it, never an error on Today.
const soft = async (fn, empty) => { try { return await fn(); } catch (e) { return empty; } };
const preview = m => m.kind === 'image' ? 'A photo' : m.kind === 'audio' ? 'A voice note' : m.kind === 'poll' ? 'A poll: ' + firstWords(m.text, 60) : firstWords(m.text, 80);

// ------------------------------------------------------- unread messages
// One row per chat that has something new for this member: who wrote last,
// the first words, and how many. "New" is after they last opened the chat,
// and never from before they joined the family.
async function unreadChats(sql, me, all) {
  const chats = all.filter(c => !c.muted);
  if (!chats.length) return [];
  const ids = chats.map(c => c.id);
  const rows = await sql`
    select m.chat_id, m.id, m.kind, m.text, m.created_at, mem.name
    from messages m join members mem on mem.id = m.member_id
    where m.chat_id = any(${ids}::uuid[]) and m.member_id <> ${me.id}
      and not coalesce((to_jsonb(mem)->>'remembered')::boolean, false)
      and m.created_at > greatest(
            coalesce((select r.read_at from chat_reads r where r.chat_id = m.chat_id and r.member_id = ${me.id}), 'epoch'::timestamptz),
            (select x.created_at from members x where x.id = ${me.id}))
    order by m.created_at desc limit 200`;
  const out = [];
  for (const c of chats) {
    const mine = rows.filter(r => r.chat_id === c.id);
    if (!mine.length) continue;
    const last = mine[0];
    out.push({ kind: 'message', chatId: c.id, chatKind: c.kind, chatName: c.kind === 'circle' ? null : c.name,
      fromName: last.name, text: preview(last), voice: last.kind === 'audio', n: mine.length, at: last.created_at });
  }
  return out;
}

// --------------------------------------------------- polls not voted in
async function openPolls(sql, circle, me, ids) {
  const chat = ids.length ? await sql`
    select p.id, p.chat_id, p.message_id, p.question, p.created_at, b.name as by_name
    from chat_polls p left join members b on b.id = p.by_member
    where p.chat_id = any(${ids}::uuid[]) and p.closed_at is null and (p.close_at is null or p.close_at > now())
      and p.created_at > now() - interval '14 days'
      and (p.by_member is null or p.by_member <> ${me.id})
      and not exists (select 1 from poll_votes v where v.poll_id = p.id and v.member_id = ${me.id})
    order by p.created_at desc limit 5` : [];
  const dates = await soft(() => sql`
    select p.id, p.title, p.created_at, b.name as by_name
    from plan_polls p left join members b on b.id = p.by_member
    where p.circle_id = ${circle.id} and p.status = 'open'
      and not exists (select 1 from plan_options o join plan_votes v on v.option_id = o.id
                      where o.poll_id = p.id and v.member_id = ${me.id})
    order by p.created_at desc limit 5`, []);
  return chat.map(p => ({ kind: 'poll', poll: 'chat', id: p.id, chatId: p.chat_id, messageId: p.message_id, text: firstWords(p.question, 80), fromName: p.by_name || null, at: p.created_at }))
    .concat(dates.map(p => ({ kind: 'poll', poll: 'date', id: p.id, text: firstWords(p.title, 80), fromName: p.by_name || null, at: p.created_at })));
}

// ------------------------------------------- plans awaiting my answer
async function plansToAnswer(sql, circle, me) {
  const rows = await sql`
    select p.id, p.title, p.kind, p.at, p.place, p.created_at, b.name as by_name
    from plans p left join members b on b.id = p.by_member
    where p.circle_id = ${circle.id} and p.at > now() and p.at < now() + interval '60 days'
      and (p.by_member is null or p.by_member <> ${me.id})
      and not (${me.id}::uuid = any(coalesce(p.going, '{}'::uuid[])))
      and not (${me.id}::uuid = any(coalesce(p.maybe, '{}'::uuid[])))
      and not (${me.id}::uuid = any(coalesce(p.cannot, '{}'::uuid[])))
      and (coalesce(cardinality(p.invited), 0) = 0 or ${me.id}::uuid = any(p.invited))
    order by p.at asc limit 5`;
  return rows.map(p => ({ kind: 'plan', id: p.id, text: p.title, planKind: p.kind, when: p.at, place: p.place, fromName: p.by_name || null, at: p.created_at }));
}

// ------------------------------------------ a card I have not written in
async function cardsToWrite(sql, circle, me) {
  const rows = await sql`
    select c.id, c.occasion, c.title, c.date, c.for_member, c.for_member2, c.for_name, c.created_at,
           (select count(*)::int from card_entries e where e.card_id = c.id and e.member_id = ${me.id}) as mine
    from cards c where c.circle_id = ${circle.id} and c.delivered_at is null
      and c.date >= current_date and c.date <= current_date + ${CARD_DAYS}::int
    order by c.date asc limit 20`;
  return rows.filter(c => !c.mine && !sealedTo(c, me) && c.for_member !== me.id && c.for_member2 !== me.id).slice(0, 3)
    .map(c => ({ kind: 'card', id: c.id, text: c.title, occasion: c.occasion, surprise: !!c.for_member, at: c.created_at }));
}

// ---------------------------------------------- a card for each parent
// The people this family looks after (their own senior switch). For each:
// whether they have been seen to be alright today, today's medicines as the
// viewer may see them, the last thing they wrote where the viewer can read
// it, and their number if they let the viewer see it.
async function parentCards(sql, circle, me, nowMs, chatIds) {
  const ms = await sql`select m.id, m.name, m.role, m.phone, m.user_id, to_jsonb(m)->>'tz' as tz,
                              coalesce((to_jsonb(m)->>'remembered')::boolean, false) as remembered,
                              (case when m.dob is not null then m.dob > current_date - interval '18 years'
                                    else (coalesce((to_jsonb(m)->>'is_child')::boolean, false) or (to_jsonb(m)->>'adult_confirmed')::boolean is false) end) as minor
                       from members m where m.circle_id = ${circle.id} order by m.created_at`;
  const who = lookedAfter(ms, me.id).slice(0, 6);
  if (!who.length) return [];
  const phones = new Map((await memberCards(sql, circle, me, who.map(m => ({ id: m.id, phone: m.phone })))).map(c => [c.id, c.phone || null]));
  const doses = await soft(async () => { await ensureDoseSchema(sql); return (await doseState(sql, circle, me, null)).doses; }, []);
  const last = chatIds.length ? await sql`
    select distinct on (m.member_id) m.member_id, m.chat_id, m.kind, m.text, m.created_at
    from messages m
    where m.chat_id = any(${chatIds}::uuid[]) and m.member_id = any(${who.map(m => m.id)}::uuid[]) and m.text not like '🆘%'
    order by m.member_id, m.created_at desc` : [];
  // Whose own link is on (agreed to, not turned off, not run out).
  const linked = new Set((await soft(() => sql`
    select distinct l.member_id from eld_links l
    where l.circle_id = ${circle.id} and l.member_id = any(${who.map(m => m.id)}::uuid[])
      and l.revoked_at is null and l.expires_at > now() and l.consent_at is not null`, [])).map(r => r.member_id));
  const out = [];
  for (const m of who) {
    const tz = validTz(m.tz) || HOME_TZ, today = dayIn(tz, nowMs);
    // Someone with no app can still say "I am fine" from their own link
    // (api/_eldlink.mjs), so everyone looked after is asked, not only
    // the people on Parwah.
    const okAt = await soft(() => okToday(sql, m.id, today, tz), null);
    const mine = doses.filter(d => d.person_id === m.id && d.today);
    const lm = last.find(x => x.member_id === m.id) || null;
    out.push({ id: m.id, name: m.name, onApp: !!m.user_id, link: !m.user_id && linked.has(m.id), phone: phones.get(m.id) || null,
      ok: okAt ? { at: okAt } : null,
      meds: mine.length ? { total: mine.length, taken: mine.filter(d => d.status === 'taken').length,
                            skipped: mine.filter(d => d.status === 'skipped').length, late: mine.filter(d => d.passed).length } : null,
      last: lm ? { text: preview(lm), at: lm.created_at, chatId: lm.chat_id } : null });
  }
  return out;
}

export async function todayState(sql, circle, me, nowMs = Date.now()) {
  await ensureChatBond(sql);
  const minor = await minorOf(sql, circle.id, me.id);
  const mrow = (await sql`select role, created_at from members where id = ${me.id}`)[0] || {};
  const chats = await listChats(sql, circle, me);
  const chatIds = chats.map(c => c.id);
  const items = [];

  // Someone at the door: an adult answers it, so only an adult is told.
  const adult = !minor && (await soft(async () => (await standingOfCaller(sql, circle, me.id, nowMs)).may, false));
  if (adult) {
    const reqs = await sql`select id, name, relation, created_at from join_requests
                           where circle_id = ${circle.id} and status = 'pending' order by created_at limit 5`;
    for (const r of reqs) items.push({ kind: 'join', id: r.id, fromName: r.name, relation: r.relation || null, at: r.created_at });
  }
  // A private word waiting for MY answer.
  for (const b of await soft(() => baatList(sql, circle, me), [])) {
    if (b.mine || b.reply) continue;
    items.push({ kind: 'word', id: b.id, fromId: b.fromId, fromName: b.fromName, text: b.line ? firstWords(b.line, 80) : b.en, title: b.title, emoji: b.emoji, voice: !!b.hasAudio, at: b.at });
  }
  for (const m of await unreadChats(sql, me, chats)) items.push(m);
  // An Ashirwad, or "How is your day?", not answered yet.
  for (const a of await soft(() => ashirwadInbox(sql, circle, me), [])) {
    items.push({ kind: a.kind === 'howday' ? 'day' : 'blessing', id: a.id, fromId: a.fromId, fromName: a.fromName, text: a.line ? firstWords(a.line, 80) : null, voice: !!a.hasVoice, toAll: !!a.toAll, at: a.at });
  }
  // A thank-you written for me, for three days.
  const since = nowMs - THANKS_DAYS * 86400000;
  for (const s of await soft(async () => { await ensureHeardSchema(sql); return shukriyaList(sql, circle, me, 20); }, [])) {
    if (!s.forMe || new Date(s.at).getTime() < since) continue;
    items.push({ kind: 'thanks', id: s.id, fromId: s.fromId, fromName: s.fromName, text: s.line ? firstWords(s.line, 80) : null, voice: !!s.hasAudio, at: s.at });
  }
  // The answer columns are made by api/_together.mjs: they are ensured
  // here, so a plan waiting for an answer is never lost to a quiet error.
  // (No plans table at all means nobody here has ever made a plan.)
  if ((await sql`select to_regclass('plans') is not null as x`)[0].x) {
    await ensureTogetherSchema(sql);
    for (const p of await plansToAnswer(sql, circle, me)) items.push(p);
  }
  for (const p of await soft(() => openPolls(sql, circle, me, chatIds), [])) items.push(p);
  for (const c of await soft(async () => { await ensureBondSchema(sql); return cardsToWrite(sql, circle, me); }, [])) items.push(c);

  const unreadRows = items.filter(x => x.kind === 'message');
  const senior = mrow.role === 'parent';
  return { ok: true, kind: circle.kind || 'family',
    me: { id: me.id, minor, senior, joinedAt: mrow.created_at || null },
    items: fromFamily(items, { minor }),
    unread: { chats: unreadRows.length, messages: unreadRows.reduce((n, x) => n + x.n, 0) },
    // A card per parent is for a grown-up looking after them from elsewhere:
    // never for a child, and not on the calm screen of the parent themself.
    parents: (!minor && !senior && (circle.kind || 'family') !== 'group')
      ? await soft(async () => { await ensureFamilyCareSchema(sql); return parentCards(sql, circle, me, nowMs, chatIds); }, []) : [] };
}

export default async function todayApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false, error: 'GET only' }); }
    const q = req.query || {};
    if (!isUuid(q.member)) return res.status(400).json({ ok: false, error: 'Bad member' });
    const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    return res.status(200).json(await todayState(sql, g.circle, g.me));
  } catch (e) { return fail(res, e); }
}
