// SAFETY, SAID HONESTLY. Not a route: read with the family's state
// (GET /api/events, as `safety`).
//
//   calls         are calls and texts by Parwah set up? When not, the words
//                 the settings screen and the SOS screen show.
//   timer         when the timer last ran, for the adults of the family, and
//                 a plain warning when it has not run for 15 minutes.
//   doseTell      the person's own answer to "Tell the family if I miss a
//                 medicine", and whether it is still to be asked.
//   rememberAsks  a "no longer with us" mark waiting for a second adult.
// (A pause someone asked for on my check-in comes with familyCare.quiet.)
//
// The timer's last run is one row in kv (the small key and value table the
// push keys already live in). No scheduler is made here or anywhere.
import { schemaOnce } from './_db.mjs';
import { dialStatus } from './_sosdial.mjs';
import { timerLine } from './_safetyrules.mjs';
import { isAdult } from './_rememberrules.mjs';
import { doseTellState } from './_doses.mjs';
import { rememberAsksFor } from './_remember.mjs';

let ready = false;
async function kvReady(sql) {
  if (ready) return;
  await schemaOnce(() => sql`create table if not exists kv (k text primary key, v text not null)`);
  ready = true;
}

// When the timer last finished a run, in milliseconds; null when never.
export async function tickSeen(sql) {
  await kvReady(sql);
  const r = await sql`select v from kv where k = 'tick_at'`;
  const n = r[0] ? Number(r[0].v) : NaN;
  return Number.isFinite(n) ? n : null;
}
export async function tickMark(sql, nowMs = Date.now()) {
  await kvReady(sql);
  await sql`insert into kv (k, v) values ('tick_at', ${String(nowMs)}) on conflict (k) do update set v = excluded.v`;
  return 1;
}

// tickBefore: what tickSeen said BEFORE this read ran the timer itself, so
// a family opening Parwah after a long gap is told about the gap.
export async function safetyState(sql, circle, me, tickBefore, nowMs = Date.now()) {
  const quiet = async f => { try { return await f(); } catch (e) { return null; } };
  const adult = isAdult(me.dob, new Date(nowMs).toISOString().slice(0, 10));
  return {
    calls: dialStatus(),
    timer: adult ? { at: tickBefore ? new Date(tickBefore).toISOString() : null, ...timerLine(tickBefore, nowMs) } : null,
    doseTell: await quiet(() => doseTellState(sql, circle.id, me.id)),
    rememberAsks: (await quiet(() => rememberAsksFor(sql, circle.id, me.id))) || []
  };
}
