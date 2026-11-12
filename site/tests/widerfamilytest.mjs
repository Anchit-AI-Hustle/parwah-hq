// THE WIDER FAMILY, the arithmetic only. api/_kin.mjs and
// api/_rememberrules.mjs import nothing, so this runs in the deploy gate
// before npm install.
//
// 1. Linked families: two trees joined at one person who belongs to both.
//    The Sharmas (Arjun's home, where Kavya married in) and the Vermas
//    (Kavya's own home). Ids are made to collide on purpose.
// 2. Days of remembrance: the yearly date, 29 February, a year with no day,
//    and the evening-before rule on the family's own clock.
import * as K from '../../api/_kin.mjs';
import * as R from '../../api/_rememberrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

// ---------------------------------------------------------------- the join
const P = (id, gender, parentId = null, spouseId = null, dob = null) => ({ id, gender, parentId, spouseId, dob });
// The Sharmas. Kavya's father was added here by name, as "kishan".
const sharma = [
  P('ramesh', 'm', null, 'geeta'), P('geeta', 'f', null, 'ramesh'),
  P('arjun', 'm', 'ramesh', 'kavya', '1988-09-30'), P('kavya', 'f', 'kishan', 'arjun'),
  P('bharat', 'm', 'ramesh', null, '1985-04-11'), P('om', 'm', 'arjun'),
  P('kishan', 'm'), P('guest', null),
];
// The Vermas. The same ids "kavya", "kishan", "om" and "guest" are used for
// their own rows: "om" here is a cousin, a different person.
const verma = [
  P('dada', 'm'), P('kishan', 'm', 'dada', 'sarla'), P('sarla', 'f', null, 'kishan'),
  P('kavya', 'f', 'kishan'), P('karan', 'm', 'kishan', 'meena', '1990-02-02'), P('meena', 'f', null, 'karan'),
  P('tara', 'f', 'karan'), P('mohan', 'm', 'dada'), P('om', 'm', 'mohan'), P('guest', null),
];
const sNames = { ramesh: 'Ramesh', geeta: 'Geeta', arjun: 'Arjun', kavya: 'Kavya', bharat: 'Bharat', om: 'Om', kishan: 'Kishan', guest: 'Guest' };
const vNames = { dada: 'Dada Verma', kishan: 'Kishan', sarla: 'Sarla', kavya: 'Kavya', karan: 'Karan', meena: 'Meena', tara: 'Tara', mohan: 'Mohan', om: 'Om Verma', guest: 'Visitor' };
const bridge = { own: 'kavya', other: 'kavya' };

const j = K.joinGraphs(sharma, verma, bridge);
ok('the two trees join', j.joined === true);
ok('ids never collide: every Verma has a prefixed id, or is one person with a Sharma', [...j.ids].every(([o, id]) => id === K.LINK_PREFIX + o || j.same.get(o) === id));
ok('the bridge is one person', j.same.get('kavya') === 'kavya' && j.ids.get('kavya') === 'kavya');
ok('her father, added by name in her husband\'s home, is the Papa of her own home', j.same.get('kishan') === 'kishan');
ok('the Verma cousin Om is not the Sharma son Om', j.ids.get('om') === 'L:om' && !j.same.has('om') && j.by.get('om').parentId === 'arjun' && j.by.get('L:om').parentId === 'L:mohan');
ok('nobody is counted twice', j.by.size === sharma.length + verma.length - j.same.size, j.by.size);
ok('her mother joins her father as his wife', j.by.get('kishan').spouseId === 'L:sarla' && j.by.get('L:sarla').spouseId === 'kishan');
ok('and her father gains his own father from the other tree', j.by.get('kishan').parentId === 'L:dada');
ok('the Sharma tree itself is not changed by the join', sharma.find(p => p.id === 'kishan').parentId === null && sharma.find(p => p.id === 'kishan').spouseId === null);

