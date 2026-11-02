// THE NEAREST-PERSON LADDER, SHARED CARE EXPENSES, THE HOME STAFF REGISTER
// AND RENEWALS, against a real database, with Twilio replaced by a stand-in.
//
// What it proves, per feature: the happy path; an outsider gets 403 and no
// session gets 401; and each time-based alert is sent once however many
// phones poll.
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) { console.log('familytools.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped.'); process.exit(process.env.CI ? 1 : 0); }
if (!/_test$/.test(new URL(url).pathname)) { console.error('familytools.dbtest: the database name must end in _test, because this wipes it.'); process.exit(1); }
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
for (const k of Object.keys(process.env)) if (k.startsWith('TWILIO_')) delete process.env[k];

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: care } = await import('../../../api/care.mjs');
const { default: events } = await import('../../../api/events.mjs');
const { default: circleApi } = await import('../../../api/circle.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const L = await import('../../../api/_ladder.mjs');
const S = await import('../../../api/_staff.mjs');
const R = await import('../../../api/_renewals.mjs');
const E = await import('../../../api/_expenses.mjs');
await ensureSchema(db());

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

let n = 0;
async function person(circleId, name, phone, code) {
  const p = '+9198700' + String(++n).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1,'+91',$2,$3) returning id`, [p, p.slice(3), name])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, user_id, phone) values ($1,$2,$3,$4) returning id`, [circleId, name, u.id, phone || null])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, name, token, code };
}
async function call(handler, who, method, query, body) {
  const req = { method, headers: who && who.token ? { 'x-parwah-token': who.token, 'x-parwah-tz': 'Asia/Kolkata' } : {}, query: query || {}, body: body || undefined };
  let status = 200, json = null, html = null; const headers = {};
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, send(h) { html = h; return this; },
                setHeader(k, v) { headers[k.toLowerCase()] = v; }, end(h) { html = h; return this; } };
  await handler(req, res);
  return { ...(json || {}), status, json, html, headers };
}
const get = (who, area, extra) => call(care, who, 'GET', { area, circle: who.code, member: who.id, ...(extra || {}) });
const post = (who, action, body) => call(care, who, 'POST', {}, { code: who.code, memberId: who.id, action, ...(body || {}) });

const fam = (await admin.query(`insert into circles (code, name) values ('VERMAS','Verma Family') returning id`)).rows[0].id;
const maa = await person(fam, 'Maa', '+919811100000', 'VERMAS');
const rohan = await person(fam, 'Rohan', '+971501234567', 'VERMAS');
const priya = await person(fam, 'Priya', '9876500000', 'VERMAS');
const other = (await admin.query(`insert into circles (code, name) values ('OTHERS','Other Family') returning id`)).rows[0].id;
const outsider = await person(other, 'Stranger', '9000000000', 'OTHERS');
const intruder = { ...outsider, code: 'VERMAS' };       // a real session, the wrong family
const anon = { id: maa.id, code: 'VERMAS', token: null };

