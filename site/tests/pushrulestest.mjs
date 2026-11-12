// FAIR NOTIFICATIONS AND A POOR NETWORK - the rules, with the clock fixed.
// api/_pushrules.mjs imports nothing, so this runs before npm install.
//   node site/tests/pushrulestest.mjs
import { pushKind, decide, inQuiet, localMinutes, cleanPrefs, defaultPrefs, capOrder, morningText, withFamily, rotateFrom,
         clientTime, cleanClientId, cleanReport, limitKeyOf, cleanDevice, PUSH_KINDS, PUSH_KIND_WORDS, OFFLINE_KINDS, minsToHHMM } from '../../api/_pushrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || detail === undefined ? '' : ' -> ' + detail)); if (cond) pass++; else fails.push(name); };

// ---- what kind a push is, from what it says
const kind = t => pushKind({ title: t }).kind;
ok('an SOS is urgent and always gets through', pushKind({ title: '🆘 SOS from Papa', urgent: true }).through && pushKind({ title: 'x', urgent: true }).kind === 'urgent');
ok('ringing a lost phone always gets through', pushKind({ title: '🔔 Rohan is looking for this phone', ring: true }).through);
ok('a missed check-in, a hospital stay, the SOS replies and a lost phone get through without the caller saying so',
   ['🧡 Papa has not checked in today', '🧡 Papa could do with a call', '🏥 Papa is in hospital', '📵 Rohan has lost their phone',
    '🧡 Rohan is on it', '✅ Papa is safe', '✅ Rohan marked you safe', '✅ Papa is alright', "🎙 A recording from Papa's SOS",
    '📞 Call Mrs Gupta for Papa', '🛡 Papa is asking the family first', 'Rohan marked you as no longer with us']
     .every(t => pushKind({ title: t }).through), 'one did not');
ok('chat, plans, games, album, care and the digest are told apart',
   kind('💬 Rohan in Family') === 'chat' && kind('📊 Rohan asked in Family') === 'chat' && kind('➕ Rohan added you to Cousins') === 'chat'
   && kind('🗳 Rohan asks: which date?') === 'plans' && kind('🙌 Meera is coming') === 'plans' && kind('❌ Plan cancelled') === 'plans'
   && kind('🎲 Your turn') === 'games' && kind('👋 Rohan is waiting for you') === 'games'
   && kind('📖 Papa told a story') === 'album'
   && kind('🤝 Rohan needs a hand') === 'care' && kind("💊 Papa's morning medicines are not marked") === 'care' && kind('🙌 Rohan is on it') === 'care'
   && kind('🌙 Aaj kya hua') === 'digest');
ok('a caller may name the kind, and a name wins over the words', pushKind({ title: '💬 x', kind: 'album' }).kind === 'album' && pushKind({ title: 'x', kind: 'safety' }).through);
ok('anything else is "other": no switch turns it off', kind('🔐 Rohan asks to open Aadhaar') === 'other' && kind('🔑 Invite code is now ABC') === 'other');
ok('a time the person chose (own medicines, a task reminder, the check-in nudge, the evening line) is timed, not urgent',
   ['💊 Your morning medicines', '⏰ Call the bank', '🧡 Sab theek?', '🌙 Aaj kya hua'].every(t => pushKind({ title: t }).timed && !pushKind({ title: t }).through));
ok('every switch has plain words', PUSH_KINDS.length === 6 && PUSH_KINDS.every(k => PUSH_KIND_WORDS[k].label && PUSH_KIND_WORDS[k].hint));

// ---- quiet hours
ok('10pm to 7am wraps midnight: 22:00 and 03:00 are quiet, 07:00 and 21:59 are not',
   inQuiet(22 * 60, 1320, 420) && inQuiet(180, 1320, 420) && !inQuiet(420, 1320, 420) && !inQuiet(1319, 1320, 420));
ok('a daytime nap (13:00 to 15:00) does not wrap', inQuiet(14 * 60, 780, 900) && !inQuiet(15 * 60, 780, 900) && !inQuiet(12 * 60, 780, 900));
ok('the same time twice means no quiet hours', !inQuiet(0, 600, 600));
ok('the default is 10pm to 7am with every kind on', defaultPrefs().quiet && minsToHHMM(defaultPrefs().from) === '22:00' && minsToHHMM(defaultPrefs().to) === '07:00'
   && PUSH_KINDS.every(k => defaultPrefs().kinds[k] === true));
ok('saved choices are made whole: odd times fall back, missing kinds are on',
   (() => { const p = cleanPrefs({ from: '25:00', to: '06:30', kinds: { games: false, nonsense: false } });
            return p.from === 1320 && p.to === 390 && p.kinds.games === false && p.kinds.chat === true && !('nonsense' in p.kinds); })());

