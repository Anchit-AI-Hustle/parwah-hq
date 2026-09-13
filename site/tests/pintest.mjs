// Indian PIN codes → a real locality, district and state.
// _pin.mjs imports nothing, so this runs on a fresh clone before npm install.
import { pinError, normPin, parsePin, joinAddress, PIN_SOURCE, fetchPin } from '../../api/_pin.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log('FAIL', n)); };

// ---- what a PIN is -------------------------------------------------------
ok(pinError('110048') === null, '110048 is a PIN');
ok(pinError('110 048') === null, 'spaces are forgiven');
ok(normPin(' 110048 ') === '110048', 'and stripped');
ok(/six digits/.test(pinError('11004')), 'five digits is not → ' + pinError('11004'));
ok(/that is 7/.test(pinError('1100488')), 'and the message says how many it counted');
ok(/starts with 0/.test(pinError('010048')), 'no Indian PIN starts with 0');
ok(/six digits/.test(pinError('11004a')), 'letters are not digits');
ok(/Enter the/.test(pinError('')) && /Enter the/.test(pinError(null)), 'nothing typed is asked for, not rejected rudely');
ok(normPin('abc') === null && normPin('') === null, 'junk normalises to nothing');

// ---- India Post's answer, as it really comes back ------------------------
const REAL = [{
  Message: 'Number of pincode(s) found:2', Status: 'Success',
  PostOffice: [
    { Name: 'Greater Kailash', BranchType: 'Sub Post Office', District: 'South Delhi',
      Block: 'New Delhi', State: 'Delhi', Country: 'India', Pincode: '110048' },
    { Name: 'Kailash Colony', BranchType: 'Branch Post Office', District: 'South Delhi',
      Block: 'New Delhi', State: 'Delhi', Country: 'India', Pincode: '110048' }
  ]
}];
const got = parsePin(REAL, '110048');
ok(got && got.areas.length === 2, 'both localities come back');
ok(got.areas[0].name === 'Greater Kailash' && got.areas[0].kind === 'Sub Post Office', 'with their names and kind');
ok(got.district === 'South Delhi' && got.state === 'Delhi', 'district and state are read off the first entry');
ok(got.country === 'India' && got.source === 'india-post', 'and the answer says where it came from');

// A PIN really can list the same office twice across records.
const DUPE = [{ Status:'Success', PostOffice: [
  { Name:'Greater Kailash', District:'South Delhi', State:'Delhi' },
  { Name:'greater kailash', District:'South Delhi', State:'Delhi' },
  { Name:'Kailash Colony',  District:'South Delhi', State:'Delhi' } ] }];
ok(parsePin(DUPE, '110048').areas.length === 2, 'a locality listed twice is offered once');

// ---- every way it can fail, and none of them invents an address ----------
ok(parsePin([{ Status: 'Error', Message: 'No records found', PostOffice: null }], '999999') === null,
   'an unknown PIN yields nothing');
ok(parsePin([{ Status: 'Success', PostOffice: [] }], '110048') === null, 'success with no offices is not an answer');
ok(parsePin([{ Status: 'Success', PostOffice: [{ Name: 'Nowhere' }] }], '110048') === null,
   'an office with no state is not an answer');
ok(parsePin([], '110048') === null && parsePin(null, '110048') === null && parsePin('nope', '110048') === null,
   'an empty or wrong-shaped body yields nothing');
ok(parsePin({ Status: 'Success', PostOffice: [{ Name: 'X', State: 'Delhi' }] }, '110048').areas.length === 1,
   'a bare object, not wrapped in an array, is still read');
ok(parsePin([{ Status:'Success', PostOffice:[null, { Name:'X', State:'Delhi' }, 7] }], '110048').areas.length === 1,
   'rubbish inside the list is skipped, not thrown');

// ---- the one line that ends up on the card -------------------------------
ok(joinAddress({ street:'S-354, Block S', area:'Greater Kailash', city:'South Delhi', state:'Delhi', pin:'110048' })
   === 'S-354, Block S, Greater Kailash, South Delhi - Delhi 110048', 'the full line reads like an address');
ok(joinAddress({ street:'S-354' }) === 'S-354', 'a lone street stays exactly itself');
ok(joinAddress({ street:'S-354', city:'', area:null, state:'Delhi', pin:'' }) === 'S-354 - Delhi',
   'blank parts leave no stray commas');
ok(joinAddress({}) === '', 'nothing in, nothing out');

// ---- the source ----------------------------------------------------------
ok(PIN_SOURCE.startsWith('https://') && /postalpincode/.test(PIN_SOURCE), 'the source is named and https');
const realFetch = globalThis.fetch;
let asked = '';
const stub = (impl) => { globalThis.fetch = async (u) => { asked = String(u); return impl(); }; };
stub(() => ({ ok: true, json: async () => REAL }));
ok((await fetchPin('110048')).state === 'Delhi', 'a good answer comes through');
ok(asked === PIN_SOURCE + '110048', 'the PIN is asked for by number → ' + asked);
stub(() => ({ ok: false, status: 500, json: async () => ({}) }));
ok(await fetchPin('110048') === null, 'a server error yields nothing');
stub(() => { throw new Error('offline'); });
ok(await fetchPin('110048') === null, 'a dead network is caught, not thrown at the family');
stub(() => ({ ok: true, json: async () => { throw new Error('not json'); } }));
ok(await fetchPin('110048') === null, 'a non-JSON body yields nothing');
globalThis.fetch = realFetch;

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
