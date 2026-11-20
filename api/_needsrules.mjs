// HOME UPKEEP, THE BLOOD GROUP LOOKUP AND THE DOCTOR-READY SUMMARY: the
// rules, with no database. Imports only _kidsrules.mjs (for the app's own
// record line), which imports only data, so the unit test runs before npm
// install (site/tests/familyneedstest.mjs).
import { RECORD_LEGAL } from './_kidsrules.mjs';
export { RECORD_LEGAL };

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const realDate = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null;
};

// ===========================================================================
// HOME: repairs and warranties ("Ghar ka saaman")
// ===========================================================================
// An appliance, a vehicle or a house paper: what it is, when and where it
// was bought, the warranty date, when its service is due, who to call, the
// bill, and who fixed it last time. Each entry has the same four choices of
// who sees it as the Family Register.
export const HOME_KINDS = [['appliance', 'Appliance'], ['vehicle', 'Vehicle'], ['house_doc', 'House paper']];
export const HOME_KIND_ICON = { appliance: '🔧', vehicle: '🚗', house_doc: '🏠' };
export const HOME_WHO = [['ONLY_ME', 'Only me'], ['NOMINEES_ONLY', 'People I choose'], ['IMMEDIATE', 'Whole family'], ['EMERGENCY_ONLY', 'Only in an emergency']];
export const HOME_MAX = { title: 80, where: 80, text: 200, people: 30, items: 300 };
export const HOME_STAGES = [30, 7];
// Service reminders are filed under their own stage numbers, so a warranty
// and a service on the same date are each told once.
export const HOME_SERVICE_OFFSET = 1000;

// Who may read an entry. The same four choices as the register:
//   ONLY_ME: whoever wrote it. NOMINEES_ONLY: and the people named.
//   IMMEDIATE: the whole family. EMERGENCY_ONLY: the adults of the family,
//   only while the person who wrote it has an SOS open.
export function homeMaySee({ item, viewerId, viewerMinor = false, sosOpen = false }) {
  if (!item || !viewerId) return false;
  if (item.created_by === viewerId) return true;
  const who = item.audience || 'IMMEDIATE';
  if (who === 'IMMEDIATE') return true;
  if (who === 'NOMINEES_ONLY') return Array.isArray(item.people) && item.people.includes(viewerId);
  if (who === 'EMERGENCY_ONLY') return !viewerMinor && !!sosOpen;
  return false;
}
// Change or remove: whoever wrote it. Writing down a repair: any adult who may see it.
export function homeMayManage(item, viewerId) { return !!item && !!viewerId && item.created_by === viewerId; }

export function homeClean(b) {
  b = b || {};
  const kind = HOME_KINDS.some(k => k[0] === b.kind) ? b.kind : null;
  if (!kind) return { error: 'Choose what it is: an appliance, a vehicle or a house paper.' };
  const title = clean(b.title, HOME_MAX.title);
  if (!title) return { error: 'Say what it is, like "Fridge" or "Scooter".' };
  const dates = {};
  for (const [key, label] of [['boughtOn', 'the day it was bought'], ['warrantyUntil', 'the warranty date'], ['serviceDue', 'the service date']]) {
    if (b[key] === undefined || b[key] === null || b[key] === '') { dates[key] = null; continue; }
    dates[key] = realDate(b[key]);
    if (!dates[key]) return { error: 'Pick ' + label + ' from the calendar.' };
  }
  if (dates.boughtOn && dates.warrantyUntil && dates.warrantyUntil < dates.boughtOn) return { error: 'The warranty date is before the day it was bought. Please check.' };
  const who = HOME_WHO.some(w => w[0] === b.audience) ? b.audience : null;
  if (!who) return { error: 'Choose who can see this.' };
  let people = [];
  if (who === 'NOMINEES_ONLY') {
    people = [...new Set((Array.isArray(b.people) ? b.people : []).map(String))].slice(0, HOME_MAX.people);
    if (!people.length) return { error: 'Choose at least one person, or pick Only me.' };
  }
  return { value: { kind, title, boughtOn: dates.boughtOn, boughtWhere: clean(b.boughtWhere, HOME_MAX.where) || null, warrantyUntil: dates.warrantyUntil,
    serviceDue: dates.serviceDue, callText: clean(b.callText, HOME_MAX.where) || null, billNote: clean(b.billNote, HOME_MAX.where) || null,
    fixedNote: clean(b.fixedNote, HOME_MAX.text) || null, audience: who, people } };
}
// "Who fixed it last time": a line, and if the family wants, the next service date.
export function homeLogClean(b) {
  b = b || {};
  const note = clean(b.note, HOME_MAX.text);
  if (!note) return { error: 'Write who fixed it and what was done.' };
  let next = null;
  if (b.serviceDue) { next = realDate(b.serviceDue); if (!next) return { error: 'Pick the next service date from the calendar, or leave it empty.' }; }
  return { value: { note, serviceDue: next } };
}
// Which reminder is due for a date this many days away: 7, 30 or none.
export function homeStage(days) { return days < 0 ? null : days <= 7 ? 7 : days <= 30 ? 30 : null; }
export function homePush(title, what, days) {
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
  return what === 'service'
    ? { kind: 'care', title: '🔧 ' + title + ': service is due ' + when, body: 'Open the entry to see who to call.', url: '/#vault' }
    : { kind: 'care', title: '🔧 ' + title + ': warranty runs out ' + when, body: 'If something needs fixing, this is the time. Open the entry to see the bill and who to call.', url: '/#vault' };
}

