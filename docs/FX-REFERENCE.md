# Effect reference

One section per effect pack. Each effect: purpose, parameters, the familiar-editor equivalent in generic words, and an `fx` entry
an agent can paste into `layer.fx` (or pass to `LE.fx.ops.apply(doc, { op: 'fx.add', layer, entry })`). The registry
(`LE.fx.describe()`) is the source of truth; this file is written from it.

## Pack `develop` (RAW develop and HDR, step X5)

File `assets/js/fx/le-fx-develop.js`; RAW and HDR layers in `assets/js/raw/le-raw-layer.js`; build notes, storage and the agent API
in `docs/RAW-HDR.md`.

**Where they run.** On a RAW or HDR layer (`layer.raw.source.asset` set) the four develop entries run first, on scene-referred linear
float data, in the fixed order `develop.lens` → `develop.detail` → `develop.tonemap` → `develop.basic`, whatever their place in
`layer.fx`; everything else in the stack then works on the developed (display-referred) picture. A RAW or HDR layer without a
`develop.basic` entry is developed with its defaults (profile Standard, white balance as shot). On ordinary photos and adjustment
layers they run where they are, like any effect; `develop.basic` with profile Auto is then a set of tone controls without a curve.

**Colour.** Scene values travel in linear Rec. 709 / sRGB primaries with unbounded range (negative = outside sRGB). RAW data
enters white-balanced as shot and converted with the camera's own matrices (DNG ColorMatrix / ForwardMatrix and calibration, or the
camera module's matrix). `develop.basic` is the output transform: relative white balance (camera matrices), ACES 1.3 Reference Gamut
Compression distance curve into sRGB, a hue-preserving filmic tone curve on luminance, saturation, highlight desaturation and a
path to white. The output gamut is sRGB (the studio compositor is sRGB).

### `develop.basic` — Develop (section Light, first)

The basic panel of a RAW developer: profile, white balance, tone, presence. One merged colour pass.

| Param | Type | Range | Default | Notes |
|---|---|---|---|---|
| `profile` | choice | auto, none, neutral, standard, vivid, portrait, landscape, flat, mono, mono-high | auto | Auto = Standard on RAW/HDR layers, None elsewhere. Mono profiles are the colour/monochrome treatment |
| `wb` | choice | as-shot, auto, daylight, cloudy, shade, tungsten, fluorescent, flash, custom | as-shot | presets: 5500, 6500, 7500, 2850, 3800 (+21 tint), 5500 K |
| `temp` | number K | 2000–50000 | 5500 | used when `wb` is custom; higher warms. A RAW layer opens with its as-shot value here |
| `tint` | number | −150–150 | 0 | + magenta, − green (Duv × 5000) |
| `exposure` | number EV | −5–5 | 0 | stops on linear light |
| `contrast` | number | −100–100 | 0 | slope of the curve around middle grey |
| `highlights`, `shadows`, `whites`, `blacks` | number | −100–100 | 0 | warps of the curve's input; monotone |
| `recovery` | choice | reconstruct, clip, off | reconstruct | highlight reconstruction of clipped sensor channels (RAW layers; rebuilds the working copy) |
| `vibrance`, `saturation` | number | −100–100 | 0 | in display-referred linear light |
| `m0`…`m8` | hidden | | identity | injected by RAW layers (white-balance matrix from the camera matrices); never write them |

Familiar equivalent: the "Basic" panel of a RAW developer (profile browser, white balance selector with temperature and tint, the
six tone sliders, vibrance and saturation). Tone curve model, CPU reference and the numbers it hits are in the pack's comments
(`toneTable`): middle grey stays at sRGB 118, Standard keeps gradation to about +4 EV over grey.

```json
{ "type": "develop.basic", "p": { "profile": "standard", "wb": "custom", "temp": 5200, "tint": 6, "exposure": 0.4, "highlights": -45, "shadows": 35, "whites": -8, "blacks": -6, "vibrance": 15 } }
```

### `develop.detail` — Detail (RAW) (section Detail)

Capture sharpening and noise reduction on scene-linear data, before the tone curve on RAW layers. Up to 11 passes (5 at full
resolution, blurs separable). Needs half-float targets; does nothing without them.

| Param | Range | Default | Notes |
|---|---|---|---|
| `sharpen` | 0–150 | 0 | unsharp mask on √luminance |
| `radius` | 0.5–3 px | 1 | |
| `detail` | 0–100 | 25 | lower = differences below a threshold are treated as noise |
| `masking` | 0–100 | 0 | sharpen edges only |
| `luminance` | 0–100 | 0 | guided filter in a variance-stabilised domain |
| `lumDetail` | 0–100 | 50 | puts back part of what was removed |
| `color` | 0–100 | 0 | luminance-weighted chromaticity averaging |
| `colorDetail` | 0–100 | 50 | narrows the colour radius |
| `demosaic` | auto, fast, detail, smooth | auto | demosaic method for the layer's next decode (built-in: edge-directed / MHC; camera module: AHD, PPG, DHT, VNG) |

