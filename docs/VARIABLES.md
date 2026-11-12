# Template variables and bulk create

Roadmap 2.6. `{{name}}`, `{{price}}`, `{{photo}}` in any text or photo slot; fill a design once, or bring a list and get a
zip (or a PDF, or print sheets, or pages) of finished designs. Everything is read, drawn and packed on the device.

| File | What |
|---|---|
| `assets/js/le-variables.js` | `LE.variables`: placeholders and pipes, the variable list, the filler (the drawing hook), list reading, matching, checking, the bulk engine, the zip and PDF writers, print sheets, agent operations, lint. No studio dependency. |
| `assets/js/le-studio-variables.js`, `assets/css/studio-variables.css` | The **Fields** panel (fill once, make a field, bind a layer) and **Create many** (six steps). Deferred with `LE.modules.defer`. |
| `assets/data/templates/fields.json` | Ten ready templates as plain design files with variables, values and an example list. Built by `scripts/build-field-templates.js`. |
| `tests/variables.test.js`, `tests/bulk.test.js` | The tests. |

## The data model (all plain data in the document)

```json
{
  "format": "localeditor-design", "version": 1, "name": "Badges",
  "variables": [
    { "key": "name", "label": "Name", "type": "text", "required": true, "sample": "Grace Okafor" },
    { "key": "colour", "label": "Badge colour", "type": "colour", "default": "#1F4FD8" },
    { "key": "photo", "type": "image" }, { "key": "vip", "type": "boolean" }, { "key": "ticket_url", "type": "url" }
  ],
  "values": { "name": "Grace Okafor", "colour": "#1F4FD8" },
  "pages": [{ "width": 1200, "height": 900, "print": { "w": 101.6, "h": 76.2, "dpi": 300 }, "layers": [
    { "id": "band", "type": "shape", "shape": "rectangle", "fill": "#1F4FD8", "bind": { "color": "colour" }, "x": 0, "y": 0, "w": 1200, "h": 250 },
    { "id": "name", "type": "text", "text": "{{name}}", "overflow": "shrink", "minSize": 64, "x": 80, "y": 372, "w": 1040, "h": 150, "size": 124 },
    { "id": "pic", "type": "image", "slot": true, "bind": { "content": "photo", "fit": "cover" }, "x": 900, "y": 300, "w": 240, "h": 240 },
    { "id": "star", "type": "icon", "icon": "lucide:star", "bind": { "show": "vip" }, "x": 1080, "y": 40, "w": 80 },
    { "id": "qr", "type": "svg", "name": "QR code", "svg": "<svg …>", "bind": { "content": "ticket_url" }, "x": 40, "y": 640, "w": 200, "h": 200 }
  ] }]
}
```

