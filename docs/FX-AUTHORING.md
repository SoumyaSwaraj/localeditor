# Writing an effect (`LE.fx`)

The contract for step X0a of `docs/EXPERT-MODE.md`. Feature teams (X1–X6) add effects with it, the workspace (`assets/js/expert/`) builds its controls from it, and the agent reference is generated from it. Where this file and `docs/EXPERT-MODE.md` disagree, this file describes what is built; the differences are listed at the end.

## Files and loading

| File | Loaded | Holds |
|---|---|---|
| `assets/js/le-fx-boot.js` | with the studio (tiny) | `LE.fxBoot`: detects expert data, loads the rest, re-renders |
| `assets/js/fx/le-fx.js` | on demand | registry, validation, `LE.fx.ops`, masks model, loader, public API |
| `assets/js/fx/le-fx-gl.js` | by `le-fx.js` | WebGL2 renderer, pass builder, tiling, colour management |
| `assets/js/fx/le-fx-basic.js` | by `le-fx.js` | the starter effects |
| `assets/js/fx/le-fx-analyze.js` | first `LE.fx.analyze` call | image statistics |
| `assets/js/fx/le-fx-<pack>.js` | by `le-fx.js` | your effects: add the pack name to `PACKS` in `le-fx.js` |

```js
LE.fxBoot.load().then(function (fx) { /* LE.fx is ready: renderer and every pack are in */ });
LE.fxBoot.needs(layerOrDoc)   // true when it carries expert data
```

Everything under `assets/js/fx/` is excluded from the precache (`ON_DEMAND` in `scripts/build.js`). The worker stores each file in the app cache the first time it is fetched, so the renderer works offline after its first use.

## Document model (as built)

```
layer.fx = [ { id, type, on: true, amount: 1, blend: 'normal', mask: <mask|null>, p: { … } } ]   // any layer type, groups, adjustment layers
{ type: 'adjust', fx: [...], fxMask, clip: false, x, y, w, h, opacity, visible, … }            // adjustment layer
layer.fxMask   = { parts: [ { kind, mode, invert, feather, density, …kind fields } ] }           // layer mask (see "Masks")
layer.transform = { quad: [[x,y],[x,y],[x,y],[x,y]] }                                           // TL, TR, BR, BL in page units
layer.retouch  = { asset, version }
layer.maps     = { depth: { asset, model, version }, normals: {…}, face: { landmarks, parts: { asset }, model, version } }
layer.raw      = { profile, wb: { temp, tint }, exposure, … }                                   // numbers, short strings, one level of nesting
```

- Entry `blend`: `normal multiply screen overlay soft-light hard-light darken lighten difference color luminosity`.
- Limits enforced by the sanitisers: 32 entries per stack, 8 mask parts, 24 parameters per entry, 64 control points per curve, strings 120 characters, ids `[\w:.-]{1,80}`. Keys `__proto__`, `constructor`, `prototype` are rejected everywhere.
- Coordinates inside masks and parameters of type `point` are fractions of the layer box. Lengths (`unit: 'px'`) are document pixels; multiply by `g.scale` (or call `g.px(v)`) to get target pixels.
- **Two-level validation.** `LE.Scene` and `LE.project` (always loaded) check the *shape* of expert data: types, sizes, forbidden keys, finite numbers. The registry (loaded on demand) checks each entry against its effect's schema before anything runs: unknown parameters are dropped, out-of-range values clamped, wrong types replaced by the default, and an entry whose `type` is not registered is **kept in the document but never executed** (a newer file opened by an older build must not lose data). `LE.fx.problems(doc)` lists what was skipped. `LE.fx.ops` is strict: it refuses unknown types.

### Masks

`mask.parts` are combined in order, starting from empty: `add` → `m + v − m·v`, `subtract` → `m·(1 − v)`, `intersect` → `m·v` (a first part that is `subtract` or `intersect` starts from full). Every part has `invert` (bool), `density` (0–1, multiplies the part) and `feather`.

