// A LINK FOR SOMEONE WHO WILL NEVER INSTALL THE APP: the rules, and nothing
// else. This file imports nothing, so the deploy gate can test it before
// npm install (site/tests/eldlinktest.mjs).
//
// Dadi has a basic smartphone and WhatsApp. A family adult sends her one
// personal link. It opens one page (site/public/apna/), with no sign-in,
// and that page can do a short list of things for HER and nobody else.
//
// What the page may show and do is decided here and repeated in the SQL of
// api/_eldlink.mjs. What it may never show is written down too, so a later
// change has to argue with a list.

export const ELD = {
  tokenBytes: 32,            // 256 bits from the system's secure random source
  days: 90,                  // a link runs out; an adult can keep it on
  contactsMax: 2,            // the people she can call from the page
  sayMax: 240,               // "a few words"
  itemsMax: 12,              // what the family sent her, newest first
  itemDays: 30,
  pollDays: 14,
  sosCancelSecs: 5,          // "I need help" waits this long, with a Cancel
  page: '/apna/',
  header: 'x-parwah-link'
};

// How often. Every one fails CLOSED in the server: a limiter that cannot
// count says no. (The SOS keeps the family's own SOS rule, which fails open
// on purpose: a limiter must never be why nobody hears a call for help.)
//   [how many, in how many seconds]
export const ELD_LIMITS = {
  create: [10, 86400],       // links made or renewed by one adult in a day
  createFamily: [30, 86400], // and by one family
  wrong: [30, 600],          // tries with a link that is not on, from one address
  act: [240, 3600],          // everything one link does in an hour
  say: [30, 86400],          // answers back in a day
  bless: [20, 3600],
  callme: [3, 86400],        // "Call me" pushes in a day
  callmeGap: [1, 3 * 3600],  // and one in three hours
  vote: [40, 3600],
  audio: [120, 3600]
};

// base64url of 32 bytes is 43 characters. Anything else is not looked up.
export const tokenShape = t => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);

export function expiryFrom(nowMs) { return new Date(nowMs + ELD.days * 86400000); }

// One answer for "is this link on?", with the clock passed in.
//   on       opened, and still within its days
//   expired  its days ran out (an adult can keep it on)
//   off      turned off by an adult, by the person, or because they joined
export function linkState(row, nowMs) {
  if (!row) return 'off';
  if (row.revoked_at) return 'off';
  const until = new Date(row.expires_at).getTime();
  if (!Number.isFinite(until) || until <= nowMs) return 'expired';
  return 'on';
}

// WHO MAY HAVE A LINK. Someone in the family by name only (nobody signs in
// as them), who is with us. A person on Parwah has the app; a remembered
// person is never sent anything.
export function mayHaveLink(member) {
  if (!member) return 'That person is not in this family';
  if (member.remembered) return member.name + ' is remembered here, so no link is made.';
  if (member.user_id || member.on_app) return member.name + ' is on Parwah already, and has the whole app.';
  return null;
}

// WHAT THE PAGE MAY SHOW. Six kinds of thing, each only when it was sent to
// her or to the whole family. The same test is in the queries.
export const ELD_SHOWS = ['ashirwad', 'shukriya', 'card', 'photo', 'question', 'poll'];
// And what it never shows, whoever asks and whatever id is sent.
export const ELD_NEVER = ['chat history', 'health', 'documents', 'the register', 'costs', 'location', 'private albums', 'other people\'s phone numbers'];

export function mayShow(kind, row, herId) {
  if (!row || !herId) return false;
  if (kind === 'ashirwad') return row.kind === 'bless' && row.from_member !== herId && (row.to_member === herId || row.to_member == null);
  if (kind === 'shukriya') return row.to_member === herId;
  if (kind === 'card') return (row.for_member === herId || row.for_member2 === herId) && !row.sealed && (row.entries || 0) > 0;
  if (kind === 'photo') return row.audience === 'family';
  if (kind === 'poll') return row.chat_kind === 'circle' && !row.closed;
  if (kind === 'question') return row.circle_kind !== 'group';
  return false;
}

