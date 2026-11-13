/* LocalEditor: brand file (brand.lebrand.json). Colours with roles, fonts by role, logos, spacing, tone and do / don't
   notes as plain data: read (validate + normalise), lint a design against it with fixes an agent can apply, and convert
   to and from the studio's Brand kit. No DOM in the core, so the command line loads the same file. docs/FORMAT-BRAND.md */
(function (root) {
  'use strict';
  var FORMAT = 'localeditor-brand';
  var VERSION = 1;
  var SCHEMA_URL = 'https://localeditor.net/schema/brand-1.json';
  var LIMITS = { json: 2 * 1024 * 1024, colors: 40, logos: 8, logoChars: 350000, notes: 20, note: 300, tone: 12 };
  var ROLES = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'success', 'warning', 'danger'];
  var FONT_ROLES = ['heading', 'subheading', 'body', 'accent'];
  var BAD_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
  var DANGER = /<\s*\/?\s*[a-z!]|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;
  var LOGO_DATA = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
  var REL_PATH = /^(?![\/\\])(?!.*(?:^|[\/\\])\.\.(?:[\/\\]|$))[^\u0000-\u001f:*?"<>|\\]{1,200}$/;
  var TOP = ['$schema', 'format', 'version', 'name', 'colors', 'colours', 'fonts', 'logos', 'spacing', 'tone', 'do', 'dont', 'rules'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function plain(s, max) { return String(s == null ? '' : s).replace(/[<>]/g, '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
  function ptr(base, key) { return base + '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1'); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24); }

  /* ---------- colour ---------- */
  function rgbOf(c) {
    if (typeof c !== 'string') return null;
    var s = c.trim().toLowerCase(), m;
    if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(function (x) { return x + x; }).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,\/]+([\d.]+%?))?\s*\)$/.exec(s))) {
      var a = m[4] == null ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: clamp(Math.round(+m[1]), 0, 255), g: clamp(Math.round(+m[2]), 0, 255), b: clamp(Math.round(+m[3]), 0, 255), a: clamp(a, 0, 1) };
    }
    if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
    if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
    return null;
  }
  function hexOf(rgb) { return '#' + [rgb.r, rgb.g, rgb.b].map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase(); }
  function hex6(c) { var r = rgbOf(c); return r ? hexOf(r) : null; }
  function lum(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function dist(a, b) { var dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b; return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db); }

  /* ---------- read ---------- */
  function scan(v, path, errs, depth) {
    if (depth > 8) { errs.push({ path: path, message: 'The brand file is nested too deeply.' }); return; }
    if (typeof v === 'string') {
      if (!/\/src$/.test(path) && DANGER.test(v)) errs.push({ path: path, message: 'Text cannot contain HTML, script or javascript: links.' });
      return;
    }
    if (Array.isArray(v)) { for (var i = 0; i < v.length && i < 200; i++) scan(v[i], path + '/' + i, errs, depth + 1); return; }
    if (v && typeof v === 'object') Object.keys(v).forEach(function (k) {
      if (BAD_KEYS[k]) { errs.push({ path: ptr(path, k), message: 'Keys named __proto__, constructor or prototype are not allowed.' }); return; }
      scan(v[k], ptr(path, k), errs, depth + 1);
    });
  }
  function notes(v, path, errs, max, len) {
    if (v == null) return [];
    if (typeof v === 'string') v = [v];
    if (!Array.isArray(v)) { errs.push({ path: path, message: 'This is a list of short lines of text.' }); return []; }
    return v.slice(0, max).map(function (s) { return plain(s, len); }).filter(Boolean);
  }
  /* read(input, base?) → { ok, brand, errors: [{ path, message }], warnings: [{ path, kind, message }] }.
     input: JSON text or an object. base: a JSON-pointer prefix for the paths ("/brand" for an inline block). */
  function read(input, base) {
    base = base || '';
    var errors = [], warnings = [];
    var fail = function (path, message) { if (errors.length < 100) errors.push({ path: base + path, message: message }); };
    var warn = function (path, kind, message) { if (warnings.length < 100) warnings.push({ path: base + path, kind: kind, message: message }); };
    var done = function (brand) { return { ok: !errors.length, brand: errors.length ? null : brand, errors: errors, warnings: warnings }; };
    var raw = input;
    if (typeof raw === 'string') {
      if (raw.length > LIMITS.json) { fail('', 'This brand file is larger than 2 MB. Use smaller logos or logo paths.'); return done(); }
      try { raw = JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { fail('', 'This is not valid JSON: ' + String(e.message || '').slice(0, 160)); return done(); }
    } else { try { raw = JSON.parse(JSON.stringify(raw)); } catch (e2) { raw = null; } }
    if (!isObj(raw)) { fail('', 'A brand file is one JSON object with "format": "localeditor-brand".'); return done(); }
    var se = []; scan(raw, '', se, 0);
    if (se.length) { se.slice(0, 20).forEach(function (e) { fail(e.path, e.message); }); return done(); }
    if (raw.format != null && raw.format !== FORMAT) { fail('/format', '"format" must be "localeditor-brand".'); return done(); }
    if (raw.format == null && !base) { fail('/format', 'Add "format": "localeditor-brand".'); return done(); }
    if (raw.version != null && Number(raw.version) > VERSION) { fail('/version', 'This brand file needs a newer LocalEditor (version ' + plain(raw.version, 8) + ').'); return done(); }
    Object.keys(raw).forEach(function (k) { if (TOP.indexOf(k) < 0) warn(ptr('', k), 'unknown-key', 'The key "' + plain(k, 40) + '" is not part of the brand format and was ignored.'); });

    var brand = { $schema: SCHEMA_URL, format: FORMAT, version: VERSION, name: plain(raw.name, 80) || 'Brand' };

    /* colours: [ { role, value, name? } ] or the short form { "primary": "#14213D", … } */
    var cin = raw.colors != null ? raw.colors : raw.colours;
    var ckey = raw.colors != null ? '/colors' : '/colours';
    var list = [];
    if (isObj(cin)) list = Object.keys(cin).map(function (k) { return { role: k, value: cin[k], _p: ptr(ckey, k) }; });
    else if (Array.isArray(cin)) list = cin.map(function (c, i) { return isObj(c) ? Object.assign({}, c, { _p: ckey + '/' + i }) : { value: c, _p: ckey + '/' + i }; });
    else if (cin != null) fail(ckey, 'colors is a list of { "role", "value" } or an object of role: colour.');
    if (list.length > LIMITS.colors) fail(ckey, 'A brand can have up to ' + LIMITS.colors + ' colours.');
    var seen = {};
    brand.colors = [];
    list.slice(0, LIMITS.colors).forEach(function (c, i) {
      var v = c.value != null ? c.value : (c.color != null ? c.color : c.hex);
      var rgb = rgbOf(v);
      if (!rgb || rgb.a < 1) { fail(c._p + (isObj(cin) ? '' : '/value'), 'A brand colour is a solid colour such as "#14213D".'); return; }
      var role = slug(c.role) || 'colour-' + (i + 1);
      var n = 2, r0 = role;
      while (seen[role]) role = r0.slice(0, 21) + '-' + (n++);
      seen[role] = 1;
      var o = { role: role, value: hexOf(rgb) };
      if (c.name != null && plain(c.name, 40)) o.name = plain(c.name, 40);
      brand.colors.push(o);
    });

    /* fonts: { heading: "Anton" | { family, weight }, body: … } */
    brand.fonts = {};
    if (raw.fonts != null && !isObj(raw.fonts)) fail('/fonts', 'fonts is an object: { "heading": { "family", "weight" }, "body": … }.');
    else if (raw.fonts) Object.keys(raw.fonts).forEach(function (role) {
      var p = ptr('/fonts', role), f = raw.fonts[role];
      if (FONT_ROLES.indexOf(role) < 0) { warn(p, 'unknown-key', 'Font roles are ' + FONT_ROLES.join(', ') + '; "' + plain(role, 24) + '" was ignored.'); return; }
      if (typeof f === 'string') f = { family: f };
      if (!isObj(f) || typeof f.family !== 'string' || !plain(f.family, 80)) { fail(p, 'A brand font is a family name from the font list, or { "family", "weight" }.'); return; }
      var o = { family: plain(f.family, 80) };
      if (f.weight != null) { if (!isNum(Number(f.weight))) fail(p + '/weight', 'weight is a number from 100 to 900.'); else o.weight = clamp(Math.round(Number(f.weight) / 100) * 100, 100, 900); }
      var lib = root.LE && root.LE.fonts;
      var known = true;
      try { if (lib && typeof lib.list === 'function') known = lib.list().some(function (x) { return x.family.toLowerCase() === o.family.toLowerCase(); }); } catch (e3) { known = true; }
      if (!known) warn(p + '/family', 'unknown-font', 'The font "' + o.family + '" does not ship with LocalEditor; pick one from the font list.');
      brand.fonts[role] = o;
    });

    /* logos: [ { id, src (relative path or embedded data:image), name?, on?, clearSpace?, minWidth? } ] */
    brand.logos = [];
    if (raw.logos != null && !Array.isArray(raw.logos)) fail('/logos', 'logos is a list of { "id", "src" }.');
    else (raw.logos || []).slice(0, LIMITS.logos).forEach(function (l, i) {
      var p = '/logos/' + i;
      if (typeof l === 'string') l = { src: l };
      if (!isObj(l) || typeof l.src !== 'string') { fail(p, 'A logo is { "id", "src" }: a path next to the brand file or an embedded data:image.'); return; }
      if (/^data:/i.test(l.src)) {
        if (l.src.length > LIMITS.logoChars) { fail(p + '/src', 'An embedded logo can be up to 256 KB. Save it next to the brand file and use its path.'); return; }
        if (!LOGO_DATA.test(l.src)) { fail(p + '/src', 'An embedded logo is a PNG, JPG, WebP or GIF data:image (base64).'); return; }
      } else if (!REL_PATH.test(l.src) || /^[a-z][a-z0-9+.-]*:/i.test(l.src)) { fail(p + '/src', 'A logo path is relative to the brand file (for example "assets/logo.png"), with no ".." and no web address.'); return; }
      var o = { id: slug(l.id) || 'logo' + (i ? '-' + (i + 1) : ''), src: l.src };
      if (l.name != null && plain(l.name, 60)) o.name = plain(l.name, 60);
      if (l.on != null) { if (['light', 'dark', 'any'].indexOf(l.on) < 0) fail(p + '/on', 'on is "light", "dark" or "any".'); else o.on = l.on; }
      if (l.clearSpace != null) { if (!isNum(l.clearSpace) || l.clearSpace < 0 || l.clearSpace > 2) fail(p + '/clearSpace', 'clearSpace is a share of the logo’s shorter side, from 0 to 2 (0.25 is a quarter).'); else o.clearSpace = l.clearSpace; }
      if (l.minWidth != null) { if (!isNum(l.minWidth) || l.minWidth < 0 || l.minWidth > 20000) fail(p + '/minWidth', 'minWidth is a number of pixels.'); else o.minWidth = l.minWidth; }
      brand.logos.push(o);
    });
    if (Array.isArray(raw.logos) && raw.logos.length > LIMITS.logos) fail('/logos', 'A brand can have up to ' + LIMITS.logos + ' logos.');

    if (raw.spacing != null) {
      if (!isObj(raw.spacing)) fail('/spacing', 'spacing is { "unit", "margin", "gap", "radius" } in pixels.');
      else {
        var sp = {};
        ['unit', 'margin', 'gap', 'radius'].forEach(function (k) {
          if (raw.spacing[k] == null) return;
          if (!isNum(raw.spacing[k]) || raw.spacing[k] < 0 || raw.spacing[k] > 4000) fail('/spacing/' + k, k + ' is a number of pixels.'); else sp[k] = raw.spacing[k];
        });
        if (Object.keys(sp).length) brand.spacing = sp;
      }
    }
    var tone = notes(raw.tone, '/tone', errors, LIMITS.tone, 40); if (tone.length) brand.tone = tone;
    var dos = notes(raw.do, '/do', errors, LIMITS.notes, LIMITS.note); if (dos.length) brand.do = dos;
    var donts = notes(raw.dont, '/dont', errors, LIMITS.notes, LIMITS.note); if (donts.length) brand.dont = donts;
    if (raw.rules != null) {
      if (!isObj(raw.rules)) fail('/rules', 'rules is { "neutrals": true, "contrast": 4.5 }.');
      else {
        var ru = {};
        if (raw.rules.neutrals != null) ru.neutrals = raw.rules.neutrals !== false;
        if (raw.rules.contrast != null) { if (!isNum(raw.rules.contrast) || raw.rules.contrast < 1 || raw.rules.contrast > 21) fail('/rules/contrast', 'contrast is a ratio from 1 to 21 (4.5 is the usual minimum for body text).'); else ru.contrast = raw.rules.contrast; }
        if (Object.keys(ru).length) brand.rules = ru;
      }
    }
    if (!brand.colors.length && !Object.keys(brand.fonts).length && !brand.logos.length && !errors.length) warn('', 'empty-brand', 'This brand has no colours, fonts or logos yet.');
    return done(brand);
  }
  function stringify(brand) { return JSON.stringify(brand, null, 2) + '\n'; }

  /* ---------- lint ---------- */
  function aabb(l) {
    var r = (l.rotation || 0) * Math.PI / 180;
    if (!r) return { x: l.x, y: l.y, w: l.w, h: l.h };
    var c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    var w = l.w * c + l.h * s, h = l.w * s + l.h * c;
    return { x: l.x + l.w / 2 - w / 2, y: l.y + l.h / 2 - h / 2, w: w, h: h };
  }
  function hit(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function inside(a, b) { return b.x <= a.x + 0.5 && b.y <= a.y + 0.5 && b.x + b.w >= a.x + a.w - 0.5 && b.y + b.h >= a.y + a.h - 0.5; }
  function shown(l) { return l && l.visible !== false && l.type !== 'group'; }
  /* The solid colour behind a text box, when it can be told without drawing: its highlight, a rectangle that covers
     it, or the page colour with nothing in between. */
  function backdrop(page, index, box) {
    for (var i = index - 1; i >= 0; i--) {
      var l = page.layers[i];
      if (!shown(l) || !hit(aabb(l), box)) continue;
      if (l.type === 'shape' && l.fill && l.fill.type === 'none') continue;
      if (l.type === 'shape' && !l.rotation && inside(box, aabb(l)) && l.fill && l.fill.type === 'solid' && /^(rectangle|rounded-rectangle|rect)$/.test(l.shape || '') && !(l.opacity < 1)) return rgbOf(l.fill.color);
      return null;
    }
    var bg = page.background || {};
    return bg.type === 'color' && !bg.spec ? rgbOf(bg.color || '#ffffff') : null;
  }
  function brandOf(v) {
    if (!isObj(v)) return null;
    if (isObj(v.data)) return v.data;
    return Array.isArray(v.colors) || isObj(v.fonts) || Array.isArray(v.logos) ? v : null;
  }
  /* lint(project, brand, { report? }) → warnings [{ path, kind, message, layer?, fix? }].
     project: the parsed design (LE.design.parse(...).project). brand: a brand from read(), or the design's own
     meta.studio.brand. fix: one operation in the apply vocabulary ({ "op": "update", "id", "set" }) that settles it.
     Kinds: brand-color, brand-font, brand-contrast, brand-logo-space, brand-logo-size. */
  function lint(project, brandIn, opts) {
    opts = opts || {};
    var brand = brandOf(brandIn);
    var out = [];
    if (!brand || !project || !Array.isArray(project.pages)) return out;
    var rules = brand.rules || {};
    var pal = (brand.colors || []).map(function (c) { return { role: c.role, value: c.value, rgb: rgbOf(c.value) }; }).filter(function (c) { return c.rgb; });
    var neutral = rules.neutrals !== false;
    var fonts = brand.fonts || {};
    var families = Object.keys(fonts).map(function (k) { return fonts[k].family.toLowerCase(); });
    var push = function (path, kind, message, layer, fix) {
      var w = { path: path, kind: kind, message: message };
      if (layer) w.layer = layer;
      if (fix) w.fix = fix;
      out.push(w);
    };
    var match = function (rgb) {
      for (var i = 0; i < pal.length; i++) if (Math.abs(pal[i].rgb.r - rgb.r) <= 3 && Math.abs(pal[i].rgb.g - rgb.g) <= 3 && Math.abs(pal[i].rgb.b - rgb.b) <= 3) return pal[i];
      return null;
    };
    var isNeutral = function (rgb) { return neutral && ((rgb.r === 0 && rgb.g === 0 && rgb.b === 0) || (rgb.r === 255 && rgb.g === 255 && rgb.b === 255)); };
    var nearest = function (rgb) { return pal.slice().sort(function (a, b) { return dist(a.rgb, rgb) - dist(b.rgb, rgb); })[0]; };
    var say = function (c) { return '"' + c.role + '" (' + c.value + ')'; };
    /* colour(value, where, what, layer, make) — make(hex) builds the fix for the nearest brand colour */
    var colour = function (v, path, what, layer, make) {
      var rgb = rgbOf(v);
      if (!pal.length || !rgb || rgb.a < 0.05 || match(rgb) || isNeutral(rgb)) return;
      var n = nearest(rgb);
      push(path, 'brand-color', what + ' uses ' + hexOf(rgb) + ', which is not a brand colour. The nearest is ' + say(n) + '.', layer, make(n.value));
    };

    project.pages.forEach(function (page, pi) {
      var W = page.width, H = page.height;
      var base = '/pages/' + pi;
      var bg = page.background || {};
      if (bg.type === 'color' && !bg.spec && bg.color) colour(bg.color, base + '/background', 'The page background', null, function (hx) { return { op: 'page.background', page: pi, background: hx }; });
      var layers = page.layers || [];
      layers.forEach(function (l, li) {
        if (!shown(l)) return;
        var path = base + '/layers/' + li;
        var label = '“' + String(l.name && l.name !== l.id ? l.name : l.id).slice(0, 40) + '”';
        var upd = function (set) { return { op: 'update', id: l.id, set: set }; };
        var bound = l.bind && l.bind.color;
        if (l.type === 'text') {
          var solid = l.fill && l.fill.type === 'solid';
          if (!bound) {
            if (solid) colour(l.fill.color, path + '/fill', 'Text ' + label, l.id, function (hx) { return upd({ fill: hx }); });
            else if (!l.fill || l.fill.type === 'none' || !l.fill.type) colour(l.color || '#17131F', path + '/color', 'Text ' + label, l.id, function (hx) { return upd({ color: hx }); });
          }
          if (l.stroke && l.stroke.width > 0) colour(l.stroke.color, path + '/stroke/color', 'The outline of ' + label, l.id, function (hx) { return upd({ stroke: { width: l.stroke.width, color: hx } }); });
          if (l.background && l.background.color) colour(l.background.color, path + '/background/color', 'The highlight behind ' + label, l.id, function (hx) { return upd({ background: Object.assign({}, l.background, { color: hx }) }); });
          var fam = String(l.font || 'Plus Jakarta Sans');
          if (families.length && families.indexOf(fam.toLowerCase()) < 0) {
            var big = (l.size || 48) >= 48;
            var want = (big ? fonts.heading || fonts.subheading : fonts.body) || fonts.body || fonts.heading || fonts[Object.keys(fonts)[0]];
            var set = { font: want.family };
            if (want.weight) set.weight = want.weight;
            push(path + '/font', 'brand-font', 'Text ' + label + ' uses "' + fam + '", which is not a brand font. Use "' + want.family + '" (' + (big ? 'headings' : 'body text') + '), then check that the text still fits.', l.id, upd(set));
          }
          /* contrast against a brand colour behind the text */
          var fg = rgbOf(solid ? l.fill.color : l.color || '#17131F');
          var bb = aabb(l);
          var under = l.background && l.background.color ? rgbOf(l.background.color) : backdrop(page, li, bb);
          var on = under && under.a > 0.95 ? match(under) : null;
          if (fg && on && fg.a > 0.6 && (solid || !l.fill || l.fill.type === 'none' || !l.fill.type)) {
            var need = rules.contrast ? ((l.size || 48) >= 24 ? Math.min(rules.contrast, Math.max(3, rules.contrast * 2 / 3)) : rules.contrast) : ((l.size || 48) >= 24 ? 3 : 4.5);
            var ratio = contrast(fg, on.rgb);
            if (ratio < need) {
              var ranked = pal.filter(function (c) { return contrast(c.rgb, on.rgb) >= need; }).sort(function (a, b) { return (b.role === 'text') - (a.role === 'text') || contrast(b.rgb, on.rgb) - contrast(a.rgb, on.rgb); });
              var best = ranked[0];
              var r1 = Math.round(ratio * 10) / 10;
              if (best) push(path, 'brand-contrast', 'Text ' + label + ' is hard to read on the brand colour ' + say(on) + ' (' + r1 + ':1; aim for ' + need + ':1). The brand colour ' + say(best) + ' gives ' + (Math.round(contrast(best.rgb, on.rgb) * 10) / 10) + ':1.', l.id, bound ? null : upd(solid ? { fill: best.value } : { color: best.value }));
              else push(path, 'brand-contrast', 'Text ' + label + ' is hard to read on the brand colour ' + say(on) + ' (' + r1 + ':1; aim for ' + need + ':1), and no brand colour reaches that on it. Put the text on another brand colour.', l.id);
            }
          }
        } else if (l.type === 'shape') {
          if (l.fill && l.fill.type === 'solid') colour(l.fill.color, path + '/fill', 'Shape ' + label, l.id, function (hx) { return upd({ fill: hx }); });
          if (l.stroke && l.stroke.width > 0) colour(l.stroke.color, path + '/stroke/color', 'The outline of ' + label, l.id, function (hx) { return upd({ stroke: Object.assign({}, l.stroke, { color: hx }) }); });
        } else if ((l.type === 'path' || l.type === 'icon' || l.type === 'svg') && l.color && !bound) {
          colour(l.color, path + '/color', (l.type === 'path' ? 'The line ' : 'The graphic ') + label, l.id, function (hx) { return upd({ color: hx }); });
        }
        /* logos: a picture layer whose id or name says "logo" (or is a brand logo's id) */
        var logos = brand.logos || [];
        if (logos.length && (l.type === 'image' || l.type === 'svg' || l.type === 'icon')) {
          var tag = (String(l.id) + ' ' + String(l.name || '')).toLowerCase();
          var def = logos.filter(function (g) { return String(l.id).toLowerCase() === g.id || String(l.id).toLowerCase() === 'logo-' + g.id; })[0] || (/(^|[^a-z])logo([^a-z]|$)/.test(tag) ? logos[0] : null);
          if (def) {
            var box = aabb(l);
            if (def.minWidth && l.w < def.minWidth - 0.5) {
              var k = def.minWidth / l.w;
              push(path + '/w', 'brand-logo-size', 'The logo ' + label + ' is ' + Math.round(l.w) + ' px wide; the brand asks for at least ' + def.minWidth + ' px.', l.id, upd({ w: def.minWidth, h: Math.round(l.h * k * 100) / 100 }));
              box = { x: box.x, y: box.y, w: box.w * k, h: box.h * k };   /* clear space is judged at the size the fix gives */
            }
            if (def.clearSpace) {
              var pad = Math.round(def.clearSpace * Math.min(box.w, box.h) * 100) / 100;
              var zone = { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
              if (zone.x < -0.5 || zone.y < -0.5 || zone.x + zone.w > W + 0.5 || zone.y + zone.h > H + 0.5) {
                var nx = clamp(box.x, pad, Math.max(pad, W - pad - box.w)), ny = clamp(box.y, pad, Math.max(pad, H - pad - box.h));
                push(path, 'brand-logo-space', 'The logo ' + label + ' is closer than ' + Math.round(pad) + ' px to the edge of the page; the brand asks for that much clear space.', l.id,
                  upd({ x: Math.round((l.x + nx - box.x) * 100) / 100, y: Math.round((l.y + ny - box.y) * 100) / 100 }));
              }
              var near = layers.filter(function (o, oi) { if (oi === li || !shown(o)) return false; var ob = aabb(o); return hit(ob, zone) && !inside(box, ob); }).map(function (o) { return o.id; });
              if (near.length) push(path, 'brand-logo-space', 'The logo ' + label + ' needs ' + Math.round(pad) + ' px of clear space; ' + near.slice(0, 4).map(function (id) { return '“' + id + '”'; }).join(', ') + (near.length > 4 ? ' and ' + (near.length - 4) + ' more' : '') + (near.length > 1 ? ' are' : ' is') + ' inside it. Move ' + (near.length > 1 ? 'them' : 'it') + ' away or make the logo smaller.', l.id);
            }
          }
        }
      });
    });
    if (opts.report && Array.isArray(opts.report.warnings)) out.forEach(function (w) { if (opts.report.warnings.length < 300) opts.report.warnings.push(w); });
    return out;
  }
  /* fixes(warnings) → one operation list for apply; updates to the same layer are merged. */
  function fixes(warnings) {
    var ops = [], byId = {};
    (warnings || []).forEach(function (w) {
      var f = w && w.fix;
      if (!isObj(f)) return;
      if (f.op === 'update' && f.id != null) {
        if (!byId[f.id]) { byId[f.id] = { op: 'update', id: f.id, set: {} }; ops.push(byId[f.id]); }
        Object.keys(f.set || {}).forEach(function (k) { if (byId[f.id].set[k] === undefined) byId[f.id].set[k] = f.set[k]; });
      } else ops.push(JSON.parse(JSON.stringify(f)));
    });
    return ops;
  }
  /* A short text an agent can read before designing: roles, fonts, tone and the do / don't lines. */
  function summary(brand) {
    brand = brandOf(brand);
    if (!brand) return '';
    var out = ['Brand: ' + brand.name];
    if ((brand.colors || []).length) out.push('Colours: ' + brand.colors.map(function (c) { return c.role + ' ' + c.value + (c.name ? ' (' + c.name + ')' : ''); }).join(', '));
    var f = brand.fonts || {};
    if (Object.keys(f).length) out.push('Fonts: ' + Object.keys(f).map(function (k) { return k + ' ' + f[k].family + (f[k].weight ? ' ' + f[k].weight : ''); }).join(', '));
    if ((brand.logos || []).length) out.push('Logos: ' + brand.logos.map(function (l) { return l.id + (/^data:/.test(l.src) ? ' (embedded)' : ' ' + l.src) + (l.clearSpace ? ', clear space ' + l.clearSpace : '') + (l.minWidth ? ', at least ' + l.minWidth + ' px wide' : ''); }).join('; '));
    if (brand.spacing) out.push('Spacing: ' + Object.keys(brand.spacing).map(function (k) { return k + ' ' + brand.spacing[k] + ' px'; }).join(', '));
    if (brand.tone) out.push('Tone: ' + brand.tone.join(', '));
    if (brand.do) out.push('Do: ' + brand.do.join(' | '));
    if (brand.dont) out.push('Don’t: ' + brand.dont.join(' | '));
    return out.join('\n');
  }

  /* ---------- the studio's Brand kit ---------- */
  /* toKit(brand, kit?) → { name, colors: ["#rrggbb"], fonts: [{ family, weight, role }], logos } (logos are kept from kit). */
  function toKit(brand, kit) {
    kit = kit || {};
    var kf = [];
    ['heading', 'subheading', 'body'].forEach(function (role) { var f = (brand.fonts || {})[role]; if (f) kf.push({ family: f.family, weight: f.weight || (role === 'body' ? 400 : 700), role: role }); });
    return { name: brand.name || kit.name || 'Brand kit', colors: (brand.colors || []).map(function (c) { return c.value.toLowerCase(); }), fonts: kf, logos: (kit.logos || []).slice() };
  }
  /* fromKit(kit, previous?) → a brand. Kit colours have no roles: roles come from a previous brand with the same
     colour, else the lightest is "background", the darkest "text", then "primary", "accent", "colour-n". */
  function fromKit(kit, prev) {
    kit = kit || {};
    prev = brandOf(prev) || {};
    var roleOf = {};
    (prev.colors || []).forEach(function (c) { roleOf[c.value.toLowerCase()] = c; });
    var cols = (kit.colors || []).map(function (c) { return { value: hex6(c) }; }).filter(function (c) { return c.value; });
    var used = {};
    cols.forEach(function (c) { var p = roleOf[c.value.toLowerCase()]; if (p && !used[p.role]) { c.role = p.role; if (p.name) c.name = p.name; used[p.role] = 1; } });
    var free = cols.filter(function (c) { return !c.role; });
    var take = function (role, pick) { if (used[role] || !free.length) return; var c = pick(free); c.role = role; used[role] = 1; free.splice(free.indexOf(c), 1); };
    var byLum = function (dir) { return function (l) { return l.slice().sort(function (a, b) { return dir * (lum(rgbOf(a.value)) - lum(rgbOf(b.value))); })[0]; }; };
    var first = function (l) { return l[0]; };
    if (free.length > 2) { take('background', byLum(-1)); take('text', byLum(1)); }
    take('primary', first); take('accent', first);
    var n = 1;
    free.slice().forEach(function (c) { while (used['colour-' + n]) n++; c.role = 'colour-' + n; used[c.role] = 1; });
    var fonts = {};
    (kit.fonts || []).forEach(function (f) { if (f && f.family && !fonts[f.role || 'body']) fonts[f.role || 'body'] = { family: f.family, weight: f.weight || 400 }; });
    var b = { $schema: SCHEMA_URL, format: FORMAT, version: VERSION, name: kit.name && kit.name !== 'Brand kit' ? kit.name : (prev.name || 'Brand'), colors: cols, fonts: fonts, logos: [] };
    ['spacing', 'tone', 'do', 'dont', 'rules'].forEach(function (k) { if (prev[k] != null) b[k] = JSON.parse(JSON.stringify(prev[k])); });
    return b;
  }

  /* ---------- studio: import and export from the Brand kit panel (c is the studio context) ---------- */
  var LAST = 'le-brand-last';   /* this tab only: keeps roles, tone and notes between an import and an export */
  function lastBrand() { try { var r = read(root.sessionStorage.getItem(LAST) || 'null'); return r.ok ? r.brand : null; } catch (e) { return null; } }
  function dataBlob(uri) {
    var m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(uri);
    var bin = root.atob(m[2]), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new root.Blob([u], { type: m[1] });
  }
  function blobData(blob) {
    return new Promise(function (resolve, reject) { var fr = new root.FileReader(); fr.onload = function () { resolve(String(fr.result)); }; fr.onerror = function () { reject(fr.error); }; fr.readAsDataURL(blob); });
  }
  /* importFile(c, file, kit) → Promise<{ kit, brand, skipped }>: the kit to save. Embedded logos are added to the kit;
     logos given as paths cannot be read from a browser and are counted in skipped. */
  function importFile(c, file, kit) {
    return file.text().then(function (text) {
      var r = read(text);
      if (!r.ok) { var e = new Error(r.errors[0].message); e.errors = r.errors; throw e; }
      var next = toKit(r.brand, kit);
      var lean = JSON.parse(JSON.stringify(r.brand));
      lean.logos = lean.logos.filter(function (l) { return !/^data:/.test(l.src); });
      try { root.sessionStorage.setItem(LAST, JSON.stringify(lean)); } catch (e2) { /* private mode: roles are guessed on export */ }
      var embedded = r.brand.logos.filter(function (l) { return /^data:/.test(l.src); });
      var skipped = r.brand.logos.length - embedded.length;
      return embedded.reduce(function (chain, l) {
        return chain.then(function () {
          if (next.logos.length >= 12) { skipped++; return null; }
          var b = dataBlob(l.src);
          return c.ingest(new root.File([b], (l.name || l.id || 'logo') + '.' + b.type.split('/')[1].replace('jpeg', 'jpg'), { type: b.type })).then(function (meta) { if (next.logos.indexOf(meta.id) < 0) next.logos.push(meta.id); }, function () { skipped++; });
        });
      }, Promise.resolve()).then(function () { return { kit: next, brand: r.brand, skipped: skipped }; });
    });
  }
  /* exportFile(c, kit) → Promise<{ name, left }>: downloads brand.lebrand.json; logos up to 256 KB are embedded. */
  function exportFile(c, kit) {
    var st = c.S && c.S.project && c.S.project.meta && c.S.project.meta.studio;
    var brand = fromKit(kit, lastBrand() || (st && st.brand));
    var left = 0;
    var LEp = root.LE && root.LE.project;
    return (kit.logos || []).slice(0, LIMITS.logos).reduce(function (chain, id, i) {
      return chain.then(function () {
        return Promise.resolve(LEp && LEp.assetRecord ? LEp.assetRecord(id) : null).then(function (rec) {
          if (!rec || !rec.blob || !/^image\/(png|jpeg|webp|gif)$/.test(rec.type || rec.blob.type) || rec.blob.size > 256 * 1024) { left++; return null; }
          return blobData(rec.blob).then(function (uri) { brand.logos.push({ id: 'logo' + (brand.logos.length ? '-' + (brand.logos.length + 1) : ''), src: uri, name: plain(String(rec.name || '').replace(/\.[a-z0-9]+$/i, ''), 60) || 'Logo ' + (i + 1) }); });
        }, function () { left++; });
      });
    }, Promise.resolve()).then(function () {
      var r = read(brand);
      var name = (slug(brand.name) || 'brand') + '.lebrand.json';
      c.download(new root.Blob([stringify(r.ok ? r.brand : brand)], { type: 'application/json' }), name);
      return { name: name, left: left };
    });
  }

  var api = {
    FORMAT: FORMAT, VERSION: VERSION, SCHEMA_URL: SCHEMA_URL, LIMITS: LIMITS, ROLES: ROLES, FONT_ROLES: FONT_ROLES,
    read: read, stringify: stringify, lint: lint, fixes: fixes, summary: summary, of: brandOf, toKit: toKit, fromKit: fromKit,
    importFile: importFile, exportFile: exportFile, contrast: function (a, b) { var x = rgbOf(a), y = rgbOf(b); return x && y ? contrast(x, y) : null; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) { root.LE = root.LE || {}; root.LE.brand = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
