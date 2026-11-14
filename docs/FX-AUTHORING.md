# Writing an effect (`LE.fx`)

The contract for step X0a of `docs/EXPERT-MODE.md`, as built. Feature teams (X1–X6) add effects with it, the workspace (`assets/js/expert/`) builds its controls from it, and the agent reference is generated from it. Where this file and `docs/EXPERT-MODE.md` disagree, this file is right; the differences are listed at the end.

## Files and loading

| File | Loaded | Holds |
|---|---|---|
| `assets/js/le-fx-boot.js` | with the studio (about 2 KB) | `LE.fxBoot`: detects expert data, loads the rest, redraws |
| `assets/js/fx/le-fx.js` | on demand | registry, validation, `LE.fx.ops`, quad maths, the open-format reader (`LE.fx.design`), the loader |
| `assets/js/fx/curves.js` | by `le-fx.js`, and by the workspace | `LE.curves`: the one monotone spline (`clean`, `monotone`, `sample`, `lut`, presets). The curve editor draws with it and the renderer samples it |
| `assets/js/fx/le-fx-gl.js` | by `le-fx.js` | WebGL2 renderer, pass builder, masks, tiling, colour management, the scene hooks |
| `assets/js/fx/le-fx-basic.js` | by `le-fx.js` | the starter effects |
| `assets/js/fx/le-fx-analyze.js` | first `LE.fx.analyze` call (or at load when an effect declares `needs: ['stats']`) | image statistics |
| `assets/js/fx/le-fx-<pack>.js` | by `le-fx.js` | your effects: add the pack name to `PACKS` at the top of `le-fx.js` |

```js
LE.fxBoot.load().then(function (fx) { /* LE.fx is ready: renderer and every pack are in */ });
LE.fxBoot.needs(layerOrDoc)   // true when it carries expert data
```

The simple studio never fetches anything under `assets/js/fx/`. The folder is excluded from the precache (`ON_DEMAND` in `scripts/build.js`); the worker stores each file in the app cache the first time it is fetched, so the renderer works offline after its first use and not before.

## Document model (as built)

```
layer.fx = [ { id, type, on: true, amount: 1, blend: 'normal', mask: <mask|null>, p: { … } } ]   // any layer type, groups, adjustment layers
{ type: 'adjust', fx: [...], layerMask, clip: false, x, y, w, h, opacity, visible, … }            // adjustment layer; covers the page when no box is given; scene.add() makes one
layer.layerMask = { on: true, invert: false, parts: [ { kind, mode, invert, feather, density, blur, …kind fields } ] }   // the layer mask (see "Masks")
layer.transform = { quad: [[x,y],[x,y],[x,y],[x,y]] }                                           // TL, TR, BR, BL in page units; photo layers
layer.retouch  = { asset, version }                                                          // reserved: a baked-overlay cache only. Strokes, spots and meshes live in effect parameters of type `data`
layer.maps     = { depth: { asset, model, version }, normals: {…}, face: [packed faces], segments: { asset, clothes: { asset }, model, version } }
layer.raw      = { profile, wb: { temp, tint }, exposure, … }                                   // kept as data until the RAW step
layer.clip     = true | 'knockout'                                                               // ordinary layers (not groups): see "Clipped layers"
```

