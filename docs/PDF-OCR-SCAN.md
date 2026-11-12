# Make searchable (D9) and Scan with camera (D10)

Product build of the two prototypes in `docs/research/pdf-ocr-scan.md`. Both run on the device; nothing is uploaded.

| | Make searchable (D9) | Scan with camera (D10) |
|---|---|---|
| Module | `assets/js/le-pdf-ocr.js` + `assets/css/pdf-ocr.css` (prefix `por-`) | `assets/js/le-pdf-scan.js` + `assets/css/pdf-scan.css` (prefix `psn-`) |
| Engine | `window.LE.ocr` (Part 1 of the file) | `window.LE.scan` (Part 1 of the file) |
| Studio part | `PS.ocr` (Part 2) | `PS.scan` (Part 2) |
| Downloads | engine 3.9 MB + English 4.1 MB, on first use, through `LE.downloads` | none |
| Tests | `node tests/run.js pdf-ocr` | `node tests/run.js pdf-scan` |
| Lab | `labs/pdf-ocr/` (now loads the product module) | `labs/scan/` (now loads the product module) |

## Where people find it

- **Scan** tab in the PDF studio rail (panel id `scan`, `noDoc: true`): the "Read the text in scans" card and the "Scan paper with your camera" card.
- **Offer bar**: when a document is opened (or pages are added) and some pages are pictures with no text, a bar at the bottom of the stage says so, with **Make searchable** (starts at once with the remembered options) and **Not now** (remembered for that set of documents in this session).
- **Start screen tile** "Scan with camera" (after "Images to PDF"): one tap at phone size.
- **Find sensitive data** (Protect): when the search reports picture pages, a hint offers **Read the scans and search again** (see the D2 hook below).
- Deep links: `pdf-studio/?panel=scan` opens the panel; `pdf-studio/?panel=scan&job=camera` opens the scanner.

## Flows

**Make searchable.** Language (only when this copy has more than English), quality (Faster 150 dpi, Standard 200 dpi, Sharper 300 dpi on computers only), "Only pages without text" (on). The run asks `LE.support.gate('ocr.read')`, then `LE.downloads.request()` when the engine or language is not stored yet (silent in automatic mode up to 60 MB; one question in "ask" mode or on a metered line), shows the studio's progress card ("Getting the text reader ready (first time only) · 2.1 of 7.8 MB", "Page 3 of 12 · about 40 s left") and the shared download chip. **Cancel** aborts at once: it terminates the worker, the document is not touched. On success each source document is replaced by its searchable copy with one undo step ("Make searchable"); page rotation, annotations and form values carry over. The panel then shows pages read, words found, uncertain words (confidence under 60) and pages that were hard to read (under 5 words or confidence under 50, with "Try a sharper quality"). **Copy text** and **Save text (.txt)** use the document's text (pdf.js), so they include pages that already had text.

**Scan with camera.** Start view: Take a photo (live camera when `navigator.mediaDevices.getUserMedia` exists on a secure page, otherwise the system camera / photo chooser), Choose photos (several), and on touch devices "Use the camera app" (`capture="environment"`, full resolution). Camera view: back camera (`facingMode: environment`, 4032×3024 then 1920×1080 then any), live page outline every 450 ms (solid Lapis when confident, white dashed when not), shutter (72 px). Corners view: detected outline with four handles (44 px targets, keyboard-reachable invisible buttons that move with the arrow keys), magnifier while dragging, Find page, Whole photo, Rotate left/right. Clean view: Original, Document (black on white), Colour boost, Greyscale (engine ids `none`, `bw`, `whiten`, `gray`). Tray: thumbnails, move earlier/later, adjust, retake, delete, add more; page size A4 / Letter / Same as photo; "Make it searchable too"; **Make PDF** (opens it in the studio: a new document, or pages appended to the open one) or **Download PDF** (keeps the pages for another try); Discard. Camera denied, missing or busy each get one plain sentence and the photo chooser stays one tap away. The camera stops when the view changes and when the tab is hidden.

## APIs

