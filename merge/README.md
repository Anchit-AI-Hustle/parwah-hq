# Staging for the brand merge

This is the source of the former `Anchit-AI-Hustle/parwah-site` repository,
which was deleted from GitHub. It is kept here because the decision was
taken to merge the two Parwah brands into one product, so this copy is
the only surviving record of the D2C senior-products site.

**Nothing in this directory is live.** It is outside `site/public`, so the
build never serves it, and it is listed in `.vercelignore`, so a deploy
never uploads it. Gate checks enforce both.

It is staging material, not the site. Copy under `parwah-site/` has not
been through this repository's claims guardrails, which are stricter in
some places than the ones it was written against and looser in others.
Do not move a file from here into `site/public` without taking it through
the merged banned-claims list first.

## What is here

| Path | What it is |
|---|---|
| `parwah-site/index.html` | Brand home for the products half, plus a launch-list form wired to a Supabase project that was never created |
| `parwah-site/story/index.html` | The advertorial, "The day you notice" |
| `parwah-site/CLAUDE.md` | The rules the copy was written against, including the dignity-first voice rules this repository did not have |
| `parwah-site/tests/` | Its own test suite, superseded by `site/tests/` |
| `parwah-site/supabase/` | The waitlist table and RLS, for a project that does not exist |

## What happens to it

The words move into the merged site, the markup does not: that site used
one inline style block per page, this one uses shared tokens in
`site/public/styles.css`. Once the copy has been re-authored and is live,
this directory is deleted.
