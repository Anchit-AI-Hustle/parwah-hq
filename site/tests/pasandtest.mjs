// PASAND, THE RULES, with no database and nothing installed: what a like, a
// link and a recommendation may be, the password and sign-in refusal, and
// who may see whose likes. api/_pasandrules.mjs imports nothing.
import { readFile } from 'node:fs/promises';
import * as P from '../../api/_pasandrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

// ---- the lists
ok('nine kinds of like, in the order the screen shows them',
   P.PASAND_KINDS.map(k => k[0]).join() === 'shows,music,games,books,food,hobbies,sports,places,other');
ok('thirteen platforms, the fixed list',
   P.PASAND_PLATFORMS.map(p => p[1]).join() === 'Netflix,Prime Video,JioHotstar,SonyLIV,ZEE5,YouTube,Spotify,JioSaavn,Apple Music,Gaana,Audible,Kindle,Other');
ok('eight kinds of recommendation', P.PASAND_REC_KINDS.map(k => k[0]).join() === 'show,film,song,album,game,book,eat,other');
ok('four answers', P.PASAND_RESPONSES.map(k => k[0]).join() === 'saved,loved,done,pass' && P.responseLabel('saved') === 'Will try it' && P.responseLabel('done') === 'Seen it' && P.responseLabel('pass') === 'Not for me');
ok('a made-up kind, platform or answer is not on a list', !P.isLikeKind('secrets') && !P.isPlatform('hbo') && !P.isRecKind('password') && !P.isResponse('hated') && P.isPlatform('prime') && P.isLikeKind('food'));
ok('nothing inherited is on a list either', !P.isPlatform('constructor') && !P.isLikeKind('toString'));
ok('the caps are the ones in the brief', P.PASAND_MAX.like === 60 && P.PASAND_MAX.likes === 40 && P.PASAND_MAX.title === 80 && P.PASAND_MAX.note === 200 && P.PASAND_MAX.reply === 200 && P.PASAND_MAX.link === 300);

// ---- text
ok('a like is trimmed and its spaces tidied', P.cleanText('  Old   Hindi songs ', 60, 'A like').value === 'Old Hindi songs');
ok('exactly 60 letters is fine', P.cleanText('x'.repeat(60), 60, 'A like').value.length === 60);
const long = P.cleanText('x'.repeat(61), 60, 'A like');
ok('61 letters is refused with a reason, never cut', !long.value && /up to 60 letters/.test(long.error));
ok('empty comes back empty, for the caller to refuse', P.cleanText('   ', 60, 'A like').value === '');

// ---- passwords and sign-ins are refused, in every field
for (const t of ['Password is hunter2', 'my netflix password', 'netflix pwd hunter2', 'passcode 4821', 'Netflix login: rohan@example.com',
                 'username = rohan', 'user id: rohan77', 'rohan@example.com / hunter22', 'rohan@example.com:hunter22', 'my pin is 4821', 'OTP: 482913', 'sign in: rohan']) {
  ok('refused as a password or sign-in: ' + t, P.credRisk(t) === P.NO_PASSWORD, String(P.credRisk(t)));
  ok('and so through cleanText: ' + t, P.cleanText(t, 80, 'The name').error === P.NO_PASSWORD);
}
for (const t of ['Panchayat', 'Spin bowling', 'Pinterest boards', 'Passport to Pimlico', 'Singin in the Rain', 'Sholay, DDLJ', 'Old Hindi songs: Kishore, Rafi',
                 'The Login (film)', 'Chai at 5pm', 'rohan@example.com, ask him', 'Pin code 110001 chaat', '']) {
  ok('an ordinary like is kept: ' + t, P.credRisk(t) === null, String(P.credRisk(t)));
}
ok('the reason is plain and says what to do', /never keeps a password/.test(P.NO_PASSWORD) && !/[{}<>]/.test(P.NO_PASSWORD));

// ---- links
ok('no link is fine', P.linkError('') === null && P.linkError(null) === null && P.cleanLink('  ').value === null);
ok('a public https playlist is fine', P.linkError('https://open.spotify.com/playlist/37i9dQZF1DX0XUfTFmNBRM?si=abc') === null
   && P.cleanLink(' https://www.youtube.com/@rohan ').value === 'https://www.youtube.com/@rohan');
