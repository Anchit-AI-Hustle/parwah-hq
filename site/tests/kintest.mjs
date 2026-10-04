// FAMILY TREE ARITHMETIC. api/_kin.mjs imports nothing, so this runs in the
// deploy gate before npm install.
//
// The family is the one from a family's review of Parwah, grown to four
// generations: Papa and Mumma; their sons Rohan and Amit; the daughters-in-law
// Priya and Neha; the grandchildren; and one great-grandchild.
import * as K from '../../api/_kin.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

const P = (id, gender, parentId = null, spouseId = null) => ({ id, gender, parentId, spouseId });
const people = [
  P('papa', 'm', null, 'mumma'), P('mumma', 'f', null, 'papa'),
  P('rohan', 'm', 'papa', 'priya'), P('priya', 'f', null, 'rohan'),
  P('amit', 'm', 'papa', 'neha'), P('neha', 'f', null, 'amit'),
  P('aarav', 'm', 'rohan', 'isha'), P('isha', 'f', null, 'aarav'),
  P('anaya', 'f', 'rohan', 'raj'), P('raj', 'm', null, 'anaya'),
  P('riya', 'f', 'rohan'),
  P('kabir', 'm', 'amit'),
  P('vihaan', 'm', 'aarav'),       // great-grandson: the fourth generation
  P('dev', 'm', 'anaya'),          // Anaya's son
  P('sunil', 'm', 'papa'),         // a son with no wife in the tree
  P('tara', 'f', 'sunil'),
  P('guest', null),                // not placed yet
];
const by = K.index(people);
const L = (from, to) => K.kinLabel(by, from, to);
const is = (from, to, want) => ok(`${from} sees ${to} as ${want}`, L(from, to) === want, L(from, to));

// The first generation and their children
is('papa', 'mumma', 'Wife');
is('rohan', 'papa', 'Father');
is('rohan', 'mumma', 'Mother');
is('papa', 'rohan', 'Son');
is('rohan', 'amit', 'Brother');
// In-laws, both ways
is('priya', 'papa', 'Father-in-law');
is('priya', 'mumma', 'Mother-in-law');
is('papa', 'priya', 'Daughter-in-law');
is('mumma', 'neha', 'Daughter-in-law');
is('rohan', 'neha', 'Sister-in-law');
is('neha', 'rohan', 'Brother-in-law');
is('rohan', 'raj', 'Son-in-law');
// Grandchildren, grandparents, four generations
is('papa', 'aarav', 'Grandson');
is('mumma', 'anaya', 'Granddaughter');
is('aarav', 'papa', 'Grandfather');
is('vihaan', 'papa', 'Great-grandfather');
is('papa', 'vihaan', 'Great-grandson');
is('papa', 'isha', 'Grandson-in-law'.replace('Grandson', 'Granddaughter'));
// Aunts and uncles: the side decides the word
is('aarav', 'amit', 'Chacha');            // father's brother
is('aarav', 'neha', 'Chachi');            // his wife
is('vihaan', 'anaya', 'Bua');             // father's sister
is('vihaan', 'raj', 'Fufa');              // her husband
is('dev', 'aarav', 'Mama');               // mother's brother: the mama from the review
is('dev', 'isha', 'Mami');                // his wife
is('dev', 'riya', 'Mausi');               // mother's sister
// Cousins, nephews, nieces
is('aarav', 'kabir', 'Cousin');
is('amit', 'aarav', 'Nephew');
is('amit', 'anaya', 'Niece');
// Not in the tree yet: no guess
ok('someone not placed has no label yet', L('papa', 'guest') === null && L('guest', 'papa') === null);
ok('you are you', L('papa', 'papa') === 'You');

// Generations: Papa's line runs four deep
const g = K.generations(by);
ok('four generations: Papa 1, Rohan 2, Aarav 3, Vihaan 4',
   g.get('papa') === 1 && g.get('rohan') === 2 && g.get('aarav') === 3 && g.get('vihaan') === 4 && g.get('priya') === 2,
   [g.get('papa'), g.get('rohan'), g.get('aarav'), g.get('vihaan'), g.get('priya')].join());

// Placing people
const pl = (t, place, of) => K.placement(by, t, place, of);
ok('a child is linked to the parent', JSON.stringify(pl('guest', 'child', 'amit').set) === JSON.stringify([{ id: 'guest', parentId: 'amit' }]));
ok('a husband or wife is linked both ways', pl('guest', 'spouse', 'kabir').set.length === 2);
ok('nobody gets a second husband or wife', !!pl('guest', 'spouse', 'rohan').error);
ok('a brother or sister shares the parent', pl('guest', 'sibling', 'kabir').set[0].parentId === 'amit');
ok('a brother or sister of someone with no parent in the tree asks for the parent first', !!pl('guest', 'sibling', 'papa').error);
ok('a parent of someone with no parent becomes their parent', pl('guest', 'parent', 'papa').set[0].parentId === 'guest');
const other = pl('guest', 'parent', 'tara');
ok('a parent of someone who has one becomes the other parent (their husband or wife)',
   !other.error && other.set.some(x => x.id === 'guest' && x.spouseId === 'sunil') && other.set.some(x => x.id === 'sunil' && x.spouseId === 'guest'), JSON.stringify(other));
ok('a third parent is refused', !!pl('guest', 'parent', 'kabir').error);
ok('nobody becomes their own ancestor', !!pl('papa', 'child', 'vihaan').error && !!pl('rohan', 'parent', 'papa').error);
ok('nobody is placed against themselves', !!pl('papa', 'child', 'papa').error);
ok('an unknown place is refused', !!pl('guest', 'cousin', 'papa').error);
ok('old one-word roles give a starting gender', K.genderFromRelation('daughter-in-law') === 'f' && K.genderFromRelation('grandson') === 'm' && K.genderFromRelation('family') === null);
ok('two kinds of family', K.FAMILY_TYPES.join() === 'joint,nuclear');

if (fails.length) {
  console.error(`kintest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`kintest: ${pass}/${pass} checks pass`);
