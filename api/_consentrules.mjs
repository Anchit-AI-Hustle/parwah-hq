// CONSENT, CONTROL AND CARE BOTH WAYS - the rules, and nothing else.
// Imports only _standingrules.mjs (which imports nothing), so the deploy
// gate tests this before npm install (site/tests/consenttest.mjs).
//
// The person who is cared for is an equal here: they say yes before the
// family is told where they are, they can say "not now", they see who
// looked, they choose their own call time, and care goes back from them too.
import { isMinor as standingMinor } from './_standingrules.mjs';

// ---- where someone is -------------------------------------------------
// A position this old is not "now". The screen says "Last seen" with the
// time, in words, and never draws it as if it were live.
export const LIVE_MINUTES = 5;
export function isLive(iso, now = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= LIVE_MINUTES * 60000;
}
export function agoWords(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const h = Math.round(min / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}
export function lastSeenWords(iso, now = Date.now()) {
  const a = agoWords(iso, now);
  return a ? 'Last seen ' + a : 'Last seen a while ago';
}
// "Seen by Rohan, 10 min ago"
export function seenByWords(name, iso, now = Date.now()) {
  return 'Seen by ' + (String(name || '').trim() || 'someone') + ', ' + (agoWords(iso, now) || 'a while ago');
}
// "Not now" to an ask to share: that asker cannot ask again for this long.
export const ASK_MUTE_DAYS = 7;
export function muteUntil(now = Date.now()) { return new Date(now + ASK_MUTE_DAYS * 86400000); }
// One look by one person is written down at most once in this long.
export const LOOK_EVERY_MIN = 10;

// ---- who is told what ---------------------------------------------------
// A child or a teenager is family, and is told the warm things. They are
// not sent the frightening ones or the money.
export const ADULT_ONLY_KINDS = ['sos_details', 'missed_dose', 'staff_money', 'staff_late', 'safe_word', 'emergency_items', 'costs'];
export const WARM_KINDS = ['plan', 'card', 'game', 'album', 'story', 'ashirwad', 'howday', 'trip'];
// A kind nobody has listed is treated as adult only: a new alert must be
// put on the warm list on purpose before a child is sent it.
export function adultOnly(kind) { return WARM_KINDS.indexOf(kind) < 0; }
// A child or a teenager, by the ONE rule (standingOf in _standingrules.mjs).
export function isMinor(m, today) { return standingMinor(m, today); }
// May this member be sent this kind of thing?
export function mayBeTold(m, kind, today) {
  if (!m || m.remembered) return false;
  return !(adultOnly(kind) && isMinor(m, today));
}

// ---- Ashirwad and "How is your day?" -------------------------------------
export const BLESS_LINES = [
  { k: 'khush', t: 'Khush raho' },
  { k: 'exam', t: 'All the best for the exam' },
  { k: 'reach', t: 'Reach safely' },
  { k: 'proud', t: 'So proud of you' }
];
export const PRANAM = '🙏 Pranam';
export const DAY_ASK = 'How is your day?';
export const DAY_ANSWERS = [
  { k: 'good', t: 'A good day' },
  { k: 'busy', t: 'Busy, but all fine' },
  { k: 'tired', t: 'A little tired today' },
  { k: 'call', t: 'Call me, I would like to talk' }
];
export const blessLine = k => { const x = BLESS_LINES.find(l => l.k === k); return x ? x.t : null; };
export const dayAnswer = k => { const x = DAY_ANSWERS.find(l => l.k === k); return x ? x.t : null; };
export const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';

// ---- Reached safely -------------------------------------------------------
export const TRIP_MODES = ['train', 'car', 'bus', 'flight', 'cab', 'walk', 'other'];
export const TRIP_MODE_WORDS = { train: 'by train', car: 'by car', bus: 'by bus', flight: 'by flight', cab: 'by cab', walk: 'on foot', other: '' };
export const TRIP_GRACE_MIN = 30;
export const TRIP_MIN_AHEAD_MS = 5 * 60000, TRIP_MAX_AHEAD_MS = 3 * 86400000;
export const TRIP_TELL_MAX = 8;
// What was typed, checked: { value: { to, by, expectAt } } or { error }.
export function tripClean(input, now = Date.now()) {
  const i = input || {};
  const to = String(i.to || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!to) return { error: 'Write where you are going, like Delhi.' };
  if (to.length > 60) return { error: 'Keep the place under 60 letters.' };
  const by = TRIP_MODES.indexOf(i.by) >= 0 ? i.by : 'other';
  const t = Date.parse(i.expectAt);
  if (!Number.isFinite(t)) return { error: 'Choose when you expect to reach.' };
  if (t < now + TRIP_MIN_AHEAD_MS) return { error: 'Choose a time at least 5 minutes from now.' };
  if (t > now + TRIP_MAX_AHEAD_MS) return { error: 'Choose a time in the next 3 days.' };
  return { value: { to, by, expectAt: new Date(t) } };
}
// 'travelling' until the expected time plus the grace, then 'late'.
export function tripPhase(trip, now = Date.now()) {
  if (!trip) return 'none';
  if (trip.status === 'reached' || trip.reached_at) return 'reached';
  if (trip.status === 'cancelled') return 'cancelled';
  const t = Date.parse(trip.expect_at || trip.expectAt);
  return Number.isFinite(t) && now >= t + TRIP_GRACE_MIN * 60000 ? 'late' : 'travelling';
}
export function tripLine(name, to, by) {
  const w = TRIP_MODE_WORDS[by] || '';
  return firstName(name) + ' is leaving for ' + to + (w ? ', ' + w : '');
}
export function tripAskLine(name) {
  return firstName(name) + ' has not tapped Reached safely yet. A call may help.';
}

// ---- Emergency card ---------------------------------------------------------
export const ECARD_LEGAL = 'This card is a record your family keeps. It is not medical advice. In an emergency, call the ambulance first.';
export const ECARD_CONTACTS_MAX = 2;
export const ECARD_VIEWERS_MAX = 12;
// May this viewer open this person's card?
//   the person themself, always;
//   an adult the person chose;
//   any adult while the person has an SOS open;
//   any adult when the person is not on Parwah (they cannot choose).
// A child never does, and nobody opens a remembered person's card.
export function ecardMayOpen({ viewerId, viewerMinor, personId, personOnApp, personRemembered, chosen, sosOpen }) {
  if (!viewerId || !personId || personRemembered) return false;
  if (viewerId === personId) return true;
  if (viewerMinor) return false;
  if (!personOnApp) return true;
  if (sosOpen) return true;
  return Array.isArray(chosen) && chosen.indexOf(viewerId) >= 0;
}

// ---- Home staff -------------------------------------------------------------
// The two one-tap answers to "not in yet", and the mark each one writes.
export const STAFF_ANSWERS = { came: 'came', leave: 'leave' };
export function staffAnswerWords(name) {
  const f = firstName(name);
  return { came: f + ' came', leave: 'On leave today' };
}
