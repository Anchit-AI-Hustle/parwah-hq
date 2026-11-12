// SPLITTING A COST, THE SUMS, with no database and nothing installed.
// api/_splitmath.mjs imports nothing; api/_together.mjs imports only the
// Pasand rules at the top, which import nothing either.
//
// What it proves: an amount is read into whole paise and never a fraction;
// equal and uneven shares always add up to the cost, with the leftover paise
// handed out the same way every time; "who owes whom" clears every balance
// in the fewest transfers; no paisa is lost or invented over thousands of
// made-up cases (fixed seed, so a failure can be run again); the UPI link is
// built with every field encoded and never for a malformed id or a currency
// that is not rupees.
import { readFile } from 'node:fs/promises';
import * as S from '../../api/_splitmath.mjs';
import * as T from '../../api/_together.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };
const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// ---- reading an amount
ok('1250 is 125000 paise', S.parsePaise('1250') === 125000);
ok('1,250.5 is 125050 paise', S.parsePaise('1,250.5') === 125050);
ok('1250.50 is 125050 paise', S.parsePaise('1250.50') === 125050);
ok('0.07 is 7 paise', S.parsePaise('0.07') === 7);
ok('a number is read the same way as its text', S.parsePaise(1250) === 125000 && S.parsePaise(19.99) === 1999 && S.parsePaise(0.1) === 10);
ok('33.33 is 3333 and never 3332 (no fraction is multiplied)', S.parsePaise('33.33') === 3333 && S.parsePaise('1.15') === 115 && S.parsePaise('4.35') === 435);
for (const b of ['', ' ', 'abc', '-5', '1.234', '1e3', '12.', '.5', '5k', '1250 rupees', '0x10', null, undefined, NaN, Infinity, '1.2.3'])
  ok('refused as an amount: ' + String(b), S.parsePaise(b) === null, String(S.parsePaise(b)));
ok('the cap is ten crore rupees', S.parsePaise('100000000') === S.SPLIT_MAX.paise && S.parsePaise('100000000.01') === null);
ok('paise back to text for a link', S.paiseText(125000) === '1250.00' && S.paiseText(125050) === '1250.50' && S.paiseText(7) === '0.07' && S.paiseText(0) === '0.00');
ok('text is never made from a fraction or a minus', S.paiseText(12.5) === '' && S.paiseText(-100) === '');

// ---- equal shares
{
  const e = S.equalShares(100000, ['b', 'a', 'c', 'd']);
  ok('1000 between four is 250 each', e.a === 25000 && e.b === 25000 && e.c === 25000 && e.d === 25000);
  const r = S.equalShares(10000, ['c', 'a', 'b']);
  ok('100 between three: 33.34, 33.33, 33.33, the extra paisa to the first in id order', r.a === 3334 && r.b === 3333 && r.c === 3333 && sumOf(r) === 10000, JSON.stringify(r));
  ok('the same cost splits the same way whatever order the people come in', JSON.stringify(S.equalShares(10000, ['a', 'b', 'c'])) === JSON.stringify(r));
  const two = S.equalShares(5, ['x', 'y', 'z', 'w']);
  ok('5 paise between four: 2, 1, 1, 1', two.w === 2 && two.x === 1 && two.y === 1 && two.z === 1);
  ok('a person named twice shares once', Object.keys(S.equalShares(900, ['a', 'a', 'b'])).length === 2 && S.equalShares(900, ['a', 'a', 'b']).a === 450);
  ok('one person takes it all', S.equalShares(999, ['a']).a === 999);
  ok('nobody to share with, or an amount that is not whole paise, is refused', S.equalShares(100, []) === null && S.equalShares(10.5, ['a']) === null && S.equalShares(-1, ['a']) === null);
}

