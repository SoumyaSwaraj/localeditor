# Effect reference

Every registered effect, its parameters and a paste-ready `fx` entry. The live, authoritative version is `LE.fx.describe()` (and
`LEAgent.catalog('fx')`); this file explains the models and the editor conventions behind the numbers. Each feature pack has its own
section.

## Colour grading pack (`grade`, step X1)

File `assets/js/fx/le-fx-grade.js`, tests `tests/fx-grade.test.js`. All 18 effects are per-pixel colour operations built with
`g.color()`: any number of them, together with the starter colour effects, compile into **one shader pass**. None is spatial
(`radius` 0), so tiles never show seams and preview equals export. Every effect is neutral at its defaults (pixel-identical, tested)
and has a CPU reference in `LE.fx.grade.ref[id](p)` that the shader is tested against (at most one level of dither apart on every
colour of a 16-level cube).

How it relates to the starter set (`le-fx-basic.js`):

| Starter effect | Grading pack |
|---|---|
| `curves` | `tone-curve` extends it (region sliders, splits, luminosity mode); `hue-curves` adds the secondary curves |
| `highlights-shadows` (has whites and blacks) | complemented by `tone-curve` regions; whites/blacks are not duplicated |
| `levels`, `exposure`, `contrast` | unchanged; `LE.fx.grade.auto.tone` writes `levels` |
| `white-balance` (relative −100…100) | complemented by `temperature` (Kelvin, choice of adaptation) and the picker |
| `saturation` (saturation + vibrance) | its vibrance is superseded by `vibrance` (OKLCh, skin protection) |

### tone-curve — Tone curve (Curves, display)

