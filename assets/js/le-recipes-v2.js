/* LocalEditor recipes, format 2.0: Expert looks (docs/FORMAT-WORKFLOW.md, "Version 2.0").
   A 2.0 recipe carries an `fx` list: plain effect entries as in layer.fx (type, on, amount, blend, mask, p). Nothing in it
   runs: this file checks the shape (types, sizes, forbidden keys, no markup) and the effect registry checks every entry
   against its effect's schema before anything is drawn (LE.recipes2.resolve). An effect this build does not know is kept
   in the file, reported, and never drawn.
   Loaded by the recipes page and, in the studio, with the Recipes module. It teaches LE.recipes.validate, encodeLink,
   decodeLink, find and LE.userRecipes about 2.0; 1.x files take exactly the path they took before. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.recipes || LE.recipes2) return;
  var R = LE.recipes, U = LE.userRecipes;
  var v1 = R.validate, encode1 = R.encodeLink, decode1 = R.decodeLink, find1 = R.find;
  var LIMITS = { fx: 32, parts: 8, keys: 48, list: 512, data: 4096, string: 120, depth: 5, fxChars: 200000, lutChars: 1000000, luts: 2 };
  var BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'darken', 'lighten', 'difference', 'color', 'luminosity'];
  /* Mask parts that resolve on each photo. A painted mask (`asset`) belongs to one photo and is left out. */
  var MASK = {
    linear: ['x0', 'y0', 'x1', 'y1'], radial: ['cx', 'cy', 'rx', 'ry', 'rotation'], luma: ['min', 'max', 'soft'], color: ['h', 's', 'l', 'range', 'soft'],
    subject: [], depth: ['near', 'far', 'soft'], face: [], segment: []
  };
  var FACE = ['skin', 'eyes', 'lips', 'teeth', 'brows', 'under-eyes'], SEGMENT = ['person', 'hair', 'skin', 'clothes', 'background'];
  var MAP_OF = { depth: 'depth', face: 'face', segment: 'segments' };
  var LUT = /^data:(text\/plain|application\/octet-stream);base64,[A-Za-z0-9+/=]+$/;
  var NEUTRAL = { operation: 'contrast', parameters: { value: 0 } };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function fail(msg) { return { ok: false, errors: [msg], warnings: [] }; }
  function versionOf(data) {
    var ver = typeof data.version === 'number' ? (data.version % 1 ? String(data.version) : data.version + '.0') : String(data.version || '');
    var m = /^(\d+)\.\d+$/.exec(ver);
    return m ? Number(m[1]) : 0;
  }
  function isV2(wf) { return isObj(wf) && versionOf(wf) === 2; }

  /* ---------- Shape checks (no registry needed) ---------- */
  function cleanData(v, depth, st, path) {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { if (!isFinite(v)) throw new Error(path + ' is not a number.'); return v; }
    if (typeof v === 'string') {
      if (v.slice(0, 5) === 'data:') {
        if (!LUT.test(v) || v.length > LIMITS.lutChars || ++st.luts > LIMITS.luts) throw new Error(path + ': a recipe can carry up to ' + LIMITS.luts + ' small LUT files as text, and nothing else.');
        return v;
      }
      if (v.length > LIMITS.string) throw new Error(path + ' is too long.');
      return v;
    }
    if (depth > LIMITS.depth) throw new Error(path + ' is nested too deeply.');
    if (Array.isArray(v)) {
      var flat = v.every(isNum);
      if (v.length > (flat ? LIMITS.data : LIMITS.list)) throw new Error(path + ' has too many values.');
      return flat ? v.slice() : v.map(function (x, i) { return cleanData(x, depth + 1, st, path + '/' + i); });
    }
    if (isObj(v)) {
      var keys = Object.keys(v), out = {};
      if (keys.length > LIMITS.keys) throw new Error(path + ' has too many settings.');
      keys.forEach(function (k) {
        if (!/^[a-zA-Z][\w]{0,31}$/.test(k)) throw new Error(path + ': "' + k.slice(0, 20) + '" is not a setting name.');
        out[k] = cleanData(v[k], depth + 1, st, path + '/' + k);
      });
      return out;
    }
    throw new Error(path + ' is not plain data.');
  }
  function cleanMask(mask, path, warnings) {
    if (mask == null) return null;
    if (!isObj(mask) || !Array.isArray(mask.parts)) throw new Error(path + ' is not a mask.');
    if (mask.parts.length > LIMITS.parts) throw new Error(path + ' has more than ' + LIMITS.parts + ' parts.');
    var parts = [];
    mask.parts.forEach(function (src, i) {
      var pp = path + '/parts/' + i;
      if (!isObj(src) || typeof src.kind !== 'string') throw new Error(pp + ' is not a mask part.');
      if (src.kind === 'asset') { warnings.push('A painted mask was left out: it belongs to one photo.'); return; }
      if (!own(MASK, src.kind)) throw new Error(pp + ': unknown mask kind.');
      var o = { kind: src.kind, mode: src.mode === 'subtract' || src.mode === 'intersect' ? src.mode : 'add', invert: src.invert === true };
      ['feather', 'density', 'blur'].concat(MASK[src.kind]).forEach(function (k) {
        if (src[k] == null) return;
        if (!isNum(src[k])) throw new Error(pp + '/' + k + ' is not a number.');
        o[k] = src[k];
      });
      if (src.kind === 'face') { if (FACE.indexOf(src.part) < 0) throw new Error(pp + '/part is one of ' + FACE.join(', ') + '.'); o.part = src.part; }
      if (src.kind === 'segment') { if (SEGMENT.indexOf(src.class) < 0) throw new Error(pp + '/class is one of ' + SEGMENT.join(', ') + '.'); o.class = src.class; }
      parts.push(o);
    });
    var out = { on: mask.on !== false, invert: mask.invert === true, parts: parts };
    return parts.length || out.invert ? out : null;
  }
  function cleanEntry(e, i, st, warnings) {
    var path = 'Effect ' + (i + 1);
    if (!isObj(e)) throw new Error(path + ' is not an effect entry.');
    if (typeof e.type !== 'string' || !/^[a-z][a-z0-9.-]{1,39}$/.test(e.type)) throw new Error(path + ' has no readable type.');
    if (e.on != null && typeof e.on !== 'boolean') throw new Error(path + ': "on" is true or false.');
    if (e.amount != null && (!isNum(e.amount) || e.amount < 0 || e.amount > 1)) throw new Error(path + ': "amount" is a number from 0 to 1.');
    if (e.blend != null && BLENDS.indexOf(e.blend) < 0) throw new Error(path + ': unknown blend.');
    if (e.p != null && !isObj(e.p)) throw new Error(path + ': "p" is an object of settings.');
    var out = { type: e.type, on: e.on !== false, amount: e.amount == null ? 1 : e.amount, blend: e.blend || 'normal', mask: cleanMask(e.mask, path + '/mask', warnings), p: cleanData(e.p || {}, 0, st, path + '/p') };
    Object.keys(e).forEach(function (k) { if (['id', 'type', 'on', 'amount', 'blend', 'mask', 'p'].indexOf(k) < 0) warnings.push(path + ': "' + k.slice(0, 20) + '" is not an entry field; left out.'); });
    return out;
  }
  function validate2(data) {
    /* Everything 1.x checks (size, depth, forbidden keys, markup in any string, metadata, steps, strength, export) through the 1.x validator. */
    var shell = {};
    Object.keys(data).forEach(function (k) { shell[k] = data[k]; });
    shell.version = '1.1';
    var hasSteps = Array.isArray(data.steps) && data.steps.length > 0;
    if (data.steps != null && !Array.isArray(data.steps)) return fail('steps must be a list.');
    if (!hasSteps) shell.steps = [NEUTRAL];
    var v = v1(shell);
    if (!v.ok) return v;
    if (!Array.isArray(data.fx) || !data.fx.length) return fail('This recipe has no effects.');
    if (data.fx.length > LIMITS.fx) return fail('This recipe has more than ' + LIMITS.fx + ' effects.');
    var warnings = (v.warnings || []).slice(), st = { luts: 0 }, fx;
    try { fx = data.fx.map(function (e, i) { return cleanEntry(e, i, st, warnings); }); } catch (err) { return fail(err.message); }
    var chars = JSON.stringify(fx, function (k, x) { return typeof x === 'string' && x.slice(0, 5) === 'data:' ? '' : x; }).length;
    if (chars > LIMITS.fxChars) return fail('This recipe is too large.');
    var w = v.workflow;
    return { ok: true, errors: [], warnings: warnings, workflow: {
      format: w.format, version: '2.0', metadata: w.metadata,
      compatibility: { minimumEditorVersion: '2.0', mobileSupported: !(w.compatibility && w.compatibility.mobileSupported === false) },
      parameters: w.parameters, steps: hasSteps ? w.steps : [], fx: fx, export: w.export
    } };
  }
  function validate(input) {
    var data = input;
    if (typeof input === 'string') {
      if (input.length > R.limits.bytes) return v1(input);
      try { data = JSON.parse(input); } catch (e) { return v1(input); }
    }
    if (!isObj(data) || data.format !== 'localeditor-workflow' || versionOf(data) !== 2) return v1(input);
    return validate2(data);
  }

  /* ---------- Registry check: nothing is drawn before this (needs LE.fx) ----------
     → { entries, inert: [{ index, type }], luts: [{ entry, key, uri }], maps: ['depth', …], notes: [plain sentences] } */
  function resolve(wf, FX) {
    var out = { entries: [], inert: [], luts: [], maps: [], notes: [] };
    (wf && wf.fx || []).forEach(function (src, i) {
      var def = FX.get(src.type);
      if (!def) { out.inert.push({ index: i, type: src.type }); return; }
      var e = clone(src), at = out.entries.length;
      Object.keys(e.p || {}).forEach(function (k) {
        if (typeof e.p[k] !== 'string' || e.p[k].slice(0, 5) !== 'data:') return;
        if (def.params[k] && def.params[k].type === 'lut') out.luts.push({ entry: at, key: k, uri: e.p[k] });
        else out.notes.push(def.name + ': embedded data is only read for a LUT; it was left out.');
        e.p[k] = null;
      });
      var r = FX.validate(e, '/fx/' + i);
      if (!r.ok) { out.inert.push({ index: i, type: src.type }); return; }
      delete r.entry.id;
      out.entries.push(r.entry);
      ((r.entry.mask && r.entry.mask.parts) || []).forEach(function (p) { var m = MAP_OF[p.kind]; if (m && out.maps.indexOf(m) < 0) out.maps.push(m); });
    });
    if (out.inert.length) out.notes.push(out.inert.length === 1 ? 'One effect (' + out.inert[0].type + ') is not known to this LocalEditor and was left out.' : out.inert.length + ' effects are not known to this LocalEditor and were left out.');
    return out;
  }
  /* The entries of a mask that needs `map` ('depth', 'face', 'segments'). */
  function needsMap(entry, map) { return ((entry.mask && entry.mask.parts) || []).some(function (p) { return MAP_OF[p.kind] === map; }); }
  /* Strength (0–100) is one amount that scales every entry's own amount. */
  function scale(entries, strength) {
    var s = Math.max(0, Math.min(100, isNum(strength) ? strength : 100)) / 100;
    return entries.map(function (e) { var c = clone(e); c.amount = Math.round(Math.max(0, Math.min(1, (isNum(e.amount) ? e.amount : 1) * s)) * 10000) / 10000; return c; });
  }
  /* A layer's effect stack as recipe entries: ids dropped, painted masks left out (noted). */
  function fromStack(stack, notes) {
    var st = { luts: 0 }, out = [];
    (stack || []).slice(0, LIMITS.fx).forEach(function (e, i) {
      var w = [];
      try { out.push(cleanEntry(e, i, st, w)); } catch (err) { if (notes) notes.push(err.message); }
      if (notes && w.some(function (m) { return /painted mask/.test(m); }) && notes.indexOf('Painted masks were left out: they belong to one photo.') < 0) notes.push('Painted masks were left out: they belong to one photo.');
    });
    return out;
  }

  /* ---------- Share links: the same payload as 1.x (z = deflate-raw, j = plain; base64url) ---------- */
  function b64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function pipe(bytes, transform, cap) {
    var reader = new Blob([bytes]).stream().pipeThrough(transform).getReader(), chunks = [], total = 0;
    function next() {
      return reader.read().then(function (r) {
        if (r.done) { var out = new Uint8Array(total), at = 0; chunks.forEach(function (c) { out.set(c, at); at += c.length; }); return out; }
        total += r.value.length;
        if (cap && total > cap) { reader.cancel().catch(function () {}); throw new Error('This recipe link is too large.'); }
        chunks.push(r.value);
        return next();
      });
    }
    return next();
  }
  function encodeLink(workflow, opts) {
    if (!isV2(workflow)) return encode1(workflow, opts);
    opts = opts || {};
    var v = validate(workflow);
    if (!v.ok) return Promise.reject(new Error(v.errors[0]));
    var bytes = new TextEncoder().encode(JSON.stringify(v.workflow));
    var make = (R.canCompressLinks() && opts.compress !== false) ? pipe(bytes, new CompressionStream('deflate-raw')).then(function (z) { return 'z' + b64url(z); }) : Promise.resolve('j' + b64url(bytes));
    return make.then(function (payload) {
      if (payload.length > R.limits.linkChars) throw new Error('This recipe is too large for a link. Share the .leworkflow file instead.');
      var base = opts.base;
      if (!base) { var root = document.documentElement.getAttribute('data-root') || './'; try { base = new URL(root, location.href).href + 'recipes/'; } catch (e) { base = location.origin + '/recipes/'; } }
      return { payload: payload, fragment: 'r=' + payload, url: base + '#r=' + payload, compressed: payload.charAt(0) === 'z' };
    });
  }
  function decodeLink(text) {
    return decode1(text).then(function (r) {
      if (r.ok || !/newer LocalEditor/.test((r.errors || [])[0] || '')) return r;
      var payload = R.linkPayload(text), bytes;
      try { bytes = unb64url(payload.slice(1)); } catch (e) { return r; }
      var raw = payload.charAt(0) === 'j' ? Promise.resolve(bytes) : pipe(bytes, new DecompressionStream('deflate-raw'), R.limits.linkBytes);
      return raw.then(function (out) { return validate(new TextDecoder('utf-8', { fatal: true }).decode(out)); }).catch(function () { return r; });
    });
  }

  /* ---------- Recipes saved on this device: 2.0 files have their own list, so an older page never rewrites them ---------- */
  var KEY2 = 'le-user-recipes-2', MAX2 = 40;
  function raw2() { try { var l = JSON.parse(localStorage.getItem(KEY2) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function all2() {
    var seen = {};
    return raw2().map(function (r) { var v = isV2(r) ? validate2(r) : null; return v && v.ok ? v.workflow : null; }).filter(function (r) { if (!r || seen[r.metadata.id]) return false; seen[r.metadata.id] = 1; return true; });
  }
  function write2(list) {
    try { localStorage.setItem(KEY2, JSON.stringify(list.slice(0, MAX2))); } catch (e) { throw new Error('This device has no room left for more recipes. Delete one and try again.'); }
  }
  if (U) {
    var all1 = U.all, save1 = U.save, remove1 = U.remove, free1 = U.freeId;
    var only1 = function () { var o = Object.create(U); o.all = all1; return o; };
    U.all = function () { return all2().concat(all1.call(U)); };
    U.save = function (workflow) {
      if (!isV2(workflow)) return save1.call(only1(), workflow);
      var v = validate(workflow);
      if (!v.ok) throw new Error(v.errors[0] || 'That is not a valid recipe.');
      write2([v.workflow].concat(all2().filter(function (r) { return r.metadata.id !== v.workflow.metadata.id; })));
      return v.workflow;
    };
    U.remove = function (id) {
      var a = all2(), next = a.filter(function (r) { return r.metadata.id !== id; });
      if (next.length !== a.length) { write2(next); return true; }
      return remove1.call(only1(), id);
    };
    U.freeId = function (name) {
      var id = free1.call(U, name), base = id.replace(/-\d+$/, ''), n = 2;
      while (BUILTINS.some(function (b) { return b.metadata.id === id; })) id = base + '-' + (n++);
      return id;
    };
  }

  /* ---------- Built-in Expert looks: data that points at the effect packs' own presets ----------
     The values are LE.fx.grade.presets and LE.fx.creative.presets; `fill` copies them in once the renderer is there. */
  function look(id, pack, preset, name, category, cover, strength, description, tags) {
    return { format: 'localeditor-workflow', version: '2.0', expert: { pack: pack, preset: preset },
      metadata: { id: id, name: name, description: description, author: 'LocalEditor', category: category, difficulty: 'intermediate', tags: tags, license: 'Free to use and share', cover: cover },
      compatibility: { minimumEditorVersion: '2.0', mobileSupported: true },
      parameters: [{ id: 'intensity', label: 'Strength', type: 'slider', min: 0, max: 100, default: strength }], steps: [], fx: [], export: { format: 'jpeg', quality: 90 } };
  }
  var BUILTINS = [
    look('x-teal-orange', 'grade', 'teal-orange', 'Teal and orange', 'film', 'travel-05', 85, 'Blockbuster complementary grade: teal shadows, warm skin and highlights.', ['cinema', 'teal', 'orange']),
    look('x-filmic-fade', 'grade', 'filmic-fade', 'Filmic fade', 'film', 'street-03', 90, 'Lifted matte blacks, soft roll-off, muted colour, warm highlights.', ['matte', 'film', 'soft']),
    look('x-cool-cinematic', 'grade', 'cool-cinematic', 'Cool cinematic', 'film', 'arch-03', 85, 'Desaturated steel blues, deep shadows, restrained highlights.', ['cinema', 'cool', 'blue']),
    look('x-noir', 'grade', 'noir', 'Noir', 'bw', 'people-06', 100, 'Contrasty black and white with deep blacks.', ['black and white', 'contrast']),
    look('x-35mm-print', 'creative', '35mm-print', '35 mm print', 'film', 'people-08', 90, 'Colour negative printed on paper: gentle contrast, lifted warm blacks, halation on highlights, fine grain.', ['film', 'grain', 'halation']),
    look('x-night-neon', 'creative', 'night-neon', 'Night neon', 'social', 'street-03', 85, 'City lights that bloom, streak and fringe, with cool shadows and grain.', ['night', 'neon', 'bloom']),
    look('x-faded-summer', 'creative', 'faded-summer', 'Faded summer', 'film', 'garden-05', 85, 'Warm, washed-out holiday print with a light leak from the edge.', ['warm', 'faded', 'light leak']),
    look('x-crisp-landscape', 'creative', 'crisp-landscape', 'Crisp landscape', 'landscape', 'nature-02', 80, 'Haze removed, structure and texture brought out, sharpened for screens.', ['landscape', 'sharp', 'dehaze'])
  ];
  var filled = {};
  function presetFx(FX, src) {
    if (src.pack === 'grade') { var g = ((FX.grade && FX.grade.presets) || []).filter(function (x) { return x.id === src.preset; })[0]; return g ? g.fx : null; }
    var c = FX.creative && FX.creative.presets && own(FX.creative.presets, src.preset) ? FX.creative.presets[src.preset] : null;
    return c ? c.fx : null;
  }
  /* A recipe ready to apply, share or download: a built-in look gets its entries from the packs (the renderer is loaded for it). */
  function fill(wf) {
    if (!wf || !wf.expert || (wf.fx && wf.fx.length)) return Promise.resolve(wf);
    var id = wf.metadata.id;
    if (filled[id]) return Promise.resolve(filled[id]);
    if (!LE.fxBoot) return Promise.reject(new Error('Open this look in the studio to use it.'));
    return LE.fxBoot.load().then(function (FX) {
      var fx = presetFx(FX, wf.expert);
      if (!fx) throw new Error('This look is not available in this LocalEditor.');
      var copy = clone(wf);
      delete copy.expert;
      copy.fx = fx.map(function (e) { var r = FX.validate(e).entry; delete r.id; return r; });
      var v = validate2(copy);
      if (!v.ok) throw new Error(v.errors[0]);
      filled[id] = v.workflow;
      return v.workflow;
    });
  }
  R.find = function (id) {
    for (var i = 0; i < BUILTINS.length; i++) if (BUILTINS[i].metadata.id === id) return filled[id] || BUILTINS[i];
    return find1.call(R, id);
  };
  var builtin1 = R.isBuiltin;
  R.isBuiltin = function (id) { return BUILTINS.some(function (b) { return b.metadata.id === id; }) || builtin1.call(R, id); };
  R.validate = validate;
  R.encodeLink = encodeLink;
  R.decodeLink = decodeLink;

  LE.recipes2 = {
    version: '2.0', limits: LIMITS, builtins: BUILTINS, isV2: isV2, validate: validate, resolve: resolve, needsMap: needsMap, scale: scale,
    fromStack: fromStack, fill: fill, encodeLink: encodeLink, decodeLink: decodeLink,
    /* Text for the file of a look that carries LUT ids: nothing here; the studio embeds them (LEStudioRecipes.saveLook). */
    effectLabel: function (type) { var d = LE.fx && LE.fx.get ? LE.fx.get(type) : null; return d ? d.name : String(type).replace(/[.-]+/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); }); }
  };
})();
