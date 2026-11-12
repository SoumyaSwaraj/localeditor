# Working fast: the LocalEditor command line, MCP server and local API

For coding agents (Claude Code, Codex, OpenCode, Cursor, Antigravity / Gemini CLI, …) that need to **make or change a design quickly**. The real LocalEditor engine runs in a headless Chrome, Edge or Chromium on this machine: the same text measuring, fonts, icons, shapes, recipes and renderer as the studio. Nothing is uploaded and the engine cannot reach the network.

There are two speeds and one vocabulary:

| | Fast path (this page) | Browser mode (agent mode, `window.LEAgent`) |
|---|---|---|
| What | `localeditor` command, `localeditor mcp`, `localeditor serve` API | The person's open studio tab |
| Who sees it | Nobody, until a person opens the file | The person watches each change, can pause, stop and undo |
| Speed | Tens of milliseconds per change once warm (a cold start is 2–3 s) | Animated, paced for a person |
| Use it for | Producing and fixing files, batch work, CI, renders | Working *with* a person on the same design |
| Operations | `apply` | `LEAgent.apply` — the same operation list |

The two meet in the **live link**: `localeditor link poster.ledesign.json` opens the person's browser on the design; every change you make to the file (with the CLI, MCP, or a plain text edit) appears in their tab, and their edits are written back to the file.

Install: Node 20 or later and Chrome, Edge, Chromium or Brave. From a checkout: `node tools/le-cli/bin/localeditor.js …` (or `npm link` in `tools/le-cli` to get `localeditor` and `le` on the PATH). Check with `localeditor doctor`.

## The loop: write → check → render → fix

```bash
le new poster.ledesign.json --preset instagram-portrait
le apply poster.ledesign.json ops.json          # one batch; prints new problems
le check poster.ledesign.json                    # exit 1 if any problem
le render poster.ledesign.json -o poster.png     # look at it
le apply poster.ledesign.json fix.json           # fix what check or your eyes found
```

1. **Read before you change.** `le show file` (MCP `design_read`) lists pages and every layer with id, type, text and box. Address layers by id.
2. **Small batches.** One `apply` per idea (layout, then type, then colour). A batch is atomic: if one operation is wrong nothing is written and the error names it (`/ops/2/layer/x`).
3. **Read the problems.** `apply` prints *new* problems; `check` prints all of them with JSON pointers:
   `overflow` (text taller or wider than its box), `clipped` (text past the page edge), `off-page`, `low-contrast`, `missing-image`, `remote-image`, `unknown-font`, `unknown-icon`, `unknown-shape`, `shrink-needs-height`, `refused-path`.
4. **Look.** `le render` (MCP `design_render` returns the picture to you directly). Check hierarchy, spacing and alignment — lint does not see taste.
5. **Use only what exists.** `le catalog fonts|icons|shapes|recipes|makers|layouts|sizes|fx [query]`. `le catalog fx` lists the expert effects, `le catalog fx <id>` prints one in full (parameters, ranges, an example entry), `le catalog fx schema` the blends, mask kinds and limits.

## Operations

A batch is a JSON list. Pages are counted from 0 or named by page id; without `page`, a layer is found on any page (ids are unique in a file) and new layers go on the current page (the first, or the last one `page.add` / `page.select` made current). Positions accept pixels, `"50%"`, or `left` / `center` / `right` (x) and `top` / `center` / `bottom` (y). The layer fields are the open format's (`docs/FORMAT-DESIGN.md`).

