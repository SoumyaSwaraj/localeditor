# Expert workspace and control kit

Step X0b of `docs/EXPERT-MODE.md`. How the Expert workspace is laid out, how a feature team gets a panel from a registration,
and the APIs of the control kit, the tool strip and the brush. Code: `assets/js/expert/`, styles `assets/css/expert.css`,
live gallery `labs/expert-controls/`, tests `tests/expert-ui.test.js`.

## Loading (principle E6)

- The simple studio carries one boot hook in `le-studio.js` (about 2 KB with its CSS): the **Simple | Expert** switch in the
  header (an icon toggle on phones), a File-menu entry, `?mode=expert` (applied once, then removed from the address), the
  remembered choice (`localStorage['le-studio-mode']`), the `expert.workspace` support definition and the gate, the
  "Edited in Expert" marker on layers with expert data, and a toast with **Open in Expert** when such a design opens in Simple.
- The first switch loads `expert/expert.js` (core), which loads `expert.css`, then `../fx/curves.js` (the spline, owned by the renderer) and `controls/base.js`, then
  the rest in parallel. Nothing in `assets/js/expert/` loads before that. `mock-fx.js` is test-only and never loaded by the app.
- `ctx.mode('expert' | 'simple')` switches from code. Switching never changes the document or adds an undo step.
- The build must keep `assets/js/expert/**` and `assets/css/expert.css` out of the core bundle and precache them as
  on-demand files (they are fetched by `LE.lazy` and a `<link>`).

## Layout

