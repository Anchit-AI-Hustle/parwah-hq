# Design leader reviews

Newest first. Each review uses `CHECKLIST.md`; severities are Nielsen's:
0 not a problem, 1 cosmetic, 2 minor, 3 major, 4 blocker.

## Review 17 - 2026-11-02 - Family Memory: stories, Yaadein, recipes, nudges

Scope: the bonding half of Family Memory (`api/_memorybond.mjs`). New screens: the Family Memory switch (`#mb-switch`) with Stories (`#mb-stories`), Recipes (`#mb-recipes`) and Settings (`#mb-settings`); the cards on Today (`#mb-today`: the storyteller ask, this week's question, a group's throwback, Yaadein, the private nudge); one sheet for every form (`#mbsheet`: pick a storyteller, answer by voice or typing, who can hear it, add or open a recipe); and the printable family book (`#mb-book`). Screenshots at 390 and 1440, light and dark, family and group, normal and elder mode; each screen is measured for 44px targets, the 12px floor, AA contrast in both themes and nothing sideways at 320 and 390 in `memorybond.e2e`.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 142 | 2 Real-world match | The nudge's "a while" choice read "3 weeks with no 1:1 message, call or v..." cut off on a phone | 2 | Fixed: the choice is "2 / 3 / 4 weeks"; what counts is said once under it |
| 143 | 4 Consistency | The storyteller's status line under each name rendered at 11.6px | 2 | Fixed: 12px, from the ramp |
| 144 | 1 Visibility | Printing the family book printed a blank page: the emergency card's print rule hides everything | 3 | Fixed: while the book is open, the print stylesheet shows only the book, without its buttons |
| 145 | 5 Error prevention | "Don't nudge me about Papa" was an inline link, under 44px | 2 | Fixed: a 44px target, still quieter than Call and Later |
| 146 | 3 User control | Skip on this week's question could be read as "tell the family I skipped" | 2 | Fixed: a sheet says "It will not be asked again for 8 weeks. Nobody is told." |
| 147 | 8 Minimalist | Voice and photos in the lists made Stories and Recipes slow to open | 2 | Fixed: lists carry text only; a voice note loads on Listen and a photo when the recipe opens. Nothing plays by itself |
| 148 | 1 Visibility | A tiny photo in Yaadein shows tiny | 1 | Open: real photos are fine; no upscaling, to keep it honest |

Words: warm and grade-6, about half Hinglish in the questions; never morbid ("before it is too late" is turned away by the server); the nudge says "It has been a while with Papa. Call, send a voice note, or later. Only you see this." and never a score or a feeling. Recipes say they are for food, and a home cure is refused kindly. "Remembered" is for someone who has passed away: no automatic memories about them, and no questions.

Elder mode: the question card's text goes to 24px and each button to a full-width 56px row; the storyteller says yes on their own screen, as with the daily check-in.

New patterns: the memory card (`.mbcard`, a 4px edge: marigold for a question, rani for Yaadein, peacock for the private nudge), side-by-side answers (`.mbside`), the story row (`.mbstory`), the recorder (`.mbrec`: start, stop, a player that never auto-plays), the recipe row (`.mbrecipe`), and the print book (`.mbbook`).

| | |
|---|---|
| Reviewer | Design lead (agent review, bond-c) |
| Date | 2026-11-02 |
| Scope | The screens above |
| Heuristic scores (0 fine - 4 blocker) | 1 Visibility 1 · 2 Match 0 · 3 Control 0 · 4 Consistency 0 · 5 Errors 0 · 6 Recognition 0 · 7 Flexibility 0 · 8 Minimalist 0 · 9 Recovery 0 · 10 Help 0 |

## Review 16 - 2026-11-02 - five family care tools

Scope: the daily check-in (quiet day), Ask family first, Help with my phone, the life certificate and the call rota. New screens: the alerts row at the top of Today (`#fcalerts`), the daily check-in card (`#fcquiet`), and four sheets (`#fcafsheet`, `#fcphsheet`, `#fcqsheet`, `#fctsheet`), plus a checklist or rota inside a task (`#ts-tpl`). Screenshots at 390 and 1440, light and dark; the sheets are measured for 44px targets, the 12px floor, AA contrast and 320px width in `caretools.e2e`, and Today's alerts in `design.browser`.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 134 | 1 Visibility | A parent's yes to a check-in time asked by the family sat under five big buttons, below the fold | 3 | Fixed: a question waiting for your own answer is in the alerts row at the top of Today |
| 135 | 1 Visibility | Today said "All quiet" under "Papa is asking the family first" | 3 | Fixed: the status line names the first alert while one is up |
| 136 | 2 Real-world match | "Away?" on a check-in row did not say what it does | 2 | Fixed: "Pause" (and "Change" while away), with a label naming the person |
| 137 | 4 Consistency | Call links in alert rows were underlined, unlike every other button | 1 | Fixed |
| 138 | 8 Minimalist | The check-in card repeated its explanation above a single "Ask Papa" row | 1 | Fixed: the explanation shows only once someone has a time; an invitation row explains itself, and "Not now" waves it away on this phone |
| 139 | 5 Error prevention | An Aadhaar number could be typed as the acknowledgement | 3 | Fixed: refused under the box, on the server and in the app; Parwah never takes a face scan or an Aadhaar number |
| 140 | 9 Error recovery | "Rejected" on a life certificate left the family with nothing to do | 2 | Fixed: three steps that usually sort it (Aadhaar photo, the bank branch, a doorstep banking visit), as a list |
| 141 | 3 User control | One tap on Ask family first from More could alarm the whole family by accident | 2 | Fixed: the elder's big button sends at once (it says so); from More, the sheet opens first with "Tell the family now" |

