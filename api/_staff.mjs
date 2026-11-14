// HOME STAFF REGISTER.
//
// "Maa taps 'Didi came today'. At month-end I see the salary minus advances,
// and I hear the same morning if the attendant doesn't show."
//
// The people who work in a parent's home, as the family records them: days
// present, leave, advances, and what is owed at month-end with the sum shown
// in plain words. A record for the family only; Parwah pays nobody. The only
// ID kept is its last 4 characters.
//
//   GET  /api/care?area=staff&circle=CODE&member=ID&month=YYYY-MM
//   POST /api/care {action: staff_add | staff_update | staff_remove | staff_mark |
//                   staff_advance | staff_advance_remove | staff_pay | staff_pay_undo}
//
// Not in yet: if nobody has marked a staff member by their expected
// time + LATE_AFTER_MIN on one of their working days, ONE person is told
// once (a claim row per staff per day), while any phone polls: the named
// owner of that record (home_staff.owner_id, the person who added them
// unless the family chose someone else). Not the whole family, and not the
// feed. The owner answers in one tap: "<Name> came" or "On leave today"
// (staff_mark). A day marked in advance as a day off (status 'off', up to
// OFF_AHEAD_DAYS ahead) or as leave is skipped.
//
// Salary, advances, what is due and the ID digits are for adults only: the
// read leaves them out, in SQL, for a child or a teenager, and the money
// actions refuse them (the same under-18 rule as api/_audience.mjs).
import { db, requireMember, isUuid, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { money, currencyOf } from './_money.mjs';
import { reqTz, validTz } from './_recur.mjs';
import { addExpense, ensureExpenseSchema } from './_expenses.mjs';
import { ensureAudienceSchema, minorOf, audienceFor } from './_audience.mjs';

export const STAFF_ROLES = ['attendant', 'cook', 'cleaner', 'driver', 'other'];
export const MARKS = ['came', 'half', 'leave'];
// A day off agreed ahead of time: no alert that day, and no pay cut.
export const OFF_MARK = 'off';
export const OFF_AHEAD_DAYS = 31;
const MONEY_ACTIONS = ['staff_add', 'staff_update', 'staff_remove', 'staff_advance', 'staff_advance_remove', 'staff_pay', 'staff_pay_undo'];
export const LATE_AFTER_MIN = 60;
const LATE_WINDOW_MIN = 240;     // past this, the morning is over: no alert at night
const DAYS_IN_PAY_MONTH = 30;    // a day's pay is the salary over 30, said openly

let ready = false;
export async function ensureStaffSchema(sql) {
  if (ready) return;
  await ensureExpenseSchema(sql);
  await schemaOnce(async () => {
    await sql`create table if not exists home_staff (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      name text not null,
      role text not null default 'other',
      phone text,
      salary numeric(12,2) not null default 0,
      currency text not null default 'INR',
      pay_day integer,
      arrive_time text,
      work_days text not null default '123456',
      paid_leave integer not null default 0,
      id_last4 text,
      tz text not null default 'Asia/Kolkata',
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now()
    )`;
    await sql`create table if not exists staff_attendance (
      staff_id uuid not null references home_staff(id) on delete cascade,
      day date not null,
      status text not null,
      marked_by uuid references members(id) on delete set null,
      marked_at timestamptz not null default now(),
      primary key (staff_id, day)
    )`;
    await sql`create table if not exists staff_advances (
      id uuid primary key default gen_random_uuid(),
      staff_id uuid not null references home_staff(id) on delete cascade,
      circle_id uuid not null references circles(id) on delete cascade,
      on_date date not null,
      amount numeric(12,2) not null,
      note text,
      by_member uuid references members(id) on delete set null,
      created_at timestamptz not null default now()
    )`;
    await sql`create table if not exists staff_pay (
      staff_id uuid not null references home_staff(id) on delete cascade,
      month text not null,
      amount numeric(12,2) not null,
      paid_by uuid references members(id) on delete set null,
      paid_at timestamptz not null default now(),
      expense_id uuid references care_expenses(id) on delete set null,
      primary key (staff_id, month)
    )`;
    await sql`create table if not exists staff_late_alert (
      staff_id uuid not null references home_staff(id) on delete cascade,
      day date not null,
      at timestamptz not null default now(),
      primary key (staff_id, day)
    )`;
    // The one person who hears when this staff member is not in yet.
    await sql`alter table home_staff add column if not exists owner_id uuid references members(id) on delete set null`;
  });
  await ensureAudienceSchema(sql);
  ready = true;
}

const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n); return t || null; };
const pad = (n) => String(n).padStart(2, '0');

