/* LocalEditor: PDF studio security tools (reveal, safety check, redaction, find sensitive data, safe to send). See docs/ROADMAP.md, Wave 2P D1-D4, D6.
   Pure functions on bytes live on LE.pdfSecurity; the studio panel is at the bottom of this file.
   Nothing here executes content from a PDF: objects are parsed with pdf-lib, pages are read and drawn by pdf.js with
   isEvalSupported: false and scripting off. Every public function catches its own errors and runs under a time limit. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var VERSION = '1.0';
  var MAX_BYTES = 200 * 1024 * 1024;
  var STREAM_CAP = 24 * 1024 * 1024;
  var MAX_OBJECTS = 400000;
  var MAX_OPS = 1500000;

  /* ---------- small helpers ---------- */

  function P() { return global.PDFLib; }
  function te(s) { return new TextEncoder().encode(s); }
  function latin1(bytes, from, to) {
    var out = '';
    from = from || 0; to = to == null ? bytes.length : Math.min(to, bytes.length);
    for (var i = from; i < to; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(to, i + 8192)));
    return out;
  }
  function latin1Bytes(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
  function concatBytes(parts) {
    var n = 0, i; for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function clip(s, n) { s = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\s+/g, ' ').trim(); n = n || 140; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function toBytes(input) {
    if (input == null) return Promise.reject(new Error('No file'));
    if (input instanceof Uint8Array) return Promise.resolve(input.slice(0));
    if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input.slice(0)));
    if (ArrayBuffer.isView(input)) return Promise.resolve(new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)));
    if (typeof Blob !== 'undefined' && input instanceof Blob) return input.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    if (input && input._bytes instanceof Uint8Array) return Promise.resolve(input._bytes.slice(0));
    return Promise.reject(new Error('Expected PDF bytes'));
  }

  /* Runs fn under a time limit. A hostile file that never settles becomes an error instead of a hang. */
  function withTimeout(promise, ms, label) {
    var t;
    return Promise.race([
      promise,
      new Promise(function (_, rej) { t = setTimeout(function () { var e = new Error((label || 'This step') + ' took too long and was stopped'); e.code = 'timeout'; rej(e); }, ms); })
    ]).then(function (v) { clearTimeout(t); return v; }, function (e) { clearTimeout(t); throw e; });
  }

  function ready() {
    if (LE.pdf && LE.pdf.ready) return LE.pdf.ready();
    if (global.PDFLib && global.pdfjsLib) return Promise.resolve();
    return Promise.reject(new Error('PDF libraries are not loaded'));
  }

  function friendlyError(e) {
    var m = e && e.message ? String(e.message) : String(e || 'Unknown problem');
    if (e && (e.code === 'timeout' || e.code === 'encrypted' || e.code === 'password')) return m;
    if (/password|encrypt/i.test(m)) return 'This PDF is locked with a password.';
    if (/No PDF header|Invalid PDF|not a PDF|Expected PDF/i.test(m)) return 'This does not look like a PDF file.';
    return 'The file could not be read: ' + clip(m, 120);
  }

  /* ---------- pdf-lib object helpers ---------- */

  function isRef(o) { return o instanceof P().PDFRef; }
  function isDict(o) { return o instanceof P().PDFDict; }
  function isArr(o) { return o instanceof P().PDFArray; }
  function isStream(o) { return o instanceof P().PDFStream; }
  function isName(o) { return o instanceof P().PDFName; }
  function isNum(o) { return o instanceof P().PDFNumber; }
  function isStr(o) { return o instanceof P().PDFString || o instanceof P().PDFHexString; }
  function N(n) { return P().PDFName.of(n); }
  function nameOf(o) { return isName(o) ? o.decodeText() : null; }
  function dictOf(o) { return isStream(o) ? o.dict : isDict(o) ? o : null; }

  function deref(ctx, o) {
    var guard = 0;
    while (isRef(o) && guard++ < 32) o = ctx.lookup(o);
    return o;
  }
  function get(ctx, d, key) {
    d = dictOf(deref(ctx, d));
    if (!d) return undefined;
    var v;
    try { v = d.get(N(key)); } catch (e) { return undefined; }
    return deref(ctx, v);
  }
  function getRaw(d, key) { d = dictOf(d); if (!d) return undefined; try { return d.get(N(key)); } catch (e) { return undefined; } }
  function has(d, key) { d = dictOf(d); return !!d && d.has(N(key)); }
  function del(d, key) { d = dictOf(d); if (d && d.has(N(key))) { d.delete(N(key)); return true; } return false; }
  function numOf(o, dflt) { return isNum(o) ? o.asNumber() : dflt; }
  function arr(ctx, o) {
    o = deref(ctx, o);
    if (!isArr(o)) return [];
    var out = [];
    for (var i = 0; i < o.size(); i++) out.push(o.get(i));
    return out;
  }
  function nums(ctx, o) { return arr(ctx, o).map(function (x) { return numOf(deref(ctx, x), 0); }); }
  function textOf(ctx, o) {
    o = deref(ctx, o);
    try {
      if (isStr(o)) return o.decodeText();
      if (isName(o)) return o.decodeText();
      if (isNum(o)) return String(o.asNumber());
      if (isStream(o)) return latin1(o.getContents ? o.getContents() : new Uint8Array(0), 0, 4000);
    } catch (e) {}
    return '';
  }
  function dateOf(ctx, o) {
    var s = textOf(ctx, o);
    var m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s);
    if (!m) return s || '';
    var d = new Date(Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0));
    if (isNaN(d.getTime())) return s;
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
  function refKey(r) { return isRef(r) ? r.objectNumber + ' ' + r.generationNumber : ''; }

  /* All the values inside a pdf-lib object (not following references). */
  function children(o) {
    var out = [];
    if (isStream(o)) o = o.dict;
    if (isDict(o)) { o.values().forEach(function (v) { out.push(v); }); }
    else if (isArr(o)) { for (var i = 0; i < o.size(); i++) out.push(o.get(i)); }
    return out;
  }

  /* Depth-first walk of everything reachable from roots, with a visited set and an object cap (no recursion). */
  function reachable(ctx, roots) {
    var seen = new Set();
    var stack = roots.slice();
    var count = 0;
    while (stack.length) {
      var o = stack.pop();
      if (!o) continue;
      if (isRef(o)) {
        if (seen.has(o)) continue;
        seen.add(o);
        if (++count > MAX_OBJECTS) break;
        o = ctx.lookup(o);
        if (!o) continue;
      }
      var ch = children(o);
      for (var i = 0; i < ch.length; i++) stack.push(ch[i]);
    }
    return seen;
  }

  /* Every dictionary in the file (direct or indirect), each with the indirect object it lives in. */
  function everyDict(ctx, fn) {
    var list = ctx.enumerateIndirectObjects();
    var n = 0;
    for (var i = 0; i < list.length && n < MAX_OBJECTS; i++) {
      var ref = list[i][0], obj = list[i][1];
      var stack = [obj];
      var depth = 0;
      while (stack.length && depth++ < 20000) {
        var o = stack.pop();
        if (isRef(o) || !o) continue;
        var d = dictOf(o);
        if (d) { n++; if (fn(d, ref, o) === false) return; }
        var ch = children(o);
        for (var k = 0; k < ch.length; k++) if (!isRef(ch[k])) stack.push(ch[k]);
      }
    }
  }

  /* Pages in order, walking the page tree ourselves so loops and broken trees cannot hang or throw. */
  function pageList(ctx) {
    var root = get(ctx, ctx.trailerInfo.Root, 'Pages');
    var out = [];
    var seen = new Set();
    var stack = [{ node: getRaw(dictOf(deref(ctx, ctx.trailerInfo.Root)), 'Pages'), inherit: {} }];
    if (!root) return out;
    while (stack.length && out.length < 5000) {
      var it = stack.pop();
      var ref = it.node;
      var node = deref(ctx, ref);
      if (!isDict(node)) continue;
      if (isRef(ref)) { if (seen.has(ref)) continue; seen.add(ref); }
      else if (seen.has(node)) continue; else seen.add(node);
      var inherit = Object.assign({}, it.inherit);
      ['Resources', 'MediaBox', 'CropBox', 'Rotate'].forEach(function (k) { if (node.has(N(k))) inherit[k] = node.get(N(k)); });
      var type = nameOf(get(ctx, node, 'Type'));
      var kids = get(ctx, node, 'Kids');
      if (type === 'Pages' || (isArr(kids) && type !== 'Page')) {
        var list = arr(ctx, kids);
        for (var i = list.length - 1; i >= 0; i--) stack.push({ node: list[i], inherit: inherit });
      } else {
        out.push({ ref: isRef(ref) ? ref : null, dict: node, inherit: inherit });
      }
    }
    return out;
  }
  function pageBox(ctx, pg) {
    var mb = nums(ctx, pg.inherit.MediaBox);
    if (mb.length !== 4) mb = [0, 0, 612, 792];
    var cb = nums(ctx, pg.inherit.CropBox);
    var box = cb.length === 4 ? cb : mb;
    return [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  }
  function pageRotate(ctx, pg) { var r = numOf(deref(ctx, pg.inherit.Rotate), 0); return ((Math.round(r / 90) * 90) % 360 + 360) % 360; }

  /* Name tree entries [{ key, value }] with loop protection. */
  function nameTree(ctx, root) {
    var out = [];
    var seen = new Set();
    var stack = [root];
    while (stack.length && out.length < 20000) {
      var r = stack.pop();
      var node = deref(ctx, r);
      if (!isDict(node)) continue;
      if (seen.has(node)) continue;
      seen.add(node);
      if (isRef(r)) { if (seen.has(r)) continue; seen.add(r); }
      var names = arr(ctx, node.get(N('Names')));
      for (var i = 0; i + 1 < names.length; i += 2) out.push({ key: textOf(ctx, names[i]), value: names[i + 1] });
      arr(ctx, node.get(N('Kids'))).forEach(function (k) { stack.push(k); });
    }
    return out;
  }

  /* ---------- loading ---------- */

  async function loadDoc(bytes) {
    if (!bytes || !bytes.length) throw new Error('The file is empty');
    if (bytes.length > MAX_BYTES) throw new Error('The file is larger than 200 MB');
    var doc = await P().PDFDocument.load(bytes.slice(0), { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    var ctx = doc.context;
    if (!ctx.trailerInfo.Root || !isDict(deref(ctx, ctx.trailerInfo.Root))) throw new Error('Invalid PDF: no document catalog');
    return { doc: doc, ctx: ctx, encrypted: !!ctx.trailerInfo.Encrypt, catalog: deref(ctx, ctx.trailerInfo.Root) };
  }

  function openJs(bytes) {
    var task = global.pdfjsLib.getDocument({
      data: bytes.slice(0), isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true,
      useSystemFonts: false, stopAtErrors: false, verbosity: 0
    });
    return withTimeout(task.promise, 20000, 'Opening the file').catch(function (e) {
      try { task.destroy(); } catch (x) {}
      throw e;
    });
  }

  /* ---------- stream decoding with a size cap (decompression bombs stop at STREAM_CAP) ---------- */

  async function inflateCapped(data, cap, raw) {
    if (typeof DecompressionStream === 'undefined') return null;
    var ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate');
    var writer = ds.writable.getWriter();
    writer.write(data).catch(function () {});
    writer.close().catch(function () {});
    var reader = ds.readable.getReader();
    var chunks = [], total = 0, failed = false;
    try {
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
        total += r.value.length;
        if (total > cap) { try { await reader.cancel(); } catch (e) {} break; }
      }
    } catch (e) { failed = true; }
    if (failed && !total) return null;
    var out = concatBytes(chunks);
    return total > cap ? out.subarray(0, cap) : out;
  }

  /* Decodes a stream's bytes. Image codecs are left alone (returns null) because they never hold text. */
  async function decodeStream(ctx, stream, cap) {
    cap = cap || STREAM_CAP;
    var raw;
    try { raw = stream.getContents(); } catch (e) { return null; }
    if (!(stream instanceof P().PDFRawStream)) return raw;
    var f = deref(ctx, stream.dict.get(N('Filter')));
    var filters = isArr(f) ? arr(ctx, f).map(function (x) { return nameOf(deref(ctx, x)); }) : f ? [nameOf(f)] : [];
    if (!filters.length) return raw;
    if (filters.some(function (n) { return /DCT|JPX|CCITT|JBIG2/.test(n || ''); })) return null;
    if (filters.every(function (n) { return n === 'FlateDecode' || n === 'Fl'; }) && filters.length === 1) {
      var out = await inflateCapped(raw, cap, false);
      if (!out || !out.length) out = await inflateCapped(raw, cap, true);
      return out;
    }
    if (raw.length > 4 * 1024 * 1024) return null;
    try { return P().decodePDFRawStream(stream).decode(); } catch (e) { return null; }
  }

  /* ---------- raw byte scanning (structure, revisions) ---------- */

  function scanRaw(bytes) {
    var text = latin1(bytes, 0, Math.min(bytes.length, 64 * 1024 * 1024));
    var res = { eofs: [], startxrefs: [], xrefTables: 0, xrefStreams: 0, objStms: 0, linearized: false, headerAt: -1, trailing: 0, disguisedNames: [], prevLinks: 0, startxrefOk: true };
    var re = /%%EOF/g, m;
    while ((m = re.exec(text)) && res.eofs.length < 10000) res.eofs.push(m.index + 5);
    re = /startxref\s+(\d+)/g;
    while ((m = re.exec(text)) && res.startxrefs.length < 10000) res.startxrefs.push(+m[1]);
    res.xrefTables = (text.match(/(^|[\r\n])xref[\r\n ]/g) || []).length;
    res.xrefStreams = (text.match(/\/Type\s*\/XRef\b/g) || []).length;
    res.objStms = (text.match(/\/Type\s*\/ObjStm\b/g) || []).length;
    res.prevLinks = (text.match(/\/Prev\s+\d+/g) || []).length;
    res.linearized = /\/Linearized\s/.test(text.slice(0, 2048));
    res.headerAt = text.indexOf('%PDF-');
    var lastEof = res.eofs.length ? res.eofs[res.eofs.length - 1] : text.length;
    res.trailing = text.slice(lastEof).replace(/[\s\0]+/g, '').length;
    var dn = text.match(/\/[A-Za-z]*#[0-9A-Fa-f]{2}[A-Za-z#0-9]*/g) || [];
    var decoded = {};
    dn.forEach(function (s) {
      var d = s.replace(/#([0-9A-Fa-f]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
      if (/^\/(JavaScript|JS|OpenAction|AA|Launch|URI|SubmitForm|EmbeddedFile|EmbeddedFiles|RichMedia|XFA|AcroForm|ImportData|GoToR|GoToE|S|Names)$/.test(d)) decoded[d] = (decoded[d] || 0) + 1;
    });
    res.disguisedNames = Object.keys(decoded);
    if (res.startxrefs.length) {
      var at = res.startxrefs[res.startxrefs.length - 1];
      var probe = text.slice(at, at + 40);
      res.startxrefOk = /^\s*(xref|\d+\s+\d+\s+obj)/.test(probe);
    } else res.startxrefOk = false;
    /* A revision is a body ending in %%EOF. A linearized file has one extra %%EOF that is not a real edit. */
    res.revisions = Math.max(1, res.eofs.length - (res.linearized && res.eofs.length > 1 ? 1 : 0));
    return res;
  }

  /* ---------- content stream lexer ---------- */

  var WS = new Uint8Array(256); [0, 9, 10, 12, 13, 32].forEach(function (c) { WS[c] = 1; });
  var DELIM = new Uint8Array(256); '()<>[]{}/%'.split('').forEach(function (c) { DELIM[c.charCodeAt(0)] = 1; });

  /* Returns [{ op, args, start, end }]. start is the first byte of the first operand, end is just after the operator. */
  function lexContent(b) {
    var n = b.length, i = 0, ops = [], args = [], argStart = -1;
    function skip() {
      while (i < n) {
        var c = b[i];
        if (WS[c]) { i++; continue; }
        if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }
        break;
      }
    }
    function value(depth) {
      if (depth > 64) throw new Error('Content nested too deeply');
      skip();
      if (i >= n) return null;
      var c = b[i], s = i;
      if (c === 47) {
        i++;
        while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++;
        var raw = latin1(b, s + 1, i);
        return { t: 'name', v: raw.indexOf('#') >= 0 ? raw.replace(/#([0-9A-Fa-f]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); }) : raw };
      }
      if (c === 40) {
        i++;
        var depthP = 1, out = [];
        while (i < n) {
          c = b[i++];
          if (c === 92) {
            if (i >= n) break;
            var e = b[i++];
            if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9);
            else if (e === 98) out.push(8); else if (e === 102) out.push(12);
            else if (e === 13) { if (b[i] === 10) i++; }
            else if (e === 10) { /* line continuation */ }
            else if (e >= 48 && e <= 55) {
              var v = e - 48;
              for (var k = 0; k < 2 && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + (b[i++] - 48);
              out.push(v & 255);
            } else out.push(e);
          } else if (c === 40) { depthP++; out.push(c); }
          else if (c === 41) { if (--depthP === 0) break; out.push(c); }
          else out.push(c);
        }
        return { t: 's', v: new Uint8Array(out) };
      }
      if (c === 60) {
        if (b[i + 1] === 60) {
          i += 2;
          var d = {};
          for (var guard = 0; guard < 100000; guard++) {
            skip();
            if (i >= n) break;
            if (b[i] === 62 && b[i + 1] === 62) { i += 2; break; }
            var key = value(depth + 1);
            if (!key) break;
            var val = value(depth + 1);
            if (key.t === 'name') d[key.v] = val;
          }
          return { t: 'd', v: d };
        }
        i++;
        var hexs = '';
        while (i < n && b[i] !== 62) { var ch = b[i++]; if (!WS[ch]) hexs += String.fromCharCode(ch); }
        i++;
        if (hexs.length % 2) hexs += '0';
        var hb = new Uint8Array(hexs.length / 2);
        for (var h = 0; h < hb.length; h++) hb[h] = parseInt(hexs.substr(h * 2, 2), 16) || 0;
        return { t: 's', v: hb, hex: true };
      }
      if (c === 91) {
        i++;
        var a = [];
        for (var g2 = 0; g2 < 1000000; g2++) {
          skip();
          if (i >= n) break;
          if (b[i] === 93) { i++; break; }
          var x = value(depth + 1);
          if (!x) break;
          a.push(x);
        }
        return { t: 'a', v: a };
      }
      if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) { i++; return { t: 'junk' }; }
      while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++;
      var word = latin1(b, s, i);
      if (/^[+\-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'n', v: parseFloat(word) };
      if (/^[+\-]?[\d.]+/.test(word)) return { t: 'n', v: parseFloat(word) || 0 };
      if (word === 'true' || word === 'false') return { t: 'b', v: word === 'true' };
      if (word === 'null') return { t: 'null' };
      return { t: 'op', v: word };
    }
    while (i < n) {
      skip();
      if (i >= n) break;
      var at = i;
      var tok = value(0);
      if (!tok) break;
      if (tok.t !== 'op') {
        if (argStart < 0) argStart = at;
        args.push(tok);
        if (args.length > 4096) { args = []; argStart = -1; }
        continue;
      }
      var op = { op: tok.v, args: args, start: argStart >= 0 ? argStart : at, end: i };
      if (tok.v === 'BI') {
        var dict = {};
        for (var g3 = 0; g3 < 1000; g3++) {
          var k2 = value(0);
          if (!k2 || (k2.t === 'op' && k2.v === 'ID')) break;
          var v2 = value(0);
          if (k2.t === 'name') dict[k2.v] = v2;
        }
        i++;
        var j = i;
        while (j + 2 < n && !(WS[b[j]] && b[j + 1] === 69 && b[j + 2] === 73 && (j + 3 >= n || WS[b[j + 3]] || DELIM[b[j + 3]]))) j++;
        i = Math.min(n, j + 3);
        op.dict = dict;
        op.end = i;
      }
      ops.push(op);
      if (ops.length > MAX_OPS) throw new Error('Too many drawing commands');
      args = [];
      argStart = -1;
    }
    return ops;
  }

  /* ---------- fonts: code length, widths, Unicode ---------- */

  var STD14 = {
    'Helvetica': 'Helvetica', 'Helvetica-Bold': 'Helvetica-Bold', 'Helvetica-Oblique': 'Helvetica-Oblique', 'Helvetica-BoldOblique': 'Helvetica-BoldOblique',
    'Times-Roman': 'Times-Roman', 'Times-Bold': 'Times-Bold', 'Times-Italic': 'Times-Italic', 'Times-BoldItalic': 'Times-BoldItalic',
    'Courier': 'Courier', 'Courier-Bold': 'Courier-Bold', 'Courier-Oblique': 'Courier-Oblique', 'Courier-BoldOblique': 'Courier-BoldOblique',
    'Symbol': 'Symbol', 'ZapfDingbats': 'ZapfDingbats'
  };
  var WINANSI_HI = { 128: 0x20AC, 130: 0x201A, 131: 0x0192, 132: 0x201E, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x02C6, 137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152, 142: 0x017D, 145: 0x2018, 146: 0x2019, 147: 0x201C, 148: 0x201D, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x02DC, 153: 0x2122, 154: 0x0161, 155: 0x203A, 156: 0x0153, 158: 0x017E, 159: 0x0178 };
  function winAnsi(code) { return String.fromCharCode(WINANSI_HI[code] || code); }

  function parseToUnicode(bytes) {
    var map = Object.create(null), ranges = [];
    if (!bytes) return null;
    var s = latin1(bytes, 0, Math.min(bytes.length, 2 * 1024 * 1024));
    function hexToStr(h) {
      h = h.replace(/\s+/g, '');
      var out = '';
      for (var i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
      if (h.length === 2) out = String.fromCharCode(parseInt(h, 16));
      return out;
    }
    var m;
    var bc = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = bc.exec(s))) {
      var re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g, x;
      while ((x = re.exec(m[1]))) map[parseInt(x[1], 16)] = hexToStr(x[2]);
    }
    var br = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = br.exec(s))) {
      var re2 = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g, y;
      while ((y = re2.exec(m[1]))) {
        var lo = parseInt(y[1], 16), hi = parseInt(y[2], 16);
        if (!(hi >= lo) || hi - lo > 65536) continue;
        if (y[3].charAt(0) === '[') {
          var items = y[3].match(/<([0-9A-Fa-f]*)>/g) || [];
          for (var k = 0; k < items.length && lo + k <= hi; k++) map[lo + k] = hexToStr(items[k].slice(1, -1));
        } else {
          var base = y[3].slice(1, -1);
          if (hi - lo <= 2048) {
            var first = parseInt(base.slice(-4), 16), head = hexToStr(base.slice(0, -4));
            for (var c = lo; c <= hi; c++) map[c] = head + String.fromCharCode(first + (c - lo));
          } else ranges.push([lo, hi, base]);
        }
      }
    }
    return { map: map, ranges: ranges };
  }

  /* Font facts the interpreter needs. supported = we know code lengths and advance widths exactly. */
  async function fontInfo(env, fontRef) {
    var key = isRef(fontRef) ? fontRef : null;
    if (key && env.fonts.has(key)) return env.fonts.get(key);
    var ctx = env.ctx;
    var f = deref(ctx, fontRef);
    var info = { name: '', subtype: '', codeLen: 1, supported: false, scale: 0.001, widths: null, dw: 1000, missing: 0, std: null, toU: null, type3: false, vertical: false };
    if (isDict(f)) {
      info.subtype = nameOf(get(ctx, f, 'Subtype')) || '';
      info.name = nameOf(get(ctx, f, 'BaseFont')) || textOf(ctx, get(ctx, f, 'Name')) || '';
      var tu = get(ctx, f, 'ToUnicode');
      if (isStream(tu)) { try { info.toU = parseToUnicode(await decodeStream(ctx, tu, 2 * 1024 * 1024)); } catch (e) { info.toU = null; } }
      if (info.subtype === 'Type0') {
        var enc = nameOf(get(ctx, f, 'Encoding'));
        var desc = deref(ctx, arr(ctx, get(ctx, f, 'DescendantFonts'))[0]);
        info.codeLen = 2;
        info.vertical = enc === 'Identity-V';
        if (desc) {
          info.dw = numOf(get(ctx, desc, 'DW'), 1000);
          var w = arr(ctx, get(ctx, desc, 'W')).map(function (x) { return deref(ctx, x); });
          var map = new Map();
          for (var i = 0; i < w.length && map.size < 200000;) {
            var a = numOf(w[i], NaN);
            if (!isFinite(a)) break;
            if (isArr(w[i + 1])) { var list = nums(ctx, w[i + 1]); for (var k = 0; k < list.length; k++) map.set(a + k, list[k]); i += 2; }
            else { var b2 = numOf(w[i + 1], NaN), wv = numOf(w[i + 2], 0); if (isFinite(b2) && b2 - a < 100000) for (var c = a; c <= b2; c++) map.set(c, wv); i += 3; }
          }
          info.widths = map;
        }
        info.supported = enc === 'Identity-H' && !!desc;
      } else {
        info.type3 = info.subtype === 'Type3';
        if (info.type3) { var fm = nums(ctx, get(ctx, f, 'FontMatrix')); info.scale = fm.length === 6 ? fm[0] : 0.001; }
        var first = numOf(get(ctx, f, 'FirstChar'), 0);
        var ws = nums(ctx, get(ctx, f, 'Widths'));
        var fd = get(ctx, f, 'FontDescriptor');
        info.missing = numOf(get(ctx, fd, 'MissingWidth'), 0);
        if (ws.length) {
          var m2 = new Map(); for (var j = 0; j < ws.length; j++) m2.set(first + j, ws[j]);
          info.widths = m2; info.supported = true;
        } else {
          var base = (info.name || '').replace(/^[A-Z]{6}\+/, '');
          var std = STD14[base];
          if (std) {
            try { info.std = P().StandardFontEmbedder.for(std); info.supported = std !== 'Symbol' && std !== 'ZapfDingbats'; } catch (e) { info.std = null; }
          }
        }
      }
    }
    if (key) env.fonts.set(key, info);
    return info;
  }
  function glyphWidth(info, code) {
    if (info.widths && info.widths.has(code)) return info.widths.get(code);
    if (info.std) { try { return info.std.widthOfTextAtSize(winAnsi(code), 1000); } catch (e) { return 500; } }
    if (info.codeLen === 2) return info.dw;
    return info.missing || (info.supported ? 0 : 500);
  }
  function glyphText(info, code) {
    if (info.toU) {
      var u = info.toU.map[code];
      if (u != null) return u;
      for (var i = 0; i < info.toU.ranges.length; i++) {
        var r = info.toU.ranges[i];
        if (code >= r[0] && code <= r[1]) return String.fromCharCode(parseInt(r[2].slice(-4), 16) + code - r[0]);
      }
    }
    if (info.codeLen === 2) return info.toU ? '' : '�';
    return winAnsi(code);
  }
  function codesOf(info, bytes) {
    var out = [];
    if (info.codeLen === 2) { for (var i = 0; i + 1 < bytes.length; i += 2) out.push(bytes[i] * 256 + bytes[i + 1]); }
    else for (var j = 0; j < bytes.length; j++) out.push(bytes[j]);
    return out;
  }

  /* ---------- content interpreter ---------- */

  function mul(m, n) {
    return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  }
  function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  function bboxOf(m, x0, y0, x1, y1) {
    var p = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
    return [Math.min(p[0][0], p[1][0], p[2][0], p[3][0]), Math.min(p[0][1], p[1][1], p[2][1], p[3][1]), Math.max(p[0][0], p[1][0], p[2][0], p[3][0]), Math.max(p[0][1], p[1][1], p[2][1], p[3][1])];
  }
  function overlaps(a, b, pad) { pad = pad || 0; return a[0] < b[2] + pad && a[2] > b[0] - pad && a[1] < b[3] + pad && a[3] > b[1] - pad; }
  function contains(outer, inner, pad) { pad = pad || 0.5; return inner[0] >= outer[0] - pad && inner[1] >= outer[1] - pad && inner[2] <= outer[2] + pad && inner[3] <= outer[3] + pad; }
  /* Share of b's area that a covers. */
  function coverage(a, b) {
    var w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    var area = Math.max(1e-6, (b[2] - b[0]) * (b[3] - b[1]));
    return w > 0 && h > 0 ? (w * h) / area : 0;
  }
  function union(a, b) { return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b.slice(); }
  function argNums(args) { return args.map(function (a) { return a && a.t === 'n' ? a.v : 0; }); }
  function isWhiteColor(c) {
    if (!c) return false;
    if (c.space === 'gray') return c.v[0] >= 0.99;
    if (c.space === 'rgb') return c.v[0] >= 0.99 && c.v[1] >= 0.99 && c.v[2] >= 0.99;
    if (c.space === 'cmyk') return c.v[0] <= 0.01 && c.v[1] <= 0.01 && c.v[2] <= 0.01 && c.v[3] <= 0.01;
    return false;
  }
  function spaceOf(ctx, resources, name, depth) {
    if ((depth || 0) > 4) return 'other';
    if (name === 'DeviceGray' || name === 'G' || name === 'CalGray') return 'gray';
    if (name === 'DeviceRGB' || name === 'RGB' || name === 'CalRGB') return 'rgb';
    if (name === 'DeviceCMYK' || name === 'CMYK') return 'cmyk';
    var cs = get(ctx, get(ctx, resources, 'ColorSpace'), name);
    if (isArr(cs)) {
      var fam = nameOf(deref(ctx, cs.get(0)));
      if (fam === 'ICCBased') { var nn = numOf(get(ctx, deref(ctx, cs.get(1)), 'N'), 3); return nn === 1 ? 'gray' : nn === 4 ? 'cmyk' : 'rgb'; }
      if (fam === 'CalRGB') return 'rgb';
      if (fam === 'CalGray') return 'gray';
    }
    if (isName(cs)) return spaceOf(ctx, resources, nameOf(cs), (depth || 0) + 1);
    return 'other';
  }

  function freshState() {
    return { ctm: [1, 0, 0, 1, 0, 0], fill: { space: 'gray', v: [0] }, stroke: { space: 'gray', v: [0] }, fillSpace: 'gray', strokeSpace: 'gray', tr: 0, font: null, fontRef: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, ca: 1, CA: 1, bm: 'Normal' };
  }
  function copyState(s) { var o = Object.assign({}, s); o.ctm = s.ctm.slice(); return o; }

  /* Walks one content stream. env.items collects text runs, images, forms, shadings and painted paths in drawing
     order; each knows its stream id, op index and byte range so callers can rewrite it. */
  async function interpret(env, bytes, resources, state, depth, streamId) {
    var ctx = env.ctx;
    var ops;
    try { ops = lexContent(bytes); } catch (e) { env.problems.push(e.message); env.unparsed = true; return; }
    env.streams[streamId] = { bytes: bytes, ops: ops };
    var st = state || freshState();
    var stack = [];
    var tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
    var path = null, pathStart = -1, pathClip = false;
    var oc = [];
    var started = now();
    function ocHidden() { if (env.ocBase) return true; for (var x = 0; x < oc.length; x++) if (oc[x]) return true; return false; }
    for (var oi = 0; oi < ops.length; oi++) {
      if ((oi & 4095) === 4095) { if (now() - started > 15000) { env.problems.push('Drawing commands took too long to read'); env.unparsed = true; return; } await tick(); }
      var o = ops[oi], a = o.args, op = o.op, v;
      switch (op) {
        case 'q': if (stack.length < 256) stack.push(copyState(st)); break;
        case 'Q': if (stack.length) st = stack.pop(); break;
        case 'cm': v = argNums(a); if (v.length === 6) st.ctm = mul(v, st.ctm); break;
        case 'g': st.fill = { space: 'gray', v: argNums(a) }; st.fillSpace = 'gray'; break;
        case 'G': st.stroke = { space: 'gray', v: argNums(a) }; st.strokeSpace = 'gray'; break;
        case 'rg': st.fill = { space: 'rgb', v: argNums(a) }; st.fillSpace = 'rgb'; break;
        case 'RG': st.stroke = { space: 'rgb', v: argNums(a) }; st.strokeSpace = 'rgb'; break;
        case 'k': st.fill = { space: 'cmyk', v: argNums(a) }; st.fillSpace = 'cmyk'; break;
        case 'K': st.stroke = { space: 'cmyk', v: argNums(a) }; st.strokeSpace = 'cmyk'; break;
        case 'cs': st.fillSpace = a[0] && a[0].t === 'name' ? spaceOf(ctx, resources, a[0].v) : 'other'; st.fill = { space: st.fillSpace, v: st.fillSpace === 'cmyk' ? [0, 0, 0, 1] : [0, 0, 0] }; break;
        case 'CS': st.strokeSpace = a[0] && a[0].t === 'name' ? spaceOf(ctx, resources, a[0].v) : 'other'; st.stroke = { space: st.strokeSpace, v: [0, 0, 0, 1] }; break;
        case 'sc': case 'scn': st.fill = { space: (a.length && a[a.length - 1].t === 'name') ? 'other' : st.fillSpace, v: argNums(a) }; break;
        case 'SC': case 'SCN': st.stroke = { space: (a.length && a[a.length - 1].t === 'name') ? 'other' : st.strokeSpace, v: argNums(a) }; break;
        case 'gs':
          if (a[0] && a[0].t === 'name') {
            var gsd = get(ctx, get(ctx, resources, 'ExtGState'), a[0].v);
            if (isDict(gsd)) {
              var ca = get(ctx, gsd, 'ca'); if (isNum(ca)) st.ca = ca.asNumber();
              var CA = get(ctx, gsd, 'CA'); if (isNum(CA)) st.CA = CA.asNumber();
              var bm = get(ctx, gsd, 'BM'); st.bm = isName(bm) ? nameOf(bm) : isArr(bm) ? nameOf(deref(ctx, bm.get(0))) : st.bm;
              var gf = get(ctx, gsd, 'Font'); if (isArr(gf)) { st.fontRef = gf.get(0); st.size = numOf(deref(ctx, gf.get(1)), st.size); st.font = await fontInfo(env, st.fontRef); }
            }
          }
          break;
        case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = [1, 0, 0, 1, 0, 0]; break;
        case 'ET': break;
        case 'Tf':
          if (a[0] && a[0].t === 'name') {
            var fr = getRaw(get(ctx, resources, 'Font'), a[0].v);
            st.fontRef = fr || null;
            st.font = fr ? await fontInfo(env, fr) : null;
          }
          st.size = a[1] && a[1].t === 'n' ? a[1].v : 0;
          break;
        case 'Tc': st.tc = argNums(a)[0] || 0; break;
        case 'Tw': st.tw = argNums(a)[0] || 0; break;
        case 'Tz': st.th = (a[0] && a[0].t === 'n' ? a[0].v : 100) / 100; break;
        case 'TL': st.tl = argNums(a)[0] || 0; break;
        case 'Ts': st.rise = argNums(a)[0] || 0; break;
        case 'Tr': st.tr = argNums(a)[0] || 0; break;
        case 'Td': v = argNums(a); tlm = mul([1, 0, 0, 1, v[0] || 0, v[1] || 0], tlm); tm = tlm.slice(); break;
        case 'TD': v = argNums(a); st.tl = -(v[1] || 0); tlm = mul([1, 0, 0, 1, v[0] || 0, v[1] || 0], tlm); tm = tlm.slice(); break;
        case 'Tm': v = argNums(a); if (v.length === 6) { tlm = v.slice(); tm = v.slice(); } break;
        case 'T*': tlm = mul([1, 0, 0, 1, 0, -st.tl], tlm); tm = tlm.slice(); break;
        case 'Tj': case 'TJ': case '\'': case '"':
          if (op === '\'' || op === '"') {
            if (op === '"') { var aw = argNums(a); st.tw = aw[0] || 0; st.tc = aw[1] || 0; }
            tlm = mul([1, 0, 0, 1, 0, -st.tl], tlm); tm = tlm.slice();
          }
          tm = showText(env, oi, op, a, st, tm, streamId, ocHidden());
          break;
        case 'm': case 'l': if (pathStart < 0) pathStart = oi; v = argNums(a); path = union(path, bboxOf(st.ctm, v[0], v[1], v[0], v[1])); break;
        case 'c': if (pathStart < 0) pathStart = oi; v = argNums(a); path = union(path, bboxOf(st.ctm, Math.min(v[0], v[2], v[4]), Math.min(v[1], v[3], v[5]), Math.max(v[0], v[2], v[4]), Math.max(v[1], v[3], v[5]))); break;
        case 'v': case 'y': if (pathStart < 0) pathStart = oi; v = argNums(a); path = union(path, bboxOf(st.ctm, Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3]))); break;
        case 're': if (pathStart < 0) pathStart = oi; v = argNums(a); path = union(path, bboxOf(st.ctm, Math.min(v[0], v[0] + v[2]), Math.min(v[1], v[1] + v[3]), Math.max(v[0], v[0] + v[2]), Math.max(v[1], v[1] + v[3]))); break;
        case 'h': break;
        case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'S': case 's':
          if (path) {
            var filled = /^[fFBb]/.test(op);
            env.items.push({ kind: 'path', stream: streamId, op: oi, from: pathClip ? oi : pathStart, bbox: path, fill: filled ? st.fill : null, opaque: st.ca >= 0.999 && (st.bm === 'Normal' || st.bm === 'Compatible'), white: filled && isWhiteColor(st.fill), hiddenLayer: ocHidden(), depth: depth });
          }
          path = null; pathStart = -1; pathClip = false;
          break;
        case 'n': path = null; pathStart = -1; pathClip = false; break;
        case 'W': case 'W*': pathClip = true; break;
        case 'sh': env.items.push({ kind: 'shading', stream: streamId, op: oi, bbox: env.pageBox.slice(), hiddenLayer: ocHidden(), depth: depth }); break;
        case 'BI':
          env.items.push({ kind: 'image', inline: true, stream: streamId, op: oi, bbox: bboxOf(st.ctm, 0, 0, 1, 1), opaque: st.ca >= 0.999, hiddenLayer: ocHidden(), depth: depth });
          break;
        case 'Do':
          if (a[0] && a[0].t === 'name') {
            var xref = getRaw(get(ctx, resources, 'XObject'), a[0].v);
            var xo = deref(ctx, xref);
            if (isStream(xo)) {
              var sub = nameOf(get(ctx, xo, 'Subtype'));
              var xocRef = getRaw(xo, 'OC');
              var layerOff = ocHidden() || (!!xocRef && (env.ocOff.has(xocRef) || ocMembershipOff(env, xocRef)));
              if (sub === 'Image') {
                var masked = has(xo, 'SMask') || has(xo, 'Mask') || !!get(ctx, xo, 'ImageMask');
                env.items.push({ kind: 'image', stream: streamId, op: oi, ref: xref, bbox: bboxOf(st.ctm, 0, 0, 1, 1), opaque: !masked && st.ca >= 0.999, hiddenLayer: layerOff, depth: depth });
              } else if (sub === 'Form') {
                var fm2 = nums(ctx, get(ctx, xo, 'Matrix'));
                var inner = copyState(st);
                if (fm2.length === 6) inner.ctm = mul(fm2, st.ctm);
                var bb = nums(ctx, get(ctx, xo, 'BBox'));
                var formItem = { kind: 'form', stream: streamId, op: oi, ref: xref, bbox: bb.length === 4 ? bboxOf(inner.ctm, Math.min(bb[0], bb[2]), Math.min(bb[1], bb[3]), Math.max(bb[0], bb[2]), Math.max(bb[1], bb[3])) : env.pageBox.slice(), hiddenLayer: layerOff, depth: depth };
                env.items.push(formItem);
                if (depth < 8 && isRef(xref) && !env.formStack.has(xref)) {
                  env.formStack.add(xref);
                  var fbytes = await decodeStream(ctx, xo);
                  if (fbytes) {
                    var sid = 'x' + refKey(xref) + '#' + (env.formUse++);
                    env.formStreams[sid] = xref;
                    var before = env.items.length;
                    var saveOc = env.ocBase; env.ocBase = layerOff;
                    await interpret(env, fbytes, get(ctx, xo, 'Resources') || resources, inner, depth + 1, sid);
                    env.ocBase = saveOc;
                    formItem.children = [before, env.items.length];
                  } else { env.unparsed = true; }
                  env.formStack.delete(xref);
                }
              }
            }
          }
          break;
        case 'BDC': case 'BMC':
          var off = false;
          if (op === 'BDC' && a[0] && a[0].t === 'name' && a[0].v === 'OC' && a[1]) {
            var pr = a[1].t === 'name' ? getRaw(get(ctx, resources, 'Properties'), a[1].v) : null;
            if (pr && (env.ocOff.has(pr) || ocMembershipOff(env, pr))) off = true;
          }
          oc.push(off);
          break;
        case 'EMC': oc.pop(); break;
        default: break;
      }
    }
  }
  function ocMembershipOff(env, ref) {
    var d = deref(env.ctx, ref);
    if (!isDict(d) || nameOf(get(env.ctx, d, 'Type')) !== 'OCMD') return false;
    var ocgs = deref(env.ctx, d.get(N('OCGs')));
    var list = isArr(ocgs) ? arr(env.ctx, ocgs) : ocgs ? [d.get(N('OCGs'))] : [];
    var pol = nameOf(get(env.ctx, d, 'P')) || 'AnyOn';
    var offs = list.map(function (r) { return env.ocOff.has(r); });
    if (!offs.length) return false;
    if (pol === 'AllOn') return offs.some(Boolean);
    if (pol === 'AnyOn') return offs.every(Boolean);
    if (pol === 'AnyOff') return !offs.some(Boolean);
    if (pol === 'AllOff') return !offs.every(Boolean);
    return false;
  }

  /* One text-showing operator: glyph boxes in page space, the decoded text and how it is drawn. */
  function showText(env, oi, op, a, st, tm, streamId, hiddenLayer) {
    var info = st.font || { codeLen: 1, supported: false, scale: 0.001, missing: 500, dw: 1000 };
    var parts = [];
    if (op === 'TJ') { var list = a[0] && a[0].t === 'a' ? a[0].v : []; list.forEach(function (x) { if (x.t === 's') parts.push(x.v); else if (x.t === 'n') parts.push(x.v); }); }
    else { var s = a[a.length - 1]; if (s && s.t === 's') parts.push(s.v); }
    var m = mul(tm, st.ctm);
    var tfs = st.size, th = st.th;
    var x = 0;
    var glyphs = [];
    var text = '';
    var bbox = null;
    var lo = -0.22 * tfs + st.rise, hi = 0.92 * tfs + st.rise;
    for (var p = 0; p < parts.length; p++) {
      var part = parts[p];
      if (typeof part === 'number') { x -= part / 1000 * tfs * th; continue; }
      var codes = codesOf(info, part);
      for (var c = 0; c < codes.length; c++) {
        var code = codes[c];
        var w = glyphWidth(info, code) * (info.scale || 0.001);
        var adv = (w * tfs + st.tc + (info.codeLen === 1 && code === 32 ? st.tw : 0)) * th;
        var gx1 = x + w * tfs * th;
        var gb = bboxOf(m, Math.min(x, gx1), Math.min(lo, hi), Math.max(x, gx1), Math.max(lo, hi));
        var ch = glyphText(info, code);
        glyphs.push({ code: code, bbox: gb, text: ch, w: w });
        text += ch;
        bbox = union(bbox, gb);
        x += adv;
      }
    }
    var newTm = mul([1, 0, 0, 1, x, 0], tm);
    var eff = Math.abs(tfs) * Math.hypot(m[2], m[3]);
    var mode = st.tr;
    var strokeOnly = mode === 1 || mode === 5;
    var item = {
      kind: 'text', stream: streamId, op: oi, opName: op, bbox: bbox || bboxOf(m, 0, 0, 0, 0), text: text, glyphs: glyphs, font: info,
      size: eff, mode: mode, tc: st.tc, tw: st.tw, th: th, tfs: tfs,
      white: strokeOnly ? isWhiteColor(st.stroke) : isWhiteColor(st.fill),
      alpha0: (strokeOnly ? st.CA : st.ca) <= 0.001, hiddenLayer: hiddenLayer, args: a
    };
    if (glyphs.length) env.items.push(item);
    return newTm;
  }

  /* Classifies text runs that a reader would not see. Returns [{ item, why }]. */
  function hiddenTextRuns(env) {
    var out = [];
    var items = env.items;
    var box = env.pageBox;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind !== 'text' || !it.text.replace(/\s+/g, '')) continue;
      var why = null;
      if (it.hiddenLayer) why = 'layer';
      else if (it.mode === 3 || it.mode === 7) why = 'invisible';
      else if (it.alpha0) why = 'transparent';
      else if (it.size < 1) why = 'tiny';
      else if (!overlaps(it.bbox, box)) why = 'offpage';
      else if (it.white) {
        var under = false;
        for (var k = i - 1; k >= 0 && !under; k--) {
          var u = items[k];
          if ((u.kind === 'image' || (u.kind === 'path' && u.fill && !u.white) || u.kind === 'shading' || u.kind === 'form') && !u.hiddenLayer && overlaps(u.bbox, it.bbox)) under = true;
        }
        if (!under) why = 'white';
      }
      if (!why) {
        for (var j = i + 1; j < items.length; j++) {
          var c = items[j];
          if (c.hiddenLayer) continue;
          if ((c.kind === 'image' && c.opaque) || (c.kind === 'path' && c.fill && c.opaque && c.fill.space !== 'other')) {
            if (contains(c.bbox, it.bbox, 1) || coverage(c.bbox, it.bbox) >= 0.9) { why = c.kind === 'image' ? 'underImage' : 'underShape'; break; }
          }
        }
      }
      if (why) out.push({ item: it, why: why });
    }
    return out;
  }

  /* Reads one page's drawing: text, images, shapes, in order. */
  async function readPage(ctx, pg, ocOff, opts) {
    var env = { ctx: ctx, fonts: (opts && opts.fonts) || new Map(), items: [], problems: [], streams: {}, formStreams: {}, formStack: new Set(), formUse: 0, ocOff: ocOff || new Set(), ocBase: false, pageBox: pageBox(ctx, pg), unparsed: false };
    var contents = deref(ctx, pg.dict.get(N('Contents')));
    var list = isArr(contents) ? arr(ctx, contents).map(function (r) { return deref(ctx, r); }) : contents ? [contents] : [];
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      if (!isStream(list[i])) continue;
      var b = await decodeStream(ctx, list[i]);
      if (b == null) { env.problems.push('A drawing stream could not be decoded'); env.unparsed = true; continue; }
      parts.push(b); parts.push(te('\n'));
    }
    var bytes = concatBytes(parts);
    var res = deref(ctx, pg.inherit.Resources);
    await interpret(env, bytes, res, null, 0, 'page');
    return env;
  }

  function offLayers(ctx, catalog) {
    var set = new Set();
    var ocp = get(ctx, catalog, 'OCProperties');
    var d = get(ctx, ocp, 'D');
    arr(ctx, get(ctx, d, 'OFF')).forEach(function (r) { if (isRef(r)) set.add(r); });
    if (nameOf(get(ctx, d, 'BaseState')) === 'OFF') {
      var on = new Set(arr(ctx, get(ctx, d, 'ON')));
      arr(ctx, get(ctx, ocp, 'OCGs')).forEach(function (r) { if (isRef(r) && !on.has(r)) set.add(r); });
    }
    return set;
  }

  /* ---------- rewriting content: replace text glyphs with equal spacing ---------- */

  function hex(codes, len) {
    var s = '<';
    for (var i = 0; i < codes.length; i++) { var h = codes[i].toString(16); while (h.length < len * 2) h = '0' + h; s += h; }
    return s + '>';
  }
  function fmt(n) { var r = Math.round(n * 10000) / 10000; return String(Object.is(r, -0) ? 0 : r); }

  /* Builds a replacement for a text operator that keeps glyphs where keep(g) is true and leaves exactly the same
     advance for the others, so every later glyph lands where it did. Returns null when that cannot be done exactly. */
  function rewriteShow(item, keep) {
    var info = item.font;
    if (!info || !info.supported || info.vertical) return null;
    if (!item.tfs) return null;
    var len = info.codeLen;
    var prefix = '';
    if (item.opName === '\'') prefix = 'T* ';
    if (item.opName === '"') { var aw = argNums(item.args); prefix = fmt(aw[0] || 0) + ' Tw ' + fmt(aw[1] || 0) + ' Tc T* '; }
    var arrOut = [];
    var pending = [];
    var gap = 0;
    function flush() { if (pending.length) { arrOut.push(hex(pending, len)); pending = []; } }
    var gi = 0;
    var parts = item.opName === 'TJ' ? (item.args[0] && item.args[0].t === 'a' ? item.args[0].v : []) : [item.args[item.args.length - 1]];
    for (var p = 0; p < parts.length; p++) {
      var part = parts[p];
      if (!part) continue;
      if (part.t === 'n') { flush(); gap += part.v; continue; }
      if (part.t !== 's') continue;
      var codes = codesOf(info, part.v);
      for (var c = 0; c < codes.length; c++) {
        var g = item.glyphs[gi++];
        if (!g) return null;
        if (keep(g)) {
          if (gap) { flush(); arrOut.push(fmt(gap)); gap = 0; }
          pending.push(codes[c]);
        } else {
          flush();
          var spacing = item.tc + (len === 1 && codes[c] === 32 ? item.tw : 0);
          gap -= (g.w * 1000) + spacing * 1000 / item.tfs;
        }
      }
    }
    flush();
    if (gap) arrOut.push(fmt(gap));
    if (!arrOut.length) return prefix ? prefix.trim() : '';
    return prefix + '[' + arrOut.join(' ') + '] TJ';
  }

  /* Applies edits [{ start, end, text }] to a byte buffer. */
  function applyEdits(bytes, edits) {
    edits = edits.slice().sort(function (a, b) { return a.start - b.start; });
    var parts = [], at = 0;
    for (var i = 0; i < edits.length; i++) {
      var e = edits[i];
      if (e.start < at) continue;
      parts.push(bytes.subarray(at, e.start));
      parts.push(te(' ' + e.text + ' '));
      at = e.end;
    }
    parts.push(bytes.subarray(at));
    return concatBytes(parts);
  }

  /* Writes edited streams back: the page gets one new content stream; edited form drawings are replaced in place. */
  function commitStreams(ctx, pg, env, editsByStream) {
    var changed = 0;
    Object.keys(editsByStream).forEach(function (sid) {
      var edits = editsByStream[sid];
      if (!edits.length || !env.streams[sid]) return;
      var nb = applyEdits(env.streams[sid].bytes, edits);
      changed++;
      if (sid === 'page') {
        pg.dict.set(N('Contents'), ctx.register(ctx.flateStream(nb)));
      } else {
        var ref = env.formStreams[sid];
        var old = deref(ctx, ref);
        if (!isStream(old)) return;
        var ns = ctx.flateStream(nb);
        old.dict.entries().forEach(function (kv) { var k = kv[0].decodeText(); if (k !== 'Filter' && k !== 'DecodeParms' && k !== 'Length' && k !== 'DL') ns.dict.set(kv[0], kv[1]); });
        ctx.assign(ref, ns);
      }
    });
    return changed;
  }

  /* The edit that removes one drawing item. Text keeps its spacing; a path keeps any clipping but paints nothing. */
  function editFor(env, item, keepGlyph) {
    var s = env.streams[item.stream];
    if (!s) return null;
    var op = s.ops[item.op];
    if (item.kind === 'text') {
      var t = rewriteShow(item, keepGlyph || function () { return false; });
      if (t == null) return null;
      return { stream: item.stream, start: op.start, end: op.end, text: t };
    }
    if (item.kind === 'image' || item.kind === 'form' || item.kind === 'shading') return { stream: item.stream, start: op.start, end: op.end, text: '' };
    if (item.kind === 'path') {
      var from = item.from >= 0 && item.from !== item.op ? s.ops[item.from].start : op.end - op.op.length;
      if (item.from === item.op) from = op.end - op.op.length;
      return { stream: item.stream, start: from, end: op.end, text: 'n' };
    }
    return null;
  }

  /* ---------- JPEG metadata (EXIF, XMP, IPTC, comments) inside image streams ---------- */

  function jpegSegments(b) {
    var out = [];
    if (!b || b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
    var i = 2;
    while (i + 4 <= b.length && out.length < 500) {
      if (b[i] !== 0xFF) return out;
      var mk = b[i + 1];
      if (mk === 0xFF) { i++; continue; }
      if (mk === 0xD9 || mk === 0xDA) { out.push({ marker: mk, start: i, end: b.length, tail: true }); return out; }
      if (mk >= 0xD0 && mk <= 0xD7) { i += 2; continue; }
      var len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) return out;
      out.push({ marker: mk, start: i, end: Math.min(b.length, i + 2 + len), data: b.subarray(i + 4, Math.min(b.length, i + 2 + len)) });
      i += 2 + len;
    }
    return out;
  }
  function readTiff(d) {
    var res = {};
    if (!d || d.length < 8) return res;
    var le = d[0] === 0x49;
    var dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    function u16(o) { return o + 2 <= d.length ? dv.getUint16(o, le) : 0; }
    function u32(o) { return o + 4 <= d.length ? dv.getUint32(o, le) : 0; }
    var names = { 0x010F: 'Camera maker', 0x0110: 'Camera model', 0x0131: 'Software', 0x0132: 'Date', 0x013B: 'Artist', 0x8298: 'Copyright', 0x9003: 'Date taken', 0xA430: 'Camera owner', 0xA431: 'Camera serial number', 0xA435: 'Lens serial number' };
    function ifd(off, depth) {
      if (depth > 3 || off < 8 || off + 2 > d.length) return;
      var n = Math.min(u16(off), 200);
      for (var k = 0; k < n; k++) {
        var e = off + 2 + k * 12;
        if (e + 12 > d.length) break;
        var tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
        if (tag === 0x8825) { res.gps = true; continue; }
        if (tag === 0x8769) { ifd(u32(e + 8), depth + 1); continue; }
        if (names[tag] && type === 2) {
          var at = cnt > 4 ? u32(e + 8) : e + 8;
          if (at + cnt <= d.length && cnt < 512) res[names[tag]] = latin1(d, at, at + cnt).replace(/\0+$/, '').trim();
        }
      }
    }
    ifd(u32(4), 0);
    return res;
  }
  function jpegMeta(b) {
    var segs = jpegSegments(b);
    if (!segs) return null;
    var found = { exif: null, xmp: false, iptc: false, comment: '' };
    segs.forEach(function (s) {
      if (!s.data) return;
      var head = latin1(s.data, 0, 32);
      if (s.marker === 0xE1 && head.indexOf('Exif') === 0) found.exif = readTiff(s.data.subarray(6));
      else if (s.marker === 0xE1 && head.indexOf('http://ns.adobe.com/xap') === 0) found.xmp = true;
      else if (s.marker === 0xED) found.iptc = true;
      else if (s.marker === 0xFE) found.comment = clip(latin1(s.data, 0, 200), 80);
    });
    return found;
  }
  /* Keeps SOI, JFIF (APP0), colour profile (APP2), Adobe colour transform (APP14) and the image data. */
  function stripJpeg(b) {
    var segs = jpegSegments(b);
    if (!segs) return null;
    var keep = [b.subarray(0, 2)], removed = 0;
    segs.forEach(function (s) {
      var drop = (s.marker >= 0xE1 && s.marker <= 0xEF && s.marker !== 0xE2 && s.marker !== 0xEE) || s.marker === 0xFE;
      if (drop) removed++; else keep.push(b.subarray(s.start, s.end));
    });
    return removed ? concatBytes(keep) : null;
  }

  /* ---------- XMP ---------- */

  function xmpFields(xml) {
    var out = [];
    if (!xml) return out;
    var seen = {};
    var labels = { 'dc:creator': 'Author', 'dc:title': 'Title', 'dc:description': 'Description', 'dc:subject': 'Keywords', 'xmp:CreatorTool': 'Made with', 'pdf:Producer': 'Saved by', 'xmp:CreateDate': 'Created', 'xmp:ModifyDate': 'Changed', 'xmp:MetadataDate': 'Details changed', 'xmpMM:DocumentID': 'Document ID', 'xmpMM:InstanceID': 'Version ID', 'xmpMM:OriginalDocumentID': 'Original document ID', 'pdf:Keywords': 'Keywords', 'photoshop:AuthorsPosition': 'Author\'s job title', 'xmpRights:Owner': 'Owner', 'dc:rights': 'Rights' };
    function add(tag, value) {
      value = clip(value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'), 160);
      if (!value || seen[tag + value]) return;
      seen[tag + value] = 1;
      out.push({ label: labels[tag] || tag, value: value, tag: tag });
    }
    var re = /<([A-Za-z][\w.-]*:[\w.-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g, m;
    while ((m = re.exec(xml)) && out.length < 40) {
      var tag = m[1], inner = m[2];
      var openEnd = m.index + m[0].indexOf('>') + 1;
      if (/^(rdf|x):/.test(tag)) { re.lastIndex = openEnd; continue; }
      var lis = inner.match(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g);
      if (tag === 'xmpMM:History') add(tag, plural((inner.match(/<rdf:li/g) || []).length, 'saved step'));
      else if (lis) lis.forEach(function (li) { add(tag, li.replace(/<[^>]+>/g, '')); });
      else if (inner.indexOf('<') < 0) add(tag, inner);
      else re.lastIndex = openEnd;
    }
    var at = /\s([A-Za-z][\w.-]*:[\w.-]+)="([^"]*)"/g;
    while ((m = at.exec(xml)) && out.length < 60) {
      if (/^(rdf|x|xmlns):|^xmlns/.test(m[1]) || m[1].indexOf('xmlns') === 0) continue;
      if (m[2]) add(m[1], m[2]);
    }
    return out;
  }

  /* ---------- forms ---------- */

  function walkFields(ctx, catalog, fn) {
    var af = get(ctx, catalog, 'AcroForm');
    var roots = arr(ctx, get(ctx, af, 'Fields'));
    var seen = new Set();
    var stack = roots.map(function (r) { return { ref: r, name: '', ft: null, parent: null }; }).reverse();
    var n = 0;
    while (stack.length && n++ < 50000) {
      var it = stack.pop();
      var d = deref(ctx, it.ref);
      if (!isDict(d)) continue;
      var key = isRef(it.ref) ? it.ref : d;
      if (seen.has(key)) continue;
      seen.add(key);
      var t = textOf(ctx, get(ctx, d, 'T'));
      var name = t ? (it.name ? it.name + '.' + t : t) : it.name;
      var ft = nameOf(get(ctx, d, 'FT')) || it.ft;
      var kids = arr(ctx, get(ctx, d, 'Kids'));
      var fieldKids = kids.filter(function (k) { var kd = deref(ctx, k); return isDict(kd) && (kd.has(N('T')) || kd.has(N('FT'))); });
      fn({ ref: it.ref, dict: d, name: name, ft: ft, isTerminal: !fieldKids.length, parent: it.parent });
      for (var i = fieldKids.length - 1; i >= 0; i--) stack.push({ ref: fieldKids[i], name: name, ft: ft, parent: it.ref });
    }
  }
  function fieldValue(ctx, d) {
    var v = get(ctx, d, 'V');
    if (v == null) return '';
    if (isName(v)) { var nv = nameOf(v); return nv === 'Off' ? '' : nv; }
    if (isArr(v)) return arr(ctx, v).map(function (x) { return textOf(ctx, x); }).join(', ');
    return textOf(ctx, v);
  }

  /* ---------- inspect (D3) ---------- */

  var PAGE_NAMES = [['A4', 595, 842], ['Letter', 612, 792], ['Legal', 612, 1008], ['A3', 842, 1191], ['A5', 420, 595], ['Tabloid', 792, 1224]];
  function sizeName(w, h) {
    for (var i = 0; i < PAGE_NAMES.length; i++) {
      var p = PAGE_NAMES[i];
      if (Math.abs(w - p[1]) < 3 && Math.abs(h - p[2]) < 3) return p[0] + ' portrait';
      if (Math.abs(h - p[1]) < 3 && Math.abs(w - p[2]) < 3) return p[0] + ' landscape';
    }
    return Math.round(w / 72 * 25.4) + ' × ' + Math.round(h / 72 * 25.4) + ' mm';
  }
  function fmtBytes(n) { if (n == null || !isFinite(n)) return ''; if (n < 1024) return n + ' bytes'; if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }

  var WHY = {
    invisible: 'Set to invisible',
    white: 'White text on a white page',
    tiny: 'Too small to see',
    offpage: 'Placed outside the page',
    underImage: 'Covered by a picture',
    underShape: 'Covered by a shape (often a fake black-out)',
    layer: 'On a hidden layer',
    transparent: 'Fully transparent'
  };

  var GROUPS = {
    info: { title: 'Who made it and when', explain: 'Names, software and dates saved inside the file. Anyone you send it to can read them.', option: 'metadata' },
    xmp: { title: 'Hidden details in XML', explain: 'A second copy of the file details, often with more history than the first.', option: 'metadata' },
    id: { title: 'File fingerprint', explain: 'An ID that can link this copy to the original and to other versions.', option: 'documentId' },
    attachments: { title: 'Attached files', explain: 'Other files packed inside this PDF. They travel with it.', option: 'attachments' },
    forms: { title: 'Form answers', explain: 'What has been typed into the form, including fields you may not see.', option: 'forms' },
    comments: { title: 'Comments and markup', explain: 'Notes, highlights and their authors and dates.', option: 'comments' },
    links: { title: 'Links to outside addresses', explain: 'Web or network addresses the file points to. They can reveal internal systems.', option: 'links' },
    hiddenText: { title: 'Text you cannot see', explain: 'Words that are in the file but not visible on the page. Copy-and-paste and search still find them.', option: 'hiddenText' },
    layers: { title: 'Hidden layers', explain: 'Parts of the page that are switched off but still inside the file.', option: 'hiddenText' },
    revisions: { title: 'Earlier versions inside the file', explain: 'The file was saved with changes added on top. Earlier versions can still be read.', option: 'revisions' },
    leftovers: { title: 'Unused leftovers', explain: 'Pieces of the file that are no longer shown but are still inside it.', option: 'revisions' },
    thumbnails: { title: 'Page previews', explain: 'Small saved pictures of pages. They can show content that was later changed.', option: 'thumbnails' },
    imageMeta: { title: 'Photo details', explain: 'Camera, software, dates or location saved inside pictures.', option: 'imageMeta' },
    appData: { title: 'Private data from other apps', explain: 'Data the app that made the file left behind for itself.', option: 'metadata' },
    fonts: { title: 'Fonts', explain: 'Font names can hint at the software or company that made the file. They are needed to show the text, so they stay.', option: null },
    pages: { title: 'Pages', explain: 'Page count and sizes.', option: null }
  };

  function group(id) { var g = GROUPS[id]; return { id: id, title: g.title, explain: g.explain, option: g.option, removable: !!g.option, items: [] }; }

  async function textWords(bytes, maxPages) {
    var pdf = await openJs(bytes);
    var words = new Set(), text = [];
    try {
      var n = Math.min(pdf.numPages, maxPages || 40);
      for (var i = 1; i <= n; i++) {
        var pg = await pdf.getPage(i);
        var tc = await withTimeout(pg.getTextContent(), 8000, 'Reading text');
        var s = tc.items.map(function (it) { return it.str || ''; }).join(' ');
        text.push(s);
        (s.match(/[\p{L}\p{N}][\p{L}\p{N}@._'\-]{2,}/gu) || []).forEach(function (w) { words.add(w); });
        pg.cleanup();
      }
    } finally { try { pdf.destroy(); } catch (e) {} }
    return { words: words, text: text.join('\n') };
  }

  /* Encrypted files: pdf.js can read them when only an owner password is set (the common "no printing" lock).
     It decrypts in its worker; nothing is run. Removal is not offered until the lock is taken off. */
  async function inspectEncrypted(bytes, report, raw) {
    var G = {};
    Object.keys(GROUPS).forEach(function (k) { G[k] = group(k); G[k].removable = false; });
    report.warnings.push('This file is locked with encryption. The details below were read, but they can only be removed once the lock is taken off.');
    var pdf;
    try { pdf = await openJs(bytes); }
    catch (e) { var err = new Error('This PDF needs a password to open.'); err.code = 'password'; throw err; }
    try {
      report.pageCount = pdf.numPages;
      var md = await pdf.getMetadata().catch(function () { return null; });
      var info = (md && md.info) || {};
      [['Title', 'Title'], ['Author', 'Author'], ['Subject', 'Subject'], ['Keywords', 'Keywords'], ['Creator', 'Made with'], ['Producer', 'Saved by'], ['CreationDate', 'Created'], ['ModDate', 'Last changed']].forEach(function (p) {
        var v = info[p[0]];
        if (v) G.info.items.push({ label: p[1], value: clip(/Date$/.test(p[0]) ? String(v).replace(/^D:(\d{4})(\d\d)(\d\d)(\d\d)?(\d\d)?.*/, '$1-$2-$3 $4:$5') : v, 200) });
      });
      if (md && md.metadata && md.metadata.getAll) { var all = md.metadata.getAll(); Object.keys(all).slice(0, 30).forEach(function (k) { G.xmp.items.push({ label: k, value: clip(String(all[k]), 160) }); }); }
      var att = await pdf.getAttachments().catch(function () { return null; });
      Object.keys(att || {}).forEach(function (k) { G.attachments.items.push({ label: att[k].filename || k, value: fmtBytes(att[k].content ? att[k].content.length : null) }); });
      var fields = await pdf.getFieldObjects().catch(function () { return null; });
      Object.keys(fields || {}).forEach(function (k) { (fields[k] || []).forEach(function (f) { if (f.value && f.value !== 'Off') G.forms.items.push({ label: clip(k, 80), value: '“' + clip(String(f.value), 120) + '”' }); }); });
      for (var i = 1; i <= Math.min(pdf.numPages, 300); i++) {
        var page = await pdf.getPage(i);
        var annots = await page.getAnnotations().catch(function () { return []; });
        annots.forEach(function (a) {
          if (a.subtype === 'Link') { if (a.url) G.links.items.push({ label: clip(a.url, 120), value: 'page ' + i }); return; }
          if (a.subtype === 'Widget' || a.subtype === 'Popup') return;
          var body = (a.contentsObj && a.contentsObj.str) || '';
          var by = (a.titleObj && a.titleObj.str) || '';
          var kindName = { Text: 'Note', FreeText: 'Text box', Highlight: 'Highlight', Underline: 'Underline', StrikeOut: 'Strike-through', Ink: 'Drawing', Stamp: 'Stamp', Square: 'Box', Circle: 'Circle', FileAttachment: 'Attached file' }[a.subtype] || a.subtype || 'Mark';
          G.comments.items.push({ label: kindName + ' on page ' + i, value: [body ? '“' + clip(body, 120) + '”' : '', by ? 'by ' + by : ''].filter(Boolean).join(' · ') || 'no text' });
        });
        page.cleanup();
      }
    } finally { try { pdf.destroy(); } catch (e) {} }
    if (raw.revisions > 1) G.revisions.items.push({ label: 'Saved versions', value: String(raw.revisions) });
    G.pages.items.push({ label: 'Pages', value: String(report.pageCount) });
    var order = ['info', 'xmp', 'attachments', 'forms', 'comments', 'revisions', 'links', 'pages'];
    report.groups = order.map(function (k) { var g = G[k]; g.count = g.items.length; return g; });
    report.counts = {};
    report.groups.forEach(function (g) { report.counts[g.id] = g.count; });
    var n = report.groups.filter(function (g) { return g.id !== 'pages'; }).reduce(function (a, g) { return a + g.count; }, 0);
    report.findingCount = n;
    report.summary = n ? 'This locked PDF carries ' + plural(n, 'detail') + ' you might not mean to share. Remove the lock to clean them.' : 'Nothing hidden could be read in this locked PDF.';
    return report;
  }

  async function inspectBytes(bytes, opts) {
    opts = opts || {};
    var started = now();
    var raw = scanRaw(bytes);
    var L = await loadDoc(bytes);
    var ctx = L.ctx, catalog = L.catalog;
    var G = {};
    Object.keys(GROUPS).forEach(function (k) { G[k] = group(k); });
    var report = { ok: true, encrypted: L.encrypted, version: latin1(bytes, raw.headerAt + 5, raw.headerAt + 8), byteSize: bytes.length, pageCount: 0, groups: [], warnings: [], revisions: raw.revisions };

    if (L.encrypted) return inspectEncrypted(bytes, report, raw);

    /* Info dictionary */
    var info = deref(ctx, ctx.trailerInfo.Info);
    var INFO = [['Title', 'Title'], ['Author', 'Author'], ['Subject', 'Subject'], ['Keywords', 'Keywords'], ['Creator', 'Made with'], ['Producer', 'Saved by'], ['CreationDate', 'Created'], ['ModDate', 'Last changed']];
    if (isDict(info) && !L.encrypted) {
      INFO.forEach(function (p) {
        var v = /Date$/.test(p[0]) ? dateOf(ctx, info.get(N(p[0]))) : textOf(ctx, info.get(N(p[0])));
        if (v) G.info.items.push({ label: p[1], value: clip(v, 200), key: p[0] });
      });
      info.keys().forEach(function (k) {
        var name = k.decodeText();
        if (INFO.some(function (p) { return p[0] === name; }) || name === 'Trapped') return;
        var v = textOf(ctx, info.get(k));
        if (v) G.info.items.push({ label: name, value: clip(v, 200), key: name, custom: true });
      });
    }
    /* XMP */
    var meta = get(ctx, catalog, 'Metadata');
    if (isStream(meta) && !L.encrypted) {
      var xb = await decodeStream(ctx, meta, 4 * 1024 * 1024);
      var xml = xb ? new TextDecoder('utf-8').decode(xb) : '';
      var fields = xmpFields(xml);
      fields.forEach(function (f) { G.xmp.items.push({ label: f.label, value: f.value }); });
      if (!fields.length) G.xmp.items.push({ label: 'XML details', value: fmtBytes(xb ? xb.length : 0) });
    }
    /* ID */
    var idArr = deref(ctx, ctx.trailerInfo.ID);
    if (isArr(idArr) && idArr.size()) {
      var idv = deref(ctx, idArr.get(0));
      var hexv = '';
      try { var ib = idv.asBytes(); for (var q = 0; q < ib.length && q < 32; q++) hexv += ('0' + ib[q].toString(16)).slice(-2); } catch (e) { hexv = textOf(ctx, idv); }
      G.id.items.push({ label: 'ID', value: hexv.toUpperCase() });
    }

    /* Pages */
    var pages = pageList(ctx);
    report.pageCount = pages.length;
    var sizes = {};
    pages.forEach(function (pg) { var b = pageBox(ctx, pg); var r = pageRotate(ctx, pg); var w = b[2] - b[0], h = b[3] - b[1]; if (r % 180) { var t = w; w = h; h = t; } var nm = sizeName(w, h); sizes[nm] = (sizes[nm] || 0) + 1; });
    G.pages.items.push({ label: 'Pages', value: String(pages.length) });
    Object.keys(sizes).forEach(function (k) { G.pages.items.push({ label: k, value: plural(sizes[k], 'page') }); });

    /* Attachments */
    var names = get(ctx, catalog, 'Names');
    var ef = get(ctx, names, 'EmbeddedFiles');
    var attachments = [];
    function addFile(fs, where) {
      fs = deref(ctx, fs);
      if (!isDict(fs)) return;
      var nm = textOf(ctx, get(ctx, fs, 'UF')) || textOf(ctx, get(ctx, fs, 'F')) || 'unnamed';
      var efd = get(ctx, fs, 'EF');
      var st = get(ctx, efd, 'F') || get(ctx, efd, 'UF');
      var size = null;
      if (isStream(st)) { size = numOf(get(ctx, get(ctx, st, 'Params'), 'Size'), null); if (size == null) { try { size = st.getContents().length; } catch (e) {} } }
      attachments.push({ name: nm, size: size, desc: textOf(ctx, get(ctx, fs, 'Desc')), where: where });
    }
    if (ef) nameTree(ctx, ef).forEach(function (e) { addFile(e.value, 'attached to the document'); });
    arr(ctx, get(ctx, catalog, 'AF')).forEach(function (r) { var nmx = textOf(ctx, get(ctx, r, 'UF')) || textOf(ctx, get(ctx, r, 'F')); if (!attachments.some(function (a) { return a.name === nmx; })) addFile(r, 'associated with the document'); });

    /* Annotations, links, comments, thumbnails */
    var links = {}, fonts = {};
    var linkCount = 0;
    var fieldWidgets = new Set();
    pages.forEach(function (pg, pi) {
      if (pg.dict.has(N('Thumb'))) G.thumbnails.items.push({ label: 'Page ' + (pi + 1), value: 'has a saved preview picture', page: pi });
      if (pg.dict.has(N('PieceInfo'))) G.appData.items.push({ label: 'Page ' + (pi + 1), value: 'private app data', page: pi });
      if (pg.dict.has(N('Metadata'))) G.xmp.items.push({ label: 'Page ' + (pi + 1), value: 'its own XML details', page: pi });
      arr(ctx, get(ctx, pg.dict, 'Annots')).forEach(function (ar) {
        var a = deref(ctx, ar);
        if (!isDict(a)) return;
        var st = nameOf(get(ctx, a, 'Subtype')) || '';
        if (st === 'Widget') { fieldWidgets.add(ar); return; }
        if (st === 'Popup') return;
        if (st === 'FileAttachment') { addFile(get(ctx, a, 'FS'), 'on page ' + (pi + 1)); }
        if (st === 'Link') {
          var act = get(ctx, a, 'A');
          var s2 = nameOf(get(ctx, act, 'S'));
          var target = s2 === 'URI' ? textOf(ctx, get(ctx, act, 'URI')) : (s2 === 'GoToR' || s2 === 'Launch' || s2 === 'GoToE') ? textOf(ctx, get(ctx, act, 'F')) || textOf(ctx, get(ctx, get(ctx, act, 'F'), 'F')) : '';
          if (target) { linkCount++; links[target] = links[target] || []; if (links[target].indexOf(pi) < 0) links[target].push(pi); }
          return;
        }
        var author = textOf(ctx, get(ctx, a, 'T'));
        var body = textOf(ctx, get(ctx, a, 'Contents')) || textOf(ctx, get(ctx, a, 'RC')).replace(/<[^>]+>/g, ' ');
        var date = dateOf(ctx, get(ctx, a, 'M')) || dateOf(ctx, get(ctx, a, 'CreationDate'));
        var kind = { Text: 'Note', FreeText: 'Text box', Highlight: 'Highlight', Underline: 'Underline', StrikeOut: 'Strike-through', Squiggly: 'Squiggle', Ink: 'Drawing', Stamp: 'Stamp', Square: 'Box', Circle: 'Circle', Line: 'Line', Polygon: 'Shape', PolyLine: 'Line', Caret: 'Insert mark', FileAttachment: 'Attached file', Sound: 'Sound', Redact: 'Redaction mark (not applied yet)' }[st] || st || 'Mark';
        var value = [body ? '“' + clip(body, 120) + '”' : '', author ? 'by ' + clip(author, 60) : '', date].filter(Boolean).join(' · ');
        G.comments.items.push({ label: kind + ' on page ' + (pi + 1), value: value || 'no text', page: pi, author: author, text: body });
      });
      var res = deref(ctx, pg.inherit.Resources);
      var fd = get(ctx, res, 'Font');
      if (isDict(fd)) fd.values().forEach(function (fr) { var f = deref(ctx, fr); var bn = nameOf(get(ctx, f, 'BaseFont')); if (bn) { var clean = bn.replace(/^[A-Z]{6}\+/, ''); fonts[clean] = fonts[clean] || { subset: /^[A-Z]{6}\+/.test(bn), embedded: false }; var fdesc = get(ctx, f, 'FontDescriptor') || get(ctx, deref(ctx, arr(ctx, get(ctx, f, 'DescendantFonts'))[0]), 'FontDescriptor'); if (fdesc && (has(fdesc, 'FontFile') || has(fdesc, 'FontFile2') || has(fdesc, 'FontFile3'))) fonts[clean].embedded = true; } });
    });
    attachments.forEach(function (a) { G.attachments.items.push({ label: a.name, value: [fmtBytes(a.size), a.desc ? '“' + clip(a.desc, 60) + '”' : '', a.where].filter(Boolean).join(' · '), name: a.name, size: a.size }); });
    Object.keys(links).forEach(function (u) { G.links.items.push({ label: clip(u, 120), value: 'page ' + links[u].map(function (p) { return p + 1; }).join(', '), url: u }); });
    Object.keys(fonts).sort().forEach(function (f) { G.fonts.items.push({ label: f, value: fonts[f].embedded ? 'included' : 'not included' }); });

    /* Forms */
    var af = get(ctx, catalog, 'AcroForm');
    if (af && !L.encrypted) {
      walkFields(ctx, catalog, function (f) {
        if (!f.isTerminal) return;
        var val = fieldValue(ctx, f.dict);
        var flags = numOf(get(ctx, f.dict, 'F'), 0);
        var kids = arr(ctx, get(ctx, f.dict, 'Kids'));
        kids.forEach(function (k) { flags |= numOf(get(ctx, k, 'F'), 0); });
        var hidden = (flags & 2) || (flags & 32);
        if (!val && !hidden) return;
        var kind = { Tx: 'Text', Btn: 'Choice', Ch: 'List', Sig: 'Signature' }[f.ft] || 'Field';
        G.forms.items.push({ label: clip(f.name || 'Unnamed field', 80), value: (val ? '“' + clip(val, 120) + '”' : 'empty') + (hidden ? ' · hidden field' : ''), hidden: !!hidden, kind: kind });
      });
      if (has(af, 'XFA')) G.forms.items.push({ label: 'Dynamic form (XFA)', value: 'a second form layer that most apps do not show' });
    }

    /* Hidden text and layers, per page */
    var ocOff = offLayers(ctx, catalog);
    var ocp = get(ctx, catalog, 'OCProperties');
    arr(ctx, get(ctx, ocp, 'OCGs')).forEach(function (r) {
      var nm = textOf(ctx, get(ctx, r, 'Name')) || 'Unnamed layer';
      G.layers.items.push({ label: clip(nm, 80), value: ocOff.has(r) ? 'switched off' : 'switched on', off: ocOff.has(r) });
    });
    if (!L.encrypted) {
      var fontCache = new Map();
      var limit = Math.min(pages.length, opts.maxPages || 300);
      for (var pi2 = 0; pi2 < limit; pi2++) {
        if (now() - started > (opts.budgetMs || 45000)) { report.warnings.push('Only the first ' + pi2 + ' pages were checked for hidden text because the file is very large.'); break; }
        var env = await readPage(ctx, pages[pi2], ocOff, { fonts: fontCache });
        hiddenTextRuns(env).forEach(function (h) {
          if (h.why === 'layer') { G.layers.items.push({ label: 'Hidden layer text on page ' + (pi2 + 1), value: '“' + clip(h.item.text, 100) + '”', page: pi2, text: h.item.text }); return; }
          G.hiddenText.items.push({ label: WHY[h.why] + ' · page ' + (pi2 + 1), value: '“' + clip(h.item.text, 100) + '”', page: pi2, why: h.why, text: h.item.text });
        });
        if (env.unparsed) report.warnings.push('Part of page ' + (pi2 + 1) + ' could not be read, so hidden text there may be missed.');
        if ((pi2 & 7) === 7) await tick();
      }
      if (pages.length > limit) report.warnings.push('Hidden text was checked on the first ' + limit + ' pages only.');
    } else if (raw.disguisedNames) { /* nothing */ }

    /* Images: XMP and EXIF */
    var imgCount = 0;
    var streamsChecked = 0;
    var objs = ctx.enumerateIndirectObjects();
    for (var oi = 0; oi < objs.length && streamsChecked < 2000; oi++) {
      var o = objs[oi][1];
      if (!isStream(o) || nameOf(get(ctx, o, 'Subtype')) !== 'Image') continue;
      streamsChecked++;
      if (has(o, 'Metadata')) { imgCount++; G.imageMeta.items.push({ label: 'Picture ' + imgCount, value: 'has its own XML details' }); }
      var filt = get(ctx, o, 'Filter');
      var fname = isArr(filt) ? nameOf(deref(ctx, filt.get(filt.size() - 1))) : nameOf(filt);
      if (fname === 'DCTDecode' && !isArr(filt)) {
        var jm = null;
        try { jm = jpegMeta(o.getContents()); } catch (e) { jm = null; }
        if (jm && (jm.exif || jm.xmp || jm.iptc || jm.comment)) {
          imgCount++;
          var bits = [];
          if (jm.exif) Object.keys(jm.exif).forEach(function (k) { if (k !== 'gps') bits.push(k + ': ' + jm.exif[k]); });
          if (jm.exif && jm.exif.gps) bits.unshift('Location (GPS)');
          if (jm.xmp) bits.push('XML details');
          if (jm.iptc) bits.push('Photoshop captions');
          if (jm.comment) bits.push('comment “' + jm.comment + '”');
          G.imageMeta.items.push({ label: 'Picture ' + imgCount, value: clip(bits.join(' · '), 220), gps: !!(jm.exif && jm.exif.gps) });
        }
      }
    }
    /* App private data elsewhere */
    var pieceCount = 0;
    if (catalog.has(N('PieceInfo'))) pieceCount++;
    if (pieceCount) G.appData.items.push({ label: 'Document', value: 'private app data' });

    /* Revisions and leftovers */
    if (raw.revisions > 1) {
      G.revisions.items.push({ label: 'Saved versions', value: raw.revisions + ' (the last one is what you see)' });
      if (!L.encrypted && opts.revisions !== false) {
        try {
          var finalWords = (await withTimeout(textWords(bytes, 40), 20000, 'Reading text')).words;
          var bounds = raw.eofs.slice(0, -1).slice(-4);
          for (var bi = 0; bi < bounds.length; bi++) {
            var slice = bytes.subarray(0, bounds[bi]);
            var label = 'Earlier version ' + (raw.eofs.length - bounds.length + bi);
            try {
              var Lp = await loadDoc(slice);
              var pinfo = deref(Lp.ctx, Lp.ctx.trailerInfo.Info);
              var prevBits = [];
              if (isDict(pinfo)) ['Title', 'Author'].forEach(function (k) {
                var pv = textOf(Lp.ctx, pinfo.get(N(k)));
                var cur = isDict(info) ? textOf(ctx, info.get(N(k))) : '';
                if (pv && pv !== cur) prevBits.push((k === 'Title' ? 'title' : 'author') + ' “' + clip(pv, 80) + '”');
              });
              var pw = await withTimeout(textWords(slice, 40), 20000, 'Reading an earlier version');
              var gone = [];
              pw.words.forEach(function (w) { if (!finalWords.has(w) && gone.length < 40) gone.push(w); });
              if (gone.length) prevBits.push('text no longer shown: “' + clip(gone.join(' '), 160) + '”');
              G.revisions.items.push({ label: label, value: prevBits.length ? prevBits.join(' · ') : 'no visible difference found', removedText: gone.join(' ') });
            } catch (e) {
              G.revisions.items.push({ label: label, value: 'could not be opened on its own, but its pieces are still in the file' });
            }
          }
        } catch (e) { report.warnings.push('Earlier versions could not be compared: ' + friendlyError(e)); }
      }
    }
    var reach = reachable(ctx, [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt].filter(Boolean));
    var leftover = 0;
    objs.forEach(function (kv) {
      var o2 = kv[1];
      if (reach.has(kv[0])) return;
      if (isStream(o2)) { var t = nameOf(get(ctx, o2, 'Type')); if (t === 'XRef' || t === 'ObjStm') return; }
      leftover++;
    });
    if (leftover) G.leftovers.items.push({ label: 'Unused pieces', value: plural(leftover, 'piece') + ' of earlier content that nothing points to' });

    /* Assemble */
    var order = ['info', 'xmp', 'id', 'attachments', 'forms', 'comments', 'hiddenText', 'layers', 'revisions', 'leftovers', 'links', 'thumbnails', 'imageMeta', 'appData', 'fonts', 'pages'];
    report.groups = order.map(function (k) { var g = G[k]; g.count = g.items.length; return g; });
    report.counts = {};
    report.groups.forEach(function (g) { report.counts[g.id] = g.count; });
    var findings = report.groups.filter(function (g) { return g.removable && g.count; });
    report.findingCount = findings.reduce(function (s, g) { return s + g.count; }, 0);
    report.summary = findings.length ?
      'This PDF carries ' + plural(report.findingCount, 'detail') + ' you might not mean to share, in ' + plural(findings.length, 'group') + ': ' + findings.slice(0, 4).map(function (g) { return g.title.toLowerCase(); }).join(', ') + (findings.length > 4 ? ' and more' : '') + '.' :
      'Nothing hidden found. This PDF only shows what is on its pages.';
    report.ms = Math.round(now() - started);
    return report;
  }

  /* ---------- rewriting the whole file ---------- */

  /* Deletes every object that the document no longer points to (old revisions, removed scripts, replaced pages). */
  function collectGarbage(ctx) {
    var roots = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt].filter(Boolean);
    var keep = reachable(ctx, roots);
    var removed = 0;
    ctx.enumerateIndirectObjects().forEach(function (kv) { if (!keep.has(kv[0])) { ctx.delete(kv[0]); removed++; } });
    return removed;
  }
  async function saveClean(doc) {
    var removed = collectGarbage(doc.context);
    var out = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 2000 });
    out = out instanceof Uint8Array ? out : new Uint8Array(out);
    return { bytes: out, removedObjects: removed };
  }

  function ownResources(ctx, pg) {
    var r = pg.dict.get(N('Resources'));
    var d = deref(ctx, r);
    if (isDict(d)) return d;
    var inherited = deref(ctx, pg.inherit.Resources);
    var nd = isDict(inherited) ? inherited.clone(ctx) : ctx.obj({});
    pg.dict.set(N('Resources'), nd);
    return nd;
  }
  function addXObject(ctx, pg, ref, prefix) {
    var res = ownResources(ctx, pg);
    var xo = deref(ctx, res.get(N('XObject')));
    if (!isDict(xo)) { xo = ctx.obj({}); res.set(N('XObject'), xo); }
    var k = 1, name;
    do { name = prefix + (k++); } while (xo.has(N(name)) && k < 100000);
    xo.set(N(name), ref);
    return name;
  }
  /* Wraps the page's existing drawing in q/Q and appends extra drawing after it. */
  function appendDrawing(ctx, pg, text) {
    var c = pg.dict.get(N('Contents'));
    var list = isArr(deref(ctx, c)) ? arr(ctx, c) : c ? [c] : [];
    var pre = ctx.register(ctx.stream('q\n'));
    var post = ctx.register(ctx.flateStream('\nQ\n' + text + '\n'));
    pg.dict.set(N('Contents'), ctx.obj([pre].concat(list).concat([post])));
  }

  /* Draws an annotation's saved look into the page, the way a printer would. Returns false when it has none. */
  function flattenInto(ctx, pg, annot, drawList) {
    var flags = numOf(get(ctx, annot, 'F'), 0);
    if (flags & 2 || flags & 32) return true;
    var ap = get(ctx, annot, 'AP');
    var nref = getRaw(dictOf(ap), 'N');
    var n = deref(ctx, nref);
    if (isDict(n) && !isStream(n)) { var as = nameOf(get(ctx, annot, 'AS')); nref = as ? getRaw(n, as) : null; n = deref(ctx, nref); }
    if (!isStream(n) || !isRef(nref)) return false;
    var rect = nums(ctx, get(ctx, annot, 'Rect'));
    if (rect.length !== 4) return false;
    var r = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
    var bb = nums(ctx, get(ctx, n, 'BBox'));
    if (bb.length !== 4) return false;
    var mtx = nums(ctx, get(ctx, n, 'Matrix'));
    if (mtx.length !== 6) mtx = [1, 0, 0, 1, 0, 0];
    var tb = bboxOf(mtx, Math.min(bb[0], bb[2]), Math.min(bb[1], bb[3]), Math.max(bb[0], bb[2]), Math.max(bb[1], bb[3]));
    var tw = tb[2] - tb[0], thh = tb[3] - tb[1];
    if (!(tw > 0) || !(thh > 0)) return true;
    var sx = (r[2] - r[0]) / tw, sy = (r[3] - r[1]) / thh;
    n.dict.set(N('Type'), N('XObject'));
    n.dict.set(N('Subtype'), N('Form'));
    var name = addXObject(ctx, pg, nref, 'LeFlat');
    drawList.push('q ' + [sx, 0, 0, sy, r[0] - tb[0] * sx, r[1] - tb[1] * sy].map(fmt).join(' ') + ' cm /' + name + ' Do Q');
    return true;
  }

  var COMMENT_DROP = { Text: 1, Popup: 1, FileAttachment: 1, Sound: 1 };
  var ACTIVE_ANNOTS = { RichMedia: 1, '3D': 1, Screen: 1, Movie: 1, Sound: 1 };
  var RISKY_ACTIONS = { JavaScript: 'danger', Launch: 'danger', GoToR: 'caution', GoToE: 'caution', SubmitForm: 'caution', ImportData: 'caution', Rendition: 'caution', Movie: 'caution', Sound: 'caution', RichMediaExecute: 'caution', URI: 'info' };

  function actionChain(ctx, a) {
    var out = [], seen = new Set(), stack = [a];
    while (stack.length && out.length < 200) {
      var r = stack.pop();
      var d = deref(ctx, r);
      if (!isDict(d) || seen.has(d)) continue;
      if (isRef(r)) { if (seen.has(r)) continue; seen.add(r); }
      seen.add(d);
      out.push(d);
      var nx = getRaw(d, 'Next');
      if (isArr(deref(ctx, nx))) arr(ctx, nx).forEach(function (x) { stack.push(x); }); else if (nx) stack.push(nx);
    }
    return out;
  }
  function chainRisk(ctx, a, keepUri) {
    var worst = null;
    actionChain(ctx, a).forEach(function (d) {
      var s = nameOf(get(ctx, d, 'S'));
      var lv = RISKY_ACTIONS[s] || (d.has(N('JS')) ? 'danger' : null);
      if (lv === 'info' && !keepUri) lv = 'caution';
      if (lv === 'danger' || (lv === 'caution' && worst !== 'danger')) worst = lv;
      if (lv === 'info' && !worst) worst = 'info';
    });
    return worst;
  }

  /* Removes things that can run or reach out: scripts, auto actions, launch/submit/import, rich media, XFA, outside streams. */
  function removeActive(ctx, catalog, opts) {
    opts = opts || {};
    var n = { scripts: 0, actions: 0, media: 0, xfa: 0, external: 0, attachments: 0, links: 0 };
    var oa = get(ctx, catalog, 'OpenAction');
    if (isDict(oa) && nameOf(get(ctx, oa, 'S')) !== 'GoTo') { del(catalog, 'OpenAction'); n.actions++; }
    if (del(catalog, 'AA')) n.actions++;
    var names = get(ctx, catalog, 'Names');
    if (isDict(names) && del(names, 'JavaScript')) n.scripts++;
    if (!opts.keepAttachments) {
      if (isDict(names) && del(names, 'EmbeddedFiles')) n.attachments++;
      if (del(catalog, 'AF')) n.attachments++;
    }
    var af = get(ctx, catalog, 'AcroForm');
    if (isDict(af)) { if (del(af, 'XFA')) n.xfa++; del(af, 'NeedsRendering'); }
    pageList(ctx).forEach(function (pg) {
      var annots = deref(ctx, pg.dict.get(N('Annots')));
      if (!isArr(annots)) return;
      for (var i = annots.size() - 1; i >= 0; i--) {
        var a = deref(ctx, annots.get(i));
        var st = nameOf(get(ctx, a, 'Subtype'));
        if (ACTIVE_ANNOTS[st] || (st === 'FileAttachment' && !opts.keepAttachments)) { annots.remove(i); n.media++; }
      }
    });
    everyDict(ctx, function (d, ref, holder) {
      if (d.has(N('AA'))) { d.delete(N('AA')); n.actions++; }
      if (d.has(N('A'))) {
        var risk = chainRisk(ctx, d.get(N('A')), opts.keepLinks !== false);
        if (risk === 'danger' || risk === 'caution') { d.delete(N('A')); n.actions++; }
      }
      if (d.has(N('Next'))) {
        var rk = chainRisk(ctx, d.get(N('Next')), opts.keepLinks !== false);
        if (rk === 'danger' || rk === 'caution') { d.delete(N('Next')); n.actions++; }
      }
      var s = nameOf(get(ctx, d, 'S'));
      if (d.has(N('JS')) || s === 'JavaScript') { ['JS', 'Next'].forEach(function (k) { d.delete(N(k)); }); n.scripts++; }
      if (s === 'Launch' || s === 'ImportData' || s === 'SubmitForm' || s === 'GoToR' || s === 'GoToE') { ['F', 'Win', 'Mac', 'Unix', 'Next'].forEach(function (k) { d.delete(N(k)); }); }
      if (isStream(holder) && holder.dict === d && d.has(N('F')) && nameOf(get(ctx, d, 'Type')) !== 'EmbeddedFile') {
        ['F', 'FFilter', 'FDecodeParms'].forEach(function (k) { d.delete(N(k)); }); n.external++;
      }
      if (opts.keepLinks === false && nameOf(get(ctx, d, 'S')) === 'URI') { d.delete(N('URI')); n.links++; }
    });
    return n;
  }

  /* ---------- scrub (D3 "Remove all of this") ---------- */

  var SCRUB_DEFAULTS = { metadata: true, documentId: true, attachments: true, forms: 'flatten', comments: 'flatten', links: true, hiddenText: true, thumbnails: true, imageMeta: true, revisions: true, activeContent: false };

  async function scrubBytes(bytes, options) {
    var o = Object.assign({}, SCRUB_DEFAULTS, options || {});
    var L = await loadDoc(bytes);
    if (L.encrypted) { var e = new Error('This PDF is locked with a password. Remove the lock first, then clean it.'); e.code = 'encrypted'; throw e; }
    var ctx = L.ctx, catalog = L.catalog;
    var removed = {}, warnings = [];
    function count(k, v) { removed[k] = (removed[k] || 0) + (v == null ? 1 : v); }
    var pages = pageList(ctx);

    if (o.activeContent) {
      var act = removeActive(ctx, catalog, { keepLinks: !o.links, keepAttachments: !o.attachments });
      count('activeContent', act.scripts + act.actions + act.media + act.xfa + act.external);
      if (act.attachments) count('attachments', act.attachments);
    }

    /* Hidden text and switched-off layers come first, while page resources are still as the file had them. */
    if (o.hiddenText) {
      var ocOff = offLayers(ctx, catalog);
      var fontCache = new Map();
      var formDone = new Set();
      for (var pi = 0; pi < pages.length; pi++) {
        var env = await readPage(ctx, pages[pi], ocOff, { fonts: fontCache });
        var edits = {};
        var skipped = 0;
        var add = function (ed) { if (!ed) return false; (edits[ed.stream] = edits[ed.stream] || []).push(ed); return true; };
        hiddenTextRuns(env).forEach(function (h) {
          if (/^x/.test(h.item.stream) && formDone.has(env.formStreams[h.item.stream])) return;
          if (add(editFor(env, h.item))) count(h.why === 'layer' ? 'layers' : 'hiddenText'); else skipped++;
        });
        env.items.forEach(function (it) {
          if (it.kind !== 'text' && it.hiddenLayer) { if (/^x/.test(it.stream) && formDone.has(env.formStreams[it.stream])) return; if (add(editFor(env, it))) count('layers'); }
        });
        /* A shared form drawing is rewritten once, from the first page that uses it. */
        Object.keys(edits).forEach(function (sid) {
          if (sid !== 'page') {
            if (formDone.has(env.formStreams[sid])) { delete edits[sid]; return; }
            formDone.add(env.formStreams[sid]);
          }
          var seenStart = {};
          edits[sid] = edits[sid].filter(function (ed) { if (seenStart[ed.start]) return false; seenStart[ed.start] = 1; return true; });
        });
        commitStreams(ctx, pages[pi], env, edits);
        if (skipped) warnings.push('Some hidden text on page ' + (pi + 1) + ' uses a font that cannot be edited safely, so it was left in place.');
        if (env.unparsed) warnings.push('Part of page ' + (pi + 1) + ' could not be read, so hidden text there may remain.');
      }
      var ocp = get(ctx, catalog, 'OCProperties');
      if (ocOff.size && isDict(ocp)) {
        var ocgs = arr(ctx, get(ctx, ocp, 'OCGs')).filter(function (r) { return !ocOff.has(r); });
        if (!ocgs.length) catalog.delete(N('OCProperties'));
        else {
          ocp.set(N('OCGs'), ctx.obj(ocgs));
          var dd = get(ctx, ocp, 'D');
          if (isDict(dd)) { dd.delete(N('OFF')); ['ON', 'Order', 'RBGroups', 'Locked'].forEach(function (k) { var a = get(ctx, dd, k); if (isArr(a)) dd.set(N(k), ctx.obj(arr(ctx, a).filter(function (r) { return !ocOff.has(r); }))); }); }
        }
        pages.forEach(function (pg) {
          var props = get(ctx, deref(ctx, pg.inherit.Resources), 'Properties');
          if (isDict(props)) props.keys().forEach(function (k) { if (ocOff.has(props.get(k))) props.delete(k); });
        });
        everyDict(ctx, function (d) { if (ocOff.has(d.get(N('OC')))) d.delete(N('OC')); });
        count('layers', 0);
      }
    }

    /* Annotations: comments, links, attachments on the page, form widgets. */
    var dropWidgets = o.forms === 'flatten' || o.forms === 'remove';
    var formFlattenMissing = 0;
    pages.forEach(function (pg, pi2) {
      var annotsRef = pg.dict.get(N('Annots'));
      var annots = deref(ctx, annotsRef);
      if (!isArr(annots)) return;
      var keep = [], draw = [];
      arr(ctx, annots).forEach(function (r) {
        var a = deref(ctx, r);
        if (!isDict(a)) return;
        var st = nameOf(get(ctx, a, 'Subtype')) || '';
        if (st === 'Link') {
          var risk = chainRisk(ctx, a.get(N('A')), false);
          var dest = get(ctx, a, 'A') ? nameOf(get(ctx, get(ctx, a, 'A'), 'S')) : 'GoTo';
          if (o.links && dest !== 'GoTo' && (risk || dest === 'URI')) { count('links'); return; }
          keep.push(r); return;
        }
        if (st === 'Widget') {
          if (!dropWidgets) { keep.push(r); return; }
          if (o.forms === 'flatten' && !flattenInto(ctx, pg, a, draw)) formFlattenMissing++;
          count('forms'); return;
        }
        if (st === 'FileAttachment' && o.attachments) { count('attachments'); return; }
        if (o.comments && o.comments !== 'keep') {
          if (st === 'Popup' || COMMENT_DROP[st] || o.comments === 'remove') { if (st !== 'Popup') count('comments'); return; }
          flattenInto(ctx, pg, a, draw);
          count('comments');
          return;
        }
        if (st === 'Popup') {
          var parent = get(ctx, a, 'Parent');
          if (!isDict(parent)) return;
        }
        keep.push(r);
      });
      if (draw.length) appendDrawing(ctx, pg, draw.join('\n'));
      if (keep.length) pg.dict.set(N('Annots'), ctx.obj(keep)); else pg.dict.delete(N('Annots'));
    });
    if (dropWidgets && catalog.has(N('AcroForm'))) { catalog.delete(N('AcroForm')); count('forms', 0); }
    if (formFlattenMissing) warnings.push(plural(formFlattenMissing, 'form field') + ' had no saved look, so ' + (formFlattenMissing === 1 ? 'it was' : 'they were') + ' removed rather than drawn.');

    if (o.metadata) {
      if (ctx.trailerInfo.Info) { ctx.trailerInfo.Info = undefined; count('metadata'); }
      if (del(catalog, 'Metadata')) count('metadata');
      everyDict(ctx, function (d) {
        if (d.has(N('Metadata'))) { d.delete(N('Metadata')); count('metadata'); }
        if (d.has(N('PieceInfo'))) { d.delete(N('PieceInfo')); count('metadata'); }
        if (d.has(N('LastModified'))) d.delete(N('LastModified'));
      });
    }
    if (o.documentId && ctx.trailerInfo.ID) { ctx.trailerInfo.ID = undefined; count('documentId'); }
    if (o.attachments) {
      var names = get(ctx, catalog, 'Names');
      var ef = get(ctx, names, 'EmbeddedFiles');
      if (ef) { count('attachments', nameTree(ctx, ef).length); names.delete(N('EmbeddedFiles')); }
      if (del(catalog, 'AF')) count('attachments', 0);
      pages.forEach(function (pg) { del(pg.dict, 'AF'); });
      everyDict(ctx, function (d) { if (d.has(N('EF')) && nameOf(get(ctx, d, 'Type')) !== 'Annot') d.delete(N('EF')); });
    }
    if (o.thumbnails) pages.forEach(function (pg) { if (del(pg.dict, 'Thumb')) count('thumbnails'); });
    if (o.imageMeta) {
      ctx.enumerateIndirectObjects().forEach(function (kv) {
        var s = kv[1];
        if (!(s instanceof P().PDFRawStream) || nameOf(get(ctx, s, 'Subtype')) !== 'Image') return;
        if (del(s.dict, 'Metadata')) count('imageMeta');
        if (nameOf(get(ctx, s, 'Filter')) !== 'DCTDecode') return;
        var stripped = null;
        try { stripped = stripJpeg(s.getContents()); } catch (e) { stripped = null; }
        if (stripped) { ctx.assign(kv[0], P().PDFRawStream.of(s.dict, stripped)); count('imageMeta'); }
      });
    }
    var saved = await saveClean(L.doc);
    if (o.revisions) count('revisions', scanRaw(bytes).revisions > 1 ? scanRaw(bytes).revisions - 1 : 0);
    var out = saved.bytes;
    out.report = { removed: removed, leftoversRemoved: saved.removedObjects, warnings: warnings, options: o };
    return out;
  }

  /* ---------- safety check (D4) ---------- */

  var EXEC_EXT = /\.(exe|com|bat|cmd|scr|pif|msi|msp|dll|cpl|jar|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|hta|lnk|reg|sh|command|app|dmg|pkg|apk|deb|rpm|iso|img|docm|xlsm|pptm|dotm|xltm|xlam|ppam|sldm|one|chm|url|scf|inf)$/i;
  var TRIGGERS = { O: 'when a page opens', C: 'when a page closes', WC: 'when the document closes', WS: 'before it is saved', DS: 'after it is saved', WP: 'before it prints', DP: 'after it prints', K: 'while typing in a field', F: 'when a field is formatted', V: 'when a field is checked', C2: 'when values are calculated', E: 'when the pointer enters', X: 'when the pointer leaves', D: 'when pressed', U: 'when released', Fo: 'when a field gets focus', Bl: 'when a field loses focus', PO: 'when its page opens', PC: 'when its page closes', PV: 'when its page becomes visible', PI: 'when its page is hidden' };

  async function safetyBytes(bytes) {
    var findings = [];
    var raw = scanRaw(bytes);
    function add(level, kind, title, detail, extra) { findings.push(Object.assign({ level: level, kind: kind, title: title, detail: detail || '' }, extra || {})); }
    var L;
    try { L = await loadDoc(bytes); }
    catch (e) {
      add('caution', 'malformed', 'The file’s structure could not be read', 'It may be damaged, or built to confuse PDF readers. Nothing in it was run. ' + friendlyError(e));
      return finishSafety(findings, raw, null);
    }
    var ctx = L.ctx, catalog = L.catalog;
    var reported = new Set();
    var uris = {};
    function describeActions(a, where, triggerText) {
      actionChain(ctx, a).forEach(function (d) {
        reported.add(d);
        var s = nameOf(get(ctx, d, 'S'));
        var code = '';
        if (d.has(N('JS'))) code = clip(textOf(ctx, get(ctx, d, 'JS')), 160);
        if (s === 'JavaScript' || d.has(N('JS'))) add('danger', 'javascript', 'Script ' + (triggerText || 'in the file'), 'A small program inside the PDF' + (where ? ' (' + where + ')' : '') + '. Some readers run it automatically.', { code: code, where: where });
        else if (s === 'Launch') add('danger', 'launch', 'Opens a program or file on your computer', 'It asks the reader to start “' + clip(textOf(ctx, get(ctx, d, 'F')) || textOf(ctx, get(ctx, get(ctx, d, 'F'), 'F')) || textOf(ctx, get(ctx, get(ctx, d, 'Win'), 'F')) || 'another program', 80) + '”' + (where ? ' (' + where + ')' : '') + '.', { where: where });
        else if (s === 'GoToR' || s === 'GoToE') add('caution', 'goto', 'Opens another PDF file', 'It points to “' + clip(textOf(ctx, get(ctx, d, 'F')) || textOf(ctx, get(ctx, get(ctx, d, 'F'), 'F')) || 'another file', 80) + '”' + (where ? ' (' + where + ')' : '') + '.', { where: where });
        else if (s === 'SubmitForm') add('caution', 'submit', 'Sends form answers to an address', 'Pressing it sends what was typed to “' + clip(textOf(ctx, get(ctx, d, 'F')) || textOf(ctx, get(ctx, get(ctx, d, 'F'), 'F')) || 'an address', 100) + '”.', { where: where });
        else if (s === 'ImportData') add('caution', 'import', 'Loads data from another file', 'It asks the reader to pull in “' + clip(textOf(ctx, get(ctx, d, 'F')) || 'a data file', 80) + '”.', { where: where });
        else if (s === 'Rendition' || s === 'Movie' || s === 'Sound' || s === 'RichMediaExecute') add('caution', 'media', 'Plays media or runs an embedded player', where || '', { where: where });
        else if (s === 'URI') { var u = textOf(ctx, get(ctx, d, 'URI')); if (u) { uris[u] = uris[u] || []; uris[u].push(where); } if (triggerText && /open/.test(triggerText)) add('caution', 'autoUri', 'Visits a web address by itself', 'It asks the reader to go to “' + clip(u, 100) + '” ' + triggerText + '.'); }
      });
    }
    function describeAA(holder, where) {
      var aa = get(ctx, holder, 'AA');
      if (!isDict(aa)) return;
      aa.keys().forEach(function (k) {
        var t = k.decodeText();
        var before = findings.length;
        describeActions(aa.get(k), where, TRIGGERS[t] || 'automatically');
        if (findings.length === before) add('caution', 'auto', 'Does something ' + (TRIGGERS[t] || 'automatically'), 'An automatic action ' + (where ? 'on ' + where : 'in the document') + '.', { where: where });
      });
    }

    var oa = get(ctx, catalog, 'OpenAction');
    if (isDict(oa) && nameOf(get(ctx, oa, 'S')) !== 'GoTo') {
      var before0 = findings.length;
      describeActions(catalog.get(N('OpenAction')), 'the document', 'when the file opens');
      if (findings.length === before0) add('caution', 'openAction', 'Does something as soon as it opens', 'An “open action” runs when the file is opened.');
    }
    describeAA(catalog, 'the document');
    var names = get(ctx, catalog, 'Names');
    var jsTree = get(ctx, names, 'JavaScript');
    if (jsTree) nameTree(ctx, jsTree).forEach(function (e) { describeActions(e.value, 'document script “' + clip(e.key, 40) + '”', 'when the file opens'); });

    var pages = pageList(ctx);
    pages.forEach(function (pg, pi) {
      describeAA(pg.dict, 'page ' + (pi + 1));
      arr(ctx, get(ctx, pg.dict, 'Annots')).forEach(function (r) {
        var a = deref(ctx, r);
        if (!isDict(a)) return;
        var st = nameOf(get(ctx, a, 'Subtype'));
        var where = (st === 'Widget' ? 'a form field' : st === 'Link' ? 'a link' : 'a ' + (st || 'mark')) + ' on page ' + (pi + 1);
        if (a.has(N('A'))) describeActions(a.get(N('A')), where, st === 'Link' || st === 'Widget' ? 'when clicked' : '');
        describeAA(a, where);
        if (ACTIVE_ANNOTS[st]) add('caution', 'media', st === '3D' ? '3D model' : st === 'RichMedia' ? 'Embedded media player (Flash or video)' : 'Embedded media', 'Interactive media ' + 'on page ' + (pi + 1) + '. Old readers have had security problems with these.', { where: where });
      });
    });
    walkFields(ctx, catalog, function (f) { describeAA(f.dict, 'form field “' + clip(f.name, 40) + '”'); if (f.dict.has(N('A'))) describeActions(f.dict.get(N('A')), 'form field “' + clip(f.name, 40) + '”', 'when used'); });
    /* Bookmarks can carry actions too. */
    var outlines = get(ctx, catalog, 'Outlines');
    if (outlines) {
      var seenO = new Set(), stackO = [getRaw(dictOf(outlines), 'First')], guard = 0;
      while (stackO.length && guard++ < 20000) {
        var r2 = stackO.pop(); var od = deref(ctx, r2);
        if (!isDict(od) || seenO.has(od)) continue; seenO.add(od);
        if (od.has(N('A'))) describeActions(od.get(N('A')), 'a bookmark', 'when clicked');
        if (od.has(N('Next'))) stackO.push(od.get(N('Next')));
        if (od.has(N('First'))) stackO.push(od.get(N('First')));
      }
    }
    var af = get(ctx, catalog, 'AcroForm');
    if (has(af, 'XFA')) add('caution', 'xfa', 'Dynamic form (XFA)', 'An older kind of form that can carry its own scripts and look different in different readers.');

    /* Attached files */
    var ef = get(ctx, names, 'EmbeddedFiles');
    var files = ef ? nameTree(ctx, ef).map(function (e) { var fs = deref(ctx, e.value); return textOf(ctx, get(ctx, fs, 'UF')) || textOf(ctx, get(ctx, fs, 'F')) || e.key; }) : [];
    pages.forEach(function (pg) { arr(ctx, get(ctx, pg.dict, 'Annots')).forEach(function (r) { var a = deref(ctx, r); if (nameOf(get(ctx, a, 'Subtype')) === 'FileAttachment') { var fs = get(ctx, a, 'FS'); files.push(textOf(ctx, get(ctx, fs, 'UF')) || textOf(ctx, get(ctx, fs, 'F')) || 'unnamed'); } }); });
    files.forEach(function (f) {
      if (EXEC_EXT.test(f.trim())) add('danger', 'attachment', 'Attached program: ' + clip(f, 60), 'A file that can run on a computer if someone opens it. Do not open it unless you expected it.', { file: f });
      else add('caution', 'attachment', 'Attached file: ' + clip(f, 60), 'Another file packed inside this PDF. Open it only if you trust the sender.', { file: f });
    });

    /* Anything the structured pass missed, including scripts in unused leftovers. */
    var reach = reachable(ctx, [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean));
    var hiddenScripts = 0, leftoverScripts = 0, external = 0;
    everyDict(ctx, function (d, ref, holder) {
      var s = nameOf(get(ctx, d, 'S'));
      var risky = d.has(N('JS')) || s === 'JavaScript' || s === 'Launch' || s === 'ImportData' || s === 'SubmitForm' || s === 'GoToR' || s === 'GoToE';
      if (risky && !reported.has(d)) { if (reach.has(ref)) hiddenScripts++; else leftoverScripts++; }
      if (isStream(holder) && holder.dict === d && d.has(N('F')) && nameOf(get(ctx, d, 'Type')) !== 'EmbeddedFile') external++;
    });
    if (hiddenScripts) add('danger', 'javascript', plural(hiddenScripts, 'more script or action', 'more scripts or actions') + ' in unusual places', 'They are linked from parts of the file where readers do not normally look.');
    if (leftoverScripts) add('caution', 'leftover', plural(leftoverScripts, 'script or action', 'scripts or actions') + ' in unused parts of the file', 'Nothing points to them now, but they are still inside. A safe copy drops them.');
    if (external) add('caution', 'external', 'Loads content from outside the file', plural(external, 'part') + ' of the file ' + (external === 1 ? 'is' : 'are') + ' meant to be fetched from elsewhere when shown.');

    Object.keys(uris).forEach(function (u) { add('info', 'uri', 'Link to ' + clip(hostOf(u) || u, 60), 'It only opens if someone clicks it. Address: ' + clip(u, 120), { url: u }); });
    if (L.encrypted) add('info', 'encrypted', 'Locked with encryption', 'Parts of the file are scrambled, so this check could not read everything inside.');
    return finishSafety(findings, raw, L);
  }
  function hostOf(u) { var m = /^[a-z][\w+.-]*:\/\/([^\/?#:]+)/i.exec(u || ''); return m ? m[1] : ''; }

  function finishSafety(findings, raw, L) {
    if (raw.disguisedNames.length) findings.push({ level: 'caution', kind: 'disguised', title: 'Disguised names inside the file', detail: 'Words like “' + raw.disguisedNames.slice(0, 3).map(function (s) { return s.slice(1); }).join('”, “') + '” are written in a coded form, a trick used to slip past scanners.' });
    if (raw.revisions > 1) findings.push({ level: 'info', kind: 'revisions', title: 'Saved ' + raw.revisions + ' times with changes on top', detail: 'Earlier versions are still inside. That is normal for edited files, but older content can come back.' });
    if (raw.trailing > 32) findings.push({ level: 'caution', kind: 'trailing', title: 'Extra data after the end of the file', detail: 'There are ' + fmtBytes(raw.trailing) + ' after the point where a PDF should end.' });
    if (raw.headerAt > 0) findings.push({ level: 'caution', kind: 'header', title: 'The file does not start like a PDF', detail: 'It has ' + fmtBytes(raw.headerAt) + ' before the PDF begins, which can mean it is two kinds of file at once.' });
    if (raw.headerAt < 0) findings.push({ level: 'caution', kind: 'header', title: 'No PDF header', detail: 'This file does not say it is a PDF.' });
    if (L && !raw.startxrefOk) findings.push({ level: 'caution', kind: 'xref', title: 'Damaged index', detail: 'The table that says where things are is wrong. Readers repair it quietly, which some attacks rely on.' });
    if (raw.objStms && findings.some(function (f) { return f.kind === 'javascript'; })) findings.push({ level: 'info', kind: 'compressed', title: 'Some parts are packed in compressed form', detail: 'Scripts can be hidden there from simple scanners. This check unpacked them.' });
    var level = findings.some(function (f) { return f.level === 'danger'; }) ? 'danger' : findings.some(function (f) { return f.level === 'caution'; }) ? 'caution' : 'safe';
    var order = { danger: 0, caution: 1, info: 2 };
    findings.sort(function (a, b) { return order[a.level] - order[b.level]; });
    var head = {
      safe: ['Looks safe to open', 'No scripts, automatic actions or hidden programs were found.'],
      caution: ['Open with care', 'It has parts that can reach the internet, open other files or carry extra files. A safe copy removes them.'],
      danger: ['Make a safe copy before opening it elsewhere', 'It contains scripts or actions that some PDF readers run by themselves. LocalEditor has not run anything.']
    }[level];
    return { ok: true, level: level, headline: head[0], sub: head[1], findings: findings, counts: { danger: count('danger'), caution: count('caution'), info: count('info') }, encrypted: !!(L && L.encrypted), pageCount: L ? pageList(L.ctx).length : 0 };
    function count(l) { return findings.filter(function (f) { return f.level === l; }).length; }
  }

  async function makeSafeBytes(bytes, opts) {
    opts = opts || {};
    var L = await loadDoc(bytes);
    if (L.encrypted) { var e = new Error('This PDF is locked with a password. Remove the lock first, then make a safe copy.'); e.code = 'encrypted'; throw e; }
    var n = removeActive(L.ctx, L.catalog, { keepLinks: opts.keepLinks !== false, keepAttachments: !!opts.keepAttachments });
    var saved = await saveClean(L.doc);
    var out = saved.bytes;
    out.report = { removed: n, leftoversRemoved: saved.removedObjects };
    return out;
  }

  /* ---------- text index (pdf.js) ---------- */

  var measureCtx = null;
  function charEdges(str) {
    /* Relative left edges of each character (0..1), estimated with a sans-serif face so wide letters get more room. */
    if (!measureCtx) { try { measureCtx = document.createElement('canvas').getContext('2d'); measureCtx.font = '100px sans-serif'; } catch (e) { measureCtx = null; } }
    var out = [0];
    var total = 0, widths = [];
    for (var i = 0; i < str.length; i++) { var w = measureCtx ? measureCtx.measureText(str[i]).width : 50; if (!(w > 0)) w = 30; widths.push(w); total += w; }
    var acc = 0;
    for (var j = 0; j < widths.length; j++) { acc += widths[j]; out.push(acc / (total || 1)); }
    return out;
  }

  function itemRect(item, vp) {
    var tx = global.pdfjsLib.Util.transform(vp.transform, item.transform);
    var adv = (item.width || 0) * (vp.scale || 1);
    var dir = Math.hypot(tx[0], tx[1]) || 1;
    var upLen = Math.hypot(tx[2], tx[3]) || item.height || 0;
    var ux = upLen ? (tx[2] / (Math.hypot(tx[2], tx[3]) || 1)) * upLen : 0;
    var uy = upLen ? (tx[3] / (Math.hypot(tx[2], tx[3]) || 1)) * upLen : 0;
    var ax = (tx[0] / dir) * adv, ay = (tx[1] / dir) * adv;
    var x0 = tx[4], y0 = tx[5];
    /* descent: extend a little below the baseline */
    var dx = -ux * 0.22, dy = -uy * 0.22;
    return { x0: x0, y0: y0, ax: ax, ay: ay, ux: ux, uy: uy, dx: dx, dy: dy, horizontal: Math.abs(ay) < 0.01 * Math.abs(ax) + 0.01 };
  }
  function sliceRect(g, from, to) {
    var xs = [], ys = [];
    [[from, 0], [to, 0], [from, 1], [to, 1]].forEach(function (p) {
      var bx = g.x0 + g.ax * p[0], by = g.y0 + g.ay * p[0];
      if (p[1]) { bx += g.ux; by += g.uy; } else { bx += g.dx; by += g.dy; }
      xs.push(bx); ys.push(by);
    });
    var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
    return { x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
  }

  async function indexDocument(pdf, opts) {
    opts = opts || {};
    var out = { pageCount: pdf.numPages, pages: [] };
    var limit = Math.min(pdf.numPages, opts.maxPages || 2000);
    for (var p = 1; p <= limit; p++) {
      var page = await pdf.getPage(p);
      var vp = page.getViewport({ scale: 1 });
      var tc = await withTimeout(page.getTextContent(), 10000, 'Reading page ' + p);
      var text = '', map = [], items = [];
      (tc.items || []).forEach(function (it) {
        if (!it || typeof it.str !== 'string') return;
        if (it.str) {
          var g = itemRect(it, vp);
          var idx = items.length;
          items.push({ str: it.str, g: g, edges: null });
          for (var c = 0; c < it.str.length; c++) { map.push({ item: idx, ch: c }); }
          text += it.str;
        }
        if (it.hasEOL) { text += '\n'; map.push(null); }
        else if (it.str && !/\s$/.test(it.str)) { text += ' '; map.push(null); }
      });
      var hasText = /\S/.test(text);
      var picture = false;
      if (!hasText) {
        try {
          var ol = await withTimeout(page.getOperatorList(), 10000, 'Reading page ' + p);
          var O = global.pdfjsLib.OPS;
          picture = ol.fnArray.some(function (f) { return f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageMaskXObject || f === O.paintJpegXObject; });
        } catch (e) { picture = false; }
      }
      out.pages.push({ page: p - 1, width: vp.width, height: vp.height, text: text, map: map, items: items, hasText: hasText, picture: picture });
      page.cleanup();
      if (p % 4 === 0) await tick();
    }
    return out;
  }
  function rangeRects(pg, start, end) {
    var rects = [];
    var cur = null;
    for (var i = start; i < end; i++) {
      var m = pg.map[i];
      if (!m) continue;
      if (cur && cur.item === m.item && m.ch === cur.to) { cur.to = m.ch + 1; continue; }
      if (cur) rects.push(cur);
      cur = { item: m.item, from: m.ch, to: m.ch + 1 };
    }
    if (cur) rects.push(cur);
    return rects.map(function (r) {
      var it = pg.items[r.item];
      if (!it.edges) it.edges = charEdges(it.str);
      var rc = sliceRect(it.g, it.edges[r.from], it.edges[r.to]);
      return { x: rc.x, y: rc.y, w: rc.w, h: rc.h };
    });
  }

  /* ---------- sensitive data (D2) ---------- */

  function luhn(digits) {
    var s = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) { var d = +digits[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; }
    return s % 10 === 0;
  }
  function ibanValid(iban) {
    var s = iban.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    var LEN = { AD: 24, AE: 23, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TR: 26 };
    if (LEN[s.slice(0, 2)] && LEN[s.slice(0, 2)] !== s.length) return false;
    var r = s.slice(4) + s.slice(0, 4), rem = 0;
    for (var i = 0; i < r.length; i++) {
      var c = r.charCodeAt(i);
      var v = c >= 65 ? String(c - 55) : r[i];
      for (var j = 0; j < v.length; j++) rem = (rem * 10 + (+v[j])) % 97;
    }
    return rem === 1;
  }
  var VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  var VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  function verhoeff(num) {
    var c = 0, d = String(num).replace(/\D/g, '').split('').reverse();
    for (var i = 0; i < d.length; i++) c = VD[c][VP[i % 8][+d[i]]];
    return c === 0;
  }
  function abaValid(n) {
    if (!/^\d{9}$/.test(n)) return false;
    var d = n.split('').map(Number);
    return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
  }
  function ssnValid(a, g, s) { return a !== '000' && a !== '666' && a[0] !== '9' && g !== '00' && s !== '0000'; }
  function ipValid(s) { return s.split('.').every(function (p) { return +p <= 255 && !(p.length > 1 && p[0] === '0'); }); }

  var KINDS = {
    email: { label: 'Email address', rank: 6 },
    phone: { label: 'Phone number', rank: 3 },
    url: { label: 'Web address', rank: 5 },
    ip: { label: 'IP address', rank: 5 },
    dob: { label: 'Date of birth', rank: 7 },
    card: { label: 'Payment card number', rank: 10 },
    iban: { label: 'IBAN bank account', rank: 10 },
    ssn: { label: 'US Social Security number', rank: 9 },
    aadhaar: { label: 'Aadhaar number', rank: 9 },
    pan: { label: 'PAN (India)', rank: 9 },
    routing: { label: 'Bank routing number', rank: 8 },
    idPossible: { label: 'Possible ID or passport number', rank: 2, possible: true },
    bankPossible: { label: 'Possible bank account or sort code', rank: 2, possible: true },
    term: { label: 'Your word or name', rank: 11 },
    exact: { label: 'Exact text', rank: 11 }
  };

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function scanText(text, opts) {
    var hits = [];
    var want = opts.kinds ? new Set(opts.kinds) : null;
    function on(k) { return !want || want.has(k); }
    function push(kind, start, end, value) { hits.push({ kind: kind, start: start, end: end, text: value }); }
    var m, re;
    if (on('email')) { re = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g; while ((m = re.exec(text))) push('email', m.index, m.index + m[0].length, m[0]); }
    if (on('url')) { re = /\b(?:https?:\/\/|www\.)[^\s<>"'()]+/gi; while ((m = re.exec(text))) { var u = m[0].replace(/[.,;:!?]+$/, ''); push('url', m.index, m.index + u.length, u); } }
    if (on('ip')) { re = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g; while ((m = re.exec(text))) if (ipValid(m[0])) push('ip', m.index, m.index + m[0].length, m[0]); }
    if (on('card')) {
      re = /(?<![\d-])(?:\d[ \-]?){12,18}\d(?![\d-])/g;
      while ((m = re.exec(text))) { var dg = m[0].replace(/\D/g, ''); if (dg.length >= 13 && dg.length <= 19 && /^(4|5[1-5]|2[2-7]|3[47]|3[0689]|6|35)/.test(dg) && luhn(dg) && !/^(\d)\1+$/.test(dg)) push('card', m.index, m.index + m[0].length, m[0]); }
    }
    if (on('iban')) { re = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{1,4}){3,8}\b/g; while ((m = re.exec(text))) { var iv = m[0].trim(); if (ibanValid(iv)) push('iban', m.index, m.index + iv.length, iv); } }
    if (on('ssn')) { re = /(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g; while ((m = re.exec(text))) if (ssnValid(m[1], m[2], m[3])) push('ssn', m.index, m.index + m[0].length, m[0]); }
    if (on('aadhaar')) { re = /(?<![\d])[2-9]\d{3}[ \-]?\d{4}[ \-]?\d{4}(?![\d])/g; while ((m = re.exec(text))) if (verhoeff(m[0])) push('aadhaar', m.index, m.index + m[0].length, m[0]); }
    if (on('pan')) { re = /\b[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]\b/g; while ((m = re.exec(text))) push('pan', m.index, m.index + m[0].length, m[0]); }
    if (on('routing')) { re = /(?:routing|ABA|RTN)[^\d\n]{0,20}(\d{9})(?!\d)/gi; while ((m = re.exec(text))) if (abaValid(m[1])) { var rs = m.index + m[0].length - 9; push('routing', rs, rs + 9, m[1]); } }
    if (on('dob')) {
      re = /(?:date of birth|birth ?date|born(?: on)?|d\.?o\.?b\.?)[^\w\n]{0,6}((?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})|(?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{4})|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}))/gi;
      while ((m = re.exec(text))) { var ds = m.index + m[0].length - m[1].length; push('dob', ds, ds + m[1].length, m[1]); }
    }
    if (on('phone')) {
      re = /(?<![\w+\/])(\+\d{1,3}[ .\-]?)?(\(\d{1,5}\)[ .\-]?)?\d{2,5}(?:[ .\-]\d{2,8}){1,5}(?![\w\/])/g;
      while ((m = re.exec(text))) {
        var digits = m[0].replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) continue;
        var before = text.slice(Math.max(0, m.index - 24), m.index);
        var ctxWord = /(phone|tel|mobile|mob|cell|fax|call|whatsapp|contact|ph)\b[^\n]{0,12}$/i.test(before);
        if (!(m[1] || m[2] || ctxWord)) continue;
        push('phone', m.index, m.index + m[0].length, m[0]);
      }
    }
    if (on('idPossible')) {
      re = /(?:passport|licen[cs]e|identity|national id|id (?:no|number)|ni number|nhs number|employee (?:id|no)|staff (?:id|no))[^\w\n]{0,6}(?:no\.?|number|#)?[^\w\n]{0,4}([A-Z0-9][A-Z0-9 \-]{4,14}[A-Z0-9])/gi;
      while ((m = re.exec(text))) { if (/\d/.test(m[1])) { var is = m.index + m[0].length - m[1].length; push('idPossible', is, is + m[1].length, m[1]); } }
      re = /\b[A-CEGHJ-PR-TW-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g;
      while ((m = re.exec(text))) push('idPossible', m.index, m.index + m[0].length, m[0]);
    }
    if (on('bankPossible')) {
      re = /(?:sort ?code)[^\d\n]{0,6}(\d{2}[ \-]\d{2}[ \-]\d{2})/gi;
      while ((m = re.exec(text))) { var ss = m.index + m[0].length - m[1].length; push('bankPossible', ss, ss + m[1].length, m[1]); }
      re = /(?:account|acct|a\/c)(?: (?:no|number))?[^\w\n]{0,6}(\d[\d \-]{4,20}\d)/gi;
      while ((m = re.exec(text))) { var as = m.index + m[0].length - m[1].length; push('bankPossible', as, as + m[1].length, m[1]); }
    }
    (opts.terms || []).forEach(function (t) {
      t = String(t || '').trim();
      if (t.length < 2) return;
      var pat = escRe(t).replace(/\s+/g, '\\s+');
      var r2 = new RegExp((/^\w/.test(t) && opts.wholeWords !== false ? '(?<![\\w])' : '') + pat + (/\w$/.test(t) && opts.wholeWords !== false ? '(?![\\w])' : ''), opts.caseSensitive ? 'g' : 'gi');
      var mm;
      while ((mm = r2.exec(text))) { push(opts.exact ? 'exact' : 'term', mm.index, mm.index + mm[0].length, mm[0]); if (!mm[0].length) r2.lastIndex++; }
    });
    /* Overlaps: the more specific kind wins. */
    hits.sort(function (a, b) { return (KINDS[b.kind].rank - KINDS[a.kind].rank) || (a.start - b.start); });
    var kept = [];
    hits.forEach(function (h) {
      if (kept.some(function (k) { return h.start < k.end && h.end > k.start && !(h.kind === 'term' || h.kind === 'exact'); })) return;
      kept.push(h);
    });
    kept.sort(function (a, b) { return a.start - b.start; });
    return kept;
  }

  function findInIndex(index, opts) {
    var matches = [], pages = [], n = 0;
    index.pages.forEach(function (pg) {
      pages.push({ page: pg.page, status: pg.hasText ? 'text' : pg.picture ? 'picture' : 'empty', note: pg.hasText ? '' : pg.picture ? 'This page is a picture; text cannot be searched yet.' : 'This page has no text.' });
      if (!pg.hasText) return;
      scanText(pg.text, opts).forEach(function (h) {
        var rects = rangeRects(pg, h.start, h.end).map(function (r) {
          var pad = Math.max(1, r.h * 0.12);
          return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
        });
        if (!rects.length) return;
        matches.push({ id: 'm' + (++n), page: pg.page, rects: rects, kind: h.kind, label: KINDS[h.kind].label, possible: !!KINDS[h.kind].possible, text: h.text.replace(/\s+/g, ' ').trim() });
      });
    });
    return { ok: true, matches: matches, pages: pages, pictures: pages.filter(function (p) { return p.status === 'picture'; }).map(function (p) { return p.page; }) };
  }

  /* ---------- redaction (D1) ---------- */

  function marksByPage(marks) {
    var map = {};
    (marks || []).forEach(function (m) {
      if (!m) return;
      var p = m.page != null ? m.page : m.pageIndex;
      if (p == null || !isFinite(p)) return;
      p = p | 0;
      (m.rects && m.rects.length ? m.rects : [m]).forEach(function (r) {
        var x = +r.x, y = +r.y, w = +(r.w != null ? r.w : r.width), h = +(r.h != null ? r.h : r.height);
        if (![x, y, w, h].every(isFinite) || w <= 0 || h <= 0) return;
        (map[p] = map[p] || []).push({ x: x, y: y, w: w, h: h, label: m.label });
      });
    });
    return map;
  }
  function inRect(rects, x, y) { for (var i = 0; i < rects.length; i++) { var r = rects[i]; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i; } return -1; }

  /* What text sits under the boxes, read before anything changes. */
  function captureFromIndex(index, byPage) {
    var plan = { pageCount: index.pageCount, pages: {}, strings: [] };
    var all = new Set();
    Object.keys(byPage).forEach(function (k) {
      var p = +k;
      var rects = byPage[k];
      var pg = index.pages[p];
      var found = [];
      if (pg) {
        pg.items.forEach(function (it) {
          if (!it.edges) it.edges = charEdges(it.str);
          var run = '';
          for (var c = 0; c <= it.str.length; c++) {
            var inside = false;
            if (c < it.str.length) {
              var rc = sliceRect(it.g, it.edges[c], it.edges[c + 1]);
              inside = inRect(rects, rc.x + rc.w / 2, rc.y + rc.h / 2) >= 0;
            }
            if (inside) run += it.str[c];
            else if (run) { if (run.replace(/\s+/g, '').length >= 2) found.push(run.trim()); run = ''; }
          }
        });
      }
      found.forEach(function (s) { all.add(s); });
      plan.pages[p] = { rects: rects, strings: found };
    });
    plan.strings = Array.from(all);
    return plan;
  }

  function vpMatrix(pdfPage) { return pdfPage.getViewport({ scale: 1 }); }

  async function renderPage(pdfPage, scale, canvasOpts) {
    var vp = pdfPage.getViewport({ scale: scale });
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(vp.width));
    c.height = Math.max(1, Math.round(vp.height));
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    var AM = global.pdfjsLib.AnnotationMode || {};
    var task = pdfPage.render({ canvasContext: g, viewport: vp, annotationMode: (canvasOpts && canvasOpts.annotations === false) ? AM.DISABLE : AM.ENABLE });
    await withTimeout(task.promise, 30000, 'Drawing a page').catch(function (e) { try { task.cancel(); } catch (x) {} throw e; });
    return { canvas: c, vp: vp };
  }
  function canvasJpeg(c, q) { return new Promise(function (res, rej) { c.toBlob(function (b) { if (!b) { rej(new Error('Could not encode the page')); return; } b.arrayBuffer().then(function (a) { res(new Uint8Array(a)); }, rej); }, 'image/jpeg', q); }); }

  function drawBoxes(c, rects, scale, label) {
    var g = c.getContext('2d');
    g.fillStyle = '#000000';
    rects.forEach(function (r) {
      var x = Math.floor(r.x * scale), y = Math.floor(r.y * scale);
      var w = Math.ceil((r.x + r.w) * scale) - x, h = Math.ceil((r.y + r.h) * scale) - y;
      g.fillRect(x, y, w, h);
      var text = r.label || label;
      if (text && w > 20 && h > 8) {
        var size = Math.min(h * 0.6, 12 * scale);
        g.font = '600 ' + Math.max(6, size) + 'px sans-serif';
        g.fillStyle = '#ffffff';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        var t = text;
        while (t.length > 1 && g.measureText(t).width > w - 4) t = t.slice(0, -1);
        if (t.length > 1) g.fillText(t, x + w / 2, y + h / 2);
        g.fillStyle = '#000000';
      }
    });
  }

  function mapRectToNew(vp1, rect, H) {
    var pts = [vp1.convertToViewportPoint(rect[0], rect[1]), vp1.convertToViewportPoint(rect[2], rect[3]), vp1.convertToViewportPoint(rect[0], rect[3]), vp1.convertToViewportPoint(rect[2], rect[1])];
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return H - p[1]; });
    return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }
  function viewportRectOf(vp1, rect) {
    var r = mapRectToNew(vp1, rect, 0);
    return { x: r[0], y: -r[3], w: r[2] - r[0], h: r[3] - r[1] };
  }
  function rectHits(rects, r) { return rects.some(function (b) { return r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y; }); }

  function pruneFields(ctx, catalog, removedWidgets) {
    if (!removedWidgets.size) return;
    var af = get(ctx, catalog, 'AcroForm');
    if (!isDict(af)) return;
    function clean(listOwner, key) {
      var a = get(ctx, listOwner, key);
      if (!isArr(a)) return 0;
      var keep = [];
      arr(ctx, a).forEach(function (r) {
        if (removedWidgets.has(r)) return;
        var d = deref(ctx, r);
        if (isDict(d) && d.has(N('Kids'))) {
          var left = clean(d, 'Kids');
          if (!left) return;
        }
        keep.push(r);
      });
      dictOf(listOwner).set(N(key), ctx.obj(keep));
      return keep.length;
    }
    try { clean(af, 'Fields'); } catch (e) {}
  }


  /* "Keep text selectable" redaction for one page. Supported only when everything a box touches is plain text
     drawn directly by the page in a font whose widths we know: those glyphs are removed and replaced by equal
     spacing, and a black box is drawn on top. Anything else under a box (pictures, drawings, form drawings,
     Type 3 fonts, marked content with replacement text, unreadable streams) returns { ok: false } and the page
     is rebuilt as a picture instead. */
  /* A painted path that is one rectangle or one straight line reveals nothing but itself (backgrounds, table lines). */
  function plainShape(ops, item) {
    if (item.from < 0 || item.from > item.op) return false;
    var list = ops.slice(item.from, item.op).map(function (o) { return o.op; }).filter(function (n) { return n !== 'h'; });
    return (list.length === 1 && list[0] === 're') || (list.length === 2 && list[0] === 'm' && list[1] === 'l');
  }
  async function redactPageVector(ctx, doc, pg, vp1, rects, ocOff, fonts, label) {
    var env = await readPage(ctx, pg, ocOff, { fonts: fonts });
    if (env.unparsed) return { ok: false, reason: 'part of the page could not be read' };
    var boxes = rects.map(function (r) {
      var a = vp1.convertToPdfPoint(r.x, r.y), b = vp1.convertToPdfPoint(r.x + r.w, r.y + r.h);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    });
    function hit(bb) { for (var i = 0; i < boxes.length; i++) if (overlaps(bb, boxes[i], 0.5)) return true; return false; }
    var res = deref(ctx, pg.inherit.Resources);
    var props = get(ctx, res, 'Properties');
    var page = env.streams.page;
    if (!page) return { ok: false, reason: 'the page has no drawing' };
    for (var oi = 0; oi < page.ops.length; oi++) {
      var o = page.ops[oi];
      if (o.op !== 'BDC') continue;
      var pd = o.args[1];
      var keys = pd && pd.t === 'd' ? Object.keys(pd.v) : pd && pd.t === 'name' && isDict(get(ctx, props, pd.v)) ? get(ctx, props, pd.v).keys().map(function (k) { return k.decodeText(); }) : [];
      if (keys.some(function (k) { return k === 'ActualText' || k === 'Alt' || k === 'E'; })) return { ok: false, reason: 'the page carries replacement text for screen readers' };
    }
    var edits = [];
    var depth = 0;
    for (var i = 0; i < env.items.length; i++) {
      var it = env.items[i];
      if (!hit(it.bbox)) continue;
      if (it.kind === 'path' && it.stream === 'page' && plainShape(page.ops, it)) continue;
      if (it.kind !== 'text') return { ok: false, reason: 'a picture or drawing is under a box' };
      if (it.stream !== 'page') return { ok: false, reason: 'text under a box is inside a shared drawing' };
      if (!it.font || !it.font.supported || it.font.type3) return { ok: false, reason: 'text under a box uses a font that cannot be edited safely' };
      if (!it.glyphs.some(function (g) { return hit(g.bbox); })) continue;
      var ed = editFor(env, it, function (g) { return !hit(g.bbox); });
      if (!ed) return { ok: false, reason: 'text under a box could not be removed exactly' };
      edits.push(ed);
    }
    page.ops.forEach(function (op) { if (op.op === 'q') depth++; else if (op.op === 'Q' && depth > 0) depth--; });
    var nb = applyEdits(page.bytes, edits);
    var draw = 'Q\n'.repeat(depth) + 'Q\nq 0 g\n' + boxes.map(function (b) { return [b[0], b[1], b[2] - b[0], b[3] - b[1]].map(fmt).join(' ') + ' re'; }).join('\n') + '\nf\nQ\n';
    var resDict = ownResources(ctx, pg);
    if (label) {
      var font = await doc.embedFont(P().StandardFonts.HelveticaBold);
      var fd = deref(ctx, resDict.get(N('Font')));
      if (!isDict(fd)) { fd = ctx.obj({}); resDict.set(N('Font'), fd); }
      fd.set(N('LeRedactF'), font.ref);
      var rot = pageRotate(ctx, pg);
      rects.forEach(function (r, bi) {
        var b = boxes[bi];
        var bw = (rot % 180) ? b[3] - b[1] : b[2] - b[0], bh = (rot % 180) ? b[2] - b[0] : b[3] - b[1];
        var size = Math.min(bh * 0.6, 12);
        var text = r.label || label;
        while (text.length > 1 && font.widthOfTextAtSize(text, size) > bw - 4) text = text.slice(0, -1);
        if (size < 4 || text.length < 2) return;
        var tw = font.widthOfTextAtSize(text, size);
        var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        var ang = -rot * Math.PI / 180, c = Math.cos(ang), sn = Math.sin(ang);
        var ox = -tw / 2, oy = -size * 0.35;
        var tx = cx + ox * c - oy * sn, ty = cy + ox * sn + oy * c;
        var enc = font.encodeText(text).toString();
        draw += 'q 1 g BT /LeRedactF ' + fmt(size) + ' Tf ' + [c, sn, -sn, c, tx, ty].map(fmt).join(' ') + ' Tm ' + enc + ' Tj ET Q\n';
      });
    }
    var pre = ctx.register(ctx.stream('q\n'));
    pg.dict.set(N('Contents'), ctx.obj([pre, ctx.register(ctx.flateStream(nb)), ctx.register(ctx.flateStream(draw))]));
    return { ok: true, boxes: boxes, removedRuns: edits.length };
  }

  async function redactBytes(bytes, marks, opts) {
    opts = opts || {};
    var dpi = Math.max(72, Math.min(400, +opts.dpi || 200));
    var quality = opts.quality == null ? 0.88 : opts.quality;
    var byPage = marksByPage(marks);
    var pagesWith = Object.keys(byPage).map(Number).sort(function (a, b) { return a - b; });
    if (!pagesWith.length) throw new Error('There are no redaction boxes to apply.');
    var pdf = await openJs(bytes);
    var out, plan, index;
    try {
      index = await indexDocument(pdf);
      plan = captureFromIndex(index, byPage);
      var L = await loadDoc(bytes);
      if (L.encrypted) { var e = new Error('This PDF is locked with a password. Remove the lock first, then redact it.'); e.code = 'encrypted'; throw e; }
      var ctx = L.ctx, doc = L.doc, catalog = L.catalog;
      var pages = pageList(ctx);
      if (pages.length !== pdf.numPages) throw new Error('The page structure is unusual, so redaction stopped to be safe.');
      var removedWidgets = new Set();
      var annotsRemoved = 0;
      var pageModes = {}, fallbacks = [];
      var ocOff = offLayers(ctx, catalog), fontCache = new Map();
      for (var k = 0; k < pagesWith.length; k++) {
        var p = pagesWith[k];
        if (p < 0 || p >= pages.length) continue;
        if (opts.onProgress) opts.onProgress(k, pagesWith.length, 'Page ' + (p + 1));
        var pg = pages[p];
        var rects = byPage[p];
        var jsPage = await pdf.getPage(p + 1);
        var vp1 = vpMatrix(jsPage);
        var W = vp1.width, H = vp1.height;
        if (opts.mode === 'searchable' && !(opts.forceImage && opts.forceImage.indexOf(p) >= 0)) {
          var vr0 = await redactPageVector(ctx, doc, pg, vp1, rects, ocOff, fontCache, opts.label || '');
          if (vr0.ok) {
            var kept0 = [];
            arr(ctx, get(ctx, pg.dict, 'Annots')).forEach(function (ar) {
              var a0 = deref(ctx, ar);
              if (!isDict(a0)) return;
              var rc0 = nums(ctx, get(ctx, a0, 'Rect'));
              var hitBox = rc0.length !== 4 || vr0.boxes.some(function (b) { return overlaps([Math.min(rc0[0], rc0[2]), Math.min(rc0[1], rc0[3]), Math.max(rc0[0], rc0[2]), Math.max(rc0[1], rc0[3])], b, 0.5); });
              var st0 = nameOf(get(ctx, a0, 'Subtype'));
              if (hitBox || st0 === 'Popup' && !isDict(get(ctx, a0, 'Parent'))) { if (st0 === 'Widget') removedWidgets.add(ar); annotsRemoved++; }
              else kept0.push(ar);
            });
            if (kept0.length) pg.dict.set(N('Annots'), ctx.obj(kept0)); else pg.dict.delete(N('Annots'));
            ['Thumb', 'PieceInfo', 'Metadata'].forEach(function (key) { pg.dict.delete(N(key)); });
            pageModes[p] = 'searchable';
            jsPage.cleanup();
            continue;
          }
          fallbacks.push({ page: p, reason: vr0.reason });
        }
        pageModes[p] = 'image';
        var scale = dpi / 72;
        var edge = 9000, area = 60e6;
        if (W * scale > edge || H * scale > edge) scale = edge / Math.max(W, H);
        if (W * H * scale * scale > area) scale = Math.sqrt(area / (W * H));
        var r = await renderPage(jsPage, scale);
        drawBoxes(r.canvas, rects, r.canvas.width / W, opts.label || '');
        var jpg = await canvasJpeg(r.canvas, quality);
        r.canvas.width = r.canvas.height = 1;
        var img = await doc.embedJpg(jpg);
        await img.embed();
        var res = ctx.obj({});
        var xo = ctx.obj({}); xo.set(N('RedactedPage'), img.ref); res.set(N('XObject'), xo);
        /* Links that are clear of every box keep working, moved to the new page geometry. */
        var keep = [];
        arr(ctx, get(ctx, pg.dict, 'Annots')).forEach(function (ar) {
          var a = deref(ctx, ar);
          if (!isDict(a)) return;
          var st = nameOf(get(ctx, a, 'Subtype'));
          var rc = nums(ctx, get(ctx, a, 'Rect'));
          var vr = rc.length === 4 ? viewportRectOf(vp1, rc) : null;
          var lrisk = st === 'Link' ? chainRisk(ctx, a.get(N('A')), true) : 'x';
          if (st === 'Link' && vr && !rectHits(rects, vr) && (!lrisk || lrisk === 'info')) {
            var nr = mapRectToNew(vp1, rc, H);
            a.set(N('Rect'), ctx.obj(nr));
            a.delete(N('QuadPoints'));
            keep.push(ar);
          } else {
            if (st === 'Widget') removedWidgets.add(ar);
            annotsRemoved++;
          }
        });
        ['Contents', 'Resources', 'Annots', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Thumb', 'PieceInfo', 'Metadata', 'StructParents', 'Group', 'B', 'AA', 'VP', 'SeparationInfo', 'PresSteps', 'Trans', 'UserUnit', 'AF', 'OutputIntents', 'DPart'].forEach(function (key) { pg.dict.delete(N(key)); });
        pg.dict.set(N('MediaBox'), ctx.obj([0, 0, W, H]));
        pg.dict.set(N('CropBox'), ctx.obj([0, 0, W, H]));
        pg.dict.set(N('Rotate'), ctx.obj(0));
        pg.dict.set(N('Resources'), res);
        pg.dict.set(N('Contents'), ctx.register(ctx.flateStream('q ' + fmt(W) + ' 0 0 ' + fmt(H) + ' 0 0 cm /RedactedPage Do Q')));
        if (keep.length) pg.dict.set(N('Annots'), ctx.obj(keep));
        jsPage.cleanup();
        await tick();
      }
      pruneFields(ctx, catalog, removedWidgets);
      if (catalog.has(N('StructTreeRoot'))) { catalog.delete(N('StructTreeRoot')); catalog.delete(N('MarkInfo')); }
      if (opts.removeMetadata !== false) {
        ctx.trailerInfo.Info = undefined;
        catalog.delete(N('Metadata'));
        ctx.trailerInfo.ID = undefined;
      }
      var saved = await saveClean(doc);
      out = saved.bytes;
      out.report = { ok: true, mode: opts.mode === 'searchable' ? 'searchable' : 'image', pageModes: pageModes, fallbacks: fallbacks, dpi: dpi, pages: pagesWith, annotationsRemoved: annotsRemoved, captured: plan.strings.slice(), plan: plan, warnings: [] };
    } finally { try { pdf.destroy(); } catch (e) {} }
    if (opts.onProgress) opts.onProgress(pagesWith.length, pagesWith.length, 'Checking');
    var searchablePages = Object.keys(pageModes).filter(function (k) { return pageModes[k] === 'searchable'; }).map(Number);
    out.report.verify = await verifyBytes(out, plan, { label: opts.label, mode: searchablePages.length ? 'searchable' : 'image', searchablePages: searchablePages });
    out.report.ok = out.report.verify.ok;
    /* Selectable pages that do not pass the check are rebuilt as pictures and checked again. */
    if (!out.report.ok && searchablePages.length) {
      var again = await redactBytes(bytes, marks, Object.assign({}, opts, { forceImage: searchablePages.concat(opts.forceImage || []) }));
      again.report.retried = { pages: searchablePages, problems: out.report.verify.problems };
      return again;
    }
    return out;
  }

  /* Re-reads the saved file and proves, as far as the file can show it, that the hidden content is gone. */
  async function verifyBytes(outBytes, plan, opts) {
    opts = opts || {};
    var problems = [], warnings = [], checks = [];
    function check(ok, label, detail) { checks.push({ ok: !!ok, label: label, detail: detail || '' }); return ok; }
    var pdf;
    try { pdf = await openJs(outBytes); }
    catch (e) { problems.push('The saved file does not open: ' + friendlyError(e)); return { ok: false, problems: problems, warnings: warnings, checks: checks }; }
    try {
      check(pdf.numPages === plan.pageCount, 'The saved file opens with all ' + plan.pageCount + ' pages', pdf.numPages + ' pages');
      if (pdf.numPages !== plan.pageCount) problems.push('The saved file has ' + pdf.numPages + ' pages instead of ' + plan.pageCount + '.');
      var index = await indexDocument(pdf);
      var affected = Object.keys(plan.pages).map(Number);
      var underBox = 0;
      affected.forEach(function (p) {
        var pg = index.pages[p];
        var rects = plan.pages[p].rects;
        if (!pg) return;
        pg.items.forEach(function (it) {
          if (!it.edges) it.edges = charEdges(it.str);
          var hit = '';
          for (var c = 0; c < it.str.length; c++) {
            var rc = sliceRect(it.g, it.edges[c], it.edges[c + 1]);
            if (/\S/.test(it.str[c]) && inRect(rects, rc.x + rc.w / 2, rc.y + rc.h / 2) >= 0) hit += it.str[c];
          }
          var labelText = String(opts.label || '').replace(/\s+/g, '');
          if (hit && labelText && labelText.indexOf(hit) >= 0) hit = '';
          if (hit) { underBox++; problems.push('Text is still under a box on page ' + (p + 1) + ': “' + clip(hit, 60) + '”.'); }
        });
        var flat = pg.text.replace(/\s+/g, ' ');
        plan.pages[p].strings.forEach(function (s) {
          if (s.length >= 2 && flat.indexOf(s.replace(/\s+/g, ' ')) >= 0 && !underBox) {
            if (opts.searchablePages && opts.searchablePages.indexOf(p) >= 0) warnings.push('“' + clip(s, 40) + '” still appears elsewhere on page ' + (p + 1) + '.');
            else problems.push('“' + clip(s, 40) + '” can still be found on page ' + (p + 1) + '.');
          }
        });
      });
      check(!underBox, 'No text is left under the boxes');
      var elsewhere = {};
      index.pages.forEach(function (pg) {
        if (plan.pages[pg.page]) return;
        var flat = pg.text.replace(/\s+/g, ' ');
        plan.strings.forEach(function (s) { if (s.length >= 3 && flat.indexOf(s.replace(/\s+/g, ' ')) >= 0) (elsewhere[s] = elsewhere[s] || []).push(pg.page + 1); });
      });
      Object.keys(elsewhere).forEach(function (s) { warnings.push('“' + clip(s, 40) + '” also appears on page ' + elsewhere[s].join(', ') + ', which has no box.'); });

      /* Raw search inside every object and unpacked stream. */
      var raw = await rawSearch(outBytes, plan.strings.filter(function (s) { return s.replace(/\s+/g, '').length >= 3; }), Object.keys(elsewhere).length ? new Set(Object.keys(elsewhere)) : null);
      raw.found.forEach(function (f) { problems.push('“' + clip(f.text, 40) + '” is still stored ' + f.where + '.'); });
      check(!raw.found.length, 'None of the hidden words are stored anywhere in the file', raw.searched + ' parts searched');
      if (raw.skipped) warnings.push(plural(raw.skipped, 'part') + ' of the file could not be unpacked for the word search.');

      /* Pixels: the boxes really are solid on the saved pages. */
      var dark = true;
      for (var i = 0; i < affected.length; i++) {
        var p2 = affected[i];
        if (p2 >= pdf.numPages) continue;
        var page = await pdf.getPage(p2 + 1);
        var vp1 = page.getViewport({ scale: 1 });
        var sc = Math.min(1.5, 1200 / Math.max(vp1.width, vp1.height));
        var r = await renderPage(page, sc);
        var g = r.canvas.getContext('2d');
        plan.pages[p2].rects.forEach(function (b, bi) {
          var x = Math.ceil(b.x * sc) + 1, y = Math.ceil(b.y * sc) + 1, w = Math.floor(b.w * sc) - 2, h = Math.floor(b.h * sc) - 2;
          x = Math.max(0, x); y = Math.max(0, y); w = Math.min(w, r.canvas.width - x); h = Math.min(h, r.canvas.height - y);
          if (w < 1 || h < 1) return;
          var d = g.getImageData(x, y, w, h).data, blk = 0, tot = d.length / 4;
          for (var q = 0; q < d.length; q += 4) if (d[q] < 40 && d[q + 1] < 40 && d[q + 2] < 40) blk++;
          var need = (b.label || opts.label) ? 0.55 : 0.97;
          if (blk / tot < need) { dark = false; problems.push('Box ' + (bi + 1) + ' on page ' + (p2 + 1) + ' is not solid black in the saved file.'); }
        });
        r.canvas.width = r.canvas.height = 1;
        page.cleanup();
      }
      check(dark, 'Every box is solid black on the saved pages');
      var sr = scanRaw(outBytes);
      check(sr.revisions === 1 && !sr.prevLinks, 'The file was written fresh, with no earlier version inside');
      if (sr.revisions !== 1 || sr.prevLinks) problems.push('The saved file still contains an earlier version.');
    } catch (e) {
      problems.push('The check could not finish: ' + friendlyError(e));
    } finally { try { pdf.destroy(); } catch (e) {} }
    return { ok: !problems.length, problems: problems, warnings: warnings, checks: checks };
  }

  function utf16be(s) { var b = new Uint8Array(s.length * 2); for (var i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) >> 8; b[i * 2 + 1] = s.charCodeAt(i) & 255; } return b; }
  function indexOfBytes(hay, needle) {
    if (!needle.length || needle.length > hay.length) return -1;
    var first = needle[0];
    outer: for (var i = hay.indexOf(first); i >= 0 && i <= hay.length - needle.length; i = hay.indexOf(first, i + 1)) {
      for (var j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }
  /* Finds strings in every object of a file: dictionaries' text values and unpacked streams. allowPageText lists strings
     that are expected in the page drawing of pages without boxes. */
  async function rawSearch(bytes, strings, allowPageText) {
    var res = { found: [], searched: 0, skipped: 0 };
    if (!strings.length) return res;
    var L;
    try { L = await loadDoc(bytes); } catch (e) { res.skipped++; return res; }
    var ctx = L.ctx;
    var where = new Map();
    var info = ctx.trailerInfo.Info;
    if (info) where.set(info, 'in the file details');
    var meta = getRaw(L.catalog, 'Metadata'); if (meta) where.set(meta, 'in the hidden XML details');
    var pageContent = new Set();
    pageList(ctx).forEach(function (pg) {
      var c = pg.dict.get(N('Contents'));
      (isArr(deref(ctx, c)) ? arr(ctx, c) : [c]).forEach(function (r) { if (isRef(r)) pageContent.add(r); });
      arr(ctx, get(ctx, pg.dict, 'Annots')).forEach(function (r) { if (isRef(r)) where.set(r, 'in a comment or link'); });
    });
    var needles = [];
    strings.forEach(function (s) { needles.push({ s: s, b: latin1Bytes(s) }); needles.push({ s: s, b: utf16be(s) }); });
    var hits = {};
    function look(buf, label, isPage) {
      for (var i = 0; i < needles.length; i++) {
        if (hits[needles[i].s + label]) continue;
        if (indexOfBytes(buf, needles[i].b) >= 0) {
          if (isPage && allowPageText && allowPageText.has(needles[i].s)) continue;
          hits[needles[i].s + label] = 1;
          res.found.push({ text: needles[i].s, where: label });
        }
      }
    }
    var objs = ctx.enumerateIndirectObjects();
    for (var i = 0; i < objs.length; i++) {
      var ref = objs[i][0], o = objs[i][1];
      var label = where.get(ref) || (pageContent.has(ref) ? 'in a page drawing' : 'inside the file');
      res.searched++;
      var texts = [];
      var stack = [o], guard = 0;
      while (stack.length && guard++ < 50000) {
        var x = stack.pop();
        if (isStr(x)) { try { texts.push(x.decodeText()); texts.push(latin1(x.asBytes())); } catch (e) {} }
        else if (isName(x)) texts.push(x.decodeText());
        else children(x).forEach(function (c) { if (!isRef(c)) stack.push(c); });
      }
      texts.forEach(function (t) { strings.forEach(function (s) { if (t.indexOf(s) >= 0 && !hits[s + label]) { hits[s + label] = 1; res.found.push({ text: s, where: label }); } }); });
      if (isStream(o)) {
        var dec = await decodeStream(ctx, o);
        if (dec == null) { var sub = nameOf(get(ctx, o, 'Subtype')); if (sub !== 'Image') res.skipped++; continue; }
        look(dec, label, pageContent.has(ref));
      }
      if ((i & 63) === 63) await tick();
    }
    return res;
  }

  /* ---------- safe to send (D6) ---------- */

  async function safeToSendBytes(bytes, opts, progress) {
    opts = Object.assign({ flatten: true, removeLinks: false, compress: true }, opts || {});
    var steps = [];
    function step(id, label, detail, done) { steps.push({ id: id, label: label, detail: detail || '', done: done !== false }); if (progress) progress(steps.length, 5, label); }
    var before = await safetyBytes(bytes);
    var beforeReveal = await inspectBytes(bytes, { revisions: false, budgetMs: 20000 });
    var risky = before.findings.filter(function (f) { return f.level !== 'info'; });
    var kindsSeen = [];
    risky.forEach(function (f) { var k = { javascript: 'scripts', launch: 'program launchers', attachment: 'attached files', submit: 'form sending', goto: 'links to other files', import: 'data imports', media: 'media', xfa: 'a dynamic form', external: 'outside content', leftover: 'unused scripts', disguised: 'disguised names', auto: 'automatic actions', openAction: 'an open action', autoUri: 'automatic web visits' }[f.kind] || 'other risks'; if (kindsSeen.indexOf(k) < 0) kindsSeen.push(k); });
    step('check', 'Checked for active content', kindsSeen.length ? 'found ' + kindsSeen.join(', ') : 'nothing risky found');
    var scrubbed = await scrubBytes(bytes, {
      metadata: true, documentId: true, attachments: true, hiddenText: true, thumbnails: true, imageMeta: true, revisions: true, activeContent: true,
      forms: opts.flatten ? 'flatten' : 'keep', comments: opts.flatten ? 'flatten' : 'keep', links: !!opts.removeLinks
    });
    var rm = scrubbed.report.removed;
    step('active', 'Removed scripts and automatic actions', rm.activeContent ? plural(rm.activeContent, 'item') : 'none were there');
    step('scrub', 'Removed hidden details', [rm.metadata ? 'file details' : '', rm.documentId ? 'fingerprint' : '', rm.attachments ? plural(rm.attachments, 'attached file') : '', rm.hiddenText ? plural(rm.hiddenText, 'hidden text item') : '', rm.layers ? 'hidden layers' : '', rm.thumbnails ? 'page previews' : '', rm.imageMeta ? 'photo details' : '', beforeReveal.revisions > 1 ? 'earlier versions' : ''].filter(Boolean).join(', ') || 'nothing hidden was found');
    step('flatten', opts.flatten ? 'Flattened forms and comments' : 'Kept forms and comments as they are', opts.flatten ? [rm.forms ? plural(rm.forms, 'form field') : '', rm.comments ? plural(rm.comments, 'comment') : ''].filter(Boolean).join(', ') || 'there were none' : '', true);
    var out = scrubbed;
    var compressed = false;
    if (opts.compress && LE.pdfBulk && typeof LE.pdfBulk.compress === 'function') {
      try {
        var c = await LE.pdfBulk.compress(out, opts.compressOptions || {});
        var cb = c instanceof Uint8Array ? c : c && c.bytes instanceof Uint8Array ? c.bytes : null;
        if (cb && cb.length && cb.length < out.length) {
          out = await scrubBytes(cb, { metadata: true, documentId: true, attachments: false, hiddenText: false, thumbnails: true, imageMeta: true, forms: 'keep', comments: 'keep', links: false, activeContent: true });
          compressed = true;
        }
        step('compress', 'Made the file smaller', compressed ? fmtBytes(bytes.length) + ' → ' + fmtBytes(out.length) : 'it was already small');
      } catch (e) { step('compress', 'Could not make it smaller', friendlyError(e), false); }
    } else step('compress', 'Size left as it is', opts.compress ? 'making files smaller is not available here yet' : 'you chose not to compress', true);
    var after = await safetyBytes(out);
    var afterReveal = await inspectBytes(out, { revisions: false, budgetMs: 20000 });
    var opened = null;
    try { var pdf = await openJs(out); opened = pdf.numPages; pdf.destroy(); } catch (e) { opened = null; }
    var counts = afterReveal.counts || {};
    var checks = [
      { ok: opened === beforeReveal.pageCount, label: 'Opens with all ' + plural(beforeReveal.pageCount, 'page') },
      { ok: !after.counts.danger && !after.findings.some(function (f) { return f.level === 'caution' && f.kind !== 'attachment'; }), label: 'No scripts or automatic actions' },
      { ok: !counts.info && !counts.xmp && !counts.id, label: 'No author, software, dates or fingerprint' },
      { ok: !counts.attachments, label: 'No attached files' },
      { ok: !counts.hiddenText && !counts.layers, label: 'No hidden text or hidden layers found' },
      { ok: afterReveal.revisions === 1 && !counts.leftovers, label: 'Only the final version is inside' },
      { ok: !opts.flatten || (!counts.forms && !counts.comments), label: opts.flatten ? 'No form data or comment authors' : 'Forms and comments kept, as you chose' }
    ];
    out.report = { ok: checks.every(function (c) { return c.ok; }), steps: steps, checks: checks, before: { safety: before, reveal: beforeReveal }, after: { safety: after, reveal: afterReveal }, compressed: compressed, warnings: scrubbed.report.warnings || [] };
    return out;
  }

  /* ---------- public API: every call resolves, nothing throws past here ---------- */

  function failReport(e) { return { ok: false, error: friendlyError(e), code: (e && e.code) || 'error' }; }
  function failBytes(e) { var b = new Uint8Array(0); b.report = failReport(e); return b; }

  async function guarded(input, fn, ms, label) {
    await ready();
    var bytes = await toBytes(input);
    return withTimeout(fn(bytes), ms, label);
  }

  LE.pdfSecurity = {
    version: VERSION,
    /* D3: what the file reveals. → { ok, summary, groups:[{ id, title, explain, option, removable, count, items:[{ label, value, page? }] }], counts, pageCount, revisions, warnings } */
    inspect: function (input, opts) { return guarded(input, function (b) { return inspectBytes(b, opts); }, (opts && opts.timeoutMs) || 90000, 'Reading the file').catch(failReport); },
    /* D3: remove what inspect found; the file is written fresh. → Uint8Array with .report { ok, removed, warnings, after } (empty array with .report.error on failure) */
    scrub: function (input, options) {
      return guarded(input, async function (b) {
        var out = await scrubBytes(b, options);
        out.report.ok = true;
        if (!options || options.reinspect !== false) out.report.after = await inspectBytes(out, { revisions: false });
        return out;
      }, 120000, 'Cleaning the file').catch(failBytes);
    },
    scrubDefaults: function () { return Object.assign({}, SCRUB_DEFAULTS); },
    /* D4 → { ok, level: 'safe'|'caution'|'danger', headline, sub, findings:[{ level, kind, title, detail, code? }], counts } */
    safetyCheck: function (input) { return guarded(input, safetyBytes, 60000, 'Checking the file').catch(failReport); },
    /* D4: a copy without scripts, automatic actions, launch/submit/import actions, media, XFA, outside streams and (by default) attachments. */
    makeSafe: function (input, opts) {
      return guarded(input, async function (b) {
        var out = await makeSafeBytes(b, opts);
        out.report.ok = true;
        out.report.after = await safetyBytes(out);
        return out;
      }, 90000, 'Making a safe copy').catch(failBytes);
    },
    /* D2: text positions for every page (reuse it for several searches). */
    textIndex: function (input) { return guarded(input, async function (b) { var pdf = await openJs(b); try { var ix = await indexDocument(pdf); ix.ok = true; return ix; } finally { try { pdf.destroy(); } catch (e) {} } }, 90000, 'Reading the text').catch(failReport); },
    /* D2 → { ok, matches:[{ id, page, rects:[{ x, y, w, h }] (points, top-left origin, as the page is shown), kind, label, possible, text }], pages:[{ page, status, note }] } */
    findSensitive: function (input, options) {
      options = options || {};
      if (input && input.pages && input.pageCount != null) { try { return Promise.resolve(findInIndex(input, options)); } catch (e) { return Promise.resolve(failReport(e)); } }
      return guarded(input, async function (b) { var pdf = await openJs(b); try { return findInIndex(await indexDocument(pdf), options); } finally { try { pdf.destroy(); } catch (e) {} } }, 90000, 'Searching the text').catch(failReport);
    },
    /* D1: marks [{ page, rects:[{ x, y, w, h }], label? }] in page points, top-left origin, as shown. opts { dpi, quality, label, removeMetadata }
       → Uint8Array with .report { ok, verify:{ ok, problems, warnings, checks }, captured, pages } */
    redact: function (input, marks, opts) { return guarded(input, function (b) { return redactBytes(b, marks, opts); }, 240000, 'Redacting').catch(failBytes); },
    /* D1: what text is under the boxes now (run before redacting, or to build a plan for verify). */
    capture: function (input, marks) { return guarded(input, async function (b) { var pdf = await openJs(b); try { var p = captureFromIndex(await indexDocument(pdf), marksByPage(marks)); p.ok = true; return p; } finally { try { pdf.destroy(); } catch (e) {} } }, 60000, 'Reading under the boxes').catch(failReport); },
    /* D1: re-read a redacted file against a plan from capture(); reports failure for cover-only boxes. */
    verifyRedaction: function (input, plan, opts) { return guarded(input, function (b) { return verifyBytes(b, plan, opts); }, 120000, 'Checking the redaction').catch(function (e) { return { ok: false, problems: [friendlyError(e)], warnings: [], checks: [] }; }); },
    /* D6 → Uint8Array with .report { ok, steps, checks, before, after } */
    safeToSend: function (input, opts, progress) { return guarded(input, function (b) { return safeToSendBytes(b, opts, progress); }, 300000, 'Preparing the file').catch(failBytes); },
    /* Validators, exposed for tests and other tools. */
    validate: { luhn: luhn, iban: ibanValid, verhoeff: verhoeff, aba: abaValid, ssn: function (s) { var m = /^(\d{3})-?(\d{2})-?(\d{4})$/.exec(s); return !!m && ssnValid(m[1], m[2], m[3]); } },
    scanText: function (text, opts) { return scanText(String(text || ''), opts || {}); },
    kinds: function () { return Object.keys(KINDS).map(function (k) { return { id: k, label: KINDS[k].label, possible: !!KINDS[k].possible }; }); },
    /* Low-level helpers for tests: raw structure scan and a decompressed search. */
    scanStructure: function (input) { return toBytes(input).then(scanRaw).catch(failReport); },
    searchFile: function (input, strings) { return guarded(input, function (b) { return rawSearch(b, strings || [], null); }, 90000, 'Searching the file').catch(failReport); }
  };

  /* =====================================================================
     Studio panel: "Protect". Registered through PS.panels / PS.overlays only;
     the rail tab is added from here so no studio file needs to change.
     ===================================================================== */
  (function studioPanel() {
    var PS = global.PS;
    if (!PS || !PS.panels || !PS.S) return;
    var d = document;
    var S = PS.S;
    var el = PS.el, esc = PS.esc, icon = PS.icon;
    var API = LE.pdfSecurity;

    var I = {
      shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
      send: '<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4z"/>',
      eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
      bug: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="M12 8v5M12 16h.01"/>',
      redact: '<rect x="3" y="8" width="18" height="8" rx="1" fill="currentColor"/><path d="M3 4h10M3 20h14"/>',
      back: '<path d="m15 6-6 6 6 6"/>',
      right: '<path d="m9 6 6 6-6 6"/>',
      check: '<path d="M5 12.5l4.5 4.5L19.5 7"/>',
      cross: '<path d="M6 6l12 12M18 6 6 18"/>',
      dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
      alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
      download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      draw: '<rect x="4" y="6" width="16" height="12" rx="1.5" stroke-dasharray="3 2"/><path d="M14 14l6 6"/>',
      trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4h6v3"/>',
      lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
    };
    function ic(name, cls) { return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || '') + '</svg>'; }
    function button(cls, html, attrs) {
      var b = el('button', cls, html);
      b.type = 'button';
      Object.keys(attrs || {}).forEach(function (k) { b.setAttribute(k, attrs[k]); });
      return b;
    }
    function say(m, ms) { if (PS.say) PS.say(m, ms); }
    function download(bytes, name) {
      var blob = new Blob([bytes], { type: 'application/pdf' });
      if (global.IT && IT.download) { IT.download(blob, name); return; }
      var a = d.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; d.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    function outName(suffix) { return (PS.baseName ? PS.baseName(SEC.srcName || S.name || 'document') : 'document') + suffix + '.pdf'; }

    var SEC = {
      view: 'home', marks: {}, drawing: false, keepText: false, hits: null, terms: '', dpi: 200, label: '', labelMode: 'none',
      sendOpts: { flatten: true, removeLinks: false, compress: true }, docId: null,
      results: {}, pane: null, busy: false
    };
    PS.security = SEC;

    /* ---------- the file to work on ---------- */

    function docIds() {
      var ids = [];
      S.pages.forEach(function (r) { if (r.docId && ids.indexOf(r.docId) < 0) ids.push(r.docId); });
      return ids;
    }
    function currentDocId() {
      var ids = docIds();
      if (SEC.docId && ids.indexOf(SEC.docId) >= 0) return SEC.docId;
      var cur = S.pages[S.current];
      return (cur && cur.docId) || ids[0] || null;
    }
    function isPlain() {
      var ids = docIds();
      if (ids.length !== 1) return false;
      var doc = S.docs[ids[0]];
      if (!doc || S.pages.length !== doc.pageCount) return false;
      if (S.formValues[ids[0]] && Object.keys(S.formValues[ids[0]]).length) return false;
      return S.pages.every(function (r, i) { return r.docId === ids[0] && r.pageIndex === i && !((r.rotation || 0) % 360) && !(r.scene && r.scene.layers && r.scene.layers.length); });
    }
    /* The file as received: used to reveal and to check safety. */
    function originalSource() {
      var id = currentDocId();
      var doc = id && S.docs[id];
      if (!doc) return null;
      return { bytes: doc._bytes, name: S.docNames[id] || doc.name, docId: id, pages: doc.pageCount };
    }
    /* The file as it would be saved: used to redact and to prepare a copy to send. */
    async function currentSource() {
      if (isPlain()) {
        var id = docIds()[0];
        return { bytes: S.docs[id]._bytes, name: S.docNames[id] || S.docs[id].name, uids: S.pages.map(function (r) { return r.uid; }), edited: false };
      }
      if (PS.commitEditing) { try { PS.commitEditing(); } catch (e) {} }
      var built = await PS.buildPdf({ noTools: true });
      return { bytes: built, name: S.name || 'document.pdf', uids: S.pages.map(function (r) { return r.uid; }), edited: true };
    }

    /* ---------- building blocks ---------- */

    function privacyLine() {
      return el('p', 'sec-private', ic('lock') + '<span>Checked on this device. The file never leaves it.</span>');
    }
    function header(title, sub) {
      var h = el('div', 'sec-head');
      var back = button('ps-ib sec-back', ic('back'), { 'aria-label': 'Back to all protection tools', 'data-sec': 'home' });
      h.appendChild(back);
      var t = el('div', 'sec-head-t');
      t.appendChild(el('h3', null, esc(title)));
      if (sub) t.appendChild(el('p', null, esc(sub)));
      h.appendChild(t);
      return h;
    }
    function toggleRow(label, hint, checked, onChange) {
      var w = el('label', 'ps-toggle sec-toggle');
      var i = d.createElement('input'); i.type = 'checkbox'; i.checked = !!checked;
      w.appendChild(i);
      w.appendChild(el('span', 'ps-toggle-ui'));
      w.appendChild(el('span', 'ps-toggle-text', esc(label) + (hint ? '<small>' + esc(hint) + '</small>' : '')));
      i.addEventListener('change', function () { onChange(i.checked); });
      w.input = i;
      return w;
    }
    function segmented(options, value, onPick, label) {
      var s = el('div', 'seg ps-seg sec-seg');
      s.setAttribute('role', 'group');
      if (label) s.setAttribute('aria-label', label);
      options.forEach(function (o) { s.appendChild(button('', esc(o[1]), { 'data-v': o[0], 'aria-pressed': String(o[0] === value) })); });
      s.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        [].forEach.call(s.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        onPick(b.getAttribute('data-v'));
      });
      return s;
    }
    function busyBox(text) { return el('div', 'sec-busy', '<span class="sec-spin" aria-hidden="true"></span><span>' + esc(text) + '</span>'); }
    function errorBox(text) { return el('div', 'sec-card sec-card-err', ic('alert') + '<div><strong>That did not work</strong><p>' + esc(text) + '</p></div>'); }
    function checkList(items) {
      var ul = el('ul', 'sec-checks');
      items.forEach(function (c) {
        var li = el('li', c.ok ? 'is-ok' : 'is-bad', ic(c.ok ? 'check' : 'cross') + '<span>' + esc(c.label) + (c.detail ? '<small>' + esc(c.detail) + '</small>' : '') + '</span>');
        ul.appendChild(li);
      });
      return ul;
    }
    function downloadButton(bytes, name, label) {
      var b = button('btn btn-gold btn-block sec-dl', ic('download') + '<span>' + esc(label || 'Download') + '</span>', { 'data-sec-download': '1' });
      b.addEventListener('click', function () { download(bytes, name); });
      var w = el('div', 'sec-dl-wrap');
      w.appendChild(b);
      w.appendChild(el('p', 'sec-small', esc(name) + ' · ' + fmtBytes(bytes.length) + ' · your original is unchanged'));
      return w;
    }
    async function run(label, fn) {
      if (SEC.busy) return null;
      SEC.busy = true;
      var pr = PS.progress ? PS.progress(label, false) : null;
      try { return await fn(function (done, total, sub) { if (pr) { try { pr.set(done, total, sub); } catch (e) {} } }); }
      finally { SEC.busy = false; if (pr) pr.end(); }
    }

    /* ---------- views ---------- */

    function render() {
      var pane = SEC.pane;
      if (!pane) return;
      pane.innerHTML = '';
      pane.setAttribute('data-view', SEC.view);
      if (!S.pages.length) {
        pane.appendChild(privacyLine());
        pane.appendChild(el('p', 'ps-note', 'Open a PDF to check it, clean it or hide information in it.'));
        return;
      }
      (VIEWS[SEC.view] || VIEWS.home)(pane);
      if (SEC.view !== 'redact' && SEC.drawing) setDrawing(false);
    }
    function renderTop() { render(); if (PS.E && PS.E.panelBody) PS.E.panelBody.scrollTop = 0; }
    function go(view) { SEC.view = view; render(); if (PS.E && PS.E.panelBody) PS.E.panelBody.scrollTop = 0; refreshMarks(); }
    SEC.go = go;

    var VIEWS = {};

    VIEWS.home = function (pane) {
      pane.appendChild(privacyLine());
      var ids = docIds();
      if (ids.length > 1) {
        var w = el('div', 'ps-field sec-pick');
        w.innerHTML = '<label for="sec-doc">File to check</label>';
        var sel = d.createElement('select'); sel.className = 'input'; sel.id = 'sec-doc';
        ids.forEach(function (id) { var o = d.createElement('option'); o.value = id; o.textContent = S.docNames[id] || S.docs[id].name; sel.appendChild(o); });
        sel.value = currentDocId();
        sel.addEventListener('change', function () { SEC.docId = sel.value; SEC.results = {}; });
        w.appendChild(sel);
        pane.appendChild(w);
      }
      var list = el('div', 'sec-cards');
      [
        ['send', 'send', 'Make it safe to send', 'One step: removes scripts, hidden details and old versions, then checks the result.', true],
        ['reveal', 'eye', 'What does this PDF reveal?', 'Author, software, dates, comments, attachments, hidden text and earlier versions.'],
        ['safety', 'bug', 'Is it safe to open?', 'Looks for scripts, automatic actions and attached programs without running them.'],
        ['redact', 'redact', 'Hide information for good', 'Black out text and pictures so they are removed from the file, then verify it.']
      ].forEach(function (c) {
        var b = button('sec-entry' + (c[4] ? ' is-main' : ''), '<span class="sec-entry-ic">' + ic(c[1]) + '</span><span class="sec-entry-t"><strong>' + esc(c[2]) + '</strong><small>' + esc(c[3]) + '</small></span>' + ic('right', 'i sec-chev'), { 'data-sec': c[0] });
        list.appendChild(b);
      });
      pane.appendChild(list);
      var n = countMarks();
      if (n.boxes) pane.appendChild(el('p', 'ps-note sec-pending', ic('redact') + '<span>' + plural(n.boxes, 'redaction box') + ' waiting on ' + plural(n.pages, 'page') + '. Nothing is removed until you apply them.</span>'));
    };

    /* D6 */
    VIEWS.send = function (pane) {
      pane.appendChild(header('Make it safe to send', 'A new copy without scripts, hidden details, attachments or earlier versions.'));
      pane.appendChild(privacyLine());
      var res = SEC.results.send;
      if (res && res.bytes) { pane.appendChild(sendResult(res)); return; }
      var opts = el('div', 'sec-opts');
      opts.appendChild(toggleRow('Flatten forms and comments', 'Keeps how they look, removes the data and names behind them', SEC.sendOpts.flatten, function (v) { SEC.sendOpts.flatten = v; }));
      opts.appendChild(toggleRow('Remove links to websites', 'Clickable addresses are taken out; the words stay', SEC.sendOpts.removeLinks, function (v) { SEC.sendOpts.removeLinks = v; }));
      var canCompress = !!(LE.pdfBulk && typeof LE.pdfBulk.compress === 'function');
      if (canCompress) opts.appendChild(toggleRow('Make the file smaller', 'Pictures are re-saved at a lower size', SEC.sendOpts.compress, function (v) { SEC.sendOpts.compress = v; }));
      pane.appendChild(opts);
      var steps = el('ol', 'sec-steps');
      ['Check for scripts and automatic actions', 'Remove them', 'Remove author, software, dates, attachments, hidden text and earlier versions', SEC.sendOpts.flatten ? 'Flatten forms and comments' : 'Keep forms and comments', canCompress ? 'Make it smaller, if you chose to' : null, 'Check the new file and show what changed'].filter(Boolean).forEach(function (s) { steps.appendChild(el('li', null, esc(s))); });
      pane.appendChild(steps);
      if (!isPlain()) pane.appendChild(el('p', 'ps-note', 'Your changes in the studio are included.'));
      var go1 = button('btn btn-ink btn-block sec-run', ic('shield') + '<span>Prepare a copy to send</span>', { 'data-sec-run': 'send' });
      go1.addEventListener('click', doSend);
      pane.appendChild(go1);
      if (res && res.error) pane.appendChild(errorBox(res.error));
    };
    async function doSend() {
      var r = await run('Preparing a copy to send', async function (progress) {
        var src = await currentSource();
        SEC.srcName = src.name;
        var out = await API.safeToSend(src.bytes, { flatten: SEC.sendOpts.flatten, removeLinks: SEC.sendOpts.removeLinks, compress: SEC.sendOpts.compress }, progress);
        return out;
      });
      if (!r) return;
      SEC.results.send = r.length ? { bytes: r, report: r.report } : { error: r.report.error };
      renderTop();
    }
    function sendResult(res) {
      var w = el('div', 'sec-result');
      var rep = res.report;
      var card = el('div', 'sec-card ' + (rep.ok ? 'sec-card-ok' : 'sec-card-warn'), ic(rep.ok ? 'check' : 'alert') + '<div><strong>' + (rep.ok ? 'Ready to send' : 'Ready, with notes') + '</strong><p>' + (rep.ok ? 'Every check passed on the new file.' : 'Most checks passed. See the notes below.') + '</p></div>');
      w.appendChild(card);
      w.appendChild(el('h4', 'sec-sub', 'What was done'));
      w.appendChild(checkList(rep.steps.map(function (s) { return { ok: s.done, label: s.label, detail: s.detail }; })));
      w.appendChild(el('h4', 'sec-sub', 'Checked on the new file'));
      w.appendChild(checkList(rep.checks));
      (rep.warnings || []).forEach(function (t) { w.appendChild(el('p', 'ps-note ps-warn', ic('alert') + '<span>' + esc(t) + '</span>')); });
      w.appendChild(downloadButton(res.bytes, outName('-to-send'), 'Download the copy to send'));
      var again = button('btn btn-ghost btn-block', 'Start again', { 'data-sec-reset': 'send' });
      again.addEventListener('click', function () { delete SEC.results.send; render(); });
      w.appendChild(again);
      return w;
    }

    /* D3 */
    VIEWS.reveal = function (pane) {
      pane.appendChild(header('What does this PDF reveal?', 'Things inside the file that are not on the page.'));
      pane.appendChild(privacyLine());
      var src = originalSource();
      var key = src && src.docId;
      var res = SEC.results.reveal;
      if (!res || res.key !== key) { SEC.results.reveal = res = { key: key, loading: true }; startReveal(src); }
      if (res.loading) { pane.appendChild(busyBox('Reading ' + (src ? src.name : 'the file') + '…')); return; }
      if (res.error) { pane.appendChild(errorBox(res.error)); return; }
      if (res.cleaned) { pane.appendChild(revealResult(res)); return; }
      var rep = res.report;
      pane.appendChild(el('p', 'sec-summary' + (rep.findingCount ? '' : ' is-clean'), esc(rep.summary)));
      if (!isPlain() && docIds().length === 1) pane.appendChild(el('p', 'ps-note', 'This checks the file as you opened it. Your changes in the studio are not part of it.'));
      var opts = res.opts = res.opts || API.scrubDefaults();
      var groups = el('div', 'sec-groups');
      rep.groups.filter(function (g) { return (g.removable || rep.encrypted) && g.count && g.id !== 'pages'; }).forEach(function (g) { groups.appendChild(groupView(g, opts, !rep.encrypted)); });
      pane.appendChild(groups);
      (rep.warnings || []).forEach(function (t) { pane.appendChild(el('p', 'ps-note ps-warn', ic('alert') + '<span>' + esc(t) + '</span>')); });
      if (rep.findingCount && !rep.encrypted) {
        var go2 = button('btn btn-ink btn-block sec-run', ic('shield') + '<span>Remove all of this</span>', { 'data-sec-run': 'scrub' });
        go2.addEventListener('click', function () { doScrub(src, res); });
        pane.appendChild(go2);
        pane.appendChild(el('p', 'sec-small', 'You get a new file. The pages look the same; the details above are taken out.'));
      }
      var also = rep.groups.filter(function (g) { return !g.removable && g.count; });
      if (also.length) {
        pane.appendChild(el('h4', 'sec-sub', 'Also in the file'));
        var ag = el('div', 'sec-groups is-quiet');
        also.forEach(function (g) { ag.appendChild(groupView(g, opts, false)); });
        pane.appendChild(ag);
      }
    };
    function groupView(g, opts, removable) {
      var det = el('details', 'sec-group');
      det.setAttribute('data-group', g.id);
      var sum = el('summary', null, '<span class="sec-g-t"><strong>' + esc(g.title) + '</strong><small>' + esc(g.explain) + '</small></span><span class="sec-count">' + g.count + '</span>');
      det.appendChild(sum);
      var body = el('div', 'sec-g-body');
      var ul = el('ul', 'sec-items');
      g.items.slice(0, 60).forEach(function (it) { ul.appendChild(el('li', null, '<span>' + esc(it.label) + '</span><b>' + esc(it.value) + '</b>')); });
      if (g.items.length > 60) ul.appendChild(el('li', null, '<span>…and ' + (g.items.length - 60) + ' more</span>'));
      body.appendChild(ul);
      if (removable && g.option) {
        if (g.option === 'forms') {
          body.appendChild(segmented([['flatten', 'Keep the look'], ['remove', 'Remove fields']], opts.forms === 'keep' ? 'flatten' : opts.forms, function (v) { opts.forms = v; }, 'Form fields'));
        }
        if (g.option === 'comments') {
          body.appendChild(segmented([['flatten', 'Keep the marks'], ['remove', 'Remove all']], opts.comments === 'keep' ? 'flatten' : opts.comments, function (v) { opts.comments = v; }, 'Comments'));
        }
        var on = opts[g.option] !== false && opts[g.option] !== 'keep';
        var t = toggleRow('Remove this', null, on, function (v) {
          if (g.option === 'forms' || g.option === 'comments') opts[g.option] = v ? 'flatten' : 'keep';
          else opts[g.option] = v;
          det.classList.toggle('is-kept', !v);
        });
        t.classList.add('sec-g-toggle');
        body.appendChild(t);
        det.classList.toggle('is-kept', !on);
      }
      det.appendChild(body);
      return det;
    }
    async function startReveal(src) {
      if (!src) { SEC.results.reveal = { error: 'Open a PDF first.' }; render(); return; }
      var rep = await API.inspect(src.bytes);
      var cur = SEC.results.reveal;
      if (!cur || cur.key !== src.docId) return;
      SEC.results.reveal = rep.ok === false ? { key: src.docId, error: rep.error } : { key: src.docId, report: rep, opts: API.scrubDefaults() };
      if (SEC.view === 'reveal') render();
    }
    async function doScrub(src, res) {
      var out = await run('Removing hidden details', function () { SEC.srcName = src.name; return API.scrub(src.bytes, res.opts); });
      if (!out) return;
      if (!out.length) { res.cleanError = out.report.error; render(); return; }
      res.cleaned = out;
      renderTop();
    }
    function revealResult(res) {
      var w = el('div', 'sec-result');
      var before = res.report, after = res.cleaned.report.after;
      var leftover = after ? after.groups.filter(function (g) { return g.removable && g.count; }) : [];
      w.appendChild(el('div', 'sec-card ' + (leftover.length ? 'sec-card-warn' : 'sec-card-ok'), ic(leftover.length ? 'alert' : 'check') + '<div><strong>' + (leftover.length ? 'Cleaned, with some details kept' : 'Cleaned') + '</strong><p>' + (leftover.length ? 'You chose to keep some groups, or a few items could not be removed safely.' : 'The new file was read again and none of these details are left.') + '</p></div>'));
      var table = el('table', 'sec-ba');
      table.innerHTML = '<thead><tr><th scope="col">Found</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>';
      var tb = el('tbody');
      before.groups.filter(function (g) { return g.removable && g.count; }).forEach(function (g) {
        var a = after ? (after.counts[g.id] || 0) : '?';
        tb.appendChild(el('tr', a ? 'is-left' : '', '<th scope="row">' + esc(g.title) + '</th><td>' + g.count + '</td><td>' + (a === 0 ? '<span class="sec-zero">' + ic('check') + '0</span>' : esc(String(a))) + '</td>'));
      });
      table.appendChild(tb);
      w.appendChild(table);
      (res.cleaned.report.warnings || []).forEach(function (t) { w.appendChild(el('p', 'ps-note ps-warn', ic('alert') + '<span>' + esc(t) + '</span>')); });
      w.appendChild(downloadButton(res.cleaned, outName('-clean'), 'Download the cleaned copy'));
      var again = button('btn btn-ghost btn-block', 'Back to the details', {});
      again.addEventListener('click', function () { delete res.cleaned; render(); });
      w.appendChild(again);
      return w;
    }

    /* D4 */
    VIEWS.safety = function (pane) {
      pane.appendChild(header('Is it safe to open?', 'Nothing in the file is run. It is only read. This looks for active content; it is not a virus scan.'));
      pane.appendChild(privacyLine());
      var src = originalSource();
      var key = src && src.docId;
      var res = SEC.results.safety;
      if (!res || res.key !== key) {
        SEC.results.safety = res = { key: key, loading: true };
        API.safetyCheck(src ? src.bytes : null).then(function (rep) {
          if (!SEC.results.safety || SEC.results.safety.key !== key) return;
          SEC.results.safety = rep.ok === false ? { key: key, error: rep.error } : { key: key, report: rep };
          if (SEC.view === 'safety') render();
        });
      }
      if (res.loading) { pane.appendChild(busyBox('Checking ' + (src ? src.name : 'the file') + '…')); return; }
      if (res.error) { pane.appendChild(errorBox(res.error)); return; }
      var rep = res.report;
      var tone = rep.level === 'safe' ? 'ok' : rep.level === 'caution' ? 'warn' : 'err';
      var v = el('div', 'sec-verdict is-' + tone);
      v.setAttribute('data-level', rep.level);
      v.innerHTML = '<span class="sec-light" aria-hidden="true"><i></i><i></i><i></i></span><div><strong>' + esc(rep.headline) + '</strong><p>' + esc(rep.sub) + '</p></div>';
      pane.appendChild(v);
      if (res.safe) { pane.appendChild(safeResult(res)); return; }
      if (rep.level !== 'safe') pane.appendChild(safeActions(src, res));
      var list = el('ul', 'sec-findings');
      rep.findings.forEach(function (f) {
        var li = el('li', 'is-' + f.level);
        li.setAttribute('data-kind', f.kind);
        li.innerHTML = '<span class="sec-f-ic">' + ic(f.level === 'info' ? 'info' : 'alert') + '</span><div><strong>' + esc(f.title) + '</strong><p>' + esc(f.detail) + '</p>' + (f.code ? '<code>' + esc(f.code) + '</code>' : '') + '</div>';
        list.appendChild(li);
      });
      if (rep.findings.length) pane.appendChild(list);
    };
    function safeActions(src, res) {
      var w = el('div', 'sec-safe-acts');
      var keepLinks = true;
      w.appendChild(toggleRow('Keep links to websites', 'They only open when someone clicks them', keepLinks, function (x) { keepLinks = x; }));
      var b = button('btn btn-ink btn-block sec-run', ic('shield') + '<span>Make a safe copy</span>', { 'data-sec-run': 'safe' });
      b.addEventListener('click', async function () {
        var out = await run('Making a safe copy', function () { SEC.srcName = src.name; return API.makeSafe(src.bytes, { keepLinks: keepLinks }); });
        if (!out) return;
        if (!out.length) { w.appendChild(errorBox(out.report.error)); return; }
        res.safe = out;
        renderTop();
      });
      w.appendChild(b);
      w.appendChild(el('p', 'sec-small', 'Attached files are left out of the safe copy. The pages stay the same.'));
      if (res.report.findings.length) w.appendChild(el('h4', 'sec-sub', 'What was found'));
      return w;
    }
    function safeResult(res) {
      var w = el('div', 'sec-result');
      var after = res.safe.report.after;
      var ok = after && after.level === 'safe';
      w.appendChild(el('div', 'sec-card ' + (ok ? 'sec-card-ok' : 'sec-card-warn'), ic(ok ? 'check' : 'alert') + '<div><strong>' + (ok ? 'Safe copy ready' : 'Safe copy ready, with notes') + '</strong><p>' + (ok ? 'The new file was checked again: no scripts, automatic actions or attached programs.' : esc(after ? after.headline : '')) + '</p></div>'));
      var rm = res.safe.report.removed || {};
      w.appendChild(checkList([
        { ok: true, label: 'Scripts removed', detail: String(rm.scripts || 0) },
        { ok: true, label: 'Automatic and outside actions removed', detail: String(rm.actions || 0) },
        { ok: true, label: 'Media, outside content and attachments removed', detail: String((rm.media || 0) + (rm.external || 0) + (rm.attachments || 0) + (rm.xfa || 0)) },
        { ok: true, label: 'Written fresh, earlier versions dropped', detail: '' }
      ]));
      w.appendChild(downloadButton(res.safe, outName('-safe'), 'Download the safe copy'));
      return w;
    }

    /* D1 + D2 */
    function countMarks() {
      var boxes = 0, pages = 0;
      S.pages.forEach(function (r) { var m = SEC.marks[r.uid]; if (m && m.length) { boxes += m.length; pages++; } });
      return { boxes: boxes, pages: pages };
    }
    VIEWS.redact = function (pane) {
      pane.appendChild(header('Hide information for good', 'What you black out is removed from the file, not just covered.'));
      pane.appendChild(privacyLine());
      var res = SEC.results.redact;
      if (res && res.bytes) { pane.appendChild(redactResult(res)); return; }

      var s1 = el('section', 'ps-sec');
      s1.appendChild(el('h3', 'ps-sec-title', '1. Mark what to hide'));
      var row = el('div', 'sec-row');
      var drawB = button('btn sec-draw' + (SEC.drawing ? ' is-on' : ''), ic('draw') + '<span>' + (SEC.drawing ? 'Drawing boxes' : 'Draw boxes') + '</span>', { 'aria-pressed': String(SEC.drawing), 'data-sec-draw': '1' });
      drawB.addEventListener('click', function () { setDrawing(!SEC.drawing); render(); });
      row.appendChild(drawB);
      var findB = button('btn sec-find', ic('search') + '<span>Find sensitive data</span>', { 'data-sec-find': '1' });
      findB.addEventListener('click', function () { SEC.findOpen = true; render(); });
      row.appendChild(findB);
      s1.appendChild(row);
      var n = countMarks();
      var status = el('p', 'sec-status', n.boxes ? plural(n.boxes, 'box', 'boxes') + ' on ' + plural(n.pages, 'page') : (SEC.drawing ? 'Drag over the page to draw a box.' : 'No boxes yet.'));
      status.setAttribute('aria-live', 'polite');
      s1.appendChild(status);
      if (n.boxes) {
        var clr = button('btn btn-ghost btn-sm', ic('trash') + '<span>Remove all boxes</span>', { 'data-sec-clear': '1' });
        clr.addEventListener('click', function () { SEC.marks = {}; refreshMarks(); render(); });
        s1.appendChild(clr);
      }
      pane.appendChild(s1);

      if (SEC.findOpen) pane.appendChild(findView());

      var s2 = el('section', 'ps-sec');
      s2.appendChild(el('h3', 'ps-sec-title', '2. Choose how it looks'));
      s2.appendChild(el('div', 'ps-label', 'Label on each box'));
      var labIn = d.createElement('input'); labIn.className = 'input'; labIn.type = 'text'; labIn.maxLength = 40; labIn.placeholder = 'Reason, e.g. Personal data'; labIn.value = SEC.labelMode === 'custom' ? SEC.label : ''; labIn.hidden = SEC.labelMode !== 'custom'; labIn.setAttribute('aria-label', 'Label text');
      labIn.addEventListener('input', function () { SEC.label = labIn.value; refreshMarks(); });
      s2.appendChild(segmented([['none', 'None'], ['redacted', 'REDACTED'], ['custom', 'Your words']], SEC.labelMode, function (v) {
        SEC.labelMode = v; SEC.label = v === 'redacted' ? 'REDACTED' : v === 'custom' ? labIn.value : ''; labIn.hidden = v !== 'custom'; refreshMarks();
      }, 'Label'));
      s2.appendChild(labIn);
      var how = el('p', 'ps-note');
      function explain() {
        how.textContent = SEC.keepText ?
          'Where a box covers only plain text, those letters are deleted from the page and the rest of its text stays selectable. If a box covers a picture, a drawing or text that cannot be edited exactly, that page is rebuilt as a picture instead. Pages without boxes stay exactly as they are.' :
          'Pages with a box are rebuilt as a picture of the page with the boxes burned in. Nothing under a box can be copied or recovered, but text on those pages can no longer be selected. Pages without boxes stay exactly as they are.';
      }
      s2.appendChild(toggleRow('Keep other text selectable', 'When the boxes only cover plain text', SEC.keepText, function (v) { SEC.keepText = v; explain(); }));
      s2.appendChild(el('div', 'ps-label', 'Quality of pages rebuilt as pictures'));
      s2.appendChild(segmented([['150', 'Standard'], ['200', 'High'], ['300', 'Best']], String(SEC.dpi), function (v) { SEC.dpi = +v; }, 'Quality'));
      explain();
      s2.appendChild(how);
      pane.appendChild(s2);

      var go3 = button('btn btn-ink btn-block sec-run', ic('redact') + '<span>Redact and verify</span>', { 'data-sec-run': 'redact' });
      go3.disabled = !n.boxes;
      go3.addEventListener('click', doRedact);
      pane.appendChild(go3);
      if (res && res.error) pane.appendChild(errorBox(res.error));
    };

    function findView() {
      var s = el('section', 'ps-sec sec-findbox');
      s.appendChild(el('h3', 'ps-sec-title', 'Find sensitive data'));
      var t = d.createElement('input'); t.className = 'input'; t.type = 'text'; t.id = 'sec-terms'; t.placeholder = 'Names or words, separated by commas'; t.value = SEC.terms; t.autocomplete = 'off'; t.spellcheck = false;
      var lab = el('label', 'ps-label', 'Also find these names or words (exact text)'); lab.htmlFor = 'sec-terms';
      s.appendChild(lab);
      s.appendChild(t);
      var b = button('btn btn-ink btn-block', ic('search') + '<span>' + (SEC.hits ? 'Search again' : 'Search this document') + '</span>', { 'data-sec-search': '1' });
      b.addEventListener('click', async function () {
        SEC.terms = t.value;
        var terms = t.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        var out = await run('Looking for sensitive data', async function () {
          var src = await currentSource();
          SEC.srcUids = src.uids;
          return (SEC.findWith || API.findSensitive)(src.bytes, { terms: terms }); /* SEC.findWith: le-pdf-ocr.js can read scanned pages first */
        });
        if (!out) return;
        SEC.hits = out.ok === false ? { error: out.error } : out;
        if (SEC.hits.matches) SEC.hits.matches.forEach(function (m) { m.on = !m.possible; });
        render();
        refreshMarks();
      });
      s.appendChild(b);
      var h = SEC.hits;
      if (!h) { s.appendChild(el('p', 'ps-note', 'Finds email addresses, phone numbers, web and IP addresses, dates of birth, card numbers, IBANs, US Social Security, Aadhaar and PAN numbers, and possible ID or bank numbers. Card, IBAN and Aadhaar numbers are only listed when their check digits are valid.')); return s; }
      if (h.error) { s.appendChild(errorBox(h.error)); return s; }
      (h.pages || []).filter(function (p) { return p.status === 'picture'; }).forEach(function (p) {
        s.appendChild(el('p', 'ps-note ps-warn', ic('info') + '<span>Page ' + (p.page + 1) + ': this page is a picture; text cannot be searched yet.</span>'));
      });
      if (SEC.scanHint) { var hint = SEC.scanHint(h); if (hint) s.appendChild(hint); }   /* le-pdf-ocr.js: offer to read scanned pages */
      if (!h.matches.length) { s.appendChild(el('p', 'sec-summary is-clean', 'Nothing sensitive was found in the text.')); return s; }
      var on = h.matches.filter(function (m) { return m.on; }).length;
      s.appendChild(el('p', 'sec-summary', plural(h.matches.length, 'possible item') + ' found. Check the ones to hide; nothing is hidden until you add them.'));
      var ul = el('ul', 'sec-hits');
      h.matches.forEach(function (m) {
        var li = el('li', m.on ? 'is-on' : '');
        var lab2 = el('label', 'sec-hit');
        var cb = d.createElement('input'); cb.type = 'checkbox'; cb.checked = !!m.on; cb.setAttribute('data-hit', m.id);
        cb.addEventListener('change', function () { m.on = cb.checked; li.classList.toggle('is-on', cb.checked); addB.querySelector('span').textContent = 'Add ' + plural(h.matches.filter(function (x) { return x.on; }).length, 'box', 'boxes'); refreshMarks(); });
        var th = d.createElement('canvas'); th.className = 'sec-thumb'; th.width = 44; th.height = 56; th.setAttribute('aria-hidden', 'true');
        paintThumb(th, m);
        lab2.appendChild(cb);
        lab2.appendChild(th);
        lab2.appendChild(el('span', 'sec-hit-t', '<b>' + esc(m.text) + '</b><small>' + esc(m.label) + (m.possible ? ' · possible' : '') + ' · page ' + (m.page + 1) + '</small>'));
        li.appendChild(lab2);
        ul.appendChild(li);
      });
      s.appendChild(ul);
      var addB = button('btn btn-ink btn-block', ic('redact') + '<span>Add ' + plural(on, 'box', 'boxes') + '</span>', { 'data-sec-add': '1' });
      addB.addEventListener('click', function () {
        var added = 0;
        h.matches.forEach(function (m) {
          if (!m.on) return;
          var uidv = SEC.srcUids && SEC.srcUids[m.page];
          if (!uidv) return;
          m.rects.forEach(function (r) { addMark(uidv, { x: r.x, y: r.y, w: r.w, h: r.h, source: 'find', kind: m.kind }); added++; });
        });
        SEC.hits = null;
        SEC.findOpen = false;
        say(plural(added, 'box', 'boxes') + ' added. Review them on the pages.');
        render();
      });
      s.appendChild(addB);
      return s;
    }
    function paintThumb(canvas, m) {
      var uidv = SEC.srcUids && SEC.srcUids[m.page];
      var ref = uidv && PS.refByUid ? PS.refByUid(uidv) : null;
      if (!ref || !PS.thumbFor) return;
      PS.thumbFor(ref, 112).then(function (c) {
        var g = canvas.getContext('2d');
        var sc = Math.min(canvas.width / c.width, canvas.height / c.height);
        var w = c.width * sc, h = c.height * sc, x = (canvas.width - w) / 2, y = (canvas.height - h) / 2;
        g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(c, x, y, w, h);
        var size = PS.refSize(ref);
        var k = w / size.w;
        g.fillStyle = 'rgba(88,132,248,0.55)';
        m.rects.forEach(function (r) { g.fillRect(x + r.x * k, y + r.y * k, Math.max(2, r.w * k), Math.max(2, r.h * k)); });
      }).catch(function () {});
    }

    async function doRedact() {
      var n = countMarks();
      if (!n.boxes) return;
      var body = el('div', 'sec-confirm');
      body.innerHTML = '<p>' + esc(plural(n.boxes, 'box', 'boxes') + ' on ' + plural(n.pages, 'page') + ' will be removed from a new copy of the file. Your original stays as it is.') + '</p><p class="ps-note">Pages with boxes become pictures of the page, so their text cannot be selected afterwards. Comments, links and form fields under a box are removed too.</p>';
      var ok = PS.dialog ? await PS.dialog({ title: 'Redact for good?', body: body, ok: 'Redact and verify' }) : true;
      if (!ok) return;
      var out = await run('Redacting', async function (progress) {
        var src = await currentSource();
        SEC.srcName = src.name;
        var marks = [];
        src.uids.forEach(function (uidv, i) {
          var list = SEC.marks[uidv];
          if (list && list.length) marks.push({ page: i, rects: list.map(function (m) { return { x: m.x, y: m.y, w: m.w, h: m.h }; }) });
        });
        return API.redact(src.bytes, marks, { dpi: SEC.dpi, label: SEC.label, mode: SEC.keepText ? 'searchable' : 'image', onProgress: progress });
      });
      if (!out) return;
      SEC.results.redact = out.length ? { bytes: out, report: out.report } : { error: out.report.error };
      renderTop();
    }
    function redactResult(res) {
      var w = el('div', 'sec-result');
      var v = res.report.verify || { ok: false, problems: ['The check did not run.'], checks: [], warnings: [] };
      var card = el('div', 'sec-card ' + (v.ok ? 'sec-card-ok' : 'sec-card-err'), ic(v.ok ? 'check' : 'alert') + '<div><strong>' + (v.ok ? 'Verified: the hidden content is no longer in this file' : 'Not verified: do not send this file') + '</strong><p>' + (v.ok ? 'The saved file was opened again and searched. Nothing from under the boxes was found.' : 'The saved file still holds something from under the boxes:') + '</p></div>');
      card.setAttribute('data-verified', String(!!v.ok));
      w.appendChild(card);
      if (!v.ok) { var pl = el('ul', 'sec-problems'); v.problems.forEach(function (p) { pl.appendChild(el('li', null, esc(p))); }); w.appendChild(pl); }
      var modes = res.report.pageModes || {};
      var reasons = {};
      (res.report.fallbacks || []).forEach(function (f) { reasons[f.page] = f.reason; });
      if (res.report.retried) res.report.retried.pages.forEach(function (p) { reasons[p] = 'the first check was not clean'; });
      var pm = Object.keys(modes).map(Number).sort(function (a, b) { return a - b; });
      if (pm.length) {
        w.appendChild(el('h4', 'sec-sub', 'Pages changed'));
        w.appendChild(checkList(pm.map(function (p) {
          return { ok: true, label: 'Page ' + (p + 1) + (modes[p] === 'searchable' ? ': letters under the boxes deleted, other text still selectable' : ': rebuilt as a picture'), detail: modes[p] === 'image' && reasons[p] ? 'Because ' + reasons[p] + '.' : '' };
        })));
      }
      w.appendChild(el('h4', 'sec-sub', 'What was checked'));
      w.appendChild(checkList(v.checks));
      (v.warnings || []).forEach(function (t) { w.appendChild(el('p', 'ps-note ps-warn', ic('alert') + '<span>' + esc(t) + '</span>')); });
      if (res.report.captured && res.report.captured.length) {
        w.appendChild(el('p', 'sec-small', 'Removed text that was checked for: ' + res.report.captured.length + ' piece' + (res.report.captured.length === 1 ? '' : 's') + '.'));
      }
      if (v.ok) w.appendChild(downloadButton(res.bytes, outName('-redacted'), 'Download the redacted copy'));
      var again = button('btn btn-ghost btn-block', 'Back to the boxes', {});
      again.addEventListener('click', function () { delete SEC.results.redact; render(); });
      w.appendChild(again);
      return w;
    }

    /* ---------- redaction marks on the pages ---------- */

    function addMark(uidv, m) {
      var list = SEC.marks[uidv] = SEC.marks[uidv] || [];
      m.id = 'k' + Math.random().toString(36).slice(2, 9);
      list.push(m);
      refreshMarks();
      return m.id;
    }
    SEC.addMark = addMark;
    SEC.clearMarks = function () { SEC.marks = {}; refreshMarks(); };
    function refreshMarks() { if (PS.refreshOverlays) PS.refreshOverlays(); }

    PS.overlays.security = function (slot, ref, i, p) {
      var list = SEC.marks[ref.uid] || [];
      var size = p._size || PS.refSize(ref);
      var preview = [];
      if (SEC.hits && SEC.hits.matches && SEC.srcUids && S.panel === 'security') {
        SEC.hits.matches.forEach(function (m) { if (m.on && SEC.srcUids[m.page] === ref.uid) preview = preview.concat(m.rects); });
      }
      var key = JSON.stringify([list.map(function (m) { return [m.id, m.x, m.y, m.w, m.h]; }), preview.length, SEC.label, SEC.drawing, size.w, size.h]);
      if (slot._secKey === key) return;
      slot._secKey = key;
      slot.innerHTML = '';
      function pct(v, of) { return (v / of * 100) + '%'; }
      list.forEach(function (m) {
        var b = el('div', 'sec-mark');
        b.style.left = pct(m.x, size.w); b.style.top = pct(m.y, size.h); b.style.width = pct(m.w, size.w); b.style.height = pct(m.h, size.h);
        b.setAttribute('data-mark', m.id);
        if (SEC.label) b.appendChild(el('span', 'sec-mark-l', esc(SEC.label)));
        var x = button('sec-mark-x', ic('cross'), { 'aria-label': 'Remove this box', 'data-mark-x': m.id });
        b.appendChild(x);
        slot.appendChild(b);
      });
      preview.forEach(function (r) {
        var h = el('div', 'sec-hitbox');
        h.style.left = pct(r.x, size.w); h.style.top = pct(r.y, size.h); h.style.width = pct(r.w, size.w); h.style.height = pct(r.h, size.h);
        slot.appendChild(h);
      });
    };

    function setDrawing(on) {
      SEC.drawing = !!on;
      d.body.classList.toggle('sec-drawing', SEC.drawing);
      if (PS.E && PS.E.hint) {
        if (SEC.drawing) { PS.E.hint.hidden = false; PS.E.hint.textContent = 'Drag over anything to hide it. Press Esc or tap Draw boxes again to stop.'; PS.E.hint.setAttribute('data-sec-hint', '1'); }
        else if (PS.E.hint.getAttribute('data-sec-hint')) { PS.E.hint.hidden = true; PS.E.hint.removeAttribute('data-sec-hint'); }
      }
      if (SEC.drawing && PS.isPhone && PS.isPhone() && PS.setSheet) PS.setSheet('half');
      refreshMarks();
    }
    SEC.setDrawing = setDrawing;

    var drag = null;
    d.addEventListener('click', function (e) {
      var x = e.target.closest && e.target.closest('[data-mark-x]');
      if (!x) return;
      e.preventDefault(); e.stopPropagation();
      var id = x.getAttribute('data-mark-x');
      Object.keys(SEC.marks).forEach(function (u) { SEC.marks[u] = SEC.marks[u].filter(function (m) { return m.id !== id; }); if (!SEC.marks[u].length) delete SEC.marks[u]; });
      refreshMarks();
      if (S.panel === 'security') render();
    }, true);
    d.addEventListener('pointerdown', function (e) {
      if (!SEC.drawing || e.button > 0) return;
      if (e.target.closest && e.target.closest('[data-mark-x]')) return;
      var p = e.target.closest && e.target.closest('.pv-page');
      if (!p || !p._size) return;
      e.preventDefault(); e.stopPropagation();
      var pt = PS.pagePoint(p, e);
      var ghost = el('div', 'sec-mark is-ghost');
      p._marks.appendChild(ghost);
      drag = { p: p, uid: p.getAttribute('data-uid'), x0: pt.x, y0: pt.y, ghost: ghost, id: e.pointerId };
      try { p.setPointerCapture(e.pointerId); } catch (err) {}
    }, true);
    d.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault(); e.stopPropagation();
      var pt = PS.pagePoint(drag.p, e), s = drag.p._size;
      var x = Math.max(0, Math.min(drag.x0, pt.x)), y = Math.max(0, Math.min(drag.y0, pt.y));
      var w = Math.min(s.w, Math.max(drag.x0, pt.x)) - x, h = Math.min(s.h, Math.max(drag.y0, pt.y)) - y;
      drag.rect = { x: x, y: y, w: w, h: h };
      var g = drag.ghost.style;
      g.left = (x / s.w * 100) + '%'; g.top = (y / s.h * 100) + '%'; g.width = (w / s.w * 100) + '%'; g.height = (h / s.h * 100) + '%';
    }, true);
    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      if (e) { e.preventDefault(); e.stopPropagation(); }
      var dr = drag; drag = null;
      dr.ghost.remove();
      if (dr.rect && dr.rect.w >= 3 && dr.rect.h >= 3) {
        addMark(dr.uid, { x: dr.rect.x, y: dr.rect.y, w: dr.rect.w, h: dr.rect.h, source: 'draw' });
        if (S.panel === 'security' && SEC.view === 'redact') render();
      }
    }
    d.addEventListener('pointerup', endDrag, true);
    d.addEventListener('pointercancel', endDrag, true);
    global.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && SEC.drawing) { e.stopPropagation(); setDrawing(false); if (S.panel === 'security') render(); }
    }, true);

    /* Boxes drawn here are only a preview until "Redact and verify". Save PDF must not look like it applied them. */
    d.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act="save"]');
      if (!b || !countMarks().boxes || SEC.saveOk) return;
      e.preventDefault(); e.stopPropagation();
      var body = el('div', 'sec-confirm', '<p>' + esc(plural(countMarks().boxes, 'redaction box', 'redaction boxes')) + ' are not applied yet. Save PDF keeps everything under them.</p><p class="ps-note">To remove what is under the boxes, use Redact and verify.</p>');
      PS.dialog({ title: 'Redaction not applied', body: body, ok: 'Redact and verify', cancel: 'Save without removing' }).then(function (ok) {
        if (ok) { PS.openPanel('security'); go('redact'); doRedact(); return; }
        if (d.getElementById('ps-dialog').returnValue === 'cancel') { SEC.saveOk = true; try { PS.save(); } finally { setTimeout(function () { SEC.saveOk = false; }, 0); } }
      });
    }, true);
    var prevSaved = PS.onSaved;
    PS.onSaved = function (x) {
      if (prevSaved) { try { prevSaved(x); } catch (e) {} }
      if (countMarks().boxes && !SEC.saveOk) say('Saved without redaction. Use Protect, then Redact and verify, to remove what is under the boxes.', 6000);
    };

    /* ---------- panel registration and rail tab ---------- */

    PS.panels.security = {
      title: 'Protect', icon: 'shield', tone: 'jade', snap: 'full',
      init: function () {
        var rail = d.getElementById('ps-rail');
        if (!rail || rail.querySelector('[data-panel="security"]')) return;
        var b = d.createElement('button');
        b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false'); b.setAttribute('data-panel', 'security');
        b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + I.shield + '</svg><span>Protect</span>';
        var before = rail.querySelector('[data-panel="convert"]');
        rail.insertBefore(b, before || null);
        b.addEventListener('click', function (e) {
          if (S.pages.length) return;
          e.preventDefault(); e.stopPropagation();
          PS.pickFiles('.pdf,application/pdf', false).then(function (files) { if (files.length) PS.addFiles(files, { panel: 'security' }); });
        }, true);
      },
      build: function (pane) {
        SEC.pane = pane;
        pane.classList.add('sec-pane');
        pane.addEventListener('click', function (e) {
          var b = e.target.closest('[data-sec]');
          if (!b) return;
          go(b.getAttribute('data-sec'));
        });
      },
      show: function () { render(); },
      hide: function () { if (SEC.drawing) setDrawing(false); refreshMarks(); }
    };
    /* The studio may have booted before this deferred script ran; add the tab now if so (init is idempotent). */
    if (d.getElementById('ps-rail')) PS.panels.security.init();
  })();

})(window);