const seen = (from, own = sharma, other = verma, br = bridge, n1 = sNames, n2 = vNames) => K.kinLinked(own, other, br, from, n1, n2);
const line = (m, id) => { const x = m.get(id); return x ? [x.label, x.hindi, x.group, x.words].map(String).join(' / ') : 'none'; };
const A = seen('arjun');
ok('Arjun: his wife\'s mother is Saas, close family, through Kavya', line(A, 'sarla') === "Mother-in-law / Saas / kareebi / Your wife Kavya's mother", line(A, 'sarla'));
ok('Arjun: her brother is Saala', line(A, 'karan') === "Brother-in-law / Saala / kareebi / Your wife Kavya's brother", line(A, 'karan'));
ok('Arjun: her brother\'s wife is Salhaj', A.get('meena').hindi === 'Salhaj' && A.get('meena').group === 'kareebi', line(A, 'meena'));
ok('Arjun: her brother\'s daughter is a niece', A.get('tara').label === 'Niece' && A.get('tara').group === 'kareebi', line(A, 'tara'));
ok('Arjun: her grandfather is Grandfather-in-law', A.get('dada').label === 'Grandfather-in-law', line(A, 'dada'));
ok('Arjun: her Chacha is far, named through her', line(A, 'mohan') === "Wife's Chacha / null / door / Your wife Kavya's father Kishan's brother", line(A, 'mohan'));
ok('Arjun: her cousin is far, and the chain uses the other family\'s names', line(A, 'om') === "Wife's cousin / null / door / Your wife Kavya's father Kishan's brother Mohan's son", line(A, 'om'));
ok('someone the other family has not placed is far, with no made-up chain', A.get('guest').group === 'door' && A.get('guest').words === null && A.get('guest').label === null, line(A, 'guest'));
ok('the people who are one person in both are marked', A.get('kavya').same === 'kavya' && A.get('kishan').same === 'kishan' && A.get('sarla').same === null);
const Kv = seen('kavya');
ok('Kavya: in her husband\'s home she still sees her mother as Mother, at home', line(Kv, 'sarla') === 'Mother / null / ghar / Your mother', line(Kv, 'sarla'));
ok('Kavya: her brother is Brother, her Chacha is Chacha', Kv.get('karan').label === 'Brother' && Kv.get('karan').group === 'ghar' && Kv.get('mohan').label === 'Chacha' && Kv.get('mohan').group === 'kareebi', line(Kv, 'mohan'));
const Bh = seen('bharat');
ok('Bharat: no single word fits his brother\'s wife\'s mother, so the chain is told short', line(Bh, 'sarla') === "Brother's wife's mother / null / door / Your brother Arjun's wife Kavya's mother", line(Bh, 'sarla'));
ok('a full date never crosses: with only years, Jeth or Devar is said only when the years differ', K.joinGraphs(sharma, verma, bridge).by.get('L:karan').dob === '1990-01-01' && j.by.get('arjun').dob === '1988-01-01');

// The same link, seen from the other home.
const V = seen('karan', verma, sharma, bridge, vNames, sNames);
ok('Karan: his sister\'s husband is Jija', line(V, 'arjun') === "Brother-in-law / Jija / kareebi / Your sister Kavya's husband", line(V, 'arjun'));
ok('Karan: her son is Bhanja', V.get('om').hindi === 'Bhanja' && V.get('om').group === 'kareebi', line(V, 'om'));
ok('Karan: her husband\'s father is far, in words', line(V, 'ramesh') === "Sister's husband's father / null / door / Your sister Kavya's husband Arjun's father", line(V, 'ramesh'));
ok('Karan: the Sharma copy of his own father is his father, not a second person', V.get('kishan').same === 'kishan');

// One tree points to the father, the other to the mother.
const viaMum = [P('mum', 'f'), P('priya', 'f', 'mum'), P('bro', 'm', 'mum')];
const viaDad = [P('dad', 'm'), P('priya2', 'f', 'dad', 'rohan'), P('rohan', 'm', null, 'priya2')];
const X = K.joinGraphs(viaDad, viaMum, { own: 'priya2', other: 'priya' });
ok('father in one tree and mother in the other become a couple', X.by.get('dad').spouseId === 'L:mum' && X.by.get('L:mum').spouseId === 'dad');
ok('so her brother is found through either parent', K.kinLinked(viaDad, viaMum, { own: 'priya2', other: 'priya' }, 'rohan', {}, {}).get('bro').hindi === 'Saala');

// A bridge who is not in both families joins nothing.
ok('no bridge, no join', K.joinGraphs(sharma, verma, { own: 'nobody', other: 'kavya' }).joined === false && seen('arjun', sharma, verma, { own: 'kavya', other: 'nobody' }).size === 0);
ok('a viewer who is not in this family sees nothing', seen('stranger').size === 0);

