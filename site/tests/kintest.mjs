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
  P('mini', 'f', 'tara'),          // Sunil's granddaughter
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
is('vihaan', 'amit', 'Grand-uncle');      // great-grandfather's son, not his grandfather
is('vihaan', 'neha', 'Grand-aunt');
is('amit', 'vihaan', 'Grand-nephew');
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
ok('a father and daughter cannot be placed as husband and wife', !!pl('tara', 'spouse', 'sunil').error && !!pl('sunil', 'spouse', 'tara').error);
ok('nor a grandfather and granddaughter', !!pl('mini', 'spouse', 'sunil').error);
ok('the other parent cannot be the child\'s own child', !!pl('mini', 'parent', 'tara').error, JSON.stringify(pl('mini', 'parent', 'tara')));
ok('a husband or wife from outside the line is still fine', !pl('guest', 'spouse', 'sunil').error);
const loopy = K.index([P('a', 'm', 'b'), P('b', 'm', 'a')]);
const lg = K.generations(loopy);
ok('links that already loop are counted once, not fifty times', lg.get('a') <= 2 && lg.get('b') <= 2, [lg.get('a'), lg.get('b')].join());
ok('nobody is placed against themselves', !!pl('papa', 'child', 'papa').error);
ok('an unknown place is refused', !!pl('guest', 'cousin', 'papa').error);
ok('old one-word roles give a starting gender', K.genderFromRelation('daughter-in-law') === 'f' && K.genderFromRelation('grandson') === 'm' && K.genderFromRelation('family') === null);
ok('two kinds of family', K.FAMILY_TYPES.join() === 'joint,nuclear');
// ---------- DOOR KE RISHTEDAAR: the wider family, and the chain ----------
// Arjun's family, five generations, both sides, with the families that
// married in. Father's side: Pardada, his sons Dada and Shyamlal, and their
// lines. Mother's side: Parnana, Nana and his sister Shanti. Arjun's wife
// Kavya brings her own parents, brother and sister. Dates of birth are known
// for some brothers and not for Deepak, on purpose.
const Q = (id, gender, parentId = null, spouseId = null, dob = null) => ({ id, gender, parentId, spouseId, dob });
const wide = [
  // father's side
  Q('pardada', 'm', null, 'pardadi'), Q('pardadi', 'f', null, 'pardada'),
  Q('dada', 'm', 'pardada', 'dadi'), Q('dadi', 'f', null, 'dada'),
  Q('shyamlal', 'm', 'pardada', 'shyama'), Q('shyama', 'f', null, 'shyamlal'),
  Q('girish', 'm', 'shyamlal', 'usha'), Q('usha', 'f', null, 'girish'),
  Q('meena', 'f', 'girish', 'manoj'), Q('manoj', 'm', null, 'meena'),
  Q('bittu', 'm', 'meena'),
  Q('suresh', 'm', 'dada', 'kamla', '1955-03-02'), Q('kamla', 'f', null, 'suresh'),
  Q('ramesh', 'm', 'dada', 'geeta', '1960-07-15'), Q('geeta', 'f', 'nana', 'ramesh'),
  Q('mahesh', 'm', 'dada', 'rekha', '1965-01-20'), Q('rekha', 'f', null, 'mahesh'),
  Q('sunita', 'f', 'dada', 'mohan'), Q('mohan', 'm', null, 'sunita'),
  Q('vikas', 'm', 'suresh', 'pooja'), Q('pooja', 'f', null, 'vikas'),
  Q('chintu', 'm', 'vikas'), Q('pinky', 'f', 'vikas'),
  // mother's side
  Q('parnana', 'm'),
  Q('nana', 'm', 'parnana', 'nani'), Q('nani', 'f', null, 'nana'),
  Q('shanti', 'f', 'parnana'), Q('vimla', 'f', 'shanti'),
  Q('anil', 'm', 'nana', 'seema'), Q('seema', 'f', null, 'anil'),
  Q('ritu', 'f', 'anil'),
  Q('neelam', 'f', 'nana', 'prakash'), Q('prakash', 'm', null, 'neelam'),
  // Arjun, his brothers and sister, and who they married
  Q('bharat', 'm', 'ramesh', 'esha', '1985-04-11'), Q('esha', 'f', null, 'bharat'),
  Q('arjun', 'm', 'ramesh', 'kavya', '1988-09-30'), Q('kavya', 'f', 'kishan', 'arjun'),
  Q('chirag', 'm', 'ramesh', 'diya', '1992-12-05'), Q('diya', 'f', null, 'chirag'),
  Q('deepak', 'm', 'ramesh', 'ela'), Q('ela', 'f', null, 'deepak'),           // date of birth not known
  Q('bhavna', 'f', 'ramesh', 'jatin'), Q('jatin', 'm', null, 'bhavna'),
  Q('ved', 'm', 'bharat'), Q('yash', 'm', 'bhavna'), Q('yamini', 'f', 'bhavna'),
  // Kavya's own family
  Q('kishan', 'm', null, 'kamini'), Q('kamini', 'f', null, 'kishan'),
  Q('karan', 'm', 'kishan', 'kriti'), Q('kriti', 'f', null, 'karan'),
  Q('kiran', 'f', 'kishan', 'kunal'), Q('kunal', 'm', null, 'kiran'),
  // the generations below Arjun
  Q('om', 'm', 'arjun', 'zoya'), Q('zoya', 'f', null, 'om'),
  Q('tia', 'f', 'arjun'),
  Q('nano', 'm', 'om'), Q('pip', 'f', 'nano'),
  // in the family, not placed
  Q('lonely1', 'f'), Q('pairA', 'm', null, 'pairB'), Q('pairB', 'f', null, 'pairA'),
  Q('anon', null, 'dada'),                                                     // he or she not known
];
const W = K.index(wide);
const NAMES = new Map(wide.map(p => [p.id, p.id.charAt(0).toUpperCase() + p.id.slice(1) + ' Sharma']));
const info = (a, b) => K.kinInfo(W, a, b);
// sees(from, to, label, hindi): what kinLabel says, and the home name.
const sees = (from, to, label, hindi = null) => {
  const i = info(from, to), l = K.kinLabel(W, from, to);
  ok(`wide: ${from} sees ${to} as ${label}${hindi ? ' (' + hindi + ')' : ''}`, l === label && i.label === label && i.hindi === hindi, JSON.stringify({ l, label: i.label, hindi: i.hindi }));
};

