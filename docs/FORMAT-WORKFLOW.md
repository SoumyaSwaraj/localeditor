# The `.leworkflow` recipe format

Status: **version 1.1**, 12 November 2026. Implemented in `assets/js/le-engine.js` (`LE.recipes.validate`). Tested in `tests/recipes.test.js`.
**Version 2.0** (13 November 2026) adds Expert looks: see "Version 2.0: Expert looks" below. Implemented in `assets/js/le-recipes-v2.js`, tested in `tests/recipes-v2.test.js`. Everything on this page up to that section describes 1.x and is unchanged.

A recipe is a named, ordered list of image edits plus a default strength. It is **data only**: no script, no HTML, no URLs that are fetched, no expressions. An importer checks every field against the fixed lists below and either accepts the file, drops a harmless unknown field with a warning, or rejects the whole file with a plain-language error. Nothing in a recipe is ever evaluated.

This document is exact. If you are an AI agent writing recipes, follow it literally: use only the operations and parameter names listed here, keep every number inside its range, and write numbers as JSON numbers (not strings).

## A complete example

```json
{
  "format": "localeditor-workflow",
  "version": "1.1",
  "metadata": {
    "id": "golden-hour",
    "name": "Golden Hour",
    "description": "Sunset warmth, held highlights and a quiet vignette.",
    "author": "LocalEditor",
    "category": "portrait",
    "difficulty": "beginner",
    "tags": ["warm", "golden", "sunset"],
    "license": "Free to use and share",
    "cover": "people-07"
  },
  "compatibility": { "minimumEditorVersion": "1.1", "mobileSupported": true },
  "parameters": [{ "id": "intensity", "label": "Strength", "type": "slider", "min": 0, "max": 100, "default": 78 }],
  "steps": [
    { "id": "warmth", "operation": "temperature", "label": "Warmth", "description": "Push the light toward sunset.", "enabled": true, "parameters": { "value": 20 } },
    { "id": "exposure", "operation": "exposure", "label": "Exposure", "enabled": true, "parameters": { "value": 0.06 } },
    { "id": "highlights", "operation": "highlights", "label": "Highlights", "enabled": true, "parameters": { "value": -16 } },
    { "id": "golden-tone", "operation": "split-tone", "label": "Golden tone", "enabled": true,
      "parameters": { "shadowHue": 25, "shadowAmount": 10, "highlightHue": 42, "highlightAmount": 22, "balance": 20 } },
    { "id": "vignette", "operation": "vignette", "label": "Vignette", "enabled": true, "parameters": { "amount": 0.2 } }
  ],
  "export": { "format": "jpeg", "quality": 90 }
}
```

The smallest valid file:

```json
{ "format": "localeditor-workflow", "version": "1.0", "steps": [{ "operation": "contrast", "parameters": { "value": 15 } }] }
```

## Top-level fields

| Field | Required | Type | Rules |
|---|---|---|---|
| `format` | yes | string | Exactly `"localeditor-workflow"`. |
| `version` | yes | string (or number) | `"1.0"` or `"1.1"`; any `"1.x"` is read. A major version above 1 is refused ("needs a newer LocalEditor"). The number `1` is read as `"1.0"`. |
| `metadata` | no | object | See below. |
| `compatibility` | no | object | `mobileSupported` (boolean, default `true`). `minimumEditorVersion` is recomputed on import. |
| `parameters` | no | array | Exactly one useful entry: the strength slider. Only `parameters[0].default` is read: a number **0–100** (default 75). Everything else is rewritten to `{ id: "intensity", label: "Strength", type: "slider", min: 0, max: 100 }`. |
| `steps` | yes | array | **1 to 40** steps, run top to bottom. |
| `export` | no | object | `format`: `"jpeg"`, `"png"` or `"webp"` (default `jpeg`). `quality`: number **40–100** (default 90). A suggestion for downloads and batch. |

Any other top-level field is ignored and dropped.

### `metadata`

