// Device notifications - Web Push registration, and what a person chose.
// GET  /api/settings?area=push        → { ok, publicKey }  (VAPID, for subscribe)
// POST /api/settings?area=push {code, memberId, action, ...}
//   subscribe {sub, device, tz}   this phone, for this person, in every family they are in
//   unsubscribe {sub}
//   prefs_get                     quiet hours and the six switches
//   prefs_set {prefs, tz}
//   reach                         adults: who can be reached, and who has nobody to hear an SOS
//   selfcheck {endpoint}          adults: "Parwah is working", line by line
// POST {action:'report', ...}     a page that broke: what and where, nothing about who (no sign-in)
import { db, ensureSchema, isUuid, requireMember, rateLimit, limitKey } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { ensurePushSchema, vapidPublicKey, isPushEndpoint, pushSeen, lastTickAt } from './_push.mjs';
import { cleanPrefs, minsToHHMM, PUSH_KINDS, PUSH_KIND_WORDS, cleanReport, cleanDevice, REPORT_KEEP_DAYS } from './_pushrules.mjs';
import { validTz, reqTz } from './_recur.mjs';
import { afterlossIsAdult } from './_afterloss.mjs';
import { providerKeys, MODEL_PROVIDERS } from './_keys.mjs';
import { dialConfig } from './_sosdial.mjs';

// What the screen needs to draw the choices: times as HH:MM, and the words.
function prefsOut(row) {
  const p = cleanPrefs(row ? { quiet: row.quiet, from: row.quiet_from, to: row.quiet_to, kinds: row.kinds || {} } : null);
  return { quiet: p.quiet, from: minsToHHMM(p.from), to: minsToHHMM(p.to), kinds: p.kinds,
           words: PUSH_KINDS.map(k => ({ kind: k, label: PUSH_KIND_WORDS[k].label, hint: PUSH_KIND_WORDS[k].hint })) };
}

// A page that broke. No sign-in (the sign-in screen can break too), so it is
// counted per device and capped for everyone; what is kept names nobody.
async function report(sql, req, res) {
  const r = cleanReport(req.body);
  if (!r) return res.status(200).json({ ok: true, kept: false });
  const mine = await rateLimit(sql, 'cerr', limitKey(req), 5, 600, { failClosed: true });
  const all = mine && await rateLimit(sql, 'cerr_all', 'all', 600, 3600, { failClosed: true });
  if (!all) return res.status(200).json({ ok: true, kept: false });
  await sql`insert into client_errors (message, where_at, version, viewport) values (${r.message}, ${r.where || null}, ${r.version || null}, ${r.viewport || null})`;
  await sql`delete from client_errors where at < now() - make_interval(days => ${REPORT_KEEP_DAYS})`;
  return res.status(200).json({ ok: true, kept: true });
}

// Counts only, for /api/diag: how many, and how many different ones.
export async function errorCounts(sql) {
  await ensurePushSchema(sql);
  const r = (await sql`select count(*) filter (where at > now() - interval '1 day')::int as day,
                              count(*)::int as kept,
                              count(distinct message) filter (where at > now() - interval '1 day')::int as kinds_day
                       from client_errors where at > now() - make_interval(days => ${REPORT_KEEP_DAYS})`)[0];
  return { last_24h: r.day, different_last_24h: r.kinds_day, kept_14d: r.kept };
}

