# Building Parwah with Claude: the prompt book

Every screen, route and fix in this repository was produced by prompting
Claude Code. This file is the record of those prompts, written so that
someone starting from an empty directory can reach the same place.

It is not a summary of the app. It is the input that produced it.

## How to use it

1. Put **The standing prompt** below into `CLAUDE.md` at the repository
   root, edited for your brand. Claude Code reads it on every turn, so the
   rules in it do not have to be repeated in each prompt.
2. Work the sections in order. Each one is a single Claude Code turn.
3. After every turn, run `npm test`. A section is not finished until the
   gate is green and the section's own checks are in it.
4. Prompts are written to be pasted verbatim. Where a prompt needs a value
   only you have, it is written as `<LIKE THIS>`.

Two habits matter more than any individual prompt here:

- **Ask for the test in the same breath as the change.** Every prompt below
  ends by naming the check to add. A fix without one is a fix that comes
  back.
- **Make Claude run what it wrote.** "Show me the command you ran and its
  output" turns a plausible answer into a verified one. Most of the defects
  in the later sections existed because something was asserted rather than
  executed.

---

## The standing prompt

Paste into `CLAUDE.md`. Everything after this assumes it is in force.

```
# <PROJECT NAME>

## What this is
<One paragraph: who it is for, what it does, what it refuses to do.>

## Hard rules (non-negotiable)
1. Privacy split. Nothing internal ever moves into a public surface.
2. Zero medical or therapeutic claims in any copy. Banned: cure, treat,
   heal, prevent, remedy, therapy, clinically proven, doctor recommended,
   pain relief. Allowed: comfort, support, ease, confidence, independence,
   dignity.
3. Dignity first. Seniors are shown with agency. No pity, no burden
   language, no infantilising imagery.
4. Never store a full Aadhaar, PAN or passport number. Last four only.
   Never a full card number, CVV or PIN. Never a secret key in the browser.
5. Grade-6 reading level for anything a parent reads.
6. Money is always shown in INR and USD at a stated rate.
7. No em dash anywhere in copy. Use a hyphen.
8. The app is one static HTML file with no build step and no framework.
9. At most 12 serverless functions. Underscore-prefixed files in api/ are
   modules, not routes.

## Testing
Run `npm test` after EVERY change. It is the same gate the deploy runs, so
a red tree cannot ship. Never weaken a check to make it pass.

## How I want you to work
- Do not give me output you have not run yourself.
- When you fix something, add the check that would have caught it, and show
  me that check failing against the old code.
- Report honestly. If something is broken, say so with the output.
```

---

## 0. The repository and the deploy gate

Do this first. Everything else depends on a gate that can say no.

```
Set up this repository:

- package.json with no dependencies yet, and three scripts: "test" runs
  scripts/checks.sh, "build" runs the same gate and then copies
  site/public into public/, "test:browser" runs the browser suites.
- scripts/checks.sh: the deploy gate. It must (a) node --check every file
  in api/, (b) run each unit suite in site/tests/, (c) run
  site/tests/test_site.py, and (d) fail the build if api/ has more than 12
  non-underscore .mjs files.
- site/tests/test_site.py: a structural suite using Python stdlib only,
  built around one `check(name, condition)` helper that prints PASS or
  FAIL and exits non-zero if anything failed.
- .vercelignore that keeps private directories, node_modules and .git out
  of every upload.

The gate runs inside the build on a machine that may have nothing
installed, so the unit suites must import only modules that themselves
import nothing.

Then prove the gate works: break one thing it claims to check, show me it
going red, and put it back.
```

That last paragraph is the important one. A gate nobody has seen fail is a
gate nobody should trust.

---

## 1. Sign-in and profile

