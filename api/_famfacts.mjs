// FAMILY FACTS: a small page about the family as a whole. The gotra, the
// native village or town, the kuldevta or kuldevi and where they are, the
// mother tongue, the story of the surname, and the customs worth writing
// down. Behind /api/circle, by actions that start fact_.
//
//   POST {code, memberId, action:'fact_list'}
//   POST {..., action:'fact_add',    kind, text, audience?, chosen?: [memberId]}
//   POST {..., action:'fact_edit',   id, text, audience?, chosen?}
//   POST {..., action:'fact_remove', id}
//
// WHO SEES A FACT is said by the query, never only by the screen: the whole
// family (the default), the people the writer chose, or only the writer.
// Anyone in the family can add. The writer, or an elder (role parent) who
// can read it, can change the words or remove it; who sees it stays the
// writer's choice. No card number, CVV, OTP or banking PIN is kept (the
// notes rule). These facts never cross a family link: nothing outside this
// file reads the table.
import { schemaOnce, isUuid } from './_db.mjs';
import { noteRisk } from './_notesapi.mjs';

export const FACT_KINDS = [
  ['gotra', 'Gotra', 80],
  ['native', 'Native village or town', 120],
  ['kuldevta', 'Kuldevta or kuldevi', 120],
  ['deity_place', "Family deity's place", 160],
  ['tongue', 'Mother tongue', 80],
  ['surname', 'Our surname story', 600],
  ['custom', 'A custom worth writing down', 600],
];
export const FACT_AUDIENCES = ['family', 'chosen', 'me'];
export const FACT_CUSTOMS_MAX = 20;
export const FACT_CHOSEN_MAX = 40;
const kindOf = k => FACT_KINDS.find(x => x[0] === k) || null;

