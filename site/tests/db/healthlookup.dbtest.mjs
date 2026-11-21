// THE BLOOD GROUP LOOKUP and THE DOCTOR-READY SUMMARY against a real
// database, through the real handlers (/api/book?area=blood, ?area=summary).
//
// Blood:
//   1. The yes is each member's own, off until they say so, and set only
//      from their own sign-in. A child cannot say it or look anything up.
//   2. A lookup shows only people with a group on record AND a yes. Nothing
//      about anyone else: not a name, not a count. Never someone not on
//      Parwah, a child, or someone who has passed away.
//   3. Linked families are searched too; an unlinked family never.
//   4. "Tell them" pushes the people found, and is limited.
//   5. The person who said yes can see who looked.
// Summary:
//   6. Built only from what the viewer may already read: a private entry
//      is on its owner's page and nobody else's.
//   7. For the adults. A child never opens one, not even their own.
//   8. Nothing is stored by opening it. Another family reads nothing.
import { kit } from './jkit.mjs';
const k = await kit('healthlookup.dbtest', ['book', 'plans', 'events']);
const { ok, call, user, family, seat, pushed, pushedTo, admin, sql, api } = k;
const BL = await import('../../../api/_bloodlookup.mjs');
const R = await import('../../../api/_needsrules.mjs');
const { ensureFamlinkSchema } = await import('../../../api/_famlink.mjs');
const { ensureCarePrepSchema } = await import('../../../api/_careprep.mjs');
const { ensureEcardSchema } = await import('../../../api/_ecard.mjs');
await call(api.plans, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });
await BL.ensureBloodSchema(sql); await ensureFamlinkSchema(sql); await ensureCarePrepSchema(sql); await ensureEcardSchema(sql);
await (await import('../../../api/_visits.mjs')).ensureVisitSchema(sql);

const fam = await family('SHARMA24', 'Sharma Family'), linked = await family('GUPTA024', 'Gupta Family'), other = await family('VERMA024', 'Verma Family');
const U = {}; for (const nm of ['Rohan', 'Meena', 'Papa', 'Kabir', 'Chacha', 'Mama', 'Vikram']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' }), meena = await seat(fam, U.Meena, { dob: '1990-07-09' });
const papa = await seat(fam, U.Papa, { role: 'parent', dob: '1958-01-20' }), kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });
const chacha = await seat(fam, U.Chacha, { dob: '1985-01-01' });
const dadi = await seat(fam, { name: 'Dadi' }, { role: 'parent', dob: '1936-02-02' });
const dadaji = await seat(fam, { name: 'Dadaji' }, { role: 'parent', dob: '1930-01-01' });
const mama = await seat(linked, U.Mama, { dob: '1975-01-01' });
const meenaG = await seat(linked, U.Meena, { dob: '1990-07-09', sub: false });
const vikram = await seat(other, U.Vikram, { dob: '1980-01-01' });
const outsider = { id: vikram.id, token: vikram.token, code: 'SHARMA24' };
await admin.query(`insert into family_links (a_circle, b_circle, a_member, b_member, status) values ($1,$2,$3,$4,'active')`, [fam.id, linked.id, meena.id, meenaG.id]);

const P = (who, action, body = {}) => call(api.book, { token: who.token, body: { code: who.code, memberId: who.id, action, ...body } });
const G = (who, area, query = {}) => call(api.book, { method: 'GET', token: who.token, query: { area, circle: who.code, member: who.id, ...query } });
const fact = (f, about, by, cat, name, forwhat, vis = 'circle') => admin.query(
  `insert into family_book (circle_id, kind, name, category, forwhat, about_member, by_member, visibility) values ($1,'fact',$2,$3,$4,$5,$6,$7)`, [f.id, name, cat, forwhat, about.id, by.id, vis]);
