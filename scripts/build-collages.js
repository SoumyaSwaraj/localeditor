#!/usr/bin/env node
/* Builds assets/data/collages/index.json and one JSON pack per style.
   Recipes are data only. Run: node scripts/build-collages.js
   Paint order for every recipe: background, photo slots, then decor. */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var pool = require('./collage-pool');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'assets', 'data', 'collages');
var byCat = pool.byCat();
var STYLES = [];

var SZ = {
  sq: [1080, 1080],
  story: [1080, 1920],
  land: [1920, 1080],
  wide: [1600, 900],
  pano: [1920, 720]
};
var INK = '#17131F';
var CREAM = '#F7F3EC';
var PAPER = '#F3EDE3';
var WHITE = '#FFFEFB';
var CLASSIC = [
  'grid-2', 'grid-3', 'grid-4', 'masonry', 'mosaic', 'polaroid-wall', 'polaroid-scatter',
  'film-strip', 'lookbook', 'moodboard', 'yearbook', 'family-cluster', 'honeycomb', 'diamond-grid',
  'timeline', 'map-travel', 'postcard', 'instant-camera', 'torn-paper', 'comic-pop', 'heart-shape',
  'circle-crop', 'star-mask', 'overlapping-cascade', 'bento-grid', 'magazine-cover', 'typography-poster',
  'editorial-spread', 'newspaper', 'scrapbook', 'washi-tape', 'travel-journal', 'silhouette', 'panoramic',
  'circular-mosaic', 'vaporwave', 'cottagecore', 'dark-academia', 'coquette', 'streetwear'
];
var ATTACHED = [
  'silhouette', 'panoramic', 'shape-based', 'circular', 'streetwear', 'coquette', 'dark-academia',
  'cottagecore', 'pinterest-aesthetic', 'scrapbook', 'junk-journal', 'newspaper', 'magazine-cutout',
  'washi-tape', 'ephemera', 'travel-journal', 'handwritten-journal', 'typography', 'editorial',
  'vaporwave', 'digital-3d'
];
var NAMES = ['Avery', 'Blake', 'Casey', 'Drew', 'Eden', 'Finn', 'Gray', 'Harper', 'Indy', 'Jules', 'Kai', 'Lane'];
var CITIES = ['Lisbon', 'Paris', 'Rome', 'Kyoto', 'Lima', 'Oslo', 'Cairo', 'Seoul'];
var WASHI = ['#F6C6D0', '#F3E3A0', '#B7D7C8', '#F3C09A', '#D7D0F0', '#F7D7C4'];
var LETTERS = ['A', 'B', 'C', 'R', 'S', 'T', 'M', 'E', 'O', 'L', 'H', 'N'];
var LETTER_C = ['#E23B2F', '#2F6FED', '#F2C14E', '#1F8A4C', '#F27D1A', '#17131F', '#C43B6E'];
var LETTER_D = ['#F2C14E', '#FF5A4E', '#7EB6FF', '#F4F1EA', '#F27D1A', '#E7FF6A', '#FF8AD4'];
var HEAD = [
  ['M', 38, 6],
  ['C', 52, 2, 66, 10, 68, 24],
  ['C', 70, 34, 64, 42, 56, 46],
  ['C', 68, 48, 80, 56, 82, 68],
  ['C', 84, 78, 74, 84, 62, 86],
  ['L', 68, 92],
  ['C', 78, 96, 84, 100, 58, 100],
  ['L', 16, 100],
  ['C', 12, 94, 20, 90, 26, 86],
  ['L', 24, 78],
  ['C', 14, 74, 8, 64, 14, 54],
  ['C', 18, 46, 28, 44, 36, 48],
  ['C', 30, 38, 26, 26, 32, 16],
  ['C', 36, 8, 34, 6, 38, 6],
  ['Z']
];
var LETTER_POS = [
  [0.30, 0.10], [0.50, 0.08], [0.66, 0.18],
  [0.26, 0.30], [0.48, 0.28], [0.66, 0.38],
  [0.32, 0.50], [0.54, 0.48], [0.38, 0.66], [0.58, 0.70]
];

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function hash(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function solid(color) { return { type: 'solid', color: color }; }
function lin(colors, angle) { return { type: 'linear', colors: colors, angle: angle == null ? 160 : angle }; }
function mixer(cats, n, start) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var cat = cats[i % cats.length];
    var list = byCat[cat] || byCat.people;
    assert(list && list.length, 'missing photo cat ' + cat);
    out.push(list[(start + Math.floor(i / cats.length)) % list.length]);
  }
  return out;
}
function box(x, y, w, h) {
  return { x: Math.round(x), y: Math.round(y), w: Math.max(2, Math.round(w)), h: Math.max(2, Math.round(h)) };
}
function inset(sh, m) { return { x: m, y: m, w: sh.w - m * 2, h: sh.h - m * 2 }; }

function Sheet(w, h) {
  this.w = w;
  this.h = h;
  this.slots = [];
  this.decor = [];
  this._n = 0;
}
Sheet.prototype._fit = function (x, y, w, h) {
  w = Math.max(64, Math.round(w));
  h = Math.max(64, Math.round(h));
  x = Math.round(x);
  y = Math.round(y);
  var bleed = Math.round(Math.min(this.w, this.h) * 0.16);
  if (w > this.w + bleed) w = this.w;
  if (h > this.h + bleed) h = this.h;
  if (x < -bleed) x = -bleed;
  if (y < -bleed) y = -bleed;
  if (x + w > this.w + bleed) x = this.w + bleed - w;
  if (y + h > this.h + bleed) y = this.h + bleed - h;
  return { x: x, y: y, w: w, h: h };
};
Sheet.prototype.slot = function (x, y, w, h, o) {
  o = o || {};
  this._n += 1;
  var b = this._fit(x, y, w, h);
  var s = { id: o.id || ('s' + this._n), x: b.x, y: b.y, w: b.w, h: b.h, photo: o.photo, z: o.z || this._n };
  if (o.rot) s.rot = Math.round(o.rot);
  if (o.radius) s.radius = Math.round(o.radius);
  if (o.mask) s.mask = o.mask;
  if (o.maskPath) s.maskPath = o.maskPath;
  if (o.border && o.border.width) s.border = { width: Math.round(o.border.width), color: o.border.color || WHITE };
  if (o.shadow) s.shadow = { color: o.shadow.color, blur: Math.round(o.shadow.blur || 12), x: Math.round(o.shadow.x || 0), y: Math.round(o.shadow.y || 6) };
  if (o.caption) s.caption = o.caption;
  this.slots.push(s);
  return s;
};
Sheet.prototype.shape = function (shape, x, y, w, h, o) {
  o = o || {};
  var b = box(x, y, w, h);
  var d = {
    type: 'shape', shape: shape, name: o.name || shape,
    x: b.x, y: b.y, w: b.w, h: b.h,
    fill: o.fill || { type: 'solid', color: o.color || WHITE }
  };
  if (o.rotation) d.rotation = Math.round(o.rotation);
  if (o.opacity != null && o.opacity !== 1) d.opacity = Math.round(o.opacity * 100) / 100;
  if (o.params) d.params = o.params;
  if (o.stroke) d.stroke = o.stroke;
  if (o.shadow) d.shadow = o.shadow;
  this.decor.push(d);
};
Sheet.prototype.text = function (text, x, y, w, h, o) {
  o = o || {};
  var b = box(x, y, w, Math.max(o.size || 16, h));
  var d = {
    type: 'text', name: o.name || 'Text', text: String(text),
    font: o.font || 'Plus Jakarta Sans', size: Math.round(o.size || 28),
    color: o.color || INK, x: b.x, y: b.y, w: b.w, h: b.h
  };
  if (o.weight && o.weight !== 400) d.weight = o.weight;
  if (o.italic) d.italic = true;
  if (o.align) d.align = o.align;
  if (o.rotation) d.rotation = Math.round(o.rotation);
  if (o.letterSpacing) d.letterSpacing = Math.round(o.letterSpacing);
  if (o.lineHeight) d.lineHeight = o.lineHeight;
  if (o.fill) d.fill = o.fill;
  if (o.stroke) d.stroke = o.stroke;
  if (o.opacity != null && o.opacity !== 1) d.opacity = Math.round(o.opacity * 100) / 100;
  this.decor.push(d);
};

