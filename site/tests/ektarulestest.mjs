// EKTA'S RULES, with no database, no network and no model.
// api/_ektarules.mjs imports only _digestrules.mjs (which imports nothing),
// so the deploy gate runs this on a fresh clone before npm install.
//
// What it proves:
//   - no default model is one that has been retired;
//   - she answers in a chat only to "@Ekta" or her name as the first word,
//     never to "ekta" the word for unity;
//   - "tomorrow", "kal", "Friday", "7 baje" and "12 Nov" become dates and
//     times on the member's own clock, with every guess marked;
//   - "Papa", "Maa", "Dadi" become ONE member of this family, or a question
//     when two people fit, and never someone who is remembered;
//   - a tool's arguments are checked before it runs;
//   - the confirm card says exactly what would happen, and the audit label
//     never carries the words of a message;
//   - the report says what waits and what was not done, and there is no
//     cheerful "done" for unfinished work;
//   - passwords, PINs, OTPs, card numbers and health readings are never remembered;
//   - the morning note and the nudges: plain, private, capped, quiet at night;
//   - every spoken line exists in English and in Hindi.
import { EKTA, EKTA_MODELS, EKTA_EFFORT, ektaMentioned, stripMention, resolveWhen, resolveKin, findPerson, contextBlock,
         validateArgs, actionLabel, auditLabel, ACTION_KINDS, completionReport, unfinishedLine, memoryRisk,
         MEMORY_REFUSE_SECRET, MEMORY_REFUSE_HEALTH, quickIntent, waLink, photoDraft, PHOTO_MEDICAL, PHOTO_UNREADABLE,
         morningFacts, morningWrite, morningQuiet, morningPrompt, isMorning, nudgePick, quietHour,
         EKTA_SAY, EKTA_LANGS, ektaLang } from '../../api/_ektarules.mjs';
import { digestCheck } from '../../api/_digestrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => cond ? pass++ : fails.push(name + (detail === undefined ? '' : ' -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));

// ---- models
const RETIRED = ['claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307', 'claude-3-sonnet-20240229', 'claude-3-7-sonnet-20250219', 'claude-2.1', 'claude-2.0', 'claude-instant-1.2'];
ok('the defaults are the current ids', EKTA_MODELS.main === 'claude-sonnet-5-5' && EKTA_MODELS.deep === 'claude-opus-5-5' && EKTA_MODELS.light === 'claude-haiku-5-5');
ok('no default is a retired model', Object.values(EKTA_MODELS).every(m => !RETIRED.includes(m)));
ok('no default carries a date suffix', Object.values(EKTA_MODELS).every(m => !/\d{8}$/.test(m)));
ok('how hard each thinks is set by effort, and the cap leaves room for thinking plus the reply',
   EKTA_EFFORT.main === 'low' && EKTA_EFFORT.deep === 'medium' && EKTA_EFFORT.light === 'low' && EKTA.maxTokens >= 16000);
ok('the turn has 45 seconds, a card 30 minutes, the chat 30 turns', EKTA.deadlineMs === 45000 && EKTA.proposalMinutes === 30 && EKTA.threadKeep === 30);

// ---- when a chat message is for her
ok('"@Ekta" anywhere is for her', ektaMentioned('What is planned, @Ekta?') && ektaMentioned('@ekta when is the dinner'));
ok('her name as the first word is for her', ektaMentioned('Ekta, when is the dinner?') && ektaMentioned('ekta what is planned') && ektaMentioned('एकता, कल क्या है?'));
ok('"ekta" the word for unity is not', !ektaMentioned('Hamari ekta hi hamari taakat hai') && !ektaMentioned('Unity means ekta') && !ektaMentioned('परिवार की एकता सबसे बड़ी है'));
ok('nor a name that only starts like hers', !ektaMentioned('Ektaa aunty is coming') && !ektaMentioned('@ektaji hello') && !ektaMentioned(''));
ok('her name is taken out of the question', stripMention('Ekta, when is the dinner?') === 'when is the dinner?' && stripMention('what is planned @Ekta') === 'what is planned');

