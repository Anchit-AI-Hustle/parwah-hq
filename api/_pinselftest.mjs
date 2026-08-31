// GET /api/diag?probe=pin
//
// Same split as the day probe, for the same reason: our parser is arithmetic
// on someone else's JSON and can be checked offline; whether India Post is
// answering today is their business, not ours, and is reported separately.
// The raw keys of a live record are echoed back, so a change in their shape
// is visible here rather than as a quietly empty locality list.
import { pinError, normPin, parsePin, joinAddress, PIN_SOURCE, fetchPin } from './_pin.mjs';

const REAL = [{
  Status: 'Success',
  PostOffice: [
    { Name: 'Greater Kailash', BranchType: 'Sub Post Office', District: 'South Delhi', Block: 'New Delhi', State: 'Delhi' },
    { Name: 'Kailash Colony', BranchType: 'Branch Post Office', District: 'South Delhi', Block: 'New Delhi', State: 'Delhi' }
  ]
}];

export default async function handler(req, res) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });

  try {
    add('six digits, never starting 0', pinError('110048') === null && pinError('010048') !== null && pinError('11004') !== null);
    add('spaces forgiven, junk refused', normPin(' 110048 ') === '110048' && normPin('abc') === null);
    const g = parsePin(REAL, '110048');
    add('a real record is read correctly', g && g.areas.length === 2 && g.district === 'South Delhi' && g.state === 'Delhi',
      g ? g.areas.length + ' localities, ' + g.district + ', ' + g.state : 'nothing parsed');
    add('an unknown PIN yields nothing, never a guess',
      parsePin([{ Status: 'Error', PostOffice: null }], '999999') === null
      && parsePin([{ Status: 'Success', PostOffice: [] }], '110048') === null);
    add('a record with no state is not an answer',
      parsePin([{ Status: 'Success', PostOffice: [{ Name: 'Nowhere' }] }], '110048') === null);
    add('the saved line reads like an address',
      joinAddress({ street: 'S-354', area: 'Greater Kailash', city: 'South Delhi', state: 'Delhi', pin: '110048' })
        === 'S-354, Greater Kailash, South Delhi — Delhi 110048');
    add('a lone street survives untouched', joinAddress({ street: 'S-354' }) === 'S-354');
  } catch (e) { add('pin parser', false, String(e && e.message || e)); }

  // The live check — one real PIN, reported apart from our own correctness.
  const t0 = Date.now();
  let live = null, raw = null;
  try {
    const r = await fetch(PIN_SOURCE + '110048', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
    if (r.ok) {
      const j = await r.json();
      const box = Array.isArray(j) ? j[0] : j;
      const first = box && Array.isArray(box.PostOffice) ? box.PostOffice[0] : null;
      raw = first ? Object.keys(first) : null;
      live = parsePin(j, '110048');
    }
  } catch (e) { /* reported as unreachable below */ }
  if (!live) { try { live = await fetchPin('110048'); } catch (e) {} }

  const source = {
    endpoint: PIN_SOURCE,
    reachable: !!live,
    ms: Date.now() - t0,
    pin: '110048',
    resolved: live ? ((live.district ? live.district + ', ' : '') + live.state) : null,
    localities: live ? live.areas.map(a => a.name).slice(0, 6) : null,
    recordKeys: raw,
    note: live ? 'PIN lookups are live.'
               : 'India Post is not answering right now. Addresses are still saved exactly as typed — the app asks the person for the city rather than guessing one.'
  };
  const failed = checks.filter(c => !c.ok);
  return res.status(failed.length ? 500 : 200).json({
    ok: failed.length === 0,
    summary: (checks.length - failed.length) + '/' + checks.length + ' parser checks pass; source ' +
             (source.reachable ? 'reachable' : 'UNREACHABLE'),
    parser: { ok: failed.length === 0, checks },
    source
  });
}
