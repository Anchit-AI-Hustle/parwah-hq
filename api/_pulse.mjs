// THE FAMILY PULSE - "How are my people today?"
//
// A check-in that answers a question worth asking. "All is well ✅" is a
// button people press without reading; this asks how you actually are, in a
// vocabulary that changes daily so it stays a small pleasure rather than a
// chore. Everyone in a circle sees the SAME style on the same day, so the
// family is answering one question together.
//
// Some answers quietly carry "a call would be nice". That is the whole point
// of the feature: a way to say you are not fine without having to say it.
//
// WHO HEARS AN ANSWER (changed Nov 2026). An answer is PRIVATE by default.
// The member chooses: keep it to myself, tell only one person, or tell the
// family. A low answer never goes on the family feed unless they chose the
// family. The rule is in the SQL of pulseToday and in pulseSave below, not
// only on the screen. The Today card asks "Aaj kaisa lag raha hai?" with
// the five plain choices in api/_heardrules.mjs (a word with every emoji).
import { dayIn } from './_recur.mjs';
import { MOODS, MOOD_ASK, moodOf, moodClean, moodOnFeed } from './_heardrules.mjs';

export const PULSE_STYLES = {
  weather: { name: 'Weather', ask: 'What is the weather like inside you today?', options: [
    { k: 'sunny',  e: '☀️', t: 'Sunny' },
    { k: 'fair',   e: '⛅',  t: 'Fair' },
    { k: 'cloudy', e: '☁️', t: 'A bit cloudy' },
    { k: 'rainy',  e: '🌧',  t: 'Rainy - a call would be nice', call: true },
    { k: 'storm',  e: '⛈',  t: 'Stormy', call: true }
  ]},
  battery: { name: 'Battery', ask: 'How much battery have you got left?', options: [
    { k: 'full',   e: '🔋', t: '100% - fully charged' },
    { k: 'good',   e: '🔋', t: '75%' },
    { k: 'half',   e: '🔋', t: '50%' },
    { k: 'low',    e: '🪫', t: '25% - running low', call: true },
    { k: 'flat',   e: '🪫', t: 'Needs charging', call: true }
  ]},
  animals: { name: 'Animals', ask: 'Which animal are you today?', options: [
    { k: 'bird',   e: '🐦', t: 'Bird - light and busy' },
    { k: 'cat',    e: '🐈', t: 'Cat - comfortable' },
    { k: 'turtle', e: '🐢', t: 'Taking it slow' },
    { k: 'bear',   e: '🐻', t: 'Bear - want to be left alone', call: true },
    { k: 'fish',   e: '🐟', t: 'Out of water', call: true }
  ]},
  roads: { name: 'Roads', ask: 'How is the road today?', options: [
    { k: 'clear',  e: '🛣', t: 'Clear road' },
    { k: 'moving', e: '🚗', t: 'Moving nicely' },
    { k: 'traffic',e: '🚦', t: 'Slow traffic' },
    { k: 'jam',    e: '🚧', t: 'Stuck in a jam', call: true },
    { k: 'flat',   e: '🛞', t: 'Puncture', call: true }
  ]},
  food: { name: 'Food', ask: 'What food is today?', options: [
    { k: 'mithai', e: '🍬', t: 'Mithai - sweet day' },
    { k: 'chai',   e: '☕',  t: 'Chai - steady' },
    { k: 'dal',    e: '🍲', t: 'Dal chawal - ordinary' },
    { k: 'mirchi', e: '🌶',  t: 'Too much mirchi', call: true },
    { k: 'empty',  e: '🍽',  t: 'Empty plate', call: true }
  ]}
};

const ORDER = ['weather', 'battery', 'animals', 'roads', 'food'];

// The day where the asker is (their phone sends its zone), UTC otherwise.
export function today(tz) { return dayIn(tz); }

// The same style for everyone on a given day, derived from the date so no
// state has to be kept and every device agrees without asking.
export function styleFor(day) {
  const d = new Date(day + 'T00:00:00Z');
  const n = Math.floor(d.getTime() / 86400000);
  return ORDER[((n % ORDER.length) + ORDER.length) % ORDER.length];
}

export function optionOf(styleKey, k) {
  const st = PULSE_STYLES[styleKey];
  if (!st) return null;
  return st.options.find(o => o.k === k) || null;
}

export async function ensurePulseSchema(sql) {
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  const { schemaOnce } = await import('./_db.mjs');
  return schemaOnce(() => pulseTables(sql));
}
async function pulseTables(sql) {
  await sql`create table if not exists pulse (
    circle_id uuid not null references circles(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    day date not null,
    style text not null,
    value text not null,
    note text,
    at timestamptz not null default now(),
    primary key (circle_id, member_id, day)
  )`;
  // Who is told: 'self' (the default), 'one' person, or the 'family'.
  await sql`alter table pulse add column if not exists tell text not null default 'self'`;
  await sql`alter table pulse add column if not exists to_member uuid references members(id) on delete set null`;
  // The feed line an answer made, so it is taken away if the member then
  // chooses to keep the answer to themself.
  await sql`alter table pulse add column if not exists event_id uuid`;
}

