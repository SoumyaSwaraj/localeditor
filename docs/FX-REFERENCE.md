# Effect reference (`LE.fx`)

Every effect a document can use, with its parameters and an entry an agent can paste. Each feature pack owns its section; the contract for writing effects is `docs/FX-AUTHORING.md`.

## Creative pack (`assets/js/fx/le-fx-creative.js`)

Step X2 of `docs/EXPERT-MODE.md`: 45 effects for film and analog looks, optics, a blur gallery, detail, stylise and atmosphere, and 12 named looks (`LE.fx.creative.presets`). Generated from `LE.fx.describe()`; the models are documented in comments next to each registration.

Conventions:

- Every effect is **neutral at its defaults** (the strength control starts at 0, or a size at its no-op value), so adding an entry never changes the picture until a value is set.
- Lengths are document pixels (`px`) and positions are `point` values `{ x, y }` in fractions of the layer box (the workspace gives them an on-canvas handle). Procedural patterns (grain, dust, leaks, flares, halftone, textures, glitch) are seeded and drawn in document space: preview, export and every tile show the same pattern.
- "linear" effects work on linear light (light, blur, glow, optics); "display" effects on display values (perceptual controls: sharpening, tone, stylise).
- Relation to the starter pack: `grain` and `gaussian-blur` stay as the plain controls; `film-grain` supersedes `grain` for film looks (density model, roughness, mid-tone response) and the blur gallery extends `gaussian-blur` with lens-shaped and directional blurs.
- The **Draft** column is what changes while a control is dragged (`LE.fx.interactive(true)`); the renderer additionally renders spatial stacks at half resolution then.
- Editors are named only in generic words here; this section is a developer and agent reference.

| Effect | id | Section | Space | Passes | Draft |
|---|---|---|---|---|---|
| Film grain | `film-grain` | Effects | linear | merged colour pass | — |
| Halation | `halation` | Effects | linear | 1 + n down + (n − 1) up + 1, n = log2(radius) ≤ 6 | half resolution (one level fewer) |
| Bloom | `bloom` | Effects | linear | 1 + n down + (n − 1) up + 1, n = log2(radius) ≤ 6 (8 past a 400 px reach) | half resolution (one level fewer) |
| Glow | `glow` | Effects | linear | 1 + n down + (n − 1) up + 1 | half resolution |
| Light leak | `light-leak` | Effects | linear | merged colour pass | — |
| Dust and scratches | `dust-scratches` | Effects | display | merged colour pass | — |
| Fade and matte | `fade` | Effects | display | merged colour pass | — |
| Cross process | `cross-process` | Effects | display | merged colour pass (1024-entry lookup) | — |
| Chromatic aberration | `chromatic-aberration` | Optics | linear | 1 (5 taps per channel) | 1 tap per channel |
| Vignette | `vignette` | Optics | linear | merged colour pass | — |
| Lens distortion | `lens-distortion` | Optics | linear | 1 | half resolution |
| Anamorphic streaks | `anamorphic-streaks` | Optics | linear | 1 + 2–3 comb + 1 (half resolution inside) | one comb pass fewer |
| Lens flare | `lens-flare` | Optics | linear | merged colour pass | — |
| Lens blur | `lens-blur` | Optics | linear | [1 boost] + L down + 1 gather (127 taps) + [1 up] | 37 taps, half resolution |
| Depth blur | `depth-blur` | Optics | linear | 2 depth + 1 CoC + [1 boost] + 2L down + 2 gathers + 1 | 37 taps, half resolution |
| Tilt-shift blur | `tilt-shift` | Optics | linear | [1 boost] + L down + 3 gathers + 1 | fewer taps, half resolution |
| Iris blur | `iris-blur` | Optics | linear | [1 boost] + L down + 3 gathers + 1 | fewer taps, half resolution |
| Motion blur | `motion-blur` | Optics | linear | 1–3 comb passes of 10 taps | one comb pass fewer |
| Box blur | `box-blur` | Optics | linear | 2–6 comb passes | one comb pass fewer per axis |
| Radial blur | `radial-blur` | Optics | linear | 1–3 radial comb passes | one pass fewer |
| Surface blur | `surface-blur` | Optics | display | 2 (2 × 12 taps each) | half resolution |
| Soft focus and glow | `soft-focus` | Optics | linear | [1 bright pass] + Gaussian (2–14) + 1 | half resolution |
| Sharpen | `sharpen` | Detail | display | Gaussian (2 for small radii) + 1 | half resolution |
| Smart sharpen | `smart-sharpen` | Detail | linear | 3 iterations × (2 PSF + 2) + 1 | 1 iteration |
| Clarity | `clarity` | Detail | linear | 1 + 2 Gaussians + 2 | half resolution |
| Texture | `texture` | Detail | linear | 1 + 2 Gaussians + 1 | half resolution |
| Dehaze | `dehaze` | Detail | display | 1 + 2 min-down + 2 erode + 1 + 2 Gaussians + 2 | no guided refinement (8 passes) |
| Noise reduction | `noise-reduction` | Detail | display | 2 + up to 5 Gaussians + 2–3 | half resolution |
| High pass | `high-pass` | Detail | display | Gaussian + 1 | half resolution |
| Duotone | `duotone` | Effects | display | merged colour pass | — |
| Halftone | `halftone` | Effects | display | merged colour pass | — |
| Pixelate | `pixelate` | Effects | display | L down + 1 (16 taps) | half resolution |
| Posterize | `posterize` | Effects | display | merged colour pass | — |
| Threshold | `threshold` | Effects | display | merged colour pass | — |
| Glitch | `glitch` | Effects | linear | 1 | half resolution |
| Emboss | `emboss` | Effects | display | 1 | half resolution |
| Glowing edges | `edge-glow` | Effects | display | [Gaussian] + 1 | half resolution |
| Oil paint | `oil-paint` | Effects | display | 1 (up to 11 × 11 taps, 8 sectors) | 7 × 7 taps, half resolution |
| Sketch | `sketch` | Effects | display | Gaussian + 1 | half resolution |
| Texture overlay | `texture-overlay` | Effects | display | merged colour pass | — |
| Frosted glass | `frosted-glass` | Effects | linear | 1 (4 taps) | 2 taps, half resolution |
| Sun rays | `sun-rays` | Effects | linear | 1 + 1–3 radial comb + 1 (half resolution inside) | one comb pass fewer |
| Haze and fog | `haze` | Effects | linear | merged colour pass; with a depth map 2 depth + 1 | — |
| Colour wash | `color-wash` | Effects | display | merged colour pass | — |
| Sun glow | `sun-glow` | Effects | linear | merged colour pass | — |

