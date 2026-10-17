// A FAMILY OUTSIDE INDIA - the phone numbers, emergency numbers, help lines,
// times and money that change with the country. Every module here imports
// only plain data, so this runs on a fresh clone before npm install.
import { normPhone } from '../../api/_phone.mjs';
import { e164, callScript } from '../../api/_sosdial.mjs';
import { sosText } from '../../api/_sos.mjs';
import { ambulanceFor, countryName, isCountry, COUNTRIES } from '../../api/_countries.mjs';
import { urgentToo, renderEmergency, renderCrisis, renderScam, cannotAnswer } from '../../api/_ektalocal.mjs';
import { currencyOf, money } from '../../api/_money.mjs';
import { dayIn, reqTz } from '../../api/_recur.mjs';

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL ' + name); } }

// ---- phone numbers typed the way each country writes them ---------------
ok((normPhone('01511234567', '+49') || {}).e164 === '+491511234567', 'a German number with its trunk 0 is stored without it');
ok((normPhone('07700 900123', '+44') || {}).e164 === '+447700900123', 'a UK mobile written 07700 is +44 7700');
ok((normPhone('+390612345678') || {}).e164 === '+390612345678', 'Italy keeps its leading 0 - it is part of the number');
ok((normPhone('(415) 555-0134', '+1') || {}).e164 === '+14155550134', 'a US number in brackets and dashes');
ok((normPhone('0412 345 678', '+61') || {}).e164 === '+61412345678', 'an Australian mobile');

// ---- SOS dialling --------------------------------------------------------
ok(e164('07700900123', '+44') === '+447700900123', 'an SOS to a UK contact dials +44, not +91');
ok(e164('+14155550134') === '+14155550134', 'a full international number is dialled as it is');
ok(e164('9810012345') === '+919810012345', 'a bare Indian mobile still dials +91');
ok(/Aditi/.test(callScript('Papa', '+91')) && /Joanna/.test(callScript('Papa', '+44')),
   'the SOS call speaks Indian English in India and another English voice abroad');

// ---- the SOS message says the time where the sender is -------------------
const at = Date.UTC(2026, 9, 17, 18, 30);
ok(/IST/.test(sosText('Papa', null, at, 'Asia/Kolkata')), 'an SOS from India says IST');
ok(/(BST|GMT\+1)/.test(sosText('Papa', null, at, 'Europe/London')) && !/IST/.test(sosText('Papa', null, at, 'Europe/London')),
   'an SOS from London says London time, not IST');
ok(/UTC/.test(sosText('Papa', null, at, 'Not/AZone')), 'an unknown zone falls back to UTC, said as UTC');

// ---- emergency numbers ---------------------------------------------------
ok(ambulanceFor('US') === '911' && ambulanceFor('GB') === '999' && ambulanceFor('AU') === '000' && ambulanceFor('IN') === '112',
   'the ambulance number is the country\'s own');
ok(ambulanceFor('ZZ') === '112', 'a country we do not know gets 112, which works from almost any mobile');
ok(COUNTRIES.length > 190 && COUNTRIES.every(c => /^[A-Z]{2}$/.test(c[0]) && /^\+\d{1,4}$/.test(c[2]) && /^\d{2,6}$/.test(c[3])),
   'every country has a code, a dialling code and an emergency number');
ok(new Set(COUNTRIES.map(c => c[0])).size === COUNTRIES.length, 'no country is listed twice');
ok(isCountry('GB') && !isCountry('XX') && countryName('NZ') === 'New Zealand', 'country lookups');

// ---- Ekta, when it cannot reach a model ----------------------------------
ok(/911/.test(urgentToo('US')) && !/108/.test(urgentToo('US')), 'Ekta tells a family in the US to call 911, not 108');
ok(/108/.test(urgentToo('IN')), 'and a family in India 112, with 108 for an ambulance');
ok(/999/.test(renderEmergency('GB')), 'an emergency in the UK is 999');
ok(/988/.test(renderCrisis('US')) && /116 123/.test(renderCrisis('GB')) && /14416/.test(renderCrisis('IN')),
   'a crisis line in the person\'s own country');
ok(/findahelpline/.test(renderCrisis('BR')), 'and a way to find one where there is no line we know');
ok(/1930/.test(renderScam('they want my OTP', 'local', 'IN')) && !/1930/.test(renderScam('they want my OTP', 'local', 'US')),
   'a scam is reported to 1930 in India and not abroad');
ok(/Action Fraud|159/.test(renderScam('a link asking for my bank PIN', 'local', 'GB')), 'a UK scam goes to the bank (159) or Action Fraud');
ok(/call 000/.test(cannotAnswer('local', 'AU')) && /call 112/.test(cannotAnswer('local', 'IN')), 'an unanswered question still says the right number to call, in Australia and in India');

// ---- money ---------------------------------------------------------------
ok(currencyOf('IN') === 'INR' && currencyOf('') === 'INR', 'India, or nothing recorded, is rupees');
ok(currencyOf('GB') === 'GBP' && currencyOf('DE') === 'EUR' && currencyOf('US') === 'USD', 'pounds, euros and dollars');
ok(currencyOf('XX') === null && money(5000, null) === '5,000', 'a currency we do not know is a plain number, never rupees');
ok(money(250000, 'INR') === '₹2,50,000' && money(5000, 'GBP') === '£5,000', 'rupees in lakhs, pounds in thousands');

// ---- today, where the family is ------------------------------------------
const late = Date.UTC(2026, 9, 17, 23, 30);       // 23:30 UTC on the 17th
ok(dayIn('Asia/Kolkata', late) === '2026-10-18' && dayIn('America/New_York', late) === '2026-10-17' && dayIn(null, late) === '2026-10-17',
   'the same instant is the 18th in Delhi and the 17th in New York');
ok(reqTz({ headers: { 'x-parwah-tz': 'Europe/London' } }) === 'Europe/London' && reqTz({ headers: { 'x-parwah-tz': 'Mars/Base' } }) === null,
   'the phone\'s zone is taken from its header, and only when it is a real zone');

console.log('globaltest: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
