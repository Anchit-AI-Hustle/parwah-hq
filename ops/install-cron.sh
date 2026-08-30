#!/usr/bin/env bash
# Install (or remove) the Parwah deploy cron job on this machine.
#
#   ops/install-cron.sh              every 10 minutes (default)
#   ops/install-cron.sh 5            every 5 minutes
#   ops/install-cron.sh --remove     take it out again
#   ops/install-cron.sh --status     show the entry and the last few runs
#
# The job runs ops/deploy.sh, which does nothing at all unless origin/main
# has moved, so a short interval is cheap. Output goes to ops/deploy.log.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGFILE="$REPO/ops/deploy.log"
MARK="# parwah-deploy"                       # how we find our own line
JOB_CMD="cd $REPO && /usr/bin/env bash ops/deploy.sh >> $LOGFILE 2>&1 $MARK"

case "${1:-10}" in
  --remove)
    crontab -l 2>/dev/null | grep -vF "$MARK" | crontab - 2>/dev/null || crontab -r 2>/dev/null
    echo "Parwah deploy cron removed."
    exit 0 ;;
  --status)
    echo "── cron entry ──"
    crontab -l 2>/dev/null | grep -F "$MARK" || echo "(not installed)"
    echo
    echo "── last 20 log lines ──"
    [ -r "$LOGFILE" ] && tail -20 "$LOGFILE" || echo "(no log yet: $LOGFILE)"
    exit 0 ;;
  ''|*[!0-9]*)
    echo "usage: ops/install-cron.sh [minutes|--remove|--status]" >&2; exit 2 ;;
esac

MINS="${1:-10}"
[ "$MINS" -ge 1 ] && [ "$MINS" -le 59 ] || { echo "interval must be 1-59 minutes" >&2; exit 2; }

command -v crontab >/dev/null 2>&1 || { echo "no crontab on this machine" >&2; exit 1; }
command -v vercel  >/dev/null 2>&1 || echo "warning: vercel CLI not found — npm i -g vercel"
[ -r "$HOME/.parwah/vercel-token" ] || [ -n "${VERCEL_TOKEN:-}" ] \
  || echo "warning: no token yet — put one in ~/.parwah/vercel-token (chmod 600)"

# Replace any previous entry of ours, keep everything else untouched.
{ crontab -l 2>/dev/null | grep -vF "$MARK"; echo "*/$MINS * * * * $JOB_CMD"; } | crontab -

echo "Installed: every $MINS minutes, deploying origin/main to production when it moves."
echo "  log:     $LOGFILE"
echo "  status:  ops/install-cron.sh --status"
echo "  remove:  ops/install-cron.sh --remove"
