# Parwah Family Care Platform — Vision & Feature Map v1 (2026-08-29)

**Anchit's directive (supersedes narrower framings):** Parwah is about family care.
Parents are the primary care-receivers; the family is the unit.
**Tagline: "Apni family ki parwah karein."**
One app where a family can see, reach, help, pay for, book for, and gift to the
people they care about — with the parent holding full agency, never being a
tracked object.

The existing senior daily-living D2C catalog does not go away: it becomes the
**Shopping & Gifting module** of this platform (and stays the revenue wedge
while the app is built).

---

## 1. The unit: Care Circle

- A family creates a **circle**: parents, children, siblings, a trusted helper.
- Invite via phone number / WhatsApp; roles decide defaults (what a child sees
  vs. what a helper sees).
- **Consent-first, always symmetric:** every shared signal (location, spends,
  health) is opt-in by the person being seen, visible to them ("who can see
  me"), and revocable in one tap. This is the product's spine, not a setting.
- **Senior mode:** large type, high contrast, Hindi-first, voice-first, max 3
  actions per screen. The parent's app must feel simpler than a feature phone.

## 2. Presence & Safety — "where are they, are they okay"

- Consented **live location sharing** within the circle; per-person on/off.
- **Geofence moments**, not surveillance: "Mummy reached the mandir",
  "Papa is home". Framed as reassurance, never monitoring.
- **SOS button** on the parent's screen → calls + alerts the whole circle with
  location; escalation chain (child 1 → child 2 → neighbour/helper).
- **Daily check-in:** one tap "sab theek hai ✅" — the 11pm phone call, solved
  by 9am. Missed check-in → gentle nudge → circle alert.
- Reachability signals: phone battery low, phone unreachable, long inactivity
  (phone sensors; wearables/fall-alert hardware later — ties to the existing
  T3 fall-alert roadmap).

## 3. Wellbeing rails (strictly non-medical)

- **Medicine reminders** the parent confirms with one tap; the circle sees
  "taken ✅" — no nagging calls needed.
- Appointment calendar shared with the circle; booking handled by module 6.
- **Document vault:** prescriptions, reports, insurance, Aadhaar copies —
  encrypted, shared selectively ("only Rohan sees medical files").
- Vitals log if they own devices (BP machine, glucometer) — record + share,
  never interpret. Zero medical advice anywhere; brand law applies verbatim.

## 4. Connection — messaging & moments

- Circle chat with **voice-message-first** UX (seniors speak, don't type);
  optional disappearing messages; share to all or selected members only.
- One-tap video call shortcuts ("Beta se baat karein").
- **Family album / moments feed** visible to chosen members; festival,
  birthday and anniversary reminders with one-tap "send love" (links to
  module 7 gifting).
- v1 pragmatism: ride WhatsApp (deep links, click-to-chat, later WhatsApp
  Business API) rather than fighting it; native chat only when the circle
  features demand it.

## 5. Money — wallet, transfers, protection

- **Send money to the parent** instantly: wallet top-up / UPI transfer
  (via licensed partner — PPI license or UPI TPAP through a bank/PSP; we do
  NOT build our own rails in v1).
- Auto-allowance ("₹10,000 on the 1st"), bill payments from anywhere
  (electricity, mobile recharge, DTH, society dues), and pay-for-their-order
  in modules 6–7.
- **Scam shield** (the feature Indian families actually need): unknown-payee
  warnings, "is this SMS/call fake?" check via Parwah AI, and an optional
  parent-controlled second-approval for large transfers. The parent opts in;
  it is armour they choose, never a cage.
- Spend visibility only if the parent shares it. Dual currency (INR + USD @
  ₹85/USD) wherever money shows, per house rules.

## 6. Do-it-for-them — bookings & tasks

- **Cab to their door** (Uber/Ola/Rapido APIs) booked by the child from
  another city; parent sees driver name + car in senior mode.
- Groceries & medicine delivery, doctor appointments, home services
  (electrician, AC repair), tickets (train/flight/darshan), verified local
  help. Child (or Parwah AI) books; parent gets one simple confirmation card.
- Every task can also be requested BY the parent ("beti, gas booking karwa
  do") — request lands in the circle, anyone picks it up.

## 7. Shopping & Gifting — the existing wedge, re-homed

- The senior daily-living catalog (ortho comfort, bathroom safety, daily
  aids; T2 nutrition; T3 adaptive wear) lives here as the commerce module —
  Shopify remains the commerce layer per the locked stack.
- Gifting flow as designed: card in your words, COD if they prefer, QR
  how-to videos in Hindi, human on WhatsApp.
- Festival gifting calendar (Diwali, Raksha Bandhan, Parents' Day) wired to
  module 4 reminders. All zero-claims copy rules stay binding.

## 8. Parwah AI — the concierge (Yaara lineage)

- Voice-first, Hindi/English agent for the parent: **does the task when it
  can** (book, order, call, pay within caps), **step-by-step guidance when it
  can't** control the device, human concierge escalation always available.
- For the child: "Papa ke liye Thursday 10am Dr. Sharma book karo" — done.
- Guardrails (binding, from the master prompt): medical-question deflection,
  emergency escalation script, consent via family, zero health advice,
  financial actions capped + approval flows, full action log the family can
  read.

## 9. Trust & privacy backbone (non-negotiable)

- DPDP-compliant consent ledger for every signal; parents are users with
  agency, never subjects. No ads, no data resale, ever.
- Granular sharing per person per signal; "pause everything" one-tap for any
  member; everything explainable in one Hindi sentence.
- App-store reality: covert tracking is both against our brand and against
  Play/App Store policy — symmetric consent is also the only shippable design.

---

## Build order (each phase gated before the next)

| Phase | Ships | Why first |
|---|---|---|
| P0 (now) | Reposition pre-launch site to "Apni family ki parwah karein" + launch list | Capture demand for the platform, not just products |
| P1 | Care Circle + daily check-in + SOS + WhatsApp-linked messaging | The emotional core; buildable without licenses |
| P2 | Location/geofences + medicine reminders + human concierge (WhatsApp) | Reassurance loop; concierge logs teach the AI |
| P3 | Money via licensed partner + bookings via partner APIs | Highest value, heaviest compliance — needs P1 trust |
| P4 | Shopping/gifting integration (Shopify) + Parwah AI voice agent | Commerce meets the agent; Yaara tech lands here |

**Build vs partner:** payments → partner (PSP/TPAP); cabs/commerce/delivery →
partner APIs; circle/consent/senior-mode UX/AI orchestration → build (this is
the moat). Tech: mobile app (React Native or Flutter), Supabase backend to
start, WhatsApp Business API for reach.

**What this platform is NOT:** a general social network, a public feed, a
surveillance tool, or a medical device. Family only, consent only, dignity
always.

*Companion docs: 03 Master Prompt (operating rules still bind), 04 Financial
Model (D2C wedge economics), CLAUDE.md (repo law).*
