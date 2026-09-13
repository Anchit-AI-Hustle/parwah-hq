// SIGN-IN, as pure logic. api/_auth.mjs imports only node:crypto, which is
// built into the runtime, so the deploy gate runs this on a fresh clone.
//
// What this exists to prevent: a phone number was the whole key. Type one
// that exists and you were in, as that person, with their family's vault.
// There was no second factor and no session - every later request proved
// who it was by sending a member UUID the server hands to everyone in the
// circle.
import { PIN_LEN, pinError, hashPin, verifyPin, newToken, tokenHash,
         looksLikeToken, MAX_TRIES, LOCK_MINUTES, lockMessage, SESSION_DAYS }
  from '../../api/_auth.mjs';

let pass = 0; const fails = [];
const ok = (name, cond) => cond ? pass++ : fails.push(name);

// ---- the PIN a person is allowed to choose
ok('a good PIN is accepted', pinError('481920') === null);
ok('six numbers is the rule', PIN_LEN === 6 && pinError('48192') !== null && pinError('4819201') !== null);
ok('letters are refused', pinError('48a920') !== null);
ok('an empty PIN is refused', pinError('') !== null && pinError(null) !== null && pinError(undefined) !== null);
// The handful a thief tries first cost nothing to block.
for (const weak of ['123456', '000000', '111111', '654321', '121212'])
  ok(`the obvious PIN ${weak} is refused`, pinError(weak) !== null);
ok('a run forwards is refused', pinError('456789') !== null);
ok('a run backwards is refused', pinError('987654') !== null);
ok('a near-run is still allowed', pinError('456780') === null);
ok('the refusal says what to do', /pick another|6 numbers/i.test(pinError('123456')));

// ---- storing it
{
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
