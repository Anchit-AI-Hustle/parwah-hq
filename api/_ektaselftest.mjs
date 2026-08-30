// GET /api/ekta-selftest?run=ekta — full live round-trip test of Ekta.
// Creates a throwaway circle + member, holds a real two-turn conversation
// through the actual model cascade (a circle question, then a reminder ask),
// verifies the reminder landed in the database, then deletes the circle
// (cascade removes everything). Self-cleaning; safe to run any time.
// The ?run=ekta gate keeps crawlers from burning model tokens.
import Anthropic from '@anthropic-ai/sdk';
import { db, ensureSchema, makeCode } from './_db.mjs';
import { ektaTurn } from './ekta.mjs';

// One-token probe: does this key work with a given anthropic-workspace-id
// header value? Returns 'ok' or the API's error message.
async function probeWorkspace(headerValue) {
  try {
    const client = new Anthropic(headerValue
      ? { defaultHeaders: { 'anthropic-workspace-id': headerValue } }
      : {});
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }]
    });
    return 'ok';
  } catch (e) { return String(e && e.message || e).slice(0, 180); }
}

export default async function handler(req, res) {
  if (((req.query || {}).run) !== 'ekta') {
    return res.status(400).json({ ok: false, error: 'Add ?run=ekta to run this test' });
  }
  // Presence booleans only — never values. Helps diagnose env-var setup.
  const env = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_WORKSPACE_ID: !!(process.env.ANTHROPIC_WORKSPACE_ID && String(process.env.ANTHROPIC_WORKSPACE_ID).trim()),
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    XAI_API_KEY: !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY),
    KIMI_API_KEY: !!(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY),
    OLLAMA_URL: !!process.env.OLLAMA_URL
  };
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.GEMINI_API_KEY && !env.XAI_API_KEY && !env.KIMI_API_KEY && !env.OLLAMA_URL) {
    return res.status(503).json({ ok: false, error: 'No model API key is configured on the server', env });
  }
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

    // Turn 2: an action — a self reminder via the create_reminder tool.
    const t2 = await ektaTurn(sql, circle, me, [
      { role: 'user', content: 'Please set a daily reminder for me to take my BP pills at 9 am.' }
    ]);
    steps.reminder_action = t2.actions.indexOf('create_reminder') >= 0;
    steps.model_2 = t2.model;
    steps.reply_2 = String(t2.reply).slice(0, 220);
    const rows = await sql`select status, recurrence from reminders where circle_id = ${circleId}`;
    steps.reminder_in_db = rows.length > 0;
    steps.reminder_status = rows[0] ? rows[0].status : null;

    await sql`delete from circles where id = ${circleId}`;
    const left = await sql`select id from members where circle_id = ${circleId}`;
    steps.cleanup_cascade = left.length === 0;

    const ok = !!(steps.setup && steps.replied && steps.reminder_action && steps.reminder_in_db && steps.cleanup_cascade);
    return res.status(ok ? 200 : 500).json({ ok, steps, env });
  } catch (e) {
    try { if (sql && circleId) await sql`delete from circles where id = ${circleId}`; } catch (e2) {}
    return res.status(500).json({ ok: false, error: String(e && e.message || e).slice(0, 300), steps, env });
  }
}