| Field | Type | Rules |
|---|---|---|
| `id` | string | Lower-cased and slugged to `[a-z0-9-]`, max 60. Missing → slug of the name. On import, an id that collides with a built-in recipe (or a different saved recipe) is renamed (`name-2`). |
| `name` | string | Max 80 characters, `<` `>` removed. Default `"Untitled recipe"`. |
| `description` | string | Max 400. |
| `author` | string | Max 80. Default `"Anonymous"`. |
| `category` | string | Slugged, max 24. Known values: `portrait`, `product`, `food`, `landscape`, `film`, `bw`, `social`, `document`. Others (e.g. `personal`) are kept and shown as "Yours". |
| `difficulty` | string | `beginner`, `intermediate` or `expert` (default `beginner`). |
| `tags` | array of strings | First 8 kept, each lower-cased, max 24. |
| `license` | string | Max 80. Default `"Free to use and share"`. |
| `cover` | string | Optional. A bundled photo id (`^[a-z]+-\d{2}$`, e.g. `people-07`, from `assets/photos/collage/`) or `sample-portrait` / `sample-scene`. Only used for library previews. Anything else is dropped with a warning. Never a URL or embedded image. |
| `created` | string | Optional ISO date, e.g. `"2026-11-12"`. |

### A step

| Field | Type | Rules |
|---|---|---|
| `operation` | string | **Required.** One of the operations below. Anything else rejects the file. |
| `parameters` | object | Parameters for that operation (below). May be omitted for operations with defaults. |
| `id` | string | `[A-Za-z0-9_-]{1,40}`, unique in the recipe. Missing or duplicate → generated. |
| `label` | string | Shown to people. Max 60. Default: the operation's name. |
| `description` | string | Max 180. |
| `enabled` | boolean | Default `true`. `false` keeps the step in the file but skips it. |

## Parameter rules

- **Numbers** must be JSON numbers inside the range given. `"12"` (a string) and out-of-range values **reject the file**; they are not clamped.
- **Enums** must be one of the listed words.
- **Colours** are `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(…)`/`rgba(…)` with plain numbers, or a CSS colour name (letters only).
- **Fonts** are family lists of letters, digits, spaces, commas, quotes and hyphens.
- **Text** fields are plain words, `<` and `>` removed.
- An **unknown parameter name** is dropped and reported as a warning; the file is still accepted.

### Strength

Every recipe has one strength slider (0–100). At strength *s*, each numeric parameter that has an **identity** (the "no change" value, listed below) becomes `identity + (value − identity) × s / 100`. Parameters without an identity (hues, positions, sizes, names) are not scaled. So `exposure 0.2` at 50 % is `0.1`, and `white 230` at 50 % is `242.5`.

## Operations