- Entry `blend`: `normal multiply screen overlay soft-light hard-light darken lighten difference color luminosity`.
- Limits enforced by the sanitisers: 32 entries per stack, 8 mask parts, 48 parameters per effect (48 keys per object), 512 values per list (64 points per curve after schema validation), strings 120 characters (12,000 inside `maps`, for packed face landmarks). A parameter may also be one flat list of up to 4,096 numbers (type `data`); a layer holds 16,384 of those in all, and a list that does not fit is left out whole. Everything counts toward the 12 MB limit on a design's JSON. Keys `__proto__`, `constructor`, `prototype` are dropped everywhere; a `.leproject` or `.ledesign.json` that contains them is refused as a whole.
- Coordinates inside masks and parameters of type `point` are fractions of the layer box. Lengths (`unit: 'px'`) are document pixels; multiply by `g.scale` (or call `g.px(v)`) to get target pixels. When a design is resized with its content, every `unit: 'px'` parameter and every mask `blur` is multiplied by the same factor, clamped to its range (`LE.fx.rescale(layer, k)`, called from the studio's `scaleLayer`).
- **Two-level validation.** `LE.Scene` (`normalize`, `update`) and `LE.project` (always loaded) check the *shape* of expert data with `LE.Scene.expertOf`: types, sizes, forbidden keys, finite numbers. The registry (loaded on demand) checks each entry against its effect's schema before anything runs (`LE.fx.resolve`): unknown parameters are dropped, out-of-range values clamped, wrong types replaced by the default, and an entry whose `type` is not registered is **kept in the document and never executed**, so a file made by a newer build survives an older one. `LE.fx.problems(doc)` lists what was skipped or changed. `LE.fx.ops` and the open-format reader apply the schema when they write.
- **The quad** is stored in page units as it was when it was set, with the layer box (`x y w h`) equal to its bounding box. The renderer uses the quad's *shape* inside the box, so moving, resizing, rotating or flipping the layer with the ordinary handles carries the distortion along. `LE.fx.quad.corners(layer)` gives the corners where they are now. Selection and hit-testing use the bounding box; corner handles are for the workspace or X3 to add.

### Masks

The same shape for the layer mask (`layer.layerMask`) and for one effect (`fx[i].mask`): `{ on: true, invert: false, parts: [...] }`. `on: false` switches the mask off without losing it; `invert` flips the combined result. No parts means "everything".

The numbers follow the workspace's CPU reference, `LE.expert.evalMask` (`assets/js/expert/controls/mask.js`); `tests/fx.test.js` compares the shader with it part by part. Parts are combined in order, starting from nothing: `add` → `max(m, v)`, `subtract` → `m·(1 − v)`, `intersect` → `m·v` (a first part that intersects sets the mask). Before combining, a part's value is inverted if `invert` is set and multiplied by `density`. `feather`, `density`, `soft`, `range`, `min`, `max` are 0–1; `h` is degrees.

| kind | fields | value |
|---|---|---|
| `linear` | `x0, y0, x1, y1`, `feather` | 1 at the first point falling to 0 at the second; `feather` 0 is a straight ramp, 1 an eased one |
| `radial` | `cx, cy, rx, ry, rotation`, `feather` | 1 inside, 0 outside the ellipse (in box fractions); `feather` is the soft part of the radius |
| `luma` | `min, max, soft` | display-referred Rec. 709 luminance between `min` and `max`, with `soft` shoulders |
| `color` | `h`, `s`, `l`, `range`, `soft` | distance in hue (weighted by saturation), saturation and lightness within `range` |
| `asset` | `asset` (image id, stretched over the layer box) | alpha × brightness, so white-on-transparent and white-on-black both work |
| `subject` | none | the layer's cut-out mask (`layer.cutout.asset`), also when the cut-out is switched off. Read as the simple studio reads it: the mask image's alpha when it has transparency, else its luminance |
| `segment` | `class`: `person`, `hair`, `skin`, `clothes`, `background` | `layer.maps.segments` (`{ asset, clothes: { asset } }`, written by `LE.maps`): the asset's red, green and blue are person, hair and skin, the clothes asset is grey; background is what is not a person |
| `depth` | `near, far, soft` (0 = nearest, 1 = farthest) | from `layer.maps.depth.asset`: 16-bit depth packed in an RGBA image, red the high byte and green the low byte, near = 1 (`docs/research/depth-face-maps.md`) |
| `face` | `part`: `skin eyes lips teeth brows under-eyes` | from `layer.maps.face` (one packed face, a list, or `{ faces }`), drawn by `LE.maps.faceMask(face, part, w, h)` |

- `feather` shapes `linear` and `radial` only (default 0.25). Every part also takes **`blur`** (document pixels, 0–500, default 0), which softens it; that field is this renderer's addition and the reference ignores it.
- `subject`, `depth` and `face` read images aligned with the *source photo*; the renderer maps them through the layer's crop and quad (the reference stretches the cut-out over the box, which is the same when the photo is not cropped).
- A `subject`, `depth` or `face` part whose map is missing selects everything, as the reference does, and `LE.fx.problems` reports it. An `asset` part whose image is missing is skipped. `face` needs `LE.maps` (`labs/maps/maps.js` until it is promoted); normals are derived, never stored.
- Brush masks: one asset per mask, painted in place, is the supported form: call `LE.fx.touch(canvas)` after each stroke so the texture and the cached stages follow. One asset per stroke also draws, but a mask holds at most 8 parts.

## Render order (as built)

**Photo layer** (a cached bitmap, the same cache `LE.Scene` already keeps per layer): source → fit to the preview or export size → crop, legacy `adjust`/`filter`/`removeBg` and the **cut-out** (the existing CPU code, unchanged) → *`LE.fx` from here* → perspective quad → `fx` stack (entries without `alpha` or `scene` in `needs`) → frame clip (`mask` shape, `maskPath`, `radius`) and `layerMask` → cut-out outline → silhouette entries → the layer's own shadow, border, opacity and blend, as before.

**The cut-out comes first.** A layer with `fx` hands the stack a premultiplied picture that has already been cut out, so a blur softens the subject's edge and never mixes removed background back in, and silhouette effects read the alpha left after cut-out and masks. A layer without expert data takes the old path, bit for bit. The `subject` mask kind still reads the cut-out mask itself (also when the cut-out is switched off), aligned through crop and quad.

The CPU part is kept per layer while its inputs do not change, so dragging an effect control does not redo crop and filters; spatial stage outputs are kept on the GPU keyed by a hash of their inputs.

**At draw time**, on the pixels the compositor has produced so far and at the resolution being drawn (screen or export): other layer types with `fx` or `layerMask`, groups with `fx` (their members are drawn together where the first member sits), entries that need the `scene`, and adjustment layers (`clip: true` applies to the layer directly below only).

Draw-time results are kept between redraws in preview: an adjustment layer or a layer with scene-reading effects is rendered again only when something beneath it, its stack, the view transform or the registry changes. The key is built from the content beneath (each layer's data, long lists by hash, and the identity of its bitmaps) and the stack; the cache takes at most an eighth of the memory budget (96 MB at most, 12 results) and is emptied by `LE.fx.trim()`. Exports never use it.

`LE.Scene.exportLayer` draws a non-photo layer with its effects and its layer mask (`LE.fx.local`): the layer alone on a transparent ground, the result cut at its box. Entries that read the `scene` are left out there, because the layer is exported without one.

**Clipped layers.** `clip: true` on an ordinary layer draws it only inside the layer below it; several clipped layers in a row share that one base (the first layer below that is not itself clipped), each blended onto it with its own blend mode and opacity, and each reads the base as its scene (`g.scene()`), so `blend-options` on a clipped layer blends against its base. `clip: 'knockout'` cuts the layer's shape (times its opacity) out of the base instead of drawing it. The base's alpha is what it draws without its drop shadow, effects included. Clipped adjustment layers sit in the same chain. A hidden base hides its clipped layers; a clipped layer with nothing below it, or whose base is being edited or sits in a group with effects, is drawn as an ordinary layer; groups never clip. The field is sanitised in `LE.Scene.expertOf` (anything but `true` or `'knockout'` is dropped), kept by `.leproject` and written and read by the open format (`"clip": true | "knockout"`, schema `design-1.json`). A document that has one loads the renderer like any other expert data; a clipped photo layer's own bitmap takes the ordinary path.

Not done at draw time: `transform.quad` on non-photo layers.

## Registering an effect

```js
(window.LE_FX_DEFS = window.LE_FX_DEFS || []).push({      // or LE.fx.register(def) once le-fx.js is loaded
  id: 'bloom', name: 'Bloom', group: 'effects', version: 1,
  space: 'linear',                    // 'linear' | 'display' | 'oklab': the space g.source is handed over in and expected back in (oklab: colour operations only)
  needs: [],                          // 'alpha' 'scene' 'below' 'depth' 'normals' 'face' 'stats'
  params: { threshold: { type: 'number', min: 0, max: 4, default: 1, step: 0.01, label: 'Threshold' } },
  radius: function (p, scale, box) { return 0; },   // target pixels of neighbourhood read; drives tile overlap. box: { w, h } of the layer in document pixels
  grow: function (p, scale, box) { return 0; },     // optional: target pixels the result extends beyond the layer box
  draft: function (p) { return p; },             // optional: cheaper parameters while a control is dragged
  passes: function (g, p) { /* build passes and return the result handle, or call only g.color() */ },
  cpu: null,                                     // optional: function (imageData, p, info) for devices without WebGL2
  support: { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 200 },
  ui: { section: 'Effects', order: 50, controls: [ { param: 'threshold', control: 'slider' } ] },
  agent: { summary: 'Soft glow around bright areas.', tips: ['…'], example: { type: 'bloom', p: { threshold: 1.2 } } }
});
```

Rules:

- `id` matches `^[a-z][a-z0-9-]{1,39}$`. A second registration with the same id replaces the first unless its `version` is lower. Bump `version` whenever the pixels change: it is part of every cache key.
- `passes` is a pure function of `(g, p)`: no globals, no clocks, no `Math.random`. It either calls `g.color()` (one or more times) and returns nothing, or builds passes and returns a handle. Mixing the two throws.
- An effect with `alpha`, `scene` or `below` in `needs` is a **silhouette effect**: it runs after the cut-out and the layer mask whatever its position in the stack, and may declare `grow`. With `scene` or `below` it runs when the page is composed (draw time), also on photo layers.
- **Fill against opacity.** In the silhouette stage `g.subject()` is the layer's own pixels and `g.source` is what the styles before this entry have made of them. `blend-options` uses the two to apply `fill` to the pixels only (it takes `(1 − fill)` of the subject out of the styled picture), so shadows, glows and inner shadows keep their strength while the layer fades; layer opacity fades everything. This holds where styles are draw-time work (text, shapes, groups). A photo layer's silhouette effects are part of its cached bitmap, so there fill still fades them with the picture.
- `radius` and `grow` receive target pixels per document pixel and the layer box in document pixels (`box.w`, `box.h`), so an effect whose data is stored in fractions of the box can state its reach exactly: `Math.ceil(p.r * Math.max(box.w, box.h) * scale)`. Use `LE.fx.math.blurReach(sigmaInTargetPixels)` for anything built on `g.blur`.
- An effect has at most 48 parameters. Records that do not fit a fixed set of parameters (strokes, spots, mesh points) go in one parameter of type `data`.
- `aliases: ['old-id']` names earlier effect ids this registration replaces (same parameter names). An entry of such a type is read as this effect and written back under the new id by validation; the old id is not listed or described. `selective-color` replaces `selective-color-tones` this way.
- `radius` and `grow` should take lengths the layer box implies from their `box` argument; a parameter that used to carry such a length (`cast-shadow.height`, `floating-shadow.width`, `mesh-warp.size`) defaults to 0, meaning "from the box".
- `cpu(imageData, p, { scale, box, width, height })` changes 8-bit display-referred pixels in place. Give one only where it is a table lookup or as simple; masks and blends are not applied on that path.
- Each registration is also declared to `LE.support` as `fx.<id>` (E7).

### Parameter types

| type | value | schema fields |
|---|---|---|
| `number` | finite number | `min, max, default, step, unit` (`'px'` = document pixels, `'ev'`, `'%'`, `'deg'`, `'K'`), `label`, `help` |
| `bool` | `true`/`false` | `default` |
| `choice` | one of `options` | `options: ['a', 'b']` or `[{ value, label }]`, `default` |
| `color` | `'#rrggbb'` or `'#rrggbbaa'` | `default`, `alpha: true` to allow the 8-digit form |
| `point` | `{ x, y }` fractions of the layer box (−1…2 unless the schema gives `min`/`max`); `[x, y]` is accepted | `default`, `min`, `max` |
| `angle` | degrees, −360…360 | `default` |
| `curve` | `{ master, r, g, b }`, each 2–64 control points `[[x, y], …]` in 0–1; a bare list means `master` | `default` |
| `wheel` | `{ h: 0–360, a: 0–1, l: −1…1 }` (`amount` is accepted for `a`) | `default` |
| `bands` | 8 × `{ h, s, l }` in the schema range (red, orange, yellow, green, aqua, blue, purple, magenta) | `min, max` (default −100…100), `default` |
| `lut` | asset id or `null` (a data asset: see "Data assets") | — |
| `data` | a flat list of numbers, at most `max` long (4,096 at most), each inside `range` and a multiple of `step` | `max` (default 1024), `range: [lo, hi]` (default `[0, 1]`), `step` (default 0.0001), `legacy` |
| `seed` | integer 0…2147483647 | `default` |

`LE.fx.validate(entry)` → `{ ok, entry, warnings: [{ path, code, message }], errors: [...] }`; `entry` is a clean copy with every parameter present. Codes: `unknown-type`, `bad-entry`, `clamped`, `bad-value`, `unknown-key`, `forbidden-key`, `unknown-kind`.
`LE.fx.defaults(id)` → a full `p`. `LE.fx.list()` → ids. `LE.fx.get(id)` → the definition.

**`data` parameters** hold what a brush or a mesh produces. The effect decides what the numbers mean (records, counts, coordinates as fractions of the box) and must cope with a list cut short. Rules: numbers only; replace the list, never change it in place (its content hash is computed once per list object and stands in for it in every cache key, `LE.fx.keyOf`); write values already rounded to `step` so validation hands the same object back. `legacy: { prefix: 'd', params: 8 }` makes the registry read the first retouch pack's encoding (values as the y of the points of hidden curve parameters `d0`…`d7`, the first value the count / 10,000) into this parameter when it is absent, so documents made then still open; a `data` parameter that is handed one such curve object reads it the same way.

**Describing effects.** The registry can hold more than a hundred effects, so there is no call that returns everything to an agent at once:

| Call | Returns |
|---|---|
| `LE.fx.describe()` | the index: `[{ id, name, group, section, summary }]`, about 200 characters an effect (`summary` is the first sentence of `agent.summary`, 140 characters at most) |
| `LE.fx.describe(id)` | one registration in full: `{ id, name, group, version, space, needs, spatial, params, ui, agent, support, cpu }`, or `null` |
| `LE.fx.describe({ group })`, `({ section })`, `({ ids: [...] })` | the full registrations that match |
| `LE.fx.defs()` | every full registration, for the workspace's panels. Not for agents |
| `LE.fx.schema()` | blends, parameter types, mask kinds with ranges, face parts, limits, sections, working spaces and the actions |
| `LE.fx.version()` | a counter that moves when the registry changes |

All of these return frozen objects that are shared between calls: compare `LE.fx.version()` to know whether to read again, and never write into what they return. Tests cap the index (60,000 characters, 260 an effect) and any one registration (12,000 characters) rather than the total. `LE.fx.build` is the renderer's own version number (part of cache stamps). A parameter's own `ui` hints, such as `gradient`, `hidden` or `channels: false` on a curve, are passed through.

A channel mixer is nine `number` parameters with a `mixer` ui control; there is no matrix type. Numbers are clamped to the schema; the workspace keeps them to a hundredth of `step`.

### `ui` descriptor (consumed by `assets/js/expert/`)

The grammar is the workspace's (`docs/EXPERT-UI.md`); the registry passes `ui` through untouched. Its fixed words live in one place, `LE.fx.UI = { sections, controls, composite, spaces }`, which the registry tests read; nothing else keeps a copy. `ui.section` is one of `LE.fx.UI.sections` (`Light`, `Colour`, `Curves`, `Colour mixer`, `Colour grading`, `Detail`, `Optics`, `Geometry`, `Effects`, `Shadows & reflections`, `Compositing`, `Retouch`; the layer mask has its own section). `ui.order` sorts effects inside a section. `ui.controls` is optional; without it every parameter gets its default control in declaration order. A pack that brings its own control to the workspace (`LE.expert.controls.register`) declares its name first with `LE.fx.declareControl('face-rig')`. A curve parameter with `ui: { channels: false }` is drawn as one curve without channel tabs.

### Actions

A button in a panel (Auto, pick a neutral, import or export a file) is an **action**: declared in `ui.controls` by name, implemented in the registry. Documents never carry code, and an action never touches the document: it is a pure function that answers with data, which the caller applies as ordinary operations in one undo step.

```js
ui: { section: 'Light', controls: ['inBlack', 'inWhite', { action: 'grade.auto', label: 'Auto tone and balance' }] }

LE.fx.actions.register({
  id: 'grade.auto',                // ^[a-z][a-z0-9.-]{1,39}$
  label: 'Auto', summary: 'White balance and tone from the picture\'s own statistics.',
  kind: 'apply',                   // 'apply' (default) | 'pick' (the person clicks a point first) | 'import' (a file is read first) | 'export'
  needs: ['stats'],                // the caller runs LE.fx.analyze on the layer and passes ctx.stats
  accept: '.cube,text/plain',      // for kind 'import'
  run: function (ctx) { return { fx: [{ type: 'levels', p: { inBlack: 0.02 } }], message: 'Set the black point.' }; }
});
```

`ctx` is `{ layer, entry, stack, stats?, pick?: { display: [r, g, b], linear: [r, g, b] }, text?, file?, name? }`, all plain data. `run` returns (or resolves to) any of: `p` (merged into `ctx.entry`), `fx: [...]` (each entry updates the first of its type on the layer, or is added), `ops: [...]` (`LE.fx.ops` operations, `layer` filled in), `download: { name, text | blob, type }`, `message`. `LE.fx.actions.run(id, ctx)` → a promise of `{ ok, ops, download, message }`; nothing is applied by the registry. `LE.fx.actions.list()` and `schema().actions` list them as plain data for agents (`LEAgent.catalog("fx", "actions")`).

### Data assets

A parameter of type `lut` holds the id of a **data asset**: a non-image file stored with the project (`LE.project.putAsset({ blob, name, type: 'text/plain' })` → `{ id }`, the id is the content hash). `LE.Scene.addAsset` keeps a blob whose type is not `image/*` as it is and never decodes it as a picture.

- In an effect: `g.asset(id)` → `{ id, text, bytes }`, or `null` while it loads (the renderer draws again when it arrives; `LE.fx.prepare` loads them before an export starts). Parse and cache in the pack, keyed by `id`. `LE.fx.data.put(id, text)` hands one over directly; `LE.fx.touch()` asks for a redraw after a pack has loaded something itself.
- `.leproject` carries data assets the pages refer to under `data/<id>.bin`, listed in `project.data` (`{ id, type, name, bytes }`, 32 files of 16 MB at most), checked against their hash on reading.
- `.ledesign.json` with embedded images writes each as a `data:text/plain;base64,…` URI in place of the id (4 MB at most each); reading accepts such a URI only in a `lut` parameter and only as `text/plain` or `application/octet-stream`, stores it, and puts the id back. Anything else is left out with a `bad-data` note.

The workspace calls `LE.fx.interactive(true)` at pointer-down of any control gesture and `LE.fx.interactive(false)` at pointer-up, and writes through the normal scene update path (`scene.update(id, { fx: [...] }, { coalesce })`). A change of `fx`, `layerMask`, `transform`, `retouch`, `maps` or `raw` redraws the layer; there is no extra hook to call.

## The pass builder (`g`)

Every image handle is premultiplied RGBA in the effect's declared `space`, in a half-float texture when the device has them (`g.float`), 8-bit otherwise (sRGB-encoded storage for linear images, dithered).

| Member | Meaning |
|---|---|
| `g.source` | the input image handle |
| `g.width`, `g.height` | size of the working rectangle in target pixels (a tile plus its overlap) |
| `g.scale` | target pixels per document pixel (`g.scaleXY` when the layer is stretched) |
| `g.px(v)` | document pixels → target pixels |
| `g.box` | `{ w, h }` of the layer box in document pixels; `g.origin` is the working rectangle's top-left in the same units |
| `g.draft` | `true` while a control is being dragged |
| `g.float` | half-float targets are in use |
| `g.pass(frag, uniforms, opts)` | runs a fragment shader, returns a handle. `opts.scale` (default 1) sizes the target relative to the working rectangle, `opts.target` renders into an existing handle |
| `g.color(glsl, uniforms)` | records a per-pixel colour operation; consecutive ones across effects compile into **one** pass |
| `g.blur(radius, opts)` | Gaussian blur of `opts.source` (default `g.source`); `radius` is the standard deviation in document pixels; `opts.edge` `'clamp'` (default) or `'transparent'` |
| `g.downsample(handle, levels)` | array of half-size handles (box filtered) |
| `g.upsample(handle, scale)` | tent-filtered handle at `scale` of the working rectangle (default 1) |
| `g.lut1d(data, channels)` | lookup texture handle from a `Float32Array` (`channels` 1, 3 or 4; 2–4096 entries); sample with `lut1($name, x)` or `lut1rgb($name, rgb)` |
| `g.curve(points)` | a 1024-entry `lut1d` through control points (monotone cubic, `LE.fx.math.curveLUT`) |
| `g.lut3d(data, size)` | 3D lookup texture (`size³ × 3` floats, size 2–65); sample with `lut3($name, rgb)` |
| `g.mask(maskDef)` | the mask as a handle (value in every channel) |
| `g.alpha()` | the layer's alpha as a handle (after cut-out and mask in the silhouette stage) |
| `g.asset(id)` | a data asset: `{ id, text, bytes }`, or `null` until it has loaded |
| `g.whole({ maxSide: 512 })` or `({ scale })` | the whole picture as it enters this effect, small (8-bit, display-referred, premultiplied), **the same for every tile**; sample it with `boxUV()`. In the silhouette stage it is the layer as it enters that stage (after cut-out, frame and layer mask, before any silhouette entry), so `.a` is the whole silhouette: a cast shadow or a ray can read it however long its reach. Float sources answer too |
| `g.gamut` | `'srgb'` or `'display-p3'`: the gamut this render is for (see "Float sources") |
| `g.far({ maxSide: 512 }, function (w) { … return handle; })` | builds passes over the **whole layer box** instead of the working rectangle: `w` is a builder like `g` (`w.pass`, `w.blur`, `w.downsample`, `w.scale`, `w.width` …) whose target is the box reduced to `maxSide` and whose `w.source` is `g.whole()` at that size in the effect's space. The handle it returns is the same for every tile; sample it with `boxUV()`. For rays, streaks and flares, whose `radius()` then need not cover the distance. `null` when there is no whole picture |
| `g.subject()` | silhouette stage only: the layer as it entered the stage, at working resolution (premultiplied; its `space` is on the handle). Read `.a` for the silhouette. Later silhouette entries do not change it, so a reflection does not cast a shadow and their order stops mattering. `null` before that stage |
| `g.map(kind, { part })` | a map of the layer as a handle over the working rectangle, full precision, computed once per run: `'depth'` (`r` = stored depth, near 1, edge-extended), `'subject'` (`r` = the cut-out), `'face'` (`r` = the area `part`), `'segments'` (`r` person, `g` hair, `b` skin, `a` clothes). `handle.missing` is `true` when the layer has no such map; the handle is then constant (depth 0, the others 1) and no warning is raised. With `{ whole: true, maxSide: 512 }` the handle covers the whole layer box instead (sample it with `boxUV()`), the same for every tile: for following a map further than a tile reaches (a long relight shadow) |
| `g.scene()` | what is behind the layer, aligned with the working rectangle; `null` unless the effect declares `scene` |
| `g.below()` | the layer directly below this one, drawn alone (premultiplied, display-referred, aligned with the working rectangle): `.a` its alpha, `.rgb` its colour. `null` unless the effect declares `below` in `needs` and such a layer exists. Like `scene`, `below` makes the effect run at draw time |
| `g.stats()` | whole-image statistics of the input (`needs: ['stats']`), the same object `LE.fx.analyze` returns, measured once on a ≤ 256-pixel copy run through the entries before yours |
| `g.rgb(color)` | `[r, g, b, a]` of a `color` parameter in the effect's space, not premultiplied |
| `g.release(handle)` | gives an intermediate back to the pool early (optional; everything is released when the stack ends) |

### Fragment shaders for `g.pass`

Write a GLSL ES 3.00 snippet that defines `vec4 fx()`. The renderer adds the header, `main`, dithering for 8-bit targets and these names:

```glsl
in vec2 v_uv;                 // 0–1 across the target
uniform sampler2D u_src;      // g.source unless you pass { u_src: handle }
uniform vec2 u_res, u_texel;  // target size in pixels and its inverse
uniform vec2 u_scale;         // target pixels per document pixel
uniform vec2 u_origin, u_box; // document-space origin of the target, and the layer box size
uniform vec4 u_img;           // where the image is inside the target, in uv (x0, y0, x1, y1)
vec2 docPos();                // this pixel's position in the layer box, document pixels (tile-independent)
vec2 boxUV();                 // the same as a 0–1 fraction of the layer box
vec2 docToUV(vec2 d);         // a document-space offset as a uv offset (follows rotation and flips at draw time)
vec4 src(vec2 uv);            // texture(u_src, uv)
float insideImg(vec2 uv);     // 1 inside the image, 0 in the extended border
float luma(vec3 c);           // Rec. 709 luminance
vec3 toLinear(vec3 c); vec3 toDisplay(vec3 c);   // sRGB transfer, extended above 1 and below 0
vec3 unpremul(vec4 c);
float hash21(vec2 p); float docNoise(vec2 cell, float seed);   // integer hashes: the same on every GPU
float lut1(sampler2D t, float x); vec3 lut1rgb(sampler2D t, vec3 c); vec3 lut3(mediump sampler3D t, vec3 c);
```

Uniform values: numbers, arrays (vectors, `float[]`, row-major `mat3`), booleans, image handles and LUT handles. Anything positional must use `docPos()`, `boxUV()` or `docToUV()`, never raw `v_uv` offsets in pixels or `gl_FragCoord`, or tiles and rotated layers will not line up.

### Colour operations for `g.color`

```js
passes: function (g, p) {
  g.color('uniform float $k; vec3 $fx(vec3 c){ return c * $k; }', { k: Math.pow(2, p.ev) });
}
```

`c` is not premultiplied and is in the effect's `space`. `$` is replaced by a unique prefix, so write every uniform and helper with it; the function must be called `$fx`. The header names above are available (`docPos()` makes grain and vignettes mergeable too). Uniform values change without a recompile: a shader is compiled once per *sequence of effect types, blends and masks*. The renderer converts between `linear` and `display` inside the same pass, folds each entry's `amount`, `blend` and `mask` in, and, when the run is last, writes straight to the output with dithering. A stack of colour effects is therefore one pass, whatever its length.

**Working spaces.** A colour operation runs in the effect's `space`, or in its own: `g.color(glsl, uniforms, { space: 'oklab' })`. In `'oklab'` the `vec3 c` it receives is Oklab (`c.x` lightness, `c.yz` the a and b axes) and it returns Oklab. Consecutive operations in the same space, from one effect or from neighbours in the stack, share the conversion: three Oklab effects in a row convert in once and out once. `g.rgb(color, 'oklab')` converts a colour parameter. These helpers are in every shader; packs do not carry their own copies:

| GLSL | Does |
|---|---|
| `fx_linear(c)`, `fx_display(c)` | sRGB transfer, display → linear and back |
| `fx_luma(c)` | Rec. 709 luminance of a linear colour |
| `fx_oklab(lin)`, `fx_oklab_inv(lab)` | linear sRGB ↔ Oklab |
| `fx_oklch(lab)`, `fx_oklch_inv(lch)` | Oklab ↔ (L, C, h in radians) |

The same in JavaScript: `LE.fx.math.oklab(lin)`, `LE.fx.math.oklabInv(lab)`, `srgbToLinear`, `linearToSrgb`. An effect declared `space: 'oklab'` is for colour operations; if it builds passes, `g.source` is linear.

## Tiles, previews and determinism

- The image is processed in tiles (one when it fits in the memory budget and the texture limit). Each tile is extended by the sum of `radius(p, scale)` over the stack plus the reach of mask feathers. Declare the truth: too small shows seams, too large wastes time. Tile rectangles sit on a 64-pixel grid (256 for very wide blurs) so pyramid levels line up between tiles.
- Outside the image, `g.source` is edge-extended (`edge: 'transparent'` on `g.blur` for the other behaviour). In the silhouette stage the outside is transparent.
- **Limits, so that no parameter can run away.** When the whole picture fits in one rectangle (most previews) any radius is exact, because beyond the picture everything is its extended edge. When it has to be tiled, a tile can carry a reach of about 1,200 pixels on a `high` device, 740 on `mid` and 410 on `low` (a Gaussian of roughly 270, 180 and 95 pixels standard deviation at export scale); a wider stack is clamped with a console note and can show soft seams. A result may extend beyond the layer box by at most 2,048 pixels, twice the picture's longer side and six times its area. A render whose rectangles add up to more than 480 MP (240 on `mid`, 120 on `low`; a sixth of that for previews) is done at half resolution, repeatedly if needed, with a console note.
- Procedural detail (grain, textures) must be a function of `docPos()` and a `seed` parameter. Preview and export then show the same pattern at different sampling densities.
- `LE.fx.interactive(true)`: stacks with spatial or silhouette effects render at half resolution, `g.draft` is set and `draft(p)` is applied. `LE.fx.interactive(false)` refines. Listeners (`LE.fx.on`) hear `draft`, `refine`, `lost`, `restored`.
- Colour: 8-bit sRGB in, linear or display-referred floating point inside, 8-bit out with ordered dithering. `LE.fx.apply(canvas, { colorSpace: 'display-p3' })` returns a Display-P3 canvas where the browser supports it; the studio's compositor is sRGB, so the scene path stays sRGB.
- A lost WebGL context: renders fall back to the picture without GPU effects, `LE.fx.stamp()` changes, and scenes redraw with effects when the context returns.

**Effects that reach far.** A tile carries a border as wide as the stack's reach, up to what the device can hold; beyond that the reach is clamped (with a note) and tiles could show seams. An effect that needs the far side of the picture (a blur wider than a few hundred pixels at export size, a flare, a glow from the whole frame) should not read it from the tile: ask for `g.whole()`, a reduced copy of the entire input rendered once through the entries before this one and handed identically to every tile, and build the wide part from that, with `g.far()` when it takes passes of its own. `sun-rays` and `anamorphic-streaks` (built with `g.far`), `cast-shadow` (projects `g.whole().a`) and `relight` (long shadows on `g.map('depth', { whole: true })`) work this way and declare only their blur as reach. At draw time (shapes, text, groups, adjustment layers) the whole picture is the layer box as far as the drawn region shows it. `gaussian-blur` itself still reads its tile, so radii beyond the clamp are approximate at very large export sizes.

**One rectangle.** A picture that fits one working rectangle is not tiled: its border is the smallest of the stack's reach, twice the grid, and the picture's own longer side. The grid itself (64 pixels, or 256 for stacks that read further than 400) stays at 64 for pictures under 768 pixels, which are never cut into many tiles. Outside a picture there is only its extended edge, which the texture's edge clamp continues, so a 64-pixel picture under a stack that reads thousands of pixels is worked on in 512 pixels, not 1,280.

**Shared blurs.** Inside one run, `g.blur` of the same input at the same radius is computed once, and blurs of the same input at different radii share their downsampling chain, whichever effects of the stack ask. Results are identified by the input handle and how often it was written, kept within a tenth of the memory budget, and released with the run. Nothing to do in an effect; `LE.fx.configure({ shareBlur: false })` switches it off for comparison.

### Why the renderer runs on the main thread

The compositor (`LE.Scene`) is a 2D canvas on the main thread, and adjustment layers, groups and scene-reading effects need their result inside the frame being drawn, so that part must be synchronous. The bench also runs the unchanged renderer in a worker on an `OffscreenCanvas` (`node tools/fx-bench/run.js --worker`): on the sandbox's software GL a 2 MP typical stack took the same time either way (about 1.7 s) but blocked the main thread for 1.8 s on the main thread and under 1 ms from the worker. So a worker is a clear win for responsiveness wherever rendering is slow (software GL, weak phones) and no win in latency. The cached photo-layer stage is already promise-based behind one function (`LE.fx.layer`), so it can move to a worker later without changing this contract; the draw-time part cannot. Hardware numbers will decide whether that is worth a second GL context.

## Public API besides the registry

| Call | Use |
|---|---|
| `LE.fx.apply(source, { fx, mask, quad, scale, tile, preview, key, colorSpace, pad, layer, assets })` | a canvas, an image or float pixels through a stack; returns a canvas with `._fx = { pad, padPx, … }`. Tests, thumbnails, tools |
| `LE.fx.interactive(bool)`, `LE.fx.on(fn)`, `LE.fx.stamp()` | draft/refine, events, the cache stamp |
| `LE.fx.status()` | `{ available, lost, float, p3, maxTexture, renderer, memory: { bytes, cacheBytes, budget }, stats, warnings }` |
| `LE.fx.configure({ tile, budgetMB, workMP, eightBit })`, `LE.fx.trim(all)`, `LE.fx.profile(bool)` | tests and the bench; `trim` frees GPU memory |
| `LE.fx.problems(doc)`, `LE.fx.cleanMask(mask)`, `LE.fx.assetsOf(layer)` | what would be skipped; a validated mask; asset ids a layer needs |
| `LE.fx.quad.unit(layer)`, `.corners(layer)`, `.homography(points)`, `.invert(m)` | perspective maths |
| `LE.fx.math` | `curveLUT`, `parseColor`, `srgbToLinear`, `linearToSrgb`, `blurReach`, `wbMatrix`, `toneLUT`, `hash` |
| `LE.fx.touch(canvas)` | an asset canvas was painted into |

The memory budget is 384 MB on a `high` performance level, 192 on `mid`, 96 on `low` (`LE.perf.level()`): pool textures, uploaded sources and cached stages together. Tile size follows from it.

### Float sources (the seam for RAW and HDR)

Wherever a canvas is accepted as the picture, `{ data: Float32Array | Uint16Array, width, height, channels: 3 | 4, space: 'linear' | 'display' }` is too (top row first; alpha, if present, premultiplied). That is the shape `LE.raw.decode` returns, apart from the camera matrix, which the develop pack applies as a colour operation. The data goes into a half-float texture, tiles take their part with the unpack parameters (no copy), and the stack starts in the source's own space, so linear data is never squeezed through 8 bits. `g.whole()` and `g.stats()` answer for a float source too (from a box-sampled 8-bit copy). Not available for a float source: draft half resolution (a provider hands over a smaller picture instead), the work limit's fallback, the CPU path, mip-mapped quads.

**Layers drawn from float data.** The registry is in the core:

```js
LE.fx.sources.register(kind, provider)   // kind: layer.raw.kind ('raw' when absent)
// provider(layer, { targetMax, preview, draft, scene, entries }) → Promise<null | { source, box: { w, h }, key, ctx }>
LE.fx.sources.lazy(kind, load)           // load() is called once when such a layer is drawn and no provider is registered
LE.fx.sources.split(fx) → { dev, rest }  // the source stage and the rest;  .inject(dev, ctx),  .is(layer),  .forget(layerId)
```

An effect joins the **source stage** by declaring `source: { order, required }` (`required`: a default entry is added when the stack has none) and, optionally, `inject: function (p, ctx) { … return p; }`, which fills in what only the layer's source knows (a camera matrix, the picture's extent) and is never written to the document. `LE.fx.layer` draws a layer whose `raw.source.asset` is set in two steps: the provider's uncropped picture through the source-stage entries and the cut-out, read back as **float pixels** already cropped (`job.out = { float: true, rect }` inside the renderer); then that float picture through the rest of the stack, frame, layer mask, quad and silhouette entries. Nothing is quantised to 8 bits between the two. Masks on source-stage entries are fractions of the layer box like every other mask (a `u_frame` uniform says where the layer box sits in the uncropped photo; `blur` is in the layer's document pixels); under a perspective quad they are in the coordinates before the warp. A layer with legacy adjustments, a legacy filter, background removal by colour or a baked retouch overlay keeps the older order, because those are 8-bit CPU steps: source stage to an 8-bit canvas, then the unchanged pipeline. Without a provider, without half-float targets, or on any error the layer's own 8-bit picture is drawn. The float picture of a preview is kept per layer (four layers at most); an export holds one float copy of the cropped picture (16 bytes a pixel) while it runs.

