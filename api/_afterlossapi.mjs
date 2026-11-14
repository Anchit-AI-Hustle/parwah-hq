// "WHAT NEEDS DOING": the checklist for when someone passes away, behind
// /api/book?area=afterloss. The rules are in _afterloss.mjs (pure); this
// file is the database and nothing else.
//
//   GET  ?area=afterloss&circle=CODE&member=ID             every list in this family, and who may start one
//        &person=ID                                        one person's list, with the steps I may see
//   POST {action: afterloss_start, personId, askId}        asks a second adult; alone only if there is none
//                                                          and the person is not on Parwah
//        {action: afterloss_confirm | afterloss_cancel | afterloss_close, listId}
//        {action: afterloss_reopen, listId, askId}         the same rule as starting: a second adult confirms
//        {action: afterloss_tick, listId, key, done}
//        {action: afterloss_assign, listId, key, assignId | null}
//        {action: afterloss_note, listId, key, note}
//
// THE ONE THING THIS FILE MUST NEVER DO is decide who reads a register
// entry. It asks registerRowFor (api/_register.mjs) for every entry and
// every viewer, and it never writes to legacy_asset_locators at all: who
// can see an entry is exactly what it was before the list was started.
// An active list only answers "is it an emergency?" for that one rule, for
// that person's entries (afterlossOpens in _afterloss.mjs).
import { db, requireMember, isUuid, schemaOnce, rateLimit } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { registerRowFor, registerLogsView, registerSecretRisk } from './_register.mjs';
import { ensureCarePrepSchema, registerRows, registerSos, registerLogView, recordAuditEvent } from './_careprep.mjs';
import { noteRisk } from './_notesapi.mjs';
import { rememberRecent, rememberRecentWhy } from './_remember.mjs';
import {
  AFTERLOSS_NAME, AFTERLOSS_SORRY, AFTERLOSS_LEGAL,
  afterlossKey, afterlossIsAdult, afterlossStartRule, afterlossOpens, afterlossInForce, afterlossSteps, afterlossNote, afterlossPush
} from './_afterloss.mjs';

let ready = false;
export async function ensureAfterlossSchema(sql) {
  if (ready) return;
  // The register's tables first: every step from the register reads them.
  await ensureCarePrepSchema(sql);
  // First loads race here (two phones, two screens): see schemaOnce in _db.mjs.
  await schemaOnce(() => afterlossTables(sql));
  ready = true;
}
async function afterlossTables(sql) {
  // One list per person. pending: asked, not yet confirmed. active. closed.
  await sql`create table if not exists afterloss_lists (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    person_id uuid not null references members(id) on delete cascade,
    status text not null default 'pending',
    started_by uuid references members(id) on delete set null,
    started_at timestamptz not null default now(),
    ask_member uuid references members(id) on delete set null,
    confirmed_by uuid references members(id) on delete set null,
    confirmed_at timestamptz,
    closed_by uuid references members(id) on delete set null,
    closed_at timestamptz,
    reopened_by uuid references members(id) on delete set null,
    reopened_at timestamptz,
    unique (circle_id, person_id)
  )`;
  // One row per step that anyone has touched. A tick, an assignment and a
  // note each change only their own columns, in one statement, so two
  // people working at the same moment never undo each other.
  await sql`create table if not exists afterloss_steps (
    list_id uuid not null references afterloss_lists(id) on delete cascade,
    step_key text not null,
    done boolean not null default false,
    done_by uuid references members(id) on delete set null,
    done_at timestamptz,
    assigned_to uuid references members(id) on delete set null,
    assigned_by uuid references members(id) on delete set null,
    note text,
    note_by uuid references members(id) on delete set null,
    updated_at timestamptz not null default now(),
    primary key (list_id, step_key)
  )`;
  // solo: started by the only adult, for someone who is not on Parwah (the
  // one start that needs no second adult). set_remembered: this list is what
  // marked the person as remembered, so voiding it may take the mark off.
  await sql`alter table afterloss_lists add column if not exists solo boolean not null default false`;
  await sql`alter table afterloss_lists add column if not exists set_remembered boolean not null default false`;
  // The flag is older than this module (Family Memory made it). Every sweep
  // that names a person reads it: cards, check-ins, the digest, the album.
  await sql`alter table members add column if not exists remembered boolean not null default false`;
}

