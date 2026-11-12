# Effect reference

One section per effect pack. Each effect: purpose, parameters, the familiar-editor equivalent in generic words, and an `fx`
entry an agent can paste. The registrations themselves (`LE.fx.describe()`) are the source of truth for ranges and defaults.

## Relight (X6): `assets/js/fx/le-fx-relight.js`

Lighting from a depth map. Every effect here reads `layer.maps.depth` (a 16-bit relative depth made on this device by
`LE.maps`, see "Maps" below). Without it, light falls on a flat plane and casts no shadows; `LE.fx.problems(doc)` does not
report this (the effects do not use a mask kind), so check `layer.maps.depth` or run `map.generate` first.

What the depth can and cannot carry: it is a small model's *relative* guess (Depth Anything V2 Small, 518 px at most). It
orders subject, ground and background reliably and gives faces, shoulders and large objects a believable roundness. It does
not give metric distances, crisp hair or thin structures, flat walls without a slight wobble, or exact cast-shadow shapes.
Keep relief 0.8 to 1.6 and softness above 0.25 for natural results; strong hard light on flat areas can look wavy.

All five effects are in linear light, neutral at their defaults (pixel-identical), tile-safe (their reach is declared), and
work per layer, through an entry `mask`, through `layerMask` and on adjustment layers (an adjustment layer has no depth map of
its own, so there it is flat light).

### relight — Relight

One light per entry; stack entries for a key, a fill and an accent. Model: Lambert with wrap (softness) + GGX specular,
inverse-square falloff normalised at the aim point, shadows ray-marched through the height field with a penumbra that widens
with distance, horizon-based contact shadows, and an albedo estimate (colour divided by an edge-aware blurred luminance) so the
new light lights surfaces by their own reflectance instead of multiplying the light already there. "Soften existing light"
divides that estimated illumination out towards the picture's mean (a Retinex-like flattening; it cannot remove hard cast
shadows or highlights already in the photo).

Passes: 3 (depth read) + 1 (edge-aware depth) + 2 Gaussian blurs (2–6 passes each, depending on radius) + 1 shading pass:
about 10–16. Draft (while dragging, or quality Draft): skips the edge-aware depth and marches 12 shadow steps instead of 32
(Standard) or 64 (High).

| Param | Type, range, default | Meaning |
|---|---|---|
| type | `directional` (Sun) · `point` (Bulb) · `spot` (Spot), `point` | kind of light |
| position | point, (0.25, 0.2) | where the light is over the photo (box fractions; −1…2 allowed). For the sun, the direction it comes from |
| height | −1…3, 0.6 | distance in front of the nearest surface, in layer widths; below 0 is behind the subject |
| aim | point, (0.5, 0.5) | where a spot points; for a bulb, where its strength is as set |
| cone | 5…89°, 35 | spot spread (half angle) |
| pattern | none · window · blinds · leaves | gobo projected by a spot |
| intensity | 0…4, **0** | 1 = as much light as the photo's average light, on a surface facing the light |
| temperature, tint | 1900…12000 K (5500), −100…100 | colour of the light (black body, luminance 1) |
| color | colour, #ffffff | a gel in front of the light |
| softness | 0…1, 0.4 | size of the light: wrap and shadow penumbra |
| falloff | 0…1, 1 | 1 = inverse square, 0 = constant (bulb and spot) |
| specular, roughness | 0…1 (0.2), 0.05…1 (0.45) | shine |
| shadows, shadowLength | 0…1 (0.7), 0…400 px (120) | shadow strength and the longest shadow (also the tile overlap) |
| relief | 0…4, 1.2 | how deep the scene is taken to be |
| existing | 0…2, 1 | multiplier on the light already in the photo |
| soften | 0…1, 0 | flatten the existing light |
| ao | 0…1, 0 | contact shadows (ambient occlusion from depth) |
| subject | bool, true | snap the depth edge to the cut-out when the layer has one |
| quality | draft · standard · high | shadow steps and edge-aware depth |

Familiar equivalent: the "relight" or "add light source" tools of portrait apps and the 3D lighting filters of photo editors.

```json
{ "type": "relight", "p": { "type": "point", "position": { "x": 0.2, "y": 0.15 }, "height": 0.6, "intensity": 1.2, "temperature": 4800, "softness": 0.5, "existing": 0.75, "soften": 0.3, "ao": 0.25 } }
```

### rim-light — Rim light

