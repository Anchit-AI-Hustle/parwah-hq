// BASIC CHECKS, ONE RULE EACH, USED BY THE SERVER AND MIRRORED IN THE APP.
//
// A name of "....", a birthday in 2031, a spending cap of minus five rupees
// and a "link" that is a sentence were all accepted somewhere, and each one
// turned into something wrong later: a family member nobody could find, a
// rashi from a date that has not happened, a cap that capped nothing. Phone
// numbers, PIN codes and emails already had their own rules (_db.mjs,
// _pin.mjs, _waitlist.mjs); these are the rest.
//
// Dependency-free, so the deploy gate can unit-test it on a fresh clone.

export const NAME_MAX = 60;

// A person's or a family's name: words, in any script, with the odd dot,
// hyphen or apostrophe (D'Souza, Anne-Marie, Dr. Mehra). Never only symbols
// or numbers, never a phone number or an email typed into the wrong box.
export function cleanName(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}
export function nameError(v, what) {
  const w = what || 'name';
  const n = cleanName(v);
  if (!n) return 'Write the ' + w + '.';
  if (n.length > NAME_MAX) return 'That ' + w + ' is longer than ' + NAME_MAX + ' letters - please shorten it.';
  if (/@/.test(n)) return 'That looks like an email address - write the ' + w + ' instead.';
  if ((n.match(/\d/g) || []).length >= 5) return 'That looks like a phone number - write the ' + w + ' instead.';
  if (!/\p{L}/u.test(n)) return 'A ' + w + ' needs letters, not only numbers or symbols.';
  if (/[<>{}\[\]\\|^~`$#%*=+_]/.test(n)) return 'A ' + w + ' can have letters, spaces, dots, hyphens and apostrophes.';
  return null;
}

// A date of birth: a real calendar date, not in the future, not before 1900.
// "today" is passed in so tests (and the family's own time zone) decide it.
export function dobError(v, today) {
  const d = String(v == null ? '' : v).trim();
  if (!d) return null;                       // not given is allowed
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return 'Pick the date of birth from the calendar.';
  const dt = new Date(d + 'T00:00:00Z');
  if (isNaN(dt) || dt.toISOString().slice(0, 10) !== d) return 'That date does not exist - please check it.';
  const t = String(today || new Date().toISOString().slice(0, 10));
  if (d > t) return 'A date of birth cannot be in the future.';
  if (+m[1] < 1900) return 'Please check the year - that is before 1900.';
  return null;
}

// Rupees, as a whole number above zero. Empty is allowed where the amount is
// optional; the caller says so.
export function amountError(v, opts) {
  const o = opts || {};
  const s = String(v == null ? '' : v).replace(/[,\s₹]/g, '');
  if (!s) return o.required ? 'Write the amount in rupees.' : null;
  if (!/^\d+$/.test(s)) return 'Write the amount as a whole number of rupees, like 5000.';
  const n = Number(s);
  if (n <= 0) return 'The amount has to be more than ₹0.';
  if (o.max && n > o.max) return 'That is more than ₹' + o.max.toLocaleString('en-IN') + ' - please check it.';
  return null;
}
export function amountOf(v) {
  const s = String(v == null ? '' : v).replace(/[,\s₹]/g, '');
  return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null;
}

// A link someone pastes: http or https, with a real-looking host.
export function urlError(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch (e) { return 'That is not a link - paste one that starts with https://'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Only web links (https://) can be shared here.';
  if (!/\.[a-z]{2,}$/i.test(u.hostname)) return 'That link does not have a real web address in it.';
  return null;
}

// How many people: a whole number from 1 to the cap.
export function countError(v, max) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (!/^\d+$/.test(s) || Number(s) < 1) return 'Write how many people as a number, 1 or more.';
  if (Number(s) > (max || 500)) return 'That is more than ' + (max || 500) + ' people - please check it.';
  return null;
}
