// BEING HEARD, AND ANSWERED: the rules, with nothing else. Every feature
// here lets one member say something and makes sure someone can answer, and
// that no one's voice counts for more than another's.
//
// Imports only _rememberrules.mjs (which imports nothing), so the deploy
// gate checks all of it before npm install (site/tests/heardtest.mjs).
//
//   1. "Aaj kaisa lag raha hai?": five choices, each a word with its emoji,
//      and who is told: nobody, one person, or the family.
//   2. "Mujhe baat karni hai" and "Maaf karna": a private word to ONE
//      person, the answers they can give, and the one reminder after a day.
//   3. Shukriya: whom to suggest this week, so that over time everyone is
//      suggested about equally often. Never a count on the screen.
//   4. Votes: a tally that carries no names, who is still to answer, and a
//      vote given for someone not on the app ("for Dadi, by Rohan").
//   5. The family's weekly question: at least forty, one a week.
//   6. The words for a story recorded for someone, a festival change, and
//      the evening before a card's day.
import { wallIn } from './_rememberrules.mjs';

const first = n => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
export const isId = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

// A small steady hash: the same input always gives the same number, on
// every phone and every server.
export function steadyHash(s) {
  let h = 2166136261;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ------------------------------------------------------------ 1. the mood
// Five, never fewer: a word with every emoji, so no one has to read a face.
export const MOODS = [
  { k: 'khush',   e: '😄', t: 'Bahut accha',        en: 'Very good' },
  { k: 'theek',   e: '🙂', t: 'Theek hoon',         en: 'I am fine' },
  { k: 'bas',     e: '😐', t: 'Bas, chal raha hai', en: 'So-so' },
  { k: 'udaas',   e: '😔', t: 'Mann udaas hai',     en: 'A bit low', low: true },
  { k: 'mushkil', e: '😣', t: 'Mushkil din hai',    en: 'A hard day', low: true }
];
export const MOOD_ASK = 'Aaj kaisa lag raha hai?';
// Who is told. 'self' is the default and it is said first.
export const MOOD_TELL = ['self', 'one', 'family'];
export const moodOf = k => MOODS.find(m => m.k === k) || null;

// What a phone sent, made safe. An answer with no choice of who to tell is
// kept to the person: private is the default, never a guess.
export function moodClean(body) {
  const mood = moodOf(body && body.value);
  if (!mood) return { error: 'Pick how you feel today' };
  const tell = MOOD_TELL.includes(body.tell) ? body.tell : 'self';
  if (tell === 'one' && !isId(body.toId)) return { error: 'Choose the one person to tell' };
  return { value: mood.k, tell, toId: tell === 'one' ? String(body.toId) : null };
}
// May this viewer see this answer? The same rule is written into the SQL
// (api/_heard.mjs); this is the copy the unit test reads.
export function moodMaySee(row, viewerId) {
  if (!row || !viewerId) return false;
  if (row.member_id === viewerId) return true;
  if (row.tell === 'family') return true;
  return row.tell === 'one' && row.to_member === viewerId;
}
// Does this answer go on the family feed? Only when the member chose the
// family. A low answer is never put there by anything else.
export const moodOnFeed = (tell) => tell === 'family';
export function moodLine(name, k) {
  const m = moodOf(k);
  return m ? first(name) + ': ' + m.e + ' ' + m.t + ' (' + m.en + ')' : '';
}

// ------------------------------------------------------------ 2. baat
// A private word between two people. Nobody else ever reads one.
export const BAAT_KINDS = {
  talk:    { e: '🫶', title: 'Mujhe baat karni hai', en: 'I need to talk' },
  sorry:   { e: '🙏', title: 'Maaf karna',           en: 'I am sorry' },
  cantalk: { e: '🤝', title: 'Can we talk?',         en: 'Kya hum baat kar sakte hain?' }
};
export const BAAT_REPLIES = {
  call:  { e: '📞', title: 'I will call you at', en: 'Main call karunga' },
  come:  { e: '🫶', title: 'Aao, baat karte hain', en: 'Come, let us talk' },
  voice: { e: '🎙', title: 'A voice note', en: 'Awaaz mein jawab' }
};
export const BAAT_LINE_MAX = 240;
export const BAAT_WHEN_DEFAULT = 'When it suits you';
export const BAAT_REMIND_MS = 24 * 3600 * 1000;
export const BAAT_PER_DAY = 6;   // from one person to one person

export function baatClean(body) {
  const kind = Object.prototype.hasOwnProperty.call(BAAT_KINDS, body && body.kind) ? body.kind : null;
  if (!kind) return { error: 'Pick what you want to say' };
  if (!isId(body.toId)) return { error: 'Choose the one person this is for' };
  const line = clean(body.line, BAAT_LINE_MAX + 1);
  if (line.length > BAAT_LINE_MAX) return { error: 'Keep the line to ' + BAAT_LINE_MAX + ' letters, or say it by voice.' };
  const when = clean(body.when, 60) || BAAT_WHEN_DEFAULT;
  return { kind, toId: String(body.toId), line: line || null, when };
}
export function baatReplyClean(body) {
  const kind = Object.prototype.hasOwnProperty.call(BAAT_REPLIES, body && body.reply) ? body.reply : null;
  if (!kind) return { error: 'Pick how you want to answer' };
  const at = clean(body.at, 60);
  if (kind === 'call' && !at) return { error: 'Say when you will call, like "7 this evening"' };
  return { kind, at: kind === 'call' ? at : null };
}
// The one reminder: a day after it was sent, if there is no answer and no
// reminder has gone. After that, silence.
export function baatRemindDue(row, nowMs) {
  if (!row || row.replied_at || row.reminded_at || row.closed_at) return false;
  return nowMs - new Date(row.created_at).getTime() >= BAAT_REMIND_MS;
}
// Only the two of them. The SQL carries the same rule.
export const baatMaySee = (row, viewerId) => !!row && !!viewerId && (row.from_member === viewerId || row.to_member === viewerId);
export function baatPush(kind, fromName) {
  const k = BAAT_KINDS[kind] || BAAT_KINDS.talk;
  return { title: k.e + ' ' + first(fromName) + ': ' + k.title, body: 'Only you can see this. Open Parwah when you have a quiet minute.' };
}

// ------------------------------------------------------------ 3. shukriya
export const SHUKRIYA_LINE_MAX = 300;
export const SHUKRIYA_REST_DAYS = 28;      // "not thanked lately"
export const SHUKRIYA_AUDIENCE = ['two', 'family'];

// Whom to suggest to this viewer this week.
//   members:  everyone in the family [{ id, remembered }], on the app or not
//   thanked:  ids this viewer thanked in the last SHUKRIYA_REST_DAYS days
//   suggested: { id: how many times that person has been suggested, ever }
// The person suggested least often so far is chosen, so over time everyone
// is suggested about equally often. A tie is broken by a steady hash of the
// viewer and the week, so two phones agree and the same name is not always
// first. Never the viewer, never someone who is remembered, and null when
// there is no one left to suggest. The counts never leave the server.
export function shukriyaPick({ viewerId, members, thanked, suggested, week }) {
  const skip = new Set(thanked || []);
  const pool = (members || []).filter(m => m && m.id && m.id !== viewerId && !m.remembered && !skip.has(m.id));
  if (!pool.length) return null;
  const n = id => Math.max(0, Number((suggested || {})[id]) || 0);
  let best = null;
  for (const m of pool) {
    const key = [n(m.id), steadyHash(viewerId + '|' + week + '|' + m.id), m.id];
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) best = { id: m.id, key };
  }
  return best.id;
}
export function shukriyaClean(body) {
  if (!isId(body && body.toId)) return { error: 'Choose who you want to thank' };
  const line = clean(body.line, SHUKRIYA_LINE_MAX + 1);
  if (line.length > SHUKRIYA_LINE_MAX) return { error: 'Keep the line to ' + SHUKRIYA_LINE_MAX + ' letters, or say it by voice.' };
  const audience = SHUKRIYA_AUDIENCE.includes(body.audience) ? body.audience : 'two';
  return { toId: String(body.toId), line: line || null, audience };
}
export const shukriyaMaySee = (row, viewerId) => !!row && !!viewerId
  && (row.from_member === viewerId || row.to_member === viewerId || row.audience === 'family');

