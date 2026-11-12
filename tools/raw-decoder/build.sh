#!/bin/bash
# Reproducible build of the LocalEditor camera RAW module (LibRaw 0.22.2 -> WebAssembly).
#
#   bash tools/raw-decoder/build.sh            # builds into assets/vendor/raw-decoder/
#
# Needs: bash, node >= 18, python3, curl, tar with xz. No Docker, no global installs: the Emscripten toolchain is downloaded to
# tools/raw-decoder/.cache/ (about 320 MB) from the official Emscripten release bucket, pinned by release hash.
#
# What is compiled: the LibRaw core only (sources.json lists every file and its SHA-256, taken from the tag 0.22.2 of https://github.com/LibRaw/LibRaw).
#   Not included: LibRaw-demosaic-pack-GPL2 / -GPL3 (the GPL demosaic methods), zlib, libjpeg, libjxl, lcms, RawSpeed, the Adobe DNG SDK, OpenMP.
#   Demosaic methods that remain (all inside LibRaw, LGPL/CDDL or BSD-style): linear, VNG, PPG, AHD, DCB, DHT, AAHD, and Markesteijn for Fujifilm X-Trans.
# Patches to LibRaw: none (the sources are used exactly as released). tools/raw-decoder/patches/ is empty on purpose.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CACHE="$HERE/.cache"
OUT="$ROOT/assets/vendor/raw-decoder"
EMSDK_VERSION="7.0.0"
EMSDK_HASH="6afbd83493d647051772d491124187d4e9a0cda9"   # emscripten-releases build of Emscripten 7.0.0 (see emsdk's emscripten-releases-tags.json)
EMSDK_URL="https://storage.googleapis.com/webassembly/emscripten-releases-builds/linux/$EMSDK_HASH/wasm-binaries.tar.xz"
JOBS="${JOBS:-3}"
OPT="${OPT:--O2}"
mkdir -p "$CACHE" "$OUT"

if [ ! -x "$CACHE/emsdk/install/emscripten/emcc" ]; then
  echo "== downloading Emscripten $EMSDK_VERSION"
  curl -fL -o "$CACHE/wasm-binaries.tar.xz" "$EMSDK_URL"
  echo "   sha256 $(sha256sum "$CACHE/wasm-binaries.tar.xz" | cut -d' ' -f1)"
  mkdir -p "$CACHE/emsdk" && tar xJf "$CACHE/wasm-binaries.tar.xz" -C "$CACHE/emsdk"
fi
I="$CACHE/emsdk/install"
cat > "$CACHE/em.config" <<EOF
LLVM_ROOT='$I/bin'
BINARYEN_ROOT='$I'
EMSCRIPTEN_ROOT='$I/emscripten'
NODE_JS='$(command -v node)'
CACHE='$CACHE/em-cache'
EOF
export EM_CONFIG="$CACHE/em.config"
export PATH="$I/emscripten:$PATH"

node "$HERE/fetch-source.js" "$CACHE/libraw-src"
SRC="$CACHE/libraw-src"
OBJ="$CACHE/obj"; mkdir -p "$OBJ"
FLAGS="$OPT -fwasm-exceptions -std=c++14 -DLIBRAW_NOTHREADS -DLIBRAW_NODLL -I$SRC -w"

echo "== compiling LibRaw $(grep -o '"version": "[^"]*"' "$HERE/sources.json" | head -1)"
cd "$SRC"
find src -name '*.cpp' ! -path 'src/integration/*' ! -name '*_ph.cpp' | sort > "$CACHE/cpp.list"
cat "$CACHE/cpp.list" | xargs -P "$JOBS" -I{} sh -c 'o="'"$OBJ"'/$(echo {} | tr / _).o"; [ "$o" -nt "{}" ] || em++ '"$FLAGS"' -c {} -o "$o"'
em++ $FLAGS -c "$HERE/glue.cpp" -o "$OBJ/glue.o"

echo "== linking"
em++ $OPT -fwasm-exceptions "$OBJ"/*.o -o "$OUT/raw-decoder.js" \
  -sMODULARIZE=1 -sEXPORT_NAME=createLibRaw -sENVIRONMENT=web,worker,node -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=2097152 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_lr_version,_lr_capabilities,_lr_alloc,_lr_close,_lr_open,_lr_info,_lr_str,_lr_process,_lr_out_ptr,_lr_out_w,_lr_out_h,_lr_out_colors,_lr_out_bits,_lr_free_out,_lr_thumb,_lr_thumb_ptr,_lr_thumb_len,_lr_thumb_type,_lr_thumb_w,_lr_thumb_h,_lr_strerror \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAPF64,UTF8ToString,wasmMemory
echo "== done"; ls -l "$OUT/raw-decoder.js" "$OUT/raw-decoder.wasm"
sha256sum "$OUT/raw-decoder.wasm" "$OUT/raw-decoder.js"
