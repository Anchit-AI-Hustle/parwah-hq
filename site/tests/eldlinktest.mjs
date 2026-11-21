// A link for someone not on the app: the rules, with nothing but Node.
// api/_eldlinkrules.mjs imports nothing, so this runs in the deploy gate
// before npm install.
//
//   node site/tests/eldlinktest.mjs
import * as R from '../../api/_eldlinkrules.mjs';
import { readFileSync } from 'node:fs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

// ---- the key
ok('the key is 256 bits: 32 bytes, 43 base64url characters', R.ELD.tokenBytes === 32 && Buffer.alloc(32).toString('base64url').length === 43);
ok('a key of the right shape is looked up', R.tokenShape('A'.repeat(43)) && R.tokenShape('aZ09_-'.repeat(7) + 'x'));
ok('anything else is never looked up: short, long, other characters, not a string',
  !R.tokenShape('A'.repeat(42)) && !R.tokenShape('A'.repeat(44)) && !R.tokenShape('A'.repeat(42) + '=') && !R.tokenShape('A'.repeat(42) + ' ')
  && !R.tokenShape('') && !R.tokenShape(null) && !R.tokenShape(undefined) && !R.tokenShape(['A'.repeat(43)]) && !R.tokenShape({}) && !R.tokenShape("' or 1=1 --" + 'A'.repeat(32)));
ok('the key rides after the #, on the page\'s own address', R.linkPath('K') === '/apna/#k=K' && R.ELD.page === '/apna/');
ok('it travels to the server in a header, never in an address', R.ELD.header === 'x-parwah-link');

// ---- expiry, with the clock passed in
const t0 = Date.UTC(2026, 10, 20, 6, 0, 0), DAY = 86400000;
ok('a link lasts 90 days', R.ELD.days === 90 && R.expiryFrom(t0).getTime() === t0 + 90 * DAY);
const row = { expires_at: new Date(t0 + 90 * DAY), revoked_at: null };
ok('on, on the day it was made and on its 90th day', R.linkState(row, t0) === 'on' && R.linkState(row, t0 + 90 * DAY - 1) === 'on');
ok('expired at the very moment its days run out, and after', R.linkState(row, t0 + 90 * DAY) === 'expired' && R.linkState(row, t0 + 400 * DAY) === 'expired');
ok('kept on for 90 more days, it is on again', R.linkState({ ...row, expires_at: R.expiryFrom(t0 + 100 * DAY) }, t0 + 100 * DAY) === 'on');
ok('turned off is off, whatever its days say', R.linkState({ ...row, revoked_at: new Date(t0) }, t0) === 'off' && R.linkState({ ...row, revoked_at: new Date(t0) }, t0 + 400 * DAY) === 'off');
ok('no row, or a date that cannot be read, never counts as on', R.linkState(null, t0) === 'off' && R.linkState({ expires_at: 'soon', revoked_at: null }, t0) === 'expired');
ok('a text date from the database is read the same', R.linkState({ expires_at: new Date(t0 + DAY).toISOString(), revoked_at: null }, t0) === 'on');

// ---- who may have a link
ok('someone in the family by name only may have one', R.mayHaveLink({ name: 'Dadi', user_id: null, remembered: false }) === null);
ok('SOMEONE REMEMBERED NEVER HAS A LINK', /remembered here, so no link is made/.test(R.mayHaveLink({ name: 'Dadaji', user_id: null, remembered: true })));
ok('remembered wins even if the row says they are on the app', /remembered/.test(R.mayHaveLink({ name: 'Dadaji', user_id: 'u', remembered: true })));
ok('someone on Parwah has the app, not a link', /on Parwah already/.test(R.mayHaveLink({ name: 'Meena', user_id: 'u' })) && /on Parwah already/.test(R.mayHaveLink({ name: 'Meena', on_app: true })));
ok('nobody at all is refused', typeof R.mayHaveLink(null) === 'string' && typeof R.mayHaveLink(undefined) === 'string');

