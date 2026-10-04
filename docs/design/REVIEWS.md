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

## Review 5: five things, not fifty (a family's review, 3 October 2026)

A first real family tried Parwah and said it was too much. The points:
families talk on WhatsApp, so Parwah should do what WhatsApp cannot. The
vault is the core: a brother's Aadhaar, PAN and licence were downloaded
for a car claim instead of asking for photos. It will be used mostly for
elders' health. And the daily food question made the app feel complicated.
Before choosing a role, a family should say whether it is joint or nuclear,
and the tree should reach four generations.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 37 | 8 Minimalist | Today offered 11 tiles and five cards; a real user called it complicated | 4 | Fixed: four tiles and the emergency card; everything else under More, nothing deleted |
| 38 | 2 Real-world match | A daily food or mood question that families already have on WhatsApp | 3 | Fixed: removed from Today; a parent's All is well and Pills taken stay |
| 39 | 7 Flexibility | Chat held a tab-bar slot that the vault, Parwah's reason to exist, did not | 2 | Fixed: the tab bar is Today, Vault, Care, People; Chat is one tap away from the floating button and the menu |
| 40 | 6 Recognition | Medicines and health facts sat in "Family memory" among contacts | 2 | Fixed: a Health tile opens medicines and health facts together |

**Approved.** The scoring is in `TODAY.md`. Joint or nuclear family and the
four-generation family tree, from the same review, are the next change.

### Follow-up in the same review: joint or nuclear, and the family tree

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 41 | 2 Real-world match | Roles were one word each (Son, Brother), with no daughter-in-law, son-in-law or grandchildren, and no way to say whose son | 3 | Fixed: a new family says joint or nuclear first; each person is placed relative to someone ("son of Papa", "wife of Rohan"), and Parwah works out daughter-in-law, grandson, Chacha, Bua, Mama, Mausi and their spouses |
| 42 | 6 Recognition | Everyone saw the same word for a person, whoever was looking | 2 | Fixed: Papa is "Father" to his son and "Father-in-law" to his daughter-in-law; the label is worked out for whoever is looking |
| 43 | 1 Visibility | No picture of who belongs where | 2 | Fixed: the family tree at the top of People, couples side by side and children below, four generations and more |


## Review 6: the whole app, page by page (4 October 2026)

Four reviewers each took a quarter of the app and used it as a family
would, in a real browser at 320, 390 and 1280 wide, light and dark:
sign-in, onboarding, Today and the menus; the vault, health and the
emergency card; Care, People and the tree; and Together, Ekta, the day
and the public pages. Each finding is fixed in the change named in its
row. The family tree's findings are fixed first, because it shipped last.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 44 | 3 User control | A wrong placement in the tree could not be undone; taking someone out would have cut off their children | 4 | Fixed: each link (husband or wife, whose child) is removed on its own, with everyone else, children too, left where they are |
| 45 | 2 Real-world match | Only people on Parwah could be in the tree, so Dadi without a phone, a grandfather who has passed away or a young child could never be placed, and four generations were out of reach | 4 | Fixed: anyone can be added by name, marked "not on Parwah"; they can have health records and papers but are never given a task, a chat or a share |
| 46 | 5 Error prevention | The tree form opened on a wrong sentence ("Me is the child of Dadi") that one tap saved | 3 | Fixed: it starts on nothing chosen, the words follow he or she (son, wife, mother), and it says the sentence back before saving |
| 47 | 3 User control | The 12-second refresh undid He or she while someone was still choosing | 3 | Fixed: only choosing another person resets it |
| 48 | 4 Consistency | The location list and member list used the word someone joined with, so Priya saw Papa as "Father" | 3 | Fixed: the tree's word everywhere; "You" for yourself; "Not in the tree yet" until placed |
| 49 | 2 Real-world match | A new family was asked its name before joint or nuclear, with joint already chosen | 2 | Fixed: joint or nuclear first, nothing chosen for them; grandparents are joint-family roles |
| 50 | 1 Visibility | At 320 the joint and nuclear choices spilled out of their pills, and the chosen one was invisible in dark | 2 | Fixed: title over description; a marigold ring marks the chosen segment in both themes; chips and segments say which is chosen to a screen reader |

### Review 6, the vault, health and the emergency card

