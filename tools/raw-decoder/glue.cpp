// LocalEditor camera RAW module: a thin C interface over LibRaw (LGPL-2.1, see assets/vendor/licenses/libraw-LICENSE.LGPL.txt).
// This file is LocalEditor's own glue (MIT) and is linked with LibRaw into one WebAssembly file. It has no LibRaw code in it.
//
// The JavaScript side (assets/vendor/raw-decoder/raw-decoder-worker.js) calls these functions; see assets/vendor/raw-decoder/README.md for the
// message interface the rest of the editor depends on. Demosaic methods are only those inside LibRaw itself (no GPL demosaic packs).
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdio.h>
#include <emscripten.h>
#include "libraw/libraw.h"

static LibRaw *lr = nullptr;
static void *held = nullptr;               // the file bytes LibRaw reads from; owned here, freed in lr_close
static libraw_processed_image_t *out = nullptr;
static libraw_processed_image_t *thumb = nullptr;
static double info[200];
static char strs[8][96];

extern "C" {

EMSCRIPTEN_KEEPALIVE const char *lr_version(void) { return LibRaw::version(); }
EMSCRIPTEN_KEEPALIVE const char *lr_capabilities(void) { static char s[64]; snprintf(s, sizeof s, "0x%x", LibRaw::capabilities()); return s; }

EMSCRIPTEN_KEEPALIVE void *lr_alloc(size_t n) { if (held) { free(held); held = nullptr; } held = malloc(n); return held; }

EMSCRIPTEN_KEEPALIVE void lr_close(void) {
  if (out) { LibRaw::dcraw_clear_mem(out); out = nullptr; }
  if (thumb) { LibRaw::dcraw_clear_mem(thumb); thumb = nullptr; }
  if (lr) { lr->recycle(); delete lr; lr = nullptr; }
  if (held) { free(held); held = nullptr; }
}

// returns 0 on success, else a LibRaw error code (negative) ; fills the info table
EMSCRIPTEN_KEEPALIVE int lr_open(size_t len) {
  if (lr) { lr->recycle(); delete lr; lr = nullptr; }
  lr = new LibRaw();
  int rc = lr->open_buffer(held, len);
  if (rc != LIBRAW_SUCCESS) return rc;
  libraw_data_t &d = lr->imgdata;
  memset(info, 0, sizeof info);
  info[0] = d.sizes.raw_width; info[1] = d.sizes.raw_height; info[2] = d.sizes.width; info[3] = d.sizes.height;
  info[4] = d.sizes.left_margin; info[5] = d.sizes.top_margin; info[6] = d.idata.colors; info[7] = d.idata.filters; info[8] = d.sizes.flip;
  info[9] = d.other.iso_speed; info[10] = d.other.shutter; info[11] = d.other.aperture; info[12] = d.other.focal_len; info[13] = (double)d.other.timestamp;
  info[14] = d.sizes.iwidth; info[15] = d.sizes.iheight; info[16] = d.idata.is_foveon; info[17] = d.idata.dng_version;
  info[18] = d.thumbnail.tformat; info[19] = d.thumbnail.twidth; info[20] = d.thumbnail.theight; info[21] = d.thumbnail.tlength;
  for (int i = 0; i < 4; i++) { info[22 + i] = d.color.cam_mul[i]; info[26 + i] = d.color.pre_mul[i]; }
  for (int i = 0; i < 4; i++) for (int j = 0; j < 3; j++) info[30 + i * 3 + j] = d.color.cam_xyz[i][j];   // 30..41 XYZ(D65) -> camera
  for (int k = 0; k < 2; k++) {                                                                           // DNG colour data if the file carried it
    libraw_dng_color_t &c = d.color.dng_color[k];
    info[42 + k * 40] = c.illuminant;
    for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) { info[43 + k * 40 + i * 3 + j] = c.colormatrix[i][j]; info[52 + k * 40 + i * 3 + j] = c.forwardmatrix[i][j]; }
  }
  info[122] = d.color.black; info[123] = d.color.maximum; info[124] = d.color.data_maximum;
  for (int i = 0; i < 4; i++) info[125 + i] = d.color.cblack[i];
  info[129] = d.color.cblack[4]; info[130] = d.color.cblack[5];
  for (int y = 0; y < 6; y++) for (int x = 0; x < 6; x++) info[131 + y * 6 + x] = d.idata.xtrans[y][x];
  strncpy(strs[0], d.idata.make, 95); strncpy(strs[1], d.idata.model, 95); strncpy(strs[2], d.idata.normalized_make, 95); strncpy(strs[3], d.idata.normalized_model, 95);
  strncpy(strs[4], d.idata.cdesc, 95); strncpy(strs[5], d.color.UniqueCameraModel, 95);
  const char *dn = lr->unpack_function_name(); strncpy(strs[6], dn ? dn : "", 95);
  return 0;
}
EMSCRIPTEN_KEEPALIVE double lr_info(int i) { return info[i]; }
EMSCRIPTEN_KEEPALIVE const char *lr_str(int i) { return strs[i]; }