ok('new exports exist', ['kinInfo', 'kinChain', 'kinChainWords', 'kinCloseness', 'kinEveryone'].every(n => typeof K[n] === 'function') && typeof K.NOT_CONNECTED === 'string');

// The family a wife married into: elder and younger come from the dates of birth.
sees('kavya', 'bharat', 'Brother-in-law', 'Jeth');
sees('kavya', 'esha', 'Sister-in-law', 'Jethani');
sees('kavya', 'chirag', 'Brother-in-law', 'Devar');
sees('kavya', 'diya', 'Sister-in-law', 'Devrani');
sees('kavya', 'bhavna', 'Sister-in-law', 'Nanad');
sees('kavya', 'jatin', 'Brother-in-law', 'Nandoi');
sees('kavya', 'ramesh', 'Father-in-law', 'Sasur');
sees('kavya', 'geeta', 'Mother-in-law', 'Saas');
// No date of birth for Deepak: the English word, never a guess.
sees('kavya', 'deepak', 'Brother-in-law', null);
sees('kavya', 'ela', 'Sister-in-law', null);
sees('ela', 'arjun', 'Brother-in-law', null);       // Deepak's wife cannot tell Jeth from Devar either
sees('ela', 'kavya', 'Sister-in-law', null);
sees('ela', 'bhavna', 'Sister-in-law', 'Nanad');    // but a husband's sister needs no date
// The other way round: Esha is older Bharat's wife, so Arjun is her Devar.
sees('esha', 'arjun', 'Brother-in-law', 'Devar');
sees('esha', 'kavya', 'Sister-in-law', 'Devrani');
sees('diya', 'arjun', 'Brother-in-law', 'Jeth');
sees('diya', 'kavya', 'Sister-in-law', 'Jethani');
// The family a husband married into.
sees('arjun', 'karan', 'Brother-in-law', 'Saala');
sees('arjun', 'kriti', 'Sister-in-law', 'Salhaj');
sees('arjun', 'kiran', 'Sister-in-law', 'Saali');
sees('arjun', 'kunal', 'Brother-in-law', 'Saadhu');
sees('arjun', 'kishan', 'Father-in-law', 'Sasur');
sees('arjun', 'kamini', 'Mother-in-law', 'Saas');
sees('jatin', 'arjun', 'Brother-in-law', 'Saala');
sees('kunal', 'arjun', 'Brother-in-law', 'Saadhu');
// A brother's wife and a sister's husband, seen by the one born into the line.
sees('arjun', 'esha', 'Sister-in-law', 'Bhabhi');
sees('bhavna', 'kavya', 'Sister-in-law', 'Bhabhi');
sees('arjun', 'jatin', 'Brother-in-law', 'Jija');
sees('karan', 'arjun', 'Brother-in-law', 'Jija');
sees('kiran', 'arjun', 'Brother-in-law', 'Jija');
// A wife keeps her own family, even when her husband's parents are in the tree too.
sees('kavya', 'kishan', 'Father');
sees('kavya', 'kamini', 'Mother');
sees('kavya', 'karan', 'Brother');
sees('kishan', 'kavya', 'Daughter');
sees('kishan', 'arjun', 'Son-in-law', 'Damaad');
sees('ramesh', 'kavya', 'Daughter-in-law', 'Bahu');
sees('geeta', 'nana', 'Father');
sees('nana', 'geeta', 'Daughter');
// The two sets of parents of a married couple, to each other.
sees('ramesh', 'kishan', 'Samdhi', 'Samdhi');
sees('ramesh', 'kamini', 'Samdhan', 'Samdhan');
sees('geeta', 'kishan', 'Samdhi', 'Samdhi');
sees('kishan', 'ramesh', 'Samdhi', 'Samdhi');
sees('kamini', 'geeta', 'Samdhan', 'Samdhan');
ok('Samdhi in plain English', info('ramesh', 'kishan').english === "Daughter-in-law's father" && info('kishan', 'geeta').english === "Son-in-law's mother", info('ramesh', 'kishan').english + ' / ' + info('kishan', 'geeta').english);
// Grandparents: the label is unchanged, the side gives the home name.
sees('arjun', 'dada', 'Grandfather', 'Dada');
sees('arjun', 'dadi', 'Grandmother', 'Dadi');
sees('arjun', 'nana', 'Grandfather', 'Nana');
sees('arjun', 'nani', 'Grandmother', 'Nani');
ok('and the side is told', info('arjun', 'dada').side === 'paternal' && info('arjun', 'nani').side === 'maternal' && info('arjun', 'kishan').side === 'married' && info('arjun', 'om').side === null);
sees('arjun', 'pardada', 'Great-grandfather', 'Pardada');
sees('arjun', 'pardadi', 'Great-grandmother', 'Pardadi');
sees('arjun', 'parnana', 'Great-grandfather', 'Parnana');
sees('pardada', 'arjun', 'Great-grandson');
sees('arjun', 'pip', 'Great-granddaughter');
sees('pip', 'arjun', 'Great-grandfather', 'Pardada');
sees('ramesh', 'om', 'Grandson', 'Pota');
sees('ramesh', 'tia', 'Granddaughter', 'Poti');
sees('ramesh', 'yash', 'Grandson', 'Nati');
sees('ramesh', 'yamini', 'Granddaughter', 'Natin');
sees('kishan', 'om', 'Grandson', 'Nati');           // a daughter's son, through the other family
// Uncles and aunts on both sides (the mother's side used to be out of reach).
sees('arjun', 'suresh', 'Chacha', 'Chacha');
sees('arjun', 'kamla', 'Chachi', 'Chachi');
sees('arjun', 'sunita', 'Bua', 'Bua');
sees('arjun', 'mohan', 'Fufa', 'Fufa');
sees('arjun', 'anil', 'Mama', 'Mama');
sees('arjun', 'seema', 'Mami', 'Mami');
sees('arjun', 'neelam', 'Mausi', 'Mausi');
sees('arjun', 'prakash', 'Mausa', 'Mausa');
ok('a Chacha is an Uncle in English, a Mausi an Aunt', info('arjun', 'suresh').english === 'Uncle' && info('arjun', 'neelam').english === 'Aunt' && info('arjun', 'mohan').english === 'Uncle');
sees('arjun', 'vikas', 'Cousin');
sees('arjun', 'ritu', 'Cousin');
sees('arjun', 'pooja', "Cousin's wife");
sees('arjun', 'ved', 'Nephew', 'Bhatija');
sees('arjun', 'yash', 'Nephew', 'Bhanja');
sees('arjun', 'yamini', 'Niece', 'Bhanji');
sees('kavya', 'yash', 'Nephew');
sees('anil', 'arjun', 'Nephew', 'Bhanja');
sees('suresh', 'arjun', 'Nephew', 'Bhatija');
// Further out.
sees('arjun', 'shyamlal', 'Grand-uncle');
sees('arjun', 'girish', "Uncle (Papa's cousin)");
sees('arjun', 'vimla', "Aunt (Maa's cousin)");
sees('girish', 'arjun', "Nephew (cousin's son)");
sees('ramesh', 'meena', "Niece (cousin's daughter)");
sees('arjun', 'chintu', "Nephew (cousin's son)");
sees('arjun', 'pinky', "Niece (cousin's daughter)");
sees('chintu', 'arjun', "Uncle (Papa's cousin)");
sees('arjun', 'meena', 'Second cousin');
sees('meena', 'arjun', 'Second cousin');
sees('arjun', 'manoj', "Second cousin's husband");
sees('arjun', 'bittu', 'Second cousin once removed');
sees('bittu', 'arjun', 'Second cousin once removed');
sees('om', 'meena', 'Second cousin once removed');
sees('suresh', 'om', 'Grand-nephew');
sees('suresh', 'zoya', "Grand-nephew's wife");    // this said 'Family' before
// Beyond any one word: the chain itself, told short. Never the bare word.
sees('arjun', 'usha', "Dada's brother's son's wife");
sees('om', 'shyamlal', "Great-grandfather's brother");
sees('om', 'girish', "Great-grandfather's brother's son");
sees('bittu', 'om', "Great-grandfather's brother's great-grandson");
sees('arjun', 'shanti', 'Grand-aunt');
sees('om', 'vimla', "Great-grandfather's sister's daughter");
sees('kavya', 'anil', "Husband's Mama");
sees('kavya', 'ritu', "Husband's cousin");
sees('arjun', 'anon', 'Uncle or aunt');
sees('anon', 'arjun', 'Nephew', 'Bhatija');
ok('a cousin once removed, when he or she is not known', (() => {
  const x = K.index([Q('gp', 'm'), Q('a', 'm', 'gp'), Q('b', 'm', 'gp'), Q('me', 'm', 'a'), Q('c', 'm', 'b'), Q('kid', null, 'c'), Q('myk', 'm', 'me')]);
  return K.kinLabel(x, 'me', 'kid') === "Cousin once removed (cousin's child)" && K.kinLabel(x, 'myk', 'c') === "Uncle (Papa's cousin)" && K.kinLabel(x, 'kid', 'me') === "Uncle (Papa's cousin)";
})());
ok('nobody who is connected is called just Family', wide.every(a => wide.every(b => {
  const l = K.kinLabel(W, a.id, b.id); return l !== 'Family' && (l !== null || K.kinChain(W, a.id, b.id) === null);
})));
ok('every label a family already had is still the same', people.every(a => people.every(b => {
  const was = K.kinLabel(by, a.id, b.id), i = K.kinInfo(by, a.id, b.id);
  return i.label === was && (was === null) === (i.chain === null);
})));