// The wall clock where the staff member works.
export function localNow(tz, nowMs = Date.now()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: validTz(tz) || 'Asia/Kolkata', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
  const p = {}; f.formatToParts(new Date(nowMs)).forEach(x => { p[x.type] = x.value; });
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: p.year + '-' + pad(p.month) + '-' + pad(p.day), dow, mins: (+p.hour) * 60 + (+p.minute) };
}
const timeMins = (t) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };

// The month's sum, in words anyone can check.
export function payFor(staff, month, marks, advances) {
  const salary = Number(staff.salary) || 0, cur = staff.currency || 'INR';
  const came = marks.filter(m => m.status === 'came').length;
  const half = marks.filter(m => m.status === 'half').length;
  const leave = marks.filter(m => m.status === 'leave').length;
  const adv = advances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const perDay = salary / DAYS_IN_PAY_MONTH;
  const unpaid = Math.max(0, leave + half * 0.5 - (Number(staff.paid_leave) || 0));
  const cut = Math.round(unpaid * perDay);
  const payable = Math.max(0, Math.round(salary - cut - adv));
  const parts = [money(salary, cur) + ' salary'];
  if (unpaid) parts.push('less ' + unpaid + ' unpaid day' + (unpaid === 1 ? '' : 's') + ' at ' + money(perDay, cur) + ' a day (' + money(cut, cur) + ')');
  if (adv) parts.push('less ' + money(adv, cur) + ' advance' + (advances.length === 1 ? '' : 's'));
  const formula = parts.join(', ') + ' = ' + money(payable, cur);
  const leaveNote = (Number(staff.paid_leave) || 0) ? (staff.paid_leave === 1 ? '1 day of leave a month is paid. ' : staff.paid_leave + ' days of leave a month are paid. ') : '';
  return { month, came, half, leave, advances: Math.round(adv * 100) / 100, perDay: Math.round(perDay * 100) / 100,
           unpaidDays: unpaid, payable, formula, note: leaveNote + 'A day\'s pay is the salary divided by ' + DAYS_IN_PAY_MONTH + '.' };
}

function cleanStaff(b) {
  const name = clip(b.name, 60);
  if (!name) return { error: 'Write their name' };
  const role = STAFF_ROLES.includes(b.role) ? b.role : 'other';
  const phone = b.phone ? String(b.phone).replace(/[^\d+]/g, '') : '';
  if (phone && !/^\+?\d{8,15}$/.test(phone)) return { error: 'That phone number looks too short or too long' };
  const salary = b.salary === undefined || b.salary === '' || b.salary === null ? 0 : Number(b.salary);
  if (!(salary >= 0) || salary > 10000000) return { error: 'Write the monthly salary as a number' };
  const payDay = b.payDay === undefined || b.payDay === '' || b.payDay === null ? null : parseInt(b.payDay, 10);
  if (payDay !== null && !(payDay >= 1 && payDay <= 31)) return { error: 'Pay day is a date from 1 to 31' };
  const arrive = b.arriveTime ? String(b.arriveTime).slice(0, 5) : null;
  if (arrive && timeMins(arrive) === null) return { error: 'Pick the time they usually come' };
  const last4 = b.idLast4 ? String(b.idLast4).replace(/\s/g, '') : '';
  if (last4 && !/^[A-Za-z0-9]{4}$/.test(last4)) return { error: 'Only the last 4 digits of an ID, nothing more' };
  let days = Array.isArray(b.workDays) ? b.workDays.map(Number).filter(d => d >= 0 && d <= 6) : null;
  const workDays = days ? Array.from(new Set(days)).sort().join('') : '123456';
  const paidLeave = b.paidLeave === undefined || b.paidLeave === '' ? 0 : parseInt(b.paidLeave, 10);
  if (!(paidLeave >= 0 && paidLeave <= 10)) return { error: 'Paid leave is 0 to 10 days a month' };
  return { name, role, phone: phone || null, salary, payDay, arrive, last4: last4 || null, workDays, paidLeave };
}

