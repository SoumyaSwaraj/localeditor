# Light first load (roadmap L1)

Owner, 12 November 2026: "making this whole setup very light weight initially and unlocking features to download as people use
them in the background." The photo studio, the PDF studio and the home page load a small **core** first. Everything else loads
when it is first used, when a link or a document needs it, or in the background once the device is idle. Offline nothing
changes: the worker still keeps every file of the installed app (see "Offline" below).

## Budgets (`tests/loading.test.js`)

gzip (level 9) of what the page's HTML loads before it is interactive: `<script src>` that is not `async` (defer counts) and
`<link rel="stylesheet">`. Raise a budget only with a reason written here.

| Page | JS | CSS | Total | Budget (JS / CSS / total) | Before (12 Nov) |
|---|---|---|---|---|---|
| `/studio/` | 198 KB | 41 KB | **240 KB** | 201 / 44 / 242 KB | 551 + 72 = 623 KB |
| `/pdf-studio/` | 242 KB | 41 KB | **283 KB** | 248 / 44 / 290 KB | 490 + 59 = 549 KB |
| `/` (home) | 14 KB | 30 KB | **44 KB** | 20 / 34 / 90 KB | 13 + 30 KB, plus 83 KB of install/support/download code before the load event |

The studio's target is 240 KB (it was 250 until 13 November); it sits right at it, so the next module that grows the core must
give something back. The PDF studio and home rows are the 12 November measurements; their budgets are in "Budget changes".

## The core

**Photo studio** (`studio/index.html`, in order): `app.js`, `le-engine.js`, `le-load.js`, `le-objects.js`, `le-project.js`,
`le-fx-boot.js`, `le-studio-panels.js` (the everyday panels: Design's frame, Elements, Text, Uploads, Draw, Adjust, Filters,
Effects, Edit, the Apps list), `le-studio-lazy.js` (the loader map), `le-studio.js`, `raw/le-raw-studio.js`; styles
`app.css` (all five themes' tokens stay here), `le-objects.css`, `studio.css`. That is enough to open or drop a photo, see it,
pan and zoom, adjust, filter, crop, add shapes, undo, autosave and restore.

**PDF studio** (`pdf-studio/index.html`, all `defer`): `app.js`, `le-engine.js`, `le-objects.js`, `le-fonts.js`,
`le-fonts-originals.js`, `le-assets.js`, `le-pdf.js`, `le-pdf-studio.js`, `-color`, `-panels`, `-graphics`, `-office`,
`le-load.js`, `le-pdf-studio-lazy.js`; styles `app.css`, `le-objects.css`, `pdf-studio.css`. That is the viewer and the everyday
panels (Pages, Edit, Sign, Forms, Tools, Convert, Export). pdf.js, pdf-lib and fontkit load when a PDF opens (`LE.pdf.ready()`),
as before.

**Every page** (`app.js`): `le-pwa.js`, `le-support.js`, `le-downloads.js` and their CSS now load **after the load event**, when
the main thread is idle (`window.__leLate`). `le-pwa.js` is the always part (15 KB; it was 32): install state, the install
prompt, notices, worker registration, updates and update safety, limits, launch files. The storage manager, the storage report
and clearing, backup, erase and the install chooser are `le-pwa-more.js` (20 KB), which `le-pwa.js` loads on first use: Install
app, Storage, `?storage=1`, `#storage`, a low-space notice's buttons, or a call to `LEPwa.openStorage`, `openChooser`, `report`,
`plan`, `freeUpSpace`, `clearCategory`, `trimVersions`, `enforceLimits`, `backup`, `eraseEverything`, `repairAppFiles` (each
answers with the same promise as before; `install()` now answers once the chooser is open). The housekeeping pass (limits, at
most every 6 hours, when idle) also loads it. The code was moved, not rewritten; the update functions are untouched. They load at once for `?install=`, `?storage=1`, `#storage`, `?share-target=`,
`?shared=`, or when Install app / Storage is tapped before they arrived (the tap is then carried out). The install prompt is still
caught early by `app.js`; the worker registers a moment later than before; update safety is untouched.

No vendor library (fontkit, SheetJS, pdf-lib, pdf.js and its worker, mammoth, html2canvas, JSZip, the WOFF2 decoder) is requested
before a studio is interactive: they were already loaded through `LE.lazy` where they are used (PDF export, office files, fonts).
No font or image blocks the first paint: the default theme uses system fonts, `@font-face` rules use `font-display: swap`, and
the home page's only preload is its hero picture.

## The mechanism: `LE.modules` (`assets/js/le-load.js`)

A page's loader map declares each deferred module with `LE.modules.defer({...})`. Modules load one after another on one chain (a
dependency always runs first), CSS before script, so a panel is never drawn unstyled. A failed download is never cached: the tag is
removed and the next request (Try again, the next tap) asks the network again. `LE.lazy` (in `le-objects.js`) and `le-pdf.js`'s
script loader now do the same.

