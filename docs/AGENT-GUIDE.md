# Agent guide: editing LocalEditor designs live

For coding agents (Claude Code, Cursor, Codex, OpenCode, Antigravity and others) that drive a browser. Read this once; then `LEAgent.help()` inside the page is enough.

LocalEditor is a private, offline design studio. A design is pages of layers with readable ids. You change it with **batches of operations** through `window.LEAgent`. Each batch is checked by the same safety gate as a design file, applied completely or not at all, and becomes **one undo step**. A person is usually watching the same tab: they see each change happen, can pause, stop, take over, undo any single change, edit at the same time and leave you notes.

There are two speeds with one vocabulary:

- **Browser mode** (this guide): you and the person collaborate in an open studio tab.
- **Headless mode** (CLI / MCP / local API, `tools/le-cli/`): the same operations run in a headless browser with no animation and no consent sheet. Use it when nobody needs to watch.

## 1. Open the studio

| Where | URL |
|---|---|
| Hosted | `https://localeditor.net/studio/?agent=1` |
| Local copy | in the repository: `python3 -m http.server 8765 --bind 127.0.0.1`, then `http://127.0.0.1:8765/studio/?agent=1` |
| Installed app | open LocalEditor, then File → Agent mode… |

`?agent=1` shows the person a one-time explanation ("An assistant can now change this design. You can pause or take over at any time. Nothing is uploaded.") with **Turn on agent mode**. `?agent=console` does the same and opens the typed console. Without it, your first `LEAgent.begin()` asks the person in a sheet. **Never click Allow, Turn on, Pause, Stop or Take over yourself.** Those buttons belong to the person; ask in chat.

## 2. Which channel do you have?

