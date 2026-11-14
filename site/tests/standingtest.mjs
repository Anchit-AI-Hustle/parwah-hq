// EQUAL STANDING, the rules only. api/_standingrules.mjs imports nothing, so
// this runs in the deploy gate before npm install.
//
// 1. The ONE adult rule, and its strict form for letting someone back in.
// 2. The PIN lock that grows, and forgets after seven clean days.
// 3. Family codes: what a new one must be, and which older ones are weak.
// 4. Who is sent what on a member card (phone, birth year, hidden items).
// 5. Removing someone, opening the door, deleting the family: who decides.
// 6. Device names, and "what your family wrote about you".
import * as S from '../../api/_standingrules.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };
const TODAY = '2026-11-12';
const M = (id, o = {}) => ({ id, name: id, user_id: 'u-' + id, role: 'family', relation: null, dob: null, adult_confirmed: null, spouse_id: null, has_child: false, remembered: false, ...o });

// ---------------------------------------------------------------- 1. adults
ok('18 today is an adult', S.standingOf(M('a', { dob: '2008-11-12' }), TODAY) === 'adult');
ok('18 tomorrow is not yet', S.standingOf(M('a', { dob: '2008-11-13' }), TODAY) === 'minor');
ok('a date of birth beats a role: a 12-year-old marked parent is a child', S.standingOf(M('a', { dob: '2014-01-01', role: 'parent' }), TODAY) === 'minor');
ok('a date of birth beats what an adult said', S.standingOf(M('a', { dob: '1980-01-01', adult_confirmed: false }), TODAY) === 'adult');
ok('no date of birth, an elder the family looks after: adult', S.standingOf(M('a', { role: 'parent' }), TODAY) === 'adult');
for (const r of ['father', 'mother', 'grandfather', 'grandmother', 'daughter-in-law', 'son-in-law'])
  ok('no date of birth, relation ' + r + ': adult', S.standingOf(M('a', { relation: r }), TODAY) === 'adult');
ok('married in the tree: adult', S.standingOf(M('a', { spouse_id: 'b' }), TODAY) === 'adult');
ok('a parent in the tree: adult', S.standingOf(M('a', { has_child: true }), TODAY) === 'adult');
// A relation is not an age: a grandson can be thirty. With no date of birth
// and nothing the family said, he is not known either way.
ok('grandson with no date of birth: not known, the relation is not an age', S.standingOf(M('a', { relation: 'grandson' }), TODAY) === 'unsure');
ok('granddaughter the same', S.standingOf(M('a', { relation: 'granddaughter' }), TODAY) === 'unsure');
// THE MATRIX: date of birth (child / adult / none) x is_child x adult_confirmed.
{
  const want = (dob, child, conf) => dob === 'minor' ? 'minor' : dob === 'adult' ? 'adult'
    : (child || conf === false) ? 'minor' : conf === true ? 'adult' : 'unsure';
  for (const dob of ['minor', 'adult', 'none']) for (const child of [true, false]) for (const conf of [true, false, null]) {
    const m = M('a', { dob: dob === 'minor' ? '2012-05-01' : dob === 'adult' ? '1980-05-01' : null, is_child: child, adult_confirmed: conf });
    const w = want(dob, child, conf), got = S.standingOf(m, TODAY);
    const label = 'matrix: dob ' + dob + ', is_child ' + child + ', adult_confirmed ' + conf;
    ok(label + ' is ' + w, got === w, got);
    ok(label + ': isMinor agrees', S.isMinor(m, TODAY) === (w === 'minor'));
    ok(label + ': may act only when not a child', S.isAdultMember(m, TODAY) === (w !== 'minor'));
    ok(label + ': the strict gate only for a known adult', S.isAdultMember(m, TODAY, { strict: true }) === (w === 'adult'));
    ok(label + ': a child by birth only by the date', S.minorByBirth(m, TODAY) === (dob === 'minor'));
  }
}
ok('marked as a child beats a grown-up role when there is no date of birth', S.standingOf(M('a', { role: 'parent', is_child: true }), TODAY) === 'minor');
ok('"not an adult" beats a grown-up relation when there is no date of birth', S.standingOf(M('a', { relation: 'mother', adult_confirmed: false }), TODAY) === 'minor');
ok('nobody is not a child for the warm rule, and never an adult', !S.isMinor(null, TODAY) && !S.isAdultMember(null, TODAY));
ok('a son with no date of birth is not known either way', S.standingOf(M('a', { relation: 'son' }), TODAY) === 'unsure');
ok('nothing at all on file: not known', S.standingOf(M('a'), TODAY) === 'unsure');
ok('an adult said yes: adult', S.standingOf(M('a', { adult_confirmed: true }), TODAY) === 'adult');
ok('an adult said no: child, even for a grandson-free relation', S.standingOf(M('a', { relation: 'son', adult_confirmed: false }), TODAY) === 'minor');
ok('the gates: an adult may act', S.isAdultMember(M('a', { dob: '1980-01-01' }), TODAY));
ok('the gates: a child may not', !S.isAdultMember(M('a', { dob: '2012-01-01' }), TODAY));
ok('the gates: not known may act, and an adult is asked to confirm', S.isAdultMember(M('a'), TODAY));
ok('strict (letting someone back in): not known is a no', !S.isAdultMember(M('a'), TODAY, { strict: true }));
ok('strict: a known adult is a yes', S.isAdultMember(M('a', { relation: 'mother' }), TODAY, { strict: true }));
ok('someone added by name never acts', !S.isAdultMember(M('a', { user_id: null, dob: '1950-01-01' }), TODAY));
ok('someone who has passed away never acts', !S.isAdultMember(M('a', { dob: '1950-01-01', remembered: true }), TODAY));
ok('nobody is nobody', !S.isAdultMember(null, TODAY));
ok('a Date object for a birthday works like a string', S.ageOn(new Date(2000, 0, 15), '2026-01-14') === 25 && S.ageOn(new Date(2000, 0, 15), '2026-01-15') === 26);
ok('no date of birth has no age', S.ageOn(null, TODAY) === null && S.ageOn('soon', TODAY) === null);
ok('today is read in India, a day ahead of UTC late in the evening', S.todayIn(Date.UTC(2026, 10, 12, 19, 0)) === '2026-11-13' && S.todayIn(Date.UTC(2026, 10, 12, 10, 0)) === '2026-11-12');

