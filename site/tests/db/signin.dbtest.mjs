// SIGN-IN AGAINST A REAL DATABASE: the real api/auth.mjs handler, the real
// schema, the real SQL, on a throwaway PostgreSQL.
//
// What it proves, beyond what the unit tests can:
//   - a 4-number PIN and a password both sign up and sign in;
//   - an old 6-digit PIN signs in once, then no session is issued until a
//     new PIN or password is chosen, and after that only the new one works;
//   - an already signed-in device learns it must choose, and only with its
//     session token;
//   - 5 wrong tries lock that mobile number for 15 minutes, a right answer
//     does not get through the lock, another number is not affected, and
//     guesses sent all at once cannot slip past the count;
//   - nothing is ever stored as typed.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@/parwah_test?host=/var/run/postgresql \
//     npm run test:db
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('signin.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped. See the note at the top of this file.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test(\?|$)/.test(new URL(url).pathname + (new URL(url).search ? '?' : ''))) {
  console.error('signin.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: auth } = await import('../../../api/auth.mjs');
const { hashPin, SECRET_V, LOCK_MINUTES } = await import('../../../api/_auth.mjs');

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };

let ipn = 0;
async function call(body, { token, ip } = {}) {
  const req = { method: 'POST', body, headers: { 'x-forwarded-for': ip || ('10.0.0.' + (++ipn % 250)) } };
  if (token) req.headers['x-parwah-token'] = token;
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await auth(req, res);
  return { status, ...json };
}
const enter = (phone, extra = {}, opts) => call({ action: 'enter', phone, cc: '+91', ...extra }, opts);
const row = async phone => (await admin.query('select * from users where phone = $1', ['+91' + phone])).rows[0];

// ---- a new person, with a 4-number PIN
{
  let r = await enter('9810000001', { name: 'Asha', pin: '12' });
  ok('a 2-number PIN is refused at sign-up', r.needPin && /4 to 6 numbers/.test(r.error || ''), JSON.stringify(r));
  r = await enter('9810000001', { name: 'Asha', pin: '1234' });
  ok('an obvious 4-number PIN is refused', r.needPin && /pick another/.test(r.error || ''));
  r = await enter('9810000001', { name: 'Asha', pin: '4819' });
  ok('a 4-number PIN signs up and gets a session', r.ok && !!r.token, JSON.stringify(r));
  const u = await row('9810000001');
  ok('it is marked as chosen under the new rules', u && u.secret_v === SECRET_V);
  ok('and stored hashed, never as typed', u && u.pin_hash && u.pin_hash !== '4819' && u.pin_hash.length === 64);
  r = await enter('9810000001', { pin: '4819' });
  ok('the 4-number PIN signs in', r.ok && !!r.token && !r.changeSecret);
}

// ---- a new person, with a password
{
  let r = await enter('9810000002', { name: 'Vikram', pin: 'familyfirst' });
  ok('a password of only letters is refused', r.needPin && /Mix letters/.test(r.error || ''));
  r = await enter('9810000002', { name: 'Vikram', pin: 'Ghar@Sukh7' });
  ok('a password signs up', r.ok && !!r.token);
  r = await enter('9810000002', { pin: 'Ghar@Sukh7' });
  ok('and signs in', r.ok && !!r.token);
  r = await enter('9810000002', { pin: 'ghar@Sukh7' });
  ok('a password is exact: one wrong letter is a wrong try', r.status === 401 && r.wrongPin);
}

// ---- an old account with a 6-digit PIN
{
  const h = hashPin('481920');
  await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at)
                     values ('+919810000003', '+91', '9810000003', 'Papa', $1, $2, now())`, [h.hash, h.salt]);
  let r = await enter('9810000003');
  ok('an old account is asked for its PIN', r.ok && r.needPin && !r.token);
  ok('and is never told whose number it is before the PIN', !('name' in r) && !JSON.stringify(r).includes('"user"'), JSON.stringify(r));
  r = await enter('9810000003', { pin: '481921' });
  ok('a wrong old PIN is a wrong try, as always', r.status === 401 && r.wrongPin);
  r = await enter('9810000003', { pin: '481920' });
  ok('the right old 6-digit PIN is accepted once', r.ok && r.changeSecret);
  ok('but no session is issued until a new one is chosen', !r.token);
  r = await enter('9810000003', { pin: '481920', newPin: '12' });
  ok('the new choice must follow the new rules', r.changeSecret && /4 to 6 numbers/.test(r.error || '') && !r.token);
  r = await enter('9810000003', { pin: '481999', newPin: '4829' });
  ok('the change cannot be made without the old PIN', r.status === 401 && !r.token);
  r = await enter('9810000003', { pin: '481920', newPin: '4829' });
  ok('with the old PIN and a good new one, they are in', r.ok && !!r.token && !r.changeSecret, JSON.stringify(r));
  const u = (await row('9810000003')) || {};
  ok('the account is now under the new rules', u.secret_v === SECRET_V);
  r = await enter('9810000003', { pin: '4829' });
  ok('the new PIN signs in, and is not asked to change again', r.ok && !!r.token && !r.changeSecret);
  r = await enter('9810000003', { pin: '481920' });
  ok('the old PIN no longer works', r.status === 401);
}

// ---- already signed in on a phone, with an old PIN: the first open asks
{
  const h = hashPin('551907');
  await admin.query(`insert into users (phone, phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at)
                     values ('+919810000004', '+91', '9810000004', 'Mummy', $1, $2, now())`, [h.hash, h.salt]);
  const uid = (await row('9810000004')).id;
  const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
  const tok = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(tok), uid]);
  let r = await enter('9810000004', { refresh: true }, { token: tok });
  ok('opening the app signed in: the refresh says who this is', r.ok && r.user && r.user.id === uid, JSON.stringify(r));
  ok('and that a new PIN or password must be chosen', r.changeSecret === true);
  r = await enter('9810000004', { refresh: true });
  ok('without the session token, a refresh reveals nothing', !r.user && !r.circles && !r.token);
  r = await enter('9810000004', { refresh: true }, { token: newToken() });
  ok('nor with someone else’s made-up token', !r.user && !r.circles);
  r = await enter('9810000002', { refresh: true }, { token: tok });
  ok('nor with a real token for a different number', !r.user && !r.circles);
  r = await enter('9810000001', { refresh: true }, { token: (await enter('9810000001', { pin: '4819' })).token });
  ok('an account already under the new rules is not asked', r.ok && r.user && r.changeSecret === false);
}

// ---- 5 wrong tries lock the number for 15 minutes
{
  await enter('9810000005', { name: 'Neha', pin: '7391' });
  const lefts = [];
  for (let i = 0; i < 4; i++) {
    const r = await enter('9810000005', { pin: '0000' });
    lefts.push(r.status === 401 ? r.left : 'status ' + r.status);
  }
  ok('each wrong try says how many are left', lefts.join() === '4,3,2,1', lefts.join());
  let r = await enter('9810000005', { pin: '0000' });
  ok('the 5th wrong try locks the number', r.status === 429 && r.locked);
  ok('and says how long, and the way out', /Try again in 15 minutes/.test(r.error || '') && /family/.test(r.error || ''), r.error);
  const u = (await row('9810000005')) || {};
  const mins = (new Date(u.locked_until || 0) - Date.now()) / 60000;
  ok('for 15 minutes', LOCK_MINUTES === 15 && mins > 14 && mins <= 15.1, mins.toFixed(2));
  r = await enter('9810000005', { pin: '7391' });
  ok('while locked, even the right PIN does not get in', r.status === 429 && !r.token);
  r = await enter('9810000001', { pin: '4819' });
  ok('another mobile number is not affected', r.ok && !!r.token);
  await admin.query(`update users set locked_until = now() - interval '1 second' where phone = '+919810000005'`);
  r = await enter('9810000005', { pin: '7391' });
  ok('after the 15 minutes, the right PIN gets in', r.ok && !!r.token);
  ok('and the count starts again', ((await row('9810000005')) || {}).pin_tries === 0);
}

// ---- guesses sent all at once are all counted
{
  await enter('9810000006', { name: 'Kabir', pin: '2851' });
  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => enter('9810000006', { pin: String(1000 + i * 7) })));
  const got = burst.filter(r => r.token).length;
  const wrong = burst.filter(r => r.status === 401).length;
  const locked = burst.filter(r => r.status === 429).length;
  ok('8 guesses at once: none gets in', got === 0);
  ok('no more than 4 are answered as ordinary wrong tries', wrong <= 4, `${wrong} wrong, ${locked} locked`);
  const u = (await row('9810000006')) || {};
  ok('and the number ends up locked', !!u.locked_until && new Date(u.locked_until) > new Date());
}

// ---- nothing stored as typed, anywhere
{
  const typed = ['4819', 'Ghar@Sukh7', '481920', '4829', '551907', '7391', '2851'];
  const all = (await admin.query('select pin_hash, pin_salt from users')).rows;
  const leak = all.filter(u => typed.some(t => (u.pin_hash || '').includes(t) && (u.pin_hash || '').length < 64));
  ok('every stored secret is a 64-character hash with its own salt',
     all.every(u => !u.pin_hash || (u.pin_hash.length === 64 && u.pin_salt && u.pin_salt.length >= 32)) && !leak.length);
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) {
  console.error(`signin.dbtest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`signin.dbtest: ${pass}/${pass} checks pass`);
