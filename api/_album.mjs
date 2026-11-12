// YAADON KI ALBUM: the family's own photos, in albums the whole family adds
// to. No storage account: a photo is kept in the database, the way the vault
// keeps a document, and is handed back only to someone the album is for.
//
//   GET  /api/book?area=album&circle=CODE&member=UUID
//        [&album=UUID] [&person=UUID] [&limit=N]
//        -> { ok, albums, photos, members, count, cap, near, left, line, max }
//   GET  /api/book?area=album&view=photo&id=UUID&size=thumb|full
//        -> the JPEG itself (never JSON), Cache-Control: private
//   GET  /api/book?area=album&view=today
//        -> { ok, pick } one older photo a week, or null
//   POST /api/book?area=album {code, memberId, action, ...}
//        photo_add     {albumId, photos: [{photo, thumb}], caption?, year?, people?: [memberId]}
//        photo_edit    {id, caption?, year?, people?: [memberId]}
//        photo_remove  {id}
//        untag         {id}            the caller takes their own name off
//        album_save    {id?, name, date?, year?, audience, chosen?: [memberId]}
//        album_remove  {id}
//        today_hide    {}              not this week
//        photo_react   {id, emoji|null}  one reaction per person per photo, no push
//        photo_voice   {id, audio, mime, secs}   a voice caption, from whoever added the photo
//        photo_voice_remove {id}
//   GET  /api/book?area=album&view=voice&id=UUID -> { audio }  for someone the album is for
//
// WHO SEES WHAT is said by the queries, not by the screen. An album is for
// the whole circle, for the people its maker chose, or for its maker alone,
// and every query that reads a photo (its details or its bytes) carries
// that rule. A photo in a private album cannot be fetched by its id.
//
// WHERE THE BYTES LIVE. Only two functions touch the picture bytes:
// albumPutBytes and albumGetBytes, below. Today they read and write the
// album_bytes table. A later move to file storage (Cloudflare R2, Vercel
// Blob) changes those two functions and nothing else; the count of photos
// per circle is already exposed (count, cap) for that day.
//
// NOTHING LEAVES THE CIRCLE BY ITSELF. There is no public link and no
// download of everything. One photo at a time can be saved to the phone of
// someone who is already allowed to see it, or passed on by that person
// through their own phone's share sheet: their own act, one photo, never a
// link back into the album.
//
// NEW PHOTOS, QUIETLY. A family is pushed about new photos in a family
// album at most once a day, however many are added.
import { db, ensureSchema, schemaOnce, requireMember, isUuid, rateLimit, spaceWord } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { noteRisk } from './_notesapi.mjs';
import { reqTz, validTz } from './_recur.mjs';
import { dayOf, ensureBondSchema } from './_memorybond.mjs';
import { pushCircle } from './_push.mjs';
import { audioCheck } from './_memorybond.mjs';
import { ALBUM_REACTIONS, ALBUM_PUSH_PER_DAY } from './_heardrules.mjs';
import { ALBUM_MAX, ALBUM_AUDIENCES, imageError, jpegInfo, cleanB64, cleanLine, cleanYear, cleanDate,
         lockedOut, capLine, capError, albumAlt, isoWeekKey, weeklyPick } from './_albumrules.mjs';

const HOME_TZ = 'Asia/Kolkata';

