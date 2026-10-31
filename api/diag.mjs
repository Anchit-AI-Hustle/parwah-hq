// Diagnostics, behind one function: the Hobby plan allows 12 serverless
// functions, so related endpoints share a router rather than each burning a
// slot. Underscore-prefixed files are modules, not routes.
//   GET /api/diag            → liveness + environment presence
//   GET /api/diag?probe=db   → full end-to-end database selftest
//   GET /api/diag?probe=ekta → Ekta provider/cascade selftest
//   GET /api/diag?probe=day  → muhurat arithmetic vs almanac + horoscope source
//   GET /api/diag?probe=pin  → PIN-code parser + a live India Post lookup
import { timingSafeEqual } from 'node:crypto';
import health from './_health.mjs';
import selftest from './_selftest.mjs';
import ektaSelftest from './_ektaselftest.mjs';
import daySelftest from './_dayselftest.mjs';
import pinSelftest from './_pinselftest.mjs';

// EVERY ONE OF THESE WAS OPEN TO THE WORLD, AND EVERY ONE WRITES.
// ?probe=db creates a circle, members, chats, vault documents and coin
// ledger rows on each hit, then deletes them; the bare health check inserts
// and deletes a waitlist row; and on failure they all printed the raw
// Postgres error, which names the schema one table at a time. Anyone who
// found the URL could hammer the database and map it from the errors.
//
// They need the deploy secret now. ops/verify-live.sh sends it, and the
// bare /api/diag stays open as a liveness check that touches nothing.
// The key comes in the X-Diag-Key header only: in ?key= it was written
// into every access log on the way. Compared in constant time, so the reply
// time cannot give it away one character at a time.
function authorised(req) {
  const secret = process.env.PARWAH_DIAG_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const given = String((req.headers && (req.headers['x-diag-key'] || req.headers['X-Diag-Key'])) || '');
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const probe = String((req.query && req.query.probe) || '');
  if (!probe) {
    // Liveness only: is the function warm and is the environment wired.
    // No database, nothing written, safe to leave open.
    return res.status(200).json({
      ok: true,
      service: 'parwah',
      time: new Date().toISOString(),
      db_configured: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
      probes: 'add ?probe=db|day|pin|ekta, with the diagnostics key in the X-Diag-Key header'
    });
  }
  if (!authorised(req)) {
    return res.status(403).json({ ok: false,
      error: process.env.PARWAH_DIAG_SECRET || process.env.CRON_SECRET
        ? 'These probes write to the database, so they need the diagnostics key.'
        : 'These probes write to the database and stay off until PARWAH_DIAG_SECRET is set on the server.' });
  }
  if (probe === 'db') return selftest(req, res);
  if (probe === 'ekta') return ektaSelftest(req, res);
  if (probe === 'day') return daySelftest(req, res);
  if (probe === 'pin') return pinSelftest(req, res);
  if (probe === 'health') return health(req, res);
  return res.status(400).json({ ok: false, error: 'Unknown probe' });
}
