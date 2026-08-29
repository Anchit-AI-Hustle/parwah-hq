// POST /api/waitlist — real launch-list signups.
// Requires explicit consent (DPDP); one spot per email (409 on duplicate).
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return res.status(500).json({ ok: false, error: 'Database not configured' });

  const { name, email, whatsapp, consent } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ ok: false, error: 'Please tell us your name' });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'That email does not look right' });
  }
  if (consent !== true) {
    return res.status(400).json({ ok: false, error: 'Consent is required to join the list' });
  }
  try {
    const sql = neon(url);
    await sql`insert into waitlist (name, email, whatsapp, consent, source)
              values (${name.trim().slice(0, 120)}, ${email.trim().toLowerCase()},
                      ${(whatsapp || '').toString().slice(0, 20) || null}, true, 'parwah-site')`;
    return res.status(201).json({ ok: true });
  } catch (e) {
    if (e && (e.code === '23505' || /duplicate|unique/i.test(String(e.message)))) {
      return res.status(409).json({ ok: true, already: true });
    }
    return res.status(500).json({ ok: false, error: 'Could not save right now — please try WhatsApp instead' });
  }
}
