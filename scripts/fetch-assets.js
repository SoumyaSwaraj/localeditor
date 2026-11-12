#!/usr/bin/env node
/* Builds assets/data/{lucide,phosphor,emoji,stickers}.json for LE.assets.
   Run: node scripts/fetch-assets.js */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'assets', 'data');
const JS_PATH = path.join(ROOT, 'assets', 'js', 'le-assets.js');

const SOURCES = {
  lucide: 'https://cdn.jsdelivr.net/npm/@iconify-json/lucide@1.2.151/icons.json',
  ph: 'https://cdn.jsdelivr.net/npm/@iconify-json/ph@1.2.2/icons.json',
  emoji: 'https://cdn.jsdelivr.net/npm/@iconify-json/fluent-emoji-flat@1.2.6/icons.json',
  emojiMeta: 'https://cdn.jsdelivr.net/npm/@iconify-json/fluent-emoji-flat@1.2.6/metadata.json'
};

const CANON = {
  clippath: 'clipPath',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  feflood: 'feFlood',
  fecolormatrix: 'feColorMatrix',
  feoffset: 'feOffset',
  fegaussianblur: 'feGaussianBlur',
  feblend: 'feBlend',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  fecomposite: 'feComposite',
  textpath: 'textPath'
};
const ALLOWED = new Set([
  'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'title', 'desc', 'defs',
  'stop', 'mask', 'use', 'symbol', 'filter', 'text', 'tspan',
  'clipPath', 'linearGradient', 'radialGradient', 'feFlood', 'feColorMatrix', 'feOffset',
  'feGaussianBlur', 'feBlend', 'feMerge', 'feMergeNode', 'feComposite', 'textPath'
]);
const SELF = new Set([
  'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'stop', 'use',
  'feFlood', 'feColorMatrix', 'feOffset', 'feGaussianBlur', 'feBlend', 'feMergeNode', 'feComposite'
]);
const ATTR = new Set([
  'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'clip-rule',
  'opacity', 'transform', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height',
  'points', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod',
  'fx', 'fy', 'id', 'clip-path', 'mask', 'href', 'xlink:href', 'stddeviation', 'result', 'in', 'in2',
  'values', 'type', 'mode', 'dx', 'dy', 'flood-opacity', 'flood-color', 'filter', 'filterunits',
  'color-interpolation-filters',   'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'letter-spacing', 'dominant-baseline',
  'stop-opacity', 'class', 'color', 'paint-order'
]);
const dropped = {};

function canonTag(tag) {
  const low = tag.toLowerCase();
  if (CANON[low]) return CANON[low];
  if (ALLOWED.has(low)) return low;
  return null;
}

