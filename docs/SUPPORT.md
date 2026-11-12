# Device support checks (`LE.support`)

Roadmap item S1. Files: `assets/js/le-support.js`, `assets/css/le-support.css`, `device-check/index.html`, `tests/support.test.js`. Loaded on every page by the loader at the end of `assets/js/app.js`, next to `le-pwa.js`.

The owner's rule: **ambiguity never blocks.** The app says what may not work and why, suggests a browser that would do more when one exists on the person's system, and offers "Try anyway" unless an API is definitely missing with no fallback.

## Declaring a feature

Push a definition from your own module. It works whether `le-support.js` has loaded yet or not:

```js
(window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || []).push({
  id: 'cutout.detailed',          // stable id, letters, digits, . _ -
  name: 'Detailed cut-out',       // shown to people
  group: 'On-device AI',          // Photo studio | PDF studio | Sharing | Offline and install | On-device AI | Tools
  needs: ['wasm', 'wasm-simd', 'worker', 'offscreen-canvas'],  // missing any => not available
  wants: ['cache-storage'],       // missing any => works, with limits
  memoryMB: 1000,                 // peak extra memory, estimate
  downloadMB: 44,                 // first-use download, if any
  note: 'Better on hair and busy scenes.',
  degraded: 'Uses the Fast model instead.'   // optional: a fallback exists, so "Try anyway" is always offered
});
```

`LE.support.define(def)` does the same once the module is loaded. Your definition replaces a built-in one with the same id; a built-in one never replaces yours. Short group aliases work (`ai`, `pdf`, `photo`, `share`, `offline`, `tools`).

Then, where the person starts the feature:

```js
var start = function () { return runCutout(); };
(window.LE && LE.support ? LE.support.gate('cutout.detailed', { title: 'Detailed cut-out', run: start, onCancel: function () {} }) : start());
// when it really produced its result:
LE.support && LE.support.reportSuccess('cutout.detailed');
// when it failed (gate() already records a run that throws or rejects):
LE.support && LE.support.reportFailure('cutout.detailed', err);
```

A feature with its own way round passes it as `fallback`; the sheet shows it as an action (the primary one when the feature cannot run here) and `gate()` resolves with its result:

```js
LE.support.gate('export.share', { title: 'Share', run: share, fallback: { label: 'Download instead', run: download } });
```

`gate()` records a thrown or rejected run as a failure on this device, except errors that say nothing about the device: `AbortError` (or `err.cancelled`), and `err.code` of `cancelled`, `offline`, `download`, `network`, `unsupported`, `quota` (no free space), `consent` or `declined`. An error can also say `err.deviceFailure = true | false`. Run the feature inside `gate()` (do not swallow its errors first) so failures are recorded; call `reportSuccess` when it really produced its result.

Or mark a control and let the module handle it: `<button data-le-feature="export.copy" data-le-badge>`. `annotate()` runs on load and when such elements are added: it sets `data-le-support="ok|limited|unknown|unsupported"`, adds an `aria-describedby` explanation, appends a badge when `data-le-badge` is present, and turns a tap on an unavailable control into the explanation sheet (opt out with `data-le-gate="off"`). Controls are never hidden.

## API

| Call | Returns |
|---|---|
| `has(cap)` | `true`, `false` or `null` (cannot tell). Cached, except `live` capabilities (cheap tests of globals that can change after load: share, clipboard, recording, camera, file pickers, eyedropper, install prompt, display mode, connection), which are re-tested each time so a polyfill, a test stub or going offline is seen. Never throws. |
| `probe(cap)` / `probeAll(caps?)` | Promise; runs the costly async probes (graphics adapter, H.264 encoder, storage round trips). |
| `why(cap)` | Detail code, e.g. `'not-isolated'` for `wasm-threads`. |
| `capInfo(cap)`, `caps()` | Capability metadata / all ids. |
| `maxCanvas()` | `{ side, area, megapixels, measured, source }`. |
| `memoryGB()`, `cpuCores()` | Number or `null` when the browser does not say. |
| `env()` | `{ os, osName, osVersion, browser, browserName, version, engine, inApp, mobile, device, deviceWord }`. |
| `define(def)`, `features()`, `get(id)` | Registry. |
| `check(id)` | `{ id, name, group, status, reasons, missing, unknown, suggest, canForce, forced, label }`. Sync, uses what is known now. |
| `checkAsync(id)`, `checkAll()` | Probes first / every feature. |
| `gate(id, { title, run, onCancel, fallback })` | Promise of `run()`'s result, `fallback.run()`'s result when the person picks the fallback, or `undefined` when cancelled. |
| `reportFailure(id, err)`, `reportSuccess(id)`, `history(id)`, `forget(id?)` | Local history (localStorage `le-support`; session choices in sessionStorage `le-support-session`). |
| `badge(id)`, `annotate(root)` | Inline states. |
| `open()`, `renderReport(el, { compact })`, `reportText()` | The report as a sheet, into an element, or as plain text. |
| `studioSettings(c, body)` | The studio settings row. |
| `matrix`, `matrixNotes`, `browsersFor(os)` | The browser matrix. |
| `override(cap, value)` | Pin a capability (tests, support). `undefined` clears. |
| `on(fn)` | Change listener; also `window` event `le-support:change`. |

