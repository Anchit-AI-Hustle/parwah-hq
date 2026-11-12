// BEING HEARD, AND ANSWERED: the rules only. api/_heardrules.mjs imports
// only _rememberrules.mjs, which imports nothing, so this runs in the
// deploy gate before npm install.
//
//  1. The mood: five choices with a word each, private unless chosen
//     otherwise, and never on the feed unless the member chose the family.
//  2. A private word ("Mujhe baat karni hai", "Maaf karna"): only the two
//     of them, and one reminder after a day, then silence.
//  3. Shukriya: the weekly suggestion is fair. Over time everyone is
//     suggested about equally often; never the viewer, never someone who is
//     remembered, never someone just thanked.
//  4. Votes: a tally with no names in it, every ballot counted once, who is
//     still to answer, and "for Dadi, by Rohan".
//  5. The family's weekly question: at least forty, plain and warm, no
//     banned word, and none comes back until all have been asked.
//  6. Coins: a small daily cap.
import * as H from '../../api/_heardrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

// ---------------------------------------------------------------- 1. mood
ok('five moods, each with an emoji AND a word in two tongues', H.MOODS.length === 5 && H.MOODS.every(m => m.e && m.t.length > 3 && m.en.length > 3 && m.k));
ok('two of the five are the low ones', H.MOODS.filter(m => m.low).length === 2 && !H.MOODS[0].low);
ok('the question is asked in the family\'s words', H.MOOD_ASK === 'Aaj kaisa lag raha hai?');
ok('an answer with no choice of who to tell is kept to the person', H.moodClean({ value: 'udaas' }).tell === 'self');
ok('a made-up choice of who to tell is also kept to the person', H.moodClean({ value: 'udaas', tell: 'everyone' }).tell === 'self');
ok('"tell only..." needs the one person', !!H.moodClean({ value: 'theek', tell: 'one' }).error && H.moodClean({ value: 'theek', tell: 'one', toId: id(2) }).toId === id(2));
ok('a mood that is not one of the five is refused', !!H.moodClean({ value: 'angry' }).error);
ok('the family is told only when chosen', H.moodOnFeed('family') && !H.moodOnFeed('self') && !H.moodOnFeed('one'));
const lowRow = { member_id: id(1), tell: 'self', to_member: null };
ok('a private answer: only its owner sees it', H.moodMaySee(lowRow, id(1)) && !H.moodMaySee(lowRow, id(2)));
ok('told to one: that one and the owner, nobody else', H.moodMaySee({ member_id: id(1), tell: 'one', to_member: id(2) }, id(2))
  && !H.moodMaySee({ member_id: id(1), tell: 'one', to_member: id(2) }, id(3)));
ok('told to the family: everyone', H.moodMaySee({ member_id: id(1), tell: 'family' }, id(9)));
ok('nobody at all sees with no viewer', !H.moodMaySee({ member_id: id(1), tell: 'family' }, null));
ok('the line has the word next to the emoji', /Mann udaas hai/.test(H.moodLine('Meena Sharma', 'udaas')) && /^Meena: /.test(H.moodLine('Meena Sharma', 'udaas')));

// ---------------------------------------------------------------- 2. baat
ok('three things to say, each in words', Object.keys(H.BAAT_KINDS).join() === 'talk,sorry,cantalk'
  && H.BAAT_KINDS.talk.title === 'Mujhe baat karni hai' && H.BAAT_KINDS.sorry.title === 'Maaf karna' && H.BAAT_KINDS.cantalk.title === 'Can we talk?');