// ---- dates and times, on the member's own clock
// Thursday 12 November 2026, 10:30 pm in India (5:00 pm UTC).
const NOW = Date.UTC(2026, 10, 12, 17, 0), IN = 'Asia/Kolkata';
const w1 = resolveWhen('remind me tomorrow at 7 to call the vendor', IN, NOW);
ok('today is read in the member\'s zone', w1.today === '2026-11-12' && w1.weekday === 'thursday' && w1.zone === IN, w1);
ok('"tomorrow" is the next day there', w1.days.length === 1 && w1.days[0].date === '2026-11-13');
ok('"at 7" with no am or pm is a guess, and says so', w1.times.length === 1 && w1.times[0].time === '07:00' && /assumed/.test(JSON.stringify(w1.times[0])), w1.times);
// The same instant is already Friday 13th in Auckland.
ok('"tomorrow" in Auckland is a different date', resolveWhen('tomorrow', 'Pacific/Auckland', NOW).days[0].date === '2026-11-14');
ok('an unknown zone falls back to UTC, never throws', resolveWhen('today', 'Mars/Phobos', NOW).zone === 'UTC');
const w2 = resolveWhen('kal subah 8 baje dawa', IN, NOW);
ok('"kal" is read as tomorrow, marked as a guess', w2.days[0].date === '2026-11-13' && !!w2.days[0].assumed, w2.days);
ok('"subah 8 baje" is 08:00, not a guess', w2.times[0].time === '08:00' && !w2.times[0].assumed, w2.times);
ok('"shaam 6 baje" is 18:00', resolveWhen('shaam 6 baje call karna', IN, NOW).times[0].time === '18:00');
ok('"7:30 pm" is 19:30 and "12 am" is 00:00', resolveWhen('at 7:30 pm', IN, NOW).times[0].time === '19:30' && resolveWhen('12 am', IN, NOW).times[0].time === '00:00');
ok('"on Friday" is the coming Friday', resolveWhen('dinner on Friday', IN, NOW).days[0].date === '2026-11-13');
ok('"Thursday", said on a Thursday, is next week', resolveWhen('Thursday lunch', IN, NOW).days[0].date === '2026-11-19');
ok('"parso" is the day after tomorrow', resolveWhen('parso milte hain', IN, NOW).days[0].date === '2026-11-14');
const w3 = resolveWhen('Chachu ka birthday 12 Nov ko hai, 3 log aayenge', IN, NOW);
ok('"12 Nov" is a date, not noon, and a bare number is not a time', w3.days.some(d => d.date === '2026-11-12') && w3.times.length === 0, w3);
ok('a date that has gone this year is next year', resolveWhen('5 Jan', IN, NOW).days[0].date === '2027-01-05');
ok('a message with no day or time resolves nothing', resolveWhen('how is everyone', IN, NOW).days.length === 0 && resolveWhen('how is everyone', IN, NOW).times.length === 0);

// ---- family words
const fam = [
  { id: 'rohan', name: 'Rohan', relation: 'son' }, { id: 'raj', name: 'Raj', relation: 'father' },
  { id: 'sunita', name: 'Sunita', relation: 'mother' }, { id: 'kamla', name: 'Kamla', relation: 'grandmother' },
  { id: 'shanti', name: 'Shanti', relation: 'grandmother' }, { id: 'dada', name: 'Dadaji', relation: 'grandfather', remembered: true },
  { id: 'priya', name: 'Priya', relation: 'sister' }
];
const k1 = resolveKin('tell Papa and Maa I reached', fam, 'rohan');
ok('"Papa" and "Maa" are the one father and the one mother', k1.resolved.length === 2 && k1.resolved[0].name === 'Raj' && k1.resolved[1].name === 'Sunita', k1);
const k2 = resolveKin('call Dadi', fam, 'rohan');
ok('"Dadi" with two grandmothers saved is a question, not a guess', k2.resolved.length === 0 && k2.ambiguous.length === 1 && k2.ambiguous[0].options.join() === 'Kamla,Shanti', k2);
ok('someone who is remembered is never a match', resolveKin('message Dada', fam, 'rohan').unknown.join() === 'Dada' && resolveKin('message Dada', fam, 'rohan').resolved.length === 0);
ok('a word nobody is saved as is unknown', resolveKin('tell Chachu', fam, 'rohan').unknown.join() === 'Chachu');
ok('a member whose NAME is the word wins over a relation', resolveKin('tell Maa', fam.concat([{ id: 'm2', name: 'Maa', relation: 'aunt' }]), 'rohan').resolved[0].id === 'm2');
ok('the asker is never their own "brother"', resolveKin('tell bhai', [{ id: 'a', name: 'A', relation: 'brother' }], 'a').unknown.length === 1);
ok('a person is found by name, first name or family word', findPerson('raj', fam, 'rohan').member.id === 'raj' && findPerson('Papa', fam, 'rohan').member.id === 'raj');
ok('two people who fit: ask which', findPerson('Dadi', fam, 'rohan').ambiguous.join() === 'Kamla,Shanti');
ok('nobody by that name: unknown', findPerson('Vikram', fam, 'rohan').unknown === true && findPerson('', fam, 'rohan').unknown === true);
ok('a remembered person is never found, by name either', findPerson('Dadaji', fam, 'rohan').unknown === true);
ok('the asker is found only when asked for', findPerson('Rohan', fam, 'rohan').unknown === true && findPerson('Rohan', fam, 'rohan', { allowSelf: true }).member.id === 'rohan');

