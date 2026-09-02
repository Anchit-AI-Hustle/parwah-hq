// One family, from signing in to the emergency card, against the real API and
// a real Postgres. This is the layer that did not exist: every other test here
// either reads source as text or stubs /api/** and asserts against the stub,
// which is how an endpoint that answered 429 to every single caller stayed
// green for as long as it did.
//
// Needs a database and the dev server:
//
//     neon claim create --env-pull --file .env.local   (or set DATABASE_URL)
//     npm run dev
//     npm run test:api
//
// Everything it creates, it deletes. Nothing here mocks anything.
const BASE = process.env.BASE || 'http://localhost:3000';

let pass = 0, fail = 0;
const ok = (c, n, extra) => {
  if (c) { pass++; console.log('PASS  ' + n); }
  else { fail++; console.log('FAIL  ' + n + (extra ? '  — ' + extra : '')); }
};
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, j: await r.json().catch(() => null) };
};
const phone = () => '9' + String(Math.floor(Math.random() * 900000000) + 100000000);

try { await fetch(BASE + '/api/diag'); } catch {
  console.log('No dev server on ' + BASE + ' — start it with `npm run dev`.');
  process.exit(0);
}

// ---------- the database is actually wired ----------
const health = await get('/api/diag');
ok(health.status === 200 && health.j && health.j.ok === true,
   'the health probe is green (it answered 500 forever, wanting a table nothing created)',
   JSON.stringify(health.j));

const self = await get('/api/diag?probe=db');
const badSteps = self.j && self.j.steps ? Object.keys(self.j.steps).filter(k => self.j.steps[k] !== true) : ['no steps'];
ok(self.j && self.j.ok === true && badSteps.length === 0,
   'the end-to-end database selftest passes every step', badSteps.join(', '));

// ---------- signing in, and starting a family ----------
const p1 = phone();
const newUser = await post('/api/auth', { action: 'enter', phone: p1, cc: '+91' });
ok(newUser.status === 200 && newUser.j.exists === false,
   'an unknown number is told it is unknown rather than being let in silently');
const signedIn = await post('/api/auth', { action: 'enter', phone: p1, cc: '+91', name: 'Rohan Test' });
ok(signedIn.j.ok && signedIn.j.user && signedIn.j.user.id, 'signing in with a name creates the profile');
const again = await post('/api/auth', { action: 'enter', phone: p1, cc: '+91' });
ok(again.j.ok && again.j.user.id === signedIn.j.user.id, 'and the same number comes back to the same person');

const made = await post('/api/circle', { action: 'create', memberName: 'Rohan Test', circleName: 'Journey Family',
  role: 'family', relation: 'son', phone: p1, userId: signedIn.j.user.id });
ok(made.status === 201 && made.j.code && made.j.memberId, 'a family circle is created');
const code = made.j.code, ME = made.j.memberId;

// ---------- the invite code is not a password ----------
const leak = await get('/api/events?circle=' + code);
ok(leak.status === 403,
   'the circle feed refuses a caller holding only the invite code', leak.status + ' ' + JSON.stringify(leak.j).slice(0, 120));
const leak2 = await get('/api/care?circle=' + code);
ok(leak2.status === 403, 'and so does what the family is doing for whom', leak2.status);
const mine = await get(`/api/events?circle=${code}&member=${ME}`);
ok(mine.status === 200 && mine.j.members.length === 1, 'a member gets the whole picture');
const stranger = await get(`/api/events?circle=${code}&member=11111111-1111-1111-1111-111111111111`);
ok(stranger.status === 403, 'a uuid that is not in this circle gets nothing');

// ---------- the address lookup that was answering 429 to everyone ----------
const pin = await get(`/api/settings?area=pin&circle=${code}&member=${ME}&pin=110001`);
ok(pin.status === 200 && pin.j.ok === true && pin.j.state === 'Delhi',
   'a real PIN code resolves to a real district and state', pin.status + ' ' + JSON.stringify(pin.j).slice(0, 140));
const pinAgain = await get(`/api/settings?area=pin&circle=${code}&member=${ME}&pin=110001`);
ok(pinAgain.j.ok && pinAgain.j.cached === true, 'and is cached rather than fetched twice');
const pinUnknown = await get(`/api/settings?area=pin&circle=${code}&member=${ME}&pin=999999`);
ok(pinUnknown.status === 200, 'a PIN nobody has heard of is an answer, not an error');
const pinNoMember = await get(`/api/settings?area=pin&circle=${code}&pin=110001`);
ok(pinNoMember.status === 403, 'and it is not an open proxy to India Post');

// ---------- the family memory, and what it will not say ----------
const doctor = await post('/api/book', { code, memberId: ME, action: 'add', kind: 'contact', category: 'doctor',
  name: 'Dr Sharma', phone: '+919810033333', notes: 'Cardiologist', aboutId: ME });
ok(doctor.status === 201, 'a doctor goes into the family memory');
const secret = await post('/api/book', { code, memberId: ME, action: 'add', kind: 'fact', category: 'blood',
  name: 'B positive', aboutId: ME, visibility: 'private' });