```
LE.ocr.load(lang, onProgress, signal)               engine + language into a worker
LE.ocr.recognize(canvas, { lang, signal, psm, dpi, minConfidence, timeoutMs }) -> { text, words, lines, confidence, ... }
LE.ocr.status(pdfBytes | pdfjsDoc, { maxPages, signal }) -> { count, pages:[{ page, chars, picture, scan }], scans:[0-based], text:[0-based] }
LE.ocr.makeSearchable(pdfBytes, { lang, pages (1-based), dpi, skipTextPages, signal, onProgress, minConfidence })
                                                    -> Uint8Array with .report { pages:[{ page, words, uncertain, confidence, ms, weak } | { page, skipped }], words, uncertain, skipped, weak }
LE.ocr.available() -> Promise<[lang ids on this copy]>   from assets/data/packs.json (LE.downloads.manifest()); English always
LE.ocr.defaults() -> { dpi, maxPixels, maxDpi, small }    150 dpi and 4.5 MP pages on phones and devices with ≤ 4 GB
LE.ocr.languages() / languagesWithCache() / cachedLanguages() / engineCached() / engineBytes() / clearCache(id | 'engine')
LE.ocr.unload()                                     terminate the worker (frees 100–200 MB)

PS.ocr.run({ lang, dpi, all })                      the studio job (gate, download, progress, cancel, swap with undo)
PS.ocr.readJobs([{ bytes, pages }], { label, lang, dpi, skipTextPages }) -> [Uint8Array]   progress card + chip + cancel, no swap (used by D2 and D10)
PS.ocr.status() / check() / allText() / copyText() / saveText() / addSection({ order, render }) / state

LE.scan.detect(source, { maxSide }) / warp(source, corners, { maxSide, maxSource, aspect }) / enhance(canvas, mode) / rotate90(canvas, q)
LE.scan.toSource(blob, { maxSide }) -> canvas (EXIF orientation applied, capped)
LE.scan.exportBlobs([{ out: Blob, mode }], { size: 'a4'|'letter'|'fit', dpi, onProgress, signal }) -> Uint8Array
LE.scan.exportPdf([{ canvas, mode }], opts)         (lab API, kept)
LE.scan.limits() -> { maxSource, outSide, warnPages, maxPages, small }
LE.scan.camera.supported() / start(video) / capture(video) / stop(video)

PS.scan.open({ camera }) / close() / addPhotos(files) / makePdf('studio' | 'download') / state
```

The searchable layer is Tesseract's GlyphLessFont in text render mode 3 (invisible), one `Tm`/`Tf`/`Tz` per word, added after the page's own content; the page image is not changed. pdf.js is always opened with `isEvalSupported: false`.

## Hook in Find sensitive data (D2)

Two lines in `assets/js/le-pdf-security.js`, both no-ops without this module:

1. The search calls `(SEC.findWith || API.findSensitive)(src.bytes, { terms })` instead of `API.findSensitive(...)`. `SEC.findWith` (set by `le-pdf-ocr.js`) passes straight through unless the person asked to read the scans; then it finds the picture pages (`LE.ocr.status`), reads them into a temporary searchable copy (`PS.ocr.readJobs`, with Cancel), searches that copy, and marks matches on those pages `fromScan: true, possible: true` with " · read from a scan, please check" in the label, so they start unticked and the person confirms each one. The open document is not changed. Cancel falls back to the ordinary search.
2. After the "this page is a picture" notes: `if (SEC.scanHint) { var hint = SEC.scanHint(h); if (hint) s.appendChild(hint); }`. The hint names the scanned pages and has the **Read the scans and search again** button.

Redaction of a scanned page rasterises it (existing D1 behaviour), so an invisible text layer on that page is removed with it.

## Memory rules

- **One page at a time.** Make searchable renders one page with pdf.js, cleans it, encodes a PNG for the worker and releases each canvas (`width = height = 1`) before the next page; `page.cleanup()` after each page. pdf-lib holds the document itself (the file size), nothing per page.
- **Caps.** Working image ≤ 9 MP on computers, ≤ 4.5 MP on phones and devices reporting ≤ 4 GB (`LE.ocr.defaults()`); 300 dpi is offered on computers only. Scanner photos are capped at 3600 px (2400 px on phones, 2000 px at ≤ 2 GB) while editing; finished pages at 2339 px (A4 at 200 dpi), 1754 px on phones.
- **Finished scan pages are files, not bitmaps.** Each page in the tray is a JPEG (or PNG for Document mode) Blob plus a 220 px thumbnail URL; the source photo is kept as the picked File or a JPEG Blob so "Adjust" can re-open it. A 50-page scan holds 50 compressed files (typically 150–400 KB each) and one decoded photo at most. `warp()` reads the source canvas directly when it is already within the cap, and drops its own pixel copy as soon as the warp is done.
- **PDF export decodes one page at a time.** JPEG pages are embedded as they are; Document pages are decoded, packed to 1 bit per pixel and released.
- **Workers end with the job.** `LE.ocr.unload()` runs at the end of every studio job (success, error or cancel); WebAssembly cannot be interrupted, so Cancel terminates the worker.
- **Undo keeps the previous document** (bytes and its pdf.js handle) until the studio is closed, like every other studio document.
- **Phone warning.** At 30 pages on a phone (80 on a computer) the scanner suggests making a PDF and starting a new scan; 200 pages is the hard limit.