When a module arrives after the studio booted:

- `init` hooks it added run once with the studio context; `ready` hooks run once with the boot result if the studio was already ready;
- calls to hooks listed in `replay` (a shortcut pressed before it arrived) are replayed to the module's own hooks;
- the rail is redrawn; the toolbar too when `retool` is set; the open panel re-renders when it belongs to the module (`panels`,
  `wrap`, `rerender`); `after(ctx)` runs.

| Option | Meaning |
|---|---|
| `id`, `src` | Required. `src` is relative to the page. |
| `css` | Its stylesheet, loaded before the script (and so before its first render). |
| `deps` | Module ids that must run first (`tools` needs `color`; `agent` needs `design`). |
| `label` | Plain words for "Downloading …" and errors. |
| `panels: { id: 'Title' }` | Panels the module provides. Until it arrives, the panel opens at once with a skeleton (`.skel` from `app.css`), loads the module and swaps in the real panel; on a slow network the skeleton says "Downloading …"; on failure it says so in plain words with **Try again**. Deep links (`?tool=`) and `openPanel(id, opts)` work with it. |
| `wrap: { panelId: fn(opts, ctx) }` | Views the module adds inside another panel; those views wait for it (with the same skeleton and retry). |
| `queue: 'onRecipeFile'` | A handler the module puts on `ctx.S` when its panel renders; calls made before it arrives are replayed. |
| `cmds: ['copyStyle']` | `data-cmd` commands the module registers. A stub loads the module, then runs the real command. |
| `on: ['select']` | Hooks that are the trigger to load (the first selection loads the modules that add selection tools). |
| `replay: ['key']` | Hooks whose calls are kept and replayed once it is there. |
| `retool` | Redraw the toolbar after it loads (it adds toolbar buttons). |
| `doc: fn(pages, project)` | Documents that need it. `ctx.startProject` (restore, open, import, design files) and version previews call `LE.modules.forDoc(project)` and wait for these before the first render — the same idea as `LE.fxBoot` for Expert data. A module that cannot load (offline and not kept) does not stop the document opening. |
| `param`, `hash`, `when` | Load at once: a URL parameter (`?make=`, `?agent`, `?link=`), a hash (`#d=`, `#ops=`), or a test (a session to resume). |
| `idle: rank` | Warm it when the device is idle (lower first). Without it, a module loads only when asked. |
| `features` | `LE.downloads` usage ids that move it up the warm-up order (panel ids count as `studio.<panel>` already). |

API: `LE.modules.need(id)`, `needAll(ids)`, `forDoc(doc)`, `loaded(id)`, `state(id)` (`waiting`, `loading`, `loaded`, `error`),
`list()`, `on(fn)` (also a `le-load` window event), `interactive()` (the PDF studio calls it on load; the photo studio's `ready`
hook does), `warmStatus()`.

**Warm-up.** It starts at the first pointer, key or touch after the app is interactive, or 5 s after it, whichever is first, then
loads one module per idle slot, most-used first (`LE.downloads` usage signals from the last 30 days, then `idle` rank). It never
runs offline, on a metered or data-saver connection (`navigator.connection` `saveData`, `cellular`, `slow-2g`/`2g`/`3g`), on a
device with under 2 GB (`navigator.deviceMemory`) or `LE.perf.level() === 'low'`, or when downloads are set to "ask"
(`LE.downloads.mode()`). `window.LE_LOAD_NO_WARM = true` turns it off (tests).

