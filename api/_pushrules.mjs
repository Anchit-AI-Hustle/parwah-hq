// FAIR NOTIFICATIONS, AND A PHONE WITH A POOR NETWORK - the rules.
//
// Imports nothing, so the deploy gate checks it before npm install
// (site/tests/pushrulestest.mjs). api/_push.mjs applies these inside
// pushCircle, the one place a push is ever sent, so no caller can forget:
//   - what kind a push is (chat, plans, games, album, care, digest), worked
//     out from what it says when the caller did not name one;
//   - which kinds always get through (an SOS, a missed check-in, a time the
//     person chose themselves) and which wait for the morning;
//   - quiet hours on the member's own clock, 10pm to 7am unless they change it;
//   - who is sent to first when the list is long;
//   - the one morning line: "While you slept: 6 messages in Family".
// Also here, because they are rules and not plumbing: which taps may be kept
// on a phone with no network and how old they may be, what a tiny error
// report may hold, and the key a sign-in limit should count by.

// The six switches a person sees, in the order the screen shows them.
export const PUSH_KINDS = ['chat', 'plans', 'games', 'album', 'care', 'digest'];
export const PUSH_KIND_WORDS = {
  chat:   { label: 'Chat messages', hint: 'A message, a mention, a new group.' },
  plans:  { label: 'Plans and festivals', hint: 'A new plan, a date vote, a card to sign.' },
  games:  { label: 'Games', hint: 'Your turn, or someone opened a game.' },
  album:  { label: 'Album and stories', hint: 'A new story, or the weekly question.' },
  care:   { label: 'Care alerts', hint: 'Tasks, medicines, visits and renewals.' },
  digest: { label: 'Aaj kya hua', hint: 'The evening line about the day.' }
};
export const QUIET_FROM = 22 * 60, QUIET_TO = 7 * 60;
export const HOME_TZ = 'Asia/Kolkata';
export const PUSH_CAP = 60;

// What a push is, from what it says. A caller may name it (payload.kind);
// most of the hundred-odd call sites were written before kinds existed, so
// the words decide. First match wins; the order is the rule.
//   through: true  - delivered even in quiet hours, and no switch stops it.
//   timed:   true  - a time the person chose (their own medicine, a task
//                    reminder): quiet hours do not hold it, the switch can.
// Every pattern starts at the first character with the mark its own caller
// writes, so a chat called "Mum is safe" (whose push starts with 💬) is
// never mistaken for one. A caller that names its kind is believed first.
const SAFETY = [
  /^🆘/, /^🧡 .+ has not checked in today$/, /^🧡 .+ could do with a call( - it is your turn today)?$/, /^🏥 .+ is in hospital$/,
  /^📵 .+ has lost their phone$/, /^🛡 .+ is asking the family first$/, /^🧡 .+ has seen it, calling you now$/,
  /^✅ .+ marked you safe$/, /^✅ .+ is alright$/, /^✅ .+ is safe$/, /^✅ .+ did check in$/, /^✅ .+ reached .+ safely$/,
  /^🎙 A recording from /, /^🧡 .+ is on it$/, /^📞 (Parwah is calling|Calling|Call) .+ for /, /^(?![💬📊👥➕])\S+ marked you as no longer with us$/u,
  /^🧡 .+ is calling /, /^🧡 .+ has not tapped Reached safely yet\. A call may help\.$/,
  /^🔑 .+ cannot get in$/, /^🔑 Someone asked to reset your PIN$/, /^🔑 .+ said yes to a new PIN for you$/, /^🔒 Wrong PIN tries on your number$/, /^📱 New sign-in on another phone$/
];
const TIMED = [/^💊 Your /, /^⏰/, /^🧡 Sab theek\?/, /^🌙 Aaj kya hua/];
const BY_WORDS = [
  ['digest', [/^🌙 Aaj kya hua/]],
  ['chat',   [/^💬/, /^📊/, /^👥/, /^➕/]],
  ['games',  [/^🎲/, /^⭕/, /^🎪/, /is waiting for you$/]],
  ['album',  [/^📖/, /^🖼/, /^📷/, /^🪔/, /^💛 .+ recommends /]],
  ['plans',  [/^🙌 .+ is coming$/, /^❌ Plan cancelled/, /^🗳/, /^🗓/, /^🎉/, /^💌/, /^🍿/, /^📍 .+ is in /, / on now$/,
              / together$/, / is today$/, / in \d+ days$/, /^✅ Settled: /, /^💰/]],
  ['care',   [/^💊/, /^🤝/, /^🔔/, /^✔/, /^↩/, /^⏰/, /^🩺/, /^🕘/, /^🏥/, /^📒/, /^🕚/, /^📞/, /^🧳/, /^🏠/, /^📱/, /^🙋/,
              /^🙌/, /^📅/, /^🧡 Sab theek\?/, /daily check-in/]]
];
export function pushKind(payload) {
  const p = payload || {};
  const title = String(p.title || '');
  if (p.urgent) return { kind: 'urgent', through: true, timed: false };
  if (p.ring) return { kind: 'ring', through: true, timed: false };
  if (p.kind === 'safety') return { kind: 'safety', through: true, timed: false };
  const timed = !!p.timed || TIMED.some(re => re.test(title));
  // A KIND THE CALLER NAMED IS BELIEVED BEFORE ANY WORDS ARE READ: a chat
  // message says it is a chat message, whatever the chat is called.
  if (PUSH_KINDS.includes(p.kind) || p.kind === 'other') return { kind: p.kind, through: false, timed };
  if (SAFETY.some(re => re.test(title))) return { kind: 'safety', through: true, timed: false };
  for (const [kind, res] of BY_WORDS) if (res.some(re => re.test(title))) return { kind, through: false, timed };
  // Anything else (the vault, a join, a code change): no switch turns it
  // off, and it still waits for the morning.
  return { kind: 'other', through: false, timed };
}

