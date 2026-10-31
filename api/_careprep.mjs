// ADVANCED CARE & PREPAREDNESS ENGINE
//
// "WhatsApp is where the family talks. Parwah is where the family knows."
//
// Seven modular domains built on top of the family circle and memory:
// 1. Predictive Medicine Refill & Stockout Engine
// 2. BiomarkerRecord & Trendline (Reports to Charts)
// 3. Cashless Hospitalization & TPA Emergency Admission Packet
// 4. Voice-First Audio Ingestion & Intent Extraction with Confirmation Loop
// 5. "Care Wallet" & Utility Bill Remote Delegation
// 6. "When I'm Not Here" (Physical Asset & Locker Locator)
// 7. Sibling Co-Care Backlog & Task Delegation
// 8. DPDP Audit Events & Access Transparency

import { randomUUID } from 'node:crypto';
import { currencyOf, money } from './_money.mjs';

export function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
}

let schemaReady = false;

// ---------------------------------------------------------------------------
// 0. SCHEMA & MIGRATIONS
// ---------------------------------------------------------------------------

export async function ensureCarePrepSchema(sql) {
  if (schemaReady) return;
  // These tables point at circles, members, family_book and vault_docs. On a fresh
  // database none of those existed yet when refill, bills or biomarkers
  // was the first thing opened, and each answered 503 until something
  // else had made them.
  const { ensureSchema, schemaOnce } = await import('./_db.mjs');
  const { ensureBookSchema } = await import('./_bookschema.mjs');
  const { ensureVaultSchema } = await import('./_vaultapi.mjs');
  await ensureSchema(sql);
  // Care tools are often the first thing a fresh family opens, several at
  // once: the vault tables can lose that race (see schemaOnce).
  await schemaOnce(() => ensureBookSchema(sql));
  await schemaOnce(() => ensureVaultSchema(sql));
  try {
    // 1. Medicine Inventory & Refill Tracking
    await sql`create table if not exists medicine_inventory (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      medicine_id uuid references family_book(id) on delete cascade,
      medicine_name text not null,
      total_units_in_pack integer not null default 30,
      units_remaining float not null default 30,
      daily_consumption_rate float not null default 1.0,
      estimated_depletion_date timestamptz,
      refill_threshold_days integer not null default 5,
      preferred_pharmacy_id uuid references family_book(id) on delete set null,
      preferred_pharmacy_name text,
      preferred_pharmacy_phone text,
      auto_remind_refill boolean not null default true,
      snoozed_until timestamptz,
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_verified_at timestamptz not null default now(),
      visibility text not null default 'family'
    )`;
    await sql`create index if not exists idx_med_inv_circle on medicine_inventory (circle_id, member_id)`;

    // 2. Biomarker Records & Trendline
    await sql`create table if not exists biomarker_records (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      person_id uuid not null references members(id) on delete cascade,
      document_id uuid references vault_docs(id) on delete set null,
      biomarker_type text not null,
      value float not null,
      unit text not null,
      reference_range_low float,
      reference_range_high float,
      test_date timestamptz not null default now(),
      lab_name text,
      verified_by_user boolean not null default false,
      notes text,
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_verified_at timestamptz not null default now(),
      visibility text not null default 'family'
    )`;
    await sql`create index if not exists idx_biomarkers_person on biomarker_records (person_id, test_date desc)`;

    // 3. Insurance Pre-Auth Packets
    await sql`create table if not exists insurance_preauth_packets (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      person_id uuid not null references members(id) on delete cascade,
      insurance_policy_id uuid references family_book(id) on delete set null,
      tpa_name text not null,
      tpa_toll_free text,
      tpa_cashless_desk_email text,
      network_hospitals_cache jsonb default '[]'::jsonb,
      kyc_documents_bundle jsonb default '[]'::jsonb,
      pre_auth_form_template_url text,
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_verified_at timestamptz not null default now(),
      visibility text not null default 'family'
    )`;
    await sql`create index if not exists idx_preauth_person on insurance_preauth_packets (person_id)`;

    // 4. Care Bills & Remote Delegation
    await sql`create table if not exists care_bills (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      person_id uuid references members(id) on delete set null,
      bill_category text not null,
      biller_name text not null,
      consumer_number text,
      amount_due numeric(10,2) not null default 0,
      due_date timestamptz,
      assigned_payer_id uuid references members(id) on delete set null,
      payment_status text not null default 'PENDING',
      proof_attachment_id uuid references vault_docs(id) on delete set null,
      settled_at timestamptz,
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_verified_at timestamptz not null default now(),
      visibility text not null default 'family'
    )`;
    await sql`create index if not exists idx_care_bills_circle on care_bills (circle_id, payment_status)`;
    // The biller's own UPI ID (India only), and who settled it.
    await sql`alter table care_bills add column if not exists upi_id text`;
    await sql`alter table care_bills add column if not exists settled_by uuid references members(id) on delete set null`;

    // 5. Legacy Asset Locator ("When I'm Not Here")
    await sql`create table if not exists legacy_asset_locators (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      person_id uuid not null references members(id) on delete cascade,
      asset_category text not null,
      institution_or_item text not null,
      identifier_mask text,
      physical_location_notes text not null,
      designated_recipients jsonb default '[]'::jsonb,
      unlock_policy text not null default 'IMMEDIATE',
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_verified_at timestamptz not null default now(),
      visibility text not null default 'family'
    )`;
    await sql`create index if not exists idx_asset_loc_person on legacy_asset_locators (person_id)`;

    // 6. Sibling Care Tasks & Backlog
    await sql`create table if not exists sibling_care_tasks (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      subject_person_id uuid references members(id) on delete cascade,
      title text not null,
      category text not null default 'CHECK_IN',
      assigned_to_id uuid references members(id) on delete set null,
      due_date timestamptz,
      status text not null default 'OPEN',
      notes text,
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_verified_at timestamptz not null default now(),
      visibility text not null default 'family'
    )`;
    await sql`create index if not exists idx_sibling_tasks on sibling_care_tasks (circle_id, status)`;

    // 7. Audio Consultation Summaries
    await sql`create table if not exists audio_consultations (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      person_id uuid not null references members(id) on delete cascade,
      doctor_id uuid references family_book(id) on delete set null,
      audio_file_url text,
      transcript_raw text,
      action_items jsonb default '{}'::jsonb,
      recorded_at timestamptz not null default now(),
      created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_verified_at timestamptz not null default now(),
      visibility text not null default 'family'
    )`;

    // 8. Audit Trail (DPDP compliance)
    await sql`create table if not exists audit_events (
      id uuid primary key default gen_random_uuid(),
      circle_id uuid not null references circles(id) on delete cascade,
      actor_id uuid references members(id) on delete set null,
      action text not null,
      resource text not null,
      resource_id uuid,
      details jsonb default '{}'::jsonb,
      timestamp timestamptz not null default now(),
      ip_fingerprint text
    )`;
    await sql`create index if not exists idx_audit_circle on audit_events (circle_id, timestamp desc)`;

    schemaReady = true;
  } catch (err) {
    // Concurrent table creation safety
    if (!/already exists/i.test(err.message)) throw err;
    schemaReady = true;
  }
}

