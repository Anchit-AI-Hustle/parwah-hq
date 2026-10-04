// EKTA WITHOUT A MODEL.
//
// Why this exists: Ekta's Anthropic key ran out of credit and every tier of
// the cascade returned the same account-level billing error, so the whole
// screen died. But most of what Ekta is asked at the kitchen table, and all
// of what the validation guide's fourth screen demonstrates, is RETRIEVAL:
// what has this family recorded about Papa, who checked in today, what is
// due. That lives in Postgres. It needs no model, it costs nothing, and for
// those questions it is more accurate than a model, because it cannot
// paraphrase a blood group.
//
// So when no provider will answer, Ekta stops apologising and starts
// retrieving. The product boundary is unchanged and, if anything, harder:
// this file quotes what is recorded, names what is missing, and never
// invents. No diagnosis, no advice, no interpretation.
//
// Dependency-free on purpose, so the deploy gate can unit-test the intent
// classifier and every rendering on a fresh clone, before npm install.

export const LOCAL_MODEL = 'parwah-local';

// A billing failure is an ACCOUNT fact, not a model fact: retrying the same
// key against a second and third model buys three identical refusals and
// three round trips of a family waiting. Recognise it and move on at once.
export function isBillingFailure(e) {
  const s = String((e && (e.message || e.error && e.error.message)) || e || '').toLowerCase();
  return s.includes('credit balance is too low')
      || s.includes('billing')
      || s.includes('insufficient_quota')
      || s.includes('quota exceeded')
      || s.includes('exceeded your current quota')
      || s.includes('payment required');
}
export function isAuthFailure(e) {
  const st = e && (e.status || e.statusCode);
  const s = String((e && (e.message || '')) || '').toLowerCase();
  return st === 401 || st === 403 || s.includes('invalid x-api-key') || s.includes('authentication_error');
}
// Neither more credit nor a retry will help: stop this provider now.
export function isDeadKey(e) { return isBillingFailure(e) || isAuthFailure(e); }

