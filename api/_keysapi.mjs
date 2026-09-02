// Ekta's brain — provider keys for the AI cascade, managed from inside the
// app by the family (every member is an equal admin). Values are write-only:
// GET reports presence only, never the key. Env-configured keys cannot be
// overwritten from here.
// GET  /api/settings?area=keys&circle=CODE&member=UUID → { ok, providers }
// POST /api/settings?area=keys {code, memberId, action:'set'|'clear', provider, key?}
import { db, ensureSchema, requireMember, serverError } from './_db.mjs';
import { PROVIDERS, providerKeys, ensureKv, providerRowKey } from './_keys.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensureKv(sql); }
  catch (e) { return serverError(res, e, 'keysapi'); }

  try {
    const q = req.query || {};
    const body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const g = await requireMember(sql, code, memberId);
    if (g.error) return res.status(g.status).json({ ok: false, error: g.error });
    const circle = g.circle, me = g.me;

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
      await sql`insert into kv (k, v) values (${providerRowKey(provider, circle.id)}, ${key})
                on conflict (k) do update set v = ${key}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + " updated Ekta's " + provider + ' key 🔑'})`;
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'clear') {
      await sql`delete from kv where k = ${providerRowKey(provider, circle.id)}`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + " removed Ekta's " + provider + ' key'})`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return serverError(res, e, 'keysapi');
  }
}