**Gamut.** `g.gamut` is `'srgb'` or `'display-p3'`: what the render is for. An effect that compresses or clips to a gamut aims at that one and still returns linear sRGB primaries; a colour sRGB cannot show then has a component below 0 or above 1, which half-float stages carry to the output (`develop.basic` does this). The P3 canvas is filled by reading the shader's P3-encoded output back, never through the drawing buffer's colour space.

### Added in the hardening pass

| Call | Does |
|---|---|
| `LE.fx.version()` / `LE.fx.build` | registry change counter / renderer version |
| `LE.fx.UI`, `LE.fx.declareControl(name)` | the ui grammar's words |
| `LE.fx.describe(...)`, `LE.fx.defs()` | see "Describing effects" |
| `LE.fx.actions.register / get / list / run` | see "Actions" |
| `LE.fx.data(id)`, `.put(id, text)`, `.load(id)` | data assets |
| `LE.fx.rescale(layer, k)` | scales `px` parameters and mask blurs in place; `true` when something changed |
| `LE.fx.keyOf(value)` | JSON for cache keys, long number lists by hash |
| `LE.fx.local(scene, ctx, layer, opts)` | draws one non-photo layer alone with its effects (`exportLayer`) |
| `LE.fx.status().stats.drawHits`, `.shared`; `.memory.drawCacheBytes` | draw-cache hits, shared blur results, cache size |