// A list that is in force says the person has passed away, so the rest of
// Parwah must stop naming them as if they had not. No date is invented.
// The list remembers whether it was the one that set the mark.
async function markRemembered(sql, circleId, list) {
  const got = await sql`update members set remembered = true where id = ${list.person_id} and circle_id = ${circleId} and not remembered returning id`;
  if (!got[0]) return;
  await sql`update afterloss_lists set set_remembered = true where id = ${list.id}`;
  // A birthday or anniversary card already waiting is taken away. The cards
  // table belongs to a feature a family may never have opened.
  try {
    await sql`delete from cards where circle_id = ${circleId} and auto_key is not null and delivered_at is null
                and (for_member = ${list.person_id} or for_member2 = ${list.person_id})`;
  } catch (e) { if (!(e && (e.code === '42P01' || e.code === '42703'))) throw e; }
}

// The person the list is about closed it: they are alive, it was a mistake.
// The list and its steps go, so it cannot be opened again; a fresh start
// goes through the whole rule. The mark comes off only if this list set it
// and nobody has since written a day of remembrance on top of it.
async function voidList(sql, circleId, list) {
  const gone = await sql`delete from afterloss_lists where id = ${list.id} and circle_id = ${circleId} returning set_remembered`;
  if (!gone[0]) return false;
  if (gone[0].set_remembered) {
    await sql`update members m set remembered = false where m.id = ${list.person_id} and m.circle_id = ${circleId}
                and (to_jsonb(m)->>'remembered_by') is null and (to_jsonb(m)->>'passed_year') is null`;
  }
  return true;
}

// The ask to a second adult is a push, and start, take back, start again
// would be a way to ring someone's phone all day. Three an hour from one
// person about one person; past that the request still stands, quietly.
async function pushAsk(sql, circleId, me, person, askId) {
  if (!(await rateLimit(sql, 'afterloss_ask', me.id + ':' + person.id, 3, 3600, { failClosed: true }))) return;
  await pushCircle(sql, circleId, afterlossPush('ask', { starter: me.name, person: person.name }), { only: askId });
}

// For the register itself (locatorApi): the same answer the checklist
// gives, so an "Only in an emergency" entry reads the same in both places.
// Returns (row, memberId) => boolean. No table yet means no list yet.
export async function afterlossOpener(sql, circleId) {
  try {
    const lists = (await sql`select l.person_id, l.status, l.started_by, l.confirmed_by, l.solo, m.user_id is not null as on_app
                             from afterloss_lists l join members m on m.id = l.person_id
                             where l.circle_id = ${circleId} and l.status = 'active'`).filter(l => afterlossInForce(l, l.on_app));
    if (!lists.length) return () => false;
    const by = new Map(lists.map(l => [l.person_id, l]));
    return (row, memberId) => afterlossOpens(by.get(row.person_id), row, memberId);
  } catch (e) { return () => false; }
}

// Is there a list in force for this person? The writer of an "Only me"
// entry may then choose to share it, because nobody else is left who can.
// In force: active AND confirmed by a second adult, or an allowed start by
// the only adult for someone who is not on Parwah (afterlossInForce).
export async function afterlossActiveFor(sql, circleId, personId) {
  try {
    const r = await sql`select l.status, l.confirmed_by, l.solo, m.user_id is not null as on_app
                        from afterloss_lists l join members m on m.id = l.person_id
                        where l.circle_id = ${circleId} and l.person_id = ${personId} and l.status = 'active'`;
    return !!r[0] && afterlossInForce(r[0], r[0].on_app);
  } catch (e) { return false; }
}

// role, relation, spouse and children are what say "adult" when no date of
// birth was written (afterlossIsAdult).
const circleMembers = (sql, circleId) => sql`select m.id, m.name, m.user_id, m.remembered, to_char(m.dob, 'YYYY-MM-DD') as dob,
                                                    m.role, m.relation, m.spouse_id,
                                                    exists (select 1 from members c where c.parent_id = m.id) as has_child
                                             from members m where m.circle_id = ${circleId} order by m.created_at`;

