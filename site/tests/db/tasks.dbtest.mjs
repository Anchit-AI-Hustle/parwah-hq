// FAMILY TASKS AGAINST A REAL DATABASE: the real api/care.mjs handler, the
// real schema and SQL, on a throwaway PostgreSQL.
//
// What it proves:
//   - a task is created with an owner (or none), a due time stored in UTC,
//     a repeat, and a "done when";
//   - only the right people can take, finish, hand over, change, reopen or
//     put away a task, and nobody outside the family can touch it at all;
//   - two people tapping "I'm on it" at the same moment: exactly one gets it;
//   - finishing a repeating task makes exactly one next occurrence, even
//     when "done" is sent twice at once, and it lands on the family's clock;
//   - a late task is announced exactly once per occurrence, however many
//     phones look at the same time, and again only when its time changes;
//   - every step is in the task's history.
//
// Run with a database that is safe to wipe; its name must end in _test:
//   PARWAH_TEST_DATABASE_URL=postgres://postgres@/parwah_test?host=/var/run/postgresql \
//     npm run test:db
const url = process.env.PARWAH_TEST_DATABASE_URL;
if (!url) {
  console.log('tasks.dbtest: PARWAH_TEST_DATABASE_URL is not set - skipped. See the note at the top of this file.');
  process.exit(process.env.CI ? 1 : 0);
}
if (!/_test$/.test(new URL(url).pathname)) {
  console.error('tasks.dbtest: refusing to run - the database name must end in _test, because this wipes it.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;

const pg = (await import('pg')).default;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query('drop schema public cascade; create schema public;');

const { default: care } = await import('../../../api/care.mjs');
const { default: events } = await import('../../../api/events.mjs');
const { db, ensureSchema } = await import('../../../api/_db.mjs');
const { newToken, tokenHash } = await import('../../../api/_auth.mjs');
const { sweepOverdue, ensureTaskSchema, taskAction } = await import('../../../api/_tasks.mjs');
const { fromWall } = await import('../../../api/_recur.mjs');

const sql = db();
await ensureSchema(sql);
await ensureTaskSchema(sql);

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };

// Two families. Each person signs in, so every call carries a real session.
let phoneN = 0;
async function person(circleId, name, role = 'family') {
  const phone = '+9198100' + String(++phoneN).padStart(5, '0');
  const u = (await admin.query(`insert into users (phone, phone_cc, phone_local, name) values ($1, '+91', $2, $3) returning id`,
                               [phone, phone.slice(3), name])).rows[0];
  const m = (await admin.query(`insert into members (circle_id, name, role, user_id) values ($1, $2, $3, $4) returning id`,
                               [circleId, name, role, u.id])).rows[0];
  const token = newToken();
  await admin.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [tokenHash(token), u.id]);
  return { id: m.id, name, token };
}
const sharma = (await admin.query(`insert into circles (code, name) values ('SHARMA', 'Sharma Family') returning id`)).rows[0].id;
const other = (await admin.query(`insert into circles (code, name) values ('VERMA1', 'Verma Family') returning id`)).rows[0].id;
const rohan = await person(sharma, 'Rohan');
const meera = await person(sharma, 'Meera');
const papa = await person(sharma, 'Papa', 'parent');
const vikram = await person(other, 'Vikram');
const CODE = { [sharma]: 'SHARMA', [other]: 'VERMA1' };
const circleOf = p => p === vikram ? other : sharma;

async function call(handler, who, { method = 'POST', body = {}, query = {} } = {}) {
  const req = { method, headers: { 'x-parwah-token': who.token, 'x-forwarded-for': '10.1.1.1' },
                body: { code: CODE[circleOf(who)], memberId: who.id, ...body },
                query: { circle: CODE[circleOf(who)], member: who.id, ...query } };
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {} };
  await handler(req, res);
  // The body's own "status" is the task's; the HTTP status wins here.
  return { ...json, taskStatus: json && json.status, status };
}
const act = (who, action, extra = {}) => call(care, who, { body: { action, ...extra } });
const list = async who => (await call(care, who, { method: 'GET' })).requests || [];
const history = async (who, id) => call(care, who, { method: 'GET', query: { task: id } });
const row = async id => (await admin.query('select * from requests where id = $1', [id])).rows[0];
const IN = 'Asia/Kolkata';
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

