# parwah-hq — Parwah monorepo

Single private repository for Parwah (परवाह).

- `hq/` — internal command console (strategy, PRD, live financial engine, master prompt,
  brand axis, asset map). **Never deployed publicly.** Open `hq/index.html` locally, or
  deploy only behind Vercel Authentication.
- `site/` — public pre-launch site (brand home + Story Page 01 + launch-list capture).
  Deploys via Vercel with Root Directory = `site`.

Rules, design system, and the ordered backlog: see `CLAUDE.md`.
Run tests after any site change: `python site/tests/test_site.py`