## Agent plumbing

`LE.fx.ops.apply(doc, op)` → `{ ok, doc, errors, warnings, id }`. It never changes `doc`; on failure `doc` is returned as it was. Operations: `fx.add { layer, entry, index? }`, `fx.update { layer, id, p?, on?, amount?, blend?, mask? }` (`p` is merged), `fx.remove { layer, id }`, `fx.reorder { layer, id, index }`, `mask.set { layer, fx?, mask }` (`mask: null` clears), `adjust.add { fx, name?, mask?, clip?, above?, x?, y?, w?, h?, opacity?, id? }`, `transform.set { layer, quad }` (`quad: null` clears). `id` in the result is the entry or layer that was made or touched. Unknown effect types and forbidden keys are refused; out-of-range values are clamped with a warning. `LE.fx.ops.list()` describes the operations. `map.generate` belongs to the model steps (S2).

`LE.fx.analyze(target, { region, layer, kinds })` → a promise of

```
{ width, height, sample: { width, height, pixels },
  histogram: { bins: 256, r, g, b, luma },                 // fractions per bin, display-referred
  percentiles: { r, g, b, luma: { p1, p5, p25, p50, p75, p95, p99 } },
  clipping: { shadows: { r, g, b, any, all }, highlights: { … } },   // fraction of pixels at 0–2 or 253–255
  mean: { r, g, b, luma, color }, median: { luma },
  whiteBalance: { method: 'near-neutral' | 'grey-world', confidence, neutral: [r, g, b], cast: { rg, bg }, suggest: { temperature, tint } },
  saturation: { mean, p50, p95, colorfulness },
  sharpness: { laplacianVariance, sample },
  hue: { mean, strength, vectorscope: { angle, magnitude, skinLine: 123, offsetFromSkinLine } },
  alpha: { coverage } }
```

