// WHAT AN INDIAN ID LOOKS LIKE — one description of each, used by the form as
// you type AND by the server before anything is stored.
//
// The vault used to accept any characters and complain once, at save time.
// That is how a PAN gets typed into the Aadhaar box: nothing about the field
// said it wanted twelve digits until it was too late. DigiLocker and every
// bank form solve this the same way — the field knows its own shape, groups
// the characters, counts them out loud, and recognises when you have clearly
// typed a different document.
//
// No imports, no network: the rules are the same on both sides, and testable
// on a fresh clone before npm install.

function digits(v) { return String(v || '').replace(/\D/g, ''); }

// Verhoeff — the checksum every real Aadhaar number satisfies. A typo in any
// single digit fails it, so the family is told at once instead of discovering
// a wrong number at a hospital counter.
const V_D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0]
];
const V_P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]
];
export function verhoeffOk(num) {
  let c = 0;
  const rev = String(num).split('').reverse();
  for (let i = 0; i < rev.length; i++) {
    const n = Number(rev[i]);
    if (!(n >= 0 && n <= 9)) return false;
    c = V_D[c][V_P[i % 8][n]];
  }
  return c === 0;
}

// Each document, described once.
//   chars    what a keystroke may be — everything else is dropped as typed
//   group    where the spaces go, so twelve digits are readable
//   len      how many characters when it is complete (after separators)
//   example  shown in the field
//   inputmode  so a phone raises the right keyboard
export const DOC_ID = {
  aadhaar: {
    label: 'Aadhaar', chars: /[0-9]/, group: [4, 4, 4], len: 12, sep: ' ',
    example: '1234 5678 9012', inputmode: 'numeric',
    hint: '12 digits, as printed on the card.'
  },
  pan: {
    label: 'PAN card', chars: /[A-Z0-9]/, group: [5, 4, 1], len: 10, sep: ' ',
    example: 'ABCDE 1234 F', inputmode: 'text', upper: true,
    hint: 'Five letters, four digits, one letter.'
  },
  passport: {
    label: 'Passport', chars: /[A-Z0-9]/, group: [1, 7], len: 8, sep: ' ',
    example: 'A 1234567', inputmode: 'text', upper: true,
    hint: 'One letter, then seven digits.'
  },
  dl: {
    label: 'Driving licence', chars: /[A-Z0-9]/, group: [2, 2, 4, 7], len: 15, sep: '-',
    example: 'DL-04-2011-0012345', inputmode: 'text', upper: true,
    hint: 'State code, RTO, year of issue, then the number.'
  },
  voter: {
    label: 'Voter ID', chars: /[A-Z0-9]/, group: [3, 7], len: 10, sep: ' ',
    example: 'ABC 1234567', inputmode: 'text', upper: true,
    hint: 'Three letters, then seven digits (the EPIC number).'
  }
};

// Strip a typed value back to the bare characters that count.
export function bare(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Put the separators back, as far as the person has typed. Partial input is
// grouped too — that is the whole point of doing it while they type.
export function format(kind, raw) {
  const spec = DOC_ID[kind];
  const v = bare(raw);
  if (!spec) return v;
  const out = [];
  let i = 0;
  for (const size of spec.group) {
    if (i >= v.length) break;
    out.push(v.slice(i, i + size));
    i += size;
  }
  if (i < v.length) out.push(v.slice(i));          // more than expected: show it all
  return out.join(spec.sep);
}

// WHAT A PAN ACTUALLY ENCODES — free, offline, and published by the Income Tax
// Department, unlike the "verification APIs" that all cost money and require a
// licence. Two of the ten characters carry real meaning:
//
//   4th  the holder's TYPE. P is an individual, C a company, H a HUF, and so on.
//   5th  the first letter of the holder's SURNAME (or of the entity's name).
//
// Neither proves the PAN was issued — only the Income Tax Department can say
// that — but together they catch the mistakes families actually make: filing a
// company's PAN under a person, or mistyping a letter. The 10th character is a
// check digit whose algorithm the department has never published, so this file
// does NOT pretend to verify it.
export const PAN_HOLDER = {
  P: 'an individual', C: 'a company', H: 'a Hindu Undivided Family', F: 'a firm',
  A: 'an association of persons', T: 'a trust', B: 'a body of individuals',
  L: 'a local authority', J: 'an artificial juridical person', G: 'a government body'
};

// Indian names are not uniformly "the last word is the surname" — plenty of
// people carry initials, or a given name last. So a mismatch is reported as
// something to look at, never as a failure, and never blocks a save.
export function panFacts(raw, holderName) {
  const v = bare(raw);
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)) return null;
  const type = v[4 - 1], initial = v[5 - 1];
  const words = String(holderName || '').trim().split(/\s+/).filter(Boolean);
  const surname = words.length > 1 ? words[words.length - 1] : (words[0] || '');
  const known = Object.prototype.hasOwnProperty.call(PAN_HOLDER, type);
  return {
    holderCode: type,
    holder: known ? PAN_HOLDER[type] : null,
    isIndividual: type === 'P',
    initial,
    surname: surname || null,
    // null when we have no name to compare against
    initialMatches: surname ? (surname[0].toUpperCase() === initial) : null
  };
}

