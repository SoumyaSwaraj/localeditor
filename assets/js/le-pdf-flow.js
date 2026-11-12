/* LocalEditor text PDF writer (QA-010). Flows sanitised HTML onto PDF pages as real, selectable text in embedded,
   subsetted fonts: headings, paragraphs with inline styles, lists, quotes, code, tables, images, links and an outline.
   The HTML is only parsed (DOMParser gives an inert document: nothing runs, nothing loads). Callers still pass it
   through DOMPurify first. Faces: Plus Jakarta Sans (sans), Lora (serif), JetBrains Mono (mono), Manrope for Greek and
   Cyrillic the main face lacks. Scripts that need shaping (Arabic, Hebrew, Indic, Thai, CJK ...) are reported by
   scriptsIn() so the caller can save those documents as pictures instead. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var d = global.document;

  var PAGE = { A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224] };
  var LIMIT = { nodes: 300000, depth: 40, pages: 3000, cells: 80000, cols: 64, images: 300, imagePixels: 36e6, textChars: 6e6 };
  var PX = 0.75; /* CSS px → pt */

  var FACES = {
    sans: { family: 'Plus Jakarta Sans', slug: 'plus-jakarta-sans', italic: false, std: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
    serif: { family: 'Lora', slug: 'lora', italic: true, std: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
    mono: { family: 'JetBrains Mono', slug: 'jetbrains-mono', italic: false, std: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
    uni: { family: 'Manrope', slug: 'manrope', italic: false, std: null }
  };

  var SCRIPTS = [
    ['Arabic', /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/],
    ['Hebrew', /[\u0590-\u05FF\uFB1D-\uFB4F]/],
    ['Syriac', /[\u0700-\u074F]/],
    ['Thaana', /[\u0780-\u07BF]/],
    ['Devanagari', /[\u0900-\u097F]/],
    ['Bengali', /[\u0980-\u09FF]/],
    ['Gurmukhi', /[\u0A00-\u0A7F]/],
    ['Gujarati', /[\u0A80-\u0AFF]/],
    ['Oriya', /[\u0B00-\u0B7F]/],
    ['Tamil', /[\u0B80-\u0BFF]/],
    ['Telugu', /[\u0C00-\u0C7F]/],
    ['Kannada', /[\u0C80-\u0CFF]/],
    ['Malayalam', /[\u0D00-\u0D7F]/],
    ['Sinhala', /[\u0D80-\u0DFF]/],
    ['Thai', /[\u0E00-\u0E7F]/],
    ['Lao', /[\u0E80-\u0EFF]/],
    ['Tibetan', /[\u0F00-\u0FFF]/],
    ['Myanmar', /[\u1000-\u109F]/],
    ['Georgian', /[\u10A0-\u10FF]/],
    ['Hangul', /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/],
    ['Ethiopic', /[\u1200-\u139F]/],
    ['Khmer', /[\u1780-\u17FF]/],
    ['Armenian', /[\u0530-\u058F]/],
    ['Chinese/Japanese', /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/]
  ];
  var SUPPORTED_SCRIPTS = ['Latin (with Vietnamese)', 'Greek', 'Cyrillic'];

  /* ---------------------------------------------------------------- utilities */

  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function asset(path) {
    var root = '';
    try { root = d.documentElement.getAttribute('data-root') || ''; } catch (e) { root = ''; }
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root + path;
  }
  var loads = {};
  function loadScript(src) {
    if (LE.lazy) return Promise.resolve(LE.lazy(src));
    if (loads[src]) return loads[src];
    loads[src] = new Promise(function (resolve, reject) {
      var s = d.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { loads[src] = null; reject(new Error('Could not load ' + src)); };
      d.head.appendChild(s);
    });
    return loads[src];
  }
  function ready() {
    var jobs = [];
    if (!(global.PDFLib && global.PDFLib.PDFDocument)) jobs.push(loadScript(asset('assets/vendor/pdf-lib.min.js')));
    return Promise.all(jobs).then(function () {
      if (global.fontkit) return;
      return loadScript(asset('assets/vendor/fontkit.umd.min.js')).catch(function () {});
    });
  }
  function cancelled() { var e = new Error('Cancelled'); e.cancelled = true; return e; }
  function checkCancel(opts) {
    if (opts && ((opts.signal && opts.signal.aborted) || (typeof opts.isCancelled === 'function' && opts.isCancelled()))) throw cancelled();
  }

  /* ---------------------------------------------------------------- colours and lengths */

  var NAMED = {
    black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', gray: '808080', grey: '808080', silver: 'c0c0c0',
    maroon: '800000', navy: '000080', teal: '008080', olive: '808000', purple: '800080', orange: 'ffa500', yellow: 'ffff00',
    lime: '00ff00', aqua: '00ffff', cyan: '00ffff', fuchsia: 'ff00ff', magenta: 'ff00ff', brown: 'a52a2a', pink: 'ffc0cb',
    darkred: '8b0000', darkblue: '00008b', darkgreen: '006400', darkgray: 'a9a9a9', darkgrey: 'a9a9a9', lightgray: 'd3d3d3',
    lightgrey: 'd3d3d3', gold: 'ffd700', indigo: '4b0082', violet: 'ee82ee', crimson: 'dc143c', dimgray: '696969', dimgrey: '696969',
    whitesmoke: 'f5f5f5', gainsboro: 'dcdcdc', beige: 'f5f5dc', ivory: 'fffff0', lightyellow: 'ffffe0', lightblue: 'add8e6',
    lightgreen: '90ee90', salmon: 'fa8072', tomato: 'ff6347', coral: 'ff7f50', steelblue: '4682b4', slategray: '708090', slategrey: '708090'
  };
  function parseColor(v) {
    if (!v) return null;
    v = String(v).trim().toLowerCase();
    if (v === 'transparent' || v === 'inherit' || v === 'initial' || v === 'currentcolor' || v === 'none') return null;
    var hex = NAMED[v] || null;
    var m;
    if (!hex && (m = /^#([0-9a-f]{3,8})$/.exec(v))) {
      hex = m[1];
      if (hex.length === 3 || hex.length === 4) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
      hex = hex.slice(0, 6);
      if (hex.length !== 6) return null;
    }
    if (hex) return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
    if ((m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v))) {
      if (m[4] != null && parseFloat(m[4]) === 0) return null;
      return [1, 2, 3].map(function (i) { var s = m[i]; var n = parseFloat(s); return clamp(/%$/.test(s) ? n / 100 : n / 255, 0, 1); });
    }
    return null;
  }
  function luminance(c) { return c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : 0; }
  /* A length in pt. pct is resolved against `rel` when given; em against `em`. */
  function parseLen(v, em, rel) {
    if (v == null) return null;
    var m = /^\s*(-?[\d.]+)\s*(px|pt|em|rem|%|cm|mm|in|pc)?\s*$/i.exec(String(v));
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (!isFinite(n)) return null;
    var u = (m[2] || 'px').toLowerCase();
    if (u === 'px') return n * PX;
    if (u === 'pt') return n;
    if (u === 'em' || u === 'rem') return n * (em || 10.5);
    if (u === '%') return rel != null ? n / 100 * rel : null;
    if (u === 'cm') return n * 72 / 2.54;
    if (u === 'mm') return n * 72 / 25.4;
    if (u === 'in') return n * 72;
    if (u === 'pc') return n * 12;
    return null;
  }
  function pctOf(v) { var m = /^\s*([\d.]+)\s*%\s*$/.exec(String(v || '')); return m ? clamp(parseFloat(m[1]) / 100, 0, 1) : null; }
  function cssMap(style) {
    var out = {};
    if (!style) return out;
    String(style).split(';').forEach(function (decl) {
      var i = decl.indexOf(':');
      if (i < 1) return;
      var k = decl.slice(0, i).trim().toLowerCase();
      var v = decl.slice(i + 1).trim().replace(/\s*!important\s*$/i, '');
      if (k && v && v.length < 200 && !/url\(|expression|javascript:/i.test(v)) out[k] = v;
    });
    return out;
  }

  /* ---------------------------------------------------------------- scripts */

  function scriptsIn(text) {
    var s = String(text || '');
    var bad = [];
    SCRIPTS.forEach(function (pair) { if (pair[1].test(s)) bad.push(pair[0]); });
    var used = ['Latin'];
    if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(s)) used.push('Greek');
    if (/[\u0400-\u04FF]/.test(s)) used.push('Cyrillic');
    return { unsupported: bad, used: used };
  }

  /* ---------------------------------------------------------------- fonts */

  function fontUrl(slug, weight, italic) {
    return asset('assets/fonts/library/' + slug + '/' + slug + '-' + weight + (italic ? '-italic' : '') + '.woff');
  }
  var byteCache = {};
  function fontBytes(face, weight, italic) {
    var key = face.slug + weight + (italic ? 'i' : '');
    if (byteCache[key]) return byteCache[key];
    var job;
    if (LE.fonts && typeof LE.fonts.bytes === 'function') {
      job = Promise.resolve().then(function () { return LE.fonts.bytes(face.family, weight, italic); }).catch(function () { return null; });
    } else job = Promise.resolve(null);
    byteCache[key] = job.then(function (buf) {
      if (buf && (buf.byteLength || buf.length)) return new Uint8Array(buf);
      return fetch(fontUrl(face.slug, weight, italic)).then(function (r) {
        if (!r.ok) throw new Error('font ' + r.status);
        return r.arrayBuffer();
      }).then(function (b) { return new Uint8Array(b); });
    });
    byteCache[key].catch(function () { delete byteCache[key]; });
    return byteCache[key];
  }

  /* One embedded face: { font (pdf-lib), fk (fontkit font, for coverage), asc, desc, skew, std } */
  function FontBox(doc) {
    this.doc = doc;
    this.faces = {};
    this.jobs = {};
    this.widths = new Map();
    this.std = false;
    this.used = {};
  }
  FontBox.prototype.key = function (fam, bold, italic) { return fam + (bold ? 'B' : '') + (italic ? 'I' : ''); };
  /* Loads (if needed) the face for fam/bold/italic. Italic without a real italic file is drawn with an oblique skew. */
  FontBox.prototype.load = function (fam, bold, italic) {
    var self = this;
    var k = this.key(fam, bold, italic);
    if (this.jobs[k]) return this.jobs[k];
    var face = FACES[fam] || FACES.sans;
    var realItalic = italic && face.italic && !bold;
    var weight = bold ? 700 : 400;
    var lib = global.PDFLib;
    var job;
    if (this.std || !global.fontkit) job = Promise.reject(new Error('standard'));
    else {
      job = fontBytes(face, weight, realItalic).then(function (bytes) {
        if (!self.doc.__flowKit) { self.doc.registerFontkit(global.fontkit); self.doc.__flowKit = true; }
        var fk = global.fontkit.create(bytes);
        /* programming ligatures (calt) in the mono face trip a fontkit bug; plain glyphs are also what code needs */
        var features = fam === 'mono' ? { calt: false, liga: false, clig: false, dlig: false } : undefined;
        return self.doc.embedFont(bytes, { subset: true, features: features }).then(function (font) {
          return {
            font: font, fk: fk, std: false, name: face.family + (bold ? ' Bold' : '') + (italic ? ' Italic' : ''),
            asc: fk.ascent / fk.unitsPerEm, desc: -fk.descent / fk.unitsPerEm,
            skew: italic && !realItalic
          };
        });
      });
    }
    this.jobs[k] = job.catch(function () {
      if (!face.std) return null;
      var idx = (bold ? 1 : 0) + (italic ? 2 : 0);
      if (idx === 3 && !face.std[3]) idx = 1;
      return self.doc.embedFont(lib.StandardFonts[face.std[idx]]).then(function (font) {
        return { font: font, fk: null, std: true, name: face.std[idx], asc: 0.76, desc: 0.24, skew: false };
      });
    }).then(function (f) { self.faces[k] = f; return f; });
    return this.jobs[k];
  };
  FontBox.prototype.get = function (fam, bold, italic) { return this.faces[this.key(fam, bold, italic)] || null; };
  FontBox.prototype.covers = function (f, cp) {
    if (!f) return false;
    if (f.fk) return f.fk.hasGlyphForCodePoint(cp);
    if (cp < 0x20) return false;
    try { f.font.encodeText(String.fromCodePoint(cp)); return true; } catch (e) { return false; }
  };
  FontBox.prototype.width = function (f, text, size) {
    if (!text) return 0;
    var k = f.name + '|' + text;
    var w = this.widths.get(k);
    if (w == null) {
      try { w = f.font.widthOfTextAtSize(text, 1000) / 1000; }
      catch (e) {
        w = 0;
        Array.from(text).forEach(function (ch) { try { w += f.font.widthOfTextAtSize(ch, 1000) / 1000; } catch (e2) { w += 0.55; } });
      }
      if (this.widths.size > 200000) this.widths.clear();
      this.widths.set(k, w);
    }
    return w * size;
  };

  /* ---------------------------------------------------------------- DOM → block tree */

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, SOURCE: 1, TRACK: 1, MAP: 1, AREA: 1, HEAD: 1, TITLE: 1, META: 1, LINK: 1, BUTTON: 1, SELECT: 1, OPTION: 1, TEXTAREA: 1, INPUT: 1, FORM: 0, SVG: 1, MATH: 0, DIALOG: 1, FRAME: 1, FRAMESET: 1, APPLET: 1, BASE: 1, PARAM: 1, PICTURE: 0 };
  var BLOCK = { P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, MAIN: 1, ASIDE: 1, NAV: 1, FIGURE: 1, FIGCAPTION: 1, CENTER: 1, ADDRESS: 1, DETAILS: 1, SUMMARY: 1, DL: 1, DT: 1, DD: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, TABLE: 1, HR: 1, BODY: 1, HTML: 1, FORM: 1, FIELDSET: 1, LEGEND: 1, HGROUP: 1, MENU: 1, CAPTION: 1, TBODY: 1, THEAD: 1, TFOOT: 1, TR: 1, TD: 1, TH: 1, PICTURE: 0 };

  function Builder(opts, warn) {
    this.opts = opts;
    this.warn = warn;
    this.nodes = 0;
    this.chars = 0;
    this.images = [];
    this.imageMap = {};
    this.ids = {};
    this.title = '';
    this.truncated = false;
    this.cells = 0;
    this.combos = {};
    this.text = [];
  }
  Builder.prototype.baseStyle = function () {
    var o = this.opts;
    return { fam: o.base === 'serif' ? 'serif' : 'sans', b: false, i: false, u: false, s: false, size: o.fontSize, color: o.color || [0.1, 0.1, 0.12], href: null, rise: 0, bg: null, code: false, pre: false };
  };
  function inherit(st) { var n = {}; for (var k in st) n[k] = st[k]; return n; }
  Builder.prototype.applyCss = function (st, css, el) {
    var c;
    if (css.color && (c = parseColor(css.color))) st.color = c;
    if (css['font-weight']) { var fw = css['font-weight']; st.b = fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600; }
    if (css['font-style']) st.i = /italic|oblique/.test(css['font-style']);
    var deco = css['text-decoration'] || css['text-decoration-line'];
    if (deco) { st.u = /underline/.test(deco); st.s = /line-through/.test(deco); }
    if (css['font-size']) {
      var fs = css['font-size'];
      var kw = { 'xx-small': 0.6, 'x-small': 0.75, small: 0.89, medium: 1, large: 1.2, 'x-large': 1.5, 'xx-large': 2, smaller: 0.83, larger: 1.2 };
      var abs = /(pt|px|cm|mm|in|pc)\s*$/i.test(fs);
      var pt = kw[fs] ? kw[fs] * (/er$/.test(fs) ? st.size : this.opts.fontSize) : parseLen(fs, st.size, st.size);
      if (pt) st.size = clamp(abs ? pt * this.opts.scale : pt, 5, 72);
    }
    if (css['font-family']) st.fam = famOf(css['font-family'], st.fam);
    if (css['background-color'] || css.background) {
      c = parseColor(css['background-color'] || (css.background || '').split(/\s+/)[0]);
      if (c && luminance(c) < 0.985) st.bg = c;
    }
    if (css['vertical-align'] === 'super') st.rise = 1;
    else if (css['vertical-align'] === 'sub') st.rise = -1;
    if (el && el.getAttribute && el.tagName === 'FONT') {
      var fc = parseColor(el.getAttribute('color'));
      if (fc) st.color = fc;
      if (el.getAttribute('face')) st.fam = famOf(el.getAttribute('face'), st.fam);
    }
    /* never draw text the reader cannot see: very light text on the white page is darkened */
    if (luminance(st.color) > 0.93 && !st.bg && !(st.canvas && luminance(st.canvas) < 0.75)) st.color = [0.55, 0.55, 0.55];
    return st;
  };
  function famOf(v, cur) {
    v = String(v || '').toLowerCase();
    if (/mono|courier|consolas|menlo|monaco|code|terminal|fixed/.test(v)) return 'mono';
    if (/(^|[\s,"'])(serif|times|georgia|cambria|garamond|palatino|book antiqua|baskerville|lora|merriweather|didot|bodoni|minion|charter|constantia|century)/.test(v) && !/sans/.test(v.split(',')[0])) return 'serif';
    if (/sans|arial|helvetica|calibri|verdana|tahoma|segoe|aptos|inter|roboto|open sans|lato|system-ui/.test(v)) return 'sans';
    return cur;
  }

  /* inline element → style changes */
  Builder.prototype.inlineStyle = function (el, st) {
    var t = el.tagName;
    var n = inherit(st);
    if (t === 'B' || t === 'STRONG') n.b = true;
    else if (t === 'I' || t === 'EM' || t === 'CITE' || t === 'VAR' || t === 'DFN') n.i = true;
    else if (t === 'U' || t === 'INS') n.u = true;
    else if (t === 'S' || t === 'STRIKE' || t === 'DEL') n.s = true;
    else if (t === 'CODE' || t === 'KBD' || t === 'SAMP' || t === 'TT') { n.fam = 'mono'; n.code = !st.pre; n.size = st.size * (st.pre ? 1 : 0.9); }
    else if (t === 'SUP') { n.rise = 1; }
    else if (t === 'SUB') { n.rise = -1; }
    else if (t === 'SMALL') n.size = st.size * 0.85;
    else if (t === 'BIG') n.size = st.size * 1.15;
    else if (t === 'MARK') n.bg = [1, 0.94, 0.55];
    else if (t === 'A') {
      var href = safeHref(el.getAttribute('href') || el.getAttribute('data-le-href'));
      if (href) { n.href = href; n.color = [0.1, 0.32, 0.75]; n.u = true; }
    }
    this.applyCss(n, cssMap(el.getAttribute('style')), el);
    return n;
  };
  function safeHref(h) {
    if (!h) return null;
    h = String(h).trim();
    if (/^#[^\s]{1,200}$/.test(h)) return h;
    if (/^(https?:\/\/|mailto:|tel:)[^\s<>"]{1,2000}$/i.test(h)) return h;
    return null;
  }

  /* collects inline runs into a paragraph; flushes when a block starts */
  Builder.prototype.walkChildren = function (el, st, out, para, depth) {
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) {
      if (this.nodes++ > LIMIT.nodes) { this.truncated = true; return; }
      this.walk(kids[i], st, out, para, depth + 1);
    }
  };
  function newPara(st, extra) {
    var p = { t: 'p', runs: [], align: 'left', indent: 0, first: 0, sb: 0, sa: st.size * 0.62, lh: 1.42, kwn: false, level: 0, bar: null, ids: [] };
    for (var k in extra) p[k] = extra[k];
    return p;
  }
  Builder.prototype.flush = function (out, para) {
    if (!para.cur) return;
    var p = para.cur;
    para.cur = null;
    var has = p.runs.some(function (r) { return r.img || r.br || (r.text && /\S/.test(r.text)); });
    if (!has) {
      if (p.ids.length) out.push({ t: 'anchor', ids: p.ids });
      return;
    }
    while (p.runs.length && p.runs[p.runs.length - 1].br) p.runs.pop();
    out.push(p);
  };
  Builder.prototype.paraFor = function (out, para, st) {
    if (!para.cur) para.cur = newPara(st, para.defaults || {});
    return para.cur;
  };
  Builder.prototype.addText = function (text, st, out, para) {
    if (!text) return;
    if (this.chars > LIMIT.textChars) { this.truncated = true; return; }
    if (!st.pre) {
      text = text.replace(/[\t\n\r\f ]+/g, ' ');
      var p0 = para.cur;
      var last = p0 && p0.runs.length ? p0.runs[p0.runs.length - 1] : null;
      if ((!p0 || !p0.runs.length || (last && last.br) || (last && / $/.test(last.text || ''))) && text.charAt(0) === ' ') text = text.slice(1);
      if (!text) return;
    }
    this.chars += text.length;
    this.text.push(text);
    var p = this.paraFor(out, para, st);
    var r = { text: text, st: st };
    var prev = p.runs[p.runs.length - 1];
    if (prev && prev.st === st && !prev.br && prev.text != null) prev.text += text;
    else p.runs.push(r);
    this.combos[st.fam + (st.b ? 'B' : '') + (st.i ? 'I' : '')] = [st.fam, st.b, st.i];
  };
  Builder.prototype.blockCss = function (el, st, blk) {
    var css = cssMap(el.getAttribute && el.getAttribute('style'));
    var al = css['text-align'] || (el.getAttribute && el.getAttribute('align'));
    if (al) {
      al = String(al).toLowerCase();
      if (al === 'center' || al === 'right' || al === 'justify' || al === 'left') blk.align = al;
      else if (al === 'start') blk.align = 'left';
      else if (al === 'end') blk.align = 'right';
    }
    var ml = parseLen(css['margin-left'] || css['padding-left'], st.size);
    if (ml && ml > 0) blk.indent = (blk.indent || 0) + clamp(ml, 0, 200);
    var ti = parseLen(css['text-indent'], st.size);
    if (ti) blk.first = clamp(ti, -60, 120);
    if (/always|page/.test(css['page-break-before'] || css['break-before'] || '')) blk.pb = true;
    if (/always|page/.test(css['page-break-after'] || css['break-after'] || '')) blk.pa = true;
    var lh = css['line-height'];
    if (lh) { var l = /^[\d.]+$/.test(lh) ? parseFloat(lh) : (parseLen(lh, st.size) || 0) / st.size; if (l > 0.8 && l < 3.5) blk.lh = l; }
    return css;
  };

  Builder.prototype.walk = function (node, st, out, para, depth) {
    if (node.nodeType === 3) { this.addText(node.nodeValue, st, out, para); return; }
    if (node.nodeType !== 1) return;
    var el = node;
    var t = el.tagName.toUpperCase();
    if (SKIP[t] === 1) {
      if (t === 'TITLE' && !this.title) this.title = (el.textContent || '').trim().slice(0, 200);
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') {
        var v = t === 'SELECT' ? ((el.querySelector('option[selected]') || el.querySelector('option') || {}).textContent || '') : (t === 'TEXTAREA' ? el.textContent : el.getAttribute('value'));
        var ty = (el.getAttribute('type') || '').toLowerCase();
        if (ty === 'checkbox' || ty === 'radio') v = el.hasAttribute('checked') ? '[x] ' : '[ ] ';
        else if (ty === 'hidden' || ty === 'password' || ty === 'submit' || ty === 'button' || ty === 'image' || ty === 'file') v = '';
        if (v) this.addText(String(v).slice(0, 2000) + ' ', st, out, para);
      }
      if (t === 'SVG') this.warn('svg', 'Drawings made with SVG inside the page are left out.');
      return;
    }
    var css = cssMap(el.getAttribute('style'));
    if (css.display === 'none' || el.hasAttribute('hidden') || css.visibility === 'hidden') return;
    var id = el.getAttribute('id') || (t === 'A' ? el.getAttribute('name') : null);
    if (id && /^[^\s]{1,120}$/.test(id) && !this.ids[id]) {
      this.ids[id] = 1;
      if (BLOCK[t] === 1) para.pendingId = (para.pendingId || []).concat([id]);
      else this.paraFor(out, para, st).ids.push(id);
    }
    if (depth > LIMIT.depth) {
      this.warn('deep', 'Very deeply nested parts were flattened into plain paragraphs.');
      this.addText(' ' + (el.textContent || '').slice(0, 20000) + ' ', st, out, para);
      return;
    }
    if (t === 'BR') { var p = this.paraFor(out, para, st); p.runs.push({ br: true, st: st }); return; }
    if (t === 'WBR') { this.addText('\u200B', st, out, para); return; }
    if (t === 'IMG') { this.image(el, st, out, para); return; }
    if (t === 'Q') { this.addText('“', st, out, para); this.walkChildren(el, this.inlineStyle(el, st), out, para, depth); this.addText('”', st, out, para); return; }
    if (BLOCK[t] !== 1) {
      if (t === 'A' && el.getAttribute('href') && !safeHref(el.getAttribute('href')) && !el.getAttribute('data-le-href')) this.warn('href', 'Links that are not web, email or phone links were kept as plain text.');
      this.walkChildren(el, this.inlineStyle(el, st), out, para, depth);
      return;
    }
    /* block */
    this.flush(out, para);
    var ids = para.pendingId || [];
    para.pendingId = null;
    var start = out.length;
    this.block(el, t, st, out, para, depth);
    if (ids.length) {
      if (out[start]) out[start].ids = (out[start].ids || []).concat(ids);
      else out.push({ t: 'anchor', ids: ids });
    }
  };

  Builder.prototype.blocksOf = function (el, st, depth, defaults) {
    var out = [];
    var para = { cur: null, defaults: defaults || null };
    this.walkChildren(el, st, out, para, depth);
    this.flush(out, para);
    return out;
  };

  var H_SIZES = [0, 1.95, 1.55, 1.28, 1.12, 1.0, 0.92];
  Builder.prototype.block = function (el, t, st, out, para, depth) {
    var self = this;
    var o = this.opts;
    var css;
    if (t === 'HR') {
      if (/page-?break/i.test(el.getAttribute('class') || '') || /always|page/.test(cssMap(el.getAttribute('style'))['page-break-after'] || '')) out.push({ t: 'pb' });
      else out.push({ t: 'hr' });
      return;
    }
    if (/^H[1-6]$/.test(t)) {
      var lvl = +t.charAt(1);
      var hs = inherit(st);
      hs.b = lvl <= 4 || st.b;
      hs.size = st.size * H_SIZES[lvl];
      if (lvl === 6) { hs.color = [0.33, 0.33, 0.36]; }
      else hs.color = [0.07, 0.07, 0.09];
      hs = this.applyCss(hs, cssMap(el.getAttribute('style')), el);
      var hp = { cur: null, defaults: { level: lvl, kwn: true, sb: hs.size * (lvl <= 2 ? 1.0 : 0.85), sa: hs.size * (lvl <= 2 ? 0.42 : 0.35), lh: 1.25 } };
      this.blockCss(el, hs, hp.defaults);
      this.walkChildren(el, hs, out, hp, depth);
      if (!hp.cur) hp.cur = newPara(hs, hp.defaults);
      var title = (el.textContent || '').replace(/\s+/g, ' ').trim();
      hp.cur.outline = title.slice(0, 200);
      if (lvl === 1 && !this.title) this.title = hp.cur.outline;
      this.flush(out, hp);
      return;
    }
    if (t === 'UL' || t === 'OL' || t === 'MENU') {
      var ordered = t === 'OL';
      var startN = ordered && el.getAttribute('start') != null ? num(el.getAttribute('start'), 1) : 1;
      var type = ordered ? (el.getAttribute('type') || cssMap(el.getAttribute('style'))['list-style-type'] || '1') : (cssMap(el.getAttribute('style'))['list-style-type'] || '');
      var items = [];
      var lst = this.applyCss(inherit(st), cssMap(el.getAttribute('style')), el);
      var stray = [];
      [].forEach.call(el.childNodes, function (k) {
        if (k.nodeType === 1 && k.tagName === 'LI') {
          if (stray.length) { items.push({ blocks: self.blocksFromNodes(stray, lst, depth + 1), value: null, plain: true }); stray = []; }
          var v = k.getAttribute('value');
          var lcss = cssMap(k.getAttribute('style'));
          var ist = self.applyCss(inherit(lst), lcss, k);
          items.push({ blocks: self.blocksOf(k, ist, depth + 1, null), value: v != null && /^-?\d+$/.test(v) ? +v : null, ids: k.id ? [k.id] : [] });
        } else if (k.nodeType === 1 || (k.nodeType === 3 && /\S/.test(k.nodeValue))) stray.push(k);
      });
      if (stray.length) items.push({ blocks: this.blocksFromNodes(stray, lst, depth + 1), plain: true });
      out.push({ t: 'list', ordered: ordered, start: startN, type: String(type).trim(), items: items, size: lst.size, color: lst.color, fam: lst.fam, nested: depth });
      return;
    }
    if (t === 'BLOCKQUOTE') {
      var qs = inherit(st);
      qs.color = [0.25, 0.25, 0.3];
      this.applyCss(qs, cssMap(el.getAttribute('style')), el);
      out.push({ t: 'quote', blocks: this.blocksOf(el, qs, depth + 1) });
      return;
    }
    if (t === 'PRE') {
      var ps = inherit(st);
      ps.fam = 'mono';
      ps.pre = true;
      ps.size = st.size * 0.86;
      this.applyCss(ps, cssMap(el.getAttribute('style')), el);
      if (ps.fam !== 'mono') ps.fam = 'mono';
      var pp = { cur: null, defaults: { lh: 1.38, sa: 0 } };
      var preOut = [];
      this.walkChildren(el, ps, preOut, pp, depth);
      var runs = pp.cur ? pp.cur.runs : [];
      out.push({ t: 'pre', runs: runs, st: ps });
      return;
    }
    if (t === 'TABLE') { this.table(el, st, out, depth); return; }
    if (t === 'DL') {
      [].forEach.call(el.children, function (k) {
        if (k.tagName === 'DT') {
          var ds = inherit(st); ds.b = true;
          self.blocksOf(k, ds, depth + 1, { kwn: true, sa: st.size * 0.15 }).forEach(function (b) { out.push(b); });
        } else if (k.tagName === 'DD') {
          self.blocksOf(k, st, depth + 1, null).forEach(function (b) { if (b.t === 'p') b.indent = (b.indent || 0) + 18; out.push(b.t === 'p' ? b : { t: 'quote', blocks: [b], plain: true }); });
        } else self.blocksOf(k, st, depth + 1, null).forEach(function (b) { out.push(b); });
      });
      return;
    }
    /* generic container: p, div, section, figure, li-like, td fallbacks ... */
    var bs = this.applyCss(inherit(st), cssMap(el.getAttribute('style')), el);
    var defaults = {};
    if (t === 'FIGCAPTION' || t === 'CAPTION') { bs.size = st.size * 0.88; bs.color = [0.35, 0.35, 0.4]; defaults.align = 'center'; defaults.caption = true; }
    if (t === 'CENTER' || t === 'FIGURE') defaults.align = 'center';
    if (t === 'ADDRESS') bs.i = true;
    if (t === 'SUMMARY' || t === 'LEGEND') bs.b = true;
    css = this.blockCss(el, bs, defaults);
    if (t !== 'P' && para.defaults && para.defaults.align && !defaults.align) defaults.align = para.defaults.align;
    if (t === 'P' || t === 'FIGCAPTION' || t === 'SUMMARY' || t === 'LEGEND' || t === 'DT') {
      var ip = { cur: null, defaults: defaults };
      var at = out.length;
      this.walkChildren(el, bs, out, ip, depth);
      var pend = ip.pendingId;
      this.flush(out, ip);
      if (pend) out.push({ t: 'anchor', ids: pend });
      if (defaults.pa) out.push({ t: 'pb' });
      if (defaults.pb) out.splice(at, 0, { t: 'pb' });
      return;
    }
    var bg = parseColor(css['background-color'] || (css.background || '').split(/\s+/)[0]);
    var border = /solid|dashed|dotted|double/.test(css.border || css['border-left'] || '') ? parseColor(((css.border || css['border-left']).match(/#[0-9a-f]{3,6}|rgb\([^)]*\)|[a-z]+$/i) || [])[0]) || [0.75, 0.75, 0.75] : null;
    var inner = this.blocksOf(el, bs, depth + 1, defaults.align || defaults.indent ? { align: defaults.align || 'left', indent: defaults.indent || 0 } : null);
    if (defaults.pb) out.push({ t: 'pb' });
    if ((bg && luminance(bg) < 0.985) || border) {
      out.push({ t: 'box', blocks: inner, bg: bg && luminance(bg) < 0.985 ? bg : null, border: border, pad: parseLen(css.padding, bs.size) || 6 });
    } else {
      inner.forEach(function (b) { out.push(b); });
    }
    if (defaults.pa) out.push({ t: 'pb' });
  };
  Builder.prototype.blocksFromNodes = function (nodes, st, depth) {
    var out = [];
    var para = { cur: null };
    for (var i = 0; i < nodes.length; i++) this.walk(nodes[i], st, out, para, depth);
    this.flush(out, para);
    return out;
  };

  Builder.prototype.image = function (el, st, out, para) {
    var src = el.getAttribute('src') || '';
    if (!/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml)[;,]/i.test(src)) {
      if (src) this.warn('img-remote', 'Images that are not inside the file were left out (nothing is fetched from the internet).');
      var alt = (el.getAttribute('alt') || '').trim();
      if (alt) this.addText('[' + alt.slice(0, 200) + '] ', st, out, para);
      return;
    }
    if (this.images.length >= LIMIT.images && !this.imageMap[src]) { this.warn('img-many', 'Only the first ' + LIMIT.images + ' images are included.'); return; }
    var css = cssMap(el.getAttribute('style'));
    var w = parseLen(css.width || el.getAttribute('width'), st.size);
    var h = parseLen(css.height || el.getAttribute('height'), st.size);
    var pct = pctOf(css.width || el.getAttribute('width'));
    var key = this.imageMap[src];
    if (key == null) { key = this.images.length; this.imageMap[src] = key; this.images.push({ src: src }); }
    var blk = { t: 'img', key: key, w: w, h: h, pct: pct, alt: (el.getAttribute('alt') || '').slice(0, 300), align: (para.cur && para.cur.align) || (para.defaults && para.defaults.align) || 'left' };
    /* an image interrupts the paragraph and stands on its own line; tiny inline icons are skipped */
    if (w && h && w <= 14 && h <= 14) return;
    var saved = para.cur;
    this.flush(out, para);
    if (saved && saved.align) blk.align = saved.align;
    out.push(blk);
  };

  Builder.prototype.table = function (el, st, out, depth) {
    var self = this;
    var tcss = cssMap(el.getAttribute('style'));
    var rows = [];
    var caption = null;
    var borderAttr = el.getAttribute('border');
    var borders = borderAttr == null ? !/none|hidden/.test(tcss.border || '') : borderAttr !== '0';
    if (/border-collapse/.test(el.getAttribute('style') || '') && /none/.test(tcss.border || '')) borders = false;
    var tableAlign = el.getAttribute('align');
    function addRow(tr, head) {
      if (rows.length > 20000) return;
      var cells = [];
      var rcss = cssMap(tr.getAttribute('style'));
      var rbg = parseColor(rcss['background-color'] || tr.getAttribute('bgcolor'));
      [].forEach.call(tr.children, function (td) {
        if (td.tagName !== 'TD' && td.tagName !== 'TH') return;
        if (self.cells++ > LIMIT.cells) { self.truncated = true; self.warn('cells', 'Very large tables were cut short.'); return; }
        var ccss = cssMap(td.getAttribute('style'));
        var cs = inherit(st);
        if (td.tagName === 'TH') cs.b = true;
        var cellBg = parseColor(ccss['background-color'] || td.getAttribute('bgcolor')) || rbg;
        if (cellBg) cs.canvas = cellBg; /* light text on a dark cell stays light */
        self.applyCss(cs, ccss, td);
        var align = (ccss['text-align'] || td.getAttribute('align') || '').toLowerCase();
        var defaults = /^(left|right|center|justify)$/.test(align) ? { align: align } : null;
        var blocks = self.blocksOf(td, cs, depth + 1, defaults);
        blocks.forEach(function (b) { if (b.t === 'p') { b.sa = Math.min(b.sa, cs.size * 0.3); b.sb = 0; } });
        var bg = cellBg;
        cells.push({
          blocks: blocks, th: td.tagName === 'TH',
          colspan: clamp(Math.round(num(td.getAttribute('colspan'), 1)), 1, LIMIT.cols),
          rowspan: clamp(Math.round(num(td.getAttribute('rowspan'), 1)), 1, 500),
          bg: bg && luminance(bg) < 0.99 ? bg : null,
          valign: (ccss['vertical-align'] || td.getAttribute('valign') || 'top').toLowerCase(),
          width: parseLen(ccss.width || td.getAttribute('width'), cs.size), pct: pctOf(ccss.width || td.getAttribute('width')),
          pad: ccss.padding != null ? parseLen(ccss.padding.split(/\s+/)[0], cs.size) : null,
          noBorder: /none|hidden|^0/.test(ccss.border || '')
        });
      });
      if (cells.length) rows.push({ cells: cells, head: head });
    }
    function walkRows(parent, head) {
      [].forEach.call(parent.children, function (k) {
        var tn = k.tagName;
        if (tn === 'CAPTION') { var cst = inherit(st); cst.size = st.size * 0.9; cst.color = [0.3, 0.3, 0.35]; cst.i = true; caption = self.blocksOf(k, cst, depth + 1, { align: 'left' }); }
        else if (tn === 'THEAD') walkRows(k, true);
        else if (tn === 'TBODY' || tn === 'TFOOT') walkRows(k, false);
        else if (tn === 'TR') addRow(k, head);
      });
    }
    walkRows(el, false);
    if (!rows.length) { if (caption) caption.forEach(function (b) { out.push(b); }); return; }
    /* leading rows made only of <th> are a header too (Markdown and many HTML tables) */
    if (!rows.some(function (r) { return r.head; })) {
      for (var i = 0; i < rows.length - 1; i++) {
        if (rows[i].cells.every(function (c) { return c.th; })) rows[i].head = true;
        else break;
      }
    }
    /* Word tables (mammoth) put the header in bold <p><strong> without <th>: treat a first row that is all bold as a header */
    if (!rows.some(function (r) { return r.head; }) && rows.length > 2 && rows[0].cells.every(function (c) { return allBold(c.blocks); })) rows[0].head = true;
    var widthPct = pctOf(tcss.width || el.getAttribute('width'));
    out.push({ t: 'table', rows: rows, caption: caption, borders: borders, widthPct: widthPct, width: widthPct ? null : parseLen(tcss.width || el.getAttribute('width'), st.size), size: st.size, align: tableAlign });
  };
  function allBold(blocks) {
    var any = false;
    var ok = blocks.every(function (b) {
      if (b.t !== 'p') return b.t === 'anchor';
      return b.runs.every(function (r) { if (r.text && /\S/.test(r.text)) { any = true; return r.st.b; } return true; });
    });
    return ok && any;
  }

  /* ---------------------------------------------------------------- layout: items
     An item is { h, sb, sa, kwn, pb, fb (first baseline), paint(ops, x, y), split(avail, force) -> [a, b] | null }.
     Leaves keep their drawing ops relative to their own top-left corner. */

  function Lay(fonts, opts, images, warn) {
    this.fonts = fonts;
    this.opts = opts;
    this.images = images;
    this.warn = warn;
    this.missing = 0;
  }

  /* text run → pieces with a concrete face; characters no face covers become '?' and are counted */
  Lay.prototype.faceFor = function (st) {
    var f = this.fonts.get(st.fam, st.b, st.i) || this.fonts.get(st.fam, st.b, false) || this.fonts.get('sans', st.b, st.i) || this.fonts.get('sans', false, false);
    return f;
  };
  Lay.prototype.segments = function (text, st) {
    var prim = this.faceFor(st);
    var fb = [this.fonts.get('uni', st.b, false), this.fonts.get('mono', st.b, false), this.fonts.get('serif', st.b, false), this.fonts.get('sans', st.b, false)];
    var out = [];
    var cur = null, buf = '';
    var fonts = this.fonts;
    for (var i = 0; i < text.length; i++) {
      var cp = text.codePointAt(i);
      var ch = String.fromCodePoint(cp);
      if (cp > 0xFFFF) i++;
      var face = null;
      if (cp === 0xAD || cp === 0x200B || cp === 0xFEFF || cp === 0x200C || cp === 0x200D) continue;
      if (/[\u0300-\u036F]/.test(ch) && cur && fonts.covers(cur, cp)) face = cur;
      else if (fonts.covers(prim, cp)) face = prim;
      else {
        for (var j = 0; j < fb.length; j++) if (fb[j] && fonts.covers(fb[j], cp)) { face = fb[j]; break; }
      }
      if (!face) {
        if (cp === 0xA0 || cp === 0x2007 || cp === 0x202F) { ch = ' '; face = prim; }
        else if (cp === 0x2011) { ch = '-'; face = prim; }
        else if (cp === 0x2028 || cp === 0x2029) { ch = ' '; face = prim; }
        else { this.missing++; ch = '?'; face = prim; }
      }
      if (face !== cur) { if (buf) out.push({ text: buf, face: cur }); buf = ''; cur = face; }
      buf += ch;
    }
    if (buf) out.push({ text: buf, face: cur });
    return out;
  };

  /* tokens: words split at break opportunities; spaces; forced breaks */
  Lay.prototype.tokens = function (runs, pre) {
    var toks = [];
    var self = this;
    runs.forEach(function (r) {
      if (r.br) { toks.push({ br: true, st: r.st }); return; }
      if (!r.text) return;
      var st = r.st;
      var parts = pre ? r.text.split(/(\n)/) : [r.text];
      parts.forEach(function (part) {
        if (part === '\n') { toks.push({ br: true, st: st }); return; }
        if (!part) return;
        var bits = part.split(/( +|\u200B)/);
        bits.forEach(function (b) {
          if (!b) return;
          if (b === '\u200B') { toks.push({ zw: true, st: st, w: 0 }); return; }
          if (/^ +$/.test(b)) { toks.push({ space: true, text: pre ? b : ' ', st: st }); return; }
          /* soft hyphens and hard hyphens / dashes / slashes are break points inside a word */
          var pieces = b.split(/(\u00AD)|(?<=[^\s-][-\u2010–—\/])(?=[^\s\d-])/);
          pieces.forEach(function (p, idx) {
            if (p == null || p === '') return;
            if (p === '\u00AD') { if (toks.length) toks[toks.length - 1].soft = true; return; }
            toks.push({ text: p, st: st, brk: idx < pieces.length - 1 });
          });
        });
      });
    });
    toks.forEach(function (t) {
      if (t.br || t.zw) return;
      t.segs = self.segments(t.text, t.st);
      t.w = 0;
      var size = t.st.rise ? t.st.size * 0.7 : t.st.size;
      t.segs.forEach(function (s) { s.w = self.fonts.width(s.face, s.text, size); t.w += s.w; });
      t.size = size;
    });
    return toks;
  };

  /* break tokens into lines no wider than maxW (first line maxW - firstIndent) */
  Lay.prototype.lines = function (runs, maxW, opt) {
    opt = opt || {};
    var toks = this.tokens(runs, opt.pre);
    var lines = [];
    var line = [];
    var lw = 0;
    var self = this;
    function limit() { return Math.max(8, maxW - (lines.length === 0 ? (opt.first || 0) : 0)); }
    function endLine(forced) {
      while (line.length && line[line.length - 1].space && !opt.pre) { lw -= line[line.length - 1].w; line.pop(); }
      lines.push({ toks: line, w: lw, forced: forced });
      line = [];
      lw = 0;
    }
    /* units: consecutive word tokens up to a break opportunity */
    var i = 0;
    while (i < toks.length) {
      var t = toks[i];
      if (t.br) { endLine(true); i++; continue; }
      if (t.zw) { i++; continue; }
      if (t.space) {
        if (line.length || opt.pre) { line.push(t); lw += t.w; }
        i++;
        continue;
      }
      var unit = [];
      var uw = 0;
      var j = i;
      while (j < toks.length && !toks[j].space && !toks[j].br && !toks[j].zw) {
        unit.push(toks[j]);
        uw += toks[j].w;
        if (toks[j].brk || toks[j].soft) { j++; break; }
        j++;
      }
      var last = unit[unit.length - 1];
      var hyW = last.soft ? this.fonts.width(last.segs[last.segs.length - 1].face, '-', last.size) : 0;
      var room = limit();
      if (lw + uw <= room + 0.01 || (lw + uw - hyW <= room + 0.01 && !last.soft)) {
        unit.forEach(function (u) { line.push(u); });
        lw += uw;
        i = j;
        continue;
      }
      if (line.length) {
        /* break before this unit; if the previous unit ended in a soft hyphen, show the hyphen */
        var prev = line[line.length - 1];
        while (prev && prev.space) { line.pop(); lw -= prev.w; prev = line[line.length - 1]; }
        if (prev && prev.soft) {
          var hy = { text: '-', st: prev.st, size: prev.size, segs: [{ text: '-', face: prev.segs[prev.segs.length - 1].face }] };
          hy.w = hy.segs[0].w = this.fonts.width(hy.segs[0].face, '-', hy.size);
          line.push(hy);
          lw += hy.w;
        }
        endLine(false);
        continue;
      }
      /* a single unit wider than the line: break it by characters */
      if (uw > room) {
        var flat = [];
        unit.forEach(function (u) { u.segs.forEach(function (s) { flat.push({ s: s, u: u }); }); });
        var acc = { tok: null };
        flat.forEach(function (fs) {
          var chars = Array.from(fs.s.text);
          chars.forEach(function (ch) {
            var cw = self.fonts.width(fs.s.face, ch, fs.u.size);
            if (lw + cw > limit() + 0.01 && line.length) { endLine(false); acc.tok = null; }
            if (!acc.tok || acc.tok.st !== fs.u.st || acc.tok.segs[0].face !== fs.s.face) {
              acc.tok = { text: '', st: fs.u.st, size: fs.u.size, segs: [{ text: '', face: fs.s.face, w: 0 }], w: 0 };
              line.push(acc.tok);
            }
            acc.tok.text += ch;
            acc.tok.segs[0].text += ch;
            acc.tok.segs[0].w += cw;
            acc.tok.w += cw;
            lw += cw;
          });
        });
        i = j;
        continue;
      }
      unit.forEach(function (u) { line.push(u); });
      lw += uw;
      i = j;
    }
    if (line.length || !lines.length) endLine(true);
    else lines[lines.length - 1].forced = true;
    return lines;
  };

  /* paragraph → a lines item */
  Lay.prototype.para = function (p, width) {
    var self = this;
    var indent = clamp(p.indent || 0, 0, width * 0.6);
    var maxW = Math.max(20, width - indent);
    var first = p.first || 0;
    var lines = this.lines(p.runs, maxW, { first: first > 0 ? first : 0, pre: false });
    var lh = p.lh || 1.42;
    var out = lines.map(function (ln, idx) {
      var maxSize = 0, asc = 0, desc = 0;
      ln.toks.forEach(function (t) {
        if (!t.segs) return;
        var full = t.st.size;
        if (full > maxSize) maxSize = full;
        t.segs.forEach(function (s) { var a = s.face.asc * t.size + (t.st.rise > 0 ? t.st.size * 0.33 : 0); var dd = s.face.desc * t.size + (t.st.rise < 0 ? t.st.size * 0.2 : 0); if (a > asc) asc = a; if (dd > desc) desc = dd; });
      });
      if (!maxSize) { maxSize = (p.runs[0] && p.runs[0].st && p.runs[0].st.size) || self.opts.fontSize; asc = maxSize * 0.8; desc = maxSize * 0.2; }
      var h = Math.max(maxSize * lh, asc + desc + 1);
      var base = (h - (asc + desc)) / 2 + asc;
      var x0 = indent + (idx === 0 ? first : 0);
      var avail = maxW - (idx === 0 ? first : 0);
      var align = p.align || 'left';
      var gap = 0;
      if (align === 'center') x0 += Math.max(0, (avail - ln.w) / 2);
      else if (align === 'right') x0 += Math.max(0, avail - ln.w);
      else if (align === 'justify' && !ln.forced) {
        var spaces = ln.toks.filter(function (t) { return t.space; }).length;
        if (spaces && avail - ln.w < avail * 0.35) gap = (avail - ln.w) / spaces;
      }
      return { h: h, base: base, ops: self.lineOps(ln, x0, base, gap) };
    });
    var item = linesItem(out);
    item.sb = p.sb || 0;
    item.sa = p.sa == null ? 0 : p.sa;
    item.kwn = !!p.kwn;
    item.outline = p.outline ? { level: p.level, title: p.outline } : null;
    item.ids = p.ids || [];
    item.caption = !!p.caption;
    return item;
  };

  /* ops for one line: text grouped into runs of the same face/size/colour, plus decorations and link boxes */
  Lay.prototype.lineOps = function (ln, x0, base, gap) {
    var ops = [];
    var x = x0;
    var group = null;
    var links = [];
    var decos = [];
    function flush() {
      if (group && group.text) ops.push(group);
      group = null;
    }
    ln.toks.forEach(function (t) {
      if (!t.segs) return;
      var st = t.st;
      var rise = st.rise > 0 ? st.size * 0.33 : st.rise < 0 ? -st.size * 0.18 : 0;
      var startX = x;
      if (st.bg || st.code) {
        if (!t.space || st.bg) ops.push({ t: 'rect', x: x - (st.code ? 1 : 0), y: base - t.size * 0.95, w: t.w + (st.code ? 2 : 0), h: t.size * 1.25, fill: st.bg || [0.94, 0.94, 0.93] });
      }
      t.segs.forEach(function (s) {
        if (!group || group.face !== s.face || group.size !== t.size || group.color !== st.color || group.rise !== rise || (gap && t.space)) {
          flush();
          group = { t: 'text', x: x, y: base - rise, text: '', face: s.face, size: t.size, color: st.color, rise: rise, skew: s.face.skew };
        }
        group.text += s.text;
        x += s.w;
      });
      if (t.space && gap) { x += gap; flush(); }
      var endX = x - (t.space && gap ? gap : 0);
      if (st.u || st.s) decos.push({ x1: startX, x2: endX, u: st.u, s: st.s, size: t.size, color: st.color, y: base - rise });
      if (st.href) {
        var lk = links[links.length - 1];
        if (lk && lk.href === st.href && Math.abs(lk.x2 - startX) < 0.5 + gap) lk.x2 = endX;
        else links.push({ href: st.href, x1: startX, x2: endX, size: t.size, y: base });
      }
    });
    flush();
    /* merge decorations across spaces */
    var merged = [];
    decos.forEach(function (dc) {
      var m = merged[merged.length - 1];
      if (m && m.u === dc.u && m.s === dc.s && m.color === dc.color && Math.abs(m.x2 - dc.x1) < 0.5 + gap && Math.abs(m.y - dc.y) < 0.1) m.x2 = dc.x2;
      else merged.push({ x1: dc.x1, x2: dc.x2, u: dc.u, s: dc.s, size: dc.size, color: dc.color, y: dc.y });
    });
    merged.forEach(function (dc) {
      var th = Math.max(0.45, dc.size * 0.055);
      if (dc.u) ops.push({ t: 'line', x1: dc.x1, x2: dc.x2, y: dc.y + dc.size * 0.13, w: th, color: dc.color });
      if (dc.s) ops.push({ t: 'line', x1: dc.x1, x2: dc.x2, y: dc.y - dc.size * 0.28, w: th, color: dc.color });
    });
    links.forEach(function (lk) { ops.push({ t: 'link', href: lk.href, x: lk.x1, y: lk.y - lk.size * 0.95, w: lk.x2 - lk.x1, h: lk.size * 1.25 }); });
    return ops;
  };

  function linesItem(lines) {
    var h = 0;
    lines.forEach(function (l) { h += l.h; });
    return {
      kind: 'lines', lines: lines, h: h, sb: 0, sa: 0, fb: lines.length ? lines[0].base : 0,
      firstH: lines.length ? lines[0].h : 0,
      paint: function (P, x, y) {
        var yy = y;
        lines.forEach(function (l) { P.ops(l.ops, x, yy); yy += l.h; });
        if (this.outline) P.outline(this.outline, y);
        if (this.ids && this.ids.length) P.anchor(this.ids, y);
      },
      split: function (avail, force) {
        var n = lines.length;
        var acc = 0, k = 0;
        while (k < n && acc + lines[k].h <= avail + 0.01) { acc += lines[k].h; k++; }
        if (k >= n) return null;
        if (!force) {
          if (n - k < 2 && k > 2) k = n - 2; /* widow */
          if (k < 2 || (n - k) < 1) return null; /* orphan */
          if (n < 4 && k < n) return null;
        }
        if (k < 1) { if (!force) return null; k = 1; }
        var a = linesItem(lines.slice(0, k));
        var b = linesItem(lines.slice(k));
        a.sb = this.sb; a.outline = this.outline; a.ids = this.ids; a.kwn = false; a.sa = 0;
        b.sb = 0; b.sa = this.sa; b.kwn = this.kwn; b.cont = true;
        return [a, b];
      }
    };
  }

  function opsItem(h, ops, extra) {
    var it = { kind: 'ops', h: h, ops: ops, sb: 0, sa: 0, fb: h * 0.8, firstH: h, paint: function (P, x, y) { P.ops(this.ops, x, y); if (this.ids && this.ids.length) P.anchor(this.ids, y); if (this.outline) P.outline(this.outline, y); }, split: null };
    for (var k in extra) it[k] = extra[k];
    return it;
  }

  /* a vertical stack of items with optional decoration and padding; splits between (or inside) children */
  function stackItem(kids, o) {
    o = o || {};
    var it = { kind: 'stack', kids: kids, o: o, sb: o.sb || 0, sa: o.sa || 0, kwn: !!o.kwn };
    var pt = o.pt || 0, pb = o.pb || 0, px = o.px || 0;
    var h = pt;
    var placed = [];
    kids.forEach(function (k, i) {
      var sb = i === 0 ? 0 : Math.max(k.sb || 0, kids[i - 1].sa || 0);
      h += sb;
      placed.push(h);
      h += k.h;
    });
    h += pb;
    if (o.minH && h < o.minH) h = o.minH;
    it.h = h;
    it.placed = placed;
    it.fb = kids.length ? pt + (kids[0].fb || 0) : pt;
    it.firstH = kids.length ? pt + (kids[0].firstH || kids[0].h) : h;
    it.paint = function (P, x, y) {
      if (o.decor) o.decor(P, x, y, it.h, it);
      if (o.lead) o.lead(P, x, y, it.h, it); /* list markers: drawn before the content so text order is "1. First" */
      for (var i = 0; i < kids.length; i++) kids[i].paint(P, x + px, y + placed[i]);
      if (o.after) o.after(P, x, y, it.h, it);
      if (it.ids && it.ids.length) P.anchor(it.ids, y);
    };
    it.split = function (avail, force) {
      var r = takeFit(kids, avail - pt - pb, true, force);
      if (!r.taken.length || !r.rest.length) return null;
      var oa = Object.assign({}, o, { pb: 0, sa: 0, kwn: false, minH: 0 });
      var ob = Object.assign({}, o, { pt: o.contPad != null ? o.contPad : 0, sb: 0, first: false, minH: 0 });
      ob.lead = null;
      var restKids = r.rest;
      if (o.repeat && o.repeat.length) restKids = o.repeat.map(function (x) { return x.clone ? x.clone() : x; }).concat(restKids);
      var a = stackItem(r.taken, oa);
      var b = stackItem(restKids, ob);
      a.ids = it.ids;
      b.cont = true;
      return [a, b];
    };
    return it;
  }

  /* fit a list of items into `avail`; returns { taken, rest, used }. Respects keep-with-next and page-break-before. */
  function takeFit(items, avail, atTop, force) {
    var taken = [], used = 0;
    var i = 0;
    for (; i < items.length; i++) {
      var it = items[i];
      if (it.pb && (taken.length || !atTop)) break;
      var sb = taken.length ? Math.max(it.sb || 0, taken[taken.length - 1].sa || 0) : (atTop ? 0 : it.sb || 0);
      var need = sb + it.h;
      if (used + need <= avail + 0.01) {
        if (it.kwn && i + 1 < items.length && taken.length + (atTop ? 0 : 1) > 0) {
          var nx = items[i + 1];
          var nsb = Math.max(nx.sb || 0, it.sa || 0);
          var nMin = nx.split ? Math.min(nx.h, (nx.firstH || nx.h) * 2) : nx.h;
          if (used + need + nsb + nMin > avail + 0.01 && taken.length) {
            /* move this heading (and the run of keep-with-next items before it) to the next page */
            var back = taken.length;
            while (back > 0 && taken[back - 1].kwn) back--;
            if (back > 0) { var moved = taken.splice(back); return { taken: taken, rest: moved.concat(items.slice(i)), used: used }; }
          }
        }
        taken.push(it);
        used += need;
        if (it.pa) { i++; break; }
        continue;
      }
      var room = avail - used - sb;
      if (it.split && room > 0) {
        var parts = it.split(room, force && !taken.length);
        if (parts) { taken.push(parts[0]); return { taken: taken, rest: [parts[1]].concat(items.slice(i + 1)), used: avail }; }
      }
      if (!taken.length && force) {
        if (it.split) {
          var p2 = it.split(Math.max(room, 1), true);
          if (p2) { taken.push(p2[0]); return { taken: taken, rest: [p2[1]].concat(items.slice(i + 1)), used: avail }; }
        }
        taken.push(it);
        i++;
      }
      break;
    }
    /* keep-with-next at the end of what fits: never leave a heading alone at the bottom */
    if (i < items.length && taken.length > 1 && taken[taken.length - 1].kwn) {
      var b2 = taken.length;
      while (b2 > 0 && taken[b2 - 1].kwn) b2--;
      if (b2 > 0) { var mv = taken.splice(b2); return { taken: taken, rest: mv.concat(items.slice(i)), used: used }; }
    }
    return { taken: taken, rest: items.slice(i), used: used };
  }

  /* blocks → items at a given width */
  Lay.prototype.blocks = function (blocks, width) {
    var items = [];
    var pendingIds = [];
    var pb = false;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.t === 'anchor') { pendingIds = pendingIds.concat(b.ids); continue; }
      if (b.t === 'pb') { pb = true; continue; }
      var it = this.block(b, width);
      if (!it) continue;
      if (pendingIds.length) { it.ids = (it.ids || []).concat(pendingIds); pendingIds = []; }
      if (b.ids && b.ids.length && it.kind !== 'lines') it.ids = (it.ids || []).concat(b.ids);
      if (pb) { it.pb = true; pb = false; }
      items.push(it);
    }
    if (pendingIds.length) items.push(opsItem(0, [], { ids: pendingIds }));
    /* an image followed by its caption stays together */
    for (var j = 0; j + 1 < items.length; j++) if (items[j].image && items[j + 1].caption) items[j].kwn = true;
    return items;
  };
  Lay.prototype.block = function (b, width) {
    switch (b.t) {
      case 'p': return this.para(b, width);
      case 'hr': return opsItem(10, [{ t: 'line', x1: 0, x2: width, y: 5, w: 0.6, color: [0.75, 0.75, 0.75] }], { sb: 6, sa: 6 });
      case 'img': return this.img(b, width);
      case 'list': return this.list(b, width);
      case 'quote': return this.quote(b, width);
      case 'pre': return this.pre(b, width);
      case 'table': return this.table(b, width);
      case 'box': return this.box(b, width);
    }
    return null;
  };
  Lay.prototype.img = function (b, width) {
    var im = this.images[b.key];
    if (!im || !im.ref) return null;
    var w = b.w, h = b.h;
    var ar = im.h / im.w;
    if (b.pct) w = width * b.pct;
    if (w && !h) h = w * ar;
    else if (h && !w) w = h / ar;
    else if (!w && !h) { w = im.w * PX; h = im.h * PX; }
    var maxH = this.opts.contentH * 0.92;
    var s = Math.min(1, width / w, maxH / h);
    w *= s; h *= s;
    var x = b.align === 'center' ? (width - w) / 2 : b.align === 'right' ? width - w : 0;
    return opsItem(h, [{ t: 'img', key: b.key, x: x, y: 0, w: w, h: h, alt: b.alt }], { sb: 4, sa: 6, image: true });
  };
  function roman(n, lower) {
    var v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1], s = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'], out = '';
    n = clamp(Math.floor(n), 1, 3999);
    for (var i = 0; i < v.length; i++) while (n >= v[i]) { out += s[i]; n -= v[i]; }
    return lower ? out.toLowerCase() : out;
  }
  function alpha(n, lower) {
    var s = '';
    n = Math.max(1, Math.floor(n));
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return lower ? s.toLowerCase() : s;
  }
  Lay.prototype.list = function (b, width) {
    var self = this;
    var size = b.size;
    var indent = Math.max(18, size * 1.9);
    var depthLevel = this.listDepth = (this.listDepth || 0) + 1;
    var n = b.start;
    var items = b.items.map(function (li) {
      if (li.value != null) n = li.value;
      var kids = self.blocks(li.blocks, Math.max(40, width - indent));
      kids.forEach(function (k) { if (k.kind === 'lines' && k.sa > size * 0.3) k.sa = size * 0.25; });
      if (!kids.length) kids = [opsItem(size * 1.4, [], { fb: size * 1.05 })];
      var marker = null;
      if (!li.plain) {
        var label = null;
        if (b.ordered) {
          var ty = b.type;
          label = (ty === 'a' || /lower-(alpha|latin)/.test(ty)) ? alpha(n, true) : (ty === 'A' || /upper-(alpha|latin)/.test(ty)) ? alpha(n, false) : (ty === 'i' || ty === 'lower-roman') ? roman(n, true) : (ty === 'I' || ty === 'upper-roman') ? roman(n, false) : String(n);
          label += '.';
          n++;
        }
        marker = { label: label, level: depthLevel };
      }
      var it = stackItem(kids, {
        px: indent,
        lead: marker ? function (P, x, y, h, me) {
          var fb = me.fb || size;
          if (marker.label) {
            var face = self.faceFor({ fam: b.fam, b: false, i: false });
            var w = self.fonts.width(face, marker.label, size);
            P.ops([{ t: 'text', x: indent - 5 - w, y: fb, text: marker.label, face: face, size: size, color: b.color }], x, y);
          } else {
            var r = size * 0.17;
            var cx = indent - 8 - r, cy = fb - size * 0.3;
            var lvl = (marker.level - 1) % 3;
            P.ops([{ t: lvl === 2 ? 'rect' : 'dot', x: cx - r, y: cy - r, w: r * 2, h: r * 2, cx: cx, cy: cy, r: r, fill: b.color, hollow: lvl === 1 }], x, y);
          }
        } : null
      });
      it.sa = size * 0.22;
      if (li.ids && li.ids.length) it.ids = li.ids;
      return it;
    });
    this.listDepth--;
    var whole = stackItem(items, {});
    whole.sb = depthLevel > 1 ? size * 0.15 : size * 0.2;
    whole.sa = depthLevel > 1 ? size * 0.15 : size * 0.62;
    return whole;
  };
  Lay.prototype.quote = function (b, width) {
    var pad = 14;
    var kids = this.blocks(b.blocks, Math.max(40, width - pad - 2));
    if (!kids.length) return null;
    var it = stackItem(kids, {
      px: pad, pt: 2, pb: 2, contPad: 2,
      decor: b.plain ? null : function (P, x, y, h) { P.ops([{ t: 'rect', x: 0, y: 0, w: 2.6, h: h, fill: [0.78, 0.76, 0.86] }], x, y); }
    });
    it.sb = 4; it.sa = this.opts.fontSize * 0.7;
    return it;
  };
  Lay.prototype.box = function (b, width) {
    var pad = clamp(b.pad || 6, 2, 30);
    var kids = this.blocks(b.blocks, Math.max(40, width - pad * 2));
    if (!kids.length) return null;
    var it = stackItem(kids, {
      px: pad, pt: pad, pb: pad, contPad: pad,
      decor: function (P, x, y, h) { P.ops([{ t: 'rect', x: 0, y: 0, w: width, h: h, fill: b.bg, stroke: b.border, sw: 0.6 }], x, y); }
    });
    it.sb = 4; it.sa = this.opts.fontSize * 0.6;
    return it;
  };
  Lay.prototype.pre = function (b, width) {
    var self = this;
    var pad = 8;
    var st = b.st;
    var inner = width - pad * 2;
    /* shrink up to 25% so typical code lines do not wrap; wrap anything longer */
    var raw = [];
    b.runs.forEach(function (r) { if (r.text) raw.push(r.text); else if (r.br) raw.push('\n'); });
    var text = raw.join('').replace(/^\n/, '').replace(/\n+$/, '');
    var face = this.faceFor(st);
    var longest = 0;
    text.split('\n').forEach(function (l) { var w = self.fonts.width(face, l, st.size); if (w > longest) longest = w; });
    var scale = longest > inner ? Math.max(0.75, inner / longest) : 1;
    var runs = b.runs.map(function (r) {
      if (!r.st) return r;
      var s2 = inherit(r.st); s2.size = r.st.size * scale; s2.fam = 'mono';
      return r.br ? { br: true, st: s2 } : { text: r.text, st: s2 };
    });
    while (runs.length && runs[0].text && /^\n/.test(runs[0].text)) { runs[0] = { text: runs[0].text.replace(/^\n/, ''), st: runs[0].st }; if (!runs[0].text) runs.shift(); }
    var lines = this.lines(runs, inner, { pre: true });
    var lh = st.size * scale * 1.38;
    var out = lines.map(function (ln) { var base = lh * 0.78; return { h: lh, base: base, ops: self.lineOps(ln, 0, base, 0) }; });
    var li = linesItem(out);
    var it = stackItem([li], {
      px: pad, pt: pad - 2, pb: pad - 2, contPad: pad - 2,
      decor: function (P, x, y, h) { P.ops([{ t: 'rect', x: 0, y: 0, w: width, h: h, fill: [0.965, 0.965, 0.955], stroke: [0.88, 0.88, 0.86], sw: 0.5 }], x, y); }
    });
    var origSplit = li.split;
    /* short code blocks stay whole; long ones split with at least three lines on each side */
    li.split = function (avail, force) {
      if (out.length < 8 && !force) return null;
      var acc = 0, k = 0;
      while (k < out.length && acc + out[k].h <= avail + 0.01) { acc += out[k].h; k++; }
      if (!force && (k < 3 || out.length - k < 3)) return null;
      return origSplit.call(li, avail, true);
    };
    it.sb = 4; it.sa = this.opts.fontSize * 0.8;
    return it;
  };

  /* ---------------------------------------------------------------- tables */

  Lay.prototype.measure = function (blocks) {
    /* min = widest unbreakable unit, max = widest paragraph on one line */
    var self = this;
    var mn = 0, mx = 0;
    blocks.forEach(function (b) {
      if (b.t === 'p') {
        var toks = self.tokens(b.runs, false);
        var line = 0, unit = 0;
        toks.forEach(function (t) {
          if (t.br) { mx = Math.max(mx, line); line = 0; unit = 0; return; }
          if (t.zw) { unit = 0; return; }
          line += t.w || 0;
          if (t.space) { unit = 0; return; }
          unit += t.w;
          if (unit > mn) mn = unit;
          if (t.brk || t.soft) unit = 0;
        });
        mx = Math.max(mx, line);
        mn += 0;
        var ind = b.indent || 0;
        mn = Math.max(mn, 0) + 0 * ind;
        mx = Math.max(mx, line + ind);
      } else if (b.t === 'img') {
        var im = self.images[b.key];
        var w = b.w || (im && im.ref ? im.w * PX : 40);
        mn = Math.max(mn, Math.min(w, 60));
        mx = Math.max(mx, w);
      } else if (b.t === 'list' || b.t === 'quote' || b.t === 'box') {
        var sub = b.t === 'list' ? [].concat.apply([], b.items.map(function (i) { return i.blocks; })) : b.blocks;
        var m = self.measure(sub);
        var add = b.t === 'list' ? 20 : 16;
        mn = Math.max(mn, m.min + add); mx = Math.max(mx, m.max + add);
      } else if (b.t === 'pre') {
        var m2 = self.measure([{ t: 'p', runs: b.runs }]);
        mn = Math.max(mn, Math.min(m2.max, 120)); mx = Math.max(mx, m2.max + 16);
      } else if (b.t === 'table') {
        var cols = self.colWidths(b, 1e6);
        var s = cols.natural;
        mn = Math.max(mn, cols.minSum); mx = Math.max(mx, s);
      }
    });
    return { min: mn, max: mx };
  };
  /* grid placement with colspan/rowspan */
  function grid(rows) {
    var occ = [];
    var cells = [];
    var ncol = 0;
    rows.forEach(function (row, r) {
      occ[r] = occ[r] || [];
      var c = 0;
      row.cells.forEach(function (cell) {
        while (occ[r][c]) c++;
        if (c >= LIMIT.cols) return;
        var cs = Math.min(cell.colspan, LIMIT.cols - c);
        var rs = Math.min(cell.rowspan, rows.length - r);
        for (var dr = 0; dr < rs; dr++) { occ[r + dr] = occ[r + dr] || []; for (var dc = 0; dc < cs; dc++) occ[r + dr][c + dc] = 1; }
        cells.push({ cell: cell, r: r, c: c, cs: cs, rs: rs });
        c += cs;
        if (c > ncol) ncol = c;
      });
    });
    return { cells: cells, ncol: ncol };
  }
  Lay.prototype.colWidths = function (tb, avail) {
    var self = this;
    var g = tb._grid || (tb._grid = grid(tb.rows));
    var n = Math.max(1, g.ncol);
    var pad = this.cellPad(tb);
    var mins = [], maxs = [], fixed = [];
    for (var i = 0; i < n; i++) { mins[i] = 12; maxs[i] = 12; fixed[i] = null; }
    var spans = [];
    if (!tb._meas) {
      tb._meas = g.cells.map(function (gc) { return self.measure(gc.cell.blocks); });
    }
    g.cells.forEach(function (gc, idx) {
      var m = tb._meas[idx];
      var mn = Math.min(m.min, 160) + pad * 2, mx = m.max + pad * 2 + 0.5;
      if (gc.cs === 1) {
        mins[gc.c] = Math.max(mins[gc.c], mn);
        maxs[gc.c] = Math.max(maxs[gc.c], mx);
        if (gc.cell.pct) fixed[gc.c] = { pct: gc.cell.pct };
        else if (gc.cell.width) fixed[gc.c] = { w: Math.max(gc.cell.width, mn) };
      } else spans.push({ gc: gc, mn: mn, mx: mx });
    });
    spans.forEach(function (s) {
      var c0 = s.gc.c, cs = s.gc.cs, smn = 0, smx = 0;
      for (var k = 0; k < cs; k++) { smn += mins[c0 + k]; smx += maxs[c0 + k]; }
      if (s.mn > smn) for (var k1 = 0; k1 < cs; k1++) mins[c0 + k1] += (s.mn - smn) / cs;
      if (s.mx > smx) for (var k2 = 0; k2 < cs; k2++) maxs[c0 + k2] += (s.mx - smx) / cs;
    });
    for (var j = 0; j < n; j++) { if (maxs[j] < mins[j]) maxs[j] = mins[j]; }
    var minSum = mins.reduce(function (a, b) { return a + b; }, 0);
    var maxSum = maxs.reduce(function (a, b) { return a + b; }, 0);
    var target;
    if (tb.widthPct) target = avail * tb.widthPct;
    else if (tb.width) target = Math.min(avail, tb.width);
    else target = maxSum >= avail * 0.62 ? avail : Math.min(avail, maxSum);
    target = Math.min(target, avail);
    var w = [];
    /* explicit widths first */
    var fixedSum = 0, freeIdx = [];
    for (var f = 0; f < n; f++) {
      if (fixed[f]) { w[f] = fixed[f].pct ? Math.max(mins[f], target * fixed[f].pct) : fixed[f].w; fixedSum += w[f]; }
      else freeIdx.push(f);
    }
    if (fixedSum > target || !freeIdx.length) {
      if (!freeIdx.length && fixedSum < target) { var gr = target / Math.max(1, fixedSum); for (var a1 = 0; a1 < n; a1++) w[a1] *= gr; }
      else if (fixedSum > target) { freeIdx = []; for (var a2 = 0; a2 < n; a2++) freeIdx.push(a2); fixedSum = 0; }
    }
    var rem = target - fixedSum;
    var fmin = 0, fmax = 0;
    freeIdx.forEach(function (i2) { fmin += mins[i2]; fmax += maxs[i2]; });
    if (fmax <= rem) {
      /* everything fits on one line: share the spare room in proportion to content */
      freeIdx.forEach(function (i2) { w[i2] = maxs[i2] + (rem - fmax) * (maxs[i2] / Math.max(1, fmax)); });
    } else if (fmin <= rem) {
      /* water-filling: every column starts at its minimum; spare room is shared out evenly, so short columns
         reach their one-line width first and long text columns take what is left */
      freeIdx.forEach(function (i2) { w[i2] = mins[i2]; });
      var extra = rem - fmin;
      for (var guard = 0; guard < 64 && extra > 0.01; guard++) {
        var open = freeIdx.filter(function (i2) { return w[i2] < maxs[i2] - 0.01; });
        if (!open.length) break;
        var share = extra / open.length;
        open.forEach(function (i2) { var add = Math.min(share, maxs[i2] - w[i2]); w[i2] += add; extra -= add; });
      }
    } else {
      /* even the narrowest content does not fit: scale down; words will break by letters */
      freeIdx.forEach(function (i2) { w[i2] = Math.max(14, mins[i2] * rem / Math.max(1, fmin)); });
      var tot = w.reduce(function (a, b) { return a + (b || 0); }, 0);
      if (tot > target) w = w.map(function (x) { return x * target / tot; });
    }
    return { w: w, natural: maxSum, minSum: minSum, n: n };
  };
  Lay.prototype.cellPad = function (tb) { return Math.max(3, tb.size * 0.42); };
  Lay.prototype.table = function (tb, width) {
    var self = this;
    var g = tb._grid || (tb._grid = grid(tb.rows));
    if (!g.cells.length) return null;
    var cw = this.colWidths(tb, width);
    var colW = cw.w;
    var n = cw.n;
    var total = colW.reduce(function (a, b) { return a + b; }, 0);
    var x0 = tb.align === 'center' ? (width - total) / 2 : tb.align === 'right' ? width - total : 0;
    var colX = [x0];
    for (var i = 0; i < n; i++) colX[i + 1] = colX[i] + colW[i];
    var pad = this.cellPad(tb);
    var nrows = tb.rows.length;
    /* lay out each cell */
    var byRow = [];
    for (var r = 0; r < nrows; r++) byRow[r] = [];
    g.cells.forEach(function (gc) {
      var cwid = colX[gc.c + gc.cs] - colX[gc.c];
      var p = gc.cell.pad != null ? clamp(gc.cell.pad, 0, 20) : pad;
      var kids = self.blocks(gc.cell.blocks, Math.max(6, cwid - p * 2));
      gc.kids = kids;
      gc.pad = p;
      gc.x = colX[gc.c];
      gc.w = cwid;
      gc.contentH = stackItem(kids, {}).h;
      byRow[gc.r].push(gc);
    });
    /* row heights: single-row cells first, then stretch the last row of a rowspan if needed */
    var rowH = [];
    for (var r2 = 0; r2 < nrows; r2++) {
      var h = tb.size * 1.2 + pad * 2;
      byRow[r2].forEach(function (gc) { if (gc.rs === 1) h = Math.max(h, gc.contentH + gc.pad * 2); });
      rowH[r2] = h;
    }
    g.cells.forEach(function (gc) {
      if (gc.rs < 2) return;
      var s = 0;
      for (var k = 0; k < gc.rs; k++) s += rowH[gc.r + k];
      var need = gc.contentH + gc.pad * 2;
      if (need > s) rowH[gc.r + gc.rs - 1] += need - s;
    });
    var border = tb.borders ? [0.72, 0.72, 0.72] : null;
    var headBg = [0.95, 0.95, 0.94];
    var spanEnd = -1;
    var rowItems = [];
    var headItems = [];
    for (var r3 = 0; r3 < nrows; r3++) {
      var cells = byRow[r3];
      var isHead = !!tb.rows[r3].head;
      var spanH = [];
      cells.forEach(function (gc) { var s = 0; for (var k = 0; k < gc.rs; k++) s += rowH[r3 + k]; spanH.push(s); if (gc.rs > 1) spanEnd = Math.max(spanEnd, r3 + gc.rs - 1); });
      var item = rowItem(cells.map(function (gc, ci) { return { gc: gc, h: spanH[ci], kids: gc.kids, cont: false }; }), rowH[r3], isHead);
      item.kwn = r3 < spanEnd || (isHead && r3 + 1 < nrows);
      rowItems.push(item);
      if (isHead && headItems.length === r3) headItems.push(item);
    }
    function rowItem(cellsIn, h, head) {
      var it = { kind: 'row', h: h, sb: 0, sa: 0, firstH: h, fb: pad + tb.size };
      it.clone = function () { return rowItem(cellsIn, h, head); };
      it.paint = function (P, x, y) {
        cellsIn.forEach(function (c) {
          var gc = c.gc;
          var ch = gc.rs > 1 ? c.h : it.h;
          var bg = gc.cell.bg || (head && tb.borders ? headBg : null);
          var ops = [];
          if (bg) ops.push({ t: 'rect', x: gc.x, y: 0, w: gc.w, h: ch, fill: bg });
          if (border && !gc.cell.noBorder) ops.push({ t: 'rect', x: gc.x, y: 0, w: gc.w, h: ch, stroke: border, sw: 0.5 });
          P.ops(ops, x, y);
          var st = stackItem(c.kids, {});
          var dy = gc.pad;
          if (!c.cont && gc.cell.valign === 'middle') dy = Math.max(gc.pad, (ch - st.h) / 2);
          else if (!c.cont && gc.cell.valign === 'bottom') dy = Math.max(gc.pad, ch - st.h - gc.pad);
          st.paint(P, x + gc.x + gc.pad, y + dy);
        });
      };
      it.split = function (avail, force) {
        if (cellsIn.some(function (c) { return c.gc.rs > 1; })) return null;
        if (avail < tb.size * 2.4 + pad * 2 && !force) return null;
        var A = [], B = [];
        var ok = false;
        cellsIn.forEach(function (c) {
          var st = stackItem(c.kids, {});
          var room = avail - c.gc.pad * 2;
          if (st.h <= room) { A.push({ gc: c.gc, h: avail, kids: c.kids, cont: c.cont }); B.push({ gc: c.gc, h: 0, kids: [], cont: true }); return; }
          var r = takeFit(c.kids, room, true, true);
          if (r.taken.length) ok = true;
          A.push({ gc: c.gc, h: avail, kids: r.taken, cont: c.cont });
          B.push({ gc: c.gc, h: 0, kids: r.rest, cont: true });
        });
        if (!ok) return null;
        var bh = 0;
        B.forEach(function (c) { var hh = stackItem(c.kids, {}).h + c.gc.pad * 2; if (hh > bh) bh = hh; });
        B.forEach(function (c) { c.h = bh; });
        var a = rowItem(A, avail, head);
        var b = rowItem(B, bh, head);
        return [a, b];
      };
      return it;
    }
    var kids = rowItems.slice();
    var capItems = tb.caption ? this.blocks(tb.caption, width) : [];
    capItems.forEach(function (c) { c.kwn = true; c.sa = 3; });
    var headH = headItems.reduce(function (a, b) { return a + b.h; }, 0);
    var repeat = headItems.length && headH < this.opts.contentH * 0.35 ? headItems : null;
    var tableItem = stackItem(kids, { repeat: repeat });
    tableItem.sb = tb.size * 0.4;
    tableItem.sa = tb.size * 0.9;
    if (cw.minSum > width + 1) this.narrow = true;
    this.widest = Math.max(this.widest || 0, cw.minSum, Math.min(cw.natural, cw.n * 110));
    if (!capItems.length) return tableItem;
    return stackItem(capItems.concat([tableItem]), { sb: tb.size * 0.4, sa: tb.size * 0.9 });
  };

  /* ---------------------------------------------------------------- images */

  function dataUrlBytes(src) {
    var i = src.indexOf(',');
    var meta = src.slice(5, i);
    var body = src.slice(i + 1);
    if (/;base64/i.test(meta)) {
      var bin = atob(body.replace(/\s+/g, ''));
      var out = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
      return { mime: meta.split(';')[0].toLowerCase(), bytes: out };
    }
    return { mime: meta.split(';')[0].toLowerCase(), bytes: new TextEncoder().encode(decodeURIComponent(body)) };
  }
  function sniff(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png';
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpg';
    return '';
  }
  function decodeToPng(src, maxPixels) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || 300, h = img.naturalHeight || 150;
        var s = Math.min(1, Math.sqrt(maxPixels / Math.max(1, w * h)));
        var c = d.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s));
        c.height = Math.max(1, Math.round(h * s));
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (blob) {
          if (!blob) { reject(new Error('image')); return; }
          blob.arrayBuffer().then(function (b) { resolve({ bytes: new Uint8Array(b), w: w, h: h }); }, reject);
        }, 'image/png');
      };
      img.onerror = function () { reject(new Error('image')); };
      img.src = src;
    });
  }
  function embedImages(doc, list, warn, opts) {
    var chain = Promise.resolve();
    list.forEach(function (im) {
      chain = chain.then(function () {
        checkCancel(opts);
        var raw;
        try { raw = dataUrlBytes(im.src); } catch (e) { warn('img-bad', 'An image could not be read and was left out.'); return; }
        var kind = sniff(raw.bytes);
        var job;
        if (kind === 'png') job = doc.embedPng(raw.bytes);
        else if (kind === 'jpg') job = doc.embedJpg(raw.bytes);
        else job = decodeToPng(im.src, LIMIT.imagePixels).then(function (r) { return doc.embedPng(r.bytes); });
        return job.then(function (ref) {
          if (ref.width * ref.height > LIMIT.imagePixels * 1.5) { warn('img-big', 'A very large image was left out.'); return; }
          im.ref = ref; im.w = ref.width; im.h = ref.height;
        }).catch(function () {
          if (kind) return decodeToPng(im.src, LIMIT.imagePixels).then(function (r) { return doc.embedPng(r.bytes); }).then(function (ref) { im.ref = ref; im.w = ref.width; im.h = ref.height; });
          throw new Error('x');
        }).catch(function () { warn('img-bad', 'An image could not be read and was left out.'); });
      });
    });
    return chain;
  }

  /* ---------------------------------------------------------------- painting */

  function Painter(doc, pageW, pageH, margin, fonts, images, warn) {
    this.doc = doc; this.W = pageW; this.H = pageH; this.m = margin; this.fonts = fonts; this.images = images; this.warn = warn;
    this.page = null; this.pageIndex = -1;
    this.anchors = {}; this.links = []; this.outlines = [];
    this.lib = global.PDFLib;
  }
  Painter.prototype.newPage = function () {
    this.page = this.doc.addPage([this.W, this.H]);
    this.pageIndex++;
    return this.page;
  };
  Painter.prototype.color = function (c) { var L = this.lib; c = c || [0, 0, 0]; return L.rgb(c[0], c[1], c[2]); };
  /* ops are relative to (x, y) measured from the content box's top-left */
  Painter.prototype.ops = function (ops, x, y) {
    var pg = this.page, L = this.lib, self = this;
    var ox = this.m.left + x, oy = this.m.top + y;
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.t === 'text') {
        if (!o.text) continue;
        var spec = { x: ox + o.x, y: this.H - (oy + o.y), size: o.size, font: o.face.font, color: this.color(o.color) };
        if (o.skew) spec.ySkew = L.degrees(12); /* pdf-lib's ySkew is the horizontal shear (oblique) */
        try { pg.drawText(o.text, spec); }
        catch (e) { this.charByChar(o, spec); }
      } else if (o.t === 'rect') {
        var r = { x: ox + o.x, y: this.H - (oy + o.y + o.h), width: Math.max(0.1, o.w), height: Math.max(0.1, o.h) };
        if (o.fill) r.color = this.color(o.fill);
        if (o.stroke) { r.borderColor = this.color(o.stroke); r.borderWidth = o.sw || 0.5; }
        if (!o.fill && !o.stroke) continue;
        pg.drawRectangle(r);
      } else if (o.t === 'dot') {
        var e = { x: ox + o.cx, y: this.H - (oy + o.cy), xScale: o.r, yScale: o.r };
        if (o.hollow) { e.borderColor = this.color(o.fill); e.borderWidth = Math.max(0.5, o.r * 0.45); }
        else e.color = this.color(o.fill);
        pg.drawEllipse(e);
      } else if (o.t === 'line') {
        pg.drawLine({ start: { x: ox + o.x1, y: this.H - (oy + o.y) }, end: { x: ox + o.x2, y: this.H - (oy + o.y) }, thickness: o.w || 0.5, color: this.color(o.color) });
      } else if (o.t === 'img') {
        var im = this.images[o.key];
        if (im && im.ref) pg.drawImage(im.ref, { x: ox + o.x, y: this.H - (oy + o.y + o.h), width: o.w, height: o.h });
      } else if (o.t === 'link') {
        this.links.push({ page: this.page, href: o.href, rect: [ox + o.x, this.H - (oy + o.y + o.h), ox + o.x + o.w, this.H - (oy + o.y)] });
      }
    }
  };
  /* fontkit can fail on some contextual lookups; drawing one character at a time avoids them */
  Painter.prototype.charByChar = function (o, spec) {
    var x = spec.x;
    var chars = Array.from(o.text);
    for (var i = 0; i < chars.length; i++) {
      var s = Object.assign({}, spec, { x: x });
      try { this.page.drawText(chars[i], s); } catch (e) { /* skip this glyph */ }
      x += this.fonts.width(o.face, chars[i], o.size);
    }
  };
  Painter.prototype.anchor = function (ids, y) {
    var self = this;
    ids.forEach(function (id) { if (!self.anchors[id]) self.anchors[id] = { page: self.page, y: self.H - (self.m.top + y) + 4 }; });
  };
  Painter.prototype.outline = function (o, y) {
    this.outlines.push({ level: o.level, title: o.title, page: this.page, y: this.H - (this.m.top + y) + 6 });
  };
  Painter.prototype.finishLinks = function () {
    var L = this.lib, doc = this.doc, ctx = doc.context, self = this;
    var count = 0;
    this.links.forEach(function (lk) {
      var dict = { Type: 'Annot', Subtype: 'Link', Rect: lk.rect, Border: [0, 0, 0] };
      if (lk.href.charAt(0) === '#') {
        var a = self.anchors[decodeURIComponent(lk.href.slice(1))] || self.anchors[lk.href.slice(1)];
        if (!a) return;
        dict.Dest = [a.page.ref, 'XYZ', null, a.y, null];
      } else {
        dict.A = { Type: 'Action', S: 'URI', URI: L.PDFString.of(lk.href.replace(/[^\x21-\x7E]/g, function (c) { return encodeURIComponent(c); })) };
      }
      var ref = ctx.register(ctx.obj(dict));
      lk.page.node.addAnnot(ref);
      count++;
    });
    return count;
  };
  Painter.prototype.finishOutline = function () {
    var L = this.lib, doc = this.doc, ctx = doc.context;
    var list = this.outlines.filter(function (o) { return o.title; }).slice(0, 2000);
    if (!list.length) return 0;
    var root = { kids: [], level: 0 };
    var stack = [root];
    list.forEach(function (o) {
      while (stack.length > 1 && stack[stack.length - 1].level >= o.level) stack.pop();
      var node = { o: o, kids: [], level: o.level };
      stack[stack.length - 1].kids.push(node);
      stack.push(node);
    });
    var outlinesRef = ctx.nextRef();
    function build(nodes, parentRef) {
      var refs = nodes.map(function () { return ctx.nextRef(); });
      var total = 0;
      nodes.forEach(function (n, i) {
        var dict = ctx.obj({
          Title: L.PDFHexString.fromText(n.o.title),
          Parent: parentRef,
          Dest: [n.o.page.ref, 'XYZ', null, n.o.y, null]
        });
        if (i > 0) dict.set(L.PDFName.of('Prev'), refs[i - 1]);
        if (i < nodes.length - 1) dict.set(L.PDFName.of('Next'), refs[i + 1]);
        var sub = n.kids.length ? build(n.kids, refs[i]) : null;
        if (sub) {
          dict.set(L.PDFName.of('First'), sub.first);
          dict.set(L.PDFName.of('Last'), sub.last);
          dict.set(L.PDFName.of('Count'), L.PDFNumber.of(n.level <= 1 ? sub.count : -sub.count));
          total += sub.count;
        }
        ctx.assign(refs[i], dict);
        total++;
      });
      return { first: refs[0], last: refs[refs.length - 1], count: total };
    }
    var top = build(root.kids, outlinesRef);
    ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }));
    doc.catalog.set(L.PDFName.of('Outlines'), outlinesRef);
    doc.catalog.set(L.PDFName.of('PageMode'), L.PDFName.of('UseOutlines'));
    return list.length;
  };

  /* ---------------------------------------------------------------- page setup */

  function pageBox(opts) {
    var spec = opts.pageSize || 'A4';
    var w, h;
    if (Array.isArray(spec)) { w = spec[0]; h = spec[1]; }
    else if (spec && typeof spec === 'object') { w = num(spec.w, 595.28); h = num(spec.h, 841.89); }
    else {
      var key = Object.keys(PAGE).filter(function (k) { return k.toLowerCase() === String(spec).toLowerCase(); })[0] || 'A4';
      w = PAGE[key][0]; h = PAGE[key][1];
    }
    w = clamp(w, 144, 5000); h = clamp(h, 144, 5000);
    var o = String(opts.orientation || 'portrait');
    if (o === 'landscape' && h > w) { var t = w; w = h; h = t; }
    if ((o === 'portrait' || o === 'auto') && w > h) { var t2 = w; w = h; h = t2; }
    return { w: w, h: h };
  }
  function marginBox(m, pg) {
    if (m == null) m = 56.7;
    if (typeof m === 'number') m = { top: m, right: m, bottom: m, left: m };
    var lim = Math.min(pg.w, pg.h) * 0.3;
    return { top: clamp(num(m.top, 56.7), 0, lim), right: clamp(num(m.right, 56.7), 0, lim), bottom: clamp(num(m.bottom, 56.7), 0, lim), left: clamp(num(m.left, 56.7), 0, lim) };
  }
  function dateStamp() {
    var n = new Date();
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate());
  }
  function tpl(t) { return t && typeof t === 'object' ? String(t.text || '') : String(t || ''); }
  function tplAlign(t, d0) { return t && typeof t === 'object' && /^(left|center|right)$/.test(t.align) ? t.align : d0; }

  /* ---------------------------------------------------------------- main */

  async function render(input, opts) {
    opts = Object.assign({}, opts || {});
    var warnings = [];
    var seen = {};
    function warn(key, msg) { if (!seen[key]) { seen[key] = 1; warnings.push(msg); } }
    var t0 = Date.now();
    await ready();
    checkCancel(opts);
    var L = global.PDFLib;
    var scale = num(opts.scale, 1);
    if (scale > 3) scale = scale / 100;
    scale = clamp(scale, 0.4, 3);
    opts.scale = scale;
    opts.fontSize = clamp(num(opts.fontSize, 10.5), 6, 24) * scale;
    var pg = pageBox(opts);
    var margin = marginBox(opts.margin, pg);
    var chrome = { header: tpl(opts.header), footer: tpl(opts.footer) };
    if (opts.pageNumbers && !chrome.footer) chrome.footer = 'Page {page} of {pages}';
    if (chrome.header) margin.top = Math.max(margin.top, 34);
    if (chrome.footer) margin.bottom = Math.max(margin.bottom, 34);

    /* parse */
    var root;
    if (typeof input === 'string') {
      var parsed = new DOMParser().parseFromString('<!DOCTYPE html><html><body>' + input + '</body></html>', 'text/html');
      root = parsed.body;
    } else if (input && input.nodeType) root = input.nodeType === 9 ? input.body : input;
    else root = new DOMParser().parseFromString('<p></p>', 'text/html').body;
    var B = new Builder(opts, warn);
    var blocks = B.blocksOf(root, B.baseStyle(), 0, null);
    if (B.truncated) warn('trunc', 'This document is very large; the end was cut short.');
    var allText = B.text.join('');
    var scripts = scriptsIn(allText);
    if (scripts.unsupported.length && !opts.allowUnsupported) {
      var err = new Error('This document uses ' + scripts.unsupported.join(', ') + ' text, which the text PDF writer cannot lay out yet.');
      err.unsupportedScripts = scripts.unsupported;
      throw err;
    }
    checkCancel(opts);
    if (typeof opts.onProgress === 'function') opts.onProgress(0.15, 'Fonts');

    /* fonts: load what the document uses, plus the Unicode fallback when needed */
    var doc = await L.PDFDocument.create();
    var title = String(opts.title || B.title || '').trim().slice(0, 200);
    if (title) doc.setTitle(title, { showInWindowTitleBar: true });
    if (opts.author) doc.setAuthor(String(opts.author).slice(0, 200));
    if (opts.subject) doc.setSubject(String(opts.subject).slice(0, 300));
    doc.setCreator('LocalEditor');
    doc.setProducer('LocalEditor (pdf-lib)');
    try { doc.setLanguage(String(opts.lang || 'en')); } catch (e) {}
    var fonts = new FontBox(doc);
    if (opts.standardFonts) fonts.std = true;
    var combos = B.combos;
    var base = opts.base === 'serif' ? 'serif' : 'sans';
    combos[base] = [base, false, false];
    await Promise.all(Object.keys(combos).map(function (k) { return fonts.load(combos[k][0], combos[k][1], combos[k][2]); }));
    /* the Unicode fallback is embedded only when some character is not in the faces already loaded */
    var loaded = Object.keys(fonts.faces).map(function (k) { return fonts.faces[k]; }).filter(Boolean);
    var seenCp = new Set();
    var needFallback = false;
    for (var ci = 0; ci < allText.length && !needFallback; ci++) {
      var cp = allText.codePointAt(ci);
      if (cp > 0xFFFF) ci++;
      if (cp < 0x7F || seenCp.has(cp)) continue;
      seenCp.add(cp);
      if (cp === 0xAD || cp === 0xA0 || (cp >= 0x200B && cp <= 0x200D) || cp === 0xFEFF) continue;
      if (!loaded.some(function (f) { return fonts.covers(f, cp); })) needFallback = true;
    }
    if (needFallback) await Promise.all([fonts.load('uni', false, false), fonts.load('uni', true, false), fonts.load('mono', false, false)]);
    if (Object.keys(fonts.faces).some(function (k) { return fonts.faces[k] && fonts.faces[k].std; })) warn('stdfonts', 'The document fonts could not be loaded, so standard PDF fonts were used. Characters outside Western European text may show as “?”.');
    checkCancel(opts);
    if (typeof opts.onProgress === 'function') opts.onProgress(0.3, 'Images');
    await embedImages(doc, B.images, warn, opts);

    /* layout */
    if (typeof opts.onProgress === 'function') opts.onProgress(0.45, 'Layout');
    function layoutAt(pgBox) {
      var contentW = pgBox.w - margin.left - margin.right;
      var contentH = pgBox.h - margin.top - margin.bottom;
      var lay = new Lay(fonts, Object.assign({}, opts, { contentW: contentW, contentH: contentH }), B.images, warn);
      var items = lay.blocks(blocks, contentW);
      return { lay: lay, items: items, contentW: contentW, contentH: contentH, pg: pgBox };
    }
    var L1 = layoutAt(pg);
    if (opts.orientation === 'auto' && (L1.lay.widest || 0) > L1.contentW * 1.08) {
      var land = { w: pg.h, h: pg.w };
      L1 = layoutAt(land);
      pg = land;
      warn('landscape', 'Wide tables: pages are landscape so more columns fit.');
    }
    if (L1.lay.narrow) warn('narrow', 'Some table columns are narrower than their longest word, so a few words break across lines.');
    if (L1.lay.missing) warn('missing', L1.lay.missing + ' character' + (L1.lay.missing === 1 ? '' : 's') + ' (such as emoji or rare symbols) had no matching font and show as “?”.');
    checkCancel(opts);

    /* paginate and paint */
    var P = new Painter(doc, pg.w, pg.h, margin, fonts, B.images, warn);
    var queue = L1.items;
    var maxPages = clamp(num(opts.maxPages, LIMIT.pages), 1, LIMIT.pages);
    var pages = 0;
    if (!queue.length) { P.newPage(); pages = 1; }
    while (queue.length) {
      if (pages >= maxPages) { warn('pages', 'Stopped after ' + maxPages + ' pages.'); break; }
      P.newPage();
      pages++;
      var r = takeFit(queue, L1.contentH, true, true);
      var y = 0;
      r.taken.forEach(function (it, idx) {
        var sb = idx === 0 ? 0 : Math.max(it.sb || 0, r.taken[idx - 1].sa || 0);
        y += sb;
        it.paint(P, 0, y);
        y += it.h;
      });
      if (!r.taken.length && r.rest.length === queue.length) {
        /* cannot place anything (should not happen): drop the item so we never loop forever */
        r.rest = queue.slice(1);
      }
      queue = r.rest;
      if (pages % 25 === 0) {
        checkCancel(opts);
        if (typeof opts.onProgress === 'function') opts.onProgress(0.45 + 0.4 * Math.min(1, pages / 200), 'Pages');
        await tick();
      }
    }
    /* header / footer */
    var chromeFace = fonts.get(base, false, false) || fonts.get('sans', false, false);
    if ((chrome.header || chrome.footer) && chromeFace) {
      var all = doc.getPages();
      var info = { pages: all.length, date: dateStamp(), file: String(opts.fileName || '').replace(/\.[^.]+$/, '').slice(0, 80), title: title };
      var lay2 = new Lay(fonts, opts, [], warn);
      all.forEach(function (page, i) {
        var vals = Object.assign({}, info, { page: i + 1 });
        [['header', chrome.header, opts.header, 'left', margin.top / 2 + 3], ['footer', chrome.footer, opts.footer, 'center', pg.h - margin.bottom / 2 + 3]].forEach(function (c) {
          if (!c[1]) return;
          var text = c[1].replace(/\{(page|pages|date|file|title)\}/g, function (_, k) { return String(vals[k] == null ? '' : vals[k]); });
          var segs = lay2.segments(text, { fam: base, b: false, i: false, size: 8.5 });
          var w = 0; segs.forEach(function (s) { s.w = fonts.width(s.face, s.text, 8.5); w += s.w; });
          var al = tplAlign(c[2], c[3]);
          var x = al === 'left' ? margin.left : al === 'right' ? pg.w - margin.right - w : (pg.w - w) / 2;
          segs.forEach(function (s) {
            try { page.drawText(s.text, { x: x, y: pg.h - c[4], size: 8.5, font: s.face.font, color: L.rgb(0.42, 0.42, 0.46) }); } catch (e) {}
            x += s.w;
          });
        });
      });
    }
    var linkCount = P.finishLinks();
    var outlineCount = opts.outline === false ? 0 : P.finishOutline();
    if (typeof opts.onProgress === 'function') opts.onProgress(0.9, 'Saving');
    checkCancel(opts);
    var bytes = await doc.save({ useObjectStreams: true });
    var faces = [];
    Object.keys(fonts.faces).forEach(function (k) { var f = fonts.faces[k]; if (f && faces.indexOf(f.name) < 0) faces.push(f.name); });
    return {
      bytes: bytes, pageCount: pages, warnings: warnings, mode: 'text',
      title: title, links: linkCount, outline: outlineCount, fonts: faces,
      scripts: scripts, pageSize: [pg.w, pg.h], ms: Date.now() - t0, missing: L1.lay.missing
    };
  }

  /* quick check before converting: does this HTML need a script the engine cannot shape? */
  function check(html) {
    var text;
    if (typeof html === 'string') {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      text = doc.body ? doc.body.textContent : '';
    } else text = html && html.textContent || '';
    return scriptsIn(text);
  }

  LE.pdfFlow = {
    version: 1,
    render: render,
    check: check,
    scriptsIn: scriptsIn,
    supportedScripts: SUPPORTED_SCRIPTS.slice(),
    faces: function () { return Object.keys(FACES).map(function (k) { return { role: k, family: FACES[k].family }; }); },
    pageSizes: Object.keys(PAGE),
    _internals: { parseColor: parseColor, parseLen: parseLen, takeFit: takeFit, Builder: Builder, Lay: Lay }
  };
})(typeof window !== 'undefined' ? window : globalThis);
