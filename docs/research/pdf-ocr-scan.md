# Scanned-PDF text (D9) and phone camera to clean scan (D10): research spike

Written 12 November 2026. Prototypes: `labs/pdf-ocr/` and `labs/scan/` (not linked from the site). All numbers were measured in this sandbox unless marked **estimate** or **unverified**.

## Answer

| Feature | Recommendation |
|---|---|
| **D9 Make scanned PDFs searchable** | **Ship as beta, English first.** Tesseract 5 (LSTM) compiled to WebAssembly, tessdata_fast, in a worker: about 8.1 MB first download (about 3.5 MB if compressed on the wire), 1 to 3 s per dense A4 page at 200 dpi on a desktop core, an estimated 6 to 12 s on a mid-range phone. With our own clean-up and de-skew step it read every degraded test page I made at 0 to 3 % character error (English); Hindi and Arabic work on clean pages but I only tested short samples. Beta, not stable, because (a) tables, low-resolution and phone-photo pages still lose words, (b) phones are slow, (c) I could not test any real scanner or phone output. |
| **D10 Camera to clean scan** | **Ship as beta, plain JS, no OpenCV.** Page detection with my edge-line finder found the page correctly (IoU 0.9 or better) in 77 % of a hard synthetic set and within one finger-drag (IoU 0.75 or better) in 84 %, in 76 ms median at 420 px on a desktop core. The classic OpenCV recipe on the same set got 40 % and 48 %, and costs 10.4 MB. The corner editor with magnifier is what makes it shippable: never trust auto-detection without showing the corners. Straightening, four clean-up modes and PDF export all work and are fast (0.3 s each for a 12 MP photo on this machine). The camera path itself was only tested with Chromium's fake device. |

If the owner expects "Adobe Scan on a phone: instant, always right": not yet. What would be needed: a measured pass on real mid-range phones for both features (I had none), and for D10 a proper capture-time quality gate (blur and glare warnings) and ideally a learned page-edge model, which would be a 1 to 3 MB model (none picked or tested here).

## D9. On-device text recognition

### Candidates

Licences: code and data separately. "Measured" means run in headless Chromium here.

| Option | Code licence | Data / weights licence | Size (raw; gzip) | Speed (A4, 200 dpi, 1 thread, this desktop core) | Accuracy (my fixtures) | Verdict |
|---|---|---|---|---|---|---|
| **tesseract.js 7.0.0 + tesseract.js-core 7.0.0 + `tessdata_fast`** (LSTM only, SIMD core) | Apache-2.0 (npm `package.json` and `LICENSE`) | Apache-2.0 ([tesseract-ocr/tessdata_fast `LICENSE`](https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE)) | worker 111 KB (34 KB gz) + core 3.90 MB (1.45 MB gz) + `eng` 4.11 MB (1.96 MB gz) = **8.1 MB (3.5 MB gz)** | 1.0 to 2.8 s dense page (measured, shared CPU); 0.4 to 1.0 s for sparse pages | clean pages 0 to 0.15 % CER; hard set 0 to 2.4 % CER with clean-up; see below | **Ship (beta), "Fast" tier** |
| same, `eng` from `@tesseract.js-data/eng` `4.0.0_best_int` (tessdata_best, integerised) | Apache-2.0 data (the npm package labels itself MIT) | Apache-2.0 | 5.2 MB (2.9 MB gz) | about 1.4 times slower than fast | clearly better on weak input: low-res serif page WER 1.1 % vs 4.5 %, phone-photo serif 2.6 % vs 7.8 % (raw images, no clean-up) | **"Better" tier, optional download** |
| `tessdata_best` float `eng` | Apache-2.0 | Apache-2.0 | 15.4 MB | 3 to 4 times slower than fast | no better than best_int on my fixtures | No |
| core variants: `relaxedsimd`, `simd`, plain (no SIMD) | Apache-2.0 | | each about 3.9 MB | relaxedsimd = simd (1.2 s vs 1.2 s); plain **2.2 times slower** | identical | Ship `simd` plus plain as fallback; skip relaxedsimd |
| `tessdata` (original, with legacy engine) | Apache-2.0 | Apache-2.0 | `eng` 10.9 MB (gz) and a larger core | n.m. | n.m. | No: the legacy engine is not needed |
| **PaddleOCR PP-OCRv4 mobile on onnxruntime-web** (via `@gutenye/ocr-models` 1.4.2 on npm; wrapper MIT; models from PaddleOCR) | PaddleOCR Apache-2.0 ([PaddlePaddle/PaddleOCR `LICENSE`](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE)); not checked on the npm tarball beyond its stated MIT | Apache-2.0 per PaddleOCR (**unverified for this repackaged file**) | det 4.75 MB + rec 10.82 MB + cls 0.58 MB = **16.1 MB**; plus ORT already vendored | **not run**: needs DB text-box post-processing and CTC decoding that I did not write | **not measured** | Not now. Strong on Chinese and mixed text and handles curved or rotated text better than Tesseract in the literature (**unverified here**), but this bundle's dictionary is Chinese plus English only, it is 2 times our whole fast tier, and no Hindi, Arabic or Devanagari recogniser was found on npm or GitHub in a size I could check. Revisit for a CJK pack |
| `@paddlejs-models/ocr` 1.2.4 (npm, ISC) | ISC | n.m. | 1.6 MB wrapper, models fetched elsewhere | not run | not measured | Not evaluated; models are not self-hostable from the package |
| Browser Shape Detection API `TextDetector` | n.a. | n.a. | 0 | n.m. | Chromium only, flag/Android only, not a standard | No |
| Cloud OCR | n.a. | n.a. | n.a. | n.a. | n.a. | **Excluded** by privacy rule A7 |