// The chain, as data and in words.
const ch = K.kinChain(W, 'arjun', 'mohan');
ok('the chain is the steps, shortest way', JSON.stringify(ch.map(s => [s.step, s.id])) === JSON.stringify([['father', 'ramesh'], ['sister', 'sunita'], ['husband', 'mohan']]), JSON.stringify(ch));
ok('each step says what kind it is', ch.map(s => s.rel).join() === 'parent,sibling,spouse');
ok('in plain words, with first names', K.kinChainWords(ch, NAMES) === "Your father Ramesh's sister Sunita's husband", K.kinChainWords(ch, NAMES));
ok('names can be a plain object, and can be missing', K.kinChainWords(ch, { ramesh: 'Ramesh Kumar' }) === "Your father Ramesh's sister's husband" && K.kinChainWords(ch) === "Your father's sister's husband");
ok('a mother is reached in one step, not through the father', JSON.stringify(K.kinChain(W, 'arjun', 'geeta').map(s => s.step)) === '["mother"]');
ok('a brother is one step', JSON.stringify(K.kinChain(W, 'arjun', 'bharat').map(s => s.step)) === '["brother"]');
ok('the mother\'s side runs through the mother', K.kinChainWords(K.kinChain(W, 'arjun', 'seema'), NAMES) === "Your mother Geeta's brother Anil's wife");
ok('Samdhi, in words', K.kinChainWords(K.kinChain(W, 'ramesh', 'kamini'), NAMES) === "Your son Arjun's wife Kavya's mother", K.kinChainWords(K.kinChain(W, 'ramesh', 'kamini'), NAMES));
ok('a long chain', K.kinChainWords(K.kinChain(W, 'arjun', 'bittu'), NAMES) === "Your father Ramesh's father Dada's brother Shyamlal's son Girish's daughter Meena's son", K.kinChainWords(K.kinChain(W, 'arjun', 'bittu'), NAMES));
ok('the same person is an empty chain, said as You', K.kinChain(W, 'arjun', 'arjun').length === 0 && K.kinChainWords([], NAMES) === 'You' && info('arjun', 'arjun').label === 'You');
ok('not connected: null, and said plainly', K.kinChain(W, 'arjun', 'lonely1') === null && K.kinChain(W, 'lonely1', 'arjun') === null && K.kinChain(W, 'arjun', 'pairB') === null &&
   K.kinChainWords(null, NAMES) === 'Not connected in the family tree yet' && K.kinLabel(W, 'arjun', 'lonely1') === null);
