// ops/verify-live.sh, tested against a server that answers the way production
// does. The bug this exists to prevent: the old poll used `curl -f`, and a red
// self-test answers with HTTP 500, so `-f` discarded the body and the failing
// step never reached the log. A check that cannot report a failure is not a
// check, and the only way to know the red path works is to make it go red.
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'ops', 'verify-live.sh');

// The gate runs on a builder we do not control. If it has no bash or no
// curl, say so and pass - a skipped check that announces itself is honest;
// a check that fails for want of a shell is noise that teaches people to
// ignore red.
for (const bin of ['bash', 'curl']) {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); }
  catch { console.log(`verifytest: no ${bin} on this machine - skipped`); process.exit(0); }
}

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(name + (detail ? ' -> ' + detail : ''));
}

// A server driven by a script of replies, one per request, last one repeating.
function serve(replies) {
  let n = 0;
  const srv = http.createServer((req, res) => {
    const r = replies[Math.min(n++, replies.length - 1)];
    const body = typeof r.body === 'function' ? r.body(req) : r.body;
    res.writeHead(r.status, r.headers || { 'content-type': 'application/json' });
    res.end(body == null ? '' : body);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// The script, run to completion. Exit status and output are both the answer.
// Async on purpose: execFileSync blocks the event loop, and the server being
// tested against lives in THIS process - a synchronous run would never be
// answered, which is a fine way to spend two minutes learning nothing.
function run(port) {
  const env = {
    ...process.env,
    PARWAH_POLL_SECONDS: '0', PARWAH_POLL_TRIES: '4', PARWAH_MAX_RED: '2',
    // The probes write to the database, so they are behind the deploy
    // secret and the verifier refuses to run without it.
    PARWAH_DIAG_SECRET: process.env.PARWAH_DIAG_SECRET || 'test-diag-key',
  };
  return new Promise((resolve) => {
    execFile('bash', [SCRIPT, `http://127.0.0.1:${port}`],
      { env, encoding: 'utf8', timeout: 60000 },
      (err, stdout, stderr) => resolve({
        code: err ? (err.code == null ? -1 : err.code) : 0,
        out: String(stdout || '') + String(stderr || ''),
      }));
  });
}

const GREEN_DB = { status: 200, body: JSON.stringify({ ok: true, steps: { schema: true } }) };
const GREEN_DAY = { status: 200, body: JSON.stringify({ ok: true, summary: 'Amrit until 15:42' }) };

async function withServer(replies, fn) {
  const srv = await serve(replies);
  srv.on('connection', (c) => c.unref());   // curl keep-alive must not hold the close
  try { return await fn(srv.address().port); }
  finally { await new Promise((r) => srv.close(r)); }
}

// 1. A red self-test names the steps that failed, and fails the run.
await withServer([{
  status: 500,
  body: JSON.stringify({ ok: false, steps: { schema: true, circle_unread: false, coins_spend: false } }),
}], async (port) => {
  const r = await run(port);
  ok('red exits non-zero', r.code !== 0, 'code ' + r.code);
  ok('red names circle_unread', r.out.includes('circle_unread'));
  ok('red names coins_spend', r.out.includes('coins_spend'));
  ok('red is not called unreachable', !r.out.includes('unreachable'));
  ok('red does not name the verdict as a step', !/failing:.*\bok\b/.test(r.out));
});

// 2. An error carried in the body is printed, not swallowed.
await withServer([{
  status: 500,
  body: JSON.stringify({ ok: false, steps: { schema: true }, error: 'relation "pulse" does not exist' }),
}], async (port) => {
  const r = await run(port);
  ok('body error reaches the log', r.out.includes('relation "pulse" does not exist'));
});

// 3. Green passes, and the day probe's summary is reported.
await withServer([GREEN_DB, GREEN_DAY], async (port) => {
  const r = await run(port);
  ok('green exits zero', r.code === 0, 'code ' + r.code + ' out ' + r.out);
  ok('green says green', r.out.includes('green'));
  ok('green reports the muhurat summary', r.out.includes('Amrit until 15:42'));
});

// 4. The real deploy sequence: nothing serving, then nothing, then green.
await withServer([
  { status: 503, body: '' }, { status: 503, body: '' }, GREEN_DB, GREEN_DAY,
], async (port) => {
  const r = await run(port);
  // A 503 with an empty body is an answer, not silence, so it must be
  // reported as an answer that is not the self-test - never as a database
  // failure, which is what sent us looking in the wrong place.
  ok('a 503 is not called a self-test failure', !r.out.includes('self-test RED'));
});

// 5. An HTML page is not a red self-test. This is the case the old script
// reported as "answering but not green", which is a database diagnosis for
// something that never reached the database.
await withServer([{
  status: 200, headers: { 'content-type': 'text/html' },
  body: '<!doctype html><title>Parwah</title><p>the app shell</p>',
}], async (port) => {
  const r = await run(port);
  ok('html exits non-zero', r.code !== 0);
  ok('html is named as not the self-test', r.out.includes('not the self-test'));
  ok('html shows what came back', r.out.includes('doctype'));
  ok('html is not called a self-test failure', !r.out.includes('self-test RED'));
});

// 6. A trailing-slash redirect is followed, not mistaken for a broken build.
// vercel.json sets trailingSlash, and the old poll did not pass -L.
await withServer([
  { status: 308, headers: { location: '/api/diag/?probe=db' }, body: '' },
  GREEN_DB, GREEN_DAY,
], async (port) => {
  const r = await run(port);
  ok('a redirect is followed to green', r.code === 0, 'code ' + r.code + ' out ' + r.out);
});

// 7. Nothing listening at all is unreachable, and says so.
{
  const srv = await serve([GREEN_DB]);
  const port = srv.address().port;
  await new Promise(r => srv.close(r));
  const r = await run(port);
  ok('closed port exits non-zero', r.code !== 0);
  ok('closed port says unreachable', r.out.includes('unreachable'));
}

// 8. A red day probe fails the run even when the database is green.
await withServer([GREEN_DB, { status: 500, body: JSON.stringify({ ok: false, checks: { abhijit: false } }) }],
  async (port) => {
    const r = await run(port);
    ok('red muhurat fails the run', r.code !== 0, 'code ' + r.code);
    ok('red muhurat is named', r.out.includes('muhurat'));
  });

// 9. A build that goes red and then stops answering is a FAILED build, not
// an unreachable one. Silence must not launder a failure into "still coming up".
await withServer([
  { status: 500, body: JSON.stringify({ ok: false, steps: { coins_spend: false } }) },
  { status: 503, body: '' }, { status: 503, body: '' }, { status: 503, body: '' },
], async (port) => {
  const r = await run(port);
  ok('red then silence still reports the failure', r.out.includes('NOT green'), r.out);
  ok('red then silence is not called unreachable', !r.out.includes('unreachable'));
});

// 10. An empty body with a real status code says so, rather than pretending
// nothing answered at all.
await withServer([{ status: 503, body: '' }], async (port) => {
  const r = await run(port);
  ok('an empty 503 body reports its status', r.out.includes('HTTP 503'));
});

// 11. Without the diagnostics key the verifier refuses rather than polling a
// 403 forty times and calling production unreachable.
{
  const srv = await serve([GREEN_DB]);
  const port = srv.address().port;
  let code = 0, out = '';
  try {
    execFileSync('bash', [SCRIPT, `http://127.0.0.1:${port}`], {
      encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, PARWAH_DIAG_SECRET: '', CRON_SECRET: '' },
    });
  } catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  await new Promise((r) => srv.close(r));
  ok('no diagnostics key is an error, not a false red', code !== 0);
  ok('and it says which variable to set', /PARWAH_DIAG_SECRET/.test(out));
}

// 11b. The key travels in the X-Diag-Key header, never in the address.
{
  const seen = [];
  await withServer([{ status: 200, body: (req) => { seen.push({ url: req.url, key: req.headers['x-diag-key'] }); return GREEN_DB.body; } },
                    { status: 200, body: (req) => { seen.push({ url: req.url, key: req.headers['x-diag-key'] }); return GREEN_DAY.body; } }], async (port) => {
    await run(port);
  });
  ok('the diagnostics key is sent as a header', seen.length > 0 && seen.every(x => x.key === (process.env.PARWAH_DIAG_SECRET || 'test-diag-key')), JSON.stringify(seen));
  ok('and never in the address', seen.every(x => !/key=/.test(x.url)), JSON.stringify(seen.map(x => x.url)));
}

// 12. No argument is a usage error, not a silent pass.
{
  let code = 0;
  try { execFileSync('bash', [SCRIPT], { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  ok('no base url is an error', code !== 0);
}

if (fails.length) {
  console.error(`verifytest: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`verifytest: ${pass}/${pass} checks pass`);
