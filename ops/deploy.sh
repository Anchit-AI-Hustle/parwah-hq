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
# Signing in, either way round:
#   by hand — `vercel login` once on this machine and nothing else is needed
#   from cron — a token in ~/.parwah/vercel-token (chmod 600), or $VERCEL_TOKEN
# A token is tried first when there is one and the stored login is used when
# there is not, OR when the token turns out to be stale: an expired token
# sitting in a shell profile must not stop a signed-in person from deploying.
# Neither is ever read from, or written to, this repository.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH=main
PROD_URL="https://parwah-hq.anchit-tandon.com"
STATE="$REPO/.deploy-state"          # gitignored: last commit we deployed
LOCK="${TMPDIR:-/tmp}/parwah-deploy.lock"
export VERCEL_ORG_ID=team_yC0I2xlKsitxFcfizef9EDQl
export VERCEL_PROJECT_ID=prj_n8jIIXMHjsT9NK4AVr5I0yj6tkj4
# The project belongs to a TEAM. A token whose default scope is the personal
# account authenticates fine — `whoami` succeeds — and then cannot see the
# project, which surfaces as a confusing "pull failed". Name the scope.
VERCEL_SCOPE=anchit-ai-hustle

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
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK" || die "cannot open lock $LOCK"
  flock -n 9 || { log "another deploy is running — skipping this tick"; exit 0; }
else
  # macOS ships no flock. A stale-tolerant directory lock does the same job:
  # mkdir is atomic everywhere, and the trap releases it however we exit.
  if ! mkdir "$LOCK.d" 2>/dev/null; then
    if [ -n "$(find "$LOCK.d" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$LOCK.d" 2>/dev/null && mkdir "$LOCK.d" 2>/dev/null
    else log "another deploy is running — skipping this tick"; exit 0; fi
  fi
  trap 'rmdir "$LOCK.d" 2>/dev/null' EXIT
fi

cd "$REPO" || die "no repo at $REPO"

if [ -z "${VERCEL_TOKEN:-}" ] && [ -r "$HOME/.parwah/vercel-token" ]; then
  VERCEL_TOKEN="$(tr -d '[:space:]' < "$HOME/.parwah/vercel-token")"
fi
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

# Dependencies, if this clone has none yet. Vercel installs them during its
# build; a machine running the gate locally has to do the same.
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  log "installing dependencies"
  npm install --no-audit --no-fund --silent >/dev/null 2>&1 \
    || die "npm install failed — run 'npm install' here to see why"
fi

# 2. the gate — a red tree must never reach production.
# On failure SHOW the failure. Grepping for known-shaped lines hides every
# problem that does not have that shape, which is exactly the case where you
# need the output most.
GATE_LOG="$(mktemp "${TMPDIR:-/tmp}/parwah-gate.XXXXXX")"
# `if ! cmd; then RC=$?` captures the status of the NEGATION — always 0 — and
# reported every gate failure as "exit 0". Take the status first, branch after.
RC=0
bash scripts/checks.sh > "$GATE_LOG" 2>&1 || RC=$?
if [ "$RC" -ne 0 ]; then
  log "gate FAILED (exit $RC) — not deploying. Full output:"
  echo "------------------------------------------------------------"
  if grep -qE '^FAIL' "$GATE_LOG"; then grep -E '^FAIL|CHECK\(S\) FAILED' "$GATE_LOG"; echo "---"; fi
  tail -40 "$GATE_LOG"
  echo "------------------------------------------------------------"
  echo "Saved in full at: $GATE_LOG"
  command -v node    >/dev/null 2>&1 || echo "note: node is not on PATH for this shell"
  command -v python3 >/dev/null 2>&1 || echo "note: python3 is not on PATH — the site suite cannot run"
  exit 1
fi
rm -f "$GATE_LOG"
log "gate passed"

if [ "$DRY" -eq 1 ]; then log "dry run — stopping before deploy"; exit 0; fi

# 3. production, not preview.
# Every step below SHOWS its output on failure. Hiding it once already cost a
# round trip; a deploy script that says only "it failed" is not a tool.
run_vercel() {           # run_vercel <description> <args...>
  local what="$1"; shift
  local out rc
  out="$(mktemp "${TMPDIR:-/tmp}/parwah-vc.XXXXXX")"
  rc=0
  # `local rc=$?` would capture the exit status of `local` itself, not of the
  # command — which is how the first version of this reported "exit 0" on a
  # failure. Assign separately.
  "$@" > "$out" 2>&1 || rc=$?
  VC_OUT="$(cat "$out")"
  if [ "$rc" -ne 0 ]; then
    log "$what FAILED (exit $rc):"
    echo "------------------------------------------------------------"
    tail -30 "$out"
    echo "------------------------------------------------------------"
    rm -f "$out"; return 1
  fi
  rm -f "$out"; return 0
}

# Say which kind of failure it was rather than guessing at the token.
vercel_hint() {
  case "$VC_OUT" in
    *"fetch failed"*|*ENOTFOUND*|*ETIMEDOUT*|*ECONNREFUSED*|*"getaddrinfo"*)
      echo "this machine could not reach api.vercel.com — check the network, a VPN, or a corporate proxy" ;;
    *"Logged out"*|*"logged out"*)
      echo "no Vercel credentials on this machine — run 'vercel login' here, or (for cron) put a token from https://vercel.com/account/settings/tokens in ~/.parwah/vercel-token, chmod 600" ;;
    *401*|*403*|*"not authorized"*|*"Not authorized"*|*"is not valid"*|*"invalid token"*|*"Invalid token"*|*"token was revoked"*)
      echo "Vercel rejected those credentials — run 'vercel login' again, or replace the token with a fresh one from https://vercel.com/account/settings/tokens" ;;
    *"does not exist"*|*"not found"*|*"Project not found"*)
      echo "the project link looks wrong — delete .vercel/ here and re-run so it is rewritten" ;;
    *) echo "see the output above" ;;
  esac
}