// ---------------------------------------------------------------------------
// 1. MEDICINE INVENTORY & REFILL TRACKING
// ---------------------------------------------------------------------------

export function calculateDepletion(unitsRemaining, dailyRate) {
  const rate = Math.max(0.1, Number(dailyRate) || 1.0);
  const units = Math.max(0, Number(unitsRemaining) || 0);
  const daysLeft = Math.floor(units / rate);
  const depletionDate = new Date(Date.now() + daysLeft * 86400000);
  return { daysLeft, depletionDate };
}

export function isStockoutWarningDue(unitsRemaining, dailyRate, thresholdDays = 5, snoozedUntil = null) {
  if (snoozedUntil && new Date(snoozedUntil) > new Date()) return false;
  const { daysLeft } = calculateDepletion(unitsRemaining, dailyRate);
  return daysLeft <= thresholdDays;
}

export function formatRefillAlert(personName, medicineName, daysLeft) {
  const dayStr = daysLeft <= 0 ? 'exhausted' : daysLeft === 1 ? '1 day' : daysLeft + ' days';
  return `${personName} has ${dayStr} of ${medicineName} remaining.`;
}

export function formatChemistWhatsAppOrder(chemistPhone, personName, medicineName, packUnits = 30) {
  const phone = String(chemistPhone || '').replace(/\D/g, '');
  const msg = `Hi, please deliver a refill of ${medicineName} (${packUnits} tablets/units) for ${personName}.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

// ---------------------------------------------------------------------------
// 2. BIOMARKER RECORD & TRENDLINE PARSING
// ---------------------------------------------------------------------------

export const BIOMARKER_META = {
  HBA1C:                 { label: 'HbA1c',               unit: '%',       low: 4.0,  high: 5.6 },
  FASTING_GLUCOSE:       { label: 'Fasting Blood Sugar', unit: 'mg/dL',   low: 70,   high: 99 },
  POST_PRANDIAL_GLUCOSE: { label: 'PP Blood Sugar',      unit: 'mg/dL',   low: 70,   high: 140 },
  CREATININE:            { label: 'Serum Creatinine',    unit: 'mg/dL',   low: 0.7,  high: 1.3 },
  TSH:                   { label: 'TSH',                 unit: 'uIU/mL',  low: 0.4,  high: 4.5 },
  TOTAL_CHOLESTEROL:     { label: 'Total Cholesterol',   unit: 'mg/dL',   low: 125,  high: 200 },
  LDL:                   { label: 'LDL Cholesterol',     unit: 'mg/dL',   low: 50,   high: 100 },
  HDL:                   { label: 'HDL Cholesterol',     unit: 'mg/dL',   low: 40,   high: 60 },
  TRIGLYCERIDES:         { label: 'Triglycerides',       unit: 'mg/dL',   low: 50,   high: 150 },
  SYSTOLIC_BP:           { label: 'Systolic BP',         unit: 'mmHg',    low: 90,   high: 120 },
  DIASTOLIC_BP:          { label: 'Diastolic BP',        unit: 'mmHg',    low: 60,   high: 80 },
  HEMOGLOBIN:            { label: 'Hemoglobin',          unit: 'g/dL',    low: 12.0, high: 16.0 },
  PLATELETS:             { label: 'Platelet Count',      unit: '10^3/uL', low: 150,  high: 450 }
};

export function parseBiomarkersFromText(reportText) {
  const text = String(reportText || '');
  const results = [];
  const patterns = [
    { type: 'HBA1C',                 re: /(?:hba1c|glycated\s+hemoglobin)[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:%)/i },
    { type: 'FASTING_GLUCOSE',       re: /(?:fasting\s+(?:blood\s+)?(?:sugar|glucose)|fbs)[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:mg\/dl)?/i },
    { type: 'POST_PRANDIAL_GLUCOSE', re: /(?:post\s*prandial|ppbs|pp\s+glucose)[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:mg\/dl)?/i },
    { type: 'CREATININE',            re: /(?:serum\s+)?creatinine[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:mg\/dl)?/i },
    { type: 'TSH',                   re: /(?:tsh|thyroid\s+stimulating)[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:u?iu\/ml|u?u\/ml)?/i },
    { type: 'TOTAL_CHOLESTEROL',     re: /total\s+cholesterol[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:mg\/dl)?/i },
    { type: 'LDL',                   re: /ldl(?:\s+cholesterol)?[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:mg\/dl)?/i },
    { type: 'HDL',                   re: /hdl(?:\s+cholesterol)?[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:mg\/dl)?/i },
    { type: 'TRIGLYCERIDES',         re: /triglycerides?[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:mg\/dl)?/i },
    { type: 'HEMOGLOBIN',            re: /(?:hemoglobin|hb)[\s:=]+([0-9]+(?:\.[0-9]+)?)\s*(?:g\/dl)?/i },
    { type: 'PLATELETS',             re: /platelet\s+count[\s:=]+([0-9]+(?:\.[0-9]+)?)/i }
  ];

  // Blood Pressure check (e.g. "BP: 130/85" or "130/85 mmHg")
  const bpMatch = text.match(/(?:bp|blood\s+pressure)?[\s:=]*([0-9]{2,3})\s*[\/|\\]\s*([0-9]{2,3})\s*(?:mm\s*hg)?/i);
  if (bpMatch && Number(bpMatch[1]) > 50 && Number(bpMatch[2]) > 30) {
    results.push({
      biomarker_type: 'SYSTOLIC_BP',
      value: Number(bpMatch[1]),
      unit: 'mmHg',
      reference_range_low: 90,
      reference_range_high: 120
    });
    results.push({
      biomarker_type: 'DIASTOLIC_BP',
      value: Number(bpMatch[2]),
      unit: 'mmHg',
      reference_range_low: 60,
      reference_range_high: 80
    });
  }

  for (const item of patterns) {
    const m = text.match(item.re);
    if (m && m[1]) {
      const meta = BIOMARKER_META[item.type] || {};
      results.push({
        biomarker_type: item.type,
        value: Number(m[1]),
        unit: meta.unit || '',
        reference_range_low: meta.low,
        reference_range_high: meta.high
      });
    }
  }

  // Detect Lab Name
  let labName = null;
  if (/lal\s*path/i.test(text)) labName = 'Dr. Lal PathLabs';
  else if (/srl/i.test(text)) labName = 'SRL Diagnostics';
  else if (/apollo/i.test(text)) labName = 'Apollo Diagnostics';
  // Word-bound, with what follows: "max" alone matched "maximum" and
  // "Max. value" on any report and named a lab nobody had used.
  else if (/\bmax\s+(healthcare|hospitals?|labs?|lab\b|path)/i.test(text)) labName = 'Max Healthcare';
  else if (/metropolis/i.test(text)) labName = 'Metropolis Healthcare';

  return { biomarkers: results, labName };
}

// ---------------------------------------------------------------------------
// 3. CASHLESS HOSPITALIZATION & TPA EMERGENCY PACKET
// ---------------------------------------------------------------------------

export function buildEmergencyAdmissionPacket(person, policy, tpa, networkHospitals = [], kycBundle = {}) {
  const pName = person ? person.name : 'Family Member';
  const insName = policy ? policy.name : 'Health Insurance';
  const polNum = policy && policy.notes ? policy.notes : 'Available in Vault';

  // Only what the family recorded: no made-up helpline, email or hospital.
  const tpaName = tpa && tpa.name ? tpa.name : null;
  const tpaPhone = tpa ? (tpa.phone || tpa.tollFree || null) : null;
  const tpaEmail = tpa ? (tpa.email || null) : null;

  const hospitals = networkHospitals.length > 0 ? networkHospitals : [];

  const shareText = `*Emergency Cashless Admission Packet*\n` +
    `Patient: ${pName}\n` +
    `Insurer: ${insName}\n` +
    `Policy / Member Ref: ${polNum}\n` +
    (tpaName || tpaPhone ? `TPA Help Desk: ${tpaName || 'TPA'}${tpaPhone ? ' (' + tpaPhone + ')' : ''}\n` : '') +
    (tpaEmail ? `Cashless Desk Email: ${tpaEmail}\n` : '') +
    `Senior ID (Masked): ${kycBundle.aadhaarMask || 'Recorded in Vault'}`;

  return {
    person_id: person ? person.id : null,
    person_name: pName,
    policy_name: insName,
    policy_number: polNum,
    tpa_name: tpaName,
    tpa_phone: tpaPhone,
    tpa_email: tpaEmail,
    network_hospitals: hospitals,
    kyc_bundle: kycBundle,
    share_text: shareText
  };
}

// ---------------------------------------------------------------------------
// 4. VOICE-FIRST AUDIO INGESTION & INTENT EXTRACTION
// ---------------------------------------------------------------------------

// WHAT WAS SAID, AS A TO-DO. "Papa ki BP tablet subah 9 baje" came back as
// "The doctor changed a medicine. Should I update the family schedule to
// subah 9?": nobody had mentioned a doctor, or a change. Every answer now
// carries a plain task made only of the words that were said, and a time
// when one was said; a change to a medicine is read only when a change was
// actually said.
const VOICE_KIN = /^\s*(papa|pappa|mummy|mumma|mom|mum|maa|dad|daddy|dadi|dadima|dada|dadaji|nani|nanima|nana|nanaji|amma|ammi|abba|abbu|pitaji|mataji|bhaiya|didi)\b/i;
export function voiceTime(text) {
  const t = String(text || '');
  const m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(baje|bje|am|pm|a\.m\.|p\.m\.|o'?clock)\b/i)
         || t.match(/\bat\s+(\d{1,2})(?:[:.](\d{2}))?\b/i);
  if (!m) return null;
  let h = +m[1]; const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return null;
  const tag = String(m[3] || '').toLowerCase().replace(/\./g, '');
  const evening = /\b(shaam|sham|raat|evening|night|tonight)\b/i.test(t);
  const afternoon = /\b(dopahar|dopehar|afternoon)\b/i.test(t);
  if (tag === 'pm' && h < 12) h += 12;
  else if (tag === 'am' && h === 12) h = 0;
  else if (tag !== 'am' && tag !== 'pm' && h < 12 && (evening || (afternoon && h < 7))) h += 12;
  const hh = String(h).padStart(2, '0'), mm = String(min).padStart(2, '0');
  const h12 = h % 12 || 12;
  return { time: hh + ':' + mm, said: h12 + (min ? ':' + mm : '') + (h < 12 ? ' am' : ' pm') };
}
// "Papa ki BP tablet subah 9 baje" -> "Papa: BP tablet at 9 am".
export function voiceTask(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const when = voiceTime(t);
  const kin = t.match(VOICE_KIN);
  let rest = kin ? t.slice(kin[0].length).replace(/^\s*(ki|ka|ke|ko)\b/i, '') : t;
  // The time is said once, at the end, so its words come out of the rest:
  // only when a time was actually found, so "Kal sham ko..." keeps "sham".
  if (when) {
    rest = rest
      .replace(/\b(?:at\s+)?\d{1,2}(?:[:.]\d{2})?\s*(?:baje|bje|am|pm|a\.m\.|p\.m\.|o'?clock)(?=\s|$|[,.;!?])/ig, ' ')
      .replace(/\bat\s+\d{1,2}(?:[:.]\d{2})?\b/ig, ' ')
      .replace(/\b(subah|sawere|savere|shaam|sham|raat|dopahar|dopehar|morning|evening|night|tonight|afternoon)(\s+(ko|ke|mein|me))?\b/ig, ' ');
  }
  rest = rest.replace(/[,;!?]+/g, ' ').replace(/\s+/g, ' ').replace(/\s+(hai|hain|he)\s*\.?$/i, '').replace(/\.$/, '').trim();
  if (!rest) rest = t;
  const who = kin ? kin[1].charAt(0).toUpperCase() + kin[1].slice(1).toLowerCase() : null;
  const title = ((who ? who + ': ' : '') + rest + (when ? ' at ' + when.said : '')).slice(0, 120);
  return { title, time: when ? when.time : null };
}

export function extractVoiceIntent(rawTranscript) {
  const t = String(rawTranscript || '').trim();
  if (!t) return null;
  const task = voiceTask(t);

  // 1. A change to a medicine, only when a change was said
  // "Doctor ne subah ki goli badal di, ab Telmisartan 40mg deni hai"
  if (/goli|dawa|tablet|capsule|medicine|dosage|dose|mg/i.test(t) && /\b(badal|badli|badla|change[ds]?|changed|naya|nayi|new|band kar|stop(ped)?)\b/i.test(t)) {
    let medName = 'a medicine';
    const doseMatch = t.match(/\b([A-Za-z]{3,25}\s+[0-9]{1,4}\s*(?:mg|mcg|ml)?)\b/i);
    if (doseMatch) medName = doseMatch[1].trim();
    const byDoctor = /\b(doctor|dr\.?)\b/i.test(t);
    return {
      intent: 'MEDICATION_CHANGE',
      confidence: 0.9,
      extracted_data: { medicine_name: medName, context: t },
      task,
      draft_confirmation: (byDoctor ? 'I heard: the doctor changed a medicine (' : 'I heard: a change to a medicine (') + medName
        + '). Add "' + task.title + '" to the family to-do list so someone checks it?'
    };
  }

  // 2. A reading said aloud: "Papa ka BP aaj 130/85 hai", "sugar fasting 110 aayi hai"
  if (/bp|blood\s*pressure|sugar|glucose|creatinine|pulse/i.test(t)) {
    const bpMatch = t.match(/([0-9]{2,3})\s*[\/|\\]\s*([0-9]{2,3})/);
    const sugarMatch = t.match(/(?:sugar|glucose)[^\d]*([0-9]{2,3})/i);
    if (bpMatch) {
      return {
        intent: 'HEALTH_STATUS',
        confidence: 0.95,
        extracted_data: { type: 'BP', systolic: Number(bpMatch[1]), diastolic: Number(bpMatch[2]), unit: 'mmHg' },
        task: null,
        draft_confirmation: `I heard a blood pressure reading of ${bpMatch[1]}/${bpMatch[2]} mmHg. Save it to the health records?`
      };
    }
    if (sugarMatch && !voiceTime(t)) {
      return {
        intent: 'HEALTH_STATUS',
        confidence: 0.9,
        extracted_data: { type: 'GLUCOSE', value: Number(sugarMatch[1]), unit: 'mg/dL' },
        task: null,
        draft_confirmation: `I heard a blood sugar reading of ${sugarMatch[1]} mg/dL. Save it to the health records?`
      };
    }
  }

  // 3. Anything else is a to-do, in the words that were said
  // "Kal sham ko cardiologist ke paas jaana hai", "Papa ki BP tablet subah 9 baje"
  const chore = /jaana\s*hai|appointment|doctor|visit|hospital|chemist|dawaai|refill|bill/i.test(t);
  const routine = /goli|dawa|dawai|tablet|capsule|medicine|syrup|injection/i.test(t) || !!voiceTime(t);
  return {
    intent: chore ? 'CHORE_OR_APPOINTMENT' : routine ? 'TASK' : 'NOTE',
    confidence: chore || routine ? 0.85 : 0.7,
    extracted_data: { note: t },
    task,
    draft_confirmation: 'Add "' + task.title + '" to the family to-do list?'
  };
}

// ---------------------------------------------------------------------------
// 5. CARE WALLET & UTILITY BILL DELEGATION
// ---------------------------------------------------------------------------

export const BILL_CATEGORIES = [
  'ELECTRICITY',
  'PIPED_GAS',
  'WATER',
  'BROADBAND',
  'MAID_SALARY',
  'COOK_SALARY',
  'MEDICINE_DELIVERY',
  'SOCIETY_MAINTENANCE',
  'OTHER'
];

// UPI is India's: a link is made only for a bill in rupees with the biller's
// own UPI ID. A made-up ID would send a family's money to nobody.
export function buildUpiDeepLink(billerName, amount, consumerNumber, category = 'OTHER', upiId = null, cur = 'INR') {
  if (!upiId || !/^[\w.-]{2,}@[\w.-]{2,}$/.test(String(upiId)) || cur !== 'INR') return null;
  const amt = Number(amount || 0).toFixed(2);
  const note = encodeURIComponent(`${category} - ${billerName} ${consumerNumber ? '#' + consumerNumber : ''}`.trim());
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(billerName)}&am=${amt}&cu=INR&tn=${note}`;
}