// ---- what her page may show
const her = 'her', other = 'other';
ok('the page shows six kinds of thing and no more', R.ELD_SHOWS.join() === 'ashirwad,shukriya,card,photo,question,poll');
ok('and what it never shows is written down', ['chat history', 'health', 'documents', 'the register', 'costs', 'location', 'private albums'].every(x => R.ELD_NEVER.includes(x)));
ok('a blessing to her, or to everyone, is shown', R.mayShow('ashirwad', { kind: 'bless', from_member: other, to_member: her }, her) && R.mayShow('ashirwad', { kind: 'bless', from_member: other, to_member: null }, her));
ok('a blessing to someone else is not', !R.mayShow('ashirwad', { kind: 'bless', from_member: other, to_member: 'x' }, her));
ok('nor her own, nor a "How is your day?" (that is for someone on the app)', !R.mayShow('ashirwad', { kind: 'bless', from_member: her, to_member: null }, her) && !R.mayShow('ashirwad', { kind: 'howday', from_member: other, to_member: her }, her));
ok('a thank-you to her is shown; one to someone else is not, even one shown to the family', R.mayShow('shukriya', { to_member: her }, her) && !R.mayShow('shukriya', { to_member: other, audience: 'family' }, her));
ok('her card is shown on its day, with something in it', R.mayShow('card', { for_member: her, sealed: false, entries: 2 }, her) && R.mayShow('card', { for_member: 'x', for_member2: her, sealed: false, entries: 1 }, her));
ok('a card is a surprise until its day, and is never handed over empty', !R.mayShow('card', { for_member: her, sealed: true, entries: 2 }, her) && !R.mayShow('card', { for_member: her, sealed: false, entries: 0 }, her));
ok('someone else\'s card is not hers to open', !R.mayShow('card', { for_member: other, sealed: false, entries: 3 }, her));
ok('a photo from a WHOLE-FAMILY album is shown', R.mayShow('photo', { audience: 'family' }, her));
ok('A PRIVATE OR A CHOSEN ALBUM IS NEVER SHOWN, even one that names her', !R.mayShow('photo', { audience: 'me' }, her) && !R.mayShow('photo', { audience: 'chosen', chosen: [her] }, her) && !R.mayShow('photo', { audience: 'chosen', by_member: her }, her) && !R.mayShow('photo', {}, her));
ok('an open poll in the family chat is shown; a closed one, or one in a private chat, is not', R.mayShow('poll', { chat_kind: 'circle', closed: false }, her) && !R.mayShow('poll', { chat_kind: 'circle', closed: true }, her) && !R.mayShow('poll', { chat_kind: 'dm', closed: false }, her) && !R.mayShow('poll', { chat_kind: 'group', closed: false }, her));
ok('the weekly question is a family\'s, not a group of friends\'', R.mayShow('question', { circle_kind: 'family' }, her) && !R.mayShow('question', { circle_kind: 'group' }, her));
ok('anything else is never shown: chat, health, register, costs, location', ['chat', 'message', 'health', 'vault', 'register', 'expense', 'location', '', undefined].every(k => !R.mayShow(k, { to_member: her, audience: 'family', chat_kind: 'circle' }, her)));
ok('with no row or no person, nothing is shown', !R.mayShow('shukriya', null, her) && !R.mayShow('shukriya', { to_member: undefined }, undefined));

// ---- answering back
ok('a heart, a blessing back, a few words or a voice note', R.SAY_KINDS.join() === 'heart,pranam,text,voice');
ok('one tap is clean', JSON.stringify(R.sayClean({ kind: 'heart', about: { kind: 'shukriya', id: 'abc' } })) === JSON.stringify({ kind: 'heart', about: { kind: 'shukriya', id: 'abc' }, text: null }));
ok('"a few words" is tidied and cut at 240', R.sayClean({ kind: 'text', text: '  bahut   accha  ', about: { kind: 'card', id: 'x' } }).text === 'bahut accha' && R.sayClean({ kind: 'text', text: 'x'.repeat(900), about: { kind: 'card', id: 'x' } }).text.length === 240);
ok('empty words are refused, kindly', /Write a few words first/.test(R.sayClean({ kind: 'text', text: '   ', about: { kind: 'card', id: 'x' } }).error));
ok('an answer to something the page does not show is refused', !!R.sayClean({ kind: 'heart', about: { kind: 'message', id: 'x' } }).error && !!R.sayClean({ kind: 'heart', about: { kind: 'note', id: 'x' } }).error && !!R.sayClean({ kind: 'heart' }).error);
ok('an unknown kind of answer is refused', !!R.sayClean({ kind: 'html', about: { kind: 'card', id: 'x' } }).error && !!R.sayClean(null).error);
ok('text sent with a heart is not kept', R.sayClean({ kind: 'heart', text: 'ignored', about: { kind: 'card', id: 'x' } }).text === null);

// ---- the two people she can call
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
ok('up to two people, in the order chosen', R.contactsClean([A, B, C]).join() === [A, B].join() && R.ELD.contactsMax === 2);
ok('nobody twice, and only real ids', R.contactsClean([A, A, 'x', null, 7, B]).join() === [A, B].join() && R.contactsClean('nope').length === 0 && R.contactsClean(undefined).length === 0);

// ---- rate limits
const L = R.ELD_LIMITS;
ok('every limit is a count and a window', Object.values(L).every(v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n > 0)));
ok('making a link: 10 a day for one adult, 30 for a family', L.create.join() === '10,86400' && L.createFamily.join() === '30,86400');
ok('guessing keys: 30 tries in ten minutes from one address', L.wrong.join() === '30,600');
ok('"Call me": one in three hours, three in a day', L.callmeGap.join() === '1,10800' && L.callme.join() === '3,86400');
ok('everything a link does is counted, and answers, blessings, votes and voice notes on top', ['act', 'say', 'bless', 'vote', 'audio'].every(k => L[k]));
ok('"I need help" waits five seconds', R.ELD.sosCancelSecs === 5);