// Today's answers THIS VIEWER may see: their own, one sent to them alone,
// and those a member chose to tell the family. With no viewer, only the
// ones told to the family. The rule is in the query.
export async function pulseToday(sql, circleId, tz, viewerId = null) {
  await ensurePulseSchema(sql);
  const day = today(tz), styleKey = styleFor(day);
  const rows = await sql`
    select p.member_id, p.style, p.value, p.note, p.at, p.tell, p.to_member
    from pulse p where p.circle_id = ${circleId} and p.day = ${day}
      and (p.tell = 'family' or p.member_id = ${viewerId}::uuid or (p.tell = 'one' and p.to_member = ${viewerId}::uuid))`;
  const st = PULSE_STYLES[styleKey];
  const answers = rows.map(r => {
    const o = r.style === 'mood' ? moodOf(r.value) : optionOf(r.style, r.value);
    return { memberId: r.member_id, style: r.style, value: r.value,
             emoji: o ? o.e : '•', text: o ? o.t : r.value, en: o && o.en ? o.en : null,
             call: !!(o && (o.call || o.low)), note: r.note, at: r.at,
             tell: r.member_id === viewerId ? r.tell : undefined, toId: r.member_id === viewerId ? r.to_member : undefined };
  });
  return { day, style: styleKey, styleName: st.name, ask: st.ask,
           options: st.options, answers, moodAsk: MOOD_ASK, moods: MOODS };
}

// Save one answer for today. body: { value, tell?, toId?, note? }. value is
// one of the five moods, or (older phones) one of today's style options.
// Returns { status, json, call, one } where call is the line for the call
// rota (only when the member told the family and the answer is a low one)
// and one is the person to tell alone.
export async function pulseSave(sql, circle, me, body, tz) {
  await ensurePulseSchema(sql);
  const day = today(tz), styleKey = styleFor(day);
  body = body || {};
  let style = 'mood', opt = moodOf(body.value), tell = 'self', toId = null;
  if (opt) {
    const c = moodClean(body);
    if (c.error) return { status: 400, json: { ok: false, error: c.error } };
    tell = c.tell; toId = c.toId;
  } else {
    opt = optionOf(styleKey, String(body.value || '')); style = styleKey;
    if (!opt) return { status: 400, json: { ok: false, error: 'Pick how you are today' } };
    const c = moodClean({ value: MOODS[0].k, tell: body.tell, toId: body.toId });
    if (c.error) return { status: 400, json: { ok: false, error: c.error } };
    tell = c.tell; toId = c.toId;
  }
  let one = null;
  if (tell === 'one') {
    // Someone in this family, on Parwah, who is not me and is not remembered.
    one = (await sql`select m.id, m.name from members m where m.id = ${toId} and m.circle_id = ${circle.id} and m.id <> ${me.id}
                       and m.user_id is not null and not coalesce((to_jsonb(m)->>'remembered')::boolean, false)`)[0] || null;
    if (!one) return { status: 400, json: { ok: false, error: 'Choose someone in the family who is on Parwah' } };
  }
  const note = String(body.note || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null;
  const before = (await sql`select event_id, tell, to_member, value from pulse where circle_id = ${circle.id} and member_id = ${me.id} and day = ${day}`)[0] || null;
  // An earlier feed line for today goes first: the answer may have changed,
  // or the member may now want it kept to themself.
  if (before && before.event_id) await sql`delete from events where id = ${before.event_id} and circle_id = ${circle.id}`;
  let eventId = null;
  if (moodOnFeed(tell)) {
    const ev = await sql`insert into events (circle_id, member_id, type, text)
                         values (${circle.id}, ${me.id}, 'checkin', ${me.name + ' is ' + opt.e + ' ' + opt.t}) returning id`;
    eventId = ev[0].id;
  }
  await sql`insert into pulse (circle_id, member_id, day, style, value, note, tell, to_member, event_id)
            values (${circle.id}, ${me.id}, ${day}, ${style}, ${opt.k}, ${note}, ${tell}, ${one ? one.id : null}, ${eventId})
            on conflict (circle_id, member_id, day)
            do update set style = excluded.style, value = excluded.value, note = excluded.note, tell = excluded.tell,
                          to_member = excluded.to_member, event_id = excluded.event_id, at = now()`;
  const low = !!(opt.call || opt.low);
  const changed = !before || before.value !== opt.k || before.tell !== tell || before.to_member !== (one ? one.id : null);
  return { status: 201, json: { ok: true, value: opt.k, tell, toId: one ? one.id : null },
           call: low && tell === 'family' && changed ? opt.e + ' ' + opt.t + (note ? ' - ' + note : '') : null,
           one: one && changed ? { id: one.id, low, line: opt.e + ' ' + opt.t } : null };
}