// ---------------- the member's own clock ----------------
export function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (e) { return null; }
}
// Minutes after midnight, on the wall clock of that zone.
export function localMinutes(nowMs, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: validTz(tz) || HOME_TZ, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' });
  const p = {};
  f.formatToParts(new Date(nowMs)).forEach(x => { p[x.type] = +x.value; });
  return (p.hour % 24) * 60 + p.minute;
}
// From 22:00 to 07:00 wraps midnight; from 13:00 to 15:00 does not. The
// start minute is quiet, the end minute is not. The same time twice is "no
// quiet hours".
export function inQuiet(mins, from, to) {
  if (from === to) return false;
  return from < to ? (mins >= from && mins < to) : (mins >= from || mins < to);
}

// ---------------- what a person may choose ----------------
export function defaultPrefs() {
  const kinds = {};
  PUSH_KINDS.forEach(k => { kinds[k] = true; });
  return { quiet: true, from: QUIET_FROM, to: QUIET_TO, kinds };
}
function hhmmToMins(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440) return v;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(v == null ? '' : v).trim());
  return m ? +m[1] * 60 + +m[2] : null;
}
export function minsToHHMM(n) { return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
// What was saved (or sent), made whole: anything missing or odd is the default.
export function cleanPrefs(input) {
  const d = defaultPrefs(), i = input && typeof input === 'object' ? input : {};
  const from = hhmmToMins(i.from), to = hhmmToMins(i.to);
  const out = { quiet: i.quiet === undefined ? d.quiet : !!i.quiet, from: from === null ? d.from : from, to: to === null ? d.to : to, kinds: {} };
  const k = i.kinds && typeof i.kinds === 'object' ? i.kinds : {};
  PUSH_KINDS.forEach(x => { out.kinds[x] = k[x] === undefined ? true : !!k[x]; });
  return out;
}

// send | hold | drop, for one person at one moment.
//   drop: they turned that kind off, or muted that chat.
//   hold: it is their night; it is counted for the one morning line.
export function decide(kindInfo, prefs, nowMs, tz, { muted = false } = {}) {
  const k = kindInfo || {}, p = cleanPrefs(prefs);
  if (k.through) return 'send';
  if (muted) return 'drop';
  if (PUSH_KINDS.includes(k.kind) && p.kinds[k.kind] === false) return 'drop';
  if (k.timed) return 'send';
  if (p.quiet && inQuiet(localMinutes(nowMs, tz), p.from, p.to)) return 'hold';
  return 'send';
}

// ---------------- who is sent to, when the list is long ----------------
// Urgent goes to every device. Anything else keeps a cap, dealt out one
// device per person per round (newest device first), so a family with many
// phones never leaves one member with none.
export function capOrder(subs, cap = PUSH_CAP) {
  const by = new Map();
  for (const s of subs || []) {
    const key = String(s.owner || s.user_id || s.member_id || s.id);
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(s);
  }
  const lists = [...by.values()].map(l => l.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)));
  const out = [];
  for (let round = 0; out.length < cap; round++) {
    let any = false;
    for (const l of lists) {
      if (round < l.length) { any = true; if (out.length < cap) out.push(l[round]); }
    }
    if (!any) break;
  }
  return out;
}

// ---------------- whose turn the timer starts with ----------------
// The timer stops starting new families when its time is spent. The list is
// put in one fixed order and turned so it begins where the last run stopped.
export function rotateFrom(ids, next) {
  const s = [...new Set((ids || []).map(String))].sort();
  if (!next) return s;
  let i = s.findIndex(x => x >= String(next));
  if (i < 0) i = 0;
  return s.slice(i).concat(s.slice(0, i));
}

