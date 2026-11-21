// A CHILD'S PAGE, END TO END: a real browser, the real API and a real
// PostgreSQL. Rohan starts his son's page and fills it; Aarav opens his own
// friendly page, adds an exam and a note, and chooses who sees his marks;
// Chacha has "Your turn today" and taps "Picked up"; a cousin sees only
// what was shared.
//
// Every new surface is measured: 44px targets, a 12px floor, AA contrast in
// light and dark, nothing sideways at 320, 390 or 1280. Nothing here waits
// a fixed time: each step waits for the element or the state it checks.
import { kit, browserKit } from './jkit.mjs';
const k = await kit('kids.e2e', ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games', 'ekta']);
const { ok, user, family, seat, pushed } = k;
const B = await browserKit('kids.e2e', k);
const { phone, sees, shown, design, wide, toastSays, T } = B;

const fam = await family('SHARMA24', 'Sharma Family');
const U = {}; for (const nm of ['Rohan', 'Meena', 'Aarav', 'Chacha', 'Kabir']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' });
const meena = await seat(fam, U.Meena, { dob: '1990-07-09', spouse: rohan.id });
const aarav = await seat(fam, U.Aarav, { dob: '2015-06-01', parent: rohan.id });
const chacha = await seat(fam, U.Chacha, { dob: '1985-01-01' });
const kabir = await seat(fam, U.Kabir, { dob: '2012-05-05', parent: chacha.id });
await seat(fam, { name: 'Nani' }, { role: 'parent', dob: '1950-02-02' });

// The page is one of the folded sections of To do: a person opens "More" first.
const kidsTab = async (page) => { await page.waitForSelector('#tn-care-more', T); if (!(await page.isVisible('#care-seg [data-sec="kids"]'))) await page.click('#tn-care-more'); await page.click('#care-seg [data-sec="kids"]'); await page.waitForSelector('#kd-kid-page .card, #kd-kid-page .ev:not(:has-text("Loading"))', T); };
const pageText = (page) => page.textContent('#kd-kid-page');
const today = await (async () => { const { dayIn } = await import('../../../api/_recur.mjs'); return dayIn('Asia/Kolkata'); })();

// ---- Rohan starts the page
const R = await phone(rohan, { hash: '#care' });
await R.waitForSelector('#tn-care-more', T); await R.click('#tn-care-more');
ok('to do: "Bachchon ka panna" is its own section, one tap away under "More"', await shown(R, '#care-seg [data-sec="kids"]'));
await kidsTab(R);
ok('a parent sees both children to pick from, his own first', await R.locator('#kd-kid-pick button').count() === 2 && (await R.textContent('#kd-kid-pick button.sel')).trim() === 'Aarav');
ok('start: a parent is offered "Start Aarav\'s page"', await sees(R, '#kd-kc-start h3', /Start Aarav's page/));
await design(R, '#pane-care .subsec[data-sec="kids"]', 'starting a child\'s page');
await R.fill('#kd-kf-school', 'City Montessori'); await R.fill('#kd-kf-class', '5 B'); await R.fill('#kd-kf-teacher', 'Mrs Rao');
await R.fill('#kd-kf-sphone', '0522 400 1234'); await R.fill('#kd-kf-allergy', 'Peanuts'); await R.fill('#kd-kf-doc', 'Dr Mehta'); await R.fill('#kd-kf-dphone', '+91 98100 00000');
await R.click('#kd-kc-start [data-kdact="save"]');
ok('start: saved, and the page opens with every part', await toastSays(R, /Saved/) && await shown(R, '#kd-kc-school') && await shown(R, '#kd-kc-pickup') && await shown(R, '#kd-kc-fees')
  && await shown(R, '#kd-kc-vaccines') && await shown(R, '#kd-kc-health') && await shown(R, '#kd-kc-share'));
ok('school: the name, class, teacher and a Call button', await sees(R, '#kd-kc-school', /City Montessori · Class 5 B/) && await sees(R, '#kd-kc-school', /Class teacher: Mrs Rao/) && await R.locator('#kd-kc-school a[href^="tel:"]').count() === 1);
ok('health: allergies as the family wrote them, the doctor to call, and the record line', await sees(R, '#kd-kc-health', /Allergies, as the family wrote them: Peanuts/) && await sees(R, '#kd-kc-health', /record your family keeps\. It is not medical advice/));

// fees, an exam, a class, a vaccination entry
await R.fill('#kd-kfee-title', 'Term 2 fee'); await R.fill('#kd-kfee-date', '2027-01-10'); await R.click('[data-kdact="fee"]');
ok('fees: a fee date is added, and says who is reminded', await sees(R, '#kd-kc-fees', /Term 2 fee/) && await sees(R, '#kd-kc-fees', /never to Aarav/) && await R.isChecked('#kd-kfee-sub'));
await R.fill('#kd-ke-title', 'Maths unit test'); await R.fill('#kd-ke-date', '2027-01-15'); await R.click('[data-kdact="exam"]');
ok('exams: an exam date is added', await sees(R, '#kd-kc-exams', /Maths unit test/));
ok('exams: the parent is told the child chooses who sees results', await sees(R, '#kd-kc-exams', /Aarav chooses whether results are shown to the wider family\. Right now: parents only\./) && await R.locator('#kd-ke-share').count() === 0);
await R.click('#kd-kc-classes summary'); await R.fill('#kd-ka-title', 'Tabla class'); await R.check('#kd-ka-days input[value="2"]'); await R.check('#kd-ka-days input[value="4"]'); await R.click('[data-kdact="class"]');
ok('classes: the days and the time read plainly', await sees(R, '#kd-kc-classes', /Tabla class/) && await sees(R, '#kd-kc-classes', /Tue, Thu · 5:00 pm/));
await R.click('#kd-kc-vaccines summary'); await R.fill('#kd-kv-title', 'Typhoid'); await R.fill('#kd-kv-date', '2025-03-01'); await R.fill('#kd-kv-next', '2028-03-01'); await R.click('[data-kdact="vaccine"]');
ok('vaccination record: the date given and the next date "as written", with the record line', await sees(R, '#kd-kc-vaccines', /Given on .*2025.*Next date, as written: .*2028/) && await sees(R, '#kd-kc-vaccines', /not medical advice/));

// pick-up: Chacha today, late in the evening so it is not yet due
await R.click('#kd-kc-pickup summary');
await R.selectOption('#kd-kp-who', chacha.id); await R.fill('#kd-kp-time', '23:59'); await R.click('[data-kdact="pset"]');
ok('pick-up: Chacha collects today, and the page says what happens if nobody taps', await sees(R, '#kd-kc-pickup', /Today: Chacha collects/) && await sees(R, '#kd-kc-pickup', /20 minutes after the time, the adults of the family are told/));
ok('pick-up: someone by name can be chosen too', (await R.textContent('#kd-kp-who')).includes('Nani (by name)') && !(await R.textContent('#kd-kp-who')).includes('Kabir'));

// share school with the family
await R.selectOption('#kd-kc-share select[data-kdshare="school"]', 'family');
ok('share: a parent marks School details for the whole family', await toastSays(R, /Shared with the family/));
await design(R, '#pane-care .subsec[data-sec="kids"]', 'a child\'s page as a parent sees it');
await wide(R, 'a child\'s page');

// ---- Aarav: his own page
const A = await phone(aarav, { hash: '#care' });
await kidsTab(A);
ok('child: a friendly page of his own', await sees(A, '#kd-kid-page .kd-hi', /Namaste, Aarav! This is your page/) && await sees(A, '#kd-kc-school h3', /My school/) && await sees(A, '#kd-kc-pickup', /Today: Chacha picks you up/));
const aText = await pageText(A);
ok('child: no fees, no vaccination record, no health lines, no sharing controls', !/Term 2 fee|Fee dates|Typhoid|Peanuts|Dr Mehta|What the rest of the family sees/.test(aText) && await A.locator('#kd-kc-fees, #kd-kc-health, #kd-kc-vaccines, #kd-kc-share, #kd-kc-edit').count() === 0);
ok('child: he cannot tap "Picked up" for himself', await A.locator('#kd-kc-pickup [data-kdact="picked"]').count() === 0);
await A.fill('#kd-ke-title', 'Hindi dictation'); await A.fill('#kd-ke-date', '2027-01-12'); await A.click('[data-kdact="exam"]');
ok('child: he adds his own exam date', await sees(A, '#kd-kc-exams', /Hindi dictation/));
await A.click('#kd-kc-exams .crow:has-text("Hindi dictation") [data-kdact="result"]');
await shown(A, '#asksheet'); await A.fill('#as-in', '9 of 10'); await A.click('#as-yes');
ok('child: and writes his marks', await sees(A, '#kd-kc-exams', /Result: 9 of 10/));
ok('child: "Who sees my marks" starts at only Mummy Papa', await A.getAttribute('#kd-ke-share [data-kdres="parents"]', 'aria-pressed') === 'true');
const mark = pushed.length;
await A.fill('#kd-kn-text', 'I want to join the football team'); await A.click('[data-kdact="note"]');
ok('child: "What I want to tell the family" is sent', await toastSays(A, /Sent/) && await sees(A, '#kd-kc-notes', /I want to join the football team/));
ok('child: his parents are told, and only they', pushed.slice(mark).filter(p => /Aarav wrote something for you/.test(p.body.title)).map(p => p.to).sort().join() === [rohan.id, meena.id].sort().join());
await design(A, '#pane-care .subsec[data-sec="kids"]', 'a child\'s own page');

// ---- Chacha: his turn today, school shared, nothing else
const C = await phone(chacha, { hash: '#care' });
await kidsTab(C);
ok('collector: "Your turn today" is at the top with one tap', await sees(C, '#kd-kid-today', /Your turn today: collect Aarav/) && await shown(C, '#kd-kid-today [data-kdturn]'));
await C.click('#kd-kid-pick [data-kdkid="' + aarav.id + '"]');
ok('another adult: the shared school, and his own turn', await sees(C, '#kd-kc-school', /City Montessori/) && await sees(C, '#kd-kc-pickup', /Today: You collect/));
ok('another adult: no fees, health, vaccination record or exams, which were not shared', !/Term 2 fee|Peanuts|Typhoid|Maths unit test/.test(await pageText(C)));
await design(C, '#pane-care .subsec[data-sec="kids"]', 'a child\'s page as another adult sees it, with "Your turn today"');
const m2 = pushed.length;
await C.click('#kd-kid-today [data-kdturn]');
ok('collector: one tap marks it and tells the parents', await toastSays(C, /Marked as picked up\. The parents have been told/) && await B.gone(C, '#kd-kid-today'));
ok('collector: both parents got the word', pushed.slice(m2).filter(p => /Chacha has picked up Aarav/.test(p.body.title)).map(p => p.to).sort().join() === [rohan.id, meena.id].sort().join());
await R.click('#kd-kid-pick [data-kdkid="' + aarav.id + '"]');
ok('parent: the page now shows it was picked up, and by whom', await sees(R, '#kd-kc-pickup', /✓ Picked up \(marked by Chacha\)/));

// ---- Aarav shares his marks; the cousin
await A.click('#kd-ke-share [data-kdres="family"]');
ok('child: he chooses to show his marks to the whole family', await toastSays(A, /whole family can see the results/) && await A.getAttribute('#kd-ke-share [data-kdres="family"]', 'aria-pressed') === 'true');
const K = await phone(kabir, { hash: '#care' });
await kidsTab(K);
ok('cousin: his own page is first, and has not been started', (await K.textContent('#kd-kid-pick button.sel')).trim() === 'My page' && await sees(K, '#kd-kid-page', /Your parents have not started your page yet/));
await K.click('#kd-kid-pick [data-kdkid="' + aarav.id + '"]');
ok('cousin: only the school a parent shared', await sees(K, '#kd-kc-school', /City Montessori/) && !/Peanuts|Term 2|Typhoid|football/.test(await pageText(K)) && await K.locator('#kd-kc-pickup, #kd-kc-fees, #kd-kc-health').count() === 0);

ok('today in the test is the family\'s today', /^\d{4}-\d{2}-\d{2}$/.test(today));
await B.finish();
