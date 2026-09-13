// Ekta's brain — provider keys for the AI cascade, managed from inside the
// app by the family (every member is an equal admin). Values are write-only:
// GET reports presence only, never the key. Env-configured keys cannot be
// overwritten from here.
// GET  /api/keys?circle=CODE&member=UUID → { ok, providers: {p: {set, src}} }
// POST /api/keys {code, memberId, action:'set'|'clear', provider, key?}
import { db, ensureSchema, circleByCode, isUuid , requireMember} from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { PROVIDERS, providerKeys, ensureKv, circleKeyName } from './_keys.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureKv(sql); }
  catch (e) { return failDb(res, e); }

  try {
    const q = req.query || {};
    const body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, code, memberId, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const meRow = [_g.me];
    const me = meRow[0];

    if (req.method === 'GET') {
      const { keys, src } = await providerKeys(sql, circle.id);
      const providers = {};
      // presence only — the key value never leaves the server
      PROVIDERS.forEach(p => { providers[p] = { set: !!keys[p], src: src[p] }; });
      return res.status(200).json({ ok: true, providers });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    const provider = String(body.provider || '');
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ ok: false, error: 'Unknown provider' });
    const { src } = await providerKeys(sql, circle.id);
    if (src[provider] === 'env') {
      return res.status(400).json({ ok: false, error: 'This provider is configured on the server itself and cannot be changed from the app' });
    }

    if (body.action === 'set') {
      const key = String(body.key || '').trim();
      if (!/^[A-Za-z0-9_\-.:]{12,300}$/.test(key)) {
        return res.status(400).json({ ok: false, error: 'That does not look like an API key — paste it exactly as the provider shows it' });
      }
      // Written under THIS circle's name, so one family can never set over
      // another's key or spend its credit.
      const slot = circleKeyName(circle.id, provider);
      await sql`insert into kv (k, v) values (${slot}, ${key})
                on conflict (k) do update set v = ${key}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + " updated Ekta's " + provider + ' key 🔑'})`;
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'clear') {
      // Only this circle's own key can be cleared. A deployment-wide key an
      // operator set is not one family's to remove.
      if (src[provider] === 'shared') {
        return res.status(403).json({ ok: false, error: 'That key was set up for the whole deployment, so it cannot be removed from here' });
      }
      await sql`delete from kv where k = ${circleKeyName(circle.id, provider)}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + " removed Ekta's " + provider + ' key'})`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}
