# parwah-hq - Parwah monorepo

Single private repository for Parwah (परवाह) - *Apni family ki parwah karein.*
Know what your parent needs, who is handling it, and when it is done.

- `hq/` - internal command console (strategy, PRD, financial engine, master prompt,
  brand axis, asset map). **Never deployed publicly.** Open `hq/index.html` locally, or
  deploy only behind Vercel Authentication.
- `site/public/` - the app, served at the root of the domain (`index.html`, one file),
  plus the public pages beside it.
- `api/` - serverless functions (Vercel, at most 12; files starting with `_` are shared
  modules, not functions) on Neon Postgres. Every call is checked by `requireMember`:
  the circle, the member, and the signed-in session must all match.
- `mobile/` - the thin phone shell (Floot) that shows the live app.

Rules, design system, and the ordered backlog: see `CLAUDE.md`.

## Family tasks

A task is a row in `requests` (`api/_tasks.mjs`), with a lifecycle:

| Status | Meaning | Who can move it |
|---|---|---|
| `open` | nobody has it | anyone takes it ("I'm on it") |
| `assigned` | given to one person, waiting for their yes | only that person says yes or hands it back |
| `claimed` | someone has it | they finish it or hand it back; the asker can also close it |
| `done` | finished: who, when, optional note | the asker, the holder or the finisher can reopen it |
| `archived` | put away, history kept | - |

The asker and the holder can edit it, give it to someone else, or put it away. Every
step is in `task_log`, shown as "What happened" on the task.

- **Time.** `due_at` is stored in UTC with the family's time zone (`tz`). A date with no
  time means "by the end of that day" at home. Screens show local time.
- **Repeats.** Once, daily, weekly, monthly (`api/_recur.mjs`, computed on the family's
  own clock: 9:00 stays 9:00 when clocks change; the 31st becomes the 30th or 28th in
  short months). Finishing one makes exactly one next occurrence, never in the past -
  guarded by a conditional update and a unique index on `(series_id, due_at)`.
- **Running late.** Checked whenever any phone opens Care or polls the feed
  (`sweepOverdue`). One conditional `UPDATE ... set overdue_alerted_for = due_at` claims
  each alert, so it is sent once per occurrence however many phones look at once. It
  goes to the holder and the asker, or to everyone when nobody has it or the family
  chose "tell everyone". Push and the in-app feed only: no SMS or WhatsApp is sent.
- **The screen.** Care shows Needs attention (late, or waiting for your yes), Today,
  Coming up, and Done in the last few days. Tapping a task opens its details, the next
  step, and its history.
- **Health data.** Titles are free text; the form asks for no medical detail
  ("Papa's 9 pm tablets" is enough).

## Tests

Run all of these before any push; CI runs the same.

```sh
npm test                                   # the deploy gate: syntax, unit tests, site checks
bash ops/vercel-input.sh                   # the gate again, on exactly the files Vercel receives
npm i --no-save playwright-core@1.49.1 pg@8
CI=1 npm run test:browser                  # screens in a real browser (PW_CHROMIUM=... to reuse one)
PARWAH_TEST_DATABASE_URL=postgres://postgres@localhost:5432/parwah_test npm run test:db
```

`test:db` wipes the database it is given (the name must end in `_test`) and runs the real
handlers against it: sign-in and lockout, the task lifecycle and its permissions,
repeats, one-time late alerts, and the care screen end to end in a browser.

## Building this with Claude

Every screen, route and fix here was produced by prompting Claude Code.
The prompts are in [docs/PROMPTS.md](docs/PROMPTS.md), written so someone
starting from an empty directory can reach the same place: the standing
rules to put in `CLAUDE.md`, one prompt per feature, the audit and refute
passes that found the defects, the user-experience walk, and the deploy
verification. The test suite holds the book to the app, so it cannot drift
into describing something this repository does not do.
