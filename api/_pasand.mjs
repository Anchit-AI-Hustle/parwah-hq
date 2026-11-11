// PASAND: what each person likes, where they watch and listen, and a
// recommendation from one person to another. Shared taste is an easy reason
// to talk: "you will love this" is a call waiting to happen.
//
//   GET  /api/games?area=pasand&circle=CODE&member=UUID
//        -> { ok, me: { audience, chosen, likes, platforms }, people, forMe, fromMe }
//   POST /api/games?area=pasand {code, memberId, action, ...}
//        like_add      {kind, text}
//        like_remove   {id}
//        audience_set  {audience: family|chosen|me, chosen?: [memberId]}
//        platform_set  {platform, on, link?}
//        rec_add       {title, kind, platform?, link?, note?, toAll?, to?: [memberId]}
//        rec_respond   {id, response: saved|loved|done|pass, reply?}
//        rec_remove    {id}
//
// WHO SEES WHAT is said by the queries, not by the screen. A person's likes
// and platforms go to the whole circle, to the members they chose, or to
// nobody but them. A recommendation is read only by whoever sent it and
// whoever it was sent to.
//
// NO ACCOUNT IS LINKED AND NO PASSWORD IS KEPT. The streaming services have
// no sign-in for other apps, so a person ticks what they have and may add
// one public https link. Anything that reads like a password or a sign-in
// is refused with a plain reason; nothing is trimmed away quietly.
import { db, ensureSchema, schemaOnce, requireMember, isUuid, rateLimit } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { noteRisk } from './_notesapi.mjs';
import { PASAND_MAX, PASAND_AUDIENCES, isLikeKind, isPlatform, isRecKind, isResponse,
         platformName, cleanText, cleanLink, credRisk } from './_pasandrules.mjs';

let ready = false;
export async function ensurePasandSchema(sql) {
  if (ready) return;
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  await schemaOnce(() => pasandTables(sql));
  ready = true;
}
async function pasandTables(sql) {
  await sql`create table if not exists pasand_prefs (
    member_id uuid primary key references members(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    audience text not null default 'family' check (audience in ('family', 'chosen', 'me')),
    chosen uuid[] not null default '{}',
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists pasand_likes (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    kind text not null,
    text text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create unique index if not exists pasand_likes_one on pasand_likes (member_id, kind, lower(text))`;
  await sql`create index if not exists pasand_likes_circle on pasand_likes (circle_id)`;
  await sql`create table if not exists pasand_platforms (
    member_id uuid not null references members(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    platform text not null,
    link text,
    created_at timestamptz not null default now(),
    primary key (member_id, platform)
  )`;
  await sql`create index if not exists pasand_platforms_circle on pasand_platforms (circle_id)`;
  await sql`create table if not exists pasand_recs (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    by_member uuid not null references members(id) on delete cascade,
    title text not null,
    kind text not null,
    platform text,
    link text,
    note text,
    to_all boolean not null default false,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists pasand_recs_circle on pasand_recs (circle_id, created_at desc)`;
  // One row per recipient, so one response per recipient: answering again
  // changes the row, it never adds a second.
  await sql`create table if not exists pasand_rec_to (
    rec_id uuid not null references pasand_recs(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    response text,
    reply text,
    responded_at timestamptz,
    primary key (rec_id, member_id)
  )`;
  await sql`create index if not exists pasand_rec_to_member on pasand_rec_to (member_id)`;
}

// A card number or a banking secret (the notes rule) or a password or a
// sign-in (the Pasand rule): the first reason found, or null.
export function pasandRisk(...vs) {
  for (const v of vs) { const bad = noteRisk(v) || credRisk(v); if (bad) return bad; }
  return null;
}

