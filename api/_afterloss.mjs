// "WHAT NEEDS DOING": the checklist for when someone passes away. The rules,
// with no database and no imports, so the unit test runs before npm install.
//
// It is a list to help a family remember. It is not legal advice, and it
// says so once. It never decides who may read a register entry: that is
// registerRowFor in _register.mjs, handed in here as `rowFor`, so there is
// one viewing rule and this file cannot grow a second.

import { surelyAdult, ADULT_HOW } from './_safetyrules.mjs';

export const AFTERLOSS_NAME = 'What needs doing';
export const AFTERLOSS_SORRY = 'We are sorry. This list is here so nothing is forgotten.';
export const AFTERLOSS_LEGAL = 'This is a list to help you remember, not legal advice. Rules differ by bank and state.';
export const AFTERLOSS_MAX = { note: 300 };

// ---------------------------------------------------------------------------
// FIRST THINGS: the same nine steps for every family in India.
// ---------------------------------------------------------------------------
// Each is one thing to do and one line of how. No promise about how long it
// takes or how it ends: that differs by office, bank and state.
export const AFTERLOSS_FIRST = [
  { key: 'f:certificate', title: 'Get the death certificate',
    how: 'Ask the municipal office or the hospital. Ask for several copies: most offices keep one.' },
  { key: 'f:bank', title: 'Tell the bank or banks',
    how: 'Go to the branch with a copy of the certificate. Ask what they need from the family.' },
  { key: 'f:insurer', title: 'Tell the insurer or insurers',
    how: 'Call or visit each one. Ask for the claim form and the list of papers.' },
  { key: 'f:employer', title: 'Tell the employer or the pension office',
    how: 'Ask about dues, provident fund and family pension, and which papers they need.' },
  { key: 'f:phone', title: 'Stop or move the phone and the utilities',
    how: 'Phone, electricity, gas, water and internet. Keep the phone number on until the bank work is done.' },
  { key: 'f:will', title: 'Look for a will',
    how: 'Check the papers at home, the locker, and ask the family lawyer if there is one.' },
  { key: 'f:landlord', title: 'Tell the landlord or the housing society',
    how: 'Ask what they need to change the name in their records.' },
  { key: 'f:ids', title: 'Keep the Aadhaar and PAN safe',
    how: 'Do not surrender them in a hurry. Other offices may ask to see them first.' },
  { key: 'f:subs', title: 'Cancel or move the subscriptions',
    how: 'TV, apps, newspapers, memberships. Check the bank statement for what is paid each month.' }
];
const FIRST_KEYS = new Set(AFTERLOSS_FIRST.map(s => s.key));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A step is 'f:<name>' (first things) or 'e:<register entry id>'.
export function afterlossKey(v) {
  const s = String(v == null ? '' : v);
  if (FIRST_KEYS.has(s)) return { part: 'first', key: s };
  if (s.slice(0, 2) === 'e:' && UUID.test(s.slice(2))) return { part: 'register', key: 'e:' + s.slice(2).toLowerCase(), entryId: s.slice(2).toLowerCase() };
  return null;
}

// ---------------------------------------------------------------------------
// FROM THE REGISTER: one step per entry, worded by its kind.
// ---------------------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function afterlossDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) return '';
  return String(+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
}
const one = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
// "Papers: in the blue file." A full stop only when the text has none.
const stop = (s) => (/[.!?]$/.test(s) ? s : s + '.');

