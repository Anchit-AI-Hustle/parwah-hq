// EQUAL STANDING: the rules, with no database and no imports, so the unit
// test runs before npm install (site/tests/standingtest.mjs).
//
// Every member of a family is heard equally. A few doors are for the
// grown-ups only (who comes in, who is let back in, who is removed), and
// this file holds the ONE rule that says who is a grown-up. Every gate
// calls isAdultMember; nobody writes a second rule.

export const ADULT_AGE = 18;

// "Today" where most families are: India, UTC+5:30. A clock may be handed in.
export function todayIn(nowMs) {
  return new Date((nowMs == null ? Date.now() : nowMs) + 19800000).toISOString().slice(0, 10);
}
function ymd(dob) {
  if (dob instanceof Date) {
    if (isNaN(dob)) return '';
    const z = n => String(n).padStart(2, '0');
    return dob.getFullYear() + '-' + z(dob.getMonth() + 1) + '-' + z(dob.getDate());
  }
  return String(dob || '').slice(0, 10);
}
// Whole years on a day, or null when no date of birth is on file.
export function ageOn(dob, today) {
  const d = ymd(dob);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = String(today || todayIn());
  let age = +t.slice(0, 4) - +d.slice(0, 4);
  if (t.slice(5) < d.slice(5)) age--;
  return age;
}

// A role or a relation that only a grown-up holds.
const ADULT_RELATIONS = new Set(['father', 'mother', 'grandfather', 'grandmother', 'daughter-in-law', 'son-in-law']);

// THE ONE RULE. It reads three things about a member, in this order:
//   1. the date of birth, when there is one: it decides, whatever else says;
//   2. with no date of birth, what the family said: marked as a child
//      (is_child), or "not an adult" (adult_confirmed false), is a minor;
//   3. "is an adult" (adult_confirmed true), or a family role only a
//      grown-up holds, is an adult.
// 'adult' | 'minor' | 'unsure'. 'unsure' is no date of birth and nothing
// else to go on: such a member may act for everyday things, and is refused
// at the strict gates (letting someone back in, the gravest choices).
// The same rule in SQL, for a query that must not reach a child:
//   (case when m.dob is not null then m.dob > current_date - interval '18 years'
//         else (m.is_child or m.adult_confirmed is false) end)
// m: { dob, is_child, adult_confirmed, role, relation, spouse_id, has_child }
export function standingOf(m, today) {
  if (!m) return 'minor';
  const age = ageOn(m.dob, today);
  if (age !== null) return age >= ADULT_AGE ? 'adult' : 'minor';
  if (m.is_child === true || m.isChild === true || m.adult_confirmed === false) return 'minor';
  if (m.adult_confirmed === true) return 'adult';
  if (m.role === 'parent' || ADULT_RELATIONS.has(String(m.relation || '')) || m.spouse_id || m.has_child) return 'adult';
  return 'unsure';
}
// A child or a teenager, by the one rule. Nobody at all is not a child.
export function isMinor(m, today) { return !!m && standingOf(m, today) === 'minor'; }
// Under 18 by DATE OF BIRTH, and nothing less: the only "child" that lets
// one adult act alone about a person who is on Parwah.
export function minorByBirth(m, today) {
  const age = m ? ageOn(m.dob, today) : null;
  return age !== null && age < ADULT_AGE;
}

// THE SINGLE ADULT RULE. strict is for letting someone back in after a
// forgotten PIN: there, not knowing is a no. Everywhere else a member whose
// age nobody has written down may act, and an adult is asked to confirm.
// Someone who is not on Parwah, or who has passed away, never acts.
export function isAdultMember(m, today, { strict = false } = {}) {
  if (!m || m.remembered) return false;
  if (m.user_id === null || m.on_app === false) return false;
  const s = standingOf(m, today);
  return strict ? s === 'adult' : s !== 'minor';
}
// The grown-ups of a family who can act: on Parwah, with us, not a child.
export function actingAdults(members, today) {
  return (members || []).filter(m => isAdultMember(m, today));
}

