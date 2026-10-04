// REAL SIGN-IN, WITHOUT AN SMS PROVIDER.
//
// A phone number was the whole key: type one that exists and you were in,
// as that person, with their family's vault. There was no second factor and
// no session - every later request proved who it was by sending a member
// UUID the server handed out to everyone in the circle.
//
// SMS one-time codes need a provider and a budget, and were blocking this
// indefinitely. Two things replace them, and neither needs a third party:
//
//   a PIN the person chooses, so knowing a number is not enough; and
//   a session token, so no request ever again identifies its caller by a
//   value other people can see.
//
// Recovery is the part SMS usually buys, and here the family is a better
// trust anchor than a telco: someone already in your circle vouches for
// you. That is the product's own shape - a circle of people who know each
// other - doing a job it is better suited to than a text message.
//
// node:crypto is built into the runtime, so the deploy gate can unit-test
// all of this on a fresh clone, before npm install.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

// ---- the PIN ------------------------------------------------------------
// One kind of secret, the same for everyone: a PIN of exactly 4 numbers.
// Quick to type on a phone in a hurry, the same shape a bank card uses, and
// nothing to choose between. Five wrong tries lock the number for fifteen
// minutes, so ten thousand possibilities is far more than anyone can walk.
export const PIN_LEN = 4;
// Every secret set before PINs were exactly 4 numbers was a PIN of 4 to 6
// numbers or a password. users.secret_v says which rules a secret was chosen
// under; anything older than this signs in once with what it has, then
// chooses a 4-number PIN before any session is issued.
export const SECRET_V = 3;

// The ones a thief tries first. Blocking them costs a person nothing and
// removes the handful that would otherwise be guessed immediately.
const WEAK = new Set([
  '1234', '4321', '1212', '1122', '2580', '0852', '1004', '2000', '2020',
  '6969', '1313', '2468', '1357', '0123', '9876', '5683', '7777', '1010',
  '2121', '1111', '0000', '2001', '1990', '1230', '0007'
]);

// One rule for choosing, used by sign-up, the first PIN of an old account,
// and the change from an older PIN or password. Signing in with an existing
// secret is never checked against it: that is verifyPin's job, so a person
// with an older secret can still prove who they are once.
export function pinError(secret) {
  const p = String(secret == null ? '' : secret);
  if (!p) return 'Choose a PIN of 4 numbers.';
  if (!/^[0-9]+$/.test(p)) return 'A PIN is numbers only - 4 of them.';
  if (p.length !== PIN_LEN) return 'A PIN is exactly 4 numbers, and you typed ' + p.length + '.';
  if (WEAK.has(p) || /^(\d)\1+$/.test(p)) return 'That PIN is one of the first anyone would try. Please pick another.';
  // A run like 3456 or 9876, forwards or backwards, is the same problem.
  let up = true, down = true;
  for (let i = 1; i < p.length; i++) {
    if (+p[i] !== +p[i - 1] + 1) up = false;
    if (+p[i] !== +p[i - 1] - 1) down = false;
  }
  if (up || down) return 'That PIN is one of the first anyone would try. Please pick another.';
  return null;
}

// scrypt, not a bare hash: a 4-number PIN has ten thousand possibilities, so
// the only thing standing between a stolen database and every PIN in it is
// how long each guess takes.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export function hashPin(pin, salt) {
  const s = salt || randomBytes(16).toString('hex');
  const key = scryptSync(String(pin), s, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { salt: s, hash: key.toString('hex') };
}
export function verifyPin(pin, salt, hash) {
  if (!salt || !hash) return false;
  const a = Buffer.from(hashPin(pin, salt).hash, 'hex');
  const b = Buffer.from(String(hash), 'hex');
  // Compare in constant time, so the answer cannot be found one digit at a
  // time by watching how long the reply takes.
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- lockout ------------------------------------------------------------
// Five tries, then fifteen minutes, per mobile number. Enough that a real
// person who has forgotten which of two PINs they used gets there; far too
// slow to walk through even ten thousand.
export const MAX_TRIES = 5;
export const LOCK_MINUTES = 15;
export function lockMessage(until) {
  const mins = Math.max(1, Math.ceil((new Date(until) - Date.now()) / 60000));
  return 'Too many wrong tries. Try again in ' + mins + (mins === 1 ? ' minute' : ' minutes')
    + ', or ask someone already in your family to let you back in.';
}

// ---- the session --------------------------------------------------------
// The token is random and long. Only its hash is stored, so a copy of the
// database is not a set of working logins.
export function newToken() { return randomBytes(32).toString('base64url'); }
export function tokenHash(t) { return createHash('sha256').update(String(t)).digest('hex'); }
export const SESSION_DAYS = 90;
export function looksLikeToken(t) { return typeof t === 'string' && /^[A-Za-z0-9_-]{40,90}$/.test(t); }