ok('not connected: the info says so and names nothing', (() => { const i = info('arjun', 'pairA'); return i.label === null && i.hindi === null && i.english === null && i.chain === null && i.closeness === 'unplaced'; })());
ok('two unplaced people who are married are still each other\'s husband and wife', K.kinLabel(W, 'pairA', 'pairB') === 'Wife');
ok('someone who is not in this family: null', K.kinChain(W, 'arjun', 'nobody') === null && K.kinInfo(W, 'nobody', 'arjun') === null && K.kinLabel(W, 'arjun', 'nobody') === null);
ok('every chain ends at the person asked for', wide.every(b => { const c = K.kinChain(W, 'arjun', b.id); return c === null || c.length === 0 || c[c.length - 1].id === b.id; }));

// Closeness: ghar, kareebi, door, and who is not connected yet.
const cl = K.kinCloseness(W, 'arjun');
const has = (g, ids) => ids.every(id => cl[g].includes(id));
ok('ghar: wife, parents, children, brothers and sister, grandparents, grandchildren and the straight line beyond',
   has('ghar', ['kavya', 'ramesh', 'geeta', 'om', 'tia', 'bharat', 'chirag', 'deepak', 'bhavna', 'dada', 'dadi', 'nana', 'nani', 'nano', 'pardada', 'parnana', 'pip']), cl.ghar.join());
