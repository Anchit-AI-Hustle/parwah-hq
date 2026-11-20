// HOME: REPAIRS AND WARRANTIES, END TO END: a real browser, the real API and
// a real PostgreSQL. Rohan adds the fridge with its warranty, its service
// date, who to call and the bill in his Vault; Papa sees it, calls the
// electrician and writes down who fixed it; a second entry is for Rohan
// alone and nobody else sees it.
//
// Every new surface is measured: 44px targets, a 12px floor, AA contrast in
// light and dark, nothing sideways at 320, 390 or 1280. Nothing here waits
// a fixed time: each step waits for the element or the state it checks.
import { kit, browserKit } from './jkit.mjs';
const k = await kit('home.e2e', ['circle', 'care', 'events', 'chats', 'auth', 'settings', 'book', 'plans', 'games', 'ekta']);
const { ok, user, family, seat, admin, sql } = k;
const H = await import('../../../api/_home.mjs');
await H.ensureHomeSchema(sql);
const B = await browserKit('home.e2e', k);
const { phone, sees, shown, gone, design, wide, toastSays, confirmSheet, T } = B;

const fam = await family('SHARMA24', 'Sharma Family');
const U = {}; for (const nm of ['Rohan', 'Papa', 'Kabir']) U[nm] = await user(nm);
const rohan = await seat(fam, U.Rohan, { dob: '1988-03-04' }), papa = await seat(fam, U.Papa, { role: 'parent', dob: '1958-01-20' });
const kabir = await seat(fam, U.Kabir, { dob: '2013-05-05' });
await admin.query(`insert into family_book (circle_id, kind, name, category, phone, by_member, visibility) values ($1,'contact','Sharma Electricals','local','+915224001234',$2,'circle')`, [fam.id, rohan.id]);
await admin.query(`insert into vault_docs (circle_id, about_member, kind, label, by_member) values ($1,$2,'other','Fridge bill 2024',$2)`, [fam.id, rohan.id]);
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const homeTab = async (page) => { await page.click('#vault-seg [data-sec="home"]'); await page.waitForSelector('#kd-hm-list .crow, #kd-hm-list .ev:not(:has-text("Loading"))', T); };

// ---- Rohan adds the fridge
const R = await phone(rohan, { hash: '#vault' });
ok('vault: "Ghar ka saaman" is its own section', await shown(R, '#vault-seg [data-sec="home"]'));
await homeTab(R);
ok('empty: a plain first line, and a form with the four choices of who sees it', await sees(R, '#kd-hm-list', /Nothing here yet/) && (await R.locator('#kd-hm-who option').allTextContents()).join('|') === 'Only me|People I choose|Whole family|Only in an emergency'
  && (await R.locator('#kd-hm-kind option').allTextContents()).join('|') === 'Appliance|Vehicle|House paper');
ok('form: it says no card number or password is kept, and where a bill goes', await sees(R, '#kd-hm-form', /never keeps a card number, a password or a PIN/) && await sees(R, '#kd-hm-form', /add it in Documents first/));
await design(R, '#pane-vault .subsec[data-sec="home"]', 'home upkeep, empty with its form');
await R.fill('#kd-hm-title', 'Fridge'); await R.fill('#kd-hm-bought', '2024-06-01'); await R.fill('#kd-hm-where', 'Vijay Sales');
await R.fill('#kd-hm-warranty', day(20)); await R.fill('#kd-hm-service', day(5));
await R.selectOption('#kd-hm-contact', { label: 'Sharma Electricals' }); await R.selectOption('#kd-hm-bill', { label: 'Fridge bill 2024' });
await R.fill('#kd-hm-billnote', 'Invoice 4471'); await R.fill('#kd-hm-fixed', 'Ramesh changed the gasket');
await R.click('#kd-hm-save');
ok('add: the fridge is listed with when it was bought, the warranty and the service', await toastSays(R, /Added/) && await sees(R, '#kd-hm-list', /🔧 Fridge/) && await sees(R, '#kd-hm-list', /Bought on .* at Vijay Sales/)
  && await sees(R, '#kd-hm-list', /Warranty until .*in 20 days/) && await sees(R, '#kd-hm-list', /Service due .*in 5 days/));
