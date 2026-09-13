# PARWAH REQUIREMENTS MATRIX
The single living checklist, per the Product Thesis feedback (Aug 2026).
Source of truth order: Thesis → Family App Vision → CLAUDE.md → code.
Statuses are honest: 🟢 working+tested+live · 🟡 partial · 🔴 missing.

| ID | Requirement | Source | Status | Evidence | Test | Priority |
|---|---|---|---|---|---|---|
| PM-001 | Family Memory (structured, per-person) | Thesis | 🟢 | `api/book.mjs` family_book: kinds contact/address/med/fact/insurance, `about_member`, owner/updated_by/timestamps | tabtest memory section; live /api/book | P0 |
| PM-002 | Freshness first-class (`last_verified_at`, stale surfacing, Verify now) | Thesis | 🟢 | 180-day stale rule, 🟡 check tags, "Last checked X ago", ✅ Still current action | tabtest freshness asserts | P0 |
| PM-003 | Preparedness engine (readiness per person, not medical) | Thesis | 🟢 | Server-computed prep[] (doctor/meds/allergies/blood/emergency/insurance) → % + "N need attention" on People | tabtest prep asserts | P0 |
| PM-004 | Ask Parwah answers ONLY from structured memory, with timestamps | Thesis | 🟡 | `get_family_memory` tool + FAMILY FACTS DISCIPLINE in system prompt; live replies blocked on Anthropic credits | ekta-selftest; needs credit to E2E | P0 |
| PM-005 | Permissioned sharing / visibility per entry | Thesis | 🔴 | Circle-level access only today; per-entry visibility + consent ledger not built | - | P0 next |
| PM-006 | Natural memory capture from chat (suggest updates) | Thesis | 🔴 | Requires working AI loop (credits); design: Ekta proposes, human confirms | - | P0 next |
| PM-007 | Audit trail (who/what/when on sensitive objects) | Thesis | 🟡 | by_member/updated_by/verify events in family feed; no dedicated immutable audit table yet | - | P1 |
| PM-008 | Nav organised People/Today/Memory/Care/Ask | Thesis | 🟢 | Mobile bar: Today·People·Memory·Care; Chat/Together demoted to drawer+widgets | tabtest nav asserts | P0 |
| PM-009 | Daily pulse / check-in | Vision | 🟢 | Check-in, pills, SOS live with device push | tabtest + selftest | P1 |
| PM-010 | SOS + escalation | Vision | 🟡 | SOS + circle push live; escalation chain (call order, timers) not built | - | P1 |
| PM-011 | Care requests lifecycle | Vision | 🟡 | open→claimed→done live; assigned/failed/cancelled states + origin=AI/concierge pending | tabtest | P1 |
| PM-012 | Document vault | Thesis | 🔴 | Only "where documents are kept" notes; no encrypted upload/permissioning | - | P1 |
| PM-013 | Senior mode (large, simple, voice) | Thesis | 🟡 | Big-button mode + voice Ekta; Hindi-first UI pending | tabtest senior asserts | P1 |
| PM-014 | Consent-first, no surveillance, no ads | Thesis | 🟢 | Product law; enforced in copy tests | site suite | P0 |
| PM-015 | Cross-family isolation | Thesis | 🟢 | Membership guard on all 9 data endpoints + unique indexes | security suite (30 checks, every deploy) | P0 |
| PM-016 | DB integrity (unique phone, one seat/name per circle) | Thesis | 🟢 | users.phone unique; members (circle,user) + (circle,lower(name)) unique | selftest profile_sync/custom_code | P0 |
| PM-017 | CI green on every push | Thesis | 🟡 | Vercel build gate runs checks+security on every deploy (proven blocking); GitHub Actions blocked on org billing | gate log | P0 (user action) |
| PM-018 | Analytics on the business hypothesis | Thesis | 🔴 | No GA4/event pipeline yet (IDs pending) | - | P1 |
| PM-019 | ₹2,499/yr validation mode (15–20 parents, 5+ payments) | Thesis | 🔴 | Not productised; needs pricing page + reservation flow | - | P0 decision |
| PM-020 | Money via licensed partners only | Vision | 🟢 | Law recorded; nothing built (correct for wedge) | - | P2 |
| PM-021 | Shopping/gifting wedge (Shopify, no own backend) | Vision | 🟡 | Regional gift links + sizes/wishlist live; Shopify store pending | tabtest gifting | P2 |
| PM-022 | Games as retention experiment, not core | Thesis | 🟢 | Demoted off primary nav; no further game dev queued | - | P3 |
| PM-023 | Concierge human fallback | Thesis | 🔴 | Care requests exist; concierge routing/SOP pending BSP | - | P1 |
| PM-024 | WhatsApp where superior (invites, deep links) | Thesis | 🟡 | WhatsApp share invites live; click-to-chat concierge pending | - | P1 |
| PM-025 | Refactor-before-expand rule | Feedback | 🟢 | Memory built on existing family_book, not a rewrite | this matrix | law |

## Conflicts resolved per hierarchy
- Thesis "Memory/Preparedness is the wedge" vs repo's broad feature build → nav + roadmap now memory-first; chat/games retained but demoted (thesis §9: don't delete working retention experiments).
- Thesis ₹2,499 paid wedge vs current free app → flagged as founder decision PM-019; nothing built until validation design is chosen.
