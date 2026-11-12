# Third-party licenses

Everything under `assets/vendor/`, `assets/fonts/`, and `assets/data/` is vendored so LocalEditor can run offline. Only MIT, ISC, BSD, Apache-2.0, and OFL-1.1 material is included.

## JavaScript

| Name | Version | License | Files | Source |
|---|---|---|---|---|
| pdf.js (Mozilla) | 3.11.174 | Apache-2.0 | `assets/vendor/pdf.min.js`, `assets/vendor/pdf.worker.min.js` | https://github.com/mozilla/pdf.js |
| pdf-lib | vendored build (version string not embedded in the bundle) | MIT | `assets/vendor/pdf-lib.min.js` | https://github.com/Hopding/pdf-lib |
| QR Code Generator for JavaScript (Kazuhiko Arase) | 2009 script | MIT | `assets/vendor/qrcode.js` | http://www.d-project.com/ · https://github.com/kazuhikoarase/qrcode-generator |
| @pdf-lib/fontkit | 1.1.1 | MIT | `assets/vendor/fontkit.umd.min.js` | https://github.com/Hopding/fontkit |
| mammoth | 1.13.0 | BSD-2-Clause | `assets/vendor/mammoth.browser.min.js` | https://github.com/mwilliamson/mammoth.js |
| @cantoo/pdf-lib (pdf-lib fork with PDF encryption and decryption; bundles fflate MIT, culori MIT, node-html-better-parser MIT, @pdf-lib/standard-fonts MIT, @pdf-lib/upng MIT, tslib 0BSD) | 2.11.1 | MIT | `assets/vendor/pdf-lib-crypt.min.js` (the package's `dist/pdf-lib.min.js`, source-map comment removed; SHA-256 of the npm file before that edit is recorded in the commit message); licence text `assets/vendor/licenses/cantoo-pdf-lib-LICENSE.txt`. Loaded on first use by `le-pdf-bulk.js` only (password protect/unlock), under its own name so the studio's `PDFLib` global is not replaced. | https://www.npmjs.com/package/@cantoo/pdf-lib · https://github.com/cantoo-scribe/pdf-lib |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | `assets/vendor/xlsx.full.min.js` | https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz |
| JSZip (includes pako) | 3.10.2 | MIT (dual MIT / GPL-3.0-or-later; used under MIT) | `assets/vendor/jszip.min.js` | https://github.com/Stuk/jszip |
| DOMPurify | 3.4.17 | Apache-2.0 OR MPL-2.0 | `assets/vendor/purify.min.js` | https://github.com/cure53/DOMPurify |
| marked | 18.1.3 | MIT | `assets/vendor/marked.umd.js` | https://github.com/markedjs/marked |
| html2canvas | 1.4.1 | MIT | `assets/vendor/html2canvas.min.js` | https://github.com/niklasvh/html2canvas |
| onnxruntime-web | 1.22.0 | MIT | `assets/vendor/ort/ort.wasm.min.js`, `assets/vendor/ort/ort-wasm-simd-threaded.module.js` (renamed from `.mjs` so every static host serves a JavaScript MIME type), `assets/vendor/ort/ort-wasm-simd-threaded.wasm`; licence text `assets/vendor/licenses/onnxruntime-LICENSE.txt` | https://www.npmjs.com/package/onnxruntime-web · https://github.com/microsoft/onnxruntime |
| onnxruntime-web (WebGPU build) | 1.31.1 | MIT | `assets/vendor/ort-webgpu/ort.webgpu.min.js`, `assets/vendor/ort-webgpu/ort-wasm-simd-threaded.asyncify.module.js` (renamed from `.asyncify.mjs`), `assets/vendor/ort-webgpu/ort-wasm-simd-threaded.asyncify.wasm`; unmodified from the npm package `dist/`; licence text `assets/vendor/licenses/onnxruntime-LICENSE.txt`. Loaded only for the large background-remover options (`runtime: 'webgpu'`). | https://www.npmjs.com/package/onnxruntime-web/v/1.31.1 · https://github.com/microsoft/onnxruntime |
| tesseract.js worker script (text recognition) | 7.0.0 | Apache-2.0 (the minified worker also bundles `buffer` MIT, `ieee754` BSD-3-Clause, `regenerator-runtime` MIT, `zlibjs` MIT, `bmp-js` MIT, `is-url` MIT, `wasm-feature-detect` Apache-2.0) | `assets/vendor/tesseract/worker.min.js`; licence text `assets/vendor/licenses/tesseract.js-LICENSE.txt` | https://www.npmjs.com/package/tesseract.js · https://github.com/naptha/tesseract.js |
| tesseract.js-core (Tesseract 5 LSTM engine, Leptonica, compiled to WebAssembly) | 7.0.0 | Apache-2.0 | `assets/vendor/tesseract/tesseract-core-simd-lstm.wasm.js`, `assets/vendor/tesseract/tesseract-core-lstm.wasm.js` (no-SIMD fallback); licence text `assets/vendor/licenses/tesseract.js-core-LICENSE.txt` | https://www.npmjs.com/package/tesseract.js-core · https://github.com/naptha/tesseract.js-core |
| jsQR (QR code reader; **tests only**, never loaded by the site) | 1.4.0 | Apache-2.0 | `tests/lib/jsqr.js` (the package's `dist/jsQR.js`, unchanged; SHA-256 bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859); licence text `assets/vendor/licenses/jsqr-LICENSE.txt`. Used by `tests/pdf-office.test.js` to decode the fingerprint receipt QR codes. | https://www.npmjs.com/package/jsqr · https://github.com/cozmo/jsQR |
| woff2-encoder (WOFF2 decoder: Google woff2 MIT + Brotli MIT compiled to WebAssembly, inline) | 2.0.0 | MIT | `assets/vendor/woff2-decompress.js` (the package's `dist/decompress.js`, SHA-256 6910ba38d0a981513b297701d309fa2efc4f67a311815bcc4de5837085d2ee46 before the edit: the ES module export replaced by `window.LEWoff2Decompress` and the file wrapped in a function). Loaded only when a library font is embedded in a PDF. Licence texts `assets/vendor/licenses/woff2-encoder-LICENSE.txt`, `assets/vendor/licenses/woff2-brotli-LICENSE.txt` | https://www.npmjs.com/package/woff2-encoder · https://github.com/itskyedo/woff2-encoder · https://github.com/google/woff2 · https://github.com/google/brotli |
| jsQR (QR code reader; **tests only**, never loaded by the site) | 1.4.0 | Apache-2.0 | `tests/lib/jsqr.js` (the package's `dist/jsQR.js`, unchanged; SHA-256 bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859); licence text `assets/vendor/licenses/jsqr-LICENSE.txt`. Used by `tests/pdf-office.test.js` to decode the fingerprint receipt QR codes and by `tests/makers.test.js` to read back the QR codes makers draw. | https://www.npmjs.com/package/jsqr · https://github.com/cozmo/jsQR |
| GlyphLessFont (572-byte blank-glyph TrueType font, embedded as base64 in the invisible text layer of searchable PDFs) | from Tesseract `pdf_ttf.h` | Apache-2.0 | inside `labs/pdf-ocr/ocr.js` | https://github.com/tesseract-ocr/tesseract |

The word “QR Code” is a registered trademark of Denso Wave Incorporated.

## UI fonts (site chrome)

These are the faces already referenced from `assets/css/app.css`. They are separate from the editor library below.

| Family | License | Files | Source |
|---|---|---|---|
| Plus Jakarta Sans | SIL Open Font License 1.1 | `assets/fonts/jakarta-latin.woff2`, `assets/fonts/jakarta-latin-ext.woff2` | https://fonts.google.com/specimen/Plus+Jakarta+Sans |
| Instrument Serif | SIL Open Font License 1.1 | `assets/fonts/instrument-serif.woff2`, `assets/fonts/instrument-serif-italic.woff2` | https://fonts.google.com/specimen/Instrument+Serif |

## Editor font library

257 families (253 in the repository, 4 Chinese/Japanese/Korean families downloaded at deploy time), every one OFL-1.1 or Apache-2.0, built from the Fontsource npm packages of the Google Fonts catalogue by `scripts/fetch-fonts.js` with pinned versions and tarball hashes (`scripts/fonts/lock.json`). The full table (family, licence, package and version, Google Fonts version, copyright line) is generated into `assets/vendor/licenses/fonts-LICENSES.md`. Each family folder (`assets/fonts/library/<slug>/`, `assets/fonts/cjk/<slug>/`) carries `LICENSE.txt`: the copyright notice and the complete licence text from the package. Font files are unmodified; `assets/fonts/previews/` holds name-only subsets used under internal names. How the library is built: `docs/FONTS.md`.

The `.woff` files the original 44 families shipped for pdf-lib were removed: PDF embedding decodes the woff2 files (see `docs/FONTS.md`, PDF).

## Icons, emoji, stickers

| Name | Version | License | Files | Source |
|---|---|---|---|---|
| Lucide | icon set via `@iconify-json/lucide` 1.2.151 (2100 icons) | ISC | `assets/data/lucide.json` | https://lucide.dev · https://github.com/lucide-icons/lucide |
| Phosphor | 2.1.1 via `@iconify-json/ph` 1.2.2 (600 names × regular, fill, and duotone = 1798 icons) | MIT | `assets/data/phosphor.json` | https://phosphoricons.com · https://github.com/phosphor-icons/core |
| Fluent Emoji (flat) | via `@iconify-json/fluent-emoji-flat` 1.2.6 (918 icons across smileys, people, animals, food, travel, activities, objects, symbols) | MIT | `assets/data/emoji.json` | https://github.com/microsoft/fluentui-emoji |
| LocalEditor stickers | original artwork, 2026 (42 stickers) | LocalEditor (no upstream license) | `assets/data/stickers.json` | authored in `scripts/fetch-assets.js` |
| withicons | 0.6.0 (`@withicons/core`, `@withicons/core-plus`, `@withicons/soft3d`, `@withicons/holiday`; 1000 icons × 34 styles) | MIT | `assets/data/withicons/*.json`, `assets/vendor/licenses/withicons-LICENSE.txt` | https://withicons.com · https://github.com/withicons |

Icon JSON is the Iconify collection format. Lucide’s license is ISC. Phosphor and Fluent Emoji are MIT. Bodies are sanitized at build time (no script, event handlers, `foreignObject`, or external URLs).

## Models

Downloaded only when the user asks (studio background remover, `assets/js/le-bgremove.js`; see `docs/research/background-remover.md`). Never precached. Cached in Cache Storage `le-models-v1`; the person can remove each one from the studio chooser or the storage manager.

| Name | License | Files | Source |
|---|---|---|---|
| U²-Net `u2netp` (4.7 MB ONNX export) | Apache-2.0 (code and weights, Xuebin Qin) | `assets/models/u2netp.onnx`; licence text `assets/vendor/licenses/u2net-LICENSE.txt` | https://github.com/xuebinqin/U-2-Net · ONNX from https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx (rembg, MIT) |
| U²-Net `u2net`, 8-bit ("More detail", 44,212,603 bytes, sha256 `4259d8dc46943e2881462fe8ac9657a18dad67cb7dfe0890d4f66e3d2b5fdfee`) | Apache-2.0 (derived from the Apache-2.0 weights; carries the same notice) | `assets/models/u2net-int8.onnx`; licence text `assets/vendor/licenses/u2net-LICENSE.txt` | Source fp32 `u2net.onnx` (175,997,641 bytes, sha256 `8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491`) from https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx (ONNX export of https://github.com/xuebinqin/U-2-Net weights), quantised by LocalEditor with onnxruntime `quantize_dynamic(weight_type=QUInt8)` |
| U²-Net `u2net_human_seg`, 8-bit ("People and portraits", 44,212,602 bytes, sha256 `1a971f94f2a294387837ae5dd7d013e8043f528ec196cb83f84e32fe55e27a58`) | Apache-2.0 (derived, same notice) | `assets/models/u2net_human_seg-int8.onnx`; licence text `assets/vendor/licenses/u2net-LICENSE.txt` | Source fp32 `u2net_human_seg.onnx` (175,997,641 bytes, sha256 `01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c`) from https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx, quantised the same way |
| BiRefNet lite ("Better" on graphics cards; `birefnet-lite-1024-fp16.onnx`, 108,834,041 bytes, sha256 `6e2bf49837725020dd4c0b669302ced96f0260e86138a832aa8fc068894d9150`) | MIT (code and weights, ZhengPeng 2024) | `assets/models/pro/` on S3 only (not in git); licence text `assets/vendor/licenses/birefnet-LICENSE.txt` | Weights `BiRefNet-general-bb_swin_v1_tiny-epoch_232.pth` (177,791,685 bytes, sha256 `6a1e050c…875ab1`) from https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1, re-exported to ONNX (DeformConv, 1024 px) and converted to fp16 by LocalEditor (`scripts/models/`) |
| BiRefNet ("Best" on graphics cards; `birefnet-1024-fp16.onnx`, 480,500,583 bytes, sha256 `47f87854…c65bcc`) | MIT (code and weights) | `assets/models/pro/` on S3 only; licence text `assets/vendor/licenses/birefnet-LICENSE.txt` | Weights `BiRefNet-general-epoch_244.pth` (885,082,437 bytes, sha256 `11341a6a…cc77c`) from the same release, same conversion |
| BEN2 base ("Best for people"; `ben2-1024-fp16.onnx`, 222,932,053 bytes, sha256 `22cea621…998101`) | MIT (Prama LLC 2025; model card `license: mit` and the GitHub LICENSE) | `assets/models/pro/` on S3 only; licence text `assets/vendor/licenses/ben2-LICENSE.txt` | `BEN2_Base.onnx` from https://huggingface.co/PramaLLC/BEN2 (revision e48a2076…), shipped unchanged |
| BiRefNet model code (build tool only) | MIT | `scripts/models/birefnet_arch.py` (trimmed copy, notice in the header) | https://huggingface.co/ZhengPeng7/BiRefNet (revision e2bf8e44…) |
| Chooser example images | LocalEditor (made from pool photos, see `assets/data/collages/photos.json` for their CC licences and credits: arch-01, books-02, people-07, street-01, garden-02) | `assets/img/cutout/*.jpg` | rendered by the background remover |

Training-data note for the large models: BiRefNet's general weights were trained on DIS5K, DUTS, HRSOD, UHRSD, HRS10K, P3M-10k and a humans set; BEN2 on DIS5K plus a private 22K-image set of its authors. DIS5K's terms say "non-commercial use in research or educational purpose" (see the earlier spike); the other sets' terms were not re-checked. The MIT grant covers code and weights; whether training-set terms reach the weights is unresolved. Same residual risk as below, larger: ask counsel before relying on these commercially.

Training-data note: u2netp is trained on DUTS-TR, a research saliency dataset with no stated licence. The Apache-2.0 grant covers the weights; the dataset provenance is an unresolved residual risk that the owner should accept knowingly.

### Text recognition language data

Downloaded only when the user asks (scanned PDF text, labs/pdf-ocr; see `docs/research/pdf-ocr-scan.md`). Cached in Cache Storage `le-models-v1`. `tessdata_fast` is the integer LSTM data published by the Tesseract project; the licence file is `assets/vendor/licenses/tessdata_fast-LICENSE.txt`. The `@tesseract.js-data/*` npm packages repackage the same data and label themselves MIT; we use the upstream Apache-2.0 files instead.

| Name | License | Files | Source |
|---|---|---|---|
| tessdata_fast `eng` (4.1 MB) | Apache-2.0 | `assets/models/ocr/eng.traineddata` (committed) | https://github.com/tesseract-ocr/tessdata_fast |
| tessdata_fast `spa` `por` `fra` `deu` `hin` `ara` (1.1 to 2.3 MB each) | Apache-2.0 | `assets/models/ocr/more/<id>.traineddata` (not committed; `node scripts/fetch-ocr-data.js`) | https://github.com/tesseract-ocr/tessdata_fast |

## Optional module: Camera RAW support (owner-approved exception to the licence rule)

**Exception.** On 12 November 2026 the owner decided that camera RAW formats may use the decoder that covers the most cameras, as an optional download with its licence shown to the person, limited to this module. LibRaw is LGPL-2.1 (dual-licensed LGPL-2.1 / CDDL-1.0), which is outside the MIT / ISC / BSD / Apache / OFL rule, so it lives in its own section and its own directory and nothing else may follow it. Conditions, and where each is met: separate file in `assets/vendor/raw-decoder/`, loaded only when a camera RAW file is opened, in a Worker, never bundled or linked into editor code (`assets/js/raw/raw.js` talks to it only by `postMessage`); replaceable (interface and steps in `assets/vendor/raw-decoder/README.md`); downloaded through `LE.downloads` and cached in `le-models-v1` (`x-le-model: raw-camera`, listed in the storage manager as "Camera RAW support"); licence shown once at first use, in the storage manager, and at `/licenses/#libraw`; licence text, copyright notices, exact source version and hashes, build script (no patches) kept in this repository. Never precached.

| Name | Version | License | Files | Source |
|---|---|---|---|---|
| LibRaw (camera RAW decoder, compiled to WebAssembly with LocalEditor's glue) | 0.22.2 | **LGPL-2.1** (LibRaw is dual-licensed LGPL-2.1 / CDDL-1.0; LocalEditor elects LGPL-2.1). Contains DCB and FBDD code under a BSD-style 3-clause licence (Jacek Gozdz), X3F code under a BSD-style licence (Roland Karlsson), pieces of the Adobe DNG SDK 1.4 under the MIT licence, and non-restricted parts of dcraw.c (Dave Coffin); see the COPYRIGHT file | `assets/vendor/raw-decoder/raw-decoder.wasm`; licence texts `assets/vendor/licenses/libraw-LICENSE.LGPL.txt`, `libraw-LICENSE.CDDL.txt`, `libraw-COPYRIGHT.txt` | https://github.com/LibRaw/LibRaw (tag 0.22.2) · https://www.libraw.org/ · exact files and SHA-256: `tools/raw-decoder/sources.json` · build: `tools/raw-decoder/` |
| Emscripten runtime inside the module (JavaScript loader, musl libc, libc++, libc++abi, compiler-rt) | 7.0.0 | MIT or UIUC/NCSA (Emscripten); MIT (musl); Apache-2.0 with LLVM exception (libc++, libc++abi, compiler-rt) | `assets/vendor/raw-decoder/raw-decoder.js` and compiled into `raw-decoder.wasm`; texts in `assets/vendor/licenses/emscripten-runtime-LICENSES.txt` | https://github.com/emscripten-core/emscripten |
| Camera RAW bridge worker and C glue | LocalEditor's own code | same terms as the rest of LocalEditor's code | `assets/vendor/raw-decoder/raw-decoder-worker.js`, `tools/raw-decoder/glue.cpp` | this repository |

Not included, by design: LibRaw-demosaic-pack-GPL2 and LibRaw-demosaic-pack-GPL3 (GPL), and any other GPL code. Demosaic methods that remain: linear, VNG, PPG, AHD, DCB, DHT, AAHD, Markesteijn (X-Trans).

## RAW and HDR research code (our own, no third-party code)

`assets/js/raw/` (DNG reader, demosaic, colour, develop reference) and `labs/hdr/` are written from public specifications and papers only (TIFF 6.0, Adobe DNG 1.6, ITU T.81 lossless mode, Malvar-He-Cutler 2004, Hamilton-Adams 1997, Mertens-Kautz-Van Reeth 2007, Debevec-Malik 1997, Ward 2003, Kim et al. 2002 for the Planckian locus). No code was copied from LibRaw, dcraw, darktable, RawTherapee or any other project. `tools/dng-synth/` writes test files.