let ready = false;
export async function ensureAlbumSchema(sql) {
  if (ready) return;
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  await schemaOnce(() => albumTables(sql));
  ready = true;
}
async function albumTables(sql) {
  await sql`create table if not exists album_albums (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    name text not null,
    on_date date,
    year integer,
    audience text not null default 'family' check (audience in ('family', 'chosen', 'me')),
    chosen uuid[] not null default '{}',
    by_member uuid references members(id) on delete set null,
    is_default boolean not null default false,
    created_at timestamptz not null default now()
  )`;
  // One "Our family" album per circle, however many phones open at once.
  await sql`create unique index if not exists album_albums_default on album_albums (circle_id) where is_default`;
  await sql`create index if not exists album_albums_circle on album_albums (circle_id)`;
  await sql`create table if not exists album_photos (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    album_id uuid not null references album_albums(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    caption text,
    taken_year integer,
    width integer,
    height integer,
    photo_bytes integer not null,
    thumb_bytes integer not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists album_photos_circle on album_photos (circle_id, created_at desc)`;
  await sql`create index if not exists album_photos_album on album_photos (album_id)`;
  await sql`create table if not exists album_people (
    photo_id uuid not null references album_photos(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    primary key (photo_id, member_id)
  )`;
  await sql`create index if not exists album_people_member on album_people (member_id)`;
  // A name someone took off a photo themself. Whoever added the photo can
  // change its people, but cannot put that name back: it was the person's
  // own choice, and only they could change it.
  await sql`create table if not exists album_untagged (
    photo_id uuid not null references album_photos(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    at timestamptz not null default now(),
    primary key (photo_id, member_id)
  )`;
  // The pictures themselves, apart from everything that is listed and
  // searched, so no list query ever drags them along.
  await sql`create table if not exists album_bytes (
    photo_id uuid primary key references album_photos(id) on delete cascade,
    photo bytea not null,
    thumb bytea not null
  )`;
  // A JPEG is already packed: asking Postgres to pack it again only costs time.
  // Asked once: the change takes a lock, so it is not repeated on every start.
  const st = await sql`select attname from pg_attribute where attrelid = 'album_bytes'::regclass and attname in ('photo', 'thumb') and attstorage <> 'e'`;
  for (const c of st) {
    if (c.attname === 'photo') await sql`alter table album_bytes alter column photo set storage external`;
    else await sql`alter table album_bytes alter column thumb set storage external`;
  }
  // A reaction: one per person per photo. And a voice caption: one per photo.
  await sql`create table if not exists album_reactions (
    photo_id uuid not null references album_photos(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    emoji text not null,
    created_at timestamptz not null default now(),
    primary key (photo_id, member_id)
  )`;
  await sql`create table if not exists album_voice (
    photo_id uuid primary key references album_photos(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    audio text not null,
    secs int,
    created_at timestamptz not null default now()
  )`;
  // The weekly photo on Today: claimed once per person per week.
  await sql`create table if not exists album_weeks (
    member_id uuid not null references members(id) on delete cascade,
    week text not null,
    photo_id uuid references album_photos(id) on delete set null,
    status text not null default 'shown',
    created_at timestamptz not null default now(),
    primary key (member_id, week)
  )`;
}

// ---------------------------------------------------------------- the bytes
// THE ONLY TWO PLACES THE PICTURE BYTES ARE TOUCHED. To move photos to file
// storage later, change these two and nothing else.

// Keep one photo and its thumbnail. Both arrive as base64 that has already
// been read and checked (see imageError in _albumrules.mjs).
export async function albumPutBytes(sql, photoId, photoB64, thumbB64) {
  await sql`insert into album_bytes (photo_id, photo, thumb)
            values (${photoId}, decode(${photoB64}, 'base64'), decode(${thumbB64}, 'base64'))`;
}

// Hand back one photo or its thumbnail, as bytes, to someone its album is
// for. The audience rule is inside the query, so there is no way to read a
// picture without it: a photo in an album that is not for this member comes
// back as nothing, exactly like a photo that does not exist.
export async function albumGetBytes(sql, circleId, meId, photoId, size) {
  const thumb = size === 'thumb';
  const r = await sql`
    select encode(case when ${thumb}::boolean then b.thumb else b.photo end, 'base64') as b64
    from album_bytes b
    join album_photos p on p.id = b.photo_id
    join album_albums a on a.id = p.album_id
    where b.photo_id = ${photoId} and p.circle_id = ${circleId} and a.circle_id = ${circleId}
      and (a.audience = 'family' or a.by_member = ${meId} or (a.audience = 'chosen' and ${meId}::uuid = any(a.chosen)))`;
  return r[0] ? Buffer.from(r[0].b64, 'base64') : null;
}

// ---------------------------------------------------------------- reading
// Every circle has one album from the start, for everyone in it.
async function defaultAlbum(sql, circle) {
  const have = await sql`select id from album_albums where circle_id = ${circle.id} and is_default`;
  if (have[0]) return have[0].id;
  await sql`insert into album_albums (circle_id, name, audience, is_default)
            values (${circle.id}, ${'Our ' + spaceWord(circle)}, 'family', true)
            on conflict (circle_id) where is_default do nothing`;
  return (await sql`select id from album_albums where circle_id = ${circle.id} and is_default`)[0].id;
}

async function countOf(sql, circleId) {
  return (await sql`select count(*)::int as n from album_photos where circle_id = ${circleId}`)[0].n;
}