// ================================================================ 1. LADDER
{
  ok('ladder: no session is 401', (await get(anon, 'ladder')).status === 401);
  ok('ladder: an outsider is 403', (await get(intruder, 'ladder')).status === 403);
  ok('ladder: an outsider cannot add', (await post(intruder, 'ladder_add', { personId: maa.id, name: 'X', phone: '9811111111' })).status === 403);
  const bad = await post(rohan, 'ladder_add', { personId: maa.id, name: 'Mrs Khanna', phone: '12' });
  ok('ladder: a number that is not one is refused', bad.status === 400);
  const a = await post(rohan, 'ladder_add', { personId: maa.id, name: 'Mrs Khanna', phone: '98111 22222', distance: 'Two floors down', hasKey: true, hours: 'Mornings and nights' });
  ok('ladder: the family adds a nearby person and gets a consent link', a.status === 201 && /^\/api\/circle\?consent=[A-Za-z0-9_-]{20,}$/.test(a.link), JSON.stringify(a));
  const b = await post(rohan, 'ladder_add', { personId: maa.id, name: 'Guard Ramesh', phone: '9811133333', distance: 'Building gate' });
  const c = await post(priya, 'ladder_add', { personId: maa.id, name: 'Chachi', phone: '9811144444', distance: 'Ten minutes away' });
  const tokA = a.link.split('=')[1], tokB = b.link.split('=')[1], tokC = c.link.split('=')[1];
  ok('ladder: nobody is on the ladder before they say yes', (await L.ladderFor(db(), fam, maa.id)).length === 0);
  // The nearby person's page: no sign-in, says what is stored and how to remove it.
  const page = await call(circleApi, null, 'GET', { consent: tokA });
  ok('consent page: opens without signing in', page.status === 200 && /Mrs Khanna/.test(page.html) && /Yes, I&#39;ll help|Yes, I'll help/.test(page.html), page.status);
  ok('consent page: says what Parwah will do, what is kept and how to remove it',
    /presses SOS/.test(page.html) && /misses the daily check-in/.test(page.html) && /What is kept about you/.test(page.html) && /delete my details/.test(page.html));
  ok('consent page: shows only the last 4 digits of the number', /ending 2222/.test(page.html) && !/9811122222/.test(page.html));
  ok('consent page: never indexed or cached', page.headers['cache-control'] === 'no-store' && page.headers['x-robots-tag'] === 'noindex');
  ok('consent page: a made-up link shows nothing', (await call(circleApi, null, 'GET', { consent: 'x'.repeat(32) })).status === 404);
  const yes = await call(circleApi, null, 'POST', { consent: tokA }, { answer: 'yes' });
  ok('consent page: "Yes, I\'ll help" joins the ladder', yes.status === 200 && /You are on the list/.test(yes.html));
  await call(circleApi, null, 'POST', { consent: tokB }, { answer: 'yes' });
  await call(circleApi, null, 'POST', { consent: tokC }, { answer: 'no' });
  let lad = await L.ladderFor(db(), fam, maa.id);
  ok('ladder: only people who said yes are on it, in order', lad.map(x => x.name).join() === 'Mrs Khanna,Guard Ramesh', lad.map(x => x.name).join());
  const list = await get(rohan, 'ladder');
  ok('ladder: the family sees every answer', list.ladder.length === 3 && list.ladder.find(x => x.name === 'Chachi').consent === 'no');
  // Reorder by arrows: Guard first.
  const ids = list.ladder.filter(x => x.person_id === maa.id).map(x => x.id);
  const reordered = [ids[1], ids[0], ids[2]];
  ok('ladder: the family reorders it', (await post(priya, 'ladder_order', { personId: maa.id, ids: reordered })).status === 200);
  lad = await L.ladderFor(db(), fam, maa.id);
  ok('ladder: the new order holds', lad[0].name === 'Guard Ramesh', lad.map(x => x.name).join());
  ok('ladder: an outsider cannot reorder', (await post(intruder, 'ladder_order', { personId: maa.id, ids: reordered })).status === 403);
  // Withdraw from the same link: deleted outright.
  const del = await call(circleApi, null, 'POST', { consent: tokC }, { answer: 'delete' });
  ok('consent page: "Stop and delete" deletes their details', del.status === 200 && (await admin.query(`select 1 from nearby_ladder where name = 'Chachi'`)).rows.length === 0);
  ok('consent page: the link is dead afterwards', (await call(circleApi, null, 'GET', { consent: tokC })).status === 404);
  // A fresh link replaces the old one.
  const fresh = await post(rohan, 'ladder_link', { id: ids[0] });
  ok('ladder: a fresh link replaces the old one', fresh.ok && (await call(circleApi, null, 'GET', { consent: tokA })).status === 404
     && (await call(circleApi, null, 'GET', { consent: fresh.link.split('=')[1] })).status === 200);

  // ---- SOS escalation: no Twilio, the family's alarm shows the ladder
  await admin.query(`create table if not exists sos (id uuid primary key default gen_random_uuid(), circle_id uuid not null references circles(id) on delete cascade, member_id uuid not null references members(id) on delete cascade, status text not null default 'open', escalated boolean not null default false, acked_by uuid, acked_at timestamptz, resolved_at timestamptz, created_at timestamptz not null default now())`);
  const ev = await call(events, rohan, 'GET', { circle: 'VERMAS', member: rohan.id });  // makes the SOS tables
  const sosRow = (await admin.query(`insert into sos (circle_id, member_id, created_at) values ($1, $2, now() - interval '6 minutes') returning id`, [fam, maa.id])).rows[0];
  const ev2 = await call(events, rohan, 'GET', { circle: 'VERMAS', member: rohan.id });
  const s = (ev2.sos || []).find(x => x.id === sosRow.id);
  ok('SOS: the family alarm carries the ladder with phone numbers', s && s.ladder.length === 2 && s.ladder[0].name === 'Guard Ramesh' && s.ladder[0].phone && s.ladderCalls === false, JSON.stringify(s && s.ladder));
  const rung = (await admin.query(`select rung, status from sos_ladder where sos_id = $1 order by rung`, [sosRow.id])).rows;
  ok('SOS: after one window without an answer, rung 1 is shown to the family (no Twilio)', rung.length === 1 && rung[0].status === 'shown', JSON.stringify(rung));
  await call(events, priya, 'GET', { circle: 'VERMAS', member: priya.id });
  ok('SOS: polling again does not repeat it', (await admin.query(`select count(*)::int as n from sos_ladder where sos_id = $1`, [sosRow.id])).rows[0].n === 1);
  const feedN = (await admin.query(`select count(*)::int as n from events where circle_id = $1 and text like '%said they can help%'`, [fam])).rows[0].n;
  ok('SOS: the family is told once who to call', feedN === 1, feedN);

  // ---- with Twilio: rung 2 after two windows is called, inside the cap
  const SID = 'AC' + '0123456789abcdef'.repeat(2);
  Object.assign(process.env, { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: 'secret', TWILIO_VOICE_FROM: '+15005550007' });
  let sent = [];
  globalThis.fetch = async (u, o) => { sent.push({ url: u, form: Object.fromEntries(new URLSearchParams(o.body)) }); return { ok: true, json: async () => ({ sid: 'CA' + sent.length }) }; };
  await admin.query(`update sos set created_at = now() - interval '11 minutes' where id = $1`, [sosRow.id]);
  await Promise.all([L.ladderEscalate(db(), fam, 5), L.ladderEscalate(db(), fam, 5)]);
  ok('SOS: rung 2 is called once, even with two phones polling at once', sent.length === 1 && sent[0].form.To === '+919811122222' && /Calls\.json$/.test(sent[0].url), JSON.stringify(sent.map(x => x.form.To)));
  ok('SOS: the call says who needs help and that the family could not be reached', /Maa pressed S O S/.test(sent[0].form.Twiml) && /nobody in the family has answered/.test(sent[0].form.Twiml));
  const dialRow = (await admin.query(`select status from sos_dial where sos_id = $1 and channel = 'ladder'`, [sosRow.id])).rows;
  ok('SOS: the ladder call counts against the family\'s daily cap', dialRow.length === 1 && dialRow[0].status === 'sent');
  // The cap: fill the day, then a new SOS rings nobody.
  const sos2 = (await admin.query(`insert into sos (circle_id, member_id, created_at) values ($1, $2, now() - interval '6 minutes') returning id`, [fam, maa.id])).rows[0];
  for (let i = 0; i < 40; i++) await admin.query(`insert into sos_dial (sos_id, phone, channel) values ($1, $2, 'sms')`, [sosRow.id, '+91999' + i]);
  sent = [];
  await L.ladderEscalate(db(), fam, 5);
  ok('SOS: past the daily cap the ladder is not called', sent.length === 0 && (await admin.query(`select status from sos_ladder where sos_id = $1`, [sos2.id])).rows[0].status === 'capped');
  // An answered SOS goes no further.
  await admin.query(`update sos set status = 'acked' where id = $1`, [sos2.id]);
  await admin.query(`update sos set created_at = now() - interval '20 minutes' where id = $1`, [sos2.id]);
  await L.ladderEscalate(db(), fam, 5);
  ok('SOS: once someone in the family answers, no more rungs', (await admin.query(`select count(*)::int as n from sos_ladder where sos_id = $1`, [sos2.id])).rows[0].n === 1);
  await admin.query(`update sos set status = 'resolved'`);
  for (const k of Object.keys(process.env)) if (k.startsWith('TWILIO_')) delete process.env[k];
  ok('ladder: removal works for the family', (await post(rohan, 'ladder_remove', { id: ids[1] })).status === 200);
}

// ================================================================ 2. EXPENSES
{
  ok('expenses: no session is 401', (await get(anon, 'expenses')).status === 401);
  ok('expenses: an outsider is 403', (await get(intruder, 'expenses')).status === 403);
  ok('expenses: an outsider cannot add', (await post(intruder, 'expense_add', { amount: 100 })).status === 403);
  const month = new Date().toISOString().slice(0, 7), day = month + '-05';
  ok('expenses: an amount must be a number above 0', (await post(rohan, 'expense_add', { amount: -4 })).status === 400);
  const e1 = await post(rohan, 'expense_add', { amount: 6000, category: 'doctor', forMemberId: maa.id, spentOn: day });
  const e2 = await post(priya, 'expense_add', { amount: 1800, category: 'medicines', forMemberId: maa.id, spentOn: day });
  await post(priya, 'expense_add', { amount: 50, currency: 'AED', category: 'travel', spentOn: day });
  ok('expenses: logged by two people', e1.status === 201 && e2.status === 201);
  ok('expenses: paid by someone else in the family', (await post(rohan, 'expense_add', { amount: 1, paidById: outsider.id })).status === 403);
  let v = await get(priya, 'expenses', { month });
  const inr = v.summary.find(x => x.currency === 'INR'), aed = v.summary.find(x => x.currency === 'AED');
  ok('expenses: month total per currency, never converted', inr.total === 7800 && aed.total === 50, JSON.stringify(v.summary));
  ok('expenses: per payer and by category', inr.byPayer[0].name === 'Rohan' && inr.byPayer[0].amount === 6000 && inr.byCategory.length === 2);
  ok('expenses: no split set, no balance line', inr.balance.length === 0);
  ok('expenses: split with someone outside is refused', (await post(rohan, 'split_set', { mode: 'equal', shares: { [rohan.id]: 1, [outsider.id]: 1 } })).status === 403);
  ok('expenses: equal split set', (await post(rohan, 'split_set', { mode: 'equal', shares: { [rohan.id]: true, [priya.id]: true } })).status === 200);
  v = await get(priya, 'expenses', { month });
  const bal = v.summary.find(x => x.currency === 'INR').balance;
  ok('expenses: neutral balance line', bal[0].name === 'Rohan' && bal[0].diff === 2100 && bal[0].line === 'Rohan has paid ₹2,100 more than their share'
     && bal[1].line === 'Priya has paid ₹2,100 less than their share', JSON.stringify(bal));
  await post(rohan, 'split_set', { mode: 'shares', shares: { [rohan.id]: 2, [priya.id]: 1 } });
  v = await get(priya, 'expenses', { month });
  ok('expenses: shares split (2:1)', v.summary.find(x => x.currency === 'INR').balance.find(x => x.name === 'Rohan').diff === 800);
  // A settled bill, one tap.
  const bill = (await admin.query(`insert into care_bills (circle_id, person_id, bill_category, biller_name, amount_due, payment_status, settled_at, settled_by, created_by)
                                   values ($1,$2,'ELECTRICITY','Power company',840,'SETTLED',now(),$3,$3) returning id`, [fam, maa.id, priya.id])).rows[0];
  v = await get(rohan, 'expenses', { month });
  ok('expenses: settled bills are offered', v.settledBills.length === 1 && v.settledBills[0].id === bill.id);
  const fb = await post(rohan, 'expense_from_bill', { billId: bill.id });
  const fb2 = await post(rohan, 'expense_from_bill', { billId: bill.id });
  const row = (await admin.query(`select amount, category, paid_by from care_expenses where bill_id = $1`, [bill.id])).rows;
  ok('expenses: a settled bill becomes an expense once, paid by whoever settled it', fb.status === 201 && fb2.already && row.length === 1 && Number(row[0].amount) === 840 && row[0].category === 'bills' && row[0].paid_by === priya.id, JSON.stringify(fb));
  ok('expenses: only who wrote or paid can remove', (await post(maa, 'expense_remove', { id: e1.id })).status === 403 && (await post(rohan, 'expense_remove', { id: e1.id })).status === 200);
  ok('expenses: records only - nothing in the reply moves money', !JSON.stringify(v).match(/upi:|pay\?|checkout/i));
}

// ================================================================ 3. STAFF
{
  ok('staff: no session is 401', (await get(anon, 'staff')).status === 401);
  ok('staff: an outsider is 403', (await get(intruder, 'staff')).status === 403);
  ok('staff: a whole ID number is refused', (await post(rohan, 'staff_add', { name: 'Sunita', idLast4: '123456789012' })).status === 400);
  const add = await post(rohan, 'staff_add', { name: 'Sunita', role: 'attendant', phone: '9811155555', salary: 12000, payDay: 1, arriveTime: '08:00', idLast4: '4321', workDays: [0, 1, 2, 3, 4, 5, 6], paidLeave: 1 });
  ok('staff: added', add.status === 201);
  const sid = add.id;
  ok('staff: an outsider cannot mark attendance', (await post(intruder, 'staff_mark', { staffId: sid, status: 'came' })).status === 403);
  const month = (await get(maa, 'staff')).month;
  const mk = (d, st) => post(maa, 'staff_mark', { staffId: sid, status: st, day: month + '-' + d });
  const today = S.localNow('Asia/Kolkata').date;
  const past = (k) => { const d = new Date(Date.parse(today) - k * 86400000).toISOString().slice(0, 10); return d.slice(0, 7) === month ? d.slice(8) : null; };
  // Days in this month before today (the month may have just started: then mark today only).
  const days = [1, 2, 3, 4].map(past).filter(Boolean);
  const me = await post(maa, 'staff_mark', { staffId: sid, status: 'came' });
  ok('staff: Maa taps "Came" for today', me.status === 200 && me.day === today, JSON.stringify(me) + today);
  if (days[0]) await mk(days[0], 'leave');
  if (days[1]) await mk(days[1], 'leave');
  if (days[2]) await mk(days[2], 'half');
  ok('staff: a future day cannot be marked', (await post(maa, 'staff_mark', { staffId: sid, status: 'came', day: '2099-01-01' })).status === 400);
  await post(rohan, 'staff_advance', { staffId: sid, amount: 1000, onDate: today });
  const st = (await get(rohan, 'staff')).staff.find(x => x.id === sid);
  const leaves = Math.min(2, days.length), halves = days.length >= 3 ? 1 : 0;
  const unpaid = Math.max(0, leaves + halves * 0.5 - 1);
  const want = Math.round(12000 - Math.round(unpaid * 400) - 1000);
  ok('staff: month view counts days, leave, advances', st.pay.came === 1 && st.pay.leave === leaves && st.pay.half === halves && st.pay.advances === 1000, JSON.stringify(st.pay));
  ok('staff: the amount payable, with the sum written out', st.pay.payable === want && /₹12,000 salary/.test(st.pay.formula) && /= ₹/.test(st.pay.formula) && /divided by 30/.test(st.pay.note), JSON.stringify(st.pay));
  ok('staff: only the last 4 of the ID is kept', st.id_last4 === '4321');
  ok('staff: today is shown as marked', st.todayStatus === 'came');
  const paid = await post(rohan, 'staff_pay', { staffId: sid, month });
  const again = await post(rohan, 'staff_pay', { staffId: sid, month });
  const ex = (await admin.query(`select amount, category from care_expenses where staff_id = $1`, [sid])).rows;
  ok('staff: "Mark paid" records it once and adds a care expense', paid.status === 201 && again.already && ex.length === 1 && Number(ex[0].amount) === want && ex[0].category === 'staff', JSON.stringify(ex));
  ok('staff: mark paid can be undone, expense too', (await post(rohan, 'staff_pay_undo', { staffId: sid, month })).status === 200 && (await admin.query(`select 1 from care_expenses where staff_id = $1`, [sid])).rows.length === 0);

  // ---- late / no-show, once
  const late = await post(rohan, 'staff_add', { name: 'Didi', role: 'cook', arriveTime: '08:00', workDays: [0, 1, 2, 3, 4, 5, 6] });
  await admin.query(`update home_staff set tz = 'UTC' where id = $1`, [late.id]);
  await admin.query(`update home_staff set arrive_time = null where id = $1`, [sid]);
  const nine = Date.UTC(2026, 10, 3, 9, 5);        // 9:05 UTC, a Tuesday
  const early = Date.UTC(2026, 10, 3, 8, 30);
  ok('staff late: not before expected + 60 min', (await S.sweepStaffLate(db(), fam, early)) === 0);
  const r1 = await Promise.all([S.sweepStaffLate(db(), fam, nine), S.sweepStaffLate(db(), fam, nine)]);
  ok('staff late: the family is told once, even with two phones polling', r1[0] + r1[1] === 1, JSON.stringify(r1));
  ok('staff late: and not again that day', (await S.sweepStaffLate(db(), fam, nine + 3600000)) === 0);
  const feed = (await admin.query(`select text from events where circle_id = $1 and text like '%not marked in yet%'`, [fam])).rows;
  ok('staff late: respectful words, with the expected time', feed.length === 1 && /Didi \(cook\) was expected at 08:00/.test(feed[0].text), JSON.stringify(feed));
  await admin.query(`insert into staff_attendance (staff_id, day, status) values ($1, '2026-11-04', 'came')`, [late.id]);
  ok('staff late: a day already marked is never alerted', (await S.sweepStaffLate(db(), fam, Date.UTC(2026, 10, 4, 9, 5))) === 0);
  await admin.query(`update home_staff set work_days = '12345' where id = $1`, [late.id]);
  ok('staff late: not on a day off', (await S.sweepStaffLate(db(), fam, Date.UTC(2026, 10, 8, 9, 5))) === 0);   // a Sunday
  ok('staff: removed with everything recorded', (await post(rohan, 'staff_remove', { staffId: late.id })).status === 200
     && (await admin.query(`select 1 from staff_late_alert where staff_id = $1`, [late.id])).rows.length === 0);
}

// ================================================================ 4. RENEWALS
{
  ok('renewals: no session is 401', (await get(anon, 'renewals')).status === 401);
  ok('renewals: an outsider is 403', (await get(intruder, 'renewals')).status === 403);
  ok('renewals: an outsider cannot add', (await post(intruder, 'renewal_add', { kind: 'passport', expiresOn: '2027-01-01' })).status === 403);
  const day = (k) => new Date(Date.now() + k * 86400000).toISOString().slice(0, 10);
  ok('renewals: a date is needed', (await post(rohan, 'renewal_add', { kind: 'passport' })).status === 400);
  const a = await post(rohan, 'renewal_add', { kind: 'health_ins', label: 'Maa health policy', aboutMemberId: maa.id, expiresOn: day(20) });
  const b = await post(rohan, 'renewal_add', { kind: 'vehicle_ins', expiresOn: day(5), ownerId: priya.id });
  await post(rohan, 'renewal_add', { kind: 'fd', label: 'SBI FD', expiresOn: day(200) });
  ok('renewals: added', a.status === 201 && b.status === 201);
  // A vault paper with an expiry, visible to the person it is about.
  await admin.query(`insert into vault_docs (circle_id, about_member, kind, label, expires_on, by_member) values ($1,$2,'passport','Maa passport',$3,$2)`, [fam, maa.id, day(25)]);
  const lm = await get(maa, 'renewals');
  ok('renewals: sorted by date, vault papers included for who may see them', lm.renewals.map(x => x.label).join() === 'Vehicle insurance,Maa health policy,Maa passport,SBI FD', lm.renewals.map(x => x.label).join());
  const lr = await get(rohan, 'renewals');
  ok('renewals: a private vault paper is not shown to others', !lr.renewals.some(x => x.label === 'Maa passport'));
  const pushes = (await admin.query(`select ref_id, stage from renewal_alerts`)).rows;
  ok('renewals: 30 and 7 days ahead are claimed once each', pushes.filter(x => x.stage === 7).length === 1 && pushes.filter(x => x.stage === 30).length === 3, JSON.stringify(pushes));
  ok('renewals: polling again sends nothing more', (await R.sweepRenewals(db(), fam)) === 0);
  ok('renewals: the stage rule', R.stageFor(31) === null && R.stageFor(30) === 30 && R.stageFor(8) === 30 && R.stageFor(7) === 7 && R.stageFor(0) === 7 && R.stageFor(-1) === null);
  const t = await post(rohan, 'renewal_task', { id: a.id, ownerId: priya.id });
  const task = (await admin.query(`select title, claimed_by, status from requests where id = $1`, [t.id])).rows[0];
  ok('renewals: one tap makes a task for an owner', t.status === 201 && task.title === 'Renew Maa health policy' && task.claimed_by === priya.id && task.status === 'assigned', JSON.stringify(task) + priya.id);
  const after = (await get(rohan, 'renewals')).renewals.find(x => x.id === a.id);
  ok('renewals: the list shows the task is open', after.task_open === true && after.owner_name === 'Priya');
  ok('renewals: an outsider cannot make a task from it', (await post(intruder, 'renewal_task', { id: a.id })).status === 403);
  ok('renewals: a private vault paper cannot be turned into a task by someone who cannot see it',
    (await post(rohan, 'renewal_task', { id: lm.renewals.find(x => x.source === 'vault').id, source: 'vault' })).status === 404);
  // Freshness: six months unchecked reads as stale; "Still right" clears it.
  await admin.query(`update renewals set last_verified_at = now() - interval '200 days' where id = $1`, [b.id]);
  ok('renewals: stale after six months', (await get(rohan, 'renewals')).renewals.find(x => x.id === b.id).stale === true);
  await post(priya, 'renewal_verify', { id: b.id });
  ok('renewals: "Still right" freshens it', (await get(rohan, 'renewals')).renewals.find(x => x.id === b.id).stale === false);
  // Renewed: a new date is a new cycle of reminders.
  await post(priya, 'renewal_update', { id: b.id, kind: 'vehicle_ins', expiresOn: day(3) });
  ok('renewals: a new date is reminded again', (await R.sweepRenewals(db(), fam)) === 1);
}

await admin.end();
console.log(`familytools.dbtest: ${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(f => console.log('FAIL  ' + f)); process.exit(1); }
process.exit(0);
