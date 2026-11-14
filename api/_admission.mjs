// HOSPITAL ADMISSION: "When Maa is admitted, everyone sees the same status,
// and whoever is at the counter has every paper."
//
// One open admission per person. It holds the hospital, ward or room, the
// treating doctor, the insurer and TPA, the last digits of the policy and
// claim numbers (never the whole number), who in the family is with her now,
// the papers to carry, and a timeline the family taps through. Each step is
// stamped with the time and with who tapped it, and the family gets a push.
// Closing it puts it in the person's history.
//
// Parwah records; it never predicts. No turnaround times, no promised
// outcome: "waiting since 3:10 PM" is a clock, not an estimate.
//
// GET  /api/book?area=admission&circle&member[&person] -> { ok, open[], history[], packet? }
// POST /api/book {area:'admission', action:'admission_open'|'admission_update'|'admission_step'|
//                 'admission_undo'|'admission_with'|'admission_paper'|'admission_close', ...}
import { db, ensureSchema, requireMember, isUuid, schemaOnce } from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { pushTopic } from './_safetyrules.mjs';
import { ensureBookSchema } from './_bookschema.mjs';
import { ensureCarePrepSchema, recordAuditEvent } from './_careprep.mjs';

export const STEPS = [
  { key: 'admitted',          label: 'Admitted' },
  { key: 'preauth_sent',      label: 'Pre-auth sent' },
  { key: 'preauth_approved',  label: 'Pre-auth approved' },
  { key: 'discharge_advised', label: 'Discharge advised' },
  { key: 'final_bill',        label: 'Final bill' },
  { key: 'discharge_done',    label: 'Discharge done' }
];
export const PAPERS = [
  { key: 'id',            label: 'ID proof (Aadhaar or another photo ID)' },
  { key: 'policy',        label: 'Insurance policy or health card' },
  { key: 'prescriptions', label: 'Previous prescriptions' },
  { key: 'reports',       label: 'Recent reports and scans' },
  { key: 'medlist',       label: 'List of medicines (from Health & contacts)' }
];

let ready = false;
export async function ensureAdmissionSchema(sql) {
  if (ready) return;
  await ensureSchema(sql);
  await schemaOnce(() => ensureBookSchema(sql));
  await schemaOnce(() => ensureCarePrepSchema(sql));   // insurance_preauth_packets
  await schemaOnce(async () => {
    await sql`create table if not exists admissions (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      person_id uuid not null references members(id) on delete cascade,
      status text not null default 'open',
      hospital text,
      ward text,
      doctor text,
      insurer text,
      tpa text,
      policy_last4 text,
      claim_last4 text,
      preauth_packet_id uuid references insurance_preauth_packets(id) on delete set null,
      with_now uuid[] not null default '{}',
      steps jsonb not null default '[]'::jsonb,
      papers jsonb not null default '{}'::jsonb,
      opened_by uuid references members(id) on delete set null,
      opened_at timestamptz not null default now(),
      closed_by uuid references members(id) on delete set null,
      closed_at timestamptz,
      updated_at timestamptz not null default now()
    )`;
    await sql`create unique index if not exists admissions_one_open on admissions (person_id) where status = 'open'`;
    await sql`create index if not exists admissions_circle on admissions (circle_id, status, opened_at desc)`;
  });
  ready = true;
}

const clip = (v, n) => { const s = String(v == null ? '' : v).trim().slice(0, n); return s || null; };
// An ID is kept as its last four characters, never whole.
export function last4(v) {
  const s = String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '');
  return s ? s.slice(-4).toUpperCase() : null;
}
const fmtT = (at, tz) => {
  let zone = 'Asia/Kolkata';
  try { if (tz) { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zone = tz; } } catch (e) {}
  return new Date(at).toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
};

async function load(sql, circleId, id) {
  if (!isUuid(id)) return null;
  const r = await sql`select a.*, m.name as person_name from admissions a join members m on m.id = a.person_id
                      where a.id = ${id} and a.circle_id = ${circleId}`;
  return r[0] || null;
}

