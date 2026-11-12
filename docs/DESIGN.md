# LocalEditor design language

One page for everyone building UI. Tokens live in `assets/css/app.css` (section 1). The studios, tool pages, about, 404, recipes and convert pages all read them. **Never rename or remove a token or a shared class**; `studio.css` and `pdf-studio.css` depend on them. Add new ones instead. The evidence behind these choices, and its limits, is in `docs/research/interface-psychology.md`.

## Identity

**The mark ("Corner").** A bold, rounded **L** drawn as a crop corner, holding a warm **Apricot dot**: your picture, kept in your corner. It is an initial (L for Local), an editing gesture (the crop corner) and a promise (the thing you made stays put). White on a Lapis tile with a soft top-to-bottom gradient; one colour (`assets/icons/mark-mono.svg`, `currentColor`) wherever colour is not available.

- Sources: `assets/icons/icon.svg` (rounded tile, 512 grid, tile radius 112), `maskable.svg` (full bleed, mark at 80 %), `mark-mono.svg`. PNGs, the social card and shortcut icons are generated from them by `node scripts/screenshots.js --icons-only`.
- Geometry (512 grid): stroke 64, round caps; L from (176,140) down to a 40 px inner radius, out to (372,376); dot r 58 at (314,236). Keep at least 1/8 of the tile clear around the glyph.
- Inline: `.le-mark` (site header), `.sx-mark` (studio header) and the PDF studio / Convert lockups use the same paths (flat Lapis tile, no gradient ids). Lockup: mark + sans **LocalEditor** (720, −0.03em) + product name in `--muted` or `--side-dim`.
- Checked at 16, 32, 180 and 512 px on white, near-black and two photographs; legible at 16 px (the L reads; the dot stays a dot).
- Don't: rotate it, outline it, put the dot in another colour, add a shield or padlock, place it on a busy photo without its tile.

**Wordmark.** "LocalEditor" set in Plus Jakarta Sans 720, tracking −0.03em, one colour (`--ink`). No serif in the wordmark.

## Principles

1. **Neutral grey does the work.** True greys (chroma 0) for page, surfaces, lines and text. People judge their own colours against the interface around them, so editor chrome never carries a hue.
2. **One primary action per view.** Lapis blue `.btn-primary` (old name `.btn-gold`) is the one filled, coloured button: Open, Download, Save. It works because nothing else on the screen is that colour (isolation effect).
3. **Brand in small doses.** Lapis marks the primary action, selection, focus and "on". Never a page background or a large fill.
4. **Green means private.** `--private` / `--ok` is for "on this device", "nothing uploaded", "safe", "done". Not for decoration, not for a category.
5. **Apricot is the warm note.** `--warm` appears in the mark's dot, the closing band's accent word and completion moments. Never as text on white (use `--warm-ink`), never for a button.
6. **Show the real thing.** Real UI, real photos, real files. No fake numbers, gauges or testimonials. Honest copy; no dark patterns (no confirm-shaming, no pre-ticked boxes, no fake urgency).
7. **Phone first.** Design at 360 px, then 390, 820 and 1440. Touch targets at least 44 px. Nothing scrolls sideways.
8. **Motion explains.** Short and specific; delight only at the end of a job; all of it off under `prefers-reduced-motion`.

## Colour