export function formatBillSettledNotification(billerName, amount, payerName, cur = 'INR') {
  return `${billerName} bill of ${money(Math.round(Number(amount || 0)), cur)} was paid by ${payerName} ✅`;
}

// ---------------------------------------------------------------------------
// 6. "WHEN I'M NOT HERE" (ASSET & LOCKER LOCATOR)
// ---------------------------------------------------------------------------

export const ASSET_CATEGORIES = [
  'BANK_ACCOUNT',
  'LOCKER_KEY',
  'FIXED_DEPOSIT',
  'WILL',
  'DEMAT',
  'PROPERTY_DEED',
  'PENSION',
  'OTHER'
];

export function maskAssetIdentifier(rawIdentifier) {
  const raw = String(rawIdentifier || '').trim();
  if (!raw) return 'Recorded';
  if (raw.length <= 4) return '*** ' + raw;
  return 'Ending in ...' + raw.slice(-4);
}

// Access gating rules:
// - IMMEDIATE: circle members can view.
// - EMERGENCY_ONLY: revealed only on active SOS.
// - NOMINEES_ONLY: revealed only to designated recipients.
// - Whoever wrote it, and the person it is about, can always see it: an
//   entry its own author cannot read back looks like it was lost.
export const UNLOCK_POLICIES = ['IMMEDIATE', 'EMERGENCY_ONLY', 'NOMINEES_ONLY'];
export function canViewAssetLocator(locator, memberId, isEmergencyActive = false) {
  if (!locator) return false;
  if (memberId && (locator.created_by === memberId || locator.person_id === memberId)) return true;
  const policy = locator.unlock_policy || 'IMMEDIATE';
  if (policy === 'IMMEDIATE') return true;
  if (policy === 'EMERGENCY_ONLY' && isEmergencyActive) return true;
  if (locator.designated_recipients && Array.isArray(locator.designated_recipients)) {
    return locator.designated_recipients.includes(memberId);
  }
  return false;
}

