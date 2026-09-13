// Phone rules - deliberately DEPENDENCY-FREE.
// These are pure functions, and the unit test that covers them must be
// runnable on a fresh clone with nothing installed. Keeping them out of
// _db.mjs means the test never drags in the database driver.
// Country-code rules: the country code lives SEPARATELY from the local
// number, and the local number is validated against that country's shape.
// Strictest for India (the home market); pragmatic ranges elsewhere so real
// numbers are never wrongly rejected.
export const PHONE_CC = {
  '+91':  { min: 10, max: 10, re: /^[6-9]\d{9}$/, name: 'India' },
  '+1':   { min: 10, max: 10, re: /^[2-9]\d{9}$/, name: 'USA / Canada' },
  '+44':  { min: 9,  max: 10, name: 'UK' },
  '+971': { min: 8,  max: 9,  name: 'UAE' },
  '+61':  { min: 9,  max: 9,  name: 'Australia' },
  '+65':  { min: 8,  max: 8,  re: /^[3689]\d{7}$/, name: 'Singapore' },
  '+49':  { min: 7,  max: 11, name: 'Germany' },
  '+81':  { min: 9,  max: 10, name: 'Japan' },
  '+86':  { min: 11, max: 11, name: 'China' },
  '+92':  { min: 10, max: 10, name: 'Pakistan' },
  '+880': { min: 10, max: 10, name: 'Bangladesh' },
  '+977': { min: 10, max: 10, name: 'Nepal' },
  '+94':  { min: 9,  max: 9,  name: 'Sri Lanka' }
};

// Parse + validate a phone. `v` may be a bare local number (then `cc`
// applies, default +91) or a full +international string (cc read from it).
// Returns { e164, cc, local } or null when the number fails its country's
// validation rules.
export function normPhone(v, cc) {
  const raw = String(v || '').replace(/[()\-\s.]/g, '');
  let code = null, local = null;
  if (raw.startsWith('+')) {
    const digits = raw.slice(1);
    if (!/^\d{6,15}$/.test(digits)) return null;
    for (const k of Object.keys(PHONE_CC).sort((a, b) => b.length - a.length)) {
      if (raw.startsWith(k)) { code = k; local = raw.slice(k.length); break; }
    }
    if (!code) {
      // country we don't have rules for: split greedily, keep a sane local part
      for (const n of [3, 2, 1]) {
        const l = digits.slice(n);
        if (l.length >= 6 && l.length <= 12) { code = '+' + digits.slice(0, n); local = l; break; }
      }
      if (!code) return null;
      return { e164: code + local, cc: code, local };
    }
  } else {
    if (!/^\d{4,14}$/.test(raw)) return null;
    code = (cc && /^\+\d{1,3}$/.test(String(cc))) ? String(cc) : '+91';
    local = raw;
  }
  const rule = PHONE_CC[code];
  if (rule) {
    if (local.length < rule.min || local.length > rule.max) return null;
    if (rule.re && !rule.re.test(local)) return null;
  } else if (local.length < 6 || local.length > 12) return null;
  return { e164: code + local, cc: code, local };
}

// Human message when a number fails: names the country and its shape.
export function phoneError(cc) {
  const r = PHONE_CC[cc && /^\+\d{1,3}$/.test(cc) ? cc : '+91'] || null;
  if (!r) return 'That does not look like a valid number for that country code';
  const len = r.min === r.max ? r.min + ' digits' : r.min + '-' + r.max + ' digits';
  return 'A ' + r.name + ' number has ' + len + ' after ' + 'the country code - please check it';
}
