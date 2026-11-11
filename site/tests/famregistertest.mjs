// THE FAMILY REGISTER: the viewing rule and what may be saved, with no
// database and no network. api/_register.mjs imports only _money.mjs, which
// imports nothing, so this runs in scripts/checks.sh before npm install.
// The same rules against a real database: site/tests/db/famregister.dbtest.mjs.
import {
  ASSET_CATEGORIES, UNLOCK_POLICIES, REGISTER_GROUPS, REGISTER_WHO, REGISTER_KIND_LABEL,
  canViewAssetLocator, registerCanManage, registerLogsView, registerRowFor,
  registerClean, registerWho, registerIdentifier, registerSecretRisk, registerDate, registerSeenBy,
  maskAssetIdentifier
} from '../../api/_register.mjs';
import * as careprep from '../../api/_careprep.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail === undefined ? '' : ' -> ' + detail)); };

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222',
      C = '33333333-3333-4333-8333-333333333333', D = '44444444-4444-4444-8444-444444444444';

// ---- the kinds
ok('the eight original kinds are still accepted, in their place', ASSET_CATEGORIES.slice(0, 8).join() === 'BANK_ACCOUNT,LOCKER_KEY,FIXED_DEPOSIT,WILL,DEMAT,PROPERTY_DEED,PENSION,OTHER');
for (const k of ['HOUSE', 'LAND', 'SHOP_OFFICE', 'VEHICLE', 'GOLD', 'MUTUAL_FUNDS', 'PPF_EPF_NPS', 'INSURANCE', 'LOAN', 'RENT_AGREEMENT', 'BUSINESS_PAPER', 'SUBSCRIPTION', 'DIGITAL_ACCOUNT', 'HEIRLOOM']) {
  ok('a new kind: ' + k, ASSET_CATEGORIES.includes(k) && !!REGISTER_KIND_LABEL[k]);
}
ok('the picker has six plain headings', REGISTER_GROUPS.map(g => g.label).join('|') === 'Home and land|Money|Papers|Things|Online|Other');
const grouped = REGISTER_GROUPS.flatMap(g => g.kinds.map(k => k[0]));
ok('every kind sits under exactly one heading', grouped.length === new Set(grouped).size && grouped.slice().sort().join() === ASSET_CATEGORIES.slice().sort().join());
ok('_careprep.mjs still exports the names other files use', careprep.ASSET_CATEGORIES === ASSET_CATEGORIES && careprep.UNLOCK_POLICIES === UNLOCK_POLICIES
   && careprep.canViewAssetLocator === canViewAssetLocator && careprep.maskAssetIdentifier === maskAssetIdentifier && typeof careprep.locatorApi === 'function');

// ---- who can see it
ok('four choices, the old three with their old keys', UNLOCK_POLICIES.join() === 'IMMEDIATE,EMERGENCY_ONLY,NOMINEES_ONLY,ONLY_ME');
ok('said plainly, in the order shown', REGISTER_WHO.map(w => w.join(':')).join('|') === 'ONLY_ME:Only me|NOMINEES_ONLY:People I choose|IMMEDIATE:Whole family|EMERGENCY_ONLY:Only in an emergency');
const row = (policy, extra = {}) => ({ id: 'x', person_id: A, created_by: B, unlock_policy: policy, asset_category: 'HOUSE', institution_or_item: 'Flat', physical_location_notes: 'Blue file', ...extra });
for (const p of UNLOCK_POLICIES) {
  ok(p + ': the person it is about always sees it', canViewAssetLocator(row(p), A));
  ok(p + ': whoever wrote it always sees it', canViewAssetLocator(row(p), B));
}
ok('Only me: nobody else', !canViewAssetLocator(row('ONLY_ME'), C));
ok('Only me: not even in an emergency', !canViewAssetLocator(row('ONLY_ME'), C, true));
ok('Only me: not even if they were once chosen', !canViewAssetLocator(row('ONLY_ME', { designated_recipients: [C] }), C));
ok('Whole family: everyone', canViewAssetLocator(row('IMMEDIATE'), C));
ok('an old row with no rule reads as whole family', canViewAssetLocator(row(undefined), C));
ok('People I choose: someone chosen', canViewAssetLocator(row('NOMINEES_ONLY', { designated_recipients: [C] }), C));
ok('People I choose: someone not chosen', !canViewAssetLocator(row('NOMINEES_ONLY', { designated_recipients: [C] }), D));
ok('People I choose: nobody chosen is nobody', !canViewAssetLocator(row('NOMINEES_ONLY', { designated_recipients: [] }), C));
ok('People I choose: an emergency does not open it', !canViewAssetLocator(row('NOMINEES_ONLY', { designated_recipients: [C] }), D, true));
ok('People I choose: the list may arrive as text', canViewAssetLocator(row('NOMINEES_ONLY', { designated_recipients: JSON.stringify([C]) }), C));
ok('Only in an emergency: closed with no SOS', !canViewAssetLocator(row('EMERGENCY_ONLY'), C, false));
ok('Only in an emergency: open during one', canViewAssetLocator(row('EMERGENCY_ONLY'), C, true));
ok('nobody at all sees nothing', !canViewAssetLocator(row('NOMINEES_ONLY'), null) && !canViewAssetLocator(null, C));