// ---------------- the morning line ----------------
const HELD_WORD = {
  chat: ['message', 'messages'], plans: ['plan update', 'plan updates'], games: ['game move', 'game moves'],
  album: ['story', 'stories'], care: ['care alert', 'care alerts'], digest: ['day note', 'day notes'], other: ['update', 'updates']
};
// rows: [{ kind, family, n }]  →  { title, body }, or null when nothing waited.
export function morningText(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const n = +r.n || 0; if (n < 1) continue;
    const kind = HELD_WORD[r.kind] ? r.kind : 'other', fam = String(r.family || 'your family');
    const key = fam + '\n' + kind;
    by.set(key, { fam, kind, n: (by.get(key) ? by.get(key).n : 0) + n });
  }
  if (!by.size) return null;
  const order = ['chat', 'care', 'plans', 'album', 'games', 'digest', 'other'];
  const parts = [...by.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.fam.localeCompare(b.fam))
    .map(x => x.n + ' ' + HELD_WORD[x.kind][x.n === 1 ? 0 : 1] + ' in ' + x.fam);
  const shown = parts.slice(0, 4);
  return { title: '🌅 While you slept', body: shown.join(', ') + (parts.length > shown.length ? ', and more' : '') + '. Open Parwah to see.' };
}

// Which family a push is from, said only to someone who is in more than one.
export function withFamily(body, familyName, families) {
  const b = String(body || ''), f = String(familyName || '').trim();
  if (!f || !(families > 1) || b.endsWith(' · ' + f)) return b;
  return (b ? b + ' · ' : '') + f;
}

// ---------------- a tap made with no network ----------------
// Only these may arrive late with the time they were pressed. An SOS is
// never queued: it needs a person to know NOW that it did not go.
export const OFFLINE_KINDS = ['checkin', 'pill', 'pulse'];
export const OFFLINE_MAX_AGE_MS = 24 * 3600000;
export const OFFLINE_FUTURE_MS = 2 * 60000;
export function cleanClientId(v) {
  const s = String(v == null ? '' : v);
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}
// The time a queued tap may claim. → { at: Date|null, late: boolean } or
// { error }. No time sent: it is now. A phone clock a little ahead is now.
// Older than a day, or far in the future, is refused: the family would be
// told something about a day that has gone.
export function clientTime(type, at, nowMs = Date.now()) {
  if (at === undefined || at === null || at === '') return { at: null, late: false };
  if (!OFFLINE_KINDS.includes(type)) return { error: 'That cannot be sent late.' };
  const t = typeof at === 'number' ? at : Date.parse(String(at));
  if (!Number.isFinite(t)) return { error: 'That time is not one we can read.' };
  if (t > nowMs + OFFLINE_FUTURE_MS) return { error: 'This phone\'s clock looks wrong. Check the date and time, then try again.' };
  if (t > nowMs) return { at: null, late: false };
  if (nowMs - t > OFFLINE_MAX_AGE_MS) return { error: 'That was more than a day ago, so it was not sent. Tap it again for today.' };
  // A few seconds on a slow network is not "late".
  return { at: new Date(t), late: nowMs - t > 60000 };
}

// ---------------- the tiny error report ----------------
// What went wrong and where, and nothing about anyone: no message text, no
// names, no numbers, no address beyond the file. Long digit runs (a phone),
// emails and ids are taken out of the message before it is kept.
export function cleanReport(b) {
  const i = b && typeof b === 'object' ? b : {};
  const scrub = s => String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\+?\d[\d\s-]{5,}\d/g, '[number]')
    .replace(/(["'`]).{12,}?\1/g, '[text]')
    .replace(/\s+/g, ' ').trim();
  const message = scrub(i.message).slice(0, 160);
  if (!message) return null;
  // file:line:col, the file by its last part only (no query, no hash).
  let where = '';
  const w = /^(.*?)(?::(\d{1,7}))?(?::(\d{1,7}))?$/.exec(String(i.where == null ? '' : i.where).slice(0, 400));
  if (w && w[1]) {
    const file = w[1].replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop() || 'index';
    where = (/^[\w.-]{1,60}$/.test(file) ? file : 'page') + (w[2] ? ':' + w[2] : '') + (w[3] ? ':' + w[3] : '');
  }
  const version = /^[\w.+-]{1,40}$/.test(String(i.version || '')) ? String(i.version) : '';
  const vp = /^(\d{2,5})x(\d{2,5})$/.exec(String(i.viewport || ''));
  return { message, where, version, viewport: vp ? vp[1] + 'x' + vp[2] : '' };
}
export const REPORT_KEEP_DAYS = 14;

// ---------------- the key a limit counts by ----------------
// Many phones share one mobile address, so a limit counted by address alone
// locks out a whole neighbourhood. The device says a random id of its own
// (X-Parwah-Device); with it, the key is that device at that address.
// A caller can change the id at will, so a limit keyed this way must sit
// beside a looser one keyed by the address alone, never replace it.
export function cleanDevice(v) {
  const s = String(Array.isArray(v) ? v[0] : v == null ? '' : v);
  return /^[A-Za-z0-9_-]{16,64}$/.test(s) ? s : null;
}
export function limitKeyOf(ip, device) {
  const d = cleanDevice(device), a = String(ip || 'unknown').slice(0, 64);
  return d ? a + '|' + d : a;
}
