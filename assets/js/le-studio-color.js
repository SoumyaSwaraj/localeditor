/* LocalEditor studio colour: rich picker, colour library, page backgrounds, replace all, brand kit. */
(function () {
  'use strict';
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var LE = window.LE;
  var U = P._u;
  var H = P._hooks = P._hooks || {};
  var CMDS = P._cmds = P._cmds || {};
  function hook(n, f) { (H[n] = H[n] || []).push(f); }
  function has(fn) { return !!(LE.assets && typeof LE.assets[fn] === 'function'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- Colour maths ---------- */
  var probe = null;
  function parse(c) {
    if (c && typeof c === 'object' && c.r != null) return c;
    var s = String(c == null ? '' : c).trim().toLowerCase();
    var m;
    if (!s) return null;
    if ((m = /^#([0-9a-f]{3,4})$/.exec(s))) s = '#' + m[1].split('').map(function (x) { return x + x; }).join('');
    if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s))) {
      return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
    }
    if ((m = /^rgba?\(([^)]+)\)$/.exec(s))) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (p.length < 3) return null;
      var ch = function (x) { return /%$/.test(x) ? parseFloat(x) * 2.55 : Number(x); };
      return { r: clamp(ch(p[0]) || 0, 0, 255), g: clamp(ch(p[1]) || 0, 0, 255), b: clamp(ch(p[2]) || 0, 0, 255), a: p[3] == null ? 1 : clamp(/%$/.test(p[3]) ? parseFloat(p[3]) / 100 : Number(p[3]), 0, 1) };
    }
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (!/^[a-z]{3,24}$|^hsla?\(/.test(s)) return null;
    probe = probe || document.createElement('canvas').getContext('2d');
    probe.fillStyle = '#010203';
    probe.fillStyle = s;
    var v = probe.fillStyle;
    if (v === '#010203' && s !== '#010203') return null;
    return v.charAt(0) === '#' || /^rgba?\(/.test(v) ? parse(v) : null;
  }
  function h2(n) { return ('0' + Math.round(clamp(n, 0, 255)).toString(16)).slice(-2); }
  function hex(c) {
    var p = parse(c);
    if (!p) return '#000000';
    return '#' + h2(p.r) + h2(p.g) + h2(p.b) + (p.a < 0.996 ? h2(p.a * 255) : '');
  }
  function hex6(c) { return hex(c).slice(0, 7); }
  function rgb2hsv(p) {
    var r = p.r / 255, g = p.g / 255, b = p.b / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, hh = 0;
    if (d) {
      if (mx === r) hh = ((g - b) / d) % 6;
      else if (mx === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hh *= 60;
      if (hh < 0) hh += 360;
    }
    return { h: hh, s: mx ? d / mx : 0, v: mx };
  }
  function hsv2rgb(hh, s, v) {
    var f = function (n) { var k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 };
  }
  function hsl(hh, s, l) {
    s /= 100; l /= 100;
    var a = s * Math.min(l, 1 - l);
    var f = function (n) { var k = (n + hh / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return '#' + h2(f(0) * 255) + h2(f(8) * 255) + h2(f(4) * 255);
  }
  function lum(c) {
    var p = parse(c) || { r: 0, g: 0, b: 0 };
    var f = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(p.r) + 0.7152 * f(p.g) + 0.0722 * f(p.b);
  }
  function mix(a, b, t) {
    var x = parse(a) || { r: 0, g: 0, b: 0, a: 1 }, y = parse(b) || { r: 0, g: 0, b: 0, a: 1 };
    return hex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: x.a + (y.a - x.a) * t });
  }
  function isColor(v) { return typeof v === 'string' && !!parse(v); }

  /* ---------- Library (LE.assets first, built-in fallback) ---------- */
  var FALLBACK_SETS = [
    ['localeditor', 'LocalEditor', 'Brand', ['#141414', '#182d6b', '#2e51b6', '#3f67d9', '#81a6fe', '#e6eeff', '#ef8c57', '#feb38c', '#ffffff', '#f5f5f5']],
    ['neutrals', 'Neutrals', 'Neutrals', ['#ffffff', '#f5f5f4', '#e7e5e4', '#d6d3d1', '#a8a29e', '#78716c', '#57534e', '#44403c', '#292524', '#0c0a09']],
    ['greys', 'Cool greys', 'Neutrals', ['#f8fafc', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a']],
    ['warm', 'Warm', 'Mood', ['#7c2d12', '#c2410c', '#f97316', '#fdba74', '#fde68a', '#fef3c7']],
    ['cool', 'Cool', 'Mood', ['#0c4a6e', '#0369a1', '#38bdf8', '#a5f3fc', '#c7d2fe', '#4338ca']],
    ['pastel', 'Pastel', 'Mood', ['#fbcfe8', '#fde68a', '#bbf7d0', '#bae6fd', '#ddd6fe', '#fecaca']],
    ['earthy', 'Earthy', 'Mood', ['#3f2e1f', '#7a5c3e', '#a47551', '#c9a27e', '#d8c3a5', '#8a9a5b']],
    ['jewel', 'Jewel tones', 'Mood', ['#0f5257', '#1b4079', '#5b2a86', '#9a031e', '#e09f3e', '#0b6e4f']],
    ['neon', 'Neon', 'Vivid', ['#ff00e5', '#00f0ff', '#39ff14', '#fff200', '#ff3131', '#7d00ff']],
    ['vivid', 'Vivid', 'Vivid', ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']],
    ['vintage', 'Vintage', 'Style', ['#d9a05b', '#a65e2e', '#5b7065', '#c4b6a6', '#e8d5b7', '#344e41']],
    ['scandi', 'Scandinavian', 'Style', ['#f4f1ea', '#d9d3c7', '#a3b1a0', '#5b6e6a', '#2f3e46', '#c9ada7']],
    ['ocean', 'Ocean', 'Nature', ['#03045e', '#023e8a', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8']],
    ['forest', 'Forest', 'Nature', ['#081c15', '#1b4332', '#2d6a4f', '#52b788', '#95d5b2', '#d8f3dc']],
    ['desert', 'Desert', 'Nature', ['#6f1d1b', '#bb9457', '#432818', '#99582a', '#ffe6a7', '#e7bc91']],
    ['sunset', 'Sunset', 'Nature', ['#2b1055', '#7597de', '#ff7b54', '#ffb26b', '#ffd56f', '#ff4e50']],
    ['candy', 'Candy', 'Playful', ['#ff6fb5', '#ffb4e0', '#a0e7e5', '#b4f8c8', '#fbe7c6', '#c3aed6']],
    ['coffee', 'Coffee', 'Playful', ['#3c2a21', '#6f4e37', '#a67b5b', '#c8a27a', '#ecd9c6', '#f5efe6']],
    ['blush', 'Wedding blush', 'Occasions', ['#fff1f2', '#ffe4e6', '#fecdd3', '#e8b4b8', '#c48b9f', '#b9a37e']],
    ['navy', 'Corporate navy', 'Business', ['#0b1f3a', '#1d3557', '#457b9d', '#a8dadc', '#f1faee', '#e63946']],
    ['diwali', 'Diwali', 'Festive', ['#5c0a0a', '#b5121b', '#f59e0b', '#fcd34d', '#7c2d92', '#14532d']],
    ['holi', 'Holi', 'Festive', ['#ff006e', '#fb5607', '#ffbe0b', '#3a86ff', '#8338ec', '#06d6a0']],
    ['spring', 'Spring', 'Seasons', ['#ffd6e0', '#c1fba4', '#7bf1a8', '#90f1ef', '#ffef9f', '#ffc2d1']],
    ['summer', 'Summer', 'Seasons', ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ffffff']],
    ['autumn', 'Autumn', 'Seasons', ['#582f0e', '#7f4f24', '#936639', '#a68a64', '#b6ad90', '#bc4749']],
    ['winter', 'Winter', 'Seasons', ['#e0fbfc', '#c2dfe3', '#9db4c0', '#5c6b73', '#253237', '#ffffff']],
    ['material', 'Material', 'Systems', ['#f44336', '#e91e63', '#9c27b0', '#3f51b5', '#2196f3', '#009688', '#4caf50', '#ffc107', '#ff5722', '#607d8b']],
    ['contrast', 'High contrast pairs', 'Accessible', ['#000000', '#ffffff', '#0b3d91', '#ffd400', '#1b1b1b', '#f5f5f5']]
  ].map(function (s) { return { id: s[0], name: s[1], group: s[2], colors: s[3] }; });
  var HUES = [['Red', 4], ['Orange', 24], ['Amber', 40], ['Yellow', 52], ['Lime', 84], ['Green', 142], ['Teal', 172], ['Cyan', 190], ['Blue', 214], ['Indigo', 238], ['Violet', 262], ['Pink', 330]];
  var RAMP_L = [97, 93, 86, 77, 66, 56, 47, 39, 31, 23, 15];
  var rampCache = null;
  function ramps() {
    if (rampCache) return rampCache;
    rampCache = HUES.map(function (hu) {
      return { id: 'ramp-' + hu[0].toLowerCase(), name: hu[0], group: 'Tonal ramps', colors: RAMP_L.map(function (l, i) { return hsl(hu[1], 92 - i * 3, l); }) };
    });
    return rampCache;
  }
  function colorSets() {
    var list = null;
    if (has('colorSets')) { try { list = LE.assets.colorSets(); } catch (e) { list = null; } }
    return Array.isArray(list) && list.length ? list : FALLBACK_SETS;
  }
  function st(list) { return list.map(function (c, i) { return { color: c, at: list.length === 1 ? 0 : i / (list.length - 1) }; }); }
  var FALLBACK_GRADS = [
    ['aurora', 'Aurora', 'Signature', 'linear', 135, st(['#00c9ff', '#92fe9d'])],
    ['amethyst', 'Amethyst', 'Signature', 'linear', 135, st(['#7457f0', '#e0668e'])],
    ['champagne', 'Champagne foil', 'Metallic', 'linear', 120, [{ color: '#b48a3c', at: 0 }, { color: '#f6e3a1', at: 0.45 }, { color: '#c99a45', at: 0.7 }, { color: '#f8ecc4', at: 1 }]],
    ['chrome', 'Chrome', 'Metallic', 'linear', 180, [{ color: '#f5f6f8', at: 0 }, { color: '#9aa3ad', at: 0.48 }, { color: '#5b636c', at: 0.5 }, { color: '#e3e6ea', at: 1 }]],
    ['rose-gold', 'Rose gold', 'Metallic', 'linear', 135, st(['#b76e79', '#f4c2c2', '#c48b9f'])],
    ['holo', 'Holographic', 'Metallic', 'linear', 120, st(['#ff9a9e', '#fad0c4', '#a1c4fd', '#c2e9fb', '#d4fc79'])],
    ['sunset', 'Sunset', 'Warm', 'linear', 180, st(['#ff512f', '#f09819', '#ffd56f'])],
    ['peach', 'Peach', 'Warm', 'linear', 135, st(['#ffecd2', '#fcb69f'])],
    ['flamingo', 'Flamingo', 'Warm', 'linear', 135, st(['#f857a6', '#ff5858'])],
    ['mango', 'Mango', 'Warm', 'linear', 135, st(['#ffe259', '#ffa751'])],
    ['ember', 'Ember', 'Warm', 'radial', 0, st(['#ffb347', '#ff5f6d', '#3a0d2e'])],
    ['ocean', 'Ocean', 'Cool', 'linear', 180, st(['#2e3192', '#1bffff'])],
    ['mint', 'Mint', 'Cool', 'linear', 135, st(['#d4fc79', '#96e6a1'])],
    ['lagoon', 'Lagoon', 'Cool', 'linear', 135, st(['#43cea2', '#185a9d'])],
    ['ice', 'Ice', 'Cool', 'linear', 180, st(['#e0eafc', '#cfdef3'])],
    ['deep-space', 'Deep space', 'Dark', 'linear', 180, st(['#000000', '#434343'])],
    ['midnight', 'Midnight', 'Dark', 'linear', 135, st(['#0f2027', '#203a43', '#2c5364'])],
    ['nebula', 'Nebula', 'Dark', 'radial', 0, st(['#5b2a86', '#1b1035', '#05030a'])],
    ['obsidian', 'Obsidian', 'Dark', 'linear', 160, st(['#17131f', '#3b2f63'])],
    ['lavender', 'Lavender', 'Soft', 'linear', 135, st(['#e0c3fc', '#8ec5fc'])],
    ['blush', 'Blush', 'Soft', 'linear', 180, st(['#fdfbfb', '#ebedee', '#fbc2eb'])],
    ['cream', 'Cream', 'Soft', 'linear', 180, st(['#fdfcfb', '#e2d1c3'])],
    ['sky', 'Sky', 'Soft', 'linear', 180, st(['#a1c4fd', '#c2e9fb'])],
    ['duo-violet', 'Violet duo', 'Duotone', 'linear', 90, [{ color: '#7457f0', at: 0 }, { color: '#7457f0', at: 0.5 }, { color: '#e0668e', at: 0.5 }, { color: '#e0668e', at: 1 }]],
    ['duo-sea', 'Sea duo', 'Duotone', 'linear', 0, [{ color: '#0f766e', at: 0 }, { color: '#0f766e', at: 0.5 }, { color: '#99f6e4', at: 0.5 }, { color: '#99f6e4', at: 1 }]],
    ['spotlight', 'Spotlight', 'Radial', 'radial', 0, st(['#ffffff', '#e7e5eb', '#a8a2b5'])],
    ['halo', 'Halo', 'Radial', 'radial', 0, st(['#fef3c7', '#f59e0b', '#7c2d12'])],
    ['wheel', 'Colour wheel', 'Conic', 'conic', 0, st(['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'])],
    ['pastel-wheel', 'Pastel wheel', 'Conic', 'conic', 45, st(['#fbcfe8', '#fde68a', '#bbf7d0', '#bae6fd', '#ddd6fe', '#fbcfe8'])],
    ['sunburst', 'Sunburst', 'Conic', 'conic', 0, st(['#f59e0b', '#fde68a', '#f59e0b', '#fde68a', '#f59e0b'])],
    ['mesh-dawn', 'Dawn mesh', 'Mesh', 'mesh', 0, st(['#ffd1dc', '#c3b1e1', '#a0e7e5', '#fff5ba', '#fdfcfb'])],
    ['mesh-aurora', 'Aurora mesh', 'Mesh', 'mesh', 0, st(['#7457f0', '#00c9ff', '#92fe9d', '#e0668e', '#17131f'])],
    ['mesh-peach', 'Peach mesh', 'Mesh', 'mesh', 0, st(['#ffb88c', '#de6262', '#ffe29f', '#ffa99f', '#fff1eb'])],
    ['mesh-lagoon', 'Lagoon mesh', 'Mesh', 'mesh', 0, st(['#43cea2', '#185a9d', '#a1c4fd', '#d4fc79', '#e0f7fa'])],
    ['mesh-gold', 'Gold mesh', 'Mesh', 'mesh', 0, st(['#f6e3a1', '#b48a3c', '#fff7e0', '#e2c178', '#f6efe1'])]
  ].map(function (g) { return { id: g[0], name: g[1], group: g[2], type: g[3], angle: g[4], stops: g[5] }; });
  function gradients() {
    var list = null;
    if (has('gradients')) { try { list = LE.assets.gradients(); } catch (e) { list = null; } }
    return (Array.isArray(list) && list.length ? list : FALLBACK_GRADS).filter(function (g) { return g && Array.isArray(g.stops) && g.stops.length; });
  }
  function patWrap(bg, inner) { return '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="' + bg + '"/>' + inner + '</svg>'; }
  var FALLBACK_PATTERNS = [
    ['dots', 'Dots', 'Geometric', function (f) { return '<circle cx="20" cy="20" r="3" fill="' + f + '"/>'; }],
    ['polka', 'Polka', 'Geometric', function (f) { return '<circle cx="10" cy="10" r="6" fill="' + f + '"/><circle cx="30" cy="30" r="6" fill="' + f + '"/>'; }],
    ['grid', 'Grid', 'Lines', function (f) { return '<path d="M0 .5H40M.5 0V40" stroke="' + f + '" stroke-width="1" fill="none"/>'; }],
    ['graph', 'Graph paper', 'Lines', function (f) { return '<path d="M0 .5H40M.5 0V40" stroke="' + f + '" stroke-width="1.2" fill="none"/><path d="M0 10.5H40M0 20.5H40M0 30.5H40M10.5 0V40M20.5 0V40M30.5 0V40" stroke="' + f + '" stroke-opacity=".35" stroke-width=".6" fill="none"/>'; }],
    ['stripes', 'Stripes', 'Lines', function (f) { return '<rect width="40" height="10" fill="' + f + '"/><rect y="20" width="40" height="10" fill="' + f + '"/>'; }],
    ['diagonal', 'Diagonal', 'Lines', function (f) { return '<path d="M-10 10L10 -10M0 40L40 0M30 50L50 30" stroke="' + f + '" stroke-width="5"/>'; }],
    ['chevron', 'Chevron', 'Geometric', function (f) { return '<path d="M0 15L10 5L20 15L30 5L40 15M0 35L10 25L20 35L30 25L40 35" stroke="' + f + '" stroke-width="3.5" fill="none"/>'; }],
    ['waves', 'Waves', 'Organic', function (f) { return '<path d="M0 10Q10 0 20 10T40 10M0 30Q10 20 20 30T40 30" stroke="' + f + '" stroke-width="2.5" fill="none"/>'; }],
    ['scallops', 'Scallops', 'Organic', function (f) { return '<path d="M0 20A10 10 0 0 1 20 20A10 10 0 0 1 40 20M-10 40A10 10 0 0 1 10 40A10 10 0 0 1 30 40A10 10 0 0 1 50 40" stroke="' + f + '" stroke-width="2" fill="none"/>'; }],
    ['checker', 'Checker', 'Geometric', function (f) { return '<rect width="20" height="20" fill="' + f + '"/><rect x="20" y="20" width="20" height="20" fill="' + f + '"/>'; }],
    ['gingham', 'Gingham', 'Textile', function (f) { return '<rect width="20" height="40" fill="' + f + '" fill-opacity=".45"/><rect width="40" height="20" fill="' + f + '" fill-opacity=".45"/>'; }],
    ['houndstooth', 'Houndstooth', 'Textile', function (f) { return '<path d="M0 0H10L20 10V20H10L0 10ZM20 20H30L40 30V40H30L20 30Z" fill="' + f + '"/>'; }],
    ['plus', 'Plus', 'Geometric', function (f) { return '<path d="M20 13V27M13 20H27" stroke="' + f + '" stroke-width="3" stroke-linecap="round"/>'; }],
    ['triangles', 'Triangles', 'Geometric', function (f) { return '<path d="M0 40L20 0L40 40Z" fill="' + f + '" fill-opacity=".8"/>'; }],
    ['hexagons', 'Hexagons', 'Geometric', function (f) { return '<path d="M10 2L30 2L40 20L30 38L10 38L0 20Z" stroke="' + f + '" stroke-width="2" fill="none"/>'; }],
    ['crosshatch', 'Cross-hatch', 'Lines', function (f) { return '<path d="M0 0L40 40M40 0L0 40" stroke="' + f + '" stroke-width="1.5"/>'; }],
    ['stars', 'Stars', 'Playful', function (f) { return '<path d="M20 9l3.1 6.6 7.2.8-5.4 4.9 1.5 7.1L20 24.8l-6.4 3.6 1.5-7.1-5.4-4.9 7.2-.8z" fill="' + f + '"/>'; }],
    ['hearts', 'Hearts', 'Playful', function (f) { return '<path d="M20 30s-9-5.6-9-11.4A5 5 0 0 1 20 16a5 5 0 0 1 9 2.6C29 24.4 20 30 20 30z" fill="' + f + '"/>'; }],
    ['confetti', 'Confetti', 'Playful', function (f) { return '<rect x="5" y="6" width="6" height="2.5" rx="1" transform="rotate(25 8 7)" fill="' + f + '"/><circle cx="30" cy="10" r="2" fill="' + f + '"/><rect x="24" y="28" width="6" height="2.5" rx="1" transform="rotate(-30 27 29)" fill="' + f + '"/><circle cx="10" cy="32" r="1.6" fill="' + f + '"/>'; }],
    ['terrazzo', 'Terrazzo', 'Organic', function (f) { return '<path d="M6 8l5-2 2 4-4 3z M28 6l6 1-1 5-5-1z M18 22l4-1 1 4-4 1z M4 30l5 1-2 5-4-2z M30 28l5-2 2 5-5 1z" fill="' + f + '"/>'; }],
    ['memphis', 'Memphis', 'Playful', function (f) { return '<path d="M4 10q4-6 8 0t8 0" stroke="' + f + '" stroke-width="2" fill="none"/><circle cx="30" cy="10" r="4" stroke="' + f + '" stroke-width="2" fill="none"/><path d="M8 26l6 10H2z" fill="' + f + '"/><path d="M26 28h10M31 23v10" stroke="' + f + '" stroke-width="2"/>'; }],
    ['rangoli', 'Rangoli', 'Festive', function (f) { return '<g fill="none" stroke="' + f + '" stroke-width="1.6"><circle cx="20" cy="20" r="4"/><path d="M20 6q5 7 0 14q-5-7 0-14M20 34q5-7 0-14q-5 7 0 14M6 20q7-5 14 0q-7 5-14 0M34 20q-7-5-14 0q7 5 14 0"/></g><circle cx="0" cy="0" r="2" fill="' + f + '"/><circle cx="40" cy="40" r="2" fill="' + f + '"/>'; }],
    ['zigzag', 'Zigzag', 'Lines', function (f) { return '<path d="M0 20L10 10L20 20L30 10L40 20" stroke="' + f + '" stroke-width="3" fill="none"/>'; }],
    ['diamonds', 'Diamonds', 'Geometric', function (f) { return '<path d="M20 4L32 20L20 36L8 20Z" fill="' + f + '" fill-opacity=".85"/>'; }]
  ].map(function (p) { return { id: p[0], name: p[1], group: p[2], tile: 40, svg: function (t, fg, bg) { return patWrap(bg, p[3](fg)).replace('width="40" height="40" viewBox', 'width="' + t + '" height="' + t + '" viewBox'); } }; });
  function patterns() {
    var list = null;
    if (has('patterns')) { try { list = LE.assets.patterns(); } catch (e) { list = null; } }
    return (Array.isArray(list) && list.length ? list : FALLBACK_PATTERNS).filter(function (p) { return p && typeof p.svg === 'function'; });
  }
  function seeded(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }
  var FALLBACK_TEXTURES = [
    ['grain', 'Film grain', function (x, w, hh, o) { noise(x, w, hh, o.fg, 0.16, 1); }],
    ['paper', 'Paper', function (x, w, hh, o) { noise(x, w, hh, o.fg, 0.07, 2); noise(x, w, hh, o.fg, 0.05, 6); }],
    ['linen', 'Linen', function (x, w, hh, o) {
      x.globalAlpha = 0.08; x.strokeStyle = o.fg; x.lineWidth = 1;
      var r = seeded(7);
      for (var i = 0; i < hh; i += 3) { x.globalAlpha = 0.04 + r() * 0.06; x.beginPath(); x.moveTo(0, i + 0.5); x.lineTo(w, i + 0.5); x.stroke(); }
      for (var j = 0; j < w; j += 3) { x.globalAlpha = 0.03 + r() * 0.05; x.beginPath(); x.moveTo(j + 0.5, 0); x.lineTo(j + 0.5, hh); x.stroke(); }
      x.globalAlpha = 1;
    }],
    ['concrete', 'Concrete', function (x, w, hh, o) { noise(x, w, hh, o.fg, 0.12, 3); noise(x, w, hh, o.fg, 0.1, 14); }],
    ['canvas', 'Canvas', function (x, w, hh, o) {
      x.strokeStyle = o.fg;
      for (var i = 0; i < Math.max(w, hh); i += 4) { x.globalAlpha = 0.06; x.beginPath(); x.moveTo(i, 0); x.lineTo(i, hh); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); }
      x.globalAlpha = 1;
      noise(x, w, hh, o.fg, 0.06, 1);
    }]
  ].map(function (t) { return { id: t[0], name: t[1], draw: t[2], local: true }; });
  function paintTexture(t, x, w, hh, fg, bg, scale) {
    if (t.local) return t.draw.call(t, x, w, hh, { fg: fg, bg: bg, scale: scale || 1 });
    x.save();
    (t.draw || t.render).call(t, x, w, hh, bg);
    x.restore();
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.globalAlpha = 0.18;
    x.fillStyle = fg;
    x.fillRect(0, 0, w, hh);
    x.restore();
  }
  function noise(x, w, hh, fg, amt, cell) {
    var f = parse(fg) || { r: 0, g: 0, b: 0 };
    var cw = Math.ceil(w / cell), ch = Math.ceil(hh / cell);
    var tmp = document.createElement('canvas');
    tmp.width = cw; tmp.height = ch;
    var t = tmp.getContext('2d');
    var id = t.createImageData(cw, ch);
    var r = seeded(cw * 31 + ch + cell);
    for (var i = 0; i < id.data.length; i += 4) { id.data[i] = f.r; id.data[i + 1] = f.g; id.data[i + 2] = f.b; id.data[i + 3] = Math.round(r() * 255 * amt); }
    t.putImageData(id, 0, 0);
    x.imageSmoothingEnabled = cell > 2;
    x.drawImage(tmp, 0, 0, cw * cell, ch * cell);
  }
  function textures() {
    var list = null;
    if (has('textures')) { try { list = LE.assets.textures(); } catch (e) { list = null; } }
    var ok = Array.isArray(list) ? list.filter(function (t) { return t && (typeof t.draw === 'function' || typeof t.render === 'function'); }) : [];
    var ids = ok.map(function (t) { return t.id; });
    return ok.concat(FALLBACK_TEXTURES.filter(function (t) { return ids.indexOf(t.id) < 0; }));
  }

  /* ---------- Gradient helpers ---------- */
  function sortStops(stops) { return stops.slice().sort(function (a, b) { return a.at - b.at; }); }
  function colorAt(stops, t) {
    var s = sortStops(stops);
    if (t <= s[0].at) return s[0].color;
    for (var i = 1; i < s.length; i++) {
      if (t <= s[i].at) {
        var span = s[i].at - s[i - 1].at;
        return mix(s[i - 1].color, s[i].color, span ? (t - s[i - 1].at) / span : 1);
      }
    }
    return s[s.length - 1].color;
  }
  function isEven(stops) {
    var s = sortStops(stops);
    return s.length <= 8 && s.every(function (x, i) { return Math.abs(x.at - (s.length === 1 ? 0 : i / (s.length - 1))) < 0.02; });
  }
  function resample(stops) {
    if (isEven(stops)) return sortStops(stops).map(function (x) { return x.color; });
    var out = [];
    for (var i = 0; i < 8; i++) out.push(colorAt(stops, i / 7));
    return out;
  }
  function stopCss(stops) { return sortStops(stops).map(function (x) { return x.color + ' ' + Math.round(x.at * 1000) / 10 + '%'; }).join(','); }
  var MESH_PTS = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0, 0.5], [1, 0.5], [0.5, 0]];
  function meshPoints(g) {
    if (Array.isArray(g.points) && g.points.length) return g.points;
    var s = sortStops(g.stops);
    var base = s[s.length - 1];
    return s.slice(0, Math.max(1, s.length - 1)).slice(0, 8).map(function (x, i) { return { x: MESH_PTS[i][0], y: MESH_PTS[i][1], color: x.color, r: 0.75 }; }).concat(s.length > 1 ? [] : [{ x: 0.5, y: 0.5, color: base.color, r: 1 }]);
  }
  function meshBase(g) { var s = sortStops(g.stops); return s[s.length - 1].color; }
  function gradCss(g) {
    if (!g) return 'transparent';
    var type = g.type || 'linear';
    if (type === 'mesh') {
      if (typeof g.css === 'string' && /gradient\(/.test(g.css) && !/url\(/i.test(g.css)) return g.css;
      return meshPoints(g).map(function (p) { return 'radial-gradient(circle at ' + Math.round(p.x * 100) + '% ' + Math.round(p.y * 100) + '%, ' + p.color + ' 0%, ' + hex6(p.color) + '00 ' + Math.round((p.r || 0.75) * 100) + '%)'; }).join(',') + ',' + meshBase(g);
    }
    if (type === 'radial') return 'radial-gradient(circle at 50% 50%,' + stopCss(g.stops) + ')';
    if (type === 'conic') return 'conic-gradient(from ' + (g.angle || 0) + 'deg at 50% 50%,' + stopCss(g.stops) + ')';
    return 'linear-gradient(' + (g.angle == null ? 180 : g.angle) + 'deg,' + stopCss(g.stops) + ')';
  }
  function paintGradient(x, w, hh, g) {
    var type = g.type || 'linear';
    var s = sortStops(g.stops);
    var grad;
    if (type === 'mesh') {
      x.fillStyle = meshBase(g);
      x.fillRect(0, 0, w, hh);
      var R = Math.max(w, hh);
      meshPoints(g).forEach(function (p) {
        var rg = x.createRadialGradient(p.x * w, p.y * hh, 0, p.x * w, p.y * hh, (p.r || 0.75) * R);
        rg.addColorStop(0, p.color);
        rg.addColorStop(1, hex6(p.color) + '00');
        x.fillStyle = rg;
        x.fillRect(0, 0, w, hh);
      });
      return;
    }
    if (type === 'radial') {
      grad = x.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, Math.hypot(w, hh) / 2);
    } else if (type === 'conic' && x.createConicGradient) {
      grad = x.createConicGradient(((g.angle || 0) - 90) * Math.PI / 180, w / 2, hh / 2);
    } else if (type === 'conic') {
      var steps = 180;
      for (var i = 0; i < steps; i++) {
        var a0 = ((g.angle || 0) - 90 + i * 2) * Math.PI / 180;
        x.fillStyle = colorAt(s, i / steps);
        x.beginPath(); x.moveTo(w / 2, hh / 2); x.arc(w / 2, hh / 2, Math.hypot(w, hh), a0, a0 + 2.2 * Math.PI / 180); x.closePath(); x.fill();
      }
      return;
    } else {
      var a = (g.angle == null ? 180 : g.angle) * Math.PI / 180;
      var dx = Math.sin(a), dy = -Math.cos(a);
      var L = Math.abs(w * dx) + Math.abs(hh * dy);
      grad = x.createLinearGradient(w / 2 - dx * L / 2, hh / 2 - dy * L / 2, w / 2 + dx * L / 2, hh / 2 + dy * L / 2);
    }
    s.forEach(function (p) { grad.addColorStop(clamp(p.at, 0, 1), p.color); });
    x.fillStyle = grad;
    x.fillRect(0, 0, w, hh);
  }
  function toFill(g) { return { type: g.type === 'radial' ? 'radial' : 'linear', colors: resample(g.stops), angle: Math.round(((g.angle == null ? 180 : g.angle) - 90) * 10) / 10 }; }
  function fromFill(f) {
    if (!f || typeof f !== 'object') return null;
    var cols = f.colors && f.colors.length ? f.colors : f.color ? [f.color, f.color] : null;
    if (!cols) return null;
    if (cols.length === 1) cols = [cols[0], cols[0]];
    return { type: (f.type === 'radial' || f.kind === 'radial') ? 'radial' : 'linear', angle: (f.angle || 0) + 90, stops: st(cols) };
  }

  /* ---------- Brand kit ---------- */
  var kit = { name: 'Brand kit', colors: [], fonts: [], logos: [] };
  var kitReady = null;
  function loadKit() {
    if (!kitReady) kitReady = (LE.project && LE.project.brandKit ? LE.project.brandKit() : Promise.resolve(kit)).then(function (k) { kit = k || kit; return kit; }).catch(function () { return kit; });
    return kitReady;
  }
  function saveKit(c, next) {
    kit = next;
    var p = LE.project && LE.project.saveBrandKit ? LE.project.saveBrandKit(next) : Promise.resolve(next);
    return p.then(function (k) { kit = k; if (c && c.S.panel === 'brand') c.renderPanel(true); return k; }).catch(function () { if (c) c.toast('Could not save the brand kit.'); });
  }
  function addKitColor(c, col) {
    var x = hex6(col);
    if (kit.colors.indexOf(x) >= 0) { c.toast('Already in your brand kit'); return; }
    var next = Object.assign({}, kit, { colors: kit.colors.concat([x]).slice(0, 40) });
    saveKit(c, next).then(function () { c.toast('Added ' + x + ' to your brand kit'); });
  }
  hook('init', function () { loadKit(); });

  /* ---------- Swatch helpers ---------- */
  function swatch(c, col, label, on, fn) {
    var b = c.h('<button type="button" class="sx-sw" aria-label="' + c.esc(label || col) + '" title="' + c.esc(label || col) + '" aria-pressed="' + !!on + '"><i></i></button>');
    var i = b.querySelector('i');
    if (typeof col === 'string') i.style.background = col; else i.style.background = gradCss(col);
    if (typeof col === 'string' && lum(col) > 0.72) b.classList.add('is-light');
    if (typeof col === 'string' && (parse(col) || {}).a === 0) b.classList.add('is-clear');
    b.onclick = function (e) { fn(col, e); };
    return b;
  }
  function swRow(c, title, list, cur, fn, extra) {
    if (!list.length && !extra) return null;
    var s = c.h('<div class="sx-cp-sec"><div class="sx-cp-sec-h"><span>' + c.esc(title) + '</span></div><div class="sx-sws"></div></div>');
    var row = s.querySelector('.sx-sws');
    list.forEach(function (col) { row.appendChild(swatch(c, col, col, cur && hex(col) === hex(cur), fn)); });
    if (extra) row.appendChild(extra);
    return s;
  }

  /* ---------- Solid editor (HSV square + hue + alpha + inputs) ---------- */
  function dragOn(el, fn, end) {
    el.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      var raf = 0, last = null;
      function at(ev) {
        var r = el.getBoundingClientRect();
        last = [clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)];
        if (!raf) raf = requestAnimationFrame(function () { raf = 0; fn(last[0], last[1]); });
      }
      at(e);
      function mv(ev) { at(ev); }
      function up() {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (raf) { cancelAnimationFrame(raf); raf = 0; fn(last[0], last[1]); }
        if (end) end();
      }
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
  function solidEditor(c, start, o) {
    o = o || {};
    var p = parse(start) || { r: 116, g: 87, b: 240, a: 1 };
    var hsv = rgb2hsv(p), a = p.a == null ? 1 : p.a;
    var mode = c.lsGet('le-studio-cpmode', 'hex');
    var n = c.h('<div class="sx-cp-solid">' +
      '<div class="sx-cp-sv" tabindex="0" role="slider" aria-label="Saturation and brightness"><i class="sx-cp-knob"></i></div>' +
      '<div class="sx-cp-row">' +
      '<button type="button" class="sx-iconbtn sx-cp-eye" aria-label="Pick a colour from the screen" title="Eyedropper">' + c.ic('pipette') + '</button>' +
      '<div class="sx-cp-bars"><div class="sx-cp-hue" tabindex="0" role="slider" aria-label="Hue" aria-valuemin="0" aria-valuemax="360"><i></i></div>' +
      (o.alpha === false ? '' : '<div class="sx-cp-alpha" tabindex="0" role="slider" aria-label="Opacity" aria-valuemin="0" aria-valuemax="100"><b></b><i></i></div>') + '</div>' +
      '<span class="sx-cp-prev"><i></i></span></div>' +
      '<div class="sx-cp-in"><select class="sx-input" aria-label="Colour format"><option value="hex">HEX</option><option value="rgb">RGB</option></select><div class="sx-cp-fields"></div>' +
      (o.alpha === false ? '' : '<label class="sx-cp-a"><input class="sx-input" inputmode="numeric" maxlength="3" aria-label="Opacity percent"><span>%</span></label>') + '</div></div>');
    var sv = n.querySelector('.sx-cp-sv'), knob = sv.querySelector('i');
    var hue = n.querySelector('.sx-cp-hue'), alpha = n.querySelector('.sx-cp-alpha');
    var prev = n.querySelector('.sx-cp-prev i'), fields = n.querySelector('.sx-cp-fields'), sel = n.querySelector('select'), aIn = n.querySelector('.sx-cp-a input');
    sel.value = mode;
    function value() {
      var rgb = hsv2rgb(hsv.h, hsv.s, hsv.v);
      return hex({ r: rgb.r, g: rgb.g, b: rgb.b, a: a });
    }
    function paint(skipFields) {
      var pure = hsl(hsv.h, 100, 50);
      sv.style.background = 'linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,' + pure + ')';
      knob.style.left = (hsv.s * 100) + '%';
      knob.style.top = ((1 - hsv.v) * 100) + '%';
      knob.style.background = hex6(value());
      hue.querySelector('i').style.left = (hsv.h / 360 * 100) + '%';
      hue.setAttribute('aria-valuenow', Math.round(hsv.h));
      if (alpha) {
        alpha.querySelector('b').style.background = 'linear-gradient(to right,' + hex6(value()) + '00,' + hex6(value()) + ')';
        alpha.querySelector('i').style.left = (a * 100) + '%';
        alpha.setAttribute('aria-valuenow', Math.round(a * 100));
      }
      prev.style.background = value();
      if (!skipFields) drawFields();
    }
    function drawFields() {
      var v = value(), q = parse(v);
      if (mode === 'rgb') {
        fields.innerHTML = '<input class="sx-input" inputmode="numeric" maxlength="3" aria-label="Red" value="' + Math.round(q.r) + '"><input class="sx-input" inputmode="numeric" maxlength="3" aria-label="Green" value="' + Math.round(q.g) + '"><input class="sx-input" inputmode="numeric" maxlength="3" aria-label="Blue" value="' + Math.round(q.b) + '">';
        [].forEach.call(fields.querySelectorAll('input'), function (inp) { inp.onchange = fromRgb; });
      } else {
        fields.innerHTML = '<input class="sx-input sx-hex" maxlength="7" spellcheck="false" aria-label="Hex colour" value="' + hex6(v) + '">';
        fields.querySelector('input').onchange = function (e) {
          var t = e.target.value.trim();
          if (!/^#/.test(t)) t = '#' + t;
          var pp = parse(t);
          if (!pp) { e.target.value = hex6(value()); return; }
          setFrom(pp, true);
        };
      }
      if (aIn) aIn.value = Math.round(a * 100);
    }
    function fromRgb() {
      var ins = fields.querySelectorAll('input');
      setFrom({ r: clamp(Number(ins[0].value) || 0, 0, 255), g: clamp(Number(ins[1].value) || 0, 0, 255), b: clamp(Number(ins[2].value) || 0, 0, 255), a: a }, true);
    }
    function setFrom(pp, commit) {
      var x = rgb2hsv(pp);
      if (x.s === 0 || x.v === 0) x.h = hsv.h;
      hsv = x;
      if (pp.a != null) a = pp.a;
      paint();
      if (o.onInput) o.onInput(value(), commit);
    }
    function live(skip) { paint(skip); if (o.onInput) o.onInput(value(), false); }
    function end() { if (o.onInput) o.onInput(value(), true); }
    dragOn(sv, function (x, y) { hsv.s = x; hsv.v = 1 - y; live(); }, end);
    dragOn(hue, function (x) { hsv.h = x * 360; if (!hsv.s) hsv.s = 0.6; if (!hsv.v) hsv.v = 0.8; live(); }, end);
    if (alpha) dragOn(alpha, function (x) { a = Math.round(x * 100) / 100; live(); }, end);
    function keys(el, fn) {
      el.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 10 : 1;
        var d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
        if (!d) return;
        e.preventDefault();
        fn(d[0], d[1]);
        live();
        clearTimeout(el._t);
        el._t = setTimeout(end, 400);
      });
    }
    keys(sv, function (dx, dy) { hsv.s = clamp(hsv.s + dx / 100, 0, 1); hsv.v = clamp(hsv.v + dy / 100, 0, 1); });
    keys(hue, function (dx, dy) { hsv.h = (hsv.h + dx + dy + 360) % 360; });
    if (alpha) keys(alpha, function (dx, dy) { a = clamp(Math.round(a * 100 + dx + dy) / 100, 0, 1); });
    sel.onchange = function () { mode = sel.value; c.lsSet('le-studio-cpmode', mode); drawFields(); };
    if (aIn) aIn.onchange = function () { a = clamp((Number(aIn.value) || 0) / 100, 0, 1); paint(); end(); };
    n.querySelector('.sx-cp-eye').onclick = function () {
      if (window.EyeDropper) {
        new window.EyeDropper().open().then(function (r) { setFrom(Object.assign(parse(r.sRGBHex), { a: a }), true); }).catch(function () {});
        return;
      }
      var fn = o.onInput;
      c.closePop();
      c.startPick(function (hx) { if (fn) fn(hex(Object.assign(parse(hx), { a: a })), true); }, 'Tap anywhere on the design to pick a colour');
    };
    n.set = function (col) { var pp = parse(col); if (!pp) return; var x = rgb2hsv(pp); if (x.s === 0 || x.v === 0) x.h = hsv.h; hsv = x; a = pp.a == null ? 1 : pp.a; paint(); };
    n.value = value;
    paint();
    return n;
  }

  /* ---------- Gradient editor ---------- */
  var TYPE_NAMES = { linear: 'Linear', radial: 'Radial', conic: 'Conic', mesh: 'Mesh' };
  function gradEditor(c, g0, o) {
    var g = { type: g0.type || 'linear', angle: g0.angle == null ? 180 : g0.angle, stops: sortStops(g0.stops.map(function (x) { return { color: x.color, at: clamp(Number(x.at) || 0, 0, 1) }; })) };
    if (g.stops.length < 2) g.stops = [g.stops[0] || { color: '#7457f0', at: 0 }, { color: '#e0668e', at: 1 }];
    var types = o.types || ['linear', 'radial'];
    if (types.indexOf(g.type) < 0) g.type = types[0];
    var selI = 0;
    var n = c.h('<div class="sx-ge"><div class="sx-ge-preview"></div><div class="sx-ge-track"><div class="sx-ge-bar" role="group" aria-label="Gradient stops — click to add"></div></div><div class="sx-ge-tools"></div><div class="sx-ge-ctrl"></div><div class="sx-ge-color"></div></div>');
    var bar = n.querySelector('.sx-ge-bar'), preview = n.querySelector('.sx-ge-preview'), tools = n.querySelector('.sx-ge-tools'), ctrl = n.querySelector('.sx-ge-ctrl');
    function out(commit) { if (o.onInput) o.onInput({ type: g.type, angle: g.angle, stops: g.stops.map(function (x) { return { color: x.color, at: Math.round(x.at * 1000) / 1000 }; }) }, commit); }
    function paint() {
      preview.style.background = gradCss(g);
      bar.style.background = 'linear-gradient(90deg,' + stopCss(g.stops) + ')';
      bar.innerHTML = '';
      g.stops.forEach(function (s, i) {
        var b = c.h('<button type="button" class="sx-ge-stop" aria-label="Stop ' + (i + 1) + ' ' + s.color + ' at ' + Math.round(s.at * 100) + '%" aria-pressed="' + (i === selI) + '"><i></i></button>');
        b.style.left = (s.at * 100) + '%';
        b.querySelector('i').style.background = s.color;
        b.addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          e.preventDefault();
          selI = i;
          var r = bar.getBoundingClientRect();
          b.setPointerCapture(e.pointerId);
          [].forEach.call(bar.children, function (x, j) { x.setAttribute('aria-pressed', j === i); });
          ed.set(g.stops[i].color);
          var moved = false;
          function mv(ev) { moved = true; g.stops[i].at = clamp((ev.clientX - r.left) / r.width, 0, 1); b.style.left = (g.stops[i].at * 100) + '%'; preview.style.background = gradCss(g); bar.style.background = 'linear-gradient(90deg,' + stopCss(g.stops) + ')'; out(false); }
          function up() {
            b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up);
            var cur = g.stops[selI];
            g.stops = sortStops(g.stops);
            selI = g.stops.indexOf(cur);
            if (moved) out(true);
            paint();
          }
          b.addEventListener('pointermove', mv); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
        });
        b.addEventListener('keydown', function (e) {
          if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeStop(i); return; }
          var d = e.key === 'ArrowLeft' ? -0.01 : e.key === 'ArrowRight' ? 0.01 : 0;
          if (!d) return;
          e.preventDefault();
          g.stops[i].at = clamp(g.stops[i].at + d * (e.shiftKey ? 10 : 1), 0, 1);
          selI = i;
          out(true);
          paint();
          var nb = bar.children[i]; if (nb) nb.focus();
        });
        bar.appendChild(b);
      });
    }
    bar.addEventListener('pointerdown', function (e) {
      if (e.target !== bar) return;
      var r = bar.getBoundingClientRect();
      var t = clamp((e.clientX - r.left) / r.width, 0, 1);
      if (g.stops.length >= 10) { c.toast('Up to 10 colour stops'); return; }
      var stp = { color: colorAt(g.stops, t), at: t };
      g.stops.push(stp);
      g.stops = sortStops(g.stops);
      selI = g.stops.indexOf(stp);
      ed.set(stp.color);
      out(true);
      paint();
    });
    function removeStop(i) {
      if (g.stops.length <= 2) { c.toast('A gradient needs at least two colours'); return; }
      g.stops.splice(i, 1);
      selI = Math.min(selI, g.stops.length - 1);
      ed.set(g.stops[selI].color);
      out(true);
      paint();
    }
    var tb = function (label, icon, fn) { var b = c.h('<button type="button" class="sx-chip">' + c.ic(icon) + c.esc(label) + '</button>'); b.onclick = fn; tools.appendChild(b); };
    tb('Reverse', 'flip', function () { g.stops = sortStops(g.stops.map(function (x) { return { color: x.color, at: 1 - x.at }; })); out(true); paint(); });
    tb('Even out', 'distH', function () { g.stops = st(g.stops.map(function (x) { return x.color; })); out(true); paint(); });
    tb('Remove stop', 'trash', function () { removeStop(selI); });
    function drawCtrl() {
      ctrl.innerHTML = '';
      if (types.length > 1) ctrl.appendChild(c.ui.seg(types.map(function (t) { return [t, TYPE_NAMES[t]]; }), g.type, function (t) { g.type = t; out(true); paint(); drawCtrl(); }, 'sx-seg-sm sx-seg-fill'));
      if (g.type === 'linear' || g.type === 'conic') {
        ctrl.appendChild(c.ui.slider({ label: g.type === 'conic' ? 'Rotation' : 'Angle', min: 0, max: 360, value: g.angle, reset: 180, fmt: function (v) { return v + '°'; }, onInput: function (v) { g.angle = v; preview.style.background = gradCss(g); out(false); }, onEnd: function () { out(true); } }));
      }
    }
    var ed = solidEditor(c, g.stops[0].color, { onInput: function (v, commit) { if (!g.stops[selI]) return; g.stops[selI].color = v; preview.style.background = gradCss(g); bar.style.background = 'linear-gradient(90deg,' + stopCss(g.stops) + ')'; var sb = bar.children[selI]; if (sb) sb.querySelector('i').style.background = v; out(commit); } });
    n.querySelector('.sx-ge-color').appendChild(ed);
    drawCtrl();
    paint();
    n.set = function (ng) { g = { type: types.indexOf(ng.type) >= 0 ? ng.type : types[0], angle: ng.angle == null ? 180 : ng.angle, stops: sortStops(ng.stops.map(function (x) { return { color: x.color, at: x.at }; })) }; selI = 0; ed.set(g.stops[0].color); drawCtrl(); paint(); };
    return n;
  }

  /* ---------- Palettes browser ---------- */
  function palettes(c, host, cur, fn) {
    var wrap = c.h('<div class="sx-cp-pals"></div>');
    var q = '';
    var input = U.searchBox(c, wrap, 'Search colours, moods, hex', '', function (v) { q = v.toLowerCase(); draw(); });
    input.parentNode.classList.add('is-inset');
    var list = c.h('<div class="sx-cp-pal-list"></div>');
    wrap.appendChild(list);
    function draw() {
      list.innerHTML = '';
      var sets = colorSets().concat(ramps());
      var groups = {}, order = [];
      sets.forEach(function (s) {
        var hay = (s.name + ' ' + (s.group || '') + ' ' + s.colors.join(' ')).toLowerCase();
        if (q && hay.indexOf(q) < 0) return;
        var gname = s.group || 'More';
        if (!groups[gname]) { groups[gname] = []; order.push(gname); }
        groups[gname].push(s);
      });
      order.forEach(function (gname) {
        var gs = c.h('<div class="sx-cp-group"><span class="sx-eyebrow">' + c.esc(gname) + '</span></div>');
        groups[gname].forEach(function (s) {
          var row = c.h('<div class="sx-cp-set"><span class="sx-cp-set-name">' + c.esc(s.name) + '</span><div class="sx-sws is-tight"></div></div>');
          s.colors.forEach(function (col) { row.lastChild.appendChild(swatch(c, col, s.name + ' ' + col, cur && hex6(col) === hex6(cur), fn)); });
          gs.appendChild(row);
        });
        list.appendChild(gs);
      });
      if (!order.length) list.appendChild(U.note(c, 'No colours match “' + q + '”. Try a mood like ocean, pastel or gold — or paste a hex code.'));
      if (q && parse(q.charAt(0) === '#' ? q : '#' + q) && /^#?[0-9a-f]{3,8}$/.test(q)) {
        var hx = q.charAt(0) === '#' ? q : '#' + q;
        list.insertBefore(swRow(c, 'Use this hex', [hex(hx)], cur, fn), list.firstChild);
      }
    }
    draw();
    host.appendChild(wrap);
    return wrap;
  }
  function quickRows(c, host, cur, fn, withKit) {
    var r1 = swRow(c, 'Document colours', c.docColors(), cur, fn);
    if (r1) host.appendChild(r1);
    var r2 = swRow(c, 'Recent', c.S.recentColors || [], cur, fn);
    if (r2) host.appendChild(r2);
    if (withKit !== false) {
      var add = c.h('<button type="button" class="sx-sw is-add" aria-label="Add the current colour to your brand kit" title="Add to brand kit">' + c.ic('plus') + '</button>');
      add.onclick = function () { addKitColor(c, typeof cur === 'string' ? cur : '#7457f0'); };
      var r3 = swRow(c, 'Brand kit', kit.colors, cur, fn, add);
      host.appendChild(r3);
    }
  }

  /* ---------- Colour popover ---------- */
  function pop(c, anchor, o) {
    o = o || {};
    var key = c.gesture();
    var val = o.value;
    var isGrad = val && typeof val === 'object' && (val.type === 'linear' || val.type === 'radial');
    var cur = typeof val === 'string' ? val : val && val.color ? val.color : isGrad ? (val.colors || [])[0] : '#7457f0';
    var tab = isGrad && o.gradient ? 'gradient' : c.S.cpTab === 'palettes' ? 'palettes' : 'solid';
    var root = c.h('<div class="sx-cp"><div class="sx-cp-tabs"></div><div class="sx-cp-body"></div></div>');
    var body = root.querySelector('.sx-cp-body');
    var ed = null;
    function emit(v, commit) {
      o.onChange(v, key);
      if (commit) {
        if (typeof v === 'string') c.addRecent(v);
        key = c.gesture();
      }
    }
    function pickSolid(col) { cur = col; if (ed && ed.set) ed.set(col); emit(col, true); if (tab === 'palettes') drawTab(); }
    var tabList = [['solid', 'Solid']].concat(o.gradient ? [['gradient', 'Gradient']] : []).concat([['palettes', 'Palettes']]);
    var seg = c.ui.seg(tabList, tab, function (t) { tab = t; if (t !== 'gradient') c.S.cpTab = t; drawTab(); }, 'sx-seg-sm sx-seg-fill');
    root.querySelector('.sx-cp-tabs').appendChild(seg);
    if (o.none) {
      var none = c.h('<button type="button" class="sx-iconbtn sx-cp-none" aria-label="No colour" title="No colour">' + c.ic('x') + '</button>');
      none.onclick = function () { emit(o.none === 'null' ? null : { type: 'none' }, true); c.closePop(); };
      root.querySelector('.sx-cp-tabs').appendChild(none);
    }
    function drawTab() {
      body.innerHTML = '';
      ed = null;
      if (tab === 'solid') {
        ed = solidEditor(c, cur, { alpha: o.alpha, onInput: function (v, commit) { cur = v; emit(v, commit); } });
        body.appendChild(ed);
        quickRows(c, body, cur, pickSolid);
        var lib = swRow(c, 'LocalEditor palette', c.PALETTE, cur, pickSolid);
        if (lib) body.appendChild(lib);
      } else if (tab === 'gradient') {
        var g0 = isGrad ? fromFill(val) : { type: 'linear', angle: 135, stops: st([cur, mix(cur, '#ffffff', 0.55)]) };
        var ge = gradEditor(c, g0, { types: ['linear', 'radial'], onInput: function (g, commit) { val = toFill(g); isGrad = true; emit(val, commit); } });
        body.appendChild(ge);
        var gsec = c.h('<div class="sx-cp-sec"><div class="sx-cp-sec-h"><span>Presets</span></div><div class="sx-sws is-grad"></div></div>');
        gradients().filter(function (g) { return g.type === 'linear' || g.type === 'radial'; }).slice(0, 40).forEach(function (g) {
          gsec.lastChild.appendChild(swatch(c, g, g.name, false, function () { ge.set(g); val = toFill(g); isGrad = true; emit(val, true); }));
        });
        body.appendChild(gsec);
      } else {
        palettes(c, body, cur, pickSolid);
      }
      c.placePop();
    }
    drawTab();
    var b = c.openPop(anchor, root, { title: o.title || 'Colour', cls: 'is-color' });
    return b;
  }
  P._colorPop = pop;

  /* ---------- Page background ---------- */
  var BGP = null;
  function bgPreview(c, bg) {
    var sc = c.scene;
    if (!BGP) BGP = { orig: c.clone(sc._doc.background || { type: 'color', color: '#ffffff' }) };
    sc._doc.background = bg;
    sc._mark();
  }
  function bgCommit(c, bg) {
    var sc = c.scene;
    if (BGP) { sc._doc.background = BGP.orig; BGP = null; }
    c.setBackground(bg);
  }
  function bgCancel(c) {
    if (!BGP) return;
    c.scene._doc.background = BGP.orig;
    BGP = null;
    c.scene._mark();
  }
  var rasterCanvas = null;
  function rasterSize(d, cap) {
    var s = Math.min(1, cap / Math.max(d.width, d.height));
    return { w: Math.max(1, Math.round(d.width * s)), h: Math.max(1, Math.round(d.height * s)) };
  }
  function svgImage(markup) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Pattern failed to draw')); };
      img.src = url;
    });
  }
  function findPattern(id) { return patterns().filter(function (p) { return p.id === id; })[0] || patterns()[0]; }
  function findTexture(id) { return textures().filter(function (t) { return t.id === id; })[0] || textures()[0]; }
  function drawSpec(c, spec, d, cap) {
    var sz = rasterSize(d, cap);
    var cv = document.createElement('canvas');
    cv.width = sz.w; cv.height = sz.h;
    var x = cv.getContext('2d');
    var k = sz.w / d.width;
    if (spec.kind === 'gradient') { paintGradient(x, sz.w, sz.h, spec); return Promise.resolve(cv); }
    x.fillStyle = spec.bg || '#ffffff';
    x.fillRect(0, 0, sz.w, sz.h);
    if (spec.kind === 'texture') {
      var t = findTexture(spec.id);
      try { paintTexture(t, x, sz.w, sz.h, spec.fg, spec.bg, spec.scale); } catch (e) { console.error(e); }
      return Promise.resolve(cv);
    }
    var pat = findPattern(spec.id);
    var tile = Math.max(6, Math.round(48 * (spec.scale || 1) * Math.min(d.width, d.height) / 1080 * k));
    var markup;
    try { markup = pat.svg(tile, hex(spec.fg || '#17131f'), hex(spec.bg || '#ffffff')); } catch (e) { return Promise.reject(e); }
    if (LE.project && LE.project.sanitizeSvg) markup = LE.project.sanitizeSvg(markup) || markup;
    return svgImage(markup).then(function (img) {
      var tc = document.createElement('canvas');
      tc.width = tile; tc.height = tile;
      tc.getContext('2d').drawImage(img, 0, 0, tile, tile);
      x.fillStyle = x.createPattern(tc, 'repeat');
      x.fillRect(0, 0, sz.w, sz.h);
      return cv;
    });
  }
  function nativeGradient(spec) {
    if (spec.kind !== 'gradient' || (spec.type !== 'linear' && spec.type !== 'radial') || !isEven(spec.stops)) return null;
    return { type: 'gradient', kind: spec.type, colors: sortStops(spec.stops).map(function (x) { return x.color; }), angle: Math.round(((spec.angle == null ? 180 : spec.angle) - 90) * 10) / 10, spec: spec };
  }
  var previewTok = 0;
  function previewSpec(c, spec) {
    var nat = nativeGradient(spec);
    if (nat) { bgPreview(c, nat); return; }
    var my = ++previewTok;
    drawSpec(c, spec, c.doc(), 720).then(function (cv) {
      if (my !== previewTok) return;
      c.scene.addAsset('le-bg-preview', cv);
      bgPreview(c, { type: 'image', src: 'le-bg-preview', fit: 'fill', color: spec.bg || '#ffffff', spec: spec });
    }).catch(function () {});
  }
  function specToBg(c, spec, d) {
    var nat = nativeGradient(spec);
    if (nat) return Promise.resolve(nat);
    var cap = spec.kind === 'gradient' ? 2048 : 4096;
    return drawSpec(c, spec, d, cap).then(function (cv) {
      var jpeg = spec.kind === 'gradient' || spec.kind === 'texture';
      return LE.toBlob(cv, jpeg ? 'image/jpeg' : 'image/png', jpeg ? 0.93 : undefined);
    }).then(function (blob) {
      return c.ingest(new File([blob], 'background-' + (spec.id || spec.kind) + (blob.type === 'image/png' ? '.png' : '.jpg'), { type: blob.type }));
    }).then(function (meta) {
      return { type: 'image', src: meta.id, fit: 'fill', color: spec.kind === 'gradient' ? sortStops(spec.stops)[0].color : spec.bg || '#ffffff', spec: spec };
    });
  }
  var commitTok = 0;
  function commitSpec(c, spec) {
    var my = ++commitTok;
    return specToBg(c, spec, c.doc()).then(function (bg) {
      if (my !== commitTok) return;
      bgCommit(c, bg);
    }).catch(function (err) { bgCancel(c); c.toast(err && err.message ? err.message : 'Could not set that background.'); });
  }
  var specTimer = 0;
  function liveSpec(c, spec, commit) {
    previewSpec(c, spec);
    clearTimeout(specTimer);
    if (commit) specTimer = setTimeout(function () { commitSpec(c, spec); }, 60);
  }
  hook('resize', function (c) {
    var bg = c.doc().background;
    if (!bg || bg.type !== 'image' || !bg.spec) return;
    specToBg(c, bg.spec, c.doc()).then(function (nb) {
      c.scene._doc.background = nb;
      c.scene._mark();
      c.markDirty();
    }).catch(function () {});
  });

  function bgTabOf(bg) {
    if (!bg) return 'solid';
    if (bg.spec) return bg.spec.kind === 'gradient' ? 'gradients' : bg.spec.kind === 'pattern' ? 'patterns' : 'photos';
    if (bg.type === 'gradient') return 'gradients';
    if (bg.type === 'image') return 'photos';
    return 'solid';
  }
  function bgGradSpec(bg) {
    if (bg && bg.spec && bg.spec.kind === 'gradient') return bg.spec;
    if (bg && bg.type === 'gradient') { var f = fromFill({ type: bg.kind || 'linear', colors: bg.colors, angle: bg.angle }); return f ? Object.assign({ kind: 'gradient', id: 'custom' }, f) : null; }
    return null;
  }
  P.background = {
    title: 'Background', eyebrow: 'Colour, gradient, pattern, photo', select: true,
    render: function (c, body, o) {
      if (U.needProject(c, body)) return;
      var bg = c.doc().background || { type: 'color', color: '#ffffff' };
      var tab = o.tab || (o.section === 'remove' ? 'photos' : bgTabOf(bg));
      var bar = c.h('<div class="sx-sticky"></div>');
      body.appendChild(bar);
      U.tabs(c, bar, [['solid', 'Solid'], ['gradients', 'Gradients'], ['patterns', 'Patterns'], ['photos', 'Photos']], tab, function (t) { c.S.panelOpts.tab = t; c.S.panelOpts.section = null; c.renderPanel(true); }).classList.add('is-fill');
      var host = c.h('<div class="sx-bg-host"></div>');
      body.appendChild(host);
      if (tab === 'solid') bgSolid(c, host, bar, bg);
      else if (tab === 'gradients') bgGradients(c, host, bar, bg);
      else if (tab === 'patterns') bgPatterns(c, host, bg);
      else bgPhotos(c, host, bg, o);
    }
  };
  function bgSolid(c, host, bar, bg) {
    var cur = bg.type === 'color' ? bg.color : '#ffffff';
    var card = c.h('<div class="sx-card sx-bg-card"></div>');
    var ed = solidEditor(c, cur, {
      onInput: function (v, commit) {
        cur = v;
        if (commit) { bgCommit(c, { type: 'color', color: v }); c.addRecent(v); markOn(); }
        else bgPreview(c, { type: 'color', color: v });
      }
    });
    card.appendChild(ed);
    var clear = c.h('<button type="button" class="btn btn-ghost btn-sm">' + c.ic('grid') + '<span>Transparent</span></button>');
    clear.onclick = function () { bgCommit(c, { type: 'color', color: 'rgba(0,0,0,0)' }); c.S.exportOpts.transparent = true; c.lsSet('le-studio-export', c.S.exportOpts); c.toast('Transparent — export as PNG or WebP'); };
    var rowb = c.h('<div class="sx-row-between"></div>');
    rowb.appendChild(clear);
    var addk = c.h('<button type="button" class="btn btn-ghost btn-sm">' + c.ic('brand') + '<span>Add to brand kit</span></button>');
    addk.onclick = function () { addKitColor(c, cur); };
    rowb.appendChild(addk);
    card.appendChild(rowb);
    host.appendChild(card);
    function pick(col) { cur = col; ed.set(col); bgCommit(c, { type: 'color', color: col }); c.addRecent(col); markOn(); }
    var quick = c.h('<div class="sx-card"></div>');
    quickRows(c, quick, cur, pick);
    host.appendChild(quick);
    var lib = c.h('<div class="sx-bg-lib"></div>');
    host.appendChild(lib);
    palettes(c, lib, cur, pick);
    function markOn() {
      host.querySelectorAll('.sx-sw[aria-pressed]').forEach(function (b) { var l = b.getAttribute('aria-label') || ''; b.setAttribute('aria-pressed', l.toLowerCase().indexOf(hex6(cur)) >= 0 ? 'true' : 'false'); });
    }
  }
  function bgGradients(c, host, bar, bg) {
    var spec = bgGradSpec(bg);
    var all = gradients();
    var g0 = spec || Object.assign({ kind: 'gradient' }, all[0]);
    var card = c.h('<div class="sx-card"><div class="sx-card-h"><span class="sx-eyebrow">' + (spec ? 'Current gradient' : 'Start from a preset') + '</span></div></div>');
    var ge = gradEditor(c, g0, {
      types: ['linear', 'radial', 'conic', 'mesh'],
      onInput: function (g, commit) { var s = Object.assign({ kind: 'gradient', id: g0.id || 'custom' }, g); liveSpec(c, s, commit); }
    });
    card.appendChild(ge);
    host.appendChild(card);
    var q = '', grp = '';
    var chips = c.h('<div class="sx-chips is-scroll"></div>');
    var groups = [];
    all.forEach(function (g) { if (groups.indexOf(g.group) < 0) groups.push(g.group); });
    [''].concat(groups).forEach(function (gname) {
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (gname === grp) + '">' + c.esc(gname || 'All') + '</button>');
      b.onclick = function () { grp = gname; chips.querySelectorAll('.sx-chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); draw(); };
      chips.appendChild(b);
    });
    var sbox = c.h('<div></div>');
    U.searchBox(c, sbox, 'Search ' + all.length + ' gradients', '', function (v) { q = v.toLowerCase(); draw(); });
    host.appendChild(sbox);
    host.appendChild(chips);
    var list = c.h('<div></div>');
    host.appendChild(list);
    function draw() {
      list.innerHTML = '';
      var by = {}, order = [];
      all.forEach(function (g) {
        if (grp && g.group !== grp) return;
        if (q && (g.name + ' ' + g.group + ' ' + g.type).toLowerCase().indexOf(q) < 0) return;
        if (!by[g.group]) { by[g.group] = []; order.push(g.group); }
        by[g.group].push(g);
      });
      order.forEach(function (gname) {
        var s = c.ui.section(gname, '<span class="sx-count">' + by[gname].length + '</span>');
        var gridEl = c.h('<div class="sx-grad-grid"></div>');
        by[gname].forEach(function (g) {
          var t = c.h('<button type="button" class="sx-grad" aria-label="' + c.esc(g.name + ' ' + g.type + ' gradient') + '" title="' + c.esc(g.name) + '"><i></i><span>' + c.esc(g.name) + '</span></button>');
          t.querySelector('i').style.background = gradCss(g);
          if (spec && spec.id === g.id) t.setAttribute('aria-pressed', 'true');
          t.onclick = function () {
            var s2 = { kind: 'gradient', id: g.id, type: g.type, angle: g.angle == null ? 180 : g.angle, stops: g.stops.map(function (x) { return { color: x.color, at: x.at }; }) };
            if (g.points) s2.points = g.points;
            g0 = s2;
            ge.set(s2);
            liveSpec(c, s2, true);
            list.querySelectorAll('.sx-grad[aria-pressed]').forEach(function (x) { x.removeAttribute('aria-pressed'); });
            t.setAttribute('aria-pressed', 'true');
          };
          gridEl.appendChild(t);
        });
        s.querySelector('.sx-sec-body').appendChild(gridEl);
        list.appendChild(s);
      });
      if (!order.length) list.appendChild(U.note(c, 'No gradients match “' + q + '”.'));
    }
    draw();
  }
  var patUrls = P._urlCache ? P._urlCache('patterns', 160) : null;
  var patMemo = {};
  function patUrl(p, fg, bg) {
    var key = p.id + fg + bg;
    var hit = patUrls ? patUrls.get(key) : patMemo[key];
    if (hit) return hit;
    var markup = '';
    try { markup = p.svg(40, fg, bg); } catch (e) { return ''; }
    if (LE.project && LE.project.sanitizeSvg) markup = LE.project.sanitizeSvg(markup) || markup;
    var u = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    return patUrls ? patUrls.set(key, u) : (patMemo[key] = u);
  }
  function bgPatterns(c, host, bg) {
    var cur = bg.spec && bg.spec.kind === 'pattern' ? c.clone(bg.spec) : { kind: 'pattern', id: '', fg: '#7457f0', bg: '#ffffff', scale: 1 };
    var card = c.h('<div class="sx-card"><div class="sx-card-h"><span class="sx-eyebrow">Pattern colours</span></div><div class="sx-row sx-pat-cols"></div></div>');
    var cols = card.querySelector('.sx-pat-cols');
    var fgB = c.ui.swatchBtn(cur.fg, 'Motif', function (b) { pop(c, b, { value: cur.fg, title: 'Pattern motif', onChange: function (v, k) { cur.fg = v; fgB.querySelector('i').style.background = v; refresh(k); } }); });
    var bgB = c.ui.swatchBtn(cur.bg, 'Background', function (b) { pop(c, b, { value: cur.bg, title: 'Pattern background', onChange: function (v, k) { cur.bg = v; bgB.querySelector('i').style.background = v; refresh(k); } }); });
    var swp = c.h('<button type="button" class="sx-iconbtn" aria-label="Swap colours" title="Swap colours">' + c.ic('swap') + '</button>');
    swp.onclick = function () { var t = cur.fg; cur.fg = cur.bg; cur.bg = t; fgB.querySelector('i').style.background = cur.fg; bgB.querySelector('i').style.background = cur.bg; refresh(); };
    cols.appendChild(fgB); cols.appendChild(swp); cols.appendChild(bgB);
    card.appendChild(c.ui.slider({ label: 'Scale', min: 25, max: 400, step: 5, value: Math.round(cur.scale * 100), reset: 100, fmt: function (v) { return v + '%'; }, onInput: function (v) { cur.scale = v / 100; if (cur.id) liveSpec(c, c.clone(cur), false); }, onEnd: function () { if (cur.id) liveSpec(c, c.clone(cur), true); } }));
    host.appendChild(card);
    function refresh() {
      paintTiles();
      if (!cur.id) return;
      liveSpec(c, c.clone(cur), false);
      clearTimeout(refresh._t);
      refresh._t = setTimeout(function () { liveSpec(c, c.clone(cur), true); }, 450);
    }
    var gridEl = c.h('<div class="sx-pat-grid"></div>');
    var list = patterns();
    var s = c.ui.section('Patterns', '<span class="sx-count">' + list.length + '</span>');
    s.querySelector('.sx-sec-body').appendChild(gridEl);
    host.appendChild(s);
    function paintTiles() {
      gridEl.querySelectorAll('.sx-pat').forEach(function (t) {
        var p = findPattern(t.getAttribute('data-id'));
        t.querySelector('i').style.backgroundImage = 'url("' + patUrl(p, hex(cur.fg), hex(cur.bg)) + '")';
      });
    }
    list.forEach(function (p) {
      var t = c.h('<button type="button" class="sx-pat" data-id="' + c.esc(p.id) + '" aria-label="' + c.esc(p.name + ' pattern') + '" title="' + c.esc(p.name) + '" aria-pressed="' + (p.id === cur.id) + '"><i></i><span>' + c.esc(p.name) + '</span></button>');
      t.onclick = function () {
        cur.id = p.id;
        gridEl.querySelectorAll('.sx-pat').forEach(function (x) { x.setAttribute('aria-pressed', x === t); });
        liveSpec(c, c.clone(cur), true);
      };
      gridEl.appendChild(t);
    });
    paintTiles();
    host.appendChild(U.note(c, 'Patterns stay crisp — they are redrawn whenever you resize the design.', 'is-muted'));
  }
  var texUrls = {};
  function texThumb(t, fg, bg) {
    var key = t.id + fg + bg;
    if (texUrls[key]) return texUrls[key];
    var cv = document.createElement('canvas');
    cv.width = 160; cv.height = 120;
    var x = cv.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 160, 120);
    try { paintTexture(t, x, 160, 120, fg, bg, 1); } catch (e) {}
    texUrls[key] = cv.toDataURL('image/png');
    return texUrls[key];
  }
  function bgPhotos(c, host, bg, o) {
    var cur = bg.spec && bg.spec.kind === 'texture' ? c.clone(bg.spec) : { kind: 'texture', id: '', fg: '#3b2f63', bg: '#f6efe1', scale: 1 };
    var s0 = c.ui.section('Textures');
    var b0 = s0.querySelector('.sx-sec-body');
    var cols = c.h('<div class="sx-row"></div>');
    var fgB = c.ui.swatchBtn(cur.fg, 'Ink', function (b) { pop(c, b, { value: cur.fg, title: 'Texture ink', onChange: function (v) { cur.fg = v; fgB.querySelector('i').style.background = v; again(); } }); });
    var bgB = c.ui.swatchBtn(cur.bg, 'Paper', function (b) { pop(c, b, { value: cur.bg, title: 'Texture base', onChange: function (v) { cur.bg = v; bgB.querySelector('i').style.background = v; again(); } }); });
    cols.appendChild(fgB); cols.appendChild(bgB);
    b0.appendChild(cols);
    var tg = c.h('<div class="sx-pat-grid"></div>');
    function again() {
      tg.querySelectorAll('.sx-pat').forEach(function (t) { t.querySelector('i').style.backgroundImage = 'url("' + texThumb(findTexture(t.getAttribute('data-id')), hex(cur.fg), hex(cur.bg)) + '")'; });
      if (!cur.id) return;
      clearTimeout(again._t);
      again._t = setTimeout(function () { liveSpec(c, c.clone(cur), true); }, 350);
    }
    textures().forEach(function (t) {
      var b = c.h('<button type="button" class="sx-pat" data-id="' + c.esc(t.id) + '" aria-label="' + c.esc(t.name + ' texture') + '" aria-pressed="' + (t.id === cur.id) + '"><i></i><span>' + c.esc(t.name) + '</span></button>');
      b.onclick = function () { cur.id = t.id; tg.querySelectorAll('.sx-pat').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); liveSpec(c, c.clone(cur), true); };
      tg.appendChild(b);
    });
    b0.appendChild(tg);
    again();
    host.appendChild(s0);
    var s3 = c.ui.section('Photo background');
    var b3 = s3.querySelector('.sx-sec-body');
    var gg = U.grid('sx-grid-4 sx-thumbs');
    Object.keys(c.S.project.assets || {}).forEach(function (id) {
      var meta = c.S.project.assets[id];
      if (meta && /^background-/.test(meta.name || '')) return;
      var t = c.h('<button type="button" class="sx-thumb" aria-label="Use as background" aria-pressed="' + (bg.type === 'image' && bg.src === id && !bg.spec) + '"><img alt=""></button>');
      c.thumbUrl(id).then(function (u) { if (u) t.querySelector('img').src = u; });
      t.onclick = function () { bgCommit(c, { type: 'image', src: id, fit: 'cover', color: '#ffffff' }); c.toast('Photo set as page background'); c.renderPanel(true); };
      gg.appendChild(t);
    });
    if (gg.children.length) b3.appendChild(gg);
    if (bg.type === 'image' && !bg.spec) {
      b3.appendChild(c.ui.seg([['cover', 'Fill'], ['contain', 'Fit'], ['fill', 'Stretch']], bg.fit || 'cover', function (v) { bgCommit(c, Object.assign({}, c.doc().background, { fit: v })); }, 'sx-seg-sm sx-seg-fill'));
    }
    var one = c.one();
    var row = c.h('<div class="sx-row-between"></div>');
    if (one && one.type === 'image') row.appendChild(U.btn(c, 'Use selected photo', 'background', 'btn btn-ghost btn-sm', function () { c.setAsBackground(); }));
    row.appendChild(U.btn(c, 'Upload a photo', 'uploads', 'btn btn-ghost btn-sm', function () { c.pickFiles('tray'); }));
    b3.appendChild(row);
    host.appendChild(s3);
    U.removeBg(c, host, o);
  }

  /* ---------- Replace all: colours & fonts ---------- */
  var COLOR_KEYS = ['color'];
  function eachColor(d, fn) {
    var bg = d.background;
    if (bg) {
      if (isColor(bg.color)) fn(bg.color, 'background');
      (bg.colors || []).forEach(function (x) { if (isColor(x)) fn(x, 'background'); });
      if (bg.spec) {
        (bg.spec.stops || []).forEach(function (x) { if (isColor(x.color)) fn(x.color, 'background'); });
        if (isColor(bg.spec.fg)) fn(bg.spec.fg, 'background');
        if (isColor(bg.spec.bg)) fn(bg.spec.bg, 'background');
      }
    }
    (d.layers || []).forEach(function (l) {
      COLOR_KEYS.forEach(function (k) { if (isColor(l[k])) fn(l[k], l.type === 'text' ? 'text' : l.type === 'svg' ? 'graphic' : l.type === 'path' ? 'drawing' : 'fill'); });
      if (l.fill && typeof l.fill === 'object') {
        if (isColor(l.fill.color)) fn(l.fill.color, 'fill');
        (l.fill.colors || []).forEach(function (x) { if (isColor(x)) fn(x, 'gradient'); });
      } else if (isColor(l.fill)) fn(l.fill, 'fill');
      if (l.stroke && isColor(l.stroke.color) && l.stroke.width) fn(l.stroke.color, 'outline');
      if (l.border && isColor(l.border.color) && l.border.width) fn(l.border.color, 'border');
      if (l.background && isColor(l.background.color)) fn(l.background.color, 'text background');
      if (l.shadow && isColor(l.shadow.color)) fn(l.shadow.color, 'shadow');
      if (l.type === 'svg' && l.svg && !l.color) svgColors(l.svg).forEach(function (x) { fn(x, 'graphic'); });
    });
  }
  var SVG_COLOR_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]{5,40}\)/g;
  function svgColors(svg) {
    var out = [];
    String(svg).replace(/(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]{5,40}\))/g, function (m, col) { out.push(col); return m; });
    return out;
  }
  function scanColors(c) {
    c.syncProject();
    var p = c.S.project;
    var map = {};
    p.pages.forEach(function (pg, i) {
      var d = i === p.activePage ? c.doc() : pg;
      eachColor(d, function (col, where) {
        var pp = parse(col);
        if (!pp || pp.a === 0) return;
        var k = hex6(col);
        var e = map[k] = map[k] || { color: k, count: 0, where: {}, pages: {} };
        e.count++;
        e.where[where] = 1;
        e.pages[i] = 1;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.count - a.count; });
  }
  function swapColor(col, from, to) {
    if (!isColor(col) || hex6(col) !== from) return col;
    var pp = parse(col);
    var t = parse(to);
    return hex({ r: t.r, g: t.g, b: t.b, a: (pp.a == null ? 1 : pp.a) * (t.a == null ? 1 : t.a) });
  }
  function replaceIn(d, from, to) {
    var x = JSON.parse(JSON.stringify(d));
    var touched = false;
    function sw(v) { var n = swapColor(v, from, to); if (n !== v) touched = true; return n; }
    var bg = x.background;
    if (bg) {
      if (bg.color) bg.color = sw(bg.color);
      if (bg.colors) bg.colors = bg.colors.map(sw);
      if (bg.spec) {
        (bg.spec.stops || []).forEach(function (s) { s.color = sw(s.color); });
        if (bg.spec.fg) bg.spec.fg = sw(bg.spec.fg);
        if (bg.spec.bg) bg.spec.bg = sw(bg.spec.bg);
      }
    }
    x.layers.forEach(function (l) {
      COLOR_KEYS.forEach(function (k) { if (l[k]) l[k] = sw(l[k]); });
      if (l.fill && typeof l.fill === 'object') { if (l.fill.color) l.fill.color = sw(l.fill.color); if (l.fill.colors) l.fill.colors = l.fill.colors.map(sw); } else if (typeof l.fill === 'string') l.fill = sw(l.fill);
      if (l.stroke && l.stroke.color) l.stroke.color = sw(l.stroke.color);
      if (l.border && l.border.color) l.border.color = sw(l.border.color);
      if (l.background && l.background.color) l.background.color = sw(l.background.color);
      if (l.shadow && l.shadow.color) l.shadow.color = sw(l.shadow.color);
      if (l.type === 'svg' && l.svg && !l.color) {
        var ns = l.svg.replace(SVG_COLOR_RE, function (m) { return swapColor(m, from, to); });
        if (ns !== l.svg) { l.svg = ns; touched = true; }
      }
    });
    return touched ? x : null;
  }
  var MU = null;
  function applyAcross(c, transform, label) {
    c.syncProject();
    var p = c.S.project;
    var before = {}, after = {}, changed = 0;
    p.pages.forEach(function (pg, i) {
      if (i === p.activePage) return;
      var nd = transform(pg);
      if (!nd) return;
      before[i] = pg; after[i] = nd; changed++;
    });
    var curDoc = c.doc();
    var nd = transform(curDoc);
    Object.keys(after).forEach(function (i) { p.pages[i] = after[i]; });
    if (nd) { changed++; c.replaceDoc(nd, true); }
    if (Object.keys(after).length) {
      var h = c.scene._hist;
      if (!nd) { c.replaceDoc(c.doc(), true); }
      MU = { depth: h ? h.undo.length : 0, before: before, after: after, state: 'done' };
      c.onHistory({ canUndo: c.scene.canUndo(), canRedo: c.scene.canRedo() });
    }
    c.markDirty();
    rerenderSpecs(c);
    if (label) LE.project.log('replaced', p.id, { what: label, pages: changed });
    return changed;
  }
  function rerenderSpecs(c) {
    var p = c.S.project;
    p.pages.forEach(function (pg, i) {
      var d = i === p.activePage ? c.doc() : pg;
      var bg = d.background;
      if (!bg || bg.type !== 'image' || !bg.spec) return;
      specToBg(c, bg.spec, d).then(function (nb) {
        if (i === p.activePage) { c.scene._doc.background = nb; c.scene._mark(); } else p.pages[i].background = nb;
        c.markDirty();
      }).catch(function () {});
    });
  }
  hook('history', function (c) {
    if (!MU) return;
    var h = c.scene._hist;
    if (!h) return;
    var p = c.S.project;
    var n = h.undo.length;
    if (MU.state === 'done' && n < MU.depth) {
      Object.keys(MU.before).forEach(function (i) { p.pages[i] = MU.before[i]; });
      MU.state = 'undone';
      MU.redo = h.redo.length;
      c.markDirty();
      c.toast('Undone on every page');
    } else if (MU.state === 'undone' && n >= MU.depth) {
      if (h.redo.length === MU.redo - 1) {
        Object.keys(MU.after).forEach(function (i) { p.pages[i] = MU.after[i]; });
        MU.state = 'done';
        c.markDirty();
      } else MU = null;
    }
  });
  hook('page', function () { MU = null; });

  var RP = { orig: null };
  function rpActive(c) { return !!(RP.orig && c.S.preview && c.S.preview.type === 'replace'); }
  function rpPreview(c, d) {
    if (!rpActive(c)) {
      if (c.S.preview) return;
      RP.orig = c.doc();
      c.S.preview = { type: 'replace', pre: RP.orig, sel: c.sel() };
    }
    c.replaceDoc(d || RP.orig, false);
  }
  function rpEnd(c) {
    if (rpActive(c)) {
      var sel = c.S.preview.sel;
      c.S.preview = null;
      c.replaceDoc(RP.orig, false);
      if (sel && sel.length) c.scene.select(sel);
    }
    RP.orig = null;
  }
  P.replace = {
    title: 'Replace all', eyebrow: 'Colours, fonts & styles on every page', doc: true,
    render: function (c, body, o) {
      if (U.needProject(c, body)) return;
      var tab = o.tab || 'colors';
      var bar = c.h('<div class="sx-sticky"></div>');
      body.appendChild(bar);
      U.tabs(c, bar, [['colors', 'Colours'], ['fonts', 'Fonts'], ['styles', 'Styles']], tab, function (t) { rpEnd(c); c.S.panelOpts.tab = t; c.renderPanel(true); }).classList.add('is-fill');
      if (tab === 'colors') replaceColors(c, body, o);
      else if (tab === 'fonts') replaceFonts(c, body, o);
      else if (P._stylesTab) P._stylesTab(c, body, o);
    }
  };
  hook('panel-close', function (c) { rpEnd(c); });
  function replaceColors(c, body, o) {
    var list = scanColors(c);
    var pages = c.S.project.pages.length;
    body.appendChild(U.note(c, list.length + ' colour' + (list.length === 1 ? '' : 's') + ' in this design' + (pages > 1 ? ' across ' + pages + ' pages' : '') + '. Pick one to change it everywhere — fills, text, icons, outlines, shadows, gradients and backgrounds.'));
    var gridEl = c.h('<div class="sx-used"></div>');
    var detail = c.h('<div class="sx-card sx-rp-detail" hidden></div>');
    list.forEach(function (e) {
      var b = c.h('<button type="button" class="sx-used-c" aria-pressed="' + (o.from === e.color) + '"><i></i><span><b>' + e.color + '</b><small>' + e.count + ' use' + (e.count === 1 ? '' : 's') + ' · ' + Object.keys(e.where).slice(0, 3).join(', ') + '</small></span></button>');
      b.querySelector('i').style.background = e.color;
      b.onclick = function () { gridEl.querySelectorAll('.sx-used-c').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); open(e); };
      gridEl.appendChild(b);
    });
    body.appendChild(gridEl);
    body.appendChild(detail);
    if (!list.length) body.appendChild(c.ui.empty('No colours yet', 'Add text, shapes or a background colour, then come back to swap them all at once.'));
    function open(e) {
      rpEnd(c);
      detail.hidden = false;
      detail.innerHTML = '';
      var to = e.color;
      var head = c.h('<div class="sx-rp-head"><span class="sx-rp-from"><i></i>' + e.color + '</span>' + c.ic('right') + '<span class="sx-rp-to"><i></i><b>' + e.color + '</b></span></div>');
      head.querySelector('.sx-rp-from i').style.background = e.color;
      head.querySelector('.sx-rp-to i').style.background = e.color;
      detail.appendChild(head);
      function setTo(v, live) {
        to = v;
        head.querySelector('.sx-rp-to i').style.background = v;
        head.querySelector('.sx-rp-to b').textContent = hex(v);
        if (live) rpPreview(c, replaceIn(RP.orig || c.doc(), e.color, v));
      }
      var ed = solidEditor(c, e.color, { onInput: function (v) { setTo(v, true); } });
      detail.appendChild(ed);
      var q = c.h('<div></div>');
      quickRows(c, q, e.color, function (v) { ed.set(v); setTo(v, true); });
      detail.appendChild(q);
      var act = c.h('<div class="sx-row-between"></div>');
      act.appendChild(U.btn(c, 'Cancel', null, 'btn btn-ghost btn-sm', function () { rpEnd(c); detail.hidden = true; gridEl.querySelectorAll('.sx-used-c').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); }));
      act.appendChild(U.btn(c, 'Change all' + (Object.keys(e.pages).length > 1 ? ' on ' + Object.keys(e.pages).length + ' pages' : ''), 'check', 'btn btn-gold btn-sm', function () {
        if (hex(to) === e.color) { c.toast('Pick a different colour first.'); return; }
        rpEnd(c);
        var n = applyAcross(c, function (d) { return replaceIn(d, e.color, to); }, 'color');
        c.addRecent(hex(to));
        c.toast('Changed ' + e.count + ' use' + (e.count === 1 ? '' : 's') + ' on ' + n + ' page' + (n === 1 ? '' : 's') + ' — one undo reverts it');
        c.S.panelOpts.from = hex6(to);
        c.renderPanel(true);
      }));
      detail.appendChild(act);
      setTimeout(function () { detail.scrollIntoView({ block: 'nearest', behavior: c.reduced() ? 'auto' : 'smooth' }); }, 30);
    }
    if (o.from) { var pre = list.filter(function (x) { return x.color === o.from; })[0]; if (pre) open(pre); }
  }
  function scanFonts(c) {
    c.syncProject();
    var p = c.S.project, map = {};
    p.pages.forEach(function (pg, i) {
      var d = i === p.activePage ? c.doc() : pg;
      d.layers.forEach(function (l) {
        if (l.type !== 'text') return;
        var k = l.font + '|' + (l.weight || 400);
        var e = map[k] = map[k] || { font: l.font, weight: l.weight || 400, count: 0, pages: {}, sample: '' };
        e.count++;
        e.pages[i] = 1;
        if (!e.sample) e.sample = String(l.text || '').split('\n')[0].slice(0, 28);
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.count - a.count; });
  }
  function replaceFontIn(d, from, to, weightOnly) {
    var x = JSON.parse(JSON.stringify(d)), touched = false;
    x.layers.forEach(function (l) {
      if (l.type !== 'text' || l.font !== from.font) return;
      if (weightOnly && (l.weight || 400) !== from.weight) return;
      l.font = to.font;
      if (to.weight) l.weight = to.weight;
      touched = true;
    });
    return touched ? x : null;
  }
  function nearestWeight(f, w) { var ws = (f && f.weights) || [400]; return ws.reduce(function (a, b) { return Math.abs(b - w) < Math.abs(a - w) ? b : a; }, ws[0]); }
  var WN = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
  function replaceFonts(c, body) {
    var used = scanFonts(c);
    var all = LE.fonts && LE.fonts.list ? LE.fonts.list() : [];
    if (!used.length) { body.appendChild(c.ui.empty('No text yet', 'Add some text, then swap fonts across every page here.')); return; }
    body.appendChild(U.note(c, 'Change a font or weight everywhere it is used. Pick a replacement to preview it on this page.'));
    used.forEach(function (e) {
      var card = c.h('<div class="sx-card sx-rp-font"><div class="sx-rp-fh"><span class="sx-rp-sample">' + c.esc(e.sample || e.font) + '</span><small>' + c.esc(e.font) + ' · ' + (WN[e.weight] || e.weight) + ' · ' + e.count + ' text' + (e.count === 1 ? '' : 's') + (Object.keys(e.pages).length > 1 ? ' · ' + Object.keys(e.pages).length + ' pages' : '') + '</small></div><div class="sx-rp-fctl"></div></div>');
      card.querySelector('.sx-rp-sample').style.fontFamily = c.fontCss(e.font);
      card.querySelector('.sx-rp-sample').style.fontWeight = e.weight;
      var ctl = card.querySelector('.sx-rp-fctl');
      var fsel = c.h('<select class="sx-input" aria-label="Replace ' + c.esc(e.font) + ' with"></select>');
      var kitFonts = kit.fonts.map(function (f) { return f.family; });
      var opts = (kitFonts.length ? '<optgroup label="Brand kit">' + kitFonts.map(function (f) { return '<option value="' + c.esc(f) + '">' + c.esc(f) + '</option>'; }).join('') + '</optgroup>' : '') +
        '<optgroup label="All fonts">' + all.map(function (f) { return '<option value="' + c.esc(f.family) + '"' + (f.family === e.font ? ' selected' : '') + '>' + c.esc(f.family) + '</option>'; }).join('') + '</optgroup>';
      fsel.innerHTML = opts;
      fsel.value = e.font;
      var wsel = c.h('<select class="sx-input" aria-label="Weight"></select>');
      function fillWeights() {
        var f = all.filter(function (x) { return x.family === fsel.value; })[0];
        var w = nearestWeight(f, e.weight);
        wsel.innerHTML = ((f && f.weights) || [400]).map(function (x) { return '<option value="' + x + '"' + (x === w ? ' selected' : '') + '>' + (WN[x] || x) + '</option>'; }).join('');
      }
      fillWeights();
      var scope = c.h('<label class="sx-mini-toggle"><input type="checkbox"><span>Only ' + (WN[e.weight] || e.weight) + '</span></label>');
      function preview() {
        var to = { font: fsel.value, weight: Number(wsel.value) };
        if (LE.fonts.load) LE.fonts.load(to.font, to.weight, false).catch(function () {});
        rpPreview(c, replaceFontIn(RP.orig || c.doc(), e, to, scope.querySelector('input').checked));
      }
      fsel.onchange = function () { fillWeights(); preview(); };
      wsel.onchange = preview;
      scope.querySelector('input').onchange = preview;
      ctl.appendChild(fsel); ctl.appendChild(wsel); ctl.appendChild(scope);
      ctl.appendChild(U.btn(c, 'Replace everywhere', 'check', 'btn btn-gold btn-sm', function () {
        var to = { font: fsel.value, weight: Number(wsel.value) };
        if (to.font === e.font && to.weight === e.weight) { c.toast('Pick a different font or weight.'); return; }
        rpEnd(c);
        var n = applyAcross(c, function (d) { return replaceFontIn(d, e, to, scope.querySelector('input').checked); }, 'font');
        c.toast(e.font + ' → ' + to.font + ' on ' + n + ' page' + (n === 1 ? '' : 's'));
        c.renderPanel(true);
      }));
      body.appendChild(card);
    });
  }

  /* ---------- Brand kit panel ---------- */
  P.brand = {
    title: 'Brand kit', eyebrow: 'Colours, fonts & logos — saved on this device',
    render: function (c, body) {
      var host = c.h('<div><div class="sx-loading">' + c.ic('sparkle') + 'Loading your brand kit…</div></div>');
      body.appendChild(host);
      loadKit().then(function () { host.innerHTML = ''; drawKit(c, host); });
    }
  };
  function drawKit(c, host) {
    var s1 = c.ui.section('Brand colours', '<span class="sx-count">' + kit.colors.length + '</span>');
    var row = c.h('<div class="sx-sws is-lg"></div>');
    kit.colors.forEach(function (col, i) {
      var b = swatch(c, col, col + ' — click to apply, right-click to remove', false, function () {
        var l = c.one();
        if (l && (l.type === 'text' || l.type === 'svg' || l.type === 'path')) c.patch(l.id, { color: col });
        else if (l && l.type === 'shape') c.patch(l.id, { fill: { type: 'solid', color: col } });
        else bgCommit(c, { type: 'color', color: col });
        c.addRecent(col);
      });
      b.oncontextmenu = function (e) { e.preventDefault(); var next = Object.assign({}, kit, { colors: kit.colors.filter(function (x, j) { return j !== i; }) }); saveKit(c, next); };
      row.appendChild(b);
    });
    var add = c.h('<button type="button" class="sx-sw is-add" aria-label="Add a brand colour">' + c.ic('plus') + '</button>');
    add.onclick = function () {
      var nv = '#7457f0';
      pop(c, add, { value: nv, title: 'Add a brand colour', alpha: false, onChange: function (v) { nv = v; } });
      var done = c.h('<button type="button" class="btn btn-gold btn-sm sx-block">' + c.ic('check') + '<span>Add to brand kit</span></button>');
      done.onclick = function () { c.closePop(); addKitColor(c, nv); };
      c.E.pop.querySelector('.sx-cp-body').appendChild(done);
    };
    row.appendChild(add);
    s1.querySelector('.sx-sec-body').appendChild(row);
    s1.querySelector('.sx-sec-body').appendChild(U.btn(c, 'Add all colours from this design', 'palette', 'btn btn-ghost btn-sm', function () {
      var cols = c.S.project ? scanColors(c).map(function (e) { return e.color; }) : [];
      if (!cols.length) { c.toast('Open a design first.'); return; }
      var merged = kit.colors.concat(cols.filter(function (x) { return kit.colors.indexOf(x) < 0; })).slice(0, 40);
      saveKit(c, Object.assign({}, kit, { colors: merged })).then(function () { c.toast('Brand kit has ' + merged.length + ' colours'); });
    }));
    host.appendChild(s1);
    var s2 = c.ui.section('Brand fonts');
    var all = LE.fonts && LE.fonts.list ? LE.fonts.list() : [];
    ['heading', 'subheading', 'body'].forEach(function (role) {
      var f = kit.fonts.filter(function (x) { return x.role === role; })[0];
      var r = c.h('<div class="sx-kit-font"><span class="sx-eyebrow">' + role + '</span><select class="sx-input" aria-label="' + role + ' font"><option value="">Not set</option>' + all.map(function (x) { return '<option' + (f && f.family === x.family ? ' selected' : '') + '>' + c.esc(x.family) + '</option>'; }).join('') + '</select><button type="button" class="btn btn-ghost btn-sm" aria-label="Add ' + role + ' text in the brand font"' + (f ? '' : ' disabled') + '>' + c.ic('plus') + '<span>Add</span></button></div>');
      if (f) r.querySelector('select').style.fontFamily = c.fontCss(f.family);
      r.querySelector('select').onchange = function (e) {
        var fam = e.target.value;
        var meta = all.filter(function (x) { return x.family === fam; })[0];
        var others = kit.fonts.filter(function (x) { return x.role !== role; });
        if (fam) others.push({ family: fam, weight: nearestWeight(meta, role === 'body' ? 400 : 700), role: role });
        saveKit(c, Object.assign({}, kit, { fonts: others }));
      };
      r.querySelector('button').onclick = function () {
        if (!f) return;
        var sizes = { heading: 96, subheading: 56, body: 34 };
        var id = c.addText({ text: role === 'body' ? 'Body text in your brand font' : role === 'heading' ? 'Brand heading' : 'Brand subheading', font: f.family, weight: f.weight, size: sizes[role] });
        if (id) c.scene.select([id]);
      };
      s2.querySelector('.sx-sec-body').appendChild(r);
    });
    host.appendChild(s2);
    var s3 = c.ui.section('Logos', '<span class="sx-count">' + kit.logos.length + '/12</span>');
    var gg = U.grid('sx-grid-4 sx-thumbs');
    kit.logos.forEach(function (id) {
      var t = c.h('<div class="sx-kit-logo"><button type="button" class="sx-thumb" aria-label="Add logo to design"><img alt=""></button><button type="button" class="sx-iconbtn sx-kit-x" aria-label="Remove logo from brand kit">' + c.ic('x') + '</button></div>');
      c.thumbUrl(id).then(function (u) { if (u) t.querySelector('img').src = u; });
      t.querySelector('.sx-thumb').onclick = function () {
        var go = c.mem[id] ? Promise.resolve() : LE.project.assetRecord(id).then(function (rec) { if (!rec) throw new Error('missing'); return c.ingest(new File([rec.blob], rec.name || 'logo.png', { type: rec.type || rec.blob.type })); });
        go.then(function () { if (!c.S.project) c.newDesign(1080, 1080, 'Untitled design'); c.placeImage(id); }).catch(function () { c.toast('That logo is no longer stored on this device.'); });
      };
      t.querySelector('.sx-kit-x').onclick = function () { saveKit(c, Object.assign({}, kit, { logos: kit.logos.filter(function (x) { return x !== id; }) })); };
      gg.appendChild(t);
    });
    var up = c.h('<button type="button" class="sx-thumb sx-thumb-add" aria-label="Upload a logo">' + c.ic('plus') + '</button>');
    var fileIn = c.h('<input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" hidden>');
    up.onclick = function () { if (kit.logos.length >= 12) { c.toast('Up to 12 logos'); return; } fileIn.click(); };
    fileIn.onchange = function () {
      var f = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      c.ingest(f).then(function (meta) { return saveKit(c, Object.assign({}, kit, { logos: kit.logos.concat([meta.id]) })); }).then(function () { c.toast('Logo saved to your brand kit'); }).catch(function (err) { c.toast(err.message || 'Could not add that logo.'); });
    };
    gg.appendChild(up);
    s3.querySelector('.sx-sec-body').appendChild(gg);
    s3.querySelector('.sx-sec-body').appendChild(fileIn);
    var l = c.one();
    if (l && l.type === 'image' && kit.logos.indexOf(l.src) < 0) s3.querySelector('.sx-sec-body').appendChild(U.btn(c, 'Save selected image as a logo', 'brand', 'btn btn-ghost btn-sm', function () { saveKit(c, Object.assign({}, kit, { logos: kit.logos.concat([l.src]).slice(0, 12) })); }));
    host.appendChild(s3);
    host.appendChild(U.note(c, 'Your brand kit is stored in this browser’s project ledger and appears in every colour picker and in Replace all.', 'is-muted'));
  }

  window.LEStudioColor = {
    parse: parse, hex: hex, hex6: hex6, mix: mix, lum: lum, rgb2hsv: rgb2hsv, hsv2rgb: hsv2rgb,
    colorSets: colorSets, ramps: ramps, gradients: gradients, patterns: patterns, textures: textures,
    gradCss: gradCss, paintGradient: paintGradient, toFill: toFill, fromFill: fromFill,
    pop: pop, solidEditor: solidEditor, gradEditor: gradEditor, palettes: palettes, quickRows: quickRows, swatch: swatch,
    kit: function () { return kit; }, loadKit: loadKit, saveKit: saveKit, addKitColor: addKitColor,
    applyAcross: applyAcross, rpPreview: rpPreview, rpEnd: rpEnd, bgCommit: bgCommit, specToBg: specToBg
  };
})();