// SOMEONE WHO USED PARWAH IN THE LAST 30 DAYS is very likely alive: no list
// about them is started, confirmed or opened again. The same guard as the
// "no longer with us" mark (rememberRecent in api/_remember.mjs).
async function recentStop(sql, res, person) {
  if (!person || !(await rememberRecent(sql, person))) return false;
  res.status(409).json({ ok: false, error: rememberRecentWhy(person.name), recent: true });
  return true;
}

function listOut(l, me, members) {
  const name = (id) => { const m = members.find(x => x.id === id); return m ? m.name : null; };
  const adult = afterlossIsAdult(members.find(x => x.id === me.id));
  const subject = me.id === l.person_id;
  return {
    id: l.id, person_id: l.person_id, person_name: name(l.person_id), status: l.status,
    started_by: l.started_by, started_by_name: name(l.started_by), started_at: l.started_at,
    ask_member: l.ask_member, ask_name: name(l.ask_member),
    confirmed_by: l.confirmed_by, confirmed_by_name: name(l.confirmed_by), confirmed_at: l.confirmed_at,
    closed_by_name: name(l.closed_by), closed_at: l.closed_at,
    can_confirm: l.status === 'pending' && l.ask_member === me.id && adult,
    // A request to open a closed list again waits like a first start does.
    reopening: l.status === 'pending' && !!l.closed_at,
    can_cancel: l.status === 'pending' && (l.started_by === me.id || l.ask_member === me.id || subject),
    can_close: l.status === 'active' && (adult || subject),
    can_reopen: l.status === 'closed' && adult && !subject
  };
}

// Everything one viewer may see of one list. Returns the stored rows too,
// so a change to one step can be checked against the same answer.
async function viewOf(sql, circleId, list, me, members) {
  const rows = await registerRows(sql, circleId, { personId: list.person_id });
  const inSos = await registerSos(sql, circleId);
  const person = members.find(m => m.id === list.person_id);
  const inForce = afterlossInForce(list, !!(person && person.user_id));
  const opens = (row, memberId) => inSos.has(row.person_id) || (inForce && afterlossOpens(list, row, memberId));
  const marks = {};
  const stored = await sql`
    select s.step_key, s.done, s.done_at, s.assigned_to, s.note,
           d.name as done_by_name, a.name as assigned_name, n.name as note_by_name
    from afterloss_steps s
    left join members d on d.id = s.done_by
    left join members a on a.id = s.assigned_to
    left join members n on n.id = s.note_by
    where s.list_id = ${list.id}`;
  for (const s of stored) marks[s.step_key] = s;
  const view = afterlossSteps({ rows, viewerId: me.id, rowFor: registerRowFor, opens, marks });
  return { ...view, rows, opens };
}

