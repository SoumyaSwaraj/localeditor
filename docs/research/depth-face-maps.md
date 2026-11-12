# Depth, normals and face maps: research spike S2 (expert mode, X4 and X6)

Written 12 November 2026. Prototype: `labs/maps/` (not linked from the site). Test: `tests/maps.test.js`. Everything below was measured in this sandbox unless marked **estimate** or **not measured**.

## Answer

Yes, for a bounded set of jobs. All three kinds of map can come from small permissive models running on the shipped onnxruntime-web WASM, in a worker, with no new runtime, and about **28 MB committed** in total.

- **Depth: ship Depth Anything V2 Small** (Apache-2.0 code and weights). Commit a 15.7 MB 4-bit/8-bit mix as the one "Depth map" option; a 25.7 MB 8-bit file is the optional finer download (S3 only, over the 25 MB file limit). Single-thread cost is about 0.7 s of CPU at 266 px, 1.4 s at 392 px and 2.8 s at 518 px, plus about 280 MB of memory. It is far better than the other model I could run (MiDaS small), and 4-bit, 8-bit and float32 look the same at preview size. Good for background blur, haze, depth-range masks, ambient occlusion and a soft key, rim or fill light. **Not good enough for a studio-grade relight**, for hair-level blur edges, or for thin structures (details below).
- **Normals: derive them from the depth, no second download.** Every permissive dedicated estimator is a 2 to 6 GB diffusion model, and the small ones (DSINE, Omnidata) are non-commercial. A quantised depth model makes noisy normals in flat regions (measured: 20 to 40 degrees of scatter on a flat wall against 2 to 3 degrees for the float32 model), so the runtime smooths and caps the slope by default.
- **Faces: ship Google's MediaPipe Face Landmarker, run through ORT, not the MediaPipe WASM.** The three ONNX files (detector, 478 landmarks, 52 blendshapes) total 3.78 MB and are numerically identical to Google's own `.tflite` files (max difference 1.7e-4). Our pipeline lands within about 1 % of face width of Google's runtime and finds more faces (a tile scan for small and rotated faces). An optional 8.4 MB multi-class segmenter ("hair and skin detail") tightens the skin mask at the hairline. **Exclude** BiSeNet and SegFormer face parsing (trained on CelebAMask-HQ, research-only), Depth Anything V2 Base and Large (CC-BY-NC), Depth Pro, DSINE, Omnidata, Marigold v1-1 and the diffusion models.
- **What it is not good for**: faces in profile or looking down are missed (8 of 90 in-the-wild test faces, every miss a strong side view); sunglasses plus a hand over the face defeat it; the part masks are polygons, so teeth and under-eye masks are approximations.

Committed: `assets/models/maps/` 27.9 MB in five files (largest 15.7 MB), plus code, lab, test, script and docs under 0.3 MB.

## Candidates and licences

Licence is stated for **code** and **weights** separately, with the file I read it from. "Training-data note" marks permissive weights whose training sets carry their own terms: that is a residual legal risk the owner should accept knowingly (same stance as `docs/research/background-remover.md`). The GitHub API for model repositories was not reachable from this sandbox (the session blocks repos it has not attached), so code licences are cited from the Hugging Face model cards, the npm package metadata and Google's published model cards instead; I say so where it matters.

### Depth

| Model | Code licence | Weights licence | Size (fp32 / fp16 / 8-bit / 4-bit) | Input | Quality (my eyes, section "Quality") | Verdict |
|---|---|---|---|---|---|---|
| **Depth Anything V2 Small** (ViT-S, 24.8 M parameters) | Apache-2.0 | **Apache-2.0**: model card `huggingface.co/depth-anything/Depth-Anything-V2-Small` ("license: apache-2.0") and the ONNX export `onnx-community/depth-anything-v2-small` (same). Training data: 595 K synthetic images plus 62 M+ unlabeled real images with pseudo-labels (card). | 99.1 MB / 49.6 MB (fp16 compute, **not usable on WASM**) / 27.3 MB as published, **25.7 MB ours** / 27.4 MB published 4-bit, **15.7 MB ours** (mixed) | any multiple of 14; 266, 392, 518 tested | Best of everything I could run: hair strands, grass blades and thin poles survive. Soft on far detail and on very flat regions | **Ship.** 4-bit mix as the committed first tier, 8-bit as the "finer" download |
| Depth Anything V2 **Base**, **Large**, **Giant** | Apache-2.0 repo | **CC-BY-NC-4.0**: `Depth-Anything-V2-Base` and `-Large` model cards (and `onnx-community/depth-anything-v2-base`, 102 MB int8). The Giant repository is not publicly downloadable (the Hub answers "Invalid username or password"), so it is out either way. | Base 389 MB fp32 / 102 MB int8 | | not run | **Exclude (non-commercial)** |
| Depth Anything V1 Small / Base / Large | Apache-2.0 | Apache-2.0 (`LiheYoung/depth-anything-*-hf` cards) | Small 99 MB fp32 (`Xenova/depth-anything-small-hf`), 27.5 MB 8-bit | multiple of 14 | not run; V2 Small is the same size and the V2 paper's claim is finer detail | **Skip**: superseded at identical cost |
| Depth Anything 3 Small (`depth-anything/DA3-SMALL`) | Apache-2.0 card | Apache-2.0 card (the Large is CC-BY-NC) | 137 MB (safetensors; no browser-ready export found) | | not run | **Not evaluated**, worth a look when an ONNX export exists; 5x the file of V2 Small |
| MiDaS v2.1 **small** | MIT | MIT (`litert-community/MiDaS-small` card; `isl-org/MiDaS` release `model-small.onnx`, sha256 `2d8c6cb8...`). Training-data note: the MiDaS mixture contains several research-licence depth sets (ReDWeb, 3D movies, MegaDepth among them), so "MIT" covers the file, not the data. | 66.8 MB fp32 | 256 x 256 fixed | **Poor**: blobs the people, loses all thin structure, near-useless on the garden and book photos | **Exclude (quality)** |
| MiDaS 3.0 DPT-hybrid, DPT-large (Intel) | Apache-2.0 | Apache-2.0 (`Intel/dpt-hybrid-midas`, `Intel/dpt-large` cards) | DPT-hybrid 533 MB fp32 / 124 MB uint8 (`Xenova/dpt-hybrid-midas`) | 384 | not run | **Exclude (size, speed)**: 5x to 20x DA2-Small |
| MiDaS 3.1 DPT-SwinV2-Tiny-256 | MIT | MIT (`Intel/dpt-swinv2-tiny-256`) | 164 MB safetensors, no ONNX found | 256 | not run | Not evaluated |
| ZoeDepth | MIT | MIT (`Intel/zoedepth-nyu-kitti`) | 1.37 GB fp32 / 693 MB fp16 ONNX (`Heliosoph/zoedepth-nyu-kitti-onnx`) | 384 x 512 | not run | **Exclude (size)**. Metric depth is not what these effects need |
| Marigold (diffusion) | Apache-2.0 / OpenRAIL++ | `marigold-depth-lcm-v1-0` Apache-2.0; `marigold-depth-v1-1` **CreativeML OpenRAIL++-M** (use restrictions, not on our list) | Stable Diffusion 2 UNet 1.73 GB + VAE 0.17 GB + text encoder 0.68 GB, fp16 | 768 | not run | **Too heavy**: a 1.7 GB UNet run several times per image. Not a browser or phone feature |
| Lotus-D (diffusion) | Apache-2.0 | Apache-2.0 (`jingheya/lotus-depth-d-v1-0`, ONNX fp16 1.8 GB `Jens-Duttke/Lotus-Depth-D-ONNX`) | 1.8 GB | 1024 | not run | **Too heavy** |
| Depth Pro (Apple) | Apple Sample Code licence | **Apple ML Research Model Licence** (`apple/DepthPro-hf`: `license:apple-amlr`; the ONNX repo is tagged `apple-ascl`): research use only | 0.9 B parameters, ONNX with external data | 1536 | not run | **Exclude (licence and size)** |
| Metric3D v2 ViT-small | BSD-2-Clause (`mlboydaisuke/Metric3D-v2-LiteRT` card) | tagged **CC0-1.0** on `onnx-community/metric3d-vit-small`; trained on about 16 M images from many datasets, so the training-data note applies | 150.7 MB fp32 / 75.8 MB fp16 | 616 x 1064 canonical | not run | **Not evaluated**: metric scale is not needed, 3.4x the tokens of DA2-S at 518, 6x the file |

