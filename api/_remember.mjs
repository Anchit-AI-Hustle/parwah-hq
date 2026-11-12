// DAYS OF REMEMBRANCE: someone in the family tree who is no longer with us.
// Behind /api/circle (it owns the tree), by actions that start remember_.
//
//   POST {code, memberId, action:'remember_mark', targetId, year, month?, day?, line?}
//   POST {code, memberId, action:'remember_undo', targetId}
//
// An adult in the family marks a person, with the year (the day and month
// when known) and one line if they wish. Any adult can undo it. Once marked,
// the person is never offered for a check-in, a nudge, a recommendation or a
// birthday card (those sweeps read the same flag), and the tree shows them
// with a quiet marker in words.
//
// Each year the family is told once, from 6 in the evening the day before
// (or on the day, when no phone was awake that evening). The claim is one
// row per person per year, so two phones never send it twice. The dates are
// worked out in api/_rememberrules.mjs.
import { schemaOnce, isUuid } from './_db.mjs';
import { pushCircle } from './_push.mjs';
import { placeOf } from './_places.mjs';
import { noteRisk } from './_notesapi.mjs';
import { passedClean, remembranceDue, remembranceLine, yearsLine, passedWords, wallIn, isAdult, REMEMBER_LINE_MAX } from './_rememberrules.mjs';

let ready = false;
export async function ensureRememberSchema(sql) {
  if (ready) return;
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  await schemaOnce(() => rememberTables(sql));
  ready = true;
}
async function rememberTables(sql) {
  // The flag itself is older than this module: Family Memory made it, so
  // stories and nudges already leave a remembered person in peace.
  await sql`alter table members add column if not exists remembered boolean not null default false`;
  await sql`alter table members add column if not exists passed_year int`;
  await sql`alter table members add column if not exists passed_month int`;
  await sql`alter table members add column if not exists passed_day int`;
  await sql`alter table members add column if not exists remember_line text`;
  await sql`alter table members add column if not exists remembered_by uuid references members(id) on delete set null`;
  await sql`alter table members add column if not exists remembered_at timestamptz`;
  // The claim: one reminder per person per year.
  await sql`create table if not exists remember_sent (
    member_id uuid not null references members(id) on delete cascade,
    circle_id uuid not null references circles(id) on delete cascade,
    year int not null,
    sent_at timestamptz not null default now(),
    primary key (member_id, year)
  )`;
}

const tzOf = m => placeOf(m && m.place, m && m.country, null).tz;
const passedOf = m => ({ year: m.passed_year || null, month: m.passed_month || null, day: m.passed_day || null });
const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'them';

// The days of remembrance that fall today, for the Today screen. Worked out
// from rows already read, so a poll costs no extra query.
export function rememberToday(members, nowMs = Date.now()) {
  const out = [];
  for (const m of members || []) {
    if (!m || !m.remembered || !m.passed_month || !m.passed_day) continue;
    const due = remembranceDue(passedOf(m), nowMs, tzOf(m));
    if (!due || due.when !== 'day') continue;
    out.push({ id: m.id, name: m.name, years: due.years, title: remembranceLine(m.name, 'day'),
               sub: yearsLine(m.name, due.years), line: m.remember_line || null, passed: passedWords(passedOf(m)) });
  }
  return out;
}

// The timer's share: who is to be remembered tomorrow or today, told once.
export async function sweepRemember(sql, circleId, nowMs = Date.now()) {
  await ensureRememberSchema(sql);
  const rows = await sql`select id, name, place, country, passed_year, passed_month, passed_day from members
                         where circle_id = ${circleId} and remembered and passed_month is not null and passed_day is not null`;
  let sent = 0;
  for (const m of rows) {
    const due = remembranceDue(passedOf(m), nowMs, tzOf(m));
    if (!due) continue;
    const got = await sql`insert into remember_sent (member_id, circle_id, year) values (${m.id}, ${circleId}, ${due.year})
                          on conflict do nothing returning member_id`;
    if (!got[0]) continue;   // another phone, or this evening's earlier tick, told the family
    sent++;
    await pushCircle(sql, circleId, { title: '🪔 ' + remembranceLine(m.name, due.when),
      body: 'A quiet day to remember ' + firstName(m.name) + ', together.', url: '/#home' }, {});
  }
  return sent;
}

const bad = (error, status = 400, extra) => ({ status, json: { ok: false, error, ...(extra || {}) } });
const good = (json, status = 200) => ({ status, json: { ok: true, ...(json || {}) } });

// me: the caller's own membership (ownedMember proved it). circle: {id, kind}.
export async function rememberAction(sql, circle, me, body) {
  await ensureRememberSchema(sql);
  const a = String(body.action || '');
  if (circle.kind === 'group') return bad('A group of friends has no family tree.');
  const today = wallIn(Date.now(), tzOf(me)).date;
  // With the family's care: an adult, on Parwah, decides this.
  if (!isAdult(me.dob, today)) return bad('An adult in the family does this.', 403);
  if (!isUuid(body.targetId)) return bad('Choose someone in this family');
  const t = (await sql`select id, name, remembered, to_char(dob, 'YYYY') as born from members where id = ${body.targetId} and circle_id = ${circle.id}`)[0];
  if (!t) return bad('Choose someone in this family', 404);
  if (t.id === me.id) return bad('This is for someone else in the family.');

  if (a === 'remember_mark') {
    const c = passedClean({ year: body.year, month: body.month, day: body.day }, today, t.born ? +t.born : null);
    if (c.error) return bad(c.error, 400, { field: 'date' });
    const line = String(body.line || '').replace(/\s+/g, ' ').trim();
    if (line.length > REMEMBER_LINE_MAX) return bad('Keep the line to ' + REMEMBER_LINE_MAX + ' letters.', 400, { field: 'line' });
    const risk = noteRisk(line);
    if (risk) return bad(risk, 400, { field: 'line' });
    const p = c.value;
    await sql`update members set remembered = true, passed_year = ${p.year}, passed_month = ${p.month}, passed_day = ${p.day},
                                 remember_line = ${line || null}, remembered_by = ${me.id}, remembered_at = now()
              where id = ${t.id} and circle_id = ${circle.id}`;
    // Nothing is asked of them again. Each of these belongs to a feature a
    // family may never have opened, so a missing table or column is not an
    // error here.
    const quiet = async run => { try { await run(); } catch (e) { if (!(e && (e.code === '42P01' || e.code === '42703'))) throw e; } };
    await quiet(() => sql`update members set checkin_by = null, checkin_ask = null, checkin_ask_by = null where id = ${t.id}`);
    await quiet(() => sql`delete from cards where circle_id = ${circle.id} and auto_key is not null and delivered_at is null
                            and (for_member = ${t.id} or for_member2 = ${t.id})`);
    if (!t.remembered) {
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${'🪔 ' + me.name + ' marked ' + t.name + ' as no longer with us. ' + firstName(t.name) + ' is remembered here.'})`;
    }
    return good({ passed: p, words: passedWords(p), line: line || null });
  }

  if (a === 'remember_undo') {
    const got = await sql`update members set remembered = false, passed_year = null, passed_month = null, passed_day = null,
                                             remember_line = null, remembered_by = null, remembered_at = null
                          where id = ${t.id} and circle_id = ${circle.id} and remembered returning id`;
    if (!got[0]) return good({ already: true });
    await sql`insert into events (circle_id, member_id, type, text)
              values (${circle.id}, ${me.id}, 'care', ${me.name + ' took the "no longer with us" mark off ' + t.name})`;
    return good({});
  }
  return bad('Unknown action');
}
