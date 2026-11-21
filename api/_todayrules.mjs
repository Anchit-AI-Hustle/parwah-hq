// TODAY, FOR EACH PERSON: the rules only. Imports nothing, so the deploy
// gate runs its test before npm install.
//
//  1. A short name. "Rohan Sharma" is "Rohan", but a name is never cut at
//     the first space when the first word is an honorific (Shri, Shrimati,
//     Dr, श्री ...) or when the name is not in Latin letters: "Ask श्रीमती"
//     names nobody.
//  2. Which Today a person gets: the calm large one (senior mode), the young
//     one (under 18 by the family's one adult rule), or the family one.
//  3. "From the family": what is waiting for this person, in one order.
//     People before things; a request to join first for the adults who can
//     answer it; never an adult-only item for a child.
//  4. The bell for someone new: nothing from before they joined, and "asked
//     to join" and "joined" about the same person as one line.
//  5. The five places everything lives in, and where each old address lands.

// ---------------------------------------------------------------- 1. names
export const HONORIFICS = ['shri', 'shree', 'sri', 'shrimati', 'shrimathi', 'smt', 'srimati', 'sushri', 'kumari', 'km',
  'dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'col', 'capt', 'major', 'maj', 'gen', 'lt', 'justice', 'adv', 'er', 'ca', 'pt', 'pandit',
  'sardar', 'sardarni', 'begum', 'janab', 'late', 'sw', 'swami', 'thiru', 'thirumati', 'sau', 'chi'];
// The same in Devanagari and the other scripts never need listing: a name
// that is not in Latin letters is kept whole.
const LATIN = /^[\u0000-ɏḀ-ỿ\s.'’-]*$/;
export function shortName(name, fallback = '') {
  const full = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
  if (!full) return fallback;
  if (!LATIN.test(full)) return full;
  const first = full.split(' ')[0];
  if (HONORIFICS.indexOf(first.toLowerCase().replace(/\.+$/, '')) >= 0) return full;
  return first;
}

// ------------------------------------------------------- 2. which Today
// senior: the member's own senior-mode switch. minor: the one adult rule
// (api/_standingrules.mjs), worked out by the caller. A person in senior
// mode gets the calm screen whatever their age.
export function todayKind({ senior = false, minor = false } = {}) {
  if (senior) return 'senior';
  if (minor) return 'young';
  return 'family';
}
// What a young member's Today leads with, in order, and what it leaves out.
export const YOUNG_FIRST = ['games', 'polls', 'pasand', 'stories', 'ask', 'plans'];
export const YOUNG_HIDES = ['vault', 'aadhaar', 'ecard-admin', 'firstrun', 'readiness'];
// Senior mode: the big buttons, then From the family. No setup checklist.
export const SENIOR_HIDES = ['firstrun', 'readiness', 'quickadd'];
// Who gets a "how are they" card: the people a far-away adult looks after.
// Only an adult sees them; a card is never made for the viewer themself,
// for a child, or for someone who is remembered.
export function lookedAfter(members, viewerId) {
  return (members || []).filter(m => m && m.id !== viewerId && !m.remembered && !m.minor && (m.senior || m.role === 'parent'));
}

// ------------------------------------------------- 3. From the family
// One order for everyone. Lower comes first.
export const FROM_ORDER = ['join', 'word', 'message', 'day', 'blessing', 'thanks', 'plan', 'poll', 'card'];
// Kinds only an adult may be shown (the server never sends them to a child;
// this is the same rule again for whoever orders the list).
export const ADULT_ONLY = ['join'];
export function fromFamily(items, { minor = false, max = 12 } = {}) {
  const rank = k => { const i = FROM_ORDER.indexOf(k); return i < 0 ? FROM_ORDER.length : i; };
  return (items || [])
    .filter(x => x && x.kind && FROM_ORDER.indexOf(x.kind) >= 0 && !(minor && ADULT_ONLY.indexOf(x.kind) >= 0))
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank(a.x.kind) - rank(b.x.kind) || String(b.x.at || '').localeCompare(String(a.x.at || '')) || a.i - b.i)
    .slice(0, max).map(o => o.x);
}
// The first words of a message, for a card: one line, never mid-word noise.
export function firstWords(text, max = 80) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max), sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + '…';
}

// ------------------------------------------------- 4. the bell, when new
// events: [{ type, text, created_at }]. joinedAt: when the reader joined
// this family. Nothing from before that is theirs to read. "X has asked to
// join" followed by "X joined" is one line: the joined one.
export function joinWho(e) {
  const t = String((e && e.text) || '');
  let m = /^(.+?) has asked to join\b/.exec(t);
  if (m) return { kind: 'ask', who: m[1].trim().toLowerCase() };
  m = e && e.type === 'join' ? /^(.+?) joined the\b/.exec(t) : null;
  return m ? { kind: 'joined', who: m[1].trim().toLowerCase() } : null;
}
export function bellFor(events, joinedAt) {
  const since = joinedAt ? new Date(joinedAt).getTime() : NaN;
  const kept = (events || []).filter(e => e && (isNaN(since) || !e.created_at || new Date(e.created_at).getTime() >= since));
  const joined = new Set();
  for (const e of kept) { const j = joinWho(e); if (j && j.kind === 'joined') joined.add(j.who); }
  return kept.filter(e => { const j = joinWho(e); return !(j && j.kind === 'ask' && joined.has(j.who)); });
}

// ------------------------------------------------- 5. the five places
export const PLACES = ['home', 'chat', 'fun', 'people', 'menu'];
export const PLACE_NAME = { home: 'Today', chat: 'Chat', fun: 'Together', people: 'Family', menu: 'More' };
// Every screen, old and new, and the place it belongs to. `view` is the
// part of a screen that decides (the stories, recipes and album views of
// the old Health & contacts screen belong to Together).
export function placeOf(tab, view) {
  if (tab === 'memory') return view === 'stories' || view === 'recipes' || view === 'album' || view === 'settings' ? 'fun' : 'people';
  return ({ home: 'home', chat: 'chat', fun: 'fun', people: 'people', person: 'people',
    vault: 'menu', care: 'menu', ekta: 'menu', profile: 'menu', day: 'menu', notifs: 'menu', menu: 'menu' })[tab] || 'home';
}
// To do: one list, three filters at most.
export const TODO_FILTERS = ['mine', 'all', 'done'];
