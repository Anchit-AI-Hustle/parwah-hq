// What an Indian ID looks like — the rules the field applies as you type and
// the server applies before it stores anything. No imports, so this runs on a
// fresh clone before npm install.
import { DOC_ID, bare, format, progress, looksLike, checkNumber, verhoeffOk, fitsChars,
         PAN_HOLDER, panFacts } from '../../api/_docid.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log('FAIL', n)); };

// A real Aadhaar satisfies Verhoeff; change one digit and it must not.
const AAD = '234123412346';
ok(verhoeffOk(AAD), 'a valid Aadhaar passes the checksum');
ok(!verhoeffOk('234123412347'), 'one wrong digit fails it');
ok(!verhoeffOk('23412341234a'), 'a non-digit fails rather than throwing');

// ---- stripping and grouping ---------------------------------------------
ok(bare(' alvpt-2248 r ') === 'ALVPT2248R', 'spaces, case and dashes are not part of a number');
ok(format('aadhaar', AAD) === '2341 2341 2346', 'Aadhaar reads in threes of four');
ok(format('aadhaar', '12345678') === '1234 5678', 'and groups while it is still being typed');
ok(format('aadhaar', '1') === '1', 'a single digit is left alone');
ok(format('pan', 'ALVPT2248R') === 'ALVPT 2248 R', 'a PAN groups 5-4-1');
ok(format('passport', 'A1234567') === 'A 1234567', 'a passport splits the letter off');
ok(format('dl', 'DL0420110012345') === 'DL-04-2011-0012345', 'a licence uses hyphens, not spaces');
ok(format('voter', 'ABC1234567') === 'ABC 1234567', 'a voter ID splits 3-7');
ok(format('other', 'xyz-1') === 'XYZ1', 'a kind with no shape is just cleaned up');
ok(format('aadhaar', AAD + '999') === '2341 2341 2346 999', 'anything past the shape is still shown, not swallowed');

// ---- what the field says while you type ---------------------------------
ok(progress('aadhaar', '').state === 'empty', 'an empty field is not an error');
ok(progress('aadhaar', '').text === DOC_ID.aadhaar.hint, 'it just says what is wanted');
const p4 = progress('aadhaar', '1234');
ok(p4.state === 'typing' && p4.text.indexOf('4 of 12') === 0, 'four digits in, it counts → ' + p4.text);
ok(progress('aadhaar', AAD).state === 'ok', 'a complete valid Aadhaar is accepted');
ok(progress('aadhaar', '234123412347').state === 'bad', 'a complete WRONG one is refused');
ok(/does not add up/.test(progress('aadhaar', '234123412347').text), 'and told why → ' + progress('aadhaar','234123412347').text);
ok(progress('aadhaar', '012341234123').state === 'bad', 'an Aadhaar starting 0 is refused at full length');
ok(progress('pan', 'ALVPT').state === 'typing', 'a half-typed PAN is not yet wrong');
ok(progress('pan', 'ALVPT2248R').state === 'ok', 'a whole one is right');
ok(progress('other', 'ab').state === 'short' && progress('other', 'abcd').state === 'ok',
   'a free reference just needs a few characters');

// A letter is not progress towards twelve digits.
ok(fitsChars('aadhaar', '1234') && !fitsChars('aadhaar', '1234A'), 'an Aadhaar holds digits and nothing else');
ok(fitsChars('pan', 'ALVPT2248R') && !fitsChars('other', 'anything') === false, 'a PAN holds letters and digits');
const mixed = progress('aadhaar', '12345678ABC');
ok(mixed.state === 'bad', 'digits mixed with letters is wrong, not "11 of 12"');
ok(/does not contain those characters/.test(mixed.text), 'and says which characters do not belong → ' + mixed.text);