## The photo studio's map (`assets/js/le-studio-lazy.js`)

Sizes are gzip, script + CSS.

| Module | File | KB | Loads on | Warm rank |
|---|---|---|---|---|
| `fontlib`, `fontorig` | `le-fonts.js`, `le-fonts-originals.js` | 15, 4 | first edit or selection; Text panel; a document with text (scene redrawn after) | 0 |
| `assets` | `le-assets.js` | 19 | first edit or selection; Elements panel; a document with icons, stickers or library shapes | 0 |
| `export` | `le-studio-export.js` + css | 23+3 | Download panel; `ctx.exportImage`; a carousel document | 0 |
| `tools` | `le-studio-tools.js` + css (moved from studio.css) | 15+2 | first selection; Pages; format painter, QR, rulers commands; shortcuts (replayed); rulers left on; a document with frames | 1 |
| `fonts` | `le-studio-fonts.js` + css | 9+2 | Fonts panel | 1 |
| `panels2` | `le-studio-panels-more.js` + css (moved from studio.css) | 15+2 | Design's tabs (text layouts, Resize, Size history: a skeleton under the tab bar until it arrives); Position (arrange, layers); Your designs; Version history; Performance; Apps → Watermark, Meme, Palette, Metadata, Before / after, Upscale, Contact sheet | 1 |
| `color` | `le-studio-color.js` + css (moved) | 23+2 | colour picker (`_colorPop`); Replace, Brand kit; dep of tools, icons, background | 2 |
| `privacy` | `le-studio-privacy.js` + css | 7+1 | first selection; Elements; Redact; Apps → Metadata; redaction commands; a document with redactions | 3 |
| `background` | `le-studio-background.js` + css | 14+2 | first selection; Background panel; its commands; a document with an image background | 4 |
| `collage`, `collagelib` | `le-studio-collage.js` + css, `le-collage.js` | 24+4, 6 | first selection; Design → Templates; Uploads → Stock; Apps → Collage; Replace photo; a document with slots | 5 |
| `icons` | `le-studio-icons.js` + css (moved) | 8+1 | the 34 icon styles in Elements; its commands | 6 |
| `cutout` | `le-studio-cutout.js` + css | 26+3 | first selection; Remove background; Apps → Thumbnail; its commands; a document with cut-outs | 6 |
| `recipes` | `le-studio-recipes.js` + css | 17+4 | Recipes panel (`.leworkflow` launches queue onto it); Apps → Batch; a document with a recipe look | 7 |
| `makers`, `makerslib` | `le-studio-makers.js` + css, `le-makers.js` | 12+2, 25 | the start screen's makers row (a skeleton until the studio is interactive and idle, or scrolled to); Apps → Make; `?make=`; a document with a maker page | 8 |
| `stock` | `le-stock.js` | 10 | Uploads → Stock | 9 |
| `design` | `le-design.js` + css | 37+1 | `#d=` template links (also on hashchange); Open/Save design file; Share as template link; dropping a `.ledesign.json` | 10 |
| `agent`, `agentui`, `link` | `le-agent.js`, `le-studio-agent.js` + css, `le-link.js` | 37, 14+3, 18 | `?agent`, `#ops=`, `?link=`, a session to resume, `LE_AGENT_HEADLESS` (the command-line engine; it also loads `link`), File → Agent mode…, any call on `window.LEAgent` | never warmed |

Stubs kept in the core (each is replaced when its module arrives): `LE.design` (`isDesignFile` is synchronous; the rest forward),
`window.LEAgent` (every method forwards and returns its promise; `on()` returns a working `off`), `LEStudioCollage.openReplace`,
`LEStudioBackground.fromLayer`, `P._colorPop`, the Elements views `P._grids`, `P._stylesTab`, `P._withIcons`, `P._withIconsSearch`, the Design views `P._templates`,
`P._sizes`, `P._sizeHistory`, one-line panel specs (title and eyebrow) for panels a module draws (`fonts`, `background`, `layers`,
`recipes`, `projects`, `history`, `export`, `settings`),
the command stubs above, and the Apps → Thumbnail entry (registration data stays in the core).

