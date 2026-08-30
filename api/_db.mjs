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
  await sql`create table if not exists games (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    kind text not null default 'snakes',
    status text not null default 'active',
    state jsonb not null,
    created_at timestamptz not null default now()
  )`;
  schemaReady = true;
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
  if (!/^[A-Z2-9]{6}$/.test(clean)) return null;
  const rows = await sql`select id, code, name from circles where code = ${clean}`;
  return rows[0] || null;
}

// "+91 98765-43210" → "+919876543210"; returns null if it doesn't look like a phone.
export function normPhone(v) {
  let p = String(v || '').replace(/[()\-\s]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(p)) return null;
  if (!p.startsWith('+') && p.length === 10) p = '+91' + p; // bare Indian mobiles
  return p;
}

export function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