// ---- the PIN lock, escalating ------------------------------------------
// Five wrong tries lock for 15 minutes, then 1 hour, then 24 hours, then
// 24 hours each time. Seven days with no lock and it starts again at 15.
export const LOCK_STEPS_MIN = [15, 60, 1440];
export const LOCK_DECAY_DAYS = 7;
// level: how many locks in a row so far. lastEndMs: when the last one ended.
export function lockPlan(level, lastEndMs, nowMs) {
  let lv = Math.max(0, Number(level) || 0);
  if (lastEndMs && nowMs - lastEndMs >= LOCK_DECAY_DAYS * 86400000) lv = 0;
  lv += 1;
  return { level: lv, minutes: LOCK_STEPS_MIN[Math.min(lv, LOCK_STEPS_MIN.length) - 1] };
}
export function lockWords(untilMs, nowMs) {
  const mins = Math.max(1, Math.ceil((untilMs - nowMs) / 60000));
  const t = mins >= 120 ? Math.ceil(mins / 60) + ' hours' : mins + (mins === 1 ? ' minute' : ' minutes');
  return 'Too many wrong tries. Try again in ' + t + ', or ask someone already in your family to let you back in.';
}

// ---- family codes ------------------------------------------------------
// A code is a doorbell: families paste it into WhatsApp groups. A new one
// a family chooses has 8 to 12 letters and numbers, with at least one
// number. Older, shorter codes keep working; adults see a gentle card.
export const CODE_MIN = 8, CODE_MAX = 12;
export function cleanCode(v) { return String(v == null ? '' : v).toUpperCase().replace(/\s+/g, ''); }
export function codeProblem(v) {
  const c = cleanCode(v);
  if (!/^[A-Z0-9]+$/.test(c)) return 'A family code is letters and numbers only, like SHARMA24.';
  if (c.length < CODE_MIN) return 'Make it at least ' + CODE_MIN + ' letters and numbers, like SHARMA24. You typed ' + c.length + '.';
  if (c.length > CODE_MAX) return 'A family code has at most ' + CODE_MAX + ' letters and numbers. You typed ' + c.length + '.';
  if (!/[0-9]/.test(c)) return 'Add at least one number, like SHARMA24.';
  return null;
}
export function codeIsWeak(v) {
  const c = cleanCode(v);
  return c.length < CODE_MIN || !/[0-9]/.test(c);
}
export const JOIN_PENDING_MAX = 10;

// ---- who sees what on a member card -------------------------------------
// Each member chooses who sees their phone and their birth year: 'family'
// (everyone here), 'adults' or 'me'. In a group of friends the phone and the
// full date of birth are hidden unless the member says otherwise.
export const SEE = ['family', 'adults', 'me'];
export function seeChoice(v) { return SEE.includes(v) ? v : null; }
export function defaultSee(kind) { return kind === 'group' ? 'me' : 'family'; }
function allowed(choice, kind, viewerIsAdult) {
  const c = seeChoice(choice) || defaultSee(kind);
  return c === 'family' || (c === 'adults' && viewerIsAdult);
}
// What one viewer is sent about one member. Pure: the server calls it for
// every card. hidden_fields is what the member chose to hide after reading
// "what your family wrote about you".
export const HIDEABLE = ['phone', 'dob', 'place', 'relation', 'likes', 'sizes'];
const SIZE_KEYS = ['clothes', 'shoe', 'ring'], LIKE_KEYS = ['color', 'likes', 'wishlist'];
export function cardFor(member, viewer, kind) {
  const m = { ...member };
  const { see_phone, see_birth, hidden_fields, ...out } = m;
  if (!viewer || viewer.id === member.id) return out;
  const hid = new Set(Array.isArray(hidden_fields) ? hidden_fields : []);
  const grown = !!viewer.adult;
  if (hid.has('phone') || !allowed(see_phone, kind, grown)) out.phone = null;
  const d = ymd(member.dob);
  if (hid.has('dob')) { out.dob = null; out.dob_md = null; }
  else if (!allowed(see_birth, kind, grown)) {
    out.dob = null;
    // The birthday without the year stays in a family (cards and wishes
    // need it); a group of friends is not sent the date at all.
    out.dob_md = kind === 'group' || !d ? null : d.slice(5);
  }
  if (hid.has('place')) { out.place = null; out.country = null; }
  if (hid.has('relation')) out.relation = null;
  if (out.gift_info && (hid.has('likes') || hid.has('sizes'))) {
    const g = { ...out.gift_info };
    if (hid.has('sizes')) SIZE_KEYS.forEach(k => { delete g[k]; });
    if (hid.has('likes')) LIKE_KEYS.forEach(k => { delete g[k]; });
    out.gift_info = Object.keys(g).length ? g : null;
  }
  return out;
}