// ===========================================================================
// THE BLOOD GROUP LOOKUP
// ===========================================================================
// "Who in the family is O+?" An adult asks; the answer holds only people
// who wrote down a blood group AND said yes, on their own phone, to "Tell
// my family my blood group if someone needs blood". Nothing at all about
// anyone who has not said yes. A lookup in the family's own records: it
// says nothing about who can give blood to whom.
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const BLOOD_CONSENT_LINE = 'Tell my family, and the families linked to ours, my blood group if someone needs blood.';
export const BLOOD_LEGAL = 'This is what your family wrote down, with their yes. It is not medical advice. The hospital checks the blood group and decides everything else.';
export const BLOOD_ASKS_PER_DAY = 3;

// A group as people write it: "O+", "o +ve", "O positive", "AB neg".
export function bloodGroupOf(text) {
  const s = String(text || '').toUpperCase().replace(/BLOOD|GROUP|TYPE|[:.,()]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/(?:^|\s)(AB|A|B|O|0)\s*(\+|-|−|POSITIVE|NEGATIVE|POS|NEG|\+VE|-VE|VE\+|VE-)(?:\s|$)/);
  if (!m) return null;
  const abo = m[1] === '0' ? 'O' : m[1];
  const rh = /^(\+|POS|POSITIVE|\+VE|VE\+)$/.test(m[2]) ? '+' : '-';
  return abo + rh;
}
// May this person be shown in a lookup? Only with a group on record AND
// their own yes, and never someone who has passed away or is not on Parwah
// (they could not have said yes on their own phone).
export function bloodShown({ group, consent, onApp, remembered }) {
  return !!group && consent === true && onApp !== false && !remembered;
}
export function bloodMayAsk({ adult }) {
  return adult ? { ok: true } : { ok: false, status: 403, error: 'An adult in the family looks this up.' };
}
export function bloodAskPush(askerName, group, note) {
  return { kind: 'safety', title: '🩸 ' + first(askerName) + ' is looking for ' + group + ' blood',
    body: (note ? note + '. ' : '') + 'You said the family may know your blood group. Please call ' + first(askerName) + ' if you can help.', url: '/#memory' };
}

// ===========================================================================
// THE DOCTOR-READY SUMMARY
// ===========================================================================
// One page to hand to a doctor: the medicines list, allergies, blood group,
// past visits and follow-ups, and who to call. Built ONLY from what the
// viewer may already read; nothing new is stored. For the person themself
// and the adults who may see those entries. Never a child.
export const SUMMARY_LINE = 'Written by the family. This is not a medical record.';
export function summaryMayOpen({ viewerMinor, viewerOnApp = true, personRemembered }) {
  if (personRemembered) return { ok: false, status: 404, error: 'That page is not here.' };
  if (viewerMinor || !viewerOnApp) return { ok: false, status: 403, error: 'This page is for the adults of the family.' };
  return { ok: true };
}
// The sections, from the entries the SQL already allowed.
//   entries: family book rows { kind, category, name, forwhat, notes, phone }
//   visits:  [{ recorded_at, next_due, plan_title, action_items, new_notes }]
export function summaryBuild({ person, entries = [], visits = [], contacts = [], today }) {
  const of = (f) => entries.filter(f);
  const val = e => clean(e.forwhat || e.name, 160);
  const blood = of(e => e.kind === 'fact' && e.category === 'blood')[0];
  return {
    name: person.name, date: today, line: SUMMARY_LINE, legal: RECORD_LEGAL,
    blood: blood ? val(blood) : null,
    allergies: of(e => e.kind === 'fact' && e.category === 'allergy').map(val),
    medicines: of(e => e.kind === 'med').map(e => ({ name: clean(e.name, 80), note: clean([e.forwhat, e.notes].filter(Boolean).join(' · '), 300) })),
    doctors: of(e => e.kind === 'contact' && e.category === 'doctor').map(e => ({ name: clean(e.name, 80), phone: e.phone || null, note: clean(e.forwhat, 160) })),
    visits: visits.map(v => ({ on: v.recorded_at, title: clean(v.plan_title || 'Doctor visit', 100), notes: clean(v.new_notes, 400), next: v.next_due || null })),
    contacts: contacts.map(c => ({ name: clean(c.name, 80), phone: c.phone || null, note: clean(c.note, 80) })),
    empty: !entries.length && !visits.length && !contacts.length
  };
}