### Surface normals

| Option | Licence | Size | Verdict |
|---|---|---|---|
| **Derived from the depth map** (ours, `LE.maps.normals`) | ours | 0 MB, about 10 ms per 0.2 MP in JS | **Ship.** Always available, same data as the depth |
| DSINE | Imperial College "Software Licence Agreement": non-commercial, internal or academic use only (`dylanebert/DSINE` `LICENSE.md`, lines 33 to 44) | 291 MB `.pt` | **Exclude (licence)** |
| Omnidata (DPT-hybrid normal) | HF mirrors tagged `cc-by-nc-4.0` (`sashasax/omnidata_normal_dpt_hybrid_384`) | about 500 MB | **Exclude (licence)** |
| StableNormal / YOSO | Apache-2.0 (`Stable-X/yoso-normal-v1-8-1`) | UNet 1.73 GB + ControlNet 0.73 GB + VAE 0.17 GB fp16 | **Exclude (size)** |
| Lotus-normal | Apache-2.0 | UNet 3.47 GB | **Exclude (size)** |

**Is a dedicated normals model worth a second download? No.** Every dedicated estimator that is permissively licensed is a diffusion model of 2 to 6 GB; every small one is non-commercial. And the limit on relighting is not the normals: it is that a 25 M-parameter depth model draws flat and slightly wavy surfaces (section "Quality"). Better normals from the same depth need smoothing and slope capping (built in), not another network.

### Faces

| Model | Code licence | Weights licence | Size | Time (1 core CPU time) | Quality | Verdict |
|---|---|---|---|---|---|---|
| **MediaPipe BlazeFace short-range** (detector, 128 px) | Apache-2.0 | **Apache-2.0**: Google model card "MediaPipe BlazeFace Model Card (Short Range)", "LICENSED UNDER Apache License, Version 2.0", `storage.googleapis.com/mediapipe-assets/`. File `blaze_face_short_range.tflite` is byte-identical to the one inside `face_landmarker.task` (sha256 `b4578f35...`). | 0.23 MB | about 5 ms per 128 px pass; the 27-window tile scan about 0.1 s | Finds faces larger than about 12 px at 128 px input; we scan tiles for small ones | **Ship** |
| **MediaPipe Face Landmarker v2** (478 points, 256 px crop) | Apache-2.0 (`@mediapipe/tasks-vision` 1.2.3, `package.json` and npm "license") | **Apache-2.0**: Google "Model Card MediaPipe Face Mesh V2", "LICENSED UNDER Apache License, Version 2.0", with a stated fairness evaluation across 17 geographic subregions and Fitzpatrick skin tones 1 to 6 | 2.56 MB (float16 weights, as Google ships them) | about 0.05 s per pass (0.1 s per face with the second pass) | Excellent on frontal and three-quarter faces, see "Quality" | **Ship** |
| **MediaPipe Face Blendshapes v2** (52 coefficients) | Apache-2.0 | **Apache-2.0**: Google "Model Card Blendshape V2", same line; fairness evaluation on 511 samples by gender and Monk skin tone | 0.99 MB | negligible | Plausible (laughing faces read as smiles), optional | **Ship** (optional file) |
| MediaPipe multi-class selfie segmenter (6 classes: background, hair, body skin, face skin, clothes, other; 256 px) | Apache-2.0 | **Apache-2.0 per the MediaPipe solution listing and the converted-model card (`senty-au/selfie_multiclass_256x256-ONNX`, "license: apache-2.0")**. Google publishes no model-card PDF for this file at the bucket I could reach (the older binary "Selfie Segmentation" card exists and is Apache-2.0), so this one licence statement is second-hand. | 16.4 MB float32 file, **8.36 MB** with float16 weights | about 0.3 s per face (the segmenter is most of the 0.45 s per face) | Useful for hair at the hairline; see "Quality" | **Ship as an optional add-on** |
| BiSeNet face parsing (many ports) | MIT (`litert-community/BiSeNet-Face-Parsing-LiteRT`, `zllrunning/face-parsing.PyTorch`) | "MIT" on the port, **but trained on CelebAMask-HQ**, a research dataset whose own terms allow non-commercial research only (stated by the dataset authors; their page was not reachable from this sandbox, so this is from memory and unverified here). The port card itself lists the `celebamask-hq` dataset. | 52.6 MB tflite | | not run | **Exclude (training-data licence)** |
| SegFormer face parsing (`jonathandinu/face-parsing`, `Xenova/face-parsing`) | no licence tag | fine-tuned on CelebAMask-HQ (card `datasets: celebamaskhq`) | 340 MB fp32 / 89 MB 8-bit | | not run | **Exclude (no licence, same dataset, size)** |
| Third-party ONNX ports of the MediaPipe files (`t9749/mediapipe-face-landmarker-onnx`, `senty-au/selfie_multiclass_256x256-ONNX`) | Apache-2.0 | Google's weights, converted with tf2onnx | 7.2 MB and 16.5 MB (float32) | | **Verified genuine** against Google's `.tflite` (below) | Used as the source for our float16 files |

