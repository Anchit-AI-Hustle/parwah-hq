// THE DOORS OF THE ACCOUNT, behind /api/auth (no function of its own).
//
// Sign-in stays a mobile number and a 4-number PIN: no SMS. What this file
// adds around that:
//   - the PIN lock escalates (15 minutes, 1 hour, 24 hours) and a phone
//     that has signed in before is never locked out by a stranger's tries;
//   - a sign-in on a new phone tells the owner's other phones, with "Not me";
//   - a Devices list, with sign out per device;
//   - "My activity": what was seen or changed about me;
//   - a recovery contact, who can let me back in;
//   - download my data, and delete my account with a 7-day way back.
//
//   POST /api/auth {action:'account_state'}                 (session)
//   POST {action:'device_signout', sid}
//   POST {action:'alert_ok' | 'alert_notme', alertId}
//   POST {action:'reset_veto', resetId}
//   POST {action:'recovery_set', contactUserId} / {action:'recovery_clear'}
//   POST {action:'activity'}
//   POST {action:'export_me'}
//   POST {action:'delete_me', pin, removePosts} / {action:'delete_me_undo'}
import { createHash, randomInt } from 'node:crypto';
import { schemaOnce, isUuid, rateLimit, sessionUser } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { verifyPin, hashPin, newToken, tokenHash, MAX_TRIES, SESSION_DAYS } from './_auth.mjs';
import { isAdultMember, standingOf, todayIn, lockPlan, lockWords, deviceName, UNDO_DAYS, RESET_VETO_MINUTES } from './_standingrules.mjs';

const sha = v => createHash('sha256').update(String(v)).digest('hex');

let ready = false;
export async function ensureStandingSchema(sql) {
  if (ready) return;
  await schemaOnce(() => standingTables(sql));
  ready = true;
}
async function standingTables(sql) {
  // ---- the account
  await sql`alter table users add column if not exists must_change_pin boolean not null default false`;
  await sql`alter table users add column if not exists recovery_user uuid references users(id) on delete set null`;
  await sql`alter table users add column if not exists delete_at timestamptz`;
  await sql`alter table users add column if not exists delete_posts boolean not null default false`;
  await sql`alter table sessions add column if not exists sid uuid not null default gen_random_uuid()`;
  await sql`alter table sessions add column if not exists device_hash text`;
  await sql`alter table sessions add column if not exists ua text`;
  // Wrong tries, counted per mobile number (k = 'n:' + hash) or, for a
  // phone that has signed in before, per that phone (k = 'd:' ...). A
  // number nobody has registered is counted the same way, so the reply to
  // a guess says nothing about whether the number has an account.
  await sql`create table if not exists pin_locks (
    k text primary key,
    tries integer not null default 0,
    locked_until timestamptz,
    level integer not null default 0,
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists user_devices (
    user_id uuid not null references users(id) on delete cascade,
    device_hash text not null,
    name text,
    first_seen timestamptz not null default now(),
    last_used timestamptz not null default now(),
    primary key (user_id, device_hash)
  )`;
  await sql`create table if not exists account_alerts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    kind text not null,
    sid uuid,
    device_hash text,
    text text not null,
    status text not null default 'open',
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists account_alerts_user on account_alerts (user_id, status, created_at desc)`;
  await sql`create table if not exists account_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    kind text not null,
    text text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists account_events_user on account_events (user_id, created_at desc)`;
  // ---- letting someone back in
  await sql`alter table pin_resets add column if not exists say_code text`;
  await sql`alter table pin_resets add column if not exists code_tries integer not null default 0`;
  await sql`alter table pin_resets add column if not exists veto_until timestamptz`;
  // ---- standing in a family
  // The same column, in the same words, as api/_remember.mjs makes.
  await sql`alter table members add column if not exists remembered boolean not null default false`;
  await sql`alter table members add column if not exists adult_confirmed boolean`;
  await sql`alter table members add column if not exists adult_confirmed_by uuid references members(id) on delete set null`;
  await sql`alter table members add column if not exists see_phone text`;
  await sql`alter table members add column if not exists see_birth text`;
  await sql`alter table members add column if not exists hidden_fields jsonb`;
  await sql`alter table members add column if not exists claim_review boolean not null default false`;
  await sql`alter table circles add column if not exists delete_at timestamptz`;
  // "This is me": the person joining says the family already added them.
  await sql`alter table join_requests add column if not exists wants_claim boolean not null default false`;
  // Things two (or all) adults decide together: letting the code be enough,
  // removing someone who is on Parwah, deleting the family.
  await sql`create table if not exists standing_asks (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    kind text not null,
    target_member uuid references members(id) on delete cascade,
    asked_by uuid references members(id) on delete cascade,
    status text not null default 'pending',
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '7 days',
    decided_at timestamptz
  )`;
  await sql`create index if not exists standing_asks_circle on standing_asks (circle_id, status)`;
  await sql`create table if not exists standing_votes (
    ask_id uuid not null references standing_asks(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    yes boolean not null,
    at timestamptz not null default now(),
    primary key (ask_id, member_id)
  )`;
  // A change to someone's place in the tree, kept so they can undo it.
  await sql`create table if not exists tree_edits (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    by_member uuid references members(id) on delete set null,
    people uuid[] not null,
    changes jsonb not null,
    note text,
    created_at timestamptz not null default now(),
    undone_at timestamptz
  )`;
  await sql`create index if not exists tree_edits_circle on tree_edits (circle_id, created_at desc)`;
  // One row of a table, as JSON, for "Download my data". The table and the
  // column come from the database's own list of foreign keys to members,
  // never from a request, and are quoted as names (%I).
  await sql`create or replace function parwah_rows_for(tbl text, col text, ids uuid[], lim integer)
            returns setof jsonb language plpgsql as $fn$
            begin
              return query execute format('select to_jsonb(t) from %I t where %I = any($1) limit %s', tbl, col, lim) using ids;
            end $fn$`;
}

