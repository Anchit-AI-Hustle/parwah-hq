// A CHILD'S PAGE against a real database, through the real handler
// (/api/care?area=kids) and the real timer sweep with the clock handed in.
//
//   1. Who is listed: members under 18 who are with us. How each viewer
//      stands to each child, in the database and in the pure rule, agree.
//   2. Only a parent starts and changes the page. With no parent on Parwah,
//      the adult who starts it keeps it.
//   3. What each relation reads: a parent everything; the child a friendly
//      page with no fees and no health lines; another adult and a cousin
//      only what a parent marked "Whole family"; a cousin never fees,
//      vaccinations or health, whatever is marked.
//   4. The child adds their own exam dates and notes, and chooses whether
//      results go to the wider family (default: parents only).
//   5. Pick-up: a rota among adults (on Parwah or by name), one tap tells
//      the other parent, and a missed pick-up alerts the adults, as a
//      safety push, 20 minutes after the time. Once.
//   6. Fee reminders go only to adults who asked, never to the child.
//   7. Nobody who has passed away collects, has a page or is told. Another
//      family reads nothing.
import { kit } from './jkit.mjs';
const k = await kit('kids.dbtest', ['care', 'events']);
const { ok, call, user, family, seat, pushed, pushedTo, admin, sql, api } = k;
const Kids = await import('../../../api/_kids.mjs');
const R = await import('../../../api/_kidsrules.mjs');
const { pushKind } = await import('../../../api/_pushrules.mjs');
const { dayIn } = await import('../../../api/_recur.mjs');
await Kids.ensureKidsSchema(sql);

