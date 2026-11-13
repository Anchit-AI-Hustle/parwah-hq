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
| Home staff: attendance, salary, advances, late alerts | Live | staff |
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
| Birthdays, anniversaries and the shared card | Live | bond cards: reminded the evening before, never delivered empty, thanked by the person |
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
| **Saying how I feel, and choosing who is told** | Live | "Aaj kaisa lag raha hai?" on Today: five choices, each a word with its emoji. Private by default; the member chooses "Keep to myself", "Tell only..." one person, or "Tell the family". A low answer reaches the feed only if they chose the family |
| **A safe, private word to one person** ("Mujhe baat karni hai", "Maaf karna", "Can we talk?") | Live | `api/_baat.mjs`: only the two of them ever read it; not the feed, not the digest, not Ekta. The receiver answers "I will call you at...", "Aao, baat karte hain" or by voice. One reminder after a day, then silence |
| **Thanking each other, evenly** | Live | Shukriya: a line or a voice note to anyone, on Parwah or not (kept for the day they join), private to the two or shown to the family. A weekly quiet thought on Today suggests someone, chosen so everyone is suggested about equally often. No counts, no ranking |
| **One question a week for the whole family** | Live | at least 40 warm questions; each member answers by voice or text and reads the others once they have answered; someone not on Parwah can be answered for ("told by Dadi, recorded by Rohan") |
| **Being answered**: heard-by on a story, a thank-you for a card, a reaction on a photo | Live | stories ("Suna, bahut accha laga" or a voice reply, pushed to the teller); cards (reminded the evening before, never handed over empty, "Say thank you", a print and share view for someone not on Parwah); photos (reactions, a voice caption, share one photo, one "new photos" push a day) |
| **Equal votes** | Live | chat polls and date polls: a secret ballot (no name is sent to any phone), "Waiting for...", one reminder, a vote "for Dadi, by Rohan", the host sees the tally before a lock and the lock records it. Every vote counts once, whoever cast it |
| A daily "what happened today" digest | Live | Aaj kya hua, from Ekta: plain words for everyone; one model call per member per day at most, 12 a circle a day, only when the owner's key is set |

### F. Money between family
| Need | Status | Where |
|---|---|---|
| Who paid for care, and settling up | Live | expenses, split |
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
| School timetable, fees, exam dates, pick-up duty | Next | tranche 3 |
| Vaccination record | Next | tranche 3 |
| Screen-time agreement the family writes together | Later | |

### I. Faith, custom and big events
| Need | Status | Where |
|---|---|---|
| Festivals the family keeps, planned together | Live | festival kits: 21 festivals with dates to 2030, added and taken off one at a time, with a feed line saying who changed what |
| A wedding or function: guests, tasks, who is arriving when | Next | an event kit on top of plans and Rishtedaar |
| Days of remembrance kept gently (the calendar date; a tithi is not worked out yet) | Live | days of remembrance; the yearly reminder opens a memory card the family adds a line, a photo or a voice note to |

## 2. The architecture every feature follows

**One app, one file, one database.** The app is `site/public/index.html`
(vanilla JS). The server is Vercel functions in `api/` on Neon Postgres. The
project is capped at 12 functions and uses 11, so a new feature is a module
whose name starts with an underscore, reached through an existing route by an
`area` parameter:

| Route | Areas behind it |
|---|---|
| `/api/book` | health and contacts, vault, pay, notes, memory bond, **album**, biomarkers, pre-auth, **register (locator)**, audit, admission, **what needs doing (afterloss)** |
| `/api/care` | reminders, requests, refill, bills, sibling tasks, doses, ladders, expenses, staff, renewals |
| `/api/plans` | plans, visits, shared cards and polls, **watch together**, **cost split** |
| `/api/games` | games, **pasand** |
| `/api/circle` | family, members, **tree and kin**, linked families, family facts, days of remembrance |
| `/api/settings` | keys, push, coins, plan, day, PIN, location |
| `/api/ekta` | the assistant, **the daily digest** (`action: digest`) |
| `/api/chats` | chats, and **being heard** (`area=heard`): the mood card, a private word, shukriya, the weekly question, the memory card |
| `/api/events`, `/api/auth`, `/api/diag` | as named |

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
| Only the two of us | the sender and the one person chosen, and nobody else (no admin, no feed, no digest, no Ekta) | a private word, a shukriya (unless the writer shows the family), a mood told to one person |
| After I answer | members who have answered themself | the family's weekly question |
| No names | everyone gets the counts; nobody gets who chose what | a secret ballot |

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

**Being heard, and answered (stream D, 2026-11-13)**

An audit found that most features let someone speak but nobody was asked or
able to answer, the quiet member had no safe channel, and votes were not
equal. What shipped:

| Feature | Module | Route | Tables |
|---|---|---|---|
| The mood card, private by default | `api/_pulse.mjs`, `api/_heardrules.mjs` | `/api/chats?area=heard` (`mood_set`) | `pulse` + `tell`, `to_member`, `event_id` |
| A private word, and sorry | `api/_baat.mjs` | `/api/chats?area=heard` (`baat_*`) | `baat` |
| Shukriya and its fair weekly prompt | `api/_heard.mjs` | `/api/chats?area=heard` | `shukriya`, `shukriya_prompts` |
| The family's weekly question | `api/_heard.mjs` | `/api/chats?area=heard` | `sawaal_weeks`, `sawaal_answers` |
| The memory card of a day of remembrance | `api/_heard.mjs`, `api/_remember.mjs` | `/api/chats?area=heard` | `remember_cards`, `remember_entries` |
| Stories: heard by, a reply, told for someone | `api/_memorybond.mjs` | `/api/book?area=bond` | `story_heard`; `stories.recorded_by` |
| Cards: evening-before reminder, never empty, thank-you | `api/_bond.mjs` | `/api/plans?area=bond` | `card_thanks`; `cards.eve_at` |
| Photos: reactions, a voice caption, one push a day | `api/_album.mjs` | `/api/book?area=album` | `album_reactions`, `album_voice` |
| Equal votes | `api/_chatbond.mjs`, `api/_bond.mjs` | `/api/chats`, `/api/plans?area=bond` | `chat_polls.secret`, `.reminded_at`; `poll_votes.by_member`; `plan_polls.secret`, `.reminded_at`, `.decided`; `plan_votes.by_member` |
| Chat basics: paging, delete my own, mute for me | `api/chats.mjs` | `/api/chats` | `chat_mutes` |
| Festivals one at a time, dates to 2030 | `api/_bond.mjs`, `api/_tyohaar.mjs` | `/api/plans?area=bond` | none new |
| Coins for being heard, capped a day | `api/_coins.mjs` | none new | none new |
| Likes noted for someone not on Parwah | `api/_pasand.mjs` | `/api/games?area=pasand` | `pasand_likes.by_member` |

Honest limits:
- **A private word needs the other person to be on Parwah.** For someone who
  is not, the app says so and suggests a call. A shukriya is kept for them.
- **A secret ballot hides who chose what, not who has voted.** "Waiting for"
  names the people who have not answered yet, in every poll. With very few
  voters the counts alone can give a vote away; the screen says only what it
  shows.
- **A vote, an answer or a story given for someone not on Parwah is the
  word of the relative who typed it.** It is always shown with both names.
- **Festival dates for 2028 to 2030 come from one published calendar** (Drik
  Panchang; 2028 also checked against a second). The first day of Navratri
  for 2028 to 2030 could not be read and is left out until it can be checked.
- **Sharing a photo is the member's own act**, one photo at a time through
  their phone's share sheet. There is still no public link.

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
