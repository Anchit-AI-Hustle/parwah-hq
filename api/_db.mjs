// Shared database helpers for the Parwah app API.
import { neon } from '@neondatabase/serverless';

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
  // A circle is a family or a group — the same machinery, named honestly,
  // because "circle" is our word and nobody else's.
  await sql`alter table circles add column if not exists kind text not null default 'family'`;
  // Shown the introduction? Kept on the profile, not the device, so it is
  // once per person and not once per phone they happen to sign in on.
  await sql`alter table users add column if not exists toured_at timestamptz`;
  // Joining is by approval by default: an invite code alone must not be
  // enough to walk into a family that keeps its Aadhaar and passports here.
  await sql`alter table circles add column if not exists join_policy text not null default 'approve'`;
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
// rate-limit key — never stored against a person.
export function clientIp(req) {
  const h = (req && req.headers) || {};
  const fwd = String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim();
  return fwd || 'unknown';
}

// Fixed-window rate limit, counted in the database so it holds across every
// serverless instance. Returns true when the call is allowed. A limiter that
// cannot reach the database never blocks a real family.
export async function rateLimit(sql, bucket, key, limit, windowSec) {
  try {
    const rows = await sql`
      insert into rate_limit (bucket, k, window_start, n) values (${bucket}, ${key}, now(), 1)
      on conflict (bucket, k) do update set
        n = case when rate_limit.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limit.n + 1 end,
        window_start = case when rate_limit.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limit.window_start end
      returning n`;
    return rows[0].n <= limit;
  } catch (e) { return true; }
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

export async function circleByCode(sql, code) {
  const clean = String(code || '').toUpperCase().trim();
  // Generated codes are 6 chars from the look-alike-free alphabet; custom
  // codes a family sets can be any 4-12 letters/digits.
  if (!/^[A-Z0-9]{4,12}$/.test(clean)) return null;
  const rows = await sql`select id, code, name from circles where code = ${clean}`;
  return rows[0] || null;
}

export { PHONE_CC, normPhone, phoneError } from './_phone.mjs';

export function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
