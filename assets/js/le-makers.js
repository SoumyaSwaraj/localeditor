/* LocalEditor: quick makers (registry, validation, layout helpers and the build pipeline).
   A maker is a small guided form that produces a finished, fully editable design: plain scene documents
   (text, photo slots, shapes, svg), never a flat picture. Pure: no studio dependency. See docs/MAKERS.md. */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};

  /* Maker files under assets/js/makers/, loaded on first use by LE.makers.ready(). Add yours here. */
  var FILES = ['quote', 'review', 'receipt', 'milestone', 'palette', 'film',
    /* Print set: calendars, charts, labels, stickers, photo books, zines, catalogues. */
    'calendar', 'chart'];

  var SIZES = {
    square: { id: 'square', name: 'Square', w: 1080, h: 1080 },
    portrait: { id: 'portrait', name: 'Portrait 4:5', w: 1080, h: 1350 },
    story: { id: 'story', name: 'Story 9:16', w: 1080, h: 1920 }
  };
  var TYPES = ['text', 'longtext', 'photo', 'photos', 'color', 'choice', 'date', 'number', 'list', 'toggle', 'table'];
  var BAD = { __proto__: 1, constructor: 1, prototype: 1 };
  var registry = {};
  var order = [];
  var fontsLoaded = {};

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function hash(str) {
    str = String(str);
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function word(v, n) { return typeof v === 'string' ? v.replace(/[^\w.:-]/g, '').slice(0, n) : ''; }
  function rootPath() {
    var r = (global.document && document.documentElement.getAttribute('data-root')) || '';
    if (r && r.charAt(r.length - 1) !== '/') r += '/';
    return r;
  }

  /* ---------- Registry ---------- */
  function register(def) {
    if (!def || typeof def !== 'object') throw new Error('A maker needs a definition.');
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(def.id || '')) throw new Error('Maker id must be lowercase letters, digits and dashes.');
    if (typeof def.build !== 'function') throw new Error('Maker ' + def.id + ' needs build(values, env).');
    var m = {
      id: def.id,
      name: String(def.name || def.id).slice(0, 60),
      category: String(def.category || 'Social').slice(0, 40),
      summary: String(def.summary || '').slice(0, 160),
      keywords: (def.keywords || []).map(String).slice(0, 30),
      sizes: (def.sizes && def.sizes.length ? def.sizes : [SIZES.square, SIZES.portrait, SIZES.story]).map(function (s) {
        if (typeof s === 'string') s = SIZES[s] || paperSize(s);
        if (!s || !/^[\w-]{1,24}$/.test(s.id) || !(s.w > 0) || !(s.h > 0)) throw new Error('Maker ' + def.id + ' has a bad size.');
        var out = { id: s.id, name: String(s.name || s.id), w: Math.round(s.w), h: Math.round(s.h) };
        if (s.print) out.print = printMeta(s.print);
        return out;
      }),
      inputs: (def.inputs || []).map(function (inp) {
        if (!inp || !/^[a-zA-Z]\w{0,31}$/.test(inp.key || '') || BAD[inp.key]) throw new Error('Maker ' + def.id + ' has a bad input key.');
        if (TYPES.indexOf(inp.type) < 0) throw new Error('Maker ' + def.id + ' input ' + inp.key + ' has an unknown type.');
        return inp;
      }),
      styles: (def.styles || [{ id: 'default', name: 'Default' }]).map(function (s) { return { id: word(s.id, 40), name: String(s.name || s.id), hint: s.hint || '' }; }),
      sample: def.sample || { values: {} },
      maxPages: clamp(Math.round(num(def.maxPages, 8)), 1, 50),
      build: def.build
    };
    if (!registry[m.id]) order.push(m.id);
    registry[m.id] = m;
    return m;
  }
  function list() {
    var rank = function (id) { var i = FILES.indexOf(id); return i < 0 ? 999 : i; };
    return order.slice().sort(function (a, b) { return rank(a) - rank(b); }).map(function (id) {
      var m = registry[id];
      return { id: m.id, name: m.name, category: m.category, summary: m.summary, keywords: m.keywords.slice(), sizes: clone(m.sizes), styles: clone(m.styles), inputs: clone(m.inputs), sample: clone(m.sample) };
    });
  }
  function get(id) { return own(registry, id) ? registry[id] : null; }

  var readyP = null;
  function ready() {
    if (readyP) return readyP;
    if (!LE.lazy || !global.document) { readyP = Promise.resolve(list()); return readyP; }
    readyP = Promise.all(FILES.map(function (f) {
      if (registry[f]) return null;
      return LE.lazy(rootPath() + 'assets/js/makers/' + f + '.js').catch(function (err) { if (global.console) console.warn(err.message); });
    })).then(function () { return list(); });
    return readyP;
  }

  /* ---------- Values ---------- */
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function validDate(s) {
    var m = DATE_RE.exec(s || '');
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    return y >= 1800 && y <= 2300 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo);
  }
  function cleanText(s, multiline) {
    s = String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g, '');
    if (!multiline) s = s.replace(/\s*\n\s*/g, ' ');
    return s.replace(/[ \t]+$/gm, '').replace(/^\s+|\s+$/g, '');
  }
  function maxOf(inp, d) { return inp.max != null ? inp.max : d; }
  /* Checks one value; returns { value, error }. value is the cleaned value (or undefined when empty). */
  function checkValue(inp, v) {
    var label = inp.label || inp.key;
    if (v == null || v === '') return { value: undefined };
    switch (inp.type) {
      case 'text':
      case 'longtext': {
        if (typeof v !== 'string' && typeof v !== 'number') return { error: label + ' must be text.' };
        var s = cleanText(v, inp.type === 'longtext');
        var mx = maxOf(inp, inp.type === 'text' ? 80 : 600);
        if (s.length > mx) return { error: label + ' is too long (' + s.length + ' of ' + mx + ' characters).' };
        if (inp.type === 'longtext' && s.split('\n').length > (inp.maxLines || 12)) return { error: label + ' has too many lines.' };
        return { value: s || undefined };
      }
      case 'photo':
        if (typeof v !== 'string' || !/^[\w:.-]{1,80}$/.test(v)) return { error: label + ' must be a photo from this device.' };
        return { value: v };
      case 'photos': {
        if (!Array.isArray(v)) return { error: label + ' must be a list of photos.' };
        if (v.length > maxOf(inp, 4)) return { error: label + ' takes at most ' + maxOf(inp, 4) + ' photos.' };
        for (var i = 0; i < v.length; i++) if (typeof v[i] !== 'string' || !/^[\w:.-]{0,80}$/.test(v[i])) return { error: label + ' must be photos from this device.' };
        var ps = v.filter(Boolean);
        return { value: ps.length ? ps : undefined };
      }
      case 'color':
        if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return { error: label + ' must be a colour like #1A2B3C.' };
        return { value: v.toUpperCase() };
      case 'choice': {
        var ids = (inp.options || []).map(function (o) { return typeof o === 'object' ? String(o.id) : String(o); });
        if (ids.indexOf(String(v)) < 0) return { error: label + ' must be one of: ' + ids.join(', ') + '.' };
        return { value: String(v) };
      }
      case 'date':
        if (typeof v !== 'string' || !validDate(v)) return { error: label + ' must be a real date (YYYY-MM-DD).' };
        return { value: v };
      case 'number': {
        if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) v = Number(v);
        if (typeof v !== 'number' || !isFinite(v)) return { error: label + ' must be a number.' };
        if (inp.min != null && v < inp.min) return { error: label + ' must be at least ' + inp.min + '.' };
        if (inp.max != null && v > inp.max) return { error: label + ' must be at most ' + inp.max + '.' };
        if (inp.step) v = Math.round(v / inp.step) * inp.step;
        return { value: Math.round(v * 1000) / 1000 };
      }
      case 'toggle':
        if (typeof v !== 'boolean') return { error: label + ' must be on or off.' };
        return { value: v };
      case 'list': {
        if (!Array.isArray(v)) return { error: label + ' must be a list.' };
        var rows = [];
        var cols = inp.columns ? inp.columns.length : 1;
        var cmax = inp.cellMax || 48;
        if (v.length > maxOf(inp, 15)) return { error: label + ' takes at most ' + maxOf(inp, 15) + ' rows.' };
        for (var r = 0; r < v.length; r++) {
          var row = v[r];
          if (cols > 1) {
            if (!Array.isArray(row) || row.length > cols) return { error: label + ' row ' + (r + 1) + ' must have ' + cols + ' parts.' };
            var cells = [];
            for (var c = 0; c < cols; c++) {
              var cell = row[c] == null ? '' : row[c];
              if (typeof cell !== 'string' && typeof cell !== 'number') return { error: label + ' row ' + (r + 1) + ' must be text.' };
              cell = cleanText(cell, false);
              if (cell.length > cmax) return { error: label + ' row ' + (r + 1) + ' is too long.' };
              cells.push(cell);
            }
            if (cells.some(Boolean)) rows.push(cells);
          } else {
            if (typeof row !== 'string' && typeof row !== 'number') return { error: label + ' row ' + (r + 1) + ' must be text.' };
            var t = cleanText(row, false);
            if (t.length > cmax) return { error: label + ' row ' + (r + 1) + ' is too long.' };
            if (t) rows.push(t);
          }
        }
        return { value: rows.length ? rows : undefined };
      }
      case 'table': {
        /* Rows as arrays of cells, or the packed form stored in doc.maker (strings of tab/newline separated rows). */
        if (!Array.isArray(v)) return { error: label + ' must be a table.' };
        var tcols = inp.columns || [];
        var trows = tableUnpack(v, 0);
        var tmax = maxOf(inp, 300);
        if (trows.length > tmax) return { error: label + ' takes at most ' + tmax + ' rows.' };
        for (var ti = 0; ti < trows.length; ti++) {
          if (trows[ti].length > tcols.length) return { error: label + ' row ' + (ti + 1) + ' has more than ' + tcols.length + ' columns.' };
          for (var tc = 0; tc < trows[ti].length; tc++) {
            var tv = tableCell(trows[ti][tc]);
            if (tv.length > (tcols[tc].max || 80)) return { error: label + ' row ' + (ti + 1) + ': ' + (tcols[tc].label || tcols[tc].key) + ' is too long.' };
            trows[ti][tc] = tv;
          }
        }
        var packed = tablePack(trows);
        if (!packed) return { error: label + ' has more text than one design holds (' + TABLE_CHUNKS * TABLE_CHUNK + ' characters).' };
        return { value: packed.length ? packed : undefined };
      }
    }
    return { error: label + ' is not supported.' };
  }
  /* Strict check of a whole value object. Unknown keys and wrong types are errors; script-like text is just text. */
  function validate(id, values) {
    var m = get(id);
    if (!m) return { ok: false, errors: [{ key: '', message: 'There is no maker called ' + String(id).slice(0, 40) + '.' }], values: {} };
    var errors = [];
    var out = {};
    if (values != null && (typeof values !== 'object' || Array.isArray(values))) {
      return { ok: false, errors: [{ key: '', message: 'Values must be an object.' }], values: {} };
    }
    values = values || {};
    var keys = {};
    m.inputs.forEach(function (inp) { keys[inp.key] = inp; });
    Object.keys(values).forEach(function (k) {
      if (!own(keys, k) || BAD[k]) errors.push({ key: k, message: 'Unknown field ' + String(k).slice(0, 32) + '.' });
    });
    m.inputs.forEach(function (inp) {
      var r = checkValue(inp, own(values, inp.key) ? values[inp.key] : undefined);
      if (r.error) errors.push({ key: inp.key, message: r.error });
      else if (r.value !== undefined) out[inp.key] = r.value;
      else if (inp.required) errors.push({ key: inp.key, message: (inp.label || inp.key) + ' is needed.', required: true });
    });
    return { ok: !errors.length, errors: errors, values: out };
  }

  /* ---------- Colour ---------- */
  function parseColor(c) {
    if (Array.isArray(c)) return [c[0], c[1], c[2], c[3] == null ? 1 : c[3]];
    c = String(c || '').trim();
    var m;
    if ((m = /^#([0-9a-f]{3,8})$/i.exec(c))) {
      var hx = m[1];
      if (hx.length === 3 || hx.length === 4) hx = hx.split('').map(function (x) { return x + x; }).join('');
      return [parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16), hx.length === 8 ? parseInt(hx.slice(6, 8), 16) / 255 : 1];
    }
    if ((m = /^rgba?\(([^)]+)\)$/i.exec(c))) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
      return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] == null ? 1 : p[3]];
    }
    if (/^white$/i.test(c)) return [255, 255, 255, 1];
    if (/^black$/i.test(c)) return [0, 0, 0, 1];
    return [0, 0, 0, 1];
  }
  function toHex(rgb) {
    return '#' + [0, 1, 2].map(function (i) { return ('0' + clamp(Math.round(rgb[i]), 0, 255).toString(16)).slice(-2); }).join('').toUpperCase();
  }
  function lum(c) {
    var p = parseColor(c);
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]);
  }
  function contrast(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function mix(a, b, t) {
    var p = parseColor(a), q = parseColor(b);
    return toHex([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
  }
  /* Composite a translucent colour over an opaque one. */
  function over(top, under) {
    var p = parseColor(top), q = parseColor(under);
    var a = p[3];
    return toHex([p[0] * a + q[0] * (1 - a), p[1] * a + q[1] * (1 - a), p[2] * a + q[2] * (1 - a)]);
  }
  function rgba(c, a) { var p = parseColor(c); return 'rgba(' + Math.round(p[0]) + ',' + Math.round(p[1]) + ',' + Math.round(p[2]) + ',' + r2(a) + ')'; }
  function hsl(c) {
    var p = parseColor(c), r = p[0] / 255, g = p[1] / 255, b = p[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  /* The given ink if it reads on bg at `ratio`; otherwise the same hue pushed darker or lighter until it does. */
  function ensure(fg, bg, ratio) {
    ratio = ratio || 4.5;
    if (contrast(fg, bg) >= ratio) return toHex(parseColor(fg));
    var towards = lum(bg) > 0.36 ? '#000000' : '#FFFFFF';
    for (var t = 0.1; t <= 1.0001; t += 0.1) {
      var c = mix(fg, towards, t);
      if (contrast(c, bg) >= ratio) return c;
    }
    return towards;
  }
  /* Best of the candidates on bg (first one that passes), else black or white. */
  function readable(bg, candidates, ratio) {
    ratio = ratio || 4.5;
    var list = (candidates || []).filter(Boolean);
    for (var i = 0; i < list.length; i++) if (contrast(list[i], bg) >= ratio) return toHex(parseColor(list[i]));
    return contrast('#16131C', bg) >= contrast('#FFFFFF', bg) ? '#16131C' : '#FFFFFF';
  }
  var COLOR = {
    parse: parseColor, hex: function (c) { return toHex(parseColor(c)); }, luminance: lum, contrast: contrast, mix: mix, over: over, rgba: rgba, hsl: hsl,
    tint: function (c, t) { return mix(c, '#FFFFFF', t); }, shade: function (c, t) { return mix(c, '#000000', t); },
    ensure: ensure, readable: readable, isDark: function (c) { return lum(c) < 0.22; }
  };

  /* A short human name for a colour (nearest of a small fixed table). */
  var NAMES = [
    ['Snow', '#FAFAF7'], ['Bone', '#E9E3D5'], ['Sand', '#D8C3A0'], ['Oat', '#C8B79A'], ['Clay', '#B0705A'], ['Terracotta', '#C4673F'], ['Rust', '#9C4A26'],
    ['Cocoa', '#5A3A2A'], ['Espresso', '#2E1F18'], ['Ink', '#1A1A22'], ['Charcoal', '#3A3A40'], ['Slate', '#5E6670'], ['Fog', '#A9B0B6'], ['Mist', '#D6DCE0'],
    ['Sky', '#8EC3E6'], ['Cornflower', '#5B86D6'], ['Cobalt', '#2050B0'], ['Navy', '#1B2A4A'], ['Teal', '#2A7F80'], ['Lagoon', '#3AA7A0'], ['Mint', '#A8DCC0'],
    ['Sage', '#9CAF88'], ['Olive', '#6B6B30'], ['Moss', '#4F5F33'], ['Forest', '#24452E'], ['Lime', '#B6CF4A'], ['Lemon', '#F1DD5B'], ['Mustard', '#D9A83A'],
    ['Saffron', '#F0A030'], ['Apricot', '#F4B183'], ['Coral', '#F07B65'], ['Tomato', '#E04A35'], ['Cherry', '#B21F35'], ['Wine', '#6E1F33'], ['Rose', '#E58BA0'],
    ['Blush', '#F2C6C8'], ['Mauve', '#B08AA6'], ['Plum', '#6A3B66'], ['Lavender', '#B9A8E0'], ['Violet', '#7457F0'], ['Peach', '#F8CBA8'], ['Butter', '#F6E7B0']
  ];
  function colorName(c) {
    var p = parseColor(c), best = NAMES[0][0], bd = 1e9;
    NAMES.forEach(function (n) {
      var q = parseColor(n[1]);
      var rm = (p[0] + q[0]) / 2;
      var d = (2 + rm / 256) * Math.pow(p[0] - q[0], 2) + 4 * Math.pow(p[1] - q[1], 2) + (2 + (255 - rm) / 256) * Math.pow(p[2] - q[2], 2);
      if (d < bd) { bd = d; best = n[0]; }
    });
    return best;
  }

  /* ---------- Dates ---------- */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysIn(y, m) { return [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
  function parseDate(s) {
    var m = DATE_RE.exec(s || '');
    return m && validDate(s) ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }
  function dayNumber(o) { return Math.round(Date.UTC(o.y, o.m - 1, o.d) / 86400000); }
  /* Adds months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
  function addMonths(o, n) {
    var t = o.y * 12 + (o.m - 1) + n;
    var y = Math.floor(t / 12), m = t - y * 12 + 1;
    return { y: y, m: m, d: Math.min(o.d, daysIn(y, m)) };
  }
  function iso(o) { return o.y + '-' + ('0' + o.m).slice(-2) + '-' + ('0' + o.d).slice(-2); }
  /* Calendar difference from a to b (b ≥ a): whole years, months, days, plus totals. */
  function diff(a, b) {
    a = typeof a === 'string' ? parseDate(a) : a;
    b = typeof b === 'string' ? parseDate(b) : b;
    if (!a || !b) return null;
    var sign = 1;
    if (dayNumber(b) < dayNumber(a)) { var t = a; a = b; b = t; sign = -1; }
    var months = (b.y - a.y) * 12 + (b.m - a.m);
    if (dayNumber(addMonths(a, months)) > dayNumber(b)) months--;
    var days = dayNumber(b) - dayNumber(addMonths(a, months));
    var total = dayNumber(b) - dayNumber(a);
    return { sign: sign, years: Math.floor(months / 12), months: months % 12, days: days, totalMonths: months, totalDays: total, totalWeeks: Math.floor(total / 7) };
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  /* "2 years, 3 months" · "3 weeks" · "12 days". */
  function describe(a, b, opts) {
    opts = opts || {};
    var d = diff(a, b);
    if (!d) return '';
    if (d.totalMonths < 1) {
      if (d.totalDays >= 14 && d.totalDays % 7 === 0) return plural(d.totalWeeks, 'week');
      return plural(d.totalDays, 'day');
    }
    var parts = [];
    if (d.years) parts.push(plural(d.years, 'year'));
    if (d.months) parts.push(plural(d.months, 'month'));
    if (!d.years && d.days && opts.days !== false) parts.push(plural(d.days, 'day'));
    return parts.join(', ') || plural(d.years, 'year');
  }
  function weekday(o) { return DAYS[(dayNumber(o) % 7 + 11) % 7]; }
  /* Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd; anything in [brackets] is literal. */
  function formatDate(s, pattern) {
    var o = typeof s === 'string' ? parseDate(s) : s;
    if (!o) return '';
    pattern = pattern || 'D MMMM YYYY';
    return pattern.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g, function (t, lit) {
      if (lit != null) return lit;
      switch (t) {
        case 'YYYY': return String(o.y);
        case 'YY': return ('0' + (o.y % 100)).slice(-2);
        case 'MMMM': return MONTHS[o.m - 1];
        case 'MMM': return MONTHS[o.m - 1].slice(0, 3);
        case 'MM': return ('0' + o.m).slice(-2);
        case 'M': return String(o.m);
        case 'DD': return ('0' + o.d).slice(-2);
        case 'D': return String(o.d);
        case 'dddd': return weekday(o);
        case 'ddd': return weekday(o).slice(0, 3);
      }
      return t;
    });
  }
  function todayIso() { var d = new Date(); return iso({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }); }
  /* Print calendars. weekdayIndex: 0 = Sunday … 6 = Saturday. */
  function weekdayIndex(o) { o = typeof o === 'string' ? parseDate(o) : o; return o ? (dayNumber(o) % 7 + 11) % 7 : -1; }
  function addDays(o, n) {
    o = typeof o === 'string' ? parseDate(o) : o;
    var d = new Date(Date.UTC(o.y, o.m - 1, o.d) + n * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  /* The first day of the week holding `o` (weekStart 1 = Monday, 0 = Sunday). */
  function weekOf(o, weekStart) {
    o = typeof o === 'string' ? parseDate(o) : o;
    var back = (weekdayIndex(o) - (weekStart === 0 ? 0 : 1) + 7) % 7;
    return addDays(o, -back);
  }
  /* A month as weeks of 7 days: [[{ y, m, d, inMonth, iso }]] — 4 to 6 rows, padded with the neighbouring months. */
  function monthGrid(y, m, weekStart) {
    var first = weekOf({ y: y, m: m, d: 1 }, weekStart);
    var weeks = [], cur = first;
    for (var w = 0; w < 6; w++) {
      var row = [];
      for (var i = 0; i < 7; i++) {
        row.push({ y: cur.y, m: cur.m, d: cur.d, inMonth: cur.m === m && cur.y === y, iso: iso(cur) });
        cur = addDays(cur, 1);
      }
      if (w >= 4 && !row[0].inMonth) break;
      weeks.push(row);
    }
    return weeks;
  }
  /* Weekday names in column order: 'dddd' full, 'ddd' short, 'd' one letter. */
  function weekdayNames(weekStart, form) {
    var out = [];
    for (var i = 0; i < 7; i++) {
      var n = DAYS[(i + (weekStart === 0 ? 0 : 1)) % 7];
      out.push(form === 'ddd' ? n.slice(0, 3) : form === 'd' ? n.charAt(0) : n);
    }
    return out;
  }
  var DATE = { parse: parseDate, iso: iso, diff: diff, describe: describe, format: formatDate, addMonths: addMonths, daysIn: daysIn, leap: leap, today: todayIso, months: MONTHS.slice(),
    weekday: weekdayIndex, addDays: addDays, weekOf: weekOf, monthGrid: monthGrid, weekdays: weekdayNames };

  /* ---------- Print foundations (paper sizes, label grids, tables) ---------- */
  /* Paper sizes at 300 dpi. The largest, A4 landscape at 3508 × 2480 (8.7 MP), stays under the smallest canvas limits
     the studio plans for (4096 px edge on older phones, 16.7 MP area on iOS), so every paper exports at 1×. A3 would not. */
  var PRINT_DPI = 300;
  var PAPER = {
    a4: { name: 'A4', w: 210, h: 297 },
    a5: { name: 'A5', w: 148, h: 210 },
    letter: { name: 'US Letter', w: 215.9, h: 279.4 },
    'photo-4x6': { name: '4 × 6 in', w: 101.6, h: 152.4 },
    'square-20': { name: 'Square 20 cm', w: 200, h: 200 },
    'a4-landscape': { name: 'A4 landscape', w: 297, h: 210 },
    'letter-landscape': { name: 'Letter landscape', w: 279.4, h: 215.9 },
    'a5-landscape': { name: 'A5 landscape', w: 210, h: 148 }
  };
  function mmPx(mm, dpi) { return Math.round(mm / 25.4 * (dpi || PRINT_DPI)); }
  function paperSize(id) {
    var p = own(PAPER, id) ? PAPER[id] : null;
    if (!p) return null;
    return { id: id, name: p.name, w: mmPx(p.w), h: mmPx(p.h), print: { v: 1, paper: id, w: p.w, h: p.h, dpi: PRINT_DPI } };
  }
  /* doc.print: the physical page a page is meant for ({ v, paper, w, h (mm), dpi }). Mirrors LE.Scene.printOf. */
  function printMeta(p) {
    if (LE.Scene && LE.Scene.printOf) return LE.Scene.printOf(p);
    if (!p || typeof p !== 'object') return null;
    var w = Number(p.w), h = Number(p.h), dpi = Number(p.dpi) || PRINT_DPI;
    if (!(w > 0 && h > 0)) return null;
    return { v: 1, paper: word(p.paper, 24), w: r2(clamp(w, 10, 2000)), h: r2(clamp(h, 10, 2000)), dpi: Math.round(clamp(dpi, 72, 1200)) };
  }
  /* Generic label-sheet grids (count per sheet → columns × rows, cell and gutter in mm), centred on the sheet. */
  var LABEL_GRIDS = {
    a4: {
      8: { cols: 2, rows: 4, w: 99.1, h: 67.7, gx: 2.5, gy: 0 },
      14: { cols: 2, rows: 7, w: 99.1, h: 38.1, gx: 2.5, gy: 0 },
      21: { cols: 3, rows: 7, w: 63.5, h: 38.1, gx: 2.5, gy: 0 },
      24: { cols: 3, rows: 8, w: 63.5, h: 33.9, gx: 2.5, gy: 0 },
      30: { cols: 3, rows: 10, w: 63.5, h: 26.9, gx: 2.5, gy: 0 },
      65: { cols: 5, rows: 13, w: 38.1, h: 21.2, gx: 2.5, gy: 0 }
    },
    letter: {
      8: { cols: 2, rows: 4, w: 101.6, h: 63.5, gx: 4.8, gy: 0 },
      14: { cols: 2, rows: 7, w: 101.6, h: 33.9, gx: 4.8, gy: 0 },
      21: { cols: 3, rows: 7, w: 66.7, h: 35.6, gx: 3.2, gy: 0 },
      24: { cols: 3, rows: 8, w: 66.7, h: 31.8, gx: 3.2, gy: 0 },
      30: { cols: 3, rows: 10, w: 66.7, h: 25.4, gx: 3.2, gy: 0 },
      65: { cols: 5, rows: 13, w: 38.1, h: 19.1, gx: 3.2, gy: 0 }
    }
  };
  function labelGrid(paper, count) {
    var fam = /^letter/.test(paper || '') ? 'letter' : 'a4';
    var g = LABEL_GRIDS[fam][count];
    return g ? Object.assign({ paper: fam, count: Number(count) }, g) : null;
  }

  /* Table values (input type `table`): rows of fixed columns, stored in doc.maker.values as at most TABLE_CHUNKS
     strings of at most TABLE_CHUNK characters ("cell\tcell" lines joined by "\n"), so a large sheet fits the doc.maker
     limits (40 array entries, 2000 characters a string) without widening them. */
  var TABLE_CHUNK = 2000, TABLE_CHUNKS = 40;
  function tableCell(s) { return cleanText(s == null ? '' : s, false).replace(/\t/g, ' '); }
  function tablePack(rows) {
    var chunks = [], cur = '';
    for (var i = 0; i < rows.length; i++) {
      var line = rows[i].map(tableCell).join('\t').replace(/\t+$/, '');
      if (!line) continue;
      if (line.length > TABLE_CHUNK) return null;
      if (cur && cur.length + 1 + line.length > TABLE_CHUNK) { chunks.push(cur); cur = ''; }
      cur = cur ? cur + '\n' + line : line;
    }
    if (cur) chunks.push(cur);
    return chunks.length > TABLE_CHUNKS ? null : chunks;
  }
  function tableUnpack(chunks, ncols) {
    var out = [];
    (Array.isArray(chunks) ? chunks : []).forEach(function (c) {
      if (Array.isArray(c)) { out.push(c.map(function (x) { return x == null ? '' : String(x); })); return; }
      String(c == null ? '' : c).split('\n').forEach(function (line) {
        var cells = line.split('\t');
        if (ncols) { while (cells.length < ncols) cells.push(''); cells = cells.slice(0, ncols); }
        out.push(cells.map(function (x) { return x.trim(); }));
      });
    });
    return out.filter(function (r) { return r.some(Boolean); });
  }
  /* RFC 4180 CSV / TSV (cells pasted from a spreadsheet are tab separated). Returns rows of trimmed strings. */
  function parseDelimited(text, delim) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (!delim) {
      var head = text.split('\n').slice(0, 5).join('\n');
      var tabs = (head.match(/\t/g) || []).length, semis = (head.match(/;/g) || []).length, commas = (head.match(/,/g) || []).length;
      delim = tabs ? '\t' : semis > commas ? ';' : ',';
    }
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length && rows.length < 5000; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
        continue;
      }
      if (ch === '"' && cell.trim() === '') { q = true; cell = ''; }
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { return String(c).trim(); }); }).filter(function (r) { return r.some(Boolean); });
  }
  function normHead(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  /* Matches a grid's first row to a table input's columns by key, label and aliases.
     Returns { map: { colKey: sourceIndex or -1 }, header: whether the first row is a header }. */
  function tableMatch(columns, grid) {
    var head = (grid[0] || []).map(normHead);
    var map = {}, used = {}, hits = 0;
    columns.forEach(function (c) {
      var names = [c.key, c.label].concat(c.aliases || []).map(normHead).filter(Boolean);
      var idx = -1;
      for (var pass = 0; pass < 2 && idx < 0; pass++) {
        for (var i = 0; i < head.length && idx < 0; i++) {
          if (used[i] || !head[i]) continue;
          var hd = head[i];
          if (names.some(function (n) { return pass ? (n.length > 2 && hd.indexOf(n) >= 0) : hd === n; })) idx = i;
        }
      }
      if (idx >= 0) { used[idx] = 1; hits++; }
      map[c.key] = idx;
    });
    var header = hits > 0;
    if (!header) columns.forEach(function (c, i) { map[c.key] = i < (grid[0] || []).length ? i : -1; });
    return { map: map, header: header };
  }
  /* Rows in column order from a grid and a mapping. Cells longer than a column's max are shortened (and counted). */
  function tableRows(columns, grid, match, maxRows) {
    var body = match.header ? grid.slice(1) : grid.slice();
    var cut = 0, out = [];
    body.forEach(function (r) {
      var row = columns.map(function (c) {
        var i = match.map[c.key];
        var s = i >= 0 && i < r.length ? tableCell(r[i]) : '';
        var mx = c.max || 80;
        if (s.length > mx) { cut++; s = s.slice(0, mx - 1).replace(/\s+\S*$/, '') + '…'; }
        return s;
      });
      if (row.some(Boolean)) out.push(row);
    });
    maxRows = maxRows || 300;
    return { rows: out.slice(0, maxRows), shortened: cut, dropped: Math.max(0, out.length - maxRows) };
  }
  var TABLE = { pack: tablePack, unpack: tableUnpack, parse: parseDelimited, match: tableMatch, rows: tableRows, CHUNK: TABLE_CHUNK, CHUNKS: TABLE_CHUNKS };

  /* ---------- Text measuring (mirrors LE.Scene's wrapping exactly) ---------- */
  var mctx = null;
  function measureCtx() {
    if (!mctx && global.document) mctx = document.createElement('canvas').getContext('2d');
    return mctx;
  }
  function fontCss(name) {
    if (LE.fonts && typeof LE.fonts.css === 'function') { try { return LE.fonts.css(name); } catch (e) { /* fall through */ } }
    return '"' + String(name).replace(/"/g, '') + '", sans-serif';
  }
  function mw(ctx, text, spacing) {
    if (!text) return 0;
    if (!spacing) return ctx.measureText(text).width;
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text.charAt(i)).width + spacing;
    return Math.max(0, w - spacing);
  }
  function wrap(ctx, text, maxW, spacing) {
    var paras = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var lines = [];
    var broke = false;
    function breakWord(wd) {
      broke = true;
      var buf = '';
      for (var i = 0; i < wd.length; i++) {
        var next = buf + wd.charAt(i);
        if (buf && mw(ctx, next, spacing) > maxW) { lines.push(buf); buf = wd.charAt(i); } else buf = next;
      }
      return buf;
    }
    paras.forEach(function (para) {
      if (!para) { lines.push(''); return; }
      var words = para.split(/(\s+)/);
      var line = '';
      words.forEach(function (wd) {
        if (!wd) return;
        if (!wd.trim()) { if (line && mw(ctx, line + wd, spacing) <= maxW) line += wd; return; }
        if (line && mw(ctx, line + wd, spacing) > maxW) { lines.push(line.replace(/\s+$/, '')); line = ''; }
        if (!line && mw(ctx, wd, spacing) > maxW) line = breakWord(wd);
        else line += wd;
      });
      lines.push(line.replace(/\s+$/, ''));
    });
    return { lines: lines.length ? lines : [''], broke: broke };
  }
  /* Lays text out at one size and width. t: { text, font, weight, italic, size, lineHeight, letterSpacing (px), uppercase, w } */
  function layout(t) {
    var ctx = measureCtx();
    var text = String(t.text == null ? '' : t.text);
    if (t.uppercase) text = text.toUpperCase();
    var size = t.size;
    if (!ctx) {
      var est = Math.max(1, Math.floor(t.w / (size * 0.55)));
      var n = 0;
      text.split('\n').forEach(function (p) { n += Math.max(1, Math.ceil(p.length / est)); });
      return { lines: new Array(n).fill(''), width: Math.min(t.w, text.length * size * 0.55), height: n * size * (t.lineHeight || 1.2), broke: false };
    }
    ctx.font = (t.italic ? 'italic ' : 'normal ') + (t.weight || 400) + ' ' + size + 'px ' + fontCss(t.font);
    var r = wrap(ctx, text, Math.max(1, t.w), t.letterSpacing || 0);
    var width = 0;
    r.lines.forEach(function (ln) { width = Math.max(width, mw(ctx, ln, t.letterSpacing || 0)); });
    return { lines: r.lines, width: width, height: r.lines.length * (t.lineHeight || 1.2) * size, broke: r.broke };
  }

  /* Glyph coverage of the shipped fonts (Latin and Latin Extended). Emoji fall back per glyph anyway. */
  function covered(text) {
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i);
      if (cp > 0xFFFF) { i++; if (cp >= 0x1F000) continue; return false; }
      if (cp <= 0x24F || (cp >= 0x1E00 && cp <= 0x1EFF) || (cp >= 0x2000 && cp <= 0x206F) || (cp >= 0x20A0 && cp <= 0x20CF)) continue;
      if (cp === 0x2122 || cp === 0x2212 || cp === 0x2215 || (cp >= 0x2190 && cp <= 0x2193) || cp === 0xFE0F || cp === 0x200D) continue;
      if ((cp >= 0x2600 && cp <= 0x27BF) || (cp >= 0x2B00 && cp <= 0x2BFF) || (cp >= 0x02B0 && cp <= 0x02FF) || (cp >= 0x0300 && cp <= 0x036F)) continue;
      return false;
    }
    return true;
  }
  function fontMeta(name) {
    var l = (LE.fonts && LE.fonts.list) ? LE.fonts.list() : [];
    for (var i = 0; i < l.length; i++) if (l[i].family === name) return l[i];
    return null;
  }
  /* The family to draw `text` in: the preferred one when it has the glyphs, else a plain shipped family whose
     CSS stack ends in the system font, so other scripts render from the system instead of as boxes. */
  function fontFor(pref, text) {
    if (covered(text)) return pref;
    var meta = fontMeta(pref);
    if (meta && meta.category === 'mono') return pref;
    if (meta && meta.category === 'serif') return 'Lora';
    return 'Inter';
  }
  function nearestWeight(font, weight) {
    var meta = fontMeta(font);
    if (!meta || !meta.weights || !meta.weights.length) return weight;
    var best = meta.weights[0];
    meta.weights.forEach(function (w) { if (Math.abs(w - weight) < Math.abs(best - weight)) best = w; });
    return best;
  }

  /* ---------- Print layout (pure geometry; env.print wraps it with layers) ---------- */
  /* Tiles cols × rows cells into area. With w/h (px) the grid keeps that cell size and is centred; otherwise it fills. */
  function sheetCells(area, o) {
    var cols = Math.max(1, o.cols | 0), rows = Math.max(1, o.rows | 0), gx = o.gx || 0, gy = o.gy || 0;
    var cw = o.w || (area.w - gx * (cols - 1)) / cols, ch = o.h || (area.h - gy * (rows - 1)) / rows;
    var gw = cw * cols + gx * (cols - 1), gh = ch * rows + gy * (rows - 1);
    var x0 = area.x + (area.w - gw) / 2, y0 = area.y + (area.h - gh) / 2;
    var out = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) out.push({ x: r2(x0 + c * (cw + gx)), y: r2(y0 + r * (ch + gy)), w: r2(cw), h: r2(ch), row: r, col: c, i: r * cols + c });
    return out;
  }
  function boundsOf(boxes) {
    var x = Infinity, y = Infinity, X = -Infinity, Y = -Infinity;
    boxes.forEach(function (b) { x = Math.min(x, b.x); y = Math.min(y, b.y); X = Math.max(X, b.x + b.w); Y = Math.max(Y, b.y + b.h); });
    return { x: x, y: y, w: X - x, h: Y - y };
  }
  function edgesOf(boxes, axis) {
    var seen = {}, out = [];
    boxes.forEach(function (b) {
      [axis === 'x' ? b.x : b.y, axis === 'x' ? b.x + b.w : b.y + b.h].forEach(function (v) {
        var k = Math.round(v * 2) / 2;
        if (!seen[k]) { seen[k] = 1; out.push(k); }
      });
    });
    return out.sort(function (a, b) { return a - b; });
  }
  /* Crop-mark ticks in the margin around the cells, one per distinct cell edge, per side. Sides without room are null.
     Returns { top, bottom, left, right: { segs: [[x1, y1, x2, y2]] }, bounds, xs, ys } in page px. */
  function cropTicks(cells, page, len, gap, edgeMin) {
    var B = boundsOf(cells), xs = edgesOf(cells, 'x'), ys = edgesOf(cells, 'y');
    function side(name) {
      var room = name === 'top' ? B.y : name === 'bottom' ? page.h - B.y - B.h : name === 'left' ? B.x : page.w - B.x - B.w;
      var l = Math.min(len, room - gap - edgeMin);
      if (l < len * 0.3) return null;
      var segs = [];
      if (name === 'top' || name === 'bottom') {
        var y1 = name === 'top' ? B.y - gap : B.y + B.h + gap, y2 = name === 'top' ? y1 - l : y1 + l;
        xs.forEach(function (x) { segs.push([x, y1, x, y2]); });
      } else {
        var x1 = name === 'left' ? B.x - gap : B.x + B.w + gap, x2 = name === 'left' ? x1 - l : x1 + l;
        ys.forEach(function (y) { segs.push([x1, y, x2, y]); });
      }
      return { segs: segs };
    }
    return { top: side('top'), bottom: side('bottom'), left: side('left'), right: side('right'), bounds: B, xs: xs, ys: ys };
  }
  /* The classic 8-page mini-zine on one landscape sheet: 4 × 2 panels, top row upside down. Reading order runs from the
     front (bottom right) to page 2 above it, leftwards along the top (2–5), then 6 and 7 along the bottom, then the back. */
  var ZINE = { 1: [3, 1, 0], 2: [3, 0, 180], 3: [2, 0, 180], 4: [1, 0, 180], 5: [0, 0, 180], 6: [0, 1, 0], 7: [1, 1, 0], 8: [2, 1, 0] };
  function zinePanels(W, H) {
    var pw = W / 4, ph = H / 2, out = [];
    for (var n = 1; n <= 8; n++) out.push({ page: n, x: r2(ZINE[n][0] * pw), y: r2(ZINE[n][1] * ph), w: r2(pw), h: r2(ph), rotation: ZINE[n][2] });
    return out;
  }
  /* Moves layers drawn in a panel's own frame (0,0 at its top-left) onto the sheet, turning them 180° when asked. */
  function placeIn(layers, panel) {
    layers.forEach(function (l) {
      if (panel.rotation === 180) {
        l.x = r2(panel.x + panel.w - l.x - l.w);
        l.y = r2(panel.y + panel.h - l.y - l.h);
        l.rotation = ((l.rotation || 0) + 180) % 360;
      } else { l.x = r2(l.x + panel.x); l.y = r2(l.y + panel.y); }
    });
    return layers;
  }
  /* Print themes shared by print makers: one structure in five looks, one of them ink-saving (no filled areas). */
  var PRINT_THEMES = {
    clean: { bg: '#FFFFFF', ink: '#1C1B22', muted: '#5E5B68', line: '#CFCBD6', faint: '#F3F1F6', accent: '#2D6CDF', accent2: '#E0574F', accent3: '#3AA17E', head: 'Plus Jakarta Sans', headWeight: 700, body: 'Inter', round: 2 },
    friendly: { bg: '#FFF9F0', ink: '#2B2340', muted: '#665C7A', line: '#E7D6BF', faint: '#FFEFD9', accent: '#F26B3A', accent2: '#2FA58E', accent3: '#F4B73E', head: 'Nunito', headWeight: 700, body: 'Nunito', round: 5 },
    pastel: { bg: '#FFFFFF', ink: '#3A3346', muted: '#6F6680', line: '#E3D9EE', faint: '#F8F3FC', accent: '#B79AE0', accent2: '#F2B5C4', accent3: '#9ED3C6', head: 'Fraunces', headWeight: 700, body: 'DM Sans', round: 4 },
    bold: { bg: '#FFFFFF', ink: '#111111', muted: '#3D3D3D', line: '#111111', faint: '#FFF3C4', accent: '#FFD23F', accent2: '#FF6B6B', accent3: '#4ECDC4', head: 'Archivo Black', headWeight: 400, body: 'Work Sans', round: 1.5, heavy: true },
    ink: { bg: '#FFFFFF', ink: '#000000', muted: '#3F3F3F', line: '#8C8C8C', faint: null, accent: '#000000', accent2: '#000000', accent3: '#000000', head: 'Lora', headWeight: 700, body: 'Inter', round: 2, inkSaver: true }
  };
  var PRINT = { sheet: sheetCells, bounds: boundsOf, cropTicks: cropTicks, zine: zinePanels, placeIn: placeIn, themes: PRINT_THEMES };

  /* ---------- Environment for one build pass ---------- */
  function makeEnv(m, values, size, style, opts, needs) {
    var W = size.w, H = size.h;
    var k = Math.min(W, H) / 1080;
    var used = {};
    var warnings = [];
    var seed = hash(JSON.stringify([m.id, style, size.id, values]));
    function uniq(id) {
      id = String(id || 'layer').replace(/[^\w.-]/g, '-').slice(0, 40) || 'layer';
      if (!used[id]) { used[id] = 1; return id; }
      var n = 2;
      while (used[id + '-' + n]) n++;
      used[id + '-' + n] = 1;
      return id + '-' + n;
    }
    function base(spec, type, defName) {
      return {
        id: uniq(spec.id || type), type: type, name: String(spec.name || defName || spec.id || type).slice(0, 80),
        x: r2(num(spec.x, 0)), y: r2(num(spec.y, 0)), w: r2(Math.max(1, num(spec.w, 100))), h: r2(Math.max(1, num(spec.h, 100))),
        rotation: num(spec.rotation, 0), opacity: spec.opacity == null ? 1 : clamp(num(spec.opacity, 1), 0, 1),
        blend: spec.blend || 'source-over', visible: true, locked: !!spec.locked, shadow: spec.shadow || null
      };
    }
    function needFont(font, weight, italic) {
      var key = font + '|' + weight + '|' + (italic ? 1 : 0);
      if (!fontsLoaded[key]) needs.fonts[key] = { font: font, weight: weight, italic: !!italic };
    }
    function fillOf(f) { return typeof f === 'string' ? { type: 'solid', color: f } : (f || { type: 'none' }); }
    function fit(spec) {
      var font = fontFor(spec.font || 'Inter', spec.text);
      var weight = nearestWeight(font, spec.weight || 400);
      var italic = !!spec.italic;
      needFont(font, weight, italic);
      var lh = spec.lineHeight || 1.2;
      var tracking = spec.tracking || 0;
      var max = Math.max(1, spec.size || 48);
      var min = Math.max(1, Math.min(max, spec.min || max * 0.4));
      var boxH = spec.h == null ? Infinity : spec.h;
      var maxLines = spec.maxLines || 0;
      function at(s) {
        /* 1.5% slack: canvas text widths shift slightly with the render scale, so a line measured to fit exactly at
           1× can wrap once more in a small preview or a large export. */
        return layout({ text: spec.text, font: font, weight: weight, italic: italic, size: s, lineHeight: lh, letterSpacing: tracking * s, uppercase: spec.uppercase, w: spec.w * 0.985 });
      }
      function ok(L, s) { return L.height <= boxH + 0.01 && (!maxLines || L.lines.length <= maxLines) && !L.broke; }
      var size = max, L = at(max);
      if (!ok(L, max)) {
        var lo = min, hi = max, best = null, bestL = null;
        for (var i = 0; i < 18 && hi - lo > 0.25; i++) {
          var mid = (lo + hi) / 2;
          var Lm = at(mid);
          if (ok(Lm, mid)) { best = mid; bestL = Lm; lo = mid; } else hi = mid;
        }
        if (best == null) {
          var Lmin = at(min);
          if (ok(Lmin, min)) { best = min; bestL = Lmin; }
        }
        if (best == null) {
          /* Even the smallest size breaks a word or overflows: keep the smallest size, flag it. */
          best = min; bestL = at(min);
          if (bestL.height > boxH + 0.01) warnings.push({ layer: spec.id, kind: 'tight', message: (spec.name || spec.id) + ' needed more room than its box.' });
        }
        size = Math.floor(best * 4) / 4;
        L = at(size);
      }
      var width = spec.w;
      if (spec.balance && L.lines.length > 1) {
        var n = L.lines.length, lo2 = spec.w * 0.45, hi2 = spec.w;
        for (var j = 0; j < 14; j++) {
          var mw2 = (lo2 + hi2) / 2;
          var Lb = layout({ text: spec.text, font: font, weight: weight, italic: italic, size: size, lineHeight: lh, letterSpacing: tracking * size, uppercase: spec.uppercase, w: mw2 });
          if (Lb.lines.length <= n && !Lb.broke) hi2 = mw2; else lo2 = mw2;
        }
        width = Math.min(spec.w, Math.ceil(hi2 + 2 + size * 0.04));
        L = layout({ text: spec.text, font: font, weight: weight, italic: italic, size: size, lineHeight: lh, letterSpacing: tracking * size, uppercase: spec.uppercase, w: width });
      }
      return { font: font, weight: weight, italic: italic, size: size, lineHeight: lh, letterSpacing: r2(tracking * size), lines: L.lines, lineCount: L.lines.length, width: width, textWidth: L.width, height: L.height };
    }
    /* A text layer fitted into the box { x, y, w, h }: shrinks from size to min, wraps, optionally balances,
       and sits at valign (top | middle | bottom) inside the box. Its h is the measured height. */
    function text(spec) {
      var f = fit(spec);
      var align = spec.align === 'center' || spec.align === 'right' ? spec.align : 'left';
      var x = num(spec.x, 0);
      if (f.width < spec.w) x += align === 'center' ? (spec.w - f.width) / 2 : align === 'right' ? spec.w - f.width : 0;
      var hh = Math.ceil(f.height + 1);
      var y = num(spec.y, 0);
      if (spec.h != null && isFinite(spec.h)) {
        if (spec.valign === 'middle') y += Math.max(0, (spec.h - hh) / 2);
        else if (spec.valign === 'bottom') y += Math.max(0, spec.h - hh);
      }
      var l = base({ id: spec.id, name: spec.name, x: x, y: y, w: Math.ceil(f.width + 0.5), h: hh, rotation: spec.rotation, opacity: spec.opacity, blend: spec.blend, shadow: spec.shadow }, 'text', 'Text');
      l.text = String(spec.text == null ? '' : spec.text);
      l.font = f.font;
      l.weight = f.weight;
      l.italic = f.italic;
      l.size = f.size;
      l.color = spec.color || '#16131C';
      l.fill = spec.fill || null;
      l.align = align;
      l.lineHeight = f.lineHeight;
      l.letterSpacing = f.letterSpacing;
      l.uppercase = !!spec.uppercase;
      l.underline = !!spec.underline;
      l.strike = false;
      l.stroke = spec.stroke || null;
      l.background = spec.background || null;
      l.curve = 0;
      return l;
    }
    function shape(id, spec) {
      var l = base(spec, 'shape', spec.name || 'Shape');
      l.shape = id;
      l.params = spec.params ? clone(spec.params) : {};
      l.radius = num(spec.radius, 0);
      l.fill = fillOf(spec.fill);
      l.stroke = spec.stroke ? { width: num(spec.stroke.width, 2), color: spec.stroke.color || '#16131C', dash: spec.stroke.dash || null, cap: spec.stroke.cap || 'round', join: spec.stroke.join || 'round' } : null;
      return l;
    }
    function rect(spec) {
      var rr = num(spec.radius, 0);
      if (rr > 0) { spec = Object.assign({}, spec, { params: Object.assign({ radius: rr }, spec.params || {}) }); return shape('rounded-rect', spec); }
      return shape('rect', spec);
    }
    function line(spec) {
      var wdt = Math.max(1, num(spec.width, 2));
      var l = shape('line', Object.assign({}, spec, { h: Math.max(wdt, num(spec.h, wdt)), fill: { type: 'none' } }));
      l.stroke = { width: wdt, color: spec.color || '#16131C', dash: spec.dash || null, cap: spec.cap || 'butt', join: 'miter' };
      return l;
    }
    function imageSize(id) {
      var img = opts.images && id ? opts.images[id] : null;
      if (!img) return null;
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      return w && h ? { w: w, h: h } : null;
    }
    function cover(id, w, h, focus) {
      var s = imageSize(id);
      if (!s) return { x: 0, y: 0, w: 1, h: 1 };
      focus = focus || { x: 0.5, y: 0.5 };
      var A = s.w / s.h, T = w / h, cw = 1, ch = 1;
      if (A > T) cw = T / A; else ch = A / T;
      var round4 = function (v) { return Math.round(v * 1e4) / 1e4; };
      return { x: round4(clamp(focus.x - cw / 2, 0, 1 - cw)), y: round4(clamp(focus.y - ch / 2, 0, 1 - ch)), w: round4(cw), h: round4(ch) };
    }
    /* A photo layer that is always a replaceable slot: filled when src is given, a labelled empty slot otherwise. */
    function photo(spec) {
      var l = base(spec, 'image', spec.name || 'Photo');
      var src = spec.src && /^[\w:.-]{1,80}$/.test(spec.src) ? spec.src : '';
      l.src = src;
      l.crop = src ? cover(src, l.w, l.h, spec.focus) : { x: 0, y: 0, w: 1, h: 1 };
      l.radius = num(spec.radius, 0);
      l.border = spec.border || null;
      l.mask = spec.mask || 'none';
      if (spec.maskPath) l.maskPath = spec.maskPath;
      l.adjust = spec.adjust ? clone(spec.adjust) : {};
      l.filter = spec.filter || null;
      l.removeBg = null;
      l.slot = { id: word(spec.slot || l.id, 40), label: String(spec.label || 'Add a photo').replace(/[<>]/g, '').slice(0, 80), photo: '' };
      return l;
    }
    function svg(spec) {
      var l = base(spec, 'svg', spec.name || 'Graphic');
      l.assetId = spec.assetId || '';
      l.svg = spec.markup || '';
      l.color = spec.color || null;
      l.strokeWidth = spec.strokeWidth == null ? null : spec.strokeWidth;
      return l;
    }
    function icon(assetId, spec) {
      var set = String(assetId).split(':')[0];
      var markup = '';
      if (LE.assets && LE.assets.svg) {
        try { markup = LE.assets.svg(assetId, { color: spec.color || undefined, strokeWidth: spec.strokeWidth }); } catch (e) { needs.sets[set] = 1; }
      }
      return svg(Object.assign({}, spec, { assetId: assetId, markup: markup }));
    }
    function qr(textValue, spec) {
      var q = global.qrcode;
      var fg = spec.color || '#16131C', bg = spec.background || null;
      var markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
      if (!q) needs.qr = 1;
      else {
        if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
        var code = q(0, spec.level || 'M');
        code.addData(String(textValue || ' '), 'Byte');
        code.make();
        var n = code.getModuleCount(), pad = spec.quiet == null ? 2 : spec.quiet, d = '';
        for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (code.isDark(r, c)) d += 'M' + (c + pad) + ' ' + (r + pad) + 'h1v1h-1z';
        var S = n + pad * 2;
        markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S + '" shape-rendering="crispEdges">' +
          (bg ? '<rect width="' + S + '" height="' + S + '" fill="' + bg + '"/>' : '') + '<path d="' + d + '" fill="' + fg + '"/></svg>';
      }
      return svg(Object.assign({ name: 'QR code' }, spec, { markup: markup, color: null }));
    }
    function palette(id, n) {
      var img = opts.images && id ? opts.images[id] : null;
      if (!img || !LE.palette || !LE.palette.extract || !img.getContext) return null;
      var raw = LE.palette.extract(img, Math.min(8, (n || 6) + 2)) || [];
      /* Drop near-duplicates, keep the most distinct n, ordered dark to light. */
      var out = [];
      raw.forEach(function (c) {
        if (out.every(function (o) { return contrast(o.hex, c.hex) > 1.12 || Math.abs(hsl(o.hex)[0] - hsl(c.hex)[0]) > 18; })) out.push(c);
      });
      out = out.slice(0, n || 6).map(function (c) { return c.hex.toUpperCase(); });
      out.sort(function (a, b) { return lum(a) - lum(b); });
      return out;
    }
    var rnd = (function (s) {
      return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    })(seed);
    var env = {
      W: W, H: H, k: k, size: clone(size), style: style, maker: m.id, today: opts.today && validDate(opts.today) ? opts.today : todayIso(),
      aspect: W / H, tall: H / W > 1.5, portrait: H / W > 1.1 && H / W <= 1.5, square: Math.abs(H / W - 1) < 0.1,
      type: { display: Math.round(132 * k), h1: Math.round(92 * k), h2: Math.round(64 * k), h3: Math.round(46 * k), body: Math.round(36 * k), small: Math.round(28 * k), caption: Math.round(22 * k) },
      random: rnd, seed: seed,
      page: function (bg) {
        var background = typeof bg === 'string' ? { type: 'color', color: bg } : (bg || { type: 'color', color: '#FFFFFF' });
        return { v: 1, width: W, height: H, background: background, layers: [] };
      },
      fit: fit, text: text, shape: shape, rect: rect, line: line, ellipse: function (spec) { return shape('ellipse', spec); },
      star: function (spec) { return shape('star', Object.assign({ params: { points: 5, innerRatio: 0.45 } }, spec)); },
      photo: photo, svg: svg, icon: icon, qr: qr, cover: cover, imageSize: imageSize, palette: palette,
      /* The file name of a photo (from build opts.names: { assetId: name }), to match photos to rows by name. */
      photoName: function (id) { return opts.names && id && own(opts.names, id) ? String(opts.names[id]).slice(0, 120) : ''; },
      color: COLOR, colorName: colorName, date: DATE, font: fontFor, covered: covered,
      gradient: function (id) {
        var g = (LE.assets && LE.assets.gradients ? LE.assets.gradients() : []).filter(function (x) { return x.id === id; })[0];
        return g ? clone(g) : null;
      },
      colorSet: function (id) {
        var s = (LE.assets && LE.assets.colorSets ? LE.assets.colorSets() : []).filter(function (x) { return x.id === id; })[0];
        return s ? s.colors.slice() : null;
      },
      /* Layout */
      box: function (x, y, w, h) { return { x: x, y: y, w: w, h: h }; },
      inset: function (b, t, r, bt, l) {
        if (r == null) r = t; if (bt == null) bt = t; if (l == null) l = r;
        return { x: b.x + l, y: b.y + t, w: Math.max(1, b.w - l - r), h: Math.max(1, b.h - t - bt) };
      },
      centre: function (w, h, b) { b = b || { x: 0, y: 0, w: W, h: H }; return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w: w, h: h }; },
      grid: function (b, n, cols, gap) {
        cols = Math.max(1, cols || Math.ceil(Math.sqrt(n)));
        var rows = Math.ceil(n / cols), g = gap || 0, out = [];
        var cw = (b.w - g * (cols - 1)) / cols, ch = (b.h - g * (rows - 1)) / rows;
        for (var i = 0; i < n; i++) out.push({ x: b.x + (i % cols) * (cw + g), y: b.y + Math.floor(i / cols) * (ch + g), w: cw, h: ch });
        return out;
      },
      split: function (b, parts, gap, vertical) {
        var total = parts.reduce(function (a, p) { return a + p; }, 0), g = gap || 0, out = [];
        var span = (vertical ? b.h : b.w) - g * (parts.length - 1), at = vertical ? b.y : b.x;
        parts.forEach(function (p) {
          var s = span * p / total;
          out.push(vertical ? { x: b.x, y: at, w: b.w, h: s } : { x: at, y: b.y, w: s, h: b.h });
          at += s + g;
        });
        return out;
      },
      /* Moves layers so the block they make sits at valign inside box (y only). Returns the block height. */
      place: function (layers, box, valign) {
        if (!layers.length) return 0;
        var top = Infinity, bottom = -Infinity;
        layers.forEach(function (l) { top = Math.min(top, l.y); bottom = Math.max(bottom, l.y + l.h); });
        var hh = bottom - top, target = box.y;
        if (valign === 'middle') target = box.y + (box.h - hh) / 2;
        else if (valign === 'bottom') target = box.y + box.h - hh;
        var dy = target - top;
        layers.forEach(function (l) { l.y = r2(l.y + dy); });
        return hh;
      },
      warn: function (kind, message, layer) { warnings.push({ layer: layer || '', kind: kind, message: message }); },
      warnings: warnings
    };
    /* Print helpers: physical units, safe area, sheets of repeated items, cut marks as editable layers. */
    var pinfo = size.print || null, dpi = pinfo ? pinfo.dpi : PRINT_DPI;
    function mm(n) { return n / 25.4 * dpi; }
    function segSvg(segs, ox, oy, w, h, color, width, dash) {
      var d = segs.map(function (s) { return 'M' + r2(s[0] - ox) + ' ' + r2(s[1] - oy) + 'L' + r2(s[2] - ox) + ' ' + r2(s[3] - oy); }).join('');
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + r2(w) + ' ' + r2(h) + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + r2(width) + '"' +
        (dash ? ' stroke-dasharray="' + dash.map(r2).join(' ') + '"' : '') + ' stroke-linecap="butt"/></svg>';
    }
    function segLayer(id, name, segs, color, width, dash) {
      if (!segs.length) return null;
      var b = boundsOf(segs.map(function (s) { return { x: Math.min(s[0], s[2]), y: Math.min(s[1], s[3]), w: Math.abs(s[2] - s[0]), h: Math.abs(s[3] - s[1]) }; }));
      b = { x: b.x - width, y: b.y - width, w: b.w + 2 * width, h: b.h + 2 * width };
      return svg({ id: id, name: name, x: b.x, y: b.y, w: b.w, h: b.h, markup: segSvg(segs, b.x, b.y, b.w, b.h, color, width, dash) });
    }
    /* Groups layers under a named group layer (placed after its members, as LE.Scene does). Returns members + group. */
    function group(name, layers, id) {
      layers = layers.filter(Boolean);
      if (!layers.length) return [];
      var b = boundsOf(layers);
      var g = base({ id: id || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: name, x: b.x, y: b.y, w: b.w, h: b.h }, 'group', name);
      layers.forEach(function (l) { l.groupId = g.id; });
      return layers.concat([g]);
    }
    env.print = {
      paper: pinfo ? clone(pinfo) : null, dpi: dpi,
      mm: mm, inch: function (n) { return n * dpi; }, pt: function (n) { return n / 72 * dpi; },
      /* The area inside a margin (mm, default 10) that home printers reach. */
      safe: function (marginMm) { var mg = mm(marginMm == null ? 10 : marginMm); return { x: mg, y: mg, w: W - 2 * mg, h: H - 2 * mg }; },
      sheet: sheetCells, bounds: boundsOf, zine: zinePanels, placeIn: placeIn, group: group,
      /* A generic label grid (LE.makers.labelGrid) as cells on this page, in px; null when the paper has none. */
      labels: function (count) {
        var g = labelGrid(pinfo ? pinfo.paper : '', count);
        if (!g) return null;
        return sheetCells({ x: 0, y: 0, w: W, h: H }, { cols: g.cols, rows: g.rows, w: mm(g.w), h: mm(g.h), gx: mm(g.gx), gy: mm(g.gy) });
      },
      theme: function (id, accent) {
        var t = clone(PRINT_THEMES[id] || PRINT_THEMES.clean);
        if (accent && !t.inkSaver) t.accent = accent;
        t.r = mm(t.round);
        t.hair = Math.max(2, mm(0.25));
        return t;
      },
      /* Cut and fold guides as one group of ordinary layers named "Cut marks" (hide or delete it in Layers).
         o: { cells (boxes to crop around), marks (default true), lines (dashed lines along every cell edge),
         outlines ([{ x, y, w, h, shape: rect|ellipse, radius }]), folds, cuts ([[x1, y1, x2, y2]]), holes ([{ x, y, d }]),
         color, width (px), len and gap (mm), name }. Put the result first in page.layers so it sits under the design. */
      cutMarks: function (o) {
        o = o || {};
        var color = o.color || '#77737F', width = o.width || Math.max(2, mm(0.2)), out = [];
        var dash = [mm(1.6), mm(1.2)];
        if (o.cells && o.cells.length) {
          var t = cropTicks(o.cells, { w: W, h: H }, mm(o.len || 5), mm(o.gap == null ? 1.5 : o.gap), mm(1.5));
          if (o.marks !== false) ['top', 'bottom', 'left', 'right'].forEach(function (sd) { if (t[sd]) out.push(segLayer('crop-' + sd, 'Crop marks ' + sd, t[sd].segs, color, width)); });
          if (o.lines) {
            var B = t.bounds, segs = [];
            t.xs.forEach(function (x) { segs.push([x, B.y, x, B.y + B.h]); });
            t.ys.forEach(function (y) { segs.push([B.x, y, B.x + B.w, y]); });
            out.push(segLayer('cut-lines', 'Cut lines', segs, color, width, dash));
          }
        }
        (o.outlines || []).forEach(function (b, i) {
          var sw = width, x = b.x - sw / 2, y = b.y - sw / 2, w = b.w + sw, h = b.h + sw, shp;
          if (b.shape === 'ellipse') shp = '<ellipse cx="' + r2(w / 2) + '" cy="' + r2(h / 2) + '" rx="' + r2(b.w / 2) + '" ry="' + r2(b.h / 2) + '"';
          else shp = '<rect x="' + r2(sw / 2) + '" y="' + r2(sw / 2) + '" width="' + r2(b.w) + '" height="' + r2(b.h) + '" rx="' + r2(b.radius || 0) + '"';
          out.push(svg({ id: 'cut-outline-' + (i + 1), name: 'Cut line ' + (i + 1), x: x, y: y, w: w, h: h,
            markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + r2(w) + ' ' + r2(h) + '" preserveAspectRatio="none">' + shp + ' fill="none" stroke="' + color + '" stroke-width="' + r2(sw) + '" stroke-dasharray="' + dash.map(r2).join(' ') + '"/></svg>' }));
        });
        if (o.folds && o.folds.length) out.push(segLayer('fold-lines', 'Fold lines', o.folds, color, width, [mm(3), mm(2)]));
        if (o.cuts && o.cuts.length) out.push(segLayer('cut-here', 'Cut here', o.cuts, color, width * 1.5));
        (o.holes || []).forEach(function (hl, i) {
          out.push(shape('ellipse', { id: 'punch-' + (i + 1), name: 'Punch hole ' + (i + 1), x: hl.x - hl.d / 2, y: hl.y - hl.d / 2, w: hl.d, h: hl.d, fill: { type: 'none' }, stroke: { width: width, color: color, dash: dash } }));
        });
        return group(o.name || 'Cut marks', out, o.id || 'cut-marks');
      }
    };
    return env;

  }

  /* ---------- Build ---------- */
  function loadNeeds(needs) {
    var jobs = [];
    Object.keys(needs.fonts).forEach(function (key) {
      var f = needs.fonts[key];
      if (!LE.fonts || !LE.fonts.load) { fontsLoaded[key] = 1; return; }
      jobs.push(Promise.resolve(LE.fonts.load(f.font, f.weight, f.italic)).then(function () { fontsLoaded[key] = 1; }, function () { fontsLoaded[key] = 1; }));
    });
    Object.keys(needs.sets).forEach(function (set) {
      if (LE.assets && LE.assets.load) jobs.push(LE.assets.load(set).catch(function () {}));
    });
    if (needs.qr && LE.lazy) jobs.push(LE.lazy(rootPath() + 'assets/vendor/qrcode.js').catch(function () {}));
    return Promise.all(jobs);
  }
  function hasNeeds(n) { return Object.keys(n.fonts).length || Object.keys(n.sets).length || n.qr; }

  /* A short fingerprint of what the person sees (geometry, text, sources, colours), to notice hand edits. */
  function signature(layers) {
    var proj = (layers || []).map(function (l) {
      return [l.type, Math.round(l.x), Math.round(l.y), Math.round(l.w), Math.round(l.h), Math.round(l.rotation || 0), l.text || '', l.src || '', l.font || '',
        Math.round(l.size || 0), l.color || '', JSON.stringify(l.fill || ''), l.shape || '', l.visible === false ? 0 : 1];
    });
    return hash(JSON.stringify(proj)).toString(36);
  }

  function build(id, values, opts) {
    opts = opts || {};
    return ready().then(function () {
      var m = get(id);
      if (!m) throw new Error('There is no maker called ' + String(id).slice(0, 40) + '.');
      var v = validate(id, values);
      var hard = v.errors.filter(function (e) { return !e.required; });
      if (hard.length) { var err = new Error(hard[0].message); err.errors = v.errors; throw err; }
      var size = m.sizes.filter(function (s) { return s.id === opts.size; })[0] || m.sizes[0];
      var style = (m.styles.filter(function (s) { return s.id === opts.style; })[0] || m.styles[0]).id;
      /* Empty required text shows its placeholder, so a half-filled form still previews. */
      var vals = clone(v.values);
      m.inputs.forEach(function (inp) {
        if (vals[inp.key] === undefined && inp.default !== undefined) vals[inp.key] = clone(inp.default);
        if (vals[inp.key] === undefined && inp.required && (inp.type === 'text' || inp.type === 'longtext') && inp.placeholder) vals[inp.key] = String(inp.placeholder);
      });
      var pass = 0;
      function run() {
        var needs = { fonts: {}, sets: {}, qr: 0 };
        var env = makeEnv(m, vals, size, style, opts, needs);
        var res = m.build(clone(vals), env);
        if (hasNeeds(needs) && pass < 3) { pass++; return loadNeeds(needs).then(run); }
        return Promise.resolve({ res: res, env: env });
      }
      return run().then(function (out) {
        var res = out.res || {};
        var pages = (res.pages || (res.page ? [res.page] : [])).slice(0, m.maxPages);
        if (!pages.length) throw new Error('Maker ' + id + ' made no pages.');
        var meta = { v: 1, id: m.id, style: style, size: size.id, values: v.values };
        pages.forEach(function (p) {
          p.width = size.w; p.height = size.h;
          if (size.print) p.print = clone(size.print); else delete p.print;
          var mm = clone(meta);
          mm.sig = signature(p.layers);
          p.maker = LE.Scene && LE.Scene.makerOf ? LE.Scene.makerOf(mm) : mm;
        });
        return { name: String(res.name || m.name).slice(0, 120), pages: pages, warnings: out.env.warnings };
      });
    });
  }

  /* ---------- Quality checks (also the self-check an agent can run) ---------- */
  function bbox(l) { return { x: l.x, y: l.y, w: l.w, h: l.h }; }
  function inside(a, b) { return a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1; }
  function solidUnder(doc, idx, box) {
    for (var i = idx - 1; i >= 0; i--) {
      var l = doc.layers[i];
      if (l.visible === false || l.type === 'group') continue;
      var b = bbox(l);
      var overlaps = !(b.x + b.w <= box.x || b.x >= box.x + box.w || b.y + b.h <= box.y || b.y >= box.y + box.h);
      if (!overlaps) continue;
      if (l.type === 'text' || l.type === 'path') continue;
      if (l.type === 'shape' && /^(rect|rounded-rect|rectangle)$/.test(l.shape) && inside(box, b) && !l.rotation) {
        var f = l.fill || {};
        if (f.type === 'none') continue;
        if (f.type === 'solid' || (!f.type && f.color)) {
          var col = parseColor(f.color);
          if ((l.opacity == null ? 1 : l.opacity) >= 0.97 && col[3] >= 0.97) return { color: toHex(col) };
        }
        return null;
      }
      if (l.type === 'svg' && l.name && /paper|card/i.test(l.name) && inside(box, b) && l.color) return { color: l.color };
      return null;
    }
    var bg = doc.background || {};
    if (bg.type === 'color' && bg.color) return { color: toHex(parseColor(bg.color)) };
    return null;
  }
  /* Problems in a built page: overflow (text taller or wider than its box), offpage, contrast (< ratio where the
     background under the text is a known solid colour), font (not a shipped family). */
  function check(doc, opts) {
    opts = opts || {};
    var ratio = opts.ratio || 4.5;
    var out = [];
    var families = (LE.fonts && LE.fonts.list ? LE.fonts.list() : []).map(function (f) { return f.family; });
    (doc.layers || []).forEach(function (l, i) {
      if (l.visible === false) return;
      if (l.x + l.w <= 0 || l.y + l.h <= 0 || l.x >= doc.width || l.y >= doc.height) out.push({ layer: l.id, kind: 'offpage', message: l.name + ' is off the page.' });
      if (l.type !== 'text') return;
      if (families.length && families.indexOf(l.font) < 0) out.push({ layer: l.id, kind: 'font', message: l.name + ' uses ' + l.font + ', which is not shipped.' });
      var L = layout({ text: l.text, font: l.font, weight: l.weight, italic: l.italic, size: l.size, lineHeight: l.lineHeight, letterSpacing: l.letterSpacing, uppercase: l.uppercase, w: l.w });
      if (L.height > l.h + 0.5 || L.width > l.w + 0.5) out.push({ layer: l.id, kind: 'overflow', message: l.name + ' does not fit its box.', need: { w: L.width, h: L.height } });
      if (!/[A-Za-z0-9À-ɏ]/.test(l.text || '')) return;
      var under = l.background ? { color: toHex(parseColor(l.background.color)) } : solidUnder(doc, i, bbox(l));
      if (!under || l.fill) return;
      var ink = (l.opacity == null ? 1 : l.opacity) < 1 ? over(rgba(l.color, l.opacity), under.color) : l.color;
      var cr = contrast(ink, under.color);
      if (cr < ratio) out.push({ layer: l.id, kind: 'contrast', message: l.name + ' contrast is ' + cr.toFixed(2) + ':1.', ratio: cr });
    });
    return out;
  }

  /* Renders a page off-screen with LE.Scene. images: { assetId: canvas|img }. Returns a canvas. */
  function renderPage(doc, opts) {
    opts = opts || {};
    if (!LE.Scene || !global.document) return Promise.reject(new Error('Rendering needs LE.Scene in a browser.'));
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:64px;height:64px;pointer-events:none;';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    var sc = new LE.Scene({ el: host, width: doc.width, height: doc.height });
    Object.keys(opts.images || {}).forEach(function (k) { if (opts.images[k]) sc.addAsset(k, opts.images[k]); });
    sc.load(doc);
    var scale = opts.scale || Math.min(1, (opts.maxEdge || 640) / Math.max(doc.width, doc.height));
    function done() { try { sc.destroy(); } catch (e) {} host.remove(); }
    return sc.render(scale, { includeBackground: true }).then(function (c) { done(); return c; }, function (err) { done(); throw err; });
  }

  /* Values in a link: base64url JSON, checked strictly. Returns { ok, values, errors }. */
  function decodeValues(id, b64) {
    try {
      if (typeof b64 !== 'string' || b64.length > 12000 || !/^[A-Za-z0-9_-]*={0,2}$/.test(b64)) throw new Error('bad');
      var s = b64.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      var bin = atob(s);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      var obj = JSON.parse(json, function (k, v) { if (BAD[k]) throw new Error('bad'); return v; });
      var v = validate(id, obj);
      var hard = v.errors.filter(function (e) { return !e.required; });
      return { ok: !hard.length, values: hard.length ? {} : v.values, errors: v.errors };
    } catch (e) {
      return { ok: false, values: {}, errors: [{ key: '', message: 'Those details could not be read.' }] };
    }
  }
  function encodeValues(values) {
    var json = JSON.stringify(values || {});
    var bytes = new TextEncoder().encode(json);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* QA fixtures for a maker: its sample, the least it accepts (required fields only, no photos) and the worst case
     (every field at its limit, long words, every list row, photos). photos: asset ids to use for photo inputs. */
  var WORDS = ('remember the afternoon light across the harbour when everything we owned fitted into two small bags and nobody ' +
    'knew our names extraordinary wonderful unbelievable thoughtfulness neighbourhood').split(' ');
  function filler(n, offset) {
    var out = '', i = offset || 0;
    while (out.length < n) { var w = WORDS[i++ % WORDS.length]; out += (out ? ' ' : '') + w; }
    out = out.slice(0, n).replace(/\s+\S*$/, '');
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  function cases(id, photos) {
    var m = get(id);
    if (!m) return null;
    photos = photos || [];
    var minimal = {}, worst = {};
    m.inputs.forEach(function (inp, i) {
      var t = inp.type;
      if (inp.required) {
        if (t === 'text' || t === 'longtext') minimal[inp.key] = 'Hi';
        else if (t === 'photo') minimal[inp.key] = photos[0] || 'missing-photo';
        else if (t === 'photos') minimal[inp.key] = [photos[0] || 'missing-photo'];
        else if (t === 'choice') minimal[inp.key] = String(typeof inp.options[0] === 'object' ? inp.options[0].id : inp.options[0]);
        else if (t === 'date') minimal[inp.key] = '2026-01-31';
        else if (t === 'number') minimal[inp.key] = inp.min != null ? inp.min : 0;
        else if (t === 'list') minimal[inp.key] = inp.columns ? [inp.columns.map(function () { return 'A'; })] : ['A'];
        else if (t === 'table') minimal[inp.key] = [inp.columns.map(function (c, ci) { return ci === 0 ? 'A' : ''; })];
        else if (t === 'toggle') minimal[inp.key] = false;
        else if (t === 'color') minimal[inp.key] = '#000000';
      }
      if (t === 'text') worst[inp.key] = filler(maxOf(inp, 80), i * 3);
      else if (t === 'longtext') worst[inp.key] = filler(maxOf(inp, 600), i);
      else if (t === 'photo') worst[inp.key] = photos[i % Math.max(1, photos.length)] || 'missing-photo';
      else if (t === 'photos') { worst[inp.key] = []; for (var p = 0; p < maxOf(inp, 4); p++) worst[inp.key].push(photos[p % Math.max(1, photos.length)] || 'missing-photo'); }
      else if (t === 'choice') { var o = inp.options[inp.options.length - 1]; worst[inp.key] = String(typeof o === 'object' ? o.id : o); }
      else if (t === 'date') worst[inp.key] = '2024-02-29';
      else if (t === 'number') worst[inp.key] = inp.max != null ? inp.max : 999999;
      else if (t === 'toggle') worst[inp.key] = true;
      else if (t === 'color') worst[inp.key] = '#F4F1EA';
      else if (t === 'list') {
        worst[inp.key] = [];
        var cm = inp.cellMax || 48;
        for (var r = 0; r < maxOf(inp, 15); r++) {
          worst[inp.key].push(inp.columns ? inp.columns.map(function (c, ci) { return ci === inp.columns.length - 1 ? '9,999,999.99'.slice(0, Math.min(12, cm)) : filler(cm, r + ci); }) : filler(cm, r));
        }
      }
      else if (t === 'table') {
        /* Every row, every cell as long as the stored-text budget allows. Columns may give a `worst` value. */
        var nrows = maxOf(inp, 300), tcols = inp.columns;
        var budget = Math.floor(TABLE_CHUNK * TABLE_CHUNKS * 0.96 / nrows) - tcols.length;
        var want = tcols.reduce(function (a, c) { return a + (c.worst != null ? String(c.worst).length : (c.max || 80)); }, 0);
        var k = Math.min(1, budget / want);
        worst[inp.key] = [];
        for (var tr = 0; tr < nrows; tr++) {
          worst[inp.key].push(tcols.map(function (c, ci) {
            if (c.worst != null) return String(c.worst);
            return filler(Math.max(4, Math.floor((c.max || 80) * k)), tr + ci * 5);
          }));
        }
      }
    });
    return { sample: clone(m.sample.values || {}), minimal: minimal, worst: worst };
  }

  LE.makers = {
    FILES: FILES, SIZES: SIZES, TYPES: TYPES, cases: cases,
    register: register, list: list, get: get, ready: ready,
    validate: validate, build: build, check: check, signature: signature, renderPage: renderPage,
    decodeValues: decodeValues, encodeValues: encodeValues,
    color: COLOR, date: DATE, colorName: colorName, layout: layout, covered: covered, fontFor: fontFor,
    PAPER: PAPER, PRINT_DPI: PRINT_DPI, paperSize: paperSize, labelGrid: labelGrid, LABEL_GRIDS: LABEL_GRIDS, table: TABLE, print: PRINT
  };
})(typeof window !== 'undefined' ? window : this);
