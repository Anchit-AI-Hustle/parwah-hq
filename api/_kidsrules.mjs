// A CHILD'S PAGE ("Bachchon ka panna"): the rules, with no database. Imports
// only _consentrules.mjs (which imports only data), so the unit test runs
// before npm install (site/tests/familyneedstest.mjs).
//
// One page for each member under 18: school, fee dates, exams, who collects
// today, the vaccination RECORD, allergies and the doctor's phone, classes.
// Who reads what is decided by one thing: how the viewer is related.
//
//   'self'    the child, on their own phone: a friendly page of their own
//             school, exams, classes, who collects them, and their notes.
//             Never fees, never the health lines.
//   'parent'  a parent by the family tree (the parent link, and that
//             parent's spouse). With no parent on Parwah, the adult who
//             started the page keeps it. Sees and changes everything.
//   'adult'   any other adult: only what a parent marked "Whole family".
//   'minor'   a brother, sister or cousin under 18: the same, and never
//             fees, vaccinations or the health lines.
//   'none'    not in this family, not on Parwah, or no longer with us.
import { ECARD_LEGAL } from './_consentrules.mjs';

// The app's own legal line, said about a page instead of a card.
export const RECORD_LEGAL = ECARD_LEGAL.replace('This card is', 'This is');

export const KID_SECTIONS = ['school', 'fees', 'exams', 'pickup', 'vaccines', 'health', 'activities'];
export const KID_SECTION_WORDS = { school: 'School details', fees: 'Fee dates', exams: 'Exam dates', pickup: 'Pick-up duty',
  vaccines: 'Vaccination record', health: 'Allergies and doctor', activities: 'Classes and activities' };
export const KID_ITEM_KINDS = ['fee', 'exam', 'vaccine', 'activity', 'note'];
export const KID_WHO = ['parents', 'family'];
export const KID_MAX = { text: 80, long: 300, phone: 20, items: 200 };
export const PICKUP_GRACE_MIN = 20;
export const FEE_STAGES = [7, 1];

// How the viewer stands to the child.
//   viewer: { id, on_app, minor, remembered }   child: { id }
//   parents: the child's parents by the tree [{ id, on_app, remembered }]
//   startedBy: who began the page
export function kidRelation({ viewer, child, parents = [], startedBy = null }) {
  if (!viewer || !child) return 'none';
  if (viewer.id === child.id) return 'self';
  if (viewer.on_app === false || viewer.remembered) return 'none';
  if (viewer.minor) return 'minor';
  if (parents.some(p => p && p.id === viewer.id)) return 'parent';
  const active = parents.filter(p => p && p.on_app !== false && !p.remembered);
  if (!active.length && startedBy && startedBy === viewer.id) return 'parent';
  return 'adult';
}

// May this relation read this part of the page?
//   share: { school: 'family', ... } what a parent marked for the family
//   what: a section, 'result' (an exam result) or 'note' (the child's note)
export function kidMaySee(rel, what, { share = {}, resultsShare = 'parents', noteShare = 'parents' } = {}) {
  if (rel === 'parent') return true;
  if (rel === 'none' || !rel) return false;
  const fam = (k) => share && share[k] === 'family';
  if (what === 'result') return rel === 'self' || resultsShare === 'family';
  if (what === 'note') return rel === 'self' || noteShare === 'family';
  if (what === 'fees' || what === 'vaccines' || what === 'health') return rel === 'adult' && fam(what);
  if (what === 'school' || what === 'exams' || what === 'pickup' || what === 'activities') return rel === 'self' || fam(what);
  return false;
}

// May this relation add or change this kind of entry?
//   mine: the entry was written by the viewer
export function kidMayWrite(rel, kind, { mine = true } = {}) {
  if (rel === 'parent') return true;
  if (rel === 'self') return (kind === 'exam' || kind === 'note') && mine;
  return false;
}

// Who chooses whether exam results go to the wider family: the child, when
// they are on Parwah; a parent only when the child is not.
export function kidResultsChooser(rel, childOnApp) {
  if (rel === 'self') return true;
  return rel === 'parent' && !childOnApp;
}

