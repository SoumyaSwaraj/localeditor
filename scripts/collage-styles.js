'use strict';

/* Remaining collage styles. Declarative slot layouts only. */
module.exports = function (A) {
  var addStyle = A.addStyle;
  var solid = A.solid;
  var lin = A.lin;
  var tape = A.tape;
  var ticket = A.ticket;
  var stamp = A.stamp;
  var scrap = A.scrap;
  var dots = A.dots;
  var rules = A.rules;
  var grain = A.grain;
  var pol = A.pol;
  var ransom = A.ransom;
  var shadow = A.shadow;
  var WHITE = A.WHITE;
  var INK = A.INK;
  var CREAM = A.CREAM;
  var PAPER = A.PAPER;
  var WASHI = A.WASHI;
  var CITIES = A.CITIES;
  var NAMES = A.NAMES;

  function at(sh, c, ph, i, extra) {
    var o = extra || {};
    sh.slot(sh.w * c[0], sh.h * c[1], sh.w * c[2], sh.h * c[3], Object.assign({
      photo: ph[i % ph.length], z: i + 1, rot: c[4] || 0, radius: c[5] || 0
    }, o));
  }
  function lay(sh, list, ph, extra) {
    list.forEach(function (c, i) { at(sh, c, ph, i, extra); });
  }
  function rule(sh, y, color, width) {
    sh.shape('line', 28, y, sh.w - 56, 8, {
      name: 'Rule', fill: { type: 'none' }, stroke: { width: width || 2, color: color || INK }
    });
  }
  function card3(sh, x, y, w, h, photo, z, rot) {
    sh.slot(x, y, w, h, {
      photo: photo, z: z, rot: rot || 0, radius: 32,
      border: { width: 8, color: '#F7F1E8' },
      shadow: { color: 'rgba(40,24,10,.38)', blur: 32, x: 0, y: 18 }
    });
  }
  function vline(sh, x, y, len, color) {
    sh.shape('line', x - len / 2, y + len / 2 - 4, len, 8, {
      name: 'Grid', rotation: 90, fill: { type: 'none' },
      stroke: { width: 1, color: color || 'rgba(255,255,255,.55)' }
    });
  }

  function news(name, size, dark, cells, headline) {
    return {
      name: name, size: size, bg: solid(dark ? '#16140F' : '#F3F0E8'),
      draw: function (sh, ph) {
        var ink = dark ? '#F4F1EA' : INK;
        sh.text('THE DAILY EDIT', 28, 8, sh.w - 56, 48, {
          font: 'Playfair Display', weight: 700, size: 34, align: 'center', color: ink, letterSpacing: 2, name: 'Masthead'
        });
        rule(sh, 58, ink, 3);
        rule(sh, 66, ink, 1);
        sh.text(headline, 28, 72, sh.w - 56, 24, {
          font: 'Libre Baskerville', size: 13, align: 'center', color: ink, letterSpacing: 1
        });
        lay(sh, cells, ph);
      }
    };
  }

  addStyle({
    id: 'newspaper', name: 'Newspaper', group: 'style', cats: ['paper', 'people', 'arch', 'travel'],
    tags: ['print', 'columns', 'masthead'],
    variants: [
      news('Broadsheet', 'sq', false, [[0.04, 0.14, 0.58, 0.78], [0.64, 0.14, 0.32, 0.37], [0.64, 0.54, 0.32, 0.38]], 'CITY DESK  ·  MORNING'),
      news('Three columns', 'land', false, [[0.03, 0.16, 0.3, 0.78], [0.35, 0.16, 0.3, 0.78], [0.67, 0.16, 0.3, 0.78]], 'THE ARTS'),
      news('Front stack', 'story', false, [[0.06, 0.12, 0.88, 0.2], [0.06, 0.34, 0.88, 0.2], [0.06, 0.56, 0.88, 0.2], [0.06, 0.78, 0.88, 0.16]], 'LATE EDITION'),
      news('Clippings', 'sq', false, [[0.05, 0.14, 0.46, 0.4, -5, 2], [0.46, 0.16, 0.48, 0.36, 4, 2], [0.06, 0.54, 0.4, 0.36, 3, 2], [0.44, 0.52, 0.5, 0.4, -4, 2]], 'CUTTINGS'),
      news('Banner', 'wide', false, [[0.03, 0.16, 0.94, 0.48], [0.03, 0.68, 0.22, 0.26], [0.27, 0.68, 0.22, 0.26], [0.51, 0.68, 0.22, 0.26], [0.75, 0.68, 0.22, 0.26]], 'WEEKEND'),
      news('Classifieds', 'sq', false, [[0.04, 0.14, 0.92, 0.38], [0.04, 0.56, 0.3, 0.18], [0.35, 0.56, 0.3, 0.18], [0.66, 0.56, 0.3, 0.18], [0.04, 0.76, 0.3, 0.18], [0.35, 0.76, 0.3, 0.18], [0.66, 0.76, 0.3, 0.18]], 'NOTICES'),
      news('Spread', 'land', false, [[0.03, 0.16, 0.42, 0.78], [0.47, 0.16, 0.14, 0.78], [0.63, 0.16, 0.34, 0.78]], 'SUNDAY'),
      news('Evening', 'sq', true, [[0.05, 0.16, 0.43, 0.38], [0.52, 0.16, 0.43, 0.38], [0.05, 0.58, 0.43, 0.36], [0.52, 0.58, 0.43, 0.36]], 'EVENING'),
      news('Portrait page', 'story', false, [[0.05, 0.12, 0.6, 0.8], [0.68, 0.12, 0.27, 0.24], [0.68, 0.4, 0.27, 0.24], [0.68, 0.68, 0.27, 0.24]], 'PROFILE'),
      news('Tabloid', 'sq', false, [[0.04, 0.13, 0.92, 0.52], [0.04, 0.7, 0.29, 0.24], [0.35, 0.7, 0.29, 0.24], [0.66, 0.7, 0.29, 0.24]], 'EXTRA')
    ]
  });

  function cutout(name, size, word, cells, rx, ry) {
    return {
      name: name, size: size, bg: solid('#EFEAE2'),
      draw: function (sh, ph, rng) {
        lay(sh, cells, ph);
        ransom(sh, word, sh.w * rx, sh.h * ry, Math.round(Math.min(sh.w, sh.h) * 0.14), rng);
      }
    };
  }
  addStyle({
    id: 'magazine-cutout', name: 'Magazine cutout', group: 'style', cats: ['people', 'street', 'arch'],
    tags: ['ransom', 'cutout', 'letters'],
    variants: [
      cutout('Love letters', 'sq', 'LOVE', [[0.04, 0.06, 0.4, 0.4, -6, 2], [0.56, 0.08, 0.38, 0.36, 5, 2], [0.06, 0.52, 0.36, 0.4, 4, 2], [0.46, 0.5, 0.48, 0.42, -4, 2]], 0.18, 0.4),
      cutout('Star page', 'sq', 'STAR', [[0.08, 0.08, 0.5, 0.46, -8, 0], [0.48, 0.28, 0.44, 0.4, 7, 0], [0.1, 0.58, 0.42, 0.34, 3, 0]], 0.28, 0.08),
      cutout('Face feature', 'story', 'FACE', [[0.08, 0.06, 0.84, 0.42, -2, 0], [0.08, 0.52, 0.4, 0.28, 4, 2], [0.52, 0.56, 0.4, 0.28, -5, 2]], 0.12, 0.84),
      cutout('Look row', 'land', 'LOOK', [[0.04, 0.28, 0.28, 0.5, -4, 0], [0.34, 0.22, 0.3, 0.56, 2, 0], [0.66, 0.3, 0.3, 0.48, 5, 0]], 0.08, 0.06),
      cutout('Note pile', 'sq', 'NOTE', [[0.1, 0.18, 0.55, 0.48, -6, 4], [0.4, 0.36, 0.5, 0.42, 8, 4], [0.16, 0.58, 0.4, 0.32, 3, 4]], 0.08, 0.06),
      cutout('Bold split', 'land', 'BOLD', [[0.04, 0.18, 0.46, 0.7, -3, 0], [0.52, 0.22, 0.42, 0.62, 4, 0]], 0.08, 0.06),
      cutout('Cut stack', 'story', 'CUT', [[0.12, 0.08, 0.7, 0.28, -4, 2], [0.18, 0.32, 0.7, 0.26, 5, 2], [0.1, 0.56, 0.7, 0.26, -3, 2], [0.2, 0.76, 0.64, 0.18, 4, 2]], 0.16, 0.02),
      cutout('Now strip', 'wide', 'NOW', [[0.04, 0.22, 0.28, 0.62, -5, 0], [0.3, 0.16, 0.34, 0.68, 2, 0], [0.62, 0.24, 0.32, 0.58, 6, 0]], 0.08, 0.04),
      cutout('Yes scatter', 'sq', 'YES', [[0.06, 0.1, 0.36, 0.34, -7, 6], [0.4, 0.06, 0.32, 0.3, 6, 6], [0.66, 0.2, 0.28, 0.32, -4, 6], [0.12, 0.48, 0.34, 0.32, 5, 6], [0.46, 0.5, 0.4, 0.36, -3, 6]], 0.3, 0.84),
      cutout('Art overlap', 'land', 'ART', [[0.06, 0.16, 0.5, 0.7, -4, 0], [0.4, 0.22, 0.5, 0.62, 6, 0]], 0.36, 0.04)
    ]
  });

  function tapes(sh, n) {
    for (var i = 0; i < n; i++) {
      tape(sh, sh.w * (0.06 + (i % 4) * 0.2), sh.h * (0.08 + (i % 5) * 0.16), 110 + (i % 3) * 24, i % 2 ? 16 : -14, WASHI[i % WASHI.length]);
    }
  }
  addStyle({
    id: 'washi-tape', name: 'Washi tape', group: 'style', cats: ['travel', 'people', 'garden', 'soft'],
    tags: ['tape', 'pastel', 'album'],
    variants: [
      { name: 'Corner tape', size: 'sq', bg: solid('#FBF6F2'), mode: 'grid' },
      { name: 'Color row', size: 'land', bg: solid('#F7F1EC'), mode: 'row' },
      { name: 'Story strips', size: 'story', bg: solid('#FBF6F2'), mode: 'stack' },
      { name: 'Framed print', size: 'sq', bg: solid('#F4EFEA'), mode: 'frame' },
      { name: 'Diagonal hold', size: 'sq', bg: solid('#FBF6F2'), mode: 'diag' },
      { name: 'Wide stripes', size: 'wide', bg: solid('#F7F1EC'), mode: 'stripes' },
      { name: 'Loose tape', size: 'sq', bg: solid('#FFF8F4'), mode: 'scatter' },
      { name: 'Three columns', size: 'land', bg: solid('#FBF6F2'), mode: 'cols' },
      { name: 'Album page', size: 'story', bg: solid('#F7F1EC'), mode: 'album' },
      { name: 'Tape ladder', size: 'wide', bg: solid('#FBF6F2'), mode: 'ladder' }
    ].map(function (v) {
      v.draw = function (sh, ph) {
        var p = function (i, x, y, w, h, rot) {
          sh.slot(x, y, w, h, pol(ph[i], i + 1, rot || 0, 8));
        };
        if (v.mode === 'grid') {
          p(0, 70, 80, 440, 420, -2); p(1, 560, 90, 440, 400, 2);
          p(2, 80, 560, 420, 420, 2); p(3, 560, 560, 430, 420, -2);
          tapes(sh, 6);
        } else if (v.mode === 'row') {
          for (var i = 0; i < 4; i++) p(i, 48 + i * 470, 180, 420, 620, (i - 1) * 2);
          tapes(sh, 8);
        } else if (v.mode === 'stack') {
          for (var s = 0; s < 4; s++) p(s, 90, 80 + s * 450, 900, 380, s % 2 ? 2 : -2);
          tapes(sh, 8);
        } else if (v.mode === 'frame') {
          p(0, 140, 140, 800, 760, 0);
          p(1, 40, 760, 280, 240, 4);
          tapes(sh, 8);
        } else if (v.mode === 'diag') {
          p(0, 40, 60, 460, 420, -8); p(1, 360, 200, 440, 400, -2);
          p(2, 180, 520, 420, 400, 4); p(3, 620, 600, 400, 380, 8);
          tapes(sh, 5);
        } else if (v.mode === 'stripes') {
          p(0, 40, 70, 480, 700, -2); p(1, 560, 90, 480, 680, 2); p(2, 1080, 70, 460, 700, -1);
          tapes(sh, 7);
        } else if (v.mode === 'cols') {
          p(0, 60, 80, 540, 860, -2); p(1, 680, 120, 540, 800, 1); p(2, 1300, 80, 540, 860, 2);
          tapes(sh, 6);
        } else if (v.mode === 'album') {
          for (var a = 0; a < 6; a++) p(a, 80 + (a % 2) * 500, 70 + Math.floor(a / 2) * 600, 440, 520, a % 2 ? 2 : -2);
          tapes(sh, 8);
        } else if (v.mode === 'ladder') {
          for (var L = 0; L < 3; L++) p(L, 80, 80 + L * 270, 1440, 230, 0);
          for (var u = 0; u < 6; u++) tape(sh, 120 + u * 230, 40, 36, 90, WASHI[u % WASHI.length]);
        } else {
          var spots = [[40, 50], [560, 40], [200, 400], [640, 460], [380, 700]];
          spots.forEach(function (s, i) { p(i, s[0], s[1], 400, 340, (i - 2) * 3); });
          tapes(sh, 7);
        }
      };
      return v;
    })
  });

  addStyle({
    id: 'ephemera', name: 'Ephemera', group: 'style', cats: ['paper', 'still', 'travel', 'books'],
    tags: ['stamps', 'tickets', 'aged'],
    variants: [
      { name: 'Stamp desk', size: 'sq', bg: solid('#E7D7B8'), mode: 'hero' },
      { name: 'Ticket row', size: 'land', bg: solid('#EFE2CC'), mode: 'row' },
      { name: 'Story tickets', size: 'story', bg: solid('#E7D7B8'), mode: 'stack' },
      { name: 'Stamp frame', size: 'sq', bg: solid('#F3E6CF'), mode: 'frame' },
      { name: 'Ledger', size: 'wide', bg: solid('#E7D7B8'), mode: 'ledger' },
      { name: 'Layered finds', size: 'sq', bg: solid('#EADCC0'), mode: 'pile' },
      { name: 'Four stamps', size: 'sq', bg: solid('#EFE2CC'), mode: 'grid' },
      { name: 'Pass pocket', size: 'story', bg: solid('#E7D7B8'), mode: 'pocket' },
      { name: 'Wide finds', size: 'land', bg: solid('#F3E6CF'), mode: 'fan' },
      { name: 'Corner post', size: 'sq', bg: solid('#E7D7B8'), mode: 'corners' }
    ].map(function (v) {
      v.draw = function (sh, ph) {
        scrap(sh, 16, 16, 200, 120, -8, '#F6E7CF');
        scrap(sh, sh.w - 220, sh.h - 140, 200, 110, 8, '#E7C8A4');
        if (v.mode === 'hero') {
          sh.slot(160, 120, 760, 700, { photo: ph[0], z: 2, radius: 4 });
          sh.slot(40, 760, 300, 240, { photo: ph[1], z: 3, rot: -4, radius: 2 });
          stamp(sh, 860, 80, 'PAR AVION');
          stamp(sh, 80, 80, 'POSTED');
          ticket(sh, 700, 860, 300, 110, 'ADMIT', 'ONE', '#F6E7CF');
        } else if (v.mode === 'row') {
          for (var i = 0; i < 4; i++) sh.slot(40 + i * 470, 160, 420, 620, { photo: ph[i], z: i + 1, rot: (i - 1) * 2 });
          ticket(sh, 40, 820, 280, 120, 'RAIL', 'DAY', '#F6E7CF');
          ticket(sh, 1500, 40, 300, 110, 'GATE', 'B', '#F6E7CF');
          stamp(sh, 900, 40, 'USED');
        } else if (v.mode === 'stack') {
          for (var s = 0; s < 3; s++) sh.slot(100, 80 + s * 520, 880, 420, { photo: ph[s], z: s + 1, radius: 4 });
          ticket(sh, 80, 500, 240, 100, 'KEEP', '07', '#F6E7CF');
          ticket(sh, 760, 1020, 240, 100, 'STUB', '12', '#F6E7CF');
          stamp(sh, 860, 40, 'TAX');
        } else if (v.mode === 'frame') {
          sh.slot(180, 160, 720, 680, { photo: ph[0], z: 1 });
          stamp(sh, 40, 40, '1st'); stamp(sh, 940, 40, 'AIR');
          stamp(sh, 40, 900, 'LOCAL'); stamp(sh, 940, 900, 'COPY');
        } else if (v.mode === 'ledger') {
          for (var L = 0; L < 4; L++) sh.slot(30 + L * 390, 160, 360, 520, { photo: ph[L], z: L + 1, radius: 2 });
          ticket(sh, 30, 720, 260, 100, 'NOTE', 'A', '#F6E7CF');
          stamp(sh, 1400, 40, 'FILED');
        } else if (v.mode === 'pile') {
          sh.slot(80, 80, 560, 480, { photo: ph[0], z: 2, rot: -5, radius: 6 });
          sh.slot(380, 300, 560, 460, { photo: ph[1], z: 4, rot: 4, radius: 6 });
          sh.slot(140, 640, 420, 320, { photo: ph[2], z: 3, rot: 2, radius: 4 });
          stamp(sh, 860, 80, 'ODD');
          ticket(sh, 700, 860, 280, 110, 'SCRAP', '09', '#F6E7CF');
        } else if (v.mode === 'grid') {
          lay(sh, [[0.06, 0.08, 0.4, 0.38], [0.52, 0.08, 0.4, 0.38], [0.06, 0.52, 0.4, 0.38], [0.52, 0.52, 0.4, 0.38]], ph);
          stamp(sh, 470, 470, 'SET');
        } else if (v.mode === 'pocket') {
          sh.slot(120, 160, 840, 640, { photo: ph[0], z: 1, radius: 6 });
          sh.slot(160, 900, 760, 420, { photo: ph[1], z: 2, radius: 6 });
          ticket(sh, 140, 80, 300, 90, 'PASS', 'C', '#F6E7CF');
          stamp(sh, 820, 1520, 'INK');
        } else if (v.mode === 'fan') {
          sh.slot(40, 140, 620, 760, { photo: ph[0], z: 2, rot: -6 });
          sh.slot(520, 180, 620, 720, { photo: ph[1], z: 3, rot: 2 });
          sh.slot(1040, 140, 620, 760, { photo: ph[2], z: 4, rot: 6 });
          stamp(sh, 900, 40, 'OPEN');
        } else {
          lay(sh, [[0.05, 0.06, 0.42, 0.4, -3], [0.52, 0.08, 0.42, 0.38, 4], [0.06, 0.52, 0.4, 0.4, 2], [0.5, 0.54, 0.44, 0.38, -4]], ph);
          stamp(sh, 470, 40, 'POST');
          ticket(sh, 400, 900, 280, 100, 'KEEP', '2', '#F6E7CF');
        }
      };
      return v;
    })
  });

  addStyle({
    id: 'travel-journal', name: 'Travel journal', group: 'style', cats: ['travel', 'arch', 'sky', 'garden'],
    tags: ['route', 'tickets', 'cities'],
    variants: [
      { name: 'Route pins', size: 'sq', bg: solid('#F6F1E6'), mode: 'route' },
      { name: 'Itinerary', size: 'story', bg: solid('#F3EDE3'), mode: 'list' },
      { name: 'Wide route', size: 'land', bg: solid('#F6F1E6'), mode: 'wide' },
      { name: 'City cards', size: 'land', bg: solid(PAPER), mode: 'cards' },
      { name: 'Boarding', size: 'sq', bg: solid('#F6F1E6'), mode: 'board' },
      { name: 'Two pages', size: 'land', bg: solid('#EFE6D6'), mode: 'pages' },
      { name: 'City grid', size: 'sq', bg: solid(PAPER), mode: 'grid' },
      { name: 'Destination', size: 'story', bg: solid('#F6F1E6'), mode: 'hero' },
      { name: 'Diagonal trip', size: 'sq', bg: solid('#F3EDE3'), mode: 'diag' },
      { name: 'Coast strip', size: 'wide', bg: solid('#F6F1E6'), mode: 'strip' }
    ].map(function (v) {
      v.draw = function (sh, ph) {
        sh.shape('curve', sh.w * 0.08, sh.h * 0.18, sh.w * 0.84, sh.h * 0.62, {
          name: 'Route', fill: { type: 'none' },
          params: { points: v.mode === 'list' ? [[0.1, 0.08], [0.2, 0.3], [0.16, 0.55], [0.22, 0.82]] : [[0.04, 0.72], [0.28, 0.4], [0.5, 0.66], [0.72, 0.28], [0.96, 0.5]] },
          stroke: { width: 4, color: '#C4473A', cap: 'round' }
        });
        function pin(i, x, y, w, h) {
          sh.slot(x, y, w, h, { photo: ph[i], z: i + 2, radius: 8, border: { width: 6, color: WHITE }, shadow: shadow(12), caption: CITIES[i % CITIES.length] });
          sh.text(CITIES[i % CITIES.length], x, y + h + 4, w, 28, { font: 'Libre Baskerville', size: 16, align: 'center', color: INK });
        }
        if (v.mode === 'route') {
          pin(0, 60, 150, 370, 310); pin(1, 470, 70, 350, 290); pin(2, 610, 430, 380, 320); pin(3, 110, 590, 380, 320);
          ticket(sh, 700, 860, 280, 110, CITIES[4], 'DAY 4', '#F6E7CF');
        } else if (v.mode === 'list') {
          for (var i = 0; i < 4; i++) pin(i, 220, 80 + i * 440, 720, 360);
          ticket(sh, 40, 200, 160, 220, 'DAY', '01', '#F6E7CF');
        } else if (v.mode === 'wide') {
          pin(0, 60, 160, 400, 320); pin(1, 520, 80, 380, 300); pin(2, 980, 220, 400, 320); pin(3, 1420, 120, 400, 320);
          ticket(sh, 60, 860, 300, 120, 'RAIL', CITIES[0], '#F6E7CF');
        } else if (v.mode === 'cards') {
          for (var c = 0; c < 4; c++) pin(c, 50 + c * 470, 180, 420, 640);
        } else if (v.mode === 'board') {
          sh.slot(80, 80, 920, 620, { photo: ph[0], z: 1, radius: 8 });
          pin(1, 80, 740, 280, 240); pin(2, 400, 760, 260, 220); pin(3, 700, 740, 280, 240);
          ticket(sh, 360, 40, 360, 120, 'BOARDING', CITIES[2], '#F6E7CF');
        } else if (v.mode === 'pages') {
          sh.slot(40, 80, 880, 860, { photo: ph[0], z: 1, radius: 6 });
          pin(1, 1000, 100, 400, 320); pin(2, 1460, 120, 400, 300); pin(3, 1100, 520, 700, 420);
        } else if (v.mode === 'grid') {
          pin(0, 60, 80, 440, 380); pin(1, 560, 80, 440, 380);
          pin(2, 60, 560, 440, 380); pin(3, 560, 560, 440, 380);
        } else if (v.mode === 'hero') {
          sh.slot(60, 80, 960, 900, { photo: ph[0], z: 1, radius: 10 });
          pin(1, 80, 1040, 420, 340); pin(2, 560, 1060, 440, 340); pin(3, 200, 1460, 680, 360);
          ticket(sh, 700, 80, 280, 110, CITIES[5], 'ARR', '#F6E7CF');
        } else if (v.mode === 'diag') {
          pin(0, 40, 60, 420, 340); pin(1, 300, 280, 400, 320); pin(2, 520, 500, 420, 340); pin(3, 160, 700, 380, 280);
        } else {
          for (var s = 0; s < 5; s++) pin(s, 30 + s * 310, 180, 290, 420);
          ticket(sh, 30, 700, 260, 110, 'COAST', 'BUS', '#F6E7CF');
        }
      };
      return v;
    })
  });

  addStyle({
    id: 'handwritten-journal', name: 'Handwritten journal', group: 'style', cats: ['still', 'books', 'people', 'garden'],
    tags: ['lines', 'notes', 'ink'],
    variants: [
      { name: 'Morning note', size: 'sq', bg: solid('#FBF8F2'), n: 2, mode: 'top' },
      { name: 'Side letter', size: 'land', bg: solid('#FBF8F2'), n: 1, mode: 'side' },
      { name: 'Three snaps', size: 'sq', bg: solid('#F7F3EA'), n: 3, mode: 'three' },
      { name: 'Long letter', size: 'story', bg: solid('#FBF8F2'), n: 2, mode: 'long' },
      { name: 'Coffee stain', size: 'sq', bg: solid('#FBF8F2'), n: 2, mode: 'stain' },
      { name: 'Wide notes', size: 'wide', bg: solid('#F7F3EA'), n: 3, mode: 'wide' },
      { name: 'Corner snaps', size: 'sq', bg: solid('#FBF8F2'), n: 4, mode: 'corners' },
      { name: 'Margin notes', size: 'story', bg: solid('#FBF8F2'), n: 3, mode: 'margin' },
      { name: 'Dated page', size: 'land', bg: solid('#F7F3EA'), n: 2, mode: 'dated' },
      { name: 'Soft diagonal', size: 'sq', bg: solid('#FBF8F2'), n: 2, mode: 'diag' }
    ].map(function (v) {
      v.draw = function (sh, ph) {
        rules(sh, 48, 120, sh.w - 96, 14, Math.round((sh.h - 180) / 14), '#E4D5C0');
        sh.shape('ellipse', sh.w * 0.72, sh.h * 0.62, 180, 140, {
          name: 'Stain', opacity: 0.28, fill: { type: 'solid', color: '#C4A06A' }
        });
        sh.text('dear page,', 56, 28, 280, 48, { font: 'Caveat', weight: 700, size: 36, color: '#6B4A32' });
        var note = 'the light was kind and the afternoon stayed.';
        if (v.mode === 'top') {
          sh.slot(60, 100, 440, 360, pol(ph[0], 2, -3, 8));
          sh.slot(540, 120, 440, 340, pol(ph[1], 3, 3, 8));
          sh.text(note, 70, 520, sh.w - 140, 200, { font: 'Caveat', size: 54, color: '#3C3128' });
        } else if (v.mode === 'side') {
          sh.slot(60, 120, 820, 820, pol(ph[0], 2, -2, 12));
          sh.text(note, 960, 180, 860, 500, { font: 'Caveat', size: 60, color: '#3C3128' });
        } else if (v.mode === 'three') {
          sh.slot(40, 110, 320, 360, pol(ph[0], 2, -4, 6));
          sh.slot(380, 90, 320, 360, pol(ph[1], 3, 2, 6));
          sh.slot(720, 120, 320, 360, pol(ph[2], 4, 4, 6));
          sh.text(note, 70, 460, 900, 240, { font: 'Caveat', size: 54, color: '#3C3128' });
        } else if (v.mode === 'long') {
          sh.slot(140, 120, 800, 520, pol(ph[0], 2, -2, 10));
          sh.slot(180, 1100, 720, 480, pol(ph[1], 3, 2, 10));
          sh.text(note, 120, 700, 840, 280, { font: 'Caveat', size: 56, color: '#3C3128' });
        } else if (v.mode === 'stain') {
          sh.slot(80, 140, 500, 460, pol(ph[0], 2, -3, 8));
          sh.slot(520, 480, 460, 420, pol(ph[1], 3, 4, 8));
          sh.text('still warm', 80, 700, 400, 60, { font: 'Kalam', weight: 700, size: 28, color: '#6B4A32' });
        } else if (v.mode === 'wide') {
          sh.slot(40, 80, 460, 400, pol(ph[0], 2, -2, 8));
          sh.slot(540, 100, 460, 380, pol(ph[1], 3, 1, 8));
          sh.slot(1060, 80, 480, 400, pol(ph[2], 4, 2, 8));
          sh.text(note, 60, 540, 1400, 160, { font: 'Caveat', size: 54, color: '#3C3128' });
        } else if (v.mode === 'corners') {
          sh.slot(40, 90, 380, 320, pol(ph[0], 2, -3, 6));
          sh.slot(660, 90, 380, 320, pol(ph[1], 3, 3, 6));
          sh.slot(40, 680, 380, 320, pol(ph[2], 4, 2, 6));
          sh.slot(660, 680, 380, 320, pol(ph[3], 5, -2, 6));
          sh.text(note, 280, 430, 520, 220, { font: 'Caveat', size: 46, align: 'center', color: '#3C3128' });
        } else if (v.mode === 'margin') {
          sh.slot(60, 140, 420, 360, pol(ph[0], 2, -2, 8));
          sh.slot(60, 620, 420, 360, pol(ph[1], 3, 2, 8));
          sh.slot(60, 1120, 420, 360, pol(ph[2], 4, -2, 8));
          sh.text(note, 540, 200, 460, 800, { font: 'Caveat', size: 54, color: '#3C3128' });
        } else if (v.mode === 'dated') {
          sh.text('12 march', 80, 40, 300, 40, { font: 'Homemade Apple', size: 22, color: '#6B4A32' });
          sh.slot(80, 140, 800, 760, pol(ph[0], 2, -2, 10));
          sh.slot(980, 200, 800, 680, pol(ph[1], 3, 2, 10));
        } else {
          sh.slot(60, 120, 520, 460, pol(ph[0], 2, -6, 8));
          sh.slot(460, 460, 520, 460, pol(ph[1], 3, 5, 8));
          sh.text(note, 80, 860, 800, 80, { font: 'Caveat', size: 30, color: '#3C3128' });
        }
      };
      return v;
    })
  });

  var WORDS = ['FORM', 'TYPE', 'LOOK', 'EDIT', 'WORD', 'BOLD', 'GRID', 'PAGE', 'STILL', 'OPEN'];
  addStyle({
    id: 'typography', name: 'Typography', group: 'style', cats: ['arch', 'people', 'street', 'travel'],
    tags: ['giant', 'type', 'poster'],
    variants: WORDS.map(function (word, i) {
      var sizes = ['sq', 'land', 'sq', 'sq', 'story', 'land', 'sq', 'wide', 'story', 'wide'];
      return {
        name: word.charAt(0) + word.slice(1).toLowerCase() + ' type',
        size: sizes[i], bg: i === 2 ? solid('#111111') : solid(i % 2 ? '#F4F1EA' : '#17131F'),
        word: word, mode: i
      };
    }).map(function (v) {
      v.draw = function (sh, ph) {
        var light = v.bg.color === '#F4F1EA';
        var ink = light ? INK : WHITE;
        var photoInk = '#F4F1EA';
        if (v.mode === 2) {
          sh.slot(0, 0, sh.w, sh.h, { photo: ph[0], z: 1 });
          sh.shape('rect', 0, 0, sh.w, sh.h, { name: 'Shade', opacity: 0.4, fill: { type: 'solid', color: '#141018' } });
          sh.text(v.word, 40, sh.h * 0.34, sh.w - 80, sh.h * 0.28, { font: 'Anton', size: Math.round(sh.w * 0.16), align: 'center', color: WHITE });
          return;
        }
        if (v.mode === 1 || v.mode === 5) {
          sh.text(v.word, 40, 40, sh.w * 0.42, sh.h - 80, { font: 'Anton', size: Math.round(sh.h * 0.16), color: ink, align: 'left' });
          sh.slot(sh.w * 0.48, 60, sh.w * 0.48, sh.h - 120, { photo: ph[0], z: 1 });
          return;
        }
        if (v.mode === 4 || v.mode === 8) {
          for (var k = 0; k < v.word.length; k++) {
            sh.text(v.word.charAt(k), 40, 40 + k * (sh.h * 0.16), sh.w * 0.28, sh.h * 0.16, { font: 'Anton', size: Math.round(sh.w * 0.18), color: ink });
          }
          sh.slot(sh.w * 0.36, 80, sh.w * 0.58, sh.h * 0.42, { photo: ph[0], z: 1 });
          sh.slot(sh.w * 0.4, sh.h * 0.52, sh.w * 0.52, sh.h * 0.36, { photo: ph[1], z: 2 });
          return;
        }
        if (v.mode === 6) {
          sh.text(v.word, 30, 20, sh.w - 60, 160, { font: 'Bebas Neue', size: 140, align: 'center', color: ink });
          lay(sh, [[0.06, 0.24, 0.42, 0.34], [0.52, 0.24, 0.42, 0.34], [0.06, 0.62, 0.42, 0.32], [0.52, 0.62, 0.42, 0.32]], ph);
          return;
        }
        if (v.mode === 3) {
          sh.slot(40, 40, sh.w * 0.46, sh.h * 0.7, { photo: ph[0], z: 1 });
          sh.text(v.word, sh.w * 0.52, sh.h * 0.2, sh.w * 0.44, 200, { font: 'Anton', size: 120, color: ink });
          sh.slot(sh.w * 0.54, sh.h * 0.55, sh.w * 0.4, sh.h * 0.36, { photo: ph[1], z: 2 });
          return;
        }
        sh.text(v.word, 30, 16, sh.w - 60, Math.min(280, sh.h * 0.32), {
          font: 'Anton', size: Math.round(Math.min(sh.w, sh.h) * 0.18), align: 'left', color: ink, name: 'Word'
        });
        if (v.mode === 7 || v.mode === 9) {
          sh.slot(40, sh.h * 0.36, sh.w * 0.62, sh.h * 0.56, { photo: ph[0], z: 1 });
          sh.slot(sh.w * 0.66, sh.h * 0.36, sh.w * 0.3, sh.h * 0.56, { photo: ph[1], z: 2 });
        } else {
          sh.slot(40, sh.h * 0.34, sh.w - 80, sh.h * 0.58, { photo: ph[0], z: 1 });
        }
        sh.text('issue 04', 40, sh.h - 48, 200, 32, { font: 'Plus Jakarta Sans', weight: 700, size: 14, letterSpacing: 2, color: light ? INK : photoInk });
      };
      return v;
    })
  });

  addStyle({
    id: 'editorial', name: 'Editorial', group: 'style', cats: ['people', 'arch', 'street', 'travel'],
    tags: ['spread', 'columns', 'serif'],
    variants: [
      { name: 'Half spread', size: 'land', bg: solid(CREAM), mode: 'half' },
      { name: 'Thirds', size: 'land', bg: solid('#F7F4EF'), mode: 'third' },
      { name: 'Bleed inset', size: 'sq', bg: solid(INK), mode: 'bleed' },
      { name: 'Three columns', size: 'land', bg: solid(WHITE), mode: 'cols' },
      { name: 'Story stack', size: 'story', bg: solid(CREAM), mode: 'stack' },
      { name: 'Margin inset', size: 'sq', bg: solid('#F4F1EA'), mode: 'inset' },
      { name: 'Pull quote', size: 'land', bg: solid('#F7F4EF'), mode: 'quote' },
      { name: 'Caption grid', size: 'sq', bg: solid(WHITE), mode: 'grid' },
      { name: 'Cover bar', size: 'story', bg: solid(INK), mode: 'cover' },
      { name: 'Footer band', size: 'wide', bg: solid(CREAM), mode: 'footer' }
    ].map(function (v) {
      v.draw = function (sh, ph) {
        sh.text('SEEING THROUGH', 36, 24, sh.w - 72, 42, { font: 'Instrument Serif', italic: true, size: 32, color: v.mode === 'bleed' || v.mode === 'cover' ? WHITE : INK });
        if (v.mode === 'half') {
          sh.slot(36, 90, sh.w * 0.46, sh.h - 140, { photo: ph[0], z: 1 });
          sh.slot(sh.w * 0.52, 90, sh.w * 0.44, sh.h - 140, { photo: ph[1], z: 2 });
        } else if (v.mode === 'third') {
          sh.slot(36, 90, sh.w * 0.3, sh.h - 140, { photo: ph[0], z: 1 });
          sh.slot(sh.w * 0.36, 90, sh.w * 0.6, sh.h - 140, { photo: ph[1], z: 2 });
        } else if (v.mode === 'bleed') {
          sh.slot(0, 0, sh.w, sh.h, { photo: ph[0], z: 1 });
          sh.slot(sh.w * 0.58, sh.h * 0.5, sh.w * 0.34, sh.h * 0.38, { photo: ph[1], z: 3, border: { width: 10, color: WHITE } });
        } else if (v.mode === 'cols') {
          lay(sh, [[0.03, 0.16, 0.3, 0.76], [0.35, 0.16, 0.3, 0.76], [0.67, 0.16, 0.3, 0.76]], ph);
        } else if (v.mode === 'stack') {
          lay(sh, [[0.08, 0.1, 0.84, 0.26], [0.08, 0.4, 0.84, 0.26], [0.08, 0.7, 0.84, 0.22]], ph);
        } else if (v.mode === 'inset') {
          sh.slot(40, 90, sh.w - 80, sh.h * 0.7, { photo: ph[0], z: 1 });
          sh.slot(80, sh.h * 0.62, sh.w * 0.42, sh.h * 0.28, { photo: ph[1], z: 3, border: { width: 8, color: WHITE }, shadow: shadow(16) });
        } else if (v.mode === 'quote') {
          sh.slot(36, 90, sh.w * 0.62, sh.h - 140, { photo: ph[0], z: 1 });
          sh.shape('rect', sh.w * 0.58, sh.h * 0.28, sh.w * 0.36, sh.h * 0.4, { name: 'Quote block', fill: { type: 'solid', color: '#E23B2F' } });
          sh.text('in its own time.', sh.w * 0.6, sh.h * 0.36, sh.w * 0.32, 160, { font: 'Instrument Serif', italic: true, size: 36, color: WHITE });
        } else if (v.mode === 'grid') {
          lay(sh, [[0.05, 0.12, 0.42, 0.36], [0.52, 0.12, 0.42, 0.36], [0.05, 0.52, 0.42, 0.36], [0.52, 0.52, 0.42, 0.36]], ph);
        } else if (v.mode === 'cover') {
          sh.slot(0, 0, sh.w * 0.72, sh.h, { photo: ph[0], z: 1 });
          sh.slot(sh.w * 0.74, 80, sh.w * 0.22, sh.h * 0.34, { photo: ph[1], z: 2 });
          sh.slot(sh.w * 0.74, sh.h * 0.42, sh.w * 0.22, sh.h * 0.34, { photo: ph[2], z: 3 });
        } else {
          sh.slot(30, 80, sh.w - 60, sh.h * 0.58, { photo: ph[0], z: 1 });
          lay(sh, [[0.03, 0.72, 0.3, 0.24], [0.35, 0.72, 0.3, 0.24], [0.67, 0.72, 0.3, 0.24]], ph);
        }
      };
      return v;
    })
  });

  function floor(sh) {
    var y0 = sh.h * 0.62;
    for (var i = 0; i < 7; i++) {
      sh.shape('line', 0, y0 + i * ((sh.h - y0) / 7), sh.w, 8, {
        name: 'Floor', fill: { type: 'none' }, stroke: { width: 1, color: 'rgba(255,255,255,.45)' }
      });
    }
    for (var v = 0; v < 8; v++) vline(sh, sh.w * (0.08 + v * 0.12), y0, sh.h - y0, 'rgba(255,255,255,.4)');
  }
  function chrome(sh, text, x, y, w, h, size) {
    sh.text(text, x, y, w, h, {
      font: 'Righteous', size: size, align: 'center', color: WHITE, name: 'Chrome',
      fill: { type: 'linear', colors: ['#FFFFFF', '#7AF0FF'], angle: 90 }
    });
  }
  function dialog(sh) {
    sh.shape('rounded-rect', sh.w * 0.18, 28, sh.w * 0.64, 110, {
      name: 'Dialog', params: { radius: 6 },
      fill: { type: 'solid', color: '#E7E2F2' }, stroke: { width: 3, color: '#241C40' }
    });
    sh.text('Please press OK to relax', sh.w * 0.2, 40, sh.w * 0.6, 36, {
      font: 'Space Grotesk', size: 18, align: 'center', color: '#241C40'
    });
    sh.shape('rounded-rect', sh.w * 0.42, 84, 120, 36, {
      name: 'OK', params: { radius: 4 }, fill: { type: 'solid', color: '#D9D3E6' }, stroke: { width: 2, color: '#241C40' }
    });
    sh.text('OK', sh.w * 0.42, 88, 120, 28, { font: 'Space Grotesk', weight: 700, size: 16, align: 'center', color: '#241C40' });
  }
  addStyle({
    id: 'vaporwave', name: 'Vaporwave', group: 'style', cats: ['arch', 'sky', 'travel', 'people'],
    tags: ['gradient', 'grid', 'chrome'],
    variants: [
      { name: 'Relax dialog', size: 'sq', bg: lin(['#5CE1E6', '#FF71CE'], 150), mode: 'dialog' },
      { name: 'Tall statue', size: 'story', bg: lin(['#72E4EC', '#FF8AD4'], 180), mode: 'tall' },
      { name: 'Horizon', size: 'land', bg: lin(['#3A2A6A', '#FF71CE'], 200), mode: 'horizon' },
      { name: 'Checker floor', size: 'sq', bg: lin(['#5CE1E6', '#C77DFF'], 140), mode: 'check' },
      { name: 'Wide sunset', size: 'wide', bg: lin(['#FF71CE', '#5CE1E6'], 20), mode: 'wide' },
      { name: 'OK window', size: 'sq', bg: lin(['#2B2A4A', '#FF71CE'], 160), mode: 'ok' },
      { name: 'Four panes', size: 'sq', bg: lin(['#5CE1E6', '#FF71CE'], 90), mode: 'panes' },
      { name: 'Palm stack', size: 'story', bg: lin(['#FF8AD4', '#5CE1E6'], 200), mode: 'palm' },
      { name: 'Big statue', size: 'land', bg: lin(['#241C40', '#5CE1E6'], 120), mode: 'statue' },
      { name: 'Split glow', size: 'wide', bg: lin(['#5CE1E6', '#FF71CE'], 90), mode: 'split' }
    ].map(function (v) {
      v.draw = function (sh, ph) {
        floor(sh);
        chrome(sh, 'RELAX', 24, v.mode === 'dialog' || v.mode === 'ok' ? 150 : 16, sh.w - 48, 80, Math.round(Math.min(72, sh.w * 0.08)));
        if (v.mode === 'dialog' || v.mode === 'ok') dialog(sh);
        if (v.mode === 'check') {
          var cw = sh.w / 8;
          var ch = (sh.h * 0.32) / 4;
          var y0 = sh.h * 0.66;
          for (var r = 0; r < 4; r++) {
            for (var c = 0; c < 8; c++) {
              if ((r + c) % 2) continue;
              sh.shape('rect', c * cw, y0 + r * ch, cw, ch, { name: 'Check', opacity: 0.35, fill: { type: 'solid', color: '#1A1030' } });
            }
          }
        }
        if (v.mode === 'tall' || v.mode === 'palm') {
          sh.slot(40, 200, sh.w * 0.56, sh.h * 0.5, { photo: 'arch-01', z: 2, radius: 8 });
          sh.slot(sh.w * 0.48, sh.h * 0.42, sh.w * 0.46, sh.h * 0.36, { photo: 'arch-03', z: 3, radius: 8 });
          sh.slot(80, sh.h * 0.78, sh.w * 0.8, sh.h * 0.16, { photo: ph[1], z: 1 });
        } else if (v.mode === 'horizon' || v.mode === 'statue' || v.mode === 'wide') {
          sh.slot(40, sh.h * 0.22, sh.w * 0.34, sh.h * 0.5, { photo: 'arch-03', z: 2, radius: 6 });
          sh.slot(sh.w * 0.36, sh.h * 0.18, sh.w * 0.32, sh.h * 0.55, { photo: 'arch-01', z: 3, radius: 6 });
          sh.slot(sh.w * 0.66, sh.h * 0.28, sh.w * 0.3, sh.h * 0.42, { photo: ph[2], z: 2, radius: 6 });
        } else if (v.mode === 'panes') {
          lay(sh, [[0.06, 0.22, 0.42, 0.32], [0.52, 0.22, 0.42, 0.32], [0.06, 0.58, 0.42, 0.32], [0.52, 0.58, 0.42, 0.32]], ph);
          sh.slot(sh.w * 0.3, sh.h * 0.36, sh.w * 0.4, sh.h * 0.28, { photo: 'arch-01', z: 5, radius: 8, border: { width: 6, color: WHITE } });
        } else if (v.mode === 'split') {
          sh.slot(30, sh.h * 0.22, sh.w * 0.46, sh.h * 0.62, { photo: 'arch-01', z: 2 });
          sh.slot(sh.w * 0.52, sh.h * 0.22, sh.w * 0.44, sh.h * 0.62, { photo: 'arch-03', z: 2 });
        } else {
          sh.slot(40, sh.h * 0.28, sh.w * 0.42, sh.h * 0.48, { photo: 'arch-03', z: 2, radius: 10 });
          sh.slot(sh.w * 0.4, sh.h * 0.32, sh.w * 0.52, sh.h * 0.5, { photo: 'arch-01', z: 3, radius: 10, shadow: shadow(20) });
        }
      };
      return v;
    })
  });

  addStyle({
    id: 'digital-3d', name: '3D digital', group: 'style', cats: ['arch', 'sky', 'travel', 'nature'],
    tags: ['frames', 'shadow', 'desert'],
    variants: [
      { name: 'Stacked frames', size: 'sq', bg: lin(['#F3C98B', '#7EB6D6'], 180), mode: 'stack' },
      { name: 'Fan', size: 'sq', bg: lin(['#E7B07A', '#F7E7C8'], 160), mode: 'fan' },
      { name: 'Trio', size: 'land', bg: lin(['#F6D7A8', '#8EC8E8'], 200), mode: 'trio' },
      { name: 'Story cascade', size: 'story', bg: lin(['#F3C98B', '#9FD0C8'], 170), mode: 'story' },
      { name: 'Soft grid', size: 'sq', bg: lin(['#F7E1C4', '#F3C98B'], 140), mode: 'grid' },
      { name: 'Offset pair', size: 'sq', bg: lin(['#E8B892', '#7EB6D6'], 120), mode: 'pair' },
      { name: 'Wide overlap', size: 'wide', bg: lin(['#F6D7A8', '#8EC8E8'], 180), mode: 'wide' },
      { name: 'Diagonal cascade', size: 'land', bg: lin(['#F3C98B', '#C9DFF0'], 150), mode: 'cascade' },
      { name: 'Poster frame', size: 'story', bg: lin(['#E7B07A', '#F4E1C4'], 190), mode: 'poster' },
      { name: 'Cluster', size: 'sq', bg: lin(['#F6D7A8', '#7EB6D6'], 200), mode: 'cluster' }
    ].map(function (v) {
      v.draw = function (sh, ph) {
        var W = sh.w, H = sh.h;
        if (v.mode === 'stack') {
          card3(sh, W * 0.08, H * 0.08, W * 0.72, H * 0.62, ph[0], 1, -6);
          card3(sh, W * 0.2, H * 0.22, W * 0.68, H * 0.58, ph[1], 2, 3);
          card3(sh, W * 0.3, H * 0.36, W * 0.62, H * 0.52, ph[2], 3, -2);
        } else if (v.mode === 'fan') {
          card3(sh, W * 0.18, H * 0.16, W * 0.58, H * 0.62, ph[0], 1, -14);
          card3(sh, W * 0.22, H * 0.14, W * 0.56, H * 0.64, ph[1], 2, -5);
          card3(sh, W * 0.26, H * 0.16, W * 0.54, H * 0.62, ph[2], 3, 6);
          card3(sh, W * 0.3, H * 0.18, W * 0.52, H * 0.58, ph[3], 4, 14);
        } else if (v.mode === 'trio') {
          card3(sh, 40, 120, 700, 820, ph[0], 1, -4);
          card3(sh, 620, 80, 700, 860, ph[1], 3, 2);
          card3(sh, 1180, 140, 680, 800, ph[2], 2, 5);
        } else if (v.mode === 'story') {
          card3(sh, 80, 60, 820, 520, ph[0], 1, -3);
          card3(sh, 140, 500, 820, 500, ph[1], 2, 2);
          card3(sh, 80, 960, 840, 480, ph[2], 3, -2);
          card3(sh, 160, 1400, 800, 440, ph[3], 4, 3);
        } else if (v.mode === 'grid') {
          card3(sh, 50, 50, 470, 470, ph[0], 1, 0);
          card3(sh, 560, 50, 470, 470, ph[1], 2, 0);
          card3(sh, 50, 560, 470, 470, ph[2], 3, 0);
          card3(sh, 560, 560, 470, 470, ph[3], 4, 0);
        } else if (v.mode === 'pair') {
          card3(sh, 40, 80, 640, 860, ph[0], 1, -5);
          card3(sh, 400, 180, 620, 780, ph[1], 2, 6);
        } else if (v.mode === 'wide') {
          card3(sh, 30, 80, 620, 700, ph[0], 1, -3);
          card3(sh, 500, 60, 640, 740, ph[1], 3, 2);
          card3(sh, 980, 100, 580, 680, ph[2], 2, 4);
        } else if (v.mode === 'cascade') {
          card3(sh, 40, 80, 520, 640, ph[0], 1, -6);
          card3(sh, 420, 160, 520, 620, ph[1], 2, -2);
          card3(sh, 820, 240, 500, 600, ph[2], 3, 3);
          card3(sh, 1220, 300, 500, 580, ph[3], 4, 6);
        } else if (v.mode === 'poster') {
          card3(sh, 80, 60, 920, 1100, ph[0], 2, -2);
          card3(sh, 60, 1220, 460, 560, ph[1], 1, 3);
          card3(sh, 560, 1260, 460, 520, ph[2], 3, -3);
        } else {
          card3(sh, 40, 40, 520, 460, ph[0], 1, -4);
          card3(sh, 480, 80, 520, 440, ph[1], 2, 5);
          card3(sh, 180, 420, 560, 480, ph[2], 4, 2);
          card3(sh, 40, 640, 400, 360, ph[3], 3, -3);
          card3(sh, 620, 560, 400, 420, ph[4], 5, 4);
        }
      };
      return v;
    })
  });

  function classic(id, name, cats, tags, a, b) {
    addStyle({
      id: id, name: name, group: 'classic', cats: cats, tags: tags,
      variants: [a, b]
    });
  }
  function V(name, size, bg, draw) { return { name: name, size: size, bg: bg, draw: draw }; }

  classic('grid-2', 'Grid 2', ['people', 'travel'], ['grid', 'pair'],
    V('Side by side', 'land', solid(WHITE), function (sh, ph) {
      sh.slot(24, 24, 924, 1032, { photo: ph[0], z: 1 });
      sh.slot(972, 24, 924, 1032, { photo: ph[1], z: 2 });
    }),
    V('Stacked', 'story', solid(WHITE), function (sh, ph) {
      sh.slot(24, 24, 1032, 924, { photo: ph[0], z: 1 });
      sh.slot(24, 972, 1032, 924, { photo: ph[1], z: 2 });
    })
  );
  classic('grid-3', 'Grid 3', ['travel', 'people', 'arch'], ['grid', 'trio'],
    V('Three columns', 'land', solid(CREAM), function (sh, ph) {
      lay(sh, [[0.02, 0.04, 0.31, 0.92], [0.345, 0.04, 0.31, 0.92], [0.67, 0.04, 0.31, 0.92]], ph);
    }),
    V('One over two', 'sq', solid(CREAM), function (sh, ph) {
      sh.slot(24, 24, 1032, 620, { photo: ph[0], z: 1 });
      sh.slot(24, 668, 504, 388, { photo: ph[1], z: 2 });
      sh.slot(552, 668, 504, 388, { photo: ph[2], z: 3 });
    })
  );
  classic('grid-4', 'Grid 4', ['garden', 'travel', 'people'], ['grid'],
    V('Four square', 'sq', solid(WHITE), function (sh, ph) {
      lay(sh, [[0.02, 0.02, 0.47, 0.47], [0.51, 0.02, 0.47, 0.47], [0.02, 0.51, 0.47, 0.47], [0.51, 0.51, 0.47, 0.47]], ph);
    }),
    V('Four across', 'land', solid(WHITE), function (sh, ph) {
      for (var i = 0; i < 4; i++) sh.slot(24 + i * 474, 80, 450, 920, { photo: ph[i], z: i + 1 });
    })
  );
  classic('masonry', 'Masonry', ['travel', 'arch', 'people'], ['columns'],
    V('Tall and stack', 'sq', solid('#F4F1EA'), function (sh, ph) {
      sh.slot(20, 20, 620, 1040, { photo: ph[0], z: 1 });
      sh.slot(660, 20, 400, 500, { photo: ph[1], z: 2 });
      sh.slot(660, 540, 400, 520, { photo: ph[2], z: 3 });
    }),
    V('Mixed columns', 'land', solid('#F4F1EA'), function (sh, ph) {
      sh.slot(20, 20, 600, 500, { photo: ph[0], z: 1 });
      sh.slot(20, 540, 600, 520, { photo: ph[1], z: 2 });
      sh.slot(640, 20, 640, 1040, { photo: ph[2], z: 3 });
      sh.slot(1300, 20, 600, 330, { photo: ph[3], z: 4 });
      sh.slot(1300, 370, 600, 330, { photo: ph[4], z: 5 });
      sh.slot(1300, 720, 600, 340, { photo: ph[5], z: 6 });
    })
  );
  classic('mosaic', 'Mosaic', ['travel', 'garden', 'arch', 'people'], ['irregular'],
    V('Broken grid', 'sq', solid(INK), function (sh, ph) {
      lay(sh, [[0.02, 0.02, 0.46, 0.34], [0.5, 0.02, 0.22, 0.22], [0.74, 0.02, 0.24, 0.46], [0.5, 0.26, 0.22, 0.36], [0.02, 0.38, 0.28, 0.36], [0.32, 0.38, 0.16, 0.6], [0.5, 0.64, 0.48, 0.34], [0.02, 0.76, 0.28, 0.22]], ph);
    }),
    V('Wide mosaic', 'land', solid(INK), function (sh, ph) {
      lay(sh, [[0.015, 0.03, 0.32, 0.55], [0.35, 0.03, 0.2, 0.32], [0.57, 0.03, 0.41, 0.42], [0.35, 0.38, 0.2, 0.58], [0.015, 0.6, 0.32, 0.36], [0.57, 0.48, 0.2, 0.48], [0.79, 0.48, 0.19, 0.48]], ph);
    })
  );
  classic('polaroid-wall', 'Polaroid wall', ['people', 'travel', 'garden'], ['polaroid', 'grid'],
    V('Nine up', 'sq', solid('#E7E1D6'), function (sh, ph) {
      for (var i = 0; i < 9; i++) {
        var c = i % 3, r = Math.floor(i / 3);
        sh.slot(40 + c * 350, 36 + r * 350, 300, 310, pol(ph[i], i + 1, c % 2 ? 2 : -2, 10));
      }
    }),
    V('Two by four', 'land', solid('#E7E1D6'), function (sh, ph) {
      for (var i = 0; i < 8; i++) {
        var c = i % 4, r = Math.floor(i / 4);
        sh.slot(36 + c * 474, 40 + r * 520, 420, 460, pol(ph[i], i + 1, r ? 2 : -2, 12));
      }
    })
  );
  classic('polaroid-scatter', 'Polaroid scatter', ['people', 'garden', 'travel'], ['polaroid', 'scatter'],
    V('Loose eight', 'sq', solid('#F7F3EC'), function (sh, ph, rng) {
      var spots = [[0.04, 0.05, 0.36, 0.4], [0.36, 0.02, 0.3, 0.34], [0.64, 0.1, 0.32, 0.36], [0.02, 0.42, 0.34, 0.36], [0.32, 0.38, 0.34, 0.32], [0.62, 0.46, 0.34, 0.36], [0.08, 0.72, 0.36, 0.26], [0.46, 0.68, 0.46, 0.28]];
      spots.forEach(function (c, i) { at(sh, c.concat([Math.round((rng() - 0.5) * 16)]), ph, i, pol(ph[i], i + 1, Math.round((rng() - 0.5) * 14), 8)); });
    }),
    V('Loose twelve', 'land', solid('#F7F3EC'), function (sh, ph, rng) {
      for (var i = 0; i < 12; i++) {
        var c = i % 4, r = Math.floor(i / 4);
        sh.slot(30 + c * 470 + (rng() - 0.5) * 30, 24 + r * 350 + (rng() - 0.5) * 24, 400, 320, pol(ph[i], i + 1, Math.round((rng() - 0.5) * 12), 8));
      }
    })
  );
  function sprockets(sh, horizontal) {
    var n = horizontal ? 16 : 12;
    for (var i = 0; i < n; i++) {
      if (horizontal) {
        var x = 24 + i * ((sh.w - 48) / n);
        sh.shape('rounded-rect', x, 16, 18, 14, { name: 'Sprocket', params: { radius: 2 }, fill: { type: 'solid', color: '#F4F1EA' } });
        sh.shape('rounded-rect', x, sh.h - 30, 18, 14, { name: 'Sprocket', params: { radius: 2 }, fill: { type: 'solid', color: '#F4F1EA' } });
      } else {
        var y = 24 + i * ((sh.h - 48) / n);
        sh.shape('rounded-rect', 16, y, 14, 18, { name: 'Sprocket', params: { radius: 2 }, fill: { type: 'solid', color: '#F4F1EA' } });
        sh.shape('rounded-rect', sh.w - 30, y, 14, 18, { name: 'Sprocket', params: { radius: 2 }, fill: { type: 'solid', color: '#F4F1EA' } });
      }
    }
  }
  classic('film-strip', 'Film strip', ['people', 'street', 'travel'], ['film', 'sprocket'],
    V('Horizontal roll', 'land', solid('#141414'), function (sh, ph) {
      sprockets(sh, true);
      for (var i = 0; i < 5; i++) sh.slot(40 + i * 376, 70, 350, 940, { photo: ph[i], z: i + 1 });
    }),
    V('Vertical roll', 'story', solid('#141414'), function (sh, ph) {
      sprockets(sh, false);
      for (var i = 0; i < 4; i++) sh.slot(70, 40 + i * 470, 940, 430, { photo: ph[i], z: i + 1 });
    })
  );
  classic('lookbook', 'Lookbook', ['street', 'people', 'arch'], ['fashion'],
    V('Hero and pair', 'sq', solid(WHITE), function (sh, ph) {
      sh.slot(24, 24, 680, 1032, { photo: ph[0], z: 1 });
      sh.slot(724, 24, 332, 500, { photo: ph[1], z: 2 });
      sh.slot(724, 544, 332, 512, { photo: ph[2], z: 3 });
    }),
    V('Hero and strip', 'land', solid(WHITE), function (sh, ph) {
      sh.slot(24, 24, 1872, 640, { photo: ph[0], z: 1 });
      sh.slot(24, 684, 600, 372, { photo: ph[1], z: 2 });
      sh.slot(644, 684, 600, 372, { photo: ph[2], z: 3 });
      sh.slot(1264, 684, 632, 372, { photo: ph[3], z: 4 });
    })
  );
  classic('moodboard', 'Moodboard', ['soft', 'travel', 'people', 'still'], ['asymmetric', 'tape'],
    V('Pinned five', 'sq', solid('#EFE6DC'), function (sh, ph) {
      lay(sh, [[0.05, 0.06, 0.5, 0.48, -3], [0.52, 0.08, 0.42, 0.36, 4], [0.08, 0.56, 0.36, 0.36, 3], [0.46, 0.48, 0.48, 0.28, -2], [0.5, 0.78, 0.42, 0.18, 2]], ph, { radius: 4, shadow: shadow(10) });
      tape(sh, 180, 40, 120, -12, WASHI[0]);
      tape(sh, 640, 80, 110, 10, WASHI[1]);
      tape(sh, 200, 600, 130, 8, WASHI[2]);
    }),
    V('Dense board', 'land', solid('#E7D3C4'), function (sh, ph) {
      lay(sh, [[0.02, 0.06, 0.28, 0.42, -2], [0.28, 0.04, 0.22, 0.32, 3], [0.5, 0.08, 0.24, 0.4, -3], [0.74, 0.05, 0.24, 0.36, 2], [0.04, 0.52, 0.22, 0.4, 4], [0.26, 0.46, 0.24, 0.46, -2], [0.5, 0.52, 0.22, 0.4, 3], [0.72, 0.48, 0.25, 0.44, -4]], ph, { radius: 2 });
      tape(sh, 200, 30, 140, -8, WASHI[3]);
      tape(sh, 900, 200, 120, 14, WASHI[4]);
      tape(sh, 1400, 500, 150, -10, WASHI[0]);
    })
  );
  function portraits(sh, cols, rows, ph) {
    var gapX = 24, gapY = 48, m = 28;
    var cw = (sh.w - m * 2 - gapX * (cols - 1)) / cols;
    var ch = (sh.h - m * 2 - gapY * (rows - 1)) / rows;
    var side = Math.min(cw, ch - 36);
    for (var i = 0; i < cols * rows; i++) {
      var c = i % cols, r = Math.floor(i / cols);
      var x = m + c * (cw + gapX);
      var y = m + r * (ch + gapY);
      sh.slot(x + (cw - side) / 2, y, side, side, { photo: ph[i], mask: 'ellipse', z: i + 1, border: { width: 4, color: WHITE } });
      sh.text(NAMES[i % NAMES.length], x, y + side + 4, cw, 28, { font: 'Libre Baskerville', size: 16, align: 'center', color: INK });
    }
  }
  classic('yearbook', 'Yearbook', ['people'], ['portraits', 'names'],
    V('Class of nine', 'sq', solid('#F4F1EA'), function (sh, ph) { portraits(sh, 3, 3, ph); }),
    V('Two rows', 'land', solid('#F4F1EA'), function (sh, ph) { portraits(sh, 4, 2, ph); })
  );
  classic('family-cluster', 'Family cluster', ['people'], ['cluster'],
    V('Center and orbit', 'sq', solid(CREAM), function (sh, ph) {
      sh.slot(300, 280, 480, 480, { photo: ph[0], z: 4, radius: 12, shadow: shadow(18), border: { width: 8, color: WHITE } });
      for (var i = 0; i < 6; i++) {
        var a = i * Math.PI / 3 - Math.PI / 2;
        sh.slot(540 + Math.cos(a) * 360 - 120, 520 + Math.sin(a) * 340 - 110, 240, 220, pol(ph[i + 1], i + 1, Math.round(Math.sin(a) * 6), 6));
      }
    }),
    V('Four corners', 'land', solid(CREAM), function (sh, ph) {
      sh.slot(40, 40, 520, 420, pol(ph[0], 1, -3, 8));
      sh.slot(1360, 40, 520, 420, pol(ph[1], 2, 3, 8));
      sh.slot(40, 620, 520, 420, pol(ph[2], 3, 2, 8));
      sh.slot(1360, 620, 520, 420, pol(ph[3], 4, -2, 8));
      sh.slot(660, 280, 600, 500, { photo: ph[4], z: 6, radius: 8, border: { width: 10, color: WHITE }, shadow: shadow(20) });
    })
  );
  function honey(sh, counts, ph) {
    var gap = 12;
    var cols = Math.max.apply(null, counts);
    var hw = Math.floor((sh.w - 64 - gap * (cols - 1)) / cols);
    var maxH = Math.floor((sh.h - 48) / (counts.length * 0.78 + 0.22));
    var hh = Math.min(Math.floor(hw * 0.92), maxH);
    var stepY = Math.floor(hh * 0.78);
    var totalH = stepY * (counts.length - 1) + hh;
    var y0 = Math.floor((sh.h - totalH) / 2);
    var k = 0;
    counts.forEach(function (n, r) {
      var rowW = n * hw + (n - 1) * gap;
      var x0 = Math.floor((sh.w - rowW) / 2);
      for (var c = 0; c < n; c++) {
        sh.slot(x0 + c * (hw + gap), y0 + r * stepY, hw, hh, {
          photo: ph[k], mask: 'hexagon', z: k + 1, border: { width: 4, color: WHITE }
        });
        k++;
      }
    });
  }
  classic('honeycomb', 'Honeycomb', ['garden', 'people', 'travel'], ['hexagon'],
    V('Three rows', 'sq', solid('#F7F4EF'), function (sh, ph) { honey(sh, [3, 2, 3], ph); }),
    V('Wide comb', 'land', solid('#F7F4EF'), function (sh, ph) { honey(sh, [4, 3, 4], ph); })
  );
  classic('diamond-grid', 'Diamond grid', ['travel', 'arch', 'garden'], ['diamond'],
    V('Diamond tiles', 'sq', solid(WHITE), function (sh, ph) {
      var gap = 18, m = 36, cols = 3, rows = 3;
      var s = Math.floor((sh.w - m * 2 - gap * (cols - 1)) / cols);
      var k = 0;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          sh.slot(m + c * (s + gap), m + r * (s + gap), s, s, { photo: ph[k], mask: 'diamond', z: k + 1 });
          k++;
        }
      }
    }),
    V('Turned squares', 'land', solid(WHITE), function (sh, ph) {
      var s = 280, gap = 80, n = 5;
      var x0 = (sh.w - (n * s + (n - 1) * gap)) / 2;
      var y = (sh.h - s) / 2;
      for (var i = 0; i < n; i++) {
        sh.slot(x0 + i * (s + gap), y, s, s, { photo: ph[i], mask: 'rect', rot: 45, z: i + 1, border: { width: 6, color: WHITE } });
      }
    })
  );
  classic('timeline', 'Timeline', ['people', 'travel', 'still'], ['timeline'],
    V('Vertical axis', 'story', solid('#F7F4EF'), function (sh, ph) {
      sh.shape('rect', sh.w / 2 - 4, 40, 8, sh.h - 80, { name: 'Axis', fill: { type: 'solid', color: '#C4473A' } });
      for (var i = 0; i < 4; i++) {
        var left = i % 2 === 0;
        sh.slot(left ? 40 : 600, 80 + i * 450, 440, 360, { photo: ph[i], z: i + 1, radius: 8 });
        sh.shape('ellipse', sh.w / 2 - 12, 230 + i * 450, 24, 24, { name: 'Node', fill: { type: 'solid', color: INK } });
      }
    }),
    V('Horizontal axis', 'land', solid('#F7F4EF'), function (sh, ph) {
      sh.shape('rect', 40, 500, sh.w - 80, 8, { name: 'Axis', fill: { type: 'solid', color: '#C4473A' } });
      for (var i = 0; i < 5; i++) {
        sh.slot(40 + i * 376, i % 2 ? 560 : 80, 340, 380, { photo: ph[i], z: i + 1, radius: 8 });
        sh.shape('ellipse', 190 + i * 376, 492, 24, 24, { name: 'Node', fill: { type: 'solid', color: INK } });
      }
    })
  );
  classic('map-travel', 'Map travel', ['travel', 'arch', 'sky'], ['route', 'pins'],
    V('City route', 'land', solid('#E7EFE4'), function (sh, ph) {
      sh.shape('curve', 80, 160, 1760, 760, {
        name: 'Route', fill: { type: 'none' },
        params: { points: [[0.02, 0.7], [0.22, 0.3], [0.46, 0.65], [0.68, 0.25], [0.92, 0.55]] },
        stroke: { width: 5, color: '#C4473A', cap: 'round' }
      });
      var pins = [[80, 520], [420, 220], [820, 480], [1200, 180], [1560, 420]];
      pins.forEach(function (p, i) {
        sh.slot(p[0], p[1], 220, 180, { photo: ph[i], z: i + 1, radius: 10, border: { width: 5, color: WHITE } });
        sh.text(CITIES[i], p[0], p[1] + 186, 220, 28, { font: 'Libre Baskerville', size: 16, align: 'center', color: INK });
      });
    }),
    V('Southbound', 'story', solid('#E7EFE4'), function (sh, ph) {
      sh.shape('curve', 200, 80, 680, 1700, {
        name: 'Route', fill: { type: 'none' },
        params: { points: [[0.2, 0.02], [0.7, 0.2], [0.3, 0.45], [0.75, 0.7], [0.4, 0.96]] },
        stroke: { width: 5, color: '#2F6FED', cap: 'round' }
      });
      var pins = [[80, 80], [560, 360], [100, 700], [520, 1040], [140, 1420]];
      pins.forEach(function (p, i) {
        sh.slot(p[0], p[1], 360, 280, { photo: ph[i], z: i + 1, radius: 12, border: { width: 6, color: WHITE } });
        sh.text(CITIES[i + 2], p[0], p[1] + 286, 360, 28, { font: 'Libre Baskerville', size: 16, align: 'center', color: INK });
      });
    })
  );
  classic('postcard', 'Postcard', ['travel', 'sky'], ['mail'],
    V('Address side', 'land', solid('#FBF8F2'), function (sh, ph) {
      sh.slot(28, 28, 1100, 1024, { photo: ph[0], z: 1 });
      sh.shape('line', 720, 536, 920, 8, { name: 'Divide', rotation: 90, fill: { type: 'none' }, stroke: { width: 2, color: '#C4473A' } });
      sh.text(CITIES[1], 1280, 120, 560, 60, { font: 'Libre Baskerville', weight: 700, size: 32, color: INK });
      sh.text('wish you were here', 1280, 200, 560, 200, { font: 'Caveat', weight: 700, size: 36, color: '#6B4A32' });
      stamp(sh, 1680, 80, 'POST');
      sh.slot(1280, 640, 520, 360, { photo: ph[1], z: 2, radius: 4 });
    }),
    V('Landscape card', 'wide', solid('#FBF8F2'), function (sh, ph) {
      sh.slot(24, 24, 1552, 520, { photo: ph[0], z: 1 });
      sh.text('Greetings from ' + CITIES[3], 40, 570, 900, 50, { font: 'Playfair Display', italic: true, size: 32, color: INK });
      sh.text('a slow morning and a bright quay.', 40, 640, 980, 80, { font: 'Caveat', size: 28, color: '#6B4A32' });
      stamp(sh, 1400, 600, 'SENT');
      sh.slot(1180, 680, 380, 180, { photo: ph[1], z: 2 });
    })
  );
  classic('instant-camera', 'Instant camera', ['people', 'travel', 'still'], ['instant'],
    V('Square shot', 'sq', solid('#1C1C1E'), function (sh, ph) {
      sh.slot(90, 70, 900, 720, { photo: ph[0], z: 1 });
      var colors = ['#E23B2F', '#F2C14E', '#1F8A4C', '#2F6FED', '#C43B6E', '#17131F'];
      colors.forEach(function (c, i) {
        sh.shape('rect', 90 + i * 150, 800, 150, 22, { name: 'Stripe', fill: { type: 'solid', color: c } });
      });
      sh.text('INSTANT', 90, 860, 400, 40, { font: 'Plus Jakarta Sans', weight: 700, size: 16, letterSpacing: 3, color: '#F4F1EA' });
    }),
    V('Portrait shot', 'story', solid('#1C1C1E'), function (sh, ph) {
      sh.slot(70, 80, 940, 1280, { photo: ph[0], z: 1 });
      var colors = ['#E23B2F', '#F2C14E', '#1F8A4C', '#2F6FED'];
      colors.forEach(function (c, i) {
        sh.shape('rect', 70 + i * 235, 1380, 235, 26, { name: 'Stripe', fill: { type: 'solid', color: c } });
      });
      sh.text('FRAME 04', 70, 1460, 400, 40, { font: 'Plus Jakarta Sans', weight: 700, size: 16, letterSpacing: 3, color: '#F4F1EA' });
    })
  );
  classic('torn-paper', 'Torn paper', ['paper', 'people', 'travel'], ['torn'],
    V('Single tear', 'sq', solid('#E7D7B8'), function (sh, ph) {
      scrap(sh, 20, 30, 220, 140, -8, '#F4E7CF');
      scrap(sh, 820, 860, 220, 160, 10, '#E7C8A4');
      sh.slot(120, 140, 840, 760, { photo: ph[0], z: 2, radius: 28, border: { width: 16, color: '#F6E7CF' }, shadow: shadow(16) });
    }),
    V('Two sheets', 'land', solid('#EFE2CC'), function (sh, ph) {
      scrap(sh, 20, 20, 240, 120, -6, '#F6E7CF');
      scrap(sh, 1600, 900, 260, 140, 8, '#E7C8A4');
      sh.slot(40, 80, 980, 900, { photo: ph[0], z: 2, rot: -3, radius: 36, border: { width: 18, color: '#F4E7CF' } });
      sh.slot(900, 120, 960, 860, { photo: ph[1], z: 3, rot: 3, radius: 40, border: { width: 18, color: '#F6E7CF' }, shadow: shadow(18) });
    })
  );
  classic('comic-pop', 'Comic pop', ['people', 'street'], ['burst', 'pop'],
    V('Pow crash', 'sq', solid('#F2C14E'), function (sh, ph) {
      sh.slot(40, 40, 620, 620, { photo: ph[0], z: 1, border: { width: 10, color: INK }, radius: 4 });
      sh.slot(420, 420, 600, 600, { photo: ph[1], z: 2, border: { width: 10, color: INK }, radius: 4 });
      sh.shape('burst', 40, 620, 280, 240, { name: 'Burst', fill: { type: 'solid', color: '#E23B2F' }, stroke: { width: 6, color: INK } });
      sh.text('POW!', 70, 700, 220, 80, { font: 'Bungee', size: 36, align: 'center', color: WHITE });
      sh.shape('burst', 760, 40, 260, 220, { name: 'Burst', fill: { type: 'solid', color: '#F2C14E' }, stroke: { width: 6, color: INK } });
      sh.text('CRASH!', 780, 110, 220, 70, { font: 'Bungee', size: 28, align: 'center', color: INK });
      dots(sh, 40, 40, 10, 28, 8, INK);
    }),
    V('Three panels', 'land', solid('#F4F1EA'), function (sh, ph) {
      for (var i = 0; i < 3; i++) {
        sh.slot(30 + i * 630, 40, 590, 1000, { photo: ph[i], z: i + 1, border: { width: 12, color: INK } });
      }
      sh.shape('burst', 40, 780, 240, 200, { name: 'Burst', fill: { type: 'solid', color: '#E23B2F' }, stroke: { width: 6, color: INK } });
      sh.text('POW!', 60, 850, 200, 60, { font: 'Bungee', size: 28, align: 'center', color: WHITE });
      dots(sh, 1400, 60, 8, 24, 7, INK);
    })
  );
  classic('heart-shape', 'Heart shape', ['people', 'soft'], ['heart', 'mask'],
    V('Heart row', 'sq', solid('#FFF5F7'), function (sh, ph) {
      for (var i = 0; i < 6; i++) {
        var c = i % 3, r = Math.floor(i / 3);
        sh.slot(50 + c * 340, 80 + r * 500, 300, 280, { photo: ph[i], mask: 'heart', z: i + 1 });
      }
    }),
    V('Giant heart', 'sq', solid('#FDECF1'), function (sh, ph) {
      sh.slot(190, 80, 700, 820, { photo: ph[0], mask: 'heart', z: 2 });
      sh.slot(30, 30, 180, 170, { photo: ph[1], mask: 'heart', z: 3 });
      sh.slot(870, 30, 180, 170, { photo: ph[2], mask: 'heart', z: 4 });
      sh.slot(30, 860, 180, 170, { photo: ph[3], mask: 'heart', z: 5 });
      sh.slot(870, 860, 180, 170, { photo: ph[4], mask: 'heart', z: 6 });
    })
  );
  classic('circle-crop', 'Circle crop', ['people', 'garden'], ['ellipse'],
    V('Circle grid', 'sq', solid(WHITE), function (sh, ph) {
      for (var i = 0; i < 9; i++) {
        var c = i % 3, r = Math.floor(i / 3);
        sh.slot(40 + c * 350, 40 + r * 350, 300, 300, { photo: ph[i], mask: 'ellipse', z: i + 1 });
      }
    }),
    V('Circle row', 'land', solid(WHITE), function (sh, ph) {
      for (var i = 0; i < 5; i++) sh.slot(40 + i * 376, 300, 340, 340, { photo: ph[i], mask: 'ellipse', z: i + 1, border: { width: 6, color: CREAM } });
    })
  );
  classic('star-mask', 'Star mask', ['people', 'travel', 'sky'], ['star'],
    V('Five stars', 'sq', solid('#17131F'), function (sh, ph) {
      var spots = [[180, 40], [620, 80], [40, 400], [400, 420], [760, 400]];
      spots.forEach(function (p, i) {
        sh.slot(p[0], p[1], 280, 280, { photo: ph[i], mask: 'star', z: i + 1 });
      });
    }),
    V('One large star', 'sq', solid('#111111'), function (sh, ph) {
      sh.slot(220, 160, 640, 640, { photo: ph[0], mask: 'star', z: 2 });
      sh.slot(40, 40, 180, 180, { photo: ph[1], mask: 'star', z: 3 });
      sh.slot(860, 40, 180, 180, { photo: ph[2], mask: 'star', z: 4 });
      sh.slot(40, 860, 180, 180, { photo: ph[3], mask: 'star', z: 5 });
      sh.slot(860, 860, 180, 180, { photo: ph[4], mask: 'star', z: 6 });
    })
  );
  classic('overlapping-cascade', 'Overlapping cascade', ['people', 'street', 'arch'], ['overlap'],
    V('Diagonal stack', 'sq', solid('#F4F1EA'), function (sh, ph) {
      for (var i = 0; i < 5; i++) {
        sh.slot(40 + i * 120, 40 + i * 140, 520, 460, {
          photo: ph[i], z: i + 1, rot: (i - 2) * 3, radius: 8, shadow: shadow(16), border: { width: 6, color: WHITE }
        });
      }
    }),
    V('Fan cascade', 'land', solid('#F4F1EA'), function (sh, ph) {
      for (var i = 0; i < 5; i++) {
        sh.slot(80 + i * 280, 140, 520, 760, {
          photo: ph[i], z: i + 1, rot: (i - 2) * 6, radius: 10, shadow: shadow(18), border: { width: 8, color: WHITE }
        });
      }
    })
  );
  classic('bento-grid', 'Bento grid', ['travel', 'still', 'garden', 'arch'], ['bento'],
    V('Feature bento', 'sq', solid('#F7F4EF'), function (sh, ph) {
      lay(sh, [[0.03, 0.03, 0.58, 0.56], [0.63, 0.03, 0.34, 0.27], [0.63, 0.32, 0.34, 0.27], [0.03, 0.62, 0.3, 0.35], [0.35, 0.62, 0.62, 0.35]], ph, { radius: 20 });
    }),
    V('Wide bento', 'land', solid('#F7F4EF'), function (sh, ph) {
      lay(sh, [[0.02, 0.04, 0.32, 0.58], [0.36, 0.04, 0.3, 0.28], [0.68, 0.04, 0.3, 0.42], [0.36, 0.35, 0.3, 0.27], [0.02, 0.66, 0.46, 0.3], [0.5, 0.66, 0.48, 0.3]], ph, { radius: 18 });
    })
  );
  classic('magazine-cover', 'Magazine cover', ['people', 'street'], ['cover', 'masthead'],
    V('Full bleed cover', 'story', solid(INK), function (sh, ph) {
      sh.slot(0, 0, sh.w, sh.h, { photo: ph[0], z: 1 });
      sh.text('LOCAL', 40, 36, sh.w - 80, 90, { font: 'Playfair Display', weight: 700, size: 72, align: 'center', color: WHITE, letterSpacing: 6 });
      sh.text('the edit', 40, sh.h - 120, sh.w - 80, 50, { font: 'Instrument Serif', italic: true, size: 36, align: 'center', color: WHITE });
    }),
    V('Inset cover', 'sq', solid(WHITE), function (sh, ph) {
      sh.text('LOCAL', 40, 28, sh.w - 80, 70, { font: 'Playfair Display', weight: 700, size: 56, align: 'center', color: INK, letterSpacing: 4 });
      rule(sh, 100, INK, 2);
      sh.slot(80, 130, 920, 780, { photo: ph[0], z: 1 });
      rule(sh, 940, INK, 1);
      sh.text('volume 04', 80, 960, 400, 36, { font: 'Libre Baskerville', size: 16, color: INK });
    })
  );
  classic('typography-poster', 'Typography poster', ['arch', 'people'], ['poster', 'type'],
    V('Word and band', 'sq', solid('#111111'), function (sh, ph) {
      sh.text('FORM', 30, 40, 1020, 280, { font: 'Anton', size: 200, color: WHITE });
      sh.slot(30, 360, 1020, 640, { photo: ph[0], z: 1 });
    }),
    V('Vertical word', 'story', solid('#F4F1EA'), function (sh, ph) {
      var word = 'TYPE';
      for (var i = 0; i < word.length; i++) {
        sh.text(word.charAt(i), 30, 40 + i * 420, 280, 360, { font: 'Anton', size: 200, color: INK });
      }
      sh.slot(340, 80, 700, 1760, { photo: ph[0], z: 1 });
    })
  );
  classic('editorial-spread', 'Editorial spread', ['people', 'arch'], ['spread', 'gutter'],
    V('Even gutter', 'land', solid(WHITE), function (sh, ph) {
      sh.slot(36, 36, 900, 1008, { photo: ph[0], z: 1 });
      sh.slot(984, 36, 900, 1008, { photo: ph[1], z: 2 });
      sh.text('01', 930, 500, 60, 40, { font: 'Libre Baskerville', size: 14, align: 'center', color: '#8C8175' });
    }),
    V('Pull quote spread', 'land', solid('#F7F4EF'), function (sh, ph) {
      sh.slot(30, 30, 1200, 1020, { photo: ph[0], z: 1 });
      sh.text('The work waits to be seen.', 1280, 200, 580, 220, { font: 'Instrument Serif', italic: true, size: 42, color: INK });
      sh.slot(1280, 520, 580, 500, { photo: ph[1], z: 2 });
    })
  );
  function discTiles(sh, cols, rows, keep, ph) {
    var gap = 6, m = 18;
    var cw = (sh.w - m * 2 - gap * (cols - 1)) / cols;
    var ch = (sh.h - m * 2 - gap * (rows - 1)) / rows;
    var cx = sh.w / 2, cy = sh.h / 2;
    var cells = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x = m + c * (cw + gap);
        var y = m + r * (ch + gap);
        var dx = (x + cw / 2 - cx) / (sh.w / 2);
        var dy = (y + ch / 2 - cy) / (sh.h / 2);
        cells.push({ x: x, y: y, d: dx * dx + dy * dy });
      }
    }
    cells.sort(function (a, b) { return a.d - b.d; });
    var n = Math.min(keep, cells.length);
    for (var i = 0; i < n; i++) sh.slot(cells[i].x, cells[i].y, cw, ch, { photo: ph[i], z: i + 1 });
  }
  classic('circular-mosaic', 'Circular mosaic', ['people', 'garden', 'travel'], ['circle', 'tiles'],
    V('Disc of tiles', 'sq', solid('#F6F1EA'), function (sh, ph) { discTiles(sh, 7, 7, 21, ph); }),
    V('Wide disc', 'land', solid('#F6F1EA'), function (sh, ph) { discTiles(sh, 11, 7, 37, ph); })
  );
};