Primitives are generated in OKLCH (`docs/research/interface-psychology.md` explains why) and stored as sRGB hex so every supported browser reads them: `--n-0 … --n-975` (neutral, chroma 0), `--brand-50 … 950` (Lapis, hue 266, peak chroma 0.18), `--warm-*` (Apricot, hue 48), `--green-*` (hue 155), `--amber-*` (hue 75), `--red-*` (hue 25). Each step's OKLCH value is in a comment next to it. **Components use the semantic tokens below, not the primitives.**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAFAFA` | `#141414` | Page |
| `--bg-2` | `#F0F0F0` | `#191919` | Pressed / hover on bg |
| `--surface` | `#FFFFFF` | `#1C1C1C` | Cards, panels, fields |
| `--surface-2` | `#F5F5F5` | `#262626` | Inset areas, chips, icon tiles, hover |
| `--surface-3` | `#EBEBEB` | `#2E2E2E` | Tracks, deeper insets |
| `--ink` / `--text` | `#141414` | `#EDEDED` | Headings, body, icons (18:1 / 15:1) |
| `--muted` | `#525252` | `#ABABAB` | Secondary text (7.8:1 / 8.3:1) |
| `--faint` | `#6C6C6C` | `#8F8F8F` | Meta, counts (≥ 4.6:1 on every surface) |
| `--line` | black 8 % | white 9 % | Hairlines, card borders |
| `--border` / `--border-hover` | `#E3E3E3` / `#C1C1C1` | `#333333` / `#4D4D4D` | Field and button borders |
| `--border-strong` | `#8A8A8A` | `#808080` | Edges that must be seen (3:1) |
| `--primary` | `#3F67D9` | `#3F67D9` | The primary action's fill (white text 5.1:1) |
| `--primary-hover` / `--primary-active` | `#365CC9` / `#2E51B6` | same | Hover and press |
| `--on-primary` | `#FFFFFF` | `#FFFFFF` | Text and icons on primary |
| `--primary-edge` | `#3F67D9` | `#5884F8` | Primary border (keeps 3:1 against dark surfaces) |
| `--accent` | `#2E51B6` | `#ADC6FF` | Brand as text: links, selected labels (7.1:1 / 11:1) |
| `--accent-soft` | Lapis 10 % | Lapis 16 % | Field focus halo, soft selection |
| `--selected-bg` / `--selected-edge` | `#F3F7FF` / `#3F67D9` | `#1E2A47` / `#81A6FE` | Selected row, tile, chip |
| `--focus-ring` | `#3F67D9` | `#81A6FE` | `:focus-visible` outline (≥ 4.6:1) |
| `--selection-bg` / `--selection-ink` | `#CEDDFF` / ink | `#2E51B6` / white | `::selection` |
| `--warm` | `#EF8C57` | `#EF8C57` | Apricot fill: the dot, completion ring (never text) |
| `--warm-ink` / `--warm-soft` | `#913F04` / `#FFF4EF` | `#FEB38C` / `#3F2314` | Apricot as text, "New" badge |
| `--private` / `--ok` | `#016D3C` | `#65BF88` | Private, on this device, done (6.5:1 / 8:1) |
| `--private-soft` / `--add-bg` | `#EEFBF1` | `#12301E` | Its background |
| `--ok-fill` | `#14874E` | `#3CA368` | Green fills (check badges) |
| `--warn` / `--warn-soft` | `#7A5103` / `#FFF5E9` | `#EDBD7B` / `#3A270B` | Limits, cautions |
| `--err` / `--err-soft` / `--del-bg` | `#C92F33` / `#FFF4F3` | `#FE7C75` / `#421C19` | Errors, destructive actions |
| `--side` / `--side-2` | `#161616` / `#202020` | `#161616` / `#1E1E1E` | Editor chrome: studio header and rail, toast, closing band |
| `--side-text` / `--side-dim` | `#E9E9E9` / `#A3A3A3` | same | Text on chrome (15:1 / 7.2:1) |
| `--stage` | `--surround-light` | `--surround-dark` | Canvas surround (see below) |
| `--stage-ink` | `#525252` | `#A3A3A3` | Text drawn on the surround |

Status is never told by hue alone: every status has a word and an icon, and green, amber and red differ in lightness as well as hue. The palette was checked with protanopia, deuteranopia and tritanopia simulation (Machado 2009); Lapis stays distinct from every status colour in all three.

`prefers-contrast: more` darkens `--muted`, `--faint`, `--line`, `--border` and the primary.

### Neutral chrome and the canvas surround

Everything around a canvas (studio header, rail, panels, toolbar, footer, PDF studio rail, thumbnails, status bar, Convert) is a true grey; `tests/brand.test.js` fails if any of them has a hue cast. The canvas surround has three settings, chosen in **Studio → Performance → Canvas surround** (`LE.surround.set('light' | 'mid' | 'dark' | 'auto')`, stored as `localStorage['le-surround']`, applied as `html[data-surround]`):

| Surround | Value | Ink on it |
|---|---|---|
| light | `#E6E6E6` | `#525252` |
| mid | `#737373` (the fairest for judging colour) | `#FFFFFF` |
| dark | `#1A1A1A` | `#A3A3A3` |

"Theme" (auto) uses light in the light theme and dark in the dark theme. Any editor stage reads `var(--stage)`; the PDF studio and Convert map their `--stage-bg` to it.

### Expert workspace colour and surface guidance

For the engineers building `assets/js/expert/**` and `assets/js/fx/**`:

