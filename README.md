# Parwah HQ

**PARWAH** is an India D2C brand of senior daily-living products — ortho comfort,
bathroom safety, daily living aids, senior nutrition, and later adaptive wear.
Dignity-first: *"They took care of you. Take care back."*

This is a **PRIVATE** repository. It carries the Build & Growth System master
prompt and operating rules. Per the operating rules, this prompt, HQ financials,
and supplier terms must never land in a public-facing repo.

## Contents

| Path | What it is |
|---|---|
| `MASTER_PROMPT.md` | Master Prompt v2.0 — the single source of truth for any AI session running a phase of the Parwah build. Paste it whole into a fresh session. |
| `site/index.html` | Minimal pre-launch placeholder page, live at <https://parwah-hq.anchit-tandon.com> (Vercel project `parwah`). Contains no internal content. |

## Linked infrastructure

- **Vercel** — team "Anchit's AI Hustle": project `parwah`, serving `site/` at
  the canonical URL <https://parwah-hq.anchit-tandon.com>.
- **Supabase** — org "Anchit's AI Hustle": project `Parwah` (waitlist / light data, created when a trigger fires).
- **Commerce** never lives here — Shopify only.

## How to use

1. Open a fresh Claude / Cowork / Claude Code session.
2. Paste the entire contents of `MASTER_PROMPT.md`.
3. Tell it which phase (P0–P6) to run. If unspecified, it starts P0 step 1 and
   stops for approval.
