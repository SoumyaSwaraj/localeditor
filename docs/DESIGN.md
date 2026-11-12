# LocalEditor design language

One page for everyone building UI. Tokens live in `assets/css/app.css` (section 1). The studios, tool pages, about, 404, recipes and convert pages all read them. **Never rename or remove a token or a shared class**; `studio.css` and `pdf-studio.css` depend on them. Add new ones instead.

## Principles

1. **Ink and paper do the work.** Warm paper background, near-black ink, hairlines. Colour is a signal, not decoration.
2. **One gold action per screen.** Gold foil (`.btn-gold`) is the primary action only: Open, Download, Save. Its text is always ink `#2A1F0A`.
3. **Amethyst means "on".** Focus rings, selected states, sliders, links in running text, the active step. Never as a page background or a large fill.
4. **Show the real thing.** Real UI, real photos, real files. No fake numbers, gauges or testimonials.
5. **Phone first.** Design at 360 px, then 390, 820 and 1440. Touch targets are at least 44 px. Nothing scrolls sideways.
6. **Calm motion.** Short, specific, and off under `prefers-reduced-motion`.

## Tokens

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F6F3` | `#0F0E13` | Page |
| `--bg-2` | `#EFEDE8` | `#15141A` | Pressed / hover on bg |
| `--surface` | `#FFFFFF` | `#18171D` | Cards, panels, fields |
| `--surface-2` | `#F3F1ED` | `#211F27` | Inset areas, chips, icon tiles, hover |
| `--ink` / `--text` | `#16131C` | `#F2EFE9` | Headings, body, icons |
| `--muted` | `#5E5967` | `#ABA5B4` | Secondary text (≥ 6:1) |
| `--faint` | `#6E6876` | `#8E8898` | Meta, counts, eyebrows in lists (≥ 4.7:1) |
| `--line` | ink 8% | white 8% | Hairlines, card borders |
| `--border` / `--border-hover` | `#E3E0DA` / `#CBC6BE` | `#2D2B34` / `#45424E` | Field and button borders |
| `--accent` | `#5B3FD9` | `#B3A1FF` | Amethyst as **text** (links, selected labels) |
| `--accent-soft` | amethyst 10% | 14% | Selected row, field focus halo |
| `--focus-ring` | `#6A4FE8` | `#A893FF` | `:focus-visible` outline |
| `--amethyst` / `--amethyst-2` | `#7457F0` / `#4E36C9` | same | Fills: sliders, toggles, selection boxes |
| `--foil` | `#F3CC7C → #E2B15A` | same | Primary button, brand mark |
| `--gold-ink` | `#2A1F0A` | same | Text and icons on gold (8.2:1) |
| `--side` | `#141318` | same | Ink chrome: studio header and rail, toast, closing band |
| `--ok` `--warn` `--err` | `#1B7F54` `#8A5A06` `#B42318` | `#4CC08D` `#E2B15A` `#F07A6E` | Status only |

Supporting hues (`--sapphire`, `--jade`, `--rose`, `--copper`) are for user content, swatches and the `.ic` category tiles. Not for page chrome. `--aurora` (the purple-pink-gold gradient) is kept for compatibility; do not use it in new work.

### Type

Plus Jakarta Sans for UI and headings; Instrument Serif *italic* for one accent phrase per heading (`<em>` inside `h1`/`h2`, or `.serif`). Never set body copy in the serif.

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 12 | Eyebrows (uppercase, 0.1em tracking, 650–700), captions |
| `--text-sm` | 14 | Secondary UI, chips, nav |
| `--text-md` | 16 | Body (line-height 1.55). Inputs are 16 px on phones so iOS does not zoom |
| `--text-lg` | 18 | Lead paragraphs |
| `--text-xl` | 22 | Card titles, `h2` in tool pages |
| `--text-2xl` | 28 | Section titles on phone |
| `--text-3xl` | 36 | Section titles on desktop |
| `--text-4xl` | 48 | Page titles |
| `--text-5xl` | 68 | Homepage hero only |

