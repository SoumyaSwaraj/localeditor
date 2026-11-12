# LocalEditor design files (`.ledesign.json`) — format 1

One design as one plain JSON file. Every page and layer opens as editable in the LocalEditor studio (`/studio/` → File → Open design file). An AI agent (Claude Code, Cursor, Codex, …) or a person can write it with an ordinary text editor; the studio writes the same format back (File → Save as design file).

- JSON Schema: `schema/design-1.json` (`https://localeditor.net/schema/design-1.json`).
- Ten worked examples: `examples/designs/*.ledesign.json`.
- Code: `LE.design` in `assets/js/le-design.js`. Every file goes through `LE.project.validate`, the same safety gate as `.leproject`.

## Writing a design as an agent: checklist

1. Start from `examples/designs/hello-world.ledesign.json`.
2. Give every layer a short readable `id` (`"title"`, `"hero-photo"`); later requests can say "change `title`".
3. Use shorthand: `"x": "center"`, `"w": "90%"`, `"fill": "#E0B354"`, `"type": "icon"`, `"slot": true`, `"fit": "shrink"`. The studio normalises it.
4. Leave `h` out on text: it is measured from the wrapped text.
5. Use only fonts, icons, shapes and recipes listed below. Unknown ones are reported.
6. Never put HTML, script or `javascript:` in any string. Files that do are refused.
7. Open the file in the studio. Problems come back as `{ path, message }` with a JSON pointer such as `/pages/0/layers/3/x`; warnings list overflowing text, layers off the page, low contrast, missing images and unknown fonts.

## The document

```json
{
  "$schema": "https://localeditor.net/schema/design-1.json",
  "format": "localeditor-design",
  "version": 1,
  "name": "Summer sale post",
  "variables": [{ "key": "name", "label": "Name", "type": "text", "default": "Ana" }],
  "pages": [
    {
      "id": "post",
      "width": 1080,
      "height": 1080,
      "background": "#FFF3E2",
      "layers": [
        { "id": "title", "type": "text", "text": "SUMMER\nSALE", "font": "Anton", "size": 180, "align": "center", "x": "center", "y": 700, "w": "90%" },
        { "id": "badge", "type": "shape", "shape": "ellipse", "fill": "#E0B354", "x": 820, "y": 60, "w": 200, "h": 200 },
        { "id": "sun", "type": "icon", "icon": "lucide:sun", "color": "#17131F", "x": 880, "y": 120, "w": 80 },
        { "id": "hero", "type": "image", "slot": true, "x": 0, "y": 0, "w": 1080, "h": 640 }
      ]
    }
  ]
}
```

| Key | Type | Required | Notes |
|---|---|---|---|
| `$schema` | string | no | Ignored by the reader; helps editors. |
| `format` | `"localeditor-design"` | yes | |
| `version` | `1` | yes | A higher number is refused with "needs a newer LocalEditor". |
| `name` | string ≤ 160 | no | Default "Imported design". |
| `variables` | array ≤ 50 | no | Template variables, see below. |
| `remix` | `{ name, by }` | no | Credit for a shared template; plain text (≤ 160 / ≤ 80), `<` and `>` removed. |
| `notes` | array ≤ 200 | no | Notes pinned for an assistant (agent mode): `{ id, page, layer?, x, y, text, status: "open" \| "done", reply?, at }`. `page` is a page index or a page id (the studio writes the id when the page has one); `x`, `y` are page pixels; `text` and `reply` are plain text ≤ 1000. Stored in `meta.studio.notes`. |
| `pages` | array, 1–50 | yes | |

Any other top-level key is ignored with a warning.

### Pages

| Key | Type / range | Default | Notes |
|---|---|---|---|
| `id` | id | none | Unique in the file. Stored on the page itself, so it stays with that page when pages are moved, deleted or duplicated in the studio (a duplicate starts without an id). Older projects kept ids by position in `meta.studio.pageIds`; that list is still read when no page has its own id. |
| `width`, `height` | 16–20000 px | 1080 | |
| `background` | colour string or object | `#ffffff` | See Backgrounds. |
| `collage` | object | none | See Collages. |
| `carousel` | `{ slides, slideWidth }` | none | See Carousels. |
| `maker` | `{ id, style, size, values, sig }` | none | See Quick makers. |
| `layers` | array ≤ 600 | `[]` | Back to front. |

