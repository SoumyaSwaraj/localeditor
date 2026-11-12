# Background remover: the large options (BiRefNet lite, BiRefNet, BEN2)

Written 12 November 2026. Follows `docs/research/background-remover.md` (the spike that found BiRefNet could not run in WASM). Everything below was measured in this sandbox unless marked **estimate** or **unverified**. The sandbox has no real GPU, 4 shared vCPUs (load average 10 to 23 during these runs, so every time is ±50 %) and 15 GB of RAM.

## Answer

- All three now run in a browser on onnxruntime-web 1.31.1's WebGPU provider, **on a computer with a graphics card that supports half precision** (WebGPU `shader-f16`). They are offered as three "pro" options, loaded only when the person opens *Other quality options*, and folded under *Needs a more powerful device* where they cannot run.
- What made BiRefNet possible: the released ONNX files decompose deformable convolution into GatherND; that is what needed 12 GB. Re-exported from the released PyTorch weights with the ONNX `DeformConv` operator (opset 20) and a fixed 1024 px input, BiRefNet lite needs **2.0 GB** peak natively instead of 12.2 GB, and **0.8 GB at 512 px**.
- Proven here: the re-exported BiRefNet lite graph loads and produces the correct mask **in Chromium through the app's own worker and onnxruntime-web 1.31.1 WebGPU** (SwiftShader software adapter, 512 px, fp32: IoU 0.9988 against native onnxruntime). The shipped fp16 files match fp32 natively (IoU ≥ 0.9998). Speed and memory on a real GPU, and on real phones, are **not** measured.
- Quality (14 pool photos, contact sheets below): BiRefNet (full) is the best general option by a clear margin; BiRefNet lite is clearly better than the current *More detail* on people, hair, flowers and crowds; BEN2 is the best on hair and on some multi-object scenes but unreliable on objects and busy photos.
- Recommendation to the owner, in short: ship **BiRefNet lite** as *Better* for computers with a graphics card (worth it), ship **BiRefNet** as *Best* for capable computers (worth it, big download), ship **BEN2** only as an extra choice under *More choices* ("Best for people"), not as a default.

## Licences