// ---- uneven shares
{
  const u = S.unevenShares(100000, { a: 60000, b: 30000, c: 10000 });
  ok('600 + 300 + 100 of 1000 is taken as typed', u.shares && u.shares.a === 60000 && u.shares.b === 30000 && u.shares.c === 10000);
  const short = S.unevenShares(100000, { a: 60000, b: 30000 });
  ok('shares that do not add up are refused, and the reason says both sums', !short.shares && short.error === 'The shares add up to 900.00. They must add up to 1000.00.', short.error);
  const over = S.unevenShares(100000, { a: 60000, b: 40001 });
  ok('one paisa over is refused too', !over.shares && /1000\.01/.test(over.error));
  ok('a share of nothing drops that person', Object.keys(S.unevenShares(500, { a: 500, b: 0 }).shares).join() === 'a');
  ok('all zero is refused', /at least one/.test(S.unevenShares(0, { a: 0 }).error));
  ok('a share that is not whole paise is refused', /Write each share/.test(S.unevenShares(100, { a: 50.5, b: 49.5 }).error) && /Write each share/.test(S.unevenShares(100, { a: -50, b: 150 }).error));
}

// ---- who owes whom
const settles = (net, ts) => { const left = { ...net }; for (const t of ts) { left[t.from] += t.amount; left[t.to] -= t.amount; } return Object.values(left).every(v => v === 0); };
{
  // A trip: Meera paid 6000 for rooms, Rohan 2400 for the taxi, Papa 600
  // for sweets; three people, equal shares of 3000 each.
  const costs = [
    { amount: 600000, paidBy: 'meera', shares: S.equalShares(600000, ['meera', 'rohan', 'papa']) },
    { amount: 240000, paidBy: 'rohan', shares: S.equalShares(240000, ['meera', 'rohan', 'papa']) },
    { amount: 60000, paidBy: 'papa', shares: S.equalShares(60000, ['meera', 'rohan', 'papa']) }];
  const L = S.ledger(costs, []);
  ok('the total is 9000', L.total === 900000);
  ok('each share is 3000', L.people.meera.share === 300000 && L.people.rohan.share === 300000 && L.people.papa.share === 300000);
  ok('what each has paid', L.people.meera.paid === 600000 && L.people.rohan.paid === 240000 && L.people.papa.paid === 60000);
  ok('Meera is owed 3000, Rohan owes 600, Papa owes 2400', L.people.meera.net === 300000 && L.people.rohan.net === -60000 && L.people.papa.net === -240000);
  ok('two transfers: Papa pays Meera 2400, Rohan pays Meera 600', L.owes.length === 2
     && L.owes.some(o => o.from === 'papa' && o.to === 'meera' && o.amount === 240000) && L.owes.some(o => o.from === 'rohan' && o.to === 'meera' && o.amount === 60000), JSON.stringify(L.owes));
  const after = S.ledger(costs, [{ from: 'rohan', to: 'meera', amount: 60000 }]);
  ok('once Rohan has paid, only Papa owes', after.owes.length === 1 && after.owes[0].from === 'papa' && after.owes[0].amount === 240000 && after.people.rohan.net === 0);
  const done = S.ledger(costs, [{ from: 'rohan', to: 'meera', amount: 60000 }, { from: 'papa', to: 'meera', amount: 240000 }]);
  ok('once both have paid, nobody owes anybody', done.owes.length === 0 && Object.values(done.people).every(p => p.net === 0));
}
{
  ok('nobody owes anything: no transfers', S.fewestTransfers({ a: 0, b: 0 }).length === 0 && S.fewestTransfers({}).length === 0);
  ok('books that do not balance give nothing, never a guess', S.fewestTransfers({ a: 100, b: -99 }) === null);
  // The simple way (biggest debt to biggest credit) needs four here; the
  // fewest is three: c pays b 4, d pays a 3, e pays a 3.
  const net = { a: 600, b: 400, c: -400, d: -300, e: -300 };
  const ts = S.fewestTransfers(net);
  ok('FEWEST: five people settled in three transfers, where the simple way takes four', ts.length === 3 && settles(net, ts), JSON.stringify(ts));
  ok('and c pays b exactly, in one', ts.some(t => t.from === 'c' && t.to === 'b' && t.amount === 400));
  const pairs = { a: 100, b: -100, c: 250, d: -250, e: 7, f: -7 };
  ok('three pairs are three transfers, each to its own match', S.fewestTransfers(pairs).length === 3 && settles(pairs, S.fewestTransfers(pairs)));
  ok('the answer is the same every time', JSON.stringify(S.fewestTransfers(net)) === JSON.stringify(S.fewestTransfers({ e: -300, d: -300, c: -400, b: 400, a: 600 })));
  ok('nobody pays themselves, and every transfer is above zero', ts.every(t => t.from !== t.to && t.amount > 0));
  const big = {}; let tot = 0;
  for (let i = 0; i < 20; i++) { big['m' + String(i).padStart(2, '0')] = i < 19 ? (i % 2 ? 1 : -1) * (100 + i) : 0; }
  for (const k of Object.keys(big)) tot += big[k];
  big.m19 = -tot;
  const bt = S.fewestTransfers(big);
  ok('a family of twenty still settles, in fewer transfers than people', settles(big, bt) && bt.length <= 19);
}