// What to do, by kind. `t` is what the family called it, `n` the nominee.
const BY_KIND = {
  BANK_ACCOUNT:   (t, n) => 'Tell ' + t + '. ' + (n ? 'Ask for the claim form for the nominee ' + n + '.' : 'Ask which papers they need from the family.'),
  FIXED_DEPOSIT:  (t, n) => 'Tell the bank about ' + t + '. ' + (n ? 'Ask for the claim form for the nominee ' + n + '.' : 'Ask which papers they need from the family.'),
  MUTUAL_FUNDS:   (t, n) => 'Write to ' + t + '. ' + (n ? 'Ask how the units move to the nominee ' + n + '.' : 'Ask how the units move to the family.'),
  DEMAT:          (t, n) => 'Write to ' + t + '. ' + (n ? 'Ask how the shares move to the nominee ' + n + '.' : 'Ask how the shares move to the family.'),
  PPF_EPF_NPS:    (t, n) => 'Tell ' + t + '. ' + (n ? 'Ask for the claim form for the nominee ' + n + '.' : 'Ask for the claim form.'),
  PENSION:        (t) => 'Tell the pension office about ' + t + '. Ask if a family pension applies.',
  INSURANCE:      (t, n) => 'Claim on ' + t + '.' + (n ? ' The nominee is ' + n + '.' : ''),
  LOAN:           (t) => 'Tell the lender for ' + t + '; ask about the loan cover.',
  HOUSE:          (t) => 'Ask the local office how to change the name on ' + t + ' (mutation).',
  LAND:           (t) => 'Ask the local office how to change the name on ' + t + ' (mutation).',
  SHOP_OFFICE:    (t) => 'Ask the local office how to change the name on ' + t + ' (mutation).',
  PROPERTY_DEED:  (t) => 'Keep ' + t + ' safe. They are needed to change the name on the property (mutation).',
  WILL:           (t) => 'Read ' + t + ' with the family before anything is divided.',
  RENT_AGREEMENT: (t) => 'Tell the other side of ' + t + '. Ask how the agreement carries on.',
  BUSINESS_PAPER: (t) => 'Tell the partners or the accountant about ' + t + '.',
  LOCKER_KEY:     (t, n) => 'Tell the bank about ' + t + '. ' + (n ? 'Ask how the nominee ' + n + ' can open it.' : 'Ask how the family can open it.'),
  VEHICLE:        (t) => 'Move ' + t + ' to a new name at the transport office (RTO). Tell the vehicle insurer too.',
  GOLD:           (t) => 'Keep ' + t + ' safe until the family decides together.',
  HEIRLOOM:       (t) => 'Keep ' + t + ' safe until the family decides together.',
  DIGITAL_ACCOUNT: (t) => 'Close ' + t + ', or keep it as a memory. Use the recovery details the family kept.',
  SUBSCRIPTION:   (t) => 'Cancel ' + t + '.',
  OTHER:          (t) => 'Decide together what happens to ' + t + '.'
};
// The word in front of where it is kept.
const KEPT = { INSURANCE: 'Papers', LOAN: 'Papers', HOUSE: 'Papers', LAND: 'Papers', SHOP_OFFICE: 'Papers', PROPERTY_DEED: 'Kept',
  VEHICLE: 'Papers', DIGITAL_ACCOUNT: 'Recovery details', LOCKER_KEY: 'Key', WILL: 'Kept', GOLD: 'Kept', HEIRLOOM: 'Kept' };
const DUE = { FIXED_DEPOSIT: 'Matures on', INSURANCE: 'Next premium or renewal', LOAN: 'Next payment', SUBSCRIPTION: 'Renews on', RENT_AGREEMENT: 'Runs until' };
export const AFTERLOSS_KINDS = Object.keys(BY_KIND);

// `entry` is what registerRowFor returned for this viewer: only what they
// may read. Returns { title, how } in plain words, never a promise.
export function afterlossEntryStep(entry) {
  const e = entry || {};
  const kind = BY_KIND[e.asset_category] ? e.asset_category : 'OTHER';
  const name = one(e.institution_or_item) || 'this entry';
  const label = kind === 'OTHER' ? one(e.custom_label) : '';
  const title = BY_KIND[kind](name, one(e.nominee));
  const how = [];
  if (label) how.push(stop('Kind: ' + label));
  const where = one(e.physical_location_notes);
  if (where) how.push(stop((KEPT[kind] || 'Papers') + ': ' + where));
  if (e.identifier_mask) how.push(stop('Number or label: ' + one(e.identifier_mask)));
  const day = afterlossDay(e.due_on);
  if (day) how.push(stop((DUE[kind] || 'Date to keep in mind') + ': ' + day));
  return { title, how: how.join(' ') };
}

// ---------------------------------------------------------------------------
// WHO MAY START IT, AND WHAT IT OPENS
// ---------------------------------------------------------------------------
// An adult: someone who signs in to Parwah, and is 18 or more by their date
// of birth. With NO date of birth, only when their place in the family says
// so (the parent role, a relation only a grown-up holds, a spouse or a
// child in the tree): a teenager who never wrote a birthday must not be
// able to start, or confirm, a list about a death. A name added to the tree
// is never one. The rule itself is surelyAdult in api/_safetyrules.mjs.
export function afterlossIsAdult(m, today = new Date()) {
  return surelyAdult(m, today);
}

// The second adult. Starting a list and opening a closed one again both go
// through this one rule. One adult alone is enough only when the person is
// not on Parwah AND the family truly has no other adult: someone who signs
// in could be alive and reading, so that always takes two.
//   { error } | { needs: false, others } | { needs: true, askId, others }
export const AFTERLOSS_NEEDS_SECOND = 'This needs a second adult on Parwah to confirm.';
export function afterlossStartRule({ me, personId, members, askId, today }) {
  if (!me || !afterlossIsAdult(me, today)) {
    const unsure = me && (me.user_id || me.on_app) && !me.dob;
    return { error: unsure ? ADULT_HOW : 'Only an adult in the family who is on Parwah can start this.', status: 403 };
  }
  if (me.id === personId) return { error: 'This list is started by the family, for someone else.', status: 400 };
  const others = (members || []).filter(m => m.id !== me.id && m.id !== personId && afterlossIsAdult(m, today));
  if (!others.length) {
    const person = (members || []).find(m => m.id === personId);
    if (person && (person.user_id || person.on_app)) return { error: AFTERLOSS_NEEDS_SECOND, status: 400, solo: false };
    return { needs: false, others };
  }
  if (!askId || !others.some(m => m.id === askId)) {
    return { error: 'Choose a second adult in the family to confirm. Two people start this together.', status: 400, field: 'ask', others };
  }
  return { needs: true, askId, others };
}

