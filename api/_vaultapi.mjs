// THE FAMILY VAULT - the family's identity, health and money papers, in one
// place, with a permission on every single one.
//
// Two halves, both routed off /api/book (the plan caps functions):
//   ?area=vault → documents  (Aadhaar, PAN, passport, driving licence,
//                             health records, birth certificates, policies)
//   ?area=pay   → payment methods and WHO in the family may use each one
//
// Privacy rules that are not negotiable, and are enforced here, not in the UI:
//  1. A full identity number is NEVER stored. It is checked for the right
//     shape (Aadhaar Verhoeff checksum, PAN/passport/licence formats) at the
//     moment it is typed, then only the last four digits are kept. The full
//     number lives in the uploaded document, which is permissioned.
//  2. A document is invisible - not merely locked - to anyone without a
//     grant. The person it is about and the person who uploaded it always
//     have it; everyone else is added one at a time by the person it is about.
//  3. Every open of a file is written to an access log and the owner is told.
//     Nobody reads a family member's passport quietly.
//  4. Card numbers, CVVs, PINs and passwords are refused outright. Parwah
//     stores a LABEL and a permission - never a credential. The last four
//     digits are the most we will hold.
import { db, ensureSchema, circleByCode, isUuid , requireMember} from './_db.mjs';
import { fail, failDb } from './_fail.mjs';
import { tokenOf } from './_token.mjs';
import { pushCircle } from './_push.mjs';
import { award } from './_coins.mjs';

const DOC_KINDS = {
  aadhaar:  { label: 'Aadhaar',            icon: '🆔' },
  pan:      { label: 'PAN card',           icon: '🧾' },
  passport: { label: 'Passport',           icon: '🛂' },
  dl:       { label: 'Driving licence',    icon: '🚗' },
  voter:    { label: 'Voter ID',           icon: '🗳' },
  health:   { label: 'Health record',      icon: '🩺' },
  birth:    { label: 'Birth certificate',  icon: '🍼' },
  policy:   { label: 'Insurance policy',   icon: '🛡' },
  will:     { label: 'Will / nomination',  icon: '📜' },
  property: { label: 'Property paper',     icon: '🏠' },
  other:    { label: 'Other document',     icon: '📄' }
};
const PAY_KINDS = {
  upi:        { label: 'UPI',            icon: '📲' },
  card:       { label: 'Card',           icon: '💳' },
  netbanking: { label: 'Net banking',    icon: '🏦' },
  wallet:     { label: 'Wallet',         icon: '👛' },
  autopay:    { label: 'Standing order', icon: '🔁' },
  cash:       { label: 'Cash at home',   icon: '💵' }
};
const MAX_FILE = 2 * 1024 * 1024;               // 2 MB per document

// The field formats and counts as the family types, which means the browser
// needs the same shapes the server checks against. Regexes do not survive
// JSON, so `chars` travels as its source text and is rebuilt on the client -
// one description of an Aadhaar, not two that can drift apart.
function idShapesForClient() {
  const out = {};
  for (const k of Object.keys(DOC_ID)) {
    const d = DOC_ID[k];
    out[k] = { label: d.label, chars: d.chars.source, group: d.group, len: d.len,
               sep: d.sep, example: d.example, inputmode: d.inputmode,
               upper: !!d.upper, hint: d.hint };
  }
  return out;
}
const OK_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

function clean(v, max) { const s = String(v == null ? '' : v).trim().slice(0, max); return s || null; }

// What an Indian ID looks like lives in _docid.mjs, so the field can check
// it as the family types and the server can check it again before storing.
// Re-exported here because that is where it has always been imported from.
import { checkNumber, DOC_ID, PAN_HOLDER } from './_docid.mjs';
export { checkNumber };

// Nothing that could be a live credential is ever accepted into the vault's
// payment half. This is deliberately blunt.
function credentialRisk(s) {
  const v = String(s || '');
  if (/\d[\d\s-]{11,}/.test(v)) return 'Parwah never stores a full card number - please enter only the last four digits';
  if (/\b(cvv|cvc|pin|otp|password)\b/i.test(v)) return 'Parwah never stores a CVV, PIN or password - leave those out';
  return null;
}

