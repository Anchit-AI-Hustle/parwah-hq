// Device notifications - Web Push registration.
// GET  /api/push                     → { ok, publicKey }  (VAPID, for subscribe)
// POST /api/push {code, memberId, action:'subscribe'|'unsubscribe', sub}
import { db, ensureSchema, circleByCode, isUuid , requireMember} from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { ensurePushSchema, vapidPublicKey } from './_push.mjs';

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); await ensurePushSchema(sql); }
  catch (e) { return failDb(res, e); }

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
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, body.code, body.memberId, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const me = [_g.me];

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
    return fail(res, e);
  }
}
