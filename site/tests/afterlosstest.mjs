// "WHAT NEEDS DOING": the checklist for when someone passes away. Its rules,
// with no database and no network. api/_afterloss.mjs imports nothing, and
// the viewing rule it is handed is registerRowFor from api/_register.mjs
// (which imports only _money.mjs), so this runs in scripts/checks.sh before
// npm install. Against a real database: site/tests/db/afterloss.dbtest.mjs.
import { readFileSync } from 'node:fs';
import {
  AFTERLOSS_NAME, AFTERLOSS_SORRY, AFTERLOSS_LEGAL, AFTERLOSS_FIRST, AFTERLOSS_KINDS, AFTERLOSS_MAX,
  afterlossKey, afterlossDay, afterlossEntryStep, afterlossIsAdult, afterlossStartRule,
  afterlossOpens, afterlossSteps, afterlossProgress, afterlossNote, afterlossPush
} from '../../api/_afterloss.mjs';
import { ASSET_CATEGORIES, registerRowFor, registerSecretRisk } from '../../api/_register.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail === undefined ? '' : ' -> ' + detail)); };

const PAPA = '11111111-1111-4111-8111-111111111111', ROHAN = '22222222-2222-4222-8222-222222222222',
      MEERA = '33333333-3333-4333-8333-333333333333', PRIYA = '44444444-4444-4444-8444-444444444444',
      KABIR = '55555555-5555-4555-8555-555555555555';
const members = [
  { id: PAPA, name: 'Papa', user_id: 'u1' }, { id: ROHAN, name: 'Rohan', user_id: 'u2' },
  { id: MEERA, name: 'Meera', user_id: 'u3' }, { id: PRIYA, name: 'Priya', user_id: 'u4' }
];
const src = readFileSync(new URL('../../api/_afterloss.mjs', import.meta.url), 'utf8');

// ---- the words
ok('it is called What needs doing', AFTERLOSS_NAME === 'What needs doing');
ok('it says sorry, plainly', AFTERLOSS_SORRY === 'We are sorry. This list is here so nothing is forgotten.');
ok('it says once that it is not legal advice', AFTERLOSS_LEGAL === 'This is a list to help you remember, not legal advice. Rules differ by bank and state.');
ok('the rules import nothing', !/^\s*import\s/m.test(src) && !/\brequire\(/.test(src));
ok('no long dashes in any word it writes', !new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']').test(src));

// ---- first things: the fixed list
ok('nine first things', AFTERLOSS_FIRST.length === 9);
ok('each has a key, a step and one line of how', AFTERLOSS_FIRST.every(s => /^f:[a-z]+$/.test(s.key) && s.title.length > 8 && s.how.length > 12 && s.how.length < 130));
ok('the keys are all different', new Set(AFTERLOSS_FIRST.map(s => s.key)).size === 9);
const firstText = AFTERLOSS_FIRST.map(s => s.title + ' ' + s.how).join(' | ');
for (const [what, re] of [
  ['the death certificate, from the municipal office or the hospital, several copies', /death certificate.*municipal office or the hospital.*several copies/i],
  ['the bank', /Tell the bank or banks/], ['the insurer', /Tell the insurer or insurers/],
  ['the employer or pension office', /Tell the employer or the pension office/],
  ['the phone and utilities', /Stop or move the phone and the utilities/],
  ['a will', /Look for a will/], ['the landlord or society', /Tell the landlord or the housing society/],
  ['Aadhaar and PAN kept safe, not surrendered in a hurry', /Keep the Aadhaar and PAN safe.*Do not surrender them in a hurry/],
  ['subscriptions', /Cancel or move the subscriptions/]
]) ok('first things: ' + what, re.test(firstText), firstText);
ok('the death certificate comes first', AFTERLOSS_FIRST[0].key === 'f:certificate');
ok('no promise about how long it takes or how it ends', !/\b(within|days|weeks|guarantee|will be paid|will get|always|surely|quick)\b/i.test(firstText), firstText);
ok('nothing that reads as legal advice or an order from a court', !/\b(must|legally|by law|court|lawyer will|entitled)\b/i.test(firstText), firstText);

