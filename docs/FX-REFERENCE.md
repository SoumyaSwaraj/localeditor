# Effect reference

Every effect registered with `LE.fx`, by pack. The tables are generated from the registry (`LE.fx.describe()`); the prose is
written by each pack. Familiar-editor names are given as references in this document only; the interface uses generic words.

## Shadows, reflections and compositing (`le-fx-composite.js`, step X3)

The pack product photographers and agents use for product shots: a cut-out subject (`layer.cutout`) placed on a new background,
given a contact shadow, a cast or floating shadow, a reflection, clean edges, the background's colour and light, and the full
professional blend-mode set.

### How the pack works

- **Linear light, premultiplied.** Shadows, glows and reflections are built and composited in linear light with premultiplied
  alpha, *under* what is already there (subject over shadow). A shadow therefore never darkens the subject, and two shadows that
  overlap multiply instead of adding (no double darkening).
- **Shadow blend `receive: 'linear'` (the default).** The page compositor draws layers source-over in sRGB. A shadow of strength
  `s` and tint `T` should multiply the backdrop by `m = 1 − s·(1 − T)` in linear light; because sRGB is close to a 2.2 power law,
  that is the same as multiplying the encoded backdrop by `m^(1/2.2)`, whatever the backdrop is. The shadow is written with
  alpha `1 − min(m^(1/2.2))` and the colour that makes a white backdrop exact. Neutral shadows are within about 2 % of a true
  linear multiply on any backdrop (tested); tinted shadows are exact on white, approximate on dark backdrops. `receive: 'normal'`
  is the painter's over (use it for flat-design long shadows in a brand colour).
- **Ground geometry.** The subject is a flat card standing on a ground plane. `anchor` (a `point`, fraction of the layer box) is
  where its base meets the ground; `LE.fx.composite.contact()` measures it from the cut-out (lowest 3 % band of the alpha) and
  `stage()` writes it in, together with the subject's height in document pixels.
- **Order in the stack.** Silhouette effects (`needs: ['alpha']`) run after the cut-out and layer mask, in stack order. Use
  `refine-edge` → `floor-reflection` / `water-reflection` → `contact-shadow` → `cast-shadow` / `floating-shadow`. A reflection
  placed after a shadow would reflect the shadow; shadows only cast from the part of the silhouette above the contact line, so a
  reflection placed before them never casts a shadow.
- **Neutral at defaults.** Every effect's strength (`opacity`, `amount`, `intensity`) defaults to 0, or its geometry to the identity,
  so an entry added by the develop panel draws nothing until a slider moves, and declares no `grow` or `radius` until then.
- **Draw-time effects.** `light-wrap`, `blend-options`, `apply-image` and `displace` read the pixels behind the layer
  (`needs: ['scene']`), so they run at draw time in the studio. `LE.fx.apply()` on a bare canvas has no scene and skips them.

### Agent helpers (`LE.fx.composite`)