const fam = await family('SHARMA24', 'Sharma Family'), other = await family('VERMA024', 'Verma Family');
const U = {}; for (const nm of ['Rohan', 'Meena', 'Aarav', 'Chacha', 'Kabir', 'Vikram']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' });
const meena = await seat(fam, U.Meena, { dob: '1990-07-09', spouse: rohan.id });
const aarav = await seat(fam, U.Aarav, { dob: '2015-06-01', parent: rohan.id });
const chacha = await seat(fam, U.Chacha, { dob: '1985-01-01' });
const kabir = await seat(fam, U.Kabir, { dob: '2012-05-05', parent: chacha.id });
const nani = await seat(fam, { name: 'Nani' }, { role: 'parent', dob: '1950-02-02' });
const dadaji = await seat(fam, { name: 'Dadaji' }, { role: 'parent', dob: '1930-01-01' });
await admin.query(`update members set remembered = true where id = $1`, [dadaji.id]);
// Tara's mother, Bua, is in the tree by name only: no parent of hers is on Parwah.
const bua = await seat(fam, { name: 'Bua' }, { dob: '1986-01-01' });
const tara = await seat(fam, { name: 'Tara' }, { dob: '2018-01-01', parent: bua.id });
const vikram = await seat(other, U.Vikram, { dob: '1980-01-01' });
const outsider = { id: vikram.id, token: vikram.token, code: 'SHARMA24' };

const P = (who, action, body = {}) => call(api.care, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const G = (who, query = {}) => call(api.care, { method: 'GET', token: who.token, query: { area: 'kids', circle: who.code, member: who.id, ...query } });
const page = async (who, child) => (await G(who, { child: child.id })).page;

// ------------------------------------------------------------- 1. listing
let r = await G(rohan);
ok('1. the children listed are the members under 18 who are with us', r.ok && r.kids.map(x => x.name).sort().join() === 'Aarav,Kabir,Tara', JSON.stringify(r.kids));
const relOf = (list, name) => list.find(x => x.name === name).rel;
ok('1. Rohan is Aarav\'s parent; to Kabir and Tara he is another adult', relOf(r.kids, 'Aarav') === 'parent' && relOf(r.kids, 'Kabir') === 'adult' && relOf(r.kids, 'Tara') === 'adult');
ok('1. Meena, Rohan\'s wife, is Aarav\'s parent by the tree', relOf((await G(meena)).kids, 'Aarav') === 'parent');
r = await G(aarav);
ok('1. Aarav is himself to his own page, and a cousin to Kabir', relOf(r.kids, 'Aarav') === 'self' && relOf(r.kids, 'Kabir') === 'minor');
ok('1. an outsider is told nothing', (await G(outsider)).status === 403);
// The database function and the pure rule give the same answer for every pair.
const people = (await admin.query(`select id, name, user_id, dob, is_child, adult_confirmed, remembered, parent_id, spouse_id from members where circle_id = $1`, [fam.id])).rows;
const { isMinor } = await import('../../../api/_standingrules.mjs');
let agree = 0, pairs = 0; const diff = [];
for (const c of people.filter(p => ['Aarav', 'Kabir', 'Tara'].includes(p.name))) {
  const parents = people.filter(p => p.id === c.parent_id || p.spouse_id === c.parent_id || (c.parent_id && people.find(q => q.id === c.parent_id).spouse_id === p.id))
    .map(p => ({ id: p.id, on_app: !!p.user_id, remembered: p.remembered }));
  for (const v of people) {
    const inDb = (await admin.query(`select kid_rel_v1($1, $2) as rel`, [v.id, c.id])).rows[0].rel;
    const pure = R.kidRelation({ viewer: { id: v.id, on_app: !!v.user_id, minor: isMinor(v), remembered: v.remembered }, child: c, parents, startedBy: null });
    pairs++; if (inDb === pure) agree++; else diff.push(v.name + '>' + c.name + ' db ' + inDb + ' pure ' + pure);
  }
}
ok('1. the database and the pure rule agree on every viewer and child (' + pairs + ' pairs)', agree === pairs && pairs === 27, diff.join(' | '));

// --------------------------------------------------------------- 2. start
r = await P(chacha, 'kid_page_save', { childId: aarav.id, school: 'DPS' });
ok('2. an adult who is not a parent cannot start Aarav\'s page', r.status === 403 && /parents keep this page/.test(r.error));
r = await P(aarav, 'kid_page_save', { childId: aarav.id, school: 'DPS' });
ok('2. the child cannot start it either', r.status === 403);
r = await P(kabir, 'kid_page_save', { childId: aarav.id, school: 'DPS' });
ok('2. nor a cousin', r.status === 403);
r = await P(rohan, 'kid_page_save', { childId: rohan.id, school: 'DPS' });
ok('2. an adult has no child\'s page', r.status === 404);
r = await P(rohan, 'kid_page_save', { childId: aarav.id, school: 'City Montessori', className: '5 B', teacher: 'Mrs Rao', schoolPhone: '0522 400 1234',
  allergies: 'Peanuts', doctorName: 'Dr Mehta', doctorPhone: '+91 98100 00000' });
ok('2. a parent starts the page', r.status === 201 && r.page.rel === 'parent' && r.page.school.name === 'City Montessori' && r.page.health.allergies === 'Peanuts');
ok('2. the page carries the record line, not advice', /record your family keeps\. It is not medical advice/.test(r.page.legal));
r = await P(rohan, 'kid_page_save', { childId: aarav.id, school: 'DPS', schoolPhone: 'call me maybe' });
ok('2. a phone number must be a number', r.status === 400);
r = await P(rohan, 'kid_page_save', { childId: aarav.id, school: 'DPS', allergies: 'card 4111 1111 1111 1111' });
ok('2. a card number is refused in any box', r.status === 400 && /card number/.test(r.error));
// Tara: no parent on Parwah, so the adult who starts the page keeps it.
r = await G(meena);
ok('2. with no parent on Parwah, any adult may start Tara\'s page', r.kids.find(x => x.name === 'Tara').mayStart === true && r.kids.find(x => x.name === 'Kabir').mayStart === false);
r = await P(meena, 'kid_page_save', { childId: tara.id, school: 'Little Stars' });
ok('2. Meena starts Tara\'s page and keeps it', r.status === 201 && r.page.rel === 'parent');
ok('2. Rohan, who did not start it, is another adult to Tara', (await G(rohan)).kids.find(x => x.name === 'Tara').rel === 'adult');
ok('2. a child cannot start a page for another child', (await P(kabir, 'kid_page_save', { childId: tara.id, school: 'X' })).status === 403);

// ----------------------------------------------------------- 3. who reads
const today = dayIn('Asia/Kolkata'), plus = n => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
await P(rohan, 'kid_item_add', { childId: aarav.id, kind: 'fee', title: 'Term 2 fee', onDate: plus(5) });
await P(rohan, 'kid_item_add', { childId: aarav.id, kind: 'exam', title: 'Maths unit test', onDate: plus(10), result: '18 of 20' });
await P(rohan, 'kid_item_add', { childId: aarav.id, kind: 'vaccine', title: 'Typhoid', onDate: '2025-03-01', nextDue: '2028-03-01' });
r = await P(rohan, 'kid_item_add', { childId: aarav.id, kind: 'activity', title: 'Tabla class', days: [2, 4], atTime: '17:00' });
ok('3. a parent adds a fee, an exam, a vaccination record and a class', r.status === 201 && r.page.fees.length === 1 && r.page.exams.length === 1 && r.page.vaccines.length === 1 && r.page.activities.length === 1);
ok('3. a vaccination entry is a record: the date given and the next date as written', r.page.vaccines[0].on_date === '2025-03-01' && r.page.vaccines[0].next_due === '2028-03-01');
ok('3. a fee needs a date', (await P(rohan, 'kid_item_add', { childId: aarav.id, kind: 'fee', title: 'Bus fee' })).status === 400);
let pg = await page(meena, aarav);
ok('3. the other parent reads everything', pg.rel === 'parent' && pg.fees.length === 1 && pg.health.allergies === 'Peanuts' && pg.vaccines.length === 1 && pg.exams[0].result === '18 of 20');
pg = await page(aarav, aarav);
ok('3. the child reads school, exams and classes', pg.rel === 'self' && pg.school.teacher === 'Mrs Rao' && pg.exams.length === 1 && pg.activities.length === 1 && pg.exams[0].result === '18 of 20');
ok('3. the child is never sent fees, the vaccination record or the health lines', pg.fees === null && pg.vaccines === null && pg.health === null && !JSON.stringify(pg).includes('Peanuts') && !JSON.stringify(pg).includes('Term 2 fee'));
pg = await page(chacha, aarav);
ok('3. another adult reads nothing until a parent marks it "Whole family"', pg.rel === 'adult' && pg.school === null && pg.fees === null && pg.health === null && pg.exams === null && pg.vaccines === null && pg.activities === null
  && !/Montessori|Peanuts|Typhoid|Tabla|Maths/.test(JSON.stringify(pg)));
ok('3. only a parent marks a part for the family', (await P(chacha, 'kid_share_set', { childId: aarav.id, section: 'school', who: 'family' })).status === 403
  && (await P(aarav, 'kid_share_set', { childId: aarav.id, section: 'fees', who: 'family' })).status === 403);
for (const s of ['school', 'exams', 'activities']) await P(rohan, 'kid_share_set', { childId: aarav.id, section: s, who: 'family' });
pg = await page(chacha, aarav);
ok('3. after "Whole family": school, exam dates and classes, and nothing else', pg.school.name === 'City Montessori' && pg.exams.length === 1 && pg.activities.length === 1 && pg.fees === null && pg.health === null && pg.vaccines === null);
ok('3. exam RESULTS stay with the parents by default, even when the dates are shared', pg.exams[0].result === null);
for (const s of ['fees', 'vaccines', 'health']) await P(meena, 'kid_share_set', { childId: aarav.id, section: s, who: 'family' });
pg = await page(chacha, aarav);
ok('3. health, fees and vaccinations marked for the family reach the other ADULTS', pg.health.allergies === 'Peanuts' && pg.fees.length === 1 && pg.vaccines.length === 1);
pg = await page(kabir, aarav);
ok('3. a cousin under 18 reads the shared school parts', pg.rel === 'minor' && pg.school.name === 'City Montessori' && pg.exams.length === 1);
ok('3. and never fees, vaccinations or health, whatever a parent marked', pg.fees === null && pg.vaccines === null && pg.health === null && !/Peanuts|Typhoid|Term 2/.test(JSON.stringify(pg)));
ok('3. the pure rule says the same', R.kidMaySee('minor', 'health', { share: { health: 'family' } }) === false && R.kidMaySee('adult', 'health', { share: { health: 'family' } }) === true
  && R.kidMaySee('self', 'fees', { share: { fees: 'family' } }) === false && R.kidMaySee('adult', 'school', {}) === false);
ok('3. an outsider cannot read the page', (await G(outsider, { child: aarav.id })).status === 403);
ok('3. a page of another family\'s child is not found', (await G(vikram, { child: aarav.id })).status === 404);

// ------------------------------------------------------ 4. the child's own
r = await P(aarav, 'kid_item_add', { childId: aarav.id, kind: 'exam', title: 'Hindi dictation', onDate: plus(3) });
ok('4. the child adds their own exam date', r.status === 201 && r.page.exams.length === 2);
const mineExam = r.page.exams.find(e => e.title === 'Hindi dictation');
r = await P(aarav, 'kid_item_update', { id: mineExam.id, result: '9 of 10' });
ok('4. and writes its result', r.ok && r.page.exams.find(e => e.id === mineExam.id).result === '9 of 10');
ok('4. the child cannot add a fee or a vaccination entry', (await P(aarav, 'kid_item_add', { childId: aarav.id, kind: 'fee', title: 'X', onDate: plus(3) })).status === 403
  && (await P(aarav, 'kid_item_add', { childId: aarav.id, kind: 'vaccine', title: 'X', onDate: plus(3) })).status === 403);
const parentExam = r.page.exams.find(e => e.title === 'Maths unit test');
ok('4. nor change what a parent wrote', (await P(aarav, 'kid_item_update', { id: parentExam.id, result: '20 of 20' })).status === 403 && (await P(aarav, 'kid_item_remove', { id: parentExam.id })).status === 403);
ok('4. a cousin cannot add anything', (await P(kabir, 'kid_item_add', { childId: aarav.id, kind: 'note', title: 'hi' })).status === 403);
let mark = pushed.length;
r = await P(aarav, 'kid_item_add', { childId: aarav.id, kind: 'note', title: 'I want to join the football team' });
ok('4. "what I want to tell the family": saved, for the parents by default', r.status === 201 && r.page.notes.length === 1 && r.page.notes[0].share === 'parents');
ok('4. the parents are told, and only the parents', pushedTo(mark, /Aarav wrote something for you/).sort().join() === [rohan.id, meena.id].sort().join());
ok('4. a note for the parents is not read by another adult or a cousin', (await page(chacha, aarav)).notes.length === 0 && (await page(kabir, aarav)).notes.length === 0);
await P(aarav, 'kid_item_add', { childId: aarav.id, kind: 'note', title: 'Diwali ki chhutti mein Nani ke ghar chalein?', share: 'family' });
ok('4. a note the child marked for the whole family is read by everyone', (await page(chacha, aarav)).notes.length === 1 && (await page(kabir, aarav)).notes[0].title.startsWith('Diwali'));
ok('4. a parent cannot switch the child\'s results on for the family', (await P(rohan, 'kid_results_share', { childId: aarav.id, who: 'family' })).status === 403);
r = await P(aarav, 'kid_results_share', { childId: aarav.id, who: 'family' });
ok('4. the child chooses to show results to the wider family', r.ok && r.page.resultsShare === 'family' && (await page(chacha, aarav)).exams.some(e => e.result === '18 of 20'));
await P(aarav, 'kid_results_share', { childId: aarav.id, who: 'parents' });
ok('4. and can take that back', (await page(chacha, aarav)).exams.every(e => e.result === null));
ok('4. for a child who is not on Parwah, a parent chooses', (await P(meena, 'kid_results_share', { childId: tara.id, who: 'family' })).ok);
for (let i = 0; i < 5; i++) await P(aarav, 'kid_item_add', { childId: aarav.id, kind: 'note', title: 'note ' + i });
ok('4. notes to the parents are limited, so they cannot be rung over and over', (await P(aarav, 'kid_item_add', { childId: aarav.id, kind: 'note', title: 'one more' })).status === 429);

// --------------------------------------------------------------- 5. pick-up
ok('5. only a parent sets who collects', (await P(chacha, 'kid_pickup_set', { childId: aarav.id, days: [today], byId: chacha.id, time: '14:30' })).status === 403);
ok('5. a child cannot be the one who collects', (await P(rohan, 'kid_pickup_set', { childId: aarav.id, days: [today], byId: kabir.id, time: '14:30' })).status === 400);
ok('5. nor someone who has passed away', (await P(rohan, 'kid_pickup_set', { childId: aarav.id, days: [today], byId: dadaji.id, time: '14:30' })).status === 400);
ok('5. nor someone from another family', (await P(rohan, 'kid_pickup_set', { childId: aarav.id, days: [today], byId: vikram.id, time: '14:30' })).status === 400);
r = await P(rohan, 'kid_pickup_set', { childId: aarav.id, days: [today, plus(1)], byId: chacha.id, time: '23:59' });
ok('5. a parent sets Chacha for today and tomorrow', r.ok && r.page.pickups.length === 2 && r.page.pickups[0].byName === 'Chacha');
r = await P(rohan, 'kid_pickup_set', { childId: aarav.id, days: [plus(2)], byId: nani.id, time: '14:30' });
ok('5. Nani, trusted by name, can be on the rota', r.ok && r.page.pickups[2].byName === 'Nani' && r.page.pickups[2].byOnApp === false);
ok('5. the collectors offered are adults with us, by name too, never a child or Dadaji',
  r.page.collectors.map(c => c.name).sort().join() === 'Bua,Chacha,Meena,Nani,Rohan');
await P(rohan, 'kid_share_set', { childId: aarav.id, section: 'school', who: 'parents' });
pg = await page(chacha, aarav);
ok('5. Chacha sees his own turns even when the page is not shared with him', pg.pickups.length === 2 && pg.pickups.every(p => p.mine && p.canTap) && pg.school === null);
ok('5. the child sees who collects them', (await page(aarav, aarav)).pickups[0].byName === 'Chacha' && (await page(aarav, aarav)).pickups[0].canTap === false);
ok('5. a cousin does not see the rota', (await page(kabir, aarav)).pickups.length === 0);
ok('5. the child cannot tap "Picked up" for themself', (await P(aarav, 'kid_pickup_done', { childId: aarav.id })).status === 403);
mark = pushed.length;
r = await P(chacha, 'kid_pickup_done', { childId: aarav.id });
ok('5. one tap by Chacha marks today as picked up', r.ok && !!r.page.pickups[0].pickedAt && r.page.pickups[0].pickedName === 'Chacha');
ok('5. both parents are told, and nobody else', pushedTo(mark, /Chacha has picked up Aarav/).sort().join() === [rohan.id, meena.id].sort().join(), pushedTo(mark).join());
mark = pushed.length;
await P(chacha, 'kid_pickup_done', { childId: aarav.id });
ok('5. a second tap tells nobody again', pushed.length === mark);
await P(rohan, 'kid_pickup_clear', { childId: aarav.id, day: plus(1) });
ok('5. a parent clears a day', (await page(rohan, aarav)).pickups.length === 2);

// ------------------------------------------------------------------ 6. fees
ok('6. the parent who started the page is reminded unless they say no', (await page(rohan, aarav)).feeReminder === true && (await page(meena, aarav)).feeReminder === false);
ok('6. the child cannot ask for fee reminders', (await P(aarav, 'kid_fee_sub', { childId: aarav.id, on: true })).status === 403);
ok('6. nor a cousin', (await P(kabir, 'kid_fee_sub', { childId: aarav.id, on: true })).status === 403);
await P(chacha, 'kid_fee_sub', { childId: aarav.id, on: true });   // fees are marked for the family, so he may
// Even a row written straight into the table for the child is never sent to.
await admin.query(`insert into kid_fee_subs (child_id, member_id) values ($1, $1), ($1, $2)`, [aarav.id, kabir.id]);
const now0 = Date.parse(today + 'T06:00:00Z');
mark = pushed.length;
await Kids.sweepKidsAll(sql, now0);
let feeTo = pushedTo(mark, /Term 2 fee is due in 5 days/);
ok('6. a week ahead the adults who asked are reminded: Rohan and Chacha', feeTo.sort().join() === [rohan.id, chacha.id].sort().join(), feeTo.join());
ok('6. never the child, and never a cousin, even if a row names them', feeTo.indexOf(aarav.id) < 0 && feeTo.indexOf(kabir.id) < 0);
mark = pushed.length;
await Kids.sweepKidsAll(sql, now0 + 3600000);
ok('6. once for that stage', pushedTo(mark, /fee is due/).length === 0);
await P(meena, 'kid_share_set', { childId: aarav.id, section: 'fees', who: 'parents' });
mark = pushed.length;
await Kids.sweepKidsAll(sql, now0 + 4 * 86400000);
feeTo = pushedTo(mark, /Term 2 fee is due tomorrow/);
ok('6. the day before, once fees are parents-only again, Chacha is no longer told', feeTo.join() === rohan.id, feeTo.join());
const fee = (await page(rohan, aarav)).fees[0];
await P(rohan, 'kid_item_add', { childId: aarav.id, kind: 'fee', title: 'Bus fee', onDate: plus(1) });
const bus = (await page(rohan, aarav)).fees.find(f => f.title === 'Bus fee');
await P(meena, 'kid_item_update', { id: bus.id, paid: true });
mark = pushed.length;
await Kids.sweepKidsAll(sql, now0);
ok('6. a fee marked paid is not reminded', pushedTo(mark, /Bus fee/).length === 0 && !!fee);
await P(rohan, 'kid_fee_sub', { childId: aarav.id, on: false });
ok('6. an adult turns their own reminder off', (await page(rohan, aarav)).feeReminder === false);

// ---------------------------------------------- 5 again. a missed pick-up
// A missed pick-up: the day after tomorrow, Nani's turn, 14:30 in India.
const exp = (await k.q1(`select expect_at from kid_pickups where child_id = $1 and day = $2`, [aarav.id, plus(2)])).expect_at.getTime();
mark = pushed.length;
await Kids.sweepKidsAll(sql, exp + 19 * 60000);
ok('5. nineteen minutes after the time, nobody is alerted', pushedTo(mark, /not marked as picked up/).length === 0);
await Kids.sweepKidsAll(sql, exp + 21 * 60000);
const alerted = pushedTo(mark, /Aarav is not marked as picked up yet/);
ok('5. twenty minutes after, the adults of the family are alerted', alerted.sort().join() === [rohan.id, meena.id, chacha.id].sort().join(), alerted.join());
ok('5. never a child, not Aarav and not his cousin', alerted.indexOf(aarav.id) < 0 && alerted.indexOf(kabir.id) < 0);
const latePush = pushed.slice(mark).find(p => /not marked as picked up/.test(p.body.title));
ok('5. the alert names who was to collect, and blames nobody', /Nani was to collect at 2:30 pm\. A call to Nani or the school will tell\./.test(latePush.body.body) && !/forgot|missed|failed|late again/i.test(latePush.body.body));
ok('5. it is a safety push: it comes through quiet hours', pushKind(R.pickupLatePush('A', 'B', '2 pm')).through === true);
mark = pushed.length;
await Kids.sweepKidsAll(sql, exp + 40 * 60000);
ok('5. and it is sent once', pushedTo(mark, /not marked as picked up/).length === 0);
// A parent marks it for Nani afterwards.
r = await P(meena, 'kid_pickup_done', { childId: aarav.id, day: plus(2) });
ok('5. a parent marks it once Nani has him: "Nani has picked up Aarav (marked by Meena)"', r.ok && pushed.some(p => /Nani has picked up Aarav \(marked by Meena\)/.test(p.body.title) && p.to === rohan.id));

// --------------------------------------------------------- 7. the edges
ok('7. the timer line is in runTick once, as an imported function', (await import('fs')).readFileSync(new URL('../../../api/events.mjs', import.meta.url), 'utf8').split('await one(() => sweepKidsAll(sql));').length === 2);
await admin.query(`update members set remembered = true where id = $1`, [tara.id]);
ok('7. a child who has passed away is not listed and has no page to open', !(await G(meena)).kids.some(x => x.name === 'Tara') && (await G(meena, { child: tara.id })).status === 404);
r = await G(vikram);
ok('7. another family sees none of these children', r.ok && r.kids.length === 0);
await admin.query(`update members set dob = '2000-01-01' where id = $1`, [aarav.id]);
ok('7. at 18 the page is no longer a child\'s page', !(await G(rohan)).kids.some(x => x.name === 'Aarav'));

await k.finish();