// ---- small helpers --------------------------------------------------------
// The phone's own id: random, made by the app, kept on the phone. Only its
// hash is stored, and only a long random value counts.
export function deviceHashOf(v) {
  const s = typeof v === 'string' ? v : '';
  return /^[A-Za-z0-9_-]{20,90}$/.test(s) ? sha('dev:' + s) : null;
}
export function uaOf(req) {
  const h = (req && req.headers) || {};
  return String(h['user-agent'] || h['User-Agent'] || '').slice(0, 300);
}
// A reply that must not say, by how long it took, whether the number is
// registered waits until at least this long has passed.
export async function padTo(t0, ms) {
  const left = ms - (Date.now() - t0);
  if (left > 0) await new Promise(r => setTimeout(r, left));
}
export function sayCode() { return String(randomInt(10, 100)); }

export async function logEvent(sql, userId, kind, text) {
  if (!userId) return;
  try { await sql`insert into account_events (user_id, kind, text) values (${userId}, ${kind}, ${String(text).slice(0, 300)})`; } catch (e) {}
}
// Every phone this person is signed in to Parwah on, whichever family the
// alert was turned on in. A person who has passed away is never pushed.
export async function pushUser(sql, userId, payload) {
  try {
    const ms = await sql`select id, circle_id from members where user_id = ${userId} and not remembered limit 30`;
    for (const m of ms) await pushCircle(sql, m.circle_id, payload, { only: m.id });
  } catch (e) { /* a notice never breaks the action */ }
}

// Everyone in a family, with what the adult rule needs.
export async function standingRows(sql, circleId) {
  return await sql`
    select m.id, m.name, m.user_id, m.dob, m.role, m.relation, m.adult_confirmed, m.spouse_id, m.parent_id, m.remembered,
           m.user_id is not null as on_app,
           exists (select 1 from members c where c.parent_id = m.id) as has_child
    from members m where m.circle_id = ${circleId} order by m.created_at, m.id`;
}