// What she can answer, and how.
export const SAY_KINDS = ['heart', 'pranam', 'text', 'voice'];
export const SAY_ABOUT = ['ashirwad', 'shukriya', 'card', 'photo'];
export const SAY_WORDS = { heart: '❤️ Bahut accha laga', pranam: '🙏 Khush raho' };
export function sayClean(body) {
  const b = body || {};
  const kind = SAY_KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return { error: 'Tap one of the buttons' };
  const about = b.about && SAY_ABOUT.includes(b.about.kind) ? { kind: b.about.kind, id: String(b.about.id || '') } : null;
  if (!about) return { error: 'That is not here any more' };
  let text = null;
  if (kind === 'text') {
    text = String(b.text == null ? '' : b.text).replace(/\s+/g, ' ').trim().slice(0, ELD.sayMax);
    if (!text) return { error: 'Write a few words first' };
  }
  return { kind, about, text };
}

// The two people she can call: ids only, no doubles, at most two.
export function contactsClean(ids) {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= ELD.contactsMax) break;
  }
  return out;
}

// THE LINK IS SENT BY A PERSON, on WhatsApp, never by Parwah. The address is
// always wa.me and the number is digits only, so no value from anywhere can
// turn this into a link to another site. The key rides after the #, which a
// browser never sends to a server and never puts in a Referer.
export function linkPath(token) { return ELD.page + '#k=' + token; }
export function waDigits(phone) {
  const d = String(phone == null ? '' : phone).replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : '';
}
export function waLink(phone, text) {
  return 'https://wa.me/' + waDigits(phone) + '?text=' + encodeURIComponent(String(text || ''));
}
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
export function inviteWords(toName, fromName, url) {
  return 'Namaste ' + first(toName) + ', ' + first(fromName) + ' here. This is your own page for our family on Parwah. ' +
    'Tap it to tell us you are fine, hear our messages and send your blessings. No password is needed. ' + url;
}

// Words the family reads.
export const linkLabel = name => 'from ' + first(name) + '\'s link';
export const madeLine = (byName, name) => first(byName) + ' set up ' + first(name) + '\'s link: a page of their own that opens from WhatsApp, with no sign-in.';
export const fineLine = name => first(name) + ' said: I am fine';
export const callMeLine = name => first(name) + ' would like a call';
export const offLine = (name, how) => how === 'self' || how === 'declined'
  ? first(name) + ' turned off their link. Nothing is wrong: a phone call is welcome any time.'
  : how === 'joined' ? first(name) + ' is on Parwah now, so the link is closed. What they sent stays theirs.'
  : first(name) + '\'s link is turned off.';

// What the first screen says the family can see, in both languages. The
// page prints exactly this list, and the consent test reads it.
export const CONSENT_SEES = [
  { hi: 'जब आप "मैं ठीक हूँ" दबाएँ', en: 'When you tap "I am fine"' },
  { hi: 'आपका आशीर्वाद, जवाब और वोट', en: 'Your blessings, answers and votes' },
  { hi: 'आपने कब यह पन्ना खोला', en: 'When you last opened this page' },
  { hi: 'आपकी जगह सिर्फ़ तब, जब आप खुद भेजें', en: 'Where you are, only if you send it yourself' }
];

// THE TABLES. Kept here, taking the database as an argument, so the daily
// check-in (api/_familycare.mjs) can make them without importing the whole
// feature. Callers wrap this in schemaOnce.
export async function eldTables(sql) {
  await sql`create table if not exists eld_links (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    token_hash text not null unique,
    created_by uuid references members(id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    last_used_at timestamptz,
    consent_at timestamptz,
    contacts uuid[] not null default '{}',
    revoked_at timestamptz,
    revoked_how text
  )`;
  // One link that is on, for one person.
  await sql`create unique index if not exists eld_links_one on eld_links (member_id) where revoked_at is null`;
  await sql`create index if not exists eld_links_circle on eld_links (circle_id)`;
  // What she said back, under her own name.
  await sql`create table if not exists eld_says (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    to_member uuid references members(id) on delete cascade,
    about_kind text not null,
    about_id uuid,
    kind text not null,
    body text,
    audio text,
    audio_secs integer,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists eld_says_circle on eld_says (circle_id, created_at desc)`;
  // Once a day: "I am fine", claimed by this key.
  await sql`create table if not exists eld_days (
    member_id uuid not null references members(id) on delete cascade,
    day date not null,
    kind text not null,
    at timestamptz not null default now(),
    primary key (member_id, day, kind)
  )`;
}