ok('the owner and the author manage it', registerCanManage(row('IMMEDIATE'), A) && registerCanManage(row('IMMEDIATE'), B));
ok('nobody else does, even when they can read it', !registerCanManage(row('IMMEDIATE'), C) && !registerCanManage(row('IMMEDIATE'), null));
ok('a view is logged for anyone but the person it is about', registerLogsView(row('IMMEDIATE'), C) && registerLogsView(row('IMMEDIATE'), B) && !registerLogsView(row('IMMEDIATE'), A));

// ---- what a member receives
const full = row('NOMINEES_ONLY', { designated_recipients: [C], identifier_mask: 'Ending in ...4921', nominee: 'Rohan', approx_value: '8500000', value_currency: 'INR',
  due_day: '2027-03-31', note: 'Tax in March', custom_label: null, person_name: 'Papa', in_name_text: 'jointly with Sunita' });
ok('Only me, to anyone else: nothing at all', registerRowFor(row('ONLY_ME'), C) === null && registerRowFor(row('ONLY_ME'), C, true) === null);
ok('Only me, to its owner: the entry', registerRowFor(row('ONLY_ME'), A).can_view === true);
const locked = registerRowFor(full, D);
ok('not chosen: a locked row with whose it is and the kind', locked.can_view === false && locked.can_manage === false && locked.person_id === A && locked.person_name === 'Papa' && locked.kind_label === 'House or flat');
ok('and nothing that identifies it', locked.institution_or_item === null && locked.identifier_mask === null && locked.physical_location_notes === null
   && !/Flat|Blue file|4921|Rohan|8500000|March|Sunita/.test(JSON.stringify(locked)), JSON.stringify(locked));
const lockedOwn = registerRowFor(row('EMERGENCY_ONLY', { asset_category: 'OTHER', custom_label: 'Dadi\'s trunk' }), D);
ok('a locked "anything else" does not give away its own label', lockedOwn.kind_label === 'Anything else' && !/trunk/.test(JSON.stringify(lockedOwn)));
const seen = registerRowFor(full, C);
ok('chosen: every detail', seen.can_view && seen.physical_location_notes === 'Blue file' && seen.nominee === 'Rohan' && seen.approx_value === 8500000
   && /85,00,000/.test(seen.value_text) && seen.due_on === '2027-03-31' && seen.note === 'Tax in March' && seen.in_name_text === 'jointly with Sunita', JSON.stringify(seen));
ok('but not who else was chosen', !('designated_recipients' in seen) && seen.can_manage === false);
ok('the owner is told who is chosen', JSON.stringify(registerRowFor(full, A).designated_recipients) === JSON.stringify([C]));
const brief = registerRowFor(full, C, false, { details: false });
ok('the list: title and kind, no details', brief.institution_or_item === 'Flat' && brief.has_details === false && !('physical_location_notes' in brief) && !('nominee' in brief) && !('identifier_mask' in brief));
ok('"anything else" shows the person\'s own label to those who can see it', registerRowFor(row('IMMEDIATE', { asset_category: 'OTHER', custom_label: 'Sewing machine' }), C).kind_label === 'Sewing machine');
ok('an old row with a kind nobody knows still reads', registerRowFor(row('IMMEDIATE', { asset_category: 'SOMETHING_OLD' }), C).kind_label === 'Anything else');

