'use strict';
/* Design as code: a small builder that writes the open design format (.ledesign.json). No dependencies.
   It only assembles plain data: the result has no code in it and the studio never runs anything from it.

     const { design } = require('localeditor/dsl');          // or the path to this file
     module.exports = design({ name: 'Bake sale', size: [1080, 1350], brand: 'brand.lebrand.json' })
       .page({ background: '#14213D' })
         .text('Bake sale', { id: 'title', font: 'Anton', size: 160, color: '#FFFFFF', x: 'center', y: 90, w: '86%' })
         .image('assets/cake.jpg', { id: 'hero', x: 90, y: 500, w: 900, h: 600, radius: 32 })
         .fx({ type: 'exposure', p: { ev: 0.3 } })               // on the layer just added (or .fx('hero', …))
         .shape('burst', { id: 'badge', fill: '#E0B354', x: 800, y: 1090, w: 220, h: 220 });

   Then: localeditor build poster.design.js -o out/      docs/DESIGN-AS-CODE.md */

const SCHEMA_URL = 'https://localeditor.net/schema/design-1.json';
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class DesignError extends Error {
  constructor(message) { super(message); this.name = 'DesignError'; this.code = 'invalid'; }
}
/* A deep copy that accepts plain data only: no functions, no class instances, no cycles. */
function plain(v, where, depth) {
  depth = depth || 0;
  if (depth > 40) throw new DesignError(where + ' is nested too deeply.');
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!isFinite(v)) throw new DesignError(where + ' is not a finite number.'); return v; }
  if (Array.isArray(v)) return v.map((x, i) => plain(x, where + '/' + i, depth + 1));
  if (typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    const o = {};
    for (const k of Object.keys(v)) {
      if (BAD_KEYS.has(k)) throw new DesignError(where + ' has a key named ' + k + ', which is not allowed.');
      if (v[k] !== undefined) o[k] = plain(v[k], where + '/' + k, depth + 1);
    }
    return o;
  }
  throw new DesignError(where + ' must be plain data (text, numbers, true / false, lists and objects), not ' + (typeof v === 'function' ? 'a function' : typeof v === 'object' ? 'an instance of ' + ((v.constructor && v.constructor.name) || 'a class') : typeof v) + '.');
}
function sizeOf(v, where) {
  if (v == null) return null;
  if (typeof v === 'string') { const m = /^(\d{1,5})\s*[x×]\s*(\d{1,5})$/i.exec(v.trim()); if (m) return [Number(m[1]), Number(m[2])]; }
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n > 0)) return [v[0], v[1]];
  if (v && typeof v === 'object' && v.width > 0 && v.height > 0) return [v.width, v.height];
  throw new DesignError(where + ' is [width, height], "1080x1350" or { width, height }.');
}

