// CARER LOAD AND RESPITE, END TO END: a real browser, the real API and a
// real PostgreSQL. Priya sees what she did this week, which only she sees,
// and asks for a day off naming a task. Rohan sees one gentle line with no
// number in it, and says yes. A child is told it is for the adults. An
// adult switches it off for the family.
//
// Every new surface is measured: 44px targets, a 12px floor, AA contrast in
// light and dark, nothing sideways at 320, 390 or 1280. Nothing here waits
// a fixed time: each step waits for the element or the state it checks.
import { kit, browserKit } from './jkit.mjs';
const k = await kit('carerload.e2e', ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games', 'ekta']);
const { ok, user, family, seat, pushed, admin, sql } = k;
const CL = await import('../../../api/_carerload.mjs');
await CL.ensureCarerSchema(sql);
const B = await browserKit('carerload.e2e', k);
const { phone, sees, shown, gone, design, wide, toastSays, confirmSheet, T } = B;

const fam = await family('SHARMA24', 'Sharma Family');
const U = {}; for (const nm of ['Priya', 'Rohan', 'Maa', 'Kabir']) U[nm] = await user(nm);
const priya = await seat(fam, U.Priya, { dob: '1990-07-09' }), rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' });
const maa = await seat(fam, U.Maa, { role: 'parent', dob: '1958-01-20' }), kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });

// Two weeks in which Priya did most of the looking-after for Maa.
const now = Date.now(), DAY = 86400000;
async function doneTask(by, daysAgo, title) {
  const at = new Date(now - daysAgo * DAY);
  const t = (await admin.query(`insert into requests (circle_id, by_member, title, status, claimed_by, about_member, completed_by, completed_at)
                                values ($1,$2,$3,'done',$2,$4,$2,$5) returning id`, [fam.id, by.id, title, maa.id, at])).rows[0];
  await admin.query(`insert into task_log (task_id, circle_id, member_id, action, created_at) values ($1,$2,$3,'done',$4)`, [t.id, fam.id, by.id, at]);
}
for (const d of [1, 2, 3, 4, 5, 8, 9, 10, 11, 12]) await doneTask(priya, d, 'Evening walk with Maa');
await doneTask(rohan, 2, 'Bought vegetables'); await doneTask(rohan, 9, 'Paid the bill');
await admin.query(`insert into requests (circle_id, by_member, title, status, claimed_by, about_member, due_at) values ($1,$2,'Evening medicines for Maa','claimed',$2,$3,$4)`,
  [fam.id, priya.id, maa.id, new Date(now + 3 * DAY)]);

// One of the folded sections of To do: a person opens "More" first.
const haath = async (page) => { await page.waitForSelector('#tn-care-more', T); if (!(await page.isVisible('#care-seg [data-sec="haath"]'))) await page.click('#tn-care-more'); await page.click('#care-seg [data-sec="haath"]'); await page.waitForSelector('#kd-cl-body .card, #kd-cl-body .ev:not(:has-text("Loading"))', T); };

