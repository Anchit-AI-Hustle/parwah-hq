// SOS BY TEXT MESSAGE, WHATSAPP AND A PHONE CALL, SENT BY PARWAH ITSELF.
//
// A web app cannot send an SMS or place a call from the phone on its own, so
// the SOS screen has always offered them one tap each. With a Twilio account
// added, the server sends them too, the moment SOS is pressed, to the same
// people the screen lists (emergency contacts first, then the family):
//
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN    the account (both needed)
//   TWILIO_SMS_FROM                          a number that can send SMS
//   TWILIO_WHATSAPP_FROM                     a WhatsApp sender, e.g. +14155238886
//   TWILIO_WHATSAPP_CONTENT_SID              an approved WhatsApp template with
//                                            {{1}} the name and {{2}} the map
//                                            link. Without it, WhatsApp only
//                                            delivers to people who wrote to the
//                                            sender in the last 24 hours (and in
//                                            the sandbox), so set it for real use.
//   TWILIO_VOICE_FROM                        a number that can call: it rings the
//                                            first CALL_MAX people and says who
//                                            needs help
//
// Each is optional: with no keys nothing is sent and nothing changes. Each
// SOS reaches each person on each channel once, however often SOS is pressed
// (claimed in the database first), and every request gives up after
// DIAL_TIMEOUT_MS so the alarm to the family is never held up for long.
// Nothing here ever throws into the SOS.

import { normPhone } from './_phone.mjs';
import { rememberedPhones } from './_sos.mjs';
import { CALLS_OFF_LINE } from './_safetyrules.mjs';

// Said plainly when calls and texts are not set up, in settings and on the
// SOS screen, so a family never believes a phone will ring when it will not.
export function dialStatus(env = process.env) {
  const c = dialConfig(env);
  return { on: c.on, texts: !!(c.on && (c.sms || c.whatsapp)), calls: !!(c.on && c.voice), line: c.on ? null : CALLS_OFF_LINE };
}
export const CALL_MAX = 2;
export const TEXT_MAX = 8;
// Texts and calls one family can cost in a day. Each is paid for, and a
// member's number can be any number in the world, so an account pressing
// SOS over and over must not run up a bill or ring strangers all night.
// Several real emergencies in a day still fit with room to spare.
export const DIAL_DAY_MAX = 40;
export const DIAL_TIMEOUT_MS = 6000;

export function dialConfig(env = process.env) {
  const sid = String(env.TWILIO_ACCOUNT_SID || '').trim(), token = String(env.TWILIO_AUTH_TOKEN || '').trim();
  const c = {
    sid, token,
    sms: String(env.TWILIO_SMS_FROM || '').trim(),
    whatsapp: String(env.TWILIO_WHATSAPP_FROM || '').trim(),
    waTemplate: String(env.TWILIO_WHATSAPP_CONTENT_SID || '').trim(),
    voice: String(env.TWILIO_VOICE_FROM || '').trim()
  };
  c.on = !!(/^AC[0-9a-f]{32}$/i.test(sid) && token && (c.sms || c.whatsapp || c.voice));
  return c;
}

// A number Twilio can dial: +country code and digits. A number written
// without one belongs to the sender's own country (`cc`, e.g. +44): its
// leading trunk 0 is dropped, the way it is dialled from abroad. With no
// country known, ten digits starting 6 to 9 are an Indian mobile.
export function e164(phone, cc) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  // Saved before the trunk 0 was dropped (+44 07700...): clean it now.
  if (/^\+[1-9]\d{7,15}$/.test(p)) { const n = normPhone(p); return n ? n.e164 : (/^\+[1-9]\d{7,14}$/.test(p) ? p : null); }
  if (/^\+[1-9]\d{0,3}$/.test(String(cc || '')) && cc !== '+91' && /^\d+$/.test(p)) {
    const local = p.replace(/^0+/, '');
    return local.length >= 6 && local.length <= 13 && (cc + local).length <= 16 ? cc + local : null;
  }
  if (/^[6-9]\d{9}$/.test(p)) return '+91' + p;
  if (/^0[6-9]\d{9}$/.test(p)) return '+91' + p.slice(1);
  if (/^91[6-9]\d{9}$/.test(p)) return '+' + p;
  return null;
}

