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
- ~~**PDF studio deep links:**~~ Done: `?panel=<id>&job=<job>` opens panels and jobs (docs/SITE.md).
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

## Site data pass 2 (done 12 November 2026) and its follow-ups
Done: every maker (25), the Expert family (hub plus nine pages), AI agents (hub, agent mode, command line), fonts, themes, install choices, the PDF office kit (compare, packs, stamps, workflows, fingerprint, saved details), invoices and tables, photographers and online sellers hubs, a launch audit in `tests/site-pages.test.js` and the layperson search test. See `docs/SITE.md`.

Follow-ups for the owners of the code:
- **Deep links worth adding** (none exist today, so every Expert page launches `studio/?mode=expert`): `studio/?mode=expert&tab=<develop|mask|layers|scopes>` (the workspace already has `openPanel('expert', { tab })`), `&tool=<heal|clone|dodge|liquify|light|brush|gradient>` and `&add=<effect id>` (adds that effect to the selected layer), `?open=raw` and `?open=hdr` (the File menu commands `rawOpen` and `hdrMerge`), `studio/?tool=appearance`, `pdf-studio/?panel=docs&job=<invoice|quote|tables|clients>`, and `?panel=office&job=` already exists.
- **Agent operations for Expert** (`fx.add`, `fx.update`, `fx.remove`, `mask.set`, `map.generate`, `adjust.add`, `raw.open`, `hdr.merge`, `LEAgent.catalog('fx')`) are written up in `docs/EXPERT-MODE.md` and `docs/RAW-HDR.md` but `LEAgent.apply` answers "Unknown operation". The agent pages say so. Product staging presets (`LE.fx.composite.stage`) and the grading presets are reachable from page code only; Expert has no button for them.
- **Published docs:** `docs/FX-REFERENCE.md`, `docs/AGENT-CLI.md`, `docs/RAW-HDR.md` are not in the deploy include list (`scripts/deploy.sh` 6b), so `llms.txt` and the agents hub cannot link them.
- **Face map:** the only way to make one in the Expert UI is "Find faces" in the Liquify tool, and it loads `labs/maps/maps.js` rather than `assets/js/le-maps.js` (the Light tool's depth map uses the latter). Portrait tools for eyes, teeth and lips need it first. Check that `labs/` ships, and give the Retouch section its own button.
- **No passport or ID photo size** exists in the sizes list (search for "passport photo" finds nothing, correctly).
- **Home page copy** is hand-written and partly stale (background remover FAQ says "Not yet"; fonts "dozens"; pillars): replacement text was sent with the pass report.

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

- ~~Site data: add Screenshot beautifier, Photobooth strip, Recap collage as live entries.~~ Done (`/screenshot-beautifier/`, `/photobooth-strip/`, `/recap-collage/`).
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

## Left after the 12 Nov merges

Paused by the owner on 12 Nov (do not start until asked): X7 (cross-pack tests, real-hardware timing, Expert looks as recipes); on-canvas tools for patch and red-eye with the liquify freeze overlay; the Wave 3 remainder (brand file, design-as-code and a GitHub Action, embed viewer, consent handshake).

Not started:
- X7: cross-pack tests, real-hardware timing (`node tools/fx-bench/run.js --headed` on a real GPU and a phone), Expert looks as shareable recipes (recipes v2).
- On-canvas tools for patch and red-eye; a live freeze overlay for liquify.
- Design: empty, loading and error states; Expert panel density and number alignment; a visible reset hint; text edit mode stays on when Export opens on phone; project name truncates to "a." at 360 px.
- Wave 3 remainder: brand file, design-as-code and a GitHub Action, embed viewer, consent handshake between the command-line tool and an open tab.
- Per-app icon badges for the three installable apps.
- Eyedroppers in `le-studio-color.js` and `le-pdf-studio-color.js`, replay recording and makers are not behind the device-support gate.

Only checkable on real devices (none available in the build sandbox):
- Speed and memory of Expert effects on real GPUs and phones; half-float behaviour on mobile GPUs.
- Camera capture (scan, photobooth), install on iOS, Android and Safari, link capturing between the three apps.
- Real RAW files beyond two Nikon NEFs (DNG, CR3, ARW, files over 24 MP).

Known quality limits worth an owner look: depth blur edges, noise reduction (guided filter, well below dedicated denoisers), cast shadows on very large exports, relighting from a small depth model (reads as phone-app relighting, not a studio reshoot), highlight reconstruction colour, light-direction estimate on whole scenes.

## Full suite on the merged branch (12 Nov, after all six Expert packs)

984 passed, 2 known, 4 failed. Fixed since: "Erase everything" left an empty `le-packs-v1` cache (a read created it); the live-link "server stopped" case missed the goodbye when the stream was mid-reconnect (test now accepts "not reachable" too).
Still open:
- `expert-ui` slider drag at 4x CPU: 18 ms against a 12 ms budget with about 130 effects registered (was passing at 10 to 13 ms with one pack). Treated as real until the renderer hardening pass lands its registry changes.
- `install` per-app precache lists failed once in the full run and passes alone; suspected cause is another test writing a file into a scanned folder between the two directory scans.

## Deferred on 13 Nov to keep cost down

Renderer and packs:
- P6 float through the stack after RAW develop and the RAW seam in the core; P3 output for `develop.basic`.
- P7 `ui.order` and a grouped add-effect list; P8 on-canvas handle descriptors (`ui.handles`); P9 analysis loaded per document and `kinds: ['light']`.
- `g.below()`, `clip` on ordinary layers, fill versus opacity.
- Pack adoptions: X4 `data` parameters and `HINTS`; X3 cast shadow on `g.whole` and box defaults; X6 depth fallback and shadow cap; X2 `g.whole` and Oklab copies; X1 `selective-color` fold, `ui.channels`, `g.asset`.
- Deep links `&tab`, `&tool`, `&add`, `?open=raw|hdr`; `page.resize` px rescale in `le-link.js`; template-field operations in the command-line tool; `summarize()` labels for template-field operations.
- `hdr.merge`, `composite.match`, `relight.portrait` and `relight.retime` are wired for agents but not exercised by a test beyond input checks.

First load:
- Split `le-studio-panels.js` (20 to 25 KB) to get the studio back under 250 KB; split `le-pwa.js` (32 KB) with its owner; defer `le-assets` and `le-fonts` in the PDF studio; a studio-only stylesheet; a static summary for the start-screen makers row.

Tests:
- `install` per-app precache lists fails in full parallel runs and passes alone (a file appears in a scanned folder mid-run).
- Running more than two browsers at once on the shared machine crashes pages ("Page crashed", `ERR_INSUFFICIENT_RESOURCES`); use `TEST_JOBS=2`.

## Full suite, 13 Nov, final branch state (49e30af)

`tests/run-all.sh 2`: 1,125 passed, 1 known, 0 failed. The one known is QA-017. Run on software rendering in the build sandbox; nothing here measures real GPUs, phones, cameras or Safari.

## Wrap-up builds started 13 Nov (owner un-paused the left-undone items)

- Expert workspace: on-canvas Patch and Red-eye tools, liquify freeze overlay, generic `ui.handles`, grouped add-effect list with `ui.order`, Expert deep links.
- Renderer core and packs: float after RAW develop and the RAW seam in the core, pack adoption of the hardened core, `clip`/`g.below`/fill, analysis per document, untested agent helpers.
- Agent items: brand file, design as code with a GitHub Action, embed viewer, consent handshake between the command-line tool and an open tab.
- First load: split `le-studio-panels.js` and `le-pwa.js`; Expert looks as recipes (workflow version 2.0).
- After these merge: one cross-pack test pass (X7) and a full `tests/run-all.sh`.
- Camera RAW source-request contact is set: hello@withevergrow.com.