| kind | fields | `feather` means |
|---|---|---|
| `asset` | `asset` (image id; its alpha, or its luminance when opaque; stretched over the layer box) | blur, document px (0–500) |
| `linear` | `x0, y0, x1, y1` (0 at the first point, 1 at the second) | not used |
| `radial` | `cx, cy, rx, ry, rotation` | 0–1, the soft part of the radius |
| `luma` | `min, max, soft` (0–1, display-referred luminance) | blur, document px |
| `color` | `h` (0–360), `s`, `l` (0–1), `range` (0–1), `soft` (0–1) | blur, document px |
| `subject` | none; uses `layer.cutout.asset` even when the cut-out is switched off | blur, document px |
| `depth` | `near, far, soft` (0–1); needs `layer.maps.depth.asset` | blur, document px |
| `face` | `part`: `skin eyes lips teeth brows under-eyes`; needs `layer.maps.face.parts.asset` (one channel-coded image, see `FACE_PARTS` in `le-fx.js`) | blur, document px |

A part whose map or asset is missing contributes nothing (as if `density` were 0) and is reported by `LE.fx.problems`.

## Render order (as built)

Image layer: source → fit to the preview or export size → retouch overlay → crop, legacy `adjust`/`filter`/`removeBg` (the existing CPU code, unchanged) → **`LE.fx` from here** → perspective quad → `fx` stack (entries without `alpha`/`scene` in `needs`) → cut-out alpha, frame clip (`mask` shape, `maskPath`, `radius`) and `fxMask` → sticker outline → silhouette entries (`needs` has `alpha`) → cached bitmap → drawn with the layer's opacity, blend and legacy shadow.

Other layer types, groups with `fx`, entries that need the `scene`, and adjustment layers run at draw time on the pixels the compositor has produced so far, at the resolution being drawn (screen or export).

## Registering an effect

```js
(window.LE_FX_DEFS = window.LE_FX_DEFS || []).push({      // or LE.fx.register(def) once le-fx.js is loaded
  id: 'bloom', name: 'Bloom', group: 'effects', version: 1,
  space: 'linear',                    // the space g.source is handed over in, and expected back in
  needs: [],                          // 'alpha' 'scene' 'depth' 'normals' 'face' 'stats'
  params: { threshold: { type: 'number', min: 0, max: 4, default: 1, step: 0.01, label: 'Threshold' } },
  radius: function (p, scale) { return 0; },     // target pixels of neighbourhood read; drives tile overlap
  grow: function (p, scale) { return 0; },       // optional: target pixels the result extends beyond the layer box (number or [l, t, r, b])
  draft: function (p) { return p; },             // optional: cheaper parameters while a control is dragged
  passes: function (g, p) { /* build passes; return the result handle, or call only g.color() */ },
  cpu: null,                                     // optional: function (imageData, p, info) for devices without WebGL2
  support: { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 200 },
  ui: { section: 'Effects', order: 50, controls: [ { param: 'threshold', control: 'slider' } ] },
  agent: { summary: 'Soft glow around bright areas.', tips: ['…'], example: { type: 'bloom', p: { threshold: 1.2 } } }
});
```

Rules: `id` matches `^[a-z][a-z0-9-]{1,39}$`; a second registration with the same id replaces the first only if its `version` is not lower. Bump `version` whenever the pixels change: it is part of every cache key. `passes` must be a pure function of `(g, p)`: no globals, no clocks, no `Math.random`.

### Parameter types

| type | value | schema fields |
|---|---|---|
| `number` | finite number | `min, max, default, step, unit` (`'px'` = document pixels, `'ev'`, `'%'`, `'deg'`, `'K'`), `label` |
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

`LE.fx.validate(entry)` → `{ ok, entry, warnings: [{ path, code, message }], errors: [...] }`. `entry` is a clean copy with every parameter present.
`LE.fx.defaults(id)` → a full `p`. `LE.fx.list()` → ids. `LE.fx.get(id)` → the definition. `LE.fx.describe()` → JSON for the agent reference and the workspace: `{ version, effects: [{ id, name, group, version, space, needs, params, ui, agent, support, spatial }], blends, maskKinds, paramTypes }`.