// ----------------------------------------------------------------- 2. lock
const DAY = 86400000, NOW = Date.UTC(2026, 10, 12, 12);
ok('the first lock is 15 minutes', S.lockPlan(0, 0, NOW).minutes === 15 && S.lockPlan(0, 0, NOW).level === 1);
ok('the second is 1 hour', S.lockPlan(1, NOW - 3600000, NOW).minutes === 60);
ok('the third is 24 hours', S.lockPlan(2, NOW - 3600000, NOW).minutes === 1440);
ok('and 24 hours each time after', S.lockPlan(3, NOW - DAY, NOW).minutes === 1440 && S.lockPlan(9, NOW - DAY, NOW).minutes === 1440);
ok('6 days after the last lock ended it has not forgotten', S.lockPlan(3, NOW - 6 * DAY, NOW).minutes === 1440);
ok('7 clean days and it starts again at 15 minutes', S.lockPlan(3, NOW - 7 * DAY, NOW).minutes === 15 && S.lockPlan(3, NOW - 7 * DAY, NOW).level === 1);
{
  // Walking all 10,000 PINs: 5 tries, then the lock. How long?
  let level = 0, last = 0, t = NOW, tried = 0;
  while (tried < 10000) { tried += 5; const p = S.lockPlan(level, last, t); level = p.level; t += p.minutes * 60000; last = t; }
  ok('walking every PIN now takes years, not weeks', (t - NOW) / DAY > 1900, ((t - NOW) / DAY).toFixed(0) + ' days');
}
ok('the lock says how long, in minutes', /Try again in 15 minutes/.test(S.lockWords(NOW + 15 * 60000, NOW)));
ok('or in hours when it is long', /Try again in 24 hours/.test(S.lockWords(NOW + DAY, NOW)));
ok('and the way out', /ask someone already in your family/.test(S.lockWords(NOW + 60000, NOW)));