// Does every character belong in this document at all? A letter is not
// progress towards twelve digits, and saying "11 of 12" about "12345678ABC"
// is worse than saying nothing.
export function fitsChars(kind, raw) {
  const spec = DOC_ID[kind];
  if (!spec) return true;
  const v = bare(raw);
  for (const c of v) if (!spec.chars.test(c)) return false;
  return true;
}

// What to say under the field WHILE they type. Never an error until they have
// typed enough to be wrong — counting up to twelve is not a mistake.
export function progress(kind, raw) {
  const spec = DOC_ID[kind];
  const v = bare(raw);
  if (!v) return { state: 'empty', text: spec ? spec.hint : '' };
  if (!spec) return v.length < 3 ? { state: 'short', text: 'A few more characters.' }
                                 : { state: 'ok', text: 'Saved as you typed it.' };
  const chk = checkNumber(kind, v);
  if (chk.ok) return { state: 'ok', text: '✓ ' + spec.label + ' looks right.' };
  if (!fitsChars(kind, v)) {
    return { state: 'bad',
      text: 'An ' + spec.label + ' does not contain those characters — ' + spec.hint };
  }
  if (v.length < spec.len) {
    return { state: 'typing',
      text: v.length + ' of ' + spec.len + ' — ' + spec.hint };
  }
  return { state: 'bad', text: chk.why };
}

// "You are in the Aadhaar box but that is a PAN." Only ever offered when the
// value is a complete, valid something-else — never on a half-typed one.
export function looksLike(raw, exceptKind) {
  const v = bare(raw);
  if (!v) return null;
  for (const k of Object.keys(DOC_ID)) {
    if (k === exceptKind) continue;
    if (checkNumber(k, v).ok && bare(v).length === DOC_ID[k].len) return k;
  }
  return null;
}

// Shape check for the number the family typed. Returns { ok, why, last4 } —
// `why` is written for a person, not a developer. This is what the server
// trusts; the client only mirrors it so nobody is surprised at save time.
export function checkNumber(kind, raw) {
  const v = bare(raw);
  if (!v) return { ok: true, why: null, last4: null };            // number is optional
  const last4 = v.slice(-4);
  if (kind === 'aadhaar') {
    const d = digits(v);
    if (d.length !== 12) return { ok: false, why: 'An Aadhaar number has 12 digits — please check it' };
    if (d[0] === '0' || d[0] === '1') return { ok: false, why: 'An Aadhaar number never starts with 0 or 1 — please check it' };
    if (!verhoeffOk(d)) return { ok: false, why: 'That Aadhaar number does not add up — one digit is likely mistyped' };
    return { ok: true, why: null, last4: d.slice(-4) };
  }
  if (kind === 'pan') {
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)) return { ok: false, why: 'A PAN looks like ABCDE1234F — five letters, four digits, one letter' };
    return { ok: true, why: null, last4 };
  }
  if (kind === 'passport') {
    if (!/^[A-PR-WYZ][0-9]{7}$/.test(v)) return { ok: false, why: 'An Indian passport number is one letter followed by seven digits' };
    return { ok: true, why: null, last4 };
  }
  if (kind === 'dl') {
    if (!/^[A-Z]{2}[0-9]{2}[0-9]{4}[0-9]{7}$/.test(v) && !/^[A-Z]{2}[0-9]{11,13}$/.test(v))
      return { ok: false, why: 'A driving licence looks like DL0420110012345 — state code, RTO, year, number' };
    return { ok: true, why: null, last4 };
  }
  if (kind === 'voter') {
    if (!/^[A-Z]{3}[0-9]{7}$/.test(v)) return { ok: false, why: 'A voter ID (EPIC) is three letters followed by seven digits' };
    return { ok: true, why: null, last4 };
  }
  if (v.length < 3) return { ok: false, why: 'That reference looks too short' };
  return { ok: true, why: null, last4 };
}
