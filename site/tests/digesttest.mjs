// "Aaj kya hua", the daily digest: its rules, with no database, no network
// and no model. api/_digestrules.mjs imports nothing, so the deploy gate
// runs this on a fresh clone before npm install.
//
// What it proves:
//   - a busy day, a quiet day and a hard day (an SOS) each read plainly,
//     the most important thing first, in 3 to 6 sentences;
//   - a fact is stated once and neutrally: no word that judges a person;
//   - nothing private to someone else enters the list, even when it is
//     handed in by mistake;
//   - someone marked as remembered is named only on their own day;
//   - a model's reply is shown only when it is clean: not empty, not long,
//     no number that was not in the list, no advice, no judgement.
import { DG, DG_WEIGHT, DG_JUDGE, digestFacts, digestWrite, digestFirst, digestSince, digestQuiet,
         digestPrompt, digestCheck, digestClock, digestHour, digestMaySee, DIGEST_SYSTEM }
  from '../../api/_digestrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => cond ? pass++ : fails.push(name + (detail === undefined ? '' : ' -> ' + detail));

const TZ = 'Asia/Kolkata';
// 2026-11-12, as instants: 8:10 am, 4:05 pm and 4:20 pm in India.
const at = (h, m) => new Date(Date.UTC(2026, 10, 12, h, m) - 5.5 * 3600000).toISOString();
const people = [
  { id: 'rohan', name: 'Rohan' }, { id: 'papa', name: 'Papa' }, { id: 'maa', name: 'Maa' },
  { id: 'chachu', name: 'Chachu' }, { id: 'priya', name: 'Priya' }, { id: 'dada', name: 'Dadaji', remembered: true }
];
const sentences = (t) => t.split(/(?<=[.!?])\s+/).filter(Boolean);

// ---- the clock
ok('a time reads as 8:10 am in the viewer\'s zone', digestClock(at(8, 10), TZ) === '8:10 am', digestClock(at(8, 10), TZ));
ok('and 4:05 pm in the afternoon', digestClock(at(16, 5), TZ) === '4:05 pm');
ok('midnight is 12:00 am, noon is 12:00 pm', digestClock(at(0, 0), TZ) === '12:00 am' && digestClock(at(12, 0), TZ) === '12:00 pm');
ok('the same instant is another time elsewhere', digestClock(at(8, 10), 'Europe/London') === '2:40 am');
ok('an unknown zone falls back to UTC, never throws', digestClock(at(8, 10), 'Mars/Phobos') === '2:40 am');
ok('the hour of the day is read in the zone given (an injected clock, never the real hour)',
   digestHour(at(18, 0), TZ) === 18 && digestHour(at(17, 59), TZ) === 17 && digestHour(at(18, 0), 'UTC') === 12);

// ---- a busy day
const busy = {
  viewerId: 'rohan', word: 'family', tz: TZ, people,
  checkins: [{ id: 'papa', at: at(8, 10) }],
  missed: [],
  meds: [{ id: 'maa', taken: 2, skipped: 0, unmarked: 1 }, { id: 'papa', taken: 2, skipped: 0, unmarked: 0 }],
  plansTomorrow: [{ planId: 'p1', title: 'Sunday lunch', at: at(13, 0) }],
  plansMade: [{ planId: 'p1', title: 'Sunday lunch', by: 'rohan' }, { planId: 'p2', title: 'Diwali cleaning', by: 'priya' }],
  birthdays: ['chachu'],
  tasks: [{ id: 'priya', n: 2 }],
  stories: [{ storyId: 's1', id: 'papa', visibility: 'circle', shareWith: [] }],
  recipes: [{ recipeId: 'r1', by: 'maa', title: 'Aloo paratha' }],
  recs: [{ recId: 'x1', by: 'priya', title: 'Panchayat', to: ['rohan'] }],
  cards: [{ cardId: 'c1', by: 'priya', forIds: ['chachu'] }],
  joined: [{ id: 'priya', onApp: true }]
};
const bf = digestFacts(busy);
const btext = digestWrite(bf, 'family');
ok('a busy day: every fact has a kind, who, text, weight and key',
   bf.length >= 10 && bf.every(f => f.kind && typeof f.who === 'string' && f.text && f.weight > 0 && f.key), JSON.stringify(bf[0]));