// ---------------------------------------------------------------------------
// 7. SIBLING CO-CARE TASKS
// ---------------------------------------------------------------------------

export const SIBLING_TASK_CATEGORIES = [
  'MEDICINE_REFILL',
  'DOCTOR_APPOINTMENT',
  'LAB_TEST',
  'HOME_REPAIR',
  'BILL_PAY',
  'CHECK_IN'
];

export function filterSiblingTasks(tasks, filter = 'ALL', memberId = null) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (filter === 'MINE' && memberId) {
    return list.filter(t => t.assigned_to_id === memberId);
  }
  if (filter === 'URGENT') {
    const now = Date.now();
    return list.filter(t => {
      if (t.status === 'COMPLETED') return false;
      if (t.category === 'MEDICINE_REFILL') return true;
      if (t.due_date && new Date(t.due_date).getTime() - now < 86400000 * 2) return true;
      return false;
    });
  }
  return list;
}

// ---------------------------------------------------------------------------
// 8. AUDIT EVENTS (DPDP COMPLIANCE)
// ---------------------------------------------------------------------------

export async function recordAuditEvent(sql, { circleId, actorId, action, resource, resourceId, details = {}, ip = null }) {
  try {
    await ensureCarePrepSchema(sql);
    await sql`
      insert into audit_events (circle_id, actor_id, action, resource, resource_id, details, ip_fingerprint)
      values (${circleId}, ${actorId || null}, ${action}, ${resource}, ${resourceId || null}, ${JSON.stringify(details)}, ${ip || null})
    `;
    return true;
  } catch (e) {
    // Audit failure must never crash the primary user path, but is recorded in server logs
    console.error('Audit event logging failed:', e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 9. SERVERLESS API HANDLERS (Shared across /api/care and /api/book)
// ---------------------------------------------------------------------------

// Is this person (not the caller: requireMember checks the caller) in the family?
async function inCircle(sql, circleId, personId) {
  if (!isUuid(personId)) return false;
  const r = await sql`select 1 as x from members where id = ${personId} and circle_id = ${circleId}`;
  return !!r[0];
}

async function getDb() {
  const { db, requireMember } = await import('./_db.mjs');
  const { tokenOf } = await import('./_token.mjs');
  const { fail, failDb } = await import('./_fail.mjs');
  return { db, requireMember, tokenOf, fail, failDb };
}

export async function refillApi(req, res) {
  const { db, requireMember, tokenOf, fail, failDb } = await getDb();
  let sql;
  try {
    sql = db();
    await ensureCarePrepSchema(sql);
  } catch (e) { return failDb(res, e); }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      const rows = await sql`
        select mi.*, m.name as person_name,
               fb.phone as chemist_phone, fb.name as chemist_name
        from medicine_inventory mi
        join members m on m.id = mi.member_id
        left join family_book fb on fb.id = mi.preferred_pharmacy_id
        where mi.circle_id = ${g.circle.id}
        order by mi.units_remaining asc
      `;

      const inventory = rows.map(r => {
        const { daysLeft, depletionDate } = calculateDepletion(r.units_remaining, r.daily_consumption_rate);
        const warning = isStockoutWarningDue(r.units_remaining, r.daily_consumption_rate, r.refill_threshold_days, r.snoozed_until);
        const orderUrl = (r.chemist_phone || r.preferred_pharmacy_phone)
          ? formatChemistWhatsAppOrder(r.chemist_phone || r.preferred_pharmacy_phone, r.person_name, r.medicine_name, r.total_units_in_pack)
          : null;
        return {
          ...r,
          days_left: daysLeft,
          calculated_depletion: depletionDate.toISOString(),
          warning_due: warning,
          order_url: orderUrl
        };
      });

      return res.status(200).json({ ok: true, inventory });
    }

    if (req.method === 'POST') {
      req.body = req.body || {};
      const { code, memberId, action } = req.body;
      const g = await requireMember(sql, code, memberId, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      if (action === 'refill_add' || action === 'refill_update') {
        const { id, personId, medicineId, medicineName, totalUnits, unitsRemaining, dailyRate, thresholdDays, pharmacyId, pharmacyName, pharmacyPhone } = req.body;
        if (!personId || !medicineName) return res.status(400).json({ ok: false, error: 'Person and medicine name required' });
        const rate = Math.max(0.1, Number(dailyRate) || 1.0);
        const rem = Math.max(0, Number(unitsRemaining != null ? unitsRemaining : (totalUnits || 30)));
        const { depletionDate } = calculateDepletion(rem, rate);

        let rowId = id;
        if (id && isUuid(id)) {
          await sql`
            update medicine_inventory set
              medicine_name = ${medicineName},
              total_units_in_pack = ${Number(totalUnits) || 30},
              units_remaining = ${rem},
              daily_consumption_rate = ${rate},
              estimated_depletion_date = ${depletionDate},
              refill_threshold_days = ${Number(thresholdDays) || 5},
              preferred_pharmacy_id = ${isUuid(pharmacyId) ? pharmacyId : null},
              preferred_pharmacy_name = ${pharmacyName || null},
              preferred_pharmacy_phone = ${pharmacyPhone || null},
              updated_at = now()
            where id = ${id} and circle_id = ${g.circle.id}
          `;
        } else {
          const inserted = await sql`
            insert into medicine_inventory (
              circle_id, member_id, medicine_id, medicine_name, total_units_in_pack,
              units_remaining, daily_consumption_rate, estimated_depletion_date,
              refill_threshold_days, preferred_pharmacy_id, preferred_pharmacy_name,
              preferred_pharmacy_phone, created_by
            ) values (
              ${g.circle.id}, ${personId}, ${isUuid(medicineId) ? medicineId : null}, ${medicineName},
              ${Number(totalUnits) || 30}, ${rem}, ${rate}, ${depletionDate},
              ${Number(thresholdDays) || 5}, ${isUuid(pharmacyId) ? pharmacyId : null},
              ${pharmacyName || null}, ${pharmacyPhone || null}, ${g.me.id}
            ) returning id
          `;
          rowId = inserted[0].id;
        }

        await recordAuditEvent(sql, {
          circleId: g.circle.id,
          actorId: g.me.id,
          action: 'update_medicine_inventory',
          resource: 'medicine_inventory',
          resourceId: rowId
        });

        return res.status(200).json({ ok: true, id: rowId });
      }

      if (action === 'refill_mark') {
        const { inventoryId, unitsAdded } = req.body;
        if (!isUuid(inventoryId)) return res.status(400).json({ ok: false, error: 'Invalid inventory ID' });
        const inv = await sql`select * from medicine_inventory where id = ${inventoryId} and circle_id = ${g.circle.id}`;
        if (!inv[0]) return res.status(404).json({ ok: false, error: 'Inventory not found' });

        const addCount = Number(unitsAdded) || inv[0].total_units_in_pack || 30;
        const newUnits = inv[0].units_remaining + addCount;
        const { depletionDate } = calculateDepletion(newUnits, inv[0].daily_consumption_rate);

        await sql`
          update medicine_inventory set
            units_remaining = ${newUnits},
            estimated_depletion_date = ${depletionDate},
            snoozed_until = null,
            updated_at = now()
          where id = ${inventoryId}
        `;

        await recordAuditEvent(sql, {
          circleId: g.circle.id,
          actorId: g.me.id,
          action: 'refill_medicine',
          resource: 'medicine_inventory',
          resourceId: inventoryId,
          details: { units_added: addCount }
        });

        return res.status(200).json({ ok: true, units_remaining: newUnits });
      }

      if (action === 'refill_snooze') {
        const { inventoryId, days } = req.body;
        if (!isUuid(inventoryId)) return res.status(400).json({ ok: false, error: 'Invalid inventory ID' });
        const snoozeDays = Number(days) || 2;
        const snoozeUntil = new Date(Date.now() + snoozeDays * 86400000);

        await sql`
          update medicine_inventory set
            snoozed_until = ${snoozeUntil},
            updated_at = now()
          where id = ${inventoryId} and circle_id = ${g.circle.id}
        `;

        return res.status(200).json({ ok: true, snoozed_until: snoozeUntil.toISOString() });
      }

      return res.status(400).json({ ok: false, error: 'Unknown refill action' });
    }
  } catch (e) { return fail(res, e); }
}

export async function billsApi(req, res) {
  const { db, requireMember, tokenOf, fail, failDb } = await getDb();
  let sql;
  try {
    sql = db();
    await ensureCarePrepSchema(sql);
  } catch (e) { return failDb(res, e); }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      const rows = await sql`
        select cb.*, m.name as person_name, p.name as payer_name, p.name as assigned_payer_name,
               s.name as settled_by_name, c.country as creator_country
        from care_bills cb
        left join members m on m.id = cb.person_id
        left join members p on p.id = cb.assigned_payer_id
        left join members s on s.id = cb.settled_by
        left join members c on c.id = cb.created_by
        where cb.circle_id = ${g.circle.id}
        order by cb.payment_status asc, cb.due_date asc nulls last, cb.created_at desc
      `;

      // A bill is in the money of whoever added it - the household it
      // belongs to.
      const bills = rows.map(b => {
        const currency = currencyOf(b.creator_country);
        const { creator_country, ...rest } = b;
        return { ...rest, currency,
          upi_link: buildUpiDeepLink(b.biller_name, b.amount_due, b.consumer_number, b.bill_category, b.upi_id, currency) };
      });

      return res.status(200).json({ ok: true, bills });
    }

    if (req.method === 'POST') {
      req.body = req.body || {};
      const { code, memberId, action } = req.body;
      const g = await requireMember(sql, code, memberId, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      // The app has always sent create/settle with snake_case fields; both
      // spellings are taken, so a bill saved from the app is really saved.
      const B = req.body;
      if (action === 'bill_add' || action === 'create') {
        const personId = B.personId || B.person_id, category = B.category || B.bill_category;
        const billerName = String(B.billerName || B.biller_name || '').trim().slice(0, 100);
        const consumerNumber = String(B.consumerNumber || B.consumer_number || '').trim().slice(0, 60);
        const amount = B.amount !== undefined ? B.amount : B.amount_due;
        const dueDate = B.dueDate || B.due_date, assignedPayerId = B.assignedPayerId || B.assigned_payer_id;
        const upiRaw = String(B.upiId || B.upi_id || '').trim();
        if (!billerName) return res.status(400).json({ ok: false, error: 'Biller name is required' });
        if (!(Number(amount) > 0) || Number(amount) > 100000000) return res.status(400).json({ ok: false, error: 'Write the amount as a number above 0' });
        if (dueDate && !/^\d{4}-\d{2}-\d{2}/.test(String(dueDate))) return res.status(400).json({ ok: false, error: 'Pick the due date from the calendar' });
        if (upiRaw && !/^[\w.-]{2,}@[\w.-]{2,}$/.test(upiRaw)) return res.status(400).json({ ok: false, error: 'A UPI ID looks like name@bank' });
        const cat = BILL_CATEGORIES.includes(category) ? category : 'OTHER';

        const inserted = await sql`
          insert into care_bills (
            circle_id, person_id, bill_category, biller_name, consumer_number,
            amount_due, due_date, assigned_payer_id, created_by, upi_id
          ) values (
            ${g.circle.id}, ${isUuid(personId) ? personId : null}, ${cat}, ${billerName},
            ${consumerNumber || null}, ${Number(amount) || 0}, ${dueDate ? new Date(dueDate) : null},
            ${isUuid(assignedPayerId) ? assignedPayerId : null}, ${g.me.id}, ${upiRaw || null}
          ) returning id
        `;

        await recordAuditEvent(sql, {
          circleId: g.circle.id,
          actorId: g.me.id,
          action: 'add_care_bill',
          resource: 'care_bill',
          resourceId: inserted[0].id
        });

        return res.status(200).json({ ok: true, id: inserted[0].id });
      }

      if (action === 'bill_settle' || action === 'settle') {
        const billId = B.billId || B.id, proofAttachmentId = B.proofAttachmentId;
        if (!isUuid(billId)) return res.status(400).json({ ok: false, error: 'Invalid bill ID' });

        const bill = await sql`select * from care_bills where id = ${billId} and circle_id = ${g.circle.id}`;
        if (!bill[0]) return res.status(404).json({ ok: false, error: 'Bill not found' });

        await sql`
          update care_bills set
            payment_status = 'SETTLED',
            settled_at = now(),
            settled_by = ${g.me.id},
            proof_attachment_id = ${isUuid(proofAttachmentId) ? proofAttachmentId : null},
            updated_at = now()
          where id = ${billId}
        `;

        const cr = bill[0].created_by ? await sql`select country from members where id = ${bill[0].created_by}` : [];
        const notifText = formatBillSettledNotification(bill[0].biller_name, bill[0].amount_due, g.me.name, currencyOf(cr[0] && cr[0].country));
        await sql`
          insert into events (circle_id, member_id, type, text)
          values (${g.circle.id}, ${g.me.id}, 'care', ${notifText})
        `;

        await recordAuditEvent(sql, {
          circleId: g.circle.id,
          actorId: g.me.id,
          action: 'settle_care_bill',
          resource: 'care_bill',
          resourceId: billId
        });

        return res.status(200).json({ ok: true, notification: notifText });
      }

      return res.status(400).json({ ok: false, error: 'Unknown bill action' });
    }
  } catch (e) { return fail(res, e); }
}

export async function siblingTasksApi(req, res) {
  const { db, requireMember, tokenOf, fail, failDb } = await getDb();
  let sql;
  try {
    sql = db();
    await ensureCarePrepSchema(sql);
  } catch (e) { return failDb(res, e); }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      const rows = await sql`
        select st.*, m.name as subject_name, a.name as assignee_name
        from sibling_care_tasks st
        left join members m on m.id = st.subject_person_id
        left join members a on a.id = st.assigned_to_id
        where st.circle_id = ${g.circle.id}
        order by st.status asc, st.due_date asc nulls last, st.created_at desc
      `;

      const filter = q.filter || 'ALL';
      const tasks = filterSiblingTasks(rows, filter, g.me.id);

      return res.status(200).json({ ok: true, tasks, filter, categories: SIBLING_TASK_CATEGORIES });
    }

    if (req.method === 'POST') {
      req.body = req.body || {};
      const { code, memberId, action } = req.body;
      const g = await requireMember(sql, code, memberId, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      if (action === 'sibling_task_create') {
        const { subjectPersonId, title, category, assignedToId, dueDate, notes } = req.body;
        if (!title) return res.status(400).json({ ok: false, error: 'Task title is required' });

        const cat = SIBLING_TASK_CATEGORIES.includes(category) ? category : 'CHECK_IN';
        const ins = await sql`
          insert into sibling_care_tasks (
            circle_id, subject_person_id, title, category, assigned_to_id,
            due_date, notes, created_by
          ) values (
            ${g.circle.id}, ${isUuid(subjectPersonId) ? subjectPersonId : null},
            ${title}, ${cat}, ${isUuid(assignedToId) ? assignedToId : null},
            ${dueDate ? new Date(dueDate) : null}, ${notes || null}, ${g.me.id}
          ) returning id
        `;

        await recordAuditEvent(sql, {
          circleId: g.circle.id,
          actorId: g.me.id,
          action: 'create_sibling_task',
          resource: 'sibling_care_task',
          resourceId: ins[0].id
        });

        return res.status(200).json({ ok: true, id: ins[0].id });
      }

      if (action === 'sibling_task_complete') {
        const { taskId } = req.body;
        if (!isUuid(taskId)) return res.status(400).json({ ok: false, error: 'Invalid task ID' });

        const t = await sql`select * from sibling_care_tasks where id = ${taskId} and circle_id = ${g.circle.id}`;
        if (!t[0]) return res.status(404).json({ ok: false, error: 'Task not found' });

        await sql`
          update sibling_care_tasks set
            status = 'COMPLETED',
            updated_at = now()
          where id = ${taskId}
        `;

        await sql`
          insert into events (circle_id, member_id, type, text)
          values (${g.circle.id}, ${g.me.id}, 'care', ${g.me.name + ' completed task: ' + t[0].title + ' ✅'})
        `;

        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: 'Unknown sibling task action' });
    }
  } catch (e) { return fail(res, e); }
}

