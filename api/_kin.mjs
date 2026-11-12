// WHO IS WHO IN A FAMILY TREE - the arithmetic, and nothing else.
// Imports nothing, so the deploy gate tests it before npm install
// (site/tests/kintest.mjs).
//
// A family is stored with two links per person, set when someone places
// them: parentId ("son of Papa") and spouseId ("wife of Rohan"). A couple is
// one unit. In each unit, the person whose parent link points up the tree is
// "born into" this line; their spouse "married in". Everything else - son,
// daughter-in-law, grandson, Mama, Bua, Chachi - is worked out from how many
// generations up and down separate two units, and who married in.

export const GENDERS = ['m', 'f'];
export const PLACES = ['child', 'spouse', 'parent', 'sibling'];
export const FAMILY_TYPES = ['joint', 'nuclear'];

// A date of birth as YYYY-MM-DD, or null. Only used to tell an elder brother
// from a younger one; an empty or odd value is simply "not known".
function dobOf(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v)) return null;
    const z = n => String(n).padStart(2, '0');
    return v.getFullYear() + '-' + z(v.getMonth() + 1) + '-' + z(v.getDate());
  }
  const t = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

// people: [{ id, gender, parentId, spouseId, dob? }]
export function index(people) {
  const by = new Map();
  for (const p of people) by.set(p.id, { id: p.id, gender: p.gender || null, parentId: p.parentId || null, spouseId: p.spouseId || null, dob: dobOf(p.dob) });
  // A spouse link counts only when it is mutual and both are present.
  for (const p of by.values()) {
    const s = p.spouseId && by.get(p.spouseId);
    if (!s || s.spouseId !== p.id) p.spouseId = null;
    if (p.parentId && !by.has(p.parentId)) p.parentId = null;
  }
  return by;
}

// The unit a person belongs to: themselves and their spouse.
function unitOf(by, id) {
  const p = by.get(id); if (!p) return null;
  const s = p.spouseId ? by.get(p.spouseId) : null;
  // The unit's "line" person: the one with a parent link. If neither has
  // one (the eldest couple), both belong; if both have one, the man's line
  // is the unit's line, as a family tree usually reads.
  let line = p;
  if (s) {
    if (!p.parentId && s.parentId) line = s;
    else if (p.parentId && s.parentId && p.gender !== 'm' && s.gender === 'm') line = s;
  }
  return { key: [p.id, s ? s.id : ''].sort().join('|'), line, members: s ? [p, s] : [p] };
}
// The parent unit of a unit: the unit of the line person's parent.
function parentUnit(by, u) {
  return u.line.parentId ? unitOf(by, u.line.parentId) : null;
}
function marriedIn(u, person) { return u.members.length === 2 && u.line.id !== person.id && !!u.line.parentId; }

// Ancestor chain of units, nearest first, with the person in each unit
// whose line leads down to the start (to know father's or mother's side).
function ancestors(by, id) {
  // A unit seen twice means bad links (a loop); stop there rather than
  // count the same people again as older generations.
  const out = [], seen = new Set(); let u = unitOf(by, id);
  while (u && !seen.has(u.key) && out.length < 50) { seen.add(u.key); out.push(u); u = parentUnit(by, u); }
  return out;
}
// Everyone above a person: the units of their parents, grandparents and so
// on, both members of each.
function above(by, id) {
  const p = by.get(id), out = new Set();
  if (!p || !p.parentId) return out;
  for (const u of ancestors(by, p.parentId)) for (const m of u.members) out.add(m.id);
  return out;
}
// A husband and wife cannot be each other's ancestor or descendant.
function lineal(by, a, b) { return above(by, a).has(b) || above(by, b).has(a); }

const L = (m, f, n) => ({ m, f, n });
const LABELS = {
  '0,0': L('Husband', 'Wife', 'Spouse'),
  '1,0': L('Father', 'Mother', 'Parent'),
  '2,0': L('Grandfather', 'Grandmother', 'Grandparent'),
  '3,0': L('Great-grandfather', 'Great-grandmother', 'Great-grandparent'),
  '0,1': L('Son', 'Daughter', 'Child'),
  '0,2': L('Grandson', 'Granddaughter', 'Grandchild'),
  '0,3': L('Great-grandson', 'Great-granddaughter', 'Great-grandchild'),
  '1,1': L('Brother', 'Sister', 'Sibling'),
  '1,2': L('Nephew', 'Niece', 'Nephew or niece'),
  '2,2': L('Cousin', 'Cousin', 'Cousin'),
};
const pick = (l, g) => (g === 'm' ? l.m : g === 'f' ? l.f : l.n);

