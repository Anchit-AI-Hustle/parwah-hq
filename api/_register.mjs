// THE FAMILY REGISTER: the rules, with no database in them.
//
// "When I'm Not Here" began as eight kinds of thing and three sharing rules.
// It is now the family's register: a house, a plot, the gold, a policy, a
// loan, an email account, an heirloom, or anything else, each with a clear
// choice of who sees it. This file holds every rule that decides what a
// person may read, so the handler, the app and the tests share one answer.
//
// Imports only _money.mjs (which imports nothing), so the unit test runs
// before npm install. The card-number check lives in _notesapi.mjs, which
// needs the database driver; the handler passes it in as `risk`.
import { CURRENCY, money } from './_money.mjs';

// ---------------------------------------------------------------------------
// WHAT IT IS
// ---------------------------------------------------------------------------
// The first eight are the original kinds. Their keys never change: rows
// saved before the register must still read correctly.
export const REGISTER_GROUPS = [
  { key: 'home', label: 'Home and land', kinds: [
    ['HOUSE', 'House or flat'], ['LAND', 'Land or plot'], ['SHOP_OFFICE', 'Shop or office'],
    ['PROPERTY_DEED', 'Property papers'] ] },
  { key: 'money', label: 'Money', kinds: [
    ['BANK_ACCOUNT', 'Bank account or passbook'], ['FIXED_DEPOSIT', 'Fixed deposit'],
    ['MUTUAL_FUNDS', 'Mutual funds and shares'], ['DEMAT', 'Demat or share papers'],
    ['PPF_EPF_NPS', 'PPF, EPF or NPS'], ['PENSION', 'Pension'],
    ['INSURANCE', 'Insurance policy'], ['LOAN', 'Loan or EMI'] ] },
  { key: 'papers', label: 'Papers', kinds: [
    ['WILL', 'Will'], ['RENT_AGREEMENT', 'Rent agreement'], ['BUSINESS_PAPER', 'Business paper'] ] },
  { key: 'things', label: 'Things', kinds: [
    ['LOCKER_KEY', 'Locker or locker key'], ['VEHICLE', 'Vehicle'],
    ['GOLD', 'Gold and jewellery'], ['HEIRLOOM', 'Family heirloom'] ] },
  { key: 'online', label: 'Online', kinds: [
    ['DIGITAL_ACCOUNT', 'Email, cloud or social account'], ['SUBSCRIPTION', 'Subscription or membership'] ] },
  { key: 'other', label: 'Other', kinds: [
    ['OTHER', 'Anything else'] ] }
];
export const REGISTER_KIND_LABEL = {};
for (const g of REGISTER_GROUPS) for (const [k, l] of g.kinds) REGISTER_KIND_LABEL[k] = l;

// The original eight first, in their original order, then the new kinds.
export const ASSET_CATEGORIES = [
  'BANK_ACCOUNT', 'LOCKER_KEY', 'FIXED_DEPOSIT', 'WILL', 'DEMAT', 'PROPERTY_DEED', 'PENSION', 'OTHER',
  'HOUSE', 'LAND', 'SHOP_OFFICE', 'VEHICLE', 'GOLD', 'MUTUAL_FUNDS', 'PPF_EPF_NPS', 'INSURANCE',
  'LOAN', 'RENT_AGREEMENT', 'BUSINESS_PAPER', 'SUBSCRIPTION', 'DIGITAL_ACCOUNT', 'HEIRLOOM'
];

export const REGISTER_MAX = { title: 120, label: 40, identifier: 60, where: 1000, inName: 80, nominee: 80, note: 500, people: 30, value: 1e13 };

