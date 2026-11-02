// THE RULES BEHIND FIVE FAMILY-CARE TOOLS: when a missed check-in nudges and
// when it tells the family, the life certificate window, the acknowledgement
// number that is never an Aadhaar number, whose turn is next on a call rota,
// and the plain rules a parent reads before paying. api/_carerules.mjs
// imports nothing, so this runs in the deploy gate before npm install.
import { validHHMM, validDay, addDays, quietPhase, quietFamilyText, pronoun, QUIET_GRACE_MIN,
         lifecertWindow, ackNoCheck, rotaNext, safeWordCheck, ASK_FIRST_RULES, CYBER_HELPLINE, CYBER_SITE, JEEVAN_SITE,
         QUIET_LADDER_MIN, quietCallHour, quietLadderText } from '../../api/_carerules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' -> ' + detail : '')); };

// Times and days
ok('a check-in time is read as HH:MM', validHHMM('11:00') === '11:00' && validHHMM('9:5') === '09:05' && validHHMM(' 23:59 ') === '23:59');
ok('nonsense is not a time', validHHMM('24:00') === null && validHHMM('11') === null && validHHMM('eleven') === null && validHHMM(null) === null);
ok('a real day only', validDay('2026-11-05') === '2026-11-05' && validDay('2026-02-30') === null && validDay('5 Nov') === null);
ok('days add across a month', addDays('2026-11-30', 1) === '2026-12-01');

// Quiet day: the phases
const D = Date.UTC(2026, 10, 2, 5, 30);   // 11:00 in India
const base = { checkinBy: '11:00', awayUntil: null, today: '2026-11-02', checkedIn: false, deadlineMs: D };
ok('off without a time', quietPhase({ ...base, checkinBy: null, nowMs: D + 1e7 }) === 'off');
ok('before the time, nothing', quietPhase({ ...base, nowMs: D - 60000 }) === 'before');
ok('at the time, a nudge to the parent only', quietPhase({ ...base, nowMs: D }) === 'nudge');
ok('29 minutes after, still only the nudge', quietPhase({ ...base, nowMs: D + 29 * 60000 }) === 'nudge');
ok('30 minutes after, the family is told', QUIET_GRACE_MIN === 30 && quietPhase({ ...base, nowMs: D + 30 * 60000 }) === 'alert');
ok('a check-in today ends it', quietPhase({ ...base, checkedIn: true, nowMs: D + 1e7 }) === 'ok');
ok('away until today pauses it', quietPhase({ ...base, awayUntil: '2026-11-02', nowMs: D + 1e7 }) === 'away');
ok('away until yesterday does not', quietPhase({ ...base, awayUntil: '2026-11-01', nowMs: D + 1e7 }) === 'alert');
ok('the family hears a question, not an alarm', quietFamilyText('Papa', 'm') === 'Papa has not checked in today. Give him a call?'
   && quietFamilyText('Maa', 'f').endsWith('Give her a call?') && pronoun(null) === 'them');

// Life certificate: 1 October at 80 and over, otherwise November
{
  const w = lifecertWindow('1945-05-01', '2026-11-02');
  ok('80 and over: from 1 October to 30 November', w.superSenior && w.opens === '2026-10-01' && w.closes === '2026-11-30' && w.age === 81, JSON.stringify(w));
  const y = lifecertWindow('1960-05-01', '2026-11-02');
  ok('under 80: 1 to 30 November', !y.superSenior && y.opens === '2026-11-01' && y.closes === '2026-11-30' && y.age === 66, JSON.stringify(y));
  const b1 = lifecertWindow('1946-10-01', '2026-09-01');
  ok('80 on 1 October itself counts', b1.superSenior && b1.age === 80, JSON.stringify(b1));
  const b2 = lifecertWindow('1946-10-02', '2026-09-01');
  ok('80 a day later does not', !b2.superSenior && b2.age === 79, JSON.stringify(b2));
  const late = lifecertWindow('1960-05-01', '2026-12-05');
  ok('after 30 November, it is next year\'s', late.year === 2027 && late.closes === '2027-11-30');
  const none = lifecertWindow(null, '2026-11-02');
  ok('no date of birth: the November window, and it says so', !none.dobKnown && none.opens === '2026-11-01');
}

