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
