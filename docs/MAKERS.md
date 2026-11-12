# Quick makers

A maker is a small guided form (a few words, a photo or two, a style) that produces a finished design made of ordinary, editable layers. It never produces a flat picture. Every made page records the form values in `doc.maker`, so "Edit details" can reopen the form, and an agent can write a design by writing only that block.

Files:

| File | What |
|---|---|
| `assets/js/le-makers.js` | `LE.makers`: registry, validation, layout helpers (`env`), build pipeline, quality checks. Pure: no studio dependency. |
| `assets/js/makers/<id>.js` | One maker per file, loaded lazily by `LE.makers.ready()`. List the file in `FILES` at the top of `le-makers.js`. |
| `assets/js/le-studio-makers.js`, `assets/css/studio-makers.css` | Gallery (Apps → Make, start screen), form sheet with live preview, Edit details, `?make=` links. |
| `tests/makers.test.js` | Builds every maker × style × size × {sample, minimal, worst} and checks the results. New makers are covered automatically. |

## Add a maker in about 40 lines

```js
/* assets/js/makers/badge.js */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  LE.makers.register({
    id: 'badge', name: 'Name badge', category: 'Events', summary: 'A name and a role, ready to print.',
    keywords: ['badge', 'name tag', 'conference'],
    // sizes: omit for square, portrait (4:5) and story (9:16), or pass ids / { id, name, w, h }
    inputs: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 40, placeholder: 'Ada Lovelace' },
      { key: 'role', label: 'Role', type: 'text', max: 60 },
      { key: 'photo', label: 'Photo', type: 'photo' }
    ],
    styles: [{ id: 'clean', name: 'Clean' }, { id: 'dark', name: 'Dark' }, { id: 'bold', name: 'Bold' }, { id: 'soft', name: 'Soft' }],
    sample: { values: { name: 'Ada Lovelace', role: 'Analyst', photo: 'sample:people-03' } },
    build: function (v, env) {
      var dark = env.style === 'dark';
      var bg = dark ? '#141318' : '#FFFFFF', ink = env.color.readable(bg, ['#16131C']);
      var page = env.page(bg), M = 96, L = [];
      var y = env.tall ? 240 : 120;
      if (v.photo) { L.push(env.photo({ id: 'photo', src: v.photo, x: (env.W - 360) / 2, y: y, w: 360, h: 360, mask: 'ellipse', label: 'Your photo' })); y += 420; }
      var name = env.text({ id: 'name', name: 'Name', text: v.name, x: M, y: y, w: env.W - 2 * M, h: 300,
        font: 'Fraunces', weight: 700, size: 120, min: 40, align: 'center', balance: true, color: ink });
      L.push(name);
      if (v.role) L.push(env.text({ id: 'role', name: 'Role', text: v.role, x: M, y: name.y + name.h + 24, w: env.W - 2 * M,
        font: 'Inter', weight: 700, size: 34, min: 20, maxLines: 2, uppercase: true, tracking: 0.12, align: 'center', color: ink }));
      env.place(L, { x: 0, y: 120, w: env.W, h: env.H - 240 }, 'middle');
      page.layers = L;
      return { name: 'Badge — ' + v.name, pages: [page] };
    }
  });
})();
```

Then add `'badge'` to `FILES` in `le-makers.js`, run `node tests/run.js makers`, and look at your contact sheet (below).

## The definition

