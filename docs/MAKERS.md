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
| `name`, `category`, `summary`, `keywords` | Gallery card, category chips and search. Categories in use: Social, Business, Life, Photo, Print, Events. Keywords are generic words, not brand names. |
| `sizes` | `[{ id, name, w, h, print }]` or ids from `LE.makers.SIZES` (`square` 1080×1080, `portrait` 1080×1350, `story` 1080×1920) or paper ids from `LE.makers.PAPER` (see Print below). First is the default. At most five, with short names: the size buttons share one row at 360 px. |
| `maxPages` | Most pages one build may return (default 8, at most 50, the project's page limit). Multi-page makes land as consecutive pages; Edit details on any of them remakes the whole run (see Multi-page makers). |
| `inputs` | `{ key, label, type, required, max, placeholder, options, default, hint }`. See types below. |
| `styles` | `[{ id, name }]`, 4–6 genuinely different looks (up to 8 when the formats truly differ, as on business cards). First is the default. |
| `sample.values` | What the gallery card and a fresh form show. Use `sample:<name>` photo ids from `assets/photos/collage/` (they are ingested into the design when the person makes it). |
| `build(values, env)` | Returns `{ name, pages: [sceneDoc] }`. Synchronous and deterministic. `values` are validated and cleaned; empty required text arrives as its placeholder; `default`s are filled in. |

Input types and what `validate` accepts:

| type | Value | Limits |
|---|---|---|
| `text` | string, one line (newlines become spaces) | `max` (default 80); optional `pattern` (a RegExp source string the whole value must match), `patternHint` (the error shown when it does not) and `worst` (a valid longest example that `cases()` uses instead of filler text) |
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

### Form extras (`ui`)

A definition may add `ui(form, api)`: studio-only extras for the form (a camera, paste and drop, sorting by capture date). It is called once when the form opens, after the fields are drawn, and may return a cleanup function, which runs when the form closes for any reason (Cancel, ×, Escape, the backdrop, or Make). `form` is the open form (`values`, `style`, `size`, `node`, `form`, `c` the studio). `api.refresh()` redraws the fields from `form.values` and the preview; `api.schedule()` redraws only the preview; `api.make()` makes the design (resolves to the first page, or null). Put your own elements before `form.form` (inside `.mk-body`) so `refresh()` keeps them. `build` never sees any of this: whatever `ui` decides must end up in `values`, so it is in `doc.maker` and an agent can write it.

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

`env.warn(kind, message, layer)` adds to the build's warnings. A warning of kind `input` with `layer` set to an input key shows as a note under that field in the form (the invitation uses it for "this link is long", the Wi-Fi sign for a password of the wrong length).

`env.page(bg, own)` gives a page its own size: `{ w, h }` in px, optionally with `print` (`{ paper, w, h, dpi }`, mm), or `{ paper: 'a4' }` for a size from `LE.makers.PAPER` (300 dpi px and a real `doc.print`). Without it a page takes the chosen size, and `doc.print` when the chosen size is a paper size. For cut marks on such a page pass `page: { w, h }` to `env.print.cutMarks`.

### Multi-page makers

`build` may return up to `maxPages` pages (the event kit returns an invitation, a story, a banner and name-tag sheets; a catalogue up to 50). The first page must have the chosen size (the tests check it); the others may use `env.page(bg, own)`. In the studio (one mechanism for every maker, `place` in `le-studio-makers.js`):

- A new make goes on the current page when it is empty, else on new pages after the run the current page belongs to. The first page is shown.
- The pages share one `doc.maker`. Edit details on any of them remakes the whole run (neighbouring pages with the same id, style, size and values, so hand edits elsewhere and page moves around it do not break it), growing or shrinking it to fit. The page being looked at stays in view.
- Studio history is per page, so the page in view is replaced through history and the rest of the run in the project; one undo (or redo) on that page swaps the whole run back. Switching page ends that link, like any page history.
- The form preview shows the pages side by side with an "N pages" note; past 6 pages only the first 6 are drawn.

### QR codes

Use `env.qr(text, { quiet: 4, color: '#111111', background: '#FFFFFF', level: 'M' })`: dark on light only, the standard four-module quiet zone, and put it on a white tile when the page is dark. Keep it at least about a quarter of the page width so it scans from a phone screen and from print. Build the payload in a pure function the maker exposes (`LE.makers.payPayload`, `LE.makers.wifiPayload`) so tests can assert it exactly; `tests/makers.test.js` also reads every code back from the rendered page with a decoder vendored for tests (`tests/lib/jsqr.js`, shared with the PDF office tests). Never fetch anything for a code and never invent its contents: without the person's ID or link, draw an empty, labelled code box.

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

## Weekly-use set: screenshots, photobooth, recaps

| Maker | id | What it makes | Studio extras (`ui`) |
|---|---|---|---|
| Screenshot beautifier (2.8) | `beautify` | A screenshot in a generic browser window, desktop window, phone or tablet (or no frame), or code in a plain window, on a gradient, soft glow, plain, dot-grid or "match the screenshot" backdrop. Sizes square, 4:5, 16:9, story. | Paste an image or code anywhere in the form (Ctrl+V), drop a file; **Hide something** makes the design and opens the Redact panel on the screenshot. CSS: `assets/css/makers-beautify.css`. |
| Photobooth strip (2.10) | `photobooth` | A strip of 4 or 3 frames (2 × 6 in), a 2 × 2 print (4 × 6 in) or a wide strip (6 × 2 in), styles classic white, black, pastel, film edge; caption and date line; one look on every frame (`filter` from `LE.presets.filters`); mirror. **Print sheet** adds a 4 × 6 in page (6 × 4 in for wide) with two copies and a cut line. | **Use the camera**: front camera, mirrored preview, 3-2-1 countdown, flash, tap a frame to retake it, saved the right way round unless "Save mirrored" is ticked, frames ingested like any photo. The stream stops when the panel closes, the page is hidden or the maker closes. Without a camera or permission, the note says so and the photo picker works as usual. CSS: `assets/css/makers-photobooth.css`. |
| Recap collage (2.10) | `recap` | My week / month / year / trip from 4–30 photos: title, date range, a stats line the person types. Styles: clean grid and big title (layouts from `LE.collage.layouts`, chosen for least cropping; fitted rows above 20 photos), fitted rows (justified, uncropped), prints, contact sheet. Square, 4:5, story. | Photos are put in the order they were taken (`order: 'taken'`; capture date read on the device with `LE.privacy.inspect`, falling back to `LE.exif`) and an empty date range is filled from them. The order lives in `values.photos`. |

Code in `beautify` is drawn as one text layer per colour (grouped as "Code"), all on the same grid in JetBrains Mono, each row starting with a zero-width space so indentation survives text wrapping. The highlighter is `LE.makers.highlight(code, lang)` → `{ lang, lines: [[{ t, c }]] }` with classes `plain punct comment keyword string number func type`; languages: JS, TS, Python, HTML/XML, CSS, JSON, shell, SQL, Go, Rust, C/C++, Java/Kotlin, Swift, PHP, Ruby, plain, and detection. Other pure helpers for tests and agents: `LE.makers.recapRange(from, to, period)`, `LE.makers.photoboothFrames(sizeId)`.

Not expressible as a maker today: an "original" aspect for the beautifier (a page always takes the chosen size id's fixed pixels), so the four fixed sizes are offered and the person can use Resize afterwards.

## Print and identity set: cards, certificates, badges, stationery

| Maker | id | Pages | Sizes | Fields for Create many |
|---|---|---|---|---|
| Certificate | `certificate` | 1 | A4 and US Letter, wide and tall, 1600 × 1131 screen | `name`, `reason`, `awarded` |
| Business card | `businesscard` | front, back, + 2 print sheets | 85 × 55, 3.5 × 2 in, 90 × 54, 65 × 65, 55 × 85 mm, each with 3 mm bleed (0.125 in on the US size) | `name`, `role`, `phone`, `email`; `qr` on the back (and on the Large QR front) |
| ID badge | `idbadge` | front, optional back, + sheets | 85.6 × 54 mm tall or wide, A6, 4 × 3 in | `name`, `role`, `id` (text and QR), `photo` |
| Letterhead | `letterhead` | letter, optional slip and envelope front | A4, US Letter | `name`, `address` (letter and envelope) |
| Gift voucher | `voucher` | 1 + sheet | DL, A6, 1600 × 900 | `to`, `from`, `value`, `code` (text and QR) |
| Event ticket | `ticket` | 1 + sheet | 140 × 55 mm, 5.5 × 2 in, 180 × 70 mm | `no` (text and QR), `seat` |
| Loyalty card | `loyaltycard` | front, back, + 2 sheets | 85 × 55 mm, 3.5 × 2 in, with bleed | `name`, `no` (on the back) |

A menu maker was not added: `catalogue` already lays out a menu (sections, items, descriptions and prices from pasted
rows or a table, five styles, A4, Letter and A5).

They share `assets/js/makers/printkit.js` (`LE.makers.kit`), which is listed in `FILES` but registers nothing. Maker files
load in any order, so a maker that needs the kit registers through it:

```js
function go(K) { M.register({ … }); }
if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
```

| Kit helper | Notes |
|---|---|
| `size(id, name, wMm, hMm, bleedMm)`, `paper(id, name)` | A physical size at 300 dpi with its `doc.print` (bleed added on every side), and a paper size under a shorter button name. |
| `stack(env, box, items, o)` | Text specs and blocks top to bottom, scaled down together until they fit `box` (trial passes only measure, so layer ids are stable). An item with `field: 'key'` becomes a template field; `fallback: true` keeps its words as the token's default. When even the smallest scale is too tall, the longest text's `input` gets a note in the form. |
| `column(env, box, align, { top, mid, bottom }, vals, gap)` | Up to three stacks in one box: top, bottom, and the middle in what is left. |
| `field(layer, key, vals, o)`, `bind(layer, key, fit)` | A fitted text layer becomes `{{key}}` (`overflow: 'shrink'`, `minSize`), its text the page value; a QR layer or photo slot follows a field. Put `vals` in `page.values`. |
| `trimMarks(env, bleedPx, { color, guides, safe })` | Crop ticks in the four corners of the bleed (group "Crop marks"), and with `guides` dashed trim and safe-area outlines (group "Trim and safe guides"). |
| `grid(paper, w, h, gap, margin)` (pure), `sheet`, `sheets(env, o)`, `copy` | Pieces n-up on A4 or Letter, upright or turned, whichever holds more; `back` is where each piece lands when the sheet is turned over (`flip`: `long` for a tall sheet, `short` for a wide one). `sheets` returns one sheet page per side, with cut marks outside the bleed and a note in the margin that names the flip edge. |
| `qrTile`, `vcard` (`LE.makers.vcardPayload`), `link`, `logo`, `seal`, `initials` | A code on a white tile; a vCard 3.0 payload; a typed address as a link; a logo slot that takes the picture's shape; a rosette seal as one SVG layer. |
| `many(id, rows, fill, page)` | The maker's `ui`: adds **Make one for each row of a list** beside Make it. It makes the design, moves to the page that carries the fields (`page`), opens Create many (`?tool=bulk`) with `rows` (the example list, first row the column names) loaded and its columns matched. `fill` names form inputs that are only fields when filled in; left empty they take the first example row. The lists are `LE.makers.lists[id]`, published as `assets/samples/<id>-list.csv` for the quick pages (`tests/makers-print.test.js` checks they are the same). |

Rules this set adds:

- **Fields.** Only the parts that change per person are fields. Keys are plain words a column would be called. Avoid keys that
  `LE.variables` reads as another type: anything starting with `is`, `has` or `show` is a yes / no field, `date` a date,
  `price` a number. `LE.makers.check` measures a field as it is drawn (its page value, else its default).
- **Bleed.** A card page is the trim size plus the bleed, so the PDF is print-ready as it is; text keeps 5 mm from the trim.
- **Into the editor.** Make it places the pages in the editor (after the current run when a design is open, never over it),
  and the toast offers Edit details. There is no "start a new design instead" choice in the form.
- **Exports** come from the Download panel, which reads `doc.print`: PNG / JPG / WebP, PDF at the physical size (this page or
  all pages) and Print. Print sheets are ordinary pages of the make. Create many adds a zip of images, one PDF, print sheets
  with cut marks or pages in the design, one per row.
