# Parwah design language system (DLS)

Parwah is the family superapp: care tasks, check-ins, SOS, chat, family
memory, documents, the day and games, in one private circle. Its people range
from a teenager to a grandparent, so the system is built for the older hand
and eye first. Everything below is enforced: `site/tests/test_site.py`
("dls:" checks) fails a raw value, and `site/tests/browser/design.browser.mjs`
measures every screen at 320, 390 and 1280px in light and dark.

## Principles

1. **Dignity first.** Parents are people with agency, never "elderly" or a
   "burden"; nothing reads as surveillance. No medical claims.
2. **One-handed phone first.** Built at 320-390px; the desktop layout (900px+)
   is a wider arrangement of the same components, never a different product.
3. **Legible for every age.** No text under 12px, body text 16px, WCAG AA
   contrast in both themes, every control at least 44px on touch.
4. **Tokens, not values.** A component never names a colour, size, corner,
   layer or duration directly. A new need is a new token, reviewed.
5. **Both themes, always.** Every colour token has a dark value; nothing is
   designed in one theme and left to chance in the other.

## Tokens (defined once, in `:root` of `site/public/index.html`)

### Colour
Semantic, not literal: `--ink`, `--ink-soft` (text), `--day`, `--surface`,
`--surface-2`, `--bone`, `--bone-2` (grounds and lines), `--dusk`, `--pine`
(dark panels), `--marigold`, `--sindoor` (brand accents), `--ok`, `--alert`,
`--tint-*` (status fills), `--on-accent`, `--on-dark` (text on accents),
`--focus-ring`, `--focus-halo` (keyboard focus), `--card-*`, `--tok-ring`
(playing cards and game pieces, the same in both themes). Each has a dark
value in both dark blocks.

### Spacing: a 4pt grid
| Token | px | Use |
|---|---|---|
| `--space-2` | 2 | hairline gaps, badge offsets |
| `--space-4` | 4 | icon to its label, inside a pill |
| `--space-8` | 8 | between parts of one component |
| `--space-12` | 12 | between related elements, row gaps |
| `--space-16` | 16 | card padding, field padding, section inset |
| `--space-20` | 20 | between cards on a phone |
| `--space-24` | 24 | between sections |
| `--space-32` / `-40` / `-48` | 32-48 | page-level separation, indents |

Layout sizes of 56px and more (bar heights, reserved space above the tab bar)
are layout, not rhythm, and may be written directly or derived with `calc()`.

### Type ramp
| Token | px | Role |
|---|---|---|
| `--fs-12` | 12 | captions, eyebrows, field labels, tab labels, timestamps |
| `--fs-14` | 14 | secondary text, buttons, list detail |
| `--fs-16` | 16 | body, inputs (16 stops iOS zooming into a field) |
| `--fs-18` | 18 | card titles, icon glyphs in bars |
| `--fs-20` | 20 | section titles |
| `--fs-24` | 24 | screen titles, game glyphs |
| `--fs-30` / `--fs-36` | 30-36 | hero numbers and names |
| `--fs-48` | 48 | display |

Fluid display headings may use `clamp()` built from the ramp.

### Corners
`--radius-2`, `-4` (tiny marks), `-8` (small controls, cells), `-12` (buttons,
inputs, rows), `-16` (cards), `-20` / `-24` (sheets, heroes), `--radius-pill`
(chips, primary buttons, toggles). Circles use `50%`.

### Layers (lowest to highest)
`--z-raised` 1, `--z-above` 2, `--z-bar` 5, `--z-inputbar` 6, `--z-fab` 7,
`--z-tabs` 8, `--z-toast` 9, `--z-sos` 12, `--z-menu` 20, `--z-sheet` 25,
`--z-drawer` 30, `--z-coach` 60, `--z-fx` 99. A new layer is a new named
token placed in this order, never a number in a component.

### Motion
`--motion-fast` 150ms (press, hover), `--motion-base` 250ms (state change),
`--motion-slow` 400ms (entrances). Everything animated honours
`prefers-reduced-motion`.

