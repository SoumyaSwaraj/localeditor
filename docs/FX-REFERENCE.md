# Effect reference

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