// The albums this member may see. Who was chosen is told only to the maker.
async function albumsFor(sql, circle, me) {
  const rows = await sql`
    select a.id, a.name, to_char(a.on_date, 'YYYY-MM-DD') as on_date, a.year, a.audience, a.chosen, a.is_default,
           a.by_member, b.name as by_name, a.created_at,
           (select count(*)::int from album_photos p where p.album_id = a.id) as count
    from album_albums a left join members b on b.id = a.by_member
    where a.circle_id = ${circle.id}
      and (a.audience = 'family' or a.by_member = ${me.id} or (a.audience = 'chosen' and ${me.id}::uuid = any(a.chosen)))
    order by a.is_default desc, a.created_at desc`;
  return rows.map(a => ({ id: a.id, name: a.name, date: a.on_date, year: a.year, audience: a.audience,
    chosen: a.by_member === me.id ? a.chosen : [], isDefault: a.is_default, byMember: a.by_member, byName: a.by_name,
    mine: a.by_member === me.id, count: a.count }));
}

// The photos this member may see, newest first, with who is in each.
async function photosFor(sql, circle, me, { album = null, person = null, id = null, limit = ALBUM_MAX.perCircle } = {}) {
  const rows = await sql`
    select p.id, p.album_id, p.caption, p.taken_year, p.width, p.height, p.by_member, b.name as by_name, p.created_at,
           a.name as album_name, a.by_member as album_by,
           (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name), '[]'::jsonb)
              from album_people ap join members m on m.id = ap.member_id where ap.photo_id = p.id) as people,
           (select coalesce(jsonb_agg(jsonb_build_object('e', r.emoji, 'm', r.member_id, 'n', rm.name) order by r.created_at), '[]'::jsonb)
              from album_reactions r join members rm on rm.id = r.member_id where r.photo_id = p.id) as reactions,
           (select v.secs from album_voice v where v.photo_id = p.id) as voice_secs,
           exists (select 1 from album_voice v where v.photo_id = p.id) as has_voice
    from album_photos p
    join album_albums a on a.id = p.album_id
    left join members b on b.id = p.by_member
    where p.circle_id = ${circle.id} and a.circle_id = ${circle.id}
      and (a.audience = 'family' or a.by_member = ${me.id} or (a.audience = 'chosen' and ${me.id}::uuid = any(a.chosen)))
      and (${album}::uuid is null or p.album_id = ${album}::uuid)
      and (${id}::uuid is null or p.id = ${id}::uuid)
      and (${person}::uuid is null or exists (select 1 from album_people ap where ap.photo_id = p.id and ap.member_id = ${person}::uuid))
    order by p.created_at desc, p.id
    limit ${limit}`;
  return rows.map(p => {
    const people = p.people || [];
    // Reactions, grouped: the emoji, how many, who, and whether one is mine.
    const rx = [];
    (p.reactions || []).forEach(r => {
      let g = rx.find(x => x.emoji === r.e);
      if (!g) { g = { emoji: r.e, count: 0, names: [], mine: false }; rx.push(g); }
      g.count++; g.names.push(r.m === me.id ? 'You' : r.n); if (r.m === me.id) g.mine = true;
    });
    return { reactions: rx, hasVoice: !!p.has_voice, voiceSecs: p.voice_secs || null, id: p.id, albumId: p.album_id, albumName: p.album_name, caption: p.caption || '', year: p.taken_year,
      width: p.width, height: p.height, byMember: p.by_member, byName: p.by_name, createdAt: p.created_at, people,
      alt: albumAlt(p.caption, people.map(x => x.name), p.taken_year),
      canChange: p.by_member === me.id || p.album_by === me.id,
      taggedMe: people.some(x => x.id === me.id) };
  });
}

async function listView(sql, circle, me, q) {
  await defaultAlbum(sql, circle);
  // An "only me" album whose maker has left the circle can be seen by
  // nobody: it goes, so it does not sit in the count for ever.
  await sql`delete from album_albums where circle_id = ${circle.id} and by_member is null and not is_default and audience = 'me'`;
  const album = isUuid(q.album) ? q.album : null, person = isUuid(q.person) ? q.person : null;
  const limit = Math.max(1, Math.min(ALBUM_MAX.perCircle, parseInt(q.limit, 10) || ALBUM_MAX.perCircle));
  const albums = await albumsFor(sql, circle, me);
  const photos = await photosFor(sql, circle, me, { album, person, limit });
  const members = await sql`select id, name, (user_id is not null) as on_app from members where circle_id = ${circle.id} order by name`;
  const count = await countOf(sql, circle.id);
  return { ok: true, kind: circle.kind || 'family', me: me.id, albums, photos, members,
    count, cap: ALBUM_MAX.perCircle, left: Math.max(0, ALBUM_MAX.perCircle - count),
    near: count >= ALBUM_MAX.nearAt, full: count >= ALBUM_MAX.perCircle, line: capLine(count, spaceWord(circle)),
    max: { photoBytes: ALBUM_MAX.photoBytes, thumbBytes: ALBUM_MAX.thumbBytes, photoSide: ALBUM_MAX.photoSide,
           thumbSide: ALBUM_MAX.thumbSide, perRequest: ALBUM_MAX.perRequest, minYear: ALBUM_MAX.minYear } };
}