- Every surface around the image is a neutral token: `--side`, `--side-2`, `--side-active` for the dark chrome; `--surface`, `--surface-2`, `--surface-3` in panels; `--stage` behind the image. No tinted greys, no gradients, no glows. Professional editors default to dark chrome; follow the theme for panels and leave the surround to the person.
- Lapis only for: the active tool, the selected layer or mask, slider fills, toggles that are on, focus, and the one primary action of a dialog. Use `--primary` / `--selected-bg` / `--selected-edge` / `--focus-ring`.
- On-canvas overlays (selection, masks, guides, handles): Lapis 500 `#5884F8` strokes with a 1 px dark halo so they read on any photo; mask overlay red at 40 % is fine (it is a convention), but never green (green means private).
- Scopes and histograms: neutral grey for luminance, pure R/G/B channels for colour; no brand colour in data.
- Text on chrome: `--side-text` and `--side-dim` only; numbers `font-variant-numeric: tabular-nums`.
- Do not add literal colours; if you need a new one, add a token to `app.css` (or ask the design lead).

## Type

Plus Jakarta Sans for UI and headings (self-hosted, variable 400–800, rounded terminals that suit the mark); Instrument Serif *italic* for one accent phrase per heading (`<em>` inside `h1`/`h2`, or `.serif`). Never set body copy in the serif. These two faces are the UI faces; the font library for designs is separate.

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

## Shape, space, elevation, motion

- **Space** (4 px base): `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48 · `--s-16` 64 · `--s-20` 80 · `--s-24` 96. Page gutter `--gutter` is 16 / 24 / 32 at <720 / ≥720 / ≥1100. Content max `--page-max` 1200.
- **Radius** (rounded, not toy-like): `--r-xs` 6 (kbd, thumbs) · `--r-sm` 10 (icon tiles, fields, rows) · `--r-md` 14 (inner cards, panels, dropzones) · `--r-lg` 20 (cards, dialogs) · `--r-xl` 28 (feature cards) · `--r-pill` (buttons, chips only). The app icon tile is 22 % of its side. Legacy `--radius` = 20, `--radius-sm` = 14, `--radius-xs` = 10.
- **Elevation** (neutral black shadows): `--shadow-xs` (resting cards, buttons) · `--shadow-sm` (hover, selected segment) · `--shadow` (floating cards, code) · `--shadow-lg` (dialogs, drawer, popovers). Prefer a hairline (`1px solid var(--line)`) to a shadow.
- **Motion**: `--dur-1` 120 ms (hover, press) · `--dur-2` 200 ms (toggles, fades) · `--dur-3` 320 ms (drawers, sheets) · `--dur-4` 480 ms (completion moments only). Easing `--ease-out` for entrances, `--ease` for state changes, `--ease-in-out` for things that move and come back. Press = `scale(0.98)`. Everything collapses under `prefers-reduced-motion`.
- **Completion moments.** When a job finishes on the device (download, save, a clean privacy check, a PDF saved) the confirmation gets a green check that pops in once with a soft Apricot ring (`IT.celebrate(message)` on site pages; the studio's toasts that start with "Downloaded", "Saved" or "Copied" do it automatically; `ctx.toast(msg, { done: true })` for others; `.pp-done` draws its check). Nothing loops, nothing bounces for attention.

## Components

- **Buttons** `.btn` (44 px, pill, surface, border; this is the secondary button, also `.btn-secondary`) · `.btn-primary` (one per view, Lapis, white text; `.btn-gold` is the same class under its old name) · `.btn-quiet` / `.btn-ghost` (no fill) · `.btn-danger` (red text, red edge on hover; never filled by default) · `.btn-ink` (rare secondary emphasis) · `.btn-link` (text + arrow) · sizes `.btn-sm` (36 px; 44 px on touch outside the studios) and `.btn-lg` (52 px). States: hover, active (press), `:focus-visible` (2 px ring), `:disabled` (45 %), loading (`.is-loading` or `aria-busy="true"`: label hidden, spinner, same width). Check the computed colour: a broad `button { color: inherit }` has overridden the primary before.
- **Fields** `.input` `.select` `.textarea`: 44 px, `--r-sm`, focus = `--focus-ring` border + `--accent-soft` halo. Labels 13 px / 640 above the field.
- **Segmented** `.seg` with `button[aria-pressed]`: inset track, the selected segment is a raised surface.
- **Chips** `.chip` (`button.chip` is 40 px tall; pressed = `--selected-bg`, `--selected-edge`, `--accent` text). **Badges** `.badge`, `.badge.ok`, `.badge.private`, `.badge.warn`, `.badge.err`, `.badge.new` (Apricot).
- **Cards** `.card`: surface, hairline, `--r-lg`, padding 20 → 24. No gradient borders, no grain.
- **Icon tiles** `.tool-card .ti` and `.hp-tool-ic`: neutral `--surface-2` with ink glyph. `.ic .ic-<hue>`: flat solid tile with a white glyph (studios only; `.ic-gold` is now Apricot, also `.ic-warm`).
- **Range**: native with `accent-color: var(--primary)` on tool pages; the studios use their own Lapis-fill track with a white thumb, which is the reference.
- **Switches** (studio `.sx-toggle`, PDF studio and tool-page toggles): on = Lapis track, white knob.
- **Toasts**: `--side` fill, `--side-text`; actions in `#ADC6FF`; completion variant above.
- **Focus**: every interactive element shows `:focus-visible` as a 2 px `--focus-ring` outline, offset 2 px (studios: a 2 px surface gap and a 2 px ring). Never remove it without a replacement. `tests/brand.test.js` checks 3:1.
- **Shell** (from `app.js`): sticky header (brand, section links at ≥1100, search field at ≥640 / icon below, theme, menu, primary "Open studio" at ≥1100) and a right-hand drawer `.le-side` at every width (the PDF studio and Convert pages pin it to the left). The drawer holds Install (`[data-le-install]`), Storage (`[data-le-storage]`), theme and privacy. Escape closes it; focus moves in and returns to the menu button.

