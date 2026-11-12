// Plans - family get-togethers of every kind: video calls, watch/listen
// parties, dinners, poojas, anything. Call-type plans carry their own video
// room; every plan renders in each member's local timezone client-side.
// GET  /api/plans?circle=CODE&member=UUID → { ok, plans[] } (upcoming)
// POST /api/plans {code, memberId, action:'create'|'rsvp'|'cancel', ...}
// GET  /api/plans?area=split&plan=UUID, POST {action:'split_*'}: the costs of
//      one plan (api/_split.mjs)
import { randomBytes } from 'node:crypto';
import { db, ensureSchema, circleByCode, isUuid , requireMember, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { countError } from './_valid.mjs';
import { whenText } from './_plansweep.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { ensureVisitSchema, visitState, visitAction } from './_visits.mjs';
import { reqTz } from './_recur.mjs';
import { ensureBondSchema, bondState, bondAction, cardRead, entryAudio, thanksAudio } from './_bond.mjs';
import { TOGETHER_KIND, ensureTogetherSchema, togetherPrepare, togetherAnswer, isTogetherAnswer } from './_together.mjs';
import { ensureSplitSchema, splitState, splitAction, splitSettling } from './_split.mjs';

// `together` is watch or listen together (api/_together.mjs): a plan that
// carries a platform and one https link.
const KINDS = ['call', 'party', 'meet', 'appointment', 'function', 'trip', 'other', TOGETHER_KIND];

async function feed(sql, circleId, memberId, text) {
  await sql`insert into events (circle_id, member_id, type, text) values (${circleId}, ${memberId}, 'care', ${text})`;
}

// A room name anyone can guess is a room anyone can walk into: it carried
// the family's invite code and six characters of Math.random. Now 128 random
// bits from the system's own generator, and nothing about the family.
function roomUrl() {
  return 'https://meet.jit.si/parwah-' + randomBytes(16).toString('hex');
}

let plansReady = false;
export default async function handler(req, res) {
  let sql;
  try {
    sql = db(); await ensureSchema(sql);
    // Through schemaOnce: Today now opens two plans reads at once (a visit
    // and the bond state), and on a fresh database the losing "create table"
    // raced the winner and the read came back 503.
    if (!plansReady) await schemaOnce(async () => {
    await sql`create table if not exists plans (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      by_member uuid references members(id) on delete set null,
      title text not null,
      kind text not null default 'call',
      at timestamptz not null,
      place text,
      room text,
      going uuid[] not null default '{}',
      created_at timestamptz not null default now()
    )`;
    await sql`alter table plans add column if not exists expected int`;
    await sql`alter table plans add column if not exists reminded_at timestamptz`;
    });
    // The columns a `together` plan carries, and the tables for splitting a
    // cost: each through schemaOnce, after the plans table they hang from.
    await ensureTogetherSchema(sql);
    await ensureSplitSchema(sql);
    plansReady = true;
  } catch (e) { return failDb(res, e); }

  try {
    const q = req.query || {};
    const body = req.body || {};
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, code, memberId, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const meRow = [_g.me];
    const me = meRow[0];

    // After a doctor's visit (api/_visits.mjs): what was asked for, and what next.
    const area = String(q.area || body.area || '');
    if (area === 'visit' || (typeof body.action === 'string' && /^visit_/.test(body.action))) {
      await ensureVisitSchema(sql);
      if (req.method === 'GET') {
        if (q.person && !isUuid(q.person)) return res.status(400).json({ ok: false, error: 'Bad person' });
        return res.status(200).json({ ok: true, ...(await visitState(sql, circle, me, q.person)) });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
      const out = await visitAction(sql, circle, me, { ...body, tz: body.tz || reqTz(req) });
      return res.status(out.status).json(out.json);
    }

    // Closer together (api/_bond.mjs): date polls, who brings what, shared
    // cards, festivals, things to do on a call, and "I'm in town".
    if (area === 'bond' || (typeof body.action === 'string' && /^bond_/.test(body.action))) {
      await ensureBondSchema(sql);
      if (req.method === 'GET') {
        if (q.card) { const r = await cardRead(sql, circle, me, String(q.card)); return res.status(r.status).json(r.json); }
        if (q.entry) { const r = await entryAudio(sql, circle, me, String(q.entry)); return res.status(r.status).json(r.json); }
        if (q.thanks) { const r = await thanksAudio(sql, circle, me, String(q.thanks), String(q.by || '')); return res.status(r.status).json(r.json); }
        return res.status(200).json({ ok: true, ...(await bondState(sql, circle, me)) });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
      const out = await bondAction(sql, circle, me, { ...body, tz: body.tz || reqTz(req) });
      return res.status(out.status).json(out.json);
    }

    // Splitting the cost of a trip or a function (api/_split.mjs): who paid
    // what, who owes whom, and a two-sided "paid" and "received". Parwah
    // never moves money.
    if (area === 'split' || (typeof body.action === 'string' && /^split_/.test(body.action))) {
      if (req.method === 'GET') {
        const r = await splitState(sql, circle, me, q.plan);
        return res.status(r.status).json(r.json);
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
      const out = await splitAction(sql, circle, me, body);
      return res.status(out.status).json(out.json);
    }

    if (req.method === 'GET') {
      const plans = await sql`
        select p.id, p.title, p.kind, p.at, p.place, p.room, p.going, p.by_member, p.expected,
               p.platform, p.link, p.rec_kind, p.invited, p.maybe, p.cannot,
               b.name as by_name,
               (select string_agg(g.name, ', ') from members g where g.id = any(p.maybe)) as maybe_names,
               (select string_agg(g.name, ', ') from members g where g.id = any(p.cannot)) as cannot_names,
               (select string_agg(g.name, ', ') from members g where g.id = any(p.invited)) as invited_names,
               (select string_agg(g.name, ', ') from members g where g.id = any(p.going)) as going_names
        from plans p left join members b on b.id = p.by_member
        where p.circle_id = ${circle.id} and p.at > now() - interval '3 hours'
        order by p.at asc limit 20`;
      // A trip is settled after it is over. Plans whose time has gone, that
      // I am on, and whose costs are not square yet stay reachable: any age,
      // newest first, at most 20. They are marked `settling` and carry no
      // RSVP. A plan with a square ledger drops off as before.
      const openIds = await splitSettling(sql, circle, me);
      const past = openIds.length ? await sql`
        select p.id, p.title, p.kind, p.at, p.place, p.by_member, b.name as by_name, true as settling
        from plans p left join members b on b.id = p.by_member
        where p.circle_id = ${circle.id} and p.id = any(${openIds}::uuid[])
        order by p.at desc` : [];
      return res.status(200).json({ ok: true, plans, settling: past });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'GET or POST only' });
    }

    if (body.action === 'create') {
      const kind = KINDS.includes(body.kind) ? body.kind : 'other';
      // Watch or listen together: the name, platform and link are checked by
      // api/_together.mjs, and taken from the recommendation when there is one.
      let tg = null;
      if (kind === TOGETHER_KIND) {
        tg = await togetherPrepare(sql, circle, me, body);
        if (tg.error) return res.status(tg.status).json({ ok: false, error: tg.error });
      }
      const title = tg ? tg.title : String(body.title || '').trim().slice(0, 100);
      if (!title) return res.status(400).json({ ok: false, error: 'Give the plan a name' });
      const at = new Date(String(body.at || ''));
      if (isNaN(at) || at < new Date(Date.now() - 60000)) {
        return res.status(400).json({ ok: false, error: 'Pick a date and time in the future' });
      }
      const place = String(body.place || '').trim().slice(0, 120) || null;
      const room = (kind === 'call' || kind === 'party') ? roomUrl() : null;
      const cntErr = countError(body.expected, 50);
      if (cntErr) return res.status(400).json({ ok: false, error: cntErr });
      let expected = parseInt(body.expected, 10);
      expected = (expected >= 2 && expected <= 50) ? expected : null;
      const p = await sql`insert into plans (circle_id, by_member, title, kind, at, place, room, going, expected, platform, link, rec_id, rec_kind, invited)
                          values (${circle.id}, ${me.id}, ${title}, ${kind}, ${at.toISOString()}, ${place}, ${room}, ${'{' + me.id + '}'}, ${expected},
                                  ${tg ? tg.platform : null}, ${tg ? tg.link : null}, ${tg ? tg.recId : null}, ${tg ? tg.recKind : null}, ${tg ? tg.invited : []}::uuid[])
                          returning id`;
      await feed(sql, circle.id, me.id, `${me.name} planned: ${title} 🗓`);
      const whenTxt = whenText(at, body.tz);
      const told = { title: '🗓 ' + me.name + ' planned: ' + title, body: whenTxt + ' - open Parwah to say you are in' };
      // A plan made for named people tells those people; any other plan
      // tells the whole circle, as before.
      if (tg && tg.invited.length) await Promise.allSettled(tg.invited.map(id => pushCircle(sql, circle.id, told, { only: id })));
      else await pushCircle(sql, circle.id, told, { except: me.id });
      return res.status(201).json({ ok: true, id: p[0].id });
    }

    if (body.action === 'rsvp') {
      if (!isUuid(body.planId)) return res.status(400).json({ ok: false, error: 'Bad plan id' });
      const rows = await sql`select id, going, title, by_member from plans where id = ${body.planId} and circle_id = ${circle.id}`;
      if (!rows[0]) return res.status(404).json({ ok: false, error: 'Plan not found' });
      const going = rows[0].going || [];
      // I am in, Maybe, Cannot (api/_together.mjs): the same action with an
      // answer named. Without one it is the old toggle, unchanged.
      if (body.answer !== undefined) {
        if (!isTogetherAnswer(body.answer)) return res.status(400).json({ ok: false, error: 'Pick one answer.' });
        const out = await togetherAnswer(sql, circle, me, rows[0].id, body.answer);
        if (out.status === 200 && body.answer === 'in' && going.indexOf(me.id) < 0) {
          await feed(sql, circle.id, me.id, `${me.name} is in for: ${rows[0].title} 🙌`);
          if (rows[0].by_member && rows[0].by_member !== me.id) {
            await pushCircle(sql, circle.id, { title: '🙌 ' + me.name + ' is coming', body: rows[0].title }, { only: rows[0].by_member });
          }
        }
        return res.status(out.status).json(out.json);
      }
      if (going.indexOf(me.id) >= 0) {
        await sql`update plans set going = array_remove(going, ${me.id}::uuid) where id = ${rows[0].id}`;
        return res.status(200).json({ ok: true, going: false });
      }
      await sql`update plans set going = array_append(going, ${me.id}::uuid) where id = ${rows[0].id}`;
      await feed(sql, circle.id, me.id, `${me.name} is in for: ${rows[0].title} 🙌`);
      if (rows[0].by_member && rows[0].by_member !== me.id) {
        await pushCircle(sql, circle.id, { title: '🙌 ' + me.name + ' is coming', body: rows[0].title }, { only: rows[0].by_member });
      }
      return res.status(200).json({ ok: true, going: true });
    }

    if (body.action === 'cancel') {
      if (!isUuid(body.planId)) return res.status(400).json({ ok: false, error: 'Bad plan id' });
      const rows = await sql`select id, by_member, title from plans where id = ${body.planId} and circle_id = ${circle.id}`;
      if (!rows[0]) return res.status(404).json({ ok: false, error: 'Plan not found' });
      // Every member is an equal admin of the circle - anyone can cancel.
      // But not a plan with costs on it: the costs, the shares and every
      // "paid" and "received" hang from the plan and would go with it.
      const costs = await sql`select 1 as x from plan_costs where plan_id = ${rows[0].id} limit 1`;
      if (costs[0]) return res.status(409).json({ ok: false, error: 'This plan has costs on it. Remove the costs first, or settle up.' });
      // The same check inside the delete, for a cost added in the same moment.
      const gone = await sql`delete from plans where id = ${rows[0].id}
                               and not exists (select 1 from plan_costs k where k.plan_id = plans.id) returning id`;
      if (!gone[0]) return res.status(409).json({ ok: false, error: 'This plan has costs on it. Remove the costs first, or settle up.' });
      await feed(sql, circle.id, me.id, `${me.name} cancelled: ${rows[0].title}`);
      await pushCircle(sql, circle.id, { title: '❌ Plan cancelled', body: me.name + ' cancelled: ' + rows[0].title }, { except: me.id });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return fail(res, e);
  }
}