// ---------------------------------------------------------------- Today
// How far a zone's clock is ahead of UTC at this moment, in milliseconds.
function zoneOffsetMs(nowMs, tz) {
  try {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(nowMs)).forEach(x => { p[x.type] = +x.value; });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(nowMs / 1000) * 1000;
  } catch (e) { return 0; }
}
// One older photo a week for each member: claimed once on the (member, week)
// key so every phone shows the same one, and looked at again on every
// request, so a photo that was removed or made private goes at once.
async function todayView(sql, circle, me, nowMs, tz) {
  await ensureBondSchema(sql);                 // "remembered" and the Yaadein choices live there
  const today = dayOf(nowMs, tz), week = isoWeekKey(today), year = +today.slice(0, 4);
  // The moment this year began where the member is. Worked out here and
  // sent as an instant: a phone can name its zone in a way the database
  // does not know (Asia/Calcutta for Asia/Kolkata).
  const yearStart = new Date(Date.UTC(year, 0, 1) - zoneOffsetMs(nowMs, tz)).toISOString();
  let row = (await sql`select photo_id, status from album_weeks where member_id = ${me.id} and week = ${week}`)[0];
  if (row && row.status !== 'shown') return null;
  let p = row && row.photo_id ? (await photosFor(sql, circle, me, { id: row.photo_id, limit: 1 }))[0] : null;
  // Someone in it was marked as remembered, or hidden from Yaadein, after
  // it was claimed: it is put away at once.
  if (p && (await sql`select 1 as hit from album_people ap join members m on m.id = ap.member_id
                      left join bond_prefs bp on bp.member_id = ${me.id}
                      where ap.photo_id = ${p.id} and (m.remembered or m.id = any(coalesce(bp.hide_people, '{}'::uuid[]))) limit 1`)[0]) p = null;
  if (!p) {
    // Nothing claimed yet this week, or the photo that was claimed has been
    // removed or is no longer for this member: choose again.
    // Older means from a year before this one: the year it was taken when
    // the family wrote one, otherwise the year it was added. A photo of
    // someone the family marked as remembered, or someone this member asked
    // Yaadein to leave out, is never brought up by itself.
    const cands = await sql`
      select p.id
      from album_photos p
      join album_albums a on a.id = p.album_id
      left join bond_prefs bp on bp.member_id = ${me.id}
      where p.circle_id = ${circle.id} and a.circle_id = ${circle.id}
        and (a.audience = 'family' or a.by_member = ${me.id} or (a.audience = 'chosen' and ${me.id}::uuid = any(a.chosen)))
        and (case when p.taken_year is not null then p.taken_year < ${year} else p.created_at < ${yearStart}::timestamptz end)
        and not exists (select 1 from album_people ap join members m on m.id = ap.member_id
                        where ap.photo_id = p.id and (m.remembered or m.id = any(coalesce(bp.hide_people, '{}'::uuid[]))))
      limit ${ALBUM_MAX.perCircle}`;
    const pick = weeklyPick(me.id, today, cands.map(c => c.id));
    if (!pick) return null;                    // nothing older to show: look again next time
    // A first claim is kept if another phone got there first; a claim whose
    // photo has gone is given the new one.
    if (row) await sql`update album_weeks set photo_id = ${pick} where member_id = ${me.id} and week = ${week} and status = 'shown'`;
    else await sql`insert into album_weeks (member_id, week, photo_id) values (${me.id}, ${week}, ${pick})
                   on conflict (member_id, week) do nothing`;
    row = (await sql`select photo_id, status from album_weeks where member_id = ${me.id} and week = ${week}`)[0];
    if (!row || !row.photo_id || row.status !== 'shown') return null;
    p = (await photosFor(sql, circle, me, { id: row.photo_id, limit: 1 }))[0];
    if (!p) return null;
  }
  const y = p.year || +dayOf(new Date(p.createdAt).getTime(), tz).slice(0, 4);
  return { week, year: y, photo: p };
}

