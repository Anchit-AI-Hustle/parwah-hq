## What this changes


## Why


## Tests run on this head
- [ ] `npm test`
- [ ] `bash ops/vercel-input.sh`
- [ ] `CI=1 npm run test:browser` (includes the design suite)
- [ ] `npm run test:db` (when the API or database changed)
- [ ] Vercel preview checked

## Design sanity (docs/design/CHECKLIST.md)
Skip only when nothing anyone sees or does has changed, and say so.
- [ ] Built from existing atoms and molecules; only tokens
- [ ] 4pt spacing; one primary action per view; nothing scrolls sideways at 320px
- [ ] Type from the ramp, nothing under 12px; copy has no em or en dashes and stays dignity-first
- [ ] WCAG AA in light and dark; status not by colour alone
- [ ] 44px touch targets (36px desktop); focus ring visible; labels on icon-only controls
- [ ] States: default, hover, focus, active, disabled, loading, empty, error, offline
- [ ] Nielsen quick pass done; screenshots attached (phone light, phone dark, desktop)