// ---- the PIN lock ---------------------------------------------------------
export function lockKey(phone, deviceHash) {
  return deviceHash ? 'd:' + sha(phone) + ':' + deviceHash : 'n:' + sha(phone);
}
// One PIN check, for a real number or one nobody has: the try is claimed in
// the database BEFORE it is checked, and only while the key is not locked,
// so a burst of guesses sent at once cannot slip past the count.
// → { ok: true } | { locked: true, until, lockedNow } | { wrong: true, left }
export async function pinGate(sql, key, check, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const claim = await sql`
    insert into pin_locks (k, tries, updated_at) values (${key}, 1, now())
    on conflict (k) do update set tries = pin_locks.tries + 1, updated_at = now()
      where pin_locks.locked_until is null or pin_locks.locked_until <= now()
    returning tries, level, locked_until`;
  if (!claim[0]) {
    const l = await sql`select locked_until from pin_locks where k = ${key}`;
    return { locked: true, until: l[0] && l[0].locked_until };
  }
  const { tries, level, locked_until: lastEnd } = claim[0];
  const lockNow = async () => {
    const plan = lockPlan(level, lastEnd ? new Date(lastEnd).getTime() : 0, now);
    const until = new Date(now + plan.minutes * 60000).toISOString();
    const got = await sql`update pin_locks set tries = 0, level = ${plan.level}, locked_until = ${until}, updated_at = now()
                          where k = ${key} and (locked_until is null or locked_until <= now()) returning k`;
    const l = await sql`select locked_until from pin_locks where k = ${key}`;
    return { locked: true, until: (l[0] && l[0].locked_until) || until, lockedNow: !!got[0], minutes: plan.minutes };
  };
  // Tries beyond the fifth were claimed by guesses already in flight.
  if (tries > MAX_TRIES) return lockNow();
  if (!check()) {
    if (tries >= MAX_TRIES) return lockNow();
    return { wrong: true, left: MAX_TRIES - tries };
  }
  await sql`update pin_locks set tries = 0, updated_at = now() where k = ${key}`;
  return { ok: true };
}
export function lockReply(until) {
  return { status: 429, json: { ok: false, locked: true, error: lockWords(new Date(until).getTime(), Date.now()) } };
}
export function wrongReply(left) {
  return { status: 401, json: { ok: false, wrongPin: true, left,
    error: 'That number and PIN do not match. ' + left + ' ' + (left === 1 ? 'try' : 'tries') + ' left.' } };
}
export async function isKnownDevice(sql, userId, deviceHash) {
  if (!deviceHash) return false;
  const d = await sql`select 1 as x from user_devices where user_id = ${userId} and device_hash = ${deviceHash}`;
  return !!d[0];
}
// The owner hears when their number is locked, in plain words.
export async function lockNotice(sql, user, minutes, ownDevice) {
  const t = minutes >= 120 ? Math.round(minutes / 60) + ' hours' : minutes + ' minutes';
  const body = ownDevice
    ? 'A phone you use typed a wrong PIN 5 times. It is locked for ' + t + '. Your other phones still work.'
    : 'Someone typed a wrong PIN for your number 5 times. New phones are locked for ' + t + '. The phones you already use still work.';
  await logEvent(sql, user.id, 'lock', body);
  await pushUser(sql, user.id, { title: '🔒 Wrong PIN tries on your number', body, url: '/#home' });
}

// ---- sessions and devices --------------------------------------------------
// A session for this person on this phone. A phone Parwah has not seen for
// this person before is told to their other phones; it is never blocked.
export async function startSession(sql, user, { device, deviceHash, ua, quiet = false } = {}) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const others = await sql`select count(*)::int as n from sessions where user_id = ${user.id} and expires_at > now()`;
  const known = await isKnownDevice(sql, user.id, deviceHash);
  const name = deviceName(ua);
  const made = await sql`insert into sessions (token_hash, user_id, device, expires_at, device_hash, ua)
                         values (${tokenHash(token)}, ${user.id}, ${String(device || '').slice(0, 80) || null}, ${expires}, ${deviceHash}, ${ua || null})
                         returning sid`;
  if (deviceHash) {
    await sql`insert into user_devices (user_id, device_hash, name) values (${user.id}, ${deviceHash}, ${name})
              on conflict (user_id, device_hash) do update set last_used = now(), name = excluded.name`;
  }
  // Old sessions are pruned as people sign in, so the table does not grow
  // for ever on a deployment nobody runs a cron against.
  try { await sql`delete from sessions where expires_at < now()`; } catch (e) {}
  if (!quiet && !known && others[0].n > 0) {
    const text = 'New sign-in on another phone (' + name + '). Was this you?';
    await sql`insert into account_alerts (user_id, kind, sid, device_hash, text) values (${user.id}, 'new_device', ${made[0].sid}, ${deviceHash}, ${text})`;
    await logEvent(sql, user.id, 'signin', 'Signed in on a new phone: ' + name);
    await pushUser(sql, user.id, { title: '📱 New sign-in on another phone', body: 'Was this you? If not, open Parwah and tap "Not me".', url: '/#home' });
  } else if (!quiet) {
    await logEvent(sql, user.id, 'signin', 'Signed in on ' + name);
  }
  return { token, sid: made[0].sid };
}

