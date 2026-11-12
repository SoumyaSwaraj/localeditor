# typefoundry: the LocalEditor originals generator

Build-time only. Nothing in this folder is loaded by the site; it produces the font files in
`assets/fonts/originals/`, the manifest `assets/data/fonts-originals.json`, the compact list inside
`assets/js/le-fonts-originals.js` and the family cards on `/fonts/`.

Research and design brief: `docs/research/typeface-psychology.md`.

## Run

```bash
python3 -m venv /tmp/tfvenv && /tmp/tfvenv/bin/pip install -r tools/typefoundry/requirements.txt
/tmp/tfvenv/bin/python tools/typefoundry/build_all.py            # all twenty, Regular + Bold (about 4 min, 3 processes)
/tmp/tfvenv/bin/python tools/typefoundry/build_all.py --only sunbun,frostgrid --no-manifest
/tmp/tfvenv/bin/python tools/typefoundry/sheets.py /tmp/sheets    # review sheets (HTML)
node tools/typefoundry/shoot.js /tmp/sheets/all-20.html /tmp/all-20.png 1500   # render with Chromium
node tests/run.js fonts-originals
```

Keep the venv outside the repository. TTF masters go to a temp folder (`--ttf-dir`), not the repo.

## Dependencies (pinned in `requirements.txt`)

| Package | Licence | Used for |
|---|---|---|
| fontTools 4.55.3 | MIT | FontBuilder, TrueType outlines, cu2qu, feature compiler (kerning), WOFF/WOFF2 |
| brotli 1.1.0 | MIT | WOFF2 compression |
| pyclipper 1.3.0.post6 | MIT (Clipper: BSL-1.0) | Polygon union, cuts and offsets (overlap removal) |
| numpy 2.5.4 | BSD-3-Clause | Geometry and curve fitting |
| pillow 13.0.0 | MIT-CMU (HPND) | Quick raster previews while developing |
| opentype-sanitizer 9.2.0 | BSD-3-Clause | OTS, the same checker Chrome and Firefox run on web fonts |

`shoot.js` uses the Playwright + Chromium already installed for the test suite.

## How it works

1. **Skeletons.** `tf/glyphs_basic.py` (A–Z, a–z, 0–9) and `tf/glyphs_more.py` (punctuation, symbols, currency,
   special letters, accents) describe each letter as centre-line strokes: nodes with a tangent (`'h'`, `'v'`, an
   angle, or a corner), a width multiplier and optional curve tension. All positions are derived from the style
   (x-height, cap height, width, weight), so one skeleton serves every family. Variants (single/double-storey a
   and g, straight or curved y, tailed l, spur G, slashed zero…) are switches in the style.
2. **Pen.** `tf/style.py` holds the parameters. Each stroke is expanded with a direction-dependent pen: width =
   hairline + (stem − hairline) × |sin(direction − stress)|, so contrast and its angle come from two numbers.
   Strokes can be marked thin (the up-strokes of A, V, M, N…), and reverse contrast is just a ratio above 1.
3. **Ends and joins.** Stroke ends are flat, round, cut at an angle (the cut is trimmed locally, so it never eats
   nearby strokes), ball, or tapered. Corners get mitre or round joins; apexes are filled by a vertex helper and
   clipped flat, pointed or overshooting.
4. **Serifs, traps, finish.** Slab, bracketed, wedge and hairline serifs, top-left flags and beak serifs are
   polygons added per stem. Ink traps are notches subtracted at joins. Optional seeded jitter moves nodes,
   tangents and widths and tilts/bounces whole letters; corner rounding is a morphological open/close.
5. **Clean outlines.** Everything is unioned with Clipper (overlaps removed, holes oriented), then fitted back to
   cubic Béziers (Schneider fitting) with nodes forced at extrema and corners, split at any remaining extrema,
   rounded to integers, converted to quadratics (cu2qu) with TrueType winding.
6. **Spacing.** `tf/spacing.py`: sidebearings from the white area between each side profile and the sidebearing
   line inside a reference zone, limited to a fixed depth (the HT Letterspacer idea). Straight, round and open
   sides get the same optical space; hooks outside the zone (j, f, y) may overhang. Figures are tabular.
7. **Kerning.** For each pair of base letters and punctuation, kern = −(smallest row gap of the pair − the two
   sides' own smallest white) × strength, so AV, To, LT, r. and friends close up while HH and oo stay put; a
   collision guard pushes apart anything that would touch. Accented letters share their base letter's class.
   Compiled as class-based `kern` (GPOS) with fontTools' feature compiler.
8. **Composites.** Accented letters are built from `unicodedata` decompositions as TrueType components with
   per-glyph anchors (dotless i/j, cap accents, comma-below for Latvian/Romanian, the apostrophe caron on ď ľ ť).
   Superiors, fractions, ¡ ¿ ‘ “ are scaled or rotated components.
9. **Tables.** Shared vertical metrics for all twenty (UPM 1000, ascender 950, descender −250, line gap 0,
   USE_TYPO_METRICS, win 1050/350), so swapping families never moves the line box. `name`, `OS/2`, `post`, `cmap`
   are set by FontBuilder; every TTF and WOFF2 passes OTS.

## Outputs

`assets/fonts/originals/<slug>/<slug>-400.woff2`, `-700.woff2` (browser), `-400.woff`, `-700.woff` (PDF
embedding through pdf-lib/fontkit, matching how the library fonts provide `.woff` for `LE.fonts.bytes`),
`LICENSE`, `family.json`. The parameter set for each family lives in `families.py`.
