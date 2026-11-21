// HOME: REPAIRS AND WARRANTIES against a real database, through the real
// handler (/api/book?area=home) and the real renewals sweep with the clock
// handed in.
//
//   1. An entry: what, bought when and where, warranty, service, who to
//      call (a Family book contact), the bill (a Vault paper), who fixed it.
//   2. Who sees it, in the SQL: only me, people I choose, whole family,
//      only in an emergency (adults, while the writer has an SOS open).
//   3. The contact and the bill are shown only as far as the viewer may
//      already read them.
//   4. Only the writer changes or removes; an adult who may see it writes
//      down a repair; a child does not.
//   5. Reminders 30 and 7 days ahead, once each, through sweepRenewals,
//      only to people who may see the entry; never someone who has passed
//      away; "whole family" tells the adults.
//   6. Never a card number or a password. Another family reads nothing.
import { kit } from './jkit.mjs';
const k = await kit('home.dbtest', ['book', 'care', 'events']);
const { ok, call, user, family, seat, pushed, pushedTo, admin, sql, api } = k;
const H = await import('../../../api/_home.mjs');
const { sweepRenewals } = await import('../../../api/_renewals.mjs');
await H.ensureHomeSchema(sql);
await call(api.events, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });   // the SOS table

const fam = await family('SHARMA24', 'Sharma Family'), other = await family('VERMA024', 'Verma Family');
const U = {}; for (const nm of ['Rohan', 'Meena', 'Papa', 'Kabir', 'Vikram']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' }), meena = await seat(fam, U.Meena, { dob: '1990-07-09' });
const papa = await seat(fam, U.Papa, { role: 'parent', dob: '1958-01-20' }), kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });
const dadaji = await seat(fam, { name: 'Dadaji' }, { role: 'parent', dob: '1930-01-01' });
await admin.query(`update members set remembered = true where id = $1`, [dadaji.id]);
const vikram = await seat(other, U.Vikram, { dob: '1980-01-01' });
const outsider = { id: vikram.id, token: vikram.token, code: 'SHARMA24' };

