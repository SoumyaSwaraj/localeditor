# The open design format and live link — design draft

Status: **draft 0**, 12 November 2026. Written by the lead architect while phase 1 is being built. It becomes the spec for phase 3 once the phase 1 and 2 features report their document fields. Nothing here is implemented yet.

## The problem

People now make a lot of creative work with AI agents. The agent returns a flat picture or a block of HTML. To change one word the person asks again and gets a different picture. Nothing is editable, and nothing is shared between the person and the agent.

LocalEditor already has an editable, layered document. If an agent can write that document as a plain file, then:

- the agent's output opens in a real editor, and every layer can be moved, restyled or replaced;
- the person can watch the design change as the agent works;
- the person's own edits go back into the same file, so the agent's next change builds on them;
- all of it stays on the person's machine.

## What an agent needs from a format

Agents are good at structured text and poor at pixel geometry they cannot see. So the format has to be:

1. **Plain text, one file.** JSON that any agent can write with its normal file tools. No zip, no binary, no hashes it must compute.
2. **Forgiving to write, strict to read.** The importer accepts shorthand (below) and normalises it. It rejects anything unsafe. It never runs code.
3. **Addressable.** Every page and layer has a short readable `id` the agent chooses (`"title"`, `"hero-photo"`), so later requests can say "change `title`".
4. **Self-checking.** After every write the agent can get back a list of problems (text overflowing its box, layers off the page, low contrast, missing image) and a rendered picture. That feedback loop matters more than any single feature.
5. **Stable.** Versioned, with a published JSON Schema and migrations. A file written today opens in a year.

## The document

One logical document, three containers:

| Container | What it is | Who uses it |
|---|---|---|
| `name.ledesign.json` | The document as one JSON file. Images are relative paths, `https:` URLs, or `data:` URIs. | Agents, version control |
| `name.ledesign/` folder | `design.json` plus an `assets/` folder and a `.le/` status folder. | Live link |
| `name.leproject` | The existing zip: same document, images content-addressed inside. | People sharing one file |

Sketch of the JSON (field names follow what `LE.Scene` already stores, so import is mostly validation):

```json
{
  "$schema": "https://localeditor.net/schema/design-1.json",
  "format": "localeditor-design",
  "version": 1,
  "name": "Summer sale post",
  "pages": [
    {
      "id": "post",
      "width": 1080,
      "height": 1080,
      "background": { "type": "color", "color": "#FFF7E8" },
      "layers": [
        { "id": "hero", "type": "image", "src": "assets/beach.jpg", "x": 0, "y": 0, "w": 1080, "h": 700, "fit": "cover", "radius": 0 },
        { "id": "title", "type": "text", "text": "SUMMER\nSALE", "font": "Anton", "size": 180, "color": "#17131F", "align": "center", "x": "center", "y": 740, "w": "90%" },
        { "id": "badge", "type": "shape", "shape": "ellipse", "fill": "#E0B354", "x": 820, "y": 60, "w": 200, "h": 200 },
        { "id": "icon", "type": "icon", "icon": "lucide:sun", "color": "#17131F", "x": 880, "y": 120, "w": 80, "h": 80 }
      ]
    }
  ]
}
```

Layers are listed back to front. Layer types today: `image`, `text`, `shape`, `svg` (icons, stickers), `path` (drawings), `group`.

### Shorthand the importer accepts

| Shorthand | Normalised to |
|---|---|
| `"x": "center"`, `"y": "bottom"`, `"w": "90%"` | Pixels on the page |
| `"h"` missing on text, or `"h": "auto"` | Measured height of the wrapped text |
| `"fit": "shrink"` on text | Largest font size at which the text fits its box |
| `"fill": "#E0B354"` | `{ "type": "solid", "color": "#E0B354" }` |
| `"type": "icon", "icon": "lucide:sun"` | An `svg` layer with that asset id |
| `"src"` as a relative path, `data:` URI or `https:` URL | A stored image asset. Remote URLs are downloaded only after the person agrees, and the host is shown. |
| `"slot": true` and no `src` | An empty photo slot the person fills |
| `"recipe": "golden-hour"` on an image | That recipe's adjustments on the layer |
| `"template": "collage:grid-3"` on a page | The template expanded into layers |

Normalised documents written back by the studio use the long form, keys in a fixed order, two-space indent, so text diffs stay small.

### What the importer rejects

Script, HTML, event handlers, `javascript:` URLs, unknown layer types, keys named `__proto__`, `constructor` or `prototype`, SVG outside the existing sanitiser's tag list, files over the size caps, and more pages or layers than the caps allow. These are the same rules `le-project.js` enforces today, in one shared validator.

## Live link

The person picks a `.ledesign` folder (or file) in the studio. From then on:

