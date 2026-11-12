# LocalEditor handoff

Snapshot: **7 November 2026, about 15:25 IST**. Written so a new Cursor agent or a cloud coding session can continue without this chat.

Read this file first. Then `docs/spec-collage-stock.md` (collages and stock) and `docs/spec-round3.md` (icons, colours, panel design). Do not commit unless the user asks. Do not commit API keys.

Three agents were told to **stop adding features and leave a stable build**. They may still be writing when you start. Re-read the files below before editing them.

## Product

LocalEditor (https://localeditor.net/) is a static S3 + CloudFront site. It is an offline PWA: a Canva-style photo studio, a PDF studio, and file-to-PDF conversion. Everything runs in the browser. No uploads, no backend, no CDN at runtime. Fonts and assets are self-hosted.

Recipes (`.leworkflow`) are declarative only. They must never execute JavaScript, HTML, or scripts.

Repo root for the site: `instant-tools/` inside the workspace `Portfolio/instant-tools`. Pages are plain HTML. Scripts are ES2018 IIFEs on `window` (`window.IT` from `app.js`, `window.LE` from the engine). `body.le-built` pages fill `.le-side[data-fill]` and `.le-top[data-fill]` from `app.js`. `data-root="../"` is the relative root.

## How to run

```powershell
cd C:\Users\soumy\Desktop\Portfolio\instant-tools\instant-tools
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/studio/` and `http://127.0.0.1:8765/pdf-studio/`.

Before judging the UI, unregister the service worker, clear Cache Storage, and set `Network.setCacheDisabled`. The service worker and HTTP cache have served stale CSS before. Rebuild the worker with `node scripts/build.js` after adding files that should be precached.

PowerShell has no `&&`. `node -e` with nested quotes is unreliable; use a temp script file.

Browser checks use the Cursor browser tools. An element-picker overlay sometimes swallows clicks. Drive the page with `Runtime.evaluate` or open a fresh tab. Clear device emulation (`Emulation.clearDeviceMetricsOverride`) before you finish.

## Hard rules

- pdf.js must always use `isEvalSupported: false` (CVE-2024-4367).
- HTML goes through DOMPurify. Sandboxed iframes have no `allow-scripts`.
- SVG sanitizers are DOMParser-based. Do not switch back to regex.
- Zip, canvas, and page caps stay. Imports reject `__proto__`, `constructor`, and `prototype`.
- SheetJS comes from `cdn.sheetjs.com` (CE 0.20.3), not npm 0.18.5 (CVE-2023-30533).
- Licenses: MIT / ISC / BSD / Apache / OFL only. Record new rows in `assets/vendor/LICENSES.md`. One exception, decided by the owner on 12 November 2026: the optional camera RAW decoder module may be LGPL (or the best-covering decoder's licence), downloaded on demand, replaceable, with its licence shown to the user. See `docs/EXPERT-MODE.md`.
- API keys live only in `localStorage` key `le-stock-keys`. Never log them. Never commit them.
- Do not precache `assets/photos/collage/` or `assets/data/collages/` or `assets/data/withicons/` or `assets/fonts/library/`. `scripts/build.js` `ON_DEMAND` already excludes those. Collage and withicons JSON is stale-while-revalidate into `le-assets-v1` via the nested pattern `/\/assets\/data\/[\w\/-]+\.json$/`.
- The primary action (`.btn-primary`; `.btn-gold` is its old name) has text that meets WCAG AA, 4.5:1, against its own background in both themes, verified by computed style (`h.inkContrast` in `tests/lib/harness.js`), not by a fixed hex. A broad `button { color: inherit }` rule has overridden the primary button before. Check computed colour, not just the class. Colours come from tokens (`docs/DESIGN.md`); gold and foil are retired.
- `le-engine.js` must be `var LE = global.LE = global.LE || {}`. Assigning `{}` wipes every other module.

## What is already built

### Engine (stable, tested earlier)

| Module | Role |
|---|---|
| `assets/js/le-engine.js` | `LE.applySteps`, recipes, store, handoff, zip, exif. Load first. |
| `assets/js/le-objects.js` | `LE.Scene` layered editor, `LE.lazy`, `LE.perf`. Empty image slots paint a dashed placeholder. `maskPath` is a sanitized SVG path clip. |
| `assets/js/le-fonts.js` | 44 families, files in `assets/fonts/library/` (~8.7 MB), loaded on demand. |
| `assets/js/le-assets.js` | Icons, stickers, emoji, shapes, colour sets, gradients, patterns. |
| `assets/js/le-pdf.js` | pdf.js 3.11.174 + pdf-lib + fontkit. Built-in PDF fonts do not go through `LE.fonts`. |
| `assets/js/le-convert.js` | mammoth, SheetJS, JSZip, DOMPurify, marked, html2canvas. PowerPoint `drawImage` includes width and height. |
| `assets/js/le-project.js` | Ledger and `.leproject` zip. Sanitizes `slot` and asset `source` attribution. Asset cap 80 MB; studio compresses before that. |
| `assets/js/le-stock.js` | **Done and browser-tested** (`scripts/test-stock.html`). See API below. |
| `scripts/build.js` | Generates `sw.js`. Last known precache before collage UI: 89 files. **Rebuild after this wrap-up.** |

Performance: `LE.device.tier()` is older / modern / desktop. `LE.perf.level()` is high / mid / low with `previewMax` 2400 / 1600 / 1000. Mode is `localStorage` `le-perf` (`auto` / `quality` / `saver`).

### Photo studio (round 3, verified by the photo agent)

Files: `studio/index.html`, `assets/css/studio.css`, `assets/js/le-studio.js`, `le-studio-panels.js`, `le-studio-color.js`, `le-studio-icons.js`, `le-studio-tools.js`, `le-project.js`.

Working and checked in light and dark, with zero console errors at the time:

- Download is the primary button: white on Lapis `--primary`, 5.1:1 (identity refresh, November 2026; it was dark ink on gold before).
- All 34 withicons styles, suggested palettes, style swap, offline save.
- Backgrounds: solids, 84 gradients, 32 patterns, 5 textures.
- Replace-all colours / fonts / styles across pages, one undo.
- Pages, QR, rulers and guides, PDF export of all pages, brand kit.
- Phone bottom sheet at 390 and 360. No horizontal overflow.
- Non-destructive resize from the original (chain is opt-in). Live text. `.leproject` round trip. Scrolling stage (`div.studio`, not `.studio`, because `body` has class `studio`).

Not click-tested in that pass: text-effect presets, photo effects, dropping a photo into a frame, format painter. Viewports 1280×560 and 1366×768 were only rendered at 1024px wide.

### withicons data

`assets/data/withicons/`: 34 style packs (icon SVG only), `index.json` **217 KB** (78 KB gzip), `palettes.json` **1.65 MB** (loaded only via `loadIconPalettes`), `previews.json` 77 KB. Raw pack total is about 133 MB. Do not put per-icon palettes back into `index.json`. Do not copy the palette table into every pack (that added ~2.5 MB × 34).

`iconPalettes(styleId)` is synchronous. Icon-specific palettes need `await LE.assets.loadIconPalettes(name)`. `svg()` stays synchronous and applies an icon-specific palette id only after that load.

### PDF studio (round 3 verified 7 Nov 2026, sign panel)

Files: `pdf-studio/index.html`, `assets/css/pdf-studio.css`, `assets/js/le-pdf-studio.js`, `le-pdf-studio-panels.js`, `le-pdf-studio-color.js`, `le-pdf-studio-graphics.js`, `le-pdf-studio-office.js`.

Script order in `pdf-studio/index.html` (all `defer`): app, engine, objects, fonts, assets, pdf, studio, color, panels, graphics, office.

In the code:

- Sign panel: classic inks, brand inks, “More inks” from `LE.assets.colorSets()`, recents, and the colour picker. Placed signatures can be tinted.
- Save PDF is the primary button (`--primary` / `--on-primary`, 5.1:1); while the Export panel is open the header's Save PDF steps back to secondary.
- Pen, marker, highlighter, and eraser keep their toolbar while drawing.
- Page scroll on `.ps-app` is locked.

Browser check (no further code changes): 53 named inks (24 classic, 7 brand, 22 from `colorSets()`) plus the colour picker. A placed signature recolored to metallic gold `#A67C00`. Save PDF, Use this signature, and Restore all computed to the primary-button ink in light and dark. At 390px the page does not overflow. Console stayed empty. The stray root `le-pdf-studio-panels.js` is gone.

Not retested in that pass: clicking an icon to confirm `loadIconPalettes`, the pen toolbar, scroll lock, and saving the PDF. Leave those unless a bug shows up.

Convert to PDF: `convert-to-pdf/index.html`, `assets/js/le-convert-ui.js`, `assets/css/convert.css`. Earlier harness: 79 convert checks passed, including a 3-slide PPTX.

### Stock API (`LE.stock`) — done

Loaded in `studio/index.html` after `le-assets.js` and before `le-objects.js`.

```
providers()                        // pixabay, pexels, openverse, unsplash; each { id, name, needsKey, hasKey, keyLabel, keyHelpUrl, keyHint, creditText, creditUrl, termsUrl, supports:{orientation,page}, status: ok|needs-key|rate-limited|error }
quota(provider)                    // { limit, remaining, at } from X-Ratelimit-* headers, or null
keys() / setKeys(partial)          // localStorage le-stock-keys (pixabay, pexels, unsplash strings; openverse object)
search(q, { provider, page, perPage, orientation })
registerOpenverse({ name, description, email })
tokenOpenverse()                   // client_credentials, refresh within 5 min of expiry
rateLimit()                        // ONLY after a token exists
sizedImportUrl(hit, maxEdge)
fetchBlob(url, { maxBytes })       // abort over 12 MB, fall back to thumbnail
compress(blobOrBitmap, { maxEdge, quality })
importHit(hit)                     // File + { width, height, type, source }
```

Providers:

- **Pixabay** `GET https://pixabay.com/api/` with `key`. Thumb `webformatURL`. Import `largeImageURL`. Never `imageURL` / original.
- **Pexels** `GET https://api.pexels.com/v1/search` with header `Authorization: <raw key>` (not `Bearer`). Thumb `src.medium`. Import `src.large2x`. Never `src.original`. Credit “Photo by X on Pexels”.
- **Openverse** `GET https://api.openverse.org/v1/images/?q=&page_size=20&mature=false`. Anonymous search works. Register `POST /v1/auth_tokens/register/`, then the user verifies email, then `POST /v1/auth_tokens/token/` as `application/x-www-form-urlencoded` `grant_type=client_credentials`. Use `Authorization: Bearer`. Standard tier is historically ~100 requests/minute. Anonymous `GET /v1/rate_limit/` returns **401**. Quota headers are not exposed to the page.

- **Unsplash** `GET https://api.unsplash.com/search/photos?query=&page=&per_page=20&orientation=landscape|portrait|squarish&content_filter=high`, headers `Authorization: Client-ID <Access Key>` and `Accept-Version: v1`. `keys().unsplash` is the Access Key only, never the Secret key. Thumb `urls.small` (hotlinked). Import `urls.raw` + `&w=<maxEdge>&fit=max&q=80&fm=jpg` (`sizedImportUrl` rebuilds these params and drops `w/h/crop/dpr/q/fm/fit`); never the full original. `license` "Unsplash License", `attribution` "Photo by X on Unsplash". `pageUrl` (`links.html`) and `photographerUrl` (`user.links.html`) carry `?utm_source=localeditor&utm_medium=referral`. **Download ping:** `importHit` fires a GET to `hit.downloadLocation` (`links.download_location`, must start with `https://api.unsplash.com/`) with the same auth headers, once per successful import, fire-and-forget. Errors: 401, or 403 without rate-limit signals, clears the key (needs-key); 429, or 403 with `X-Ratelimit-Remaining: 0` or "Rate Limit Exceeded" in the body, starts a cool-down (`Retry-After`, else 1 hour) and `status` becomes `rate-limited`. Demo apps get 50 requests/hour. Credit line: "Photos from Unsplash" linked to `creditUrl`.

Wikimedia originals (`upload.wikimedia.org` without `/thumb/` or `px-`, or `filesize > 4e6`) become `https://commons.wikimedia.org/wiki/Special:FilePath/<file>?width=<maxEdge>`.

Provider `status`: `needs-key` when a key is required and missing (also after a 401 clears it), `rate-limited` while cooling down, `error` after the last search failed for another reason, else `ok`. Openverse never needs a key.

Mocked tests: `node tests/run.js stock` (`tests/stock.test.js`, fixtures in `tests/fixtures/stock/`). The real provider APIs have not been called from the sandbox.

Browser test (`scripts/test-stock.html`): 4000×3000 JPEG 126,496 bytes → 2400×1800 JPEG 63,682 bytes. Openverse search `cat` returned 20 hits, no CORS error. Imported photo 144,024 bytes.

Local ingest in `le-studio.js` (`ingestPolicy`) keeps the original pixels of a photo up to a device-class ceiling on the long edge: desktop 8000, modern 6000, older 4096 px (`quality` mode moves up one class, to 12000 on desktop). Over the ceiling it reduces to the ceiling and toasts “This photo was reduced to N px wide to fit this device.” A file over 25 MB is re-encoded at the same pixel size (quality 0.92). `saver` mode keeps the old rules (8 MB, `previewMax * 1.4`, cut to `previewMax`). The editor previews from a bitmap capped at `previewMax`; export renders from the original. Export area caps live in `LE.Scene.render` and `maxScale()`: desktop 120 MP, modern 48 MP, older 17 MP.

### Collage / replace UI — wired and checked (7 Nov 2026)

`studio/index.html` loads `le-collage.js` then `le-studio-collage.js` after the panel scripts. `window.LEStudioCollage` exposes `renderCatalog`, `renderReplaceSheet`, `renderStock`, `applyTemplate`, `openReplace`.

Checked in the browser: Design → Templates still has the 8 text layouts plus built-in collages. Selecting a slot shows **Replace photo** with **Uploads | This device | Stock photos**. Uploads → Stock, Openverse search `flower`, returned 20 photos. `rateLimit()` is not called until an Openverse token exists. Keys button uses the primary-button ink (then `#2A1F0A` on gold; now white on Lapis). No script errors. Screenshot: `studio-replace-stock-flower.png` under the Cursor screenshots temp folder.

Not checked: importing a stock hit onto the canvas, the hover Replace chip at phone width, an attribution line on a selected stock photo. Apps → Collage is still the old six grids (grouped, so a cell is not its own slot) and has no Style collages entry. Leave those for the next session.

### Collage catalog — stable, empty slots on purpose

`assets/js/le-collage.js` loads `assets/data/collages/index.json`, then `assets/data/collages/<style>.json`, and rejects if a pack 404s. `studio/index.html` includes it before `le-studio-collage.js`.

Shipped: **50 styles, 50 templates** (one featured layout each). 40 are the classic styles. The other 10 are attached styles that did not already share a classic id (shape-based, circular, pinterest-aesthetic, junk-journal, magazine-cutout, ephemera, handwritten-journal, typography, editorial, digital-3d). Styles such as silhouette, coquette, and vaporwave are the classic entry. Index is 14.7 KB (2.3 KB gzip). All collage JSON is about 85 KB.

Slots have **no `photo` id**, so a missing file cannot 404. Applying a template fills slots from the user’s uploads when there are enough, otherwise from the pool.

The pool is **48 JPEGs, 4.3 MB**, in `assets/photos/collage/`, listed in `photos.json` with photographer, license, and source URL. Sources are Openverse (Flickr and StockSnap), CC0 or CC BY 2.0, longest edge about 640–960px. One search (`friends smiling outdoor adults`) returned 403 and was skipped; the other queries filled all 48 ids. `scripts/fetch-collage-photos.js` both downloads and re-indexes. These files stay out of the service-worker precache.

## Stable cut

`node scripts/build.js` was run after the catalog landed. **94 files precached.** `le-stock.js`, `le-collage.js`, and `le-studio-collage.js` are in the precache. `assets/data/collages/` and `assets/photos/collage/` are not.

In the browser, `LE.collage.index()` returned 50 styles and 50 templates. `loadStyle('coquette')` returned `coquette-01` with 3 slots and no photo ids. The pool of 48 photos was added after that check. Applying a collage should now fill empty slots from that pool. Do not start the “later” list until the user asks.

## Plans afterwards (do not start until the user says continue)

### Collages

Attached reference styles, **8–12 variations each** (page sizes 1080², 1080×1920, 1920×1080, 1600×900; slot count, rotation, palette, captions):

silhouette, panoramic, shape-based (heart, star, circle clusters), circular mosaic, streetwear, coquette, dark academia, cottagecore, Pinterest aesthetic, scrapbook, junk journal, newspaper, magazine cutout, washi tape, ephemera, travel journal, handwritten journal, typography, editorial, vaporwave, 3D digital.

The 40 classics (at least one featured template, already the minimum for stable): grid-2, grid-3, grid-4, masonry, mosaic, polaroid-wall, polaroid-scatter, film-strip, lookbook, moodboard, yearbook, family-cluster, honeycomb, diamond-grid, timeline, map-travel, postcard, instant-camera, torn-paper, comic-pop, heart-shape, circle-crop, star-mask, overlapping-cascade, bento-grid, magazine-cover, typography-poster, editorial-spread, newspaper, scrapbook, washi-tape, travel-journal, silhouette, panoramic, circular-mosaic, vaporwave, cottagecore, dark-academia, coquette, streetwear.

Featured collages also appear under Design → Templates. Photo slots are **not** grouped, so each cell stays selectable. Decor may be grouped. Apply fills slots from the user’s uploads when there are enough, otherwise from the pool, otherwise empty. Replacing a slot keeps crop, mask, radius, border, rotation, and shadow.

Slot shape:

```
slot: { id, label, photo }
```

Template shape:

```
{ id, style, name, w, h, bg, slots:[{ id, x, y, w, h, rot, radius, mask, maskPath, border, shadow, caption, photo, z }], decor:[scene layers] }
```

`mask` is a shape id (`heart`, `ellipse`, `star`, `rounded-rect`, `rect`). Silhouette uses `maskPath`.

### Stock UI polish

Uploads tabs: This device | Stock photos. Provider chips, infinite scroll, keys sheet (Pixabay key, Pexels key, Openverse register → “verify the email” → client id/secret → token). Show `rateLimit()` only when a token exists. After save, show only the last 4 characters of a secret. Attribution line when the selected asset has `.source`.

### Photo-engine requests still open

Workarounds exist in the studio. Real engine support is nicer but not required for the stable cut:

- Public `replaceDoc` / `batch`, `beginCrop` / `editText`.
- Draw-tool options, open shapes, `setWorkspace`.
- Render downscaling, asset category API, larger phone handles.
- Meme captions bug.
- Gradient stops at any position; conic and mesh as real fills (today resampled or rasterized).
- Tiled image backgrounds.
- Keep background `spec` and withicons palette fields on svg layers through history.
- Non-destructive image-effects pipeline.
- Public snap hook, history-free preview API, multi-page history.

### Other deferred product work

- Click-test text effects, photo effects, frame drop, and format painter.
- Full-width checks at 1280×560 and 1366×768.
- withicons deploy weight (~133 MB). Packs are lazy; do not precache them. Slimming SVG bodies further is optional.
- Unsplash search is in the studio (user pastes an Access Key). `PIXABAY_KEY`, `PEXELS_KEY`, `UNSPLASH_ACCESS_KEY` in the environment are still read by `scripts/fetch-collage-photos.js` for the build-time pool.

## File map for the next session

Touch for the stable cut:

- `studio/index.html` (script tag)
- `assets/js/le-studio.js` (replace command → `openReplace`)
- `assets/js/le-studio-panels.js` (templates tab + uploads stock tab, if the collage script does not already hook them)
- `assets/js/le-studio-collage.js`
- `assets/js/le-collage.js` (new)
- `assets/data/collages/**`
- `assets/photos/collage/**`
- `scripts/build-collages.js`, `scripts/fetch-collage-photos.js`
- `scripts/build.js` only if `ON_DEMAND` regressed
- `assets/css/studio.css` append only (`sx-cg-`, `sx-rep-`, `sx-stock-`)

Do not rewrite `studio.css` or `le-pdf*` while finishing collages. Do not fight a live agent editing the same file.

## Pickup prompt

Paste this into a new session:

> Read `instant-tools/docs/HANDOFF.md`. The stable cut is the photo studio with replaceable collage slots (empty until the user adds a photo), stock search, and the PDF sign panel. Next product work is the “Plans afterwards” list, starting with the compressed photo pool and the extra collage variations. Do not commit unless asked.