export async function biomarkersApi(req, res) {
  const { db, requireMember, tokenOf, fail, failDb } = await getDb();
  let sql;
  try {
    sql = db();
    await ensureCarePrepSchema(sql);
  } catch (e) { return failDb(res, e); }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      const personId = isUuid(q.person) ? q.person : null;
      const rows = personId
        ? await sql`
            select br.*, m.name as person_name
            from biomarker_records br
            join members m on m.id = br.person_id
            where br.circle_id = ${g.circle.id} and br.person_id = ${personId}
            order by br.test_date asc, br.created_at asc
          `
        : await sql`
            select br.*, m.name as person_name
            from biomarker_records br
            join members m on m.id = br.person_id
            where br.circle_id = ${g.circle.id}
            order by br.test_date asc, br.created_at asc
          `;

      await recordAuditEvent(sql, {
        circleId: g.circle.id,
        actorId: g.me.id,
        action: 'view_biomarkers',
        resource: 'biomarker_records',
        resourceId: personId
      });

      return res.status(200).json({ ok: true, records: rows, meta: BIOMARKER_META });
    }

    if (req.method === 'POST') {
      req.body = req.body || {};
      const { code, memberId, action } = req.body;
      const g = await requireMember(sql, code, memberId, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      if (action === 'biomarker_parse') {
        const { reportText } = req.body;
        const parsed = parseBiomarkersFromText(reportText);
        return res.status(200).json({ ok: true, ...parsed });
      }

      if (action === 'biomarker_save') {
        const { personId, documentId, items, labName, testDate } = req.body;
        if (!personId || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ ok: false, error: 'Person and at least one biomarker required' });
        }
        // The person must be in THIS family: any member id used to be taken,
        // so a reading could be written onto another family's member.
        if (!(await inCircle(sql, g.circle.id, personId))) {
          return res.status(403).json({ ok: false, error: 'Choose someone in this family' });
        }
        // A known test and a real number, or nothing is saved.
        const bad = items.find(it => !it || !BIOMARKER_META[it.biomarker_type] || !Number.isFinite(Number(it.value)) || it.value === '' || it.value == null);
        if (bad || items.length > 40) {
          return res.status(400).json({ ok: false, error: 'Each reading needs a known test and a number' });
        }
        const tDate = testDate ? new Date(testDate) : new Date();
        if (isNaN(+tDate)) return res.status(400).json({ ok: false, error: 'That test date could not be read' });

        const savedIds = [];
        for (const item of items) {
          const meta = BIOMARKER_META[item.biomarker_type] || {};
          const ins = await sql`
            insert into biomarker_records (
              circle_id, person_id, document_id, biomarker_type, value, unit,
              reference_range_low, reference_range_high, test_date, lab_name,
              verified_by_user, created_by
            ) values (
              ${g.circle.id}, ${personId}, ${isUuid(documentId) ? documentId : null},
              ${item.biomarker_type}, ${Number(item.value)}, ${item.unit || meta.unit || ''},
              ${item.reference_range_low != null ? item.reference_range_low : meta.low},
              ${item.reference_range_high != null ? item.reference_range_high : meta.high},
              ${tDate}, ${labName || null}, true, ${g.me.id}
            ) returning id
          `;
          savedIds.push(ins[0].id);
        }

        await recordAuditEvent(sql, {
          circleId: g.circle.id,
          actorId: g.me.id,
          action: 'record_biomarkers',
          resource: 'biomarker_records',
          details: { count: savedIds.length }
        });

        return res.status(200).json({ ok: true, saved_count: savedIds.length });
      }

      return res.status(400).json({ ok: false, error: 'Unknown biomarker action' });
    }
  } catch (e) { return fail(res, e); }
}

