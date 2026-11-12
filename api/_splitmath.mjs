// SPLITTING A COST, THE SUMS. Imports nothing, so the gate can check every
// rule before npm install.
//
// Every amount here is a whole number of paise (hundredths). Nothing is ever
// a fraction: an amount is read from its text digit by digit, a share is
// worked out with whole-number division and the leftover paise are handed
// out one each, in a fixed order, so the shares always add up to the total.
//
// Parwah never moves money. The most this file does about paying is build a
// link that opens the payer's own UPI app with the amount filled in.

export const SPLIT_MAX = { what: 80, costs: 100, people: 60, paise: 10000000000 };

const isWhole = (n) => Number.isSafeInteger(n) && n >= 0;

// "1250", "1,250.5", "1250.50" -> paise. Anything else -> null. No number
// with a point in it is ever made: the rupees and the paise are read apart.
export function parsePaise(v) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) return null; v = String(v); }
  const s = String(v == null ? '' : v).replace(/[,\s]/g, '');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const paise = parseInt(m[1], 10) * 100 + parseInt(((m[2] || '') + '00').slice(0, 2), 10);
  return paise > SPLIT_MAX.paise ? null : paise;
}

// 125000 -> "1250.00": the form a UPI link wants.
export function paiseText(p) {
  if (!isWhole(p)) return '';
  const rest = p % 100;
  return String((p - rest) / 100) + '.' + (rest < 10 ? '0' : '') + rest;
}

// Equal shares. The leftover paise go one each to the first people in id
// order, so the same cost always splits the same way.
export function equalShares(total, ids) {
  const list = [...new Set(ids)].sort();
  if (!isWhole(total) || !list.length) return null;
  const rest = total % list.length, base = (total - rest) / list.length;
  const out = {};
  list.forEach((id, i) => { out[id] = base + (i < rest ? 1 : 0); });
  return out;
}

// Uneven shares, as typed. They must add up to the cost, to the paisa.
// Returns { shares } or { error, sum }.
export function unevenShares(total, typed) {
  const out = {}; let sum = 0;
  for (const id of Object.keys(typed || {}).sort()) {
    const p = typed[id];
    if (!isWhole(p)) return { error: 'Write each share as an amount, like 500 or 499.50.' };
    if (p > 0) { out[id] = p; sum += p; }
  }
  if (!Object.keys(out).length) return { error: 'Give at least one person a share.' };
  if (sum !== total) return { error: 'The shares add up to ' + paiseText(sum) + '. They must add up to ' + paiseText(total) + '.', sum };
  return { shares: out };
}

// Who is how far ahead or behind. costs: [{ amount, paidBy, shares: {id: paise} }].
// settles: [{ from, to, amount }], money that has already changed hands.
// net > 0: this person is owed; net < 0: this person owes.
export function balances(costs, settles) {
  const people = {};
  const at = (id) => people[id] || (people[id] = { share: 0, paid: 0, sent: 0, got: 0, net: 0 });
  let total = 0;
  for (const c of costs || []) {
    total += c.amount;
    if (c.paidBy) at(c.paidBy).paid += c.amount;
    for (const id of Object.keys(c.shares || {})) at(id).share += c.shares[id];
  }
  for (const s of settles || []) { at(s.from).sent += s.amount; at(s.to).got += s.amount; }
  for (const id of Object.keys(people)) { const p = people[id]; p.net = p.paid - p.share + p.sent - p.got; }
  return { total, people };
}

// One zero-sum group settled with one transfer fewer than it has people:
// the biggest debt meets the biggest credit, and one of them is cleared
// each time.
function settleGroup(group) {
  const owe = group.filter(x => x.net < 0).map(x => ({ id: x.id, left: -x.net }));
  const due = group.filter(x => x.net > 0).map(x => ({ id: x.id, left: x.net }));
  const order = (a, b) => b.left - a.left || (a.id < b.id ? -1 : 1);
  const out = [];
  while (owe.length && due.length) {
    owe.sort(order); due.sort(order);
    const amount = owe[0].left < due[0].left ? owe[0].left : due[0].left;
    out.push({ from: owe[0].id, to: due[0].id, amount });
    owe[0].left -= amount; due[0].left -= amount;
    if (!owe[0].left) owe.shift();
    if (!due[0].left) due.shift();
  }
  return out;
}

// "Who owes whom" with the fewest transfers. People are sorted into the
// largest number of groups that each settle among themselves; a group of k
// people needs k - 1 transfers, so more groups means fewer transfers. For
// up to 12 people with something to settle this is exact; a bigger family
// gets the simple way, which never takes more transfers than the people
// minus one.
export const SPLIT_EXACT_MAX = 12;
export function fewestTransfers(net) {
  const list = Object.keys(net || {}).filter(id => net[id] !== 0).sort().map(id => ({ id, net: net[id] }));
  let sum = 0; for (const x of list) sum += x.net;
  if (sum !== 0) return null;                 // the books do not balance: say nothing
  const n = list.length;
  if (!n) return [];
  let groups = [list];
  if (n <= SPLIT_EXACT_MAX) {
    const size = 1 << n, sums = new Array(size).fill(0), best = new Array(size).fill(0), drop = new Array(size).fill(-1);
    for (let mask = 1; mask < size; mask++) {
      let low = 0; while (!(mask & (1 << low))) low++;
      sums[mask] = sums[mask ^ (1 << low)] + list[low].net;
      for (let i = 0; i < n; i++) {
        if (!(mask & (1 << i))) continue;
        const b = best[mask ^ (1 << i)];
        if (drop[mask] < 0 || b > best[mask]) { best[mask] = b; drop[mask] = i; }
      }
      if (sums[mask] === 0) best[mask] += 1;
    }
    groups = [];
    let mask = size - 1, cur = [];
    while (mask) {
      const i = drop[mask];
      cur.push(list[i]);
      mask ^= (1 << i);
      if (sums[mask] === 0) { groups.push(cur); cur = []; }
    }
  }
  const out = [];
  for (const g of groups) for (const t of settleGroup(g)) out.push(t);
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
}

// The whole picture of a plan's costs.
export function ledger(costs, settles) {
  const b = balances(costs, settles);
  const net = {};
  for (const id of Object.keys(b.people)) net[id] = b.people[id].net;
  return { total: b.total, people: b.people, owes: fewestTransfers(net) || [] };
}

// A UPI id looks like name@bank: letters, digits, dot, dash or underscore,
// then @, then the bank's handle in letters.
export function isUpiId(v) {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(String(v == null ? '' : v));
}

// The link that opens the payer's own UPI app. Every field is encoded. No
// link is made for a malformed id, an amount that is not a whole number of
// paise above zero, or any currency but rupees.
export function upiLink(o) {
  const x = o || {};
  if (!isUpiId(x.pa)) return null;
  if (!isWhole(x.amount) || x.amount <= 0) return null;
  if ((x.cu || 'INR') !== 'INR') return null;
  const e = (s, max) => encodeURIComponent(String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max));
  return 'upi://pay?pa=' + encodeURIComponent(String(x.pa)) + '&pn=' + e(x.pn, 60) + '&am=' + paiseText(x.amount) + '&cu=INR&tn=' + e(x.tn, 80);
}
