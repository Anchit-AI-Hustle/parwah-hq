// A TAP MADE WITH NO NETWORK, AND A TIMER THAT SAYS WHEN IT STUMBLES.
//
// A parent in a lift or a village with one bar presses "All is well". The
// phone keeps the tap with the time it was pressed and sends it when the
// network is back (site/public/index.html, the offline queue). This is the
// server's side of that promise:
//   - the phone's own id for the tap makes sending it twice one tap;
//   - the pressed time is taken only for a check-in, a medicine tick or a
//     pulse answer, and only within a day (api/_pushrules.mjs clientTime);
//   - a check-in that arrives after the family was told "has not checked
//     in" tells them at once that all was well, and when.
// An SOS is never queued and never comes through here.
import { randomBytes } from 'node:crypto';
import { cleanClientId, clientTime } from './_pushrules.mjs';
import { ensurePushSchema, pushCircle } from './_push.mjs';
import { validTz } from './_recur.mjs';

// → { at: Date|null, late } to go ahead, { dup: true } when this tap is
// already in, or { error, status } to send back as it is.
export async function lateTap(sql, body, memberId, type, nowMs = Date.now()) {
  const b = body || {};
  if (b.clientId === undefined && b.at === undefined) return { at: null, late: false };
  const id = cleanClientId(b.clientId);
  if (!id) return { error: 'That could not be sent. Tap it again.', status: 400 };
  const t = clientTime(type, b.at, nowMs);
  if (t.error) return { error: t.error, status: 422 };
  await ensurePushSchema(sql);
  const mine = await sql`insert into offline_taps (member_id, client_id) values (${memberId}, ${id})
                         on conflict (member_id, client_id) do nothing returning client_id`;
  if (!mine[0]) return { dup: true };
  // Old ids are of no use once a day has passed: nothing that old is taken.
  try { await sql`delete from offline_taps where at < now() - interval '3 days'`; } catch (e) {}
  return t;
}

// The check-in was pressed in time and only reached us now. If the family
// has been told since then that this person did not check in, they are told
// the truth, once, and it gets through quiet hours: it is the good news.
export async function lateArrived(sql, circle, member, at) {
  try {
    const r = (await sql`select to_jsonb(m) as r from members m where m.id = ${member.id}`)[0];
    const row = (r && r.r) || {};
    const alertedAt = row.quiet_alerted_at ? new Date(row.quiet_alerted_at).getTime() : null;
    if (!alertedAt || alertedAt < at.getTime()) return false;
    const zone = validTz(row.tz) || 'Asia/Kolkata';
    const when = new Intl.DateTimeFormat('en-IN', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
    const text = member.name + ' tapped All is well at ' + when + '. The phone had no network until now.';
    await sql`insert into events (circle_id, member_id, type, text) values (${circle.id}, ${member.id}, 'care', ${'✅ ' + text})`;
    await pushCircle(sql, circle.id, { title: '✅ ' + member.name + ' did check in', body: text, url: '/#home', kind: 'safety' }, { except: member.id });
    return true;
  } catch (e) { return false; }
}

// A sweep that failed used to vanish. It still never stops the timer, but
// it leaves one line in the server log: a short reference, which part, and
// the kind of error. Never the family, a name, or the words of the error's
// detail (Postgres puts row values there).
export function tickNote(e, part) {
  try {
    const ref = randomBytes(3).toString('hex');
    const code = e && e.code ? String(e.code).slice(0, 12) : '';
    const what = String((e && e.message) || e || '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '[id]').replace(/\d{5,}/g, '[n]').replace(/\(.*$/s, '').slice(0, 100);
    console.error('[parwah tick ' + ref + '] ' + String(part || 'sweep') + ' ' + code + ' ' + what);
    return ref;
  } catch (_) { return null; }
}