| You can… | Use |
|---|---|
| evaluate JavaScript in the page (Playwright `evaluate`, DevTools MCP, Cursor's browser, Claude in Chrome) | **JavaScript**: `await window.LEAgent.state()` … every method returns a Promise of plain JSON |
| only click, type and read text or the accessibility tree | **Console**: the panel "Agent activity" → tab **Console** → textbox labelled **Agent command** → button **Run** → read the region labelled **Agent result** (inside a `role="log"`) |
| only open URLs and take screenshots | **Link**: `/studio/?agent=1#ops=<payload>` — the person sees what will change and must press **Apply changes** |

Check with `typeof window.LEAgent` (JavaScript) or by looking for the textbox "Agent command".

A console command is one JSON object: `{"op":"help"}`, `{"op":"begin","name":"Codex","task":"…"}`, `{"op":"state"}`, `{"op":"apply","ops":[…],"label":"…"}`, `{"op":"check"}`, `{"op":"notes"}`, `{"op":"resolveNote","id":"…","reply":"…"}`, `{"op":"end","summary":"…"}`. A single operation (`{"op":"update",…}`) also works. The result printed is exactly what the JavaScript call returns.

A link payload is `z` + base64url(deflate-raw(JSON)) or `j` + base64url(JSON), where JSON is `{ "name", "task", "label", "ops": [ … ] }`. `LEAgent.toLink(ops, { name, task })` builds one.

## 3. The happy path

```js
await LEAgent.begin({ name: 'Claude', task: 'Launch post for the repo' });       // the person is asked once
let s = await LEAgent.state({ image: true });                                     // design (open format), problems, notes, rev, a PNG
await LEAgent.apply([
  { op: 'page.background', background: '#14213D' },
  { op: 'add', layer: { id: 'title', type: 'text', text: 'v2 is here', font: 'Anton', size: 180, color: '#FFFFFF',
                        x: 'center', y: 120, w: '86%', h: 320, fit: 'shrink', align: 'center' } }
], { label: 'Background and headline' });
await LEAgent.apply([{ op: 'add', layer: { id: 'hero', type: 'image', slot: true, x: 'center', y: 480, w: '80%', h: 420, radius: 24 } }], { label: 'Photo slot' });
const c = await LEAgent.check();                                                  // problems with ready-made fixes
if (!c.clean) await LEAgent.apply(c.problems.map(p => p.fix).filter(Boolean), { label: 'Fix problems' });
s = await LEAgent.state({ image: true });                                         // look once before you finish
for (const n of s.notes) await LEAgent.resolveNote(n.id, 'Done: …');              // answer the person's notes
await LEAgent.end({ summary: 'Made a launch post with a photo slot' });
```

Every response carries `rev`, `paused` and `pending: { notes, openNotes, interrupted, results, changes }`. Read `pending` every time: it is how a console or link agent learns about notes, Stop, queued results and the person's edits.

## 4. Methods

| Call | Returns / does |
|---|---|
| `help()` | Every method, operation, layer field, error code and rule. |
| `begin({ name, task, wait? })` | Starts a visible session. First time: the person is asked (waits up to `wait` ms, default 120 000; unanswered → `code: "consent"`, `consentPending: true`; call again). |
| `end({ summary })` | Ends the session; the person sees the summary. |
| `state({ image? })` | `{ design, page, pages, selection, fonts, problems, notes, session, speed, queued, rev, paused, image? }`. `design` is the open format, long form, images by asset id. `image: true` (512 px) or a number (max edge). |
| `apply(ops, { label, ifRev, partial, whenPaused, wait })` | One batch, one undo step. `{ ok, applied, errors: [{ op, path, code, message }], summary, changed, problems, warnings, rev }`. |
| `find(query)` | `"the title"`, `"all photos"`, `"photo slots"`, `"background"`, a word, or `{ id, name, type, text, page }`. |
| `catalog(kind, q, { offset, limit })` | `fonts`, `icons` (needs `q`), `shapes`, `recipes`, `makers`, `collages` (`q` = a photo count → layouts; a style id → its templates), `sizes`, `patterns`, `filters`. Paged: `{ items, total, next }`. |
| `catalog("fx", q)` | Expert effects. No `q`: a paged index `{ id, name, group, section, summary }`. `q` = an effect id: that effect in full (`effect.params` with ranges and defaults, `effect.agent.tips`, `effect.agent.example`). `"schema"`: blends, mask kinds, limits. `"actions"`: auto and import/export helpers. Any other word searches. Returns a promise (the renderer loads on first use). |
| `analyze(target?, { region, kinds })` | Numbers to grade by, for the page or one layer (id or name): histogram and percentiles, clipping, a white-balance estimate with a suggested temperature and tint, saturation, sharpness, dominant hues. `{ ok, target, stats }`. |
| `check()` | `{ clean, problems: [{ page, layer, kind, message, fix }] }`. Kinds: `overflow`, `clipped`, `off-page`, `low-contrast`, `missing-image`, `unknown-font`. |
| `export({ format, scale, download })` | `png`/`jpeg`/`webp`/`pdf` as a data URL, or the person's normal download with `download: true`. |
| `notes({ status })`, `resolveNote(id, reply)` | The person's notes; mark one done with a short reply. |
| `on(event, fn)` | `note`, `notes`, `note-resolved`, `person-edit`, `change`, `pause`, `resume`, `stop`, `session`, `batch`, `feed`, `queue`, `undo`. Returns an unsubscribe function. |
| `result(batchId)` | The outcome of a batch that was queued. |
| `load(design, { resolve })`, `save({ images })` | Replace the whole document from an open-format file (one undo step) / write it out: `{ text, assets: [{ path, dataUrl }] }`. |
| `applyExternal(docOrOps, { source, name, label })` | For the live link and local bridges: a design or ops from outside, shown in the feed like any batch, obeying Pause and Stop. No session needed. |
| `toLink(ops, { name, task })` | An `#ops=` link. |

## 5. Operations

Every operation is `{ "op": "<name>", … }`. Layers are addressed by `id` (a unique `name` also works). `page` is a number from 0 or a page id; it defaults to the current page.

| op | Example | Notes |
|---|---|---|
| `add` | `{ "op": "add", "layer": { "id": "badge", "type": "shape", "shape": "ellipse", "fill": "#E0B354", "x": 820, "y": 60, "w": 200, "h": 200 } }` | `layers: [ … ]` for several (back to front, members of a new group may reference it). `at`: `front` (default), `back`, an index, `{ "above": id }`, `{ "below": id }`. |
| `update` | `{ "op": "update", "id": "title", "set": { "color": "#FFF3E2", "y": "center" } }` | `ids` for several. Shorthand allowed. `null` removes a field. `h: "auto"` re-measures text. Ids and types never change. |
| `remove` | `{ "op": "remove", "ids": ["old-logo"] }` | A group takes its members with it. |
| `reorder` | `{ "op": "reorder", "id": "badge", "to": "front" }` | `front back forward backward`, an index, `{ above }`, `{ below }`. |
| `group` / `ungroup` | `{ "op": "group", "ids": ["badge", "badge-text"], "groupId": "badge-group" }` | |
| `align` | `{ "op": "align", "ids": ["title"], "edge": "center", "relativeTo": "page" }` | `left center right top middle bottom`; `page` or `selection`. |
| `distribute` | `{ "op": "distribute", "ids": ["a", "b", "c"], "axis": "h" }` | 3 or more. |
| `select` | `{ "op": "select", "ids": ["title"] }` | Shows the person what you mean. |
| `page.add` | `{ "op": "page.add", "id": "slide-2", "width": 1080, "height": 1350, "background": "#FFFFFF", "layers": [] }` | Or `{ "duplicate": 0 }`. The new page becomes current. |
| `page.remove` / `page.select` | `{ "op": "page.remove", "page": 1 }` | |
| `page.resize` | `{ "op": "page.resize", "width": 1080, "height": 1920, "scaleContent": true }` | |
| `page.background` | `{ "op": "page.background", "background": { "type": "gradient", "kind": "linear", "colors": ["#14213D", "#2F6BFF"], "angle": 90 } }` | Colour, gradient, `{ "type": "pattern", "id": "dots", "fg", "bg" }`, or a photo. |
| `replace` | `{ "op": "replace", "design": { "format": "localeditor-design", "version": 1, "pages": [ … ] } }` | The whole document; with `page`, only that page from `design.pages[0]`. |
| `make` | `{ "op": "make", "maker": "quote", "style": "editorial", "size": "square", "values": { "quote": "…", "author": "…" } }` | A finished, editable page from a quick maker (`catalog("makers")`). Replaces the page, or `newPage: true`. |
| `recipe` | `{ "op": "recipe", "id": "hero", "recipe": "golden-hour", "strength": 80 }` | `recipe: null` removes it. |
| `collage` | `{ "op": "collage", "layout": "r-2.3", "count": 5, "spacing": 16, "margin": 40, "radius": 18 }` | Lays out the page's photo slots, or creates `count` of them. Or `template`. |
| `text.replace` | `{ "op": "text.replace", "find": "2025", "replace": "2026", "page": "all" }` | Plain text, case-insensitive unless `matchCase`. |
| `image.fill` | `{ "op": "image.fill", "id": "hero", "src": "data:image/jpeg;base64,…" }` | `src`: a `data:image/…` URI (best); an `https://` URL (the person is asked, naming the host); a relative path (the person picks the file). |
| `rename` | `{ "op": "rename", "name": "Launch post" }` | |
| `fx.add` | `{ "op": "fx.add", "layer": "hero", "entry": { "type": "exposure", "p": { "ev": 0.4 } } }` | Adds an effect to the layer's stack (`index` optional; the first entry runs first). Types and parameters: `catalog("fx")`. The result carries the new entry `id`. |
| `fx.update` | `{ "op": "fx.update", "layer": "hero", "id": "exposure", "p": { "ev": 0.2 }, "amount": 0.8 }` | `id` is the entry id, or its type when the layer has one of that kind. `p` is merged; `on`, `amount` (0–1), `blend`, `mask` can be set. |
| `fx.remove` / `fx.reorder` | `{ "op": "fx.reorder", "layer": "hero", "id": "grain", "index": 0 }` | |
| `mask.set` | `{ "op": "mask.set", "layer": "hero", "fx": "gaussian-blur", "mask": { "parts": [{ "kind": "radial", "cx": 0.5, "cy": 0.4, "rx": 0.3, "ry": 0.3, "feather": 0.5, "invert": true }] } }` | Limits one effect to an area; without `fx` it is the layer's own mask. `mask: null` clears. Kinds: `catalog("fx", "schema")`. |
| `adjust.add` | `{ "op": "adjust.add", "fx": [{ "type": "contrast", "p": { "amount": 15 } }], "name": "Grade", "above": "hero" }` | An adjustment layer: its stack applies to everything beneath it (`clip: true`: only the layer below; `x y w h` for part of the page). |
| `transform.set` | `{ "op": "transform.set", "layer": "hero", "quad": [[0, 40], [1000, 0], [1000, 800], [0, 760]] }` | Perspective: four corners in page units, clockwise from top left. `quad: null` clears. |

Layer fields are the open design format: `docs/FORMAT-DESIGN.md` (and `schema/design-1.json`). In short: `x`/`y` take numbers, `"50%"`, `left`/`center`/`right` (`top`/`center`/`bottom`); `w`/`h` take numbers or percentages; text takes `font weight size color align lineHeight letterSpacing uppercase stroke background fit:"shrink"`; images take `src` or `slot: true`, `radius border mask adjust filter recipe`; shapes take `shape fill stroke radius`; icons are `{ "type": "icon", "icon": "lucide:sun" }`.

### Expert effects

Effects are non-destructive: the picture is never changed, the layer carries a list (`fx`) that is drawn each time. They work on any layer and export at full size.

1. `analyze("hero")` first: it tells you what is wrong (clipped highlights, a colour cast, flat contrast) in numbers.
2. `catalog("fx")` for what exists; `catalog("fx", "<id>")` before you use an effect, for its parameter names and ranges. Unknown parameters are ignored with a warning, values are clamped.
3. Apply a few entries in one batch, in the order a photographer works: white balance, exposure, contrast and tone, colour, then detail and effects. One batch is one undo step for the person.
4. `state({ image: true })` to look, then `fx.update` by type (`"id": "exposure"`) to refine. Prefer changing an entry to stacking a second one of the same kind.
5. Limit an effect to an area with `mask.set` (linear and radial gradients, luminance and colour ranges, the subject, a face area when the photo has a face map).

Limits: 32 entries per layer, 8 mask parts. Effect names in a design made elsewhere that this copy does not know are kept and skipped, never dropped.

### Errors

Every failure has a stable `code` and, per operation, a JSON pointer `path` (`/ops/2/set/opacity`) and a message you can act on.

| code | Meaning and what to do |
|---|---|
| `invalid` | Wrong input. Fix what the message says. Nothing changed (unless `partial: true`). |
| `conflict` | The person changed, deleted or undid what you targeted, or your `ifRev` is stale. `errors[].layer` names it; `changes` lists what changed. Read `state()` and re-plan; never re-send blindly. |
| `interrupted` | The person pressed **Stop**. Queued batches were cancelled. The response carries a fresh `state`; re-plan from it. |
| `paused` | You are paused (or the person is editing). The batch is queued (`queued: true`, `batch`), or refused with `whenPaused: "reject"`. |
| `no-session` | Call `begin` (again). `reason`: `none`, `taken-over`, `off`, `reload`, `ended`. |
| `consent` | The person has not allowed it (agent mode, an image host, a file). Ask in chat. |
| `unsupported` | Not available here (remote images in headless mode, a missing module). |
| `too-large` | Over a limit (200 ops or 12 MB per batch, 50 pages, 20 MB export data URL). |

## 6. Design advice that prevents the usual failures

1. **Use ids.** Give every layer a short readable id (`title`, `hero-photo`, `cta`). Later requests ("make the title bigger") map straight to them.
2. **Prefer shorthand positions** (`"x": "center"`, `"w": "86%"`, `"y": "bottom"`) to guessed pixels. Read `state().pages[n].width/height` first.
3. **Let text fit.** Give headlines a fixed box (`w`, `h`) and `"fit": "shrink"`. Leave `h` out for body text so it is measured.
4. **Check contrast.** `check()` flags text under 4.5:1 (3:1 when ≥ 24 px) against solid colours behind it. Over photos, add a dark shape behind the text.
5. **Never guess fonts or icon ids.** `catalog("fonts", "serif")`, `catalog("icons", "rocket")`. Unknown fonts fall back and are reported.
6. **Use makers and collage layouts** instead of hand-placing everything: `catalog("makers")`, `catalog("collages", "4")`.
7. **Photos:** use empty `slot: true` frames when you have no image; the person fills them. Pass images as `data:` URIs; remote URLs interrupt the person with a question.
8. **Look before you finish**: `state({ image: true })` returns a PNG of the page.

## 7. Working with a watching person

- **Announce** the task in `begin({ task })`. It is shown in the banner.
- **Small batches with a label each** ("Background and headline", "Photo slot", "Fix contrast"). Each becomes one line in the activity feed with its own **Undo this change**.
- **Speed is the person's choice** (Watch slowly / Normal / Instant). In the browser `apply()` resolves after the change has been shown, so slow pacing slows you down on purpose.
- **Read notes.** The person pins notes to a layer or a spot, or types one in the banner ("Tell the assistant what to change"). They arrive in `pending.notes` on your next call, in `notes()`, and as `on("note")`. Do what they ask, then `resolveNote(id, "short reply")`.
- **End with a summary** of what you did and what is left (e.g. "Add your photo to the empty slot").

## 8. Working with a person who interrupts

The person will not wait politely. These are the rules the studio enforces, and how to react.

1. **They start editing while your batch is queued or being shown** (drag, type, change a slider, switch page): you are **auto-paused at the next safe point**. The banner says "You're editing — <you> is waiting" with **Resume**. No operation ever lands inside their gesture: a batch that arrives while they are mid-gesture waits until they let go. Your call returns promptly with `queued: true, paused: true, code: "paused", reason: "person-editing"`.
2. **Batches are atomic.** A batch is fully applied or not at all. The animation is presentation only: the data is committed first, in one step, and an interruption simply ends the animation on the committed values. Interruption takes effect between batches, or cancels a batch before it commits.
3. **Stop** (not Pause) cancels everything queued. Pending and next calls resolve with `{ ok: false, code: "interrupted", reason: "The person stopped the session", state }`. Re-plan from that state; the session continues.
4. **They edit or delete what you target, or undo one of your steps** while later batches are queued: each batch is re-validated against the document when it runs. Operations that no longer apply are rejected one by one with `code: "conflict"`, naming the layer and what changed ("The person moved “badge” (rev 7) after you last read the design"). The batch is then refused, or with `partial: true` the rest proceeds. `rev` moves on every person edit; `ifRev` refusals return `changes` since that rev.
5. **"Not like that":** the person can tap **Undo last change and pause**, or type a quick note in the banner. Both reach you immediately: `pending.notes` / `on("note")`, and `paused: true`. Read the note, then wait for Resume.
6. **Take over, turning agent mode off, closing the tab, reloading or a crash:** nothing committed is lost (it is in the undo history and autosaved). The session ends; your next call gets `code: "no-session"` with a `reason` and the current `rev`. Open notes persist. Call `begin` again only if the person wants you to continue; they will be asked.
7. **Long pauses:** your calls return `paused: true` promptly instead of hanging. Poll, or listen:

```js
// JavaScript channel
if ((await LEAgent.state()).paused) await new Promise(r => { const off = LEAgent.on('resume', () => { off(); r(); }); });
// Console or link channel: run {"op":"state"} every 10–30 s and continue when "paused" is false.
// Results of batches that were queued arrive in pending.results, or ask {"op":"result","batch":"<id>"}.
```

## 9. Safety rules

- No HTML, script, event handlers or `javascript:` in any string; such batches are refused.
- Images from the web need the person's consent per host; nothing is fetched otherwise. Headless mode never fetches them.
- The API sees only the open design: no stock API keys, no other saved designs, no files except the ones the person picks.
- Your edits never silently overwrite the person's; their edits always win.

## 10. Headless mode (CLI, MCP, local API)

Set `window.LE_AGENT_HEADLESS = true` before the studio scripts load (the CLI injects it). Then `begin` needs no consent, nothing is drawn or animated, pacing is instant, and nothing is written to the person's saved designs (autosave is off: `LEStudio.S.noSave`). Load and save documents yourself:

```js
await LEAgent.load(designObjectOrText);                 // replaces the document, returns state
await LEAgent.apply([...]);                             // same operations, same results
const { text, assets } = await LEAgent.save({ images: 'paths' });   // assets: [{ path, dataUrl }]
```

Results are plain JSON (images as data URLs), safe to pass across a process boundary.

## 11. Testing it yourself

`node tests/run.js agent` runs the API, console, link and interruption tests. `node tools/agent-demo/run.js` plays an agent through every channel and saves screenshots of the watching experience.