export async function staffApi(req, res) {
  let sql;
  try { sql = db(); await ensureStaffSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
      await sweepStaffLate(sql, g.circle.id);
      // Money and ID digits are read only for an adult: the query itself
      // returns null for a child or a teenager.
      const adult = !(await minorOf(sql, g.circle.id, g.me.id));
      const staff = await sql`select s.id, s.name, s.role, s.phone, case when ${adult}::boolean then s.salary end as salary, s.currency,
                                     case when ${adult}::boolean then s.pay_day end as pay_day, s.arrive_time, s.work_days,
                                     case when ${adult}::boolean then s.paid_leave end as paid_leave,
                                     case when ${adult}::boolean then s.id_last4 end as id_last4, s.tz, s.created_at,
                                     coalesce(s.owner_id, s.created_by) as owner_id, o.name as owner_name
                              from home_staff s left join members o on o.id = coalesce(s.owner_id, s.created_by)
                              where s.circle_id = ${g.circle.id} order by s.created_at`;
      const tz = reqTz(req);
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(q.month || '')) ? String(q.month) : localNow(tz).date.slice(0, 7);
      const ids = staff.map(s => s.id);
      const marks = ids.length ? await sql`select staff_id, day::text as day, status from staff_attendance
                                           where staff_id = any(${ids}) and to_char(day, 'YYYY-MM') = ${month}` : [];
      const advs = ids.length ? await sql`select id, staff_id, on_date::text as on_date, amount, note from staff_advances
                                          where staff_id = any(${ids}) and to_char(on_date, 'YYYY-MM') = ${month} and ${adult}::boolean order by on_date` : [];
      const paid = ids.length ? await sql`select p.staff_id, p.amount, p.paid_at, m.name as paid_name, p.expense_id from staff_pay p
                                          left join members m on m.id = p.paid_by where p.staff_id = any(${ids}) and p.month = ${month} and ${adult}::boolean` : [];
      // "Not in yet", for the owner only, until someone marks the day.
      const lates = ids.length ? await sql`select a.staff_id, a.day::text as day from staff_late_alert a join home_staff s on s.id = a.staff_id
                                           where a.staff_id = any(${ids}) and a.day >= current_date - 1 and coalesce(s.owner_id, s.created_by) = ${g.me.id}` : [];
      const todays = ids.length ? await sql`select staff_id, day::text as day, status from staff_attendance
                                            where staff_id = any(${ids}) and day >= current_date - 1 and day <= current_date + 1` : [];
      const out = staff.map(s => {
        const ln = localNow(s.tz);
        const t = todays.find(x => x.staff_id === s.id && x.day === ln.date);
        const mk = marks.filter(x => x.staff_id === s.id), av = advs.filter(x => x.staff_id === s.id);
        return { ...s, today: ln.date, todayStatus: t ? t.status : null, workingToday: String(s.work_days).includes(String(ln.dow)),
                 mineToAnswer: s.owner_id === g.me.id,
                 lateToday: !t && lates.some(x => x.staff_id === s.id && x.day === ln.date),
                 marks: mk, advanceList: av, pay: adult ? payFor(s, month, mk, av) : null, paid: paid.find(p => p.staff_id === s.id) || null };
      });
      return res.status(200).json({ ok: true, month, adult, staff: out, roles: STAFF_ROLES });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    const b = req.body || {};
    const g = await requireMember(sql, b.code, b.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    const circle = g.circle, me = g.me;
    // Adding people, pay and advances are for the adults. Marking who came
    // today is for anyone at home.
    if (MONEY_ACTIONS.includes(b.action) && await minorOf(sql, circle.id, me.id)) {
      return res.status(403).json({ ok: false, error: 'An adult in the family keeps the register.' });
    }
    // The named owner: an adult of this family who is on Parwah.
    const ownerFor = async (id) => {
      if (id === undefined || id === null || id === '' || id === 'me') return { id: me.id };
      const okIds = await audienceFor(sql, circle.id, 'staff_late', { only: isUuid(id) ? id : '00000000-0000-0000-0000-000000000000' });
      return okIds[0] ? { id: okIds[0] } : { error: 'Choose an adult in the family who is on Parwah to hear about this person' };
    };

    if (b.action === 'staff_add') {
      const c = cleanStaff(b);
      if (c.error) return res.status(400).json({ ok: false, error: c.error });
      const n = await sql`select count(*)::int as n from home_staff where circle_id = ${circle.id}`;
      if (n[0].n >= 20) return res.status(400).json({ ok: false, error: 'Up to 20 people in the register' });
      const cur = currencyOf((await sql`select country from members where id = ${me.id}`)[0]?.country) || 'INR';
      const own = await ownerFor(b.ownerId);
      if (own.error) return res.status(400).json({ ok: false, error: own.error });
      const r = await sql`insert into home_staff (circle_id, name, role, phone, salary, currency, pay_day, arrive_time, work_days, paid_leave, id_last4, tz, created_by, owner_id)
                          values (${circle.id}, ${c.name}, ${c.role}, ${c.phone}, ${c.salary}, ${cur}, ${c.payDay}, ${c.arrive}, ${c.workDays},
                                  ${c.paidLeave}, ${c.last4}, ${reqTz(req) || 'Asia/Kolkata'}, ${me.id}, ${own.id}) returning id`;
      return res.status(201).json({ ok: true, id: r[0].id, ownerId: own.id });
    }

    const s = isUuid(b.staffId) ? (await sql`select * from home_staff where id = ${b.staffId} and circle_id = ${circle.id}`)[0] : null;
    if (/^staff_/.test(b.action) && b.action !== 'staff_advance_remove' && !s) {
      return res.status(isUuid(b.staffId) ? 404 : 400).json({ ok: false, error: 'That person is not in the register' });
    }

    if (b.action === 'staff_update') {
      const c = cleanStaff({ ...s, salary: s.salary, payDay: s.pay_day, arriveTime: s.arrive_time, idLast4: s.id_last4,
                             workDays: String(s.work_days).split('').map(Number), paidLeave: s.paid_leave, ...b });
      if (c.error) return res.status(400).json({ ok: false, error: c.error });
      await sql`update home_staff set name = ${c.name}, role = ${c.role}, phone = ${c.phone}, salary = ${c.salary}, pay_day = ${c.payDay},
                arrive_time = ${c.arrive}, work_days = ${c.workDays}, paid_leave = ${c.paidLeave}, id_last4 = ${c.last4}
                where id = ${s.id}`;
      if (b.ownerId !== undefined) {
        const own = await ownerFor(b.ownerId);
        if (own.error) return res.status(400).json({ ok: false, error: own.error });
        await sql`update home_staff set owner_id = ${own.id} where id = ${s.id}`;
      }
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'staff_remove') {
      await sql`delete from home_staff where id = ${s.id}`;
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'staff_mark') {
      const ln = localNow(s.tz);
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || '')) ? String(b.day) : ln.date;
      const ageDays = (Date.parse(ln.date) - Date.parse(day)) / 86400000;
      // A day off is the one thing marked ahead of time, so that morning
      // brings no "not in yet".
      if (b.status === OFF_MARK) {
        if (!(ageDays <= 0 && ageDays >= -OFF_AHEAD_DAYS)) return res.status(400).json({ ok: false, error: 'A day off is today or a day in the next month' });
        await sql`insert into staff_attendance (staff_id, day, status, marked_by) values (${s.id}, ${day}, ${OFF_MARK}, ${me.id})
                  on conflict (staff_id, day) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now()`;
        return res.status(200).json({ ok: true, status: OFF_MARK, day });
      }
      if (b.status === 'clear' && ageDays < 0 && ageDays >= -OFF_AHEAD_DAYS) {
        await sql`delete from staff_attendance where staff_id = ${s.id} and day = ${day} and status = ${OFF_MARK}`;
        return res.status(200).json({ ok: true, status: null });
      }
      if (!(ageDays >= 0 && ageDays <= 45)) return res.status(400).json({ ok: false, error: 'Mark today or a day in the last six weeks' });
      if (b.status === 'clear') {
        await sql`delete from staff_attendance where staff_id = ${s.id} and day = ${day}`;
        return res.status(200).json({ ok: true, status: null });
      }
      if (!MARKS.includes(b.status)) return res.status(400).json({ ok: false, error: 'Came, Half day or Leave' });
      await sql`insert into staff_attendance (staff_id, day, status, marked_by) values (${s.id}, ${day}, ${b.status}, ${me.id})
                on conflict (staff_id, day) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now()`;
      return res.status(200).json({ ok: true, status: b.status, day });
    }
    if (b.action === 'staff_advance') {
      const amount = Math.round(Number(b.amount) * 100) / 100;
      if (!(amount > 0) || amount > 10000000) return res.status(400).json({ ok: false, error: 'Write the advance as a number above 0' });
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.onDate || '')) ? String(b.onDate) : localNow(s.tz).date;
      const r = await sql`insert into staff_advances (staff_id, circle_id, on_date, amount, note, by_member)
                          values (${s.id}, ${circle.id}, ${day}, ${amount}, ${clip(b.note, 120)}, ${me.id}) returning id`;
      // No amount in the feed: everyone reads it, children included.
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' noted an advance in the home staff register'})`;
      return res.status(201).json({ ok: true, id: r[0].id });
    }
    if (b.action === 'staff_advance_remove') {
      if (!isUuid(b.id)) return res.status(400).json({ ok: false, error: 'That advance could not be found' });
      const r = await sql`delete from staff_advances where id = ${b.id} and circle_id = ${circle.id} returning id`;
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That advance is not here any more' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'staff_pay') {
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(b.month || '')) ? String(b.month) : localNow(s.tz).date.slice(0, 7);
      const mk = await sql`select status from staff_attendance where staff_id = ${s.id} and to_char(day, 'YYYY-MM') = ${month}`;
      const av = await sql`select amount from staff_advances where staff_id = ${s.id} and to_char(on_date, 'YYYY-MM') = ${month}`;
      const sum = payFor(s, month, mk, av);
      const amount = b.amount !== undefined && b.amount !== null && b.amount !== '' ? Math.round(Number(b.amount) * 100) / 100 : sum.payable;
      if (!(amount >= 0) || amount > 10000000) return res.status(400).json({ ok: false, error: 'Write the amount paid as a number' });
      const claim = await sql`insert into staff_pay (staff_id, month, amount, paid_by) values (${s.id}, ${month}, ${amount}, ${me.id})
                              on conflict do nothing returning staff_id`;
      if (!claim[0]) return res.status(200).json({ ok: true, already: true });
      let expenseId = null;
      if (b.alsoExpense !== false && amount > 0) {
        const ex = await addExpense(sql, circle, me, { amount, currency: s.currency, allowAnyCurrency: true, category: 'staff',
          note: s.name + ' salary ' + month, staffId: s.id, tz: s.tz });
        expenseId = ex.json && ex.json.id || null;
        if (expenseId) await sql`update staff_pay set expense_id = ${expenseId} where staff_id = ${s.id} and month = ${month}`;
      }
      return res.status(201).json({ ok: true, amount, expenseId });
    }
    if (b.action === 'staff_pay_undo') {
      const month = String(b.month || '');
      const r = await sql`delete from staff_pay where staff_id = ${s.id} and month = ${month} returning expense_id`;
      if (!r[0]) return res.status(404).json({ ok: false, error: 'That month is not marked paid' });
      if (r[0].expense_id) await sql`delete from care_expenses where id = ${r[0].expense_id} and circle_id = ${circle.id}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown staff action' });
  } catch (e) { return fail(res, e); }
}