Headings: weight 650–720, tracking −0.015em (h3) to −0.045em (display). `text-wrap: balance` on headings, `pretty` on paragraphs. Numbers that change use `font-variant-numeric: tabular-nums`.

### Space, radius, elevation, motion

- **Space** (4 px base): `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48 · `--s-16` 64 · `--s-20` 80 · `--s-24` 96. Page gutter `--gutter` is 16 / 24 / 32 at <720 / ≥720 / ≥1100. Content max `--page-max` 1200.
- **Radius**: `--r-xs` 6 (kbd, thumbs) · `--r-sm` 10 (icon tiles, fields, rows) · `--r-md` 14 (inner cards, panels, dropzones) · `--r-lg` 20 (cards, dialogs) · `--r-xl` 28 (feature cards) · `--r-pill` (buttons, chips). Legacy `--radius` = 20, `--radius-sm` = 14, `--radius-xs` = 10.
- **Elevation**: `--shadow-xs` (resting cards, buttons) · `--shadow-sm` (hover, selected segment) · `--shadow` (floating cards, code) · `--shadow-lg` (dialogs, drawer, popovers). Prefer a hairline (`1px solid var(--line)`) to a shadow.
- **Motion**: `--dur-1` 120 ms (hover, press) · `--dur-2` 200 ms (toggles, fades) · `--dur-3` 320 ms (drawers, sheets). Easing `--ease-out` for entrances, `--ease` for state changes. Press = `scale(0.98)`. Everything collapses under `prefers-reduced-motion`.

## Components

- **Buttons** `.btn` (44 px, pill, surface, border) · `.btn-gold` / `.btn-primary` (one per screen, ink `#2A1F0A`) · `.btn-ghost` (no fill) · `.btn-ink` (secondary emphasis) · `.btn-link` (text + arrow) · sizes `.btn-sm` (36 px; 44 px on touch outside the studios) and `.btn-lg` (52 px). Always style gold through the class, and check the computed colour: a broad `button { color: inherit }` has overridden it before.
- **Fields** `.input` `.select` `.textarea`: 44 px, `--r-sm`, focus = amethyst border + `--accent-soft` halo. Labels 13 px / 640 above the field.
- **Segmented** `.seg` with `button[aria-pressed]`: inset track, the selected segment is a raised surface (not a black pill).
- **Chips** `.chip` (`button.chip` is 40 px tall; pressed = ink fill). **Badges** `.badge`, `.badge.ok`, `.badge.warn`.
- **Cards** `.card`: surface, hairline, `--r-lg`, padding 20 → 24. No gradient borders, no grain.
- **Icon tiles** `.tool-card .ti` and `.hp-tool-ic`: neutral `--surface-2` with ink glyph. `.ic .ic-<hue>`: flat solid tile with a white glyph (studios only).
- **Range**: native with `accent-color: var(--amethyst)` on tool pages; the studios use their own amethyst-fill track with a white thumb, which is the reference.
- **Focus**: every interactive element shows `:focus-visible` as a 2 px `--focus-ring` outline, offset 2 px. Never remove it without a replacement.
- **Shell** (from `app.js`): sticky header (brand, section links at ≥1100, search field at ≥640 / icon below, theme, menu, gold "Open studio" at ≥1100) and a right-hand drawer `.le-side` at every width (the PDF studio and Convert pages pin it to the left). The drawer holds Install (`[data-le-install]`), Storage (`[data-le-storage]`), theme and privacy. Escape closes it; focus moves in and returns to the menu button.

## Do / don't

| Do | Don't |
|---|---|
| One gold button per view; secondary actions are `.btn` or `.btn-ghost` | Two gold buttons side by side, or gold for a destructive action |
| Ink text and icons; amethyst only for "on" | Rainbow icon tiles, gradient text, glows, grain, floating badges |
| Real screenshots, real photos with credit, real numbers | Fake scores, stats, testimonials or placeholder grey boxes |
| Hairlines and whitespace to group | Shadows on everything, nested cards inside cards inside cards |
| 44 px targets, 16 px inputs, test at 360 | Hover-only affordances on phone; sideways scroll |
| Check light and dark, check `#2A1F0A` on gold | Pale text on gold; hard-coded `#fff` glyphs that break in a light tile |