// ---- removing someone who is on Parwah ----------------------------------
// Two adults agree: one asks, a different one confirms. Never one person
// alone, unless they are the only adult in the family. Nobody removes
// themselves this way (that is "Leave this family").
export function removalRule({ me, target, members, today }) {
  if (!me || !isAdultMember(me, today)) return { error: 'Only an adult in the family can ask for this.', status: 403 };
  if (!target) return { error: 'Choose someone in this family', status: 404 };
  if (target.id === me.id) return { error: 'To go yourself, use "Leave this family" in your profile.', status: 400 };
  if (!target.user_id && target.on_app !== true) return { error: target.name + ' is not on Parwah. Remove them from the family tree instead.', status: 400 };
  const adults = actingAdults(members, today);
  const others = adults.filter(m => m.id !== me.id && m.id !== target.id);
  if (others.length) return { needs: true, others };
  // No third adult. One person alone decides only about a child BY DATE OF
  // BIRTH. A mark someone made ("is a child", "not an adult") is not
  // enough: the one who made it could be the one asking.
  if (minorByBirth(target, today)) return { needs: false, others: [] };
  if (adults.some(m => m.id === target.id)) {
    return { error: 'With two adults in the family, one cannot remove the other. Either of you can leave from your own profile.', status: 409 };
  }
  return { error: 'Parwah has no date of birth for ' + target.name + ', so one person alone cannot remove them. They can leave from their own profile.', status: 409 };
}

// Letting anyone with the code walk in needs a second adult's yes when the
// family has two or more adults.
export function openJoinRule({ me, members, today }) {
  if (!me || !isAdultMember(me, today)) return { error: 'An adult in the family decides how people join.', status: 403 };
  const others = actingAdults(members, today).filter(m => m.id !== me.id);
  return { needs: others.length > 0, others };
}

// Deleting the whole family: every adult says yes.
export function deleteFamilyRule({ me, members, today }) {
  if (!me || !isAdultMember(me, today)) return { error: 'Only an adult in the family can ask for this.', status: 403 };
  return { adults: actingAdults(members, today) };
}
export const UNDO_DAYS = 7;
export const LINK_HOLD_HOURS = 48;
export const RESET_VETO_MINUTES = 10;

// ---- devices --------------------------------------------------------------
// A rough name from what the browser says about itself. Never the full
// string: "Chrome on Android" is enough to know which phone it is.
export function deviceName(ua) {
  const s = String(ua || '');
  if (!s) return 'A phone or computer';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android phone'
    : /Windows/.test(s) ? 'Windows computer' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'Chromebook' : /Linux/.test(s) ? 'Linux computer' : 'A phone or computer';
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox'
    : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return br ? br + ' on ' + (os === 'A phone or computer' ? 'a phone or computer' : os) : os;
}

// ---- "what your family wrote about you" ---------------------------------
// The things a family may have written on a profile it made by name.
export function writtenAbout(m) {
  const g = (m && m.gift_info) || {};
  const day = ymd(m && m.dob);
  const items = [
    { key: 'name', label: 'Name', value: m && m.name, fixed: true },
    { key: 'relation', label: 'Relation', value: m && m.relation },
    { key: 'dob', label: 'Date of birth', value: day || null },
    { key: 'phone', label: 'Phone', value: m && m.phone },
    { key: 'place', label: 'Lives in', value: m && m.place },
    { key: 'sizes', label: 'Sizes', value: SIZE_KEYS.filter(k => g[k]).map(k => k + ': ' + g[k]).join(', ') || null },
    { key: 'likes', label: 'Likes', value: LIKE_KEYS.filter(k => g[k]).map(k => g[k]).join(', ') || null }
  ];
  return items.filter(i => i.value);
}
export const CLAIM_CHOICES = ['keep', 'hide', 'delete'];
