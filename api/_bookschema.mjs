// Health & contacts (family_book) and who may read each entry. Its own
// module because two routes need it first: book.mjs, and the care tools
// in _careprep.mjs whose tables point at family_book. Those used to answer
// 503 on a fresh database until Health & contacts had been opened once.
let ready = false;
export async function ensureBookSchema(sql) {
  if (ready) return;
  await sql`create table if not exists family_book (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    kind text not null,
    name text not null,
    category text,
    phone text,
    address text,
    forwhat text,
    notes text,
    by_member uuid references members(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`create index if not exists family_book_circle on family_book (circle_id, kind, name)`;
  await sql`alter table family_book add column if not exists about_member uuid references members(id) on delete cascade`;
  await sql`alter table family_book add column if not exists last_verified_at timestamptz not null default now()`;
  await sql`alter table family_book add column if not exists updated_by uuid references members(id) on delete set null`;
  // Consent, per entry. Default 'circle' keeps a plumber's number shared
  // with everyone; 'private' means only the person it is about, whoever
  // wrote it, and the people they have named one at a time.
  await sql`alter table family_book add column if not exists visibility text not null default 'circle'`;
  await sql`create table if not exists book_access (
    entry_id uuid not null references family_book(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    granted_by uuid references members(id) on delete set null,
    granted_at timestamptz not null default now(),
    primary key (entry_id, member_id)
  )`;
  // The ledger the subject of an entry can read: every change to who may
  // see something about them, and who made it.
  await sql`create table if not exists book_consent (
    id uuid primary key default gen_random_uuid(),
    entry_id uuid references family_book(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid references members(id) on delete set null,
    action text not null,
    at timestamptz not null default now()
  )`;
  await sql`create index if not exists book_consent_entry on book_consent (entry_id, at desc)`;
  ready = true;
}