Familiar equivalent: the "Detail" panel (sharpening amount, radius, detail, masking; luminance and colour noise reduction with
their detail sliders). A RAW layer opens with values from its ISO (sharpen 40, colour 25, luminance rising above ISO 400).

```json
{ "type": "develop.detail", "p": { "sharpen": 40, "radius": 1, "detail": 25, "masking": 30, "luminance": 20, "color": 25 } }
```

### `develop.lens` — Lens corrections (section Optics)

One resampling pass (distortion, lateral CA, vignetting) plus a defringe pass when used. Centred on the picture.

| Param | Range | Default | Notes |
|---|---|---|---|
| `autoCA` | bool | false | on a RAW layer, the estimate made from the picture (edge correlation of red and blue against green on a 1 MP copy) |
| `distortion` | −100–100 | 0 | + corrects barrel, − pincushion (r(1 − 0.15 d r²)) |
| `vignette`, `midpoint` | −100–100, 0–100 | 0, 50 | + lightens corners, in linear light |
| `caRed`, `caBlue` | −100–100 | 0 | red/cyan and blue/yellow edge scale, up to 0.3 % |
| `defringePurple`, `defringeGreen` | 0–20 | 0 | removes purple / green fringes near high-contrast edges |

Familiar equivalent: "Lens corrections" (profile tab's chromatic-aberration switch, manual distortion and vignetting, defringe
with purple and green amounts). No lens-profile database is used (lensfun's data is CC-BY-SA; see `docs/RAW-HDR.md`).

```json
{ "type": "develop.lens", "p": { "distortion": 12, "vignette": 30, "midpoint": 50, "autoCA": true, "defringePurple": 6 } }
```

### `develop.tonemap` — HDR tone mapping (section Light, after Develop)

Compresses the range of scene-referred data before the filmic curve. Local and fusion: 7 passes, 5 of them at quarter resolution
(fast guided filter). Global: part of the merged colour pass.

| Param | Range | Default | Notes |
|---|---|---|---|
| `method` | local, fusion, global | local | edge-aware base/detail; exposure-fusion-style local exposure; plain log compression |
| `strength` | 0–100 | 0 | compression of the base (local), spread of the virtual exposures (fusion) |
| `detail` | −100–100 | 0 | local contrast kept or boosted |
| `highlights`, `shadows` | −100–100 | 0 | extra compression above / below middle grey |
| `saturation` | −100–100 | 0 | |
| `halo` | 0–100 | 50 | halo control: more edge-aware, smaller radius |

Base radius: 0.6–2.5 % of the picture's long side on RAW and HDR layers (the same look at any resolution); elsewhere that of a 3000-pixel picture, in document pixels.

Familiar equivalent: the tone-mapping stage of HDR tools ("Strength/Compression, Detail, Highlights, Shadows, Saturation, Halo
control") and of exposure-fusion tools. Halo at a 10-stop step edge with halo 80 and strength 70: under 26/255 within 30 px
(tested).

```json
{ "type": "develop.tonemap", "p": { "method": "local", "strength": 60, "detail": 20, "highlights": -20, "shadows": 20, "halo": 60 } }
```

### Situations (from the `agent` descriptions)

| Situation | develop.basic | develop.detail | develop.tonemap |
|---|---|---|---|
| Backlit portrait | exposure +0.3…+0.7, shadows +40…+60, highlights −40…−70, whites −10, vibrance +10 | sharpen 30–40, masking 50–70, luminance 10–20 | fusion, strength 30–45, halo 75 |
| Night city | highlights −60…−90, shadows +20…+35, blacks −15…−25, custom 3800–4300 K | colour 35, luminance 25–40, sharpen 30, masking 30 | local, strength 45–60, highlights −40, halo 70 |
| High-ISO indoor (3200+) | exposure +0.5…+1.2, shadows ≤ +30, blacks −10, tungsten or 3000–3400 K | luminance 35–55, colour 30–45, sharpen 25–35, masking 40–60 | strength ≤ 35, detail ≤ 0 |
| Landscape with sky | profile landscape, highlights −50, whites +15, shadows +20, vibrance +20 | sharpen 45 | optional local 35–50 |

Presets with these values are built in: `LE.raw.presets.list()`.
