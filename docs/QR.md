# Styled QR codes (`LE.qr`)

One engine draws every QR code in LocalEditor: the tool page (`/qr-code-generator/`), the studio's QR element, the quick makers, agents and "Make many". A code is described by a **style spec**, which is plain data. Nothing is fetched and nothing leaves the device.

| File | Role |
|---|---|
| `assets/js/le-qr.js` | The engine. No dependencies beyond the vendored encoder (`assets/vendor/qrcode.js`). Loads in a page, in the studio (loader ids `qr`, `qrui`) and in Node (`require`). |
| `assets/js/le-qr-ui.js`, `assets/css/qr.css` | The editor, the exports and "Make many", shared by the tool page and the studio dialog. |
| `assets/vendor/jsqr.js` | The decoder (jsQR 1.4.0, Apache-2.0). Loaded on demand by `check`. |
| `tests/qr.test.js` | Every preset, shape, eye pair and content type is drawn and read back. |

## The API

```js
LE.qr.ready()                       // Promise: the encoder is loaded
LE.qr.matrix(text, { ec })          // { n, version, rows, dark(r, c) }
LE.qr.svg(spec, { caption })        // one SVG string: no script, no links, pictures only as data: images
LE.qr.canvas(spec, px)              // Promise<canvas>, drawn from that SVG (browser)
LE.qr.layers(spec, { x, y, w, id }) // open-format design layers: the code, and a frame split into a plate and a text layer
LE.qr.check(spec)                   // Promise<{ ok, contrast, quiet, logoCover, decoded, version, ec, notes[] }>
LE.qr.inspect(spec)                 // the same report without the test scan (synchronous, works in Node)
LE.qr.applyFix(spec, note.fix.patch)
LE.qr.encode(type, values)          // { text, error }
LE.qr.presets(brand), LE.qr.preset(id), LE.qr.withStyle(text, styleOrPresetId), LE.qr.styleOf(spec)
LE.qr.clean(spec)                   // whitelist: unknown keys dropped, values clamped
LE.qr.fileName(text, 'png')         // "wifi-guest.png", "example-com-menu.png"
```

## The style spec

```json
{
  "text": "https://example.com/menu",
  "ec": "M",
  "shape": "dots",
  "eye": { "outer": "rounded", "inner": "dot", "outerColor": "#C2410C", "innerColor": "#7C2D12" },
  "fg": { "type": "linear", "angle": 45, "stops": [{ "at": 0, "color": "#9F1239" }, { "at": 1, "color": "#C2410C" }] },
  "bg": "#FFF8F1",
  "quiet": 4,
  "radius": 0.06,
  "image": { "src": "data:image/png;base64,…", "size": 0.22, "fit": "contain", "round": 0.2 },
  "picture": { "src": "data:image/jpeg;base64,…", "dim": 0.6 },
  "frame": { "style": "label", "text": "Scan me", "color": "#9F1239" }
}
```

| Key | Values | Notes |
|---|---|---|
| `text` | up to 1,200 characters | What the code holds. |
| `ec` | `L` `M` `Q` `H` | Error correction. A centre picture always uses `H`; a background picture at least `Q`. |
| `shape` | `square` `rounded` `dots` `diamond` `vbars` `hbars` `connected` | The data modules. `connected` rounds only the corners that have no neighbour. |
| `eye.outer` / `eye.inner` | outer: `square` `rounded` `circle` `leaf`; inner: `square` `rounded` `dot` `leaf` | The three corner finders. `outerColor` and `innerColor` are optional. |
| `fg` | a hex colour, or a gradient `{ type: "linear" \| "radial", angle, stops }` with 2 or 3 stops | Stops may be plain colours (`["#0E7490", "#1D4ED8"]`); they are spread evenly. |
| `bg` | a hex colour, or `null` | `null` is a see-through background. |
| `quiet` | 0 to 8 (default 4) | The empty margin, in modules. |
| `radius` | 0 to 0.25 | Corner radius of the tile, as a share of its width. |
| `image` | `src` (a `data:` image up to 120,000 characters), `size` 0.1 to 0.3, `fit`, `round` 0 to 0.5, `plate` | A logo or photo in the middle. The modules behind it are cleared for a padded rounded plate. |
| `picture` | `src`, `dim` 0.35 to 0.9 | A picture behind the code. It is washed with the background colour, dark modules become dots, light modules small light dots, and the finders sit on light plates. Off unless given. |
| `frame` | `style`: `label` `tab` `badge` `ticket`; `text` up to 32 characters; `color`, `ink` | A call to action around the code. |