// ------------------------------------------------------------ 4. votes
// One person, one vote: a tally counts each ballot once, whoever cast it
// and however old they are. No names go in, so none can come out.
export function tallyOf(optionCount, ballots) {
  const counts = new Array(Math.max(0, optionCount | 0)).fill(0);
  let voters = 0;
  for (const b of ballots || []) {
    const picks = [...new Set((b && b.choices) || [])].filter(i => Number.isInteger(i) && i >= 0 && i < counts.length);
    if (!picks.length) continue;
    voters++;
    for (const i of picks) counts[i]++;
  }
  return { counts, voters };
}
// A date poll: Yes, Maybe and No for each date, and the date most can make.
export function dateTally(options) {
  const rows = (options || []).map(o => {
    const v = o.votes || [];
    const n = a => v.filter(x => x && x.a === a).length;
    return { id: o.id, at: o.at, yes: n('yes'), maybe: n('maybe'), no: n('no') };
  });
  let best = null;
  for (const r of rows) {
    if (!best || r.yes > best.yes || (r.yes === best.yes && (r.no < best.no || (r.no === best.no && r.maybe > best.maybe)))) best = r;
  }
  return { rows, best: best && (best.yes + best.maybe + best.no) > 0 ? best.id : null };
}
// Who has not answered yet. people: [{ id, name }], voted: ids.
export function waitingFor(people, voted) {
  const done = new Set(voted || []);
  return (people || []).filter(p => p && !done.has(p.id)).map(p => p.name);
}
export function waitingLine(names) {
  const list = (names || []).map(first);
  if (!list.length) return 'Everyone has answered.';
  if (list.length > 4) return 'Waiting for ' + list.slice(0, 3).join(', ') + ' and ' + (list.length - 3) + ' more';
  return 'Waiting for ' + (list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]);
}
// A vote given for someone who is not on the app, said plainly.
export const proxyLabel = (forName, byName) => 'for ' + first(forName) + ', by ' + first(byName);
// What a locked date records, in words, for the feed and the poll itself.
export function decidedLine(title, row) {
  if (!row) return 'The date for ' + title + ' is locked.';
  return 'The date for ' + title + ' is locked: ' + row.yes + ' yes, ' + row.maybe + ' maybe, ' + row.no + ' no.';
}

