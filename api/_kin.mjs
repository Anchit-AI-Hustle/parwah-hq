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

// people: [{ id, gender, parentId, spouseId }]
export function index(people) {
  const by = new Map();
  for (const p of people) by.set(p.id, { id: p.id, gender: p.gender || null, parentId: p.parentId || null, spouseId: p.spouseId || null });
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
// not connected in the tree (someone has not been placed yet).
export function kinLabel(by, fromId, toId) {
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
    if (fromIn) return pick(base, g) + ' (by marriage)';
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
