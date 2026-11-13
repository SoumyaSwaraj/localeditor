# LocalEditor agent kit

Drop-in instructions so your coding agent can make and edit LocalEditor designs while you watch them change in your browser. Each file is short and points to `docs/AGENT-GUIDE.md`.

| Agent | Add it in one step (from your project folder) |
|---|---|
| Claude Code | `mkdir -p .claude/skills/localeditor && cp agent-kit/claude/SKILL.md .claude/skills/localeditor/SKILL.md` |
| Codex, OpenCode, Aider and others that read `AGENTS.md` | `cp agent-kit/AGENTS.md AGENTS.md` (or paste it into your existing `AGENTS.md`) |
| Cursor | `mkdir -p .cursor/rules && cp agent-kit/cursor/localeditor.mdc .cursor/rules/` |
| Antigravity, Gemini CLI | `cp agent-kit/gemini/GEMINI.md GEMINI.md` (or add it to your rules) |

| GitHub Action | `agent-kit/github-action/`: on pull requests, builds the designs that changed, checks them and uploads previews. Copy `examples/github/design-check.yml` to `.github/workflows/`. |

Two more things an agent should know: a **brand file** (`brand.lebrand.json`, `docs/FORMAT-BRAND.md`) that every design is checked against, and **design as code** (`docs/DESIGN-AS-CODE.md`): a small builder, `localeditor build`, `diff` and `check`.

Then ask your agent something like "make a launch post for this repo in LocalEditor". It opens `/studio/?agent=1`; you tap **Turn on agent mode** and watch. You can pause, stop, take over, undo any single change, and pin notes ("make this warmer") at any time. Nothing is uploaded.

To run the studio locally: `python3 -m http.server 8765 --bind 127.0.0.1` in this repository, then open `http://127.0.0.1:8765/studio/?agent=1`.