```
Build phone-first sign-in.

POST /api/auth {action:'enter', phone, cc, name?}
- known number    -> sign in, and return every circle this person belongs
                     to, each with what is waiting in it
- unknown number  -> if a name came with it, create the profile and sign
                     in, in the same step; without one, return exists:false
                     so the app can ask

Rules:
- Normalise to E.164. Put the country-code rules in their own module that
  imports nothing, so the gate can unit-test them before npm install.
- A number that is new must be TOLD it is new, in words, above the name
  box. A field quietly appearing is not news, and a mistyped digit
  otherwise makes a second profile in silence.
- An empty name must be refused out loud, with the cursor put in the box.
  Never repaint the same screen.
- Errors appear where the person is looking. This screen is taller than a
  phone, so scroll the message into view.
- Rate limit sign-in attempts per device. A BACKGROUND REFRESH FOR A
  NUMBER THE APP ALREADY HOLDS IS NOT A SIGN-IN ATTEMPT: give it its own
  budget keyed by number, or three phones in one house will lock the
  household out.

Add unit checks for the phone rules and a browser check that signs a new
number up and a known number in.
```

## 2. Circles: create, join, approve, switch

```
Build circles: a family or a group, created or joined with a code.

POST /api/circle with actions create, join, approve, deny, leave,
update_member, set_code.

Rules:
- An invite code is a doorbell, not a key. Joining raises a request that a
  member approves. Holding the code must never be enough to read anything.
- Custom codes are 4 to 12 characters and unique across all circles.
- Leaving must not destroy records silently. Count what would go with the
  member row, return the count, and refuse until the person has confirmed
  that exact number.
- A person can belong to several circles. Switching between them keeps
  place, country and phone consistent everywhere.

Add a check that a join request does not create a member, and a check
that leaving with records refuses without confirmation.
```

## 3. Home: check-in, SOS, medicines, the feed

```
Build the home screen and its events.

GET /api/events?circle=CODE&member=UUID returns members, the last 50
events, live calls, open SOS, join requests and the pulse.
POST records a check-in, an SOS, a medicine mark or a message.

Rules:
- The GET must verify the caller is a member of that circle. Resolving the
  circle from the code alone hands out every member's phone, date of birth
  and UUID, and the UUID is what the write routes accept as identity.
- Return each event's member_id, or the app cannot tell your own events
  from everyone else's and your own check-in comes back to you as an
  unread notification.
- An SOS is an open state with escalation and acknowledgement, not a line
  in a feed. The escalation claim must fire exactly once however many
  instances poll.
- Notifications go only to the family members involved in that activity.
- Guard the buttons against a double tap: three taps must not send three
  check-ins.
- Every failure has a visible state. A blank home reads exactly like a
  quiet family, which is the most dangerous thing this screen can do.

Add a check that the GET refuses a non-member and one that the escalation
claim is idempotent.
```

## 4. Chat

```
Build chat: one Everyone chat per circle, named groups, and 1:1s.

GET /api/chats?circle&member gives the list with previews and unread
counts; with &chat=UUID it gives that chat's messages.
POST sends, creates a group, or opens a 1:1.

Rules:
- Membership is enforced on every read and every write. A member must not
  be able to read a DM they are not in by passing its id.
- Opening a 1:1 twice returns the same chat.
- Unread counts: your own messages never count; a read cursor belongs to
  one person and moves only their count.
- Message text is rendered through the escaper. See section 19: the
  escaper must escape quotes, because its output goes inside attributes.
- An image message must be a complete base64 data URI, validated whole on
  the server and in the app. A prefix check is not a validation.
- A chat whose messages fail to load must say so. It used to open as a
  blank screen with a working Send box.

Add checks for the unread arithmetic against a written-out fixture, and
for an image URI that starts correctly and then breaks out of an
attribute.
```

## 5. Ekta, the assistant