# .vercel/ is gitignored, so a fresh clone has no project link at all. Write
# it rather than depending on the CLI reading the environment variables.
if [ ! -f .vercel/project.json ]; then
  log "linking this clone to the parwah project"
  mkdir -p .vercel
  printf '{"projectId":"%s","orgId":"%s"}\n' "$VERCEL_PROJECT_ID" "$VERCEL_ORG_ID" > .vercel/project.json
fi

# Every Vercel call goes through this, so the choice of credential is made
# once. A plain string flag rather than an array: macOS still ships bash 3.2,
# where an empty array under `set -u` is an unbound variable.
AUTH_MODE=none                       # none | token | login
vc() {
  if [ "$AUTH_MODE" = token ]; then vercel "$@" --token="$VERCEL_TOKEN"
  else vercel "$@"; fi
}

# Prove the credentials before anything else, so a bad one is named as a bad
# one instead of surfacing three steps later as "pull failed".
if [ -n "${VERCEL_TOKEN:-}" ]; then
  AUTH_MODE=token
  if ! run_vercel "vercel whoami (token)" vc whoami; then
    log "that token was rejected — falling back to the login stored on this machine"
    AUTH_MODE=none
  fi
fi
if [ "$AUTH_MODE" = none ]; then
  AUTH_MODE=login
  run_vercel "vercel whoami" vc whoami \
    || die "$(vercel_hint)"
fi
log "signed in to Vercel as ${VC_OUT##*$'\n'} (via ${AUTH_MODE})"

# ONE command, not three. `vercel pull` and `vercel build` exist only to build
# LOCALLY and upload the output; deploying the source instead lets Vercel do
# the build it already knows how to do — the same build, running the same gate
# through npm run build. Two fewer API calls, two fewer ways to fail, and no
# dependence on pulling project settings down first.
deploy_once() {          # deploy_once <label> <extra args...>
  local label="$1"; shift
  run_vercel "$label" vc deploy --prod --yes --archive=tgz "$@"
}
if ! deploy_once "vercel deploy (team scope)" --scope="$VERCEL_SCOPE"; then
  # A token already scoped to the team rejects the flag; try it plainly.
  log "retrying without an explicit scope"
  deploy_once "vercel deploy" || die "the deploy was rejected — $(vercel_hint)"
fi
URL="$(printf '%s' "$VC_OUT" | grep -Eo 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1)"
[ -n "$URL" ] || die "the deploy produced no URL — see the output above"
log "deployed $URL"
log "IT IS ALREADY LIVE. What follows is verification, not the deploy —"
log "stopping here with Ctrl-C leaves production on this build, unchecked."

# 4. prove it against the live database before calling it done.
# A silent wait looks identical to a hang, and a person who cannot tell the
# difference presses Ctrl-C — which is exactly how a red self-test went unseen.
# So this says what it is doing, every time round.
POLL="${PARWAH_POLL_SECONDS:-10}"      # seconds between checks; lowered by the tests
BODY=""; RED=0
for i in $(seq 1 40); do
  BODY="$(curl -fsS --max-time 20 "$PROD_URL/api/diag?probe=db" 2>/dev/null)" || BODY=""
  case "$BODY" in *'"ok":true'*) break ;; esac
  if [ -n "$BODY" ]; then
    # It is answering, so the domain is up and a build is serving. A red answer
    # that survives two minutes is a real failure, not a build still landing —
    # waiting the full seven minutes to say so helps nobody.
    RED=$((RED + 1))
    log "  self-test is answering but not green (attempt $i, ${RED}/12 red)"
    [ "$RED" -ge 12 ] && break
  else
    log "  waiting for the build to go live (attempt $i/40, ~$((i * POLL))s)"
  fi
  sleep "$POLL"
done
case "$BODY" in
  *'"ok":true'*) log "live self-test green on $PROD_URL" ;;
  "")            die "live self-test unreachable at $PROD_URL" ;;
                 # the top-level "ok":false is the verdict, not a step
  *)             log "failing steps: $(printf '%s' "$BODY" | grep -o '"[a-z_]*":false' | cut -d'"' -f2 | grep -vx ok | tr '\n' ' ')"
                 log "$BODY"
                 die "live self-test NOT green — production is serving a broken build" ;;
esac

# The day's arithmetic, checked on the build that is now live. Only an
# explicit failure is fatal: this probe also reports whether the horoscope
# source answered, and someone else's uptime is not our deploy's problem.
DAY="$(curl -fsS --max-time 25 "$PROD_URL/api/diag?probe=day" 2>/dev/null)" || DAY=""
case "$DAY" in
  *'"ok":true'*)  log "muhurat check: $(printf '%s' "$DAY" | sed -n 's/.*"summary":"\([^"]*\)".*/\1/p')" ;;
  *'"ok":false'*) log "$DAY"; die "the muhurat self-test is RED on production" ;;
  *)              log "muhurat check: no answer from $PROD_URL/api/diag?probe=day (not fatal)" ;;
esac

echo "$HEAD_SHA" > "$STATE"
log "done — $PROD_URL is on $(git rev-parse --short HEAD)"