async function listFor(sql, circleId, personId) {
  const rows = await sql`
    select a.id, a.person_id, a.status, a.hospital, a.ward, a.doctor, a.insurer, a.tpa,
           a.policy_last4, a.claim_last4, a.preauth_packet_id, a.with_now, a.steps, a.papers,
           a.opened_at, a.closed_at, m.name as person_name, ob.name as opened_by_name, cb.name as closed_by_name,
           (select coalesce(json_agg(json_build_object('id', w.id, 'name', w.name) order by w.name), '[]'::json)
              from members w where w.id = any(a.with_now)) as with_names
    from admissions a join members m on m.id = a.person_id
    left join members ob on ob.id = a.opened_by
    left join members cb on cb.id = a.closed_by
    where a.circle_id = ${circleId}
      and (a.status = 'open' or (${personId}::uuid is not null and a.person_id = ${personId}::uuid))
    order by (a.status = 'open') desc, a.opened_at desc limit 30`;
  return { open: rows.filter(r => r.status === 'open'), history: rows.filter(r => r.status !== 'open') };
}

// What the counter will ask for, from what the family recorded and the
// caller may read: the insurance entry, the TPA from the pre-auth packet,
// the emergency contact. A policy number shows only its last four.
async function packetFor(sql, circleId, me, personId) {
  const ins = (await sql`
    select b.name, b.notes from family_book b
    where b.circle_id = ${circleId} and b.kind = 'insurance' and b.about_member = ${personId}
      and (b.visibility = 'circle' or b.about_member = ${me.id} or b.by_member = ${me.id}
           or exists (select 1 from book_access ba where ba.entry_id = b.id and ba.member_id = ${me.id}))
    order by b.updated_at desc limit 1`)[0];
  const pk = (await sql`select id, tpa_name, tpa_toll_free, tpa_cashless_desk_email from insurance_preauth_packets
                        where circle_id = ${circleId} and person_id = ${personId} order by updated_at desc limit 1`)[0];
  const em = (await sql`
    select b.name, b.phone from family_book b
    where b.circle_id = ${circleId} and b.kind = 'contact' and b.category = 'emergency'
      and (b.about_member = ${personId} or b.about_member is null)
      and (b.visibility = 'circle' or b.about_member = ${me.id} or b.by_member = ${me.id}
           or exists (select 1 from book_access ba where ba.entry_id = b.id and ba.member_id = ${me.id}))
    order by (b.about_member = ${personId}) desc nulls last limit 1`)[0];
  return {
    packetId: pk ? pk.id : null,
    insurer: ins ? ins.name : null,
    policyLast4: ins && ins.notes ? last4(ins.notes) : null,
    tpa: pk ? pk.tpa_name : null,
    tpaPhone: pk ? pk.tpa_toll_free : null,
    tpaEmail: pk ? pk.tpa_cashless_desk_email : null,
    emergencyName: em ? em.name : null,
    emergencyPhone: em ? em.phone : null
  };
}

const no = (status, error) => ({ status, json: { ok: false, error } });
const yes = (json, status = 200) => ({ status, json: { ok: true, ...json } });