```
Build the circle's assistant on the Claude API.

POST /api/ekta {code, memberId, messages[]}. Give her tools that read the
circle and the family memory, and tools that create a reminder or a
request through the same consent flow a person uses.

Rules:
- She retrieves; she never diagnoses. No medicine advice, no dosage, no
  interpretation. For any health question she offers to set a reminder or
  raise a request instead.
- Her memory tools must apply the same visibility rule as every other read
  path, or she becomes the way to read a private entry aloud.
- Cascade across model tiers, then across other configured providers.
- A BILLING OR AUTH FAILURE IS A FACT ABOUT THE ACCOUNT, NOT THE MODEL.
  Stop that provider at once instead of buying two more identical
  refusals.
- WHEN NOTHING WILL ANSWER, DO NOT THROW. Most of what she is asked is
  retrieval, and that lives in the database. Run the same tools the model
  would have called and read the rows back, say plainly why, and refund
  the turn. A family must never be shown a crash where an answer was
  possible.
- Provider keys are scoped to the circle that set them. One key per
  deployment means any member of any family can spend another's credit.

Add unit checks for the intent classifier and every rendering of the
offline answer, including that it names what is MISSING and never
diagnoses.
```

For the API itself, ask Claude to load its own reference first:

```
Read the claude-api skill before writing any of this, then use the current
Messages API: the current model ids, adaptive thinking, and streaming for
anything that could run long.
```

## 6. Care: reminders and requests

```
Build the care protocol.

GET /api/care?circle&member returns reminders, open and claimed requests,
and suggestions derived from what the circle has already recorded.
POST covers the full lifecycle: create, claim, complete, cancel.

Rules:
- The GET verifies membership. It used to resolve the circle from the code
  alone.
- A reminder for someone else is a request they are asked about first.
- Suggestions are built from real data and must respect visibility. A
  suggestion that names a private entry leaks it to the whole circle.
- Every state transition names who may make it.

Add a check that suggestions never contain an entry the asker cannot open.
```

## 7. Family Memory

```
Build Family Memory: contacts, addresses, the medicines map, health facts
and insurance, organised around people.

Rules:
- Every entry can be about a person or about the family, carries who wrote
  it and who last touched it, and a last_verified_at. Freshness is a
  feature: stale entries are surfaced, never silently assumed current.
- Private entries are invisible without a grant on EVERY read path,
  including search, preparedness and the assistant.
- A PRIVATE ENTRY'S NAME IS AS PRIVATE AS THE ENTRY. The circle may learn
  that the memory grew; it must not learn what was written.
- Whoever an entry is about owns consent for it, so moving it to a new
  subject is a consent decision and not an edit.
- Sharing takes a target field of its own. Reading both the caller and the
  target from one field makes sharing impossible and the permission check
  meaningless.
- Addresses are real: look the PIN code up against India Post, cache it
  for ever, and store structured fields rather than a blob.

Add checks for each leak path: the feed, the suggestions, the assistant,
and the subject change.
```

## 8. The Vault

```
Build the family vault: documents and payment permissions.

Rules:
- Never store more than the last four digits of any ID, even if the app
  sends the whole number. Verify the Aadhaar checksum with Verhoeff. Do
  not claim to verify PAN's check digit; that algorithm is not published.
- Put the ID rules in one module both the browser and the server import,
  so the field that formats as you type and the route that stores it can
  never disagree.
- Permission is checked on download, not only on listing.
- Every open and every download is written to an audit log.
- Sharing and permitting take a target field of their own, and the app
  writes the caller LAST so no action body can overwrite it.
- Payment methods carry a per-person cap.

Add a browser check that types an Aadhaar and a PAN into the field, and a
check that a member with no grant gets nothing back.
```

## 9. The Day: muhurat, Choghadiya and the rashis

