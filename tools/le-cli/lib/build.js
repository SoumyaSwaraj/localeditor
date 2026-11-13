'use strict';
/* Design as code (docs/DESIGN-AS-CODE.md): turn sources into .ledesign.json files and pictures, and say what changed
   between two designs. A source is a .ledesign.json / .json file, or a .js / .cjs / .mjs file that exports designs
   (run with Node here, at build time; what it writes is plain data). */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const F = require('./files');
const { LEError } = F;
const { isDesign } = require('./dsl');

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'design';
const baseOf = (file) => path.basename(file).replace(/\.(ledesign\.json|design\.[cm]?js|json|[cm]?js)$/i, '');

function toDoc(v, where) {
  if (v && typeof v.toJSON === 'function') v = v.toJSON();
  if (!isDesign(v)) throw new LEError('invalid', where + ' is not a design: export design({ … }) from the builder, or an object with "format": "localeditor-design" and "pages".');
  return JSON.parse(JSON.stringify(v));
}
/* Lets a script say require('localeditor/dsl') wherever it lives, with nothing installed next to it. */
let aliased = false;
function dslAlias() {
  if (aliased) return;
  aliased = true;
  const Module = require('module');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'localeditor/dsl' || request === 'localeditor/dsl.js') return path.join(__dirname, 'dsl.js');
    return resolve.call(this, request, ...rest);
  };
}
/* loadSource(file) → Promise<[{ name, doc, from, generated }]>. A script may export one design, a list, an object of
   name: design, or a function (plain or async) that returns any of those. */
async function loadSource(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new LEError('not-found', 'There is no file at ' + file + '.');
  if (/\.json$/i.test(abs)) {
    let doc;
    try { doc = JSON.parse(F.readDesign(abs)); } catch (e) { if (e instanceof LEError) throw e; throw new LEError('invalid', file + ' is not valid JSON: ' + String(e.message).slice(0, 160)); }
    return [{ name: baseOf(abs), doc: toDoc(doc, file), from: abs, generated: false }];
  }
  if (!/\.[cm]?js$/i.test(abs)) throw new LEError('invalid', file + ': give a .ledesign.json file or a .js file that exports designs.');
  let mod;
  dslAlias();
  try {
    mod = /\.mjs$/i.test(abs) ? await import(pathToFileURL(abs).href) : require(abs);
  } catch (e) {
    if (e && e.code === 'ERR_REQUIRE_ESM') mod = await import(pathToFileURL(abs).href);
    else throw new LEError(e.code === 'invalid' ? 'invalid' : 'script', file + ' could not be run: ' + String((e && e.message) || e).slice(0, 400));
  }
  let v = mod && mod.__esModule !== undefined && mod.default !== undefined ? mod.default : mod;
  if (v && typeof v === 'object' && !isDesign(v) && typeof v.toJSON !== 'function' && v.default !== undefined && Object.keys(v).length === 1) v = v.default;
  if (typeof v === 'function') {
    try { v = await v(); } catch (e) { throw new LEError(e.code === 'invalid' ? 'invalid' : 'script', file + ' could not be run: ' + String((e && e.message) || e).slice(0, 400)); }
  }
  const base = baseOf(abs);
  if (v && (typeof v.toJSON === 'function' || isDesign(v))) return [{ name: base, doc: toDoc(v, file), from: abs, generated: true }];
  const list = Array.isArray(v) ? v.map((d, i) => [null, d, i]) : (v && typeof v === 'object' ? Object.keys(v).map((k, i) => [k, v[k], i]) : []);
  if (!list.length) throw new LEError('invalid', file + ' exports no design. Use: module.exports = design({ … })…');
  const seen = new Set();
  return list.map(([key, d, i]) => {
    const doc = toDoc(d, file + (key ? ' → ' + key : ' → item ' + (i + 1)));
    let name = slug(key || doc.name || base + '-' + (i + 1));
    while (seen.has(name)) name += '-' + (i + 1);
    seen.add(name);
    return { name, doc, from: abs, generated: true };
  });
}

/* build(svc, sources, { out, formats, scale }) → { ok, designs: [{ name, file, source, generated, pages, files, problems }] }.
   A script's designs are written next to the script as <name>.ledesign.json (so relative image paths keep working);
   pictures go to out/<name>.png (one page) or out/<name>-<n>.png. */
async function build(svc, sources, o) {
  o = o || {};
  const outDir = path.resolve(o.out || 'out');
  const formats = (o.formats && o.formats.length ? o.formats : ['png']).map((f) => String(f).toLowerCase().replace('jpeg', 'jpg'));
  formats.forEach((f) => { if (['png', 'jpg', 'pdf', 'webp'].indexOf(f) < 0) throw new LEError('invalid', 'Formats are png, jpg, webp and pdf, not "' + f + '".'); });
  const designs = [];
  for (const src of sources) {
    const loaded = await loadSource(src);
    for (const d of loaded) {
      const outName = o.nameFor ? o.nameFor(d, loaded.length > 1) : d.name;
      let file = d.from;
      if (d.generated) {
        file = path.join(path.dirname(d.from), d.name + '.ledesign.json');
        const text = JSON.stringify(d.doc, null, 2) + '\n';
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) F.writeAtomic(file, text);
      }
      const chk = await svc.check(file, { brand: o.brand });
      const files = [];
      for (const fmt of formats) {
        const r = await svc.render(file, { page: 'all', scale: o.scale, format: fmt, quality: o.quality });
        svc.writeRender(r, path.join(outDir, outName + '.' + fmt), fmt).forEach((f) => files.push(f));
      }
      designs.push({ name: d.name, file, source: d.from, generated: d.generated, pages: d.doc.pages.length, files, problems: chk.problems, brand: chk.brand || undefined });
    }
  }
  return { ok: true, out: outDir, designs };
}