**Can the Face Landmarker run without the MediaPipe WASM runtime? Yes.** `labs/maps/tools/verify_face.py` runs Google's own `.tflite` files (from `face_landmarker.task`, sha256 `64184e22...`) and the third-party ONNX files on the same inputs: detector outputs differ by at most 9e-5 (values up to 279), landmarks (1434 numbers in a 256-pixel crop) by at most 1.7e-4, the face-presence logit by 1.9e-6, blendshapes by 1.5e-6, the selfie segmenter by 3.2e-5 with 100 % identical arg-max. They are the same networks. We re-save them with float16 weights (identical to Google's `.tflite` storage) so they are 3.78 MB for the three face files instead of 7.2 MB. The pipeline around them (anchor decoding, rotated crop, two-pass landmarks, tiles for small faces) is about 250 lines in `labs/maps/maps-worker.js`; I checked it against Google's own runtime (section "Quality").

What the MediaPipe Tasks WASM bundle would cost if we used it instead: `@mediapipe/tasks-vision` 1.2.3 (Apache-2.0, npm `registry.npmjs.org`, reachable; **jsDelivr is not**) is a 156 KB JS bundle plus a **14.7 MB WASM** (4.2 MB gzipped) in two near-identical variants (module and non-module), plus the 3.76 MB `.task`. It is vendorable, but it is a second WASM runtime next to the 11.2 MB ORT one for a job ORT can already do. Not recommended; I used it only to check ours.

### Runtimes

| Runtime | Licence | Notes |
|---|---|---|
| onnxruntime-web 1.22.0 WASM (shipped, `assets/vendor/ort/`) | MIT | Runs all of the above. Single thread: the site is not cross-origin isolated. `MatMulNBits` (4-bit), `MatMulInteger`/`ConvInteger` (8-bit) and plain float all work. No float16 kernels, so models must keep float32 compute (we store weights as float16 and cast at load). |
| onnxruntime-web WebGPU (`assets/vendor/ort-webgpu/`, owned by another engineer; **not on this branch**, git-ignored and fetched by `scripts/fetch-models.js --webgpu`) | MIT | I fetched the same files into the same ignored folder to test, and did not add or duplicate anything. Measured: see "Measurements, WebGPU". |
| MediaPipe Tasks WASM | Apache-2.0 | Not needed (see above). 14.7 MB. |

## Measurements

Rig: headless Chromium (Playwright) on a 4 vCPU Xeon 2.3 GHz **shared with a dozen other engineers' jobs (load average 40 to 65 during every run)**, so wall-clock times are inflated 5 to 15 times and I report **CPU seconds consumed by the whole browser process tree during the call** (read from `/proc`, 10 ms ticks) as the best proxy for a dedicated single core. The page is not cross-origin isolated, so ORT runs one thread, which is the default deployment. Models are served from localhost: add download time yourself (15.7 MB at 10 Mbit/s is 12.6 s). Memory is the whole browser process tree from `ps`, minus an idle page (410 MB), as in the earlier spikes. Script: not committed (it lived in the scratchpad); the numbers are reproducible with `LE.maps.depth` and `LE.maps.face` in the lab.

### Depth, warm run, single thread

| Model | File | Input | CPU time (1 core) | Wall, loaded box | Extra memory (peak) | First call (read, session, warm-up, one run) |
|---|---|---|---|---|---|---|
| 4-bit mix ("Depth map", committed) | 15.7 MB | 266 px (266 x 182) | 0.67 s | 6.0 s | +282 MB | 3.2 s CPU, 20 s wall |
| | | 392 px | 1.44 s | 10.9 s | | |
| | | 518 px | 2.77 s | 20.3 s | | |
| 8-bit ("finer") | 25.7 MB | 266 px | 0.50 s | 3.6 s | +352 MB | 2.7 s CPU |
| | | 392 px | 1.10 s | 6.4 s | | |
| | | 518 px | 2.25 s | 13.3 s | | |
| float32 (reference) | 99 MB | 266 px | 0.63 s | 3.7 s | +726 MB | 2.8 s CPU |
| | | 518 px | 2.66 s | 18.2 s | | |

Quantisation shrinks the file and the memory, **not the time**: float32 is as fast as 4-bit on this CPU (the 8-bit path is about 20 % faster). The cost scales with the number of 14-pixel tokens, so 518 px is about 4 times 266 px. A 2 MP photo and a 24 MP photo cost the same, because the model sees at most 518 px.

### Faces, warm run, single thread (four-face family photo found as 3 faces)

| Mode | CPU time (1 core) | Extra memory |
|---|---|---|
| Landmarks and parts, **no** blendshapes and segmenter | 0.3 s for 3 faces (about 0.1 s per face) | +261 MB |
| Landmarks, blendshapes and segmentation | 1.35 s for 3 faces (about 0.45 s per face) | +298 MB |

The time does not depend on the photo's size (640, 1024 or 1536 px give the same CPU time); the detector reads 128 px windows, and the 27 windows of the tile scan cost about 0.1 s together. First call: 2.0 s CPU (face files only) to 3.7 s (with the segmenter). Detection time is small; the second landmark pass and the segmenter dominate. For a quick overlay use `parts: false, blendshapes: false`.

### Slow-device proxy (one pinned core shared with three busy loops, the earlier spikes' rig)

One core (`taskset`) shared with three busy loops, warm runs, 4-bit depth file: 266 px 5.2 s wall (0.7 s CPU), 392 px 9.8 s (1.5 s CPU), 518 px 22.1 s (2.9 s CPU), +307 MB; first call 23.1 s wall (3.2 s CPU). Faces (three found, with segmenter and blendshapes): 8.1 to 8.5 s wall (1.3 to 1.4 s CPU), +290 MB, first call 27.9 s. **Caveat:** the machine was already at load 50 or more, so this rig added little on top of what every other run suffered; its wall times are an upper bound for a very busy device, and the CPU column is the number to scale.

Real phones: **estimate** 3 to 4 times a desktop core for WebAssembly, so depth at 266 px about 2 to 3 s, 392 px 4 to 6 s, 518 px 8 to 11 s; faces 0.4 to 0.6 s per face without the segmenter; the first call adds 10 to 12 s of session creation. I measured no phone.

### WebGPU

