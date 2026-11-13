# Family coverage: what a family needs, what Parwah does, what comes next

Owner directive, 2026-11-11: cover everything a family is linked by. Any kind
of information (property included) with the right security and a clear choice
of who sees it. Proper family chains for door ke rishtedaar. Everyone's
interests, where they watch, and recommendations to anyone. Plan it fully,
with the architecture, so it is easy to use and solves a real purpose.

This file is the map. It lists every family need we know of, says honestly
where Parwah stands on each, and fixes the architecture every new feature
follows. Update it in the same change that ships a feature.

Status words: **Live** (in the app today) · **Building** (in this round) ·
**Next** (designed here, not started) · **Later** · **Decide** (needs the owner).

## 1. The needs of a family, by area

### A. Knowing each other is fine (presence and safety)
| Need | Status | Where |
|---|---|---|
| A daily "I am okay" from a parent, and a nudge to the family when it is missed | Live | check-in, quiet ladder |
| One-tap emergency, with who is nearest and who to call | Live | SOS, SOS ladder, SOS dial |
| Where everyone is, only while they agree to share | Live | location shares, places |
| My location stays mine: "Announce my arrivals" is my own switch (off until I say yes), an ask to share has a "Not now" that mutes that person for 7 days, I see who looked ("Seen by Rohan, 10 min ago"), and an old position says "Last seen" | Live | `api/_locationapi.mjs`: `location_consent`, `location_asks`, `location_looks`; other people's positions are sent only on a read with `look=1` |
| "Reached safely": I say where I am going and by when; one tap tells the people I chose; if I forget, they are asked gently to call, 30 minutes after the time | Live | `api/_ashirwad.mjs` (`trips`), `sweepTripsAll` from the timer |
| An emergency card for each person, shown to that person and the adults they chose, with two contacts they chose, printable, and open with no signal once opened | Live | the card on the phone, plus `api/_ecard.mjs` behind `/api/book?area=ecard` |
| Find a phone that is on silent | Live | find me |
| A helper nearby is told when family is far | Live | nearby ladder |
| Fall or no-movement signal from the phone | Later | needs the native apps (phase 2 onward) |

### B. Looking after health and care
| Need | Status | Where |
|---|---|---|
| Medicines: the list, the doses, the stock, the refill | Live | doses, inventory, refill |
| Doctor visits: before, during, after, and the follow-ups | Live | visits, audio consultations |
| Reports and numbers over time | Live | biomarkers, health records in the vault |
| A hospital stay: papers, insurer, pre-auth, discharge | Live | admissions, pre-auth packets |
| Home staff: attendance, salary, advances, late alerts | Live | staff. The late alert goes to one named owner with a one-tap answer ("Sunita came" / "On leave today"); a day off marked ahead is skipped; salary and advances are for adults only |
| The daily call rota is the parent's too: they are told, choose the time that suits them, and can say "No daily call, thank you" | Live | `api/_rotaconsent.mjs` |
| Who does what between brothers and sisters, and who paid | Live | sibling tasks, expenses, split, bills |
| Care for a child (vaccines, school, growth) | Next | section 4, tranche 3 |
| Care for a pet | Later | |

### C. Papers, property and information (the family's memory of facts)
| Need | Status | Where |
|---|---|---|
| ID papers and policies, each shared person by person, with a log | Live | vault |
| Where things are kept when I am not here | Live | asset locator |
| **Property and every other kind of holding: house, land, vehicle, gold, funds, loans, subscriptions, online accounts, heirlooms, anything else** | **Building** | Family Register (extends the locator) |
| **A plain choice of who sees each entry: only me, people I choose, whole family, only in an emergency** | **Building** | Family Register |
| **The owner can see who looked** | **Building** | Family Register view log |
| Renewals and due dates with reminders | Live | renewals |
| Shared notes and lists; private notes | Live | notes |
| Useful contacts (plumber, doctor), shared or private | Live | family book |
| What to do when someone passes away: a checklist built from the register, started by two adults, never legal advice | Live | "What needs doing" (`api/_afterlossapi.mjs`), under the Family register |
| A will or nomination reminder, never legal advice | Later | |