| Model | Code | Weights | Training data | Verdict |
|---|---|---|---|---|
| BiRefNet lite (Swin-T, `BiRefNet-general-bb_swin_v1_tiny-epoch_232`) | MIT, Copyright (c) 2024 ZhengPeng ([LICENSE](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE), fetched from raw.githubusercontent.com; model card `license: mit` at [huggingface.co/ZhengPeng7/BiRefNet_lite](https://huggingface.co/ZhengPeng7/BiRefNet_lite)) | MIT (released under the same repository and release `v1`) | General-use weights: DIS5K-TR, DIS-TEs, DUTS-TR/TE, HRSOD, UHRSD, HRS10K, P3M-10k, a humans set (README model zoo table). **DIS5K's terms say "non-commercial use in research or educational purpose"** (see the earlier spike) | Ships under our rule (MIT); same dataset caveat as IS-Net, owner's call |
| BiRefNet (Swin-L, `BiRefNet-general-epoch_244`) | MIT (same) | MIT | Same as above | Same |
| BEN2 base (`BEN2_Base.onnx`) | MIT, Copyright (c) 2025 Prama LLC ([LICENSE](https://github.com/PramaLLC/BEN2/blob/main/LICENSE), fetched from raw.githubusercontent.com) | MIT: the Hugging Face model card [PramaLLC/BEN2](https://huggingface.co/PramaLLC/BEN2) declares `license: mit`; the HF repository itself has no LICENSE file (404) | "Trained on the DIS5k and our 22K proprietary segmentation dataset" (model card). Only the *base* model is open; their full model is commercial (API) | Ships under our rule (MIT); DIS5K caveat plus an undisclosed private set |
| onnxruntime-web 1.31.1 | MIT | n.a. | n.a. | Vendored in `assets/vendor/ort-webgpu/` |

Licence texts: `assets/vendor/licenses/birefnet-LICENSE.txt`, `ben2-LICENSE.txt`, `onnxruntime-LICENSE.txt`. Rows in `assets/vendor/LICENSES.md`. Legal risk is the same kind as the spike's IS-Net finding: permissive weights, research-only training data. I cannot close it; get counsel before relying on these commercially.

## Artefacts

Built by `node scripts/fetch-models.js pro` → `scripts/models/build_pro.py` (tool versions pinned in `scripts/models/requirements.txt`). Sources are checked by SHA-256 before use. Outputs go to `assets/models/pro/` (git-ignored; each is over GitHub's 100 MB limit) and to S3 via `scripts/deploy.sh`.

| Option (plain name) | Source → conversion | File, bytes | Precision, input | Runtime | Native peak memory (onnxruntime CPU, arena off) | Native time per photo (3 to 4 shared threads) |
|---|---|---|---|---|---|---|
| *Better* / "Fine detail" | `BiRefNet-general-bb_swin_v1_tiny-epoch_232.pth` (177,791,685 B) → `export_birefnet.py` (DeformConv, opset 20, static 1×3×1024×1024, sigmoid in the graph) → onnxslim (no Gemm fusion, no folding over 1 MB) → `to_fp16.py` (onnxconverter-common, keep I/O fp32, DeformConv kept fp32) | `birefnet-lite-1024-fp16.onnx`, 108,834,041 | fp16, 1024 | WebGPU (shader-f16) | fp32: **2.0 GB** (released export: 12.2 GB); fp16 file: 1.9 GB on CPU | 13 to 31 s (fp32 and fp16 alike) |
| *Best* / "Best detail" | `BiRefNet-general-epoch_244.pth` (885,082,437 B) → same steps | `birefnet-1024-fp16.onnx`, 480,500,583 | fp16, 1024 | WebGPU (shader-f16) | fp32: **4.1 GB**; fp16 file: 4.2 GB on CPU | 18 to 73 s |
| "Best for people" (under *More choices*) | `BEN2_Base.onnx` from Hugging Face (222,932,053 B, sha256 `22cea621…`) → **unchanged** (it is already a mixed fp16 graph with fp16 MatMul/Conv) | `ben2-1024-fp16.onnx`, 222,932,053 | mixed fp16, 1024 | WebGPU (shader-f16) | **3.8 GB** (7.7 GB with onnxruntime's default arena) | 17 to 36 s |
| (measured, not shipped) BiRefNet lite fp32 512 | same export at 512 | 191,707,898 | fp32, 512 | WebGPU or 1.31 CPU | **0.8 GB** | 1.3 to 1.8 s |

What the memory options gave, honestly:

- **Graph export (the big win).** GatherND deformable convolution → ONNX `DeformConv`: 12.2 GB → 2.0 GB for lite at 1024. onnxruntime-web 1.31.1 has a `DeformConv` kernel on its CPU side (the WebGPU provider hands those 20 nodes to it); **onnxruntime-web 1.22 (our WASM build) does not** ("Could not find an implementation for DeformConv(19)", measured), so the new graphs need the 1.31 runtime even for CPU.
- **Fixed size, smaller input.** The graph is static; 512 and 768 exports work (0.8 GB at 512). But BiRefNet was trained at 1024 and at 512 it degrades badly on some photos (books-02: IoU 0.001 against its own 1024 result, the mask becomes noise). I did not ship a reduced-size variant. A dynamic-size export with `freeDimensionOverrides` was not tried.
- **fp16.** Halves download (lite 194 → 109 MB, full 938 → 481 MB) and GPU memory (**estimate**). Numerics: fp16 files vs fp32 on onnxruntime CPU, IoU ≥ 0.9998, MAE < 0.0001 (lite: 3 photos, full: 2). A PyTorch run of lite with activations in fp16 (closer to what a GPU does): IoU 0.9999, no overflow (see "PyTorch fp16" below). **fp16 needs WebGPU `shader-f16`; the WASM/CPU path cannot run these files usefully** and SwiftShader has no `shader-f16`, so the fp16 files could not be run in a browser here.
- **int8.** Not used. WebGPU has no fast path for dynamic-quantised MatMulInteger (it would fall back to CPU); the spike found int8 broke the tiny U²-Net; for a WASM-only fallback it would be the next thing to try on lite at 512.
- **Simplification.** onnxslim removed 13,700 of 15,100 nodes (shape arithmetic). Its default settings *grew* the file by 100 MB (Gemm fusion duplicated the weights of the backbone, which runs twice; constant folding baked the Swin attention masks); `--skip-fusion-patterns FusionGemm --size-threshold 1000000` avoids both.
- **External data format.** Not needed: every file is under 2 GB and loads as one buffer; the page streams it into Cache Storage and reads it back once (no double copy in the page).
- **Tiling.** Not appropriate (global models), not tried.

## Runtime

- `assets/vendor/ort-webgpu/`: `ort.webgpu.min.js` (70,811 B), `ort-wasm-simd-threaded.asyncify.module.js` (53,457 B, renamed from `.mjs`), `ort-wasm-simd-threaded.asyncify.wasm` (28,747,738 B; 7.1 MB gzipped). Unmodified from the npm package. Loaded only by the worker and only for `runtime: 'webgpu'` options; the standard options keep the 1.22 WASM build untouched.
- Why the spike's 1.31 attempt failed: from 1.2x, `ort.webgpu.min.js` uses the native WebGPU provider in the **asyncify** wasm, not the old JSEP files; pointing `wasmPaths` at the JSEP pair gives "webgpuInit is not a function". The worker now points at the asyncify pair.
- The worker asks for a `high-performance` adapter, refuses early (plain error) when `shader-f16` is missing, and skips the warm-up run for these models (one run costs as much as the photo).
- The large models output probabilities, so the worker no longer min-max stretches their output (`minmax: false`): on photos with no clear subject the raw output stays faint and the existing "No clear subject" check fires, instead of a stretched full-frame haze (BiRefNet full on `still-03` and `travel-02` produced exactly that haze when stretched; its raw maximum on both photos is 0.000, so unstretched the mask is empty).

## What was verified here, and what was not

| Claim | How | Status |
|---|---|---|
| Re-exported BiRefNet lite runs in Chromium through `le-bgremove.js` + worker + onnxruntime-web 1.31.1 WebGPU | Playwright, `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`, 512 px fp32 graph, `people-07` | **Verified**: correct mask, IoU 0.9988 / MAE 0.0006 vs native; 618 s inference on the software adapter (load 7.4 s) |
| Same graph on our 1.22 WASM build | same harness, `ep: 'wasm'` | **Fails**: no DeformConv kernel in 1.22 |
| fp16 files give the same masks as fp32 | onnxruntime 1.31.1 CPU | **Verified** (IoU ≥ 0.9998), but CPU may compute fp16 nodes differently from a GPU shader |
| fp16 files in a browser | needs `shader-f16` | **Not verified** (SwiftShader lacks it) |
| BEN2 in a browser | needs `shader-f16` (fp16 graph) | **Not verified**; natively correct |
| BiRefNet full in a browser | needs `shader-f16`; 481 MB | **Not verified**; natively correct |
| Speed and GPU memory on real GPUs | | **Not measured.** Upstream reports BiRefNet (full, fp16, 1024) at 3.45 GB GPU memory and 17 FPS on an RTX 4090 in PyTorch; WebGPU will be several times slower. **Estimate**: lite 1 to 3 s and about 1 GB of GPU memory on a recent laptop GPU; full 3 to 10 s and 2 to 3.5 GB; BEN2 between the two |
| Phones | | **Not tested.** All three are folded on phones unless the phone reports enough memory, with "Try anyway" |
| Download, consent, free-space refusal, cancel, failure recovery, "not on this copy" | `tests/cutout-pro.test.js` | **Verified** in Chromium |
| Safari / Firefox | | **Not tested** |

The largest single tensor (the full-resolution decoder layer) is 120 channels × 1024² for lite (240 MB in fp16) and 240 channels for full (480 MB). Adapters whose `maxStorageBufferBindingSize` is below 256 MB / 512 MB are treated as unable to run them (`bufferMB` in the definitions).

## Quality

Contact sheets (original, then Quick, More detail, BiRefNet lite, BiRefNet, BEN2; raw masks with no refinement for all, so the comparison is about the models):

- `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/pro-models/out/sheet-1-checker.jpg` (people-01, 03, 05, 07, still-01, still-03, books-02)
- `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/pro-models/out/sheet-2-checker.jpg` (street-01, travel-02, nature-01, sky-01, garden-02, arch-01, soft-01)
- `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/pro-models/out/sheet-all-magenta.jpg` (all 14 on magenta, shows halos)
- `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/pro-models/out/zoom-p07-girlhair.jpg` (hair, 3× zoom)

By eye:

- **Hair.** *More detail* cuts the girl's fly-away hair off with a soft blurred edge. BiRefNet lite keeps the strands with a crisp edge; BEN2 keeps the most strands, semi-transparent, which is the most natural. BiRefNet full is like lite, slightly cleaner.
- **People and groups.** Family (people-07): all three large options are clean; *More detail* leaves ghosts at the edges. Two walkers in a crowd (street-01): BiRefNet lite and full give exactly the two walkers with no ghosts of the crowd (the standard options leave ghosts); **BEN2 makes the second walker half transparent** (a real failure). Woman with pearls (people-01): all keep her; BEN2 and full keep more of the loose pearls.
- **Many objects.** Book stack (books-02): BiRefNet full and BEN2 keep every book including the tall ones at the sides; *Quick* and *More detail* are good; **BiRefNet lite keeps only the middle stack** (its worst result). Tea table (still-01): lite keeps cup, vase and book; full and BEN2 cup and book; standard options a faint book.
- **Fine structures.** Lupins (garden-02): lite and full give crisp individual flowers and stems; standard options a blur; BEN2 a noisy mix.
- **Choice of subject.** Painted door with a plant (people-05): full takes door and plant (sensible); lite a strange mix; **BEN2 takes the plant and pots but not the door**. Vintage card (soft-01): full keeps the whole card (sensible), lite the printing, BEN2 a broken mask.
- **No subject** (landscapes, night canal, desert): the standard options cut out random land (sky-01: the whole desert); lite and BEN2 return almost nothing (good); full returns nothing on the desert but a faint haze on the night canal and the beach when its output is stretched, which the `minmax: false` change turns into "No clear subject".
- **Transparent objects**: none in the pool; not assessed.

Verdict: **BiRefNet (full) is the best general remover** here; **BiRefNet lite is a large step up from *More detail*** except on the book stack; **BEN2 is the best on hair but the least predictable on objects and crowds**, so it is labelled for people and kept out of the default ladder.

### PyTorch fp16

BiRefNet lite run in PyTorch 2.15 with weights **and activations** in half precision (`model.half()`, CPU), against fp32, on `people-07` at 1024: MAE 0.0001, IoU 0.9999, no NaN or overflow. So the Swin-T backbone and decoder survive fp16 arithmetic. Not repeated for BiRefNet full or BEN2 (time); BEN2 was published as an fp16 graph by its authors.

## The chooser (what people see)

Follows the owner's download policy (`docs/DOWNLOADS.md`): no download talk in the main flow, quality first, one question only when the policy calls for it.

- **Main flow.** "Remove the background?" with one gold *Remove background* button (the toolbar's *Remove BG* does the same in one tap). No size, no download question. If a download is needed and the policy allows it, it happens with a quiet progress line ("Getting ready · 40%") and the result appears.
- **Automatic pick: quality first, then speed.** Among options this device runs well (`LE.support` status `ok`), general subjects only, that are already on the device or within the automatic limit (60 MB; 5 MB on a metered or data-saver connection), the best quality wins, then the faster. If that best one is not on the device but a lesser one is, the lesser one is used now and the better one is fetched in the background; when it arrives, the done panel shows *Improve this cut-out* once. The large options are never fetched silently; they are used automatically only once they are on the device. With `LE.downloads` on the page, the options go to `LE.downloads.pick({ id, quality, speed, bytes, supportId, cached })`, every download goes through `LE.downloads.request({ id, name, bytes, kind: 'model', reason })` and `LE.downloads.track`; without it, the fallback in the policy applies (no question at 60 MB or less, ask once above, remembered).
- **Other quality options** (unchanged role, the place for sizes): a three-step ladder, **Quick · Better · Best**. Each step shows the option in use for that quality if there is one (the person's choice or the automatic pick, so by default Better = *More detail*), otherwise the best option this device can run (on a computer with a capable graphics card Best = BiRefNet; without one there is no Best). BiRefNet lite ("Fine detail") is then under *More choices*, and takes the Better step once chosen. Each card: a small before/after crop, what it is best for, speed, "Works well on this computer" / "May be slow", and the download line ("Large one-time download (about 116 MB). Best on Wi-Fi. Stays on this device and works offline."). Below: *More choices*, *Needs a more powerful device* ("Needs a computer with a recent graphics card", "Try anyway" only when uncertain), *Not available on this copy of the app* (HEAD request found no file). Model name, licence, exact size, memory and source only under *About this option*.
- **The one question** (an option over the limit, chosen there): "Download Best quality? Large one-time download (about 488 MB). Best on Wi-Fi…", after a free-space check (`navigator.storage.estimate`; a refusal calls `LEPwa.reportQuotaError`). Answer remembered. The file streams into Cache Storage; `Cache.put` commits only a complete body, so cancel leaves nothing (clean restart next time). The storage manager lists it by its plain name.
- Screenshots: `/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/pro-models/out/` `1-desktop-gpu.png` … `6-old-gpu.png` and their `-panel.png` crops.

## Recommended defaults per device class

| Device | What the ladder offers | Default (pre-selected) |
|---|---|---|
| Phone, or any browser without WebGPU | Quick, Better (= More detail); People under More choices; large options folded | More detail where it runs well (status ok), otherwise Quick |
| Phone with WebGPU and fp16 | Same; large options folded with "Try anyway" (unverified on phones) | Same |
| Laptop / desktop with WebGPU fp16, reports < 8 GB | Quick, Better (= BiRefNet lite); Best folded or "May be slow" | More detail; BiRefNet lite once the person has downloaded it |
| Desktop / laptop with WebGPU fp16, 8 GB or more | Quick, Better (BiRefNet lite), Best (BiRefNet); BEN2 under More choices | More detail until a large one is on the device; then the best one that is |

The large options stay out of automatic downloads because they are over the policy's 60 MB limit. If the owner wants BiRefNet lite (109 MB + 7 MB engine) to be the automatic *Better* on capable computers, that is a one-number change to the limit or a `packs()` entry in `LE.downloads`, after real-GPU timings confirm a few seconds per photo.

## Risks

- **Unmeasured on real hardware.** GPU memory, speed, driver bugs in the WebGPU provider (fp16 numerics in shaders) are unknown. Test on: one Windows laptop with Intel iGPU, one with NVIDIA, an Apple Silicon Mac (Chrome and Safari 26), one recent Android phone.
- **Download size.** 116 MB, 488 MB (with the engine) and 230 MB. Consent and Wi-Fi wording are in place; CloudFront transfer cost is real.
- **Training-data licences** (above).
- **Failure modes** that remain: BiRefNet lite on dense object groups, BEN2 on crowds and objects, all models on transparent objects (untested).
- **Console noise.** On a copy without the files, the HEAD probe logs a 404 in the console.
- **Reproducibility.** A second, clean run of `build_pro.py` for BiRefNet lite produced a byte-identical file (same SHA-256), so the export is deterministic with the pinned tools (BiRefNet full was built once). A different torch/onnxslim version will produce different bytes: `fetch-models.js` then prints "DIFFERS" and the byte counts in `le-bgremove-pro.js` must be updated (the app checks the size after download).

## Files

`assets/js/le-bgremove-pro.js` (registry + support definitions + checks), `assets/vendor/ort-webgpu/`, `scripts/fetch-models.js` (`pro`), `scripts/models/` (`export_birefnet.py`, `birefnet_arch.py`, `to_fp16.py`, `build_pro.py`, `requirements.txt`), `assets/img/cutout/fine.jpg`, `best.jpg`, `hair.jpg`, `tests/cutout-pro.test.js`. Shared hunks: `le-bgremove.js` (large-download streaming, free space, `checkAsync`, runtime-aware engine size, `needF16`/`warmup`/`minmax` pass-through), `le-bgremove-worker.js` (asyncify loader, f16 check, optional warm-up, optional min-max), `le-studio-cutout.js` + `studio-cutout.css` (chooser), `scripts/deploy.sh`, `docs/DEPLOY.md`.
