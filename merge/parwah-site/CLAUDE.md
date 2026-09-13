# parwah-site

Public pre-launch site for **Parwah** - an Indian D2C brand of senior
daily-living products. Dignity-first. Tagline: *"They took care of you.
Take care back."*

This repo is the brand home + advertorial + launch list **only**, until the
Shopify store is live. It deploys as a static site on Vercel (project
`parwah-site`, team "Anchit's AI Hustle").

## Repo law (non-negotiable)

- **Public-facing repo.** Never commit HQ financials, the master prompt,
  supplier terms, margins, or internal roadmaps here. Those live in the
  private `parwah-hq` repo only.
- **Commerce never lives here.** No cart, no checkout, no prices - Shopify
  only. This site collects launch-list signups and tells the brand story.
- **Zero medical/therapeutic claims.** Banned in any copy: cure, treat,
  heal, therapy, arthritis relief, diabetes control, clinically proven,
  doctor recommended. Allowed: comfort, support, stability, ease,
  confidence, independence. The test suite enforces this.
- **Respect the senior.** No infantilising imagery, no pity framing, no
  "burden" language. Seniors are shown with agency - doing, not receiving.
- **Privacy.** Launch-list signup requires an explicit consent checkbox
  (DPDP). The browser only ever holds the Supabase *publishable* key, and
  RLS permits inserts only - never commit a secret/service-role key.
- **Minimal, clean implementation.** Plain static HTML, one `<style>`
  block per page, no build step, no framework. Dual currency
  (INR + USD @ ₹85/USD) anywhere money ever appears.

## Testing

Run the test suite after **every** change; all green before commit:

```
python tests/test_site.py
```

It checks structure, internal links, the claims-checklist banned words,
single-style-block rule, form + consent presence, and that no secrets or
private-repo content leaked in.

## Structure

| Path | What it is |
|---|---|
| `index.html` | Brand home + launch-list form (Supabase-ready; config at `PARWAH_WAITLIST` in its inline script) |
| `story/index.html` | Parwah Story Page 01 - the advertorial, live at `/story/` |
| `supabase/migrations/0001_waitlist.sql` | Waitlist table + RLS, ready to apply to Supabase project `parwah` |
| `vercel.json` | Clean URLs + security headers |
| `tests/test_site.py` | Test suite (Python stdlib only) |

## Backlog (ordered - work top to bottom, one item closed before the next)

1. **Wire the launch list to Supabase.** Blocked: the Supabase org
   "Anchit's AI Hustle" has overdue invoices, so project `parwah` cannot be
   created yet. Once settled: create project `parwah` (region `ap-south-1`),
   apply `supabase/migrations/0001_waitlist.sql`, paste the project URL +
   publishable key into `PARWAH_WAITLIST` in `index.html`, submit a test
   signup, verify the row, delete it.
2. **Connect Vercel.** Link this repo to Vercel project `parwah-site`,
   verify the production deploy and custom domain resolve, check `/` and
   `/story/` live.
3. **Analytics + consent.** Add GA4 base tag and Meta Pixel with a
   DPDP-compliant consent banner once the property/pixel IDs exist; verify
   events in GA4 DebugView and Meta test events.
4. **Advertorial variants.** Clone `/story/` into 3 territory variants for
   paid-traffic testing (one per creative territory), tagged for tracking.
5. **WhatsApp entry point.** Add click-to-chat once the BSP number is live;
   link the concierge SOP.
6. **Brand kit swap.** After P1 brand-kit approval, swap in the final logo
   suite, palette and type across both pages.
7. **Store handover.** At Shopify go-live, point all CTAs at the store,
   keep `/` and `/story/` as brand home + advertorial, and stop pointing
   paid traffic at the launch list.