A spec with only `text`, `fg` (one colour), `bg` and `ec` is the studio's old plain code and is drawn exactly as before (`shape-rendering="crispEdges"`, a 4-module margin). Any other key switches to the styled renderer.

**Eye pairs.** Scanners find a code by the 1:1:3:1:1 rhythm of its corners along rows, columns and diagonals, so a centre only reads reliably inside a frame of similar roundness. `LE.qr.EYES.pairs` lists what goes with what: `square` → `square`, `rounded`; `rounded` → `rounded`, `dot`, `leaf`; `circle` → `dot`; `leaf` → `leaf`, `rounded`. The editor offers only these. Any other pair can still be drawn, but the test scan usually fails it and offers "Match the corner centres". Alignment squares are always drawn solid.

## Content types

`LE.qr.encode(type, values)`; `LE.qr.TYPES` describes the form fields.

| Type | Values | String |
|---|---|---|
| `link` | `url` | the link; `https://` is added when no scheme is given |
| `text` | `text` | as typed |
| `wifi` | `ssid`, `password`, `security` (`WPA` `WEP` `nopass`), `hidden` | `WIFI:T:WPA;S:…;P:…;;` (the same string as `LE.makers.wifiPayload`) |
| `contact` | `first`, `last`, `org`, `title`, `phone`, `email`, `url`, `address`, `note` | vCard 3.0, lines joined with `\n` |
| `email` | `to`, `subject`, `body` | `mailto:…?subject=…&body=…` |
| `phone` | `phone` | `tel:…` |
| `sms` | `phone`, `message` | `SMSTO:number:message` |
| `chat` | `link` | an `https://` link the person pastes from their chat app, unchanged |
| `location` | `lat`, `lng`, `label` | `geo:lat,lng?q=label` |
| `event` | `title`, `start`, `end`, `allDay`, `location`, `notes` | an iCalendar `VEVENT` in a `VCALENDAR`, local time |
| `pay` | `upiId`, `payee`, `amount`, `note` | `upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…` (the same string as `LE.makers.payPayload`) |

Limits: 1,200 characters. Longer content is refused with its length. A code above version 10 (57 modules across) gets the note "This code is getting dense"; above version 20 it is a warning.

## The scannability guard

`check(spec)` runs on every change in the editor. A note is `{ level: "fail" | "warn" | "info", code, text, fix: { label, patch } }`; `ok` is false when any note fails.

| Check | Rule | Fix offered |
|---|---|---|
| Contrast | WCAG ratio of every dot and eye colour against the background. Under 2.5 fails, under 4 warns. | Make the dots darker |
| Inverted | Light dots on a dark background warn. | Swap the colours |
| Quiet zone | Under 2 modules warns; 2 or 3 is a note. | Add the margin back |
| Picture cover | The plate may hide up to 12% of the data area, and `size` up to 0.3. | Make the picture smaller |
| Density | See the limits above. | none |
| Test scan | The code is drawn at two sizes (about 4 and 9 pixels per module) and read back with the vendored decoder. Both must return the exact text. | Match the corner centres, Dim the picture more, Make the picture smaller or Use square dots |

The tool page and the studio dialog do not download, copy, hand over or place a failing code until the person chooses "Download anyway" ("Add anyway" in the studio).

