# Font library

Roadmap item F1. 257 families: 253 in the repository plus 4 Chinese, Japanese and Korean families fetched at deploy time. Every one is OFL-1.1 or Apache-2.0, self-hosted, loaded only when used.

## Files

| Path | What |
|---|---|
| `scripts/fonts/families.js` | The list, by hand: family, style, kind, feel (1–3), flags (`i` italics, `s` script first, `cjk`). |
| `scripts/fonts/lock.json` | Pinned npm package, version, tarball URL and SHA-512 per family. |
| `scripts/fonts/popularity.json` | npm monthly downloads (rank). Code fonts count a fifth. |
| `scripts/fonts/pairings.js` | "Goes well with" pairs. |
| `scripts/fonts/built.json` | What the last build produced (faces, subsets, ranges, sizes); the manifest is written from it. |
| `scripts/fonts/previews.py` | Name-only preview subsets (fontTools). |
| `assets/fonts/library/<slug>/` | `<slug>-<subset>-<face>.<rev>.woff2` + `LICENSE.txt`. Face: `v`/`vi` (variable weight axis, upright/italic) or `400`, `700`, `400i`, `700i`. `rev` = hash of the family's bytes (files are served immutable). |
| `assets/fonts/cjk/` | Git-ignored. Noto Sans SC, TC, JP, KR (about 17 MB, 100–125 slices each) and `available.json`. |
| `assets/fonts/previews/` | `pack-<n>.<hash>.bin`: 16 preview fonts per pack in rank order (about 2 KB per family, 530 KB in all). |
| `assets/fonts/originals/<slug>/` | LocalEditor's own typefaces (F2), see below. |
| `assets/data/fonts-index.json` | The slim index (113 KB, 19 KB gzipped): style, kind, feel, scripts, subsets, faces, weights, rank, bytes, rev, licence, preview location, shared unicode ranges, pairs. |
| `assets/data/fonts-details.json` | Copyright, package, per-file sizes. Info view only. |
| `assets/data/fonts-cjk.json` | Slice table of the CJK families (first CJK use only). |
| `assets/js/le-fonts.js` | `LE.fonts`. Carries only the names (about 7 KB) so `list()` and `css()` answer at once. |
| `assets/js/le-fonts-sfnt.js`, `assets/vendor/woff2-decompress.js` | The PDF path (below). Loaded on first PDF embed. |
| `assets/js/le-studio-fonts.js`, `assets/css/studio-fonts.css` | The studio picker and upkeep hooks. |
| `assets/vendor/licenses/fonts-LICENSES.md` | Generated licence table. |

## Building

```bash
node scripts/fetch-fonts.js                 # library + manifest (needs the npm registry)
LE_PYTHON=/path/to/venv/bin/python node scripts/fetch-fonts.js --previews   # venv with: pip install fonttools brotli
node scripts/fetch-fonts.js --cjk           # CJK into assets/fonts/cjk (scripts/deploy.sh runs this when missing)
node scripts/fetch-fonts.js --index         # manifest only, from files on disk
node scripts/fetch-fonts.js --lock          # re-resolve newest versions (then rebuild)
node scripts/fetch-fonts.js --popularity    # refresh ranks
```

Packages come from npm: `@fontsource-variable/<id>` when it has a weight axis, else `@fontsource/<id>` (400 and 700, italics for `i` rows). Tarballs are checked against the lock's SHA-512. Only these subsets ship: latin, latin-ext, vietnamese, cyrillic, greek, devanagari, bengali, tamil, telugu, gujarati, gurmukhi, kannada, malayalam, arabic, hebrew, thai (cyrillic-ext, greek-ext, math and symbols are left out).

### Licence rules (enforced by the script)

A family is built only when the package's `metadata.json` licence, its `package.json` licence and the text of its `LICENSE` file agree and are OFL-1.1, Apache-2.0, MIT, BSD or ISC. Ubuntu Font Licence text is rejected. Only Google Fonts families via Fontsource are used: no Fontshare/ITF, no "free for personal use" foundries. Font files are copied byte for byte. `LICENSE.txt` in each folder = the copyright line + the package's full licence text. Preview subsets are modified fonts, so they are renamed inside (`LE Preview <n>`) and registered under internal names (`LEP <slug>`), never under a Reserved Font Name.

Left out on purpose: Ubuntu and Ubuntu Mono (Ubuntu Font Licence), Fontshare families (Satoshi, General Sans, Clash Display: ITF licence), Montserrat Alternates and other close duplicates (budget), Material icon fonts (not text), Noto Color Emoji (size), extra CJK families (one per language).

### Adding a family

1. Add a row to `scripts/fonts/families.js` (exact Google Fonts name; style; kind; one to three feel ids from `trust calm friendly playful elegant bold urgent tense nostalgic technical`).
2. `node scripts/fetch-fonts.js --only "Family Name"` (resolves and pins it, builds it, rewrites the manifest).
3. `--previews`, then `node tests/run.js fonts`.

### LocalEditor originals

The twenty originals (F2) are registered at load time by `assets/js/le-fonts-originals.js` through `LE.fonts.register(list, { collection, source })`. Registering fetches nothing: the families join `list()` and `css()` at once and the index when it first loads. Files stay in `assets/fonts/originals/<slug>/` (woff2 for the browser; `LE.fonts.bytes` decodes the woff2 like any library face, so PDFs go through the same `fontFileForPdf` step). The picker's "LocalEditor originals" view shows their one-line descriptions and an intent filter (attention, trust, positive feeling, tension); names are drawn with the real regular face (16–28 KB each) rather than preview subsets. `LE.fontsOriginals` stays for the `/fonts/` specimen page. Sizes for "Save for offline" are an estimate (18 KB per face) because the shim's compact list has no byte counts.

