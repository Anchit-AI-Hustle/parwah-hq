// THE REMAINING FAMILY NEEDS, the rules only. Every module here imports
// nothing but other rule files, so this runs in the deploy gate before npm
// install.
//
// 1. "Sab theek?" the roll-call: who may start, the state of one, who may
//    answer for whom, the board a child sees.
// 2. A child's page: how a viewer stands to a child, what each relation
//    reads and writes, fees, the late pick-up, the words.
// 3. Carer load: the fairness line (its thresholds, and that it never holds
//    a number or a word that shames), my own week, a day off.
// 4. The function kit: hosts, a guest with no phone, never a guest who has
//    passed away, the counts, the guest sheet.
// 5. Home upkeep: who sees an entry, what may be saved, the reminder stages.
// 6. The blood group lookup: a group as people write it, and the consent.
// 7. The doctor-ready summary: who may open it, and what it is built from.
import * as RC from '../../api/_rollcallrules.mjs';
import * as K from '../../api/_kidsrules.mjs';
import * as CL from '../../api/_carerloadrules.mjs';
import * as EK from '../../api/_eventkitrules.mjs';
import * as N from '../../api/_needsrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };
const BANNED = /\b(elderly|burden|cure|treat|heal|therapy|remedy|medicinal|prevents|reverses|clinically proven|doctor recommended|pain relief|guaranteed|arthritis|diabetes)\b/i;
const DASH = new RegExp('[' + String.fromCharCode(8211, 8212) + ']');
const words = [];

// ---------------------------------------------------------- 1. roll-call
{
  const t0 = Date.parse('2026-11-20T06:00:00Z');
  const rc = { closes_at: RC.rollcallClosesAt(t0), closed_at: null };
  ok('a roll-call lasts 24 hours', RC.ROLLCALL_HOURS === 24 && rc.closes_at.getTime() - t0 === 86400000);
  ok('open one second before the 24 hours are up', RC.rollcallIsOpen(rc, t0 + 86400000 - 1000));
  ok('closed at the 24 hours, before any timer writes it', !RC.rollcallIsOpen(rc, t0 + 86400000));
  ok('closed once it is closed by hand', !RC.rollcallIsOpen({ ...rc, closed_at: new Date(t0 + 5) }, t0 + 10));
  ok('nothing is not open', !RC.rollcallIsOpen(null, t0));
  ok('an adult may start one', RC.rollcallMayStart({ adult: true, hasOpen: false, startedToday: 0 }).ok);
  ok('a child may not, and is pointed to SOS', RC.rollcallMayStart({ adult: false, hasOpen: false, startedToday: 0 }).status === 403 && /SOS/.test(RC.rollcallMayStart({ adult: false }).error));
  ok('one open roll-call a family', RC.rollcallMayStart({ adult: true, hasOpen: true, startedToday: 1 }).status === 409);
  ok('three a day: the third is allowed', RC.ROLLCALL_PER_DAY === 3 && RC.rollcallMayStart({ adult: true, hasOpen: false, startedToday: 2 }).ok);
  ok('the fourth is refused', RC.rollcallMayStart({ adult: true, hasOpen: false, startedToday: 3 }).status === 429);
  const dadi = { id: 'd', name: 'Dadi', remembered: false }, gone = { id: 'g', name: 'Dadaji', remembered: true };
  ok('everyone answers for themself, a child too', RC.rollcallMayAnswerFor({ meId: 'k', meAdult: false, target: { id: 'k', name: 'Kabir' } }).self === true);
  ok('an adult ticks for someone else', RC.rollcallMayAnswerFor({ meId: 'r', meAdult: true, target: dadi }).ok === true);
  ok('a child does not', RC.rollcallMayAnswerFor({ meId: 'k', meAdult: false, target: dadi }).status === 403);
  ok('nobody is ticked who has passed away', RC.rollcallMayAnswerFor({ meId: 'r', meAdult: true, target: gone }).status === 404);
  ok('a person\'s own answer is not replaced', RC.rollcallMayAnswerFor({ meId: 'r', meAdult: true, target: dadi, existing: { by_member: 'd' } }).status === 409);
  ok('a tick someone else made can be made again', RC.rollcallMayAnswerFor({ meId: 'r', meAdult: true, target: dadi, existing: { by_member: 'm' } }).ok === true);
  const members = [{ id: 'r', name: 'Rohan', on_app: true }, { id: 'p', name: 'Papa', on_app: true }, dadi, gone, { id: 'k', name: 'Kabir', on_app: true }];
  const answers = [{ member_id: 'r', answer: 'safe', by_member: 'r' }, { member_id: 'p', answer: 'help', by_member: 'p' }, { member_id: 'd', answer: 'safe', by_member: 'r', by_name: 'Rohan Sharma' }];
  const b = RC.rollcallBoard(members, answers, { viewerId: 'r' });
  ok('the board: safe, help and waiting', b.safe.length === 2 && b.help.length === 1 && b.waiting.length === 1 && b.waiting[0].name === 'Kabir' && b.everyone === false);
  ok('someone who has passed away is never on it', !JSON.stringify(b).includes('Dadaji'));
  ok('"Rohan says Dadi is safe"', b.safe.find(x => x.id === 'd').line === 'Rohan says Dadi is safe');
  ok('"Papa needs help"', b.help[0].line === 'Papa needs help');
  const kb = RC.rollcallBoard(members, answers, { viewerId: 'k', viewerMinor: true });
  ok('a child is not shown that someone needs help', kb.help.length === 0 && kb.waiting.map(x => x.name).sort().join() === 'Kabir,Papa');
  const kb2 = RC.rollcallBoard(members, [{ member_id: 'k', answer: 'help', by_member: 'k' }], { viewerId: 'k', viewerMinor: true });
  ok('but a child sees their own answer', kb2.help.length === 1);
  ok('everyone accounted for', RC.rollcallBoard([dadi], [{ member_id: 'd', answer: 'safe', by_member: 'r' }]).everyone === true);
  const pushes = [RC.rollcallAskPush('Rohan Sharma', 'flood', 'Water on the road'), RC.rollcallRemindPush('Rohan'), RC.rollcallHelpPush('Papa', 'Meena'), RC.rollcallDonePush()];
  ok('every roll-call push names itself a safety push', pushes.every(p => p.kind === 'safety' && p.url === '/#home?rollcall=1'));
  ok('the ask says who, why and what to tap', /Rohan is asking everyone/.test(pushes[0].title) && /Heavy rain or flood: Water on the road/.test(pushes[0].body) && /I am safe/.test(pushes[0].body));
  ok('an unknown reason reads as "Something else"', RC.rollcallReason('nonsense') === 'Something else');
  pushes.forEach(p => words.push(p.title, p.body));
  RC.ROLLCALL_REASONS.forEach(r => words.push(r[1]));
  for (const a of [{ adult: false }, { adult: true, hasOpen: true }, { adult: true, startedToday: 3 }]) words.push(RC.rollcallMayStart(a).error);
}

