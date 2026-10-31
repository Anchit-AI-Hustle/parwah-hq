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
  if (!cfg.on || !sosId) return out;
  try {
    await ensureDialSchema(sql);
    const people = [];
    for (const c of contacts || []) { const to = e164(c.phone, cc); if (to && !people.some(p => p.to === to)) people.push({ to, name: c.name }); }
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
    const used = await sql`select count(*)::int as n from sos_dial d join sos s on s.id = d.sos_id
                           where s.circle_id = (select circle_id from sos where id = ${sosId})
                             and d.created_at > now() - interval '1 day'`;
    // If this count cannot be read, the catch below sends nothing: a paid
    // send fails closed.
    const left = Math.max(0, DIAL_DAY_MAX - ((used[0] && used[0].n) || 0));
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
