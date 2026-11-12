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

## Areas (baseline regression suite, 1.8)

| File | Covers |
|---|---|
| `smoke.test.js` | every main page loads clean at desktop and phone size |
| `studio-core.test.js` | start screen, size presets, opening photos (chooser, drop, paste), text, elements, selection, move/resize/rotate with real pointer events, group/align/order/lock/duplicate/delete, undo/redo, clipboard, zoom, shortcuts |
| `studio-edit.test.js` | crop, flip, adjust, filters, effects, text effects, format painter, frames and grids, draw tools, templates, resize (Fill/Fit/Stretch), size history, replace-all, pages, layers panel |
| `studio-export.test.js` | PNG/JPG/WebP/PDF downloads (type and dimensions, multi-page PDF), autosave and reload, `.leproject` round trip, version history, delete |
| `studio-phone.test.js` | 390x844 and 360x740 with touch: tab bar, sheets and snapping, touch editing, tap targets, no sideways scroll |
| `studio-panels.test.js` | shallow "panel opens" checks for areas being rebuilt, plus shell regressions |
| `studio-layout.test.js` | desktop layout at 1440x900, 1366x768, 1280x720, 1280x560 |
| `shell.test.js` | studio shell (2.11): phone tabs + More, sheet snaps and scrubbing, toolbar priority/overflow, touch handles, export action, sticky actions, toasts, touch wording, coach marks, short laptops, keyboard menus and focus, contrast, object-URL caches |
| `studio-monkey.test.js` | seeded random command sequences never throw or corrupt the document |
| `site-pages.test.js` | all 31 tool/info pages: console, sideways scroll, title/h1/main |
| `themes.test.js` | dark/light, console errors, primary-button text contrast ≥ 4.5:1 (computed), theme toggle |
| `brand.test.js` | identity tokens: AA text pairs in both themes, primary contrast, focus rings, neutral editor chrome, no gold literals, icons and manifest |
| `tools.test.js` | one happy path per representative tool, PDF studio, convert-to-PDF |

`node tests/run.js <area>` runs one file (`node tests/run.js studio-phone`). `TEST_CASE="text"` narrows to cases whose name contains the text.
`TEST_JOBS=3` runs files in parallel (one browser each). `TEST_TIMEOUT=ms` changes the per-case timeout (default 90 s).

### Known failures

A case named `KNOWN-BUG: ...` is a confirmed product bug filed in `docs/QA-REPORT.md`. It still runs; the runner reports it as `known` and does not fail the run.
When the bug is fixed the case passes and the runner prints "known bug now passes" — delete the `KNOWN-BUG: ` prefix then.

### Extra harness helpers (all additive)

`h.newDesign(browser, base, vp, 'Instagram post')` (blank design from a start-screen size card), `h.openPhotoDesign(...)` ("Open a photo" start), `h.addPhoto(page, file)`,
`h.addLayers(page, [layer...])`, `h.layers`, `h.selection`, `h.select`, `h.rect/centerOf/handleBox` (screen geometry), `h.drag` (mouse) and `h.touchDrag` (CDP touch),
`h.capture(page, action)` (wait for a download, returns `{ name, buf, size }`), `h.imageInfo(buf)` (png/jpeg/webp type and size), `h.pdfRead(browser, base, buf)` (pages, page sizes, text via the site's pdf.js),
`h.openTheme(...)`, `h.inkContrast(page, selector)` (computed text/background contrast), `h.key(page, key, {ctrl, shift})`, `h.savedProjects(page)`, `h.sameDoc(a, b)`, `h.PHOTO(n)` / `h.FIXTURE(name)` fixture paths.

`tests/qa/*.js` are measurement scripts for `docs/QA-REPORT.md` (phone walk-through screenshots, load and long-task timings). They are not run by `run.js`.
