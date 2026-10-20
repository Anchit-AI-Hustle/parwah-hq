// THE LAUNCH LIST, as pure logic.
//
// api/_waitlist.mjs imports only _phone.mjs, which imports nothing, so the
// deploy gate runs this on a fresh clone before npm install.
import { joinError, joinRow, joinedMessage, normEmail, normInterest,
         consentGiven, emailError, nameError, normSource, INTERESTS,
         LIMIT, HONEYPOT, isBot, proofCounts } from '../../api/_waitlist.mjs';

let pass = 0; const fails = [];
const ok = (name, cond) => cond ? pass++ : fails.push(name);

// ---- CONSENT IS EXPLICIT OR IT IS NOT CONSENT (DPDP).
// The one rule that is not a nicety. A list built without a recorded yes is
// not a list we are allowed to message.
ok('an unticked box is not consent', consentGiven(false) === false);
ok('a missing field is not consent', consentGiven(undefined) === false);
ok('the string false is not consent', consentGiven('false') === false);
ok('the string no is not consent', consentGiven('no') === false);
ok('empty is not consent', consentGiven('') === false);
ok('zero is not consent', consentGiven('0') === false);
ok('a ticked checkbox sends on, and that is consent', consentGiven('on') === true);
ok('a JSON true is consent', consentGiven(true) === true);
ok('the string true is consent', consentGiven('true') === true);
ok('and a join without consent is refused',
   /tick the box/.test(joinError({ name: 'Anchit', email: 'a@b.com' }) || ''));
ok('even when everything else is perfect',
   joinError({ name: 'Anchit', email: 'a@b.com', city: 'Delhi', interest: 'care', consent: false }) !== null);

// ---- ONE PERSON IS ONE ROW.
// Someone who joins as Anchit@ and again as anchit@ is one person. Lowercase
// on the way in, so the unique index can do its job.
ok('an address is stored lowercased', normEmail('  Anchit@Parwah.IN  ') === 'anchit@parwah.in');
ok('and whitespace around it is not part of it', normEmail(' a@b.com ') === 'a@b.com');

// ---- A TYPO COSTS A LAUNCH ANNOUNCEMENT.
ok('an address with no @ is caught', emailError('anchit.parwah.in') !== null);
ok('an address with no domain dot is caught', emailError('anchit@localhost') !== null);
ok('an address with a space is caught', emailError('an chit@b.com') !== null);
ok('two @ signs are caught', emailError('a@b@c.com') !== null);
ok('an empty address is caught', emailError('') !== null);
ok('an ordinary address passes', emailError('anchit.tandon@gmail.com') === null);
ok('a subdomain address passes', emailError('a@mail.co.in') === null);
ok('a plus-tagged address passes', emailError('a+launch@b.com') === null);
ok('an address longer than the column is caught',
   emailError('a'.repeat(LIMIT.email) + '@b.com') !== null);

// ---- THE NAME IS A NAME.
ok('an empty name is caught', nameError('') !== null);
ok('a one-letter name is caught', nameError('A') !== null);
ok('a name past the column length is caught', nameError('a'.repeat(LIMIT.name + 1)) !== null);
ok('an ordinary name passes', nameError('Anchit Tandon') === null);
ok('inner runs of space are collapsed, not rejected',
   joinRow({ name: 'Anchit   Tandon', email: 'a@b.com', consent: true }).name === 'Anchit Tandon');

// ---- INTEREST IS THE FIELD THAT EARNS ITS PLACE.
// It is the only thing on the form that answers "which half do we build
// next", so an unrecognised value must never drop someone off the list.
ok('the three interests are the three halves', INTERESTS.join(',') === 'care,app,both');
ok('care is kept', normInterest('care') === 'care');
ok('app is kept', normInterest('app') === 'app');
ok('case does not matter', normInterest('CARE') === 'care');
ok('an unknown value becomes both rather than an error', normInterest('grabbars') === 'both');
ok('a missing value becomes both', normInterest(undefined) === 'both');
ok('and null becomes both, not the string null', normInterest(null) === 'both');