## Do / don't

| Do | Don't |
|---|---|
| One primary (Lapis) button per view; secondary actions are `.btn` or `.btn-quiet` | Two primary buttons side by side, or a primary for a destructive action |
| Neutral greys around the canvas; Lapis only for "on", selection, focus | Tinted greys, purple or warm paper behind someone's photo |
| Green only for private / on this device / done, with a word and an icon | Green as decoration, or status told by colour alone |
| Apricot in very small doses (the dot, a completion ring, a closing accent) | Apricot text on white, Apricot buttons, gold anything |
| Real screenshots, real photos with credit, real numbers | Fake scores, stats, testimonials or placeholder grey boxes |
| Hairlines and whitespace to group | Shadows on everything, nested cards inside cards inside cards |
| 44 px targets, 16 px inputs, test at 360 | Hover-only affordances on phone; sideways scroll |
| Check light and dark; check computed contrast (≥ 4.5:1 text, ≥ 3:1 rings and edges) | Hard-coded hex in a component; use or add a token |

## Migration: deprecated aliases (remove once nothing uses them)

These names still work and point at the new tokens. Search for them before removing; `tests/brand.test.js` will flag any gold literal that comes back.

| Deprecated | Now means | Use instead |
|---|---|---|
| `.btn-gold` | the primary button | `.btn-primary` |
| `--gold`, `--foil`, `--champagne`, `--brand` | `var(--primary)` | `--primary` (fills), `--selected-edge` (selected outlines) |
| `--gold-2`, `--foil-hover` | `var(--primary-hover)` | `--primary-hover` |
| `--foil-edge` | `var(--primary-edge)` | `--primary-edge` |
| `--gold-ink`, `--brand-ink`, studio `--gold-ink-strong` | `var(--on-primary)` | `--on-primary` |
| `--glow-gold`, `--brand-glow` | a soft Lapis shadow | `--shadow-sm` |
| `--brand-soft` | `var(--selected-bg)` | `--selected-bg` |
| `--amethyst` / `--amethyst-2` | `var(--primary)` / `var(--primary-active)` | `--primary` |
| `--aurora` | `var(--primary)` (solid) | `--accent` for text, `--primary` for bars |
| `--obsidian` | `var(--primary)` (it was the "selected" fill) | `--selected-bg` or `--primary` |
| `--aubergine`, `--pearl`, `--brand-2`, `--brand-3`, `--grain` | neutral or brand equivalents | semantic tokens |
| `.ic-gold` | Apricot tile | `.ic-warm` |
| le-pwa `--lp-gold`, `--lp-foil`, `--lp-gold-ink` | the primary tokens | `--primary`, `--on-primary` |