ok('http is refused', /start with https/.test(P.linkError('http://example.com/list')));
ok('a script or data link is refused', !!P.linkError('javascript:alert(1)') && !!P.linkError('data:text/html,hi') && !!P.linkError('ftp://example.com'));
ok('a bare word is refused', !!P.linkError('netflix') && !!P.linkError('www.netflix.com'));
ok('a link with a sign-in inside it is refused', P.linkError('https://rohan:hunter2@netflix.com/') === P.NO_PASSWORD && P.linkError('https://rohan@netflix.com/') === P.NO_PASSWORD);
ok('a link that carries a password is refused', P.linkError('https://example.com/?password=hunter2') === P.NO_PASSWORD && P.linkError('https://example.com/a?x=1&pwd=abc') === P.NO_PASSWORD);
ok('a link with a space or more text around it is refused', !!P.linkError('https://example.com/a b') && !!P.linkError('https://example.com my list'));
ok('a link with no real address is refused', !!P.linkError('https://localhost/x') && !!P.linkError('https://10.0.0.1/x'));
ok('300 letters is the limit', P.linkError('https://example.com/' + 'a'.repeat(280)) === null && /too long/.test(P.linkError('https://example.com/' + 'a'.repeat(281))));
ok('cleanLink never returns a changed bad link', P.cleanLink('http://example.com').value === undefined && !!P.cleanLink('http://example.com').error);

// ---- who may see whose likes
const A = 'a', B = 'b', C = 'c';
ok('no setting at all means the whole family', P.canSee(A, null, B) && P.canSee(A, undefined, C) && P.canSee(A, {}, B));
ok('family: everyone', P.canSee(A, { audience: 'family', chosen: [] }, B));
ok('chosen: the named member, and not the other', P.canSee(A, { audience: 'chosen', chosen: [B] }, B) && !P.canSee(A, { audience: 'chosen', chosen: [B] }, C));
ok('chosen with nobody named is nobody', !P.canSee(A, { audience: 'chosen', chosen: [] }, B) && !P.canSee(A, { audience: 'chosen' }, B));
ok('me: nobody else', !P.canSee(A, { audience: 'me', chosen: [B] }, B) && !P.canSee(A, { audience: 'me' }, C));
ok('the owner always sees their own', P.canSee(A, { audience: 'me' }, A) && P.canSee(A, { audience: 'chosen', chosen: [] }, A));
ok('an unknown setting falls back to family, the default', P.canSee(A, { audience: 'everyone-on-earth' }, B));
ok('nobody is nobody', !P.canSee(A, { audience: 'family' }, null) && !P.canSee(null, null, B));

// ---- the line on Today
ok('the Today line names who, what and where', P.recLine('Rohan', 'Panchayat', 'prime') === 'Rohan recommends Panchayat for you. On Prime Video.');
ok('with no platform it stops after "for you."', P.recLine('Rohan', 'Panchayat', null) === 'Rohan recommends Panchayat for you.' && P.recLine('Rohan', 'Panchayat', 'other') === 'Rohan recommends Panchayat for you.');

// ---- the handler uses these rules, and the app shows the same lists
const api = await readFile(new URL('../../api/_pasand.mjs', import.meta.url), 'utf8');
ok('the handler checks every text with the notes rule and the password rule', api.includes('noteRisk(v) || credRisk(v)') && api.includes("from './_pasandrules.mjs'"));
const app = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
for (const [k, name] of P.PASAND_PLATFORMS) ok('the app lists ' + name, app.includes("['" + k + "', '" + name + "']"));
for (const [k, , name] of P.PASAND_KINDS) ok('the app lists the kind ' + name, app.includes("['" + k + "', '") && app.includes("'" + name + "']"));
for (const [k, label] of P.PASAND_RESPONSES) ok('the app offers ' + label, app.includes("['" + k + "', '" + label + "']"));

if (fails.length) { console.error('pasandtest: ' + fails.length + ' FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('pasandtest: ' + pass + '/' + pass + ' checks pass');
