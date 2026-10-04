// Ekta with no credit. api/_ektalocal.mjs imports nothing, so the deploy
// gate runs this on a fresh clone before npm install.
//
// The bug this exists to prevent: the Anthropic key ran out of credit, every
// tier of the cascade returned the same account-level refusal, the driver
// threw, and the assistant screen died. A family must never be shown a
// crash where an answer was possible, and the validation guide's fourth
// screen - "taking Mum to a new doctor tomorrow, what do we have?" - is a
// retrieval question that needs no model at all.
import { askedText, LOCAL_MODEL, isBillingFailure, isAuthFailure, isDeadKey, classify, whoIsAsked,
         renderSummary, renderMemory, renderCircle, offlineNote, cannotAnswer, stalePhrase,
         renderEmergency, renderCrisis, renderHealth, kinIsAsked, ABOUT_ME, renderWhoIsIt }
  from '../../api/_ektalocal.mjs';

let pass = 0; const fails = [];
const ok = (name, cond) => cond ? pass++ : fails.push(name);

// ---- a dead key is recognised, and separated from a passing storm
ok('no credit is recognised', isBillingFailure({ message: 'Your credit balance is too low to access the Anthropic API' }));
ok('an OpenAI quota refusal is recognised', isBillingFailure({ message: 'You exceeded your current quota' }));
ok('a 402 is recognised', isBillingFailure('Payment Required'));
ok('a rejected key is recognised', isAuthFailure({ status: 401, message: 'invalid x-api-key' }));
ok('an auth error type is recognised', isAuthFailure({ message: 'authentication_error' }));
ok('no credit and a bad key both stop the cascade', isDeadKey({ message: 'credit balance is too low' }) && isDeadKey({ status: 403 }));
// Overload and outage are the opposite case: those SHOULD keep cascading.
ok('an overloaded model keeps the cascade going', !isDeadKey({ status: 529, message: 'overloaded_error' }));
ok('a rate limit keeps the cascade going', !isDeadKey({ status: 429, message: 'rate_limit_error' }));
ok('a 500 keeps the cascade going', !isDeadKey({ status: 500, message: 'internal' }));

// ---- what was asked, decided without a model
ok('the doctor-visit question is a summary', classify('Taking Mum to a new doctor tomorrow. What do we have?') === 'summary');
ok('a hospital run is a summary', classify('we are going to the hospital, what should I carry') === 'summary');
ok('a medicines question reads the memory', classify('what medicines is papa on') === 'memory');
ok('a Hinglish medicines question reads the memory', classify('papa ki dawai kya hai') === 'memory');
ok('a blood group question reads the memory', classify('what is her blood group') === 'memory');
ok('a check-in question reads the circle', classify('who checked in today') === 'circle');
ok('a greeting is a greeting', classify('Namaste') === 'greet');
ok('an open-ended request is not pretended to be answerable', classify('write me a poem about the moon') === 'unknown');

ok('a named person is picked out', whoIsAsked('what do we have for Papa', ['Papa', 'Rohan', 'Beta']) === 'Papa');
ok('the longest matching name wins', whoIsAsked('ask Papa Kumar', ['Papa', 'Papa Kumar']) === 'Papa Kumar');
ok('no name means no name', whoIsAsked('who checked in', ['Papa', 'Rohan']) === null);
ok('a name that is not in the circle is not invented', whoIsAsked('what about Chachaji', ['Papa', 'Rohan']) === null);

// ---- the doctor-visit answer: what is there, and what is NOT
const S = {
  summary: { person: { name: 'Papa', relation: 'father' },
    bloodGroup: [{ what: 'B+', lastChecked: '2026-01-02T00:00:00Z', needsRecheck: true }],
    allergies: [], medicines: [{ what: 'Metformin', detail: '500mg morning', lastChecked: '2026-08-01T00:00:00Z', needsRecheck: false }],
    doctors: [], emergencyContacts: [], someoneNearThem: [], insurance: [], documents: [{ kind: 'insurance', label: 'Star Health', expires: '2027-03-31T00:00:00Z' }] },
  missing: ['allergies', 'doctors', 'emergencyContacts', 'someoneNearThem', 'insurance'] };
const sum = renderSummary(S);
ok('the summary reads back the recorded facts', /B\+/.test(sum) && /Metformin/.test(sum));
ok('the summary quotes when each was last checked', /checked 2026-01-02/.test(sum));
ok('the summary flags what is worth confirming', /worth confirming/.test(sum));
ok('the summary names the person', /Papa/.test(sum));
ok('a paper in the vault is listed with its expiry', /Star Health/.test(sum) && /expires 2027-03-31/.test(sum));
// What is missing is the half a hospital counter actually needs.
ok('the summary reads out what is NOT recorded', /Not recorded/.test(sum) && /Allergies/.test(sum) && /Doctors/.test(sum));
ok('the summary says plainly it is not medical advice', /not medical advice/i.test(sum));
ok('the summary never diagnoses or prescribes',
   !/(you should take|diagnos|recommend|prescrib|cure|treat|dosage|increase the dose)/i.test(sum));
