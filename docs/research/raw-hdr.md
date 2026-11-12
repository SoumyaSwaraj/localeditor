# RAW photographs and HDR merge (S1): research spike

Written 12 November 2026. Prototypes: `labs/raw/`, `labs/hdr/` (not linked from the site); reusable code in `assets/js/raw/` and `assets/vendor/raw-decoder/` (lazy-loaded, never precached). Test generator: `tools/dng-synth/`. Tests: `tests/raw.test.js`, `tests/hdr.test.js`. Comparison sheets: `docs/research/raw-hdr/`.

**How to read the numbers.** Quality numbers are exact and repeatable (synthetic files with known truth, plus two real Nikon files). Speed numbers were measured on a shared 4-core sandbox whose load average was about 48 (a dozen engineers) while I measured, so wall-clock times are inflated several times over. Where it matters I give **CPU time** (`process.cpuUsage`), which is close to what an idle desktop core needs. Phone figures are **estimates**.

## Sample images

Comparison sheets made by the prototypes (also in `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/raw-hdr/sheets/` for the build session): `docs/research/raw-hdr/sheet-demosaic.png` (sensor mosaic, MHC, edge-directed, truth, 4x zoom), `sheet-highlights.png`, `sheet-hdr.png` (five brackets, fusion, three tone maps, ghosts on and off), `sheet-real-nef.png` (the real D700 and D80 files, developed by our reference).

## Answer

| Question | Answer |
|---|---|
| Can the browser develop RAW photographs under our rules? | **Yes for DNG with our own code, today; for camera formats with the optional LibRaw module the owner approved.** Both run in Workers, fully offline after the first download, behind one call (`LE.raw.probe` / `LE.raw.decode`). |
| Built-in (our code) | Reads DNG from phones and cameras: uncompressed (8 to 16 bit, packed or not, either byte order), lossless JPEG, deflate, strips and tiles, linear (ProRAW-style) DNG, linearisation tables, black and white levels, gain-map and vignette opcodes, default crop, embedded previews, DNG colour (ColorMatrix, ForwardMatrix, calibration illuminants, as-shot white or any temperature and tint). Measured on synthetic files: demosaic 31.8 dB, colour-chart error dE76 0.28 mean (0.43 max). **Not verified on a single real phone DNG** (none was reachable from the sandbox). |
| Camera module (LibRaw 0.22.2, our build) | `raw-decoder.wasm` is **720 KB** (289 KB gzip), starts in tens of milliseconds, decoded two real Nikon NEF files (D700, D80) correctly. CR2, CR3, ARW, RAF, ORF, RW2, PEF, SRW **could not be tested on real full files** (no source reachable); the module is built from the same source LibRaw users rely on. |
| Develop controls (what X5 builds on) | Exposure, white balance in the right space, highlight recovery (our colour propagation: better than clipping on luminance, with visible artefacts in skies), shadows, base curve plus six looks, wavelet and bilateral denoise, unsharp mask, lateral CA estimate and fix, vignette. All have a CPU reference that the GPU shaders must match. |
| HDR | **Exposure fusion** (Mertens) and **radiance merge** with alignment (shift and up to 3 degrees of rotation) and ghost removal. Radiance error 0.01 EV median on a 10-stop synthetic scene; ghost error cut about 50-fold on a 512 x 384 test (about 4-fold on a 256 x 192 one). **Too slow in JavaScript at full size** (see measurements); the plan is a GPU port in X5, with the JS version as the reference and the small-preview path. |
| Not good enough yet | Real-phone DNG verification; JPEG XL DNG (the module excludes libjxl); highlight recovery on bright skies; fine-detail denoise on natural texture; automatic lens correction (needs profile data, see below); camera "profiles" (see below); full-size HDR merge speed. |

## A. RAW decoding

### A1. Formats and decoders

Licences are read from the file in each project's own repository or package (links in the Source column), not from memory. "Unverified" means I could not fetch the licence text from this sandbox.

