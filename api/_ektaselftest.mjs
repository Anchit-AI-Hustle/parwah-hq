// GET /api/ekta-selftest?run=ekta - full live round-trip test of Ekta.
// Creates a throwaway circle + member, holds a real two-turn conversation
// through the actual model cascade (a circle question, then a reminder ask),
// verifies the reminder landed in the database, then deletes the circle
// (cascade removes everything). Self-cleaning; safe to run any time.
// The ?run=ekta gate keeps crawlers from burning model tokens.
import Anthropic from '@anthropic-ai/sdk';
import { db, ensureSchema, makeCode, rateLimit } from './_db.mjs';
import { ektaTurn } from './ekta.mjs';
import { LOCAL_MODEL } from './_ektalocal.mjs';

// One-token probe: does this key work with a given anthropic-workspace-id
// header value? Returns 'ok' or the API's error message.
async function probeWorkspace(headerValue) {
  try {
    const client = new Anthropic(headerValue
      ? { defaultHeaders: { 'anthropic-workspace-id': headerValue } }
      : {});
    await client.messages.create({
      model: process.env.ANTHROPIC_FALLBACK_MODEL || 'claude-3-5-haiku-20241022', max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }]
    });
    return 'ok';
  } catch (e) { return String(e && e.message || e).slice(0, 180); }
}

export default async function handler(req, res) {
  if (((req.query || {}).run) !== 'ekta') {
    return res.status(400).json({ ok: false, error: 'Add ?run=ekta to run this test' });
  }
  // A LITERAL QUERY STRING IS NOT A GATE. Every hit ran two full model
  // cascades and wrote to the database, so anyone who found the URL could
  // spend the family's credit and fill the table, unauthenticated and
  // unlimited. It needs the deploy secret now, and it runs at most once a
  // minute however many people ask.
  const secret = process.env.PARWAH_DIAG_SECRET || process.env.CRON_SECRET;
  const given = String((req.query || {}).key || (req.headers && req.headers['x-diag-key']) || '');
  if (!secret) {
    return res.status(503).json({ ok: false,
      error: 'This probe spends model credits, so it stays off until PARWAH_DIAG_SECRET is set on the server.' });
  }
  if (given !== secret) {
    return res.status(403).json({ ok: false, error: 'This probe spends model credits and needs its key.' });
  }
  // Presence booleans only - never values. Helps diagnose env-var setup.
  const env = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_WORKSPACE_ID: !!(process.env.ANTHROPIC_WORKSPACE_ID && String(process.env.ANTHROPIC_WORKSPACE_ID).trim()),
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    XAI_API_KEY: !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY),
    KIMI_API_KEY: !!(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY),
    OLLAMA_URL: !!process.env.OLLAMA_URL
  };
  // No key in the ENV is not a failure any more: the keys may be in the
  // in-app vault, and with no key at all Ekta still answers from the
  // family's own records. The run below reports which of those happened.
  // ?probe=1 → only test which workspace-header values this key accepts.
  if ((req.query || {}).probe) {
    const probes = {};
    probes.no_header = await probeWorkspace(null);
    probes.literal_default = await probeWorkspace('default');
    if (process.env.ANTHROPIC_WORKSPACE_ID) probes.env_value = await probeWorkspace(process.env.ANTHROPIC_WORKSPACE_ID);
    return res.status(200).json({ ok: true, env, probes });
  }
  const steps = {};
  let sql, circleId;
  try {
    sql = db(); await ensureSchema(sql);
    // One run a minute, counted in the database so it holds across instances.
    if (!(await rateLimit(sql, 'ektaprobe', 'global', 1, 60))) {
      return res.status(429).json({ ok: false, error: 'This probe runs at most once a minute.' });
    }
    const code = makeCode();
    const c = await sql`insert into circles (code, name) values (${code}, 'Ekta Selftest') returning id`;
    circleId = c[0].id;
    const m = await sql`insert into members (circle_id, name, role) values (${circleId}, 'Tester', 'family') returning id`;
    steps.setup = true;
    const circle = { id: circleId, code, name: 'Ekta Selftest' };
    const me = { id: m[0].id, name: 'Tester', role: 'family' };

    // Turn 1: a question that requires the get_circle tool.
    const t1 = await ektaTurn(sql, circle, me, [
      { role: 'user', content: 'Who is in my circle right now? Answer in English.' }
    ]);
    steps.replied = !!(t1.reply && t1.reply.length > 3);
    steps.model_1 = t1.model;
    steps.reply_1 = String(t1.reply).slice(0, 220);

    // Whether a real model answered, or Ekta fell back to the family's own
    // records. Both are working states; only one of them can set a reminder,
    // and the log must say which so nobody debugs the wrong thing.
    const offline = t1.model === LOCAL_MODEL;
    steps.model_live = !offline;
    steps.brain = offline ? (t1.reason || 'unreachable') : 'live';

    if (offline) {
      // The degraded path is a promise too, so it is tested, not assumed:
      // the guide's fourth screen must still answer with no credit at all.
      const t2 = await ektaTurn(sql, circle, me, [
        { role: 'user', content: 'Taking Papa to a new doctor tomorrow. What do we have?' }
      ]);
      steps.model_2 = t2.model;
      steps.reply_2 = String(t2.reply).slice(0, 220);
      steps.offline_answers_from_records = /recorded|Nothing has been recorded/i.test(String(t2.reply));
      steps.offline_says_why = /no credit|not working|no AI key|could not reach/i.test(String(t2.reply));
      steps.offline_never_diagnoses = !/(you should take|diagnos|prescrib|dosage)/i.test(String(t2.reply));
      steps.reminder_action = null;   // no model, so no action: not a failure
      steps.reminder_in_db = null;
    } else {
      // Turn 2: an action - a self reminder via the create_reminder tool.
      const t2 = await ektaTurn(sql, circle, me, [
        { role: 'user', content: 'Please set a daily reminder for me to take my BP pills at 9 am.' }
      ]);
      steps.reminder_action = t2.actions.indexOf('create_reminder') >= 0;
      steps.model_2 = t2.model;
      steps.reply_2 = String(t2.reply).slice(0, 220);
      const rows = await sql`select status, recurrence from reminders where circle_id = ${circleId}`;
      steps.reminder_in_db = rows.length > 0;
      steps.reminder_status = rows[0] ? rows[0].status : null;
    }

    await sql`delete from circles where id = ${circleId}`;
    const left = await sql`select id from members where circle_id = ${circleId}`;
    steps.cleanup_cascade = left.length === 0;

    // Green means the FAMILY IS SERVED. A dead key is reported loudly in
    // `brain` and `note`, but it does not fail a deploy: a red gate that
    // nobody can clear without a credit card is a gate people learn to skip.
    const ok = offline
      ? !!(steps.setup && steps.replied && steps.cleanup_cascade
           && steps.offline_answers_from_records && steps.offline_says_why && steps.offline_never_diagnoses)
      : !!(steps.setup && steps.replied && steps.reminder_action && steps.reminder_in_db && steps.cleanup_cascade);
    const note = offline
      ? 'Ekta is answering from family records only. Reason: ' + steps.brain
        + '. Add credit or another provider key to restore full conversation and actions.'
      : 'Ekta is live on ' + steps.model_1 + '.';
    return res.status(ok ? 200 : 500).json({ ok, brain: steps.brain, note, steps, env });
  } catch (e) {
    try { if (sql && circleId) await sql`delete from circles where id = ${circleId}`; } catch (e2) {}
    return res.status(500).json({ ok: false, error: String(e && e.message || e).slice(0, 300), steps, env });
  }
}