### Film and analog

#### Film grain (`film-grain`)

Photographic film grain modelled as random density on a print: it multiplies linear light, sits mostly in the mid-tones and leaves clean highlights. Seeded and defined in document space.

Familiar equivalent: the film grain panel of raw developers and film-emulation plug-ins.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `size` | Size — Average grain size in document pixels. | number | 0.5 … 6 px | `1.2` |
| `roughness` | Roughness — Low values give soft, clumped grain; high values a crisp, irregular one. | number | 0 … 100 | `50` |
| `color` | Colour — How independent the three dye layers are. 0 is monochrome grain. | number | 0 … 100 | `0` |
| `response` | Mid-tone response — How much the grain concentrates in the mid-tones and leaves highlights clean. | number | 0 … 100 | `75` |
| `seed` | Seed | seed | integer | `1` |

- Put it last in the stack, after blur and tone, so nothing smooths it.
- Fine 35 mm stock: amount 25–35, size 1.0–1.4, roughness 40–60. Push-processed or 16 mm: amount 50–70, size 2–3.
- colour 15–30 adds the faint dye-cloud colour of colour negative film; leave it at 0 for black-and-white.
- Use the starter `grain` effect only when you want a simple, even noise.

```json
{"type":"film-grain","p":{"amount":30,"size":1.3,"roughness":55,"color":20,"seed":7}}
```

#### Halation (`halation`)

The red-orange glow film shows around bright highlights and light sources: thresholded highlights, spread and tinted, added in linear light.

Familiar equivalent: the halation control of film-emulation tools and cinema finishing software.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `threshold` | Threshold — Display brightness above which light starts to halate. | number | 0 … 1 | `0.8` |
| `radius` | Radius | number | 1 … 200 px | `10` |
| `color` | Colour | color | #rrggbb | `"#ff4a14"` |

- Subtle print look: amount 20–35, radius 6–12, threshold 0.7.
- Night scenes with lamps and neon: amount 40–60, radius 12–25, threshold 0.6.
- It is strongest where a highlight meets a dark area; nothing happens in a picture with no bright parts.

```json
{"type":"halation","p":{"amount":35,"threshold":0.7,"radius":12}}
```

#### Bloom (`bloom`)

Physically based bloom: light above a threshold spreads with a long soft tail and is added in linear light, as from a real lens and sensor.

Familiar equivalent: bloom in game engines and compositing tools; the light-spread part of a glow filter.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `threshold` | Threshold — Linear brightness where bloom starts (1 is display white). | number | 0 … 4 | `0.9` |
| `knee` | Softness — Width of the soft knee around the threshold. | number | 0 … 1 | `0.5` |
| `radius` | Radius | number | 4 … 400 px | `60` |
| `color` | Tint | color | #rrggbb | `"#ffffff"` |

- Threshold is linear: 1 is display white. Use 0.7–0.9 for a gentle glow on ordinary photos, 1.0+ to bloom only true highlights in HDR or RAW sources.
- Dreamy: amount 25, radius 80, softness 0.7. Neon at night: amount 50, threshold 0.6, radius 120.
- Put it after exposure and white balance and before grain.

```json
{"type":"bloom","p":{"amount":30,"threshold":0.8,"radius":80}}
```

#### Glow (`glow`)

A tinted glow around bright parts, blended with screen so it brightens without clipping. Use for neon, signs, product highlights.

Familiar equivalent: outer-glow and glow filters of photo and design editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `threshold` | Threshold — Display brightness where the glow starts. | number | 0 … 1 | `0.6` |
| `knee` | Softness | number | 0 … 1 | `0.4` |
| `radius` | Radius | number | 2 … 300 px | `30` |
| `color` | Tint | color | #rrggbb | `"#ffffff"` |

- Coloured neon: tint the glow with the sign colour, threshold 0.5, radius 20–40.
- Prefer bloom for a photographic light spread; glow is a graphic look.

```json
{"type":"glow","p":{"amount":35,"threshold":0.7,"radius":30,"color":"#ff7ad9"}}
```

#### Light leak (`light-leak`)

A procedural light leak or film burn entering from a point near the frame edge: warm, turbulent, seeded, screen-blended in linear light.

Familiar equivalent: light-leak overlays and film-burn transitions, generated instead of photographed.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `style` | Style | choice | `leak`, `burn`, `flash` | `"leak"` |
| `position` | Position | point | { x, y } in box fractions | `{"x":0.95,"y":0.2}` |
| `size` | Size — Fraction of the short side of the picture. | number | 0.05 … 2 | `0.6` |
| `angle` | Angle | angle | degrees | `70` |
| `color` | Colour | color | #rrggbb | `"#ff5a1f"` |
| `color2` | Core colour | color | #rrggbb | `"#ffd27a"` |
| `turbulence` | Turbulence | number | 0 … 100 | `50` |
| `seed` | Seed | seed | integer | `1` |

- Place position on or just outside an edge (x 0.95–1.1 or y −0.05–0.1) so the light seems to come from the gate.
- Leak: amount 30–50. Burn: amount 40–70 for a dramatic, blown-out corner. Flash: a soft wash over a third of the frame.
- Change seed for another shape with the same character; angle sets the direction of the streak.

```json
{"type":"light-leak","p":{"amount":40,"style":"leak","position":{"x":1,"y":0.25},"size":0.7,"seed":4}}
```

#### Dust and scratches (`dust-scratches`)

Procedural dust specks, hairs and vertical scratches of an old print or scanned negative. Seeded; drawn in document space.

Familiar equivalent: dust-and-scratches overlays used for vintage film looks (generated, no stock texture).

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `dust` | Dust | number | 0 … 100 | `50` |
| `size` | Size | number | 0.5 … 12 px | `2.5` |
| `hairs` | Hairs | number | 0 … 100 | `30` |
| `scratches` | Scratches | number | 0 … 100 | `30` |
| `polarity` | Polarity | choice | `dark`, `light`, `mixed` | `"mixed"` |
| `seed` | Seed | seed | integer | `1` |

- A believable old print: amount 60, dust 40, hairs 20, scratches 25, polarity dark.
- A dusty negative scan: polarity light, dust 70, scratches 10.
- Keep size near 2–3 px at screen sizes; it is in document pixels and scales with the export.

```json
{"type":"dust-scratches","p":{"amount":60,"dust":45,"hairs":25,"scratches":30,"seed":3}}
```

#### Fade and matte (`fade`)

Faded print and matte look: blacks lift to a chosen colour, whites dim, colours soften. A straight remap of the output range, so it stays smooth.