// ---- who may let someone back in -------------------------------------------
// An adult in a FAMILY this person belongs to, never a member of a group of
// friends; or the one recovery contact the person chose, whichever circle
// they share. `sure` is the strict rule: a yes counts only from someone
// known to be a grown-up. A member whose age nobody has written down is
// still told (sure: false), and is asked for their date of birth before
// their yes is taken, so a parent is never left with nobody to ask.
// → [{ user_id, member_id, circle_id, sure }]
export async function resetApprovers(sql, userId) {
  const today = todayIn();
  const rows = await sql`
    select b.id as member_id, b.circle_id, b.user_id, b.name, b.dob, b.role, b.relation, b.adult_confirmed, b.spouse_id, b.remembered,
           exists (select 1 from members c where c.parent_id = b.id) as has_child
    from members a join members b on b.circle_id = a.circle_id join circles c on c.id = a.circle_id
    where a.user_id = ${userId} and b.user_id is not null and b.user_id <> ${userId} and c.kind = 'family'
    order by a.created_at desc`;
  const out = new Map();
  for (const r of rows) {
    if (!isAdultMember(r, today)) continue;
    const sure = isAdultMember(r, today, { strict: true });
    const had = out.get(r.user_id);
    if (!had || (sure && !had.sure)) out.set(r.user_id, { user_id: r.user_id, member_id: r.member_id, circle_id: r.circle_id, sure });
  }
  const rc = await sql`select u.recovery_user from users u where u.id = ${userId} and u.recovery_user is not null`;
  if (rc[0]) {
    const m = await sql`select id, circle_id from members where user_id = ${rc[0].recovery_user} and not remembered order by created_at desc limit 1`;
    const had = out.get(rc[0].recovery_user);
    // Chosen by name, so their yes counts whatever their date of birth says.
    out.set(rc[0].recovery_user, { user_id: rc[0].recovery_user, member_id: had ? had.member_id : (m[0] ? m[0].id : null),
      circle_id: had ? had.circle_id : (m[0] ? m[0].circle_id : null), sure: true, recovery: true });
  }
  return [...out.values()];
}

// ---- forgetting a member -----------------------------------------------------
// Used when a person is removed, and when an account is deleted. Their own
// private things go; what they shared stays with the family (the author
// becomes "a former member") unless they asked for it to go too. Everything
// recorded ABOUT them goes with the member row (the same cascade as leaving).
export const FORMER_MARK = String.fromCharCode(0x2063);
export async function forgetMember(sql, memberId, { removePosts = false } = {}) {
  const quiet = async f => { try { await f(); } catch (e) { /* that feature has no table yet */ } };
  await quiet(() => sql`delete from notes where by_member = ${memberId} and private`);
  await quiet(() => sql`delete from legacy_asset_locators where created_by = ${memberId} and unlock_policy = 'ONLY_ME'`);
  if (removePosts) {
    await quiet(() => sql`delete from messages where member_id = ${memberId}`);
    await quiet(() => sql`delete from events where member_id = ${memberId}`);
    await quiet(() => sql`delete from notes where by_member = ${memberId}`);
  } else {
    // What they wrote in a chat stays, marked so the app can say "A former
    // member" (a message with no author is otherwise read as Ekta's). The
    // mark is one unseen character at the start of the text.
    await quiet(() => sql`update messages set text = ${FORMER_MARK} || text where member_id = ${memberId} and kind = 'text'`);
  }
  await sql`delete from members where id = ${memberId}`;
}
// The 7 days are over: the account goes. A family left with nobody on
// Parwah goes with it; a family with others in it stays theirs.
export async function finalizeAccount(sql, userId) {
  const u = await sql`select id, delete_posts from users where id = ${userId} and delete_at is not null and delete_at <= now()`;
  if (!u[0]) return false;
  const ms = await sql`select id, circle_id from members where user_id = ${userId}`;
  for (const m of ms) {
    await forgetMember(sql, m.id, { removePosts: !!u[0].delete_posts });
    const left = await sql`select count(*)::int as n from members where circle_id = ${m.circle_id} and user_id is not null`;
    if (!left[0].n) await sql`delete from circles where id = ${m.circle_id}`;
  }
  await sql`delete from users where id = ${userId}`;
  return true;
}

