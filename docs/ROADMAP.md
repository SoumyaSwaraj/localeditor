# LocalEditor roadmap

Written 12 November 2026 by the lead architect. This supersedes the "Plans afterwards" list in `docs/HANDOFF.md`; the hard rules in that file still apply.

## Status (lead architect, 13 November 2026)

Integration branch: `evergrow/focused-pasteur-t84h3j`. Everything listed as merged is on that branch and pushed. Last full run (14 November, `tests/run-all.sh`, with the chart, QR and print makers in): 1,253 passed, 1 known, 2 failed; both were load-sensitive waits in offline-worker tests, since lengthened. What is still open is in `docs/BACKLOG.md`.

**Merged**
- Phase 1: landing and design system, photo backgrounds, collage, recipes, stock (Pixabay, Pexels, Openverse, Unsplash), install and storage manager, QA suite.
- Wave 2: device support check and gates, open design format and template links, export (every size, carousel, replay, copy, share), photo privacy and redact, background remover with small and large models, 25 quick makers, template fields and Create many, hubs and feature pages (12 hubs, 59 feature pages).
- PDF studio D1 to D20, including searchable scans and camera scan.
- Fonts: 257 open-licence families on demand and 20 originals.
- Light first load and on-demand modules (`docs/LOADING.md`), download policy and packs (`docs/DOWNLOADS.md`), three installable apps (`docs/INSTALL.md`).
- Agents: agent mode in the browser, command line and MCP, live link; Expert effects, maps, RAW, HDR and template fields as agent operations (`docs/AGENT-GUIDE.md`, `docs/AGENT-CLI.md`).
- Expert mode: workspace, renderer (`docs/FX-AUTHORING.md`), seven effect packs with about 120 effects (`docs/FX-REFERENCE.md`), RAW develop and HDR (`docs/RAW-HDR.md`), depth, face and segment maps.
- Design: five themes with Clear as the default (`docs/DESIGN.md`).

**Wrap-up (14 November), all merged:** on-canvas Patch and Red-eye tools, effect handles and Expert deep links; full precision after RAW develop and the packs on the hardened renderer; brand file, design as code with a GitHub Action, embed viewer, consent prompt for the command-line tool; first-load splits (studio 240 KB); Expert looks as recipes (workflow 2.0); cross-pack tests. What is still open is short and listed in `docs/BACKLOG.md` ("After the wrap-up builds").

**Cannot be checked in the build sandbox:** speed on real GPUs and phones, cameras, install on iOS, Android and Safari, real RAW files beyond two samples.

## The three goals

1. **Easy.** Anyone can make something good in a minute, on a phone, with one hand.
2. **Complete.** Every well-known editing feature a browser can run, with strict control over what the app stores on the device.
3. **AI-ready.** An agent can write a design as a plain file, a person can open it live, both can keep editing it.

## Architecture decisions

| # | Decision | Why |
|---|---|---|
| A1 | Stay vanilla ES2018 IIFEs on `window`, no bundler, no framework. | The site is a static S3 upload. 41k lines already work this way. |
| A2 | One feature, one module file (`le-studio-<feature>.js` + `studio-<feature>.css`). Shared files get small hook edits only. | Lets several people work at once and keeps merges clean. |
| A3 | **Format first.** Every feature stores its state as plain data in the scene document. Nothing meaningful lives only in a closure or a baked bitmap when it can be a parameter. | The document is the API agents write. If a feature is not in the document, an agent cannot use it and a person cannot re-edit it. |
| A4 | Stable ids and readable names on every layer, slot, page and asset. | Agents and people refer to things by name ("make the title bigger"). |
| A5 | Declarative only. Recipes, templates and designs never carry script, HTML or event handlers. Imports are validated against a fixed list. | A shared file must be safe to open. |
| A6 | Every cache has an owner, a size and a clear button. Large optional data (icon packs, fonts, AI models, stock imports) is downloaded on request and listed in the storage manager. | "Rigorous memory management" is a product feature, not a setting. |
| A7 | Nothing is fetched from a third party at runtime unless the user starts it (stock search, model download). Vendor code and models are self-hosted. Licences: MIT, ISC, BSD, Apache-2.0, OFL only. | Privacy is the product. |
| A8 | Phone first. Every new control is designed at 360px wide, then widened. Touch targets are 44px or more. | Most people will use this on a phone. |

## Phase 1 — finish what was started