// ---- step keys
ok('a first-things key is accepted', afterlossKey('f:bank').part === 'first');
ok('a register key is e: and the entry id', afterlossKey('e:' + PAPA.toUpperCase()).entryId === PAPA && afterlossKey('e:' + PAPA).part === 'register');
ok('anything else is not a step', [null, '', 'f:nope', 'e:12', 'x:' + PAPA, PAPA, 'e:' + PAPA + "'; drop"].every(k => afterlossKey(k) === null));

// ---- the date
ok('a date reads as 31 Mar 2027', afterlossDay('2027-03-31') === '31 Mar 2027' && afterlossDay('2027-01-05') === '5 Jan 2027');
ok('no date, or a bad one, reads as nothing', afterlossDay(null) === '' && afterlossDay('soon') === '' && afterlossDay('2027-13-01') === '');

// ---- wording, for every kind
const e = (asset_category, extra = {}) => ({ asset_category, institution_or_item: 'X', physical_location_notes: 'in the blue file', ...extra });
ok('every register kind has its own wording', ASSET_CATEGORIES.slice().sort().join() === AFTERLOSS_KINDS.slice().sort().join(), AFTERLOSS_KINDS.join());
for (const k of ASSET_CATEGORIES) {
  const s = afterlossEntryStep(e(k, { institution_or_item: 'Thing ' + k }));
  ok('wording for ' + k + ' names the entry and says where it is kept', s.title.includes('Thing ' + k) && /in the blue file\.$/.test(s.how) && !/undefined|null/.test(s.title + s.how), JSON.stringify(s));
}
let s = afterlossEntryStep(e('BANK_ACCOUNT', { institution_or_item: 'SBI savings', nominee: 'Meera Sharma', identifier_mask: 'Ending in ...4921' }));
ok('bank account: tell the bank, ask for the claim form for the nominee', s.title === 'Tell SBI savings. Ask for the claim form for the nominee Meera Sharma.', s.title);
ok('bank account: the number keeps only what the register kept', /Number or label: Ending in \.\.\.4921\./.test(s.how), s.how);
ok('bank account with no nominee asks what the bank needs', afterlossEntryStep(e('BANK_ACCOUNT', { institution_or_item: 'SBI savings' })).title === 'Tell SBI savings. Ask which papers they need from the family.');
s = afterlossEntryStep(e('INSURANCE', { institution_or_item: 'LIC Jeevan Anand', physical_location_notes: 'Bond in the grey box', nominee: 'Rohan', due_on: '2027-01-15' }));
ok('insurance: claim on the policy, and where the papers are', s.title === 'Claim on LIC Jeevan Anand. The nominee is Rohan.' && /^Papers: Bond in the grey box\./.test(s.how), JSON.stringify(s));
ok('insurance: the due date is said plainly', /Next premium or renewal: 15 Jan 2027\.$/.test(s.how), s.how);
ok('locker: tell the bank, and where the key is', /^Tell the bank about SBI locker\. Ask how the family can open it\.$/.test(afterlossEntryStep(e('LOCKER_KEY', { institution_or_item: 'SBI locker' })).title)
   && /^Key: in the blue file\./.test(afterlossEntryStep(e('LOCKER_KEY')).how));