See the runtime note above: A software adapter exists in headless Chromium (`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`: vendor "google", architecture "swiftshader"), so the code path can be exercised but **speed means nothing**. The float32 Depth Anything V2 Small **runs correctly on the WebGPU provider** (ORT-web 1.22 jsep build, 266 px: valid map covering 0 to 1, mean 0.33) at 235 s per inference on the software adapter, which is a statement about SwiftShader, not about GPUs. I did not complete WebGPU runs of the 4-bit and 8-bit files (they need `MatMulNBits` and integer operators, whose WebGPU coverage in 1.22 I did not verify) and stopped them at the software adapter's speed. Conclusion: a WebGPU tier for depth is plausible (the float32 model runs), would need a float16 or float32 file of 50 to 99 MB, and **cannot be sized or promised without a real GPU**. The runtime accepts `{ ep: 'webgpu' }` and reuses `assets/vendor/ort-webgpu/` when it exists; nothing selects it by default.

### Download sizes (transfer, gzip -9 as a CDN would send; `.onnx` is not compressed by default on CloudFront)

| File | Raw | Gzipped |
|---|---|---|
| Depth map (4-bit mix) | 15.74 MB | 13.74 MB |
| Depth map, finer (8-bit) | 25.73 MB | 18.22 MB |
| Face detector, landmarks, blendshapes | 0.23 + 2.56 + 0.99 MB | 0.20 + 2.29 + 0.83 MB |
| Hair and skin detail | 8.36 MB | 7.59 MB |
| ORT engine (already shipped, cached after first use) | 11.2 MB wasm | 2.9 MB |

Depth map plus engine on first use: about 19 MB at the 10 Mbit/s figure above, 15 s. Faces plus engine: about 7 MB, 6 s. Storage for a stored depth map: 16-bit PNG (R high byte, G low byte) 75.7 KB at 266 x 182 (1.56 bytes per pixel), about 0.28 MB at 518 x 346; an 8-bit grey PNG is 18 KB at 266 x 182 but bands.

## Quality, by eye

Sheets (not committed) are in `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/maps/`: `sheet-A-depth-blur.jpg`, `sheet-B-relight.jpg`, `sheet-C-normals-fog.jpg` (12 pool photos each), `depth-compare-518.jpg` and `depth-detail-crops.jpg` (model comparison), `refine-crop-*.jpg` (edge refinement), `sheet-D-pool-faces.jpg`, `sheet-E-skin.jpg`, `crops-face-*.jpg`, `fair-sheet-<group>.jpg`, `challenge-overlay.jpg`, `challenge-skinmask.jpg`.

### Depth

- **Which model.** Depth Anything V2 Small against MiDaS v2.1 small on the same photos: DA2-S keeps the silhouette of each person, separates the three layers of a family photo, and draws the stacked books as separate steps; MiDaS-small blobs people into one lump and returns a near-flat map for the lupin photo. MiDaS is out on quality alone.
- **Quantisation (4-bit mix, 8-bit, float32), 8 photos at 518 px.** Mean absolute difference from float32 on the 0 to 1 scale: 8-bit 0.005 to 0.043 (median 0.014), 4-bit mix 0.019 to 0.049 (median 0.020). Depth ordering of random pixel pairs agrees with float32 99.7 to 100 % (8-bit) and 97.8 to 99.8 % (4-bit). Edge-map correlation 0.86 to 0.98 (8-bit), 0.81 to 0.96 (4-bit); the lowest values are the busiest scenes (sky with trees, dense meadow). In the side-by-side crops the three are indistinguishable except for slightly more mottling in the 4-bit map on tree foliage. **Quantisation does not hurt the broad shape; it does hurt flat regions** (next point).
- **Flat-region stability (decides relighting banding).** Normals from depth, scatter of the normal direction inside a physically flat patch (standard deviation of the angle): wall behind a statue 27.6 degrees (4-bit), 28.4 (8-bit) and **2.0 (float32)** before smoothing, 7.4 / 7.2 / 1.8 after the default 2-pixel smoothing; a book page 22.9 / 25.3 / 2.9 before and 4.0 / 4.6 / 2.9 after. So the quantised models carry fine-scale depth noise that the float32 model does not; smoothing removes most of it, which costs fine surface detail. Sky and sea are worse for every precision (14 to 36 degrees before, 14 to 21 after) because the model has no true depth there. A printed page and a mounted card show 20 to 39 degrees for all three models: the depth map tilts and bends them (the page is not flat in the map), a real failure for relighting. 8-bit storage of depth would show visible terraces: a 0.7 range floor patch used 128 of 256 levels, so store 16-bit.
- **Edges.** Hair is rounded into a smooth silhouette: at 518 px input individual strands are not resolved (people-08, travel-05). Grass blades and poles survive when they are thicker than about 3 px; thin foreground stems in the lupin photo are mapped **far**, so they blur when they should stay sharp. Objects held in front of a body (a phone, a ball) separate cleanly.
- **Depth blur demo (gather blur with occlusion-aware weights).** On five photos it looks like a phone's portrait mode: soft, believable bokeh, no bleed of a sharp subject into the background. The visible faults are the thin foreground stems above, a slightly soft halo where hair meets a bright background, and wrong focus when the tapped pixel's depth is wrong.
- **Edge refinement with the photo as guide** (guided filter, radius 6 at 1000 px, eps 2e-3, 120 to 1400 ms in JS for 0.6 MP). Mean photo gradient at the strongest 4 % of depth edges: people-08 0.128 to 0.149 (+16 %), people-07 0.142 to 0.168 (+18 %), garden-02 0.113 to 0.157 (+38 %), travel-05 0.164 to 0.167 (+1 %); the depth edge strength falls 12 to 44 % because the filter also softens thin or low-contrast depth steps. In the blur demo the crops with raw and refined depth look almost the same; refinement snaps leaf and shoulder edges a pixel or two tighter and removes a faint stair-step, **it does not create hair strands and does not fix halos by itself**. Verdict: worth doing on the GPU at render time, not a fix.
- **Relight demo (Lambert plus a rim term from depth normals).** On people it reads as a plausible soft side light; faces and shoulders round correctly. Faults: bright ghost outlines around silhouettes (the rim term firing on depth cliffs; the slope cap tames but does not remove them), a "dished" or wavy look on flat surfaces, a messy ghosting on foliage and meadow, and blotchy shading on skies. See `sheet-B-relight.jpg` (the shading-only column shows the surface the model believes in).
- **Fog and haze by depth** is the most robust demo: it only needs far-versus-near, and soft thresholds hide the edge error.
- **Failure cases seen in the pool.** Sky and sea (depth is a guess), night scenes (low signal), the text page (tilted plane), glass and mirrors (not tested with a true mirror), thin foreground stems, and anything where "near" is not what the model expects (a statue against a flat wall reads well, a flat poster does not).

### Faces

