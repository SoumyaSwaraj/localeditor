# LocalEditor rules (Antigravity, Gemini CLI and Gemini-style agents)

Use these when the task is to make or change a graphic with LocalEditor, or a `*.ledesign.json` file.

1. With a browser and a person watching: open `/studio/?agent=1` (hosted at `https://localeditor.net/studio/?agent=1`, or locally after `python3 -m http.server 8765 --bind 127.0.0.1` in the repo). The person turns agent mode on; do not click their buttons (Allow, Pause, Stop, Take over).
2. Channel: `window.LEAgent` if you can evaluate JavaScript; otherwise the **Console** tab ("Agent command", **Run**, "Agent result"); otherwise an `#ops=` link the person confirms.
3. Loop: `begin({ name: 'Gemini', task })`, `state({ image: true })`, small labelled `apply([...])` batches, `check()` and its fixes, answer `pending.notes` with `resolveNote`, `end({ summary })`.
4. Without a browser: the headless CLI / MCP (same operations), or write `.ledesign.json` by `docs/FORMAT-DESIGN.md`.
5. Rules: readable ids; shorthand positions; `"fit": "shrink"`; search `catalog()` for fonts, icons, makers and layouts; images as `data:` URIs or `slot: true`; no HTML or script; on `conflict` re-read, on `interrupted` re-plan, on `paused` wait, on `no-session` ask.

Full guide: `docs/AGENT-GUIDE.md`. In the page: `LEAgent.help()`.
