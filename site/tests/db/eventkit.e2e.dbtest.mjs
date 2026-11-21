// THE FUNCTION KIT, END TO END: a real browser, the real API and a real
// PostgreSQL. Rohan opens the kit from his function plan, starts it, picks
// guests from the family tree and types one in, moves an invite on, adds a
// task and an arrival, sets the budget and opens the guest sheet to print.
// Papa, who is not a host, reads it and says "I will receive them". A child
// reads it and sees no money.
//
// Every new surface is measured: 44px targets, a 12px floor, AA contrast in
// light and dark, nothing sideways at 320, 390 or 1280. Nothing here waits
// a fixed time: each step waits for the element or the state it checks.
import { kit, browserKit } from './jkit.mjs';
const k = await kit('eventkit.e2e', ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games', 'ekta']);
const { ok, call, user, family, seat, admin, api } = k;
const B = await browserKit('eventkit.e2e', k);
const { phone, sees, shown, gone, design, wide, toastSays, confirmSheet, T } = B;

const fam = await family('SHARMA24', 'Sharma Family');
const U = {}; for (const nm of ['Rohan', 'Meena', 'Papa', 'Kabir']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' }), meena = await seat(fam, U.Meena, { dob: '1990-07-09' });
const papa = await seat(fam, U.Papa, { role: 'parent', dob: '1958-01-20' }), kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });
await seat(fam, { name: 'Dadi' }, { role: 'parent', dob: '1936-02-02' });
const dadaji = await seat(fam, { name: 'Dadaji' }, { role: 'parent', dob: '1930-01-01' });
await admin.query(`update members set remembered = true where id = $1`, [dadaji.id]);
const at = new Date(Date.now() + 20 * 86400000);
const made = await call(api.plans, { token: rohan.token, body: { code: rohan.code, memberId: rohan.id, action: 'create', title: 'Neha ki shaadi', kind: 'function', at: at.toISOString(), place: 'Lucknow' } });
await call(api.plans, { token: rohan.token, body: { code: rohan.code, memberId: rohan.id, action: 'create', title: 'Sunday call', kind: 'call', at: at.toISOString() } });

const openKit = async (page) => {
  await page.click('#fun-seg [data-sec="plans"]');
  await page.waitForSelector('#plist [data-kdkit="' + made.id + '"]', T);
  await page.click('#plist [data-kdkit="' + made.id + '"]');
  await page.waitForSelector('#kd-kit-body .card, #kd-kit-body .ev:not(:has-text("Loading"))', T);
};

// ---- Rohan, who made the plan
const R = await phone(rohan, { hash: '#fun' });
await R.click('#fun-seg [data-sec="plans"]');
await R.waitForSelector('#plist [data-kdkit]', T);
ok('plans: a function plan has a "Shaadi / function kit" button, and a call does not', await R.locator('#plist [data-kdkit]').count() === 1 && (await R.textContent('#plist [data-kdkit]')).includes('Shaadi / function kit'));
await R.click('#plist [data-kdkit]');
ok('kit: it opens on the plan, with its day and place', await shown(R, '#kd-kit') && await sees(R, '#kd-kit-title', /Neha ki shaadi/) && await sees(R, '#kd-kit-when', /Lucknow/));
ok('kit: the maker is offered "Start the kit", in plain words', await sees(R, '#kd-kit-start', /The whole family can see it/));
await design(R, '#kd-kit', 'the function kit before it is started');
await R.click('#kd-kit-start [data-kdk="start"]');
ok('kit: started, with guests, tasks, arrivals, budget and hosts', await toastSays(R, /The kit is ready/) && await shown(R, '#kd-kit-guests') && await shown(R, '#kd-kit-tasks') && await shown(R, '#kd-kit-arrivals') && await shown(R, '#kd-kit-budget') && await shown(R, '#kd-kit-setup'));

// guests: from the tree, then a typed name
await R.click('#kd-kit-pick summary');
ok('guests: the family tree is offered, by name too, and never someone who has passed away', (await R.textContent('#kd-kit-people')).includes('Dadi (by name)') && !(await R.textContent('#kd-kit-people')).includes('Dadaji'));
await R.check('#kd-kit-people input[value="' + papa.id + '"]'); await R.check('#kd-kit-people label:has-text("Dadi") input');
await R.click('[data-kdk="gpick"]');
ok('guests: Papa and Dadi are on the list', await toastSays(R, /Added to the guest list/) && await sees(R, '#kd-kit-counts', /2 invites · 2 to invite/));
await R.click('#kd-kit-type summary');
await R.fill('#kd-kit-gname', 'Gupta ji and family'); await R.selectOption('#kd-kit-gside', 'Their family'); await R.fill('#kd-kit-gpeople', '4'); await R.fill('#kd-kit-gnote', 'Old neighbours');
await R.click('[data-kdk="gadd"]');
ok('guests: a typed name with four people, under its side', await sees(R, '#kd-kit-guests', /Gupta ji and family/) && await sees(R, '#kd-kit-guests', /4 people · Old neighbours/) && await sees(R, '#kd-kit-counts', /3 invites/));
ok('guests: it says no phone number is needed', (await R.textContent('#kd-kit-type')).includes('No phone number is needed'));
await R.selectOption('#kd-kit-guests .crow:has-text("Gupta ji") select[data-kdgstat]', 'coming');
ok('guests: the invite moves to Coming, and the head count follows', await sees(R, '#kd-kit-counts', /1 coming · 0 not coming · 4 people coming so far/));
await R.click('#kd-kit-type summary'); await R.fill('#kd-kit-gname', 'Dadaji'); await R.click('[data-kdk="gadd"]');
ok('guests: a name of someone who has passed away is refused kindly', await toastSays(R, /Dadaji is remembered here/));
await design(R, '#kd-kit', 'the function kit with guests, as a host');
await wide(R, 'the function kit');

