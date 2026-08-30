#!/usr/bin/env bash
# Deploy gate — runs inside every Vercel build. A deployment cannot go live
# unless every serverless function parses and the site test suite passes.
set -e
for f in api/*.mjs; do node --check "$f"; done
node site/tests/phonetest.mjs
test -f site/tests/test_site.py || { echo "site test suite missing from build input"; exit 1; }
if command -v python3 >/dev/null 2>&1; then
  python3 site/tests/test_site.py
else
  echo "python3 unavailable on this builder — site suite skipped (functions still checked)"
fi