| op | Fields | Notes |
|---|---|---|
| `add` | `layer` (or `layers: [ … ]`), `page`, `at` | `at`: `"front"` (default), `"back"`, an index, `{ "above": id }`, `{ "below": id }`. Missing ids become `<type>-<n>`. |
| `update` | `id` or `ids`, `set` | `null` removes a field. Changing `text`? Add `"h": "auto"` to re-measure, or `"fit": "shrink"` with a fixed `h`. |
| `remove` | `id` or `ids` | Group members go with their group. |
| `reorder` | `id`, `to` | `front`, `back`, `forward`, `backward`, an index, `{ "above": id }`, `{ "below": id }`. Alias `move`. |
| `group` / `ungroup` | `ids` (+ `groupId`, `name`) / `id` | |
| `align` | `ids`, `edge` | `left center right top middle bottom`; one layer aligns to the page, several to their joint box. |
| `distribute` | `ids` (≥ 3), `axis` | `h` or `v`. |
| `page.add` | `width`, `height`, `background`, `layers`, `id`, `at` | Or `duplicate: <page>`. Becomes the current page. |
| `page.remove` / `page.select` / `page.move` | `page` (+ `index` for move) | |
| `page.resize` | `width`, `height`, `scaleContent` | Content scales by default. |
| `page.background` | `background` | Colour, gradient, pattern or image object. |
| `page.update` | `page`, `set` | `width height background collage id name`. |
| `replace` | `design` (+ `page`) | The whole design, or one page. |
| `rename` | `name` | |
| `text.replace` | `find`, `replace`, `page` (`"all"`), `ids`, `matchCase` | |
| `image.fill` | `id`, `src`, `fit` | `src`: a path next to the design (`assets/beach.jpg`), a `data:image/…` URI, or an `https://` URL (reported, not fetched). |
| `recipe` | `id`, `recipe`, `strength` | `recipe: null` removes the look. |
| `collage` | `layout` / `template` / `count`, `spacing`, `margin`, `radius`, `border`, `aspect` | Lays out the page's photo slots. |
| `make` | `maker`, `values`, `style`, `size`, `newPage` | Replaces the current page with a quick maker's design. |
| `fx.add` | `layer`, `entry: { type, p }`, `index` | Adds an expert effect to the layer's stack (non-destructive; `render` shows it). Types and parameters: `le catalog fx`. |
| `fx.update` / `fx.remove` / `fx.reorder` | `layer`, `id` (+ `p`, `on`, `amount`, `blend`, `mask` / `index`) | `id` is the entry id, or its type when the layer has one of that kind. `p` is merged. |
| `mask.set` | `layer`, `mask`, `fx` | Limits one effect (`fx`: entry id or type) or, without `fx`, the layer to an area. `mask: null` clears. |
| `adjust.add` | `fx: [ … ]`, `above`, `name`, `clip`, `x y w h` | An adjustment layer over everything beneath it. |
| `transform.set` | `layer`, `quad` | Perspective: four corners in page units. `quad: null` clears. |
| `note.add` / `note.resolve` | `text`, `layer` / `id`, `reply`, `status` | Notes live in the file under `notes`. |
| `doc.update` | `set` | `name variables remix notes`. |

Example batches:

```json
[
  { "op": "page.background", "background": "#14213D" },
  { "op": "add", "layer": { "id": "title", "type": "text", "text": "Bake sale\nSaturday 10am", "font": "Anton", "size": 160, "color": "#FFFFFF",
    "align": "center", "x": "center", "y": 90, "w": "86%", "h": 360, "fit": "shrink" } },
  { "op": "add", "layer": { "id": "hero", "type": "image", "slot": true, "x": 90, "y": 500, "w": 900, "h": 600, "radius": 32 } },
  { "op": "add", "layer": { "id": "badge", "type": "shape", "shape": "burst", "fill": "#E0B354", "x": 800, "y": 1090, "w": 220, "h": 220 } },
  { "op": "add", "layer": { "id": "cake", "type": "icon", "icon": "lucide:cake", "color": "#17131F", "x": 870, "y": 1160, "w": 80 } }
]
```

```json
[
  { "op": "update", "id": "title", "set": { "text": "Bake sale\nSunday 11am", "h": 360, "fit": "shrink" } },
  { "op": "reorder", "id": "badge", "to": "front" },
  { "op": "align", "ids": ["hero"], "edge": "center" },
  { "op": "text.replace", "find": "11am", "replace": "11 am", "page": "all" },
  { "op": "note.resolve", "id": "note-1", "reply": "Moved the date up" }
]
```

## Results and error codes

`--json` on every command prints one JSON object. Errors look like:

```json
{ "ok": false, "code": "not-found", "message": "/ops/0/id: There is no layer with the id \"titel\".",
  "errors": [ { "index": 0, "op": "update", "code": "not-found", "path": "/ops/0/id", "message": "…" } ] }
```