### Carousels

```json
{ "id": "deck", "width": 3240, "height": 1350, "carousel": { "slides": 3 }, "layers": [ … ] }
```

One wide page split into seamless slides (Instagram carousel). `slides` 1–20 (required); `slideWidth` = page width ÷ slides, may be left out. A `slideWidth` that does not match is corrected with a `carousel-width` warning. The studio shows slide guides and exports one image per slide.

### Quick makers

```json
{ "id": "card", "maker": { "id": "quote", "style": "", "size": "", "values": { "quote": "Small steps every day.", "author": "Ana" } } }
```

| Key | Type | Notes |
|---|---|---|
| `id` | maker id | `quote`, `review`, `receipt`, `milestone`, `palette`, `film` (see `assets/js/makers/`). Required. |
| `style`, `size` | ids | The maker's first style and size when left out. |
| `values` | object | The maker's form fields by key. |
| `sig` | string | Written by the studio: a fingerprint of the generated layers, so it can tell hand edits from a fresh build. |

**A page with only `maker` (no `layers`) is generated when the file is read** (`LE.makers.build`): the page takes the maker's size (a different `width`/`height` is replaced, with a `maker-size` warning) and its background unless you give one. An agent can write just the form values. With `layers`, the layers are used as written and `maker` is kept so the studio can remake the page. The studio writes both. An unknown maker or invalid values are an error at `/pages/N/maker`. Outside the studio (no makers loaded) a maker-only page opens empty with a `maker-unavailable` warning.

### Layers: common fields

An **id** is 1–48 characters of letters, digits, `-`, `_`, `.` or `:`, unique in the file. Missing ids become `<type>-<n>`.

| Key | Type / range | Default | Notes |
|---|---|---|---|
| `id` | id | `<type>-<n>` | Must be unique. |
| `name` | string ≤ 120 | the id | The name shown in the layers panel. |
| `type` | `image` `text` `shape` `svg` `icon` `path` `group` | — | Required. Anything else is refused. |
| `x`, `y` | number, `"50%"`, or a word | 0 | Words: `x` = `left` `center` `right`; `y` = `top` `center` `bottom`. Percentages are of the page width / height. |
| `w`, `h` | number or `"50%"` | see type | Text `h` may be `"auto"` or missing (measured). |
| `rotation` | degrees | 0 | |
| `opacity` | 0–1 | 1 | |
| `blend` | CSS blend mode | `source-over` | `normal` is accepted. |
| `visible`, `locked`, `flipX`, `flipY` | boolean | true / false / false / false | |
| `groupId` | id of a `group` layer on the same page | none | |
| `shadow` | `{ color, blur 0–500, x, y }` | none | Defaults `rgba(23,19,31,.35)`, 16, 0, 8. |

### Text

| Key | Type / range | Default | Notes |
|---|---|---|---|
| `text` | string ≤ 8000 | required | `\n` breaks lines. `{{key}}` is ordinary text (see variables). |
| `font` | font family | `Plus Jakarta Sans` | See Fonts. |
| `weight` | 100–900, `"normal"`, `"bold"` | 700 | Most families ship 400 and 700. |
| `italic` | boolean | false | |
| `size` | 1–5000 px | 48 | |
| `color` | colour | `#17131F` | |
| `fill` | fill | none | A gradient fill replaces `color`. |
| `align` | `left` `center` `right` | `left` | |
| `lineHeight` | 0.5–5 | 1.2 | |
| `letterSpacing` | px | 0 | |
| `uppercase`, `underline`, `strike` | boolean | false | |
| `stroke` | `{ width, color }` | none | Outline. |
| `background` | colour or `{ color, radius, padding }` | none | A highlight pill behind each line; radius 999, padding 8. |
| `curve` | −360…360 degrees | 0 | Text on an arc. |
| `fit` | `"shrink"` | none | Shorthand: the largest `size` (≤ the given size) at which the text fits its `w` × `h` box without breaking words. Needs a fixed `h`. |

