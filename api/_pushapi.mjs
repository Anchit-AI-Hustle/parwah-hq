// Device notifications — Web Push registration.
// GET  /api/push                     → { ok, publicKey }  (VAPID, for subscribe)
// POST /api/push {code, memberId, action:'subscribe'|'unsubscribe', sub}
import { db, ensureSchema, circleByCode, isUuid } from './_db.mjs';
import { ensurePushSchema, vapidPublicKey } from './_push.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensurePushSchema(sql); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }

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
    const circle = await circleByCode(sql, body.code);
    if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
    if (!isUuid(body.memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const me = await sql`select id from members where id = ${body.memberId} and circle_id = ${circle.id}`;
    if (!me[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });

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
      await sql`delete from push_subs where endpoint = ${endpoint}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