// ------------------------------------------------------- 2. a child's page
{
  const child = { id: 'c' };
  const papa = { id: 'p', on_app: true, minor: false }, maa = { id: 'm', on_app: true, minor: false };
  const parents = [{ id: 'p', on_app: true }, { id: 'm', on_app: true }];
  const rel = (viewer, o = {}) => K.kidRelation({ viewer, child, parents, startedBy: null, ...o });
  ok('the child is "self"', rel({ id: 'c', on_app: true, minor: true }) === 'self');
  ok('a parent by the tree is "parent"', rel(papa) === 'parent' && rel(maa) === 'parent');
  ok('another adult is "adult"', rel({ id: 'x', on_app: true, minor: false }) === 'adult');
  ok('a cousin under 18 is "minor"', rel({ id: 'y', on_app: true, minor: true }) === 'minor');
  ok('someone not on Parwah is "none"', rel({ id: 'z', on_app: false, minor: false }) === 'none');
  ok('someone who has passed away is "none"', rel({ id: 'z', on_app: true, remembered: true }) === 'none');
  ok('whoever started the page is NOT a parent while a parent is on Parwah', rel({ id: 'x', on_app: true, minor: false }, { startedBy: 'x' }) === 'adult');
  ok('with no parent on Parwah, the adult who started it keeps it', K.kidRelation({ viewer: { id: 'x', on_app: true, minor: false }, child, parents: [{ id: 'b', on_app: false }], startedBy: 'x' }) === 'parent');
  ok('and nobody else does', K.kidRelation({ viewer: { id: 'w', on_app: true, minor: false }, child, parents: [], startedBy: 'x' }) === 'adult');
  ok('a child who started nothing is never a parent', K.kidRelation({ viewer: { id: 'y', on_app: true, minor: true }, child, parents: [], startedBy: 'y' }) === 'minor');

  const all = { school: 'family', fees: 'family', exams: 'family', pickup: 'family', vaccines: 'family', health: 'family', activities: 'family' };
  for (const s of K.KID_SECTIONS) ok('a parent reads ' + s, K.kidMaySee('parent', s, {}) === true);
  for (const s of K.KID_SECTIONS) ok('"none" reads no ' + s, K.kidMaySee('none', s, { share: all }) === false);
  ok('the child reads school, exams, pick-up and classes', ['school', 'exams', 'pickup', 'activities'].every(s => K.kidMaySee('self', s, {})));
  ok('the child never reads fees, vaccinations or health, whatever is shared', ['fees', 'vaccines', 'health'].every(s => !K.kidMaySee('self', s, { share: all })));
  ok('another adult reads nothing by default', K.KID_SECTIONS.every(s => !K.kidMaySee('adult', s, {})));
  ok('another adult reads what a parent marked "Whole family"', K.KID_SECTIONS.every(s => K.kidMaySee('adult', s, { share: all })));
  ok('one section shared shares only that one', K.kidMaySee('adult', 'school', { share: { school: 'family' } }) && !K.kidMaySee('adult', 'fees', { share: { school: 'family' } }));
  ok('a cousin under 18 reads the shared school parts', ['school', 'exams', 'pickup', 'activities'].every(s => K.kidMaySee('minor', s, { share: all })));
  ok('a cousin under 18 never reads fees, vaccinations or health', ['fees', 'vaccines', 'health'].every(s => !K.kidMaySee('minor', s, { share: all })));
  ok('exam results: parents and the child by default', K.kidMaySee('parent', 'result') && K.kidMaySee('self', 'result') && !K.kidMaySee('adult', 'result', { share: all }) && !K.kidMaySee('minor', 'result', { share: all }));
  ok('exam results: the wider family only when the child chose so', K.kidMaySee('adult', 'result', { resultsShare: 'family' }) && K.kidMaySee('minor', 'result', { resultsShare: 'family' }));
  ok('a child\'s note is for the parents unless marked for the family', !K.kidMaySee('adult', 'note', {}) && K.kidMaySee('adult', 'note', { noteShare: 'family' }) && K.kidMaySee('parent', 'note', {}));
  ok('the child chooses who sees results when on Parwah', K.kidResultsChooser('self', true) && !K.kidResultsChooser('parent', true));
  ok('a parent chooses for a child who is not on Parwah', K.kidResultsChooser('parent', false) && !K.kidResultsChooser('adult', false));
  ok('a parent writes anything', K.KID_ITEM_KINDS.every(kind => K.kidMayWrite('parent', kind)));
  ok('the child writes their own exam dates and notes only', K.kidMayWrite('self', 'exam') && K.kidMayWrite('self', 'note') && !K.kidMayWrite('self', 'fee') && !K.kidMayWrite('self', 'vaccine') && !K.kidMayWrite('self', 'activity'));
  ok('the child does not change a parent\'s entry', !K.kidMayWrite('self', 'exam', { mine: false }));
  ok('nobody else writes', !K.kidMayWrite('adult', 'note') && !K.kidMayWrite('minor', 'note') && !K.kidMayWrite('none', 'exam'));
  ok('a parent starts the page', K.kidMayStart('parent', true).ok);
  ok('another adult starts it only when no parent is on Parwah', K.kidMayStart('adult', false).ok && K.kidMayStart('adult', true).status === 403);
  ok('a child never starts one', K.kidMayStart('self', false).status === 403 && K.kidMayStart('minor', false).status === 403);

  ok('fees: a week before and the day before', K.feeStage(7) === 7 && K.feeStage(2) === 7 && K.feeStage(1) === 1 && K.feeStage(0) === 1);
  ok('fees: nothing earlier, nothing after', K.feeStage(8) === null && K.feeStage(-1) === null);
  const exp = Date.parse('2026-11-20T09:00:00Z');
  ok('pick-up: not late at 19 minutes', !K.pickupLate({ expect_at: new Date(exp) }, exp + 19 * 60000));
  ok('pick-up: late at 20 minutes', K.PICKUP_GRACE_MIN === 20 && K.pickupLate({ expect_at: new Date(exp) }, exp + 20 * 60000));
  ok('pick-up: never late once picked up, or once told', !K.pickupLate({ expect_at: new Date(exp), picked_at: new Date() }, exp + 3600000) && !K.pickupLate({ expect_at: new Date(exp), alerted_at: new Date() }, exp + 3600000));
  const late = K.pickupLatePush('Aarav Sharma', 'Nani', '2:30 pm');
  ok('a late pick-up is a safety push that blames nobody', late.kind === 'safety' && /Aarav is not marked as picked up yet/.test(late.title) && !/forgot|missed|failed|careless/i.test(late.title + late.body));
  ok('"Nani has picked up Aarav (marked by Meena)"', /Nani has picked up Aarav \(marked by Meena\)/.test(K.pickupDonePush('Aarav', 'Meena', 'Nani').title) && /^🎒 Chacha has picked up Aarav$/.test(K.pickupDonePush('Aarav', 'Chacha', 'Chacha').title));
  ok('the record line is the app\'s own legal line', /^This is a record your family keeps\. It is not medical advice\./.test(K.RECORD_LEGAL));

  ok('a phone number must be numbers', K.kidPhone('0522 400 1234').value === '0522 400 1234' && !!K.kidPhone('ring me').error && K.kidPhone('').value === null);
  ok('a date must be a real date', K.kidDate('2027-02-28') === '2027-02-28' && K.kidDate('2027-02-30') === null && K.kidDate('tomorrow') === null);
  ok('a time is HH:MM', K.kidClock('14:30') === '14:30' && K.kidClock('25:00') === null);
  ok('days of the week are 0 to 6, once each', K.kidDays([2, 4, 4, 9, 'x']).join() === '2,4');
  ok('a fee needs a date', !!K.kidItemClean('fee', { title: 'Term fee' }).error && K.kidItemClean('fee', { title: 'Term fee', onDate: '2027-01-10' }).value.onDate === '2027-01-10');
  ok('a vaccination entry is the date given and the next date as written', K.kidItemClean('vaccine', { title: 'Typhoid', onDate: '2025-03-01', nextDue: '2028-03-01' }).value.nextDue === '2028-03-01');
  ok('a class needs its days', !!K.kidItemClean('activity', { title: 'Tabla' }).error && K.kidItemClean('activity', { title: 'Tabla', days: [2], atTime: '17:00' }).value.atTime === '17:00');
  ok('a note is for the parents unless the child says the family', K.kidItemClean('note', { title: 'hi' }).value.share === 'parents' && K.kidItemClean('note', { title: 'hi', share: 'family' }).value.share === 'family');
  ok('an unknown kind is refused', !!K.kidItemClean('secret', { title: 'x' }).error);
  words.push(late.title, late.body, K.feePush('Aarav', 'Term 2 fee', 5).title, K.feePush('Aarav', 'Term 2 fee', 1).title, K.childNotePush('Aarav').title, K.RECORD_LEGAL,
    K.kidMayStart('adult', true).error, K.kidMayStart('self', false).error, ...Object.values(K.KID_SECTION_WORDS));
  ok('a fee reminder says when', /is due in 5 days$/.test(K.feePush('Aarav', 'Term 2 fee', 5).title) && /is due tomorrow$/.test(K.feePush('Aarav', 'Term 2 fee', 1).title) && /is due today$/.test(K.feePush('Aarav', 'Term 2 fee', 0).title));
}

