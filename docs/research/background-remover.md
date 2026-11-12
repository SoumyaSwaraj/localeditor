# Background remover: research spike (ROADMAP 1.7)

Written 12 November 2026. Prototype: `labs/bg-remove/` (not linked from the site). All numbers below were measured in this sandbox unless marked **estimate**.

## Answer

Yes, with limits. A browser-only "keep the subject, remove the rest" tool is feasible today with permissively licensed parts and no server:

- **Fast tier (ship it):** U²-Net-small `u2netp` (4.6 MB, Apache-2.0) on onnxruntime-web WASM, plus a guided edge refinement and edge-colour clean-up that I wrote. About 1.4 s per photo on a desktop-class core, an estimated 3 to 4 s on a mid-range phone. Good on one clear subject (a statue, a stack of books, a family, a product on a plain wall). Weak on busy scenes, low contrast and scenes with no subject.
- **Better tier (download on request):** the same U²-Net family quantised to int8 (44 MB). Visibly cleaner and fuller masks than `u2netp`, 2 to 3 times slower. A people-only variant (`u2net_human_seg`, int8, 44 MB) is the best result I saw on portraits and groups.
- **Not feasible in the browser today:** BiRefNet (best quality, MIT code): the only ONNX export I could get needs about 12 GB of RAM natively and fails in the 32-bit WASM heap. IS-Net/DIS general use runs (12 s per photo, 10 s int8) but its weights were trained on a non-commercial dataset; evaluation only.
- Imperfect masks are a fact of life at this model size. The studio needs a **restore/erase touch-up brush** next to the one-tap remover, or users will judge it by the failure cases.

If the owner expects Canva-grade hair and fur on arbitrary photos in one tap, this is **not good enough** on its own. What would be: BiRefNet-class quality at a size and memory that fits a phone. That needs either a WebGPU path with a model exported at a lower resolution (not available as a permissive ready-made file today; would need our own export and fine-tune), or a much newer small matting model with a clear licence. Revisit in 6 months.

## Candidates and licences

Licence is stated for code and for weights separately. "Training data" matters: several permissive-licence weights were trained on research datasets with non-commercial terms. That is an unresolved legal grey area, not something I can close; the owner should accept it knowingly or ask counsel.

