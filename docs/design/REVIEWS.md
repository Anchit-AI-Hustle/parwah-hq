# Design leader reviews

Newest first. Each review uses `CHECKLIST.md`; severities are Nielsen's:
0 not a problem, 1 cosmetic, 2 minor, 3 major, 4 blocker.

## Review 4 - 2026-10-03 - navigation by real-life use, and the phone apps

**Reviewer:** Claude, acting as senior product designer.
**Scope:** the order of the phone tab bar, the sidebar and the menu drawer; a
parent's Today on a phone; the first Android and iPhone apps (icons, splash,
offline page, permission wording). Phone light and dark at 320 and 390px,
desktop at 1280px. Today's own cards and shortcuts are ranked separately in
`docs/design/TODAY.md` (Review 3, PR #23).
**Rule from the owner:** everything runs in descending order of real-life use.

| Use | Navigation, in this order |
|---|---|
| Several times a day | Today, Chat |
| Daily | Care |
| Often | People, Notifications |
| Sometimes | Ask Ekta, Family memory |
| Rarely | Vault, Together, The day, Profile |

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 30 | 7 Shortcuts for the frequent | Chat, used several times a day, was not on the phone tab bar; Family memory, used now and then, was | 2 | Fixed: Today, Chat, Care, People |
| 31 | 4 Consistency | Sidebar and drawer ran in build order (The day above Chat, Vault above Care) | 2 | Fixed: one order everywhere, guarded by the gate |
| 32 | 1 Visibility | On a parent's phone the floating chat and Ekta buttons covered the SOS label | 3 | Fixed: no floating buttons on a parent's phone (Chat is a tab, Ekta in the menu and shortcuts); measured at 320 and 390px |
| 33 | 6 Recognition | Care and Notifications both used the bell | 1 | Fixed: Care is ✅, as on its shortcut |
| 34 | 9 Recovery | The phone app with no internet would show a browser error | 3 | Fixed: an offline page in Parwah's look with Try again, tested on the emulator |
| 35 | 2 Real-world match | Permission prompts are the first words a parent reads from the app | 0 | Good: plain words saying what each is for and that it is asked only when used |
| 36 | 8 Minimalist | Inside the phone app, "Get the app" links pointed at itself | 1 | Fixed: hidden when the app's web view says ParwahApp |

**Verdict: Approved with follow-ups.** Nothing above severity 1 is open.
Follow-ups: the iPhone app needs an Apple Developer account to be signed
(owner); the Android release key secrets must be added to GitHub (owner).

## Review 1 - 2026-09-29 - the whole app, and the design system itself

**Reviewer:** Claude, acting as senior product designer (design systems).
**Scope:** every main screen (Today, People, Care, Together, Memory, Vault,
The day, Chat, Ekta, Profile, Notifications, Sign-in) at 320, 390 and 1280px,
light and dark; the stylesheet as a system.
**Method:** heuristic evaluation (Nielsen's ten) by eye on screenshots, plus
an automated audit (`site/tests/browser/design.browser.mjs`) and a stylesheet
inventory.

### What was measured

| | Before | After |
|---|---|---|
| Top bar on phones while scrolling | scrolled away (a later `.bar{position:relative}` cancelled `sticky`) | stays at the top |
| Distinct spacing values | 32 raw px values | 10 tokens on a 4pt grid |
| Distinct font sizes | 42 raw sizes, smallest about 8px | 9 tokens, smallest 12px |
| Distinct corner radii | 15 | 8 tokens |
| Stacking layers | 13 bare numbers | 13 named tokens |
| Screens that scroll sideways (of 66 measured) | 6 (Care, Together, Vault at 320px; Vault at 390px) | 0 |
| Controls under the touch minimum | 630 across screens (72 distinct controls) | 0 |
| Text under 12px | 320 across screens (29 distinct) | 0 |
| Text below WCAG AA | 22 (the install icon on the dark bar) | 0 |
| Keyboard focus | browser default, faint on marigold and dark bars | one ring from tokens, checked by tabbing |

### Heuristic findings

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 1 | 3 User control | The top bar scrolled away on phones, so the menu, alerts and account were a long scroll back up | 3 | Fixed: sticky again, tested |
| 2 | 4 Consistency | 32 spacing, 42 type and 15 radius values: near-identical components looked slightly different screen to screen | 3 | Fixed: DLS tokens, lint gate |
| 3 | Accessibility | Tab labels, eyebrows, field labels and timestamps at 10-11px; hard to read for parents | 3 | Fixed: 12px floor |
| 4 | Accessibility | Segmented tabs, filter chips, icon buttons and inputs at 21-40px tall | 3 | Fixed: 44px touch, 36px desktop |
| 5 | 8 Minimalist / layout | Care, Together and Vault forms wider than a 320px phone (two-column fields could not shrink, four-option repeat did not wrap) | 3 | Fixed |
| 6 | 1 Visibility of status | Any open game closed itself within seconds (a refresh without sign-in read as "game over") | 4 | Fixed earlier today (PR #14) |
| 7 | 4 Consistency | Floating buttons with words covered controls on small phones | 3 | Fixed: round icons on phones (PR #14) |
| 8 | Accessibility | Keyboard focus relied on the browser default, invisible on marigold buttons | 2 | Fixed: token focus ring |
| 8b | 8 Minimalist | Found during this review: once bar icons became 44px, the name "Parwah" ran 9px into the bell on a 320px phone | 2 | Fixed: the install link moves to the menu below 360px; tested by the gap between them |
| 8c | Motion | Reduced motion was honoured element by element, so a new animation could ignore it | 2 | Fixed: one global rule |
| 9 | 2 Real-world match | "Circle", "family" and "group" used for the same idea in different places | 2 | Follow-up: copy pass |
| 10 | 1 / 8 Trust | "Coming soon" lines on Profile (Plus plan, Hindi toggle) in a live product | 2 | Follow-up: copy pass |
| 11 | 6 Recognition | On phones the floating buttons are icons only (💬, ✨); names are in tooltips and screen-reader labels, not on screen | 2 | Follow-up: a one-time hint on first use |
| 12 | 4 Consistency | Icons are emoji, which draw differently on Android, iPhone and Windows | 2 | Follow-up: one icon set as atoms |
| 13 | 8 Minimalist | Today stacks many cards of equal weight; the one thing that needs you does not stand out | 2 | Follow-up: rank Today by what needs you |
| 14 | 6 Recognition | Vyapar squares show city codes (JAI, BOM) to fit a phone | 1 | Accepted: full names on Buy, in history and for screen readers |
| 15 | 5 Error prevention | Game moves, task claims and "done" are protected against double taps | 0 | Good: keep the pattern |
| 16 | 9 Recovery | Errors say how to fix ("Follow suit - you have a heart", "Someone moved a moment ago") | 0 | Good: keep the pattern |

### Found after merge (Codex review of PR #16), fixed in PR #17
| # | Finding | Sev | Status |
|---|---|---|---|
| 19 | The gate let any fluid `clamp()` size through, and the audit skipped board text: Vyapar city codes rendered at about 10px on phones | 3 | Fixed: 12px token; `clamp()` only between ramp tokens; board text audited |
| 20 | The contrast audit skipped text on gradients (every primary button) | 3 | Fixed: text is checked against every gradient stop; this found the avatar initials at 2.64:1 (dark on sindoor), now on the button gradient token |

### Verdict
**Approved with follow-ups.** Every severity 3 and 4 finding is fixed and
guarded by a test that fails if it comes back. The severity 2 follow-ups
(9-13) go to the copy and navigation pass, which is already on the list.

### Guard rails added
- Gate (`npm test`, "dls:"): no raw spacing, type size, radius, layer or
  duration outside the token block; every used token is defined; the docs and
  the PR template exist; the focus ring comes from tokens.
- Browser (`npm run test:browser`, `design.browser.mjs`): every screen at
  320, 390 and 1280px, light and dark: no sideways scroll, touch minimum,
  12px floor, WCAG AA, the sticky bar, and a visible focus ring.
- Every pull request carries the design checklist (`.github/pull_request_template.md`).

## Review 2: location sharing (People)

Checklist and heuristic pass on the new "Where everyone is" card, phone light
and dark at 320 and 390px, desktop at 1280px.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 21 | 1 Visibility | The card always says whether you are sharing, how precisely and when it last updated | 0 | Good: keep |
| 22 | 3 Control | One tap stops sharing, and the button says it deletes the location | 0 | Good: keep |
| 23 | 2 Real-world match | "Area only" reads as the neighbourhood, never the house; the rounding happens on the server | 0 | Good: keep |
| 24 | 4 Consistency | Built only from existing atoms: `.card`, `.seg`, `.go`, `.cbtn`, `.crow`, `.linkbtn`; no new tokens | 0 | Good |
| 25 | Accessibility | An old position is shown in the alert colour and also in words ("last seen 2 hours ago"), never by colour alone | 0 | Good |
| 26 | 5 Error prevention | When the phone blocks location, the card says how to allow it instead of failing silently | 0 | Good: tested end to end |

**Approved.** No new findings above severity 0; the design suite covers the
card in all 66 screen measurements.

## Review 3: what comes first on Today

The owner asked for the most useful and most important things to come
first, ranked by real family use. Today had the widgets at the very bottom,
below a mostly empty "Your family" card and the emergency card. The order
mixed daily tools (Things to do) with rare ones (Payments, Muhurat).

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 27 | 8 Minimalist / 6 Recognition | The widgets, the way into every part of the app, started about 1,000px down a phone | 3 | Fixed: they now come straight after the daily check |
| 28 | 2 Real-world match | Widget order did not follow how often families use each thing or what is at stake | 2 | Fixed: scored and ranked in `TODAY.md`; the gate keeps the order |
| 29 | 7 Flexibility | A parent's All is well, Pills and SOS buttons came after three cards | 3 | Fixed: they now come straight after the family card |
| 13 | 8 Minimalist | (Review 1) Today ranks nothing by what needs you | 2 | Partly fixed: a fixed, scored order. Live counts on the widgets ("1 needs attention") show what needs you, without moving buttons under a finger |

**Approved.**

## Review 5: five things, not fifty (Anshul's review, 3 October 2026)

A first real family tried Parwah and said it was too much. His points:
families talk on WhatsApp, so Parwah should do what WhatsApp cannot. The
vault is the core: he downloaded his brother's Aadhaar, PAN and licence
for a car claim instead of asking for photos. It will be used mostly for
elders' health. And the daily food question made the app feel complicated.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 37 | 8 Minimalist | Today offered 11 tiles and five cards; a real user called it complicated | 4 | Fixed: four tiles and the emergency card; everything else under More, nothing deleted |
| 38 | 2 Real-world match | A daily food or mood question that families already have on WhatsApp | 3 | Fixed: removed from Today; a parent's All is well and Pills taken stay |
| 39 | 7 Flexibility | Chat held a tab-bar slot that the vault, Parwah's reason to exist, did not | 2 | Fixed: the tab bar is Today, Vault, Care, People; Chat is one tap away from the floating button and the menu |
| 40 | 6 Recognition | Medicines and health facts sat in "Family memory" among contacts | 2 | Fixed: a Health tile opens medicines and health facts together |

**Approved.** The scoring is in `TODAY.md`. Joint or nuclear family and the
four-generation family tree, from the same review, are the next change.
