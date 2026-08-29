// POST /api/circle — create a care circle or join one with its code.
import { db, ensureSchema, makeCode, circleByCode } from './_db.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

  const { action, circleName, code, memberName, role } = req.body || {};
  const name = String(memberName || '').trim().slice(0, 60);
  const r = role === 'parent' ? 'parent' : 'family';
  if (!name) return res.status(400).json({ ok: false, error: 'Please tell us your name' });

  try {
    if (action === 'create') {
      const cname = String(circleName || '').trim().slice(0, 60) || (name + "'s family");
      let circle = null;
      for (let i = 0; i < 5 && !circle; i++) {
        const c = makeCode();
        try {
          const rows = await sql`insert into circles (code, name) values (${c}, ${cname}) returning id, code, name`;
          circle = rows[0];
        } catch (e) { /* code collision — retry with a new code */ }
      }
      if (!circle) return res.status(500).json({ ok: false, error: 'Could not create the circle, please try again' });
      const m = await sql`insert into members (circle_id, name, role) values (${circle.id}, ${name}, ${r}) returning id`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${m[0].id}, 'join', ${name + ' created the circle'})`;
      return res.status(201).json({ ok: true, code: circle.code, circleName: circle.name, memberId: m[0].id, role: r });
    }

    if (action === 'join') {
      const circle = await circleByCode(sql, code);
      if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
      const m = await sql`insert into members (circle_id, name, role) values (${circle.id}, ${name}, ${r}) returning id`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${m[0].id}, 'join', ${name + ' joined the circle'})`;
      return res.status(200).json({ ok: true, code: circle.code, circleName: circle.name, memberId: m[0].id, role: r });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