`target` is a canvas, an image, `ImageData`, a `LE.Scene` (the page) or `{ scene, layer }`; `region` is `{ x, y, w, h }` in fractions. `histogram.l` is the same list as `histogram.luma`. The scopes' form, `LE.fx.analyze({ source: canvas, kinds: ['histogram'] })`, returns the object at once when the statistics code is already loaded (a promise the first time); with `kinds` given and no `'sharpness'` in it, the sharpness pass is skipped (`sharpness: null`). `whiteBalance.suggest` is in `white-balance` effect units. For "average skin hue against the skin-tone line", pass a region on skin and read `hue.vectorscope.offsetFromSkinLine`. Light direction and anything that needs a model are not here.

Wiring in `le-agent.js` (owned by the agent-mode engineer):

```js
// LEAgent.apply, for op names LE.fx.ops.list() knows:
LE.fxBoot.load().then(function (fx) { var r = fx.ops.apply(scene.toJSON(), op); if (r.ok) scene.load(r.doc); return r; });
// LEAgent.analyze(target, opts):
LE.fxBoot.load().then(function (fx) { return fx.analyze(target, opts); });
// LEAgent.catalog('fx'):
LE.fxBoot.load().then(function (fx) { return q ? fx.describe(q) : fx.describe(); });   // the index, or one effect; schema() and actions.list() for the rest
```

