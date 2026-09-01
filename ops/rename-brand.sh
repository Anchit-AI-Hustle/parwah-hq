#!/usr/bin/env bash
# Rename the brand everywhere it is written down.
#
#   ops/rename-brand.sh "NewName"            # show what would change
#   ops/rename-brand.sh "NewName" --apply    # do it
#   ops/rename-brand.sh "NewName" --apply --devanagari "नयानाम"
#
# The name appears in four forms — Parwah, parwah, PARWAH and परवाह — across
# markup, code, tests, the manifest, the service worker and the SVG marks, plus
# a few filenames. Doing it by hand is how you end up with half a rename.
#
# TWO THINGS THIS DELIBERATELY DOES NOT TOUCH, because a script cannot:
#
#   Browser storage keys ('parwah', 'parwah-user', 'parwah-circles', …).
#     Renaming these signs every existing user out and loses their circle on
#     that device. They are internal and invisible; leave them until there is
#     a migration, or pass --storage-keys to rename them anyway.
#
#   Anything outside this repository: the Vercel project name, the custom
#     domain, the GitHub repository, the Supabase project, app-store listings.
#     Those are renamed where they live. The script lists them at the end.
set -uo pipefail

NEW="${1:-}"
[ -n "$NEW" ] || { echo "usage: ops/rename-brand.sh \"NewName\" [--apply] [--devanagari \"…\"] [--storage-keys]"; exit 2; }
shift
APPLY=0; DEV=""; STORAGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply)        APPLY=1 ;;
    --storage-keys) STORAGE=1 ;;
    --devanagari)   DEV="${2:-}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$NEW" in
  *[!A-Za-z0-9]*) echo "The name must be letters and digits only — no spaces or punctuation." >&2; exit 2 ;;
esac
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

OLD_DEV="परवाह"
LOWER="$(printf '%s' "$NEW" | tr '[:upper:]' '[:lower:]')"
UPPER="$(printf '%s' "$NEW" | tr '[:lower:]' '[:upper:]')"

echo "Parwah → $NEW    parwah → $LOWER    PARWAH → $UPPER${DEV:+    परवाह → $DEV}"
echo

files() {
  git ls-files -z | tr '\0' '\n' | grep -vE '^(node_modules|\.git)/' | grep -vE '\.(png|jpg|jpeg|ico|woff2?|zip|pdf)$'
}

# Storage keys are quoted string literals the browser persists under — so they
# only exist in browser code. A quoted 'parwah-site' in a SQL migration is a
# column default and gets renamed like anything else.
STORAGE_RE="'(parwah(-[a-z]+)*)'"
is_browser() { case "$1" in *.html|*.js|*.mjs) return 0 ;; *) return 1 ;; esac; }

total=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  n=$(grep -oiE "parwah|$OLD_DEV" "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] || continue
  k=0
  if [ "$STORAGE" -eq 0 ] && is_browser "$f"; then
    k=$(grep -oE "$STORAGE_RE" "$f" 2>/dev/null | wc -l | tr -d ' ')
  fi
  total=$((total + n))
  printf '  %-52s %4s%s\n' "$f" "$n" "$( [ "$k" -gt 0 ] && printf '   (%s storage key(s) kept)' "$k" )"
done < <(files)
echo
echo "$total occurrences in tracked files."

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "Nothing changed. Re-run with --apply to do it."
  exit 0
fi

# Protect the storage keys by parking them behind a sentinel, then restoring.
# The sentinel must not itself contain any form of the old name, or the
# replacement below rewrites the marker and the restore never matches.
SENT=$'\x01STORAGEKEY\x01'
while IFS= read -r f; do
  [ -f "$f" ] || continue
  grep -qiE "parwah|$OLD_DEV" "$f" 2>/dev/null || continue
  if [ "$STORAGE" -eq 0 ] && is_browser "$f"; then
    perl -i -pe "s/'parwah((?:-[a-z]+)*)'/'${SENT}\$1'/g" "$f"
  fi
  perl -i -pe "s/Parwah/${NEW}/g; s/parwah/${LOWER}/g; s/PARWAH/${UPPER}/g" "$f"
  # Byte-level, with NO -C layers: the shell hands perl UTF-8 bytes already, and
  # asking perl to decode them as well writes the new name out as mojibake.
  [ -n "$DEV" ] && perl -i -pe "s/\Q${OLD_DEV}\E/${DEV}/g" "$f"
  if [ "$STORAGE" -eq 0 ] && is_browser "$f"; then
    perl -i -pe "s/'${SENT}((?:-[a-z]+)*)'/'parwah\$1'/g" "$f"
  fi
done < <(files)

# Filenames last, so the loop above sees stable paths.
while IFS= read -r f; do
  d="$(dirname "$f")"; b="$(basename "$f")"
  nb="$(printf '%s' "$b" | sed -e "s/Parwah/${NEW}/g" -e "s/parwah/${LOWER}/g" -e "s/PARWAH/${UPPER}/g")"
  [ "$b" = "$nb" ] || { git mv "$f" "$d/$nb" 2>/dev/null || mv "$f" "$d/$nb"; echo "  renamed $f → $d/$nb"; }
done < <(files | grep -iE '/[^/]*parwah[^/]*$' || true)

echo
left=$(files | xargs grep -oiE "parwah|$OLD_DEV" 2>/dev/null | wc -l | tr -d ' ')
kept=$(files | grep -E '\.(html|js|mjs)$' | xargs grep -oE "$STORAGE_RE" 2>/dev/null | wc -l | tr -d ' ')
echo "Done. $left occurrence(s) remain${kept:+, of which $kept are browser storage keys deliberately kept}."
cat <<'NOTE'

Still to do BY HAND, outside this repository:
  · the Vercel project name and its custom domain
  · the GitHub repository name (and this clone's git remote)
  · the Supabase / Neon project, if its name carries the brand
  · anything already published: app-store listings, social handles, the domain itself
  · the logo mark in site/public/app/mark.svg and favicon.svg draw a flower, not
    letters — check they still suit the new name

Then: bash scripts/checks.sh
NOTE