// ---------------------------------------------------------- 3. carer load
{
  const adults = ['priya', 'rohan', 'maa'];
  const top = (w1, w2, a = adults) => CL.carerTop([w1, w2], a);
  ok('two weeks, one person at most of it: named', top({ priya: 5, rohan: 1 }, { priya: 6, rohan: 2 }) === 'priya');
  ok('exactly six parts in ten is "most of it"', CL.CARER_SHARE === 0.6 && top({ priya: 6, rohan: 4 }, { priya: 6, rohan: 4 }) === 'priya');
  ok('just under six in ten is not', top({ priya: 59, rohan: 41 }, { priya: 59, rohan: 41 }) === null);
  ok('a quiet week says nothing', CL.CARER_MIN_ACTS === 6 && top({ priya: 5 }, { priya: 9, rohan: 1 }) === null && top({ priya: 9, rohan: 1 }, { priya: 5 }) === null);
  ok('exactly six acts in a week is enough', top({ priya: 6 }, { priya: 6 }) === 'priya');
  ok('one busy week is not two', CL.carerTop([{ priya: 9, rohan: 1 }], adults) === null);
  ok('a different person each week: nobody is named', top({ priya: 9, rohan: 1 }, { priya: 1, rohan: 9 }) === null);
  ok('shared about evenly: nobody is named', top({ priya: 4, rohan: 3, maa: 3 }, { priya: 4, rohan: 3, maa: 3 }) === null);
  ok('with one adult there is nobody to ask, so no line', top({ priya: 9 }, { priya: 9 }, ['priya']) === null);
  ok('what a child or someone not on Parwah did is not weighed', top({ priya: 6, kabir: 30 }, { priya: 6, kabir: 30 }) === 'priya');
  const line = CL.carerLine({ topName: 'Priya Sharma', forName: 'Maa', day: '2026-11-26' });
  ok('the family line names the person, who it is for, and a day', line === 'Priya has been doing a lot for Maa lately. Could someone take Thursday?');
  ok('with no day known, it asks for a day this week', CL.carerLine({ topName: 'Priya', forName: 'Maa' }) === 'Priya has been doing a lot for Maa lately. Could someone take a day this week?');
  ok('with nobody in particular, it still reads well', CL.carerLine({ topName: 'Priya', day: '2026-11-23' }) === 'Priya has been doing a lot lately. Could someone take Monday?');
  const own = CL.carerLine({ topName: 'Priya', forName: 'Maa', viewerIsTop: true });
  ok('the person themself reads a kinder line, about asking for a hand', /^You have been doing a lot for Maa lately\. It is fine to ask for a hand\./.test(own));
  const lines = [line, own, CL.carerLine({ topName: 'Priya' }), CL.carerLine({ topName: 'A', forName: 'B', day: '2026-11-27', viewerIsTop: true })];
  ok('no line ever holds a number', lines.every(l => !/\d/.test(l)));
  ok('no line holds a word that shames or compares', lines.every(l => CL.carerLineClean(l)) && lines.every(l => !/\b(only|lazy|never|nobody|should|must|unfair|least|less|most|compared|rank|score|behind|blame|fault)\b/i.test(l)));
  ok('the check itself catches a count and a telling-off', !CL.carerLineClean('Priya did 14 tasks') && !CL.carerLineClean('Rohan never helps') && !CL.carerLineClean('Rohan should do more than Priya') && !CL.carerLineClean(''));
  const mine = CL.carerMine({ tasks: 3, medicines: 1, visits: 0, calls: 2, pickups: 1 });
  ok('my own week, in words, with its numbers', mine.total === 7 && mine.lines.join('|') === '3 things done for the family|One medicine tick for someone else|2 calls on the rota|One school pick-up' && /Only you can see it/.test(mine.note));
  ok('a week with nothing written is said kindly', CL.carerMine({}).total === 0 && /That is fine/.test(CL.carerMine({}).note));
  ok('a day off: today to two weeks ahead', CL.dayoffClean('2026-11-20', '2026-11-20').value === '2026-11-20' && CL.dayoffClean('2026-12-04', '2026-11-20').value === '2026-12-04'
    && !!CL.dayoffClean('2026-11-19', '2026-11-20').error && !!CL.dayoffClean('2026-12-05', '2026-11-20').error && !!CL.dayoffClean('soon', '2026-11-20').error);
  const dp = CL.dayoffPush('Priya Sharma', '2026-11-26', 'Evening medicines for Maa');
  ok('the ask names the day and the task', dp.title === '🤲 Priya needs a day off on Thursday 26 Nov' && /Could you take "Evening medicines for Maa" that day\?/.test(dp.body) && dp.kind === 'care');
  ok('the yes is warm', /Rohan will take Thursday 26 Nov/.test(CL.dayoffTakenPush('Rohan', '2026-11-26').title) && /Rest well/.test(CL.dayoffTakenPush('Rohan', '2026-11-26').body));
  ok('at most three asks a day', CL.DAYOFF_PER_DAY === 3);
  words.push(...lines, ...mine.lines, mine.note, CL.carerMine({}).note, dp.title, dp.body, CL.dayoffTakenPush('Rohan', '2026-11-26').body);
}

