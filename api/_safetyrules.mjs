// SAFETY RULES, as pure functions: no database, no clock of their own.
// The modules that send alerts ask these; site/tests/safetytest.mjs holds
// them to their word.

// ---------------------------------------------------------------------------
// PUSH TOPICS. A push service keeps ONE undelivered message per topic: a new
// one with the same topic takes the old one's place. Every urgent push used
// to share one topic, so a medicine nudge could replace an SOS that had not
// reached the phone yet. Now each emergency has a topic of its own, and
// nothing that is not an emergency is sent as one.
// A Web Push topic: at most 32 characters from the URL-safe base64 alphabet.
// ---------------------------------------------------------------------------
export const TOPIC_OK = /^[A-Za-z0-9_-]{1,32}$/;
export function pushTopic(kind, ref) {
  const k = String(kind || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 8) || 'urgent';
  const r = String(ref == null ? '' : ref).replace(/[^A-Za-z0-9]/g, '');
  // The end of the id is kept: 23 or more random hex characters of a UUID.
  return r ? k + '-' + r.slice(-(31 - k.length)) : k;
}

// How one payload is sent. urgent: an emergency (kept a day, shown until
// seen, the long buzz). ring: a lost phone, two minutes. soon: a reminder
// that should arrive on time, and is nothing more than a reminder.
// tag is what the phone files it under on screen: one per emergency, so a
// second emergency never takes the first one's place there either.
export function pushOptions(payload) {
  const p = payload || {};
  const urgent = !!p.urgent, ring = !urgent && !!p.ring, soon = !urgent && !ring && !!p.soon;
  const topic = typeof p.topic === 'string' && TOPIC_OK.test(p.topic) ? p.topic : null;
  if (urgent) return { urgent, ring, tag: topic, opts: topic ? { TTL: 86400, urgency: 'high', topic } : { TTL: 86400, urgency: 'high' } };
  if (ring) return { urgent, ring, tag: 'parwah-ring', opts: { TTL: 120, urgency: 'high', topic: 'parwah-ring' } };
  return { urgent, ring, tag: null, opts: soon ? { TTL: 3600, urgency: 'high' } : { TTL: 3600 } };
}

// ---------------------------------------------------------------------------
// WHO AN SOS REACHES, IN ORDER. Someone who has passed away is never on the
// list, and neither is their number, wherever it was written down.
//   chosen: emergency contacts the family wrote for this person (already in
//           the person's own order)
//   family: members of the family { name, phone, on_app, adult, remembered }
// Order: the chosen contacts, then adults on Parwah, then everyone else.
// ---------------------------------------------------------------------------
export const digits = p => String(p || '').replace(/[^\d+]/g, '');
// The same number written two ways (+91 98100 12345, 09810012345) is one.
export const phoneTail = p => digits(p).replace(/\D/g, '').slice(-10);
const tail = phoneTail;
export function orderContacts({ chosen = [], family = [], own = null, max = 8 }) {
  const gone = new Set(family.filter(m => m && m.remembered && m.phone).map(m => tail(m.phone)).filter(Boolean));
  const out = [], seen = new Set();
  if (own && tail(own)) seen.add(tail(own));
  const add = (name, phone, why) => {
    const p = digits(phone), t = tail(phone);
    if (!p || !t || seen.has(t) || gone.has(t)) return;
    seen.add(t); out.push({ name, phone: p, why });
  };
  for (const c of chosen) if (c) add(c.name, c.phone, 'Emergency contact');
  const alive = family.filter(m => m && !m.remembered);
  for (const m of alive) if (m.on_app && m.adult) add(m.name, m.phone, 'Family');
  for (const m of alive) if (!(m.on_app && m.adult)) add(m.name, m.phone, 'Family');
  return out.slice(0, max);
}