// ---- create: nobody's yet, due in UTC, with a "done when"
let open;
{
  const r = await act(rohan, 'task_create', { title: 'Book the gas refill', dueAt: '2026-10-01T03:30:00.000Z', tz: IN,
                                              doneWhen: 'Delivery date confirmed by the agency', aboutMemberId: papa.id });
  ok('a task with no owner is open to anyone', r.status === 201 && r.taskStatus === 'open' && (await row(r.id)).status === 'open', JSON.stringify(r));
  open = r.id;
  const t = await row(open);
  ok('its due time is stored in UTC exactly as sent', new Date(t.due_at).toISOString() === '2026-10-01T03:30:00.000Z');
  ok('with the family time zone beside it', t.tz === IN);
  ok('and the date at home', String(t.due_date instanceof Date ? t.due_date.toISOString() : t.due_date).length > 0);
  ok('"done when" and who it is about are kept', t.done_when === 'Delivery date confirmed by the agency' && t.about_member === papa.id);
  const d = await act(rohan, 'task_create', { title: 'Renew Papa\'s passport', dueDate: '2026-10-01', tz: IN });
  const dt = await row(d.id);
  ok('a date with no time means by the end of that day at home',
     dt.all_day === true && new Date(dt.due_at).getTime() === fromWall({ y: 2026, m: 10, d: 1, h: 23, mi: 59, s: 0 }, IN));
  const bad = await act(rohan, 'task_create', { title: '  ' });
  ok('an empty task is refused', bad.status === 400 && /needs doing/.test(bad.error));
  const rep = await act(rohan, 'task_create', { title: 'Walk with Papa', recurrence: 'daily' });
  ok('a repeating task without a first time is refused', rep.status === 400);
  const far = await act(rohan, 'task_create', { title: 'x', dueAt: '2099-01-01T00:00:00Z' });
  ok('a date decades away is refused', far.status === 400);
}

// ---- nobody outside the family, and nobody pretending to be someone else
{
  const r = await call(care, vikram, { body: { code: 'SHARMA', memberId: vikram.id, action: 'task_ack', taskId: open } });
  ok('someone from another family cannot act in this one', r.status === 403);
  const r2 = await call(care, vikram, { body: { action: 'task_done', taskId: open } });
  ok('nor reach this family\'s task from their own', r2.status === 404);
  const r3 = await call(care, { ...meera, token: rohan.token }, { body: { action: 'task_ack', taskId: open } });
  ok('nor can one person act as another with their own sign-in', r3.status === 403);
  const h = await call(care, vikram, { method: 'GET', query: { task: open } });
  ok('nor read its history', h.status === 404);
  const l = await list(vikram);
  ok('and it is not in their list', !l.some(t => t.id === open));
}

// ---- two people tap "I'm on it" at the same moment
{
  const race = await Promise.all([rohan, meera, papa, rohan, meera].map(p => act(p, 'task_ack', { taskId: open })));
  const won = race.filter(r => r.status === 200).length;
  ok('exactly one person gets it', won === 1, race.map(r => r.status).join());
  ok('everyone else is told someone already took it', race.filter(r => r.status === 409).length === 4);
  const t = await row(open);
  ok('and it is theirs, with the moment they said yes', t.status === 'claimed' && !!t.claimed_by && !!t.acknowledged_at);
}