ok('kareebi: uncles, aunts, first cousins, nephews, nieces and the first in-laws',
   has('kareebi', ['suresh', 'kamla', 'mahesh', 'rekha', 'sunita', 'mohan', 'anil', 'seema', 'neelam', 'prakash', 'vikas', 'ritu', 'ved', 'yash', 'yamini',
                   'esha', 'diya', 'ela', 'jatin', 'kishan', 'kamini', 'karan', 'kiran', 'kriti', 'kunal', 'zoya', 'anon']), cl.kareebi.join());
ok('door: everyone else who is connected', has('door', ['shyamlal', 'shyama', 'girish', 'usha', 'meena', 'manoj', 'bittu', 'pooja', 'chintu', 'pinky', 'shanti', 'vimla']), cl.door.join());
ok('unplaced: in the family, not connected', cl.unplaced.slice().sort().join() === 'lonely1,pairA,pairB', cl.unplaced.join());
ok('everyone is in exactly one group, and you are in none', (() => {
  const all = [...cl.ghar, ...cl.kareebi, ...cl.door, ...cl.unplaced];
  return all.length === wide.length - 1 && new Set(all).size === all.length && !all.includes('arjun');
})());
ok('nearest first inside a group', cl.ghar.indexOf('kavya') < cl.ghar.indexOf('dada') && cl.ghar.indexOf('dada') < cl.ghar.indexOf('pardada'));
ok('the info carries the same group', info('arjun', 'girish').closeness === 'door' && info('arjun', 'suresh').closeness === 'kareebi' && info('arjun', 'kavya').closeness === 'ghar');
ok('Samdhi are door, a Jethani is kareebi', info('ramesh', 'kishan').closeness === 'door' && info('kavya', 'esha').closeness === 'kareebi');
ok('someone not placed sees everyone as unplaced', (() => { const c = K.kinCloseness(W, 'lonely1'); return c.ghar.length + c.kareebi.length + c.door.length === 0 && c.unplaced.length === wide.length - 1; })());
ok('everyone at once agrees with one at a time', (() => {
  const all = K.kinEveryone(W, 'kavya');
  return all.size === wide.length && wide.every(b => JSON.stringify(all.get(b.id)) === JSON.stringify(K.kinInfo(W, 'kavya', b.id)));
})());

