-- Launch-list table for parwah-site.
-- Apply to Supabase project `parwah` (org: Anchit's AI Hustle) once it exists,
-- then paste the project URL + publishable key into PARWAH_WAITLIST in index.html.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  whatsapp text,
  consent boolean not null default false,
  source text not null default 'parwah-site'
);

alter table public.waitlist enable row level security;

-- The browser-side publishable key may only add rows; it can never read,
-- change, or delete them. Reads happen in the Supabase dashboard only.
create policy "anon can join waitlist" on public.waitlist
  for insert to anon
  with check (true);

-- One spot per email; the site maps the 409 conflict to a friendly message.
create unique index if not exists waitlist_email_key
  on public.waitlist (lower(email));