function shadow(blur, color) {
  return { color: color || 'rgba(40,28,20,.26)', blur: blur || 14, x: 0, y: 6 };
}
function pol(photo, z, rot, border) {
  return {
    photo: photo, z: z, rot: rot || 0, radius: 2,
    border: { width: border || 8, color: WHITE },
    shadow: shadow(14)
  };
}
function tape(sh, x, y, len, rot, color) {
  sh.shape('rounded-rect', x, y, len, Math.max(16, Math.round(len * 0.14)), {
    name: 'Tape', rotation: rot, opacity: 0.78, params: { radius: 3 },
    fill: { type: 'solid', color: color || '#F3E3A0' }
  });
}
function ticket(sh, x, y, w, h, title, sub, fill) {
  sh.shape('rounded-rect', x, y, w, h, {
    name: 'Ticket', params: { radius: 8 },
    fill: { type: 'solid', color: fill || '#F6F0E4' },
    stroke: { width: 2, color: '#3C3128', dash: [5, 4] }
  });
  sh.text(title, x + 8, y + h * 0.18, w - 16, h * 0.36, {
    font: 'Libre Baskerville', weight: 700, size: Math.max(14, Math.round(h * 0.2)),
    align: 'center', color: '#3C3128', name: 'Ticket title'
  });
  if (sub) {
    sh.text(sub, x + 8, y + h * 0.56, w - 16, h * 0.28, {
      font: 'Plus Jakarta Sans', weight: 700, size: Math.max(11, Math.round(h * 0.12)),
      align: 'center', color: '#3C3128', letterSpacing: 1, name: 'Ticket sub'
    });
  }
}
function stamp(sh, x, y, label) {
  sh.shape('rect', x, y, 96, 78, { name: 'Stamp', fill: { type: 'none' }, stroke: { width: 3, color: '#8C3A3A' } });
  sh.shape('rect', x + 5, y + 5, 86, 68, { name: 'Stamp inner', fill: { type: 'none' }, stroke: { width: 1, color: '#8C3A3A' } });
  sh.text(label, x + 6, y + 26, 84, 28, { font: 'Libre Baskerville', weight: 700, size: 13, align: 'center', color: '#8C3A3A', name: 'Stamp text' });
}
function bow(sh, x, y, s, color) {
  var c = color || '#F2A7C0';
  sh.shape('ellipse', x, y + s * 0.12, s * 0.46, s * 0.34, { name: 'Bow loop', fill: { type: 'solid', color: c } });
  sh.shape('ellipse', x + s * 0.5, y + s * 0.12, s * 0.46, s * 0.34, { name: 'Bow loop', fill: { type: 'solid', color: c } });
  sh.shape('ellipse', x + s * 0.38, y + s * 0.26, s * 0.2, s * 0.16, { name: 'Bow knot', fill: { type: 'solid', color: '#E889A8' } });
  sh.shape('triangle', x + s * 0.08, y + s * 0.46, s * 0.26, s * 0.32, { name: 'Bow tail', rotation: -16, fill: { type: 'solid', color: c } });
  sh.shape('triangle', x + s * 0.58, y + s * 0.46, s * 0.26, s * 0.32, { name: 'Bow tail', rotation: 16, fill: { type: 'solid', color: c } });
}
function candy(sh, x, y, s, word, fill) {
  sh.shape('heart', x, y, s, s * 0.92, { name: 'Candy heart', fill: { type: 'solid', color: fill || '#F7B6C8' } });
  sh.text(word, x, y + s * 0.36, s, s * 0.28, {
    font: 'Nunito', weight: 700, size: Math.max(12, Math.round(s * 0.16)), align: 'center', color: WHITE, name: word
  });
}
function leaf(sh, x, y, w, h, rot, color) {
  sh.shape('curve', x, y, w, h, {
    name: 'Leaf', rotation: rot || 0,
    params: { points: [[0.5, 0.98], [0.12, 0.62], [0.5, 0.04], [0.88, 0.62], [0.5, 0.98]] },
    fill: { type: 'none' },
    stroke: { width: 2, color: color || '#8A8174', cap: 'round' }
  });
}
function dots(sh, x, y, n, gap, r, color) {
  var count = Math.min(n, 14);
  for (var i = 0; i < count; i++) {
    sh.shape('ellipse', x + i * gap, y, r, r, { name: 'Dot', opacity: 0.75, fill: { type: 'solid', color: color } });
  }
}
function books(sh, x, y, w, h) {
  var colors = ['#6B3A2A', '#2C3A32', '#8C6A3E', '#3E2A28', '#C4B49A'];
  var bw = w / colors.length;
  for (var i = 0; i < colors.length; i++) {
    sh.shape('rect', x + i * bw, y + (i % 2) * 6, bw - 4, h - (i % 2) * 6, { name: 'Book', fill: { type: 'solid', color: colors[i] } });
  }
}
function grain(sh) {
  sh.shape('rect', 0, 0, sh.w, sh.h, { name: 'Grain', opacity: 0.07, fill: { type: 'solid', color: '#FFFFFF' } });
}
function flower(sh, x, y, s, color) {
  for (var i = 0; i < 5; i++) {
    var a = i * Math.PI * 2 / 5;
    sh.shape('ellipse', x + Math.cos(a) * s * 0.32, y + Math.sin(a) * s * 0.32, s * 0.4, s * 0.4, {
      name: 'Petal', fill: { type: 'solid', color: color || '#E7B7C2' }
    });
  }
  sh.shape('ellipse', x + s * 0.2, y + s * 0.2, s * 0.26, s * 0.26, { name: 'Center', fill: { type: 'solid', color: '#E6C36A' } });
}
function swatches(sh, x, y) {
  var cols = ['#E7D3C4', '#C4A48A', '#8C6B55', '#5C4A3A', '#EFE6DC'];
  for (var i = 0; i < cols.length; i++) {
    sh.shape('ellipse', x + i * 34, y, 26, 26, {
      name: 'Swatch', fill: { type: 'solid', color: cols[i] }, stroke: { width: 2, color: WHITE }
    });
  }
}
function rules(sh, x, y, w, count, gap, color) {
  var n = Math.min(count, 16);
  for (var i = 0; i < n; i++) {
    sh.shape('line', x, y + i * gap, w, 8, {
      name: 'Rule', fill: { type: 'none' }, stroke: { width: 1, color: color || '#C5D0DE', cap: 'round' }
    });
  }
}
function scrap(sh, x, y, w, h, rot, color) {
  sh.shape('blob', x, y, w, h, {
    name: 'Scrap', rotation: rot || 0, fill: { type: 'solid', color: color || '#E7D7B8' }
  });
}

function addGrid(sh, box, cols, rows, gap, photos, opt) {
  opt = opt || {};
  var cw = (box.w - gap * (cols - 1)) / cols;
  var ch = (box.h - gap * (rows - 1)) / rows;
  assert(cw >= 64 && ch >= 64, 'grid cell too small');
  var k = 0;
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var extra = opt.each ? opt.each(k, c, r) : {};
      sh.slot(box.x + c * (cw + gap), box.y + r * (ch + gap), cw, ch, Object.assign({
        photo: photos[k % photos.length], z: (opt.z || 1) + k
      }, extra));
      k++;
    }
  }
}
function cells(sh, list, photos, opt) {
  opt = opt || {};
  var g = opt.gap || 0;
  list.forEach(function (c, i) {
    var extra = opt.each ? opt.each(i) : {};
    sh.slot(sh.w * c[0] + g, sh.h * c[1] + g, sh.w * c[2] - g * 2, sh.h * c[3] - g * 2, Object.assign({
      photo: photos[i % photos.length], z: i + 1, radius: opt.radius || 0
    }, extra));
  });
}
function headPath(w, h, flip) {
  return HEAD.map(function (cmd) {
    if (cmd[0] === 'Z') return 'Z';
    var s = cmd[0];
    for (var i = 1; i < cmd.length; i += 2) {
      var x = flip ? (100 - cmd[i]) : cmd[i];
      s += (i === 1 ? '' : ' ') + Math.round(x / 100 * w) + ' ' + Math.round(cmd[i + 1] / 100 * h);
    }
    return s;
  }).join('');
}
function inHeart(x, y) {
  var a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
}
function starPoly() {
  var pts = [];
  for (var i = 0; i < 10; i++) {
    var a = -Math.PI / 2 + i * Math.PI / 5;
    var r = i % 2 ? 0.42 : 1;
    pts.push([Math.cos(a) * r, -Math.sin(a) * r]);
  }
  return pts;
}
function inPoly(x, y, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}
var STAR = starPoly();
function samples(test, n) {
  var step = 0.2;
  var pts = [];
  for (var guard = 0; guard < 7 && pts.length < n; guard++) {
    pts = [];
    for (var y = -1.35; y <= 1.4; y += step) {
      for (var x = -1.35; x <= 1.4; x += step) if (test(x, y)) pts.push([x, y]);
    }
    step *= 0.8;
  }
  if (pts.length <= n) return pts;
  var out = [];
  for (var i = 0; i < n; i++) out.push(pts[Math.round(i * (pts.length - 1) / (n - 1))]);
  return out;
}
function placePacked(sh, kind, n, photos, rng, spec) {
  spec = spec || {};
  var test = kind === 'heart' ? inHeart : kind === 'star' ? function (x, y) { return inPoly(x, y, STAR); } : function (x, y) { return x * x + y * y <= 1; };
  var pts = samples(test, n);
  assert(pts.length >= n, kind + ' packed ' + pts.length + ' of ' + n);
  var size = Math.round(Math.max(88, Math.min(188, Math.min(sh.w, sh.h) / Math.sqrt(n) * 0.92)));
  var span = Math.min(sh.w, sh.h) * 0.36;
  var cx = sh.w * (spec.cx || 0.5);
  var cy = sh.h * (spec.cy || 0.52);
  pts.forEach(function (p, i) {
    var px = cx + p[0] * span + (rng() - 0.5) * 8;
    var py = cy - p[1] * span + (rng() - 0.5) * 8;
    sh.slot(px - size / 2, py - size * 0.56, size, Math.round(size * 1.12), pol(photos[i], i + 1, Math.round((rng() - 0.5) * 16), Math.max(6, Math.round(size * 0.05))));
  });
}
function drawRings(sh, photos, spec) {
  var m = Math.min(sh.w, sh.h);
  var cx = sh.w / 2, cy = sh.h / 2;
  var k = 0;
  if (spec.center) {
    var cs = Math.round(m * spec.center);
    sh.slot(cx - cs / 2, cy - cs / 2, cs, cs, {
      photo: photos[k++], mask: 'ellipse', z: 8,
      border: { width: spec.warm ? 16 : 8, color: spec.warm ? '#C4473A' : WHITE }
    });
  }
  if (spec.warm) {
    var rr = Math.round(m * ((spec.center || 0.16) + 0.05));
    sh.shape('ellipse', cx - rr / 2, cy - rr / 2, rr, rr, {
      name: 'Warm center', fill: { type: 'none' }, stroke: { width: 16, color: '#C4473A' }
    });
  }
  spec.rings.forEach(function (ring, ri) {
    var rad = m * ring.rf;
    var sw = Math.round(m * ring.sf);
    for (var i = 0; i < ring.count; i++) {
      var a = (i / ring.count) * Math.PI * 2 + (ring.phase || 0);
      var deg = spec.radial ? Math.round(a * 180 / Math.PI) : Math.round(Math.sin(a * 3) * 11);
      sh.slot(
        cx + Math.cos(a) * rad * (spec.rx || 1) - sw / 2,
        cy + Math.sin(a) * rad * (spec.ry || 1) - sw / 2,
        sw, sw,
        pol(photos[k++], 20 + ri * 30 + i, deg, Math.max(5, Math.round(sw * 0.045)))
      );
    }
  });
  if (spec.title) {
    sh.text(spec.title, 36, 28, sh.w - 72, 64, { font: 'Syne', weight: 700, size: 42, align: 'center', color: INK, name: 'Title' });
  }
}
function ransom(sh, word, x, y, size, rng) {
  var fonts = ['Anton', 'Bebas Neue', 'Archivo Black', 'Abril Fatface'];
  var colors = ['#E23B2F', '#17131F', '#F2C14E', '#2F6FED', WHITE];
  var cursor = x;
  for (var i = 0; i < word.length; i++) {
    var w = size * 0.78;
    sh.text(word.charAt(i), cursor, y + (rng() - 0.5) * 14, w, size, {
      font: fonts[i % fonts.length], size: Math.round(size * 0.78),
      color: colors[i % colors.length], rotation: Math.round((rng() - 0.5) * 14),
      align: 'center', name: 'Cutout'
    });
    cursor += w * 0.8;
  }
}

