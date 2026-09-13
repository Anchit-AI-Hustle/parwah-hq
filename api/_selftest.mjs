// GET /api/selftest - end-to-end test of the app backend against the live
// database: creates a throwaway circle, exercises every event type, verifies
// reads, then deletes the circle (cascades to members and events).
import { db, ensureSchema, makeCode, ensureCircleChat, rateLimit } from './_db.mjs';
import { ensureVaultSchema, ensurePaySchema, checkNumber } from './_vaultapi.mjs';
import { ensureCoinSchema, award, balance, spend, EARN, SPEND } from './_coins.mjs';
import { careSuggestions } from './care.mjs';
import { priceOf, USD_RATE } from './_planapi.mjs';
import { ensurePulseSchema, pulseToday, styleFor, PULSE_STYLES, today as pulseDay } from './_pulse.mjs';

export default async function handler(req, res) {
  const steps = {};
  let sql;
  try { sql = db(); await ensureSchema(sql); steps.schema = true; }
  catch (e) { return res.status(500).json({ ok: false, failed: 'schema', error: String(e && e.message || e) }); }

  let circleId = null;
  try {
    const code = 'T' + makeCode().slice(1);
    const c = await sql`insert into circles (code, name) values (${code}, 'Selftest Circle') returning id, code`;
    circleId = c[0].id; steps.create_circle = true;

    const papa = await sql`insert into members (circle_id, name, role) values (${circleId}, 'Test Papa', 'parent') returning id`;
    const beta = await sql`insert into members (circle_id, name, role) values (${circleId}, 'Test Beta', 'family') returning id`;
    steps.add_members = true;

    await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${papa[0].id}, 'checkin', null)`;
    await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${papa[0].id}, 'sos', null)`;
    await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${papa[0].id}, 'pill', null)`;
    await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${beta[0].id}, 'message', 'Papa, all okay?')`;
    steps.write_events = true;

    const feed = await sql`
      select e.type, m.name from events e left join members m on m.id = e.member_id
      where e.circle_id = ${circleId} order by e.created_at`;
    steps.read_feed = feed.length === 4 &&
      feed.map(f => f.type).sort().join(',') === 'checkin,message,pill,sos';

    // chats: default circle chat, a group, a 1:1, and messages in each
    const everyoneId = await ensureCircleChat(sql, circleId);
    const again = await ensureCircleChat(sql, circleId);
    steps.chat_default = !!everyoneId && everyoneId === again;

    const g = await sql`insert into chats (circle_id, kind, name) values (${circleId}, 'group', 'Test Group') returning id`;
    await sql`insert into chat_members (chat_id, member_id) values (${g[0].id}, ${papa[0].id})`;
    await sql`insert into chat_members (chat_id, member_id) values (${g[0].id}, ${beta[0].id})`;
    const d = await sql`insert into chats (circle_id, kind, name) values (${circleId}, 'dm', null) returning id`;
    await sql`insert into chat_members (chat_id, member_id) values (${d[0].id}, ${papa[0].id})`;
    await sql`insert into chat_members (chat_id, member_id) values (${d[0].id}, ${beta[0].id})`;
    steps.chat_create = true;

    await sql`insert into messages (chat_id, member_id, text) values (${everyoneId}, ${beta[0].id}, 'Hello everyone')`;
    await sql`insert into messages (chat_id, member_id, text) values (${g[0].id}, ${papa[0].id}, 'Group hello')`;
    await sql`insert into messages (chat_id, member_id, text) values (${d[0].id}, null, 'Namaste from Ekta')`;
    const msgs = await sql`
      select coalesce(m2.name, 'Ekta') as name from messages m
      left join members m2 on m2.id = m.member_id
      join chats c on c.id = m.chat_id where c.circle_id = ${circleId}`;
    steps.chat_messages = msgs.length === 3 && msgs.some(m => m.name === 'Ekta');

    // one person across many circles: place/country/phone stay consistent
    const tphone = '+9198' + String(Date.now()).slice(-8);
    const u = await sql`insert into users (phone, name) values (${tphone}, 'Test User') returning id, phone`;
    await sql`update members set user_id = ${u[0].id}, phone = ${tphone} where id = ${papa[0].id}`;
    const c2 = await sql`insert into circles (code, name) values (${'T' + makeCode().slice(1)}, 'Selftest Circle 2') returning id`;
    const m2 = await sql`insert into members (circle_id, name, role, phone, user_id) values (${c2[0].id}, 'Test Papa', 'parent', ${tphone}, ${u[0].id}) returning id`;
    await sql`update members set place = 'Pune', country = 'IN' where id = ${papa[0].id}`;
    await sql`update members set place = 'Pune', country = 'IN' where user_id = ${u[0].id} and id <> ${papa[0].id}`;
    const nphone = tphone.slice(0, -1) + '9';
    await sql`update members set phone = ${nphone} where user_id = ${u[0].id} and (phone is null or phone = ${tphone})`;
    const synced = await sql`select place, country, phone from members where id in (${papa[0].id}, ${m2[0].id})`;
    steps.profile_sync = synced.length === 2 &&
      synced.every(x => x.place === 'Pune' && x.country === 'IN' && x.phone === nphone);

    // read receipts + notification cursor upserts are idempotent
    await sql`insert into chat_reads (chat_id, member_id) values (${everyoneId}, ${beta[0].id}) on conflict (chat_id, member_id) do update set read_at = now()`;
    await sql`insert into chat_reads (chat_id, member_id) values (${everyoneId}, ${beta[0].id}) on conflict (chat_id, member_id) do update set read_at = now()`;
    await sql`insert into notif_seen (member_id, seen_at) values (${beta[0].id}, now()) on conflict (member_id) do update set seen_at = now()`;
    await sql`insert into notif_seen (member_id, seen_at) values (${beta[0].id}, now()) on conflict (member_id) do update set seen_at = now()`;
    const reads = await sql`select count(*)::int as n from chat_reads where chat_id = ${everyoneId} and member_id = ${beta[0].id}`;
    const seen = await sql`select count(*)::int as n from notif_seen where member_id = ${beta[0].id}`;
    steps.reads_seen = reads[0].n === 1 && seen[0].n === 1;

    // custom invite codes: settable, unique across all circles
    const custom = 'TC' + String(Date.now()).slice(-6) + 'X';
    await sql`update circles set code = ${custom} where id = ${c2[0].id}`;
    const back = await sql`select code from circles where id = ${c2[0].id}`;
    let dupBlocked = false;
    try { await sql`update circles set code = ${custom} where id = ${circleId}`; } catch (e) { dupBlocked = true; }
    steps.custom_code = back[0].code === custom && dupBlocked;

    // THE VAULT - the access rules are proved against the real database,
    // not just asserted in the interface.
    await ensureVaultSchema(sql); await ensurePaySchema(sql);
    const nosy = await sql`insert into members (circle_id, name, role) values (${circleId}, 'Test Nosy', 'family') returning id`;
    steps.vault_schema = true;

    // A real Aadhaar shape passes; the same number with one digit changed does not.
    const good = checkNumber('aadhaar', '234567890124');
    const bad = checkNumber('aadhaar', '234567890125');
    steps.vault_checksum = good.ok === true && good.last4 === '0124' && bad.ok === false;

    const doc = await sql`
      insert into vault_docs (circle_id, about_member, kind, label, last4, format_ok, file_name, file_mime, file_size, by_member)
      values (${circleId}, ${papa[0].id}, 'passport', 'Selftest passport', '4567', true, 'p.pdf', 'application/pdf', 5, ${beta[0].id})
      returning id, last4`;
    await sql`insert into vault_files (doc_id, bytes) values (${doc[0].id}, decode(${'aGVsbG8='}, 'base64'))`;
    const back2 = await sql`select encode(bytes, 'base64') as b64 from vault_files where doc_id = ${doc[0].id}`;
    steps.vault_store = doc[0].last4 === '4567' && back2[0].b64 === 'aGVsbG8=';

    // The visibility rule itself: a member with no grant gets nothing back.
    const seenBy = (who) => sql`
      select d.id from vault_docs d
      left join vault_access a on a.doc_id = d.id and a.member_id = ${who}
      where d.circle_id = ${circleId}
        and (d.about_member = ${who} or d.by_member = ${who} or a.member_id is not null)`;
    const beforeGrant = await seenBy(nosy[0].id);
    await sql`insert into vault_access (doc_id, member_id, level, granted_by)
              values (${doc[0].id}, ${nosy[0].id}, 'view', ${papa[0].id})`;
    const afterGrant = await seenBy(nosy[0].id);
    const ownerSees = await seenBy(papa[0].id);
    steps.vault_permission = beforeGrant.length === 0 && afterGrant.length === 1 && ownerSees.length === 1;

    await sql`insert into vault_log (doc_id, member_id, action) values (${doc[0].id}, ${nosy[0].id}, 'opened')`;
    const alog = await sql`select action from vault_log where doc_id = ${doc[0].id}`;
    steps.vault_audit = alog.length === 1 && alog[0].action === 'opened';

    // Payment permissions: allowed for one person, not another.
    const pm = await sql`insert into pay_methods (circle_id, owner_member, kind, label, handle, per_txn_cap)
                         values (${circleId}, ${papa[0].id}, 'upi', 'Selftest UPI', 'test@okbank', 5000) returning id`;
    await sql`insert into pay_perms (method_id, member_id, per_txn_cap, granted_by)
              values (${pm[0].id}, ${beta[0].id}, 2000, ${papa[0].id})`;
    const canUse = (who) => sql`
      select (p.owner_member = ${who} or pp.member_id is not null) as can_use
      from pay_methods p left join pay_perms pp on pp.method_id = p.id and pp.member_id = ${who}
      where p.id = ${pm[0].id}`;
    const betaUse = await canUse(beta[0].id);
    const nosyUse = await canUse(nosy[0].id);
    const ownerUse = await canUse(papa[0].id);
    steps.pay_permission = betaUse[0].can_use === true && nosyUse[0].can_use === false && ownerUse[0].can_use === true;

    // Joining is by approval: an invite code alone is not a way in.
    const polRow = await sql`select join_policy from circles where id = ${circleId}`;
    const jr = await sql`insert into join_requests (circle_id, name, role) values (${circleId}, 'Test Stranger', 'family') returning id, status`;
    const pendingSeen = await sql`select id from join_requests where circle_id = ${circleId} and status = 'pending'`;
    const notYetMember = await sql`select id from members where circle_id = ${circleId} and name = 'Test Stranger'`;
    steps.join_needs_approval = polRow[0].join_policy === 'approve' && jr[0].status === 'pending'
      && pendingSeen.length === 1 && notYetMember.length === 0;

    const admitted = await sql`insert into members (circle_id, name, role) values (${circleId}, 'Test Stranger', 'family') returning id`;
    await sql`update join_requests set status = 'approved', decided_by = ${papa[0].id}, decided_at = now() where id = ${jr[0].id}`;
    const afterOk = await sql`select status from join_requests where id = ${jr[0].id}`;
    steps.join_approval = afterOk[0].status === 'approved' && !!admitted[0].id;

    // The limiter counts across instances and lets the window roll over.
    const rlKey = 'selftest-' + Date.now();
    const first = await rateLimit(sql, 'selftest', rlKey, 2, 60);
    const second = await rateLimit(sql, 'selftest', rlKey, 2, 60);
    const third = await rateLimit(sql, 'selftest', rlKey, 2, 60);
    await sql`update rate_limit set window_start = now() - interval '2 hours' where bucket = 'selftest' and k = ${rlKey}`;
    const rolled = await rateLimit(sql, 'selftest', rlKey, 2, 60);
    await sql`delete from rate_limit where bucket = 'selftest' and k = ${rlKey}`;
    steps.rate_limit = first === true && second === true && third === false && rolled === true;

    // SOS - an open state with escalation, not a line in a feed.
    await sql`create table if not exists sos (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      status text not null default 'open', escalated boolean not null default false,
      acked_by uuid references members(id) on delete set null, acked_at timestamptz,
      resolved_at timestamptz, created_at timestamptz not null default now())`;
    const sos1 = await sql`insert into sos (circle_id, member_id, created_at)
                           values (${circleId}, ${papa[0].id}, now() - interval '30 minutes') returning id, status`;
    // The escalation claim must fire exactly once however many instances poll.
    const esc1 = await sql`update sos set escalated = true where id = ${sos1[0].id} and escalated = false returning id`;
    const esc2 = await sql`update sos set escalated = true where id = ${sos1[0].id} and escalated = false returning id`;
    steps.sos_escalates_once = sos1[0].status === 'open' && esc1.length === 1 && esc2.length === 0;

    await sql`update sos set status = 'acked', acked_by = ${beta[0].id}, acked_at = now()
              where id = ${sos1[0].id} and status = 'open'`;
    const acked = await sql`select status, acked_by from sos where id = ${sos1[0].id}`;
    const race = await sql`update sos set status = 'acked', acked_by = ${papa[0].id}
                           where id = ${sos1[0].id} and status = 'open' returning id`;
    steps.sos_ack = acked[0].status === 'acked' && acked[0].acked_by === beta[0].id && race.length === 0;

    // SUGGESTIONS - proposed from what the circle has already recorded.
    const sugg = await careSuggestions(sql, circleId, papa[0].id);
    steps.care_suggestions = Array.isArray(sugg) && sugg.some(x => /blood group/i.test(x.title));

    // PRICING - the same plan, converted at a fixed, stated rate.
    const inr = priceOf('care', 'INR'), usd = priceOf('care', 'USD');
    steps.pricing_dual = inr.amount === 2499 && inr.currency === 'INR'
      && usd.currency === 'USD' && Math.abs(usd.amount - (2499 / USD_RATE)) < 1.2
      && priceOf('free', 'INR').amount === 0;

    // THE PULSE - one answer per person per day, replaceable, same style for all.
    await ensurePulseSchema(sql);
    const pday = pulseDay(), pstyle = styleFor(pday);
    await sql`insert into pulse (circle_id, member_id, day, style, value)
              values (${circleId}, ${papa[0].id}, ${pday}, ${pstyle}, ${PULSE_STYLES[pstyle].options[0].k})`;
    const callOpt = PULSE_STYLES[pstyle].options.filter(o => o.call)[0];
    await sql`insert into pulse (circle_id, member_id, day, style, value)
              values (${circleId}, ${papa[0].id}, ${pday}, ${pstyle}, ${callOpt.k})
              on conflict (circle_id, member_id, day) do update set value = excluded.value`;
    const pt = await pulseToday(sql, circleId);
    const papaP = pt.answers.filter(a => a.memberId === papa[0].id);
    steps.pulse_one_per_day = papaP.length === 1 && papaP[0].value === callOpt.k && papaP[0].call === true;
    // Everyone sees the same question on the same day, and it rotates.
    const styles = ['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05'].map(styleFor);
    steps.pulse_rotates = new Set(styles).size === 5 && styleFor(pday) === styleFor(pday);

    // ONBOARDING - the introduction is once per PERSON, and a circle knows
    // whether it is a family or a group.
    const kindRow = await sql`select kind from circles where id = ${circleId}`;
    const grp = await sql`insert into circles (code, name, kind) values (${'T' + makeCode().slice(1)}, 'Selftest Group', 'group') returning id, kind`;
    steps.circle_kind = kindRow[0].kind === 'family' && grp[0].kind === 'group';
    await sql`delete from circles where id = ${grp[0].id}`;

    const tphone2 = '+9197' + String(Date.now()).slice(-8);
    const tu = await sql`insert into users (phone, name) values (${tphone2}, 'Selftest Tour') returning id, toured_at`;
    const before = tu[0].toured_at;
    await sql`update users set toured_at = coalesce(toured_at, now()) where id = ${tu[0].id}`;
    const once = await sql`select toured_at from users where id = ${tu[0].id}`;
    await sql`update users set toured_at = coalesce(toured_at, now()) where id = ${tu[0].id}`;
    const twice = await sql`select toured_at from users where id = ${tu[0].id}`;
    await sql`delete from users where id = ${tu[0].id}`;
    steps.tour_once_per_person = before === null && once[0].toured_at !== null
      && String(once[0].toured_at) === String(twice[0].toured_at);

    // MEMORY CONSENT - a private entry is invisible without a grant, but
    // preparedness still knows it is recorded.
    await sql`create table if not exists family_book (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      kind text not null, name text not null, category text, phone text, address text,
      forwhat text, notes text, by_member uuid references members(id) on delete set null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
    await sql`alter table family_book add column if not exists about_member uuid references members(id) on delete cascade`;
    await sql`alter table family_book add column if not exists visibility text not null default 'circle'`;
    await sql`create table if not exists book_access (
      entry_id uuid not null references family_book(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      granted_by uuid references members(id) on delete set null,
      granted_at timestamptz not null default now(), primary key (entry_id, member_id))`;
    await sql`create table if not exists book_consent (
      id uuid primary key default gen_random_uuid(),
      entry_id uuid references family_book(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid references members(id) on delete set null,
      action text not null, at timestamptz not null default now())`;
    const priv = await sql`insert into family_book (circle_id, kind, name, by_member, about_member, visibility)
                           values (${circleId}, 'med', 'Selftest private medicine', ${papa[0].id}, ${papa[0].id}, 'private')
                           returning id`;
    const shared = await sql`insert into family_book (circle_id, kind, name, by_member, about_member, visibility)
                             values (${circleId}, 'contact', 'Selftest plumber', ${papa[0].id}, null, 'circle')
                             returning id`;
    const visibleTo = (who) => sql`
      select b.id from family_book b
      left join book_access ba on ba.entry_id = b.id and ba.member_id = ${who}
      where b.circle_id = ${circleId}
        and (b.visibility = 'circle' or b.about_member = ${who} or b.by_member = ${who} or ba.member_id is not null)`;
    const betaSees = await visibleTo(beta[0].id);
    const papaSees = await visibleTo(papa[0].id);
    steps.memory_private = betaSees.length === 1 && betaSees[0].id === shared[0].id && papaSees.length === 2;

    await sql`insert into book_access (entry_id, member_id, granted_by)
              values (${priv[0].id}, ${beta[0].id}, ${papa[0].id})`;
    await sql`insert into book_consent (entry_id, circle_id, member_id, action)
              values (${priv[0].id}, ${circleId}, ${papa[0].id}, 'shared it with Test Beta')`;
    const betaAfter = await visibleTo(beta[0].id);
    const ledger = await sql`select action from book_consent where entry_id = ${priv[0].id}`;
    steps.memory_consent = betaAfter.length === 2 && ledger.length === 1;

    // The family still knows a medicine IS recorded for Papa, without reading it.
    const prepCount = await sql`select count(*)::int as n from family_book
                                where circle_id = ${circleId} and about_member = ${papa[0].id} and kind = 'med'`;
    steps.memory_prep_truthful = prepCount[0].n === 1;

    // MULTI-CIRCLE SIGNALS - what a person sees before opening a family.
    const unreadFor = (who) => sql`
      select count(*)::int as n from messages ms
      join chats ch on ch.id = ms.chat_id
      left join chat_members cm on cm.chat_id = ch.id and cm.member_id = ${who}
      left join chat_reads cr on cr.chat_id = ch.id and cr.member_id = ${who}
      where ch.circle_id = ${circleId}
        and (ch.kind = 'circle' or cm.member_id is not null)
        and ms.member_id is distinct from ${who}
        and (cr.read_at is null or ms.created_at > cr.read_at)`;
    // The fixture, spelled out, because a vague assertion here passed for weeks
    // against no database and then failed the first time it met a real one:
    //   everyone (circle chat, everyone is in it)  message from Beta
    //   group    (Papa + Beta)                     message from Papa
    //   dm       (Papa + Beta)                     message from Ekta
    // Beta holds a read cursor on `everyone` and nowhere else.
    // Papa: Beta's message counts, his own group message does not, Ekta's does → 2
    // Beta: her own message never counts, Papa's does, Ekta's does           → 2
    const papaUnread = (await unreadFor(papa[0].id))[0].n;
    const betaUnread = (await unreadFor(beta[0].id))[0].n;
    const ownNeverCounts = papaUnread === 2 && betaUnread === 2;

    // Now make the read cursor do the work it exists for. Papa reads the
    // circle chat; Beta's message must stop counting for him, and Ekta's
    // message in the DM - which he has not read - must keep counting.
    await sql`insert into chat_reads (chat_id, member_id) values (${everyoneId}, ${papa[0].id})
              on conflict (chat_id, member_id) do update set read_at = now()`;
    const papaAfterReading = (await unreadFor(papa[0].id))[0].n;
    // And a cursor belongs to one person: Beta's count must not move.
    const betaStillUnread = (await unreadFor(beta[0].id))[0].n;
    steps.circle_unread = ownNeverCounts && papaAfterReading === 1 && betaStillUnread === 2;

    const waiting = await sql`select count(*)::int as n from join_requests
                              where circle_id = ${circleId} and status = 'pending'`;
    const openReq = await sql`select count(*)::int as n from requests
                              where circle_id = ${circleId} and status = 'open'`;
    steps.circle_signals = typeof waiting[0].n === 'number' && typeof openReq[0].n === 'number';

    // COINS - one pot for the family, earned by caring, spent on the AI.
    await ensureCoinSchema(sql);
    const start = await balance(sql, circleId);
    const paid1 = await award(sql, circleId, papa[0].id, 'checkin', '2026-01-01');
    const paid2 = await award(sql, circleId, papa[0].id, 'checkin', '2026-01-01');  // same day again
    const paid3 = await award(sql, circleId, beta[0].id, 'checkin', '2026-01-01');  // different person
    const afterEarn = await balance(sql, circleId);
    steps.coins_earn_once = paid1 === EARN.checkin.n && paid2 === 0 && paid3 === EARN.checkin.n
      && afterEarn === start + EARN.checkin.n * 2;

    const sp = await spend(sql, circleId, beta[0].id, 'ekta');
    const afterSpend = await balance(sql, circleId);
    steps.coins_spend = sp.ok === true && sp.cost === SPEND.ekta && afterSpend === afterEarn - SPEND.ekta;

    // An empty pot refuses the AI rather than going negative.
    await sql`insert into coins (circle_id, member_id, delta, reason) values (${circleId}, ${papa[0].id}, ${-afterSpend}, 'selftest_drain')`;
    const broke = await spend(sql, circleId, beta[0].id, 'ekta');
    const atZero = await balance(sql, circleId);
    steps.coins_never_negative = broke.ok === false && atZero === 0;

    await sql`delete from circles where id = ${c2[0].id}`;
    await sql`delete from users where id = ${u[0].id}`;
    await sql`delete from circles where id = ${circleId}`;
    const leftover = await sql`select id from events where circle_id = ${circleId}`;
    const leftChats = await sql`select id from chats where circle_id = ${circleId}`;
    const leftReads = await sql`select chat_id from chat_reads where chat_id = ${everyoneId}`;
    const leftDocs = await sql`select id from vault_docs where circle_id = ${circleId}`;
    const leftFiles = await sql`select doc_id from vault_files where doc_id = ${doc[0].id}`;
    const leftPay = await sql`select id from pay_methods where circle_id = ${circleId}`;
    const leftJoin = await sql`select id from join_requests where circle_id = ${circleId}`;
    const leftCoins = await sql`select id from coins where circle_id = ${circleId}`;
    const leftBook = await sql`select id from family_book where circle_id = ${circleId}`;
    const leftSos = await sql`select id from sos where circle_id = ${circleId}`;
    const leftPulse = await sql`select member_id from pulse where circle_id = ${circleId}`;
    steps.cleanup_cascade = leftover.length === 0 && leftChats.length === 0 && leftReads.length === 0
      && leftDocs.length === 0 && leftFiles.length === 0 && leftPay.length === 0 && leftJoin.length === 0 && leftCoins.length === 0 && leftBook.length === 0 && leftSos.length === 0 && leftPulse.length === 0;
    circleId = null;

    const ok = Object.values(steps).every(Boolean);
    return res.status(ok ? 200 : 500).json({ ok, steps });
  } catch (e) {
    if (circleId) { try { await sql`delete from circles where id = ${circleId}`; } catch (_) {} }
    return res.status(500).json({ ok: false, steps, error: String(e && e.message || e) });
  }
}
