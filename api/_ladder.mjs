// THE NEAREST-PERSON LADDER.
//
// "If Maa presses SOS at 2am my time, the neighbour two floors down hears
// about it, not only me in Dubai."
//
// The family writes down people who live near a parent (a neighbour, a
// relative in town, the building guard). Nobody joins the ladder on the
// family's word alone: each nearby person gets a one-time link, reads what
// Parwah will do and says yes or no themselves. Only a yes is ever called.
// They can stop from the same link at any time, which deletes their details.
//
// What Parwah does with the ladder: when an SOS has gone to the family and
// nobody in the family has answered within the escalation window, it calls
// rung 1 (Twilio, inside the family's daily cap), and rung 2 a window later.
// Without Twilio, the family's SOS screen shows the ladder with Call buttons.
//
//   GET  /api/care?area=ladder&circle=CODE&member=ID   the ladders + nearby contacts
//   POST /api/care {action: ladder_add | ladder_link | ladder_order | ladder_remove}
//   GET  /api/circle?consent=TOKEN                     the nearby person's own page
//   POST /api/circle?consent=TOKEN {answer: yes|no|delete}
//
// ladderFor(sql, circleId, personId) is the one read other features use
// (SOS escalation here, the quiet-day alert later): consented people only,
// in the family's order.
import { createHash, randomBytes } from 'node:crypto';
import { db, ensureSchema, requireMember, isUuid, schemaOnce, rateLimit, clientIp } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { dialConfig, dialLadder } from './_sosdial.mjs';

export const LADDER_MAX = 6;          // people per person
export const LADDER_RUNGS = 2;        // how many Parwah calls during one SOS
const CONSENT_PATH = '/api/circle?consent=';

let ready = false;
export async function ensureLadderSchema(sql) {
  if (ready) return;
  await ensureSchema(sql);
  await schemaOnce(async () => {
    await sql`create table if not exists nearby_ladder (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      person_id uuid not null references members(id) on delete cascade,
      name text not null,
      phone text not null,
      distance_note text,
      has_key boolean not null default false,
      hours text,
      book_entry_id uuid,
      position integer not null default 0,
      consent text not null default 'pending',
      consent_at timestamptz,
      token_hash text unique,
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now()
    )`;
    await sql`create index if not exists nearby_ladder_person on nearby_ladder (circle_id, person_id, position)`;
  });
  ready = true;
}

const hashOf = (t) => createHash('sha256').update(String(t)).digest('hex');
const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n); return t || null; };
function cleanPhone(p) {
  const s = String(p || '').replace(/[^\d+]/g, '');
  return /^\+?\d{8,15}$/.test(s) ? s : null;
}

// Consented people for one person, in the family's order.
export async function ladderFor(sql, circleId, personId) {
  if (!isUuid(circleId) || !isUuid(personId)) return [];
  try {
    await ensureLadderSchema(sql);
    return await sql`select id, name, phone, distance_note, has_key, hours, position
                     from nearby_ladder
                     where circle_id = ${circleId} and person_id = ${personId} and consent = 'yes'
                     order by position, created_at limit ${LADDER_MAX}`;
  } catch (e) { return []; }
}

async function newLink(sql, id) {
  const token = randomBytes(24).toString('base64url');
  await sql`update nearby_ladder set token_hash = ${hashOf(token)} where id = ${id}`;
  return CONSENT_PATH + token;
}