// ---- never a secret
ok('a long account number keeps only its last 4', registerIdentifier('482910244921') === 'Ending in ...4921');
ok('and so does a policy number with letters around it', registerIdentifier('Policy LIC/123456789') === 'Ending in ...6789');
ok('a short label stays as typed', registerIdentifier('Locker #42') === 'Locker #42' && registerIdentifier('  Folio 12 ') === 'Folio 12');
ok('nothing typed is nothing stored', registerIdentifier('') === null && registerIdentifier(null) === null);
ok('a password written out is refused', /never keeps a password/.test(registerSecretRisk('Gmail password: tiger@77') || ''));
for (const t of ['password is Tiger@77', 'Password - Tiger@77', 'pwd Tiger@77', 'Netbanking pass: Tiger@77', 'login: rohan / Tiger@77', 'user name is rohan77'])
  ok('a password or sign-in phrased any way is refused: ' + t, !!registerSecretRisk(t));
for (const t of ['The password is in the red diary', 'password kept with Maa', 'login details are in the blue file', 'pass the salt', 'PIN code 560038', 'Passbook is in the steel almirah'])
  ok('saying where it is kept, or an ordinary line, is fine: ' + t, registerSecretRisk(t) === null);
ok('so is "pwd=..."', !!registerSecretRisk('pwd = hunter2'));
ok('a PIN written out is refused', !!registerSecretRisk('Locker PIN is 4821') && !!registerSecretRisk('pin: 4821') && !!registerSecretRisk('PIN 4821'));
ok('a passcode written out is refused', !!registerSecretRisk('phone passcode 482913'));
ok('where a password is kept is fine', registerSecretRisk('The password is in the red diary') === null);
ok('a postal PIN code is not a secret', registerSecretRisk('Flat 4, Indiranagar, PIN 560038') === null && registerSecretRisk('PIN code 560038') === null);
ok('plain words are fine', registerSecretRisk('Sale deed in the steel almirah') === null);

// ---- what may be saved
const good = { institutionOrItem: ' Flat in Indiranagar ', physicalLocationNotes: 'Blue file', category: 'HOUSE', unlockPolicy: 'IMMEDIATE' };
let c = registerClean(good);
ok('the least that can be saved', c.value && c.value.title === 'Flat in Indiranagar' && c.value.category === 'HOUSE' && c.value.unlockPolicy === 'IMMEDIATE'
   && c.value.nominee === null && c.value.approxValue === null && c.value.dueOn === null && c.value.note === null && c.value.identifier === null && c.value.designatedRecipients.length === 0, JSON.stringify(c));
ok('no title', registerClean({ ...good, institutionOrItem: ' ' }).field === 'title');
ok('no place', registerClean({ ...good, physicalLocationNotes: '' }).field === 'where');
ok('no choice of who sees it', /Choose who can see this/.test(registerClean({ ...good, unlockPolicy: undefined }).error));
ok('a choice that is not one of the four', /Choose who can see this/.test(registerClean({ ...good, unlockPolicy: 'EVERYONE' }).error));
ok('a kind nobody knows becomes "anything else"', registerClean({ ...good, category: 'NOPE' }).value.category === 'OTHER');
ok('your own label is kept for "anything else"', registerClean({ ...good, category: 'OTHER', customLabel: 'Sewing machine' }).value.customLabel === 'Sewing machine');
ok('and dropped for a named kind', registerClean({ ...good, customLabel: 'Sewing machine' }).value.customLabel === null);
ok('your own label: 40 fits, 41 does not', !!registerClean({ ...good, category: 'OTHER', customLabel: 'x'.repeat(40) }).value && registerClean({ ...good, category: 'OTHER', customLabel: 'x'.repeat(41) }).field === 'label');
ok('nominee: 80 fits, 81 does not', !!registerClean({ ...good, nominee: 'x'.repeat(80) }).value && registerClean({ ...good, nominee: 'x'.repeat(81) }).field === 'nominee');
ok('the name it is in: 80 fits, 81 does not', !!registerClean({ ...good, inNameText: 'x'.repeat(80) }).value && registerClean({ ...good, inNameText: 'x'.repeat(81) }).field === 'inName');
ok('note: 500 fits, 501 does not', !!registerClean({ ...good, note: 'x'.repeat(500) }).value && registerClean({ ...good, note: 'x'.repeat(501) }).field === 'note');
ok('a member it is in the name of must be an id', registerClean({ ...good, inNameMemberId: 'Papa' }).field === 'inName' && registerClean({ ...good, inNameMemberId: A }).value.inNameMember === A);
ok('a value with commas is a whole number', registerClean({ ...good, approxValue: '85,00,000' }).value.approxValue === 8500000);
ok('a value in words is refused', registerClean({ ...good, approxValue: 'ten lakh' }).field === 'value');
ok('a value of nothing, or a negative one, is refused', registerClean({ ...good, approxValue: '0' }).field === 'value' && registerClean({ ...good, approxValue: '-5' }).field === 'value');
ok('an absurd value is refused', registerClean({ ...good, approxValue: '99999999999999999' }).field === 'value');
ok('a known currency is kept, an unknown one is not', registerClean({ ...good, approxValue: 5, valueCurrency: 'gbp' }).value.valueCurrency === 'GBP' && registerClean({ ...good, approxValue: 5, valueCurrency: 'ZZZ' }).value.valueCurrency === null);
ok('a real date is kept', registerClean({ ...good, dueOn: '2027-03-31' }).value.dueOn === '2027-03-31' && registerDate('2028-02-29') === '2028-02-29');
ok('a date that does not exist is refused', registerClean({ ...good, dueOn: '2027-02-30' }).field === 'due' && registerClean({ ...good, dueOn: '31/03/2027' }).field === 'due');
ok('a long number in the number box keeps only its last 4', registerClean({ ...good, identifierMask: 'A/c 482910244921' }).value.identifier === 'Ending in ...4921');
for (const f of ['institutionOrItem', 'physicalLocationNotes', 'identifierMask', 'inNameText', 'nominee', 'note']) {
  ok('a password written out is refused in ' + f, /never keeps a password/.test(registerClean({ ...good, [f]: 'password: tiger@77' }).error || ''));
}
ok('and in your own label', /never keeps a password/.test(registerClean({ ...good, category: 'OTHER', customLabel: 'pin 4821' }).error || ''));
// The card-number check is handed in by the handler (noteRisk in _notesapi.mjs).
const risk = (v) => /4111/.test(v) ? 'That looks like a card number' : null;
ok('the check handed in runs on every box', registerClean({ ...good, note: 'card 4111' }, { risk }).error === 'That looks like a card number'
   && registerClean({ ...good, identifierMask: '4111' }, { risk }).field === 'identifier' && !!registerClean(good, { risk }).value);
