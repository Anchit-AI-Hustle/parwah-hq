# CLAUDE.md — parwah-hq monorepo

## What this repo is
Single PRIVATE repo for **Parwah** (परवाह), a senior daily-living D2C brand for India.
Two halves with different exposure:
- `hq/` — internal console with the full financial model and operating playbook.
  NEVER deployed publicly. If deployed at all, only behind Vercel Authentication.
- `site/` — public pre-launch site. Its only job: convert an adult child's worry into a
  launch-list join (WhatsApp primary, email secondary). Deploys on Vercel — ONE project
  only, named `parwah-hq` (team "Anchit's AI Hustle"), live ONLY at
  parwah-hq.anchit-tandon.com, Root Directory = `site`. No other Vercel projects or
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
5. Waitlist backend: when Supabase project `parwah` is live — waitlist table
   (email, city, source, created_at) + minimal endpoint; only then ship an email form.
6. Photography: real dignity-first shots per the master prompt; no stock placeholders.
7. LP variants: come from Parwah LP Factory when its trigger fires (>10 variants);
   hand-build max 3 here.