| Id | Work | Owner |
|---|---|---|
| 1.1 | **Landing page and design system refresh.** Calmer, more confident homepage; one clear action; real product imagery; consistent tokens across home, tools and both studios; light and dark. | Design lead |
| 1.2 | **Background studio.** A photo background can be cropped, panned, zoomed, flipped, fitted (fill, fit, stretch, tile), blurred, dimmed and colour-adjusted, directly on the canvas. "Use as background" and "Detach from background" for any photo. All of it stored in `doc.background`. | Engineer |
| 1.3 | **Collage.** Apps → Collage becomes a real builder: layouts by photo count, spacing, corner radius, border, background; every cell is its own photo slot; drag to swap cells, pan and zoom inside a cell, shuffle. Style catalogue reachable from the same place. 8–12 variations for the reference styles. Stock import onto the canvas, attribution line, stock panel polish. | Engineer |
| 1.4 | **Recipes.** Save the current look as a recipe; edit, reorder and toggle steps; strength slider; live before/after thumbnails; 20+ built-in recipes; share as a file, a link (recipe in the URL fragment, so it never reaches a server) or the system share sheet; batch apply; a proper `/recipes/` page. | Engineer |
| 1.5 | **Unsplash provider** in `LE.stock` alongside Pixabay, Pexels and Openverse, following Unsplash's API terms (hotlinked image URLs, download ping, credit line). | Junior |
| 1.6 | **Install and storage.** Install prompts for Android, desktop and iOS; update notice; file handlers and share target; storage manager (what is stored, how big, clear per category, persistent-storage request, automatic limits); memory guards in the editor; S3 + CloudFront deploy script with correct cache headers. | Engineer |
| 1.7 | **Background remover spike.** Can a permissively licensed model remove a background in the browser at acceptable speed and size? Prototype, numbers, recommendation. | Junior |
| 1.8 | **Test harness and baseline QA.** Playwright smoke tests for the core flows at desktop and phone sizes; bug list. | QA |

## Build order after phase 1 (set by the owner, 12 November 2026)

1. **Wave 2 — features that spread and features people use every week.**
2. **Wave 3 — what makes agents better at design.**
3. Remaining depth work, as capacity allows.

The open-format core (validator, shorthand, import and export) is pulled forward into wave 2, because remix links, template variables and bulk create all need it.

## Wave 2 — spread and weekly use

| Id | Work | Depends on |
|---|---|---|
| 2.1 | **Open format core.** `.ledesign.json`: one validator shared with `.leproject`, the shorthand in `docs/AI-FORMAT.md`, import and export in the studio, JSON Schema. | Phase 1 document fields |
| 2.2 | **Remix links.** A template in the URL fragment: layout, text, styles and empty photo slots. Open the link, add photos, edit. Nothing reaches a server. Designs with photos share as a file. | 2.1 |
| 2.3 | **Process replay.** Export the making of a design as a short video, for a person's edits or an agent's. | — |
| 2.4 | **One design, every size.** Pick sizes, get a zip. Plus copy to clipboard and the system share sheet. | — |
| 2.5 | **Carousel maker.** One wide design split into seamless slides, with slide guides while editing. | 2.4 |
| 2.6 | **Template variables and bulk create.** `{{name}}`, `{{price}}`, `{{photo}}` in any text or photo slot; a spreadsheet in, a zip of finished designs out. | 2.1 |
| 2.7 | **Photo privacy check.** "What does this photo know about you?": location, device, time; strip in one tap. Metadata is stripped on export by default. Redact tool (blur, pixelate, box) burned in on export. | — |
| 2.8 | **Screenshot and post beautifier.** Paste a screenshot or code and get a framed, share-ready image. | — |
| 2.9 | **Background remover in the studio, and the thumbnail kit** (cut-out, outline, bold text). | 1.7 passing |
| 2.10 | **Photobooth strips and recap collages** from the camera or the camera roll. | 1.3 |
| 2.11 | **Phone studio pass and first-run guidance**, driven by the QA phone review and the designer's polish list. | 1.8 |

## Wave 2P — PDF studio for office work (added by the owner, 12 November 2026)

Audience: office workers who need a tool they can trust with confidential files. Runs alongside wave 2. Everything is on-device; anything that needs a model or a new library is an optional download listed in the storage manager.

