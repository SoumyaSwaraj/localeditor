# Design as code

Keep designs in a repository like source: write them with a small builder or as plain `.ledesign.json`, build pictures headlessly, review changes as a short list of layers, and let a pull request fail when a design overflows or leaves the brand.

Everything here produces or reads the **same open format** (`docs/FORMAT-DESIGN.md`). A built design is plain data: nothing in it is run when the studio opens it. The builder is a convenience for people, agents and CI, not a second format.

| Step | Command |
|---|---|
| Write | `poster.design.js` with the builder, or `poster.ledesign.json` by hand or by an agent |
| Build | `localeditor build poster.design.js -o out/` → `poster.ledesign.json` + `out/poster.png` |
| Check | `localeditor check poster.ledesign.json [--brand brand.lebrand.json]` → exit 1 on problems |
| Review | `localeditor diff old.ledesign.json new.ledesign.json [--pixels diff.png]` |
| In CI | the GitHub Action in `agent-kit/github-action/` |

Setup is the command line's (`docs/AGENT-CLI.md`): Node 20 or later and Chrome, Edge or Chromium on the machine. No other dependency.

## The builder

`tools/le-cli/lib/dsl.js`, about 150 lines, no dependencies. In a script built by `localeditor build`, `require('localeditor/dsl')` always resolves to it.

```js
const { design } = require('localeditor/dsl');

module.exports = design({ name: 'Bake sale', size: [1080, 1350], brand: 'brand.lebrand.json' })
  .page({ id: 'cover', background: '#14213D' })
    .text('Bake sale\nSaturday 10 am', { id: 'title', font: 'Anton', size: 150, color: '#FFF8EC', align: 'center', x: 'center', y: 110, w: '86%', h: 380, fit: 'shrink' })
    .image('assets/cake.jpg', { id: 'hero', x: 90, y: 540, w: 900, h: 600, radius: 32 })
    .fx({ type: 'exposure', p: { ev: 0.3 } })                 // on the layer just added
    .shape('burst', { id: 'badge', fill: '#E0B354', x: 800, y: 1010, w: 220, h: 220 })
    .icon('lucide:cake', { color: '#17131F', x: 870, y: 1080, w: 80 })
  .page({ background: '#FFF8EC' })
    .text('What we are baking', { font: 'Anton', size: 96, color: '#14213D', x: 90, y: 110, w: 900 });
```

| Call | Adds |
|---|---|
| `design({ name, size, brand, variables, … })` | The document. `size` is `[w, h]`, `"1080x1350"` or `{ width, height }` (default 1080 × 1080). Other keys go into the document as they are. |
| `.page({ id, size, background, … })` | A page; the layers that follow go on it. Without a call, the first layer starts a page. |
| `.text(text, fields)` `.image(src, fields)` `.slot(fields)` `.shape(shape, fields)` `.icon(icon, fields)` | A layer. The fields are the format's (`x: 'center'`, `w: '86%'`, `fit: 'shrink'` …). |
| `.layer({ type, … })` | Any layer the format describes (`svg`, `path`, `group`, …). |
| `.fx(entry)` / `.fx('id', entries)` | Expert effects on the layer just added, or on the layer with that id (`localeditor catalog fx`). |
| `.adjust(entries, fields)` | An adjustment layer over everything beneath it. |
| `.background(bg)` `.values(v)` `.variables(list)` `.brand(b)` `.name(n)` | Page background, template values, fields, brand, name. |
| `.use(fn, …args)` | Composition: `fn(builder, …args)` adds its layers. Shared pieces are ordinary functions. |
| `.toJSON()` / `.toString()` | The plain document / its JSON text. |

Rules it enforces, with a clear error at build time:

- **Plain data only.** A function, a class instance (a `Date`, a `Map`), a number that is not finite, or a key named `__proto__`, `constructor` or `prototype` is refused. What comes out cannot carry code.
- **Ids are unique and stable.** A layer without an id gets `<type>-<n>` in the order it was added, so the same script gives the same file and `diff` stays short. Name the layers you will talk about (`title`, `hero`).
- Everything else is checked by the reader when the design is built: unknown fields, markup in text, sizes, fonts (`localeditor check`).

A script may export one design, a list, an object of `name: design`, or a function (plain or `async`) that returns any of those. Use that for a set: one card per person from a JSON file, one size per channel.

## `localeditor build`

```bash
localeditor build poster.design.js -o out/
localeditor build cards.design.js social/*.ledesign.json -o out/ --format png,pdf --scale 2
```

- A `.js`, `.cjs` or `.mjs` source is **run with Node, at build time**, like any build script. Each design it exports is written **next to the script** as `<name>.ledesign.json` (so image paths relative to the design keep working). Commit it or ignore it, as you prefer; the file is rewritten only when it changes.
- A `.ledesign.json` source is used as it is.
- Every page is drawn into `-o` (default `out/`): `<name>.png` for one page, `<name>-0.png`, `<name>-1.png` … for several; a PDF is one file with all pages. Formats: `png`, `jpg`, `webp`, `pdf`.
- Problems are printed (and listed per design in `--json`), but `build` exits 0 when the pictures were written. Use `check` to fail.

## `localeditor check`

```bash
localeditor check social/*.ledesign.json --brand brand.lebrand.json --max-warnings 0
```

Lint and brand in one pass, several files at once, exit code 1 when any file has more problems than `--max-warnings`. `--json` gives `{ ok, files: [ { file, problems: [ { kind, layer, path, message, fix? } ] } ] }` (one file: that object directly). `lint` is another name for it. Brand problems carry a `fix` operation (`docs/FORMAT-BRAND.md`).

## `localeditor diff`

```bash
localeditor diff main.ledesign.json branch.ledesign.json --pixels out/diff.png
```

```
~ layer title: color "#17131F" → "#C0392B", x 40 → 60
- layer bar (shape)
+ layer dot (shape) on page p1
page 0: 4.21 % of the pixels differ  → out/diff.png
```

Both files are read into their normal form first, so shorthand against long form is no difference. Layers and pages are matched by id: a change is the fields that changed with their old and new values, not a wall of JSON. `--pixels` draws both and writes a picture per page (the longer side at most 1024 px) with the differing pixels marked on a faded copy of the second design. `--json` adds `summary`, `changes` and `ops`, the operation list that turns the first into the second. Exit 0 when the same, 1 when not, like `diff`.

With Git: `git show main:poster.ledesign.json > /tmp/old.ledesign.json && localeditor diff /tmp/old.ledesign.json poster.ledesign.json`.

## The GitHub Action

`agent-kit/github-action/` is a composite action: on a pull request it builds the designs that changed, runs the check, uploads the pictures as an artifact and writes a job summary with the picture names, the problems and what changed. It uses `actions/setup-node` and `actions/upload-artifact` only (your workflow adds `actions/checkout`), needs no secrets, and runs design scripts only when you list them in `scripts`. Inputs and notes: `agent-kit/github-action/README.md`. A ready workflow: `examples/github/design-check.yml`.

## Examples

- `examples/code/bake-sale.design.js` — two pages, a shared footer function, a brand next to it.
- `examples/brand/brand.lebrand.json` — a full brand file.
- `examples/github/design-check.yml` — the workflow.

## For agents

Prefer editing the `.ledesign.json` with operations (`localeditor apply`, MCP `design_apply`) when a person is watching or the change is small. Write a `.design.js` when the design is a family (sizes, languages, one per row of data) or when the repository already builds its assets. Either way finish with `localeditor check` and look at the render.