// ---- my activity ----------------------------------------------------------------
const AUDIT_SAY = {
  view_emergency_packet: 'opened your hospital papers', view_biomarkers: 'looked at your lab numbers',
  add_asset_locator: 'added an entry about you to the register', edit_asset_locator: 'changed a register entry about you',
  share_asset_locator: 'changed who can see a register entry about you', remove_asset_locator: 'removed a register entry about you',
  view_asset_locator: 'opened a register entry about you'
};
export async function activityFor(sql, userId) {
  const out = [];
  const add = (at, text, kind) => { if (at && text) out.push({ at: new Date(at).toISOString(), text, kind }); };
  const ev = await sql`select kind, text, created_at from account_events where user_id = ${userId} order by created_at desc limit 80`;
  ev.forEach(e => add(e.created_at, e.text, e.kind));
  const mine = (await sql`select id from members where user_id = ${userId}`).map(m => m.id);
  if (mine.length) {
    const quiet = async f => { try { return await f(); } catch (e) { return []; } };
    // The register and the hospital papers: who opened or changed what is
    // about me. My own actions are not news to me.
    const au = await quiet(() => sql`
      select ae.action, ae.timestamp, m.name as actor from audit_events ae left join members m on m.id = ae.actor_id
      where ae.actor_id is not null and not (ae.actor_id = any(${mine}::uuid[]))
        and ((ae.resource in ('insurance_preauth_packet', 'biomarker_records') and ae.resource_id = any(${mine}::uuid[]))
          or (ae.resource = 'legacy_asset_locator' and exists (select 1 from legacy_asset_locators l
                where l.id = ae.resource_id and l.person_id = any(${mine}::uuid[]))))
      order by ae.timestamp desc limit 40`);
    au.forEach(a => add(a.timestamp, (a.actor || 'Someone in the family') + ' ' + (AUDIT_SAY[a.action] || 'opened a record about you'), 'record'));
    const vl = await quiet(() => sql`
      select l.action, l.at, d.label, m.name as actor from vault_log l join vault_docs d on d.id = l.doc_id left join members m on m.id = l.member_id
      where d.about_member = any(${mine}::uuid[]) and l.member_id is not null and not (l.member_id = any(${mine}::uuid[]))
      order by l.at desc limit 40`);
    vl.forEach(a => add(a.at, (a.actor || 'Someone in the family') + ' ' + (a.action === 'opened' ? 'opened' : a.action) + ' your paper "' + a.label + '" in the vault', 'vault'));
    // Who looked at where I am. The table is made by the location work;
    // when it is not there yet, there is nothing to show.
    const lv = await quiet(() => sql`
      select v.at, m.name as actor from location_looks v left join members m on m.id = v.viewer_id
      where v.member_id = any(${mine}::uuid[]) and not (v.viewer_id = any(${mine}::uuid[]))
      order by v.at desc limit 40`);
    lv.forEach(a => add(a.at, (a.actor || 'Someone in the family') + ' looked at where you are', 'location'));
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out.slice(0, 120);
}

// ---- download my data ---------------------------------------------------------
// Everything about me and written by me that I may see. Tables are found
// from the database's own foreign keys to members, so a feature added later
// is included without this file changing. A column that says a row is ABOUT
// me (not by me) is included only for tables where the person it is about
// can already read it in the app: a surprise card, or a list started about
// someone, is not handed over by a download.
const ABOUT_COL = /^(about|for|person|target|subject|to)_|^(person|target|subject)$/;
const ABOUT_OK = new Set(['reminders', 'requests', 'vault_docs', 'family_book', 'biomarker_records', 'medicine_schedules']);
const SKIP_TABLE = new Set(['members', 'push_subs', 'pin_resets', 'standing_votes', 'notif_seen', 'chat_reads', 'chat_members', 'vault_files']);
const SECRET_KEY = /hash|salt|secret|token|p256dh|^auth$|endpoint|bytes|^data$|ip_fingerprint/i;
function scrub(row) {
  const o = {};
  for (const k of Object.keys(row || {})) {
    if (SECRET_KEY.test(k)) continue;
    const v = row[k];
    o[k] = typeof v === 'string' && v.length > 4000 ? v.slice(0, 200) + '... (' + v.length + ' characters, open it in the app)' : v;
  }
  return o;
}
const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function exportFor(sql, userId) {
  const u = (await sql`select id, name, phone, created_at, pin_set_at, toured_at, delete_at from users where id = ${userId}`)[0];
  if (!u) return null;
  const memberships = await sql`select m.*, c.name as family_name, c.kind as family_kind, c.code as family_code
                                from members m join circles c on c.id = m.circle_id where m.user_id = ${userId} order by m.created_at`;
  const ids = memberships.map(m => m.id);
  const data = {
    what: 'Everything Parwah keeps about you and written by you, that you can see in the app.',
    made_at: new Date().toISOString(),
    profile: scrub(u),
    families: memberships.map(scrub),
    devices: (await sql`select name, first_seen, last_used from user_devices where user_id = ${userId} order by first_seen`).map(scrub),
    activity: await activityFor(sql, userId),
    tables: {}
  };
  if (ids.length) {
    const refs = await sql`
      select cl.relname as tbl, att.attname as col
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_class ref on ref.oid = con.confrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
      where con.contype = 'f' and ref.relname = 'members' and ns.nspname = current_schema()
        and array_length(con.conkey, 1) = 1
      order by cl.relname, att.attname`;
    for (const r of refs) {
      if (SKIP_TABLE.has(r.tbl)) continue;
      if (ABOUT_COL.test(r.col) && !ABOUT_OK.has(r.tbl)) continue;
      let rows = [];
      try { rows = (await sql`select parwah_rows_for(${r.tbl}, ${r.col}, ${ids}::uuid[], 2000) as j`).map(x => x.j); } catch (e) { continue; }
      // An entry about me that someone made theirs alone is not mine to read.
      if (r.tbl === 'legacy_asset_locators') rows = rows.filter(x => !(x.unlock_policy === 'ONLY_ME' && !ids.includes(x.created_by) && !ids.includes(x.person_id)));
      if (!rows.length) continue;
      const key = r.tbl + ' (' + r.col + ')';
      data.tables[key] = rows.map(scrub);
    }
  }
  const section = (title, rows) => '<h2>' + escHtml(title) + '</h2>' + (rows.length ? rows.map(row =>
    '<dl>' + Object.keys(row).filter(k => row[k] !== null && row[k] !== '').map(k =>
      '<dt>' + escHtml(k.replace(/_/g, ' ')) + '</dt><dd>' + escHtml(typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]) + '</dd>').join('') + '</dl>').join('')
    : '<p>Nothing here.</p>');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>My Parwah data</title>'
    + '<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.5;color:#221428}'
    + 'h1{font-size:26px}h2{font-size:18px;margin-top:32px;border-bottom:2px solid #FFB31A;padding-bottom:4px}'
    + 'dl{border:1px solid #e6d9cc;border-radius:8px;padding:8px 12px;margin:8px 0;display:grid;grid-template-columns:minmax(120px,30%) 1fr;gap:2px 12px}'
    + 'dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}</style></head><body>'
    + '<h1>My Parwah data</h1><p>' + escHtml(data.what) + ' Made on ' + escHtml(data.made_at.slice(0, 10)) + ' for ' + escHtml(u.name) + '.</p>'
    + section('My profile', [data.profile]) + section('My families and groups', data.families) + section('My devices', data.devices)
    + section('My activity', data.activity)
    + Object.keys(data.tables).map(k => section(k, data.tables[k])).join('')
    + '</body></html>';
  return { data, html };
}