class Design {
  constructor(opts) {
    opts = opts || {};
    const rest = Object.assign({}, opts);
    delete rest.size; delete rest.width; delete rest.height; delete rest.pages;
    this._size = sizeOf(opts.size != null ? opts.size : (opts.width && opts.height ? { width: opts.width, height: opts.height } : null), 'size') || [1080, 1080];
    this._doc = Object.assign({ $schema: SCHEMA_URL, format: 'localeditor-design', version: 1, name: 'Untitled design' }, plain(rest, 'design'), { pages: [] });
    this._ids = new Set();
    this._n = {};
    this._page = null;
    this._last = null;
    (opts.pages || []).forEach((p) => this.page(p));
  }
  /* Starts a page; layers added next go on it. { id, size | width + height, background, … } */
  page(opts) {
    opts = opts || {};
    const rest = plain(Object.assign({}, opts, { size: undefined, layers: undefined }), 'page');
    const sz = sizeOf(opts.size != null ? opts.size : (opts.width && opts.height ? { width: opts.width, height: opts.height } : null), 'page size') || this._size;
    const page = Object.assign({}, rest, { width: sz[0], height: sz[1] });
    if (page.id != null) this._claim(String(page.id), 'page');
    page.layers = [];
    this._doc.pages.push(page);
    this._page = page;
    this._last = null;
    (opts.layers || []).forEach((l) => this.layer(l));
    return this;
  }
  background(bg) { this._cur().background = plain(bg, 'background'); return this; }
  _cur() { if (!this._page) this.page(); return this._page; }
  _claim(id, what) {
    if (!/^[A-Za-z0-9][\w.-]{0,47}$/.test(id)) throw new DesignError('The ' + what + ' id "' + id + '" must be 1–48 letters, digits, "-", "_" or ".".');
    if (this._ids.has(id)) throw new DesignError('The id "' + id + '" is used twice. Ids are unique in a design.');
    this._ids.add(id);
    return id;
  }
  /* Any layer as the format describes it ({ type, … }). An id is made up when there is none: <type>-<n>, stable from run to run. */
  layer(l) {
    if (!l || typeof l !== 'object' || typeof l.type !== 'string') throw new DesignError('A layer is an object with a "type".');
    const layer = plain(l, 'layer');
    if (layer.id == null) {
      let id;
      do { this._n[layer.type] = (this._n[layer.type] || 0) + 1; id = layer.type + '-' + this._n[layer.type]; } while (this._ids.has(id));
      layer.id = id;
    }
    this._claim(String(layer.id), 'layer');
    const ordered = Object.assign({ id: layer.id, type: layer.type }, layer);
    this._cur().layers.push(ordered);
    this._last = ordered;
    return this;
  }
  text(text, o) { return this.layer(Object.assign({ type: 'text', text: String(text == null ? '' : text) }, o)); }
  /* image('assets/photo.jpg', { … }); image(null, { … }) or slot({ … }) is an empty photo slot. */
  image(src, o) { return this.layer(Object.assign({ type: 'image' }, src ? { src: String(src) } : { slot: true }, o)); }
  slot(o) { return this.image(null, o); }
  shape(shape, o) { return this.layer(Object.assign({ type: 'shape', shape: String(shape || 'rect') }, o)); }
  icon(icon, o) { return this.layer(Object.assign({ type: 'icon', icon: String(icon) }, o)); }
  /* An adjustment layer: effects over everything beneath it. */
  adjust(fx, o) { return this.layer(Object.assign({ type: 'adjust', fx: [].concat(fx || []) }, o)); }
  /* fx(entry | [entries]) adds expert effects to the layer just added; fx('id', …) to the layer with that id. */
  fx(a, b) {
    let target = this._last, entries = a;
    if (typeof a === 'string') {
      target = null;
      this._doc.pages.forEach((p) => p.layers.forEach((l) => { if (l.id === a) target = l; }));
      if (!target) throw new DesignError('fx: there is no layer with the id "' + a + '".');
      entries = b;
    }
    if (!target) throw new DesignError('fx: add a layer first, or name one: fx("hero", { type, p }).');
    const list = [].concat(entries || []).map((e, i) => {
      if (!e || typeof e !== 'object' || typeof e.type !== 'string') throw new DesignError('fx: an effect is { "type", "p": { … } } (see: localeditor catalog fx).');
      return plain(e, 'fx/' + i);
    });
    if (target.fx != null && !Array.isArray(target.fx)) throw new DesignError('fx: the layer "' + target.id + '" already has an older baked effect.');
    target.fx = (target.fx || []).concat(list);
    return this;
  }
  variables(list) { this._doc.variables = plain(list, 'variables'); return this; }
  values(v) { (this._page || this._doc).values = plain(v, 'values'); return this; }
  brand(b) { this._doc.brand = plain(b, 'brand'); return this; }
  name(n) { this._doc.name = String(n); return this; }
  /* use(fn): compose. fn receives the builder and its extra arguments: .use(footer, 'harbour.example') */
  use(fn, ...args) { if (typeof fn !== 'function') throw new DesignError('use: give a function.'); fn(this, ...args); return this; }
  /* The plain document. */
  toJSON() {
    if (!this._doc.pages.length) this.page();
    const doc = plain(this._doc, 'design');
    if (doc.values && !Object.keys(doc.values).length) delete doc.values;
    return doc;
  }
  toString() { return JSON.stringify(this.toJSON(), null, 2) + '\n'; }
}

function design(opts) { return new Design(opts); }
/* True for a builder or anything else that turns itself into a design document. */
function isDesign(v) { return !!v && typeof v === 'object' && (v instanceof Design || (v.format === 'localeditor-design' && Array.isArray(v.pages))); }

module.exports = { design, Design, DesignError, isDesign, SCHEMA_URL };