- **Against Google's own runtime** (MediaPipe Tasks WASM 1.2.3 with the same `.task`, run in the same browser on the same photos): mean landmark error 0.88 to 1.41 px, 0.63 to 1.04 % of face width, worst single point 2.2 to 4.7 px, on the 6 faces both found. Blendshapes differ by 0.012 to 0.040 on average and up to 0.29 on a single coefficient (smile 0.85 against 0.82, but 0.47 against 0.67 on one face); fine for gating, not for sliders. We find **more** faces than Google's runtime does: 3 against 2 on the family photo, and one each on two photos where it finds none (a woman lying at 60 degrees; a 47 px face in a street scene). One more small face (24 px, score 0.64) in a crowd was found by an earlier, looser tile threshold, which I then raised to 0.7 because 8 of 90 test photos had background hits at 0.6 to 0.67.
- **Pool results.** Found: all frontal and three-quarter faces including the laughing boy at an angle, a face rotated 60 degrees, a statue's face, a face at 47 px. Missed: a girl in three-quarter view with squeezed-shut eyes and head tilted back, the profile of a masked man, a face behind a hand and a visor, a distant surfer. Correctly empty: a painted mural, two gas-mask photos.
- **Part masks, judged at 100 to 160 px faces.** Eyes, lips, brows and the skin polygon sit on the real edges. The under-eye band is a half-moon below the lid, plausible but not anatomical. Teeth are the weak mask: inside the mouth polygon, a light-and-unsaturated test finds only parts of stained or shadowed teeth.
- **Skin smoothing demo** (frequency split restricted to the skin mask: guided-filter base plus the fine texture the slider keeps): the mask excludes eyes, brows, lips and hair, pores survive at texture 0.75, blotches soften, and nothing outside the skin moves (`sheet-E-skin.jpg`). It takes 0.8 to 2.7 s per photo in plain JS at 1.1 MP under load; X4 should do it on the GPU.
- **Warp demo.** Eye size, jaw width and smile are each one landmark-anchored displacement field on an 8 px grid; 35 to 350 ms in JS. Eye size at 0.8 looks natural on frontal faces; jaw width looks right at about half that amount and distorts the neck at 0.8 on tilted faces. The data is good enough; a product needs a mask-limited mesh warp.
- **Segmenter.** At the hairline and temple it removes strands of hair that the polygon alone includes, and it keeps most of the skin elsewhere (median 94 % of the polygon kept on 56 test faces). It never fully fixed beards or glasses frames: the pink mask still covers frames and, on bearded men, the beard. It is a refinement, not a skin classifier, and I added a guard so that if it keeps less than 35 % of the polygon the polygon is used alone.

## Fairness and failure honesty

**What I could and could not test.** No ground-truth landmark set with a usable licence is reachable from this sandbox (300W, WFLW and CelebA-style sets are research-only or blocked), so I cannot report landmark error against labels. What I did instead, all with FairFace (Hugging Face `HuggingFaceM4/FairFace`, validation split, padding 1.25, **CC BY 4.0**; images not shipped):

1. **A stratified set of 56 faces**: the 7 FairFace race groups x 8 age bands (3 to 9 up to 70+), one random image each. FairFace's labels are its annotators' coarse categories; I use them only to look for disparity, never to classify anyone. Skin tone is a proxy: median CIE L* of the cheek region (terciles dark below 39, mid 39 to 53, light above), not a clinical scale.
2. **Metrics per group**: face found, landmark stability under a 10 degree rotation of the photo and under down-scaling to 160 and 112 px (normalised mean point error, % of the inter-ocular distance; a test-retest measure, not accuracy), and how much of the skin polygon the segmenter keeps.
3. **90 further random in-the-wild faces** with no stratification, judged by eye for glasses, sunglasses, hats, head coverings, beards, make-up and angle (`challenge-overlay.jpg`, `challenge-skinmask.jpg`).
4. Google's own published fairness evaluations (model cards, section "Provenance" above).

**Results, stratified 56.** Found 51 of 56 (91 %). The five misses: three of eight in the "Black" group, one "Middle Eastern" and one "Southeast Asian". I looked at every miss: **all five are profile or strongly turned faces**, so this set cannot separate pose from skin tone, and with n = 8 per group a 62 % against 100 % difference is a signal to retest, not a finding (a random draw of side views would produce it). By lightness the misses were at L* 34, 43, 53, 56 and 62, so not concentrated in dark or light faces. Stability under rotation, median normalised error: 0.34 to 1.03 % in every group (all rotations together: median 0.62 %, 90th percentile 2.3 %); under 160 px scaling: 0.80 to 1.45 %. By age: median 0.3 to 0.8 % up to 50, 0.8 to 1.9 % for 50 and over, and the 60 to 69 band is the least stable (1.9 %); detection at 160 and 112 px is 100 % except one face per group in two bands. The segmenter kept a median 94 % of the polygon; the lowest values (65 to 73 %) were a child and two adults.

**Results, 90 random in-the-wild faces.** Found 82 (91 %). All eight misses are strong profiles or faces looking down or away (#1, 10, 37, 45, 48, 65, 69, 82). Found with a good fit: hats and caps (2, 4, 13, 15, 19, 28, 29, 34, 38, 56, 84), eyeglasses (23, 25, 26, 30, 54, 62, 66, 68, 71, 81, 83, 87), **sunglasses (14, 27, 40, 55, 80)**, head coverings (23 headscarf, 41, 70, 84), beards (21, 33, 39, 57), heavy and light make-up, very dark and very light skin, children, and people above 70. Wrong or poor fits: #89 (a profile looking down; the mesh sits on a cheek) and #86 (a face half covered by an arm) show landmarks that look found but are not right; the code reports a score and a presence value, but presence stays near 1 for such faces, so it cannot be used to reject them. In a few photos the tile scan reported a tiny background face; raising the tile threshold to 0.7 removes most of them.

**Where the skin mask is weak** (the question for retouching): sunglasses and glasses frames are inside the mask, so smoothing would blur them; beards (33) are inside the mask; heavy colour casts (face lit red or blue) and very low light work but are noisy at the edges; the polygon stops at the face oval, so ears and neck are never retouched (a feature, but a person may expect them); on profiles the far side drifts. **The mask never uses colour to decide what is skin**; colour appears in one place only, the light-and-unsaturated test for teeth inside the mouth polygon.

**Google's own numbers** (model cards, 17 geographic subregions, annotators' perceived gender and Fitzpatrick 1 to 6 or Monk scale): the face landmarker card reports a 0.01 percentage-point difference in landmark error between genders (2.61 % to 2.62 % of inter-ocular distance, against its 2.56 % goal) and gives skin-tone results in tables; the blendshape card reports a gender and skin-tone discrepancy below its fairness criterion; the BlazeFace card slices its detection results by 17 regions, gender and five Fitzpatrick-aligned skin-tone groups. These are Google's tests on Google's data; they are consistent with what I saw (no tone-linked pattern) but I did not reproduce them.