// ---------------------------------------------------------------- 3. codes
ok('a new code of 8 with a number is fine', S.codeProblem('SHARMA24') === null && S.codeProblem('sharma 24') === null);
ok('7 is too short, and says how many were typed', /at least 8/.test(S.codeProblem('SHARMA2')) && /typed 7/.test(S.codeProblem('SHARMA2')));
ok('letters only needs a number', /at least one number/.test(S.codeProblem('SHARMASS')));
ok('13 is too long', /at most 12/.test(S.codeProblem('SHARMAFAMILY1')));
ok('symbols are refused', /letters and numbers only/.test(S.codeProblem('SHARMA-24')));
ok('an older 6-letter code is weak', S.codeIsWeak('KJMPWX') && S.codeIsWeak('SHARMAS'));
ok('an older short code with a number is weak too', S.codeIsWeak('KJM4PW'));
ok('8 letters with no number is weak', S.codeIsWeak('SHARMASS'));
ok('8 with a number is not', !S.codeIsWeak('SHARMA24'));
ok('at most 10 people wait to join one family', S.JOIN_PENDING_MAX === 10);

// ---------------------------------------------------------------- 4. cards
const card = { id: 'papa', name: 'Papa', phone: '+919811111111', dob: '1956-03-09', place: 'Pune', country: 'IN', relation: 'father',
               gift_info: { clothes: 'L', shoe: '9', likes: 'old songs' }, see_phone: null, see_birth: null, hidden_fields: null };
const adultV = { id: 'rohan', adult: true }, childV = { id: 'aarav', adult: false };
{
  const c = S.cardFor(card, adultV, 'family');
  ok('in a family, by default, the phone and the birthday are seen', c.phone === card.phone && c.dob === card.dob);
  ok('the choices themselves are never sent', !('see_phone' in c) && !('see_birth' in c) && !('hidden_fields' in c));
}
{
  const c = S.cardFor(card, adultV, 'group');
  ok('in a group of friends, by default, the phone is hidden', c.phone === null);
  ok('and the date of birth, all of it', c.dob === null && c.dob_md === null);
  ok('the name and the city stay', c.name === 'Papa' && c.place === 'Pune');
}
{
  const c = S.cardFor({ ...card, see_phone: 'family', see_birth: 'family' }, childV, 'group');
  ok('a member of a group can choose to show them', c.phone === card.phone && c.dob === card.dob);
}
{
  const only = { ...card, see_phone: 'adults', see_birth: 'adults' };
  ok('"only adults": an adult sees', S.cardFor(only, adultV, 'family').phone === card.phone && S.cardFor(only, adultV, 'family').dob === card.dob);
  const c = S.cardFor(only, childV, 'family');
  ok('"only adults": a child does not see the phone', c.phone === null);
  ok('nor the birth year, but the birthday without the year stays for wishes', c.dob === null && c.dob_md === '03-09');
}
{
  const me = { ...card, see_phone: 'me', see_birth: 'me' };
  ok('"only me": nobody else sees', S.cardFor(me, adultV, 'family').phone === null && S.cardFor(me, adultV, 'family').dob === null);
  ok('"only me": I still see my own', S.cardFor(me, { id: 'papa', adult: true }, 'family').phone === card.phone);
}
{
  const c = S.cardFor({ ...card, hidden_fields: ['sizes', 'place', 'dob', 'relation'] }, adultV, 'family');
  ok('an item hidden after "what your family wrote about you" is not sent', c.place === null && c.country === null && c.dob === null && c.dob_md === null && c.relation === null);
  ok('sizes hidden, likes kept', c.gift_info && !c.gift_info.clothes && !c.gift_info.shoe && c.gift_info.likes === 'old songs');
  ok('the person themselves still sees everything', S.cardFor({ ...card, hidden_fields: ['sizes', 'place'] }, { id: 'papa', adult: true }, 'family').place === 'Pune');
}
ok('a choice outside the three is not a choice', S.seeChoice('everyone') === null && S.seeChoice('adults') === 'adults');

