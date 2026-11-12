# localeditor — designs from the command line

Make, change, check and render LocalEditor designs (`.ledesign.json`) without opening a browser window. The real LocalEditor editor runs in a headless Chrome, Edge or Chromium on your machine — same fonts, text measuring, icons, shapes, recipes and renderer as the studio — and nothing is uploaded. The same operations are available as an MCP server and a local HTTP API, and a design file can be linked live to an open studio tab so a person and an agent work on it together.

```
localeditor <command> …        (short name: le)
```

## Install

You need **Node 20 or later** and **Chrome, Edge, Chromium or Brave**. Nothing else; the package has no dependencies.

```bash
# from a checkout of the LocalEditor repository (works today)
node tools/le-cli/bin/localeditor.js doctor
cd tools/le-cli && npm link          # puts `localeditor` and `le` on your PATH

# once the package is published
npx localeditor doctor
```

`doctor` finds a browser, starts it headless, renders an example and proves the network seal. If no browser is found it says how to install one; or point at one with `--browser /path/to/chrome` or `LE_BROWSER=/path/to/chrome`.

## The two-minute tour

```bash
le new poster.ledesign.json --preset instagram-portrait
le apply poster.ledesign.json '[
  {"op":"page.background","background":"#14213D"},
  {"op":"add","layer":{"id":"title","type":"text","text":"Bake sale","font":"Anton","size":200,"color":"#FFFFFF",
    "align":"center","x":"center","y":120,"w":"86%","h":260,"fit":"shrink"}},
  {"op":"add","layer":{"id":"hero","type":"image","slot":true,"x":90,"y":460,"w":900,"h":640,"radius":32}},
  {"op":"add","layer":{"id":"badge","type":"shape","shape":"burst","fill":"#E0B354","x":800,"y":1080,"w":220,"h":220}}
]'
le show poster.ledesign.json          # outline: pages, layer ids, types, text, boxes
le check poster.ledesign.json         # overflowing text, off-page layers, low contrast, missing images…
le render poster.ledesign.json -o poster.png
le apply poster.ledesign.json '[{"op":"update","id":"title","set":{"text":"Bake sale\nSaturday"}}]' --render poster.png
le link poster.ledesign.json          # open it live in your browser; edits flow both ways
```

## Commands

| Command | What it does |
|---|---|
| `new <file> [--size WxH \| --preset name] [--from example] [--name] [--background] [--force]` | A design with one empty page, or a copy of an example (`hello-world`, `quote-card`, `summer-sale-post`, …). |
| `apply <file> <ops.json \| - \| '[…]'> [--dry-run] [--partial] [--if-rev rev] [--render out.png]` | Applies a batch of operations atomically and writes the file back in the normalised long form. Prints the new revision and any **new** problems. |
| `show <file> [--full]` | Outline, or the normalised file. |
| `find <file> <query>` | Layers by id, name, type, text, font or image path (exit 1 when none). |
| `validate <file…>` | Errors with JSON-pointer paths; `-` reads stdin. Exit 1 if any file is invalid. |
| `check <file> [--max-warnings n]` | Problems with kinds, layer ids and pointers; exit 1 if more than n (default 0). |
| `render <file> [--page n\|id\|all] [-o out] [--scale s] [--format png\|jpg\|webp\|pdf] [--transparent]` | Pages counted from 0. Several pages → `out-0.png`, `out-1.png`; PDF → one file. Without `-o`: to stdout when piped, else `<design>.png`. |
| `catalog fonts\|icons\|shapes\|recipes\|makers\|layouts\|sizes [query]` | What exists offline. Icons need a query (`le catalog icons sun`). |
| `make <maker> -o <file> --values '<json>' [--style] [--size]` | A finished design from a quick maker. Photo inputs become empty slots. |
| `convert <in> <out> [--images embed\|assets]` | `.ledesign.json` ↔ `.leproject`; embedded images ↔ an `assets/` folder next to the output. |
| `link <file> [--port n] [--no-open]` | Serves the app on 127.0.0.1 and opens your browser on the design, live. Ctrl+C stops. |
| `serve [dir] [--port n] [--open file] [--token t]` | The app for people at `http://127.0.0.1:<port>/` plus a JSON API for agents under `/api/<token>/` (token printed once). |
| `mcp [--root dir]` | Model Context Protocol server on stdio. Client setup: `agent-kit/mcp/README.md`. |
| `doctor` | Node version, browser, headless start, a test render, network seal. |