ok('three ways to answer', Object.keys(H.BAAT_REPLIES).join() === 'call,come,voice');
const bc = H.baatClean({ kind: 'talk', toId: id(2), line: '  Thoda   time   chahiye  ' });
ok('a line is tidied, and "when it suits you" is the default', bc.line === 'Thoda time chahiye' && bc.when === H.BAAT_WHEN_DEFAULT);
ok('it needs one person', !!H.baatClean({ kind: 'talk' }).error && !!H.baatClean({ kind: 'talk', toId: 'everyone' }).error);
ok('an unknown kind is refused', !!H.baatClean({ kind: 'shout', toId: id(2) }).error && !!H.baatClean({ kind: 'constructor', toId: id(2) }).error);
ok('a long line is refused, not cut', !!H.baatClean({ kind: 'talk', toId: id(2), line: 'x'.repeat(H.BAAT_LINE_MAX + 1) }).error);
ok('"I will call you at" needs a time', !!H.baatReplyClean({ reply: 'call' }).error && H.baatReplyClean({ reply: 'call', at: '7 this evening' }).at === '7 this evening');
ok('"come, let us talk" needs nothing more', H.baatReplyClean({ reply: 'come' }).kind === 'come');
const t0 = Date.UTC(2026, 10, 12, 6, 0, 0);
const row = { from_member: id(1), to_member: id(2), created_at: new Date(t0).toISOString(), replied_at: null, reminded_at: null, closed_at: null };
ok('no reminder before a day has passed', !H.baatRemindDue(row, t0 + 23 * 3600000));
ok('one reminder after 24 hours', H.baatRemindDue(row, t0 + 24 * 3600000));
ok('then silence: never a second reminder', !H.baatRemindDue({ ...row, reminded_at: new Date(t0 + 86400000).toISOString() }, t0 + 9 * 86400000));
ok('no reminder once it is answered or put away', !H.baatRemindDue({ ...row, replied_at: new Date().toISOString() }, t0 + 2 * 86400000)
  && !H.baatRemindDue({ ...row, closed_at: new Date().toISOString() }, t0 + 2 * 86400000));
ok('only the two of them', H.baatMaySee(row, id(1)) && H.baatMaySee(row, id(2)) && !H.baatMaySee(row, id(3)) && !H.baatMaySee(row, null));
const push = H.baatPush('talk', 'Meena Sharma');
ok('the lock screen says who, never what', /^.+ Meena: Mujhe baat karni hai$/.test(push.title) && /Only you/.test(push.body));

// ---------------------------------------------------------------- 3. shukriya
const fam = [1, 2, 3, 4, 5, 6, 7].map(n => ({ id: id(n), remembered: n === 7 }));
ok('never the viewer', H.shukriyaPick({ viewerId: id(1), members: fam, thanked: [], suggested: {}, week: '2026-11-08' }) !== id(1));
ok('never someone who is remembered, even when nobody else is left', H.shukriyaPick({ viewerId: id(1), members: [fam[0], fam[6]], thanked: [], suggested: {}, week: '2026-11-08' }) === null);
ok('never someone thanked lately', (() => {
  for (let w = 0; w < 40; w++) { if (H.shukriyaPick({ viewerId: id(1), members: fam, thanked: [id(2), id(3)], suggested: {}, week: 'w' + w }) === id(2)) return false; }
  return true;
})());
ok('nobody left to suggest is null, not a guess', H.shukriyaPick({ viewerId: id(1), members: fam, thanked: [2, 3, 4, 5, 6].map(id), suggested: {}, week: 'w' }) === null);
ok('the person suggested least often is chosen', H.shukriyaPick({ viewerId: id(1), members: fam, thanked: [], suggested: { [id(2)]: 5, [id(3)]: 5, [id(4)]: 1, [id(5)]: 5, [id(6)]: 5 }, week: 'w' }) === id(4));
ok('two phones agree: the same week gives the same person', H.shukriyaPick({ viewerId: id(1), members: fam, thanked: [], suggested: {}, week: 'w9' })
  === H.shukriyaPick({ viewerId: id(1), members: fam.slice().reverse(), thanked: [], suggested: {}, week: 'w9' }));
