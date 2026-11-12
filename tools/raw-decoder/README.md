# Building the camera RAW module

`bash tools/raw-decoder/build.sh` writes `assets/vendor/raw-decoder/raw-decoder.{js,wasm}`.

| Pinned input | Value |
|---|---|
| LibRaw | 0.22.2, tag `0.22.2` of https://github.com/LibRaw/LibRaw, 103 files, each with its SHA-256 in `sources.json` (fetched and verified by `fetch-source.js`) |
| Toolchain | Emscripten 7.0.0, emscripten-releases build `6afbd83493d647051772d491124187d4e9a0cda9` from the official bucket (`storage.googleapis.com/webassembly/emscripten-releases-builds/linux/<hash>/wasm-binaries.tar.xz`, 322,310,412 bytes) |
| Flags | `-O2 -fwasm-exceptions -std=c++14 -DLIBRAW_NOTHREADS -DLIBRAW_NODLL`; link with `MODULARIZE`, `ALLOW_MEMORY_GROWTH`, `MAXIMUM_MEMORY=2 GB`, no filesystem |
| Patches | none (`patches/` is empty on purpose); LibRaw is used exactly as released |

Not built in, on purpose: **LibRaw-demosaic-pack-GPL2 and -GPL3** (the GPL demosaic methods; `sources.json` lists only the LibRaw core, so the build cannot pick them up), zlib, libjpeg, libjxl, lcms, RawSpeed, the Adobe DNG SDK, OpenMP. Demosaic methods that remain, all inside LibRaw: linear, VNG, PPG, AHD, DCB (BSD-style), DHT, AAHD, and Markesteijn for X-Trans. Consequences: DNG files that use lossy JPEG or JPEG XL compression are not read by this module (the editor's own DNG reader handles deflate and lossless; JPEG XL DNG is not supported yet).

`glue.cpp` is the only code of ours that is linked with LibRaw. It exposes a small C interface; the editor never calls LibRaw directly (see `assets/vendor/raw-decoder/README.md`).

To update LibRaw: change `version` / `tag` in `sources.json`, regenerate the file hashes from the release tarball (compare with the tag), rebuild, run `node tests/run.js raw`, update the row in `assets/vendor/LICENSES.md` and the page `licenses/`.