| Call | Returns |
|---|---|
| `contact(canvas \| { scene, layer })` | `{ x, y, left, right, top, bottom, width, height, coverage }`: the contact point (middle of the lowest band of the subject) and bounding box, as fractions of the image (= the layer box when uncropped). |
| `stage(docOrScene, layerId, presetId, { contact?, replace? })` | `{ ok, ops, geometry, background, preset }`: `fx.add` operations (and `fx.remove` for this pack's earlier entries with `replace`) that make a professional product shot; apply them in order with `LEAgent.apply` / `LE.fx.ops.apply`, then set `background`. Given a live `LE.Scene`, the contact is measured from the cut-out. |
| `presets` | plain data: `studio-white-sweep`, `soft-table-reflection`, `hard-sun`, `floating`, `dark-glossy`. A value `{ of: 'height' \| 'width', k }` is `k` × the subject's size in document pixels; `'anchor'` is the measured contact point. |
| `match(subject, target, opts)` → Promise, `match.sync(...)` | `{ entry: { type: 'match-color', p }, stats, whiteBalance }`: Oklab mean and spread of the subject (alpha-weighted) and the target (`opts.targetRegion` limits it). Sources: canvas, image, ImageData, `{ scene, layer }`, or `{ scene }` (the page). |
| `matchNoise(subject, background)` | `{ grain, blur, entries, stats }`: a `grain` entry when the background is noisier (Immerkær's noise estimate), a `gaussian-blur` when the subject is sharper (variance of the Laplacian). Measure both at the size they are composited at. |
| `quadFromPlane(points, { layer, layerAspect, aspect, fit, margin, frame })` | `{ quad, op }`: corners for `transform.set` that place a layer on the planar surface `points` (TL, TR, BR, BL, page units). `fit: 'contain' \| 'cover'` keeps the artwork's aspect on the surface; the surface's true aspect is estimated from the perspective (Zhang & He) when `aspect` is not given. |
| `planeAspect(points, frame)` | the estimated width / height of the rectangle seen as `points`. |
| `shadowFromVanishing({ vanish \| foot, contact, ground, light })` | `{ direction, imageAngle }`: the `cast-shadow` direction that follows the scene's shadow vanishing point (sun) or radiates from a lamp's foot point; give every subject the same `vanish` and their shadows agree. |
| `blend(mode, b, s)`, `blendIf(v, lo0, lo1, hi0, hi1)`, `transfer(rgbLinear, p)` | CPU references of the blend formulas, blend-if ramp and Oklab transfer (the tests compare the shaders with them). |
| `blendModes` | `{ effect, entry, compositor, labels }`: which blend modes exist where (below). |
| `meshIdentity()`, `meshCylinder(bulge, squeeze)`, `bezierPatch(points, u, v)` | starting control nets for `mesh-warp`, and the patch itself. |

### Blend modes: where each one lives

| Where | Modes |
|---|---|
| Studio compositor (`layer.blend`, drawn by the 2D canvas) | normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity |
| Effect entry blend (`fx[i].blend`) | normal, multiply, screen, overlay, soft-light, hard-light, darken, lighten, difference, color, luminosity |
| `blend-options` effect (this pack) | all of the above plus dissolve, linear burn, darker colour, linear dodge (add), lighter colour, vivid light, linear light, pin light, hard mix, subtract, divide — 27 in all, with fill opacity and blend-if |

Formulas: W3C Compositing and Blending Level 1 for the separable and non-separable modes (soft light is the W3C version, which
differs slightly from one well-known editor's), and the usual definitions of linear burn/dodge (`b + s − 1`, `b + s`), vivid light
(burn with `2s` below half, dodge with `2s − 1` above), linear light (`b + 2s − 1`), pin light, hard mix (`b + s ≥ 1`), subtract,
divide, darker/lighter colour (whole colour by luminosity). Dissolve is a seeded threshold on alpha in document space.

### Proposed on-canvas handles

- `point` parameters (`anchor` on every shadow and reflection) already get a handle from the workspace.
- `mesh-warp` declares `ui.handles = { kind: 'mesh', rows: 4, cols: 4, params: ['p00' … 'p33'] }`: 16 point handles joined
  by lines along rows and columns (the Bézier control net). Until the workspace draws it, each point has its own handle.
- `cast-shadow`: a proposed `{ kind: 'shadow', anchor: 'anchor', direction: 'direction', length: elevation }` handle: drag the tip
  of the shadow to set direction and elevation at once (the familiar "drag the shadow" gesture).

### Effects

### `cast-shadow` — Cast shadow

A shadow cast by the cut-out onto the ground, from a light at a direction and elevation: hard at the contact, softer and fainter with distance. Composited under the subject in linear light.

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: the hand-made cast shadow (a drop-shadow layer distorted onto the floor, then blurred through a gradient mask) in Photoshop; the perspective shadow of product-shot plugins.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `direction` | angle |  | `300` | Direction: Where the shadow falls on the ground: 0° right, 90° toward the camera, 180° left, 270° away. |
| `elevation` | number | 5 – 85 deg | `35` | Light elevation |
| `ground` | number | 0.05 – 1 | `0.3` | Ground tilt: How much the ground recedes: low for a camera near the floor, 1 for a top view. |
| `perspective` | number | 0 – 1 | `0.25` | Perspective |
| `blurNear` | number | 0 – 60 px | `1.5` | Contact blur |
| `blurFar` | number | 0 – 250 px | `28` | Far blur |
| `fade` | number | 0 – 1 | `0.7` | Fade |
| `height` | number | 1 – 10000 px | `300` | Subject height: Height of the subject above the contact point. Sets how the blur and fade grow and how far the shadow may reach; stage() and contact() fill it. |
| `anchor` | point |  | `{"x":0.5,"y":1}` | Contact point: Where the subject meets the ground, as a fraction of the layer box. LE.fx.composite.contact() measures it. |
| `clip` | bool |  | `false` | Clip at a line |
| `clipY` | number | -1 – 2 | `0.5` | Clip line: Fraction of the box height: the shadow is removed above it (a wall, a table edge). |
| `clipSoft` | number | 0 – 100 px | `2` | Clip softness |
| `color` | color |  | `"#000000"` | Colour |
| `receive` | choice | `linear` `normal` | `"linear"` | Blend |
| `only` | bool |  | `false` | Shadow only: Hide the subject and keep only the shadow, to export it on transparency. |

Tips: Set anchor and height from LE.fx.composite.contact() (or use stage()); a wrong contact point makes the shadow float, a too small height cuts off the far end. Soft daylight: elevation 35–50, blurNear 1–2, blurFar 0.05–0.1 × subject height, opacity 0.5–0.7. Hard sun: elevation 25–40, blurFar 4–8, opacity 0.75. direction 270 (away) hides most of the shadow behind the subject; 300–330 or 210–240 read best. Use shadowFromVanishing() so several subjects agree. Put it after floor-reflection and refine-edge in the stack; pair with contact-shadow for a grounded look. Each tile must read the whole shadow length: very long shadows (elevation under 15°) on large exports can exceed the tile reach and show seams.

```json
{"type":"cast-shadow","p":{"opacity":0.6,"direction":315,"elevation":38,"ground":0.3,"blurNear":1.5,"blurFar":30,"fade":0.7,"height":420,"anchor":{"x":0.5,"y":0.95}}}
```

### `contact-shadow` — Contact shadow

A tight, dark, soft occlusion where the subject touches the ground; the single most important cue that an object sits on a surface.

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: a painted, squashed black ellipse with a Gaussian blur under the product; ambient occlusion in 3D renderers.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `distance` | number | 0.5 – 200 px | `20` | Reach |
| `softness` | number | 0 – 100 px | `2.5` | Softness |
| `squash` | number | 0.05 – 1 | `0.3` | Squash: How flat the occlusion lies on the ground: low for a camera near the floor. |
| `anchor` | point |  | `{"x":0.5,"y":1}` | Contact point: Where the subject meets the ground, as a fraction of the layer box. LE.fx.composite.contact() measures it. |
| `color` | color |  | `"#000000"` | Colour |
| `receive` | choice | `linear` `normal` | `"linear"` | Blend |
| `only` | bool |  | `false` | Shadow only: Hide the subject and keep only the shadow, to export it on transparency. |

Tips: Typical: opacity 0.8–0.9, distance 0.06–0.08 × subject height, softness 0.01 × height, squash 0.25–0.3 (the occlusion lies about distance × squash deep on the ground). Always pair with a cast or floating shadow for a product shot; alone it reads as a studio sweep with overhead light. Needs a correct anchor (LE.fx.composite.contact()).

```json
{"type":"contact-shadow","p":{"opacity":0.85,"distance":24,"softness":3,"squash":0.3,"anchor":{"x":0.5,"y":0.95}}}
```

### `floating-shadow` — Floating shadow

An elliptical shadow on the ground under a hovering object: wider, softer and fainter as height grows. One pass, no neighbourhood.

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: the blurred ellipse shadow of floating e-commerce shots.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `height` | number | 0 – 1000 px | `40` | Height: How far the object hovers above the ground. |
| `width` | number | 2 – 8000 px | `240` | Width: Shadow width at height 0, usually 0.8 × the subject width. |
| `aspect` | number | 0.02 – 1 | `0.14` | Flatness |
| `softness` | number | 0 – 200 px | `6` | Softness |
| `core` | number | 0 – 1 | `0.35` | Core |
| `drop` | number | 0 – 2 | `1` | Ground distance: How far below the contact point the shadow lies, as a multiple of height. |
| `anchor` | point |  | `{"x":0.5,"y":1}` | Contact point: Where the subject meets the ground, as a fraction of the layer box. LE.fx.composite.contact() measures it. |
| `color` | color |  | `"#000000"` | Colour |
| `receive` | choice | `linear` `normal` | `"linear"` | Blend |
| `only` | bool |  | `false` | Shadow only: Hide the subject and keep only the shadow, to export it on transparency. |

Tips: Typical floating product: opacity 0.5, height 0.1–0.2 × subject height, width 0.8 × subject width, flatness 0.12. Set anchor to the bottom of the subject (contact()); the shadow sits height × drop below it. For a resting object use contact-shadow instead.

```json
{"type":"floating-shadow","p":{"opacity":0.5,"height":60,"width":300,"aspect":0.12,"softness":8,"anchor":{"x":0.5,"y":0.92}}}
```

### `studio-shadow` — Studio shadow

A professional drop shadow from the silhouette: angle, distance, size, spread and noise, optionally stacked in 2–4 layers for a soft natural falloff. Composited under the subject.

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: Layer Style > Drop Shadow (Angle, Distance, Spread, Size, Noise, layer knocks out drop shadow), stacked like layered CSS box-shadows.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `angle` | angle |  | `120` | Angle: Where the light comes from (90° = from above); the shadow falls the other way. |
| `distance` | number | 0 – 1000 px | `18` | Distance |
| `size` | number | 0 – 250 px | `24` | Size |
| `spread` | number | 0 – 0.95 | `0` | Spread |
| `layers` | number | 1 – 4 | `1` | Layers: Stack 2–4 shadows of doubling size for a natural, layered falloff. |
| `noise` | number | 0 – 1 | `0` | Noise |
| `seed` | seed |  | `1` | Seed |
| `color` | color |  | `"#000000"` | Colour |
| `receive` | choice | `linear` `normal` | `"linear"` | Blend |
| `only` | bool |  | `false` | Shadow only: Hide the subject and keep only the shadow, to export it on transparency. |

Tips: UI cards and floating objects: layers 3, distance 0.05 × height, size 0.08 × height, opacity 0.35. Sticker look: layers 1, size 0, spread 0, distance 6, opacity 0.9. angle follows the familiar convention: 120° puts the shadow down and to the right. For an object standing on a floor use cast-shadow + contact-shadow instead.

```json
{"type":"studio-shadow","p":{"opacity":0.4,"angle":110,"distance":24,"size":36,"layers":3}}
```

### `inner-shadow` — Inner shadow

A shadow inside the silhouette, as if the shape were cut into the surface; multiplies the subject in linear light.

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: Layer Style > Inner Shadow (Angle, Distance, Choke, Size, Noise).

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `angle` | angle |  | `120` | Angle |
| `distance` | number | 0 – 500 px | `6` | Distance |
| `size` | number | 0 – 250 px | `8` | Size |
| `choke` | number | 0 – 0.95 | `0` | Choke |
| `noise` | number | 0 – 1 | `0` | Noise |
| `color` | color |  | `"#000000"` | Colour |
| `seed` | seed |  | `1` | Seed |

Tips: Pressed or engraved look: distance 4, size 6, opacity 0.6. distance 0 with a large size gives an inner vignette that follows the shape.

```json
{"type":"inner-shadow","p":{"opacity":0.55,"angle":120,"distance":5,"size":7}}
```

### `outer-glow` — Outer glow

A coloured halo around the silhouette, drawn under the subject.

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: Layer Style > Outer Glow (Spread, Size).

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `size` | number | 0 – 250 px | `16` | Size |
| `spread` | number | 0 – 0.95 | `0.1` | Spread |
| `color` | color |  | `"#fff3c4"` | Colour |
| `only` | bool |  | `false` | Shadow only: Hide the subject and keep only the shadow, to export it on transparency. |

Tips: Neon or backlit look on dark backgrounds: size 20–40, spread 0.1, a saturated colour. On light backgrounds a glow reads as a fringe; prefer a soft studio-shadow.

```json
{"type":"outer-glow","p":{"opacity":0.8,"size":24,"spread":0.15,"color":"#7fd4ff"}}
```

### `inner-glow` — Inner glow

Light that screens over the subject from its edges inward (or from its centre outward).

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: Layer Style > Inner Glow (Source: Edge / Center, Choke, Size).

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `source` | choice | `edge` `center` | `"edge"` | Source |
| `size` | number | 0 – 250 px | `12` | Size |
| `choke` | number | 0 – 0.95 | `0` | Choke |
| `color` | color |  | `"#fff3c4"` | Colour |

Tips: Edge, size 10, opacity 0.4, a warm white: a subtle backlit rim on icons and text.

```json
{"type":"inner-glow","p":{"opacity":0.4,"size":10,"color":"#ffffff"}}
```

### `edge-light` — Edge light

Adds light (linear, additive) along the edge of the silhouette that faces a light: a simple rim or kicker light to match a bright background. True relighting is a later pack.

Space `linear`, needs `alpha`. Section: Compositing.

Familiar equivalent: a rim light faked with an offset, inverted alpha on Screen; the simple version of relighting.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `intensity` | number | 0 – 4 | `0` | Intensity |
| `angle` | angle |  | `135` | Light angle: Where the light comes from: 0° right, 90° above, 180° left. |
| `width` | number | 0.5 – 100 px | `4` | Width |
| `softness` | number | 0 – 100 px | `3` | Softness |
| `color` | color |  | `"#ffffff"` | Colour |

Tips: Match the angle to the brightest area of the background; intensity 0.3–0.8, width 3–6, softness 2–4. Use a colour sampled from the background light for integration.

```json
{"type":"edge-light","p":{"intensity":0.6,"angle":140,"width":4,"softness":3,"color":"#fff1d6"}}
```

### `long-shadow` — Long shadow

The flat-design long shadow: the silhouette extruded along a direction, hard-edged, optionally fading. Log2(length) passes.

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: the flat-design long shadow (repeated offset copies, merged).

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `angle` | angle |  | `135` | Angle: Where the light comes from; 135° sends the shadow down and to the right. |
| `length` | number | 1 – 2000 px | `200` | Length |
| `fade` | number | 0 – 1 | `0` | Fade |
| `color` | color |  | `"#000000"` | Colour |
| `receive` | choice | `linear` `normal` | `"linear"` | Blend |
| `only` | bool |  | `false` | Shadow only: Hide the subject and keep only the shadow, to export it on transparency. |

Tips: Icons and lettering: angle 135, length 3–5× the shape size, opacity 0.25, colour a darker shade of the background. Clip the page or group to the background shape so the shadow ends at its edge.

```json
{"type":"long-shadow","p":{"opacity":0.3,"angle":135,"length":400,"fade":0.4,"color":"#1d3557","receive":"normal"}}
```

### `floor-reflection` — Floor reflection

A mirror image of the subject on a glossy floor: flipped about the contact line, fading and blurring with distance, stronger near the contact (fresnel), optionally rippled.

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: the flipped, gradient-masked, blurred reflection layer of product shots; a glossy floor in 3D renderers.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `distance` | number | 1 – 4000 px | `240` | Fade distance |
| `blur` | number | 0 – 60 px | `0.5` | Blur |
| `roughness` | number | 0 – 1 | `0.15` | Roughness: Blur that grows with distance from the contact line. |
| `fresnel` | number | 0 – 1 | `0.5` | Fresnel |
| `perspective` | number | 0.3 – 1.5 | `1` | Perspective: Height of the reflection against the subject: below 1 for a camera above the floor. |
| `tint` | color |  | `"#ffffff"` | Surface colour |
| `anchor` | point |  | `{"x":0.5,"y":1}` | Contact point: Where the subject meets the ground, as a fraction of the layer box. LE.fx.composite.contact() measures it. |
| `ripple` | number | 0 – 2 | `0` | Ripple |
| `waveSize` | number | 1 – 200 px | `18` | Ripple size |
| `seed` | seed |  | `1` | Seed |
| `only` | bool |  | `false` | Reflection only |

Tips: Glossy acrylic: opacity 0.35, distance 0.5 × subject height, roughness 0.1, fresnel 0.6. Satin table: opacity 0.2, roughness 0.5, distance 0.35 × height. Dark glossy surface: tint near the floor colour (e.g. #808080) and opacity 0.5. Put it before the shadows in the stack, so shadows are not reflected; reflections are only drawn below the contact line. perspective 0.8–0.95 when the camera looks down on the product.

```json
{"type":"floor-reflection","p":{"opacity":0.35,"distance":300,"roughness":0.12,"fresnel":0.6,"anchor":{"x":0.5,"y":0.95}}}
```

### `water-reflection` — Water reflection

A reflection on water: the mirrored subject broken by seeded, horizontally stretched waves, tinted by the water colour and fading with distance.

Space `linear`, needs `alpha`. Section: Shadows & reflections.

Familiar equivalent: the flood/water-reflection filters of plugins; a flipped layer through a wave displacement map.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `distance` | number | 1 – 4000 px | `600` | Fade distance |
| `blur` | number | 0 – 60 px | `0.5` | Blur |
| `roughness` | number | 0 – 1 | `0.05` | Roughness |
| `fresnel` | number | 0 – 1 | `0.3` | Fresnel |
| `perspective` | number | 0.3 – 1.5 | `1` | Perspective: Height of the reflection against the subject: below 1 for a camera above the floor. |
| `tint` | color |  | `"#b8c8d0"` | Water colour |
| `anchor` | point |  | `{"x":0.5,"y":1}` | Contact point: Where the subject meets the ground, as a fraction of the layer box. LE.fx.composite.contact() measures it. |
| `ripple` | number | 0 – 2 | `0.6` | Waves |
| `waveSize` | number | 1 – 200 px | `10` | Wave size |
| `chop` | number | 0 – 2 | `0.4` | Chop |
| `stretch` | number | 1 – 12 | `5` | Stretch: How much wider than tall the wave cells are. |
| `seed` | seed |  | `1` | Seed |
| `only` | bool |  | `false` | Reflection only |

Tips: Calm lake: waves 0.3, chop 0.2, stretch 6. Choppy: waves 1, chop 0.8, stretch 3. Set the anchor at the waterline. Change seed for another wave pattern.

```json
{"type":"water-reflection","p":{"opacity":0.6,"distance":500,"ripple":0.6,"waveSize":10,"chop":0.4,"stretch":5,"anchor":{"x":0.5,"y":0.9}}}
```

### `glass-reflection` — Glass reflection

Soft window-light streaks screened over the subject, as reflected on glass or glossy packaging. A colour operation: free when merged with other colour effects.

Space `linear`. Section: Shadows & reflections.

Familiar equivalent: soft white gradient streaks painted on Screen over a bottle or a screen.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `amount` | number | 0 – 1 | `0` | Amount |
| `angle` | angle |  | `60` | Angle |
| `bands` | number | 1 – 6 | `2` | Streaks |
| `width` | number | 0.01 – 0.5 | `0.1` | Width |
| `softness` | number | 0 – 1 | `0.5` | Softness |
| `falloff` | number | 0 – 1 | `0.4` | Falloff: How much the streaks fade along their length. |
| `color` | color |  | `"#ffffff"` | Colour |
| `seed` | seed |  | `3` | Seed |

Tips: Bottles and phone screens: amount 0.25–0.4, 2 streaks, width 0.08, angle 60, softness 0.6. It follows the layer box, not the shape; the cut-out keeps it inside the subject.

```json
{"type":"glass-reflection","p":{"amount":0.3,"angle":62,"bands":2,"width":0.08,"softness":0.6,"seed":4}}
```

### `refine-edge` — Refine edge

Cleans a cut-out's edge after the background remover: smooth jagged outlines, feather, harden (contrast), move the edge in or out, and remove the old background's colour from edge pixels (decontaminate).

Space `linear`, needs `alpha`. Section: Compositing.

Familiar equivalent: Select and Mask (Smooth, Feather, Contrast, Shift Edge, Decontaminate Colors) and Layer > Matting > Defringe.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `smooth` | number | 0 – 30 px | `0` | Smooth |
| `feather` | number | 0 – 50 px | `0` | Feather |
| `contrast` | number | 0 – 100 % | `0` | Contrast |
| `shift` | number | -30 – 30 px | `0` | Shift edge |
| `decontaminate` | number | 0 – 1 | `0` | Decontaminate colours |
| `defringe` | number | 0.5 – 30 px | `3` | Edge band |

Tips: Typical product cut-out: smooth 1, shift −0.5, decontaminate 0.7, edge band 3. A light halo around a subject cut from a white background: shift −1 and decontaminate 1. Hair: keep contrast 0 and smooth 0; use decontaminate only. Put it first among the silhouette effects so shadows and reflections use the refined edge.

```json
{"type":"refine-edge","p":{"smooth":1,"shift":-0.6,"decontaminate":0.75,"defringe":3}}
```

### `match-color` — Match colour

Moves the layer's colour statistics (mean and spread of lightness and both colour axes, in Oklab) toward a target's, so a pasted subject takes on the background's light. Call LE.fx.composite.match(subject, background) to get the parameters.

Space `linear`. Section: Compositing.

Familiar equivalent: Image > Adjustments > Match Color (Luminance, Color Intensity, Fade), done here in a perceptual space.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `strength` | number | 0 – 100 % | `100` | Strength |
| `luminance` | number | 0 – 100 % | `100` | Luminance |
| `color` | number | 0 – 100 % | `100` | Colour intensity |
| `srcL` | number | 0 – 1 | `0.6` | Source lightness |
| `srcA` | number | -0.4 – 0.4 | `0` | Source green–magenta |
| `srcB` | number | -0.4 – 0.4 | `0` | Source blue–yellow |
| `dstL` | number | 0 – 1 | `0.6` | Target lightness |
| `dstA` | number | -0.4 – 0.4 | `0` | Target green–magenta |
| `dstB` | number | -0.4 – 0.4 | `0` | Target blue–yellow |
| `scaleL` | number | 0.25 – 4 | `1` | Contrast ratio |
| `scaleA` | number | 0.25 – 4 | `1` | Green–magenta ratio |
| `scaleB` | number | 0.25 – 4 | `1` | Blue–yellow ratio |

Tips: Start from match() and lower strength to 50–80: a full transfer can flatten a product's own colours. luminance 0 keeps the subject's brightness and matches only colour (temperature and tint); colour 0 matches brightness and contrast only. Put it before the shadows (it is a colour effect, so it runs before the cut-out anyway).

```json
{"type":"match-color","p":{"strength":70,"srcL":0.62,"srcA":0.01,"srcB":0.02,"dstL":0.55,"dstA":0.004,"dstB":0.035,"scaleL":0.9,"scaleA":1,"scaleB":1.1}}
```

### `ambient-light` — Ambient colour

Tints the subject with the colour of the light around it (luminance kept), and optionally lifts its shadows with that colour, like light bounced from the surroundings.

Space `linear`. Section: Compositing.

Familiar equivalent: a Color layer clipped to the subject at low opacity, plus a Photo Filter.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `amount` | number | 0 – 1 | `0` | Amount |
| `color` | color |  | `"#ffd9a8"` | Colour |
| `fill` | number | 0 – 1 | `0` | Shadow fill |

Tips: Sample the average colour of the background near the subject; amount 0.15–0.35. Warm sunset scene: #ffb36b, amount 0.3, fill 0.15.

```json
{"type":"ambient-light","p":{"amount":0.25,"color":"#ffc68a","fill":0.1}}
```

### `light-wrap` — Light wrap

Lets the blurred background light bleed over the subject's edges, the classic compositing trick that makes a cut-out sit in a bright scene. Reads the scene behind the layer (draw time).

Space `linear`, needs `alpha`, `scene`. Section: Compositing.

Familiar equivalent: the Light Wrap node of node compositors; in Photoshop a blurred background copy clipped to an inner-edge mask on Screen.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `amount` | number | 0 – 1 | `0` | Amount |
| `width` | number | 0.5 – 100 px | `10` | Width |
| `blur` | number | 0 – 200 px | `18` | Background blur |
| `mode` | choice | `screen` `normal` | `"screen"` | Blend |

Tips: Bright or backlit backgrounds: amount 0.4–0.7, width 0.01 × subject height, blur 2× width. Dark backgrounds gain little; use mode normal at a low amount to carry their colour into the edge instead.

```json
{"type":"light-wrap","p":{"amount":0.5,"width":8,"blur":20}}
```

### `blend-options` — Blending options

The full professional blend-mode set (27 modes, including vivid, linear and pin light, hard mix, subtract, divide, darker/lighter colour) blended onto the pixels behind the layer, with fill opacity and blend-if ranges for this layer and the underlying pixels (0–255, split for a soft transition). Draw time.

Space `display`, needs `scene`. Section: Compositing.

Familiar equivalent: Layer Style > Blending Options: Blend Mode, Fill Opacity, Blend If (This Layer / Underlying Layer, split sliders).

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `mode` | choice | `normal` `dissolve` `darken` `multiply` `color-burn` `linear-burn` `darker-color` `lighten` `screen` `color-dodge` `linear-dodge` `lighter-color` `overlay` `soft-light` `hard-light` `vivid-light` `linear-light` `pin-light` `hard-mix` `difference` `exclusion` `subtract` `divide` `hue` `saturation` `color` `luminosity` | `"normal"` | Blend mode |
| `fill` | number | 0 – 100 % | `100` | Fill opacity |
| `channel` | choice | `gray` `red` `green` `blue` | `"gray"` | Blend if |
| `thisLo0` | number | 0 – 255 | `0` | This layer: black |
| `thisLo1` | number | 0 – 255 | `0` | This layer: black (split) |
| `thisHi0` | number | 0 – 255 | `255` | This layer: white (split) |
| `thisHi1` | number | 0 – 255 | `255` | This layer: white |
| `underLo0` | number | 0 – 255 | `0` | Underlying: black |
| `underLo1` | number | 0 – 255 | `0` | Underlying: black (split) |
| `underHi0` | number | 0 – 255 | `255` | Underlying: white (split) |
| `underHi1` | number | 0 – 255 | `255` | Underlying: white |
| `seed` | seed |  | `1` | Dissolve seed |

Tips: Leave the layer's own blend at normal when using this, or the two blends stack. Drop a texture only into the dark parts of the background: underLo0 0, underLo1 0, underHi0 90, underHi1 150. Remove a white backdrop from a scanned logo: mode multiply, or thisHi0 200, thisHi1 250. Fill applies to the layer pixels and its layer-stage effects together here (see the report on fill vs opacity).

```json
{"type":"blend-options","p":{"mode":"linear-light","fill":60,"underHi0":180,"underHi1":240}}
```

### `apply-image` — Apply image

Blends a channel of the backdrop behind the layer (or of the layer itself) into the layer's pixels with any blend mode; the layer's transparency is kept. Draw time.

Space `display`, needs `scene`. Section: Compositing.

Familiar equivalent: Image > Apply Image (Source, Channel, Invert, Blending, Opacity, Preserve Transparency).

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `opacity` | number | 0 – 1 | `0` | Opacity |
| `source` | choice | `backdrop` `layer` | `"backdrop"` | Source |
| `channel` | choice | `rgb` `red` `green` `blue` `luma` `alpha` | `"rgb"` | Channel |
| `invert` | bool |  | `false` | Invert |
| `mode` | choice | `normal` `dissolve` `darken` `multiply` `color-burn` `linear-burn` `darker-color` `lighten` `screen` `color-dodge` `linear-dodge` `lighter-color` `overlay` `soft-light` `hard-light` `vivid-light` `linear-light` `pin-light` `hard-mix` `difference` `exclusion` `subtract` `divide` `hue` `saturation` `color` `luminosity` | `"multiply"` | Blend mode |

Tips: Carry the background's texture into a pasted label: source backdrop, channel luma, mode soft-light, opacity 0.5. A quick black-and-white with punch: source layer, channel red, mode luminosity, opacity 1.

```json
{"type":"apply-image","p":{"opacity":0.5,"source":"backdrop","channel":"luma","mode":"soft-light"}}
```

### `displace` — Displace

Wraps the layer over the surface behind it: pixels move by the backdrop's brightness (mid grey = no move) and can take on its shading. For logos on fabric, labels on crumpled paper, prints on stone. Draw time.

Space `linear`, needs `scene`. Section: Geometry.

Familiar equivalent: Filter > Distort > Displace with the background as the map; GIMP's Displace.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `x` | number | -200 – 200 px | `0` | Horizontal scale |
| `y` | number | -200 – 200 px | `0` | Vertical scale |
| `map` | choice | `backdrop` `layer` | `"backdrop"` | Map |
| `smooth` | number | 0 – 50 px | `2` | Smooth map |
| `shading` | number | 0 – 1 | `0` | Shading |

Tips: Fabric: x 6, y 6, smooth 2, shading 0.5, and put the layer's own blend at multiply. Keep the scale under about 2 % of the layer size or the artwork tears.

```json
{"type":"displace","p":{"x":8,"y":8,"smooth":2,"shading":0.4}}
```

### `mesh-warp` — Mesh warp

Bends the layer (after its cut-out) over a curved surface with a 4 × 4 Bézier control net, for mockups: mugs, bottles, bent pages, fabric folds. Points are fractions of the layer box; the thirds grid is "no warp".

Space `linear`, needs `alpha`. Section: Geometry.

Familiar equivalent: Edit > Transform > Warp (4 x 4 grid), as used for mockups.

| Param | Type | Range | Default | Label |
|---|---|---|---|---|
| `p00` | point |  | `{"x":0,"y":0}` | Point 1·1 |
| `p01` | point |  | `{"x":0.3333333333333333,"y":0}` | Point 1·2 |
| `p02` | point |  | `{"x":0.6666666666666666,"y":0}` | Point 1·3 |
| `p03` | point |  | `{"x":1,"y":0}` | Point 1·4 |
| `p10` | point |  | `{"x":0,"y":0.3333333333333333}` | Point 2·1 |
| `p11` | point |  | `{"x":0.3333333333333333,"y":0.3333333333333333}` | Point 2·2 |
| `p12` | point |  | `{"x":0.6666666666666666,"y":0.3333333333333333}` | Point 2·3 |
| `p13` | point |  | `{"x":1,"y":0.3333333333333333}` | Point 2·4 |
| `p20` | point |  | `{"x":0,"y":0.6666666666666666}` | Point 3·1 |
| `p21` | point |  | `{"x":0.3333333333333333,"y":0.6666666666666666}` | Point 3·2 |
| `p22` | point |  | `{"x":0.6666666666666666,"y":0.6666666666666666}` | Point 3·3 |
| `p23` | point |  | `{"x":1,"y":0.6666666666666666}` | Point 3·4 |
| `p30` | point |  | `{"x":0,"y":1}` | Point 4·1 |
| `p31` | point |  | `{"x":0.3333333333333333,"y":1}` | Point 4·2 |
| `p32` | point |  | `{"x":0.6666666666666666,"y":1}` | Point 4·3 |
| `p33` | point |  | `{"x":1,"y":1}` | Point 4·4 |
| `size` | number | 1 – 20000 px | `1200` | Layer size: The layer box's longer side in document pixels; bounds how far the warp may move pixels. |

Tips: Start from LE.fx.composite.meshFromQuad(quad) or cylinder(bulge) helpers, then move single points. Combine with transform.quad for the overall perspective and use mesh-warp only for the curvature. Keep the net fold-free (rows and columns must not cross).

```json
{"type":"mesh-warp","p":{"size":800,"p01":{"x":0.333,"y":-0.05},"p02":{"x":0.667,"y":-0.05},"p31":{"x":0.333,"y":1.05},"p32":{"x":0.667,"y":1.05}}}
```