// ---------------------------------------------------------------------------
// AN ADULT, FOR THE GRAVEST CHOICES. With a date of birth: 18 or more. With
// none, only when their place in the family says so: the family's parent
// role, a relation only a grown-up holds, a spouse, or a child in the tree.
// "Son", "daughter", "family" or nothing at all does not say it.
// ---------------------------------------------------------------------------
export const ADULT_RELATIONS = ['father', 'mother', 'grandfather', 'grandmother', 'daughter-in-law', 'son-in-law'];
export function ageOn(dob, today = new Date()) {
  const d = dob instanceof Date ? dob : new Date(String(dob || '').slice(0, 10) + 'T00:00:00Z');
  if (!dob || isNaN(d)) return null;
  const t = today instanceof Date ? today : new Date(String(today).slice(0, 10) + 'T00:00:00Z');
  let age = t.getUTCFullYear() - d.getUTCFullYear();
  if (t.getUTCMonth() < d.getUTCMonth() || (t.getUTCMonth() === d.getUTCMonth() && t.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
export function adultByRole(m) {
  if (!m) return false;
  return m.role === 'parent' || ADULT_RELATIONS.includes(String(m.relation || '')) || !!m.spouse_id || !!m.has_child;
}
export function surelyAdult(m, today = new Date()) {
  if (!m || !(m.user_id || m.on_app)) return false;
  const age = ageOn(m.dob, today);
  return age === null ? adultByRole(m) : age >= 18;
}
export const ADULT_HOW = 'Add your date of birth in Edit profile first. This is for the adults of the family.';

// ---------------------------------------------------------------------------
// THE TIMER, SAID HONESTLY. Timed alerts run when the timer runs; when it
// has not run for a while, the family should know alerts may be late.
// ---------------------------------------------------------------------------
export const TIMER_LATE_MIN = 15;
export function timerLine(lastMs, nowMs) {
  const late = 'Timed reminders are not running. Family alerts may be late.';
  if (!lastMs || !Number.isFinite(lastMs)) return { warn: true, text: late, mins: null };
  const mins = Math.max(0, Math.floor((nowMs - lastMs) / 60000));
  if (mins > TIMER_LATE_MIN) return { warn: true, text: late, mins };
  const ago = mins < 1 ? 'just now' : mins === 1 ? '1 minute ago' : mins + ' minutes ago';
  return { warn: false, text: 'Reminders last ran: ' + ago, mins };
}
export const CALLS_OFF_LINE = 'Calls and texts are not set up. Family is told inside Parwah.';

// ---------------------------------------------------------------------------
// A MEDICINE NOT MARKED: who hears. The person decides. On Parwah: the
// family hears only after their own yes. Not on Parwah: only the one person
// who set the times and marks them, never the whole family.
//   → 'family' | 'carer' | 'nobody'
// ---------------------------------------------------------------------------
export function doseTellWho({ onApp, tell, carerId }) {
  if (onApp) return tell === true ? 'family' : 'nobody';
  return carerId ? 'carer' : 'nobody';
}
// Words that never read as blame: nobody "missed" anything.
export function doseNudgeText(slot) {
  return { title: '💊 ' + slot + ' medicines', body: 'When you have had them, tap the tick in Parwah. Skipped them today? You can say so. No hurry.' };
}
export function doseFamilyText(name, slot) {
  const first = String(name || 'Someone').trim().split(/\s+/)[0] || 'Someone';
  return { title: '💊 ' + first + "'s " + slot + ' medicines have no tick yet',
           body: first + ' may have had them and not tapped. A warm call is the kind thing.' };
}
export const RAN_OUT = 'Ran out';
export function refillTitle(personName, medName, shared) {
  const first = String(personName || 'the family').trim().split(/\s+/)[0];
  return shared && medName ? 'Get more ' + String(medName).trim().slice(0, 80) + ' for ' + first : 'Get more medicines for ' + first;
}

// ---------------------------------------------------------------------------
// A TASK PAST ITS TIME. The person who has it hears first, alone. The family
// hears only a second window later, and in words that name nobody.
// ---------------------------------------------------------------------------
export const TASK_FAMILY_AFTER_MIN = 60;
export function taskOwnerText(title, status) {
  return { title: '⏰ Past its time: ' + title,
           body: (status === 'assigned' ? 'It is waiting for your yes. ' : '') + 'Mark it done, set a new time, or hand it on. Only you see this for now.' };
}
export function taskFamilyText(title, hasOwner) {
  return { title: '🤝 Still open: ' + title,
           body: hasOwner ? 'It could do with a hand. Open Parwah to help or set a new time.' : 'Nobody has it yet. Open Parwah to take it or set a new time.' };
}
export function taskFamilyFeed(title, hasOwner) {
  return hasOwner ? 'Still open and could do with a hand: ' + title : 'Still open and nobody has it yet: ' + title;
}