// The acknowledgement, never an Aadhaar number
ok('an acknowledgement number is kept', ackNoCheck(' JP-2026/ AB12345 ').value === 'JP-2026/ AB12345');
ok('12 digits in a row look like Aadhaar and are refused', /Aadhaar/.test(ackNoCheck('1234 5678 9012').error || '') && /Aadhaar/.test(ackNoCheck('123456789012').error || ''));
ok('an empty one asks for it', !!ackNoCheck('').error);
ok('no script in it', !!ackNoCheck('<b>x</b>').error);

// Call rota
ok('the rota goes round', rotaNext(['a', 'b', 'c'], 0) === 1 && rotaNext(['a', 'b', 'c'], 2) === 0 && rotaNext(['a'], 0) === 0 && rotaNext([], 3) === 0);

// Safe word
ok('a safe word is short and plain', safeWordCheck('Gulab jamun').value === 'Gulab jamun' && safeWordCheck('').value === null
   && !!safeWordCheck('x'.repeat(41)).error && !!safeWordCheck('<script>').error && safeWordCheck('गुलाब').value === 'गुलाब');

// Quiet day, then the nearest helper: 30 more minutes, waking hours only, calm words
ok('the helper is reached 30 minutes after the family alert', QUIET_LADDER_MIN === 30);
ok('a neighbour is rung only from 7 am to before 10 pm on the person\'s clock',
   quietCallHour('Asia/Kolkata', Date.UTC(2026, 10, 2, 1, 30)) === true      // 7:00 IST
   && quietCallHour('Asia/Kolkata', Date.UTC(2026, 10, 2, 1, 29)) === false  // 6:59
   && quietCallHour('Asia/Kolkata', Date.UTC(2026, 10, 2, 16, 29)) === true  // 21:59
   && quietCallHour('Asia/Kolkata', Date.UTC(2026, 10, 2, 16, 30)) === false // 22:00
   && quietCallHour('Not/AZone', D) === false);
const lt = quietLadderText('Papa', { name: 'Mr Bose', distance_note: 'next door', phone: '+919811100002' }, false);
ok('without a call, the family gets the helper\'s number', lt === 'Nobody has reached Papa since the check-in alert. Mr Bose (next door) said they can help: call +919811100002.', lt);
ok('with a call, it says Parwah is calling, and never "emergency"', /Parwah is calling Mr Bose/.test(quietLadderText('Papa', { name: 'Mr Bose', phone: 'x' }, true))
   && !/emergency|SOS/i.test(lt + quietLadderText('Papa', { name: 'Mr Bose' }, true)));

// Ask family first: the rules, the helpline, no promise to spot a scam
ok('the four plain rules', ASK_FIRST_RULES.length === 4 && /OTP/.test(ASK_FIRST_RULES[0]) && /UPI PIN/.test(ASK_FIRST_RULES[0])
   && /video call/.test(ASK_FIRST_RULES[1]) && /KYC/.test(ASK_FIRST_RULES[2]) && /call us/.test(ASK_FIRST_RULES[3]));
ok('1930 and the official sites', CYBER_HELPLINE === '1930' && CYBER_SITE === 'https://cybercrime.gov.in' && JEEVAN_SITE === 'https://jeevanpramaan.gov.in');
ok('never claims to detect a scam', !ASK_FIRST_RULES.join(' ').match(/detect|we will catch|guarantee/i));

if (fails.length) { console.error('caretoolstest: ' + fails.length + ' FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('caretoolstest: ' + pass + '/' + pass + ' checks pass');