**What the product should do about it**: show what was found and let the person move, add or remove a face; make every face-aware effect reversible and previewed; keep a subtract brush for the skin mask (glasses, beard); never claim to find "all faces"; and retest this section on real user photos before any marketing copy about faces.

## The runtime (`labs/maps/maps.js`) and the data shapes

One small module, shaped like `le-bgremove.js` so adopting it is a move, not a rewrite: lazy (nothing downloads or starts until a call asks), inference in a worker (`labs/maps/maps-worker.js`, one worker per kind so a 3 s depth run never blocks a face run), model bytes in Cache Storage `le-models-v1` with an `x-le-model` header (so the storage manager lists them), a registry of plain-language options, `LE_SUPPORT_DEFS` entries, `LEPwa.describeModel` rows, abort through `AbortSignal`, one automatic retry at half size on out-of-memory.

```
LE.maps.models()                      registry: { id, kind: 'depth'|'face'|'parts', label, bestFor, downloadMB, speedLabel, qualityLabel,
                                                  sizeLabel: "Depth map — small download, about 16 MB, one time", tier: 'standard'|'pro'|'eval', files, about }
LE.maps.budget()                      { tier, depthSide, faceSide }       desktop 518/2048, modern 392/1536, older 266/1024
LE.maps.support('depth'|'face')       LE.support.check(...) when present; gate(kind, { run }) wraps LE.support.gate
LE.maps.depth(image, { model, maxSide, refine, ep, signal, onProgress })
      -> { depth: Float32Array(width*height), width, height, model, version, orientation: 'near=1', timings, refined, raw: { lo, hi } }
LE.maps.refineDepth(result, image, { radius, eps, maxSide })   -> same shape at the photo's resolution (guided filter)
LE.maps.normals(depth, { strength, smooth, maxSlope })         -> canvas, RGB = 0.5 + 0.5 * n, x right, y UP, z to the viewer
LE.maps.normalsData(depth, opts)                               -> Float32Array(w*h*3) unit normals (what a renderer wants)
LE.maps.face(image, { maxFaces, parts, blendshapes, scan, maxSide, signal, onProgress })
      -> [ { box, detectorBox, score, presence, rotation, landmarks: [[x,y,z] x 478], blendshapes?: { jawOpen, mouthSmileLeft, ... 52 },
             parts: { skin, eyes, lips, teeth, brows, underEyes, innerMouth, irises },
             maps: { skin: canvas|null, hair: canvas|null }, image: { width, height }, model, version } ]
LE.maps.faceMask(face, part, w, h, { feather, grow, segmentation, image }) -> canvas (white, alpha = mask)
LE.maps.pack.depth / unpack.depth     16-bit depth <-> RGBA canvas (R high byte, G low byte), lossless as PNG
LE.maps.pack.face / unpack.face       compact JSON (about 4 KB) <-> face object; parts are re-derived on unpack
LE.maps.isCached(id) / remove(id) / cachedModels() / unload(kind)
```

Conventions that matter to a renderer:

- **Depth is relative disparity, not metres.** `depth[y*width + x]`, row 0 at the top, `1 = nearest, 0 = farthest`, robust-normalised per photo (1st and 99th percentile of the model output map to 0 and 1, then clamped). Two photos' depth values are not comparable, and a photo cropped later keeps its own scale. The grid is the model's (a multiple of 14, aspect preserved to within 7 px), covering the **whole** image: sample it with bilinear filtering at `u = x/width, v = y/height`.
- **Normals are derived, never stored**: `n = normalize(-k·∂d/∂x, +k·∂d/∂y, 1)` with `k = strength × width`, after two box blurs of `smooth` pixels and a soft cap `maxSlope` (default 1.2) that stops depth cliffs at silhouettes from turning into sideways walls. Strength 1 means a full-range depth change across the image width is a 45 degree slope.
- **Face coordinates are fractions of the analysed image** (`x` of width, `y` of height), `z` in the same unit as `x`, 0 at the head centre, smaller is nearer, so they survive resizing exactly like every other expert-mode coordinate. `rotation` is the roll of the face's x-axis in radians (image y runs down).
- **Parts are polygons, not bitmaps**: `{ rings: [[[x,y]...]...], rule: 'nonzero'|'evenodd' }`. `skin` has holes (eyes, brows, lips) and needs `evenodd`; `lips` is outer minus inner; `underEyes` is a band below the lower lid built geometrically; `teeth` is the inner-mouth polygon (a pixel test for "light and unsaturated" is applied only inside it, by `faceMask(..., 'teeth', ..., { image })`). The 478-point mesh topology tables are `LE.maps.IDX`.
- **Skin uses two sources**: the landmark polygon (always) and, when the optional "hair and skin detail" model is on the device, the segmenter's face-skin class (intersected with the polygon). Colour is never used to decide what is skin.

### `layer.maps` (proposal for `docs/EXPERT-MODE.md`)

What to store is what editing needs and nothing else; every entry records the model and version that made it (E5) so a lost or stale map is simply regenerated from the photo.

```
layer.maps = {
  depth: {
    asset: <assetId>,                 // PNG, RGB: R = high byte, G = low byte of a uint16, B = 0, opaque. Lossless; decode with createImageBitmap(blob, { colorSpaceConversion: 'none' })
    width, height,                    // the model grid (<= 518 on its long side), about 0.28 MB at 518 x 346
    orientation: 'near=1',
    model: 'depth-small', version: 'maps-1',
    refined: false                    // true only if the stored grid was already guided-filtered at photo resolution
  },
  normals: { from: 'depth', strength: 1, smooth: 2, maxSlope: 1.2 },   // parameters only; computed on demand, cached by hash (E5)
  face: [                              // one entry per face, in detector-score order
    { v: 1, count: 478, points: <base64 of 478 x (uint16 x, uint16 y, int16 z)>, rotation, score, image: { width, height },
      model: 'face-landmarks', version: 'maps-1',
      skin: { asset } }               // optional: the segmenter's face-skin plane, 8-bit alpha PNG, long side <= 1024; absent means "polygon only"
  ]
}
```

Sizes: depth 0.28 MB per photo at 518 (75 KB at 266), one face about 4 KB of JSON, the optional skin plane 20 to 60 KB. **Do not store**: normals, parts masks, blendshapes (cheap to recompute; blendshapes are a per-use reading, not document state), the face box (derived from the points), or the photo's raw model output. Re-generation is `LE.maps.depth(photo, { model })` and `LE.maps.face(photo)`; the agent op `map.generate` should be a thin wrapper.

