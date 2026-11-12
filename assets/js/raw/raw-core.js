/* LocalEditor RAW core: our own code, written from public specifications only (TIFF 6.0, TIFF/EP, Adobe DNG 1.6 specification,
 * ITU T.81 lossless mode, Malvar-He-Cutler 2004 and Hamilton-Adams 1997 demosaicing papers, CIE colour formulae).
 * No third-party code. Reads DNG (phones and cameras) and the embedded previews of other RAW formats.
 *
 * Pure functions on ArrayBuffers: runs in a Worker, a page or Node (UMD). Lazy-loaded by raw.js; never precached.
 * Public surface: LERawCore.{ probeBuffer, parseDNG, decodeMosaic, develop, cameraMatrices, ... } (see the bottom of the file).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LERawCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================================================================== TIFF reading */
  var TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8 };
  var TAG = {
    NewSubfileType: 254, ImageWidth: 256, ImageLength: 257, BitsPerSample: 258, Compression: 259, Photometric: 262, Make: 271, Model: 272, StripOffsets: 273, Orientation: 274,
    SamplesPerPixel: 277, RowsPerStrip: 278, StripByteCounts: 279, PlanarConfig: 284, Predictor: 317, TileWidth: 322, TileLength: 323, TileOffsets: 324, TileByteCounts: 325,
    SubIFDs: 330, SampleFormat: 339, JPEGOffset: 513, JPEGLength: 514, CFARepeat: 33421, CFAPattern: 33422, ExposureTime: 33434, FNumber: 33437, ExifIFD: 34665, ISO: 34855,
    FocalLength: 37386, DNGVersion: 50706, UniqueModel: 50708, CFAPlaneColor: 50710, CFALayout: 50711, Linearization: 50712, BlackRepeat: 50713, BlackLevel: 50714,
    BlackDeltaH: 50715, BlackDeltaV: 50716, WhiteLevel: 50717, DefaultScale: 50718, CropOrigin: 50719, CropSize: 50720, ColorMatrix1: 50721, ColorMatrix2: 50722,
    CameraCal1: 50723, CameraCal2: 50724, AnalogBalance: 50727, AsShotNeutral: 50728, AsShotWhiteXY: 50729, BaselineExposure: 50730, BaselineNoise: 50731,
    LinearResponseLimit: 50734, LensInfo: 50736, Illuminant1: 50778, Illuminant2: 50779, ActiveArea: 50829, ForwardMatrix1: 50964, ForwardMatrix2: 50965,
    OpcodeList1: 51008, OpcodeList2: 51009, OpcodeList3: 51022, NoiseProfile: 51041, ProfileName: 50936, ProfileHueSatDims: 50937, ProfileToneCurve: 50940, DefaultUserCrop: 51125
  };

  function Tiff(buf) {
    var dv = new DataView(buf), b0 = dv.getUint8(0), b1 = dv.getUint8(1);
    if (!((b0 === 0x49 && b1 === 0x49) || (b0 === 0x4D && b1 === 0x4D))) throw new Error('not-tiff');
    this.le = b0 === 0x49; this.dv = dv; this.buf = buf;
    var magic = dv.getUint16(2, this.le);
    this.magic = magic;
    if (magic === 43) throw new Error('bigtiff');
    this.first = dv.getUint32(4, this.le);
  }
  Tiff.prototype.ifd = function (off) {
    var dv = this.dv, le = this.le, n, tags = {}, i;
    if (off <= 0 || off + 2 > dv.byteLength) return null;
    n = dv.getUint16(off, le); if (n > 4096 || off + 2 + n * 12 > dv.byteLength) return null;
    for (i = 0; i < n; i++) {
      var o = off + 2 + i * 12, tag = dv.getUint16(o, le), type = dv.getUint16(o + 2, le), count = dv.getUint32(o + 4, le), sz = (TSIZE[type] || 1) * count;
      var vo = sz <= 4 ? o + 8 : dv.getUint32(o + 8, le);
      if (vo + sz > dv.byteLength) continue;
      tags[tag] = { type: type, count: count, off: vo };
    }
    var next = off + 2 + n * 12 + 4 <= dv.byteLength ? dv.getUint32(off + 2 + n * 12, le) : 0;
    return { tags: tags, next: next, off: off };
  };
  Tiff.prototype.num = function (ifd, tag, i) { // one number
    var e = ifd.tags[tag]; if (!e) return undefined; i = i || 0; if (i >= e.count) return undefined;
    return this.at(e, i);
  };
  Tiff.prototype.at = function (e, i) {
    var dv = this.dv, le = this.le, o = e.off;
    switch (e.type) {
      case 1: case 2: case 7: return dv.getUint8(o + i);
      case 6: return dv.getInt8(o + i);
      case 3: return dv.getUint16(o + 2 * i, le);
      case 8: return dv.getInt16(o + 2 * i, le);
      case 4: case 13: return dv.getUint32(o + 4 * i, le);
      case 9: return dv.getInt32(o + 4 * i, le);
      case 11: return dv.getFloat32(o + 4 * i, le);
      case 12: return dv.getFloat64(o + 8 * i, le);
      case 5: { var d = dv.getUint32(o + 8 * i + 4, le); return d ? dv.getUint32(o + 8 * i, le) / d : 0; }
      case 10: { var d2 = dv.getInt32(o + 8 * i + 4, le); return d2 ? dv.getInt32(o + 8 * i, le) / d2 : 0; }
      case 16: return dv.getUint32(o + 8 * i, le);
    }
    return undefined;
  };
  Tiff.prototype.arr = function (ifd, tag) {
    var e = ifd.tags[tag]; if (!e) return null; var out = new Array(e.count), i; for (i = 0; i < e.count; i++) out[i] = this.at(e, i); return out;
  };
  Tiff.prototype.str = function (ifd, tag) {
    var e = ifd.tags[tag]; if (!e) return ''; var s = '', i; for (i = 0; i < e.count; i++) { var c = this.dv.getUint8(e.off + i); if (!c) break; s += String.fromCharCode(c); } return s.trim();
  };
  Tiff.prototype.bytes = function (ifd, tag) { var e = ifd.tags[tag]; return e ? new Uint8Array(this.buf, e.off, e.count * (TSIZE[e.type] || 1)) : null; };

  /* collects all IFDs reachable from IFD0: chain, SubIFDs, Exif */
  function collect(t) {
    var out = [], seen = {};
    function walk(off, depth, role) {
      while (off && !seen[off] && out.length < 64) {
        seen[off] = 1; var ifd = t.ifd(off); if (!ifd) return; ifd.role = role; ifd.depth = depth; out.push(ifd);
        var subs = t.arr(ifd, TAG.SubIFDs); if (subs && depth < 3) subs.forEach(function (s) { walk(s, depth + 1, 'sub'); });
        var ex = t.num(ifd, TAG.ExifIFD); if (ex && depth < 3) walk(ex, depth + 1, 'exif');
        off = role === 'chain' || role === 'ifd0' ? ifd.next : 0; role = 'chain';
      }
    }
    walk(t.first, 0, 'ifd0');
    return out;
  }

  /* ================================================================== format detection / probe */
  function ascii(u8, o, n) { var s = ''; for (var i = 0; i < n && o + i < u8.length; i++) s += String.fromCharCode(u8[o + i]); return s; }
  var EXT_FORMAT = { dng: 'DNG', cr2: 'CR2', cr3: 'CR3', crw: 'CRW', nef: 'NEF', nrw: 'NEF', arw: 'ARW', sr2: 'ARW', srf: 'ARW', raf: 'RAF', orf: 'ORF', rw2: 'RW2', rwl: 'RW2', pef: 'PEF', srw: 'SRW', mrw: 'MRW', raw: 'RAW', iiq: 'IIQ', '3fr': '3FR', x3f: 'X3F', erf: 'ERF', kdc: 'KDC', dcr: 'DCR', mef: 'MEF', arq: 'ARW' };
  function sniff(buf, name) {
    var u8 = new Uint8Array(buf, 0, Math.min(buf.byteLength, 64)), ext = (name || '').toLowerCase().split('.').pop(), out = { container: 'unknown', ext: ext };
    if (u8[0] === 0xFF && u8[1] === 0xD8) { out.container = 'jpeg'; return out; }
    if (u8[0] === 0x89 && ascii(u8, 1, 3) === 'PNG') { out.container = 'png'; return out; }
    if (ascii(u8, 0, 15) === 'FUJIFILMCCD-RAW') { out.container = 'raf'; out.format = 'RAF'; return out; }
    if (ascii(u8, 4, 4) === 'ftyp') { var brand = ascii(u8, 8, 4); out.container = 'isobmff'; if (brand === 'crx ') out.format = 'CR3'; else out.container = 'isobmff:' + brand; return out; }
    if (ascii(u8, 0, 8) === 'HEAPCCDR') { out.container = 'ciff'; out.format = 'CRW'; return out; }
    if (ascii(u8, 0, 4) === 'FOVb') { out.container = 'x3f'; out.format = 'X3F'; return out; }
    if (ascii(u8, 0, 4) === 'MRM\0' || (u8[0] === 0 && ascii(u8, 1, 3) === 'MRM')) { out.container = 'mrw'; out.format = 'MRW'; return out; }
    if ((u8[0] === 0x49 && u8[1] === 0x49) || (u8[0] === 0x4D && u8[1] === 0x4D)) {
      var le = u8[0] === 0x49, m = le ? u8[2] | u8[3] << 8 : u8[2] << 8 | u8[3];
      out.container = 'tiff'; out.tiffMagic = m;
      if (m === 0x4F52 || m === 0x5352) out.format = 'ORF'; else if (m === 0x55) out.format = 'RW2'; else if (ascii(u8, 8, 2) === 'CR') out.format = 'CR2';
    }
    return out;
  }

  /* ---------- embedded JPEG previews */
  function jpegExtent(u8, p) { // walks markers from an SOI; returns length or 0
    var n = u8.length, o = p + 2;
    if (u8[p] !== 0xFF || u8[p + 1] !== 0xD8) return 0;
    while (o + 4 <= n) {
      if (u8[o] !== 0xFF) return 0;
      var m = u8[o + 1];
      if (m === 0xFF) { o++; continue; }
      if (m === 0xD9) return o + 2 - p;
      if (m === 0xDA) { // scan data: find next marker that is not stuffing or RST
        var len = u8[o + 2] << 8 | u8[o + 3]; o += 2 + len;
        while (o + 1 < n) { if (u8[o] === 0xFF) { var q = u8[o + 1]; if (q === 0 || (q >= 0xD0 && q <= 0xD7)) { o += 2; continue; } if (q === 0xFF) { o++; continue; } break; } o++; }
        continue;
      }
      if (m >= 0xD0 && m <= 0xD8) { o += 2; continue; }
      var l = u8[o + 2] << 8 | u8[o + 3]; if (l < 2) return 0; o += 2 + l;
    }
    return 0;
  }
  function jpegSize(u8, p) {
    var o = p + 2, n = u8.length;
    while (o + 9 < n) { if (u8[o] !== 0xFF) return null; var m = u8[o + 1]; if (m === 0xFF) { o++; continue; } if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: u8[o + 5] << 8 | u8[o + 6], w: u8[o + 7] << 8 | u8[o + 8] }; if (m === 0xDA || m === 0xD9) return null; o += 2 + (u8[o + 2] << 8 | u8[o + 3]); }
    return null;
  }
  /* returns { off, len, w, h } of the largest embedded JPEG we can find, or null */
  function findPreview(buf, tiff, ifds, sn) {
    var u8 = new Uint8Array(buf), cands = [], i;
    function add(off, len) { if (off > 0 && len > 100 && off + len <= u8.length && u8[off] === 0xFF && u8[off + 1] === 0xD8) { var ext = jpegExtent(u8, off); if (ext) { var sz = jpegSize(u8, off) || { w: 0, h: 0 }; cands.push({ off: off, len: ext, w: sz.w, h: sz.h }); } } }
    if (sn && sn.format === 'RAF' && u8.length > 100) { var dv = new DataView(buf); add(dv.getUint32(84, false), dv.getUint32(88, false)); }
    if (tiff) {
      ifds.forEach(function (ifd) {
        var c = tiff.num(ifd, TAG.Compression), off = tiff.num(ifd, TAG.JPEGOffset), len = tiff.num(ifd, TAG.JPEGLength);
        if (off && len) add(off, len);
        if ((c === 6 || c === 7) && tiff.num(ifd, TAG.Photometric) !== 32803 && tiff.num(ifd, TAG.Photometric) !== 34892) { var so = tiff.arr(ifd, TAG.StripOffsets), sc = tiff.arr(ifd, TAG.StripByteCounts); if (so && so.length === 1 && sc) add(so[0], sc[0]); }
        // Panasonic RW2 keeps a JpgFromRaw in tag 0x002e of IFD0
        var e = ifd.tags[0x2e]; if (e && e.type === 7) add(e.off, e.count);
      });
    }
    if (!cands.length && u8.length < 200e6) { // last resort: scan for JPEG start markers in the first 24 MB (CR3, X3F, MRW...)
      var lim = Math.min(u8.length - 4, 24 << 20);
      for (i = 0; i < lim; i++) if (u8[i] === 0xFF && u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) { var ext = jpegExtent(u8, i); if (ext > 5000) { var sz = jpegSize(u8, i) || { w: 0, h: 0 }; cands.push({ off: i, len: ext, w: sz.w, h: sz.h }); i += ext - 1; } }
    }
    cands.sort(function (a, b) { return (b.w * b.h || b.len) - (a.w * a.h || a.len); });
    return cands[0] || null;
  }

  /* ================================================================== DNG parsing */
  var COMPRESSION = { 1: 'uncompressed', 7: 'lossless-jpeg', 8: 'deflate', 32946: 'deflate', 34892: 'lossy-jpeg', 52546: 'jpeg-xl', 34713: 'nikon-nef', 32769: 'packed', 65535: 'pentax' };
  var OPCODE_NAMES = { 1: 'WarpRectilinear', 2: 'WarpFisheye', 3: 'FixVignetteRadial', 4: 'FixBadPixelsConstant', 5: 'FixBadPixelsList', 6: 'TrimBounds', 7: 'MapTable', 8: 'MapPolynomial', 9: 'GainMap', 10: 'DeltaPerRow', 11: 'DeltaPerColumn', 12: 'ScalePerRow', 13: 'ScalePerColumn' };

  function parseOpcodes(bytes) {
    if (!bytes || bytes.length < 4) return [];
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = dv.getUint32(0), o = 4, out = [];
    for (var i = 0; i < n && o + 16 <= bytes.length; i++) {
      var id = dv.getUint32(o), flags = dv.getUint32(o + 8), plen = dv.getUint32(o + 12), p = o + 16;
      if (p + plen > bytes.length) break;
      var op = { id: id, name: OPCODE_NAMES[id] || ('op' + id), optional: !!(flags & 1) };
      if (id === 9 && plen >= 76) {
        op.top = dv.getUint32(p); op.left = dv.getUint32(p + 4); op.bottom = dv.getUint32(p + 8); op.right = dv.getUint32(p + 12);
        op.plane = dv.getUint32(p + 16); op.planes = dv.getUint32(p + 20); op.rowPitch = dv.getUint32(p + 24) || 1; op.colPitch = dv.getUint32(p + 28) || 1;
        op.rows = dv.getUint32(p + 32); op.cols = dv.getUint32(p + 36); op.spacingV = dv.getFloat64(p + 40); op.spacingH = dv.getFloat64(p + 48); op.originV = dv.getFloat64(p + 56); op.originH = dv.getFloat64(p + 64);
        op.mapPlanes = dv.getUint32(p + 72); var cnt = op.rows * op.cols * op.mapPlanes;
        if (cnt > 0 && cnt < 4e6 && 76 + 4 * cnt <= plen) { op.gains = new Float32Array(cnt); for (var k = 0; k < cnt; k++) op.gains[k] = dv.getFloat32(p + 76 + 4 * k); } else op.bad = true;
      } else if (id === 3 && plen >= 56) { // FixVignetteRadial: k0..k4, cx, cy
        op.k = []; for (var j = 0; j < 5; j++) op.k.push(dv.getFloat64(p + 8 * j)); op.cx = dv.getFloat64(p + 40); op.cy = dv.getFloat64(p + 48);
      }
      out.push(op); o = p + plen;
    }
    return out;
  }

  function getMatrix(t, ifd, tag) { var a = t.arr(ifd, tag); return a && a.length === 9 ? a : null; }

  /* parse a DNG buffer; throws Error('<code>') for things that are not supported (code is a stable id used for the "why" text) */
  function parseDNG(buf) {
    var t = new Tiff(buf), ifds = collect(t), ifd0 = ifds[0];
    if (!ifd0) throw new Error('bad-tiff');
    if (!ifd0.tags[TAG.DNGVersion]) throw new Error('not-dng');
    // pick the raw IFD: CFA or LinearRaw photometric, largest area
    var raw = null, best = 0;
    ifds.forEach(function (ifd) {
      var ph = t.num(ifd, TAG.Photometric); if (ph !== 32803 && ph !== 34892) return;
      var a = (t.num(ifd, TAG.ImageWidth) || 0) * (t.num(ifd, TAG.ImageLength) || 0); if (a > best) { best = a; raw = ifd; }
    });
    if (!raw) throw new Error('no-raw-ifd');
    var m = { t: t, ifd0: ifd0, raw: raw, ifds: ifds }, ph = t.num(raw, TAG.Photometric);
    m.make = t.str(ifd0, TAG.Make); m.model = t.str(ifd0, TAG.Model); m.uniqueModel = t.str(ifd0, TAG.UniqueModel);
    m.width = t.num(raw, TAG.ImageWidth); m.height = t.num(raw, TAG.ImageLength);
    m.bits = t.arr(raw, TAG.BitsPerSample) || [16]; m.spp = t.num(raw, TAG.SamplesPerPixel) || 1;
    m.compression = t.num(raw, TAG.Compression) || 1; m.compressionName = COMPRESSION[m.compression] || ('compression-' + m.compression);
    m.sampleFormat = t.num(raw, TAG.SampleFormat) || 1; m.predictor = t.num(raw, TAG.Predictor) || 1;
    m.linear = ph === 34892; m.photometric = ph;
    m.orientation = t.num(ifd0, TAG.Orientation) || t.num(raw, TAG.Orientation) || 1;
    var ex = null; ifds.forEach(function (i) { if (i.role === 'exif') ex = i; });
    if (ex) { m.exposureTime = t.num(ex, TAG.ExposureTime); m.fNumber = t.num(ex, TAG.FNumber); m.iso = t.num(ex, TAG.ISO); m.focalLength = t.num(ex, TAG.FocalLength); }
    if (!m.linear) {
      var rep = t.arr(raw, TAG.CFARepeat) || [2, 2], pat = t.arr(raw, TAG.CFAPattern), planes = t.arr(raw, TAG.CFAPlaneColor) || [0, 1, 2];
      m.cfaRepeat = rep;
      if (!pat || rep[0] !== 2 || rep[1] !== 2) throw new Error('cfa-' + rep[0] + 'x' + rep[1]);
      if (t.num(raw, TAG.CFALayout) > 1) throw new Error('cfa-layout');
      m.cfa = pat.map(function (p) { return planes[p] == null ? p : planes[p]; });
      if (m.cfa.some(function (c) { return c > 2; })) throw new Error('cfa-colors');
      m.cfaName = m.cfa.map(function (c) { return 'RGB'[c]; }).join('');
    }
    // levels
    var rep2 = t.arr(raw, TAG.BlackRepeat) || [1, 1], bl = t.arr(raw, TAG.BlackLevel) || [0];
    m.blackRepeat = rep2; m.blackLevel = bl;
    var black4 = [0, 0, 0, 0];
    if (rep2[0] === 2 && rep2[1] === 2 && bl.length >= 4) black4 = bl.slice(0, 4);
    else if (!m.linear && bl.length >= 1) black4 = [bl[0], bl[0], bl[0], bl[0]];
    m.black4 = black4;
    m.blackDeltaV = t.arr(raw, TAG.BlackDeltaV); m.blackDeltaH = t.arr(raw, TAG.BlackDeltaH);
    var wl = t.arr(raw, TAG.WhiteLevel); m.whiteLevel = wl ? wl[0] : (m.sampleFormat === 3 ? 1 : (Math.pow(2, m.bits[0]) - 1));
    m.whiteLevels = wl;
    m.linearization = t.arr(raw, TAG.Linearization);
    var aa = t.arr(raw, TAG.ActiveArea); m.activeArea = aa && aa.length === 4 ? aa : [0, 0, m.height, m.width];
    var co = t.arr(raw, TAG.CropOrigin), cs = t.arr(raw, TAG.CropSize), sc = t.arr(raw, TAG.DefaultScale);
    var aw = m.activeArea[3] - m.activeArea[1], ah = m.activeArea[2] - m.activeArea[0];
    m.cropOrigin = co && co.length === 2 ? [Math.round(co[0]), Math.round(co[1])] : [0, 0];
    m.cropSize = cs && cs.length === 2 ? [Math.round(cs[0]), Math.round(cs[1])] : [aw - m.cropOrigin[0] * 2, ah - m.cropOrigin[1] * 2];
    if (!(cs && cs.length === 2)) m.cropSize = [aw, ah];
    m.defaultScale = sc && sc.length === 2 ? sc : [1, 1];
    // colour
    m.colorMatrix1 = getMatrix(t, ifd0, TAG.ColorMatrix1) || getMatrix(t, raw, TAG.ColorMatrix1);
    m.colorMatrix2 = getMatrix(t, ifd0, TAG.ColorMatrix2) || getMatrix(t, raw, TAG.ColorMatrix2);
    m.forwardMatrix1 = getMatrix(t, ifd0, TAG.ForwardMatrix1); m.forwardMatrix2 = getMatrix(t, ifd0, TAG.ForwardMatrix2);
    m.cameraCal1 = getMatrix(t, ifd0, TAG.CameraCal1); m.cameraCal2 = getMatrix(t, ifd0, TAG.CameraCal2);
    m.analogBalance = t.arr(ifd0, TAG.AnalogBalance);
    m.illuminant1 = t.num(ifd0, TAG.Illuminant1); m.illuminant2 = t.num(ifd0, TAG.Illuminant2);
    m.asShotNeutral = t.arr(ifd0, TAG.AsShotNeutral); m.asShotWhiteXY = t.arr(ifd0, TAG.AsShotWhiteXY);
    m.baselineExposure = t.num(ifd0, TAG.BaselineExposure) || 0;
    m.noiseProfile = t.arr(ifd0, TAG.NoiseProfile);
    m.lensInfo = t.arr(ifd0, TAG.LensInfo);
    m.profileName = t.str(ifd0, TAG.ProfileName); m.hasHueSatMap = !!ifd0.tags[50938] || !!ifd0.tags[50982];
    m.opcodes = { list1: parseOpcodes(t.bytes(raw, TAG.OpcodeList1) || t.bytes(ifd0, TAG.OpcodeList1)), list2: parseOpcodes(t.bytes(raw, TAG.OpcodeList2) || t.bytes(ifd0, TAG.OpcodeList2)), list3: parseOpcodes(t.bytes(raw, TAG.OpcodeList3) || t.bytes(ifd0, TAG.OpcodeList3)) };
    if (!m.colorMatrix1 && !m.colorMatrix2 && !m.forwardMatrix1 && !m.forwardMatrix2) m.noColor = true;
    return m;
  }

  function unsupportedWhy(code) {
    var table = {
      'jpeg-xl': 'This DNG uses JPEG XL compression (DNG 1.7). The built-in reader does not decode it; the camera RAW module can, or convert it to a standard DNG first.',
      'lossy-jpeg': 'This DNG uses lossy JPEG compression, which the built-in reader does not decode.',
      'cfa-layout': 'This DNG uses a staggered sensor layout the built-in reader does not handle.',
      'cfa-colors': 'This DNG has more than three colour channels (for example RGBE or CMYG).',
      'bad-tiff': 'The file structure is damaged.', 'not-dng': 'Not a DNG.', 'no-raw-ifd': 'No raw image data was found in this file.', 'bigtiff': 'BigTIFF files are not supported.'
    };
    if (/^cfa-\d+x\d+$/.test(code)) return 'This sensor uses a ' + code.slice(4).replace('x', ' by ') + ' colour pattern (for example Fujifilm X-Trans); the built-in reader only handles standard Bayer sensors. The camera RAW module covers it.';
    return table[code] || code;
  }

  /* ================================================================== lossless JPEG (ITU T.81 process 14, SOF3) */
  function decodeLJ92(u8, start, end) {
    var o = start, n = end, i, frame = null, tables = [null, null, null, null], scan = null, dri = 0;
    if (u8[o] !== 0xFF || u8[o + 1] !== 0xD8) throw new Error('lj92-no-soi');
    o += 2;
    for (;;) {
      if (o + 4 > n) throw new Error('lj92-truncated');
      if (u8[o] !== 0xFF) throw new Error('lj92-marker');
      var m = u8[o + 1]; if (m === 0xFF) { o++; continue; }
      var len = u8[o + 2] << 8 | u8[o + 3], p = o + 4;
      if (m === 0xC3) { frame = { prec: u8[p], h: u8[p + 1] << 8 | u8[p + 2], w: u8[p + 3] << 8 | u8[p + 4], nc: u8[p + 5] }; if (frame.nc < 1 || frame.nc > 4) throw new Error('lj92-comps'); }
      else if (m === 0xC0 || m === 0xC1 || m === 0xC2 || m === 0xC9 || m === 0xCA) throw new Error('lj92-not-lossless');
      else if (m === 0xC4) {
        var q = p; while (q < o + 2 + len) { var tc = u8[q] >> 4, th = u8[q] & 15, counts = u8.subarray(q + 1, q + 17), tot = 0; for (i = 0; i < 16; i++) tot += counts[i]; var syms = u8.subarray(q + 17, q + 17 + tot); tables[th & 3] = buildHuff(counts, syms); q += 17 + tot; }
      } else if (m === 0xDD) dri = u8[p] << 8 | u8[p + 1];
      else if (m === 0xDA) { scan = { ns: u8[p], comps: [], pred: 0, pt: 0 }; for (i = 0; i < scan.ns; i++) scan.comps.push({ td: u8[p + 2 + i * 2] >> 4 }); var s2 = p + 1 + scan.ns * 2; scan.pred = u8[s2]; scan.pt = u8[s2 + 2] & 15; o += 2 + len; break; }
      o += 2 + len;
    }
    if (!frame || !scan) throw new Error('lj92-no-frame');
    if (dri) throw new Error('lj92-restart');
    // unstuff entropy data
    var bytes = new Uint8Array(n - o), bn = 0;
    for (i = o; i < n; i++) { var b = u8[i]; if (b === 0xFF) { var nx = u8[i + 1]; if (nx === 0) { bytes[bn++] = 0xFF; i++; continue; } break; } bytes[bn++] = b; }
    var X = frame.w, Y = frame.h, nc = frame.nc, out = new Uint16Array(X * Y * nc), pt = scan.pt, pred = scan.pred, prec = frame.prec;
    var acc = 0, nb = 0, pos = 0, init = 1 << (prec - pt - 1), mask = (1 << prec) - 1;
    var tabs = scan.comps.map(function (c) { var tb = tables[c.td]; if (!tb) throw new Error('lj92-no-table'); return tb; });
    function fill() { while (nb <= 24) { acc = ((acc << 8) | (pos < bn ? bytes[pos] : 0)) >>> 0; pos++; nb += 8; } }
    var x, y, c, rowStride = X * nc, idx = 0;
    for (y = 0; y < Y; y++) for (x = 0; x < X; x++) for (c = 0; c < nc; c++, idx++) {
      var tb = tabs[c % tabs.length]; fill();
      var look = tb[(acc >>> (nb - 16)) & 0xFFFF], l = look >> 8, s = look & 255;
      if (l === 0) throw new Error('lj92-bad-code');
      nb -= l; var diff;
      if (s === 0) diff = 0; else if (s === 16) diff = 32768; else { fill(); var v = (acc >>> (nb - s)) & ((1 << s) - 1); nb -= s; diff = v < (1 << (s - 1)) ? v - (1 << s) + 1 : v; }
      acc &= nb >= 32 ? 0xFFFFFFFF : ((1 << nb) - 1);
      var px;
      if (y === 0 && x === 0) px = init;
      else if (y === 0) px = out[idx - nc] >> pt;
      else if (x === 0) px = out[idx - rowStride] >> pt;
      else {
        var Ra = out[idx - nc] >> pt, Rb = out[idx - rowStride] >> pt, Rc = out[idx - rowStride - nc] >> pt;
        switch (pred) { case 1: px = Ra; break; case 2: px = Rb; break; case 3: px = Rc; break; case 4: px = Ra + Rb - Rc; break; case 5: px = Ra + ((Rb - Rc) >> 1); break; case 6: px = Rb + ((Ra - Rc) >> 1); break; case 7: px = (Ra + Rb) >> 1; break; default: px = Ra; }
      }
      out[idx] = ((px + diff) & mask) << pt;
    }
    return { w: X, h: Y, nc: nc, prec: prec, data: out };
  }
  function buildHuff(counts, syms) {
    var tab = new Uint16Array(65536), code = 0, k = 0;
    for (var l = 1; l <= 16; l++) { for (var i = 0; i < counts[l - 1]; i++) { var lo = code << (16 - l), hi = (code + 1) << (16 - l); var v = (l << 8) | syms[k++]; for (var j = lo; j < hi && j < 65536; j++) tab[j] = v; code++; } code <<= 1; }
    return tab;
  }

  /* ================================================================== raster decoding (strips and tiles) */
  function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('no-inflate'));
    var ds = new DecompressionStream('deflate'), w = ds.writable.getWriter(); w.write(u8); w.close();
    return new Response(ds.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  function unpackBits(u8, bits, count, le, out, outOff) {
    var i, acc = 0, nb = 0, o = 0, mask = (1 << bits) - 1;
    if (bits === 16) { for (i = 0; i < count; i++) out[outOff + i] = le ? u8[2 * i] | u8[2 * i + 1] << 8 : u8[2 * i] << 8 | u8[2 * i + 1]; return; }
    if (bits === 8) { for (i = 0; i < count; i++) out[outOff + i] = u8[i]; return; }
    for (i = 0; i < count; i++) { while (nb < bits) { acc = (acc << 8) | (o < u8.length ? u8[o] : 0); o++; nb += 8; } nb -= bits; out[outOff + i] = (acc >>> nb) & mask; acc &= (1 << nb) - 1; }
  }

  /* Returns Promise<{ data: Uint16Array|Float32Array, width, height, spp }> holding the whole raw raster (CFA: spp=1; linear: spp=3). */
  function decodeMosaic(buf, m, o) {
    o = o || {}; var t = m.t, raw = m.raw, W = m.width, H = m.height, spp = m.spp, bits = m.bits[0], i;
    var isFloat = m.sampleFormat === 3, comp = m.compression;
    if (comp === 52546) return Promise.reject(new Error('jpeg-xl'));
    if (comp === 34892 || (comp !== 1 && comp !== 7 && comp !== 8 && comp !== 32946)) return Promise.reject(new Error(comp === 34892 ? 'lossy-jpeg' : 'compression-' + comp));
    if (m.bits.some(function (b) { return b !== bits; })) return Promise.reject(new Error('mixed-bits'));
    var tiled = !!raw.tags[TAG.TileWidth], tw, th, offs, cnts, tilesX, tilesY;
    if (tiled) { tw = t.num(raw, TAG.TileWidth); th = t.num(raw, TAG.TileLength); offs = t.arr(raw, TAG.TileOffsets); cnts = t.arr(raw, TAG.TileByteCounts); tilesX = Math.ceil(W / tw); tilesY = Math.ceil(H / th); }
    else { tw = W; th = t.num(raw, TAG.RowsPerStrip) || H; if (th > H) th = H; offs = t.arr(raw, TAG.StripOffsets); cnts = t.arr(raw, TAG.StripByteCounts); tilesX = 1; tilesY = Math.ceil(H / th); }
    if (!offs || !cnts) return Promise.reject(new Error('no-offsets'));
    var planar = t.num(raw, TAG.PlanarConfig) || 1; if (planar !== 1 && spp > 1) return Promise.reject(new Error('planar'));
    var out = isFloat ? new Float32Array(W * H * spp) : new Uint16Array(W * H * spp), u8 = new Uint8Array(buf), le = t.le, total = tilesX * tilesY, idx = 0;
    if (isFloat && bits !== 32 && bits !== 16) return Promise.reject(new Error('float-bits'));
    if (!isFloat && bits > 16) return Promise.reject(new Error('bits-' + bits));
    function one(k) {
      if (o.signal && o.signal.aborted) return Promise.reject(new DOMExceptionLike('aborted'));
      var tx = k % tilesX, ty = (k / tilesX) | 0, x0 = tx * tw, y0 = ty * th, rows = tiled ? th : Math.min(th, H - y0), cw = tw, off = offs[k], len = cnts[k];
      if (off + len > u8.length) return Promise.reject(new Error('truncated'));
      var chunk = u8.subarray(off, off + len), rowVals = cw * spp, tile;
      function place(tileData) { // copy tile rows into the raster, clipping at the image edge
        var vis = Math.min(cw, W - x0), visRows = Math.min(rows, H - y0), r, base;
        for (r = 0; r < visRows; r++) { base = ((y0 + r) * W + x0) * spp; out.set(tileData.subarray(r * rowVals, r * rowVals + vis * spp), base); }
      }
      if (comp === 7) {
        var j = decodeLJ92(u8, off, off + len); var d = j.data;
        if (d.length < rowVals * rows) { var pad = new Uint16Array(rowVals * rows); pad.set(d); d = pad; }
        place(d); return Promise.resolve();
      }
      var p = comp === 1 ? Promise.resolve(chunk) : inflate(chunk);
      return p.then(function (bytes) {
        var vals = rowVals * rows;
        if (isFloat) {
          tile = new Float32Array(vals); var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), bps = bits / 8, pr = m.predictor;
          if (pr === 3 || pr === 34894 || pr === 34895) { // floating point predictor: byte planes per row, delta coded
            var rowBytes = rowVals * bps, tmp = new Uint8Array(rowBytes);
            for (var r = 0; r < rows; r++) { var rb = bytes.subarray(r * rowBytes, (r + 1) * rowBytes); var a = new Uint8Array(rb); for (var q = spp; q < rowBytes; q++) a[q] = (a[q] + a[q - spp]) & 255; for (var v = 0; v < rowVals; v++) for (var b = 0; b < bps; b++) tmp[v * bps + b] = a[b * rowVals + v]; var dv2 = new DataView(tmp.buffer); for (var v2 = 0; v2 < rowVals; v2++) tile[r * rowVals + v2] = bits === 32 ? dv2.getFloat32(v2 * 4, false) : halfToFloat(dv2.getUint16(v2 * 2, false)); }
          } else for (var z = 0; z < vals; z++) tile[z] = bits === 32 ? dv.getFloat32(z * 4, le) : halfToFloat(dv.getUint16(z * 2, le));
        } else {
          tile = new Uint16Array(vals);
          if (comp === 1) { var rb2 = Math.ceil(rowVals * bits / 8); for (var r3 = 0; r3 < rows; r3++) unpackBits(bytes.subarray(r3 * rb2, (r3 + 1) * rb2), bits, rowVals, le, tile, r3 * rowVals); }
          else { // deflate integer
            if (bits === 16) unpackBits(bytes, 16, vals, le, tile, 0); else { var rb3 = Math.ceil(rowVals * bits / 8); for (var r4 = 0; r4 < rows; r4++) unpackBits(bytes.subarray(r4 * rb3, (r4 + 1) * rb3), bits, rowVals, le, tile, r4 * rowVals); }
            if (m.predictor === 2) { var mk = (1 << bits) - 1; for (var r5 = 0; r5 < rows; r5++) for (var xx = spp; xx < rowVals; xx++) tile[r5 * rowVals + xx] = (tile[r5 * rowVals + xx] + tile[r5 * rowVals + xx - spp]) & mk; }
          }
        }
        place(tile);
      });
    }
    var progress = o.onProgress || function () { };
    // decode sequentially so memory stays flat and cancellation is prompt
    function next() { if (idx >= total) return Promise.resolve(); var k = idx++; return one(k).then(function () { progress(idx / total); return next(); }); }
    return next().then(function () { return { data: out, width: W, height: H, spp: spp, bits: bits, isFloat: isFloat }; });
  }
  function DOMExceptionLike(msg) { var e = new Error(msg); e.name = 'AbortError'; return e; }
  function halfToFloat(h) { var s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF; if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024); if (e === 31) return f ? NaN : (s ? -Infinity : Infinity); return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024); }

  /* ================================================================== colour science */
  var MAT = {
    mul: function (a, b) { var r = new Array(9); for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; },
    vec: function (m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; },
    inv: function (m) { var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8]; var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null; return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]; },
    diag: function (v) { return [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]; },
    lerp: function (a, b, w) { return a.map(function (v, i) { return v * w + b[i] * (1 - w); }); }
  };
  var D50 = [0.96422, 1, 0.82521], D65 = [0.95047, 1, 1.08883];
  var BRAD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  function bradford(src, dst) { var s = MAT.vec(BRAD, src), d = MAT.vec(BRAD, dst); return MAT.mul(MAT.inv(BRAD), MAT.mul(MAT.diag([d[0] / s[0], d[1] / s[1], d[2] / s[2]]), BRAD)); }
  function xyToXYZ(x, y) { return [x / y, 1, (1 - x - y) / y]; }
  function xyzToXY(v) { var s = v[0] + v[1] + v[2]; return [v[0] / s, v[1] / s]; }
  /* Kim et al. (2002) cubic approximation of the Planckian locus, 1667 K to 25000 K */
  function planckXY(T) {
    T = Math.max(1667, Math.min(25000, T)); var x, y;
    if (T <= 4000) x = -0.2661239e9 / (T * T * T) - 0.2343589e6 / (T * T) + 0.8776956e3 / T + 0.179910; else x = -3.0258469e9 / (T * T * T) + 2.1070379e6 / (T * T) + 0.2226347e3 / T + 0.240390;
    if (T <= 2222) y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683; else if (T <= 4000) y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867; else y = 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
    return [x, y];
  }
  function xyToCCT(xy) { var n = (xy[0] - 0.3320) / (0.1858 - xy[1]); return 449 * n * n * n + 3525 * n * n + 6823.3 * n + 5520.33; } // McCamy
  function xyToUV(xy) { var d = -2 * xy[0] + 12 * xy[1] + 3; return [4 * xy[0] / d, 6 * xy[1] / d]; }
  function uvToXY(uv) { var d = 2 * uv[0] - 8 * uv[1] + 4; return [3 * uv[0] / d, 2 * uv[1] / d]; }
  /* white point (xy) of a light at colour temperature T with a tint offset (Duv = tint * 0.0002; positive = greener light, i.e. the picture gets more magenta) */
  function whiteFromTempTint(T, tint) {
    var xy = planckXY(T), uv = xyToUV(xy), a = xyToUV(planckXY(T - 20)), b = xyToUV(planckXY(T + 20)), tx = b[0] - a[0], ty = b[1] - a[1], l = Math.sqrt(tx * tx + ty * ty) || 1;
    var nx = -ty / l, ny = tx / l; if (ny < 0) { nx = -nx; ny = -ny; } var duv = (tint || 0) * 0.0002;
    return uvToXY([uv[0] + nx * duv, uv[1] + ny * duv]);
  }
  function tempTintFromXY(xy) {
    var T = xyToCCT(xy); for (var i = 0; i < 3; i++) { var p = planckXY(T), uv0 = xyToUV(p), uv = xyToUV(xy); T = xyToCCT(xy); }
    var p2 = planckXY(Math.max(1667, Math.min(25000, T))), u0 = xyToUV(p2), u1 = xyToUV(xy), a = xyToUV(planckXY(T - 20)), b = xyToUV(planckXY(T + 20)), tx = b[0] - a[0], ty = b[1] - a[1], l = Math.sqrt(tx * tx + ty * ty) || 1;
    var nx = -ty / l, ny = tx / l; if (ny < 0) { nx = -nx; ny = -ny; }
    return { temp: T, tint: ((u1[0] - u0[0]) * nx + (u1[1] - u0[1]) * ny) / 0.0002 };
  }
  var ILLUM_T = { 1: 5500, 2: 4200, 3: 2850, 4: 5500, 9: 6500, 10: 6000, 11: 7500, 12: 6430, 13: 5050, 14: 4230, 15: 3450, 17: 2856, 18: 4874, 19: 6774, 20: 5503, 21: 6504, 22: 7504, 23: 5003, 24: 3200 };
  function illumTemp(code, fallback) { return ILLUM_T[code] || fallback; }

  var SPACES = {
    'srgb': { r: [0.640, 0.330], g: [0.300, 0.600], b: [0.150, 0.060], w: [0.3127, 0.3290] },
    'display-p3': { r: [0.680, 0.320], g: [0.265, 0.690], b: [0.150, 0.060], w: [0.3127, 0.3290] },
    'rec2020': { r: [0.708, 0.292], g: [0.170, 0.797], b: [0.131, 0.046], w: [0.3127, 0.3290] },
    'prophoto': { r: [0.7347, 0.2653], g: [0.1596, 0.8404], b: [0.0366, 0.0001], w: [0.3457, 0.3585] }
  };
  function rgbToXYZD50(space) { // linear RGB of `space` -> XYZ adapted to D50
    var s = SPACES[space] || SPACES.srgb, r = xyToXYZ(s.r[0], s.r[1]), g = xyToXYZ(s.g[0], s.g[1]), b = xyToXYZ(s.b[0], s.b[1]), w = xyToXYZ(s.w[0], s.w[1]);
    var P = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]], S = MAT.vec(MAT.inv(P), w);
    var M = [P[0] * S[0], P[1] * S[1], P[2] * S[2], P[3] * S[0], P[4] * S[1], P[5] * S[2], P[6] * S[0], P[7] * S[1], P[8] * S[2]];
    return MAT.mul(bradford(w, D50), M);
  }
  function xyzD50ToRGB(space) { return MAT.inv(rgbToXYZD50(space)); }

  /* DNG colour: returns everything needed to turn camera RGB into XYZ D50 for a chosen white.
   *   wb: undefined/'as-shot' | { temp, tint } | { neutral:[r,g,b] } | { xy:[x,y] }
   * result: { gains:[3] (multiply camera RGB by these: neutral -> 1), matrix: 3x3 applied AFTER the gains (white-balanced camera -> XYZ D50), neutral, temp, tint, xy } */
  function cameraMatrices(m, wb) {
    var ab = m.analogBalance && m.analogBalance.length === 3 ? m.analogBalance : [1, 1, 1];
    var T1 = illumTemp(m.illuminant1, 2856), T2 = illumTemp(m.illuminant2, 6504), cm1 = m.colorMatrix1, cm2 = m.colorMatrix2, fm1 = m.forwardMatrix1, fm2 = m.forwardMatrix2;
    var I = [1, 0, 0, 0, 1, 0, 0, 0, 1], cc1 = m.cameraCal1 || I, cc2 = m.cameraCal2 || I;
    if (!cm1 && !cm2) { // a DNG without matrices: assume the camera is already close to sRGB primaries (honest fallback, flagged in meta)
      return { gains: [1, 1, 1], matrix: bradford(D65, D50), neutral: [1, 1, 1], temp: 6500, tint: 0, xy: [0.3127, 0.329], fallback: true };
    }
    if (!cm1) { cm1 = cm2; fm1 = fm2; cc1 = cc2; T1 = T2; } if (!cm2) { cm2 = cm1; fm2 = fm1; cc2 = cc1; T2 = T1; }
    var lo = T1 <= T2 ? { cm: cm1, fm: fm1, cc: cc1, T: T1 } : { cm: cm2, fm: fm2, cc: cc2, T: T2 }, hi = T1 <= T2 ? { cm: cm2, fm: fm2, cc: cc2, T: T2 } : { cm: cm1, fm: fm1, cc: cc1, T: T1 };
    function interp(T) { var w = lo.T === hi.T ? 1 : (1 / T - 1 / hi.T) / (1 / lo.T - 1 / hi.T); w = Math.max(0, Math.min(1, w)); return { cm: MAT.lerp(lo.cm, hi.cm, w), fm: lo.fm && hi.fm ? MAT.lerp(lo.fm, hi.fm, w) : null, cc: MAT.lerp(lo.cc, hi.cc, w) }; }
    function x2c(i) { return MAT.mul(MAT.diag(ab), MAT.mul(i.cc, i.cm)); }
    var T, neutral, tint = 0, xy, i;
    wb = wb || 'as-shot';
    if (wb === 'as-shot') {
      if (m.asShotNeutral && m.asShotNeutral.length === 3) {
        neutral = m.asShotNeutral.slice(); T = 5000;
        for (var it = 0; it < 30; it++) { var cur = interp(T), inv = MAT.inv(x2c(cur)); if (!inv) break; var xyz = MAT.vec(inv, neutral), nt = xyToCCT(xyzToXY(xyz)); if (!isFinite(nt)) break; nt = Math.max(1700, Math.min(25000, nt)); if (Math.abs(nt - T) < 5) { T = nt; break; } T = nt; }
        xy = xyzToXY(MAT.vec(MAT.inv(x2c(interp(T))), neutral));
      } else if (m.asShotWhiteXY) { xy = m.asShotWhiteXY.slice(); T = Math.max(1700, Math.min(25000, xyToCCT(xy))); }
      else { T = 5000; xy = whiteFromTempTint(T, 0); }
    } else if (wb.neutral) {
      neutral = wb.neutral.slice(); T = 5000;
      for (i = 0; i < 30; i++) { var c2 = interp(T), iv = MAT.inv(x2c(c2)); var xz = MAT.vec(iv, neutral), n2 = Math.max(1700, Math.min(25000, xyToCCT(xyzToXY(xz)))); if (Math.abs(n2 - T) < 5) { T = n2; break; } T = n2; }
      xy = xyzToXY(MAT.vec(MAT.inv(x2c(interp(T))), neutral));
    } else if (wb.xy) { xy = wb.xy; T = Math.max(1700, Math.min(25000, xyToCCT(xy))); }
    else { xy = whiteFromTempTint(wb.temp || 5000, wb.tint || 0); T = wb.temp || 5000; }
    var cur2 = interp(T), X2C = x2c(cur2);
    if (!neutral) { var white = xyToXYZ(xy[0], xy[1]); neutral = MAT.vec(X2C, white); var mx = Math.max(neutral[0], neutral[1], neutral[2]); neutral = neutral.map(function (v) { return v / mx; }); }
    var mxn = Math.max(neutral[0], neutral[1], neutral[2]); neutral = neutral.map(function (v) { return v / mxn; });
    var gains = neutral.map(function (v) { return 1 / v; }), matrix;
    if (cur2.fm) { // ForwardMatrix maps white balanced reference camera to XYZ D50
      var abcc = MAT.mul(MAT.diag(ab), cur2.cc), abinv = MAT.inv(abcc), refN = MAT.vec(abinv, neutral);
      // native -> reference -> white balance -> FM; applied after `gains`, so fold the reference conversion in front of the gains correctly:
      // camera(native) * gains gives white-balanced native; FM expects white-balanced reference = diag(1/refN) * abinv * native
      matrix = MAT.mul(cur2.fm, MAT.mul(MAT.diag(refN.map(function (v) { return 1 / v; })), MAT.mul(abinv, MAT.diag(neutral))));
    } else {
      var inv2 = MAT.inv(X2C), wxyz = MAT.vec(inv2, neutral), wn = [wxyz[0] / wxyz[1], 1, wxyz[2] / wxyz[1]];
      matrix = MAT.mul(bradford(wn, D50), MAT.mul(inv2, MAT.diag(neutral)));
    }
    var tt = tempTintFromXY(xy);
    return { gains: gains, matrix: matrix, neutral: neutral, temp: wb === 'as-shot' || wb.temp == null ? tt.temp : wb.temp, tint: wb === 'as-shot' || wb.tint == null ? tt.tint : wb.tint, xy: xy, usedForward: !!cur2.fm };
  }
  /* one 3x3 for a renderer: camera RGB (unbalanced) -> linear `space`, white balance included. */
  function cameraToSpace(m, wb, space) {
    var cm = cameraMatrices(m, wb), toRGB = xyzD50ToRGB(space || 'srgb'), full = MAT.mul(toRGB, MAT.mul(cm.matrix, MAT.diag(cm.gains)));
    return { matrix: full, gains: cm.gains, wbMatrix: MAT.mul(toRGB, cm.matrix), neutral: cm.neutral, temp: cm.temp, tint: cm.tint, usedForward: cm.usedForward, fallback: !!cm.fallback };
  }

  /* ================================================================== demosaicing */
  /* Both functions take a padded float band P (stride sw = w+4, rows h+4; the 2-pixel border is a mirror that keeps the Bayer phase)
   * whose pixel (px,py) = band pixel (px-2, py-2). `ph` = colour index (0 R,1 G,2 B) of band pixel (0,0) in a 2x2 pattern cfa[4] (phase folded in by the caller).
   * They write interleaved RGB (3 floats per pixel) into out, offset oo, for the w x h band. */
  function demosaicMHC(P, sw, w, h, cfa, out, oo) {
    var x, y, o, i, c;
    for (y = 0; y < h; y++) {
      var py = y + 2, ry = y & 1, row = py * sw;
      for (x = 0; x < w; x++) {
        i = row + x + 2; c = cfa[ry * 2 + (x & 1)];
        var v = P[i], r, g, b;
        var l1 = P[i - 1], r1 = P[i + 1], u1 = P[i - sw], d1 = P[i + sw], l2 = P[i - 2], r2 = P[i + 2], u2 = P[i - 2 * sw], d2 = P[i + 2 * sw];
        if (c === 1) {
          g = v;
          // is the horizontal neighbour red or blue?
          var hc = cfa[ry * 2 + ((x + 1) & 1)];
          var ul = P[i - sw - 1], ur = P[i - sw + 1], dl = P[i + sw - 1], dr = P[i + sw + 1];
          // gradient-corrected bilinear (Malvar-He-Cutler 2004)
          var cA = (5 * v - l2 - r2 - ul - ur - dl - dr + 0.5 * (u2 + d2) + 4 * (l1 + r1)) * 0.125;      // colour of horizontal neighbours at this G
          var cB = (5 * v - u2 - d2 - ul - ur - dl - dr + 0.5 * (l2 + r2) + 4 * (u1 + d1)) * 0.125;      // colour of vertical neighbours at this G
          if (hc === 0) { r = cA; b = cB; } else { b = cA; r = cB; }
        } else {
          var ul2 = P[i - sw - 1], ur2 = P[i - sw + 1], dl2 = P[i + sw - 1], dr2 = P[i + sw + 1];
          g = (4 * v - l2 - r2 - u2 - d2 + 2 * (l1 + r1 + u1 + d1)) * 0.125;
          var oth = (6 * v - 1.5 * (l2 + r2 + u2 + d2) + 2 * (ul2 + ur2 + dl2 + dr2)) * 0.125;      // the opposite colour (B at R, R at B)
          if (c === 0) { r = v; b = oth; } else { b = v; r = oth; }
        }
        o = oo + (y * w + x) * 3; out[o] = r; out[o + 1] = g; out[o + 2] = b;
      }
    }
  }

  /* Hamilton-Adams style edge-directed demosaic: gradient-chosen green, then colour differences (R-G, B-G) interpolated, diagonal-gradient chosen at opposite sites. */
  function demosaicED(P, sw, w, h, cfa, out, oo, Gtmp) {
    var x, y, i, o, bw = w + 4, bh = h + 4;
    var G = Gtmp && Gtmp.length >= bw * bh ? Gtmp : new Float32Array(bw * bh); // green plane over the padded area (interior + 1 px margin computed)
    // pass 1: green at R and B sites over [1, h+3) x [1, w+3); pad phase: padded pixel (px,py) has band coords (px-2,py-2) -> colour cfa[((py-2)&1)*2 + ((px-2)&1)] == cfa[(py&1)*2+(px&1)]
    for (y = 2; y < h + 2; y++) for (x = 2; x < w + 2; x++) {
      i = y * sw + x; var c = cfa[(y & 1) * 2 + (x & 1)];
      if (c === 1) { G[y * bw + x] = P[i]; continue; }
      var v = P[i], gl = P[i - 1], gr = P[i + 1], gu = P[i - sw], gd = P[i + sw];
      var dh = Math.abs(gl - gr) + Math.abs(2 * v - P[i - 2] - P[i + 2]), dv = Math.abs(gu - gd) + Math.abs(2 * v - P[i - 2 * sw] - P[i + 2 * sw]), g;
      if (dh < dv) g = (gl + gr) * 0.5 + (2 * v - P[i - 2] - P[i + 2]) * 0.25;
      else if (dh > dv) g = (gu + gd) * 0.5 + (2 * v - P[i - 2 * sw] - P[i + 2 * sw]) * 0.25;
      else g = (gl + gr + gu + gd) * 0.25 + (4 * v - P[i - 2] - P[i + 2] - P[i - 2 * sw] - P[i + 2 * sw]) * 0.125;
      G[y * bw + x] = g;
    }
    // fill G in the 2-pixel border for neighbours used below by simple copy of the nearest computed value (rows/cols 1 only needed)
    for (x = 0; x < bw; x++) { G[0 * bw + x] = G[2 * bw + x]; G[1 * bw + x] = G[2 * bw + x]; G[(bh - 1) * bw + x] = G[(bh - 3) * bw + x]; G[(bh - 2) * bw + x] = G[(bh - 3) * bw + x]; }
    for (y = 0; y < bh; y++) { G[y * bw] = G[y * bw + 2]; G[y * bw + 1] = G[y * bw + 2]; G[y * bw + bw - 1] = G[y * bw + bw - 3]; G[y * bw + bw - 2] = G[y * bw + bw - 3]; }
    // pass 2: R and B
    for (y = 2; y < h + 2; y++) for (x = 2; x < w + 2; x++) {
      i = y * sw + x; var gi = y * bw + x, c2 = cfa[(y & 1) * 2 + (x & 1)], v2 = P[i], g2 = G[gi], r, b;
      if (c2 === 1) {
        var hc = cfa[(y & 1) * 2 + ((x + 1) & 1)]; // colour of the horizontal neighbours
        var dH = ((P[i - 1] - G[gi - 1]) + (P[i + 1] - G[gi + 1])) * 0.5, dV = ((P[i - sw] - G[gi - bw]) + (P[i + sw] - G[gi + bw])) * 0.5;
        if (hc === 0) { r = g2 + dH; b = g2 + dV; } else { b = g2 + dH; r = g2 + dV; }
      } else {
        // opposite colour from the four diagonals, choosing the smoother diagonal direction
        var d1a = P[i - sw - 1], d1b = P[i + sw + 1], d2a = P[i - sw + 1], d2b = P[i + sw - 1];
        var g1a = G[gi - bw - 1], g1b = G[gi + bw + 1], g2a = G[gi - bw + 1], g2b = G[gi + bw - 1];
        var n1 = Math.abs(d1a - d1b) + Math.abs(2 * g2 - g1a - g1b), n2 = Math.abs(d2a - d2b) + Math.abs(2 * g2 - g2a - g2b), diff;
        if (n1 < n2) diff = ((d1a - g1a) + (d1b - g1b)) * 0.5; else if (n1 > n2) diff = ((d2a - g2a) + (d2b - g2b)) * 0.5; else diff = ((d1a - g1a) + (d1b - g1b) + (d2a - g2a) + (d2b - g2b)) * 0.25;
        if (c2 === 0) { r = v2; b = g2 + diff; } else { b = v2; r = g2 + diff; }
      }
      o = oo + ((y - 2) * w + (x - 2)) * 3; out[o] = r; out[o + 1] = g2; out[o + 2] = b;
    }
  }

  /* ================================================================== the CFA -> camera RGB pipeline */
  function reflect(a, n) { if (a < 0) a = -a; if (a >= n) a = 2 * (n - 1) - a; if (a < 0) a = 0; return a; }

  /* gain-map evaluation helpers (opcode GainMap), AA-relative coordinates, normalised over the active area */
  function prepGainOps(ops, aw, ah) {
    var out = [];
    ops.forEach(function (op) {
      if (op.id === 9 && op.gains && !op.bad) {
        var rowI = new Int32Array(ah), rowF = new Float32Array(ah), colI = new Int32Array(aw), colF = new Float32Array(aw), y, x;
        for (y = 0; y < ah; y++) { var pos = (y / Math.max(1, ah - 1) - op.originV) / (op.spacingV || 1); pos = Math.max(0, Math.min(op.rows - 1, pos)); var i0 = Math.min(op.rows - 2 < 0 ? 0 : op.rows - 2, Math.floor(pos)); rowI[y] = i0; rowF[y] = op.rows > 1 ? pos - i0 : 0; }
        for (x = 0; x < aw; x++) { var posx = (x / Math.max(1, aw - 1) - op.originH) / (op.spacingH || 1); posx = Math.max(0, Math.min(op.cols - 1, posx)); var j0 = Math.min(op.cols - 2 < 0 ? 0 : op.cols - 2, Math.floor(posx)); colI[x] = j0; colF[x] = op.cols > 1 ? posx - j0 : 0; }
        out.push({ op: op, rowI: rowI, rowF: rowF, colI: colI, colF: colF });
      }
    });
    return out;
  }
  function gainAt(g, x, y) {
    var op = g.op; if (y < op.top || y >= op.bottom || x < op.left || x >= op.right) return 1;
    if ((y - op.top) % op.rowPitch || (x - op.left) % op.colPitch) return 1;
    var mp = op.mapPlanes, pl = Math.min(mp - 1, 0), i = g.rowI[y], j = g.colI[x], fy = g.rowF[y], fx = g.colF[x], C = op.cols, G = op.gains, r1 = Math.min(op.rows - 1, i + 1), c1 = Math.min(C - 1, j + 1);
    var a = G[(i * C + j) * mp + pl], b = G[(i * C + c1) * mp + pl], c = G[(r1 * C + j) * mp + pl], d = G[(r1 * C + c1) * mp + pl];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /* options: { method: 'ed'|'mhc', half: false, onProgress, signal, crop: true, bandRows: 96, format: 'f32'|'f16'|'u16' }
   * Returns { width, height, data, space: 'camera', format } with camera-native linear RGB, black subtracted, scaled so the sensor white level = 1.0 (before white balance). */
  function developCFA(m, mosaic, o) {
    o = o || {};
    var W = m.width, aa = m.activeArea, aw = aa[3] - aa[1], ah = aa[2] - aa[0], raw = mosaic.data;
    var crop = o.crop === false ? [0, 0, aw, ah] : [m.cropOrigin[0], m.cropOrigin[1], m.cropSize[0], m.cropSize[1]];
    var cx = crop[0], cy = crop[1], cw = Math.min(crop[2], aw - cx), ch = Math.min(crop[3], ah - cy);
    var half = !!o.half, ow = half ? cw >> 1 : cw, oh = half ? ch >> 1 : ch, format = o.format || 'f32';
    var out = format === 'f32' ? new Float32Array(ow * oh * 3) : new Uint16Array(ow * oh * 3);
    var lin = m.linearization, white = m.whiteLevel, black = m.black4, dV = m.blackDeltaV, dH = m.blackDeltaH;
    var wl4 = [white, white, white, white], scale = [0, 0, 0, 0], k;
    for (k = 0; k < 4; k++) scale[k] = 1 / Math.max(1, wl4[k] - black[k]);
    var gains = prepGainOps(m.opcodes.list1.concat(m.opcodes.list2), aw, ah);
    var cfa4 = m.cfa; // colour index for (row&1)*2 + (col&1) relative to the active area origin
    var phase = [cfa4[((cy & 1) << 1) | (cx & 1)], cfa4[((cy & 1) << 1) | ((cx + 1) & 1)], cfa4[(((cy + 1) & 1) << 1) | (cx & 1)], cfa4[(((cy + 1) & 1) << 1) | ((cx + 1) & 1)]];
    var BH = o.bandRows || 96, sw = cw + 4, P = new Float32Array(sw * (BH + 4)), band = new Float32Array(cw * BH * 3), Gt = new Float32Array((cw + 4) * (BH + 4));
    var method = o.method || 'ed', y0, x, y, vignette = m.opcodes.list2.filter(function (p) { return p.id === 3 && p.k; })[0];
    var t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    function getIdx(ax, ay) { return (aa[0] + ay) * W + aa[1] + ax; }
    var vals = null;
    for (y0 = 0; y0 < ch; y0 += BH) {
      var hh = Math.min(BH, ch - y0);
      if (half) hh = Math.min(hh, ch - y0) & ~1 || hh; // even band height for binning
      // fill padded band
      for (y = -2; y < hh + 2; y++) {
        var ay = reflect(cy + y0 + y, ah), prow = (y + 2) * sw, bp = ((ay) & 1) * 2; // phase handled by cfa index parity of the AA coordinate
        var dvv = dV ? dV[ay] || 0 : 0, rowBase = getIdx(0, ay);
        for (x = -2; x < cw + 2; x++) {
          var ax = reflect(cx + x, aw), rv = raw[rowBase + ax], ci = ((ay & 1) << 1) | (ax & 1), bl = black[ci] + dvv + (dH ? dH[ax] || 0 : 0), v;
          if (lin) v = lin[rv < lin.length ? rv : lin.length - 1]; else v = rv;
          v = (v - bl) * scale[ci];
          for (k = 0; k < gains.length; k++) v *= gainAt(gains[k], ax, ay);
          if (vignette) { var rr = Math.sqrt(Math.pow((ax / aw - vignette.cx) * aw / Math.max(aw, ah) * 2, 2) + Math.pow((ay / ah - vignette.cy) * ah / Math.max(aw, ah) * 2, 2)), r2 = rr * rr; v *= 1 + vignette.k[0] * r2 + vignette.k[1] * r2 * r2 + vignette.k[2] * r2 * r2 * r2 + vignette.k[3] * r2 * r2 * r2 * r2 + vignette.k[4] * r2 * r2 * r2 * r2 * r2; }
          P[prow + x + 2] = v;
        }
      }
      if (half) { // 2x2 binning (the two greens averaged): no interpolation, a quarter of the pixels
        for (y = 0; y + 1 < hh; y += 2) for (x = 0; x + 1 < cw; x += 2) {
          var s = [P[(y + 2) * sw + x + 2], P[(y + 2) * sw + x + 3], P[(y + 3) * sw + x + 2], P[(y + 3) * sw + x + 3]], r = 0, g = 0, b = 0, gc = 0;
          for (k = 0; k < 4; k++) { if (phase[k] === 0) r = s[k]; else if (phase[k] === 2) b = s[k]; else { g += s[k]; gc++; } }
          store(out, ((((y0 + y) >> 1) * ow) + (x >> 1)) * 3, r, g / (gc || 1), b, format);
        }
      } else {
        if (method === 'mhc') demosaicMHC(P, sw, cw, hh, phase, band, 0); else demosaicED(P, sw, cw, hh, phase, band, 0, Gt);
        var n = cw * hh * 3, base = y0 * cw * 3;
        if (format === 'f32') out.set(band.subarray(0, n), base); else for (k = 0; k < n; k++) out[base + k] = format === 'f16' ? toHalf(band[k]) : Math.max(0, Math.min(65535, Math.round(band[k] * 16384)));
      }
      if (o.onProgress) o.onProgress(Math.min(1, (y0 + hh) / ch));
      if (o.signal && o.signal.aborted) throw DOMExceptionLike('aborted');
    }
    return { width: ow, height: oh, data: out, space: 'camera', format: format, crop: [cx, cy, cw, ch], ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 };
  }
  function store(out, o, r, g, b, format) {
    if (format === 'f32') { out[o] = r; out[o + 1] = g; out[o + 2] = b; } else if (format === 'f16') { out[o] = toHalf(r); out[o + 1] = toHalf(g); out[o + 2] = toHalf(b); } else { out[o] = Math.max(0, Math.min(65535, Math.round(r * 16384))); out[o + 1] = Math.max(0, Math.min(65535, Math.round(g * 16384))); out[o + 2] = Math.max(0, Math.min(65535, Math.round(b * 16384))); }
  }
  var _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
  function toHalf(v) { // round to nearest even half float bits, clamp to the half range
    _f32[0] = v; var x = _u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xFF) - 127 + 15, mant = x & 0x7FFFFF;
    if (e >= 31) return sign | 0x7BFF; if (e <= 0) { if (e < -10) return sign; mant = (mant | 0x800000) >> (1 - e); return sign | ((mant + 0x1000) >> 13); }
    return sign | (e << 10) | ((mant + 0x1000) >> 13);
  }

  /* linear DNG (three samples per pixel, e.g. phone "ProRAW"): normalise, no demosaic */
  function developLinear(m, mosaic, o) {
    o = o || {}; var aa = m.activeArea, aw = aa[3] - aa[1], ah = aa[2] - aa[0], W = m.width, raw = mosaic.data;
    var crop = o.crop === false ? [0, 0, aw, ah] : [m.cropOrigin[0], m.cropOrigin[1], m.cropSize[0], m.cropSize[1]];
    var cw = Math.min(crop[2], aw - crop[0]), ch = Math.min(crop[3], ah - crop[1]), half = !!o.half, ow = half ? cw >> 1 : cw, oh = half ? ch >> 1 : ch, format = o.format || 'f32';
    var out = format === 'f32' ? new Float32Array(ow * oh * 3) : new Uint16Array(ow * oh * 3), bl = m.blackLevel.length >= 3 ? m.blackLevel : [m.blackLevel[0] || 0, m.blackLevel[0] || 0, m.blackLevel[0] || 0];
    var wl = m.whiteLevel, isF = mosaic.isFloat, gains = prepGainOps(m.opcodes.list1.concat(m.opcodes.list2), aw, ah), lin = m.linearization, x, y, c, k;
    var t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (y = 0; y < oh; y++) for (x = 0; x < ow; x++) {
      var sx = half ? x * 2 : x, sy = half ? y * 2 : y, acc = [0, 0, 0], cnt = half ? 4 : 1;
      for (var dy = 0; dy < (half ? 2 : 1); dy++) for (var dx = 0; dx < (half ? 2 : 1); dx++) {
        var ax = crop[0] + sx + dx, ay = crop[1] + sy + dy, ri = ((aa[0] + ay) * W + aa[1] + ax) * 3, gm = 1; for (k = 0; k < gains.length; k++) gm *= gainAt(gains[k], ax, ay);
        for (c = 0; c < 3; c++) { var rv = raw[ri + c]; if (lin && !isF) rv = lin[rv < lin.length ? rv : lin.length - 1]; acc[c] += (rv - bl[c]) / Math.max(1e-9, wl - bl[c]) * gm; }
      }
      store(out, (y * ow + x) * 3, acc[0] / cnt, acc[1] / cnt, acc[2] / cnt, format);
    }
    return { width: ow, height: oh, data: out, space: 'camera', format: format, crop: [crop[0], crop[1], cw, ch], ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 };
  }

  /* apply a 3x3 (row-major) to an interleaved float RGB image in place, clamping to >= 0 */
  function applyMatrix(data, M, n) {
    n = n || data.length / 3;
    var a = M[0], b = M[1], c = M[2], d = M[3], e = M[4], f = M[5], g = M[6], h = M[7], i2 = M[8];
    for (var k = 0, o = 0; k < n; k++, o += 3) { var r = data[o], gg = data[o + 1], bb = data[o + 2]; data[o] = a * r + b * gg + c * bb; data[o + 1] = d * r + e * gg + f * bb; data[o + 2] = g * r + h * gg + i2 * bb; }
  }
  function applyOrientation(rgb, w, h, orientation) { // returns { data, width, height } rotated/flipped so the picture is upright (EXIF orientation 1..8)
    if (!orientation || orientation === 1) return { data: rgb, width: w, height: h };
    var swap = orientation >= 5, ow = swap ? h : w, oh = swap ? w : h, out = new rgb.constructor(rgb.length), x, y, nx, ny;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      switch (orientation) { case 2: nx = w - 1 - x; ny = y; break; case 3: nx = w - 1 - x; ny = h - 1 - y; break; case 4: nx = x; ny = h - 1 - y; break; case 5: nx = y; ny = x; break; case 6: nx = h - 1 - y; ny = x; break; case 7: nx = h - 1 - y; ny = w - 1 - x; break; case 8: nx = y; ny = w - 1 - x; break; default: nx = x; ny = y; }
      var s = (y * w + x) * 3, d = (ny * ow + nx) * 3; out[d] = rgb[s]; out[d + 1] = rgb[s + 1]; out[d + 2] = rgb[s + 2];
    }
    return { data: out, width: ow, height: oh };
  }

  /* ================================================================== probe */
  /* buf: ArrayBuffer of the file. Returns { format, supported, decoder: 'builtin'|'camera'|'none', why, preview:{off,len,w,h}|null, meta } (no pixel decoding) */
  function probeBuffer(buf, name) {
    var sn = sniff(buf, name), res = { format: sn.format || EXT_FORMAT[sn.ext] || 'unknown', supported: false, decoder: 'none', why: '', preview: null, meta: {}, container: sn.container };
    if (sn.container === 'jpeg' || sn.container === 'png') { res.format = sn.container.toUpperCase(); res.why = 'This is an ordinary picture, not a camera RAW file.'; res.decoder = 'none'; return res; }
    var tiff = null, ifds = [];
    if (sn.container === 'tiff') { try { tiff = new Tiff(buf); ifds = collect(tiff); } catch (e) { tiff = null; } }
    if (tiff && ifds[0] && ifds[0].tags[TAG.DNGVersion]) {
      res.format = 'DNG';
      try {
        var m = parseDNG(buf); res.meta = summary(m);
        if (m.compression === 52546) { res.decoder = 'camera'; res.why = unsupportedWhy('jpeg-xl'); }
        else if (m.compression === 34892) { res.decoder = 'camera'; res.why = unsupportedWhy('lossy-jpeg'); }
        else { res.supported = true; res.decoder = 'builtin'; }
      } catch (e) { res.decoder = /^cfa-/.test(e.message) ? 'camera' : 'none'; res.why = unsupportedWhy(e.message); res.meta = { make: tiff.str(ifds[0], TAG.Make), model: tiff.str(ifds[0], TAG.Model) }; }
    } else if (res.format !== 'unknown' && res.format !== 'DNG') {
      res.decoder = 'camera'; res.why = 'Camera RAW (' + res.format + '). Opening it needs the optional Camera RAW support module.';
      if (tiff && ifds[0]) res.meta = { make: tiff.str(ifds[0], TAG.Make), model: tiff.str(ifds[0], TAG.Model) };
    } else { res.why = 'This file is not a recognised RAW format.'; }
    try { res.preview = findPreview(buf, tiff, ifds, sn); } catch (e) { res.preview = null; }
    if (tiff && ifds[0]) { var ori = tiff.num(ifds[0], TAG.Orientation); if (ori) res.orientation = ori; }
    return res;
  }
  function summary(m) {
    return { make: m.make, model: m.uniqueModel || m.model, width: m.width, height: m.height, activeArea: m.activeArea, cropOrigin: m.cropOrigin, cropSize: m.cropSize, bits: m.bits[0], compression: m.compressionName,
      cfa: m.cfaName || null, linear: m.linear, black: m.black4, white: m.whiteLevel, orientation: m.orientation, iso: m.iso, exposureTime: m.exposureTime, fNumber: m.fNumber, focalLength: m.focalLength,
      baselineExposure: m.baselineExposure, hasForwardMatrix: !!(m.forwardMatrix1 || m.forwardMatrix2), hasColorMatrix: !!(m.colorMatrix1 || m.colorMatrix2), noColor: !!m.noColor, profileName: m.profileName, hasHueSatMap: m.hasHueSatMap,
      opcodes: { applied: m.opcodes.list1.concat(m.opcodes.list2).filter(function (p) { return p.id === 9 || p.id === 3; }).map(function (p) { return p.name; }), skipped: m.opcodes.list1.concat(m.opcodes.list2, m.opcodes.list3).filter(function (p) { return p.id !== 9 && p.id !== 3; }).map(function (p) { return p.name; }) },
      noiseProfile: m.noiseProfile, lensInfo: m.lensInfo,
      color: { colorMatrix1: m.colorMatrix1, colorMatrix2: m.colorMatrix2, forwardMatrix1: m.forwardMatrix1, forwardMatrix2: m.forwardMatrix2, cameraCal1: m.cameraCal1, cameraCal2: m.cameraCal2, analogBalance: m.analogBalance, illuminant1: m.illuminant1, illuminant2: m.illuminant2, asShotNeutral: m.asShotNeutral, asShotWhiteXY: m.asShotWhiteXY } };
  }

  /* full decode of a DNG buffer */
  function decodeDNG(buf, o) {
    o = o || {}; var m = parseDNG(buf);
    return decodeMosaic(buf, m, o).then(function (mos) {
      var res = m.linear ? developLinear(m, mos, o) : developCFA(m, mos, o);
      res.meta = summary(m); res.meta.parsed = m; res.rawMs = null; return res;
    });
  }

  return {
    Tiff: Tiff, TAG: TAG, sniff: sniff, probeBuffer: probeBuffer, parseDNG: parseDNG, summary: summary, decodeMosaic: decodeMosaic, developCFA: developCFA, developLinear: developLinear, decodeDNG: decodeDNG,
    decodeLJ92: decodeLJ92, cameraMatrices: cameraMatrices, cameraToSpace: cameraToSpace, applyMatrix: applyMatrix, applyOrientation: applyOrientation, unsupportedWhy: unsupportedWhy,
    demosaicMHC: demosaicMHC, demosaicED: demosaicED, findPreview: findPreview, jpegExtent: jpegExtent,
    color: { MAT: MAT, bradford: bradford, planckXY: planckXY, xyToCCT: xyToCCT, whiteFromTempTint: whiteFromTempTint, tempTintFromXY: tempTintFromXY, xyzD50ToRGB: xyzD50ToRGB, rgbToXYZD50: rgbToXYZD50, D50: D50, D65: D65, SPACES: SPACES },
    toHalf: toHalf, halfToFloat: halfToFloat
  };
});
