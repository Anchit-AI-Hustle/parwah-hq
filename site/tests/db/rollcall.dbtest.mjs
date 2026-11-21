// "SAB THEEK?" THE ROLL-CALL against a real database, through the real
// handler (/api/care?area=rollcall) and the real timer sweep, with the
// clock handed in.
//
//   1. An adult starts it; a child cannot; an outsider cannot. Everyone
//      with us is pushed, as a safety push. Nobody who has passed away is
//      pushed or listed.
//   2. One open roll-call a family; three in 24 hours.
//   3. "I am safe"; "I need help" raises that person's own SOS.
//   4. An adult ticks for Dadi, who is not on Parwah: "Rohan says Dadi is
//      safe". A child cannot tick for anyone. A person's own answer wins.
//   5. A child is not shown that someone needs help.
//   6. One reminder after half an hour, to those who have not answered.
//   7. It closes itself after 24 hours; an adult can close it sooner.
//   8. Another family reads none of it.
import { kit } from './jkit.mjs';
const k = await kit('rollcall.dbtest', ['care', 'events']);
const { ok, call, user, family, seat, pushed, pushedTo, admin, sql, api } = k;
const RC = await import('../../../api/_rollcall.mjs');
const R = await import('../../../api/_rollcallrules.mjs');
const { runTick } = await import('../../../api/events.mjs');
await RC.ensureRollcallSchema(sql);
// The SOS tables, as /api/events makes them on its first use.
await call(api.events, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });

const fam = await family('SHARMA24', 'Sharma Family'), other = await family('VERMA024', 'Verma Family');
const U = {}; for (const nm of ['Rohan', 'Meena', 'Papa', 'Kabir', 'Vikram']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' }), meena = await seat(fam, U.Meena, { dob: '1990-07-09' });
const papa = await seat(fam, U.Papa, { role: 'parent', dob: '1958-01-20' }), kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });
const dadi = await seat(fam, { name: 'Dadi' }, { role: 'parent', dob: '1936-02-02', phone: '+911122334455' });
const dadaji = await seat(fam, { name: 'Dadaji' }, { role: 'parent', dob: '1930-01-01' });
await admin.query(`update members set remembered = true where id = $1`, [dadaji.id]);
const vikram = await seat(other, U.Vikram, { dob: '1980-01-01' });
const outsider = { id: vikram.id, token: vikram.token, code: 'SHARMA24' };
const posing = { id: meena.id, token: vikram.token, code: 'SHARMA24' };