// Walks stay bounded: bad links that would loop through the join are cut.
const loopA = [P('x', 'f', 'p', 's'), P('s', 'm', null, 'x'), P('p', 'm')];
const loopB = [P('x', 'f', 'p', 's'), P('s', 'm', null, 'x'), P('p', 'm', 's')];   // p is the child of x's own husband
const t0 = Date.now();
const LJ = K.joinGraphs(loopA, loopB, { own: 'x', other: 'x' });
ok('a link that would make someone their own ancestor is dropped, the borrowed one first', LJ.by.get('p').parentId === null && LJ.by.get('x').parentId === 'p', JSON.stringify([...LJ.by.values()]));
ok('and naming everyone after it still ends', K.kinLinked(loopA, loopB, { own: 'x', other: 'x' }, 's', {}, {}).size === 3 && Date.now() - t0 < 1000);
// A very large other family is cut to the cap, and one walk still ends fast.
const big = [P('b0', 'm')]; for (let i = 1; i < 3000; i++) big.push(P('b' + i, 'm', 'b' + (i - 1)));
const t1 = Date.now();
const BJ = K.kinLinked([P('me', 'm', null, 'w'), P('w', 'f', null, 'me')], [P('w', 'f', 'b0')].concat(big), { own: 'w', other: 'w' }, 'me', {}, {});
ok('a huge linked family is capped and walked once', BJ.size === K.LINK_MAX_PEOPLE && BJ.get('b0').label === 'Father-in-law' && Date.now() - t1 < 3000, BJ.size + ' in ' + (Date.now() - t1) + 'ms');

// ------------------------------------------------------- days of remembrance
const p = (year, month = null, day = null) => ({ year, month, day });
ok('the day each year', R.anniversaryIn(p(2019, 3, 12), 2026) === '2026-03-12');
ok('no day in the year of passing itself, or before', R.anniversaryIn(p(2019, 3, 12), 2019) === null && R.anniversaryIn(p(2019, 3, 12), 2018) === null);
ok('29 February is kept on 28 February in other years', R.anniversaryIn(p(2020, 2, 29), 2026) === '2026-02-28' && R.anniversaryIn(p(2020, 2, 29), 2027) === '2027-02-28');
ok('and on 29 February when the year has one', R.anniversaryIn(p(2020, 2, 29), 2028) === '2028-02-29' && R.isLeap(2028) && !R.isLeap(2100) && R.isLeap(2000));
ok('a year alone has no day to keep', R.anniversaryIn(p(2019), 2026) === null && R.nextRemembrance(p(2019), '2026-11-12') === null);
ok('a year and a month alone has no day either', R.anniversaryIn(p(2019, 3), 2026) === null);
const nx = R.nextRemembrance(p(2019, 3, 12), '2026-11-12');
ok('the next one, how far, and how many years', nx.date === '2027-03-12' && nx.inDays === 120 && nx.years === 8, JSON.stringify(nx));
ok('today counts as the next one', R.nextRemembrance(p(2019, 11, 12), '2026-11-12').inDays === 0);

// The evening before, on the family's own clock (India is UTC+5:30).
const at = (isoUtc) => Date.parse(isoUtc);
const dadaji = p(2019, 11, 13);
ok('17:59 the evening before in India: not yet', R.remembranceDue(dadaji, at('2026-11-12T12:29:00Z'), 'Asia/Kolkata') === null);
const eve = R.remembranceDue(dadaji, at('2026-11-12T12:30:00Z'), 'Asia/Kolkata');
ok('18:00 the evening before in India: tomorrow is the day', eve && eve.when === 'eve' && eve.date === '2026-11-13' && eve.year === 2026 && eve.years === 7, JSON.stringify(eve));
ok('the same instant is still the afternoon in London: not yet there', R.remembranceDue(dadaji, at('2026-11-12T12:30:00Z'), 'Europe/London') === null);
ok('and already the day itself in Auckland', (R.remembranceDue(dadaji, at('2026-11-12T12:30:00Z'), 'Pacific/Auckland') || {}).when === 'day');
const day = R.remembranceDue(dadaji, at('2026-11-12T18:30:00Z'), 'Asia/Kolkata');
ok('from midnight in India it is the day', day && day.when === 'day' && day.year === 2026, JSON.stringify(day));
ok('all of the day', (R.remembranceDue(dadaji, at('2026-11-13T18:29:00Z'), 'Asia/Kolkata') || {}).when === 'day');
ok('and over the day after', R.remembranceDue(dadaji, at('2026-11-13T18:30:00Z'), 'Asia/Kolkata') === null);
ok('two days before: nothing', R.remembranceDue(dadaji, at('2026-11-11T14:00:00Z'), 'Asia/Kolkata') === null);
ok('the eve and the day share one year, so the family is told once', eve.year === day.year);
const nye = R.remembranceDue(p(2010, 1, 1), at('2026-12-31T13:00:00Z'), 'Asia/Kolkata');
ok('a day on 1 January: the evening before is in the old year, the claim is for the new', nye && nye.when === 'eve' && nye.year === 2027 && nye.date === '2027-01-01', JSON.stringify(nye));
const leapEve = R.remembranceDue(p(2020, 2, 29), at('2027-02-27T13:00:00Z'), 'Asia/Kolkata');
ok('29 February in a short year: the evening of the 27th', leapEve && leapEve.when === 'eve' && leapEve.date === '2027-02-28', JSON.stringify(leapEve));
ok('29 February in a leap year: the evening of the 28th, not the 27th', R.remembranceDue(p(2020, 2, 29), at('2028-02-27T13:00:00Z'), 'Asia/Kolkata') === null && (R.remembranceDue(p(2020, 2, 29), at('2028-02-28T13:00:00Z'), 'Asia/Kolkata') || {}).date === '2028-02-29');
ok('a year alone is never due', R.remembranceDue(p(2019), at('2026-11-12T12:30:00Z'), 'Asia/Kolkata') === null);
ok('an unknown time zone falls back to India, never throws', (R.remembranceDue(dadaji, at('2026-11-12T12:30:00Z'), 'Not/AZone') || {}).when === 'eve');