export async function preauthApi(req, res) {
  const { db, requireMember, tokenOf, fail, failDb } = await getDb();
  let sql;
  try {
    sql = db();
    await ensureCarePrepSchema(sql);
  } catch (e) { return failDb(res, e); }

  try {
    const q = req.query || {};
    const g = await requireMember(sql, q.circle || (req.body && req.body.code), q.member || (req.body && req.body.memberId), tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

    if (req.method === 'GET') {
      const personId = isUuid(q.person) ? q.person : g.me.id;
      // In this family only: the id alone read any member's name and date
      // of birth, from any family.
      const person = (await sql`select id, name, dob from members where id = ${personId} and circle_id = ${g.circle.id}`)[0];
      if (!person) return res.status(403).json({ ok: false, error: 'Choose someone in this family' });
      const policy = (await sql`select id, name, notes from family_book where kind = 'insurance' and (about_member = ${personId} or about_member is null) and circle_id = ${g.circle.id} limit 1`)[0];
      const tpaContact = (await sql`select id, name, phone, notes from family_book where category = 'emergency' and circle_id = ${g.circle.id} limit 1`)[0];

      const packet = buildEmergencyAdmissionPacket(person, policy, tpaContact, [], {
        aadhaarMask: 'Recorded in Vault',
        panMask: 'Recorded in Vault'
      });

      await recordAuditEvent(sql, {
        circleId: g.circle.id,
        actorId: g.me.id,
        action: 'view_emergency_packet',
        resource: 'insurance_preauth_packet',
        resourceId: personId
      });

      return res.status(200).json({ ok: true, packet });
    }
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) { return fail(res, e); }
}

export async function locatorApi(req, res) {
  const { db, requireMember, tokenOf, fail, failDb } = await getDb();
  let sql;
  try {
    sql = db();
    await ensureCarePrepSchema(sql);
  } catch (e) { return failDb(res, e); }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      const personId = isUuid(q.person) ? q.person : null;
      const rows = personId
        ? await sql`
            select lal.*, m.name as person_name
            from legacy_asset_locators lal
            join members m on m.id = lal.person_id
            where lal.circle_id = ${g.circle.id} and lal.person_id = ${personId}
            order by lal.created_at asc
          `
        : await sql`
            select lal.*, m.name as person_name
            from legacy_asset_locators lal
            join members m on m.id = lal.person_id
            where lal.circle_id = ${g.circle.id}
            order by lal.created_at asc
          `;

      // "Only in an emergency" opens while that person has an SOS that is
      // not yet sorted. Before, nothing ever told this an SOS was on.
      let inSos = new Set();
      try {
        const open = await sql`select distinct member_id from sos where circle_id = ${g.circle.id} and status <> 'resolved'`;
        inSos = new Set(open.map(x => x.member_id));
      } catch (e) { /* no SOS table yet: nobody has ever pressed it */ }
      const locators = rows.map(r => {
        const canView = canViewAssetLocator(r, g.me.id, inSos.has(r.person_id));
        return {
          id: r.id,
          person_id: r.person_id,
          person_name: r.person_name,
          asset_category: r.asset_category,
          institution_or_item: r.institution_or_item,
          // As the person typed it ("Locker #42"), to anyone allowed to see
          // the entry. Others get only the last four characters.
          identifier_mask: canView ? (r.identifier_mask || null) : (r.identifier_mask ? maskAssetIdentifier(r.identifier_mask) : null),
          physical_location_notes: canView ? r.physical_location_notes : 'Restricted (Protected under When I\'m Not Here access policy)',
          unlock_policy: r.unlock_policy,
          can_view: canView,
          last_verified_at: r.last_verified_at
        };
      });

      await recordAuditEvent(sql, {
        circleId: g.circle.id,
        actorId: g.me.id,
        action: 'view_asset_locators',
        resource: 'legacy_asset_locators',
        resourceId: personId
      });

      return res.status(200).json({ ok: true, locators, categories: ASSET_CATEGORIES });
    }

    if (req.method === 'POST') {
      req.body = req.body || {};
      const { code, memberId, action } = req.body;
      const g = await requireMember(sql, code, memberId, tokenOf(req));
      if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

      if (action === 'locator_add') {
        const { personId, category, institutionOrItem, identifierMask, physicalLocationNotes, unlockPolicy, designatedRecipients } = req.body;
        if (!personId || !institutionOrItem || !physicalLocationNotes) {
          return res.status(400).json({ ok: false, error: 'Person, item label, and physical location notes required' });
        }

        if (!(await inCircle(sql, g.circle.id, personId))) {
          return res.status(403).json({ ok: false, error: 'Choose someone in this family' });
        }
        // Who may see it is the whole point of this entry. Anything but the
        // three choices is refused, never quietly stored as "everyone now".
        if (!UNLOCK_POLICIES.includes(unlockPolicy)) {
          return res.status(400).json({ ok: false, error: 'Choose who can see this: everyone now (IMMEDIATE), only in an emergency (EMERGENCY_ONLY), or only the people you name (NOMINEES_ONLY).' });
        }
        const cat = ASSET_CATEGORIES.includes(category) ? category : 'OTHER';
        const pol = unlockPolicy;
        const recs = Array.isArray(designatedRecipients) ? designatedRecipients.filter(isUuid) : [];

        const ins = await sql`
          insert into legacy_asset_locators (
            circle_id, person_id, asset_category, institution_or_item,
            identifier_mask, physical_location_notes, unlock_policy,
            designated_recipients, created_by
          ) values (
            ${g.circle.id}, ${personId}, ${cat}, ${String(institutionOrItem).trim().slice(0, 120)},
            ${String(identifierMask || '').trim().slice(0, 60) || null}, ${String(physicalLocationNotes).trim().slice(0, 1000)}, ${pol},
            ${JSON.stringify(recs)}, ${g.me.id}
          ) returning id
        `;

        await recordAuditEvent(sql, {
          circleId: g.circle.id,
          actorId: g.me.id,
          action: 'add_asset_locator',
          resource: 'legacy_asset_locator',
          resourceId: ins[0].id
        });

        return res.status(200).json({ ok: true, id: ins[0].id });
      }

      return res.status(400).json({ ok: false, error: 'Unknown locator action' });
    }
  } catch (e) { return fail(res, e); }
}