const empty = renderSummary({ summary: { person: { name: 'Papa' }, bloodGroup: [], allergies: [], medicines: [], doctors: [], emergencyContacts: [], someoneNearThem: [], insurance: [], documents: [] }, missing: ['bloodGroup', 'medicines'] });
ok('an empty record says so rather than looking complete', /Nothing has been recorded/.test(empty));

// ---- family memory, read back as saved
const mem = renderMemory({ entries: [
  { kind: 'med', name: 'Metformin', forwhat: 'sugar', last_verified_at: '2026-08-01T00:00:00Z', stale: false },
  { kind: 'contact', name: 'Dr Rao', phone: '+91 98000 00000', last_verified_at: '2025-01-01T00:00:00Z', stale: true }
] }, 'Papa');
ok('memory lists what is recorded', /Metformin/.test(mem) && /Dr Rao/.test(mem));
ok('memory groups by what kind of thing it is', /Medicines/.test(mem) && /Contacts/.test(mem));
ok('memory marks a stale entry', /worth confirming/.test(mem));
ok('an empty memory points at where to add one', /Memory tab/.test(renderMemory({ entries: [] }, 'Papa')));

// ---- the circle, without a model
const cir = renderCircle({ circleName: 'Test Family', members: [{ name: 'Rohan' }, { name: 'Papa' }],
  recentEvents: [{ type: 'checkin', member_name: 'Papa', created_at: '2026-09-02T04:00:00Z' },
                 { type: 'sos', member_name: 'Papa', created_at: '2026-09-01T04:00:00Z' }],
  reminders: [{ title: 'BP tablet' }], requests: [] });
ok('the circle answer names the family', /Test Family/.test(cir) && /Rohan, Papa/.test(cir));
ok('a check-in is described in words, not a type name', /checked in/.test(cir) && !/"checkin"/.test(cir));
ok('an SOS is described in words', /raised an SOS/.test(cir));
ok('reminders are listed', /BP tablet/.test(cir));
ok('an empty circle says nothing has happened yet', /Nothing has been recorded/.test(renderCircle({ circleName: 'X', members: [], recentEvents: [] })));