```
Build the day screen: sunrise, sunset, the sixteen Choghadiya windows,
Rahu Kaal, Gulika, Yamaganda, Abhijit, and a daily reading per rashi.

Rules:
- Compute it. No feed, no dependency, no network for the arithmetic, so it
  is deterministic and testable to the minute.
- TAKE THE JULIAN DAY AT MIDNIGHT UTC OF THE DATE ASKED FOR, AND CEIL THE
  DAY NUMBER. A Julian day at midnight ends in .5, so flooring it answers
  for the day before. Consecutive days differ by about a minute, so the
  times still look almanac-shaped and only the date is wrong.
- Take the weekday in the PLACE's timezone. Between midnight and 05:30 IST
  a UTC weekday is yesterday, which is a different Choghadiya sequence
  entirely.
- Abhijit is the eighth of fifteen muhurtas, so day/30 either side of
  noon, not day/8.
- Explain every part in plain words. A parent who has kept Choghadiya all
  their life does not need it explained; their grandchild in London does.
- A sun sign is not a rashi. Say which one you are showing and why.
- A reading that did not arrive says so. Never invent one.

Test against a published almanac for two cities, and assert THE DAY ASKED
FOR IS THE DAY ANSWERED. Regenerate the Choghadiya tables from the
Chaldean planetary order and check the shipped tables match.
```

## 10. Fun: games, the pulse, the board

```
Build the games.

Rules:
- A circle can have SEVERAL games at once, including two of the same kind.
  The tab opens on the LIST, ordered by what each game asks of you: your
  turn first, then games you are in, then the rest.
- Two games of one kind are told apart by the number they were started as.
  Number from the highest still running, not from the count, or ending the
  first game makes a later one collide.
- Single player is first class. The opponent is a player like any other,
  marked as the app, so every rule stays the same. A game played alone is
  announced to nobody.
- Dice are rolled on the server.
- The pulse is one question a day for the whole family, answerable once,
  replaceable, and the same question for everyone.

Add a browser check that runs four games at once and opens the second of
two same-kind games.
```

## 11. Plans and pricing

```
Build plans: get-togethers of every kind, with RSVP, and a video room for
call-type plans. Render every plan in each member's own timezone.

Pricing is INR and USD at a stated fixed rate, everywhere money appears.
There is no commerce here: a reservation records intent, it does not take
money.
```

## 12. The Emergency card

```
Build one screen a stranger could act on: who to call, blood group,
allergies, medicines, the doctor and the hospital.

Rules:
- Every field comes from what the family recorded. What is missing is
  shown as missing. An incomplete card that LOOKS complete is worse at a
  hospital counter than no card.
- A private health fact must not appear here for someone without a grant.
- The numbers are tel: links, the type is large, and it survives the API
  being down.
- India's numbers are 112 and 108. They are not medical advice.
```

## 13. Together: calls, photos, mentions

```
Build the instant family call, a photo from the camera into a chat,
@mentions, and inviting by the native share sheet with a fallback.

Rules:
- A room name must not be guessable, and the link is posted only to
  members.
- A photo is a validated data URI with a size cap, visible only in the
  chat it was sent to.
- A mention notifies the person mentioned and nobody else.
```

## 14. The people screens

```
Build the family as PEOPLE rather than as features: the family list, one
person with their sections, a readiness number, member profiles and
editing your own.

Rules:
- The readiness number is computed from facts actually recorded and is
  honest about what it counts.
- A person screen shows only what the viewer may see.
- Editing your profile CARRIES THE COUNTRY CODE WITH THE NUMBER. Posting
  bare local digits lets the server default them to +91 and locks a
  non-Indian person out of every circle. Compare like with like, or a
  name-only edit rewrites the number.
```

## 15. Ekta by voice

```
Add speech in and speech out.

Rules:
- On a browser with no SpeechRecognition the control explains itself
  rather than disappearing or throwing.
- A denied microphone gets a message, not a console error.
- Hindi and Indian English both.
- Never autoplay audio nobody asked for.
```

## 16. The app shell: theme, senior mode, navigation

