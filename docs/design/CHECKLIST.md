# Design sanity checklist

Run on every change that touches what someone sees or does. Items marked
**(gate)** fail the build on their own; the rest are a designer's judgement
and are ticked in the pull request (the template carries this list).

## 1. System
- [ ] Built from existing atoms and molecules (`DESIGN_SYSTEM.md`); nothing near-duplicated.
- [ ] Only tokens: colour, spacing, type, radius, layer, motion **(gate)**.
- [ ] Any new token is added to `:root` and documented, with a dark value if it is a colour **(gate)**.

## 2. Layout and spacing
- [ ] Spacing on the 4pt grid; related things closer than unrelated things.
- [ ] One primary action per view; secondary actions visibly quieter.
- [ ] Nothing scrolls sideways at 320, 390 or 1280px **(gate)**.
- [ ] The last item clears the tab bar and the floating buttons.

## 3. Type and content
- [ ] Sizes from the ramp; no text under 12px **(gate)**.
- [ ] Hierarchy reads in three levels at most on a card: title, detail, action.
- [ ] Copy: no em or en dashes **(gate)**; dignity-first; no medical claims; plain words over system words.
- [ ] Labels say what happens ("Mark it done"), errors say how to fix it.

## 4. Colour and contrast
- [ ] WCAG AA contrast for all text in light and dark **(gate)**.
- [ ] Status never by colour alone (a word or icon with it).
- [ ] Checked in both themes by eye, not only by the suite.

## 5. Touch, keyboard, screen readers
- [ ] Every control at least 44px on touch, 36px on desktop **(gate)**.
- [ ] Every focused control shows the focus ring **(gate)**.
- [ ] Icon-only controls have an `aria-label`; dialogs have a label and close on Escape.
- [ ] Motion respects reduced motion.

## 6. States
- [ ] Default, hover, focus, active, disabled.
- [ ] Loading, empty, error, success, offline.
- [ ] Permission: what someone may not do is hidden or explained, never a dead button.

## 7. Heuristics quick pass (Nielsen)
- [ ] Status is visible  - [ ] Real-world words  - [ ] Easy to undo or leave
- [ ] Consistent with the rest of Parwah  - [ ] Errors prevented  - [ ] Nothing to remember
- [ ] Shortcuts for the frequent  - [ ] Nothing extra on screen  - [ ] Errors explain the fix
- [ ] Help where it is needed

## 8. Evidence
- [ ] Screenshots: phone light, phone dark, desktop.
- [ ] `npm test` and `npm run test:browser` pass.

## Leader review (for a new screen, a new pattern, or a release)
| | |
|---|---|
| Reviewer | |
| Date | |
| Scope | |
| Heuristic scores (0 fine - 4 blocker) | |
| Must fix before release | |
| Follow-ups, with owner | |
| Verdict | Approved / Approved with follow-ups / Changes needed |

Record every leader review in `REVIEWS.md`.