### Interaction
`--tap-min` 44px on touch layouts, 36px on the desktop layout (900px+, where
it is a mouse pointer; WCAG AA asks for 24). `--avatar-sm` 32px. Focus: one
ring for everything, `outline: 3px solid var(--focus-ring)` with a
`--focus-halo` shadow, so it shows on light cards and dark bars alike.

## Atomic inventory

**Atoms** - the smallest pieces, each with every state (default, hover,
focus, active, disabled; loading where it acts).
- Buttons: primary `.go` (one per view), secondary `.cbtn`, quiet
  `.cbtn.ghost`, destructive `.cbtn.no`, text `.linkbtn`, icon (bar buttons,
  `.x` close), floating `.fab`.
- Inputs: text, date, time, number, `select`, `textarea`, checkbox chip
  `.gchk`, file.
- Marks: `.badge`, `.gturn` (turn pill), `.dot` (counter), `.metile`
  (avatar), `.eyebrow` (section label), `.hint` (helper text), status border
  (`.crow.late`, `.crow.urgent`).
- Game pieces: `.pcard` (playing card), `.ltok` (Ludo token), `.vdot`.

**Molecules** - atoms that work as one.
- Segmented control `.seg` / page tabs `.pageseg`; sub-tabs `.subnav`.
- Field `.pick` (label + input), field grid `.pickrow` (two columns that can
  shrink).
- List row `.crow` (text + one next action), chat row `.chatrow`, task title
  `.tlink`.
- Member picker `.members` of `.gchk`, widget tile `.widget`, seat `.bseat`,
  calendar header `.calhead`, toast `.toast`.
- Form fold `details.fmore` ("More options: ..."): the fields most people
  leave empty (notes, second dates, bank, monthly cap, place, how many).
  The summary names what is inside. It opens by itself when anything in it
  is set (editing, or arriving from a person) and when a field in it is
  refused, so a set value or an error is never hidden. Long lists show three
  and fold the rest (`.suggmore`).
- Field error `.fielderr`: the reason a box was refused, right under it,
  with `aria-invalid` on the box. A refused form says so here, not in a toast.
- SOS button `.sosfab` (every screen: a floating circle on a phone, a full-width control at the bottom of the sidebar on a laptop), SOS screen `.sosscreen`,
  alarm `.sosalert`, their buttons `.ss-btn`. Emergency red `--sos` is for
  these only.
- Find a phone `.findscreen`: the ring (`#ringscreen`) and Lost mode
  (`#lostscreen`) take the screen like an alarm, in `--pine`, which is dark
  in both themes, with marigold for the one main action. They reuse
  `.ss-in` and `.ss-btn`, never SOS red.

**Organisms** - sections of a screen.
- Top bar `.bar` (sticky on phones), bottom tab bar `#tabs` / desktop
  sidebar, drawer `#drawer`, account menu `.memenu`.
- Card `.card`, hero `.homehero`, feed `.feed`, composer `.inputbar`.
- Sheets `.msheet > .mp`: member, task, new chat, emergency card.
- Game boards: Ludo `.lboard`, Vyapar `.vboard`, Tic-Tac-Toe `#tboard`,
  Saanp Seedhi, Bhabhi table.

**Templates**
- Screen: title (or `.ektahead`), optional `.pageseg`, subsections of cards,
  reserved space above the tab bar so the last card clears the floating
  buttons.
- Sheet: close button, eyebrow state, title, facts, actions, history.
- Sign-in: superapp eyebrow, heading, three reasons, one form.

**Pages** - Today, People and Person, Memory, Vault, Care, The day, Chat,
Ekta, Together (plans, games, board), Profile, Notifications, Sign-in.

## Adding or changing a component

1. Reuse an atom or molecule; a near-duplicate is a finding, not a feature.
2. Build it only from tokens; if a token is missing, add it here and in
   `:root` first.
3. Design every state, the empty and error states, and both themes.
4. Run `npm test` (the "dls:" lint) and `npm run test:browser` (the design
   suite measures overflow, tap targets, text size, contrast and focus).
5. Fill in the design checklist in the pull request (`CHECKLIST.md`).