## Capability ids

Browser: `wasm`, `wasm-simd`, `worker`, `offscreen-canvas` (2D in OffscreenCanvas), `compression-stream` (deflate-raw both ways), `web-share`, `web-share-files`, `clipboard-write-image`, `clipboard-read`, `media-recorder`, `media-recorder-mp4`, `media-recorder-webm`, `canvas-capture-stream`, `webcodecs-video-encoder`, `webcodecs-h264` (async), `camera` (API present; permission unknown until asked), `file-system-access`, `directory-picker`, `launch-queue`, `file-handling`*, `share-target`*, `indexeddb` (async refine), `cache-storage` (async refine), `service-worker`, `persistent-storage`, `storage-estimate`, `eyedropper`, `webgpu` (async: an adapter is actually obtainable), `webgl2`, `createimagebitmap`, `avif-encode`, `webp-encode`, `install-prompt`, `installable`*, `canvas-2d`, `canvas-filter`, `path2d`, `resize-observer`, `intersection-observer`, `dialog`, `fetch`, `crypto-subtle`, `crypto-random`, `random-uuid`, `text-encoding`, `dom-parser`, `font-loading`.

Device: `canvas-max-area` (32 MP or more), `touch`, `pointer-fine`, `device-memory-4gb`, `cpu-cores` (4 or more).

Site: `secure-context`, `wasm-threads` (false unless the page is cross-origin isolated; LocalEditor does not send COOP/COEP, see the background-remover research), `standalone`, `in-app-browser`*, `online`*.

\* No feature test exists; answered from the platform (`inferred`). A `false` from an inferred capability still allows "Try anyway".

## Verdict rules

1. Any `needs` probe is `false` → `unsupported`. `canForce` only when the feature has `degraded`, or every missing one is inferred.
2. Else any `needs` probe is `null` → `unknown`, `canForce: true`.
3. Any `wants` probe is `false` → at least `limited`.
4. Memory (`memoryMB`): if the device reports memory under 8 GB and the feature needs more than a quarter of it → `limited` ("This phone may not have enough memory for the detailed cut-out (needs about 1 GB)"). If the device does not report memory (Safari, Firefox), a phone with a feature of 600 MB or more → `unknown`; a computer → no change. Memory never makes a feature `unsupported`.
5. Fewer than 4 cores and `memoryMB` ≥ 300 → `limited` ("may be slow").
6. A recorded success → `ok`, whatever the estimates and unknowns, but not when a required API is definitely missing now (rule 1 wins). A recorded failure (newest wins) → at least `limited`, first reason "This did not work last time on this device."
7. `suggest` comes from missing `needs` (or, if none, missing `wants`) that a browser can change: every other browser on this OS where the matrix says yes for all of them. When the matrix says the current browser itself supports them but the live test fails, this copy is out of date (or the feature is switched off): the first suggestion is `{ update: true, name }` ("Update Chrome to the latest version", or the OS on iOS) and browsers on the same engine are not suggested. On iOS never another browser (one engine): "works on a computer" instead. In an app's built-in browser: open in Safari or Chrome.

Gate: `ok`, or a remembered "Try anyway" (this session, or "Don't ask again on this device") → runs at once. Otherwise a sheet: the reasons, suggestions with "Copy link to open it there", and the safest primary action (Continue for `limited`, Try anyway for `unknown`, Not now for `unsupported`; OK only when it cannot be forced).

## Updating the browser matrix

`MATRIX_SPEC` in `le-support.js`, one line per capability:

```
'web-share': 'ios:all android:chrome,edge,samsung,?firefox windows:chrome,edge mac:safari,?chrome,?edge linux: chromeos:chrome',
```

Listed = supported in the current stable version; `?name` = unsure (never suggested); unlisted = not supported; `all` = every browser offered on that OS (`BROWSERS_BY_OS`). Write the reason for each `?` in `MATRIX_NOTES`. Only change a cell when you have checked it (release notes, MDN compat data or a real device). The matrix only drives suggestions; what this browser can do always comes from the probes. Device and site capabilities have no row.

## Adding a capability

Add an entry to `CAPS` with `kind`, a `test` that returns `true/false/null` (put `async` on anything costly; `lazy: true` for a sync test that should wait until asked), `can` (finishes "Chrome on this phone can …") and `lack` (one plain sentence, no API names). Add a matrix row if another browser could change it, and list it above.
