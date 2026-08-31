// GET /api/settings?area=pin&pin=110048&circle=CODE&member=UUID
// Six digits in, a real locality/district/state out — or an honest "we could
// not check that", never a guess. Behind a circle membership like every other
// read, so this is not an open proxy to someone else's API.
import { db, ensureSchema, circleByCode, isUuid, rateLimit, clientIp } from './_db.mjs';
import { lookupPin, pinError } from './_pin.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }
  try {
    const q = req.query || {};
    const circle = await circleByCode(sql, q.circle);
    if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
    if (!isUuid(q.member)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const me = await sql`select id from members where id = ${q.member} and circle_id = ${circle.id}`;
    if (!me[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });

    const bad = pinError(q.pin);
    if (bad) return res.status(400).json({ ok: false, error: bad });

    // Cached PINs cost nothing; only a first-ever lookup reaches out, and a
    // person cannot hammer someone else's free service through us.
    const gate = await rateLimit(sql, 'pin:' + clientIp(req), 40, 60);
    if (!gate.ok) return res.status(429).json({ ok: false, error: 'Too many PIN lookups — wait a minute.' });

    // A PIN India Post has never heard of is a successful answer to a fair
    // question, not a missing endpoint — 200 with unknown:true. A 404 here
    // would also log a browser console error on every such lookup.
    const out = await lookupPin(sql, q.pin);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