## Caches (owner, size, clear)

| Cache | Owner | Size | Listed / cleared in |
|---|---|---|---|
| Cache Storage `le-models-v1`, `x-le-model: ocr-engine` (`assets/vendor/tesseract/tesseract-core-simd-lstm.wasm.js`, or the plain core without SIMD) | `le-pdf-ocr.js` | 3.9 MB | Storage manager → AI models → "Text reader" (named with `LEPwa.describeModel`); `LE.ocr.clearCache('engine')` |
| `le-models-v1`, `x-le-model: ocr-<lang>` (`assets/models/ocr/eng.traineddata`, `more/<id>.traineddata`) | `le-pdf-ocr.js` | 4.1 MB English, 1.1–2.3 MB others | Storage manager → AI models → "Text reader: English"; `LE.ocr.clearCache(id)` |
| `le-models-v1` entry for `worker.min.js` (only when the service worker fetched it) | service worker | 0.1 MB | AI models (by file name) |
| `localStorage` `le-ocr-lang`, `le-ocr-dpi`, `le-scan-mode`, `le-scan-size`, `le-scan-ocr` | the two modules | a few bytes | "Reset all settings" |

The scanner itself stores nothing on the device: pages live in memory until Make PDF, Discard or closing the tab.

## Device support (`LE.support`)

| Id | Needs | Wants | Memory | Notes |
|---|---|---|---|---|
| `ocr.read` | `wasm`, `worker` | `wasm-simd`, `cache-storage`, `device-memory-4gb` | 350 MB | Gated when the job starts. Unknown answers (Safari and Firefox do not report memory) leave "Try anyway". Success and failures are recorded. |
| `scan.camera` | `camera`, `secure-context` | `device-memory-4gb` | 250 MB | `degraded`: Try anyway is always offered; without the API the photo chooser opens instead. |
| `scan.cleanup` | `canvas-2d` | `device-memory-4gb`, `createimagebitmap` | 250 MB | Everything except the live camera. |

## Measured on this machine

See the report for the numbers of this build (headless Chromium, shared 4-vCPU Xeon; times ±30 %). The research note has the accuracy tables for the same engine.

## Limits

- Accuracy is measured on rendered and synthetically degraded pages, not on real scanner or phone output; tables with ruled lines and very small print (under about 7 px x-height) are the weak spots. Matches read from scans are never auto-ticked for redaction.
- Right-to-left text layers (Arabic) and Devanagari are the least tested part of the PDF writer; only pdf.js was used to check the text layer (not Acrobat, Preview or Chrome's viewer).
- Page detection is right about 3 times in 4 on hard photos; the corner editor is always shown. Curled pages are straightened as flat pages. No blur or glare warning yet.
- No phone, iOS or real camera was available here: the camera path was tested with a canvas stream standing in for the camera. iOS Safari stills come from the video frame; "Use the camera app" is the better path there.
- HEIC photos open only where the browser decodes them (Safari).
- One language per run (the engine supports `eng+hin`; the panel does not offer combinations yet).

## Build and hosting notes

- `assets/vendor/tesseract/` and `assets/models/` are already outside the precache (`ON_DEMAND` in `scripts/build.js`) and inside the `ocr` feature group (`FEATURE_FILES`), so the background downloader can fetch them for people who use the feature. The two new modules and CSS files are ordinary app files and are precached with the PDF studio.
- Serve `.traineddata` with a compressible type or pre-gzipped (see the research note), otherwise first use is 8 MB instead of 3.5 MB on the wire.
- `scripts/fixtures/scanned.pdf` is generated by `node scripts/fixtures/make-scanned-pdf.js` (two scanned pages, one text page).
