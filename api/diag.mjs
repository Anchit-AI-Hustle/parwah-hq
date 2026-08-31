// Diagnostics, behind one function: the Hobby plan allows 12 serverless
// functions, so related endpoints share a router rather than each burning a
// slot. Underscore-prefixed files are modules, not routes.
//   GET /api/diag            → liveness + environment presence
//   GET /api/diag?probe=db   → full end-to-end database selftest
//   GET /api/diag?probe=ekta → Ekta provider/cascade selftest
//   GET /api/diag?probe=day  → muhurat arithmetic vs almanac + horoscope source
import health from './_health.mjs';
import selftest from './_selftest.mjs';
import ektaSelftest from './_ektaselftest.mjs';
import daySelftest from './_dayselftest.mjs';

export default async function handler(req, res) {
  const probe = String((req.query && req.query.probe) || '');
  if (probe === 'db') return selftest(req, res);
  if (probe === 'ekta') return ektaSelftest(req, res);
  if (probe === 'day') return daySelftest(req, res);
  return health(req, res);
}
