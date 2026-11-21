// THE DOCTOR-READY SUMMARY and THE BLOOD GROUP LOOKUP, END TO END: a real
// browser, the real API and a real PostgreSQL. Meena says yes to "Tell my
// family my blood group"; Rohan looks up O+ and finds her, and nobody who
// has not said yes; he opens Papa's summary page, built from what he may
// already see, with its date and "not a medical record" line. A child is
// shown neither.
//
// Every new surface is measured: 44px targets, a 12px floor, AA contrast in
// light and dark, nothing sideways at 320, 390 or 1280. Nothing here waits
// a fixed time: each step waits for the element or the state it checks.
import { kit, browserKit } from './jkit.mjs';
const k = await kit('healthlookup.e2e', ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games', 'ekta']);
const { ok, call, user, family, seat, admin, sql, pushed, api } = k;
await call(api.plans, { method: 'GET', query: { circle: 'NOPE00', member: 'x' } });
await (await import('../../../api/_bloodlookup.mjs')).ensureBloodSchema(sql);
await (await import('../../../api/_careprep.mjs')).ensureCarePrepSchema(sql);
await (await import('../../../api/_visits.mjs')).ensureVisitSchema(sql);
const B = await browserKit('healthlookup.e2e', k);
const { phone, sees, shown, gone, design, wide, toastSays, T } = B;

const fam = await family('SHARMA24', 'Sharma Family');
const U = {}; for (const nm of ['Rohan', 'Meena', 'Papa', 'Kabir']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' }), meena = await seat(fam, U.Meena, { dob: '1990-07-09' });
const papa = await seat(fam, U.Papa, { role: 'parent', dob: '1958-01-20' }), kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });
const book = (about, by, kind, cat, name, forwhat, vis = 'circle', ph = null) => admin.query(
  `insert into family_book (circle_id, kind, name, category, forwhat, phone, about_member, by_member, visibility) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [fam.id, kind, name, cat, forwhat, ph, about.id, by.id, vis]);
await book(meena, meena, 'fact', 'blood', 'Blood group', 'O+'); await book(papa, rohan, 'fact', 'blood', 'Blood group', 'O+'); await book(rohan, rohan, 'fact', 'blood', 'Blood group', 'B+');
await book(papa, rohan, 'med', null, 'Amlopres 5', 'One in the morning'); await book(papa, papa, 'med', null, 'Private tablet', 'Kept to myself', 'private');
await book(papa, rohan, 'fact', 'allergy', 'Penicillin', 'Penicillin'); await book(papa, rohan, 'contact', 'doctor', 'Dr Mehta', 'Heart', 'circle', '+915224009999');
await book(papa, rohan, 'contact', 'emergency', 'Sharma neighbour', 'Next door', 'circle', '+915224001111');
await admin.query(`insert into audio_consultations (circle_id, person_id, created_by, transcript_raw, recorded_at, next_due) values ($1,$2,$3,'BP steady. Walk every day.', now() - interval '20 days', now() + interval '70 days')`, [fam.id, papa.id, rohan.id]);

// ---- Meena: her own yes
const M = await phone(meena, { hash: '#memory' });
ok('health: the two cards are there for an adult, closed until opened', await shown(M, '#kd-bl-card') && await shown(M, '#kd-sum-card') && !(await M.getAttribute('#kd-bl-card', 'open')));
await M.click('#kd-bl-card summary');
ok('consent: the question is asked in her own words, and starts off', await sees(M, '#kd-bl-line', /Tell my family, and the families linked to ours, my blood group if someone needs blood/) && !(await M.isChecked('#kd-bl-consent'))
  && await sees(M, '#kd-bl-mine', /Your blood group on record: O\+\. Nobody can find you until you tick this/));
ok('blood: the record line is on the card, and no advice', await sees(M, '#kd-bl-legal', /not medical advice\. The hospital checks the blood group/));
await design(M, '#kd-bl-card', 'the blood group card');
await M.check('#kd-bl-consent');
ok('consent: one tick, and she is told the family can find her', await toastSays(M, /The family can find your blood group now/) && await sees(M, '#kd-bl-mine', /The family can find you/));

// ---- Rohan looks up O+
const R = await phone(rohan, { hash: '#memory' });
await R.click('#kd-bl-card summary');
await R.selectOption('#kd-bl-group', 'O+');
await R.click('#kd-bl-find');
ok('lookup: Meena, who said yes, is found with a Call button', await sees(R, '#kd-bl-out', /Meena/) && await sees(R, '#kd-bl-out', /O\+, as they wrote it/) && await R.locator('#kd-bl-out a[href^="tel:"]').count() === 1);
ok('lookup: Papa is O+ too but has not said yes, so there is nothing about him', !(await R.textContent('#kd-bl-out')).includes('Papa'));
await design(R, '#kd-bl-card', 'the blood group card with someone found');
await wide(R, 'the blood group card');
await R.selectOption('#kd-bl-group', 'AB-'); await R.click('#kd-bl-find');
ok('lookup: nobody found is said kindly, and "Tell them" is not offered', await sees(R, '#kd-bl-out', /Nobody who said yes has AB- written down/) && await R.isHidden('#kd-bl-ask'));
await R.selectOption('#kd-bl-group', 'O+'); await R.click('#kd-bl-find'); await shown(R, '#kd-bl-ask');
const mark = pushed.length;
await R.click('#kd-bl-ask'); await shown(R, '#asksheet'); await R.fill('#as-in', 'For Maa at the hospital'); await R.click('#as-yes');
ok('tell them: Meena is told someone is looking, and nobody else', await toastSays(R, /They have been told/) && pushed.slice(mark).filter(p => /Rohan is looking for O\+ blood/.test(p.body.title)).map(p => p.to).join() === meena.id);

// ---- the summary page
await R.click('#kd-sum-card summary');
ok('summary: the card says what it is and what it shows', await sees(R, '#kd-sum-card', /It shows only what you can already see\. Written by the family, not a medical record/) && (await R.locator('#kd-sum-who option').allTextContents())[0] === 'Me');
await design(R, '#kd-sum-card', 'the doctor-ready summary card');
await R.selectOption('#kd-sum-who', papa.id);
await R.click('#kd-sum-open');
ok('summary: a page for Papa with the date and what it is', await shown(R, '#kd-paper') && await sees(R, '#kd-paper-title', /Papa: summary for the doctor/) && await sees(R, '#kd-paper-body .mbbsub', /Written by the family\. This is not a medical record\./)
  && /\d{4}/.test(await R.textContent('#kd-paper-body .mbbsub')));
ok('summary: blood group, allergies, medicines, the doctor, the visit with its follow-up, and who to call', await sees(R, '#kd-paper-body', /Blood group\s*O\+/) && await sees(R, '#kd-paper-body', /Penicillin/)
  && await sees(R, '#kd-paper-body', /Amlopres 5 · One in the morning/) && await sees(R, '#kd-paper-body', /Dr Mehta/) && await sees(R, '#kd-paper-body', /BP steady\. Walk every day\./)
  && await sees(R, '#kd-paper-body', /Follow-up written for/) && await sees(R, '#kd-paper-body', /Sharma neighbour/));
ok('summary: Papa\'s private entry is not on Rohan\'s copy', !(await R.textContent('#kd-paper-body')).includes('Private tablet'));
ok('summary: it ends with the record line, and only the page prints', await sees(R, '#kd-paper-body', /It is not medical advice/) && await R.evaluate(() => document.body.classList.contains('kdprint')));
await design(R, '#kd-paper', 'the doctor-ready summary page');
await R.click('#kd-paper-x');
ok('summary: closed', await gone(R, '#kd-paper'));

// ---- Papa's own copy has his private entry
const P = await phone(papa, { hash: '#memory' });
await P.click('#kd-sum-card summary'); await P.click('#kd-sum-open');
ok('summary: on his own page Papa sees his private entry too', await shown(P, '#kd-paper') && await sees(P, '#kd-paper-title', /Papa: summary for the doctor/) && await sees(P, '#kd-paper-body', /Private tablet/));
await P.click('#kd-paper-x');

// ---- a child is shown neither card
const K = await phone(kabir, { hash: '#memory' });
await K.waitForSelector('#b-search', T);
await K.waitForFunction(() => window.performance.getEntriesByType('resource').filter(e => /area=(blood|summary)/.test(e.name)).length >= 2, null, T);
ok('child: neither the summary nor the blood lookup is shown', await K.isHidden('#kd-sum-card') && await K.isHidden('#kd-bl-card'));

await B.finish();
