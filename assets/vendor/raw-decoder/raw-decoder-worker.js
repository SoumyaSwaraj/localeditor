/* LocalEditor camera RAW module: Worker bridge. Part of the separately downloaded module in this directory (see README.md).
 *
 * The editor never imports LibRaw. It talks to this Worker with the messages below; anything that answers them the same way can replace this
 * directory (see "Replacing the module" in README.md). The bridge itself is LocalEditor's own code (MIT); `raw-decoder.js` and `raw-decoder.wasm`
 * are LibRaw 0.22.2 plus our glue, built by tools/raw-decoder/build.sh, under the LGPL-2.1 (licence text in assets/vendor/licenses/).
 *
 * Messages in  (all carry an `id` except init):
 *   { cmd: 'init', wasm: ArrayBuffer }                         -> { ok, version, capabilities, module: { name, version, licence, source, ... } }
 *   { id, cmd: 'identify', buf: ArrayBuffer, name }            -> { id, ok, meta }
 *   { id, cmd: 'preview',  buf }                               -> { id, ok, jpeg: ArrayBuffer, width, height, orientation }
 *   { id, cmd: 'decode',   buf, opts: { half, quality, format } } -> { id, progress } ... then { id, ok, result: { width, height, data, space: 'camera', format, meta } }
 * `format` is 'f32' (default), 'f16' (Uint16Array of half-float bits) or 'u16' (value * 16384, so 4.0 is full scale).
 * `meta` uses the same field names as the built-in DNG reader (colorMatrix2, asShotNeutral, orientation, ...) so one colour code serves both.
 * Errors: { id, ok: false, error, why }.
 */
'use strict';
var MODULE_INFO = {
  name: 'LibRaw', version: '0.22.2', licence: 'LGPL-2.1', licenceAlt: 'CDDL-1.0 (not elected)',
  licenceUrl: 'assets/vendor/licenses/libraw-LICENSE.LGPL.txt', source: 'https://github.com/LibRaw/LibRaw/tree/0.22.2', projectUrl: 'https://www.libraw.org/',
  buildRecipe: 'tools/raw-decoder/', licencesPage: 'licenses/#libraw'
};
var lib = null, H = null;
importScripts('raw-decoder.js');

function str(i) { return lib.UTF8ToString(lib._lr_str(i)); }
function info(i) { return lib._lr_info(i); }
function mat(from, rows, cols) { var m = []; for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) m.push(info(from + r * cols + c)); return m; }
function nonzero(a) { return a.some(function (v) { return v !== 0; }); }
var FLIP = { 0: 1, 3: 3, 5: 8, 6: 6 };

function readMeta() {
  var colors = info(6), filters = info(7), m = {
    make: str(2) || str(0), model: str(3) || str(1), uniqueModel: str(5), decoder: str(6), cdesc: str(4),
    width: info(14), height: info(15), rawWidth: info(0), rawHeight: info(1), orientation: FLIP[info(8)] || 1, iso: info(9), exposureTime: info(10), fNumber: info(11), focalLength: info(12), timestamp: info(13),
    colors: colors, filters: filters, isFoveon: !!info(16), dngVersion: info(17), xtrans: filters === 9, bayer: filters !== 0 && filters !== 9 && filters !== 0xFFFFFFFF,
    black: info(122), white: info(123), dataMaximum: info(124), cblack: [info(125), info(126), info(127), info(128)]
  };
  var cm = mat(30, 3, 3); if (nonzero(cm)) { m.colorMatrix2 = cm; m.illuminant2 = 21; }
  var mul = [info(22), info(23), info(24)];
  if (mul[0] > 0 && mul[1] > 0 && mul[2] > 0) { var n = mul.map(function (v) { return 1 / v; }), mx = Math.max(n[0], n[1], n[2]); m.asShotNeutral = n.map(function (v) { return v / mx; }); }
  else { var pm = [info(26), info(27), info(28)]; if (pm[0] > 0 && pm[1] > 0 && pm[2] > 0) { var n2 = pm.map(function (v) { return 1 / v; }), mx2 = Math.max(n2[0], n2[1], n2[2]); m.asShotNeutral = n2.map(function (v) { return v / mx2; }); } }
  for (var k = 0; k < 2; k++) { // colour data written by DNG files, when present
    var ill = info(42 + k * 40), cmm = mat(43 + k * 40, 3, 3), fm = mat(52 + k * 40, 3, 3);
    if (ill && nonzero(cmm)) { m['colorMatrix' + (k + 1)] = cmm; m['illuminant' + (k + 1)] = ill; if (nonzero(fm)) m['forwardMatrix' + (k + 1)] = fm; }
  }
  if (m.colorMatrix1 && !m.colorMatrix2) { m.colorMatrix2 = m.colorMatrix1; m.illuminant2 = m.illuminant1; }
  return m;
}
var _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function LERawHalf(v) { _f[0] = v; var x = _u[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xFF) - 127 + 15, m = x & 0x7FFFFF; if (e >= 31) return s | 0x7BFF; if (e <= 0) { if (e < -10) return s; m = (m | 0x800000) >> (1 - e); return s | ((m + 0x1000) >> 13); } return s | (e << 10) | ((m + 0x1000) >> 13); }