## Studio shell patterns (roadmap 2.11)

How the photo studio shell works on a phone and on a laptop, and the hooks panel authors use. Everything here is additive; the
older extension points (`window.LEStudioPanels` specs, `_hooks`, `_cmds`, `fire(...)`, `ctx`, `data-cmd`, `data-panel-btn`, `TOOL_MAP`) are unchanged.

**The phone model.** One canvas, one toolbar, one sheet. The bottom tab bar has the four jobs people start with (Design, Elements, Text, Uploads) and **More**, a grid sheet with every other tool (Collage first, then Adjust, Filters, Background, Draw, Layers, Recipes, Projects, Apps, Download and anything registered later). Every tool is at most two taps away and nothing scrolls sideways. The contextual toolbar above the tab bar is the only place for selection actions (no floating mini bar on phones). The header keeps Undo, Redo and a labelled primary **Download**. Before a design exists the tab bar and header actions are hidden: the start screen is the only thing to do.

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

**Sticky primary action.** A panel's main button never sits below the fold. Either put it in `ctx.ui.actions([button, ...])` (a `.sx-sheet-actions` footer, sticky at the bottom of the side panel or sheet, the primary button gets two thirds of the width), or make it a direct child `.btn-primary.sx-block` (old name `.btn-gold.sx-block`) of the panel body (it sticks the same way). Only one primary button per view.

**Toolbar priority and overflow.** Toolbar buttons carry `data-pri`: `0` never hides (More, Done), `1` always shown (the type's main actions, Duplicate, Delete; Lock on desktop), `2` common, `3` first to go. The shell measures: on desktop it first drops text labels, then moves priority 3 and then 2 into the **More** menu, in place of a hidden scrollbar. Buttons from `fire('toolbar', ...)` hooks without `data-pri` count as 2. Items in the More menu act exactly like the toolbar button (`data-cmd`, anchored on More). Destructive actions are `is-danger`; Delete and Duplicate are always visible. Re-rendering keeps keyboard focus on the same command; an unchanged toolbar is not redrawn.

**Menus, dialogs, focus.** `ctx.openPop(anchor, html, { cls: 'sx-pop-menu' })` is a keyboard menu: `role="menu"`, items `menuitem`, focus moves to the first item, arrows/Home/End move, Esc or Tab returns focus to the opener (`aria-expanded` is kept in sync). A pop with a `title` is a small dialog (Tab stays inside). `ctx.openModal(title, ...)` names the dialog with the plain text of the title, traps Tab and returns focus to the control that opened it. Every icon button needs an `aria-label`.

**Toasts.** `ctx.toast(msg, { action: { label, fn }, ms })` appears in the free area: above the phone tab bar, toolbar and sheet; above the desktop footer, centred on the canvas. Tap to dismiss. Silent no-ops get a toast.

**Phone copy rules.** Never write mouse-only instructions where a touch screen will read them. Use `ctx.say(mouseText, touchText)` (or `ctx.coarse()`): "Double-tap" not "Double-click", "Tap and hold" not "Shift-click", "Choose photos" not "Drop" or "Ctrl V". Keyboard shortcuts belong in `<kbd>` and only on desktop.

**First-run guidance.** At most three coach marks (`ctx.coach(i)`), each tied to a real control (the tools, the toolbar, Download), shown once to a first-time visitor and never again (`localStorage['le-studio-coach']`), nothing for returning visitors. They never block a tap: a tap anywhere does what it would have done and moves on; Esc turns them off (`ctx.coach('off')`). Prefer a good empty state to a tour.

**Handles on touch.** 44 px hit areas with 14 px knobs, edge handles only where the object has room (a heading keeps its side handles, not top and bottom, so its middle always drags), corner hit areas move outward on tiny objects, the rotate knob flips below or inside when the top would clip it, and the page is fitted with a 24 px inset.

**Memory.** Object-URL memo caches go through `LEStudioPanels._urlCache(name, max)` (least recently used URL revoked) and are emptied when a design closes (`ctx.releaseUrls()`).

## Studio polish backlog

Studio items 1, 2, 3, 7, 8 and 10 were done in 2.11. Item 6 (one lockup) was done in the identity refresh (November 2026): the PDF studio and Convert use the mark + sans lockup, and gold is retired everywhere (item 10 is moot). Items 4 and 9 are still open; 5 belongs to the Design panel.

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