Familiar equivalent: the "fade" slider of photo apps and the output levels of a matte grade.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `black` | Matte black | color | #rrggbb | `"#262220"` |
| `whites` | Whites | number | 0.6 … 1 | `0.93` |
| `desaturate` | Desaturate | number | 0 … 100 | `15` |

- Classic matte: amount 60–80, matte black #2a2622, whites 0.95.
- Tint the matte black to tint the shadows: a teal black #1d2a2c gives a cool matte, #2e2318 a warm one.
- Put it after contrast and curves, before grain.

```json
{"type":"fade","p":{"amount":70,"black":"#2a2420","whites":0.95,"desaturate":10}}
```

#### Cross process (`cross-process`)

Cross-processing and related chemistry looks as per-channel tone curves (shadows, mid-tones and highlights pushed to different hues), with the matching saturation change.

Familiar equivalent: cross-process presets of photo apps; the curves are in LE.fx.creative.crossCurves and can be copied into a Curves entry.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `preset` | Process | choice | `slide-in-negative`, `negative-in-slide`, `teal-orange`, `lomo`, `warm-fade`, `cool-slide`, `bleach` | `"slide-in-negative"` |

- slide-in-negative: punchy, yellow-green highlights and blue shadows (the classic). negative-in-slide: flat, cyan-tinted.
- bleach: high contrast, low saturation (bleach-bypass print).
- amount 40–70 keeps skin believable; 100 is the full chemistry.

```json
{"type":"cross-process","p":{"preset":"slide-in-negative","amount":70}}
```

### Optics

#### Chromatic aberration (`chromatic-aberration`)

Lateral chromatic aberration: red and blue are magnified slightly differently from green about the optical centre, so colour fringes grow towards the corners. Positive adds fringing; negative values correct a lens that has it.

Familiar equivalent: the chromatic aberration sliders of lens-correction panels, used in both directions.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `redCyan` | Red / cyan fringe | number | -100 … 100 | `0` |
| `blueYellow` | Blue / yellow fringe | number | -100 … 100 | `0` |
| `falloff` | Falloff — How fast the fringe grows towards the corners (1 even, 2 like a real lens). | number | 1 … 4 | `2` |
| `shift` | Shift — An even sideways split of red and blue (a prism or a misaligned scanner). | number | -40 … 40 px | `0` |
| `angle` | Shift angle | angle | degrees | `0` |
| `center` | Optical centre | point | { x, y } in box fractions | `{"x":0.5,"y":0.5}` |

- Creative lens character: redCyan 20–40, blueYellow −10 to −20.
- To correct a real lens, look at a corner with a dark-light edge and move redCyan until the red/cyan edge disappears, then blueYellow.
- shift with an angle gives the even RGB split of a cheap scanner; glitch has a stronger version.
- It does not remove purple fringing around blown highlights (axial aberration); that needs a defringe tool.

```json
{"type":"chromatic-aberration","p":{"redCyan":35,"blueYellow":-15}}
```

#### Vignette (`vignette`)

Darkens (negative) or lightens (positive) the edges of the frame around a movable centre, in three styles: highlight priority (an exposure change that can protect highlights), colour priority (keeps hues) and paint overlay (blends to a colour).

Familiar equivalent: the post-crop vignette of raw developers, with the same controls.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | -100 … 100 | `0` |
| `style` | Style | choice | `highlight`, `color`, `paint` | `"highlight"` |
| `midpoint` | Midpoint | number | 0 … 100 | `50` |
| `roundness` | Roundness | number | -100 … 100 | `0` |
| `feather` | Feather | number | 0 … 100 | `50` |
| `highlights` | Highlights — Highlight priority only: keeps bright parts bright inside a darkening vignette. | number | 0 … 100 | `0` |
| `color` | Colour | color | #rrggbb | `"#000000"` |
| `center` | Centre | point | { x, y } in box fractions | `{"x":0.5,"y":0.5}` |

- A natural portrait vignette: amount −20 to −30, midpoint 40, feather 70, highlight priority.
- Move centre onto the subject in an off-centre composition.
- Paint overlay with a dark brown colour gives an old-print edge burn; positive amounts give a white "dreamy" edge.
- Put it after geometry effects (lens distortion) and before grain.

```json
{"type":"vignette","p":{"amount":-25,"midpoint":45,"feather":65,"style":"highlight"}}
```

#### Lens distortion (`lens-distortion`)

Barrel and pincushion distortion with the standard radial lens model about a movable centre: creative (bulge, pinch) or corrective (straighten a wide-angle or telephoto lens).

Familiar equivalent: the distortion slider of lens-correction panels.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Distortion — Positive bulges the picture (barrel); negative pinches it (pincushion). Use the opposite sign to correct a lens. | number | -100 … 100 | `0` |
| `autoScale` | Auto scale | bool | true / false | `true` |
| `edges` | Edges | choice | `transparent`, `extend` | `"transparent"` |
| `center` | Centre | point | { x, y } in box fractions | `{"x":0.5,"y":0.5}` |

- To correct barrel distortion from a wide lens use a negative amount (about −5 to −20) until lines near the edges are straight.
- A creative bulge: amount 60–100.
- autoScale keeps the frame full for pincushion; with barrel the content shrinks inside the frame and the corners stay filled.

```json
{"type":"lens-distortion","p":{"amount":40}}
```

#### Anamorphic streaks (`anamorphic-streaks`)

Long horizontal light streaks through bright points, the signature flare of anamorphic cinema lenses. Tinted (blue by default) and added in linear light.

Familiar equivalent: anamorphic streak and lens-streak plug-ins of compositing tools.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `threshold` | Threshold | number | 0 … 1 | `0.85` |
| `length` | Length | number | 20 … 3000 px | `500` |
| `color` | Tint | color | #rrggbb | `"#4f86ff"` |
| `angle` | Angle | angle | degrees | `0` |

- Works on night scenes, headlights, specular highlights; threshold 0.7–0.85 so only real lights streak.
- length is in document pixels: about the frame width for a cinematic look.
- Combine with lens-flare and a gentle vignette for a film-like frame.

```json
{"type":"anamorphic-streaks","p":{"amount":45,"threshold":0.75,"length":900}}
```

#### Lens flare (`lens-flare`)

A procedural lens flare from a positionable light: ghosts along the axis through the frame centre, a halo, a starburst, a streak and a glowing core. Seeded, so the same settings always give the same flare.