let ready = false;
export async function ensureFamfactsSchema(sql) {
  if (ready) return;
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  await schemaOnce(() => famfactsTables(sql));
  ready = true;
}
async function famfactsTables(sql) {
  await sql`create table if not exists family_facts (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    kind text not null check (kind in ('gotra', 'native', 'kuldevta', 'deity_place', 'tongue', 'surname', 'custom')),
    text text not null,
    audience text not null default 'family' check (audience in ('family', 'chosen', 'me')),
    chosen uuid[] not null default '{}',
    updated_by uuid references members(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`create index if not exists family_facts_circle on family_facts (circle_id, created_at)`;
  // One answer per person for the facts a family has one of. Customs are many.
  await sql`create unique index if not exists family_facts_one on family_facts (circle_id, kind, by_member) where kind <> 'custom'`;
}

const bad = (error, status = 400, extra) => ({ status, json: { ok: false, error, ...(extra || {}) } });
const good = (json, status = 200) => ({ status, json: { ok: true, ...(json || {}) } });
const clip = v => String(v == null ? '' : v).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();

// The audience, checked: { audience, chosen } or { error }.
async function audienceOf(sql, circle, me, body) {
  const audience = body.audience === undefined || body.audience === null || body.audience === '' ? 'family'
    : FACT_AUDIENCES.includes(body.audience) ? body.audience : null;
  if (!audience) return { error: 'Pick who can see it.' };
  if (audience !== 'chosen') return { audience, chosen: [] };
  const ids = [...new Set(Array.isArray(body.chosen) ? body.chosen : [])];
  if (!ids.length) return { error: 'Pick at least one person.' };
  if (ids.length > FACT_CHOSEN_MAX || !ids.every(isUuid)) return { error: 'Pick people from this family.' };
  const rows = await sql`select id from members where circle_id = ${circle.id} and id = any(${ids}::uuid[]) and id <> ${me.id}`;
  if (rows.length !== ids.length) return { error: 'Pick people from this family.' };
  return { audience, chosen: ids };
}

// The audience rule, in the query: mine, or for the whole family, or for
// the people chosen and I am one of them.
async function listFor(sql, circle, me) {
  const rows = await sql`
    select f.id, f.kind, f.text, f.audience, f.by_member, b.name as by_name, f.created_at, f.updated_at,
           case when f.by_member = ${me.id} then f.chosen else '{}'::uuid[] end as chosen
    from family_facts f left join members b on b.id = f.by_member
    where f.circle_id = ${circle.id}
      and (f.by_member = ${me.id} or f.audience = 'family' or (f.audience = 'chosen' and ${me.id}::uuid = any(f.chosen)))
    order by f.created_at, f.id`;
  const elder = me.role === 'parent';
  return rows.map(r => ({ id: r.id, kind: r.kind, text: r.text, audience: r.audience, chosen: r.chosen || [],
                          by_member: r.by_member, by_name: r.by_name, mine: r.by_member === me.id,
                          canEdit: r.by_member === me.id || elder, updated_at: r.updated_at }));
}

// me: the caller's own membership (ownedMember proved it). circle: {id, kind}.
export async function famfactsAction(sql, circle, me, body) {
  await ensureFamfactsSchema(sql);
  const a = String(body.action || '');
  if (circle.kind === 'group') return bad('Family facts are for a family, not a group of friends.');

  if (a === 'fact_list') {
    return good({ facts: await listFor(sql, circle, me),
                  kinds: FACT_KINDS.map(k => ({ key: k[0], label: k[1], max: k[2] })), customsMax: FACT_CUSTOMS_MAX });
  }

  if (a === 'fact_add') {
    const k = kindOf(body.kind);
    if (!k) return bad('Pick what kind of fact it is.', 400, { field: 'kind' });
    const text = clip(body.text);
    if (!text) return bad('Write it down first.', 400, { field: 'text' });
    if (text.length > k[2]) return bad('Keep it to ' + k[2] + ' letters.', 400, { field: 'text' });
    const risk = noteRisk(text);
    if (risk) return bad(risk, 400, { field: 'text' });
    const aud = await audienceOf(sql, circle, me, body);
    if (aud.error) return bad(aud.error, 400, { field: 'audience' });
    if (k[0] === 'custom') {
      const n = await sql`select count(*)::int as n from family_facts where circle_id = ${circle.id} and kind = 'custom'`;
      if (n[0].n >= FACT_CUSTOMS_MAX) return bad('This family has ' + FACT_CUSTOMS_MAX + ' customs written down. Remove one to add another.', 409);
    }
    const r = await sql`insert into family_facts (circle_id, by_member, kind, text, audience, chosen, updated_by)
                        values (${circle.id}, ${me.id}, ${k[0]}, ${text}, ${aud.audience}, ${aud.chosen}::uuid[], ${me.id})
                        on conflict do nothing returning id`;
    if (!r[0]) return bad('You have written this one already. Change it instead.', 409);
    // The feed is read by everyone, so it hears only of what everyone can read.
    if (aud.audience === 'family') {
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' wrote down a family fact: ' + k[1].toLowerCase()})`;
    }
    return good({ id: r[0].id }, 201);
  }

  if (a === 'fact_edit' || a === 'fact_remove') {
    const gone = () => bad('That fact is not here any more', 404);
    if (!isUuid(body.id)) return gone();
    // A fact this person cannot read is "not here": it is never confirmed.
    const cur = (await sql`select id, kind, by_member from family_facts f where f.id = ${body.id} and f.circle_id = ${circle.id}
                             and (f.by_member = ${me.id} or f.audience = 'family' or (f.audience = 'chosen' and ${me.id}::uuid = any(f.chosen)))`)[0];
    if (!cur) return gone();
    const elder = me.role === 'parent';
    if (a === 'fact_remove') {
      const r = await sql`
        delete from family_facts f
        where f.id = ${cur.id} and f.circle_id = ${circle.id}
          and (f.by_member = ${me.id}
               or (${elder}::boolean and (f.audience = 'family' or (f.audience = 'chosen' and ${me.id}::uuid = any(f.chosen)))))
        returning f.id`;
      if (!r[0]) return bad('Only the person who wrote it, or an elder of the family, can remove it.', 403);
      return good({});
    }
    const k = kindOf(cur.kind);
    const text = clip(body.text);
    if (!text) return bad('Write it down first.', 400, { field: 'text' });
    if (text.length > k[2]) return bad('Keep it to ' + k[2] + ' letters.', 400, { field: 'text' });
    const risk = noteRisk(text);
    if (risk) return bad(risk, 400, { field: 'text' });
    // Who sees it stays the writer's choice: only they can change it.
    let aud = null;
    if (cur.by_member === me.id && body.audience !== undefined) {
      aud = await audienceOf(sql, circle, me, body);
      if (aud.error) return bad(aud.error, 400, { field: 'audience' });
    }
    const r = await sql`
      update family_facts f set text = ${text}, updated_by = ${me.id}, updated_at = now(),
             audience = case when ${!!aud}::boolean then ${aud ? aud.audience : 'family'} else f.audience end,
             chosen = case when ${!!aud}::boolean then ${aud ? aud.chosen : []}::uuid[] else f.chosen end
      where f.id = ${cur.id} and f.circle_id = ${circle.id}
        and (f.by_member = ${me.id}
             or (${elder}::boolean and (f.audience = 'family' or (f.audience = 'chosen' and ${me.id}::uuid = any(f.chosen)))))
      returning f.id`;
    if (!r[0]) return bad('Only the person who wrote it, or an elder of the family, can change it.', 403);
    return good({});
  }
  return bad('Unknown action');
}