const P = (who, action, body = {}) => call(api.book, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const G = (who) => call(api.book, { method: 'GET', token: who.token, query: { area: 'home', circle: who.code, member: who.id } });
const titles = r => r.items.map(i => i.title).sort().join(',');
const now = Date.now(), DAY = 86400000, day = n => new Date(now + n * DAY).toISOString().slice(0, 10);

// A contact everyone can read, a private one of Rohan's, and a bill in the Vault that only Rohan can open.
const electrician = (await admin.query(`insert into family_book (circle_id, kind, name, category, phone, by_member, visibility) values ($1,'contact','Sharma Electricals','local','+915224001234',$2,'circle') returning id`, [fam.id, rohan.id])).rows[0].id;
const secret = (await admin.query(`insert into family_book (circle_id, kind, name, category, phone, by_member, visibility) values ($1,'contact','Private mechanic','local','+919999999999',$2,'private') returning id`, [fam.id, rohan.id])).rows[0].id;
const bill = (await admin.query(`insert into vault_docs (circle_id, about_member, kind, label, by_member) values ($1,$2,'other','Fridge bill 2024',$2) returning id`, [fam.id, rohan.id])).rows[0].id;
const vBill = (await admin.query(`insert into vault_docs (circle_id, about_member, kind, label, by_member) values ($1,$2,'other','Verma bill',$2) returning id`, [other.id, vikram.id])).rows[0].id;

// ---------------------------------------------------------------- 1. add
let r = await G(rohan);
ok('1. the kinds, the four choices of who sees it, and what may be linked', r.ok && r.items.length === 0 && r.kinds.map(x => x[0]).join() === 'appliance,vehicle,house_doc'
  && r.who.map(x => x[1]).join('|') === 'Only me|People I choose|Whole family|Only in an emergency' && r.contacts.length === 2 && r.docs.length === 1);
r = await P(rohan, 'home_add', { kind: 'appliance', title: 'Fridge', boughtOn: '2024-06-01', boughtWhere: 'Vijay Sales, Hazratganj', warrantyUntil: day(20), serviceDue: day(5),
  callContactId: electrician, billDocId: bill, billNote: 'Invoice 4471', fixedNote: 'Ramesh changed the gasket', audience: 'IMMEDIATE' });
const fridge = r.items[0];
ok('1. an entry is saved with everything on it', r.status === 201 && fridge.title === 'Fridge' && fridge.boughtWhere === 'Vijay Sales, Hazratganj' && fridge.warrantyDays === 20 && fridge.serviceDays === 5
  && fridge.contact.name === 'Sharma Electricals' && fridge.bill.label === 'Fridge bill 2024' && fridge.fixedNote === 'Ramesh changed the gasket' && fridge.mine === true, JSON.stringify(fridge));
ok('1. it needs a kind, a name and a choice of who sees it', (await P(rohan, 'home_add', { title: 'X', audience: 'IMMEDIATE' })).status === 400
  && (await P(rohan, 'home_add', { kind: 'appliance', audience: 'IMMEDIATE' })).status === 400 && (await P(rohan, 'home_add', { kind: 'appliance', title: 'X' })).status === 400);
ok('1. a warranty cannot end before the thing was bought', (await P(rohan, 'home_add', { kind: 'appliance', title: 'X', boughtOn: '2025-01-01', warrantyUntil: '2024-01-01', audience: 'IMMEDIATE' })).status === 400);
ok('1. a contact from another family, or one I cannot read, is refused', (await P(meena, 'home_add', { kind: 'appliance', title: 'X', callContactId: secret, audience: 'IMMEDIATE' })).status === 400);
ok('1. a paper I cannot open, or from another family, is refused as the bill', (await P(meena, 'home_add', { kind: 'appliance', title: 'X', billDocId: bill, audience: 'IMMEDIATE' })).status === 400
  && (await P(rohan, 'home_add', { kind: 'appliance', title: 'X', billDocId: vBill, audience: 'IMMEDIATE' })).status === 400);
ok('6. never a card number or a password, in any box', (await P(rohan, 'home_add', { kind: 'appliance', title: 'TV', billNote: 'card 4111 1111 1111 1111', audience: 'IMMEDIATE' })).status === 400
  && (await P(rohan, 'home_add', { kind: 'appliance', title: 'Router', fixedNote: 'password: tiger@77', audience: 'IMMEDIATE' })).status === 400);

// ---------------------------------------------------------- 2. who sees
await P(rohan, 'home_add', { kind: 'vehicle', title: 'Scooter', serviceDue: day(6), audience: 'ONLY_ME' });
await P(rohan, 'home_add', { kind: 'house_doc', title: 'House tax receipt', audience: 'NOMINEES_ONLY', people: [meena.id] });
await P(rohan, 'home_add', { kind: 'house_doc', title: 'Almirah key place', audience: 'EMERGENCY_ONLY' });
ok('2. people I choose must be in this family, on Parwah and with us', (await P(rohan, 'home_add', { kind: 'appliance', title: 'X', audience: 'NOMINEES_ONLY', people: [vikram.id] })).status === 400
  && (await P(rohan, 'home_add', { kind: 'appliance', title: 'X', audience: 'NOMINEES_ONLY', people: [dadaji.id] })).status === 400
  && (await P(rohan, 'home_add', { kind: 'appliance', title: 'X', audience: 'NOMINEES_ONLY', people: [] })).status === 400);
ok('2. the writer reads all four', titles(await G(rohan)) === 'Almirah key place,Fridge,House tax receipt,Scooter');
ok('2. a person chosen reads the shared one and the family one', titles(await G(meena)) === 'Fridge,House tax receipt');
ok('2. anyone else reads only the family one', titles(await G(papa)) === 'Fridge' && titles(await G(kabir)) === 'Fridge');
ok('2. "only me" and "only in an emergency" do not exist for anyone else', !JSON.stringify(await G(papa)).includes('Scooter') && !JSON.stringify(await G(papa)).includes('Almirah'));
// Rohan raises an SOS: the emergency-only entry opens for the adults, never for a child.
await admin.query(`insert into sos (circle_id, member_id, status) values ($1,$2,'open')`, [fam.id, rohan.id]);
ok('2. while the writer has an SOS open, the adults read "only in an emergency"', titles(await G(papa)) === 'Almirah key place,Fridge' && titles(await G(meena)) === 'Almirah key place,Fridge,House tax receipt');
ok('2. a child does not, even then', titles(await G(kabir)) === 'Fridge');
await admin.query(`update sos set status = 'resolved' where circle_id = $1`, [fam.id]);
ok('2. and it closes again with the SOS', titles(await G(papa)) === 'Fridge');
const H2 = await import('../../../api/_needsrules.mjs');
ok('2. the pure rule says the same', H2.homeMaySee({ item: { created_by: 'r', audience: 'EMERGENCY_ONLY' }, viewerId: 'p', sosOpen: true }) === true
  && H2.homeMaySee({ item: { created_by: 'r', audience: 'EMERGENCY_ONLY' }, viewerId: 'k', viewerMinor: true, sosOpen: true }) === false
  && H2.homeMaySee({ item: { created_by: 'r', audience: 'ONLY_ME' }, viewerId: 'p' }) === false && H2.homeMaySee({ item: { created_by: 'r', audience: 'NOMINEES_ONLY', people: ['m'] }, viewerId: 'm' }) === true);

// ------------------------------------------------ 3. the contact and bill
r = await G(papa);
ok('3. Papa sees who to call: a contact the family shares', r.items[0].contact.name === 'Sharma Electricals' && r.items[0].contact.phone === '+915224001234');
ok('3. the bill is in Rohan\'s Vault: Papa is told there is one, and nothing about it', r.items[0].bill === null && r.items[0].billKept === true && !JSON.stringify(r).includes('Fridge bill 2024'));
await admin.query(`update home_items set call_contact = $1 where title = 'Fridge'`, [secret]);
r = await G(papa);
ok('3. a private contact is kept back the same way', r.items[0].contact === null && r.items[0].contactKept === true && !JSON.stringify(r).includes('Private mechanic') && !JSON.stringify(r).includes('9999999999'));
ok('3. and its owner still reads it', (await G(rohan)).items.find(i => i.title === 'Fridge').contact.name === 'Private mechanic');
await admin.query(`update home_items set call_contact = $1 where title = 'Fridge'`, [electrician]);
ok('3. a child is offered no Vault papers to link', (await G(kabir)).docs.length === 0);

// -------------------------------------------------------- 4. who changes
ok('4. only the writer changes an entry', (await P(meena, 'home_update', { id: fridge.id, kind: 'appliance', title: 'Our fridge', audience: 'IMMEDIATE' })).status === 403);
ok('4. and only the writer removes it', (await P(papa, 'home_remove', { id: fridge.id })).status === 403);
const scooter = (await G(rohan)).items.find(i => i.title === 'Scooter').id;
ok('4. an entry someone may not see answers as if it was never written', (await P(papa, 'home_update', { id: scooter, kind: 'vehicle', title: 'X', audience: 'IMMEDIATE' })).status === 404
  && (await P(papa, 'home_log', { id: scooter, note: 'x' })).status === 404 && (await P(papa, 'home_remove', { id: scooter })).status === 404);
r = await P(papa, 'home_log', { id: fridge.id, note: 'Imran from Sharma Electricals refilled the gas', serviceDue: day(200) });
ok('4. an adult who may see it writes down who fixed it last time', r.ok && r.items[0].fixedNote === 'Imran from Sharma Electricals refilled the gas' && r.items[0].fixedByName === 'Papa' && r.items[0].serviceDue === day(200));
ok('4. a child does not write a repair', (await P(kabir, 'home_log', { id: fridge.id, note: 'I fixed it' })).status === 403);
ok('4. a repair needs words', (await P(papa, 'home_log', { id: fridge.id, note: ' ' })).status === 400);
r = await P(rohan, 'home_update', { id: fridge.id, kind: 'appliance', title: 'Fridge (kitchen)', boughtOn: '2024-06-01', warrantyUntil: day(20), serviceDue: day(5), callContactId: electrician, audience: 'IMMEDIATE' });
ok('4. the writer changes it', r.ok && r.items.some(i => i.title === 'Fridge (kitchen)'));

// ------------------------------------------------------------ 5. reminders
let mark = pushed.length;
await sweepRenewals(sql, fam.id, now);
const svc = pushed.slice(mark).filter(p => /Fridge \(kitchen\): service is due in 5 days/.test(p.body.title)).map(p => p.to);
const war = pushed.slice(mark).filter(p => /Fridge \(kitchen\): warranty runs out in 20 days/.test(p.body.title)).map(p => p.to);
ok('5. a "whole family" entry tells the adults: service in 5 days, warranty in 20', svc.sort().join() === [rohan.id, meena.id, papa.id].sort().join() && war.sort().join() === svc.sort().join(), svc.join() + ' / ' + war.join());
ok('5. never a child, never someone who has passed away', ![kabir.id, dadaji.id].some(id => svc.includes(id) || war.includes(id)));
const own = pushedTo(mark, /Scooter: service is due in 6 days/);
ok('5. an "only me" entry reminds only its writer', own.join() === rohan.id);
ok('5. an entry with no dates reminds nobody', pushedTo(mark, /House tax|Almirah/).length === 0);
mark = pushed.length;
await sweepRenewals(sql, fam.id, now + 3600000);
ok('5. each reminder is sent once', pushed.length === mark);
mark = pushed.length;
await sweepRenewals(sql, fam.id, now + 14 * DAY);
ok('5. a week before the warranty ends, once more', pushedTo(mark, /warranty runs out in 6 days/).sort().join() === [rohan.id, meena.id, papa.id].sort().join());
ok('5. the hook is inside the renewals sweep the timer already runs: no new timer line',
  (await import('fs')).readFileSync(new URL('../../../api/_renewals.mjs', import.meta.url), 'utf8').includes('n += await sweepHome(sql, circleId, nowMs);')
  && !(await import('fs')).readFileSync(new URL('../../../api/events.mjs', import.meta.url), 'utf8').includes('sweepHome'));
// People I choose: the writer and the people named.
await P(rohan, 'home_add', { kind: 'appliance', title: 'Inverter', warrantyUntil: day(29), audience: 'NOMINEES_ONLY', people: [meena.id] });
mark = pushed.length;
await sweepRenewals(sql, fam.id, now);
ok('5. "people I choose" tells the writer and those people only', pushedTo(mark, /Inverter: warranty/).sort().join() === [rohan.id, meena.id].sort().join());

// --------------------------------------------------------------- 6. others
ok('6. an outsider is refused', (await G(outsider)).status === 403 && (await P(outsider, 'home_add', { kind: 'appliance', title: 'X', audience: 'IMMEDIATE' })).status === 403);
r = await G(vikram);
ok('6. another family reads none of it and cannot touch it', r.ok && r.items.length === 0 && (await P(vikram, 'home_remove', { id: fridge.id })).status === 404 && (await P(vikram, 'home_log', { id: fridge.id, note: 'x' })).status === 404);
r = await P(rohan, 'home_remove', { id: fridge.id });
ok('6. the writer removes an entry', r.ok && !r.items.some(i => i.id === fridge.id));

await k.finish();
