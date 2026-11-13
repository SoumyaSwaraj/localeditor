# RAW develop and HDR merge (Expert step X5), as built

Effects: `docs/FX-REFERENCE.md` (pack `develop`). Research and measurements behind the decoders: `docs/research/raw-hdr.md`.
Tests: `tests/fx-develop.test.js` (plus `tests/raw.test.js`, `tests/hdr.test.js` for the decoders and the merge core).

## Files

| File | Loaded | Holds |
|---|---|---|
| `assets/js/raw/le-raw-studio.js` | with the studio page (about 6 KB, the only RAW code loaded up front) | takes RAW files from the photo chooser and canvas drops, the licence toast, commands `rawOpen`, `hdrMerge`, `rawLicence` |
| `assets/js/raw/le-raw-layer.js` | when a RAW file is opened or a document has a RAW/HDR layer | `LE.raw.open`, working copies, the float-source provider, settings, presets, auto tone, `LE.hdr.mergeFiles`, the HDR container |
| `assets/js/raw/raw-work-worker.js` | by the above | the working copy: orientation, highlight reconstruction, camera matrix, resampling, auto white balance, CA estimate, statistics |
| `assets/js/raw/hdr.js`, `hdr-worker.js` | by the above, for a merge | alignment, deghosting, radiance merge, exposure fusion (promoted from `labs/hdr/`) |
| `assets/js/raw/raw.js`, `raw-core.js`, `raw-worker.js`, `raw-develop.js` | by the above | decoders (S1), unchanged |
| `assets/js/fx/le-fx-develop.js` | with the renderer | the four effects, the CPU references, `LE.fx.sources` and the `LE.fx.layer` seam |

## Document model

```
layer.raw = {
  v: 1, kind: 'raw' | 'hdr',
  source: { asset, format, decoder: 'builtin'|'camera', name, bytes, stored }           // RAW: the original file (PNG-wrapped asset)
        | { asset, encoding: 'le-log16', space: 'camera'|'linear-srgb', stored },        // HDR: the merged radiance (16-bit log PNG asset)
  size: { w, h },                          // full-resolution, upright pixel size (document pixels of the develop stage)
  camera: { make, model, iso, exposureTime, fNumber, focalLength, lens },
  color: { colorMatrix1/2, forwardMatrix1/2, cameraCal1/2, analogBalance, illuminant1/2, asShotNeutral, asShotWhiteXY },   // camera -> XYZ data
  asShot: { temp, tint }, auto: { temp, tint }, baseline,                                // white points (K, Duv x 5000) and baseline exposure (EV)
  merge: { frames, mode, reference, deghost, align, evs[], exposureSource, shiftX[], shiftY[], rotation[] }               // HDR only
}
layer.src  = the default development as an 8-bit JPEG asset: what Simple mode without WebGL2, thumbnails and old builds show
layer.fx   = [ develop.basic, develop.detail, …anything else ]   // the develop settings are ordinary fx entries (plain data)
```

All of it is plain data and passes `LE.Scene.expertOf` (depth, key and size limits) and `.leproject` / `.ledesign.json` unchanged.
The develop entries run first on RAW/HDR layers, in a fixed order (see `docs/FX-REFERENCE.md`).

## Storage

- **Original RAW bytes**: a document asset whose blob is a PNG (a 512-pixel preview) with a private ancillary chunk `leRw` holding
  the file unchanged and a `tEXt` `le-raw` with `{ v, name, format, bytes }`. PNG decoders skip unknown ancillary chunks, so it hashes,
  stores, exports and imports like any photo with no change to the project format. `LE.raw.unwrap(blob)` returns the bytes. Limit:
  the project's 80 MB asset cap. A larger RAW is opened and edited from its working copy on this device; `source.stored` is false and
  the person is told the original is not kept in the design. **Proposal**: a per-type cap (e.g. 160 MB for this asset kind).
- **Working copy**: decoded once, upright, highlight-reconstructed, converted with the camera matrix to scene-linear Rec. 709 primaries,
  at most 4096 / 3072 / 2048 px long side (desktop / modern / older, `LE.device.tier()`). In memory (an LRU of 700 / 300 / 120 MB) and
  in Cache Storage `le-models-v1` as half floats, `x-le-model: raw-work`, trimmed to 1.5 GB / 600 / 250 MB. The storage manager shows
  it as "RAW working copies" (owner: this feature; size; delete), through `LEPwa.describeModel`. Rebuilt from the original when gone.
- **Previews** come from the working copy reduced to the preview size; while a control is dragged, half that.
- **Export** decodes the original again at full resolution when the export needs more pixels than the working copy (desktop up to
  48 MP, modern devices 24 MP, older devices use the working copy); the renderer tiles it.
