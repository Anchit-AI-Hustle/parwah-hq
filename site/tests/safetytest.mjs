// SAFETY AND ALERTS, the rules only. api/_safetyrules.mjs imports nothing,
// so this runs in the deploy gate before npm install.
//
// 1. Push topics: each SOS has its own, so nothing replaces one that has
//    not been delivered; a reminder is never sent as an emergency.
// 2. Who an SOS reaches: never someone who has passed away, and in the
//    right order.
// 3. Who is an adult when no date of birth was written.
// 4. The timer line, the medicine and task words, and who hears about a
//    medicine with no tick.
import * as S from '../../api/_safetyrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

// ---------------------------------------------------------------- topics
const A = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab', B = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ac';
const ta = S.pushTopic('sos', A), tb = S.pushTopic('sos', B);
ok('an SOS topic is a valid Web Push topic', S.TOPIC_OK.test(ta) && ta.length <= 32, ta);
ok('two SOS get two topics', ta !== tb, ta + ' ' + tb);
ok('the same SOS pressed again keeps its topic', ta === S.pushTopic('sos', A));
ok('the escalation, the recording and the ladder call do not share the SOS topic',
  new Set([ta, S.pushTopic('sosesc', A), S.pushTopic('sosrec', A), S.pushTopic('soslad', A)]).size === 4);
ok('every kind stays inside 32 url-safe characters', ['sos', 'sosesc', 'sosrec', 'soslad', 'ask', 'askack', 'hosp', 'a kind that is far too long!']
  .every(k => S.TOPIC_OK.test(S.pushTopic(k, A))));
ok('odd input still gives a valid topic', S.TOPIC_OK.test(S.pushTopic('', null)) && S.TOPIC_OK.test(S.pushTopic('sos', '../x y+z=')));

const sos = S.pushOptions({ urgent: true, topic: ta });
ok('an SOS is sent high, kept a day, under its own topic and tag', sos.opts.urgency === 'high' && sos.opts.TTL === 86400 && sos.opts.topic === ta && sos.tag === ta && sos.urgent);
const med = S.pushOptions({ soon: true, title: 'medicines' });
ok('a medicine nudge is not an emergency and has no topic', !med.urgent && med.opts.topic === undefined && med.tag === null && med.opts.urgency === 'high');
const plain = S.pushOptions({ title: 'hello' });
ok('an ordinary push has no topic, so it replaces nothing', !plain.urgent && plain.opts.topic === undefined && plain.opts.urgency === undefined);
ok('a bad topic is dropped, never sent', S.pushOptions({ urgent: true, topic: 'has spaces and is much much too long to be allowed here' }).opts.topic === undefined);
ok('an urgent push with no topic shares none', S.pushOptions({ urgent: true }).opts.topic === undefined);
const ring = S.pushOptions({ ring: true });
ok('ringing a lost phone keeps its own topic, apart from every SOS', ring.opts.topic === 'parwah-ring' && ring.ring && !ring.urgent);
ok('urgent wins over ring and soon', S.pushOptions({ urgent: true, ring: true, soon: true, topic: ta }).ring === false);

// ---------------------------------------------------------------- contacts
const fam = [
  { name: 'Dadi', phone: '+91 98100 00001', on_app: false, adult: true, remembered: false },
  { name: 'Dada', phone: '9810000002', on_app: true, adult: true, remembered: true },
  { name: 'Kabir', phone: '9810000003', on_app: true, adult: false, remembered: false },
  { name: 'Rohan', phone: '9810000004', on_app: true, adult: true, remembered: false },
  { name: 'Priya', phone: '9810000005', on_app: true, adult: true, remembered: false },
];
const chosen = [{ name: 'Dr Mehta', phone: '011-2345-6789' }, { name: 'Dada (old entry)', phone: '+91 98100 00002' }, { name: 'Rohan bhaiya', phone: '09810000004' }];
const list = S.orderContacts({ chosen, family: fam, own: '9810000099' });
ok('someone who has passed away is never on the list', !list.some(c => /Dada/.test(c.name)), JSON.stringify(list));
ok('nor is their number, written down as an emergency contact', !list.some(c => S.phoneTail(c.phone) === '9810000002'));
ok('the chosen emergency contact comes first', list[0].name === 'Dr Mehta' && list[0].why === 'Emergency contact');
ok('then adults on Parwah, then everyone else', list.map(c => c.name).join() === 'Dr Mehta,Rohan bhaiya,Priya,Dadi,Kabir', list.map(c => c.name).join());
ok('nobody is listed twice, however the number was written', list.filter(c => S.phoneTail(c.phone) === '9810000004').length === 1);
ok('never the person themselves', !S.orderContacts({ family: [{ name: 'Me again', phone: '+919810000099', on_app: true, adult: true }], own: '9810000099' }).length);
ok('at most eight', S.orderContacts({ family: Array.from({ length: 20 }, (_, i) => ({ name: 'P' + i, phone: '98200000' + String(i).padStart(2, '0'), on_app: true, adult: true })) }).length === 8);
ok('a family of only remembered people gives an empty list', S.orderContacts({ family: [fam[1]] }).length === 0);