## Studio shell patterns (roadmap 2.11)

How the photo studio shell works on a phone and on a laptop, and the hooks panel authors use. Everything here is additive; the
older extension points (`window.LEStudioPanels` specs, `_hooks`, `_cmds`, `fire(...)`, `ctx`, `data-cmd`, `data-panel-btn`, `TOOL_MAP`) are unchanged.

**The phone model.** One canvas, one toolbar, one sheet. The bottom tab bar has the four jobs people start with (Design, Elements, Text, Uploads) and **More**, a grid sheet with every other tool (Collage first, then Adjust, Filters, Background, Draw, Layers, Recipes, Projects, Apps, Download and anything registered later). Every tool is at most two taps away and nothing scrolls sideways. The contextual toolbar above the tab bar is the only place for selection actions (no floating mini bar on phones). The header keeps Undo, Redo and a labelled gold **Download**. Before a design exists the tab bar and header actions are hidden: the start screen is the only thing to do.

**Registering a tool.** The rail and the More sheet are built from `RAIL` plus:
- `LEStudioPanels._rail.push({ id, label, icon, order })` (array form `[id, label, icon, order]` also works), or
- a panel spec with `rail: { label, icon, order }` (or `rail: true`).
`icon` is a name from the shell's icon set (`ctx.I`) or the inner markup of a 24×24 stroke icon. The four phone tabs are fixed; everything else lands in More automatically. `ctx.renderRail()` redraws after a late registration. `ctx.openTool(name)` opens a tool by its `?tool=` name (`TOOL_MAP`), e.g. `'collage'`.

**Sheet snaps (phone).** The sheet has three heights: `peek` (title and one row, about 150 px), `half` (40 % of the space between header and tabs, the default) and `full` (90 %). The canvas always fits into the space above the sheet.
- A panel asks for its height with `spec.sheet: 'peek' | 'half' | 'full'` (or a function `(ctx, opts) => name`); a caller can override with `openPanel(id, { sheet: 'full' })` (`{ full: true }` still works).
- `ctx.sheet(name)` moves the open sheet; `ctx.sheet()` returns the current snap (`null` on desktop or with no panel).
- The shell lowers the sheet to `peek` when the person works on the canvas (any pointer gesture that ends on the stage) and after anything is added to the page, so a new heading is visible and selected above the sheet. A panel that must stay up sets `spec.keepSheet: true`.
- Dragging a range input inside the sheet "scrubs": the sheet shrinks to that slider (it stays under the finger, everything else in the sheet hides) and the canvas takes the room; it returns on release.
- The grip: drag to any snap, drag below the peek to close, tap to step up (peek → half → full → half).

**Sticky primary action.** A panel's main button never sits below the fold. Either put it in `ctx.ui.actions([button, ...])` (a `.sx-sheet-actions` footer, sticky at the bottom of the side panel or sheet, gold button gets two thirds of the width), or make it a direct child `.btn-gold.sx-block` of the panel body (it sticks the same way). Only one gold button per view.