| Model | Code licence | Weights licence | Size (fp32 / fp16 / int8) | Input | Subjects | Quality (my judgement) | Verdict |
|---|---|---|---|---|---|---|---|
| **u2netp** (U²-Net small) | Apache-2.0 ([xuebinqin/U-2-Net `LICENSE`](https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE)) | Apache-2.0 (same repo; trained on DUTS-TR, a research set with no stated licence) | 4.6 MB / n.a. / 1.3 MB (int8 **breaks the output**, see below) | 320² | general salient object | OK on clear subjects, blobby edges, misses thin parts | **Fast tier** |
| **u2net** | Apache-2.0 | Apache-2.0 (DUTS-TR) | 176 MB / not tested / 44 MB (**we quantised, works**) | 320² | general | Good; fuller masks, cleaner than u2netp | **Better tier as int8** |
| **silueta** (rembg) | rembg MIT ([`LICENSE.txt`](https://github.com/danielgatis/rembg/blob/main/LICENSE.txt)) | **Not stated.** Posted in [U-2-Net issue 295](https://github.com/xuebinqin/U-2-Net/issues/295) by a third party; no licence file | 44.2 MB | 320² | general | Identical in size to int8 u2net; my int8 u2net gives identical mask statistics on every photo I compared (e.g. the same opaque/transparent/edge numbers on `arch-01`), so silueta is almost certainly int8 u2net | **Do not ship** (provenance); we make our own int8 instead |
| **u2net_human_seg** | Apache-2.0 | Apache-2.0 (trained on Supervisely Person Dataset, per the U-2-Net README) | 176 MB / n.a. / 44 MB (**we quantised, works**) | 320² | **people only** | Best on portraits and groups; returns junk or nothing on non-people | **Optional "People" tier** |
| **IS-Net general-use** (DIS) | Apache-2.0 ([xuebinqin/DIS `LICENSE.md`](https://github.com/xuebinqin/DIS/blob/main/LICENSE.md)) | Apache-2.0 on paper, but trained on **DIS5K, whose terms of use say "non-commercial use in research or educational purpose"** ([DIS5K-Dataset-Terms-of-Use.pdf](https://github.com/xuebinqin/DIS/blob/main/DIS5K-Dataset-Terms-of-Use.pdf)) | 178.6 MB / n.a. / 46 MB | 1024² | general | Finest hair and edge detail, but picks odd subjects (only the book spines, a plant), speckle in backgrounds | **Excluded** (training data); 12 s too slow anyway |
| **BiRefNet** (general, Swin-tiny "lite") | MIT ([ZhengPeng7/BiRefNet `LICENSE`](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE)) | MIT stated; trained on DIS5K, DUTS, HRSOD and others, so the same dataset caveat as IS-Net | 224 MB (Swin-tiny) / ~972 MB (full) / not available | 1024² | general | State of the art | **Cannot run in WASM** (see below). Candidate for a future WebGPU tier |
| BiRefNet-portrait / DIS / HRSOD | MIT | MIT, same caveat | 972 MB each | 1024² | portrait / fine structures | n.a. | Far too large |
| **MODNet** | Apache-2.0 ([ZHKKKe/MODNet README "License"](https://github.com/ZHKKKe/MODNet)) | Apache-2.0 | ~26 MB (from memory, unverified) | 512 | people only (matting, soft alpha) | Not measured: the ONNX is hosted on Google Drive, which this sandbox cannot reach | Worth testing later: soft alpha for hair is its selling point |
| **MediaPipe selfie segmentation** | Apache-2.0 (Google, `@mediapipe/selfie_segmentation` on npm; **not checked here**) | Apache-2.0 (not checked) | 0.25 MB model + MediaPipe runtime | 256² | people only, coarse | Not measured (needs the MediaPipe runtime, not ORT). Known to be fine for video-call blur, too coarse for a cut-out | Not recommended for cut-outs |
| **InSPyReNet** (transparent-background) | MIT ([plemeri/InSPyReNet `LICENSE`](https://github.com/plemeri/InSPyReNet/blob/main/LICENSE)) | MIT stated; checkpoints are PyTorch `.pth` of several hundred MB, no ONNX | ~370 MB base | 1024 (base) | general | High quality | Too big; no browser-ready export |
| **ormbg** (Open RMBG) | Apache-2.0 **(unverified: from memory, the repo is on `huggingface.co`, blocked here)** | Apache-2.0 | ~176 MB (ISNet-based) | 1024² | general | Not measured: hosted on `huggingface.co`, blocked here. Based on IS-Net so same dataset questions | Not verified |
| **RMBG-1.4 / 2.0** (BRIA) | n.a. | **BRIA licence: non-commercial** (rembg's README says RMBG-2.0 "requires a paid agreement for commercial use") | 176 MB / ~1 GB | 1024² | general | Excellent | **Excluded by our licence rule** |
| **@imgly/background-removal** | **AGPL-3.0** ([`LICENSE.md`](https://github.com/imgly/background-removal-js/blob/main/LICENSE.md)) | its own bundled models, AGPL terms | ~40 to 80 MB | 1024² (IS-Net based) | general | Good, packaged nicely | **Excluded as a library** (AGPL would cover the site). Its idea (quantised IS-Net on ORT-web) is what we copy |

### Runtimes

| Runtime | Licence | Notes |
|---|---|---|
| **onnxruntime-web 1.22.0** | MIT (npm `package.json`; text from microsoft/onnxruntime `LICENSE`) | Chosen. The WASM-only build (`ort.wasm.min.js` + `ort-wasm-simd-threaded.wasm` 11.2 MB, 2.9 MB gzipped) is enough. SIMD on, threads optional. |
| onnxruntime-web WebGPU build | MIT | 21.9 MB jsep wasm plus `ort.webgpu.min.js`. In headless Chromium there is a **software** adapter only (SwiftShader), so no meaningful speed. Also **ORT 1.22's WebGPU provider cannot run the U²-Net family**: session creation works, the first run fails with "using ceil() in shape computation is not yet supported for MaxPool" (U²-Net uses `ceil_mode` pooling). ORT 1.31.1 from npm uses a different loader layout; my worker could not initialise it ("webgpuInit is not a function") and I did not dig further. WebGPU stays an unproven future option. |
| **Transformers.js** (`@huggingface/transformers`) | Apache-2.0 | Wraps ORT-web and offers a one-line `background-removal` pipeline. Not used: it fetches models from `huggingface.co` by default (breaks rule A7 unless re-pointed), adds a large bundle and needs an ES-module build step (rule A1: no bundler). Reasonable later if we adopt a bundler. |

## Measurements

Test rig: headless Chromium (Playwright), 4 vCPU Xeon 2.3 GHz **shared with other engineers' jobs** (load average 5 to 7 during runs), so treat every time as ±30 %. Photo: `people-07.jpg` (960×640). Models are served from localhost, so "load" has no network time; add download time yourself (4.6 MB at 10 Mbit/s is 3.7 s; 44 MB is 35 s).

"Cold load" = read bytes, start worker, create session, one warm-up inference. "Warm inference" = model run only; the rest of the pipeline (resize, upscale, compose) added 20 to 60 ms without refinement at this size.

| Model | Transfer size | Cold load | Warm inference, 1 thread | 4 threads (COOP/COEP) | 1 core + 3 busy loops ("slow phone") | Peak browser RSS (page + worker, tree) |
|---|---|---|---|---|---|---|
| u2netp fp32 | 4.6 MB | 2.1 s | 1.4 s | 0.7 to 1.1 s | 3.5 s | 714 MB |
| u2net int8 (= our silueta equivalent) | 44 MB | 4.3 s | 3.1 to 3.4 s | 2.7 to 3.3 s | 5.7 s | 990 MB |
| silueta (rembg file) | 44 MB | 4.7 s | 2.9 to 3.3 s | 2.0 to 6.8 s (noisy) | n.m. | 986 MB |
| u2net fp32 | 176 MB | 6.6 s | 4.2 to 5.1 s | 4.7 to 4.9 s | n.m. | 1.57 GB |
| u2net_human_seg int8 | 44 MB | n.m. | 3.0 to 4.1 s (8 photos) | n.m. | n.m. | 1.0 GB |
| IS-Net general-use fp32 | 179 MB | 14.4 s | 11.8 to 12.4 s | 5.8 to 7.0 s | n.m. | 1.9 GB |
| IS-Net int8 | 46 MB | 13.1 s | 9.3 to 10.8 s | 6.0 to 6.6 s | 19 s | 1.64 GB |
| BiRefNet Swin-tiny | 224 MB | **fails** | **fails** (WASM heap) | n.m. | n.m. | n.m. |
| u2netp int8 | 1.3 MB | works | 1.2 to 1.5 s (no faster) | n.m. | n.m. | n.m. |

Notes on what these mean:

- **Baseline RSS of an idle headless Chromium is about 400 MB**, so the model's own cost is the difference: about 300 MB for u2netp, 600 MB for the int8 u2net, 1.2 GB for fp32 u2net, 1.5 GB for IS-Net. On a 3 to 4 GB phone only the first two are safe.
- **BiRefNet**: session creation succeeds, the run throws a bare WASM exception pointer. I ran the same file natively with onnxruntime for Python: 10.5 s per image on 4 cores and **12.2 GB peak RSS**. The WASM heap is capped at 4 GB, so this export cannot work in the browser, however fast the device.
- **int8 dynamic quantisation** (ORT `quantize_dynamic`, QUInt8 weights): U²-Net 176 MB goes to 44 MB with the same visual quality and about 25 % less time. For `u2netp` it **destroys the output** (every pixel comes out opaque), so the tiny model must stay fp32. IS-Net int8 keeps quality but is still 9 to 10 s.
- **Threads help less than hoped**: at best 1.5 to 2× on this tiny model and nothing measurable on u2net, partly because the sandbox CPUs were busy. Not worth COOP/COEP on its own (see headers).
- **CPU throttling caveat:** CDP `Emulation.setCPUThrottlingRate(4)` is applied to the page's main thread only. The first rows of my runs under it were barely slower (u2netp 1.4 s → 1.5 s) because inference runs in a worker. I therefore also ran with the browser pinned to one core (`taskset`) with three busy loops on that core, which gave a 2 to 2.5× slowdown. A real mid-range phone core is likely 2 to 4× slower than this Xeon core for WASM, so **my phone figure of 3 to 4 s for u2netp is an estimate**, not a measurement on a phone.
- **WebGPU:** not measured (see Runtimes). **Memory:** RSS only; JS-heap vs WASM-heap split is not observable from headless Chromium.
- **Refinement cost** (JS, in the worker): guided filter 40 to 65 ms at 0.3 to 0.6 MP; for a 4.4 MP photo (capped to 2560 px) refinement is 184 ms and compose with edge-colour clean-up 1.7 s. So edge-colour clean-up should be off by default above ~1600 px.

## Pipeline (as implemented in `labs/bg-remove/bg-worker.js`)

1. Scale the source to at most `maxSide` (default 2560) and read its pixels.
2. Squash-resize to the model input (320² or 1024²), normalise with the model's mean/std, to a Float32 CHW tensor.
3. Run (WASM, `graphOptimizationLevel: all`), optional sigmoid for logit models.
4. **Min-max normalise** the output map to 0..1. Skipping this is the most common cause of grey, half-transparent cut-outs.
5. Upscale the mask to the photo size with bilinear sampling.
6. Optional **guided filter** (He & Sun fast guided filter, luminance guide, 1/s resolution for the heavy part), then a smoothstep contrast curve `[0.2, 0.8]` and optional feather.
7. Optional **blur-fusion foreground estimate** (Forte & Pitié): replaces the colour of semi-transparent edge pixels so the old background does not leave a halo.
8. Alpha into the photo, return `ImageBitmap` plus the 8-bit mask.

### Does edge refinement help?

Yes, once tuned; no with the first settings I tried.

- Mean image-gradient on the mask edge (my proxy for "the cut follows a real edge") rose 20 to 60 % with every setting. The metric is easy to fool, so I also looked at the output.
- Guided filter with `eps = 1e-3`, no contrast curve: **worse** by eye. It spreads the mask over low-contrast edges and leaves a soft halo (white-on-white statue and the arm of the woman lying on white paper both got a glow).
- Guided filter with `eps = 1e-4` + smoothstep `[0.2, 0.8]` + edge-colour clean-up: **better**. Crisp outline, hair strands follow the real strands, halos gone, statue and street scene cleaner. This is the lab default ("Guided refine + crisp").
- It cannot fix a mask that is wrong in shape (missing arm, wrong subject). It only sharpens a mask that is roughly right.

## Quality, by eye

Contact sheets (original / cut-out on checkerboard / cut-out on magenta), 14 pool photos (people, objects, books, street, night, forest, desert, flowers, statue, paper). Saved under `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/bgremove/` (not committed): `sheet-u2netp.jpg`, `sheet-silueta.jpg`, `sheet-u2net.jpg`, `sheet-u2net_human_seg.jpg`, `sheet-isnet-general-use.jpg`, `sheet-isnet-int8.jpg`, `sheet-u2net-int8.jpg`, `sheet-u2net_human_seg-int8.jpg`; refinement comparison `ref-none.jpg`, `ref-guided-decon.jpg` (eps 1e-3), `ref-g2.jpg` (the good setting).

- **u2netp:** statue, book stack, family, painted door, poster, vintage cover: good. Woman with pearls: loses most of the loose pearls and part of the arm (soft ghost). Street: two walkers right, but ghosts of the crowd behind them. Tea scene: keeps only the open book and a faint cup. Landscapes (forest, night canal, desert, lupins): near-empty or random patches; this is the "no subject" case and the model has no way to say "nothing here".
- **u2net int8 / silueta / u2net fp32:** all three look alike and are consistently better than u2netp: pearls and arm kept, books fully kept, family with clean legs, door with its frame, cup shown (as a ghost). Hair is soft but plausible. Same landscape failures.
- **u2net_human_seg:** best on people (family with full legs, woman with pearls and hands, the two walkers). On non-people it either gives nothing (books, night, desert: good behaviour) or a wrong partial result (the painted figure on the door, a shadow on the tea scene). Needs a "people photo" hint from the user.
- **IS-Net:** finest edges (individual hair strands, pearl strings) but poor choice of subject (book spines only, the plant instead of the door, a glow in the tea scene) and speckled backgrounds. 12 s. Not worth it.
- **Failure modes to design for:** thin and loose items (pearls, hair wisps, wires); low contrast between subject and background; multiple subjects (it keeps the "most salient" group, sometimes ghosts of neighbours); no-subject scenes (landscapes: returns noise, should be detected and refused); transparent objects (glass); shadows (kept as part of the subject on the white-paper photos); painted or printed people (treated as real).

## Recommendation

Ship a tiered design, lazy-loaded, with a touch-up brush.

1. **Fast** (in the repo, `assets/models/u2netp.onnx`, 4.6 MB): default for everyone. Refinement on, edge-colour clean-up on below 1600 px.
2. **Better** (on request, listed in the storage manager): int8 `u2net` (44 MB). Offer it automatically after a Fast result if the person taps "Improve" or after a fail case (mask covers less than 3 % or more than 97 % of the image).
3. **People** (on request): int8 `u2net_human_seg` (44 MB). Offer when the Fast result looks like a portrait/group; it is clearly better there.
4. Do **not** include IS-Net, BiRefNet, RMBG, `@imgly/background-removal`.
5. After a result, always show **Restore / Erase** brush. This is the practical answer to every failure mode above.

Both 44 MB files are derived from the Apache-2.0 U²-Net weights by us (ORT dynamic int8 quantisation, recipe below), so they carry the Apache-2.0 notice and no unverified third-party file. They exceed the 25 MB per-file repo limit, so they live on S3 only and are produced by a script, not committed.

Reproduce the int8 files (needs `pip install onnx onnxruntime`; the sources come from `scripts/fetch-models.js`):

```python
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic('u2net.onnx', 'u2net-int8.onnx', weight_type=QuantType.QUInt8)
quantize_dynamic('u2net_human_seg.onnx', 'u2net_human_seg-int8.onnx', weight_type=QuantType.QUInt8)
```

### What to host on S3

| Path | Bytes | Gzip (CloudFront) | Notes |
|---|---|---|---|
| `/assets/vendor/ort/ort.wasm.min.js` | 48,327 | 15,585 | |
| `/assets/vendor/ort/ort-wasm-simd-threaded.module.js` | 20,856 | 8,425 | ORT's `.mjs` loader renamed so every host sends a JavaScript MIME type; the worker points `wasmPaths` at it |
| `/assets/vendor/ort/ort-wasm-simd-threaded.wasm` | 11,210,254 | 2,868,737 | **`Content-Type: application/wasm`**, long immutable cache, compress (gzip or Brotli) |
| `/assets/models/u2netp.onnx` | 4,574,861 | 4,237,634 | `application/octet-stream`, immutable. Barely compressible; do not bother compressing |
| `/assets/models/u2net-int8.onnx` (later) | 44,212,603 | n.m. | S3 only |
| `/assets/models/u2net_human_seg-int8.onnx` (later) | 44,212,602 | n.m. | S3 only |

First use of the Fast tier downloads about 7.1 MB over the wire (2.9 MB runtime + 4.2 MB model), then it is cached.

### Response headers and the service worker

- `application/wasm` for `.wasm`, `text/javascript` for the loader (`.module.js` avoids needing a rule for `.mjs`).
- **Do not enable COOP/COEP for now.** Threads gave at most 1.5 to 2× on the Fast model, and `Cross-Origin-Embedder-Policy: require-corp` breaks every cross-origin image that does not send `Cross-Origin-Resource-Policy` or CORS headers: **hot-linked stock thumbnails (Pixabay, Pexels, Unsplash, Openverse) would stop rendering** unless each `<img>` is changed to `crossorigin="anonymous"` and the provider sends `Access-Control-Allow-Origin` (most do, not all). `COEP: credentialless` avoids that, but Safari does not support it (as of my knowledge), so threads would be a Chromium/Firefox-only gain. If threads are wanted later, scope the headers to `/studio/` and test the stock panel. The worker already uses threads automatically when `crossOriginIsolated` is true.
- `scripts/build.js` must keep `assets/vendor/ort/` and `assets/models/` **out of the precache** (11 MB runtime and the models are on-demand). I did not touch it.
- Model bytes are cached in Cache Storage `le-models-v1`, keyed by the model URL, with an `x-le-model` header holding the id and `content-length`. The storage manager can list and delete entries; `LE.bgRemove.cachedModels()` and `clearCache()` are provided. If the service worker also precaches the same URL there would be two copies; do not precache.

### Budgets per device tier

| Tier | Example | Model | Input cap (`maxSide`) | Threads | Expect |
|---|---|---|---|---|---|
| Desktop / recent phone | 8+ GB | Fast, Better, People | 2560 | 1 (4 if isolated) | 1.5 s Fast, 3 to 5 s Better |
| Mid-range phone | 4 GB, slow cores | Fast, People (int8) | 1600 | 1 | Fast 3 to 4 s (**estimate**), int8 6 to 10 s |
| Low-end (`deviceMemory` ≤ 2, or `LE.device.tier()` low) | | Fast only | 1024 | 1 | Fast 4 to 6 s; hide the Better download |

Fallbacks: on an out-of-memory error from the worker, retry once with half `maxSide`, then fail with a clear message. `maxSide` bounds the photo-sized buffers (each full-size float plane costs 4 × width × height bytes, and refinement and clean-up use about 10 planes); model input is fixed, so it does not change model memory. Unload the worker (`LE.bgRemove.unload()`) as soon as the person leaves the feature; the idle session pins 300 MB to 1.5 GB.

### UX recommendations

- Nothing downloads until the person taps "Remove background". Show "Downloading 4.6 MB (first time only)" with a progress bar (the API reports it), then "Removing background…".
- Show a cancel button the whole time. `run()` accepts an `AbortSignal`; abort terminates the worker (ONNX Runtime cannot be interrupted mid-run), so the next run reloads the model from Cache Storage in about 2 s.
- Show the result on a checkerboard with before/after, plus "Improve" (switches to Better) and **Restore / Erase** brush with a size slider and an undo step.
- Detect "no subject": if less than 3 % or more than 97 % of pixels are opaque, say "Couldn't find a clear subject" instead of showing noise; offer the manual brush.
- Be honest in the label: "Works best with one clear subject".

## Studio integration (2.7)

What exists today in `assets/js/le-objects.js`: image layers have `mask` (a shape id), `maskPath` (sanitised SVG path clip), `crop`, `adjust`, `filter`, and an older colour-key `removeBg: { tolerance, color }`. `P._imageKey(layer)` includes `removeBg` in the cache key and `P._processImage` builds the preview from the asset plus `imageSteps(layer)`. A bitmap mask does not fit `maskPath` (vector only), so the cut-out needs its own field.

Proposed document shape (data only, per A3/A5):

```json
{
  "type": "image",
  "src": "asset:photo-1",
  "cutout": { "asset": "asset:photo-1-cutout", "model": "u2netp", "feather": 0, "refine": "guided", "version": 1 }
}
```

- `cutout.asset` is an **8-bit alpha mask PNG at the source photo's resolution** (about 100 to 400 KB for typical photos, stored in the project assets like any image, so it round-trips in `.leproject` / `.ledesign` and an agent can swap or delete it). The original photo stays untouched, so the layer is **non-destructive and re-editable**: the person can switch "Remove background" off, change feather, or repaint the mask.
- `model` is informational (what produced the mask, for the storage manager and re-running with a better tier). `feather` and a later `grow`/`shrink` are applied at render time, not baked.
- Rendering: in `_processImage`, after `assetCanvas(rec)` and before crop/adjust, if `layer.cutout` is set, draw the mask asset with `destination-in` at the source size (`LE.bgRemove.applyMask(src, mask)` already does this). Add `layer.cutout` to `_imageKey`. Export uses the same path. `sanitize` the layer: `cutout.asset` must name an existing image asset, `feather` clamped to 0..20.
- Edge-colour clean-up cannot be re-derived from a mask alone. Two options: bake it into the colour of the cut-out raster asset as a second asset (`cutout.cut`), or skip it in the studio. I recommend baking it at creation time and storing only the mask in the document, accepting a slight halo when the person later feathers more.
- Touch-up brush: paints into the mask asset (a canvas) and writes the PNG back through `addAsset` under the same key; undo uses the existing asset history.
- Engine changes needed: `le-objects.js` (sanitise `cutout`, render step, key), a new `le-studio-cutout.js` for the panel and brush (A2), the storage-manager hook for `le-models-v1`. Move `labs/bg-remove/bg-remove.js` and `bg-worker.js` to `assets/js/` (call `LE.bgRemove.config({ root: '/' })`) and delete the lab or keep it as a tool page.

## API (prototype, stable enough to adopt)

```js
LE.bgRemove.config({ root: '/' })                        // site root, default derived from the script path
LE.bgRemove.models()                                     // [{ id, label, tier, bytes, size, subject, licence, url, bundled }]
await LE.bgRemove.isAvailable(id)                        // HEAD probe
await LE.bgRemove.load(id, onProgress, { ep: 'wasm'|'webgpu'|'auto', threads: 1, cache: true })
  // onProgress({ loaded, total, fraction, cached, stage })  -> { ep, threads, isolated, timings, fromCache }
await LE.bgRemove.run(imageBitmapOrCanvasOrImage, {
  refine: 'guided'|'none', harden: [0.2, 0.8], feather: 0, decontaminate: true, maxSide: 2560, stats: false, signal })
  // -> { mask: ImageData (RGB 255, alpha = mask), canvas, width, height, timings, stats, model }
LE.bgRemove.applyMask(source, mask, w?, h?)              // -> canvas (re-compose from a stored mask)
LE.bgRemove.isLoaded()                                   // current model id or null
LE.bgRemove.cachedModels() / clearCache()                // Cache Storage 'le-models-v1'
LE.bgRemove.unload()
```

## Risks

- **Quality expectations.** Canva-class results on hair and busy scenes are not reachable at 4.6 MB. Mitigate with the brush and honest copy.
- **Legal.** U²-Net weights are Apache-2.0 but trained on DUTS-TR (no stated licence); `u2net_human_seg` on the Supervisely Person Dataset. IS-Net and BiRefNet are trained on DIS5K (non-commercial terms). I have not seen a case enforced, but it is the owner's call; the Fast tier carries the least exposure only because its code and weights licence is clean. Get counsel before launch.
- **Memory on phones.** Peak RSS 700 MB to 1 GB for the shipped tiers. Guard with device tier and an OOM retry; unload when idle.
- **Safari.** `OffscreenCanvas` 2D in workers and `createImageBitmap(ImageBitmap)` need Safari 16.4+; not tested here (Chromium only). WASM SIMD is fine on current Safari.
- **Dynamic `import()` in a classic worker** is used by ORT's loader: Chromium and Firefox 114+ are fine; unverified on Safari.
- **No-subject scenes** return noise; needs the coverage check above.
- **Phone timings are estimates**; real-device testing is required before promising a number in the UI.
- **Sandbox noise.** CPU was shared; do not quote these times as benchmarks.

## Files and how to reproduce

- Lab: `labs/bg-remove/index.html`, `bg-remove.js`, `bg-worker.js`. Serve the repo root and open `/labs/bg-remove/`.
- Larger candidates for local evaluation: `node scripts/fetch-models.js all` (to `assets/models/local/`, git-ignored; ~800 MB). `--webgpu` fetches the WebGPU runtime into `assets/vendor/ort-webgpu/` (git-ignored).
- Test: `node tests/run.js bg-remove`.