Region curve plus point curve, the "parametric + point curve" pair of raw developers. Regions are sin² bumps over their zones (widened
by half their width), amplitude 0.3 × the window, kept monotone; then the per-channel curves, then the master curve
(`LE.curves`, the curve editor's spline). Luminosity mode applies regions + master to Rec. 709 luminance and rescales RGB, so contrast
does not change hue or saturation.

| Param | Range | Default | Meaning |
|---|---|---|---|
| `curve` | curve `{ master, r, g, b }` | identity | point curve |
| `highlights`, `lights`, `darks`, `shadows` | −100…100 | 0 | region sliders |
| `split1`, `split2`, `split3` | 0.05–0.5, 0.2–0.8, 0.5–0.95 | 0.25, 0.5, 0.75 | region boundaries |
| `mode` | `rgb`, `luminosity` | `rgb` | apply to RGB or to luminance |

```json
{ "type": "tone-curve", "p": { "lights": 12, "darks": -14, "curve": { "master": [[0, 0.03], [0.5, 0.5], [1, 0.97]] }, "mode": "luminosity" } }
```

### hue-curves — Hue curves (Curves, display)

Hue vs hue, hue vs saturation, hue vs luminance, luminance vs saturation, saturation vs saturation (the "secondary curves" of video
graders). Master channel only; y = 0.5 is no change. x of the hue curves is the HSV hue / 360 (0 red, 0.167 yellow, 0.333 green,
0.5 cyan, 0.667 blue, 0.833 magenta). Changes are made in OKLCh, weighted by chroma so greys stay grey: hue ±90°, chroma ×0…×2,
luminance as a power 2^(−2(y − 0.5)) of OKLab L. Keep the two ends of a hue curve at the same height.

| Param | Default |
|---|---|
| `hueHue`, `hueSat`, `hueLum`, `lumSat`, `satSat` (curves) | flat at 0.5 |

```json
{ "type": "hue-curves", "p": { "hueLum": { "master": [[0, 0.5], [0.55, 0.5], [0.64, 0.38], [0.72, 0.5], [1, 0.5]] } } }
```

### hsl — Colour mixer (Colour mixer, display)

Eight bands × hue / saturation / luminance (the HSL panel). Band membership by HSV hue (centres 0, 30, 60, 120, 180, 240, 270, 300°)
with smoothstep crossfades; hue ±100 = ±30°, saturation scales OKLCh chroma (−100 = grey), luminance raises OKLab L to the power
2^(−0.9·l/100). Out-of-gamut results are pulled towards grey of the same lightness instead of clipping.

| Param | Value |
|---|---|
| `mixer` | 8 × `{ h, s, l }`, −100…100, order red, orange, yellow, green, aqua, blue, purple, magenta |

```json
{ "type": "hsl", "p": { "mixer": [{"h":0,"s":-5,"l":0},{"h":0,"s":12,"l":6},{"h":-10,"s":-15,"l":0},{"h":20,"s":-35,"l":-15},{"h":-15,"s":15,"l":-5},{"h":-20,"s":5,"l":-20},{"h":0,"s":0,"l":0},{"h":0,"s":0,"l":0}] } }
```

Targeted adjustment seam: `LE.fx.grade.targetBands(rgbOrHex)` → `{ hue, chroma, weights: { red … }, bands, apply(bands, 'h'|'s'|'l', delta) }`.

### bw-mix — Black & white (Colour mixer, display)

Black-and-white mix (the "B&W" adjustment): grey = min + (mid − min)·w(secondary) + (max − mid)·w(primary), weights in percent;
optional tint, strongest in the mid-tones. Off until `convert` is true.

| Param | Range | Default |
|---|---|---|
| `convert` | bool | false |
| `reds`, `yellows`, `greens`, `cyans`, `blues`, `magentas` | −200…300 % | 40, 60, 40, 60, 20, 80 |
| `tintHue` | 0–360° | 35 |
| `tint` | 0–100 | 0 |

```json
{ "type": "bw-mix", "p": { "convert": true, "reds": 90, "yellows": 80, "greens": 35, "cyans": 40, "blues": -10, "magentas": 60, "tintHue": 35, "tint": 12 } }
```

### selective-color and selective-color-tones — Selective colour (Colour mixer, display)

The CMYK-style selective colour. Family weights: primary (largest channel) max − mid, secondary mid − min, whites 2(min − ½),
blacks 2(½ − max), neutrals 1 − (|max − ½| + |min − ½|). Inks C = 1 − R, M = 1 − G, Y = 1 − B; relative changes an ink by a fraction of
itself, absolute adds it; black moves all inks towards 1 (+) or 0 (−).

Two registrations because the document keeps at most 24 parameters per entry (9 families × 4 inks + method = 37):

| Effect | Params (−100…100 %, default 0) | Method |
|---|---|---|
| `selective-color` | `redsC redsM redsY redsK`, `yellows…`, `greens…`, `cyans…`, `blues…`, `magentas…` | relative |
| `selective-color-tones` | `whitesC…K`, `neutralsC…K`, `blacksC…K` | `method`: `relative` (default) or `absolute` |

```json
{ "type": "selective-color", "p": { "redsC": -15, "redsY": 8, "yellowsC": -10, "cyansC": 20, "bluesK": 15 } }
{ "type": "selective-color-tones", "p": { "method": "absolute", "whitesY": -6, "neutralsY": -5, "blacksC": 6, "blacksK": 8 } }
```

### channel-mixer — Channel mixer (Colour mixer, linear)

out = M·rgb + constant in linear light, M in percent; monochrome uses the red row for all outputs.

| Param | Range | Default |
|---|---|---|
| `rr rg rb gr gg gb br bg bb` | −200…200 % | identity (100 on the diagonal) |
| `rc gc bc` | −100…100 % | 0 |
| `monochrome` | bool | false |

```json
{ "type": "channel-mixer", "p": { "monochrome": true, "rr": 40, "rg": 50, "rb": 10 } }
```

### color-grading — Colour grading (Colour grading, display)

Three-way colour wheels plus global, with blending and balance (the colour-grading panel; split toning is its two-wheel case,
`LE.fx.grade.splitTone({ highlightHue, highlightSat, shadowHue, shadowSat, balance })`). Region weights on display luminance with
crossovers at ⅓ and ⅔, moved by balance (y^(2^−balance)) and widened by blending. Wheel colour is a luminance-free direction ×
amount × 0.3 (strength 0.2 + 0.8√y); luminance is restored exactly afterwards, so colour never changes brightness.

| Param | Value | Default |
|---|---|---|
| `shadows`, `midtones`, `highlights`, `global` | wheel `{ h 0–360, a 0–1, l −1…1 }` | 0 |
| `blending` | 0–100 | 50 |
| `balance` | −100…100 | 0 |

```json
{ "type": "color-grading", "p": { "shadows": { "h": 195, "a": 0.35, "l": 0 }, "highlights": { "h": 35, "a": 0.3, "l": 0 }, "balance": 10 } }
```

### lift-gamma-gain — Lift, gamma, gain (Colour grading, display)

The video primaries wheels: out = gain·max(in + lift(1 − in), 0)^gamma + offset, per channel from x = l + 0.5·a·direction(h):
lift 0.5x, gain 2^x, gamma exponent 2^(−x), offset 0.25x.

| Param | Value |
|---|---|
| `lift`, `gamma`, `gain`, `offset` | wheel `{ h, a, l }`, default 0 |

```json
{ "type": "lift-gamma-gain", "p": { "lift": { "h": 210, "a": 0.1, "l": 0.03 }, "gamma": { "h": 0, "a": 0, "l": 0.05 }, "gain": { "h": 35, "a": 0.12, "l": 0 } } }
```

### cdl — ASC CDL (Colour grading, display)

ASC CDL v1.2 slope / offset / power per channel, then saturation (Rec. 709 luma). Clamped at 0 only (the specification clamps to 0–1),
so earlier headroom survives. Paste the values of a `.cdl`/`.ccc` file.

| Param | Range | Default |
|---|---|---|
| `slopeR/G/B` | 0–4 | 1 |
| `offsetR/G/B` | −1…1 | 0 |
| `powerR/G/B` | 0.1–4 | 1 |
| `saturation` | 0–4 | 1 |

```json
{ "type": "cdl", "p": { "slopeR": 1.06, "slopeG": 1, "slopeB": 0.93, "offsetR": 0.01, "offsetG": 0.01, "offsetB": 0.02, "saturation": 0.92 } }
```

### color-balance — Colour balance (Colour grading, display)

The classic colour-balance adjustment (shadows / mid-tones / highlights × cyan–red, magenta–green, yellow–blue), following GIMP's
transfer model on HSL lightness (a = 0.25, b = 0.333, scale 0.7); preserve luminosity restores HSL lightness.

| Param | Range | Default |
|---|---|---|
| `shadowsCR shadowsMG shadowsYB`, `midtones…`, `highlights…` | −100…100 | 0 |
| `preserve` | bool | true |

```json
{ "type": "color-balance", "p": { "shadowsCR": -10, "shadowsYB": 12, "highlightsCR": 8, "highlightsYB": -10 } }
```

### gradient-map — Gradient map (Colour grading, display)

Luminance mapped through 2–5 stops, interpolated in OKLab (perceptual) or display RGB. `strength` is 0 by default (neutral); set it.

| Param | Range | Default |
|---|---|---|
| `strength` | 0–100 % | 0 |
| `count` | 2–5 | 2 |
| `color0…color4`, `pos0…pos4` | colour, 0–1 | black 0, white 1, then three spares |
| `interpolation` | `perceptual`, `rgb` | `perceptual` |
| `reverse` | bool | false |

```json
{ "type": "gradient-map", "p": { "strength": 100, "count": 2, "color0": "#1b2440", "color1": "#f2c98a" } }
```

### photo-filter — Photo filter (Colour, linear)

A coloured lens filter: transmission = the filter's linear colour / its largest channel, mixed by density; preserve luminosity rescales
to the original luminance. Presets: `warming-85`, `warming-lba`, `warming-81`, `cooling-80`, `cooling-lbb`, `cooling-82`, `red`, `orange`,
`yellow`, `green`, `cyan`, `blue`, `violet`, `magenta`, `sepia`, `deep-emerald`, or `custom` with `color`.

| Param | Range | Default |
|---|---|---|
| `filter` | as above | `warming-85` |
| `color` | colour | `#ec8a00` |
| `density` | 0–100 % | 0 |
| `preserve` | bool | true |

```json
{ "type": "photo-filter", "p": { "filter": "warming-85", "density": 25 } }
```

### vibrance — Vibrance (Colour, display)

OKLCh chroma × (1 + v(1 − C/0.32)²) (or (1 − C/0.32) for negative values), skin (OKLCh hue ≈ 60°, chroma 0.03–0.15) protected.

| Param | Range | Default |
|---|---|---|
| `amount` | −100…100 | 0 |
| `protect` | 0–100 % | 75 |

```json
{ "type": "vibrance", "p": { "amount": 30, "protect": 80 } }
```

### skin-tone — Skin tone (Colour, display)

Skin-tone targeting on the vectorscope (BT.601 CbCr, skin-tone line 123°, the same angle `LE.fx.analyze` reports): colours within
±width/2 of `center` are fully selected (fading out by ±1.5·width), greys and extreme luminances excluded. Uniformity pulls their hue
onto `center`, evenness pulls their CbCr magnitude to `chroma`; hue/saturation/lightness move the selection. Colour only.

| Param | Range | Default |
|---|---|---|
| `hue` (+ yellower), `saturation`, `lightness` | −100…100 | 0 |
| `uniformity`, `evenness` | 0–100 % | 0 |
| `center` | 90–170° | 123 |
| `width` | 5–45° | 25 |
| `chroma` | 0.02–0.3 | 0.12 |

```json
{ "type": "skin-tone", "p": { "uniformity": 40, "evenness": 25, "hue": 5, "saturation": -5 } }
```

Skin mask helper: `LE.fx.grade.skinMask()` returns a layer/effect mask of three `color` parts (light, medium, deep skin) fitted on a
19-swatch set; `skinMask({ tone: 'light' | 'medium' | 'deep' })` one part; `skinMask({ sample: '#c68863' })` one part around a sampled
colour. `LE.fx.grade.skinWeight(rgb)` gives the skin-tone effect's own selection for a colour.

### calibration — Calibration (Colour, linear)

The calibration panel: each primary's hue (±25° in OKLCh) and saturation (×0.6…×1.4) as a 3×3 matrix in linear light with white
preserved, plus a shadows green–magenta tint.

| Param | Range | Default |
|---|---|---|
| `shadowsTint` (+ magenta) | −100…100 | 0 |
| `redHue redSat greenHue greenSat blueHue blueSat` | −100…100 | 0 |

```json
{ "type": "calibration", "p": { "redHue": 10, "greenHue": -20, "blueHue": -40, "blueSat": 30 } }
```

### temperature — White balance (Kelvin) (Colour, linear)

Temperature and tint in Kelvin: the assumed light lies on Krystek's Planckian locus (CIE 1960 uv), offset across it by D65's own Δuv
(so 6504 K, tint 0 is exactly D65 and changes nothing) plus tint × 0.0003, adapted to D65 with Bradford (default), CAT16 or von Kries,
scaled to keep white's luminance. Lower temperature = cooler picture, as in raw developers.

| Param | Range | Default |
|---|---|---|
| `temp` | 2000–15000 K | 6504 |
| `tint` (+ magenta) | −150…150 | 0 |
| `method` | `bradford`, `cat16`, `von-kries` | `bradford` |

```json
{ "type": "temperature", "p": { "temp": 5600, "tint": 4 } }
```

Picker: `LE.fx.grade.whiteBalanceFrom(rgb, 'linear' | 'display')` → `{ temp, tint, ok, starter: { temperature, tint } }`, the setting
that makes that sample neutral (also in the starter `white-balance`'s units).

### lut — LUT (Colour grading, display)

A `.cube` LUT (1D up to 4096, 3D up to 65³, or a 1D shaper followed by a 3D cube; `DOMAIN_MIN/MAX`, `LUT_*_INPUT_RANGE`, `TITLE`),
tetrahedral interpolation in the shader, or a built-in look generated from this pack's own effects (no LUT files are shipped).

| Param | Range | Default |
|---|---|---|
| `lut` | project asset id (64-hex) or null | null |
| `look` | `none`, `teal-orange`, `warm-film`, `cool-film`, `bleach-bypass`, `cross-process`, `faded-matte`, `golden-hour`, `silver-mono`, `night-blue` | `none` |
| `intensity` | 0–100 % | 100 |
| `input` | `display` (sRGB / Rec. 709), `linear` | `display` |

```json
{ "type": "lut", "p": { "look": "teal-orange", "intensity": 60 } }
```

- `LE.fx.grade.importCube(textOrFile, name)` parses first (refusing unknown keywords, non-numeric or non-finite rows, wrong row
  counts, keywords after the data, sizes over the caps, files over 16 MB), then stores the text with `LE.project.putAsset`
  (SHA-256 id) and resolves to `{ id, title, kind, size }`. The workspace's LUT control uses the same parser.
- A document opened later finds its LUT in `LE.fx.grade.luts`, the workspace cache, or reads it from the project store in the
  background and redraws (`LE.fx.touch`); until then the entry draws as no LUT.
- `LE.fx.grade.exportCube(layerOrStack, { size: 33, title })` → `{ text, used, skipped }`: the layer's colour-only entries baked through
  the CPU references (starter colour effects included). Entries with a mask, a non-normal blend, or a spatial effect are skipped and
  listed.

### Auto, presets and helpers (`LE.fx.grade`)

| Call | Returns |
|---|---|
| `auto(stats, { whiteBalance, target })` | `{ fx: [temperature?, levels?], notes }` from `LE.fx.analyze` (or `g.stats()`) statistics |
| `auto.whiteBalance(stats)`, `auto.tone(stats)` | `{ entry, notes }` or null when nothing needs fixing |
| `autoFor(target)` | analyse + auto in one promise |
| `presets` | 12 named grades: `teal-orange`, `filmic-fade`, `clean-product-white`, `warm-portrait`, `cool-cinematic`, `bleach-bypass`, `moody-forest`, `golden-hour`, `nordic-matte`, `high-key-airy`, `noir`, `vintage-cross` (`{ id, name, summary, fx }`) |
| `preset(id)`, `presetOps(layerId, id)` | validated entries; `LE.fx.ops` operations that add them |
| `looks()` | the built-in LUT looks as stacks |
| `splitTone(o)`, `targetBands(rgb)`, `bandWeights(hue)`, `regionWeights(y, balance, blending)` | grading helpers |
| `kelvinMatrix(T, tint, method)`, `whiteBalanceFrom(rgb, space)` | white-balance maths |
| `parseCube`, `importCube`, `getLut`, `bake`, `compile`, `exportCube`, `tetra` | LUT plumbing |
| `ref[id](p)` | CPU reference: `function (rgb) → rgb` in the effect's space, or null when neutral |

Recipes an agent can apply in one go: `presetOps(layerId, 'filmic-fade').forEach((op) => LEAgent.apply(op))`, or an adjustment layer
`{ op: 'adjust.add', fx: LE.fx.grade.preset('teal-orange') }`.

Generated sections per pack. Every effect is an entry in `layer.fx` (or an adjustment layer's `fx`): `{ type, on, amount, blend, mask, p }`. Ranges and defaults below are the registry's (`LE.fx.describe()`); out-of-range values are clamped.

## Retouching (`assets/js/fx/le-fx-retouch.js`)

Seventeen effects and the helpers in `LE.fx.retouch` (written `R` below). Everything is data replayed by the renderer: no pixel of the photo is changed. Effects that need a face (`eye-enhance`, `teeth-whitening`, `lip-color`, `under-eye`, `face-liquify`, red-eye placement) read `layer.maps.face` (`LE.maps.face`, run on the device); without it they do nothing (skin effects fall back to a colour-only skin mask). Nothing face-aware runs on its own.

**Data slots.** Strokes, spots, polygons and the face rig are stored as quantised records (fractions of the layer box, 1e-4 steps) in hidden `curve` parameters (`d0`, `d1`, … and `rig`): the registry has no list type yet (proposal in the X4 report). Never write them by hand; use `R.ops.*`, `R.spots.*`, `R.liquify.*`, `R.face.rig`. Caps: `spot-heal` 256 records / 2,047 values, `liquify` 256 strokes / 3,071 values, rig 28 points.

**Agent operations** (each returns an operation for `LE.fx.ops.apply(doc, op)`, or `null`):

| Call | Does |
|---|---|
| `R.ops.heal(doc, layerId, { x, y, r, image? , source?: { dx, dy }, hardness, opacity, points? })` | heal a spot at x, y (box fractions), radius r (fraction of the box's long side); with `image` the source is chosen by `R.suggestSource` |
| `R.ops.clone(doc, layerId, { points, r, dx, dy, hardness })` | clone stroke from the offset |
| `R.ops.patch(doc, layerId, { polygon, dx, dy, feather, mode })` | patch a polygon from the offset (heal blend, or `mode: 'clone'`) |
| `R.ops.liquify(doc, layerId, { tool, points, size, pressure, density })` | one liquify stroke |
| `R.ops.face(doc, layerId, { jawline: -8, … }, { face })` | face-aware liquify with the rig filled from `layer.maps.face` |
| `R.ops.redEye(doc, layerId, { face })` | red-eye on both pupils of a face |
| `R.ops.dodgeBurnLayer(doc, { exposure, range })` | the 50 % grey dodge-and-burn layer: an adjustment layer with a dodge and a burn entry whose masks start empty |
| `R.maskCanvas(w, h, shapes, feather)` | a white mask canvas from polygons, strokes or circles ("dodge this polygon"): store it as an asset and use it as an `asset` mask part |
| `R.expand(entry)` | a `portrait-retouch` entry as the equivalent detailed entries |
| `R.face.size(layer)` | face width and the matching `size` for skin effects |

### frequency-separation — Frequency separation (Retouch)

Low band = Gaussian or edge-aware (guided filter) blur at `radius`; high band = image − low, exact in float (the 16-bit "subtract" convention without rounding). Edits each band. Familiar equivalent: the classic two-layer frequency separation (blurred low layer, linear-light high layer) with smoothing on the low layer.

| Param | Range (default) | |
|---|---|---|
| radius | 0.5–60 px (4) | split radius |
| method | gaussian, edge (gaussian) | edge-aware split avoids halos at strong edges |
| smooth | 0–100 (0) | blend the low band with its blur at `smoothRadius` |
| smoothRadius | 1–200 px (12) | |
| evenColor | 0–100 (0) | low-band chroma towards a wide average; luminance kept |
| texture | −100–100 (0) | high band × (1 + t/100) |
| lowArea, highArea | all, skin (colour), face (map) (all) | per-band areas; for any other mask use two entries |
| view | result, low, high (result) | inspect a band |

`{ "type": "frequency-separation", "p": { "radius": 3, "smooth": 45, "smoothRadius": 10, "evenColor": 35, "texture": -15, "lowArea": "skin" } }`

### detail-bands — Detail bands (Retouch)

Five octave bands (0–1, 1–2, 2–4, 4–8, 8–16 px × `scale`) with a gain each. Familiar equivalent: wavelet decompose / multi-scale detail panels.

| Param | Range (default) |
|---|---|
| scale | 0.25–8 (1) |
| b1 … b5 | −100–100 (0) |
| area | all, skin, face (all) |
| view | result, 1–5, residual (result) |

"Reduce blotchiness at 8–32 px, keep pores": `{ "type": "detail-bands", "p": { "scale": 2, "b4": -40, "b5": -50, "area": "skin" } }`

### portrait-retouch — Portrait retouch (Retouch)

High-level sliders over one skin/face core. Familiar equivalent: the one-panel portrait retouch of photo apps, built on frequency separation.

| Param | Range (default) | Expands to |
|---|---|---|
| smoothness | 0–100 (0) | skin-smoothing smoothness, even tone × 0.5 |
| texture | −100–100 (0) | skin texture |
| blemishes | 0–100 (0) | blemish-removal |
| eyes | 0–100 (0) | eye-enhance (brighten 0.6, clarity 0.5, iris 0.4) + under-eye 0.6 |
| teeth | 0–100 (0) | teeth-whitening |
| lips | −100–100 (0) | lip-color saturation |
| shine | 0–100 (0) | shine-reduction |
| contour | 0–100 (0) | face-contour |
| size | 0.5–40 px (3) | detail size ≈ face width ÷ 60 |
| skin | auto, face, colour, all (auto) | skin mask source |
| view | result, skin (result) | show the skin mask |

Natural starting point: `{ "type": "portrait-retouch", "p": { "smoothness": 35, "texture": -5, "blemishes": 50, "eyes": 25, "teeth": 20, "shine": 35, "contour": 15, "size": 3 } }`

### Detailed skin and face effects (Retouch)

Same core as `portrait-retouch`, one concern each. All take `size` (detail size, px); the skin ones take `skin`.

| Effect | Params | Familiar equivalent |
|---|---|---|
| `skin-smoothing` | smoothness, texture, evenTone, edges (50), size, skin, view | skin smoothing / "surface blur on the low layer" |
| `blemish-removal` | amount | spot-removal "auto" on small blemishes |
| `under-eye` | lighten | under-eye brightening |
| `eye-enhance` | brighten, clarity, iris | eye whitening, iris enhance |
| `teeth-whitening` | amount | teeth whitening brush |
| `lip-color` | saturation (−100–100) | lip saturation |
| `shine-reduction` | amount | shine / hot-spot removal |
| `face-contour` | amount | contour dodge and burn |

`{ "type": "skin-smoothing", "p": { "smoothness": 40, "texture": -10, "evenTone": 25, "size": 3 } }`

### dodge-burn — Dodge and burn (Retouch)

Dodge, burn or sponge through the entry's mask (painted with the Dodge and burn tool, or shaped). Linear light; protect tones uses the no-clip curve y = kx / (1 + (k − 1)x). Familiar equivalent: dodge, burn and sponge tools, or a 50 % grey soft-light layer.

| Param | Range (default) |
|---|---|
| mode | dodge, burn, saturate, desaturate (dodge) |
| exposure | 0–100 % (0); 100 % = 1 EV |
| range | shadows, midtones, highlights, all (midtones) |
| protect | bool (true) |

`{ "type": "dodge-burn", "p": { "mode": "dodge", "exposure": 25 }, "mask": { "parts": [{ "kind": "radial", "cx": 0.5, "cy": 0.42, "rx": 0.12, "ry": 0.16, "feather": 0.6 }] } }`

### red-eye — Red-eye (Retouch)

| Param | Range (default) |
|---|---|
| eye1, eye2 | points (off the picture) |
| radius | 0–200 px (0) |
| threshold | 0–100 (50) |
| darken | 0–100 (50) |

`{ "type": "red-eye", "p": { "eye1": { "x": 0.42, "y": 0.38 }, "eye2": { "x": 0.55, "y": 0.37 }, "radius": 9 } }`

### spot-heal — Healing and clone (Retouch)

Healing brush, clone stamp, spot removal and patch as one ordered list of records. Heal = membrane-blended transplant: tone and colour from around the destination (normalised Gaussian over the unhealed pixels), texture from the source. Clone = exact copy. Familiar equivalent: healing brush, spot healing, clone stamp, patch.

| Param | Range (default) |
|---|---|
| blend | 0.2–1.5 (0.6) × the largest spot radius |
| d0–d7 | data slots (hidden) |

`LE.fx.ops.apply(doc, R.ops.heal(doc, id, { x: 0.41, y: 0.33, r: 0.008, image }))`

### liquify — Liquify (Geometry)

Strokes replayed into a 128-node displacement mesh, rendered with a B-spline mesh and bicubic sampling. Tools: forward, twirl-cw, twirl-ccw, pucker, bloat, push-left, reconstruct, smooth, freeze, thaw. |D| ≤ 15 % of the long side. Familiar equivalent: the liquify filter's brush tools.

`LE.fx.ops.apply(doc, R.ops.liquify(doc, id, { tool: 'forward', points: [[0.40, 0.62], [0.42, 0.62]], size: 0.04, pressure: 0.6 }))`

### face-liquify — Face-aware liquify (Geometry)

Numeric face sliders from 28 landmark anchors (`rig`). Units: % of the feature (eye tilt in degrees). Familiar equivalent: face-aware liquify.

| Slider | Range | Slider | Range |
|---|---|---|---|
| faceWidth | ±30 % | eyeTilt | ±20° |
| jawline | ±30 % | eyeDistance | ±15 % |
| chinHeight | ±50 % | noseWidth | ±40 % |
| forehead | ±50 % | noseHeight | ±10 % |
| eyeSize | ±40 % | mouthWidth | ±40 % |
| eyeHeight | ±10 % | mouthHeight | ±10 % |
| eyeWidth | ±40 % | smile | ±30 % |
| upperLip | ±50 % | lowerLip | ±50 % |

"Slim the jaw by 8 %": `LE.fx.ops.apply(doc, R.ops.face(doc, id, { jawline: -8 }))`

### shape-warp — Shape warp (Geometry)

An elliptical region warp (no detection): scale (bloat / pinch), squeeze (narrow / widen along the ellipse's axis) or shift. Familiar equivalent: pinch / spherize distortions limited to a selection.

| Param | Range (default) |
|---|---|
| mode | scale, squeeze, shift (squeeze) |
| amount | −100–100 (0) |
| center | point (0.5, 0.5) |
| rx, ry | 0.01–1 of the box (0.2) |
| rotation, angle | degrees (0) |

`{ "type": "shape-warp", "p": { "mode": "squeeze", "amount": -12, "center": { "x": 0.5, "y": 0.6 }, "rx": 0.18, "ry": 0.12 } }`

### Tools (Expert workspace)

| Tool | Key | Notes |
|---|---|---|
| Heal | J | click = spot with automatic source; Alt/Option-click sets a source; `[` `]` size, Shift `[` `]` hardness |
| Clone | S | Alt/Option-click sets the source, Aligned option; on touch use the Source button |
| Dodge and burn | O | X swaps dodge and burn; mode, exposure, range, protect tones in the options bar |
| Liquify | (strip) | tool, size, pressure, density; Restore all |
| Face sliders | develop panel, Geometry › Face-aware liquify | "Find faces" runs on the device and stores the points in this design only |