// A whole year in a family of six (and one who is remembered): everyone
// gets a suggestion each week. Nobody ends far ahead of anybody else.
(() => {
  const counts = {};
  for (let w = 0; w < 52; w++) {
    for (const v of fam.filter(m => !m.remembered)) {
      const pick = H.shukriyaPick({ viewerId: v.id, members: fam, thanked: [], suggested: counts, week: 'week-' + w });
      counts[pick] = (counts[pick] || 0) + 1;
    }
  }
  const ns = fam.filter(m => !m.remembered).map(m => counts[m.id] || 0);
  ok('over a year everyone is suggested about equally often', Math.max(...ns) - Math.min(...ns) <= 2, ns.join());
  ok('the remembered person was never suggested', !counts[id(7)]);
  ok('every suggestion in the year is counted', ns.reduce((a, b) => a + b, 0) === 52 * 6);
})();
// The same, when two people thank often (so they are skipped for a while):
// the others still even out.
(() => {
  const counts = {}; const seen = new Set();
  for (let w = 0; w < 60; w++) {
    for (const v of fam.filter(m => !m.remembered)) {
      const pick = H.shukriyaPick({ viewerId: v.id, members: fam, thanked: v.id === id(1) ? [id(2)] : [], suggested: counts, week: 'k' + w });
      if (v.id === id(1) && pick === id(2)) seen.add('bad');
      counts[pick] = (counts[pick] || 0) + 1;
    }
  }
  const ns = fam.filter(m => !m.remembered).map(m => counts[m.id] || 0);
  ok('still even when someone is skipped for one viewer', Math.max(...ns) - Math.min(...ns) <= 2 && !seen.has('bad'), ns.join());
})();
ok('a shukriya is private to the two unless the writer chose the family', H.shukriyaClean({ toId: id(2), line: 'Thank you' }).audience === 'two'
  && H.shukriyaClean({ toId: id(2), line: 'x', audience: 'family' }).audience === 'family' && H.shukriyaClean({ toId: id(2), audience: 'world' }).audience === 'two');
ok('who may read a shukriya', H.shukriyaMaySee({ from_member: id(1), to_member: id(2), audience: 'two' }, id(2))
  && !H.shukriyaMaySee({ from_member: id(1), to_member: id(2), audience: 'two' }, id(3))
  && H.shukriyaMaySee({ from_member: id(1), to_member: id(2), audience: 'family' }, id(3)));

// ---------------------------------------------------------------- 4. votes
const t = H.tallyOf(3, [{ choices: [0] }, { choices: [0, 2] }, { choices: [1] }, { choices: [] }, { choices: [7] }, { choices: [0, 0] }]);
ok('a tally counts each ballot once per choice, and has no names in it', t.counts.join() === '3,1,1' && t.voters === 4 && !JSON.stringify(t).match(/name|member/));
ok('a child\'s ballot counts exactly as an adult\'s', H.tallyOf(2, [{ choices: [1], age: 9 }, { choices: [1], age: 70 }]).counts.join() === '0,2');
const dt = H.dateTally([{ id: 'a', at: 'x', votes: [{ a: 'yes' }, { a: 'yes' }, { a: 'no' }] }, { id: 'b', at: 'y', votes: [{ a: 'yes' }, { a: 'yes' }, { a: 'maybe' }] }, { id: 'c', at: 'z', votes: [] }]);
ok('a date tally counts Yes, Maybe and No', JSON.stringify(dt.rows[0]) === JSON.stringify({ id: 'a', at: 'x', yes: 2, maybe: 0, no: 1 }));
ok('the date most can make: most Yes, then fewest No', dt.best === 'b');
ok('no votes at all: no best date', H.dateTally([{ id: 'a', votes: [] }]).best === null);
const people = [{ id: id(1), name: 'Rohan Sharma' }, { id: id(2), name: 'Meena' }, { id: id(3), name: 'Kabir' }];
ok('who is still to answer', H.waitingFor(people, [id(1)]).join() === 'Meena,Kabir');
ok('"Waiting for" reads as a sentence', H.waitingLine(['Meena', 'Kabir']) === 'Waiting for Meena and Kabir' && H.waitingLine(['Meena']) === 'Waiting for Meena'
  && H.waitingLine([]) === 'Everyone has answered.' && /and 2 more$/.test(H.waitingLine(['A', 'B', 'C', 'D', 'E'])));
ok('a vote for someone not on the app says both names', H.proxyLabel('Dadi Sharma', 'Rohan Sharma') === 'for Dadi, by Rohan');
ok('the lock records the count', H.decidedLine('Diwali dinner', { yes: 4, maybe: 1, no: 0 }) === 'The date for Diwali dinner is locked: 4 yes, 1 maybe, 0 no.');