`scene.load` resets the undo history; to keep it, apply the result per layer instead: `scene.update(layerId, { fx: r.doc.layers[i].fx, layerMask: …, transform: … })`, or `scene.add(r.doc.layers[i])` for `adjust.add`.

**Where it is wired.** `assets/js/le-agent.js` registers these operations for `LEAgent.apply` and `LEAgent.command` (one block, "Expert effects"): they run on the batch's working copy, so a batch is atomic, conflict-checked and one step of the person's undo history like any other. `layer` takes a layer id or a unique name; `id` (and `fx` in `mask.set`) takes an entry id or, when the layer has exactly one of that kind, its type. `LEAgent.analyze(target?, { region, kinds })` and `LEAgent.catalog("fx", q)` (index, one effect by id, `"schema"`, `"actions"`) are the read side. `assets/js/le-link.js` registers the same operations for open-format documents, which is what `localeditor apply`, the MCP `design_apply` tool and the live link use; the headless page loads the renderer before an expert operation runs and before a render (`LE.fxBoot.prepare`), so CLI renders show the effects.

## Tests and timings

`tests/fx.test.js` with helpers in `tests/lib/fx.js`:

- `fx.page(browser, base, { configure })`: a blank page with the renderer and every pack loaded (`window.fxT` has `load`, `fit`, `card`, `png`, `diff`).
- `fx.render(page, { photo | card, alpha, size, fx, mask, quad, tile, scale, preview, interactive })` → PNG buffer.
- `fx.golden(page, name, png, { max, over })`: compares with `tests/golden/fx/<name>.png`. `FX_GOLDEN=create node tests/run.js fx` writes missing ones, `FX_GOLDEN=update` rewrites all; look at the image before committing it. `legacy-sample.png` and `legacy-collage.png` are different: they were drawn by the engine as it was before X0a and prove that documents without expert data did not change, so regenerate them only when a deliberate change to the legacy pipeline lands.
- `fx.same(page, a, b, what, { max, over })`, `fx.diff(page, a, b, limit)` → `{ max, mean, over, at }`.
- `fx.attach(page)`, `fx.shot(page, scale)`, `fx.legacy(page, kind)` for studio pages.

