#!/usr/bin/env bash
# BUILD EXACTLY WHAT VERCEL BUILDS.
#
# `npm test` runs the gate on a full checkout. Vercel does not get a full
# checkout: .vercelignore strips hq/, CLAUDE.md, merge/ and more out of every
# upload, and then Vercel runs `npm run build` - which runs the gate again -
# on what is left. A check that reads one of the stripped files passes in CI
# and kills every production build, and that happened: a check reading
# CLAUDE.md made every deploy fail with FileNotFoundError before a single
# page was looked at.
#
# So this reproduces the upload - the files git would commit, minus
# .vercelignore, with gitignore semantics - and runs the real build on it.
# Green here means green on Vercel's builder, not merely green on a laptop.
#
#   bash ops/vercel-input.sh            # into a temporary directory
#   VERCEL_INPUT_DIR=/some/dir bash ops/vercel-input.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${VERCEL_INPUT_DIR:-$(mktemp -d)}"
[ -n "${VERCEL_INPUT_DIR:-}" ] || trap 'rm -rf "$OUT"' EXIT
rm -rf "$OUT" && mkdir -p "$OUT"

# Tracked files plus new ones not yet committed - what `git add -A` would
# send - so this can be run before a commit, not only after.
python3 - "$ROOT" "$OUT" <<'PY'
import fnmatch, os, shutil, subprocess, sys
root, out = sys.argv[1], sys.argv[2]
files = subprocess.check_output(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    cwd=root
).split(b'\0')

for f in files:
    if not f:
        continue
    rel = f.decode('utf-8', errors='replace')
    src = os.path.join(root, rel)
    dst = os.path.join(out, rel)
    if os.path.exists(src) and not os.path.isdir(src):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)

pats = [l.strip() for l in open(os.path.join(out, ".vercelignore"))
        if l.strip() and not l.lstrip().startswith("#")]
gone = []
for r, dirs, fls in os.walk(out, topdown=True):
    rel_root = os.path.relpath(r, out)
    for d in list(dirs):
        rel = os.path.normpath(os.path.join(rel_root, d))
        if any(fnmatch.fnmatch(d, p.rstrip("/")) or fnmatch.fnmatch(rel, p.rstrip("/")) for p in pats):
            shutil.rmtree(os.path.join(r, d)); dirs.remove(d); gone.append(rel + "/")
    for fl in fls:
        rel = os.path.normpath(os.path.join(rel_root, fl))
        if any(not p.endswith("/") and (fnmatch.fnmatch(fl, p) or fnmatch.fnmatch(rel, p)) for p in pats):
            os.remove(os.path.join(r, fl)); gone.append(rel)
print("vercel-input: stripped by .vercelignore -> " + ", ".join(sorted(gone)))
PY

cd "$OUT"
npm ci --silent --no-audit --no-fund
# Vercel's builder never sets GITHUB_ACTIONS. Running inside a GitHub job,
# this script inherited it, and the gate took the stripped upload for a full
# CI checkout and demanded CLAUDE.md, which .vercelignore removes on purpose:
# every pull request went red here. The full checkout (npm test) still runs
# with it set, so a CI checkout missing CLAUDE.md still fails there.
if ! env -u GITHUB_ACTIONS npm run build > vercel-build.log 2>&1; then
  echo "vercel-input: THE BUILD VERCEL WILL RUN FAILS on the files Vercel will receive:" >&2
  grep -E "^FAIL|Traceback|Error|CHECK\(S\) FAILED" vercel-build.log | head -20 >&2
  exit 1
fi
echo "vercel-input: the build Vercel will run passes on the files Vercel will receive"