// ---- the actions ---------------------------------------------------------------------
const bad = (error, status = 400, extra) => ({ status, json: { ok: false, error, ...(extra || {}) } });
const good = (json, status = 200) => ({ status, json: { ok: true, ...(json || {}) } });
export const ACCOUNT_ACTIONS = ['account_state', 'device_signout', 'alert_ok', 'alert_notme', 'reset_veto',
  'recovery_set', 'recovery_clear', 'activity', 'export_me', 'delete_me', 'delete_me_undo'];

// What the app shows on Today and in Profile about the account itself.
export async function securityFor(sql, userId, token) {
  const alerts = await sql`select a.id, a.kind, a.text, a.created_at from account_alerts a
                           where a.user_id = ${userId} and a.status = 'open' and a.created_at > now() - interval '7 days'
                             and (a.sid is null or not exists (select 1 from sessions s where s.sid = a.sid and s.token_hash = ${tokenHash(token || '')}))
                           order by a.created_at desc limit 5`;
  const resets = await sql`select r.id, r.status, r.created_at from pin_resets r
                           where r.user_id = ${userId} and r.status in ('pending', 'approved')
                             and (r.expires_at is null or r.expires_at > now()) order by r.created_at desc limit 3`;
  const u = await sql`select delete_at from users where id = ${userId}`;
  return { alerts, myResets: resets, deleteAt: u[0] ? u[0].delete_at : null };
}