| Where | Field | Meaning |
|---|---|---|
| document | `variables` (`meta.studio.variables` in a project) | `[{ key, label, type, sample, default, required }]`, ≤ 50. `type`: `text number date image colour url boolean`. Optional: fields are found from the layers (`LE.variables.definitions`) and merged with this list, which only carries labels, types, examples and defaults. `name` is accepted for `key`, `color` for `colour`. |
| text layer | `{{key}}` / `{{key\|pipe:arg\|pipe}}` | Filled when drawn. `{{#}}` / `{{#total}}`: the row number and the number of rows. |
| text layer | `overflow`, `minSize` | `shrink` (default for text with fields): the largest size, down to `minSize` (40 % of `size`), at which the filled text fits the box without breaking a word; `wrap`: keep the size, let it grow; `ellipsis`: keep the size, cut with "…". |
| any layer | `bind: { content, color, show, fit }` | `content`: a photo slot's photo (image layer) or a QR code's text (svg layer named "QR …", drawn with the studio's encoder and the template's colours). `color`: a hex value for a text, shape or icon colour. `show`: a yes / no field shows or hides the layer (`!key` inverts). `fit`: `cover` (default; the crop keeps the template's focal point, the centre of its crop) or `contain`. |
| page | `values` | `{ key: text \| number \| boolean }` (≤ 60, strings ≤ 2,000). An image field's value is an asset id in a project, an image source in a file. In a `.ledesign.json` a top-level `values` fills every page and a page's own `values` win; the writer puts values shared by every page at the top. |
| page | `print` | `{ paper, w, h, dpi }`, millimetres. Now also read and written by the open format, so templates print at real size. |

**Filling never changes the layers.** `LE.Scene` draws a page with `values` through one hook (`P._filled`, below): each layer
with a field is drawn as a filled copy; without `values` the page shows its `{{fields}}`. So one file is both the template and
its filled-in copy, Reset to template is "remove `values`", and undo is ordinary page history.

Sanitising: `LE.Scene.bindOf`, `valuesOf`, `variablesOf` (in `le-objects.js`) are used by the scene, `LE.project.validate`
(`.leproject`) and `LE.design.parse` alike. Keys match `^[A-Za-z_][\w.-]{0,39}$`; `__proto__`, `constructor` and `prototype`
are refused; control characters are removed; values are only ever drawn as text on a canvas or set as `.value` /
`.textContent`, never parsed as markup.

### Pipes (a closed set)

| Pipe | Example | Result (en-US) |
|---|---|---|
| `upper`, `lower`, `title` | `{{name\|title}}` | `ana de la cruz` → `Ana De La Cruz` |
| `number[:0–6]` | `{{count\|number}}` | `1234.567` → `1,234.57` (2 decimals at most unless given) |
| `currency:CODE` | `{{price\|currency:INR}}` | `899` → `₹899`, `12.5` → `₹12.50` (whole amounts drop the decimals) |
| `date:long\|medium\|short\|iso\|year\|month\|day\|weekday` | `{{date\|date:long}}` | `12/11/2026` → `November 12, 2026` |
| `default:text` | `{{seat\|default:Open seating}}` | used when the value is empty or missing |

Numbers are read as people type them (`1,234.50`, `1.234,50`, `₹ 1 200`, `12%`); dates as `2026-11-12`, `12/11/2026`
(day first; `11/30/2026` reads month first), `12 Nov 2026`, `Nov 12, 2026` or an Excel day number. Formatting uses the
browser's language (`LE.variables.locale` overrides). An unknown pipe or a bad argument is drawn literally (`{{a|shout}}`) and
reported by lint as `unknown-pipe`. A missing value keeps its `{{token}}` on screen (so you see what is left to fill) and is
empty in bulk output. One pass: a value that contains `{{…}}` is never expanded.

## Fill once (the Fields panel)

Rail → **Fields** (`?tool=fields`), or the toolbar chip **Make field** on a text layer.

- Each field gets the input for its type (text, number, date, colour picker and hex, yes / no switch, photo picker, link).
  Typing updates the canvas live; each field edit is one undo step. Other pages that showed the same values follow.
- **Make this a field**: on a selected text box, the whole text becomes `{{key}}` and its old text the value; while editing,
  selected words alone become the field. The key comes from the text (`Hello Ana` → `hello_ana`) and can be renamed.
- **Edit** a field: label, key (renaming changes every `{{key}}`, binding and value in every page in one step, with Undo in
  the toast), kind, example, default, required.
- **This layer**: overflow (Shrink to fit · Wrap · Cut with …) for text with fields; "Fill this photo / QR code from a field",
  "Colour from a field", "Show only when" (yes / no), each with "New field…".
- **Fill with examples**, **Reset to template** (removes the values; undo brings them back).
- **Ready templates**: certificate, name badge, place card, price tag, product card, event ticket with QR, gift voucher, class
  award, quote series, shelf label. Also under Design → Templates ("Fill-in templates"). Each opens as a new design with its
  example list ready in Create many.

## Create many

Fields → **Create many** (`?tool=bulk`). Six steps; one primary action each; the open design is the template.

1. **Your list**: paste cells from a spreadsheet, choose or drop a `.csv` / `.tsv` / `.xlsx` (sheet picker), **Type it here**
   (a table on wide screens, one card per row on a phone), or **Try the example list**. First row = column names.
2. **Match**: each field picks a column (matched by name, label, common synonyms, then type), "Leave empty" or "Same text for
   every row". Unmatched required fields and unused columns are listed.
3. **Photos** (only when a photo is bound): choose photos or a folder; matched by file name, case and extension ignored
   (`ana.jpg` = `Ana.JPG` = `ana`); not-found names, duplicate names and unused photos are listed.
4. **Check**: every row coerced and measured with the real fonts. Problems: `missing` (required), `type` (not a number, date,
   colour, yes / no; QR text over 1,200 characters), `photo` (no file), `overflow` (too long even at `minSize`),
   `unknown-pipe`. **Fix here** edits that row's cells and checks it again. "Leave out rows with missing or wrong values" (on
   by default; long text is only listed, since it is shrunk or cut).