// ------------------------------------------------------ 4. the function kit
{
  const plan = { by_member: 'r' }, kit = { hosts: ['m'] };
  ok('the plan\'s maker is a host', EK.kitIsHost(plan, null, 'r') && EK.kitIsMaker(plan, 'r'));
  ok('someone the maker named is a host, and not the maker', EK.kitIsHost(plan, kit, 'm') && !EK.kitIsMaker(plan, 'm'));
  ok('nobody else is', !EK.kitIsHost(plan, kit, 'p') && !EK.kitIsHost(plan, null, 'm') && !EK.kitIsHost(null, kit, 'm'));
  ok('sides: trimmed, no doubles, at most eight', EK.kitSides([' Ladki wale ', 'ladki wale', 'Ladke wale', '', 1, 2, 3, 4, 5, 6, 7, 8]).length === 8 && EK.kitSides(['A', 'a']).join() === 'A');
  const gone = new Set(['dadaji']);
  ok('a typed guest needs a name', !!EK.kitGuestClean({}).error);
  ok('a typed guest is a name and a head count', EK.kitGuestClean({ name: ' Gupta ji  and family ', people: 4 }).value.name === 'Gupta ji and family' && EK.kitGuestClean({ name: 'X', people: 4 }).value.people === 4);
  ok('one person by default, to invite', EK.kitGuestClean({ name: 'X' }).value.people === 1 && EK.kitGuestClean({ name: 'X' }).value.status === 'to_invite');
  ok('a phone number is not kept on a guest', /phone number is not kept/.test(EK.kitGuestClean({ name: 'Verma ji 98100 12345' }).error));
  ok('a typed name of someone who has passed away is refused', /remembered here/.test(EK.kitGuestClean({ name: 'Dadaji' }, { goneNames: gone }).error));
  ok('the head count is 1 to 30', !!EK.kitGuestClean({ name: 'X', people: 0 }).error && !!EK.kitGuestClean({ name: 'X', people: 31 }).error && !!EK.kitGuestClean({ name: 'X', people: 2.5 }).error);
  ok('a side must be on the list', !!EK.kitGuestClean({ name: 'X', side: 'Nobody' }, { sides: ['A'] }).error && EK.kitGuestClean({ name: 'X', side: 'a' }, { sides: ['A'] }).value.side === 'a');
  ok('a member guest needs no typed name', EK.kitGuestClean({ memberId: 'm1', people: 2 }).value.people === 2);
  const guests = [{ name: 'Papa', side: 'A', status: 'invited', people: 2 }, { name: 'Gupta ji', side: 'B', status: 'coming', people: 4 }, { name: 'Chacha', side: 'A', status: 'not_coming', people: 1 }, { name: 'Dadi', side: 'A', status: 'to_invite', people: 1 }];
  const c = EK.kitCounts(guests);
  ok('the counts: invites by where they stand, heads coming and heads invited', c.invites === 4 && c.to_invite === 1 && c.invited === 1 && c.coming === 1 && c.not_coming === 1 && c.peopleComing === 4 && c.peopleInvited === 7);
  const sheet = EK.kitSheet(guests, ['A', 'B']);
  ok('the guest sheet is by side, in the order of the sides, names in order', sheet.map(s => s.side).join() === 'A,B' && sheet[0].guests.map(g => g.name).join() === 'Chacha,Dadi,Papa');
  ok('a side\'s head count leaves out those not coming', sheet[0].people === 3 && sheet[1].people === 4);
  ok('a guest with no side is under Others, last', EK.kitSheet([{ name: 'Z', status: 'coming' }, { name: 'Y', side: 'A', status: 'coming' }], ['A']).map(s => s.side).join() === 'A,Others');
  ok('no phone is on the sheet', !/phone/i.test(JSON.stringify(sheet)));
  ok('an arrival needs who and when', !!EK.kitArrivalClean({ arriveAt: '2026-12-01T10:00:00Z' }).error && !!EK.kitArrivalClean({ who: 'Mausi' }).error
    && EK.kitArrivalClean({ who: 'Mausi', arriveAt: '2026-12-01T10:00:00Z', mode: 'train', from: 'Pune' }).value.mode === 'train');
  ok('a budget is a whole number', EK.kitBudgetClean('5,00,000').value === 50000000 && EK.kitBudgetClean('').value === null && !!EK.kitBudgetClean('five lakh').error && !!EK.kitBudgetClean('-5').error);
  words.push(...Object.values(EK.KIT_STATUS_WORDS), ...EK.KIT_SIDES_DEFAULT, EK.kitGuestClean({}).error, EK.kitGuestClean({ name: 'Dadaji' }, { goneNames: gone }).error);
}