/* describe(a, b, ops) → the structural difference between two normalised documents, from the operations that turn a
   into b (LE.link.diff): which pages and layers were added, removed, moved or changed, and which fields. */
function describe(a, b, ops) {
  const changes = [];
  const find = (doc, id) => { let hit = null; (doc.pages || []).forEach((p, pi) => (p.layers || []).forEach((l) => { if (l.id === id) hit = { layer: l, page: p.id || pi }; })); return hit; };
  (ops || []).forEach((op) => {
    if (op.op === 'add') changes.push({ kind: 'layer-added', id: op.layer && op.layer.id, type: op.layer && op.layer.type, page: op.page });
    else if (op.op === 'remove') { const was = find(a, op.id); changes.push({ kind: 'layer-removed', id: op.id, type: was && was.layer.type, page: was ? was.page : undefined }); }
    else if (op.op === 'update') {
      const was = find(a, op.id), now = find(b, op.id);
      const fields = Object.keys(op.set || {});
      const before = {}, after = {};
      fields.forEach((k) => { before[k] = was && was.layer[k] !== undefined ? was.layer[k] : null; after[k] = op.set[k]; });
      changes.push({ kind: 'layer-changed', id: op.id, type: now && now.layer.type, page: now ? now.page : undefined, fields, before, after });
    } else if (op.op === 'reorder' || op.op === 'move') changes.push({ kind: 'layer-moved', id: op.id, to: op.to != null ? op.to : op.index });
    else if (op.op === 'page.add') changes.push({ kind: 'page-added', page: (op.page && op.page.id) || op.index, layers: ((op.page && op.page.layers) || []).length });
    else if (op.op === 'page.remove') changes.push({ kind: 'page-removed', page: op.page });
    else if (op.op === 'page.move') changes.push({ kind: 'page-moved', page: op.page, to: op.index });
    else if (op.op === 'page.update') changes.push({ kind: 'page-changed', page: op.page, fields: Object.keys(op.set || {}) });
    else if (op.op === 'doc.update') changes.push({ kind: 'document-changed', fields: Object.keys(op.set || {}) });
    else changes.push({ kind: op.op });
  });
  /* A layer that moved to another page arrives as remove + add: say it once. */
  const added = new Set(changes.filter((c) => c.kind === 'layer-added').map((c) => c.id));
  const merged = changes.filter((c) => !(c.kind === 'layer-removed' && added.has(c.id)));
  merged.forEach((c) => { if (c.kind === 'layer-added' && find(a, c.id)) c.kind = 'layer-moved-page'; });
  const count = (k) => merged.filter((c) => c.kind === k).length;
  return {
    same: !merged.length, changes: merged,
    summary: { pagesAdded: count('page-added'), pagesRemoved: count('page-removed'), pagesChanged: count('page-changed') + count('page-moved'), layersAdded: count('layer-added'), layersRemoved: count('layer-removed'), layersChanged: count('layer-changed'), layersMoved: count('layer-moved') + count('layer-moved-page') }
  };
}
function short(v) { const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v); return s == null ? 'nothing' : (s.length > 48 ? s.slice(0, 45) + '…' : s); }
function describeText(d) {
  if (d.same) return 'No difference.';
  return d.changes.map((c) => {
    switch (c.kind) {
      case 'layer-added': return '+ layer ' + c.id + ' (' + c.type + ')' + (c.page != null ? ' on page ' + c.page : '');
      case 'layer-removed': return '- layer ' + c.id + (c.type ? ' (' + c.type + ')' : '');
      case 'layer-changed': return '~ layer ' + c.id + ': ' + c.fields.map((k) => k + ' ' + short(c.before[k]) + ' → ' + short(c.after[k])).join(', ');
      case 'layer-moved': return '~ layer ' + c.id + ': order → ' + short(c.to);
      case 'layer-moved-page': return '~ layer ' + c.id + ': moved to page ' + c.page;
      case 'page-added': return '+ page ' + c.page + ' (' + c.layers + ' layer' + (c.layers === 1 ? '' : 's') + ')';
      case 'page-removed': return '- page ' + c.page;
      case 'page-moved': return '~ page ' + c.page + ': position → ' + c.to;
      case 'page-changed': return '~ page ' + c.page + ': ' + c.fields.join(', ');
      case 'document-changed': return '~ document: ' + c.fields.join(', ');
      default: return '~ ' + c.kind;
    }
  }).join('\n');
}

module.exports = { loadSource, build, describe, describeText, baseOf, slug };
