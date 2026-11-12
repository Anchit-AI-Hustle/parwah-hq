// Consent, control and care both ways: the pure rules
// (api/_consentrules.mjs). No database, no network, nothing installed.
import * as R from '../../api/_consentrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else { fails.push(name); console.log('FAIL  ' + name + (detail === undefined ? '' : ' -> ' + detail)); } };

const NOW = Date.parse('2026-11-12T10:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();

// ---- last seen, never a stale dot
ok('a position a minute old is live', R.isLive(ago(1), NOW));
ok('exactly five minutes old is still live', R.isLive(ago(5), NOW));
ok('six minutes old is not live', !R.isLive(ago(6), NOW));
ok('a position with no time is not live', !R.isLive(null, NOW) && !R.isLive('nonsense', NOW));
ok('last seen is said in words', R.lastSeenWords(ago(12), NOW) === 'Last seen 12 min ago', R.lastSeenWords(ago(12), NOW));
ok('hours and days too', R.lastSeenWords(ago(125), NOW) === 'Last seen 2 hours ago' && R.lastSeenWords(ago(60 * 50), NOW) === 'Last seen 2 days ago');
ok('with no time it still says something true', R.lastSeenWords(null, NOW) === 'Last seen a while ago');
ok('who looked, in the words the person reads', R.seenByWords('Rohan', ago(10), NOW) === 'Seen by Rohan, 10 min ago', R.seenByWords('Rohan', ago(10), NOW));
ok('a look with no name is still shown', R.seenByWords('', ago(0), NOW) === 'Seen by someone, just now');
ok('"Not now" mutes an asker for seven days', R.ASK_MUTE_DAYS === 7 && R.muteUntil(NOW).getTime() - NOW === 7 * 86400000);

// ---- a child's standing
const today = '2026-11-12';
ok('17 today is a minor', R.isMinor({ dob: '2008-11-13' }, today));
ok('18 today is an adult', !R.isMinor({ dob: '2008-11-12' }, today));
ok('no date of birth is an adult, as joining already says', !R.isMinor({ dob: null }, today));
ok('marked as a child by an adult is a minor, with no date of birth', R.isMinor({ dob: null, is_child: true }, today));
ok('nobody is nobody', !R.isMinor(null, today));
for (const k of ['sos_details', 'missed_dose', 'staff_money', 'safe_word', 'emergency_items', 'costs', 'staff_late']) {
  ok('a child is not sent ' + k, !R.mayBeTold({ dob: '2012-05-05' }, k, today) && R.mayBeTold({ dob: '1980-05-05' }, k, today));
}
for (const k of ['plan', 'card', 'game', 'album', 'story', 'ashirwad', 'howday', 'trip']) {
  ok('a child is still sent ' + k, R.mayBeTold({ dob: '2012-05-05' }, k, today));
}
ok('a kind nobody listed is adult only', R.adultOnly('something_new') && !R.mayBeTold({ is_child: true }, 'something_new', today));
ok('the two lists do not overlap', R.ADULT_ONLY_KINDS.every(k => R.WARM_KINDS.indexOf(k) < 0) && R.ADULT_ONLY_KINDS.every(R.adultOnly));
ok('a remembered person is never told anything', !R.mayBeTold({ dob: '1950-01-01', remembered: true }, 'card', today));

// ---- Ashirwad and "How is your day?"
ok('the one-tap lines are the three the family asked for, and one more',
   ['Khush raho', 'All the best for the exam', 'Reach safely'].every(t => R.BLESS_LINES.some(l => l.t === t)) && R.BLESS_LINES.length <= 5);
ok('a line is found by its key, and nothing else is', R.blessLine('khush') === 'Khush raho' && R.blessLine('<script>') === null && R.blessLine(undefined) === null);
ok('the one-tap answer is Pranam', R.PRANAM === '🙏 Pranam');
ok('the day has a few answers, one of them asks for a call', R.DAY_ANSWERS.length >= 3 && R.DAY_ANSWERS.some(a => /call me/i.test(a.t)) && R.dayAnswer('good') && R.dayAnswer('nope') === null);
const words = R.BLESS_LINES.map(l => l.t).concat(R.DAY_ANSWERS.map(a => a.t), [R.DAY_ASK, R.ECARD_LEGAL, R.tripAskLine('Asha'), R.tripLine('Asha', 'Delhi', 'train')]).join(' ');
ok('no long dashes in the words people read', !/[–—]/.test(words));
ok('none of the words Parwah never uses', !/\b(elderly|burden|cure|treat|heal|therapy|remedy|medicinal|prevents|reverses|guaranteed|arthritis|diabetes)\b/i.test(words), words);

// ---- Reached safely
const at = (min) => new Date(NOW + min * 60000).toISOString();
let c = R.tripClean({ to: '  Delhi  ', by: 'train', expectAt: at(120) }, NOW);
ok('a trip is where, how and by when', c.value && c.value.to === 'Delhi' && c.value.by === 'train' && c.value.expectAt.getTime() === NOW + 120 * 60000, JSON.stringify(c));
ok('a trip needs a place', !!R.tripClean({ to: '   ', expectAt: at(60) }, NOW).error);
ok('and a time', !!R.tripClean({ to: 'Delhi' }, NOW).error);
ok('a time already gone is refused', !!R.tripClean({ to: 'Delhi', expectAt: at(-10) }, NOW).error);
ok('a time under five minutes away is refused', !!R.tripClean({ to: 'Delhi', expectAt: at(3) }, NOW).error);
ok('a time more than three days away is refused', !!R.tripClean({ to: 'Delhi', expectAt: at(4 * 1440) }, NOW).error);
ok('a way of travelling nobody listed becomes "other"', R.tripClean({ to: 'Delhi', by: 'rocket', expectAt: at(60) }, NOW).value.by === 'other');
ok('markup in the place is taken out', !/[<>]/.test(R.tripClean({ to: '<b>Delhi</b>', expectAt: at(60) }, NOW).value.to));
ok('a place over 60 letters is refused', !!R.tripClean({ to: 'x'.repeat(61), expectAt: at(60) }, NOW).error);
const trip = { status: 'open', expect_at: at(60) };
ok('before the expected time the trip is travelling', R.tripPhase(trip, NOW) === 'travelling');
ok('at the expected time it is still travelling', R.tripPhase(trip, NOW + 60 * 60000) === 'travelling');
ok('29 minutes after, still travelling', R.tripPhase(trip, NOW + 89 * 60000) === 'travelling');
ok('30 minutes after, it is late', R.TRIP_GRACE_MIN === 30 && R.tripPhase(trip, NOW + 90 * 60000) === 'late');
ok('reached is reached, however late', R.tripPhase({ status: 'reached', expect_at: at(-600) }, NOW) === 'reached');
ok('cancelled is cancelled', R.tripPhase({ status: 'cancelled', expect_at: at(-600) }, NOW) === 'cancelled');
ok('the line the family reads', R.tripLine('Asha Sharma', 'Delhi', 'train') === 'Asha is leaving for Delhi, by train' && R.tripLine('Asha', 'Delhi', 'other') === 'Asha is leaving for Delhi');
ok('the ask is gentle and names nobody but the traveller', R.tripAskLine('Asha Sharma') === 'Asha has not tapped Reached safely yet. A call may help.');

// ---- the emergency card
const base = { viewerId: 'v', personId: 'p', personOnApp: true, personRemembered: false, chosen: [], sosOpen: false, viewerMinor: false };
ok('my own card always opens', R.ecardMayOpen({ ...base, viewerId: 'p' }));
ok('even for a child', R.ecardMayOpen({ ...base, viewerId: 'p', viewerMinor: true }));
ok('someone I did not choose does not open my card', !R.ecardMayOpen(base));
ok('an adult I chose does', R.ecardMayOpen({ ...base, chosen: ['v'] }));
ok('a child I chose does not', !R.ecardMayOpen({ ...base, chosen: ['v'], viewerMinor: true }));
ok('while my SOS is open the adults can', R.ecardMayOpen({ ...base, sosOpen: true }));
ok('but not a child', !R.ecardMayOpen({ ...base, sosOpen: true, viewerMinor: true }));
ok('the adults keep the card of someone not on Parwah', R.ecardMayOpen({ ...base, personOnApp: false }));
ok('a child does not', !R.ecardMayOpen({ ...base, personOnApp: false, viewerMinor: true }));
ok('nobody opens the card of someone remembered', !R.ecardMayOpen({ ...base, personRemembered: true, chosen: ['v'], sosOpen: true }) && !R.ecardMayOpen({ ...base, viewerId: 'p', personRemembered: true }));
ok('the legal line says it is a record, not advice', /record/.test(R.ECARD_LEGAL) && /not medical advice/.test(R.ECARD_LEGAL));
ok('two contacts, no more', R.ECARD_CONTACTS_MAX === 2);

// ---- home staff: the two one-tap answers
const w = R.staffAnswerWords('Sunita Devi');
ok('the answers are "Sunita came" and "On leave today"', w.came === 'Sunita came' && w.leave === 'On leave today' && R.STAFF_ANSWERS.came === 'came' && R.STAFF_ANSWERS.leave === 'leave');

if (fails.length) { console.error('consenttest: ' + fails.length + ' FAILED of ' + (pass + fails.length)); process.exit(1); }
console.log('consenttest: ' + pass + '/' + pass + ' checks pass');