// Who may begin a page: a parent by the tree; with no parent on Parwah,
// any adult of the family (who then keeps it).
export function kidMayStart(rel, hasActiveParent) {
  if (rel === 'parent') return { ok: true };
  if (rel === 'adult' && !hasActiveParent) return { ok: true };
  if (rel === 'adult') return { ok: false, status: 403, error: 'Their parents keep this page. Ask one of them to start it.' };
  return { ok: false, status: 403, error: 'A parent starts this page.' };
}

// ---- fees: a reminder a week before and the day before, once each -------
export function feeStage(days) { return days < 0 ? null : days <= 1 ? 1 : days <= 7 ? 7 : null; }
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
export function feePush(childName, title, days) {
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
  return { kind: 'care', title: '🎒 ' + first(childName) + "'s " + title + ' is due ' + when, body: 'Tap to open the page and mark it paid when it is done.', url: '/#care' };
}

// ---- pick-up: late is the expected time plus 20 minutes -----------------
export function pickupLate(row, nowMs) {
  if (!row || row.picked_at || row.alerted_at) return false;
  return new Date(row.expect_at).getTime() + PICKUP_GRACE_MIN * 60000 <= nowMs;
}
export function pickupDonePush(childName, tapName, collectorName) {
  const who = collectorName && first(collectorName) !== first(tapName) ? first(collectorName) + ' has picked up ' + first(childName) + ' (marked by ' + first(tapName) + ')'
    : first(tapName) + ' has picked up ' + first(childName);
  return { kind: 'care', title: '🎒 ' + who, body: 'All well. Tap to see the page.', url: '/#care' };
}
// A child not marked as collected is a safety matter: it comes through a
// quiet hour, and it blames nobody.
export function pickupLatePush(childName, collectorName, timeWords) {
  return { kind: 'safety', title: '🎒 ' + first(childName) + ' is not marked as picked up yet',
    body: (collectorName ? first(collectorName) + ' was to collect' : 'Pick-up was') + (timeWords ? ' at ' + timeWords : '') + '. A call to ' + (collectorName ? first(collectorName) + ' or ' : '') + 'the school will tell.', url: '/#care' };
}
export function childNotePush(childName) {
  return { kind: 'care', title: '💬 ' + first(childName) + ' wrote something for you', body: 'Open their page to read it.', url: '/#care' };
}

// ---- what may be saved --------------------------------------------------
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const kidText = (v, n = KID_MAX.text) => clean(v, n) || null;
export function kidPhone(v) {
  const s = clean(v, 40);
  if (!s) return { value: null };
  if (!/^\+?[\d\s()-]{6,20}$/.test(s)) return { error: 'Write the phone number in numbers, like 0522 400 1234.' };
  return { value: s.slice(0, KID_MAX.phone) };
}
export function kidDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null;
}
export function kidClock(v) { const s = String(v == null ? '' : v).trim(); return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null; }
export function kidDays(v) { return [...new Set((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort(); }

// One entry, by kind. Returns { error } or { value }.
export function kidItemClean(kind, b) {
  b = b || {};
  if (!KID_ITEM_KINDS.includes(kind)) return { error: 'Choose what to add.' };
  const title = kidText(b.title, kind === 'note' ? KID_MAX.long : KID_MAX.text);
  if (!title) return { error: kind === 'note' ? 'Write what you want to say.' : 'Say what it is.' };
  const v = { kind, title, onDate: null, atTime: null, days: [], nextDue: null, result: null, share: 'parents' };
  if (kind === 'fee' || kind === 'exam' || kind === 'vaccine') {
    v.onDate = kidDate(b.onDate);
    if (!v.onDate) return { error: kind === 'vaccine' ? 'Pick the date it was given from the calendar.' : 'Pick the date from the calendar.' };
  }
  if (kind === 'vaccine' && b.nextDue) { v.nextDue = kidDate(b.nextDue); if (!v.nextDue) return { error: 'Pick the next date from the calendar, or leave it empty.' }; }
  if (kind === 'exam') v.result = kidText(b.result);
  if (kind === 'activity') {
    v.days = kidDays(b.days); v.atTime = kidClock(b.atTime);
    if (!v.days.length) return { error: 'Tick the days of the week.' };
  }
  if (kind === 'note') v.share = b.share === 'family' ? 'family' : 'parents';
  return { value: v };
}
