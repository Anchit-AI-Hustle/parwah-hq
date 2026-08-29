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
  schemaReady = true;
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

export function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