// ---------------------------------------------------------------- family API
export async function ladderApi(req, res) {
  let sql;
  try { sql = db(); await ensureLadderSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
      const ladder = await sql`
        select l.id, l.person_id, p.name as person_name, l.name, l.phone, l.distance_note, l.has_key, l.hours,
               l.position, l.consent, l.consent_at, l.book_entry_id, l.created_at
        from nearby_ladder l join members p on p.id = l.person_id
        where l.circle_id = ${g.circle.id}
        order by p.created_at, l.position, l.created_at`;
      // "Someone near them" contacts the family already wrote down, ready to ask.
      let nearby = [];
      try {
        nearby = await sql`select id, name, phone, about_member, notes from family_book
                           where circle_id = ${g.circle.id} and kind = 'contact' and category = 'local'
                             and phone is not null and visibility = 'circle'
                           order by created_at limit 30`;
      } catch (e) { /* no family memory yet */ }
      const cfg = dialConfig();
      return res.status(200).json({ ok: true, ladder, nearby, calls: cfg.on && !!cfg.voice, rungs: LADDER_RUNGS });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    const b = req.body || {};
    const g = await requireMember(sql, b.code, b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;

    if (b.action === 'ladder_add') {
      if (!isUuid(b.personId)) return res.status(400).json({ ok: false, error: 'Pick whose nearby person this is' });
      const p = await sql`select id, name from members where id = ${b.personId} and circle_id = ${circle.id}`;
      if (!p[0]) return res.status(403).json({ ok: false, error: 'That person is not in this family' });
      let name = clip(b.name, 80), phone = cleanPhone(b.phone), entry = null;
      if (isUuid(b.bookEntryId)) {
        const e = await sql`select id, name, phone from family_book where id = ${b.bookEntryId} and circle_id = ${circle.id}
                            and kind = 'contact' and visibility = 'circle'`.catch(() => []);
        if (!e[0]) return res.status(403).json({ ok: false, error: 'That contact is not in this family' });
        entry = e[0].id; name = name || e[0].name; phone = phone || cleanPhone(e[0].phone);
      }
      if (!name) return res.status(400).json({ ok: false, error: 'Write their name' });
      if (!phone) return res.status(400).json({ ok: false, error: 'Write a phone number they answer, with the country code if outside India' });
      const n = await sql`select count(*)::int as n, coalesce(max(position), 0) as top from nearby_ladder
                          where circle_id = ${circle.id} and person_id = ${p[0].id}`;
      if (n[0].n >= LADDER_MAX) return res.status(400).json({ ok: false, error: 'Up to ' + LADDER_MAX + ' nearby people for one person' });
      const r = await sql`insert into nearby_ladder (circle_id, person_id, name, phone, distance_note, has_key, hours, book_entry_id, position, created_by)
                          values (${circle.id}, ${p[0].id}, ${name}, ${phone}, ${clip(b.distance, 80)}, ${b.hasKey === true},
                                  ${clip(b.hours, 80)}, ${entry}, ${n[0].top + 1}, ${me.id}) returning id`;
      const link = await newLink(sql, r[0].id);
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' asked ' + name + ' to be a nearby helper for ' + p[0].name})`;
      return res.status(201).json({ ok: true, id: r[0].id, link });
    }

    const row = isUuid(b.id) ? (await sql`select * from nearby_ladder where id = ${b.id} and circle_id = ${circle.id}`)[0] : null;
    if (b.action === 'ladder_link') {
      if (!row) return res.status(404).json({ ok: false, error: 'That nearby person is not here any more' });
      // A fresh link: the old one stops working.
      return res.status(200).json({ ok: true, link: await newLink(sql, row.id) });
    }
    if (b.action === 'ladder_remove') {
      if (!row) return res.status(404).json({ ok: false, error: 'That nearby person is not here any more' });
      await sql`delete from nearby_ladder where id = ${row.id}`;
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'ladder_order') {
      // The whole order for one person, top first.
      if (!isUuid(b.personId) || !Array.isArray(b.ids) || b.ids.length > LADDER_MAX || !b.ids.every(isUuid)) {
        return res.status(400).json({ ok: false, error: 'Send the order as a list' });
      }
      const have = await sql`select id from nearby_ladder where circle_id = ${circle.id} and person_id = ${b.personId}`;
      const set = new Set(have.map(x => x.id));
      if (b.ids.length !== set.size || !b.ids.every(id => set.has(id))) return res.status(400).json({ ok: false, error: 'The list changed - reload and try again' });
      for (let i = 0; i < b.ids.length; i++) await sql`update nearby_ladder set position = ${i + 1} where id = ${b.ids[i]} and circle_id = ${circle.id}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown ladder action' });
  } catch (e) { return fail(res, e); }
}