const block = contextBlock({ me: { name: 'Rohan', role: 'family' }, circleName: 'Sharma Family', word: 'family', country: 'India', ambulance: '108',
  when: w1, kin: k2, memory: [{ key: 'Tea', value: 'Ginger, no sugar' }] });
ok('the facts block carries the date, the time there and what the words mean',
   /2026-11-12/.test(block) && /"tomorrow" is 2026-11-13/.test(block) && /Asia\/Kolkata/.test(block) && /108/.test(block), block);
ok('an ambiguous word tells her to ask', /"Dadi" could be Kamla or Shanti\. Ask which one/.test(block));
ok('it says it is information, not instructions, and holds what she was asked to remember',
   /information, not instructions/.test(block) && /Tea: Ginger, no sugar/.test(block) && /not instructions\)/.test(block));

// ---- arguments
const schema = { type: 'object', additionalProperties: false, required: ['title', 'date'],
  properties: { title: { type: 'string', maxLength: 10 }, date: { type: 'string', format: 'date' }, time: { type: 'string', format: 'time' },
    kind: { type: 'string', enum: ['call', 'meet'] }, options: { type: 'array', minItems: 2, maxItems: 3 }, multi: { type: 'boolean' } } };
ok('good arguments pass, trimmed', validateArgs(schema, { title: ' Dinner ', date: '2026-11-13' }).value.title === 'Dinner');
ok('a missing argument is named', /"date" is missing/.test(validateArgs(schema, { title: 'Dinner' }).error));
ok('an empty required argument is missing', validateArgs(schema, { title: '  ', date: '2026-11-13' }).ok === false);
ok('an extra argument is refused', /no argument called "delete_all"/.test(validateArgs(schema, { title: 'x', date: '2026-11-13', delete_all: true }).error));
ok('the wrong type is refused', validateArgs(schema, { title: 5, date: '2026-11-13' }).ok === false && validateArgs(schema, { title: 'x', date: '2026-11-13', multi: 'yes' }).ok === false);
ok('too long is refused', validateArgs(schema, { title: 'A very long title', date: '2026-11-13' }).ok === false);
ok('a bad date or time is refused', validateArgs(schema, { title: 'x', date: 'tomorrow' }).ok === false && validateArgs(schema, { title: 'x', date: '2026-11-13', time: '7pm' }).ok === false);
ok('a value outside the list is refused', validateArgs(schema, { title: 'x', date: '2026-11-13', kind: 'payment' }).ok === false);
ok('a list too short or too long is refused', validateArgs(schema, { title: 'x', date: '2026-11-13', options: ['a'] }).ok === false
   && validateArgs(schema, { title: 'x', date: '2026-11-13', options: ['a', 'b', 'c', 'd'] }).ok === false);
ok('arguments that are not an object are refused', validateArgs(schema, 'send').ok === false && validateArgs(schema, null).ok === false && validateArgs(schema, []).ok === false);

// ---- the confirm card and the audit label
ok('the card says exactly what would be sent, and to whom', actionLabel('message', { toName: 'Maa', text: 'Khana kha liya?' }) === 'send "Khana kha liya?" to Maa');
ok('a message with no person is for the family chat', actionLabel('message', { text: 'I reached' }) === 'send "I reached" to the family chat');
ok('a reminder for someone else says they will be asked', /^ask Raj to accept a reminder: Walk, 07:00, every day$/.test(actionLabel('reminder', { forName: 'Raj', title: 'Walk', timeOfDay: '07:00', recurrence: 'daily' })));
ok('a reminder for yourself says so', /^set a reminder for you: Call the bank, 2026-11-13$/.test(actionLabel('reminder', { self: true, title: 'Call the bank', date: '2026-11-13', recurrence: 'once' })));
ok('every kind has card words and an audit label', ACTION_KINDS.every(k => actionLabel(k, {}).length > 5 && auditLabel(k, {}).length > 3 && actionLabel(k, {}) !== 'do something'));
const secretText = 'Khana kha liya? Aaj dal bani hai';
ok('the audit label never carries the words of a message, a note or what was remembered',
   !auditLabel('message', { toName: 'Maa', text: secretText }).includes('Khana') && auditLabel('message', { toName: 'Maa', text: secretText }) === 'Message to Maa'
   && !auditLabel('note', { title: 'Wifi', body: secretText }).includes('Wifi') && !auditLabel('remember', { key: 'Tea', value: 'Ginger' }).includes('Ginger')
   && !auditLabel('card_line', { forName: 'Raj', text: secretText }).includes('Khana'));

