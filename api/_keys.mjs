// Provider-key vault (helper, not an endpoint). Ekta's brain can be armed
// two ways: environment variables (preferred) or keys the family saved in
// the database vault via /api/keys — useful because this deployment's env
// cannot always be edited from every tool. Env always wins over the vault.
// Values never leave the server: /api/keys reports presence only.

export const PROVIDERS = ['anthropic', 'anthropic_ws', 'openai', 'gemini', 'grok', 'kimi'];
// Providers that actually answer a turn (anthropic_ws is a setting, not a brain).
export const MODEL_PROVIDERS = ['anthropic', 'openai', 'gemini', 'grok', 'kimi'];

const ENV_MAP = {
  anthropic: ['ANTHROPIC_API_KEY'],
  anthropic_ws: ['ANTHROPIC_WORKSPACE_ID'],
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  grok: ['XAI_API_KEY', 'GROK_API_KEY'],
  kimi: ['KIMI_API_KEY', 'MOONSHOT_API_KEY']
};

export async function ensureKv(sql) {
  await sql`create table if not exists kv (
    k text primary key,
    v text not null
  )`;
}

// A key a family saved belongs to that family. It used to be stored under one
// row per provider for the whole deployment, so any member of any circle could
// replace — or delete — the key every other family's Ekta was running on,
// while the screen offering it sits in their own profile and says "Ekta's
// brain". Circle-scoped now, with the deployment's own key as the fallback.
const rowKey = (provider, circleId) => circleId ? 'pkey_' + circleId + '_' + provider : 'pkey_' + provider;
export { rowKey as providerRowKey };

// → { keys: {provider: string|null}, src: {provider: 'env'|'circle'|'shared'|null} }
export async function providerKeys(sql, circleId) {
  await ensureKv(sql);
  const rows = await sql`select k, v from kv where k like ${'pkey_%'}`;
  const keys = {}, src = {};
  for (const p of PROVIDERS) {
    keys[p] = null; src[p] = null;
    for (const e of ENV_MAP[p]) {
      if (process.env[e]) { keys[p] = process.env[e]; src[p] = 'env'; break; }
    }
    if (!keys[p] && circleId) {
      const own = rows.find(x => x.k === rowKey(p, circleId));
      if (own) { keys[p] = own.v; src[p] = 'circle'; }
    }
    if (!keys[p]) {
      // Left over from when this was one row for everybody, or set by hand on
      // the deployment: usable, but no longer writable from the app.
      const shared = rows.find(x => x.k === rowKey(p, null));
      if (shared) { keys[p] = shared.v; src[p] = 'shared'; }
    }
  }
  return { keys, src };
}