// ---- A PHONE IS OPTIONAL, BUT A WRONG ONE IS WORTH SAYING SO ABOUT.
ok('no phone is fine', joinError({ name: 'Anchit', email: 'a@b.com', consent: true }) === null);
ok('a blank phone is fine', joinError({ name: 'Anchit', email: 'a@b.com', phone: '   ', consent: true }) === null);
ok('a short phone is refused', joinError({ name: 'Anchit', email: 'a@b.com', phone: '12345', consent: true }) !== null);
ok('a good Indian number is accepted',
   joinRow({ name: 'Anchit', email: 'a@b.com', phone: '9873945238', consent: true }).phone === '+919873945238');
ok('and it is stored dialable, as one string not an object',
   typeof joinRow({ name: 'A B', email: 'a@b.com', phone: '9873945238', consent: true }).phone === 'string');
ok('a number typed with spaces and dashes still works',
   joinRow({ name: 'A B', email: 'a@b.com', phone: '98739-45238', consent: true }).phone === '+919873945238');

// ---- THE ORDER OF COMPLAINTS FOLLOWS THE ORDER OF THE FORM.
// A message about the last field while the person is looking at the first
// one reads as a broken form.
ok('the name is complained about before the email',
   /name/i.test(joinError({ name: '', email: 'nonsense', consent: true }) || ''));
ok('the email is complained about before the consent',
   /email/i.test(joinError({ name: 'Anchit', email: 'nonsense' }) || ''));

// ---- SOURCE IS A LABEL, NOT A FIELD SOMEONE CAN WRITE INTO.
ok('punctuation is stripped from the source', normSource('launch!!;drop') === 'launchdrop');
ok('an empty source has a default', normSource('') === 'site');
ok('a very long source is cut to the column', normSource('x'.repeat(200)).length <= LIMIT.source);

// ---- WHAT THE PERSON IS TOLD IS THE SAME EITHER WAY.
// "You are already on the list" answers "does this address exist here",
// one address at a time, for free.
ok('the confirmation names what they joined for',
   /care range/.test(joinedMessage('care')) && /family app/.test(joinedMessage('app')));
ok('and it never says whether they were already there',
   !/already|again|existing/i.test(joinedMessage('care') + joinedMessage('app') + joinedMessage('both')));

// ---- THE ROW IS SHAPED, AND NOTHING ELSE RIDES ALONG.
const row = joinRow({ name: 'Anchit', email: 'A@B.com', consent: true, admin: true, id: 'x' });
ok('only the columns we asked for are in the row',
   Object.keys(row).sort().join(',') === 'city,consent,email,interest,name,phone,source');
ok('an extra field in the body cannot become a column', row.admin === undefined && row.id === undefined);

// ---- THE HONEYPOT. A person never sees the field, so only a bot fills it.
ok('the trap has a name no autofill recognises', HONEYPOT === 'pw_extra' && !/web|url|site|mail|name|phone|address/i.test(HONEYPOT));
ok('an empty trap is a person', isBot({ name: 'Anchit', pw_extra: '' }) === false);
ok('a missing trap is a person', isBot({ name: 'Anchit' }) === false);
ok('whitespace in the trap is still a person (autofill can leave a space)', isBot({ pw_extra: '   ' }) === false);
ok('a filled trap is a bot', isBot({ pw_extra: 'http://spam.example' }) === true);
ok('no body at all is not a crash', isBot(undefined) === false && isBot(null) === false);
ok('and the trap never becomes a column', joinRow({ name: 'A B', email: 'a@b.com', consent: true, pw_extra: 'x' }).pw_extra === undefined);

// ---- THE PROOF IS COUNTED, NEVER INVENTED.
ok('two real counts pass through', JSON.stringify(proofCounts(12, 40)) === '{"waitlist":12,"users":40}');
ok('zero is a real count, not a missing one', JSON.stringify(proofCounts(0, 0)) === '{"waitlist":0,"users":0}');
ok('a count as a string from the driver still counts', proofCounts('7', '9').waitlist === 7);
ok('a missing count means no proof, so the page shows its marked sample', proofCounts(undefined, 4) === null);
ok('a negative count is not a count', proofCounts(-1, 4) === null);
ok('a fraction is not a count', proofCounts(1.5, 4) === null);
ok('nonsense is not a count', proofCounts('lots', 4) === null);

console.log(`waitlisttest: ${pass}/${pass + fails.length} checks pass`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