// ---------------------------------------------------------------- adults
const today = new Date('2026-11-12T00:00:00Z');
ok('18 today is an adult, 17 is not', S.surelyAdult({ user_id: 'u', dob: '2008-11-12' }, today) && !S.surelyAdult({ user_id: 'u', dob: '2008-11-13' }, today));
ok('no date of birth and no role: not taken to be an adult', !S.surelyAdult({ user_id: 'u' }, today) && !S.surelyAdult({ user_id: 'u', relation: 'son', role: 'family' }, today));
ok('no date of birth, but the parent role: an adult', S.surelyAdult({ user_id: 'u', role: 'parent' }, today));
ok('no date of birth, but a grown-up relation: an adult', ['father', 'mother', 'grandfather', 'grandmother', 'daughter-in-law', 'son-in-law'].every(r => S.surelyAdult({ user_id: 'u', relation: r }, today)));
ok('a child or sibling relation alone does not say adult', ['son', 'daughter', 'brother', 'sister', 'grandson', 'granddaughter', 'friend', 'family', ''].every(r => !S.surelyAdult({ user_id: 'u', relation: r }, today)));
ok('a spouse or a child in the tree says adult', S.surelyAdult({ user_id: 'u', spouse_id: 'x' }, today) && S.surelyAdult({ user_id: 'u', has_child: true }, today));
ok('a date of birth under 18 wins over any role', !S.surelyAdult({ user_id: 'u', dob: '2012-01-01', role: 'parent', spouse_id: 'x' }, today));
ok('a name in the tree is never one', !S.surelyAdult({ user_id: null, role: 'parent' }, today) && !S.surelyAdult(null, today));

// ---------------------------------------------------------------- the timer
const now = Date.UTC(2026, 10, 12, 10, 0, 0);
ok('two minutes ago, said plainly', S.timerLine(now - 2 * 60000 - 5000, now).text === 'Reminders last ran: 2 minutes ago' && !S.timerLine(now - 120000, now).warn);
ok('one minute, and just now', S.timerLine(now - 61000, now).text === 'Reminders last ran: 1 minute ago' && S.timerLine(now - 5000, now).text === 'Reminders last ran: just now');
ok('15 minutes is still fine', !S.timerLine(now - 15 * 60000, now).warn);
ok('16 minutes is a plain warning', S.timerLine(now - 16 * 60000, now).warn && S.timerLine(now - 16 * 60000, now).text === 'Timed reminders are not running. Family alerts may be late.');
ok('never run is a warning too', S.timerLine(null, now).warn && S.timerLine(NaN, now).warn);
ok('calls not set up is said in the owner\'s words', S.CALLS_OFF_LINE === 'Calls and texts are not set up. Family is told inside Parwah.');

// ---------------------------------------------------------------- medicines
ok('on Parwah and never asked: nobody is told', S.doseTellWho({ onApp: true, tell: null, carerId: 'c' }) === 'nobody');
ok('on Parwah and said no: nobody', S.doseTellWho({ onApp: true, tell: false }) === 'nobody');
ok('on Parwah and said yes: the family', S.doseTellWho({ onApp: true, tell: true }) === 'family');
ok('not on Parwah: only the carer who marks, never the family', S.doseTellWho({ onApp: false, tell: true, carerId: 'c' }) === 'carer' && S.doseTellWho({ onApp: false, tell: null }) === 'nobody');
const blame = /\b(missed|forgot|forgotten|failed|late|again|still not|not marked|should|must)\b/i;
const n = S.doseNudgeText('9:00 PM'), f = S.doseFamilyText('Papa Sharma', '9:00 PM');
ok('the nudge does not read as blame', !blame.test(n.title + ' ' + n.body), n.title + ' ' + n.body);
ok('the family line does not read as blame, and uses the first name', !blame.test(f.title + ' ' + f.body) && /^💊 Papa's 9:00 PM/.test(f.title), f.title + ' ' + f.body);
ok('a refill names the medicine only when it is shared', S.refillTitle('Papa Sharma', 'Amlodipine', true) === 'Get more Amlodipine for Papa' && S.refillTitle('Papa Sharma', 'Amlodipine', false) === 'Get more medicines for Papa');

// ---------------------------------------------------------------- tasks
const o = S.taskOwnerText('Pay the electricity bill', 'claimed'), ft = S.taskFamilyText('Pay the electricity bill', true);
ok('the owner is told only they see it', /Only you see this/.test(o.body));
ok('the family line names nobody', !/Rohan|has it|has not/.test(ft.title + ft.body + S.taskFamilyFeed('Pay the electricity bill', true)));
ok('the family hears a second window later, not at once', S.TASK_FAMILY_AFTER_MIN >= 30);
const dash = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
ok('no em or en dashes in any of these words', ![n.title, n.body, f.title, f.body, o.title, o.body, ft.title, ft.body, S.CALLS_OFF_LINE, S.ADULT_HOW, S.timerLine(null, now).text].some(t => dash.test(t)));

if (fails.length) {
  console.error(`safetytest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const x of fails) console.error('  - ' + x);
  process.exit(1);
}
console.log(`safetytest: ${pass}/${pass} checks pass`);