function addStyle(meta) { STYLES.push(meta); }

/* Compact slot geometry for catalogue cards: "x,y,w,h[,rot][,mask]" in whole % of the page, ';'-joined.
   Decoded by LE.collage.artSlots(); lets every card show its real arrangement without loading the pack. */
function artOf(t) {
  return t.slots.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); }).slice(0, 40).map(function (s) {
    var p = [s.x / t.w, s.y / t.h, s.w / t.w, s.h / t.h].map(function (v) { return Math.round(v * 100); });
    var mask = s.maskPath ? 'p' : s.mask === 'ellipse' ? 'ellipse' : s.mask === 'heart' ? 'heart' : s.mask === 'star' ? 'star' : '';
    if (s.rot || mask) p.push(Math.round(s.rot || 0));
    if (mask) p.push(mask);
    return p.join(',');
  }).join(';');
}

function assemble(meta) {
  assert(meta.variants.length >= 1, meta.id + ' empty');
  return meta.variants.map(function (v, i) {
    var sz = SZ[v.size];
    assert(sz, meta.id + ' size ' + v.size);
    var sh = new Sheet(sz[0], sz[1]);
    var photos = mixer(meta.cats, 48, i * 5 + 1);
    var rng = mulberry((hash(meta.id) + i * 131) >>> 0);
    v.draw(sh, photos, rng, v);
    assert(sh.slots.length > 0, meta.id + ' ' + v.name + ' has no slots');
    return {
      id: meta.id + '-' + pad2(i + 1),
      style: meta.id,
      name: v.name,
      w: sh.w,
      h: sh.h,
      featured: i === 0,
      bg: v.bg,
      slots: sh.slots,
      decor: sh.decor
    };
  });
}

function main() {
  assert(STYLES.length === 50, 'style count ' + STYLES.length);
  var classicMap = {};
  CLASSIC.forEach(function (id) { classicMap[id] = 1; });
  var attachedMap = {};
  ATTACHED.forEach(function (id) { attachedMap[id] = 1; });
  var indexStyles = [];
  var indexTemplates = [];
  var packBytes = 0;
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).forEach(function (name) {
    if (name !== 'photos.json' && /\.json$/i.test(name)) fs.unlinkSync(path.join(OUT, name));
  });
  var masks = { heart: 1, ellipse: 1, star: 1, 'rounded-rect': 1, rect: 1, hexagon: 1, diamond: 1 };
  var shapes = { rect: 1, 'rounded-rect': 1, ellipse: 1, heart: 1, star: 1, burst: 1, line: 1, curve: 1, blob: 1, triangle: 1, diamond: 1, hexagon: 1 };
  var seen = {};
  STYLES.forEach(function (meta) {
    var templates = assemble(meta);
    if (attachedMap[meta.id]) assert(templates.length >= 8 && templates.length <= 12, meta.id + ' count ' + templates.length);
    else assert(templates.length >= 1 && templates.length <= 2, meta.id + ' classic count ' + templates.length);
    var featured = templates.filter(function (t) { return t.featured; });
    assert(featured.length === 1, meta.id + ' featured');
    var sizes = [];
    templates.forEach(function (t) {
      assert(!seen[t.id], 'dup ' + t.id);
      seen[t.id] = 1;
      assert(t.bg && (t.bg.type === 'solid' || t.bg.type === 'linear'), t.id + ' bg');
      var ids = {};
      t.slots.forEach(function (s) {
        assert(!ids[s.id], t.id + ' slot ' + s.id);
        ids[s.id] = 1;
        assert(s.w >= 64 && s.h >= 64, t.id + ' tiny slot');
        assert(byCat && s.photo, t.id + ' photo');
        var known = false;
        Object.keys(byCat).forEach(function (c) { if (byCat[c].indexOf(s.photo) >= 0) known = true; });
        assert(known, 'unknown photo ' + s.photo);
        if (s.mask) assert(masks[s.mask], 'mask ' + s.mask);
        if (s.maskPath) assert(/^[MLCZmlcz0-9 .\-]+$/.test(s.maskPath), 'maskPath');
      });
      if (meta.id === 'silhouette') {
        var paths = t.slots.filter(function (s) { return s.maskPath; });
        assert(paths.length === 1, t.id + ' silhouette path');
      }
      if (meta.id === 'shape-based' || meta.id === 'circular') {
        assert(t.slots.length >= 18 && t.slots.length <= 40, t.id + ' slots ' + t.slots.length);
      }
      t.decor.forEach(function (d) {
        assert(d.type === 'shape' || d.type === 'text', 'decor type');
        if (d.type === 'shape') assert(shapes[d.shape], 'shape ' + d.shape);
      });
      var sizeKey = t.w + 'x' + t.h;
      if (sizes.indexOf(sizeKey) < 0) sizes.push(sizeKey);
      indexTemplates.push({
        id: t.id, style: t.style, name: t.name, w: t.w, h: t.h, slots: t.slots.length, featured: !!t.featured,
        bgc: t.bg.type === 'solid' ? t.bg.color : t.bg.colors[0], art: artOf(t)
      });
    });
    var tags = meta.tags.slice();
    if (classicMap[meta.id] && tags.indexOf('classic') < 0) tags.push('classic');
    indexStyles.push({
      id: meta.id, name: meta.name, group: meta.group, tags: tags,
      slotCount: featured[0].slots.length, featured: true, count: templates.length, sizes: sizes
    });
    var pack = { v: 1, id: meta.id, name: meta.name, templates: templates };
    var body = JSON.stringify(pack);
    assert(body.indexOf('function') < 0 && body.indexOf('=>') < 0, 'script in ' + meta.id);
    fs.writeFileSync(path.join(OUT, meta.id + '.json'), body);
    packBytes += Buffer.byteLength(body);
  });
  CLASSIC.forEach(function (id) { assert(indexStyles.some(function (s) { return s.id === id; }), 'missing classic ' + id); });
  ATTACHED.forEach(function (id) { assert(indexStyles.some(function (s) { return s.id === id; }), 'missing attached ' + id); });
  var index = { v: 1, paint: ['bg', 'slots', 'decor'], styles: indexStyles, templates: indexTemplates };
  var indexText = JSON.stringify(index);
  assert(Buffer.byteLength(indexText) <= 150 * 1024, 'index too big');
  assert(indexTemplates.length >= 200 && indexTemplates.length <= 330, 'template count ' + indexTemplates.length);
  fs.writeFileSync(path.join(OUT, 'index.json'), indexText);
  var gz = zlib.gzipSync(Buffer.from(indexText)).length;
  console.log(JSON.stringify({
    styles: indexStyles.length,
    templates: indexTemplates.length,
    featured: indexTemplates.filter(function (t) { return t.featured; }).length,
    indexBytes: Buffer.byteLength(indexText),
    indexGzip: gz,
    packBytes: packBytes,
    jsonBytes: packBytes + Buffer.byteLength(indexText)
  }));
}

