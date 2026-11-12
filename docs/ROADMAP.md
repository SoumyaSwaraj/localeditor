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

## Phase 2 — easy and complete

| Id | Work |
|---|---|
| 2.1 | Phone studio pass: larger handles, pinch and two-finger rotate, contextual bottom bar, sheet snap points, thumb-reach layout. |
| 2.2 | First-run guidance, command palette (search every action), shortcut sheet, better empty states. |
| 2.3 | Privacy tools: redact (blur, pixelate, solid box, burned in on export), strip metadata on export by default, a "what this file contains" report. |
| 2.4 | Export and share: presets, export several sizes at once, WebP and AVIF, copy to clipboard, system share sheet. |
| 2.5 | Photo depth: curves, per-colour HSL, LUT import (`.cube`), straighten and perspective, grain, duotone, tilt-shift. |
| 2.6 | Template library beyond collage (quotes, sales, stories, thumbnails, invitations), shared as `.letemplate`. |
| 2.7 | Background remover in the studio, if 1.7 passes. |
| 2.8 | More elements: photo frames and grids, charts from pasted data, tables, device mock-ups, speech bubbles. |

## Phase 3 — AI-ready

| Id | Work |
|---|---|
| 3.1 | **Open design format.** A design as readable JSON plus an assets folder (`.ledesign`), with a published JSON Schema, a validator and version migration. The zip `.leproject` stays as the single-file form of the same document. |
| 3.2 | Import and export of the open format in the studio, with a lossless round trip. |
| 3.3 | **Live link.** Open a folder from the studio; the studio reloads when the file changes and writes back when the person edits. Changed layers are highlighted. Uses the File System Access API, so it works from the hosted site with no server. |
| 3.4 | **Local bridge.** A zero-dependency Node command that serves the app locally, syncs a folder with any browser (including Safari and Firefox), and exposes an MCP server so an agent can read the design, apply changes and ask the open tab for a rendered preview. |
| 3.5 | **Agent kit.** `llms.txt`, format guide, examples, and ready-made instruction files for Claude Code, Codex, OpenCode, Cursor and Antigravity. |
| 3.6 | **Agent activity in the studio.** A change feed, per-change undo, and pinned notes a person can leave for the agent ("make this warmer"). |

Phase 3 starts after phases 1 and 2 land, so the format covers every feature. Rule A3 is what keeps that possible.

## Working rules for everyone on the build

- Read `docs/HANDOFF.md` hard rules first. They still hold.
- Put new work in new files. In shared files (`le-studio.js`, `le-studio-panels.js`, `le-objects.js`, `studio.css`, `app.js`, `app.css`) make the smallest edit that hooks your module in.
- A later script can replace a panel: `window.LEStudioPanels.<id> = { eyebrow, title, render(c, body, opts), doc, close }`. Hooks: `init, select, change, history, page, zoom, resize, drop, key, escape, panel-close`.
- Do not commit `sw.js` or `sitemap.xml`. They are generated at integration with `node scripts/build.js`.
- Every feature ships with a test in `tests/<area>.test.js` (see `tests/README.md`) that passes at 1440×900 and 390×844.
- Check light and dark. Check the console is empty. Gold buttons use ink `#2A1F0A`.
- Stock APIs, Hugging Face and public CDNs are not reachable from the build sandbox. Mock them in tests.