Training-data note: tessdata_fast and tessdata_best are trained by the Tesseract project on text rendered from many fonts plus its own corpora; I did not find a restrictive dataset term, but I did not audit it. The `@tesseract.js-data/*` packages say MIT while the data is Apache-2.0 upstream; I use the upstream files and licence (`assets/vendor/licenses/tessdata_fast-LICENSE.txt`).

### Language data

| Language | Script | tessdata_fast size | Gz | Measured here |
|---|---|---|---|---|
| English `eng` | Latin | 4.11 MB | 1.96 MB | yes |
| Spanish `spa` | Latin | 2.29 MB | n.m. | yes: accents and punctuation 0 % CER on 3 sentences |
| Portuguese `por` | Latin | 1.98 MB | n.m. | yes: 0 % CER |
| French `fra` | Latin | 1.13 MB | n.m. | yes: 0 % CER |
| German `deu` | Latin | 1.53 MB | n.m. | yes: 0 % CER (umlauts, ß) |
| Hindi `hin` | Devanagari | 1.12 MB | 0.92 MB | yes: 2.2 % CER, but **16.7 % word error** on 4 clean sentences (one missed conjunct or matra per sentence): usable for search, not for copying verbatim |
| Arabic `ara` | Arabic (right to left) | 1.43 MB | n.m. | yes: 2.6 to 4.3 % CER on 3 sentences, 33 to 39 % word error; **very small sample**, right-to-left text layers are the least tested part of the PDF writer |

Packs are 1.1 to 2.3 MB each (plus `eng`), so an "all languages" download would be about 14 MB. `tessdata_best` Hindi is 11.9 MB and was not better on my sample (WER 22 % vs 17 %), so do not offer it. Multi-language (`eng+hin`) loads both packs into one session.

Offering packs: the language picker lists English as included and every other pack as "Download (1.1 MB)". Selecting one downloads it with a progress bar into Cache Storage `le-models-v1` (key = the pack URL, header `x-le-model: ocr-<id>`), where the storage manager lists it under AI models with a delete button (`LE.ocr.cachedLanguages()`, `LE.ocr.clearCache(id)`). Packs are fetched by `scripts/fetch-ocr-data.js` into `assets/models/ocr/more/` (git-ignored) for upload to S3.

### Network reality (what worked from this sandbox)

`registry.npmjs.org` and `raw.githubusercontent.com` worked (tessdata_fast and tessdata_best raw files, 4 to 15 MB, no problem). `huggingface.co` and `cdn.jsdelivr.net` do not resolve here. tesseract.js defaults to jsDelivr for its worker, core and language data, so **every default URL breaks rule A7 and this sandbox**: we pass explicit same-origin paths. Language data for Hindi and other scripts is in the npm packages `@tesseract.js-data/<id>` as well (4.0.0 and 4.0.0_best_int folders, gzip), which gives a second source if GitHub raw files ever move.

### How it is built (`labs/pdf-ocr/`)

- `ocr.js` (`window.LE.ocr`, 32 KB, 11 KB gz) talks directly to the tesseract.js worker script `worker.min.js` through its message protocol (`load`, `loadLanguage`, `initialize`, `setParameters`, `recognize`). I did **not** use the `createWorker` wrapper because: it fetches from jsDelivr by default; its IndexedDB cache would duplicate our Cache Storage; and its `{ code, data }` language-bytes path hung in my test on 7.0.0 (`createWorker` never resolved; I did not find out why). Bytes are cached in `le-models-v1`, passed to the worker as `{ code, data }` and the worker never touches the network for language data.
- The engine runs in the tesseract.js worker (a real Web Worker). Single thread: **tesseract.js-core has no threaded build**; the "threads and COOP/COEP" question from the background-remover spike does not apply and our recommendation stands: do not enable COOP/COEP. If more speed is wanted, run two workers (two sessions, 2 times the memory) for multi-page documents (**not measured**).
- Before recognition, `prepCanvas` (my code) flattens uneven light (paper level per 12 to 16 px cell, divide), measures noise and applies a light blur only when noisy, stretches contrast (the black point is capped so a nearly empty page is not turned black: this was a measured bug that made an Arabic page return nothing), and **straightens the page** by projection-profile skew search (-8 to +8 degrees, 0.1 degree steps). Recognised boxes are mapped back through the rotation to source pixels.
- `makeSearchable` renders each page with pdf.js, recognises it, and writes the text with pdf-lib as **invisible text (render mode 3) in Tesseract's GlyphLessFont** (a 572-byte blank TrueType font with an identity CID to Unicode map; Apache-2.0, extracted from Tesseract's own PDF output and embedded as base64). Each word gets its own `Tm` (rotation = baseline angle), `Tf` (size = ascender height, so the selection box is the right height) and `Tz` (horizontal scale so the word's width matches the scan). The original page content is untouched (the text is appended after a `q` that pdf-lib's `pushOperators` adds around the old content). Pages with 26 or more extractable characters are skipped by default.