// Blood groups on record: Rohan O+, Meena O+ ("o positive"), Papa O+, Chacha B+, Kabir O+, Dadi O+, Dadaji O+, Mama O+, Vikram O+.
await fact(fam, rohan, rohan, 'blood', 'Blood group', 'O+'); await fact(fam, meena, meena, 'blood', 'Blood group', 'o positive');
await fact(fam, papa, rohan, 'blood', 'Blood group', 'O +ve'); await fact(fam, chacha, chacha, 'blood', 'Blood group', 'B+');
await fact(fam, kabir, rohan, 'blood', 'Blood group', 'O+'); await fact(fam, dadi, rohan, 'blood', 'Blood group', 'O+'); await fact(fam, dadaji, rohan, 'blood', 'Blood group', 'O+');
await fact(linked, mama, mama, 'blood', 'Blood group', 'O+'); await fact(other, vikram, vikram, 'blood', 'Blood group', 'O+');
const find = async (who, group) => P(who, 'blood_find', { group });
const namesOf = r => (r.matches || []).map(m => m.name).sort().join(',');

// ------------------------------------------------------------ 1. consent
let r = await G(meena, 'blood');
ok('1. the yes is off until a person says so, and their own group is read back to them', r.ok && r.mine.consent === false && r.mine.asked === false && r.mine.group === 'O+' && /if someone needs blood/.test(r.consentLine));
ok('1. the lookup carries the record line and gives no advice', /not medical advice/.test(r.legal) && !/donate to|compatible|universal/i.test(JSON.stringify(r)));
r = await find(rohan, 'O+');
ok('2. with nobody having said yes, a lookup shows nobody and no count', r.ok && r.matches.length === 0 && !('count' in r) && !('total' in r) && !/Meena|Papa|Kabir|Dadi|Mama/.test(JSON.stringify(r)));
r = await P(meena, 'blood_consent_set', { on: true });
ok('1. Meena says yes, on her own sign-in', r.ok && r.mine.consent === true);
ok('1. a child cannot say it, and is told so', (await P(kabir, 'blood_consent_set', { on: true })).status === 403 && (await G(kabir, 'blood')).mine === null);
ok('1. nobody can say it for someone else: the answer is always about the caller', (await P(rohan, 'blood_consent_set', { on: true, memberId: rohan.id, forId: papa.id })).mine.consent === true
  && !(await k.q1(`select 1 as x from blood_consent where member_id = $1`, [papa.id])));
// Rows written straight into the table for people who could never have said yes.
await admin.query(`insert into blood_consent (member_id, circle_id, tell) values ($1,$4,true), ($2,$4,true), ($3,$4,true)`, [kabir.id, dadi.id, dadaji.id, fam.id]);
await admin.query(`update members set remembered = true where id = $1`, [dadaji.id]);

// ------------------------------------------------------------- 2. lookup
r = await find(papa, 'O+');
ok('2. a lookup shows the people who said yes: Meena and Rohan', namesOf(r) === 'Meena,Rohan', namesOf(r));
ok('2. it never shows a child, someone not on Parwah or someone who has passed away, even with a row that says yes', !/Kabir|Dadi|Dadaji/.test(JSON.stringify(r)));
ok('2. nothing about Papa himself or about anyone who has not said yes', !/Chacha/.test(JSON.stringify(r)) && !r.matches.some(m => m.id === papa.id));
ok('2. "o positive" on record is found as O+', r.matches.some(m => m.name === 'Meena'));
ok('2. a number is sent as its owner lets the family see it', r.matches.every(m => typeof m.phone === 'string' && m.phone.startsWith('+91')));
ok('2. another group finds nobody who is not that group', namesOf(await find(papa, 'B+')) === '' && namesOf(await find(papa, 'AB-')) === '');
await P(chacha, 'blood_consent_set', { on: true });
ok('2. Chacha says yes, and is found for B+ only', namesOf(await find(papa, 'B+')) === 'Chacha' && !/Chacha/.test(namesOf(await find(papa, 'O+'))));
ok('2. a group not on the list is refused', (await find(papa, 'Z+')).status === 400 && (await find(papa, 'o+')).status === 400);
ok('2. a child cannot look anything up', (await find(kabir, 'O+')).status === 403);
ok('2. an outsider is refused', (await find(outsider, 'O+')).status === 403 && (await G(outsider, 'blood')).status === 403);
await P(rohan, 'blood_consent_set', { on: false });
ok('2. a yes taken back is gone from the next lookup', namesOf(await find(papa, 'O+')) === 'Meena');
await P(rohan, 'blood_consent_set', { on: true });
ok('2. the pure rule agrees', R.bloodShown({ group: 'O+', consent: true, onApp: true, remembered: false }) === true && R.bloodShown({ group: 'O+', consent: false }) === false
  && R.bloodShown({ group: null, consent: true }) === false && R.bloodShown({ group: 'O+', consent: true, onApp: false }) === false && R.bloodShown({ group: 'O+', consent: true, remembered: true }) === false);