// What a family may type.
const T = '2026-11-12';
ok('a year alone is enough', JSON.stringify(R.passedClean({ year: '2019' }, T).value) === '{"year":2019,"month":null,"day":null}');
ok('year, month and day', JSON.stringify(R.passedClean({ year: 2019, month: 3, day: 12 }, T).value) === '{"year":2019,"month":3,"day":12}');
ok('no year is refused, gently', /Write the year/.test(R.passedClean({ month: 3, day: 12 }, T).error));
ok('a day with no month is refused', /month as well/.test(R.passedClean({ year: 2019, day: 12 }, T).error));
ok('30 February is refused', /not in February 2019/.test(R.passedClean({ year: 2019, month: 2, day: 30 }, T).error));
ok('29 February is refused in a short year and kept in a leap year', !!R.passedClean({ year: 2019, month: 2, day: 29 }, T).error && !!R.passedClean({ year: 2020, month: 2, day: 29 }, T).value);
ok('the future is refused: a later year, a later month, tomorrow', !!R.passedClean({ year: 2027 }, T).error && !!R.passedClean({ year: 2026, month: 12 }, T).error && !!R.passedClean({ year: 2026, month: 11, day: 13 }, T).error);
ok('today is allowed', !!R.passedClean({ year: 2026, month: 11, day: 12 }, T).value);
ok('before they were born is refused', /before the year they were born/.test(R.passedClean({ year: 1940 }, T, 1950).error));
ok('words in place of numbers are refused', !!R.passedClean({ year: 'last year' }, T).error && !!R.passedClean({ year: 2019, month: 'March' }, T).error);
ok('a very old year is refused', !!R.passedClean({ year: 1700 }, T).error);

// The words.
ok('as much of the date as the family wrote', R.passedWords(p(2019, 3, 12)) === '12 March 2019' && R.passedWords(p(2019, 3)) === 'March 2019' && R.passedWords(p(2019)) === '2019' && R.passedWords(null) === '');
ok('the evening before', R.remembranceLine('Dadaji', 'eve') === "Tomorrow is Dadaji's day of remembrance.");
ok('on the day', R.remembranceLine('Dadaji', 'day') === "Today is Dadaji's day of remembrance.");
ok('the line under it is plain', R.yearsLine('Dadaji Sharma', 7) === '7 years without Dadaji. We remember.' && R.yearsLine('Dadaji', 1) === 'One year without Dadaji. We remember.');
const CLINICAL = /\b(deceased|death|died|dead|expired|demise|late)\b/i;
ok('never a clinical word', ![R.remembranceLine('Dadaji', 'eve'), R.remembranceLine('Dadaji', 'day'), R.yearsLine('Dadaji', 7), R.yearsLine('Dadaji', 0)].some(s => CLINICAL.test(s)));

// Who may mark someone.
ok('17 is not an adult, 18 is, on the birthday itself', R.isAdult('2008-11-13', T) === false && R.isAdult('2008-11-12', T) === true);
ok('no date of birth is taken as an adult', R.isAdult(null, T) === true && R.isAdult('', T) === true);
ok('a date object works too', R.isAdult(new Date(2015, 0, 1), T) === false && R.isAdult(new Date(1980, 0, 1), T) === true);

if (fails.length) {
  console.error(`widerfamilytest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`widerfamilytest: ${pass}/${pass} checks pass`);