// ---------- what was asked ----------
const RE = {
  // Someone may be in danger right now. Checked before anything else, and
  // answered in fixed words that never cost a coin: a model, a records
  // lookup or a coin balance must never stand between a family and 112.
  emergency: /\b(chest ?pain|pain in (his|her|my|the) chest|(having|is having|just had|has just had) a heart attack|heart attack (now|right now|just now)|can'?t breathe|cannot breathe|not breathing|breathless|struggling to breathe|trouble breathing|breathing (problem|difficulty)|saans (nahi|nahin|nhi)|unconscious|not responding|can'?t get up|cannot get up|unresponsive|fainted|passed out|collapsed|behosh|(has|have|just|she|he) (fallen|had a fall)|fell (down|over|off|in the)|had a fall|(having|is having|just had) a stroke|stroke (now|right now|just now)|signs of (a )?stroke|face (is )?droop|slurred|paralys|bleeding (a lot|heavily|badly|won'?t stop)|heavy bleeding|khoon (beh|nikal)|seizure|convulsion|mirgi|choking|swallowed (poison|something)|poison|overdose|took too many (tablets|pills)|badly burn(ed|t)|(had|been in|met with) an? accident\b|accident (now|just now|right now))/i,
  // Words about ending one's life get a person to talk to, at once.
  crisis: /\b(kill (my|him|her)self|suicid|end (my|his|her) life|want to die|don'?t want to live|jeena nahi|marna chahta|marna chahti)/i,
  // A question about what to do with a medicine is the doctor's to answer.
  health: /\b((should|can|could|may) (\S+ ){1,4}(take|have|stop|skip|double|increase|reduce|start)\b[^.?!]{0,40}\b(tablet|tablets|medicine|medicines|dawa|dawai|pill|pills|dose|crocin|paracetamol|dolo|insulin|syrup|capsule|injection|bp|sugar|mg|antibiotic)|stop (his|her|the|my) (medicine|tablet|dawa|dose)|dose|dosage|side ?effects?|is (he|she|papa|mummy|maa|dad) (diabetic|hypertensive)|mix (with|it with)|along with (his|her) (bp|sugar|medicine|tablet))\b/i,
  summary: /\b(doctor|hospital|appointment|clinic|check ?up|checkup|visit|emergency|casualty|admit|surgery|prepare|summary|taking (him|her|them|mum|mom|papa|dad|maa|amma))\b/i,
  memory:  /\b(what do we (have|know)|what('s| is) (recorded|saved)|medicine|medicines|dawa|dawai|tablet|blood ?group|allerg|insurance|policy|doctor'?s? number|contact|address|plumber|electrician|maid|records?|recorded|papers?|documents?)\b/i,
  circle:  /\b(check ?in|checked in|today|kaisa|kaise|how (is|are)|everything ok|all ok|what'?s happening|kya ho raha|reminder|reminders|request|requests|due|pending|task|todo|to do|family|circle|who)\b/i,
  greet:   /^\s*(hi|hello|hey|namaste|namaskar|hii+|salaam|adaab|good (morning|evening|afternoon))\b/i,
  // The three the suggestion chips send, which the patterns above either
  // swallowed or missed: "Set a daily reminder" and "Please ask the circle
  // for help" both contain words the circle pattern matches (reminder,
  // circle), so they were answered with a circle summary; and "Is it a
  // scam?" matched nothing at all and was refused.
  scam:    /\b(otp|one[- ]time (password|code)|scam|scammer|fraud|phishing|kyc|upi ?pin|atm ?pin|card ?pin|cvv|lottery|you (have )?won|refund|customer care|account (is |has been )?(blocked|suspended|frozen|closed))\b/i,
  // An instruction, not a question: "is there a reminder for Papa" is still
  // a question about the circle.
  remind:  /^\s*(please\s+)?(set|add|create|make|put|schedule)\b[^?]*\breminder\b|\bremind me\b/i,
  help:    /\b(ask (the )?(circle|family|everyone|someone)|ask for help)\b/i
};
// Something that already happened ("passed out yesterday", "fell last
// year") is a question about the past, not a call for 112 - unless the
// message also says it is happening now.
const PAST = /\b(yesterday|last (night|week|month|year)|(\d+|a|an|one|two|three|few) (hours?|days?|weeks?|months?|years?) ago|in (19|20)\d\d|kal raat|pichhle|pichle|history of|used to|years back)\b/i;
// Said to be happening now, in so many words - including something that
// began earlier and has not stopped ("has been unconscious since last night").
const NOW = /\b(now|right now|just now|abhi|still|ongoing|(has|have) been having|keeps? having|is (not breathing|unconscious|bleeding|having|choking)|can'?t get up|please help|help me)\b|\b(today|tonight|this (morning|afternoon|evening)|keeps?)\b[^.?!]{0,30}\b(breath|chest|pain|bleed|unconscious|unresponsive|not responding|faint|collaps|behosh|seizure|chok|fallen|fell)/i;
// When something past is mentioned, each part of the message is judged on
// its own: "had a cold last week and has chest pain" is urgent, because the
// past words belong to the cold. A part that names a symptom is happening
// now unless that same part says it is past ("had", "a history of", "ever",
// or a time gone by). When in doubt, it is urgent.
const NOT_NOW = /\b(had|history|ever)\b/i;
const PARTS = /[,;.!?]+|\b(?:and|but|then|aur|lekin|par)\b/i;
// "since last night" says it has not stopped, asked or told ("Has Papa
// been unconscious since last night?" is still urgent) - unless the message
// asks whether something happened at some point since then ("Did Papa have
// a seizure at any time since his fall last year?").
const ONGOING = /\b(since|ab tak|abhi tak)\b/i;
// "Has Papa had a seizure since...?" asks whether one event happened, like
// "Did...". Only "had a/an/any <event>": "Has Papa had trouble breathing
// since last night?" is about something still going on, and stays urgent.
const ASKS_IF = /^\s*(did|was|were)\b|^\s*(has|have)\s+(\S+\s+){1,3}had\s+(a|an|any)\b|\b(any time|at any point|ever(?! since))\b/i;
// "Getting worse" counts for the part that names the emergency, or a part
// that refers back to it ("...and it is worse today") - not for something
// else in the same message ("his knee pain is getting worse").
// "was getting worse" is part of the past, not now.
// An adverb in between ("was rapidly getting worse") does not change that.
const WORSE = /(?<!\b(was|were|had been|had|used to be)\s+(\w+ly\s+)?)\b((is|it'?s|getting) worse|worsening|badh (raha|rahi)|zyada ho)/i;
// Refers back when what is getting worse is the pronoun, or nothing at all
// ("it is worse today", "he is getting worse", "...and is getting worse",
// "; worsening today", "Is he getting worse?"), not "he says his knee pain
// is worse".
const REFERS_BACK = new RegExp(
  // a pronoun is what is getting worse ("he is getting worse", "Is it worse?")
  /^\s*((is|isn'?t|has|does|kya)\s+)?(it|this|that|he|she|they|woh?|ye[h]?)\s+((is|'s|has been|keeps)\s+)?(\w+ly\s+)?((getting|becoming)\s+)?(\w+ly\s+)?(worse|worsening|badh (raha|rahi)|zyada)/.source
  // or nothing is named at all ("...and is getting worse", "; worsening today"),
  // never "worsening knee pain"
  + '|' + /^\s*((is|'s|has been|keeps)\s+)?((getting|becoming)\s+)?(worse|worsening)(\s+(today|now|tonight|again|fast|quickly|badly|every day))*\s*$/.source, 'i');
// Every signal is read in its own part of the message, so a separate
// question ("...and has this ever happened before?") does not cancel a
// current emergency in another part.
const saysNow = t => NOW.test(t)
  || t.split(PARTS).some(c => c && (
       (RE.emergency.test(c) && !PAST.test(c) && !NOT_NOW.test(c))
    // "since" in any part, unless that part asks whether something happened
    // ("...and has not woken up since" is about the collapse named before it)
    || (ONGOING.test(c) && !ASKS_IF.test(c))
    || (WORSE.test(c) && (RE.emergency.test(c) || REFERS_BACK.test(c)))));
// Words alone cannot always tell whether it is happening now. So a message
// that names an emergency is never answered without the way to 112, even
// when it reads as the past and gets its records answer first.
export function mentionsUrgent(text) { return RE.emergency.test(String(text || '')); }
export const URGENT_TOO = 'If any of this is happening now: call 112 (ambulance 108), or send SOS to the family.';

// The family's words for a person, and the relation saved for them, so
// "can Papa take..." finds the one member saved as father.
const KIN = [
  [/\b(papa|pappa|dad|daddy|father|pitaji|pita ji|abba|abbu)\b/i, 'father'],
  [/\b(mummy|mumma|mom|mum|maa|mother|mataji|mata ji|ammi|amma)\b/i, 'mother'],
  [/\b(dadi|dadima|nani|nanima|grandmother|grandma)\b/i, 'grandmother'],
  [/\b(dada|dadaji|nana|nanaji|grandfather|grandpa)\b/i, 'grandfather'],
  [/\b(bhaiya|bhai|brother)\b/i, 'brother'],
  [/\b(didi|sister)\b/i, 'sister']
];
// { name } when the word and exactly one saved relation agree; { word }
// when a family word was used but could not be matched to one person.
export function kinIsAsked(text, members) {
  const t = String(text || '');
  for (const [re, rel] of KIN) {
    if (!re.test(t)) continue;
    const hits = (members || []).filter(m => m && m.relation === rel);
    return hits.length === 1 ? { name: hits[0].name } : { word: t.match(re)[0] };
  }
  return null;
}
export const ABOUT_ME = /\b(i|me|my|myself|mujhe|main)\b/i;

// A named person, so "what do we have for Papa" answers about Papa.
export function whoIsAsked(text, memberNames) {
  const t = String(text || '').toLowerCase();
  let best = null;
  for (const n of memberNames || []) {
    const nm = String(n || '').trim();
    if (!nm) continue;
    if (new RegExp('\\b' + nm.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t)) {
      if (!best || nm.length > best.length) best = nm;
    }
  }
  return best;
}
export function classify(text) {
  const t = String(text || '');
  // Safety first, and before the greeting: "Hi, is this OTP message a scam?"
  // is a scam question that happens to start politely.
  if (RE.crisis.test(t))    return 'crisis';
  if (RE.emergency.test(t) && !(PAST.test(t) && !saysNow(t))) return 'emergency';
  if (RE.scam.test(t))   return 'scam';
  if (RE.health.test(t)) return 'health';
  if (RE.greet.test(t))  return 'greet';
  if (RE.remind.test(t)) return 'remind';
  if (RE.help.test(t))   return 'help';
  if (RE.summary.test(t)) return 'summary';
  if (RE.memory.test(t))  return 'memory';
  if (RE.circle.test(t))  return 'circle';
  return 'unknown';
}

// ---------- how it is said ----------
const NL = '\n';
function bullets(items) { return items.map(x => '• ' + x).join(NL); }
function niceDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(+d)) return null;
  return d.toISOString().slice(0, 10);
}
export function stalePhrase(lastChecked, needsRecheck) {
  const d = niceDate(lastChecked);
  if (!d) return ' (never checked)';
  return ' (checked ' + d + (needsRecheck ? ', worth confirming' : '') + ')';
}

// The doctor-visit answer. This is the guide's fourth screen, and what is
// MISSING is read out as loudly as what is present: an incomplete summary
// that looks complete is worse at a hospital counter than no summary.
const LABEL = {
  bloodGroup: 'Blood group', allergies: 'Allergies', medicines: 'Medicines',
  doctors: 'Doctors', emergencyContacts: 'Emergency contacts',
  someoneNearThem: 'Someone near them', insurance: 'Insurance', documents: 'Papers in the vault'
};
export function renderSummary(payload) {
  const s = payload && payload.summary;
  if (!s) return null;
  const who = s.person && s.person.name ? s.person.name : 'them';
  const out = ['Here is everything the family has recorded for ' + who + '. I am reading it back exactly as it was saved, not adding to it.'];
  const have = [];
  for (const k of ['bloodGroup', 'allergies', 'medicines', 'doctors', 'emergencyContacts', 'someoneNearThem', 'insurance']) {
    const rows = s[k] || [];
    if (!rows.length) continue;
    have.push(LABEL[k] + ': ' + rows.map(r =>
      r.what + (r.detail ? ' (' + r.detail + ')' : '') + stalePhrase(r.lastChecked, r.needsRecheck)).join('; '));
  }
  if ((s.documents || []).length) {
    have.push(LABEL.documents + ': ' + s.documents.map(d =>
      (d.label || d.kind) + (d.expires ? ', expires ' + niceDate(d.expires) : '')).join('; '));
  }
  out.push(have.length ? bullets(have) : 'Nothing has been recorded for ' + who + ' yet.');
  const missing = (payload.missing || []).map(k => LABEL[k]).filter(Boolean);
  if (missing.length) {
    out.push('Not recorded, so please carry or ask for it: ' + missing.join(', ') + '.');
  }
  out.push('This is a record, not medical advice. The doctor decides everything else.');
  return out.join(NL + NL);
}

const KIND_LABEL = { med: 'Medicines', fact: 'Health facts', contact: 'Contacts', insurance: 'Insurance', address: 'Addresses' };
export function renderMemory(payload, who) {
  const entries = (payload && payload.entries) || [];
  if (!entries.length) {
    return 'Nothing is recorded' + (who ? ' for ' + who : ' in Family Memory') + ' yet. Open the Memory tab to add the first entry, and it will be here next time.';
  }
  const byKind = {};
  for (const e of entries) (byKind[e.kind] = byKind[e.kind] || []).push(e);
  const lines = [];
  for (const k of Object.keys(byKind)) {
    lines.push((KIND_LABEL[k] || k) + ': ' + byKind[k].slice(0, 12).map(e =>
      e.name + (e.forwhat ? ' (' + e.forwhat + ')' : e.phone ? ' (' + e.phone + ')' : '')
      + stalePhrase(e.last_verified_at, e.stale)).join('; '));
  }
  return ['This is what the family has recorded' + (who ? ' for ' + who : '') + '.', bullets(lines),
          'Read back as saved, nothing added.'].join(NL + NL);
}

export function renderCircle(payload) {
  const p = payload || {};
  const lines = [];
  const space = p.kind === 'group' ? 'the group' : 'the family';
  const members = (p.members || []).map(m => m.name).filter(Boolean);
  if (members.length) lines.push('In ' + (p.circleName || space) + ': ' + members.join(', ') + '.');
  const ev = (p.recentEvents || []).slice(0, 6);
  if (ev.length) {
    lines.push('Lately:' + NL + bullets(ev.map(e => {
      const when = niceDate(e.created_at);
      const what = e.type === 'checkin' ? 'checked in' : e.type === 'sos' ? 'raised an SOS'
        : e.type === 'pill' ? 'marked medicines taken' : e.type === 'message' ? 'wrote' : e.type;
      return (e.member_name || 'Someone') + ' ' + what + (e.text ? ': ' + e.text : '') + (when ? ' (' + when + ')' : '');
    })));
  } else lines.push('Nothing has been recorded in ' + space + ' yet today.');
  const rem = (p.reminders || []).filter(Boolean);
  if (rem.length) lines.push('Reminders set: ' + rem.slice(0, 6).map(r => r.title || r.text || 'one').join('; ') + '.');
  const req = (p.requests || p.openRequests || []).filter(Boolean);
  if (req.length) lines.push('Open requests: ' + req.slice(0, 6).map(r => r.title || r.text || 'one').join('; ') + '.');
  return lines.join(NL + NL);
}

// The honest footer. A family must never be told that a limit is an answer.
function offlineWhy(reason) {
  return reason === 'coins' ? 'the family is out of coins'
    : reason === 'billing' ? 'my AI key has no credit right now'
    : reason === 'auth' ? 'my AI key is not working right now'
    : reason === 'none' ? 'no AI key is set up yet'
    : 'I could not reach my AI right now';
}

// A scam question does not need a model, and the right answer does not
// change from family to family - which is exactly why it can be given
// offline, word for word, and why it must never be improvised.
export function renderScam(text, reason) {
  const t = String(text || '');
  const asked = /\b(otp|one[- ]time (password|code)|upi ?pin|atm ?pin|card ?pin|cvv)\b/i.test(t);
  const lead = asked
    ? 'Yes, treat it as a scam. Anyone asking for an OTP or a PIN to do with a payment, a bank or UPI is trying to take money.'
    : 'Here is how to tell, and what to do.';
  return [lead, '',
    bullets([
      'No bank, UPI app, KYC desk or government office will ever ask you for an OTP, UPI PIN, card PIN or CVV. Not on a call, not by SMS, not on WhatsApp.',
      'An OTP is only for you to type into an app or website you opened yourself. The one code you do hand over is a delivery code, to the person at your door.',
      'Do not tap links in the message, and do not call back a number it gives you.',
      'If money has already gone, call 1930 straight away. It is the national cyber-crime helpline. You can also report at cybercrime.gov.in, and tell your bank.',
      'Tell someone in your family. A second pair of eyes stops most of these.'
    ]), '',
    'This is the standard advice, the same for every family, not something from your records. I am giving it without a conversation because ' + offlineWhy(reason) + '.'
  ].join(NL);
}

// Offline she cannot create anything. Saying so, and pointing at the exact
// place in the app where it takes a few seconds, is the useful answer; a
// circle summary in reply to "set a reminder" was the useless one.
export function renderCannotDo(kind, reason) {
  const where = kind === 'help'
    ? ['I cannot post that to the family while ' + offlineWhy(reason) + ', and I will not pretend I did.', '',
       'You can ask them yourself in a few seconds:',
       bullets(['Open Care, then Things to do.',
                'Under "Add something to do", write what you need.',
                'Leave "For" as Anyone. It goes to the whole family, and the first person to tap "I\'m on it" takes it.'])]
    : ['I cannot set reminders while ' + offlineWhy(reason) + ', and I will not pretend I did.', '',
       'You can add it yourself in a few seconds:',
       bullets(['Open Care, then Things to do.',
                'Under "Add something to do", write it, for example "Check in".',
                'Set the time, choose Daily if it repeats, and tap Add it.'])];
  return where.join(NL);
}

// Only for an answer that really was read from the records.
export function offlineNote(reason) {
  if (reason === 'records') return 'I read that straight from your family records. Everything above is exactly what is saved, and reading it back costs no coins.';
  return 'I answered that straight from your family records, because ' + offlineWhy(reason)
    + '. Everything above is exactly what is saved, and reading it back costs no coins.'
    + (reason === 'coins' ? '' : ' For a proper conversation, add a working key under Profile, Ekta\'s brain.');
}

// Nothing was answered, so nothing claims to have been read from records.
export function cannotAnswer(reason) {
  return ['I cannot chat properly at the moment, because ' + offlineWhy(reason) + ', so I will not guess.', '',
    'What I can still do right now, free, from your family records:',
    bullets([
      'Read back what is recorded for anyone: "what do we have for Papa"',
      'Prepare a doctor or hospital visit: "taking Papa to the doctor tomorrow"',
      'Check a message that might be a scam: "is this OTP message a scam"'
    ]), '',
    'If someone is unwell or hurt right now, call 112 (ambulance 108) and press SOS so the family knows.'].join(NL);
}

// Fixed words, the same for every family, so they can be checked once and
// trusted always. No first aid instructions: Parwah is not a doctor.
export function renderEmergency() {
  return ['This sounds urgent. Please do this now:', '',
    bullets([
      'Call 112 now. For an ambulance you can also call 108.',
      'Press SOS below, so everyone in the family is told at once.',
      'Stay with them, and keep your phone with you.'
    ]), '',
    'I am not a doctor and cannot judge how serious this is. The people on 112 can.'].join(NL);
}

export function renderCrisis() {
  return ['I am really glad you said something. You do not have to carry this alone.', '',
    bullets([
      'Tele-MANAS is free and open day and night: call 14416. They speak Hindi, English and many other languages.',
      'If anyone is in danger right now, call 112.',
      'Tell one person in your family you trust. Press SOS below if you want them all to know now.'
    ])].join(NL);
}

// Whose doctor visit: asked, never guessed. The first relative on the list
// is not the person being taken to the doctor.
// Ekta asked whose visit or whose medicines; a reply that is only a name
// is read together with the question it answers, so "Raj" after "Who is
// the doctor visit for?" is the doctor visit for Raj.
const ASKED_WHO = /^(Who is the doctor visit for\?|Who is this about\?)/;
export function askedText(history) {
  const h = history || [];
  const last = h[h.length - 1];
  if (!last || last.role !== 'user') return '';
  const t = String(last.content || '');
  const prevA = h[h.length - 2], prevU = h[h.length - 3];
  if (prevA && prevA.role === 'assistant' && ASKED_WHO.test(String(prevA.content || '').trim())
      && prevU && prevU.role === 'user' && classify(t) === 'unknown') {
    return String(prevU.content || '') + '\n' + t;
  }
  return t;
}
export function renderWhoIsVisit(names) {
  return 'Who is the doctor visit for? Say their name as it is saved in the family'
    + ((names || []).length ? ': ' + names.join(', ') : '') + '. For example: "taking ' + ((names || [])[0] || 'Papa') + ' to the doctor tomorrow".';
}
// Not sure whose records: ask, rather than mix several people's medicines.
export function renderWhoIsIt(names) {
  return ['Who is this about? Please use their name as it is saved in the family'
    + ((names || []).length ? ': ' + names.join(', ') : '') + '.', '',
    'Either way, I cannot advise on medicines. Whether to take, stop or change anything is for the doctor to say.'].join(NL);
}

// A medicine question: what is recorded, then the doctor. Never advice.
export function renderHealth(payload, who, doctor) {
  const entries = ((payload && payload.entries) || []).filter(e => e.kind === 'med' || e.kind === 'fact');
  const out = [];
  if (entries.length) {
    out.push('This is what the family has recorded' + (who ? ' for ' + who : '') + ':');
    out.push(bullets(entries.slice(0, 12).map(e => e.name + (e.forwhat ? ' (' + e.forwhat + ')' : '') + stalePhrase(e.last_verified_at, e.stale))));
  } else {
    out.push('Nothing about medicines or health is recorded' + (who ? ' for ' + who : '') + ' yet.');
  }
  out.push('I cannot advise on medicines: whether to take, stop, mix or change anything is for ' + (who ? who + "'s" : 'the') + ' doctor to say.'
    + (doctor ? ' The doctor recorded is ' + doctor.name + (doctor.phone ? ', ' + doctor.phone : '') + '.' : ' Please ask the doctor or a pharmacist before changing anything.'));
  return out.join(NL + NL);
}