// ---- no paisa is lost or invented: many made-up trips, a fixed seed
{
  let seed = 20261112;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  let bad = null, most = 0;
  for (let round = 0; round < 3000 && !bad; round++) {
    const people = Array.from({ length: 2 + rnd(9) }, (_, i) => 'p' + i);
    const costs = [];
    for (let c = 0, nc = 1 + rnd(8); c < nc; c++) {
      const amount = 1 + rnd(5000000);
      const between = people.filter(() => rnd(3) > 0);
      if (!between.length) between.push(people[rnd(people.length)]);
      let shares;
      if (rnd(4) === 0) {
        // uneven: cut the amount at random places
        const typed = {}; let left = amount;
        between.forEach((id, i) => { const part = i === between.length - 1 ? left : rnd(left + 1); typed[id] = part; left -= part; });
        const u = S.unevenShares(amount, typed);
        if (!u.shares) { bad = 'uneven refused a sum that adds up: ' + JSON.stringify(typed); break; }
        shares = u.shares;
      } else shares = S.equalShares(amount, between);
      if (sumOf(shares) !== amount) { bad = 'shares do not add up to the cost: ' + amount + ' ' + JSON.stringify(shares); break; }
      if (!Object.values(shares).every(v => Number.isSafeInteger(v) && v >= 0)) { bad = 'a share is not whole paise'; break; }
      costs.push({ amount, paidBy: people[rnd(people.length)], shares });
    }
    if (bad) break;
    const L = S.ledger(costs, []);
    const nets = Object.values(L.people).map(p => p.net);
    if (nets.reduce((a, b) => a + b, 0) !== 0) { bad = 'the balances do not add up to zero'; break; }
    if (L.total !== costs.reduce((a, c) => a + c.amount, 0)) { bad = 'the total is not the sum of the costs'; break; }
    if (Object.values(L.people).reduce((a, p) => a + p.share, 0) !== L.total || Object.values(L.people).reduce((a, p) => a + p.paid, 0) !== L.total) { bad = 'shares or payments do not add up to the total'; break; }
    const net = {}; for (const id of Object.keys(L.people)) net[id] = L.people[id].net;
    if (!settles(net, L.owes)) { bad = 'the transfers do not clear every balance: ' + JSON.stringify(net) + ' ' + JSON.stringify(L.owes); break; }
    if (!L.owes.every(t => Number.isSafeInteger(t.amount) && t.amount > 0 && t.from !== t.to && net[t.from] < 0 && net[t.to] > 0)) { bad = 'a transfer is not from someone who owes to someone who is owed'; break; }
    const busy = nets.filter(v => v !== 0).length;
    if (L.owes.length > Math.max(0, busy - 1)) { bad = 'more transfers than people minus one: ' + L.owes.length + ' for ' + busy; break; }
    most = Math.max(most, L.owes.length);
    // Paying each line, one by one, ends with nobody owing anybody.
    const paid = S.ledger(costs, L.owes);
    if (paid.owes.length || !Object.values(paid.people).every(p => p.net === 0)) { bad = 'after every line is paid, something is still owed'; break; }
  }
  ok('3000 made-up trips: no paisa lost or invented, every balance cleared, never more than people minus one', !bad, bad);
  ok('the loop met real work (several transfers at once)', most >= 5, String(most));
}
{
  // The exact answer is never worse than the simple one. Each made-up
  // family is built from small groups that settle among themselves (one
  // person owed, one or two who owe), so the fewest is known: people minus
  // groups.
  let seed = 77, worse = 0, better = 0, over = 0;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  for (let round = 0; round < 400; round++) {
    const net = {}; let n = 0, groups = 0;
    for (let g = 0, ng = 2 + rnd(3); g < ng; g++) {
      const a = 1 + rnd(900), b = rnd(2) ? 1 + rnd(900) : 0;
      net['q' + (n++)] = a + b; net['q' + (n++)] = -a; if (b) net['q' + (n++)] = -b;
      groups++;
    }
    const exact = S.fewestTransfers(net).length;
    if (exact > n - groups) over++;
    // the simple way, written here on purpose so the two can be compared
    const owe = Object.keys(net).filter(k => net[k] < 0).map(k => [k, -net[k]]), due = Object.keys(net).filter(k => net[k] > 0).map(k => [k, net[k]]);
    let simple = 0;
    while (owe.length && due.length) { owe.sort((a, b) => b[1] - a[1]); due.sort((a, b) => b[1] - a[1]); const m = Math.min(owe[0][1], due[0][1]); owe[0][1] -= m; due[0][1] -= m; simple++; if (!owe[0][1]) owe.shift(); if (!due[0][1]) due.shift(); }
    if (exact > simple) worse++; if (exact < simple) better++;
  }
  ok('fewest transfers never takes more than people minus the groups that settle among themselves', over === 0, String(over));
  ok('fewest transfers is never more than the simple way, and is sometimes fewer', worse === 0 && better > 0, worse + ' worse, ' + better + ' better');
}