// How `to` is related to `from`, in words a family uses. null when they are
// not connected in the tree (someone has not been placed yet). The near
// family is named by lineLabel below, exactly as it always was; where that
// has no word (it said 'Family') or cannot see the link (a wife's own
// parents, when her husband's are in the tree too), the wider family is
// named from the chain that connects the two people.
export function kinLabel(by, fromId, toId) {
  if (fromId === toId) return 'You';
  const near = lineLabel(by, fromId, toId);
  if (near && near !== 'Family') return near;
  const chain = kinChain(by, fromId, toId);
  if (!chain || !chain.length) return near;
  return classify(by, by.get(fromId), chain).label;
}
function lineLabel(by, fromId, toId) {
  if (fromId === toId) return 'You';
  const from = by.get(fromId), to = by.get(toId);
  if (!from || !to) return null;
  const A = ancestors(by, fromId), B = ancestors(by, toId);
  let ai = -1, bi = -1;
  for (let i = 0; i < A.length && ai < 0; i++) {
    const j = B.findIndex(u => u.key === A[i].key);
    if (j >= 0) { ai = i; bi = j; }
  }
  if (ai < 0) return null;
  const up = ai, down = bi;
  const fromIn = marriedIn(A[0], from), toIn = marriedIn(B[0], to);
  const g = to.gender;

  // Same unit: husband and wife.
  if (up === 0 && down === 0) return pick(LABELS['0,0'], g);

  // Straight up the line: parents, grandparents. Seen by someone who
  // married in, the first generation are in-laws.
  if (down === 0) {
    const base = LABELS[up + ',0']; if (!base) return 'Elder of the family';
    if (fromIn && up === 1) return pick(L('Father-in-law', 'Mother-in-law', 'Parent-in-law'), g);
    // Seen by someone who married in: Grandmother-in-law, as a family says it.
    if (fromIn) return pick(base, g) + '-in-law';
    return pick(base, g);
  }
  // Straight down: children, grandchildren. Their spouses are in-laws.
  if (up === 0) {
    const base = LABELS['0,' + down]; if (!base) return 'Descendant';
    if (toIn && down === 1) return pick(L('Son-in-law', 'Daughter-in-law', 'Child-in-law'), g);
    if (toIn) return pick(base, g === 'm' ? 'm' : g === 'f' ? 'f' : null) + '-in-law';
    return pick(base, g);
  }
  // Brothers and sisters, and the in-laws around them.
  if (up === 1 && down === 1) {
    if (toIn || fromIn) return pick(L('Brother-in-law', 'Sister-in-law', 'Sibling-in-law'), g);
    return pick(LABELS['1,1'], g);
  }
  // A brother's or sister's children.
  if (up === 1 && down === 2) {
    if (toIn) return g === 'f' ? "Nephew's wife" : g === 'm' ? "Niece's husband" : 'Nephew or niece by marriage';
    return pick(LABELS['1,2'], g);
  }
  // Aunts and uncles: which side depends on whether the line runs through
  // father or mother.
  if (up === 2 && down === 1) {
    const parentLine = A[1].line;                       // the parent born into the grandparents' line
    const viaFather = parentLine.gender === 'm', viaMother = parentLine.gender === 'f';
    const uncleUnit = B[0], blood = uncleUnit.line;     // the aunt or uncle born into the line
    const bloodName = blood.gender === 'm'
      ? (viaFather ? 'Chacha' : viaMother ? 'Mama' : 'Uncle')
      : blood.gender === 'f' ? (viaFather ? 'Bua' : viaMother ? 'Mausi' : 'Aunt') : 'Uncle or aunt';
    if (!toIn) return bloodName;
    const spouseName = { Chacha: 'Chachi', Mama: 'Mami', Bua: 'Fufa', Mausi: 'Mausa', Uncle: 'Aunt', Aunt: 'Uncle' }[bloodName];
    return spouseName || 'Uncle or aunt by marriage';
  }
  // A grandparent's brother or sister, and a brother's or sister's grandchildren.
  if (up === 3 && down === 1) return pick(L('Grand-uncle', 'Grand-aunt', 'Grand-uncle or grand-aunt'), g);
  if (up === 1 && down === 3 && !toIn) return pick(L('Grand-nephew', 'Grand-niece', 'Grand-nephew or grand-niece'), g);
  if (up === 2 && down === 2) return toIn ? "Cousin's " + (g === 'm' ? 'husband' : g === 'f' ? 'wife' : 'spouse') : 'Cousin';
  return 'Family';
}

