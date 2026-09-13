// GET /api/health - proves the database wiring end to end:
// inserts a marker row, reads it back, deletes it, reports counts.
import { neon } from '@neondatabase/serverless';
import { ensureSchema } from './_db.mjs';

export default async function handler(req, res) {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    return res.status(500).json({ ok: false, step: 'env', error: 'DATABASE_URL is not set on this Vercel project' });
  }
  const sql = neon(url);
  // The waitlist table this probe writes to is created by ensureSchema. It
  // was not called here, so on a fresh database the probe failed with
  // "relation waitlist does not exist" and read as a broken database.
  try { await ensureSchema(sql); } catch (e) {
    return res.status(500).json({ ok: false, step: "schema", error: String(e && e.message || e) });
  }
  const email = `healthcheck+${Date.now()}@parwah.internal`;
  try {
    await sql`insert into waitlist (name, email, consent, source)
              values ('Health Check', ${email}, true, 'healthcheck')`;
    const found = await sql`select id from waitlist where email = ${email}`;
    await sql`delete from waitlist where email = ${email}`;
    const gone = await sql`select id from waitlist where email = ${email}`;
    const count = await sql`select count(*)::int as n from waitlist`;
    return res.status(200).json({
      ok: true,
      inserted: found.length === 1,
      cleaned_up: gone.length === 0,
      waitlist_rows: count[0].n
    });
  } catch (e) {
    return res.status(500).json({ ok: false, step: 'sql', error: String(e && e.message || e) });
  }
}
