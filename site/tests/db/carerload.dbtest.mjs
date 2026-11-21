// CARER LOAD AND RESPITE against a real database, through the real handler
// (/api/care?area=carerload), with the clock handed in.
//
//   1. What I did this week is mine alone: each adult is sent their own
//      numbers and never anyone else's. A child is sent none of it.
//   2. Every source counts: a task marked done through the real task
//      handler, a medicine ticked for someone else, a visit written down, a
//      call on the rota, a child collected.
//   3. The gentle line: only when one person carried most of it two weeks
//      running, with no number in it, a different line for the person
//      themself, and nothing for the person being looked after.
//   4. The family switch turns all of it off.
//   5. "I need a day off": asks the other adults, names a task, changes
//      hands when someone says yes; limited; never to a child, someone not
//      on Parwah or someone who has passed away.
//   6. Another family reads and changes nothing.
import { kit } from './jkit.mjs';
const k = await kit('carerload.dbtest', ['care', 'events']);
const { ok, call, user, family, seat, pushed, pushedTo, admin, sql, api } = k;
const CL = await import('../../../api/_carerload.mjs');
const R = await import('../../../api/_carerloadrules.mjs');
const { ensureDoseSchema } = await import('../../../api/_doses.mjs');
const { ensureKidsSchema } = await import('../../../api/_kids.mjs');
await CL.ensureCarerSchema(sql); await ensureDoseSchema(sql); await ensureKidsSchema(sql);

const fam = await family('SHARMA24', 'Sharma Family'), other = await family('VERMA024', 'Verma Family');
const U = {}; for (const nm of ['Priya', 'Rohan', 'Maa', 'Kabir', 'Vikram', 'Anil']) U[nm] = await user(nm);
const priya = await seat(fam, U.Priya, { dob: '1990-07-09' }), rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' });
const maa = await seat(fam, U.Maa, { role: 'parent', dob: '1958-01-20' }), kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });
const dadi = await seat(fam, { name: 'Dadi' }, { role: 'parent', dob: '1936-02-02' });
const dadaji = await seat(fam, { name: 'Dadaji' }, { role: 'parent', dob: '1930-01-01' });
await admin.query(`update members set remembered = true where id = $1`, [dadaji.id]);
const vikram = await seat(other, U.Vikram, { dob: '1980-01-01' }), anil = await seat(other, U.Anil, { dob: '1982-01-01' });
const outsider = { id: vikram.id, token: vikram.token, code: 'SHARMA24' };

