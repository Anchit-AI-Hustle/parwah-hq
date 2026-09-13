// WHAT A STRANGER LEARNS WHEN SOMETHING BREAKS.
//
// Every route caught its errors and sent `e.message` straight to the caller.
// Postgres messages name the schema: `duplicate key value violates unique
// constraint "users_phone_key"`, `relation "vault_docs" does not exist`,
// `column "pin_hash" of relation "users"`. Anyone who could make a request
// fail could map the database one error at a time, and a stack trace or a
// connection string can surface the same way.
//
// The real error still needs to reach a person, so it goes to the server log
// where Vercel keeps it. The caller gets a sentence they can act on and a
// short reference that ties their report to that log line.
import { randomBytes } from 'node:crypto';

export function fail(res, e, status, message) {
  const ref = randomBytes(4).toString('hex');
  try {
    console.error('[parwah ' + ref + ']', e && e.stack ? e.stack : String(e && e.message || e));
  } catch (_) {}
  return res.status(status || 500).json({
    ok: false,
    error: (message || 'Something went wrong at our end. Please try again in a moment.') + ' (ref ' + ref + ')',
    ref
  });
}

// The database being unreachable is worth its own words: it is almost always
// transient, and "try again" is genuinely the right advice.
export function failDb(res, e) {
  return fail(res, e, 503, 'We could not reach Parwah just now. Please try again in a moment.');
}