// ---------------------------------------------------------------------------
// WHO CAN SEE IT
// ---------------------------------------------------------------------------
// Four plain choices. The keys of the first three are the original ones.
// - ONLY_ME:        the person it is about, and whoever wrote it. To
//                   everyone else it does not exist. Once the person it is
//                   about has chosen this, only they can widen it again.
// - NOMINEES_ONLY:  only the people named in designated_recipients.
// - IMMEDIATE:      the whole family.
// - EMERGENCY_ONLY: the family, only while this person has an SOS open.
//                   Also, while the family's "What needs doing" list for this
//                   person is in force: only the two who started and
//                   confirmed it. A nominee is a name, and a name opens
//                   nothing (afterlossOpens in _afterloss.mjs).
// Whoever wrote it, and the person it is about, can always see it: an
// entry its own author cannot read back looks like it was lost.
export const UNLOCK_POLICIES = ['IMMEDIATE', 'EMERGENCY_ONLY', 'NOMINEES_ONLY', 'ONLY_ME'];
export const REGISTER_WHO = [
  ['ONLY_ME', 'Only me'],
  ['NOMINEES_ONLY', 'People I choose'],
  ['IMMEDIATE', 'Whole family'],
  ['EMERGENCY_ONLY', 'Only in an emergency']
];
export const WHO_ERROR = 'Choose who can see this: only me (ONLY_ME), people you choose (NOMINEES_ONLY), the whole family (IMMEDIATE), or only in an emergency (EMERGENCY_ONLY).';

function recipientsOf(locator) {
  let r = locator && locator.designated_recipients;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = []; } }
  return Array.isArray(r) ? r : [];
}

// The one rule. Everything that sends an entry anywhere asks this.
export function canViewAssetLocator(locator, memberId, isEmergencyActive = false) {
  if (!locator) return false;
  if (memberId && (locator.created_by === memberId || locator.person_id === memberId)) return true;
  const policy = locator.unlock_policy || 'IMMEDIATE';
  if (policy === 'ONLY_ME') return false;
  if (policy === 'IMMEDIATE') return true;
  if (policy === 'EMERGENCY_ONLY' && isEmergencyActive) return true;
  return !!memberId && recipientsOf(locator).includes(memberId);
}

// Edit, change who sees it, remove: the person it is about, or its author.
export function registerCanManage(locator, memberId) {
  return !!locator && !!memberId && (locator.person_id === memberId || locator.created_by === memberId);
}

// A view is written down for anyone but the person the entry is about.
export function registerLogsView(locator, memberId) {
  return !!locator && !!memberId && locator.person_id !== memberId;
}

// What one member receives for one stored row. `details` false is the
// list: enough to find the entry, nothing that needs writing in the log.
//   - "Only me", to anyone else:  null. Not a locked row, nothing at all.
//   - any other rule, not allowed: a locked row with whose it is and the
//     kind. No title, no number, no notes, not even the person's own label.
//   - allowed: the entry.
export function registerRowFor(row, memberId, isEmergencyActive = false, { details = true } = {}) {
  if (!row) return null;
  const canView = canViewAssetLocator(row, memberId, isEmergencyActive);
  const policy = row.unlock_policy || 'IMMEDIATE';
  if (!canView && policy === 'ONLY_ME') return null;
  const base = {
    id: row.id,
    person_id: row.person_id,
    person_name: row.person_name || null,
    asset_category: row.asset_category,
    unlock_policy: policy,
    can_view: canView,
    can_manage: registerCanManage(row, memberId)
  };
  if (!canView) {
    return { ...base, kind_label: REGISTER_KIND_LABEL[row.asset_category] || REGISTER_KIND_LABEL.OTHER,
      institution_or_item: null, identifier_mask: null, physical_location_notes: null };
  }
  const out = {
    ...base,
    kind_label: (row.asset_category === 'OTHER' && row.custom_label) || REGISTER_KIND_LABEL[row.asset_category] || REGISTER_KIND_LABEL.OTHER,
    institution_or_item: row.institution_or_item,
    last_verified_at: row.last_verified_at || null,
    has_details: details
  };
  if (!details) return out;
  const value = row.approx_value == null ? null : Number(row.approx_value);
  Object.assign(out, {
    identifier_mask: row.identifier_mask || null,
    physical_location_notes: row.physical_location_notes,
    custom_label: row.custom_label || null,
    in_name_member: row.in_name_member || null,
    in_name_member_name: row.in_name_member_name || null,
    in_name_text: row.in_name_text || null,
    nominee: row.nominee || null,
    approx_value: value,
    value_currency: row.value_currency || null,
    value_text: value == null ? null : money(value, row.value_currency || null),
    due_on: row.due_day || null,
    note: row.note || null,
    updated_at: row.updated_at || null
  });
  // Who was chosen is the manager's business, not every chosen person's.
  if (out.can_manage) out.designated_recipients = recipientsOf(row);
  return out;
}

