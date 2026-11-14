/* LocalEditor charts engine (LE.charts). docs/CHARTS.md.
   Pure functions: a chart is plain data on a group layer (layer.chart); build() turns it into ordinary layers (shapes and
   text) inside the group's box. Nothing here is needed to open, draw, export or print a design that contains a chart.
   No dependency. Text is measured with the real fonts when a canvas is there (load them first: LE.charts.ready). */
(function (root) {
  'use strict';
  var LE = root.LE = root.LE || {};
  var CAP = { cells: 5000, cols: 60, layers: 420, cats: 40, series: 12, points: 240, scatter: 250, poly: 250 };
  var MINUS = '−', DASH = '–', DOTS = '…';

  function r2(n) { return Math.round(n * 100) / 100; }
  function r4(n) { return Math.round(n * 10000) / 10000; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] || 0; return s; }
  function plural(n, w) { return n + ' ' + (n === 1 ? w : /s$/.test(w) ? w : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'); }

  /* ---------- colour ---------- */
  function rgb(c) {
    c = String(c || '').trim();
    var m = /^#([0-9a-f]{3})$/i.exec(c);
    if (m) c = '#' + m[1].replace(/./g, '$&$&');
    m = /^#([0-9a-f]{6})/i.exec(c);
    return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [0, 0, 0];
  }
  function isHex(c) { return typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()); }
  function hex(a) { return '#' + a.map(function (v) { v = clamp(Math.round(v), 0, 255).toString(16); return v.length < 2 ? '0' + v : v; }).join('').toUpperCase(); }
  function mix(a, b, t) { a = rgb(a); b = rgb(b); return hex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(c) { c = rgb(c); return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /* The same hue pushed towards black or white until it reads on bg. */
  function ensure(fg, bg, ratio) {
    ratio = ratio || 4.5;
    if (contrast(fg, bg) >= ratio) return hex(rgb(fg));
    var to = contrast('#000000', bg) >= contrast('#FFFFFF', bg) ? '#000000' : '#FFFFFF';
    for (var t = 0.06; t <= 1; t += 0.06) { var c = mix(fg, to, t); if (contrast(c, bg) >= ratio) return c; }
    return to;
  }
  function readable(bg, ink, light) {
    if (ink && contrast(ink, bg) >= 4.5) return ink;
    if (light && contrast(light, bg) >= 4.5) return light;
    return contrast('#111111', bg) >= contrast('#FFFFFF', bg) ? '#111111' : '#FFFFFF';
  }
  /* Colour-vision simulation (Machado, Oliveira and Fernandes 2009, full severity) and a perceptual distance (OKLab × 100). */
  var CVD = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
  };
  function simLin(c, kind) {
    var l = rgb(c).map(lin), m = CVD[kind];
    return m ? m.map(function (r) { return clamp(r[0] * l[0] + r[1] * l[1] + r[2] * l[2], 0, 1); }) : l;
  }
  function oklab(l) {
    var a = Math.cbrt(0.4122214708 * l[0] + 0.5363325363 * l[1] + 0.0514459929 * l[2]), b = Math.cbrt(0.2119034982 * l[0] + 0.6806995451 * l[1] + 0.1073969566 * l[2]), c = Math.cbrt(0.0883024619 * l[0] + 0.2817188376 * l[1] + 0.6299787005 * l[2]);
    return [0.2104542553 * a + 0.793617785 * b - 0.0040720468 * c, 1.9779984951 * a - 2.428592205 * b + 0.4505937099 * c, 0.0259040371 * a + 0.7827717662 * b - 0.808675766 * c];
  }
  function distance(c1, c2, kind) { var a = oklab(simLin(c1, kind)), b = oklab(simLin(c2, kind)); return 100 * Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2)); }
  function apart(c, list, min) {
    return list.every(function (q) { return ['', 'protan', 'deutan', 'tritan'].every(function (k) { return distance(c, q, k) >= (k === 'tritan' ? min * 0.7 : min); }); });
  }
  var color = { rgb: rgb, hex: hex, mix: mix, luminance: lum, contrast: contrast, ensure: ensure, readable: readable, simulate: function (c, kind) { return hex(simLin(c, kind).map(function (v) { return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); })); }, distance: distance };

  /* ---------- themes (plain data) ----------
     page: the poster background; card: what the chart sits on; ink/muted: text; grid/axis: rules; accent + neutral: the
     highlight pair (one thing in colour, the rest recede); palette: categorical, told apart with the common colour-vision
     deficiencies (tests/charts.test.js); seq: light → dark ramp; div: low, middle, high; up/down: gains and losses;
     head/body: families from the font library with the weights used; radius: bar corners at 36 px text; cardRadius. */
  var THEMES = [
    { id: 'clean', name: 'Clean', page: '#F4F5F7', card: '#FFFFFF', border: '#E1E5EB', ink: '#1B1F29', muted: '#5B6472', grid: '#E7EAEF', axis: '#98A1B0', accent: '#2563EB', neutral: '#C3C9D4',
      palette: ['#2563EB', '#F0A905', '#1EB579', '#DB2777', '#5F4DB7', '#38BDF8', '#8A4B14', '#1F2937'], seq: ['#E3ECFD', '#1D4FBF'], div: ['#C2410C', '#EEF0F3', '#1D4FBF'], up: '#0F8A5F', down: '#C2410C',
      head: 'Inter', body: 'Inter', hw: 700, vw: 600, radius: 6, cardRadius: 20, panel: '#1B1F29' },
    { id: 'paper', name: 'Paper', page: '#FCF4E6', card: '#FFFDF8', border: '#DDD5C3', ink: '#27272F', muted: '#6B665E', grid: '#ECE5D6', axis: '#A39B8B', accent: '#FF7A00', neutral: '#41414D',
      palette: ['#FF7A00', '#41414D', '#2A7DE1', '#2E7D4F', '#B75797', '#49B8E5', '#CAAA83', '#7A2B9B'], seq: ['#FFE9D0', '#C2540A'], div: ['#2A6FB8', '#F3ECDD', '#D9600A'], up: '#2E7D4F', down: '#C2410C',
      head: 'Lato', body: 'Lexend', hw: 700, vw: 600, radius: 10, cardRadius: 28, panel: '#1F1E1C' },
    { id: 'dark', name: 'Dark', page: '#101217', card: '#1B1D23', border: '#30343D', ink: '#F3F4F6', muted: '#A6ADBA', grid: '#2C3039', axis: '#6B7280', accent: '#6CB6FF', neutral: '#4A505C',
      palette: ['#6CB6FF', '#FFB454', '#5EEAD4', '#EA73B3', '#A77AFD', '#FDE68A', '#FA5A68', '#D1FFEE'], seq: ['#24364D', '#8CC8FF'], div: ['#FFB454', '#30343D', '#6CB6FF'], up: '#5EEAD4', down: '#FFB454',
      head: 'Manrope', body: 'Manrope', hw: 700, vw: 600, radius: 6, cardRadius: 20, panel: '#2A2E37' },
    { id: 'contrast', name: 'High contrast', page: '#FFFFFF', card: '#FFFFFF', border: '#000000', ink: '#000000', muted: '#1F1F1F', grid: '#8A8A8A', axis: '#000000', accent: '#BC0A12', neutral: '#000000',
      palette: ['#000000', '#BC0A12', '#0844E7', '#006744', '#7109AC', '#C77000', '#0D919D', '#655D87'], seq: ['#D9D9D9', '#000000'], div: ['#BC0A12', '#E6E6E6', '#0844E7'], up: '#006744', down: '#BC0A12',
      head: 'Atkinson Hyperlegible', body: 'Atkinson Hyperlegible', hw: 700, vw: 700, radius: 0, cardRadius: 0, panel: '#000000', borderWidth: 2 },
    { id: 'mono', name: 'One accent', page: '#F2F2F0', card: '#FFFFFF', border: '#DEDEDA', ink: '#1F2430', muted: '#5A6170', grid: '#E7E9EE', axis: '#9AA1AF', accent: '#E4572E', neutral: '#C4C8D2',
      palette: ['#E4572E', '#1F2430', '#C4C8D2', '#5A6170', '#E7E9EE', '#3A4050', '#9AA1AF', '#7A8190'], seq: ['#E7E9EE', '#1F2430'], div: ['#E4572E', '#E7E9EE', '#1F2430'], up: '#1F2430', down: '#E4572E',
      head: 'IBM Plex Sans', body: 'IBM Plex Sans', hw: 700, vw: 600, radius: 2, cardRadius: 8, panel: '#1F2430' },
    { id: 'pastel', name: 'Pastel', page: '#FBF7F4', card: '#FFFFFF', border: '#EADFD8', ink: '#3A3340', muted: '#6C6472', grid: '#F0E9E4', axis: '#B3A9B0', accent: '#848FF9', neutral: '#D9D3DA',
      palette: ['#848FF9', '#EEB548', '#84D2B5', '#DB85B5', '#B9A6EE', '#F3E08A', '#B9705C', '#586A84'], seq: ['#ECEEFE', '#5460D9'], div: ['#DB85B5', '#F4EFF2', '#848FF9'], up: '#3F9B7C', down: '#B9705C',
      head: 'Nunito', body: 'Nunito', hw: 800, vw: 700, radius: 12, cardRadius: 32, panel: '#3A3340' },
    { id: 'grey', name: 'Print grey', page: '#FFFFFF', card: '#FFFFFF', border: '#BDBDBD', ink: '#111111', muted: '#555555', grid: '#DCDCDC', axis: '#777777', accent: '#161616', neutral: '#C7C7C7',
      palette: ['#161616', '#A6A6A6', '#4A4A4A', '#C7C7C7', '#2F2F2F', '#868686', '#676767', '#E9E9E9'], seq: ['#E9E9E9', '#161616'], div: ['#161616', '#E9E9E9', '#676767'], up: '#161616', down: '#676767',
      head: 'Source Serif 4', body: 'Source Sans 3', hw: 700, vw: 600, radius: 0, cardRadius: 0, panel: '#161616', outline: true },
    { id: 'vivid', name: 'Bold', page: '#F3EFFF', card: '#FFFFFF', border: '#DCD3FA', ink: '#17112E', muted: '#5A5475', grid: '#ECE8F8', axis: '#A49CC0', accent: '#5B2EFF', neutral: '#CFC9E3',
      palette: ['#5B2EFF', '#FF5F77', '#00B8D9', '#FFAB00', '#00A789', '#C233C0', '#7A3E00', '#111111'], seq: ['#E7E0FF', '#4317D9'], div: ['#FF5F77', '#EEEAF8', '#5B2EFF'], up: '#00856D', down: '#D92F4B',
      head: 'Space Grotesk', body: 'Inter', hw: 700, vw: 600, radius: 8, cardRadius: 24, panel: '#17112E' },
    { id: 'brand', name: 'My brand', brand: true }
  ];
  /* "My brand": colours and fonts from the design's brand block ({ colors: [{ role, value }] | { role: value }, fonts: { heading, body } })
     or the studio Brand kit ({ colors: ['#…'], fonts: ['Family'] }). Without one it is the clean theme under another name. */
  function brandTheme(b) {
    var base = clone(THEMES[0]);
    base.id = 'brand'; base.name = 'My brand';
    if (!isObj(b)) return base;
    var byRole = {}, list = [];
    (Array.isArray(b.colors) ? b.colors : isObj(b.colors) ? Object.keys(b.colors).map(function (k) { return { role: k, value: b.colors[k] }; }) : []).forEach(function (c) {
      var v = typeof c === 'string' ? c : c && c.value, role = c && typeof c.role === 'string' ? c.role : '';
      if (!isHex(v)) return;
      v = hex(rgb(v));
      if (role && !byRole[role]) byRole[role] = v;
      if (list.indexOf(v) < 0) list.push(v);
    });
    var fam = function (f) { f = isObj(f) ? f.family : f; return typeof f === 'string' && /^[\w .'-]{1,60}$/.test(f) ? f : ''; };
    var fonts = Array.isArray(b.fonts) ? { heading: b.fonts[0], body: b.fonts[1] || b.fonts[0] } : (isObj(b.fonts) ? b.fonts : {});
    if (fam(fonts.heading)) base.head = fam(fonts.heading);
    if (fam(fonts.body) || fam(fonts.heading)) base.body = fam(fonts.body) || fam(fonts.heading);
    base.hw = 700; base.vw = 700;
    if (!list.length) return base;
    var card = byRole.surface || byRole.background || '#FFFFFF';
    if (contrast(card, '#FFFFFF') > 1.6 && contrast(card, '#000000') > 1.6) card = '#FFFFFF';   /* a mid-tone is no place for a chart */
    var dark = lum(card) < 0.2;
    base.card = card; base.page = byRole.background && byRole.background !== card ? byRole.background : mix(card, dark ? '#000000' : '#8A8A8A', 0.08);
    base.ink = ensure(byRole.text || (dark ? '#F3F4F6' : '#1B1F29'), card, 7);
    base.muted = ensure(byRole.muted || mix(base.ink, card, 0.35), card, 4.5);
    base.border = mix(card, base.ink, 0.14); base.grid = mix(card, base.ink, 0.1); base.axis = mix(card, base.ink, 0.45); base.neutral = mix(card, base.ink, 0.22);
    var usable = list.filter(function (c) { return contrast(c, card) >= 1.5; });
    base.accent = [byRole.accent, byRole.primary, byRole.secondary].concat(usable).filter(function (c) { return c && contrast(c, card) >= 1.5; })[0] || base.accent;
    var pal = [base.accent];
    usable.concat(dark ? THEMES[2].palette : THEMES[0].palette).forEach(function (c) { if (pal.length < 8 && pal.indexOf(c) < 0 && contrast(c, card) >= 1.3 && apart(c, pal, 7.5)) pal.push(c); });
    for (var t = 0.15; pal.length < 8 && t < 0.9; t += 0.11) { var g = mix(base.ink, card, t); if (apart(g, pal, 7.5)) pal.push(g); }
    base.palette = pal;
    base.seq = [mix(card, base.accent, 0.14), ensure(base.accent, card, 4.5)];
    base.div = [ensure(byRole.danger || pal[1] || base.down, card, 3), mix(card, base.ink, 0.08), ensure(base.accent, card, 3)];
    base.panel = dark ? mix(card, '#FFFFFF', 0.1) : ensure(byRole.primary || base.ink, '#FFFFFF', 7);
    base.up = ensure(byRole.success || (dark ? THEMES[2].up : THEMES[0].up), card, 3); base.down = ensure(byRole.danger || byRole.warning || (dark ? THEMES[2].down : THEMES[0].down), card, 3);
    return base;
  }
  function themeOf(id, ctx) {
    var t = THEMES.filter(function (x) { return x.id === id; })[0] || THEMES[0];
    t = t.brand ? brandTheme(ctx && ctx.brand) : clone(t);
    t.accentInk = ensure(t.accent, t.card, 4.5);
    return t;
  }
  function themes(ctx) { return THEMES.map(function (t) { return themeOf(t.id, ctx); }); }

  /* ---------- numbers and dates ---------- */
  var NUM = /^(\()?\s*([-+−]?)\s*(R\$|[$€£¥₹₩₽₺₫₪฿]|[A-Z]{3}\s|Rs\.?\s?|kr\s)?\s*([-+−]?)\s*(\d[\d,'   ]*(?:\.\d+)?|\.\d+)(?:[eE]([-+]?\d{1,3}))?\s*(%|‰|[A-Za-zµ°$€£¥₹\/²³][A-Za-zµ°\/²³ ]{0,15})?\s*(\))?$/;
  var MULT = { k: 1e3, K: 1e3, M: 1e6, B: 1e9, bn: 1e9, T: 1e12 };
  /* A cell → { v, pre, suf, dec } or null. Text is never evaluated: "=1+1" is not a number. */
  function numberOf(s) {
    if (typeof s === 'number') return isFinite(s) ? { v: s, pre: '', suf: '', dec: (String(s).split('.')[1] || '').length } : null;
    s = String(s == null ? '' : s).trim();
    if (!s || s.length > 40) return null;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');           /* 1.234,56 */
    else if (/^[^,.]*\d,\d{1,2}(?!\d)[^,.\d]*$/.test(s) && !/^\D*\d{1,3},\d{3}/.test(s)) s = s.replace(',', '.');   /* 12,5 */
    var m = NUM.exec(s);
    if (!m || (m[1] && !m[8]) || (m[2] && m[4])) return null;
    var body = m[5].replace(/[,'   ]/g, ''), v = Number(body + (m[6] ? 'e' + m[6] : ''));
    if (!isFinite(v)) return null;
    var suf = (m[7] || '').trim(), pre = (m[3] || '').trim();
    if (MULT[suf]) { v *= MULT[suf]; suf = ''; }
    if (m[1] || m[2] === '-' || m[2] === MINUS || m[4] === '-' || m[4] === MINUS) v = -v;
    if (!isFinite(v)) return null;
    return { v: v, pre: pre, suf: suf, dec: (body.split('.')[1] || '').length };
  }
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthOf(w) { w = String(w || '').toLowerCase().replace(/\.$/, ''); if (w.length < 3) return -1; for (var i = 0; i < 12; i++) if (MONTHS[i] === w || (w.length <= 4 && MONTHS[i].indexOf(w) === 0)) return i; return -1; }
  function utc(y, m, d) { if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1000 || y > 2999) return null; var t = Date.UTC(y, m, d); return new Date(t).getUTCDate() === d ? t : null; }
  /* A cell → { t (ms, UTC), g: year | quarter | month | day | name } or null. "name" is a bare month or weekday (ordered, no year). */
  function dateOf(s) {
    s = String(s == null ? '' : s).trim();
    if (!s || s.length > 32) return null;
    var m, t;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.]+(?:Z|[+-]\d\d:?\d\d)?)?$/.exec(s) || /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s))) { t = utc(+m[1], +m[2] - 1, +m[3]); return t == null ? null : { t: t, g: 'day' }; }
    if ((m = /^(\d{4})[-\/](\d{1,2})$/.exec(s))) { t = utc(+m[1], +m[2] - 1, 1); return t == null ? null : { t: t, g: 'month' }; }
    if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(s))) { var a = +m[1], b = +m[2]; t = a > 12 ? utc(+m[3], b - 1, a) : utc(+m[3], a - 1, b); return t == null ? null : { t: t, g: 'day' }; }
    if ((m = /^(?:Q([1-4])\s*[-\/ ]?\s*(\d{4})|(\d{4})\s*[-\/ ]?\s*Q([1-4]))$/i.exec(s))) { t = utc(+(m[2] || m[3]), (+(m[1] || m[4]) - 1) * 3, 1); return t == null ? null : { t: t, g: 'quarter' }; }
    if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s)) && monthOf(m[2]) >= 0) { t = utc(+m[3], monthOf(m[2]), +m[1]); return t == null ? null : { t: t, g: 'day' }; }
    if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)) && monthOf(m[1]) >= 0) { t = utc(+m[3], monthOf(m[1]), +m[2]); return t == null ? null : { t: t, g: 'day' }; }
    if ((m = /^([A-Za-z]{3,9})\.?[\s-]+'?(\d{4}|\d{2})$/.exec(s)) && monthOf(m[1]) >= 0) { t = utc(m[2].length === 2 ? 2000 + +m[2] : +m[2], monthOf(m[1]), 1); return t == null ? null : { t: t, g: 'month' }; }
    if (/^[A-Za-z]{3,9}\.?$/.test(s)) {
      if (monthOf(s) >= 0) return { t: Date.UTC(2000, monthOf(s), 1), g: 'name' };
      var d = s.toLowerCase().replace(/\.$/, ''), di = -1;
      DAYS.forEach(function (n, i) { if (n === d || (d.length === 3 && n.indexOf(d) === 0)) di = i; });
      if (di >= 0) return { t: Date.UTC(2001, 0, 1 + di), g: 'name' };   /* 1 January 2001 was a Monday */
    }
    if (/^\d{4}$/.test(s) && +s >= 1000 && +s <= 2999) return { t: Date.UTC(+s, 0, 1), g: 'year' };
    return null;
  }
  function group3(s) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return p.join('.'); }
  /* f: { pre, suf, dec }. compact: 1,200 → 1.2K. */
  function format(v, f, compact) {
    f = f || {};
    if (v == null || !isFinite(v)) return DASH;
    var a = Math.abs(v), s, unit = '';
    if (a >= 1e15) s = a.toExponential(1).replace('e+', 'e');
    else if (compact && a >= 1000) {
      var u = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
      s = String(parseFloat((a / u[0]).toFixed(a / u[0] < 100 ? 1 : 0))); unit = u[1];
    } else {
      var d = f.dec != null ? f.dec : (a === Math.round(a) || a >= 1000 ? 0 : a >= 10 ? 1 : 2);
      s = group3(a.toFixed(clamp(d, 0, 6)));
      if (f.trim && s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    }
    var suf = f.suf || '';
    return (v < 0 && Number(s.replace(/,/g, '')) !== 0 ? MINUS : '') + (f.pre || '') + s + unit + (suf && /^[A-Za-zµ]/.test(suf) && suf.length > 1 ? ' ' : '') + suf;
  }
  function niceStep(raw) {
    if (!(raw > 0) || !isFinite(raw)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  /* "Nice" axis ticks covering [min, max]: { min, max, step, ticks }. */
  function ticks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min > max) { var s0 = min; min = max; max = s0; }
    if (min === max) { if (min === 0) max = 1; else if (min > 0) min = 0; else max = 0; }
    count = clamp(Math.round(count || 5), 1, 12);
    var step = niceStep((max - min) / count), lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step, out = [];
    for (var i = 0; i <= 200; i++) { var v = lo + i * step; if (v > hi + step * 1e-6) break; out.push(Math.abs(v) < step * 1e-9 ? 0 : parseFloat(v.toPrecision(12))); }
    return { min: lo, max: hi, step: step, ticks: out };
  }
  function logTicks(min, max) {
    var lo = Math.floor(Math.log10(Math.max(min, 1e-12))), hi = Math.ceil(Math.log10(Math.max(max, min * 10, 1e-11))), out = [];
    for (var e = lo; e <= hi; e++) out.push(Math.pow(10, e));
    return { min: out[0], max: out[out.length - 1], ticks: out };
  }
  var scale = {
    linear: function (d0, d1, p0, p1) { var k = d1 === d0 ? 0 : (p1 - p0) / (d1 - d0); return function (v) { return p0 + (v - d0) * k; }; },
    log: function (d0, d1, p0, p1) { var a = Math.log10(Math.max(d0, 1e-12)), b = Math.log10(Math.max(d1, 1e-12)), k = b === a ? 0 : (p1 - p0) / (b - a); return function (v) { return p0 + (Math.log10(Math.max(v, 1e-12)) - a) * k; }; },
    time: function (t0, t1, p0, p1) { return scale.linear(t0, t1, p0, p1); },
    band: function (n, p0, p1, pad) { var step = (p1 - p0) / Math.max(1, n), w = step * (1 - (pad == null ? 0.2 : pad)); return { step: step, width: w, at: function (i) { return p0 + step * i + (step - w) / 2; }, mid: function (i) { return p0 + step * (i + 0.5); } }; }
  };

  /* ---------- the chart model ---------- */
  function text(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, n); }
  function plainOf(v, d) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return text(v, 300);
    if (!v || typeof v !== 'object' || d > 3) return null;
    if (Array.isArray(v)) return v.slice(0, 60).map(function (x) { return plainOf(x, d + 1); });
    var o = {};
    Object.keys(v).slice(0, 40).forEach(function (k) { if (/^[a-zA-Z][\w-]{0,31}$/.test(k) && k !== 'constructor' && k !== 'prototype') o[k] = plainOf(v[k], d + 1); });
    return o;
  }
  /* The same shape check LE.Scene.chartOf applies (le-objects.js): plain data, 5,000 cells, no functions, no markup run. */
  function sanitize(c) {
    if (!isObj(c) || typeof c.type !== 'string' || !/^[a-z][a-z0-9-]{1,23}$/.test(c.type)) return null;
    var d = isObj(c.data) ? c.data : {}, cells = 0, rows = [];
    var cols = (Array.isArray(d.columns) ? d.columns : []).slice(0, CAP.cols).map(function (v) { return text(v, 80); });
    (Array.isArray(d.rows) ? d.rows : []).some(function (r) {
      if (!Array.isArray(r)) return false;
      r = r.slice(0, cols.length || CAP.cols).map(function (v) { return typeof v === 'number' ? (isFinite(v) ? v : '') : text(v, 200); });
      cells += Math.max(1, r.length);
      if (cells > CAP.cells) return true;
      rows.push(r);
      return false;
    });
    return { v: 1, type: c.type, data: { columns: cols, rows: rows }, map: plainOf(isObj(c.map) ? c.map : {}, 0) || {}, theme: typeof c.theme === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(c.theme) ? c.theme : 'clean', options: plainOf(isObj(c.options) ? c.options : {}, 0) || {} };
  }

  function cell(v) { return v == null ? '' : String(v).trim(); }
  /* What each column holds: { name, kind: number | percent | currency | date | category | text | empty, pre, suf, dec, n, distinct, bad: [row], min, max, grain } */
  function analyse(data) {
    var rows = data && data.rows || [];
    return (data && data.columns || []).map(function (name, c) {
      var n = 0, nums = 0, dates = 0, years = 0, pre = {}, suf = {}, dec = 0, notNum = [], notDate = [], seen = {}, distinct = 0, min = Infinity, max = -Infinity, len = 0, grain = {}, up = true, last = -Infinity;
      rows.forEach(function (r, i) {
        var s = cell(r[c]);
        if (s === '') return;
        n++; len += s.length;
        if (!seen[s]) { seen[s] = 1; distinct++; }
        var d = numberOf(r[c]);
        if (d) {
          nums++; pre[d.pre] = (pre[d.pre] || 0) + 1; suf[d.suf] = (suf[d.suf] || 0) + 1; dec = Math.max(dec, d.dec);
          if (d.v < min) min = d.v; if (d.v > max) max = d.v;
          if (d.v === Math.round(d.v) && d.v >= 1800 && d.v <= 2100 && !d.pre && !d.suf && /^\d{4}$/.test(s)) years++;
          if (d.v <= last) up = false; last = d.v;
        } else notNum.push(i);
        var t = dateOf(s);
        if (t) { dates++; grain[t.g] = (grain[t.g] || 0) + 1; } else notDate.push(i);
      });
      var top = function (o) { var b = '', bn = 0; Object.keys(o).forEach(function (k) { if (o[k] > bn) { bn = o[k]; b = k; } }); return bn >= nums * 0.6 ? b : ''; };
      var yearCol = n >= 2 && years === n && (/year|yr|date|season|vintage/i.test(name) || (up && c === 0));
      var kind = !n ? 'empty' : yearCol ? 'date' : nums / n >= 0.8 ? 'number' : dates / n >= 0.8 ? 'date' : (distinct === n && len / n > 48 ? 'text' : 'category');
      var p = top(pre), sf = top(suf);
      if (kind === 'number') kind = sf === '%' ? 'percent' : p ? 'currency' : 'number';
      var numeric = kind === 'number' || kind === 'percent' || kind === 'currency';
      return { name: name, kind: kind, numeric: numeric, pre: numeric ? p : '', suf: numeric ? sf : '', dec: Math.min(dec, 4), n: n, distinct: distinct, bad: numeric ? notNum : kind === 'date' ? notDate : [], min: nums ? min : 0, max: nums ? max : 0,
        grain: Object.keys(grain).sort(function (a, b) { return grain[b] - grain[a]; })[0] || '' };
    });
  }
  function colIndex(data, v) {
    if (typeof v === 'number') return v >= 0 && v < data.columns.length && v === Math.floor(v) ? v : -1;
    if (typeof v !== 'string') return -1;
    var k = v.trim().toLowerCase();
    for (var i = 0; i < data.columns.length; i++) if (String(data.columns[i]).trim().toLowerCase() === k) return i;
    return -1;
  }
  var TARGET = /^(target|goal|budget|plan|planned|quota|benchmark|forecast|max|maximum|limit|out of|capacity)\b/i;
  /* The mapping a chart uses when none is given: the first date or category column names the rows, number columns are the series. */
  function autoMap(data, type, A) {
    A = A || analyse(data);
    var numeric = [], cats = [];
    A.forEach(function (a, i) { if (a.numeric) numeric.push(i); else if (a.kind === 'date' || a.kind === 'category' || a.kind === 'text') cats.push(i); });
    var cat = cats.length ? cats[0] : -1, m = { category: cat };
    if (type === 'scatter' || type === 'bubble') { m.x = numeric[0] == null ? -1 : numeric[0]; m.y = numeric[1] == null ? -1 : numeric[1]; if (type === 'bubble' && numeric[2] != null) m.size = numeric[2]; return m; }
    if (type === 'bullet' || type === 'gauge') {
      var tg = numeric.filter(function (i) { return TARGET.test(A[i].name); })[0];
      if (tg == null && type === 'bullet') tg = numeric[1];
      m.series = numeric.filter(function (i) { return i !== tg; }).slice(0, 1);
      if (tg != null) m.target = tg;
      return m;
    }
    m.series = numeric.slice(0, type === 'histogram' || type === 'pie' || type === 'donut' || type === 'funnel' || type === 'treemap' || type === 'waterfall' || type === 'pictogram' || type === 'lollipop' ? 1 : type === 'stat' ? 2 : CAP.series * 2);
    return m;
  }
  function fmtOf(a, o, extraDec) {
    var f = a ? { pre: a.pre, suf: a.suf, dec: a.dec ? Math.min(a.dec, 2) : (extraDec ? null : 0), trim: !a.pre } : { pre: '', suf: '', dec: null };
    if (o) {
      if (typeof o.prefix === 'string') f.pre = text(o.prefix, 6);
      if (typeof o.unit === 'string') f.suf = text(o.unit, 16).trim();
      if (typeof o.decimals === 'number') { f.dec = clamp(Math.round(o.decimals), 0, 6); f.trim = false; }
    }
    return f;
  }
  var AGG = {
    sum: function (a) { return a.length ? sum(a) : null; }, mean: function (a) { return a.length ? sum(a) / a.length : null; }, count: function (a) { return a.length; },
    min: function (a) { return a.length ? Math.min.apply(null, a) : null; }, max: function (a) { return a.length ? Math.max.apply(null, a) : null; }
  };
  /* Data → what a renderer draws: { cats, series: [{ name, values, f }], times, catKind, notes, A, map, f }.
     Steps, in order: leave out excluded rows, pivot a long table (map.group), aggregate repeated categories, swap rows and
     columns, sort, keep the top N and fold the rest into "Other". */
  function prepare(chart) {
    var data = chart.data, o = chart.options || {}, A = analyse(data), notes = [];
    var auto = autoMap(data, chart.type, A), map = {}, src = chart.map || {};
    ['category', 'group', 'x', 'y', 'size', 'target', 'label'].forEach(function (k) { var i = src[k] == null ? (auto[k] == null ? -1 : auto[k]) : colIndex(data, src[k]); map[k] = i; });
    map.series = Array.isArray(src.series) && src.series.length ? src.series.map(function (s) { return colIndex(data, s); }).filter(function (i, k, a) { return i >= 0 && a.indexOf(i) === k; }) : (auto.series || []);
    map.series = map.series.filter(function (i) { return i !== map.category && i !== map.group; });
    var excl = {};
    (Array.isArray(o.exclude) ? o.exclude : []).forEach(function (x) { excl[String(x)] = 1; });
    var rows = data.rows.filter(function (r) { return !(map.category >= 0 && excl[cell(r[map.category])]) && r.some(function (v) { return cell(v) !== ''; }); });
    var bad = 0, names = map.series.map(function (i) { return data.columns[i]; }), cols = map.series.slice();
    function val(r, c) { var s = cell(r[c]); if (s === '') return null; var d = numberOf(r[c]); if (!d) { bad++; return null; } return d.v; }
    var recs = rows.map(function (r, i) { return { cat: map.category >= 0 ? (cell(r[map.category]) || '(blank)') : String(i + 1), v: cols.map(function (c) { return val(r, c); }), r: r }; });
    /* long → wide */
    if (map.group >= 0 && cols.length) {
      var gs = [], gi = {};
      rows.forEach(function (r) { var g = cell(r[map.group]) || '(blank)'; if (gi[g] == null && gs.length < CAP.series * 2) { gi[g] = gs.length; gs.push(g); } });
      recs = recs.map(function (rec) { var g = gi[cell(rec.r[map.group]) || '(blank)'], v = gs.map(function () { return null; }); if (g != null) v[g] = rec.v[0]; return { cat: rec.cat, v: v, r: rec.r }; });
      names = gs;
    }
    var counting = !names.length;
    if (counting) { names = ['Count']; recs.forEach(function (rec) { rec.v = [1]; }); }
    /* aggregate */
    var order = [], by = {}, dupes = false;
    recs.forEach(function (rec) { if (!by[rec.cat]) { by[rec.cat] = []; order.push(rec.cat); } else dupes = true; by[rec.cat].push(rec); });
    var how = AGG[o.aggregate] ? o.aggregate : null;
    var cats = order, values;
    if (dupes || counting || map.group >= 0 || how === 'count') {
      how = counting ? 'sum' : (how || 'sum');
      values = names.map(function (nm, s) { return order.map(function (c) { return AGG[how](by[c].map(function (rec) { return rec.v[s]; }).filter(function (v) { return v != null; })); }); });
      if (dupes && !counting && map.group < 0) notes.push('Rows with the same ' + (data.columns[map.category] || 'label') + ' are ' + (how === 'mean' ? 'averaged' : how === 'count' ? 'counted' : how === 'sum' ? 'added up' : 'combined (' + how + ')') + '.');
    } else values = names.map(function (nm, s) { return recs.map(function (rec) { return rec.v[s]; }); });
    var ca = map.category >= 0 ? A[map.category] : null, catKind = ca && ca.kind === 'date' ? 'date' : 'category';
    var times = catKind === 'date' ? cats.map(function (c) { var d = dateOf(c); return d ? d.t : null; }) : null;
    if (times && (times.some(function (t) { return t == null; }) || ca.grain === 'name')) times = null;
    if (o.swap && names.length && cats.length) {
      var nv = cats.map(function (c, i) { return names.map(function (nm, s) { return values[s][i]; }); }), nn = cats;
      cats = names; names = nn; values = nv; times = null; catKind = 'category';
    }
    if (names.length > CAP.series) { notes.push('Only the first ' + CAP.series + ' of ' + names.length + ' series are drawn.'); names = names.slice(0, CAP.series); values = values.slice(0, CAP.series); }
    function total(i) { var t = 0; values.forEach(function (v) { t += Math.abs(v[i] || 0); }); return t; }
    var idx = cats.map(function (c, i) { return i; });
    var sort = o.sort === 'asc' || o.sort === 'desc' ? o.sort : null;
    if (sort) idx.sort(function (a, b) { return (sort === 'asc' ? 1 : -1) * (total(a) - total(b)) || a - b; });
    var topN = typeof o.top === 'number' && o.top >= 1 ? Math.round(o.top) : 0, other = null;
    if (topN && idx.length > topN + 1) {
      var ranked = idx.slice().sort(function (a, b) { return total(b) - total(a) || a - b; }), keep = {};
      ranked.slice(0, topN).forEach(function (i) { keep[i] = 1; });
      var rest = idx.filter(function (i) { return !keep[i]; });
      other = values.map(function (v) { var a = rest.map(function (i) { return v[i]; }).filter(function (x) { return x != null; }); return a.length ? sum(a) : null; });
      idx = idx.filter(function (i) { return keep[i]; });
      notes.push(plural(rest.length, 'smaller row') + (rest.length === 1 ? ' is' : ' are') + ' added together as "Other".');
    }
    cats = idx.map(function (i) { return cats[i]; });
    if (times) times = idx.map(function (i) { return times[i]; });
    values = values.map(function (v, s) { var out = idx.map(function (i) { return v[i]; }); if (other) out.push(other[s]); return out; });
    if (other) { cats.push('Other'); if (times) times = null; }
    if (bad) notes.push(plural(bad, 'cell') + (bad === 1 ? ' is' : ' are') + ' not a number and ' + (bad === 1 ? 'was' : 'were') + ' left out.');
    var series = names.map(function (nm, s) {
      var a = map.group >= 0 || counting || (o.swap && cats.length) ? (counting ? null : A[cols[0]]) : A[cols[s]];
      return { name: String(nm), values: values[s], f: fmtOf(a, o, how === 'mean'), col: cols[s] };
    });
    return { cats: cats, series: series, times: times, catKind: catKind, notes: notes, A: A, map: map, rows: rows, f: series[0] ? series[0].f : fmtOf(null, o), other: !!other, counting: counting };
  }

  /* ---------- layers ----------
     The builder makes ordinary LE.Scene layers in page pixels, measures text, and keeps every placed label's box so later
     labels can step aside (opt: true drops a label that would touch another). */
  function Builder(T, ctx, id) {
    var L = [], boxes = [], info = { texts: [], bars: [] }, memo = {}, n = 0, cv = null;
    var custom = ctx && typeof ctx.measure === 'function' ? ctx.measure : null;
    try { cv = !custom && root.document ? root.document.createElement('canvas').getContext('2d') : null; } catch (e) { cv = null; }
    function fam(name) { try { if (LE.fonts && LE.fonts.css) return LE.fonts.css(name) || 'sans-serif'; } catch (e) { /* plain name */ } return '"' + String(name).replace(/"/g, '') + '", sans-serif'; }
    function guess(str, weight) {
      var w = 0;
      for (var i = 0; i < str.length; i++) { var ch = str.charAt(i); w += /[iljtfr.,:;'|! ]/.test(ch) ? 32 : /[MW@mw%]/.test(ch) ? 88 : /[A-Z0-9]/.test(ch) ? 64 : 56; }
      return w * (weight >= 600 ? 1.06 : 1);
    }
    function width(str, font, weight, size, spacing) {
      var key = font + '|' + weight + '|' + str, w = memo[key];
      if (w == null) {
        if (custom) w = custom(str, font, weight, 100);
        else if (cv) { cv.font = 'normal ' + weight + ' 100px ' + fam(font); w = cv.measureText(str).width; }
        else w = guess(str, weight);
        memo[key] = w;
      }
      return w * size / 100 + (spacing ? spacing * Math.max(0, str.length - 1) : 0);
    }
    function style(o) { var r = o.role || 'body', head = r === 'title' || r === 'label'; return { font: o.font || (head ? T.head : T.body), weight: o.weight || (head ? T.hw : r === 'value' ? T.vw : 400) }; }
    /* Every layer leaves here complete (the fields LE.Scene gives a layer), so a document can take it as it is. */
    function push(l) {
      n++;
      var full = { id: (id || 'c') + '.' + n, type: l.type, name: l.name, x: l.x, y: l.y, w: l.w, h: l.h, rotation: 0, opacity: 1, blend: 'source-over', visible: true, locked: false, flipX: false, flipY: false, shadow: null, groupId: id || null };
      Object.assign(full, l.type === 'text' ? { italic: false, fill: null, uppercase: false, underline: false, strike: false, stroke: null, background: null, curve: 0 } : { params: {}, radius: 0, stroke: null }, l);
      L.push(full);
      return full;
    }
    function hits(b, gap) {
      for (var i = 0; i < boxes.length; i++) { var q = boxes[i]; if (b.x0 < q.x1 + gap && b.x1 > q.x0 - gap && b.y0 < q.y1 + gap && b.y1 > q.y0 - gap) return true; }
      return false;
    }
    var G = {
      layers: L, info: info, bg: T.card,
      width: function (str, o) { o = o || {}; var st = style(o), s = String(str == null ? '' : str); return width(o.upper ? s.toUpperCase() : s, st.font, st.weight, o.size || 16, o.track ? o.track * (o.size || 16) : 0); },
      rect: function (x, y, w, h, fill, o) {
        o = o || {};
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        var r = Math.min(o.r || 0, w / 2, h / 2);
        var l = { type: 'shape', name: o.name || 'Bar', shape: r > 0.5 ? 'rounded-rect' : 'rect', x: r2(x), y: r2(y), w: Math.max(0.01, r2(w)), h: Math.max(0.01, r2(h)), fill: fill ? { type: 'solid', color: fill } : { type: 'none' } };
        if (r > 0.5) { l.params = { radius: r2(r) }; l.radius = r2(r); }
        if (o.stroke) l.stroke = { width: r2(o.sw || 1), color: o.stroke, dash: o.dash || null, cap: 'butt', join: 'miter' };
        else if (fill && T.outline && !o.flat && contrast(fill, G.bg) < 1.35) l.stroke = { width: 1, color: T.axis, dash: null, cap: 'butt', join: 'miter' };
        if (o.opacity != null) l.opacity = o.opacity;
        return push(l);
      },
      dot: function (cx, cy, r, fill, o) {
        o = o || {};
        var l = { type: 'shape', name: o.name || 'Point', shape: 'ellipse', x: r2(cx - r), y: r2(cy - r), w: r2(r * 2), h: r2(r * 2), fill: fill ? { type: 'solid', color: fill } : { type: 'none' } };
        if (o.stroke) l.stroke = { width: r2(o.sw || 1), color: o.stroke, dash: null, cap: 'butt', join: 'miter' };
        if (o.opacity != null) l.opacity = o.opacity;
        return push(l);
      },
      /* A polygon (fill) or an open line (stroke) through points in page pixels: one "polyline" shape with unit points. */
      poly: function (pts, o) {
        o = o || {};
        if (pts.length > CAP.poly) { var st = pts.length / CAP.poly, keep = []; for (var q = 0; q < CAP.poly - 1; q++) keep.push(pts[Math.floor(q * st)]); keep.push(pts[pts.length - 1]); pts = keep; }
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        pts.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
        var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
        var l = { type: 'shape', name: o.name || 'Line', shape: 'polyline', x: r2(x0), y: r2(y0), w: r2(w), h: r2(h),
          params: { points: pts.map(function (p) { return [r4(clamp((p[0] - x0) / w, 0, 1)), r4(clamp((p[1] - y0) / h, 0, 1))]; }) }, fill: o.fill ? { type: 'solid', color: o.fill } : { type: 'none' } };
        if (o.stroke) l.stroke = { width: r2(o.sw || 2), color: o.stroke, dash: o.dash || null, cap: o.cap || 'round', join: 'round' };
        if (o.opacity != null) l.opacity = o.opacity;
        return push(l);
      },
      line: function (x1, y1, x2, y2, col, w, o) {
        o = o || {};
        w = Math.max(1, w || 1);
        if (!o.dash && (x1 === x2 || y1 === y2)) return x1 === x2 ? G.rect(x1 - w / 2, Math.min(y1, y2), w, Math.abs(y2 - y1), col, { name: o.name || 'Rule' }) : G.rect(Math.min(x1, x2), y1 - w / 2, Math.abs(x2 - x1), w, col, { name: o.name || 'Rule' });
        return G.poly([[x1, y1], [x2, y2]], { stroke: col, sw: w, dash: o.dash, cap: o.cap || 'butt', name: o.name || 'Rule' });
      },
      /* A ring segment or pie slice as a polygon. Angles in radians, clockwise from 12 o'clock. */
      wedge: function (cx, cy, r0, r1, a0, a1, fill, o) {
        var steps = clamp(Math.ceil((a1 - a0) / (Math.PI / 60)), 2, r0 > 0 ? 100 : 200), pts = [], i, a;
        for (i = 0; i <= steps; i++) { a = a0 + (a1 - a0) * i / steps - Math.PI / 2; pts.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]); }
        if (r0 > 0) for (i = steps; i >= 0; i--) { a = a0 + (a1 - a0) * i / steps - Math.PI / 2; pts.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]); }
        else pts.push([cx, cy]);
        pts.push(pts[0]);
        return G.poly(pts, Object.assign({ fill: fill, name: 'Slice' }, o || {}));
      },
      icon: function (shape, x, y, s, fill, name) { return push({ type: 'shape', name: name || 'Icon', shape: shape, x: r2(x), y: r2(y), w: r2(s), h: r2(s), fill: { type: 'solid', color: fill } }); },
      /* Text at an anchor. align: which side of the text x is; base: top | middle | bottom; max + lines: wrap, then shorten with …;
         on: the colour behind it (the text colour is pushed until it reads, 4.5:1); opt: leave it out if it would touch another label. */
      text: function (str, x, y, o) {
        o = o || {};
        str = String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
        if (!str) return null;
        if (o.upper) str = str.toUpperCase();
        var st = style(o), size = Math.max(4, o.size || 16), sp = o.track ? o.track * size : 0, lh = o.lh || 1.2;
        var W = function (s) { return width(s, st.font, st.weight, size, sp); };
        var cut = function (s, max) {
          if (W(s) <= max + 0.05) return s;
          var lo = 0, hi = s.length;
          while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (W(s.slice(0, mid).replace(/\s+$/, '') + DOTS) <= max) lo = mid; else hi = mid - 1; }
          return lo ? s.slice(0, lo).replace(/\s+$/, '') + DOTS : DOTS;
        };
        var lines = [str];
        if (o.max > 0 && W(str) > o.max + 0.05) {
          if (o.lines > 1) {
            var cur = '';
            lines = [];
            str.split(' ').forEach(function (word) { var t = cur ? cur + ' ' + word : word; if (!cur || W(t) <= o.max) cur = t; else { lines.push(cur); cur = word; } });
            lines.push(cur);
            if (lines.length > o.lines) lines = lines.slice(0, o.lines - 1).concat([lines.slice(o.lines - 1).join(' ')]);
          }
          lines = lines.map(function (s) { return cut(s, o.max); });
        }
        var ink = Math.max.apply(null, lines.map(W)), h = lines.length * size * lh, wl = Math.ceil(ink * 1.03 + size * 0.5);
        var al = o.align === 'center' || o.align === 'right' ? o.align : 'left';
        var lx = al === 'center' ? x - wl / 2 : al === 'right' ? x - wl : x, ly = o.base === 'middle' ? y - h / 2 : o.base === 'bottom' ? y - h : y;
        var ix = al === 'center' ? x - ink / 2 : al === 'right' ? x - ink : x, box, rot = o.rot || 0;
        if (rot) {
          var a = rot * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), sgn = al === 'right' ? -1 : al === 'left' ? 1 : 0;
          lx = x + sgn * dx * wl / 2 - wl / 2; ly = y + sgn * dy * wl / 2 - h / 2;
          var ex = x + sgn * dx * ink, ey = y + sgn * dy * ink;
          if (!sgn) { ex = x + dx * ink / 2; ey = y + dy * ink / 2; x -= dx * ink / 2; y -= dy * ink / 2; }
          box = { x0: Math.min(x, ex) - size * 0.3, x1: Math.max(x, ex) + size * 0.3, y0: Math.min(y, ey) - size * 0.45, y1: Math.max(y, ey) + size * 0.45, rot: rot };
        } else box = { x0: ix, x1: ix + ink, y0: ly + size * (lh - 1) / 2 + size * 0.06, y1: ly + h - size * (lh - 1) / 2 - size * 0.06 };
        if (o.opt && hits(box, o.gap == null ? size * 0.2 : o.gap)) return null;
        if (!o.free) boxes.push(box);
        var on = o.on || G.bg;
        var l = { type: 'text', name: o.name || 'Label', text: lines.join('\n'), x: r2(lx), y: r2(ly), w: wl, h: r2(h), font: st.font, weight: st.weight, size: r2(size), color: ensure(o.color || T.ink, on, 4.5), align: al, lineHeight: lh, letterSpacing: r2(sp) };
        if (o.upper) l.uppercase = true;
        if (rot) l.rotation = rot;
        l = push(l);
        info.texts.push({ i: L.length - 1, on: on, box: box });
        box.w = ink; box.h = h; box.top = ly; box.bottom = ly + h; box.count = lines.length; box.layer = l;
        return box;
      },
      reserve: function (b) { boxes.push(b); },
      free: function (b, gap) { return !hits(b, gap || 0); }
    };
    return G;
  }

  /* Card, title, subtitle, note and source line; answers with the rectangle left for the marks. */
  function frame(G, box, o, T, S, k) {
    var x = box.x, y = box.y, w = box.w, h = box.h;
    if (o.card !== false) {
      var bw = (T.borderWidth || 1.5) * Math.max(0.6, k);
      G.rect(x + bw / 2, y + bw / 2, w - bw, h - bw, T.card, { r: T.cardRadius * k, stroke: T.border, sw: bw, name: 'Chart card' });
      var pad = Math.max(S * 0.9, Math.min(w, h) * 0.045);
      x += pad; y += pad * 0.9; w -= pad * 2; h -= pad * 1.8;
    }
    var bottom = y + h, t;
    if (o.title) { t = G.text(o.title, x, y, { role: 'title', size: S * 1.25, max: w, lines: 2, lh: 1.15, name: 'Chart title' }); y = t.bottom + S * 0.15; }
    if (o.subtitle) { t = G.text(o.subtitle, x, y, { size: S * 0.82, color: T.muted, max: w, lines: 2, name: 'Chart subtitle' }); y = t.bottom + S * 0.15; }
    if (o.title || o.subtitle) y += S * 0.45;
    if (o.source) { t = G.text(o.source, x, bottom, { size: Math.max(8, S * 0.6), color: T.muted, max: w, lines: 2, base: 'bottom', name: 'Source' }); bottom = t.top - S * 0.2; }
    if (o.note) { t = G.text(o.note, x, bottom, { size: Math.max(9, S * 0.7), color: T.muted, max: w, lines: 3, base: 'bottom', name: 'Note' }); bottom = t.top - S * 0.2; }
    if (o.source || o.note) bottom -= S * 0.3;
    return { x: x, y: y, w: Math.max(10, w), h: Math.max(10, bottom - y) };
  }
  function legend(G, items, x, y, w, S, T) {
    var size = S * 0.78, sw = size * 0.78, rowH = size * 1.65, cx = x, cy = y;
    items.forEach(function (it) {
      var tw = Math.min(G.width(it.name, { size: size }), w - sw - size);
      var need = sw + size * 0.45 + tw;
      if (cx > x && cx + need > x + w) { cx = x; cy += rowH; }
      if (it.line) G.rect(cx, cy + rowH / 2 - Math.max(1.5, size * 0.09), sw, Math.max(3, size * 0.18), it.color, { name: 'Legend key' });
      else G.rect(cx, cy + (rowH - sw) / 2, sw, sw, it.color, { r: T.radius ? sw * 0.25 : 0, name: 'Legend key' });
      G.text(it.name, cx + sw + size * 0.45, cy + rowH / 2, { size: size, base: 'middle', max: w - sw - size, name: 'Legend' });
      cx += need + size * 1.2;
    });
    return cy + rowH - y + S * 0.35;
  }
  function highlightOf(o) {
    var h = o.highlight, list = Array.isArray(h) ? h : h == null || h === '' || h === false ? [] : [h], set = {};
    list.forEach(function (x) { set[String(x).trim().toLowerCase()] = 1; });
    return { any: list.length > 0, has: function (name) { return set[String(name).trim().toLowerCase()] === 1; } };
  }
  function cycle(T, i) { var p = T.palette, c = p[i % p.length], lap = Math.floor(i / p.length); return lap ? mix(c, T.card, Math.min(0.6, 0.3 * lap)) : c; }
  /* One colour per series, or (hl on a category) per category: the highlighted one in the accent, the rest receding. */
  function colorsFor(names, T, o, single) {
    var hl = highlightOf(o), hit = hl.any && names.some(function (n) { return hl.has(n); }), k = 0;
    return names.map(function (n, i) {
      if (hit) return hl.has(n) ? T.accent : (single ? T.neutral : mix(T.neutral, T.card, [0, 0.35, 0.6, 0.2, 0.5][k++ % 5]));
      return single ? T.palette[0] : cycle(T, i);
    });
  }
  function tickFormat(tk, f) {
    var big = Math.max(Math.abs(tk.min), Math.abs(tk.max)) >= 10000, step = tk.step || 1;
    var dec = step >= 1 ? 0 : clamp(Math.ceil(-Math.log10(step) - 1e-9), 1, 6);
    if (step === 2.5 || (step < 1 && String(step).indexOf('25') >= 0)) dec += step >= 1 ? 1 : 0;
    /* a one-character unit (%) rides on every tick; a word ("feet") only on the top one */
    var ff = { pre: f.pre, suf: f.suf && f.suf.length <= 1 ? f.suf : '', dec: dec }, top = { pre: f.pre, suf: f.suf || '', dec: dec };
    return function (v) { var d = dec; while (d > 0 && parseFloat(v.toFixed(d - 1)) === parseFloat(v.toFixed(d))) d--; var g = v === tk.max && tk.max !== 0 ? top : ff; return format(v, { pre: g.pre, suf: g.suf, dec: d }, big); };
  }
  var ISO = /^\d{4}-\d{1,2}(-\d{1,2})?$/;
  /* Category labels as drawn: ISO dates become "5 Jan" / "Jan 2024"; everything else stays as typed. */
  function catLabels(P) {
    if (!P.times) return P.cats.slice();
    var years = {};
    P.times.forEach(function (t) { years[new Date(t).getUTCFullYear()] = 1; });
    var one = Object.keys(years).length === 1;
    return P.cats.map(function (c, i) {
      if (!ISO.test(c)) return c;
      var d = new Date(P.times[i]);
      return c.length > 7 ? d.getUTCDate() + ' ' + MON3[d.getUTCMonth()] + (one ? '' : ' ' + d.getUTCFullYear()) : MON3[d.getUTCMonth()] + (one ? '' : ' ' + String(d.getUTCFullYear()).slice(2));
    });
  }
  /* How the labels under a horizontal axis fit: flat, on two lines, turned 40°, or thinned to every n-th. */
  function xPlan(G, labels, band, S, o) {
    o = o || {};
    var size = S * 0.76, ws = labels.map(function (l) { return G.width(l, { size: size }); }), maxW = Math.max.apply(null, ws.concat([0])), gap = size * 0.5;
    if (maxW + gap <= band) return { mode: 'flat', size: size, h: size * 1.3, step: 1 };
    if (!o.thinOnly) {
      var two = band >= size * 3 && labels.every(function (l) {
        if (G.width(l, { size: size }) + gap <= band) return true;
        var n = 1, cur = '';
        return l.split(' ').every(function (wd) { if (G.width(wd, { size: size }) + gap > band) return false; var t = cur ? cur + ' ' + wd : wd; if (cur && G.width(t, { size: size }) + gap > band) { n++; cur = wd; } else cur = t; return n <= 2; });
      });
      if (two) return { mode: 'wrap', size: size, h: size * 2.5, step: 1 };
      if (band >= size * 1.75 && labels.length <= 40) { var lim = Math.min(maxW, S * 6.5); return { mode: 'rot', size: size, h: lim * 0.643 + size * 0.9, step: 1, max: lim }; }
    }
    return { mode: 'thin', size: size, h: size * 1.3, step: Math.max(1, Math.ceil((maxW + gap * 1.5) / Math.max(1, band))) };
  }
  function xDraw(G, plan, labels, at, y, T, lim) {
    var last = labels.length - 1;
    labels.forEach(function (l, i) {
      if (plan.mode === 'thin' && i % plan.step && i !== last) return;
      var o = { size: plan.size, color: T.muted, name: 'Axis label' };
      if (plan.mode === 'rot') G.text(l, at(i) + plan.size * 0.3, y + plan.size * 0.35, Object.assign(o, { rot: -40, align: 'right', base: 'middle', max: plan.max }));
      else if (plan.mode === 'wrap') G.text(l, at(i), y + plan.size * 0.25, Object.assign(o, { align: 'center', max: lim || 1e6, lines: 2, lh: 1.12 }));
      else {
        var w = G.width(l, o), x = at(i), al = 'center';
        if (lim && plan.mode === 'thin') { if (x - w / 2 < lim[0]) { al = 'left'; x = Math.max(lim[0], x - w * 0.2); } else if (x + w / 2 > lim[1]) { al = 'right'; x = Math.min(lim[1], x + w * 0.2); } }
        G.text(l, x, y + plan.size * 0.25, Object.assign(o, { align: al, opt: plan.mode === 'thin' && i === last && i % plan.step !== 0 }));
      }
    });
  }
  /* Monotone cubic through the points (no overshoot), sampled so it can be drawn as a polyline. */
  function smoothPts(p) {
    var n = p.length;
    if (n < 3) return p;
    var d = [], m = [], i;
    for (i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / ((p[i + 1][0] - p[i][0]) || 1));
    m.push(d[0]);
    for (i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
    m.push(d[n - 2]);
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    var per = clamp(Math.floor((CAP.poly - 1) / (n - 1)), 1, 8), out = [];
    for (i = 0; i < n - 1; i++) {
      var h = p[i + 1][0] - p[i][0];
      for (var j = 0; j < per; j++) {
        var u = j / per, u2 = u * u, u3 = u2 * u;
        out.push([p[i][0] + h * u, (2 * u3 - 3 * u2 + 1) * p[i][1] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * p[i + 1][1] + (u3 - u2) * h * m[i + 1]]);
      }
    }
    out.push(p[n - 1]);
    return out;
  }
  function fill(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, function (m0, k) { return vars[k] == null ? m0 : vars[k]; }); }
  /* Annotations as data (options.annotations): { type: 'line', value, label } a reference line; { type: 'band', from, to, label }
     a range on the value axis; { type: 'callout', category, series?, text } a note on one point. ax: { v(value) → px, horizontal, plot, point(cat, series) }. */
  function annotate(env, ax) {
    var G = env.G, T = env.T, S = env.S, r = ax.plot, size = S * 0.72;
    (Array.isArray(env.o.annotations) ? env.o.annotations : []).slice(0, 8).forEach(function (a) {
      if (!isObj(a)) return;
      var col = isHex(a.color) ? a.color : T.ink;
      if (a.type === 'band' && isFinite(a.from) && isFinite(a.to)) {
        var p0 = ax.v(Math.min(a.from, a.to)), p1 = ax.v(Math.max(a.from, a.to));
        if (ax.horizontal) { p0 = clamp(p0, r.x, r.x + r.w); p1 = clamp(p1, r.x, r.x + r.w); G.rect(p0, r.y, p1 - p0, r.h, col, { opacity: 0.08, name: 'Range band' }); if (a.label) G.text(a.label, (p0 + p1) / 2, r.y + size * 0.2, { size: size, color: T.muted, align: 'center', opt: true, name: 'Range label' }); }
        else { p0 = clamp(p0, r.y, r.y + r.h); p1 = clamp(p1, r.y, r.y + r.h); G.rect(r.x, p1, r.w, p0 - p1, col, { opacity: 0.08, name: 'Range band' }); if (a.label) G.text(a.label, r.x + r.w - size * 0.3, Math.min(p0, p1) + size * 0.2, { size: size, color: T.muted, align: 'right', opt: true, name: 'Range label' }); }
      } else if (a.type === 'line' && isFinite(a.value)) {
        var p = ax.v(a.value);
        if (ax.horizontal) { if (p < r.x - 1 || p > r.x + r.w + 1) return; G.line(p, r.y, p, r.y + r.h, col, Math.max(1.5, S * 0.05), { dash: [S * 0.22, S * 0.16], name: 'Reference line' }); if (a.label) G.text(a.label, p + size * 0.3, r.y, { size: size, role: 'value', color: col, opt: true, name: 'Reference label' }) || G.text(a.label, p - size * 0.3, r.y, { size: size, role: 'value', color: col, align: 'right', opt: true, name: 'Reference label' }); }
        else { if (p < r.y - 1 || p > r.y + r.h + 1) return; G.line(r.x, p, r.x + r.w, p, col, Math.max(1.5, S * 0.05), { dash: [S * 0.22, S * 0.16], name: 'Reference line' }); if (a.label) G.text(a.label, r.x + r.w, p - size * 0.25, { size: size, role: 'value', color: col, align: 'right', base: 'bottom', opt: true, name: 'Reference label' }) || G.text(a.label, r.x + r.w, p + size * 0.25, { size: size, role: 'value', color: col, align: 'right', opt: true, name: 'Reference label' }); }
      } else if (a.type === 'callout' && a.text && ax.point) {
        var pt = ax.point(a.category, a.series);
        if (!pt) return;
        G.dot(pt.x, pt.y, S * 0.24, null, { stroke: col, sw: Math.max(1.5, S * 0.06), name: 'Callout ring' });
        var up = pt.y - r.y > S * 2.2, al = pt.x > r.x + r.w * 0.7 ? 'right' : pt.x < r.x + r.w * 0.3 ? 'left' : 'center';
        G.text(a.text, pt.x, up ? pt.y - S * 0.5 : pt.y + S * 0.5, { size: size, role: 'value', color: col, align: al, base: up ? 'bottom' : 'top', max: r.w * 0.45, lines: 2, opt: true, name: 'Callout' });
      }
    });
  }
  function emptyNote(env, msg) { var r = env.plot; env.G.text(msg, r.x + r.w / 2, r.y + r.h / 2, { size: env.S * 0.85, color: env.T.muted, align: 'center', base: 'middle', max: r.w, lines: 3, name: 'Note' }); env.notes.push(msg); }

  var R = {};   /* renderers by chart type */

  /* ---------- 1. bars and columns ----------
     Drawn to scale: every bar's length is its value × one constant (info.scale.k), from a zero line. A truncated axis is refused. */
  function bars(env, horizontal) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot;
    var n = P.cats.length, m = P.series.length;
    if (!n || !m) return emptyNote(env, 'Add a column of numbers to draw bars.');
    if (o.zero === false) env.notes.push('Bars always start at zero, so their lengths can be compared.');
    var mode = m > 1 && (o.mode === 'stacked' || o.mode === 'percent') ? o.mode : 'grouped', stacked = mode !== 'grouped';
    var V = P.series.map(function (s) { return s.values.map(function (v) { return v == null ? 0 : v; }); }), f = P.f, i, s;
    if (mode === 'percent') {
      var tot = P.cats.map(function (c, ci) { var t = 0; V.forEach(function (v) { t += Math.abs(v[ci]); }); return t; });
      V = V.map(function (v) { return v.map(function (x, ci) { return tot[ci] ? Math.abs(x) / tot[ci] * 100 : 0; }); });
      f = { pre: '', suf: '%', dec: 0 };
    }
    var lo = 0, hi = 0;
    for (i = 0; i < n; i++) {
      if (stacked) { var p = 0, q = 0; for (s = 0; s < m; s++) { if (V[s][i] >= 0) p += V[s][i]; else q += V[s][i]; } hi = Math.max(hi, p); lo = Math.min(lo, q); }
      else for (s = 0; s < m; s++) { hi = Math.max(hi, V[s][i]); lo = Math.min(lo, V[s][i]); }
    }
    if (hi === 0 && lo === 0) hi = 1;
    var labels = catLabels(P), single = m === 1, hl = highlightOf(o);
    var colors = single ? colorsFor(P.cats, T, o, true) : colorsFor(P.series.map(function (x) { return x.name; }), T, o, false);
    var hitCat = single && hl.any && P.cats.some(function (c) { return hl.has(c); });
    var show = o.labels !== 'off', inside = single && o.labelPosition === 'inside';
    var fmtV = function (v, compact) { return format(v, f, compact); };
    var rad = function (t) { return stacked ? 0 : Math.min(T.radius * env.k * (t / (S * 1.2)), t / 2, T.radius * 2 * env.k); };
    if (!single) r = { x: r.x, y: r.y + legend(G, P.series.map(function (x, si) { return { name: x.name, color: colors[si] }; }), r.x, r.y, r.w, S, T), w: r.w, h: r.h };
    if (!single) r.h = env.plot.y + env.plot.h - r.y;
    var gap = isObj(o.gap) && single ? o.gap : null, ga = gap ? P.cats.indexOf(String(gap.from)) : -1, gb = gap ? P.cats.indexOf(String(gap.to)) : -1;
    if (ga < 0 || gb < 0 || ga === gb || V[0][ga] === V[0][gb] || V[0][ga] < 0 || V[0][gb] < 0) gap = null;
    var gv = null;
    if (gap) {
      var d = Math.abs(V[0][ga] - V[0][gb]), less = V[0][gb] < V[0][ga], pc = V[0][ga] ? Math.round(d / Math.abs(V[0][ga]) * 100) : 0;
      gv = { diff: format(d, { pre: f.pre, suf: '', dec: f.dec }), percent: pc, from: P.cats[ga], to: P.cats[gb], unit: f.suf, low: less ? gb : ga, high: less ? ga : gb };
      gv.label = fill(gap.label || ('{diff} ' + (less ? 'fewer' : 'more')), gv);
      gv.note = gap.note === '' ? '' : fill(gap.note || ('{percent}% ' + (less ? 'fewer' : 'more') + ' than {from}'), gv);
    }
    var axis = o.axis === true || stacked || !show, tk, k, zero, tf;

    if (horizontal) {
      var noteH = gv && gv.note ? S * 1.25 : 0, axisH = axis ? S * 1.5 : 0;
      var band = (r.h - noteH - axisH) / n, catW = Math.max.apply(null, labels.map(function (l) { return G.width(l, { role: 'label', size: S * 0.9 }); }));
      var at = o.labelsAt === 'above' || o.labelsAt === 'left' ? o.labelsAt : (catW <= r.w * 0.3 || band < S * 2.3 ? 'left' : 'above');
      if (at === 'above' && band < S * 1.7) at = 'left';
      var u, ls, thick, col = 0, top0;
      if (at === 'above') { u = clamp(band * 0.34, S * 0.75, S * 1.35); ls = Math.min(u, band * 0.4); thick = Math.max(2, Math.min(band - ls * 1.3 - u * 0.4, u * 2.6)); top0 = ls * 1.3; }
      else { u = clamp(band * 0.5, S * 0.6, S * 1.15); ls = Math.min(u * 0.9, band * 0.72); thick = clamp(band * 0.64, 2, u * 2.3); top0 = (band - thick) / 2; col = Math.min(Math.max.apply(null, labels.map(function (l) { return G.width(l, { role: 'label', size: ls }); })), r.w * 0.34) + u * 0.6; }
      var vs = inside ? Math.min(thick * 0.62, u * 1.7) : at === 'above' ? Math.min(u * 1.2, thick * 0.95) : Math.min(ls, thick * 1.1), each = stacked ? thick : thick / m;
      if (!stacked && !single) vs = Math.min(vs, Math.max(each * 1.05, 7));
      var plain = function (v) { return fmtV(v, false); }, vf = plain;
      var valW = function (fn) { var w = 0; V.forEach(function (vv) { vv.forEach(function (v) { w = Math.max(w, G.width(fn(v), { role: 'value', size: vs })); }); }); return w; };
      var out = show && !inside && !stacked ? valW(plain) + u * 0.5 : 0;
      if (out > r.w * 0.3) { vf = function (v) { return fmtV(v, true); }; out = valW(vf) + u * 0.5; }
      if (stacked && show) out = Math.max.apply(null, P.cats.map(function (c, ci) { var t = 0; V.forEach(function (v) { t += v[ci]; }); return G.width(mode === 'percent' ? '' : fmtV(t, true), { role: 'value', size: vs }); })) + u * 0.5;
      var x0 = r.x + col, avail = Math.max(10, r.w - col - out - (lo < 0 ? out : 0));
      if (axis) { tk = ticks(lo, hi, clamp(Math.floor(avail / (S * 4.2)), 2, 6)); lo = tk.min; hi = tk.max; tf = tickFormat(tk, f); avail -= G.width(tf(hi), { size: S * 0.72 }) / 2; }
      k = avail / (hi - lo); zero = x0 + (lo < 0 ? out : 0) + (0 - lo) * k;
      /* bars at their largest size: keep the rows together and centre the block instead of spreading them out */
      var bandFit = Math.min(band, at === 'above' ? top0 + thick + u * 0.95 : thick * 1.8), slack = (band - bandFit) * n + (at === 'above' ? bandFit - top0 - thick : 0);
      if (at !== 'above') top0 = (bandFit - thick) / 2;
      band = bandFit;
      var yTop = r.y + (axis ? 0 : slack / 2), y1 = axis ? r.y + r.h - axisH : yTop + band * n + noteH;
      if (axis) tk.ticks.forEach(function (v) { var x = zero + v * k; G.line(x, yTop, x, y1, v === 0 ? T.axis : T.grid, Math.max(1, env.k * 1.5), { name: 'Gridline' }); G.text(tf(v), x, y1 + S * 0.3, { size: S * 0.72, color: T.muted, align: 'center', opt: true, name: 'Axis label' }); });
      else if (lo < 0) G.line(zero, yTop, zero, y1, T.axis, Math.max(1, env.k * 1.5), { name: 'Zero line' });
      var yb = axis ? r.y + slack / 2 : yTop, pos = {};
      for (i = 0; i < n; i++) {
        var by = yb + top0, accP = 0, accN = 0;
        if (at === 'above') G.text(labels[i], r.x, yb, { role: 'label', size: ls, max: r.w, name: 'Category' });
        else G.text(labels[i], x0 - u * 0.6, yb + band / 2, { role: 'label', size: ls, align: 'right', base: 'middle', max: col - u * 0.6, lines: band > ls * 2.5 ? 2 : 1, lh: 1.1, name: 'Category' });
        for (s = 0; s < m; s++) {
          var v = V[s][i], c = single ? colors[i] : colors[s], a0 = stacked ? (v >= 0 ? accP : accN) : 0, y = stacked ? by : by + s * each, th = stacked ? thick : Math.max(1, each - (m > 1 ? Math.min(2, each * 0.12) : 0));
          if (stacked) { if (v >= 0) accP += v; else accN += v; }
          var bx = zero + a0 * k, bw = v * k;
          if (P.series[s].values[i] == null) continue;
          G.rect(bx, y, bw, th, c, { r: rad(th), name: single ? labels[i] : P.series[s].name + ', ' + labels[i] });
          G.info.bars.push({ i: G.layers.length - 1, v: v, cat: P.cats[i], series: P.series[s].name });
          pos[i + ':' + s] = { x: bx + bw, y: y + th / 2 };
          if (!show) continue;
          var str = vf(v), tw = G.width(str, { role: 'value', size: vs }), vc = single && hitCat && hl.has(P.cats[i]) ? T.accentInk : T.ink;
          if (stacked) { if (Math.abs(bw) > tw + vs * 0.8 && th >= vs * 1.15) G.text(mode === 'percent' ? format(v, f) : fmtV(v, true), bx + bw / 2, y + th / 2, { role: 'value', size: Math.min(vs, th * 0.7), align: 'center', base: 'middle', on: c, color: readable(c, T.ink, '#FFFFFF'), opt: true, name: 'Value' }); }
          else if (inside && Math.abs(bw) > tw + th * 0.6) G.text(str, bx + (v < 0 ? -1 : 1) * th * 0.32, y + th / 2, { role: 'label', size: vs, align: v < 0 ? 'right' : 'left', base: 'middle', on: c, color: readable(c, T.ink, T.card), name: 'Value' });
          else G.text(str, bx + bw + (v < 0 ? -1 : 1) * u * 0.42, y + th / 2, { role: 'value', size: vs, align: v < 0 ? 'right' : 'left', base: 'middle', color: vc, opt: !single, name: 'Value' });
        }
        if (stacked && show && mode !== 'percent') G.text(fmtV(accP + accN, true), zero + accP * k + u * 0.4, by + thick / 2, { role: 'value', size: vs, base: 'middle', opt: true, name: 'Total' });
        if (gv && i === gv.low) {
          var gx0 = zero + V[0][gv.low] * k + u * 0.22, gx1 = zero + V[0][gv.high] * k, gw = gx1 - gx0;
          if (gw > 4) {
            G.rect(gx0, by, gw, thick, mix(T.accent, T.card, 0.86), { r: rad(thick), stroke: mix(T.accent, T.card, 0.55), sw: Math.max(1.5, u * 0.07), dash: [u * 0.2, u * 0.16], name: 'Gap' });
            var gs = Math.min(vs, u * 1.0), gwd = G.width(gv.label, { role: 'value', size: gs }), gon = mix(T.accent, T.card, 0.86);
            if (gwd > gw - gs * 0.6) gs = Math.max(gs * 0.6, gs * (gw - gs * 0.6) / gwd);
            if (G.width(gv.label, { role: 'value', size: gs }) <= gw - gs * 0.3) G.text(gv.label, gx0 + gw / 2, by + thick / 2, { role: 'value', size: gs, align: 'center', base: 'middle', on: gon, color: T.accentInk, name: 'Gap label' });
            else G.text(gv.label, gx1 + u * 0.4, by + thick / 2, { role: 'label', size: gs, base: 'middle', color: T.accentInk, opt: true, name: 'Gap label' });
            if (gv.note) { var ns = u * 0.78, nw = G.width(gv.note, { role: 'value', size: ns }), nx = clamp(gx0 + gw / 2, r.x + nw / 2, r.x + r.w - nw / 2); G.text(gv.note, nx, by + thick + u * 0.3, { role: 'value', size: ns, align: 'center', color: T.accentInk, name: 'Gap note' }); }
          }
          yb += noteH;
        }
        yb += band;
      }
      G.info.scale = { k: k, zero: zero, axis: 'x' };
      annotate(env, { v: function (v) { return zero + v * k; }, horizontal: true, plot: { x: x0, y: yTop, w: r.w - col, h: y1 - yTop }, point: function (c, sn) { var ci = P.cats.indexOf(String(c)), si = Math.max(0, P.series.map(function (x) { return x.name; }).indexOf(String(sn))); return pos[ci + ':' + si]; } });
      return;
    }

    /* vertical */
    var size = S * 0.82, tickS = S * 0.72, bandW0 = r.w / n, barW0 = bandW0 * (single ? 0.68 : 0.8) / (stacked ? 1 : m);
    var fitsPlain = function (fn, bw2) { return V.every(function (vv, si) { return vv.every(function (v, ci) { return P.series[si].values[ci] == null || G.width(fn(v), { role: 'value', size: size }) <= bw2 + size * 0.5; }); }); };
    var vfn = function (v) { return fmtV(v, false); };
    if (show && !stacked && !fitsPlain(vfn, barW0)) { vfn = function (v) { return fmtV(v, true); }; if (!fitsPlain(vfn, barW0)) { if (o.labels !== 'on') { show = false; axis = true; } } }
    var left = 0;
    if (axis) { tk = ticks(lo, hi, clamp(Math.floor(r.h / (S * 2.6)), 2, 6)); lo = tk.min; hi = tk.max; tf = tickFormat(tk, f); left = Math.max.apply(null, tk.ticks.map(function (v) { return G.width(tf(v), { size: tickS }); })) + S * 0.5; }
    var ix = r.x + left, iw = r.w - left, bandW = iw / n, plan = xPlan(G, labels, bandW, S, { thinOnly: !!P.times });
    var topPad = show ? size * 1.5 : size * 0.4, botPad = plan.h + S * 0.2 + (lo < 0 && show ? size * 1.4 : 0);
    var ih = Math.max(10, r.h - topPad - botPad), iy = r.y + topPad;
    k = ih / (hi - lo); zero = iy + hi * k;
    if (axis) tk.ticks.forEach(function (v) { var y = zero - v * k; G.line(ix, y, ix + iw, y, v === 0 ? T.axis : T.grid, Math.max(1, env.k * 1.5), { name: 'Gridline' }); G.text(tf(v), ix - S * 0.4, y, { size: tickS, color: T.muted, align: 'right', base: 'middle', name: 'Axis label' }); });
    else G.line(ix, zero, ix + iw, zero, T.axis, Math.max(1, env.k * 1.5), { name: 'Baseline' });
    var groupW = bandW * (single ? 0.68 : 0.8), bw1 = stacked ? groupW : groupW / m, pts = {};
    for (i = 0; i < n; i++) {
      var gx = ix + bandW * i + (bandW - groupW) / 2, aP = 0, aN = 0;
      for (s = 0; s < m; s++) {
        var v2 = V[s][i], c2 = single ? colors[i] : colors[s], b0 = stacked ? (v2 >= 0 ? aP : aN) : 0, x = stacked ? gx : gx + s * bw1, w2 = stacked ? bw1 : Math.max(1, bw1 - (m > 1 ? Math.min(2, bw1 * 0.1) : 0));
        if (stacked) { if (v2 >= 0) aP += v2; else aN += v2; }
        if (P.series[s].values[i] == null) continue;
        var yy = zero - (b0 + v2) * k, hh = v2 * k;
        G.rect(x, yy, w2, hh, c2, { r: rad(w2), name: single ? labels[i] : P.series[s].name + ', ' + labels[i] });
        G.info.bars.push({ i: G.layers.length - 1, v: v2, cat: P.cats[i], series: P.series[s].name });
        pts[i + ':' + s] = { x: x + w2 / 2, y: yy };
        if (!show) continue;
        if (stacked) { var st2 = mode === 'percent' ? format(v2, f) : fmtV(v2, true); if (Math.abs(hh) >= size * 1.3 && G.width(st2, { role: 'value', size: size * 0.9 }) <= w2 - 2) G.text(st2, x + w2 / 2, yy + hh / 2, { role: 'value', size: size * 0.9, align: 'center', base: 'middle', on: c2, color: readable(c2, T.ink, '#FFFFFF'), opt: true, name: 'Value' }); }
        else G.text(vfn(v2), x + w2 / 2, v2 < 0 ? yy + size * 0.2 : yy - size * 0.2, { role: 'value', size: size, align: 'center', base: v2 < 0 ? 'top' : 'bottom', color: single && hitCat && hl.has(P.cats[i]) ? T.accentInk : T.ink, opt: true, name: 'Value' });
      }
      if (stacked && show && mode !== 'percent') G.text(fmtV(aP + aN, true), gx + bw1 / 2, zero - aP * k - size * 0.2, { role: 'value', size: size, align: 'center', base: 'bottom', opt: true, name: 'Total' });
      if (gv && i === gv.low) {
        var ty = zero - V[0][gv.high] * k, by2 = zero - V[0][gv.low] * k - size * 0.25, gh = by2 - ty;
        if (gh > 4) {
          G.rect(gx, ty, groupW, gh, mix(T.accent, T.card, 0.86), { r: rad(groupW), stroke: mix(T.accent, T.card, 0.55), sw: Math.max(1.5, S * 0.06), dash: [S * 0.2, S * 0.16], name: 'Gap' });
          G.text(gv.label, gx + groupW / 2, ty + gh / 2, { role: 'label', size: size * 0.9, align: 'center', base: 'middle', max: groupW - size * 0.4, lines: 3, lh: 1.1, on: mix(T.accent, T.card, 0.86), color: T.accentInk, free: true, name: 'Gap label' });
        }
      }
    }
    xDraw(G, plan, labels, function (ci) { return ix + bandW * (ci + 0.5); }, zero + (lo < 0 ? -lo * k : 0) + S * 0.15 + (lo < 0 && show ? size * 1.3 : 0), T, plan.mode === 'wrap' ? bandW - 4 : [r.x, r.x + r.w]);
    G.info.scale = { k: k, zero: zero, axis: 'y' };
    annotate(env, { v: function (v) { return zero - v * k; }, horizontal: false, plot: { x: ix, y: iy, w: iw, h: ih }, point: function (c, sn) { var ci = P.cats.indexOf(String(c)), si = Math.max(0, P.series.map(function (x) { return x.name; }).indexOf(String(sn))); return pts[ci + ':' + si]; } });
  }
  R.bar = function (env) { bars(env, env.o.orientation !== 'vertical'); };
  R.column = function (env) { bars(env, env.o.orientation === 'horizontal'); };

  /* ---------- 2. lines and areas ---------- */
  function lines(env, area) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot;
    var n = P.cats.length, m = P.series.length, i, s;
    if (!n || !m) return emptyNote(env, 'Add a column of numbers to draw a line.');
    var stacked = area && m > 1 && (o.mode === 'stacked' || o.mode === 'percent'), f = P.f;
    var V = P.series.map(function (x) { return x.values.slice(); });
    if (n > CAP.points) {
      var st = n / CAP.points, pick = [];
      for (i = 0; i < CAP.points; i++) pick.push(Math.min(n - 1, Math.round(i * st)));
      pick[pick.length - 1] = n - 1;
      env.notes.push('Showing ' + CAP.points + ' of ' + n + ' points, evenly spaced.');
      V = V.map(function (v) { return pick.map(function (j) { return v[j]; }); });
      P = Object.assign({}, P, { cats: pick.map(function (j) { return P.cats[j]; }), times: P.times ? pick.map(function (j) { return P.times[j]; }) : null });
      n = pick.length;
    }
    if (stacked) {
      V = V.map(function (v) { return v.map(function (x) { return x == null ? 0 : Math.max(0, x); }); });
      if (o.mode === 'percent') { var tot = P.cats.map(function (c, ci) { var t = 0; V.forEach(function (v) { t += v[ci]; }); return t; }); V = V.map(function (v) { return v.map(function (x, ci) { return tot[ci] ? x / tot[ci] * 100 : 0; }); }); f = { pre: '', suf: '%', dec: 0 }; }
    }
    var lo = Infinity, hi = -Infinity, base = V.map(function () { return P.cats.map(function () { return 0; }); });
    if (stacked) { var acc = P.cats.map(function () { return 0; }); V.forEach(function (v, si) { v.forEach(function (x, ci) { base[si][ci] = acc[ci]; acc[ci] += x; }); }); lo = 0; hi = Math.max.apply(null, acc); }
    else V.forEach(function (v) { v.forEach(function (x) { if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }); });
    if (!isFinite(lo)) return emptyNote(env, 'There are no numbers to draw yet.');
    var cut = !area && o.zero === false && lo > 0;
    if (!cut) lo = Math.min(0, lo);
    if (hi < 0 && !cut) hi = 0;
    var names = P.series.map(function (x) { return x.name; }), colors = m === 1 ? [highlightOf(o).any ? T.accent : T.palette[0]] : colorsFor(names, T, o, false), hl = highlightOf(o);
    var labels = catLabels(P), tickS = S * 0.72, endS = S * 0.78;
    var ends = o.legend !== 'on' && (m === 1 || (m * endS * 1.25 <= r.h * 0.8 && Math.max.apply(null, names.map(function (nm) { return G.width(nm, { role: 'value', size: endS }); })) <= r.w * 0.24));
    var y0 = r.y;
    if (!ends && m > 1) y0 += legend(G, names.map(function (nm, si) { return { name: nm, color: colors[si], line: !area }; }), r.x, r.y, r.w, S, T);
    var H0 = r.y + r.h - y0, tk = ticks(lo, hi, clamp(Math.floor(H0 / (S * 2.5)), 2, 6));
    if (o.mode === 'percent' && stacked) tk = { min: 0, max: 100, step: 25, ticks: [0, 25, 50, 75, 100] };
    var tf = tickFormat(tk, f), left = Math.max.apply(null, tk.ticks.map(function (v) { return G.width(tf(v), { size: tickS }); })) + S * 0.5;
    var lastTxt = P.series.map(function (x, si) { var lv = null; for (var j = n - 1; j >= 0; j--) if (x.values[j] != null || stacked) { lv = stacked ? V[si][j] : V[si][j]; break; } return m === 1 ? format(lv, f) : x.name; });
    var right = ends ? Math.max.apply(null, lastTxt.map(function (t) { return G.width(t, { role: 'value', size: endS }); })) + S * 0.7 : S * 0.3;
    var ix = r.x + left, iw = Math.max(10, r.w - left - right), plan = xPlan(G, labels, iw / n, S, { thinOnly: true });
    var noteH = cut ? S * 0.95 : 0, iy = y0 + S * 0.5, ih = Math.max(10, r.y + r.h - iy - plan.h - S * 0.25 - noteH);
    var ys = scale.linear(tk.min, tk.max, iy + ih, iy), inset = n > 1 ? Math.min(S * 0.5, iw / (2 * n)) : iw / 2;
    var xs = P.times && n > 1 && P.times[n - 1] !== P.times[0] ? scale.time(P.times[0], P.times[n - 1], ix + inset, ix + iw - inset) : null;
    var X = function (ci) { return xs ? xs(P.times[ci]) : n > 1 ? ix + inset + ci * (iw - 2 * inset) / (n - 1) : ix + iw / 2; };
    tk.ticks.forEach(function (v) { var y = ys(v); G.line(ix, y, ix + iw, y, v === 0 ? T.axis : T.grid, Math.max(1, env.k * 1.5), { name: 'Gridline' }); G.text(tf(v), ix - S * 0.4, y, { size: tickS, color: T.muted, align: 'right', base: 'middle', name: 'Axis label' }); });
    if (tk.min > 0 || tk.max < 0) G.line(ix, iy + ih, ix + iw, iy + ih, T.axis, Math.max(1, env.k * 1.5), { name: 'Baseline' });
    if (cut) {
      var zx = ix - S * 0.4, zy = iy + ih - S * 0.3, zz = S * 0.16;
      G.poly([[zx - zz, zy + zz * 2], [zx + zz, zy + zz], [zx - zz, zy], [zx + zz, zy - zz], [zx - zz, zy - zz * 2]], { stroke: T.muted, sw: Math.max(1.2, S * 0.05), name: 'Axis break' });
      G.text('The vertical axis starts at ' + format(tk.min, f) + ', not zero.', r.x, r.y + r.h - noteH + S * 0.1, { size: S * 0.64, color: T.muted, max: r.w, name: 'Axis break note' });
      env.notes.push('The vertical axis starts at ' + format(tk.min, f) + ', not zero.');
    }
    var lw = Math.max(2, S * 0.1), zeroY = ys(clamp(0, tk.min, tk.max)), endAt = [], ptOf = {};
    var order = names.map(function (nm, si) { return si; });
    if (hl.any && !stacked) order.sort(function (a, b) { return (hl.has(names[a]) ? 1 : 0) - (hl.has(names[b]) ? 1 : 0); });
    order.forEach(function (si) {
      var c = colors[si], segs = [], cur = [], top;
      for (i = 0; i < n; i++) {
        var v = V[si][i];
        if (v == null) { if (cur.length) segs.push(cur); cur = []; continue; }
        top = ys(base[si][i] + v);
        cur.push([X(i), top]);
        ptOf[i + ':' + si] = { x: X(i), y: top };
      }
      if (cur.length) segs.push(cur);
      var hot = hl.any && hl.has(names[si]), w = hot ? lw * 1.35 : hl.any && m > 1 ? lw * 0.8 : lw;
      segs.forEach(function (seg) {
        var line = o.smooth ? smoothPts(seg) : seg;
        if (area) {
          var poly = line.slice();
          if (stacked) { var under = seg.map(function (p) { return [p[0], ys(baseAt(si, p[0]))]; }); poly = poly.concat((o.smooth ? smoothPts(under) : under).reverse()); }
          else poly = poly.concat([[seg[seg.length - 1][0], zeroY], [seg[0][0], zeroY]]);
          G.poly(poly, { fill: c, opacity: stacked ? 1 : 0.22, name: names[si] + ' area' });
        }
        if (seg.length > 1) G.poly(line, { stroke: stacked ? T.card : c, sw: stacked ? Math.max(1, lw * 0.5) : w, name: names[si] });
        if (o.markers === true || (o.markers !== false && !stacked && n <= 12 && m <= 3) || seg.length === 1) seg.forEach(function (p) { G.dot(p[0], p[1], seg.length === 1 ? w * 1.6 : w * 1.25, c, { stroke: T.card, sw: Math.max(1, w * 0.4), name: names[si] + ' point' }); });
      });
      var lastI = -1;
      for (i = n - 1; i >= 0; i--) if (V[si][i] != null) { lastI = i; break; }
      if (lastI >= 0) endAt.push({ si: si, y: stacked ? ys(base[si][lastI] + V[si][lastI] / 2) : ys(V[si][lastI]), x: X(lastI), c: c, hot: hot });
    });
    function baseAt(si, px) { for (var j = 0; j < n; j++) if (Math.abs(X(j) - px) < 0.01) return base[si][j]; return 0; }
    if (o.labels === 'on' && m === 1) for (i = 0; i < n; i++) if (V[0][i] != null) G.text(format(V[0][i], f, V[0][i] >= 10000), X(i), ys(V[0][i]) - lw * 2, { role: 'value', size: tickS, align: 'center', base: 'bottom', opt: true, name: 'Value' });
    if (ends) {
      endAt.sort(function (a, b) { return a.y - b.y; });
      var gapY = endS * 1.2, yy;
      for (i = 0; i < endAt.length; i++) { yy = Math.max(endAt[i].y, i ? endAt[i - 1].ly + gapY : iy); endAt[i].ly = yy; }
      var over = endAt.length ? endAt[endAt.length - 1].ly - (iy + ih) : 0;
      if (over > 0) for (i = endAt.length - 1; i >= 0; i--) { endAt[i].ly = Math.min(endAt[i].ly, i === endAt.length - 1 ? iy + ih : endAt[i + 1].ly - gapY); }
      endAt.forEach(function (e) {
        if (m === 1) G.dot(e.x, e.y, lw * 1.5, e.c, { stroke: T.card, sw: Math.max(1, lw * 0.4), name: 'Last point' });
        G.text(lastTxt[e.si], ix + iw + S * 0.35, e.ly, { role: 'value', size: endS, base: 'middle', color: m === 1 ? T.ink : ensure(e.c, T.card, 4.5), max: right - S * 0.35, name: m === 1 ? 'Last value' : 'Series label' });
      });
    }
    xDraw(G, plan, labels, X, iy + ih + S * 0.15, T, [r.x, r.x + r.w]);
    annotate(env, { v: ys, horizontal: false, plot: { x: ix, y: iy, w: iw, h: ih }, point: function (c, sn) { return ptOf[P.cats.indexOf(String(c)) + ':' + Math.max(0, names.indexOf(String(sn)))]; } });
    G.info.axis = { min: tk.min, max: tk.max, cut: cut };
  }
  R.line = function (env) { lines(env, false); };
  R.area = function (env) { lines(env, true); };

  /* ---------- 3. pie and donut ---------- */
  function pie(env, donut) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot;
    if (!P.series.length) return emptyNote(env, 'Add a column of numbers to draw the slices.');
    var items = [], dropped = 0, f = P.f;
    P.cats.forEach(function (c, i) { var v = P.series[0].values[i]; if (v > 0) items.push({ name: c, v: v }); else if (v != null) dropped++; });
    if (dropped) env.notes.push(plural(dropped, 'value') + ' of zero or less cannot be a slice and ' + (dropped === 1 ? 'was' : 'were') + ' left out.');
    if (!items.length) return emptyNote(env, 'A pie needs at least one number above zero.');
    var total = sum(items.map(function (x) { return x.v; }));
    if (o.fold !== false && items.length > 6 && !P.other) {
      var small = items.filter(function (x) { return x.v / total < 0.03; });
      if (items.length > 9) { var ranked = items.slice().sort(function (a, b) { return b.v - a.v; }); small = ranked.slice(8); }
      if (small.length > 1) { items = items.filter(function (x) { return small.indexOf(x) < 0; }); items.push({ name: 'Other', v: sum(small.map(function (x) { return x.v; })), other: true }); env.notes.push(plural(small.length, 'small slice') + ' are shown together as "Other".'); }
    }
    var colors = colorsFor(items.map(function (x) { return x.name; }), T, o, false), hl = highlightOf(o), anyHit = hl.any && items.some(function (x) { return hl.has(x.name); });
    items.forEach(function (x, i) { x.c = x.other && !anyHit ? T.neutral : colors[i]; x.share = x.v / total; x.pct = format(x.share * 100, { suf: '%', dec: x.share < 0.1 && x.share * 100 !== Math.round(x.share * 100) ? 1 : 0 }); });
    var size = S * 0.8, showVal = o.show === 'value', lab = function (x) { return showVal ? format(x.v, f, x.v >= 100000) : x.pct; };
    var nameW = Math.min(Math.max.apply(null, items.map(function (x) { return G.width(x.name, { role: 'value', size: size }) + size * 0.4 + G.width(lab(x), { size: size }); })), r.w * 0.3);
    var Rout = Math.min(r.h / 2 - size * 0.9, (r.w - 2 * (nameW + S * 1.5)) / 2), outside = o.legend !== 'on' && Rout >= Math.min(r.w, r.h) * 0.24 && items.length * size * 1.35 <= r.h * 1.7;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2, legendH = 0;
    if (!outside) {
      var rows = Math.ceil(items.length / Math.max(1, Math.floor(r.w / (nameW + size * 3)))), lh0 = Math.min(rows * size * 1.65 + S * 0.4, r.h * 0.45);
      Rout = Math.max(10, Math.min(r.w / 2, (r.h - lh0) / 2) - 2); cy = r.y + Rout + 1; legendH = lh0;
    }
    var r0 = donut ? Rout * clamp(typeof o.hole === 'number' ? o.hole : 0.58, 0.2, 0.85) : 0, a = 0, sw = Math.max(1.5, S * 0.07), sides = { L: [], R: [] };
    G.info.angles = [];
    items.forEach(function (x) {
      var sweep = x.share * Math.PI * 2, a1 = a + sweep, mid = a + sweep / 2;
      G.wedge(cx, cy, r0, Rout, a, a1, x.c, { stroke: items.length > 1 ? T.card : null, sw: sw, name: x.name });
      G.info.angles.push(sweep * 180 / Math.PI);
      x.mid = mid; x.in = false;
      var rm = donut ? (r0 + Rout) / 2 : Rout * 0.66, tw = G.width(lab(x), { role: 'value', size: size });
      if (sweep * rm > tw * 1.35 && (donut ? Rout - r0 : Rout * 0.6) > tw * 1.15 && sweep > 0.3) {
        x.in = !!G.text(lab(x), cx + Math.sin(mid) * rm, cy - Math.cos(mid) * rm, { role: 'value', size: size, align: 'center', base: 'middle', on: x.c, color: readable(x.c, T.ink, '#FFFFFF'), free: true, name: 'Slice value' });
      }
      (Math.sin(mid) >= 0 ? sides.R : sides.L).push(x);
      a = a1;
    });
    if (donut && o.centre !== false) {
      var big = format(total, f, total >= 100000), bs = Math.min(S * 1.7, r0 * 2 * 0.8 / Math.max(1, G.width(big, { role: 'title', size: 100 }) / 100));
      if (bs >= S * 0.6) { G.text(big, cx, cy - bs * 0.12, { role: 'title', size: bs, align: 'center', base: 'middle', free: true, name: 'Total' }); G.text(typeof o.centre === 'string' ? o.centre : 'Total', cx, cy + bs * 0.62, { size: Math.min(S * 0.72, bs * 0.5), color: T.muted, align: 'center', base: 'middle', max: r0 * 1.5, free: true, name: 'Total label' }); }
    }
    if (outside) {
      ['L', 'R'].forEach(function (side) {
        var list = sides[side].slice().sort(function (p, q) { return -Math.cos(p.mid) + Math.cos(q.mid); }), gapY = size * 1.4, i;
        list.forEach(function (x, j) { x.ly = Math.max(cy - Math.cos(x.mid) * (Rout + S * 0.7), j ? list[j - 1].ly + gapY : r.y + size * 0.6); });
        for (i = list.length - 1; i >= 0; i--) list[i].ly = Math.min(list[i].ly, i === list.length - 1 ? r.y + r.h - size * 0.6 : list[i + 1].ly - gapY);
        list.forEach(function (x) {
          var dir = side === 'R' ? 1 : -1, ex = cx + Math.sin(x.mid) * (Rout + S * 0.12), ey = cy - Math.cos(x.mid) * (Rout + S * 0.12), lx = cx + dir * (Rout + S * 0.95);
          G.poly([[ex, ey], [cx + Math.sin(x.mid) * (Rout + S * 0.45), x.ly], [lx, x.ly]], { stroke: T.axis, sw: Math.max(1, S * 0.04), cap: 'butt', name: 'Leader' });
          var nb = G.text(x.name, lx + dir * size * 0.3, x.ly, { role: 'value', size: size, align: side === 'R' ? 'left' : 'right', base: 'middle', max: nameW - (x.in ? 0 : G.width(lab(x), { size: size }) + size * 0.4), name: 'Slice label' });
          if (!x.in && nb) G.text(lab(x), side === 'R' ? nb.x1 + size * 0.4 : nb.x0 - size * 0.4, x.ly, { size: size, color: T.muted, align: side === 'R' ? 'left' : 'right', base: 'middle', name: 'Slice value' });
        });
      });
    } else {
      var colW = nameW + size * 3, cols = Math.max(1, Math.floor(r.w / colW)), ly = cy + Rout + S * 0.6, rowH = Math.min(size * 1.65, (r.y + r.h - ly) / Math.ceil(items.length / cols));
      var fs = Math.min(size, rowH * 0.7), lx0 = r.x + (r.w - Math.min(cols, items.length) * colW) / 2;
      items.forEach(function (x, i) {
        var px = lx0 + (i % cols) * colW, py = ly + Math.floor(i / cols) * rowH + rowH / 2;
        G.rect(px, py - fs * 0.38, fs * 0.76, fs * 0.76, x.c, { r: T.radius ? fs * 0.2 : 0, name: 'Legend key' });
        var nb = G.text(x.name, px + fs * 1.15, py, { role: 'value', size: fs, base: 'middle', max: colW - fs * 1.6 - G.width(lab(x), { size: fs }) - fs, name: 'Slice label' });
        if (nb) G.text(lab(x), nb.x1 + fs * 0.4, py, { size: fs, color: T.muted, base: 'middle', name: 'Slice value' });
      });
    }
  }
  R.pie = function (env) { pie(env, false); };
  R.donut = function (env) { pie(env, true); };

  /* A value axis on the left: ticks first (their width decides the plot's left edge), gridlines once the plot is known. */
  function vAxis(env, lo, hi, f, H, log) {
    var G = env.G, S = env.S, tk = log ? logTicks(lo, hi) : ticks(lo, hi, clamp(Math.floor(H / (S * 2.5)), 2, 6));
    var tf = log ? function (v) { return format(v, { pre: f.pre, suf: f.suf && f.suf.length <= 3 ? f.suf : '' }, v >= 10000); } : tickFormat(tk, f);
    return { tk: tk, tf: tf, log: !!log, left: Math.max.apply(null, tk.ticks.map(function (v) { return G.width(tf(v), { size: S * 0.72 }); })) + S * 0.5 };
  }
  function vGrid(env, ax, ix, iw, iy, ih, right, col) {
    var G = env.G, T = env.T, S = env.S, ys = (ax.log ? scale.log : scale.linear)(ax.tk.min, ax.tk.max, iy + ih, iy);
    ax.tk.ticks.forEach(function (v) {
      var y = ys(v);
      if (!right) G.line(ix, y, ix + iw, y, v === 0 ? T.axis : T.grid, Math.max(1, env.k * 1.5), { name: 'Gridline' });
      G.text(ax.tf(v), right ? ix + iw + S * 0.4 : ix - S * 0.4, y, { size: S * 0.72, color: col || T.muted, align: right ? 'left' : 'right', base: 'middle', name: 'Axis label' });
    });
    return ys;
  }

  /* ---------- 4. scatter, bubble, histogram ---------- */
  function scatter(env, bubble) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, map = P.map, data = env.chart.data;
    if (map.x < 0 || map.y < 0) return emptyNote(env, 'A scatter plot needs two columns of numbers.');
    var pts = [];
    P.rows.forEach(function (row) {
      var x = numberOf(row[map.x]), y = numberOf(row[map.y]), z = bubble && map.size >= 0 ? numberOf(row[map.size]) : null;
      if (x && y) pts.push({ x: x.v, y: y.v, z: z ? Math.max(0, z.v) : null, label: map.category >= 0 ? cell(row[map.category]) : '' });
    });
    if (!pts.length) return emptyNote(env, 'There are no rows with both numbers yet.');
    if (pts.length > CAP.scatter) { var all = pts.length, st = all / CAP.scatter; pts = pts.filter(function (p, i) { return Math.floor(i / st) !== Math.floor((i - 1) / st); }).slice(0, CAP.scatter); env.notes.push('Showing ' + pts.length + ' of ' + all + ' points, evenly sampled.'); }
    var fx = fmtOf(P.A[map.x], null), fy = fmtOf(P.A[map.y], o), xs0 = pts.map(function (p) { return p.x; }), ys0 = pts.map(function (p) { return p.y; });
    var xmin = Math.min.apply(null, xs0), xmax = Math.max.apply(null, xs0), ymin = Math.min.apply(null, ys0), ymax = Math.max.apply(null, ys0);
    var logX = o.logX === true && xmin > 0, logY = o.logY === true && ymin > 0, tickS = S * 0.72;
    var titleH = S * 1.7, ay = vAxis(env, ymin, ymax, fy, r.h - titleH * 2.4, logY), ix = r.x + ay.left, iw = Math.max(10, r.w - ay.left - S * 0.6);
    var tx = logX ? logTicks(xmin, xmax) : ticks(xmin, xmax, clamp(Math.floor(iw / (S * 4)), 2, 7)), tfx = logX ? function (v) { return format(v, fx, v >= 10000); } : tickFormat(tx, fx);
    var iy = r.y + titleH, ih = Math.max(10, r.h - titleH - tickS * 3.1);
    G.text(data.columns[map.y], r.x, r.y, { role: 'value', size: tickS, color: T.muted, max: r.w * 0.6, name: 'Axis title' });
    var ys = vGrid(env, ay, ix, iw, iy, ih), xs = (logX ? scale.log : scale.linear)(tx.min, tx.max, ix, ix + iw);
    tx.ticks.forEach(function (v) { var x = xs(v); G.line(x, iy, x, iy + ih, v === 0 ? T.axis : T.grid, Math.max(1, env.k * 1.5), { name: 'Gridline' }); G.text(tfx(v), x, iy + ih + tickS * 0.35, { size: tickS, color: T.muted, align: 'center', opt: true, name: 'Axis label' }); });
    G.text(data.columns[map.x], ix + iw, iy + ih + tickS * 1.75, { role: 'value', size: tickS, color: T.muted, align: 'right', max: iw, name: 'Axis title' });
    var hl = highlightOf(o), hit = hl.any && pts.some(function (p) { return hl.has(p.label); }), zmax = Math.max.apply(null, pts.map(function (p) { return p.z || 0; })) || 1;
    var rmax = Math.max(S * 0.3, Math.min(iw, ih) * 0.085), rad = function (p) { return bubble && p.z != null ? Math.max(S * 0.1, Math.sqrt(p.z / zmax) * rmax) : Math.max(3.5, S * (pts.length > 80 ? 0.17 : 0.27)); };
    pts.sort(function (a, b) { return rad(b) - rad(a); });
    if (o.trend && pts.length > 2) {
      var n = pts.length, mx = sum(xs0) / n, my = sum(ys0) / n, sxy = 0, sxx = 0, syy = 0;
      pts.forEach(function (p) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) * (p.x - mx); syy += (p.y - my) * (p.y - my); });
      if (sxx > 0) {
        var b = sxy / sxx, a = my - b * mx, x1 = tx.min, x2 = tx.max, lim = function (x) { return a + b * x; };
        if (b !== 0) { var xa = (ay.tk.min - a) / b, xb = (ay.tk.max - a) / b; x1 = Math.max(x1, Math.min(xa, xb)); x2 = Math.min(x2, Math.max(xa, xb)); }
        if (x2 > x1 && !logX && !logY) { G.line(xs(x1), ys(lim(x1)), xs(x2), ys(lim(x2)), T.ink, Math.max(1.5, S * 0.06), { dash: [S * 0.25, S * 0.18], name: 'Trend line' }); G.text('Trend', xs(x2) - S * 0.2, ys(lim(x2)) - S * 0.3, { size: tickS, role: 'value', align: 'right', base: 'bottom', opt: true, name: 'Trend label' }); }
        G.info.trend = { slope: b, intercept: a, r2: syy > 0 ? sxy * sxy / (sxx * syy) : 1 };
      }
    }
    var where = {};
    pts.forEach(function (p) {
      var c = hit ? (hl.has(p.label) ? T.accent : T.neutral) : T.palette[0], px = xs(p.x), py = ys(p.y), rr = rad(p);
      G.dot(px, py, rr, c, { stroke: T.card, sw: Math.max(1, S * 0.03), opacity: bubble || pts.length > 40 ? 0.78 : 1, name: p.label || 'Point' });
      where[p.label] = { x: px, y: py }; p.px = px; p.py = py; p.r = rr;
      G.reserve({ x0: px - rr, x1: px + rr, y0: py - rr, y1: py + rr });
    });
    if (pts[0].label && (pts.length <= 16 || hit)) pts.forEach(function (p) {
      if (hit && !hl.has(p.label) && pts.length > 16) return;
      var lo2 = { size: S * 0.68, color: hit && hl.has(p.label) ? T.accentInk : T.ink, role: hit && hl.has(p.label) ? 'value' : 'body', max: iw * 0.3, opt: true, gap: S * 0.08, name: 'Point label' }, d = p.r + S * 0.22;
      if (p.px + d + G.width(p.label, lo2) > ix + iw + S * 0.5) lo2.flip = true;
      (!lo2.flip && G.text(p.label, p.px + d, p.py, Object.assign({ base: 'middle' }, lo2))) || G.text(p.label, p.px - d, p.py, Object.assign({ base: 'middle', align: 'right' }, lo2)) ||
        G.text(p.label, p.px, p.py - d, Object.assign({ base: 'bottom', align: 'center' }, lo2)) || G.text(p.label, p.px, p.py + d, Object.assign({ align: 'center' }, lo2));
    });
    annotate(env, { v: ys, horizontal: false, plot: { x: ix, y: iy, w: iw, h: ih }, point: function (c) { return where[String(c)]; } });
  }
  R.scatter = function (env) { scatter(env, false); };
  R.bubble = function (env) { scatter(env, true); };
  R.histogram = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, col = P.map.series[0] != null ? P.map.series[0] : P.map.x;
    var vals = [];
    if (col >= 0) P.rows.forEach(function (row) { var d = numberOf(row[col]); if (d) vals.push(d.v); });
    if (vals.length < 2) return emptyNote(env, 'A histogram needs one column with several numbers.');
    vals.sort(function (a, b) { return a - b; });
    var n = vals.length, min = vals[0], max = vals[n - 1], q = function (p) { var i = (n - 1) * p, a = Math.floor(i); return vals[a] + (vals[Math.min(n - 1, a + 1)] - vals[a]) * (i - a); };
    if (max === min) max = min + 1;
    var iqr = q(0.75) - q(0.25), want = typeof o.bins === 'number' ? clamp(Math.round(o.bins), 2, 60) : clamp(iqr > 0 ? Math.ceil((max - min) / (2 * iqr / Math.cbrt(n))) : Math.ceil(Math.log2(n)) + 1, 5, 24);
    var step = niceStep((max - min) / want), start = Math.floor(min / step + 1e-9) * step, bins = [];
    for (var b = start; b <= max && bins.length < 80; b += step) bins.push({ x0: parseFloat(b.toPrecision(12)), x1: parseFloat((b + step).toPrecision(12)), count: 0 });
    vals.forEach(function (v) { var i = Math.min(bins.length - 1, Math.max(0, Math.floor((v - start) / step + 1e-9))); bins[i].count++; });
    G.info.bins = bins;
    var f = fmtOf(P.A[col], o), cmax = Math.max.apply(null, bins.map(function (x) { return x.count; })), tickS = S * 0.72;
    var ay = vAxis(env, 0, cmax, { pre: '', suf: '' }, r.h - S * 3), ix = r.x + ay.left, iw = Math.max(10, r.w - ay.left - S * 0.4), iy = r.y + S * 1.7, ih = Math.max(10, r.h - S * 1.7 - tickS * 3.1);
    var ys = vGrid(env, ay, ix, iw, iy, ih), bw = iw / bins.length, gap = Math.min(2, bw * 0.08), tfx = tickFormat({ min: start, max: start + step * bins.length, step: step }, f);
    bins.forEach(function (x, i) {
      if (x.count) { G.rect(ix + bw * i + gap / 2, ys(x.count), bw - gap, ys(0) - ys(x.count), T.palette[0], { name: tfx(x.x0) + ' to ' + tfx(x.x1) }); G.info.bars.push({ i: G.layers.length - 1, v: x.count }); }
      if (o.labels !== 'off' && x.count && bins.length <= 24) G.text(String(x.count), ix + bw * (i + 0.5), ys(x.count) - tickS * 0.2, { role: 'value', size: tickS, align: 'center', base: 'bottom', opt: true, name: 'Count' });
    });
    for (var e = 0; e <= bins.length; e++) G.text(tfx(start + step * e), ix + bw * e, iy + ih + tickS * 0.35, { size: tickS, color: T.muted, align: 'center', opt: true, name: 'Axis label' });
    G.text(env.chart.data.columns[col] || 'Value', ix + iw, iy + ih + tickS * 1.75, { role: 'value', size: tickS, color: T.muted, align: 'right', max: iw, name: 'Axis title' });
    G.text('Count', r.x, r.y, { role: 'value', size: tickS, color: T.muted, name: 'Axis title' });
    G.info.scale = { k: ih / (ay.tk.max - ay.tk.min), zero: ys(0), axis: 'y' };
  };

  /* ---------- 5. combo, waterfall, funnel, radar, gauge, lollipop, slope, bullet ---------- */
  R.combo = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, n = P.cats.length, m = P.series.length;
    if (m < 2 || !n) return emptyNote(env, 'A combo chart needs two columns of numbers: one for the columns and one for the line.');
    var names = P.series.map(function (x) { return x.name; }), li = names.indexOf(String(o.line));
    if (li < 0) li = m - 1;
    var barsS = P.series.filter(function (x, i) { return i !== li; }), line = P.series[li], mb = barsS.length, tickS = S * 0.72;
    var cols = barsS.map(function (x, i) { return mb === 1 ? T.neutral : cycle(T, i + 1); }), lc = T.accent, lci = ensure(lc, T.card, 4.5);
    var bhi = 0, blo = 0, lhi = -Infinity, llo = Infinity;
    barsS.forEach(function (x) { x.values.forEach(function (v) { if (v != null) { bhi = Math.max(bhi, v); blo = Math.min(blo, v); } }); });
    line.values.forEach(function (v) { if (v != null) { lhi = Math.max(lhi, v); llo = Math.min(llo, v); } });
    if (!isFinite(lhi)) { lhi = 1; llo = 0; }
    if (llo > 0) llo = 0;
    if (lhi < 0) lhi = 0;
    /* both axes labelled, in words and in the colour of what they measure */
    var kx = r.x, ky = r.y, key = S * 0.74;
    barsS.forEach(function (x, i) { G.rect(kx, ky + key * 0.25, key * 0.75, key * 0.75, cols[i], { r: T.radius ? key * 0.18 : 0, name: 'Legend key' }); var t = G.text(x.name + (i === mb - 1 ? ' (left axis)' : ''), kx + key * 1.1, ky, { role: 'value', size: key, max: r.w * 0.5, name: 'Axis title' }); kx = t.x1 + key * 1.2; });
    var rt = G.text(line.name + ' (right axis)', r.x + r.w, ky, { role: 'value', size: key, color: lci, align: 'right', max: r.w * 0.45, name: 'Axis title' });
    if (rt) G.rect(rt.x0 - key * 1.5, ky + key * 0.52, key * 0.95, Math.max(3, key * 0.2), lc, { name: 'Legend key' });
    var top = key * 2.5, H = r.h - top - S * 2, al = vAxis(env, blo, bhi || 1, P.series[li === 0 ? 1 : 0].f, H), ar = vAxis(env, llo, lhi, line.f, H);
    /* the same number of gridlines on both sides, so one set of lines serves both */
    var cnt = al.tk.ticks.length - 1, rs = niceStep((lhi - llo) / cnt), rlo = Math.floor(llo / rs + 1e-9) * rs;
    while (rlo + rs * cnt < lhi - 1e-9) { rs = niceStep(rs * 1.01); rlo = Math.floor(llo / rs + 1e-9) * rs; }
    var rtk = { min: rlo, max: rlo + rs * cnt, step: rs, ticks: al.tk.ticks.map(function (v, i) { return parseFloat((rlo + rs * i).toPrecision(12)); }) };
    ar = { tk: rtk, tf: tickFormat(rtk, line.f), left: Math.max.apply(null, rtk.ticks.map(function (v) { return G.width(tickFormat(rtk, line.f)(v), { size: tickS }); })) + S * 0.5 };
    var labels = catLabels(P), ix = r.x + al.left, iw = Math.max(10, r.w - al.left - ar.left), bandW = iw / n, plan = xPlan(G, labels, bandW, S, { thinOnly: !!P.times });
    var iy = r.y + top, ih = Math.max(10, r.h - top - plan.h - S * 0.3), ysl = vGrid(env, al, ix, iw, iy, ih), ysr = vGrid(env, ar, ix, iw, iy, ih, true, lci);
    var gw = bandW * 0.7, bw = gw / mb, pts = [], seg = [], i;
    for (i = 0; i < n; i++) {
      barsS.forEach(function (x, s) { var v = x.values[i]; if (v == null) return; G.rect(ix + bandW * i + (bandW - gw) / 2 + s * bw, ysl(Math.max(0, v)), Math.max(1, bw - (mb > 1 ? 2 : 0)), Math.abs(ysl(v) - ysl(0)), cols[s], { r: Math.min(T.radius * env.k, bw / 2), name: x.name + ', ' + labels[i] }); G.info.bars.push({ i: G.layers.length - 1, v: v, cat: P.cats[i], series: x.name }); });
      if (line.values[i] != null) seg.push([ix + bandW * (i + 0.5), ysr(line.values[i])]); else if (seg.length) { pts.push(seg); seg = []; }
    }
    if (seg.length) pts.push(seg);
    var lw = Math.max(2.5, S * 0.11);
    pts.forEach(function (sg) { if (sg.length > 1) G.poly(o.smooth ? smoothPts(sg) : sg, { stroke: lc, sw: lw, name: line.name }); if (n <= 16) sg.forEach(function (p) { G.dot(p[0], p[1], lw * 1.3, lc, { stroke: T.card, sw: Math.max(1, lw * 0.4), name: line.name + ' point' }); }); });
    xDraw(G, plan, labels, function (ci) { return ix + bandW * (ci + 0.5); }, iy + ih + S * 0.15, T, plan.mode === 'wrap' ? bandW - 4 : [r.x, r.x + r.w]);
    G.info.scale = { k: ih / (al.tk.max - al.tk.min), zero: ysl(0), axis: 'y' };
    annotate(env, { v: ysl, horizontal: false, plot: { x: ix, y: iy, w: iw, h: ih } });
  };
  R.waterfall = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot;
    if (!P.series.length || !P.cats.length) return emptyNote(env, 'A waterfall needs a column of changes: gains above zero, losses below.');
    var steps = [], run = 0, f = P.f;
    P.cats.forEach(function (c, i) { var v = P.series[0].values[i] || 0; steps.push({ name: c, from: run, to: run + v, v: v, total: i === 0 && o.start === true }); run += v; });
    if (o.total !== false) steps.push({ name: typeof o.totalLabel === 'string' && o.totalLabel ? o.totalLabel : 'Total', from: 0, to: run, v: run, total: true });
    var lo = 0, hi = 0;
    steps.forEach(function (s) { lo = Math.min(lo, s.from, s.to); hi = Math.max(hi, s.from, s.to); });
    var n = steps.length, labels = steps.map(function (s) { return s.name; }), size = S * 0.8, ay = vAxis(env, lo, hi || 1, f, r.h - S * 3);
    var ix = r.x + ay.left, iw = Math.max(10, r.w - ay.left), bandW = iw / n, plan = xPlan(G, labels, bandW, S), iy = r.y + size * 1.6, ih = Math.max(10, r.h - size * 1.6 - plan.h - S * 0.3 - (lo < 0 ? size * 1.3 : 0));
    var ys = vGrid(env, ay, ix, iw, iy, ih), bw = bandW * 0.66, totalC = mix(T.ink, T.card, 0.2);
    steps.forEach(function (s, i) {
      var x = ix + bandW * i + (bandW - bw) / 2, c = s.total ? totalC : s.v >= 0 ? T.up : T.down, y0 = ys(Math.max(s.from, s.to)), h = Math.abs(ys(s.from) - ys(s.to));
      G.rect(x, y0, bw, Math.max(1, h), c, { r: Math.min(T.radius * env.k * 0.6, bw / 2, h / 2), name: s.name });
      G.info.bars.push({ i: G.layers.length - 1, v: s.to - s.from, cat: s.name });
      if (i < n - 1) G.line(x + bw, ys(s.to), x + bandW, ys(s.to), T.axis, Math.max(1, env.k * 1.5), { name: 'Connector' });
      if (o.labels !== 'off') {
        var txt = s.total ? format(s.v, f, Math.abs(s.v) >= 100000) : (s.v > 0 ? '+' : '') + format(s.v, f, Math.abs(s.v) >= 100000), up = s.total ? s.v >= 0 : s.v >= 0;
        G.text(txt, x + bw / 2, up ? y0 - size * 0.2 : y0 + h + size * 0.2, { role: 'value', size: size, align: 'center', base: up ? 'bottom' : 'top', color: s.total ? T.ink : ensure(c, T.card, 4.5), opt: true, name: 'Value' }) ||
          G.text(format(s.v, f, true), x + bw / 2, up ? y0 - size * 0.2 : y0 + h + size * 0.2, { role: 'value', size: size * 0.85, align: 'center', base: up ? 'bottom' : 'top', color: s.total ? T.ink : ensure(c, T.card, 4.5), opt: true, name: 'Value' });
      }
    });
    xDraw(G, plan, labels, function (ci) { return ix + bandW * (ci + 0.5); }, iy + ih + S * 0.15 + (lo < 0 ? size * 1.3 : 0), T, plan.mode === 'wrap' ? bandW - 4 : [r.x, r.x + r.w]);
    G.info.scale = { k: ih / (ay.tk.max - ay.tk.min), zero: ys(0), axis: 'y' };
    G.info.total = run;
  };
  R.funnel = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot;
    var items = [];
    if (P.series.length) P.cats.forEach(function (c, i) { var v = P.series[0].values[i]; if (v != null && v >= 0) items.push({ name: c, v: v }); });
    if (!items.length) return emptyNote(env, 'A funnel needs a column of numbers, one per stage.');
    var n = items.length, max = Math.max.apply(null, items.map(function (x) { return x.v; })) || 1, band = r.h / n, u = clamp(band * 0.42, S * 0.6, S * 1.1), f = P.f;
    var colL = Math.min(Math.max.apply(null, items.map(function (x) { return G.width(x.name, { role: 'label', size: u * 0.9 }); })), r.w * 0.3) + u * 0.7, colR = G.width('100%', { size: u * 0.85 }) + u * 0.7;
    var ix = r.x + colL, iw = Math.max(10, r.w - colL - colR), th = band * 0.74, k = iw / max, hl = highlightOf(o), hit = hl.any && items.some(function (x) { return hl.has(x.name); });
    items.forEach(function (x, i) {
      var w = x.v * k, bx = ix + (iw - w) / 2, by = r.y + band * i + (band - th) / 2, c = hit ? (hl.has(x.name) ? T.accent : T.neutral) : mix(T.palette[0], T.card, Math.min(0.55, i * (0.55 / Math.max(1, n - 1))));
      if (i < n - 1) { var w2 = items[i + 1].v * k, nx = ix + (iw - w2) / 2; G.poly([[bx, by + th], [bx + w, by + th], [nx + w2, by + band], [nx, by + band], [bx, by + th]], { fill: mix(T.palette[0], T.card, 0.82), name: 'Step' }); }
      G.rect(bx, by, Math.max(1, w), th, c, { r: Math.min(T.radius * env.k, th / 2), name: x.name });
      G.info.bars.push({ i: G.layers.length - 1, v: x.v, cat: x.name });
      G.text(x.name, ix - u * 0.7, by + th / 2, { role: 'label', size: u * 0.9, align: 'right', base: 'middle', max: colL - u * 0.7, lines: band > u * 2.6 ? 2 : 1, lh: 1.1, name: 'Stage' });
      var txt = format(x.v, f, x.v >= 100000), vs = Math.min(u, th * 0.6);
      if (G.width(txt, { role: 'value', size: vs }) <= w - vs) G.text(txt, ix + iw / 2, by + th / 2, { role: 'value', size: vs, align: 'center', base: 'middle', on: c, color: readable(c, T.ink, '#FFFFFF'), name: 'Value' });
      else G.text(txt, bx + w + vs * 0.4, by + th / 2, { role: 'value', size: vs, base: 'middle', on: T.card, opt: true, name: 'Value' });
      if (i) G.text(format(items[0].v ? x.v / items[0].v * 100 : 0, { suf: '%', dec: 0 }), r.x + r.w, by + th / 2, { size: u * 0.85, color: T.muted, align: 'right', base: 'middle', name: 'Share of first stage' });
    });
    G.info.scale = { k: k, zero: 0, axis: 'x', centred: true };
  };
  R.radar = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, n = P.cats.length, m = Math.min(P.series.length, 6);
    if (n < 3 || !m) return emptyNote(env, 'A radar chart needs at least three rows and one column of numbers.');
    if (n > 12) { env.notes.push('Only the first 12 rows fit around a radar chart.'); n = 12; }
    var names = P.series.slice(0, m).map(function (x) { return x.name; }), colors = m === 1 ? [T.palette[0]] : colorsFor(names, T, o, false), y0 = r.y;
    if (m > 1) y0 += legend(G, names.map(function (nm, i) { return { name: nm, color: colors[i] }; }), r.x, r.y, r.w, S, T);
    var hi = 0;
    P.series.slice(0, m).forEach(function (x) { x.values.slice(0, n).forEach(function (v) { hi = Math.max(hi, v || 0); }); });
    var tk = ticks(0, hi || 1, 4), size = S * 0.74, labW = Math.min(Math.max.apply(null, P.cats.slice(0, n).map(function (c) { return G.width(c, { size: size }); })), r.w * 0.24);
    var H = r.y + r.h - y0, Rr = Math.max(10, Math.min((r.w - 2 * labW - S) / 2, (H - size * 3.2) / 2)), cx = r.x + r.w / 2, cy = y0 + H / 2;
    var at = function (i, v) { var a = Math.PI * 2 * i / n - Math.PI / 2, d = Rr * v / tk.max; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d]; }, i;
    tk.ticks.slice(1).forEach(function (v) { var ring = []; for (i = 0; i <= n; i++) ring.push(at(i % n, v)); G.poly(ring, { stroke: T.grid, sw: Math.max(1, env.k * 1.5), cap: 'butt', name: 'Ring' }); });
    for (i = 0; i < n; i++) { var e = at(i, tk.max); G.line(cx, cy, e[0], e[1], T.grid, Math.max(1, env.k * 1.5), { name: 'Spoke' }); }
    P.series.slice(0, m).forEach(function (x, s) {
      var pts = []; for (i = 0; i <= n; i++) pts.push(at(i % n, Math.max(0, x.values[i % n] || 0)));
      G.poly(pts, { fill: colors[s], opacity: 0.16, name: x.name + ' area' });
      G.poly(pts, { stroke: colors[s], sw: Math.max(2, S * 0.09), name: x.name });
      if (n <= 8) pts.slice(0, n).forEach(function (p) { G.dot(p[0], p[1], Math.max(2.5, S * 0.11), colors[s], { stroke: T.card, sw: 1, name: x.name + ' point' }); });
    });
    for (i = 0; i < n; i++) { var a = Math.PI * 2 * i / n - Math.PI / 2, lx = cx + Math.cos(a) * (Rr + size * 0.7), ly = cy + Math.sin(a) * (Rr + size * 0.7), c = Math.cos(a); G.text(P.cats[i], lx, ly, { size: size, role: 'value', align: Math.abs(c) < 0.2 ? 'center' : c > 0 ? 'left' : 'right', base: Math.sin(a) < -0.5 ? 'bottom' : Math.sin(a) > 0.5 ? 'top' : 'middle', max: labW + S * 2, name: 'Axis label' }); }
    var tf = tickFormat(tk, P.f);
    tk.ticks.slice(1).forEach(function (v) { G.text(tf(v), cx + size * 0.25, cy - Rr * v / tk.max, { size: size * 0.82, color: T.muted, base: 'middle', opt: true, name: 'Ring value' }); });
  };
  R.gauge = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, items = [];
    if (P.series.length) P.cats.forEach(function (c, i) { var v = P.series[0].values[i]; if (v != null) items.push({ name: P.map.category >= 0 ? c : P.series[0].name, v: v, row: i }); });
    if (!items.length) return emptyNote(env, 'A gauge needs one number, and the most it can be.');
    if (items.length > 8) { env.notes.push('Only the first 8 rows are drawn as gauges.'); items = items.slice(0, 8); }
    var f = P.f, tcol = P.map.target, ring = o.shape === 'ring', hl = highlightOf(o);
    items.forEach(function (x) { var t = tcol >= 0 && P.rows[x.row] ? numberOf(P.rows[x.row][tcol]) : null; x.max = t && t.v > 0 ? t.v : typeof o.max === 'number' && o.max > 0 ? o.max : f.suf === '%' || (x.v >= 0 && x.v <= 100) ? 100 : ticks(0, x.v, 4).max; });
    var n = items.length, cols = clamp(Math.round(Math.sqrt(n * r.w / (r.h * (ring ? 1 : 1.5)))), 1, n), rowsN = Math.ceil(n / cols), cw = r.w / cols, ch = r.h / rowsN;
    items.forEach(function (x, i) {
      var cx = r.x + cw * ((i % cols) + 0.5), top = r.y + ch * Math.floor(i / cols), lab = Math.min(S * 0.85, ch * 0.11), pad = lab * 0.6;
      var Rr = ring ? Math.min(cw / 2 - pad, (ch - lab * 1.8 - pad) / 2) : Math.min(cw / 2 - pad, ch - lab * 1.9 - pad * 2), th = Rr * 0.24, cy = ring ? top + pad + Rr : top + pad + Rr;
      var share = clamp(x.v / x.max, 0, 1), a0 = ring ? 0 : -Math.PI / 2, span = ring ? Math.PI * 2 : Math.PI, c = hl.any && !hl.has(x.name) ? T.neutral : (n > 1 && !hl.any ? T.palette[0] : T.accent);
      G.wedge(cx, cy, Rr - th, Rr, a0, a0 + span, mix(T.card, T.ink, 0.1), { name: 'Track' });
      if (share > 0.004) G.wedge(cx, cy, Rr - th, Rr, a0, a0 + span * share, c, { name: x.name });
      G.info.angles = (G.info.angles || []).concat([span * share * 180 / Math.PI]);
      var big = format(x.v, f, Math.abs(x.v) >= 100000), bs = Math.min(Rr * 0.44, (Rr - th) * 1.5 / Math.max(0.5, G.width(big, { role: 'title', size: 100 }) / 100));
      G.text(big, cx, ring ? cy - bs * 0.1 : cy - bs * 0.42, { role: 'title', size: bs, align: 'center', base: 'middle', name: 'Value' });
      if (f.suf !== '%' || x.max !== 100) G.text('of ' + format(x.max, f, x.max >= 100000), cx, ring ? cy + bs * 0.62 : cy - bs * 0.42 + bs * 0.72, { size: Math.max(7, Math.min(lab * 0.85, bs * 0.4)), color: T.muted, align: 'center', base: 'middle', opt: true, name: 'Out of' });
      G.text(x.name, cx, (ring ? cy + Rr : cy) + pad, { role: 'label', size: lab, align: 'center', max: cw - pad * 2, lines: 2, lh: 1.1, name: 'Label' });
    });
  };
  R.lollipop = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, n = P.cats.length, m = P.series.length;
    if (!n || !m) return emptyNote(env, 'Add a column of numbers to draw the dots.');
    var stem = o.stem !== false && m === 1, labels = catLabels(P), names = P.series.map(function (x) { return x.name; }), single = m === 1;
    var colors = single ? colorsFor(P.cats, T, o, true) : colorsFor(names, T, o, false), hl = highlightOf(o), y0 = r.y, f = P.f;
    if (!single) y0 += legend(G, names.map(function (nm, i) { return { name: nm, color: colors[i] }; }), r.x, r.y, r.w, S, T);
    var lo = Infinity, hi = -Infinity;
    P.series.forEach(function (x) { x.values.forEach(function (v) { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) return emptyNote(env, 'There are no numbers to draw yet.');
    if (stem) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    var axisH = stem ? 0 : S * 1.4, H = r.y + r.h - y0 - axisH, band = H / n, u = clamp(band * 0.5, S * 0.6, S * 1.1), ls = Math.min(u * 0.9, band * 0.72);
    var col = Math.min(Math.max.apply(null, labels.map(function (l) { return G.width(l, { role: 'label', size: ls }); })), r.w * 0.34) + u * 0.6, rr = clamp(band * 0.22, 3, u * 0.36);
    var out = single && o.labels !== 'off' ? Math.max.apply(null, P.series[0].values.map(function (v) { return G.width(format(v, f, Math.abs(v || 0) >= 100000), { role: 'value', size: ls }); })) + rr + u * 0.5 : rr + 2;
    var x0 = r.x + col, avail = Math.max(10, r.w - col - out - (lo < 0 ? out : rr)), tk = stem ? null : ticks(lo, hi, clamp(Math.floor(avail / (S * 4.2)), 2, 6));
    if (tk) { lo = tk.min; hi = tk.max; }
    if (hi === lo) hi = lo + 1;
    var k = avail / (hi - lo), X = function (v) { return x0 + (lo < 0 ? out : rr) + (v - lo) * k; };
    if (tk) { var tf = tickFormat(tk, f); tk.ticks.forEach(function (v) { G.line(X(v), y0, X(v), y0 + H, T.grid, Math.max(1, env.k * 1.5), { name: 'Gridline' }); G.text(tf(v), X(v), y0 + H + S * 0.3, { size: S * 0.72, color: T.muted, align: 'center', opt: true, name: 'Axis label' }); }); }
    else if (lo < 0) G.line(X(0), y0, X(0), y0 + H, T.axis, Math.max(1, env.k * 1.5), { name: 'Zero line' });
    for (var i = 0; i < n; i++) {
      var cy = y0 + band * (i + 0.5), vs = P.series.map(function (x) { return x.values[i]; }).filter(function (v) { return v != null; });
      G.text(labels[i], x0 - u * 0.6, cy, { role: 'label', size: ls, align: 'right', base: 'middle', max: col - u * 0.6, lines: band > ls * 2.5 ? 2 : 1, lh: 1.1, name: 'Category' });
      if (!vs.length) continue;
      if (stem) { G.rect(X(0), cy - Math.max(1, rr * 0.22), (P.series[0].values[i]) * k, Math.max(2, rr * 0.44), colors[i], { name: labels[i] + ' stem' }); G.info.bars.push({ i: G.layers.length - 1, v: P.series[0].values[i], cat: P.cats[i] }); }
      else if (!single && vs.length > 1) G.rect(X(Math.min.apply(null, vs)), cy - Math.max(1.5, rr * 0.3), (Math.max.apply(null, vs) - Math.min.apply(null, vs)) * k, Math.max(3, rr * 0.6), mix(T.card, T.ink, 0.16), { name: labels[i] + ' range' });
      P.series.forEach(function (x, s) { if (x.values[i] != null) G.dot(X(x.values[i]), cy, rr, single ? colors[i] : colors[s], { stroke: T.card, sw: Math.max(1, rr * 0.18), name: single ? labels[i] : x.name + ', ' + labels[i] }); });
      if (single && o.labels !== 'off') { var v = P.series[0].values[i]; G.text(format(v, f, Math.abs(v) >= 100000), X(v) + (v < 0 ? -1 : 1) * (rr + u * 0.35), cy, { role: 'value', size: ls, align: v < 0 ? 'right' : 'left', base: 'middle', color: hl.any && hl.has(P.cats[i]) ? T.accentInk : T.ink, name: 'Value' }); }
    }
    if (stem) G.info.scale = { k: k, zero: X(0), axis: 'x' };
  };
  R.slope = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, n = P.cats.length;
    if (P.series.length < 2 || !n) return emptyNote(env, 'A slope chart needs two columns of numbers: before and after.');
    var A = P.series[0], B = P.series[P.series.length - 1], f = P.f, size = S * 0.78, hl = highlightOf(o), hit = hl.any && P.cats.some(function (c) { return hl.has(c); });
    var rows = [];
    P.cats.forEach(function (c, i) { if (A.values[i] != null && B.values[i] != null) rows.push({ name: c, a: A.values[i], b: B.values[i] }); });
    if (!rows.length) return emptyNote(env, 'There are no rows with both numbers yet.');
    if (rows.length > 14) { env.notes.push('Only the first 14 rows are drawn.'); rows = rows.slice(0, 14); }
    var all = rows.map(function (x) { return x.a; }).concat(rows.map(function (x) { return x.b; })), lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (hi === lo) hi = lo + 1;
    var txtL = function (x) { return x.name + '  ' + format(x.a, f, Math.abs(x.a) >= 100000); }, txtR = function (x) { return format(x.b, f, Math.abs(x.b) >= 100000) + '  ' + x.name; };
    var maxSide = r.w * 0.36, wl = Math.min(maxSide, Math.max.apply(null, rows.map(function (x) { return G.width(txtL(x), { role: 'value', size: size }); }))), wr = Math.min(maxSide, Math.max.apply(null, rows.map(function (x) { return G.width(txtR(x), { role: 'value', size: size }); })));
    var x1 = r.x + wl + S * 0.6, x2 = r.x + r.w - wr - S * 0.6, top = r.y + S * 1.9, bot = r.y + r.h - size, ys = scale.linear(lo, hi, bot, top);
    G.text(A.name, x1, r.y, { role: 'label', size: S * 0.82, align: 'right', max: wl + S * 0.6, name: 'Column title' });
    G.text(B.name, x2, r.y, { role: 'label', size: S * 0.82, max: wr + S * 0.6, name: 'Column title' });
    G.line(x1, top - size * 0.6, x1, bot + size * 0.6, T.grid, Math.max(1, env.k * 1.5), { name: 'Axis' });
    G.line(x2, top - size * 0.6, x2, bot + size * 0.6, T.grid, Math.max(1, env.k * 1.5), { name: 'Axis' });
    var lw = Math.max(2, S * 0.09), place = function (key) {
      var list = rows.slice().sort(function (p, q) { return ys(p[key]) - ys(q[key]); }), gap = size * 1.22, i;
      list.forEach(function (x, j) { x['y' + key] = Math.max(ys(x[key]), j ? list[j - 1]['y' + key] + gap : top - size); });
      for (i = list.length - 1; i >= 0; i--) list[i]['y' + key] = Math.min(list[i]['y' + key], i === list.length - 1 ? bot + size * 0.5 : list[i + 1]['y' + key] - gap);
    };
    place('a'); place('b');
    rows.slice().sort(function (p, q) { return (hl.has(p.name) ? 1 : 0) - (hl.has(q.name) ? 1 : 0); }).forEach(function (x) {
      var hot = hit && hl.has(x.name), c = hit ? (hot ? T.accent : T.neutral) : T.palette[0], tc = hit ? (hot ? T.accentInk : T.muted) : T.ink;
      G.poly([[x1, ys(x.a)], [x2, ys(x.b)]], { stroke: c, sw: hot ? lw * 1.4 : lw, name: x.name });
      G.dot(x1, ys(x.a), lw * 1.5, c, { stroke: T.card, sw: 1, name: x.name + ' start' }); G.dot(x2, ys(x.b), lw * 1.5, c, { stroke: T.card, sw: 1, name: x.name + ' end' });
      G.text(txtL(x), x1 - S * 0.5, x.ya, { role: hot || !hit ? 'value' : 'body', size: size, color: tc, align: 'right', base: 'middle', max: wl, name: 'Start label' });
      G.text(txtR(x), x2 + S * 0.5, x.yb, { role: hot || !hit ? 'value' : 'body', size: size, color: tc, base: 'middle', max: wr, name: 'End label' });
    });
  };
  R.bullet = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, n = P.cats.length;
    if (!P.series.length || !n) return emptyNote(env, 'A bullet bar needs a value and a target for each row.');
    var f = P.f, tc = P.map.target, labels = catLabels(P), hl = highlightOf(o), rows = [];
    var tOf = {};
    if (tc >= 0) P.rows.forEach(function (row, ri) { var kk = P.map.category >= 0 ? (cell(row[P.map.category]) || '(blank)') : String(ri + 1), d = numberOf(row[tc]); if (d && tOf[kk] == null) tOf[kk] = d.v; });
    P.cats.forEach(function (c, i) { var v = P.series[0].values[i]; if (v != null) rows.push({ name: labels[i], key: c, v: v, t: tOf[c] == null ? null : tOf[c] }); });
    if (!rows.length) return emptyNote(env, 'There are no numbers to draw yet.');
    n = rows.length;
    var band = r.h / n, u = clamp(band * 0.42, S * 0.6, S * 1.1), ls = Math.min(u * 0.9, band * 0.6), hi = Math.max.apply(null, rows.map(function (x) { return Math.max(x.v, x.t || 0); })), max = ticks(0, hi * 1.02 || 1, 4).max;
    var col = Math.min(Math.max.apply(null, rows.map(function (x) { return G.width(x.name, { role: 'label', size: ls }); })), r.w * 0.32) + u * 0.6;
    var txt = function (x) { return format(x.v, f, x.v >= 100000) + (x.t != null ? ' / ' + format(x.t, f, x.t >= 100000) : ''); }, out = Math.max.apply(null, rows.map(function (x) { return G.width(txt(x), { role: 'value', size: ls }); })) + u * 0.6;
    var x0 = r.x + col, avail = Math.max(10, r.w - col - out), k = avail / max, th = clamp(band * 0.5, 4, u * 1.6);
    rows.forEach(function (x, i) {
      var cy = r.y + band * (i + 0.5), c = hl.any ? (hl.has(x.key) ? T.accent : T.neutral) : T.palette[0];
      G.text(x.name, x0 - u * 0.6, cy, { role: 'label', size: ls, align: 'right', base: 'middle', max: col - u * 0.6, lines: band > ls * 2.5 ? 2 : 1, lh: 1.1, name: 'Category' });
      G.rect(x0, cy - th / 2, avail, th, mix(T.card, T.ink, 0.09), { r: Math.min(T.radius * env.k * 0.5, th / 2), name: 'Track' });
      G.rect(x0, cy - th * 0.24, Math.max(0, x.v) * k, th * 0.48, c, { name: x.name });
      G.info.bars.push({ i: G.layers.length - 1, v: Math.max(0, x.v), cat: x.key });
      if (x.t != null) G.rect(x0 + x.t * k - Math.max(1.5, u * 0.07), cy - th * 0.42, Math.max(3, u * 0.14), th * 0.84, T.ink, { name: 'Target' });
      var vb = G.text(format(x.v, f, x.v >= 100000), x0 + avail + u * 0.5, cy, { role: 'value', size: ls, base: 'middle', name: 'Value' });
      if (x.t != null && vb) G.text(' / ' + format(x.t, f, x.t >= 100000), vb.x1 + ls * 0.12, cy, { size: ls, color: T.muted, base: 'middle', name: 'Target value' });
    });
    G.info.scale = { k: k, zero: x0, axis: 'x' };
  };

  /* ---------- 6. heatmap, treemap, pictogram, stat tiles, sparklines, table ---------- */
  function ramp(T, lo, hi) {
    var div = lo < 0 && hi > 0, m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    return function (v) {
      if (v == null) return mix(T.card, T.ink, 0.04);
      if (div) return v < 0 ? mix(T.div[1], T.div[0], Math.min(1, -v / m)) : mix(T.div[1], T.div[2], Math.min(1, v / m));
      return mix(T.seq[0], T.seq[1], hi === lo ? 0.6 : (v - lo) / (hi - lo));
    };
  }
  R.heatmap = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, n = P.cats.length, m = P.series.length;
    if (!n || !m) return emptyNote(env, 'A heatmap needs rows and at least one column of numbers.');
    if (n > 30) { env.notes.push('Only the first 30 rows are drawn.'); n = 30; }
    if (n * m > 190) { n = Math.max(1, Math.floor(190 / m)); env.notes.push('Only the first ' + n + ' rows are drawn.'); }
    var lo = Infinity, hi = -Infinity, f = P.f;
    P.series.forEach(function (x) { x.values.slice(0, n).forEach(function (v) { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) return emptyNote(env, 'There are no numbers to draw yet.');
    var col = ramp(T, lo, hi), size = S * 0.74, labels = catLabels(P).slice(0, n), rowW = Math.min(Math.max.apply(null, labels.map(function (l) { return G.width(l, { role: 'value', size: size }); })), r.w * 0.28) + size * 0.6;
    var cw = (r.w - rowW) / m, headH = P.series.some(function (x) { return G.width(x.name, { size: size }) > cw - 4; }) ? size * 2.5 : size * 1.4, chh = (r.h - headH) / n, gap = Math.max(1, Math.min(3, env.k * 3, cw * 0.06, chh * 0.06));
    var vs = Math.min(size, chh * 0.5, cw * 0.3), showV = o.labels !== 'off' && vs >= 7 && n * m <= 140;
    P.series.forEach(function (x, s) { G.text(x.name, r.x + rowW + cw * (s + 0.5), r.y + headH - size * 0.3, { size: size, role: 'value', color: T.muted, align: 'center', base: 'bottom', max: cw - 4, lines: 2, lh: 1.1, name: 'Column' }); });
    for (var i = 0; i < n; i++) {
      var y = r.y + headH + chh * i;
      G.text(labels[i], r.x + rowW - size * 0.6, y + chh / 2, { size: Math.min(size, chh * 0.8), role: 'value', align: 'right', base: 'middle', max: rowW - size * 0.6, name: 'Row' });
      for (var s = 0; s < m; s++) {
        var v = P.series[s].values[i], c = col(v), x = r.x + rowW + cw * s;
        G.rect(x + gap / 2, y + gap / 2, cw - gap, chh - gap, c, { flat: true, r: Math.min(T.radius * env.k * 0.4, 6), name: labels[i] + ', ' + P.series[s].name });
        if (showV && v != null) { var t = format(v, f, Math.abs(v) >= 10000); if (G.width(t, { size: vs }) <= cw - gap - 4) G.text(t, x + cw / 2, y + chh / 2, { size: vs, align: 'center', base: 'middle', on: c, color: readable(c, T.ink, '#FFFFFF'), free: true, name: 'Value' }); }
      }
    }
    G.info.range = { min: lo, max: hi };
  };
  function squarify(items, x, y, w, h) {
    var total = sum(items.map(function (q) { return q.v; })) || 1, rest = items.slice(), area = w * h / total, out = [];
    while (rest.length) {
      var short = Math.min(w, h), row = [], rowSum = 0, best = Infinity;
      while (rest.length) {
        var s2 = rowSum + rest[0].v * area, side = s2 / short, worst = 0;
        row.concat([rest[0]]).forEach(function (q) { var other = q.v * area / side; worst = Math.max(worst, side / other, other / side); });
        if (worst > best && row.length) break;
        best = worst; row.push(rest.shift()); rowSum = s2;
      }
      var sd = rowSum / short, off = 0;
      row.forEach(function (q) { var len = q.v * area / sd; out.push(w >= h ? { it: q, x: x, y: y + off, w: sd, h: len } : { it: q, x: x + off, y: y, w: len, h: sd }); off += len; });
      if (w >= h) { x += sd; w -= sd; } else { y += sd; h -= sd; }
    }
    return out;
  }
  R.treemap = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, items = [];
    if (P.series.length) P.cats.forEach(function (c, i) { var v = P.series[0].values[i]; if (v > 0) items.push({ name: c, v: v }); });
    if (!items.length) return emptyNote(env, 'A treemap needs a column of numbers above zero.');
    items.sort(function (a, b) { return b.v - a.v; });
    if (items.length > 40) { var rest = items.slice(39); items = items.slice(0, 39); items.push({ name: 'Other', v: sum(rest.map(function (x) { return x.v; })) }); env.notes.push(plural(rest.length, 'small row') + ' are shown together as "Other".'); items.sort(function (a, b) { return b.v - a.v; }); }
    var total = sum(items.map(function (x) { return x.v; })), hl = highlightOf(o), hit = hl.any && items.some(function (x) { return hl.has(x.name); }), f = P.f, gap = Math.max(2, env.k * 4), max = items[0].v;
    squarify(items, r.x, r.y, r.w, r.h).forEach(function (q) {
      var x = q.it, c = hit ? (hl.has(x.name) ? T.accent : T.neutral) : mix(T.seq[0], T.seq[1], Math.pow(x.v / max, 0.6)), w = q.w - gap, h = q.h - gap;
      if (w < 1 || h < 1) return;
      G.rect(q.x + gap / 2, q.y + gap / 2, w, h, c, { r: Math.min(T.radius * env.k * 0.6, w / 4, h / 4), name: x.name });
      G.info.bars.push({ i: G.layers.length - 1, v: x.v, cat: x.name, area: w * h });
      var size = clamp(Math.min(w / 7, h / 3.2), 0, S * 1.1), pad = Math.min(size * 0.6, w * 0.08), ink = readable(c, T.ink, '#FFFFFF');
      if (size < Math.max(7, S * 0.4)) return;
      var nb = G.text(x.name, q.x + gap / 2 + pad, q.y + gap / 2 + pad * 0.8, { role: 'label', size: size, max: w - pad * 2, lines: h > size * 4 ? 2 : 1, lh: 1.1, on: c, color: ink, free: true, name: 'Label' });
      if (nb && h > nb.h + size * 1.5 + pad) G.text(format(x.v, f, x.v >= 100000) + (items.length > 1 ? '  ' + format(x.v / total * 100, { suf: '%', dec: 0 }) : ''), q.x + gap / 2 + pad, nb.bottom + size * 0.1, { size: size * 0.8, max: w - pad * 2, on: c, color: ink, free: true, name: 'Value' });
    });
  };
  var ICONS = { circle: 'ellipse', square: 'rect', diamond: 'diamond', star: 'star', heart: 'heart', triangle: 'triangle', hexagon: 'hexagon' };
  R.pictogram = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, items = [];
    if (P.series.length) P.cats.forEach(function (c, i) { var v = P.series[0].values[i]; if (v != null && v >= 0) items.push({ name: P.map.category >= 0 ? c : P.series[0].name, v: v }); });
    if (!items.length) return emptyNote(env, 'A pictogram needs a column of numbers of zero or more.');
    var f = P.f, shape = ICONS[o.icon] || 'ellipse', hl = highlightOf(o), hit = hl.any && items.some(function (x) { return hl.has(x.name); });
    var icon = function (x, y, s, c, name) { G.icon(shape, x, y, s, c, name); };
    if (items.length === 1 && (f.suf === '%' || typeof o.max === 'number') && items[0].v <= (o.max || 100)) {
      var max = o.max || 100, on = Math.round(items[0].v / max * 100), side = Math.min(r.h, r.w * 0.55), cellS = side / 10, x0 = r.x, y0 = r.y + (r.h - side) / 2;
      for (var q = 0; q < 100; q++) icon(x0 + (q % 10) * cellS + cellS * 0.1, y0 + (9 - Math.floor(q / 10)) * cellS + cellS * 0.1, cellS * 0.8, q < on ? T.accent : mix(T.card, T.ink, 0.1), q < on ? 'Counted' : 'Not counted');
      var tx = x0 + side + S * 0.9, tw = r.x + r.w - tx, big = format(items[0].v, f), bs = Math.min(S * 2.6, tw * 0.9 / Math.max(0.5, G.width(big, { role: 'title', size: 100 }) / 100));
      if (tw > S * 3) { var bb = G.text(big, tx, r.y + r.h / 2 - bs * 0.3, { role: 'title', size: bs, base: 'middle', name: 'Value' }); G.text(items[0].name, tx, bb.bottom, { size: S * 0.85, color: T.muted, max: tw, lines: 3, name: 'Label' }); }
      G.info.icons = [on];
      return;
    }
    var maxV = Math.max.apply(null, items.map(function (x) { return x.v; })) || 1, per = typeof o.per === 'number' && o.per > 0 ? o.per : Math.max(maxV > 12 ? niceStep(maxV / 14) : 1, 0);
    while (sum(items.map(function (x) { return Math.round(x.v / per); })) > 260 || maxV / per > 40) per = niceStep(per * 1.6);
    var n = items.length, keyH = S * 1.3, band = (r.h - keyH) / n, u = clamp(band * 0.42, S * 0.6, S * 1.1), ls = Math.min(u * 0.9, band * 0.6), most = Math.max(1, Math.round(maxV / per));
    var col = Math.min(Math.max.apply(null, items.map(function (x) { return G.width(x.name, { role: 'label', size: ls }); })), r.w * 0.3) + u * 0.6, out = Math.max.apply(null, items.map(function (x) { return G.width(format(x.v, f, x.v >= 100000), { role: 'value', size: ls }); })) + u * 0.6;
    var s = Math.max(3, Math.min(band * 0.72, (r.w - col - out) / most)), counts = [];
    items.forEach(function (x, i) {
      var cy = r.y + band * (i + 0.5), cnt = Math.round(x.v / per), c = hit ? (hl.has(x.name) ? T.accent : T.neutral) : T.palette[0];
      counts.push(cnt);
      G.text(x.name, r.x + col - u * 0.6, cy, { role: 'label', size: ls, align: 'right', base: 'middle', max: col - u * 0.6, lines: band > ls * 2.5 ? 2 : 1, lh: 1.1, name: 'Category' });
      for (var j = 0; j < cnt; j++) icon(r.x + col + j * s + s * 0.08, cy - s * 0.42, s * 0.84, c, x.name);
      G.text(format(x.v, f, x.v >= 100000), r.x + col + cnt * s + u * 0.3, cy, { role: 'value', size: ls, base: 'middle', color: hit && hl.has(x.name) ? T.accentInk : T.ink, name: 'Value' });
    });
    icon(r.x + col, r.y + r.h - keyH * 0.72, S * 0.6, hit ? T.neutral : T.palette[0], 'Key');
    G.text('= ' + format(per, f, per >= 100000) + (per === 1 ? '' : ' each'), r.x + col + S * 0.85, r.y + r.h - keyH * 0.72 + S * 0.3, { size: S * 0.7, color: T.muted, base: 'middle', name: 'Key' });
    G.info.icons = counts; G.info.per = per;
  };
  R.stat = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, items = [];
    if (P.series.length) P.cats.forEach(function (c, i) { var v = P.series[0].values[i]; if (v != null) items.push({ name: P.map.category >= 0 ? c : P.series[0].name, v: v, d: P.series[1] ? P.series[1].values[i] : null }); });
    if (!items.length) return emptyNote(env, 'A stat tile needs a label and a number.');
    if (items.length > 8) { env.notes.push('Only the first 8 rows are drawn as tiles.'); items = items.slice(0, 8); }
    var n = items.length, cols = clamp(Math.round(Math.sqrt(n * r.w / (r.h * 1.35))), 1, n), rowsN = Math.ceil(n / cols), gap = S * 0.5, tw = (r.w - gap * (cols - 1)) / cols, th = (r.h - gap * (rowsN - 1)) / rowsN;
    var f = P.f, fd = P.series[1] ? P.series[1].f : null, hl = highlightOf(o);
    items.forEach(function (x, i) {
      var tx = r.x + (tw + gap) * (i % cols), ty = r.y + (th + gap) * Math.floor(i / cols), hot = hl.any && hl.has(x.name), bg = hot ? T.accent : mix(T.card, T.ink, 0.05), ink = readable(bg, T.ink, '#FFFFFF'), pad = Math.min(tw * 0.1, th * 0.14, S * 1.1);
      G.rect(tx, ty, tw, th, bg, { r: Math.min(T.cardRadius * env.k * 0.6, th / 4), name: 'Tile' });
      var big = format(x.v, f, Math.abs(x.v) >= 100000), lab = clamp(th * 0.11, 8, S * 0.82), bs = Math.min(th * 0.36, (tw - pad * 2) / Math.max(0.5, G.width(big, { role: 'title', size: 100 }) / 100), S * 3);
      G.text(x.name, tx + pad, ty + pad, { size: lab, role: 'value', color: hot ? ink : ensure(T.muted, bg, 4.5), on: bg, max: tw - pad * 2, lines: 2, lh: 1.15, free: true, name: 'Label' });
      G.text(big, tx + pad, ty + th * 0.56, { role: 'title', size: bs, base: 'middle', on: bg, color: ink, free: true, name: 'Value' });
      if (x.d != null && fd) {
        var up = x.d >= 0, c = hot ? ink : ensure(up ? T.up : T.down, bg, 4.5), cs = clamp(th * 0.1, 8, S * 0.8), cy = ty + th - pad - cs * 0.5, tri = cs * 0.38;
        G.poly(up ? [[tx + pad, cy + tri * 0.7], [tx + pad + tri, cy - tri * 0.9], [tx + pad + tri * 2, cy + tri * 0.7], [tx + pad, cy + tri * 0.7]] : [[tx + pad, cy - tri * 0.7], [tx + pad + tri, cy + tri * 0.9], [tx + pad + tri * 2, cy - tri * 0.7], [tx + pad, cy - tri * 0.7]], { fill: c, name: up ? 'Up' : 'Down' });
        G.text((x.d > 0 ? '+' : '') + format(x.d, fd, Math.abs(x.d) >= 100000) + (typeof o.changeLabel === 'string' && o.changeLabel ? ' ' + o.changeLabel : ''), tx + pad + tri * 2.6, cy, { role: 'value', size: cs, base: 'middle', on: bg, color: c, max: tw - pad * 2 - tri * 2.6, free: true, name: 'Change' });
      }
    });
  };
  R.sparkline = function (env) {
    var P = env.P, G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, n = P.cats.length, m = P.series.length;
    if (m < 2 || !n) return emptyNote(env, 'Sparklines need a row for each thing and several columns of numbers across.');
    if (n > 16) { env.notes.push('Only the first 16 rows are drawn.'); n = 16; }
    var band = r.h / n, u = clamp(band * 0.4, S * 0.55, S * 1.0), ls = Math.min(u * 0.9, band * 0.6), labels = P.cats.slice(0, n), f = P.f, hl = highlightOf(o);
    var col = Math.min(Math.max.apply(null, labels.map(function (l) { return G.width(l, { role: 'label', size: ls }); })), r.w * 0.3) + u * 0.7;
    var rowsV = labels.map(function (l, i) { return P.series.map(function (x) { return x.values[i]; }); });
    var last = function (v) { for (var j = v.length - 1; j >= 0; j--) if (v[j] != null) return v[j]; return null; }, first = function (v) { for (var j = 0; j < v.length; j++) if (v[j] != null) return v[j]; return null; };
    var chg = function (v) { var a = first(v), b = last(v); return a ? (b - a) / Math.abs(a) * 100 : null; }, pf = { suf: '%', dec: 0 };
    var wv = Math.max.apply(null, rowsV.map(function (v) { return G.width(format(last(v), f, Math.abs(last(v) || 0) >= 100000), { role: 'value', size: ls }); })), wc = Math.max.apply(null, rowsV.map(function (v) { var c = chg(v); return c == null ? 0 : G.width((c > 0 ? '+' : '') + format(c, pf), { size: ls * 0.9 }); }));
    var x0 = r.x + col, x1 = r.x + r.w - wv - wc - u * 1.6, lw = Math.max(1.5, S * 0.07);
    rowsV.forEach(function (v, i) {
      var cy = r.y + band * (i + 0.5), nums = v.filter(function (x) { return x != null; }), hot = hl.any && hl.has(labels[i]), c = hl.any ? (hot ? T.accent : T.neutral) : T.palette[0];
      if (i) G.line(r.x, r.y + band * i, r.x + r.w, r.y + band * i, T.grid, Math.max(1, env.k), { name: 'Rule' });
      G.text(labels[i], r.x, cy, { role: 'label', size: ls, base: 'middle', max: col - u * 0.7, name: 'Row' });
      if (nums.length < 2) return;
      var lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums), ys = scale.linear(lo, hi === lo ? lo + 1 : hi, cy + band * 0.3, cy - band * 0.3), pts = [];
      v.forEach(function (x, j) { if (x != null) pts.push([x0 + (x1 - x0) * j / (m - 1), hi === lo ? cy : ys(x)]); });
      G.poly(pts, { stroke: c, sw: lw, name: labels[i] + ' trend' });
      G.dot(pts[pts.length - 1][0], pts[pts.length - 1][1], lw * 1.5, c, { stroke: T.card, sw: 1, name: 'Last point' });
      G.text(format(last(v), f, Math.abs(last(v)) >= 100000), r.x + r.w - wc - u * 0.6, cy, { role: 'value', size: ls, align: 'right', base: 'middle', color: hot ? T.accentInk : T.ink, name: 'Last value' });
      var cg = chg(v);
      if (cg != null) G.text((cg > 0 ? '+' : '') + format(cg, pf), r.x + r.w, cy, { size: ls * 0.9, align: 'right', base: 'middle', color: ensure(cg >= 0 ? T.up : T.down, T.card, 4.5), name: 'Change' });
    });
  };
  R.table = function (env) {
    var G = env.G, T = env.T, S = env.S, o = env.o, r = env.plot, data = env.chart.data, P = env.P;
    var colsAll = data.columns.map(function (c, i) { return i; }), cols = colsAll.slice(0, 8), rows = P.rows;
    if (!cols.length || !rows.length) return emptyNote(env, 'Add rows to draw a table.');
    if (colsAll.length > 8) env.notes.push('Only the first 8 of ' + colsAll.length + ' columns are drawn.');
    var rowH = clamp(r.h / (rows.length + 1), S * 1.3, S * 2.1), fit = Math.max(1, Math.min(Math.floor(r.h / rowH) - 1, Math.floor(230 / cols.length)));
    if (rows.length > fit) { env.notes.push('Showing the first ' + fit + ' of ' + rows.length + ' rows.'); rows = rows.slice(0, fit); }
    rowH = Math.min(S * 2.1, r.h / (rows.length + 1));
    var size = Math.min(S * 0.78, rowH * 0.5), pad = size * 0.7, hl = highlightOf(o);
    var want = cols.map(function (c) { var w = G.width(data.columns[c], { role: 'label', size: size }); rows.forEach(function (row) { w = Math.max(w, G.width(cell(row[c]), { size: size })); }); return Math.min(w, r.w * 0.5) + pad * 2; });
    var tot = sum(want), widths = want.map(function (w) { return tot > r.w ? Math.max(pad * 3, w * r.w / tot) : w + (r.w - tot) / cols.length; }), x = r.x;
    var xs = widths.map(function (w) { var q = x; x += w; return q; }), right = cols.map(function (c) { return P.A[c] && P.A[c].numeric; });
    cols.forEach(function (c, j) { G.text(data.columns[c], right[j] ? xs[j] + widths[j] - pad : xs[j] + pad, r.y + rowH / 2, { role: 'label', size: size, align: right[j] ? 'right' : 'left', base: 'middle', max: widths[j] - pad * 2, name: 'Header' }); });
    G.line(r.x, r.y + rowH, r.x + r.w, r.y + rowH, T.ink, Math.max(1.5, env.k * 2.5), { name: 'Header rule' });
    rows.forEach(function (row, i) {
      var y = r.y + rowH * (i + 1), hot = hl.any && hl.has(cell(row[P.map.category >= 0 ? P.map.category : cols[0]])), bg = hot ? mix(T.accent, T.card, 0.86) : i % 2 && o.zebra !== false ? mix(T.card, T.ink, 0.035) : null;
      if (bg) G.rect(r.x, y, r.w, rowH, bg, { flat: true, name: hot ? 'Highlighted row' : 'Row band' });
      if (i && !bg && o.zebra === false) G.line(r.x, y, r.x + r.w, y, T.grid, Math.max(1, env.k), { name: 'Rule' });
      cols.forEach(function (c, j) { var s = cell(row[c]); if (s) G.text(s, right[j] ? xs[j] + widths[j] - pad : xs[j] + pad, y + rowH / 2, { size: size, role: hot ? 'value' : 'body', align: right[j] ? 'right' : 'left', base: 'middle', max: widths[j] - pad * 2, on: bg || T.card, free: true, name: data.columns[c] }); });
    });
    G.line(r.x, r.y + rowH * (rows.length + 1), r.x + r.w, r.y + rowH * (rows.length + 1), T.grid, Math.max(1, env.k * 1.5), { name: 'Rule' });
  };

  /* ---------- the catalogue: types, their options, sample data ---------- */
  var COMMON = 'title subtitle source note highlight sort(asc|desc) top(N + Other) aggregate(sum|mean|count|min|max) exclude[] swap labels(auto|on|off) legend(auto|on) card(false = no background) textScale unit prefix decimals annotations[]';
  var TYPES = [
    { id: 'bar', name: 'Bar', group: 'Compare', needs: 'labels + one or more number columns', options: 'mode(grouped|stacked|percent) labelsAt(left|above) labelPosition(inside) axis gap{from,to,label,note}' },
    { id: 'column', name: 'Column', group: 'Compare', needs: 'labels + one or more number columns', options: 'mode(grouped|stacked|percent) axis gap{from,to,label}' },
    { id: 'line', name: 'Line', group: 'Change over time', needs: 'dates or ordered labels + number columns', options: 'smooth markers zero(false = axis may start above zero, with a note) legend' },
    { id: 'area', name: 'Area', group: 'Change over time', needs: 'dates or ordered labels + number columns', options: 'mode(stacked|percent) smooth' },
    { id: 'pie', name: 'Pie', group: 'Parts of a whole', needs: 'labels + one number column (above zero)', options: 'show(percent|value) fold(false keeps small slices)' },
    { id: 'donut', name: 'Donut', group: 'Parts of a whole', needs: 'labels + one number column (above zero)', options: 'show hole(0.2–0.85) centre(text | false) fold' },
    { id: 'scatter', name: 'Scatter', group: 'Relationship', needs: 'two number columns (map.x, map.y); labels optional', options: 'trend logX logY' },
    { id: 'bubble', name: 'Bubble', group: 'Relationship', needs: 'three number columns (map.x, map.y, map.size)', options: 'trend logX logY' },
    { id: 'histogram', name: 'Histogram', group: 'Distribution', needs: 'one number column with many rows', options: 'bins' },
    { id: 'combo', name: 'Columns + line', group: 'Compare', needs: 'labels + two or more number columns; the last is the line', options: 'line(series name) smooth' },
    { id: 'waterfall', name: 'Waterfall', group: 'Change over time', needs: 'labels + one column of gains and losses', options: 'total(false) totalLabel start(true = first row is a total)' },
    { id: 'funnel', name: 'Funnel', group: 'Parts of a whole', needs: 'stages + one number column', options: '' },
    { id: 'radar', name: 'Radar', group: 'Compare', needs: '3 to 12 rows + up to 6 number columns', options: '' },
    { id: 'gauge', name: 'Gauge', group: 'Single number', needs: 'one number (and map.target or options.max for the most it can be)', options: 'shape(ring) max' },
    { id: 'lollipop', name: 'Lollipop', group: 'Compare', needs: 'labels + number columns', options: 'stem(false = dot plot; several columns make a range)' },
    { id: 'slope', name: 'Slope', group: 'Change over time', needs: 'labels + two number columns (before, after)', options: '' },
    { id: 'bullet', name: 'Bullet bar', group: 'Single number', needs: 'labels + value column + map.target', options: '' },
    { id: 'heatmap', name: 'Heatmap', group: 'Compare', needs: 'rows + several number columns', options: '' },
    { id: 'treemap', name: 'Treemap', group: 'Parts of a whole', needs: 'labels + one number column (above zero)', options: '' },
    { id: 'pictogram', name: 'Pictogram', group: 'Parts of a whole', needs: 'labels + one number column; one percentage makes a 10 × 10 grid', options: 'icon(circle|square|diamond|star|heart|triangle|hexagon) per max' },
    { id: 'stat', name: 'Stat tiles', group: 'Single number', needs: 'label + number (+ a change column)', options: 'changeLabel' },
    { id: 'sparkline', name: 'Sparklines', group: 'Change over time', needs: 'a row per thing + several number columns across', options: '' },
    { id: 'table', name: 'Table', group: 'Compare', needs: 'any rows', options: 'zebra(false)' }
  ];
  var MONTHS12 = MON3;
  var SAMPLES = {
    bar: { data: { columns: ['Room', 'Ceiling height'], rows: [['Grand hall', '70 feet'], ['Marble entrance', '65 feet'], ['Ballroom', '64 feet'], ['Great hall', '45 feet'], ['West lounge', '24 feet']] }, options: { highlight: 'Grand hall' } },
    column: { data: { columns: ['Month', 'Orders'], rows: [['Jan', 420], ['Feb', 380], ['Mar', 510], ['Apr', 560], ['May', 610], ['Jun', 740]] }, options: { highlight: 'Jun' } },
    line: { data: { columns: ['Month', 'This year', 'Last year'], rows: MONTHS12.map(function (m, i) { return [m, [120, 132, 150, 148, 171, 190, 214, 208, 236, 255, 270, 310][i], [100, 108, 112, 125, 130, 142, 150, 161, 158, 170, 182, 196][i]]; }) }, options: { highlight: 'This year' } },
    area: { data: { columns: ['Year', 'Solar', 'Wind', 'Hydro'], rows: [[2019, 12, 30, 44], [2020, 18, 36, 45], [2021, 27, 41, 44], [2022, 39, 49, 46], [2023, 55, 58, 45], [2024, 74, 66, 47]] }, options: { mode: 'stacked', unit: 'TWh' } },
    pie: { data: { columns: ['Spending', 'Share'], rows: [['Rent', '38%'], ['Food', '22%'], ['Transport', '14%'], ['Savings', '12%'], ['Fun', '9%'], ['Other', '5%']] } },
    donut: { data: { columns: ['Channel', 'Visits'], rows: [['Search', 5200], ['Direct', 3100], ['Social', 2400], ['Email', 1300], ['Referral', 800]] }, options: { centre: 'visits' } },
    scatter: { data: { columns: ['Student', 'Hours studied', 'Score'], rows: [['Ana', 2, 52], ['Ben', 3, 58], ['Caro', 4, 61], ['Dev', 5, 70], ['Eli', 5.5, 66], ['Fay', 6, 74], ['Gus', 7, 79], ['Hal', 8, 83], ['Ivy', 9, 88], ['Jo', 10, 94], ['Kit', 3.5, 49], ['Lou', 6.5, 81]] }, options: { trend: true } },
    bubble: { data: { columns: ['City', 'Median rent', 'Median pay', 'People'], rows: [['Avon', 900, 2900, 240000], ['Brook', 1400, 3600, 610000], ['Cove', 1100, 3100, 380000], ['Dale', 2100, 4800, 1500000], ['Elm', 1700, 4100, 890000], ['Ford', 800, 2600, 120000]] } },
    histogram: { data: { columns: ['Delivery time'], rows: [22, 25, 27, 28, 28, 30, 31, 31, 32, 33, 33, 34, 34, 35, 35, 35, 36, 36, 37, 37, 38, 38, 39, 39, 40, 41, 41, 42, 43, 44, 45, 46, 48, 50, 52, 55, 58, 63, 70, 84].map(function (v) { return [v + ' min']; }) } },
    combo: { data: { columns: ['Quarter', 'Revenue', 'Margin'], rows: [['Q1', '$410K', '18%'], ['Q2', '$460K', '21%'], ['Q3', '$520K', '19%'], ['Q4', '$640K', '24%']] } },
    waterfall: { data: { columns: ['Step', 'Change'], rows: [['Sales', 1200], ['Returns', -150], ['Materials', -420], ['Wages', -310], ['Other income', 90]] }, options: { totalLabel: 'Profit', prefix: '$' } },
    funnel: { data: { columns: ['Stage', 'People'], rows: [['Visited', 12000], ['Signed up', 4200], ['Tried it', 1900], ['Paid', 640]] } },
    radar: { data: { columns: ['Skill', 'Ana', 'Ben'], rows: [['Speed', 8, 6], ['Accuracy', 6, 9], ['Teamwork', 9, 7], ['Planning', 5, 8], ['Writing', 7, 6]] } },
    gauge: { data: { columns: ['Goal', 'Reached'], rows: [['Fundraising goal', '72%']] } },
    lollipop: { data: { columns: ['Country', 'Coffee per person'], rows: [['Finland', '12 kg'], ['Norway', '9.9 kg'], ['Iceland', '9 kg'], ['Denmark', '8.7 kg'], ['Netherlands', '8.4 kg'], ['Sweden', '8.2 kg'], ['Switzerland', '7.9 kg']] } },
    slope: { data: { columns: ['Subject', '2019', '2024'], rows: [['Maths', 61, 72], ['Reading', 70, 68], ['Science', 58, 75], ['Art', 66, 67]] }, options: { highlight: 'Science', unit: '%' } },
    bullet: { data: { columns: ['Team', 'Sales', 'Target'], rows: [['North', 82, 75], ['South', 61, 80], ['East', 74, 70], ['West', 48, 65]] }, map: { category: 0, series: [1], target: 2 } },
    heatmap: { data: { columns: ['Day', 'Morning', 'Noon', 'Afternoon', 'Evening'], rows: [['Mon', 12, 30, 22, 9], ['Tue', 14, 34, 25, 11], ['Wed', 16, 38, 24, 12], ['Thu', 15, 36, 28, 18], ['Fri', 19, 42, 35, 30], ['Sat', 28, 51, 47, 41], ['Sun', 24, 44, 33, 20]] } },
    treemap: { data: { columns: ['Folder', 'Size'], rows: [['Photos', '48 GB'], ['Video', '31 GB'], ['Music', '12 GB'], ['Documents', '7 GB'], ['Apps', '6 GB'], ['Mail', '3 GB'], ['Other', '2 GB']] } },
    pictogram: { data: { columns: ['Answer', 'People'], rows: [['Walk', 14], ['Cycle', 9], ['Bus', 21], ['Car', 6]] } },
    stat: { data: { columns: ['Measure', 'Value', 'Change'], rows: [['Visitors', 48200, '12%'], ['Orders', 1930, '4%'], ['Refunds', 41, '-9%'], ['Rating', 4.7, '2%']] }, options: { changeLabel: 'vs last month' } },
    sparkline: { data: { columns: ['Product', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], rows: [['Coffee', 120, 132, 128, 140, 162, 190, 171], ['Tea', 60, 58, 63, 61, 66, 80, 77], ['Juice', 44, 40, 38, 35, 41, 52, 39], ['Cake', 30, 33, 37, 36, 48, 71, 64]] } },
    table: { data: { columns: ['Plan', 'Price', 'Storage', 'Seats'], rows: [['Free', '$0', '5 GB', 1], ['Solo', '$8', '100 GB', 1], ['Team', '$20', '1 TB', 10], ['Company', '$45', '5 TB', 50]] }, options: { highlight: 'Team' } }
  };
  function sample(type, theme) { var s = SAMPLES[type] || SAMPLES.bar; return sanitize({ v: 1, type: SAMPLES[type] ? type : 'bar', data: clone(s.data), map: clone(s.map || {}), theme: theme || 'clean', options: clone(s.options || {}) }); }
  function types() { return TYPES.map(function (t) { return { id: t.id, name: t.name, group: t.group, needs: t.needs, options: t.options }; }); }

  /* ---------- build ---------- */
  function render(chart, box, ctx) {
    ctx = ctx || {};
    chart = sanitize(chart);
    box = box || {};
    box = { x: Number(box.x) || 0, y: Number(box.y) || 0, w: Math.max(60, Number(box.w) || 640), h: Math.max(60, Number(box.h) || 420) };
    if (!chart) return { layers: [], notes: ['This is not a chart.'], info: {}, theme: themeOf('clean', ctx) };
    var T = themeOf(chart.theme, ctx), o = chart.options, type = R[chart.type] ? chart.type : 'bar';
    if (o.card === false) {
      var bg = isHex(ctx.background) ? hex(rgb(ctx.background)) : T.card;
      T.card = bg; T.ink = ensure(T.ink, bg, 7); T.muted = ensure(T.muted, bg, 4.5); T.grid = mix(bg, T.ink, 0.12); T.axis = mix(bg, T.ink, 0.45); T.accentInk = ensure(T.accent, bg, 4.5);
      if (contrast(T.neutral, bg) < 1.25) T.neutral = mix(bg, T.ink, 0.28);
    }
    var S = clamp(Math.min(box.w / 30, box.h / 15), 8, 40) * clamp(Number(o.textScale) || 1, 0.6, 1.8), k = S / 36;
    var G = Builder(T, ctx, typeof ctx.id === 'string' ? ctx.id : ''), P = prepare(chart), notes = P.notes.slice();
    var env = { P: P, G: G, T: T, S: S, k: k, o: o, chart: chart, notes: notes, box: box };
    env.plot = frame(G, box, o, T, S, k);
    if (chart.type !== type) notes.push('"' + chart.type + '" is not a chart type here; it is drawn as bars.');
    try { R[type](env); } catch (e) { emptyNote(env, 'This chart could not be drawn from these numbers.'); }
    if (G.layers.length > CAP.layers) { notes.push('This chart has more parts than a page keeps; ' + (G.layers.length - CAP.layers) + ' were left out. Use fewer rows.'); G.layers.length = CAP.layers; }
    return { layers: G.layers, notes: notes, info: G.info, theme: T };
  }
  function build(chart, box, ctx) { return render(chart, box, ctx).layers; }
  /* The font faces a chart's theme uses, and a loader for them (so text is measured with the real fonts). */
  function fontsOf(chart, ctx) { var T = themeOf(chart && chart.theme, ctx), out = [[T.body, 400], [T.body, T.vw], [T.head, T.hw]]; return out.filter(function (f, i) { return out.findIndex(function (g) { return g[0] === f[0] && g[1] === f[1]; }) === i; }); }
  function ready(chart, ctx) {
    if (!LE.fonts || typeof LE.fonts.load !== 'function') return Promise.resolve(false);
    return Promise.all(fontsOf(chart, ctx).map(function (f) { return Promise.resolve(LE.fonts.load(f[0], f[1], false)).catch(function () { return null; }); })).then(function () { return true; });
  }

  /* ---------- data in ---------- */
  /* A table ({ columns, rows }, or rows alone) → chart data. A first row that is all numbers is data, not a header. */
  function fromTable(t) {
    var cols, rows;
    if (Array.isArray(t)) { rows = t; cols = null; } else { t = t || {}; cols = Array.isArray(t.columns) ? t.columns.slice() : null; rows = Array.isArray(t.rows) ? t.rows : []; }
    if (rows.length && isObj(rows[0])) { cols = cols || Object.keys(rows[0]).filter(function (k) { return k !== '__proto__' && k !== 'constructor' && k !== 'prototype'; }); rows = rows.map(function (r) { return cols.map(function (c) { return isObj(r) ? r[c] : ''; }); }); }
    rows = rows.filter(Array.isArray);
    if (!cols) { cols = (rows[0] || []).map(function (v) { return v; }); rows = rows.slice(1); }
    if (cols.length && cols.every(function (c) { return numberOf(c) || cell(c) === ''; }) && cols.some(function (c) { return numberOf(c); }) && !(cols.every(function (c) { return /^\d{4}$/.test(cell(c)) || cell(c) === ''; }))) {
      rows = [cols].concat(rows); cols = cols.map(function (c, i) { return 'Column ' + (i + 1); });
    }
    var seen = {};
    cols = cols.slice(0, CAP.cols).map(function (c, i) { var h = text(cell(c), 80) || 'Column ' + (i + 1), kk = h.toLowerCase(); if (seen[kk]) { seen[kk]++; h += ' ' + seen[kk]; } else seen[kk] = 1; return h; });
    return { columns: cols, rows: rows.map(function (r) { var out = []; for (var j = 0; j < cols.length; j++) out.push(typeof r[j] === 'number' ? (isFinite(r[j]) ? r[j] : '') : text(r[j], 200)); return out; }) };
  }
  /* Keeps a table inside the 5,000 cells a document stores: repeated labels are added up; otherwise rows are sampled evenly. */
  function fit(data) {
    var cols = Math.max(1, data.columns.length), max = Math.floor(CAP.cells / cols);
    if (data.rows.length <= max) return { data: data, note: '' };
    var A = analyse(data), cat = -1, n0 = data.rows.length;
    A.forEach(function (a, i) { if (cat < 0 && (a.kind === 'category' || a.kind === 'date') && a.distinct < a.n && a.distinct <= max) cat = i; });
    if (cat >= 0 && A.some(function (a) { return a.numeric; })) {
      var by = {}, order = [];
      data.rows.forEach(function (r) { var kk = cell(r[cat]); if (!by[kk]) { by[kk] = A.map(function () { return 0; }); by[kk].n = 0; order.push(kk); } by[kk].n++; A.forEach(function (a, i) { if (a.numeric) { var d = numberOf(r[i]); if (d) by[kk][i] += d.v; } }); });
      var rows = order.map(function (kk) { return A.map(function (a, i) { return i === cat ? kk : a.numeric ? format(by[kk][i], { pre: a.pre, suf: a.suf, dec: a.dec }).replace(/,/g, '') : ''; }); });
      return { data: { columns: data.columns, rows: rows }, note: n0.toLocaleString('en-US') + ' rows were added up by ' + data.columns[cat] + ' into ' + rows.length.toLocaleString('en-US') + ' (a chart keeps up to 5,000 cells).' };
    }
    var st = data.rows.length / max, out = [];
    for (var i = 0; i < max; i++) out.push(data.rows[Math.floor(i * st)]);
    return { data: { columns: data.columns, rows: out }, note: 'Every ' + Math.round(st) + (Math.round(st) === 2 ? 'nd' : Math.round(st) === 3 ? 'rd' : 'th') + ' row is used: ' + max.toLocaleString('en-US') + ' of ' + n0.toLocaleString('en-US') + ' (a chart keeps up to 5,000 cells).' };
  }
  var STAGES = /^(visit|view|lead|impression|sign|trial|cart|checkout|purchas|paid|applied|appl|interview|offer|hire|open|click|install|activ|subscri|step|stage|aware|consider)/i;
  var CHANGE = /(change|growth|delta|diff|vs\.?|yoy|mom|trend)/i;
  /* Ranked chart types for a table, each already mapped, each with one plain reason. */
  function suggest(table) {
    var data = fromTable(table), A = analyse(data), n = data.rows.length, out = [];
    var nums = [], cats = [], dates = [];
    A.forEach(function (a, i) { if (a.numeric) nums.push(i); else if (a.kind === 'date') dates.push(i); else if (a.kind === 'category' || a.kind === 'text') cats.push(i); });
    var k = nums.length, lab = dates.length ? dates[0] : cats.length ? cats[0] : -1, name = function (i) { return data.columns[i]; };
    function add(type, score, why, map, options) { out.push({ type: type, score: score, why: why, map: map || { category: lab, series: nums.slice() }, options: options || {} }); }
    var one = function (i) { return { category: lab, series: [nums[i || 0]] }; };
    var v0 = k ? data.rows.map(function (r) { var d = numberOf(r[nums[0]]); return d ? d.v : null; }).filter(function (v) { return v != null; }) : [];
    var allPos = v0.every(function (v) { return v > 0; }), hasNeg = v0.some(function (v) { return v < 0; }), hasPos = v0.some(function (v) { return v > 0; });
    if (!n || !data.columns.length) return [{ type: 'table', score: 0, why: 'There is no data yet.', map: {}, options: {} }];
    if (!k) {
      var rep = cats.filter(function (i) { return A[i].distinct < A[i].n && A[i].distinct <= 30; })[0];
      if (rep != null) add('bar', 0.8, 'No numbers, but "' + name(rep) + '" repeats: bars count how often each one appears.', { category: rep, series: [] }, { aggregate: 'count', sort: 'desc' });
      add('table', 0.7, 'No number columns found: a table shows the text as it is.', {});
    } else if (dates.length) {
      var long = cats.length && k === 1 && A[cats[0]].distinct >= 2 && A[cats[0]].distinct <= 12 && A[dates[0]].distinct * A[cats[0]].distinct >= n * 0.7 && A[dates[0]].distinct < n;
      var per = plural(long ? A[dates[0]].distinct : n, A[dates[0]].grain === 'year' ? 'year' : A[dates[0]].grain === 'month' || /month/i.test(name(dates[0])) ? 'month' : A[dates[0]].grain === 'quarter' ? 'quarter' : A[dates[0]].grain === 'day' ? 'day' : 'date');
      if (long) {
        var lm = { category: dates[0], series: [nums[0]], group: cats[0] };
        add('line', 0.95, per + ' for each ' + name(cats[0]) + ' in a long list: one line per ' + name(cats[0]) + ' compares the trends.', lm);
        add('area', 0.7, 'Stacked areas show how the ' + name(cats[0]) + ' values add up over time.', lm, { mode: 'stacked' });
        add('column', 0.6, 'Grouped columns compare each ' + name(cats[0]) + ' in every period.', lm);
        add('heatmap', 0.5, 'A heatmap shows every ' + name(cats[0]) + ' and period at once.', lm);
      } else if (k === 1) {
        add('line', 0.95, per + ' of one number: a line shows the trend.', one());
        add('column', n <= 24 ? 0.8 : 0.5, 'Columns compare each period with the others.', one());
        add('area', 0.7, 'An area shows the trend and the amount under it.', one());
        if (hasNeg && hasPos && n <= 12) add('waterfall', 0.6, 'Gains and losses: a waterfall shows how they add up.', one());
      } else {
        var units = {}; nums.forEach(function (i) { units[A[i].pre + '|' + A[i].suf] = 1; });
        var mixed = Object.keys(units).length > 1;
        if (k === 2 && mixed) add('combo', 0.96, 'Two different measures over time: columns for ' + name(nums[0]) + ', a line for ' + name(nums[1]) + ', each with its own axis.');
        add('line', 0.95, plural(k, 'series') + ' over ' + per + ': lines compare the trends.');
        add('area', mixed ? 0.4 : 0.72, 'Stacked areas show how the parts add up over time.', null, { mode: 'stacked' });
        add('column', n * k <= 36 ? 0.7 : 0.4, 'Grouped columns compare the series period by period.');
        if (n * k > 24) add('heatmap', 0.55, 'A heatmap shows every value at once.');
      }
    } else if (!cats.length) {
      if (k === 1) {
        if (n >= 20) add('histogram', 0.95, n + ' numbers in one column: a histogram shows how they are spread.', { series: [nums[0]] });
        else if (n === 1) add('stat', 0.9, 'One number: show it big.', { category: -1, series: [nums[0]] });
        else { add('column', 0.7, plural(n, 'number') + ' in a row: columns compare them in order.', { category: -1, series: [nums[0]] }); add('line', 0.6, 'A line shows how the numbers move in order.', { category: -1, series: [nums[0]] }); add('histogram', 0.4, 'A histogram shows how the numbers are spread.', { series: [nums[0]] }); }
      } else {
        add('scatter', 0.95, 'Two numbers in every row: a scatter shows whether ' + name(nums[0]) + ' and ' + name(nums[1]) + ' move together.', { category: -1, x: nums[0], y: nums[1] }, n >= 8 ? { trend: true } : {});
        if (k >= 3) add('bubble', 0.85, 'A third number sets the size of each bubble.', { category: -1, x: nums[0], y: nums[1], size: nums[2] });
        add('line', 0.4, 'Lines over the rows in order.', { category: -1, series: nums.slice() });
      }
    } else {
      var c0 = A[cats[0]], longC = cats.length >= 2 && k === 1 && A[cats[1]].distinct >= 2 && A[cats[1]].distinct <= 12 && c0.distinct < n && c0.distinct * A[cats[1]].distinct >= n * 0.7;
      var rows = n, share = k === 1 && allPos && (A[nums[0]].kind === 'percent' || /share|percent|portion|split|mix/i.test(name(nums[0]))) && Math.abs(sum(v0) - 100) <= 1.5;
      var dec = v0.length >= 3 && v0.every(function (v, i) { return !i || v < v0[i - 1]; });
      var tgt = nums.filter(function (i) { return TARGET.test(name(i)); })[0];
      if (longC) {
        var pm = { category: cats[0], series: [nums[0]], group: cats[1] };
        add('column', 0.92, 'A long list of ' + name(cats[0]) + ' and ' + name(cats[1]) + ': grouped columns put each ' + name(cats[1]) + ' side by side.', pm);
        add('bar', 0.85, 'Stacked bars show the total and what it is made of.', pm, { mode: 'stacked' });
        add('heatmap', 0.75, 'A heatmap shows every ' + name(cats[0]) + ' and ' + name(cats[1]) + ' at once.', pm);
      } else if (k === 1) {
        if (rows === 1) { add('stat', 0.92, 'One number: show it big.', one()); if (A[nums[0]].kind === 'percent') add('gauge', 0.9, 'One percentage: a gauge shows how far it is to 100%.', one()); }
        else {
          if (share && rows <= 7) { add('donut', 0.96, plural(rows, 'part') + ' that add up to 100%: a donut shows the split.', one()); add('pie', 0.9, 'A pie shows the same split.', one()); }
          if (dec && rows <= 7 && data.rows.some(function (r) { return STAGES.test(cell(r[cats[0]])); })) add('funnel', 0.94, plural(rows, 'stage') + ', each smaller than the last: a funnel shows where people drop out.', one());
          if (hasNeg && hasPos && rows <= 12) add('waterfall', 0.88, 'Gains and losses: a waterfall shows how they add up to the total.', one());
          add('bar', 0.9, plural(Math.min(rows, c0.distinct), name(cats[0]).toLowerCase() === 'category' ? 'category' : 'row') + ' of one number: bars, longest first, are the easiest to compare.', one(), { sort: 'desc' });
          if (rows <= 8) add('column', 0.7, 'Columns keep the rows in your order.', one());
          if (rows > 8) add('lollipop', 0.72, 'With many rows, dots on thin stems are lighter than bars.', one(), { sort: 'desc' });
          if (!share && allPos && rows <= 6) add('donut', 0.6, 'A donut shows each row as a part of the total.', one());
          if (allPos && rows >= 8) add('treemap', 0.6, 'A treemap shows each row as a share of the whole, largest first.', one());
          if (dec && rows >= 3 && rows <= 7 && !out.some(function (x) { return x.type === 'funnel'; })) add('funnel', 0.5, 'Each row is smaller than the last: a funnel shows the drop.', one());
          if (allPos && rows <= 6 && v0.every(function (v) { return v === Math.round(v) && v <= 60; })) add('pictogram', 0.5, 'Small whole numbers: a pictogram shows them as things you can count.', one());
        }
      } else if (k === 2) {
        var a0 = A[nums[0]], a1 = A[nums[1]], same = a0.pre === a1.pre && a0.suf === a1.suf, twoYears = /^\d{4}$/.test(name(nums[0])) && /^\d{4}$/.test(name(nums[1])), before = /before|after|then|now|old|new|start|end|last|this/i.test(name(nums[0]) + ' ' + name(nums[1]));
        if (tgt != null) add('bullet', 0.94, name(nums[0] === tgt ? nums[1] : nums[0]) + ' against ' + name(tgt) + ': a bullet bar shows who reached it.', { category: lab, series: [nums[0] === tgt ? nums[1] : nums[0]], target: tgt });
        else if (CHANGE.test(name(nums[1])) && rows <= 8) add('stat', 0.9, 'A number and its change: tiles show both at a glance.');
        if (same && (twoYears || before) && rows <= 12) add('slope', 0.92, 'Two moments for each row: slopes show who rose and who fell.');
        if (same) { add('bar', 0.85, 'Two numbers per row: grouped bars compare them side by side.'); add('lollipop', 0.7, 'Dots joined by a line show the gap between the two numbers.', null, { stem: false }); }
        else { add('scatter', 0.86, 'Two different measures per row: a scatter shows whether ' + name(nums[0]) + ' and ' + name(nums[1]) + ' move together.', { category: lab, x: nums[0], y: nums[1] }); add('combo', 0.7, 'Columns for ' + name(nums[0]) + ' and a line for ' + name(nums[1]) + ', each with its own axis.'); add('bar', 0.55, 'Bars of ' + name(nums[0]) + ' alone.', one(), { sort: 'desc' }); }
      } else {
        if (rows * k > 20) add('heatmap', 0.9, plural(rows, 'row') + ' × ' + plural(k, 'column') + ': a heatmap shows every value at once, darkest where it is highest.');
        if (k >= 5) add('sparkline', 0.82, 'Each row across ' + k + ' columns: a small line per row shows its shape.');
        add('bar', rows * k <= 24 ? 0.88 : 0.6, plural(k, 'number') + ' per row: grouped bars compare them side by side.');
        add('bar', 0.74, 'Stacked bars show each row\'s total and what it is made of.', null, { mode: 'stacked' });
        if (rows >= 3 && rows <= 8 && k <= 4) add('radar', 0.55, 'A radar chart compares the shape of each column across the rows.');
        if (k === 3) add('bubble', 0.5, 'Three numbers per row: position and size.', { category: lab, x: nums[0], y: nums[1], size: nums[2] });
      }
    }
    if (!out.some(function (x) { return x.type === 'table'; })) add('table', 0.2, 'A plain table shows every value exactly.', {});
    var seen = {};
    return out.sort(function (a, b) { return b.score - a.score; }).filter(function (x) { var kk = x.type + '|' + (x.options.mode || '') + '|' + (x.options.stem === false ? 'd' : ''); if (seen[kk]) return false; seen[kk] = 1; return true; }).slice(0, 7);
  }

  /* ---------- summary: a plain sentence or two (alt text; what an assistant reads instead of the picture) ---------- */
  function summary(chart) {
    chart = sanitize(chart);
    if (!chart) return 'Not a chart.';
    var P = prepare(chart), o = chart.options, t = TYPES.filter(function (x) { return x.id === chart.type; })[0] || TYPES[0], n = P.cats.length, s0 = P.series[0], data = chart.data;
    var head = (o.title ? '"' + o.title + '". ' : '') + t.name + (/^(table|stat|sparkline|heatmap|treemap|bullet|histogram|pictogram|gauge)$/.test(t.id) ? '' : ' chart');
    var catName = P.map.category >= 0 ? data.columns[P.map.category] : 'row';
    if (t.id === 'table') return head + ' with ' + plural(data.rows.length, 'row') + ' and ' + plural(data.columns.length, 'column') + ': ' + data.columns.slice(0, 6).join(', ') + '.';
    if (t.id === 'scatter' || t.id === 'bubble') {
      if (P.map.x < 0 || P.map.y < 0) return head + ' without two number columns yet.';
      var xs = [], ys = [];
      P.rows.forEach(function (r) { var a = numberOf(r[P.map.x]), b = numberOf(r[P.map.y]); if (a && b) { xs.push(a.v); ys.push(b.v); } });
      var mx = sum(xs) / (xs.length || 1), my = sum(ys) / (ys.length || 1), sxy = 0, sxx = 0, syy = 0;
      xs.forEach(function (x, i) { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); syy += (ys[i] - my) * (ys[i] - my); });
      var rr = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
      return head + ' of ' + data.columns[P.map.y] + ' against ' + data.columns[P.map.x] + ', ' + plural(xs.length, 'point') + '. ' + (Math.abs(rr) < 0.3 ? 'The two do not clearly move together.' : (Math.abs(rr) > 0.7 ? 'They move together strongly: ' : 'They tend to move together: ') + 'as ' + data.columns[P.map.x] + ' rises, ' + data.columns[P.map.y] + (rr > 0 ? ' rises.' : ' falls.'));
    }
    if (!s0 || !n) return head + ' with no numbers yet.';
    var f = s0.f, F = function (v) { return format(v, f, Math.abs(v) >= 1e6); };
    if (t.id === 'histogram') { var vals = []; P.rows.forEach(function (r) { var d = numberOf(r[s0.col]); if (d) vals.push(d.v); }); vals.sort(function (a, b) { return a - b; }); return head + ' of ' + s0.name + ': ' + plural(vals.length, 'value') + ' from ' + F(vals[0]) + ' to ' + F(vals[vals.length - 1]) + ', middle value ' + F(vals[Math.floor(vals.length / 2)]) + '.'; }
    var vv = s0.values, idx = vv.map(function (v, i) { return i; }).filter(function (i) { return vv[i] != null; });
    if (!idx.length) return head + ' with no numbers yet.';
    var hiI = idx.reduce(function (a, b) { return vv[b] > vv[a] ? b : a; }), loI = idx.reduce(function (a, b) { return vv[b] < vv[a] ? b : a; }), first = idx[0], last = idx[idx.length - 1];
    var multi = P.series.length > 1 ? ' for ' + P.series.slice(0, 4).map(function (x) { return x.name; }).join(', ') + (P.series.length > 4 ? ' and ' + (P.series.length - 4) + ' more' : '') : '';
    var out;
    if (t.id === 'line' || t.id === 'area' || t.id === 'sparkline' || (P.catKind === 'date' && (t.id === 'column' || t.id === 'combo'))) {
      var ch = vv[first] ? (vv[last] - vv[first]) / Math.abs(vv[first]) * 100 : null;
      out = head + ' of ' + (P.series.length > 1 ? plural(P.series.length, 'series') + ' (' + P.series.slice(0, 4).map(function (x) { return x.name; }).join(', ') + ')' : s0.name) + ' over ' + plural(n, P.catKind === 'date' ? 'period' : 'point') + ', ' + P.cats[first] + ' to ' + P.cats[last] + '. ' +
        s0.name + ' ' + (vv[last] > vv[first] ? 'rises' : vv[last] < vv[first] ? 'falls' : 'ends where it began') + ' from ' + F(vv[first]) + ' to ' + F(vv[last]) + (ch != null && ch !== 0 ? ' (' + (ch > 0 ? '+' : MINUS) + Math.abs(Math.round(ch)) + '%)' : '') + '; highest ' + F(vv[hiI]) + ' at ' + P.cats[hiI] + '.';
    } else if (t.id === 'pie' || t.id === 'donut' || t.id === 'treemap' || t.id === 'funnel' || t.id === 'pictogram') {
      var tot = sum(idx.map(function (i) { return Math.max(0, vv[i]); }));
      out = head + ' of ' + s0.name + ' in ' + plural(idx.length, 'part') + (t.id === 'funnel' ? '' : ', total ' + F(tot)) + '. ' + (t.id === 'funnel' ? 'From ' + P.cats[first] + ' (' + F(vv[first]) + ') to ' + P.cats[last] + ' (' + F(vv[last]) + '), ' + (vv[first] ? Math.round(vv[last] / vv[first] * 100) : 0) + '% remain.' : 'Largest: ' + P.cats[hiI] + ', ' + F(vv[hiI]) + (tot ? ' (' + Math.round(vv[hiI] / tot * 100) + '%)' : '') + '. Smallest: ' + P.cats[loI] + ', ' + F(vv[loI]) + '.');
    } else if (t.id === 'waterfall') out = head + ' of ' + plural(n, 'step') + ' in ' + s0.name + ', adding up to ' + F(sum(idx.map(function (i) { return vv[i]; }))) + '. Largest gain: ' + P.cats[hiI] + ' (' + F(vv[hiI]) + '); largest loss: ' + P.cats[loI] + ' (' + F(vv[loI]) + ').';
    else if (t.id === 'gauge' || t.id === 'stat') out = head + ': ' + idx.slice(0, 6).map(function (i) { return (P.map.category >= 0 ? P.cats[i] : s0.name) + ' ' + F(vv[i]); }).join('; ') + '.';
    else if (t.id === 'slope' && P.series.length > 1) { var B = P.series[P.series.length - 1], up = idx.filter(function (i) { return B.values[i] > vv[i]; }).length; out = head + ' from ' + s0.name + ' to ' + B.name + ' for ' + plural(idx.length, 'row') + ': ' + up + ' rose, ' + (idx.length - up) + ' fell or stayed.'; }
    else out = head + ' of ' + s0.name + ' by ' + catName + multi + ', ' + plural(n, t.id === 'bar' || t.id === 'column' ? 'bar' : 'row').replace(/(\d+) bars?/, P.series.length > 1 ? plural(n, 'group') : '$&') + '. Highest: ' + P.cats[hiI] + ', ' + F(vv[hiI]) + '. Lowest: ' + P.cats[loI] + ', ' + F(vv[loI]) + '.';
    if (highlightOf(o).any) out += ' Highlighted: ' + (Array.isArray(o.highlight) ? o.highlight.join(', ') : o.highlight) + '.';
    return out;
  }

  /* ---------- operations (agents, the command line, the studio panel) ----------
     Pure: a page document in, a new page document out. A chart is one group layer carrying `chart` and its generated
     children; chart.update and chart.data regenerate the children and keep the group's box. */
  function uniqueId(layers, base) { var ids = {}; layers.forEach(function (l) { ids[l.id] = 1; }); if (!ids[base]) return base; for (var i = 2; i < 10000; i++) if (!ids[base + '-' + i]) return base + '-' + i; return base + '-' + Date.now(); }
  function dataFrom(op) {
    if (typeof op.csv === 'string') {
      if (!LE.variables || typeof LE.variables.parseCSV !== 'function') return { error: 'Reading "csv" needs the list reader (LE.variables). Pass "data": { "columns": [...], "rows": [[...]] } instead.' };
      return { table: LE.variables.parseCSV(op.csv, { maxRows: 20000 }) };
    }
    if (isObj(op.data) && Array.isArray(op.data.rows)) return { table: op.data };
    if (Array.isArray(op.rows)) return { table: Array.isArray(op.columns) ? { columns: op.columns, rows: op.rows } : op.rows };
    return null;
  }
  function groupLayer(id, name, box, chart) { return { id: id, type: 'group', name: name || 'Chart', x: r2(box.x), y: r2(box.y), w: r2(box.w), h: r2(box.h), rotation: 0, opacity: 1, blend: 'source-over', visible: true, locked: false, flipX: false, flipY: false, shadow: null, groupId: null, chart: chart }; }
  function pageBg(page) { var b = page && page.background; return b && typeof b === 'object' ? (isHex(b.color) ? b.color : '') : isHex(b) ? b : ''; }
  /* The layers of a page with the chart group `gid` redrawn from its data (children replaced, in place, before the group). */
  function regenerate(page, gid, ctx) {
    var layers = page.layers || [], g = layers.filter(function (l) { return l.id === gid && l.type === 'group' && l.chart; })[0];
    if (!g) return null;
    var res = render(g.chart, { x: g.x, y: g.y, w: g.w, h: g.h }, Object.assign({ background: pageBg(page) }, ctx || {}, { id: gid }));
    var out = [];
    layers.forEach(function (l) { if (l.groupId === gid) return; if (l.id === gid) res.layers.forEach(function (c) { if (g.visible === false) c.visible = false; out.push(c); }); out.push(l); });
    return { layers: out, notes: res.notes, info: res.info };
  }
  /* Draws every chart group that has no children yet (a design file that only says { "type": "group", "chart": {…} }). */
  function expand(page, ctx) {
    var n = 0, notes = [];
    (page.layers || []).slice().forEach(function (g) {
      if (!g || g.type !== 'group' || !g.chart || (page.layers || []).some(function (l) { return l.groupId === g.id; })) return;
      g.chart = sanitize(g.chart);
      if (!g.chart) { delete g.chart; return; }
      var r = regenerate(page, g.id, ctx);
      if (r) { page.layers = r.layers; notes = notes.concat(r.notes); n++; }
    });
    return { count: n, notes: notes };
  }
  var ops = {
    names: ['chart.add', 'chart.update', 'chart.data'],
    apply: function (page, op, ctx) {
      var fail = function (message, path, code) { return { ok: false, errors: [{ message: message, path: path || '', code: code || 'invalid' }] }; };
      if (!isObj(page) || !isObj(op)) return fail('A chart operation needs a page and an operation.');
      var doc = clone(page), layers = doc.layers = doc.layers || [], W = Number(doc.width) || 1080, H = Number(doc.height) || 1080, warnings = [];
      var src = dataFrom(op), data = null;
      if (src && src.error) return fail(src.error, '/csv', 'unsupported');
      if (src) { var ft = fit(fromTable(src.table)); data = ft.data; if (ft.note) warnings.push(ft.note); if (!data.columns.length) return fail('The data has no columns.', '/data'); }
      var known = function (t) { return TYPES.some(function (x) { return x.id === t; }); }, themed = function (t) { return THEMES.some(function (x) { return x.id === t; }); };
      if (op.type != null && !known(op.type)) return fail('Unknown chart type "' + text(op.type, 30) + '". Types: ' + TYPES.map(function (x) { return x.id; }).join(', ') + '.', '/type', 'unknown-type');
      if (op.theme != null && !themed(op.theme)) return fail('Unknown chart theme "' + text(op.theme, 30) + '". Themes: ' + THEMES.map(function (x) { return x.id; }).join(', ') + '.', '/theme', 'unknown-theme');
      var g, chart;
      if (op.op === 'chart.add') {
        if (!data) return fail('"chart.add" needs data: "data": { "columns", "rows" }, "rows" (arrays or objects) or "csv".', '/data');
        var sg = op.type ? null : suggest(data)[0];
        chart = sanitize({ v: 1, type: op.type || sg.type, data: data, map: isObj(op.map) ? op.map : (sg ? sg.map : {}), theme: op.theme || 'clean', options: Object.assign({}, sg ? sg.options : {}, isObj(op.options) ? op.options : {}) });
        var b = isObj(op.box) ? op.box : {}, bw = clamp(Number(b.w) || W * 0.84, 60, 20000), bh = clamp(Number(b.h) || Math.min(H * 0.62, bw * 0.68), 60, 20000);
        var id = typeof op.id === 'string' && /^[\w:.-]{1,40}$/.test(op.id) ? op.id : uniqueId(layers, 'chart');
        if (layers.some(function (l) { return l.id === id; })) return fail('The id "' + id + '" is already used on this page.', '/id');
        g = groupLayer(id, text(op.name || (chart.options.title || 'Chart'), 120), { x: b.x == null ? r2((W - bw) / 2) : Number(b.x) || 0, y: b.y == null ? r2((H - bh) / 2) : Number(b.y) || 0, w: r2(bw), h: r2(bh) }, chart);
        layers.push(g);
      } else if (op.op === 'chart.update' || op.op === 'chart.data') {
        var ref = String(op.layer == null ? '' : op.layer), hits = layers.filter(function (l) { return l.type === 'group' && l.chart && (l.id === ref || l.name === ref); });
        if (!ref && layers.filter(function (l) { return l.type === 'group' && l.chart; }).length === 1) hits = layers.filter(function (l) { return l.type === 'group' && l.chart; });
        if (hits.length !== 1) return fail(hits.length ? 'More than one chart is called "' + ref + '"; use its id.' : 'No chart layer "' + ref + '" on this page. "layer" is the id or name of a chart group.', '/layer', 'not-found');
        g = hits[0]; chart = sanitize(g.chart) || sample('bar');
        if (op.op === 'chart.data') { if (!data) return fail('"chart.data" needs "data", "rows" or "csv".', '/data'); chart.data = data; if (isObj(op.map)) chart.map = op.map; else chart.map = remap(g.chart, data); }
        else {
          if (data) chart.data = data;
          if (op.type) chart.type = op.type;
          if (op.theme) chart.theme = op.theme;
          if (isObj(op.map)) chart.map = op.map;
          if (isObj(op.options)) Object.keys(op.options).forEach(function (kk) { if (op.options[kk] === null) delete chart.options[kk]; else chart.options[kk] = op.options[kk]; });
          if (isObj(op.box)) ['x', 'y', 'w', 'h'].forEach(function (kk) { if (isFinite(op.box[kk])) g[kk] = kk === 'w' || kk === 'h' ? Math.max(60, Number(op.box[kk])) : Number(op.box[kk]); });
        }
        g.chart = sanitize(chart);
      } else return fail('Unknown chart operation "' + text(op.op, 30) + '". Operations: chart.add, chart.update, chart.data.', '/op');
      var res = regenerate(doc, g.id, ctx);
      doc.layers = res.layers;
      return { ok: true, doc: doc, id: g.id, warnings: warnings.concat(res.notes), summary: summary(g.chart), layers: res.layers.filter(function (l) { return l.groupId === g.id; }).length };
    }
  };
  /* New data under an old mapping: column names that still exist keep their roles; the rest is mapped afresh. */
  function remap(old, data) {
    var m = {}, om = old && old.map || {}, oc = old && old.data && old.data.columns || [], keep = true;
    var nameOf = function (v) { return typeof v === 'number' ? oc[v] : v; };
    Object.keys(om).forEach(function (kk) {
      if (Array.isArray(om[kk])) { m[kk] = om[kk].map(nameOf).filter(function (nm) { return colIndex(data, nm) >= 0; }); if (m[kk].length !== om[kk].length) keep = false; }
      else if (om[kk] === -1) m[kk] = -1;
      else if (colIndex(data, nameOf(om[kk])) >= 0) m[kk] = nameOf(om[kk]); else keep = false;
    });
    return keep ? m : {};
  }
  function catalog() {
    return {
      types: TYPES.map(function (t) { return { id: t.id, name: t.name, needs: t.needs, options: t.options }; }),
      themes: THEMES.map(function (t) { return { id: t.id, name: t.name }; }),
      options: COMMON,
      map: 'category, series[], group (long tables), x, y, size, target: a column index or its name; left out, columns are mapped by what they hold',
      limits: '5,000 cells per chart; larger data is added up by label or sampled, with a note',
      operations: {
        'chart.add': { op: 'chart.add', type: 'bar', data: { columns: ['Room', 'Seats'], rows: [['Hall', 620], ['Lounge', 450]] }, theme: 'paper', options: { title: 'Seats by room', highlight: 'Hall' }, box: { x: 90, y: 200, w: 900, h: 560 } },
        'chart.update': { op: 'chart.update', layer: 'chart', type: 'column', options: { sort: 'desc', highlight: null } },
        'chart.data': { op: 'chart.data', layer: 'chart', csv: 'Room,Seats\nHall,640\nLounge,455' }
      },
      also: 'LE.charts.suggest(table) ranks types for a table; LE.charts.summary(chart) describes a chart in a sentence.'
    };
  }

  LE.charts = {
    version: 1, CAP: CAP,
    build: build, render: render, types: types, themes: themes, theme: themeOf, suggest: suggest, summary: summary, sample: sample,
    sanitize: sanitize, analyse: analyse, prepare: prepare, fromTable: fromTable, fit: fit, autoMap: autoMap,
    format: format, ticks: ticks, scale: scale, number: function (v) { var d = numberOf(v); return d ? d.v : null; }, numberOf: numberOf, date: dateOf, color: color,
    fonts: fontsOf, ready: ready, regenerate: regenerate, expand: expand, ops: ops, catalog: catalog, groupLayer: groupLayer, uniqueId: uniqueId
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = LE.charts;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
