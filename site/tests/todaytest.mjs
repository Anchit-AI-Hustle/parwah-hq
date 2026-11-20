// TODAY, FOR EACH PERSON: the rules only. api/_todayrules.mjs imports
// nothing, so this runs in the deploy gate before npm install.
//
//  1. Short names: never cut at the first space after an honorific, or when
//     the name is not in Latin letters.
//  2. Which Today a person gets: senior, young, or the family one.
//  3. "From the family": one order, a request to join first, and never an
//     adults-only item for a child.
//  4. The bell of someone new: nothing from before they joined, and "asked
//     to join" + "joined" as one line.
//  5. Five places, and every old address still lands in one of them.
//  6. The app's own copy of these rules (in site/public/index.html) gives
//     the same answers: it is run here, from the page's source.
import { readFileSync } from 'node:fs';
import * as T from '../../api/_todayrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- 1. names
const NAMES = [
  ['Rohan Sharma', 'Rohan'], ['  Meena   Sharma ', 'Meena'], ['Papa', 'Papa'], ['', ''], [null, ''],
  ['Shri Ramesh Sharma', 'Shri Ramesh Sharma'], ['Shrimati Kamla Devi', 'Shrimati Kamla Devi'], ['Smt. Kamla Devi', 'Smt. Kamla Devi'],
  ['Dr Mehta', 'Dr Mehta'], ['Dr. Anil Mehta', 'Dr. Anil Mehta'], ['DR Anil', 'DR Anil'], ['Col Singh', 'Col Singh'],
  ['श्रीमती कमला देवी', 'श्रीमती कमला देवी'], ['श्री रमेश', 'श्री रमेश'], ['कमला देवी', 'कमला देवी'], ['ரமேஷ் குமார்', 'ரமேஷ் குமார்'],
  ['José María', 'José'], ["D'Souza Anita", "D'Souza"], ['Drishti Rao', 'Drishti'], ['Shrikant Joshi', 'Shrikant'],
];
for (const [full, short] of NAMES) ok('short name of ' + JSON.stringify(full), T.shortName(full) === short, T.shortName(full));
ok('"Ask श्रीमती" can never be written: the whole name is kept', !/^श्रीमती$/.test(T.shortName('श्रीमती कमला देवी')));
ok('nothing to shorten falls back to the word given', T.shortName('', 'Someone') === 'Someone' && T.shortName('   ', 'them') === 'them');
ok('a name that only starts like an honorific is still cut', T.shortName('Drishti Rao') === 'Drishti' && T.shortName('Latesh Kumar') === 'Latesh');

// ---------------------------------------------------- 2. which Today
ok('senior mode gets the calm screen', T.todayKind({ senior: true }) === 'senior');
ok('senior mode wins over age', T.todayKind({ senior: true, minor: true }) === 'senior');
ok('under 18 gets the young Today', T.todayKind({ minor: true }) === 'young');
ok('everyone else gets the family one', T.todayKind({}) === 'family' && T.todayKind() === 'family');
ok('a young Today leads with games, polls, Pasand, stories, a question and plans', same(T.YOUNG_FIRST, ['games', 'polls', 'pasand', 'stories', 'ask', 'plans']));
ok('a young Today never shows vault, Aadhaar or emergency-card setup', ['vault', 'aadhaar', 'ecard-admin', 'firstrun'].every(k => T.YOUNG_HIDES.includes(k)));
ok('senior mode never shows the setup list', T.SENIOR_HIDES.includes('firstrun'));
const fam = [
  { id: 'r', name: 'Rohan' }, { id: 'p', name: 'Papa', senior: true }, { id: 'm', name: 'Maa', role: 'parent' },
  { id: 'k', name: 'Kabir', minor: true, senior: true }, { id: 'd', name: 'Dadaji', senior: true, remembered: true },
];
ok('a card for each parent looked after', same(T.lookedAfter(fam, 'r').map(m => m.id), ['p', 'm']));
ok('never a card about yourself', same(T.lookedAfter(fam, 'p').map(m => m.id), ['m']));
ok('never for a child, never for someone remembered', !T.lookedAfter(fam, 'r').some(m => m.id === 'k' || m.id === 'd'));

// ------------------------------------------------- 3. From the family
const items = [
  { kind: 'card', at: '2026-11-20T10:00:00Z', id: 1 }, { kind: 'poll', at: '2026-11-20T09:00:00Z', id: 2 },
  { kind: 'message', at: '2026-11-20T08:00:00Z', id: 3 }, { kind: 'join', at: '2026-11-19T08:00:00Z', id: 4 },
  { kind: 'plan', at: '2026-11-20T07:00:00Z', id: 5 }, { kind: 'message', at: '2026-11-20T11:00:00Z', id: 6 },
  { kind: 'word', at: '2026-11-18T07:00:00Z', id: 7 }, { kind: 'thanks', at: '2026-11-20T07:30:00Z', id: 8 },
  { kind: 'made-up', at: '2026-11-20T12:00:00Z', id: 9 }, null,
];
ok('one order: join, a private word, messages (newest first), thanks, plan, poll, card',
  same(T.fromFamily(items).map(x => x.id), [4, 7, 6, 3, 8, 5, 2, 1]), T.fromFamily(items).map(x => x.id).join(','));
ok('a child is never shown a request to join', !T.fromFamily(items, { minor: true }).some(x => x.kind === 'join')
  && T.fromFamily(items, { minor: true }).length === 7);
