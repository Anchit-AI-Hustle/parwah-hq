// A stand-in for @neondatabase/serverless that runs the same tagged-template
// queries against an ordinary PostgreSQL, so the real API handlers can be
// tested end to end against a real database. Test-only: see register.mjs.
import pg from 'pg';

export function neon(url) {
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  (globalThis.__parwahPools ||= []).push(pool);
  const sql = (strings, ...vals) => {
    let text = strings[0];
    for (let i = 0; i < vals.length; i++) text += '$' + (i + 1) + strings[i + 1];
    const params = vals.map(v => (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) ? JSON.stringify(v) : v);
    return pool.query(text, params).then(r => r.rows);
  };
  sql.query = (text, params) => pool.query(text, params).then(r => r.rows);
  return sql;
}
