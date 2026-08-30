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

    if (body.action === 'update') {
      if (!isUuid(body.userId)) return res.status(403).json({ ok: false, error: 'Sign in first' });
      const u = await sql`select id, name, phone from users where id = ${body.userId}`;
      if (!u[0]) return res.status(404).json({ ok: false, error: 'Profile not found' });
      const newName = String(body.name || '').trim().slice(0, 60) || u[0].name;
      let newPhone = u[0].phone;
      if (body.phone) {
        const np = normPhone(body.phone);
        if (!np) return res.status(400).json({ ok: false, error: 'That does not look like a mobile number' });
        newPhone = np;
      }
      try {
        await sql`update users set name = ${newName}, phone = ${newPhone} where id = ${u[0].id}`;
      } catch (e) {
        return res.status(409).json({ ok: false, error: 'That number is already registered to another profile' });
      }
      // Keep memberships that carried the old number in step with the profile.
      if (newPhone !== u[0].phone) {
        await sql`update members set phone = ${newPhone} where user_id = ${u[0].id} and (phone is null or phone = ${u[0].phone})`;
      }
      return res.status(200).json({ ok: true, user: { id: u[0].id, name: newName, phone: newPhone } });
    }

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