5. **Preview**: step through rows on the real canvas (a preview value set on the scene, `scene._varPreview`, never written to
   the document), and a contact sheet of thumbnails (first 120, flagged rows marked, "Only rows that need a look").
6. **Create**: **Images (zip)** PNG / JPG / WebP at ½× / 1× / 2× with a file-name pattern (`{{name}}-certificate`);
   **One PDF** (page size from `print`, else 96 dpi); **Print sheets** (A4 / Letter, portrait or wide, size on paper in mm,
   cut marks; one PDF); **Pages here** (one page per row after the current one, each with its row as `values`, capped at the
   50-page design limit; Undo in the toast). Progress with time left, **Pause** / **Resume**, **Cancel** (nothing is
   downloaded). The zip carries `problems.csv` when rows had notes.

File names: the pattern is filled (missing → empty), then `/ \ : * ? " < > |` and control characters become `-`, `..`
collapses, leading and trailing dots and spaces go, reserved Windows names get `_`, ≤ 100 characters, empty → `design-N`,
and duplicates get `-2`, `-3` (case-insensitive). Nothing can leave the zip's root.

The CSV report quotes every cell and prefixes `'` to cells starting with `= + - @`, tab or CR (no formula injection).

## The bulk engine and its limits

`LE.variables.run(opts)` renders one row at a time on one hidden `LE.Scene` (the same renderer as the export), encodes it
(`LE.exportImage`, the browser's own `toBlob`), adds the Blob to a writer and releases the canvas. The writers keep only
Blob references and small headers: `ZipWriter` (stored entries, UTF-8 names, CRC read once per file) and `PdfWriter`
(JPEG pages written object by object, xref at the end). Photos are decoded once at the size the export needs and kept for six
rows (LRU). JSZip is not needed.

| Limit | Value | Where |
|---|---|---|
| Rows per run | desktop 5,000 · modern phones / tablets 2,000 · older devices and Saver mode 500 | `LE.variables.rowCap()` (`LE.device.tier`, `LE.perf.mode`) |
| List file | CSV / TSV 50 MB (read in 1 MB slices), XLSX 25 MB | `LIMITS.fileBytes`, `xlsxBytes` |
| Columns, cell | 60 columns, 2,000 characters a cell (longer cells are cut and counted) | |
| Pasted text | 5 MB | |
| Photos | 3,000 files, 40 MB each | |
| QR text | 1,200 characters | |
| Zip | 3.5 GB (zip32) | |
| Pages here | the design's 50-page limit | |

Measured on this build machine (4 shared cores, headless Chromium, 12 November 2026); relative numbers matter more than
absolute ones:

| Case | Time per row | Output per row |
|---|---|---|
| Name badge 1200 × 900, PNG / JPG / PDF | 15 / 24 / 23 ms | 73 / 60 / 61 KB |
| Product card 1080 × 1350 with a photo, PNG / JPG / PDF | 67 / 51 / 43 ms | 1,168 / 147 / 147 KB |
| Certificate A4 at 300 dpi (3508 × 2480), PNG / JPG / PDF | 66 / 128 / 174 ms | 415 / 321 / 321 KB |
| Same three at the phone viewport (tier "modern") | 13–148 ms | same |
| 300 rows 1080 × 1080 JPEG, 12 photos rotating (`tests/bulk.test.js`) | 79 ms median, 28 s in all | 11 MB zip |
| JS heap during those 300 rows, after row 30 | 4.6–5.0 MB (flat) | |
| A 12 MB CSV (120,000 rows) streamed in full | 1.2 s | |

The JS heap stays flat because nothing is kept per row except the encoded Blob, which the browser's blob storage holds (and
pages to disk when it is large). Thousands of rows work in principle; the phone cap is set at 2,000 because the encoded
output still grows with the rows (a 2,000-row product-card zip is about 300 MB as JPEG). Encoding uses `canvas.toBlob`,
which browsers run off the main thread; rendering is on the main thread, one row per task, so the page stays responsive
(the progress line updates every row).

## Loading

- `le-studio-variables.js` (+ CSS) is declared with `LE.modules.defer` in `studio/index.html` (panels `fields`, `bulk`); it
  loads at idle or when a panel opens.
- `le-variables.js` loads only when needed: the Fields or Create many panel opens, or a page with `values` and fields is
  drawn or rendered. The detector is `LE.varBoot` in `le-objects.js` (like `LE.fxBoot`): until the filler arrives, layers with
  fields on a page with values are not drawn (no `{{token}}` flash), and `render()` waits for it.