### Measurements

Rig: headless Chromium (Playwright), 4 vCPU Xeon 2.3 GHz **shared with other engineers' jobs** (treat all times as plus or minus 30 %). Pages are my own: known text rendered by Chromium at 150, 200 and 300 dpi (Liberation Serif, Liberation Sans, DejaVu Sans Mono, a table with borders, a two-column page, Spanish, French, German, Portuguese, Hindi in FreeSans, Arabic in FreeSerif), then degraded by script (`tools` are in the scratchpad folder, not committed): "scan" (1.2 degrees skew, blur, noise, JPEG q60), "noisy" (blur 1.1, noise sigma 22, JPEG q40), "photomild" (3 degrees skew, shading, 0.9 scale), "photo" (2.5 degrees skew, 0.8 scale, blur 1.3, noise 18, strong shading) and "100 dpi". CER = character error rate and WER = word error rate (Levenshtein on whitespace-normalised text), "recall" = share of true words found in any order.

**Download and cold load**

| Item | Raw | Gzip | Brotli |
|---|---|---|---|
| `tesseract-core-simd-lstm.wasm.js` (engine) | 3,899,472 | 1,454,316 | 1,121,440 |
| `worker.min.js` | 111,307 | 33,805 | 27,550 |
| `eng.traineddata` (fast) | 4,113,088 | 1,962,155 | 1,633,293 |
| first use, English | **8.12 MB** | **3.45 MB** | 2.78 MB |

CloudFront compresses by content type: `.wasm.js` is served as JavaScript and compresses well. `.traineddata` is `application/octet-stream`, which CloudFront does not compress by default (**unverified for our distribution**), so either upload a pre-gzipped copy with `Content-Encoding: gzip` or serve it as a compressible type, otherwise the 2 MB saving is lost and the first-use download is 8.1 MB, not 3.5 MB. **Cold load** (read bytes, start worker, create session; localhost, so no network): 0.17 to 0.43 s, 0.8 to 1.1 s on the 1-core-plus-3-busy-loops "slow phone" rig. Add download time yourself (8.1 MB at 10 Mbit/s is 6.5 s, 3.5 MB is 2.8 s).

**Time per A4 page, English, with clean-up and de-skew, single thread (3 dense and sparse pages each, desktop core)**

| Resolution | Image | Time per page | Clean-up part | Peak memory above an idle browser | CER on clean pages |
|---|---|---|---|---|---|
| 150 dpi | 1241 x 1755 | 1.1 to 2.1 s | 0.12 to 0.34 s | 194 MB | 0 to 0.46 % |
| 200 dpi | 1654 x 2340 | 1.0 to 2.8 s | 0.13 to 0.54 s | 264 to 328 MB | 0 to 0.08 % |
| 300 dpi | 2481 x 3509 | 1.7 to 2.9 s | 0.30 to 0.43 s | **502 MB** | 0 to 0.15 % |

Dense serif page (269 words) is the slow end. **300 dpi buys no accuracy on this test set and costs 2 times the memory: default to 200 dpi, offer 150 dpi as "faster", and cap 300 dpi to desktop.** (An idle Chromium here is about 450 to 490 MB; the OCR cost is the difference. Memory is the whole browser process tree sampled from `ps`, not a JS heap number.)

**Mid-range phone: honest estimate.** With the browser pinned to one core shared with three busy loops (the rig the background-remover spike used; about 3 times slower): 150 dpi dense page **5.3 s**, 200 dpi **6.2 s**, noisy scan **7.1 s**, mono small print 4.6 s (measured on this rig). A real mid-range phone core is likely 2 to 4 times slower than this Xeon core for WebAssembly, so **expect 4 to 12 s per dense A4 page at 200 dpi (estimate; I measured no phone)**, a 20-page scan in 2 to 4 minutes. That is acceptable with a progress bar and cancel; it is not "instant". Offer 150 dpi on phones.

**Accuracy** (English, `tessdata_fast`, with `prep` clean-up and de-skew unless stated)

