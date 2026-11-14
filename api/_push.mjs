// Web Push plumbing (helper, not an endpoint). VAPID keys are generated once
// and kept in the database, so no environment configuration is needed.
// Sending is always fire-and-safe: a push failure never breaks the action
// that triggered it, and dead subscriptions are pruned as they 404/410.
// Loaded on demand: code paths that never send a notification (game
// engines, tests) must not depend on the push library being installed.
import { pushOptions } from './_safetyrules.mjs';
let webpush = null;
async function lib() {
  if (!webpush) webpush = (await import('web-push')).default;
  return webpush;
}

import { schemaOnce } from './_db.mjs';
import { pushKind, decide, capOrder, withFamily, morningText, validTz, PUSH_CAP } from './_pushrules.mjs';

let vapidReady = null;
let pushReady = false;
// Test seams: a fixed clock, and a stand-in for the push service. Production
// never sets these.
export const pushSeams = { now: null, send: null };
const nowOf = () => (pushSeams.now ? pushSeams.now() : Date.now());

// THE ONLY PLACES A PUSH IS EVER SENT. Any https address used to be taken,
// and every family alert then made this server POST to it: a way to point
// our server at anything, inside or outside, from a phone. A real browser
// subscription only ever lives on one of these push services.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com$/, /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com$/];
export function isPushEndpoint(v) {
  const s = String(v || '');
  if (s.length > 500) return false;
  let u;
  try { u = new URL(s); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return PUSH_HOSTS.some(re => re.test(u.hostname.toLowerCase()));
}

export async function ensurePushSchema(sql) {
  if (pushReady) return;
  await schemaOnce(() => pushTables(sql));
  pushReady = true;
}
async function pushTables(sql) {
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
  // ONE PHONE, EVERY FAMILY. A row used to belong to one membership, so a
  // woman in her own family and her mother's heard only the one she opened
  // last, and her mother's SOS could ring nobody. A row now belongs to the
  // person (the account) and the device, and a push to any family she is in
  // finds it. Rows saved before this are filled in from their member.
  await sql`alter table push_subs add column if not exists user_id uuid references users(id) on delete cascade`;
  await sql`alter table push_subs add column if not exists device_id text`;
  // The phone's own time zone, said each time the app opens: quiet hours
  // are on that clock.
  await sql`alter table push_subs add column if not exists tz text`;
  await sql`alter table push_subs add column if not exists seen_at timestamptz`;
  await sql`update push_subs s set user_id = m.user_id from members m
            where s.user_id is null and m.id = s.member_id and m.user_id is not null`;
  // Leaving one family must not silence the phone for the others: the link
  // to the membership is let go of, the row stays with the person.
  const fk = await sql`select confdeltype::text as d from pg_constraint
                       where conrelid = 'push_subs'::regclass and conname = 'push_subs_member_id_fkey'`;
  if (fk[0] && fk[0].d === 'c') {
    await sql`alter table push_subs alter column member_id drop not null`;
    await sql`alter table push_subs drop constraint push_subs_member_id_fkey`;
    await sql`alter table push_subs add constraint push_subs_member_id_fkey
              foreign key (member_id) references members(id) on delete set null`;
  }
  await sql`delete from push_subs where user_id is null and member_id is null`;
  await sql`create index if not exists push_subs_user on push_subs (user_id)`;
  await sql`create index if not exists push_subs_member on push_subs (member_id)`;
  // What a person chose: quiet hours and the six switches. One row per
  // person, not per family: a night is a night in every family.
  await sql`create table if not exists push_prefs (
    user_id uuid primary key references users(id) on delete cascade,
    quiet boolean not null default true,
    quiet_from int not null default 1320,
    quiet_to int not null default 420,
    kinds jsonb not null default '{}'::jsonb,
    tz text,
    updated_at timestamptz not null default now()
  )`;
  // What waited for the morning: a count, never the words.
  await sql`create table if not exists push_held (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    kind text not null,
    at timestamptz not null default now()
  )`;
  await sql`create index if not exists push_held_user on push_held (user_id, at)`;
  // A page that broke on someone's phone: what and where, nothing about who.
  await sql`create table if not exists client_errors (
    id uuid primary key default gen_random_uuid(),
    message text not null,
    where_at text,
    version text,
    viewport text,
    at timestamptz not null default now()
  )`;
  await sql`create index if not exists client_errors_at on client_errors (at)`;
  // A tap made with no network, sent later: the phone's own id for it, so
  // sending it twice is one tap.
  await sql`create table if not exists offline_taps (
    member_id uuid not null references members(id) on delete cascade,
    client_id text not null,
    at timestamptz not null default now(),
    primary key (member_id, client_id)
  )`;
}

export async function vapidPublicKey(sql) {
  if (vapidReady) return vapidReady;
  const wp = await lib();
  await ensurePushSchema(sql);
  let rows = await sql`select k, v from kv where k in ('vapid_pub', 'vapid_priv')`;
  let pub = null, priv = null;
  rows.forEach(r => { if (r.k === 'vapid_pub') pub = r.v; if (r.k === 'vapid_priv') priv = r.v; });
  if (!pub || !priv) {
    const keys = wp.generateVAPIDKeys();
    try {
      await sql`insert into kv (k, v) values ('vapid_pub', ${keys.publicKey}) on conflict (k) do nothing`;
      await sql`insert into kv (k, v) values ('vapid_priv', ${keys.privateKey}) on conflict (k) do nothing`;
    } catch (e) { /* raced another instance - reread below */ }
    rows = await sql`select k, v from kv where k in ('vapid_pub', 'vapid_priv')`;
    rows.forEach(r => { if (r.k === 'vapid_pub') pub = r.v; if (r.k === 'vapid_priv') priv = r.v; });
  }
  wp.setVapidDetails('mailto:anchit.tandon@gmail.com', pub, priv);
  vapidReady = pub;
  return pub;
}

// A chat someone muted (another stream's table): read by name, and only if
// it is there. Any shape with member_id; an end time in the past is not a mute.
async function mutedIn(sql, chatId, nowMs) {
  const out = new Set();
  if (!/^[0-9a-f-]{36}$/i.test(String(chatId || ''))) return out;
  try {
    const rows = await sql`select to_jsonb(t) as r from chat_mutes t where t.chat_id = ${chatId}`;
    for (const x of rows) {
      const r = x.r || {}, until = r.until || r.muted_until || r.until_at;
      if (r.member_id && !(until && new Date(until).getTime() <= nowMs)) out.add(String(r.member_id));
    }
  } catch (e) { /* no mute table yet */ }
  return out;
}
// The person's own zone: what they saved, else the phone that opened Parwah
// last. Not known: null, and nothing is held (a night is never guessed).
function zoneOf(pref, subs) {
  const t = validTz(pref && pref.tz);
  if (t) return t;
  const s = subs.filter(x => validTz(x.tz)).sort((a, b) => new Date(b.seen_at || 0) - new Date(a.seen_at || 0))[0];
  return s ? s.tz : null;
}
const prefOf = r => (r ? { quiet: r.quiet, from: r.quiet_from, to: r.quiet_to, kinds: r.kinds || {}, tz: r.tz } : null);
async function sendAll(sql, wp, list, opts) {
  // A row saved before the host rule is never sent to either.
  await Promise.allSettled(list.filter(x => isPushEndpoint(x.sub.endpoint)).map(({ sub: s, body }) =>
    (pushSeams.send || ((a, b, c) => wp.sendNotification(a, b, c)))({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, opts)
      .catch(async (e) => {
        // The push service says this phone is gone: the row goes too, so
        // "can be reached" stays true to what a push would find.
        const sc = e && e.statusCode;
        if (sc === 404 || sc === 410) { try { await sql`delete from push_subs where id = ${s.id}`; } catch (_) {} }
      })
  ));
}

// Send {title, body} to circle members' devices. except = member to skip
// (usually the person who did the thing). only = restrict to one member.
// EVERYTHING A PERSON CHOSE IS APPLIED HERE, the one place a push is sent:
// their quiet hours on their own clock, the kinds they turned off, a chat
// they muted. An SOS and the other urgent kinds go to every device at once.
// Someone marked as no longer with us is never pushed: not an SOS, not a
// reminder, nothing, whichever module asks. The one exception is the note
// that tells a person on Parwah they were marked, so a mistake can be undone
// (evenRemembered, api/_remember.mjs). The flag is read through the row, so
// this works on a database where no module has made that column yet.
export async function pushCircle(sql, circleId, payload, { except = null, only = null, evenRemembered = false } = {}) {
  try {
    const wp = pushSeams.send ? null : await lib();
    if (wp) await vapidPublicKey(sql); else await ensurePushSchema(sql);
    const nowMs = nowOf();
    const info = pushKind(payload);
    // Every device of every person in this family: by the person, so a
    // phone last opened on another family still rings for this one.
    const found = await sql`
      select distinct on (s.id) s.id, s.endpoint, s.p256dh, s.auth, s.created_at, s.tz, s.seen_at,
             m.id as member_id, m.user_id, coalesce(m.user_id::text, m.id::text) as owner
      from members m join push_subs s on (s.user_id is not null and s.user_id = m.user_id) or s.member_id = m.id
      where m.circle_id = ${circleId}
        and (${except}::uuid is null or m.id <> ${except})
        and (${only}::uuid is null or m.id = ${only})
        and (${!!evenRemembered} or not coalesce((to_jsonb(m)->>'remembered')::boolean, false))
      order by s.id`;
    const users = [...new Set(found.filter(s => s.user_id).map(s => s.user_id))];
    const prefs = new Map(), fams = new Map();
    let circle = null;
    if (users.length) {
      (await sql`select user_id, quiet, quiet_from, quiet_to, kinds, tz from push_prefs where user_id = any(${users}::uuid[])`)
        .forEach(r => prefs.set(r.user_id, prefOf(r)));
      (await sql`select user_id, count(*)::int as n from members where user_id = any(${users}::uuid[]) group by user_id`)
        .forEach(r => fams.set(r.user_id, r.n));
      circle = (await sql`select name, code from circles where id = ${circleId}`)[0] || null;
    }
    const muted = info.through ? new Set() : await mutedIn(sql, payload.chatId, nowMs);
    const byOwner = new Map();
    for (const s of found) { if (!byOwner.has(s.owner)) byOwner.set(s.owner, []); byOwner.get(s.owner).push(s); }
    let subs = [];
    for (const [, list] of byOwner) {
      const uid = list[0].user_id, pref = uid ? prefs.get(uid) : null, zone = zoneOf(pref, list);
      // No zone known: this person's night is not known, so nothing waits.
      const what = decide(info, zone ? pref : { ...(pref || {}), quiet: false }, nowMs, zone, { muted: muted.has(String(list[0].member_id)) });
      if (what === 'send') subs = subs.concat(list);
      else if (what === 'hold' && uid) {
        try { await sql`insert into push_held (user_id, circle_id, kind, at) values (${uid}, ${circleId}, ${info.kind}, ${new Date(nowMs)})`; } catch (e) {}
      }
    }
    // Urgent: everyone, every device. Otherwise a cap, dealt so every
    // member gets at least one device before anyone gets a second.
    if (!info.through) subs = capOrder(subs, PUSH_CAP);
    // An emergency is sent as one: high urgency (delivered at once, even to
    // a phone saving battery), kept for a day if the phone is off, and marked
    // so the phone keeps it on screen and keeps buzzing until it is seen.
    // Each emergency has a topic of its own, so nothing takes an SOS's
    // place while it waits to be delivered (api/_safetyrules.mjs).
    // Ringing a lost phone: delivered at once, but only worth anything for
    // the two minutes it rings, and never in the SOS's place on the screen.
    const how = pushOptions(payload);
    const body = JSON.stringify({ title: payload.title, body: payload.body || '', url: payload.url || '/', urgent: how.urgent, ring: how.ring, tag: how.tag || undefined });
    const opts = how.opts;
    // Someone in two families is told which one this is from, and a tap
    // opens that family.
    const base = JSON.parse(body);
    const forSub = s => JSON.stringify({ ...base, body: withFamily(base.body, circle && circle.name, s.user_id ? fams.get(s.user_id) : 1), family: circle ? circle.code : undefined });
    await sendAll(sql, wp, subs.map(s => ({ sub: s, body: forSub(s) })), opts);
  } catch (e) { /* never let notifications break the action */ }
}

// THE MORNING LINE. What waited through someone's night is told once their
// quiet hours have ended: one push, counts only ("6 messages in Family").
// Each person's rows are claimed by deleting them, so two timers never send
// it twice. Anything older than a day is forgotten, not announced.
export async function pushMorning(sql, nowMs = nowOf()) {
  await ensurePushSchema(sql);
  await sql`delete from push_held where at < ${new Date(nowMs - 24 * 3600000)}`;
  const who = await sql`select distinct user_id from push_held limit 500`;
  let sent = 0;
  for (const w of who) {
    const pref = prefOf((await sql`select quiet, quiet_from, quiet_to, kinds, tz from push_prefs where user_id = ${w.user_id}`)[0]);
    const subs = await sql`select id, endpoint, p256dh, auth, tz, seen_at from push_subs where user_id = ${w.user_id}`;
    const zone = zoneOf(pref, subs);
    if (zone && decide({ kind: 'other' }, pref, nowMs, zone) === 'hold') continue;   // still their night
    const rows = await sql`with gone as (delete from push_held where user_id = ${w.user_id} returning kind, circle_id)
                           select g.kind, c.name as family, count(*)::int as n from gone g join circles c on c.id = g.circle_id group by g.kind, c.name`;
    const text = morningText(rows);
    if (!text || !subs.length) continue;
    const wp = pushSeams.send ? null : await lib();
    if (wp) await vapidPublicKey(sql);
    const body = JSON.stringify({ title: text.title, body: text.body, url: '/#notifs', urgent: false, ring: false });
    await sendAll(sql, wp, subs.map(s => ({ sub: s, body })), { TTL: 3600 });
    sent++;
  }
  return sent;
}
// Opening Parwah is seeing it: nothing is announced afterwards.
export async function pushSeen(sql, userId) {
  if (!userId) return;
  try { await sql`delete from push_held where user_id = ${userId}`; } catch (e) {}
}

// AFTER EVERY RUN OF THE TIMER (one call from runTick): when it last ran,
// which family the next run starts with, and the morning line.
// The record is two rows in kv: last_tick_at and tick_next.
export async function afterTick(sql, circles, done) {
  await ensurePushSchema(sql);
  const at = new Date(nowOf()).toISOString();
  await sql`insert into kv (k, v) values ('last_tick_at', ${at}) on conflict (k) do update set v = excluded.v`;
  // The run stopped at its time budget: the next one starts where this one
  // stopped, so the families at the end of the list are never always last.
  const list = circles || [];
  if (list.length && done < list.length) {
    await sql`insert into kv (k, v) values ('tick_next', ${String(list[done])}) on conflict (k) do update set v = excluded.v`;
  }
  return pushMorning(sql);
}
export async function tickCursor(sql) {
  try { const r = await sql`select v from kv where k = 'tick_next'`; return r[0] ? r[0].v : null; } catch (e) { return null; }
}
// When the timer last ran: the tick_runs table if another module keeps one
// (any timestamp column in it), else our own kv row. → ISO string or null.
export async function lastTickAt(sql) {
  let best = null;
  const take = v => { const ms = v ? new Date(v).getTime() : NaN; if (Number.isFinite(ms) && (best === null || ms > best)) best = ms; };
  try {
    const cols = await sql`select column_name from information_schema.columns
                           where table_schema = current_schema() and table_name = 'tick_runs' and data_type like 'timestamp%'`;
    if (cols.length) {
      const rows = await sql`select to_jsonb(t) as r from tick_runs t order by t.ctid desc limit 200`;
      for (const x of rows) for (const c of cols) take(x.r && x.r[c.column_name]);
    }
  } catch (e) { /* no such table */ }
  try { const r = await sql`select v from kv where k = 'last_tick_at'`; take(r[0] && r[0].v); } catch (e) { /* no kv yet */ }
  return best === null ? null : new Date(best).toISOString();
}