## The PDF studio's map (`assets/js/le-pdf-studio-lazy.js`)

| Module | KB | Loads on | Warm rank |
|---|---|---|---|
| `security` (Protect) | 58+3 | its rail tab or panel; `?panel=security`; with Office kit | 1 |
| `office` (Office kit) | 69+5 | its start-screen link or panel; the Tools panel (it lists the kit first; a skeleton until it arrives); `?panel=office`; saved workflows opened from the system (`PS.office.open` stub). Edit and Forms draw at once, ask for it in the background and gain their office rows when it arrives. Bulk and Protect follow it in the background. | 2 |
| `bulk` (Bulk & protect) | 53+3 | its rail tab, start-screen link or panel; `?panel=bulk&job=…` | 3 |
| `docs` (Business docs) | 30+3 | its rail tab, start-screen link or panel; `?panel=docs` | 4 |
| `ocr` (Scan & read text) | 22+1 | its rail tab or panel; `?panel=scan`; **a PDF opening** (when idle, it checks for scanned pages and offers to read them) | 5 |
| `scan` (camera scan) | 25+3 | the Scan with camera tile; `?panel=scan&job=camera` | 6 |

The rail tabs and start-screen links are drawn by the map with the modules' own markup, in their usual order, so the first paint is
unchanged; the modules find them there. Their link styles are copied into `pdf-studio.css`. Protect swaps its stand-in tab for
its own (it picks a PDF first when none is open). Deep links load the module during parsing, so it is there by the load event,
when the studio applies `?panel=&job=`.

## Offline

`scripts/build.js` splits the Basic editor into app parts by following what each studio page loads, including the string paths in
the code it loads (`'../assets/js/…'`). The loader maps name every deferred file that way, so each stays in its studio's part:
`le-load.js` is shared (core); the photo studio's modules and CSS are in the design part; the PDF studio's in the pdf part. No
change to `build.js` was needed; `tests/loading.test.js` fails if a deferred file falls out of its part, and
`tests/install.test.js` loads every deferred studio module offline in a Design-only install.

## How to add a deferred module

Take its `<script>` (and `<link>`) out of the page and add one `M.defer({...})` line to the page's loader map. Then make sure nothing
the page does before a tap needs it: panel specs become `panels`; views inside other panels become `wrap`; its `data-cmd` names
go in `cmds`; hooks it needs to see from the start become triggers (`on`) or `replay`; anything another file checks synchronously
(`window.X && X.fn`) gets a stub in the map that forwards after `M.need(id)`; anything that changes how a document draws gets a
`doc` test. Registration data (rail entries, app tiles, start-screen links) stays in the map as data.

1. Its CSS goes in `css` (never in `studio.css`), so it loads before its first render.
2. `deps` for every module whose globals it reads while running.
3. A `doc` test if saved designs use it; a `param`/`hash` if a link opens it.
4. `idle` only if most people use it soon; agent-like tools stay "only when asked".
5. Tests that drive its API straight away call `await h.need(page, 'id')`.
6. Run `node tests/run.js loading`, the module's own suite, `deep-links`, `shell`, `smoke`, `install`.

## What still blocks, and why

| File | KB | Why it is core |
|---|---|---|
| `le-studio.js`, `le-studio-panels.js` | 53, 20 | The editor and the everyday panels. Elements, Effects and Uploads stay: other modules wrap them (`wrap`, `P._u`), so they cannot become placeholders without changing those modules. |
| `le-objects.js`, `le-engine.js` | 45, 29 | The scene and the adjust/filter pipeline draw the first photo. `le-engine.js` also carries the recipe catalogue and helpers for the tool pages. |
| `le-project.js` | 17 | Autosave, restore and the start screen's "Your designs"; `le-studio.js` will not start without it. |
| `app.js`, `app.css` | 14, 24 | The shell and the five themes on every page. |
| `studio.css` | 18 | The shell and core panels; rules for deferred modules' own elements moved out. |
| `raw/le-raw-studio.js`, `le-fx-boot.js` | 3, 1 | Capture RAW drops and Expert documents before the studio sees them. |
| PDF: `le-pdf.js`, `le-pdf-studio*.js`, `le-assets.js`, `le-fonts.js` | 31, 77, 19, 19 | The viewer, its panels, the sign panel's inks and text editing. `le-assets.js` and `le-fonts*.js` cannot be deferred from the map alone (see "Not done" below). |

