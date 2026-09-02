// GET /api/settings?area=day&circle=CODE&member=UUID
// The day: muhurat computed for where this person actually lives, and the
// twelve horoscopes. Two very different kinds of thing, kept honestly apart —
// one is arithmetic, the other is written by someone else.
import { db, ensureSchema, circleByCode, isUuid, serverError } from './_db.mjs';
import { panchang, currentPeriod } from './_panchang.mjs';
import { placeOf } from './_places.mjs';
import { horoscopeToday, signOf, SIGNS, SIGN_BASIS } from './_horoscope.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return serverError(res, e, 'dayapi'); }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }
  try {
    const q = req.query || {};
    const circle = await circleByCode(sql, q.circle);
    if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
    if (!isUuid(q.member)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const meRow = await sql`select id, name, place, dob from members where id = ${q.member} and circle_id = ${circle.id}`;
    if (!meRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const me = meRow[0];

    const now = new Date();
    const place = placeOf(me.place);
    // The day must be THEIR day, not the server's. Slicing an ISO string gives
    // the UTC date, so between midnight and 05:30 in India — and for most of
    // the evening in the Americas — that is yesterday: the wrong sunrise and,
    // worse, the wrong weekday, which is a completely different Choghadiya
    // sequence. Ask for the date in the member's own timezone.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: place.tz }).format(now);
    const p = panchang(place.lat, place.lon, new Date(day + 'T00:00:00Z'));
    const cur = p ? currentPeriod(p, now) : null;

    // Everyone's sign, so the family can read each other's — and whose
    // birthday is unknown, so it can be filled in.
    const members = await sql`select id, name, dob from members where circle_id = ${circle.id} order by created_at`;
    const people = members.map(m => {
      const s = signOf(m.dob);
      return { id: m.id, name: m.name, sign: s ? s.k : null, signName: s ? s.en : null, hasDob: !!m.dob };
    });

    const horo = await horoscopeToday(sql, day);
    const mySign = signOf(me.dob);

    return res.status(200).json({
      ok: true, day, place, tz: place.tz,
      panchang: p, current: cur,
      mySign: mySign ? { key: mySign.k, name: mySign.en, hi: mySign.hi } : null,
      people, horoscope: horo, signBasis: SIGN_BASIS,
      signs: SIGNS.map(s => ({ key: s.k, name: s.en, hi: s.hi }))
    });
  } catch (e) {
    return serverError(res, e, 'dayapi');
  }
}
