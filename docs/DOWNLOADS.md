# Download policy

Set by the owner, 12 November 2026. One rule for every part of the app that fetches something large: features, on-device models, fonts, packs. Feature code does not show its own download prompts; it asks `LE.downloads`.

## The rules

1. **Do not keep asking.** Download prompts and size notes appear as rarely as possible. The app decides from how the person uses it.
2. **One setting**, in Settings and in the storage manager: "Downloading features for offline use"
   - **Automatically, as I use them** (default). Things download in the background when a feature is used or is likely to be used next. No prompt for ordinary downloads; a quiet progress chip only.
   - **Always ask first.** One short question the first time each feature needs a download; the answer is remembered.
   - **Download now:** four buttons, each showing its size once: **Basic editor**, **Basic editor + models**, **Expert editor**, **Everything** (both editors and all models).
3. **Quality first, then speed.** When there are several options for the same job (for example background-remover models), pick the best-quality one this device can run well according to `LE.support`; among equals, the faster. Never pick a faster, worse option just to save time. If the best one is not on the device yet, use the best one that is and fetch the better one in the background for next time.
4. **Small enough means all at once.** If the editor's code and built-in data (not models, not the font library) is under 25 MB to transfer, download the whole editor on the first visit instead of feature by feature. The same test is applied to Basic + Expert together.
5. **When a question is still right, ask once:** a single download above the automatic limit, a metered or data-saver connection, or not enough free space. Say the size in whole megabytes, what it is for in a few words, and remember the answer.

## Numbers

| Thing | Value |
|---|---|
| Whole-editor threshold | 25 MB transfer size |
| Automatic limit per download (auto mode, unmetered) | 60 MB |
| Metered or data-saver connection | ask above 5 MB |
| Free space | never fill past the storage manager's budget; ask if a download would |

## Contract for feature code

```
LE.downloads.mode()                      → 'auto' | 'ask'
LE.downloads.request({ id, name, bytes, kind: 'feature'|'model'|'font'|'pack', reason })
                                         → Promise<{ ok, why }>   // resolves at once when no question is needed
LE.downloads.track(id, { name, bytes })  → { progress(loaded), done(), fail(err) }   // one shared, quiet progress chip
LE.downloads.pick(options)               → the option to use now, and the one to fetch for next time
     options: [{ id, quality, speed, bytes, supportId, cached }]
LE.downloads.packs()                     → [{ id: 'basic'|'basic+models'|'expert'|'all', bytes, done, download() }]
```

Feature-detect it: when `LE.downloads` is missing, download without asking if the item is 60 MB or less and ask once otherwise.

## Implementation (12 November 2026)

`assets/js/le-downloads.js` + `assets/css/le-downloads.css`, loaded on every page by the loader at the end of `assets/js/app.js`.
Sheets reuse `le-pwa.css`. Tests: `tests/downloads.test.js`.

### Full API

```
LE.downloads.mode() / setMode('auto'|'ask')
LE.downloads.request({ id, name, bytes, kind, reason, confirmed, quiet })
     confirmed: true  the person just tapped a button that showed the size: only free space can stop it (no question)
     quiet: true      never show a sheet (background use): { ok:false, why:'ask' } where a question would be needed
     why: 'auto' | 'remembered' | 'kind' | 'asked' | 'confirmed' | 'not-now' | 'declined' | 'space' | 'ask'
LE.downloads.track(id, { name, bytes, cancel }) → { progress(loaded, total?), done(), fail(err), onCancel(fn) }
LE.downloads.pick(options) → { now, next, ranked }   options may carry fetch({ signal }) so `next` is fetched in the background
LE.downloads.packs() → [{ id, name, about, bytes, raw, gzip, files, state, done, progress, empty, download(), cancel(), remove() }]
LE.downloads.used(featureId)          a usage signal (feature modules call it when the person uses something)
LE.downloads.want({ id, name, bytes, kind, reason, files | fetch })   fetch this when idle
LE.downloads.pending() / log() / usage() / forget()
LE.downloads.on('request'|'deferred'|'done'|'fail'|'cancel'|'packs'|'log'|'used'|'mode'|'background'|'forget', fn)
     (also window events 'le-downloads:<name>')
LE.downloads.open()                   the settings sheet; also ?downloads=1 or #downloads on any page
LE.downloads.renderSettings(el), studioRow(ctx, host), ready (Promise of packs), refresh(), manifest()
```

### How the rules are applied

