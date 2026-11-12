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

The word “QR Code” is a registered trademark of Denso Wave Incorporated.

## UI fonts (site chrome)

These are the faces already referenced from `assets/css/app.css`. They are separate from the editor library below.

| Family | License | Files | Source |
|---|---|---|---|
| Plus Jakarta Sans | SIL Open Font License 1.1 | `assets/fonts/jakarta-latin.woff2`, `assets/fonts/jakarta-latin-ext.woff2` | https://fonts.google.com/specimen/Plus+Jakarta+Sans |
| Instrument Serif | SIL Open Font License 1.1 | `assets/fonts/instrument-serif.woff2`, `assets/fonts/instrument-serif-italic.woff2` | https://fonts.google.com/specimen/Instrument+Serif |

## Editor font library

Self-hosted from the Google Fonts CSS API (`scripts/fetch-fonts.js`) on 2026-11-07. Each family has latin and latin-ext WOFF2 for the browser when Google publishes that subset, plus one WOFF per face for pdf-lib / fontkit. Files live in `assets/fonts/library/<slug>/`. OFL texts: https://openfontlicense.org/

| Family | License | Google Fonts version | Weights |
|---|---|---|---|
| Inter | OFL-1.1 | v20 | 400, 700, italic 400 |
| Poppins | OFL-1.1 | v24 | 400, 700 |
| Montserrat | OFL-1.1 | v31 | 400, 700 |
| DM Sans | OFL-1.1 | v17 | 400, 700 |
| Manrope | OFL-1.1 | v23 | 400, 700 |
| Space Grotesk | OFL-1.1 | v22 | 400, 700 |
| Outfit | OFL-1.1 | v15 | 400, 700 |
| Nunito | OFL-1.1 | v32 | 400, 700, italic 400 |
| Work Sans | OFL-1.1 | v24 | 400, 700 |
| Rubik | OFL-1.1 | v31 | 400, 700 |
| Plus Jakarta Sans | OFL-1.1 | v12 | 400, 700 |
| Playfair Display | OFL-1.1 | v40 | 400, 700, italic 400 |
| Lora | OFL-1.1 | v37 | 400, 700, italic 400 |
| Merriweather | OFL-1.1 | v33 | 400, 700, italic 400 |
| DM Serif Display | OFL-1.1 | v17 | 400, italic 400 |
| Cormorant Garamond | OFL-1.1 | v21 | 400, 700, italic 400 |
| Libre Baskerville | OFL-1.1 | v24 | 400, 700, italic 400 |
| Fraunces | OFL-1.1 | v38 | 400, 700, italic 400 |
| EB Garamond | OFL-1.1 | v33 | 400, 700, italic 400 |
| Instrument Serif | OFL-1.1 | v5 | 400, italic 400 |
| Bebas Neue | OFL-1.1 | v16 | 400 |
| Anton | OFL-1.1 | v27 | 400 |
| Archivo Black | OFL-1.1 | v23 | 400 |
| Abril Fatface | OFL-1.1 | v25 | 400 |
| Righteous | OFL-1.1 | v18 | 400 |
| Lobster | OFL-1.1 | v32 | 400 |
| Bungee | OFL-1.1 | v17 | 400 |
| Oswald | OFL-1.1 | v57 | 400, 700 |
| Syne | OFL-1.1 | v24 | 400, 700 |
| Dancing Script | OFL-1.1 | v29 | 400, 700 |
| Great Vibes | OFL-1.1 | v21 | 400 |
| Caveat | OFL-1.1 | v23 | 400, 700 |
| Sacramento | OFL-1.1 | v17 | 400 |
| Pacifico | OFL-1.1 | v23 | 400 |
| Satisfy | OFL-1.1 | v22 | 400 (latin only) |
| Allura | OFL-1.1 | v23 | 400 |
| Kalam | OFL-1.1 | v18 | 400, 700 |
| Shadows Into Light | OFL-1.1 | v22 | 400 |
| Homemade Apple | Apache-2.0 | v24 | 400 (latin only) |
| Mr Dafoe | OFL-1.1 | v15 | 400 |
| Alex Brush | OFL-1.1 | v23 | 400 |
| JetBrains Mono | OFL-1.1 | v24 | 400, 700 |
| Space Mono | OFL-1.1 | v17 | 400, 700 |
| IBM Plex Mono | OFL-1.1 | v20 | 400, 700 |

Specimen pages: `https://fonts.google.com/specimen/<Family>` (spaces as `+`).

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

Training-data note: u2netp and u2net are trained on DUTS-TR; u2net_human_seg on the Supervisely Person dataset. u2netp is trained on DUTS-TR, a research saliency dataset with no stated licence. The Apache-2.0 grant covers the weights; the dataset provenance is an unresolved residual risk that the owner should accept knowingly.