| Field | Meaning |
|---|---|
| `id` | `^[a-z][a-z0-9-]{1,39}$`. Also the file name and the `?make=` id. |
| `name`, `category`, `summary`, `keywords` | Gallery card, category chips and search. Categories in use: Social, Business, Life, Photo, Print. |
| `sizes` | `[{ id, name, w, h }]` or ids from `LE.makers.SIZES` (`square` 1080×1080, `portrait` 1080×1350, `story` 1080×1920) or paper ids from `LE.makers.PAPER` (see Print below). First is the default. |
| `maxPages` | Most pages one build may return (default 8, at most 50, the project's page limit). Multi-page makes land as consecutive pages; Edit details on any of them remakes the whole run. |
| `inputs` | `{ key, label, type, required, max, placeholder, options, default, hint }`. See types below. |
| `styles` | `[{ id, name }]`, 4–6 genuinely different looks. First is the default. |
| `sample.values` | What the gallery card and a fresh form show. Use `sample:<name>` photo ids from `assets/photos/collage/` (they are ingested into the design when the person makes it). |
| `build(values, env)` | Returns `{ name, pages: [sceneDoc] }`. Synchronous and deterministic. `values` are validated and cleaned; empty required text arrives as its placeholder; `default`s are filled in. |

Input types and what `validate` accepts:

| type | Value | Limits |
|---|---|---|
| `text` | string, one line (newlines become spaces) | `max` (default 80) |
| `longtext` | string, newlines kept | `max` (default 600), `maxLines` (default 12) |
| `photo` | asset id `^[\w:.-]{1,80}$` | |
| `photos` | array of asset ids | `max` (default 4) |
| `color` | `#RRGGBB` | |
| `choice` | one of `options` (`'a'` or `{ id, name }`) | |
| `date` | `YYYY-MM-DD`, a real calendar date | `today: true` stores today's date when left empty at make time |
| `number` | number (or numeric string) | `min`, `max`, `step` |
| `list` | array of strings, or with `columns: ['Item','Value']` array of string arrays | `max` rows (default 15), `cellMax` (default 48) |
| `toggle` | boolean | |
| `table` | rows of cells for `columns: [{ key, label, max, aliases, worst }]`; arrays of rows, or the packed form below | `max` rows (default 300); every cell ≤ its column's `max`; all text ≤ 80,000 characters |

Unknown keys, wrong types and over-long values are errors. Script-like text is valid: it is only ever drawn as text on a canvas or set as `.value`/`.textContent`, never as markup.

## The `env` helpers

Geometry: `env.W`, `env.H`, `env.k` (min side / 1080), `env.square`, `env.portrait`, `env.tall` (9:16), `env.style`, `env.size`, `env.today`, `env.type` (a scale: `display h1 h2 h3 body small caption`), `env.random()` (seeded by maker, style, size and values), `env.seed`.

Layers (each returns a plain layer object; push them into `page.layers`, back to front):

| Helper | Notes |
|---|---|
| `env.page(bg)` | `bg` is a colour or a background object (`{ type: 'gradient', kind, angle, colors }`). |
| `env.text(spec)` | Fits text into `{ x, y, w, h }`: shrinks from `size` to `min`, wraps exactly like `LE.Scene`, never breaks a word unless it must, respects `maxLines`, `balance: true` evens the lines (narrows the box), `valign: top|middle|bottom`. Also `font weight italic color align lineHeight tracking (em) uppercase background stroke shadow rotation opacity`. The layer's `h` is the measured height, so `l.y + l.h` is where the next thing goes. Text the font cannot draw (non-Latin scripts) switches to a shipped family whose stack ends in the system font. |
| `env.fit(spec)` | The same measurement without making a layer: `{ size, lines, lineCount, width, textWidth, height, font }`. |
| `env.rect(spec)` | `radius` makes a rounded rectangle. `fill` is a colour or a fill object (`linear`/`radial` with `colors`, `angle`). |
| `env.ellipse`, `env.star`, `env.shape(id, spec)`, `env.line(spec)` | `line`: `{ x, y, w, width, color, dash }`. Shape ids from `LE.assets.shapes()` (`speech-round`, `burst`, `heart`, …). |
| `env.photo(spec)` | Always a replaceable slot (`slot: { id, label }`). With `src` it is cover-cropped (`focus: { x, y }`); without, a labelled empty slot. `mask: 'ellipse'`, `maskPath` (SVG path in layer coordinates), `radius`, `border`, and the look as data: `adjust`, `filter`. |
| `env.svg(spec)` | Inline, sanitised SVG markup (`markup`). Good for decorations that would otherwise be dozens of layers (bars, perforations, star ratings). |
| `env.icon(assetId, spec)` | An icon (`lucide:sun`); the set is loaded automatically. |
| `env.qr(text, spec)` | A QR code as an SVG layer (`color`, `background`, `level`). The encoder loads automatically. |

Colour (`env.color`): `contrast(a, b)`, `readable(bg, [candidates])` (first candidate that reaches 4.5:1, else ink or white), `ensure(fg, bg, ratio)` (same hue pushed until it reads), `tint`, `shade`, `mix`, `over` (translucent over opaque), `rgba(c, a)`, `hsl`, `luminance`, `isDark`, `hex`. Also `env.colorName(hex)` ("Sage", "Rust"), `env.palette(photoId, n)` (on-device extraction via `LE.palette`, dark to light, or `null` without the image), `env.gradient(id)`, `env.colorSet(id)`.

Layout: `env.box`, `env.inset(box, t, r, b, l)`, `env.centre(w, h, box)`, `env.grid(box, n, cols, gap)`, `env.split(box, [weights], gap, vertical)`, `env.place(layers, box, valign)` (moves a stacked block as one; returns its height).

Dates (`env.date`): `parse`, `iso`, `format(date, 'D MMMM YYYY')` (tokens `YYYY YY MMMM MMM MM M DD D dddd ddd`, `[literal]`), `diff(a, b)` → `{ years, months, days, totalMonths, totalWeeks, totalDays, sign }` with month-end clamping (31 Jan + 1 month = 28/29 Feb), `describe(a, b)` → "2 years, 3 months", `addMonths`, `daysIn`, `leap`, `today`.

`env.warn(kind, message, layer)` adds to the build's warnings.

## The pipeline and the public API

```
LE.makers.register(def)
LE.makers.ready()                       → Promise<list>   (loads the maker files)
LE.makers.list() / get(id)
LE.makers.validate(id, values)          → { ok, errors: [{ key, message, required? }], values (cleaned) }
LE.makers.build(id, values, { size, style, images: { assetId: canvas }, today })
                                        → Promise<{ name, pages, warnings }>
LE.makers.check(page)                   → [{ layer, kind: overflow|offpage|contrast|font, message }]
LE.makers.renderPage(page, { images, maxEdge })  → Promise<canvas>
LE.makers.cases(id, photoIds)           → { sample, minimal, worst }   (QA fixtures)
LE.makers.signature(layers), encodeValues(values), decodeValues(id, b64)
```

`build` runs your `build` once, sees which fonts, icon sets or the QR encoder it touched, loads them, and runs it again so measurement uses the real fonts. Keep `build` free of side effects. `images` lets photo layers be cover-cropped and palettes be extracted; the studio passes the photos it holds.

## `doc.maker`

Every page a maker builds carries:

```json
"maker": {
  "v": 1,
  "id": "quote",
  "style": "editorial",
  "size": "square",
  "values": { "quote": "Not all those who wander are lost.", "author": "J. R. R. Tolkien", "photo": "a1b2c3" },
  "sig": "k3x9q1"
}
```

- `values` are the person's values (not placeholders): plain strings, numbers, booleans, and arrays of those (one level of nesting for list rows), at most 40 keys, strings at most 2000 characters, photos as asset ids. Sanitised by `LE.Scene.makerOf` on load, undo/redo and `.leproject` import.
- `sig` fingerprints what the person sees (geometry, text, sources, colours). If the layers no longer match it, Edit details warns that remaking replaces the hand edits. Remaking is one undo step.
- An agent can author a page by writing just `{ "maker": { "id", "style", "size", "values" } }` and building it with `LE.makers.build`.

Deep link: `/studio/?make=<id>` opens the form; `&style=`, `&size=` pick the look; `&v=<base64url JSON>` prefills values and is validated strictly (anything wrong and the form starts from the sample, with a message).

## Quality bar

Every style must look like a good designer made it, at phone size, with short and long inputs, with and without a photo, in every size.

- Text never overflows or collides. Size boxes from the space left, use `env.text` with a sensible `min`, and stack with `l.y + l.h`. Long inputs shrink; they never spill.
- Contrast is at least 4.5:1 against any solid colour behind text (`LE.makers.check` measures it). Over photos use a scrim that is darkest where the words sit.
- Only the 44 shipped families. Pick weights the family has (most have 400 and 700).
- Stories keep about 220 px clear at the top and 280 px at the bottom for app chrome.
- Without a photo, a style either leaves a labelled slot where the photo is the point, or composes without it where it is optional. Never a big grey hole in the middle of a text card.
- No look-alikes of real brands' apps, packaging or logos. Decorative barcodes are not scannable codes.
- Look at it. Run the contact sheet and read the image:

```bash
node <scratch>/mk-sheet.js <makerId>          # sample / minimal / worst per size, every style
node <scratch>/mk-sheet.js <makerId> sample   # bigger tiles
```

(The script used for the first six makers renders `LE.makers.cases()` through `LE.makers.renderPage` and prints every `check()` problem; copy it from the wave 2M report or write the same 60 lines.)

## Print

Print makers (category `Print`) lay out real paper at 300 dpi. Seven exist: `calendar`, `chart`, `labels`, `stickers`, `photobook`, `zine`, `catalogue`.

### Paper sizes and `doc.print`

| id | Paper | Pixels |
|---|---|---|
| `a4` / `a4-landscape` | 210 × 297 mm | 2480 × 3508 |
| `a5` / `a5-landscape` | 148 × 210 mm | 1748 × 2480 |
| `letter` / `letter-landscape` | 8.5 × 11 in | 2550 × 3300 |
| `photo-4x6` | 4 × 6 in | 1200 × 1800 |
| `square-20` | 20 × 20 cm | 2362 × 2362 |

300 dpi is the ceiling on purpose: A4 landscape (3508 px, 8.7 MP) is under the smallest device canvas the studio plans for (4096 px edge on older phones, 16.7 MP on iOS), so print pages always render and export at 1×. A3 at 300 dpi (4961 px) would not, so it is not offered.

A page built at a paper size carries page meta, sanitised by `LE.Scene.printOf` and kept through undo, redo and `.leproject` (wired exactly like `doc.maker`):

```json
"print": { "v": 1, "paper": "a4", "w": 210, "h": 297, "dpi": 300 }
```

`w`/`h` are millimetres. PDF export (Download → PDF, and the Print action next to it) makes each page `w × h` mm in points (A4 = 595.28 × 841.89 pt) with the image at 100%. If the page was resized since, its pixels are mapped at `dpi`; pages without `print` keep the old 96 dpi (0.75 pt a pixel). Mixed designs get mixed page sizes. `LEStudioExport.print.pageSize(doc)` returns the size in points.

### `env.print`

| Helper | Notes |
|---|---|
| `paper`, `dpi` | The size's `print` meta (or null) and its dpi (300). |
| `mm(n)`, `inch(n)`, `pt(n)` | Physical units to pixels. |
| `safe(mm = 10)` | The page inside a margin home printers reach. |
| `sheet(area, { cols, rows, w, h, gx, gy })` | Cells (`{ x, y, w, h, row, col, i }`) tiled N-up with gutters; with `w`/`h` the grid keeps that cell size and is centred. |
| `labels(count)` | A generic label grid for this paper as cells (`LE.makers.labelGrid(paper, count)`): 8 (2×4), 14 (2×7), 21 (3×7), 24 (3×8), 30 (3×10), 65 (5×13), in A4 and Letter dimensions. No brands or product codes. |
| `cutMarks({ cells, marks, lines, outlines, folds, cuts, holes, color, width, len, gap, name })` | Guides as ordinary layers in one group named "Cut marks" (or `name`): crop ticks in the margin at every distinct cell edge (sides without room are skipped), dashed cut lines, dashed outlines (`rect`/`ellipse`), dashed fold lines, a solid cut, punch-hole circles. Put it first in `page.layers` (under the design), or last for marks that must show on top (punch holes). The person hides or deletes the group in Layers; makers offer a toggle. |
| `group(name, layers, id)` | Any layers under a named group layer. Returns members + group (the group goes after its members, as `LE.Scene` stores it). |
| `zine(W, H)`, `placeIn(layers, panel)` | The 8-page mini-zine imposition (front bottom right; 2–5 along the top, turned 180°; 6, 7, back along the bottom) and a mover that draws a panel's layers onto the sheet, turning them when the panel is turned. Also `LE.makers.print.zine`. |
| `theme(id, accent)` | Shared print looks `clean`, `friendly`, `pastel`, `bold`, `ink` (ink saver: no filled areas): `{ bg, ink, muted, line, faint, accent, accent2, accent3, head, headWeight, body, r, hair, inkSaver }`. |

Calendars: `env.date.monthGrid(y, m, weekStart)` (weeks of `{ y, m, d, inMonth, iso }`, 4–6 rows), `weekOf(date, weekStart)`, `addDays`, `weekday` (0 = Sunday), `weekdays(weekStart, 'dddd' | 'ddd' | 'd')`. `weekStart` is 1 for Monday, 0 for Sunday.

`env.photoName(id)` is a photo's file name (the studio passes `names` to `build`), for matching photos to rows.

### Tables

A `table` input holds rows in fixed columns. In `doc.maker.values` it is stored packed: an array of at most 40 strings of at most 2,000 characters, each a run of rows (`cell\tcell` lines joined by `\n`). That fits the existing `doc.maker` limits (40 array entries, 2,000-character strings) without widening them, so 300 rows of ordinary product data (about 20–30 KB) round-trip through undo, projects and links; the hard cap is 300 rows and 80,000 characters. Each page of a multi-page make carries the same values (a 300-row catalogue of ~28 pages stores about 0.8 MB of meta in all).

`LE.makers.table`: `parse(text, delim)` (CSV, TSV and pasted spreadsheet cells; quotes), `match(columns, grid)` (header names and aliases → column indexes; no header → by position), `rows(columns, grid, match, max)` (cells shortened to each column's max, with counts), `pack(rows)`, `unpack(packed, ncols)`. Validation accepts plain row arrays (what an agent writes) and stores the packed form. The form's table field takes pasted cells or a CSV / TSV / Excel file (Excel through `LE.pdfBulk.parseTable`, which lazy-loads the vendored SheetJS) and shows one select per column for the mapping.

### Print quality bar

Everything in the main quality bar, plus: real sizes in mm (`env.print.mm`), body text at least about 2.5 mm, text 4.5:1 on paper, an ink-saving style with no filled areas, and a look at the exported PDF, not only the canvas.