| Size | Layout |
|---|---|
| Desktop, 1024 px and wider | Tool strip (left, in the rail's place) · canvas · right column: **Scopes** (fixed on top, collapsible), **Develop** (scrolls), a draggable split, **Layers**. The column is resizable (280–560 px, double-click the edge to reset); panes collapse; all of it is remembered (`le-expert-layout`). |
| Tablet, 768–1023 px | Tool strip on the left with Develop, Layers and Scopes buttons at its foot; the panels open in the studio's floating panel (tabs Develop / Layers / Scopes). |
| Phone, under 768 px | A compact horizontal strip over the canvas; the same panels in the bottom sheet (its snaps); the tab bar becomes Develop, Mask, Layers, Scopes, More (More is the simple studio's tool sheet). A toast says once that the workspace is designed for a larger screen. Nothing is blocked. |

The simple studio's panels stay reachable: the strip's grid button lists every rail tool, and Download, history and the File
menu are unchanged. The contextual toolbar is the **options bar**: while a tool with options is active it shows them.

**Before / after.** `\` shows the before picture (expert entries, adjustment layers and photo adjustments off), `Y` cycles
split view (draggable divider, arrow keys move it) → side by side → off. The compare buttons sit in the Scopes header.

## Develop panel

Sections, in this order (registrations choose with `ui.section`, or `group`; names are matched case-insensitively and
"color" is accepted): **Layer mask**, Light, Colour, Curves, Colour mixer, Colour grading, Detail, Optics, Geometry,
Effects, Shadows & reflections, Compositing, Retouch. An unknown section name sorts after Effects. Section order never
changes with use.

Each section has a chevron (click to open; **Alt/Option-click** turns on solo mode: opening one closes the others), an eye
(turns every entry of that section on the layer on or off) and a reset (removes those entries). A section with entries
shows an amethyst dot; one that is off shows a grey dot and dims.

The develop panel edits the selected photo, group or adjustment layer (with nothing selected, the main photo). Each
registration's controls bind to the **first entry of that type** in `layer.fx`; the entry is created by the first edit
(inserted after the last entry of an earlier or equal section) in the same undo step. Further entries of the same type,
masks and blend per entry live in the layers panel.

## Panels from registrations

You write a registration (`docs/EXPERT-MODE.md`, "Effect registry"); the workspace reads `LE.fx.defs()` (frozen and shared; read again only when `LE.fx.version()` has moved) and builds:

| Param type | Control | Value |
|---|---|---|
| `number` | slider row (bipolar detent when `min < 0 < max`; tick at `default`; gradient track for params named temperature/temp/warmth, tint, hue, or `ui.gradient`) | number, clamped and rounded to `step` |
| `bool` | switch | boolean |
| `choice` | segmented (4 or fewer short options) or a select; `options: [{ value, label }]` or `['a', 'b']` | value |
| `color` | swatch (the studio picker) + eyedropper | `'#rrggbb'` |
| `point` | X / Y scrubbers + on-canvas handle | `{ x, y }` in 0–1 of the layer box |
| `angle` | dial + scrubber + on-canvas handle; wraps 0–360 unless `min`/`max` | degrees |
| `curve` | curve editor | `{ master, r, g, b }` each `[[x, y], ...]` in 0–1, or a bare array for one channel |
| `wheel` | colour wheel + luminance | `{ h: 0–360, a: 0–1, l: -1–1 }` |
| `bands` | hue-band grid | `[{ h, s, l } x 8]` (red, orange, yellow, green, aqua, blue, purple, magenta) in the schema range, default -100–100 |
| `lut` | LUT picker (`.cube` → asset) | asset id or `null` |
| `seed` | number + new seed | integer |

`ui.controls` (optional) orders and groups them:

```js
ui: { section: 'Colour grading', controls: [
  { heading: 'Tone' },                                  // sub-heading
  { action: 'grade.auto', label: 'Auto' },              // a button: an action from the registry (LE.fx.actions), applied as one undo step
  'exposure',                                           // default control
  { param: 'temp', gradient: 'temperature', label: 'Temperature', fine: true },
  { param: 'protect', when: { style: 'highlight' } },   // shown only when style is 'highlight'
  { control: 'wheels', params: ['shadows', 'midtones', 'highlights', 'global'], global: 'global', balance: 'balance', blending: 'blending' },
  { control: 'mixer', rows: { r: ['rr', 'rg', 'rb'], g: ['gr', 'gg', 'gb'], b: ['br', 'bg', 'bb'] } },
  { control: 'line', params: ['top', 'bottom'], style: 'gradient' | 'line', label: 'Guide' }
] }
```

Params that `ui.controls` does not mention still get a control at the end (unless `param.ui.hidden`). A param can carry
`help` (tooltip), `unit` (`'%'`, `'°'`, `'px'`, `'EV'`), `decimals`, `ui: { control, gradient, hidden }`.
`agent.summary` is shown in the add-effect menu and searched.

**Rules for feature teams.** Use the parameter types above rather than inventing widgets; give every number a `default`
inside its range and a `step`; name colour params so the gradient track appears; keep one registration per concept
(two in a section get sub-headings); never read the DOM. A control you truly need can be registered:
`LE.expert.controls.register('my-control', factory)` and named from `ui.controls` with `{ param, control: 'my-control' }`.

## Control kit API

Every control is `LE.expert.controls.create(name, spec)`; each works on its own (see the gallery).

```
spec    { label, value, schema, onInput(value, key), onCommit(value, key), ...per control }
control { el, get(), set(value), focus(), destroy() }
```

- `onInput` fires at most once per frame during a gesture; `onCommit` once when it ends, with the **same key**. Write the
  document with that key (`scene.update(id, patch, { coalesce: key })`, or `LE.expert.doc.*(…, key)`) and a gesture is one
  undo step. One-shot changes (a click, a reset, a typed value) call only `onCommit`. Keyboard repeats within 700 ms share a key.
- `set()` never fires callbacks and is ignored while the person is dragging that control.
- Pointer gestures call `LE.fx.interactive(true)` at the start and `(false)` at the end (via `LE.expert.interactive`).

| Name | Notes |
|---|---|
| `slider` / `number` | `schema { min, max, step, default, unit, decimals }`, `gradient`, `fine`, `compact`. Mouse: click jumps, drag follows; Shift drags 10x finer. Touch: relative drag (no jump), vertical scroll wins. Keys: arrows (Shift x10, Alt /10), Page Up/Down, Home/End, Enter types a value, Backspace/Delete resets. Double-click / double-tap the label or track resets; the reset button appears when the value differs from the default. Drag the number to scrub it, click it to type. |
| `bool`, `segmented`, `choice`, `seed` | `segmented` and `choice` take `schema.options`; arrow keys move between options. |
| `color` | `alpha`, `eyedropper` (default on in the studio). |
| `curve` | `channels: false` for a single curve, `histogram()` for the backdrop. Click near the curve to add a point (Shift: on the curve), drag, drag off the graph or double-click to remove; Tab to points, arrows move them (Shift x10), Delete removes, `+` adds; presets: linear, medium contrast, strong contrast, matte, cross process; input/output fields for the selected point. `control.target` = `{ start(level), move(dyPixels), end() }` for targeted adjustment. |
| `wheel`, `wheels` | Wheel: drag the puck (Shift finer), arrows: hue left/right, amount up/down. `wheels`: 3-way and single views, balance and blending sliders, `onChange(key, value, gestureKey, live)`. |
| `bands` | Hue / Saturation / Luminance / All views; targeted adjustment with `target.start(hue)`. |
| `mixer` | 3x3 matrix of scrubbable cells with row totals (warns away from 100 %). |
| `point`, `line`, `angle` | On-canvas handles through `LE.expert.canvas` (below); `layerId()` says which layer box they live in. |
| `lut` | Choose or drop a `.cube` (3D, `LUT_3D_SIZE` 2–128); stored with `LE.project.putAsset`; parsed result in `LE.expert.luts[id]`. `LE.expert.controls.parseCube(text)` is exported. |
| `mask` | Mask manager (below). |

Helpers: `controls.gesture(spec)`, `controls.drag(el, { start, move, end, tap })` (pointer capture), `controls.doubleTap(el, fn)`,
`controls.scrubber(node, schema, get, apply, gesture, label)`, `controls.row(spec, cls)`, `controls.format(value, schema)`.

### On-canvas handles

```js
LE.expert.canvas.attach(hostEl, { box(layerId) -> { x, y, w, h, rotation } client px, onChange(fn) -> unsubscribe })
var hd = LE.expert.canvas.handles({ layerId, points: [{ id, x, y, label, ring }], lines: [[a, b, 'gradient' | 'line']],
  ellipses: [{ c: pointId, rx, ry, rot }], onDrag(id, x, y, phase /* start | move | end | key */) })
hd.update({ points }); hd.destroy();
```
One handle set at a time. Handles are focusable (arrow keys move them, Shift x10) and 44 px hit areas on touch.

### Handles from a registration (`ui.handles`)

An effect says where it sits on the photo with data; the workspace (`assets/js/expert/handles.js`) draws and drags the handles.
They show for the **selected effect**: the one whose controls were last touched in the develop panel, opened in the layers
panel, or just added. One drag is one undo step, rendered in draft quality (`LE.fx.interactive`); arrow keys nudge a focused
handle; targets are 44 px; handles hide while any tool other than Move, Hand or Zoom is active. The Light tool keeps its own.

```js
ui: { handles: { kind: 'ellipse', center: 'center', rx: 'rx', ry: 'ry', angle: 'angle' } }      // one descriptor, or an array
```

| kind | fields (parameter names) | drags |
|---|---|---|
| `point` | `param` | the point |
| `ring` | `center`, `radius`, `unit` | centre; the rim sets the radius |
| `ellipse` | `center`, `rx`, `ry`, `angle`, `unit`, `cw` | centre; first axis handle sets `rx` and `angle`; second sets `ry` |
| `band` | `center`, `angle`, `half`, `feather`, `unit`, `cw` | centre; arm = angle; edge = half width; dashed outer edge = feather. With only `center`: a level line through the point (a contact line) |
| `angle` | `param`, `anchor` (a point parameter, else the box centre), `cw` | the arm |
| `line` | `anchor`, `angle`, `length`, `unit`, `half` (the length parameter is a full width), `cw` | the tip: direction and length |
| `line` (shadow tip) | `anchor`, `angle`, `elevation`, `height`, `squash`, `cw` | the tip: length = height / tan(elevation), y × squash |
| `mesh` | `rows`, `cols`, `params` (point parameters, row by row) | each point; lines join rows and columns |

`unit` says what a length is a fraction of: `box` (`rx` of the width, `ry` of the height; the ellipse default), `short` (ring and
band default), `long`, `w`, `h`, or `px` (document pixels; the line default). Angles are degrees, counter-clockwise on screen
unless `cw: true`. A point parameter named by several descriptors is one handle. `LE.expert.handles.select({ layerId, type, fxId })`
selects from code; `X.emit('fx-select', …)` is the same thing as an event.

## Add-effect list

Opened from the layers panel (effect, adjustment layer). Without a query: a **Common** group (a short curated list in
`layers.js`, plus registrations with `ui.common: true`), then every section under its heading in the develop panel's order.
Inside a section registrations are ordered by `ui.order`, then by registration. A query shows one ranked list
(`LE.expert.fxSearch(query)`): every word must match; the rank is where it matches, best first: the name itself, the start
of the name, the start of a word in the name, inside the name, the id, a keyword (`keywords`, `ui.keywords`,
`agent.keywords`, `agent.like`), the section, the summary. Ties go by section, then by registration (not `ui.order`), so
giving effects a `ui.order` re-sorts the panel and the list but never changes what a search finds first. Enter takes the
first result; the effect is added, selected and its handles shown.

## Links

Read once at boot, then removed from the address. `?mode=expert` opens Expert for the visit and never changes the saved choice.

| Link | Does |
|---|---|
| `/studio/?mode=expert&tab=develop` · `mask` · `layers` · `scopes` | Desktop: expands that pane, scrolls it into view and focuses its heading (`mask` opens the layer mask section). Tablet and phone: opens that tab. |
| `/studio/?mode=expert&tool=heal` · `clone` · `patch` · `redeye` · `dodge` · `liquify` · `light` · `brush` · `gradient` | Activates the tool once a photo is open. |
| `/studio/?mode=expert&add=<effect id>` | Adds the effect to the photo (one undo step), opens its section and shows its handles. With no photo open a one-line hint says so and the effect is added when the first photo opens. |
| `/studio/?open=raw` · `/studio/?open=hdr` (with or without `mode=expert`) | Runs the `rawOpen` / `hdrMerge` command. A browser shows a file chooser only after a click, so a page opened by a link offers it as a toast action (**Choose a photo** / **Choose photos**). |

Parameters combine (`?mode=expert&tab=layers&add=vignette`). Unknown values are ignored without a message. From code:
`LE.expert.links({ tab, tool, add })`, `LE.expert.workspace.show(tab)`.

## Masks

`layer.mask` (and `fx[i].mask`) = `{ parts: [...], on?: false, invert?: true }`. `on` and `invert` are workspace additions for
the layers panel's disable and invert (see the report to the architect). Part fields and units:

| kind | fields |
|---|---|
| all | `mode: 'add' | 'subtract' | 'intersect'`, `invert`, `feather` 0–1, `density` 0–1 |
| `linear` | `x0, y0` (full effect) → `x1, y1` (no effect), fractions of the layer box |
| `radial` | `cx, cy, rx, ry` (fractions of width / height), `rotation` degrees; full inside, `feather` is the soft fraction of the radius |
| `luma` | `min, max, soft` 0–1 on Rec. 709 luminance |
| `color` | `h` degrees, `s, l, range, soft` 0–1 |
| `asset` | `asset` (a painted alpha: white with alpha; alpha x luminance is the mask) |
| `subject`, `depth`, `face` | as in the architecture document |

Combination, in order from an empty mask: add = max, subtract = m x (1 - v), intersect = m x v (a first part that intersects
starts from it). `LE.expert.evalMask(mask, { w, h, pixels, assets, cutout })` is the CPU reference the overlay uses; the
renderer should match it.

The mask manager (`controls.create('mask', { value, layerId, fxId, onInput, onCommit, onPaint(partIndex, erase) })`) adds
parts from a menu, sets mode, invert, feather and density per part, shows gradient handles on the canvas, picks luminance or
colour ranges with the eyedropper, paints brush parts (B), copies and pastes masks (also across layers and effects, kept on
this device), and shows the mask as a red overlay, white on black, black on white or on the image.

## Tools

```js
LE.expert.tools.register({
  id: 'heal', key: 'J', label: 'Heal', icon: 'heal' /* name or 24x24 stroke markup */, group: 'retouch', order: 40,
  replace: true,                       // to take over a placeholder (heal, clone, dodge, liquify)
  activate(api, opts), deactivate(api), options(api) -> Node   // options appear in the options bar
});
LE.expert.tools.activate(id) · .active() · .list() · .bindings() · .back()
api = { ctx, layer /* overlay over the canvas */, capture(on, cursor), toDoc(clientX, clientY), zoom(), target() /* layer id */,
        brush() /* shared brush options */, toast(msg), sample(clientX, clientY) -> { r, g, b } }
```
A key already taken is refused with a console warning (the tool gets no key). Tool keys are single letters without modifiers.

**Retouch tools on the canvas** (`assets/js/expert/tools/`): Heal (J) and Clone (S) in `spot.js`; **Patch (P)** and **Red-eye (R)** in
`patch.js`; Dodge and burn (O); Liquify. Patch: draw around the area (freehand, or click corner by corner and close on the
first corner or with Enter), then drag the outline onto a clean area; the drag writes one polygon record (`heal-polygon`, or
`clone-polygon` with Copy) into the last `spot-heal` entry with room, as one undo step. Red-eye: tap a pupil or drag a box over
the eye; each eye fills a free eye of a `red-eye` entry with the same pupil size or adds an entry; Pupil size and Darken in the
options bar follow the last eye placed. Liquify shows the frozen area as a red overlay while the Freeze or Thaw tool is
active or **Show mask** is on (drawn from `LE.fx.retouch.liquify.mesh`, repainted only when freeze records change).

## Brush engine

```js
var b = LE.expert.Brush.attach(el, {
  toDoc(clientX, clientY), zoom(), cursorHost,
  target: { canvas, map(docX, docY) -> target px, scale } | null,
  size: 60 /* doc px */, hardness: 0.7, flow: 1, opacity: 1, spacing: 0.12, smoothing: 0.35,
  pressure: { size: true, flow: false }, tilt: false, mode: 'paint' | 'erase', color: '#ffffff'
});
b.on('start' | 'move' | 'end' | 'cancel', (stroke, seg) => {})
// stroke = { id, mode, points: [{ x, y, p, tx, ty, t }] in document space at the spacing, bounds, dirty }
// seg.rect = the target pixels changed by this move (dirty rectangle)
b.set({...}) · b.get() · b.size(n) · b.bigger() · b.smaller() · b.harder() · b.softer() · b.swap() · b.setTarget(t) · b.replay(points) · b.detach()
```
Pointer Events with coalesced events (continuous at speed), pen pressure and tilt, the pen's eraser end flips to erase,
Shift-click draws a straight line from the last stroke, palm rejection (touch ignored for 3 s after a pen, broad contacts
ignored, a second finger cancels the stroke so the canvas can pinch). With a target canvas, dabs are stamped into a stroke
buffer and composited over the stroke's starting pixels at the stroke opacity, inside the dirty rectangle only. One stroke
is one `end` event: commit there for one undo step. Canvas 2D today; a GPU stamp can replace `stamp()` without changing the API.

The built-in Brush tool (B) paints the selected mask: a layer mask, or an effect's mask chosen with Paint in its mask
manager. Each stroke is stored as a PNG asset and swapped into the part (`asset`) in one undo step.

## Scopes

`LE.expert.scopes.create(host)`; the workspace sets `scopes.source` to the page area of the canvas. Measured on a 240 px
copy: the copy is made with `createImageBitmap` and measured in a worker, so a drag is never stalled (main-thread fallback).
Histogram (R, G, B, luminance, clipping triangles that toggle a clip overlay on the photo), waveform (luminance), vectorscope
(75 % targets, skin-tone line at 123°). Updates at most every 250 ms while dragging. `scopes.data` holds the last result.
When `LE.fx.analyze` exists it is asked for `{ source, kinds: ['histogram'] }` and its histogram is used.

## Shortcuts

| Keys | Does |
|---|---|
| V · C · B · J · S · P · R · O · G · K · I · H · Z | Move · Crop and straighten · Brush and mask · Heal · Clone · Patch · Red-eye · Dodge and burn · Gradient mask · Light · Colour sampler · Hand · Zoom (Alt zooms out) |
| `[` `]` · Shift `[` `]` · X | Brush size · hardness · paint/erase |
| `\` · Y | Before/after · split, side by side, off |
| Ctrl 0 · Ctrl 1 (Ctrl Alt 0) · Ctrl + / − · Space-drag | Fit · 100 % · zoom · pan |
| Ctrl `[` `]` · Ctrl Shift `[` `]` · Ctrl D · Del | Layer down/up · to bottom/top · duplicate · delete |
| F2 · Alt ↑↓ · Shift F10 (layers panel) | Rename · move layer · layer menu |
| Alt-click a section · double-click a label | Solo sections · reset the slider |
| Esc · ? | Back to Move (or stop a targeted adjustment) · the searchable shortcut sheet |

Keys taken from the simple studio in Expert: C (ellipse → Crop), `[` `]` (layer order → brush size; layer order is Ctrl `[` `]`),
`\` (hold to compare → toggle), R and P (rectangle, Draw → Red-eye, Patch), L (line → nothing, so no shape appears by accident), Ctrl 1 (the
browser's first tab → 100 % where the browser lets a page have it; Ctrl Alt 0 always works). Ctrl+Z, Ctrl+D, Ctrl+0, arrows,
Space and Delete behave as in Simple. Typing in a field never triggers a shortcut; keys used by a focused control
(arrows, Backspace) stay with it.

## Do / don't

| Do | Don't |
|---|---|
| Declare params with ranges, defaults, steps and units; let the panel build itself | Build DOM for an effect, or read values from the DOM |
| Write the document through `LE.expert.doc` or `scene.update` with the gesture key | Write `layer.fx` outside a gesture key (each write becomes an undo step) |
| Keep coordinates in 0–1 of the layer box, lengths in document pixels | Store screen pixels |
| Use `LE.expert.canvas.handles` for anything placed on the photo | Draw your own overlay elements over the stage |
| Register tools with a single unused letter, and options as a Node | Bind global keydown listeners |
| Test with `mock-fx.js` and the gallery at 390 px and 1440 px, light and dark | Copy any other product's icons, panel artwork or names of proprietary features |