| Page | CER | WER | Word recall | Note |
|---|---|---|---|---|
| serif, sans-with-IDs, mono small, clean 150 / 200 / 300 dpi | 0 to 0.46 % | 0 to 3.5 % | 97 to 100 % | account, IBAN, PAN, SSN, e-mail and phone strings all exact |
| table with borders, scan | **0 %** here | 0 % | 100 % | **but the same file fed to Tesseract directly (no canvas, no clean-up) lost 60 % of words** (page segmentation mode 3 fails on ruled tables; PSM 4 fixed the clean one). Fragile: treat tables as a known weak spot |
| two columns, scan | 0 % | 0 % | 100 % | without clean-up it read across the gutter and interleaved the columns on the clean render |
| "noisy" scan (sigma 22 noise, JPEG q40), serif / sans / mono small | 0.06 / 0.22 / 0.38 % | 0.4 / 3.0 / 3.0 % | 99.6 / 98.5 / 97.5 % | **without clean-up the mono page produced junk: 95 % CER and 2.1 s; the raw run reached 13.8 s with 490 % CER** (noise read as text lines) |
| "photomild" (3 degrees skew, shading), serif / sans / mono | 0.12 / 0 / 0.15 % | 0.7 / 0 / 1.5 % | 99 to 100 % | **without de-skew Tesseract silently dropped whole paragraphs: 67 % CER, 27 % word recall** (serif). De-skew is not optional |
| "photo" (heavy shading and blur, 0.8 scale) sans | 0.77 % | 3.7 % | 96 % | before clean-up 84 % CER |
| 100 dpi (small print from a low-res scan), serif / sans / mono | 2.4 / 2.1 / 2.1 % | 4.5 / 13 / 10 % | 90 to 96 % | the weak case: text under about 7 px x-height. Warn: "resolution is low". `best_int` data improves it (WER 1.1 % on serif, raw) |
| Hindi clean 200 dpi | 2.2 % | 16.7 % | 92 % | same on noisy and photomild versions |
| Spanish, French, German, Portuguese clean | 0 % | 0 % | 100 % | |
| Arabic clean | 2.6 to 4.3 % | 33 to 39 % | 61 to 67 % | three sentences only |

What I could **not** measure: real scanner and phone-camera pages (my "scans" are rendered text plus synthetic degradation, which is kinder than real life: no show-through, stamps, handwriting, coloured backgrounds or real optics), proportional-font Hindi in body text at 10 pt, mixed-language pages, tables with real data, and curved text. Treat all percentages above as "clean to moderately degraded rendered text", not as a promise.

### Searchable PDF output

- 3-page image-only PDF (1.23 MB) becomes a 1.25 MB searchable PDF: the added text layer costs about 6 KB per page plus the 400-byte font (the 128 KB `CIDToGIDMap` is Flate-compressed to 210 bytes by pdf-lib). Reopened with pdf.js `getTextContent`: 663 words extracted for 663 written; text order is reading order for single-column pages.
- **Alignment check**: I overlaid pdf.js's text-item boxes on the page images (`ocr-text-layer-overlay-*.png`). Boxes follow each word including on a page skewed by 3 degrees (baseline rotation is applied) and on a two-column page. Selection boxes cover baseline to ascender height, so descenders sit just outside the highlight; this is how Tesseract's own PDFs behave too.
- Page rotation (`/Rotate`) and crop boxes go through pdf.js's `viewport.convertToPdfPoint`, so they should be right, but **I did not test a rotated or cropped page**.
- Redaction note: the text layer exists so people can search and copy. **Anything redacted must also be removed from the text layer** (re-run `makeSearchable` on the redacted raster, or drop the words inside the redaction boxes). See the integration plan.

### Device guards (D9)

| Tier | Needs | Wants | Memory (measured peak above idle, 200 dpi) | Download |
|---|---|---|---|---|
| `ocr.english-fast` | WebAssembly, SIMD, Web Worker | Cache Storage, 4 GB device memory | 350 MB | 8.1 MB |
| `ocr.english-better` (best_int data) | same | same | 350 MB | 9.2 MB (replaces the 4.1 MB pack) |
| `ocr.language-pack.<id>` | same as `english-fast` | same | 350 MB (the core and one or two packs) | plus 1.1 to 2.3 MB |

Declared as:

```js
{ id: 'ocr.english-fast', needs: ['wasm', 'wasm-simd', 'worker'], wants: ['cache-storage', 'device-memory-4gb'], memoryMB: 350, downloadMB: 8.1 }
{ id: 'ocr.english-better', needs: ['wasm', 'wasm-simd', 'worker'], wants: ['cache-storage', 'device-memory-4gb'], memoryMB: 350, downloadMB: 9.2 }
{ id: 'ocr.language-pack', needs: ['wasm', 'wasm-simd', 'worker'], wants: ['cache-storage', 'device-memory-4gb'], memoryMB: 380, downloadMB: 10.5 }   /* English-sized engine plus the largest pack */
```

Notes for `LE.support`:
- `wants` has no `wasm-threads` for OCR: the engine does not use threads. It does have a non-SIMD fallback (2.2 times slower), so `wasm-simd` could move to `wants`; I kept it in `needs` because every browser from Chrome 91, Firefox 89 and Safari 16.4 on supports it and the slow path is not a good experience. Your call.
- Missing `cache-storage`: it still runs but re-downloads the packs every time; say so.
- "Try anyway" cases: `deviceMemory` of 2 GB or less or no `device-memory-4gb`: allow at 150 dpi only; page count above 20 on a phone: offer to split. At 300 dpi require `device-memory-4gb`.
- Which browser is better: none is meaningfully faster for single-thread WebAssembly in my data; a desktop browser of any engine beats a phone by 2 to 4 times. Suggest "open on a computer" for long documents rather than a different browser.

### UX recommendations (D9)

