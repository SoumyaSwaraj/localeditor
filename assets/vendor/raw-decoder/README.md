# Camera RAW support module

An optional, separately downloaded module. It opens camera RAW files (Canon CR2 and CR3, Nikon NEF, Sony ARW, Fujifilm RAF including X-Trans, Olympus ORF, Panasonic RW2, Pentax PEF, Samsung SRW and the other formats LibRaw reads). It is **not** part of the editor's own code.

| File | What it is | Licence |
|---|---|---|
| `raw-decoder.wasm` | LibRaw 0.22.2 plus LocalEditor's small glue (`tools/raw-decoder/glue.cpp`), compiled to WebAssembly by `tools/raw-decoder/build.sh` | LibRaw: **LGPL 2.1** (elected from LibRaw's LGPL-2.1 / CDDL-1.0 dual licence). Emscripten runtime inside: MIT, musl MIT, libc++ Apache-2.0 with LLVM exception |
| `raw-decoder.js` | Emscripten loader for the wasm file | MIT / UIUC-NCSA (Emscripten) |
| `raw-decoder-worker.js` | The bridge: a Web Worker that answers the messages below | LocalEditor's own code |

Licence texts: `assets/vendor/licenses/libraw-LICENSE.LGPL.txt`, `libraw-LICENSE.CDDL.txt`, `libraw-COPYRIGHT.txt`, `emscripten-runtime-LICENSES.txt`. Shown to people on the site at `/licenses/#libraw`, in the storage manager entry "Camera RAW support", and once, as a one-line note, the first time the module is used.

## How it is loaded

Only when a camera RAW file is opened (`LE.raw.decode` / `LE.raw.probe` report `decoder: 'camera'`). The wasm file is fetched once, through the download policy (`LE.downloads.request({ id: 'raw.camera', ... })`), stored in Cache Storage `le-models-v1` under its URL with the header `x-le-model: raw-camera`, and handed to the worker as bytes. The worker is started on demand and can be terminated at any time (`LE.raw.camera.unload()`); `LE.raw.camera.remove()` deletes the cached file. Never precached; not referenced from any page's HTML.

## The interface (what the editor depends on)

Everything goes through `postMessage` on the Worker `raw-decoder-worker.js`. Nothing else in the editor touches LibRaw.

```
→ { cmd: 'init', wasm: ArrayBuffer }                  ← { ok, version, capabilities, module: { name, version, licence, licenceUrl, source, projectUrl, ... } }
→ { id, cmd: 'identify', buf: ArrayBuffer, name }     ← { id, ok, meta }
→ { id, cmd: 'preview',  buf }                        ← { id, ok, jpeg: ArrayBuffer, type, width, height, orientation }
→ { id, cmd: 'decode',   buf, opts: { half, quality, format } }
                                                      ← { id, progress } …  then { id, ok, result: { width, height, data, space: 'camera', format, meta } }
errors: { id, ok: false, error, why }
```

`data` is interleaved RGB, camera-native linear light, black level removed, sensor white = 1.0 (`format: 'f32'`), or half-float bits (`'f16'`), or `value * 16384` (`'u16'`). No white balance, colour conversion, tone curve or orientation is applied. `meta` uses the DNG reader's field names: `make`, `model`, `orientation` (EXIF 1 to 8), `asShotNeutral`, `colorMatrix2` (XYZ to camera, D65, `illuminant2: 21`) and, for DNG files, `colorMatrix1/2`, `forwardMatrix1/2` with their illuminants; `iso`, `exposureTime`, `fNumber`, `focalLength`, `xtrans`, `black`, `white`, `decoder`. `quality` is LibRaw's demosaic number: 0 linear, 1 VNG, 2 PPG, 3 AHD (default), 4 DCB, 11 DHT, 12 AAHD; for X-Trans 0 and 1 use one pass, 3 and above three-pass Markesteijn. WebAssembly cannot be interrupted, so an `abort` message is ignored and the caller discards the result.

## Replacing the module

The person using the editor, or a downstream host, can swap in a different decoder without touching the editor:

1. Put your own worker script at `assets/vendor/raw-decoder/raw-decoder-worker.js` (or serve it from your own origin and set `window.LE_RAW_DECODER_BASE = 'https://your.host/path/'` before `raw.js` loads) that answers the messages above. A different LibRaw build, a newer LibRaw, or another decoder entirely all work if they answer the same way.
2. If it needs a binary, name it `raw-decoder.wasm` (the editor fetches and caches that URL and passes the bytes in `init`), or ignore `init.wasm` and load your own.
3. Rebuilding this module from source: `bash tools/raw-decoder/build.sh` (see `tools/raw-decoder/README.md`). The sources and their SHA-256 are pinned in `tools/raw-decoder/sources.json`.

## Source offer (LGPL 2.1, section 6)

The complete corresponding source of `raw-decoder.wasm` is: LibRaw 0.22.2 exactly as released (https://github.com/LibRaw/LibRaw, tag 0.22.2; file list and SHA-256 in `tools/raw-decoder/sources.json`; release tarball https://www.libraw.org/data/LibRaw-0.22.2.tar.gz), LocalEditor's `tools/raw-decoder/glue.cpp`, and the build recipe `tools/raw-decoder/build.sh` (Emscripten 7.0.0). LibRaw is not modified. This offer stands for at least three years from the date a version of the module is last served, and applies to anyone who has received the module. To ask for a copy on other media, write to: **[contact address, to be set by the owner]**.