// Dates of birth: a Date, a timestamp string, or rubbish.
ok('a date of birth may be a Date or a longer string; rubbish is not known', (() => {
  const x = K.index([Q('f', 'm'), Q('h', 'm', 'f', 'w', new Date(1990, 4, 2)), Q('w', 'f', null, 'h'), Q('e', 'm', 'f', null, '1980-01-01T00:00:00.000Z'), Q('y', 'm', 'f', null, 'last year')]);
  return K.kinInfo(x, 'w', 'e').hindi === 'Jeth' && K.kinInfo(x, 'w', 'y').hindi === null && K.kinInfo(x, 'w', 'y').label === 'Brother-in-law';
})());
ok('born on the same day: no guess', (() => {
  const x = K.index([Q('f', 'm'), Q('h', 'm', 'f', 'w', '1990-05-02'), Q('w', 'f', null, 'h'), Q('t', 'm', 'f', null, '1990-05-02')]);
  return K.kinInfo(x, 'w', 't').hindi === null;
})());

// Bad links: a loop, a missing parent, a one-sided marriage. Every walk ends.
const t0 = Date.now();
const bad = K.index([P('a', 'm', 'b'), P('b', 'm', 'a'), P('c', 'f', 'a'), P('d', 'm', 'gone'), P('e', 'f', null, 'a'), P('f', 'm', 'f', 'f'), P('g', 'm', 'i'), P('h', 'm', 'g'), P('i', 'm', 'h')]);
const badIds = [...bad.keys()];
let walked = 0;
for (const x of badIds) for (const y of badIds) { K.kinLabel(bad, x, y); K.kinInfo(bad, x, y); K.kinChainWords(K.kinChain(bad, x, y)); walked++; }
for (const x of badIds) { K.kinCloseness(bad, x); K.kinEveryone(bad, x); }
ok('a loop or a broken link never hangs a walk', walked === badIds.length * badIds.length && Date.now() - t0 < 2000, (Date.now() - t0) + 'ms');
ok('a link to someone who is not there connects nobody', K.kinChain(bad, 'd', 'a') === null && K.kinInfo(bad, 'd', 'a').closeness === 'unplaced');
ok('a one-sided marriage is not a marriage', K.kinChain(bad, 'e', 'a') === null);
ok('in a loop, two people are still joined the shortest way', K.kinChain(bad, 'a', 'b').length === 1 && K.kinChain(bad, 'g', 'i').length === 1);
const big = K.index(Array.from({ length: 3000 }, (_, i) => P('n' + i, i % 2 ? 'm' : 'f', i ? 'n' + (i - 1) : null)));
const t1 = Date.now();
ok('a very long line is walked once', K.kinChain(big, 'n0', 'n2999').length === 2999 && typeof K.kinLabel(big, 'n2999', 'n0') === 'string' && Date.now() - t1 < 3000, (Date.now() - t1) + 'ms');

if (fails.length) {
  console.error(`kintest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`kintest: ${pass}/${pass} checks pass`);