addStyle({
  id: 'silhouette', name: 'Silhouette', group: 'style', cats: ['people', 'paper', 'street', 'books'],
  tags: ['profile', 'type', 'cutout'],
  variants: [
    { name: 'Profile letters', size: 'sq', bg: solid('#F7F4EF'), mode: 'scatter', tiles: 6, flip: false },
    { name: 'Night profile', size: 'story', bg: solid('#111111'), mode: 'word', word: 'MIND', tiles: 4, flip: true, dark: true },
    { name: 'Editorial bust', size: 'land', bg: solid(CREAM), mode: 'column', word: 'A face of type', tiles: 4, flip: false, hw: 0.56 },
    { name: 'Cutout face', size: 'sq', bg: solid(WHITE), mode: 'scatter', tiles: 8, flip: true },
    { name: 'Tall cameo', size: 'story', bg: solid('#F6F1E8'), mode: 'stack', tiles: 5, flip: false },
    { name: 'Wide cameo', size: 'wide', bg: solid('#141414'), mode: 'band', tiles: 4, flip: false, dark: true },
    { name: 'Serif profile', size: 'sq', bg: solid('#EFE6D6'), mode: 'serif', tiles: 4, flip: true },
    { name: 'Photo bust', size: 'story', bg: solid(PAPER), mode: 'photos', tiles: 9, flip: false },
    { name: 'Poster head', size: 'sq', bg: solid('#F4EFE6'), mode: 'word', word: 'VOICE', tiles: 3, flip: false },
    { name: 'Split profile', size: 'land', bg: solid('#0E0E10'), mode: 'column', word: 'LOOK CLOSER', tiles: 5, flip: true, dark: true, hw: 0.52 }
  ].map(function (v) {
    v.draw = function (sh, ph) {
      var margin = 36;
      var hw = Math.round(sh.w * (v.hw || (v.mode === 'column' ? 0.58 : 0.86)));
      var hh = sh.h - margin * 2;
      var hx = v.mode === 'column' ? (v.flip ? sh.w - hw - margin : margin) : Math.round((sh.w - hw) / 2);
      var hy = margin;
      sh.slot(hx, hy, hw, hh, { id: 'hero', photo: ph[0], z: 1, maskPath: headPath(hw, hh, !!v.flip) });
      var colors = v.dark ? LETTER_D : LETTER_C;
      var font = v.mode === 'serif' ? 'Playfair Display' : 'Anton';
      if (v.mode === 'word' || v.mode === 'stack') {
        var word = v.word || 'TYPE';
        for (var i = 0; i < word.length; i++) {
          sh.text(word.charAt(i), hx + hw * 0.28, hy + hh * (0.12 + i * 0.12), hw * 0.44, hh * 0.12, {
            font: font, size: Math.round(hh * 0.1), align: 'center', color: colors[i % colors.length], name: 'Letter'
          });
        }
      } else {
        var n = v.mode === 'photos' ? 4 : 8;
        for (var L = 0; L < n; L++) {
          var pos = LETTER_POS[L];
          var lx = v.flip ? (1 - pos[0] - 0.16) : pos[0];
          sh.text(LETTERS[L], hx + hw * lx, hy + hh * pos[1], hw * 0.18, hh * 0.12, {
            font: font, size: Math.round(Math.min(hw, hh) * 0.12), align: 'center', color: colors[L % colors.length],
            rotation: (L % 2 ? -6 : 5), name: 'Letter'
          });
        }
      }
      var tiles = v.tiles || 4;
      for (var t = 0; t < tiles; t++) {
        var col = t % 3;
        var row = Math.floor(t / 3);
        var fx = (v.flip ? 0.22 : 0.30) + col * 0.16;
        var fy = 0.2 + row * 0.22;
        sh.slot(hx + hw * fx, hy + hh * fy, hw * 0.16, hh * 0.14, {
          photo: ph[t + 1], z: 6 + t, radius: 2, border: { width: 3, color: v.dark ? WHITE : INK }
        });
      }
      if (v.mode === 'column') {
        var tx = v.flip ? margin : hx + hw + 20;
        sh.text('PROFILE', tx, hy + 10, sh.w * 0.3, 36, { font: 'Plus Jakarta Sans', weight: 700, size: 16, letterSpacing: 3, color: v.dark ? '#F2C14E' : '#8C6B55' });
        sh.text(v.word || 'A face of type', tx, hy + 56, sh.w * 0.32, 160, {
          font: 'Instrument Serif', italic: true, size: 48, color: v.dark ? WHITE : INK, name: 'Headline'
        });
      }
    };
    return v;
  })
});

addStyle({
  id: 'panoramic', name: 'Panoramic', group: 'style', cats: ['travel', 'arch', 'garden', 'sky'],
  tags: ['gallery', 'wide', 'frame'],
  variants: [
    { name: 'Gallery row', size: 'pano', bg: solid('#161616'), cols: 8, rows: 1, gap: 10, pad: 28, frame: 10 },
    { name: 'Two-line wall', size: 'land', bg: solid('#F4F1EC'), cols: 5, rows: 2, gap: 12, pad: 48, frame: 8, plant: true },
    { name: 'Captioned strip', size: 'wide', bg: solid(CREAM), cols: 6, rows: 1, gap: 16, pad: 36, mat: true },
    { name: 'Hero and thumbs', size: 'land', bg: solid('#111111'), hero: true },
    { name: 'Story band', size: 'story', bg: solid('#F7F4EF'), cols: 2, rows: 4, gap: 12, pad: 28 },
    { name: 'Uneven widths', size: 'pano', bg: solid('#1C1C1C'), uneven: [1.5, 1, 1.1, 0.8, 1.3, 1] },
    { name: 'Tight gallery', size: 'wide', bg: solid(WHITE), cols: 4, rows: 3, gap: 8, pad: 24 },
    { name: 'White museum', size: 'land', bg: solid('#FBF8F4'), cols: 6, rows: 2, gap: 14, pad: 40, mat: true, frame: 2 },
    { name: 'Square strip', size: 'sq', bg: solid('#141414'), cols: 4, rows: 1, gap: 10, pad: 36, band: true },
    { name: 'Film panorama', size: 'pano', bg: solid('#0E0E0E'), cols: 7, rows: 1, gap: 8, pad: 36, sprocket: true }
  ].map(function (v) {
    v.draw = function (sh, ph) {
      if (v.sprocket) {
        for (var i = 0; i < 14; i++) {
          var sx = 20 + i * ((sh.w - 40) / 14);
          sh.shape('rounded-rect', sx, 12, 16, 12, { name: 'Sprocket', params: { radius: 2 }, fill: { type: 'solid', color: '#F4F1EA' } });
          sh.shape('rounded-rect', sx, sh.h - 24, 16, 12, { name: 'Sprocket', params: { radius: 2 }, fill: { type: 'solid', color: '#F4F1EA' } });
        }
      }
      if (v.hero) {
        sh.slot(36, 36, sh.w * 0.62, sh.h - 72, { photo: ph[0], z: 1, radius: 4 });
        for (var t = 0; t < 4; t++) sh.slot(sh.w * 0.68, 36 + t * ((sh.h - 72) / 4), sh.w * 0.28, (sh.h - 100) / 4, { photo: ph[t + 1], z: t + 2 });
        return;
      }
      if (v.uneven) {
        var sum = v.uneven.reduce(function (a, b) { return a + b; }, 0);
        var gap = 10;
        var x = 24;
        var inner = sh.w - 48 - gap * (v.uneven.length - 1);
        v.uneven.forEach(function (f, i) {
          var w = inner * f / sum;
          sh.slot(x, 28, w, sh.h - 56, { photo: ph[i], z: i + 1 });
          x += w + gap;
        });
        return;
      }
      var pad = v.pad || 28;
      var box = { x: pad, y: v.band ? sh.h * 0.28 : pad, w: sh.w - pad * 2, h: v.band ? sh.h * 0.44 : sh.h - pad * 2 };
      if (v.plant) box = { x: 64, y: 64, w: sh.w - 128, h: sh.h * 0.74 };
      if (v.frame) {
        sh.shape('rect', box.x - 14, box.y - 14, box.w + 28, box.h + 28, {
          name: 'Frame', fill: { type: 'none' }, stroke: { width: v.frame, color: v.bg.color === '#FBF8F4' || v.plant ? INK : WHITE }
        });
      }
      addGrid(sh, box, v.cols, v.rows, v.gap || 10, ph, {
        each: function () { return v.mat ? { border: { width: 6, color: WHITE }, radius: 2 } : {}; }
      });
      if (v.plant) {
        sh.shape('ellipse', sh.w * 0.08, sh.h * 0.78, 64, 86, { name: 'Vase', fill: { type: 'solid', color: '#C47A4A' } });
        leaf(sh, sh.w * 0.05, sh.h * 0.6, 80, 140, -18, '#6E8F62');
        leaf(sh, sh.w * 0.12, sh.h * 0.62, 70, 120, 22, '#8FA875');
        sh.text('GALLERY', sh.w * 0.28, sh.h * 0.82, sh.w * 0.4, 48, { font: 'Libre Baskerville', size: 28, align: 'center', color: INK });
      }
    };
    return v;
  })
});

