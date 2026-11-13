# LocalEditor — instructions for coding agents (Codex, OpenCode and others)

When asked to make or change a graphic with LocalEditor (a post, thumbnail, poster, slide, carousel, or a `.ledesign.json` file):

- **Person watching, browser available:** open `/studio/?agent=1` (hosted: `https://localeditor.net/studio/?agent=1`; local: run `python3 -m http.server 8765 --bind 127.0.0.1` in the LocalEditor repo and open `http://127.0.0.1:8765/studio/?agent=1`). The person turns agent mode on. Drive `window.LEAgent` (JavaScript), or the **Console** tab ("Agent command" textbox, **Run**, read "Agent result") if you can only click and type, or an `#ops=` link (`LEAgent.toLink`) if you can only open URLs.
- **Nobody watching:** use the headless CLI / MCP server (same operations, no animation), or write a `.ledesign.json` file directly (`docs/FORMAT-DESIGN.md`).

Loop: `begin({ name, task })` → `state({ image: true })` → small labelled `apply([...])` batches → `check()` and apply its `fix` operations → handle `pending.notes` with `resolveNote(id, reply)` → `end({ summary })`. `LEAgent.help()` lists every operation.

Rules: readable layer ids; shorthand positions (`"center"`, `"86%"`); `"fit": "shrink"` for headlines in a fixed box; search `catalog()` for fonts, icons, makers, collage layouts and recipes; images as `data:` URIs or `slot: true`; no HTML or script in text; never click the person's Allow / Pause / Stop / Take over buttons. On `conflict` re-read `state()`, on `interrupted` re-plan, on `paused` wait for resume, on `no-session` ask in chat.

Photo grading and effects (non-destructive, any layer): `analyze("hero")` for the numbers, `catalog("fx")` for what exists and `catalog("fx", "<id>")` for one effect's parameters, then `{ "op": "fx.add", "layer": "hero", "entry": { "type": "exposure", "p": { "ev": 0.4 } } }`, `fx.update`, `fx.remove`, `fx.reorder`, `mask.set`, `adjust.add`, `transform.set`. On the command line: `localeditor catalog fx`, the same operations in `localeditor apply`. One-call helpers: `{ "op": "fx.call", "layer": "product", "name": "composite.stage", "args": { "preset": "soft-table-reflection" } }` (`catalog("fx", "actions")` lists them). In the studio only: `map.generate` (depth, faces, segments), `raw.open`, `hdr.merge`, `raw.settings`, `raw.autoTone`.

Full guide: `docs/AGENT-GUIDE.md`.
