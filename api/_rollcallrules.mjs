// "SAB THEEK?" THE ROLL-CALL, as pure rules: no database, no clock of its
// own, no imports, so the unit test runs before npm install
// (site/tests/familyneedstest.mjs).
//
// A flood, a power cut, an earthquake: any adult asks the whole family at
// once. Each person answers "I am safe" or "I need help". It closes itself
// after 24 hours. One open roll-call a family, at most three in a day.
export const ROLLCALL_HOURS = 24;
export const ROLLCALL_PER_DAY = 3;
export const ROLLCALL_REMIND_MIN = 30;
export const ROLLCALL_ANSWERS = ['safe', 'help'];
export const ROLLCALL_REASONS = [
  ['flood', 'Heavy rain or flood'],
  ['outage', 'Power or network cut'],
  ['quake', 'Earthquake'],
  ['unrest', 'Trouble in the city'],
  ['other', 'Something else']
];
export const rollcallReason = (k) => { const r = ROLLCALL_REASONS.find(x => x[0] === k); return r ? r[1] : ROLLCALL_REASONS[4][1]; };
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';

// Is it still open at this moment? A roll-call past its 24 hours reads as
// closed even before the timer has written that down.
export function rollcallIsOpen(rc, nowMs) {
  if (!rc || rc.closed_at) return false;
  return new Date(rc.closes_at).getTime() > nowMs;
}
export function rollcallClosesAt(startMs) { return new Date(startMs + ROLLCALL_HOURS * 3600000); }

// May this member start one now?
//   adult: by the one adult rule; hasOpen: this family has one open;
//   startedToday: how many began in the last 24 hours.
export function rollcallMayStart({ adult, hasOpen, startedToday }) {
  if (!adult) return { ok: false, status: 403, error: 'An adult in the family starts a roll-call. In an emergency, press SOS.' };
  if (hasOpen) return { ok: false, status: 409, error: 'A roll-call is already open. Answer it, or close it first.' };
  if ((startedToday || 0) >= ROLLCALL_PER_DAY) {
    return { ok: false, status: 429, error: 'The family has been asked ' + ROLLCALL_PER_DAY + ' times today. Call the people you are worried about, or press SOS.' };
  }
  return { ok: true };
}

// May `me` answer for `target`? Everyone answers for themself. An adult may
// tick for someone else who has not answered: a relative who is not on
// Parwah, or someone whose phone is off, after speaking to them. Nobody is
// ever ticked who has passed away, and a person's own answer always wins.
export function rollcallMayAnswerFor({ meId, meAdult, target, existing }) {
  if (!target || target.remembered) return { ok: false, status: 404, error: 'Choose someone in this family' };
  if (target.id === meId) return { ok: true, self: true };
  if (!meAdult) return { ok: false, status: 403, error: 'An adult in the family answers for someone else.' };
  if (existing && existing.by_member === target.id) {
    return { ok: false, status: 409, error: first(target.name) + ' has already answered themself.' };
  }
  return { ok: true, self: false };
}

// The board: who is safe, who needs help, who has not answered.
//   members: [{ id, name, on_app, remembered }]
//   answers: [{ member_id, answer, by_member, by_name, at }]
// Someone who has passed away is never on it. A child or a teenager is not
// shown that someone needs help: to them that person is still "waiting".
export function rollcallBoard(members, answers, { viewerId = null, viewerMinor = false } = {}) {
  const by = new Map((answers || []).map(a => [a.member_id, a]));
  const safe = [], help = [], waiting = [];
  for (const m of members || []) {
    if (!m || m.remembered) continue;
    const a = by.get(m.id);
    const row = { id: m.id, name: m.name, onApp: !!m.on_app };
    if (!a || (viewerMinor && a.answer === 'help' && m.id !== viewerId)) { waiting.push(row); continue; }
    const told = a.by_member && a.by_member !== m.id ? { byId: a.by_member, byName: a.by_name || 'Someone' } : null;
    const out = { ...row, at: a.at, ...(told || {}), line: rollcallLine(m.name, a.answer, told && told.byName) };
    (a.answer === 'help' ? help : safe).push(out);
  }
  return { safe, help, waiting, everyone: waiting.length === 0 && help.length === 0 };
}
// "Dadi is safe" / "Rohan says Dadi is safe".
export function rollcallLine(name, answer, byName) {
  const what = answer === 'help' ? 'needs help' : 'is safe';
  return byName ? first(byName) + ' says ' + first(name) + ' ' + what : first(name) + ' ' + what;
}

// The line on the family feed when an answer is "I need help". The feed is
// read by everyone, children too, and a child is never shown that somebody
// else needs help: so the line says that an answer came, and not which.
export function rollcallFeedLine(name, byName) {
  return byName ? first(byName) + ' answered the roll-call for ' + first(name) : first(name) + ' answered the roll-call';
}

// The words of each push. Every one is a safety push: it comes through a
// quiet night, because that is when a flood comes.
export function rollcallAskPush(starter, reasonKey, note) {
  const why = rollcallReason(reasonKey);
  return { kind: 'safety', title: '🛟 Sab theek? ' + first(starter) + ' is asking everyone',
    body: why + (note ? ': ' + note : '') + '. Open Parwah and tap "I am safe" or "I need help".', url: '/#home?rollcall=1' };
}
export function rollcallRemindPush(starter) {
  return { kind: 'safety', title: '🛟 Sab theek? ' + first(starter) + ' is still waiting to hear from you',
    body: 'One tap is enough: "I am safe" or "I need help".', url: '/#home?rollcall=1' };
}
export function rollcallHelpPush(name, byName) {
  return { kind: 'safety', title: '🛟 ' + rollcallLine(name, 'help', byName),
    body: 'Call them now. If you cannot reach them, call 112.', url: '/#home?rollcall=1' };
}
export function rollcallDonePush() {
  return { kind: 'safety', title: '🛟 Sab theek: everyone has answered', body: 'The whole family is accounted for.', url: '/#home?rollcall=1' };
}
