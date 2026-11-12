/* LocalEditor: the PDF source-format step for library fonts.
   The library ships woff2 slices (one per script subset; variable fonts where they exist). pdf-lib and the vendored
   fontkit embed TrueType best, so before a font reaches le-pdf.js embedFont() this module:
     1. decodes each woff2 slice to TrueType with the vendored WOFF2 decoder (assets/vendor/woff2-decompress.js),
     2. for a variable font, makes a static instance at the requested weight (outlines and advance widths from
        fontkit's own variation code, composites flattened, hinting and variation tables dropped),
     3. merges extra slices (latin-ext, cyrillic, ...) behind the main slice, whose glyph ids, GSUB/GPOS and
        kerning stay untouched, and writes one cmap for all of them.
   A single static slice is returned exactly as decoded (format conversion only).
   Loaded on first PDF export by LE.fonts.bytes(); needs window.fontkit. Exposes window.LEFontSfnt. */
(function () {
  'use strict';
  var global = window;

  function rd16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function rd32(b, o) { return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }
  function tag(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

  /* Raw tables of a TrueType file: { tag: Uint8Array } */
  function tables(bytes) {
    var n = rd16(bytes, 4);
    var out = {};
    for (var i = 0; i < n; i++) {
      var r = 12 + i * 16;
      var off = rd32(bytes, r + 8);
      var len = rd32(bytes, r + 12);
      out[tag(bytes, r)] = bytes.subarray(off, off + len);
    }
    return out;
  }

  /* ---------- Writer ---------- */
  function Writer(size) { this.b = new Uint8Array(size || 1024); this.p = 0; }
  Writer.prototype.need = function (n) {
    if (this.p + n <= this.b.length) return;
    var nb = new Uint8Array(Math.max(this.b.length * 2, this.p + n));
    nb.set(this.b);
    this.b = nb;
  };
  Writer.prototype.u8 = function (v) { this.need(1); this.b[this.p++] = v & 255; };
  Writer.prototype.u16 = function (v) { this.need(2); this.b[this.p++] = (v >> 8) & 255; this.b[this.p++] = v & 255; };
  Writer.prototype.i16 = function (v) { this.u16(v < 0 ? v + 65536 : v); };
  Writer.prototype.u32 = function (v) { this.need(4); this.b[this.p++] = (v >>> 24) & 255; this.b[this.p++] = (v >>> 16) & 255; this.b[this.p++] = (v >>> 8) & 255; this.b[this.p++] = v & 255; };
  Writer.prototype.bytes = function (a) { this.need(a.length); this.b.set(a, this.p); this.p += a.length; };
  Writer.prototype.pad = function () { while (this.p % 4) this.u8(0); };
  Writer.prototype.done = function () { return this.b.slice(0, this.p); };

  function set16(b, o, v) { if (v < 0) v += 65536; b[o] = (v >> 8) & 255; b[o + 1] = v & 255; }
  function set32(b, o, v) { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; }

  /* ---------- Outlines: fontkit path -> TrueType contours ---------- */
  function contoursOf(path) {
    var out = [];
    var cur = null;
    var cmds = (path && path.commands) || [];
    function close() {
      if (cur && cur.length) {
        var a = cur[0], z = cur[cur.length - 1];
        if (cur.length > 1 && z.on && a.on && z.x === a.x && z.y === a.y) cur.pop();
        if (cur.length) out.push(cur);
      }
      cur = null;
    }
    for (var i = 0; i < cmds.length; i++) {
      var c = cmds[i];
      var a = c.args;
      if (c.command === 'moveTo') { close(); cur = [{ x: Math.round(a[0]), y: Math.round(a[1]), on: true }]; }
      else if (c.command === 'lineTo') { if (!cur) cur = []; cur.push({ x: Math.round(a[0]), y: Math.round(a[1]), on: true }); }
      else if (c.command === 'quadraticCurveTo') {
        if (!cur) cur = [];
        cur.push({ x: Math.round(a[0]), y: Math.round(a[1]), on: false });
        cur.push({ x: Math.round(a[2]), y: Math.round(a[3]), on: true });
      } else if (c.command === 'bezierCurveTo') {
        /* TrueType sources never produce cubics; approximate with one quadratic if one ever appears. */
        if (!cur) cur = [];
        var p0 = cur.length ? cur[cur.length - 1] : { x: a[4], y: a[5] };
        cur.push({ x: Math.round((3 * (a[0] + a[2]) - p0.x - a[4]) / 4), y: Math.round((3 * (a[1] + a[3]) - p0.y - a[5]) / 4), on: false });
        cur.push({ x: Math.round(a[4]), y: Math.round(a[5]), on: true });
      } else if (c.command === 'closePath') close();
    }
    close();
    return out;
  }

  function encodeGlyph(contours) {
    if (!contours.length) return { data: new Uint8Array(0), xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0 };
    var pts = [];
    var ends = [];
    contours.forEach(function (c) { c.forEach(function (p) { pts.push(p); }); ends.push(pts.length - 1); });
    var xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    pts.forEach(function (p) { if (p.x < xMin) xMin = p.x; if (p.y < yMin) yMin = p.y; if (p.x > xMax) xMax = p.x; if (p.y > yMax) yMax = p.y; });
    var w = new Writer(16 + pts.length * 5);
    w.i16(contours.length); w.i16(xMin); w.i16(yMin); w.i16(xMax); w.i16(yMax);
    ends.forEach(function (e) { w.u16(e); });
    w.u16(0); /* no instructions */
    var flags = [], xs = new Writer(pts.length * 2), ys = new Writer(pts.length * 2);
    var px = 0, py = 0;
    pts.forEach(function (p) {
      var f = p.on ? 1 : 0;
      var dx = p.x - px, dy = p.y - py;
      if (dx === 0) f |= 16;
      else if (dx > -256 && dx < 256) { f |= 2; if (dx > 0) f |= 16; xs.u8(Math.abs(dx)); }
      else xs.i16(dx);
      if (dy === 0) f |= 32;
      else if (dy > -256 && dy < 256) { f |= 4; if (dy > 0) f |= 32; ys.u8(Math.abs(dy)); }
      else ys.i16(dy);
      flags.push(f);
      px = p.x; py = p.y;
    });
    flags.forEach(function (f) { w.u8(f); });
    w.bytes(xs.done()); w.bytes(ys.done());
    w.pad();
    return { data: w.done(), xMin: xMin, yMin: yMin, xMax: xMax, yMax: yMax, points: pts.length };
  }

  /* ---------- cmap (format 4 for the BMP, format 12 for everything) ---------- */
  function encodeCmap(map) {
    var cps = Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
    var groups = [];
    cps.forEach(function (cp) {
      var g = map[cp];
      var last = groups[groups.length - 1];
      if (last && cp === last.end + 1 && g === last.gid + (cp - last.start)) last.end = cp;
      else groups.push({ start: cp, end: cp, gid: g });
    });
    var segs = [];
    groups.forEach(function (gr) { if (gr.start > 0xFFFE) return; segs.push({ start: gr.start, end: Math.min(gr.end, 0xFFFE), delta: (gr.gid - gr.start) & 0xFFFF }); });
    segs.push({ start: 0xFFFF, end: 0xFFFF, delta: 1 });
    var segX2 = segs.length * 2;
    var sr = 2;
    while (sr * 2 <= segs.length) sr *= 2;
    sr *= 2;
    var f4 = new Writer();
    f4.u16(4); f4.u16(16 + segs.length * 8); f4.u16(0); f4.u16(segX2); f4.u16(sr);
    f4.u16(Math.round(Math.log(sr / 2) / Math.LN2)); f4.u16(segX2 - sr);
    segs.forEach(function (s) { f4.u16(s.end); }); f4.u16(0);
    segs.forEach(function (s) { f4.u16(s.start); });
    segs.forEach(function (s) { f4.u16(s.delta); });
    segs.forEach(function () { f4.u16(0); });
    var f12 = new Writer();
    f12.u16(12); f12.u16(0); f12.u32(16 + groups.length * 12); f12.u32(0); f12.u32(groups.length);
    groups.forEach(function (gr) { f12.u32(gr.start); f12.u32(gr.end); f12.u32(gr.gid); });
    var a = f4.done(), b = f12.done();
    var w = new Writer();
    w.u16(0); w.u16(2);
    w.u16(3); w.u16(1); w.u32(4 + 16);
    w.u16(3); w.u16(10); w.u32(4 + 16 + a.length);
    w.bytes(a); w.bytes(b);
    return w.done();
  }

  function checksum(b) {
    var sum = 0;
    for (var i = 0; i < b.length; i += 4) sum = (sum + (((b[i] << 24) >>> 0) + ((b[i + 1] || 0) << 16) + ((b[i + 2] || 0) << 8) + (b[i + 3] || 0))) >>> 0;
    return sum;
  }

  function writeSfnt(tbls) {
    var tags = Object.keys(tbls).sort();
    var n = tags.length;
    var es = Math.floor(Math.log(n) / Math.LN2);
    var sr = Math.pow(2, es) * 16;
    var w = new Writer(1024);
    w.u32(0x00010000); w.u16(n); w.u16(sr); w.u16(es); w.u16(n * 16 - sr);
    var off = 12 + n * 16;
    var recs = [];
    tags.forEach(function (t) {
      var d = tbls[t];
      recs.push({ t: t, off: off, len: d.length, sum: checksum(d) });
      off += (d.length + 3) & ~3;
    });
    recs.forEach(function (r) { for (var i = 0; i < 4; i++) w.u8(r.t.charCodeAt(i)); w.u32(r.sum); w.u32(r.off); w.u32(r.len); });
    tags.forEach(function (t) { w.bytes(tbls[t]); w.pad(); });
    var out = w.done();
    var head = recs.filter(function (r) { return r.t === 'head'; })[0];
    if (head) set32(out, head.off + 8, (0xB1B0AFBA - checksum(out)) >>> 0);
    return out;
  }

  var KEEP = ['name', 'OS/2', 'GDEF', 'GSUB', 'GPOS', 'kern', 'gasp', 'BASE', 'JSTF', 'MATH'];

  function variedFont(fontkit, bytes, wght) {
    var f = fontkit.create(bytes);
    var axes = f.variationAxes || {};
    if (wght && axes.wght) {
      var w = Math.max(axes.wght.min, Math.min(axes.wght.max, wght));
      return { font: f.getVariation({ wght: w }), base: f, varied: true, weight: w };
    }
    return { font: f, base: f, varied: false, weight: null };
  }

  /* ttfs: decoded TrueType files of one face (first = main slice). opts.wght: weight for a variable face. */
  function build(ttfs, opts) {
    opts = opts || {};
    if (!opts.wght) return buildAt(ttfs, opts);
    try { return buildAt(ttfs, opts); } catch (err) {
      /* The vendored fontkit cannot read some gvar data (seen in Onest); embed the default instance instead of
         failing, so the text is still real text in the right family (at the font's default weight). */
      if (global.console) console.warn('Variable instance failed, using the default weight:', err && err.message);
      var out = buildAt(ttfs, { wght: null });
      out.leDefaultWeight = true;
      return out;
    }
  }
  function buildAt(ttfs, opts) {
    var fontkit = global.fontkit;
    if (!fontkit) throw new Error('fontkit is not loaded');
    var main = variedFont(fontkit, ttfs[0], opts.wght);
    if (!main.varied && ttfs.length === 1) return ttfs[0];
    var raw = tables(ttfs[0]);
    var font = main.font;
    var upem = main.base.unitsPerEm;
    var glyphs = [];
    var n = main.base.numGlyphs;
    for (var gid = 0; gid < n; gid++) {
      var g = font.getGlyph(gid);
      glyphs.push({ path: g.path, adv: g.advanceWidth });
    }
    var merged = false;
    var cmap = {};
    var extras = [];
    for (var i = 1; i < ttfs.length; i++) {
      var ex = variedFont(fontkit, ttfs[i], opts.wght);
      if (ex.base.unitsPerEm !== upem) continue;
      extras.push(ex);
    }
    if (extras.length) {
      merged = true;
      main.base.characterSet.forEach(function (cp) { cmap[cp] = main.base.glyphForCodePoint(cp).id; });
      extras.forEach(function (ex) {
        var seen = {};
        ex.base.characterSet.forEach(function (cp) {
          if (cmap[cp] != null) return;
          var g = ex.font.glyphForCodePoint(cp);
          if (!g || !g.id) return;
          if (seen[g.id] == null) { seen[g.id] = glyphs.length; glyphs.push({ path: g.path, adv: g.advanceWidth }); }
          cmap[cp] = seen[g.id];
        });
      });
    }
    /* glyf + loca + hmtx */
    var glyf = new Writer(glyphs.length * 64);
    var loca = new Writer((glyphs.length + 1) * 4);
    var hmtx = new Writer(glyphs.length * 4);
    var bx = [Infinity, Infinity, -Infinity, -Infinity];
    var maxPts = 0, maxCont = 0, advMax = 0, minL = Infinity, minR = Infinity, maxExt = -Infinity;
    glyphs.forEach(function (gl) {
      var cs = contoursOf(gl.path);
      var e = encodeGlyph(cs);
      loca.u32(glyf.p);
      glyf.bytes(e.data);
      var adv = Math.max(0, Math.round(gl.adv || 0));
      var lsb = e.data.length ? e.xMin : 0;
      hmtx.u16(adv); hmtx.i16(lsb);
      if (adv > advMax) advMax = adv;
      if (e.data.length) {
        bx[0] = Math.min(bx[0], e.xMin); bx[1] = Math.min(bx[1], e.yMin); bx[2] = Math.max(bx[2], e.xMax); bx[3] = Math.max(bx[3], e.yMax);
        minL = Math.min(minL, lsb); minR = Math.min(minR, adv - e.xMax); maxExt = Math.max(maxExt, e.xMax);
        maxPts = Math.max(maxPts, e.points); maxCont = Math.max(maxCont, cs.length);
      }
    });
    loca.u32(glyf.p);
    var head = raw.head.slice();
    set32(head, 8, 0);
    if (bx[0] !== Infinity) { set16(head, 36, bx[0]); set16(head, 38, bx[1]); set16(head, 40, bx[2]); set16(head, 42, bx[3]); }
    set16(head, 50, 1);
    var hhea = raw.hhea.slice();
    set16(hhea, 10, advMax);
    if (minL !== Infinity) { set16(hhea, 12, minL); set16(hhea, 14, minR); set16(hhea, 16, maxExt); }
    set16(hhea, 34, glyphs.length);
    var maxp = raw.maxp.slice();
    set16(maxp, 4, glyphs.length);
    if (maxp.length >= 32) {
      set16(maxp, 6, maxPts); set16(maxp, 8, maxCont); set16(maxp, 10, 0); set16(maxp, 12, 0);
      set16(maxp, 26, 0); set16(maxp, 28, 0); set16(maxp, 30, 0);
    }
    var out = { head: head, hhea: hhea, maxp: maxp, glyf: glyf.done(), loca: loca.done(), hmtx: hmtx.done() };
    KEEP.forEach(function (t) { if (raw[t]) out[t] = raw[t]; });
    if (out['OS/2'] && main.varied) { out['OS/2'] = out['OS/2'].slice(); set16(out['OS/2'], 4, Math.round(main.weight)); }
    if (merged) {
      out.cmap = encodeCmap(cmap);
      var post = raw.post ? raw.post.slice(0, 32) : new Uint8Array(32);
      set32(post, 0, 0x00030000);
      out.post = post;
    } else {
      out.cmap = raw.cmap;
      if (raw.post) out.post = raw.post;
    }
    return writeSfnt(out);
  }

  /* woff2 bytes -> TrueType bytes */
  function decode(bytes) {
    var dec = global.LEWoff2Decompress;
    if (typeof dec !== 'function') return Promise.reject(new Error('WOFF2 decoder is not loaded'));
    return Promise.resolve(dec(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
  }

  global.LEFontSfnt = { decode: decode, build: build, tables: tables, contoursOf: contoursOf, encodeCmap: encodeCmap };
})();