// ---- ONE MOMENT, THREE CLOCKS. 12 Nov 2026, 18:30 UTC is midnight in
// India, 6:30pm in the UK and 10:30am on the US west coast.
const T1 = Date.UTC(2026, 10, 12, 18, 30);
const IN = 'Asia/Kolkata', UK = 'Europe/London', US = 'America/Los_Angeles';
ok('the clock is read in each zone', localMinutes(T1, IN) === 0 && localMinutes(T1, UK) === 18 * 60 + 30 && localMinutes(T1, US) === 10 * 60 + 30,
   [localMinutes(T1, IN), localMinutes(T1, UK), localMinutes(T1, US)].join());
const chat = pushKind({ title: '💬 Rohan in Family' }), sos = pushKind({ title: '🆘 SOS from Papa', urgent: true });
ok('at that moment a chat message waits in India and is sent in the UK and the US',
   decide(chat, null, T1, IN) === 'hold' && decide(chat, null, T1, UK) === 'send' && decide(chat, null, T1, US) === 'send');
ok('an SOS is sent in all three', [IN, UK, US].every(z => decide(sos, null, T1, z) === 'send'));
// 06:30 UTC: noon in India, 6:30am in the UK, 10:30pm (the day before) in the US.
const T2 = Date.UTC(2026, 10, 13, 6, 30);
ok('six and a half hours later it is the other way round',
   decide(chat, null, T2, IN) === 'send' && decide(chat, null, T2, UK) === 'hold' && decide(chat, null, T2, US) === 'hold');
// Summer in the UK and the US: the clocks have moved, the rule has not.
const T3 = Date.UTC(2026, 6, 1, 21, 30);   // 03:00 IST, 22:30 BST, 14:30 PDT
ok('with summer time the UK is quiet at 22:30 BST and the US west coast is in its afternoon',
   decide(chat, null, T3, IN) === 'hold' && decide(chat, null, T3, UK) === 'hold' && decide(chat, null, T3, US) === 'send');
ok('a kind turned off is dropped by day and by night, but never an SOS or a missed check-in',
   decide(chat, { kinds: { chat: false } }, T2, IN) === 'drop' && decide(chat, { kinds: { chat: false } }, T1, IN) === 'drop'
   && decide(sos, { kinds: { chat: false, care: false } }, T1, IN) === 'send'
   && decide(pushKind({ title: '🧡 Papa has not checked in today' }), { kinds: { care: false } }, T1, IN) === 'send');
ok('quiet hours turned off sends at night', decide(chat, { quiet: false }, T1, IN) === 'send');
ok('their own quiet hours are used: 21:00 to 06:00', decide(chat, { from: '21:00', to: '06:00' }, Date.UTC(2026, 10, 12, 15, 45), IN) === 'hold'   // 21:15 IST
   && decide(chat, { from: '21:00', to: '06:00' }, Date.UTC(2026, 10, 13, 0, 45), IN) === 'send');                                               // 06:15 IST
ok('own medicines at 6am are not held by quiet hours, but the care switch can stop them',
   decide(pushKind({ title: '💊 Your morning medicines' }), null, Date.UTC(2026, 10, 13, 0, 30), IN) === 'send'
   && decide(pushKind({ title: '💊 Your morning medicines' }), { kinds: { care: false } }, Date.UTC(2026, 10, 13, 0, 30), IN) === 'drop');
ok('a muted chat is dropped; a mute never stops an SOS', decide(chat, null, T2, IN, { muted: true }) === 'drop' && decide(sos, null, T2, IN, { muted: true }) === 'send');
ok('"other" (the vault, a join) waits for the morning like the rest', decide(pushKind({ title: '🔐 x' }), null, T1, IN) === 'hold');

// ---- who is sent to when the list is long
{
  const subs = [];
  for (let i = 0; i < 70; i++) subs.push({ id: 'a' + i, owner: 'asha', created_at: new Date(2026, 0, 1, 0, i).toISOString() });
  for (const o of ['papa', 'rohan', 'meera']) subs.push({ id: o + '0', owner: o, created_at: new Date(2025, 0, 1).toISOString() });
  const got = capOrder(subs, 60);
  ok('a cap of 60 never leaves a member with no device, however many one person has',
     got.length === 60 && ['papa', 'rohan', 'meera', 'asha'].every(o => got.some(s => s.owner === o)));
  ok("and a person's newest device comes first", got.find(s => s.owner === 'asha').id === 'a69');
  ok('under the cap, everyone gets everything', capOrder(subs.slice(0, 10), 60).length === 10);
}

// ---- the morning line
ok('"While you slept: 6 messages in Family"', (() => { const t = morningText([{ kind: 'chat', family: 'Family', n: 6 }]);
   return t.title === '🌅 While you slept' && t.body === '6 messages in Family. Open Parwah to see.'; })());
ok('one of a thing is singular, two families are both named, and nothing held is no push',
   morningText([{ kind: 'chat', family: 'Sharma Family', n: 1 }, { kind: 'care', family: 'Kapoor Family', n: 2 }]).body
     === '1 message in Sharma Family, 2 care alerts in Kapoor Family. Open Parwah to see.'
   && morningText([]) === null && morningText([{ kind: 'chat', family: 'x', n: 0 }]) === null);