`mask kind 'depth' { near, far, soft }` samples the stored depth directly. `mask kind 'face' { part }` maps to `faceMask(face, part)`; for `skin` it reads the stored polygon plus the optional `skin` asset.

Two things I changed my mind about while building this and recommend to the renderer team: store the depth at the **model's** resolution and refine on the GPU at render time with the photo as guide (a joint bilateral tap loop is cheap), rather than baking a refined 1 MP map; and treat face points as a stored **input** to the warp, never as pixels (a liquify stack entry references `layer.maps.face[i]` by index and stores its own slider values).

## Device-tier guards and `LE.support`

Declared in `labs/maps/maps.js` through `LE_SUPPORT_DEFS` (group "On-device AI"), same rules as `docs/SUPPORT.md`: uncertain means "Try anyway", only a missing API blocks.

| id | needs | wants | memoryMB | downloadMB | note |
|---|---|---|---|---|---|
| `maps.depth` | `wasm`, `wasm-simd`, `worker`, `offscreen-canvas` | `cache-storage` | 450 (measured +282 for the 4-bit file at 518 px; +352 for 8-bit) | 19 (16 MB model plus the 2.9 MB engine) | "Needs about 450 MB while it runs. About 1 to 3 seconds per photo on a computer, 3 to 12 on a phone." |
| `maps.face` | same | `cache-storage` | 400 (measured +261 to +298) | 7 | "About half a second per face on a computer. Face points are computed on this device and never sent anywhere." |
| `maps.faceparts` | same | `cache-storage` | 400 | 9 | optional add-on |

`LE.support` rule 4 then marks a device that reports under 8 GB as limited when the feature needs more than a quarter of it: a 1 GB device is "limited" for depth, a 2 GB phone is fine.

Input size by tier (`LE.maps.budget()`, same `LE.device.tier()` and `LE.perf` mode as `le-bgremove.js`):

| Tier | Depth input (long side) | Face input (long side) | Expect (estimate for phones) |
|---|---|---|---|
| desktop | 518 | 2048 | depth 1 to 3 s |
| modern phone or `saver` on desktop | 392 | 1536 | depth 4 to 6 s |
| older (reports 2 GB or less, or `saver` on a phone) | 266 | 1024 | depth 2 to 3 s, softer map |

The runtime retries **once at half size** after an out-of-memory error, then reports `err.code = 'memory'`. Other codes: `offline`, `download`, `unsupported`, `cancelled`, as in `le-bgremove.js`. Run depth and face in separate workers, never both at once on an "older" device; call `LE.maps.unload()` when the tool closes (an idle session holds about 280 MB). WebGPU is opt-in only (`{ ep: 'webgpu' }`) and unmeasured on real hardware, so no tier selects it by default.

## What the feature teams can and cannot rely on

### X6 (relighting and depth effects)

Good enough for, in rough order of confidence:

1. **Fog, haze, atmospheric depth, depth-range masks** (`mask kind 'depth'`). These use depth as a smooth ranking of near and far; the model gets the ordering of subjects, ground and background right on every pool photo except the failure cases below (`order` agreement with the float32 model 99 to 100 % on random pairs). Soft ranges hide the edge error. **Rely on it.**
2. **Background and foreground blur ("portrait mode" and tilt-to-subject focus pulls).** Convincing at preview size on people, objects and landscapes with the focus set by tapping the subject; the demo's gather blur with occlusion-aware weights shows no foreground bleed. What it cannot do: keep individual hair strands, fine foliage or a mesh in focus against a blurred background: the edge of the depth map is about 1 to 3 photo pixels soft at 518 px input and rounds hair into a smooth silhouette. Guided refinement against the photo helps but does not invent the missing strands (section "Quality"). **Promise "background blur that looks like a phone portrait mode"; do not promise a cinema lens.** Keep the maximum blur radius modest and the focus range soft; offer a manual refine brush.
3. **Adding a soft key, rim or fill light and shifting the mood** (the light demo). It works because only the broad shape matters: faces, shoulders and large objects read as rounded volumes and light wraps plausibly. Keep the strength moderate and the ambient high.
4. **Ambient occlusion and contact darkening** from depth differences (screen-space): plausible at low strength.

**Not good enough for**, and the UI should not suggest it:

- **Matching a studio relight.** Normals are the derivative of a 25 M-parameter model's output: flat walls, tables and skies wobble by a few degrees (measured, section "Quality"), curved surfaces get a "dished" look, and every depth discontinuity becomes a slope. Strong directional light on a flat region shows banding or a wavy surface. Specular highlights, material response, correct shadow direction, light colour spill: not available.
- **Hard cast shadows from the relight light** (ray marching a depth map this soft gives smeary shadows).
- **Metric anything** (distances, a physical focal plane in metres). Depth is relative disparity normalised per photo.
- **Thin structures** (wires, fences, hair strands, fur, glass) and **transparent or mirrored surfaces**, which the model sees as the thing behind or the reflected scene.
- **Skies, night scenes, pure texture** (see failure cases): depth there is a plausible guess, not a measurement.