`w` defaults to 80 % of the page width. `h` missing or `"auto"`: the height of the wrapped lines (`lines × size × lineHeight`), measured with the real font.

### Image

| Key | Type / range | Default | Notes |
|---|---|---|---|
| `src` | image source | none | See Image sources. No `src` = an empty frame. |
| `slot` | `true` or `{ id, label, photo }` | none | A photo slot the person fills. `true` → `{ id: <layer id>, label: <name or "Photo"> }`. |
| `crop` | `{ x, y, w, h }` fractions 0–1 | cover crop | The part of the photo shown. |
| `fit` | `cover` `contain` `stretch` | `cover` | Shorthand used only when `crop` is missing: `cover` crops the photo to fill the frame (centred), `contain` shrinks the frame to the photo's shape, `stretch` shows the whole photo distorted. |
| `radius` | px | 0 | Corner radius. |
| `border` | `{ width, color }` | none | |
| `mask` | shape id | `none` | e.g. `ellipse`, `heart`, `star`. |
| `maskPath` | SVG path (`M L C Q A H V Z` and numbers) | none | Custom clip. |
| `adjust` | `{ key: number }` | `{}` | `brightness contrast saturation warmth tint exposure highlights shadows vibrance sharpness blur vignette grain hue fade clarity splitShadowHue splitShadowAmount splitHighlightHue splitHighlightAmount splitBalance black white gamma`, each −1000…1000 (the studio's sliders use ±100). |
| `filter` | name or `{ name, intensity 0–100 }` | none | A key of `LE.presets.filters`. |
| `recipe` | recipe id, `{ id, strength }`, or the long form | none | Shorthand: applies that recipe's look on top of `adjust`. The studio writes the long form `{ id, name, strength, add, prev, filter, prevFilter }` so the look can be re-tuned or removed. |
| `removeBg` | `{ color, tolerance 0–255 }` | none | Colour-key removal. |
| `fx` | `{ src, kind, … }` | none | Baked photo effect (`duotone`, `outline`, `blurbg`); `src` is the original photo. |
| `cutout` | `{ src, enabled, model, feather, refine, outline }` | none | Background removal that stays editable. `src` is the mask image (white or alpha = keep) at the photo's resolution, given like any image source (data: URI, relative path, device id; `asset` is accepted as an alias). `enabled` (true), `model` (e.g. `u2netp`, informational), `feather` 0–50 px (0), `refine` `guided` or `none` (`guided`), `outline` `{ color, width 0–200 }` or none. Needs a `src` photo. Template links drop the cut-out with the photo. |
| `source` | `{ provider, photographer, pageUrl, photographerUrl, license, attribution }` | none | Stock credit kept with the photo. |

If `w` and `h` are both missing and the photo is known, the image is as wide as the page with the photo's proportions; with one of them missing, the other follows the photo.

A recipe on an empty slot is fine: the look applies to the photo the person adds.

### Shape

| Key | Type / range | Default | Notes |
|---|---|---|---|
| `shape` | shape id | `rectangle` | `rectangle rounded-rectangle ellipse triangle right-triangle diamond pentagon hexagon octagon star burst heart cloud speech-round speech-square arrow-right arrow-double arrow-curved chevron plus cross ring arc half-circle parallelogram trapezoid cylinder blob blob-2 blob-3 line dashed-line arrow-line polyline curve`. `rect` is accepted. Unknown ids draw a rectangle and warn. |
| `params` | `{ name: number }` | shape defaults | e.g. `rounded-rectangle` `{ "radius": 36 }`, `star` `{ "points": 5, "innerRatio": 0.4 }`. |
| `radius` | px | 0 | |
| `fill` | fill | none | **No fill unless you give one.** |
| `stroke` | colour or `{ width, color, dash, cap, join }` | none | A colour string means a 4 px stroke. |
| `redact` | `{ mode, amount, color }` | none | Makes the shape a redaction of everything beneath it, burned in on export: `mode` `solid` (default), `pixelate` or `blur`; `amount` 0–500 page px (0 = automatic, never too weak to hide text); `color` hex for `solid` (`#17131F`). |

### Icons and SVG

`type: "icon"` is shorthand for an `svg` layer that names a catalogue icon:

```json
{ "id": "sun", "type": "icon", "icon": "lucide:sun", "color": "#17131F", "strokeWidth": 2, "x": 40, "y": 40, "w": 96 }
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `icon` / `assetId` | `set:name` | — | Sets: `lucide` (2100), `phosphor` (1798, also `ph:`), `emoji` (918), `stickers` (42), `withicons:<style>/<icon>`. |
| `color` | colour | `#17131F` for lucide / phosphor | |
| `strokeWidth` | 0–48 | 2 for lucide | |
| `w`, `h` | px | 120 | One side given → square. |
| `iconStyle` | object | none | Icon picker state (`style`, `name`, `palette`, `color`, `colors`). |
| `qr` | `{ text, fg, bg, ec }` | none | QR code settings (QR layers keep their `svg`). |

The studio writes icons as `{ "type": "svg", "assetId": "lucide:sun", … }` without markup. An `svg` layer with raw `svg` markup is allowed (≤ 200 KB) but goes through the SVG sanitiser; markup with `<script>`, event handlers, `foreignObject` or `javascript:` is refused.

### Path (drawings)

`points: [[x, y, pressure?], …]` (≤ 20000), `smoothing` 0–1 (0.55), `width` 0.5–2000 (4), `color` (`#17131F`), `mode` `pen` `marker` `highlighter`.

### Group

A `group` layer is a box; members point at it with `groupId`. Members are listed after the group as ordinary layers.

## Fills and colours

A **colour** is `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `rgb()` / `rgba()` / `hsl()` / `hsla()`, or a CSS name.

A **fill** is a colour string (→ `{ "type": "solid", "color": … }`), `"none"`, or `{ "type": "solid" | "linear" | "radial" | "none", "color", "colors": [..8], "angle" }`. Linear `angle` 0 runs left → right, 90 top → bottom.

## Backgrounds

| Form | Meaning |
|---|---|
| `"#FFF3E2"` | Solid colour. |
| `{ "type": "color", "color": "#FFF3E2" }` | Same, long form. |
| `{ "type": "gradient", "kind": "linear" \| "radial", "colors": [..], "angle": 90 }` | Gradient (2–8 colours). |
| `{ "type": "pattern", "id": "dots", "fg": "#E6DFF7", "bg": "#F5F1FF", "scale": 1 }` | Shorthand: a catalogue pattern, drawn crisp at the page size when opened. Also `type: "texture"`. |
| `{ "type": "image", "src": …, "fit": "fill", … }` | Photo background. |

Photo background fields (all optional except `src`):

| Key | Range | Default | Notes |
|---|---|---|---|
| `color` | colour | `#ffffff` | Base under the photo. |
| `fit` | `fill` `fit` `stretch` `tile` | `fill` | **Friendly names.** `fill` covers the page (stored as legacy `cover`), `fit` shows the whole photo (`contain`), `stretch` distorts to the page (stored as legacy `fill`), `tile` repeats. `cover` and `contain` are also accepted. The studio writes the friendly names. |
| `crop` | `{x,y,w,h}` 0–1 | full | |
| `x`, `y` | −10…10 | 0 | Offset of the photo centre, as a fraction of page width / height. |
| `scale` | 0.05–50 | 1 | Zoom on top of the fit; not for `tile`. |
| `rotation` | degrees | 0 | |
| `flipX`, `flipY` | boolean | false | |
| `opacity` | 0–1 | 1 | |
| `blur` | 0–250 px | 0 | |
| `dim` | `{ color, amount 0–1 }` | none | |
| `adjust`, `filter` | as on images | none | |
| `tile` | `{ size 0.02–4, gap 0–1 }` | `{ 0.25, 0 }` | Fractions of the page width. |
| `spec` | object | none | The gradient / pattern / texture recipe the studio redraws on resize. |

## Image sources

| `src` | What happens |
|---|---|
| `data:image/png;base64,…` (PNG, JPEG, WebP, GIF, AVIF, BMP) | Decoded and stored. One self-contained file. SVG data URIs are refused (use an `svg` layer). |
| `assets/beach.jpg` (relative path) | Read from the folder or zip that holds the file (`opts.resolve(path)`). Opened as a single file, the image is reported as missing and the frame stays empty. No `..`, `\`, `?`, `#` or leading `/`. |
| `https://…` | **Never fetched automatically.** The reader returns it in `remote` with its host; the studio asks once per host ("Download images from example.com?"). Skipped images stay as empty frames. `http:` and other schemes are refused. |
| 64 hex characters | An image already on this device (the studio's own asset id). |

Each image is ≤ 80 MB and must decode. Identical images are stored once (SHA-256).

## Collages

```json
{ "width": 1080, "height": 1350, "collage": { "layout": "r-2.3", "spacing": 14, "margin": 40, "radius": 18 },
  "layers": [ { "id": "photo-1", "type": "image", "slot": true }, … ] }
```

| Key | Range | Default | Notes |
|---|---|---|---|
| `layout` | layout id | best for the count | `r-2.3` = a row of 2 then a row of 3; `c-…` columns; `h-l-62` hero left at 62 % (also `r`, `t`, `b`); `m-2` mosaic with seed 2. |
| `template` | collage style id | none | A catalogue style (`assets/data/collages/index.json`). With no slot layers on the page, its slots and decorations are created. |
| `count` | 1–20 | none | Shorthand: how many empty cells to create when the page has no slot layers and the layout id does not say. |
| `spacing`, `margin` | px | 16 and 24 × (short side / 1080) | |
| `radius` | px | 0 | |
| `border` | `{ width, color }` | none | |
| `aspect` | `1:1` `4:5` `9:16` `16:9` `3:2` `2:3` `custom` | from the page | |
| `cells` | `[[x, y, w, h], …]` fractions of the content box | from `layout` | Authoritative geometry, ≤ 60. |
| `order` | slot ids | the slot layers in order | Cell *i* holds the image whose `slot.id` is `order[i]`. |

With only `layout` (or slot layers without positions), the reader lays the slots out; slot layers then need no `x`/`y`/`w`/`h`. With a `layout` like `r-2.3` and no slot layers, it creates `cell1…cellN`. The studio writes `cells` and `order` and the positions.

## Template variables

```json
"variables": [
  { "key": "name", "label": "Recipient name", "type": "text", "default": "Alex Morgan" },
  { "key": "photo", "label": "Photo", "type": "image" }
]
```

`key` starts with a letter or `_`, then letters, digits, `_ . -` (≤ 40). `type` is `text` (default) or `image`. `default` ≤ 2000. `{{name}}` inside any text is ordinary text for now; bulk create (roadmap 2.6) fills it. Variables are kept through open → edit → save (`meta.studio.variables`).

## The long form (what the studio writes)

- Keys in a fixed order; two-space indent; short lists and small flat objects on one line, so text diffs stay small.
- Layer key order: `id`, `name`, `type`, `x`, `y`, `w`, `h`, the common fields, then the type's own fields in the order of the tables above.
- Defaults are left out where the reader restores them: `name` equal to the id, `rotation 0`, `opacity 1`, normal blend, visible, unlocked, unflipped; text `Plus Jakarta Sans` / 700 / 48 / `#17131F` / left / 1.2; empty `adjust`; full `crop` on an empty frame; shape fill `none`.
- `x y w h` are rounded to 0.01 px, fractions to 0.0001. Text `h` is always written.
- Photos carry `crop` always. Icons are written by asset id, never as inline SVG.
- Per-layer side data the studio keeps in `meta.studio` (`icons`, `qr`, `fx`, keyed by layer id) is written on the layer as `iconStyle`, `qr` and `fx`, and moved back on read.
- An applied recipe (`adjust.recipe` inside the studio) is written as `recipe` next to `adjust`.
- Background `fit` uses the friendly names.
- Images: `embed` writes data URIs (one self-contained file, the default in the studio); `paths` writes `assets/<readable-name>.<ext>` and returns the list of files for a folder or zip. Cut-out masks are written the same way, as `cutout.src`.
- Page ids are written from the page (`page.id`).
- Reading a long-form file and writing it again gives the same bytes.

## What the reader refuses

| Refused | Path points at |
|---|---|
| Not JSON, not an object, `format` missing or different, `version` missing or not 1 | `""`, `/format`, `/version` |
| Keys named `__proto__`, `constructor`, `prototype` anywhere | the key |
| Any string (except `svg` markup and `src`) containing HTML tags such as `<script`, `<img`, `<a`, `<svg`, or `javascript:` / `vbscript:` / `data:text/html` | the string |
| Unknown layer `type`, layers that are not objects, duplicate ids, bad ids | the layer / `type` / `id` |
| Wrong value types (`"x": "left-ish"`, `"opacity": "half"`, bad colours) | the field |
| `src` with `javascript:`, `http:`, `file:` or any other scheme; SVG data URIs; paths with `..` | `src` |
| SVG markup with script, event handlers, `foreignObject`, `javascript:`, DOCTYPE/ENTITY, or that the sanitiser cannot read; > 200 KB | `svg` |
| Unknown catalogue icons, unknown recipes, unknown collage styles | `icon` / `recipe` / `collage/template` |
| Files over 12 MB; more than 50 pages, 600 layers per page, 50 variables; nesting deeper than 40 | the list |
| Images that do not decode, unsupported image types, images over 80 MB | `src` |

A refused file changes nothing in the studio. Errors are `{ "path": "/pages/0/layers/2/x", "message": "…" }`.

Warnings (the file still opens): `unknown-key`, `default-size`, `unknown-shape`, `unknown-icon` (a set that does not ship), `missing-image`, `shrink-needs-height`, `link-image`, `remote-failed`, `sanitised`, and the lint kinds below.

## Lint

`LE.design.lint(project)` → `[{ path, layer, kind, message }]`. Run after every read.

| Kind | When |
|---|---|
| `overflow` | Text taller than its box (4 % slack), or a word wider than the box. |
| `clipped` | A text box runs past the edge of the page. |
| `off-page` | A layer is completely outside the page. |
| `missing-image` | A photo's asset is not available. |
| `unknown-font` | A font family that does not ship with LocalEditor. |
| `low-contrast` | Text colour against a solid page colour, a text highlight, or a solid rectangle fully behind it, under 3:1 (size ≥ 24) or 4.5:1. Over photos and gradients only with a renderer: `LE.design.lintRendered` (in the studio it uses the studio's renderer) draws each page once at low resolution without its text and judges the contrast reached over 80 % of the text box (20th percentile); plain `lint` accepts the same as an `opts.sample(pageIndex, box, layer) → [[r, g, b], …]` hook and otherwise skips them. |

## Fonts that ship

Sans: Inter, Poppins, Montserrat, DM Sans, Manrope, Space Grotesk, Outfit, Nunito, Work Sans, Rubik, Plus Jakarta Sans. Serif: Playfair Display, Lora, Merriweather, DM Serif Display (400), Cormorant Garamond, Libre Baskerville, Fraunces, EB Garamond, Instrument Serif (400). Display: Bebas Neue, Anton, Archivo Black, Abril Fatface, Righteous, Lobster, Bungee (all 400), Oswald, Syne. Handwriting: Dancing Script, Caveat, Kalam, Great Vibes, Sacramento, Pacifico, Satisfy, Allura, Shadows Into Light, Homemade Apple, Mr Dafoe, Alex Brush (400 unless listed with 700). Mono: JetBrains Mono, Space Mono, IBM Plex Mono. Most families have 400 and 700; a weight that does not exist uses the nearest.

## Recipes that ship

`cinematic-portrait soft-wedding golden-hour soft-skin crisp-headshot clean-product white-sweep ecommerce-export fresh-food moody-table vivid-landscape blue-hour misty-morning vintage-film warm-negative teal-orange instant-fade classic-bw noir silver-matte sepia-print feed-pop pastel-dream clean-scan whiteboard crisp-receipt`, plus recipes the person saved.

## Template links (remix)

A design without its photos can travel in a link: `https://localeditor.net/studio/#d=<payload>`. The part after `#` never reaches a server.

- `payload` = one tag letter + base64url (no padding) of the minified design JSON: `z` = deflate-raw (`CompressionStream`), `j` = plain JSON (browsers without compression; longer links). Same scheme as recipe links.
- Caps: payload ≤ 30,000 characters; decompressed ≤ 512 KB. Larger links are refused before anything is parsed.
- The link form carries layout, text, styles, shapes, icons by asset id, colour / gradient / pattern backgrounds, collage meta, variables and the `remix` credit, and **no bitmaps**: photos become empty slots that keep their frame, crop, mask, radius, border, look (`adjust`, `filter`, `recipe`) and label. Photo backgrounds and baked effects are left out (the share dialog says so).
- The decoded text goes through `LE.design.parse` with `link: true`: any `src` in a link is dropped, never fetched.
- Opening a link shows a "Shared template" sheet (name, pages, preview with empty slots, "Originally by …") with **Use this template** / **Cancel**. Using it adds a new design; the open one stays in Your designs. A damaged or oversized link shows a message and changes nothing.
- QR codes are offered for links up to 1,200 characters (denser codes do not scan reliably from a screen).

Measured on the examples (link length, characters, Chromium deflate): hello-world 360, quote-card 686, collage 710, summer sale 810, YouTube thumbnail 820, sale banner 1,006, event invite 1,110, carousel (4 pages) 1,137, travel story 1,154, certificate 1,322.

## API

```js
LE.design.parseLayer(shorthandLayer, { width, height, background?, assets? }, { resolve?, link? })
  → Promise<parse result + { layer }>   // one layer; every path is relative to the layer ("/x", "/src")
LE.design.layerToLong(layer, { width, height, assets, studio })   → the long form of one studio layer (images by id)
LE.design.lintRendered(project, { render?(page, scale) → Promise<canvas> }) → Promise<warnings[]>   // lint + contrast over photos and gradients
LE.design.parse(textOrObject, { resolve?(path) → Blob|Promise<Blob>, link?: boolean, assets?: { id: meta } })
  → Promise<{ ok, project, assets: { id: Blob }, remote: [{ url, host, refs }], regenerate: [pageIndex], errors: [{ path, message }], warnings: [{ path, layer?, kind, message }] }>
LE.design.stringify(project, { images: 'embed' | 'paths' | 'ids' | 'none', dataUris?, minify?, remix? })
  → { text, assets: [{ id, path, name, type, bytes }], dropped, missing }
LE.design.exportText(project, { images = 'embed', blobs? }) → Promise<{ text, assets, bytes, missing, dropped }>
LE.design.lint(project, { measure? }) → warnings[]
LE.design.fetchRemote(result, [hosts]) → Promise<result>   // only after the person agreed
LE.design.toLink(project, { by?, base?, compress? }) → Promise<{ url, payload, length, chars, json, fits, compressed, qr, dropped }>
LE.design.fromLink(urlOrHash) → Promise<parse result>
LE.design.openShare(ctx), LE.design.saveDialog(ctx), LE.design.importText(ctx, text, { name, resolve })   // studio UI
```

## Ten examples

| File | Shows |
|---|---|
| `hello-world` | The smallest useful file. |
| `summer-sale-post` | Shapes past the page edge, icon, text highlight pill. |
| `travel-story` | 9:16 story, gradient background, photo slot with border, shadow and `recipe`. |
| `quote-card` | `fit: "shrink"` on a fixed box. |
| `sale-banner` | Pattern background shorthand, rounded-rectangle button. |
| `youtube-thumbnail` | Photo slot, gradient-fill shape, outlined text, rotation, `fit: "shrink"`. |
| `photo-collage` | `collage.layout` with five slots laid out by the reader. |
| `tips-carousel` | Four pages with page ids. |
| `event-invite` | Script and serif type, outline frames, icons with text. |
| `certificate` | `variables` and `{{name}}`, signature, seal. |