// ------------------------------------------------- 5. deciding together
const papa = M('papa', { role: 'parent' }), maa = M('maa', { relation: 'mother' }), rohan = M('rohan', { dob: '1990-05-05' });
const aarav = M('aarav', { dob: '2014-02-02' }), dadi = M('dadi', { user_id: null, on_app: false });
{
  const r = S.removalRule({ me: papa, target: rohan, members: [papa, maa, rohan, aarav], today: TODAY });
  ok('removing someone: a second adult has to agree', r.needs === true && r.others.length === 1 && r.others[0].id === 'maa');
  ok('the person being removed is never the second adult', !r.others.some(o => o.id === 'rohan'));
  const two = S.removalRule({ me: papa, target: rohan, members: [papa, rohan, aarav], today: TODAY });
  ok('two adults only: neither can remove the other', two.status === 409 && /one cannot remove the other/.test(two.error));
  const solo = S.removalRule({ me: papa, target: aarav, members: [papa, aarav], today: TODAY });
  ok('the only adult may remove a child alone', solo.needs === false && !solo.error);
  // A mark is not a date of birth. One adult who says "not an adult" (or
  // "is a child") about someone with no date of birth cannot then put them
  // out alone.
  const marked = M('rohan', { adult_confirmed: false }), kid = M('rohan', { is_child: true });
  ok('sole adult, the other marked "not an adult" with no date of birth: refused', S.removalRule({ me: papa, target: marked, members: [papa, marked], today: TODAY }).status === 409);
  ok('sole adult, the other marked as a child with no date of birth: refused', S.removalRule({ me: papa, target: kid, members: [papa, kid], today: TODAY }).status === 409);
  ok('and it says why, kindly', /no date of birth/.test(S.removalRule({ me: papa, target: kid, members: [papa, kid], today: TODAY }).error));
  ok('a child cannot ask', S.removalRule({ me: aarav, target: rohan, members: [papa, maa, rohan, aarav], today: TODAY }).status === 403);
  ok('nobody removes themselves this way', S.removalRule({ me: papa, target: papa, members: [papa, maa], today: TODAY }).status === 400);
  ok('someone not on Parwah is taken out of the tree instead', S.removalRule({ me: papa, target: dadi, members: [papa, maa, dadi], today: TODAY }).status === 400);
  ok('nobody chosen is refused', S.removalRule({ me: papa, target: null, members: [papa], today: TODAY }).status === 404);
}
{
  ok('letting the code be enough: one adult alone decides', S.openJoinRule({ me: papa, members: [papa, aarav], today: TODAY }).needs === false);
  ok('two adults: the other has to say yes', S.openJoinRule({ me: papa, members: [papa, maa, aarav], today: TODAY }).needs === true);
  ok('a child cannot change how people join', S.openJoinRule({ me: aarav, members: [papa, aarav], today: TODAY }).status === 403);
  const d = S.deleteFamilyRule({ me: papa, members: [papa, maa, rohan, aarav, dadi], today: TODAY });
  ok('deleting the family: every adult on Parwah is asked', d.adults.map(a => a.id).join() === 'papa,maa,rohan');
  ok('a child cannot ask for it', S.deleteFamilyRule({ me: aarav, members: [papa, aarav], today: TODAY }).status === 403);
}
ok('the waiting times are 7 days, 48 hours and 10 minutes', S.UNDO_DAYS === 7 && S.LINK_HOLD_HOURS === 48 && S.RESET_VETO_MINUTES === 10);

// --------------------------------------------------------------- 6. words
ok('an Android phone in Chrome', S.deviceName('Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36') === 'Chrome on Android phone');
ok('an iPhone in Safari', S.deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1') === 'Safari on iPhone');
ok('nothing known is still a name', S.deviceName('') === 'A phone or computer' && S.deviceName(null) === 'A phone or computer');
{
  const w = S.writtenAbout({ name: 'Dadi', relation: 'grandmother', dob: '1941-08-15', place: 'Kanpur', gift_info: { clothes: 'M', likes: 'bhajans' } });
  ok('what the family wrote: name, relation, date, city, sizes, likes', w.map(i => i.key).join() === 'name,relation,dob,place,sizes,likes', w.map(i => i.key).join());
  ok('the name cannot be hidden or deleted', w[0].fixed === true);
  ok('nothing written, nothing listed', S.writtenAbout({ name: 'Dadi' }).length === 1);
}
{
  const words = [S.codeProblem('AB'), S.codeProblem('SHARMASS'), S.lockWords(NOW + DAY, NOW),
    S.removalRule({ me: papa, target: rohan, members: [papa, rohan], today: TODAY }).error,
    S.openJoinRule({ me: aarav, members: [aarav], today: TODAY }).error].join(' ');
  ok('no copy uses an em or en dash', !/[\u2013\u2014]/.test(words));
}

if (fails.length) {
  console.error(`standingtest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`standingtest: ${pass}/${pass} checks pass`);