Renderer notes: sample the stored depth with bilinear filtering and refine against the photo in the shader (the lab's guided filter is a reference, 120 to 650 ms in JS for 0.6 MP; a GPU joint-bilateral tap loop will be a fraction); derive normals on the GPU from the (smoothed, slope-capped) depth; cap the normal strength in the UI so the default never shows the artefacts.

### X4 (retouching, face-aware liquify, masks)

**Rely on:**

- **478 landmarks that sit on the face to about 1 % of face width** on frontal and three-quarter faces at 90 px wide and up (mean 0.9 to 1.4 px against Google's own runtime on the same photos). That is enough for the two warps in the lab (eye size, jaw width, smile) to look right without hand adjustment, and for eye, lip and brow masks whose edges lie on the real edges.
- **Part masks derived from the landmarks**: eyes, lips, brows, inner mouth, face oval and a skin polygon with holes. They are exact polygons at any resolution (resolution-independent, regenerable, a few KB).
- **A skin mask that does not depend on colour**: the landmark polygon, tightened by the optional segmenter's face-skin class at the hairline. Frequency-separation smoothing restricted to it keeps texture and does not touch eyes, brows or lips (lab demo).
- **Several faces per photo**, found including small ones (tile scan), and the face count is honest: `[]` when none is found.

**Do not rely on:**

- **Every face being found.** Missed in this pool: a girl in three-quarter view with strongly closed eyes tilted back, a face behind a hand and a visor, and the profile of a man wearing a mask; in the test set the figures are in "Fairness and failure honesty". The UI must show what was found and let the person add or move a face.
- **Teeth masks.** The "teeth" mask is the inner-mouth polygon with a light-and-unsaturated pixel test inside it; on stained, shadowed or very small teeth it misses most of them. Use it for whitening with a visible preview only.
- **Under-eye masks as anatomy.** They are a geometric band below the lower lid (about 0.55 eye widths), a convenient region, not a bag detector.
- **Glasses, beards, hats, make-up.** The skin polygon includes beard, glasses frames and make-up (it is geometry); the segmenter removes hair at the hairline and part of a beard but is trained mostly on selfies. Retouching tools need a brush to subtract.
- **Blendshapes as precise measurements** (they differ from Google's runtime by 0.02 to 0.04 on average and up to 0.3 on single coefficients because the crop differs slightly). Use them as gates (blink, smile, mouth open), never as slider values.
- **Profile and extreme angles.** Landmarks exist for a profile but the polygon masks drift on the far side; do not offer face-aware liquify on faces with more than about 45 degrees of yaw.
- **Warp quality on real use.** The lab warps use an unconstrained bilinear remap; X4 needs the same anchors with a mesh-based, mask-limited displacement and edge handling. The data is good enough; the lab's pixels are not a product.

### Both

- Maps are **inputs**, not edits: E1 holds, every effect is an `fx` entry that references `layer.maps` and stores only its own slider values.
- First use is slow (download plus session creation, section "Measurements"): show it, cache it, never re-run silently.

## Privacy note (for the product copy and the privacy page)

Face landmarks are biometric-adjacent data, so the rules are stated here and should be stated to people in the same words:

- **Computed on the device.** Detection, landmarks, blendshapes and the hair-and-skin mask run in a worker on the person's own phone or computer, from the photo they opened. The model files are downloaded once from LocalEditor's own host (never a third party) and cached on the device; the photo is never sent anywhere. There is no network call during a face run (the worker only fetches the ORT engine and the model bytes the page hands it; `tests/maps.test.js` checks nothing loads before a button is pressed).
- **Stored only inside the person's own design, and only if an edit needs it.** A face map is saved in `layer.maps.face` when a retouch or face-aware reshape uses it, about 4 KB per face, and is dropped with the layer. A design that only used the depth blur stores no face data. They should never be written to a shared recipe (`.leworkflow`): a recipe carries slider values, not points, and the map is regenerated against the photo it is applied to.
- **Regenerable (E5).** Nothing is kept that cannot be made again from the photo; deleting the map never loses an edit's meaning, only its cached input.
- **Not identification.** The models output points, regions and expression sliders. They produce no embedding, no name, no match against any other photo, no age, gender, ethnicity or emotion label (the blendshape model's "smile" and "blink" values are used only to gate retouching, for example not to smooth over a blink). The feature does not identify anyone and nothing in it could be turned into an identity without adding a different model.
- **No face analysis without a face edit.** Do not run the face map in the background on every photo "to be ready". Run it when the person opens a face tool, and show what is happening.

## Risks

1. **Quality ceiling of a small depth model.** Hair, fur, mesh, wires and glass will always be the weak spot; depth blur and relight will look "phone portrait mode", not studio. Mitigate with soft ranges, a refine brush and honest copy. A larger model (Depth Anything V2 Base is CC-BY-NC; no permissive successor of that size exists today) or a WebGPU tier is the only way up, and I could not measure WebGPU on a real GPU.
2. **Training-data provenance.** Depth Anything V2 Small learned from pseudo-labels on 62 M public photos; Google does not disclose the MediaPipe training photos. The licences on the weights are permissive and stated by the authors; the data terms are not ours to close. Same stance as the background remover: the owner accepts it knowingly.
3. **One licence statement is second-hand**: the multi-class selfie segmenter has no Google model card at the bucket I could reach, and its Apache-2.0 label comes from the MediaPipe solution listing and the conversion's Hugging Face card. If that is not acceptable, drop the optional "hair and skin detail" file (8.4 MB): the polygon masks still work and the loss is at the hairline and beard (see "Quality").
4. **Third-party ONNX conversions.** The detector, landmark, blendshape and segmenter ONNX files come from third-party Hugging Face repositories. I proved them numerically equal to Google's own `.tflite` files and pinned every source hash in `scripts/fetch-maps-models.js`, so a later change upstream is refused. They can also be re-made from Google's files with `tf2onnx`; that needs TensorFlow, which I did not install.
5. **First-run cost.** Download (15.7 MB model plus 2.9 MB engine, about 19 MB; 15 s at 10 Mbit/s), then 3 to 12 s of session creation on first use, then each depth map. On a phone expect about 20 to 40 s from tap to first depth map. Mitigate with a download step the person starts, progress, cancel, and keeping the worker alive while the tool is open (idle session about 280 MB).
6. **Memory on phones.** +282 MB over an idle page for depth at 518 px, +298 MB for four faces with segmentation; a 3 GB phone can run one at a time, not both plus the studio's own canvases at full size. The runtime halves the input size once after an out-of-memory error, then reports it. Unload when the tool closes.
7. **4-bit kernels.** The 15.7 MB file uses `MatMulNBits`, which onnxruntime-web 1.22 runs on WASM. A future ORT bump should re-run `tests/maps.test.js`; the 25.7 MB 8-bit file is the fallback and needs no contrib operators.
8. **Fairness is measured by proxy only.** There is no free, ground-truth-labelled landmark set reachable from here, so section "Fairness and failure honesty" reports detection, stability under rotation and resolution, and visual review across 56 images of seven groups and eight age bands, plus Google's own published fairness evaluations. It does not prove equal accuracy. Re-test on real photos once the feature is in users' hands (locally, opt-in).
9. **Faces are sensitive.** The privacy note above is a design commitment: no uploads, no identification, no standing analysis, minimum storage. The first marketing or help text that says otherwise is a bug.
10. **WebGPU, threads, real phones: not measured.** No GPU in the sandbox (software adapter only), no cross-origin isolation (single thread), no phone. Every phone figure is an estimate from a single pinned core with competing load.

## Reproducing everything here

```
node scripts/fetch-maps-models.js all            # sources into assets/models/maps/local/src/ (git-ignored), SHA-256 pinned
node scripts/fetch-maps-models.js --derive       # runs labs/maps/tools/derive.py and derive_q4.py (python3 with onnx, onnxruntime, numpy)
python3 labs/maps/tools/verify_face.py <dir> <photo.jpg>    # ONNX vs Google's tflite, numerically
node tests/run.js maps                           # the committed test
```

Hashes, sizes and licences of every file are in `assets/vendor/LICENSES.md` ("Depth and face maps"). Sample sheets from this work (not committed): `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/maps/`.
