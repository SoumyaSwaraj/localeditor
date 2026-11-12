# Expert mode — architecture

Written by the lead architect, 12 November 2026. This is the contract every expert-mode builder works to. Nothing here is built yet.

## What it is

A second workspace in the photo studio for studio-level editing: professional shadows and reflections, creative optical effects, RAW and HDR, relighting, liquify, frequency separation, skin retouching, colour grading and compositing. Two audiences, one feature set:

- **Agents.** Every expert feature is a documented block of data an agent can write, check and correct. This is the main reason it exists.
- **People** who switch the studio to Expert. The layout, names and shortcuts follow what professional editors already use (a develop panel with collapsible sections, a tool strip, layers with masks and blend modes, scopes), drawn in LocalEditor's own design language. Familiar conventions, no copied artwork or trade dress.

The simple studio stays as it is. A design made in Expert opens and renders correctly in Simple, because both draw the same document.

## Principles

| # | Rule | Why |
|---|---|---|
| E1 | **Everything is an entry in a stack, not a baked pixel.** An effect, an adjustment, a mask, a warp: each is data with parameters. | Re-editable by a person, writable by an agent (rule A3). |
| E2 | **One renderer for preview, export and the headless command line.** Same shaders, same numbers. | An agent's check must match what the person sees and what gets exported. |
| E3 | **GPU first, in floating point, in linear light.** WebGL2 with half-float targets. | Speed, no banding, physically sensible blur, bloom and exposure. |
| E4 | **Pixel edits that cannot be parameters live in their own overlay asset** on top of the untouched original (healing, cloning, dodge and burn). | The original photo is never changed. |
| E5 | **Derived maps are regenerable.** Depth, normals, face landmarks, subject masks record the model and version that made them. | A file stays valid if a cached map is lost. |
| E6 | **Expert code loads only when needed.** The workspace loads when Expert is switched on; the renderer loads when a document contains expert data. | The simple studio must not get heavier. |
| E7 | **Every effect declares what a device needs**, through `LE.support`. Uncertain means "Try anyway", never a block. | Same rule as the rest of the app. |

## Document model

Added to what `LE.Scene` already stores. All optional; absent means "none".

```
layer.fx = [                      // ordered, first runs first; on image layers and groups
  { id, type, on: true, amount: 1, blend: 'normal', mask: <mask|null>, p: { …parameters } }
]

{ type: 'adjust', fx: [...], mask, clip: false, x, y, w, h, … }   // adjustment layer: its stack applies to everything beneath (or only the layer below when clip is true)

layer.mask = {                    // also usable per fx entry
  parts: [ { kind, mode: 'add'|'subtract'|'intersect', invert, feather, density, …kind fields } ]
}
  kind 'asset'   { asset }                         painted or generated alpha
  kind 'linear'  { x0, y0, x1, y1 }                gradient
  kind 'radial'  { cx, cy, rx, ry, rotation }
  kind 'luma'    { min, max, soft }                luminance range
  kind 'color'   { h, s, l, range, soft }          colour range
  kind 'subject' { }                               from layer.cutout
  kind 'depth'   { near, far, soft }               from layer.maps.depth
  kind 'face'    { part: 'skin'|'eyes'|'lips'|'teeth'|'brows'|'under-eyes' }   from layer.maps.face

layer.transform = { quad: [[x,y],[x,y],[x,y],[x,y]] }        // perspective and distort, in page units
layer.retouch   = { asset, version }                         // RGBA overlay at source resolution (heal, clone, dodge, burn)
layer.maps      = { depth: { asset, model, version }, normals: {…}, face: { landmarks, parts: { asset }, model, version } }
layer.raw       = { profile, wb: { temp, tint }, exposure, … }  // develop settings when the source is a RAW or HDR set
```

Coordinates inside masks and effects are fractions of the layer box (0–1) unless a field says page units, so they survive resizing. Lengths that should look the same at any export size (blur radius, grain size, shadow offset) are in document pixels and scaled by the renderer.

## Render order

For each layer: source → RAW develop → retouch overlay → geometry (lens, liquify, perspective) → `fx` stack → cut-out and layer mask → silhouette effects that need the layer's alpha and the scene behind it (shadows, reflections, glow, light wrap) → blend onto the page. Then adjustment layers in order. Then the output transform to the display or export colour space, with dithering to 8 bits.

Effects declare `space: 'linear' | 'display'`; the renderer converts between them once per run of same-space effects.

## The renderer (`assets/js/fx/`)

- **Backend:** WebGL2. Half-float render targets where the extension exists, 8-bit with dithering where it does not. No WebGL2 means expert effects are unavailable on that device; the document still opens and says so.
- **Pass merging:** every per-pixel colour operation (exposure, white balance, curves, HSL, wheels, mixer, split tone, levels) compiles into one shader pass using small lookup textures. Spatial effects (blurs, bloom, shadows) are separate passes at reduced resolution where the eye cannot tell.
- **Preview:** renders only what is on screen, at screen resolution. While a control is being dragged, heavy effects drop to a draft quality and refine when the pointer lifts. Stage outputs are cached by a hash of their inputs.
- **Export:** tiled, with an overlap each effect declares (`radius(p, scale)`), so pictures larger than the GPU's texture limit export correctly. Effects that need whole-image statistics compute them once on a reduced copy.
- **Determinism:** procedural effects (grain, textures, flare) are seeded and defined in document space, so preview, export and the headless path produce the same picture.
- **Budgets on a mid-range laptop GPU at a 2-megapixel preview:** colour pass under 4 ms; a full typical stack under 16 ms while dragging; export of 24 megapixels under 5 s. The build sandbox has no real GPU, so these are verified for correctness there and measured on real hardware later.

## Effect registry

