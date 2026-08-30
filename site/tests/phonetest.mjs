import { normPhone, phoneError } from '../../api/_db.mjs';
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log('FAIL', n)); };
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), n + ' → ' + JSON.stringify(a));

// India
eq(normPhone('9873945238', '+91'), { e164:'+919873945238', cc:'+91', local:'9873945238' }, 'IN bare local');
eq(normPhone('+91 98739 45238'), { e164:'+919873945238', cc:'+91', local:'9873945238' }, 'IN full intl with spaces');
ok(normPhone('98739452', '+91') === null, 'IN 8 digits rejected');
ok(normPhone('59873945238', '+91') === null, 'IN 11 digits rejected');
ok(normPhone('1873945238', '+91') === null, 'IN starting 1 rejected');
// default cc is +91
eq(normPhone('9873945238'), { e164:'+919873945238', cc:'+91', local:'9873945238' }, 'default cc +91');
// US/Canada
eq(normPhone('5551234567', '+1'), { e164:'+15551234567', cc:'+1', local:'5551234567' }, 'US bare local');
ok(normPhone('555123456', '+1') === null, 'US 9 digits rejected');
ok(normPhone('0551234567', '+1') === null, 'US leading 0 rejected');
eq(normPhone('+15551234567').cc, '+1', 'US intl cc split');
// UAE / SG / AU
eq(normPhone('501234567', '+971').e164, '+971501234567', 'UAE 9 ok');
ok(normPhone('5012345', '+971') === null, 'UAE 7 rejected');
eq(normPhone('91234567', '+65').cc, '+65', 'SG ok');
ok(normPhone('11234567', '+65') === null, 'SG bad start rejected');
eq(normPhone('412345678', '+61').e164, '+61412345678', 'AU ok');
// Bangladesh 3-digit cc
eq(normPhone('+8801712345678').cc, '+880', 'BD longest-prefix split');
// unknown country, generic accept
ok(normPhone('+3312345678') !== null, 'unknown cc generic accept');
ok(normPhone('+33') === null, 'cc alone rejected');
// junk
ok(normPhone('abc', '+91') === null, 'letters rejected');
ok(normPhone('', '+91') === null, 'empty rejected');
ok(phoneError('+91').includes('India') && phoneError('+91').includes('10'), 'error names country + length');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
