# parwah-hq — Parwah monorepo

Single private repository for Parwah (परवाह).

- `hq/` — internal command console (strategy, PRD, live financial engine, master prompt,
  brand axis, asset map). **Never deployed publicly.** Open `hq/index.html` locally, or
  deploy only behind Vercel Authentication.
- `site/` — public pre-launch site (brand home + Story Page 01 + launch-list capture).
  Deploys via Vercel with Root Directory = `site`.

Rules, design system, and the ordered backlog: see `CLAUDE.md`.
Run tests after any site change: `python site/tests/test_site.py`

## Building this with Claude

Every screen, route and fix here was produced by prompting Claude Code.
The prompts are in [docs/PROMPTS.md](docs/PROMPTS.md), written so someone
starting from an empty directory can reach the same place: the standing
rules to put in `CLAUDE.md`, one prompt per feature, the audit and refute
passes that found the defects, the user-experience walk, and the deploy
verification. The test suite holds the book to the app, so it cannot drift
into describing something this repository does not do.
