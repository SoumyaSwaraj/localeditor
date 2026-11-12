# LocalEditor roadmap

Written 12 November 2026 by the lead architect. This supersedes the "Plans afterwards" list in `docs/HANDOFF.md`; the hard rules in that file still apply.

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
