// SOS: ONE TAP, AND EVERYTHING THAT SHOULD HAPPEN NEXT HAPPENS.
//
// What a press of the red button does, on the server:
//   1. Opens an SOS (one per person at a time: a second press while one is
//      open sends a fresh position and alerts again, it does not start a
//      second emergency).
//   2. Tells every phone in the family, as an emergency: high urgency, kept
//      on screen until it is seen, the long buzz.
//   3. Puts the message in the family chat with a map link, so anyone who
//      opens Parwah sees where and when.
//   4. Turns location sharing on, exact, with no end time, and holds it on
//      until the SOS is closed. Anyone in that family or group on Parwah
//      closes it, the person who pressed it included (owner, 2026-10-10:
//      an SOS nobody else answers must not stay on for ever).
//   5. Hands the phone a list of who to call and message straight away.
//
//   6. With a Twilio account added, texts, WhatsApps and calls those people
//      from the server as well (api/_sosdial.mjs). Without one, nothing extra.
//
// What a web app cannot do, and does not pretend to: send a government
// cell-broadcast, place a phone call or an SMS from the phone by itself, or
// keep sending a position once the app is closed. The phone does the calling
// and the messaging, one tap each, with everything already filled in.
import { validPosition } from './_geo.mjs';
import { schemaOnce } from './_db.mjs';
import { orderContacts } from './_safetyrules.mjs';
import { isAdult } from './_rememberrules.mjs';

export const SOS_AUDIO_MAX = 1600000;       // base64 characters, about 1.2 MB
export const SOS_AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'];

export async function ensureSosSchema(sql) {
  // First loads race here too: see schemaOnce.
  await schemaOnce(() => sosTables(sql));
}
async function sosTables(sql) {
  await sql`alter table sos add column if not exists lat double precision`;
  await sql`alter table sos add column if not exists lng double precision`;
  await sql`alter table sos add column if not exists accuracy integer`;
  await sql`alter table sos add column if not exists safe_at timestamptz`;
  await sql`alter table sos add column if not exists resolved_by uuid references members(id) on delete set null`;
  await sql`create table if not exists sos_media (
    id uuid primary key default gen_random_uuid(),
    sos_id uuid not null references sos(id) on delete cascade,
    member_id uuid references members(id) on delete set null,
    mime text not null,
    data text not null,
    seconds integer,
    created_at timestamptz not null default now()
  )`;
}

// A map link anyone can open, with or without Parwah.
export function mapLink(pos) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return null;
  return 'https://maps.google.com/?q=' + pos.lat.toFixed(6) + ',' + pos.lng.toFixed(6);
}

// The words that go to the family, and out by WhatsApp, SMS and email.
// Short enough for one SMS-sized glance, and true whether or not a position
// was found.
export function sosText(name, pos, when, tz) {
  // The sender's own clock, with its zone named, so family in another
  // country reads the right time. UTC when the phone did not say.
  let zone = 'UTC';
  try { if (typeof tz === 'string' && tz && tz.length <= 64) { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zone = tz; } } catch (e) {}
  const t = new Date(when || Date.now()).toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).replace('GMT+5:30', 'IST');
  const link = mapLink(pos);
  return '🆘 SOS from ' + name + ' at ' + t + '. I need help now. ' +
    (link ? 'Where I am: ' + link : 'My location could not be found - please call me.') +
    ' (sent from Parwah)';
}

export function parsePos(body) {
  if (!body || body.lat === undefined || body.lat === null || body.lng === undefined || body.lng === null) return null;
  const p = validPosition(body.lat, body.lng, body.accuracy);
  return p.error ? null : p;
}

// Who to call and message, in order: the people the family wrote down as
// emergency contacts for this person, then everyone else in the family who
// has a phone number. Never the person themselves; never twice.
//
// SOMEONE WHO HAS PASSED AWAY IS NEVER ON THIS LIST (owner's rule). Not as a
// member, and not as an emergency contact written down with their number:
// the order and the filter are orderContacts in api/_safetyrules.mjs. The
// person's own chosen emergency contacts come first, then adults in the
// family who are on Parwah, then everyone else with a number.
export async function sosContacts(sql, circleId, memberId) {
  let chosen = [];
  try {
    chosen = await sql`select name, phone from family_book
                       where circle_id = ${circleId} and kind = 'contact' and category = 'emergency' and phone is not null
                         and (about_member = ${memberId} or about_member is null) and visibility = 'circle'
                       order by (about_member = ${memberId}) desc nulls last, created_at limit 5`;
  } catch (e) { /* no family memory yet */ }
  const me = await sql`select phone from members where id = ${memberId}`;
  // remembered is read through the row: it works before any module made it.
  const fam = await sql`select m.name, m.phone, m.user_id is not null as on_app, to_char(m.dob, 'YYYY-MM-DD') as dob,
                               coalesce((to_jsonb(m)->>'remembered')::boolean, false) as remembered
                        from members m
                        where m.circle_id = ${circleId} and m.id <> ${memberId} and m.phone is not null
                        order by m.created_at limit 40`;
  const today = new Date().toISOString().slice(0, 10);
  return orderContacts({ chosen, own: me[0] && me[0].phone,
    family: fam.map(m => ({ ...m, adult: isAdult(m.dob, today) })) });
}

// The numbers of everyone in this family who has passed away, as dialable
// numbers: the last check before Parwah itself texts or rings anyone.
export async function rememberedPhones(sql, circleId) {
  const r = await sql`select m.phone, m.phone_cc from members m
                      where m.circle_id = ${circleId} and m.phone is not null
                        and coalesce((to_jsonb(m)->>'remembered')::boolean, false)`;
  return r;
}

// Others in the family who are on Parwah: the people who can mark someone
// safe. Alone, the person may do it themselves.
export async function othersOnApp(sql, circleId, memberId) {
  const r = await sql`select count(*)::int as n from members m where m.circle_id = ${circleId} and m.id <> ${memberId} and m.user_id is not null
                        and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)`;
  return r[0] ? r[0].n : 0;
}

// EVERY FAMILY THE PERSON BELONGS TO HEARS AN SOS, not only the one that is
// open on their phone. A group of friends hears only when it is the one
// open. Returns the other family circles, with the person's membership there.
export async function sosOtherFamilies(sql, circleId, userId) {
  if (!userId) return [];
  return sql`select c.id, c.code, c.name, c.kind, m.id as member_id, m.name as member_name, m.phone_cc
             from members m join circles c on c.id = m.circle_id
             where m.user_id = ${userId} and c.id <> ${circleId} and coalesce(c.kind, 'family') = 'family'
               and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)
             order by m.created_at limit 6`;
}
