// Device alerts and Ekta's provider keys, behind one function (see diag.mjs
// for why). Routed by ?area= so each area keeps its own module.
//   /api/settings?area=push → Web Push registration
//   /api/settings?area=keys  → AI provider key vault
//   /api/settings?area=coins → the family's coin pot and its ledger
//   /api/settings?area=plan  → pricing (INR + USD) and reservations
//   /api/settings?area=day   → today's muhurat for your city + horoscopes
//   /api/settings?area=pin   → an Indian PIN code → locality, district, state
//   /api/settings?area=location → family and group location sharing (consent first)
import pushApi from './_pushapi.mjs';
import keysApi from './_keysapi.mjs';
import coinsApi from './_coinsapi.mjs';
import planApi from './_planapi.mjs';
import dayApi from './_dayapi.mjs';
import pinApi from './_pinapi.mjs';
import locationApi from './_locationapi.mjs';

export default async function handler(req, res) {
  const area = String((req.query && req.query.area) || '');
  if (area === 'keys') return keysApi(req, res);
  if (area === 'push') return pushApi(req, res);
  if (area === 'coins') return coinsApi(req, res);
  if (area === 'plan') return planApi(req, res);
  if (area === 'day') return dayApi(req, res);
  if (area === 'pin') return pinApi(req, res);
  if (area === 'location') return locationApi(req, res);
  return res.status(400).json({ ok: false, error: 'Unknown settings area' });
}