// ---- the WhatsApp link: always wa.me, digits only
ok('a number becomes digits only', R.waDigits('+91 98111-00001') === '919811100001' && R.waDigits('98111 00001') === '9811100001');
ok('a number that is not a number becomes nothing', R.waDigits('call me') === '' && R.waDigits('123') === '' && R.waDigits(null) === '' && R.waDigits('1'.repeat(16)) === '');
ok('the address is wa.me, the number, and the words', R.waLink('+919811100001', 'Namaste Dadi') === 'https://wa.me/919811100001?text=Namaste%20Dadi');
const evil = ['evil.example/x', '//evil.example', 'https://evil.example', '@evil.example', '919811100001@evil.example', '919811100001/../../evil', 'javascript:alert(1)', '9198\n1110\t0001#frag', '?text=x&phone=9', '%2F%2Fevil.example'];
ok('NO OPEN REDIRECT: whatever is put where the number goes, the link stays on wa.me', evil.every(p => { const u = new URL(R.waLink(p, 'hi')); return u.origin === 'https://wa.me' && /^\/\d{0,15}$/.test(u.pathname) && u.hash === '' && u.username === ''; }), evil.map(p => R.waLink(p, 'hi')).join(' '));
ok('the words cannot break out of the text either', (() => { const u = new URL(R.waLink('919811100001', 'x&phone=1#y https://evil.example')); return u.origin === 'https://wa.me' && [...u.searchParams.keys()].join() === 'text' && u.hash === ''; })());
ok('with no number it is still wa.me, and WhatsApp asks who to send to', R.waLink('', 'hi') === 'https://wa.me/?text=hi');
const words = R.inviteWords('Dadi Sharma', 'Rohan Sharma', 'https://x.test/apna/#k=K');
ok('the message is plain and warm, with the link at the end', /^Namaste Dadi, Rohan here\./.test(words) && /No password is needed\./.test(words) && words.endsWith('https://x.test/apna/#k=K'));

// ---- the words the family reads
ok('"from Dadi\'s link": first names only', R.linkLabel('Dadi Sharma') === "from Dadi's link" && R.linkLabel('') === "from Someone's link");
ok('the one feed line when a link is made', R.madeLine('Rohan Sharma', 'Dadi') === "Rohan set up Dadi's link: a page of their own that opens from WhatsApp, with no sign-in.");
ok('"I am fine" and "would like a call"', R.fineLine('Dadi') === 'Dadi said: I am fine' && R.callMeLine('Dadi') === 'Dadi would like a call');
ok('turned off by her: kind, with no blame', /Nothing is wrong: a phone call is welcome any time/.test(R.offLine('Dadi', 'self')) && R.offLine('Dadi', 'declined') === R.offLine('Dadi', 'self'));
ok('closed because she joined: what she sent stays hers', /is on Parwah now, so the link is closed\. What they sent stays theirs\./.test(R.offLine('Dadi', 'joined')));

// ---- consent, in both languages
ok('the first screen lists what the family can see, each line in Hindi and in English', R.CONSENT_SEES.length === 4 && R.CONSENT_SEES.every(s => /[ऀ-ॿ]/.test(s.hi) && /^[A-Z]/.test(s.en) && !/[ऀ-ॿ]/.test(s.en)));
ok('it says her place is seen only if she sends it', R.CONSENT_SEES.some(s => /only if you send it yourself/.test(s.en)));

// ---- copy rules, across everything this module says
const BANNED = /\b(elderly|burden\w*|cure[sd]?|treat\w*|heal\w*|therap\w+|remed\w+|medicinal|prevent\w*|reverse[sd]?|clinically proven|doctor[\s-]+recommended|pain relief|guaranteed|arthritis|diabet\w+)\b/i;
const said = [R.madeLine('A', 'B'), R.fineLine('A'), R.callMeLine('A'), R.offLine('A', 'self'), R.offLine('A', 'joined'), R.offLine('A', 'adult'), R.inviteWords('A', 'B', ''),
  R.mayHaveLink({ name: 'A', remembered: true }), R.mayHaveLink({ name: 'A', user_id: 'u' }), ...R.CONSENT_SEES.map(s => s.en), ...Object.values(R.SAY_WORDS)].join(' ');
ok('nothing here uses a banned word or a long dash', !BANNED.test(said) && !new RegExp('[' + String.fromCharCode(8211, 8212) + ']').test(said));
const src = readFileSync(new URL('../../api/_eldlinkrules.mjs', import.meta.url), 'utf8');
ok('the rules module imports nothing, so the gate can run this before npm install', !/^\s*import\s/m.test(src) && !/require\(/.test(src));

if (fails.length) { console.error(`eldlinktest: ${fails.length} FAILED of ${pass + fails.length}`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
console.log(`eldlinktest: ${pass}/${pass} checks pass`);