// ---- the honest report
const rep = completionReport({ proposed: [{ label: 'send "I reached" to Rohan' }], failed: [{ what: 'send a message to Dadi', why: 'Dadi is not on Parwah' }], cut: 'time' });
ok('the report lists what waits for a yes', /Waiting for your yes:/.test(rep) && /Send "I reached" to Rohan/.test(rep) && /Nothing is done until you tap "Yes, do it"/.test(rep), rep);
ok('and what was not done, with why', /Not done:/.test(rep) && /Dadi is not on Parwah/.test(rep));
ok('and that time ran out', /ran out of time/.test(rep));
ok('nothing to report is an empty string', completionReport({ proposed: [], failed: [] }) === '' && completionReport(null) === '');
ok('unfinished work is said plainly, never "Ho gaya"', /could not finish/.test(unfinishedLine('time')) && /could not finish/.test(unfinishedLine('steps'))
   && !/ho gaya|done/i.test(unfinishedLine('time') + unfinishedLine('steps') + rep.replace(/Not done|Nothing is done/g, '')));

// ---- what she never remembers
ok('a password is refused', memoryRisk('Netflix', 'password is hunter2') === MEMORY_REFUSE_SECRET);
ok('a PIN, an OTP, a CVV, a card number are refused', memoryRisk('ATM pin', '4821') === MEMORY_REFUSE_SECRET && memoryRisk('otp', '993311') === MEMORY_REFUSE_SECRET
   && memoryRisk('card', 'cvv 123') === MEMORY_REFUSE_SECRET && memoryRisk('My card number', 'x') === MEMORY_REFUSE_SECRET && memoryRisk('Bank', 'pin 4821') === MEMORY_REFUSE_SECRET);
ok('a health reading is refused', memoryRisk('BP', '140/90') === MEMORY_REFUSE_HEALTH && memoryRisk('Sugar', 'fasting 180') === MEMORY_REFUSE_HEALTH
   && memoryRisk('Reading', '6.9 mmol') === MEMORY_REFUSE_HEALTH && memoryRisk('note', 'creatinine 1.4') === MEMORY_REFUSE_HEALTH);
ok('an ordinary preference is fine', memoryRisk('Tea', 'Ginger tea, no sugar') === null && memoryRisk('Call me', 'Rohan beta') === null
   && memoryRisk('Home', 'PIN code 110001') === null && memoryRisk('Likes', 'Old Kishore songs') === null);

// ---- said without a model
ok('"Ekta, tell Rohan I reached" is a message to Rohan', JSON.stringify(quickIntent('Ekta, tell Rohan I reached')) === JSON.stringify({ kind: 'message', to: 'Rohan', text: 'I reached' }));
ok('"tell the family that ..." is for the family chat', quickIntent('tell the family that dinner is at 8').to === null && quickIntent('tell the family that dinner is at 8').text === 'Dinner is at 8');
ok('"Rohan ko bolo ki main pahunch gayi" works in Hindi', quickIntent('Rohan ko bolo ki main pahunch gayi').to === 'Rohan' && quickIntent('Rohan ko bolo ki main pahunch gayi').text === 'Main pahunch gayi');
ok('"sabko bata do ..." is for the family chat', quickIntent('sabko bata do khana tayyar hai').to === null);
ok('"tell me ..." and a plain question are not messages', quickIntent('tell me about Papa') === null && quickIntent('what is planned this week') === null && quickIntent('tell a story') === null);