### `ui` descriptor (consumed by `assets/js/expert/`)

`ui.section` is the develop-panel section (`Light`, `Colour`, `Detail`, `Effects`, `Blur`, `Shadow`, or a new one), `ui.order` sorts effects inside it. `ui.controls` is optional; without it the workspace makes one control per parameter, in declaration order, from the parameter type. Each control: `{ param, control, label?, row?, when? }` with `control` one of `slider toggle select color point angle curve wheel bands lut seed`; `row` groups controls on one line; `when: { param, is }` hides a control unless another parameter has that value. Labels and ranges come from `params`.

## The pass builder (`g`)

Every image handle is premultiplied RGBA in the effect's declared `space`, in a half-float texture when the device has them (`g.float`), 8-bit otherwise.

| Member | Meaning |
|---|---|
| `g.source` | the input image handle |
| `g.width`, `g.height` | size of the working rectangle in target pixels (a tile plus its overlap) |
| `g.scale` | target pixels per document pixel (`g.scaleXY` when the layer is stretched) |
| `g.px(v)` | document pixels → target pixels |
| `g.box` | `{ w, h }` of the layer box in document pixels; `g.origin` is the working rectangle's top-left in the same units |
| `g.draft` | `true` while a control is being dragged |
| `g.float` | half-float targets are in use |
| `g.pass(frag, uniforms, opts)` | runs a fragment shader, returns a handle. `opts.scale` (default 1) sizes the target relative to the working rectangle, `opts.target` renders into an existing handle, `opts.filter` `'linear'` (default) or `'nearest'` |
| `g.color(glsl, uniforms)` | records a per-pixel colour operation; consecutive ones across effects compile into **one** pass |
| `g.blur(radius, opts)` | Gaussian blur of `opts.source` (default `g.source`); `radius` is the standard deviation in document pixels; `opts.edge` `'clamp'` (default) or `'transparent'` |
| `g.downsample(handle, levels)` | array of half-size handles (box filtered) |
| `g.upsample(handle, scale)` | tent-filtered handle at `scale` of the working rectangle (default 1) |
| `g.lut1d(data, channels)` | lookup texture handle from a `Float32Array` (`channels` 1, 3 or 4); sample with `lut1($name, x)` |
| `g.curve(points)` | a 1024-entry `lut1d` through control points (monotone cubic) |
| `g.lut3d(data, size)` | 3D lookup texture (`size³ × 3` floats); sample with `lut3($name, rgb)` |
| `g.mask(maskDef)` | the mask as a handle (value in every channel) |
| `g.alpha()` | the layer's alpha as a handle (after cut-out and mask in the silhouette stage) |
| `g.scene()` | what is behind the layer, aligned with the working rectangle; `null` when the effect runs in the cached layer stage |
| `g.stats()` | whole-image statistics of the input (`needs: ['stats']`), computed once on a reduced copy before tiling |
| `g.rgb(color)` | `[r, g, b, a]` of a `color` parameter in the effect's space, not premultiplied |

### Fragment shaders for `g.pass`

Write a GLSL ES 3.00 snippet that defines `vec4 fx()`. The renderer adds the header, `main`, dithering for 8-bit targets and these names:

```glsl
in vec2 v_uv;                 // 0–1 across the target
uniform sampler2D u_src;      // g.source unless you pass { u_src: handle }
uniform vec2 u_res, u_texel;  // target size in pixels and its inverse
uniform vec2 u_scale;         // target pixels per document pixel
uniform vec2 u_origin, u_box; // document-space origin of the target, and the layer box size
vec2 docPos();                // this pixel's position in the layer box, document pixels (tile-independent)
vec2 boxUV();                 // the same as a 0–1 fraction of the layer box
vec4 src(vec2 uv);            // texture(u_src, uv)
float luma(vec3 c);           // Rec. 709 luminance
vec3 toLinear(vec3 c); vec3 toDisplay(vec3 c);   // sRGB transfer, extended above 1
vec3 unpremul(vec4 c);
float hash21(vec2 p); float docNoise(vec2 cell, float seed);   // deterministic, document space
float lut1(sampler2D t, float x); vec3 lut1rgb(sampler2D t, vec3 c); vec3 lut3(mediump sampler3D t, vec3 c);
```

