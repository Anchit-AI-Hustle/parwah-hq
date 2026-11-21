// THE FUNCTION KIT against a real database, through the real handler
// (/api/plans?area=eventkit) on a real plan.
//
//   1. The plan's maker starts the kit and names hosts. Hosts change it;
//      the rest of the family reads it; another family reads nothing.
//   2. Guests: from the tree (on Parwah or by name), and typed names with no
//      phone. Sides, the status of each invite, and a count of people.
//   3. Someone who has passed away is never a guest: refused when picked,
//      refused when typed (this family and a linked one), and left out of
//      every read once they are marked.
//   4. Tasks are ordinary family tasks, listed on the kit.
//   5. Arrivals: who arrives when, who receives them; "Reached safely" is
//      shown only to someone that trip already tells.
//   6. The budget beside the plan's shared costs: never to a child, and
//      only by the cost split's own rule.
//   7. The guest sheet, by side.
import { kit } from './jkit.mjs';
const k = await kit('eventkit.dbtest', ['plans', 'care', 'chats', 'circle']);
const { ok, call, user, family, seat, pushed, pushedTo, admin, sql, api } = k;
const EK = await import('../../../api/_eventkit.mjs');
// The plans route makes its own tables on first use; then the kit's.
await call(api.plans, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });
await EK.ensureEventkitSchema(sql);

const fam = await family('SHARMA24', 'Sharma Family'), other = await family('VERMA024', 'Verma Family');
const U = {}; for (const nm of ['Rohan', 'Meena', 'Papa', 'Kabir', 'Chacha', 'Vikram']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' }), meena = await seat(fam, U.Meena, { dob: '1990-07-09' });
const papa = await seat(fam, U.Papa, { role: 'parent', dob: '1958-01-20' }), kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });
const chacha = await seat(fam, U.Chacha, { dob: '1985-01-01' });
const dadi = await seat(fam, { name: 'Dadi' }, { role: 'parent', dob: '1936-02-02' });
const dadaji = await seat(fam, { name: 'Dadaji' }, { role: 'parent', dob: '1930-01-01' });
await admin.query(`update members set remembered = true where id = $1`, [dadaji.id]);
const vikram = await seat(other, U.Vikram, { dob: '1980-01-01' });
const outsider = { id: vikram.id, token: vikram.token, code: 'SHARMA24' };

