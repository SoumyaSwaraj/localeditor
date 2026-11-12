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

## Never verified in this build environment
Real iPhones and Android phones, Safari, Firefox, the on-screen keyboard, screen readers, the Android share sheet, real AWS (deploy, CloudFront function, headers policy), and every stock API (Pixabay, Pexels, Openverse, Unsplash are all tested against mocked responses).