ok('the morning line holds counts and family names only, with no dash', !/[–—]/.test(morningText([{ kind: 'games', family: 'A', n: 3 }, { kind: 'zzz', family: 'B', n: 2 }]).body));

// ---- which family
ok('someone in two families is told which one; someone in one is not',
   withFamily('Tap to see where they are', 'Sharma Family', 2) === 'Tap to see where they are · Sharma Family'
   && withFamily('Tap', 'Sharma Family', 1) === 'Tap' && withFamily('', 'Sharma Family', 2) === 'Sharma Family');

// ---- the timer's turn
ok('the list starts where the last run stopped, and wraps', rotateFrom(['c', 'a', 'b', 'd'], 'c').join() === 'c,d,a,b'
   && rotateFrom(['c', 'a', 'b'], null).join() === 'a,b,c' && rotateFrom(['a', 'b'], 'zz').join() === 'a,b' && rotateFrom(['a', 'c'], 'b').join() === 'c,a');

// ---- a tap made with no network
const NOW = Date.UTC(2026, 10, 12, 12, 0);
ok('only a check-in, a medicine tick and a pulse answer may arrive late', OFFLINE_KINDS.join() === 'checkin,pill,pulse'
   && !!clientTime('message', NOW - 5000, NOW).error && !!clientTime('sos', NOW - 5000, NOW).error);
ok('no time sent means now', clientTime('checkin', undefined, NOW).at === null && clientTime('sos', undefined, NOW).at === null);
ok('three hours ago is taken, with its time, and counted as late',
   (() => { const t = clientTime('checkin', new Date(NOW - 3 * 3600000).toISOString(), NOW); return t.at && t.at.getTime() === NOW - 3 * 3600000 && t.late === true; })());
ok('a few seconds on a slow network is not late', clientTime('pill', NOW - 20000, NOW).late === false && clientTime('pill', NOW - 20000, NOW).at instanceof Date);
ok('more than a day old is refused, in words a person can act on', /more than a day ago/.test(clientTime('checkin', NOW - 25 * 3600000, NOW).error || ''));
ok('just under a day is still taken', clientTime('checkin', NOW - 23.9 * 3600000, NOW).at instanceof Date);
ok('a phone clock a minute ahead is treated as now; an hour ahead is refused',
   clientTime('checkin', NOW + 60000, NOW).at === null && !clientTime('checkin', NOW + 60000, NOW).error && !!clientTime('checkin', NOW + 3600000, NOW).error);
ok('a time that is not a time is refused', !!clientTime('checkin', 'yesterday-ish', NOW).error);
ok('the phone\'s id for a tap is 8 to 64 plain characters', cleanClientId('q_1731412345678_ab12') && !cleanClientId('short') && !cleanClientId("x'; drop table") && !cleanClientId('a'.repeat(65)));

// ---- the tiny error report
{
  const r = cleanReport({ message: "TypeError: Cannot read properties of undefined (reading 'name') for rohan@example.com +91 98765 43210 id 3f2b1c9a-1111-4222-8333-abcdefabcdef",
    where: 'https://parwah-hq.anchit-tandon.com/?join=ABC123#chat:12:345', version: 'W/"abc"', viewport: '390x844', name: 'Rohan', phone: '+919876543210', text: 'secret' });
  ok('a report keeps what and where', /^TypeError: Cannot read properties of undefined/.test(r.message) && r.viewport === '390x844');
  ok('and no email, phone number or id from the message', !/example\.com|98765|3f2b1c9a/.test(JSON.stringify(r)), JSON.stringify(r));
  ok('and nothing else that was sent with it', Object.keys(r).sort().join() === 'message,version,viewport,where' && !/Rohan|secret/.test(JSON.stringify(r)));
  ok('the address is cut to the file and line: no join code, no screen', !/join|ABC123|chat|anchit/.test(r.where), r.where);
  ok('a version that is not a plain word is left out', r.version === '' && cleanReport({ message: 'x', version: 'abc123' }).version === 'abc123');
  ok('quoted text (it could be a message someone typed) is taken out', !/hello papa how are you/.test(cleanReport({ message: 'Bad value "hello papa how are you" here' }).message));
  ok('a file and line are kept', cleanReport({ message: 'x', where: '/index.html:1234:56' }).where === 'index.html:1234:56');
  ok('no message, no report; a long one is cut', cleanReport({}) === null && cleanReport({ message: 'e'.repeat(900) }).message.length === 160);
}

// ---- the key a limit counts by
ok('two phones behind one address are two keys; no device id is the address alone',
   limitKeyOf('1.2.3.4', 'a'.repeat(20)) !== limitKeyOf('1.2.3.4', 'b'.repeat(20)) && limitKeyOf('1.2.3.4', null) === '1.2.3.4' && limitKeyOf('1.2.3.4', 'short') === '1.2.3.4');
ok('a device id is 16 to 64 plain characters', cleanDevice('d_' + 'x'.repeat(20)) && !cleanDevice('has space in it 1234567') && !cleanDevice('x'.repeat(65)));

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