ok('the list is ordered by weight, heaviest first', bf.every((f, i) => i === 0 || bf[i - 1].weight >= f.weight));
ok('the same day gives the same list whatever order the rows came in',
   JSON.stringify(digestFacts({ ...busy, meds: busy.meds.slice().reverse(), plansMade: busy.plansMade.slice().reverse() })) === JSON.stringify(bf));
ok('medicines not marked come before a birthday, a birthday before a check-in',
   bf.findIndex(f => f.kind === 'meds_unmarked') < bf.findIndex(f => f.kind === 'birthday')
   && bf.findIndex(f => f.kind === 'birthday') < bf.findIndex(f => f.kind === 'checkin'));
ok('"Papa checked in at 8:10 am."', bf.some(f => f.text === 'Papa checked in at 8:10 am.'), bf.map(f => f.text).join(' | '));
ok('medicines are counts, stated once, neutrally', bf.some(f => f.text === "1 of Maa's 3 medicine times today was not marked.")
   && bf.some(f => f.text === "Papa's medicines were all marked as taken today."));
ok('"Tomorrow is Chachu\'s birthday."', bf.some(f => f.text === "Tomorrow is Chachu's birthday."));
ok('a plan for tomorrow, with its time', bf.some(f => f.text === 'Tomorrow at 1:00 pm: Sunday lunch.'));
ok('a plan made today for tomorrow is said once, not twice', bf.filter(f => /Sunday lunch/.test(f.text)).length === 1
   && bf.some(f => f.text === 'Priya made a plan: Diwali cleaning.'));
ok('a recommendation sent to me', bf.some(f => f.text === 'Priya recommended something for you: Panchayat.'));
ok('a story, a recipe, a card, tasks and a new member', bf.some(f => f.text === 'Papa told a new story.')
   && bf.some(f => f.text === 'Maa added a family recipe: Aloo paratha.') && bf.some(f => f.text === 'Priya started a card for Chachu.')
   && bf.some(f => f.text === 'Priya finished 2 tasks today.') && bf.some(f => f.text === 'Priya joined the family.'));
ok('a busy day is written in 3 to 6 sentences, plus one line for the rest',
   sentences(btext).length >= DG.minSentences && sentences(btext).length <= DG.maxSentences + 1, sentences(btext).length + ': ' + btext);
ok('the heaviest fact is the first sentence', btext.startsWith(bf[0].text) && digestFirst(bf, 'family') === bf[0].text);
ok('what did not fit is counted, not dropped in silence', /more small things happened too\.$/.test(btext), btext);
ok('it stays short enough for a phone', btext.length <= 700, btext.length);

// ---- "You" for the viewer
const mine = digestFacts({ viewerId: 'papa', word: 'family', tz: TZ, people, checkins: [{ id: 'papa', at: at(8, 10) }],
  missed: ['papa'], meds: [{ id: 'papa', taken: 0, skipped: 0, unmarked: 2 }], birthdays: ['papa'] });
ok('the viewer is "You": checked in, your medicines, your birthday',
   mine.some(f => f.text === 'You checked in at 8:10 am.') && mine.some(f => f.text === 'Your medicines were not marked today.')
   && mine.some(f => f.text === 'Tomorrow is your birthday.'), mine.map(f => f.text).join(' | '));
ok('someone who checked in after an alert is not also "not checked in"', !mine.some(f => f.kind === 'checkin_missed'));
const two = digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people, checkins: [{ id: 'rohan', at: at(9, 0) }, { id: 'papa', at: at(8, 10) }, { id: 'maa', at: at(8, 30) }] });
ok('several check-ins are one sentence', two.length === 1 && two[0].text === 'Maa, Papa and you checked in today.', two.map(f => f.text).join(' | '));
const ann = digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people, anniversaries: [['papa', 'maa'], ['maa', 'papa']] });
ok('an anniversary is said once for the couple', ann.length === 1 && ann[0].text === 'Tomorrow is the anniversary of Maa and Papa.', ann.map(f => f.text).join(' | '));