| Decoder | Formats | Code licence (source) | Size | State | Verdict |
|---|---|---|---|---|---|
| **Our own reader** (`assets/js/raw/raw-core.js`) | DNG: Bayer RGGB-type CFA and linear (3-sample) DNG; uncompressed, lossless JPEG, deflate (fp predictors too); embedded JPEG previews of the other formats (NEF verified on two real files and RW2 on a tiny fixture; CR2, ARW, ORF, RAF, PEF, CR3 by the same rules, untested) | Ours | 60 KB (20 KB gzip) + 25 KB develop | Written for this spike; tested on synthetic files only | **Default for DNG.** No download |
| **LibRaw 0.22.2** | About 1,300 cameras per its own count (the FlashRaw comparison table cites 1,284 "its own count"): CR2, CR3, CRW, NEF, ARW, SR2, RAF incl. X-Trans, ORF, RW2, PEF, SRW, DNG, IIQ, 3FR, MRW, X3F and more | **LGPL-2.1 or CDDL-1.0** (`LICENSE.LGPL`, `LICENSE.CDDL` in tag 0.22.2 of https://github.com/LibRaw/LibRaw; `COPYRIGHT`: also contains DCB/FBDD BSD-style code, X3F BSD-style code, pieces of the Adobe DNG SDK 1.4 under MIT, and dcraw.c "RESTRICTED code not used") | Our build: 720 KB wasm (289 KB gzip, 239 KB brotli) + 13 KB loader | Active (copyright 2008-2025, release 0.22.2) | **Chosen for the optional camera module** (owner decision). Demosaic packs under GPL are not built |
| dcraw | Most formats of its time | Own terms; LibRaw's COPYRIGHT says parts are "RESTRICTED"; npm `dcraw` 1.0.3 is labelled GPL-2.0; the FlashRaw comparison says Foveon code is GPL-2+ | n/a | Last release 2018 (dcraw 9.28) | No |
| RawSpeed | About 920 make/model pairs (FlashRaw's count), raw data only | LGPL-2.1+ (`LICENSE` in https://github.com/darktable-org/rawspeed, develop) | n/a | Active (darktable) | No: C++ with no ready WebAssembly build and LGPL |
| rawloader / rawler (dnglab) | About 850 make/model pairs (FlashRaw's count) | **LGPL-2.1** (`Cargo.toml` of rawloader 0.37.2 and of `rawler` in https://github.com/dnglab/dnglab) | n/a | Active (dnglab) | Not permissive |
| libopenraw | CR2, NEF, ARW, ORF, DNG and others | **Unverified**: the licence file was not reachable. Believed LGPL (v3) | n/a | n/a | Not examined further |
| Adobe DNG SDK | DNG, plus all vendor DNG variants | **Unverified here** (adobe.com not reachable); LibRaw's COPYRIGHT says it uses pieces of SDK 1.4 "licensed under MIT license" | n/a | Active | Not needed |
| **FlashRaw** 0.2.0 (npm `flashraw`, https://github.com/ybouane/flashraw) | About 40 formats: DNG, CR2, CR3, NEF, ARW, RAF, RW2, ORF, PEF, SRW, IIQ, 3FR, MRW and more; JPEG XL DNG; self-reported 1,980 of 2,016 raw.pixls.us files decode | **MIT OR Apache-2.0** (`license` in `package.json`, `LICENSE-MIT`, `LICENSE-APACHE` in the tarball; its CONTRIBUTING forbids copying LGPL or GPL code or tables) | WASM 3.1 MB SIMD (README: about 756 KiB brotli), 4.7 MB with JPEG XL; optional WebGPU build | **Brand new**: version 0.2.0 on 11 November 2026, two releases, one author | **Not executed in this spike** (running third-party code was refused by the sandbox policy); read and compared only. **The most promising permissive option to watch** (see A2). Its camera database has 1,186 colour matrices of which the project's own audit says 913 "cannot be derived" from sample files, so where those numbers come from is not independently checkable |
| tinydng (https://github.com/syoyo/tinydng) | DNG, TIFF, PSD; lossless JPEG, deflate, LZW, tiles | **MIT** (`LICENSE`) | single C11 header | Maintained | Could be compiled to WebAssembly; not needed because our JS reader does the same |
| utif2 / UTIF.js | TIFF (and some DNG) | MIT (npm `utif2` 4.1.0) | 100 KB | Slow-moving | Not used |
| jpeg-lossless-decoder-js | Lossless JPEG (the DNG and CR2 codec) | MIT (npm 2.1.2) | 6 MB unpacked with tests | 2024 | We wrote our own 130-line decoder instead |
| libjxl / `@jsquash/jxl` | JPEG XL (DNG 1.7) | `@jsquash/jxl` 1.3.0: Apache-2.0 (npm); libjxl itself is BSD-3 (not re-verified here) | 5.8 MB unpacked | 2025 | The way to add JPEG XL DNG later; not included |
| npm wrappers of LibRaw | as LibRaw | `libraw-wasm` 1.6.0 is labelled **ISC** on npm but its tarball carries no licence file and it wraps LibRaw (LGPL/CDDL), so the label is wrong for the wasm. `@colorhythm/libraw-wasm` 1.1.1 labelled MIT (wrapper), ships LibRaw's licence files; `rawconvert-wasm` 0.1.1 MIT wrapper, its README says LibRaw LGPL/CDDL; `libraw-mini` 0.1.9 labelled MIT, no LibRaw licence visible; `raw-webgpu` 0.2.0 MIT wrapper with LibRaw CDDL notices; `@wasmedia/wlibraw` 0.3.0 LGPL-2.1-only; `libraw.js` 3.0.0 LGPL-2.1 | 0.85 to 2 MB wasm each | 2023 to 2026 | **Do not use as shipped**: the labels do not describe what is inside. We built LibRaw ourselves (below) |
| `extract-raw-preview` 1.1.0 | Embedded previews of most formats | MIT (npm) | 0.5 MB | 2026 | Not needed: our reader does previews |

### A2. The licence decision, as decided

**Decision (owner, 12 November 2026):** camera formats may use the decoder that covers the most cameras, as an optional download, with its licence shown, limited to that module. Recorded in `docs/EXPERT-MODE.md`, `docs/HANDOFF.md`, and in its own marked section of `assets/vendor/LICENSES.md`.

**Which licence option.** LibRaw is dual-licensed LGPL-2.1 / CDDL-1.0. I chose **LGPL-2.1**. Reasons: the owner's conditions (source available, replaceable, notices) are what the LGPL asks for anyway, so one set of measures satisfies it; people recognise the LGPL; and CDDL-1.0 has a venue clause (section on governing law names the jurisdiction in a notice) that adds a legal question for no gain. CDDL is the lighter alternative if a lawyer prefers it (file-level copyleft, no relinking idea); switching only means changing the licence text we ship and the wording.

**Each condition and where it is met**

| Condition | How |
|---|---|
| Separate file, own directory, never bundled or linked into our code | `assets/vendor/raw-decoder/raw-decoder.wasm` plus its loader and a small bridge Worker. `assets/js/raw/raw.js` never imports it; it only sends messages to the bridge Worker. |
| Loaded only when a camera RAW file is opened; in a Worker | `LE.raw.probe` identifies the format with our own code. Only `decoder: 'camera'` files cause the download. Test `camera module: downloaded on demand...` asserts no request for it happens before, exactly one after. |
| Replaceable | A documented, stable message interface (`assets/vendor/raw-decoder/README.md`: `init`, `identify`, `preview`, `decode`, with the output format and `meta` fields). Swap steps are written there, including `window.LE_RAW_DECODER_BASE` for a downstream host. |
| Cached, listed in the storage manager, through the download policy | Cache Storage `le-models-v1` (the existing one; no new cache), header `x-le-model: raw-camera`; `LEPwa.describeModel('raw-camera', { name: 'Camera RAW support', about: '... LibRaw 0.22.2, LGPL-2.1 licence' })` gives it its plain name with no change to `le-pwa.js`. Fetched after `LE.downloads.request({ id: 'raw.camera', name: 'Camera RAW support', bytes, kind: 'feature', reason })` (feature-detected; without `LE.downloads` it just downloads, it is 0.73 MB) with `LE.downloads.track` for the progress chip. |
| Licence shown | First use only: one calm line, not a dialog: "Camera RAW support uses LibRaw, under the LGPL 2.1 licence. Licence  Source" (links to `licenses/#libraw` and the LibRaw 0.22.2 source), also fired as the cancellable event `le-raw:licence` so the studio can show it in its own toast. Permanently: the storage manager entry's description, `probe()` result (`module.licence`, `licenceUrl`, `sourceUrl`), and the new page `/licenses/` ("Open-source licences"), generated from `assets/vendor/LICENSES.md` by `tools/licenses-page/build.js`, with the RAW decoder in its own marked section (`#libraw`) holding the written source offer. |
| Compliance material in the repository | `assets/vendor/licenses/libraw-LICENSE.LGPL.txt`, `libraw-LICENSE.CDDL.txt`, `libraw-COPYRIGHT.txt`, `emscripten-runtime-LICENSES.txt` (Emscripten MIT/NCSA, musl MIT, libc++ Apache-2.0 with LLVM exception, which are linked into the wasm); `tools/raw-decoder/sources.json` (103 files of tag 0.22.2, each with its SHA-256), `fetch-source.js`, `build.sh`, `glue.cpp`; no patches. |
| Own section in `LICENSES.md`, marked as the exception | Done (three rows: LibRaw, the Emscripten runtime, our glue and bridge). |
| Out of the precache | See "For the architect" below. |

**What I could and could not verify.** The module follows LibRaw 0.22.2 exactly (every file hash matches the tag). I could not download the official release tarball (HTTP 403 from the sandbox); I compared the per-file hashes with the tag instead (105 of 105 identical against an npm package that vendors the release). The GPL demosaic packs (`LibRaw-demosaic-pack-GPL2/3`) are not in `sources.json`, so they cannot be built in. Demosaic methods that remain, all inside LibRaw: linear, VNG, PPG, AHD, DCB, DHT, AAHD and Markesteijn for X-Trans.

**Engineering reading, not legal advice.** The above is my reading of what the LGPL 2.1 asks of a separately distributed, unmodified library that the editor reaches only through a message interface: give the licence text, the copyright notices and a written source offer, make the exact source and build recipe available, and let people replace the library. One legal read of the presentation before launch (the first-use line, the `/licenses/` page, the source offer, the replaceability description and the contact address for source requests, which the owner still has to supply: it is a placeholder in `licenses/index.html` and in the module README) is advisable.

**Options for the future (permissive-only).** If the owner wants to drop the exception later: FlashRaw (MIT or Apache-2.0) covers about as many formats, runs in WebAssembly and has a WebGPU build, but version 0.2.0 appeared the day before this spike (11 November 2026; I did not check when 0.1.0 appeared), it has one author, and the provenance of its colour database is unclear (see table). A reasonable plan is to keep LibRaw now and re-evaluate FlashRaw in about six months, behind the same message interface so the swap is a directory change. "Convert to DNG first" with the free Adobe DNG Converter is a user-side workaround worth mentioning in the unsupported-file message; we do not bundle it.

### A3. What the permissive path covers

Our reader accepts any DNG that is Bayer 2x2 with 3 colours or linear 3-sample, in the compressions above. In practice that is: Android phones that save DNG (Pixel, Samsung and others; **I did not test any**), iPhone ProRAW (a linear DNG; unverified, and recent iOS versions may use JPEG XL, which is not supported), DJI drones, Leica, Pentax and Ricoh, Sigma fp, Hasselblad, and any camera file converted with the Adobe DNG Converter (lossless option). It cannot do: JPEG XL and lossy-JPEG DNG, DNG from X-Trans or four-colour sensors (the probe says the camera module can), non-DNG camera files (preview only). Those cases are reported by `probe()` with a plain `why` and `decoder: 'camera'`.

### A4. The camera module: what worked

Toolchain: Emscripten 7.0.0 (release `6afbd834...`, 322 MB tarball from the official bucket; works from the sandbox). wasi-sdk 25 does **not** work because its libc++ has no exception support and LibRaw throws. `tools/raw-decoder/build.sh` is one command: downloads the toolchain, fetches and hash-checks LibRaw, compiles with `-O2 -fwasm-exceptions` (about 4 minutes on 3 jobs), links with growable memory (2 GB cap, no filesystem). Wasm exceptions are supported by current Chrome, Firefox and Safari. LibRaw's own placeholder files (`*_ph.cpp`) are excluded. Our glue exposes about 20 C functions; the bridge Worker turns them into the message interface and returns camera-native linear RGB plus a DNG-style `meta` so one colour code serves both decoders.

| Module item | Size |
|---|---|
| `raw-decoder.wasm` | 719,595 bytes; gzip 289,495; brotli 239,144 |
| `raw-decoder.js` (loader) | 13,573 (4,484 gzip) |
| `raw-decoder-worker.js` (bridge) | 8,355 |
| Start-up (instantiate the wasm) | about 40 ms wall, 6 ms CPU (Node) |

### A5. Which files were real

| Format | Real file? | Result |
|---|---|---|
| NEF (Nikon D700 14-bit, 12.1 MP; D80 12-bit, 10.2 MP) | **Yes**, public domain (immich-app/test-assets) | Decoded in Node and in Chromium through the real Worker and cache path; correct picture, sensible as-shot white balance (D700 4,550 K, D80 5,200 K); embedded 12 MP preview extracted. Sheet: `docs/research/raw-hdr/sheet-real-nef.png` |
| RW2 (Panasonic LX3), RAF (Fujifilm S5 Pro), CR2 (Canon), DNG (Canon 350D) | Tiny ExifTool test fixtures with the pixel data cut off | RW2, RAF and Canon DNG: metadata read correctly (camera names, sizes, white balance, colour matrices); the truncated RAF and DNG fail with a plain message and no console error; the LX3 file decodes to garbage without crashing; the CR2 fixture is too small for LibRaw to recognise it. **These are not format tests** |
| CR3, ARW, ORF, PEF, SRW, RAF X-Trans (real file) | **No** | Untested. `raw.pixls.us` (the CC0 archive of about 2,000 camera files) is not reachable from the sandbox; **someone with normal internet should run `node scripts/fetch-raw-samples.js` and then these formats** before launch |
| DNG | **No real file** | Everything is synthetic |
| All other results | Synthetic: `tools/dng-synth` builds valid DNGs from a known image through a made-up camera | Exact truth, so errors are measurable |

`scripts/fetch-raw-samples.js` downloads the two Nikon files (25 MB) into the git-ignored `labs/raw/samples/` (the ExifTool fixtures only with `--all`; their licence is Perl Artistic or GPL, test-only). Committed sample data: none; the repository addition is about 3.5 MB including the wasm and the sheets.

### A6. Measurements

**Built-in path, synthetic DNG, one fresh Node process per case** (the same code runs in the Worker). CPU = `process.cpuUsage`, close to idle desktop time for one core; peak = `maxRSS` of that process.

| File (lossless JPEG, 14-bit, synthetic) | Output | CPU time | Peak memory |
|---|---|---|---|
| 12 MP, half size, f16 | 2000 x 1500 | 0.87 s | 126 MB |
| 12 MP, full, f16 | 4000 x 3000 | 1.27 s | 184 MB |
| 12 MP, full, f32 | 4000 x 3000 | 1.03 s | 252 MB |
| 24 MP, half size, f16 | 3000 x 2000 | 1.51 s | 195 MB |
| 24 MP, full, f16 | 6000 x 4000 | 2.23 s | 309 MB |
| 24 MP, full, f32 | 6000 x 4000 | 1.84 s | 446 MB |
| 48 MP, half size, f16 | 4000 x 3000 | 2.89 s | 335 MB |
| 48 MP, full, f16 | 8000 x 6000 | 4.25 s | 541 MB |

CPU time includes reading, unpacking (lossless JPEG) and demosaicing (edge-directed). f32 output is 12 bytes a pixel (48 MP would be 576 MB for the output alone, so it is not offered above 24 MP); f16 is 6 bytes a pixel and is what an RGBA16F texture takes. Memory stays flat because demosaicing runs in bands of 96 rows. **JavaScript against WebAssembly for the same job:** the built-in JS path (1.0 to 1.3 s for 12 MP full) is on par with LibRaw's wasm PPG (0.7 s) and faster than its AHD (1.5 s), so a hand-written WebAssembly demosaic is not needed; the unpack is the part a rewrite would speed up.

**Chromium, through the real Worker (`LE.raw.decode`)**, wall clock on the shared machine: 12 MP f32 full size 2.1 s at a quiet moment (3 to 9 s under load), 24 MP f16 full 10 s, 48 MP f16 full 25 s. Half size saves the demosaic, not the lossless-JPEG unpack, which is the slowest stage of the built-in path (about 0.7 s per 12 MP on a quiet core). Without a Worker the main thread blocks for the whole time; that is why decoding is always in a Worker.

**Camera module (LibRaw wasm), real Nikon D700 NEF, 12 MP**, CPU time and wasm heap:

| Case | CPU time | Wasm heap |
|---|---|---|
| Half size, AHD | 0.61 s | 94 MB |
| Half size, linear | 0.45 s | 94 MB |
| Full, linear (quality 0) | 0.99 s | 205 MB |
| Full, PPG (2) | 0.72 s | 205 MB |
| **Full, AHD (3, default)** | **1.50 s** | 205 MB |
| Full, DHT (11) | 2.92 s | 330 MB |
| Same synthetic 12 MP DNG through LibRaw, AHD | 1.44 s | 205 MB |

JS-side copy of the result to f32 adds about 0.2 s and 144 MB at 12 MP; process peak 418 MB for the whole run including the DHT case. Heap sizes are the wasm memory after the case (it only grows).

Wall-clock figures taken earlier while the machine was heavily loaded (load average about 48) were three to eight times higher and ranked the paths wrongly (they suggested LibRaw AHD was much slower than our JS); the CPU-time figures above are the fair comparison. I did not write a WebAssembly version of our own code: the JS path is already level with LibRaw's PPG, and the GPU path of X5 makes both moot for display.

**Half-size preview.** Our half-size path bins 2 by 2 (no interpolation): 12 MP file to 6 MP in about 0.9 s of CPU time; the embedded JPEG preview comes back from `probe()` in 75 ms to 1 s depending on file size (it has to read the file), so the first picture is nearly instant.

**Phones (estimates, not measured).** A mid-range phone core is about 3 to 5 times slower than this desktop core when idle, and has 3 to 6 GB of memory shared with the browser. Estimate for the built-in path: 12 MP full 4 to 6 s, 24 MP full 7 to 11 s (peak 310 to 450 MB), 48 MP full 13 to 21 s with a peak of 540 MB plus the page, which is risky; use half size (335 MB, 9 to 15 s) and refine on export. LibRaw module: 12 MP full AHD 5 to 8 s, half size 2 to 3 s; its wasm heap needs 205 MB (12 MP) to 420 MB, so cap it at about 24 MP on phones.

### A7. Quality findings

**Demosaic** (synthetic natural scene 512 x 384, truth is the scene before mosaicing, PSNR in linear light of the whole pipeline):

| Blur of the scene | Malvar-He-Cutler (MHC) | Edge-directed (Hamilton-Adams style, ours) |
|---|---|---|
| sigma 0.5 px | 30.56 dB | **31.79 dB** |
| 0.8 | 35.50 | **35.85** |
| 1.2 | 38.46 | **39.41** |
| Zone plate, 0.8 | 20.58 | **22.18** |
| Zone plate, 1.2 | 26.08 | **28.64** |

Both are written from the papers (nothing from GPL or LGPL code). Edge-directed is the default; MHC is the faster fallback (about 1.2 s against 2.4 s per 12 MP on a loaded machine). Known weakness, visible in `sheet-demosaic.png`: one-pixel dark lines show coloured dots (MHC) or colour fringes (edge-directed); AMaZE-class methods are better and are GPL, so they are out. LibRaw's DHT and AAHD are alternatives inside the module.

**Colour.** ColorChecker-like chart (24 published sRGB patch values, 480 x 320): mean dE76 **0.28**, max 0.43, with ForwardMatrix and with ColorMatrix only (the Bradford path). As-shot temperature estimate of the synthetic D65 scene: 6,504 K (tint +16 in our Duv convention, which is where D65 sits relative to the Planckian locus). White balance by temperature and tint moves the right way (5,000 K assumed makes a daylight white bluer). Colour matrices interpolate between the two calibration illuminants by inverse temperature as the DNG specification says. Camera calibration and analog balance are applied as specified; **real-file checks against Adobe or LibRaw output were not possible**.

**Every storage variant decodes to the same picture** (identical PSNR 31.79 dB): packed 10, 12 and 14 bit, 16-bit either endian, lossless JPEG with predictors 1 to 7 and 1, 2 or 4 interleaved components, strips and tiles, deflate with and without predictor, black-level patterns, all four Bayer orders, raw in IFD0 or a SubIFD. GainMap opcode (vignette, strengths 0.3 and 0.6): PSNR rises from 25.5 and 20.0 dB to 33.6 dB when applied (list 1 and 2 gain maps and radial vignette fixes are applied; other opcodes, including WarpRectilinear in list 3, are skipped and reported in `meta.opcodes.skipped`). Linear DNG, 16-bit lossless JPEG and 32-bit float with deflate: 42.75 dB (quantisation only). The map-origin convention (normalised over the active area) follows my reading of the specification and **needs checking with a real ProRAW or Pixel file**.

**Highlight reconstruction** (our method: colour propagation, see `raw-develop.js`). Synthetic scene, overexposed so a channel clips; error measured on the pixels where a camera channel is clipped:

| Overexposure | Method | Chroma error (xy) | Luminance error |
|---|---|---|---|
| x1.6 (33,588 px clipped: 19,182 one channel, 13,792 two, 614 three) | leave clipped (pink cast) | 0.031 | 0.30 EV |
| | clip to white | 0.038 | 0.29 EV |
| | **colour propagation** | 0.036 | **0.16 EV** |
| x2.6 (124,633 px clipped) | leave clipped | 0.045 | 0.39 EV |
| | clip to white | 0.071 | 0.43 EV |
| | **colour propagation** | **0.040** | **0.26 EV** |

Honestly: it recovers brightness well, and it recovers colour only when much is clipped. At mild clipping the plain "leave it" has the lower chroma error but leaves a visible cast. On the real D80 file the bright sky comes out lilac where the sensor clipped (`sheet-real-nef.png`), and on the synthetic scene the clouds come back pale blue (closer than clip-to-white's grey) but the cream sun fades to lilac-white and a mint band appears along the horizon (`sheet-highlights.png`). Established editors (segmentation and opposed-inpainting methods in darktable, Lightroom's recovery) are clearly better on skies and white clouds; this method is a sound first version, not parity. What would close the gap: a segmented fill that takes the colour of the whole clipped region's boundary rather than a block average, and a fade to neutral tied to how deep a pixel sits in the clip; both are small additions.

**Shadows and noise.** Lifting shadows multiplies the noise along with the signal. On a synthetic chart with ISO 1600-class noise, after a lift of about 2 EV in the darkest tones the darkest patch showed noise of 3.3 steps of 255 (mid-grey 2.0 steps), which is clearly visible. Denoising before the lift pays back: wavelet (generalised Anscombe variance stabilisation, soft-threshold a-trous B3 wavelet, algebraic inverse; measured with a stronger threshold than the final code) brought the dark patch to 0.7 steps and bilateral to 1.9. On textured natural content strong wavelet settings over-smooth at low ISO; the useful range of `strength` is 0.3 to 0.75:

| Noise (synthetic, natural scene) | Noisy | Wavelet 0.3 / 0.5 / 0.75 / 1 | Bilateral sigma 0.01 / 0.02 / 0.04 |
|---|---|---|---|
| Low (ISO 200 class) | 37.80 dB | 39.17 / 39.11 / 38.19 / 36.94 | 39.90 / **40.84** / 40.60 |
| Medium (ISO 1600 class) | 30.01 | 32.09 / **32.71** / 32.48 / 31.63 | 32.34 / 33.44 / **35.04** |
| High (ISO 6400 class) | 23.93 | 26.54 / 27.79 / **28.38** / 28.06 | 25.79 / 26.68 / 28.01 |

(PSNR against the noise-free image, in raw-linear units.) The bilateral filter wins at low and medium noise, the wavelet at high noise and where the noise level is known (it uses the DNG `NoiseProfile` when present). Neither is close to the best commercial denoisers; both are an honest, fast baseline.

Speed: roughly 0.8 s per megapixel for wavelet and 0.7 s per MP for bilateral in plain JavaScript (loaded machine; upper bound), so both belong on the GPU (X5) or on tiles in a Worker. Unsharp mask (edge-gated luminance): 0.3 s per MP.

**Chromatic aberration.** Estimating lateral CA from the picture alone (edge-map correlation of red and blue against green, coarse and fine scan): on a synthetic image with 0.4 % magnification error in red and blue it recovered both within 0.15 % (the test asserts this); with 0.2 % and 0.16 % (sub-pixel at the edges) it found 0.16 % and 0.10 %, the right sign and about two thirds of the size, so the fix is partial. Cost about 3.6 s for 640 x 480 under load (36 trials); run it on a 1 MP copy. A lens **profile database** would do better, but the lensfun database is LGPL for code and CC-BY-SA for the data (outside our rule; its data is attribution plus share-alike, a bigger question than the code), so I did not include it. Phones are different: their DNG files carry the correction as opcodes (gain maps are applied; `WarpRectilinear` is parsed and reported but **not applied yet**, the largest missing opcode for phones).

### A8. Camera profiles: what we can honestly offer

Adobe's DCP profiles and the vendors' picture styles (Camera Standard, Vivid, Picture Control, Film Simulation and so on) are proprietary; we neither have the data nor the right to copy it. What we can do honestly:

1. **The DNG's own colour**: ColorMatrix, ForwardMatrix and calibration illuminants, the camera maker's measured data for that body. This is what "Camera matching" means for DNG, and it is what the decode uses.
2. **Embedded profile data in the DNG** (`ProfileHueSatMap`, `ProfileToneCurve`, look tables): flagged in `meta.hasHueSatMap`, `meta.profileName`; **not applied yet**. Applying them (a 3D table in hue, saturation, value) is a bounded task for X5 and makes ProRAW and Adobe-converted files look as their makers intend.
3. **Our own base looks**, in `raw-develop.js` (`LOOKS`): Neutral, Standard, Vivid, Portrait (skin-tone saturation protection), Landscape (cooler, stronger contrast), Monochrome. Each is a tone curve plus saturation plus a small colour tweak, fully described by parameters, so an agent can write and check them. They are ours, not imitations.
4. For cameras whose files have no matrix (all non-DNG bodies), the camera module's table (LibRaw's) supplies one: good enough for standard colour, not equal to Adobe's.

## B. HDR merge

`labs/hdr/hdr.js` (35 KB, our code from public papers). API: `LE.hdr.merge(frames, { mode: 'fusion' | 'radiance', align, deghost, reference, maxPixels, signal, onProgress })` returns a Promise of `{ width, height, data: Float32Array linear RGB, meta }`; it runs in a Worker (`hdr-worker.js`) and cancels with an AbortSignal. `LEHdr.merge` is the same call without a Worker. Frames are `{ width, height, data: Uint8ClampedArray RGBA (JPEG or PNG, sRGB) | Float32Array RGB (linear, for example a decoded DNG), ev?, exposureTime?, iso?, fNumber? }`. 2 to 7 frames.

- **Alignment** (Ward's median threshold bitmaps, hierarchical, with a rotation search of plus or minus 3 degrees at about 320 px). Works across exposures because the bitmaps ignore brightness. Measured (512 x 384, reference 0 EV, moving frame +2 EV with noise, a 10-stop scene): shifts of 6, 20, 40, 60 px, and rotations of 1, 2 and 2.5 degrees, and combinations (12 px with 1.5 degrees, 30 px with minus 2 degrees): corner error 0.0 px (integer shifts on the 0.25 degree grid). Non-grid cases: 7.5 px with 0.9 degrees: 1.6 px; 13.7 px with minus 1.7 degrees: 0.8 px. **Fails beyond 3 degrees** (4 degrees: 7 px); shifts were tested up to 60 px (12 % of the width); the alignment runs on a copy of at most 1024 px and scales the result, so at 12 MP the residual is up to about 2 px. Subpixel refinement and perspective are not done.
- **Radiance merge**: weights favour well-exposed pixels and longer exposures; uses exposure from metadata (`ev`, or time, ISO and aperture) or **estimates it from the pictures** (median ratio of well-exposed pixels), which on the synthetic set found -1.999, 0, 2.000 for the true -2, 0, +2. Output is scene-referred linear, reference frame = 1.0, highlights above 1. **Error on a 10-stop synthetic scene** (median of |log2 error| where any frame is usable): single frame 0.013 EV but its 95th percentile is 0.71 EV (clipped and noisy areas); two frames 0.010 / 0.71; **three frames 0.008 / 0.02; five frames 0.007 / 0.02**.
- **From DNG frames.** Three synthetic raw exposures (-2, 0, +2 EV, with sensor noise) decoded by the built-in reader and merged as linear float frames: median error 0.031 EV, 95th percentile 0.63 EV (the weak tail is because the clip test runs on white-balanced sRGB values rather than raw-normalised ones; in X5 merge in camera space before the matrix and use the raw clip level, which also lets the highlight stage run once on the merged result). Exposures were taken from the `ev` field.
- **Exposure fusion** (Mertens, Laplacian pyramids, no exposure data needed): with three frames the share of clipped pixels fell from 14.1 % (middle frame alone) to 0.25 %; black pixels stay at 0. Pleasing by default, but it is a finished picture (display range), not a radiance map, so the develop controls have less to work with.
- **Deghosting** (reference-frame consistency using a brightness transfer function built by histogram matching, so it needs no exposure data; computed at no more than about 2 MP and enlarged): with a bright ball in a different place in each frame, mean error in the places where the ball was in the other frames: radiance **0.897 EV without, 0.017 EV with**; fusion 0.094 without, 0.025 with (display units). The moving subject itself is taken from the reference frame alone and shows its 8-bit noise (`sheet-hdr.png`, last row). Where the reference is clipped or black the test cannot judge, so ghosts remain there.
- **Local tone map** (guided filter on log luminance; global and plain-blur versions for comparison): halo at a 10-stop step edge, as the largest deviation from the plateau within 30 px: **blurred base 86 % dark side and 44 % bright side; guided filter 5 % and 6 %**; the global operator has no halo but crushes the dark side (0.006) so only the guided one is usable.

**Speed and memory (CPU time, one core; peak of the process)**

| Case | Working size | CPU time | Peak memory |
|---|---|---|---|
| 3 x 12 MP, fusion, align + deghost | 12 MP | 10.3 s | 1.49 GB |
| 3 x 12 MP, radiance, align + deghost | 12 MP | 11.0 s | 1.54 GB |
| 3 x 12 MP, radiance, no align, no deghost | 12 MP | 7.0 s | 1.02 GB |
| 5 x 24 MP, fusion, align + deghost | 4242 x 2828 (12 MP cap) | 19.4 s | 2.28 GB |
| 5 x 24 MP, radiance, full 24 MP | 6000 x 4000 | 29.3 s | **4.52 GB** |
| 5 x 24 MP, radiance, 6 MP cap | 3000 x 2000 | 14.1 s | 1.58 GB |
| 5 x 24 MP, fusion, 6 MP cap | 3000 x 2000 | 14.2 s | 1.52 GB |

(Inputs: 137 MB for three 12 MP frames and 458 MB for five 24 MP frames as 8-bit RGBA, included in the peaks. Stage split for 3 x 12 MP fusion: alignment 4.5 s wall, preparing frames 9.6, deghosting 20.7, merging 45.8 under load, so the pyramid merge is about half.)

Conclusion: in plain JavaScript, three 12 MP frames cost 10 s of CPU and about 1.5 GB at peak, and five 24 MP frames at full size would need 4.5 GB, which no phone (and few laptops) has. The prototype therefore works at a reduced size by default (`maxPixels`, default 8 million pixels; frames are reduced and the result keeps that size, reported in `meta.scale`); on phones use 3 million. At 8 MP the cost is about 8 to 12 s of CPU time and 1 to 1.3 GB for three to five frames, so it is a desktop feature until the GPU port exists. The real implementation belongs on the GPU: both fusion and the radiance merge are per-pixel plus pyramid passes that WebGL2 does in tens of milliseconds, and exactly the same weights (the CPU version is the reference for golden-image tests). Alignment and ghost masks stay on the CPU at 1 to 2 MP, where they are fast.

## C. Build plan for X5

**Data model** (`layer.raw`, extends the architecture document; all optional, absent means as-shot defaults)

```
layer.raw = {
  source:   { asset, format: 'DNG'|'NEF'|..., decoder: 'builtin'|'camera', quality?: 3 },   // original file bytes live in the project asset store; never changed
  wb:       { mode: 'as-shot' | 'custom', temp, tint }          // K and Duv*5000-ish units, see LERawCore.whiteFromTempTint
  exposure: 0,                        // EV, applied in linear light before the highlight stage
  highlights: { mode: 'ratio' | 'clip' | 'none', amount: 0 },   // recovery method, and the tone "highlights" slider (negative compresses)
  shadows: 0, contrast: 0, whites: 0, blacks: 0,
  profile:  { look: 'standard', embedded: true },     // base look id; use the DNG's embedded HueSatMap once implemented
  denoise:  { luma: 0, color: 0 }, sharpen: { amount: 0, radius: 1 },
  lens:     { ca: { r: 0, b: 0 }, vignette: 0, auto: true },      // from opcodes or an estimate
  space:    'srgb' | 'display-p3',
  hdr:      { frames: [asset...], mode, align, deghost }          // when the layer is a merged set
}
```

**Where decode output enters the renderer.** `LE.raw.decode(file, { space: 'camera', format: 'f16' })` returns camera-linear RGB (half-float bits) and `meta.matrix` (camera to the working space, white balance included), `meta.wbGains`, `meta.neutral`, `meta.temp/tint`, `meta.orientation`. Upload as an RGBA16F texture; the first renderer pass for a `raw` layer is: multiply by `wbGains` (from `LE.raw.matrix(meta, wb, space)` whenever the white balance changes; pure maths, no re-decode), highlight stage (ratio method as a shader with the guide built on a 1/8 reduced copy), the 3x3 matrix, then exposure, tone, look, and onward to the normal `fx` stack. Highlight and denoise need camera-space data, so the matrix is **not** baked into the texture.

**Preview strategy.** (1) The moment the file is dropped, `probe()` returns the embedded JPEG (75 ms to 1 s) and the studio shows it. (2) A half-size decode (`halfSize: true`, about 1 to 3 s on a desktop and 9 to 15 s on a phone for large files, estimate) replaces it and is what all slider dragging uses; the half-size texture is 6 to 12 MP. (3) The full decode runs only for export and zoom above 100 %, in tiles on the GPU if the texture limit is smaller than the picture (`LE.support.maxCanvas()`), and is cancelled by an AbortSignal when the person changes the file.

**Memory guards per tier** (use `LE.device.tier()` and `LE.support`):

| Tier | Full-size decode allowed | Otherwise |
|---|---|---|
| desktop | up to 48 MP in f16 (peak about 600 MB in a Worker), 24 MP f32 | half size beyond |
| modern phone / laptop | up to 24 MP f16 (about 310 MB) | half size (about 200 MB) |
| older phone | half size only above 12 MP; no HDR merge above 6 MP; no camera module above 24 MP full | say so, offer to continue |

Always release workers (`LE.raw.release()`) when the person leaves Expert; the wasm heap only grows, so a camera decode that hit 400 MB keeps it until the Worker is terminated.

**First-open experience of a RAW file.** Drop or choose a file in Expert: show the embedded preview at once with "Opening RAW..." and a thin progress line; if the file needs the camera module and it is not cached, one quiet progress chip ("Camera RAW support, 0.7 MB") and the licence line once; when the half-size decode arrives, cross-fade, open the develop panel with as-shot values (temperature in kelvin, tint, exposure 0, look Standard), histogram and clipping warnings. If the file is unsupported: the plain `why`, and (for camera formats that the module cannot read) the Adobe DNG Converter suggestion. Never block; "Try anyway" via `LE.support.gate('raw.camera')` for low-memory phones.

**`LE.support` definitions** (already declared by `raw.js` into `LE_SUPPORT_DEFS`):

```
{ id: 'raw.dng',     name: 'Open phone and DNG RAW photos',  group: 'Photo studio', needs: ['worker'],               memoryMB: 450,  degraded: 'Opens a half-size version instead.' }
{ id: 'raw.develop', name: 'Develop RAW photos',             group: 'Photo studio', needs: ['webgl2', 'worker'], wants: ['canvas-max-area'], memoryMB: 900 }
{ id: 'raw.camera',  name: 'Camera RAW support (...)',       group: 'Photo studio', needs: ['wasm', 'worker'], wants: ['cache-storage'], memoryMB: 700, downloadMB: 0.8, degraded: 'Opens the half-size version instead.' }
{ id: 'hdr.merge',   name: 'Merge bracketed photos to HDR',  group: 'Photo studio', needs: ['worker'], wants: ['canvas-max-area'],     memoryMB: 1500, degraded: 'Merges at a smaller size.' }
```

Memory by megapixels (peak per process, measured): see the table in A6; the `memoryMB` above is for 24 MP at full size. **Proposed API, both paths behind one call:**

```
LE.raw.probe(file)  -> { format, supported, decoder: 'builtin'|'camera'|'none', needsDownload, why, preview: { blob, url, width, height, orientation }|null, meta, module? }
LE.raw.decode(file, { halfSize, signal, onProgress, space: 'camera'|'srgb'|'display-p3', format: 'f32'|'f16'|'u16', wb, quality, method, decoder })
                    -> { width, height, data: Float32Array|Uint16Array, space, format, meta }
LE.raw.matrix(meta, wb, space)   // camera -> working space 3x3 and white-balance gains for a given temperature and tint (after LE.raw.ready())
LE.raw.camera.{ isCached, load, unload, remove, licenceNotice, info }, LE.raw.release()
LE.hdr.merge(frames, { mode, align, deghost, signal, onProgress }) -> { width, height, data: Float32Array, meta }
```

**Build order inside X5.** (1) `layer.raw` document model, validation and agent operations (`raw.set`, `raw.wb`, `analyze`: clipping percentage, estimated white balance, noise estimate from `meta.noiseProfile`). (2) GPU passes: wb, highlight recovery, matrix, tone, looks (the CPU reference in `raw-develop.js` provides golden images). (3) Opcodes: `WarpRectilinear`, embedded profile tables. (4) HDR on the GPU (fusion first, then radiance) with CPU alignment and ghost masks. (5) Denoise and CA on the GPU. (6) Tests: reuse the DNG synthesiser for golden images; add real files when someone can fetch them.

## Risks

1. **No real phone DNG was tested.** The reader follows the specification and is exact on synthetic files of every storage variant; real files will have surprises (opcode conventions, profile tags, vendor quirks). First thing to do in X5: run Pixel, Samsung, iPhone ProRAW and Adobe-converted files.
2. **Seven of nine camera formats are untested on real files** (A5). LibRaw is mature, but our glue and the output handling are new.
3. **JPEG XL DNG** (newer Samsung and possibly iPhone ProRAW files) is unsupported in both paths until libjxl or `jxl-oxide` is added; the user gets the Adobe DNG Converter hint.
4. **Memory on phones.** Peaks above are for the Worker only; the page, the GPU copy and the history add to them. Camera RAW at full size can exceed a phone's limit; the tier table and half-size default are the guard.
5. **Licence**: engineering reading only; one legal review of the presentation before launch; the source-request contact address is a placeholder.
6. **JavaScript speed** of unpack and HDR. The unpack could be made 2 to 3 times faster (a table-driven Huffman, fewer bounds checks); HDR needs the GPU.
7. **Highlight recovery** is visibly behind the established editors on skies.
8. **FlashRaw** is promising and brand new; do not depend on it yet.
9. **Wasm exceptions** (`-fwasm-exceptions`) need Chrome 95, Firefox 100 or Safari 15.2 and later; older browsers get `LE.support` "unsupported" for `raw.camera` (they can still open DNG).

## For the architect

- **Precache.** `scripts/build.js` `ON_DEMAND` must also exclude `^assets/vendor/raw-decoder/` and `^assets/js/raw/` (as it does `assets/vendor/ort` and `assets/vendor/tesseract/`). Today they would be precached. `assets/vendor/licenses/*` may stay in the precache (the largest, `emscripten-runtime-LICENSES.txt`, is 63 KB).
- **Service worker.** Serve `/assets/vendor/raw-decoder/*` from the same runtime handling as `assets/vendor/ort` (models cache, never precached).
- **Generated lists.** `licenses/index.html` is new: add `/licenses/` to the sitemap, the footer or About links ("Open-source licences"), and to `PAGES` if the build requires a page entry. It is generated by `node tools/licenses-page/build.js` from `assets/vendor/LICENSES.md`; re-run it when that file changes. The studio should listen for the `le-raw:licence` event to show the first-use line in its own toast style (a fallback line is built in).
- **Storage manager.** Needs no code change: `raw.js` registers the entry through `LEPwa.describeModel`.
- **Contact address** for the LGPL source offer: owner to supply (placeholder in `licenses/index.html`, `assets/vendor/raw-decoder/README.md`, `tools/licenses-page/build.js`).

## Files

| Path | What |
|---|---|
| `assets/js/raw/raw-core.js`, `raw-worker.js`, `raw.js`, `raw-develop.js` | Built-in reader, Worker, public API, develop reference |
| `assets/vendor/raw-decoder/` | Camera module (wasm, loader, bridge, README with the interface and the source offer) |
| `assets/vendor/licenses/libraw-*`, `emscripten-runtime-LICENSES.txt`; `assets/vendor/LICENSES.md` | Licence texts and rows |
| `tools/raw-decoder/` | Build recipe: `build.sh`, `fetch-source.js`, `sources.json`, `glue.cpp` |
| `tools/dng-synth/dng-synth.js` | DNG writer and scene generator (Node and browser) |
| `tools/licenses-page/build.js`, `licenses/index.html` | Licences page |
| `labs/raw/`, `labs/hdr/` | Prototypes; `labs/hdr/hdr.js` is the HDR code |
| `scripts/fetch-raw-samples.js` | Fetches real sample files (git-ignored) |
| `tests/raw.test.js`, `tests/hdr.test.js` | 9 and 4 cases, about 35 s and 25 s |
| `docs/research/raw-hdr/*.png` | Comparison sheets |
