// ADVANCED CARE & PREPAREDNESS ENGINE UNIT TESTS
// Pure algorithmic verification: imports api/_careprep.mjs pure exports.
// Runs without database or network in scripts/checks.sh.

import {
  calculateDepletion,
  isStockoutWarningDue,
  formatRefillAlert,
  formatChemistWhatsAppOrder,
  parseBiomarkersFromText,
  buildEmergencyAdmissionPacket,
  extractVoiceIntent,
  buildUpiDeepLink,
  formatBillSettledNotification,
  maskAssetIdentifier,
  canViewAssetLocator,
  filterSiblingTasks
} from '../../api/_careprep.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log('FAIL:', n)); };

console.log('--- Care & Preparedness Engine Tests ---');

// 1. Predictive Medicine Refill & Stockout Calculation
const dep1 = calculateDepletion(30, 1.0);
ok(dep1.daysLeft === 30, '30 units at 1/day leaves 30 days');
ok(dep1.depletionDate instanceof Date, 'depletionDate is a Date instance');

const dep2 = calculateDepletion(4, 1.0);
ok(dep2.daysLeft === 4, '4 units left is 4 days');
ok(isStockoutWarningDue(4, 1.0, 5), '4 days remaining triggers stockout alert with threshold 5');
ok(!isStockoutWarningDue(10, 1.0, 5), '10 days remaining does not trigger alert with threshold 5');

const snoozedFuture = new Date(Date.now() + 86400000 * 2).toISOString();
ok(!isStockoutWarningDue(4, 1.0, 5, snoozedFuture), 'snoozed alert suppresses warning');

const alertMsg = formatRefillAlert('Papa', 'Telmisartan 40mg', 4);
ok(alertMsg === 'Papa has 4 days of Telmisartan 40mg remaining.', 'refill alert formatted accurately');

const waLink = formatChemistWhatsAppOrder('9873945238', 'Papa', 'Telmisartan 40mg', 30);
ok(waLink.indexOf('wa.me/9873945238') >= 0, 'chemist link targets WhatsApp number');
ok(decodeURIComponent(waLink).indexOf('refill of Telmisartan 40mg (30 tablets/units) for Papa') >= 0, 'chemist order message formatted');

// 2. Biomarker Extraction from Lab Reports
const sampleReport = `
  DR. LAL PATHLABS CLINICAL LABORATORY REPORT
  Patient: O.P. Sharma, Age: 68
  Test: Comprehensive Metabolic Panel
  HbA1c: 6.8 % (Reference: 4.0 - 5.6 %)
  Fasting Blood Sugar: 118 mg/dL
  Serum Creatinine: 1.1 mg/dL (Reference: 0.7 - 1.3 mg/dL)
  Total Cholesterol: 185 mg/dL
  BP: 130/85 mmHg
  Hemoglobin: 13.5 g/dL
`;

const parsed = parseBiomarkersFromText(sampleReport);
ok(parsed.labName === 'Dr. Lal PathLabs', 'detected lab name correctly');

const hba1c = parsed.biomarkers.find(b => b.biomarker_type === 'HBA1C');
ok(hba1c && hba1c.value === 6.8 && hba1c.unit === '%', 'extracted HbA1c value and unit');
ok(hba1c.reference_range_low === 4.0 && hba1c.reference_range_high === 5.6, 'attached standard reference ranges');

const fbs = parsed.biomarkers.find(b => b.biomarker_type === 'FASTING_GLUCOSE');
ok(fbs && fbs.value === 118, 'extracted Fasting Blood Sugar');

const creat = parsed.biomarkers.find(b => b.biomarker_type === 'CREATININE');
ok(creat && creat.value === 1.1, 'extracted Serum Creatinine');

const sysBp = parsed.biomarkers.find(b => b.biomarker_type === 'SYSTOLIC_BP');
const diaBp = parsed.biomarkers.find(b => b.biomarker_type === 'DIASTOLIC_BP');
ok(sysBp && sysBp.value === 130 && diaBp && diaBp.value === 85, 'extracted Blood Pressure systolic and diastolic');

// 3. Cashless Hospitalization & TPA Emergency Packet
const erPack = buildEmergencyAdmissionPacket(
  { id: 'p1', name: 'Papa' },
  { name: 'Star Health Senior Citizen Red Carpet', notes: 'POL-99281726' },
  { name: 'Medi Assist TPA', tollFree: '1800-425-9449', email: 'cashless@mediassist.in' },
  [{ name: 'Max Super Speciality Hospital', address: 'Saket, New Delhi', distance: '3.2 km', phone: '011-26515050' }],
  { aadhaarMask: 'Ending in ...4921' }
);
ok(erPack.person_name === 'Papa', 'emergency packet has patient name');
ok(erPack.policy_number === 'POL-99281726', 'emergency packet has policy number');
ok(erPack.tpa_name === 'Medi Assist TPA', 'emergency packet has TPA name');
ok(erPack.network_hospitals.length === 1, 'empanelled hospital list populated');
ok(erPack.share_text.indexOf('Medi Assist TPA') >= 0, 'share text contains TPA desk details');