export async function admissionAction(sql, circle, me, body) {
  const action = body.action;
  const tz = body.tz;

  if (action === 'admission_open') {
    if (!isUuid(body.personId)) return no(400, 'Say who is in hospital');
    const p = (await sql`select id, name from members where id = ${body.personId} and circle_id = ${circle.id}`)[0];
    if (!p) return no(404, 'That person is not in this family');
    const pk = await packetFor(sql, circle.id, me, p.id);
    const steps = [{ key: 'admitted', at: new Date().toISOString(), by: me.id, byName: me.name }];
    let r;
    try {
      r = await sql`
        insert into admissions (circle_id, person_id, hospital, ward, doctor, insurer, tpa, policy_last4, claim_last4,
                                preauth_packet_id, with_now, steps, opened_by)
        values (${circle.id}, ${p.id}, ${clip(body.hospital, 120)}, ${clip(body.ward, 60)}, ${clip(body.doctor, 80)},
                ${clip(body.insurer, 80) || pk.insurer}, ${clip(body.tpa, 80) || pk.tpa},
                ${last4(body.policyNumber) || pk.policyLast4}, ${last4(body.claimNumber)},
                ${pk.packetId}, ${body.withMe === false ? '{}' : '{' + me.id + '}'}, ${JSON.stringify(steps)}::jsonb, ${me.id})
        returning id`;
    } catch (e) {
      if (e && e.code === '23505') {
        return no(409, p.name + ' already has a hospital screen open');
      }
      throw e;
    }
    await sql`insert into events (circle_id, member_id, type, text)
              values (${circle.id}, ${me.id}, 'care', ${'🏥 ' + p.name + ' is in hospital. ' + me.name + ' opened the hospital screen.'})`;
    await pushCircle(sql, circle.id, {
      title: '🏥 ' + p.name + ' is in hospital',
      body: me.name + ' opened the hospital screen' + (clip(body.hospital, 120) ? ' - ' + clip(body.hospital, 120) : '') + '. Open Parwah to see where and who is with ' + p.name + '.',
      url: '/#people', urgent: true, topic: pushTopic('hosp', r[0].id)
    }, { except: me.id });
    return yes({ id: r[0].id }, 201);
  }

  const a = await load(sql, circle.id, body.admissionId);
  if (!a) return no(404, 'That hospital stay is not here');
  if (a.status !== 'open') return no(409, 'This hospital stay is closed');

  if (action === 'admission_update') {
    const f = (k, n) => body[k] !== undefined ? clip(body[k], n) : undefined;
    const v = {
      hospital: f('hospital', 120), ward: f('ward', 60), doctor: f('doctor', 80), insurer: f('insurer', 80), tpa: f('tpa', 80),
      policy_last4: body.policyNumber !== undefined ? last4(body.policyNumber) : undefined,
      claim_last4: body.claimNumber !== undefined ? last4(body.claimNumber) : undefined
    };
    const val = (k) => v[k] === undefined ? a[k] : v[k];
    await sql`update admissions set hospital = ${val('hospital')}, ward = ${val('ward')}, doctor = ${val('doctor')},
                insurer = ${val('insurer')}, tpa = ${val('tpa')}, policy_last4 = ${val('policy_last4')},
                claim_last4 = ${val('claim_last4')}, updated_at = now()
              where id = ${a.id}`;
    return yes({});
  }

  if (action === 'admission_step') {
    const st = STEPS.find(s => s.key === body.step);
    if (!st || st.key === 'admitted') return no(400, 'Pick a step');
    const entry = { key: st.key, at: new Date().toISOString(), by: me.id, byName: me.name };
    // Appended only if that step is not there yet, in one statement: two
    // people tapping "Pre-auth approved" at once make one step, one push.
    const r = await sql`update admissions set steps = steps || ${JSON.stringify([entry])}::jsonb, updated_at = now()
                        where id = ${a.id} and status = 'open'
                          and not exists (select 1 from jsonb_array_elements(steps) e where e->>'key' = ${st.key})
                        returning id`;
    if (!r[0]) return no(409, st.label + ' is already marked');
    const when = fmtT(entry.at, tz);
    await sql`insert into events (circle_id, member_id, type, text)
              values (${circle.id}, ${me.id}, 'care', ${'🏥 ' + a.person_name + ': ' + st.label + ' at ' + when + ' (' + me.name + ')'})`;
    await pushCircle(sql, circle.id, {
      title: '🏥 ' + a.person_name + ': ' + st.label,
      body: 'Marked by ' + me.name + ' at ' + when + '. Open Parwah for the hospital screen.',
      url: '/#people'
    }, { except: me.id });
    return yes({ step: st.key });
  }

  if (action === 'admission_undo') {
    const steps = Array.isArray(a.steps) ? a.steps : [];
    const last = steps[steps.length - 1];
    if (!last || last.key === 'admitted') return no(409, 'Nothing to undo');
    if (body.step && body.step !== last.key) return no(409, 'Only the last step can be undone');
    const r = await sql`update admissions set steps = steps - (jsonb_array_length(steps) - 1), updated_at = now()
                        where id = ${a.id} and steps->(jsonb_array_length(steps) - 1)->>'key' = ${last.key} returning id`;
    if (!r[0]) return no(409, 'This changed a moment ago - have another look');
    const st = STEPS.find(s => s.key === last.key);
    await sql`insert into events (circle_id, member_id, type, text)
              values (${circle.id}, ${me.id}, 'care', ${'🏥 ' + a.person_name + ': ' + me.name + ' took back "' + (st ? st.label : last.key) + '"'})`;
    return yes({});
  }

  if (action === 'admission_with') {
    const target = isUuid(body.targetId) ? body.targetId : me.id;
    const t = (await sql`select id, name from members where id = ${target} and circle_id = ${circle.id}`)[0];
    if (!t) return no(404, 'That person is not in this family');
    if (body.on === false) await sql`update admissions set with_now = array_remove(with_now, ${t.id}::uuid), updated_at = now() where id = ${a.id}`;
    else await sql`update admissions set with_now = array_append(array_remove(with_now, ${t.id}::uuid), ${t.id}::uuid), updated_at = now() where id = ${a.id}`;
    if (body.on !== false) {
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${'🏥 ' + (t.id === me.id ? me.name + ' is' : t.name + ' is') + ' with ' + a.person_name + ' at the hospital now'})`;
    }
    return yes({ on: body.on !== false });
  }

  if (action === 'admission_paper') {
    const p = PAPERS.find(x => x.key === body.key);
    if (!p) return no(400, 'Pick a paper');
    const val = body.have === false ? 'false' : 'true';
    await sql`update admissions set papers = papers || jsonb_build_object(${p.key}::text, ${val}::jsonb), updated_at = now() where id = ${a.id}`;
    return yes({ key: p.key, have: body.have !== false });
  }

  if (action === 'admission_close') {
    const r = await sql`update admissions set status = 'closed', closed_at = now(), closed_by = ${me.id}, with_now = '{}', updated_at = now()
                        where id = ${a.id} and status = 'open' returning id`;
    if (!r[0]) return no(409, 'Already closed');
    await sql`insert into events (circle_id, member_id, type, text)
              values (${circle.id}, ${me.id}, 'care', ${'🏥 ' + me.name + ' closed the hospital screen for ' + a.person_name + '. It is kept in ' + a.person_name + "'s history."})`;
    await pushCircle(sql, circle.id, { title: '🏥 ' + a.person_name + "'s hospital screen is closed", body: 'Closed by ' + me.name + '. It is kept in their history.', url: '/#people' }, { except: me.id });
    return yes({ status: 'closed' });
  }

  return no(400, 'Unknown action');
}

export default async function admissionApi(req, res) {
  let sql;
  try { sql = db(); await ensureAdmissionSchema(sql); } catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const get = req.method === 'GET';
    const g = await requireMember(sql, get ? q.circle : body.code, get ? q.member : body.memberId, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err, signin: g.signin });
    if (get) {
      if (q.person && !isUuid(q.person)) return res.status(400).json({ ok: false, error: 'Bad person' });
      if (q.person) {
        const p = await sql`select id from members where id = ${q.person} and circle_id = ${g.circle.id}`;
        if (!p[0]) return res.status(403).json({ ok: false, error: 'Choose someone in this family' });
      }
      const lists = await listFor(sql, g.circle.id, q.person || null);
      let packet = null;
      if (q.person) {
        packet = await packetFor(sql, g.circle.id, g.me, q.person);
        // Opening the hospital papers is on the person's "who looked" trail.
        if (q.packet) await recordAuditEvent(sql, { circleId: g.circle.id, actorId: g.me.id, action: 'view_emergency_packet', resource: 'insurance_preauth_packet', resourceId: q.person });
      }
      return res.status(200).json({ ok: true, ...lists, packet, steps: STEPS, papers: PAPERS });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'GET or POST only' }); }
    const out = await admissionAction(sql, g.circle, g.me, body);
    return res.status(out.status).json(out.json);
  } catch (e) { return fail(res, e); }
}
