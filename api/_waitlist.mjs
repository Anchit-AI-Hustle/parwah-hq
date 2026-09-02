// The launch list, on the database this product actually runs on.
//   GET  /api/settings?area=join            → how many families are waiting
//   POST /api/settings?area=join {name, email|whatsapp, consent, source}
//
// The table was written for a Supabase project that belongs to a retired repo
// (supabase/migrations/0001_waitlist.sql), so nothing ever created it here —
// which is why /api/diag, whose whole job is proving the database wiring, was
// permanently red, and why the site had no way to take an email address.
//
// WhatsApp stays the primary way in. This is for the person who will not
// message a business from their personal number, which on a launch page is a
// large minority of the people who wanted to be told.
import { db, rateLimit, clientIp, serverError } from './_db.mjs';

export async function ensureWaitlistSchema(sql) {
  await sql`create table if not exists waitlist (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    name text not null,
    email text,
    whatsapp text,
    consent boolean not null default false,
    source text not null default 'parwah-site'
  )`;
  // One spot per person, however they gave it to us. Partial indexes so a
  // row with only a phone and a row with only an email can both exist.
  await sql`create unique index if not exists waitlist_email_key on waitlist (lower(email)) where email is not null`;
  await sql`create unique index if not exists waitlist_wa_key on waitlist (whatsapp) where whatsapp is not null`;
}

// Deliberately not a full RFC validator: the job is to catch a typo before it
// becomes an address nobody can ever reach, not to reject unusual mailboxes.
function emailError(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.length > 200) return 'That email address is too long';
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s)) return 'That does not look like an email address';
  return null;
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureWaitlistSchema(sql); }
  catch (e) { return serverError(res, e, 'waitlist/schema'); }

  try {
    if (req.method === 'GET') {
      // Social proof, and nothing else: a count, never a list. This endpoint
      // is public, so it must not be a way to read who has signed up.
      const n = await sql`select count(*)::int as n from waitlist`;
      return res.status(200).json({ ok: true, waiting: n[0].n });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 80);
    const email = String(b.email || '').trim().slice(0, 200) || null;
    const wa = String(b.whatsapp || '').replace(/[^\d+]/g, '').slice(0, 20) || null;
    const source = String(b.source || 'parwah-site').trim().slice(0, 40) || 'parwah-site';

    if (!name) return res.status(400).json({ ok: false, error: 'Please tell us your name' });
    if (!email && !wa) return res.status(400).json({ ok: false, error: 'An email address or a WhatsApp number, whichever you prefer' });
    const bad = emailError(email);
    if (bad) return res.status(400).json({ ok: false, error: bad });
    // Consent is a real yes, not a default. Nothing is stored without it.
    if (b.consent !== true) return res.status(400).json({ ok: false, error: 'Please tick the box so we know it is alright to write to you' });

    // Counted after the input is known to be good, so a typo does not use up
    // a real person's attempt — a family behind one connection may well have
    // several people joining, and being told "too many" for a mistyped
    // address is how a form loses somebody.
    const allowed = await rateLimit(sql, 'waitlist', clientIp(req), 20, 3600);
    if (!allowed) return res.status(429).json({ ok: false, error: 'That is a lot of sign-ups from one place — try again a little later, or message us on WhatsApp.' });

    try {
      await sql`insert into waitlist (name, email, whatsapp, consent, source)
                values (${name}, ${email}, ${wa}, true, ${source})`;
    } catch (e) {
      // Already on the list is a success from where the person is standing.
      if (String(e && e.message || '').indexOf('duplicate key') >= 0) {
        return res.status(200).json({ ok: true, already: true });
      }
      throw e;
    }
    return res.status(201).json({ ok: true });
  } catch (e) {
    return serverError(res, e, 'waitlist');
  }
}