- Nothing downloads until the person asks. Button: "Make searchable" then a sheet: language (English included; others "Download 1.1 MB"), quality (Faster 150 dpi / Standard 200 dpi), "Only pages without text" (on by default; scanned pages are detected by having no extractable text).
- Progress in three honest stages: "Downloading the text engine (first time only), 2.1 of 3.9 MB", "Loading language", "Page 3 of 12" with the page thumbnail and a running word count. Cancel works at all times (cancel terminates the worker, because WebAssembly cannot be interrupted; the next run reloads from cache in about 0.3 s).
- Per page and overall confidence: show "12 words uncertain" and let the person click through to low-confidence words on a page overlay (the lab draws green, orange and red boxes). Never claim a page is "100 % searchable".
- Language packs appear in the storage manager under **AI models** with size and a delete button (`LE.ocr.cachedLanguages()` and `LE.ocr.clearCache(id)`; entries live in `le-models-v1`).
- Show a time estimate after the first page ("about 4 s per page, 40 s left").
- If a page returns fewer than 5 words or confidence under 50 %, say "Couldn't read this page well" and offer 300 dpi on desktop or "Better" data.

### Integration plan (PDF studio)

1. Move `labs/pdf-ocr/ocr.js` to `assets/js/le-ocr.js` (call `LE.ocr.config({ root: '/' })`), keep `assets/vendor/tesseract/` and `assets/models/ocr/`. Add a "Make searchable" command to the studio's PDF toolbar and as a page in the "Convert" tools. No change to `sw.js` apart from not precaching (see below).
2. **Find sensitive data (D2, `le-pdf-security.js`)**: for a page with no text layer, call `LE.ocr.recognize(canvas, { lang })` and treat the result like pdf.js text content: lines in `res.lines[].words[]` with `bbox` in the rendered page's pixels. The pattern matcher runs on `line.text`; a match that spans words is mapped to the union of those words' `bbox` (words are indexed by character offset: build the line string from `words.map(w => w.text).join(' ')` and keep cumulative offsets). Convert pixel boxes to PDF points with the same `viewport` used for rendering. Mark OCR-found matches as "from scan: verify" because OCR can miss a digit (all my ID strings were exact on clean and moderately noisy pages, but that is a small sample), and require the person to confirm each box.
3. **Redaction (D1)** on a scanned page must burn black rectangles into the page raster (the content is an image), then **rebuild the text layer from the redacted raster** (re-run OCR, or drop OCR words whose boxes intersect a redaction) so redacted words are not left selectable. Make this a test: redact, save, extract text with pdf.js, assert the secret string is gone.
4. Run recognition inside the studio's existing busy overlay with a Cancel button wired to `AbortSignal`. Unload (`LE.ocr.unload()`) when the person leaves the feature; an idle session holds about 150 MB.
5. Camera pages (D10) feed straight into this: "Scan, then Make searchable" in one flow, using `LE.scan.exportPdf` output as the input of `LE.ocr.makeSearchable`, or recognise the straightened canvas directly and write text and image into one PDF (cheaper: one render fewer).

### What to host

| Path | Bytes | Gzip | Notes |
|---|---|---|---|
| `/assets/vendor/tesseract/worker.min.js` | 111,307 | 33,805 | `text/javascript` |
| `/assets/vendor/tesseract/tesseract-core-simd-lstm.wasm.js` | 3,899,472 | 1,454,316 | `text/javascript`, immutable cache, compress |
| `/assets/vendor/tesseract/tesseract-core-lstm.wasm.js` | 3,896,484 | 1,453,570 | no-SIMD fallback, only fetched when SIMD is missing |
| `/assets/models/ocr/eng.traineddata` | 4,113,088 | 1,962,155 | serve with a compressible type or gzip it |
| `/assets/models/ocr/more/<id>.traineddata` | 1.1 to 2.3 MB each | n.m. | S3 only, from `scripts/fetch-ocr-data.js` |

Committed in this branch: the first four rows plus licence texts = **12.0 MB**, largest file 4.1 MB. Not committed: `more/` packs, `best_int` data, anything of OpenCV. `.gitignore` has `/assets/models/ocr/more/`.

**Paths that must stay out of the service-worker precache** (`scripts/build.js` already keeps `labs/`, `assets/models/` and `assets/vendor/ort/` out): add **`assets/vendor/tesseract/`**. `assets/models/ocr/` is already covered by `assets/models/`. The engine is fetched by `importScripts` inside the worker, so it goes through the HTTP cache or an on-demand SW runtime cache, not Cache Storage `le-models-v1`; only language data is in `le-models-v1`. If you want the engine to be listed in the storage manager too, add a runtime-cache rule for `/assets/vendor/tesseract/*` in `sw.js` (cache-first, separate cache name) rather than precaching.

CSP: works under the production policy (`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:`) as shipped in `infra/cloudfront/response-headers-policy.json`: I ran the lab and a 3-page job with that exact header and saw no violation. The tesseract.js worker has one `new Function("return this")` in webpack's global fallback; it is only reached when `globalThis` is missing, which no supported browser has.

### Risks (D9)

