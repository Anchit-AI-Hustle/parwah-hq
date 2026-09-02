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
  summary: /\b(doctor|hospital|appointment|clinic|check ?up|checkup|visit|emergency|casualty|admit|surgery|prepare|summary|taking (him|her|them|mum|mom|papa|dad|maa|amma))\b/i,
  memory:  /\b(medicine|medicines|dawa|dawai|tablet|blood ?group|allerg|insurance|policy|doctor'?s? number|contact|address|plumber|electrician|maid|records?|recorded|papers?|documents?)\b/i,
  circle:  /\b(check ?in|checked in|today|kaisa|kaise|how (is|are)|everything ok|all ok|what'?s happening|kya ho raha|reminder|reminders|request|requests|due|pending|task|todo|to do|family|circle|who)\b/i,
  greet:   /^\s*(hi|hello|hey|namaste|namaskar|hii+|salaam|adaab|good (morning|evening|afternoon))\b/i
};
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
  if (RE.greet.test(t)) return 'greet';
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
  const members = (p.members || []).map(m => m.name).filter(Boolean);
  if (members.length) lines.push('In ' + (p.circleName || 'the circle') + ': ' + members.join(', ') + '.');
  const ev = (p.recentEvents || []).slice(0, 6);
  if (ev.length) {
    lines.push('Lately:' + NL + bullets(ev.map(e => {
      const when = niceDate(e.created_at);
      const what = e.type === 'checkin' ? 'checked in' : e.type === 'sos' ? 'raised an SOS'
        : e.type === 'pill' ? 'marked medicines taken' : e.type === 'message' ? 'wrote' : e.type;
      return (e.member_name || 'Someone') + ' ' + what + (e.text ? ': ' + e.text : '') + (when ? ' (' + when + ')' : '');
    })));
  } else lines.push('Nothing has been recorded in the circle yet today.');
  const rem = (p.reminders || []).filter(Boolean);
  if (rem.length) lines.push('Reminders set: ' + rem.slice(0, 6).map(r => r.title || r.text || 'one').join('; ') + '.');
  const req = (p.requests || p.openRequests || []).filter(Boolean);
  if (req.length) lines.push('Open requests: ' + req.slice(0, 6).map(r => r.title || r.text || 'one').join('; ') + '.');
  return lines.join(NL + NL);
}

// The honest footer. A family must never be told that a limit is an answer.
export function offlineNote(reason) {
  const why = reason === 'billing' ? 'my AI key has no credit right now'
    : reason === 'auth' ? 'my AI key is not working right now'
    : reason === 'none' ? 'no AI key is set up yet'
    : 'I could not reach my AI right now';
  return 'I answered that straight from your family records, because ' + why
    + '. Everything above is exactly what is saved. For a proper conversation, add a working key under Profile, Ekta\'s brain.';
}

export function cannotAnswer(reason) {
  return ['I cannot chat properly at the moment, so I will not guess.', '',
    'What I can still do right now, from your family records:',
    bullets([
      'Read back what is recorded for anyone: "what do we have for Papa"',
      'Prepare a doctor or hospital visit: "taking Papa to the doctor tomorrow"',
      'Tell you what has happened in the circle: "who checked in today"'
    ]), '', offlineNote(reason)].join(NL);
}