// ---------------------------------------------------------- 5. home upkeep
{
  const it = (o) => ({ created_by: 'r', audience: 'IMMEDIATE', people: [], ...o });
  ok('whoever wrote it always reads it', ['ONLY_ME', 'NOMINEES_ONLY', 'IMMEDIATE', 'EMERGENCY_ONLY'].every(a => N.homeMaySee({ item: it({ audience: a }), viewerId: 'r' })));
  ok('"whole family" is read by everyone', N.homeMaySee({ item: it({}), viewerId: 'p' }) && N.homeMaySee({ item: it({}), viewerId: 'k', viewerMinor: true }));
  ok('"only me" is read by nobody else', !N.homeMaySee({ item: it({ audience: 'ONLY_ME' }), viewerId: 'p', sosOpen: true }));
  ok('"people I choose" is read by those people', N.homeMaySee({ item: it({ audience: 'NOMINEES_ONLY', people: ['m'] }), viewerId: 'm' }) && !N.homeMaySee({ item: it({ audience: 'NOMINEES_ONLY', people: ['m'] }), viewerId: 'p' }));
  ok('"only in an emergency" opens for adults while the writer has an SOS open', N.homeMaySee({ item: it({ audience: 'EMERGENCY_ONLY' }), viewerId: 'p', sosOpen: true }) && !N.homeMaySee({ item: it({ audience: 'EMERGENCY_ONLY' }), viewerId: 'p' }));
  ok('never for a child', !N.homeMaySee({ item: it({ audience: 'EMERGENCY_ONLY' }), viewerId: 'k', viewerMinor: true, sosOpen: true }));
  ok('only the writer manages', N.homeMayManage(it({}), 'r') && !N.homeMayManage(it({}), 'p'));
  const base = { kind: 'appliance', title: 'Fridge', audience: 'IMMEDIATE' };
  ok('an entry needs a kind, a name and who sees it', !!N.homeClean({ ...base, kind: 'boat' }).error && !!N.homeClean({ ...base, title: ' ' }).error && !!N.homeClean({ ...base, audience: 'EVERYONE' }).error && !!N.homeClean(base).value);
  ok('dates must be real, and a warranty not before the purchase', !!N.homeClean({ ...base, warrantyUntil: '2027-02-30' }).error && !!N.homeClean({ ...base, boughtOn: '2025-01-01', warrantyUntil: '2024-01-01' }).error
    && N.homeClean({ ...base, boughtOn: '2024-06-01', warrantyUntil: '2026-06-01', serviceDue: '2026-12-01' }).value.serviceDue === '2026-12-01');
  ok('"people I choose" needs people', !!N.homeClean({ ...base, audience: 'NOMINEES_ONLY', people: [] }).error && N.homeClean({ ...base, audience: 'NOMINEES_ONLY', people: ['m', 'm'] }).value.people.length === 1);
  ok('reminders a month and a week ahead', N.homeStage(30) === 30 && N.homeStage(8) === 30 && N.homeStage(7) === 7 && N.homeStage(0) === 7 && N.homeStage(31) === null && N.homeStage(-1) === null);
  ok('a repair note needs words; a next date is optional', !!N.homeLogClean({ note: ' ' }).error && N.homeLogClean({ note: 'Imran fixed it' }).value.serviceDue === null && N.homeLogClean({ note: 'x', serviceDue: '2027-01-01' }).value.serviceDue === '2027-01-01');
  ok('the reminder says which: warranty or service', /warranty runs out in 20 days$/.test(N.homePush('Fridge', 'warranty', 20).title) && /service is due tomorrow$/.test(N.homePush('Fridge', 'service', 1).title));
  ok('the four choices are the register\'s own', N.HOME_WHO.map(w => w[0]).join() === 'ONLY_ME,NOMINEES_ONLY,IMMEDIATE,EMERGENCY_ONLY');
  words.push(N.homePush('Fridge', 'warranty', 20).title, N.homePush('Fridge', 'warranty', 20).body, N.homePush('Fridge', 'service', 1).body, ...N.HOME_WHO.map(w => w[1]), ...N.HOME_KINDS.map(x => x[1]));
}