| Id | Work | Notes |
|---|---|---|
| D1 | **True redaction.** Removes the underlying text and image data, not just a black box, with a "verify" pass that re-reads the saved file. | Page content must be rewritten or rasterised; decide per page |
| D2 | **Find sensitive data.** Emails, phone numbers, account and ID numbers found automatically, then redacted in one click. | Pattern matching on extracted text; scanned pages need D9 |
| D3 | **"What does this PDF reveal?"** Author, software, dates, hidden text, comments, attachments, form data; strip them all. | |
| D4 | **"Is this PDF safe to open?"** Flags scripts, embedded files, auto-launch actions and outside links. | |
| D5 | **Password-protect and unlock**, locally. | Needs a PDF encryption library; pdf-lib has none |
| D6 | **Safe to send.** One click: flatten, scrub (D3), remove active content (D4), compress. | D3, D4, D8 |
| D7 | **Per-recipient watermarks in bulk**, so a leak can be traced. | |
| D8 | **Compress to a target size** ("under 2 MB"). | |
| D9 | **Make scanned PDFs searchable.** On-device text recognition. | Optional model download |
| D10 | **Phone camera to clean scan.** Edge detection, straighten, clean up, save as PDF. | |
| D11 | **Saved details that fill any form**, stored only on the device. | |
| D12 | **Mail-merge.** Template plus spreadsheet gives one PDF per person, each with its own password. | D5 |
| D13 | **Split by text.** One long file becomes one file per employee or student. | |
| D14 | **Compare two versions**, text and visual. | |
| D15 | **Bundle builder.** Merge with cover page, contents and page numbers. | |
| D16 | **Stamps** (Approved, Paid, Received) with name and date, plus a summary page of comments. | |
| D17 | **Invoice, quote and receipt maker** with a local client list. | |
| D18 | **Extract tables to a spreadsheet.** | Quality depends on the PDF; label as best effort |
| D19 | **Saved PDF workflows** ("merge → number → watermark → protect") shared as recipe files. | Reuses the `.leworkflow` idea with a PDF operation list |
| D20 | **Fingerprint receipt.** A checksum and QR code so anyone can confirm a file is unchanged. | |

Order: D3, D4, D1, D2, D6 first (the security story), then D8, D5, D12, D13, D7 (weekly office use), then the rest. D9 and D10 start with a feasibility check like the background remover had.

## Wave 2M — added by the owner, 12 November 2026

| Id | Work |
|---|---|
| S1 | **Device support check.** Every feature declares what it needs. The app tells the person what works on this device and browser, suggests a browser that supports more, and still offers "Try anyway" when the answer is uncertain. A `/device-check/` page shows the whole picture. |
| S2 | **Model choice for the background remover.** Fast, Detailed and People models, each with its size, what it is good at, and whether this device can run it. Beta label. Brush for touch-ups. |
| C1 | **Category and feature pages.** A hub page per category (photo and design, PDF and documents, privacy, social and creators, small business, teachers, text and developer) and a page per major feature, generated from one data file. Only features that are live get a page. |
| M1 | **Quick makers**: a form in, an editable design out. First set: V8 quote cards, V20 review cards, V4 receipt-style lists, V2 milestone cards, V1 palette poster, V6 film-camera looks. |
| M2 | Makers: V3 movie poster, album cover, newspaper front page; V14 event kit; V15 invitations with QR; V19 payment and Wi-Fi QR posters; V21 app-store screenshot sets; V22 link preview cards and README banners. |
| M3 | Print makers: V12 printables with cut marks; V13 photo book and zine layouts; V18 catalogue or price list from a spreadsheet. |

## Wave 2F — fonts, weight and agent mode (added by the owner, 12 November 2026)

| Id | Work |
|---|---|
| F1 | **Font library of 200+ families.** The best-known free-for-commercial-use families (OFL or Apache only), self-hosted, loaded only when used, with an optional "Save for offline" per font, per collection or for all. Scripts beyond Latin. A picker that stays fast with 200+ entries. |
| F2 | **Twenty original typefaces**, five in each of four intents: attention, trust, positive feeling, tension. Built from a parametric generator, grounded in published research on how letterforms affect perception, with a research note and specimens. |
| L1 | **Light first load.** A small core loads first; each feature downloads when first used and then in the background, so the app still becomes fully offline. Starts after F1, F2 and the current wave merge. |
| G2 | **Fast path for agents: command line, MCP server and local API.** The same operations as agent mode, run on the real engine in a headless browser with no animation, for agents that just need the work done. Reads and writes `.ledesign.json` files; renders previews; can link a file to an open tab so a person can watch. The browser mode (G1) is for working together; this is for speed. |
| G1 | **Agent mode in the browser.** A coding agent (Cursor, Claude Code and others) drives the open studio through a documented control API, a typed console, or links; the person watches each change happen, can pause, stop, undo any single change, leave notes and take over. Interruptions by the person midway are handled: batches are atomic, the agent waits while the person edits, and conflicting changes are reported back. |

## Expert mode (added by the owner, 12 November 2026)

Studio-level editing for agents first and for people who switch to Expert: professional shadows and reflections, creative optical effects, RAW and HDR, relighting, liquify, frequency separation, skin retouching, colour grading, compositing. Architecture, document model and build order are in `docs/EXPERT-MODE.md`. Fable plans and builds the core renderer; Opus and Sonnet build the workspace, the feature sets and the tests.

## Wave 3 — agents

