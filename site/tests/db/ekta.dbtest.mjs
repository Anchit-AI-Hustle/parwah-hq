// EKTA'S SAFETY AGAINST A REAL DATABASE: the real api/ekta.mjs handler, the
// real coin ledger and family records, on a throwaway PostgreSQL, with no AI
// key anywhere - the way most families run her.
//
// What it proves:
//   - "Papa has chest pain" is answered at once with 112, 108 and SOS, and
//     never costs a coin, even with an empty pot;
//   - a medicine question reads back what is recorded and sends the family
//     to the doctor by name, never advising;
//   - with no coins, the scam check and the records still answer (they were
//     always free); only a conversation is refused, and the refusal says
//     how to earn more in ways every member can.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('ekta.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('ekta.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_WORKSPACE_ID', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
                 'XAI_API_KEY', 'GROK_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OLLAMA_URL']) delete process.env[k];

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: ekta } = await import('../../../api/ekta.mjs');
const { default: book } = await import('../../../api/book.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { ensureCoinSchema } = await import('../../../api/_coins.mjs');

const sql = db();
await ensureSchema(sql);
await ensureCoinSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };

let phoneN = 0;
async function person(circleId, name, role = 'family') {
  const phone = '+9198200' + String(++phoneN).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1, '+91', $2, $3) returning id`,
                               [phone, phone.slice(3), name])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id) values ($1, $2, $3, $4) returning id`,
                               [circleId, name, role, u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, name, token };
}
const fam = (await admin.query(`insert into circles (code, name) values ('EKTA01', 'Sharma Family') returning id`)).rows[0].id;
const rohan = await person(fam, 'Rohan');
// Papa is saved by his name, Raj, with the relation "father"; Mummy too.
const papa = await person(fam, 'Raj', 'parent');
const mummy = await person(fam, 'Sunita', 'parent');
await admin.query(`update members set relation = 'father' where id = $1`, [papa.id]);
await admin.query(`update members set relation = 'mother' where id = $1`, [mummy.id]);

async function call(handler, who, body) {
  const req = { method: 'POST', headers: { 'x-parwah-token': who.token, 'x-forwarded-for': '10.2.2.2' },
                body: { code: 'EKTA01', memberId: who.id, ...body }, query: {} };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  return { ...json, status };
}
const ask = (who, text) => call(ekta, who, { messages: [{ role: 'user', content: text }] });
const pot = async () => (await admin.query(`select coalesce(sum(delta),0)::int as n from coins where circle_id = $1`, [fam])).rows[0].n;

// What the family has recorded about Papa: a medicine, and his doctor.
await call(book, rohan, { action: 'add', kind: 'med', name: 'Amlodipine 5mg', forwhat: 'BP', aboutId: papa.id });
await call(book, rohan, { action: 'add', kind: 'contact', category: 'doctor', name: 'Dr Mehra', phone: '9811111111', forwhat: 'Papa\'s doctor', aboutId: papa.id });
await call(book, rohan, { action: 'add', kind: 'med', name: 'Thyronorm 50', forwhat: 'thyroid', aboutId: mummy.id });

// ---- an empty pot: nothing at all to spend
await admin.query(`delete from coins where circle_id = $1`, [fam]);
ok('the family starts this with no coins', await pot() === 0);

