// SIGN-IN, as pure logic. api/_auth.mjs imports only node:crypto, which is
// built into the runtime, so the deploy gate runs this on a fresh clone.
//
// What this exists to prevent: a phone number was the whole key. Type one
// that exists and you were in, as that person, with their family's vault.
// There was no second factor and no session - every later request proved
// who it was by sending a member UUID the server hands to everyone in the
// circle.
import { pinError, hashPin, verifyPin, newToken, tokenHash,
         looksLikeToken, MAX_TRIES, LOCK_MINUTES, lockMessage, SESSION_DAYS,
         PIN_LEN, SECRET_V }
  from '../../api/_auth.mjs';

let pass = 0; const fails = [];
const ok = (name, cond) => cond ? pass++ : fails.push(name);

// ---- the PIN a person is allowed to choose: exactly 4 numbers, nothing else
ok('the rule is exactly 4 numbers', PIN_LEN === 4);
ok('a 4-number PIN is accepted', pinError('4819') === null);
ok('a PIN may start with 0', pinError('0481') === null);
ok('3 numbers is too short', /exactly 4 numbers/.test(pinError('481')));
ok('5 numbers is refused', /exactly 4 numbers/.test(pinError('48192')));
ok('6 numbers is refused, as the old rule allowed', /exactly 4 numbers/.test(pinError('481920')));
ok('the refusal counts what was typed', /typed 3\b/.test(pinError('481')) && /typed 6\b/.test(pinError('481920')));
ok('a password is no longer a choice', /numbers only/.test(pinError('ghar4family')) && /numbers only/.test(pinError('Ghar@Sukh7')));
ok('letters mixed into 4 characters are refused', pinError('48a9') !== null);
ok('spaces are not numbers', pinError('48 9') !== null && pinError(' 4819') !== null);
ok('Devanagari digits are not accepted as a PIN', pinError('\u0968\u096E\u0967\u096F') !== null);
ok('an empty choice is refused, and says what to do', /PIN of 4 numbers/.test(pinError('')) && pinError(null) !== null && pinError(undefined) !== null);
// The handful a thief tries first cost nothing to block.
for (const weak of ['1234', '0000', '1111', '4321', '2580', '7777', '1212', '2020', '6969'])
  ok(`the obvious PIN ${weak} is refused`, /pick another/.test(pinError(weak) || ''));
ok('every repeated number is refused', ['2222', '3333', '5555', '9999'].every(p => pinError(p) !== null));
ok('a 4-number run forwards is refused', pinError('3456') !== null && pinError('6789') !== null);
ok('a run backwards is refused', pinError('8765') !== null && pinError('5432') !== null);
ok('a near-run is still allowed', pinError('4568') === null && pinError('7392') === null);
ok('no copy uses an em or en dash', !/[\u2013\u2014]/.test(
  ['', '48', '48192', 'abc', 'Ghar@Sukh7', '1234', '3456'].map(pinError).join(' ') + lockMessage(new Date(Date.now() + 60000))));
ok('PINs chosen under this rule are marked, so older secrets can be told apart', SECRET_V >= 3);

// ---- storing it
{
  // A password is stored exactly as a PIN is.
  const hp = hashPin('Ghar@Sukh7');
  ok('a password is hashed, not stored', hp.hash.length === 64 && !hp.hash.includes('Ghar'));
  ok('the same password verifies, a near miss does not', verifyPin('Ghar@Sukh7', hp.salt, hp.hash) && !verifyPin('ghar@Sukh7', hp.salt, hp.hash));
  const h = hashPin('481920');
  ok('a PIN is salted', !!h.salt && h.salt.length >= 16);
  ok('and hashed, not stored', h.hash.length === 64 && h.hash !== '481920');
  ok('the same PIN verifies', verifyPin('481920', h.salt, h.hash));
  ok('a wrong PIN does not', !verifyPin('481921', h.salt, h.hash));
  ok('an empty PIN does not', !verifyPin('', h.salt, h.hash));
  // Two people with the same PIN must not share a hash, or one leak is two.
  const h2 = hashPin('481920');
  ok('two people with one PIN get different hashes', h2.hash !== h.hash && h2.salt !== h.salt);
  ok('a missing salt or hash never verifies',
     !verifyPin('481920', null, h.hash) && !verifyPin('481920', h.salt, null));
  ok('a hash of the wrong length does not throw', verifyPin('481920', h.salt, 'ab') === false);
}

// ---- the session
{
  const a = newToken(), b = newToken();
  ok('a token is long enough to be unguessable', a.length >= 40);
  ok('two tokens differ', a !== b);
  ok('a token is url-safe', /^[A-Za-z0-9_-]+$/.test(a));
  ok('a token is recognised', looksLikeToken(a));
  ok('rubbish is not', !looksLikeToken('') && !looksLikeToken('abc') && !looksLikeToken(null));
  ok('only the hash would be stored', tokenHash(a).length === 64 && tokenHash(a) !== a);
  ok('the same token hashes the same way', tokenHash(a) === tokenHash(a));
  ok('different tokens hash differently', tokenHash(a) !== tokenHash(b));
  ok('a session does not last for ever', SESSION_DAYS > 0 && SESSION_DAYS <= 180);
}

// ---- the lockout
ok('five tries, not fifty', MAX_TRIES >= 3 && MAX_TRIES <= 10);
ok('and a wait afterwards', LOCK_MINUTES >= 5);
{
  const msg = lockMessage(new Date(Date.now() + 9 * 60000).toISOString());
  ok('the lock says how long', /\d+ minutes?/.test(msg));
  ok('and offers the way out that exists here', /family/i.test(msg));
  ok('one minute is not "1 minutes"', /1 minute\b/.test(lockMessage(new Date(Date.now() + 30000).toISOString())));
}

if (fails.length) {
  console.error(`authtest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`authtest: ${pass}/${pass} checks pass`);
