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
import { dayIn } from './_recur.mjs';

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
}

// Today's answers, with everyone who has not answered included as null - the
// screen is "how are my people", so a person who has not said is part of it.
export async function pulseToday(sql, circleId, tz) {
  await ensurePulseSchema(sql);
  const day = today(tz), styleKey = styleFor(day);
  const rows = await sql`
    select p.member_id, p.style, p.value, p.note, p.at
    from pulse p where p.circle_id = ${circleId} and p.day = ${day}`;
  const st = PULSE_STYLES[styleKey];
  const answers = rows.map(r => {
    const o = optionOf(r.style, r.value);
    return { memberId: r.member_id, style: r.style, value: r.value,
             emoji: o ? o.e : '•', text: o ? o.t : r.value,
             call: !!(o && o.call), note: r.note, at: r.at };
  });
  return { day, style: styleKey, styleName: st.name, ask: st.ask,
           options: st.options, answers };
}