```
Build the shell.

Rules:
- Light and dark on EVERY element. Define the complete light palette on
  bare :root, redefine only the tokens under prefers-color-scheme guarded
  so an explicit light choice wins, and again under [data-theme="dark"].
  Never give a colour its only definition inside a media or theme block.
- CHECK EVERY TOKEN IN BOTH THEMES. A card that used a light-text token as
  its BACKGROUND with the text token as its colour painted white on white
  in dark, and a whole five-card introduction was invisible.
- Tap targets 44 by 44 for anything a senior touches. Text-button styles
  with padding:0 are how nineteen controls end up sixteen pixels tall.
- SWITCHING A TAB PUSHES HISTORY. Replacing it means the Back button
  leaves the app however deep you are. Listen for popstate, and inside a
  chat or a game step out to the list first.
- The desktop uses the width it has. The sidebar shows which feature you
  are on, and that mark is on screen.
- Senior mode is more than two CSS rules.

Add browser checks that measure contrast in both themes and every tap
target, and that walk Back and Forward through the tabs.
```

## 17. The public pages

```
Build the landing page, the advertorial, and the launch list.

Rules:
- No medical claims, checked by the test suite against a banned-word list.
- Security headers on every response.
- A form ships only when a real backend receives it. No fake forms.
- Dual currency anywhere money appears.
```

## 18. The platform

```
Harden the shared layer.

- One schema function that every route calls, using create table if not
  exists and add column if not exists, so a deploy needs no migration step.
- One guard that says the caller must be a member of the circle, used by
  every route that reads circle data.
- A rate limiter that counts across instances, keyed per bucket.
- Method checks, body size limits, and a JSON parse failure that returns a
  message rather than a stack.
- One diagnostics route behind a query parameter, so related probes share
  a function slot instead of each burning one.

Then the honest question, which you should ask early rather than late:

  There is no session token in this app: every write route identifies the
  caller by a member UUID the client sends, and those UUIDs are handed to
  every other member. Show me what an ordinary member can do to another
  member's data with only what their own screen already gives them. Then
  propose the smallest change that closes it.
```

---

## 19. The audit harness

This is how the defects in the sections above were found. Run it against
your own build; it does not care whose code it is.

Per feature area, one agent:

```
You are auditing ONE feature area of this app for launch readiness. Be
exhaustive and concrete. Read the actual code; do not assume.

FEATURE AREA: <name>
FILES TO READ, ALL OF THEM, FULLY: <server files; the client identifiers
to grep for; the tests that cover it>
WHAT TO CHECK HARDEST: <the specific risks>

METHOD
1. Read every listed file end to end, following calls.
2. Trace each user flow from the button to the SQL and back. For every
   server action ask: is the caller authorised, is the input validated,
   what does a wrong input return, what does the person see.
3. RUN WHAT CAN RUN. node --check each file, the unit suites, the browser
   suites, and where you are unsure write a throwaway Playwright script
   that stubs the API and exercises the flow. Record every command you ran
   and its outcome.
4. Compare what the self-test ASSERTS for this area against what the route
   actually does. A self-test that tests a different query than the route
   is itself a finding.
5. Report a finding only when you can quote the code or the output that
   shows it. No speculation, no style opinions, no "consider adding". If
   the feature has no defects, say so; do not invent work.

Return: ready true or false, a summary, the commands you ran, and for each
finding a title, a severity, file and line, the claim in one sentence, a
concrete failure scenario, the evidence, a suggested fix, and the test to
add.
```

Then, and this is the part that matters, try to knock each finding down:

```
You are a skeptical reviewer trying to REFUTE the findings of an audit.
Your lens: <correctness | reproduce | impact>.

correctness: read the code at and around every cited location and along
its call path. Is the claim literally true of THIS code? Look for a guard,
a default, a constraint, or a later step that makes the scenario
impossible.

reproduce: try to make each one happen. Write a throwaway script. If you
cannot reproduce it and cannot show why not, it is refuted with low
confidence.

impact: assume it is true. Would a real family hit this, and what would it
cost them? Refute if it needs access nobody has or a state the app cannot
reach.

Work through every one. Skipping a finding is not a verdict. Return one
verdict per finding, with the code or output you relied on.
```

