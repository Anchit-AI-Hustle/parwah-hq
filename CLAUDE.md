# CLAUDE.md - parwah-hq monorepo

## What this repo is
Single PRIVATE repo for **Parwah** (परवाह) - a **family-care platform for India**:
*"Apni family ki parwah karein."* Parents are the primary care-receivers; the family
is the unit. The full product vision and feature map (care circle, presence & safety,
messaging, wallet & transfers, bookings, shopping & gifting, Parwah AI concierge)
lives in `hq/Parwah_05_Family_App_Vision.md` - Anchit's directive, 2026-08-29.
The senior daily-living D2C catalog is the platform's Shopping & Gifting module and
the current revenue wedge. Two halves with different exposure:
- `hq/` - internal console with the full financial model and operating playbook.
  NEVER deployed publicly. If deployed at all, only behind Vercel Authentication.
- `site/` - public pre-launch site. Its only job: convert an adult child's worry into a
  launch-list join (WhatsApp primary, email secondary). Deploys on Vercel - ONE project
  (team "Anchit's AI Hustle"), git-linked to this repo, live ONLY at
  parwah-hq.anchit-tandon.com. Every push to main auto-deploys: the root
  package.json build copies site/public into the output, API functions live in
  root api/, and .vercelignore keeps hq/, .claude/ and supabase/ out of every
  upload - never remove those ignore rules. No other Vercel projects or
  GitHub repos for Parwah; this monorepo is the single source.

Commerce is NOT built here. Per the locked PRD, Shopify is the commerce layer at launch.
`site/` stays brand home + advertorial + demand capture: no cart, no checkout, no product DB.

## Hard rules (non-negotiable)
1. **Privacy split.** Nothing from `hq/` - financials, master prompt, supplier terms -
   ever moves into `site/` or any public surface.
2. **Zero therapeutic claims, and dignity-first voice.** `site/tests/test_site.py`
   is authoritative; this is the summary, and a check fails if the two drift
   apart. Banned as claims: cure, treat, heal, therapy, remedy, medicinal,
   calling it medicine, prevents, reverses, clinically proven,
   doctor recommended, pain relief, guaranteed result.
   Banned as named conditions: arthritis, diabetes. Banned as voice: elderly,
   burden. We sell safety, comfort, ease, independence, dignity.
   Two things the scan deliberately allows, because banning them was wrong:
   the word medicine as a *record* ("keep a medicine list"), and the legal
   disclaimer in `<p class="legal">`, which states what the products are NOT.
   Matching is word-bounded, so "secure" is not "cure".
3. **Dignity-first.** No pity imagery, no frailty stock photos, no hospital aesthetics.
4. **WhatsApp-first capture.** No fake forms - a form ships only when a real backend
   receives it (backlog #5). WhatsApp stays the primary path even after the form
   ships; the form is the secondary capture, not the replacement.
5. **Grade-6 reading level** for consumer copy; Devanagari accents are brand voice.
6. **Test before commit.** Run `python site/tests/test_site.py` after ANY site change;
   all checks green before commit. Verify every Vercel deployment is green after push.
7. **Pull requests merge themselves - only when green.** `.github/workflows/pr.yml`
   runs the gate, `ops/vercel-input.sh` and `npm run test:browser` on every PR into
   `main`, then merges exactly the tested commit and dispatches the deploy. Never
   add a way around the tests; to hold a PR back, mark it as a draft.

## The brand merge (decided 2026-09-13)

The D2C senior-products site and the family-care platform are ONE product, told
as one story: the app keeps you connected to your parents, the aisle is what
India never had. `/story/` already argues this - "Elsewhere, this problem has an
aisle" - so the two halves were never actually separate propositions.

The former public repo `Anchit-AI-Hustle/parwah-site` was deleted from GitHub.
Its source is preserved at `merge/parwah-site/` and is NOT live: outside
`site/public` so the build cannot serve it, and in `.vercelignore` so a deploy
cannot upload it. Checks enforce both. Delete that directory once the copy has
moved.

Three decisions, so they are not re-litigated:

1. **`/story/` keeps "The 11pm phone call."** It sets up the aisle, so it serves
   both halves. The products advertorial, "The day you notice", becomes
   `/story/aisle/` - the first of the territory variants for paid testing.
2. **The aisle is its own page, `/care/`.** Paid traffic needs a landing page
   that is not the app pitch. It is linked prominently from the home page; the
   home page stays the platform pitch.
3. **Supabase is dropped.** See backlog #5.

The words move, the markup does not. That site used one inline `<style>` block
per page; this one uses shared tokens in `site/public/styles.css`. Copy is
re-authored into this design system, never pasted.

## Design system (site/ - do not drift)
- Palette: neem-dusk #182622 · pine #24463C · day #FAF7EF · bone #EFE8D8 ·
  marigold #E8A23D · sindoor #A64B2A · ink #241F17
- Type: Fraunces (display) · Albert Sans (body/UI) · Tiro Devanagari Hindi (परवाह)
- Signature: the garland thread (marigold dashed line + petal dots) on day sections.
- Motion: reveal-on-scroll only; prefers-reduced-motion respected.

## Current state
- hq/index.html - 9-tab console incl. live finance engine (do not edit casually; it has
  its own test suite in the source workspace).
- site/public/ - the live site. Two halves, one story:
  `/` the app itself (the old `/app/` address redirects there) ·
  `/welcome/` platform pitch · `/story/` the 11pm phone call · `/care/` the range ·
  `/story/aisle/` the day you notice · `/launch/` · `/get/` · `/demo/`
  Shared design system in `site/public/styles.css`; pages add only their own
  page-specific classes in a single `<style>` block, as `/get/` does.
- site/tests/test_site.py - the site test suite.

## Backlog (strict order - do not reorder without Anchit)
1. ~~Replace `91XXXXXXXXXX` in all wa.me links (3×) with the real WhatsApp Business number.~~ DONE - real number live in all 3 links; test suite guards it.
2. Domain: buy + connect (parwah.in first choice); update care@parwah.in if it differs.
3. Analytics: GA4 + Meta Pixel base events (page_view; WA CTA click as join_waitlist).
4. OG/social cards per page (1200×630, brand system).
5. Waitlist backend on **Neon, not Supabase**. Supabase is dropped: the project
   `parwah` was never created (the org has overdue invoices), and this repo already
   runs its entire app on Neon, so a second database bought nothing but a second
   thing to keep alive. `supabase/migrations/0001_waitlist.sql` stays only as the
   schema reference. One table, one interest field so an app signup can be told
   from a products signup - that field is what says which half to build next.
   Constraint: the project is at 11 of 12 serverless functions and the gate
   REJECTS deploys above the cap, so the waitlist goes behind an existing route
   rather than spending the last slot.
6. Photography: real dignity-first shots per the master prompt; no stock placeholders.
7. LP variants: come from Parwah LP Factory when its trigger fires (>10 variants);
   hand-build max 3 here.