// ---------------------------------------------------------------- the route
export default async function albumApi(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureAlbumSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const g = await requireMember(sql, code, memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;
    const word = spaceWord(circle);
    const tz = validTz(reqTz(req)) || HOME_TZ;
    const nowMs = Date.now();
    const bad = (error, status, extra) => res.status(status || 400).json({ ok: false, error, ...(extra || {}) });
    const good = (extra, status) => res.status(status || 200).json({ ok: true, ...(extra || {}) });

    if (req.method === 'GET') {
      const view = String(q.view || 'list');
      if (view === 'photo') {
        const NOT_HERE = 'That photo is not here, or it is not shared with you.';
        if (!isUuid(q.id)) return bad(NOT_HERE, 404);
        const size = q.size === 'full' ? 'full' : 'thumb';
        // Never kept by anything between the server and this phone, and
        // asked for again each time, so a photo that was removed or made
        // private stops showing. An unchanged photo is answered with "you
        // already have it" and no bytes.
        res.setHeader('Cache-Control', 'private, no-cache');
        res.setHeader('Vary', 'X-Parwah-Token');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const etag = '"ab-' + q.id + '-' + size + '"';
        const inm = req.headers && (req.headers['if-none-match'] || req.headers['If-None-Match']);
        if (inm && inm === etag) {
          const seen = await sql`
            select 1 as ok from album_photos p join album_albums a on a.id = p.album_id
            where p.id = ${q.id} and p.circle_id = ${circle.id} and a.circle_id = ${circle.id}
              and (a.audience = 'family' or a.by_member = ${me.id} or (a.audience = 'chosen' and ${me.id}::uuid = any(a.chosen)))`;
          if (!seen[0]) return bad(NOT_HERE, 404);
          res.setHeader('ETag', etag);
          res.status(304);
          return res.end();
        }
        const bytes = await albumGetBytes(sql, circle.id, me.id, q.id, size);
        if (!bytes) return bad(NOT_HERE, 404);
        // The type is ours to state: only JPEGs are ever kept.
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', String(bytes.length));
        res.setHeader('Content-Disposition', 'inline; filename="parwah-photo.jpg"');
        res.setHeader('ETag', etag);
        res.status(200);
        return res.end(bytes);
      }
      if (view === 'voice') {
        // The voice caption, to someone the album is for. The rule is in the query.
        if (!isUuid(q.id)) return bad('That photo is not here, or it is not shared with you.', 404);
        const v = await sql`
          select v.audio from album_voice v join album_photos p on p.id = v.photo_id join album_albums a on a.id = p.album_id
          where v.photo_id = ${q.id} and p.circle_id = ${circle.id} and a.circle_id = ${circle.id}
            and (a.audience = 'family' or a.by_member = ${me.id} or (a.audience = 'chosen' and ${me.id}::uuid = any(a.chosen)))`;
        if (!v[0]) return bad('That photo is not here, or it is not shared with you.', 404);
        return good({ audio: v[0].audio });
      }
      if (view === 'today') return good({ pick: await todayView(sql, circle, me, nowMs, tz) });
      if (view === 'list') return res.status(200).json(await listView(sql, circle, me, q));
      return bad('Unknown view');
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return bad('GET or POST only', 405);
    }
    const action = String(body.action || '');
    const nowYear = +dayOf(nowMs, tz).slice(0, 4);

    // The album, if this member may see it (and so may add to it).
    const albumFor = async (id) => {
      if (!isUuid(id)) return null;
      return (await sql`
        select a.id, a.name, a.audience, a.chosen, a.by_member, a.is_default
        from album_albums a
        where a.id = ${id} and a.circle_id = ${circle.id}
          and (a.audience = 'family' or a.by_member = ${me.id} or (a.audience = 'chosen' and ${me.id}::uuid = any(a.chosen)))`)[0] || null;
    };
    // The photo, if this member may see it, with who made its album.
    const photoFor = async (id) => {
      if (!isUuid(id)) return null;
      return (await sql`
        select p.id, p.by_member, p.album_id, a.by_member as album_by, a.name as album_name
        from album_photos p join album_albums a on a.id = p.album_id
        where p.id = ${id} and p.circle_id = ${circle.id} and a.circle_id = ${circle.id}
          and (a.audience = 'family' or a.by_member = ${me.id} or (a.audience = 'chosen' and ${me.id}::uuid = any(a.chosen)))`)[0] || null;
    };
    // The people in a photo: members of this circle, on Parwah or added by name.
    const peopleOf = async (list) => {
      const ids = [...new Set(Array.isArray(list) ? list : [])];
      if (ids.length > ALBUM_MAX.people || !ids.every(isUuid)) return { error: 'Bad person' };
      if (!ids.length) return { ids: [] };
      const rows = await sql`select id from members where circle_id = ${circle.id} and id = any(${ids}::uuid[])`;
      if (rows.length !== ids.length) return { error: 'Pick people from this ' + word + '.' };
      return { ids };
    };
    const wordsOf = () => {
      const caption = cleanLine(body.caption, ALBUM_MAX.caption, 'A caption');
      if (caption.error) return { error: caption.error };
      const risk = noteRisk(caption.value);
      if (risk) return { error: risk };
      const year = cleanYear(body.year, nowYear);
      if (year.error) return { error: year.error };
      return { caption: caption.value || null, year: year.value };
    };

    // ---------------------------------------------------------- add photos
    if (action === 'photo_add') {
      const album = await albumFor(body.albumId);
      if (!album) return bad('That album is not here, or it is not shared with you.', 404);
      const list = Array.isArray(body.photos) ? body.photos : [];
      if (!list.length) return bad('Choose a photo first.');
      if (list.length > ALBUM_MAX.perRequest) return bad('Add up to ' + ALBUM_MAX.perRequest + ' photos at a time.', 413);
      const words = wordsOf();
      if (words.error) return bad(words.error);
      const people = await peopleOf(body.people);
      if (people.error) return bad(people.error);
      // Every picture is read, here, before anything is kept. What the
      // sender calls it (a type, a file name) is not looked at.
      const items = []; let total = 0;
      for (const it of list) {
        const photo = cleanB64(it && it.photo), thumb = cleanB64(it && it.thumb);
        if (!photo || !thumb) return bad('A photo could not be read. Please try again.');
        const pBytes = Buffer.from(photo, 'base64'), tBytes = Buffer.from(thumb, 'base64');
        const err = imageError(pBytes, 'photo') || imageError(tBytes, 'thumb');
        if (err) return bad(err, /larger than/.test(err) ? 413 : 400);
        total += pBytes.length + tBytes.length;
        const dim = jpegInfo(pBytes);
        items.push({ photo, thumb, pSize: pBytes.length, tSize: tBytes.length, width: dim.width, height: dim.height });
      }
      if (total > ALBUM_MAX.requestBytes) return bad('That is too much to send at once. Add fewer photos at a time.', 413);
      const before = await countOf(sql, circle.id);
      const capErr = capError(before, items.length);
      if (capErr) return bad(capErr, 409, { full: true, count: before, cap: ALBUM_MAX.perCircle });
      // One count per photo, so sixty an hour means sixty photos.
      for (let i = 0; i < items.length; i++) {
        if (!(await rateLimit(sql, 'album_up', me.id, ALBUM_MAX.perHour, 3600, { failClosed: true }))) {
          return bad('You have added ' + ALBUM_MAX.perHour + ' photos in the last hour. Add more in a little while.', 429);
        }
      }
      const ids = [];
      for (const it of items) {
        // The cap is in the insert itself, so two phones adding at the same
        // moment cannot both slip the last photo in.
        const r = await sql`
          insert into album_photos (circle_id, album_id, by_member, caption, taken_year, width, height, photo_bytes, thumb_bytes)
          select ${circle.id}, ${album.id}, ${me.id}, ${words.caption}, ${words.year}, ${it.width}, ${it.height}, ${it.pSize}, ${it.tSize}
          where (select count(*) from album_photos where circle_id = ${circle.id}) < ${ALBUM_MAX.perCircle}
          returning id`;
        if (!r[0]) return bad(capError(ALBUM_MAX.perCircle, 1), 409, { full: true, count: ALBUM_MAX.perCircle, cap: ALBUM_MAX.perCircle, ids });
        try { await albumPutBytes(sql, r[0].id, it.photo, it.thumb); }
        catch (e) { await sql`delete from album_photos where id = ${r[0].id}`; throw e; }
        if (people.ids.length) await sql`insert into album_people (photo_id, member_id) select ${r[0].id}, unnest(${people.ids}::uuid[]) on conflict do nothing`;
        ids.push(r[0].id);
      }
      // The family feed hears about a family album only. A private album
      // stays out of it, name and all.
      if (album.audience === 'family') {
        await sql`insert into events (circle_id, member_id, type, text)
                  values (${circle.id}, ${me.id}, 'care', ${me.name + ' added ' + (ids.length === 1 ? 'a photo' : ids.length + ' photos') + ' to ' + album.name + ' 📷'})`;
        // At most ONE "new photos" push a day for the whole family, whoever
        // adds and however many: the day's count is kept on the server.
        if (await rateLimit(sql, 'album_push', circle.id, ALBUM_PUSH_PER_DAY, 86400, { failClosed: true })) {
          await pushCircle(sql, circle.id, { title: '📷 New photos in ' + album.name, body: me.name + ' added to the family album. Have a look when you like.', url: '/#memory' }, { except: me.id });
        }
      }
      const count = before + ids.length;
      return good({ ids, count, cap: ALBUM_MAX.perCircle, left: Math.max(0, ALBUM_MAX.perCircle - count), line: capLine(count, word) }, 201);
    }

    // ---------------------------------------------------------- change or remove a photo
    if (action === 'photo_edit' || action === 'photo_remove') {
      const p = await photoFor(body.id);
      if (!p) return bad('That photo is not here, or it is not shared with you.', 404);
      if (p.by_member !== me.id && p.album_by !== me.id) {
        return bad('Only the person who added this photo, or whoever made the album, can ' + (action === 'photo_edit' ? 'change' : 'remove') + ' it.', 403);
      }
      if (action === 'photo_remove') {
        await sql`delete from album_photos where id = ${p.id}`;
        return good({ count: await countOf(sql, circle.id) });
      }
      const words = wordsOf();
      if (words.error) return bad(words.error);
      const people = await peopleOf(body.people);
      if (people.error) return bad(people.error);
      // A name its owner took off this photo is not put back by anyone else.
      // (Putting your own name back is your own choice again.)
      const took = people.ids.length ? await sql`select u.member_id, m.name from album_untagged u join members m on m.id = u.member_id
                                                 where u.photo_id = ${p.id} and u.member_id = any(${people.ids}::uuid[]) and u.member_id <> ${me.id}` : [];
      if (took[0]) return bad(took[0].name + ' took their name off this photo, so it stays off.', 409);
      await sql`delete from album_untagged where photo_id = ${p.id} and member_id = ${me.id} and ${me.id}::uuid = any(${people.ids}::uuid[])`;
      await sql`update album_photos set caption = ${words.caption}, taken_year = ${words.year} where id = ${p.id}`;
      await sql`delete from album_people where photo_id = ${p.id} and not (member_id = any(${people.ids}::uuid[]))`;
      if (people.ids.length) await sql`insert into album_people (photo_id, member_id) select ${p.id}, unnest(${people.ids}::uuid[]) on conflict do nothing`;
      return good();
    }
    // A reaction: one per person per photo, from anyone the album is for.
    // Quiet: it never sends a push and never goes on the feed.
    if (action === 'photo_react') {
      const p = await photoFor(body.id);
      if (!p) return bad('That photo is not here, or it is not shared with you.', 404);
      const e = body.emoji;
      if (e === null || e === undefined || e === '') {
        await sql`delete from album_reactions where photo_id = ${p.id} and member_id = ${me.id}`;
      } else {
        if (!ALBUM_REACTIONS.includes(e)) return bad('Pick one of the five reactions');
        await sql`insert into album_reactions (photo_id, member_id, emoji) values (${p.id}, ${me.id}, ${e})
                  on conflict (photo_id, member_id) do update set emoji = excluded.emoji, created_at = now()`;
      }
      return good({ photo: (await photosFor(sql, circle, me, { id: p.id, limit: 1 }))[0] || null });
    }
    // A voice caption: "this was Shimla, 1987". From whoever added the photo
    // or made the album; heard by everyone the album is for.
    if (action === 'photo_voice' || action === 'photo_voice_remove') {
      const p = await photoFor(body.id);
      if (!p) return bad('That photo is not here, or it is not shared with you.', 404);
      if (p.by_member !== me.id && p.album_by !== me.id) return bad('Only the person who added this photo, or whoever made the album, can change its voice caption.', 403);
      if (action === 'photo_voice_remove') {
        await sql`delete from album_voice where photo_id = ${p.id}`;
        return good();
      }
      const v = audioCheck(body.mime, body.audio, body.secs);
      if (v.err) return bad(v.err);
      await sql`insert into album_voice (photo_id, by_member, audio, secs) values (${p.id}, ${me.id}, ${v.uri}, ${v.secs})
                on conflict (photo_id) do update set by_member = excluded.by_member, audio = excluded.audio, secs = excluded.secs, created_at = now()`;
      return good({}, 201);
    }
    // Anyone named in a photo can take their own name off it. Only their own.
    if (action === 'untag') {
      const p = await photoFor(body.id);
      if (!p) return bad('That photo is not here, or it is not shared with you.', 404);
      const r = await sql`delete from album_people where photo_id = ${p.id} and member_id = ${me.id} returning photo_id`;
      if (!r[0]) return bad('Your name is not on this photo.', 404);
      // Remembered, so an edit by whoever added the photo cannot undo it.
      await sql`insert into album_untagged (photo_id, member_id) values (${p.id}, ${me.id}) on conflict do nothing`;
      return good();
    }

    // ---------------------------------------------------------- albums
    if (action === 'album_save') {
      const name = cleanLine(body.name, ALBUM_MAX.name, 'An album name');
      if (name.error) return bad(name.error);
      if (!name.value) return bad('Give the album a name, like Diwali 2019.');
      const risk = noteRisk(name.value);
      if (risk) return bad(risk);
      const date = cleanDate(body.date, dayOf(nowMs, tz));
      if (date.error) return bad(date.error);
      const year = cleanYear(body.year, nowYear);
      if (year.error) return bad(year.error);
      const audience = ALBUM_AUDIENCES.includes(body.audience) ? body.audience : null;
      if (!audience) return bad('Pick who can see this album.');
      let chosen = [];
      if (audience === 'chosen') {
        const ids = [...new Set(Array.isArray(body.chosen) ? body.chosen : [])];
        if (!ids.length) return bad('Pick at least one person.');
        if (ids.length > ALBUM_MAX.chosen || !ids.every(isUuid)) return bad('Bad person');
        // In this circle AND not marked as remembered. (A remembered person
        // may still be TAGGED in a photo: that is what an album is for.)
        const rows = await sql`select m.id, m.name, m.user_id, coalesce((to_jsonb(m)->>'remembered')::boolean, false) as remembered
                               from members m where m.circle_id = ${circle.id} and m.id = any(${ids}::uuid[]) and m.id <> ${me.id}`;
        if (rows.length !== ids.length) return bad('Pick people from this ' + word + '.');
        const lost = rows.find(m => m.remembered);
        if (lost) return bad(lost.name + ' is remembered here, so cannot be chosen.');
        const off = rows.find(m => !m.user_id);
        if (off) return bad(off.name + ' is not on Parwah yet, so they would not see it.');
        chosen = ids;
      }
      if (!body.id) {
        const n = (await sql`select count(*)::int as n from album_albums where circle_id = ${circle.id}`)[0].n;
        if (n >= ALBUM_MAX.albums) return bad('This ' + word + ' has ' + ALBUM_MAX.albums + ' albums. Remove one to make another.', 409);
        const r = await sql`insert into album_albums (circle_id, name, on_date, year, audience, chosen, by_member)
                            values (${circle.id}, ${name.value}, ${date.value}::date, ${date.value ? null : year.value}, ${audience}, ${chosen}::uuid[], ${me.id})
                            returning id`;
        return good({ id: r[0].id }, 201);
      }
      const a = await albumFor(body.id);
      if (!a) return bad('That album is not here, or it is not shared with you.', 404);
      if (a.is_default) return bad(a.name + ' is the album for the whole ' + word + '. It stays as it is.', 403);
      if (a.by_member !== me.id) return bad('Only whoever made this album can change it.', 403);
      // Nobody loses sight of a photo they added: the album cannot be made
      // more private than the people whose photos are already in it.
      const adders = (await sql`select distinct p.by_member, m.name from album_photos p join members m on m.id = p.by_member where p.album_id = ${a.id}`);
      const out = lockedOut(audience, chosen, me.id, adders.map(x => x.by_member));
      if (out.length) {
        const names = adders.filter(x => out.includes(x.by_member)).map(x => x.name).join(', ');
        return bad('This album has photos added by ' + names + '. Keep them among the people who can see it, or remove those photos first.', 409);
      }
      await sql`update album_albums set name = ${name.value}, on_date = ${date.value}::date, year = ${date.value ? null : year.value},
                audience = ${audience}, chosen = ${chosen}::uuid[] where id = ${a.id}`;
      return good({ id: a.id });
    }
    if (action === 'album_remove') {
      const a = await albumFor(body.id);
      if (!a) return bad('That album is not here, or it is not shared with you.', 404);
      if (a.is_default) return bad(a.name + ' is the album for the whole ' + word + '. It cannot be removed.', 403);
      if (a.by_member !== me.id) return bad('Only whoever made this album can remove it.', 403);
      const n = (await sql`select count(*)::int as n from album_photos where album_id = ${a.id}`)[0].n;
      await sql`delete from album_albums where id = ${a.id}`;
      return good({ removed: n, count: await countOf(sql, circle.id) });
    }

    // ---------------------------------------------------------- Today
    if (action === 'today_hide') {
      const week = isoWeekKey(dayOf(nowMs, tz));
      await sql`insert into album_weeks (member_id, week, status) values (${me.id}, ${week}, 'hidden')
                on conflict (member_id, week) do update set status = 'hidden'`;
      return good();
    }
    return bad('Unknown action');
  } catch (e) {
    return fail(res, e);
  }
}
