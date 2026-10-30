// Shared database helpers for the Parwah app API.
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';

let schemaReady = false;

export function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}

export async function ensureSchema(sql) {
  if (schemaReady) return;
  await sql`create table if not exists circles (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,
    name text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists members (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    name text not null,
    role text not null default 'family',
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists events (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid references members(id) on delete set null,
    type text not null,
    text text,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists events_circle_time on events (circle_id, created_at desc)`;
  await sql`create table if not exists reminders (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    for_member uuid not null references members(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    title text not null,
    time_of_day text,
    recurrence text not null default 'once',
    status text not null default 'pending',
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists requests (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    title text not null,
    status text not null default 'open',
    claimed_by uuid references members(id) on delete set null,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists chats (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    kind text not null default 'group',
    name text,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists chat_members (
    chat_id uuid not null references chats(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    primary key (chat_id, member_id)
  )`;
  await sql`create table if not exists messages (
    id uuid primary key default gen_random_uuid(),
    chat_id uuid not null references chats(id) on delete cascade,
    member_id uuid references members(id) on delete set null,
    text text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists messages_chat_time on messages (chat_id, created_at desc)`;
  await sql`alter table reminders add column if not exists due_date date`;
  await sql`alter table members add column if not exists phone text`;
  await sql`create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    phone text unique not null,
    name text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`alter table members add column if not exists user_id uuid references users(id) on delete set null`;
  // A PIN, so knowing someone's number is no longer the whole key. Null
  // until the person sets one, which is how existing accounts keep working
  // until their next sign-in asks them to choose it.
  await sql`alter table users add column if not exists pin_hash text`;
  await sql`alter table users add column if not exists pin_salt text`;
  await sql`alter table users add column if not exists pin_set_at timestamptz`;
  await sql`alter table users add column if not exists pin_tries int not null default 0`;
  await sql`alter table users add column if not exists locked_until timestamptz`;
  // Which rules the secret was chosen under (see SECRET_V in _auth.mjs).
  // Null or older than SECRET_V: signs in once with what it has, then chooses a 4-number PIN.
  await sql`alter table users add column if not exists secret_v int`;
  // Sessions: only the HASH of a token is stored, so a copy of this table is
  // not a set of working logins.
  await sql`create table if not exists sessions (
    token_hash text primary key,
    user_id uuid not null references users(id) on delete cascade,
    device text,
    created_at timestamptz not null default now(),
    last_used_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`;
  await sql`create index if not exists sessions_user on sessions (user_id)`;
  // Getting back in without an SMS: someone already in your circle vouches.
  await sql`create table if not exists pin_resets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    circle_id uuid references circles(id) on delete cascade,
    status text not null default 'pending',
    decided_by uuid references members(id) on delete set null,
    created_at timestamptz not null default now(),
    decided_at timestamptz
  )`;
  // The device that asked holds a one-time secret; only its hash is kept.
  // An approval lets in THAT device and no other: before this, a yes from
  // the family cleared the PIN and whoever typed the number next set one.
  // A request runs out, so a forgotten yes cannot be used weeks later.
  await sql`alter table pin_resets add column if not exists secret_hash text`;
  await sql`alter table pin_resets add column if not exists expires_at timestamptz`;
  // Tapping "ask my family" three times is one request, not three.
  await sql`update pin_resets p set status = 'replaced'
            where p.status = 'pending' and exists (select 1 from pin_resets q where q.user_id = p.user_id
              and q.status = 'pending' and (q.created_at, q.id) > (p.created_at, p.id))`;
  try { await sql`create unique index if not exists pin_resets_pending on pin_resets (user_id) where status = 'pending'`; } catch (e) {}

  await sql`alter table members add column if not exists place text`;
  await sql`alter table members add column if not exists dob date`;
  await sql`alter table members add column if not exists country text`;
  await sql`alter table members add column if not exists relation text`;
  await sql`alter table members add column if not exists gift_info jsonb`;
  // Phones are stored with the country code SEPARATE from the local number
  // (phone stays the full +E.164 for tel: links and joins).
  await sql`alter table members add column if not exists phone_cc text`;
  await sql`alter table members add column if not exists phone_local text`;
  await sql`alter table users add column if not exists phone_cc text`;
  await sql`alter table users add column if not exists phone_local text`;
  await sql`update members set phone_cc = '+91', phone_local = substring(phone from 4)
            where phone_cc is null and phone like '+91%' and length(phone) = 13`;
  await sql`update users set phone_cc = '+91', phone_local = substring(phone from 4)
            where phone_cc is null and phone like '+91%' and length(phone) = 13`;
  // Integrity rules: one membership per signed-in user per circle, one name
  // per circle. Non-fatal until legacy duplicates are tidied away.
  try { await sql`create unique index if not exists members_circle_user on members (circle_id, user_id) where user_id is not null`; } catch (e) {}
  try { await sql`create unique index if not exists members_circle_name on members (circle_id, lower(name))`; } catch (e) {}
  await sql`create table if not exists chat_reads (
    chat_id uuid not null references chats(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    read_at timestamptz not null default now(),
    primary key (chat_id, member_id)
  )`;
  await sql`create table if not exists notif_seen (
    member_id uuid primary key references members(id) on delete cascade,
    seen_at timestamptz not null default now()
  )`;
  await sql`alter table messages add column if not exists kind text not null default 'text'`;
  await sql`create table if not exists calls (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    room text not null,
    label text,
    by_member uuid references members(id) on delete set null,
    started_at timestamptz not null default now()
  )`;
  await sql`create table if not exists games (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    kind text not null default 'snakes',
    status text not null default 'active',
    state jsonb not null,
    created_at timestamptz not null default now()
  )`;
  // A circle is a family or a group - the same machinery, named honestly,
  // because "circle" is our word and nobody else's.
  await sql`alter table circles add column if not exists kind text not null default 'family'`;
  // Shown the introduction? Kept on the profile, not the device, so it is
  // once per person and not once per phone they happen to sign in on.
  await sql`alter table users add column if not exists toured_at timestamptz`;
  // Joining is by approval by default: an invite code alone must not be
  // enough to walk into a family that keeps its Aadhaar and passports here.
  await sql`alter table circles add column if not exists join_policy text not null default 'approve'`;
  // The family tree (api/_kin.mjs): each person may point to a parent and a
  // husband or wife in the same family; everything else - daughter-in-law,
  // grandson, Mama, Bua - is worked out from those two links.
  await sql`alter table members add column if not exists parent_id uuid references members(id) on delete set null`;
  await sql`alter table members add column if not exists spouse_id uuid references members(id) on delete set null`;
  await sql`alter table members add column if not exists gender text`;
  // Asked first when a family starts: a joint family or a nuclear one.
  await sql`alter table circles add column if not exists family_type text`;
  await sql`create table if not exists join_requests (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    user_id uuid references users(id) on delete cascade,
    name text not null,
    phone text,
    phone_cc text,
    phone_local text,
    relation text,
    role text not null default 'family',
    status text not null default 'pending',
    decided_by uuid references members(id) on delete set null,
    decided_at timestamptz,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists join_requests_circle on join_requests (circle_id, status, created_at desc)`;
  try { await sql`create unique index if not exists join_requests_pending on join_requests (circle_id, user_id) where status = 'pending' and user_id is not null`; } catch (e) {}
  // A join whose number matches a relative added by name (Dadi) asks to
  // become that row. It is only ever a request: sign-up has no SMS check,
  // so a matching number proves nothing until someone in the family says yes.
  await sql`alter table join_requests add column if not exists claim_member uuid references members(id) on delete set null`;
  // THE LAUNCH LIST. This table was being written to by the health probe
  // for weeks and was never in this function, so on any fresh database that
  // probe failed with "relation waitlist does not exist" - a schema that
  // existed only because someone had once typed it into the Neon console.
  await sql`create table if not exists waitlist (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null,
    phone text,
    city text,
    interest text not null default 'both',
    consent boolean not null default false,
    source text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  // Columns added after the table was first created by hand, so they are
  // added rather than assumed. Written out one per line as tagged templates,
  // like every other migration here: a loop that concatenates the column
  // definition into the statement is string-built SQL, and the gate rejects
  // that on sight - correctly, because the next person to add a column to
  // that loop will reach for a variable.
  await sql`alter table waitlist add column if not exists phone text`;
  await sql`alter table waitlist add column if not exists city text`;
  await sql`alter table waitlist add column if not exists interest text not null default 'both'`;
  await sql`alter table waitlist add column if not exists updated_at timestamptz not null default now()`;
  // WHEN they said yes, not only that they did. DPDP asks us to be able to
  // show consent, and a yes with no date cannot be shown. Null for a row
  // that has never consented; set once, by the first yes, and kept.
  await sql`alter table waitlist add column if not exists consent_at timestamptz`;
  // ONE PERSON IS ONE ROW, and the join depends on it: the insert uses
  // `on conflict (lower(email))`, which Postgres refuses outright when no
  // matching unique index exists - "there is no unique or exclusion
  // constraint matching the ON CONFLICT specification". So a swallowed
  // failure here does not degrade the launch list, it breaks every join.
  //
  // The table was created by hand before this function knew about it, so it
  // may hold the same address more than once. If it does, the index cannot
  // be built until the duplicates are gone.
  try {
    await sql`create unique index if not exists waitlist_email on waitlist (lower(email))`;
  } catch (e) {
    // Keep the FIRST time each address joined, because that date is the one
    // that means something. Carry forward what the later copies knew: a
    // consent given later must never be lost by a de-duplication, and a
    // phone number is how we would reach them.
    // Aggregated over ALL the copies, not joined to them. `update ... from`
    // with three duplicates picks ONE arbitrary partner row, so a first pass
    // written that way carried the phone from one copy and silently dropped
    // the city from another. Proved against Postgres 16 before and after.
    await sql`
      update waitlist k set
        consent = k.consent or agg.consent,
        phone   = coalesce(k.phone, agg.phone),
        city    = coalesce(k.city, agg.city)
      from (select lower(email) as em, bool_or(consent) as consent,
                   max(phone) as phone, max(city) as city
              from waitlist group by lower(email)) agg
      where lower(k.email) = agg.em`;
    await sql`
      delete from waitlist w using waitlist k
      where lower(w.email) = lower(k.email)
        and (w.created_at, w.id) > (k.created_at, k.id)`;
    await sql`create unique index if not exists waitlist_email on waitlist (lower(email))`;
  }
  await sql`create table if not exists rate_limit (
    bucket text not null,
    k text not null,
    window_start timestamptz not null default now(),
    n integer not null default 0,
    primary key (bucket, k)
  )`;
  schemaReady = true;
}

// The caller's address, as far as the platform will tell us. Used only as a
// rate-limit key - never stored against a person.
export function clientIp(req) {
  const h = (req && req.headers) || {};
  // Vercel sets x-vercel-forwarded-for and x-real-ip itself and overwrites
  // whatever the caller sent; x-forwarded-for keeps what the caller typed
  // at the front. Reading that first let one device give itself a fresh
  // address on every request and walk past every limit keyed on it.
  const fwd = String(h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || 'unknown';
}

// Two first requests at once on a fresh database both run "create table if
// not exists", and one can still lose with a duplicate error: the check and
// the create are not one step. The loser has nothing to fix, so it runs the
// same statements again, which now find everything there.
const SCHEMA_RACE = new Set(['23505', '42P07', '42710']);
export async function schemaOnce(make) {
  try { await make(); }
  catch (e) {
    if (!SCHEMA_RACE.has(e && e.code)) throw e;
    await make();
  }
}

// Fixed-window rate limit, counted in the database so it holds across every
// serverless instance. Returns true when the call is allowed. A limiter that
// cannot reach the database never blocks a real family signing in.
// failClosed is for work anyone can start that costs the database or money
// (the timer): there, a limiter that cannot count says no. SOS alerts stay
// open (see raiseSos); SOS texts and calls are capped inside dialOut.
export async function rateLimit(sql, bucket, key, limit, windowSec, { failClosed = false } = {}) {
  try {
    const rows = await sql`
      insert into rate_limit (bucket, k, window_start, n) values (${bucket}, ${key}, now(), 1)
      on conflict (bucket, k) do update set
        n = case when rate_limit.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limit.n + 1 end,
        window_start = case when rate_limit.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limit.window_start end
      returning n`;
    return rows[0].n <= limit;
  } catch (e) { return !failClosed; }
}

// Every circle has one default chat with everyone in it, created lazily.
export async function ensureCircleChat(sql, circleId) {
  const rows = await sql`select id from chats where circle_id = ${circleId} and kind = 'circle'`;
  if (rows[0]) return rows[0].id;
  const c = await sql`insert into chats (circle_id, kind, name) values (${circleId}, 'circle', 'Everyone') returning id`;
  return c[0].id;
}

// Join codes avoid look-alike characters so seniors can read them out on a call.
export function makeCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += letters[Math.floor(Math.random() * letters.length)];
  return c;
}

// THE CALLER MUST BE IN THE CIRCLE. An invite code is a doorbell, not a key:
// families paste them into WhatsApp groups, and join_policy 'approve' exists
// precisely because holding the code is not the same as being let in. Two GET
// routes used to resolve the circle from the code alone and hand back every
// member's phone, date of birth, feed and - worst - every member UUID, which
// is what the write routes accept as proof of who you are.
//
// → { circle, me } on success, or { err, status } to return verbatim.
// WHO IS CALLING. A session token identifies the caller now; the member UUID
// only says which membership they are acting through. Those UUIDs are handed
// to every member of a circle, so on their own they proved nothing.
export async function sessionUser(sql, token) {
  if (!token || typeof token !== 'string') return null;
  const h = createHash('sha256').update(token).digest('hex');
  const rows = await sql`select s.user_id, u.name from sessions s
                         join users u on u.id = s.user_id
                         where s.token_hash = ${h} and s.expires_at > now()`;
  if (!rows[0]) return null;
  // Touched rather than rotated: a family shares one tablet, and rotating on
  // every request logs the other person out mid-sentence.
  try { await sql`update sessions set last_used_at = now() where token_hash = ${h}`; } catch (e) {}
  return rows[0];
}

// THE userId IN A BODY IS A CLAIM, NOT A PROOF. Four actions (rename a
// profile, mark the tour seen, create a family, join one) took a userId from
// the request and acted as that person, so anyone who learned an id could
// rename someone, change their number, or attach a family to their account.
// The id must be the signed-in person's own. True when it is, or when the
// whole deployment runs with sign-in switched off.
export async function sessionIs(sql, token, userId) {
  if (!AUTH_REQUIRED) return true;
  const su = await sessionUser(sql, token);
  return !!su && String(su.user_id) === String(userId);
}

export async function requireMember(sql, code, memberId, token) {
  const circle = await circleByCode(sql, code);
  if (!circle) return { err: 'No family found with that code', status: 404 };
  if (!isUuid(memberId)) return { err: 'Not a member of this family', status: 403 };
  // place, country, dob and phone_cc are read by The day (city and sign),
  // pricing, Ekta's emergency numbers and SOS dialling; without them every
  // member looked like a New Delhi resident.
  const rows = await sql`select id, name, role, user_id, place, country, dob, phone_cc from members
                         where id = ${memberId} and circle_id = ${circle.id}`;
  if (!rows[0]) return { err: 'Not a member of this family', status: 403 };
  // The membership must belong to whoever holds the token. Without this a
  // member could act as any other member in the circle simply by sending
  // their UUID, which every screen already shows them.
  if (AUTH_REQUIRED) {
    const u = await sessionUser(sql, token);
    if (!u) return { err: 'Please sign in again', status: 401, signin: true };
    // A relative added by name (Dadi, who is not on the app) has no user_id,
    // and that row used to be accepted for ANY token: an outsider in no
    // family sent Dadi's id and read the whole family. A row nobody signs in
    // as is never the caller. Editing Dadi goes through the caller's own
    // membership plus a separate target id.
    if (!rows[0].user_id || rows[0].user_id !== u.user_id) {
      return { err: 'That is not your membership', status: 403 };
    }
  }
  return { circle, me: rows[0] };
}

// Set PARWAH_AUTH=off only to keep a half-migrated deployment usable while
// every client updates. It defaults ON: the safe value is the default, so
// forgetting to set anything leaves the door shut rather than open.
export const AUTH_REQUIRED = String(process.env.PARWAH_AUTH || 'on').toLowerCase() !== 'off';

export async function circleByCode(sql, code) {
  const clean = String(code || '').toUpperCase().trim();
  // Generated codes are 6 chars from the look-alike-free alphabet; custom
  // codes a family sets can be any 4-12 letters/digits.
  if (!/^[A-Z0-9]{4,12}$/.test(clean)) return null;
  const rows = await sql`select id, code, name, kind from circles where code = ${clean}`;
  return rows[0] || null;
}

// The word a person reads for the space: "circle" is the data model's word
// and stays in code. A group reads "group"; everything else is a family.
export function spaceWord(circle) {
  return circle && circle.kind === 'group' ? 'group' : 'family';
}

export { PHONE_CC, normPhone, phoneError } from './_phone.mjs';

export function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