// ---- Priya
const P = await phone(priya, { hash: '#care' });
await P.waitForSelector('#tn-care-more', T); await P.click('#tn-care-more');
ok('to do: "Thoda sa haath batao" is its own section, one tap away under "More"', await shown(P, '#care-seg [data-sec="haath"]'));
await haath(P);
ok('mine: what she did this week, in words, and that only she sees it', await sees(P, '#kd-cl-mine', /5 things done for the family/) && await sees(P, '#kd-cl-note', /Only you can see it/));
ok('line: her own, kinder line', await sees(P, '#kd-cl-line', /You have been doing a lot for Maa lately\. It is fine to ask for a hand/));
ok('ask: the days ahead and her own duties are offered', await P.locator('#kd-cl-day option').count() === 8 && (await P.textContent('#kd-cl-task')).includes('Evening medicines for Maa'));
await design(P, '#pane-care .subsec[data-sec="haath"]', 'carer load as the person sees their own week');
await wide(P, 'carer load');
const duty = await P.getAttribute('#kd-cl-task option:nth-child(2)', 'value');
await P.selectOption('#kd-cl-task', duty);
const day = await P.inputValue('#kd-cl-day');
ok('ask: choosing the task sets the day it falls on', day === await P.getAttribute('#kd-cl-task option:nth-child(2)', 'data-day'));
const mark = pushed.length;
await P.click('#kd-cl-go');
ok('ask: the family is asked', await toastSays(P, /The family has been asked/) && await sees(P, '#kd-cl-asks', /You asked for/) && await sees(P, '#kd-cl-asks', /To hand over: Evening medicines for Maa/));
ok('ask: the other adults are pushed, never the child', pushed.slice(mark).filter(p => /Priya needs a day off/.test(p.body.title)).map(p => p.to).sort().join() === [rohan.id, maa.id].sort().join());

// ---- Rohan
const R = await phone(rohan, { hash: '#care' });
await haath(R);
const line = await R.textContent('#kd-cl-line');
ok('line: Rohan reads one gentle line about Priya and Maa, naming a day', /Priya has been doing a lot for Maa lately\. Could someone take \w+day\?/.test(line), line);
ok('line: there is no number in it', !/\d/.test(line));
const rText = await R.textContent('#kd-cl-body');
ok('mine: Rohan sees his own week and nothing of Priya\'s', /One thing done for the family/.test(rText) && !/5 things/.test(rText));
ok('asks: Priya\'s ask is there with one button', await sees(R, '#kd-cl-asks', /Priya needs a day off on/) && await R.locator('#kd-cl-asks [data-kdcl="take"]').count() === 1);
await design(R, '#pane-care .subsec[data-sec="haath"]', 'carer load with the family line and an open ask');
await R.click('#kd-cl-asks [data-kdcl="take"]');
ok('take: Rohan says yes and is thanked', await toastSays(R, /Thank you\. They have been told/) && await sees(R, '#kd-cl-asks', /✓ You will take/));
const t = await k.q1(`select claimed_by from requests where title = 'Evening medicines for Maa'`);
ok('take: the task is Rohan\'s now', t.claimed_by === rohan.id);
await P.click('#care-seg [data-sec="rem"]'); await haath(P);
ok('take: Priya sees that Rohan will take it', await sees(P, '#kd-cl-asks', /✓ Rohan will take/));

// ---- Maa, who is looked after, and a child
const M = await phone(maa, { hash: '#care' });
await haath(M);
ok('the person looked after is not shown a line about it', await shown(M, '#kd-cl-mine') && await M.locator('#kd-cl-line').count() === 0);
const K = await phone(kabir, { hash: '#care' });
await haath(K);
ok('a child is told this is for the adults, and sees nothing else', await sees(K, '#kd-cl-body', /This part is for the adults of the family/) && await K.locator('#kd-cl-body .card').count() === 0);

// ---- the family switch
await R.click('#kd-cl-switch summary');
await R.click('#kd-cl-switch [data-kdcl="off"]');
await confirmSheet(R);
ok('switch: off for the family', await toastSays(R, /Switched off for the family/) && await shown(R, '#kd-cl-off') && await R.locator('#kd-cl-mine, #kd-cl-line, #kd-cl-asks').count() === 0);
await design(R, '#pane-care .subsec[data-sec="haath"]', 'carer load switched off');
await P.click('#care-seg [data-sec="rem"]'); await haath(P);
ok('switch: Priya sees it is off too, with a way back on', await shown(P, '#kd-cl-off [data-kdcl="on"]'));
await P.click('#kd-cl-off [data-kdcl="on"]');
ok('switch: on again', await toastSays(P, /Switched on for the family/) && await shown(P, '#kd-cl-mine') && await gone(P, '#kd-cl-off'));

await B.finish();