ok('something of no known kind is never shown', !T.fromFamily(items).some(x => x.kind === 'made-up'));
ok('the list is short', T.fromFamily(Array.from({ length: 40 }, (_, i) => ({ kind: 'message', at: String(i) }))).length === 12);
ok('nothing waiting is an empty list, not an error', same(T.fromFamily(null), []) && same(T.fromFamily([]), []));
ok('the first words of a message: one line, cut at a word', T.firstWords('Papa,   kal\nsubah doctor ke paas chalna hai, 10 baje tak tayyar rehna please', 30) === 'Papa, kal subah doctor ke…'
  && T.firstWords('Kaise ho?') === 'Kaise ho?' && T.firstWords(null) === '');

// ------------------------------------------------- 4. the bell, when new
const ev = [
  { type: 'care', text: 'Papa has asked to join. An adult in the family can let them in.', created_at: '2026-11-20T08:00:00Z' },
  { type: 'join', text: 'Papa joined the family - Rohan let them in', created_at: '2026-11-20T08:05:00Z' },
  { type: 'care', text: 'Meena has asked to join. An adult in the family can let them in.', created_at: '2026-11-20T09:00:00Z' },
  { type: 'sos', text: null, created_at: '2026-11-19T20:00:00Z' },
  { type: 'care', text: 'Rohan asked the family: pick up medicines', created_at: '2026-11-20T10:00:00Z' },
];
ok('"asked to join" and "joined" about one person are one line', T.bellFor(ev, null).filter(e => /Papa/.test(e.text || '')).length === 1
  && /joined/.test(T.bellFor(ev, null).find(e => /Papa/.test(e.text || '')).text));
ok('someone still at the door stays in the bell', T.bellFor(ev, null).some(e => /Meena has asked/.test(e.text || '')));
ok('nothing from before I joined is in my bell', same(T.bellFor(ev, '2026-11-20T08:04:00Z').map(e => e.created_at),
  ['2026-11-20T08:05:00Z', '2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z']));
ok('with no joining date known, nothing is hidden by date', T.bellFor(ev, null).length === 4);
ok('who an event is about, from its words', T.joinWho(ev[0]).kind === 'ask' && T.joinWho(ev[1]).kind === 'joined' && T.joinWho(ev[0]).who === 'papa' && T.joinWho(ev[4]) === null);

// ------------------------------------------------- 5. the five places
ok('five places, in this order', same(T.PLACES, ['home', 'chat', 'fun', 'people', 'menu']) && same(T.PLACES.map(p => T.PLACE_NAME[p]), ['Today', 'Chat', 'Together', 'Family', 'More']));
const OLD = ['home', 'people', 'person', 'memory', 'vault', 'care', 'day', 'chat', 'ekta', 'profile', 'fun', 'notifs'];
ok('every old address lands in a place', OLD.every(t => T.PLACES.includes(T.placeOf(t))));
ok('stories, recipes and the album belong to Together', ['stories', 'recipes', 'album'].every(v => T.placeOf('memory', v) === 'fun'));
ok('health and contacts belong to Family', T.placeOf('memory', 'health') === 'people' && T.placeOf('memory') === 'people' && T.placeOf('person') === 'people');
ok('vault, to do, Ekta and profile are under More', ['vault', 'care', 'ekta', 'profile', 'menu'].every(t => T.placeOf(t) === 'menu'));
ok('an address nobody knows lands on Today', T.placeOf('nonsense') === 'home');
ok('To do has three filters at most', T.TODO_FILTERS.length <= 3);

// --------------------------------- 6. the app's own copy says the same
const app = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const a = app.indexOf('/*tn-rules-start*/'), b = app.indexOf('/*tn-rules-end*/');
ok('the app carries its copy of the rules between two marks', a > 0 && b > a);
if (a > 0 && b > a) {
  const M = new Function(app.slice(a, b) + '\nreturn { tnShort, tnTodayKind, tnFromFamily, tnFirstWords, tnBellFor, tnPlaceOf, TN_HON, TN_FROM_ORDER };')();
  ok('app: the same honorifics', same(M.TN_HON, T.HONORIFICS));
  ok('app: the same order', same(M.TN_FROM_ORDER, T.FROM_ORDER));
  ok('app: the same short names', NAMES.every(([full]) => M.tnShort(full) === T.shortName(full)), NAMES.filter(([full]) => M.tnShort(full) !== T.shortName(full)).join('|'));
  ok('app: the same fallback', M.tnShort('', 'Someone') === 'Someone');
  ok('app: the same Today', [{}, { senior: true }, { minor: true }, { senior: true, minor: true }].every(o => M.tnTodayKind(o) === T.todayKind(o)));
  ok('app: the same From the family', same(M.tnFromFamily(items), T.fromFamily(items)) && same(M.tnFromFamily(items, { minor: true }), T.fromFamily(items, { minor: true })));
  ok('app: the same first words', ['Kaise ho?', 'Papa,   kal\nsubah doctor ke paas chalna hai, 10 baje tak tayyar rehna please'].every(t => M.tnFirstWords(t, 30) === T.firstWords(t, 30)));
  ok('app: the same bell', same(M.tnBellFor(ev, '2026-11-20T08:04:00Z'), T.bellFor(ev, '2026-11-20T08:04:00Z')) && same(M.tnBellFor(ev, null), T.bellFor(ev, null)));
  ok('app: the same places', OLD.concat(['menu', 'nonsense']).every(t => M.tnPlaceOf(t) === T.placeOf(t)) && ['stories', 'recipes', 'album', 'health'].every(v => M.tnPlaceOf('memory', v) === T.placeOf('memory', v)));
}

if (fails.length) { console.error('todaytest: ' + fails.length + ' FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('todaytest: ' + pass + ' checks passed');