const adultOf = (m) => afterlossIsAdult({ user_id: m.user_id, dob: m.dob });

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
    if (body.action === 'report') return report(sql, req, res);
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, body.code, body.memberId, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const me = [_g.me];
    const uid = me[0].user_id || null;

    // ---------- what this person chose ----------
    if (body.action === 'prefs_get') {
      const row = uid ? (await sql`select quiet, quiet_from, quiet_to, kinds from push_prefs where user_id = ${uid}`)[0] : null;
      await pushSeen(sql, uid);
      return res.status(200).json({ ok: true, prefs: prefsOut(row) });
    }
    if (body.action === 'prefs_set') {
      if (!uid) return res.status(400).json({ ok: false, error: 'Sign in to choose this.' });
      const p = cleanPrefs(body.prefs);
      const tz = validTz(body.tz) || reqTz(req);
      await sql`insert into push_prefs (user_id, quiet, quiet_from, quiet_to, kinds, tz, updated_at)
                values (${uid}, ${p.quiet}, ${p.from}, ${p.to}, ${JSON.stringify(p.kinds)}::jsonb, ${tz}, now())
                on conflict (user_id) do update set quiet = excluded.quiet, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to,
                  kinds = excluded.kinds, tz = coalesce(excluded.tz, push_prefs.tz), updated_at = now()`;
      const row = (await sql`select quiet, quiet_from, quiet_to, kinds from push_prefs where user_id = ${uid}`)[0];
      return res.status(200).json({ ok: true, prefs: prefsOut(row) });
    }

    // ---------- can be reached ----------
    // An adult sees, for each person on Parwah, whether an alert would find
    // a phone, and who is looked after with no adult who would hear an SOS.
    if (body.action === 'reach' || body.action === 'selfcheck') {
      const ms = await sql`
        select m.id, m.name, m.role, m.user_id, to_char(m.dob, 'YYYY-MM-DD') as dob,
               coalesce((to_jsonb(m)->>'remembered')::boolean, false) as remembered,
               (to_jsonb(m)->>'checkin_by') is not null as checks_in,
               exists (select 1 from push_subs s where (s.user_id is not null and s.user_id = m.user_id) or s.member_id = m.id) as reachable
        from members m where m.circle_id = ${circle.id}`;
      const mine = ms.find(m => m.id === me[0].id);
      const adult = !!mine && adultOf(mine);
      if (body.action === 'reach') {
        if (!adult) return res.status(200).json({ ok: true, adult: false, members: [], uncovered: [] });
        const live = ms.filter(m => !m.remembered);
        const members = live.filter(m => m.user_id).map(m => ({ id: m.id, name: m.name, reachable: m.reachable }));
        const uncovered = live.filter(m => m.id !== me[0].id && (m.role === 'parent' || m.checks_in))
          .filter(l => !live.some(a => a.id !== l.id && adultOf(a) && a.reachable))
          .map(l => ({ id: l.id, name: l.name }));
        return res.status(200).json({ ok: true, adult: true, members, uncovered, me: !!mine.reachable });
      }
      // "Parwah is working": each line is a fact the screen puts in words.
      if (!adult) return res.status(403).json({ ok: false, error: 'This check is for the adults in the family.' });
      const ep = String(body.endpoint || '');
      const known = !!(ep && isPushEndpoint(ep) && (await sql`select 1 as x from push_subs where endpoint = ${ep}
                        and ((${uid}::uuid is not null and user_id = ${uid}) or member_id = ${me[0].id})`)[0]);
      const at = await lastTickAt(sql);
      let ekta = false;
      try { const k = await providerKeys(sql, circle.id); ekta = MODEL_PROVIDERS.some(p => !!k.keys[p]); } catch (e) {}
      return res.status(200).json({ ok: true, adult: true,
        push: { known },
        timer: { last_tick_at: at, age_min: at ? Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000)) : null },
        ekta: ekta ? 'ready' : 'resting',
        calls: !!dialConfig().on,
        version: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null });
    }

    const sub = body.sub || {};
    const endpoint = String(sub.endpoint || '');
    if (!isPushEndpoint(endpoint)) {
      return res.status(400).json({ ok: false, error: 'Bad subscription' });
    }

    if (body.action === 'subscribe') {
      const keys = sub.keys || {};
      const p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
      if (!p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
        return res.status(400).json({ ok: false, error: 'Bad subscription' });
      }
      const device = cleanDevice(body.device), tz = validTz(body.tz) || reqTz(req);
      // ONE ROW PER PERSON PER DEVICE. The row belongs to the account, so
      // it rings for every family this person is in, not only the one that
      // was open when alerts were turned on. member_id stays as "last
      // opened here" and for accounts from before sign-in.
      // A browser that was given a new address replaces its old row.
      if (uid && device) await sql`delete from push_subs where user_id = ${uid} and device_id = ${device} and endpoint <> ${endpoint}`;
      await sql`insert into push_subs (member_id, user_id, device_id, endpoint, p256dh, auth, tz, seen_at)
                values (${me[0].id}, ${uid}, ${device}, ${endpoint}, ${p256dh}, ${auth}, ${tz}, now())
                on conflict (endpoint) do update set member_id = excluded.member_id, user_id = excluded.user_id,
                  device_id = coalesce(excluded.device_id, push_subs.device_id), p256dh = excluded.p256dh, auth = excluded.auth,
                  tz = coalesce(excluded.tz, push_subs.tz), seen_at = now()
                where (${uid}::uuid is not null and (push_subs.user_id = ${uid}
                        or push_subs.member_id in (select id from members where user_id = ${uid})))
                   or (${uid}::uuid is null and push_subs.user_id is null and push_subs.member_id = ${me[0].id})`;
      // A device already registered to someone else stays theirs: taking
      // it over would send their alerts here. Your own families share it,
      // which is the point.
      const mine = await sql`select 1 as x from push_subs where endpoint = ${endpoint}
                             and ((${uid}::uuid is not null and user_id = ${uid}) or (${uid}::uuid is null and member_id = ${me[0].id}))`;
      if (!mine[0]) return res.status(409).json({ ok: false, error: 'This device gets alerts for someone else. They need to turn them off first.' });
      // Opening Parwah is seeing what waited: no morning line after this.
      await pushSeen(sql, uid);
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'unsubscribe') {
      // Only your own device: the address alone used to delete anyone's.
      await sql`delete from push_subs where endpoint = ${endpoint}
                and ((${uid}::uuid is not null and (user_id = ${uid} or member_id in (select id from members where user_id = ${uid})))
                  or (${uid}::uuid is null and user_id is null and member_id = ${me[0].id}))`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}
