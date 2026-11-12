# LocalEditor

Static, offline-first PWA: photo studio, PDF studio, 30 tools. Vanilla ES2018 IIFEs, no bundler. Hosted on S3 behind CloudFront.

Read before changing anything:

1. `docs/ROADMAP.md` — goals, architecture decisions, phases, working rules.
2. `docs/HANDOFF.md` — hard rules (security, licences, caching) and what is already built.

Run: `python3 -m http.server 8765 --bind 127.0.0.1` from the repo root, then open `/studio/`.
Test: `node tests/run.js` (Playwright is preinstalled; see `tests/README.md`).
Build: `node scripts/build.js` regenerates `sw.js`, manifest, sitemap. Do not commit `sw.js` or `sitemap.xml` from a feature branch.