Every command takes `--json` (one JSON object on stdout), `--browser <path>`, `--allow-path <dir>` (also read images from this folder), `--allow-host <host>` (let the engine download images from this https host), `--transport pipe|port` and `--verbose`.

Exit codes: `0` ok · `1` invalid design, problems found or operations refused · `2` usage · `3` no browser or engine failure.

The operation list, results and error codes, the MCP tools and the API endpoints are in [`docs/AGENT-CLI.md`](../../docs/AGENT-CLI.md); the file format in [`docs/FORMAT-DESIGN.md`](../../docs/FORMAT-DESIGN.md).

## Images and files

- Image paths in a design are relative to the design file (`assets/beach.jpg`). Nothing outside the design's folder is read unless you pass `--allow-path`; `..` and symlinks that lead out are refused (reported as `refused-path`).
- `https://` images are reported (`remote-image`) and **never fetched** unless you pass `--allow-host images.example.com`. Their URLs stay in the file.
- Files are written atomically (a temporary file in the same folder, then a rename) in the normalised long form: keys in a fixed order, two-space indent, defaults left out. Applying nothing twice gives the same bytes.
- With `mcp` and `serve`, only files under the root folder can be read or written.

## Live link

`le link poster.ledesign.json` opens `http://127.0.0.1:<port>/studio/?link=…` in your browser.

- Change the file (CLI, MCP, any editor) → the tab shows the change: through agent mode when the studio has it (animated, in the activity feed, waits while paused), otherwise as one undo step. A broken file is not applied; the last good version stays and the error shows in the tab.
- Edit in the tab → the file is updated a moment later.
- After every sync: `poster.le/status.json` (`{ ok, rev, errors, warnings, conflicts, notes }`) and `poster.le/preview-<page>.png`.
- Both changed the same layer → the person's version wins; the agent's is in `status.json` → `conflicts`.
- **Notes** in the tab ("make this warmer") land in the file under `notes` for the agent.
- Closing the tab, stopping the server, deleting or atomically replacing the file, and two tabs on one file are all handled.

## How it works

- **Engine host.** Finds a browser (`--browser`, `LE_BROWSER`, the standard Chrome / Edge / Chromium / Brave locations on macOS, Windows and Linux, then Playwright's or Puppeteer's cached Chromium), serves the app from this package's own copy (`site/`, filled by `npm pack`) or from the repository checkout on `127.0.0.1` under a random path token, and launches it with `--headless=new --remote-debugging-pipe` (no debugging port at all) and a throwaway profile. It speaks the Chrome DevTools Protocol directly. The studio page is opened with `window.LE_AGENT_HEADLESS = true`, so agent mode shows no consent sheet, no animation, and saves nothing to the person's designs.
- **Network seal.** Every request that is not for our own origin and path token is failed (request interception on the page and its workers), and anything else would hit a proxy that does not exist. `--allow-host` opens exactly the hosts you name.
- **One vocabulary.** Operations go to `window.LEAgent.apply` when agent mode is present; until then a built-in adapter applies the same operations (`LE.link.applyOps` in `assets/js/le-link.js`) and normalises, validates, lints and renders with `LE.design` and `LE.Scene`.
- **Warm pages.** `serve`, `link` and `mcp` keep one page per open design; a file is reloaded only when its bytes change. A crashed browser is restarted once. The browser and its profile are removed on exit, Ctrl+C and SIGTERM.

## Speed (measured on the build machine, shared with other test runs)

| | Time |
|---|---|
| Cold start (`doctor`: launch, open the studio, render) | 1–2 s launch + 1.7–2.5 s studio, 5–8 s in total under load |
| One-shot CLI `apply` (cold browser each time) | 2–6 s |
| Warm `apply` round trip through `serve` / `mcp` | 30–150 ms |
| Warm `render` of a 1080 px page | 150–550 ms (first render with new fonts 1–3.5 s) |

Use `mcp` or `serve` when you make many changes: the engine stays warm.

## Tests

`node tests/run.js cli`, `node tests/run.js mcp`, `node tests/run.js link.test` from the repository root.