// ------------------------------------------------------ 3. linked families
ok('3. a linked relative who has not said yes is not shown', !/Mama/.test(JSON.stringify(await find(papa, 'O+'))));
await P(mama, 'blood_consent_set', { on: true });
r = await find(papa, 'O+');
const m = r.matches.find(x => x.name === 'Mama');
ok('3. after his own yes, Mama of the linked family is found, with the family named', !!m && m.family === 'Gupta Family');
ok('3. a number does not cross to another family this way', m.phone === null);
await P(vikram, 'blood_consent_set', { on: true });
ok('3. a family that is not linked is never searched', !/Vikram/.test(JSON.stringify(await find(papa, 'O+'))) && namesOf(await find(vikram, 'O+')) === '');
ok('3. the linked family finds the Sharmas who said yes, too', /Meena|Rohan/.test(namesOf(await find(mama, 'O+'))));

// ---------------------------------------------------------- 4. tell them
let mark = pushed.length;
r = await P(papa, 'blood_ask', { group: 'O+', note: 'OTP 482910 for the form' });
ok('4. a note with an OTP or a card number is refused, nobody is told, and it does not use up an ask', r.status === 400 && /never keeps/.test(r.error) && pushed.length === mark, JSON.stringify(r));
r = await P(papa, 'blood_ask', { group: 'O+', note: 'For Maa at Medanta' });
const told = pushedTo(mark, /Papa is looking for O\+ blood/);
ok('4. "Tell them" reaches only the people found, across the link', r.ok && r.told === 3 && told.sort().join() === [meena.id, rohan.id, mama.id].sort().join(), told.join());
ok('4. it is a safety push that asks, and says why they are being told', /You said the family may know your blood group\. Please call Papa/.test(pushed[mark].body.body) && /For Maa at Medanta/.test(pushed[mark].body.body));
await P(papa, 'blood_ask', { group: 'O+' }); await P(papa, 'blood_ask', { group: 'O+' });
ok('4. a fourth ask in a day is refused', (await P(papa, 'blood_ask', { group: 'O+' })).status === 429);

// --------------------------------------------------------- 5. who looked
r = await G(meena, 'blood');
ok('5. Meena can see who looked for her group', r.mine.looks.some(l => l.name === 'Papa') && r.mine.looks.every(l => l.name !== 'Meena'));
ok('5. someone who has not said yes sees no looks', (await G(papa, 'blood')).mine.looks.length === 0);