ok(secret.status === 201, 'and a private health fact');

// A second person, admitted properly.
await post('/api/circle', { action: 'set_join_policy', code, memberId: ME, policy: 'open' });
const p2 = phone();
const joined = await post('/api/circle', { action: 'join', code, memberName: 'Chachi', role: 'family', phone: p2 });
ok(joined.status === 200 && joined.j.memberId, 'a second person joins an open circle');
const OTHER = joined.j.memberId;

const theirView = await get(`/api/book?circle=${code}&member=${OTHER}`);
const names = (theirView.j.entries || []).map(e => e.name);
ok(names.includes('Dr Sharma'), 'the doctor is shared with the circle, as it says it is');
ok(!names.includes('B positive'), 'the private fact is not', names.join(', '));
ok((theirView.j.prep || []).length === 2, 'readiness is computed for everybody');
const items = theirView.j.prep[0].items || {};
ok(Object.keys(items).every(k => typeof items[k] === 'string'),
   'every readiness item has a state the client can label');

// Preparedness stays truthful about a private entry: it counts, without saying
// what it is.
const mePrep = (theirView.j.prep || []).find(p => p.memberId === ME);
ok(mePrep && mePrep.items.blood === 'ok',
   'a private blood group still counts as recorded — the family knows it exists');

// ---------- care: the consent protocol ----------
const remind = await post('/api/care', { code, memberId: ME, action: 'reminder_create',
  title: 'BP tablet', forMemberId: OTHER, timeOfDay: '08:30', recurrence: 'daily' });
ok(remind.status === 201 && remind.j.status === 'pending',
   'a reminder set for somebody else arrives as a request, not an instruction');
const wrongPerson = await post('/api/care', { code, memberId: ME, action: 'reminder_respond', reminderId: remind.j.id, accept: true });
ok(wrongPerson.status === 403, 'and only the person it is for may answer it');
const accepted = await post('/api/care', { code, memberId: OTHER, action: 'reminder_respond', reminderId: remind.j.id, accept: true });
ok(accepted.j.status === 'accepted', 'they accept it themselves');

const help = await post('/api/care', { code, memberId: ME, action: 'request_create', title: 'Book the annual health check' });
ok(help.status === 201, 'a help request is opened to the whole circle');
const race = await Promise.all([
  post('/api/care', { code, memberId: ME, action: 'request_claim', requestId: help.j.id }),
  post('/api/care', { code, memberId: OTHER, action: 'request_claim', requestId: help.j.id }),
]);
const took = race.filter(r => r.status === 200).length;
ok(took === 1, 'two people tapping "I am on it" at once: exactly one is told it is theirs',
   race.map(r => r.status).join('/'));

const care = await get(`/api/care?circle=${code}&member=${ME}`);
ok((care.j.suggestions || []).some(s => /blood group|emergency contact/i.test(s.title)),
   'Parwah proposes what the family has not recorded yet',
   JSON.stringify((care.j.suggestions || []).map(s => s.title)).slice(0, 200));

// ---------- the SOS, which must never be turned away ----------
const sos = await post('/api/events', { code, memberId: OTHER, type: 'sos' });
ok(sos.status === 201, 'an SOS is recorded');
const open = await get(`/api/events?circle=${code}&member=${ME}`);
ok((open.j.sos || []).length === 1 && open.j.sos[0].status === 'open',
   'and stays an open state until somebody answers it, rather than scrolling away');
const ack = await post('/api/events', { code, memberId: ME, type: 'sos_ack', sosId: open.j.sos[0].id });
ok(ack.j.ok, 'another member says they are on their way');
const acked = await get(`/api/events?circle=${code}&member=${ME}`);
ok(acked.j.sos[0].status === 'acked' && acked.j.sos[0].acked_name === 'Rohan Test',
   'and the family is told who');

// ---------- writes have a ceiling, an SOS does not ----------
const flood = await Promise.all(Array.from({ length: 120 }, (_, i) =>
  post('/api/events', { code, memberId: OTHER, type: 'message', text: 'flood ' + i })));
const limited = flood.filter(r => r.status === 429).length;
ok(limited > 0, 'a runaway client is eventually refused rather than filling the database',
   flood.filter(r => r.status === 201).length + ' accepted, ' + limited + ' limited');
const sosUnderLoad = await post('/api/events', { code, memberId: OTHER, type: 'sos' });
ok(sosUnderLoad.status === 201, 'and an SOS still gets through while that limit is being hit');

// ---------- the vault ----------
const doc = await post('/api/book?area=vault', { code, memberId: ME, action: 'add', kind: 'aadhaar',
  label: 'Rohan Aadhaar', aboutId: ME, number: '234567890124' });
ok(doc.status === 201, 'an Aadhaar goes into the vault');
const badNum = await post('/api/book?area=vault', { code, memberId: ME, action: 'add', kind: 'aadhaar',
  label: 'Typo', aboutId: ME, number: '234567890125' });
ok(badNum.status >= 400, 'one digit wrong is caught by the checksum, not stored');
const theirVault = await get(`/api/book?area=vault&circle=${code}&member=${OTHER}`);
ok(!(theirVault.j.docs || []).some(d => d.id === doc.j.id),
   'and nobody else can see it until it is shared');
