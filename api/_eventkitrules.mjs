// THE FUNCTION KIT ("Shaadi / function kit"): the rules, with no database
// and no imports, so the unit test runs before npm install
// (site/tests/familyneedstest.mjs).
//
// A wedding, a mundan, a housewarming: built on a plan the family already
// has. A guest list picked from the family tree and the Rishtedaar list
// plus typed names (no phone is ever asked for), sides, where each invite
// stands, tasks with owners, who arrives when and who receives them, the
// budget beside the plan's shared costs, and a guest sheet to print.
// The plan's maker and the people they name are the hosts: hosts change
// it, the family sees it. Someone who has passed away is never a guest.
export const KIT_STATUSES = ['to_invite', 'invited', 'coming', 'not_coming'];
export const KIT_STATUS_WORDS = { to_invite: 'To invite', invited: 'Invited', coming: 'Coming', not_coming: 'Not coming' };
export const KIT_SIDES_DEFAULT = ['Our family', 'Their family', 'Friends'];
export const KIT_MAX = { guests: 600, sides: 8, hosts: 8, name: 60, side: 30, people: 30, note: 120, arrivals: 200, tasks: 100 };
export const KIT_MODES = ['train', 'flight', 'car', 'bus', 'other'];
export const KIT_MODE_WORDS = { train: 'by train', flight: 'by flight', car: 'by car', bus: 'by bus', other: '' };

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Who may change the kit: the plan's maker, and the hosts they named.
export function kitIsHost(plan, kit, memberId) {
  if (!plan || !memberId) return false;
  if (plan.by_member === memberId) return true;
  return !!kit && Array.isArray(kit.hosts) && kit.hosts.includes(memberId);
}
// Only the plan's maker starts the kit and names the hosts.
export function kitIsMaker(plan, memberId) { return !!plan && !!memberId && plan.by_member === memberId; }

export function kitSides(v) {
  const out = [];
  for (const s of Array.isArray(v) ? v : []) { const t = clean(s, KIT_MAX.side); if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t); }
  return out.slice(0, KIT_MAX.sides);
}

// One guest. A member of the tree is named by id; anyone else by a typed
// name. A phone number is never part of a guest.
//   goneNames: lower-case names of people who have passed away (this family
//   and the families linked to it): a typed name that is one of them is refused.
export function kitGuestClean(b, { sides = [], goneNames = new Set() } = {}) {
  b = b || {};
  const name = clean(b.name, KIT_MAX.name);
  if (!b.memberId && !name) return { error: 'Write the guest\'s name, or pick someone from the family.' };
  if (!b.memberId && /\d{7,}/.test(name.replace(/[\s-]/g, ''))) return { error: 'Only the name is needed here. A phone number is not kept on the guest list.' };
  if (!b.memberId && goneNames.has(name.toLowerCase())) return { error: name + ' is remembered here, so is not on a guest list. If this is someone else of the same name, add a word to tell them apart.' };
  let people = b.people === undefined || b.people === null || b.people === '' ? 1 : Number(b.people);
  if (!Number.isInteger(people) || people < 1 || people > KIT_MAX.people) return { error: 'How many people are coming with this invite? Write a number from 1 to ' + KIT_MAX.people + '.' };
  const side = clean(b.side, KIT_MAX.side) || null;
  if (side && sides.length && !sides.some(s => s.toLowerCase() === side.toLowerCase())) return { error: 'Choose one of the sides on the list.' };
  const status = KIT_STATUSES.includes(b.status) ? b.status : 'to_invite';
  return { value: { name: name || null, side, people, status, note: clean(b.note, KIT_MAX.note) || null } };
}

// The counts a host reads at a glance. `people` counts heads, not invites.
export function kitCounts(guests) {
  const c = { invites: 0, to_invite: 0, invited: 0, coming: 0, not_coming: 0, peopleComing: 0, peopleInvited: 0 };
  for (const g of guests || []) {
    c.invites++; c[g.status] = (c[g.status] || 0) + 1;
    if (g.status === 'coming') c.peopleComing += g.people || 1;
    if (g.status !== 'not_coming') c.peopleInvited += g.people || 1;
  }
  return c;
}

// The printable guest sheet: by side, then by name.
export function kitSheet(guests, sides) {
  const order = (sides || []).map(s => s.toLowerCase());
  const key = g => { const i = order.indexOf(String(g.side || '').toLowerCase()); return i < 0 ? order.length : i; };
  const rows = (guests || []).slice().sort((a, b) => key(a) - key(b) || String(a.name).localeCompare(String(b.name)));
  const groups = [];
  for (const g of rows) {
    const label = g.side || 'Others';
    let grp = groups.find(x => x.side === label);
    if (!grp) { grp = { side: label, guests: [], people: 0 }; groups.push(grp); }
    grp.guests.push({ name: g.name, people: g.people || 1, status: KIT_STATUS_WORDS[g.status] || KIT_STATUS_WORDS.to_invite, note: g.note || '' });
    if (g.status !== 'not_coming') grp.people += g.people || 1;
  }
  return groups;
}

// An arrival: who, when, how, from where, and who receives them.
export function kitArrivalClean(b) {
  b = b || {};
  const who = clean(b.who, KIT_MAX.name);
  if (!b.memberId && !who) return { error: 'Write who is arriving.' };
  const at = new Date(String(b.arriveAt || ''));
  if (isNaN(at)) return { error: 'Pick the day and time they arrive.' };
  return { value: { who: who || null, arriveAt: at, mode: KIT_MODES.includes(b.mode) ? b.mode : 'other', from: clean(b.from, 60) || null } };
}
export function kitBudgetClean(v) {
  const s = String(v == null ? '' : v).replace(/[,\s]/g, '');
  if (!s) return { value: null };
  if (!/^\d+$/.test(s) || Number(s) <= 0 || Number(s) > 1e10) return { error: 'Write the budget as a whole number, like 500000.' };
  return { value: Number(s) * 100 };
}