// ------------------------------------------------- 6. the blood group lookup
{
  const g = N.bloodGroupOf;
  ok('a group as people write it', g('O+') === 'O+' && g('o +ve') === 'O+' && g('O positive') === 'O+' && g('Blood group: AB neg') === 'AB-' && g('B-') === 'B-' && g('A positive (checked)') === 'A+' && g('AB+ve') === 'AB+');
  ok('a zero for the letter O is read as O', g('0+') === 'O+');
  ok('something that is not a group is not guessed at', g('unknown') === null && g('A') === null && g('') === null && g('positive') === null);
  ok('eight groups', N.BLOOD_GROUPS.length === 8 && N.BLOOD_GROUPS.every(x => g(x) === x));
  ok('shown only with a group AND a yes', N.bloodShown({ group: 'O+', consent: true, onApp: true }) === true);
  ok('no yes, no person', N.bloodShown({ group: 'O+', consent: false, onApp: true }) === false && N.bloodShown({ group: 'O+', consent: null, onApp: true }) === false && N.bloodShown({ group: 'O+', onApp: true }) === false);
  ok('no group on record, no person', N.bloodShown({ group: null, consent: true, onApp: true }) === false);
  ok('someone not on Parwah cannot have said yes', N.bloodShown({ group: 'O+', consent: true, onApp: false }) === false);
  ok('never someone who has passed away', N.bloodShown({ group: 'O+', consent: true, onApp: true, remembered: true }) === false);
  ok('an adult looks it up; a child does not', N.bloodMayAsk({ adult: true }).ok && N.bloodMayAsk({ adult: false }).status === 403);
  ok('the consent is asked in the person\'s own words, and reaches linked families', /^Tell my family, and the families linked to ours, my blood group if someone needs blood\.$/.test(N.BLOOD_CONSENT_LINE));
  const ask = N.bloodAskPush('Rohan Sharma', 'O+', 'For Maa');
  ok('the ask says why they are being told', ask.kind === 'safety' && /Rohan is looking for O\+ blood/.test(ask.title) && /You said the family may know your blood group/.test(ask.body));
  ok('a record lookup, and no advice about who can give to whom', /not medical advice/.test(N.BLOOD_LEGAL) && !/donate|donor|compatible|universal/i.test(N.BLOOD_LEGAL + N.BLOOD_CONSENT_LINE + ask.title + ask.body));
  words.push(N.BLOOD_LEGAL, N.BLOOD_CONSENT_LINE, ask.title, ask.body);
}