Every effect ships one golden at 256 px on the test card and, when it is spatial, one tile-consistency case (`fx.render` with and without `tile: 192`, then `fx.same`). Goldens are made on the sandbox's software GL; the default tolerance (3/255 on at most 0.2 % of pixels) absorbs rounding differences between drivers. Headless Chromium needs no flags for WebGL2 here; `fx.GL_ARGS` lists the ones to try where the GPU blocklist interferes.

`node tools/fx-bench/run.js` prints milliseconds per pass for every registered effect at 1 MP and 2 MP, a typical stack (full, draft, cached), a tiled export, and with `--worker` the main-thread-against-worker comparison. `--headed` runs it in a visible browser for real hardware. The build sandbox has no GPU: treat its numbers as relative.

## Differences from `docs/EXPERT-MODE.md`

- **The layer mask is `layer.layerMask = { on, invert, parts }`** (the architect's ruling): `layer.mask` stays the frame-shape name on photo layers. A `mask` given as an object on a layer is still accepted on input and stored as `layerMask`. The workspace keeps the name in `LE.expert.doc.MASK`.
- **Masks follow the workspace reference** (`LE.expert.evalMask`): add is `max`, `feather` is 0–1 and shapes linear and radial parts, a linear part is 1 at its first point. `blur` (document pixels) is an addition.
- **Value shapes are the control kit's**: `point { x, y }`, `curve { master, r, g, b }`, `wheel { h, a, l }`, `bands` 8 × `{ h, s, l }`; `LE.fx.describe()` is an array (the index; `LE.fx.defs()` for full registrations) and `LE.fx.schema()` carries the rest.
- **In `.ledesign.json` a layer's `fx` is the stack when it is a list**; the older baked-effect object keeps working and is written as `fxBaked` when a layer has both.
- **Cut-out order.** Changed by ruling: the cut-out is applied before the stack whenever a layer has `fx` (see "Render order"). Layers without expert data are untouched.
- **Effects may declare** `grow`, `draft`, `needs: ['stats']` and `inert` (described and validated, never drawn).
- **Unknown effect types are kept as inert data** instead of being dropped at load. Effect ids may contain dots.
- **The legacy `adjust`/`filter` fields still run on the CPU** before the stack; they were not moved to the GPU, so documents without expert data draw exactly as before.
- **Preview** reuses the scene's per-layer bitmap cache at its preview size rather than rendering only the visible region; adjustment layers and other draw-time work do run at screen resolution on the visible canvas.
- **Capability id `webgl-float`** was added to `LE.support` (a small probe).
- **Test pages with the workspace's mock registry** (`LE_FX_MOCK`): when the real registry loads it registers the mock's effects as `inert` and forwards `interactive` calls to the mock's log, so `tests/expert-ui.test.js` keeps working until it moves to real effects. Nothing of this runs in production.