// ---- a quiet day
const quiet = digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people });
ok('a quiet day: an empty list', quiet.length === 0);
ok('and one kind line', digestWrite(quiet, 'family') === 'It was a quiet day in the family today, with nothing new to tell.'
   && sentences(digestWrite(quiet, 'family')).length === 1 && digestFirst(quiet, 'family') === digestQuiet('family'));
ok('a group is called a group', digestWrite([], 'group') === 'It was a quiet day in the group today, with nothing new to tell.');
const small = digestWrite(digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people, checkins: [{ id: 'papa', at: at(8, 10) }] }), 'family');
ok('one small thing still makes three plain sentences', sentences(small).length === 3 && small.startsWith('Papa checked in at 8:10 am.'), small);

// ---- a hard day
const hard = digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people,
  sos: [{ sosId: 'k1', id: 'papa', at: at(16, 5), open: false, closedAt: at(16, 20) }, { sosId: 'k2', id: 'maa', at: at(19, 0), open: true }],
  missed: ['maa'], checkins: [{ id: 'papa', at: at(8, 10) }], tasks: [{ id: 'rohan', n: 1 }] });
const htext = digestWrite(hard, 'family');
ok('a hard day: the open SOS first, then the closed one', hard[0].text === 'Maa raised an SOS at 7:00 pm and it is still open.'
   && hard[1].text === 'Papa raised an SOS at 4:05 pm, and it was closed at 4:20 pm.', hard.map(f => f.text).join(' | '));
ok('then the missed check-in, said once, with no blame', hard[2].text === 'Maa has not checked in today.');
ok('the SOS leads the written note', htext.startsWith('Maa raised an SOS at 7:00 pm and it is still open.'), htext);
ok('"You finished a task today."', hard.some(f => f.text === 'You finished a task today.'));

// ---- the neutral voice: no word that judges a person, on any of these days
const everything = [btext, htext, small, digestWrite(mine, 'family'), digestWrite(two, 'family'), digestWrite(quiet, 'family')].join(' ');
const banned = /\b(forgot|forgets|forgotten|again|failed|fails|careless|lazy|ignored|neglect\w*|blame|fault|should|must|ought|sadly|unfortunately|bad|worse|naughty|worr\w+)\b/i;
ok('no judgement word in anything the writer says', !banned.test(everything), (everything.match(banned) || [])[0]);
ok('and none of the words the reply check refuses', !DG_JUDGE.test(everything), (everything.match(DG_JUDGE) || [])[0]);
ok('no advice and no medical meaning', !/\b(doctor|dose|dosage|take|rest|call them|remind)\b/i.test(everything));
ok('no dash of either long kind', everything.indexOf(String.fromCharCode(8211)) < 0 && everything.indexOf(String.fromCharCode(8212)) < 0);
ok('a missed medicine is "not marked", never "missed" or "forgot"', !/\b(missed|forgot)\b/i.test(digestWrite(digestFacts(busy), 'family')));

// ---- nothing private in the list
const SECRET = ['PRIVATE-NOTE-9911', 'REGISTER-LOCKER-7722', 'VAULT-AADHAAR-5533', 'HBA1C-8.4', 'SECRET-SHOW', 'SECRET-STORY', 'SURPRISE-CARD'];
const leaky = digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people,
  notes: [{ title: 'PRIVATE-NOTE-9911', private: true, by: 'priya' }],
  register: [{ label: 'REGISTER-LOCKER-7722', audience: 'me', by: 'papa' }],
  vault: [{ label: 'VAULT-AADHAAR-5533' }],
  health: [{ id: 'maa', value: 'HBA1C-8.4' }],
  recs: [{ recId: 'x9', by: 'priya', title: 'SECRET-SHOW', to: ['chachu'] }, { recId: 'x8', by: 'rohan', title: 'SECRET-SHOW mine', to: ['rohan'] }],
  stories: [{ storyId: 's9', id: 'papa', visibility: 'private', shareWith: [] }, { storyId: 's8', id: 'papa', visibility: 'some', shareWith: ['maa'] },
            { storyId: 's7', id: 'maa', visibility: 'circle', private: true }],
  cards: [{ cardId: 'c9', by: 'priya', forIds: ['rohan'], forName: 'SURPRISE-CARD' }],
  checkins: [{ id: 'papa', at: at(8, 10) }]
});
const ltext = JSON.stringify(leaky) + digestWrite(leaky, 'family') + digestPrompt(leaky).user;
ok('a private note, an "only me" register entry, a vault paper and a health number never enter the list',
   SECRET.every(s => ltext.indexOf(s) < 0), SECRET.filter(s => ltext.indexOf(s) >= 0).join());