- **Agent → studio.** The studio watches the file. On a change it validates, compares with the open document by layer id, and applies the difference as one undo step ("Agent changed 3 layers"). Changed layers flash on the canvas and are listed in an activity feed. An invalid file is not applied; the last good state stays on screen.
- **Studio → agent.** The person's edits are written back to the same file after a short pause.
- **Feedback for the agent.** After each load the studio writes into `.le/`:
  - `status.json` — `{ ok, rev, errors: [{ path, message }], warnings: [{ layer, kind, message }] }`. Warnings cover overflowing text, layers off the page, low text contrast, missing images, unknown fonts.
  - `preview-<page>.png` — the rendered page.
  So an agent can write, read the status, look at the picture, and correct itself with no vision of the screen.
- **Notes.** The person can pin a note to a layer or a point ("make this warmer"). Notes live in `design.json` under `notes`, with `status: "open" | "done"`. The agent reads them and marks them done.
- **Conflicts.** Each side keeps the last synced copy. If both changed, changes merge per layer; if both changed the same layer, the newer write wins and the other is one undo away.

Two transports, same behaviour:

1. **File System Access API** (Chrome, Edge, and other Chromium browsers on desktop). No server. Works from the hosted site, because the browser reads the local folder directly and nothing is uploaded.
2. **Local bridge** for every other browser and for agents that prefer tools over files: a zero-dependency Node command.
   - `le serve <folder>` — serves the app on localhost and syncs the folder with the open tab.
   - `le mcp` — an MCP server over stdio: `list_designs`, `read_design`, `write_design`, `patch_design` (operations addressed by layer id), `validate`, `render` (asks the open tab and returns a PNG), `list_fonts`, `search_icons`, `list_templates`, `list_recipes`, `read_notes`.
   - `le validate <file>` and `le new <name>` for use without a browser.

## Agent kit

- `llms.txt` and `docs/FORMAT-DESIGN.md`: the format, every layer type and field with ranges and defaults, ten worked examples.
- The JSON Schema at a stable URL.
- Drop-in instruction files: a Claude Code skill, `AGENTS.md` (Codex, OpenCode), a Cursor rule, an Antigravity rule. Each says: write `*.ledesign.json`, use ids, prefer shorthand, read `.le/status.json` after writing, fix warnings, never embed script.
- A catalogue the agent can query offline: font names, icon ids, shape ids, template ids, recipe ids, page-size presets.

## What phase 1 and 2 must respect so this works (rule A3)

- Every feature's state is plain data on the page or the layer. Reported so far or expected: `background` (photo crop, fit, blur, dim, adjust), collage meta and photo `slot`s, recipe steps, cut-out masks from the background remover, redaction regions, per-layer effects.
- State kept in `project.meta.studio` side maps keyed by layer id (`icons`, `qr`, `fx`) moves onto the layer itself in the open format, so a layer is self-contained.
- No feature may depend on a bitmap that cannot be regenerated from the document plus its source images.

## Document fields reported by phase 1 (source for the spec)

### Page background, photo (`background.type: "image"`) — merged
Paint order: base colour → photo (crop → adjust → filter, then placed or tiled) at `opacity`, blurred if `blur` > 0 → dim overlay. Missing fields take defaults, so older documents render unchanged.

| Field | Type / range | Default | Notes |
|---|---|---|---|
| `src` | asset id | required | |
| `color` | CSS colour | `#ffffff` | Base fill under the photo |
| `fit` | `cover` \| `contain` \| `fill` \| `tile` | `cover` | Stored names are legacy: `cover` is shown as "Fill", `contain` as "Fit", `fill` as "Stretch". The open format should accept the friendly names and map them. |
| `crop` | `{x,y,w,h}` fractions 0–1 | full | Same meaning as on image layers |
| `x`, `y` | −10…10 | 0 | Offset of the photo centre from the page centre, as a fraction of page width / height |
| `scale` | 0.05–50 | 1 | Zoom on top of the fit size; ignored for `tile` |
| `rotation` | degrees | 0 | Studio steps by 90 |
| `flipX`, `flipY` | bool | false | |
| `opacity` | 0–1 | 1 | |
| `blur` | 0–250 document px | 0 | |
| `dim` | `{color, amount 0–1}` | none | Overlay across the page |
| `adjust` | same keys as image layers | `{}` | brightness, contrast, saturation, warmth, tint, exposure, highlights, shadows, vibrance, sharpness, blur, vignette, grain, hue |
| `filter` | `{name, intensity 0–100}` | none | `name` is a key of `LE.presets.filters` |
| `tile` | `{size 0.02–4, gap 0–1}` fractions of page width | `{0.25, 0}` | |

Engine entry points: `scene.setBackground(bg, opts)`, `scene.background()`, `LE.Scene.backgroundSpec(bg)`.

### Stock photo source on an asset — merged
`asset.source = { provider, photographer, pageUrl, license, attribution }`. Unsplash hits also carry `photographerUrl`; the project sanitiser must keep it (assigned to the collage owner).