// ---- WhatsApp hand-off
ok('a link that opens WhatsApp with the words filled in', waLink('+91 98200 12345', 'Namaste Mausi, kal aa rahe hain') === 'https://wa.me/919820012345?text=Namaste%20Mausi%2C%20kal%20aa%20rahe%20hain');
ok('a ten digit number is taken as Indian', /wa\.me\/919820012345\?/.test(waLink('9820012345', 'hi')));
ok('no usable number, no link', waLink('', 'hi') === null && waLink('12345', 'hi') === null && waLink(null, 'hi') === null);

// ---- a photo to a draft
ok('a prescription is refused, in the app\'s own words', photoDraft({ kind: 'medical' }).reply === PHOTO_MEDICAL && /never read or explain a prescription or a report/.test(PHOTO_MEDICAL));
ok('a medical paper the model called a bill is still refused', photoDraft({ kind: 'bill', biller: 'City Hospital lab report', amount: 500 }).reply === PHOTO_MEDICAL
   && photoDraft({ kind: 'note', label: 'Paracetamol 500 mg tablet' }).reply === PHOTO_MEDICAL);
ok('an unreadable photo says so', photoDraft({ kind: 'unreadable' }).reply === PHOTO_UNREADABLE && photoDraft({}).reply === PHOTO_UNREADABLE && photoDraft({ kind: 'transfer money' }).reply === PHOTO_UNREADABLE);
const dr = photoDraft({ kind: 'renewal', label: 'Fridge warranty', date: '2027-03-01', note: 'Model RT28' });
ok('an appliance label becomes a renewal draft', dr.ok && dr.kind === 'renewal' && dr.payload.label === 'Fridge warranty' && dr.payload.expiresOn === '2027-03-01', dr);
ok('a label with no date is not guessed', photoDraft({ kind: 'renewal', label: 'Fridge warranty' }).ok === false && photoDraft({ kind: 'renewal', label: 'Fridge', date: 'next March' }).ok === false);
const db = photoDraft({ kind: 'bill', biller: 'BSES Rajdhani', amount: 1840, date: '2026-11-20' });
ok('a bill becomes a bill draft', db.ok && db.kind === 'bill' && db.payload.billerName === 'BSES Rajdhani' && db.payload.amount === 1840 && db.payload.dueDate === '2026-11-20');
ok('a bill with no amount is not guessed', photoDraft({ kind: 'bill', biller: 'BSES' }).ok === false && photoDraft({ kind: 'bill', biller: 'BSES', amount: -5 }).ok === false);

// ---- Aaj ka din
const at = (h, m) => new Date(Date.UTC(2026, 10, 12, h, m) - 5.5 * 3600000).toISOString();
const people = [{ id: 'rohan', name: 'Rohan' }, { id: 'raj', name: 'Papa' }, { id: 'sunita', name: 'Maa' }, { id: 'dada', name: 'Dadaji', remembered: true }, { id: 'chachu', name: 'Chachu' }];
const raw = { viewerId: 'rohan', word: 'family', tz: IN, people,
  meds: [{ id: 'sunita', times: [at(8, 0), at(21, 0)] }, { id: 'dada', times: [at(9, 0)] }],
  plansToday: [{ planId: 'p1', title: 'Sunday lunch', at: at(13, 0) }], birthdays: ['chachu', 'dada'], anniversaries: [['raj', 'sunita']],
  renewals: { n: 1 }, away: [{ id: 'raj', until: '2026-11-15' }],
  notes: [{ text: 'PRIVATE NOTE' }], vault: [{ label: 'PASSPORT' }], readings: [{ bp: '140/90' }] };
