// Device notifications — Web Push registration.
// GET  /api/push                     → { ok, publicKey }  (VAPID, for subscribe)
// POST /api/push {code, memberId, action:'subscribe'|'unsubscribe', sub}
import { db, ensureSchema, requireMember, serverError } from './_db.mjs';
import { ensurePushSchema, vapidPublicKey } from './_push.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensurePushSchema(sql); }
  catch (e) { return serverError(res, e, 'pushapi'); }

  try {
    if (req.method === 'GET') {
      const publicKey = await vapidPublicKey(sql);
      return res.status(200).json({ ok: true, publicKey });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }
    const body = req.body || {};
    const g = await requireMember(sql, body.code, body.memberId);
    if (g.error) return res.status(g.status).json({ ok: false, error: g.error });
    const me = [g.me];

    const sub = body.sub || {};
    const endpoint = String(sub.endpoint || '');
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 500) {
      return res.status(400).json({ ok: false, error: 'Bad subscription' });
    }

    if (body.action === 'subscribe') {
      const keys = sub.keys || {};
      const p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
      if (!p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
        return res.status(400).json({ ok: false, error: 'Bad subscription' });
      }
      await sql`insert into push_subs (member_id, endpoint, p256dh, auth)
                values (${me[0].id}, ${endpoint}, ${p256dh}, ${auth})
                on conflict (endpoint) do update set member_id = ${me[0].id}, p256dh = ${p256dh}, auth = ${auth}`;
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'unsubscribe') {
      // Only this member's own registration. Deleting by endpoint alone let
      // anyone who had seen an endpoint silence somebody else's phone — and
      // an SOS is the thing that arrives on it.
      await sql`delete from push_subs where endpoint = ${endpoint} and member_id = ${me[0].id}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return serverError(res, e, 'pushapi');
  }
}