### D. Who is who (the family itself)
| Need | Status | Where |
|---|---|---|
| A family tree anyone can add to, including people not on the app | Live | tree |
| Names for near relations, the way families say them | Live | kin labels |
| **Names for the wider family: Devar, Nanad, Saala, Bhabhi, Jija, Samdhi, second cousins, a parent's cousin** | **Building** | kin labels |
| **The chain that connects any two people, in words** | **Building** | kin chain |
| **A Rishtedaar list: near, close and far, with search** | **Building** | Rishtedaar screen |
| Two households that are related (maika and sasural, two brothers' homes) seeing each other's tree, by consent of both | Live | linked families |
| Birthdays, anniversaries and the shared card | Live | bond cards |
| Gotra, native village, kuldevta, family customs written down | Live | family facts |
| A family directory to print or share for a wedding | Later | |

### E. Staying close (bonding)
| Need | Status | Where |
|---|---|---|
| Family chat, groups, voice notes, reactions, quick polls | Live | chats |
| Plans, date polls, who brings what, festivals together | Live | plans, festival kits |
| Stories from elders, memories, family recipes | Live | stories, yaadein, rasoi |
| Games and things to do on a call | Live | games, board, things to do |
| Reach-out nudges when two people have not spoken | Live | bond nudges |
| **Everyone's interests, visible to who they choose** | **Building** | Pasand |
| **Where each person watches and listens** | **Building** | Pasand platforms |
| **Recommend a show, song, game, book or place to anyone, and hear back** | **Building** | Pasand recommendations |
| Watch or listen together at a set time (a plan with a link) | Live | a `together` plan, made from a recommendation in one tap |
| A shared family photo album | Live | Yaadon ki album: photos kept in the database like vault files, made small on the phone first; 400 a family. A move to paid storage later is one change |
| Care that flows back from a parent: Ashirwad (a one-tap blessing or a voice note, answered with "🙏 Pranam" or a voice reply) and "How is your day?" asked of a child | Live | `api/_ashirwad.mjs` behind `/api/chats?area=ashirwad`; the parent's big button is on the senior Today |
| A daily "what happened today" digest | Live | Aaj kya hua, from Ekta: plain words for everyone; one model call per member per day at most, 12 a circle a day, only when the owner's key is set |

### F. Money between family
| Need | Status | Where |
|---|---|---|
| Who paid for care, and settling up | Live | expenses, split. The ledger is read by the people who pay; the person cared for sees only what they paid until they turn on "Show me the costs" on their own phone; no amount goes in the feed |
| Saved ways to pay each other (UPI id, never a PIN) | Live | pay methods |
| Splitting a trip or a function | Live | plan costs: who paid, who owes whom, a two-sided "paid" and "received". Parwah never moves money; it can open the payer's own UPI app |
| Pocket money and chores for children | Later | |
| A family budget | Later | out of the care wedge for now |

### G. Running the home
| Need | Status | Where |
|---|---|---|
| To-dos with owners and reminders | Live | tasks, reminders |
| Bills and their due dates | Live | bills |
| Shopping lists | Live | notes with checklists |
| Auspicious times, panchang, horoscope | Live | muhurat, rashi |
| Home repairs log and warranty dates | Next | a register kind plus renewals |
| Meal plan for the week | Later | |

### H. Children and learning
| Need | Status | Where |
|---|---|---|
| A child's or teenager's standing: under 18 by date of birth, or marked as a child by an adult, is not sent SOS details, missed-dose alerts, staff salaries, the safe word, emergency items or cost ledgers, and still gets plans, cards, games, the album, stories and Ashirwad | Live (the pushes and reads listed in section 3; a child's own page is later) | `audienceFor(sql, circleId, kind)` in `api/_audience.mjs` |
| School timetable, fees, exam dates, pick-up duty | Next | tranche 3 |
| Vaccination record | Next | tranche 3 |
| Screen-time agreement the family writes together | Later | |

### I. Faith, custom and big events
| Need | Status | Where |
|---|---|---|
| Festivals the family keeps, planned together | Live | festival kits |
| A wedding or function: guests, tasks, who is arriving when | Next | an event kit on top of plans and Rishtedaar |
| Days of remembrance kept gently (the calendar date; a tithi is not worked out yet) | Live | days of remembrance |

## 2. The architecture every feature follows

**One app, one file, one database.** The app is `site/public/index.html`
(vanilla JS). The server is Vercel functions in `api/` on Neon Postgres. The
project is capped at 12 functions and uses 11, so a new feature is a module
whose name starts with an underscore, reached through an existing route by an
`area` parameter:

| Route | Areas behind it |
|---|---|
| `/api/book` | health and contacts, vault, pay, notes, memory bond, **album**, **emergency card (ecard)**, biomarkers, pre-auth, **register (locator)**, audit, admission, **what needs doing (afterloss)** |
| `/api/care` | reminders, requests, refill, bills, sibling tasks, doses, ladders, expenses, staff, renewals |
| `/api/plans` | plans, visits, shared cards and polls, **watch together**, **cost split** |
| `/api/games` | games, **pasand** |
| `/api/circle` | family, members, **tree and kin**, linked families, family facts, days of remembrance |
| `/api/settings` | keys, push, coins, plan, day, PIN, location |
| `/api/chats` | chats, **Ashirwad, How is your day, Reached safely, a child's standing** (`area=ashirwad`) |
| `/api/ekta` | the assistant, **the daily digest** (`action: digest`) |
| `/api/chats`, `/api/events`, `/api/auth`, `/api/diag` | as named |

**Rules for a module**
1. Tables are created by the module itself, through `schemaOnce`, so two
   first loads never race.
2. Every request passes `requireMember`. Every id passes `isUuid`.
3. Who may read a row is decided in the SQL, never only on the screen.
4. Text that could hold a secret is checked: no card number, CVV, OTP,
   banking PIN or password is ever stored. Account numbers keep the last four.
5. Anything timed (a reminder, a card, an alert) is swept by `runTick`.
6. Ids and function names carry the feature's prefix, so merges cannot
   collide; the gate fails on a duplicate id.
7. Each feature ships with a pure-logic test, a database test, a real-browser
   test with the design measurements, and gate checks.

**One privacy model, used everywhere: the audience**

| Choice | Who can read | Used by |
|---|---|---|
| Only me | the owner | notes, register, interests, albums |
| People I choose | the owner and named members | vault, family book, register, interests, recommendations, albums |
| Whole family | everyone in the circle | most things, by default |
| Only in an emergency | the circle, while that person has an open SOS; and, while the family's "What needs doing" list for that person is open, the two adults who started it and the nominee the entry names | register |
| Sealed until the day | everyone but the person it is for | shared cards |

The person an entry is about, and whoever wrote it, can always read it back.
Where it matters (vault, register, family book) the owner can see who looked.

**The family graph.** A person has two links: a parent and a spouse. Every
relation, near or far, is worked out from those two links by `api/_kin.mjs`,
which is pure and runs the same on the server and the phone. Nothing about a
relation is typed in by hand, so it cannot go stale. Linked families join two
graphs at one person who belongs to both, in memory, by consent of both
sides. Across a link go a name, he or she, the two tree links, the year of
birth and the city, and a phone only when that side ticks it. Nothing else.

## 3. This round (tranche 1), built in parallel

| Feature | Module | Route | Tables |
|---|---|---|---|
| Pasand: interests, platforms, recommendations | `api/_pasand.mjs` | `/api/games?area=pasand` | new, prefixed by the module |
| Family Register: more kinds, four audiences, edit, view log, search | `api/_careprep.mjs` (or `_register.mjs`) | `/api/book?area=locator` | `legacy_asset_locators` extended, a view log |
| Door ke rishtedaar: labels, chain, closeness, Rishtedaar screen | `api/_kin.mjs` | `/api/circle` | none |

Honest limits of this round:
- **Platforms are declared, not linked.** Netflix, Prime Video and JioHotstar
  offer no sign-in for other apps. A person ticks what they have and may paste
  a public profile or playlist link. Parwah never stores a platform password;
  sharing one breaks those services' terms.
- **The register stores where things are and who should know, not the money
  itself.** No balances are fetched from a bank.

**Shipped after tranche 1 (2026-11-12)**

| Feature | Module | Route | Tables |
|---|---|---|---|
| Watch or listen together | `api/_together.mjs` | `/api/plans` (kind `together`) | columns on `plans`: platform, link, rec_id, rec_kind, invited, maybe, cannot |
| Splitting the cost of a trip or a function | `api/_split.mjs`, `api/_splitmath.mjs` | `/api/plans?area=split` | `plan_costs`, `plan_cost_shares`, `plan_settles`; `plans.cost_currency` |

Honest limits:
- **Parwah never moves money.** The split only does the sums. "Pay" opens
  the payer's own UPI app with the amount filled in, and only with a UPI id
  its owner has already allowed that person to use. A UPI PIN is never asked
  for. A line is closed only when both people say so.
- **A plan is in one currency**, from the country of whoever made it. UPI
  links appear only on plans in rupees.
- **A together plan is seen by the whole circle**, like every plan. Only the
  people ticked are told.

### Consent, control and care both ways (stream B, live)

Care used to be done to the parent. These make the person who is cared for
an equal, and each rule is enforced on the server:

- **Location.** Announce my arrivals (own switch, off by default), "Not now"
  to an ask (7 days), who looked, and "Last seen" for a position older than
  5 minutes.
- **Call rota.** The person called is told, chooses the time, can say "No
  daily call, thank you"; nobody else can restart it for them.
- **Costs.** Shown to the people who pay. "Show me the costs" is the
  person's own switch. A child reads none of it.
- **Home staff.** One named owner hears a late alert and answers in one tap.
  Salary and advances are for adults.
- **A child's standing.** `audienceFor(sql, circleId, kind)` and
  `pushAudience(...)` in `api/_audience.mjs` are the one filter. Adult-only
  kinds: `sos_details`, `missed_dose`, `staff_money`, `staff_late`,
  `safe_word`, `emergency_items`, `costs`. A kind nobody listed is adult
  only. Used today by: the staff late alert, the costs and staff reads, the
  safe word, emergency-only register entries, the emergency card, Ashirwad
  and trips. Still to adopt it (owned by other modules): the SOS push and
  the SOS block of the family read, and the missed-dose push.
- **Ashirwad and "How is your day?"**, **Reached safely**, and **who may
  open an emergency card** (see the rows above).

Not built here: a child's own page; a card saved as an image (Print, and
the phone's "Save as PDF", is the way today).

## 4. What comes next

**Tranche 2: the wider family**
- Linked families: two circles agree to show each other their tree and their
  Rishtedaar list. Nothing else crosses over. **Live** (`api/_famlink.mjs`).
- Family facts: gotra, native village, kuldevta, customs, with an audience.
  **Live** (`api/_famfacts.mjs`).
- Days of remembrance on a person, with a gentle reminder to the family.
  **Live** (`api/_remember.mjs`).
- ~~"When someone passes away": a checklist drawn from the register (which
  bank, which policy, who is the nominee), shown only to the people chosen.~~
  Live as "What needs doing". It has no viewing rule of its own: every step
  from the register goes through `registerRowFor`, and starting a list never
  changes who can see an entry. Tables: `afterloss_lists`, `afterloss_steps`.
- Watch together: a plan made from a recommendation in one tap. **Live**
  (`api/_together.mjs`). A recommendation that was not sent to everyone asks
  first, because a plan is seen by the whole family.

**Safeguards added after the second review (2026-11-12)**
- "What needs doing" needs a second adult to start AND to open again. One
  adult alone is enough only when the family has no other adult and the
  person is not on Parwah. The person it is about can close it, which removes
  it. A list in force marks the person as remembered.
- Marking someone as remembered destroys nothing, the marked person can undo
  it, and someone who used Parwah in the last 30 days cannot be marked.
- A plan with costs cannot be cancelled, and stays under "Costs to settle"
  after its day until the ledger is settled.
- Asking to link two families is counted and capped, and waits 7 days after
  a no.
- A remembered person is refused by the server as an invitee, a cost sharer,
  a step owner and a chosen audience.

**Tranche 3: children and the home**
- A child's page: school, fees, exams, pick-up duty, vaccines.
- Home repairs and warranties as register kinds with renewal reminders.
- An event kit for a wedding or function: guests from Rishtedaar, tasks,
  arrivals.

**Waiting on the owner**
- Photo album storage: the album is live on the database, capped at 400 photos a family (about 256 MB at the very most, nearer 120 MB in practice). Choose and pay for file storage only if families outgrow that; the bytes are read and written in two functions (`albumPutBytes`, `albumGetBytes` in `api/_album.mjs`), so the move is one change.
- ~~Trip and function cost split with UPI links.~~ Live (`api/_split.mjs`). Parwah never moves money; the UPI link is built for the payer only.
- Ekta daily digest: accepted and built (2026-11-12). Still to decide: where the owner reads the usage counter (`digest_usage`); there is no admin screen for counters yet.
- SMS sign-in stays off, by the owner's decision.

## 5. How a new need gets added
1. Add a row to section 1 with status Next.
2. Pick the route and the audience from section 2. If neither fits, change
   this file first and say why.
3. Build it to the seven module rules. Run the checklist in
   `docs/design/CHECKLIST.md`. Record a leader review in
   `docs/design/REVIEWS.md` for a new screen.
4. Move the row to Live in the same pull request.
