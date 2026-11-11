// PASAND, THE RULES: what a like, a platform, a link and a recommendation may
// be. Imports nothing, so the gate can check every rule before npm install,
// and the app mirrors the same lists.
//
// Parwah never links an account and never keeps a password. Netflix, Prime
// Video and the rest have no sign-in for other apps, so a person only ticks
// what they have. Anything that looks like a password or a sign-in is
// refused with a plain reason, never trimmed away quietly.

export const PASAND_KINDS = [
  ['shows', '🎬', 'Shows and films'], ['music', '🎵', 'Music'], ['games', '🎮', 'Games'],
  ['books', '📚', 'Books'], ['food', '🍛', 'Food'], ['hobbies', '🎨', 'Hobbies'],
  ['sports', '🏏', 'Sports'], ['places', '🏞', 'Places'], ['other', '💛', 'Other']
];
export const PASAND_PLATFORMS = [
  ['netflix', 'Netflix'], ['prime', 'Prime Video'], ['hotstar', 'JioHotstar'], ['sonyliv', 'SonyLIV'],
  ['zee5', 'ZEE5'], ['youtube', 'YouTube'], ['spotify', 'Spotify'], ['jiosaavn', 'JioSaavn'],
  ['applemusic', 'Apple Music'], ['gaana', 'Gaana'], ['audible', 'Audible'], ['kindle', 'Kindle'], ['other', 'Other']
];
export const PASAND_REC_KINDS = [
  ['show', '📺', 'Show'], ['film', '🎬', 'Film'], ['song', '🎵', 'Song'], ['album', '💿', 'Album'],
  ['game', '🎮', 'Game'], ['book', '📚', 'Book'], ['eat', '🍛', 'Place to eat'], ['other', '💛', 'Anything']
];
export const PASAND_RESPONSES = [
  ['saved', 'Will try it'], ['loved', 'Loved it'], ['done', 'Seen it'], ['pass', 'Not for me']
];
export const PASAND_AUDIENCES = ['family', 'chosen', 'me'];
export const PASAND_MAX = { like: 60, likes: 40, title: 80, note: 200, reply: 200, link: 300, chosen: 60, perHour: 20, list: 100 };

const has = (list, key) => list.some(x => x[0] === key);
export const isLikeKind = (k) => has(PASAND_KINDS, k);
export const isPlatform = (k) => has(PASAND_PLATFORMS, k);
export const isRecKind = (k) => has(PASAND_REC_KINDS, k);
export const isResponse = (k) => has(PASAND_RESPONSES, k);
export function platformName(k) { const p = PASAND_PLATFORMS.find(x => x[0] === k); return p ? p[1] : ''; }
export function responseLabel(k) { const p = PASAND_RESPONSES.find(x => x[0] === k); return p ? p[1] : ''; }

export const NO_PASSWORD = 'Parwah never keeps a password or a sign-in. Leave it out and write only the name.';

// Does this read like a password or a sign-in? The word itself, a "login:"
// or "username =" label, an email address followed by a secret, or a link
// that carries one.
export function credRisk(v) {
  const s = String(v == null ? '' : v);
  if (!s.trim()) return null;
  // The bare word is a title (there is a film called Password); the word
  // with anything beside it is someone sharing one.
  if (/^\s*(the\s+)?(password|passcode)\s*$/i.test(s)) return null;
  if (/\b(pass ?words?|passwd|pass ?codes?|pwd)\b/i.test(s)) return NO_PASSWORD;
  if (/\b(log ?in|login id|sign ?in|user ?name|user ?id|pin|otp)\s*(is\b|[:=])/i.test(s)) return NO_PASSWORD;
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}\s*[:\/|]\s*\S{4,}/i.test(s)) return NO_PASSWORD;
  if (/[?&#](pass(word)?|pwd|passwd)=/i.test(s)) return NO_PASSWORD;
  return null;
}

// One short line of text. Too long is refused, not cut: a cut title is a
// different title. Returns { value } or { error }.
export function cleanText(v, max, what) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length > max) return { error: what + ' can be up to ' + max + ' letters. Make it shorter.' };
  const bad = credRisk(s);
  if (bad) return { error: bad };
  return { value: s };
}

// A plain https link, at most 300 letters, with no sign-in inside it.
// Empty is fine (the link is optional).
export function linkError(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (s.length > PASAND_MAX.link) return 'That link is too long. Use one of up to ' + PASAND_MAX.link + ' letters.';
  if (/\s/.test(s)) return 'A link has no spaces in it. Paste only the link.';
  if (!/^https:\/\//i.test(s)) return 'That link needs to start with https. Copy it again from the app or the browser.';
  let u;
  try { u = new URL(s); } catch (e) { return 'That is not a link. Copy it again from the app or the browser.'; }
  if (u.protocol !== 'https:') return 'That link needs to start with https. Copy it again from the app or the browser.';
  if (u.username || u.password) return NO_PASSWORD;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return 'That link does not have a real web address in it.';
  return credRisk(s);
}
export function cleanLink(v) {
  const err = linkError(v);
  if (err) return { error: err };
  return { value: String(v == null ? '' : v).trim() || null };
}

// Who may see a person's likes and platforms. The SQL in _pasand.mjs says
// the same thing; this is the rule in words the tests can read.
//   family: everyone in the circle (the default)
//   chosen: the owner and the members they named
//   me:     the owner only
export function canSee(ownerId, prefs, viewerId) {
  if (!ownerId || !viewerId) return false;
  if (ownerId === viewerId) return true;
  const a = prefs && PASAND_AUDIENCES.includes(prefs.audience) ? prefs.audience : 'family';
  if (a === 'family') return true;
  if (a === 'chosen') return Array.isArray(prefs.chosen) && prefs.chosen.includes(viewerId);
  return false;
}

// The line a person reads on Today and in a notification.
export function recLine(byName, title, platform) {
  const on = platform && platform !== 'other' ? platformName(platform) : '';
  return (byName || 'Someone') + ' recommends ' + title + ' for you.' + (on ? ' On ' + on + '.' : '');
}
