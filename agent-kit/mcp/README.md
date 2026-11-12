# LocalEditor MCP server: client setup

`localeditor mcp` is a Model Context Protocol server on stdio. It gives an agent tools to create, change, check and look at LocalEditor designs (`.ledesign.json`), using the real editor in a headless Chrome, Edge or Chromium. It only reads and writes files under the folder it is started in (or `--root`), and the engine cannot reach the network.

Needs: Node 20+, and Chrome, Edge, Chromium or Brave (or set `LE_BROWSER` to the browser's path). Check with `npx localeditor doctor` (published package) or `node tools/le-cli/bin/localeditor.js doctor` (checkout).

Every snippet below uses `npx -y localeditor mcp`, which needs the npm package to be published (it is not yet, and the package name still has to be secured). Until then, and from a checkout of this repository, use `node` with the absolute path of `tools/le-cli/bin/localeditor.js` instead, as in `claude-code.mcp.json`'s second entry.

| Client | File here | Where it goes |
|---|---|---|
| Claude Code | `claude-code.mcp.json` | `.mcp.json` in the project root, or run the command below |
| Cursor | `cursor.mcp.json` | `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json`) |
| Codex CLI | `codex.config.toml` | append to `~/.codex/config.toml` |
| OpenCode | `opencode.json` | `opencode.json` in the project root (merge the `mcp` key) |
| Gemini CLI / Antigravity | `gemini.settings.json` | `.gemini/settings.json` in the project (merge `mcpServers`) |

Claude Code, one command:

```bash
claude mcp add localeditor -- npx -y localeditor mcp
# from a checkout:
claude mcp add localeditor -- node /absolute/path/to/localeditor/tools/le-cli/bin/localeditor.js mcp
```

Tools: `design_new`, `design_read`, `design_apply`, `design_check`, `design_render` (returns an image), `design_find`, `catalog_search`, `design_make`, `design_validate`, `design_link_status`, `notes_read`, `notes_resolve`. Resources: the format guide, the agent guide, the JSON Schema, ten examples. Prompts: `design_from_brief`, `fix_problems`. How to use them well: `docs/AGENT-CLI.md`.

Options (append after `mcp`): `--root <dir>` (default: the folder the client starts the server in), `--browser <path>`, `--allow-path <dir>` (extra image folder), `--allow-host <host>` (let the engine download images from that https host; default none).

## Status of these snippets

Tested here: the official MCP TypeScript SDK client (`@modelcontextprotocol/sdk` 1.32) over stdio, and the repository's own protocol tests. **Not tested here** (none of these clients can run in the build sandbox): Claude Code, Cursor, Codex, OpenCode, Gemini CLI, Antigravity. The file formats follow each client's documentation as of late 2026; if a client changed its format, its own docs win. To try one:

1. `node tools/le-cli/bin/localeditor.js doctor` → all checks `ok`.
2. Put the snippet in place, restart the client, and list its MCP servers (Claude Code: `/mcp`; Cursor: Settings → MCP; Codex: `codex mcp list`; Gemini CLI: `/mcp`).
3. Ask: "Use localeditor to make a 1080×1350 poster for a bake sale in poster.ledesign.json, check it and show me a render."
4. You should see `design_new`, `design_apply`, `design_check` and `design_render` calls and a picture of the poster.
