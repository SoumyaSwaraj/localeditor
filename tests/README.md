# Tests

Browser tests on the real pages. Playwright and Chromium are preinstalled in the build environment; nothing to install.

```bash
node tests/run.js            # everything
node tests/run.js collage    # files whose name contains "collage"
```

A test file is `tests/<area>.test.js` exporting an object of `name: async ({ browser, base, h }) => {}`. `h` is `tests/lib/harness.js`:

- `h.open(browser, base, url, 'desktop' | 'phone' | 'small')` — a page with service workers blocked; console errors collect in `page.errors`.
- `h.studioWithSample(browser, base, viewport)` — the studio with the sample scene loaded. `window.LEStudio` is the studio context (`scene`, `openPanel`, `cmd`, ...).
- `h.openPanel(page, id, opts)`, `h.doc(page)`, `h.noOverflow(page)`.
- `h.assert(cond, msg)`, `h.assert.equal(a, b)`, `h.assert.noErrors(page)`.

Stock APIs and other outside hosts are not reachable from the sandbox. Mock them with `page.route(...)`.

Prefer asserting on the scene document (`h.doc(page)`) over pixels. Test at desktop and phone sizes.