// ----------------------------------------------- 7. the doctor-ready summary
{
  ok('an adult may open it', N.summaryMayOpen({ viewerMinor: false }).ok);
  ok('a child never, not even their own', N.summaryMayOpen({ viewerMinor: true }).status === 403);
  ok('nobody opens one for someone who has passed away', N.summaryMayOpen({ viewerMinor: false, personRemembered: true }).status === 404);
  const s = N.summaryBuild({ person: { name: 'Papa' }, today: '2026-11-20',
    entries: [{ kind: 'fact', category: 'blood', name: 'Blood group', forwhat: 'O+' }, { kind: 'fact', category: 'allergy', name: 'Penicillin' }, { kind: 'med', name: 'Amlopres 5', forwhat: 'One in the morning' },
      { kind: 'contact', category: 'doctor', name: 'Dr Mehta', phone: '+91522', forwhat: 'Heart' }],
    visits: [{ recorded_at: '2026-10-30', next_due: '2027-01-30', plan_title: null, new_notes: 'BP steady' }], contacts: [{ name: 'Meena', phone: '+9198', note: 'Family' }] });
  ok('it is built from the entries it is given, and nothing else', s.blood === 'O+' && s.allergies.join() === 'Penicillin' && s.medicines[0].name === 'Amlopres 5' && s.doctors[0].name === 'Dr Mehta' && s.visits[0].title === 'Doctor visit'
    && s.visits[0].next === '2027-01-30' && s.contacts[0].name === 'Meena' && s.empty === false);
  ok('it carries the date and says what it is', s.date === '2026-11-20' && s.line === 'Written by the family. This is not a medical record.' && /not medical advice/.test(s.legal));
  ok('with nothing to show, it says it is empty', N.summaryBuild({ person: { name: 'X' }, today: '2026-11-20' }).empty === true);
  words.push(N.SUMMARY_LINE, N.summaryMayOpen({ viewerMinor: true }).error);
}

// ---------------------------------------------------------------- the copy
ok('no banned word in anything these rules say', !words.some(w => BANNED.test(w)), words.filter(w => BANNED.test(w)).join(' | '));
ok('no long dash in anything these rules say', !words.some(w => DASH.test(w)));

if (fails.length) {
  console.error(`familyneedstest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`familyneedstest: ${pass}/${pass} checks pass`);
