// THE FAMILY VAULT — the family's identity, health and money papers, in one
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
//  2. A document is invisible — not merely locked — to anyone without a
//     grant. The person it is about and the person who uploaded it always
//     have it; everyone else is added one at a time by the person it is about.
//  3. Every open of a file is written to an access log and the owner is told.
//     Nobody reads a family member's passport quietly.
//  4. Card numbers, CVVs, PINs and passwords are refused outright. Parwah
//     stores a LABEL and a permission — never a credential. The last four
//     digits are the most we will hold.
import { db, ensureSchema, circleByCode, isUuid } from './_db.mjs';
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
// JSON, so `chars` travels as its source text and is rebuilt on the client —
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
  if (/\d[\d\s-]{11,}/.test(v)) return 'Parwah never stores a full card number — please enter only the last four digits';
  if (/\b(cvv|cvc|pin|otp|password)\b/i.test(v)) return 'Parwah never stores a CVV, PIN or password — leave those out';
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
             case when d.about_member = ${me.id} or d.by_member = ${me.id}
                  then 'full' else coalesce(a.level, '') end as my_level
      from vault_docs d
      join members am on am.id = d.about_member
      left join members bm on bm.id = d.by_member
      left join members vm on vm.id = d.verified_by
      left join vault_access a on a.doc_id = d.id and a.member_id = ${me.id}
      where d.circle_id = ${circle.id}
        and (d.about_member = ${me.id} or d.by_member = ${me.id} or a.member_id is not null)
      order by am.name, d.kind limit 300`;
  }
  async function docFor(id, need) {
    if (!isUuid(id)) return { err: 'Bad document id' };
    const r = await sql`
      select d.*, case when d.about_member = ${me.id} or d.by_member = ${me.id}
                       then 'full' else coalesce(a.level, '') end as my_level
      from vault_docs d
      left join vault_access a on a.doc_id = d.id and a.member_id = ${me.id}
      where d.id = ${id} and d.circle_id = ${circle.id}`;
    const d = r[0];
    if (!d || !d.my_level) return { err: 'That document is not shared with you' };
    if (need === 'full' && d.my_level !== 'full') return { err: 'You can see that this exists, but not open it. Ask ' + '' + 'the person it belongs to for access.' };
    return { doc: d };
  }

  if (req.method === 'GET') {
    const docs = await visible();
    const ids = docs.map(d => d.id);
    const grants = ids.length
      ? await sql`select g.doc_id, g.member_id, g.level, m.name
                  from vault_access g join members m on m.id = g.member_id
                  where g.doc_id = any(${ids}::uuid[])`
      : [];
    // The access log is the owner's to read — it is what makes the promise real.
    const mine = docs.filter(d => d.about_member === me.id).map(d => d.id);
    const log = mine.length
      ? await sql`select l.doc_id, l.action, l.at, m.name
                  from vault_log l left join members m on m.id = l.member_id
                  where l.doc_id = any(${mine}::uuid[]) order by l.at desc limit 60`
      : [];
    const members = await sql`select id, name, relation from members where circle_id = ${circle.id} order by created_at`;
    return res.status(200).json({ ok: true, docs, grants, log, members, kinds: DOC_KINDS, idShapes: idShapesForClient(), panHolders: PAN_HOLDER,
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
      if (!/^[A-Za-z0-9+/=\s]+$/.test(fileB64)) return res.status(400).json({ ok: false, error: 'That file could not be read — please try again' });
      fileSize = Math.floor(fileB64.replace(/\s/g, '').length * 3 / 4);
      if (fileSize > MAX_FILE) return res.status(400).json({ ok: false, error: 'That file is larger than 2 MB — please photograph it again at a smaller size' });
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
          body: DOC_KINDS[kind].icon + ' ' + label + ' — only you and ' + me.name + ' can open it until you share it'
        }, { only: aRow[0].id });
      }
      await award(sql, circle.id, me.id, 'vault_add', id);
      return res.status(201).json({ ok: true, id });
    }

    const found = await docFor(body.id, 'full');
    if (found.err) return res.status(403).json({ ok: false, error: found.err });
    // Editing the details resets verification: what was checked is no longer what is stored.
    await sql`update vault_docs set kind = ${kind}, label = ${label}, last4 = ${last4},
              issued_on = ${issued}, expires_on = ${expires}, notes = ${notes}, format_ok = ${fmt},
              status = 'unverified', verified_by = null, verified_at = null, verify_note = null,
              updated_at = now() where id = ${found.doc.id}`;
    if (fileB64) {
      await sql`insert into vault_files (doc_id, bytes) values (${found.doc.id}, decode(${fileB64}, 'base64'))
                on conflict (doc_id) do update set bytes = excluded.bytes`;
      await sql`update vault_docs set file_name = ${fileName}, file_mime = ${fileMime}, file_size = ${fileSize}
                where id = ${found.doc.id}`;
    }
    await sql`insert into vault_log (doc_id, member_id, action) values (${found.doc.id}, ${me.id}, 'edited')`;
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'open') {
    const found = await docFor(body.id, 'full');
    if (found.err) return res.status(403).json({ ok: false, error: found.err });
    const f = await sql`select encode(bytes, 'base64') as b64 from vault_files where doc_id = ${found.doc.id}`;
    if (!f[0]) return res.status(404).json({ ok: false, error: 'No file was uploaded for this document' });
    await sql`insert into vault_log (doc_id, member_id, action) values (${found.doc.id}, ${me.id}, 'opened')`;
    // Nobody reads a family member's papers quietly.
    if (found.doc.about_member !== me.id) {
      await pushCircle(sql, circle.id, {
        title: '🔐 ' + me.name + ' opened your ' + (DOC_KINDS[found.doc.kind] || DOC_KINDS.other).label,
        body: found.doc.label + ' — every open is recorded in your vault'
      }, { only: found.doc.about_member });
    }
    return res.status(200).json({ ok: true, file: f[0].b64, mime: found.doc.file_mime, name: found.doc.file_name });
  }

  if (body.action === 'verify' || body.action === 'reject') {
    const found = await docFor(body.id, 'full');
    if (found.err) return res.status(403).json({ ok: false, error: found.err });
    // Verification means a second pair of eyes. Confirming your own upload is not verification.
    if (found.doc.by_member === me.id && found.doc.about_member !== me.id)
      return res.status(400).json({ ok: false, error: 'You uploaded this one — someone else in the family needs to check it' });
    const status = body.action === 'verify' ? 'verified' : 'rejected';
    const note = clean(body.note, 200);
    await sql`update vault_docs set status = ${status}, verified_by = ${me.id}, verified_at = now(),
              verify_note = ${note}, updated_at = now() where id = ${found.doc.id}`;
    await sql`insert into vault_log (doc_id, member_id, action) values (${found.doc.id}, ${me.id}, ${status})`;
    if (found.doc.about_member !== me.id) {
      await pushCircle(sql, circle.id, {
        title: status === 'verified' ? '✅ ' + me.name + ' checked your document' : '⚠️ ' + me.name + ' flagged a document',
        body: found.doc.label + (note ? ' — ' + note : '')
      }, { only: found.doc.about_member });
    }
    return res.status(200).json({ ok: true });
  }

  // Sharing is the owner's call alone — not the uploader's, not an admin's.
  if (body.action === 'grant' || body.action === 'revoke') {
    if (!isUuid(body.id) || !isUuid(body.memberId)) return res.status(400).json({ ok: false, error: 'Bad request' });
    const r = await sql`select id, label, about_member, kind from vault_docs where id = ${body.id} and circle_id = ${circle.id}`;
    if (!r[0]) return res.status(404).json({ ok: false, error: 'Document not found' });
    if (r[0].about_member !== me.id)
      return res.status(403).json({ ok: false, error: 'Only the person this document belongs to can decide who sees it' });
    const tRow = await sql`select id, name from members where id = ${body.memberId} and circle_id = ${circle.id}`;
    if (!tRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
    if (tRow[0].id === me.id) return res.status(400).json({ ok: false, error: 'It is already yours' });
    if (body.action === 'revoke') {
      await sql`delete from vault_access where doc_id = ${r[0].id} and member_id = ${tRow[0].id}`;
      await sql`insert into vault_log (doc_id, member_id, action) values (${r[0].id}, ${me.id}, ${'revoked ' + tRow[0].name})`;
      await pushCircle(sql, circle.id, { title: '🔐 Access changed', body: me.name + ' has taken back access to ' + r[0].label }, { only: tRow[0].id });
      return res.status(200).json({ ok: true });
    }
    const level = body.level === 'full' ? 'full' : 'view';
    await sql`insert into vault_access (doc_id, member_id, level, granted_by)
              values (${r[0].id}, ${tRow[0].id}, ${level}, ${me.id})
              on conflict (doc_id, member_id) do update set level = excluded.level, granted_by = excluded.granted_by, granted_at = now()`;
    await sql`insert into vault_log (doc_id, member_id, action) values (${r[0].id}, ${me.id}, ${'shared with ' + tRow[0].name + ' (' + level + ')'})`;
    await pushCircle(sql, circle.id, {
      title: '🔐 ' + me.name + ' shared a document with you',
      body: (DOC_KINDS[r[0].kind] || DOC_KINDS.other).icon + ' ' + r[0].label + (level === 'full' ? ' — you can open it' : ' — you can see it exists')
    }, { only: tRow[0].id });
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'remove') {
    const found = await docFor(body.id, 'full');
    if (found.err) return res.status(403).json({ ok: false, error: found.err });
    if (found.doc.about_member !== me.id && found.doc.by_member !== me.id)
      return res.status(403).json({ ok: false, error: 'Only the person it belongs to, or whoever added it, can remove it' });
    await sql`delete from vault_docs where id = ${found.doc.id}`;
    await sql`insert into events (circle_id, member_id, type, text)
              values (${circle.id}, ${me.id}, 'care', ${me.name + ' removed ' + found.doc.label + ' from the family vault'})`;
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
      ? await sql`select l.method_id, l.action, l.amount, l.note, l.at, m.name
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

  // "not everyone may use every mode" — this is that rule, one person at a time.
  if (body.action === 'allow' || body.action === 'disallow') {
    const own = await ownedMethod(body.id);
    if (own.err) return res.status(403).json({ ok: false, error: own.err });
    if (!isUuid(body.memberId)) return res.status(400).json({ ok: false, error: 'Pick a family member' });
    const tRow = await sql`select id, name from members where id = ${body.memberId} and circle_id = ${circle.id}`;
    if (!tRow[0]) return res.status(404).json({ ok: false, error: 'That person is not in this circle' });
    if (tRow[0].id === me.id) return res.status(400).json({ ok: false, error: 'It is already yours to use' });
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
    await sql`insert into pay_log (method_id, member_id, action, amount, note) values (${m.id}, ${me.id}, ${act}, ${amount}, ${note})`;
    if (!isOwner) {
      await pushCircle(sql, circle.id, {
        title: act === 'asked' ? '💳 ' + me.name + ' is asking to use ' + m.label : '💳 ' + me.name + ' used ' + m.label,
        body: '₹' + amount + (note ? ' — ' + note : '')
      }, { only: m.owner_member });
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
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
  try {
    const q = req.query || {}, body = req.body || {};
    const area = String(q.area || body.area || 'vault');
    const code = req.method === 'GET' ? q.circle : body.code;
    const memberId = req.method === 'GET' ? q.member : body.memberId;
    const circle = await circleByCode(sql, code);
    if (!circle) return res.status(404).json({ ok: false, error: 'No circle found with that code' });
    if (!isUuid(memberId)) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    const meRow = await sql`select id, name from members where id = ${memberId} and circle_id = ${circle.id}`;
    if (!meRow[0]) return res.status(403).json({ ok: false, error: 'Not a member of this circle' });
    return area === 'pay'
      ? payApi(req, res, sql, circle, meRow[0])
      : docsApi(req, res, sql, circle, meRow[0]);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