// ---------- door ke rishtedaar: the wider family, and the chain ----------
// Four kinds of step join two people: up to a parent, down to a child, across
// to a brother or sister, across to a husband or wife. A couple is one unit,
// so a person's parents are the parent they point to and that parent's
// husband or wife, and their children are the children of either.
const WALK_CAP = 5000;      // people looked at in one walk, whatever the links say
function kidsOf(by) {
  const kids = new Map();
  for (const p of by.values()) {
    if (!p.parentId) continue;
    if (!kids.has(p.parentId)) kids.set(p.parentId, []);
    kids.get(p.parentId).push(p);
  }
  return kids;
}
function parentsOf(by, p) {
  const a = p.parentId ? by.get(p.parentId) : null;
  if (!a) return [];
  const b = a.spouseId ? by.get(a.spouseId) : null;
  return b ? [a, b] : [a];
}
// Everyone one step from a person, blood first so that when two chains are
// equally short the one through the person's own line is the one told.
function nextTo(by, kids, p) {
  const out = [];
  const ps = parentsOf(by, p);
  for (const x of ps) out.push(['parent', x]);
  for (const x of ps) for (const c of kids.get(x.id) || []) if (c.id !== p.id) out.push(['sibling', c]);
  for (const c of kids.get(p.id) || []) out.push(['child', c]);
  if (p.spouseId) for (const c of kids.get(p.spouseId) || []) out.push(['child', c]);
  const s = p.spouseId ? by.get(p.spouseId) : null;
  if (s) out.push(['spouse', s]);
  return out;
}
// One walk outwards from a person, nearest first. Each person is visited
// once, so a loop or a broken link cannot make it run on.
function walk(by, fromId) {
  const seen = new Map();
  if (!by.has(fromId)) return seen;
  const kids = kidsOf(by), queue = [fromId];
  seen.set(fromId, null);
  for (let i = 0; i < queue.length && i < WALK_CAP; i++) {
    const p = by.get(queue[i]);
    for (const [rel, x] of nextTo(by, kids, p)) {
      if (!x || seen.has(x.id)) continue;
      seen.set(x.id, { prev: p.id, rel });
      queue.push(x.id);
    }
  }
  return seen;
}
const STEP_WORDS = {
  parent: L('father', 'mother', 'parent'), child: L('son', 'daughter', 'child'),
  sibling: L('brother', 'sister', 'sibling'), spouse: L('husband', 'wife', 'spouse'),
};
function chainFrom(by, seen, toId) {
  const out = []; let id = toId, guard = 0;
  while (seen.get(id) && guard++ < WALK_CAP) {
    const s = seen.get(id);
    out.push({ step: pick(STEP_WORDS[s.rel], by.get(id).gender), rel: s.rel, id });
    id = s.prev;
  }
  return out.reverse();
}

// The steps that join two people, the shortest way:
// [{ step: 'father', rel: 'parent', id }, { step: 'sister', rel: 'sibling', id }, ...].
// [] for the same person. null when the tree does not connect them: a link
// is never made up.
export function kinChain(by, fromId, toId) {
  if (!by.has(fromId) || !by.has(toId)) return null;
  if (fromId === toId) return [];
  const seen = walk(by, fromId);
  return seen.has(toId) ? chainFrom(by, seen, toId) : null;
}

export const NOT_CONNECTED = 'Not connected in the family tree yet';
// The chain in plain words, with first names where they are known:
// "Your father Ramesh's sister Sunita's husband". names is a Map or a plain
// object of id to name. The last person is the one being described, so
// their own name is left out.
export function kinChainWords(chain, names) {
  if (!chain) return NOT_CONNECTED;
  if (!chain.length) return 'You';
  const nameOf = id => {
    const n = !names ? '' : (typeof names.get === 'function' ? names.get(id) : names[id]);
    return n ? String(n).trim().split(/\s+/)[0] : '';
  };
  return 'Your ' + chain.map((s, i) => {
    const n = i < chain.length - 1 ? nameOf(s.id) : '';
    return s.step + (n ? ' ' + n : '');
  }).join("'s ");
}