{
  const r = await ask(rohan, 'Papa has chest pain and is sweating, what do I do?');
  ok('chest pain: answered, even with no coins', r.status === 200 && r.ok, JSON.stringify(r).slice(0, 200));
  ok('chest pain: 112, 108 and SOS', /112/.test(r.reply) && /108/.test(r.reply) && /SOS/.test(r.reply));
  ok('chest pain: marked urgent, so the screen shows Call 112 and SOS', r.emergency === true);
  ok('chest pain: not a coin spent', await pot() === 0);
}
{
  const r = await ask(rohan, 'I want to die');
  ok('crisis: a person to talk to, at once', r.ok && /14416/.test(r.reply) && r.emergency === true);
}
{
  const r = await ask(rohan, 'I got a message asking for an OTP for a payment. Is it a scam?');
  ok('out of coins, the scam check still answers', r.status === 200 && r.ok && /1930/.test(r.reply), JSON.stringify(r).slice(0, 200));
  ok('and the screen is not told it was read from the records (it is standard advice)', !r.records, JSON.stringify(r).slice(0, 120));
}
{
  const r = await ask(rohan, 'Can Papa take a Crocin with his BP tablet?');
  ok('medicine question: answered from the records, free', r.status === 200 && r.ok && /Amlodipine 5mg/.test(r.reply), JSON.stringify(r).slice(0, 300));
  ok('"Papa" is Raj, saved as father: only his medicines, never Mummy\'s', /Raj/.test(r.reply) && !/Thyronorm/.test(r.reply), r.reply);
  ok('medicine question: never advises, names the doctor', /cannot advise on medicines/.test(r.reply) && /Dr Mehra/.test(r.reply), r.reply);
  // A medicine question is free, so the pot does not come into it: the
  // reason given is the true one, that no AI key is set up.
  ok('medicine question: says it read the records, truthfully, and the screen says so', /read that straight from your family records/.test(r.reply) && !/out of coins/.test(r.reply) && r.records === true, r.reply);
}
{
  const r = await ask(rohan, 'Can Dadi take a Crocin?');
  ok('a family word nobody is saved as: asks who, never mixes records', r.ok && /Who is this about/.test(r.reply) && !/Amlodipine|Thyronorm/.test(r.reply), r.reply);
}
{
  const r = await ask(rohan, 'Papa passed out yesterday, what medicines is he on?');
  ok('something that happened yesterday is not a call for 112', r.ok && !r.emergency && /Amlodipine/.test(r.reply), JSON.stringify(r).slice(0, 200));
}
{
  const r = await ask(rohan, 'what do we have for Papa');
  ok('the example Ekta suggests really is answered', r.ok && /Amlodipine 5mg/.test(r.reply), JSON.stringify(r).slice(0, 200));
}
{
  const v = await ask(rohan, 'Prepare a summary for a doctor visit.');
  ok('a doctor visit with nobody named: asks who it is for, reads out nobody\'s records', v.ok && /Who is the doctor visit for/.test(v.reply) && !/Amlodipine|Thyronorm/.test(v.reply), v.reply);
  const c0 = await pot();
  const f = await call(ekta, rohan, { messages: [{ role: 'user', content: 'Prepare a summary for a doctor visit.' }, { role: 'assistant', content: v.reply }, { role: 'user', content: 'Raj' }] });
  ok('answering "Raj" to "whose visit": Raj\'s summary, read from the records, free', f.ok && /Amlodipine/.test(f.reply) && !/Thyronorm/.test(f.reply) && f.records === true && await pot() === c0, JSON.stringify(f).slice(0, 200));
  const n = await ask(rohan, 'Can Raj take a Crocin with his BP tablet?');
  ok('"Can Raj take..." by his saved name is a medicine question too', n.ok && /Amlodipine/.test(n.reply) && /cannot advise on medicines/.test(n.reply), n.reply);
  const mum = await ask(rohan, 'Can Mummy take a Crocin?');
  ok('Mummy has no doctor saved: Papa\'s doctor is never named as hers', mum.ok && /Thyronorm/.test(mum.reply) && !/Dr Mehra/.test(mum.reply) && /pharmacist/.test(mum.reply), mum.reply);
  const u = await ask(rohan, 'He had an accident last week and today he is breathless');
  ok('something old, and something happening today: urgent', u.ok && u.emergency === true);
}
{
  // With no AI key there is no model to pay for: a chat that cannot be had
  // is answered as such, whatever the pot holds.
  const r0 = await ask(rohan, 'write me a poem about the moon');
  ok('no key: a conversation is not refused for coins, it says it cannot chat and why', r0.ok && /no AI key is set up/.test(r0.reply) && await pot() === 0, JSON.stringify(r0).slice(0, 160));
  // With a key, a conversation is the model's, and needs coins.
  process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
  const r = await ask(rohan, 'write me a poem about the moon');
  delete process.env.ANTHROPIC_API_KEY;
  ok('a conversation needs coins: refused with 402', r.status === 402 && r.needCoins === true);
  ok('and how to earn more is something any member can do (not check in)', /family memory/.test(r.error) && /vault/.test(r.error) && !/check(ing)? in/i.test(r.error), r.error);
  ok('and it says what stays free', /scam check and anything urgent stay free/.test(r.error), r.error);
  ok('nothing was spent', await pot() === 0);
}

// ---- with coins: a records answer is still free, an emergency still costs nothing
await admin.query(`insert into coins (circle_id, member_id, delta, reason) values ($1, $2, 10, 'welcome')`, [fam, rohan.id]);
{
  const r = await ask(rohan, 'Dadi behosh ho gayi');
  ok('with coins too, urgent costs nothing', r.ok && r.emergency === true && await pot() === 10);
  const m = await ask(rohan, 'what do we have for Papa');
  ok('a records answer costs nothing', m.ok && await pot() === 10, String(await pot()));
  const s2 = await ask(rohan, 'Is this OTP message a scam?');
  const h2 = await ask(rohan, 'Can Papa take a Crocin with his BP tablet?');
  ok('the scam check and a medicine question cost nothing either', s2.ok && h2.ok && await pot() === 10);
  // Free means never charged, not charged and handed back: with a working
  // key those answers would never reach the refund.
  ok('nothing free was ever charged, even for a moment', (await admin.query(`select count(*)::int as n from coins where circle_id = $1 and reason in ('ekta', 'refund')`, [fam])).rows[0].n === 0);
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) {
  console.error(`ekta.dbtest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`ekta.dbtest: ${pass}/${pass} checks pass`);