The older, folder-scanning route below (meta.json) still works for families added by hand:

Put `assets/fonts/originals/<slug>/meta.json` (`{ "family", "style", "kind", "feel": [...], "wght": [min, max]?, "license", "copyright", "version" }`), `LICENSE.txt`, and `<slug>-wght.woff2` / `<slug>-wght-italic.woff2` or `<slug>-400.woff2`, `<slug>-700.woff2`, `<slug>-400-italic.woff2`, then `node scripts/fetch-fonts.js --index` and `--previews`. They get `source: "localeditor"`, collection `originals`, and the picker's "LocalEditor originals" view (hidden when there are none).

## Budget

Before: 9.4 MB for 44 families (woff2 latin/latin-ext + one WOFF per face). Now: 31.5 MB of woff2 for 253 families (125 KB average; 123 are variable, so one file covers every weight; the 10 with an optical-size axis keep it, as Google Fonts serves them), 1.2 MB of licence texts, 0.5 MB of previews, about 0.5 MB of manifest data; the 44 old WOFF files (5.9 MB) are removed. The repository stays under 300 MB; the largest single font file is 0.2 MB. The CJK families add 17.3 MB and are not in git (`--cjk`). Each person downloads only what they use: a typical Latin font is 50–120 KB.

## Loading

- Nothing on first load: `le-fonts.js` holds names only. The index loads the first time a font or the picker is used.
- `load(family, { weights, italic, scripts, text })` fetches only the slices whose `unicode-range` the text touches. The old form `load(family, weight, italic)` loads latin + latin-ext (and the family's own script for script families).
- Missing letters: the studio hook calls `prepare(family, text)` for every text layer; letters of a script the family lacks are drawn by a library family for that script (Noto Sans/Serif + script, Noto Sans JP/KR/SC/TC), `css(family)` lists it after the family, and the person is told once.

## Storage

Two caches, both in the storage manager's Fonts category, per family with size and remove:

- `le-fonts-v1`: fonts fetched when used (the service worker stores them; least recently used are trimmed past 120 MB, and "Free up space" may remove them). They download again when needed.
- `le-fonts-saved-v1`: never trimmed automatically. Filled by **Save for offline** (per font from the selected text's card, per collection or everything in "Saved on this device"), and automatically with the slices used by the open design (download policy, `docs/DOWNLOADS.md`: default mode keeps them without asking; "Always ask first" asks once through `LE.downloads`). So a saved design always opens with its fonts offline.

PDF text faces: Plus Jakarta Sans, Lora, JetBrains Mono and Manrope (about 575 KB) are saved quietly once per device, when the Basic editor or Everything pack finishes or at the first idle moment in automatic mode (`LE.fonts.keepPdfFaces()`), so Convert to PDF, the invoice maker and the bulk tools set real text offline after a first visit.

`LE.fonts.sizeOf('all')` answers synchronously with a number generated into `le-fonts.js` (the download manager lists packs with it); other targets give a number once the index is loaded, else a Promise. `saveOffline(target, onProgress, { track: true })` shows the shared download chip (the picker passes it; LE.downloads' own packs track themselves).

Collections and "everything" go through `LE.downloads.request(...)` (fallback without it: no question up to 60 MB). Picking a font never asks. `saveOffline` reports total bytes in its first progress call, uses `LE.downloads.track` when present, and resumes: files already saved are skipped.

## PDF

`LE.fonts.bytes(family, weight, italic[, text])` is the source-format step in front of `le-pdf.js` `embedFont()`: it decodes the face's woff2 slices to TrueType (vendored Google WOFF2 decoder in WebAssembly), for a variable font makes a static instance at the weight (fontkit variation outlines and advances, composites flattened, hinting and variation tables dropped, OS/2 weight set), and merges the slices with the main script's slice first (its glyph ids, GSUB/GPOS and kerning untouched; others appended with a new cmap). Static single slices are returned as decoded. Checked: all 253 families at 400 and 700 decode, build and embed in pdf-lib with Latin text; Onest's variation data is unreadable by the vendored fontkit, so it embeds at its default weight.

Known: the vendored fontkit (`@pdf-lib/fontkit` 1.1.1 UMD) references `regeneratorRuntime` during contextual GSUB layout, so Devanagari, Bengali and other shaped scripts fail inside pdf-lib's `drawText` (the custom font is then replaced by a standard font). CJK families need the text passed as the 4th argument.

## API (`LE.fonts`)

Kept: `list()`, `load(family, weight, italic)`, `css(name)`, `bytes(...)`, `isOffline(family)`, `saveAllOffline(onProgress)`, `ensurePreview(family)`, `previewCSS()` (now empty).
New: `register(list, opts)`, `keepPdfFaces()`, `ready()`, `find(name)`, `list(filter)` (`style, feel, script, collection, q, source, favourites, recent, families`), `search(q)`, `load(family, opts)`, `prepare(family, text, opts)`, `missing(family, text)`, `fallbacks(family)`, `preview(family)`, `pairs(family)`, `collections()`, `recent()`, `favourites()`, `setFavourite(family, on)`, `sizeOf(target)`, `saveOffline(family | collectionId | 'all' | [families], onProgress)`, `removeOffline(...)`, `keep(families)`, `usage()`, `details(family)`, `cjkAvailable()`, `on(fn)`, `labels`.