addStyle({
  id: 'shape-based', name: 'Shape-based', group: 'style', cats: ['people', 'travel', 'garden'],
  tags: ['heart', 'star', 'cluster', 'polaroid'],
  variants: [
    { name: 'Heart prints', size: 'sq', bg: solid(WHITE), kind: 'heart', n: 26 },
    { name: 'Dense heart', size: 'sq', bg: solid('#F7F4F2'), kind: 'heart', n: 34 },
    { name: 'Story heart', size: 'story', bg: solid(WHITE), kind: 'heart', n: 20, cy: 0.48 },
    { name: 'Star cluster', size: 'sq', bg: solid('#FBF8F3'), kind: 'star', n: 22 },
    { name: 'Wide star', size: 'land', bg: solid(WHITE), kind: 'star', n: 18 },
    { name: 'Circle cluster', size: 'sq', bg: solid('#F4F1EC'), kind: 'circle', n: 24 },
    { name: 'Landscape heart', size: 'wide', bg: solid(WHITE), kind: 'heart', n: 28, cx: 0.58 },
    { name: 'Tall star', size: 'story', bg: solid('#FFF8F4'), kind: 'star', n: 30 },
    { name: 'Soft circle', size: 'story', bg: solid(CREAM), kind: 'circle', n: 20 },
    { name: 'Heart note', size: 'sq', bg: solid('#F8F1EA'), kind: 'heart', n: 24, note: 'OURS' }
  ].map(function (v) {
    v.draw = function (sh, ph, rng) {
      placePacked(sh, v.kind, v.n, ph, rng, { cx: v.cx, cy: v.cy });
      if (v.note) sh.text(v.note, 40, sh.h - 78, sh.w - 80, 52, { font: 'Caveat', weight: 700, size: 42, align: 'center', color: '#C4473A' });
      if (v.cx) sh.text('YOURS', 36, sh.h * 0.4, 180, 80, { font: 'Instrument Serif', italic: true, size: 42, color: INK });
    };
    return v;
  })
});

addStyle({
  id: 'circular', name: 'Circular', group: 'style', cats: ['people', 'garden', 'travel', 'still'],
  tags: ['rings', 'radial', 'polaroid'],
  variants: [
    { name: 'Warm rings', size: 'sq', bg: solid('#F8F1EA'), radial: true, warm: true, center: 0.16, rings: [{ count: 8, rf: 0.3, sf: 0.14 }, { count: 14, rf: 0.43, sf: 0.11 }] },
    { name: 'Four rings', size: 'sq', bg: solid(WHITE), radial: true, center: 0.12, rings: [{ count: 6, rf: 0.22, sf: 0.1 }, { count: 12, rf: 0.34, sf: 0.09 }, { count: 18, rf: 0.45, sf: 0.08 }] },
    { name: 'Story orbit', size: 'story', bg: solid(CREAM), radial: false, rings: [{ count: 8, rf: 0.28, sf: 0.12 }, { count: 12, rf: 0.42, sf: 0.1 }], title: 'AROUND' },
    { name: 'Wide orbit', size: 'land', bg: solid('#F7F3EC'), radial: true, warm: true, center: 0.14, rx: 1.15, ry: 0.72, rings: [{ count: 10, rf: 0.28, sf: 0.1 }, { count: 16, rf: 0.4, sf: 0.08 }] },
    { name: 'Loose rings', size: 'wide', bg: solid(WHITE), radial: false, center: 0.16, rings: [{ count: 7, rf: 0.3, sf: 0.12 }, { count: 13, rf: 0.44, sf: 0.09 }] },
    { name: 'Red core', size: 'sq', bg: solid('#F8EFE8'), radial: true, warm: true, rings: [{ count: 9, rf: 0.28, sf: 0.12 }, { count: 15, rf: 0.43, sf: 0.1 }] },
    { name: 'Tall rings', size: 'story', bg: solid('#FFF8F4'), radial: true, center: 0.14, rings: [{ count: 8, rf: 0.3, sf: 0.12 }, { count: 12, rf: 0.42, sf: 0.1 }], title: 'CIRCLE' },
    { name: 'Tight spiral', size: 'sq', bg: solid(WHITE), radial: true, center: 0.12, rings: [{ count: 6, rf: 0.24, sf: 0.11 }, { count: 10, rf: 0.35, sf: 0.09 }, { count: 16, rf: 0.45, sf: 0.08 }] },
    { name: 'Even orbit', size: 'land', bg: solid(CREAM), radial: false, rings: [{ count: 8, rf: 0.26, sf: 0.11, phase: 0.2 }, { count: 16, rf: 0.4, sf: 0.08 }], rx: 1.12, ry: 0.7 },
    { name: 'Triple ring', size: 'sq', bg: solid('#F6F1EA'), radial: true, warm: true, center: 0.14, rings: [{ count: 8, rf: 0.26, sf: 0.11 }, { count: 11, rf: 0.36, sf: 0.09 }, { count: 14, rf: 0.45, sf: 0.08 }] }
  ].map(function (v) {
    v.draw = function (sh, ph) { drawRings(sh, ph, v); };
    return v;
  })
});

addStyle({
  id: 'streetwear', name: 'Streetwear', group: 'style', cats: ['street', 'people', 'arch'],
  tags: ['urban', 'overlap', 'portrait'],
  variants: [
    { name: 'Overlap edit', size: 'sq', bg: solid('#101114'), n: 5, back: true, word: 'STREET', spin: 14 },
    { name: 'Night stack', size: 'story', bg: solid('#0E0E10'), n: 6, back: true, word: 'AFTER DARK', spin: 10 },
    { name: 'Wide contact', size: 'land', bg: solid('#141414'), n: 4, word: 'CONTACT', spin: 8, border: true },
    { name: 'Red bar', size: 'sq', bg: solid('#101114'), n: 5, back: true, word: '90S', spin: 12, bar: true },
    { name: 'Tall film', size: 'story', bg: solid('#0C0C0E'), n: 6, word: 'ROLL', spin: 16, border: true },
    { name: 'Four up', size: 'wide', bg: solid('#121212'), n: 4, back: true, word: 'CITY', spin: 6 },
    { name: 'Loose pile', size: 'sq', bg: solid('#18181B'), n: 6, word: 'RAW', spin: 18 },
    { name: 'Poster crop', size: 'story', bg: solid('#101114'), n: 4, back: true, word: 'LOOK', spin: 8, border: true },
    { name: 'Grid clash', size: 'land', bg: solid('#0E0E10'), n: 6, word: 'EDIT', spin: 12 },
    { name: 'Studio wall', size: 'sq', bg: solid('#141418'), n: 7, back: true, word: 'STUDIO', spin: 10, border: true }
  ].map(function (v) {
    v.draw = function (sh, ph, rng) {
      if (v.back) sh.slot(0, 0, sh.w, sh.h, { photo: ph[0], z: 1 });
      var tileW = sh.w * (v.size === 'story' ? 0.58 : v.size === 'land' || v.size === 'wide' ? 0.28 : 0.46);
      var tileH = tileW * 1.22;
      for (var i = 0; i < v.n; i++) {
        var x, y;
        if (v.size === 'story') { x = sh.w * (i % 2 ? 0.3 : 0.08); y = sh.h * (0.05 + i * 0.13); }
        else if (v.size === 'land' || v.size === 'wide') { x = sh.w * (0.04 + i * (0.78 / v.n)); y = sh.h * (0.14 + (i % 2) * 0.22); }
        else { x = sh.w * (0.06 + (i % 3) * 0.2); y = sh.h * (0.08 + Math.floor(i / 3) * 0.32); }
        x += (rng() - 0.5) * 24;
        y += (rng() - 0.5) * 20;
        sh.slot(x, y, tileW, tileH, {
          photo: ph[i + 1], z: i + 3, rot: Math.round((rng() - 0.5) * v.spin), radius: 8,
          border: v.border ? { width: 6, color: '#F4F1EA' } : null,
          shadow: { color: 'rgba(0,0,0,.45)', blur: 20, x: 0, y: 10 }
        });
      }
      grain(sh);
      if (v.bar) sh.shape('rect', 0, sh.h - 84, sh.w, 84, { name: 'Bar', fill: { type: 'solid', color: '#E23B2F' } });
      sh.text(v.word, 32, v.bar ? sh.h - 74 : 24, sh.w - 64, 70, {
        font: 'Anton', size: v.bar ? 46 : 64, color: WHITE, align: 'left', stroke: { width: 2, color: '#111111' }, name: 'Title'
      });
    };
    return v;
  })
});