const P = (who, action, body = {}) => call(api.plans, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const G = (who, plan) => call(api.plans, { method: 'GET', token: who.token, query: { area: 'eventkit', circle: who.code, member: who.id, plan } });
const at = new Date(Date.now() + 20 * 86400000).toISOString();
let r = await P(rohan, 'create', { title: 'Neha ki shaadi', kind: 'function', at, place: 'Lucknow' });
const planId = r.id;
ok('setup: a function plan, made by Rohan', r.status === 201 && !!planId);
const vPlan = (await P(vikram, 'create', { title: 'Verma housewarming', kind: 'function', at })).id;

// ----------------------------------------------------------- 1. the hosts
r = await G(meena, planId);
ok('1. before the kit: the plan, no kit, and only its maker may start one', r.ok && r.kit === null && r.canStart === false && (await G(rohan, planId)).canStart === true);
ok('1. someone who did not make the plan cannot start its kit', (await P(meena, 'kit_start', { planId })).status === 403);
ok('1. an outsider cannot read or start it', (await G(outsider, planId)).status === 403 && (await P(outsider, 'kit_start', { planId })).status === 403);
ok('1. another family cannot find this plan', (await G(vikram, planId)).status === 404 && (await P(vikram, 'kit_start', { planId })).status === 404);
r = await P(rohan, 'kit_start', { planId });
ok('1. the maker starts the kit, with three sides to begin', r.status === 201 && r.kit.canEdit === true && r.kit.isMaker === true && r.kit.sides.join('|') === 'Our family|Their family|Friends');
ok('1. the family reads it and cannot change it', (await G(meena, planId)).kit.canEdit === false && (await P(meena, 'kit_guest_add', { planId, name: 'Sharma ji' })).status === 403);
ok('1. only the maker names hosts', (await P(meena, 'kit_hosts_set', { planId, hosts: [meena.id] })).status === 403);
ok('1. a host is someone on Parwah who is with us: not Dadi by name, not Dadaji, not another family',
  (await P(rohan, 'kit_hosts_set', { planId, hosts: [dadi.id] })).status === 400 && (await P(rohan, 'kit_hosts_set', { planId, hosts: [dadaji.id] })).status === 400
  && (await P(rohan, 'kit_hosts_set', { planId, hosts: [vikram.id] })).status === 400);
let mark = pushed.length;
r = await P(rohan, 'kit_hosts_set', { planId, hosts: [meena.id] });
ok('1. Meena is named a host, and is told', r.ok && r.kit.hosts.map(h => h.name).join() === 'Meena' && pushedTo(mark, /made you a host of Neha ki shaadi/).join() === meena.id);
ok('1. a host can now change the kit', (await G(meena, planId)).kit.canEdit === true && (await P(meena, 'kit_sides_set', { planId, sides: ['Ladki wale', 'Ladke wale', 'Dost', 'ladki wale'] })).kit.sides.join('|') === 'Ladki wale|Ladke wale|Dost');
ok('1. a child reads the kit but changes nothing', (await G(kabir, planId)).kit.canEdit === false && (await P(kabir, 'kit_sides_set', { planId, sides: ['X'] })).status === 403);

// ------------------------------------------------------------- 2. guests
r = await P(meena, 'kit_guest_add', { planId, memberIds: [papa.id, dadi.id, chacha.id], side: 'Ladki wale' });
ok('2. guests picked from the tree, on Parwah or by name', r.status === 201 && r.kit.guests.map(g => g.name).sort().join() === 'Chacha,Dadi,Papa' && r.kit.guests.every(g => g.status === 'to_invite' && g.side === 'Ladki wale'));
r = await P(meena, 'kit_guest_add', { planId, memberIds: [papa.id], side: 'Ladki wale' });
ok('2. the same person is not added twice', r.kit.guests.filter(g => g.name === 'Papa').length === 1);
r = await P(rohan, 'kit_guest_add', { planId, name: 'Gupta ji and family', side: 'Ladke wale', people: 4, note: 'Old neighbours' });
ok('2. a typed name, with how many people come with the invite', r.status === 201 && r.kit.guests.find(g => g.name === 'Gupta ji and family').people === 4);
ok('2. a phone number is not kept on the guest list', (await P(rohan, 'kit_guest_add', { planId, name: 'Verma ji 9810012345' })).status === 400);
ok('2. a side must be one on the list', (await P(rohan, 'kit_guest_add', { planId, name: 'Mishra ji', side: 'Nobody' })).status === 400);
ok('2. the count of people is a number from 1 to 30', (await P(rohan, 'kit_guest_add', { planId, name: 'Mishra ji', people: 0 })).status === 400 && (await P(rohan, 'kit_guest_add', { planId, name: 'Mishra ji', people: 31 })).status === 400);
ok('2. someone from another family is not picked as a member', (await P(rohan, 'kit_guest_add', { planId, memberIds: [vikram.id] })).status === 400);
const gupta = r.kit.guests.find(g => g.name === 'Gupta ji and family'), papaG = r.kit.guests.find(g => g.name === 'Papa');
r = await P(meena, 'kit_guest_update', { id: gupta.id, status: 'coming' });
ok('2. an invite moves on: coming', r.ok && r.kit.guests.find(g => g.id === gupta.id).statusWords === 'Coming');
await P(meena, 'kit_guest_update', { id: papaG.id, status: 'invited', people: 2 });
r = await P(meena, 'kit_guest_update', { id: r.kit.guests.find(g => g.name === 'Chacha').id, status: 'not_coming' });
ok('2. the counts: invites by where they stand, and heads coming', r.kit.counts.invites === 4 && r.kit.counts.to_invite === 1 && r.kit.counts.invited === 1 && r.kit.counts.coming === 1 && r.kit.counts.not_coming === 1 && r.kit.counts.peopleComing === 4 && r.kit.counts.peopleInvited === 7, JSON.stringify(r.kit.counts));
ok('2. an unknown status is refused', (await P(meena, 'kit_guest_update', { id: gupta.id, status: 'maybe' })).status === 400);
ok('2. the family cannot change a guest, and another family cannot find one', (await P(papa, 'kit_guest_update', { id: gupta.id, status: 'invited' })).status === 403 && (await P(vikram, 'kit_guest_update', { id: gupta.id, status: 'invited' })).status === 404);
ok('2. a guest\'s name or note is never changed to hold an OTP or a card number', (await P(meena, 'kit_guest_update', { id: gupta.id, name: 'Gupta ji OTP 4821' })).status === 400
  && (await P(meena, 'kit_guest_update', { id: gupta.id, note: 'card 4111 1111 1111 1111' })).status === 400
  && (await G(meena, planId)).kit.guests.find(g => g.id === gupta.id).name === 'Gupta ji and family');
ok('2. nor is a side', (await P(meena, 'kit_sides_set', { planId, sides: ['Ladki wale', 'atm pin 4821'] })).status === 400 && (await G(meena, planId)).kit.sides.join('|') === 'Ladki wale|Ladke wale|Dost');
ok('2. the family reads the same list', (await G(papa, planId)).kit.guests.length === 4 && (await G(kabir, planId)).kit.guests.length === 4);

// -------------------------------------------------- 3. never the remembered
r = await P(rohan, 'kit_guest_add', { planId, memberIds: [dadaji.id] });
ok('3. someone who has passed away is refused as a guest, in words', r.status === 400 && /Dadaji is remembered here/.test(r.error));
r = await P(rohan, 'kit_guest_add', { planId, name: 'dadaji' });
ok('3. and when their name is typed', r.status === 400 && /remembered here/.test(r.error));
// A linked family's remembered person, by typed name.
const { ensureFamlinkSchema } = await import('../../../api/_famlink.mjs');
await ensureFamlinkSchema(sql);
const nanaji = await seat(other, { name: 'Nanaji Verma' });
await admin.query(`update members set remembered = true where id = $1`, [nanaji.id]);
await admin.query(`insert into family_links (a_circle, b_circle, a_member, b_member, status) values ($1,$2,$3,$4,'active')`, [fam.id, other.id, rohan.id, vikram.id]);
ok('3. nor someone remembered in a linked family', (await P(rohan, 'kit_guest_add', { planId, name: 'Nanaji Verma' })).status === 400);
ok('3. the people a host may pick never include them', !(await G(rohan, planId)).people.some(p => p.name === 'Dadaji'));
// Dadi is marked after being added: she leaves the list, the counts and the sheet.
await admin.query(`update members set remembered = true where id = $1`, [dadi.id]);
r = await G(rohan, planId);
ok('3. a guest marked afterwards is left out of the list, the counts and the sheet', !r.kit.guests.some(g => g.name === 'Dadi') && r.kit.counts.invites === 3 && !JSON.stringify(r.kit.sheet).includes('Dadi'));
await admin.query(`update members set remembered = false where id = $1`, [dadi.id]);

// --------------------------------------------------------------- 4. tasks
mark = pushed.length;
r = await P(meena, 'kit_task_add', { planId, title: 'Book the halwai', ownerId: chacha.id, dueDate: at.slice(0, 10) });
ok('4. a task with an owner and a date', r.status === 201 && r.kit.tasks.length === 1 && r.kit.tasks[0].ownerName === 'Chacha' && r.kit.tasks[0].dueDate === at.slice(0, 10), JSON.stringify(r.kit && r.kit.tasks));
const tk = await k.q1(`select q.status, q.claimed_by, q.notes from requests q where q.id = $1`, [r.kit.tasks[0].id]);
ok('4. it is an ordinary family task, given to its owner', tk.status === 'assigned' && tk.claimed_by === chacha.id && /Neha ki shaadi/.test(tk.notes));
ok('4. a task needs words', (await P(meena, 'kit_task_add', { planId, title: '  ' })).status === 400);
ok('4. the family cannot add tasks to the kit', (await P(papa, 'kit_task_add', { planId, title: 'X' })).status === 403);
ok('4. someone not on Parwah cannot own a task', (await P(meena, 'kit_task_add', { planId, title: 'Flowers', ownerId: dadi.id })).status === 400);

// ------------------------------------------------------------ 5. arrivals
const arr = new Date(Date.now() + 19 * 86400000).toISOString();
ok('5. who is arriving, and from where, never hold an OTP or a card number', (await P(meena, 'kit_arrival_add', { planId, who: 'Mausi cvv 123', arriveAt: arr, mode: 'train', from: 'Pune' })).status === 400
  && (await P(meena, 'kit_arrival_add', { planId, who: 'Mausi', arriveAt: arr, mode: 'train', from: '4111 1111 1111 1111' })).status === 400);
r = await P(meena, 'kit_arrival_add', { planId, who: 'Mausi from Pune', arriveAt: arr, mode: 'train', from: 'Pune', receiverId: chacha.id });
ok('5. who arrives when, how, from where, and who receives them', r.status === 201 && r.kit.arrivals[0].who === 'Mausi from Pune' && r.kit.arrivals[0].receiverName === 'Chacha' && r.kit.arrivals[0].modeWords === 'by train');
ok('5. whoever receives a guest is an adult with us', (await P(meena, 'kit_arrival_add', { planId, who: 'Bua', arriveAt: arr, receiverId: kabir.id })).status === 400
  && (await P(meena, 'kit_arrival_add', { planId, who: 'Bua', arriveAt: arr, receiverId: dadaji.id })).status === 400);
ok('5. nobody who has passed away arrives', (await P(meena, 'kit_arrival_add', { planId, travellerId: dadaji.id, arriveAt: arr })).status === 400 && (await P(meena, 'kit_arrival_add', { planId, who: 'Dadaji', arriveAt: arr })).status === 400);
ok('5. the family cannot add someone else\'s arrival', (await P(papa, 'kit_arrival_add', { planId, who: 'Tauji', arriveAt: arr })).status === 403 && (await P(papa, 'kit_arrival_add', { planId, travellerId: chacha.id, arriveAt: arr })).status === 403);
r = await P(papa, 'kit_arrival_add', { planId, travellerId: papa.id, arriveAt: new Date(Date.now() + 2 * 3600000).toISOString(), mode: 'flight', from: 'Delhi' });
ok('5. a member adds their own arrival', r.status === 201 && r.kit.arrivals.some(a => a.who === 'Papa' && a.mine));
const papaArr = r.kit.arrivals.find(a => a.who === 'Papa');
ok('5. a child cannot say "I will receive them"', (await P(kabir, 'kit_arrival_receive', { id: papaArr.id })).status === 403);
r = await P(chacha, 'kit_arrival_receive', { id: papaArr.id });
ok('5. an adult says "I will receive them"', r.ok && r.kit.arrivals.find(a => a.id === papaArr.id).receiverName === 'Chacha');
ok('5. and a second person cannot take that place', (await P(meena, 'kit_arrival_receive', { id: papaArr.id })).status === 409);
// "Reached safely": Papa starts a trip and tells only Chacha.
const { ensureAshirwadSchema } = await import('../../../api/_ashirwad.mjs');
await ensureAshirwadSchema(sql);
await admin.query(`insert into trips (circle_id, member_id, dest, mode, expect_at, tell) values ($1,$2,'Lucknow','flight',$3,$4)`, [fam.id, papa.id, new Date(Date.now() + 3600000), [chacha.id]]);
const tripOf = async who => (await G(who, planId)).kit.arrivals.find(a => a.id === papaArr.id).trip;
ok('5. "Reached safely" shows to the traveller and to the person the trip tells', (await tripOf(papa)).status === 'open' && (await tripOf(chacha)).status === 'open');
ok('5. and to nobody the trip does not tell: not the host, not a child', (await tripOf(meena)) === null && (await tripOf(rohan)) === null && (await tripOf(kabir)) === null);
ok('5. a member removes their own arrival; the family cannot remove another\'s', (await P(kabir, 'kit_arrival_remove', { id: papaArr.id })).status === 403 && (await P(papa, 'kit_arrival_remove', { id: papaArr.id })).ok);

// -------------------------------------------------------------- 6. budget
ok('6. the family cannot set the budget', (await P(papa, 'kit_budget_set', { planId, amount: '500000' })).status === 403);
ok('6. a budget is a whole number', (await P(rohan, 'kit_budget_set', { planId, amount: 'five lakh' })).status === 400);
r = await P(rohan, 'kit_budget_set', { planId, amount: '5,00,000' });
ok('6. a host sets the budget', r.ok && /5,00,000/.test(r.kit.budget.planned) && r.kit.budget.over === false, JSON.stringify(r.kit.budget));
await P(rohan, 'split_add', { planId, what: 'Advance to the tent house', amount: '50000', paidBy: rohan.id, between: [rohan.id, meena.id] });
r = await G(rohan, planId);
ok('6. what has been spent comes from the plan\'s shared costs', /50,000/.test(r.kit.budget.spent) && /4,50,000/.test(r.kit.budget.left), JSON.stringify(r.kit.budget));
ok('6. Meena, who shares a cost, sees the money too', /50,000/.test((await G(meena, planId)).kit.budget.spent));
r = await G(papa, planId);
ok('6. someone who is not on the plan\'s costs is not shown the money', r.kit.budget.hidden === true && !/50,000|5,00,000/.test(JSON.stringify(r)));
r = await G(kabir, planId);
ok('6. a child is shown no money at all', r.kit.budget === null && !/50,000|5,00,000/.test(JSON.stringify(r)));

// --------------------------------------------------------------- 7. sheet
r = await G(rohan, planId);
ok('7. the guest sheet is by side, in the order of the sides', r.kit.sheet.map(s => s.side).join('|') === 'Ladki wale|Ladke wale' && r.kit.sheet[0].guests.map(g => g.name).join() === 'Chacha,Dadi,Papa');
ok('7. each row has the name, the people and where the invite stands; no phone anywhere', r.kit.sheet[1].guests[0].name === 'Gupta ji and family' && r.kit.sheet[1].guests[0].people === 4 && r.kit.sheet[1].guests[0].status === 'Coming'
  && !/phone|\+91/.test(JSON.stringify(r.kit.sheet)));
ok('7. a side\'s head count leaves out those not coming', r.kit.sheet[0].people === 3 && r.kit.sheet[1].people === 4);
r = await P(rohan, 'kit_guest_remove', { id: gupta.id });
ok('7. a host removes a guest', r.ok && !r.kit.guests.some(g => g.id === gupta.id));

// ------------------------------------------------------- other families
ok('8. the other family\'s kit is its own', (await P(vikram, 'kit_start', { planId: vPlan })).status === 201 && (await G(vikram, vPlan)).kit.guests.length === 0 && (await G(rohan, vPlan)).status === 404);

await k.finish();