ok('vehicle: move it to a new name at the RTO', /^Move Maruti Swift to a new name at the transport office \(RTO\)/.test(afterlossEntryStep(e('VEHICLE', { institution_or_item: 'Maruti Swift' })).title));
for (const k of ['HOUSE', 'LAND', 'SHOP_OFFICE']) ok('property (' + k + '): the change of name is called mutation', /change the name on Flat in Indiranagar \(mutation\)/.test(afterlossEntryStep(e(k, { institution_or_item: 'Flat in Indiranagar' })).title));
ok('property papers: keep them for the mutation', /mutation/.test(afterlossEntryStep(e('PROPERTY_DEED')).title));
ok('loan: tell the lender; ask about the loan cover', afterlossEntryStep(e('LOAN', { institution_or_item: 'HDFC home loan' })).title === 'Tell the lender for HDFC home loan; ask about the loan cover.');
s = afterlossEntryStep(e('DIGITAL_ACCOUNT', { institution_or_item: 'Gmail', physical_location_notes: 'In the red diary, last page' }));
ok('digital account: use the recovery details, and where they are kept', /^Close Gmail, or keep it as a memory\. Use the recovery details/.test(s.title) && s.how === 'Recovery details: In the red diary, last page.', JSON.stringify(s));
s = afterlossEntryStep(e('SUBSCRIPTION', { institution_or_item: 'Tata Play', due_on: '2026-12-01' }));
ok('subscription: cancel it, with the day it renews', s.title === 'Cancel Tata Play.' && /Renews on: 1 Dec 2026\./.test(s.how), JSON.stringify(s));
ok('fixed deposit: the day it matures', /Matures on: 9 Feb 2028\./.test(afterlossEntryStep(e('FIXED_DEPOSIT', { due_on: '2028-02-09' })).how));
ok('pension: ask if a family pension applies', /family pension applies/.test(afterlossEntryStep(e('PENSION')).title));
ok('gold and heirlooms: kept safe until the family decides together', ['GOLD', 'HEIRLOOM'].every(k => /safe until the family decides together/.test(afterlossEntryStep(e(k)).title)));
ok('a will is read with the family', /^Read X with the family/.test(afterlossEntryStep(e('WILL')).title));
s = afterlossEntryStep(e('OTHER', { institution_or_item: 'Sewing machine', custom_label: "Dadi's things" }));
ok('anything else, with the family\'s own name for the kind', s.title === 'Decide together what happens to Sewing machine.' && /^Kind: Dadi's things\. Papers: in the blue file\.$/.test(s.how), JSON.stringify(s));
ok('a kind this file has never heard of reads as anything else', afterlossEntryStep(e('SPACESHIP', { institution_or_item: 'Rocket' })).title === 'Decide together what happens to Rocket.');
ok('an empty entry still makes a sentence', afterlossEntryStep({}).title === 'Decide together what happens to this entry.' && afterlossEntryStep(null).how === '');
const allWording = ASSET_CATEGORIES.map(k => { const x = afterlossEntryStep(e(k, { nominee: 'N', due_on: '2027-01-01' })); return x.title + ' ' + x.how; }).join(' | ');
ok('no promise and no order in any wording', !/\b(must|guarantee|within \d|will be paid|entitled|legally)\b/i.test(allWording), allWording);

// ---- who is an adult, and the second adult
const today = new Date('2026-11-12T00:00:00Z');
ok('someone on Parwah with no date of birth is an adult', afterlossIsAdult({ user_id: 'u' }, today));
ok('someone added by name is never one', !afterlossIsAdult({ user_id: null }, today) && !afterlossIsAdult(null, today));
ok('17 is not an adult, 18 today is', !afterlossIsAdult({ user_id: 'u', dob: '2008-11-13' }, today) && afterlossIsAdult({ user_id: 'u', dob: '2008-11-12' }, today));
let rule = afterlossStartRule({ me: members[1], personId: PAPA, members, askId: null, today });
ok('with other adults, starting alone is refused', rule.error && rule.status === 400 && rule.field === 'ask' && /second adult/.test(rule.error), JSON.stringify(rule));
ok('the adults who can be asked are everyone but me and the person', rule.others.map(m => m.name).join() === 'Meera,Priya');
rule = afterlossStartRule({ me: members[1], personId: PAPA, members, askId: MEERA, today });
ok('naming a second adult is accepted, and it still needs their yes', rule.needs === true && rule.askId === MEERA && !rule.error);
ok('the person themself cannot be the second adult', !!afterlossStartRule({ me: members[1], personId: PAPA, members, askId: PAPA, today }).error);
ok('nor can I be my own second adult', !!afterlossStartRule({ me: members[1], personId: PAPA, members, askId: ROHAN, today }).error);
ok('nor someone from outside the family', !!afterlossStartRule({ me: members[1], personId: PAPA, members, askId: KABIR, today }).error);
const small = [members[0], members[1], { id: KABIR, name: 'Kabir', user_id: 'u9', dob: '2015-01-01' }, { id: PRIYA, name: 'Dadi', user_id: null }];
rule = afterlossStartRule({ me: members[1], personId: PAPA, members: small, askId: null, today });
ok('with only one adult (a child and a name do not count), one is enough', rule.needs === false && !rule.error, JSON.stringify(rule));
ok('nobody starts it for themself', afterlossStartRule({ me: members[0], personId: PAPA, members, askId: ROHAN, today }).status === 400);
ok('a child cannot start it', afterlossStartRule({ me: small[2], personId: PAPA, members: small, askId: ROHAN, today }).status === 403);

// ---- the nominee, as a name

// ---- "Only in an emergency" and an active list
const list = { status: 'active', person_id: PAPA, started_by: ROHAN, confirmed_by: MEERA };
const row = (extra) => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', person_id: PAPA, created_by: PAPA, asset_category: 'BANK_ACCOUNT', institution_or_item: 'SBI savings',
  physical_location_notes: 'Passbook in the almirah', unlock_policy: 'IMMEDIATE', designated_recipients: [], ...extra });
