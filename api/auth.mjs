// Phone-first sign-in. One action does both directions:
//   POST /api/auth {action:'enter', phone, name?}
//   - phone known   → sign in: returns the profile + every circle membership
//   - phone unknown → if name given, creates the profile and signs in
//                     (sign-up and sign-in in one seamless step);
//                     without a name returns exists:false so the client
//                     can ask for it.
// No OTP yet (SMS provider is a roadmap item) — the shape is ready for an
// OTP check to slot in here without any client-flow change.
import { db, ensureSchema, isUuid, normPhone } from './_db.mjs';

async function circlesOf(sql, userId) {
  return await sql`
    select c.code, c.name as "circleName", m.id as "memberId", m.role, m.name as "memberName"
    from members m join circles c on c.id = m.circle_id
    where m.user_id = ${userId}
    order by m.created_at desc`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  try {
    const body = req.body || {};
    if (body.action !== 'enter') return res.status(400).json({ ok: false, error: 'Unknown action' });
    const phone = normPhone(body.phone);
    if (!phone) return res.status(400).json({ ok: false, error: 'That does not look like a mobile number' });

    let rows = await sql`select id, name, phone from users where phone = ${phone}`;
    if (!rows[0]) {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return res.status(200).json({ ok: true, exists: false });
      try {
        rows = await sql`insert into users (phone, name) values (${phone}, ${name}) returning id, name, phone`;
      } catch (e) {
        // raced with another signup for the same phone — fall through to sign-in
        rows = await sql`select id, name, phone from users where phone = ${phone}`;
      }
    }
    const user = rows[0];
    const circles = await circlesOf(sql, user.id);
    return res.status(200).json({ ok: true, exists: true, user: { id: user.id, name: user.name, phone: user.phone }, circles });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