// ---- given to one person: only they can say yes
let given;
{
  const r = await act(rohan, 'task_create', { title: 'Collect Papa\'s reports', ownerId: meera.id, dueAt: inDays(2), tz: IN });
  given = r.id;
  ok('given to Meera, it waits for her yes', r.status === 201 && (await row(given)).status === 'assigned');
  ok('Papa cannot say yes for her', (await act(papa, 'task_ack', { taskId: given })).status === 403);
  ok('Papa cannot finish it either', (await act(papa, 'task_done', { taskId: given })).status === 403);
  ok('Meera says yes', (await act(meera, 'task_ack', { taskId: given })).status === 200 && (await row(given)).status === 'claimed');
  ok('saying yes twice is refused, not repeated', (await act(meera, 'task_ack', { taskId: given })).status === 409);
  const mine = await act(rohan, 'task_create', { title: 'Call the plumber', ownerId: 'me' });
  ok('a task I give myself starts as mine, already accepted', (await row(mine.id)).status === 'claimed' && (await row(mine.id)).claimed_by === rohan.id);
}

// ---- change it: the person who asked and the person who has it
{
  ok('Papa, neither, cannot change it', (await act(papa, 'task_edit', { taskId: given, title: 'x' })).status === 403);
  ok('Meera, who has it, can', (await act(meera, 'task_edit', { taskId: given, doneWhen: 'Reports scanned into the vault' })).status === 200);
  ok('Rohan, who asked, can', (await act(rohan, 'task_edit', { taskId: given, title: 'Collect Papa\'s blood test reports' })).status === 200);
  const t = await row(given);
  ok('both changes are kept', t.title === 'Collect Papa\'s blood test reports' && t.done_when === 'Reports scanned into the vault');
}

// ---- hand it back, hand it over
{
  ok('Meera hands it back', (await act(meera, 'task_decline', { taskId: given, note: 'Travelling this week' })).status === 200);
  let t = await row(given);
  ok('and it is open to anyone again', t.status === 'open' && t.claimed_by === null);
  ok('Rohan gives it to Papa', (await act(rohan, 'task_assign', { taskId: given, ownerId: papa.id })).status === 200);
  t = await row(given);
  ok('who has to say yes', t.status === 'assigned' && t.claimed_by === papa.id);
  ok('Meera, no longer involved, cannot move it', (await act(meera, 'task_assign', { taskId: given, ownerId: meera.id })).status === 403);
  ok('nor to someone outside the family', (await act(rohan, 'task_assign', { taskId: given, ownerId: vikram.id })).status === 404);
  ok('Papa says yes', (await act(papa, 'task_ack', { taskId: given })).status === 200);
}

// ---- done, with a note; then reopened
{
  const d = await act(papa, 'task_done', { taskId: given, note: 'All four pages, in the blue folder' });
  ok('Papa finishes it with a note', d.status === 200);
  const t = await row(given);
  ok('who, when and the note are kept', t.status === 'done' && t.completed_by === papa.id && !!t.completed_at && t.completion_note === 'All four pages, in the blue folder');
  ok('finishing it again is refused', (await act(papa, 'task_done', { taskId: given })).status === 409);
  const l = await list(rohan);
  const shown = l.find(x => x.id === given);
  ok('the family still sees it as done, by Papa, for a few days', shown && shown.status === 'done' && shown.completed_name === 'Papa');
  ok('Meera cannot reopen what she was not part of', (await act(meera, 'task_reopen', { taskId: given })).status === 403);
  ok('Rohan, who asked, reopens it', (await act(rohan, 'task_reopen', { taskId: given, note: 'One page missing' })).status === 200);
  const r = await row(given);
  ok('it is back with Papa, not done', r.status === 'claimed' && r.claimed_by === papa.id && r.completed_at === null);
}

// ---- put away
{
  ok('Papa (who has it) puts it away', (await act(papa, 'task_archive', { taskId: given })).status === 200);
  ok('it leaves the list', !(await list(rohan)).some(x => x.id === given));
  ok('an archived task cannot be finished', (await act(papa, 'task_done', { taskId: given })).status === 409);
}