Familiar equivalent: lens flare filters of photo editors and flare plug-ins of compositing tools.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `position` | Light position | point | { x, y } in box fractions | `{"x":0.25,"y":0.22}` |
| `size` | Size | number | 0.2 … 3 | `1` |
| `ghosts` | Ghosts | number | 0 … 100 | `60` |
| `halo` | Halo | number | 0 … 100 | `35` |
| `starburst` | Starburst | number | 0 … 100 | `40` |
| `streak` | Streak | number | 0 … 100 | `20` |
| `blades` | Aperture blades | number | 5 … 9 | `6` |
| `dispersion` | Dispersion — Colour fringing of the ghosts and halo. | number | 0 … 100 | `40` |
| `color` | Tint | color | #rrggbb | `"#ffe2b8"` |
| `seed` | Seed | seed | integer | `1` |

- Put position on the real light source (the sun, a lamp); the ghosts then fall on the opposite side of the centre like a real lens.
- Tasteful: amount 30–50, ghosts 40–60, starburst 30. Keep size near 1 for a 35 mm look.
- Change seed to rearrange the ghosts; blades sets the ghost polygon and the number of rays.

```json
{"type":"lens-flare","p":{"amount":45,"position":{"x":0.22,"y":0.2},"ghosts":55,"starburst":35,"seed":2}}
```

### Blur gallery

#### Lens blur (`lens-blur`)

A blur that looks like an out-of-focus lens: bright points become discs or polygons shaped by the aperture blades, unlike a Gaussian blur. Use it with a mask (or depth-blur) to separate a subject.

Familiar equivalent: the lens blur filter of photo editors (iris shape, blade curvature, rotation, specular highlights).

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `radius` | Radius | number | 0 … 150 px | `0` |
| `catsEye` | Cat's eye — Clips the aperture towards the corners, as a fast lens does wide open. | number | 0 … 100 | `0` |
| `blades` | Blades | number | 3 … 10 | `6` |
| `curvature` | Blade curvature — 100 is a round aperture. | number | 0 … 100 | `50` |
| `rotation` | Rotation | angle | degrees | `0` |
| `highlights` | Specular highlights — Brightens highlights before blurring so they open into bright discs. | number | 0 … 100 | `0` |
| `threshold` | Highlight threshold | number | 0 … 1 | `0.85` |

- Background separation: lens-blur radius 12–25 with an inverted subject mask on the entry.
- Night bokeh: specular highlights 40–70, threshold 0.75; 6–8 blades, curvature 30 for a vintage polygon, 100 for a modern round aperture.
- radius is in document pixels; while dragging it uses fewer taps.

```json
{"type":"lens-blur","p":{"radius":14,"blades":7,"curvature":40,"highlights":40,"threshold":0.8}}
```

#### Depth blur (`depth-blur`)

Depth of field from the layer's depth map (layer.maps.depth): parts away from the focal distance blur with lens-shaped bokeh, nearer parts spill over the sharp subject, background never bleeds onto it.

Familiar equivalent: the depth-map lens blur and "portrait mode" depth effects of photo editors. Needs: `depth`.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `radius` | Blur — Largest blur, for the parts farthest from the focus plane. | number | 0 … 100 px | `0` |
| `focus` | Focal distance — 0 is the nearest point of the depth map, 1 the farthest. | number | 0 … 1 | `0.2` |
| `range` | Depth of field — Depth range around the focal distance that stays sharp. | number | 0 … 1 | `0.1` |
| `near` | Foreground blur — How much the parts in front of the focus plane blur. | number | 0 … 100 | `100` |
| `blades` | Blades | number | 3 … 10 | `6` |
| `curvature` | Blade curvature — 100 is a round aperture. | number | 0 … 100 | `50` |
| `rotation` | Rotation | angle | degrees | `0` |
| `highlights` | Specular highlights — Brightens highlights before blurring so they open into bright discs. | number | 0 … 100 | `0` |
| `threshold` | Highlight threshold | number | 0 … 1 | `0.85` |

- Needs layer.maps.depth (map.generate depth); without a map it does nothing and LE.fx.problems reports nothing for it, so check the layer has maps.depth first.
- focus is depth (0 = nearest). For a portrait: focus near the subject depth (often 0.1–0.3), range 0.05–0.15, radius 10–25.
- A soft-edged depth map gives halos at the subject edge: combine with a subject mask on a second, plain lens-blur entry for hair-level edges.
- Foreground blur 0 keeps everything in front of the focus plane sharp.

```json
{"type":"depth-blur","p":{"radius":18,"focus":0.15,"range":0.1,"highlights":30}}
```

#### Tilt-shift blur (`tilt-shift`)

A sharp band through a point with blur growing above and below it, as a tilted lens makes: the "miniature" look, or a way to lead the eye along a line.

Familiar equivalent: the tilt-shift blur of photo editors' blur galleries.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `blur` | Blur | number | 0 … 100 px | `0` |
| `center` | Centre | point | { x, y } in box fractions | `{"x":0.5,"y":0.55}` |
| `angle` | Angle | angle | degrees | `0` |
| `focus` | Focus band — Half the height of the sharp band, as a fraction of the short side. | number | 0 … 1 | `0.1` |
| `transition` | Transition | number | 0 … 1 | `0.25` |
| `highlights` | Specular highlights | number | 0 … 100 | `0` |
| `threshold` | Highlight threshold | number | 0 … 1 | `0.85` |

- Miniature look: shoot from above, centre on the subject row, focus 0.06–0.1, transition 0.2, blur 10–20, then raise vibrance.
- angle tilts the band (degrees, counter-clockwise).

```json
{"type":"tilt-shift","p":{"blur":14,"center":{"x":0.5,"y":0.6},"focus":0.08,"transition":0.22}}
```

#### Iris blur (`iris-blur`)

An elliptical sharp area around a point with lens-like blur growing outside it: a shallow-depth-of-field portrait look without a depth map.

Familiar equivalent: the iris (field) blur of photo editors' blur galleries.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `blur` | Blur | number | 0 … 100 px | `0` |
| `center` | Centre | point | { x, y } in box fractions | `{"x":0.5,"y":0.5}` |
| `rx` | Width | number | 0.02 … 2 | `0.35` |
| `ry` | Height | number | 0.02 … 2 | `0.35` |
| `angle` | Angle | angle | degrees | `0` |
| `transition` | Feather | number | 0 … 1 | `0.5` |
| `highlights` | Specular highlights | number | 0 … 100 | `0` |
| `threshold` | Highlight threshold | number | 0 … 1 | `0.85` |

- Centre on the face; width and height are fractions of the layer box; feather 0.4–0.6 for a natural fall-off.
- Prefer depth-blur when the layer has a depth map; this one does not know what is in front of what.

```json
{"type":"iris-blur","p":{"blur":16,"center":{"x":0.5,"y":0.4},"rx":0.3,"ry":0.4,"transition":0.5}}
```