// ---- the actual thing that went wrong: a PAN in the Aadhaar box ---------
ok(looksLike('ALVPT2248R', 'aadhaar') === 'pan', 'a PAN typed under Aadhaar is recognised as a PAN');
ok(looksLike(AAD, 'pan') === 'aadhaar', 'and the other way round');
ok(looksLike('A1234567', 'aadhaar') === 'passport', 'a passport number is recognised too');
ok(looksLike('ABC1234567', 'aadhaar') === 'voter', 'so is a voter ID');
ok(looksLike('ALVPT2248R', 'pan') === null, 'a PAN under PAN suggests nothing');
ok(looksLike('ALVP', 'aadhaar') === null, 'a half-typed value never triggers a suggestion');
ok(looksLike('', 'aadhaar') === null, 'nor an empty one');
ok(looksLike('ZZZZZZZZZZZZ', 'aadhaar') === null, 'nor rubbish that is nothing in particular');

// ---- every shape is described completely --------------------------------
Object.keys(DOC_ID).forEach(k => {
  const d = DOC_ID[k];
  const sum = d.group.reduce((a, b) => a + b, 0);
  ok(sum === d.len, k + ': the groups add up to its length (' + sum + ' vs ' + d.len + ')');
  ok(!!d.example && bare(d.example).length === d.len, k + ': the example is a full-length one');
  ok(!!d.hint && !!d.label && !!d.inputmode, k + ': it says what it wants, in words');
  ok(d.chars instanceof RegExp, k + ': its allowed characters are a pattern');
});
ok(DOC_ID.aadhaar.inputmode === 'numeric', 'an Aadhaar raises the number keypad on a phone');
ok(DOC_ID.pan.upper === true && !DOC_ID.aadhaar.upper, 'letters are upper-cased only where there are letters');

// ---- the server's verdict is unchanged by any of this -------------------
ok(checkNumber('aadhaar', '2341 2341 2346').ok, 'a spaced Aadhaar is still accepted');
ok(checkNumber('aadhaar', '2341 2341 2346').last4 === '2346', 'and only its last four come back');
ok(checkNumber('pan', 'alvpt2248r').ok, 'a lower-case PAN is accepted');
ok(!checkNumber('aadhaar', 'ALVPT2248R').ok, 'a PAN is still refused under Aadhaar');
ok(checkNumber('other', '').ok && checkNumber('other', '').last4 === null, 'no number at all is fine — it is optional');


// ---- what a PAN really encodes -------------------------------------------
// Free, offline, and published by the Income Tax Department: the 4th character
// is the holder's type and the 5th is the first letter of their surname. No
// paid API, no licence. It does NOT prove the card was issued, and nothing
// here pretends the 10th character can be checked — that algorithm has never
// been published, so we do not invent one.
ok(PAN_HOLDER.P === 'an individual' && PAN_HOLDER.C === 'a company' && PAN_HOLDER.H.includes('Hindu'),
   'the holder codes are the published ones');
ok(Object.keys(PAN_HOLDER).length === 10, 'all ten holder types are covered');
const me = panFacts('ALVPT2248R', 'Anchit Tandon');
ok(me.isIndividual && me.holder === 'an individual', 'a P in the 4th place is a person');
ok(me.initial === 'T' && me.surname === 'Tandon' && me.initialMatches === true,
   'and the 5th letter is checked against the surname');
const co = panFacts('AAACR5055K', 'Reliance Industries Limited');
ok(!co.isIndividual && co.holder === 'a company', 'a C is a company');
ok(panFacts('ALVPT2248R', 'Anchit Sharma').initialMatches === false,
   'a surname that does not start with the 5th letter is reported');
ok(panFacts('ALVPT2248R', '').initialMatches === null,
   'with no name to compare, it claims nothing rather than guessing');
ok(panFacts('ALVPT2248R', 'Anchit').initialMatches === false,
   'a single-word name is compared as the whole name');
ok(panFacts('ALVP2248R', 'Anchit Tandon') === null && panFacts('', 'x') === null,
   'a malformed PAN yields no facts at all');
ok(panFacts('ALVZT2248R', 'Anchit Tandon').holder === null,
   'an unknown holder code is left null, never guessed');
ok(!/checksum|check digit/i.test(JSON.stringify(panFacts('ALVPT2248R', 'Anchit Tandon'))),
   'nothing here claims to verify the tenth character');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
