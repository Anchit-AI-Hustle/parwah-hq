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
// Six digits, because this is typed by a 70-year-old on a phone, often in a
// hurry. Six digits with a hard lockout is stronger in practice than eight
// characters written on a sticky note next to the handset.
export const PIN_LEN = 6;

// The ones a thief tries first. Blocking them costs a person nothing and
// removes the handful of PINs that would otherwise be guessed immediately.
const WEAK = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555', '666666',
  '777777', '888888', '999999', '123456', '654321', '123123', '112233',
  '121212', '789456', '159753', '147258', '102030', '098765', '012345'
]);

export function pinError(pin) {
  const p = String(pin == null ? '' : pin);
  if (!/^[0-9]+$/.test(p)) return 'Your PIN is ' + PIN_LEN + ' numbers.';
  if (p.length !== PIN_LEN) return 'Your PIN is ' + PIN_LEN + ' numbers, you typed ' + p.length + '.';
  if (WEAK.has(p)) return 'That PIN is one of the first anyone would try. Please pick another.';
  // A run like 456789, forwards or backwards, is the same problem.
  let up = true, down = true;
  for (let i = 1; i < p.length; i++) {
    if (+p[i] !== +p[i - 1] + 1) up = false;
    if (+p[i] !== +p[i - 1] - 1) down = false;
  }
  if (up || down) return 'That PIN is one of the first anyone would try. Please pick another.';
  return null;
}

// scrypt, not a bare hash: a six-digit PIN has a million possibilities, so
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
// Five tries, then fifteen minutes. Enough that a real person who has
// forgotten which of two PINs they used gets there; far too slow to walk
// through a million.
export const MAX_TRIES = 5;
export const LOCK_MINUTES = 15;
export function lockMessage(until) {
  const mins = Math.max(1, Math.ceil((new Date(until) - Date.now()) / 60000));
  return 'Too many wrong PINs. Try again in ' + mins + (mins === 1 ? ' minute' : ' minutes')
    + ', or ask someone already in your family to let you back in.';
}

// ---- the session --------------------------------------------------------
// The token is random and long. Only its hash is stored, so a copy of the
// database is not a set of working logins.
export function newToken() { return randomBytes(32).toString('base64url'); }
export function tokenHash(t) { return createHash('sha256').update(String(t)).digest('hex'); }
export const SESSION_DAYS = 90;
export function looksLikeToken(t) { return typeof t === 'string' && /^[A-Za-z0-9_-]{40,90}$/.test(t); }
