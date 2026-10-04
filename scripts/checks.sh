#!/usr/bin/env bash
# Deploy gate - runs inside every Vercel build. A deployment cannot go live
# unless every serverless function parses and the site test suite passes.
set -e
# Syntax only - never resolves imports, so this works with nothing installed.
for f in api/*.mjs; do node --check "$f"; done
# Pure unit test: imports api/_phone.mjs, which has no dependencies on purpose,
# so a fresh clone can run the gate before npm install.
node site/tests/phonetest.mjs
# Muhurat and rashi: _panchang, _places and _horoscope import nothing either,
# so the day's arithmetic is checked against a published almanac here too.
node site/tests/daytest.mjs
# Indian PIN codes: _pin.mjs imports nothing either, so its parser and every
# way the source can fail are checked here without a database or a network.
node site/tests/pintest.mjs
# What an Indian ID looks like - the same rules the field applies as you type.
node site/tests/docidtest.mjs
# The games list: several games at once, including two of the same kind.
# _gamelist.mjs imports nothing either, so this runs before npm install.
node site/tests/gametest.mjs
# Ekta with no credit: she retrieves from the family's own records rather
# than dying. _ektalocal.mjs imports nothing, so this runs before npm install.
node site/tests/ektatest.mjs
# Escaping, image URIs and private-entry names: the rules that keep one
# family's data out of another's screen. _sec.mjs imports nothing either.
node site/tests/sectest.mjs
# Sign-in: a PIN, a session token, and a lockout. _auth.mjs imports only
# node:crypto, which is builtin, so this runs before npm install too.
node site/tests/authtest.mjs
# The launch list: consent, one-person-one-row, and the interest field that
# says which half to build next. _waitlist.mjs imports only _phone.mjs, which
# imports nothing, so this runs before npm install too.
node site/tests/waitlisttest.mjs
# The deploy's own verification, against a server that answers red. A check
# that cannot report a failure is not a check, and this one could not: the
# poll used `curl -f`, which throws away the HTTP 500 body a red self-test
# replies with, so the failing step never reached anybody's log.
node site/tests/verifytest.mjs
# Repeating family tasks: when the next one is due, on the family's own
# clock. _recur.mjs imports nothing, so this runs before npm install too.
node site/tests/recurtest.mjs
# Ludo, Bhabhi and Vyapar: every rule with the dice fixed, and whole games
# between opponents that must finish. _boardgames.mjs imports nothing.
node site/tests/boardgametest.mjs
# Location sharing: validation, the area-only rounding, distances and ages.
# _geo.mjs imports nothing.
node site/tests/geotest.mjs
# The family tree: who is whose son, daughter-in-law, Chacha or Bua, across
# four generations. _kin.mjs imports nothing.
node site/tests/kintest.mjs
test -f site/tests/test_site.py || { echo "site test suite missing from build input"; exit 1; }
if command -v python3 >/dev/null 2>&1; then
  python3 site/tests/test_site.py
else
  echo "python3 unavailable on this builder - site suite skipped (functions still checked)"
fi