- SheetJS (`xlsx.full.min.js`) loads only when an Excel file is chosen; the QR encoder only when a QR layer is bound; the
  template list only when the gallery is shown. Nothing is fetched from another host.

## API

```js
LE.variables.tokens(text) → [{ key, pipes: [{ name, arg }], bad, raw }]
LE.variables.fillText(text, values, { missing: 'keep' | 'empty' }) → { text, used, missing, unknown }
LE.variables.definitions(project) → [{ key, label, type, sample, default, required, uses: [{ page, layer, as }], unused? }]
LE.variables.renamePages(pages, from, to) → count; renameList(list, from, to); keyFrom(label, taken)
LE.variables.fillDoc(pageDoc, values, { dims(id), photo(value) }) → a filled copy with problems
LE.variables.parseCSV(text, { delimiter, maxRows }) / parseFile(file, { sheet, delimiter, maxRows, progress }) → Promise<table>
  table: { columns, rows: [[cells]], warnings, delimiter, encoding, sheets, sheet }
LE.variables.automap(columns, variables) → { key: column index | -1 }
LE.variables.rowsToValues(table, mapping, variables, { photos, fixed }) → { rows: [{ index, values, problems }] }
LE.variables.checkRows(pageDoc, rows) → Promise<rows> (adds overflow / unknown-pipe problems, real fonts)
LE.variables.photoIndex(files) → { match(value), unused(values), dupes, skipped, size }
LE.variables.run({ doc, rows, asset(id), photos, output: { kind: png|jpeg|webp|pdf|sheet, scale, quality, name, sheet: { paper, cellW, marks, margin, gap } }, control: { paused, cancelled }, onProgress })
  → Promise<{ ok, blob, ext, count, names, problems, ms, perRow, bytes, sheets } | { cancelled: true }>
LE.variables.lint(project, report?) → warnings (also called by LE.design.lint when loaded)
LEStudioVariables.useTemplate(id), makeField(), setValues(values), templates()
```

## Agents

Three operations in the agent vocabulary, implemented in `LE.variables.agent`:

| Operation | Example | Does |
|---|---|---|
| `variables.set` | `{ "op": "variables.set", "variables": [{ "key": "name", "label": "Name", "required": true }, { "key": "price", "type": "number" }], "rename": { "from": "nm", "to": "name" }, "remove": ["old"] }` | Defines (merges by key; `replace: true` replaces the list), renames everywhere, removes. Returns the fields with how often each is used. |
| `values.set` | `{ "op": "values.set", "values": { "name": "Ana", "price": "1.234,5", "photo": "data:image/png;base64,…" }, "page": "all" }` | Fills one page or all (default). Values are coerced by type (a wrong type is `invalid` at `/ops/N/values/key`); `null` removes a value; `clear: true` starts empty. Image values: a `data:image/…` URI (stored like any image) or an asset id. Returns required fields still missing. |
| `bulk.create` | batch op: `{ "op": "bulk.create", "rows": [{ "name": "Ana" }, …], "page": 0 }` | Output "pages": one page per row after the template page, in the batch (one undo step). |
| `bulk.create` | call: `LEAgent.bulk({ "rows": [ … ] \| "csv": "name,price\n…", "output": "png", "name": "{{name}}", "photos": { "ana.jpg": "data:…" }, "dryRun": false })` | Rows in, a zip or PDF out as base64 (≤ 20 MB) with `problems` per row (`{ row, kind, key \| layer, message }`), `skipped`, `mapping`, `ms`. `dryRun: true` only checks. |

Wiring for `assets/js/le-agent.js` (not edited here; another engineer owns it):

```js
// after OPS.make:
function varOp(name) { return function (W, op, path) { return LE.varBoot.ready().then(function (V) { return V.agent.op(name, W, op, path, err); }); }; }
OPS['variables.set'] = varOp('variables.set');
OPS['values.set'] = varOp('values.set');
OPS['bulk.create'] = varOp('bulk.create');
// in OP_ALIASES: variables: 'variables.set', values: 'values.set', bulk: 'bulk.create'
// in the console / call switch, next to case 'export':
case 'bulk': case 'bulk.create': if (o.output && o.output !== 'pages') return LE.varBoot.ready().then(function (V) { var c = C(); syncP(); return V.agent.bulk(o, project(), { asset: function (id) { return c && c.mem[id] ? c.mem[id].canvas : LE.project.assetRecord(id).then(function (r) { return r && r.blob; }); } }); }).then(function (r) { return wrap(r); });
// in window.LEAgent: bulk: function (o) { return call(Object.assign({ op: 'bulk' }, o)); }
// in help(): the three operations and their fields (copy the table above).
// in summarize(): case 'variables.set': return 'Define fields'; case 'values.set': return 'Fill in fields'; case 'bulk.create': return 'Add ' + (op.rows || []).length + ' pages from a list';
```