Uniform values: numbers, arrays (vectors and `float[]`), booleans, image handles and LUT handles. Anything positional must use `docPos()` or `boxUV()`, never `v_uv` or `gl_FragCoord`, or tiles will not line up.

### Colour operations for `g.color`

```js
passes: function (g, p) {
  g.color('uniform float $ev; vec3 $fx(vec3 c) { return c * exp2($ev); }', { ev: p.ev });
}
```

`c` is not premultiplied and is in the effect's `space`. `$` is replaced by a unique prefix, so declare every uniform and helper with it. Uniform values change without a recompile; the shader is compiled once per *sequence of effect types*. The renderer converts between `linear` and `display` inside the same pass, and folds each entry's `amount`, `blend` and `mask` in.

## Tiles, previews and determinism

- The image is processed in tiles (one tile when it fits). Each tile is extended by the sum of `radius(p, scale)` over the stack, so declare the truth: too small shows seams, too large wastes time. Tile origins sit on a 64-pixel grid so that pyramid levels line up between tiles.
- Outside the image, `g.source` is edge-extended (or transparent with `edge: 'transparent'`).
- Procedural detail (grain, textures) must be a function of `docPos()` and a `seed` parameter. Preview and export then show the same pattern at different sampling densities.
- `LE.fx.interactive(true)` switches to draft quality (spatial stacks render at half resolution, `g.draft` is set, `draft(p)` is applied); `LE.fx.interactive(false)` refines. The workspace calls these on pointer down and up of any control.
- Whole-image statistics: declare `needs: ['stats']` and call `g.stats()`. They are measured on a ≤ 256-pixel copy run through the entries before yours, once per render, not per tile.

## Tests and timings

`tests/fx.test.js` with helpers in `tests/lib/fx.js`: `fx.page(browser, base)` (a blank page with the renderer loaded), `fx.render(page, { photo | canvas, fx, mask, size, tile })` → PNG buffer, `fx.golden(name, png, { tolerance })` (compares with `tests/golden/fx/<name>.png`; `FX_GOLDEN=update node tests/run.js fx` rewrites them), `fx.diff(a, b)` → `{ max, mean, over }`. Add one golden per effect at 256 px and one tile-consistency case for every spatial effect.

`node tools/fx-bench/run.js` prints milliseconds per pass for every registered effect at 1 MP and 2 MP. The build sandbox has no GPU (SwiftShader); treat its numbers as relative.

## Agent plumbing

`LE.fx.ops.apply(doc, op)` → `{ ok, doc, errors, warnings, id }` on a copy of a page document. Operations: `fx.add { layer, entry, index? }`, `fx.update { layer, id, p?, on?, amount?, blend?, mask? }`, `fx.remove { layer, id }`, `fx.reorder { layer, id, index }`, `mask.set { layer, fx?, mask }`, `adjust.add { fx, name?, mask?, clip?, above? }`, `transform.set { layer, quad }`. `LE.fx.ops.list()` describes them.

`LE.fx.analyze(target, { region })` → a promise of `{ width, height, histogram: { r, g, b, luma }, percentiles, clipping, mean, median, whiteBalance, saturation, sharpness, hue }`. `target` is a canvas, an image, a `LE.Scene` or `{ scene, layer }`; `region` is `{ x, y, w, h }` in fractions.

## Differences from `docs/EXPERT-MODE.md`

Kept up to date at the end of X0a; see the handoff report for the reasons.

- The layer mask is `layer.fxMask`, not `layer.mask`: `layer.mask` is already the frame-shape id on image layers (`'ellipse'`, `'heart'`). Entry masks and `mask.set` keep the name `mask`. The open format accepts `"mask": { "parts": … }` on a layer as an alias.
- In `.ledesign.json` a layer's `fx` is the stack when it is an array; the older baked-effect object keeps working.
- Effects may declare `grow`, `draft` and `needs: ['stats']`.
- Unknown effect types are kept as inert data instead of being dropped at load.
