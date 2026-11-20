// THE REMAINING FAMILY NEEDS, the rules only. Every module here imports
// nothing but other rule files, so this runs in the deploy gate before npm
// install.
//
// 1. "Sab theek?" the roll-call: who may start, the state of one, who may
//    answer for whom, the board a child sees.
// 2. A child's page: how a viewer stands to a child, what each relation
//    reads and writes, fees, the late pick-up, the words.
import * as RC from '../../api/_rollcallrules.mjs';
import * as K from '../../api/_kidsrules.mjs';

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

// ---------------------------------------------------------------- the copy
ok('no banned word in anything these rules say', !words.some(w => BANNED.test(w)), words.filter(w => BANNED.test(w)).join(' | '));
ok('no long dash in anything these rules say', !words.some(w => DASH.test(w)));

if (fails.length) {
  console.error(`familyneedstest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`familyneedstest: ${pass}/${pass} checks pass`);