// One alert per staff member per day, on their working days only, if
// nobody has marked them by the expected time + LATE_AFTER_MIN. The insert
// is the lock: a second phone polling finds the row and sends nothing.
// A day already marked (came, leave, or a day off agreed ahead) is skipped.
// The alert goes to ONE person, the named owner, never to the whole family
// and never into the feed.
export async function sweepStaffLate(sql, circleId, nowMs = Date.now()) {
  let n = 0;
  try {
    await ensureStaffSchema(sql);
    const rows = await sql`select id, name, role, arrive_time, work_days, tz, coalesce(owner_id, created_by) as owner_id from home_staff
                           where circle_id = ${circleId} and arrive_time is not null`;
    for (const s of rows) {
      const ln = localNow(s.tz, nowMs), at = timeMins(s.arrive_time);
      if (at === null || !String(s.work_days).includes(String(ln.dow))) continue;
      const late = ln.mins - at;
      if (late < LATE_AFTER_MIN || late > LATE_AFTER_MIN + LATE_WINDOW_MIN) continue;
      const claim = await sql`insert into staff_late_alert (staff_id, day)
                              select ${s.id}, ${ln.date}::date
                              where not exists (select 1 from staff_attendance where staff_id = ${s.id} and day = ${ln.date}::date)
                              on conflict do nothing returning staff_id`;
      if (!claim[0]) continue;
      const who = s.name + (s.role && s.role !== 'other' ? ' (' + s.role + ')' : '');
      const body = who + ' was expected at ' + s.arrive_time + ' and is not marked in yet. Tap to say they came, or that they are on leave today.';
      // The owner, if they are an adult on Parwah; otherwise the first adult
      // who is. One person either way.
      let to = s.owner_id ? await audienceFor(sql, circleId, 'staff_late', { only: s.owner_id }) : [];
      if (!to.length) to = (await audienceFor(sql, circleId, 'staff_late')).slice(0, 1);
      if (to[0]) await pushCircle(sql, circleId, { kind: 'care', title: '🕘 ' + s.name + ' not marked in yet', body, url: '/#care' }, { only: to[0] });
      n++;
    }
  } catch (e) { /* never breaks a read */ }
  return n;
}