- **Auto mode**: silent when `bytes` ≤ 60 MB (5 MB when metered), it fits in free space and, for fonts (or `budget: true`), in the storage manager's download budget. Otherwise one sheet.
- **Metered**: `navigator.connection.saveData`, `type === 'cellular'` or `effectiveType` of `slow-2g`, `2g` or `3g`. Where the API is missing (Safari, Firefox) the connection counts as unmetered.
- **Space**: `navigator.storage.estimate()`. A download that would leave less than `min(20 MB, 5 % of the quota)` is refused with one polite sheet ("Not enough space … Free up space"), at most once per item per session.
- **Remembered**: "Download" is remembered per id (localStorage `le-downloads`); "Don't ask again for this kind" remembers the answer for the kind (feature, model, font, pack); "Not now" is remembered for the session (sessionStorage `le-downloads-session`) and the item is listed under "Waiting for your OK" in the settings, with a Download button.
- **Ask mode**: one question per id, remembered; no background downloads.
- **Chip**: one for the whole app, bottom left (above the studio's phone tab bar), appears only for downloads still running after one second, aggregates (`Downloading 2 items · 42%`), taps open a small list with Cancel, never a modal. Pack downloads run in the worker; a page opened meanwhile asks the worker (`le-pack-status`) and shows the same chip.
- **pick**: tiers `ok`, then `limited`, then `unknown` from `LE.support.check(supportId).status`; within a tier highest `quality`, ties by `speed` (number, or fast/medium/slow). `now` = the best cached option, else the best within the automatic limit, else the best; `next` = the best when it is not `now`, not cached, within the limit and the mode is auto.
- **Background**: only in auto mode, online, unmetered, battery charging or above 20 % (where `getBattery` exists), after 4 s without input, when the browser is idle. Any pointer, key, wheel or touch aborts the current file at once; it resumes later (files already stored are skipped). Candidates: wanted items (pick's `next`, `want()`), the files of features used twice in 30 days or once in the last 3 days (`features` in `packs.json`: cut-out → AI engine + Quick model; OCR → engine + English; expert → expert files), and fonts used by designs saved on this device (only where `LE.fonts` runs). Every download is logged in "What downloaded and why".
- **Usage signals** (localStorage `le-downloads-usage`): `{ f: { featureId: { n, first, last } } }`, at most 200 ids. Recorded automatically for studio tools (`data-panel-btn`, `data-cmd="tool:…"`), `data-le-feature` controls, `?tool=` deep links and page visits; feature code may call `used(id)`. Nothing leaves the device. Cleared by "Forget what I use", "Reset all settings" and "Erase everything" in the storage manager.

### Packs (`assets/data/packs.json`, generated by `scripts/build.js`)

| Pack | Contents |
|---|---|
| Basic editor | What the worker precaches: pages, both studios, every tool, vendor code and built-in data, minus Expert files |
| Models (hidden; part of the combinations) | `assets/models/**` (cut-out models, OCR English data, and any model present on this copy, e.g. `assets/models/local/`), `assets/vendor/ort/**`, `assets/vendor/tesseract/**` |
| Expert editor | `assets/js/fx/**`, `assets/js/expert/**`, `assets/css/expert.css` (path rules, so new files are picked up) |
| Basic editor + models | both |
| Everything | Basic + Models + Expert, plus `LE.fonts.saveOffline('all')` (or `saveAllOffline`) and `LE.assets.saveStyleOffline('all')` |

Not in any pack: labs pages, `pdf-lib-crypt`, the lucide/phosphor/emoji search data, collage sample photos and layouts (they stay on demand).

Sizes: `raw`, `gzip` (level 9) and `transfer` — gzip for text files of 1,000 bytes to 10 MB (what CloudFront compresses; it may
serve Brotli, which is smaller), raw bytes for everything else (models, `.wasm`, images, fonts). The 25 MB decisions use `transfer`.
1 MB = 1,048,576 bytes everywhere in this module. gzip sizes are cached in `node_modules/.cache/localeditor/gzip-sizes.json`.

Decisions (printed by the build, written into `packs.json`, guarded by `tests/downloads.test.js`):
- `basicFirstVisit`: Basic < 25 MB → the worker precaches it on the first visit (today: 3.0 MB). Otherwise only the critical files are precached and the rest is kept as it is used.
- `expertWithBasic`: Basic + Expert < 25 MB → the Expert files are part of that first download. Otherwise the first time any Expert file is fetched (Expert mode switched on, or a design that needs the renderer) the worker stores a marker in `le-packs-v1` and downloads the rest of the Expert files in the background (progress in the chip); every later version's install adds them to its own download, so they stay offline. The Expert pack button does the same on request.
- `LE_PACK_DECISION=split|whole node scripts/build.js` pins a decision (tests).

Pack downloads go to the worker (`le-pack` message): resumable (stored files with the right size are skipped), cancelable (`le-pack-cancel`), verified (every file stored, sizes match the manifest), three files at a time, progress to every open page (`le-pack-progress`). Files go where the storage manager lists them: models and runtimes in `le-models-v1` (with `x-le-model`), app files in the current version. The worker now also keeps `assets/vendor/tesseract/**` in `le-models-v1`. Without a worker (blocked, first second of the first visit) the page downloads the files itself.
