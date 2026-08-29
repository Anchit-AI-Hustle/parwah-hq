# CLAUDE.md — parwah-hq monorepo

## What this repo is
Single PRIVATE repo for **Parwah** (परवाह) — a **family-care platform for India**:
*"Apni family ki parwah karein."* Parents are the primary care-receivers; the family
is the unit. The full product vision and feature map (care circle, presence & safety,
messaging, wallet & transfers, bookings, shopping & gifting, Parwah AI concierge)
lives in `hq/Parwah_05_Family_App_Vision.md` — Anchit's directive, 2026-08-29.
The senior daily-living D2C catalog is the platform's Shopping & Gifting module and
the current revenue wedge. Two halves with different exposure:
- `hq/` — internal console with the full financial model and operating playbook.
  NEVER deployed publicly. If deployed at all, only behind Vercel Authentication.
- `site/` — public pre-launch site. Its only job: convert an adult child's worry into a
  launch-list join (WhatsApp primary, email secondary). Deploys on Vercel — ONE project
  (team "Anchit's AI Hustle"), git-linked to this repo, live ONLY at
  parwah-hq.anchit-tandon.com. Every push to main auto-deploys: the root
  package.json build copies site/public into the output, API functions live in
  root api/, and .vercelignore keeps hq/, .claude/ and supabase/ out of every
  upload — never remove those ignore rules. No other Vercel projects or
  GitHub repos for Parwah; this monorepo is the single source.

Commerce is NOT built here. Per the locked PRD, Shopify is the commerce layer at launch.
`site/` stays brand home + advertorial + demand capture: no cart, no checkout, no product DB.

## Hard rules (non-negotiable)
1. **Privacy split.** Nothing from `hq/` — financials, master prompt, supplier terms —
   ever moves into `site/` or any public surface.
2. **Zero therapeutic claims** anywhere in `site/` copy. Banned: cure, treat, treatment,
   heal, prevent, prevention, reverse, remedy, medicine, therapeutic, clinically proven,
   doctor recommended, pain relief, arthritis relief, guaranteed results.
   We sell safety, comfort, ease, independence, dignity.
3. **Dignity-first.** No pity imagery, no frailty stock photos, no hospital aesthetics.
4. **WhatsApp-first capture.** No fake forms — a form ships only when a real backend
   receives it (backlog #5).
5. **Grade-6 reading level** for consumer copy; Devanagari accents are brand voice.
6. **Test before commit.** Run `python site/tests/test_site.py` after ANY site change;
   all checks green before commit. Verify every Vercel deployment is green after push.

## Design system (site/ — do not drift)
- Palette: neem-dusk #182622 · pine #24463C · day #FAF7EF · bone #EFE8D8 ·
  marigold #E8A23D · sindoor #A64B2A · ink #241F17
- Type: Fraunces (display) · Albert Sans (body/UI) · Tiro Devanagari Hindi (परवाह)
- Signature: the garland thread (marigold dashed line + petal dots) on day sections.
- Motion: reveal-on-scroll only; prefers-reduced-motion respected.

## Current state
- hq/index.html — 9-tab console incl. live finance engine (do not edit casually; it has
  its own test suite in the source workspace).
- site/index.html, site/story/index.html, site/styles.css — pre-launch site.
- site/tests/test_site.py — the site test suite.

## Backlog (strict order — do not reorder without Anchit)
1. ~~Replace `91XXXXXXXXXX` in all wa.me links (3×) with the real WhatsApp Business number.~~ DONE — real number live in all 3 links; test suite guards it.
2. Domain: buy + connect (parwah.in first choice); update care@parwah.in if it differs.
3. Analytics: GA4 + Meta Pixel base events (page_view; WA CTA click as join_waitlist).
4. OG/social cards per page (1200×630, brand system).
5. Waitlist backend: when Supabase project `parwah` is live — apply the ready
   migration at `supabase/migrations/0001_waitlist.sql` (waitlist table + insert-only
   RLS, ported from the retired parwah-site repo); only then ship an email form.
6. Photography: real dignity-first shots per the master prompt; no stock placeholders.
7. LP variants: come from Parwah LP Factory when its trigger fires (>10 variants);
   hand-build max 3 here.