A back light outlining the subject: surfaces whose depth normal turns away from the camera towards the light, gated to the near
side of depth edges, plus the edge of the cut-out when there is one. Passes: 3 + 1 (depth) + blur (2–4) + subject mask 1 +
blur (2–4) + 1. No separate draft (the renderer's half resolution while dragging).

| Param | Range, default | Meaning |
|---|---|---|
| angle | angle, 135 | where the light comes from on the photo (0 right, 90 top, 180 left) |
| intensity | 0…4, **0** | strength |
| width | 0…1, 0.5 | how far the rim reaches in |
| temperature, color | K 6500, #ffffff | colour |
| relief | 0…4, 1.2 | depth scale |

Familiar equivalent: "rim light" / "edge light" in compositing tools.

```json
{ "type": "rim-light", "p": { "angle": 140, "intensity": 1.4, "width": 0.45, "temperature": 7000 } }
```

### light-rays — Light rays

Volumetric light (god rays): bright, far regions emit; near objects in the depth map block; light is gathered along the line to
the source (a screen-space light-scattering march). Passes: 3 (depth) + 1 emission at half size + 1 march = 5. Draft: 16 steps
(Standard 40, High 80).

| Param | Range, default | Meaning |
|---|---|---|
| source | point, (0.75, 0.08) | the light source, may lie outside the box |
| intensity | 0…3, **0** | strength |
| length | 10…600 px, 240 | longest ray (the tile overlap) |
| decay | 0…1, 0.5 | how fast rays fade |
| threshold | 0…0.98, 0.6 | only brighter areas emit |
| depth | 0…1, 0.7 | 1 = only the far background emits and near objects block |
| temperature | K, 5000 | colour |
| quality | draft · standard · high | march steps |

Familiar equivalent: "light rays", "sun beams", "volumetric light" filters.

```json
{ "type": "light-rays", "p": { "source": { "x": 0.8, "y": 0.05 }, "intensity": 0.6, "length": 300, "threshold": 0.65 } }
```

### depth-fog — Depth fog

Fog and atmospheric perspective: far parts fade towards a colour and lose saturation; optional ground fog. Passes: 3 + 1
(edge-aware depth) + 1 = 5.

| Param | Range, default | Meaning |
|---|---|---|
| amount | 0…1, **0** | strength |
| start, end | 0…1 (0.3, 1) | depth range over which the fog builds (0 nearest, 1 farthest) |
| color | #c9d3de | fog colour |
| ground | 0…1, 0 | denser towards the bottom of the picture |
| desaturate | 0…1, 0.3 | colour fade inside the fog |

Familiar equivalent: "haze", "depth fog", "atmospheric perspective" in landscape tools.

```json
{ "type": "depth-fog", "p": { "amount": 0.35, "start": 0.4, "color": "#c4cfdc" } }
```

### catchlight — Catchlights

Small highlights in the eyes; off until intensity is raised. One fused colour pass (merges with neighbouring colour effects).
`LE.fx.relight.portrait(..., { catchlights: true })` places them on the irises at the key light's clock position.

| Param | Range, default | Meaning |
|---|---|---|
| left, right | points | the two irises |
| size | 0.5…40 px, 3 | size of the highlight |
| intensity | 0…2, **0** | brightness |
| shape | round · softbox · ring · window | shape of the reflected light |
| clock | angle, 135 | direction from the iris centre |
| offset | 0…3, 1.2 | distance from the iris centre, in sizes |
| temperature | K, 6500 | colour |

```json
{ "type": "catchlight", "p": { "left": { "x": 0.43, "y": 0.38 }, "right": { "x": 0.57, "y": 0.38 }, "size": 3, "intensity": 0.8, "clock": 135 } }
```

### Helpers: `LE.fx.relight`

| Call | Returns |
|---|---|
| `presets` | plain data: `studio-key`, `rembrandt`, `butterfly`, `split`, `rim`, `golden-hour`, `softbox`, `gel-pair`; each light as azimuth, elevation and distance relative to the face |
| `portrait(doc, layerId, presetId, { catchlights, strength, replace, face })` | `{ ok, ops, warnings, face }`: `fx.remove` for earlier light entries, then `fx.add` entries placed from `layer.maps.face` (centre, width, roll, yaw from the nose against the cheeks) |
| `estimate(image, { depth, mask })` | `{ direction {x, y up, z to viewer}, azimuth, elevation, softness, ratio, temperature, color, confidence, source, words: "light comes from upper left, warm, hard", suggest }` |
| `retime(doc, layerId, 'golden' \| 'dusk' \| 'blue-hour' \| 'night', { from, practicals: [{ x, y, temperature }] })` | ops: white balance, exposure, saturation, a low key light (or none), practical lamps, depth fog |
| `depthGrade(doc, layerId, { near: [entries], far: [entries], split, soft })` | ops adding each entry with a depth mask for the near or far range |
| `backgroundDim(doc, layerId, { dim, blur, desaturate, split, soft })` | ops: exposure, Gaussian blur and saturation limited to the far range (a masked blur, not a lens; use the optics pack's depth blur for depth of field) |
| `depth.remap(v, near, far)`, `depth.stats(d)`, `depth.ground(d)` | near/far remap, percentiles, and a ground-plane fit (`{ slope, horizon, fit, plausible }`) |
| `faceInfo(layer)`, `kelvin(T, tint)` | face geometry per face; light colour |

`estimate` fits L = a + b·n by least squares (first-order Lambertian) over the subject, with normals from the depth map, or
from the cut-out mask inflated into a dome, or (weakest) from a centred dome. It is reliable on a single subject with a
mask and one dominant light (tests: a lit sphere within 25°); on a whole street or group photo without a mask it often reads
the scene's layout rather than the light (confidence says so).

### Maps: `assets/js/le-maps.js` (`LE.maps`)

Depth (16-bit PNG at the model grid, `layer.maps.depth = { asset, width, height, orientation: 'near=1', model, version, refined }`),
faces (`layer.maps.face = [packed faces]`, about 4 KB each) and person segments (`layer.maps.segments = { asset: RGB = person,
hair, skin, clothes: { asset } }`), computed on this device in a worker, only when asked. Agent operation:

```json
{ "op": "map.generate", "layer": "photo-1", "kind": "depth" }
```

`LE.maps.ops.apply(sceneOrDoc, op, opts)` runs it; `force: true` runs where `LE.support` says the device is unsupported.