## Measurements (12 November 2026, this machine, shared with other test runs)

Desktop 1440 × 900, 4× CPU slowdown, cache disabled, served from localhost, median of 3. Interactive = the studio's size cards and
scene are there; the PDF studio's `PS` and shell; the home page's `main`. Relative only. Method: the scratch script used for the
report (requests until interactive, gzip sizes as served by CloudFront).

| | Studio before | Studio after | PDF before | PDF after | Home before | Home after |
|---|---|---|---|---|---|---|
| Requests before interactive | 86 | 20 | 32 | 19 | 18 | 15 |
| JS before interactive (gzip) | 750 KB | 281 KB | 491 KB | 243 KB | 86 KB | 46 KB |
| CSS before interactive (gzip) | 82 KB | 52 KB | 68 KB | 41 KB | 40 KB | 40 KB |
| Time to interactive (4× CPU) | 2.3 s | 2.0 s | 0.81 s | 0.74 s | 1.25 s | 1.08 s |
| First contentful paint | 1.04 s | 0.93 s | 0.55 s | 0.42 s | 0.92 s | 0.40 s |
| Layout shift | 0.07 | 0 | 0.19 | 0.19 | 0 | 0 |

"JS before interactive" counts what had arrived when the page became interactive: on the studio it includes `le-pwa.js`,
`le-support.js` and `le-downloads.js`, which now start after the load event but still land during the studio's async boot.
The PDF studio's layout shift is the same before and after this work; it was not investigated here.

## Budget changes

- 13 Nov 2026: studio JS 214 → 217 KB and PDF studio JS 248 → 250 KB. `le-objects.js` grew 1.6 KB gzip for template fields (the detector that loads `le-variables.js` and the seam that draws a filled copy of a layer). The studio now blocks on about 257 KB against the 250 KB target; splitting `le-studio-panels.js` (20 to 25 KB) is the way back under.
- Template fields (`le-studio-variables.js` + `studio-variables.css`) are in the studio's loader map: first selection, the Fields and Create many panels, or a document with fields or values.
- 13 Nov 2026 (later): studio JS 217 → 201 KB, CSS 45 → 44 KB, total 259 → 242 KB; the target is now 240 KB. Measured 198.3 + 41.4 =
  239.7 KB (it was 215.6 + 42.8 = 258.4). `le-studio-panels.js` went from 36.9 to 19.2 KB: Design's tabs, Position, Your designs,
  Version history, Performance and seven small Apps moved to `le-studio-panels-more.js` (module `panels2`, 14.7 KB + 2.2 KB of
  styles moved out of `studio.css`); and the core's own Fonts, Recipes, Download, Background and Batch renderers were removed:
  their modules have replaced them since the loader map arrived, so they were never drawn. `le-pwa.js` (after the load event,
  not in this budget) went from 32.4 to 15.2 KB; see "Every page".

## Not done, and why

- **PDF studio: `le-assets.js`, `le-fonts.js`, `le-fonts-originals.js` stay blocking (38 KB).** The core calls them at boot
  (`le-pdf-studio-panels.js` preloads the default text font in its wiring) and about forty call sites assume they are there:
  some unguarded (`LE.assets.svg` in the Edit and Add panels), some guarded in a way that would fail quietly if the library
  were late (`le-pdf.js` embeds a built-in font when `LE.fonts` is missing; `PS.ensureSets` skips graphics on export; the bulk
  and Office kit modules read `LE.fonts`). Deferring them safely needs awaits in `le-pdf.js`, `le-pdf-studio.js`, `-panels`,
  `-graphics`, `-color`, `le-pdf-bulk.js` and `le-pdf-office.js`, not only map entries.
- **The start screen's makers row still loads the makers when idle.** Its thumbnails are drawn at runtime: each card runs its
  maker with sample values and paints the result (`thumb()` in `le-studio-makers.js`). A static list needs shipped thumbnail
  images first (25 small files from `scripts/`), then the row can be data in the map and a maker loads on tap.