ok('a recommendation between two other people is left out', !leaky.some(f => f.kind === 'rec'));
ok('a story for other people, or marked private, is left out', !leaky.some(f => f.kind === 'story'));
ok('a card for me stays a surprise', !leaky.some(f => f.kind === 'card'));
ok('what is left is only what I may see', leaky.length === 1 && leaky[0].text === 'Papa checked in at 8:10 am.');
ok('the second lock, on its own: stories, recommendations and cards',
   digestMaySee('stories', { id: 'papa', visibility: 'some', shareWith: ['rohan'] }, 'rohan')
   && digestMaySee('stories', { id: 'rohan', visibility: 'private' }, 'rohan')
   && !digestMaySee('stories', { id: 'papa', visibility: 'private' }, 'rohan')
   && digestMaySee('recs', { by: 'priya', to: ['rohan'] }, 'rohan') && !digestMaySee('recs', { by: 'priya', to: ['maa'] }, 'rohan')
   && !digestMaySee('cards', { forIds: ['rohan'] }, 'rohan') && digestMaySee('cards', { forIds: ['maa'] }, 'rohan')
   && !digestMaySee('recs', null, 'rohan') && !digestMaySee('stories', { visibility: 'circle' }, ''));
ok('no viewer, no list', digestFacts({ people, checkins: [{ id: 'papa', at: at(8, 10) }] }).length === 0 && digestFacts(null).length === 0);
ok('a person who is not in the family is never named', digestFacts({ viewerId: 'rohan', tz: TZ, people, checkins: [{ id: 'stranger', at: at(8, 0) }] }).length === 0);

// ---- someone remembered: only on their own day
const rem = digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people,
  checkins: [{ id: 'dada', at: at(8, 0) }], birthdays: ['dada'], missed: ['dada'], meds: [{ id: 'dada', taken: 0, unmarked: 2 }],
  tasks: [{ id: 'dada', n: 1 }], cards: [{ cardId: 'c5', by: 'priya', forIds: ['dada'] }], stories: [{ storyId: 's5', id: 'dada', visibility: 'circle' }],
  anniversaries: [['dada', 'maa']], joined: [{ id: 'dada' }], sos: [{ sosId: 'k5', id: 'dada', at: at(9, 0), open: true }] });
ok('someone remembered is never mentioned on an ordinary day', rem.length === 0, rem.map(f => f.text).join(' | '));
const remDay = digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people, remembrance: ['dada'], birthdays: ['dada'] });
ok('except on their day: "Tomorrow the family remembers Dadaji."', remDay.length === 1 && remDay[0].text === 'Tomorrow the family remembers Dadaji.');

// ---- "Since then"
const before = digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people, checkins: [{ id: 'papa', at: at(8, 10) }] });
const after = digestFacts({ viewerId: 'rohan', word: 'family', tz: TZ, people, checkins: [{ id: 'papa', at: at(8, 10) }],
  sos: [{ sosId: 'k7', id: 'maa', at: at(21, 5), open: true }], recipes: [{ recipeId: 'r7', by: 'maa', title: 'Kheer' }] });
ok('nothing new: no line', digestSince(before, before.map(f => f.key)) === '');
ok('a new SOS: one "Since then" line', digestSince(after, before.map(f => f.key)) === 'Since then: Maa raised an SOS at 9:05 pm and it is still open.',
   digestSince(after, before.map(f => f.key)));