- **Phones are slow and memory-hungry** (see estimate). Mitigate: 150 dpi default on phones, page-by-page with cancel, unload when done.
- **Accuracy on real documents is unmeasured.** Mitigate: beta label, confidence UI, never auto-redact from OCR alone.
- Tables with ruled borders can lose most words with default page segmentation (measured on a raw run). Mitigate: our clean-up path read my table pages correctly, but add a fallback: if a page's word count is far below its dark-pixel area, retry once with page segmentation mode 4 or 11.
- Right-to-left text layers (Arabic) are the least tested part of the PDF writer; Devanagari conjuncts are written one UTF-16 unit per glyph, which pdf.js reassembled correctly in my sample (**not checked in Acrobat, Preview or Chrome's viewer**).
- Searchable PDFs are only as good as viewers' handling of render mode 3 with an identity-H font. This is exactly what Tesseract and OCRmyPDF write, so it is well trodden, but I only verified pdf.js.
- Old engine version pinned: tesseract.js 7.0.0 and core 7.0.0. Upgrading changes the worker protocol surface I call directly; lock the versions and re-run `tests/pdf-ocr.test.js`.

## D10. Phone camera to clean scan

### Vision approach: plain JS or OpenCV.js

Test set (`labs/scan` is judged on this): 112 images, 8 categories x 14, made by a script (not committed) that composites my rendered document pages (8 different pages, cream or white or tinted paper) onto the 48 photos in `assets/photos/collage/` with random 3D tilt (up to 22 degrees pitch and yaw), rotation (up to 35 degrees, a fifth of them up to 90), 50 to 95 % frame fill, a drop shadow, a lighting gradient, noise, blur and JPEG. Categories: **easy** (the 14 darkest backgrounds), **normal**, **lowcontrast** (white paper on the 14 brightest backgrounds), **clutter** (the 14 busiest backgrounds, high edge density), **shadow** (a hard shadow band across the page), **glare** (a blown-out highlight), **curl** (a sine bend of the page, true corners kept), **tight** (page fills 86 to 95 % of the frame). Ground-truth corners are known exactly. Metrics: IoU of the detected and true quads (success at 0.90 = page right to within about a few pixels; 0.75 = needs one small drag), mean corner error as % of the image diagonal.

| Method | IoU 0.90 or better | IoU 0.75 or better | No page found | Median corner error (found) | p90 error | Time (420 px, desktop core) | Bytes |
|---|---|---|---|---|---|---|---|
| **LocalEditor JS** (`labs/scan/scan.js`) | **77 %** | **84 %** | 3 of 112 | **0.25 %** | 8.0 % | **76 ms** (p90 135) | **38 KB (12.8 KB gz)** |
| OpenCV.js 4.10.0 classic recipe: Canny or Otsu or close, `findContours`, `approxPolyDP`, largest convex 4-gon not covering the frame | 40 % | 48 % | 22 of 112 | 2.8 % | 26 % | **7 ms** | **10.38 MB (3.37 MB gz, 2.45 MB brotli)** plus 0.8 s init |

Per category (IoU 0.90 or better; JS / OpenCV): easy 100 / 71, normal 79 / 50, lowcontrast 79 / 50, clutter 71 / 7, shadow 50 / 7, glare 64 / 29, curl 79 / 57, tight 93 / 50.

How to read this fairly: OpenCV.js is about 10 times faster per operation, and its warp and filters are excellent. But the comparison that matters is the **detector's accuracy**, and the classic recipe is what most tutorials ship; I did not port my own line-based detector onto OpenCV primitives (that would be faster but not more accurate), and I did not try `LSD` or `HoughLines` in OpenCV.js. Licence: `@techstark/opencv-js` 4.10.0 and OpenCV 4.x are Apache-2.0. The 5.0.0-release.1 build on npm **fails to compile its WebAssembly in Chromium here** ("unknown type form"), so I used 4.10.0. Verdict: **do not ship OpenCV.js for this.** It adds 10 MB (3.4 MB over the wire), a second WebAssembly runtime, and does not detect better out of the box; our plain JS is faster than a person can notice (76 ms; 130 ms for a 12 MP photo including the downscale).

**How the JS detector works** (all in `scan.js`, no dependency): downscale to 420 px; luminance and gradient (blurred Sobel); candidate quads from (1) three region masks (bright paper by luminance, bright by minimum channel, dark) turned into convex hulls and reduced to the smallest enclosing quadrilateral, (2) a region enclosed by strong edges, and (3) **a Hough transform over edge pixels where each pixel votes only for lines that agree with its own gradient direction**, so every line has a known polarity; every set of four lines whose normals are spread around the circle is intersected into a quad. Each quad is scored by how much of its perimeter sits on a clear edge (strongest directional derivative within 3 px, all four edges with the same polarity), its weakest edge, how much of the region it fills, and its area. Result: corners ordered clockwise from the top-left plus a confidence. Page aspect ratio is recovered from the perspective by the pinhole-camera method of Zhang and He (2007) and snapped to A4 or Letter when within 4 %: **median aspect error 0.44 % against 2.3 % for the plain edge-length ratio** on the test set's true corners.

**Failure modes** (from the 26 images below IoU 0.90 and from viewing them):

- **Shadow across the page (50 %)**: the shadow edge is a stronger straight line than a pale page edge, and the quad shrinks to the lit part. Same mechanism for any strong line inside the page: table borders, the edge of a text block.
- **Glare (64 %)**: a blown-out patch removes the page edge locally; the quad usually survives only when three edges are clear.
- **Low-contrast paper on a light table (79 %)**: the top edge is often only 5 to 8 grey levels from the table; the detector still finds it half the time because Hough accumulates a weak but long line.
- **Clutter (71 %)**: books, posters and printed pages produce parallel lines. When the page is the largest bright region it works; when a bigger rectangle exists in the background it can choose that one.
- **Curled pages (79 %)**: curved edges are fitted by a straight line through the corners, so the corners are right and the warp leaves the curve (unfixable without de-warping; not attempted).
- The test pages are flat, evenly lit rectangles on photos; real pages have folds, rounded corners, a thumb over an edge, text that touches the frame, and a hand. I expect real success to be **lower** than these numbers on busy desks and higher on a plain table. Because of that the UI always shows the corners and the person adjusts them.

### What was built (`labs/scan/`)

- **Capture**: `getUserMedia` with the rear camera (`facingMode: { ideal: 'environment' }`) asking for 4032 x 3024, then 1920 x 1080, then any camera (the browser chooses the closest). A live outline (detection every 450 ms on a 320 px frame; green above 75 % confidence, amber below) helps framing. **Take photo** uses `ImageCapture.takePhoto()` for a full-resolution still where it exists (Chromium) and a video frame otherwise. Photo picking (`<input type=file accept=image/* multiple>`) and the native camera (`capture="environment"`) are always offered. Sources are capped at 3200 px per side in memory.
- **Corner editor**: four handles with a 44 CSS px touch target, a circular **3 times magnifier** that sits above the finger while dragging, crosshair, pointer events with capture (mouse, touch and pen), "Find page again", "Whole photo", rotate left and right.
- **Straighten**: the homography is solved from the four corners; output is warped by inverse mapping with bilinear sampling to at most 2339 px on the long side (A4 at 200 dpi), at the page's true aspect ratio.
- **Clean-up modes**: *Colour* (paper level per pixel from a coarse grid of 90th percentiles, divide, mild levels), *Whiten paper* (same, then paper pushed to pure white, ink deepened, colour kept), *Grey*, *Black and white* (flatten, then Bradley adaptive threshold on an integral image: pure 0 or 255, shadows gone), and *Original*. See `scan-modes-contact-sheet.jpg`.
- **Multi-page session**: add, reorder (move earlier or later), delete, edit corners again, retake (replaces the page). All pages stay as canvases on this device.
- **Export**: PDF via pdf-lib: JPEG pages (quality Small 0.7 / Balanced 0.82 / High 0.92) or **1-bit pages for black and white** (flate-compressed `DeviceGray` 1-bit image XObject, MSB first). Page size A4, Letter or fit-to-scan. Images as a zip (JPEG or PNG for B&W) via the vendored JSZip.

### Measurements (D10)

12 MP source (3000 x 4000), straightened to 1561 x 2208, desktop core:

| Step | Time |
|---|---|
| detect (includes downscaling the 12 MP photo) | 130 to 215 ms |
| straighten (warp) to 2339 px max | 240 to 315 ms (270 ms to 1600 px) |
| Colour / Whiten / Grey / Black and white | 390 / 370 / 270 / 250 ms (up to 340 ms for B&W at A4 size) |
| 1-page PDF at A4 2339 px (a mostly blank invoice page) | **colour 245 KB, grey 244 KB, black and white 19.6 KB** |
| peak memory above idle browser | about 130 MB (12 MP photo) |

These are warm timings on a shared desktop core; a mid-range phone is 3 to 4 times slower (**estimate**), so straighten plus clean-up is about 1.5 to 2.5 s per page. Memory: a 12 MP photo is held as a 3200 px canvas (about 41 MB) plus an `ImageData` copy in the warp (up to 52 MB at the 3600 px cap) plus the 16 MB output and its copies. On a 3 GB phone that is fine for one page; keep `maxSource` at 3600 and pages stored as JPEG-able canvases (a 20-page session holds about 20 x 16 MB: **warn above 15 pages on a phone and offer to save and start a new batch**).

Fake-camera run (Chromium `--use-fake-device-for-media-stream`): camera started at 3840 x 2160, live overlay ran, "Take photo" produced a canvas and the edit view opened with no console errors. **Not tested on any real phone, real camera, torch, autofocus or iOS.**

### Camera permissions UX

- **Secure context**: `getUserMedia` exists only on https (and `localhost`). The site is https and the installed PWA is a secure context. On plain http `navigator.mediaDevices` is undefined: the lab shows "Camera access is not available here (it needs https). Choose a photo instead."
- Ask only when the person taps "Open camera" (never on page load). Explain before the prompt: "LocalEditor needs your camera to take the photo. The picture stays on this device."
- Denied (`NotAllowedError`): explain how to re-enable (browser site settings), keep "Choose a photo" visible. No camera (`NotFoundError`): same. Another app holds the camera (`NotReadableError`): say so.
- Handle `visibilitychange`: stop the camera tracks when the tab is hidden (battery, and the privacy indicator).
- **iOS Safari (unverified, from knowledge; test on a device)**: the camera needs a user gesture and https; `facingMode: environment` works on iOS 14.3 and later; stills come from the video frame (no `ImageCapture.takePhoto`), so effective resolution is the video stream's (often 1920 x 1080, sometimes up to 4032 x 3024 on newer devices); standalone (home-screen) PWAs had camera bugs on older iOS versions; autofocus and torch controls are not exposed. **`<input type="file" capture="environment">` opens the native camera app with full-resolution stills and the system's own focus and flash and is the better path on iPhone**: keep it as a first-class button, not a fallback. EXIF orientation: `createImageBitmap(file, { imageOrientation: 'from-image' })` is used and falls back to the default.
- Android Chrome: `takePhoto()` gives the full sensor resolution and works in installed PWAs; Firefox Android has no `ImageCapture` (video frame only). **Browsers that do better for D10**: Chrome and Edge on Android (full-resolution stills, focus control); on iOS use the native-camera button. For the capability module: `scan.camera` has no browser alternative suggestion beyond that (desktop Safari, Firefox and Chromium all have a webcam).

### What the installed app needs

- **`Permissions-Policy`**: the current header in `infra/cloudfront/response-headers-policy.json` has **`camera=()`**, which blocks the camera for the page itself as well as iframes. The scan page needs **`camera=(self)`**. Everything else stays: `microphone=()`, `geolocation=()` and so on. If the policy can be varied per path, set `camera=(self)` only for `/scan/*` (or wherever the feature is served) and the PDF studio (`/pdf-studio/*`, if the scan flow is embedded); a global `camera=(self)` is acceptable because only our own first-party code runs on the origin and the browser still asks the person each time (or remembers per origin). Do **not** put `camera` in `Permissions-Policy` for cross-origin iframes.
- **CSP**: no change. `media-src 'self' data: blob:`, `img-src ... blob:`, `worker-src 'self' blob:` are enough; `getUserMedia` is not a CSP-controlled fetch.
- **Manifest**: no permission entries exist in a web app manifest, so nothing to add. Optionally add a shortcut ("Scan a document") to `manifest.webmanifest` and `scripts/build.js` once the scan route exists, and consider `"display": "standalone"` as it already is (needed for full-screen camera on Android).
- **Service worker**: scan code is tiny (38 KB, 12.8 KB gz); precache it with the studio or runtime-cache it. No models.
- `labs/scan/` loads `assets/vendor/pdf-lib.min.js` and `assets/vendor/jszip.min.js` already in the repo.

### Device guards (D10)

```js
{ id: 'scan.camera', needs: ['camera'], wants: ['device-memory-4gb'], memoryMB: 250, downloadMB: 0.05 }
{ id: 'scan.cleanup', needs: [], wants: ['device-memory-4gb'], memoryMB: 250, downloadMB: 0.05 }
```

`scan.cleanup` (pick a photo, straighten, clean, export) needs nothing but canvas and works everywhere; `scan.camera` adds the live camera and needs `camera`. "Try anyway" for no `camera` capability reported: offer the file picker (the native camera button on phones). With `device-memory-4gb` absent, lower `maxSource` to 2400 and the output to 1600 px. Memory 250 MB is the measured 130 MB plus headroom for a second stored page; it is not a worst case.

### UX recommendations (D10)

- Open on the camera button, with the system camera and photo picker one tap away. Show a framing hint ("page flat, light even, all four corners visible").
- After capture, always show the corners (never silently crop). Below 70 % confidence say "Please check the corners." The magnifier and 44 px targets are the main usability feature; keep them.
- Default clean-up: **Whiten paper** for text documents and **Colour** for photos or forms with stamps; B&W is the smallest file (about 12 times smaller in my example) and the most legible for text, but can erase faint ink and light stamps. Show the effect live with a before and after.
- Offer "Make searchable" after export (D9). Stage a "Scan batch" of up to 20 pages and warn on memory.
- Quality gate to add (not built): blur and glare warnings at capture (variance of Laplacian, share of blown pixels).

### Risks (D10)

- **Detection is right 77 % of the time on a hard synthetic set**, real desks unknown. The editor makes the failure cheap, but "Auto" should never be claimed as reliable.
- Camera resolution and quality vary by phone; iOS Safari is limited. The native-camera path hides most of that.
- Memory on long sessions (see above).
- Perspective-aspect recovery assumes the principal point is the image centre; cropped photos or digital zoom break that and the result falls back to the plain ratio (guarded by the 35 % disagreement check).
- Curled pages and thick books are straightened as flat pages, so text near the spine stays curved.

## Files

Committed on this branch: `labs/pdf-ocr/` (`index.html`, `ocr.js`), `labs/scan/` (`index.html`, `scan.js`), `assets/vendor/tesseract/` (worker plus two cores), `assets/models/ocr/eng.traineddata`, licence texts in `assets/vendor/licenses/`, rows in `assets/vendor/LICENSES.md`, `scripts/fetch-ocr-data.js`, `.gitignore` line, `tests/pdf-ocr.test.js`, `tests/scan.test.js`, this document.

Not committed (scratchpad `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/ocr-scan/`): the page fixtures and their generators, benchmark harnesses, the 112-image scan test set, OpenCV.js, language packs and result JSONs; sample outputs are in its `out/` folder.