| Id | Work |
|---|---|
| 3.1 | **Live link.** Open a folder from the studio; it reloads when the file changes, writes back when the person edits, and highlights what changed. File System Access API, no server. |
| 3.2 | **Self-check loop.** After each load the studio writes a problems list (overflowing text, off-page layers, low contrast, missing images) and a rendered preview next to the design. |
| 3.3 | **Local bridge and one-command setup.** `npx localeditor`: serves the app, syncs a folder with any browser, and runs an MCP server (read, write, patch, validate, render, catalogues). |
| 3.4 | **Brand file.** Colours, fonts and logo in one file that every agent output follows; reads and writes the existing brand kit. |
| 3.5 | **Design as code.** A command and a GitHub Action that validate and render `.ledesign` files in a repository. |
| 3.6 | **"Edit this design" embed.** A small viewer for docs and blogs with an "Open in LocalEditor" button. |
| 3.7 | **Agent kit.** `llms.txt`, format guide, examples, instruction files for Claude Code, Codex, OpenCode, Cursor and Antigravity. |
| 3.8 | **Agent activity in the studio.** Change feed, per-change undo, pinned notes for the agent. |

## Later — depth

Command palette and shortcut sheet; curves, per-colour HSL, LUT import, straighten and perspective, grain, duotone, tilt-shift; a wider template library shared as `.letemplate`; charts, tables, device mock-ups, speech bubbles.

Not planned: accounts, cloud sync, a hosted gallery, a forced watermark, an in-app assistant that needs our API key.

## Working rules for everyone on the build

- Read `docs/HANDOFF.md` hard rules first. They still hold.
- Put new work in new files. In shared files (`le-studio.js`, `le-studio-panels.js`, `le-objects.js`, `studio.css`, `app.js`, `app.css`) make the smallest edit that hooks your module in.
- A later script can replace a panel: `window.LEStudioPanels.<id> = { eyebrow, title, render(c, body, opts), doc, close }`. Hooks: `init, select, change, history, page, zoom, resize, drop, key, escape, panel-close`.
- Do not commit `sw.js` or `sitemap.xml`. They are generated at integration with `node scripts/build.js`.
- Every feature ships with a test in `tests/<area>.test.js` (see `tests/README.md`) that passes at 1440×900 and 390×844.
- Check light and dark. Check the console is empty. Gold buttons use ink `#2A1F0A`.
- Stock APIs, Hugging Face and public CDNs are not reachable from the build sandbox. Mock them in tests.

## Owner requests in progress (12 Nov)

| Item | What | State |
|---|---|---|
| Design pass 3 | **Theme system, five themes**: Clear (default, Apple-like: system type, grouped greys, one blue tint, translucent bars), Lapis (the earlier design, kept), Graphite, Paper, Contrast. Appearance picker; `docs/DESIGN.md` has the theme contract. | Merged |
| Design pass 4 | Grouped lists, switches, large titles, product-page hubs and feature pages, slider and phone-flow fixes. Not done: empty, loading and error states; Expert panel density; camera screens. | Merged |
| Install choice | Install the **Design studio only**, the **PDF studio only**, or the **whole suite**: three manifests, one worker, offline files follow the installed app (`docs/INSTALL.md`). Verified in desktop Chromium only; the CloudFront Function must be republished. | Merged |
| D9, D10 | Make scanned PDFs searchable; scan with the camera, in the PDF studio (`docs/PDF-OCR-SCAN.md`). Never tried on a real phone camera. | Merged |
| 2.8, 2.10 | Screenshot and code beautifier; photobooth strips; recap collages (quick makers). | Merged |
| X0a | Expert effect renderer `LE.fx` (contract: `docs/FX-AUTHORING.md`). | Merged |
| X1 | Expert colour grading pack (18 effects, presets, LUT import/export). | Merged |
| X2–X6 | Expert packs: creative effects (45), shadows/reflections/compositing (20), retouching and liquify (17), RAW develop and HDR merge, relighting and depth with `LE.maps`. Reference: `docs/FX-REFERENCE.md`, `docs/RAW-HDR.md`. | Merged |
| Renderer hardening | Catalogue index, data parameters, whole-layer and map inputs, cut-out before effects, draw-time cache, agent and command-line operations. On-canvas handle descriptors deferred. | Merged |
| Integration fixes | Cross-module failures, device-support wiring, open-format fields, shadow scaling, page ids. | Merged |
| L1 | Light first load: studio about 257 KB blocking (was 623), PDF studio about 285 KB, home 44 KB. | Merged |
| Site data 2 | 12 hubs, 59 feature pages, every launch link checked by a test. | Merged |
| 2.6 | Template fields and Create many (`docs/VARIABLES.md`). | Merged |