ok('an active list opens for the two who started and confirmed it', afterlossOpens(list, row(), ROHAN, members) && afterlossOpens(list, row(), MEERA, members));
ok('not for anyone else', !afterlossOpens(list, row(), PRIYA, members));
ok('and not for someone who only shares the nominee\'s name', !afterlossOpens(list, row({ nominee: 'Priya' }), PRIYA, members));
ok('only for that person\'s entries', !afterlossOpens(list, row({ person_id: MEERA }), ROHAN, members));
ok('not while it waits for the second adult, and not once closed', !afterlossOpens({ ...list, status: 'pending' }, row(), ROHAN, members) && !afterlossOpens({ ...list, status: 'closed' }, row(), ROHAN, members));
ok('no list, no entry or no viewer opens nothing', !afterlossOpens(null, row(), ROHAN, members) && !afterlossOpens(list, null, ROHAN, members) && !afterlossOpens(list, row(), null, members));

// ---- the list one person sees: nothing for an entry they may not see
const rows = [
  row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', institution_or_item: 'SBI savings', unlock_policy: 'IMMEDIATE' }),
  row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', institution_or_item: 'Secret diary', unlock_policy: 'ONLY_ME', asset_category: 'OTHER' }),
  row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', institution_or_item: 'LIC policy', unlock_policy: 'NOMINEES_ONLY', designated_recipients: [PRIYA], asset_category: 'INSURANCE' }),
  row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', institution_or_item: 'Bank locker', unlock_policy: 'EMERGENCY_ONLY', asset_category: 'LOCKER_KEY' }),
  row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', institution_or_item: 'Gold set', unlock_policy: 'ONLY_ME', created_by: MEERA, asset_category: 'GOLD' })
];
const opens = (r, id) => afterlossOpens(list, r, id, members);
const seen = (viewer, o = opens) => afterlossSteps({ rows, viewerId: viewer, rowFor: registerRowFor, opens: o });
const reg = (v) => v.steps.filter(x => x.part === 'register').map(x => x.title).join(' | ');
ok('the first nine steps are there for everyone', [ROHAN, MEERA, PRIYA].every(id => seen(id).steps.slice(0, 9).map(x => x.key).join() === AFTERLOSS_FIRST.map(x => x.key).join()));
let v = seen(ROHAN);
ok('Rohan (started it): whole family and emergency entries, nothing else', /SBI savings/.test(reg(v)) && /Bank locker/.test(reg(v)) && !/Secret diary|LIC policy|Gold set/.test(reg(v)) && v.steps.length === 11, reg(v));
ok('nothing in his list says a hidden entry exists', !/Secret|LIC|Gold|locked|hidden/i.test(JSON.stringify(v)), JSON.stringify(v).slice(0, 200));
v = seen(MEERA);
ok('Meera (confirmed it, and wrote one "Only me" entry): that one too, marked as only hers', /Gold set/.test(reg(v)) && /Bank locker/.test(reg(v)) && !/Secret diary|LIC policy/.test(reg(v))
   && v.onlyMine === 1 && v.steps.find(x => /Gold set/.test(x.title)).only_you === true, reg(v));