function open(buf) {
  var u8 = new Uint8Array(buf), p = lib._lr_alloc(u8.length);
  if (!p) throw new Error('out-of-memory');
  lib.HEAPU8.set(u8, p);
  var rc = lib._lr_open(u8.length);
  if (rc) throw new Error(lib.UTF8ToString(lib._lr_strerror(rc)) || ('libraw-' + rc));
}
var HUMAN = { 'Unsupported file format or not RAW file': 'This file is not a camera RAW format the module can read.', 'Out of memory': 'Not enough memory to decode this file. Try the half-size preview.', 'Input/output error': 'The file could not be read completely.', 'Unexpected end of file': 'The file is cut short or damaged.' };
function why(e) { var m = String(e && e.message || e); return HUMAN[m] || m; }

self.onmessage = function (ev) {
  var m = ev.data, id = m.id;
  if (m.cmd === 'init') {
    createLibRaw({ instantiateWasm: function (imports, ok) { WebAssembly.instantiate(m.wasm, imports).then(function (r) { ok(r.instance, r.module); }, function (e) { self.postMessage({ ok: false, error: String(e && e.message || e) }); }); return {}; } }).then(function (L) {
      lib = L; self.postMessage({ ok: true, version: UTF8(L._lr_version()), capabilities: UTF8(L._lr_capabilities()), module: MODULE_INFO });
    }).catch(function (e) { self.postMessage({ ok: false, error: String(e && e.message || e) }); });
    return;
  }
  if (m.cmd === 'abort') return; // WebAssembly cannot be interrupted mid-call; the caller discards the result instead
  if (!lib) { self.postMessage({ id: id, ok: false, error: 'not-initialised' }); return; }
  try {
    if (m.cmd === 'identify') { open(m.buf); self.postMessage({ id: id, ok: true, meta: readMeta() }); lib._lr_close(); }
    else if (m.cmd === 'preview') {
      open(m.buf); var meta = readMeta(), rc = lib._lr_thumb();
      if (rc) { lib._lr_close(); throw new Error('no-preview'); }
      var p = lib._lr_thumb_ptr(), n = lib._lr_thumb_len(), type = lib._lr_thumb_type(), out = lib.HEAPU8.slice(p, p + n).buffer;
      self.postMessage({ id: id, ok: true, jpeg: out, type: type, width: lib._lr_thumb_w(), height: lib._lr_thumb_h(), orientation: meta.orientation }, [out]); lib._lr_close();
    } else if (m.cmd === 'decode') {
      var o = m.opts || {}, t0 = Date.now(); self.postMessage({ id: id, progress: 0.05 });
      open(m.buf); var meta2 = readMeta(); self.postMessage({ id: id, progress: 0.15 });
      var rc2 = lib._lr_process(o.quality == null ? 3 : o.quality, o.half ? 1 : 0);
      if (rc2) { var msg = lib.UTF8ToString(lib._lr_strerror(rc2)); lib._lr_close(); throw new Error(msg); }
      var w = lib._lr_out_w(), h = lib._lr_out_h(), ch = lib._lr_out_colors(), ptr = lib._lr_out_ptr(), n3 = w * h * 3, fmt = o.format || 'f32';
      var src = new Uint16Array(lib.HEAPU8.buffer, ptr, w * h * ch), data;
      if (fmt === 'u16') { data = new Uint16Array(n3); for (var i = 0, j = 0; i < n3; i += 3, j += ch) { data[i] = Math.min(65535, src[j] >> 2); data[i + 1] = Math.min(65535, src[j + 1] >> 2); data[i + 2] = Math.min(65535, src[j + 2] >> 2); } }
      else if (fmt === 'f16') { data = new Uint16Array(n3); for (var a = 0, b = 0; a < n3; a += 3, b += ch) { data[a] = LERawHalf(src[b] / 65535); data[a + 1] = LERawHalf(src[b + 1] / 65535); data[a + 2] = LERawHalf(src[b + 2] / 65535); } }
      else { data = new Float32Array(n3); var inv = 1 / 65535; for (var c = 0, d = 0; c < n3; c += 3, d += ch) { data[c] = src[d] * inv; data[c + 1] = src[d + 1] * inv; data[c + 2] = src[d + 2] * inv; } }
      var heap = lib.HEAPU8.length; lib._lr_free_out(); lib._lr_close();
      meta2.timing = { totalMs: Date.now() - t0, wasmHeapBytes: heap }; meta2.quality = o.quality == null ? 3 : o.quality; meta2.half = !!o.half; meta2.crop = [0, 0, w, h];
      self.postMessage({ id: id, ok: true, result: { width: w, height: h, data: data, space: 'camera', format: fmt, meta: meta2 } }, [data.buffer]);
    }
  } catch (e) { try { lib._lr_close(); } catch (e2) { } self.postMessage({ id: id, ok: false, error: String(e && e.message || e), why: why(e) }); }
};
function UTF8(p) { return lib.UTF8ToString(p); }
