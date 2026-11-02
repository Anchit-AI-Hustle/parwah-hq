// THE SMALL RULES BEHIND FIVE FAMILY-CARE TOOLS, with nothing imported, so
// the deploy gate checks them before npm install (site/tests/caretoolstest.mjs).
//
//   quiet day      when a missed check-in becomes a nudge to the parent, and
//                  when, 30 minutes later, a call to the family
//   life cert      the Jeevan Pramaan window: from 1 October at 80 and over,
//                  otherwise 1 to 30 November; dates are as announced each
//                  year, so the app always says to confirm them
//   call rota      whose turn it is next
//   ask first      the plain rules a parent reads before paying anyone
//
// The words here are calm on purpose. A missed check-in is "has not checked
// in today", never an emergency, and nothing here watches anyone: the parent
// switches the check-in on themselves.

export const QUIET_GRACE_MIN = 30;   // nudge the parent at the time, the family this much later
export const AWAY_MAX_DAYS = 90;

// "11:00" or "9:5" -> "11:00" / "09:05"; anything else -> null.
export function validHHMM(v) {
  const m = /^([01]?\d|2[0-3]):([0-5]?\d)$/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  return String(+m[1]).padStart(2, '0') + ':' + String(+m[2]).padStart(2, '0');
}
export function validDay(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d) || d.toISOString().slice(0, 10) !== s ? null : s;
}
export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Where today stands for one person with a check-in time.
//   off      no time set
//   away     paused by "I'm away until"
//   ok       they said they are okay today
//   before   the time has not come yet
//   nudge    the time has passed: a gentle push to them
//   alert    30 minutes after that: one alert to the family
// deadlineMs is the check-in time today, as an instant (worked out by the
// caller on the person's own clock).
export function quietPhase({ checkinBy, awayUntil, today, checkedIn, deadlineMs, nowMs }) {
  if (!checkinBy) return 'off';
  if (awayUntil && today && awayUntil >= today) return 'away';
  if (checkedIn) return 'ok';
  if (nowMs < deadlineMs) return 'before';
  if (nowMs < deadlineMs + QUIET_GRACE_MIN * 60000) return 'nudge';
  return 'alert';
}

// him / her / them, from the family tree's gender.
export function pronoun(gender) { return gender === 'm' || gender === 'male' ? 'him' : gender === 'f' || gender === 'female' ? 'her' : 'them'; }
export function quietFamilyText(name, gender) { return name + ' has not checked in today. Give ' + pronoun(gender) + ' a call?'; }
export const QUIET_NUDGE = { title: '🧡 Sab theek?', body: "Tap I'm okay so the family knows." };

// THE LIFE CERTIFICATE WINDOW. Pensioners aged 80 and over may submit from
// 1 October; everyone else from 1 November; both until 30 November. Age is
// taken on 1 October of that year. A window already closed this year means
// next year's. Without a date of birth it is the November window, and the
// app says that a date of birth would tell.
export function lifecertWindow(dob, today) {
  const t = validDay(today);
  if (!t) return null;
  let year = +t.slice(0, 4);
  if (t > year + '-11-30') year += 1;
  const d = validDay(dob);
  let age = null;
  if (d) {
    const by = +d.slice(0, 4), md = d.slice(5);
    age = year - by - (md > '10-01' ? 1 : 0);
  }
  const superSenior = age !== null && age >= 80;
  return { year, age, dobKnown: !!d, superSenior,
           opens: year + (superSenior ? '-10-01' : '-11-01'), closes: year + '-11-30' };
}

// The acknowledgement number the bank or the app gives back. Letters,
// numbers and a few separators; never anything that looks like an Aadhaar
// number (12 digits in a row), because Parwah never keeps one here.
export function ackNoCheck(v) {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  if (!s) return { error: 'Type the acknowledgement number, or tap "It was rejected"' };
  if (s.length > 40) return { error: 'That is longer than an acknowledgement number' };
  if (/\d{12}/.test(s.replace(/[\s-]/g, ''))) return { error: 'That looks like an Aadhaar number. Only the acknowledgement number is kept here.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 /_.-]*$/.test(s)) return { error: 'Use only the letters and numbers from the acknowledgement' };
  return { value: s };
}

// Whose turn is next on a call rota (a list of member ids).
export function rotaNext(ids, idx) {
  const n = Array.isArray(ids) ? ids.length : 0;
  if (!n) return 0;
  const i = Number.isInteger(idx) ? idx : 0;
  return ((i + 1) % n + n) % n;
}

// A family safe word: a few plain words, never a sentence of secrets.
export function safeWordCheck(v) {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  if (!s) return { value: null };
  if (s.length > 40) return { error: 'Keep it short - one or two words' };
  if (!/^[\p{L}\p{M}\p{N} '-]+$/u.test(s)) return { error: 'Use letters and numbers only' };
  return { value: s };
}

// What a parent reads after "Someone is asking for money or an OTP".
// Plain rules, never a promise to spot a scam.
export const ASK_FIRST_RULES = [
  'Never share an OTP or your UPI PIN. Nobody real needs them.',
  'Police never arrest anyone on a video call.',
  'Banks never ask for KYC on a phone call.',
  'Hang up and call us. Your family is always the first call.'
];
export const CYBER_HELPLINE = '1930';
export const CYBER_SITE = 'https://cybercrime.gov.in';
export const JEEVAN_SITE = 'https://jeevanpramaan.gov.in';