// Words used when a chain is told short: "Dada's brother's grandson".
const HINDI_FIRST = /^(Papa|Maa|Dada|Dadi|Nana|Nani|Pardada|Pardadi|Parnana|Parnani|Chacha|Chachi|Mama|Mami|Bua|Fufa|Mausi|Mausa|Jeth|Jethani|Devar|Devrani|Nanad|Nandoi|Saala|Saali|Salhaj|Saadhu|Bhabhi|Jija|Samdhi|Samdhan|Sasur|Saas|Damaad|Bahu|Pota|Poti|Nati|Natin|Bhatija|Bhatiji|Bhanja|Bhanji)\b/;
const low = s => (HINDI_FIRST.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const great = n => 'great-'.repeat(Math.max(0, n));
function upWord(n, g) {        // n generations up
  if (n === 1) return pick(STEP_WORDS.parent, g);
  return great(n - 2) + pick(L('grandfather', 'grandmother', 'grandparent'), g);
}
function downWord(n, g) {
  if (n === 1) return pick(STEP_WORDS.child, g);
  return great(n - 2) + pick(L('grandson', 'granddaughter', 'grandchild'), g);
}
// Which side a line runs through: the first step up is to father or mother.
const sideOf = p => (p && p.gender === 'm' ? 'paternal' : p && p.gender === 'f' ? 'maternal' : null);
function grandHindi(first, g) {   // the grandparent reached through `first`
  const s = sideOf(first);
  if (s === 'paternal') return g === 'm' ? 'Dada' : g === 'f' ? 'Dadi' : null;
  if (s === 'maternal') return g === 'm' ? 'Nana' : g === 'f' ? 'Nani' : null;
  return null;
}
// A chain told short, from the first person's point of view. Runs of steps
// up or down are folded into one word, and the viewer's own parents and
// grandparents get their home names.
function describe(by, chain) {
  const parts = [];
  for (let i = 0; i < chain.length;) {
    const rel = chain[i].rel; let j = i;
    if (rel === 'parent' || rel === 'child') while (j + 1 < chain.length && chain[j + 1].rel === rel) j++;
    const n = j - i + 1, last = by.get(chain[j].id), g = last ? last.gender : null;
    let w;
    if (rel === 'parent') {
      const first = by.get(chain[i].id);
      if (i === 0 && n === 1) w = g === 'm' ? 'Papa' : g === 'f' ? 'Maa' : 'parent';
      else if (i === 0 && n === 2) w = grandHindi(first, g) || upWord(2, g);
      else w = upWord(n, g);
    } else if (rel === 'child') w = downWord(n, g);
    else w = pick(STEP_WORDS[rel], g);
    parts.push(w);
    i = j + 1;
  }
  return cap(parts.join("'s "));
}
// Who was born first, from the dates of birth. null when either is not
// known or they are the same: the caller then does not guess.
function elder(a, b) {
  if (!a || !b || !a.dob || !b.dob || a.dob === b.dob) return null;
  return a.dob < b.dob;
}

const SIG = { parent: 'P', child: 'C', sibling: 'B', spouse: 'S' };
const GHAR = /^(S|B|P+|C+)$/;
const KAREEBI = ['PB', 'PBS', 'PBC', 'BC', 'SBC', 'BCS', 'SBS'];
// ghar: husband or wife, and the straight line up and down, and brothers and
// sisters. kareebi: uncles, aunts, first cousins, nephews, nieces, and the
// in-laws one marriage away from ghar. door: everyone else who is connected.
function closenessOf(sig) {
  if (GHAR.test(sig)) return 'ghar';
  if (KAREEBI.includes(sig)) return 'kareebi';
  if (sig.length > 1 && sig[0] === 'S' && GHAR.test(sig.slice(1))) return 'kareebi';
  if (sig.length > 1 && sig.endsWith('S') && GHAR.test(sig.slice(0, -1))) return 'kareebi';
  return 'door';
}

// Names a chain. label is the word kinLabel says when the near-family
// arithmetic has none; english is always plain English; hindi is the home
// name when there is one and nothing had to be guessed.
function classify(by, from, chain) {
  const n = chain.length, sig = chain.map(s => SIG[s.rel]).join('');
  const p = i => by.get(chain[i].id);
  const t = p(n - 1), g = t.gender;
  const side = chain[0].rel === 'parent' ? sideOf(p(0)) : (chain[0].rel === 'spouse' && n > 1 ? 'married' : null);
  const out = (english, hindi, label) => ({ english, hindi: hindi || null, label: label || english, side, closeness: closenessOf(sig) });
  const MF = (m, f) => (g === 'm' ? m : g === 'f' ? f : null);
  const inlaw = pick(L('Brother-in-law', 'Sister-in-law', 'Sibling-in-law'), g);

  if (sig === 'S') return out(pick(LABELS['0,0'], g));
  if (sig === 'B') return out(pick(LABELS['1,1'], g));
  if (/^P+$/.test(sig)) {
    const english = cap(upWord(n, g));
    if (n === 2) return out(english, grandHindi(p(0), g));
    // Dada's father is Pardada, Nana's father is Parnana.
    if (n === 3 && p(1).gender === 'm' && sideOf(p(0))) return out(english, sideOf(p(0)) === 'paternal' ? MF('Pardada', 'Pardadi') : MF('Parnana', 'Parnani'));
    return out(english);
  }
  if (/^C+$/.test(sig)) {
    const english = cap(downWord(n, g));
    // A son's child is Pota or Poti; a daughter's child is Nati or Natin.
    if (n === 2) return out(english, p(0).gender === 'm' ? MF('Pota', 'Poti') : p(0).gender === 'f' ? MF('Nati', 'Natin') : null);
    return out(english);
  }
  if (/^SP+$/.test(sig)) {
    if (n === 2) return out(pick(L('Father-in-law', 'Mother-in-law', 'Parent-in-law'), g), MF('Sasur', 'Saas'));
    return out(cap(upWord(n - 1, g)) + '-in-law');
  }
  if (/^C+S$/.test(sig)) {
    if (n === 2) return out(pick(L('Son-in-law', 'Daughter-in-law', 'Child-in-law'), g), MF('Damaad', 'Bahu'));
    return out(cap(downWord(n - 1, g)) + '-in-law');
  }
  // The family someone married into. Whose family it is comes from the
  // husband or wife: a husband's brother is Jeth or Devar, a wife's is Saala.
  if (sig === 'SB' || sig === 'SBS') {
    const sp = p(0), sib = p(1);
    const ofHusband = sp.gender === 'm' || (!sp.gender && from.gender === 'f');
    const ofWife = sp.gender === 'f' || (!sp.gender && from.gender === 'm');
    let hindi = null;
    if (sig === 'SB') {
      if (ofHusband && g === 'm') { const e = elder(sib, sp); hindi = e === null ? null : e ? 'Jeth' : 'Devar'; }
      else if (ofHusband && g === 'f') hindi = 'Nanad';
      else if (ofWife) hindi = MF('Saala', 'Saali');
    } else if (ofHusband && sib.gender === 'm' && g === 'f') { const e = elder(sib, sp); hindi = e === null ? null : e ? 'Jethani' : 'Devrani'; }
    else if (ofHusband && sib.gender === 'f' && g === 'm') hindi = 'Nandoi';
    else if (ofWife && sib.gender === 'm' && g === 'f') hindi = 'Salhaj';
    else if (ofWife && sib.gender === 'f' && g === 'm') hindi = 'Saadhu';
    return out(inlaw, hindi);
  }
  // A brother's wife, a sister's husband, seen by the one born into the line.
  if (sig === 'BS') return out(inlaw, p(0).gender === 'm' && g === 'f' ? 'Bhabhi' : p(0).gender === 'f' && g === 'm' ? 'Jija' : null);
  // The two sets of parents of a married couple, to each other.
  if (sig === 'CSP') {
    const whose = pick(L('Son-in-law', 'Daughter-in-law', "Child's husband or wife"), p(1).gender);
    const hindi = MF('Samdhi', 'Samdhan');
    return out(whose + "'s " + pick(STEP_WORDS.parent, g), hindi, hindi);
  }
  if (sig === 'PB' || sig === 'PBS') {
    const blood = p(1), s = sideOf(p(0));
    const english = pick(L('Uncle', 'Aunt', 'Uncle or aunt'), g);
    const name = blood.gender === 'm' ? (s === 'paternal' ? 'Chacha' : s === 'maternal' ? 'Mama' : null)
               : blood.gender === 'f' ? (s === 'paternal' ? 'Bua' : s === 'maternal' ? 'Mausi' : null) : null;
    if (sig === 'PB') return out(english, name, name);
    const wed = name ? { Chacha: 'Chachi', Mama: 'Mami', Bua: 'Fufa', Mausi: 'Mausa' }[name] : null;
    return out(g ? english : 'Uncle or aunt by marriage', g ? wed : null, g ? wed : null);
  }
  if (sig === 'PBC') return out('Cousin');
  if (sig === 'BC') return out(pick(LABELS['1,2'], g), p(0).gender === 'm' ? MF('Bhatija', 'Bhatiji') : p(0).gender === 'f' ? MF('Bhanja', 'Bhanji') : null);
  if (sig === 'SBC') return out(pick(LABELS['1,2'], g));
  if (sig === 'PPB' || sig === 'PPBS') return out(pick(L('Grand-uncle', 'Grand-aunt', 'Grand-uncle or grand-aunt'), g));
  if (sig === 'BCC') return out(pick(L('Grand-nephew', 'Grand-niece', 'Grand-nephew or grand-niece'), g));
  // A parent's cousin is an uncle or aunt to a family, a cousin's child a
  // nephew or niece; the words in brackets say which kind.
  if (sig === 'PPBC') {
    const via = p(0).gender === 'm' ? "Papa's" : p(0).gender === 'f' ? "Maa's" : "parent's";
    return out(pick(L('Uncle', 'Aunt', 'Cousin once removed'), g) + ' (' + via + ' cousin)');
  }
  if (sig === 'PBCC') return out(pick(L('Nephew', 'Niece', 'Cousin once removed'), g) + " (cousin's " + pick(STEP_WORDS.child, g) + ')');
  if (sig === 'PPBCC') return out('Second cousin');
  if (sig === 'PPPBCC' || sig === 'PPBCCC') return out('Second cousin once removed');
  // Someone's husband or wife: "Cousin's wife", "Grand-nephew's wife".
  if (n > 1 && sig.endsWith('S')) {
    const inner = classify(by, from, chain.slice(0, -1));
    if (!/[(]/.test(inner.label) && inner.label.split("'s ").length < 3) return out(inner.label + "'s " + pick(STEP_WORDS.spouse, g));
  }
  // The husband's or wife's family: "Wife's Mama", "Husband's cousin".
  if (n > 1 && sig[0] === 'S') {
    const inner = classify(by, p(0), chain.slice(1));
    if (!/[(]/.test(inner.label) && inner.label.split("'s ").length < 3) return out(cap(pick(STEP_WORDS.spouse, p(0).gender)) + "'s " + low(inner.label));
  }
  // Further than any one word reaches: the chain itself, told short.
  return out(describe(by, chain));
}

const SELF = () => ({ label: 'You', english: 'You', hindi: null, chain: [], side: null, closeness: 'ghar' });
const APART = () => ({ label: null, english: null, hindi: null, chain: null, side: null, closeness: 'unplaced' });
function infoFor(by, fromId, toId, chain) {
  if (fromId === toId) return SELF();
  if (!chain) return APART();
  const c = classify(by, by.get(fromId), chain);
  const near = lineLabel(by, fromId, toId);
  return { label: near && near !== 'Family' ? near : c.label, english: c.english, hindi: c.hindi, chain, side: c.side, closeness: c.closeness };
}
// Everything about how `to` is related to `from`:
// { label, english, hindi, chain, side, closeness }.
//   label      what kinLabel says
//   english    the plain English word ("Uncle" for a Chacha)
//   hindi      the home name in Latin letters, or null when there is none or
//              it would be a guess (elder or younger with no date of birth)
//   chain      kinChain's steps; null when not connected
//   side       'paternal', 'maternal', 'married' (through a husband or wife) or null
//   closeness  'ghar', 'kareebi', 'door', or 'unplaced' when not connected
// null when either person is not in this family.
export function kinInfo(by, fromId, toId) {
  if (!by.has(fromId) || !by.has(toId)) return null;
  return infoFor(by, fromId, toId, kinChain(by, fromId, toId));
}
// kinInfo for everyone at once, from one person's point of view, in one
// walk: Map of id to info, the person themself included.
export function kinEveryone(by, fromId) {
  const out = new Map();
  if (!by.has(fromId)) return out;
  const seen = walk(by, fromId);
  for (const id of by.keys()) out.set(id, infoFor(by, fromId, id, seen.has(id) ? chainFrom(by, seen, id) : null));
  return out;
}
// Everyone else sorted into near and far, nearest first in each group:
// { ghar: [id], kareebi: [id], door: [id], unplaced: [id] }.
export function kinCloseness(by, fromId) {
  const groups = { ghar: [], kareebi: [], door: [], unplaced: [] };
  const all = [...kinEveryone(by, fromId)].filter(([id]) => id !== fromId);
  all.sort((a, b) => (a[1].chain ? a[1].chain.length : 99) - (b[1].chain ? b[1].chain.length : 99));
  for (const [id, info] of all) groups[info.closeness].push(id);
  return groups;
}

// Generation of every placed person, the eldest unit being 1. People who are
// not connected to anyone stay out of the tree (null).
export function generations(by) {
  const gen = new Map();
  for (const p of by.values()) {
    const chain = ancestors(by, p.id);
    gen.set(p.id, chain.length);
  }
  return gen;
}

// Placing someone must never make a person their own ancestor.
export function wouldLoop(by, childId, parentId) {
  if (childId === parentId) return true;
  let u = unitOf(by, parentId), guard = 0;
  while (u && guard++ < 60) {
    if (u.members.some(m => m.id === childId)) return true;
    u = parentUnit(by, u);
  }
  return false;
}

// The links to write for "target is the <place> of ofId". Returns
// { set: [{ id, parentId?, spouseId? }], error? }. Everyone is an equal
// admin, so anyone in the family may place anyone; the arithmetic only
// refuses what cannot be true.
export function placement(by, targetId, place, ofId) {
  const plan = plan_(by, targetId, place, ofId);
  if (plan.error) return plan;
  // Whatever the path, never write links that loop: try them on a copy.
  const next = new Map([...by].map(([k, v]) => [k, { ...v }]));
  for (const w of plan.set) Object.assign(next.get(w.id), w);
  for (const p of next.values()) {
    const seen = new Set(); let u = unitOf(next, p.id);
    while (u) { if (seen.has(u.key)) return { error: 'That would make someone their own ancestor' }; seen.add(u.key); u = parentUnit(next, u); }
  }
  return plan;
}
function plan_(by, targetId, place, ofId) {
  const t = by.get(targetId), o = by.get(ofId);
  if (!t || !o) return { error: 'Choose someone who is in this family' };
  if (targetId === ofId) return { error: 'Choose someone else' };
  if (!PLACES.includes(place)) return { error: 'Choose child, spouse, parent or brother or sister' };
  if (place === 'child') {
    if (wouldLoop(by, targetId, ofId)) return { error: 'That would make someone their own ancestor' };
    return { set: [{ id: targetId, parentId: ofId }] };
  }
  if (place === 'spouse') {
    if (o.spouseId && o.spouseId !== targetId) return { error: 'They already have a husband or wife in the tree' };
    if (t.spouseId && t.spouseId !== ofId) return { error: 'This person already has a husband or wife in the tree' };
    if (lineal(by, targetId, ofId)) return { error: 'They are already parent and child, or grandparent and grandchild, in the tree' };
    return { set: [{ id: targetId, spouseId: ofId }, { id: ofId, spouseId: targetId }] };
  }
  if (place === 'parent') {
    // Already has a parent: the new person is that parent's husband or wife.
    if (o.parentId) {
      const p = by.get(o.parentId);
      if (p.spouseId && p.spouseId !== targetId) return { error: 'Both parents are already in the tree' };
      if (t.spouseId && t.spouseId !== p.id) return { error: 'This person already has a husband or wife in the tree' };
      if (targetId === p.id) return { error: 'They are already a parent of this person' };
      if (lineal(by, targetId, p.id)) return { error: 'That would make someone their own ancestor' };
      return { set: [{ id: targetId, spouseId: p.id }, { id: p.id, spouseId: targetId }] };
    }
    if (wouldLoop(by, ofId, targetId)) return { error: 'That would make someone their own ancestor' };
    return { set: [{ id: ofId, parentId: targetId }] };
  }
  // A brother or sister shares the parent. Without a parent in the tree yet,
  // there is nothing to share.
  if (!o.parentId) return { error: 'Add their mother or father first, then place them as a child' };
  if (wouldLoop(by, targetId, o.parentId)) return { error: 'That would make someone their own ancestor' };
  return { set: [{ id: targetId, parentId: o.parentId }] };
}

// A label from the old one-word role, for people not yet placed.
export function genderFromRelation(rel) {
  if (['father', 'grandfather', 'son', 'brother', 'grandson', 'son-in-law'].includes(rel)) return 'm';
  if (['mother', 'grandmother', 'daughter', 'sister', 'granddaughter', 'daughter-in-law'].includes(rel)) return 'f';
  return null;
}

// ---------- linked families: two trees joined at one person ----------
// Two related families (maika and sasural, two brothers' homes) each keep
// their own tree. When both agree to link, the two graphs are joined in
// memory at the one person who belongs to both (the bridge), and every
// relation across the join is worked out by the same arithmetic as above.
// Nothing is written: ending the link ends the join.
//
// Ids of the other family are given a prefix, so two families can never
// collide. The bridge person is one node. So are the people who must be the
// same in both trees: the bridge's husband or wife, and the bridge's parents
// (a daughter-in-law's father, added by name in her husband's home, is the
// Papa of her own home).
export const LINK_PREFIX = 'L:';
export const LINK_MAX_PEOPLE = 400;   // people of the other family taken into one join
const yearOnly = v => { const d = dobOf(v); return d ? d.slice(0, 4) + '-01-01' : null; };

// own, other: [{ id, gender, parentId, spouseId, dob? }]; bridge: { own, other }.
// Returns { by, ids, same, joined }:
//   by      the joined index, ready for kinInfo, kinChain and kinEveryone
//   ids     Map of the other family's id to its id in the joined index
//   same    Map of the other family's id to this family's id, for the people
//           who are one person in both
//   joined  false when the bridge is not in both families (by is then this
//           family alone)
// Dates of birth are cut to the year on both sides, so elder or younger is
// only said when the years differ, and a full date never decides anything.
export function joinGraphs(own, other, bridge, prefix = LINK_PREFIX) {
  const cut = list => (list || []).map(p => ({ ...p, dob: yearOnly(p.dob) }));
  const A = index(cut(own)), B = index(cut(other).slice(0, LINK_MAX_PEOPLE));
  const same = new Map(), ids = new Map(), taken = new Set();
  if (!bridge || !A.has(bridge.own) || !B.has(bridge.other)) return { by: A, ids, same, joined: false };
  const pair = (b, a) => {
    if (!b || !a || !B.has(b) || !A.has(a) || same.has(b) || taken.has(a)) return;
    same.set(b, a); taken.add(a);
  };
  pair(bridge.other, bridge.own);
  const a = A.get(bridge.own), b = B.get(bridge.other), wed = [];
  if (a.spouseId && b.spouseId) pair(b.spouseId, a.spouseId);
  if (a.parentId && b.parentId) {
    const pa = A.get(a.parentId), pb = B.get(b.parentId);
    // One tree may point to the father and the other to the mother.
    const cross = !!pa.gender && !!pb.gender && pa.gender !== pb.gender;
    if (!cross) { pair(pb.id, pa.id); if (pa.spouseId && pb.spouseId) pair(pb.spouseId, pa.spouseId); }
    else {
      if (pa.spouseId) pair(pb.id, pa.spouseId);
      if (pb.spouseId) pair(pb.spouseId, pa.id);
      if (!pa.spouseId && !pb.spouseId) wed.push([pa.id, pb.id]);
    }
  }
  const map = id => (!id ? null : same.has(id) ? same.get(id) : prefix + id);
  const out = new Map(), borrowed = new Set();
  for (const p of A.values()) out.set(p.id, { ...p });
  for (const p of B.values()) {
    ids.set(p.id, map(p.id));
    if (same.has(p.id)) {
      // One person: this family's links stand, the other family's fill the gaps.
      const t = out.get(same.get(p.id));
      if (!t.gender) t.gender = p.gender;
      if (!t.dob) t.dob = p.dob;
      if (!t.parentId && p.parentId) { t.parentId = map(p.parentId); borrowed.add(t.id); }
      if (!t.spouseId && p.spouseId) t.spouseId = map(p.spouseId);
    } else out.set(prefix + p.id, { id: prefix + p.id, gender: p.gender, parentId: map(p.parentId), spouseId: map(p.spouseId), dob: p.dob });
  }
  for (const [x, y] of wed) { out.get(x).spouseId = prefix + y; out.get(prefix + y).spouseId = x; }
  const by = index([...out.values()]);
  // A join must never make someone their own ancestor. A link that closes a
  // loop is dropped: the other family's first, then a link this family
  // took from the other, and this family's own links last.
  const rank = p => (String(p.id).startsWith(prefix) ? 0 : borrowed.has(p.id) ? 1 : 2);
  const order = [...by.values()].sort((x, y) => rank(x) - rank(y));
  for (const p of order) if (p.parentId && (p.parentId === p.id || above(by, p.id).has(p.id))) p.parentId = null;
  return { by, ids, same, joined: true };
}

// How each person of a linked family is related to one person of this family.
// names / otherNames: Map or plain object of id to name, for the chain in
// words. Returns Map of the other family's id to
//   { same, label, hindi, english, side, group, chain, words }
//   same   this family's id when they are one person in both, else null
//   group  'ghar' or 'kareebi' when the arithmetic says so, otherwise 'door'
//   words  the chain in words; null when the trees do not connect them
export function kinLinked(own, other, bridge, fromId, names, otherNames, prefix = LINK_PREFIX) {
  const out = new Map();
  const j = joinGraphs(own, other, bridge, prefix);
  if (!j.joined || !j.by.has(fromId)) return out;
  const get = (src, id) => (!src ? '' : typeof src.get === 'function' ? src.get(id) : src[id]);
  const all = new Map();
  for (const p of own || []) all.set(p.id, get(names, p.id) || '');
  for (const p of other || []) if (!j.same.has(p.id)) all.set(prefix + p.id, get(otherNames, p.id) || '');
  const every = kinEveryone(j.by, fromId);
  for (const [otherId, joinedId] of j.ids) {
    const info = every.get(joinedId);
    if (!info) continue;
    const near = info.closeness === 'ghar' || info.closeness === 'kareebi';
    out.set(otherId, { same: j.same.get(otherId) || null, label: info.label, hindi: info.hindi, english: info.english, side: info.side,
                       group: near ? info.closeness : 'door', chain: info.chain, words: info.chain ? kinChainWords(info.chain, all) : null });
  }
  return out;
}