addStyle({
  id: 'coquette', name: 'Coquette', group: 'style', cats: ['soft', 'people', 'garden'],
  tags: ['pink', 'bow', 'heart'],
  variants: [
    { name: 'Blush scatter', size: 'sq', bg: solid('#F8E6EA'), mode: 'scatter', n: 4 },
    { name: 'Polaroid row', size: 'land', bg: solid('#FDECF1'), mode: 'row', n: 4 },
    { name: 'Story bows', size: 'story', bg: solid('#F8E6EA'), mode: 'stack', n: 4 },
    { name: 'Hero heart', size: 'sq', bg: solid('#FFF5F7'), mode: 'hero', n: 3 },
    { name: 'Diagonal notes', size: 'sq', bg: solid('#F6D5DE'), mode: 'diag', n: 5 },
    { name: 'Wide ribbon', size: 'wide', bg: solid('#FDECF1'), mode: 'row', n: 5 },
    { name: 'Tall sweets', size: 'story', bg: solid('#F8E6EA'), mode: 'scatter', n: 5 },
    { name: 'Cluster', size: 'sq', bg: solid('#FFF0F4'), mode: 'cluster', n: 6 },
    { name: 'Soft grid', size: 'sq', bg: solid('#FDECF1'), mode: 'grid', cols: 2, rows: 2 },
    { name: 'Journal pink', size: 'land', bg: solid('#F8E6EA'), mode: 'hero', n: 4 }
  ].map(function (v) {
    v.draw = function (sh, ph, rng) {
      bow(sh, 24, 24, 90, '#F2A7C0');
      bow(sh, sh.w - 130, sh.h - 150, 100, '#F4B7CC');
      candy(sh, sh.w - 150, 30, 78, 'XOXO', '#F7B6C8');
      candy(sh, 30, sh.h - 120, 70, 'HUG', '#F3C6D8');
      if (v.mode !== 'stack') candy(sh, sh.w * 0.4, sh.h - 100, 64, 'LOVE', '#E89BB5');
      dots(sh, 40, sh.h * 0.48, 10, 22, 7, '#E7A8BC');
      if (v.mode === 'grid') {
        addGrid(sh, { x: sh.w * 0.12, y: sh.h * 0.16, w: sh.w * 0.76, h: sh.h * 0.62 }, v.cols, v.rows, 20, ph, {
          each: function (k) { return pol(ph[k], k + 1, (k % 2 ? 4 : -3), 10); }
        });
      } else if (v.mode === 'row') {
        for (var i = 0; i < v.n; i++) {
          sh.slot(sh.w * (0.04 + i * (0.9 / v.n)), sh.h * 0.22, sh.w * (0.8 / v.n), sh.h * 0.5, pol(ph[i], i + 1, (i - 2) * 3, 8));
        }
      } else if (v.mode === 'stack') {
        for (var s = 0; s < v.n; s++) sh.slot(sh.w * 0.2, 140 + s * (sh.h * 0.18), sh.w * 0.6, sh.h * 0.2, pol(ph[s], s + 1, s % 2 ? 4 : -4, 8));
      } else if (v.mode === 'hero') {
        sh.slot(sh.w * 0.22, sh.h * 0.16, sh.w * 0.56, sh.h * 0.48, pol(ph[0], 2, -2, 12));
        for (var h = 1; h < v.n; h++) sh.slot(40 + (h - 1) * (sh.w * 0.3), sh.h * 0.7, sh.w * 0.26, sh.h * 0.2, pol(ph[h], h + 2, 0, 8));
      } else if (v.mode === 'diag') {
        for (var d = 0; d < v.n; d++) sh.slot(sh.w * (0.06 + d * 0.14), sh.h * (0.08 + d * 0.12), sh.w * 0.32, sh.h * 0.32, pol(ph[d], d + 1, Math.round((rng() - 0.5) * 12), 8));
      } else {
        var spots = [[0.08, 0.1], [0.4, 0.06], [0.62, 0.28], [0.12, 0.48], [0.48, 0.5], [0.28, 0.68]];
        for (var c = 0; c < v.n; c++) sh.slot(sh.w * spots[c][0], sh.h * spots[c][1], sh.w * 0.3, sh.h * 0.28, pol(ph[c], c + 1, Math.round((rng() - 0.5) * 10), 8));
      }
      sh.text('coquette', 40, 8, 220, 36, { font: 'Sacramento', size: 32, color: '#C45B78' });
    };
    return v;
  })
});

addStyle({
  id: 'dark-academia', name: 'Dark academia', group: 'style', cats: ['books', 'still', 'people'],
  tags: ['library', 'serif', 'brown'],
  variants: [
    { name: 'Library grid', size: 'sq', bg: solid('#2A2118'), mode: 'grid', cols: 2, rows: 2 },
    { name: 'Reading desk', size: 'land', bg: solid('#3A2E24'), mode: 'desk' },
    { name: 'Story shelves', size: 'story', bg: solid('#241C16'), mode: 'stack' },
    { name: 'Overlap tomes', size: 'sq', bg: solid('#2C241C'), mode: 'overlap' },
    { name: 'Wide archive', size: 'wide', bg: solid('#3A2E24'), mode: 'row' },
    { name: 'Ticket study', size: 'sq', bg: solid('#1C1612'), mode: 'grid', cols: 3, rows: 2 },
    { name: 'Tall essay', size: 'story', bg: solid('#2A2118'), mode: 'essay' },
    { name: 'Corner books', size: 'sq', bg: solid('#322820'), mode: 'corner' },
    { name: 'Spread', size: 'land', bg: solid('#241C16'), mode: 'spread' },
    { name: 'Quiet hour', size: 'sq', bg: solid('#3A2E24'), mode: 'hero' }
  ].map(function (v) {
    v.draw = function (sh, ph, rng) {
      var ink = '#E8DCC8';
      sh.text('dark academia', 36, 24, sh.w - 72, 48, { font: 'Cormorant Garamond', italic: true, size: 36, color: '#C4A574', align: 'center' });
      books(sh, 36, sh.h - 78, Math.min(280, sh.w * 0.3), 52);
      ticket(sh, sh.w - 230, sh.h - 120, 190, 86, 'LIBRARY', 'NO. 048', '#E7D7BC');
      if (v.mode === 'grid') {
        addGrid(sh, { x: 36, y: 88, w: sh.w - 72, h: sh.h - 200 }, v.cols, v.rows, 14, ph, { each: function () { return { radius: 4 }; } });
      } else if (v.mode === 'desk') {
        sh.slot(40, 90, sh.w * 0.46, sh.h - 180, { photo: ph[0], z: 1, radius: 6 });
        sh.slot(sh.w * 0.54, 90, sh.w * 0.2, sh.h * 0.36, { photo: ph[1], z: 2, radius: 4, rot: -4 });
        sh.slot(sh.w * 0.72, 120, sh.w * 0.22, sh.h * 0.4, { photo: ph[2], z: 3, radius: 4, rot: 5 });
        sh.slot(sh.w * 0.56, sh.h * 0.55, sh.w * 0.36, sh.h * 0.28, { photo: ph[3], z: 4, radius: 4 });
      } else if (v.mode === 'spread') {
        sh.slot(36, 90, sh.w * 0.42, sh.h - 160, { photo: ph[0], z: 1, radius: 4 });
        sh.slot(sh.w * 0.56, 90, sh.w * 0.4, sh.h * 0.42, { photo: ph[1], z: 2, radius: 4 });
        sh.slot(sh.w * 0.56, sh.h * 0.56, sh.w * 0.18, sh.h * 0.28, { photo: ph[2], z: 3, radius: 4 });
        sh.slot(sh.w * 0.76, sh.h * 0.56, sh.w * 0.2, sh.h * 0.28, { photo: ph[3], z: 4, radius: 4 });
      } else if (v.mode === 'stack') {
        for (var i = 0; i < 4; i++) sh.slot(70, 100 + i * (sh.h * 0.18), sh.w - 140, sh.h * 0.16, { photo: ph[i], z: i + 1, radius: 4, rot: i % 2 ? 2 : -2 });
        sh.text('read slowly', 80, sh.h * 0.86, sh.w - 160, 40, { font: 'EB Garamond', italic: true, size: 28, color: ink, align: 'center' });
      } else if (v.mode === 'essay') {
        sh.slot(60, 100, sh.w - 120, sh.h * 0.42, { photo: ph[0], z: 1, radius: 6 });
        sh.slot(60, sh.h * 0.56, sh.w * 0.42, sh.h * 0.28, { photo: ph[1], z: 2, radius: 4, rot: -2 });
        sh.slot(sh.w * 0.52, sh.h * 0.58, sh.w * 0.4, sh.h * 0.26, { photo: ph[2], z: 3, radius: 4, rot: 3 });
        sh.text('a quiet chapter', 80, sh.h * 0.88, sh.w - 160, 48, { font: 'EB Garamond', italic: true, size: 32, align: 'center', color: ink });
      } else if (v.mode === 'row') {
        addGrid(sh, { x: 28, y: 90, w: sh.w - 56, h: sh.h - 200 }, 5, 1, 12, ph, { each: function () { return { radius: 4 }; } });
      } else if (v.mode === 'hero') {
        sh.slot(80, 90, sh.w - 160, sh.h * 0.55, { photo: ph[0], z: 1, radius: 8 });
        sh.slot(80, sh.h * 0.68, sh.w * 0.36, sh.h * 0.18, { photo: ph[1], z: 2, radius: 4 });
        sh.slot(sh.w * 0.5, sh.h * 0.68, sh.w * 0.36, sh.h * 0.18, { photo: ph[2], z: 3, radius: 4 });
      } else if (v.mode === 'corner') {
        sh.slot(40, 90, sh.w * 0.62, sh.h * 0.62, { photo: ph[0], z: 1, radius: 6 });
        sh.slot(sh.w * 0.52, sh.h * 0.42, sh.w * 0.4, sh.h * 0.36, { photo: ph[1], z: 3, rot: 6, radius: 4, shadow: shadow(18) });
        sh.slot(36, sh.h * 0.68, sh.w * 0.4, sh.h * 0.2, { photo: ph[2], z: 2, radius: 4 });
      } else {
        for (var o = 0; o < 5; o++) {
          sh.slot(50 + o * 30, 100 + o * 36, sh.w * 0.55, sh.h * 0.42, {
            photo: ph[o], z: o + 1, rot: Math.round((rng() - 0.5) * 8), radius: 4, shadow: shadow(16)
          });
        }
      }
      sh.text('chapter iv', 36, sh.h - 40, 220, 28, { font: 'EB Garamond', italic: true, size: 18, color: ink });
    };
    return v;
  })
});