const now = Date.now();
CL.carerSeams.now = () => Date.now() + 5000;   // a moment after what the real handlers have just written
const DAY = 86400000;
const P = (who, action, body = {}) => call(api.care, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const G = (who) => call(api.care, { method: 'GET', token: who.token, query: { area: 'carerload', circle: who.code, member: who.id } });
// A task about someone, marked done by someone, some days ago.
async function doneTask(by, about, daysAgo, title = 'Evening walk with Maa', template = null) {
  const at = new Date(now - daysAgo * DAY);
  const t = (await admin.query(`insert into requests (circle_id, by_member, title, status, claimed_by, about_member, completed_by, completed_at, template)
                                values ($1,$2,$3,'done',$2,$4,$2,$5,$6) returning id`, [fam.id, by.id, title, about ? about.id : null, at, template])).rows[0];
  await admin.query(`insert into task_log (task_id, circle_id, member_id, action, created_at) values ($1,$2,$3,'done',$4)`, [t.id, fam.id, by.id, at]);
  return t.id;
}

// ------------------------------------------------------- 1. mine, alone
let r = await G(priya);
ok('1. on by default, and a quiet week says so kindly', r.ok && r.on === true && r.adult === true && r.mine.total === 0 && /That is fine\. Only you can see this/.test(r.mine.note) && r.line === null);
r = await G(kabir);
ok('1. a child is sent none of it', r.ok && r.adult === false && r.mine === null && r.line === null && r.asks.length === 0 && r.duties.length === 0);
ok('1. an outsider is refused', (await G(outsider)).status === 403);

// ------------------------------------------------------------ 2. sources
// Through the real task handler: Priya makes a task about Maa and marks it done.
r = await P(priya, 'task_create', { title: 'Collect Maa\'s reports', aboutMemberId: maa.id, ownerId: 'me' });
ok('2. a real task is made', r.ok && !!r.id, JSON.stringify(r).slice(0, 160));
ok('2. and marked done through the task handler', (await P(priya, 'task_done', { taskId: r.id })).ok);
// A medicine ticked for Maa by Priya.
const med = (await admin.query(`insert into family_book (circle_id, kind, name, about_member, by_member) values ($1,'medicine','Amlopres 5',$2,$3) returning id`, [fam.id, maa.id, priya.id])).rows[0].id;
const sch = (await admin.query(`insert into medicine_schedules (circle_id, person_id, medicine_id, times) values ($1,$2,$3,'{08:00}') returning id`, [fam.id, maa.id, med])).rows[0].id;
const dose = (by, hoursAgo) => admin.query(`insert into medicine_doses (circle_id, person_id, medicine_id, schedule_id, slot, tz, due_at, status, taken_at, marked_by)
                                            values ($1,$2,$3,$4,'08:00','Asia/Kolkata',$5,'taken',$5,$6)`, [fam.id, maa.id, med, sch, new Date(now - hoursAgo * 3600000), by.id]);
await dose(priya, 5); await dose(maa, 29);   // Maa ticking her own is not looking after someone else
// A visit written down, a rota call, a school pick-up.
await admin.query(`insert into audio_consultations (circle_id, person_id, created_by, created_at) values ($1,$2,$3,$4)`, [fam.id, maa.id, priya.id, new Date(now - 2 * DAY)]);
await doneTask(priya, maa, 1, 'Daily call with Maa', 'callrota');
await admin.query(`insert into kid_pickups (circle_id, child_id, day, by_member, expect_at, picked_at, picked_by) values ($1,$2,current_date,$3,$4,$4,$3)`, [fam.id, kabir.id, priya.id, new Date(now - 3 * 3600000)]);
r = await G(priya);
ok('2. every source is counted for the person who did it', r.mine.total === 5 && r.mine.lines.join('|') === 'One thing done for the family|One medicine tick for someone else|One doctor visit written down|One call on the rota|One school pick-up', r.mine.lines.join('|'));
r = await G(maa);
ok('2. ticking my own medicine is not counted as looking after someone', r.mine.total === 0);
r = await G(rohan);
ok('1. Rohan is sent his own numbers only: nothing of Priya\'s', r.mine.total === 0 && !/medicine tick|pick-up|rota/.test(JSON.stringify(r)) && !('counts' in r) && !('everyone' in r));

// ---------------------------------------------------------- 3. the line
ok('3. one busy week is not two: no line yet', (await G(rohan)).line === null);
// Last week too: Priya did most of it, Rohan a little. And one more from Rohan this week.
for (const d of [8, 9, 10, 11, 12]) await doneTask(priya, maa, d);
await doneTask(rohan, maa, 9, 'Paid the electricity bill for Maa');
await doneTask(rohan, maa, 2, 'Bought vegetables for Maa');
// Priya's next duty is in three days: that names the day.
const dutyAt = new Date(now + 3 * DAY);
const duty = (await admin.query(`insert into requests (circle_id, by_member, title, status, claimed_by, about_member, due_at) values ($1,$2,'Evening medicines for Maa','claimed',$2,$3,$4) returning id`,
  [fam.id, priya.id, maa.id, dutyAt])).rows[0].id;
const { dayIn } = await import('../../../api/_recur.mjs');
const wd = R.weekdayOf(dayIn('Asia/Kolkata', dutyAt));
r = await G(rohan);
ok('3. two weeks running, the family is shown one gentle line', !!r.line && r.line.text === 'Priya has been doing a lot for Maa lately. Could someone take ' + wd + '?' && r.line.mine === false, JSON.stringify(r.line));
ok('3. no number is in it, and no word that shames', R.carerLineClean(r.line.text) && !/\d/.test(r.line.text));
ok('3. and no number about Priya is anywhere in what Rohan is sent', r.mine.total === 1 && !JSON.stringify({ ...r, mine: null, days: null, today: null, asks: null, status: null }).match(/\d/));
r = await G(priya);
ok('3. Priya reads a kinder line of her own', r.line.mine === true && r.line.text === 'You have been doing a lot for Maa lately. It is fine to ask for a hand. Tap "I need a day off".');
ok('3. her duty is listed for her, to name in an ask', r.duties.length === 1 && r.duties[0].title === 'Evening medicines for Maa' && r.duties[0].aboutName === 'Maa');
r = await G(maa);
ok('3. Maa, who is looked after, is not shown a line about it', r.line === null);
ok('3. a child is not shown it either', (await G(kabir)).line === null);
// The thresholds, in the database: a different person last week means no line.
await admin.query(`update task_log set member_id = $1 where member_id = $2 and created_at < $3`, [rohan.id, priya.id, new Date(now - 7 * DAY)]);
ok('3. a different person in each week: no line', (await G(rohan)).line === null);
await admin.query(`update task_log set member_id = $1 where member_id = $2 and created_at < $3 and task_id in (select id from requests where title = 'Evening walk with Maa')`, [priya.id, rohan.id, new Date(now - 7 * DAY)]);
ok('3. and back again when it is the same person', !!(await G(rohan)).line);

// ------------------------------------------------------------ 4. switch
ok('4. a child cannot switch it', (await P(kabir, 'carer_switch', { on: false })).status === 403);
r = await P(rohan, 'carer_switch', { on: false });
ok('4. an adult switches it off for the family', r.ok && r.on === false && r.mine === null && r.line === null);
r = await G(priya);
ok('4. off for everyone: no numbers, no line, no asks', r.on === false && r.mine === null && r.line === null && r.asks.length === 0);
ok('4. and no day off can be asked while it is off', (await P(priya, 'carer_dayoff', { day: dayIn('Asia/Kolkata', now) })).status === 409);
ok('4. the feed says who switched it', !!(await k.q1(`select 1 as x from events where circle_id = $1 and text like 'Rohan turned off%'`, [fam.id])));
ok('4. on again', (await P(maa, 'carer_switch', { on: true })).on === true);

// --------------------------------------------------------- 5. a day off
const today = dayIn('Asia/Kolkata', now), plus = n => new Date(Date.parse(today) + n * DAY).toISOString().slice(0, 10);
ok('5. a day that has passed is refused', (await P(priya, 'carer_dayoff', { day: plus(-1) })).status === 400);
ok('5. a day more than two weeks away is refused', (await P(priya, 'carer_dayoff', { day: plus(15) })).status === 400);
ok('5. a child cannot ask this way', (await P(kabir, 'carer_dayoff', { day: plus(1) })).status === 403);
const rohanTask = (await admin.query(`insert into requests (circle_id, by_member, title, status, claimed_by, due_at) values ($1,$2,'Rohan own task','claimed',$2,$3) returning id`, [fam.id, rohan.id, dutyAt])).rows[0].id;
ok('5. someone else\'s task cannot be named', (await P(priya, 'carer_dayoff', { day: plus(3), taskId: rohanTask })).status === 404);
let mark = pushed.length;
r = await P(priya, 'carer_dayoff', { day: plus(3), taskId: duty });
ok('5. Priya asks for a day off and names the task', r.status === 201 && r.asks.length === 1 && r.asks[0].mine === true && r.asks[0].taskTitle === 'Evening medicines for Maa');
const told = pushedTo(mark, /Priya needs a day off on/);
ok('5. the other adults on Parwah are asked: Rohan and Maa', told.sort().join() === [rohan.id, maa.id].sort().join(), told.join());
ok('5. never a child, someone not on Parwah, or someone who has passed away', ![kabir.id, dadi.id, dadaji.id, priya.id].some(id => told.includes(id)));
ok('5. the push names the day and the task', /needs a day off on \w+day \d+ \w+$/.test(pushed[mark].body.title) && /Could you take "Evening medicines for Maa" that day\?/.test(pushed[mark].body.body));
ok('5. the same day twice is one ask', (await P(priya, 'carer_dayoff', { day: plus(3) })).status === 409);
ok('5. Priya cannot take her own ask', (await P(priya, 'carer_take', { id: r.asks[0].id })).status === 400);
ok('5. only the asker takes it back', (await P(rohan, 'carer_cancel', { id: r.asks[0].id })).status === 403);
ok('5. a child cannot take it', (await P(kabir, 'carer_take', { id: r.asks[0].id })).status === 403);
ok('5. another family cannot take or even find it', (await P(vikram, 'carer_take', { id: r.asks[0].id })).status === 404 && (await P(outsider, 'carer_take', { id: r.asks[0].id })).status === 403);
const askId = r.asks[0].id;
r = await G(rohan);
ok('5. Rohan sees the ask, by name and day', r.asks.length === 1 && r.asks[0].byName === 'Priya' && r.asks[0].status === 'open' && r.asks[0].mine === false);
mark = pushed.length;
r = await P(rohan, 'carer_take', { id: askId });
ok('5. Rohan says yes', r.ok && r.asks[0].status === 'taken' && r.asks[0].takenByMe === true);
const t = await k.q1(`select claimed_by, status from requests where id = $1`, [duty]);
ok('5. the named task changes hands, and its history says why', t.claimed_by === rohan.id && t.status === 'claimed' && !!(await k.q1(`select 1 as x from task_log where task_id = $1 and note = 'taken for a day off'`, [duty])));
ok('5. Priya is told, warmly', pushedTo(mark, /Rohan will take/).join() === priya.id && /Rest well/.test(pushed[mark].body.body));
ok('5. it cannot be taken twice', (await P(maa, 'carer_take', { id: askId })).status === 409);
// The limit: three asks a day from one person.
r = await P(priya, 'carer_dayoff', { day: plus(4) });
const second = r.asks.find(a => a.day === plus(4)).id;
ok('5. she takes one back herself', (await P(priya, 'carer_cancel', { id: second })).ok && !(await G(rohan)).asks.some(a => a.id === second));
await P(priya, 'carer_dayoff', { day: plus(5) });
r = await P(priya, 'carer_dayoff', { day: plus(6) });
ok('5. a fourth ask in a day is refused, kindly', r.status === 429 && /A call to someone in the family may be quicker/.test(r.error));
// An ask by someone since marked as no longer with us is never listed.
await admin.query(`insert into carer_asks (circle_id, by_member, day) values ($1,$2,$3)`, [fam.id, dadaji.id, plus(2)]);
ok('5. an ask in the name of someone who has passed away is never listed', !(await G(rohan)).asks.some(a => a.byName === 'Dadaji'));

// --------------------------------------------------------- 6. families
r = await G(vikram);
ok('6. the other family sees none of this', r.ok && r.asks.length === 0 && r.line === null && r.mine.total === 0);
ok('6. with one adult on Parwah there is nobody to ask, and it says so', (await (async () => {
  await admin.query(`update members set remembered = true where id = $1`, [anil.id]);
  return P(vikram, 'carer_dayoff', { day: plus(1) });
})()).status === 409);

await k.finish();
