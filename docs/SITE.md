# Category hubs and feature pages

One data file, `assets/data/site.json`, drives the category hubs, the feature pages, the header search, the drawer's "Browse by need" list, the homepage's "Browse by what you need" list and footer, and the "Find by need" section of `llms.txt`. `scripts/build-pages.js` writes them; `node scripts/build.js` runs it.

## The status rule

| Status | Page | Listed on hubs, homepage, drawer, search, llms.txt, sitemap |
|---|---|---|
| `live` | yes | yes |
| `beta` | yes, with a Beta label | yes, with a Beta label |
| `soon` | **no** | **no**. Never linked, never named, not in search. Data only. |

Launching a feature:

1. In `assets/data/site.json`, change the entry's `"status": "soon"` to `"live"` (or `"beta"`).
2. Check its wording and `launch` against what actually shipped. The soon entries were written ahead of the feature.
3. Run `node scripts/build.js` (or `node scripts/build-pages.js`). It refuses to build, with a list of problems, if anything is missing or the launch URL does not resolve to a page.
4. Run `node tests/run.js pages`, then commit the new folder plus the changed hubs, `index.html`, `assets/js/app.js` and `llms.txt`.

Rolling back is the same in reverse: set it to `soon` and rebuild. The generator deletes any folder it wrote that the data no longer asks for. It never touches a folder it did not write (it checks for its `<meta name="generator">` tag) and fails if a feature's URL is already taken by a hand-made page.

## URL scheme

Short, lowercase, hyphenated, one level deep, never renamed once live.

- **Hubs**: `/photo/`, `/pdf/`, `/privacy-tools/`, `/social/`, `/business/`, `/teachers/`, `/office/`, `/tools/`.
- **Feature pages**: named after what people search for, at the top level so a feature can belong to several hubs with one canonical URL: `/collage-maker/`, `/photo-backgrounds/`, `/batch-edit/`, `/social-media-sizes/`, `/photo-editor/`, `/add-text-to-photo/`, `/brand-kit/`, `/pdf-editor/`, `/word-to-pdf/`, `/install/`, `/storage-manager/`.
- **Tool pages built by hand** (`/photo-privacy/`, `/device-check/`, the single-step tools) are entries of kind `tool` with a `launch` URL and no `url`: they are listed, never generated. Both are also in `TOOLS` in `scripts/build.js`, which is what the tool directory, `llms.txt`'s tool lists, the about page and the header search read; the homepage directory (`index.html`) is edited by hand, so add a tool there too.

## Entry schema

```jsonc
{
  "id": "collage-maker",            // unique, lowercase-hyphenated; referenced from other entries
  "kind": "feature",                 // category | audience | feature | tool
  "status": "live",                  // live | beta | soon
  "url": "collage-maker/",           // page URL (categories, audiences, features). Omit for kind tool.
  "title": "Collage maker",          // name in lists, crumbs, search
  "tagline": "…",                    // one line in lists and search
  "icon": "collage",                 // key in ICONS in scripts/build-pages.js (or a build.js tool icon)
  "headline": "Make a collage, {every cell its own photo.}",  // h1; {braces} = the serif italic accent
  "metaTitle": "…",                  // <title> (suffixed "| LocalEditor") and og:title; unique
  "description": "…",                // meta description, at most 170 characters; unique
  "summary": "…",                    // lead paragraph
  "launch": "studio/?tool=collage",  // root-relative URL that opens the tool at this feature
  "launchLabel": "Make a collage",   // the one gold button
  "panel": "apps", "panelOpts": { "app": "collage" },  // studio panel the launch must open (tested)
  "job": "redact",                   // PDF studio only: the job inside the panel (security: send, reveal, safety, redact, find; bulk: protect, merge, split, watermark, compress)
  "maker": "quote",                  // quick makers only: launch is studio/?make=<maker>; the test checks the form that opens
  "action": "install",               // optional: install | storage; the button opens that dialog in place
  "secondary": { "href": "…", "label": "…" },          // optional ghost button
  "art": "collage",                  // hero composition, see ART in build-pages.js
  "parents": ["photo"],              // category ids; the first live one is the breadcrumb
  "audiences": ["social"],           // audience hub ids ("Part of …")
  "does": ["…"],                     // features: 3 to 5 plain bullets
  "steps": ["…", "…", "…"],          // features: exactly 3
  "privacy": "…",                    // one honest paragraph
  "faq": [["Question?", "Answer."]], // 2 to 4
  "related": ["photo-editor", "tool:merge-pdf"],
  "keywords": ["…"]                  // search only, never shown
}
```

Hubs (`category`, `audience`) also take `eyebrow`, `audience` (who it is for), and `sections: [{ "title", "items": [ids] }]`. Put soon features in a section already: they stay hidden until flipped, then appear in place. A section with nothing live is left out. `"directory": true` (the every-tool hub) renders the filterable tool directory instead.

`tool:<slug>` refers to an entry in `TOOLS` in `scripts/build.js`, so a tool added there appears on `/tools/` at the next build.

## Deep links: what a launch URL must do

A feature page is only useful if its button opens the feature itself, and `tests/pages.test.js` opens every launch URL in a browser and checks it. Add the deep link first, then the data.

**Photo studio**: `studio/?tool=<id>`. `TOOL_MAP` in `assets/js/le-studio.js` maps an id to a panel id, or to `[panel, options]` (the options are what `openPanel(id, opts)` receives: `{ app }` for Apps, `{ tab }` for Design and Download). Current ids beyond the original set: `brand`, `cutout` (`remove-background`), `redact`, `thumbnail`, `make` (`makers`), `export-sizes`, `carousel` (`slides`), `replay`, `share`, `design-file`. Quick makers are not panels: `studio/?make=<id>` opens that maker's form (quote, review, receipt, milestone, palette, film).

**PDF studio**: `pdf-studio/?panel=<id>&job=<job>`. A panel that needs a document leaves the open-file prompt on screen with a short message, and continues to the panel (and job) once a file is chosen. Panels that work without a file (`bulk`, `convert`) open at once. An unknown panel or job is ignored. The jobs are `PS.security.go(view)` for Protect and `PS.bulk.open(id)` for Bulk; `job=find` opens Hide information for good with the Find sensitive data box open.

The tests are `tests/pages.test.js` (every launch in `site.json`) and `tests/deep-links.test.js` (the table of ids and the edge cases).

## Adding a category or feature

Add an entry, run the build, read the page at 360 px and 1440 px in both themes, run `node tests/run.js pages`. A new hub also appears in the drawer, the homepage list, the footer and search automatically.

## Wording rules

- No invented numbers, ratings or testimonials.
- Never claim legal compliance (GDPR, HIPAA, FERPA or any certification). Say what the design does (files stay on the device) and that the reader's organisation decides whether that is enough.
- Never mention a `soon` feature on a live page, including in FAQ answers ("coming soon" counts). The tests check every page for every soon title.

## Checklist when a feature ships

1. Deep link works (above). 2. Entry flipped, wording checked against the module and its tests: real behaviour, real limits, no numbers that are not in the code, no compliance claims. 3. `node scripts/build.js`. 4. `node tests/run.js pages deep-links`. 5. Commit the generated pages, `assets/js/app.js`, `index.html` and `llms.txt`; leave `sw.js` and `sitemap.xml` to integration.

## Offline

Hub pages are precached by the service worker. Feature pages are not (they are one tap from a hub and the precache has a size and count budget); `assets/data/site.json` is build input and is not precached either. See `notPrecached` in `scripts/build-pages.js`.
