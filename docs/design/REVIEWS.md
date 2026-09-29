# Design leader reviews

Newest first. Each review uses `CHECKLIST.md`; severities are Nielsen's:
0 not a problem, 1 cosmetic, 2 minor, 3 major, 4 blocker.

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