## In the studio

A QR element is an `svg` layer with `assetId: "qr:code"`; its spec lives in `meta.studio.qr[layerId]` and round-trips through `.leproject` and `.ledesign.json`. "Edit QR" opens the same editor as the tool page. Pictures are embedded in the layer's SVG as `data:` images, so one layer is limited to 200 KB (the editor shrinks uploads to fit).

- **Open in the editor** (tool page) builds the studio's own template link (`/studio/#d=…`) with one layer that has `qr` and no `svg`. Links hold 30,000 characters, so a picture inside the code is made smaller until it fits, or left out and said so.
- **Copy** writes a PNG and an HTML fragment whose `<img>` carries the layer in `data-le-design`. Pasting in the studio makes the editable element; pasting anywhere else gives the picture.
- **Make many** reads a list with `LE.variables.parseCSV` / `parseFile` (CSV, TSV, Excel with a sheet picker; cells are text, formulas are never run), maps columns to the content type's fields, an optional label column and an optional file-name column, and writes a zip of PNG or SVG files (`LE.variables.ZipWriter`) or a PDF sheet on A4 or Letter with cut marks (`LE.variables.PdfWriter`). Rows that are empty or too long are listed with "Fix here" and left out. Each code is test-scanned as it is made; one that fails is left out too, and the zip then carries a `left-out.csv`. Row caps are `LE.variables.rowCap()`.

## For agents

There is no separate QR operation. Add an `svg` layer with `qr` settings and no `svg`; the studio draws it and keeps the settings for "Edit QR". Problems come back as warnings named `qr-contrast`, `qr-logo`, `qr-dense` and so on.

```json
{ "op": "add", "layer": { "id": "menu-qr", "type": "svg", "x": 340, "y": 300, "w": 400,
  "qr": { "text": "https://example.com/menu", "shape": "dots", "bg": "#FFF8F1",
          "fg": { "type": "linear", "angle": 45, "stops": ["#9F1239", "#C2410C"] },
          "eye": { "outer": "rounded", "inner": "dot" }, "radius": 0.06,
          "frame": { "style": "label", "text": "Menu" } } } }
```

The same layer in a design file (`.ledesign.json`):

```json
{ "format": "localeditor-design", "version": 1, "name": "Wi-Fi card",
  "pages": [{ "width": 1080, "height": 1350, "background": "#F3F8F1", "layers": [
    { "id": "title", "type": "text", "text": "Guest Wi-Fi", "font": "Plus Jakarta Sans", "size": 96, "color": "#14532D", "align": "center", "x": "center", "y": 140, "w": "86%" },
    { "id": "wifi-qr", "type": "svg", "x": 240, "y": 380, "w": 600,
      "qr": { "text": "WIFI:T:WPA;S:Corner Cafe Guests;P:flatwhite2026;;", "shape": "connected", "fg": "#14532D", "bg": "#FFFFFF",
              "eye": { "outer": "rounded", "inner": "rounded" }, "radius": 0.08, "frame": { "style": "ticket", "text": "Scan to join" } } }
  ] }] }
```

Leave `h` out: it follows from the code's proportions (a frame makes it taller than wide). Makers that draw a code (`wifisign`, `payposter`, `qrinvite`) take a look for it: `{ "op": "make", "maker": "wifisign", "values": { … }, "qrStyle": "ocean" }`, where `qrStyle` is a preset id or a style spec. In maker code, `env.qr(text, { …, style })` does the same for one code.

## Known limits

- A QR element filled from a field (`bind.content`, `docs/VARIABLES.md`) is still redrawn as a plain code in the template's two colours.
- A maker's `qrStyle` applies when the page is built; it is not stored in `doc.maker`, so "Edit details" rebuilds with plain codes.
- PDF pages are JPEG images on white paper, so a see-through background prints as white.
- Frame words are SVG text in the system font; in the studio, use `LE.qr.layers` or type a text layer when a brand font matters.