// ---------------------------------------------------------------------------
// NEVER A SECRET
// ---------------------------------------------------------------------------
export function maskAssetIdentifier(rawIdentifier) {
  const raw = String(rawIdentifier || '').trim();
  if (!raw) return 'Recorded';
  if (raw.length <= 4) return '*** ' + raw;
  return 'Ending in ...' + raw.slice(-4);
}

// An account or policy number keeps only its last 4. "Locker #42" is a
// label, not a number, and stays as typed: seven digits or more is a number.
export function registerIdentifier(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.replace(/\D/g, '').length >= 7) return maskAssetIdentifier(s.replace(/[^0-9a-z]/gi, ''));
  return s.slice(0, REGISTER_MAX.identifier);
}

// A password or a PIN written out. Where it is kept is fine ("the password
// is in the red diary"); the thing itself is not ("password: tiger@77").
// A postal PIN code has six digits and is not a secret: only four count.
export function registerSecretRisk(v) {
  const s = String(v || '');
  // "password is tiger@77", "pwd tiger@77", "pass: x", "login: rohan / x".
  // Saying where it is ("the password is in the red diary") stays allowed.
  const WHERE = '(?!\\s*(is\\s+)?(in|on|at|kept|with|written|inside|under|saved|stored)\\b)';
  if (new RegExp('\\b(password|passcode|passphrase|pwd|pass)\\b' + WHERE + '\\s*(is\\b|[-:=])\\s*\\S', 'i').test(s)
      || new RegExp('\\b(pwd|passwd)\\b' + WHERE + '\\s+\\S*[^a-z\\s]\\S*', 'i').test(s)
      || new RegExp('\\b(log ?in|user ?name|user ?id)\\b' + WHERE + '\\s*(is\\b|[:=])\\s*\\S', 'i').test(s)
      || /\b(password|passcode|passphrase|pwd)\s*[:=]\s*\S/i.test(s)
      || /\bpin\b\W{0,3}(is\s+|no\.?\s*)?\d{4}(?!\d)/i.test(s)
      || /\bpasscode\b\W{0,3}(is\s+)?\d{4,8}(?!\d)/i.test(s)) {
    return 'Parwah never keeps a password or a PIN. Write where it is kept, not what it is.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// WHAT MAY BE SAVED
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\r\n/g, '\n').trim();
const CODES = new Set(Object.values(CURRENCY));

export function registerDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null;
}

// Who sees it, on its own: used by "change who sees it" and by a full save.
export function registerWho(b) {
  const policy = b && b.unlockPolicy;
  if (!UNLOCK_POLICIES.includes(policy)) return { error: WHO_ERROR, field: 'who' };
  let people = [];
  if (policy === 'NOMINEES_ONLY') {
    const raw = Array.isArray(b.designatedRecipients) ? b.designatedRecipients : [];
    people = [...new Set(raw.filter(x => UUID.test(String(x || ''))).map(x => String(x).toLowerCase()))].slice(0, REGISTER_MAX.people);
    if (!people.length) return { error: 'Choose at least one person, or pick Only me.', field: 'people' };
  }
  return { value: { unlockPolicy: policy, designatedRecipients: people } };
}