// ---- honesty about the limit
ok('no credit is named as no credit', /no credit/.test(offlineNote('billing')));
ok('a broken key is named as a broken key', /not working/.test(offlineNote('auth')));
ok('no key at all is named as no key', /no AI key is set up/.test(offlineNote('none')));
ok('the note says where to fix it', /Ekta's brain/.test(offlineNote('billing')));
const no = cannotAnswer('billing');
ok('an unanswerable question is refused, not guessed at', /will not guess/.test(no));
ok('and it says what she CAN still do', /what do we have for Papa/.test(no) && /scam/.test(no));
ok('every example it offers is one she can really answer', [...no.matchAll(/"([^"]+)"/g)].every(m => classify(m[1]) !== 'unknown'));
ok('a refusal never claims it was read from the records', !/answered that straight from your family records/.test(no));
ok('a refusal still points at 112 and SOS', /112/.test(no) && /SOS/.test(no));
ok('out of coins is named as out of coins, with no key advice', /out of coins/.test(offlineNote('coins')) && !/Ekta's brain/.test(offlineNote('coins')));

// ---- SOMEONE MAY BE IN DANGER: before everything, in fixed words ----
for (const t of ['Papa has chest pain and is sweating, what do I do?', 'Mummy has fallen in the bathroom', 'Dadi behosh ho gayi',
                 'He is not breathing', 'Papa is having a stroke', 'Bhaiya met with an accident', 'Papa just had a heart attack',
                 'Hi, Papa collapsed', 'she swallowed poison'])
  ok('urgent: ' + t, classify(t) === 'emergency');
for (const t of ['Papa had a stroke in 2019, what medicines is he on?', 'He had a heart attack in 2019', 'I accidentally deleted a photo',
                 'Book a cardiac checkup for Papa', 'I fell asleep early'])
  ok('not urgent, so not alarmed: ' + t, classify(t) !== 'emergency');
for (const t of ['Papa passed out yesterday, what medicines is he on?', 'Mummy fell last year and broke her wrist', 'he had a seizure 3 years ago',
                 'Papa collapsed in 2021, what do we have for him'])
  ok('in the past, so not alarmed: ' + t, classify(t) !== 'emergency');
for (const t of ['Has Papa had chest pain in the last week?', 'Does Papa have a history of chest pain?', 'Papa has a history of seizures'])
  ok('a question about the past, even with "has", so not alarmed: ' + t, classify(t) !== 'emergency');
ok('a medicine question about someone with a three-word name is a medicine question', classify('Can Raj Kumar Singh take Crocin?') === 'health');
{
  const h = [{ role: 'user', content: 'Prepare a summary for a doctor visit.' }, { role: 'assistant', content: 'Who is the doctor visit for? Say their name as it is saved in the family: Raj.' }, { role: 'user', content: 'Raj' }];
  ok('a name given in answer to "whose visit" is read with the question', classify(askedText(h)) === 'summary' && /Raj$/.test(askedText(h)));
  ok('a new question after it is read on its own', askedText(h.slice(0, 2).concat([{ role: 'user', content: 'What is the OTP scam?' }])) === 'What is the OTP scam?');
}
for (const t of ['Papa fell yesterday and still can\'t get up', 'Dadi passed out last night and is not responding now',
                 'He had an accident last week and today he is breathless', 'He passed out yesterday and today he has chest pain',
                 'He had a cold last week and has chest pain', 'Papa had a fever yesterday, now he is not breathing properly',
                 'Mummy fell last year but she has fainted', 'Papa fell down yesterday, please help'])
  ok('in the past but happening now, so urgent: ' + t, classify(t) === 'emergency');
ok('words about ending a life reach a person', classify('I want to die') === 'crisis' && classify('main jeena nahi chahta') === 'crisis');
const em = renderEmergency();
ok('urgent: call 112, ambulance 108, press SOS', /112/.test(em) && /108/.test(em) && /SOS/.test(em));
ok('urgent: no first aid instructions, no diagnosis', !/\b(cpr|aspirin|press on|lie (him|her) down|give (him|her))\b/i.test(em) && /not a doctor/.test(em));
ok('crisis: Tele-MANAS 14416 and 112', /14416/.test(renderCrisis()) && /112/.test(renderCrisis()));
ok('urgent answers have no em dash', !em.includes('\u2014') && !renderCrisis().includes('\u2014'));

// ---- A MEDICINE QUESTION IS THE DOCTOR'S ----
ok('can she take X is a health question', classify('Can Papa take a Crocin with his BP tablet?') === 'health');
ok('should we stop is a health question', classify('Is Papa diabetic? Should we stop his sugar tablets?') === 'health');
ok('a dose question is a health question', classify('what dose of metformin is right') === 'health');
ok('a saved name, or "my father", asking about a medicine is a health question',
   classify('Can Raj take Crocin?') === 'health' && classify('Can my father take his BP tablet with Crocin?') === 'health');
ok('"can I take a day off" is not a medicine question', classify('Can I take a day off tomorrow?') !== 'health');
const hp = renderHealth({ entries: [{ kind: 'med', name: 'Amlodipine 5mg', forwhat: 'BP', last_verified_at: new Date().toISOString() },
                                     { kind: 'contact', name: 'Dr Mehra' }] }, 'Papa', { name: 'Dr Mehra', phone: '+91 98111 11111' });
ok('health: reads back what is recorded', /Amlodipine 5mg/.test(hp) && /Papa/.test(hp));
ok('health: never advises, sends to the doctor by name', /cannot advise on medicines/.test(hp) && /Dr Mehra/.test(hp) && /98111/.test(hp));
const fam = [{ name: 'Raj', relation: 'father' }, { name: 'Sunita', relation: 'mother' }, { name: 'Rohan', relation: 'son' }];
ok('"Papa" finds the one member saved as father', kinIsAsked('Can Papa take a Crocin?', fam).name === 'Raj');
ok('"Mummy" finds the one saved as mother', kinIsAsked('should mummy stop her BP tablet', fam).name === 'Sunita');
ok('a family word nobody is saved as is not guessed', kinIsAsked('can Dadi take this', fam).name === undefined && kinIsAsked('can Dadi take this', fam).word === 'Dadi');
ok('two fathers is not one', kinIsAsked('Can Papa take it', [...fam, { name: 'Vijay', relation: 'father' }]).name === undefined);
ok('"can I take" is about the asker', ABOUT_ME.test('Can I take a Crocin with my BP tablet?'));
ok('not sure who: asks, lists the names, and still sends to the doctor', /Who is this about/.test(renderWhoIsIt(['Raj', 'Sunita'])) && /Raj, Sunita/.test(renderWhoIsIt(['Raj', 'Sunita'])) && /doctor/.test(renderWhoIsIt([])));
ok('health: with no doctor recorded, says ask the doctor or a pharmacist', /pharmacist/.test(renderHealth({ entries: [] }, 'Papa', null)));

ok('the offline model is named so the client can tell', LOCAL_MODEL === 'parwah-local');
ok('a never-checked fact says so', /never checked/.test(stalePhrase(null, false)));


// ---- EVERY SUGGESTION CHIP HAS AN OFFLINE ANSWER ----
// The four chips under Ekta send fixed sentences. With no AI credit, three of
// them got the wrong answer: "Set a daily reminder" and "Please ask the circle
// for help" contain words the circle pattern matches, so both got a circle
// summary; "Is it a scam?" matched nothing and was refused. Read the chips
// from the app itself, so a chip added later is held to this too.
{
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const chips = [...html.matchAll(/data-chip="([^"]+)"/g)].map(m => m[1]);
  ok('the app offers suggestion chips', chips.length >= 4);
  for (const c of chips) ok('chip has an offline answer, not a refusal: ' + c.slice(0, 40), classify(c) !== 'unknown');
  const byText = t => chips.find(c => c.includes(t)) || '';
  ok('the saved-records chip reads the records', classify(byText('What do we have recorded')) === 'memory');
  ok('the doctor-visit chip prepares a summary', classify(byText('doctor visit')) === 'summary');
  ok('the scam chip is a scam check', classify(byText('OTP')) === 'scam');
  ok('the help chip asks the circle, not a summary', classify(byText('ask the family')) === 'help');
}
// ---- AND NOTHING THAT WAS RIGHT BEFORE MOVED ----
ok('a question about a reminder is still a circle question', classify('Is there a reminder for Papa\'s pills?') === 'circle');
ok('what is due is still a circle question', classify('what reminders are due today') === 'circle');
ok('a scam question that opens politely is still a scam question', classify('Hi, is this OTP message a scam?') === 'scam');
ok('a postal PIN code is not a scam', classify("what is papa's pin code") !== 'scam');
ok('a plain greeting is still a greeting', classify('Namaste') === 'greet');

// ---- THE SCAM ANSWER ----
// Checked for before use: calling a missing export crashed the suite, and
// a crash stops it before it reports which chips were answered wrongly.
const _lib = await import('../../api/_ektalocal.mjs');
ok('offline Ekta can answer a scam question at all', typeof _lib.renderScam === 'function');
ok('offline Ekta can say what it cannot do', typeof _lib.renderCannotDo === 'function');
if (typeof _lib.renderScam === 'function' && typeof _lib.renderCannotDo === 'function') {
  const { renderScam, renderCannotDo } = _lib;
  const otp = renderScam('I got a message asking for an OTP for a payment. Is it a scam?', 'billing');
  ok('an OTP request is called a scam plainly', /^Yes, treat it as a scam/.test(otp));
  ok('it gives the national cyber-crime helpline', otp.includes('1930'));
  ok('and the reporting site', otp.includes('cybercrime.gov.in'));
  ok('it never tells anyone to share a code with a caller', !/\b(share|give|tell) (it|the otp|your otp)\b/i.test(otp));
  // Couriers in India do ask for a delivery code at the door. Listing them
  // among those who never ask would be wrong, and a person who has just
  // handed one over would stop trusting everything else in the answer.
  ok('it does not contradict the one legitimate code, the delivery code',
     !/courier/i.test(otp) && /delivery code/i.test(otp));
  ok('it says it is standard advice, not something from the records', /not something from your records/.test(otp));
  ok('it does not claim to have read the family records', !/exactly what is saved/.test(otp));
  ok('a general scam question gets a softer opening', !/^Yes/.test(renderScam('how do I spot fraud', 'billing')));
  // ---- WHAT SHE CANNOT DO OFFLINE, SHE SAYS SO ----
  for (const kind of ['remind', 'help']) {
    const r = renderCannotDo(kind, 'billing');
    ok(kind + ': never claims to have done it', !/\b(i('| ha)ve (set|added|sent|posted|created)|done\b|all set)/i.test(r));
    ok(kind + ': says plainly that it will not pretend', /will not pretend/.test(r));
    ok(kind + ': points at the real form, by its real name', r.includes('Things to do') && r.includes('Add something to do'));
    ok(kind + ': no em dash', !r.includes('\u2014'));
  }
  ok('help: explains that "Anyone" reaches the whole circle', /Anyone/.test(renderCannotDo('help', 'billing')) && /I'm on it/.test(renderCannotDo('help', 'billing')));
  ok('scam answer: no em dash', !otp.includes('\u2014'));
}
if (fails.length) {
  console.error(`ektatest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`ektatest: ${pass}/${pass} checks pass`);