#### Motion blur (`motion-blur`)

Blurs along a straight line, as when the camera or the subject moved during the exposure. Distance is the length of the movement in document pixels.

Familiar equivalent: the motion blur filter of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `angle` | Angle | angle | degrees | `0` |
| `distance` | Distance | number | 0 … 1000 px | `0` |

- Speed lines behind a moving subject: apply with an inverted subject mask, angle along the movement, distance 30–80.
- Camera shake: small distance (3–8) at an odd angle.

```json
{"type":"motion-blur","p":{"angle":0,"distance":40}}
```

#### Box blur (`box-blur`)

An even (box) blur: every pixel within the radius counts the same. Flatter and more graphic than a Gaussian; useful for backgrounds behind text.

Familiar equivalent: the box blur filter of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `radius` | Radius | number | 0 … 250 px | `0` |

- For a natural defocus use lens-blur; for a smooth soft blur use gaussian-blur.

```json
{"type":"box-blur","p":{"radius":12}}
```

#### Radial blur (`radial-blur`)

Zoom blur (streaks towards a centre, like zooming during the exposure) or spin blur (arcs around it, like a spinning wheel).

Familiar equivalent: the radial blur filter (zoom and spin) of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `mode` | Method | choice | `zoom`, `spin` | `"zoom"` |
| `center` | Centre | point | { x, y } in box fractions | `{"x":0.5,"y":0.5}` |

- Zoom burst on a subject: amount 15–30 with centre on the subject and a radial mask that keeps the subject sharp.
- Spin a wheel: mode spin, centre on the hub, amount 20–60, masked to the wheel.

```json
{"type":"radial-blur","p":{"amount":20,"mode":"zoom","center":{"x":0.5,"y":0.45}}}
```

#### Surface blur (`surface-blur`)

Smooths flat areas and keeps edges: neighbours that differ by more than the threshold are ignored. Good for skin, skies and posterised graphic looks.

Familiar equivalent: the surface blur filter of photo editors (radius, threshold in levels).

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `radius` | Radius | number | 0 … 100 px | `0` |
| `threshold` | Threshold — Differences (in levels) above which neighbours are ignored; edges with more contrast stay sharp. | number | 1 … 255 | `15` |

- Skin smoothing base: radius 6–10, threshold 10–20, then lower the entry amount to 0.5 and add texture back with film-grain.
- Painterly flats: radius 20+, threshold 30+.

```json
{"type":"surface-blur","p":{"radius":8,"threshold":18}}
```

#### Soft focus and glow (`soft-focus`)