v = seen(PRIYA);
ok('Priya (chosen for the policy, did not start it): the policy, not the emergency entry', /SBI savings/.test(reg(v)) && /LIC policy/.test(reg(v)) && !/Bank locker|Secret diary|Gold set/.test(reg(v)) && v.onlyMine === 0, reg(v));
v = seen(ROHAN, () => false);
ok('with no emergency, the emergency entry makes no step for anyone but its person', !/Bank locker/.test(reg(v)) && v.steps.length === 10);
ok('a nominee is a name, not a person: sharing the nominee\'s name opens nothing', !/Bank locker/.test(afterlossSteps({ rows: [rows[3]].map(r => ({ ...r, nominee: 'Priya' })), viewerId: PRIYA, rowFor: registerRowFor, opens }).steps.map(x => x.title).join()));
ok('a list with no register entries is the nine first things', afterlossSteps({ rows: [], viewerId: ROHAN, rowFor: registerRowFor, opens }).steps.length === 9);
let threw = false; try { afterlossSteps({ rows, viewerId: ROHAN, opens }); } catch (x) { threw = true; }
ok('it cannot be asked for steps without the register rule', threw);
ok('the rules file has no viewing rule of its own', !/ONLY_ME'\s*\)|unlock_policy\s*===\s*'(IMMEDIATE|NOMINEES_ONLY|EMERGENCY_ONLY)'|designated_recipients/.test(src));

// ---- ticks, who is doing it, and progress
const marks = { 'f:bank': { done: true, done_by_name: 'Rohan', done_at: '2026-11-12T10:00:00Z' }, 'f:will': { assigned_to: MEERA, assigned_name: 'Meera', note: 'Ask Sharma uncle' , note_by_name: 'Rohan' },
  'e:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2': { done: true, done_by_name: 'Papa' } };
v = afterlossSteps({ rows, viewerId: ROHAN, rowFor: registerRowFor, opens, marks });
ok('a tick shows who ticked', v.steps.find(x => x.key === 'f:bank').done === true && v.steps.find(x => x.key === 'f:bank').done_by_name === 'Rohan');
ok('a step shows who is doing it and the note', v.steps.find(x => x.key === 'f:will').assigned_name === 'Meera' && v.steps.find(x => x.key === 'f:will').note === 'Ask Sharma uncle');
ok('progress counts only what this person can see', v.progress.done === 1 && v.progress.total === 11 && v.progress.text === '1 of 11 done', JSON.stringify(v.progress));
ok('progress on nothing is 0 of 0', afterlossProgress([]).text === '0 of 0 done' && afterlossProgress(null).total === 0);

// ---- notes never keep a secret
ok('a plain note is kept, trimmed', afterlossNote('  Went on Monday.\n They asked for two copies. ', [registerSecretRisk]).value === 'Went on Monday. They asked for two copies.');
ok('an empty note clears it', afterlossNote('   ', [registerSecretRisk]).value === null);
ok('a password is refused', /never keeps a password or a PIN/.test(afterlossNote('netbanking password: tiger@77', [registerSecretRisk]).error));
ok('a PIN is refused', !!afterlossNote('ATM pin 4821', [registerSecretRisk]).error);
ok('where a password is kept is fine', afterlossNote('The password is in the red diary', [registerSecretRisk]).value === 'The password is in the red diary');
ok('any other check handed in is used too', afterlossNote('hello', [() => 'no']).error === 'no');
ok('a long note is refused in words', /300 letters or fewer/.test(afterlossNote('x'.repeat(AFTERLOSS_MAX.note + 1), []).error));

// ---- the two pushes
const ask = afterlossPush('ask', { starter: 'Rohan', person: 'Dadaji' }), started = afterlossPush('started', { starter: 'Rohan', person: 'Dadaji', confirmer: 'Meera' });
ok('the ask: who asks, and that it starts only with a yes', ask.title === 'Rohan asks you to confirm' && /'What needs doing' for Dadaji/.test(ask.body) && /only if you agree/.test(ask.body));
ok('the start: "Rohan started \'What needs doing\' for Dadaji"', started.title === "Rohan started 'What needs doing' for Dadaji" && /^Meera confirmed\./.test(started.body));

if (fails.length) { console.error('afterlosstest: ' + fails.length + ' FAILED of ' + (pass + fails.length)); for (const f of fails) console.error('  FAIL  ' + f); process.exit(1); }
console.log('afterlosstest: ' + pass + '/' + pass + ' checks pass');