The gate (`gate()` → `LE.project.validate`) already keeps page `values`, layer `bind` / `overflow` / `minSize` and
`W.studio.variables`, so nothing else changes there.

CLI (`tools/le-cli`, not edited here):

```js
// lib/page-adapter.js, next to render():
function bulk(input) {
  if (!cur) return Promise.resolve({ ok: false, code: 'no-session', errors: [{ path: '', message: 'No design is open.' }] });
  return LE.varBoot.ready().then(function (V) { return V.agent.bulk(input, cur.project, { asset: canvasFor }); });
}
// window.__lecli: …, bulk: guard(bulk),
// lib/service.js:
async bulk(file, o) { const abs = this.sandbox.file(file, 'the design'); return this.exclusive(abs, async () => { await this.open(abs); const r = await this.engine.call(abs, 'bulk', o, 600000); if (!r.ok && !r.rows) fail(r); return r; }); }
// lib/cli.js COMMANDS:
async bulk(args) {
  const file = args._[0];
  if (!file || !args.data || !args.out) throw usage('localeditor bulk <design> --data list.csv -o out.zip [--format png|jpeg|webp|pdf|sheet] [--name "{{name}}"] [--photos dir] [--dry-run]');
  const csv = fs.readFileSync(args.data, 'utf8');
  const photos = {};
  if (args.photos) for (const f of fs.readdirSync(args.photos)) if (/\.(png|jpe?g|webp)$/i.test(f)) photos[f] = 'data:image/' + (/png$/i.test(f) ? 'png' : /webp$/i.test(f) ? 'webp' : 'jpeg') + ';base64,' + fs.readFileSync(path.join(args.photos, f)).toString('base64');
  return withService(args, async (svc) => {
    const r = await svc.bulk(file, { csv, output: args.format || 'png', name: args.name, photos, dryRun: !!args['dry-run'], maxBytes: 2e9 });
    if (r.file) fs.writeFileSync(args.out, Buffer.from(r.file.data, 'base64'));
    out(args, Object.assign({}, r, { file: r.file ? args.out : null }), (x) => (x.count != null ? 'Made ' + x.count + ' designs → ' + args.out : 'Checked ' + x.rows + ' rows') + (x.problems.length ? '\n' + x.problems.map((p) => '  row ' + (p.row + 1) + ' ' + p.kind + ': ' + p.message).join('\n') : ''));
    return r.ok ? 0 : 1;
  });
}
```

`MULTI`/known flags in `parseArgs` need `data`, `photos`, `name`, `dry-run` if the parser checks names.

## Shared-file hunks (for review)

- `le-objects.js`: `bindOf` / `valuesOf` / `variablesOf` sanitisers and `LE.varBoot` (next to `printOf`); `normalize` returns
  `bindOf(src, expertOf(src, layer))`; `values` in `_snapshot`, `_restore`, `load`; `P._filled` (one method) used in
  `_drawDocument`, `_pumpImage`, `_scheduleSvg` and `_prepareBitmaps`; `render()` waits for `LE.varBoot` when the page has
  values; exports `LE.Scene.bindOf, valuesOf, variablesOf, wrapText, textWidth, fontFamily`.
- `le-project.js`: `sanitizeLayer` calls `LE.Scene.bindOf`; `sanitizeDoc` keeps `values`; `assetIds` keeps photos named by
  values; `studioMeta` uses `LE.Scene.variablesOf`.
- `le-design.js`: `readVariables` (extended), `readValues`, `readBind` (+ `COMMON` / `BY_TYPE` entries), top-level and page
  `values`, page `print`; the writer's `values` (shared ones at the top), `bind`, `overflow`, `minSize`, `print`, extended
  variables; lint skips raw-token overflow and calls `LE.variables.lint` when loaded.
- `studio/index.html`: one `LE.modules.defer` line after `le-studio-makers.js`.
- `schema/design-1.json`: `variables` (extended), `values` (document and page), `bind`, `overflow`, `minSize`, page `print`,
  `{{key}}` colour shorthand.