A finding that survives two independent refuters is worth fixing. One that
does not is worth deleting, and deleting it is the point: an audit that
cannot say "no" produces a list nobody works through.

## 20. The user-experience walk

The audit reads code. This one uses the app.

```
You are rating ONE feature for ease of use, presentation, flow and
navigation, by USING it in a real browser. You are the user researcher,
not a code reviewer: what you SAW is the evidence.

Stub the API with Playwright the way the existing browser suites do, with
realistic data.

WALK IT FOUR WAYS: phone light, phone dark, desktop light, desktop dark.

For each walk:
1. Screenshot every step of the primary flow and READ each screenshot with
   your own eyes. Describe what you see. Do not rate from the DOM.
2. Count taps from the tab bar to task complete. Note every moment you had
   to guess.
3. Try to break it: submit empty, submit wrong, go back mid-way, reload
   mid-way, deny a permission, make the API return an error and an empty
   list. Every state must say something.
4. Measure: tap target sizes, body font size, and the contrast ratio of
   every status colour against its real background in both themes.
5. Check navigation: can you reach this from every tab in two taps; does
   Back behave; does a deep link land; does the header say where you are.

Rate 1 to 5 on implementation, presentation, ease of use, flow and
navigation. THE BAR FOR A 5: a 68-year-old parent on a phone and their
adult child on a laptop each complete the primary task first try, with no
help, and always know where they are. Every point lost must correspond to
a finding with a screenshot and a specific fix.
```

## 21. Fixing, without breaking

```
Fix these confirmed defects.

<the findings, with file, line, claim, scenario and suggested fix>

How to work:
- Keep every fix minimal and local. Do not refactor, rename or restyle
  anything the fix does not need.
- For each fix, add a test that FAILS BEFORE AND PASSES AFTER, and show me
  it failing against the old code.
- Never disable or weaken an existing test to get green. If a fixture
  disagrees with the fix, work out which one is wrong before you touch it:
  a fixture calibrated against a bug is how an off-by-one-day error sat
  under 73 passing checks.
- Run npm test and make it green. Then run the browser suites.
- If a finding cannot be fixed safely in scope, skip it and say why.
```

## 22. Deploying, and knowing that it worked

```
Write ops/deploy.sh: fetch, fast-forward, run the gate, deploy straight to
production, then PROVE IT against the live database.

The verification is the part people get wrong, so put it in its own script
that can be tested against a fake server that answers red.

- Do not fetch with `curl -f`. A red self-test answers with HTTP 500 and
  the body IS the diagnosis; -f throws that body away, so a real failure
  arrives as an empty string and is reported as "not serving yet".
- Follow redirects, or a trailing-slash rule looks like a broken build.
- Three answers, three meanings, never conflated: nothing serving yet, a
  self-test that failed and named its step, and something that is not the
  self-test at all.
- Name the failing steps on the FIRST red attempt, not after giving up.
- Say what it is doing every time round. A silent wait looks exactly like
  a hang, and someone will press Ctrl-C over a red self-test.

Then test the red path against a fake server, because a check that cannot
report a failure is not a check.
```

---

## What to ask for that is easy to forget

These are the prompts that produced the largest corrections here, kept
together because none of them is obvious until after it has cost you.

```
Show me the command you ran and its exact output.
```

```
Is that assertion actually exercising the thing it names, or would it pass
against a different implementation too?
```

```
This test passes. Prove the code is right rather than the test being
calibrated to the bug.
```

```
Take one screenshot of this in dark mode and tell me what you see.
```

```
What does a person see when this request fails? Show me that screen.
```

```
Who is allowed to call this, and what stops anyone else?
```

```
You just told me it is fixed. Deploy it, hit it in production, and paste
what came back.
```
