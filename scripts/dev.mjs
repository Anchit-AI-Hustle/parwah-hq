#!/usr/bin/env node
/* Local dev server: serves site/public the way Vercel does (cleanUrls,
   trailingSlash) and runs api/*.mjs in-process with a Vercel-shaped req/res.
   Exists so the whole product — app plus API plus database — can be opened in
   a browser and tested before it is deployed, which previously needed the
   Vercel CLI and a login.

   Usage: node scripts/dev.mjs [port]        (reads .env.local for DATABASE_URL) */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'site', 'public');
const PORT = Number(process.argv[2] || process.env.PORT || 3000);

// .env.local, so secrets stay out of the shell history and out of git.
for (const f of ['.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp',
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// The half of the Vercel Node helper surface these functions actually use.
function shimRes(res) {
  const out = res;
  out.status = (c) => { out.statusCode = c; return out; };
  out.json = (o) => {
    if (!out.headersSent) out.setHeader('Content-Type', 'application/json; charset=utf-8');
    out.end(JSON.stringify(o));
    return out;
  };
  out.send = (b) => { out.end(typeof b === 'string' || Buffer.isBuffer(b) ? b : String(b)); return out; };
  return out;
}

async function runApi(req, res, url) {
  const name = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  const file = path.join(ROOT, 'api', name + '.mjs');
  if (!/^[a-z0-9_-]+$/i.test(name) || !fs.existsSync(file)) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ ok: false, error: 'No such API route: ' + name }));
  }
  const raw = await readBody(req);
  req.query = Object.fromEntries(url.searchParams.entries());
  if (raw.length) {
    const ct = String(req.headers['content-type'] || '');
    try { req.body = ct.includes('json') || raw[0] === 0x7b ? JSON.parse(raw.toString('utf8')) : raw.toString('utf8'); }
    catch { req.body = raw.toString('utf8'); }
  } else req.body = undefined;
  try {
    // Deliberately NOT cache-busted. Re-importing only the handler leaves its
    // dependencies (_db.mjs and friends) on the previous copy, which fails in
    // the most confusing way possible: a brand-new export "does not exist".
    // Run this under `node --watch` — the whole process restarts and every
    // module is fresh together.
    const mod = await import(pathToFileURL(file).href);
    await mod.default(req, shimRes(res));
  } catch (e) {
    console.error('[api ' + name + ']', e);
    if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) })); }
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.includes('\0')) { res.statusCode = 400; return res.end('Bad path'); }
  const candidates = rel.endsWith('/')
    ? [rel + 'index.html']
    : [rel, rel + '.html', rel + '/index.html'];
  for (const c of candidates) {
    const p = path.join(PUBLIC, c);
    if (!p.startsWith(PUBLIC)) continue;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      // The headers vercel.json sets, so local behaviour matches production.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      return fs.createReadStream(p).pipe(res);
    }
  }
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<h1>404</h1><p>Not found: ' + rel.replace(/[<>&]/g, '') + '</p>');
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const t0 = Date.now();
  res.on('finish', () => {
    if (url.pathname.startsWith('/api/')) {
      console.log(res.statusCode + ' ' + req.method + ' ' + url.pathname + url.search + ' (' + (Date.now() - t0) + 'ms)');
    }
  });
  if (url.pathname.startsWith('/api/')) return runApi(req, res, url);
  return serveStatic(req, res, url);
}).listen(PORT, () => {
  console.log('Parwah dev server: http://localhost:' + PORT + '/');
  console.log('  app:  http://localhost:' + PORT + '/app/');
  console.log('  DATABASE_URL ' + (process.env.DATABASE_URL ? 'set' : 'MISSING — API calls will fail'));
});