// a task, an arrival, the budget
await R.click('#kd-kit-taskadd summary'); await R.fill('#kd-kit-ttitle', 'Book the halwai'); await R.selectOption('#kd-kit-towner', meena.id); await R.click('[data-kdk="tadd"]');
ok('tasks: a task with an owner', await toastSays(R, /Task added/) && await sees(R, '#kd-kit-tasks', /Book the halwai/) && await sees(R, '#kd-kit-tasks', /Meena has it/));
await R.click('#kd-kit-arradd summary'); await R.fill('#kd-kit-aname', 'Mausi from Pune');
await R.fill('#kd-kit-aat', new Date(at.getTime() - 86400000).toISOString().slice(0, 16)); await R.selectOption('#kd-kit-amode', 'train'); await R.fill('#kd-kit-afrom', 'Pune');
await R.click('[data-kdk="aadd"]');
ok('arrivals: who, when, how and from where, and that nobody receives them yet', await sees(R, '#kd-kit-arrivals', /Mausi from Pune/) && await sees(R, '#kd-kit-arrivals', /by train from Pune/) && await sees(R, '#kd-kit-arrivals', /Nobody is receiving them yet/));
await R.fill('#kd-kit-bamt', '500000'); await R.click('[data-kdk="bset"]');
ok('budget: planned, spent so far and what is left, and that Parwah moves no money', await sees(R, '#kd-kit-budget', /Planned: .*5,00,000/) && await sees(R, '#kd-kit-budget', /Spent so far/) && await sees(R, '#kd-kit-budget', /Parwah does not move money/));

// the guest sheet
await R.click('[data-kdk="sheet"]');
ok('sheet: a page to print, by side, with heads and where each invite stands', await shown(R, '#kd-paper') && await sees(R, '#kd-paper-title', /Neha ki shaadi/) && await sees(R, '#kd-paper-body', /Our family \(2 people\)/)
  && await sees(R, '#kd-paper-body', /☐ Gupta ji and family · 4 people · Coming · Old neighbours/) && await sees(R, '#kd-paper-body', /no phone numbers are kept/));
ok('sheet: only the sheet prints', await R.evaluate(() => document.body.classList.contains('kdprint')));
await design(R, '#kd-paper', 'the guest sheet');
await R.click('#kd-paper-x');
ok('sheet: closed, and the print rule is taken off', await gone(R, '#kd-paper') && !(await R.evaluate(() => document.body.classList.contains('kdprint'))));

// hosts
await R.click('#kd-kit-setup details:has-text("Choose the hosts") summary');
await R.check('#kd-kit-hostpick input[value="' + meena.id + '"]'); await R.click('[data-kdk="hosts"]');
ok('hosts: Meena is named a host', await toastSays(R, /Hosts saved/) && await sees(R, '#kd-kit-hosts', /Rohan \(made the plan\), Meena/));

// ---- Papa: reads it, cannot change it, and offers to receive
const P = await phone(papa, { hash: '#fun' });
await openKit(P);
ok('family: Papa reads the guests and where each invite stands', await sees(P, '#kd-kit-hosts', /The hosts change it\. Everyone in the family can see it\./) && await sees(P, '#kd-kit-guests', /Gupta ji and family/) && await sees(P, '#kd-kit-guests', /Coming/));
ok('family: no controls to change guests, tasks, budget or hosts', await P.locator('#kd-kit select[data-kdgstat], #kd-kit [data-kdk="gdel"], #kd-kit-pick, #kd-kit-taskadd, #kd-kit [data-kdk="bset"], #kd-kit-setup').count() === 0);
ok('family: the costs are for the people who share them', await sees(P, '#kd-kit-budget', /seen by the people who share them/));
await design(P, '#kd-kit', 'the function kit as the family reads it');
await P.click('#kd-kit-arrivals [data-kdk="recv"]');
ok('family: "I will receive them"', await toastSays(P, /you will receive them/) && await sees(P, '#kd-kit-arrivals', /Received by Papa/));

// ---- a child: reads, no money
const K = await phone(kabir, { hash: '#fun' });
await openKit(K);
ok('child: reads the guest list, and is shown no budget at all', await sees(K, '#kd-kit-guests', /Gupta ji and family/) && await K.locator('#kd-kit-budget').count() === 0 && !/5,00,000/.test(await K.textContent('#kd-kit-body')));
await K.click('#kd-kit-x');
ok('the kit closes', await gone(K, '#kd-kit'));

await B.finish();
