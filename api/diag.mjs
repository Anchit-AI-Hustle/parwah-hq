// Diagnostics, behind one function: the Hobby plan allows 12 serverless
// functions, so related endpoints share a router rather than each burning a
// slot. Underscore-prefixed files are modules, not routes.
//   GET /api/diag            → liveness + environment presence
//   GET /api/diag?probe=db   → full end-to-end database selftest
//   GET /api/diag?probe=ekta → Ekta provider/cascade selftest
//   GET /api/diag?probe=day  → muhurat arithmetic vs almanac + horoscope source
//   GET /api/diag?probe=pin  → PIN-code parser + a live India Post lookup
import { db, rateLimit, clientIp } from './_db.mjs';
import health from './_health.mjs';
import selftest from './_selftest.mjs';
import ektaSelftest from './_ektaselftest.mjs';
import daySelftest from './_dayselftest.mjs';
import pinSelftest from './_pinselftest.mjs';

// These probes write to the production database — the db one creates a circle,
// exercises every table and deletes it again — and they report the real error
// text, which is exactly what makes them useful to us and what makes them
// worth reading to somebody else.
//
// Set DIAG_TOKEN in the project's environment and they answer only to a
// caller who has it (ops/verify-live.sh passes it). Without one they stay
// open, because the deploy gate depends on them, but a caller cannot run more
// than a handful an hour.
const PER_HOUR = 8;

export default async function handler(req, res) {
  const probe = String((req.query && req.query.probe) || '');
  const want = process.env.DIAG_TOKEN;
  if (want) {
    const given = String((req.query && req.query.token) || req.headers['x-diag-token'] || '');
    // Length-independent compare is overkill for a diagnostics gate; being
    // wrong about it is not.
    if (given !== want) return res.status(404).json({ ok: false, error: 'Not found' });
  } else {
    try {
      const allowed = await rateLimit(db(), 'diag', clientIp(req) + ':' + probe, PER_HOUR, 3600);
      if (!allowed) {
        return res.status(429).json({ ok: false,
          error: 'Diagnostics are limited to ' + PER_HOUR + ' runs an hour from one address. Set DIAG_TOKEN to raise it.' });
      }
    } catch (e) { /* a limiter that cannot reach the database never blocks a deploy */ }
  }
  if (probe === 'db') return selftest(req, res);
  if (probe === 'ekta') return ektaSelftest(req, res);
  if (probe === 'day') return daySelftest(req, res);
  if (probe === 'pin') return pinSelftest(req, res);
  return health(req, res);
}