ok('control characters never reach the database', registerClean({ ...good, institutionOrItem: 'Flat\u0000 one' }).value.title === 'Flat  one');

// ---- who sees it, on its own (change who sees it)
ok('People I choose needs someone', registerWho({ unlockPolicy: 'NOMINEES_ONLY', designatedRecipients: [] }).field === 'people' && registerWho({ unlockPolicy: 'NOMINEES_ONLY' }).field === 'people');
ok('things that are not ids are not people', registerWho({ unlockPolicy: 'NOMINEES_ONLY', designatedRecipients: ['Rohan', 7, null] }).field === 'people');
ok('each person once', registerWho({ unlockPolicy: 'NOMINEES_ONLY', designatedRecipients: [C, C, D] }).value.designatedRecipients.join() === [C, D].join());
ok('any other choice forgets the people', registerWho({ unlockPolicy: 'ONLY_ME', designatedRecipients: [C] }).value.designatedRecipients.length === 0
   && registerWho({ unlockPolicy: 'IMMEDIATE', designatedRecipients: [C] }).value.designatedRecipients.length === 0
   && registerWho({ unlockPolicy: 'EMERGENCY_ONLY', designatedRecipients: [C] }).value.designatedRecipients.length === 0);

// ---- seen by
const by = registerSeenBy([
  { locator_id: 'x', viewer_id: C, name: 'Priya', at: '2026-11-03T10:00:00Z' },
  { locator_id: 'x', viewer_id: C, name: 'Priya', at: '2026-11-02T10:00:00Z' },
  { locator_id: 'x', viewer_id: D, name: 'Rohan', at: '2026-11-01T10:00:00Z' },
  { locator_id: 'y', viewer_id: D, name: null, at: '2026-11-01T10:00:00Z' }
]);
ok('seen by: each person once, with their latest day', by.x.length === 2 && by.x[0].name === 'Priya' && by.x[0].at === '2026-11-03T10:00:00Z' && by.x[1].name === 'Rohan');
ok('seen by: someone whose name is gone is still counted', by.y.length === 1 && by.y[0].name === 'Someone in the family');
ok('seen by: nothing is nothing', Object.keys(registerSeenBy([])).length === 0 && Object.keys(registerSeenBy(null)).length === 0);

console.log(`famregistertest: ${fails.length ? fails.length + ' FAILED of ' + (pass + fails.length) : pass + '/' + pass + ' checks pass'}`);
if (fails.length) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