addStyle({
  id: 'cottagecore', name: 'Cottagecore', group: 'style', cats: ['garden', 'nature', 'still'],
  tags: ['garden', 'sage', 'floral'],
  variants: [
    { name: 'Garden grid', size: 'sq', bg: solid('#F3EDE2'), mode: 'grid' },
    { name: 'Polaroid path', size: 'land', bg: solid('#E7E1D1'), mode: 'row' },
    { name: 'Story meadow', size: 'story', bg: solid('#F7F3EA'), mode: 'stack' },
    { name: 'Asymmetric', size: 'sq', bg: solid('#F3EDE2'), mode: 'hero' },
    { name: 'Wide hedge', size: 'wide', bg: solid('#E7EFE4'), mode: 'grid3' },
    { name: 'Window light', size: 'sq', bg: solid('#F7F3EA'), mode: 'window' },
    { name: 'Basket day', size: 'story', bg: solid('#F3EDE2'), mode: 'hero' },
    { name: 'Four seasons', size: 'sq', bg: solid('#E7E1D1'), mode: 'seasons' },
    { name: 'Picnic row', size: 'land', bg: solid('#F7F3EA'), mode: 'picnic' },
    { name: 'Cottage note', size: 'sq', bg: solid('#F3EDE2'), mode: 'note' }
  ].map(function (v) {
    v.draw = function (sh, ph) {
      flower(sh, 18, 16, 54, '#E7B7C2');
      flower(sh, sh.w - 90, 20, 48, '#F2D7A2');
      flower(sh, sh.w - 80, sh.h - 90, 50, '#D7C4A8');
      sh.text('cottage', 80, 16, 200, 40, { font: 'Cormorant Garamond', italic: true, size: 32, color: '#6E7A52' });
      if (v.mode === 'grid' || v.mode === 'grid3') {
        var cols = v.mode === 'grid3' ? 3 : 2;
        addGrid(sh, { x: 40, y: 80, w: sh.w - 80, h: sh.h - 140 }, cols, 2, 16, ph, { each: function () { return { radius: 10 }; } });
      } else if (v.mode === 'row') {
        for (var i = 0; i < 4; i++) sh.slot(40 + i * (sh.w * 0.23), sh.h * 0.22, sh.w * 0.2, sh.h * 0.52, pol(ph[i], i + 1, (i - 1) * 3, 8));
      } else if (v.mode === 'picnic') {
        sh.slot(48, 80, sh.w * 0.62, sh.h * 0.7, { photo: ph[0], z: 1, radius: 16 });
        for (var p = 1; p < 4; p++) sh.slot(sh.w * 0.52, 70 + (p - 1) * (sh.h * 0.28), sh.w * 0.42, sh.h * 0.26, pol(ph[p], p + 2, (p - 2) * 3, 8));
      } else if (v.mode === 'seasons') {
        sh.slot(48, 80, sh.w - 96, sh.h * 0.46, { photo: ph[0], z: 1, radius: 14 });
        for (var q = 0; q < 3; q++) sh.slot(48 + q * (sh.w * 0.31), sh.h * 0.58, sh.w * 0.28, sh.h * 0.32, pol(ph[q + 1], q + 2, q - 1, 6));
      } else if (v.mode === 'stack') {
        addGrid(sh, { x: 48, y: 90, w: sh.w - 96, h: sh.h - 180 }, 1, 3, 16, ph, { each: function () { return { radius: 16 }; } });
      } else if (v.mode === 'window') {
        sh.shape('rect', 70, 80, sh.w - 140, sh.h - 160, { name: 'Sill', fill: { type: 'none' }, stroke: { width: 12, color: '#F7F3EA' } });
        addGrid(sh, { x: 92, y: 100, w: sh.w - 184, h: sh.h - 200 }, 2, 2, 12, ph, {});
      } else if (v.mode === 'note') {
        sh.slot(48, 80, sh.w * 0.48, sh.h * 0.7, { photo: ph[0], z: 1, radius: 12 });
        sh.slot(sh.w * 0.54, 100, sh.w * 0.4, sh.h * 0.32, pol(ph[1], 2, 4, 8));
        sh.slot(sh.w * 0.56, sh.h * 0.5, sh.w * 0.36, sh.h * 0.28, pol(ph[2], 3, -3, 8));
        sh.text('slow afternoon', sh.w * 0.54, sh.h * 0.82, sh.w * 0.4, 36, { font: 'Caveat', weight: 700, size: 28, color: '#6E7A52' });
      } else {
        sh.slot(40, 80, sh.w * 0.58, sh.h * 0.62, { photo: ph[0], z: 1, radius: 18 });
        sh.slot(sh.w * 0.52, sh.h * 0.4, sh.w * 0.4, sh.h * 0.28, pol(ph[1], 3, 5, 8));
        sh.slot(48, sh.h * 0.7, sh.w * 0.4, sh.h * 0.2, { photo: ph[2], z: 2, radius: 12 });
      }
    };
    return v;
  })
});

addStyle({
  id: 'pinterest-aesthetic', name: 'Pinterest aesthetic', group: 'style', cats: ['soft', 'still', 'garden', 'travel'],
  tags: ['beige', 'polaroid', 'leaves'],
  variants: [
    { name: 'Scattered pins', size: 'sq', bg: solid('#E6D7C3'), n: 5 },
    { name: 'Loose grid', size: 'sq', bg: solid('#EFE6DC'), mode: 'grid' },
    { name: 'Story board', size: 'story', bg: solid('#E6D7C3'), n: 6 },
    { name: 'Wide mood', size: 'land', bg: solid('#E7D3C4'), n: 5 },
    { name: 'Diagonal pins', size: 'sq', bg: solid('#F3E6D6'), mode: 'diag', n: 4 },
    { name: 'Palette wall', size: 'sq', bg: solid('#E6D7C3'), n: 6 },
    { name: 'Tall pins', size: 'story', bg: solid('#EFE6DC'), mode: 'grid' },
    { name: 'Soft cluster', size: 'wide', bg: solid('#E6D7C3'), n: 4 },
    { name: 'Center pin', size: 'sq', bg: solid('#F3E6D6'), mode: 'hero' },
    { name: 'Beige row', size: 'land', bg: solid('#EFE6DC'), mode: 'row', n: 4 }
  ].map(function (v) {
    v.draw = function (sh, ph, rng) {
      leaf(sh, 16, 20, 70, 120, -20, '#8C8175');
      leaf(sh, sh.w - 100, 30, 80, 130, 16, '#A89880');
      leaf(sh, sh.w - 90, sh.h - 160, 70, 120, 28, '#8C8175');
      swatches(sh, 36, sh.h - 52);
      var spots = [[0.08, 0.08, 0.34, 0.4], [0.46, 0.06, 0.28, 0.32], [0.68, 0.22, 0.26, 0.3], [0.1, 0.52, 0.3, 0.32], [0.44, 0.46, 0.26, 0.34], [0.66, 0.56, 0.26, 0.28]];
      if (v.mode === 'grid') {
        addGrid(sh, { x: 48, y: 48, w: sh.w - 96, h: sh.h - 130 }, sh.h > sh.w ? 2 : 3, sh.h > sh.w ? 3 : 2, 18, ph, {
          each: function (k) { return pol(ph[k], k + 1, k % 2 ? 3 : -3, 12); }
        });
      } else if (v.mode === 'diag') {
        for (var i = 0; i < v.n; i++) sh.slot(40 + i * sh.w * 0.16, 50 + i * sh.h * 0.14, sh.w * 0.32, sh.h * 0.36, pol(ph[i], i + 1, (i - 1) * 4, 10));
      } else if (v.mode === 'hero') {
        sh.slot(sh.w * 0.22, sh.h * 0.12, sh.w * 0.56, sh.h * 0.58, pol(ph[0], 2, -2, 16));
        sh.slot(36, sh.h * 0.62, sh.w * 0.28, sh.h * 0.24, pol(ph[1], 3, 4, 8));
        sh.slot(sh.w * 0.62, sh.h * 0.66, sh.w * 0.28, sh.h * 0.22, pol(ph[2], 4, -3, 8));
      } else if (v.mode === 'row') {
        for (var r = 0; r < v.n; r++) sh.slot(40 + r * (sh.w * 0.23), sh.h * 0.18, sh.w * 0.2, sh.h * 0.55, pol(ph[r], r + 1, (r % 2 ? 3 : -3), 10));
      } else {
        for (var s = 0; s < (v.n || 5); s++) {
          var p = spots[s];
          sh.slot(sh.w * p[0], sh.h * p[1], sh.w * p[2], sh.h * p[3], pol(ph[s], s + 1, Math.round((rng() - 0.5) * 8), 10));
        }
      }
    };
    return v;
  })
});

