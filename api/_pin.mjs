// INDIAN POSTCODES - turning six digits into a real, checkable address.
//
// A free-text address box gets you "S-354, Greater Kailash 2" and no way to
// know which city that is, whether the PIN matches the locality, or how to
// find it in an emergency. India Post publishes the mapping for free, with no
// key, so the six digits a family already knows can fill in locality,
// district and state - and say so when they do not match.
//
// Two rules, the same two the horoscope follows:
//   1. Fetched ONCE per PIN and kept. Postcodes do not change; a family should
//      never wait on someone else's server twice for the same six digits.
//   2. If the source cannot be reached, the app SAYS so and the person types
//      the address themselves. It never guesses a city from a PIN.

export const PIN_SOURCE = 'https://api.postalpincode.in/pincode/';

// A valid Indian PIN is six digits and never starts with 0 - the first digit
// is the postal zone, 1 to 9.
export function pinError(raw) {
  const p = String(raw || '').replace(/\s/g, '');
  if (!p) return 'Enter the 6-digit PIN code';
  if (!/^\d+$/.test(p)) return 'A PIN code is six digits';
  if (p.length !== 6) return 'A PIN code is six digits - that is ' + p.length;
  if (p[0] === '0') return 'No Indian PIN code starts with 0';
  return null;
}
export function normPin(raw) {
  const p = String(raw || '').replace(/\s/g, '');
  return pinError(p) ? null : p;
}

// India Post answers with an array holding one result object. Anything else,
// any missing field, any empty list → null. A wrong address is worse than no
// address, so nothing here fills a gap with a plausible value.
export function parsePin(json, pin) {
  const box = Array.isArray(json) ? json[0] : json;
  if (!box || typeof box !== 'object') return null;
  if (String(box.Status || '') !== 'Success') return null;
  const list = Array.isArray(box.PostOffice) ? box.PostOffice : [];
  const areas = [];
  const seen = {};
  let district = '', state = '';
  for (const po of list) {
    if (!po || typeof po !== 'object') continue;
    const name = String(po.Name || '').trim();
    if (!name || seen[name.toLowerCase()]) continue;
    seen[name.toLowerCase()] = 1;
    areas.push({
      name,
      block: String(po.Block || '').trim() || null,
      kind: String(po.BranchType || '').trim() || null
    });
    if (!district) district = String(po.District || '').trim();
    if (!state) state = String(po.State || '').trim();
  }
  if (!areas.length || !state) return null;
  return { pin, areas, district: district || null, state, country: 'India', source: 'india-post' };
}

export async function fetchPin(pin) {
  try {
    const r = await fetch(PIN_SOURCE + encodeURIComponent(pin), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(7000)
    });
    if (!r.ok) return null;
    return parsePin(await r.json(), pin);
  } catch (e) { return null; }
}

export async function ensurePinSchema(sql) {
  await sql`create table if not exists pincode (
    pin text primary key,
    areas jsonb not null,
    district text,
    state text not null,
    source text not null,
    fetched_at timestamptz not null default now()
  )`;
}

// Cache first, source second, nothing invented third.
export async function lookupPin(sql, rawPin) {
  const pin = normPin(rawPin);
  if (!pin) return { ok: false, error: pinError(rawPin) };
  await ensurePinSchema(sql);
  const have = await sql`select pin, areas, district, state, source from pincode where pin = ${pin}`;
  if (have[0]) {
    return { ok: true, cached: true, pin,
      areas: have[0].areas, district: have[0].district, state: have[0].state,
      country: 'India', source: have[0].source };
  }
  const got = await fetchPin(pin);
  if (!got) {
    return { ok: false, unknown: true, pin,
      error: 'We could not check that PIN code just now - type the city and state yourself and it will be saved as you write it.' };
  }
  try {
    await sql`insert into pincode (pin, areas, district, state, source)
              values (${pin}, ${JSON.stringify(got.areas)}, ${got.district}, ${got.state}, ${got.source})
              on conflict (pin) do nothing`;
  } catch (e) { /* another request won the race - its row is the same row */ }
  return { ok: true, cached: false, ...got };
}

// The one line that goes on a card, built from the parts. Blank parts are
// dropped rather than leaving ", ," behind.
export function joinAddress(parts) {
  const line = [parts.street, parts.area, parts.city].map(function (x) {
    return String(x || '').trim();
  }).filter(Boolean).join(', ');
  const tail = [String(parts.state || '').trim(), String(parts.pin || '').trim()].filter(Boolean).join(' ');
  return [line, tail].filter(Boolean).join(' - ');
}
