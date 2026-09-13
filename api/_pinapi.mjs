// GET /api/settings?area=pin&pin=110048&circle=CODE&member=UUID
// Six digits in, a real locality/district/state out - or an honest "we could
// not check that", never a guess. Behind a circle membership like every other
// read, so this is not an open proxy to someone else's API.
import { db, ensureSchema, circleByCode, isUuid, rateLimit, clientIp , requireMember} from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { lookupPin, pinError } from './_pin.mjs';

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
    const me = [_g.me];

    const bad = pinError(q.pin);
    if (bad) return res.status(400).json({ ok: false, error: bad });

    // Cached PINs cost nothing; only a first-ever lookup reaches out, and a
    // person cannot hammer someone else's free service through us.
    const gate = await rateLimit(sql, 'pin:' + clientIp(req), 40, 60);
    if (!gate.ok) return res.status(429).json({ ok: false, error: 'Too many PIN lookups - wait a minute.' });

    // A PIN India Post has never heard of is a successful answer to a fair
    // question, not a missing endpoint - 200 with unknown:true. A 404 here
    // would also log a browser console error on every such lookup.
    const out = await lookupPin(sql, q.pin);
    return res.status(200).json(out);
  } catch (e) {
    return fail(res, e);
  }
}
