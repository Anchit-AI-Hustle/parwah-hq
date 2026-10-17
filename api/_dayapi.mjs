// GET /api/settings?area=day&circle=CODE&member=UUID
// The day: muhurat computed for where this person actually lives, and the
// twelve horoscopes. Two very different kinds of thing, kept honestly apart -
// one is arithmetic, the other is written by someone else.
import { db, ensureSchema, circleByCode, isUuid , requireMember} from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { panchang, currentPeriod } from './_panchang.mjs';
import { placeOf } from './_places.mjs';
import { validTz } from './_recur.mjs';
import { horoscopeToday, signOf, SIGNS, SIGN_BASIS } from './_horoscope.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return failDb(res, e); }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }
  try {
    const q = req.query || {};
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, q.circle, q.member, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const meRow = [_g.me];
    const me = meRow[0];

    const now = new Date();
    // An unknown city falls back to the capital of their country, then to
    // a city in the phone's own timezone, and only then to Delhi.
    const place = placeOf(me.place, me.country, validTz(q.tz));
    // The day must be THEIR day, not the server's. Slicing an ISO string gives
    // the UTC date, so between midnight and 05:30 in India - and for most of
    // the evening in the Americas - that is yesterday: the wrong sunrise and,
    // worse, the wrong weekday, which is a completely different Choghadiya
    // sequence. Ask for the date in the member's own timezone.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: place.tz }).format(now);
    const p = panchang(place.lat, place.lon, new Date(day + 'T00:00:00Z'));
    const cur = p ? currentPeriod(p, now) : null;

    // Everyone's sign, so the family can read each other's - and whose
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
    return fail(res, e);
  }
}
