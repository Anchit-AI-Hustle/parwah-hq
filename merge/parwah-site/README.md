# Parwah - pre-launch site

**Parwah** (परवाह, Hindi: *care*) is a new Indian brand of daily-living
essentials for parents - ortho comfort, bathroom safety and daily aids,
chosen with dignity.

> They took care of you. Take care back.

This repository is the public pre-launch site: brand home, story page
(`/story/`) and launch list. Static HTML, no build step, deployed on Vercel.

## Run locally

```
python -m http.server 8000
# open http://localhost:8000
```

## Test

```
python tests/test_site.py     # the commit gate: structure, claims, links, capture
node tests/browser.mjs        # drives the real page in Chromium (needs playwright-core)
```

## Before pointing paid traffic at this

The site captures signups today by handing them to the mail client at the
address in `PARWAH_CONTACT` (`index.html`). That works with no backend, but
it converts worse than a form and gives you no data. Close these three, in
order, before spending anything on traffic:

1. **Wire Supabase.** Paste the project URL and publishable key into
   `PARWAH_WAITLIST`. Then actually submit a signup, see the row, delete it.
   The mail fallback stays as the path when the database is unreachable.
2. **Turn on analytics.** Paste the GA4 measurement ID into
   `PARWAH_ANALYTICS.ga4`. Nothing is fetched from Google until a visitor
   answers the consent bar, and with no ID there is no bar and no request.
   The conversion event is `join_waitlist`.
3. **Write the guide.** Both pages promise "our short, practical guide to
   making a parent's home safer this month, before we sell you anything at
   all." Until that exists, the first promise the brand makes is one it
   does not keep.

Contributor rules and the ordered backlog live in [CLAUDE.md](CLAUDE.md).