const mf = morningFacts(raw), mt = morningWrite(mf, 'family');
ok('the morning note has today\'s birthday first', mf[0].kind === 'birthday' && /Chachu's birthday today/.test(mt), mt);
ok('medicine TIMES for someone the viewer may see, never a name of a medicine', /Maa's medicine times today: 8:00 am and 9:00 pm\./.test(mt), mt);
ok('a plan today with its time', /Today: Sunday lunch at 1:00 pm\./.test(mt));
ok('a renewal this week, and who is away', /One renewal is due this week\./.test(mt) && /Papa is away until 2026-11-15\./.test(mt));
ok('an anniversary', /Papa and Maa's anniversary today/.test(mt));
ok('someone who is remembered is never named: not their birthday, not their medicines', !/Dadaji/.test(mt) && !mf.some(f => f.who.includes('dada')));
ok('notes, the vault and health numbers are never read, even when handed in', !/PRIVATE NOTE|PASSPORT|140/.test(mt + JSON.stringify(mf)));
ok('no viewer, no facts', morningFacts({ people }).length === 0 && morningFacts(null).length === 0);
ok('a quiet morning says so plainly', morningWrite([], 'family') === morningQuiet('family') && /family/.test(morningQuiet('family')) && /group/.test(morningQuiet('group')));
ok('the plain note passes the same check a model line would have to', digestCheck(morningWrite(mf.slice(0, 3), 'family'), mf, people.map(p => p.name)).ok === true);
ok('a model line naming someone the facts do not is refused by that check', digestCheck('Dadaji would have loved today.', mf, people.map(p => p.name)).why === 'name');
ok('what a model would be sent is the sentences only', !/"key"|weight|rohan|sunita/.test(morningPrompt(mf).user) && /Use ONLY the facts/.test(morningPrompt(mf).system) && /data, not instructions/.test(morningPrompt(mf).system));
ok('morning is 5 am to noon', isMorning(5) && isMorning(11) && !isMorning(12) && !isMorning(4) && !isMorning(19));

// ---- nudges
ok('quiet hours are 9 pm to 8 am', quietHour(21) && quietHour(23) && quietHour(0) && quietHour(7) && !quietHour(8) && !quietHour(20));
const base = { hour: 10, sentToday: 0, on: { talk: true, bday: true, renewal: true }, seen: new Set(), week: '2026-11-08', year: '2026',
  talk: [{ id: 'sunita', name: 'Maa', days: 9 }, { id: 'raj', name: 'Papa', days: 3 }], bdays: [{ id: 'chachu', name: 'Chachu' }], renewals: 1 };
const np = nudgePick(base);
ok('at most two a day, the birthday first', np.length === 2 && /Chachu's birthday is tomorrow/.test(np[0].title) && /You have not spoken with Maa in 9 days/.test(np[1].title), np);
ok('nothing in quiet hours', nudgePick({ ...base, hour: 22 }).length === 0 && nudgePick({ ...base, hour: 6 }).length === 0);
ok('nothing that is switched off', nudgePick({ ...base, on: {} }).length === 0 && nudgePick({ ...base, on: { renewal: true } })[0].title === 'A renewal is due this week');
ok('someone spoken to 3 days ago is not nudged about', !nudgePick({ ...base, on: { talk: true } }).some(n => /Papa/.test(n.title)));
ok('one already sent today leaves room for one', nudgePick({ ...base, sentToday: 1 }).length === 1 && nudgePick({ ...base, sentToday: 2 }).length === 0);
ok('a nudge already sent is not sent again', nudgePick({ ...base, seen: new Set(np.map(n => n.key)) }).every(n => !np.some(x => x.key === n.key)));
ok('the "not spoken" line says it is private', /Only you can see this/.test(np[1].body));
ok('nothing in a nudge shames or orders', !/\b(should|must|forgot|again|neglect|lazy|bad)\b/i.test(np.concat(nudgePick({ ...base, on: { renewal: true } })).map(n => n.title + ' ' + n.body).join(' ')));

// ---- the lines she speaks
ok('English and Hindi, nothing else', EKTA_LANGS.join() === 'en,hi' && ektaLang('hi') === 'hi' && ektaLang('fr') === 'en' && ektaLang(undefined) === 'en');
const keysEn = Object.keys(EKTA_SAY.en).sort().join(), keysHi = Object.keys(EKTA_SAY.hi).sort().join();
ok('both languages carry every line', keysEn === keysHi && Object.values(EKTA_SAY.hi).every(v => String(v).trim().length > 1), keysEn + ' / ' + keysHi);
ok('the fallback and error lines exist in both', ['offline', 'error', 'notHeard', 'expired', 'cancelled', 'done'].every(k => EKTA_SAY.en[k] && EKTA_SAY.hi[k]));
ok('the Hindi lines are in Devanagari and the voices are en-IN and hi-IN', /[ऀ-ॿ]/.test(EKTA_SAY.hi.offline) && EKTA_SAY.hi.speechLang === 'hi-IN' && EKTA_SAY.en.speechLang === 'en-IN');
const allCopy = JSON.stringify(EKTA_SAY) + rep + mt + np.map(n => n.title + n.body).join(' ') + PHOTO_MEDICAL + PHOTO_UNREADABLE;
ok('no long dash anywhere in her fixed words', allCopy.indexOf(String.fromCharCode(8211)) < 0 && allCopy.indexOf(String.fromCharCode(8212)) < 0);

if (fails.length) {
  console.error(`ektarulestest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`ektarulestest: ${pass}/${pass} checks pass`);