// ------------------------------------------------------------ 5. the weekly question
// One question for the whole family each week. Warm, about living, in
// plain words. Every member answers; an answer is read only by someone who
// has answered too, so nobody copies and nobody is left out.
export const FAMILY_QUESTIONS = [
  'Which dish from our kitchen do you miss the most when you are away?',
  'What is your favourite Diwali memory?',
  'Which song do you sing when nobody is listening?',
  'Chai or coffee? And who makes it best in our family?',
  'What is the best trip our family took together?',
  'Which festival do you wait for all year?',
  'Who in the family makes you laugh the most, and how?',
  'What is one thing you learnt from your mother?',
  'What is one thing you learnt from your father?',
  'Which street food can you never say no to?',
  'What was your favourite game as a child?',
  'Which film would you watch again with the whole family?',
  'What is your favourite thing about Sunday mornings at home?',
  'Which sweet do you want on your birthday?',
  'What is one small thing someone did for you this week that felt good?',
  'Which old photo of the family do you love, and why?',
  'What is your favourite monsoon memory?',
  'If the whole family had one free day together, what would you want us to do?',
  'Which school memory still makes you smile?',
  'What did you want to be when you were small?',
  'Which cricket match or film night at home do you still remember?',
  'What is one dish you want to learn to cook from someone in the family?',
  'Which family saying or joke do you hear in your head even now?',
  'What is the nicest thing about the house you grew up in?',
  'Which train or road journey do you remember best?',
  'Who taught you to ride a cycle, and how did it go?',
  'What do you like most about summer holidays?',
  'Which book, show or song would you ask everyone in the family to try?',
  'What is your favourite Holi memory?',
  'Which wedding in the family was the most fun, and why?',
  'What was the first thing you bought with your own money?',
  'Which mango is the best one? Tell us why you are right.',
  'What is one habit of yours that came from Dada, Dadi, Nana or Nani?',
  'Which place in India do you want to see with the family?',
  'What is the best gift you ever got?',
  'What do you do when you want to feel calm?',
  'Which teacher or friend from school do you still think about?',
  'What is one thing you are proud of from this year?',
  'Which winter food makes you happiest?',
  'What is your favourite Rakhi or Bhai Dooj memory?',
  'Which bedtime story or lori do you remember?',
  'What made you smile today?',
  'What is one thing you want to do together before this year ends?',
  'Which neighbour or family friend felt like family when you were growing up?'
];
// The week (the Sunday it starts on, YYYY-MM-DD) picks the question. Each
// family starts at its own place in the list, and the list is gone through
// in order, so no question comes back until all have been asked.
export function questionFor(week, circleId) {
  const [y, m, d] = String(week).split('-').map(Number);
  const weeks = Math.floor(Date.UTC(y, m - 1, d) / (7 * 86400000));
  const start = steadyHash(String(circleId || '')) % FAMILY_QUESTIONS.length;
  const no = (((weeks + start) % FAMILY_QUESTIONS.length) + FAMILY_QUESTIONS.length) % FAMILY_QUESTIONS.length;
  return { no, text: FAMILY_QUESTIONS[no] };
}
export function weekOfDay(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return new Date(Date.UTC(y, m - 1, d - t.getUTCDay())).toISOString().slice(0, 10);
}
export const SAWAAL_MAX = 600;