function cleanAttrs(raw) {
  const out = [];
  const re = /([:@A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1];
    const low = key.toLowerCase();
    const val = m[3] != null ? m[3] : m[4];
    if (!ATTR.has(low) || /^on/i.test(low)) {
      dropped[low] = (dropped[low] || 0) + 1;
      continue;
    }
    if (/javascript:/i.test(val) || /[<>]/.test(val)) continue;
    if ((low === 'href' || low === 'xlink:href') && !/^#[A-Za-z_][\w:.-]*$/.test(val)) continue;
    if (/url\(\s*(?!#)/i.test(val)) continue;
    out.push(key + '="' + val.replace(/"/g, '') + '"');
  }
  return out.length ? ' ' + out.join(' ') : '';
}

function sanitize(body) {
  let s = String(body || '');
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '');
  s = s.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\/?([a-zA-Z][\w:-]*)\b([^<>]*?)(\/?)>/g, function (full, tag, attrs, slash) {
    const name = canonTag(tag);
    if (!name) return '';
    if (full.charAt(1) === '/') return '</' + name + '>';
    const self = slash === '/' || SELF.has(name);
    return '<' + name + cleanAttrs(attrs) + (self ? '/>' : '>');
  });
  if (/<script|foreignObject|\son[a-z]+\s*=|javascript:/i.test(s)) throw new Error('sanitizer leak');
  return s;
}

function addToken(search, token, name) {
  const t = String(token || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (t.length < 2 && t !== 'x') return;
  if (!search[t]) search[t] = [];
  if (search[t].indexOf(name) < 0) search[t].push(name);
}

function indexIcon(search, name, tags) {
  name.split('-').forEach(function (part) { addToken(search, part, name); });
  String(tags || '').split(/[^a-z0-9]+/i).forEach(function (part) { addToken(search, part, name); });
}

const SYN = {
  heart: 'love like valentine',
  smile: 'happy grin joy',
  party: 'celebrate celebration birthday',
  popper: 'party celebrate',
  confetti: 'party celebrate',
  balloon: 'party celebrate',
  camera: 'photo picture',
  image: 'photo picture',
  fire: 'hot flame',
  star: 'favorite rating',
  thumb: 'like yes approve',
  sun: 'weather day bright',
  moon: 'night weather',
  cloud: 'weather',
  rain: 'weather',
  dog: 'pet animal',
  cat: 'pet animal',
  pizza: 'food',
  airplane: 'travel flight plane',
  car: 'travel drive',
  gift: 'present birthday',
  check: 'done yes tick',
  warning: 'alert caution',
  trash: 'delete remove bin',
  gear: 'settings cog',
  house: 'home',
  magnifying: 'search find',
  pencil: 'edit write',
  pen: 'edit write draw',
  user: 'person account profile',
  lock: 'secure password',
  envelope: 'mail email',
  chat: 'message comment',
  arrow: 'direction',
  sparkle: 'magic shine',
  crown: 'royal king',
  cart: 'shop buy',
  file: 'document',
  folder: 'directory',
  smiley: 'happy face'
};

function extraTags(name, category) {
  const bits = [];
  if (category) bits.push(category);
  const tokens = name.toLowerCase().split('-');
  tokens.forEach(function (token) {
    if (SYN[token]) bits.push(SYN[token]);
  });
  return bits.join(' ');
}

const PH_CORE = [
  'camera', 'heart', 'star', 'image', 'user', 'users', 'house', 'gear', 'magnifying-glass',
  'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'check', 'check-circle', 'x', 'x-circle',
  'plus', 'minus', 'download-simple', 'upload-simple', 'trash', 'pencil-simple', 'pen', 'eraser',
  'palette', 'paint-brush', 'crop', 'scissors', 'copy', 'clipboard', 'paperclip', 'floppy-disk',
  'folder', 'folder-open', 'file', 'file-text', 'play', 'pause', 'speaker-high', 'microphone',
  'video-camera', 'map-pin', 'calendar', 'clock', 'bell', 'bookmark-simple', 'share-network',
  'link', 'lock', 'lock-open', 'eye', 'eye-slash', 'sun', 'moon', 'cloud', 'fire', 'lightning',
  'leaf', 'chat-circle', 'envelope', 'phone', 'device-mobile', 'laptop', 'printer', 'wifi-high',
  'battery-full', 'shopping-cart', 'credit-card', 'gift', 'flag', 'info', 'warning', 'question',
  'seal-check', 'thumbs-up', 'hand-waving', 'cursor', 'arrows-out', 'arrows-clockwise',
  'flip-horizontal', 'stack', 'sliders', 'funnel', 'dots-three', 'list', 'grid-four', 'text-aa',
  'text-b', 'text-italic', 'text-underline', 'text-align-left', 'quotes', 'code', 'terminal-window',
  'bug', 'hash', 'at', 'percent', 'chart-bar', 'table', 'selection', 'bounding-box', 'pen-nib',
  'sparkle', 'confetti', 'sticker', 'stamp', 'signature', 'crown', 'medal', 'smiley', 'heart-straight',
  'star-four', 'circle', 'square', 'triangle', 'hexagon', 'diamond', 'frame-corners', 'magic-wand'
];

const PH_STEMS = [
  'arrow', 'caret', 'chevron', 'check', 'plus', 'minus', 'magnifying', 'house', 'gear', 'user',
  'heart', 'star', 'bookmark', 'bell', 'camera', 'image', 'video', 'microphone', 'play', 'pause',
  'speaker', 'download', 'upload', 'share', 'link', 'lock', 'eye', 'trash', 'copy', 'clipboard',
  'scissors', 'pencil', 'pen', 'eraser', 'crop', 'paint', 'palette', 'sun', 'moon', 'cloud',
  'fire', 'lightning', 'leaf', 'music', 'file', 'folder', 'archive', 'calendar', 'clock', 'map',
  'compass', 'globe', 'envelope', 'chat', 'phone', 'device', 'laptop', 'monitor', 'printer',
  'keyboard', 'wifi', 'battery', 'shopping', 'credit', 'currency', 'tag', 'gift', 'flag', 'info',
  'warning', 'question', 'seal', 'sparkle', 'magic', 'text', 'align', 'list', 'grid', 'squares',
  'columns', 'rows', 'sidebar', 'layout', 'table', 'chart', 'quotes', 'code', 'terminal', 'bug',
  'database', 'git', 'brackets', 'smiley', 'thumbs', 'hand', 'cursor', 'arrows', 'flip', 'stack',
  'sliders', 'funnel', 'dots', 'paragraph', 'highlighter', 'stamp', 'signature', 'frame',
  'selection', 'bounding', 'circle', 'square', 'triangle', 'hexagon', 'diamond', 'cube', 'drop',
  'crown', 'medal', 'trophy', 'cake', 'coffee', 'pizza', 'airplane', 'car', 'bicycle', 'tree',
  'flower', 'dog', 'cat', 'key', 'shield', 'fingerprint', 'note', 'paperclip', 'export', 'sort',
  'confetti', 'balloon', 'polygon', 'rectangle', 'wave', 'bezier', 'vector', 'path', 'line-segment'
];

const EMOJI_QUOTA = {
  'Smileys & Emotion': 150,
  'People & Body': 130,
  'Animals & Nature': 120,
  'Food & Drink': 110,
  'Travel & Places': 120,
  Activities: 70,
  Objects: 130,
  Symbols: 80,
  Flags: 8
};
const EMOJI_MUST = [
  'camera', 'camera-with-flash', 'red-heart', 'party-popper', 'partying-face',
  'smiling-face-with-heart-eyes', 'smiling-face-with-hearts', 'fire', 'star', 'thumbs-up',
  'confetti-ball', 'balloon', 'sparkles', 'birthday-cake', 'wrapped-gift'
];
const EMOJI_POPULAR = [
  'grinning-face', 'beaming-face-with-smiling-eyes', 'face-with-tears-of-joy', 'grinning-face-with-big-eyes',
  'grinning-face-with-smiling-eyes', 'smiling-face', 'smiling-face-with-heart-eyes', 'smiling-face-with-hearts',
  'star-struck', 'face-blowing-a-kiss', 'kissing-face', 'smiling-face-with-smiling-eyes', 'winking-face',
  'zany-face', 'squinting-face-with-tongue', 'partying-face', 'woozy-face', 'melting-face', 'smiling-face-with-sunglasses',
  'nerd-face', 'face-with-monocle', 'confused-face', 'worried-face', 'slightly-frowning-face', 'frowning-face',
  'crying-face', 'loudly-crying-face', 'pleading-face', 'thinking-face', 'shushing-face', 'zipper-mouth-face',
  'face-with-open-mouth', 'astonished-face', 'flushed-face', 'pleading-face', 'sleeping-face', 'sleepy-face',
  'yawning-face', 'smiling-face-with-tear', 'angry-face', 'enraged-face', 'face-with-symbols-on-mouth',
  'exploding-head', 'cold-face', 'hot-face', 'cowboy-hat-face', 'disguised-face', 'smiling-face-with-halo',
  'party-popper', 'confetti-ball', 'balloon', 'birthday-cake', 'wrapped-gift', 'sparkles', 'fire', 'collision',
  'red-heart', 'sparkling-heart', 'growing-heart', 'beating-heart', 'two-hearts', 'heart-on-fire', 'broken-heart',
  'orange-heart', 'yellow-heart', 'green-heart', 'blue-heart', 'purple-heart', 'black-heart', 'white-heart',
  'pink-heart', 'hundred-points', 'check-mark-button', 'cross-mark', 'warning', 'star', 'glowing-star',
  'thumbs-up', 'thumbs-down', 'clapping-hands', 'raising-hands', 'folded-hands', 'waving-hand', 'handshake',
  'flexed-biceps', 'victory-hand', 'love-you-gesture', 'ok-hand', 'backhand-index-pointing-up',
  'backhand-index-pointing-right', 'eyes', 'eye', 'brain', 'camera', 'camera-with-flash', 'movie-camera',
  'sun', 'full-moon', 'cloud', 'rainbow', 'snowflake', 'umbrella', 'high-voltage', 'rose', 'sunflower',
  'tulip', 'bouquet', 'seedling', 'evergreen-tree', 'cactus', 'four-leaf-clover', 'dog-face', 'cat-face',
  'mouse-face', 'fox', 'bear', 'panda', 'lion', 'tiger', 'frog', 'monkey-face', 'penguin', 'bird',
  'baby-chick', 'unicorn', 'bee', 'butterfly', 'fish', 'dolphin', 'whale', 'octopus', 'turtle',
  'pizza', 'hamburger', 'french-fries', 'hot-dog', 'taco', 'popcorn', 'doughnut', 'cookie', 'shortcake',
  'ice-cream', 'chocolate-bar', 'lollipop', 'coffee', 'teacup-without-handle', 'tropical-drink', 'clinking-beer-mugs',
  'red-apple', 'banana', 'watermelon', 'grapes', 'strawberry', 'cherries', 'peach', 'pineapple', 'avocado',
  'carrot', 'ear-of-corn', 'bread', 'cheese-wedge', 'egg', 'airplane', 'automobile', 'bus', 'bicycle',
  'rocket', 'sailboat', 'house', 'house-with-garden', 'office-building', 'school', 'castle', 'tent',
  'volcano', 'mount-fuji', 'camping', 'beach-with-umbrella', 'desert-island', 'globe-showing-europe-africa',
  'alarm-clock', 'hourglass-done', 'bell', 'magnifying-glass-tilted-left', 'light-bulb', 'locked', 'key',
  'pencil', 'pen', 'scissors', 'wastebasket', 'money-bag', 'credit-card', 'gem-stone', 'crown', 'ring',
  'musical-note', 'microphone', 'headphone', 'guitar', 'violin', 'drum', 'clapper-board', 'artist-palette',
  'trophy', 'sports-medal', 'soccer-ball', 'basketball', 'american-football', 'baseball', 'tennis',
  'game-die', 'puzzle-piece', 'teddy-bear', 'pinata', 'fireworks', 'sparkler', 'christmas-tree',
  'jack-o-lantern', 'ghost', 'skull', 'alien', 'robot', 'smiling-face-with-hearts'
];

function isSkin(name, icons) {
  const m = name.match(/-(medium-light|medium-dark|light|medium|dark)$/);
  if (!m) return false;
  return Object.prototype.hasOwnProperty.call(icons, name.slice(0, -m[0].length));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + ' ' + url);
  return res.json();
}

function packAliases(raw, icons) {
  const aliases = {};
  Object.keys(raw || {}).forEach(function (name) {
    const alias = raw[name];
    const parent = alias && alias.parent;
    if (!parent || !icons[parent]) return;
    aliases[name] = alias.hFlip ? { parent: parent, hFlip: true } : { parent: parent };
  });
  return aliases;
}

function buildLucide(raw) {
  const icons = {};
  const search = {};
  Object.keys(raw.icons).sort().forEach(function (name) {
    const body = sanitize(raw.icons[name].body);
    if (!body) return;
    const tags = extraTags(name, 'ui icon');
    icons[name] = { body: body, tags: tags };
    indexIcon(search, name, tags);
  });
  const aliases = packAliases(raw.aliases, icons);
  Object.keys(aliases).forEach(function (name) {
    indexIcon(search, name, '');
  });
  return { prefix: 'lucide', width: raw.width || 24, height: raw.height || 24, icons: icons, aliases: aliases, search: search };
}

function buildPhosphor(raw) {
  const regular = Object.keys(raw.icons).filter(function (name) {
    return !/-(fill|duotone|bold|light|thin)$/.test(name) && !/logo/.test(name);
  }).sort();
  const picked = new Set();
  const missing = [];
  PH_CORE.forEach(function (name) {
    if (raw.icons[name] && !/-(fill|duotone|bold|light|thin)$/.test(name)) picked.add(name);
    else missing.push(name);
  });
  PH_STEMS.forEach(function (stem) {
    let added = 0;
    for (let i = 0; i < regular.length && picked.size < 600 && added < 12; i++) {
      const name = regular[i];
      if (picked.has(name)) continue;
      if (name === stem || name.indexOf(stem) >= 0) {
        picked.add(name);
        added++;
      }
    }
  });
  regular.forEach(function (name) {
    if (picked.size < 600) picked.add(name);
  });
  const bases = Array.from(picked).sort();
  const icons = {};
  const search = {};
  bases.forEach(function (base) {
    ['', '-fill', '-duotone'].forEach(function (suffix) {
      const name = base + suffix;
      const src = raw.icons[name];
      if (!src) return;
      const body = sanitize(src.body);
      if (!body) return;
      const style = suffix === '-fill' ? 'fill solid' : suffix === '-duotone' ? 'duotone' : 'regular outline';
      const tags = (extraTags(base, 'ui icon') + ' ' + style).trim();
      icons[name] = { body: body, tags: tags };
      indexIcon(search, name, tags);
    });
  });
  const aliases = packAliases(raw.aliases, icons);
  Object.keys(aliases).forEach(function (name) { indexIcon(search, name, ''); });
  console.log('phosphor bases', bases.length, 'icons', Object.keys(icons).length, 'missing core', missing.join(', ') || 'none');
  return { prefix: 'phosphor', width: raw.width || 256, height: raw.height || 256, icons: icons, aliases: aliases, search: search };
}

function buildEmoji(raw, meta) {
  const cats = meta.categories || {};
  const byName = {};
  Object.keys(cats).forEach(function (cat) {
    (cats[cat] || []).forEach(function (name) { if (!byName[name]) byName[name] = cat; });
  });
  const popularAt = {};
  EMOJI_POPULAR.forEach(function (name, i) { popularAt[name] = i; });
  function score(name) {
    let s = Math.max(0, 42 - name.length);
    if (popularAt[name] != null) s += 3000 - popularAt[name];
    if (/^(man|woman|men|women)-/.test(name)) s -= 50;
    return s;
  }
  const selected = new Set();
  Object.keys(EMOJI_QUOTA).forEach(function (cat) {
    const names = (cats[cat] || []).filter(function (name) {
      return raw.icons[name] && !isSkin(name, raw.icons);
    });
    names.sort(function (a, b) { return score(b) - score(a) || (a < b ? -1 : 1); });
    names.slice(0, EMOJI_QUOTA[cat]).forEach(function (name) { selected.add(name); });
  });
  EMOJI_MUST.forEach(function (name) {
    if (raw.icons[name]) selected.add(name);
  });
  let bytes = 0;
  selected.forEach(function (name) { bytes += raw.icons[name].body.length; });
  const ranked = Array.from(selected).sort(function (a, b) { return score(a) - score(b); });
  const must = {};
  EMOJI_MUST.forEach(function (name) { must[name] = 1; });
  for (let i = 0; i < ranked.length && bytes > 2400000; i++) {
    const name = ranked[i];
    if (must[name]) continue;
    bytes -= raw.icons[name].body.length;
    selected.delete(name);
  }
  const icons = {};
  const search = {};
  Array.from(selected).sort().forEach(function (name) {
    const body = sanitize(raw.icons[name].body);
    if (!body) return;
    const cat = byName[name] || '';
    const friendly = cat.toLowerCase().replace(/&/g, ' ').replace(/[^a-z]+/g, ' ').trim();
    const tags = (extraTags(name, friendly)).replace(/\s+/g, ' ').trim();
    icons[name] = { body: body, tags: tags };
    indexIcon(search, name, tags);
  });
  const aliases = packAliases(raw.aliases, icons);
  Object.keys(aliases).forEach(function (name) { indexIcon(search, name, ''); });
  console.log('emoji', Object.keys(icons).length, 'body KB', Math.round(bytes / 1024));
  return { prefix: 'emoji', width: raw.width || 32, height: raw.height || 32, icons: icons, aliases: aliases, search: search };
}

function starPath(cx, cy, r, inner, n) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    d += (i ? 'L' : 'M') + (cx + rad * Math.cos(a)).toFixed(1) + ' ' + (cy + rad * Math.sin(a)).toFixed(1);
  }
  return d + 'Z';
}

function heartPath(x, y, w, h) {
  const p = function (px, py) { return (x + px * w).toFixed(1) + ' ' + (y + py * h).toFixed(1); };
  return 'M' + p(0.5, 0.86) + 'C' + p(0.5, 0.86) + ' ' + p(0.12, 0.62) + ' ' + p(0.12, 0.4) +
    'C' + p(0.12, 0.22) + ' ' + p(0.28, 0.1) + ' ' + p(0.4, 0.18) +
    'C' + p(0.46, 0.22) + ' ' + p(0.48, 0.28) + ' ' + p(0.5, 0.34) +
    'C' + p(0.52, 0.28) + ' ' + p(0.54, 0.22) + ' ' + p(0.6, 0.18) +
    'C' + p(0.72, 0.1) + ' ' + p(0.88, 0.22) + ' ' + p(0.88, 0.4) +
    'C' + p(0.88, 0.62) + ' ' + p(0.5, 0.86) + ' ' + p(0.5, 0.86) + 'Z';
}

function wavePath(w, h, amp, cycles, y) {
  let d = 'M0 ' + y.toFixed(1);
  const step = w / (cycles * 8);
  for (let x = 0; x <= w; x += step) {
    const yy = y + Math.sin((x / w) * cycles * Math.PI * 2) * amp;
    d += 'L' + x.toFixed(1) + ' ' + yy.toFixed(1);
  }
  return d;
}

function label(x, y, size, fill, text, extra) {
  return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="' + size + '" font-weight="700" fill="' + fill + '"' + (extra || '') + '>' + text + '</text>';
}

function buildStickers() {
  const A = '#7457F0';
  const R = '#E0668E';
  const C = '#F2D594';
  const G = '#E2B15A';
  const S = '#2F6BFF';
  const J = '#17A37A';
  const K = '#D07A45';
  const O = '#110F17';
  const items = [
    ['sale-ribbon', 320, 110, 'sale ribbon banner discount',
      '<path fill="' + A + '" d="M28 18h264l-18 37 18 37H28L46 55z"/>' +
      '<path fill="' + O + '" opacity=".22" d="M28 18 46 55 28 92H8l20-37L8 18z"/>' +
      '<path fill="' + O + '" opacity=".22" d="M292 18h20L292 55l20 37h-20l-18-37z"/>' +
      label(160, 66, 28, C, 'SALE', ' letter-spacing="5"')],
    ['corner-ribbon', 160, 160, 'new corner ribbon badge',
      '<polygon points="0,0 160,0 160,46 46,160 0,160" fill="' + G + '"/>' +
      '<polygon points="0,0 160,0 160,28 28,160 0,160" fill="' + R + '"/>' +
      '<text x="78" y="78" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="' + C + '" transform="rotate(-45 78 78)" letter-spacing="2">NEW</text>'],
    ['starburst', 200, 200, 'sale burst star badge',
      '<path fill="' + G + '" d="' + starPath(100, 100, 96, 0.72, 16) + '"/>' +
      '<circle cx="100" cy="100" r="46" fill="' + A + '"/>' +
      label(100, 108, 22, C, 'SALE', ' letter-spacing="2"')],
    ['badge-new', 180, 180, 'new badge circle',
      '<circle cx="90" cy="90" r="78" fill="' + A + '"/>' +
      '<circle cx="90" cy="90" r="62" fill="none" stroke="' + C + '" stroke-width="3"/>' +
      label(90, 98, 28, C, 'NEW', ' letter-spacing="3"')],
    ['stamp-approved', 200, 200, 'approved stamp seal',
      '<g transform="rotate(-14 100 100)">' +
      '<circle cx="100" cy="100" r="78" fill="none" stroke="' + J + '" stroke-width="7"/>' +
      '<circle cx="100" cy="100" r="64" fill="none" stroke="' + J + '" stroke-width="2"/>' +
      label(100, 108, 18, J, 'APPROVED', ' letter-spacing="1"') +
      '</g>'],
    ['stamp-draft', 200, 200, 'draft stamp',
      '<g transform="rotate(-10 100 100)">' +
      '<circle cx="100" cy="100" r="76" fill="none" stroke="' + K + '" stroke-width="6" stroke-dasharray="8 6"/>' +
      '<circle cx="100" cy="100" r="62" fill="none" stroke="' + K + '" stroke-width="2"/>' +
      label(100, 108, 26, K, 'DRAFT', ' letter-spacing="3"') +
      '</g>'],
    ['stamp-confidential', 240, 150, 'confidential stamp secret',
      '<g transform="rotate(-8 120 75)">' +
      '<rect x="10" y="36" width="220" height="78" rx="8" fill="none" stroke="' + R + '" stroke-width="6"/>' +
      '<rect x="18" y="44" width="204" height="62" rx="4" fill="none" stroke="' + R + '" stroke-width="2"/>' +
      label(120, 84, 16, R, 'CONFIDENTIAL', ' letter-spacing="0.5"') +
      '</g>'],
    ['stamp-paid', 200, 200, 'paid stamp',
      '<g transform="rotate(12 100 100)">' +
      '<circle cx="100" cy="100" r="76" fill="none" stroke="' + S + '" stroke-width="8"/>' +
      '<circle cx="100" cy="100" r="60" fill="none" stroke="' + S + '" stroke-width="2"/>' +
      label(100, 110, 32, S, 'PAID', ' letter-spacing="4"') +
      '</g>'],
    ['speech-round', 220, 170, 'speech bubble talk',
      '<rect x="8" y="8" width="204" height="112" rx="28" fill="' + C + '"/>' +
      '<path fill="' + C + '" d="M48 116l-8 42 48-38z"/>' +
      '<circle cx="78" cy="64" r="6" fill="' + O + '" opacity=".35"/>' +
      '<circle cx="110" cy="64" r="6" fill="' + O + '" opacity=".35"/>' +
      '<circle cx="142" cy="64" r="6" fill="' + O + '" opacity=".35"/>'],
    ['speech-square', 220, 170, 'speech bubble square talk',
      '<rect x="8" y="8" width="204" height="112" fill="' + A + '"/>' +
      '<path fill="' + A + '" d="M46 120l-6 40 46-40z"/>'],
    ['speech-thought', 220, 180, 'thought bubble idea',
      '<ellipse cx="116" cy="74" rx="96" ry="62" fill="' + C + '"/>' +
      '<ellipse cx="78" cy="78" rx="48" ry="40" fill="' + C + '"/>' +
      '<circle cx="46" cy="142" r="12" fill="' + C + '"/>' +
      '<circle cx="28" cy="164" r="7" fill="' + C + '"/>'],
    ['tape-strip', 280, 78, 'tape washi strip',
      '<g transform="rotate(-2 140 39)">' +
      '<rect x="8" y="16" width="264" height="46" rx="3" fill="' + C + '" opacity=".92"/>' +
      '<rect x="8" y="16" width="264" height="8" fill="' + G + '" opacity=".45"/>' +
      '<path d="M18 39h244" fill="none" stroke="' + O + '" stroke-width="1" opacity=".15"/>' +
      '</g>'],
    ['tape-diagonal', 200, 140, 'tape diagonal washi',
      '<g transform="rotate(-18 100 70)">' +
      '<rect x="16" y="52" width="168" height="36" fill="' + R + '" opacity=".88"/>' +
      '<path d="M16 58h168M16 82h168" fill="none" stroke="' + C + '" stroke-width="2" opacity=".7"/>' +
      '</g>'],
    ['sparkles', 180, 140, 'sparkle shine magic',
      '<path fill="' + G + '" d="' + starPath(48, 46, 28, 0.18, 4) + '"/>' +
      '<path fill="' + A + '" d="' + starPath(124, 38, 16, 0.16, 4) + '"/>' +
      '<path fill="' + R + '" d="' + starPath(108, 96, 22, 0.18, 4) + '"/>'],
    ['sparkle', 120, 120, 'sparkle star shine',
      '<path fill="' + G + '" d="' + starPath(60, 60, 52, 0.16, 4) + '"/>'],
    ['arrow-scribble', 230, 100, 'arrow hand drawn scribble',
      '<path d="M16 62c28-2 40-28 68-26 22 2 28 24 52 22 18-2 28-20 48-28" fill="none" stroke="' + O + '" stroke-width="6" stroke-linecap="round"/>' +
      '<path d="M168 22l36 12-28 22" fill="none" stroke="' + O + '" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'],
    ['arrow-curved-hand', 210, 150, 'arrow curved hand drawn',
      '<path d="M24 118C48 40 110 28 150 70" fill="none" stroke="' + A + '" stroke-width="7" stroke-linecap="round"/>' +
      '<path d="M132 48l28 18-32 16" fill="none" stroke="' + A + '" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'],
    ['underline-scribble', 230, 46, 'underline scribble highlight',
      '<path d="M10 24c28 10 36-12 64-4 26 8 30-14 58-6 24 7 32-8 62 2" fill="none" stroke="' + G + '" stroke-width="7" stroke-linecap="round"/>'],
    ['circle-scribble', 170, 170, 'circle scribble hand drawn',
      '<ellipse cx="86" cy="86" rx="62" ry="58" fill="none" stroke="' + R + '" stroke-width="6" stroke-linecap="round"/>' +
      '<path d="M40 70c8-28 70-40 96-8 18 22 8 58-16 70-30 16-62-6-70-32" fill="none" stroke="' + R + '" stroke-width="3" stroke-linecap="round" opacity=".7"/>'],
    ['heart', 150, 140, 'heart love',
      '<path fill="' + R + '" d="' + heartPath(8, 10, 134, 120) + '"/>'],
    ['heart-outline', 150, 140, 'heart love outline',
      '<path fill="none" stroke="' + G + '" stroke-width="6" d="' + heartPath(12, 14, 126, 112) + '"/>'],
    ['crown', 190, 120, 'crown royal',
      '<path fill="' + G + '" d="M18 92 34 38l32 28L95 22l29 44 32-28 16 54z"/>' +
      '<rect x="22" y="92" width="146" height="14" rx="3" fill="' + K + '"/>' +
      '<circle cx="34" cy="36" r="6" fill="' + C + '"/>' +
      '<circle cx="95" cy="20" r="7" fill="' + C + '"/>' +
      '<circle cx="156" cy="36" r="6" fill="' + C + '"/>'],
    ['seal', 180, 180, 'seal badge award',
      '<path fill="' + G + '" d="' + starPath(90, 90, 84, 0.86, 18) + '"/>' +
      '<circle cx="90" cy="90" r="48" fill="' + A + '"/>' +
      '<path fill="' + C + '" d="' + starPath(90, 90, 16, 0.4, 5) + '"/>'],
    ['price-tag', 190, 130, 'price tag label',
      '<path fill="' + S + '" d="M24 22h78l74 43-74 43H24a14 14 0 0 1-14-14V36a14 14 0 0 1 14-14z"/>' +
      '<circle cx="52" cy="65" r="10" fill="' + C + '"/>'],
    ['frame', 200, 200, 'frame border',
      '<rect x="10" y="10" width="180" height="180" fill="none" stroke="' + A + '" stroke-width="8"/>' +
      '<rect x="24" y="24" width="152" height="152" fill="none" stroke="' + G + '" stroke-width="2"/>'],
    ['frame-corners', 200, 200, 'frame corners border',
      '<path d="M18 58V22h36M182 22h-36M182 58V22M18 142v36h36M182 178h-36M182 142v36" fill="none" stroke="' + O + '" stroke-width="8" stroke-linecap="square"/>'],
    ['blob', 180, 160, 'blob shape organic',
      '<path fill="' + A + '" d="M70 12c28-8 62 4 78 28 18 26 22 58 6 78-18 24-52 36-82 28-28-8-48-32-50-60-2-30 16-66 48-74z"/>'],
    ['blob-rose', 180, 160, 'blob shape organic',
      '<path fill="' + R + '" d="M96 10c32 2 62 24 66 54 4 32-14 58-40 70-30 14-68 6-86-22C16 86 28 40 58 22c12-6 24-12 38-12z"/>'],
    ['wave', 320, 72, 'wave divider',
      '<path fill="' + C + '" d="' + wavePath(320, 72, 14, 2, 28) + 'L320 72H0Z"/>'],
    ['wave-double', 320, 84, 'wave divider double',
      '<path fill="' + A + '" opacity=".9" d="' + wavePath(320, 84, 12, 2.2, 26) + 'L320 84H0Z"/>' +
      '<path fill="' + S + '" opacity=".85" d="' + wavePath(320, 84, 10, 1.6, 44) + 'L320 84H0Z"/>'],
    ['burst-rays', 200, 200, 'burst rays sun',
      (function () {
        let d = '';
        for (let i = 0; i < 16; i++) {
          const a = (i * Math.PI) / 8;
          d += 'M100 100L' + (100 + Math.cos(a) * 92).toFixed(1) + ' ' + (100 + Math.sin(a) * 92).toFixed(1) + ' ';
        }
        return '<path d="' + d + '" fill="none" stroke="' + G + '" stroke-width="8" stroke-linecap="round"/>' +
          '<circle cx="100" cy="100" r="28" fill="' + C + '"/>';
      })()],
    ['star', 160, 160, 'star favorite',
      '<path fill="' + G + '" d="' + starPath(80, 80, 72, 0.42, 5) + '"/>'],
    ['check-seal', 180, 180, 'check approved seal',
      '<circle cx="90" cy="90" r="78" fill="' + J + '"/>' +
      '<circle cx="90" cy="90" r="64" fill="none" stroke="' + C + '" stroke-width="3"/>' +
      '<path d="M58 92l18 18 40-44" fill="none" stroke="' + C + '" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'],
    ['banner-flag', 260, 110, 'banner flag ribbon',
      '<path fill="' + A + '" d="M8 18h210l-28 37 28 37H8z"/>' +
      '<path fill="' + O + '" opacity=".18" d="M8 18v74l16-37z"/>' +
      label(108, 66, 22, C, 'NEW', ' letter-spacing="3"')],
    ['label-pill', 168, 64, 'label pill new',
      '<rect x="4" y="8" width="160" height="48" rx="24" fill="' + R + '"/>' +
      label(84, 40, 18, C, 'NEW', ' letter-spacing="2"')],
    ['confetti', 180, 150, 'confetti party celebrate',
      '<rect x="24" y="28" width="16" height="28" rx="2" fill="' + A + '" transform="rotate(18 32 42)"/>' +
      '<rect x="78" y="18" width="14" height="26" rx="2" fill="' + G + '" transform="rotate(-22 85 31)"/>' +
      '<rect x="128" y="36" width="16" height="24" rx="2" fill="' + R + '" transform="rotate(24 136 48)"/>' +
      '<circle cx="54" cy="88" r="8" fill="' + S + '"/>' +
      '<circle cx="112" cy="96" r="6" fill="' + J + '"/>' +
      '<path fill="' + K + '" d="' + starPath(150, 100, 12, 0.4, 5) + '"/>' +
      '<circle cx="36" cy="120" r="5" fill="' + C + '"/>'],
    ['swoosh', 230, 70, 'swoosh underline',
      '<path d="M12 46C60 18 120 14 218 28" fill="none" stroke="' + A + '" stroke-width="10" stroke-linecap="round"/>' +
      '<path d="M150 18c28 6 48 12 68 16" fill="none" stroke="' + G + '" stroke-width="4" stroke-linecap="round"/>'],
    ['highlighter', 230, 48, 'highlighter mark underline',
      '<path d="M12 28c40-8 80 6 120-2 28-4 52 4 86 0" fill="none" stroke="' + C + '" stroke-width="18" stroke-linecap="round" opacity=".95"/>'],
    ['flourish', 160, 90, 'flourish ornament corner',
      '<path d="M12 70c20-40 48-48 70-28 16 14 18 36 40 28" fill="none" stroke="' + G + '" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M70 42c8-18 28-22 40-8" fill="none" stroke="' + G + '" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="118" cy="30" r="4" fill="' + G + '"/>'],
    ['medal', 150, 200, 'medal award ribbon',
      '<path fill="' + R + '" d="M48 8h18l9 52-9 8-9-8z"/>' +
      '<path fill="' + A + '" d="M84 8h18l-9 60-9-8z"/>' +
      '<circle cx="75" cy="118" r="52" fill="' + G + '"/>' +
      '<circle cx="75" cy="118" r="38" fill="' + C + '"/>' +
      '<path fill="' + G + '" d="' + starPath(75, 118, 18, 0.45, 5) + '"/>'],
    ['bookmark', 90, 170, 'bookmark ribbon',
      '<path fill="' + A + '" d="M12 8h66v154l-33-28-33 28z"/>' +
      '<path fill="' + C + '" opacity=".35" d="M12 8h16v154l-8-14z"/>'],
    ['washi', 250, 76, 'tape washi stripe',
      '<g transform="rotate(3 125 38)">' +
      '<rect x="8" y="18" width="234" height="40" fill="' + J + '" opacity=".9"/>' +
      '<path d="M8 28h234M8 38h234M8 48h234" fill="none" stroke="' + C + '" stroke-width="3" opacity=".55"/>' +
      '</g>']
  ];
  const icons = {};
  const search = {};
  items.forEach(function (item) {
    const body = sanitize(item[4]);
    if (!body) throw new Error('empty sticker ' + item[0]);
    icons[item[0]] = { body: body, width: item[1], height: item[2], tags: item[3] };
    indexIcon(search, item[0], item[3]);
  });
  return { prefix: 'stickers', width: 200, height: 200, icons: icons, aliases: {}, search: search };
}

function inject(file, start, end, content) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('marker missing in ' + file);
  fs.writeFileSync(file, src.slice(0, a + start.length) + content + src.slice(b));
}

function writeSet(name, data) {
  const file = path.join(DATA, name + '.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const size = fs.statSync(file).size;
  console.log(name, Object.keys(data.icons).length, 'icons', (size / 1024).toFixed(0) + 'KB');
  return size;
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  console.log('downloading icon sets');
  const lucideRaw = await fetchJson(SOURCES.lucide);
  const phRaw = await fetchJson(SOURCES.ph);
  const emojiRaw = await fetchJson(SOURCES.emoji);
  const emojiMeta = await fetchJson(SOURCES.emojiMeta);
  const lucide = buildLucide(lucideRaw);
  const phosphor = buildPhosphor(phRaw);
  const emoji = buildEmoji(emojiRaw, emojiMeta);
  const stickers = buildStickers();
  if (!lucide.icons.camera) throw new Error('lucide camera missing');
  if (!phosphor.icons.camera) throw new Error('phosphor camera missing');
  if (!emoji.icons.camera || !emoji.icons['red-heart'] || !emoji.icons['party-popper']) {
    throw new Error('emoji search fixtures missing');
  }
  writeSet('lucide', lucide);
  writeSet('phosphor', phosphor);
  writeSet('emoji', emoji);
  writeSet('stickers', stickers);
  const counts = {
    lucide: Object.keys(lucide.icons).length,
    phosphor: Object.keys(phosphor.icons).length,
    emoji: Object.keys(emoji.icons).length,
    stickers: Object.keys(stickers.icons).length
  };
  if (fs.existsSync(JS_PATH)) inject(JS_PATH, '/*COUNTS*/', '/*COUNTS_END*/', JSON.stringify(counts));
  const droppedKeys = Object.keys(dropped);
  if (droppedKeys.length) console.log('dropped attrs', droppedKeys.map(function (k) { return k + ':' + dropped[k]; }).join(' '));
  console.log('counts', JSON.stringify(counts));
}

const WI_ROOT = path.join(process.env.TEMP || '/tmp', 'le-withicons', 'node_modules', '@withicons');
const WI_ROLES = ['ink', 'c1', 'c2', 'c3', 'c4', 'tint', 'accent', 'shadow', 'shine', 'edge'];
const WI_GROUP = {
  line: 'essentials', solid: 'essentials', duo: 'essentials', suite: 'essentials',
  bauhaus: 'product', bento: 'product', dock: 'product', brutal: 'product',
  glass: '3d-glass', luxe: '3d-glass', skeuo: '3d-glass', clay: '3d-glass',
  liquid: '3d-glass', chrome: '3d-glass', 'soft-3d': '3d-glass',
  gloss: 'playful', kawaii: 'playful', sticker: 'playful', pixel: 'playful',
  retro: 'playful', pastel: 'playful', plush: 'playful',
  engrave: 'artistic', blueprint: 'artistic', sketch: 'artistic', anime: 'artistic',
  gothic: 'artistic', coquette: 'artistic',
  utsav: 'holidays', rangoli: 'holidays', halloween: 'holidays', christmas: 'holidays',
  'lunar-new-year': 'holidays', valentine: 'holidays'
};
const WI_BRAND = ['amethyst', 'champagne-gold', 'rose', 'sapphire', 'jade', 'copper', 'obsidian', 'pearl'];

function wiPublicId(name) {
  if (name === 'soft3d') return 'soft-3d';
  if (name === 'lunar') return 'lunar-new-year';
  return name;
}

function wiRound(body) {
  return String(body || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/-?\d+\.\d{3,}/g, function (n) {
      const v = Math.round(parseFloat(n) * 100) / 100;
      return Object.is(v, -0) ? '0' : String(v);
    });
}

function wiSvg(iconNode, style) {
  const esc = function (v) {
    return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  const attrs = function (obj) {
    return Object.keys(obj).filter(function (k) { return obj[k] != null && obj[k] !== false; }).map(function (k) {
      return ' ' + k + '="' + esc(obj[k]) + '"';
    }).join('');
  };
  const el = function (n) {
    return '<' + n[0] + attrs(n[1] || {}) + (n[2] && n[2].length ? '>' + n[2].map(el).join('') + '</' + n[0] + '>' : '/>');
  };
  const a = { fill: 'none' };
  const root = style.root || {};
  Object.keys(root).forEach(function (k) { a[k] = root[k]; });
  const body = (iconNode || []).map(el).join('');
  return { root: a, body: body };
}

const WI_BRAND_SETS = [
  { id: 'amethyst', name: 'Amethyst', colors: ['#2A2154', '#7457F0', '#A894F6', '#4E36C9', '#C8B8FF', '#E4DCFF', '#8B6CF6', '#1E1638', '#FFFFFF', '#D9CEFF'] },
  { id: 'champagne-gold', name: 'Champagne Gold', colors: ['#2A1F0A', '#E2B15A', '#F2D594', '#B9832F', '#F7E7C4', '#FBF3E0', '#E2B15A', '#3A2A10', '#FFFFFF', '#F2D594'] },
  { id: 'rose', name: 'Rose', colors: ['#3A1424', '#E0668E', '#F2A8C0', '#B53D68', '#F8D0DE', '#FDE8EF', '#E0668E', '#4A1830', '#FFFFFF', '#F6C3D4'] },
  { id: 'sapphire', name: 'Sapphire', colors: ['#0E1B4A', '#2F6BFF', '#8AADFF', '#1D4ED8', '#D6E2FF', '#E8EFFF', '#2F6BFF', '#0A1230', '#FFFFFF', '#C5D6FF'] },
  { id: 'jade', name: 'Jade', colors: ['#063528', '#17A37A', '#7DDCB8', '#0E7A5B', '#C8F3E4', '#E5FAF3', '#17A37A', '#04241C', '#FFFFFF', '#B7EBD8'] },
  { id: 'copper', name: 'Copper', colors: ['#3A1E0C', '#D07A45', '#E7B08A', '#A85A2C', '#F3D7C4', '#F8EBE1', '#D07A45', '#2A1408', '#FFFFFF', '#E8C4A8'] },
  { id: 'obsidian', name: 'Obsidian', colors: ['#110F17', '#2A1A3E', '#5C4A72', '#110F17', '#8A7A9E', '#D4CCE0', '#7457F0', '#07060C', '#F4F1EA', '#3A2A4E'] },
  { id: 'pearl', name: 'Pearl', colors: ['#3A342C', '#FBF8F3', '#E7E1D6', '#C9C0B2', '#FFFFFF', '#F7F2EA', '#E2B15A', '#8A8175', '#FFFFFF', '#E4DDD2'] }
];

function wiPalettes(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach(function (file) {
    if (!file.endsWith('.json') || file === 'index.json') return;
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const name = data.name || file.replace(/\.json$/, '');
    out[name] = (data.palettes || []).map(function (p) {
      const colors = p.colors || {};
      return [p.id, p.name, WI_ROLES.map(function (role) { return colors[role] || ''; }).join(',')];
    });
  });
  return out;
}

function wiCompactPalettes(raw) {
  const counts = {};
  const rows = [];
  Object.keys(raw).forEach(function (icon) {
    (raw[icon] || []).forEach(function (row) {
      const parts = String(row[2] || '').split(',');
      while (parts.length < WI_ROLES.length) parts.push('');
      const colors = parts.slice(0, WI_ROLES.length).map(function (c) {
        const hex = String(c || '').toUpperCase();
        return hex.charAt(0) === '#' ? hex.slice(1) : hex;
      });
      colors.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
      rows.push([icon, row[0], row[1], colors]);
    });
  });
  const hex = Object.keys(counts).sort(function (a, b) {
    return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0);
  });
  const hexAt = {};
  hex.forEach(function (c, i) { hexAt[c] = i; });
  const ids = [];
  const idAt = {};
  const names = [];
  const nameAt = {};
  const tuples = [];
  const tupleAt = {};
  function intern(list, at, value) {
    const key = String(value);
    if (at[key] == null) {
      at[key] = list.length;
      list.push(key);
    }
    return at[key];
  }
  const icons = {};
  rows.forEach(function (row) {
    const tuple = row[3].map(function (c) { return hexAt[c]; }).join(',');
    const rec = [intern(ids, idAt, row[1]), intern(names, nameAt, row[2]), intern(tuples, tupleAt, tuple)];
    (icons[row[0]] || (icons[row[0]] = [])).push(rec);
  });
  return { v: 3, roles: WI_ROLES, hex: hex.join(''), ids: ids, names: names, tuples: tuples, icons: icons };
}

async function buildWithicons() {
  const core = path.join(WI_ROOT, 'core');
  if (!fs.existsSync(path.join(core, 'dist', 'styles.json'))) {
    throw new Error('Install @withicons/core@0.6.0 into ' + WI_ROOT + ' first');
  }
  const styles = JSON.parse(fs.readFileSync(path.join(core, 'dist', 'styles.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(core, 'dist', 'icons.json'), 'utf8'));
  const outDir = path.join(DATA, 'withicons');
  fs.mkdirSync(outDir, { recursive: true });
  const licDir = path.join(ROOT, 'assets', 'vendor', 'licenses');
  fs.mkdirSync(licDir, { recursive: true });
  fs.copyFileSync(path.join(core, 'LICENSE'), path.join(licDir, 'withicons-LICENSE.txt'));

  const vocab = [];
  const vocabAt = {};
  function tokenId(token) {
    const t = String(token || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!t || (t.length < 2 && t !== 'x')) return -1;
    if (vocabAt[t] == null) {
      vocabAt[t] = vocab.length;
      vocab.push(t);
    }
    return vocabAt[t];
  }
  const names = [];
  const catIndex = [];
  const tagIds = [];
  const categories = [];
  const categoryAt = {};
  meta.forEach(function (icon) {
    names.push(icon.name);
    const category = icon.category || '';
    if (categoryAt[category] == null) {
      categoryAt[category] = categories.length;
      categories.push(category);
    }
    catIndex.push(categoryAt[category]);
    const set = [];
    function add(token) {
      const id = tokenId(token);
      if (id >= 0 && set.indexOf(id) < 0) set.push(id);
    }
    (icon.tags || []).forEach(add);
    (icon.aliases || []).forEach(add);
    icon.name.split('-').forEach(add);
    if (category) add(category);
    tagIds.push(set);
  });

  const wanted = process.env.WI_STYLES ? process.env.WI_STYLES.split(',') : null;
  const built = [];
  const previews = {};
  for (const style of styles) {
    const id = wiPublicId(style.name);
    if (wanted && wanted.indexOf(id) < 0 && wanted.indexOf(style.name) < 0) continue;
    const pkgDir = path.join(WI_ROOT, style.package.replace('@withicons/', ''));
    const nodeFile = path.join(pkgDir, 'dist', 'nodes', style.name + '.js');
    if (!fs.existsSync(nodeFile)) throw new Error('Missing nodes for ' + style.name + ' at ' + nodeFile);
    const mod = await import(pathToFileURL(nodeFile).href);
    const nodes = mod.nodes || mod.default;
    const packIcons = {};
    const iconNames = Object.keys(nodes);
    let sample = null;
    iconNames.forEach(function (name) {
      const rendered = wiSvg(nodes[name], style);
      let body = sanitize(rendered.body);
      body = wiRound(body);
      if (!body) throw new Error('empty ' + id + '/' + name);
      packIcons[name] = body;
      const preferred = name === 'heart' && body.length <= 4500;
      if (!sample || preferred || (!sample.preferred && body.length < sample.body.length)) {
        sample = { name: name, body: body, preferred: preferred };
      }
    });
    previews[id] = { name: sample.name, root: style.root || {}, body: sample.body };
    const pack = {
      prefix: 'withicons',
      style: id,
      width: 24,
      height: 24,
      root: style.root || {},
      icons: packIcons
    };
    const file = path.join(outDir, id + '.json');
    fs.writeFileSync(file, JSON.stringify(pack));
    const bytes = fs.statSync(file).size;
    const colorful = !!style.palette;
    built.push({
      id: id,
      name: style.title || id,
      group: WI_GROUP[id] || 'essentials',
      description: style.description || '',
      colorful: colorful,
      count: iconNames.length,
      bytes: bytes,
      palettes: colorful ? ['default'].concat(WI_BRAND) : WI_BRAND.slice(),
      suggested: colorful ? [{ id: 'default', name: (style.title || id) + ' default', colors: Object.keys(style.vars || {}).map(function (k) { return style.vars[k]; }) }] : [],
      defaultPalette: colorful ? 'default' : null,
      vars: style.vars || {},
      strokeWidth: style.strokeWidth === false ? null : style.strokeWidth
    });
    console.log('withicons', id, iconNames.length, (bytes / 1048576).toFixed(2) + 'MB');
    if (!packIcons.bike || !packIcons.heart || !packIcons.settings) {
      throw new Error(id + ' is missing bike, heart, or settings');
    }
  }

  const palettes = wiCompactPalettes(wiPalettes(path.join(core, 'dist', 'palettes')));
  const paletteFile = path.join(outDir, 'palettes.json');
  fs.writeFileSync(paletteFile, JSON.stringify(palettes));
  const index = {
    v: 1,
    prefix: 'withicons',
    version: '0.6.0',
    width: 24,
    height: 24,
    roles: WI_ROLES,
    count: names.length,
    categories: categories,
    vocab: vocab,
    names: names,
    cat: catIndex,
    tags: tagIds,
    styles: built,
    brand: WI_BRAND_SETS,
    paletteBytes: fs.statSync(paletteFile).size
  };
  const indexFile = path.join(outDir, 'index.json');
  fs.writeFileSync(indexFile, JSON.stringify(index));
  const previewFile = path.join(outDir, 'previews.json');
  fs.writeFileSync(previewFile, JSON.stringify({ width: 24, height: 24, styles: previews }));
  const zlib = require('zlib');
  function report(label, file) {
    const buf = fs.readFileSync(file);
    const gz = zlib.gzipSync(buf).length;
    console.log(label, (buf.length / 1024).toFixed(1) + 'KB', 'gzip', (gz / 1024).toFixed(1) + 'KB');
  }
  report('withicons index', indexFile);
  report('withicons palettes', paletteFile);
  report('withicons previews', previewFile);
  if (fs.statSync(indexFile).size > 250 * 1024) throw new Error('withicons index is over 250KB');
  ['line', 'glass', 'clay', 'gothic'].forEach(function (id) {
    report('withicons ' + id, path.join(outDir, id + '.json'));
  });
  if (fs.statSync(previewFile).size > 150 * 1024) throw new Error('withicons previews are over 150KB');
  const droppedKeys = Object.keys(dropped);
  if (droppedKeys.length) console.log('dropped attrs', droppedKeys.map(function (k) { return k + ':' + dropped[k]; }).join(' '));
}

async function rewritePalettes() {
  const core = path.join(WI_ROOT, 'core');
  const outDir = path.join(DATA, 'withicons');
  const palettes = wiCompactPalettes(wiPalettes(path.join(core, 'dist', 'palettes')));
  const paletteFile = path.join(outDir, 'palettes.json');
  fs.writeFileSync(paletteFile, JSON.stringify(palettes));
  const indexFile = path.join(outDir, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  delete index.palettes;
  index.brand = WI_BRAND_SETS;
  index.paletteBytes = fs.statSync(paletteFile).size;
  fs.writeFileSync(indexFile, JSON.stringify(index));
  const zlib = require('zlib');
  function report(label, file) {
    const buf = fs.readFileSync(file);
    console.log(label, (buf.length / 1024).toFixed(1) + 'KB', 'gzip', (zlib.gzipSync(buf).length / 1024).toFixed(1) + 'KB');
  }
  report('withicons index', indexFile);
  report('withicons palettes', paletteFile);
  report('withicons previews', path.join(outDir, 'previews.json'));
  if (fs.statSync(indexFile).size > 250 * 1024) throw new Error('withicons index is over 250KB');
}

async function run() {
  if (process.argv.indexOf('--palettes-only') >= 0) {
    await rewritePalettes();
    return;
  }
  if (process.argv.indexOf('--withicons-only') < 0) await main();
  await buildWithicons();
}

run().catch(function (err) {
  console.error(err);
  process.exit(1);
});