**Toolbar priority and overflow.** Toolbar buttons carry `data-pri`: `0` never hides (More, Done), `1` always shown (the type's main actions, Duplicate, Delete; Lock on desktop), `2` common, `3` first to go. The shell measures: on desktop it first drops text labels, then moves priority 3 and then 2 into the **More** menu, in place of a hidden scrollbar. Buttons from `fire('toolbar', ...)` hooks without `data-pri` count as 2. Items in the More menu act exactly like the toolbar button (`data-cmd`, anchored on More). Destructive actions are `is-danger`; Delete and Duplicate are always visible. Re-rendering keeps keyboard focus on the same command; an unchanged toolbar is not redrawn.

**Menus, dialogs, focus.** `ctx.openPop(anchor, html, { cls: 'sx-pop-menu' })` is a keyboard menu: `role="menu"`, items `menuitem`, focus moves to the first item, arrows/Home/End move, Esc or Tab returns focus to the opener (`aria-expanded` is kept in sync). A pop with a `title` is a small dialog (Tab stays inside). `ctx.openModal(title, ...)` names the dialog with the plain text of the title, traps Tab and returns focus to the control that opened it. Every icon button needs an `aria-label`.

**Toasts.** `ctx.toast(msg, { action: { label, fn }, ms })` appears in the free area: above the phone tab bar, toolbar and sheet; above the desktop footer, centred on the canvas. Tap to dismiss. Silent no-ops get a toast.

**Phone copy rules.** Never write mouse-only instructions where a touch screen will read them. Use `ctx.say(mouseText, touchText)` (or `ctx.coarse()`): "Double-tap" not "Double-click", "Tap and hold" not "Shift-click", "Choose photos" not "Drop" or "Ctrl V". Keyboard shortcuts belong in `<kbd>` and only on desktop.

**First-run guidance.** At most three coach marks (`ctx.coach(i)`), each tied to a real control (the tools, the toolbar, Download), shown once to a first-time visitor and never again (`localStorage['le-studio-coach']`), nothing for returning visitors. They never block a tap: a tap anywhere does what it would have done and moves on; Esc turns them off (`ctx.coach('off')`). Prefer a good empty state to a tour.

**Handles on touch.** 44 px hit areas with 14 px knobs, edge handles only where the object has room (a heading keeps its side handles, not top and bottom, so its middle always drags), corner hit areas move outward on tiny objects, the rotate knob flips below or inside when the top would clip it, and the page is fitted with a 24 px inset.

**Memory.** Object-URL memo caches go through `LEStudioPanels._urlCache(name, max)` (least recently used URL revoked) and are emptied when a design closes (`ctx.releaseUrls()`).

## Studio polish backlog

Studio items 1, 2, 3, 7, 8 and 10 were done in 2.11 (phone canvas inset, toolbar overflow, no aurora in the studio, neutral size cards, no stage wash, gold ink from `--gold-ink`). Items 4, 6 (PDF studio) and 9 are still open; 5 belongs to the Design panel.

In priority order. Files: `studio/index.html`, `assets/css/studio.css`, `assets/css/pdf-studio.css`.

1. **Phone canvas fit.** At 390 px the page fills the stage edge to edge, so corner handles and the rotate handle are clipped by the header and screen edges. Keep a 16–24 px inset around the page when fitting.
2. **Contextual toolbar overflow.** On phone the selection toolbar (Edit photo, Filters, Effects, Crop, Flip, Replace, …) is cut off at the right with no cue. Add an edge fade and scroll snap, or a "More" overflow.
3. **Remove the last aurora gradients.** The tab underline in the Design panel and the studio hero word "beautiful." / PDF studio "right here." use the purple-pink-gold gradient. Use solid amethyst for the underline and ink (or `--accent`) serif italic for the word.
4. **Hard-coded white glyphs.** `pdf-studio.css` (`.ps-start .ic svg`, `.ps-dropzone .ic svg`, `.ps-panel-title .ic svg`, `.ps-addzone`, `.ps-restore`) and `convert.css` (`.cv-drop .ic svg`) set `stroke: #fff`. Switch to `stroke: currentColor` so tiles can be restyled from tokens.
5. **Design → Resize card wraps badly at desktop width.** "1200 × 800 px" and "Original 1200 × 800" break over lines next to "Reset to original". Stack the button under the size below ~380 px of panel width.
6. **Brand lockups differ.** Photo studio header is sans "LocalEditor" + serif "Studio"; PDF studio is serif "PDF Studio" with a violet mark. Use one lockup: gold mark + sans wordmark + product name in `--muted`.
7. **Start screen size cards** use lavender-pink gradient thumbnails. Use neutral outlines (`--surface-2` fill, `--border` stroke) with the ratio drawn true to size.
8. **Stage background** now follows the warmer `--bg`; the studio hero still adds its own lavender wash. Drop the wash so the start screen matches the homepage.
9. **Rail active state** in the PDF studio has no visible "current" when no panel is open; mirror the photo studio's gold tile.
10. **Gold overrides** in `studio.css` (`--gold-ink-strong`, `!important` colour rules) can now point at `--gold-ink` (`#2A1F0A`), which has the same value.