// ------------------------------------------------------------ 6. small words
// A story or an answer said by someone who is not on the app, and typed or
// recorded by a relative: both names, always.
export const toldByLine = (teller, recorder) => 'told by ' + first(teller) + ', recorded by ' + first(recorder);
// One feed line for one festival: who changed what.
export function festChangeLine(byName, festName, icon, added) {
  return first(byName) + (added ? ' added ' : ' took ') + festName + (added ? ' to' : ' off') + ' the family\'s festivals ' + (icon || '');
}
// The evening before a card's day (from 6pm where the person lives), or the
// day itself if no phone was awake that evening.
export const CARD_EVE_HOUR = 18;
export function cardEveDue(cardDay, nowMs, tz) {
  const w = wallIn(nowMs, tz), day = String(cardDay || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = w.date.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return (day === tomorrow && w.hour >= CARD_EVE_HOUR) || day === w.date;
}
// Coins for being heard: small, and capped for the day so they cannot be
// farmed. (The amounts live in api/_coins.mjs; the cap is one rule.)
export const HEARD_COIN_CAP = 6;
export const coinsLeftToday = (earnedToday) => Math.max(0, HEARD_COIN_CAP - Math.max(0, Number(earnedToday) || 0));
// One "new photos" push a day for a family, however many photos are added.
export const ALBUM_PUSH_PER_DAY = 1;
export const ALBUM_REACTIONS = ['❤️', '🙏', '😂', '👏', '😮'];
export const HEARD_TAP = 'Suna, bahut accha laga';