let now = Date.parse('2026-11-20T06:00:00Z');
RC.rollcallSeams.now = () => now;
const P = (who, action, body = {}) => call(api.care, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const G = (who) => call(api.care, { method: 'GET', token: who.token, query: { area: 'rollcall', circle: who.code, member: who.id } });
const names = list => list.map(x => x.name).sort().join(',');

// ---------------------------------------------------------------- 1. start
let r = await G(rohan);
ok('1. nothing open at first, and an adult may start one', r.ok && r.open === null && r.canStart === true && r.me.adult === true);
r = await G(kabir);
ok('1. a child is not offered the start', r.ok && r.canStart === false && r.me.adult === false);
r = await P(kabir, 'rollcall_start', { reason: 'flood' });
ok('1. a child cannot start a roll-call', r.status === 403 && /adult/i.test(r.error));
r = await P(outsider, 'rollcall_start', { reason: 'flood' });
ok('1. someone from another family cannot start one here', r.status === 403);
r = await P(posing, 'rollcall_start', { reason: 'flood' });
ok('1. nor by sending a member id that is not theirs', r.status === 403);
r = await G(outsider);
ok('1. and cannot read this family\'s roll-call', r.status === 403 && !r.open);

r = await P(rohan, 'rollcall_start', { reason: 'flood', note: 'my OTP is 482910' });
ok('1. a note with an OTP or a card number is refused, and nothing starts', r.status === 400 && /never keeps/.test(r.error) && !(await G(rohan)).open
  && (await P(rohan, 'rollcall_start', { reason: 'flood', note: 'card 4111 1111 1111 1111' })).status === 400, JSON.stringify(r));
let mark = pushed.length;
r = await P(rohan, 'rollcall_start', { reason: 'flood', note: 'Water on the road in Lucknow' });
ok('1. an adult starts it', r.status === 201 && r.open && r.open.reasonWords === 'Heavy rain or flood' && r.open.mine === 'safe', JSON.stringify(r).slice(0, 200));
const rcId = r.open.id;
const told = pushedTo(mark, /Sab theek\?/);
ok('1. every member with us is pushed, the child too, and not the one who asked', told.sort().join() === [meena.id, papa.id, kabir.id].sort().join(), told.join());
ok('1. the push is a safety push: it says who asks and what to tap', /Rohan is asking everyone/.test(pushed[mark].body.title) && /I am safe/.test(pushed[mark].body.body) && pushed[mark].body.url === '/#home?rollcall=1');
ok('1. nobody who has passed away is pushed', told.indexOf(dadaji.id) < 0);
ok('1. the board lists everyone with us, Dadi by name too, and never Dadaji',
  names(r.open.board.waiting) === 'Dadi,Kabir,Meena,Papa' && names(r.open.board.safe) === 'Rohan' && !JSON.stringify(r.open.board).includes('Dadaji'));
ok('1. Dadi is marked as not on Parwah, with a number to call', r.open.board.waiting.find(x => x.name === 'Dadi').onApp === false && r.open.board.waiting.find(x => x.name === 'Dadi').phone === '+911122334455');
ok('1. the feed says who asked', !!(await k.q1(`select 1 as x from events where circle_id = $1 and text like '%asked everyone: Sab theek?%'`, [fam.id])));
// It gets through a quiet night: a safety push is never held.
const { pushKind } = await import('../../../api/_pushrules.mjs');
ok('1. each roll-call push is a safety kind', [R.rollcallAskPush('A', 'flood'), R.rollcallRemindPush('A'), R.rollcallHelpPush('A'), R.rollcallDonePush()].every(p => pushKind(p).through === true));

// ------------------------------------------------------------- 2. one open
r = await P(meena, 'rollcall_start', { reason: 'outage' });
ok('2. a second one cannot open while the first is open', r.status === 409 && /already open/.test(r.error));
ok('2. the database itself holds one open roll-call a family', await admin.query(`insert into rollcalls (circle_id, closes_at) values ($1, now() + interval '1 day')`, [fam.id]).then(() => false, e => e.code === '23505'));

// -------------------------------------------------------------- 3. answers
r = await P(meena, 'rollcall_answer', { answer: 'maybe' });
ok('3. only the two answers are taken', r.status === 400);
r = await P(meena, 'rollcall_answer', { answer: 'safe' });
ok('3. "I am safe" is saved and shown', r.ok && r.open.mine === 'safe' && names(r.open.board.safe) === 'Meena,Rohan' && r.sos === null);
mark = pushed.length;
r = await P(papa, 'rollcall_answer', { answer: 'help', lat: 26.85, lng: 80.95 });
ok('3. "I need help" raises Papa\'s own SOS', r.ok && r.sos && r.sos.raised === true && !!r.sos.sosId, JSON.stringify(r.sos));
const sos = await k.q1(`select status, member_id from sos where circle_id = $1`, [fam.id]);
ok('3. the SOS is a real one, open, in his name', !!sos && sos.member_id === papa.id && sos.status !== 'resolved');
ok('3. the family hears the SOS itself', pushed.slice(mark).some(p => /^🆘 SOS from Papa/.test(p.body.title) && p.body.urgent === true));
r = await G(rohan);
ok('3. an adult sees who needs help', names(r.open.board.help) === 'Papa' && r.open.board.help[0].line === 'Papa needs help');
mark = pushed.length;
r = await P(papa, 'rollcall_answer', { answer: 'help' });
ok('3. tapping it again does not raise it twice', r.ok && r.sos === null && !pushed.slice(mark).some(p => /SOS from/.test(p.body.title)));

// ------------------------------------------------------------ 4. on behalf
r = await P(kabir, 'rollcall_answer', { answer: 'safe', forId: dadi.id });
ok('4. a child cannot tick for someone else', r.status === 403);
r = await P(rohan, 'rollcall_answer', { answer: 'safe', forId: dadaji.id });
ok('4. nobody is ticked who has passed away', r.status === 404);
r = await P(rohan, 'rollcall_answer', { answer: 'safe', forId: vikram.id });
ok('4. nor someone from another family', r.status === 404);
r = await P(rohan, 'rollcall_answer', { answer: 'safe', forId: dadi.id });
const dRow = r.open.board.safe.find(x => x.name === 'Dadi');
ok('4. an adult ticks for Dadi: "Rohan says Dadi is safe"', r.ok && !!dRow && dRow.line === 'Rohan says Dadi is safe' && dRow.byName === 'Rohan');
r = await P(rohan, 'rollcall_answer', { answer: 'safe', forId: meena.id });
ok('4. a person\'s own answer is never replaced by someone else\'s tick', r.status === 409 && /already answered/.test(r.error));
r = await P(meena, 'rollcall_answer', { answer: 'safe', forId: kabir.id });
ok('4. an adult may tick for a child whose phone is off', r.ok && r.open.board.safe.find(x => x.name === 'Kabir').line === 'Meena says Kabir is safe');
r = await P(kabir, 'rollcall_answer', { answer: 'safe' });
ok('4. and the child\'s own tap then takes its place', r.ok && r.open.board.safe.find(x => x.name === 'Kabir').line === 'Kabir is safe');

// ----------------------------------------------------- 5. a child's board
r = await G(kabir);
ok('5. a child is not shown that Papa needs help: he reads as waiting', r.open.board.help.length === 0 && names(r.open.board.waiting) === 'Papa' && !JSON.stringify(r.open.board).includes('needs help'));
ok('5. a child cannot close the roll-call', (await P(kabir, 'rollcall_close')).status === 403 && r.open.canClose === false);
// The family feed is read by the child too: it must not say what the board hides.
r = await P(rohan, 'rollcall_answer', { answer: 'help', forId: dadi.id });
ok('5. (Rohan ticks "needs help" for Dadi; an adult sees it on the board)', r.ok && r.open.board.help.some(x => x.name === 'Dadi'));
const feedLines = (await admin.query(`select text from events where circle_id = $1 and type = 'care'`, [fam.id])).rows.map(x => x.text);
ok('5. THE FEED DOES NOT TELL A CHILD WHO NEEDS HELP: it says only that an answer came', !feedLines.some(t => /needs help/i.test(t))
  && feedLines.includes('🛟 Rohan answered the roll-call for Dadi') && feedLines.includes('🛟 Papa answered the roll-call'), JSON.stringify(feedLines));
ok('5. and the child\'s board still hides it', (await G(kabir)).open.board.help.length === 0);
r = await P(rohan, 'rollcall_answer', { answer: 'safe', forId: dadi.id });
ok('5. (Dadi is ticked safe again)', r.ok && r.open.board.safe.some(x => x.name === 'Dadi'));

// ------------------------------------------------------------ 6. reminder
// A second family with its own roll-call, to prove the sweep keeps them apart.
await seat(other, { name: 'Nani' });
await P(vikram, 'rollcall_start', { reason: 'outage' });
mark = pushed.length;
now += 10 * 60000;
await RC.sweepRollcallAll(sql, now);
ok('6. nothing is sent again before half an hour', pushed.length === mark);
now += 25 * 60000;
await RC.sweepRollcallAll(sql, now);
ok('6. after half an hour nobody on Parwah is left unanswered here, so nobody is asked again', pushedTo(mark, /still waiting/).length === 0, pushedTo(mark).join());
// Start afresh with people who have not answered.
await P(rohan, 'rollcall_close');
r = await P(rohan, 'rollcall_start', { reason: 'quake' });
ok('6. after closing, a new one opens', r.status === 201 && r.open.id !== rcId);
mark = pushed.length; now += 31 * 60000;
await RC.sweepRollcallAll(sql, now);
const again = pushedTo(mark, /still waiting to hear from you/);
ok('6. the reminder goes once, only to those on Parwah who have not answered', again.sort().join() === [meena.id, papa.id, kabir.id].sort().join(), again.join());
mark = pushed.length; now += 60 * 60000;
await RC.sweepRollcallAll(sql, now); await runTick(sql);
ok('6. and never a second time', pushedTo(mark, /still waiting/).length === 0);

// -------------------------------------------------------------- 7. closing
mark = pushed.length;
for (const who of [meena, papa, kabir]) await P(who, 'rollcall_answer', { answer: 'safe' });
r = await P(meena, 'rollcall_answer', { answer: 'safe', forId: dadi.id });
ok('7. when the last person is accounted for, whoever asked is told once', r.open.board.everyone === true && pushedTo(mark, /everyone has answered/).join() === rohan.id);
now += 24 * 3600000;
r = await G(meena);
ok('7. past 24 hours a read shows it closed, before any timer runs', r.ok && r.open === null && r.last && r.last.byName === 'Rohan');
r = await P(meena, 'rollcall_answer', { answer: 'safe' });
ok('7. and nobody can answer a closed one', r.status === 409);
// The timer closes the other family's on its own.
await RC.sweepRollcallAll(sql, now);
const left = (await admin.query(`select count(*)::int as n from rollcalls where closed_at is null`)).rows[0].n;
ok('7. the timer closes every roll-call past its 24 hours', left === 0);
ok('7. the timer line is in runTick once, as an imported function', (await import('fs')).readFileSync(new URL('../../../api/events.mjs', import.meta.url), 'utf8').split('await one(() => sweepRollcallAll(sql));').length === 2);

// --------------------------------------------------------- 2. three a day
r = await P(meena, 'rollcall_start', { reason: 'other' });
ok('2. a new day, a new roll-call', r.status === 201);
await P(meena, 'rollcall_close'); now += 60000;
ok('2. a second today', (await P(papa, 'rollcall_start', {})).status === 201);
await P(papa, 'rollcall_close'); now += 60000;
ok('2. a third today', (await P(rohan, 'rollcall_start', {})).status === 201);
await P(rohan, 'rollcall_close'); now += 60000;
r = await P(meena, 'rollcall_start', {});
ok('2. the fourth in 24 hours is refused, kindly', r.status === 429 && /3 times today/.test(r.error) && (await G(meena)).canStart === false);
now += 24 * 3600000;
ok('2. and allowed again a day later', (await P(meena, 'rollcall_start', {})).status === 201);

// ------------------------------------------------------------ 8. families
r = await G(vikram);
ok('8. the other family sees only its own', r.ok && r.open === null && !JSON.stringify(r).includes('Rohan') && !JSON.stringify(r).includes('Meena'));

await k.finish();
