---
name: localeditor
description: Make or edit graphics (posts, thumbnails, posters, slides, carousels) in the LocalEditor studio while the person watches live in their browser. Use when asked to design, change or fix a LocalEditor design, a .ledesign.json file, or anything at /studio/.
---

# LocalEditor designs, live in the browser

LocalEditor is a private, offline design studio. You edit the open design through `window.LEAgent` in the person's browser tab; they watch each change happen and can pause, stop, take over, undo any change and leave you notes.

Full guide: `docs/AGENT-GUIDE.md` (in the repository) or `https://localeditor.net/docs/AGENT-GUIDE.md`. Inside the page, `LEAgent.help()` lists every method and operation.

## Steps

1. Open `/studio/?agent=1` (local: `python3 -m http.server 8765 --bind 127.0.0.1` in the repo, then `http://127.0.0.1:8765/studio/?agent=1`). Ask the person to tap **Turn on agent mode**. Never click consent, Pause, Stop or Take over yourself.
2. Pick your channel: if you can evaluate JavaScript, call `window.LEAgent`; if you can only click and type, use the **Console** tab ("Agent command" → **Run** → read "Agent result"); if you can only open URLs, build an `#ops=` link with `LEAgent.toLink` and let the person confirm.
3. `begin({ name: 'Claude', task })` → `state({ image: true })` → small labelled `apply([...])` batches → `check()` and apply the suggested fixes → read `pending.notes`, do them, `resolveNote(id, reply)` → `end({ summary })`.
4. If nobody needs to watch, use the headless CLI / MCP instead (same operations, instant).

## Rules

- Give every layer a short readable `id`; address layers by id.
- Prefer shorthand: `"x": "center"`, `"w": "86%"`, `"fit": "shrink"` on headlines with a fixed `h`.
- Search `catalog('fonts' | 'icons' | 'makers' | 'collages' | 'recipes', q)`; never guess names.
- Images as `data:` URIs or empty `slot: true` frames. Web URLs make the person approve the host.
- No HTML or script in text. Batches are atomic: on `code: "conflict"` re-read `state()`; on `"interrupted"` re-plan; on `paused: true` wait for resume; on `"no-session"` stop and ask in chat.
- Read `pending` on every response (notes, interruptions, the person's edits). The person's edits always win.