- **HDR merge**: one PNG asset, 16-bit RGB, code = (log2 x + 20) / 36 x 65534 + 1 (0 = zero), Sub filter, deflate; `tEXt le-hdr`
  describes the encoding and whether the values are camera RGB (RAW brackets, re-developed with the reference frame's matrices) or
  linear sRGB (JPEG brackets). Precision 0.00055 EV over 36 stops; a 6 MP merge is about 20–30 MB. It is an ordinary image to every
  tool, so it round-trips through designs, `.leproject` and the open format by asset id with no format change.

## Opening a RAW

`LE.raw.open(file, { onPreview, onProgress, signal, demosaic })` → `{ layer, assets: { src, raw }, info }`:

1. `LE.raw.probe` — the embedded JPEG preview goes to `onPreview` at once (the studio places it while the decode runs, when it is
   at least 800 px).
2. Decode in a worker (built-in DNG reader, or the optional camera module for CR2, CR3, NEF, ARW, RAF, ORF, RW2, PEF, SRW, …;
   `LE.raw.formats()` lists 25 extensions). Half size when the file is at least twice the working size.
3. Working copy in `raw-work-worker.js`; auto white balance (grey world on near-neutral pixels, in camera space) and luminance
   statistics on the way.
4. Default development rendered by the renderer (or by the CPU reference of `develop.basic` without WebGL2) to the layer's JPEG.

The camera module download goes through `LE.downloads` (no extra question in the main flow) and `LE.support` (`raw.camera`, gated
with "Try anyway"); its licence line is shown once in the studio's toast with a "Licence and source" action, stays in the storage
manager entry "Camera RAW support", in `/licenses/#libraw`, and on any camera-RAW error ("Camera RAW support · licence").
Nothing under `assets/js/raw/` except the studio hook, and nothing under `assets/vendor/raw-decoder/`, is fetched before a RAW file
is opened (tested).

## HDR merge

`LE.hdr.mergeFiles(files, { mode: 'radiance'|'fusion', align, deghost: 'off'|'low'|'medium'|'high', reference, maxPixels, evs, signal, onProgress })`
→ `{ layer, assets: { src, hdr }, info }`. 2–9 frames, all RAW or all JPEG/PNG.

- RAW brackets are decoded to camera space (no white balance, raw clip level 1.0), so the clip test of the merge is exact; exposure
  from metadata (time, ISO, aperture), else estimated from the pictures (median ratio of well-exposed pixels).
- Alignment: Ward's median-threshold bitmaps, coarse to fine, with a rotation search of ±3° at about 320 px; the result is applied
  at the working size. **Handheld**: translation plus small rotation is what it does; beyond 3° or with perspective change (a step
  sideways) it fails — say so and suggest a tripod or the "fusion" mode with deghost high.
- Deghost: reference-frame consistency through a brightness transfer function (histogram matching), at ≤ 2 MP; levels map to
  thresholds 0.20 / 0.12 / 0.07 of display luminance. Moving things come from the reference frame alone.
- Runs in a worker, cancellable (`signal`), with progress. Memory: merged at up to 8 / 5 / 3 MP (desktop / modern / older): five
  24 MP frames at full size would need about 4.5 GB in JavaScript. The result keeps that size; export uses it.
- The new layer opens with `develop.tonemap` (local, strength 50) and `develop.basic` (Standard).

**Single-image HDR look**: `develop.tonemap` on a RAW layer (preset `hdr-look`).

## Agent surface

All through plain data; nothing needs a human gesture except picking files.

```js
await LE.lazy('/assets/js/raw/le-raw-layer.js'); await LE.rawLayer.ready();   // or LE.fxBoot.load() when a document already has one
const r = await LE.raw.open(file);                     // r.layer is a complete layer spec; r.assets.src / .raw hold the blobs
const s = LE.raw.settings.copy(layer);                 // { v, kind: 'develop-settings', fx: [...] }
const patch = LE.raw.settings.paste(layer, s, { whiteBalance: false });     // { fx } for scene.update(layer.id, patch)
LE.raw.presets.list(); LE.raw.presets.get('night-city').settings;
await LE.raw.autoTone(layer);                           // develop.basic values: exposure, highlights, shadows, whites, blacks
const h = await LE.hdr.mergeFiles(files, { deghost: 'medium' });
LE.fx.ops.apply(doc, { op: 'fx.update', layer: id, id: entryId, p: { exposure: 0.5 } });   // develop settings are ordinary entries
```

**In agent mode** these are wired (`assets/js/le-agent.js`, the "Expert effects" block): operations `raw.open` (`file`: a reference from `LEAgent.file(blob, name)`, a `data:` URI or a local path), `hdr.merge` (`files`), `raw.settings` (`preset`, `from` or `settings`), `raw.autoTone`, and `LEAgent.catalog("raw")`. They run on the batch like every other operation (one undo step). The lines below are the calls they make:

```js
// LEAgent.apply, ops 'raw.open' and 'hdr.merge' (files from the agent's file list), and 'raw.settings' / 'raw.autoTone':
function rawLib() { return LE.lazy('../assets/js/raw/le-raw-layer.js').then(function () { return LE.rawLayer.ready(); }); }
if (op.op === 'raw.open') return rawLib().then(function () { return LE.rawStudio.open([op.file], op.at); });            // -> [layerId]
if (op.op === 'hdr.merge') return rawLib().then(function () { return LE.rawStudio.mergeHdr(op.files, { deghost: op.deghost, mode: op.mode, align: op.align }); });
if (op.op === 'raw.settings') return rawLib().then(function () { var l = scene.layer(op.layer); var p = LE.raw.settings.paste(l, op.settings, op); scene.update(op.layer, p); return { ok: true }; });
if (op.op === 'raw.autoTone') return rawLib().then(function () { return LE.raw.autoTone(scene.layer(op.layer)); }).then(function (v) { /* then fx.update develop.basic with v */ return v; });
// LEAgent.catalog('raw'):
rawLib().then(function () { return { formats: LE.raw.formats(), presets: LE.raw.presets.list(), fields: 'docs/RAW-HDR.md#document-model', module: LE.raw.module }; });
```

`LE.fx.analyze({ scene, layer })` works on RAW layers as on any layer (it measures the developed picture).

## Seams in shared files (all small)

| File | Change |
|---|---|
| `assets/js/fx/le-fx.js` | `PACKS = ['basic', 'develop']` |
| `assets/js/le-fx-boot.js` | `has(l)` also true for `l.raw && l.raw.source`; `key(l)` includes `l.raw` |
| `assets/js/le-objects.js` | `expertAssets(l)` also scans `l.raw && l.raw.source` (so the RAW / HDR asset is kept by designs and the cleaner) |
| `studio/index.html` | one `<script>` for `le-raw-studio.js` after `le-studio.js` |
| `tools/dng-synth/dng-synth.js` | `writeDNG({ shutter: [n, d] })` writes the exposure time (for bracket tests) |
| `tests/fx.test.js` | the section list in the registry case now has every section of `docs/EXPERT-UI.md` (it lacked Detail) |

Not changed: `le-project.js`, `le-fx-gl.js`, `le-studio*.js`. The float-source provider is a registry in the pack
(`LE.fx.sources.register(kind, provider)`), and the pack wraps `LE.fx.layer`: for a RAW/HDR layer it develops the float data, then
hands the developed picture to the unchanged `LE.fx.layer` as the layer's photo (crop, legacy adjust and filters, retouch, cut-out,
the rest of the stack, masks). **Proposal (workspace)**: sort registrations inside a section by `ui.order`, as `docs/FX-AUTHORING.md`
says (`assets/js/expert/expert.js`, the `defs()` sort); today Develop is listed after the starter Light effects. Tried here; it changes
which effect `tests/expert-ui.test.js` finds first in the add-effect search, so it belongs with the workspace owner. **Proposal**: move that wrapper into `FX.layer` itself (about 25 lines) so other float sources (depth,
scans, a future HDR display path) use it without a pack.