// ---- the UPI link
{
  const link = S.upiLink({ pa: 'meera@okhdfcbank', pn: 'Meera', amount: 125000, cu: 'INR', tn: 'Goa trip' });
  ok('the link, exactly', link === 'upi://pay?pa=meera%40okhdfcbank&pn=Meera&am=1250.00&cu=INR&tn=Goa%20trip', link);
  const enc = S.upiLink({ pa: 'meera.k-1_x@ybl', pn: 'Meera & Sons #1', amount: 125050, tn: 'Diwali: sweets & gifts? 100%' });
  ok('every field is encoded: & # ? % : and spaces never break out', enc === 'upi://pay?pa=meera.k-1_x%40ybl&pn=Meera%20%26%20Sons%20%231&am=1250.50&cu=INR&tn=Diwali%3A%20sweets%20%26%20gifts%3F%20100%25', enc);
  ok('exactly five fields, in order', enc.split('?')[1].split('&').map(p => p.split('=')[0]).join() === 'pa,pn,am,cu,tn');
  ok('a name in Devanagari is encoded too', /pn=%E0%A4/.test(S.upiLink({ pa: 'a1@upi', pn: 'मीरा', amount: 100, tn: 'x' })));
  for (const id of ['', 'meera', '@okhdfc', 'meera@', 'meera@ok hdfc', 'meera@okhdfc&am=1', 'meera@ok.hdfc', 'me era@okhdfc', 'meera@@okhdfc', 'meera@okhdfc?x=1', 'a@b', 'upi://pay?pa=x@y', 'meera@okhdfc\n', '9876543210', null, undefined])
    ok('a malformed UPI id gives no link: ' + JSON.stringify(id), S.upiLink({ pa: id, pn: 'Meera', amount: 100, tn: 'x' }) === null && !S.isUpiId(id));
  ok('a phone number id is a UPI id', S.isUpiId('9876543210@paytm') && S.isUpiId('meera.kapoor@okicici'));
  ok('no link for nothing, a fraction or a minus amount', S.upiLink({ pa: 'a1@upi', pn: 'A', amount: 0, tn: 'x' }) === null && S.upiLink({ pa: 'a1@upi', pn: 'A', amount: 10.5, tn: 'x' }) === null && S.upiLink({ pa: 'a1@upi', pn: 'A', amount: -100, tn: 'x' }) === null);
  ok('NO LINK when the plan is not in rupees', S.upiLink({ pa: 'a1@upi', pn: 'A', amount: 100, cu: 'USD', tn: 'x' }) === null && S.upiLink({ pa: 'a1@upi', pn: 'A', amount: 100, cu: 'XXX', tn: 'x' }) === null);
  ok('the link never carries anything but those five fields', !/pin|mc=|tr=|url=/i.test(link));
}

