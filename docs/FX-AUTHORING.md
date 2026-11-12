# Writing an effect (`LE.fx`)

The contract for step X0a of `docs/EXPERT-MODE.md`, as built. Feature teams (X1–X6) add effects with it, the workspace (`assets/js/expert/`) builds its controls from it, and the agent reference is generated from it. Where this file and `docs/EXPERT-MODE.md` disagree, this file is right; the differences are listed at the end.

## Files and loading

| File | Loaded | Holds |
|---|---|---|
| `assets/js/le-fx-boot.js` | with the studio (about 2 KB) | `LE.fxBoot`: detects expert data, loads the rest, redraws |
| `assets/js/fx/le-fx.js` | on demand | registry, validation, `LE.fx.ops`, quad maths, the open-format reader (`LE.fx.design`), the loader |
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
{ type: 'adjust', fx: [...], fxMask, clip: false, x, y, w, h, opacity, visible, … }            // adjustment layer; covers the page when no box is given
layer.fxMask   = { parts: [ { kind, mode, invert, feather, density, …kind fields } ] }           // the layer mask (see "Masks")
layer.transform = { quad: [[x,y],[x,y],[x,y],[x,y]] }                                           // TL, TR, BR, BL in page units; photo layers
layer.retouch  = { asset, version }
layer.maps     = { depth: { asset, model, version }, normals: {…}, face: { landmarks, parts: { asset }, model, version } }
layer.raw      = { profile, wb: { temp, tint }, exposure, … }                                   // kept as data until the RAW step
```

- Entry `blend`: `normal multiply screen overlay soft-light hard-light darken lighten difference color luminosity`.
- Limits enforced by the sanitisers: 32 entries per stack, 8 mask parts, 24 keys per object, 512 numbers per list (64 points per curve after schema validation), strings 120 characters. Keys `__proto__`, `constructor`, `prototype` are dropped everywhere; a `.leproject` or `.ledesign.json` that contains them is refused as a whole.
- Coordinates inside masks and parameters of type `point` are fractions of the layer box. Lengths (`unit: 'px'`) are document pixels; multiply by `g.scale` (or call `g.px(v)`) to get target pixels.
- **Two-level validation.** `LE.Scene` (`normalize`, `update`) and `LE.project` (always loaded) check the *shape* of expert data with `LE.Scene.expertOf`: types, sizes, forbidden keys, finite numbers. The registry (loaded on demand) checks each entry against its effect's schema before anything runs (`LE.fx.resolve`): unknown parameters are dropped, out-of-range values clamped, wrong types replaced by the default, and an entry whose `type` is not registered is **kept in the document and never executed**, so a file made by a newer build survives an older one. `LE.fx.problems(doc)` lists what was skipped or changed. `LE.fx.ops` and the open-format reader apply the schema when they write.
- **The quad** is stored in page units as it was when it was set, with the layer box (`x y w h`) equal to its bounding box. The renderer uses the quad's *shape* inside the box, so moving, resizing, rotating or flipping the layer with the ordinary handles carries the distortion along. `LE.fx.quad.corners(layer)` gives the corners where they are now. Selection and hit-testing use the bounding box; corner handles are for the workspace or X3 to add.

### Masks

`mask.parts` are combined in order, starting from empty: `add` → `m + v − m·v`, `subtract` → `m·(1 − v)`, `intersect` → `m·v` (a first part that is `subtract` or `intersect` starts from full). Every part has `invert` (bool), `density` (0–1, multiplies the part) and `feather`.

| kind | fields | `feather` means |
|---|---|---|
| `asset` | `asset` (image id; its alpha, or its luminance when it is opaque; stretched over the layer box) | blur, document px (0–500) |
| `linear` | `x0, y0, x1, y1` (0 at the first point, 1 at the second) | not used |
| `radial` | `cx, cy, rx, ry, rotation` | 0–1, the soft part of the radius |
| `luma` | `min, max, soft` (0–1, display-referred luminance) | blur, document px |
| `color` | `h` (0–360), `s`, `l` (0–1), `range` (0–1), `soft` (0–1) | blur, document px |
| `subject` | none; uses `layer.cutout.asset`, also when the cut-out is switched off | blur, document px |
| `depth` | `near, far, soft` (0–1); needs `layer.maps.depth.asset` (red channel, 0 near … 1 far is the convention S2 should confirm) | blur, document px |
| `face` | `part`: `skin eyes lips teeth brows under-eyes`; needs `layer.maps.face.parts.asset`, one image whose grey level names the part (`FACE_PARTS` in `le-fx.js`: skin 40, brows 80, eyes 120, under-eyes 160, lips 200, teeth 240) | blur, document px |

`subject`, `depth` and `face` read images that are aligned with the *source photo*; the renderer maps them through the layer's crop and quad. A part whose map or asset is missing contributes nothing and is reported by `LE.fx.problems`. `depth` and `face` are wired end to end but have only been exercised with hand-made maps: no model produces them yet.

After painting into an asset canvas in place (brush engine), call `LE.fx.touch(canvas)` so its texture is uploaded again.

## Render order (as built)

**Photo layer** (a cached bitmap, the same cache `LE.Scene` already keeps per layer): source → fit to the preview or export size → retouch overlay → crop, legacy `adjust`/`filter`/`removeBg` (the existing CPU code, unchanged) → *`LE.fx` from here* → perspective quad → `fx` stack (entries without `alpha` or `scene` in `needs`) → cut-out alpha, frame clip (`mask` shape, `maskPath`, `radius`) and `fxMask` → sticker outline → silhouette entries (`needs` has `alpha`) → bitmap, possibly larger than the layer box → drawn with the layer's opacity, blend and plain `shadow`.

The CPU part is kept per layer while its inputs do not change, so dragging an effect control does not redo crop and filters; spatial stage outputs are kept on the GPU keyed by a hash of their inputs.

**At draw time**, on the pixels the compositor has produced so far and at the resolution being drawn (screen or export): other layer types with `fx` or `fxMask`, groups with `fx` (their members are drawn together where the first member sits), entries that need the `scene`, and adjustment layers (`clip: true` applies to the layer directly below only).

Not done at draw time: `transform.quad` on non-photo layers; `LE.Scene.exportLayer` of a non-photo layer ignores its effects.

## Registering an effect

```js
(window.LE_FX_DEFS = window.LE_FX_DEFS || []).push({      // or LE.fx.register(def) once le-fx.js is loaded
  id: 'bloom', name: 'Bloom', group: 'effects', version: 1,
  space: 'linear',                    // the space g.source is handed over in, and expected back in
  needs: [],                          // 'alpha' 'scene' 'depth' 'normals' 'face' 'stats'
  params: { threshold: { type: 'number', min: 0, max: 4, default: 1, step: 0.01, label: 'Threshold' } },
  radius: function (p, scale) { return 0; },     // target pixels of neighbourhood read; drives tile overlap
  grow: function (p, scale) { return 0; },       // optional: target pixels the result extends beyond the layer box
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
- An effect with `alpha` or `scene` in `needs` is a **silhouette effect**: it runs after the cut-out and the layer mask whatever its position in the stack, and may declare `grow`.
- `radius` and `grow` receive target pixels per document pixel. Use `LE.fx.math.blurReach(sigmaInTargetPixels)` for anything built on `g.blur`.
- `cpu(imageData, p, { scale, box, width, height })` changes 8-bit display-referred pixels in place. Give one only where it is a table lookup or as simple; masks and blends are not applied on that path.
- Each registration is also declared to `LE.support` as `fx.<id>` (E7).

### Parameter types

| type | value | schema fields |
|---|---|---|
| `number` | finite number | `min, max, default, step, unit` (`'px'` = document pixels, `'ev'`, `'%'`, `'deg'`, `'K'`), `label`, `help` |
| `bool` | `true`/`false` | `default` |
| `choice` | one of `options` | `options: ['a', 'b']` or `[{ value, label }]`, `default` |
| `color` | `'#rrggbb'` or `'#rrggbbaa'` | `default`, `alpha: true` to allow the 8-digit form |
| `point` | `[x, y]` fractions of the layer box, −1…2 | `default` |
| `angle` | degrees, −360…360 | `default` |
| `curve` | 2–64 control points `[[x, y], …]`, 0–1, sorted by `x` | `default` (`[[0,0],[1,1]]`) |
| `wheel` | `{ h: 0–360, amount: 0–1, l: −1…1 }` | `default` |
| `bands` | 8 numbers (red, orange, yellow, green, aqua, blue, purple, magenta) | `min, max, default` |
| `lut` | asset id or `null` | — |
| `seed` | integer 0…2147483647 | `default` |

`LE.fx.validate(entry)` → `{ ok, entry, warnings: [{ path, code, message }], errors: [...] }`; `entry` is a clean copy with every parameter present. Codes: `unknown-type`, `bad-entry`, `clamped`, `bad-value`, `unknown-key`, `forbidden-key`, `unknown-kind`.
`LE.fx.defaults(id)` → a full `p`. `LE.fx.list()` → ids. `LE.fx.get(id)` → the definition. `LE.fx.describe()` → plain JSON for the agent reference and the workspace: `{ version, effects: [{ id, name, group, version, space, needs, spatial, params, ui, agent, support, cpu }], blends, paramTypes, maskKinds: [{ kind, fields: { name: [min, max, default] } }], faceParts, limits, entry }`.

### `ui` descriptor (consumed by `assets/js/expert/`)

`ui.section` is the develop-panel section (`Light`, `Colour`, `Detail`, `Effects`, `Blur`, `Shadow`, or a new one) and `ui.order` sorts effects inside it. `ui.controls` is optional; without it the workspace makes one control per parameter, in declaration order, from the parameter type. Each control: `{ param, control, label?, row?, when? }` with `control` one of `slider toggle select color point angle curve wheel bands lut seed`; `row` groups controls on one line; `when: { param, is }` shows a control only while another parameter has that value. Labels, ranges, steps and units come from `params`.

While a control is held the workspace calls `LE.fx.interactive(true)` on pointer down and `LE.fx.interactive(false)` on release, and writes with `scene.update(id, { fx: [...] }, { coalesce: 'fx' })` (or through `LE.fx.ops.apply` and `scene.load`). A change of `fx`, `fxMask`, `transform`, `retouch`, `maps` or `raw` re-renders the layer; nothing else needs calling.

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
| `g.scene()` | what is behind the layer, aligned with the working rectangle; `null` unless the effect declares `scene` |
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

## Tiles, previews and determinism

- The image is processed in tiles (one when it fits in the memory budget and the texture limit). Each tile is extended by the sum of `radius(p, scale)` over the stack plus the reach of mask feathers. Declare the truth: too small shows seams, too large wastes time. Tile rectangles sit on a 64-pixel grid (256 for very wide blurs) so pyramid levels line up between tiles.
- Outside the image, `g.source` is edge-extended (`edge: 'transparent'` on `g.blur` for the other behaviour). In the silhouette stage the outside is transparent.
- **Limits, so that no parameter can run away.** When the whole picture fits in one rectangle (most previews) any radius is exact, because beyond the picture everything is its extended edge. When it has to be tiled, a tile can carry a reach of about 1,200 pixels on a `high` device, 740 on `mid` and 410 on `low` (a Gaussian of roughly 270, 180 and 95 pixels standard deviation at export scale); a wider stack is clamped with a console note and can show soft seams. A result may extend beyond the layer box by at most 2,048 pixels, twice the picture's longer side and six times its area. A render whose rectangles add up to more than 480 MP (240 on `mid`, 120 on `low`; a sixth of that for previews) is done at half resolution, repeatedly if needed, with a console note.
- Procedural detail (grain, textures) must be a function of `docPos()` and a `seed` parameter. Preview and export then show the same pattern at different sampling densities.
- `LE.fx.interactive(true)`: stacks with spatial or silhouette effects render at half resolution, `g.draft` is set and `draft(p)` is applied. `LE.fx.interactive(false)` refines. Listeners (`LE.fx.on`) hear `draft`, `refine`, `lost`, `restored`.
- Colour: 8-bit sRGB in, linear or display-referred floating point inside, 8-bit out with ordered dithering. `LE.fx.apply(canvas, { colorSpace: 'display-p3' })` returns a Display-P3 canvas where the browser supports it; the studio's compositor is sRGB, so the scene path stays sRGB.
- A lost WebGL context: renders fall back to the picture without GPU effects, `LE.fx.stamp()` changes, and scenes redraw with effects when the context returns.

## Public API besides the registry

| Call | Use |
|---|---|
| `LE.fx.apply(source, { fx, mask, quad, scale, tile, preview, key, colorSpace, pad })` | a canvas or image through a stack; returns a canvas with `._fx = { pad, padPx, … }`. Tests, thumbnails, tools |
| `LE.fx.interactive(bool)`, `LE.fx.on(fn)`, `LE.fx.stamp()` | draft/refine, events, the cache stamp |
| `LE.fx.status()` | `{ available, lost, float, p3, maxTexture, renderer, memory: { bytes, cacheBytes, budget }, stats, warnings }` |
| `LE.fx.configure({ tile, budgetMB, workMP, eightBit })`, `LE.fx.trim(all)`, `LE.fx.profile(bool)` | tests and the bench; `trim` frees GPU memory |
| `LE.fx.problems(doc)`, `LE.fx.cleanMask(mask)`, `LE.fx.assetsOf(layer)` | what would be skipped; a validated mask; asset ids a layer needs |
| `LE.fx.quad.unit(layer)`, `.corners(layer)`, `.homography(points)`, `.invert(m)` | perspective maths |
| `LE.fx.math` | `curveLUT`, `parseColor`, `srgbToLinear`, `linearToSrgb`, `blurReach`, `wbMatrix`, `toneLUT`, `hash` |
| `LE.fx.touch(canvas)` | an asset canvas was painted into |

The memory budget is 384 MB on a `high` performance level, 192 on `mid`, 96 on `low` (`LE.perf.level()`): pool textures, uploaded sources and cached stages together. Tile size follows from it.

## Agent plumbing

`LE.fx.ops.apply(doc, op)` → `{ ok, doc, errors, warnings, id }`. It never changes `doc`; on failure `doc` is returned as it was. Operations: `fx.add { layer, entry, index? }`, `fx.update { layer, id, p?, on?, amount?, blend?, mask? }` (`p` is merged), `fx.remove { layer, id }`, `fx.reorder { layer, id, index }`, `mask.set { layer, fx?, mask }` (`mask: null` clears), `adjust.add { fx, name?, mask?, clip?, above?, x?, y?, w?, h?, opacity?, id? }`, `transform.set { layer, quad }` (`quad: null` clears). `id` in the result is the entry or layer that was made or touched. Unknown effect types and forbidden keys are refused; out-of-range values are clamped with a warning. `LE.fx.ops.list()` describes the operations. `map.generate` belongs to the model steps (S2).

`LE.fx.analyze(target, { region, layer })` → a promise of

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

`target` is a canvas, an image, `ImageData`, a `LE.Scene` (the page) or `{ scene, layer }`; `region` is `{ x, y, w, h }` in fractions. `whiteBalance.suggest` is in `white-balance` effect units. For "average skin hue against the skin-tone line", pass a region on skin and read `hue.vectorscope.offsetFromSkinLine`. Light direction and anything that needs a model are not here.

Wiring in `le-agent.js` (owned by the agent-mode engineer):

```js
// LEAgent.apply, for op names LE.fx.ops.list() knows:
LE.fxBoot.load().then(function (fx) { var r = fx.ops.apply(scene.toJSON(), op); if (r.ok) scene.load(r.doc); return r; });
// LEAgent.analyze(target, opts):
LE.fxBoot.load().then(function (fx) { return fx.analyze(target, opts); });
// LEAgent.catalog('fx'):
LE.fxBoot.load().then(function (fx) { return fx.describe(); });
```

`scene.load` resets the undo history; to keep it, apply the result per layer instead: `scene.update(layerId, { fx: r.doc.layers[i].fx, fxMask: …, transform: … })`, or `scene.add(r.doc.layers[i])` for `adjust.add`.

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

- **The layer mask is `layer.fxMask`**, not `layer.mask`: on photo layers `layer.mask` is already the frame-shape id (`'ellipse'`, `'heart'`), read by five existing modules. Entry masks and `mask.set` keep the name `mask`. A photo layer's `mask` given as an object is accepted as an alias on input (scene, project, open format) and stored as `fxMask`.
- **In `.ledesign.json` a layer's `fx` is the stack when it is a list**; the older baked-effect object keeps working and is written as `fxBaked` when a layer has both.
- **Cut-out order.** The cut-out is applied after the effect stack, as the architecture says, so a blur does not soften the subject's edge but does mix removed background into it near the edge. Silhouette effects (`needs: ['alpha']`) always run after cut-out and mask, wherever they are in the list.
- **Effects may declare** `grow`, `draft` and `needs: ['stats']`.
- **Unknown effect types are kept as inert data** instead of being dropped at load.
- **The legacy `adjust`/`filter` fields still run on the CPU** before the stack; they were not moved to the GPU, so documents without expert data draw exactly as before.
- **Preview** reuses the scene's per-layer bitmap cache at its preview size rather than rendering only the visible region; adjustment layers and other draw-time work do run at screen resolution on the visible canvas.
- **Capability id `webgl-float`** was added to `LE.support` (a small probe).
