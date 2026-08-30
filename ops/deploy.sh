#!/usr/bin/env bash
# Parwah — gate, deploy, verify. Run by cron on a machine that can reach
# api.vercel.com (the development sandbox cannot, and the Vercel git
# integration for this project stopped creating deployments).
#
# Every run, in order:
#   1. fetch origin and fast-forward main — never touches a dirty tree
#   2. run scripts/checks.sh, the same gate the Vercel build runs
#   3. deploy STRAIGHT TO PRODUCTION with the Vercel CLI
#   4. curl the live database self-test and fail loudly if it is not green
#
# Nothing happens when the remote has not moved, so this is cheap to run
# every few minutes. Pass --force to deploy the current commit anyway.
#
#   ops/deploy.sh [--force] [--dry-run]
#
# Token: put it in ~/.parwah/vercel-token (chmod 600) or export VERCEL_TOKEN.
# It is never read from, or written to, this repository.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH=main
PROD_URL="https://parwah-hq.anchit-tandon.com"
STATE="$REPO/.deploy-state"          # gitignored: last commit we deployed
LOCK="${TMPDIR:-/tmp}/parwah-deploy.lock"
export VERCEL_ORG_ID=team_yC0I2xlKsitxFcfizef9EDQl
export VERCEL_PROJECT_ID=prj_n8jIIXMHjsT9NK4AVr5I0yj6tkj4

FORCE=0; DRY=0
for a in "$@"; do
  case "$a" in
    --force)   FORCE=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "FAILED: $*"; exit 1; }

# One deploy at a time, however often cron fires.
exec 9>"$LOCK" || die "cannot open lock $LOCK"
flock -n 9 || { log "another deploy is running — skipping this tick"; exit 0; }

cd "$REPO" || die "no repo at $REPO"

if [ -z "${VERCEL_TOKEN:-}" ] && [ -r "$HOME/.parwah/vercel-token" ]; then
  VERCEL_TOKEN="$(tr -d '[:space:]' < "$HOME/.parwah/vercel-token")"
fi
[ -n "${VERCEL_TOKEN:-}" ] || die "no VERCEL_TOKEN (put one in ~/.parwah/vercel-token, chmod 600)"
command -v vercel >/dev/null 2>&1 || die "vercel CLI not installed — npm i -g vercel"

# 1. bring the branch up to date, but never clobber work in progress
if [ -n "$(git status --porcelain)" ]; then
  log "working tree is dirty — refusing to deploy something that is not committed"
  exit 0
fi
git fetch --quiet origin "$BRANCH" || die "git fetch failed"
git checkout --quiet "$BRANCH" || die "cannot check out $BRANCH"
git merge --quiet --ff-only "origin/$BRANCH" || die "$BRANCH has diverged from origin — resolve by hand"

HEAD_SHA="$(git rev-parse HEAD)"
LAST="$( [ -r "$STATE" ] && cat "$STATE" || echo none )"
if [ "$HEAD_SHA" = "$LAST" ] && [ "$FORCE" -eq 0 ]; then
  exit 0                                  # nothing new — stay silent for cron
fi
log "deploying $(git log -1 --format='%h %s' | cut -c1-72)"

# 2. the gate — a red tree must never reach production
bash scripts/checks.sh >/dev/null 2>&1 || {
  log "gate FAILED — not deploying. Re-run 'bash scripts/checks.sh' to see why."
  bash scripts/checks.sh 2>&1 | grep -E '^FAIL|CHECK\(S\) FAILED' | head -20
  exit 1
}
log "gate passed"

if [ "$DRY" -eq 1 ]; then log "dry run — stopping before deploy"; exit 0; fi

# 3. production, not preview
vercel pull --yes --environment=production --token="$VERCEL_TOKEN" >/dev/null 2>&1 \
  || die "vercel pull failed (token or network)"
vercel build --prod --token="$VERCEL_TOKEN" >/dev/null 2>&1 \
  || die "vercel build failed — run 'vercel build --prod' to see the output"
URL="$(vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN" 2>/dev/null | tail -1)"
[ -n "$URL" ] || die "vercel deploy produced no URL"
log "deployed $URL"

# 4. prove it against the live database before calling it done
BODY=""
for _ in 1 2 3 4 5 6; do
  BODY="$(curl -fsS --max-time 25 "$PROD_URL/api/diag?probe=db" 2>/dev/null)" && break
  sleep 5
done
case "$BODY" in
  *'"ok":true'*) log "live self-test green on $PROD_URL" ;;
  "")            die "live self-test unreachable at $PROD_URL" ;;
  *)             log "$BODY"; die "live self-test NOT green — production is serving a broken build" ;;
esac

echo "$HEAD_SHA" > "$STATE"
log "done — $PROD_URL is on $(git rev-parse --short HEAD)"
