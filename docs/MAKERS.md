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
| `name`, `category`, `summary`, `keywords` | Gallery card, category chips and search. Categories in use: Social, Business, Life, Photo. |
| `sizes` | `[{ id, name, w, h }]` or ids from `LE.makers.SIZES` (`square` 1080×1080, `portrait` 1080×1350, `story` 1080×1920). First is the default. |
| `inputs` | `{ key, label, type, required, max, placeholder, options, default, hint }`. See types below. |
| `styles` | `[{ id, name }]`, 4–6 genuinely different looks. First is the default. |
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

`env.warn(kind, message, layer)` adds to the build's warnings. A warning of kind `input` with `layer` set to an input key shows as a note under that field in the form (the invitation uses it for "this link is long", the Wi-Fi sign for a password of the wrong length).

`env.page(bg, { w, h })` gives a page its own size. Without the second argument a page takes the chosen size.

### Multi-page makers

`build` may return up to 8 pages (the event kit returns an invitation, a story, a banner and name-tag sheets). The first page must have the chosen size (the tests check it); the others may use `env.page(bg, { w, h })`. In the studio:

- Making inserts every page after the current one; the first is shown.
- The pages share one `doc.maker`. Edit details on any of them remakes the whole run (neighbouring pages with the same id, style, size and values), even when the page count changes.
- Studio history is per page, so the current page is replaced through history and the rest of the run in the project; one undo (or redo) on that page swaps the whole run back. Switching page ends that link, like any page history.
- The form preview shows all pages side by side.

### QR codes

Use `env.qr(text, { quiet: 4, color: '#111111', background: '#FFFFFF', level: 'M' })`: dark on light only, the standard four-module quiet zone, and put it on a white tile when the page is dark. Keep it at least about a quarter of the page width so it scans from a phone screen and from print. Build the payload in a pure function the maker exposes (`LE.makers.payPayload`, `LE.makers.wifiPayload`) so tests can assert it exactly; `tests/makers.test.js` also reads every code back from the rendered page with a decoder vendored for tests (`tests/lib/jsQR.js`). Never fetch anything for a code and never invent its contents: without the person's ID or link, draw an empty, labelled code box.

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