export async function accountAction(sql, req, body, token) {
  await ensureStandingSchema(sql);
  const su = await sessionUser(sql, token);
  if (!su) return bad('Please sign in again', 401, { signin: true });
  const uid = su.user_id;
  const a = String(body.action || '');
  const cur = (await sql`select sid, created_at, device_hash from sessions where token_hash = ${tokenHash(token)}`)[0] || {};

  if (a === 'account_state') {
    const sessions = await sql`select s.sid, s.ua, s.created_at, s.last_used_at, s.device_hash, d.first_seen
                               from sessions s left join user_devices d on d.user_id = s.user_id and d.device_hash = s.device_hash
                               where s.user_id = ${uid} and s.expires_at > now() order by s.last_used_at desc limit 30`;
    const u = (await sql`select u.recovery_user, r.name as recovery_name from users u left join users r on r.id = u.recovery_user where u.id = ${uid}`)[0] || {};
    // Who could be the recovery contact: grown-ups on Parwah in any circle of mine.
    const today = todayIn();
    const people = await sql`
      select distinct on (b.user_id) b.user_id, b.name, b.dob, b.role, b.relation, b.adult_confirmed, b.spouse_id, b.remembered, c.name as family,
             exists (select 1 from members k where k.parent_id = b.id) as has_child
      from members a join members b on b.circle_id = a.circle_id join circles c on c.id = a.circle_id
      where a.user_id = ${uid} and b.user_id is not null and b.user_id <> ${uid}
      order by b.user_id, b.created_at`;
    return good({
      devices: sessions.map(s => ({ sid: s.sid, name: deviceName(s.ua), firstSeen: s.first_seen || s.created_at, lastUsed: s.last_used_at, current: s.sid === cur.sid })),
      recovery: u.recovery_user ? { userId: u.recovery_user, name: u.recovery_name } : null,
      recoveryChoices: people.filter(p => isAdultMember(p, today)).map(p => ({ userId: p.user_id, name: p.name, family: p.family })),
      ...(await securityFor(sql, uid, token))
    });
  }

  if (a === 'device_signout') {
    if (!isUuid(body.sid)) return bad('Bad request');
    const gone = await sql`delete from sessions where user_id = ${uid} and sid = ${body.sid} returning sid, ua`;
    if (gone[0]) await logEvent(sql, uid, 'device', 'Signed out of ' + deviceName(gone[0].ua));
    return good({ self: body.sid === cur.sid });
  }

  if (a === 'alert_ok' || a === 'alert_notme') {
    if (!isUuid(body.alertId)) return bad('Bad request');
    const al = (await sql`select id, sid, device_hash, kind from account_alerts where id = ${body.alertId} and user_id = ${uid} and status = 'open'`)[0];
    if (!al) return good({ already: true });
    if (a === 'alert_ok') {
      await sql`update account_alerts set status = 'ok' where id = ${al.id}`;
      return good({});
    }
    // "Not me" is for a phone that was here first. The new phone cannot
    // use it to put the older ones out.
    const theirs = al.sid ? (await sql`select created_at from sessions where sid = ${al.sid}`)[0] : null;
    if (al.sid && al.sid === cur.sid) return bad('This is the phone the alert is about.', 403);
    if (theirs && cur.created_at && new Date(cur.created_at) > new Date(theirs.created_at)) return bad('Only a phone that was signed in before can say this.', 403);
    if (al.sid) await sql`delete from sessions where user_id = ${uid} and sid = ${al.sid}`;
    if (al.device_hash) {
      await sql`delete from sessions where user_id = ${uid} and device_hash = ${al.device_hash}`;
      await sql`delete from user_devices where user_id = ${uid} and device_hash = ${al.device_hash}`;
    }
    await sql`update users set must_change_pin = true where id = ${uid}`;
    await sql`update account_alerts set status = 'notme' where id = ${al.id}`;
    await logEvent(sql, uid, 'device', 'You said a new sign-in was not you. That phone was signed out, and a new PIN was asked for.');
    return good({ changeSecret: true });
  }

  // "Someone asked to reset your PIN. Not you?" The owner stops it.
  if (a === 'reset_veto') {
    if (!isUuid(body.resetId)) return bad('Bad request');
    const done = await sql`update pin_resets set status = 'denied', decided_at = now()
                           where id = ${body.resetId} and user_id = ${uid} and status in ('pending', 'approved') returning id`;
    if (!done[0]) return good({ already: true });
    await logEvent(sql, uid, 'reset', 'You stopped a request to reset your PIN.');
    return good({});
  }

  if (a === 'recovery_clear') {
    await sql`update users set recovery_user = null where id = ${uid}`;
    await logEvent(sql, uid, 'recovery', 'You removed your recovery contact.');
    return good({});
  }
  if (a === 'recovery_set') {
    if (!isUuid(body.contactUserId) || body.contactUserId === uid) return bad('Choose someone in one of your families.');
    const today = todayIn();
    const rows = await sql`
      select b.user_id, b.name, b.dob, b.role, b.relation, b.adult_confirmed, b.spouse_id, b.remembered,
             exists (select 1 from members k where k.parent_id = b.id) as has_child
      from members a join members b on b.circle_id = a.circle_id
      where a.user_id = ${uid} and b.user_id = ${body.contactUserId}`;
    const pick = rows.find(r => isAdultMember(r, today));
    if (!pick) return bad(rows.length ? 'Choose a grown-up. A child cannot let you back in.' : 'Choose someone in one of your families.', 400);
    if (!(await rateLimit(sql, 'recovery', uid, 6, 86400, { failClosed: true }))) return bad('You have changed this a lot today. Please try again tomorrow.', 429);
    await sql`update users set recovery_user = ${pick.user_id} where id = ${uid}`;
    await logEvent(sql, uid, 'recovery', 'You chose ' + pick.name + ' as your recovery contact.');
    await pushUser(sql, pick.user_id, { title: '🤝 ' + su.name + ' trusts you', body: su.name + ' chose you to let them back in if they forget their PIN. Call them before you say yes.', url: '/#home' });
    return good({ recovery: { userId: pick.user_id, name: pick.name } });
  }

  if (a === 'activity') return good({ activity: await activityFor(sql, uid) });

  if (a === 'export_me') {
    // Three a day: it reads a lot, and nobody needs more.
    if (!(await rateLimit(sql, 'export', uid, 3, 86400, { failClosed: true }))) return bad('You can download your data 3 times a day. Please try again tomorrow.', 429);
    const out = await exportFor(sql, uid);
    if (!out) return bad('Profile not found', 404);
    await logEvent(sql, uid, 'export', 'You downloaded your data.');
    return good({ json: out.data, html: out.html });
  }

  if (a === 'delete_me_undo') {
    const done = await sql`update users set delete_at = null where id = ${uid} and delete_at is not null returning id`;
    if (done[0]) await logEvent(sql, uid, 'delete', 'You kept your account. Nothing was deleted.');
    return good({ deleteAt: null });
  }
  if (a === 'delete_me') {
    const u = (await sql`select id, phone, pin_hash, pin_salt from users where id = ${uid}`)[0];
    if (!u) return bad('Profile not found', 404);
    // The PIN again, counted like a sign-in on this phone, so a phone left
    // unlocked on a table cannot delete the account by guessing.
    const known = await isKnownDevice(sql, uid, cur.device_hash);
    const g = await pinGate(sql, lockKey(u.phone, known ? cur.device_hash : null), () => verifyPin(body.pin, u.pin_salt, u.pin_hash));
    if (g.locked) return lockReply(g.until);
    if (g.wrong) return bad('That PIN is not right. ' + g.left + ' ' + (g.left === 1 ? 'try' : 'tries') + ' left.', 401, { wrongPin: true, left: g.left });
    const at = new Date(Date.now() + UNDO_DAYS * 86400000).toISOString();
    await sql`update users set delete_at = ${at}, delete_posts = ${body.removePosts === true} where id = ${uid}`;
    await logEvent(sql, uid, 'delete', 'You asked to delete your account. It will be deleted in ' + UNDO_DAYS + ' days unless you keep it.');
    await pushUser(sql, uid, { title: 'Your Parwah account will be deleted in ' + UNDO_DAYS + ' days', body: 'Not you, or changed your mind? Open Parwah and tap "Keep my account".', url: '/#home' });
    return good({ deleteAt: at });
  }
  return bad('Unknown action');
}

// The owner had live sessions when a reset was asked for: the new PIN
// waits this long, so they can stop it.
export async function vetoUntilFor(sql, userId) {
  const live = await sql`select count(*)::int as n from sessions where user_id = ${userId} and expires_at > now()`;
  return live[0].n > 0 ? new Date(Date.now() + RESET_VETO_MINUTES * 60000).toISOString() : null;
}
export { hashPin, standingOf };
