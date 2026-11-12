# Open items

Kept by the lead architect. Things reported by the team that are not yet assigned or fixed. Roadmap items live in `docs/ROADMAP.md`; bugs with repro steps live in `docs/QA-REPORT.md`.

## Decisions waiting for the owner
- **Background-remover weights.** Code and weights are Apache-2.0, but the training data has no clearly stated licence. Legal review before launch.
- **Compliance wording.** Pages for clinics, law firms, schools and offices say "never uploaded". They must not claim GDPR, HIPAA or FERPA compliance without legal review.
- **Replay end tag.** The "Made with LocalEditor" tag on replay videos is off by default. Turning it on by default would help reach.
- **Open source and self-hosting.** Not decided.

## Decisions made by the owner
- **Camera RAW decoder (12 November 2026):** allowed as an optional download with its licence shown, as an exception to the licence rule. Worth one legal read of how the licence text, source offer and replaceability are presented before launch.
- **Download policy (12 November 2026):** `docs/DOWNLOADS.md`.

## Not yet assigned
- **QA-010** Convert to PDF turns Word, Markdown, HTML and PowerPoint into page pictures with no text layer. Belongs with the next PDF wave.
- **PDF wave, second half:** D11 saved form details, D14 compare versions, D15 bundle builder, D16 stamps and comment summary, D17 invoice maker, D18 tables to spreadsheet, D19 saved PDF workflows, D20 fingerprint receipt. D21 to D26 (teacher kit) are not requested yet.
- **Makers, second and third sets** (M2, M3) start when the framework merges.
- **Device support follow-ups:** register `/device-check/` in generated lists and the precache (site-data pass). Done at integration: "update this browser" suggestions; gates and success/failure reports for large photos, multi-page PDF export, batch, big collages, eyedropper, stock offline, PDF studio open/convert, share and copy. Not wired: the eyedropper in `le-studio-color.js` and `le-pdf-studio-color.js` (owners' files), replay recording, makers.
- ~~**Version history limit.**~~ Done: `LE.project.setKeepCount`, fed by the storage manager's "versions kept".
- **Background studio:** detach is approximate for blurred, dimmed or tiled backgrounds; rotation is 90° steps only; old `bgPhotos` code in the colour module is unreachable and can be deleted; pattern backgrounds could be stored as tiles instead of full-page bitmaps.
- **Collage:** catalogue templates are not tunable with the builder sliders; flipped slots pan mirrored; the index grew to 66 KB.
- **Recipes:** resize, border and text steps only run on export or batch, not live in the studio.
- **Local languages and scripts.** The font library is Latin only.

## Reported by wave 2 (12 November 2026)
- ~~**Format:**~~ Done at integration: `carousel`, `maker`, `redact`, `cutout` in `.ledesign.json`, the schema and the docs; page ids live on the page. The schema is still not run through a JSON Schema validator (none is vendored); a test checks every key the studio writes for these fields is in it.
- **PDF fonts (existing bug):** the vendored fontkit subsets the Inter WOFF wrongly (only some glyphs appear) and throws on IBM Plex Mono, so PDF studio exports using Inter are probably broken and Bates numbering falls back to a standard font.
- **PDF studio deep links:** `pdf-studio/?panel=X` is parsed but nothing opens the panel, so feature pages cannot launch a PDF tool directly.
- **PDF studio rail on phones:** eight tabs now; Export is partly off-screen at 360 px.
- **PDF security:** scrub, redact and make-safe refuse encrypted files until they are unlocked first (unlock now exists in the bulk tools; wire the two together). The older Edit → Redact tool still rasterises without a verify pass; point it at Protect.
- **PDF passwords:** not verified in Adobe Reader, macOS Preview or Chrome's viewer. 200 protected files take about 45 s on desktop.
- **Studio:** `brand` has no `?tool=` deep link. Done at integration: `toolbar-add` concatenates every module; layer shadows scale with zoom and export scale; `ctx.isUserPhoto` keeps masks out of collage pickers (the cut-out module's own `photoIds` still uses its name test).
- **Export:** wide carousels on phones are split in bands, so a photo or gradient background can show a seam. The replay timeline is session-only.
- **Redact:** "Apply permanently" does not cover photo backgrounds; version history may still hold the original photo.
- **Makers:** style chips have no previews; story sizes leave empty space in a few styles.
- **Photo privacy check:** HEIC can be read but not cleaned in Chromium; GIF is not checked.

## Reported by the studio shell pass (12 November 2026)
- **Duplicate download toast:** `IT.download` in `app.js` always says "Download started" and the studio adds its own "Downloaded 1.5 MB".
- **Collage on phone:** the zero-photo start still does nothing silently; slot cells still show resize handles; the Replace sheet has an empty "Other photos on this device" label.
- **Draw panel:** the Pen, Marker, Highlighter and Eraser row duplicates the toolbar.
- **Remover label:** "Remove BG" is wide and pushes Filters into More at 360 px; use a shorter label or icon on phones.
- **Resize:** custom width and height keeps the ratio lock on, so 500 × 300 becomes 500 × 500 (failing test `studio-edit › custom width and height in Resize`).
- **Layers panel ARIA** (QA-018, QA-019), locked layers cannot be selected on the canvas (QA-003), Elements thumbnail (QA-017).
- **On-screen keyboard** may cover text being typed; scrolling the text above the keyboard is not built. Safe-area insets on notched phones are unchecked.

## Reported by agent mode (12 November 2026)
- ~~**First-run hints show during an agent session.**~~ Done: coach marks are off while agent mode is on.
- **Consent is a screen gate only.** An agent that can click could press Allow itself; a browser cannot tell its click from a person's. The agent kit tells agents never to do this.
- ~~**Open format:** `notes`; `LE.design.parseLayer`.~~ Done: top-level `notes` in `.ledesign.json` and the schema; `LE.design.parseLayer` and `layerToLong`, used by the agent module.
- **Undo:** batches that add, remove or switch pages clear the page's undo history; they can only be undone from the activity feed. "Undo this change" is selective only while the touched layers are unchanged, otherwise it offers "Undo back to here".
- ~~**Lint is blind to text over photos and gradients.**~~ Done: `LE.design.lintRendered` (and an `opts.sample` hook on `lint`). The agent module still calls plain `lint`; switching its self-check to `lintRendered` is the agent owner's call (it costs one low-resolution render per page).
- **One agent session at a time.**
- ~~**`llms.txt`** agent mode section.~~ Done, with the agent guide, format specs, agent kit and schema now deployed at their repository paths.

## Site data pass 2 (not yet assigned)
Built and merged but still marked "coming soon" or missing on the hubs and feature pages: the nine makers of set 2 (movie poster, album cover, front page, event kit, invitation with QR, scan-to-pay poster, Wi-Fi sign, app-store screenshots, link cards) and the seven print makers (calendar, chart, labels, stickers, photo book, zine, catalogue); PDF office tools (saved details, compare, bundle, stamps, workflows, fingerprint and `/verify/`); PDF documents (searchable-text convert, invoices, tables to spreadsheet); agent mode. Each needs a verified launch link and wording written from the code. Do this once fonts, the command line and expert mode have landed, in one pass.

## Light first load (L1) — not finished
- The studio's blocking scripts are 496 KB gzip, over the 480 KB budget the loading test sets (marked as a known bug in `tests/loading.test.js`). The deferral mechanism exists (`LE.modules.defer`, `docs/LOADING.md`) but only the stock module uses it. Recipes, export, privacy, makers, cut-out, agent mode, the font picker and the originals list each need the small change described there. First paint did not get measurably faster yet.
- The cut-out chooser and the font picker must be checked against `LE.downloads` now that it exists (both were written against the stub).
- The storage manager's downloads section is missing if it opens before the download manager has loaded.

## Never verified in this build environment
Real iPhones and Android phones, Safari, Firefox, the on-screen keyboard, screen readers, the Android share sheet, real AWS (deploy, CloudFront function, headers policy), and every stock API (Pixabay, Pexels, Openverse, Unsplash are all tested against mocked responses).

## Fonts — open after the follow-up pass

- Shaped scripts (Devanagari and similar) still fail when embedded in PDFs: the vendored fontkit refers to `regeneratorRuntime` during layout.
- Fonts kept for a design are not released when the design is deleted.
- `le-pdf-flow.js` has a dead fallback to the old `.woff` file names.
- In automatic mode each studio / PDF studio / Convert page fetches the font index plus four PDF text faces (~575 KB) about 8 s after load, once per device. Tests that count requests after a long wait can see them.
- Select-box chevron icon still has a hard-coded neutral grey (`%238E8898`).

## Makers set 3 — follow-ups

- Site data: add Screenshot beautifier (`/studio/?make=beautify`), Photobooth strip (`?make=photobooth`), Recap collage (`?make=recap`) as live entries.
- Beautifier has no "original" aspect (a page takes its size's fixed pixels); resize after making is the workaround.
- Shared photo × button in maker forms is 28 px (`studio-makers.css`), under the 44 px rule.
- Preview shadows look heavier than export: the engine does not scale shadow blur with render scale (also on the integration list).

## PDF scan and searchable scans — follow-ups

- Never tried on a real phone, real camera or iOS (tests use a canvas stream); accuracy measured on synthetic pages only.
- One language per run; no blur or glare warning at capture; HEIC only where the browser decodes it.
- The "make searchable" offer bar and the Protect panel can both show at once on desktop.
- `/licenses/` scrolls sideways at 390 and 360 px (generated page; also makes the `tools` phone sweep fail once it gets past its timeout).

## Owner decisions raised 12 Nov (themes, install)

- Theme names: Clear (default), Lapis, Graphite, Paper, Contrast. Logo now uses the new tint `#0369DA` (was Lapis). Paper has warm editor chrome. Lapis keeps the earlier homepage layout. Contrast is suggested, not forced, when the device asks for more contrast.
- Installed app names: "LocalEditor", "LE Design", "LE PDF". Per-app icon badges not made.
- Install and offline-per-app are verified in desktop Chromium only; Safari, iOS and Android behaviour is assumed.
- Deploy: republish the CloudFront Function (`infra/cloudfront/viewer-request.js`, POST to `/pdf-studio/`), see `docs/DEPLOY.md` 4b.

## Expert — open after X1

- Selective colour is two entries until the parameter limit is raised; hue curves show R/G/B tabs; LUT input space has no log encodings; Kelvin is relative to D65 on rendered sRGB (RAW has its own).
- Never measured on a real GPU or a phone (sandbox has software rendering only): run `node tools/fx-bench/run.js --headed` on hardware.
