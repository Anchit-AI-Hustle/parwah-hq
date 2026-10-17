// BASIC CHECKS: names, dates of birth, rupee amounts, links and head-counts.
// api/_valid.mjs is dependency-free, so the deploy gate runs this on a fresh
// clone. The app mirrors these rules; the server is the one that decides.
import { nameError, cleanName, dobError, amountError, amountOf, urlError, countError, NAME_MAX } from '../../api/_valid.mjs';

let pass = 0; const fails = [];
const ok = (name, cond) => cond ? pass++ : fails.push(name);

// ---- names
for (const good of ['Rohan', 'Papa', 'Dr. Mehra', "D'Souza", 'Anne-Marie', 'परवाह', 'Kamla Devi', 'Rohan 2', 'Sharma Family'])
  ok(`"${good}" is a name`, nameError(good) === null);
ok('an empty name is refused', /Write the name/.test(nameError('  ')));
ok('only symbols is refused', /needs letters/.test(nameError('....')) && /needs letters/.test(nameError('1234')));
ok('a phone number in the name box is refused', /phone number/.test(nameError('Rohan 98100 12345')));
ok('an email in the name box is refused', /email/.test(nameError('rohan@gmail.com')));
ok('markup is refused', nameError('<b>Rohan</b>') !== null && nameError('Ro{han}') !== null);
ok('a name over the limit is refused', /longer than 60/.test(nameError('a'.repeat(NAME_MAX + 1))));
ok('the thing being named is said', /family name/.test(nameError('', 'family name')));
ok('spaces are tidied', cleanName('  Rohan    Sharma ') === 'Rohan Sharma');

// ---- dates of birth
const T = '2026-10-04';
ok('no date is allowed', dobError('', T) === null && dobError(null, T) === null);
ok('a real past date is fine', dobError('1958-01-05', T) === null);
ok('today is fine', dobError(T, T) === null);
ok('tomorrow is refused', /future/.test(dobError('2026-10-05', T)));
ok('a date that does not exist is refused', /does not exist/.test(dobError('2023-02-30', T)));
ok('a typed date in another shape is refused', /calendar/.test(dobError('05/01/1958', T)));
ok('before 1900 is refused', /1900/.test(dobError('1899-12-31', T)));

// ---- rupees
ok('a plain amount is fine', amountError('5000') === null && amountOf('5000') === 5000);
ok('commas and the rupee sign are fine', amountError('₹ 5,000') === null && amountOf('₹ 5,000') === 5000);
ok('optional and empty is fine', amountError('') === null);
ok('required and empty is refused', /Write the amount/.test(amountError('', { required: true })));
ok('zero is refused', /more than/.test(amountError('0')));
ok('negative is refused', /whole number/.test(amountError('-5')));
ok('"5k" is refused', /whole number/.test(amountError('5k')));
ok('paise are refused', /whole number/.test(amountError('99.50')));
ok('over the cap is refused', /more than ₹/.test(amountError('20000000', { max: 10000000 })));
ok('a pound or dollar sign is fine too', amountOf('£ 5,000') === 5000 && amountOf('$5000') === 5000);
ok('the limit is said in the payer\'s own money', /more than £10,000,000/.test(amountError('20000000', { max: 10000000, cur: 'GBP' })));
ok('a currency we cannot name is a plain number, never rupees', !/₹/.test(amountError('20000000', { max: 10000000, cur: null })));

// ---- links
ok('an https link is fine', urlError('https://youtu.be/abc') === null);
ok('no link is fine', urlError('') === null);
ok('a sentence is not a link', /not a link/.test(urlError('my favourite song')));
ok('javascript: is refused', /Only web links/.test(urlError('javascript:alert(1)')));
ok('a host with no domain is refused', urlError('https://localhost/x') !== null);

// ---- how many people
ok('empty is fine', countError('') === null);
ok('6 is fine', countError('6', 50) === null);
ok('0 is refused', countError('0', 50) !== null);
ok('2.5 is refused', countError('2.5', 50) !== null);
ok('over the cap is refused', /more than 50/.test(countError('51', 50)));

ok('no copy uses an em or en dash', !/[\u2013\u2014]/.test([
  nameError(''), nameError('....'), nameError('a@b'), nameError('9810012345x'), dobError('2099-01-01', T), dobError('x', T),
  amountError('0'), amountError('x'), urlError('x'), countError('0'), countError('900')].join(' ')));

if (fails.length) {
  console.error(`validtest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`validtest: ${pass}/${pass} checks pass`);
