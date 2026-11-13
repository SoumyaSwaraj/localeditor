# The brand file (`brand.lebrand.json`)

One brand as plain JSON: colours with roles, fonts by role, logos, spacing, tone words and do / don't lines. A person keeps it in the studio's **Brand kit**; an assistant or a script reads the same file and checks its designs against it. It is declarative data only: nothing in it is ever run, and the reader refuses markup, web addresses and paths that leave the folder.

Schema: `schema/brand-1.json`. Reader, checks and Brand kit conversion: `assets/js/le-brand.js` (`LE.brand`, also loadable from Node). Example: `examples/brand/brand.lebrand.json`.

```json
{
  "$schema": "https://localeditor.net/schema/brand-1.json",
  "format": "localeditor-brand",
  "version": 1,
  "name": "Harbour Bakery",
  "colors": [
    { "role": "primary", "value": "#14213D", "name": "Harbour navy" },
    { "role": "accent", "value": "#E0B354" },
    { "role": "background", "value": "#FFF8EC" },
    { "role": "text", "value": "#17131F" }
  ],
  "fonts": { "heading": { "family": "Anton", "weight": 400 }, "body": { "family": "Inter", "weight": 400 } },
  "logos": [ { "id": "main", "src": "assets/harbour-logo.png", "on": "light", "clearSpace": 0.25, "minWidth": 120 } ],
  "spacing": { "unit": 8, "margin": 64, "gap": 24, "radius": 16 },
  "tone": ["warm", "plain", "local"],
  "do": ["Lead with the product or the date, one idea per page."],
  "dont": ["Do not stretch or recolour the logo."],
  "rules": { "neutrals": true, "contrast": 4.5 }
}
```

## Fields

| Field | Meaning | Limits |
|---|---|---|
| `name` | The brand's name. | 80 characters |
| `colors` | A list of `{ role, value, name? }`, or the short form `{ "primary": "#14213D", … }`. `value` is a solid colour. Usual roles: `primary secondary accent background surface text muted success warning danger`; any short lower-case name works. | 40 |
| `fonts` | By role: `heading`, `subheading`, `body`, `accent`. Each is a family name from the font list (`localeditor catalog fonts`) or `{ family, weight }`. | — |
| `logos` | `{ id, src, name?, on?, clearSpace?, minWidth? }`. `src` is a path next to the brand file, or an embedded PNG, JPG, WebP or GIF as `data:image/…;base64,` (up to 256 KB each). `on`: `light`, `dark` or `any` background. `clearSpace`: empty space around the logo as a share of its shorter side. `minWidth`: smallest width in pixels. | 8 |
| `spacing` | Preferences in pixels for a 1080-wide page: `unit`, `margin`, `gap`, `radius`. Read by people and assistants; not checked. | — |
| `tone` | A few words for the voice of the text. | 12 words |
| `do`, `dont` | Short lines of plain text. Read by people and assistants; not checked. | 20 lines of 300 characters |
| `rules.neutrals` | Pure black and white are allowed next to the palette (default `true`). | — |
| `rules.contrast` | The ratio body text must reach on a brand colour (default 4.5; text of 24 px and larger needs 3). | 1–21 |

The whole file may be up to 2 MB. The reader refuses: text with markup or `javascript:`, keys named `__proto__`, `constructor` or `prototype`, logo paths with `..`, a leading `/` or a web address, embedded logos that are not one of the four picture types (no SVG), and colours that are not solid.

## A design that follows a brand

A design names its brand with one field (`docs/FORMAT-DESIGN.md`):

```json
{ "format": "localeditor-design", "version": 1, "brand": "brand.lebrand.json", "pages": [ … ] }
```

- **A path** (`"brand": "brand.lebrand.json"`, in the design's folder or below it, ending in `.json`). The command line, the MCP server and CI read the file. A browser cannot read a file by path, so the studio records the path, writes it back unchanged, and checks nothing by itself.
- **Inline** (`"brand": { "name": …, "colors": … }`; `format` may be left out). The design is self-contained and the studio checks it too.
- **Neither**: pass `--brand <file>` to `check`, `lint` or `brand check`.

## What is checked

`LE.design.lint` (and so `localeditor check`, `lint`, `brand check`, MCP `design_check` / `brand_check`) adds these warnings. Each has the layer id, a JSON pointer and, where one change settles it, a `fix`: one operation in the `apply` vocabulary.

| kind | Reported when | fix |
|---|---|---|
| `brand-color` | A page background, text colour, shape fill, outline, highlight, line or graphic colour is not in the palette (within a hair). Black and white pass unless `rules.neutrals` is `false`. Photos, gradients and field-bound colours are not judged. | The nearest brand colour. |
| `brand-font` | Text uses a family that is not a brand font. | `heading` for text of 48 px and larger, else `body`. Check that the text still fits. |
| `brand-contrast` | Text sits on a brand colour (the page colour, a covering rectangle or its own highlight) and does not reach the ratio. | The brand colour that reads best there, preferring the `text` role. |
| `brand-logo-size` | A logo layer is narrower than `minWidth`. | The width and matching height. |
| `brand-logo-space` | A logo's clear space runs past the page edge, or another layer sits inside it. | A new position for the edge case; neighbours are named, not moved. |

A **logo layer** is an image, graphic or icon whose id is a brand logo's `id` or `logo-<id>`, or whose id or name contains the word `logo`.

```bash
localeditor brand show brand.lebrand.json                 # check the brand file, print what it asks for
localeditor check poster.ledesign.json --brand brand.lebrand.json
localeditor brand check poster.ledesign.json --json       # → { problems: [ { kind, layer, message, fix } ], fixes: [ … ] }
localeditor brand check poster.ledesign.json --fix        # apply every fix in one batch, check again
```

`fixes` is a ready operation list: updates to the same layer are merged. Apply it with `localeditor apply`, MCP `design_apply` or `LEAgent.apply`, then check again and look at a render: a fix chooses the nearest colour, not the best design.

## The studio's Brand kit

Brand kit → **Brand file** has two buttons.

- **Import brand file** replaces the kit's colours and fonts with the file's and adds its embedded logos. Logos named by path cannot be read by a browser; the studio says how many were left out.
- **Export brand file** downloads `<name>.lebrand.json` with the kit's colours, its heading, subheading and body fonts and its logos (embedded, up to 256 KB each).

The kit stores colours without roles. On export, roles, tone, spacing and the do / don't lines come from the brand file imported in this tab, or from the open design's inline brand; otherwise the lightest colour becomes `background`, the darkest `text`, then `primary`, `accent`, `colour-1`…. Edit the roles in the file if the guess is wrong.

## API (`LE.brand`)

```js
LE.brand.read(textOrObject)            // → { ok, brand, errors: [{ path, message }], warnings }
LE.brand.lint(project, brand)          // → [{ path, kind, message, layer, fix }]
LE.brand.fixes(warnings)               // → operations for apply
LE.brand.summary(brand)                // → a short text for an assistant
LE.brand.toKit(brand, kit) / fromKit(kit, previousBrand)
```

In Node: `require('<site>/assets/js/le-brand.js')` gives the same object (no DOM needed for `read`, `lint`, `fixes`, `summary`).