Words: calm and dignity-first. "Has not checked in today. Give him a call?", never an emergency; nothing is called monitoring or detection, and Parwah never says it can spot a scam. The how-to cards are static text with a Hinglish line under each title (no Devanagari in the app).

New patterns: the alert row (`.crow.fcrow.urgent`, a 4px status edge with a word, never colour alone), the plain-rules list (`.fcrules`), the how-to card (`details.howto`), the checklist row (`.fcchk`), the rota chips (`.fcrota`).

| | |
|---|---|
| Reviewer | Design lead (agent review, feat-a) |
| Date | 2026-11-02 |
| Scope | The five screens above |
| Heuristic scores (0 fine - 4 blocker) | 1 Visibility 1 · 2 Match 0 · 3 Control 1 · 4 Consistency 0 · 5 Errors 0 · 6 Recognition 0 · 7 Flexibility 0 · 8 Minimalist 1 · 9 Recovery 0 · 10 Help 0 |
| Must fix before release | None open |
| Follow-ups, with owner | Elder mode now has five big buttons; watch with real parents whether the last two should fold under "More help" (owner: Anchit) |
| Verdict | Approved with follow-ups |

Added at the merge of the three feature branches: when the quiet-day alert has been up for 30 more minutes and nobody in the family has checked in or said "I called", the first nearby helper who said yes is reached, once per person per day: Parwah rings them when calls are switched on (inside the family's daily call cap); otherwise the alert row shows "Nobody has answered yet" with a Call button for that helper. Proved in `site/tests/db/caretools.dbtest.mjs`.

Also at the merge, the elder's Today was put back in the order `TODAY.md` sets, calmest first: All is well, then today's medicine ticks (they replace "Medicines taken" when times exist, so there is never both), then SOS, then Ask family first, Help with my phone and "Who came today?". SOS stays docked in the tab bar (the sidebar on a laptop), so it is in reach without scrolling whatever sits above it. Checked at 320 and 390: no sideways scroll, nothing overlaps.

## Review 15 - 2026-11-02 - nearby helpers, costs, home staff, renewals

Scope: four new screens built from existing atoms (`.card`, `.crow`, `.ev`, `.pick`, `.seg`, `details.fmore`, `.gchk`, `.ss-btn`): Costs, Home staff and Renewals under To do; Nearby helpers on a person's page; "Who came today?" on an elder's Today; nearby people on the family's SOS alarm; the nearby person's own consent page. Measured by `site/tests/browser/familytools.browser.mjs` at 320, 390 and 1440px in both themes: no sideways scroll, 44px targets, 12px floor, AA contrast.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 128 | 1 Visibility | The month total on Costs rendered at body size inside a card | 2 | Fixed: the total is the hero number (`.ftbig`), the label above it is plain text, not a shouting eyebrow |
| 129 | 8 Minimalist | Every renewal row carried a task picker, even an FD two hundred days away | 2 | Fixed: the picker shows only within 60 days or once expired; a repeated kind name ("Gas connection KYC · Gas connection KYC") is dropped |
| 130 | 2 Real-world match | "1 paid leave day a month are not cut" | 1 | Fixed: "1 day of leave a month is paid" |
| 131 | 7 Flexibility | The SOS alarm's helper buttons read "Mrs" (first word of the name) | 2 | Fixed: the name as the family wrote it, with a key mark when they hold one |
| 132 | 5 Error prevention | An ID box could take a whole Aadhaar number | 3 | Fixed: 4 characters in the box and on the server; the add form tells the family to tell the worker what is kept |
| 133 | 4 Consistency | Reordering the ladder by drag is hard on a phone and for older hands | 2 | Arrows (44px, labelled "Move X up/down"), focus kept on the moved row |

New patterns: the month stepper (`.ftmonth`), the three-way day mark (`.ftmarks`, bigger in senior mode), the status chip (`.ftchip` ok / warn / bad, always with words). Follow-up (owner: product): a ladder rung on a missed check-in, through `ladderFor`, when the quiet-day alert lands. Done when the three feature branches were merged: see Review 16.

Verdict: Approved with follow-ups.

## Review 14 - 2026-11-02 - dose ticks, the hospital screen, after a visit

**Reviewer:** Claude, acting as senior product designer.
**Brief:** three stories from family research. "Show me which doses Maa
marked today, and nudge her and then me if the evening one is missed."
"When Maa is admitted, everyone sees the same status, and whoever is at the
counter has every paper." "After Papa's appointment, I can see what the
doctor asked for and when the next visit is, without a 20-minute call."
**Scope:** the big dose ticks in elder mode (`#dose-elder`), the Today rows
(`#cc-today`), the person page cards (medicines today and the week strip,
doctor visits, hospital stays), and three sheets: medicine times
(`#dsheet`), the hospital screen (`#admsheet`) and after the visit
(`#vsheet`). Screens checked at 390 and 1440, light and dark.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 121 | 2 Real-world match | Times read "20:58" in the feed and "8:58" on the tick, which a parent cannot tell from morning | 2 | Fixed: every time is said as the family says it, "8:58 PM", in the app, the feed and the push |
| 122 | 5 Error prevention | A dose many hours away showed a big "Tap when taken" that the server then refused | 3 | Fixed: a time more than three hours off shows as "Later today" with nothing to tap |
| 123 | 1 Visibility of status | The counter papers on the hospital screen sat on "Loading…" after the family list refreshed | 3 | Fixed: the papers are kept apart from the refreshing list; insurer, policy ending, TPA and the emergency contact show |
| 124 | 8 Aesthetic & minimalist | "Undo the last step" was a whole empty step card | 1 | Fixed: a plain link under the steps |
| 125 | 10 Trust | A tick could be read as proof that a medicine was taken | 3 | Fixed: "A tick is what was marked, not a check that the medicine was taken." on the family card, and "It is a note, not a check." under the parent's ticks; nothing gives dose advice |
| 126 | 10 Trust | A hospital timeline invites "how long will it take?" | 2 | Fixed: the screen says Parwah does not know hospital or insurer timings; "waiting since 3:10 PM" is a clock, never an estimate; IDs show only their last four |
| 127 | 4 Consistency | Status on the week strip by colour alone | 2 | Fixed: ✓, !, ↷ and … on every day, the tints only behind them, and each day said in words to a screen reader |

New patterns: the week strip (`.cc-week`, `.cc-day`), the step list
(`.cc-steps`), the waiting clock (`.cc-wait`), the paper checklist
(`.cc-papers`) and pressed chips (`.cc-pick button[aria-pressed]`). All
tokens; 44px targets and no sideways scroll at 390 are measured in
`site/tests/db/carecycle.e2e.dbtest.mjs`; the rules in `test_site.py`
("care cycle:" checks).

**Approved.**

## Review 13 - 2026-10-20 - proof, a real signup, and privacy

**Reviewer:** Claude, acting as senior product designer.
**Brief:** a portfolio review said the site needs proof, a signup that
really stores, and a privacy notice with consent before it convinces a
visitor.
**Scope:** the new proof section on `/welcome/`, the launch list form on
`/launch/`, and the launch list and analytics sections of `/privacy/`.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 115 | 1 Visibility of status | The home page had no sign that anyone else uses Parwah | 3 | Fixed: a proof section under the hero: two counts read live from the database, three quotes, and a note that says in words what is an example |
| 116 | 10 Trust | Sample figures and quotes could be read as real | 4 | Fixed: every quote carries an Example tag, the note names the figures as examples whenever the live count is not shown, and all of it sits in `site/public/proof.js` |
| 117 | 9 Error recovery | A failed join said "Could not join right now" and nothing else | 3 | Fixed: the message says the person is not on the list yet, keeps what they typed, and offers WhatsApp |
| 118 | 5 Error prevention | A typo in the email was only caught after a round trip; a second tap could send twice | 2 | Fixed: the server's rules are asked first, the box that is wrong is marked and focused; one join at a time |
| 119 | 4 Consistency | The form's boxes were white with cream text in the night theme, and its messages used peacock and rani as status colours | 3 | Fixed: boxes on `--card`, messages in ink on tints with a ✓ or ! so status is never colour alone |
| 120 | 2 Real-world match | The privacy notice did not mention the launch list at all; its spacing tokens did not exist, so its headings sat on the text | 3 | Fixed: what, why, where, how long and how to delete, linked beside the form; the page's style block uses real values |

New patterns: the proof stat (`.pf-stat`), the quote card with its Example
tag (`.pf-quote`, `.pf-tag`), and the honeypot (`.wl-hp`). Pinned by
`test_site.py` (signup, proof, privacy and meta checks) and
`site/tests/db/waitlist.e2e.dbtest.mjs`.

**Approved.**

## Review 12 - 2026-10-13 - content first, forms last

**Reviewer:** Claude, acting as senior product designer.
**Owner's words:** "Overall entire app design is too kiddish - it's not about
logos or emojis or icons. The overall pages structures and layouts need to be
updated to prioritise the correct and important useful features correctly."
**Scope:** the structure of Today, Family and To do's notes; what the Today
tiles say; where forms sit on every screen. Judged against the utility
ranking in `docs/design/TODAY.md`.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 111 | 8 Aesthetic & minimalist | Today led with a poster: a tall decorated hero and five add-buttons before any of the five things the review ranked | 3 | Fixed: the hero is a one-line header; the tiles and emergency card come first; the add row follows the content |
| 112 | 1 Visibility of status | The Vault tile - ranked #1 by the family review - showed a slogan, not the family's papers | 3 | Fixed: the events payload now carries the document count and the tile reads "12 papers kept", or says the vault is empty |
| 113 | 2 Real-world match | Family opened on the tree and its whole add-form; the people themselves - the screen's own subtitle - sat fourth | 4 | Fixed: who is waiting, the family, how ready, where everyone is, the tree last with its add-form folded (it opens itself while the tree is empty) |
| 114 | 8 Aesthetic & minimalist | Notes opened on an empty form above the family's actual lists | 2 | Fixed: the lists first, the form after |

**The rule this encodes:** content first, forms last. A screen opens on what
the family has; the way to add more comes after it or behind a fold. The
gates pin it: `test_site.py` (today, quick add, people checks), and the
peoplecare, tree and first-run e2e suites.

**Approved.**

## Review 11 - 2026-10-13 - a grown-up chrome: one bottom bar, drawn icons

**Reviewer:** Claude, acting as senior product designer.
**Owner's words:** "Design style and ui is too kiddish. Sticky bottom nav for
the three floating icons is atrocious design - figure out the best ui styles
and fix."
**Scope:** the app chrome on a phone - top bar, bottom bar, menu drawer,
sidebar, Today's tiles, screen headers. Light and dark at 320 and 390px,
desktop at 1280px, parent's Today included.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 107 | 8 Aesthetic & minimalist | Emoji as navigation icons (🏠 🔐 ✅ 👨‍👩‍👧 🔔 ☰ 📲) read as a toy, and render differently on every platform | 3 | Fixed: one drawn line-icon set (24px grid, 1.8 stroke, currentColor) across the bar, tabs, sidebar, drawer, tiles and screen headers; emoji stay in content, where they are warmth, not wayfinding |
| 108 | 8 Aesthetic & minimalist | The dock: a second dark band above the tabs holding SOS, Chat and Ekta - two stacked bottom bars eating ~134px of a phone screen | 4 | Fixed: one bottom bar. SOS docks inside the tab bar at its left (56px, red, always on screen); Ekta is a tab of its own; New chat is a top-bar action beside the bell |
| 109 | 4 Consistency | Chat reachable only through a floating button on a phone while every other place is a tab or menu item | 2 | Fixed: New chat sits in the top bar on every screen but Chat's own |
| 110 | 7 Efficiency | At 320px the bar could not hold the brand and four actions without the name touching the icons | 2 | Fixed: below 375px the bar gives up frame padding and gap, never the 44px tap targets |

**Decisions.** The 2026-10-10 rule ("elements should never get hidden")
stands: nothing floats over the page; the fix moves the three controls into
the two bars instead of stacking a third. Emoji inside content (buttons,
toasts, games) are deliberate Mela warmth and stay; the chrome is where they
read as childish. The gates now pin the one-bar layout: `test_site.py`
(order, chat, sos, layout checks), `flow.browser` at 320/390px,
`newchat.browser`, and `firstrun.e2e` for a parent's phone.

**Approved.**

## Review 10 - 2026-10-05 - one name per place, as the utility ranks them

**Reviewer:** Claude, acting as senior product designer.
**Scope:** tiles, tab bar, menu, screen titles, back buttons, first-run,
Ekta, pushes and the welcome pitch. The family review already ranked the
five things (Vault, Health, To do, Family, emergency card). Review 74
renamed the tiles and tabs; the screens and the words that point at them
had kept the old names.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 104 | 4 Consistency | Health opened as "Family memory"; To do as "Things to do"; Family as "People" or "Care" | 3 | Fixed: Health & contacts, To do, Family, Vault on the screen, the back button, the first-run and the welcome pitch |
| 105 | 2 Real-world match | Ekta and the phone push still said "Open Care, then Things to do" and "open Family memory" | 2 | Fixed: they name the place the family will tap |
| 106 | 6 Recognition | The gift hint used a raw cream (`#FDF4E3`) instead of `--tint-warm` | 1 | Fixed |

**Approved.** The `names:` gate now fails if a screen title or back button
drifts from the tiles.

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

### Review 6, To do and People

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 79 | 5 Error prevention | "9 am tablets" written at 3 pm was already late and woke the whole family | 3 | Fixed: a time already gone means tomorrow; a task written down after its time shows as late but wakes nobody |
| 80 | 8 Minimalist | People was a card of chips per person, with who was waiting four screens down and everyone listed twice | 3 | Fixed: who is waiting, the tree, one line per person the family looks after, the family (only those not in the tree), then where |
| 81 | 4 Consistency | The add form kept last time's Daily-for-Papa; the escalation copy said the opposite of what happens with nobody given it | 2 | Fixed |
| 82 | 8 Minimalist | Someone asked, not yet agreed, saw six buttons; a late task advised "set a new time" with no such button | 2 | Fixed: Yes, I can't, Talk; late shows Set a new time and Call |
| 83 | 3 User control | Suggested could not be waved away, and "Add it" made a task out of a ten-second gap | 2 | Fixed: Fill it now, Not needed |
| 84 | 2 Real-world match | The profile sheet said "Father · senior mode · admin", gifting outranked Call, and it was not a dialog | 2 | Fixed: the family word only, Call first, gifts last; Escape and focus |
| 85 | 2 Real-world match | Someone who joined as "family" stayed genderless, so the tree said Parent instead of Father; a new joiner was never placed; "Grandmother (by marriage)" | 2 | Fixed: the tree asks he or she for them once; after a yes, the tree form is ready for the joiner; "Grandmother-in-law" |
| 86 | 1 Visibility | "Suggested1"; options in lower case; For whom could not be changed | 1 | Fixed |

### Review 7, owner round of 2026-10-04 (sign-in, menu, To do, checks, nudges)

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 87 | 4 Consistency | Sign-in offered a PIN of 4 to 6 numbers or a password: two kinds of secret, one box, and a choice nobody needed | 3 | Fixed: a PIN of exactly 4 numbers, on the number pad; an older PIN or password is typed once, then a 4-number PIN is chosen |
| 88 | 7 Flexibility | Chat, Ekta and Together sat under More in the side menu, below the records | 2 | Fixed: Today, Chat, Ask Ekta, Together (Plans & calls, Games, Drawing board) first |
| 89 | 2 Real-world match | Hindi names (the Devanagari mark, Saanp Seedhi, Bhabhi, Vyapar, Antakshari, Muhurat, Rashifal) | 2 | Fixed: Snakes & Ladders, Get Away, Business, Song Chain, Good times, Horoscope; no Devanagari in the app |
| 90 | 7 Flexibility | Chat and Ekta were missing from most screens on a phone | 2 | Fixed: both float on every screen except their own; alone, Chat drops to the bottom slot. Supersedes #78 at the owner's direction |
| 91 | 3 User control | "Record Amit's allergies" had only "I'm on it": the person had to find the form | 3 | Fixed: "Do it now" opens Health & contacts set to allergies for Amit, takes the task, and saving it finishes the task |
| 92 | 5 Error prevention | A name of dots or a phone number, a birthday in the future, a cap of minus five rupees, a "link" that was a sentence were all saved | 3 | Fixed: one rule each on the server (api/_valid.mjs) and in the app; the box that is wrong is marked and says why, beside itself |
| 93 | 1 Visibility | "Waiting for Amit" in a game, and a task someone else holds, gave no way to ask | 2 | Fixed: Nudge (games, once every two minutes) and Remind (tasks, once an hour), to that person's phone only |

New pattern: the field error (`.fielderr` under the box, `aria-invalid` on it, focus moved there, cleared on the next keystroke). Use it instead of a toast whenever a form is refused.

### Review 8, SOS (owner, 2026-10-04)

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 94 | 1 Visibility | SOS lived only on Today, and only in big form on an elder's phone | 4 | Fixed: a red SOS button on every screen, bottom left, 64px, for everyone |
| 95 | 5 Error prevention | SOS asked "Are you sure?" in a sheet: slow in an emergency, easy to dismiss by mistake | 3 | Fixed: a 5-second countdown with a big Cancel (pockets press buttons) and Send now |
| 96 | 7 Flexibility | After SOS the person had nothing to do next | 4 | Fixed: one screen with Call 112 and the family, WhatsApp, SMS and email filled in, what happened (alerted, location, recording, who answered), and I am safe now |
| 97 | 1 Visibility | On a family phone with Parwah open, an SOS was a bar at the top | 4 | Fixed: the whole screen, a siren and the buzz, with Call, I am on it, See where they are, Listen, and Silence |
| 98 | 3 User control | Location during an SOS could be switched off by the person mid-emergency | 3 | Changed at the owner's direction: held on, exact, until someone else in the family marks them safe; then it is theirs again. Alone in a family, the person may close it |

New patterns: the SOS button (`.sosfab`), the SOS and alarm screens (`.sosscreen`, `.sosalert`, `.ss-btn`). Emergency red (`--sos`) is used for these and nothing else.

### Review 9, everyday family tools (owner, 2026-10-04)

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 99 | 6 Recognition | Basic things (an event, a reminder, a list) were missing or hidden behind the right tab | 3 | Fixed: one Add row on Today - Reminder or task, Event or plan, List or note, Contact or health, Document - each straight to its form, cursor in place |
| 100 | 1 Visibility | A task's time passed silently; an alarm at 6 read "Running late" at 6 | 3 | Fixed: Remind at the time or before it (at the time by default); an alarm screen with a chime, Done, Snooze 10 minutes; 30 minutes' grace before "running late"; a 10-minute timer rings them with every phone closed |
| 101 | 7 Flexibility | No shared lists or notes: groceries and packing lived in WhatsApp | 2 | Fixed: Notes & lists under To do; tick together; "Only me" for private notes |
| 102 | 2 Real-world match | Plans were calls and parties only; birthdays were nowhere | 2 | Fixed: appointments, functions, trips; birthdays from dates of birth on the calendar and the list, with Wish them; whoever is going is reminded an hour before |
| 103 | 1 Visibility | Location sharing was a dot on a map: no "at home", no way to ask, no battery | 2 | Fixed: saved places with arrive and leave alerts, who is at each place, Ask to share, battery beside each person |

New patterns: the Add row (`.quickadd`), the note card (`.note`, `.noteitem`), the reminder alarm (the `#alarmsheet` sheet).

### Review 10, three floating buttons (owner, 2026-10-05)

On a laptop the sidebar already holds Chat and Ask Ekta. A second pair of floating buttons, plus SOS, sat on the page. The phone tab bar stays Today, Vault, To do, Family, so the three floats stay there.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 104 | 8 Minimalist | SOS, New chat and Ekta floated over a page that already has a sidebar. They sat on the to-do list | 3 | Fixed: Chat and Ask Ekta stay in the sidebar. SOS sits at the bottom of the sidebar, above the account line, full width and 64px tall. On a phone the three still float. Supersedes the wide-screen half of #90 |

### Review 11, launch pages: /get/ and /press/ (2026-11-02)

Checked at 390 and 1440, light and dark, on the real pages. Screens: /get/ (rebuilt), /press/ (new). Both are built from the shared tokens in `site/public/styles.css`; nothing new was added to the design system.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 105 | 2 Real-world match | /get/ led with a profile download that iPhone calls "not signed" and an Android test build, before the way most families should use: the browser and Add to Home Screen | 3 | Fixed: each phone's card leads with "The easy way", one gradient button and four steps; the profile and the test build sit under Advanced options, with an honest line on each |
| 106 | 9 Error recovery | Every visit to /get/ logged a 404 in the console from a probe for a download that does not exist | 2 | Fixed: the probe is gone; the gate checks it never comes back |
| 107 | 4 Consistency | The download links in Advanced were gradient buttons, as loud as the main path | 2 | Fixed: plain rani links, 44px tall, so only the main path wears the gradient |
| 108 | 1 Visibility | /press/ dark mode: the jamun and ink colour swatches vanished into the night ground | 2 | Fixed: every swatch has a --bone-2 border, visible in both themes |
| 109 | 8 Minimalist | /press/ phone layout: four screenshots in one column made a very long page | 2 | Fixed: two columns on a phone, each opening the full-size image |

New pattern: none. "The easy way" label is the existing eyebrow treatment in `--sindoor`.

### Review 12, chat bonding: voice notes, reactions, Dekh liya, quick polls (2026-11-02)

Checked at 320, 390 and 1440, light and dark, normal and senior mode, on the real app with a fake microphone (`site/tests/db/chatbond.e2e.dbtest.mjs` measures 44px targets, the 12px floor, AA contrast and sideways scroll on every new screen). Screens: the recording bar and preview in the message box, the voice note player, the reaction picker, the poll sheet, the poll card, Who voted, and the senior hold bar with Dekh liya. Works the same in a family and in a friends' group; the wording says "family" or "group".

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 110 | 7 Flexibility | Typing is slow for a parent; the only way to say something was the keyboard | 3 | Fixed: a mic beside the camera (tap, see a timer out of 1:00, Stop, hear it, Send or Delete). Senior mode: one big bar, hold to talk, let go to send, slide away to cancel |
| 111 | 3 User control | A voice note that starts by itself is a surprise in a temple or a meeting | 3 | Fixed: nothing plays until tapped; play and pause, 1x and 1.5x, the length shown |
| 112 | 9 Error recovery | A phone that refuses the microphone threw an error nobody saw | 2 | Fixed: a plain sentence says how to allow it; typing still works |
| 113 | 6 Recognition | Saying "I saw it" needed a typed reply | 2 | Fixed: a small 🙂 on every message (and a long press) opens five reactions; tap the count to see who; tap again to take it back. Senior mode: one big "❤️ Dekh liya" for the latest message. A reaction never pings and never moves the chat |
| 114 | 2 Real-world match | "Whose house for Sunday lunch?" became thirty messages | 2 | Fixed: Poll in the chat header; 2 to 6 choices, one or more, an optional closing time; tap to vote or change; Who voted; the person who asked closes it. Senior mode: choices are 56px buttons |
| 115 | 4 Consistency | The first dark-mode play button was jamun on a jamun card and nearly vanished | 2 | Fixed: the play button uses --ink on --day, which flips with the theme |
| 116 | 9 Error recovery | The poll sheet kept "Write the question first" on screen after the question was written | 1 | Fixed: the message clears as soon as anything is typed |

New patterns: the voice note player (`.vn`), the recording bar (`.vnbar`), reaction chips and picker (`.rx-chip`, `.rx-add`, `.rx-big`), the poll card (`.pl`, `.pl-opt`) and the senior bar (`.bondsenior`, `.vnhold`, `.dekh`). All built from existing tokens; no new token.

### Review 13, Rishtedaar: the wider family, named, with the chain (2026-11-11)

Checked at 320 and 390, light and dark, on the real app with a five-generation family built through the real tree API (`site/tests/db/rishtedaar.e2e.dbtest.mjs` measures 44px targets, the 12px floor, AA contrast and sideways scroll on the list, the chain sheet, the list with a message, the empty list and the line on a person's page). Screens: the Rishtedaar list (opened from the family tree), the chain sheet, "how are we related?" on a person's page, and the search box on the "of" list in the tree form.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 117 | 2 Real-world match | Anyone further than a first cousin was called "Family", and a wife's own parents had no word at all once her husband's parents were in the tree | 3 | Fixed: Jeth, Devar, Nanad, Saala, Saali, Bhabhi, Jija, Samdhi and the rest are named; a parent's cousin, a cousin's child and a second cousin have their words; beyond that the chain itself is told short ("Dada's brother's son's wife") |
| 118 | 5 Error prevention | Jeth or Devar depends on who was born first, and many dates of birth are empty | 3 | Fixed: with either date missing the English word is shown (Brother-in-law). Nothing is guessed |
| 119 | 6 Recognition | A label alone does not say how a far relative is connected | 2 | Fixed: one line of chain under every name ("Your mother Geeta's brother"), the full chain on a tap, and the same line on the person's page |
| 120 | 1 Visibility | A list that is empty, still loading, or could not be read looked the same: blank | 2 | Fixed: each says what is happening. Empty gives one first step with a button; a failed read keeps the family this phone last saw and offers Try again |
| 121 | 7 Flexibility | In a family of fifteen the "of" list in the tree form was a long scroll | 2 | Fixed: past eight people a search box shortens the list; a choice already made is never dropped |
| 122 | 3 User control | The 12-second refresh redrew the list under a finger | 2 | Fixed: the list is redrawn only when what it shows has changed |

New patterns: none. Rows are `.crow`, sheets are `.msheet`, buttons are `.cbtn` and `.go`; the page-specific classes (`.rz-row`, `.rz-msg`, `.rz-chain`) use existing tokens only.

### Review 14, the family register, grown from "When I'm Not Here" (2026-11-11)

Checked at 320, 390 and 1440, light and dark, normal and senior mode, on the real app (`site/tests/db/famregister.e2e.dbtest.mjs` measures 44px targets, the 12px floor, AA contrast and sideways scroll on the empty screen, the filled form, an opened entry, a locked row, a search with no match, the "remove?" sheet and the offline message). Screens: Vault, Family register.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 123 | 2 Real-world match | Eight kinds of thing, none of them a house, the gold or an email account | 3 | Fixed: 22 kinds under six plain headings (Home and land, Money, Papers, Things, Online, Other), with "Anything else" and the person's own name for it |
| 124 | 3 User control | Who could read an entry was a select of two; "named people only" existed on the server but could not be chosen | 3 | Fixed: a labelled group of four (Only me, People I choose, Whole family, Only in an emergency), each with one line that says what it means, and a tick list of the family for the second |
| 125 | 5 Error prevention | A locked entry still showed its name and the last four of its number to everyone | 3 | Fixed: a locked row says only whose it is and the kind; "Only me" is not shown to anyone else at all |
| 126 | 3 User control | An entry could be added and never changed or removed | 3 | Fixed: Edit, Change who sees it, and Remove (asked first in the app's own sheet), for the person it is about and whoever wrote it |
| 127 | 1 Visibility | Nobody could tell who had read where the papers are | 2 | Fixed: the details open on a tap, and the owner reads "Seen by Priya, 3 Nov" on the entry |
| 128 | 6 Recognition | A long list had no way to find one thing | 2 | Fixed: a search over name, kind and person, a filter by person, and a count of what is shown |
| 129 | 9 Error recovery | A refused save was a toast that vanished | 2 | Fixed: the reason sits under the box it is about (a password in the note says so under the note); offline and failed loads offer Try again |

New patterns: the register row (`.frrow`, `.frhead`, `.frchip`, `.frbody`), the choice group (`.frwho`) and the find bar (`.frfind`). All built from existing tokens; no new token.

### Review 15, Pasand: what each person likes, where they watch, and recommendations (2026-11-11)

Checked at 320 and 390, light and dark, on the real app with a family and a friends group (`site/tests/db/pasand.e2e.dbtest.mjs` measures 44px targets, the 12px floor, AA contrast and sideways scroll on the Pasand section, the recommend sheet, the rows on Today and the card on a person's page).

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| 130 | 2 Real-world match | "Link your OTT" promises a sign-in that Netflix, Prime Video and JioHotstar do not offer to other apps | 3 | Fixed: the screen says what it is. "Tick what you have so the family knows where to watch together. Parwah never asks for your password." One optional public link per platform |
| 131 | 5 Error prevention | A family member might type a login into a like, a note or a link | 4 | Fixed: anything that reads as a password or a sign-in is refused with a plain reason, in every field and inside a link. A title that is only the word Password is still allowed |
| 132 | 3 User control | Likes were all or nothing | 3 | Fixed: three choices, whole family, people I choose, only me. The same choice covers where I watch. The server applies it, not the screen |
| 133 | 1 Visibility | A recommendation could be sent to someone who is not on Parwah and never arrive | 2 | Fixed: it is refused with the reason ("Dadi is not on Parwah yet, so they would not see it") |
| 134 | 4 Consistency | An answer needed typing | 2 | Fixed: four one-tap answers (Will try it, Loved it, Seen it, Not for me), changeable, with an optional line |
| 135 | 8 Minimalist | Old recommendations would crowd Today | 2 | Fixed: Today shows only the unanswered ones, three at most, then a count. The rest live under For me |

New patterns: none beyond page-specific classes that start with `ps-`, built from existing tokens.

### Review TBD-together, plans: watch together and splitting a cost (2026-11-12)

Checked at 320 and 390, light and dark, normal and senior mode, on the real app (`site/tests/db/plantogether.e2e.dbtest.mjs` measures 44px targets, the 12px floor, AA contrast and sideways scroll on the Today row and From me with Watch together, the Watch together sheet with and without a refusal, the together plan card at the time and answered, the plan form with Watch something together, the costs sheet empty, refused, offline, with three costs, with Pay and I have paid, with a line waiting, with everyone square, and the cost form with a refusal and with uneven shares). Screens: Together, Plans and Pasand; Today.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| T1 | 6 Recognition | A recommendation ended at "Will try it"; making a time for it meant typing the name again into a plan | 3 | Fixed: one button on every recommendation (Today, For me, From me), worded by what it is: Watch, Listen, Play, Go or Read together. The sheet opens on this Saturday 8pm with the people it was between already ticked |
| T2 | 1 Visibility | At the time of the plan, the link was three screens away | 3 | Fixed: the plan card says "On Prime Video" and, from 10 minutes before until 3 hours after, shows Open it and Call the family. Before that it says when they will show |
| T3 | 4 Consistency | A second answer system (yes, maybe, no) beside the plan's own "I'm in" | 2 | Fixed: I am in, Maybe, Cannot go through the same answer on the same plan; "in" is still the plan's going list, so the hour-before reminder reaches who said yes |
| T4 | 5 Error prevention | A link on a plan could be anything | 4 | Fixed: https only, under Pasand's own rule, checked on the server, checked again when a plan is made from a recommendation, and once more before it is put in the page. A refusal sits under the link box |
| T5 | 2 Real-world match | "Settle up" can read as Parwah paying | 4 | Fixed: said once, near the button, in plain words: "Parwah does not move money. This opens your own UPI app." Where there is no app to open it says Parwah only does the sums |
| T6 | 5 Error prevention | One person could mark a debt as gone | 4 | Fixed: I have paid and Received are two taps by two people, in either order. Until both, the line reads "waiting" and can be undone by whoever marked it |
| T7 | 5 Error prevention | A UPI id could be shown to someone its owner never allowed | 4 | Fixed: the link is built on the server only for the person who has to pay, only in rupees, and only when the owner already allowed them in Ways to pay. Otherwise: "Ask Meera for a UPI id", and no link |
| T8 | 1 Visibility | Owes and settled told apart by colour | 3 | Fixed: each state is a mark and words in ink (✓ Is owed, ! Owes, ✓ All square, ⏳ Waiting, ✓ Settled). No vibe colour carries a status |
| T9 | 9 Error recovery | Uneven shares that do not add up failed only on save | 2 | Fixed: a running line under the boxes says what they add up to and what they must add up to; the same words come back if saved anyway |
| T10 | 3 User control | Someone not on the plan tapped Costs and saw a blank sheet | 2 | Fixed: "Only people on this plan can see its costs. Say you are in first.", with Try again. Offline and a failed load say so in plain words too |

New patterns: the answer group (`.tgans`), the ledger list and line (`.splist`, `.spline`, `.spstate`), the total row (`.sptotal`) and the share box (`.spshare`). All built from existing tokens; no new token.
### Review TBD-afterloss, "What needs doing": the checklist for when someone passes away (2026-11-12)

Checked at 320 and 390, light and dark, normal and senior mode, on the real app with a family of four (`site/tests/db/afterloss.e2e.dbtest.mjs` measures 44px targets, the 12px floor, AA contrast and sideways scroll on the list before a person is chosen, starting it, waiting for the second adult, being asked to confirm, the list in use on three phones, a refusal under a step, a closed list, the two sheets, the line at the top of the Vault, the link on a person's page and the offline message). Screens: Vault, Family register; one link on a person's page.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| A1 | 2 Real-world match | The register says where things are, but in the week a family loses someone nobody knows what to do with each one | 4 | Fixed: one list in two parts. Nine first things for India (death certificate, bank, insurer, employer or pension office, phone and utilities, a will, landlord or society, Aadhaar and PAN, subscriptions), then one step per register entry, worded by its kind, with the nominee and where the papers are |
| A2 | 5 Error prevention | A list like this could be started by mistake, or in a quarrel | 4 | Fixed: two adults start it. The first names a second adult, who alone can say yes, and both are asked once more in the app's own sheet. With only one adult on Parwah, one is enough. It can be closed and opened again |
| A3 | 5 Error prevention | Starting it could quietly widen who reads an entry | 4 | Fixed: it never changes any entry. Each person sees only the steps for entries they could already see, by the register's own rule. "Only in an emergency" entries open for the two who started it and the nominee the entry names, only while the list is open, and the register form now says so where the choice is made |
| A4 | 1 Visibility | "Only me" entries would be lost with the person | 3 | Fixed: whoever wrote one reads a gentle line that they hold entries nobody else can see and may share them now, with a link to the register. Nobody else is told they exist |
| A5 | 4 Consistency | Status colours could borrow the alert red or the bright primary at the worst moment | 3 | Fixed: the ways in are text links, the buttons are the plain ones, done is the status green, and nothing on the screen uses an alert or vibe colour |
| A6 | 1 Visibility | Three people working one list could not tell who had done what | 2 | Fixed: each step shows who ticked it, who is doing it and a short note; "2 of 11 done" and a bar follow on every phone without a reload |
| A7 | 9 Error recovery | A refused note or a failed load would be a toast that vanished | 2 | Fixed: a refusal sits under the step it is about (a password in a note says so there); loading, nothing chosen, offline and a server error each have their own words and Try again |
| A8 | 10 Help | A family could read the list as legal advice | 3 | Fixed: said once, at the top: "This is a list to help you remember, not legal advice. Rules differ by bank and state." No step promises an outcome or a time |
| A9 | 8 Minimalist | A feature like this could nag | 2 | Fixed: two pushes in all, one to the adult asked and one to the family when it starts. No reminders |

New patterns: the checklist step (`.alstep`, `.altick`, `.almeta`, `.alacts`) and the quiet line (`.alnote`, `.alline`). All built from existing tokens; no new token. The progress bar is the first-run bar (`.frbar`) with the status green (`.albar`).
### Review TBD-wider, the wider family: linked families, family facts, days of remembrance (2026-11-12)

Checked at 320 and 390, light and dark, on the real app with two families that share one daughter (`site/tests/db/widerfamily.e2e.dbtest.mjs` measures 44px targets, the 12px floor, AA contrast and sideways scroll on the tree card with its two new buttons and with a linked tree under it, the Linked families sheet (empty, with a request, with a link, with a message), a linked person's sheet, Rishtedaar with a linked family in it, the question before a link ends, Family facts (empty, the form, the list, an error), the remembrance sheet, a person's sheet with and without the mark, the tree with a remembered person, and the card on Today). Screens: Family, Today.

| # | Heuristic | Finding | Sev | Status |
|---|---|---|---|---|
| W1 | 5 Error prevention | Linking two families could be read as sharing everything | 4 | Fixed: the sheet, the request and the yes each say what is shared (the tree and the Rishtedaar list) and that nothing else is: no chats, no papers, no health, no location. The server sends only name, he or she, the two tree links, the year of birth and the city |
| W2 | 3 User control | A link, once made, might feel permanent | 3 | Fixed: "End this link" on every linked family, for either side, asked first in the app's own sheet, and it takes effect at once. A request still waiting can be taken back |
| W3 | 5 Error prevention | Phone numbers of one family shown to another without anyone choosing it | 4 | Fixed: off by default. Each side has its own tick, "Share our phone numbers with them", and can change it later |
| W4 | 2 Real-world match | A person of the other family with no single word for the relation | 2 | Fixed: the home name when there is one (Saas, Saala, Damaad, Samdhi), otherwise the chain told short, with the full chain in words on a tap |
| W5 | 4 Consistency | The same person listed twice, once from each family | 2 | Fixed: the bridge, and her father added by name, are one person. They show once in Rishtedaar and are marked "in both families" in the linked tree |
| W6 | 1 Visibility | A request from another family could sit unseen | 2 | Fixed: the button on the tree card says "Linked families: 1 request waiting", and the family gets one push |
| W7 | 3 User control | Who sees a family fact was not a choice | 3 | Fixed: Whole family (the default), People I choose, Only me, as one labelled group. An elder can change the words of a fact, never who sees it |
| W8 | 9 Error recovery | A refused fact (an OTP in a note) would vanish as a toast | 2 | Fixed: the reason sits under the form; a failed load keeps what was loaded last and offers Try again; offline says so |
| W9 | 2 Real-world match | Words for someone who has passed away can read as clinical | 3 | Fixed: "No longer with us", "day of remembrance", "We remember". A test refuses clinical words in the sheet and on Today |
| W10 | 4 Consistency | A remembered person still said "not on Parwah", and was offered a task, a gift, a birthday | 3 | Fixed: one helper decides it for every list. The tree and the person's sheet say "🪔 No longer with us" in words, never by colour alone |
| W11 | 8 Minimalist | A yearly reminder could crowd Today | 2 | Fixed: one calm row, on the day only, with one button. One push the evening before, once a year |
| W12 | 3 User control | A mark made by mistake | 3 | Fixed: any adult in the family can take it off, asked first; the date and the line go with it |

New patterns: none. Sheets are `.msheet`, rows are `.crow` and `.plan`, buttons are `.cbtn` and `.go`, messages reuse `.rz-msg`; the page-specific classes start with `fl-`, `ff-` and `rm-` and use existing tokens only.