export async function ensureVaultSchema(sql) {
  await sql`create table if not exists vault_docs (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    about_member uuid not null references members(id) on delete cascade,
    kind text not null,
    label text not null,
    last4 text,
    issued_on date,
    expires_on date,
    notes text,
    format_ok boolean,
    status text not null default 'unverified',
    verified_by uuid references members(id) on delete set null,
    verified_at timestamptz,
    verify_note text,
    file_name text,
    file_mime text,
    file_size integer,
    by_member uuid references members(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`create index if not exists vault_docs_circle on vault_docs (circle_id, about_member)`;
  await sql`create table if not exists vault_files (
    doc_id uuid primary key references vault_docs(id) on delete cascade,
    bytes bytea not null
  )`;
  await sql`create table if not exists vault_access (
    doc_id uuid not null references vault_docs(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    level text not null default 'view',
    granted_by uuid references members(id) on delete set null,
    granted_at timestamptz not null default now(),
    primary key (doc_id, member_id)
  )`;
  await sql`create table if not exists vault_log (
    id uuid primary key default gen_random_uuid(),
    doc_id uuid references vault_docs(id) on delete cascade,
    member_id uuid references members(id) on delete set null,
    action text not null,
    at timestamptz not null default now()
  )`;
  await sql`create index if not exists vault_log_doc on vault_log (doc_id, at desc)`;
  // Whoever added a document about someone else can open it until the
  // person it belongs to takes that back - shown to them, never hidden.
  await sql`alter table vault_docs add column if not exists uploader_access boolean not null default true`;
  // "Can I open your PAN?" - asked inside Parwah, answered with one tap,
  // instead of a WhatsApp message and a photo of the card.
  await sql`create table if not exists vault_requests (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    from_member uuid not null references members(id) on delete cascade,
    to_member uuid not null references members(id) on delete cascade,
    doc_id uuid references vault_docs(id) on delete cascade,
    kind text,
    status text not null default 'open',
    created_at timestamptz not null default now(),
    answered_at timestamptz
  )`;
  await sql`create index if not exists vault_requests_to on vault_requests (to_member, status)`;
}

export async function ensurePaySchema(sql) {
  await sql`create table if not exists pay_methods (
    id uuid primary key default gen_random_uuid(),
    circle_id uuid not null references circles(id) on delete cascade,
    owner_member uuid not null references members(id) on delete cascade,
    kind text not null,
    label text not null,
    bank text,
    handle text,
    per_txn_cap integer,
    monthly_cap integer,
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`create index if not exists pay_methods_circle on pay_methods (circle_id)`;
  await sql`create table if not exists pay_perms (
    method_id uuid not null references pay_methods(id) on delete cascade,
    member_id uuid not null references members(id) on delete cascade,
    per_txn_cap integer,
    needs_ok boolean not null default false,
    granted_by uuid references members(id) on delete set null,
    granted_at timestamptz not null default now(),
    primary key (method_id, member_id)
  )`;
  await sql`create table if not exists pay_log (
    id uuid primary key default gen_random_uuid(),
    method_id uuid references pay_methods(id) on delete cascade,
    member_id uuid references members(id) on delete set null,
    action text not null,
    amount integer,
    note text,
    at timestamptz not null default now()
  )`;
  await sql`create index if not exists pay_log_method on pay_log (method_id, at desc)`;
  // What each way of paying has spent this month, kept beside the log so
  // the monthly limit is checked and raised in one atomic step.
  await sql`create table if not exists pay_month (
    method_id uuid not null references pay_methods(id) on delete cascade,
    month date not null,
    spent integer not null default 0,
    primary key (method_id, month)
  )`;
}

// ---------------------------------------------------------------- documents
async function docsApi(req, res, sql, circle, me) {
  await ensureVaultSchema(sql);
  const q = req.query || {}, body = req.body || {};

  // Every document the caller is allowed to know exists, with their level.
  async function visible() {
    return sql`
      select d.id, d.kind, d.label, d.last4, d.issued_on, d.expires_on, d.notes,
             d.format_ok, d.status, d.verified_at, d.verify_note,
             d.file_name, d.file_mime, d.file_size, d.about_member, d.by_member,
             d.created_at, d.updated_at,
             am.name as about_name, bm.name as by_name, vm.name as verified_name,
             d.uploader_access, (am.user_id is null) as about_off_app,
             case when d.about_member = ${me.id} or (d.by_member = ${me.id} and d.uploader_access)
                  then 'full' else coalesce(a.level, '') end as my_level
      from vault_docs d
      join members am on am.id = d.about_member
      left join members bm on bm.id = d.by_member
      left join members vm on vm.id = d.verified_by
      left join vault_access a on a.doc_id = d.id and a.member_id = ${me.id}
      where d.circle_id = ${circle.id}
        and (d.about_member = ${me.id} or (d.by_member = ${me.id} and d.uploader_access) or a.member_id is not null)
      order by am.name, d.kind limit 300`;
  }
  async function docFor(id, need) {
    if (!isUuid(id)) return { err: 'Bad document id' };
    const r = await sql`
      select d.*, (am.user_id is null) as about_off_app,
             case when d.about_member = ${me.id} or (d.by_member = ${me.id} and d.uploader_access)
                  then 'full' else coalesce(a.level, '') end as my_level
      from vault_docs d
      join members am on am.id = d.about_member
      left join vault_access a on a.doc_id = d.id and a.member_id = ${me.id}
      where d.id = ${id} and d.circle_id = ${circle.id}`;
    const d = r[0];
    if (!d || !d.my_level) return { err: 'That document is not shared with you' };
    if (need === 'full' && d.my_level !== 'full') return { err: 'You can see that this exists, but not open it. Ask the person it belongs to for access.' };
    return { doc: d };
  }
  // Who decides who opens a document: the person it is about. For someone
  // who is not on Parwah (Dadi without a phone), whoever added it decides.
  const decides = (d) => d.about_off_app ? d.by_member === me.id : d.about_member === me.id;

  if (req.method === 'GET') {
    const docs = await visible();
    const ids = docs.map(d => d.id);
    const grants = ids.length
      ? await sql`select g.doc_id, g.member_id, g.level, m.name
                  from vault_access g join members m on m.id = g.member_id
                  where g.doc_id = any(${ids}::uuid[])`
      : [];
    // The access log is the owner's to read - it is what makes the promise real.
    // The history is for whoever decides: the person it is about, or, for
    // someone not on Parwah, whoever keeps their papers.
    const mine = docs.filter(d => d.about_member === me.id || (d.about_off_app && d.by_member === me.id)).map(d => d.id);
    const log = mine.length
      ? await sql`select l.doc_id, l.action, l.at, m.name
                  from vault_log l left join members m on m.id = l.member_id
                  where l.doc_id = any(${mine}::uuid[]) order by l.at desc limit 60`
      : [];
    const members = await sql`select id, name, relation, user_id is not null as on_app from members where circle_id = ${circle.id} order by created_at`;
    const requests = await sql`
      select r.id, r.doc_id, r.kind, r.status, r.created_at, r.answered_at, r.from_member, r.to_member,
             f.name as from_name, t.name as to_name, d.label as doc_label, d.kind as doc_kind
      from vault_requests r
      join members f on f.id = r.from_member
      join members t on t.id = r.to_member
      left join vault_docs d on d.id = r.doc_id
      where r.circle_id = ${circle.id} and (r.to_member = ${me.id} or r.from_member = ${me.id})
        and (r.status = 'open' or r.answered_at > now() - interval '14 days')
      order by r.created_at desc limit 50`;
    return res.status(200).json({ ok: true, docs, grants, log, members, requests, kinds: DOC_KINDS, idShapes: idShapesForClient(), panHolders: PAN_HOLDER,
      maxFile: MAX_FILE });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'GET or POST only' });
  }

  if (body.action === 'add' || body.action === 'update') {
    const kind = Object.prototype.hasOwnProperty.call(DOC_KINDS, body.kind) ? body.kind : null;
    if (!kind) return res.status(400).json({ ok: false, error: 'Pick what kind of document this is' });
    const label = clean(body.label, 90);
    if (!label) return res.status(400).json({ ok: false, error: 'Give the document a name, e.g. "Papa\'s passport"' });
    if (!isUuid(body.aboutId)) return res.status(400).json({ ok: false, error: 'Say whose document this is' });
    const aRow = await sql`select id, name from members where id = ${body.aboutId} and circle_id = ${circle.id}`;
    if (!aRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
    const chk = checkNumber(kind, body.number);
    if (!chk.ok) return res.status(400).json({ ok: false, error: chk.why });
    const last4 = chk.last4;
    const issued = clean(body.issuedOn, 10);
    const expires = clean(body.expiresOn, 10);
    const notes = clean(body.notes, 300);
    const fmt = body.number ? true : null;

    // The file, if one came with it. Held as bytes beside the row so a
    // document is never a link that outlives its permission.
    let fileB64 = null, fileName = null, fileMime = null, fileSize = null;
    if (body.file) {
      fileMime = clean(body.fileMime, 60);
      if (!OK_MIME.includes(fileMime)) return res.status(400).json({ ok: false, error: 'Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF' });
      fileB64 = String(body.file).replace(/^data:[^,]*,/, '');
      if (!/^[A-Za-z0-9+/=\s]+$/.test(fileB64)) return res.status(400).json({ ok: false, error: 'That file could not be read - please try again' });
      fileSize = Math.floor(fileB64.replace(/\s/g, '').length * 3 / 4);
      if (fileSize > MAX_FILE) return res.status(400).json({ ok: false, error: 'That file is larger than 2 MB - please photograph it again at a smaller size' });
      fileName = clean(body.fileName, 120) || (DOC_KINDS[kind].label + (fileMime === 'application/pdf' ? '.pdf' : '.jpg'));
    }

    if (body.action === 'add') {
      const r = await sql`
        insert into vault_docs (circle_id, about_member, kind, label, last4, issued_on, expires_on,
                                notes, format_ok, file_name, file_mime, file_size, by_member)
        values (${circle.id}, ${aRow[0].id}, ${kind}, ${label}, ${last4}, ${issued}, ${expires},
                ${notes}, ${fmt}, ${fileName}, ${fileMime}, ${fileSize}, ${me.id})
        returning id`;
      const id = r[0].id;
      if (fileB64) await sql`insert into vault_files (doc_id, bytes) values (${id}, decode(${fileB64}, 'base64'))`;
      await sql`insert into vault_log (doc_id, member_id, action) values (${id}, ${me.id}, 'added')`;
      await sql`insert into events (circle_id, member_id, type, text)
                values (${circle.id}, ${me.id}, 'care', ${me.name + ' put ' + label + ' in the family vault ' + DOC_KINDS[kind].icon})`;
      if (aRow[0].id !== me.id) {
        await pushCircle(sql, circle.id, {
          title: '🔐 ' + me.name + ' added a document of yours',
          body: DOC_KINDS[kind].icon + ' ' + label + ' - only you and ' + me.name + ' can open it until you share it'
        }, { only: aRow[0].id });
      }
      await award(sql, circle.id, me.id, 'vault_add', id);
      return res.status(201).json({ ok: true, id });
    }

    const found = await docFor(body.id, 'full');
    if (found.err) return res.status(403).json({ ok: false, error: found.err });
    // "Can open it" is reading, not rewriting: only the person it belongs to,
    // or whoever added it, changes it.
    const d0 = found.doc;
    if (d0.about_member !== me.id && !(d0.by_member === me.id && d0.uploader_access))
      return res.status(403).json({ ok: false, error: 'Only the person it belongs to, or whoever added it, can change it. If something is wrong, say so with "Something is wrong".' });
    // A blank number means "not changing the number": the last 4 stay.
    const keepNum = !String(body.number || '').trim();
    const newLast4 = keepNum ? d0.last4 : last4, newFmt = keepNum ? d0.format_ok : fmt;
    // Editing the details resets verification: what was checked is no longer what is stored.
    await sql`update vault_docs set kind = ${kind}, label = ${label}, last4 = ${newLast4},
              issued_on = ${issued}, expires_on = ${expires}, notes = ${notes}, format_ok = ${newFmt},
              status = 'unverified', verified_by = null, verified_at = null, verify_note = null,
              updated_at = now() where id = ${found.doc.id}`;
    if (fileB64) {
      await sql`insert into vault_files (doc_id, bytes) values (${found.doc.id}, decode(${fileB64}, 'base64'))
                on conflict (doc_id) do update set bytes = excluded.bytes`;
      await sql`update vault_docs set file_name = ${fileName}, file_mime = ${fileMime}, file_size = ${fileSize}
                where id = ${found.doc.id}`;
    }
    await sql`insert into vault_log (doc_id, member_id, action) values (${found.doc.id}, ${me.id}, 'edited')`;
    if (d0.about_member !== me.id) {
      await pushCircle(sql, circle.id, { title: '🔐 ' + me.name + ' changed your ' + (DOC_KINDS[kind] || DOC_KINDS.other).label, body: label + ' - see what changed in your vault' }, { only: d0.about_member });
    }
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'open') {
    const found = await docFor(body.id, 'full');
    if (found.err) return res.status(403).json({ ok: false, error: found.err });
    const f = await sql`select encode(bytes, 'base64') as b64 from vault_files where doc_id = ${found.doc.id}`;
    if (!f[0]) return res.status(404).json({ ok: false, error: 'No file was uploaded for this document' });
    await sql`insert into vault_log (doc_id, member_id, action) values (${found.doc.id}, ${me.id}, 'opened')`;
    // Nobody reads a family member's papers quietly - and for someone not on
    // Parwah, whoever keeps their papers is the one told.
    const tellId = found.doc.about_off_app ? found.doc.by_member : found.doc.about_member;
    if (tellId && tellId !== me.id) {
      await pushCircle(sql, circle.id, {
        title: '🔐 ' + me.name + ' opened your ' + (DOC_KINDS[found.doc.kind] || DOC_KINDS.other).label,
        body: found.doc.label + ' - every open is recorded in your vault'
      }, { only: tellId });
    }
    return res.status(200).json({ ok: true, file: f[0].b64, mime: found.doc.file_mime, name: found.doc.file_name });
  }

  if (body.action === 'verify' || body.action === 'reject') {
    const found = await docFor(body.id, 'full');
    if (found.err) return res.status(403).json({ ok: false, error: found.err });
    // Verification means a second pair of eyes. Confirming your own upload is not verification.
    if (found.doc.by_member === me.id)
      return res.status(400).json({ ok: false, error: 'You uploaded this one - someone else in the family needs to check it' });
    const status = body.action === 'verify' ? 'verified' : 'rejected';
    const note = clean(body.note, 200);
    await sql`update vault_docs set status = ${status}, verified_by = ${me.id}, verified_at = now(),
              verify_note = ${note}, updated_at = now() where id = ${found.doc.id}`;
    await sql`insert into vault_log (doc_id, member_id, action) values (${found.doc.id}, ${me.id}, ${status})`;
    if (found.doc.about_member !== me.id) {
      await pushCircle(sql, circle.id, {
        title: status === 'verified' ? '✅ ' + me.name + ' checked your document' : '⚠️ ' + me.name + ' flagged a document',
        body: found.doc.label + (note ? ' - ' + note : '')
      }, { only: found.doc.about_member });
    }
    return res.status(200).json({ ok: true });
  }

  // Sharing is the owner's call alone - not the uploader's, not an admin's.
  if (body.action === 'grant' || body.action === 'revoke') {
    // THE TARGET IS NOT THE CALLER. Both used to be read from body.memberId,
    // and the client merged the person being shared with OVER the signed-in
    // member, so the owner check compared the target against itself and
    // sharing could never succeed. `targetId` names who is being shared with;
    // `memberId` stays the caller and nothing else.
    const targetId = body.targetId || body.memberId;
    if (!isUuid(body.id) || !isUuid(targetId)) return res.status(400).json({ ok: false, error: 'Bad request' });
    const r = await sql`select d.id, d.label, d.about_member, d.by_member, d.kind, (am.user_id is null) as about_off_app
                        from vault_docs d join members am on am.id = d.about_member
                        where d.id = ${body.id} and d.circle_id = ${circle.id}`;
    if (!r[0]) return res.status(404).json({ ok: false, error: 'Document not found' });
    if (!decides(r[0]))
      return res.status(403).json({ ok: false, error: 'Only the person this document belongs to can decide who sees it' });
    const tRow = await sql`select id, name, user_id from members where id = ${targetId} and circle_id = ${circle.id}`;
    if (!tRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
    if (tRow[0].id === me.id) return res.status(400).json({ ok: false, error: 'It is already yours' });
    if (!tRow[0].user_id) return res.status(400).json({ ok: false, error: tRow[0].name + ' is not on Parwah, so cannot open documents' });
    if (body.action === 'revoke') {
      await sql`delete from vault_access where doc_id = ${r[0].id} and member_id = ${tRow[0].id}`;
      // Whoever added it loses their access too when it is taken back.
      if (tRow[0].id === r[0].by_member) await sql`update vault_docs set uploader_access = false where id = ${r[0].id}`;
      await sql`insert into vault_log (doc_id, member_id, action) values (${r[0].id}, ${me.id}, ${'took access back from ' + tRow[0].name})`;
      await pushCircle(sql, circle.id, { title: '🔐 Access changed', body: me.name + ' has taken back access to ' + r[0].label }, { only: tRow[0].id });
      return res.status(200).json({ ok: true });
    }
    const level = body.level === 'full' ? 'full' : 'view';
    if (tRow[0].id === r[0].by_member) await sql`update vault_docs set uploader_access = ${level === 'full'} where id = ${r[0].id}`;
    await sql`insert into vault_access (doc_id, member_id, level, granted_by)
              values (${r[0].id}, ${tRow[0].id}, ${level}, ${me.id})
              on conflict (doc_id, member_id) do update set level = excluded.level, granted_by = excluded.granted_by, granted_at = now()`;
    await sql`insert into vault_log (doc_id, member_id, action) values (${r[0].id}, ${me.id}, ${(level === 'full' ? 'let ' + tRow[0].name + ' open it' : 'let ' + tRow[0].name + ' see it exists')})`;
    // Any open request for it from them is answered by this.
    await sql`update vault_requests set status = 'allowed', answered_at = now()
              where circle_id = ${circle.id} and from_member = ${tRow[0].id} and status = 'open' and ${level === 'full'}
                and (doc_id = ${r[0].id} or (doc_id is null and kind = ${r[0].kind} and to_member = ${me.id}))`;
    await pushCircle(sql, circle.id, {
      title: '🔐 ' + me.name + ' shared a document with you',
      body: (DOC_KINDS[r[0].kind] || DOC_KINDS.other).icon + ' ' + r[0].label + (level === 'full' ? ' - you can open it' : ' - you can see it exists')
    }, { only: tRow[0].id });
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'remove') {
    const found = await docFor(body.id, 'full');
    if (found.err) return res.status(403).json({ ok: false, error: found.err });
    if (found.doc.about_member !== me.id && !(found.doc.by_member === me.id && found.doc.uploader_access))
      return res.status(403).json({ ok: false, error: 'Only the person it belongs to, or whoever added it, can remove it' });
    await sql`delete from vault_docs where id = ${found.doc.id}`;
    if (found.doc.about_member !== me.id) {
      await pushCircle(sql, circle.id, { title: '🔐 ' + me.name + ' removed your ' + (DOC_KINDS[found.doc.kind] || DOC_KINDS.other).label, body: found.doc.label + ' is no longer in the family vault' }, { only: found.doc.about_member });
    }
    await sql`insert into events (circle_id, member_id, type, text)
              values (${circle.id}, ${me.id}, 'care', ${me.name + ' removed ' + found.doc.label + ' from the family vault'})`;
    return res.status(200).json({ ok: true });
  }

  // ASKING TO OPEN. For a paper you can see exists ("Can I open Rahul's
  // licence?") or one you cannot see at all ("Can I have Rahul's PAN?" -
  // asked by kind, so asking never reveals what is in anyone's vault).
  if (body.action === 'request') {
    let doc = null, toId = body.toId, kind = null;
    if (body.docId) {
      const found = await docFor(body.docId, 'view');
      if (found.err) return res.status(403).json({ ok: false, error: found.err });
      if (found.doc.my_level === 'full') return res.status(400).json({ ok: false, error: 'You can already open it' });
      doc = found.doc;
      toId = doc.about_off_app ? doc.by_member : doc.about_member;
    } else {
      kind = Object.prototype.hasOwnProperty.call(DOC_KINDS, body.kind) ? body.kind : null;
      if (!kind) return res.status(400).json({ ok: false, error: 'Say which paper you need' });
    }
    if (!isUuid(toId)) return res.status(400).json({ ok: false, error: 'Say whose paper you need' });
    const tRow = await sql`select id, name, user_id from members where id = ${toId} and circle_id = ${circle.id}`;
    if (!tRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
    if (tRow[0].id === me.id) return res.status(400).json({ ok: false, error: 'That is your own' });
    if (!tRow[0].user_id) return res.status(400).json({ ok: false, error: tRow[0].name + ' is not on Parwah. Ask whoever keeps their papers.' });
    const open = await sql`select id from vault_requests where circle_id = ${circle.id} and from_member = ${me.id} and to_member = ${tRow[0].id}
                           and status = 'open' and (doc_id = ${doc ? doc.id : null} or (doc_id is null and kind = ${kind}))`;
    if (open[0]) return res.status(200).json({ ok: true, already: true, id: open[0].id });
    const r = await sql`insert into vault_requests (circle_id, from_member, to_member, doc_id, kind)
                        values (${circle.id}, ${me.id}, ${tRow[0].id}, ${doc ? doc.id : null}, ${kind}) returning id`;
    const what = doc ? doc.label : 'your ' + DOC_KINDS[kind].label;
    if (doc) await sql`insert into vault_log (doc_id, member_id, action) values (${doc.id}, ${me.id}, 'asked to open it')`;
    await pushCircle(sql, circle.id, { title: '🔐 ' + me.name + ' asks to open ' + what, body: 'Open Parwah to let them, or say not now' }, { only: tRow[0].id });
    return res.status(201).json({ ok: true, id: r[0].id });
  }
  if (body.action === 'answer') {
    if (!isUuid(body.requestId)) return res.status(400).json({ ok: false, error: 'Bad request' });
    const q2 = await sql`select r.*, f.name as from_name from vault_requests r join members f on f.id = r.from_member
                         where r.id = ${body.requestId} and r.circle_id = ${circle.id}`;
    const rq = q2[0];
    if (!rq || rq.to_member !== me.id) return res.status(404).json({ ok: false, error: 'That request is not for you' });
    if (rq.status !== 'open') return res.status(409).json({ ok: false, error: 'That was already answered' });
    if (!body.allow) {
      // Only an open request can be answered, once: two taps (or two phones)
      // never leave it saying "not now" while access was given.
      const dec = await sql`update vault_requests set status = 'declined', answered_at = now() where id = ${rq.id} and status = 'open' returning id`;
      if (!dec[0]) return res.status(409).json({ ok: false, error: 'That was already answered' });
      await pushCircle(sql, circle.id, { title: '🔐 ' + me.name + ' said not now', body: 'You can ask again, or talk to them' }, { only: rq.from_member });
      return res.status(200).json({ ok: true });
    }
    // Allowing a request by kind means choosing which of your papers.
    const docId = rq.doc_id || body.docId;
    const d = isUuid(docId) ? (await sql`select d.id, d.label, d.kind, d.about_member, d.by_member, (am.user_id is null) as about_off_app
                                          from vault_docs d join members am on am.id = d.about_member
                                          where d.id = ${docId} and d.circle_id = ${circle.id}`)[0] : null;
    if (!d) return res.status(400).json({ ok: false, error: rq.doc_id ? 'That document is no longer in the vault' : 'Choose which document to let them open' });
    if (!decides(d)) return res.status(403).json({ ok: false, error: 'Only the person this document belongs to can decide who sees it' });
    // Claim the request and grant access in one statement: either both
    // happen or neither does.
    const got = await sql`
      with claim as (update vault_requests set status = 'allowed', doc_id = ${d.id}, answered_at = now()
                     where id = ${rq.id} and status = 'open' returning from_member)
      insert into vault_access (doc_id, member_id, level, granted_by)
      select ${d.id}, from_member, 'full', ${me.id} from claim
      on conflict (doc_id, member_id) do update set level = 'full', granted_by = excluded.granted_by, granted_at = now()
      returning member_id`;
    if (!got[0]) return res.status(409).json({ ok: false, error: 'That was already answered' });
    await sql`insert into vault_log (doc_id, member_id, action) values (${d.id}, ${me.id}, ${'let ' + rq.from_name + ' open it'})`;
    await pushCircle(sql, circle.id, { title: '✅ ' + me.name + ' let you open ' + d.label, body: 'It is in the family vault now' }, { only: rq.from_member });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}

// ----------------------------------------------------------------- payments
async function payApi(req, res, sql, circle, me) {
  await ensurePaySchema(sql);
  const body = req.body || {};

  if (req.method === 'GET') {
    const methods = await sql`
      select p.id, p.kind, p.label, p.bank, p.handle, p.per_txn_cap, p.monthly_cap, p.note,
             p.owner_member, p.created_at, m.name as owner_name,
             (p.owner_member = ${me.id}) as mine,
             (p.owner_member = ${me.id} or pp.member_id is not null) as can_use,
             pp.per_txn_cap as my_cap, pp.needs_ok as my_needs_ok
      from pay_methods p
      join members m on m.id = p.owner_member
      left join pay_perms pp on pp.method_id = p.id and pp.member_id = ${me.id}
      where p.circle_id = ${circle.id}
      order by m.name, p.label limit 100`;
    const ids = methods.map(x => x.id);
    const perms = ids.length
      ? await sql`select pp.method_id, pp.member_id, pp.per_txn_cap, pp.needs_ok, m.name
                  from pay_perms pp join members m on m.id = pp.member_id
                  where pp.method_id = any(${ids}::uuid[])`
      : [];
    const log = ids.length
      ? await sql`select l.id, l.method_id, l.member_id, l.action, l.amount, l.note, l.at, m.name
                  from pay_log l left join members m on m.id = l.member_id
                  where l.method_id = any(${ids}::uuid[]) order by l.at desc limit 40`
      : [];
    const members = await sql`select id, name, relation from members where circle_id = ${circle.id} order by created_at`;
    // A handle is only ever shown to its owner and to those allowed to use it.
    methods.forEach(p => { if (!p.can_use) p.handle = p.handle ? '••••' : null; });
    return res.status(200).json({ ok: true, methods, perms, log, members, kinds: PAY_KINDS });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'GET or POST only' });
  }

  async function ownedMethod(id) {
    if (!isUuid(id)) return { err: 'Bad request' };
    const r = await sql`select * from pay_methods where id = ${id} and circle_id = ${circle.id}`;
    if (!r[0]) return { err: 'Payment method not found' };
    if (r[0].owner_member !== me.id) return { err: 'Only ' + 'the person who owns this can change who may use it' };
    return { m: r[0] };
  }

  if (body.action === 'add' || body.action === 'update') {
    const kind = Object.prototype.hasOwnProperty.call(PAY_KINDS, body.kind) ? body.kind : null;
    if (!kind) return res.status(400).json({ ok: false, error: 'Pick the kind of payment method' });
    const label = clean(body.label, 80);
    if (!label) return res.status(400).json({ ok: false, error: 'Name it, e.g. "Papa\'s HDFC UPI"' });
    const handle = clean(body.handle, 60);
    const note = clean(body.note, 200);
    for (const v of [label, handle, note]) {
      const risk = credentialRisk(v);
      if (risk) return res.status(400).json({ ok: false, error: risk });
    }
    const bank = clean(body.bank, 60);
    const perTxn = body.perTxnCap ? Math.max(0, Math.min(10000000, parseInt(body.perTxnCap, 10) || 0)) : null;
    const monthly = body.monthlyCap ? Math.max(0, Math.min(100000000, parseInt(body.monthlyCap, 10) || 0)) : null;
    if (body.action === 'add') {
      const r = await sql`insert into pay_methods (circle_id, owner_member, kind, label, bank, handle, per_txn_cap, monthly_cap, note)
                          values (${circle.id}, ${me.id}, ${kind}, ${label}, ${bank}, ${handle}, ${perTxn}, ${monthly}, ${note})
                          returning id`;
      await sql`insert into pay_log (method_id, member_id, action) values (${r[0].id}, ${me.id}, 'added')`;
      return res.status(201).json({ ok: true, id: r[0].id });
    }
    const own = await ownedMethod(body.id);
    if (own.err) return res.status(403).json({ ok: false, error: own.err });
    await sql`update pay_methods set kind = ${kind}, label = ${label}, bank = ${bank}, handle = ${handle},
              per_txn_cap = ${perTxn}, monthly_cap = ${monthly}, note = ${note}, updated_at = now()
              where id = ${own.m.id}`;
    return res.status(200).json({ ok: true });
  }

  // "not everyone may use every mode" - this is that rule, one person at a time.
  if (body.action === 'allow' || body.action === 'disallow') {
    const own = await ownedMethod(body.id);
    if (own.err) return res.status(403).json({ ok: false, error: own.err });
    // Same collision as grant/revoke: the person being permitted is not the
    // person doing the permitting.
    const targetId = body.targetId || body.memberId;
    if (!isUuid(targetId)) return res.status(400).json({ ok: false, error: 'Pick a family member' });
    const tRow = await sql`select id, name, user_id from members where id = ${targetId} and circle_id = ${circle.id}`;
    if (!tRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
    if (tRow[0].id === me.id) return res.status(400).json({ ok: false, error: 'It is already yours to use' });
    if (!tRow[0].user_id && body.action === 'allow') return res.status(400).json({ ok: false, error: tRow[0].name + ' is not on Parwah, so cannot be allowed to pay' });
    if (body.action === 'disallow') {
      await sql`delete from pay_perms where method_id = ${own.m.id} and member_id = ${tRow[0].id}`;
      await sql`insert into pay_log (method_id, member_id, action, note) values (${own.m.id}, ${me.id}, 'disallowed', ${tRow[0].name})`;
      await pushCircle(sql, circle.id, { title: '💳 Payment access changed', body: me.name + ' has taken back use of ' + own.m.label }, { only: tRow[0].id });
      return res.status(200).json({ ok: true });
    }
    const cap = body.perTxnCap ? Math.max(0, Math.min(10000000, parseInt(body.perTxnCap, 10) || 0)) : null;
    const needsOk = !!body.needsOk;
    await sql`insert into pay_perms (method_id, member_id, per_txn_cap, needs_ok, granted_by)
              values (${own.m.id}, ${tRow[0].id}, ${cap}, ${needsOk}, ${me.id})
              on conflict (method_id, member_id) do update set per_txn_cap = excluded.per_txn_cap,
                needs_ok = excluded.needs_ok, granted_by = excluded.granted_by, granted_at = now()`;
    await sql`insert into pay_log (method_id, member_id, action, amount, note) values (${own.m.id}, ${me.id}, 'allowed', ${cap}, ${tRow[0].name})`;
    await pushCircle(sql, circle.id, {
      title: '💳 ' + me.name + ' let you use ' + own.m.label,
      body: (cap ? 'Up to ₹' + cap + ' per payment' : 'No limit set') + (needsOk ? ' · ask first each time' : '')
    }, { only: tRow[0].id });
    return res.status(200).json({ ok: true });
  }

  // Using someone's money is announced, capped, and written down.
  if (body.action === 'use') {
    if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: 'Bad request' });
    const r = await sql`select p.*, pp.member_id as allowed, pp.per_txn_cap as my_cap, pp.needs_ok
                        from pay_methods p left join pay_perms pp on pp.method_id = p.id and pp.member_id = ${me.id}
                        where p.id = ${body.id} and p.circle_id = ${circle.id}`;
    const m = r[0];
    if (!m) return res.status(404).json({ ok: false, error: 'Payment method not found' });
    const isOwner = m.owner_member === me.id;
    if (!isOwner && !m.allowed) return res.status(403).json({ ok: false, error: 'You are not allowed to use this one' });
    const amount = Math.max(1, Math.min(100000000, parseInt(body.amount, 10) || 0));
    if (!amount) return res.status(400).json({ ok: false, error: 'How much is it for?' });
    const cap = isOwner ? m.per_txn_cap : (m.my_cap || m.per_txn_cap);
    if (cap && amount > cap) return res.status(400).json({ ok: false, error: 'That is over the ₹' + cap + ' limit set for you on ' + m.label });
    const note = clean(body.note, 160);
    const risk = credentialRisk(note);
    if (risk) return res.status(400).json({ ok: false, error: risk });
    const act = (!isOwner && m.needs_ok) ? 'asked' : 'used';
    // The monthly limit the owner set is a limit, not a note: the month's
    // total is raised and the payment written in one statement, so two
    // payments at the same moment cannot both slip under it.
    if (m.monthly_cap) {
      const wrote = await sql`
        with bump as (
          insert into pay_month (method_id, month, spent)
          select ${m.id}, date_trunc('month', now())::date,
                 (select coalesce(sum(amount), 0)::int from pay_log where method_id = ${m.id} and action in ('used', 'approved', 'asked')
                    and at >= date_trunc('month', now())) + ${amount}
          where (select coalesce(sum(amount), 0)::int from pay_log where method_id = ${m.id} and action in ('used', 'approved', 'asked')
                   and at >= date_trunc('month', now())) + ${amount} <= ${m.monthly_cap}
          on conflict (method_id, month) do update set spent = pay_month.spent + ${amount}
            where pay_month.spent + ${amount} <= ${m.monthly_cap}
          returning spent)
        insert into pay_log (method_id, member_id, action, amount, note)
        select ${m.id}, ${me.id}, ${act}, ${amount}, ${note} from bump returning id`;
      if (!wrote[0]) {
        const so = await sql`select spent from pay_month where method_id = ${m.id} and month = date_trunc('month', now())::date`;
        return res.status(400).json({ ok: false, error: 'That would take ' + m.label + ' over its ₹' + m.monthly_cap.toLocaleString('en-IN') + ' limit for this month (₹' + ((so[0] && so[0].spent) || 0).toLocaleString('en-IN') + ' so far)' });
      }
    } else {
      await sql`insert into pay_log (method_id, member_id, action, amount, note) values (${m.id}, ${me.id}, ${act}, ${amount}, ${note})`;
    }
    if (!isOwner) {
      await pushCircle(sql, circle.id, {
        title: act === 'asked' ? '💳 ' + me.name + ' is asking to use ' + m.label : '💳 ' + me.name + ' used ' + m.label,
        body: '₹' + amount + (note ? ' - ' + note : '')
      }, { only: m.owner_member });
    }
    return res.status(200).json({ ok: true, status: act });
  }
  // "Ask first" has an answer: the owner says yes or no to each ask.
  if (body.action === 'approve' || body.action === 'decline') {
    if (!isUuid(body.logId)) return res.status(400).json({ ok: false, error: 'Bad request' });
    const r = await sql`select l.id, l.member_id, l.amount, p.label, p.owner_member from pay_log l join pay_methods p on p.id = l.method_id
                        where l.id = ${body.logId} and p.circle_id = ${circle.id} and l.action = 'asked'`;
    if (!r[0]) return res.status(404).json({ ok: false, error: 'That ask was already answered' });
    if (r[0].owner_member !== me.id) return res.status(403).json({ ok: false, error: 'Only the owner answers' });
    const act = body.action === 'approve' ? 'approved' : 'declined';
    const changed = await sql`update pay_log set action = ${act} where id = ${r[0].id} and action = 'asked' returning id`;
    if (!changed[0]) return res.status(404).json({ ok: false, error: 'That ask was already answered' });
    // Given back to the month it was asked in, not to this one.
    if (act === 'declined') await sql`update pay_month set spent = greatest(0, spent - ${r[0].amount})
                                       where (method_id, month) = (select method_id, date_trunc('month', at)::date from pay_log where id = ${r[0].id})`;
    if (r[0].member_id) {
      await pushCircle(sql, circle.id, {
        title: act === 'approved' ? '💳 ' + me.name + ' said yes' : '💳 ' + me.name + ' said not this time',
        body: '₹' + r[0].amount + ' on ' + r[0].label
      }, { only: r[0].member_id });
    }
    return res.status(200).json({ ok: true, status: act });
  }

  if (body.action === 'remove') {
    const own = await ownedMethod(body.id);
    if (own.err) return res.status(403).json({ ok: false, error: own.err });
    await sql`delete from pay_methods where id = ${own.m.id}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); await ensureSchema(sql); }
  catch (e) { return failDb(res, e); }
  try {
    const q = req.query || {}, body = req.body || {};
    const area = String(q.area || body.area || 'vault');
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    // One authorisation path. The inline version checked only that the
    // UUID belonged to the CIRCLE, never that it belonged to the caller,
    // and every member is shown every other member's UUID.
    const _g = await requireMember(sql, code, memberId, tokenOf(req));
    if (_g.err) return res.status(_g.status).json({ ok: false, error: _g.err, signin: _g.signin });
    const circle = _g.circle;
    const meRow = [_g.me];
    return area === 'pay'
      ? payApi(req, res, sql, circle, meRow[0])
      : docsApi(req, res, sql, circle, meRow[0]);
  } catch (e) {
    return fail(res, e);
  }
}