export default async function afterlossApi(req, res) {
  let sql;
  try {
    sql = db();
    await ensureAfterlossSchema(sql);
  } catch (e) { return failDb(res, e); }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
      const members = await circleMembers(sql, g.circle.id);
      const meRow = members.find(m => m.id === g.me.id);
      const words = { name: AFTERLOSS_NAME, sorry: AFTERLOSS_SORRY, legal: AFTERLOSS_LEGAL };

      if (q.person === undefined) {
        const lists = await sql`select * from afterloss_lists where circle_id = ${g.circle.id} order by started_at`;
        return res.status(200).json({ ok: true, ...words,
          lists: lists.map(l => listOut(l, g.me, members)),
          can_start: afterlossIsAdult(meRow),
          adults: members.filter(m => m.id !== g.me.id && afterlossIsAdult(m)).map(m => ({ id: m.id, name: m.name })) });
      }

      if (!isUuid(q.person) || !members.some(m => m.id === q.person)) return res.status(404).json({ ok: false, error: 'That person is not in this family' });
      const list = (await sql`select * from afterloss_lists where circle_id = ${g.circle.id} and person_id = ${q.person}`)[0];
      const rule = afterlossStartRule({ me: meRow, personId: q.person, members, askId: null });
      // rule.error with field 'ask' only means "now choose the second adult".
      const may = !rule.error || rule.field === 'ask';
      const start = { can_start: !list && may, needs_second: !!(rule.others && rule.others.length),
        adults: (rule.others || []).map(m => ({ id: m.id, name: m.name })), why: may ? null : rule.error };
      const personName = members.find(m => m.id === q.person).name;
      if (!list || list.status === 'pending') {
        return res.status(200).json({ ok: true, ...words, person_id: q.person, person_name: personName,
          list: list ? listOut(list, g.me, members) : null, start, steps: [], progress: null, only_mine: 0 });
      }
      const view = await viewOf(sql, g.circle.id, list, g.me, members);
      // The details of an entry travel with its step: that is a view, and
      // the register writes it down once a day for anyone but its person.
      await Promise.all(view.steps.filter(s => s.part === 'register').map(s => {
        const row = view.rows.find(r => r.id === s.entry_id);
        return row && registerLogsView(row, g.me.id) ? registerLogView(sql, row.id, g.me.id) : null;
      }));
      return res.status(200).json({ ok: true, ...words, person_id: q.person, person_name: personName,
        list: listOut(list, g.me, members), start, steps: view.steps, progress: view.progress, only_mine: view.onlyMine });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const g = await requireMember(sql, body.code, body.memberId, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
      const action = String(body.action || '');
      const members = await circleMembers(sql, g.circle.id);
      const meRow = members.find(m => m.id === g.me.id);
      const audit = (act, listId, details) => recordAuditEvent(sql, { circleId: g.circle.id, actorId: g.me.id, action: act, resource: 'afterloss_list', resourceId: listId, details: details || {} });

      if (action === 'afterloss_start') {
        const person = isUuid(body.personId) ? members.find(m => m.id === body.personId) : null;
        if (!person) return res.status(403).json({ ok: false, error: 'Choose someone in this family' });
        const rule = afterlossStartRule({ me: meRow, personId: person.id, members, askId: isUuid(body.askId) ? body.askId : null });
        if (rule.error) return res.status(rule.status).json({ ok: false, error: rule.error, field: rule.field });
        if (await recentStop(sql, res, person)) return;
        // Two phones starting at once: the family gets one list, not two.
        const made = rule.needs
          ? await sql`insert into afterloss_lists (circle_id, person_id, status, started_by, ask_member)
                      values (${g.circle.id}, ${person.id}, 'pending', ${g.me.id}, ${rule.askId})
                      on conflict (circle_id, person_id) do nothing returning id`
          : await sql`insert into afterloss_lists (circle_id, person_id, status, started_by, confirmed_at, solo)
                      values (${g.circle.id}, ${person.id}, 'active', ${g.me.id}, now(), true)
                      on conflict (circle_id, person_id) do nothing returning id`;
        if (!made[0]) return res.status(409).json({ ok: false, error: 'There is already a list for ' + person.name + '. Open it from the Family register.' });
        await audit('afterloss_start', made[0].id, { person: person.id });
        if (rule.needs) await pushAsk(sql, g.circle.id, g.me, person, rule.askId);
        else {
          await markRemembered(sql, g.circle.id, { id: made[0].id, person_id: person.id });
          await pushCircle(sql, g.circle.id, afterlossPush('started', { starter: g.me.name, person: person.name }), { except: g.me.id });
        }
        return res.status(200).json({ ok: true, id: made[0].id, state: rule.needs ? 'pending' : 'active' });
      }

      const gone = { ok: false, error: 'That list is not here any more' };
      if (!isUuid(body.listId)) return res.status(404).json(gone);
      const list = (await sql`select * from afterloss_lists where id = ${body.listId} and circle_id = ${g.circle.id}`)[0];
      if (!list) return res.status(404).json(gone);
      const can = listOut(list, g.me, members);

      if (action === 'afterloss_confirm') {
        if (list.status !== 'pending') return res.status(409).json({ ok: false, error: 'This has already been answered.' });
        if (!can.can_confirm) return res.status(403).json({ ok: false, error: 'Only ' + (can.ask_name || 'the person who was asked') + ' can confirm this.' });
        // Asked again at the moment it would come into force: they may have
        // opened Parwah since the first adult started this.
        if (await recentStop(sql, res, members.find(m => m.id === list.person_id))) return;
        const r = await sql`update afterloss_lists set status = 'active', confirmed_by = ${g.me.id}, confirmed_at = now()
                            where id = ${list.id} and status = 'pending' and ask_member = ${g.me.id} returning id`;
        if (!r[0]) return res.status(409).json({ ok: false, error: 'This has already been answered.' });
        await audit('afterloss_confirm', list.id);
        await markRemembered(sql, g.circle.id, list);
        // The one push to the family, each time the list comes into force.
        const told = afterlossPush(can.reopening ? 'reopened' : 'started', { starter: can.started_by_name || 'Someone in the family', person: can.person_name, confirmer: g.me.name });
        await pushCircle(sql, g.circle.id, told, { except: g.me.id });
        // The person it is about is now marked as remembered, and a
        // remembered person is never pushed. This is the one exception, at
        // this one moment: if they are alive and reading, this is how they
        // find out and close it.
        await pushCircle(sql, g.circle.id, told, { only: list.person_id, evenRemembered: true });
        return res.status(200).json({ ok: true, state: 'active' });
      }
      if (action === 'afterloss_cancel') {
        if (!can.can_cancel) return res.status(list.status === 'pending' ? 403 : 409).json({ ok: false, error: list.status === 'pending' ? 'Only the two people asked can take this back.' : 'This has already been answered.' });
        if (can.reopening && g.me.id !== list.person_id) {
          // A request to open it again is taken back: the list is closed, as
          // it was, with its ticks. Nothing was open in between.
          await sql`update afterloss_lists set status = 'closed', ask_member = null where id = ${list.id} and status = 'pending'`;
        } else if (can.reopening) {
          await voidList(sql, g.circle.id, list);
        } else {
          await sql`delete from afterloss_lists where id = ${list.id} and status = 'pending'`;
        }
        await audit('afterloss_cancel', list.id);
        return res.status(200).json({ ok: true });
      }
      if (action === 'afterloss_close') {
        if (!can.can_close) return res.status(list.status === 'active' ? 403 : 409).json({ ok: false, error: list.status === 'active' ? 'Only an adult in the family can close this.' : 'This list is not open.' });
        if (g.me.id === list.person_id) {
          // They are alive, so it was a mistake: the list is removed, not kept.
          if (!(await voidList(sql, g.circle.id, list))) return res.status(404).json(gone);
          await audit('afterloss_void', list.id, { person: list.person_id });
          const told = [...new Set([list.started_by, list.confirmed_by].filter(id => id && id !== g.me.id))];
          for (const id of told) await pushCircle(sql, g.circle.id, afterlossPush('void', { person: g.me.name }), { only: id });
          return res.status(200).json({ ok: true, state: 'removed' });
        }
        await sql`update afterloss_lists set status = 'closed', closed_by = ${g.me.id}, closed_at = now() where id = ${list.id} and status = 'active'`;
        await audit('afterloss_close', list.id);
        return res.status(200).json({ ok: true, state: 'closed' });
      }
      if (action === 'afterloss_reopen') {
        if (!can.can_reopen) return res.status(list.status === 'closed' ? 403 : 409).json({ ok: false, error: list.status === 'closed' ? 'Only an adult in the family can open this again.' : 'This list is not closed.' });
        // Exactly the rule for starting: a second adult is named and must
        // say yes. Until then the list is pending and opens nothing.
        const person = members.find(m => m.id === list.person_id);
        const rule = afterlossStartRule({ me: meRow, personId: list.person_id, members, askId: isUuid(body.askId) ? body.askId : null });
        if (rule.error) return res.status(rule.status).json({ ok: false, error: rule.error, field: rule.field });
        if (await recentStop(sql, res, person)) return;
        const state = rule.needs ? 'pending' : 'active';
        const r = await sql`update afterloss_lists set status = ${state}, started_by = ${g.me.id}, ask_member = ${rule.needs ? rule.askId : null},
                              confirmed_by = null, confirmed_at = ${rule.needs ? null : new Date().toISOString()}::timestamptz, solo = ${!rule.needs},
                              reopened_by = ${g.me.id}, reopened_at = now()
                            where id = ${list.id} and status = 'closed' returning id`;
        if (!r[0]) return res.status(409).json({ ok: false, error: 'This list is not closed.' });
        await audit('afterloss_reopen', list.id);
        if (rule.needs) await pushAsk(sql, g.circle.id, g.me, person || { id: list.person_id, name: can.person_name }, rule.askId);
        else await markRemembered(sql, g.circle.id, list);
        return res.status(200).json({ ok: true, state });
      }

      if (action === 'afterloss_tick' || action === 'afterloss_assign' || action === 'afterloss_note') {
        if (list.status === 'closed') return res.status(409).json({ ok: false, error: 'This list is closed. Open it again to change it.' });
        if (list.status !== 'active') return res.status(409).json({ ok: false, error: 'This list has not been confirmed yet.' });
        const k = afterlossKey(body.key);
        const noStep = { ok: false, error: 'That step is not on your list.' };
        if (!k) return res.status(404).json(noStep);
        // A step from the register exists for me only if the register's
        // own rule lets me read the entry. Hidden and missing answer alike.
        let row = null, opens = null;
        if (k.part === 'register') {
          const view = await viewOf(sql, g.circle.id, list, g.me, members);
          if (!view.steps.some(s => s.key === k.key)) return res.status(404).json(noStep);
          row = view.rows.find(r => r.id === k.entryId); opens = view.opens;
        }
        let r;
        if (action === 'afterloss_tick') {
          const done = !!body.done;
          r = await sql`insert into afterloss_steps (list_id, step_key, done, done_by, done_at)
                        select l.id, ${k.key}, ${done}, ${done ? g.me.id : null}, ${done ? new Date().toISOString() : null}::timestamptz
                        from afterloss_lists l where l.id = ${list.id} and l.status = 'active'
                        on conflict (list_id, step_key) do update set done = excluded.done, done_by = excluded.done_by,
                          done_at = excluded.done_at, updated_at = now()
                        returning step_key`;
        } else if (action === 'afterloss_assign') {
          let to = null;
          if (body.assignId != null && body.assignId !== '') {
            const m = isUuid(body.assignId) ? members.find(x => x.id === body.assignId) : null;
            if (!m) return res.status(403).json({ ok: false, error: 'Choose someone in this family' });
            if (m.remembered) return res.status(400).json({ ok: false, error: m.name + ' is remembered here, so cannot be given a step.' });
            if (!m.user_id) return res.status(400).json({ ok: false, error: m.name + ' is not on Parwah yet, so cannot be given a step.' });
            if (m.id === list.person_id) return res.status(400).json({ ok: false, error: 'Choose someone else in the family.' });
            // Whoever does a step must be able to read it: the same rule again.
            if (row) {
              const theirs = registerRowFor(row, m.id, opens(row, m.id));
              if (!theirs || !theirs.can_view) return res.status(400).json({ ok: false, error: m.name + ' cannot see this entry in the register. Share it with them first.' });
            }
            to = m.id;
          }
          r = await sql`insert into afterloss_steps (list_id, step_key, assigned_to, assigned_by)
                        select l.id, ${k.key}, ${to}, ${g.me.id}
                        from afterloss_lists l where l.id = ${list.id} and l.status = 'active'
                        on conflict (list_id, step_key) do update set assigned_to = excluded.assigned_to,
                          assigned_by = excluded.assigned_by, updated_at = now()
                        returning step_key`;
        } else {
          // Never a card number, CVV, OTP, PIN or password, here either.
          const n = afterlossNote(body.note, [noteRisk, registerSecretRisk]);
          if (n.error) return res.status(400).json({ ok: false, error: n.error, field: 'note' });
          r = await sql`insert into afterloss_steps (list_id, step_key, note, note_by)
                        select l.id, ${k.key}, ${n.value}, ${n.value ? g.me.id : null}
                        from afterloss_lists l where l.id = ${list.id} and l.status = 'active'
                        on conflict (list_id, step_key) do update set note = excluded.note,
                          note_by = excluded.note_by, updated_at = now()
                        returning step_key`;
        }
        if (!r[0]) return res.status(409).json({ ok: false, error: 'This list is closed. Open it again to change it.' });
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) { return fail(res, e); }
}