// What the phone call says: slowly, twice, in plain words.
export function callScript(name, cc) {
  const voice = !cc || cc === '+91' ? 'voice="Polly.Aditi" language="en-IN"' : 'voice="Polly.Joanna" language="en-US"';
  const who = String(name || 'Someone in your family').replace(/[<>&"']/g, ' ').trim();
  const line = 'Emergency. ' + who + ' pressed S O S in Parwah and needs help now. ' +
    'Open your messages or Parwah to see where they are, and call them.';
  return '<Response><Say ' + voice + '>' + line + '</Say><Pause length="1"/>' +
         '<Say ' + voice + '>' + line + '</Say></Response>';
}

export async function ensureDialSchema(sql) {
  await sql`create table if not exists sos_dial (
    sos_id uuid not null references sos(id) on delete cascade,
    phone text not null,
    channel text not null,
    status text not null default 'sending',
    detail text,
    created_at timestamptz not null default now(),
    primary key (sos_id, phone, channel)
  )`;
  // Calls that are not for an SOS (a missed daily check-in reaching a nearby
  // helper, api/_familycare.mjs). Kept apart because they have no sos row,
  // but counted in the same daily cap.
  await sql`create table if not exists care_dial (
    circle_id uuid not null references circles(id) on delete cascade,
    kind text not null,
    ref text not null,
    phone text not null,
    status text not null default 'sending',
    detail text,
    created_at timestamptz not null default now(),
    primary key (kind, ref, phone)
  )`;
}

// Everything this family has been sent in the last day: SOS texts and calls,
// ladder calls, and the calls made for a missed check-in. One cap for all.
async function sentToday(sql, circleId) {
  const r = await sql`select (select count(*)::int from sos_dial d join sos s on s.id = d.sos_id
                                where s.circle_id = ${circleId} and d.created_at > now() - interval '1 day')
                           + (select count(*)::int from care_dial c
                                where c.circle_id = ${circleId} and c.created_at > now() - interval '1 day') as n`;
  return (r[0] && r[0].n) || 0;
}

async function twilio(cfg, path, form, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DIAL_TIMEOUT_MS);
  try {
    const r = await fetchImpl('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(cfg.sid) + '/' + path, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Basic ' + Buffer.from(cfg.sid + ':' + cfg.token).toString('base64'),
                 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString()
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    return r.ok ? { ok: true, id: j && j.sid } : { ok: false, detail: (j && (j.message || j.code)) || ('HTTP ' + r.status) };
  } catch (e) {
    return { ok: false, detail: e && e.name === 'AbortError' ? 'timed out' : 'could not reach Twilio' };
  } finally { clearTimeout(t); }
}

// Send the SOS out. Returns what happened, for the SOS screen:
// { configured, sms, whatsapp, call, failed }.
export async function dialOut(sql, sosId, contacts, { name, text, map, cc }, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = dialConfig(env);
  const out = { configured: cfg.on, sms: 0, whatsapp: 0, call: 0, failed: 0 };
  // Not set up: said in words the SOS screen shows, never a silent nothing.
  if (!cfg.on) out.line = CALLS_OFF_LINE;
  if (!cfg.on || !sosId) return out;
  try {
    await ensureDialSchema(sql);
    const sc =await sql`select circle_id from sos where id = ${sosId}`;
    // The last check before anything is sent: the number of someone in this
    // family who has passed away is never texted or rung, whoever put it on
    // the list. If this cannot be read, the catch below sends nothing.
    const gone = new Set();
    if (sc[0]) for (const m of await rememberedPhones(sql, sc[0].circle_id)) { const g = e164(m.phone, m.phone_cc || cc); if (g) gone.add(g); }
    const people = [];
    for (const c of contacts || []) { const to = e164(c.phone, cc); if (to && !gone.has(to) && !people.some(p => p.to === to)) people.push({ to, name: c.name }); }
    const jobs = [];
    people.slice(0, TEXT_MAX).forEach((p, i) => {
      if (cfg.sms) jobs.push({ p, channel: 'sms', path: 'Messages.json', form: { To: p.to, From: cfg.sms, Body: text } });
      if (cfg.whatsapp) {
        const form = { To: 'whatsapp:' + p.to, From: 'whatsapp:' + cfg.whatsapp.replace(/^whatsapp:/, '') };
        if (cfg.waTemplate) { form.ContentSid = cfg.waTemplate; form.ContentVariables = JSON.stringify({ 1: String(name || ''), 2: map || 'not found yet - call them' }); }
        else form.Body = text;
        jobs.push({ p, channel: 'whatsapp', path: 'Messages.json', form });
      }
      if (cfg.voice && i < CALL_MAX) jobs.push({ p, channel: 'call', path: 'Calls.json', form: { To: p.to, From: cfg.voice, Twiml: callScript(name, cc) } });
    });
    // If this count cannot be read, the catch below sends nothing: a paid
    // send fails closed.
    const left = Math.max(0, DIAL_DAY_MAX - (sc[0] ? await sentToday(sql, sc[0].circle_id) : DIAL_DAY_MAX));
    out.capped = jobs.length > left;
    await Promise.allSettled(jobs.slice(0, left).map(async j => {
      // Claimed first: a second press, or two servers at once, never sends twice.
      const claim = await sql`insert into sos_dial (sos_id, phone, channel) values (${sosId}, ${j.p.to}, ${j.channel})
                              on conflict do nothing returning phone`;
      if (!claim[0]) return;
      const r = await twilio(cfg, j.path, j.form, fetchImpl);
      await sql`update sos_dial set status = ${r.ok ? 'sent' : 'failed'}, detail = ${r.ok ? (r.id || null) : String(r.detail).slice(0, 200)}
                where sos_id = ${sosId} and phone = ${j.p.to} and channel = ${j.channel}`;
      if (r.ok) out[j.channel]++; else out.failed++;
    }));
  } catch (e) { /* the SOS has already gone to the family */ }
  return out;
}

// THE NEAREST-PERSON LADDER (api/_ladder.mjs): one call to someone near the
// person, who said yes on their own consent page, when nobody in the family
// has answered. What it says: who it is from, who needs help, and that the
// family could not be reached.
export function ladderScript(helper, name, cc) {
  const voice = !cc || cc === '+91' ? 'voice="Polly.Aditi" language="en-IN"' : 'voice="Polly.Joanna" language="en-US"';
  const clean = (s, d) => String(s || d).replace(/[<>&"']/g, ' ').trim();
  const line = 'Hello ' + clean(helper, 'there') + '. This is Parwah, calling for ' + clean(name, 'your neighbour') + "'s family. " +
    clean(name, 'They') + ' pressed S O S and nobody in the family has answered yet. ' +
    'You said you could help. Please go and check on them, or call them now. Thank you.';
  return '<Response><Say ' + voice + '>' + line + '</Say><Pause length="1"/>' +
         '<Say ' + voice + '>' + line + '</Say></Response>';
}

// Same account, same daily cap and the same claim-first rule as dialOut:
// a rung is called once, and never past DIAL_DAY_MAX for the family.
// → { configured, called, capped, failed, detail }
export async function dialLadder(sql, sosId, helper, { name, cc }, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = dialConfig(env);
  const out = { configured: !!(cfg.on && cfg.voice), called: false, capped: false, failed: false };
  if (!out.configured || !sosId || !helper) return out;
  try {
    await ensureDialSchema(sql);
    const to = e164(helper.phone, cc);
    if (!to) { out.failed = true; out.detail = 'not a dialable number'; return out; }
    const sc = await sql`select circle_id from sos where id = ${sosId}`;
    if (!sc[0] || (await sentToday(sql, sc[0].circle_id)) >= DIAL_DAY_MAX) { out.capped = true; return out; }
    const claim = await sql`insert into sos_dial (sos_id, phone, channel) values (${sosId}, ${to}, 'ladder')
                            on conflict do nothing returning phone`;
    if (!claim[0]) return out;
    const r = await twilio(cfg, 'Calls.json', { To: to, From: cfg.voice, Twiml: ladderScript(helper.name, name, cc) }, fetchImpl);
    await sql`update sos_dial set status = ${r.ok ? 'sent' : 'failed'}, detail = ${r.ok ? (r.id || null) : String(r.detail).slice(0, 200)}
              where sos_id = ${sosId} and phone = ${to} and channel = 'ladder'`;
    if (r.ok) out.called = true; else { out.failed = true; out.detail = r.detail; }
  } catch (e) { out.failed = true; }
  return out;
}

// A MISSED DAILY CHECK-IN, after the family alert went unanswered: one gentle
// call to the first nearby helper who said yes. Not an emergency, so it
// does not say one.
export function quietLadderScript(helper, name, cc) {
  const voice = !cc || cc === '+91' ? 'voice="Polly.Aditi" language="en-IN"' : 'voice="Polly.Joanna" language="en-US"';
  const clean = (s, d) => String(s || d).replace(/[<>&"']/g, ' ').trim();
  const line = 'Hello ' + clean(helper, 'there') + '. This is Parwah, calling for ' + clean(name, 'your neighbour') + "'s family. " +
    clean(name, 'They') + ' has not checked in today, and the family has not been able to reach them yet. ' +
    'You said you could help. When you can, please check on them or give them a call. Thank you.';
  return '<Response><Say ' + voice + '>' + line + '</Say><Pause length="1"/>' +
         '<Say ' + voice + '>' + line + '</Say></Response>';
}

// The same claim-first rule and the same daily cap as dialLadder, keyed on
// the person and the day instead of an SOS. → { configured, called, capped, failed, detail }
export async function dialQuietLadder(sql, circleId, ref, helper, { name, cc }, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = dialConfig(env);
  const out = { configured: !!(cfg.on && cfg.voice), called: false, capped: false, failed: false };
  if (!out.configured || !circleId || !ref || !helper) return out;
  try {
    await ensureDialSchema(sql);
    const to = e164(helper.phone, cc);
    if (!to) { out.failed = true; out.detail = 'not a dialable number'; return out; }
    if ((await sentToday(sql, circleId)) >= DIAL_DAY_MAX) { out.capped = true; return out; }
    const claim = await sql`insert into care_dial (circle_id, kind, ref, phone) values (${circleId}, 'quiet', ${ref}, ${to})
                            on conflict do nothing returning phone`;
    if (!claim[0]) return out;
    const r = await twilio(cfg, 'Calls.json', { To: to, From: cfg.voice, Twiml: quietLadderScript(helper.name, name, cc) }, fetchImpl);
    await sql`update care_dial set status = ${r.ok ? 'sent' : 'failed'}, detail = ${r.ok ? (r.id || null) : String(r.detail).slice(0, 200)}
              where kind = 'quiet' and ref = ${ref} and phone = ${to}`;
    if (r.ok) out.called = true; else { out.failed = true; out.detail = r.detail; }
  } catch (e) { out.failed = true; }
  return out;
}