// ---- watch or listen together: the words and the window
{
  ok('a show or a film is watched', T.togetherVerb('show').label === 'Watch together' && T.togetherVerb('film').label === 'Watch together');
  ok('a song or an album is listened to', T.togetherVerb('song').label === 'Listen together' && T.togetherVerb('album').label === 'Listen together');
  ok('a game is played, a place to eat is gone to, a book is read', T.togetherVerb('game').label === 'Play together' && T.togetherVerb('eat').label === 'Go together' && T.togetherVerb('book').label === 'Read together');
  ok('with no kind it is Watch together', T.togetherVerb(null).label === 'Watch together' && T.togetherVerb('nonsense').key === 'watch');
  ok('three answers', T.TOGETHER_ANSWERS.map(a => a[1]).join() === 'I am in,Maybe,Cannot' && T.isTogetherAnswer('maybe') && !T.isTogetherAnswer('yes'));
  const at = Date.parse('2026-11-14T14:30:00Z');
  ok('"Open it" is not shown 11 minutes before', !T.togetherOpenNow(at, at - 11 * 60000));
  ok('it shows from 10 minutes before', T.togetherOpenNow(at, at - 10 * 60000) && T.togetherOpenNow(at, at));
  ok('until 3 hours after, and not a minute more', T.togetherOpenNow(at, at + 180 * 60000) && !T.togetherOpenNow(at, at + 181 * 60000));
  ok('a time that is not a time never opens', !T.togetherOpenNow('soon', at));
  ok('"On Prime Video", and nothing for Other or none', T.togetherOn('prime') === 'On Prime Video' && T.togetherOn('other') === '' && T.togetherOn(null) === '' && T.togetherOn('hbo') === '');
  // 0 Sunday .. 6 Saturday
  ok('on a Thursday the default is this Saturday', T.togetherDaysToSaturday(4, 10, 0) === 2);
  ok('on Saturday morning it is today', T.togetherDaysToSaturday(6, 9, 0) === 0 && T.togetherDaysToSaturday(6, 20, 0) === 0);
  ok('on Saturday after 8pm it is next Saturday', T.togetherDaysToSaturday(6, 20, 1) === 7 && T.togetherDaysToSaturday(6, 23, 0) === 7);
  ok('on Sunday it is six days on', T.togetherDaysToSaturday(0, 12, 0) === 6);
}

// ---- the file itself: whole numbers only, and nothing imported
{
  const src = await readFile(new URL('../../api/_splitmath.mjs', import.meta.url), 'utf8');
  ok('_splitmath.mjs imports nothing', !/^\s*import\s/m.test(src) && !/\bimport\(/.test(src) && !/\brequire\(/.test(src));
  ok('no parseFloat, toFixed, Math.round or Number(...) of an amount', !/parseFloat|toFixed|Math\.round|Math\.floor|Math\.ceil/.test(src));
  ok('no number with a point in it anywhere in the sums', !/\d\.\d/.test(src.replace(/\/\/.*$/gm, '').replace(/'[^'\n]*'/g, "''")));
  const tg = await readFile(new URL('../../api/_together.mjs', import.meta.url), 'utf8');
  ok('_together.mjs imports only the Pasand rules at the top', (tg.match(/^import .*$/gm) || []).length === 1 && /^import .* from '\.\/_pasandrules\.mjs';$/m.test(tg));
}

if (fails.length) { console.error('splitmathtest: ' + fails.length + ' FAILED of ' + (pass + fails.length)); fails.forEach(f => console.error('  FAIL ' + f)); process.exit(1); }
console.log('splitmathtest: ' + pass + '/' + pass + ' checks pass');