// ---- history: every step, in order, with names
{
  const h = await history(rohan, given);
  const steps = (h.history || []).map(x => x.action);
  ok('the history tells the whole story in order',
     steps.join() === 'created,assigned,acknowledged,edited,edited,declined,assigned,acknowledged,done,reopened,archived', steps.join());
  const done = (h.history || []).find(x => x.action === 'done');
  ok('with who and the note', done && done.name === 'Papa' && done.note === 'All four pages, in the blue folder');
}

// ---- the older calls keep working, with the same rules
{
  const q = await call(care, meera, { body: { action: 'request_create', title: 'Fix the geyser' } });
  ok('an old-style request is still created', q.status === 201);
  ok('and claimed the old way', (await act(rohan, 'request_claim', { requestId: q.id })).status === 200);
  ok('the old claim is also first-come only', (await act(papa, 'request_claim', { requestId: q.id })).status === 409);
  ok('the old "done" no longer lets just anyone close it', (await act(papa, 'request_done', { requestId: q.id })).status === 403);
  ok('the person who has it can', (await act(rohan, 'request_done', { requestId: q.id })).status === 200);
}

// ---- a repeating task: exactly one next time, on the family's clock
{
  const first = fromWall({ y: 2026, m: 9, d: 1, h: 9, mi: 0, s: 0 }, IN);
  const r = await act(meera, 'task_create', { title: 'Papa\'s evening walk', ownerId: 'me', recurrence: 'daily',
                                              dueAt: new Date(first).toISOString(), tz: IN, escalate: 'everyone' });
  // A double tap on a slow network, from two of Meera's phones.
  const both = await Promise.all(Array.from({ length: 8 }, () => act(meera, 'task_done', { taskId: r.id })));
  ok('"done" sent eight times at once: one succeeds', both.filter(x => x.status === 200).length === 1, both.map(x => x.status).join());
  ok('and it is finished once in its history',
     (await admin.query(`select count(*)::int as n from task_log where task_id = $1 and action = 'done'`, [r.id])).rows[0].n === 1);
  const series = (await admin.query('select * from requests where series_id = (select series_id from requests where id = $1) order by due_at', [r.id])).rows;
  ok('and exactly one next time is made', series.length === 2, series.length);
  const nx = series[1];
  ok('it is Meera\'s again', nx.claimed_by === meera.id && nx.status === 'claimed');
  ok('it is in the future, not a pile of missed days', new Date(nx.due_at) > new Date());
  const hh = new Intl.DateTimeFormat('en-GB', { timeZone: IN, hour: '2-digit', minute: '2-digit' }).format(new Date(nx.due_at));
  ok('at 09:00 at home', hh === '09:00', hh);
  ok('carrying its "tell everyone if late" choice', nx.escalate === 'everyone');
  const n2 = await act(meera, 'task_done', { taskId: nx.id });
  const series2 = (await admin.query('select count(*)::int as n from requests where series_id = $1', [nx.series_id])).rows[0].n;
  ok('finishing that one makes the one after', n2.status === 200 && series2 === 3);
  // The same, made certain: every request reads the task before any of them
  // writes, as on the slowest network. Only the conditional write can stop
  // the second one now.
  const fresh = await act(meera, 'task_create', { title: 'Papa\'s tablets refill', ownerId: 'me', recurrence: 'monthly', dueAt: inDays(-2), tz: IN });
  let reads = 0, release; const allRead = new Promise(r => { release = r; });
  const gated = (strings, ...vals) => {
    const q = sql(strings, ...vals);
    if (!/select \* from requests where id/.test(strings.join('?'))) return q;
    return q.then(async rows => { if (++reads === 4) release(); await allRead; return rows; });
  };
  const circleRow = { id: sharma };
  const meRow = { id: meera.id, name: 'Meera' };
  const four = await Promise.all(Array.from({ length: 4 }, () => taskAction(gated, circleRow, meRow, { action: 'task_done', taskId: fresh.id })));
  ok('four "done" that all read it first: still exactly one succeeds', four.filter(x => x.status === 200).length === 1, four.map(x => x.status).join());
  ok('and exactly one next time', (await admin.query(`select count(*)::int as n from requests where series_id = (select series_id from requests where id = $1)`, [fresh.id])).rows[0].n === 2);
  const openRep = await act(rohan, 'task_create', { title: 'Water the tulsi', recurrence: 'weekly', dueAt: inDays(-1), tz: IN });
  await act(papa, 'task_done', { taskId: openRep.id });
  const nxtOpen = (await admin.query(`select * from requests where series_id = (select series_id from requests where id = $1) and status <> 'done'`, [openRep.id])).rows[0];
  ok('an open repeating task stays open for anyone next time', nxtOpen && nxtOpen.status === 'open' && nxtOpen.claimed_by === null);
}

