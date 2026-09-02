// Ekta with no credit. api/_ektalocal.mjs imports nothing, so the deploy
// gate runs this on a fresh clone before npm install.
//
// The bug this exists to prevent: the Anthropic key ran out of credit, every
// tier of the cascade returned the same account-level refusal, the driver
// threw, and the assistant screen died. A family must never be shown a
// crash where an answer was possible, and the validation guide's fourth
// screen - "taking Mum to a new doctor tomorrow, what do we have?" - is a
// retrieval question that needs no model at all.
import { LOCAL_MODEL, isBillingFailure, isAuthFailure, isDeadKey, classify, whoIsAsked,
         renderSummary, renderMemory, renderCircle, offlineNote, cannotAnswer, stalePhrase }
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
ok('and it says what she CAN still do', /what do we have for Papa/.test(no) && /who checked in today/.test(no));

ok('the offline model is named so the client can tell', LOCAL_MODEL === 'parwah-local');
ok('a never-checked fact says so', /never checked/.test(stalePhrase(null, false)));

if (fails.length) {
  console.error(`ektatest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`ektatest: ${pass}/${pass} checks pass`);
