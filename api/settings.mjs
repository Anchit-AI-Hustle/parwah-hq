// Device alerts and Ekta's provider keys, behind one function (see diag.mjs
// for why). Routed by ?area= so each area keeps its own module.
//   /api/settings?area=push → Web Push registration
//   /api/settings?area=keys → AI provider key vault
import pushApi from './_pushapi.mjs';
import keysApi from './_keysapi.mjs';

export default async function handler(req, res) {
  const area = String((req.query && req.query.area) || '');
  if (area === 'keys') return keysApi(req, res);
  if (area === 'push') return pushApi(req, res);
  return res.status(400).json({ ok: false, error: 'Unknown settings area' });
}