// 4. Voice-First Intent Extraction with Confirmation Loop
const v1 = extractVoiceIntent('Doctor ne subah ki goli badal di, ab Telmisartan 40mg deni hai');
ok(v1 && v1.intent === 'MEDICATION_CHANGE', 'detected medication change intent from Hindi');
ok(v1.draft_confirmation.indexOf('Telmisartan 40mg') >= 0, 'confirmation draft prompts caregiver before changing schedule');

const v2 = extractVoiceIntent('Papa ka BP aaj 130/85 hai');
ok(v2 && v2.intent === 'HEALTH_STATUS', 'detected vital health status intent');
ok(v2.extracted_data.systolic === 130 && v2.extracted_data.diastolic === 85, 'parsed blood pressure from voice transcript');

const v3 = extractVoiceIntent('Kal sham ko cardiologist ke paas jaana hai');
ok(v3 && v3.intent === 'CHORE_OR_APPOINTMENT', 'detected appointment intent from Hindi');

// 5. Care Wallet & Utility Bill Delegation
const upiLink = buildUpiDeepLink('BSES Rajdhani', 1450, '100482910', 'ELECTRICITY', 'bses@icici');
ok(buildUpiDeepLink('BSES Rajdhani', 1450, '100482910', 'ELECTRICITY') === null, 'no UPI link without the biller\'s own UPI ID - never a made-up one');
ok(buildUpiDeepLink('Thames Water', 45, '1', 'WATER', 'tw@bank', 'GBP') === null, 'no UPI link for a bill outside India');
ok(formatBillSettledNotification('Thames Water', 45, 'Priya', 'GBP') === 'Thames Water bill of £45 was paid by Priya ✅', 'a UK bill is said in pounds');
ok(upiLink.indexOf('upi://pay?') === 0, 'generates standard UPI deep link');
ok(upiLink.indexOf('pa=bses%40icici') > 0, 'the link pays the biller\'s own UPI ID');
ok(upiLink.indexOf('am=1450.00') >= 0, 'UPI link includes exact decimal amount');

const billNotif = formatBillSettledNotification('IGL Gas', 840, 'Rahul');
ok(billNotif === 'IGL Gas bill of ₹840 was paid by Rahul ✅', 'parent notification is formatted with confirmation');

// 6. "When I'm Not Here" (Physical Asset Locator)
ok(maskAssetIdentifier('482910244921') === 'Ending in ...4921', 'masks long bank account identifier');
ok(maskAssetIdentifier('42') === '*** 42', 'masks short locker key identifier');

const locImmediate = { unlock_policy: 'IMMEDIATE' };
ok(canViewAssetLocator(locImmediate, 'm1'), 'immediate policy viewable by circle member');

const locEmerg = { unlock_policy: 'EMERGENCY_ONLY' };
ok(!canViewAssetLocator(locEmerg, 'm1', false), 'emergency-only policy locked when no emergency');
ok(canViewAssetLocator(locEmerg, 'm1', true), 'emergency-only policy unlocks during active SOS');

const locNominees = { unlock_policy: 'NOMINEES_ONLY', designated_recipients: ['m1', 'm2'] };
ok(canViewAssetLocator(locNominees, 'm1'), 'nominee member can view restricted locator');
ok(!canViewAssetLocator(locNominees, 'm3'), 'non-nominee member cannot view restricted locator');

// 7. Sibling Co-Care Tasks Filter
const tasks = [
  { id: 't1', category: 'MEDICINE_REFILL', assigned_to_id: 's1', status: 'OPEN' },
  { id: 't2', category: 'BILL_PAY', assigned_to_id: 's2', status: 'OPEN', due_date: new Date(Date.now() + 3600000).toISOString() },
  { id: 't3', category: 'HOME_REPAIR', assigned_to_id: 's1', status: 'COMPLETED' }
];

ok(filterSiblingTasks(tasks, 'ALL').length === 3, 'ALL filter returns all tasks');
ok(filterSiblingTasks(tasks, 'MINE', 's1').length === 2, 'MINE filter returns only tasks assigned to member s1');
const urgent = filterSiblingTasks(tasks, 'URGENT');
ok(urgent.length === 2 && urgent.some(u => u.category === 'MEDICINE_REFILL'), 'URGENT filter includes medicine refills and near-due tasks');

console.log(`Care & Preparedness tests: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