async function state(sql, circle, me) {
  const prefs = (await sql`select audience, chosen from pasand_prefs where member_id = ${me.id}`)[0] || { audience: 'family', chosen: [] };
  // The audience rule, in the query: mine, or shared with the whole circle,
  // or shared with members the owner chose and I am one of them.
  const likes = await sql`
    select l.id, l.member_id, l.kind, l.text
    from pasand_likes l left join pasand_prefs p on p.member_id = l.member_id
    where l.circle_id = ${circle.id}
      and (l.member_id = ${me.id} or coalesce(p.audience, 'family') = 'family'
           or (p.audience = 'chosen' and ${me.id}::uuid = any(p.chosen)))
    order by l.created_at, l.id`;
  const plats = await sql`
    select s.member_id, s.platform, s.link
    from pasand_platforms s left join pasand_prefs p on p.member_id = s.member_id
    where s.circle_id = ${circle.id}
      and (s.member_id = ${me.id} or coalesce(p.audience, 'family') = 'family'
           or (p.audience = 'chosen' and ${me.id}::uuid = any(p.chosen)))
    order by s.created_at, s.platform`;
  const names = await sql`select id, name, (user_id is not null) as on_app from members where circle_id = ${circle.id} order by name`;
  const people = [];
  for (const m of names) {
    if (m.id === me.id) continue;
    const ls = likes.filter(l => l.member_id === m.id).map(l => ({ id: l.id, kind: l.kind, text: l.text }));
    const ps = plats.filter(s => s.member_id === m.id).map(s => ({ platform: s.platform, link: s.link }));
    if (ls.length || ps.length) people.push({ memberId: m.id, name: m.name, onApp: m.on_app, likes: ls, platforms: ps });
  }
  // A recommendation is read by its sender and its recipients, nobody else.
  // "to" (who answered what) is built for the sender only.
  const recs = await sql`
    select r.id, r.title, r.kind, r.platform, r.link, r.note, r.to_all, r.created_at, r.by_member, b.name as by_name,
           (mine.member_id is not null) as for_me, mine.response, mine.reply,
           case when r.by_member = ${me.id} then (
             select coalesce(jsonb_agg(jsonb_build_object('member_id', t.member_id, 'name', m.name, 'response', t.response, 'reply', t.reply) order by m.name), '[]'::jsonb)
             from pasand_rec_to t join members m on m.id = t.member_id where t.rec_id = r.id) end as "to"
    from pasand_recs r
    left join members b on b.id = r.by_member
    left join pasand_rec_to mine on mine.rec_id = r.id and mine.member_id = ${me.id}
    where r.circle_id = ${circle.id}
      and (r.by_member = ${me.id} or exists (select 1 from pasand_rec_to t where t.rec_id = r.id and t.member_id = ${me.id}))
    order by r.created_at desc limit ${PASAND_MAX.list * 2}`;
  const shape = (r) => ({ id: r.id, title: r.title, kind: r.kind, platform: r.platform, link: r.link, note: r.note,
                          toAll: r.to_all, created_at: r.created_at, by_member: r.by_member, by_name: r.by_name });
  return {
    me: { audience: prefs.audience, chosen: prefs.chosen || [],
          likes: likes.filter(l => l.member_id === me.id).map(l => ({ id: l.id, kind: l.kind, text: l.text })),
          platforms: plats.filter(s => s.member_id === me.id).map(s => ({ platform: s.platform, link: s.link })) },
    people,
    forMe: recs.filter(r => r.for_me).slice(0, PASAND_MAX.list).map(r => ({ ...shape(r), response: r.response, reply: r.reply })),
    fromMe: recs.filter(r => r.by_member === me.id).slice(0, PASAND_MAX.list).map(r => ({ ...shape(r), to: r.to || [] }))
  };
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensurePasandSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const g = await requireMember(sql, code, memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;
    const bad = (error, status) => res.status(status || 400).json({ ok: false, error });
    const good = (extra, status) => res.status(status || 200).json({ ok: true, ...(extra || {}) });

    if (req.method === 'GET') return good(await state(sql, circle, me));
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return bad('GET or POST only', 405);
    }
    const action = body.action;

    // ---------------------------------------------------------- my likes
    if (action === 'like_add') {
      if (!isLikeKind(body.kind)) return bad('Pick what kind of thing it is.');
      const t = cleanText(body.text, PASAND_MAX.like, 'A like');
      if (t.error) return bad(t.error);
      if (!t.value) return bad('Write what you like first.');
      const risk = pasandRisk(t.value);
      if (risk) return bad(risk);
      const n = await sql`select count(*)::int as n from pasand_likes where member_id = ${me.id}`;
      if (n[0].n >= PASAND_MAX.likes) return bad('You have ' + PASAND_MAX.likes + ' likes. Remove one to add another.');
      const r = await sql`insert into pasand_likes (circle_id, member_id, kind, text) values (${circle.id}, ${me.id}, ${body.kind}, ${t.value})
                          on conflict do nothing returning id`;
      return good({ id: r[0] ? r[0].id : null, already: !r[0] }, r[0] ? 201 : 200);
    }
    if (action === 'like_remove') {
      if (!isUuid(body.id)) return bad('Bad like');
      const r = await sql`delete from pasand_likes where id = ${body.id} and member_id = ${me.id} and circle_id = ${circle.id} returning id`;
      if (!r[0]) return bad('That like is not here any more', 404);
      return good();
    }
    if (action === 'audience_set') {
      const audience = PASAND_AUDIENCES.includes(body.audience) ? body.audience : null;
      if (!audience) return bad('Pick who sees your likes.');
      let chosen = [];
      if (audience === 'chosen') {
        const ids = [...new Set(Array.isArray(body.chosen) ? body.chosen : [])];
        if (!ids.length) return bad('Pick at least one person.');
        if (ids.length > PASAND_MAX.chosen || !ids.every(isUuid)) return bad('Bad person');
        const rows = await sql`select id from members where circle_id = ${circle.id} and id = any(${ids}::uuid[]) and id <> ${me.id}`;
        if (rows.length !== ids.length) return bad('Pick people from this ' + (circle.kind === 'group' ? 'group' : 'family') + '.');
        chosen = ids;
      }
      await sql`insert into pasand_prefs (member_id, circle_id, audience, chosen) values (${me.id}, ${circle.id}, ${audience}, ${chosen}::uuid[])
                on conflict (member_id) do update set audience = excluded.audience, chosen = excluded.chosen, updated_at = now()`;
      return good({ audience, chosen });
    }

    // ---------------------------------------------------------- where I watch and listen
    if (action === 'platform_set') {
      if (!isPlatform(body.platform)) return bad('Pick one from the list.');
      if (!body.on) {
        await sql`delete from pasand_platforms where member_id = ${me.id} and platform = ${body.platform}`;
        return good();
      }
      const hasLink = body.link !== undefined;
      const link = cleanLink(body.link);
      if (link.error) return bad(link.error);
      const risk = pasandRisk(link.value);
      if (risk) return bad(risk);
      await sql`insert into pasand_platforms (member_id, circle_id, platform, link) values (${me.id}, ${circle.id}, ${body.platform}, ${link.value})
                on conflict (member_id, platform) do update set
                  link = case when ${hasLink}::boolean then excluded.link else pasand_platforms.link end`;
      return good();
    }

    // ---------------------------------------------------------- recommend to anyone
    if (action === 'rec_add') {
      const title = cleanText(body.title, PASAND_MAX.title, 'The name');
      if (title.error) return bad(title.error);
      if (!title.value) return bad('Write what you recommend, like Panchayat.');
      if (!isRecKind(body.kind)) return bad('Pick what kind of thing it is.');
      const platform = body.platform ? (isPlatform(body.platform) ? body.platform : false) : null;
      if (platform === false) return bad('Pick where it is from the list.');
      const link = cleanLink(body.link);
      if (link.error) return bad(link.error);
      const note = cleanText(body.note, PASAND_MAX.note, 'The note');
      if (note.error) return bad(note.error);
      const risk = pasandRisk(title.value, note.value, link.value);
      if (risk) return bad(risk);
      // Recipients: everyone else who is on Parwah, or the people chosen.
      const word = circle.kind === 'group' ? 'group' : 'family';
      const others = await sql`select id, name, user_id from members where circle_id = ${circle.id} and id <> ${me.id}`;
      let to;
      const toAll = !!body.toAll;
      if (toAll) {
        to = others.filter(m => m.user_id).map(m => m.id);
        if (!to.length) return bad('Nobody else in this ' + word + ' is on Parwah yet.');
      } else {
        const ids = [...new Set(Array.isArray(body.to) ? body.to : [])];
        if (!ids.length) return bad('Pick who it is for.');
        if (ids.length > PASAND_MAX.chosen || !ids.every(isUuid)) return bad('Bad person');
        for (const id of ids) {
          const m = others.find(x => x.id === id);
          if (!m) return bad('Pick people from this ' + word + '.');
          if (!m.user_id) return bad(m.name + ' is not on Parwah yet, so they would not see it.');
        }
        to = ids;
      }
      if (!(await rateLimit(sql, 'pasand_rec', me.id, PASAND_MAX.perHour, 3600))) {
        return bad('That is a lot of recommendations in one hour. Try again later.', 429);
      }
      const r = await sql`insert into pasand_recs (circle_id, by_member, title, kind, platform, link, note, to_all)
                          values (${circle.id}, ${me.id}, ${title.value}, ${body.kind}, ${platform}, ${link.value}, ${note.value || null}, ${toAll})
                          returning id`;
      await sql`insert into pasand_rec_to (rec_id, member_id) select ${r[0].id}, unnest(${to}::uuid[])`;
      const on = platform && platform !== 'other' ? platformName(platform) : '';
      const payload = { title: '💛 ' + me.name + ' recommends ' + title.value, body: (on ? 'On ' + on + '. ' : '') + 'Open Parwah to say what you think.', url: '/#home' };
      // Only the people it is for are told, one by one.
      for (const id of to) await pushCircle(sql, circle.id, payload, { only: id });
      return good({ id: r[0].id, to: to.length }, 201);
    }
    if (action === 'rec_respond') {
      if (!isUuid(body.id)) return bad('Bad recommendation');
      if (!isResponse(body.response)) return bad('Pick one answer.');
      const reply = cleanText(body.reply, PASAND_MAX.reply, 'The reply');
      if (reply.error) return bad(reply.error);
      const risk = pasandRisk(reply.value);
      if (risk) return bad(risk);
      // Only a recipient has a row to change, and only their own.
      const r = await sql`update pasand_rec_to t set response = ${body.response}, reply = ${reply.value || null}, responded_at = now()
                          from pasand_recs r
                          where t.rec_id = r.id and r.id = ${body.id} and r.circle_id = ${circle.id} and t.member_id = ${me.id}
                          returning t.rec_id`;
      if (!r[0]) return bad('That recommendation is not here any more', 404);
      return good();
    }
    if (action === 'rec_remove') {
      if (!isUuid(body.id)) return bad('Bad recommendation');
      const r = await sql`delete from pasand_recs where id = ${body.id} and circle_id = ${circle.id} and by_member = ${me.id} returning id`;
      if (!r[0]) return bad('That recommendation is not here any more', 404);
      return good();
    }
    return bad('Unknown action');
  } catch (e) {
    return fail(res, e);
  }
}
