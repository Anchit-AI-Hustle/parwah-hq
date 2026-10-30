// SOS BY TEXT, WHATSAPP AND CALL, AGAINST A REAL DATABASE, with Twilio
// replaced by a stand-in that records what would have been sent.
//
// What it proves:
//   - with no keys, nothing is sent and the SOS works exactly as before;
//   - with keys, the people the SOS screen lists get a text, a WhatsApp and
//     (the first two) a call, in the right format, numbers made dialable;
//   - pressing SOS again does not send anything twice;
//   - a failure or a hung request is recorded and never breaks the SOS;
//   - the WhatsApp template is used when one is set;
//   - the call script cannot be broken by a name.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('sosdial.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('sosdial.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
for (const k of Object.keys(process.env)) if (k.startsWith('TWILIO_')) delete process.env[k];

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: events } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const D = await import('../../../api/_sosdial.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

// ---- the pieces
ok('an Indian mobile written the usual way becomes dialable', D.e164('98100 12345') === '+919810012345' && D.e164('09810012345') === '+919810012345' && D.e164('919810012345') === '+919810012345');
ok('an international number is kept', D.e164('+1 415 555 0100') === '+14155550100');
ok('a landline fragment or nonsense is not dialled', D.e164('2345') === null && D.e164('abc') === null && D.e164('') === null);
ok('no keys: off', D.dialConfig({}).on === false);
ok('an account with no sender is still off', D.dialConfig({ TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 't' }).on === false);
ok('a malformed account id is off', D.dialConfig({ TWILIO_ACCOUNT_SID: 'xyz', TWILIO_AUTH_TOKEN: 't', TWILIO_SMS_FROM: '+1' }).on === false);
const script = D.callScript('Papa <Say>hacked</Say> & "x"');
ok('a name cannot change what the call says', !/<Say>hacked/.test(script) && (script.match(/<Say /g) || []).length === 2 && /needs help now/.test(script));

// ---- a family, and a stand-in for Twilio
let n = 0;
async function person(circleId, name, phone) {
  const p = '+9198600' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [p, p.slice(3), name])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, user_id, phone) values ($1,$2,$3,$4) returning id`, [circleId, name, u.id, phone || null])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, name, token };
}
const fam = (await admin.query(`insert into circles (code, name) values ('SHARMA','Sharma Family') returning id`)).rows[0].id;
const papa = await person(fam, 'Papa', '+919800000001');
await person(fam, 'Rohan', '98100 12345');
await person(fam, 'Meera', '+447700900123');
await person(fam, 'Asha', '9876543210');
await person(fam, 'Kid', '12');                       // not dialable: skipped

let sent = [];
const twilioOk = async (u, o) => { sent.push({ url: u, form: Object.fromEntries(new URLSearchParams(o.body)), auth: o.headers.Authorization }); return { ok: true, json: async () => ({ sid: 'SM' + sent.length }) }; };
async function sos(who) {
  // Each section here is a separate emergency, minutes apart in real life.
  // The alert limit (security.dbtest) would otherwise count them as one
  // person pressing in a loop.
  await admin.query(`delete from rate_limit where bucket in ('sos', 'sosfam')`).catch(() => {});
  const req = { method: 'POST', headers: { 'x-parwah-token': who.token }, query: {},
                body: { code: 'SHARMA', memberId: who.id, type: 'sos', text: '', lat: 18.52, lng: 73.85, accuracy: 10 } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await events(req, res);
  return { ...json, status };
}

// ---- 1. no keys: the SOS is exactly as before
{
  globalThis.fetch = twilioOk; sent = [];
  const r = await sos(papa);
  ok('without keys the SOS still goes', r.status === 201 && r.ok);
  ok('and nothing is sent outside', sent.length === 0 && r.dialed && r.dialed.configured === false, JSON.stringify(r.dialed));
  await admin.query(`update sos set status = 'resolved'`);
}

// ---- 2. keys added: texts, WhatsApp, calls
const SID = 'AC' + '0123456789abcdef'.repeat(2);
Object.assign(process.env, { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: 'secret-token', TWILIO_SMS_FROM: '+15005550006',
                             TWILIO_WHATSAPP_FROM: '+14155238886', TWILIO_VOICE_FROM: '+15005550007' });
{
  globalThis.fetch = twilioOk; sent = [];
  const r = await sos(papa);
  const sms = sent.filter(x => /Messages\.json$/.test(x.url) && !/^whatsapp:/.test(x.form.To));
  const wa = sent.filter(x => /^whatsapp:/.test(x.form.To || ''));
  const calls = sent.filter(x => /Calls\.json$/.test(x.url));
  ok('each dialable person gets a text', sms.length === 3 && sms.every(x => x.form.From === '+15005550006' && /SOS from Papa/.test(x.form.Body) && /maps\.google\.com/.test(x.form.Body)), JSON.stringify(sms.map(x => x.form.To)));
  ok('numbers are made dialable, Papa himself is never sent to', sms.map(x => x.form.To).sort().join() === '+447700900123,+919810012345,+919876543210');
  ok('and a WhatsApp, from the WhatsApp sender', wa.length === 3 && wa.every(x => x.form.From === 'whatsapp:+14155238886' && /SOS from Papa/.test(x.form.Body)));
  ok('only the first two are called, and told who needs help', calls.length === 2 && calls.every(x => x.form.From === '+15005550007' && /Papa pressed S O S/.test(x.form.Twiml)));
  ok('with the account\'s own credentials, to its own address', sent.every(x => x.url.includes('/Accounts/' + SID + '/') && x.auth === 'Basic ' + Buffer.from(SID + ':secret-token').toString('base64')));
  ok('the SOS screen is told what went', r.dialed.configured && r.dialed.sms === 3 && r.dialed.whatsapp === 3 && r.dialed.call === 2 && r.dialed.failed === 0, JSON.stringify(r.dialed));
  const rows = (await admin.query(`select status from sos_dial`)).rows;
  ok('each send is recorded', rows.length === 8 && rows.every(x => x.status === 'sent'));
  sent = [];
  const again = await sos(papa);
  ok('pressing SOS again alerts the family, but sends nothing twice', again.again === true && sent.length === 0 && again.dialed.sms === 0, String(sent.length));
  await admin.query(`update sos set status = 'resolved'`);
}

// ---- 3. Twilio refuses, or hangs: recorded, and the SOS still goes
{
  sent = [];
  globalThis.fetch = async (u, o) => {
    sent.push(u);
    if (/Calls\.json$/.test(u)) return new Promise((_, rej) => o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }));
    return { ok: false, status: 400, json: async () => ({ code: 21211, message: 'The To number is not valid' }) };
  };
  const t0 = Date.now();
  const r = await sos(papa);
  const took = Date.now() - t0;
  ok('the SOS still goes when Twilio fails', r.status === 201 && r.ok);
  ok('a hung call gives up within the time limit', took < D.DIAL_TIMEOUT_MS + 3000, took + ' ms');
  ok('failures are counted for the screen', r.dialed.failed === 8 && r.dialed.sms === 0, JSON.stringify(r.dialed));
  const det = (await admin.query(`select channel, detail from sos_dial where status = 'failed' and sos_id = $1`, [r.sosId])).rows;
  ok('and recorded with the reason', det.some(x => x.detail === 'The To number is not valid') && det.some(x => x.channel === 'call' && x.detail === 'timed out'), JSON.stringify(det));
  await admin.query(`update sos set status = 'resolved'`);
}

// ---- 4. a WhatsApp template, for real use outside the 24-hour window
{
  process.env.TWILIO_WHATSAPP_CONTENT_SID = 'HX' + 'a'.repeat(32);
  delete process.env.TWILIO_SMS_FROM; delete process.env.TWILIO_VOICE_FROM;
  globalThis.fetch = twilioOk; sent = [];
  const r = await sos(papa);
  ok('WhatsApp uses the approved template, with the name and the map link', sent.length === 3 && sent.every(x => x.form.ContentSid === process.env.TWILIO_WHATSAPP_CONTENT_SID
     && JSON.parse(x.form.ContentVariables)['1'] === 'Papa' && /maps\.google\.com/.test(JSON.parse(x.form.ContentVariables)['2']) && !x.form.Body), JSON.stringify(sent.map(x => x.form)));
  ok('and only WhatsApp is sent when it is the only sender', r.dialed.whatsapp === 3 && r.dialed.sms === 0 && r.dialed.call === 0);
}

for (const p of globalThis.__parwahPools || []) await p.end();
await admin.end();
if (fails.length) { for (const f of fails) console.log('FAIL  ' + f); console.error(`sosdial.dbtest: ${fails.length} FAILED of ${pass + fails.length}`); process.exit(1); }
console.log(`sosdial.dbtest: ${pass}/${pass} checks pass`);