// A whole entry. Returns { error, field } with a plain reason, or { value }.
// `risk` is noteRisk from _notesapi.mjs (card numbers, CVV, OTP, bank PINs).
export function registerClean(b, { risk = null } = {}) {
  b = b || {};
  const title = text(b.institutionOrItem);
  const where = text(b.physicalLocationNotes);
  if (!title) return { error: 'Say what it is.', field: 'title' };
  if (!where) return { error: 'Say where it is kept, or where its papers are.', field: 'where' };
  const category = ASSET_CATEGORIES.includes(b.category) ? b.category : 'OTHER';
  const label = category === 'OTHER' ? text(b.customLabel) : '';
  if (label.length > REGISTER_MAX.label) return { error: 'Keep your own name for it to 40 letters or fewer.', field: 'label' };
  const inNameText = text(b.inNameText);
  if (inNameText.length > REGISTER_MAX.inName) return { error: 'Keep the name it is in to 80 letters or fewer.', field: 'inName' };
  const nominee = text(b.nominee);
  if (nominee.length > REGISTER_MAX.nominee) return { error: 'Keep the nominee to 80 letters or fewer.', field: 'nominee' };
  const note = text(b.note);
  if (note.length > REGISTER_MAX.note) return { error: 'Keep the note to 500 letters or fewer.', field: 'note' };
  const rawId = text(b.identifierMask);

  // Never a secret, in any box.
  for (const [field, v] of [['title', title], ['label', label], ['identifier', rawId], ['where', where], ['inName', inNameText], ['nominee', nominee], ['note', note]]) {
    // An account number is cut to its last four anyway, and one in ten
    // passes the card check by chance. In the number box only a number of
    // card length (15 or 16 digits) is checked as a card.
    const digits = v.replace(/\D/g, '').length;
    const seen = field === 'identifier' && digits !== 15 && digits !== 16 ? v.replace(/\d[\d -]{5,}\d/g, ' ') : v;
    const why = (risk && risk(seen)) || registerSecretRisk(seen);
    if (why) return { error: why, field };
  }

  let inNameMember = null;
  if (b.inNameMemberId) {
    if (!UUID.test(String(b.inNameMemberId))) return { error: 'Choose someone in this family, or write the name.', field: 'inName' };
    inNameMember = String(b.inNameMemberId);
  }

  let approxValue = null;
  const rawValue = String(b.approxValue == null ? '' : b.approxValue).replace(/[,\s]/g, '');
  if (rawValue) {
    if (!/^\d+$/.test(rawValue) || Number(rawValue) <= 0) return { error: 'Write the value as a whole number, like 500000.', field: 'value' };
    if (Number(rawValue) > REGISTER_MAX.value) return { error: 'That value looks too large. Please check it.', field: 'value' };
    approxValue = Number(rawValue);
  }
  const valueCurrency = CODES.has(String(b.valueCurrency || '').toUpperCase()) ? String(b.valueCurrency).toUpperCase() : null;

  let dueOn = null;
  if (b.dueOn) {
    dueOn = registerDate(b.dueOn);
    if (!dueOn) return { error: 'Pick the date from the calendar.', field: 'due' };
  }

  const who = registerWho(b);
  if (who.error) return who;

  return { value: {
    category,
    customLabel: label || null,
    title: title.slice(0, REGISTER_MAX.title),
    identifier: registerIdentifier(rawId),
    where: where.slice(0, REGISTER_MAX.where),
    inNameMember,
    inNameText: inNameText || null,
    nominee: nominee || null,
    approxValue,
    valueCurrency,
    dueOn,
    note: note || null,
    unlockPolicy: who.value.unlockPolicy,
    designatedRecipients: who.value.designatedRecipients
  } };
}

// "Seen by Priya, 3 Nov": at most `cap` people per entry, newest first.
export function registerSeenBy(views, cap = 5) {
  const by = {};
  for (const v of views || []) {
    const list = by[v.locator_id] || (by[v.locator_id] = []);
    if (list.length < cap && !list.some(x => x.viewer_id === v.viewer_id)) list.push({ viewer_id: v.viewer_id, name: v.name || 'Someone in the family', at: v.at });
  }
  return by;
}
