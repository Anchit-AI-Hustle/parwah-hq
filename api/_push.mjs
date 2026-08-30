// Web Push plumbing (helper, not an endpoint). VAPID keys are generated once
// and kept in the database, so no environment configuration is needed.
// Sending is always fire-and-safe: a push failure never breaks the action
// that triggered it, and dead subscriptions are pruned as they 404/410.
import webpush from 'web-push';

let vapidReady = null;

export async function ensurePushSchema(sql) {
  await sql`create table if not exists kv (
    k text primary key,
    v text not null
  )`;
  await sql`create table if not exists push_subs (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references members(id) on delete cascade,
    endpoint text unique not null,
    p256dh text not null,
    auth text not null,
    created_at timestamptz not null default now()
  )`;
}

export async function vapidPublicKey(sql) {
  if (vapidReady) return vapidReady;
  await ensurePushSchema(sql);
  let rows = await sql`select k, v from kv where k in ('vapid_pub', 'vapid_priv')`;
  let pub = null, priv = null;
  rows.forEach(r => { if (r.k === 'vapid_pub') pub = r.v; if (r.k === 'vapid_priv') priv = r.v; });
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    try {
      await sql`insert into kv (k, v) values ('vapid_pub', ${keys.publicKey}) on conflict (k) do nothing`;
      await sql`insert into kv (k, v) values ('vapid_priv', ${keys.privateKey}) on conflict (k) do nothing`;
    } catch (e) { /* raced another instance — reread below */ }
    rows = await sql`select k, v from kv where k in ('vapid_pub', 'vapid_priv')`;
    rows.forEach(r => { if (r.k === 'vapid_pub') pub = r.v; if (r.k === 'vapid_priv') priv = r.v; });
  }
  webpush.setVapidDetails('mailto:anchit.tandon@gmail.com', pub, priv);
  vapidReady = pub;
  return pub;
}

// Send {title, body} to circle members' devices. except = member to skip
// (usually the person who did the thing). only = restrict to one member.
export async function pushCircle(sql, circleId, payload, { except = null, only = null } = {}) {
  try {
    await vapidPublicKey(sql);
    const subs = await sql`
      select s.id, s.endpoint, s.p256dh, s.auth
      from push_subs s join members m on m.id = s.member_id
      where m.circle_id = ${circleId}
        and (${except}::uuid is null or s.member_id <> ${except})
        and (${only}::uuid is null or s.member_id = ${only})
      limit 60`;
    const body = JSON.stringify({ title: payload.title, body: payload.body || '', url: payload.url || '/app/' });
    await Promise.allSettled(subs.map(s =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 })
        .catch(async (e) => {
          const sc = e && e.statusCode;
          if (sc === 404 || sc === 410) { try { await sql`delete from push_subs where id = ${s.id}`; } catch (_) {} }
        })
    ));
  } catch (e) { /* never let notifications break the action */ }
}
