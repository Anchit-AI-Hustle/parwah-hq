#!/usr/bin/env bash
# Parwah - prove a live deployment against the real database, and say WHY
# when it is not green.
#
#   ops/verify-live.sh https://parwah-hq.anchit-tandon.com
#
# This exists as its own script because the check that tells you nothing is
# worse than no check at all. The previous version polled with `curl -f`, and
# a red self-test answers with HTTP 500 - `-f` throws that body away, so the
# one thing a person needs, the name of the failing step, never reached the
# log. Here every answer is read, classified, and printed.
#
# Three answers, three different meanings, never conflated:
#   no answer          the build is not serving yet - keep waiting
#   ok:false           the self-test ran and something FAILED - name it, now
#   anything else      something other than the self-test answered (an alias
#                      still flipping, a redirect, an error page) - print it
#
# Env: PARWAH_POLL_SECONDS (default 10), PARWAH_POLL_TRIES (default 40),
#      PARWAH_MAX_RED (default 12), DIAG_TOKEN (if the deployment sets one).
#
# The probes write to the production database and report the real error text.
# When DIAG_TOKEN is set on the Vercel project, set it here too, or every
# probe answers 404 and this script reports the deployment as unreachable.
set -uo pipefail

BASE="${1:-}"
[ -n "$BASE" ] || { echo "usage: ops/verify-live.sh <base-url>" >&2; exit 2; }
BASE="${BASE%/}"

POLL="${PARWAH_POLL_SECONDS:-10}"
TRIES="${PARWAH_POLL_TRIES:-40}"
MAX_RED="${PARWAH_MAX_RED:-12}"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "FAILED: $*"; exit 1; }

# One request, both halves. No -f: an HTTP 500 IS the verdict here and its
# body is the diagnosis. -L so a trailing-slash redirect cannot pass itself
# off as a broken self-test.
fetch() {                                  # fetch URL timeout -> sets CODE, BODY
  local out
  local -a hdr=()
  [ -n "${DIAG_TOKEN:-}" ] && hdr=(-H "X-Diag-Token: ${DIAG_TOKEN}")
  out="$(curl -sS -L --max-time "$2" "${hdr[@]}" -w '\n%{http_code}' "$1" 2>/dev/null)"
  CODE="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
  case "$CODE" in ''|*[!0-9]*) CODE=000; BODY='' ;; esac
  [ "$CODE" = 000 ] && BODY=''
}

# The failing steps, by name, out of {"ok":false,"steps":{...}}. The top-level
# "ok" is the verdict, not a step, so it never appears in the list.
failing_steps() {
  printf '%s' "$1" | grep -o '"[a-z_0-9]*":false' | cut -d'"' -f2 | grep -vx ok | tr '\n' ' '
}

# An unexpected answer is usually HTML and usually long. One line is enough
# to tell a redirect from an error page from the wrong build.
snippet() {
  printf '%s' "$1" | tr -d '\r' | tr '\n' ' ' | cut -c1-200
}

log "verifying $BASE"
BODY=''; CODE=000; RED=0; VERDICT=none
for i in $(seq 1 "$TRIES"); do
  fetch "$BASE/api/diag?probe=db" 60
  case "$BODY" in
    *'"ok":true'*)
      VERDICT=green; break ;;
    *'"ok":false'*)
      RED=$((RED + 1)); VERDICT=red
      STEPS="$(failing_steps "$BODY")"
      # The message can itself contain quotes (relation "pulse" does not
      # exist), so stop at the quote that CLOSES the value, not the first one.
      ERR="$(printf '%s' "$BODY" | sed -n 's/.*"error":"//; s/"[,}].*$//; s/\\"/"/g; p')"
      log "  self-test RED (attempt $i, $RED/$MAX_RED) - failing: ${STEPS:-none named}"
      [ -n "$ERR" ] && log "  error: $ERR"
      [ "$RED" -ge "$MAX_RED" ] && break ;;
    '')
      # Nothing usable came back. Once the self-test has actually gone red,
      # a later silence does not undo that: a build that failed and then
      # stopped answering is a failed build, not an unreachable one.
      [ "$VERDICT" = red ] || VERDICT=silent
      if [ "$CODE" = 000 ]; then
        log "  no answer yet (attempt $i/$TRIES, ~$((i * POLL))s)"
      else
        log "  HTTP $CODE with an empty body, still coming up (attempt $i/$TRIES)"
      fi ;;
    *)
      # Not the self-test at all. Naming this separately matters: it used to
      # be reported as "answering but not green", which sent everyone looking
      # for a database failure that was never there.
      RED=$((RED + 1)); VERDICT=other
      log "  HTTP $CODE, and not the self-test (attempt $i, $RED/$MAX_RED): $(snippet "$BODY")"
      [ "$RED" -ge "$MAX_RED" ] && break ;;
  esac
  sleep "$POLL"
done

case "$VERDICT" in
  green) log "live self-test green on $BASE" ;;
  red)   log "$BODY"; die "live self-test NOT green - production is serving a broken build" ;;
  other) log "$BODY"; die "$BASE/api/diag?probe=db answered HTTP $CODE but not with the self-test" ;;
  *)     die "live self-test unreachable at $BASE" ;;
esac

# The day's arithmetic, on the build that is now live. Only an explicit
# failure is fatal: this probe also reports whether the horoscope source
# answered, and someone else's uptime is not our deploy's problem.
fetch "$BASE/api/diag?probe=day" 60
case "$BODY" in
  *'"ok":true'*)  log "muhurat check: $(printf '%s' "$BODY" | sed -n 's/.*"summary":"\([^"]*\)".*/\1/p')" ;;
  *'"ok":false'*) log "$BODY"; die "the muhurat self-test is RED on production" ;;
  *)              log "muhurat check: no usable answer (HTTP $CODE) - not fatal" ;;
esac