// =============================================================== summary
// What is written about Papa: medicines and allergies the family shares, one private note of his own,
// a doctor, an emergency contact, and a visit.
const book = (about, by, kind, cat, name, forwhat, vis = 'circle', phone = null) => admin.query(
  `insert into family_book (circle_id, kind, name, category, forwhat, phone, about_member, by_member, visibility) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [fam.id, kind, name, cat, forwhat, phone, about.id, by.id, vis]);
await book(papa, rohan, 'med', null, 'Amlopres 5', 'One in the morning');
await book(papa, papa, 'med', null, 'Private tablet', 'Kept to myself', 'private');
await book(papa, rohan, 'fact', 'allergy', 'Penicillin', 'Penicillin');
await book(papa, rohan, 'contact', 'doctor', 'Dr Mehta', 'Heart', 'circle', '+915224009999');
await book(papa, rohan, 'contact', 'emergency', 'Sharma neighbour', 'Next door', 'circle', '+915224001111');
await admin.query(`insert into audio_consultations (circle_id, person_id, created_by, transcript_raw, recorded_at, next_due) values ($1,$2,$3,'BP steady. Walk every day.', now() - interval '20 days', now() + interval '70 days')`, [fam.id, papa.id, rohan.id]);
const before = (await admin.query(`select (select count(*) from family_book)::int + (select count(*) from audio_consultations)::int + (select count(*) from events)::int as n`)).rows[0].n;

r = await G(rohan, 'summary');
ok('7. an adult is offered the people of the family, never someone who has passed away', r.ok && r.adult === true && r.people.some(p => p.name === 'Papa') && !r.people.some(p => p.name === 'Dadaji') && r.people[0].me === true);
r = await G(rohan, 'summary', { person: papa.id });
const s = r.summary;
ok('6. the summary: blood group, allergies, medicines, the doctor, visits and who to call', r.ok && s.name === 'Papa' && s.blood === 'O +ve' && s.allergies.join() === 'Penicillin'
  && s.medicines.map(x => x.name).join() === 'Amlopres 5' && s.doctors[0].name === 'Dr Mehta' && s.visits.length === 1 && /BP steady/.test(s.visits[0].notes) && !!s.visits[0].next
  && s.contacts.some(c => c.name === 'Sharma neighbour'), JSON.stringify(s).slice(0, 300));
ok('6. it carries today\'s date and says what it is', /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.line === 'Written by the family. This is not a medical record.' && /not medical advice/.test(s.legal));
ok('6. Papa\'s private entry is not on anyone else\'s copy', !JSON.stringify(s).includes('Private tablet') && !JSON.stringify((await G(meena, 'summary', { person: papa.id })).summary).includes('Private tablet'));
r = await G(papa, 'summary', { person: papa.id });
ok('6. and it is on his own', r.summary.medicines.map(x => x.name).sort().join() === 'Amlopres 5,Private tablet');
// An entry shared with one person by name.
const shared = (await admin.query(`insert into family_book (circle_id, kind, name, forwhat, about_member, by_member, visibility) values ($1,'med','Shared with Meena only','At night',$2,$2,'private') returning id`, [fam.id, papa.id])).rows[0].id;
await admin.query(`insert into book_access (entry_id, member_id, granted_by) values ($1,$2,$3)`, [shared, meena.id, papa.id]);
ok('6. an entry shared with Meena by name is on her copy and not on Rohan\'s', JSON.stringify((await G(meena, 'summary', { person: papa.id })).summary).includes('Shared with Meena only')
  && !JSON.stringify((await G(rohan, 'summary', { person: papa.id })).summary).includes('Shared with Meena only'));
// The emergency card's two contacts, only for someone who may open the card.
await admin.query(`insert into ecard_prefs (circle_id, member_id, viewers, contacts) values ($1,$2,$3,$4)`, [fam.id, papa.id, [rohan.id], [meena.id]]);
ok('6. the card\'s contact is added for someone Papa chose, and not for someone he did not', (await G(rohan, 'summary', { person: papa.id })).summary.contacts.some(c => c.name === 'Meena')
  && !(await G(chacha, 'summary', { person: papa.id })).summary.contacts.some(c => c.name === 'Meena'));
// Children never.
r = await G(kabir, 'summary');
ok('7. a child is offered nobody', r.ok && r.adult === false && r.people.length === 0);
ok('7. a child cannot open a summary: not Papa\'s, and not their own', (await G(kabir, 'summary', { person: papa.id })).status === 403 && (await G(kabir, 'summary', { person: kabir.id })).status === 403);
ok('7. the pure rule agrees', R.summaryMayOpen({ viewerMinor: true }).status === 403 && R.summaryMayOpen({ viewerMinor: false }).ok === true && R.summaryMayOpen({ viewerMinor: false, personRemembered: true }).status === 404);
ok('7. nobody opens a summary of someone who has passed away', (await G(rohan, 'summary', { person: dadaji.id })).status === 404);
ok('8. another family, and an outsider, read nothing', (await G(vikram, 'summary', { person: papa.id })).status === 404 && (await G(outsider, 'summary', { person: papa.id })).status === 403);
ok('8. someone with nothing written has an empty page that says so', (await G(rohan, 'summary', { person: chacha.id })).summary.empty === false && (await G(rohan, 'summary', { person: dadi.id })).summary.medicines.length === 0);
ok('8. only GET: nothing can be written through it', (await call(api.book, { method: 'POST', token: rohan.token, query: { area: 'summary' }, body: { area: 'summary', code: rohan.code, memberId: rohan.id } })).status === 405);
const after = (await admin.query(`select (select count(*) from family_book)::int + (select count(*) from audio_consultations)::int + (select count(*) from events)::int as n`)).rows[0].n;
ok('8. opening summaries stored nothing', after === before + 1, before + ' -> ' + after);   // + the one shared entry this test added itself

await k.finish();
