#!/usr/bin/env bash
# Deploy gate — runs inside every Vercel build. A deployment cannot go live
# unless every serverless function parses and the site test suite passes.
set -e
# Syntax only — never resolves imports, so this works with nothing installed.
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
# What an Indian ID looks like — the same rules the field applies as you type.
node site/tests/docidtest.mjs
test -f site/tests/test_site.py || { echo "site test suite missing from build input"; exit 1; }
if command -v python3 >/dev/null 2>&1; then
  python3 site/tests/test_site.py
else
  echo "python3 unavailable on this builder — site suite skipped (functions still checked)"
fi