The family's own example decides this part: a car claim needed a brother's
Aadhaar, PAN and licence. It worked only if he had already shared all
three, and from his profile it could not be done at all.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 51 | 1 Visibility | The emergency card was centred in a fixed overlay with no scroll: at 320x568 the name, Close and the blood group were off screen | 4 | Fixed: the sheet scrolls and opens at the top; the member sheet with gifts too |
| 52 | 3 User control | A paper shared as "can see it exists", or not shared, was a dead end; the only way forward was WhatsApp | 4 | Fixed: ask for that paper, or for a kind of paper ("Rahul's PAN") without learning what is in anyone's vault; the owner answers with one tap, or adds it |
| 53 | 7 Flexibility | A person's profile and page could not reach their documents | 4 | Fixed: "Their documents" on the profile and the page; each paper on their page opens it to download or to ask |
| 54 | 2 Real-world match | Open was a pop-up after a network call (blocked on phones), with no file name | 3 | Fixed: a real download named for whose paper it is ("Rahul - Rahul's PAN.png"), and Send it to share the file straight to an insurer |
| 55 | 5 Error prevention | Whoever uploaded a paper about someone else kept full access the owner could not see or take back; anyone who could open it could also rewrite it | 3 | Fixed: the uploader is listed under "Who can see this" with "take access back"; only the owner or the uploader changes or removes it, and the owner is told |
| 56 | 5 Error prevention | Editing a paper's name or notes wiped its last 4 digits | 3 | Fixed: a blank number keeps them; the form says "Ending 234F - type the full number only to change it" |
| 57 | 2 Real-world match | No "Emergency contact" category, so readiness could never reach 100% | 3 | Fixed: first in the list; each gap on a person's page opens the form already set to fill it |
| 58 | 5 Error prevention | Ticking "Keep this private" while editing did nothing, and said "Entry updated" | 3 | Fixed: privacy is changed on the entry ("Who can see this"); the line under Save always says who will see it |
| 59 | 4 Consistency | Preparedness showed "undefined" | 3 | Fixed: "Someone near them" is named |
| 60 | 8 Minimalist | A person's page was long, repeated itself in "Freshness", and never said what was missing | 3 | Fixed: emergency card and documents first, then "2 things to complete" as tappable rows; re-checks marked where they are |
| 61 | 1 Visibility | The emergency card was 14px grey, with no home address, no neighbour and no ambulance number | 3 | Fixed: blood group and allergies large, values in ink, the home address, the neighbour, a Call button for the first contact and the ambulance number where they live; a switcher between the family's cards |
| 62 | 2 Real-world match | "Record", "allowed ₹3000", an "Ask first" that could never be answered, and a monthly cap never enforced | 2 | Fixed: "Note a payment", sentences in the activity, Yes / Not this time for the owner, and the monthly limit holds |
| 63 | 7 Flexibility | Phone photos are 3-5 MB, over the 2 MB limit, and the file picker had no camera | 2 | Fixed: "Take a photo" and "Choose a file"; photos are made smaller on the phone |
| 64 | 5 Error prevention | The offline emergency copy stayed on the phone after sign-out | 2 | Fixed: signing out or leaving removes it; offline it says how old it is |

### Review 6, signing in, a first Today, the shell and Profile

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 65 | 1 Visibility | An invite link opened while signed in landed on the old family and the invite vanished; signed out, nothing said you had been invited | 3 | Fixed: the join card with the code filled in; "You have been invited" on the sign-in screen; the code leaves the address once used |
| 66 | 5 Error prevention | "Check again" let you "in" whenever you were in any other family | 3 | Fixed: only when the family you asked says yes |
| 67 | 3 User control | Back left the app from every onboarding step; the create card had no Back; "Join with a code" opened the create chooser | 3 | Fixed: each step is a place Back returns to; Back on the create card; the join card opens |
| 68 | 2 Real-world match | "Senior mode" made a son a parent; big text barely grew; grandparents had to find the box | 3 | Fixed: "I am an elder the family looks after" (on for grandparents, and parents in a joint family) is separate from "Big text and buttons", which anyone can turn on and which really enlarges |
| 69 | 1 Visibility | An elder's SOS was below the fold, under an organiser's hero and an alerts card | 3 | Fixed: their three buttons come first, SOS on top; alerts wait below the emergency card |
| 70 | 8 Minimalist | Today's first screen was the circle code, Invite and Family call, with a status that pushed chat; four first-run layers stacked | 3 | Fixed: the hero is the family name and a status from the five things; the code and Invite live on People; Family call under More; the checklist under the hero with alerts as step one; no coach marks |
| 71 | 7 Flexibility | Profile opened on pricing, coins and an API-key console; Edit opened in another card; the settings line went stale | 3 | Fixed: You first with Edit under it, How Parwah looks, Alerts, Privacy, then Plan and coins; AI keys under Advanced; Leave and Sign out last |
| 72 | Privacy | Typing any number showed "Welcome back, Rohan" before a PIN | 3 | Fixed: no name until the PIN is right |
| 73 | 8 Minimalist | The bell repeated the activity feed, with "Type: checkin" and old names | 3 | Fixed: only what needs you, never your own actions or chat; rows are buttons; destinations named as the app names them |
| 74 | 4 Consistency | One place had two or three names (Health / Memory / Family memory; Things to do / Care; Family / People) and "circle" was mixed with family | 3 | Fixed: Vault, Health & contacts, To do, Family on tiles, tabs and menu, the rest under More; "family" in the copy |
| 75 | 4 Consistency | Medicines taken said "Well done!", forgot itself on reload, and earned coins | 2 | Fixed: "Medicines taken ✔ · 8:10 am", kept for the day; no coins for medicines or check-ins |
| 76 | 3 User control | SOS, sign out and leave used the browser's small dialog | 2 | Fixed: Parwah's own sheet, two big answers |
| 77 | 7 Flexibility | The drawer ignored Escape and kept focus behind it; the install icon showed inside the installed app; the profile tile opened a one-item menu, even signed out | 2 | Fixed |
| 78 | 8 Minimalist | The floating chat button covered the five things on phones | 2 | Fixed: on a phone it shows on the chat list; everywhere on a wide screen |