| code | Meaning | What to do |
|---|---|---|
| `invalid` | The file, an operation or a resulting field is wrong (path says where). | Fix that field. Nothing was written. |
| `not-found` | No such layer, page, note or file. | `le show` / `le find` for ids. |
| `conflict` | `--if-rev` / `if_rev` did not match: the file changed since you read it (the person may have edited it). | Read again, decide again. |
| `too-large` | Over a cap (12 MB file, 50 pages, 600 layers, 2000 ops, 80 MB image). | Smaller batches, relative image paths. |
| `sandbox` | The path is outside the allowed folder (MCP `--root`, serve folder) or escapes through a symlink. | Use files under the root. |
| `exists` | `new` / `make` / `convert` would overwrite. | `--force` / `overwrite: true`. |
| `unsupported` | Not available here. | — |
| `interrupted`, `paused`, `no-session`, `consent` | Agent-mode codes from the browser path (`LEAgent`); the fast path reports them unchanged when the engine runs on `LEAgent`. | See agent mode's help. |

Exit codes: `0` ok · `1` invalid input, problems found (`check`) or refused operations · `2` usage · `3` no browser or the engine failed.

## MCP (`localeditor mcp`)

Tools: `design_new`, `design_read` (outline or full), `design_apply` (optionally with `render: true` to get a picture back), `design_check`, `design_render` (returns an image block, downscaled to `max_edge`, default 1024), `design_find`, `catalog_search`, `design_make`, `design_validate`, `design_link_status`, `notes_read`, `notes_resolve`. Resources: the format guide, this page, the JSON Schema and the ten examples. Prompts: `design_from_brief`, `fix_problems`.

Only files under the folder the server was started in (or `--root`) can be read or written. Setup snippets for each client: `agent-kit/mcp/README.md`.

## Local API (`localeditor serve`)

`localeditor serve [dir]` prints the app address for people and an API base with a token, once:

```
GET  /api/<token>/state?file=poster.ledesign.json[&full=1]
POST /api/<token>/apply      { "file": "poster.ledesign.json", "ops": [ … ], "dryRun": false, "ifRev": "…" }
GET  /api/<token>/check?file=…
GET  /api/<token>/render?file=…&page=0&scale=1&format=png      → image bytes
GET  /api/<token>/find?file=…&q=…   ·   GET /api/<token>/catalog?kind=fonts&q=…
GET  /api/<token>/events?file=…      → Server-Sent Events: change, invalid, gone
POST /api/<token>/link       { "file": … } → { url } to open for the person
```

Requests must come from this computer with the server's own `Host` (and `Origin`, if any); bodies are `application/json`.

## Live link: working with a person

`localeditor link poster.ledesign.json` (or `serve --open poster.ledesign.json`) opens the person's browser on the design.

- **Your changes → their tab.** Write the file any way you like. The tab validates it, works out what changed by page and layer id, and applies it — through agent mode when it is there (animated, listed in the activity feed, waits while the person has paused you), otherwise as one undo step. An invalid file is not applied; the last good version stays on their screen.
- **Their edits → the file**, a moment after they stop, in the normalised form. Read the file again before your next change, or pass `--if-rev`.
- **Feedback without tools.** After every sync the bridge writes `poster.le/status.json` (`{ ok, rev, errors, warnings, conflicts, notes }`) and `poster.le/preview-<page>.png`. An agent that can only edit files can still write, read the status, look at the preview and fix.
- **Conflicts.** Different layers merge. If you both changed the same layer, the person's version is kept and yours is listed in `status.json` → `conflicts[].agent`. Re-apply it only if it still makes sense.
- **Notes.** The person can pin a note to a layer ("make this warmer"). Notes appear in the file under `notes`; read them with `notes_read` (or the file), act, then `note.resolve` with a short reply.

## Choosing the path

- The person is not looking, or you need many files, renders or CI checks → **fast path**.
- The person wants to watch, steer or take over → **browser mode**, or the **live link** if you prefer to keep working with files and the CLI.
- Never put HTML, script or `javascript:` in any string; the reader refuses the whole file.