// ---------------------------------------------------------------- consent page
const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + escH(title) + '</title><style>' +
    ':root{--day:#FFF6EA;--ink:#221428;--ink-soft:#5A4A5E;--surface:#FFFFFF;--bone-2:#EBD9CC;--marigold:#FFB31A;--flame:#FF5B2E;--on-bright:#221428;--ok:#0B6E4F;--focus-ring:#00A19A;' +
    '--space-8:8px;--space-12:12px;--space-16:16px;--space-24:24px;--radius-12:12px;--radius-16:16px;--radius-pill:999px;--fs-14:14px;--fs-16:16px;--fs-24:24px}' +
    '@media (prefers-color-scheme:dark){:root{--day:#120C18;--ink:#FFF6EA;--ink-soft:#D8C8D8;--surface:#1E1526;--bone-2:#3A2C44;--ok:#5FD3A8}}' +
    'body{margin:0;background:var(--day);color:var(--ink);font:var(--fs-16)/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    'main{max-width:560px;margin:0 auto;padding:var(--space-24) var(--space-16)}h1{font-size:var(--fs-24);line-height:1.25;margin:0 0 var(--space-12)}' +
    '.card{background:var(--surface);border:1px solid var(--bone-2);border-radius:var(--radius-16);padding:var(--space-16);margin:var(--space-16) 0}' +
    'h2{font-size:var(--fs-16);margin:0 0 var(--space-8)}p,li{margin:0 0 var(--space-8)}small,.soft{color:var(--ink-soft);font-size:var(--fs-14)}' +
    'button{font:inherit;font-weight:700;min-height:48px;width:100%;border-radius:var(--radius-pill);border:2px solid var(--ink);background:transparent;color:var(--ink);margin:0 0 var(--space-12);cursor:pointer}' +
    'button.go{background:linear-gradient(90deg,var(--marigold),var(--flame));color:var(--on-bright);border-color:transparent}' +
    'button:focus-visible{outline:3px solid var(--focus-ring);outline-offset:2px}.ok{color:var(--ok);font-weight:700}' +
    '</style></head><body><main>' + body + '<p class="soft">Parwah is a private app for families. This page was sent to you by a family you know.</p></main></body></html>';
}
function send(res, status, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (typeof res.send === 'function') return res.status(status).send(html);
  res.statusCode = status; return res.end(html);
}
const last4 = (p) => String(p || '').replace(/\D/g, '').slice(-4);
const firstName = (n) => String(n || '').split(' ')[0];

// The page itself, from one ladder row (pure, so it can be looked at).
export function consentHtml(r, said = '') {
  const who = escH(r.person_name), first = escH(firstName(r.person_name));
  const status = r.consent === 'yes' ? 'You said yes' + (r.consent_at ? ' on ' + new Date(r.consent_at).toISOString().slice(0, 10) : '') + '.'
    : r.consent === 'no' ? 'You said no.' : 'You have not answered yet.';
  const body =
    '<h1>Can you help ' + who + ' if there is an emergency?</h1>' +
    '<p>' + escH(r.by_name || 'Someone') + ' from ' + first + '\'s family asked if you, ' + escH(r.name) + ', would help as someone who lives nearby.</p>' + said +
    '<div class="card"><h2>What Parwah will do</h2>' +
    '<p>Parwah will call you only if ' + first + ' presses SOS, or misses the daily check-in, <b>and</b> nobody in the family can be reached. ' +
    'The call says ' + first + ' may need help, so you can go and check or call them.</p>' +
    '<p>Nothing else. No adverts, no messages about anything else, and your number is never shared outside the family.</p></div>' +
    '<div class="card"><h2>What is kept about you</h2><ul>' +
    '<li>Your name and phone number (ending ' + escH(last4(r.phone)) + ')</li>' +
    (r.distance_note ? '<li>How near you are: ' + escH(r.distance_note) + '</li>' : '<li>How near you are, if the family wrote it</li>') +
    '<li>Whether you have a house key: ' + (r.has_key ? 'yes' : 'no') + '</li>' +
    (r.hours ? '<li>When you are usually free: ' + escH(r.hours) + '</li>' : '') +
    '<li>Your answer, and when you gave it</li></ul>' +
    '<p>Only ' + first + '\'s family on Parwah can see this.</p>' +
    '<h2>How to remove it</h2><p>Open this same link at any time and tap "Stop and delete my details". Everything above is deleted at once. You can also ask the family to remove you.</p></div>' +
    '<p><b>' + status + '</b></p>' +
    '<form method="post">' +
    (r.consent !== 'yes' ? '<button class="go" name="answer" value="yes">Yes, I\'ll help</button>' : '') +
    (r.consent !== 'no' && r.consent !== 'yes' ? '<button name="answer" value="no">No, thank you</button>' : '') +
    (r.consent === 'yes' ? '<button name="answer" value="no">Stop helping, keep my answer</button>' : '') +
    '<button name="answer" value="delete">Stop and delete my details</button>' +
    '</form>';
  return page('Help ' + firstName(r.person_name) + ' nearby', body);
}

