// LOCATION ARITHMETIC. api/_geo.mjs imports nothing, so this runs in the
// deploy gate before npm install.
import * as G from '../../api/_geo.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail !== undefined ? ' -> ' + detail : '')); };

const PUNE = { lat: 18.520430, lng: 73.856743 }, DELHI = { lat: 28.613939, lng: 77.209023 };

ok('a real position is accepted', !G.validPosition(PUNE.lat, PUNE.lng, 12).error);
ok('text numbers are read', G.validPosition('18.52', '73.85', '9').lat === 18.52);
ok('off the map is refused', !!G.validPosition(91, 10).error && !!G.validPosition(10, 181).error);
ok('nonsense is refused', !!G.validPosition('abc', 10).error && !!G.validPosition(undefined, undefined).error);
ok('a missing or negative accuracy becomes unknown', G.validPosition(1, 1).accuracy === null && G.validPosition(1, 1, -5).accuracy === null);

const exact = G.shareable({ ...PUNE, accuracy: 12 }, 'exact');
ok('exact keeps the position (to about 10 cm)', Math.abs(exact.lat - PUNE.lat) < 1e-6 && exact.accuracy === 12);
const area = G.shareable({ ...PUNE, accuracy: 12 }, 'area');
ok('area only is within about a kilometre, never exact', G.distanceM(area, PUNE) < 1000 && (area.lat !== PUNE.lat || area.lng !== PUNE.lng));
ok('area only never claims better than 1.1 km', area.accuracy === 1100);
const near = G.shareable({ lat: PUNE.lat + 0.0003, lng: PUNE.lng - 0.0002, accuracy: 5 }, 'area');
ok('two spots in the same area look the same: the exact spot cannot be worked out', near.lat === area.lat && near.lng === area.lng);

const d = G.distanceM(PUNE, DELHI);
ok('Pune to Delhi is about 1,170 km', d > 1150000 && d < 1190000, Math.round(d / 1000));
ok('distance reads plainly', G.distanceText(40) === 'right here' && G.distanceText(430) === '430 m away' && G.distanceText(2340) === '2.3 km away' && G.distanceText(d) === '1,173 km away', G.distanceText(d));

const now = Date.parse('2026-09-29T10:00:00Z');
ok('just now', G.agoText('2026-09-29T09:59:40Z', now) === 'just now');
ok('minutes, hours, days', G.agoText('2026-09-29T09:57:00Z', now) === '3 min ago' && G.agoText('2026-09-29T08:00:00Z', now) === '2 hours ago' && G.agoText('2026-09-27T10:00:00Z', now) === '2 days ago');
ok('stale after 30 minutes, not before', !G.isStale('2026-09-29T09:40:00Z', now) && G.isStale('2026-09-29T09:20:00Z', now));

const last = { ...PUNE, at: now };
ok('a new position is sent the first time', G.worthSending(null, PUNE, now));
ok('not for a 10 m wobble within two minutes', !G.worthSending(last, { lat: PUNE.lat + 0.00009, lng: PUNE.lng }, now + 30000));
ok('but after moving 100 m', G.worthSending(last, { lat: PUNE.lat + 0.0009, lng: PUNE.lng }, now + 30000));
ok('and every two minutes regardless', G.worthSending(last, PUNE, now + 120000));
ok('maps link is a plain search for the point', G.mapsUrl(18.5, 73.8) === 'https://www.google.com/maps/search/?api=1&query=18.5%2C73.8');
ok('two precisions: exact and area', G.PRECISIONS.join() === 'exact,area');
// How long to share, like Find My.
{
  const t0 = Date.parse('2026-10-04T10:00:00Z');
  ok('no end time means until you stop', G.shareUntil(undefined, t0) === null && G.shareUntil('', t0) === null);
  ok('an hour from now is accepted', +G.shareUntil('2026-10-04T11:00:00Z', t0) === Date.parse('2026-10-04T11:00:00Z'));
  ok('a time already gone, or under 5 minutes away, is refused', !!G.shareUntil('2026-10-04T09:00:00Z', t0).error && !!G.shareUntil('2026-10-04T10:02:00Z', t0).error);
  ok('more than a week is refused', !!G.shareUntil('2026-10-20T10:00:00Z', t0).error);
  ok('nonsense is refused', !!G.shareUntil('tonight', t0).error);
}
ok('the map on the screen is Google\'s plain embed, close in for exact', G.embedUrl(18.5, 73.8, 'exact') === 'https://maps.google.com/maps?q=18.5%2C73.8&z=16&output=embed');
ok('and zoomed out for area only, so the house is never centred', /&z=13&/.test(G.embedUrl(18.5, 73.8, 'area')));
ok('directions go to Google Maps, from wherever the phone is', G.directionsUrl(18.5, 73.8) === 'https://www.google.com/maps/dir/?api=1&destination=18.5%2C73.8');

if (fails.length) {
  console.error(`geotest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`geotest: ${pass}/${pass} checks pass`);