export async function auditApi(req, res) {
  const { db, requireMember, tokenOf, fail, failDb } = await getDb();
  let sql;
  try {
    sql = db();
    await ensureCarePrepSchema(sql);
  } catch (e) { return failDb(res, e); }

  try {
    const q = req.query || {};
    const g = await requireMember(sql, q.circle, q.member, tokenOf(req));
    if (g.err) return res.status(g.status).json({ ok: false, error: g.err });

    const resource = q.resource || null;
    const resourceId = isUuid(q.resourceId) ? q.resourceId : null;

    const events = (resource && resourceId)
      ? await sql`
          select ae.*, m.name as actor_name
          from audit_events ae
          left join members m on m.id = ae.actor_id
          where ae.circle_id = ${g.circle.id} and ae.resource = ${resource} and ae.resource_id = ${resourceId}
          order by ae.timestamp desc limit 30
        `
      : await sql`
          select ae.*, m.name as actor_name
          from audit_events ae
          left join members m on m.id = ae.actor_id
          where ae.circle_id = ${g.circle.id}
          order by ae.timestamp desc limit 50
        `;

    const members = await sql`
      select id, name, role, relation from members where circle_id = ${g.circle.id} order by created_at asc
    `;

    return res.status(200).json({ ok: true, events, access_list: members });
  } catch (e) { return fail(res, e); }
}