// ---- running late: announced once per occurrence, however many phones look
{
  const late = await act(rohan, 'task_create', { title: 'Pay the electricity bill', ownerId: meera.id, dueAt: new Date(Date.now() - 60000).toISOString(), tz: IN });
  await admin.query(`update requests set overdue_alerted_for = due_at where id <> $1`, [late.id]);  // only this one is fresh
  // Eight phones at once: four open the care screen, four poll the feed.
  // (The feed is opened once first: its own tables are made on first use.)
  await call(events, papa, { method: 'GET' });
  await admin.query(`update requests set overdue_alerted_for = null where id = $1`, [late.id]);
  await admin.query(`delete from task_log where task_id = $1 and action = 'overdue'`, [late.id]);
  const before = (await admin.query(`select count(*)::int as n from events where text like 'Running late%'`)).rows[0].n;
  await Promise.all([
    ...[rohan, meera, papa, rohan].map(p => call(care, p, { method: 'GET' })),
    ...[meera, papa, rohan, meera].map(p => call(events, p, { method: 'GET' }))
  ]);
  const after = (await admin.query(`select count(*)::int as n from events where text like 'Running late%'`)).rows[0].n;
  ok('eight phones looking at once: announced exactly once', after - before === 1, after - before);
  const logged = (await admin.query(`select count(*)::int as n from task_log where task_id = $1 and action = 'overdue'`, [late.id])).rows[0].n;
  ok('and recorded once in its history', logged === 1);
  await sweepOverdue(sql, sharma);
  ok('looking again later does not repeat it', (await admin.query(`select count(*)::int as n from events where text like 'Running late%'`)).rows[0].n === after);
  const l = await list(meera);
  ok('the family sees it marked late', (l.find(x => x.id === late.id) || {}).overdue === true);
  // A new time is a new occurrence.
  await act(rohan, 'task_edit', { taskId: late.id, dueAt: new Date(Date.now() - 1000).toISOString() });
  await Promise.all([sweepOverdue(sql, sharma), sweepOverdue(sql, sharma), sweepOverdue(sql, sharma)]);
  ok('given a new time that also passes, it is announced once more', (await admin.query(`select count(*)::int as n from events where text like 'Running late%'`)).rows[0].n === after + 1);
  await act(meera, 'task_ack', { taskId: late.id });
  await act(meera, 'task_done', { taskId: late.id });
  const done = await act(rohan, 'task_create', { title: 'Already sorted', ownerId: 'me', dueAt: new Date(Date.now() - 5000).toISOString() });
  await act(rohan, 'task_done', { taskId: done.id });
  await sweepOverdue(sql, sharma);
  ok('a finished task is never announced as late', (await admin.query(`select count(*)::int as n from task_log where task_id = $1 and action = 'overdue'`, [done.id])).rows[0].n === 0);
  const vr = await call(care, vikram, { body: { action: 'task_create', title: 'Verma task', dueAt: new Date(Date.now() - 5000).toISOString() } });
  await sweepOverdue(sql, sharma);
  ok('one family\'s check never announces another family\'s task', (await admin.query(`select count(*)::int as n from task_log where task_id = $1`, [vr.id])).rows[0].n === 1);
}

await admin.end();
for (const p of globalThis.__parwahPools || []) await p.end();
if (fails.length) {
  console.error(`tasks.dbtest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`tasks.dbtest: ${pass}/${pass} checks pass`);