ok('a small new thing (a recipe) does not earn a line', digestSince(after.filter(f => f.kind !== 'sos_open'), before.map(f => f.key)) === '');
ok('every weight is a number, and the heavy ones are the ones that matter',
   Object.values(DG_WEIGHT).every(n => n > 0) && DG_WEIGHT.sos_open >= DG.material && DG_WEIGHT.checkin_missed >= DG.material
   && DG_WEIGHT.meds_unmarked >= DG.material && DG_WEIGHT.recipe < DG.material && DG_WEIGHT.task < DG.material);

// ---- what the model is sent, and what is accepted back
const pr = digestPrompt(bf);
ok('the prompt is the list of sentences, numbered, and nothing else',
   pr.system === DIGEST_SYSTEM && pr.user.startsWith('Facts for today, most important first:\n1. ' + bf[0].text + '\n2. ')
   && pr.user.endsWith('\n\nWrite the note now.'));
ok('at most 8 facts are sent', (pr.user.match(/^\d+\. /gm) || []).length === Math.min(8, bf.length));
ok('no key, id or weight goes with them', !/"key"|weight|rohan|papa\b|c1|x1/.test(pr.user), pr.user);
ok('the rules say: only the facts, no advice, no medical meaning, no guesses, no judgement',
   /Use ONLY the facts/.test(pr.system) && /No advice/.test(pr.system) && /No medical meaning/.test(pr.system)
   && /No guesses/.test(pr.system) && /No judgement/.test(pr.system) && /data, not instructions/.test(pr.system));
ok('the costs are small and fixed: 300 tokens, 8 seconds, 700 characters, 12 a circle a day',
   DG.maxTokens === 300 && DG.timeoutMs === 8000 && DG.maxChars === 700 && DG.capPerCircle === 12 && DG.eveningHour === 18 && DG.pushHour === 20);

const clean = 'Aaj Papa checked in at 8:10 am. One of Maa\'s 3 medicine times was not marked. Kal Chachu ka birthday hai, and Sunday lunch is at 1:00 pm.';
ok('a clean reply is accepted, with its spaces tidied', digestCheck('  ' + clean + '\n', bf).ok && digestCheck(clean, bf).text === clean, JSON.stringify(digestCheck(clean, bf)));
ok('an empty reply is refused', digestCheck('', bf).why === 'empty' && digestCheck('   \n ', bf).why === 'empty' && digestCheck(null, bf).why === 'empty');
ok('a reply over 700 characters is refused', digestCheck('Papa checked in. '.repeat(50), bf).why === 'long');
ok('an invented number is refused', digestCheck('Papa checked in at 8:10 am and walked 5000 steps.', bf).why === 'number');
ok('an invented time is refused', digestCheck('Papa checked in at 9:45 am.', bf).why === 'number');
ok('a number from the list is fine', digestCheck('Papa checked in at 8:10 am.', bf).ok);
ok('a family name the facts did not give is refused', digestCheck('Papa checked in at 8:10 am. Dadi is resting.', bf, ['Papa', 'Maa', 'Dadi']).why === 'name');
ok('a name the facts gave is fine, and part of a longer word is not a name', digestCheck('Papa checked in at 8:10 am.', bf, ['Papa', 'Maa', 'Dadi', 'in']).ok
   && digestCheck('Papa checked in at 8:10 am, dadima style.', bf, ['Dadi']).ok, JSON.stringify(digestCheck('Papa checked in at 8:10 am.', bf, ['Papa', 'Maa', 'Dadi', 'in'])));
ok('a judgement is refused', digestCheck('Maa forgot her medicines again.', bf).why === 'judgement');
ok('advice is refused', digestCheck('Maa should see a doctor about her medicines.', bf).why === 'judgement');
ok('a family word that is in the list is allowed (a plan called "Doctor visit")',
   digestCheck('Kal Doctor visit hai.', [{ text: 'Tomorrow at 1:00 pm: Doctor visit.' }]).ok);
ok('a link, a list or a long dash is refused', digestCheck('See https://example.com', bf).why === 'format'
   && digestCheck('* Papa checked in.', bf).why === 'format' && digestCheck('Papa checked in ' + String.fromCharCode(8212) + ' all well.', bf).why === 'format');

if (fails.length) { console.error('digesttest: ' + fails.length + ' FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('digesttest: ' + pass + '/' + pass + ' checks pass');