## Limits, said plainly

- Masks on develop entries are evaluated on the uncropped photo (the develop stage runs before crop).
- The develop output is display-referred 8-bit-dithered before the rest of the stack (as any photo); scene-referred work belongs in
  the develop entries.
- Highlight reconstruction leaves faint mint or lilac casts at the edge of large clipped areas (better than clip-to-white on
  brightness, about equal on colour); see the test numbers.
- No lens-profile database (lensfun data is CC-BY-SA, outside the licence rule); DNG `WarpRectilinear` is parsed, not applied.
- Embedded DNG profiles (`ProfileHueSatMap`, look tables) are not applied; "Camera neutral" is our own curve on the camera matrix.
- Output gamut sRGB; a P3 export would need the gamut compression to target P3 (one constant).
- HDR merge in JavaScript at ≤ 8 MP; the GPU port of the merge (planned in the research) is not done.

## Focus stacking (proposal only)

Input: 2–30 frames at different focus distances, same exposure. Steps: (1) align with the HDR aligner extended to scale (focus
breathing changes magnification by up to a few percent; search scale 0.97–1.03 on the median-threshold bitmaps) and a homography
refined by sparse feature matching on a 1 MP copy; (2) per-frame sharpness = local Laplacian energy (5x5, on luminance), smoothed
with a guided filter (radius about 0.5 % of the long side) so the choice follows objects; (3) either a depth-map merge (argmax of
sharpness, with a small-scale consistency filter, keeps colours exact) or a Laplacian-pyramid merge with sharpness weights (no
seams, but halos at depth edges); offer both, depth-map by default; (4) store as an ordinary photo asset plus
`layer.raw = { kind: 'stack', frames, method }` with the depth index map as an asset (it doubles as a rough depth map for depth
masks). Memory as for HDR: at most 8 MP on desktop in JavaScript; a GPU version of steps 2–3 makes full size possible. Licence: all
from public papers (Pertuz et al. 2013 on focus measures; Burt-Adelson pyramids).