Soft-focus looks: diffusion (a diffusion filter's gentle spread of light), Orton (the dreamy sandwich of a sharp and a blurred over-exposure) and soft glow (bright parts glow outward).

Familiar equivalent: diffusion filters, the Orton effect and the soft/diffuse glow filters of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `style` | Style | choice | `diffusion`, `orton`, `glow` | `"diffusion"` |
| `radius` | Radius | number | 1 … 200 px | `20` |
| `brightness` | Brightness — Orton and soft glow: exposure of the blurred layer. | number | -100 … 100 | `0` |

- Portraits: diffusion 25–40, radius 15–25.
- Landscapes and forests: orton 30–50, radius 20–40, brightness 0–20.
- Soft glow 30 with radius 30 gives a 1980s soft-focus portrait.

```json
{"type":"soft-focus","p":{"amount":35,"style":"orton","radius":25}}
```

### Detail

#### Sharpen (`sharpen`)

Unsharp-mask sharpening on luminance with threshold, edge masking and halo suppression, so edges crisp up without colour fringes or bright outlines.

Familiar equivalent: the unsharp mask filter and the sharpening panel of raw developers (amount, radius, masking).

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 500 % | `0` |
| `radius` | Radius | number | 0.1 … 10 px | `1` |
| `threshold` | Threshold — Levels of difference below which nothing is sharpened (protects smooth areas and noise). | number | 0 … 255 | `0` |
| `masking` | Masking — Sharpen only edges: 0 everywhere, 100 only strong edges. | number | 0 … 100 | `0` |
| `halo` | Halo suppression | number | 0 … 100 | `50` |

- Output sharpening for screens: amount 60–100, radius 0.6–1.0, halo 50.
- Portraits: masking 50–70 so skin is left alone; threshold 3–6 protects noise.
- Local contrast punch: amount 20–30, radius 20–50 (or use clarity, which avoids halos better).
- Sharpen last, after resizing effects and before grain.

```json
{"type":"sharpen","p":{"amount":90,"radius":0.9,"masking":30}}
```

#### Smart sharpen (`smart-sharpen`)

Deconvolution sharpening (Richardson–Lucy): undoes a small Gaussian, lens or motion blur instead of only raising edge contrast, with noise and halo control.

Familiar equivalent: the smart sharpen filter of photo editors (remove: Gaussian, lens or motion blur; reduce noise).

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 300 % | `0` |
| `radius` | Radius | number | 0.3 … 8 px | `1.2` |
| `remove` | Remove | choice | `gaussian`, `lens`, `motion` | `"gaussian"` |
| `angle` | Angle | angle | degrees | `0` |
| `noise` | Reduce noise | number | 0 … 100 | `10` |

- Slightly soft lens: remove lens, radius 1–2, amount 80–150.
- Small camera shake: remove motion, angle along the smear, radius = half its length.
- Raise reduce noise if flat areas get gritty. It is slower than sharpen; use sharpen for output sharpening.

```json
{"type":"smart-sharpen","p":{"amount":120,"radius":1.4,"remove":"lens","noise":15}}
```

#### Clarity (`clarity`)

Local contrast at a large scale on luminance with an edge-aware base, so mid-tone structure gains punch without halos; negative values soften it (a gentle "glow" for skin).

Familiar equivalent: the clarity slider of raw developers.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Clarity | number | -100 … 100 | `0` |
| `radius` | Radius | number | 5 … 300 px | `40` |
| `halo` | Edge protection — Higher keeps strong edges out of the effect, so no halos form around them. | number | 0 … 100 | `60` |
| `midtones` | Mid-tone focus | number | 0 … 100 | `70` |

- Landscapes and architecture: +20 to +40. Portraits: −10 to −25 on skin with a face or subject mask.
- radius in document pixels: about 2–4 % of the short side.
- Lower edge protection for a grittier, more dramatic look; raise it if bright outlines appear around dark objects.

```json
{"type":"clarity","p":{"amount":30,"radius":40}}
```

#### Texture (`texture`)

Enhances or smooths medium-sized detail (skin texture, foliage, fabric) without touching fine detail or large shapes. Negative values are a natural skin smoother.

Familiar equivalent: the texture slider of raw developers.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Texture | number | -100 … 100 | `0` |
| `size` | Detail size — Scales the band of detail (1 is fine textures such as skin pores and fabric). | number | 0.5 … 4 | `1` |

- Portrait skin: −20 to −40 with a face/skin mask; keep it above −50 or skin turns plastic.
- Product and food: +20 to +40 brings out surface detail.

```json
{"type":"texture","p":{"amount":30}}
```

#### Dehaze (`dehaze`)

Removes (positive) or adds (negative) atmospheric haze with the dark-channel-prior model: estimates how much haze each area has and the colour of the haze, then restores contrast and colour there.

Familiar equivalent: the dehaze slider of raw developers. Needs: `stats`.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Dehaze | number | -100 … 100 | `0` |

- Landscapes with distant haze: +20 to +40. Above +60 shadows can block up and noise rises: follow with highlights-shadows (shadows +20).
- Negative values (−20 to −40) add a soft, airy haze; for coloured fog use haze.
- It reads whole-picture statistics (needs: stats), so the haze colour is the same in every tile and in the preview.

```json
{"type":"dehaze","p":{"amount":30}}
```

#### Noise reduction (`noise-reduction`)

Edge-aware noise reduction: luminance smoothing that keeps edges, and colour-noise removal guided by luminance so colour edges stay. Good for moderate noise; not a replacement for a dedicated learned denoiser on very high ISO files.

Familiar equivalent: the noise reduction panel of raw developers (luminance, detail, colour).

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `luminance` | Luminance | number | 0 … 100 | `0` |
| `detail` | Detail | number | 0 … 100 | `50` |
| `color` | Colour | number | 0 … 100 | `0` |

- Phone night shots: colour 40–60, luminance 20–30, detail 50.
- Colour noise reduction is almost free of side effects; luminance above 50 starts to smooth texture.
- Put it early, before sharpening and clarity, which would otherwise amplify the noise.

```json
{"type":"noise-reduction","p":{"luminance":30,"detail":50,"color":50}}
```

#### High pass (`high-pass`)

The high-pass filter: detail finer than the radius around mid-grey. Blended with overlay or soft light it sharpens or adds local contrast; shown as is it is a detail map.

Familiar equivalent: the high pass filter of photo editors used on an overlay layer.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `radius` | Radius | number | 0.3 … 250 px | `4` |
| `mode` | Blend | choice | `show`, `overlay`, `soft-light`, `hard-light`, `linear-light` | `"overlay"` |

- High-pass sharpening: radius 1.5–3, overlay, amount 60–100.
- Local contrast: radius 30–60, soft light, amount 40.
- mode show with entry blend set to another mode reproduces any layer recipe.

```json
{"type":"high-pass","p":{"amount":80,"radius":2.5,"mode":"overlay"}}
```

### Stylise

#### Duotone (`duotone`)

Maps the picture's tones onto two (duotone) or three (tritone) colours, like a two-ink print or a graphic poster.

Familiar equivalent: duotone image modes and gradient maps of photo and design editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `tones` | Tones | choice | `2`, `3` | `"2"` |
| `shadows` | Shadows | color | #rrggbb | `"#1b2a4a"` |
| `midtones` | Mid-tones | color | #rrggbb | `"#b0566a"` |
| `highlights` | Highlights | color | #rrggbb | `"#ffe0b0"` |
| `balance` | Balance | number | -100 … 100 | `0` |

- Brand duotone: shadows = the darkest brand colour, highlights = a light tint of another; amount 100.
- A subtle split-tone look: amount 20–35 with warm highlights and cool shadows.
- balance shifts which tones get which colour.

```json
{"type":"duotone","p":{"amount":100,"shadows":"#1b2a4a","highlights":"#ffd0a0"}}
```

#### Halftone (`halftone`)

Printed halftone screens: round dots or lines in one ink, or four rotated CMYK dot screens, in document space so the pattern scales with the export.

Familiar equivalent: the colour halftone and halftone pattern filters of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `style` | Screen | choice | `dot`, `line`, `cmyk` | `"dot"` |
| `size` | Cell size — Screen frequency as cell size: 8 px is about 30 lines per 240 px. | number | 2 … 80 px | `8` |
| `angle` | Angle | angle | degrees | `45` |
| `softness` | Softness | number | 0 … 100 | `10` |
| `ink` | Ink | color | #rrggbb | `"#141414"` |
| `paper` | Paper | color | #rrggbb | `"#f6f2ea"` |

- Comic or pop-art: cmyk, size 6–10, amount 100, after a contrast boost.
- Newspaper photo: dot, size 4–6, angle 45, ink #111, paper #f3efe6.
- Very small cells fade into the tone at reduced previews; judge them at 100 %.

```json
{"type":"halftone","p":{"amount":100,"style":"dot","size":7,"angle":45}}
```

#### Pixelate (`pixelate`)

Turns the picture (or a masked area) into square blocks of its average colour. Use for pixel-art looks or to hide a face or plate with a mask.

Familiar equivalent: the mosaic / pixelate filter of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `size` | Cell size | number | 1 … 200 px | `1` |

- To anonymise, mask the area (radial or face mask) and use a cell of at least 1/8 of the face width.
- Pixel art: cell 8–16 then posterize 8–16 levels.

```json
{"type":"pixelate","p":{"size":12}}
```

#### Posterize (`posterize`)

Reduces each colour channel to a few tones, for poster and screen-print looks.

Familiar equivalent: the posterize adjustment of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `levels` | Levels — Tones per channel; 256 leaves the picture as it is. | number | 2 … 256 | `256` |

- 4–6 levels for a screen-print look; follow surface-blur or oil-paint first so the flats are clean.

```json
{"type":"posterize","p":{"levels":5}}
```

#### Threshold (`threshold`)

Black and white only: pixels brighter than the level become white, the rest black (with an optional soft edge).

Familiar equivalent: the threshold adjustment of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `level` | Level | number | 0 … 1 | `0.5` |
| `softness` | Softness | number | 0 … 0.5 | `0.01` |

- Use LE.fx.analyze median luminance as the level for a balanced result.
- With duotone after it, it becomes a two-colour stencil.

```json
{"type":"threshold","p":{"amount":100,"level":0.5}}
```

#### Glitch (`glitch`)

Digital glitch: sideways-displaced bands, an RGB channel split and scan lines. Seeded, so a look can be reproduced exactly.

Familiar equivalent: glitch and VHS effects of photo and video apps.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `split` | RGB split | number | 0 … 60 px | `0` |
| `angle` | Split angle | angle | degrees | `0` |
| `blocks` | Block displacement | number | 0 … 100 | `0` |
| `blockSize` | Block height | number | 2 … 200 px | `18` |
| `scanlines` | Scan lines | number | 0 … 100 | `0` |
| `seed` | Seed | seed | integer | `1` |

- Subtle: split 3–5, scan lines 30. Heavy: blocks 40–70, block height 10–30, split 8.
- Change seed to move the displaced bands.

```json
{"type":"glitch","p":{"split":5,"blocks":35,"blockSize":16,"scanlines":30,"seed":9}}
```

#### Emboss (`emboss`)

Relief: edges become raised or sunken as if lit from the angle, on grey or on the picture's own colours.

Familiar equivalent: the emboss filter of photo editors (angle, height, amount).

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `angle` | Angle | angle | degrees | `135` |
| `height` | Height | number | 0.5 … 20 px | `2` |
| `strength` | Strength | number | 10 … 500 % | `100` |
| `color` | Keep colour | bool | true / false | `false` |

- Stamped metal: amount 100, height 2, strength 150, grey. A subtle relief on the photo: keep colour, amount 40.

```json
{"type":"emboss","p":{"amount":100,"angle":135,"height":2,"strength":120}}
```

#### Glowing edges (`edge-glow`)

Neon outlines: the picture's edges glow in their own colours on black.

Familiar equivalent: the glowing edges filter of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `width` | Edge width | number | 0.5 … 10 px | `1.5` |
| `brightness` | Edge brightness | number | 0 … 100 | `50` |
| `smoothness` | Smoothness | number | 0 … 10 px | `1` |

- Follow with glow (threshold 0.3) for a neon-sign look.
- Raise smoothness on noisy photos so only real edges light up.

```json
{"type":"edge-glow","p":{"amount":100,"width":1.5,"brightness":60}}
```

#### Oil paint (`oil-paint`)

A painterly look: flat, brush-like patches of colour with crisp edges (a generalised Kuwahara filter).

Familiar equivalent: oil paint and painterly filters of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `radius` | Brush size | number | 0 … 30 px | `0` |
| `sharpness` | Sharpness | number | 0 … 100 | `60` |

- Brush size 3–6 on a 1,000–2,000 px picture; follow with texture-overlay (canvas) and a little clarity for a painting.
- Higher sharpness keeps edges crisper.

```json
{"type":"oil-paint","p":{"radius":5,"sharpness":60}}
```

#### Sketch (`sketch`)

Turns the photo into a pencil sketch: dark strokes where edges and texture are, white elsewhere; optionally coloured pencil.

Familiar equivalent: sketch and photocopy filters of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `radius` | Stroke width | number | 0.5 … 30 px | `4` |
| `darkness` | Darkness | number | 0 … 100 | `40` |
| `color` | Colour pencil | number | 0 … 100 | `0` |

- Add texture-overlay (paper) after it for a drawing on paper.
- Stroke width 2–5 for fine lines; 10+ for charcoal.

```json
{"type":"sketch","p":{"amount":100,"radius":4,"darkness":45}}
```

#### Texture overlay (`texture-overlay`)

A generated surface texture (paper, canvas or concrete) lit from an angle and soft-light blended over the picture, so it looks printed or painted on that surface.

Familiar equivalent: texture overlays and the texturizer filter of photo editors, generated instead of photographed.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `style` | Texture | choice | `paper`, `canvas`, `concrete` | `"paper"` |
| `scale` | Scale | number | 0.25 … 4 | `1` |
| `relief` | Relief | number | 0 … 100 | `50` |
| `angle` | Light angle | angle | degrees | `135` |
| `seed` | Seed | seed | integer | `1` |

- After oil-paint: canvas, amount 50–70. After sketch: paper, amount 60.
- scale changes the grain of the surface; relief its depth.

```json
{"type":"texture-overlay","p":{"amount":60,"style":"paper","relief":50}}
```

#### Frosted glass (`frosted-glass`)

Looks through ground glass: pixels are scattered randomly by up to the given distance (seeded).

Familiar equivalent: the diffuse glass and frosted glass filters of photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Scatter | number | 0 … 50 px | `0` |
| `grain` | Grain | number | 0.5 … 10 px | `1` |
| `seed` | Seed | seed | integer | `1` |

- Background for text: scatter 8–15 on a masked area; combine with gaussian-blur 2 for a smoother frost.

```json
{"type":"frosted-glass","p":{"amount":8,"grain":1.5}}
```

#### Sun rays (`sun-rays`)

God rays: light from a point streams through the bright gaps of the picture (trees, windows, clouds) as visible beams.

Familiar equivalent: sun-ray and light-ray plug-ins of photo and compositing tools.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `position` | Light position | point | { x, y } in box fractions | `{"x":0.5,"y":0.15}` |
| `threshold` | Threshold | number | 0 … 1 | `0.7` |
| `length` | Length | number | 5 … 100 | `50` |
| `color` | Tint | color | #rrggbb | `"#fff0d2"` |

- Put position on the sun or the brightest gap; threshold 0.6–0.8 so only the sky and openings feed the rays.
- Pair with haze (amount 15–25) for atmosphere and with sun-glow at the same position.

```json
{"type":"sun-rays","p":{"amount":50,"position":{"x":0.6,"y":0.1},"threshold":0.7,"length":60}}
```

### Atmosphere

#### Haze and fog (`haze`)

Atmospheric haze or fog with the physical exponential law: farther parts fade towards the fog colour. Distance comes from the depth map, a ramp towards the horizon, or is even.

Familiar equivalent: fog and haze filters, and the "add haze" direction of dehaze. Needs: `depth`.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Density | number | 0 … 100 | `0` |
| `color` | Colour | color | #rrggbb | `"#c9d2da"` |
| `source` | Distance | choice | `flat`, `gradient`, `depth` | `"gradient"` |
| `horizon` | Horizon — Gradient: where the fog is densest (fraction of the height from the top). | number | 0 … 1 | `0.4` |
| `softness` | Fall-off | number | 0 … 100 | `40` |
| `near` | Near — Depth map: depth where the fog starts. | number | 0 … 1 | `0` |
| `far` | Far — Depth map: depth of full density. | number | 0 … 1 | `1` |

- With a depth map (source depth) the fog follows the scene: amount 30–60, near 0.2, far 1.
- Landscape without a map: gradient, horizon at the real horizon line, amount 25–40.
- Match the fog colour to the sky near the horizon (sample it with LE.fx.analyze region).

```json
{"type":"haze","p":{"amount":35,"source":"gradient","horizon":0.4,"color":"#cfd8e2"}}
```

#### Colour wash (`color-wash`)

A colour (or two-colour gradient) laid over the picture with a blend mode: warm or cool washes, sunset gradients, brand-colour tints.

Familiar equivalent: a solid-colour or gradient fill layer with a blend mode in photo editors.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `color` | Colour | color | #rrggbb | `"#ff9a5c"` |
| `color2` | Second colour | color | #rrggbb | `"#3a6cff"` |
| `style` | Fill | choice | `solid`, `linear`, `radial` | `"solid"` |
| `start` | Start | point | { x, y } in box fractions | `{"x":0.5,"y":0}` |
| `end` | End | point | { x, y } in box fractions | `{"x":0.5,"y":1}` |
| `mode` | Blend | choice | `soft-light`, `overlay`, `color`, `screen`, `multiply`, `normal` | `"soft-light"` |

- Golden-hour warmth: color #ff9a5c, soft light, amount 30.
- Sunset sky: linear from start (0.5, 0) orange to end (0.5, 0.6) violet, soft light, amount 40, masked to the sky.
- mode color recolours while keeping luminance.

```json
{"type":"color-wash","p":{"amount":30,"color":"#ff9a5c","mode":"soft-light"}}
```

#### Sun glow (`sun-glow`)

A warm glow around a point (the sun, a lamp) with veiling glare that softens contrast near it, added in linear light.

Familiar equivalent: the sun-glow / light-source glow of photo and compositing tools.

| Parameter | Label | Type | Range | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 100 | `0` |
| `position` | Position | point | { x, y } in box fractions | `{"x":0.75,"y":0.2}` |
| `size` | Size | number | 0.05 … 2 | `0.5` |
| `color` | Colour | color | #rrggbb | `"#ffb35c"` |
| `veil` | Veil — How much the glow washes out contrast around the sun. | number | 0 … 100 | `40` |

- Golden hour: position on the sun, size 0.4–0.7, amount 40–60, colour #ffb35c.
- Combine with sun-rays and lens-flare at the same position for a backlit scene.

```json
{"type":"sun-glow","p":{"amount":50,"position":{"x":0.8,"y":0.15},"size":0.5}}
```

### Named looks (`LE.fx.creative.presets`)

Plain data: `{ id: { name, summary, fx: [entries] } }`. `LE.fx.creative.look(id)` returns a fresh copy of the entries, ready for `fx.add` (one by one, in order) or for `adjust.add { fx }` as one adjustment layer. Each look mixes this pack with the starter effects; tune the entries afterwards like any other.

| id | Name | What it does | Entries |
|---|---|---|---|
| `35mm-print` | 35 mm print | Colour negative printed on paper: gentle contrast, lifted warm blacks, halation on highlights, fine grain. | `contrast` → `cross-process` → `fade` → `halation` → `vignette` → `film-grain` |
| `dreamy-portrait` | Dreamy portrait | Soft diffusion, glowing highlights, smoothed skin texture, a pale airy finish. | `texture` → `soft-focus` → `bloom` → `fade` → `vignette` → `film-grain` |
| `night-neon` | Night neon | City lights that bloom, streak and fringe, with cool shadows and grain. | `curves` → `bloom` → `halation` → `anamorphic-streaks` → `chromatic-aberration` → `film-grain` |
| `product-pop` | Product pop | Crisp, clean commercial finish: clarity and texture, output sharpening, a gentle edge falloff. | `dehaze` → `clarity` → `texture` → `saturation` → `vignette` → `sharpen` |
| `faded-summer` | Faded summer | Warm, washed-out holiday print with a light leak from the edge. | `cross-process` → `fade` → `light-leak` → `film-grain` |
| `cinematic-anamorphic` | Cinematic anamorphic | Teal-and-orange grade, anamorphic streaks and flare, a darker frame edge. | `cross-process` → `anamorphic-streaks` → `lens-flare` → `vignette` → `film-grain` |
| `vintage-damaged` | Vintage damaged print | An old, handled print: faded, burnt at one corner, dusty and scratched. | `cross-process` → `fade` → `light-leak` → `vignette` → `film-grain` → `dust-scratches` |
| `misty-morning` | Misty morning | Soft fog towards the horizon, a low warm sun and a glow. | `haze` → `sun-glow` → `soft-focus` → `fade` |
| `crisp-landscape` | Crisp landscape | Haze removed, structure and texture brought out, sharpened for screens. | `dehaze` → `clarity` → `texture` → `saturation` → `vignette` → `sharpen` |
| `miniature` | Miniature | The tilt-shift toy-town look: a narrow sharp band, saturated colour, bright and crisp. | `saturation` → `contrast` → `clarity` → `tilt-shift` |
| `cross-processed-90s` | Cross-processed 90s | Slide film in negative chemistry: punchy, yellow-green highlights, blue shadows, heavy vignette. | `cross-process` → `vignette` → `chromatic-aberration` → `film-grain` |
| `comic-print` | Comic print | Posterised flats on CMYK halftone dots, like a printed comic panel. | `surface-blur` → `contrast` → `posterize` → `halftone` |

Example: apply a look as an adjustment layer.

```js
LE.fx.ops.apply(doc, { op: 'adjust.add', name: 'Night neon', fx: LE.fx.creative.look('night-neon') })
```

### Limits and seams (creative pack)

- **Reach that depends on the layer box.** `radius(p, scale)` is not given the layer box, so effects whose reach is a fraction of the picture (chromatic aberration, lens distortion, radial blur, sun rays) assume a box of about 3,000 × 2,000 document pixels. Larger boxes are exact whenever the picture renders as one rectangle; a tiled export of a larger box can show faint seams with extreme settings. Proposal: `radius(p, scale, box)`.
- **Sun rays** read up to the whole picture around each point (rays cross the frame); in tiled exports every tile carries most of the picture, which is slow, and past the device's tile reach (about 1,200 px on a `high` device) the renderer clamps it with a console note.
- **Depth blur** is a single-image gather: what lies behind a blurred foreground edge is unknown, so such edges become partly transparent over the sharp background instead of revealing it; a soft or misaligned depth map gives halos at depth edges. The depth map is read through the mask machinery (proposal: `g.depth()`).
- **Noise reduction** is an edge-aware (guided-filter) smoother in a luminance/colour-difference space: good on moderate noise and colour blotches, not comparable to patch-based or learned denoisers on high-ISO files.
- **8-bit devices** (no float targets): clarity, texture, dehaze and noise reduction keep their intermediate statistics in 8 bits and lose precision; bloom and halation cannot hold values above white between passes.
