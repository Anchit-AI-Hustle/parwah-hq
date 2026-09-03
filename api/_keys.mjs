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

// A FAMILY'S KEY IS THEIRS. The vault used to store one row per provider for
// the whole deployment, so any member of any circle could read past, set over,
// or clear another family's key - and spend their credit. Keys written from
// inside the app are scoped to the circle that wrote them.
//
// The old unscoped rows are still READ, and never written, so a key an
// operator put there keeps working as a deployment-wide default alongside the
// environment. Nothing a family sets can reach another family.
export function circleKeyName(circleId, provider) { return 'pkey_c_' + circleId + '_' + provider; }
const LEGACY_KEY = (provider) => 'pkey_' + provider;

// → { keys: {provider: string|null}, src: {provider: 'env'|'circle'|'shared'|null} }
export async function providerKeys(sql, circleId) {
  await ensureKv(sql);
  const rows = await sql`select k, v from kv where k like ${'pkey_%'}`;
  const at = (name) => { const r = rows.find(x => x.k === name); return r ? r.v : null; };
  const keys = {}, src = {};
  for (const p of PROVIDERS) {
    keys[p] = null; src[p] = null;
    for (const e of ENV_MAP[p]) {
      if (process.env[e]) { keys[p] = process.env[e]; src[p] = 'env'; break; }
    }
    if (!keys[p] && circleId) {
      const own = at(circleKeyName(circleId, p));
      if (own) { keys[p] = own; src[p] = 'circle'; }
    }
    if (!keys[p]) {
      const shared = at(LEGACY_KEY(p));
      if (shared) { keys[p] = shared; src[p] = 'shared'; }
    }
  }
  return { keys, src };
}