Every effect is one registration. The workspace builds its controls from it, the agent reference is generated from it, and validation uses it.

```
LE.fx.register({
  id: 'bloom', name: 'Bloom', group: 'effects', version: 1,
  space: 'linear',
  needs: [],                         // any of: 'alpha', 'scene', 'depth', 'normals', 'face'
  params: { threshold: { type: 'number', min: 0, max: 4, default: 1, step: 0.01, label: 'Threshold' }, … },
  radius: function (p, scale) { … }, // pixels of neighbourhood needed, for tiling
  passes: function (g, p) { … },     // builds passes with the renderer's helper API
  cpu: null,                         // optional slow path for devices without WebGL2
  support: { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 200 },
  ui: { section: 'Effects', controls: [ … ] },
  agent: { summary: 'Soft glow around bright areas.', tips: [ … ], example: { … } }
})
```

Parameter types: `number`, `bool`, `choice`, `color`, `point`, `angle`, `curve` (control points), `wheel` (hue, amount, luminance), `bands` (eight hue bands), `lut` (asset), `seed`.

## Workspace (`assets/js/expert/`)

- A switch in the studio header: **Simple | Expert**, remembered per device, also `?mode=expert`. Switching never changes the document.
- **Layout on a computer:** tool strip on the left; canvas; on the right a develop panel of collapsible sections with a histogram on top, and a layers panel below it with blend mode, opacity, mask and effect rows. Before/after compare. Scopes: histogram, waveform, vectorscope with a skin-tone line.
- **Layout on a tablet or phone:** the same sections in the bottom sheet, tools in a strip above it. Usable, but the workspace is designed for a larger screen and says so.
- **Control kit** shared by every section: slider with number scrubbing and double-click reset, curve editor, colour wheels, hue-band grid, point and angle pickers on the canvas, mask manager, brush options.
- **Brush engine** for masks, retouch, dodge and burn, liquify: size, hardness, flow, spacing, pressure from pointer events, a size cursor, GPU stamping.
- **Shortcuts** follow the conventions professionals know (`[` `]` brush size, `X` swap, space to pan, `\\` before/after, letter keys for tools), listed in a shortcut sheet.

## Agent surface

- Operations through `LEAgent.apply` and the command line: `fx.add`, `fx.update`, `fx.remove`, `fx.reorder`, `mask.set`, `map.generate` (depth, face, subject), `adjust.add` (adjustment layer), `transform.set`.
- `LEAgent.analyze(target)` returns numbers an agent can grade by: histogram and percentiles per channel, clipping, white-balance estimate, average skin hue against the skin-tone line, sharpness, estimated light direction, colour statistics of a region. This is what lets an agent match a subject to a background without guessing.
- `LEAgent.catalog('fx')` and a generated `docs/FX-REFERENCE.md`: every effect, parameter, range and example, built from the registry.
- Recipes version 2: a recipe step may be any `fx` entry with a parametric mask, so a look made in Expert can be shared and applied by an agent.
- Named looks built from several entries ("soft studio product shot": cut-out, studio shadow, floor reflection, match colour) are ordinary recipes, not special code.

## On-device models

Optional downloads, cached in `le-models-v1`, listed in the storage manager, gated by `LE.support`. Licences must be permissive for code and weights.

| Need | Used by |
|---|---|
| Depth estimation | depth blur and bokeh, haze, relighting, depth masks, ambient occlusion |
| Face landmarks and face parts | face-aware liquify, skin retouching by area, face masks |
| Subject mask | already shipped (background remover) |
| Inpainting | object removal; later, large download |

## What is hard, said plainly

- **Camera RAW files.** Phone RAW (DNG) can be read with our own code. Most camera formats need a decoder library whose licence (LGPL) is outside the project's current rule. A feasibility check comes first; the owner decides on the licence.
- **Relighting.** It rests on an estimated depth map from a small model. Good for adding a rim or fill light and shifting mood; it will not match a studio reshoot.
- **Parity.** Professional editors are decades of work. The aim is a real, coherent set of professional tools with correct results, strongest where an agent benefits most (grading by numbers, compositing with matched light and shadow), not a clone of any one product.
- **No GPU in the build sandbox.** Speed must be checked on real machines and phones.

## Build order

| Step | Work | Builder |
|---|---|---|
| X0a | Renderer, document model, masks, adjustment layers, tiled export, registry, the merged colour pass with basic tone controls, agent operations, performance and golden-image test harness | Fable |
| X0b | Workspace: mode switch, layout, control kit, scopes, layers panel with masks and effect rows, brush engine | Opus |
| S1 | Feasibility: RAW decoding and HDR merge (formats, licences, speed) | Sonnet |
| S2 | Feasibility: depth, normals and face models (licences, size, speed, quality) | Sonnet |
| X1 | Colour grading: HSL, full curves, channel mixer, wheels, split toning, selective colour, skin tone, LUT import and export, levels, white-balance picker | Opus |
| X2 | Creative effects: grain and analog textures, bloom, glow, halation, lens flare, light leaks, lens and depth blur, bokeh, vignette, haze | Opus |
| X3 | Shadows, reflections and compositing: contact, cast and studio shadows, floor and surface reflections, ambient occlusion, light wrap, match colour, edge refinement, blend ranges, perspective transform | Opus |
| X4 | Retouching: healing, clone, dodge and burn, frequency separation, skin retouching by area, liquify (manual and face-aware) | Opus |
| X5 | RAW develop and HDR merge, after S1 | Opus |
| X6 | Relighting and depth effects, after S2 | Opus |
| X7 | Cross-feature tests, performance, the generated effect reference, recipes version 2 | Sonnet |

X1 to X4 start when X0a's registry and X0b's control kit are merged.
