// "SAB THEEK?" THE ROLL-CALL, END TO END: a real browser, the real API and a
// real PostgreSQL. Rohan starts a roll-call from the Family tab; Meena's
// phone shows two big buttons on whatever screen she is on; Papa needs
// help and his SOS goes; Rohan ticks for Dadi, who is not on Parwah; a
// child sees no "needs help"; Rohan closes it.
//
// Every new surface is measured: 44px targets, a 12px floor, AA contrast in
// light and dark, nothing sideways at 320, 390 or 1280. Nothing here waits
// a fixed time: each step waits for the element or the state it checks.
import { kit, browserKit } from './jkit.mjs';
const k = await kit('rollcall.e2e', ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games', 'ekta']);
const { ok, user, family, seat, admin } = k;
const B = await browserKit('rollcall.e2e', k);
const { phone, sees, gone, shown, design, wide, toastSays, confirmSheet, T } = B;

const fam = await family('SHARMA24', 'Sharma Family');
const U = {}; for (const nm of ['Rohan', 'Meena', 'Papa', 'Kabir']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' }), meena = await seat(fam, U.Meena, { dob: '1990-07-09' });
const papa = await seat(fam, U.Papa, { role: 'parent', dob: '1958-01-20' }), kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });
await seat(fam, { name: 'Dadi' }, { role: 'parent', dob: '1936-02-02', phone: '+911122334455' });
const dadaji = await seat(fam, { name: 'Dadaji' }, { role: 'parent', dob: '1930-01-01' });
await admin.query(`update members set remembered = true where id = $1`, [dadaji.id]);

// ---- Rohan, on the Family tab
const R = await phone(rohan, { hash: '#people' });
ok('family tab: the roll-call card is there, with a plain line of what it is for', await shown(R, '#kd-rc-card') && await sees(R, '#kd-rc-hint', /ask the whole family at once/));
ok('family tab: an adult is offered "Ask everyone now"', await shown(R, '#kd-rc-start') && await R.locator('#kd-rc-reason option').count() === 5);
ok('no banner while nothing is open', await R.isHidden('#kd-rc-banner'));
await design(R, '#kd-rc-card', 'the roll-call card before a roll-call');

// ---- Meena is on another screen entirely; Kabir, a child, on his Family tab
const M = await phone(meena, { hash: '#care' });
const K = await phone(kabir, { hash: '#people' });
await shown(K, '#kd-rc-card');
ok('a child is not offered the start, and is told an adult starts it', await K.isHidden('#kd-rc-startbox') && await sees(K, '#kd-rc-last', /An adult in the family starts a roll-call/));

await R.selectOption('#kd-rc-reason', 'flood');
await R.fill('#kd-rc-note', 'Water on the road');
await R.click('#kd-rc-start');
await confirmSheet(R);
ok('start: Rohan is told everyone has been asked', await toastSays(R, /Everyone has been asked/));
ok('start: the board shows who has not answered, Dadi too, and never Dadaji',
  await sees(R, '#kd-rc-board', /Not answered yet/) && await sees(R, '#kd-rc-board', /Dadi/) && await sees(R, '#kd-rc-board', /Not on Parwah\. Call, then tick for them\./)
  && !(await R.textContent('#kd-rc-board')).includes('Dadaji'));
ok('start: Dadi has a Call button with her number', await R.locator('#kd-rc-board a[href^="tel:"]', { hasText: 'Call Dadi' }).count() === 1);
ok('start: Rohan counts as safe, and his own banner is the slim one', await sees(R, '#kd-rc-board', /✓ Rohan is safe/) && await sees(R, '#kd-rc-banner', /Roll-call is open\. You said: ✓ I am safe/));
await design(R, '#kd-rc-card', 'the open roll-call board');
await design(R, '#kd-rc-banner', 'the roll-call banner after answering');
await wide(R, 'the roll-call board');

// ---- Meena: two big buttons on the screen she is already on
await M.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
ok('answer: the banner reaches Meena on another tab, with who asks and why', await shown(M, '#kd-rc-safe') && await sees(M, '#kd-rc-banner', /Rohan is asking everyone/) && await sees(M, '#kd-rc-banner', /Heavy rain or flood: Water on the road/));
ok('answer: two buttons, each a word with its mark', (await M.textContent('#kd-rc-safe')).trim() === '✓ I am safe' && (await M.textContent('#kd-rc-help')).trim() === '! I need help');
await design(M, '#kd-rc-banner', 'the roll-call banner with its two buttons');
await wide(M, 'the roll-call banner');
await M.click('#kd-rc-safe');
ok('answer: one tap, and Meena is told the family can see it', await toastSays(M, /The family can see you are safe/) && await sees(M, '#kd-rc-banner', /You said: ✓ I am safe/));

// ---- Papa needs help: his own SOS goes
const P = await phone(papa, { hash: '#home' });
await shown(P, '#kd-rc-help');
await P.click('#kd-rc-help');
ok('help: Papa is asked once, in plain words, before it is sent', await shown(P, '#asksheet') && await sees(P, '#as-q', /Tell the family you need help\?/));
await P.click('#as-yes');
ok('help: Papa is told the family has been alerted', await toastSays(P, /Your family has been alerted/));
const sos = await k.q1(`select count(*)::int as n from sos where circle_id = $1 and member_id = $2 and status <> 'resolved'`, [fam.id, papa.id]);
ok('help: a real SOS is open in his name', sos.n === 1);
ok('help: his banner offers "I am safe now"', await sees(P, '#kd-rc-banner', /I am safe now/));

// ---- Rohan sees it, calls, and ticks for Dadi
await R.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
ok('board: Rohan sees that Papa needs help, with a Call button', await sees(R, '#kd-rc-board', /! Papa needs help/) && await R.locator('#kd-rc-board .kd-bad a[href^="tel:"]').count() === 1);
await R.click('#kd-rc-board button[data-name="Dadi"]');
ok('board: ticking for Dadi asks first, and says how it will read', await shown(R, '#asksheet') && await sees(R, '#as-sub', /Rohan says Dadi is safe/));
await R.click('#as-yes');
ok('board: "Rohan says Dadi is safe"', await sees(R, '#kd-rc-board', /✓ Rohan says Dadi is safe/));
await design(R, '#kd-rc-card', 'the board with help, waiting and safe');

// ---- the child: his own two buttons, and no "needs help" about anyone
await K.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
ok('child: Kabir has the two buttons too', await shown(K, '#kd-rc-safe'));
ok('child: he is not shown that Papa needs help; Papa reads as not answered', await sees(K, '#kd-rc-board', /Not answered yet/) && !(await K.textContent('#kd-rc-board')).includes('needs help'));
ok('child: no "Mark safe" for others and no close button', await K.locator('#kd-rc-board button[data-kdrcfor]').count() === 0 && await K.isHidden('#kd-rc-close'));
await K.click('#kd-rc-safe');
ok('child: his tap is saved', await sees(K, '#kd-rc-banner', /You said: ✓ I am safe/));

// ---- closing
await R.click('#kd-rc-close');
await confirmSheet(R);
ok('close: the banner goes and the start comes back', await gone(R, '#kd-rc-banner') && await shown(R, '#kd-rc-start') && await sees(R, '#kd-rc-last', /The last roll-call \(Heavy rain or flood, asked by Rohan\) closed at/));
await M.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
ok('close: Meena\'s banner goes too', await gone(M, '#kd-rc-banner'));

await B.finish();