ok('add: who to call with a Call button, the bill, and who fixed it last time', await sees(R, '#kd-hm-list', /To call: Sharma Electricals/) && await R.locator('#kd-hm-list a[href^="tel:"]').count() === 1
  && await sees(R, '#kd-hm-list', /Bill: Fridge bill 2024 · Invoice 4471/) && await sees(R, '#kd-hm-list', /Fixed last time: Ramesh changed the gasket/) && await sees(R, '#kd-hm-list', /You wrote this · Whole family/));
// a second entry only for Rohan
await R.selectOption('#kd-hm-kind', 'vehicle'); await R.fill('#kd-hm-title', 'Scooter'); await R.selectOption('#kd-hm-who', 'ONLY_ME'); await R.click('#kd-hm-save');
ok('add: a second entry, only for me', await sees(R, '#kd-hm-list', /🚗 Scooter/) && await sees(R, '#kd-hm-list', /You wrote this · Only me/));
await R.selectOption('#kd-hm-who', 'NOMINEES_ONLY');
ok('form: "People I choose" opens the list of people', await shown(R, '#kd-hm-people') && (await R.textContent('#kd-hm-people')).includes('Papa'));
await R.selectOption('#kd-hm-who', 'IMMEDIATE');
await design(R, '#pane-vault .subsec[data-sec="home"]', 'home upkeep with entries, as the person who wrote them');
await wide(R, 'home upkeep');
// a card number is refused
await R.fill('#kd-hm-title', 'TV'); await R.fill('#kd-hm-billnote', 'card 4111 1111 1111 1111'); await R.click('#kd-hm-save');
ok('add: a card number is refused, in words', await toastSays(R, /card number/));
await R.fill('#kd-hm-billnote', ''); await R.fill('#kd-hm-title', '');

// ---- Papa sees the family one, and writes down a repair
const P = await phone(papa, { hash: '#vault' });
await homeTab(P);
ok('family: Papa sees the fridge and not the scooter', await sees(P, '#kd-hm-list', /Fridge/) && !(await P.textContent('#kd-hm-list')).includes('Scooter'));
ok('family: he can call the electrician; the bill is kept in Rohan\'s Vault', await P.locator('#kd-hm-list a[href^="tel:"]').count() === 1 && await sees(P, '#kd-hm-list', /The bill is in Rohan's Vault · Invoice 4471/) && !(await P.textContent('#kd-hm-list')).includes('Fridge bill 2024'));
ok('family: no Change or Remove on someone else\'s entry', await P.locator('#kd-hm-list [data-kdhm="edit"], #kd-hm-list [data-kdhm="del"]').count() === 0 && await P.locator('#kd-hm-list [data-kdhm="log"]').count() === 1);
await design(P, '#pane-vault .subsec[data-sec="home"]', 'home upkeep as the family sees it');
await P.click('#kd-hm-list [data-kdhm="log"]');
await shown(P, '#asksheet'); await P.fill('#as-in', 'Imran refilled the gas'); await P.click('#as-yes');
ok('repair: "who fixed it last time" is written down, with who wrote it', await toastSays(P, /Written down/) && await sees(P, '#kd-hm-list', /Fixed last time: Imran refilled the gas \(written by Papa/));

// ---- a child reads the family entry and writes nothing
const K = await phone(kabir, { hash: '#vault' });
await homeTab(K);
ok('child: reads the family entry, with no button to write a repair', await sees(K, '#kd-hm-list', /Fridge/) && await K.locator('#kd-hm-list [data-kdhm="log"]').count() === 0);

// ---- Rohan changes and removes
await R.click('#vault-seg [data-sec="docs"]'); await homeTab(R);
await R.click('#kd-hm-list .crow:has-text("Fridge") [data-kdhm="edit"]');
ok('change: the form fills with the entry', await sees(R, '#kd-hm-head', /Change: Fridge/) && await R.inputValue('#kd-hm-title') === 'Fridge' && await R.inputValue('#kd-hm-warranty') === day(20) && await shown(R, '#kd-hm-cancel'));
await R.fill('#kd-hm-title', 'Fridge (kitchen)'); await R.click('#kd-hm-save');
ok('change: saved', await toastSays(R, /Saved/) && await sees(R, '#kd-hm-list', /Fridge \(kitchen\)/) && await sees(R, '#kd-hm-list', /Imran refilled the gas/));
await R.click('#kd-hm-list .crow:has-text("Scooter") [data-kdhm="del"]');
await confirmSheet(R);
ok('remove: gone after a yes', await toastSays(R, /Removed/) && !(await R.textContent('#kd-hm-list')).includes('Scooter'));

await B.finish();