"Live" means the studio shows the step live on a photo layer (it is stored in the layer's `adjust`/`filter` fields). Other steps run when the recipe is applied to a file: the `/recipes/` page download, Batch, and studio export of the batch.

### Light and colour (live)

| Operation | Parameters (range, identity) | Notes |
|---|---|---|
| `exposure` | `value` −2…2, identity 0 | Stops. `0.3` ≈ a third of a stop brighter. |
| `brightness` | `value` −100…100, 0 | Adds `value × 2.55` to each channel. |
| `contrast` | `value` −100…100, 0 | Around mid-grey. |
| `highlights` | `value` −100…100, 0 | Negative recovers bright areas. |
| `shadows` | `value` −100…100, 0 | Positive opens dark areas. |
| `temperature` | `value` −100…100, 0 | Positive warmer (studio label "Warmth"). |
| `tint` | `value` −100…100, 0 | Positive greener, negative magenta. |
| `saturation` | `value` −100…100, 0 | `-100` is black and white. |
| `vibrance` | `value` −100…100, 0 | Boosts muted colours more than vivid ones. |
| `hue` | `value` −180…180, 0 | Degrees. |
| `levels` | `black` 0…255 (id. 0), `white` 0…255 (id. 255), `gamma` 0.2…3 (id. 1) | Document clean-up, contrast. |
| `curves` | `points`: 2–6 `[x, y]` pairs, each 0…1, x ascending | Not scaled by strength. Not live in the studio. |
| `adjust` | any of: `exposure`, `brightness`, `contrast`, `saturation`, `vibrance`, `temperature`, `tint`, `hue`, `highlights`, `shadows` (ranges as above), `sharpness` 0…100, `vignette` 0…1, `grain` 0…100, `black`, `white`, `gamma`, `red`/`green`/`blue` −100…100 (channel offsets), and in 1.1 `fade`, `clarity`, `splitShadowHue`, `splitShadowAmount`, `splitHighlightHue`, `splitHighlightAmount`, `splitBalance` | Several adjustments in one pass. Kept for 1.0 files; new files should prefer one step per operation. |

### Effects and detail (live)

| Operation | Parameters | Notes |
|---|---|---|
| `filter` | `name`: `vivid`, `warm`, `cool`, `cinematic`, `mono`, `film`, `fade`, `golden`, `noir`, `portrait`, `vintage`; `intensity` 0…100 (id. 0) | Built-in presets. The first filter step becomes the layer filter in the studio. |
| `vignette` | `amount` (or `value`) 0…1, id. 0 | Darkens the corners. |
| `grain` | `amount` (or `value`) 0…100, id. 0 | Fixed-pattern film grain. |
| `sharpen` / `sharpness` | `amount` (or `value`) 0…100, id. 0 | Unsharp mask. Capped at 45 on older phones. |
| `blur` | `radius` 0…80 (id. 0); `type` `gaussian` / `motion` / `background`; `angle` 0…360 (motion); `cx`, `cy` 0…1, `rx`, `ry` 0.05…1 (background: the sharp ellipse) | Only `gaussian` is live. Radius is capped per device (8 / 18 / 40). |
| **`fade`** *(1.1)* | `amount` 0…100, id. 0 | Matte look: lifts blacks to `amount × 0.7` and lowers whites by `amount × 0.18` (on a 0–255 scale). |
| **`clarity`** *(1.1)* | `value` −100…100, id. 0 | Midtone local contrast from a wide blur (radius = long edge / 70). Negative softens skin and haze. |
| **`split-tone`** *(1.1)* | `shadowHue` 0…360 (not scaled), `shadowAmount` 0…100 (id. 0), `highlightHue` 0…360 (not scaled), `highlightAmount` 0…100 (id. 0), `balance` −100…100 (id. 0; negative favours shadows) | Pushes one colour into the shadows and another into the highlights, keeping pure black and white neutral. Hues are colour-wheel degrees: 0 red, 30 orange, 45 gold, 120 green, 190 teal, 220 blue, 330 pink. |

### Size, frame and drawing (run on files, not live)

| Operation | Parameters |
|---|---|
| `resize` | `maxWidth` 1…16000 (shrink only), or `width`/`height` 1…16000, or `percent` 1…400; `mode` `nearest`/`bilinear`/`high`; `lock` boolean |
| `crop` | `x`, `y` 0…1, `w`, `h` 0.01…1 (fractions of the image) |
| `rotate` | `degrees` −360…360 |
| `flip` | `axis` `horizontal` / `vertical` |
| `border` / `frame` | `padding` 0…800, `size` 0…400, `radius` 0…800 (px); `color`, `background` colours; `shadow` boolean |
| `text` | `text` (≤ 240), `font`, `color`, `outline`, `background`; `size` 0.01…0.4 (fraction of width), `x`, `y` 0…1, `rotate` −180…180, `weight` 100…900; `align` `left`/`center`/`right` |
| `watermark` | `text`, `font`, `color`; `image` (a `data:image/png|jpeg|webp;base64,…` URL, ≤ 1.5 MB); `opacity` 0…1, `scale` 0.02…1, `x`, `y` 0…1; `tile` boolean |
| `shape` | `kind` `rect`/`ellipse`/`line`/`arrow`/`emoji`; `x`, `y` −1…2, `w`, `h` −2…2, `opacity` 0…1, `strokeWidth` 1…40; `fill`, `stroke` colours; `text` (≤ 16, the emoji) |
| `background` | `tolerance` 0…100; `color`, `replace` colours (flat-colour background removal) |
| `social` | `width`, `height` 1…8000; `fit` `cover`/`contain`; `background` colour |
| `meme` | `top`, `bottom` (≤ 240), `font`; `scale` 0.04…0.16 |
| `upscale` | `factor` 1…4 |
| `mask` | `maskId` (`[\w-]{1,40}`): a brush mask from the same session; skipped elsewhere |
| `background-ai`, `upscale-ai` | none. Accepted for compatibility; not available on any device yet, so they are skipped with a notice. |

## Versioning

- **1.0**: the original operations.
- **1.1** adds `fade`, `clarity` and `split-tone`, the matching `adjust` keys, and widens `temperature`/`tint` to ±100 and `grain` to 0–100. A file is written as `"1.1"` only when it uses one of the new operations or keys; otherwise it stays `"1.0"` so older LocalEditor builds can open it.
- **2.0** adds the `fx` list (Expert looks) and makes `steps` optional. It is read where `le-recipes-v2.js` is loaded (the recipes page and the studio's Recipes module); a build without it answers "needs a newer LocalEditor", as 1.x readers always did for a higher major version. A file is written as `"2.0"` only when it has `fx`.
- Every `1.x` file is read by this importer. A 1.x file from the future that uses an operation this build does not know is refused with "… is not a LocalEditor edit".
- Files are normalised on import: fields are written back in the order shown in the example, so exporting an imported recipe produces the same text.

## What importers reject

The whole file is refused, and nothing runs, when:

- it is larger than **2,000,000 characters**, or not JSON, or nested deeper than 12 levels;
- any key anywhere is `__proto__`, `constructor` or `prototype`;
- any string (other than a watermark `image`) contains markup or script: `<script`, `<iframe`, `<svg`, `<img`, `<a `, `<style`, `javascript:`, `vbscript:`, `data:text/html`, or an `on…=` handler;
- `format` is not `localeditor-workflow`, or `version` is missing or above 1.x;
- `steps` is missing, empty, or longer than 40;
- a step's `operation` is not in the lists above;
- a number is not a JSON number or is outside its range; an enum, colour, font or id is not allowed; a boolean is not `true`/`false`;
- `parameters[0].default` or `export` values are out of range.

## Version 2.0: Expert looks

A 2.0 recipe carries an `fx` list: the same plain effect entries a photo layer holds in `layer.fx` (`docs/FX-AUTHORING.md`, "Document model"). It is still only data. Nothing in it is code, and nothing is drawn before the effect registry has checked every entry against its effect's schema.

```json
{
  "format": "localeditor-workflow",
  "version": "2.0",
  "metadata": { "id": "warm-fade-look", "name": "Warm fade", "category": "film" },
  "parameters": [{ "id": "intensity", "default": 85 }],
  "fx": [
    { "type": "tone-curve", "p": { "curve": { "master": [[0, 0.07], [0.25, 0.24], [0.75, 0.79], [1, 0.95]] }, "mode": "luminosity" } },
    { "type": "color-grading", "amount": 0.8, "p": { "highlights": { "h": 42, "a": 0.14, "l": 0 } },
      "mask": { "parts": [{ "kind": "luma", "min": 0.5, "max": 1, "soft": 0.2 }] } },
    { "type": "vibrance", "p": { "amount": -12 } }
  ]
}
```

The normalised file (what LocalEditor writes) is `examples/recipes/warm-fade-look.leworkflow`.

| Field | Rules |
|---|---|
| `version` | `"2.0"`; any `"2.x"` is read. A major version above 2 is refused ("needs a newer LocalEditor"). |
| `fx` | **1 to 32** entries, applied in order, after `steps`. |
| `steps` | Optional in 2.0: 0 to 40 steps, with every 1.x rule. Written as `[]` when there are none. |
| `metadata`, `parameters`, `export`, `compatibility` | As in 1.x. `compatibility.minimumEditorVersion` is written as `"2.0"`. |

An entry is `{ type, on, amount, blend, mask, p }`:

- `type`: an effect id (`a-z`, digits, `.` and `-`, 2 to 40 characters). Ids are listed by `LE.fx.list()`; parameters by `LE.fx.describe(id)`.
- `on` (boolean, default `true`), `amount` (number 0 to 1, default 1), `blend` (one of the eleven blend names, default `normal`).
- `p`: the effect's parameters, plain data only.
- `mask`: `{ on, invert, parts }` with up to 8 parts of the kinds that resolve on each photo: `linear`, `radial`, `luma`, `color`, `subject`, `depth`, `face`, `segment`. A painted mask (`asset`) belongs to one photo: it is left out with a note when a look is saved, and dropped with a warning when a file has one.
- Entry `id`s are not carried.

**Strength.** One number, 0 to 100 (`parameters[0].default`), scales every entry's own `amount`: applied amount = `amount × strength / 100`. `steps` are scaled as in 1.x.

**Validation, in two stages.**

1. *Shape* (`LE.recipes.validate`, everywhere, before the recipe is stored, shown or shared). All 1.x rules hold for the whole file: size (2,000,000 characters), nesting, the forbidden keys, no markup or script in any string. For `fx`, out-of-shape values **reject the file**: a missing or unreadable `type`, `amount` outside 0 to 1, an unknown `blend` or mask kind, a number that is not a JSON number, a parameter name that is not a plain name, more than 48 keys in an object, more than 512 items in a list (4,096 in a list of numbers only), a string over 120 characters, nesting deeper than 5 inside `p`, or more than 200,000 characters of entries. Unknown entry fields are dropped with a warning.
2. *Registry* (`LE.recipes2.resolve(workflow, LE.fx)`, in the studio, before anything is drawn). Each entry goes through `LE.fx.validate`: unknown parameters are dropped, values are clamped to their ranges, wrong types become the default. **An effect type this build does not know stays in the file, is reported ("… is not known to this LocalEditor and was left out") and never reaches a layer.** The recipes page does stage 1 only and never draws a look.

**Assets.** A recipe carries no images and no script. The one exception is the one design files already have: a parameter of type `lut` may hold a small LUT as text, `data:text/plain;base64,…` (or `application/octet-stream`), at most 1,000,000 characters each and two per recipe. Any other `data:` value rejects the file; a data value on a parameter that is not a `lut` is left out with a note. On apply the text is stored as a data asset and its id put back.

**In the studio.**

- *Save*: Expert mode, the Develop panel of a photo, **Save look as a recipe**: the switched-on entries of its effect stack, a name, a strength and a preview. Code: `LEStudioRecipes.saveLook(ctx, layerId, { name, strength, silent })`.
- *Apply*: Recipes panel (Simple mode too; the renderer loads on demand through `LE.fxBoot`) or `LEStudioRecipes.apply(ctx, layerId, recipeOrId, strength?, { maps: false }?)`, which answers with a promise for a 2.0 recipe. The entries are added after the layer's own entries with ids `rcp.0`, `rcp.1`, …, and the usual marker is written to `adjust.recipe` (`id`, `name`, `strength`), all in **one undo step**. Those ids are the group: changing strength rewrites exactly them, **Remove** takes exactly them (and the marker) out in one step, and a different recipe replaces them. Entries a person added themselves are never touched.
- *Maps*: when a mask needs a depth, face or people map the photo does not have, the studio asks the way the Light tool does (`LE.maps.gate`). If the person declines, or the device cannot make it, the entries that need it are left out and the toast says so.
- *Batch*: Apps → Batch lists Expert looks. Entries whose masks need a per-photo map are left out, and the result says so.
- *Built-in looks*: eight, defined in `LE.recipes2.builtins` as pointers to the effect packs' own presets (`LE.fx.grade.presets`: teal-orange, filmic-fade, cool-cinematic, noir; `LE.fx.creative.presets`: 35mm-print, night-neon, faded-summer, crisp-landscape). Their values are read from the packs when a look is first used (`LE.recipes2.fill`), so they cannot drift.
- *Saved on this device*: 2.0 recipes are kept in their own list (`localStorage` key `le-user-recipes-2`, 40 at most), so a page that only reads 1.x never rewrites them. `LE.userRecipes` returns both.
- *Agents*: recipes are data, so an agent can write a 2.0 file and hand it to `LEStudioRecipes.apply(LEStudio, layerId, recipeOrId, strength)`, which checks it and adds the entries. `LE.recipes.find(id)` knows 2.0 recipes once the Recipes module is loaded, so `{ "op": "recipe", "recipe": "<id>" }` resolves one; that operation goes through `le-design.js`, which writes the `steps` part and the marker only (the entries then arrive with the first strength change in the panel, or with `LEStudioRecipes.apply`).

**Share links** work as for 1.x (same payload, same 6,000 character cap). A look that does not fit answers "This recipe is too large for a link. Share the .leworkflow file instead." and the share dialog keeps its **Download .leworkflow** button. On the recipes page a 2.0 recipe shows an **Expert** tag, lists its effects, and opens in the studio (the recipe is handed over in the tab's session storage and checked again there).

## Share links

A recipe can travel inside a link: `https://localeditor.net/recipes/#r=<payload>`. The part after `#` is never sent to a server by browsers, so opening a link uploads nothing.

- `payload` = one tag letter + base64url (no padding) of the UTF-8 JSON of the normalised recipe (no whitespace).
  - `z` — the JSON compressed with `deflate-raw` (`CompressionStream`). Used whenever the browser supports it.
  - `j` — the JSON uncompressed (fallback).
- The payload is capped at **6,000 characters**; decompression stops at **64 KB**. A recipe with a watermark image is usually too large: share the file instead.
- The decoded text goes through exactly the same validator as a file. A damaged, truncated or tampered link is refused.
- Built-in recipes encode to roughly 600–900 characters with `z`.

Code: `LE.recipes.encodeLink(workflow, { base?, compress? })` → `Promise<{ payload, fragment, url, compressed }>`; `LE.recipes.decodeLink(urlOrFragment)` → `Promise<{ ok, errors, warnings, workflow }>`.

## In the studio

Applying a recipe to a photo collapses its live steps into the layer's `adjust` and `filter` fields (adding to any edits already there) and records what it added in `adjust.recipe`:

```json
"adjust": { "warmth": 15.6, "exposure": 0.05, "vignette": 0.16,
  "recipe": { "id": "golden-hour", "name": "Golden Hour", "strength": 78,
              "add": { "warmth": 15.6, "exposure": 0.05 }, "prev": { "vignette": null },
              "filter": false, "prevFilter": null } }
```

`add` lists amounts that were added; `prev` lists values that were replaced (null = absent before). Changing strength or removing the recipe uses these, so manual edits made before or after survive. Steps that are not live are listed when the recipe is applied and run on export through Batch.

## Writing recipes as an agent: checklist

1. Start from the smallest valid file and add steps.
2. One operation per step; give each a short `label` people understand ("Warmth", not "temperature").
3. Keep looks subtle at 100 % and set `parameters[0].default` to 70–85 so people can push or pull.
4. Use `"version": "1.1"` if you use `fade`, `clarity` or `split-tone`; otherwise `"1.0"`.
5. Validate: open `/recipes/`, paste the JSON into **Import a recipe**. Errors name the step and the field.

### Expert looks and agents

A design file does not name a 2.0 recipe: it carries the effects themselves in the layer's `fx` list. In agent mode, add a look with `fx.add` or with `fx.call` (`grade.preset`, `creative.look`). A `recipe` reference to a 2.0 recipe is reported as `expert-recipe` and left out, never half-applied. In the studio, a person applies a 2.0 recipe from the Recipes panel.
