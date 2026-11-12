# Loading the photo studio

Roadmap L1 ("Light first load"), the part the 25 MB rule allows: everything still downloads on the first visit (see `docs/DOWNLOADS.md`),
but scripts that are only needed after a tap must not block the first paint.

## The mechanism: `LE.modules.defer`

`assets/js/le-load.js` is a small blocking script in `studio/index.html`. A module declared with it is not a `<script src>` tag:

```html
<script src="../assets/js/le-load.js"></script>
<script>LE.modules.defer({ id: 'stock', src: '../assets/js/le-stock.js', rerender: ['apps', 'uploads', 'elements'] });</script>
```

Deferred modules load **after the load event when the main thread is idle**, one after another **in declaration order** (the same
order their tags had), or **at once** when one of their panels is opened. When one arrives after the studio has booted:

- `init` hooks it added run once with the studio context (other hooks — `toolbar`, `select`, `change`, … — simply start working);
- the rail and the phone More sheet are redrawn (`ctx.renderRail()`), so `_rail` entries and `spec.rail` appear;
- the open panel is re-rendered when it belongs to the module, or is listed in `rerender`.

Options:

| Option | Meaning |
|---|---|
| `id`, `src` | Required. `src` is relative to the page, like the tag it replaces. |
| `css` | A stylesheet that must be there before the module renders (loaded first). |
| `panels: { id: 'Title' }` | Panel ids the module registers. Until it arrives, `LEStudioPanels[id]` is a placeholder that shows "Opening…", loads the module and swaps in the real panel. Deep links (`?tool=id`) and `openPanel(id, opts)` work with it; `opts` are kept. |
| `wrap: { panelId: fn(opts) }` | Views the module adds inside another panel (Apps → Batch is `{ apps: (o) => o.app === 'batch' }`). Those views wait for the module; the rest of the panel is untouched. |
| `queue: 'onRecipeFile'` | A handler the module puts on `ctx.S` when its panel renders. Calls made before it arrives are kept and replayed. |
| `rerender: ['apps']` | Panels to re-render when the module arrives (for libraries such as `LE.stock` that a panel reads). |

`LE.modules.need(id)` loads one now (and everything declared before it); `LE.modules.list()` and `LE.modules.loaded(id)` report.
Declarations with `panels` or `wrap` must come **after** `le-studio-panels.js`, which starts a fresh `LEStudioPanels` object.

## What is deferred today (12 November 2026)

| Module | Why it is safe |
|---|---|
| `assets/js/le-stock.js` (40 KB, 10 KB gzip) | A library: only the collage photo search reads `LE.stock`, inside functions run on a tap. |
| `assets/js/le-studio-variables.js` + `studio-variables.css` (Fields, Create many; `docs/VARIABLES.md`) | Panels only. Its model `le-variables.js` is not declared at all: it loads on demand, through `LE.varBoot` in `le-objects.js` when a page with values is drawn. |

## What stays blocking, and what it would take

A module can only be deferred when nothing it does is needed before the person taps something. These were checked and are not
safe yet; the owners can convert them with the small change listed:

| Module | Blocks because | To defer it |
|---|---|---|
| `le-studio-recipes.js` | Wraps `Scene._processImage` so saved designs with recipe looks draw correctly at boot | Move the shim (`shim()` at the top) into `le-objects.js` or `le-engine.js`; then `panels: { recipes: 'Recipes' }, wrap: { apps: (o) => o.app === 'batch' }, queue: 'onRecipeFile', css: '../assets/css/studio-recipes.css'` |
| `le-studio-export.js` | `history`/`page` hooks record the process-replay timeline from the first edit; draws the carousel strip | Record the timeline in the core (or accept that edits before idle are not in the replay); then `panels: { export: 'Download' }` |
| `le-studio-privacy.js` | Toolbar entries for redaction layers; `history` hook restores redaction images | Move `restoreAssets` to the core; then `panels: { redact: 'Redact' }` and `wrap: { apps: (o) => o.app === 'metadata' }` |
| `le-makers.js` + `le-studio-makers.js` | `_start` adds the makers to the start screen; `le-studio-makers.js` exits if `LE.makers` is missing at load | Read `LE.makers` lazily; the start-screen entry can stay in a 1 KB stub |
| `le-studio-cutout.js` | Being reworked this wave | Its panel and toolbar hooks are a natural `panels` + idle case once it settles |
| `le-studio-fonts.js`, `le-agent.js`, `le-studio-agent.js`, `le-link.js`, `le-fx-boot.js` | Stubs (under 200 bytes) being written this wave | Declare them with `LE.modules.defer` when they land, unless they register `_start`, `drop` or render hooks used at boot |

## How to convert a module

1. Check what it does when its file runs: panel specs and `_rail` entries are fine; `init` hooks are fine; anything that changes
   rendering (`Scene` prototypes, `_start`, `drop`, `history` bookkeeping) is not, unless it moves elsewhere first.
2. Replace its `<script src>` tag in `studio/index.html` with `LE.modules.defer({...})` in the same place.
3. Run `node tests/run.js loading`, then `deep-links`, `shell`, `smoke` and the module's own tests.
4. The worker still precaches the file (it lives under `assets/`), so nothing changes offline.

## The budget

`tests/loading.test.js` fails when the gzip size of the studio's blocking scripts passes **480 KB** (or 1,800 KB raw). It was
432 KB gzip (1,596 KB raw, 27 scripts) on 12 November 2026. Raise it only with a reason written here.

## Measurements (12 November 2026)

`/studio/` cold, desktop 1440 × 900, 4× CPU slowdown, slow 4G (150 ms, 1.4 Mbit/s), text served gzip like CloudFront, median of 5.
Method: `tests/qa/perf.js` plus CDP network throttling and a server that gzips text.

| | Before | After |
|---|---|---|
| Time to interactive (start screen ready) | 5.8 s | 6.0 s (no measurable change; machine shared with other test runs) |
| First contentful paint | 4.6 s | 4.8 s |
| Requests before interactive | 56 | 56 (stock moved after, `le-load.js` added) |
| Transfer before interactive | 635 KB | 628 KB |
| Long tasks in the first ~10 s | 27, 4.1 s total, longest 578 ms | 30, 4.4 s, longest 548 ms |

The honest reading: the studio's first paint is drawn by `le-studio.js` after every boot-coupled module has run, so deferring one
library does not move it. The mechanism is in place; the gain comes when recipes, export, privacy and makers are converted as above
(about 72 KB gzip of the 432 KB; not measured yet).