// ---------------------------------------------------------------- 5. the weekly question
const BANNED = /\b(elderly|burden|cures?|treat\w*|heal\w*|therapy|remedy|remedies|medicinal|prevents?|reverses?|clinically proven|doctor recommended|pain relief|guaranteed?|arthritis|diabetes)\b/i;
ok('at least forty questions', H.FAMILY_QUESTIONS.length >= 40, String(H.FAMILY_QUESTIONS.length));
ok('no question is there twice', new Set(H.FAMILY_QUESTIONS.map(q => q.toLowerCase())).size === H.FAMILY_QUESTIONS.length);
ok('no banned word in any question', !H.FAMILY_QUESTIONS.some(q => BANNED.test(q)), H.FAMILY_QUESTIONS.find(q => BANNED.test(q)));
ok('no long dash in any question', !H.FAMILY_QUESTIONS.some(q => /[–—]/.test(q)));
ok('each is short and plain: one or two sentences, under 100 letters, words of four syllables at most', H.FAMILY_QUESTIONS.every(q => q.length <= 100 && /[?.]$/.test(q)
  && q.split(/\s+/).every(w => w.replace(/[^a-z]/gi, '').length <= 11)), H.FAMILY_QUESTIONS.find(q => q.length > 100 || q.split(/\s+/).some(w => w.replace(/[^a-z]/gi, '').length > 11)));
ok('it is about India: our food, festivals and families', ['Diwali', 'Holi', 'Chai', 'Rakhi', 'mango', 'monsoon', 'Dadi', 'cricket'].every(w => H.FAMILY_QUESTIONS.some(q => q.includes(w))));
ok('nothing sad is asked', !H.FAMILY_QUESTIONS.some(q => /death|die|dying|funeral|illness|disease|sick|hospital|regret|too late/i.test(q)));
(() => {
  const seen = new Set(); let wk = '2026-11-08';
  for (let i = 0; i < H.FAMILY_QUESTIONS.length; i++) {
    seen.add(H.questionFor(wk, 'circle-a').no);
    const d = new Date(wk + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); wk = d.toISOString().slice(0, 10);
  }
  ok('no question comes back until every one has been asked', seen.size === H.FAMILY_QUESTIONS.length);
})();
ok('the same week gives a family the same question on every phone', H.questionFor('2026-11-08', 'c1').text === H.questionFor('2026-11-08', 'c1').text);
ok('a week starts on Sunday', H.weekOfDay('2026-11-12') === '2026-11-08' && H.weekOfDay('2026-11-08') === '2026-11-08' && H.weekOfDay('2027-01-02') === '2026-12-27');

// ---------------------------------------------------------------- 6. words, the card, coins
ok('a story told for someone carries both names', H.toldByLine('Dadi Sharma', 'Rohan Sharma') === 'told by Dadi, recorded by Rohan');
ok('a festival change says who and what', H.festChangeLine('Meena Sharma', 'Onam', '🌸', true) === 'Meena added Onam to the family\'s festivals 🌸'
  && H.festChangeLine('Meena', 'Onam', '🌸', false) === 'Meena took Onam off the family\'s festivals 🌸');
const ist = (y, m, d, h) => Date.UTC(y, m - 1, d, h - 5, -30);
ok('the evening before, from 6pm where the person lives', H.cardEveDue('2026-11-20', ist(2026, 11, 19, 18), 'Asia/Kolkata') && !H.cardEveDue('2026-11-20', ist(2026, 11, 19, 17), 'Asia/Kolkata'));
ok('or on the day, if no phone was awake that evening', H.cardEveDue('2026-11-20', ist(2026, 11, 20, 8), 'Asia/Kolkata'));
ok('never two days before, never after', !H.cardEveDue('2026-11-20', ist(2026, 11, 18, 20), 'Asia/Kolkata') && !H.cardEveDue('2026-11-20', ist(2026, 11, 21, 9), 'Asia/Kolkata'));
ok('the evening is the person\'s own, not India\'s', H.cardEveDue('2026-11-20', Date.UTC(2026, 10, 19, 23, 30), 'America/New_York') && !H.cardEveDue('2026-11-20', Date.UTC(2026, 10, 19, 20, 0), 'America/New_York'));
ok('coins stop at the day\'s cap', H.coinsLeftToday(0) === H.HEARD_COIN_CAP && H.coinsLeftToday(H.HEARD_COIN_CAP) === 0 && H.coinsLeftToday(99) === 0 && H.HEARD_COIN_CAP <= 10);
ok('one "new photos" push a day', H.ALBUM_PUSH_PER_DAY === 1 && H.ALBUM_REACTIONS.length === 5);
ok('the one-tap reply to a story', H.HEARD_TAP === 'Suna, bahut accha laga');

if (fails.length) { console.error('heardtest: ' + fails.length + ' FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`heardtest: ${pass}/${pass} checks pass`);
