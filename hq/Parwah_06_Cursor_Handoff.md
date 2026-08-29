# Parwah — Cursor Handoff (context + master prompt)

Paste the **PROMPT FOR CURSOR** section below into Cursor as the project rules /
first message. Everything above it is reference you can also paste when asked.
Goal: continue development of (a) the mobile-first website, (b) the Android app,
(c) the iOS app — all from this one repo.

---

## PROMPT FOR CURSOR (copy from here)

You are the lead engineer for **Parwah (परवाह)** — a consent-first family-care
platform for India. Tagline: *"Apni family ki parwah karein."* One private
"circle" per family: daily "All is well ✅" check-ins, SOS, reminders and help
requests that always flow as consent (offered → accepted, never imposed),
circle chat, and Ekta — the in-app AI assistant. Buyer/driver: the 35–50 adult
child living away; the 60+ parent is a centred user with agency ("senior mode":
big type, ≤3 actions per screen, Hindi-first), never a tracked subject.

### Repo (github.com/Anchit-AI-Hustle/parwah-hq — private monorepo)
- `site/public/` — the deployed web app (static, no framework, no build step):
  `index.html` (marketing home + embedded demo), `launch/`, `story/`, `demo/`,
  and **`app/index.html` — the actual product app (single file, vanilla JS)**.
- `api/*.mjs` — Vercel Node serverless functions (ESM, `@neondatabase/serverless`):
  `circle.mjs` (create/join), `events.mjs` (feed + check-in/sos/pill/message),
  `care.mjs` (reminders + requests, the consent protocol), `ekta.mjs`
  (assistant, Claude API, tool use), `health.mjs`, `waitlist.mjs`,
  `selftest.mjs` (full backend round-trip test), `_db.mjs` (schema + helpers).
- Root `package.json` build (`cp -r site/public public`) + `vercel.json` +
  `.vercelignore` (NEVER remove its rules — `hq/` is confidential and once
  leaked publicly through a misconfigured deploy).
- `hq/` — PRIVATE strategy docs. Never import from or expose anything in `hq/`.
- Tests: `python site/tests/test_site.py` must pass before EVERY commit.

### Live infra
- Production: https://parwah-hq.anchit-tandon.com (Vercel project `parwah`,
  team "Anchit's AI Hustle", git-linked: every push to `main` auto-deploys).
- DB: Neon Postgres (free), injected as `DATABASE_URL` by the Vercel–Neon
  integration. Schema is created idempotently by `_db.mjs ensureSchema()`.
- Verify any backend change against `GET /api/selftest` (must return ok:true)
  and the app flow at `/app/`.
- Ekta needs `ANTHROPIC_API_KEY` in Vercel project env vars (already set).
- **Model policy (keep it):** pick the model per task, cascade for resilience.
  Ekta chat runs `claude-sonnet-5` first (fast, warm, reliable tool use),
  escalates to `claude-opus-5` only when Sonnet runs out of depth and no
  side-effecting tool has run, and falls back to `claude-haiku-4-5-20251001`
  on overload so she never goes silent. Cheap mechanical jobs you add later
  (summaries, classification, cron digests) go straight to Haiku; deep
  one-off reasoning goes to Opus. Verify with GET /api/ekta-selftest?run=ekta
  (live round-trip incl. which model answered; self-cleaning).

### Database schema (Neon Postgres)
circles(id uuid pk, code text unique 6-char, name, created_at)
chats(id, circle_id fk cascade, kind 'circle'|'group'|'dm', name, created_at)
chat_members(chat_id fk, member_id fk, pk both)
messages(id, chat_id fk, member_id fk nullable — null = Ekta, text, created_at)
members(id uuid pk, circle_id fk cascade, name, role 'parent'|'family', created_at)
events(id uuid pk, circle_id fk, member_id fk, type 'checkin'|'sos'|'pill'|'message'|'join'|'care', text, created_at)
reminders(id, circle_id, for_member fk, by_member fk, title, time_of_day text,
  recurrence 'once'|'daily', status 'pending'|'accepted'|'declined'|'done', created_at)
requests(id, circle_id, by_member, title, status 'open'|'claimed'|'done', claimed_by, created_at)

### API contract (all JSON; membership = circle code + memberId uuid, verified server-side)
- POST /api/circle {action:'create'|'join', memberName, circleName?, code?, role}
  → {ok, code, circleName, memberId, role}
- GET  /api/events?circle=CODE → {ok, circleName, code, members[], events[≤50]}
- POST /api/events {code, memberId, type, text?} (types: checkin|sos|pill|message)
- GET  /api/care?circle=CODE → {ok, reminders[], requests[]}
- POST /api/care {code, memberId, action:'reminder_create'|'reminder_respond'|
  'reminder_done'|'request_create'|'request_claim'|'request_done', ...}
