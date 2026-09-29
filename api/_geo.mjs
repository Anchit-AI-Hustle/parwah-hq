// WHERE SOMEONE IS - the arithmetic, and nothing else.
// Imports nothing, so the deploy gate tests it before npm install
// (site/tests/geotest.mjs).

export const PRECISIONS = ['exact', 'area'];
// "Area only" keeps two decimals of a degree: about 1.1 km north-south.
// Enough to know someone reached Pune, not which building they are in.
export const AREA_DECIMALS = 2;
// After this long without a new position, the screen says so plainly.
export const STALE_MINUTES = 30;

export function validPosition(lat, lng, accuracy) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return { error: 'That position could not be read' };
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return { error: 'That position is not on the map' };
  let acc = accuracy === undefined || accuracy === null || accuracy === '' ? null : Number(accuracy);
  if (acc !== null && (!Number.isFinite(acc) || acc < 0)) acc = null;
  if (acc !== null) acc = Math.min(Math.round(acc), 100000);
  return { lat: la, lng: ln, accuracy: acc };
}

// What the family is allowed to see, for the precision the person chose.
export function shareable(pos, precision) {
  if (precision !== 'area') return { lat: round(pos.lat, 6), lng: round(pos.lng, 6), accuracy: pos.accuracy };
  const f = Math.pow(10, AREA_DECIMALS);
  // Snap to the middle of the area square, and never report a sharper
  // accuracy than the square itself.
  const snap = (v) => (Math.floor(v * f) + 0.5) / f;
  return { lat: round(snap(pos.lat), 4), lng: round(snap(pos.lng), 4), accuracy: Math.max(pos.accuracy || 0, 1100) };
}
const round = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

// Great-circle distance in metres.
export function distanceM(a, b) {
  const R = 6371000, toR = (d) => d * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceText(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 100) return 'right here';
  if (m < 1000) return Math.round(m / 10) * 10 + ' m away';
  if (m < 10000) return (Math.round(m / 100) / 10) + ' km away';
  return Math.round(m / 1000).toLocaleString('en-IN') + ' km away';
}

export function agoText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const h = Math.round(min / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}
export function isStale(iso, now = Date.now()) {
  const t = Date.parse(iso);
  return !Number.isFinite(t) || now - t > STALE_MINUTES * 60000;
}

// Is a new position worth sending? Moved more than 50 m, or two minutes on.
export function worthSending(last, next, now = Date.now()) {
  if (!last) return true;
  if (now - last.at >= 120000) return true;
  return distanceM(last, next) >= 50;
}

export function mapsUrl(lat, lng) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng);
}
