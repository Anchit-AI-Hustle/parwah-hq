// THE EMERGENCY CARD: whose card a member may open, and the two people the
// card says to call. Behind /api/book?area=ecard (no new function).
//
// The card itself (blood group, allergies, the medicines the family already
// keeps) is drawn on the phone from Health & contacts, printed with the
// phone's own Print, and kept on the phone so it opens with no signal. What
// lives here is the part that needs a rule:
//
//   - A person's card is shown to that person, and to the adults THEY chose.
//   - While that person has an SOS open, the adults of the family can open
//     it: that is what the card is for.
//   - Someone who is not on Parwah cannot choose, so the adults of the
//     family keep their card.
//   - A child or a teenager opens only their own. Nobody opens the card of
//     someone marked as no longer with us.
//   - The person chooses up to two family members as emergency contacts.
//     Never a remembered person: they are refused when chosen and left out
//     when read.
// The rule is one query (mayOpen); the pure form of it is ecardMayOpen in
// api/_consentrules.mjs, which the unit test checks.
//
// The card is a record the family keeps, not medical advice: the legal line
// travels with every answer and is printed on the card.
//
//   GET  ?area=ecard&circle=CODE&member=ID[&person=ID]
//        -> { mayOpen: [ids], card?: { personId, mine, contacts, viewers?, candidates? }, legal }
//   POST {action:'ecard_set', viewers: [ids], contacts: [ids]}   the person themself only
import { db, ensureSchema, requireMember, isUuid, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { ensureAudienceSchema, audienceFor } from './_audience.mjs';
import { memberCards } from './_standing.mjs';
import { ECARD_LEGAL, ECARD_CONTACTS_MAX, ECARD_VIEWERS_MAX, firstName } from './_consentrules.mjs';

let ready = false;
export async function ensureEcardSchema(sql) {
  if (ready) return;
  await ensureAudienceSchema(sql);
  await schemaOnce(async () => {
    await sql`create table if not exists ecard_prefs (
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      viewers uuid[] not null default '{}',
      contacts uuid[] not null default '{}',
      updated_at timestamptz not null default now(),
      primary key (circle_id, member_id)
    )`;
  });
  ready = true;
}

// People with an SOS open now. A family that never raised one has no table.
export async function openSos(sql, circleId) {
  try { return (await sql`select distinct member_id from sos where circle_id = ${circleId} and status <> 'resolved'`).map(r => r.member_id); }
  catch (e) { return []; }
}
// Whose cards this member may open, decided in one query. The Family book
// applies the same rule, in its own query, to the health entries a card
// shows (api/book.mjs), so the lock is not only on the screen.
export async function mayOpen(sql, circleId, meId) {
  await ensureEcardSchema(sql);
  const sos = await openSos(sql, circleId);
  const rows = await sql`
    select p.id from members p
    join members v on v.id = ${meId} and v.circle_id = p.circle_id
    left join ecard_prefs e on e.circle_id = p.circle_id and e.member_id = p.id
    where p.circle_id = ${circleId} and not p.remembered
      and (p.id = v.id
           or (not (case when v.dob is not null then v.dob > current_date - interval '18 years' else (v.is_child or v.adult_confirmed is false) end)
               and (p.user_id is null or v.id = any(coalesce(e.viewers, '{}')) or p.id = any(${sos}::uuid[]))))`;
  return rows.map(r => r.id);
}

export default async function ecardApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureEcardSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, b = req.body || {};
    const g = await requireMember(sql, req.method === 'GET' ? q.circle : b.code, req.method === 'GET' ? q.member : b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;

    if (req.method === 'GET') {
      const open = await mayOpen(sql, circle.id, me.id);
      if (q.person === undefined) return res.status(200).json({ ok: true, mayOpen: open, legal: ECARD_LEGAL });
      const gone = { ok: false, error: 'That card is not here' };
      if (!isUuid(q.person)) return res.status(404).json(gone);
      const p = (await sql`select id, name, remembered from members where id = ${q.person} and circle_id = ${circle.id}`)[0];
      if (!p || p.remembered) return res.status(404).json(gone);
      if (open.indexOf(p.id) < 0) {
        return res.status(403).json({ ok: false, locked: true, mayOpen: open, legal: ECARD_LEGAL,
          error: firstName(p.name) + ' has not chosen you to see this card. Ask ' + firstName(p.name) + ' to add you from their own card.' });
      }
      const mine = p.id === me.id;
      const prefs = (await sql`select viewers, contacts from ecard_prefs where circle_id = ${circle.id} and member_id = ${p.id}`)[0] || { viewers: [], contacts: [] };
      // The two people to call: family members who are with us.
      const contacts = (prefs.contacts || []).length ? await sql`
        select m.id, m.name, m.phone, m.relation from members m
        where m.circle_id = ${circle.id} and m.id = any(${prefs.contacts}::uuid[]) and not m.remembered
        order by array_position(${prefs.contacts}::uuid[], m.id)` : [];
      // Each number as its owner lets this viewer see it on a member card.
      // The person put them on the card to be called, so the viewer is told
      // when a number is kept back and can ask the person for it.
      const shown = new Map((await memberCards(sql, circle, me, contacts.map(c => ({ id: c.id, phone: c.phone })))).map(c => [c.id, c.phone]));
      const card = { personId: p.id, name: p.name, mine, contacts: contacts.map(c => ({ id: c.id, name: c.name, phone: shown.get(c.id) || null,
        phoneKept: !!c.phone && !shown.get(c.id), relation: c.relation || null })) };
      if (mine) {
        // Only the person sees and changes who they chose.
        const adults = await audienceFor(sql, circle.id, 'emergency_items', { except: me.id });
        const fam = await sql`select id, name, phone from members where circle_id = ${circle.id} and id <> ${me.id} and not remembered order by created_at`;
        card.viewers = (prefs.viewers || []).filter(id => adults.indexOf(id) >= 0);
        card.candidates = fam.map(m => ({ id: m.id, name: m.name, hasPhone: !!m.phone, adultOnApp: adults.indexOf(m.id) >= 0 }));
      }
      return res.status(200).json({ ok: true, mayOpen: open, card, legal: ECARD_LEGAL });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }

    if (b.action === 'ecard_set') {
      const ids = (v) => [...new Set((Array.isArray(v) ? v : []).filter(isUuid))].filter(id => id !== me.id);
      const wantV = ids(b.viewers), wantC = ids(b.contacts);
      if (wantV.length > ECARD_VIEWERS_MAX) return res.status(400).json({ ok: false, error: 'Choose up to ' + ECARD_VIEWERS_MAX + ' people' });
      if (wantC.length > ECARD_CONTACTS_MAX) return res.status(400).json({ ok: false, error: 'Choose up to two people to call' });
      // Who may see it: adults of this family, on Parwah, who are with us.
      const viewers = wantV.length ? await audienceFor(sql, circle.id, 'emergency_items', { only: wantV }) : [];
      if (viewers.length !== wantV.length) return res.status(400).json({ ok: false, error: 'Only adults in the family who are on Parwah can be chosen to see your card' });
      // Who to call: anyone in this family who is with us.
      const okC = wantC.length ? (await sql`select id from members where circle_id = ${circle.id} and id = any(${wantC}::uuid[]) and not remembered`).map(r => r.id) : [];
      if (okC.length !== wantC.length) return res.status(400).json({ ok: false, error: 'Choose people in this family to call' });
      const contacts = wantC.filter(id => okC.indexOf(id) >= 0);
      await sql`insert into ecard_prefs (circle_id, member_id, viewers, contacts, updated_at)
                values (${circle.id}, ${me.id}, ${viewers}::uuid[], ${contacts}::uuid[], now())
                on conflict (circle_id, member_id) do update set viewers = excluded.viewers, contacts = excluded.contacts, updated_at = now()`;
      return res.status(200).json({ ok: true, viewers, contacts });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) { return fail(res, e); }
}