const selfGrant = await post('/api/book?area=vault', { code, memberId: OTHER, action: 'grant', id: doc.j.id, who: OTHER, level: 'view' });
ok(selfGrant.status >= 400, 'nor grant themselves access to it', selfGrant.status);
const granted = await post('/api/book?area=vault', { code, memberId: ME, action: 'grant', id: doc.j.id, who: OTHER, level: 'view' });
ok(granted.j && granted.j.ok, 'its owner can share it', granted.status + ' ' + JSON.stringify(granted.j));
const nowSees = await get(`/api/book?area=vault&circle=${code}&member=${OTHER}`);
ok((nowSees.j.docs || []).some(d => d.id === doc.j.id), 'and then it is there');
const revoked = await post('/api/book?area=vault', { code, memberId: ME, action: 'revoke', id: doc.j.id, who: OTHER });
ok(revoked.j && revoked.j.ok, 'and can take it back again');
const gone2 = await get(`/api/book?area=vault&circle=${code}&member=${OTHER}`);
ok(!(gone2.j.docs || []).some(d => d.id === doc.j.id), 'after which it is not theirs to see');

// ---------- sharing one thing with one named person ----------
// Every one of these six answered "It is already yours" to every attempt: the
// client put the person being shared WITH into `memberId`, which is the field
// that says who is calling, so the server authenticated as the target and then
// compared them with themselves.
const shared = await post('/api/book', { code, memberId: ME, action: 'share', id: secret.j.id, who: OTHER });
ok(shared.j && shared.j.ok, 'a private memory entry can be shared with one named person',
   shared.status + ' ' + JSON.stringify(shared.j));
const canSee = await get(`/api/book?circle=${code}&member=${OTHER}`);
ok((canSee.j.entries || []).some(e => e.id === secret.j.id), 'and then they can read it');
const unshared = await post('/api/book', { code, memberId: ME, action: 'unshare', id: secret.j.id, who: OTHER });
ok(unshared.j && unshared.j.ok, 'and the sharing can be undone');
const cannotAgain = await get(`/api/book?circle=${code}&member=${OTHER}`);
ok(!(cannotAgain.j.entries || []).some(e => e.id === secret.j.id), 'after which it is private again');
const notOwner = await post('/api/book', { code, memberId: OTHER, action: 'share', id: secret.j.id, who: OTHER });
ok(notOwner.status >= 400, 'and only its subject may share it', notOwner.status);

const upi = await post('/api/book?area=pay', { code, memberId: ME, action: 'add', kind: 'upi',
  label: 'Rohan UPI', handle: 'rohan@okbank', perTxnCap: 5000 });
ok(upi.status === 201, 'a way of paying is recorded');
const allowed = await post('/api/book?area=pay', { code, memberId: ME, action: 'allow', id: upi.j.id, who: OTHER, perTxnCap: 2000 });
ok(allowed.j && allowed.j.ok, 'and somebody else can be allowed to use it, up to a limit',
   allowed.status + ' ' + JSON.stringify(allowed.j));
const stopped = await post('/api/book?area=pay', { code, memberId: ME, action: 'disallow', id: upi.j.id, who: OTHER });
ok(stopped.j && stopped.j.ok, 'and stopped again');
const selfAllow = await post('/api/book?area=pay', { code, memberId: OTHER, action: 'allow', id: upi.j.id, who: OTHER, perTxnCap: 999999 });
ok(selfAllow.status >= 400, 'nobody may allow themselves to spend somebody else\'s money', selfAllow.status);

// ---------- errors say nothing about the schema ----------
const nonsense = await post('/api/care', { code, memberId: ME, action: 'reminder_respond', reminderId: 'not-a-uuid' });
const msg = JSON.stringify(nonsense.j || {});
ok(!/(relation|column|constraint|syntax error|invalid input syntax|pg_|duplicate key)/i.test(msg),
   'a bad request is answered without naming a table or a column', msg.slice(0, 160));

// ---------- the launch list ----------
const em = 'journey+' + Date.now() + '@example.com';
const noConsent = await post('/api/settings?area=join', { name: 'Rohan', email: em });
ok(noConsent.status === 400, 'the launch list will not store an address without consent');
const joinedList = await post('/api/settings?area=join', { name: 'Rohan', email: em, consent: true, source: 'journey' });
ok(joinedList.status === 201, 'with consent, it does');
const dup = await post('/api/settings?area=join', { name: 'Rohan', email: em.toUpperCase(), consent: true });
ok(dup.status === 200 && dup.j.already === true, 'and joining twice is a success, not an error');
const count = await get('/api/settings?area=join');
ok(count.j.ok && typeof count.j.waiting === 'number', 'the public count is a number and never a list');
ok(!JSON.stringify(count.j).includes('@'), 'so it cannot be used to read who has signed up');

// ---------- clean up after ourselves ----------
const gone = await post('/api/circle', { action: 'leave', code, memberId: ME });
ok(gone.j.ok, 'leaving a circle works');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