// Is this list truly in force? Active, and either a second adult confirmed
// it or it was an allowed start by the only adult (see the rule above).
// `personOnApp` is whether the person it is about signs in to Parwah.
export function afterlossInForce(list, personOnApp) {
  if (!list || list.status !== 'active') return false;
  return !!list.confirmed_by || (list.solo === true && !personOnApp);
}

// "Only in an emergency" and this list. While the list for a person is
// active, it is the emergency for THAT person's entries, and only for the
// two who started and confirmed it. A nominee is written as a name, and a
// name is not a person: an outside nominee who shares a name with someone
// in the family must never open an entry to that someone. A nominee who
// should see it is named under "People I choose" in the register.
// It never touches unlock_policy: it only answers "is it an emergency?"
// for the one rule in _register.mjs.
export function afterlossOpens(list, row, memberId) {
  if (!list || !row || !memberId) return false;
  if (list.status !== 'active' || list.person_id !== row.person_id) return false;
  // Active is not enough: a second adult confirmed it, or it was an allowed
  // start by the only adult. A list that is neither opens nothing.
  if (!list.confirmed_by && list.solo !== true) return false;
  if (memberId === list.started_by || memberId === list.confirmed_by) return true;
  return false;
}

// ---------------------------------------------------------------------------
// THE LIST ONE PERSON SEES
// ---------------------------------------------------------------------------
// rows:    the register rows about this person, as stored.
// rowFor:  registerRowFor from _register.mjs. The only viewing rule.
// opens:   (row, memberId) => is it an emergency for this entry and viewer.
// marks:   { stepKey: { done, done_by_name, assigned_to, ... } } from the database.
// A row the viewer may not read makes no step, and no gap: nothing here
// says that it exists.
export function afterlossSteps({ rows, viewerId, rowFor, opens, marks = {} }) {
  if (typeof rowFor !== 'function') throw new Error('afterlossSteps needs the register rule');
  const mark = (key) => {
    const m = marks[key] || {};
    return { done: !!m.done, done_by_name: m.done ? (m.done_by_name || null) : null, done_at: m.done ? (m.done_at || null) : null,
      assigned_to: m.assigned_to || null, assigned_name: m.assigned_to ? (m.assigned_name || null) : null,
      note: m.note || null, note_by_name: m.note ? (m.note_by_name || null) : null };
  };
  const steps = AFTERLOSS_FIRST.map(s => ({ key: s.key, part: 'first', title: s.title, how: s.how, ...mark(s.key) }));
  let onlyMine = 0;
  for (const row of rows || []) {
    const entry = rowFor(row, viewerId, opens ? !!opens(row, viewerId) : false, { details: true });
    if (!entry || !entry.can_view) continue;
    const key = 'e:' + String(row.id).toLowerCase();
    const onlyYou = entry.unlock_policy === 'ONLY_ME';
    if (onlyYou) onlyMine++;
    steps.push({ key, part: 'register', entry_id: row.id, kind: entry.asset_category, kind_label: entry.kind_label,
      who: entry.unlock_policy, only_you: onlyYou, ...afterlossEntryStep(entry), ...mark(key) });
  }
  return { steps, onlyMine, progress: afterlossProgress(steps) };
}

export function afterlossProgress(steps) {
  const total = (steps || []).length, done = (steps || []).filter(s => s.done).length;
  return { done, total, text: done + ' of ' + total + ' done' };
}

// A short note on a step. `risks` are noteRisk and registerSecretRisk: a
// card number, a CVV, an OTP, a PIN or a password is never kept.
export function afterlossNote(v, risks = []) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > AFTERLOSS_MAX.note) return { error: 'Keep the note to ' + AFTERLOSS_MAX.note + ' letters or fewer.' };
  for (const risk of risks) {
    const why = risk && risk(s);
    if (why) return { error: why };
  }
  return { value: s || null };
}

// The pushes this feature ever sends: the ask to the second adult, the one
// to the family when it starts (or is opened again), and the one to the two
// who started it when the person it is about closes it themself.
export function afterlossPush(kind, { starter, person, confirmer }) {
  if (kind === 'ask') return { kind: 'other', title: starter + ' asks you to confirm', body: starter + " wants to start '" + AFTERLOSS_NAME + "' for " + person + '. It starts only if you agree.', url: '/#vault' };
  if (kind === 'void') return { kind: 'other', title: "'" + AFTERLOSS_NAME + "' was closed", body: person + ' closed the list that was started for them.', url: '/#vault' };
  if (kind === 'reopened') return { kind: 'other', title: starter + " opened '" + AFTERLOSS_NAME + "' for " + person + ' again', body: (confirmer ? confirmer + ' confirmed. ' : '') + 'The list is in the Family register.', url: '/#vault' };
  return { kind: 'other', title: starter + " started '" + AFTERLOSS_NAME + "' for " + person, body: (confirmer ? confirmer + ' confirmed. ' : '') + 'The list is in the Family register.', url: '/#vault' };
}