- POST /api/ekta {code, memberId, messages:[{role,content}]} → {ok, reply, actions[], model}
- GET  /api/chats?circle=CODE&member=UUID → {ok, chats[]} (default 'Everyone'
  circle chat + groups + personal 1:1s, each with last-message preview)
- GET  /api/chats?circle=CODE&member=UUID&chat=UUID → {ok, chat, messages[≤50]}
  (messages with member_id null are Ekta's)
- POST /api/chats {code, memberId, action:'send'|'create_group'|'open_dm', ...}
  — mentioning "Ekta" in a sent message makes her reply into the chat itself

### Design system (do not drift)
Palette: neem-dusk #182622 · pine #24463C · day #FAF7EF · bone #EFE8D8 ·
marigold #E8A23D · sindoor #A64B2A · ink #241F17. Type: Fraunces (display),
Albert Sans (body), Tiro Devanagari Hindi (the परवाह brandmark only — all copy
is English/Hinglish in Latin script). Signature: the marigold garland motif.
Mobile-first always; safe-area insets; `prefers-reduced-motion` respected.

### Non-negotiable product laws
1. Consent-first & symmetric: anything set FOR a person arrives as a request
   they accept; every shared signal is visible and revocable by them.
2. Zero medical/therapeutic claims or advice anywhere (Ekta included — she
   deflects to doctors). Banned words incl.: cure, treat, heal, prevent,
   remedy, medicine, therapeutic, clinically proven, doctor recommended.
3. No surveillance, no ads, no data selling, no public social feed.
4. Senior mode: big type, ≤3 actions/screen, voice-first bias, warm copy.
5. Nothing from `hq/` ever reaches any public surface or client bundle.
6. Test before commit; every deploy verified green before "done".

### YOUR TASKS (in order)
1. **Mobile apps (iOS + Android) via Capacitor** — wrap the existing web app:
   `npm i @capacitor/core @capacitor/cli && npx cap init Parwah com.parwah.app`,
   webDir pointing at a copy of `site/public`, server.url set to the production
   origin for live content (or bundle + API base override). Add `@capacitor/push-notifications`
   (FCM for Android, APNs for iOS), splash + icons from `site/public/app/icon-512.png`.
   Deliverables: Android AAB/APK (signed, Play-ready) and iOS Xcode project
   (needs the founder's Apple Developer account to sign/TestFlight).
2. **Push notifications end-to-end** — device token table in Neon
   (tokens(member_id, platform, token)), register on app start, server sends via
   FCM/APNs on: SOS (highest priority), reminder due (cron: Vercel cron job
   hitting a new /api/cron-reminders which finds due accepted reminders),
   missed check-in (no checkin event by circle-set time), new request, and
   reminder-request awaiting acceptance. Web Push for the PWA too.
3. **Mobile-first website polish** — `/app/` is mobile-first already; add a
   desktop enhancement (≥900px): two-column layout (actions left, feed right).
   Marketing pages already responsive; keep them.
4. **OTP phone login** — replace localStorage-only identity: phone + OTP (MSG91
   or similar), members linked to verified phone; circle code becomes invite-only.
5. **Emergency card** — per-parent: blood group, conditions, medicines list
   (names only, no advice), doctor contact, address; consent-gated; auto-shown
   on SOS to all members.
6. **Hindi UI toggle** for the whole app (senior mode defaults to Hindi).
6b. **Ekta full voice (JARVIS) on native** — web already has tap-to-talk
   (Web Speech API) + spoken replies (speechSynthesis, en-IN). On Capacitor
   use native STT/TTS plugins for reliability, add wake-word/continuous
   conversation mode there. Keep structured inputs everywhere: times as
   HH:MM time pickers, dates as calendar date pickers (reminders already
   send time_of_day 'HH:MM' + due_date 'YYYY-MM-DD').
7. Keep `api/selftest.mjs` extended to cover every new backend feature.

Work incrementally: one feature per PR/commit, tests green, deployed, verified
on production before the next. Ask the founder (Anchit) only for: Apple
Developer account, FCM/APNs credentials, MSG91 (or SMS provider) keys, and
ANTHROPIC_API_KEY — everything else, decide and build.

(end of Cursor prompt)

---

## Notes for Anchit (not part of the Cursor prompt)
- The web app is PWA-installable today (Android: Chrome → Install app;
  iOS: Share → Add to Home Screen). Capacitor (task 1) is what produces the
  store-ready binaries; iOS distribution requires your Apple Developer account
  (₹8k/yr) — no way around Apple signing.
- Fast APK without Cursor: pwabuilder.com → paste https://parwah-hq.anchit-tandon.com/app/.
- Ekta goes live the moment ANTHROPIC_API_KEY is added in Vercel → project
  `parwah` → Settings → Environment Variables (get a key at console.anthropic.com).