// quality: 0 linear, 1 VNG, 2 PPG, 3 AHD, 4 DCB, 11 DHT, 12 AAHD (X-Trans: 0,1 one-pass Markesteijn, 3+ three-pass).  half: 0/1.
// The result is camera-native linear RGB, 16-bit, black subtracted, sensor white scaled to 65535, no white balance, no colour conversion, no gamma.
EMSCRIPTEN_KEEPALIVE int lr_process(int quality, int half) {
  if (!lr) return -1;
  libraw_output_params_t &o = lr->imgdata.params;
  o.user_qual = quality; o.half_size = half; o.output_bps = 16; o.output_color = 0; o.gamm[0] = o.gamm[1] = 1.0; o.no_auto_bright = 1;
  o.use_camera_wb = 0; o.use_auto_wb = 0; o.user_mul[0] = o.user_mul[1] = o.user_mul[2] = o.user_mul[3] = 1.0f; o.highlight = 0; o.no_auto_scale = 0;
  o.fbdd_noiserd = 0; o.med_passes = 0; o.user_flip = 0;   // orientation is applied by the editor, not here
  int rc = lr->unpack(); if (rc != LIBRAW_SUCCESS) return rc;
  rc = lr->dcraw_process(); if (rc != LIBRAW_SUCCESS) return rc;
  if (out) { LibRaw::dcraw_clear_mem(out); out = nullptr; }
  int e = 0; out = lr->dcraw_make_mem_image(&e); if (!out) return e ? e : -2;
  lr->free_image();                                   // release LibRaw's own 8 bytes per pixel before the caller copies ours
  return 0;
}
EMSCRIPTEN_KEEPALIVE void *lr_out_ptr(void) { return out ? out->data : nullptr; }
EMSCRIPTEN_KEEPALIVE int lr_out_w(void) { return out ? out->width : 0; }
EMSCRIPTEN_KEEPALIVE int lr_out_h(void) { return out ? out->height : 0; }
EMSCRIPTEN_KEEPALIVE int lr_out_colors(void) { return out ? out->colors : 0; }
EMSCRIPTEN_KEEPALIVE int lr_out_bits(void) { return out ? out->bits : 0; }
EMSCRIPTEN_KEEPALIVE void lr_free_out(void) { if (out) { LibRaw::dcraw_clear_mem(out); out = nullptr; } }

// the embedded preview: JPEG bytes (or a bitmap); the file is opened by lr_open already
EMSCRIPTEN_KEEPALIVE int lr_thumb(void) {
  if (!lr) return -1;
  int rc = lr->unpack_thumb(); if (rc != LIBRAW_SUCCESS) return rc;
  if (thumb) { LibRaw::dcraw_clear_mem(thumb); thumb = nullptr; }
  int e = 0; thumb = lr->dcraw_make_mem_thumb(&e); return thumb ? 0 : (e ? e : -2);
}
EMSCRIPTEN_KEEPALIVE void *lr_thumb_ptr(void) { return thumb ? thumb->data : nullptr; }
EMSCRIPTEN_KEEPALIVE unsigned lr_thumb_len(void) { return thumb ? thumb->data_size : 0; }
EMSCRIPTEN_KEEPALIVE int lr_thumb_type(void) { return thumb ? thumb->type : 0; }   // 1 JPEG, 2 bitmap
EMSCRIPTEN_KEEPALIVE int lr_thumb_w(void) { return thumb ? thumb->width : 0; }
EMSCRIPTEN_KEEPALIVE int lr_thumb_h(void) { return thumb ? thumb->height : 0; }

EMSCRIPTEN_KEEPALIVE const char *lr_strerror(int e) { return libraw_strerror(e); }
}
