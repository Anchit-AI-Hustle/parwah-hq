// THE LAUNCH LIST. One list for both halves of the brand.
//
// The site's standing rule is WhatsApp first and NO FAKE FORMS: a form ships
// only when a real backend receives it. Until now there was none, so the only
// way to join was to open WhatsApp and type - which works, and converts, but
// tells us nothing except a phone number, and loses everyone who will not
// start a chat with a stranger.
//
// It was almost built on Supabase. That project was never created (the org
// has overdue invoices) and this app already runs entirely on Neon, so a
// second database would have bought nothing but a second thing to keep alive.
//
// The field that earns its place is INTEREST. An adult child who wants the
// app and one who wants a grab bar for their mother's bathroom are different
// businesses with different launch dates. A list that cannot tell them apart
// cannot tell us which half to build next, and that is the only question the
// list exists to answer.
//
// This module imports only _phone.mjs, which imports nothing, so the deploy
// gate runs its tests on a fresh clone before npm install.
import { normPhone, phoneError } from './_phone.mjs';

export const INTERESTS = ['care', 'app', 'both'];
export const INTEREST_LABEL = {
  care: 'the care range',
  app: 'the family app',
  both: 'both',
};

// Long enough for a real name or a real address, short enough that the
// column is not a place to paste an essay into.
export const LIMIT = { name: 60, email: 160, city: 60, source: 40 };

export function normName(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

export function nameError(v) {
  const n = normName(v);
  if (!n) return 'Please tell us your name';
  if (n.length < 2) return 'That name looks too short - please write it in full';
  if (n.length > LIMIT.name) return 'That name is longer than we can store - please shorten it';
  return null;
}

// Lowercased, because a person who joins as Anchit@ and again as anchit@ is
// one person and should be one row.
export function normEmail(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

export function emailError(v) {
  const e = normEmail(v);
  if (!e) return 'Please give us an email address';
  if (e.length > LIMIT.email) return 'That email address is longer than we can store';
  // Deliberately not RFC 5322. The job is to catch a typo before it costs us
  // a launch announcement, not to litigate which exotic addresses are legal.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e)) {
    return 'That does not look like an email address - please check it';
  }
  return null;
}

export function normCity(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, LIMIT.city);
}

// Anything we do not recognise is 'both', because a wrong guess that keeps
// someone on the list beats a strict one that drops them.
export function normInterest(v) {
  const i = String(v == null ? '' : v).trim().toLowerCase();
  return INTERESTS.indexOf(i) >= 0 ? i : 'both';
}

// DPDP: consent is explicit or it is not consent. An unchecked box, a missing
// field and the string "false" all mean no. Only a deliberate yes counts, and
// the form values a browser actually sends for a ticked checkbox are 'on' and
// 'true', so those are the ones accepted.
export function consentGiven(v) {
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'on' || s === 'yes' || s === '1';
}

export function normSource(v) {
  return String(v == null ? '' : v).replace(/[^a-z0-9_-]/gi, '').slice(0, LIMIT.source) || 'site';
}

// THE HONEYPOT. A field no person can see or reach - off screen, out of the
// tab order, hidden from screen readers - that a form-filling bot fills
// because it fills everything. Named like a real field so it looks worth
// filling. A filled one is answered exactly as a real join would be, and
// nothing is stored: telling a bot it was caught teaches it the rule.
export const HONEYPOT = 'website';
export function isBot(body) {
  return String((body && body[HONEYPOT]) == null ? '' : body[HONEYPOT]).trim() !== '';
}

// The phone is optional, but a phone that IS given and is wrong is worth
// saying so about: it is the number we would have messaged.
export function phoneOf(body) {
  const raw = String((body && body.phone) || '').trim();
  if (!raw) return { phone: null, error: null };
  const cc = String((body && body.cc) || '+91');
  const n = normPhone(raw, cc);
  if (!n) return { phone: null, error: phoneError(cc) };
  // normPhone returns the parts; the column is one text field, so store the
  // E.164 form - the only one that can be dialled or messaged as-is.
  return { phone: n.e164, error: null };
}

// The first thing wrong, in the order a person filled the form in, so the
// message points at the field they are looking at.
export function joinError(body) {
  const b = body || {};
  const n = nameError(b.name);
  if (n) return n;
  const e = emailError(b.email);
  if (e) return e;
  const p = phoneOf(b);
  if (p.error) return p.error;
  if (!consentGiven(b.consent)) {
    return 'Please tick the box to say we may contact you about the launch';
  }
  return null;
}

// The row, once it is known to be good. Never call this without checking
// joinError first: it does not validate, it only shapes.
export function joinRow(body) {
  const b = body || {};
  return {
    name: normName(b.name),
    email: normEmail(b.email),
    phone: phoneOf(b).phone,
    city: normCity(b.city) || null,
    interest: normInterest(b.interest),
    consent: consentGiven(b.consent),
    source: normSource(b.source),
  };
}

// THE PROOF ON THE HOME PAGE. Two numbers a visitor can see, both counted
// from the real tables: people on this list, and people with a Parwah
// account. Anything that is not a whole number at or above zero is not a
// count, and the page falls back to its marked sample rather than show it.
export function proofCounts(waitlistRows, userRows) {
  const n = (v) => { const x = Number(v); return Number.isInteger(x) && x >= 0 ? x : null; };
  const waitlist = n(waitlistRows), users = n(userRows);
  if (waitlist === null || users === null) return null;
  return { waitlist, users };
}

// What the person is told, and it is the SAME whether they were already on
// the list or not. "You are already on the list" is a free answer to "does
// this address have an account here", asked one address at a time, and the
// list is not worth handing that out for.
export function joinedMessage(interest) {
  const what = INTEREST_LABEL[normInterest(interest)];
  return 'You are on the list for ' + what + '. We will message you when we open.';
}