addStyle({
  id: 'scrapbook', name: 'Scrapbook', group: 'style', cats: ['travel', 'people', 'garden', 'still'],
  tags: ['tape', 'paper', 'notes'],
  variants: [
    { name: 'Sunday spread', size: 'sq', bg: solid('#F4E7D4'), mode: 'spread' },
    { name: 'Photo grid', size: 'sq', bg: solid('#F7F1E6'), mode: 'grid' },
    { name: 'Story page', size: 'story', bg: solid('#F4E7D4'), mode: 'stack' },
    { name: 'Cluster page', size: 'sq', bg: solid('#EFE2D0'), mode: 'cluster' },
    { name: 'Wide album', size: 'land', bg: solid('#F7F1E6'), mode: 'wide' },
    { name: 'Four corners', size: 'sq', bg: solid('#F4E7D4'), mode: 'corners' },
    { name: 'Tall notes', size: 'story', bg: solid('#F7F1E6'), mode: 'notes' },
    { name: 'Picnic page', size: 'wide', bg: solid('#F4E7D4'), mode: 'row' },
    { name: 'Hero memory', size: 'sq', bg: solid('#EFE2D0'), mode: 'hero' },
    { name: 'Travel page', size: 'land', bg: solid('#F7F1E6'), mode: 'spread' }
  ].map(function (v) {
    v.draw = function (sh, ph) {
      sh.text('remember this', 36, 16, 280, 40, { font: 'Caveat', weight: 700, size: 32, color: '#C47A4A' });
      flower(sh, sh.w - 80, 10, 42, '#E7B7C2');
      if (v.mode === 'grid') addGrid(sh, { x: 48, y: 70, w: sh.w - 96, h: sh.h - 120 }, 2, 2, 22, ph, { each: function (k) { return pol(ph[k], k + 1, k % 2 ? 2 : -2, 8); } });
      else if (v.mode === 'stack' || v.mode === 'notes') {
        for (var i = 0; i < 4; i++) sh.slot(80, 80 + i * (sh.h * 0.2), sh.w - 160, sh.h * 0.16, pol(ph[i], i + 1, i % 2 ? 2 : -2, 6));
        sh.text('the good bits', 90, sh.h - 70, sh.w - 180, 40, { font: 'Caveat', weight: 700, size: 30, color: '#8C5A3C', align: 'center' });
      } else if (v.mode === 'wide' || v.mode === 'row') {
        for (var r = 0; r < 4; r++) sh.slot(36 + r * (sh.w * 0.24), sh.h * 0.22, sh.w * 0.22, sh.h * 0.5, pol(ph[r], r + 1, (r - 1) * 3, 8));
      } else if (v.mode === 'corners') {
        var cs = [[0.06, 0.1], [0.52, 0.08], [0.08, 0.54], [0.5, 0.52]];
        cs.forEach(function (p, i) { sh.slot(sh.w * p[0], sh.h * p[1], sh.w * 0.4, sh.h * 0.36, pol(ph[i], i + 1, i % 2 ? 3 : -3, 8)); });
      } else if (v.mode === 'hero') {
        sh.slot(sh.w * 0.16, sh.h * 0.14, sh.w * 0.68, sh.h * 0.55, pol(ph[0], 2, -2, 12));
        sh.slot(40, sh.h * 0.72, sh.w * 0.28, sh.h * 0.2, pol(ph[1], 3, 4, 6));
        sh.slot(sh.w * 0.62, sh.h * 0.7, sh.w * 0.28, sh.h * 0.2, pol(ph[2], 4, -3, 6));
      } else if (v.mode === 'cluster') {
        sh.slot(50, 70, sh.w * 0.5, sh.h * 0.46, pol(ph[0], 2, -4, 8));
        sh.slot(sh.w * 0.42, sh.h * 0.28, sh.w * 0.48, sh.h * 0.36, pol(ph[1], 4, 5, 8));
        sh.slot(40, sh.h * 0.58, sh.w * 0.42, sh.h * 0.3, pol(ph[2], 3, 3, 8));
        sh.slot(sh.w * 0.5, sh.h * 0.64, sh.w * 0.4, sh.h * 0.26, pol(ph[3], 5, -3, 8));
      } else {
        sh.slot(48, 70, sh.w * 0.55, sh.h * 0.48, pol(ph[0], 2, -3, 10));
        sh.slot(sh.w * 0.5, 90, sh.w * 0.42, sh.h * 0.32, pol(ph[1], 4, 4, 8));
        sh.slot(60, sh.h * 0.58, sh.w * 0.38, sh.h * 0.3, pol(ph[2], 3, 2, 8));
        sh.slot(sh.w * 0.48, sh.h * 0.52, sh.w * 0.42, sh.h * 0.34, pol(ph[3], 5, -4, 8));
      }
      tape(sh, sh.w * 0.2, sh.h * 0.16, 110, -18, WASHI[0]);
      tape(sh, sh.w * 0.58, sh.h * 0.2, 100, 12, WASHI[1]);
      tape(sh, sh.w * 0.3, sh.h * 0.62, 120, 8, WASHI[2]);
    };
    return v;
  })
});

addStyle({
  id: 'junk-journal', name: 'Junk journal', group: 'style', cats: ['paper', 'still', 'books', 'garden'],
  tags: ['torn', 'tags', 'layers'],
  variants: [
    { name: 'Layered pile', size: 'sq', bg: solid('#E7D7B8'), mode: 'pile' },
    { name: 'Tag page', size: 'land', bg: solid('#EFE2CC'), mode: 'tags' },
    { name: 'Story scraps', size: 'story', bg: solid('#E7D7B8'), mode: 'stack' },
    { name: 'Pocket page', size: 'sq', bg: solid('#F3E6CF'), mode: 'pockets' },
    { name: 'Wide debris', size: 'wide', bg: solid('#E7D7B8'), mode: 'row' },
    { name: 'Corner junk', size: 'sq', bg: solid('#EADCC0'), mode: 'corners' },
    { name: 'Tall tags', size: 'story', bg: solid('#E7D7B8'), mode: 'tags' },
    { name: 'Overlap scraps', size: 'sq', bg: solid('#F3E6CF'), mode: 'overlap' },
    { name: 'Desk pile', size: 'land', bg: solid('#E7D7B8'), mode: 'desk' },
    { name: 'Stitched page', size: 'sq', bg: solid('#EFE2CC'), mode: 'stitch' }
  ].map(function (v) {
    v.draw = function (sh, ph, rng) {
      scrap(sh, 20, 30, 180, 120, -8, '#F4E7CF');
      scrap(sh, sh.w - 200, sh.h - 150, 180, 110, 10, '#E7C8A4');
      stamp(sh, sh.w - 120, 24, 'POSTED');
      ticket(sh, 24, sh.h - 110, 170, 78, 'KEEP', 'NO. 12', '#F6E7CF');
      dots(sh, sh.w * 0.4, 20, 8, 16, 5, '#8C6B55');
      if (v.mode === 'stack') {
        for (var i = 0; i < 4; i++) sh.slot(70, 80 + i * (sh.h * 0.2), sh.w - 140, sh.h * 0.18, { photo: ph[i], z: i + 2, rot: Math.round((rng() - 0.5) * 6), radius: 8, border: { width: 6, color: '#F4E7CF' } });
      } else if (v.mode === 'row') {
        for (var r = 0; r < 4; r++) sh.slot(30 + r * sh.w * 0.24, sh.h * 0.22, sh.w * 0.22, sh.h * 0.5, { photo: ph[r], z: r + 2, rot: (r - 2) * 3, radius: 6 });
      } else if (v.mode === 'desk') {
        sh.slot(40, 80, sh.w * 0.4, sh.h * 0.55, { photo: ph[0], z: 2, rot: -4, radius: 4 });
        sh.slot(sh.w * 0.38, 120, sh.w * 0.32, sh.h * 0.4, { photo: ph[1], z: 4, rot: 6, radius: 4 });
        sh.slot(sh.w * 0.62, sh.h * 0.4, sh.w * 0.3, sh.h * 0.36, { photo: ph[2], z: 3, rot: -3, radius: 4 });
      } else if (v.mode === 'tags' || v.mode === 'stitch') {
        addGrid(sh, { x: 40, y: 70, w: sh.w - 80, h: sh.h - 200 }, sh.h > sh.w * 1.2 ? 2 : 3, 2, 16, ph, { each: function () { return { radius: 2 }; } });
        sh.shape('line', 28, 40, 8, sh.h - 80, { name: 'Stitch', fill: { type: 'none' }, stroke: { width: 2, color: '#8C3A3A', dash: [2, 6] } });
      } else if (v.mode === 'corners') {
        [[0.06, 0.08], [0.5, 0.12], [0.1, 0.52], [0.48, 0.5]].forEach(function (p, i) {
          sh.slot(sh.w * p[0], sh.h * p[1], sh.w * 0.4, sh.h * 0.34, { photo: ph[i], z: i + 2, rot: (i - 1) * 4, radius: 10 });
        });
      } else if (v.mode === 'overlap') {
        for (var o = 0; o < 4; o++) sh.slot(40 + o * 40, 70 + o * 30, sh.w * 0.55, sh.h * 0.42, { photo: ph[o], z: o + 2, rot: (o - 1) * 3, radius: 6, shadow: shadow(12) });
      } else if (v.mode === 'pockets') {
        sh.slot(50, 70, sh.w * 0.84, sh.h * 0.46, { photo: ph[0], z: 2, radius: 8 });
        sh.slot(40, sh.h * 0.56, sh.w * 0.46, sh.h * 0.32, { photo: ph[1], z: 3, rot: -3, radius: 6 });
        sh.slot(sh.w * 0.5, sh.h * 0.58, sh.w * 0.44, sh.h * 0.3, { photo: ph[2], z: 4, rot: 4, radius: 6 });
      } else {
        sh.slot(50, 70, sh.w * 0.48, sh.h * 0.4, { photo: ph[0], z: 3, rot: -5, radius: 6 });
        sh.slot(sh.w * 0.4, sh.h * 0.28, sh.w * 0.5, sh.h * 0.36, { photo: ph[1], z: 5, rot: 4, radius: 6 });
        sh.slot(36, sh.h * 0.55, sh.w * 0.42, sh.h * 0.28, { photo: ph[2], z: 4, rot: 2, radius: 6 });
      }
      sh.text('found', 40, sh.h - 36, 140, 30, { font: 'Homemade Apple', size: 18, color: '#6B4A32' });
    };
    return v;
  })
});

require('./collage-styles')({
  addStyle: addStyle, solid: solid, lin: lin, tape: tape, ticket: ticket, stamp: stamp,
  scrap: scrap, dots: dots, rules: rules, grain: grain, pol: pol, ransom: ransom,
  shadow: shadow, WHITE: WHITE, INK: INK, CREAM: CREAM, PAPER: PAPER, WASHI: WASHI,
  CITIES: CITIES, NAMES: NAMES
});

main();
