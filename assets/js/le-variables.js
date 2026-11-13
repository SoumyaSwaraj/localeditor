/* LocalEditor: template variables and bulk create (roadmap 2.6). LE.variables — the model, the filler and the bulk engine.
   Docs: docs/VARIABLES.md. Pure data in, pixels and files out; nothing leaves the device.

   - {{name}} anywhere in a text layer, with a closed set of declarative pipes ({{price|currency:INR}}, {{date|date:long}},
     {{name|upper}}, {{name|title}}, {{count|number}}, {{x|default:—}}) and the row counter {{#}} / {{#total}}.
     No expressions, no script: an unknown pipe is drawn literally and reported by lint.
   - layer.bind { content, color, show, fit }: a photo slot or QR code filled from a field, a colour, show / hide.
   - doc.values on a page: what that page is filled with. The template layers are never changed by filling.
   - Bulk: rows in (CSV, TSV, XLSX, pasted cells, typed), one file per row out, built one row at a time so memory stays flat.

   Loaded lazily: by LE.varBoot (le-objects.js) when a page with values is drawn, or by the studio's Fields panel. */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  if (LE.variables) return;

  var VERSION = 1;
  var KEY = /^[A-Za-z_][\w.-]{0,39}$/;
  var TYPES = ['text', 'number', 'date', 'image', 'colour', 'url', 'boolean'];
  var PIPES = ['upper', 'lower', 'title', 'number', 'currency', 'date', 'default'];
  var DATE_STYLES = ['long', 'medium', 'short', 'iso', 'year', 'month', 'day', 'weekday'];
  var BASE = (function () {
    try { return (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^\/]*$/, '') : (LE.varBoot && LE.varBoot.src ? LE.varBoot.src.replace(/[^\/]*$/, '') : '../assets/js/'); } catch (e) { return '../assets/js/'; }
  })();
  var VENDOR = BASE.replace(/js\/$/, 'vendor/');

  /* Caps. Rows are the person's list; the phone caps follow LE.device.tier (measured in docs/VARIABLES.md). */
  var LIMITS = {
    fileBytes: 50 * 1024 * 1024, xlsxBytes: 25 * 1024 * 1024, cell: 2000, columns: 60, pasteChars: 5 * 1024 * 1024,
    rows: { desktop: 5000, modern: 2000, older: 500 }, photos: 3000, photoBytes: 40 * 1024 * 1024, pages: 50, qr: 1200,
    zipBytes: 3.5 * 1024 * 1024 * 1024, nameChars: 100, pattern: 200
  };
  function tier() { try { return LE.device && LE.device.tier ? LE.device.tier() : 'desktop'; } catch (e) { return 'desktop'; } }
  function rowCap() {
    var t = tier(), cap = LIMITS.rows[t] || LIMITS.rows.desktop;
    try { if (LE.perf && LE.perf.mode && LE.perf.mode() === 'saver') cap = Math.min(cap, LIMITS.rows.older); } catch (e) {}
    return cap;
  }

  /* ---------- small helpers ---------- */
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function clean(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, n || LIMITS.cell); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }
  function locale() { return LE.variables && LE.variables.locale || (global.navigator && navigator.language) || 'en-US'; }
  function labelOf(key) {
    var s = String(key).replace(/[_.-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
  }

  /* =====================================================================
     1. Placeholders and pipes
     ===================================================================== */
  var TOKEN = /\{\{([^{}]{0,240})\}\}/g;
  /* One {{…}}: { key, pipes: [{ name, arg }], bad: [why] } or null when the inside is not a field (left as text). */
  function parseToken(inner) {
    var parts = String(inner).split('|');
    var key = parts[0].trim();
    if (!(KEY.test(key) || key === '#' || key === '#total')) return null;
    var pipes = [], bad = [];
    parts.slice(1).forEach(function (p) {
      var i = p.indexOf(':');
      var name = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase();
      var arg = i < 0 ? null : p.slice(i + 1).trim();
      if (PIPES.indexOf(name) < 0) { bad.push('unknown pipe "' + name.slice(0, 20) + '"'); return; }
      if (name === 'number' && arg != null && arg !== '' && !/^[0-6]$/.test(arg)) { bad.push('number takes 0–6 decimals'); return; }
      if (name === 'currency' && !(arg && /^[A-Za-z]{3}$/.test(arg))) { bad.push('currency needs a code like INR or USD'); return; }
      if (name === 'date' && arg != null && arg !== '' && DATE_STYLES.indexOf(arg.toLowerCase()) < 0) { bad.push('date is one of ' + DATE_STYLES.join(', ')); return; }
      if (name === 'default' && arg != null && arg.length > 200) { bad.push('default is up to 200 characters'); return; }
      pipes.push({ name: name, arg: arg });
    });
    return { key: key, pipes: pipes, bad: bad };
  }
  function tokens(text) {
    var out = [];
    String(text == null ? '' : text).replace(TOKEN, function (raw, inner, at) {
      var t = parseToken(inner);
      if (t) { t.raw = raw; t.at = at; out.push(t); }
      return raw;
    });
    return out;
  }
  function hasTokens(text) { return tokens(text).length > 0; }

  /* Numbers as people type them: "1,234.50", "1.234,50", "₹ 1 200", "12%". */
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v === 'boolean' || v == null) return NaN;
    var s = String(v).trim().replace(/[\s  ']/g, '').replace(/^[^\d+\-.,]+|[^\d.,%]+$/g, '').replace(/%$/, '');
    if (!s || !/^[+-]?[\d.,]+$/.test(s)) return NaN;
    var c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c >= 0) s = /^[+-]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : (s.split(',').length === 2 ? s.replace(',', '.') : 'x');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(y, m, d) {
    if (!(y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  /* A date as people write it → "YYYY-MM-DD", or null. Day first for d/m/y (most of the world); 13+ in the first place reads m/d. */
  function toDate(v) {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    if (typeof v === 'number') return v > 20000 && v < 80000 ? excelDate(v) : null;
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s))) return isoOf(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s))) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      return a > 12 ? isoOf(y, b, a) : b > 12 ? isoOf(y, a, b) : isoOf(y, b, a);
    }
    if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(s))) { var mi = monthIndex(m[2]); return mi ? isoOf(+m[3], mi, +m[1]) : null; }
    if ((m = /^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) { var mj = monthIndex(m[1]); return mj ? isoOf(+m[3], mj, +m[2]) : null; }
    if (/^\d{5}(\.\d+)?$/.test(s)) return excelDate(Number(s));
    return null;
  }
  function monthIndex(w) { w = w.toLowerCase(); for (var i = 0; i < 12; i++) if (MONTHS[i].indexOf(w) === 0 && w.length >= 3) return i + 1; return 0; }
  function excelDate(n) { var t = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  function fmtDate(v, style) {
    var iso = toDate(v);
    if (!iso) return String(v);
    style = (style || 'long').toLowerCase();
    if (style === 'iso') return iso;
    var p = iso.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    var o = { timeZone: 'UTC' };
    if (style === 'long') { o.day = 'numeric'; o.month = 'long'; o.year = 'numeric'; }
    else if (style === 'medium') { o.day = 'numeric'; o.month = 'short'; o.year = 'numeric'; }
    else if (style === 'short') { o.day = '2-digit'; o.month = '2-digit'; o.year = 'numeric'; }
    else if (style === 'year') o.year = 'numeric';
    else if (style === 'month') o.month = 'long';
    else if (style === 'day') o.day = 'numeric';
    else if (style === 'weekday') o.weekday = 'long';
    try { return new Intl.DateTimeFormat(locale(), o).format(d); } catch (e) { return iso; }
  }
  function titleCase(s) {
    return String(s).toLocaleLowerCase(locale()).replace(/(^|[\s\-‐(\/"“'‘])(\p{L})/gu, function (m, a, b) { return a + b.toLocaleUpperCase(locale()); });
  }
  function applyPipes(v, pipes) {
    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      if (p.name === 'default') { if (v == null || v === '') v = p.arg == null ? '' : p.arg; continue; }
      if (v == null || v === '') continue;
      if (p.name === 'upper') v = String(v).toLocaleUpperCase(locale());
      else if (p.name === 'lower') v = String(v).toLocaleLowerCase(locale());
      else if (p.name === 'title') v = titleCase(v);
      else if (p.name === 'number' || p.name === 'currency') {
        var n = toNumber(v);
        if (!isFinite(n)) continue;
        try {
          var o = p.name === 'currency' ? { style: 'currency', currency: p.arg.toUpperCase() } : {};
          if (p.name === 'currency' && n % 1 === 0) { o.minimumFractionDigits = 0; o.maximumFractionDigits = 0; }   /* ₹899, not ₹899.00 */
          if (p.name === 'number' && p.arg != null && p.arg !== '') { o.minimumFractionDigits = +p.arg; o.maximumFractionDigits = +p.arg; }
          else if (p.name === 'number') o.maximumFractionDigits = 2;
          v = new Intl.NumberFormat(locale(), o).format(n);
        } catch (e) { /* keep the value */ }
      } else if (p.name === 'date') v = fmtDate(v, p.arg);
    }
    return v == null ? '' : String(v);
  }
  /* fillText(text, values, { missing: 'keep' | 'empty' }) → { text, used, missing, unknown }. One pass: a value that
     contains {{…}} is never expanded again, and values are only ever text drawn on a canvas. */
  function fillText(text, values, opts) {
    opts = opts || {};
    values = values || {};
    var used = [], missing = [], unknown = [];
    var out = String(text == null ? '' : text).replace(TOKEN, function (raw, inner) {
      var t = parseToken(inner);
      if (!t) return raw;
      if (t.bad.length) { unknown.push({ token: raw, why: t.bad.join('; ') }); return raw; }
      if (!own(values, t.key)) {
        if (t.key === '#' || t.key === '#total') return '1';
        missing.push(t.key);
        if (opts.missing === 'empty' || t.pipes.some(function (p) { return p.name === 'default'; })) return clean(applyPipes('', t.pipes), 4000);
        return raw;
      }
      if (used.indexOf(t.key) < 0) used.push(t.key);
      var v = values[t.key];
      if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
      return clean(applyPipes(v, t.pipes), 4000);
    });
    return { text: out, used: used, missing: missing, unknown: unknown };
  }

  /* =====================================================================
     2. Which fields a design uses, and the variable list
     ===================================================================== */
  function guessType(key, how) {
    if (how) return how;
    var k = String(key).toLowerCase();
    if (/(^|_|-|\b)(photo|image|picture|pic|logo|avatar|headshot|portrait|img)s?$/.test(k) || /photo|image|picture/.test(k)) return 'image';
    if (/colou?r|hex|tint/.test(k)) return 'colour';
    if (/(^|_|-)(date|dob|birthday|when|day)$|date/.test(k)) return 'date';
    if (/price|amount|cost|total|qty|quantity|count|score|marks|points|number|age$/.test(k)) return 'number';
    if (/url|link|website|qr|upi|href/.test(k)) return 'url';
    if (/^(is|has|show)[_-]?|vip|visible|enabled/.test(k)) return 'boolean';
    return 'text';
  }
  /* detect(pages) → [{ key, type?, uses: [{ page, layer, as }] }] in first-use order. */
  function detect(pages) {
    var map = {}, order = [];
    function use(key, pi, l, as, type) {
      if (key === '#' || key === '#total') return;
      if (!map[key]) { map[key] = { key: key, uses: [], type: null }; order.push(key); }
      map[key].uses.push({ page: pi, layer: l.id, as: as });
      if (type && !map[key].type) map[key].type = type;
    }
    (pages || []).forEach(function (pg, pi) {
      (pg && pg.layers || []).forEach(function (l) {
        if (l.type === 'text') tokens(l.text).forEach(function (t) {
          var ty = null;
          t.pipes.forEach(function (p) { if (p.name === 'date') ty = 'date'; if (p.name === 'number' || p.name === 'currency') ty = 'number'; });
          use(t.key, pi, l, 'text', ty);
        });
        var b = l.bind;
        if (!b) return;
        if (b.content) use(b.content, pi, l, l.type === 'image' ? 'photo' : 'qr', l.type === 'image' ? 'image' : 'url');
        if (b.color) use(b.color, pi, l, 'colour', 'colour');
        if (b.show) use(b.show.replace(/^!/, ''), pi, l, 'show', 'boolean');
      });
    });
    return order.map(function (k) { return map[k]; });
  }
  /* The design's variables: the saved list (labels, types, samples) merged with what the layers use. */
  function definitions(project) {
    var st = (project && project.meta && project.meta.studio) || {};
    var saved = (LE.Scene && LE.Scene.variablesOf ? LE.Scene.variablesOf(st.variables || []) : st.variables) || [];
    var found = detect(project && project.pages);
    var byKey = {};
    found.forEach(function (f) { byKey[f.key] = f; });
    var out = saved.map(function (v) {
      var f = byKey[v.key];
      var o = Object.assign({}, v);
      o.uses = f ? f.uses : [];
      if (!f) o.unused = true;
      delete byKey[v.key];
      return o;
    });
    found.forEach(function (f) {
      if (!byKey[f.key]) return;
      out.push({ key: f.key, label: labelOf(f.key), type: guessType(f.key, f.type), uses: f.uses });
    });
    return out;
  }
  function storedList(defs) {
    return defs.filter(function (d) { return !d.unused || d.keep; }).map(function (d) {
      var o = { key: d.key, label: d.label || labelOf(d.key), type: TYPES.indexOf(d.type) >= 0 ? d.type : 'text' };
      if (d.default != null && d.default !== '') o.default = d.default;
      if (d.sample != null && d.sample !== '') o.sample = d.sample;
      if (d.required) o.required = true;
      return o;
    });
  }
  /* Rename a field everywhere in one document: text tokens (pipes kept), bindings, values, the saved list.
     Works on plain pages; returns how many places changed. */
  function renamePages(pages, from, to) {
    var n = 0;
    var rx = new RegExp('\\{\\{(\\s*)' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s*)(\\||\\}\\})', 'g');
    (pages || []).forEach(function (pg) {
      (pg.layers || []).forEach(function (l) {
        if (l.type === 'text' && l.text && l.text.indexOf('{{') >= 0) {
          var t = l.text.replace(rx, function (m, a, b, c) { n++; return '{{' + a + to + b + c; });
          l.text = t;
        }
        if (l.bind) ['content', 'color', 'show'].forEach(function (k) {
          var v = l.bind[k];
          if (!v) return;
          var neg = v.charAt(0) === '!';
          if ((neg ? v.slice(1) : v) === from) { l.bind[k] = (neg ? '!' : '') + to; n++; }
        });
      });
      if (pg.values && own(pg.values, from)) {
        var o = {};
        Object.keys(pg.values).forEach(function (k) { o[k === from ? to : k] = pg.values[k]; });
        pg.values = o;
      }
    });
    return n;
  }
  function renameList(list, from, to) {
    return (list || []).map(function (v) { return v.key === from ? Object.assign({}, v, { key: to }) : v; });
  }
  /* A free key from a label: "First name" → "first_name", unique among taken keys. */
  function keyFrom(label, taken) {
    var k = String(label || 'field').normalize ? String(label || 'field').normalize('NFKD').replace(/[̀-ͯ]/g, '') : String(label || 'field');
    k = k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'field';
    if (!/^[a-z_]/.test(k)) k = 'f_' + k;
    var base = k, i = 2;
    taken = taken || [];
    while (taken.indexOf(k) >= 0) k = base + '_' + (i++);
    return k;
  }

  /* =====================================================================
     3. Drawing a page with its values (the hook in LE.Scene._filled)
     ===================================================================== */
  var mctx = null;
  function measureCtx() {
    if (mctx) return mctx;
    try { var c = document.createElement('canvas'); c.width = c.height = 8; mctx = c.getContext('2d'); } catch (e) { mctx = null; }
    return mctx;
  }
  function fontOf(l, size) {
    var fam = LE.Scene && LE.Scene.fontFamily ? LE.Scene.fontFamily(l.font) : '"' + (l.font || 'sans-serif') + '", sans-serif';
    return (l.italic ? 'italic ' : 'normal ') + (l.weight || 400) + ' ' + size + 'px ' + fam;
  }
  function measure(l, text, size) {
    var ctx = measureCtx();
    if (!ctx || !LE.Scene || !LE.Scene.wrapText) return null;
    var sp = (l.letterSpacing || 0) * size / (l.size || size);
    ctx.font = fontOf(l, size);
    var t = l.uppercase ? String(text).toUpperCase() : String(text);
    var w = Math.max(1, l.w);
    var lines = LE.Scene.wrapText(ctx, t, w, sp);
    var broke = t.split(/\s+/).some(function (word) { return word && LE.Scene.textWidth(ctx, word, sp) > w + 0.5; });
    return { lines: lines, height: lines.length * size * (l.lineHeight || 1.2), broke: broke, sp: sp, ctx: ctx };
  }
  /* Fit filled text to its box: shrink (default), wrap, or cut with an ellipsis. Returns { size, text, overflow }. */
  function fitText(l, text) {
    var mode = l.overflow || 'shrink', size = l.size || 48, h = Math.max(1, l.h);
    if (l.curve) return { size: size, text: text, overflow: false };
    var m = measure(l, text, size);
    if (!m) return { size: size, text: text, overflow: false };
    var fits = function (mm) { return mm.height <= h * 1.04 + 1 && !mm.broke; };
    if (fits(m)) return { size: size, text: text, overflow: false };
    if (mode === 'wrap') return { size: size, text: text, overflow: m.height > h * 1.04 + 1, grew: true };
    if (mode === 'ellipsis') {
      var lh = size * (l.lineHeight || 1.2), max = Math.max(1, Math.floor((h + 1) / lh));
      var lines = m.lines.slice(0, max), last = lines[lines.length - 1] || '';
      if (m.lines.length > max || m.broke) {
        var ctx = m.ctx, w = Math.max(1, l.w);
        while (last && LE.Scene.textWidth(ctx, last + '…', m.sp) > w) last = last.slice(0, -1);
        lines[lines.length - 1] = last.replace(/[\s,;:.\-–—]+$/, '') + '…';
      }
      return { size: size, text: lines.join('\n'), overflow: false, cut: true };
    }
    var min = l.minSize || Math.max(6, Math.round(size * 0.4 * 4) / 4);
    if (min >= size) return { size: size, text: text, overflow: true };
    var lo = min, hi = size, ml = measure(l, text, lo);
    if (!fits(ml)) return { size: lo, text: text, overflow: true };
    for (var i = 0; i < 14 && hi - lo > 0.25; i++) { var mid = (lo + hi) / 2; if (fits(measure(l, text, mid))) lo = mid; else hi = mid; }
    return { size: Math.floor(lo * 4) / 4, text: text, overflow: false, shrunk: true };
  }
  function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s || /^(no|n|false|f|0|off|hide|hidden|-|–|—|×|✗|✘|nein|non)$/.test(s)) return false;
    return true;
  }
  function parseBool(v) {
    if (typeof v === 'boolean') return v;
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (/^(yes|y|true|t|1|on|x|✓|✔|show|ja|oui|si|sí)$/.test(s)) return true;
    if (!s || /^(no|n|false|f|0|off|hide|-|nein|non)$/.test(s)) return false;
    return null;
  }
  function hexOf(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (s.charAt(0) !== '#') s = '#' + s;
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null;
    if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return s.toUpperCase();
  }
  /* QR codes for a QR layer bound to a field: the same encoder and drawing as the studio's QR tool and the makers. */
  var qrJob = null, qrCache = {}, qrCount = 0;
  function qrLib() {
    if (global.qrcode) return Promise.resolve(global.qrcode);
    if (!qrJob) { qrJob = LE.lazy(VENDOR + 'qrcode.js').then(function () { redrawAll(); return global.qrcode; }); qrJob.catch(function () { qrJob = null; }); }
    return qrJob;
  }
  function qrColours(svg) {
    var fills = String(svg || '').match(/fill="(#[0-9a-fA-F]{3,8})"/g) || [];
    var c = fills.map(function (f) { return f.slice(6, -1); });
    var hasRect = /<rect[^>]*fill="#/.test(svg || '');
    return { bg: hasRect ? c[0] : null, fg: (hasRect ? c[1] : c[0]) || '#17131F' };
  }
  function qrMarkup(text, fg, bg) {
    var k = fg + '|' + bg + '|' + text;
    if (qrCache[k]) return qrCache[k];
    var q = global.qrcode;
    if (!q) { qrLib(); return null; }
    if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
    var code;
    try { code = q(0, 'M'); code.addData(String(text).slice(0, LIMITS.qr), 'Byte'); code.make(); } catch (e) { return null; }
    var n = code.getModuleCount(), pad = 4, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (code.isDark(r, c)) d += 'M' + (c + pad) + ' ' + (r + pad) + 'h1v1h-1z';
    var S = n + pad * 2;
    var markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S + '" shape-rendering="crispEdges">' +
      (bg ? '<rect width="' + S + '" height="' + S + '" fill="' + bg + '"/>' : '') + '<path d="' + d + '" fill="' + fg + '"/></svg>';
    if (++qrCount > 64) { qrCache = {}; qrCount = 0; }
    qrCache[k] = markup;
    return markup;
  }
  var scenes = [];
  function redrawAll() { scenes = scenes.filter(function (s) { return !s._dead; }); scenes.forEach(function (s) { try { s._mark(); } catch (e) {} }); }
  function assetDims(scene, id) {
    var rec = scene && scene._assets && scene._assets[id];
    if (!rec) return null;
    var n = rec.canvas || rec.image;
    var w = n && (n.naturalWidth || n.width), h = n && (n.naturalHeight || n.height);
    return w && h ? { w: w, h: h } : { pending: true };
  }
  /* A photo in a frame: cover-cropped around the template's focal point (the centre of its crop), or contained. */
  function coverCrop(iw, ih, W, H, focal) {
    var A = iw / ih, T = W / H, c = { x: 0, y: 0, w: 1, h: 1 };
    var fx = focal ? focal.x : 0.5, fy = focal ? focal.y : 0.5;
    if (A > T) { c.w = T / A; c.x = clamp(fx - c.w / 2, 0, 1 - c.w); } else { c.h = A / T; c.y = clamp(fy - c.h / 2, 0, 1 - c.h); }
    return c;
  }
  /* fillWith(layer, values, env) → the layer as drawn (a copy), the same layer, or null when hidden.
     env: { dims(id) → {w,h}|null, missing: 'keep'|'empty', report?(kind, info) }. */
  function fillWith(layer, vals, env) {
    env = env || {};
    var b = layer.bind, copy = null;
    function cp() { return copy || (copy = Object.assign({}, layer)); }
    if (b && b.show) {
      var neg = b.show.charAt(0) === '!', sk = neg ? b.show.slice(1) : b.show;
      if (own(vals, sk)) { var on = truthy(vals[sk]); if (neg ? on : !on) return null; }
    }
    if (b && b.color && own(vals, b.color)) {
      var hx = hexOf(vals[b.color]);
      if (hx) {
        if (layer.type === 'shape') cp().fill = { type: 'solid', color: hx };
        else if (layer.type === 'text') { cp().color = hx; copy.fill = null; }
        else if (layer.type === 'svg' && !(b.content && layer.svg && /<path d="M\d/.test(layer.svg))) cp().color = hx;
        else if (layer.type === 'path') cp().color = hx;
      } else if (env.report && vals[b.color] !== '') env.report('bad-colour', { layer: layer.id, key: b.color, value: vals[b.color] });
    }
    if (layer.type === 'text' && layer.text && layer.text.indexOf('{{') >= 0) {
      var f = fillText(layer.text, vals, { missing: env.missing });
      if (f.unknown.length && env.report) env.report('unknown-pipe', { layer: layer.id, unknown: f.unknown });
      if (f.text !== layer.text) {
        var fit = fitText(layer, f.text);
        cp().text = fit.text;
        if (fit.size !== layer.size) {
          copy.size = fit.size;
          if (layer.letterSpacing) copy.letterSpacing = layer.letterSpacing * fit.size / layer.size;
        }
        if (fit.overflow && env.report) env.report('overflow', { layer: layer.id, name: layer.name, size: fit.size });
        if (fit.cut && env.report) env.report('cut', { layer: layer.id, name: layer.name });
      }
    }
    if (b && b.content && layer.type === 'image' && !layer.src && env.missing === 'empty' && (!own(vals, b.content) || vals[b.content] === '')) return null;   /* an empty frame is not printed */
    if (b && b.content && own(vals, b.content) && vals[b.content] !== '') {
      var v = vals[b.content];
      if (layer.type === 'image') {
        var id = env.photo ? env.photo(v) : v;
        var dm = id && env.dims ? env.dims(id) : null;
        if (dm && dm.w) {
          var c = cp();
          c.src = id;
          var crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
          var focal = { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 };
          if (layer.slot && layer.slot.focus) focal = layer.slot.focus;
          if (b.fit === 'contain') {
            var s = Math.min(layer.w / dm.w, layer.h / dm.h), nw = dm.w * s, nh = dm.h * s;
            c.x = layer.x + (layer.w - nw) / 2; c.y = layer.y + (layer.h - nh) / 2; c.w = nw; c.h = nh;
            c.crop = { x: 0, y: 0, w: 1, h: 1 };
            if (layer.cutout) delete c.cutout;
          } else {
            c.crop = coverCrop(dm.w, dm.h, Math.max(1, layer.w), Math.max(1, layer.h), layer.src ? focal : null);
            if (layer.cutout) delete c.cutout;
          }
        } else {
          if (env.report && !(dm && dm.pending)) env.report('missing-photo', { layer: layer.id, key: b.content, value: v });
          if (env.missing === 'empty' && !layer.src) return null;
        }
      } else if (layer.type === 'svg') {
        var col = qrColours(layer.svg);
        var mk = qrMarkup(String(v), col.fg, col.bg);
        if (mk) { cp().svg = mk; copy.assetId = ''; copy.color = null; }
        if (String(v).length > LIMITS.qr && env.report) env.report('qr-long', { layer: layer.id, key: b.content });
      }
    }
    return copy || layer;
  }
  /* The hook: LE.Scene.prototype._filled calls this for layers with fields when the page has values. Cached per layer. */
  function fillLayer(scene, layer, vals) {
    if (scenes.indexOf(scene) < 0) scenes.push(scene);
    var cache = scene._varCache || (scene._varCache = {});
    if (scene._varVals !== vals) { scene._varVals = vals; scene._varStamp = JSON.stringify(vals); }
    var dimsKey = '';
    if (layer.bind && layer.bind.content && layer.type === 'image') {
      var pv = vals[layer.bind.content], d = pv ? assetDims(scene, pv) : null;
      dimsKey = d ? (d.w || 0) + 'x' + (d.h || 0) : '-';
    }
    var sig = JSON.stringify(layer, function (k, v) { return k === 'svg' ? (v ? v.length + ':' + v.slice(-40) : '') : k === 'points' ? 0 : v; }) + '\u0001' + scene._varStamp + '\u0001' + (scene._fontEpoch || 0) + dimsKey + (global.qrcode ? 'q' : '');
    var hit = cache[layer.id];
    if (hit && hit.sig === sig) return hit.out;
    var out = fillWith(layer, vals, { dims: function (id) { return assetDims(scene, id); }, missing: scene._varMissing || 'keep' });
    cache[layer.id] = { sig: sig, out: out };
    return out;
  }
  /* Before a render: the QR encoder when a QR layer is bound, and the fonts the filled text needs. */
  function prepare(scene) {
    var d = scene && scene._doc;
    if (!d) return Promise.resolve();
    var jobs = [];
    if ((d.layers || []).some(function (l) { return l.type === 'svg' && l.bind && l.bind.content; }) && !global.qrcode) jobs.push(qrLib().catch(function () {}));
    if (LE.fonts && LE.fonts.load) (d.layers || []).forEach(function (l) { if (l.type === 'text' && l.text && l.text.indexOf('{{') >= 0) { try { jobs.push(Promise.resolve(LE.fonts.load(l.font, l.weight, !!l.italic)).catch(function () {})); } catch (e) {} } });
    return Promise.all(jobs).then(function () { if (scene._varCache) scene._varCache = {}; });
  }
  /* A filled copy of a plain page (for agents and checks). Hidden layers are dropped; values are removed. */
  function fillDoc(doc, values, opts) {
    opts = opts || {};
    var vals = values || doc.values || {};
    var probs = [];
    var env = { dims: opts.dims || function () { return null; }, photo: opts.photo, missing: opts.missing || 'empty', report: function (k, i) { probs.push(Object.assign({ kind: k }, i)); } };
    var out = clone(doc);
    delete out.values;
    out.layers = (doc.layers || []).map(function (l) { return LE.varBoot && LE.varBoot.touches(l) ? fillWith(l, vals, env) : l; }).filter(Boolean).map(clone);
    out.problems = probs;
    return out;
  }

  /* =====================================================================
     4. Your list: CSV / TSV / pasted cells / XLSX, on the device
     ===================================================================== */
  function decoderFor(bytes) {
    var b = bytes;
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return { enc: 'utf-8', skip: 3 };
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return { enc: 'utf-16le', skip: 2 };
    if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return { enc: 'utf-16be', skip: 2 };
    /* No BOM: UTF-8 if the start decodes strictly (a cut multi-byte character at the end is fine), else Windows-1252. */
    try { new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.min(b.length, 65536)), { stream: true }); return { enc: 'utf-8', skip: 0 }; } catch (e) { return { enc: 'windows-1252', skip: 0 }; }
  }
  /* Incremental RFC 4180 parser: quotes, doubled quotes, newlines in quotes, CRLF, ; , tab or | delimiters. */
  function CsvParser(delim, maxRows) {
    this.d = delim || null; this.max = maxRows || Infinity;
    this.rows = []; this.row = []; this.cell = ''; this.q = false; this.after = false; this.pend = ''; this.cr = false; this.full = false; this.long = 0;
  }
  CsvParser.prototype.sniff = function (text) {
    var sample = text.slice(0, 20000).split(/\r\n|\n|\r/).slice(0, 12), best = ',', bestScore = -1;
    [',', ';', '\t', '|'].forEach(function (d) {
      var counts = sample.map(function (line) { var n = 0, q = false; for (var i = 0; i < line.length; i++) { var c = line.charAt(i); if (c === '"') q = !q; else if (c === d && !q) n++; } return n; }).filter(function (n, i) { return i < sample.length - 1 || n > 0; });
      if (!counts.length || !counts[0]) return;
      var same = counts.filter(function (n) { return n === counts[0]; }).length;
      var score = same * 10 + counts[0];
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  };
  CsvParser.prototype.push = function () {
    var c = this.cell;
    if (c.length > LIMITS.cell) { this.long++; c = c.slice(0, LIMITS.cell); }
    this.row.push(c); this.cell = '';
  };
  CsvParser.prototype.endRow = function () {
    this.push();
    if (this.row.length > 1 || this.row[0] !== '') {
      if (this.rows.length < this.max) this.rows.push(this.row.slice(0, LIMITS.columns));
      else this.full = true;
    }
    this.row = [];
  };
  CsvParser.prototype.feed = function (text) {
    if (this.full) return;
    if (!this.d) this.d = this.sniff(text);
    var d = this.d, n = text.length, i = 0, cell = this.cell;
    while (i < n) {
      var c = text.charAt(i);
      if (this.cr) { this.cr = false; if (c === '\n') { i++; continue; } }
      if (this.q) {
        var j = text.indexOf('"', i);
        if (j < 0) { cell += text.slice(i); i = n; break; }
        cell += text.slice(i, j);
        if (j + 1 >= n) { this.cell = cell; this.pendQuote = true; this.q = false; i = n; cell = this.cell; break; }
        if (text.charAt(j + 1) === '"') { cell += '"'; i = j + 2; continue; }
        this.q = false; this.after = true; i = j + 1; continue;
      }
      if (this.pendQuote) {
        this.pendQuote = false;
        if (c === '"') { cell += '"'; this.q = true; i++; continue; }
        this.after = true;
      }
      if (c === '"' && !this.after && cell.trim() === '') { this.q = true; cell = ''; i++; continue; }
      if (c === d) { this.cell = cell; this.push(); cell = ''; this.after = false; i++; continue; }
      if (c === '\n' || c === '\r') { this.cell = cell; this.endRow(); cell = ''; this.after = false; if (c === '\r') this.cr = true; i++; if (this.full) return; continue; }
      if (!this.after) cell += c;
      i++;
    }
    this.cell = cell;
  };
  CsvParser.prototype.end = function () {
    if (this.pendQuote) { this.pendQuote = false; }
    if (this.q) this.unclosed = true;
    if (this.cell !== '' || this.row.length) this.endRow();
    return this.rows;
  };
  function parseCSV(text, opts) {
    opts = opts || {};
    var p = new CsvParser(opts.delimiter, (opts.maxRows || rowCap()) + 1);
    p.feed(String(text || '').replace(/^﻿/, ''));
    var rows = p.end();
    return table(rows, { delimiter: p.d, truncated: p.full, long: p.long, unclosed: p.unclosed, source: opts.source || 'paste' });
  }
  /* A grid → { columns, rows, warnings }. First row is the header; blank headers become "Column N"; repeats get " 2". */
  function table(grid, info) {
    info = info || {};
    var warnings = [];
    grid = (grid || []).map(function (r) { return (r || []).map(function (c) { return clean(c == null ? '' : c).replace(/\r\n?/g, '\n').trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
    var head = grid[0] || [], width = Math.min(LIMITS.columns, grid.reduce(function (m, r) { return Math.max(m, r.length); }, 0));
    var seen = {};
    var columns = [];
    for (var i = 0; i < width; i++) {
      var h = String(head[i] || '').replace(/\s+/g, ' ').slice(0, 80) || 'Column ' + (i + 1);
      var k = h.toLowerCase();
      if (seen[k]) { seen[k]++; h += ' ' + seen[k]; } else seen[k] = 1;
      columns.push(h);
    }
    var rows = grid.slice(1).map(function (r) { var o = []; for (var j = 0; j < width; j++) o.push(r[j] == null ? '' : r[j]); return o; });
    if (info.truncated) warnings.push('Only the first ' + rows.length + ' rows are used on this device.');
    if (info.long) warnings.push(info.long + ' long cells were shortened to ' + LIMITS.cell + ' characters.');
    if (info.unclosed) warnings.push('A quote was never closed; the last cell runs to the end of the file. Check the last row.');
    if (!rows.length) warnings.push(grid.length ? 'Your list has a header row but no rows under it.' : 'Your list is empty.');
    return { columns: columns, rows: rows, warnings: warnings, delimiter: info.delimiter || null, encoding: info.encoding || null, source: info.source || null, sheets: info.sheets || [], sheet: info.sheet || '' };
  }
  /* parseFile(File) → Promise<table>. CSV/TSV are read in 1 MB slices (big files stream); XLSX via the vendored SheetJS,
     loaded only now. Cell values are data: formulas are never evaluated (cached values only), nothing is interpreted. */
  function parseFile(file, opts) {
    opts = opts || {};
    var name = String(file && file.name || '');
    if (!file || typeof file.slice !== 'function') return Promise.reject(new Error('That is not a file.'));
    if (/\.(xlsx|xlsm|xls|ods)$/i.test(name) || /spreadsheetml|ms-excel|opendocument\.spreadsheet/i.test(file.type || '')) return parseSheet(file, opts);
    if (file.size > LIMITS.fileBytes) return Promise.reject(new Error('This file is larger than ' + Math.round(LIMITS.fileBytes / 1048576) + ' MB. Split it into smaller lists.'));
    var CH = 1024 * 1024, pos = 0, dec = null, enc = null, parser = new CsvParser(opts.delimiter || (/\.tsv$/i.test(name) ? '\t' : null), (opts.maxRows || rowCap()) + 1);
    function step() {
      if (pos >= file.size || parser.full) {
        if (dec) parser.feed(dec.decode());
        var t = table(parser.end(), { delimiter: parser.d, truncated: parser.full, long: parser.long, unclosed: parser.unclosed, encoding: enc, source: 'file' });
        if (enc === 'windows-1252') t.warnings.push('This file is not UTF-8, so it was read as Western European (Windows-1252). If letters look wrong, save it as “CSV UTF-8” and try again.');
        return Promise.resolve(t);
      }
      return file.slice(pos, pos + CH).arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        if (!dec) { var g = decoderFor(bytes); enc = g.enc; dec = new TextDecoder(enc, { fatal: enc === 'utf-8' }); bytes = bytes.subarray(g.skip); }
        pos += CH;
        var text;
        try { text = dec.decode(bytes, { stream: pos < file.size }); }
        catch (e) {
          /* Not UTF-8 after all, further in: start again as Windows-1252. */
          pos = 0; enc = 'windows-1252'; dec = new TextDecoder(enc); parser = new CsvParser(parser.d, parser.max);
          return tick().then(step);
        }
        parser.feed(text);
        if (opts.progress) opts.progress(Math.min(1, pos / file.size));
        return tick().then(step);
      });
    }
    return step();
  }
  var xlsxJob = null;
  function xlsxLib() {
    if (global.XLSX && global.XLSX.read) return Promise.resolve(global.XLSX);
    if (!xlsxJob) { xlsxJob = LE.lazy(VENDOR + 'xlsx.full.min.js').then(function () { if (!global.XLSX || !global.XLSX.read) throw new Error('The spreadsheet reader did not start.'); return global.XLSX; }); xlsxJob.catch(function () { xlsxJob = null; }); }
    return xlsxJob;
  }
  function parseSheet(file, opts) {
    if (file.size > LIMITS.xlsxBytes) return Promise.reject(new Error('This spreadsheet is larger than ' + Math.round(LIMITS.xlsxBytes / 1048576) + ' MB. Save the sheet you need as CSV and use that.'));
    var max = (opts.maxRows || rowCap()) + 1;
    return Promise.all([xlsxLib(), file.arrayBuffer()]).then(function (r) {
      var X = r[0];
      var wb = X.read(new Uint8Array(r[1]), { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, cellDates: true, dense: true, sheetRows: max + 1 });
      var sheets = wb.SheetNames.slice(0, 40);
      var sheet = opts.sheet && sheets.indexOf(opts.sheet) >= 0 ? opts.sheet : sheets[0];
      var grid = X.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '', blankrows: false });
      grid = grid.map(function (row) {
        return row.map(function (v) {
          if (v instanceof Date) { var t = new Date(v.getTime() + 43200000); return isoOf(t.getFullYear(), t.getMonth() + 1, t.getDate()) || ''; }
          if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          return v == null ? '' : String(v);
        });
      });
      var truncated = grid.length > max;
      return table(grid.slice(0, max), { truncated: truncated, sheets: sheets, sheet: sheet, source: 'xlsx' });
    });
  }

  /* =====================================================================
     5. Columns → fields, values, problems
     ===================================================================== */
  var SYN = {
    name: ['fullname', 'full name', 'student', 'recipient', 'person', 'attendee', 'guest', 'participant', 'awardee', 'winner', 'customer', 'title'],
    photo: ['image', 'picture', 'pic', 'file', 'filename', 'photo file', 'headshot', 'portrait', 'img', 'avatar'],
    price: ['cost', 'amount', 'mrp', 'rate', 'price inr', 'price usd', 'value'],
    date: ['day', 'when', 'on'], url: ['link', 'website', 'qr', 'web', 'upi'], role: ['title', 'job', 'position', 'designation'],
    colour: ['color', 'hex', 'brand colour', 'brand color'], product: ['item', 'name', 'product name', 'item name'], sku: ['code', 'item code', 'barcode'],
    table: ['table number', 'table no', 'seat'], event: ['event name'], course: ['class', 'subject', 'programme', 'program', 'award'],
    when: ['date', 'day', 'time']
  };
  var TYPE_SYN = { image: ['photo', 'image', 'picture', 'file', 'img'], date: ['date', 'day', 'when'], url: ['link', 'url', 'website', 'qr', 'upi'], colour: ['colour', 'color', 'hex'], boolean: ['yes', 'flag'] };
  function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ''); }
  /* automap(columns, variables) → { key: column index or -1 }: exact names, labels, synonyms, then containment. */
  function automap(columns, vars) {
    var cols = columns.map(norm), used = {}, out = {};
    function take(key, test) {
      if (out[key] != null && out[key] >= 0) return;
      for (var i = 0; i < cols.length; i++) if (!used[i] && cols[i] && test(cols[i], i)) { out[key] = i; used[i] = 1; return; }
    }
    vars.forEach(function (v) { out[v.key] = -1; });
    vars.forEach(function (v) { var k = norm(v.key); take(v.key, function (c) { return c === k; }); });
    vars.forEach(function (v) { var k = norm(v.label); take(v.key, function (c) { return k && c === k; }); });
    function syn(v) { return (SYN[v.key] || SYN[String(v.key).toLowerCase()] || []).concat(TYPE_SYN[v.type] || []).map(norm); }
    vars.forEach(function (v) { var list = syn(v); take(v.key, function (c) { return list.indexOf(c) >= 0; }); });
    vars.forEach(function (v) { var k = norm(v.key); if (k.length >= 3) take(v.key, function (c) { return c.indexOf(k) >= 0 || (c.length >= 3 && k.indexOf(c) >= 0); }); });
    vars.forEach(function (v) { var list = syn(v).filter(function (x) { return x.length >= 3; }); take(v.key, function (c) { return list.some(function (x) { return c.indexOf(x) >= 0; }); }); });
    return out;
  }
  /* coerce(raw, variable) → { value, error? }. Empty → the variable's default; required empty → error "missing". */
  function coerce(raw, v) {
    var s = raw == null ? '' : (typeof raw === 'string' ? raw : String(raw));
    var t = v.type || 'text';
    if (s.trim() === '') {
      if (v.default != null && v.default !== '') return coerce(v.default, Object.assign({}, v, { default: null }));
      if (v.required) return { value: '', error: 'missing', message: (v.label || v.key) + ' is empty' };
      return { value: t === 'boolean' ? false : '' };
    }
    if (t === 'number') {
      var n = toNumber(s);
      return isFinite(n) ? { value: n } : { value: s, error: 'type', message: '“' + s.slice(0, 30) + '” is not a number' };
    }
    if (t === 'date') { var d = toDate(s); return d ? { value: d } : { value: s, error: 'type', message: '“' + s.slice(0, 30) + '” is not a date (use 2026-11-12 or 12/11/2026)' }; }
    if (t === 'colour') { var hx = hexOf(s); return hx ? { value: hx } : { value: s, error: 'type', message: '“' + s.slice(0, 20) + '” is not a colour (use a hex code like #1F6FEB)' }; }
    if (t === 'boolean') { var b = parseBool(s); return b == null ? { value: truthy(s), error: 'type', message: '“' + s.slice(0, 20) + '” is not yes or no' } : { value: b }; }
    if (t === 'url') return s.length > LIMITS.qr ? { value: s, error: 'type', message: 'This is too long for a QR code (' + s.length + ' characters, up to ' + LIMITS.qr + ')' } : { value: s.trim() };
    if (t === 'image') return { value: s.trim() };
    return { value: s };
  }
  /* rowsToValues(table, mapping, variables, { photos }) → { rows: [{ index, values, problems }], counts }.
     Problems: missing (required), type, photo (no file of that name), overflow (filled later by check). */
  function rowsToValues(tbl, mapping, vars, opts) {
    opts = opts || {};
    var total = tbl.rows.length, counts = { missing: 0, type: 0, photo: 0 };
    var rows = tbl.rows.map(function (r, i) {
      var values = {}, problems = [];
      vars.forEach(function (v) {
        var ci = mapping[v.key];
        var raw = ci != null && ci >= 0 ? r[ci] : (opts.fixed && own(opts.fixed, v.key) ? opts.fixed[v.key] : '');
        var c = coerce(raw, v);
        values[v.key] = c.value;
        if (c.error) { problems.push({ key: v.key, kind: c.error, message: c.message }); counts[c.error]++; }
        if (v.type === 'image' && c.value && opts.photos && !c.error) {
          if (!opts.photos.match(c.value)) { problems.push({ key: v.key, kind: 'photo', message: 'No photo called “' + String(c.value).slice(0, 60) + '”' }); counts.photo++; }
        }
      });
      values['#'] = i + 1; values['#total'] = total;
      return { index: i, values: values, problems: problems };
    });
    return { rows: rows, counts: counts };
  }

  /* =====================================================================
     6. Photos: match by file name (case and extension do not matter)
     ===================================================================== */
  function photoKey(name) {
    var b = String(name || '').split(/[\\\/]/).pop().trim();
    b = b.replace(/\.(jpe?g|png|webp|gif|avif|bmp|heic|heif|tiff?)$/i, '');
    return b.toLowerCase().normalize('NFC').replace(/\s+/g, ' ');
  }
  /* photoIndex(files) → { size, match(value) → File|null, unused(values) → [names], dupes: [names], skipped } */
  function photoIndex(files) {
    var map = {}, dupes = [], skipped = 0, list = [];
    [].slice.call(files || []).forEach(function (f) {
      var nm = String(f && f.name || '');
      var ok = f && (/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(nm) || (!/\.[a-z0-9]{1,5}$/i.test(nm) && /^image\//.test(f.type || '')));
      if (!ok) { skipped++; return; }
      if (f.size > LIMITS.photoBytes || list.length >= LIMITS.photos) { skipped++; return; }
      var k = photoKey(f.name);
      if (map[k]) { dupes.push(f.name); return; }
      map[k] = f; list.push(f);
    });
    return {
      size: list.length, files: list, dupes: dupes, skipped: skipped,
      match: function (v) { return v ? map[photoKey(v)] || null : null; },
      unused: function (values) {
        var want = {};
        values.forEach(function (v) { if (v) want[photoKey(v)] = 1; });
        return list.filter(function (f) { return !want[photoKey(f.name)]; }).map(function (f) { return f.name; });
      }
    };
  }

  /* =====================================================================
     7. File names: a pattern like "{{name}}-certificate", safe and unique inside the zip
     ===================================================================== */
  var RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  function safeName(s, n) {
    s = clean(s, 400).replace(/[\/\\:*?"<>|\u0000-\u001F]+/g, '-').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ')
      .replace(/^[\s.\-]+|[\s.\-]+$/g, '').slice(0, n || LIMITS.nameChars).replace(/[\s.]+$/, '');
    if (RESERVED.test(s)) s = '_' + s;
    return s;
  }
  function namer(pattern, ext) {
    var used = {};
    pattern = String(pattern || '{{#}}').slice(0, LIMITS.pattern);
    return function (values, i) {
      var base = safeName(fillText(pattern, values || {}, { missing: 'empty' }).text) || ('design-' + (i + 1));
      var name = base, k = 2;
      while (used[(name + '.' + ext).toLowerCase()]) name = base + '-' + (k++);
      used[(name + '.' + ext).toLowerCase()] = 1;
      return name + '.' + ext;
    };
  }

  /* =====================================================================
     8. Writers that keep memory flat: a zip (stored entries) and a PDF of JPEG pages, built as Blob parts
     ===================================================================== */
  var CRC = null;
  function crc32(u8, crc) {
    if (!CRC) { CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC[n] = c >>> 0; } }
    crc = crc == null ? 0xFFFFFFFF : crc;
    for (var i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return crc;
  }
  function ZipWriter() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; this.enc = new TextEncoder(); var d = new Date(); this.time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF; this.date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF; }
  /* add(name, Blob) → Promise. The bytes are read once for the checksum and dropped; the Blob itself is kept. */
  ZipWriter.prototype.add = function (name, blob) {
    var self = this;
    return blob.arrayBuffer().then(function (buf) {
      var data = new Uint8Array(buf), crc = (crc32(data) ^ 0xFFFFFFFF) >>> 0, size = data.length;
      data = null; buf = null;
      var nm = self.enc.encode(name);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, self.time, true); h.setUint16(12, self.date, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      self.parts.push(new Uint8Array(h.buffer), nm, blob);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, self.time, true); c.setUint16(14, self.date, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
      c.setUint16(28, nm.length, true); c.setUint32(42, self.offset, true);
      self.central.push(new Uint8Array(c.buffer), nm);
      self.offset += 30 + nm.length + size;
      self.count++;
      if (self.offset > LIMITS.zipBytes) throw new Error('The zip would be larger than 3.5 GB. Make fewer rows at a time or a smaller size.');
    });
  };
  ZipWriter.prototype.bytes = function () { return this.offset; };
  ZipWriter.prototype.finish = function () {
    var size = this.central.reduce(function (s, p) { return s + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.count, true); e.setUint16(10, this.count, true); e.setUint32(12, size, true); e.setUint32(16, this.offset, true);
    var blob = new Blob(this.parts.concat(this.central, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
    this.parts = []; this.central = [];
    return blob;
  };
  ZipWriter.prototype.abort = function () { this.parts = []; this.central = []; };
  /* A PDF whose pages are JPEG images (DCTDecode), written object by object; xref at the end. */
  function PdfWriter() { this.parts = []; this.offset = 0; this.xref = [0, 0, 0]; this.kids = []; this.next = 3; this.str('%PDF-1.4\n%âãÏÓ\n'); }
  PdfWriter.prototype.str = function (s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; this.parts.push(u); this.offset += u.length; };
  PdfWriter.prototype.obj = function (n, body) { this.xref[n] = this.offset; this.str(n + ' 0 obj\n' + body + '\nendobj\n'); };
  /* addPage(jpegBlob, pxW, pxH, ptW, ptH) */
  PdfWriter.prototype.addPage = function (jpeg, pw, ph, W, H) {
    var img = this.next++, content = this.next++, page = this.next++;
    this.xref[img] = this.offset;
    this.str(img + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pw + ' /Height ' + ph + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.size + ' >>\nstream\n');
    this.parts.push(jpeg); this.offset += jpeg.size;
    this.str('\nendstream\nendobj\n');
    var ops = 'q ' + W.toFixed(2) + ' 0 0 ' + H.toFixed(2) + ' 0 0 cm /Im0 Do Q';
    this.obj(content, '<< /Length ' + ops.length + ' >>\nstream\n' + ops + '\nendstream');
    this.obj(page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W.toFixed(2) + ' ' + H.toFixed(2) + '] /Resources << /XObject << /Im0 ' + img + ' 0 R >> >> /Contents ' + content + ' 0 R >>');
    this.kids.push(page);
    return Promise.resolve();
  };
  PdfWriter.prototype.bytes = function () { return this.offset; };
  PdfWriter.prototype.finish = function (title) {
    this.obj(2, '<< /Type /Pages /Kids [' + this.kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + this.kids.length + ' >>');
    this.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    var info = this.next++;
    this.obj(info, '<< /Producer (LocalEditor) /Title (' + String(title || 'Designs').replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, '') .slice(0, 80) + ') >>');
    var x = this.offset, n = this.next;
    var s = 'xref\n0 ' + n + '\n0000000000 65535 f \n';
    for (var i = 1; i < n; i++) s += ('0000000000' + (this.xref[i] || 0)).slice(-10) + ' 00000 n \n';
    s += 'trailer\n<< /Size ' + n + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
    this.str(s);
    var blob = new Blob(this.parts, { type: 'application/pdf' });
    this.parts = [];
    return blob;
  };
  PdfWriter.prototype.abort = function () { this.parts = []; };
  /* A CSV report that is safe to open in a spreadsheet: every cell quoted, and = + - @ tab CR at the start defused. */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function csvReport(rows) { return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

  /* =====================================================================
     9. Print sheets: n-up on A4 / Letter with cut marks
     ===================================================================== */
  var PAPER = { a4: { w: 210, h: 297, name: 'A4' }, letter: { w: 215.9, h: 279.4, name: 'Letter' }, 'a4-landscape': { w: 297, h: 210, name: 'A4 landscape' }, 'letter-landscape': { w: 279.4, h: 215.9, name: 'Letter landscape' } };
  /* The physical size of a page: its print meta, else 300 dpi (print-sized designs) or 96 dpi for screen sizes. */
  function pageMM(doc) {
    if (doc.print && doc.print.w) return { w: doc.print.w, h: doc.print.h };
    var dpi = Math.max(doc.width, doc.height) >= 1500 ? 300 : 150;
    return { w: doc.width / dpi * 25.4, h: doc.height / dpi * 25.4 };
  }
  /* sheetLayout(doc, { paper, cellW (mm), margin, gap }) → { paper, cols, rows, per, cell: {w,h}, x0, y0, gap, dpi } */
  function sheetLayout(doc, o) {
    o = o || {};
    var P = PAPER[o.paper] || PAPER.a4, m = num(o.margin, 10), gap = num(o.gap, 4);
    var nat = pageMM(doc), cw = num(o.cellW, nat.w), ch = cw * doc.height / doc.width;
    var fit = Math.min(1, (P.w - 2 * m) / cw, (P.h - 2 * m) / ch);
    cw *= fit; ch *= fit;
    var cols = Math.max(1, Math.floor((P.w - 2 * m + gap) / (cw + gap))), rows = Math.max(1, Math.floor((P.h - 2 * m + gap) / (ch + gap)));
    var x0 = (P.w - (cols * cw + (cols - 1) * gap)) / 2, y0 = (P.h - (rows * ch + (rows - 1) * gap)) / 2;
    return { paper: o.paper || 'a4', P: P, cols: cols, rows: rows, per: cols * rows, cell: { w: cw, h: ch }, x0: x0, y0: y0, gap: gap, dpi: num(o.dpi, 300) };
  }
  function drawCutMarks(ctx, S, k) {
    ctx.save();
    ctx.strokeStyle = '#6B6577'; ctx.lineWidth = Math.max(1, 0.2 * k);
    var len = 4 * k, off = 1.5 * k, xs = [], ys = [];
    for (var c = 0; c < S.cols; c++) { xs.push(S.x0 + c * (S.cell.w + S.gap)); xs.push(S.x0 + c * (S.cell.w + S.gap) + S.cell.w); }
    for (var r = 0; r < S.rows; r++) { ys.push(S.y0 + r * (S.cell.h + S.gap)); ys.push(S.y0 + r * (S.cell.h + S.gap) + S.cell.h); }
    var top = S.y0 * k, bottom = (S.y0 + S.rows * S.cell.h + (S.rows - 1) * S.gap) * k, left = S.x0 * k, right = (S.x0 + S.cols * S.cell.w + (S.cols - 1) * S.gap) * k;
    ctx.beginPath();
    xs.forEach(function (x) { x *= k; ctx.moveTo(x, top - off); ctx.lineTo(x, Math.max(0, top - off - len)); ctx.moveTo(x, bottom + off); ctx.lineTo(x, bottom + off + len); });
    ys.forEach(function (y) { y *= k; ctx.moveTo(left - off, y); ctx.lineTo(Math.max(0, left - off - len), y); ctx.moveTo(right + off, y); ctx.lineTo(right + off + len, y); });
    ctx.stroke();
    ctx.restore();
  }

  /* =====================================================================
     10. The bulk engine: one row at a time on one hidden scene
     ===================================================================== */
  /* run(opts) → Promise<result>. opts:
       doc            the template page (plain page doc; its own values are ignored)
       rows           [{ values }] coerced values per row (rowsToValues), or plain value objects
       asset(id)      → canvas|Blob for the template's own images (the studio passes its memory)
       photos         photoIndex(...) for image fields
       output         { kind: 'png'|'jpeg'|'webp'|'pdf'|'sheet', scale, quality, name (pattern), sheet: { paper, cellW, marks, gap, margin } }
       control        { paused, cancelled } (set from the UI), onProgress({ done, total, ms, eta, name })
     result: { ok, blob, name, type, count, names, problems: [{ row, kind, message }], ms, perRow, bytes, cancelled } */
  function run(opts) {
    opts = opts || {};
    var doc = clone(opts.doc), out = Object.assign({ kind: 'png', scale: 1, quality: 0.92, name: '{{#}}' }, opts.output || {});
    var ctl = opts.control || {}, rows = (opts.rows || []).map(function (r) { return r && r.values ? r : { values: r || {} }; });
    var total = rows.length, t0 = now(), names = [], problems = [];
    if (!doc || !doc.layers) return Promise.reject(new Error('There is no template page.'));
    if (!total) return Promise.reject(new Error('Your list has no rows.'));
    if (total > rowCap()) return Promise.reject(new Error('This device makes up to ' + rowCap() + ' designs at a time. Split your list.'));
    delete doc.values;
    var kind = out.kind === 'jpg' ? 'jpeg' : out.kind;
    var isPdf = kind === 'pdf' || (kind === 'sheet' && out.sheet && out.sheet.format !== 'png');
    var ext = kind === 'sheet' ? (isPdf ? 'pdf' : 'png') : kind === 'pdf' ? 'pdf' : kind === 'jpeg' ? 'jpg' : kind;
    var writer = isPdf ? new PdfWriter() : new ZipWriter();
    var nameOf = namer(out.name, kind === 'sheet' ? 'png' : ext);
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:64px;height:64px;pointer-events:none;visibility:hidden';
    document.body.appendChild(host);
    var scene = new LE.Scene({ el: host, width: doc.width, height: doc.height });
    scene._varMissing = 'empty';
    var photoCache = [], PHOTO_KEEP = 6;
    var maxPx = Math.ceil(Math.max(doc.width, doc.height) * (out.scale || 1) * 1.1);
    function cleanup() {
      photoCache.forEach(function (p) { if (p.canvas) { p.canvas.width = 1; p.canvas.height = 1; } });
      photoCache = [];
      try { scene.destroy(); } catch (e) {}
      host.remove();
    }
    function templateAssets() {
      var ids = {};
      doc.layers.forEach(function (l) { if (l.type === 'image' && l.src) ids[l.src] = 1; if (l.cutout && l.cutout.asset) ids[l.cutout.asset] = 1; });
      if (doc.background && doc.background.src) ids[doc.background.src] = 1;
      return Promise.all(Object.keys(ids).map(function (id) {
        return Promise.resolve(opts.asset ? opts.asset(id) : null).then(function (a) { if (a) scene.addAsset(id, a); }).catch(function () {});
      }));
    }
    /* A matched photo, decoded once at the size the export needs and kept for the next few rows. */
    function photoFor(value) {
      var f = opts.photos && opts.photos.match ? opts.photos.match(value) : null;
      if (!f) return Promise.resolve(null);
      var key = 'bulk:' + photoKey(f.name);
      for (var i = 0; i < photoCache.length; i++) if (photoCache[i].key === key) { var hit = photoCache.splice(i, 1)[0]; photoCache.push(hit); return Promise.resolve(key); }
      return createImageBitmap(f).then(function (bm) {
        var s = Math.min(1, maxPx / Math.max(bm.width, bm.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bm.width * s)); c.height = Math.max(1, Math.round(bm.height * s));
        var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, c.width, c.height);
        if (bm.close) bm.close();
        scene.addAsset(key, c);
        photoCache.push({ key: key, canvas: c });
        while (photoCache.length > PHOTO_KEEP) {
          var old = photoCache.shift();
          if (scene._assets) delete scene._assets[old.key];
          old.canvas.width = 1; old.canvas.height = 1;
        }
        return key;
      }, function () { return null; });
    }
    function valuesFor(r) {
      var v = Object.assign({}, r.values);
      var imgs = doc.layers.filter(function (l) { return l.type === 'image' && l.bind && l.bind.content; }).map(function (l) { return l.bind.content; });
      var jobs = imgs.filter(function (k, i) { return imgs.indexOf(k) === i && own(v, k) && v[k]; }).map(function (k) {
        if (/^[a-f0-9]{64}$/.test(String(v[k])) && opts.asset) return Promise.resolve(opts.asset(v[k])).then(function (a) { if (a) scene.addAsset(v[k], a); else delete v[k]; });
        return photoFor(v[k]).then(function (key) { if (key) v[k] = key; else { problems.push({ row: r.index != null ? r.index : null, kind: 'photo', key: k, message: 'No photo called “' + String(v[k]).slice(0, 60) + '”; the template photo was used' }); delete v[k]; } });
      });
      return Promise.all(jobs).then(function () { return v; });
    }
    function waitWhilePaused() {
      if (!ctl.paused || ctl.cancelled) return Promise.resolve();
      return new Promise(function (r) { setTimeout(r, 120); }).then(waitWhilePaused);
    }
    function release(cv) { if (cv) { cv.width = 1; cv.height = 1; } }
    /* Print sheet state */
    var S = kind === 'sheet' ? sheetLayout(doc, out.sheet) : null, sheet = null, sctx = null, onSheet = 0, sheetNo = 0, k = S ? S.dpi / 25.4 : 0;
    function newSheet() {
      sheet = document.createElement('canvas');
      sheet.width = Math.round(S.P.w * k); sheet.height = Math.round(S.P.h * k);
      sctx = sheet.getContext('2d'); sctx.fillStyle = '#FFFFFF'; sctx.fillRect(0, 0, sheet.width, sheet.height);
      if (!out.sheet || out.sheet.marks !== false) drawCutMarks(sctx, S, k);
      onSheet = 0;
    }
    function flushSheet() {
      if (!sheet || !onSheet) return Promise.resolve();
      sheetNo++;
      var cv = sheet; sheet = null;
      var done = isPdf ? LE.exportImage(cv, { format: 'jpeg', quality: 0.95 }).then(function (b) { return writer.addPage(b, cv.width, cv.height, S.P.w / 25.4 * 72, S.P.h / 25.4 * 72); })
        : LE.exportImage(cv, { format: 'png' }).then(function (b) { var nm = 'sheet-' + sheetNo + '.png'; names.push(nm); return writer.add(nm, b); });
      return done.then(function () { release(cv); });
    }
    var perRow = [];
    var chain = templateAssets().then(function () { scene.load(doc); return prepare(scene); });
    var i = 0;
    function next() {
      if (ctl.cancelled) return Promise.resolve();
      if (i >= total) return Promise.resolve();
      var r = rows[i], ri = i, t1 = now();
      i++;
      if (r.skip) return next();
      return waitWhilePaused().then(function () {
        if (ctl.cancelled) return null;
        return valuesFor(r).then(function (v) {
          if (v['#'] == null) { v['#'] = ri + 1; v['#total'] = total; }
          scene._doc.values = LE.Scene.valuesOf(v) || {};
          scene._varCache = {};
          var rowProbs = [];
          scene._doc.layers.forEach(function (l) {
            if (!LE.varBoot.touches(l)) return;
            fillWith(l, v, { dims: function (id) { return assetDims(scene, id); }, missing: 'empty', report: function (kk, info) { if (kk === 'overflow' || kk === 'unknown-pipe' || kk === 'bad-colour') rowProbs.push({ row: ri, kind: kk, layer: info.layer, message: kk === 'overflow' ? 'Text “' + (info.name || info.layer) + '” is too long even at ' + info.size + ' px' : kk === 'bad-colour' ? 'Not a colour: ' + String(info.value).slice(0, 20) : 'Unknown pipe in ' + info.layer } ); } });
          });
          problems.push.apply(problems, rowProbs);
          var scale = S ? (S.cell.w * k) / doc.width : (out.scale || 1);
          return scene.render(scale).then(function (cv) {
            if (S) {
              if (!sheet) newSheet();
              var col = onSheet % S.cols, row = Math.floor(onSheet / S.cols);
              sctx.drawImage(cv, Math.round((S.x0 + col * (S.cell.w + S.gap)) * k), Math.round((S.y0 + row * (S.cell.h + S.gap)) * k), Math.round(S.cell.w * k), Math.round(S.cell.h * k));
              release(cv);
              onSheet++;
              return onSheet >= S.per ? flushSheet() : null;
            }
            if (isPdf) {
              var mm = pageMM(doc), W = doc.print ? mm.w / 25.4 * 72 : doc.width * 0.75, H = doc.print ? mm.h / 25.4 * 72 : doc.height * 0.75;
              return LE.exportImage(cv, { format: 'jpeg', quality: Math.max(0.85, out.quality || 0.92) }).then(function (b) { var pw = cv.width, ph = cv.height; release(cv); return writer.addPage(b, pw, ph, W, H); });
            }
            var nm = nameOf(r.values, ri);
            names.push(nm);
            return LE.exportImage(cv, { format: kind, quality: out.quality }).then(function (b) { release(cv); return writer.add(nm, b); });
          });
        });
      }).then(function () {
        perRow.push(now() - t1);
        var done = i, ms = now() - t0, eta = done ? ms / done * (total - done) : 0;
        if (opts.onProgress) try { opts.onProgress({ done: done, total: total, ms: ms, eta: eta, bytes: writer.bytes() }); } catch (e) {}
        return tick();
      }).then(next);
    }
    return chain.then(next).then(function () {
      if (ctl.cancelled) { writer.abort(); cleanup(); return { ok: false, cancelled: true, count: 0, problems: problems, ms: now() - t0 }; }
      return (S ? flushSheet() : Promise.resolve()).then(function () {
        var rep = null;
        if (!isPdf && problems.length) {
          rep = new Blob([csvReport([['row', 'kind', 'field or layer', 'message']].concat(problems.map(function (p) { return [p.row == null ? '' : p.row + 1, p.kind, p.key || p.layer || '', p.message]; })))], { type: 'text/csv' });
          return writer.add('problems.csv', rep);
        }
      }).then(function () {
        var blob = writer.finish(opts.title);
        cleanup();
        var sorted = perRow.slice().sort(function (a, b) { return a - b; });
        return {
          ok: true, blob: blob, type: blob.type, ext: isPdf ? 'pdf' : 'zip', count: isPdf ? (S ? sheetNo : total - rows.filter(function (r) { return r.skip; }).length) : names.length,
          names: names, problems: problems, ms: now() - t0, perRow: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0, bytes: blob.size, sheets: S ? sheetNo : 0
        };
      });
    }, function (e) { writer.abort(); cleanup(); throw e; });
  }
  /* checkRows(doc, rows, { photos }) → rows with overflow problems added (measured with the real fonts). */
  function checkRows(doc, rows, opts) {
    opts = opts || {};
    return Promise.resolve(LE.fonts && LE.fonts.load ? Promise.all((doc.layers || []).filter(function (l) { return l.type === 'text'; }).map(function (l) { try { return Promise.resolve(LE.fonts.load(l.font, l.weight, !!l.italic)).catch(function () {}); } catch (e) { return null; } })) : null).then(function () {
      rows.forEach(function (r) {
        r.problems = (r.problems || []).filter(function (p) { return p.kind !== 'overflow' && p.kind !== 'unknown-pipe'; });
        (doc.layers || []).forEach(function (l) {
          if (l.type !== 'text' || !l.text || l.text.indexOf('{{') < 0) return;
          fillWith(l, r.values, { missing: 'empty', report: function (k, info) {
            if (k === 'overflow') r.problems.push({ layer: l.id, kind: 'overflow', message: '“' + (l.name || l.id) + '” is too long to fit, even at ' + info.size + ' px' });
            if (k === 'unknown-pipe') r.problems.push({ layer: l.id, kind: 'unknown-pipe', message: info.unknown.map(function (u) { return u.token + ': ' + u.why; }).join('; ') });
          } });
        });
      });
      return rows;
    });
  }

  /* =====================================================================
     11. Agents: variables.set, values.set, bulk.create (wiring lines for le-agent.js are in docs/VARIABLES.md)
     ===================================================================== */
  function E(err, code, msg, path) { return err ? err(code, msg, path) : Object.assign(new Error(msg), { code: code, path: path }); }
  function agentVarsSet(W, op, path, err) {
    var list = (W.studio.variables || []).slice();
    if (op.rename) {
      var rn = Array.isArray(op.rename) ? op.rename : [op.rename];
      rn.forEach(function (r, i) {
        var p = path + '/rename' + (Array.isArray(op.rename) ? '/' + i : '');
        if (!r || !KEY.test(r.from || '') || !KEY.test(r.to || '')) throw E(err, 'invalid', 'rename is { "from": "old_key", "to": "new_key" }.', p);
        var all = definitions({ pages: W.pages, meta: { studio: { variables: list } } }).map(function (d) { return d.key; });
        if (all.indexOf(r.from) < 0) throw E(err, 'invalid', 'There is no field "' + r.from + '".', p + '/from');
        if (all.indexOf(r.to) >= 0 && r.to !== r.from) throw E(err, 'invalid', 'A field "' + r.to + '" already exists.', p + '/to');
        renamePages(W.pages, r.from, r.to);
        list = renameList(list, r.from, r.to);
        W.pages.forEach(function (pg, pi) { W.replacedPages[pi] = 1; });
        W.structural = true;
      });
    }
    if (op.variables != null) {
      if (!Array.isArray(op.variables)) throw E(err, 'invalid', '"variables" is a list of { "key", "label", "type", "sample", "required" }.', path + '/variables');
      if (op.variables.length > 50) throw E(err, 'too-large', 'Up to 50 variables.', path + '/variables');
      op.variables.forEach(function (v, i) {
        var p = path + '/variables/' + i;
        if (!isObj(v)) throw E(err, 'invalid', 'Each variable is an object.', p);
        var key = v.key != null ? v.key : v.name;
        if (typeof key !== 'string' || !KEY.test(key)) throw E(err, 'invalid', 'A key starts with a letter and uses letters, numbers, "_", "-" or ".", like "name".', p + '/key');
        if (v.type != null && TYPES.indexOf(v.type === 'color' ? 'colour' : v.type) < 0) throw E(err, 'invalid', 'type is one of ' + TYPES.join(', ') + '.', p + '/type');
        var at = -1;
        list.forEach(function (x, j) { if (x.key === key) at = j; });
        var merged = Object.assign({}, at >= 0 && op.replace !== true ? list[at] : {}, v, { key: key });
        delete merged.name;
        if (at >= 0) list[at] = merged; else list.push(merged);
      });
      if (op.replace === true) { var keys = op.variables.map(function (v) { return v.key != null ? v.key : v.name; }); list = list.filter(function (x) { return keys.indexOf(x.key) >= 0; }); }
    }
    if (op.remove) [].concat(op.remove).forEach(function (k) { list = list.filter(function (x) { return x.key !== k; }); });
    W.studio.variables = LE.Scene.variablesOf(list);
    return { variables: definitions({ pages: W.pages, meta: { studio: { variables: W.studio.variables } } }).map(function (d) { return { key: d.key, label: d.label, type: d.type, required: !!d.required, used: d.uses.length }; }) };
  }
  function ingestDataUri(W, uri, path, err) {
    return LE.design.parse({ format: 'localeditor-design', version: 1, pages: [{ width: 16, height: 16, layers: [{ id: 'v', type: 'image', src: uri, x: 0, y: 0, w: 16, h: 16 }] }] }).then(function (r) {
      if (!r.ok) throw E(err, 'invalid', (r.errors[0] || {}).message || 'That image could not be read.', path);
      var id = r.project.pages[0].layers[0].src;
      if (!id) throw E(err, 'invalid', 'That image could not be read.', path);
      W.assets[id] = W.assets[id] || r.project.assets[id];
      if (r.assets[id] && W.blobs) W.blobs[id] = r.assets[id];
      return id;
    });
  }
  function agentValuesSet(W, op, path, err) {
    if (!isObj(op.values) && !op.clear) throw E(err, 'invalid', '"values" is an object of field values, like { "name": "Ana" }.', path + '/values');
    var defs = definitions({ pages: W.pages, meta: { studio: { variables: W.studio.variables || [] } } });
    var byKey = {};
    defs.forEach(function (d) { byKey[d.key] = d; });
    var pages;
    if (op.page == null || op.page === 'all') pages = W.pages.map(function (p, i) { return i; });
    else if (typeof op.page === 'number' && op.page >= 0 && op.page < W.pages.length && op.page % 1 === 0) pages = [op.page];
    else {
      var ids = W.studio.pageIds || [];
      var ix = ids.indexOf(op.page);
      if (ix < 0) throw E(err, 'invalid', 'No page ' + JSON.stringify(op.page) + '.', path + '/page');
      pages = [ix];
    }
    var vals = {}, jobs = [];
    Object.keys(op.values || {}).forEach(function (k) {
      var p = path + '/values/' + k, v = op.values[k];
      if (!KEY.test(k) && k !== '#' && k !== '#total') throw E(err, 'invalid', 'Value keys are field keys, like "name".', p);
      if (v === null) { vals[k] = null; return; }
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw E(err, 'invalid', 'A value is text, a number or true / false.', p);
      var d = byKey[k];
      if (d && d.type === 'image' && typeof v === 'string' && v) {
        if (/^data:image\//i.test(v)) { jobs.push(ingestDataUri(W, v, p, err).then(function (id) { vals[k] = id; })); return; }
        if (/^[a-f0-9]{64}$/.test(v) && !W.assets[v]) throw E(err, 'invalid', 'No image ' + v.slice(0, 10) + '… in this design; pass a data:image/… URI.', p);
        vals[k] = v; return;
      }
      if (d && d.type !== 'image') {
        var c = coerce(v, Object.assign({}, d, { required: false, default: null }));
        if (c.error === 'type') throw E(err, 'invalid', c.message + '.', p);
        vals[k] = c.value; return;
      }
      vals[k] = v;
    });
    return Promise.all(jobs).then(function () {
      pages.forEach(function (pi) {
        var pg = W.pages[pi];
        var cur = op.clear ? {} : Object.assign({}, pg.values || {});
        Object.keys(vals).forEach(function (k) { if (vals[k] === null) delete cur[k]; else cur[k] = vals[k]; });
        var s = LE.Scene.valuesOf(cur);
        if (s) pg.values = s; else delete pg.values;
        W.pagesTouched[pi] = 1; W.replacedPages[pi] = 1;
      });
      var probs = [];
      pages.forEach(function (pi) {
        defs.forEach(function (d) { if (d.required && !(W.pages[pi].values && W.pages[pi].values[d.key] !== '' && W.pages[pi].values[d.key] != null)) probs.push({ page: pi, key: d.key, kind: 'missing', message: (d.label || d.key) + ' is not filled in' }); });
      });
      return { pages: pages, missing: probs };
    });
  }
  /* rows from an agent: a list of objects keyed by field (or column names), or CSV / TSV text. */
  function agentRows(o, defs) {
    var tbl;
    if (typeof o.csv === 'string') tbl = parseCSV(o.csv.slice(0, LIMITS.pasteChars), { source: 'agent' });
    else if (Array.isArray(o.rows)) {
      var cols = [];
      o.rows.forEach(function (r) { if (isObj(r)) Object.keys(r).forEach(function (k) { if (cols.indexOf(k) < 0 && cols.length < LIMITS.columns) cols.push(k); }); });
      tbl = table([cols].concat(o.rows.map(function (r) { return cols.map(function (k) { var v = isObj(r) ? r[k] : ''; return v == null ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v); }); })), { source: 'agent' });
    } else throw new Error('Give "rows": [ { "name": "Ana" }, … ] or "csv": "name\\nAna".');
    var map = Object.assign(automap(tbl.columns, defs), o.map ? (function () { var m = {}; Object.keys(o.map).forEach(function (k) { m[k] = tbl.columns.indexOf(o.map[k]); }); return m; })() : {});
    return { table: tbl, mapping: map };
  }
  function photosFromData(photos) {
    var files = [];
    Object.keys(photos || {}).slice(0, LIMITS.photos).forEach(function (name) {
      var m = /^data:(image\/(?:png|jpeg|webp|gif|avif|bmp));base64,([A-Za-z0-9+\/=\s]+)$/.exec(String(photos[name] || ''));
      if (!m) return;
      var bin = atob(m[2].replace(/\s+/g, '')), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      try { files.push(new File([u], safeName(name, 120) || 'photo', { type: m[1] })); } catch (e) {}
    });
    return photoIndex(files);
  }
  /* agentBulk(o, project, { asset }) → { ok, count, problems, files?: [{ name, bytes, data }], zip?|pdf?: base64, ... }.
     o: { rows | csv, map?, page?, output: 'png'|'jpeg'|'webp'|'pdf'|'sheet', name?, scale?, quality?, photos?: { "ana.jpg": dataUri }, dryRun?, sheet? } */
  function agentBulk(o, project, env) {
    o = o || {};
    env = env || {};
    if (!project || !project.pages || !project.pages.length) return Promise.resolve({ ok: false, code: 'invalid', message: 'No design is open.' });
    var pi = o.page == null ? (project.activePage || 0) : Number(o.page);
    var doc = project.pages[pi];
    if (!doc) return Promise.resolve({ ok: false, code: 'invalid', message: 'No page ' + o.page + '.', path: '/page' });
    var defs = definitions(project);
    if (!defs.length) return Promise.resolve({ ok: false, code: 'invalid', message: 'This page has no fields. Put {{name}} in a text layer or bind a layer first (variables.set).' });
    var r;
    try { r = agentRows(o, defs); } catch (e) { return Promise.resolve({ ok: false, code: 'invalid', message: e.message, path: '/rows' }); }
    if (r.table.rows.length > rowCap()) return Promise.resolve({ ok: false, code: 'too-large', message: 'Up to ' + rowCap() + ' rows at a time here.' });
    var photos = photosFromData(o.photos);
    var conv = rowsToValues(r.table, r.mapping, defs, { photos: defs.some(function (d) { return d.type === 'image'; }) ? photos : null });
    return checkRows(doc, conv.rows).then(function (rows) {
      var problems = [];
      rows.forEach(function (row) { row.problems.forEach(function (p) { problems.push(Object.assign({ row: row.index }, p)); }); });
      var mapped = {};
      Object.keys(r.mapping).forEach(function (k) { mapped[k] = r.mapping[k] >= 0 ? r.table.columns[r.mapping[k]] : null; });
      var base = { ok: true, rows: rows.length, mapping: mapped, columns: r.table.columns, problems: problems, warnings: r.table.warnings };
      if (o.dryRun) return base;
      var blocking = { missing: 1, type: 1 };
      rows.forEach(function (row) { if (o.skipProblems !== false && row.problems.some(function (p) { return blocking[p.kind]; })) row.skip = true; });
      var kind = o.output || 'png';
      return run({ doc: doc, rows: rows, asset: env.asset, photos: photos, output: { kind: kind, scale: o.scale || 1, quality: o.quality, name: o.name || '{{#}}', sheet: o.sheet }, title: project.name }).then(function (res) {
        base.count = res.count; base.ms = Math.round(res.ms); base.msPerRow = Math.round(res.perRow); base.bytes = res.bytes;
        base.problems = problems.concat(res.problems);
        base.skipped = rows.filter(function (x) { return x.skip; }).map(function (x) { return x.index; });
        if (res.bytes > (o.maxBytes || 20 * 1024 * 1024)) { base.ok = false; base.code = 'too-large'; base.message = 'The result is ' + Math.round(res.bytes / 1048576) + ' MB; ask for fewer rows, a smaller scale or JPEG.'; return base; }
        return blobB64(res.blob).then(function (b64) { base.file = { name: safeName(project.name || 'designs') + '.' + res.ext, type: res.type, data: b64 }; base.names = res.names; return base; });
      });
    });
  }
  function blobB64(blob) {
    return blob.arrayBuffer().then(function (buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
  }
  /* bulk.create as a batch operation (output "pages"): one page per row after the template page, each filled by values. */
  function agentBulkPages(W, op, path, err) {
    var pi = op.page == null ? W.active : Number(op.page);
    var doc = W.pages[pi];
    if (!doc) throw E(err, 'invalid', 'No page ' + op.page + '.', path + '/page');
    var defs = definitions({ pages: W.pages, meta: { studio: { variables: W.studio.variables || [] } } });
    var r;
    try { r = agentRows(op, defs); } catch (e) { throw E(err, 'invalid', e.message, path + '/rows'); }
    var room = LIMITS.pages - W.pages.length;
    if (r.table.rows.length > room) throw E(err, 'too-large', 'A design holds up to ' + LIMITS.pages + ' pages; there is room for ' + room + ' more. Use output "png" or "pdf" for more rows.', path + '/rows');
    var conv = rowsToValues(r.table, r.mapping, defs, {});
    var problems = [];
    var fresh = conv.rows.map(function (row) {
      row.problems.forEach(function (p) { problems.push(Object.assign({ row: row.index }, p)); });
      var pg = clone(doc); delete pg.id; pg.values = LE.Scene.valuesOf(row.values) || {};
      return pg;
    });
    Array.prototype.splice.apply(W.pages, [pi + 1, 0].concat(fresh));
    if (W.studio.pageIds) Array.prototype.splice.apply(W.studio.pageIds, [pi + 1, 0].concat(fresh.map(function () { return ''; })));
    W.pages.forEach(function (p, i) { if (i > pi) W.replacedPages[i] = 1; });
    W.structural = true;
    return { added: fresh.length, problems: problems };
  }

  /* =====================================================================
     12. Lint (LE.design.lint calls this when it is loaded)
     ===================================================================== */
  function lint(project, rep) {
    var out = [];
    function warn(path, kind, message, layer) { if (rep && rep.warn) rep.warn(path, kind, message, layer); else out.push({ path: path, kind: kind, message: message, layer: layer }); }
    if (!project || !project.pages) return out;
    var defs = definitions(project), byKey = {};
    defs.forEach(function (d) { byKey[d.key] = d; });
    project.pages.forEach(function (pg, pi) {
      (pg.layers || []).forEach(function (l, li) {
        var path = '/pages/' + pi + '/layers/' + li;
        if (l.type === 'text') tokens(l.text).forEach(function (t) { if (t.bad.length) warn(path + '/text', 'unknown-pipe', 'In ' + t.raw.slice(0, 60) + ': ' + t.bad.join('; ') + '. It is drawn as written. Pipes: ' + PIPES.join(', ') + '.', l.id); });
        if (l.bind && l.bind.content && l.type === 'svg' && !(l.svg && /<path d="M\d/.test(l.svg))) warn(path + '/bind', 'bind-target', 'A field fills this graphic only when it is a QR code.', l.id);
        if (pg.values && l.type === 'text' && l.text && l.text.indexOf('{{') >= 0) {
          fillWith(l, pg.values, { missing: 'keep', report: function (k, info) { if (k === 'overflow') warn(path, 'overflow', 'With its values, text “' + (l.name || l.id) + '” does not fit even at ' + info.size + ' px. Shorten it, enlarge the box or lower "minSize".', l.id); } });
        }
      });
      Object.keys(pg.values || {}).forEach(function (k) {
        var d = byKey[k];
        if (!d || d.type === 'image' || k === '#' || k === '#total') return;
        var c = coerce(pg.values[k], Object.assign({}, d, { required: false, default: null }));
        if (c.error === 'type') warn('/pages/' + pi + '/values/' + k, 'bad-value', c.message + '.', null);
      });
    });
    return out;
  }

  LE.variables = {
    VERSION: VERSION, LIMITS: LIMITS, TYPES: TYPES, PIPES: PIPES, DATE_STYLES: DATE_STYLES, PAPER: PAPER, locale: null,
    rowCap: rowCap,
    /* placeholders */ tokens: tokens, hasTokens: hasTokens, fillText: fillText, format: applyPipes, parseToken: parseToken, toNumber: toNumber, toDate: toDate, hexOf: hexOf, truthy: truthy,
    /* model */ detect: detect, definitions: definitions, storedList: storedList, renamePages: renamePages, renameList: renameList, keyFrom: keyFrom, labelOf: labelOf, guessType: guessType,
    /* drawing */ fillLayer: fillLayer, fillWith: fillWith, fillDoc: fillDoc, fitText: fitText, prepare: prepare, qrLib: qrLib,
    /* data */ parseCSV: parseCSV, parseFile: parseFile, table: table, decoderFor: decoderFor, automap: automap, coerce: coerce, rowsToValues: rowsToValues, checkRows: checkRows,
    /* photos */ photoIndex: photoIndex, photoKey: photoKey,
    /* output */ namer: namer, safeName: safeName, ZipWriter: ZipWriter, PdfWriter: PdfWriter, csvReport: csvReport, sheetLayout: sheetLayout, pageMM: pageMM, run: run,
    /* agents */ agent: { 'variables.set': agentVarsSet, 'values.set': agentValuesSet, 'bulk.pages': agentBulkPages, bulk: agentBulk,
      op: function (name, W, op, path, err) { var f = { 'variables.set': agentVarsSet, 'values.set': agentValuesSet, 'bulk.create': agentBulkPages }[name]; return Promise.resolve().then(function () { return f(W, op, path, err); }); } },
    lint: lint
  };
  redrawAll();
})(window);
