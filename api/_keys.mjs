// Provider-key vault (helper, not an endpoint). Ekta's brain can be armed
// two ways: environment variables (preferred) or keys the family saved in
// the database vault via /api/keys — useful because this deployment's env
// cannot always be edited from every tool. Env always wins over the vault.
// Values never leave the server: /api/keys reports presence only.

export const PROVIDERS = ['anthropic', 'openai', 'gemini', 'grok', 'kimi'];

const ENV_MAP = {
  anthropic: ['ANTHROPIC_API_KEY'],
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

// → { keys: {provider: string|null}, src: {provider: 'env'|'vault'|null} }
export async function providerKeys(sql) {
  await ensureKv(sql);
  const rows = await sql`select k, v from kv where k like ${'pkey_%'}`;
  const keys = {}, src = {};
  for (const p of PROVIDERS) {
    keys[p] = null; src[p] = null;
    for (const e of ENV_MAP[p]) {
      if (process.env[e]) { keys[p] = process.env[e]; src[p] = 'env'; break; }
    }
    if (!keys[p]) {
      const r = rows.find(x => x.k === 'pkey_' + p);
      if (r) { keys[p] = r.v; src[p] = 'vault'; }
    }
  }
  return { keys, src };
}