export async function consentPage(req, res) {
  let sql;
  try { sql = db(); await ensureLadderSchema(sql); } catch (e) { return send(res, 503, page('Parwah', '<h1>Please try again in a minute</h1>')); }
  try {
    const token = String((req.query && req.query.consent) || '');
    if (!(await rateLimit(sql, 'consent', clientIp(req), 30, 600))) return send(res, 429, page('Parwah', '<h1>Too many tries</h1><p>Please wait a few minutes and open the link again.</p>'));
    const rows = /^[A-Za-z0-9_-]{20,64}$/.test(token)
      ? await sql`select l.id, l.name, l.phone, l.distance_note, l.has_key, l.hours, l.consent, l.consent_at,
                         p.name as person_name, b.name as by_name
                  from nearby_ladder l join members p on p.id = l.person_id
                  left join members b on b.id = l.created_by
                  where l.token_hash = ${hashOf(token)}`
      : [];
    const r = rows[0];
    if (!r) return send(res, 404, page('Parwah', '<h1>This link is not active</h1><p>It may have been replaced by a newer link, or your details were already deleted. Nothing about you is kept under this link.</p>'));
    let said = '';
    if (req.method === 'POST') {
      const answer = String((req.body && req.body.answer) || '');
      if (answer === 'delete') {
        await sql`delete from nearby_ladder where id = ${r.id}`;
        return send(res, 200, page('Parwah', '<h1>Your details are deleted</h1><p>Parwah will not call you for ' + escH(firstName(r.person_name)) + '. The family can see you are no longer on the list. Thank you.</p>'));
      }
      if (answer !== 'yes' && answer !== 'no') return send(res, 400, page('Parwah', '<h1>Please tap one of the buttons</h1>'));
      await sql`update nearby_ladder set consent = ${answer}, consent_at = now() where id = ${r.id}`;
      r.consent = answer; r.consent_at = new Date();
      said = answer === 'yes'
        ? '<p class="ok">Thank you. You are on the list. You can stop at any time from this same link.</p>'
        : '<p class="ok">Thank you for answering. Parwah will not call you.</p>';
    }
    return send(res, 200, consentHtml(r, said));
  } catch (e) {
    try { return send(res, 500, page('Parwah', '<h1>Something went wrong</h1><p>Please open the link again in a minute.</p>')); } catch (x) { return fail(res, e); }
  }
}

// ---------------------------------------------------------------- SOS escalation
// Rides on the same polling as the family's own escalation (events.mjs): an
// SOS still open (nobody in the family pressed "I am on it") after one
// window calls rung 1, after two windows rung 2. Each rung is claimed in the
// database first, so it happens once however many phones are polling.
export async function ladderEscalate(sql, circleId, windowMin, opts = {}) {
  let n = 0;
  try {
    await ensureLadderSchema(sql);
    await sql`create table if not exists sos_ladder (
      sos_id uuid not null references sos(id) on delete cascade,
      rung integer not null,
      helper_id uuid,
      status text,
      at timestamptz not null default now(),
      primary key (sos_id, rung)
    )`;
    const open = await sql`
      select s.id, s.member_id, m.name, m.phone_cc,
             floor(extract(epoch from (now() - s.created_at)) / 60)::int as age
      from sos s join members m on m.id = s.member_id
      where s.circle_id = ${circleId} and s.status = 'open'
        and s.created_at < now() - make_interval(mins => ${windowMin})
        and s.created_at > now() - interval '6 hours'`;
    for (const s of open) {
      const ladder = await ladderFor(sql, circleId, s.member_id);
      const due = Math.min(LADDER_RUNGS, ladder.length, Math.floor(s.age / windowMin));
      for (let i = 0; i < due; i++) {
        const h = ladder[i];
        const claim = await sql`insert into sos_ladder (sos_id, rung, helper_id, status) values (${s.id}, ${i + 1}, ${h.id}, 'claimed')
                                on conflict do nothing returning rung`;
        if (!claim[0]) continue;
        const d = await dialLadder(sql, s.id, h, { name: s.name, cc: s.phone_cc }, opts);
        const st = d.called ? 'called' : d.capped ? 'capped' : d.configured ? 'failed' : 'shown';
        await sql`update sos_ladder set status = ${st} where sos_id = ${s.id} and rung = ${i + 1}`;
        const where = h.distance_note ? ' (' + h.distance_note + ')' : '';
        const text = d.called
          ? '📞 Nobody in the family has answered ' + s.name + "'s SOS, so Parwah is calling " + h.name + where + '.'
          : '📞 Nobody has answered ' + s.name + "'s SOS. " + h.name + where + ' said they can help: call ' + h.phone + '.';
        await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${s.member_id}, 'care', ${text})`;
        await pushCircle(sql, circleId, { title: '📞 ' + (d.called ? 'Calling ' : 'Call ') + h.name + ' for ' + s.name, body: text, url: '/#home', urgent: true }, { except: s.member_id });
        n++;
      }
    }
  } catch (e) { /* escalation never breaks a read */ }
  return n;
}
