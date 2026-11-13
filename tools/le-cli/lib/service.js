'use strict';
/* The operations every front end shares (command line, MCP server, local HTTP API, live-link bridge).
   Each returns plain JSON or throws an LEError { code, message, errors }. Designs stay warm in the engine:
   a file is (re)loaded only when its bytes changed since the last call. */
const fs = require('fs');
const path = require('path');
const { Engine } = require('./engine');
const F = require('./files');
const { LEError } = F;
const linkCore = require('./link-core');

const PROBLEM_KINDS = ['overflow', 'clipped', 'off-page', 'missing-image', 'unknown-font', 'low-contrast', 'unknown-icon', 'unknown-shape', 'shrink-needs-height', 'remote-image', 'refused-path'];

function fail(r, fallbackCode) {
  const errors = (r && r.errors) || [];
  const first = errors[0] || {};
  throw new LEError((r && r.code) || fallbackCode || 'invalid', (first.path ? first.path + ': ' : '') + (first.message || 'The design could not be read.'), { errors, warnings: (r && r.warnings) || [] });
}

class Service {
  /* opts: { browser, transport, allowHosts, allowPaths, root, verbose, adapter } */
  constructor(opts) {
    this.opts = opts || {};
    this.sandbox = new F.Sandbox({ root: this.opts.root || null, allow: this.opts.allowPaths || [] });
    this.engine = new Engine({ browser: this.opts.browser, transport: this.opts.transport, allowHosts: this.opts.allowHosts || [], verbose: this.opts.verbose, adapter: this.opts.adapter });
    this.loaded = new Map(); /* abs → { rev, srcOf } */
    this.queue = new Map(); /* abs → Promise (one operation at a time per design) */
  }
  async close() { await this.engine.close(); }

  /* Serialises operations per file. */
  exclusive(abs, fn) {
    const prev = this.queue.get(abs) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    const tail = next.then(() => {}, () => {});
    this.queue.set(abs, tail);
    tail.then(() => { if (this.queue.get(abs) === tail) this.queue.delete(abs); });
    return next;
  }

  /* ---------- loading ---------- */
  async loadText(key, text, designFile, extraRefs) {
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new LEError('invalid', 'This is not valid JSON: ' + String(e.message).slice(0, 160), { errors: [{ path: '', message: 'This is not valid JSON: ' + String(e.message).slice(0, 160) }] }); }
    const refs = F.imageRefs(doc).concat(extraRefs || []);
    const img = designFile ? F.collectImages(this.sandbox, designFile, refs) : { files: {}, notes: [] };
    const r = await this.engine.call(key, 'load', { text, files: img.files, allowHosts: this.engine.opts.allowHosts });
    if (!r || !r.ok) fail(r);
    r.problems = (r.problems || []).concat(img.notes.filter((n) => n.kind === 'refused-path'));
    r.fileNotes = img.notes;
    return r;
  }
  /* Opens a design file in its warm page; reloads only if the bytes changed. */
  async open(file) {
    const abs = this.sandbox.file(file, 'the design');
    const text = F.readDesign(abs);
    const rev = F.rev(text);
    const have = this.loaded.get(abs);
    if (have && have.rev === rev && this.engine.has(abs)) return { abs, text, rev, state: have, warm: true };
    const r = await this.loadText(abs, text, abs);
    const state = { rev, srcOf: r.srcOf, problems: r.problems, warnings: r.warnings, remote: r.remote, normalized: r.text, fileNotes: r.fileNotes };
    this.loaded.set(abs, state);
    return { abs, text, rev, state, warm: false, load: r };
  }

  /* ---------- commands ---------- */
  async newDesign(file, o) {
    o = o || {};
    const abs = this.sandbox.file(file, 'the new design');
    if (fs.existsSync(abs) && !o.force) throw new LEError('exists', abs + ' already exists (use --force to replace it).');
    let text;
    if (o.from) {
      const site = require('./static-server').siteRoot();
      const name = String(o.from).replace(/\.ledesign\.json$/, '');
      const ex = path.join(site, 'examples', 'designs', name + '.ledesign.json');
      if (/^[\w-]+$/.test(name) && fs.existsSync(ex)) text = fs.readFileSync(ex, 'utf8');
      else text = F.readDesign(this.sandbox.file(o.from, '--from'));
    } else {
      let w = 1080, h = 1080;
      if (o.size) {
        const m = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec(String(o.size));
        if (!m) throw new LEError('invalid', '--size is WIDTHxHEIGHT in pixels, e.g. 1080x1350.');
        w = Number(m[1]); h = Number(m[2]);
      } else if (o.preset) {
        const sizes = await this.catalog('sizes', '');
        const want = String(o.preset).toLowerCase();
        const hit = sizes.items.find((s) => s.id === want || s.preset === want) || sizes.items.find((s) => s.preset.indexOf(want) >= 0);
        if (!hit) throw new LEError('invalid', 'Unknown preset "' + o.preset + '". See: localeditor catalog sizes');
        w = hit.width; h = hit.height;
      }
      text = JSON.stringify({ format: 'localeditor-design', version: 1, name: o.name || path.basename(abs).replace(/\.ledesign\.json$|\.json$/i, ''), pages: [{ id: 'page-1', width: w, height: h, background: o.background || '#ffffff', layers: [] }] });
    }
    if (o.name && o.from) { const d = JSON.parse(text); d.name = o.name; text = JSON.stringify(d); }
    const r = await this.loadText(abs, text, o.from ? null : abs);
    F.writeAtomic(abs, r.text);
    this.loaded.set(abs, { rev: F.rev(r.text), srcOf: r.srcOf, problems: r.problems, warnings: r.warnings, remote: r.remote, normalized: r.text });
    return { ok: true, file: abs, rev: F.rev(r.text), pages: r.pages, problems: r.problems };
  }

  async validate(files) {
    const out = [];
    for (const f of files) {
      let abs;
      try {
        abs = f === '-' ? '-' : this.sandbox.file(f, 'the design');
        const text = f === '-' ? fs.readFileSync(0, 'utf8') : F.readDesign(abs);
        let doc = null;
        try { doc = JSON.parse(text); } catch (e) { out.push({ file: f, ok: false, errors: [{ path: '', message: 'This is not valid JSON: ' + String(e.message).slice(0, 160) }], warnings: [] }); continue; }
        const img = abs === '-' ? { files: {}, notes: [] } : F.collectImages(this.sandbox, abs, F.imageRefs(doc));
        const r = await this.engine.call('validate', 'validate', { text, files: img.files });
        out.push({ file: f, ok: !!r.ok, errors: r.errors || [], warnings: (r.warnings || []).concat(img.notes), problems: (r.problems || []).concat(img.notes.filter((n) => n.kind === 'refused-path')), remote: r.remote || [] });
      } catch (e) {
        out.push({ file: f, ok: false, errors: e.errors || [{ path: '', message: e.message }], warnings: [] });
      }
    }
    return { ok: out.every((x) => x.ok), files: out };
  }

  /* The brand a design follows: an explicit brand file, else the design's own "brand" (a path next to it, or inline).
     → null | { source, text } (text: null for an inline brand, which the engine already holds). */
  resolveBrand(abs, text, brandFile) {
    if (brandFile) { const b = this.sandbox.file(brandFile, 'the brand file'); return { source: b, text: F.readDesign(b) }; }
    let doc = null;
    try { doc = JSON.parse(text); } catch (e) { return null; }
    if (doc && typeof doc.brand === 'string') {
      const r = this.sandbox.image(abs, doc.brand);
      if (r.error) throw new LEError(r.missing ? 'not-found' : 'sandbox', r.missing ? 'The brand file "' + doc.brand + '" named by the design was not found next to it.' : 'The brand file "' + doc.brand + '" must be in the design\'s folder (or pass --brand).');
      return { source: r.abs, text: F.readDesign(r.abs) };
    }
    return doc && doc.brand && typeof doc.brand === 'object' ? { source: 'inline', text: null } : null;
  }
  /* check(file, { brand?, brandOnly? }): lint problems, plus brand problems (each with a "fix" operation) when the design
     names a brand or one is given. */
  async check(file, opt) {
    opt = opt || {};
    const abs = this.sandbox.file(file, 'the design');
    return this.exclusive(abs, async () => {
      const o = await this.open(abs);
      let problems = opt.brandOnly ? [] : (o.state.problems || []);
      const out = { ok: true, file: abs, rev: o.rev, problems, warnings: (o.state.warnings || []).filter((w) => PROBLEM_KINDS.indexOf(w.kind) < 0 && !/^brand-/.test(w.kind)), remote: o.state.remote || [] };
      const b = this.resolveBrand(abs, o.text, opt.brand);
      if (opt.brandOnly && !b) throw new LEError('not-found', 'This design names no brand. Pass --brand <brand.lebrand.json>, or add "brand": "brand.lebrand.json" to the design.');
      if (b) {
        const r = await this.engine.call(abs, 'brand', { brand: b.text });
        if (!r.ok) fail(r);
        out.problems = problems = problems.concat(r.problems || []);
        out.brand = { source: b.source, name: r.brand ? r.brand.name : null, summary: r.summary || '' };
        out.fixes = r.fixes || [];
        if (r.notes && r.notes.length) out.warnings = out.warnings.concat(r.notes);
      }
      out.ok = problems.length === 0;
      return out;
    });
  }
  /* Reads and checks a brand file on its own: the normalised brand and a short summary for an agent. */
  async brandRead(file) {
    const abs = this.sandbox.file(file, 'the brand file');
    const r = await this.engine.call('validate', 'brand', { brand: F.readDesign(abs), only: true });
    if (!r.ok) fail(r);
    return { ok: true, file: abs, brand: r.brand, summary: r.summary, warnings: r.notes || [] };
  }
  /* Brand problems only; { fix: true } applies every suggested fix in one batch and checks again. */
  async brandCheck(file, opt) {
    opt = opt || {};
    let r = await this.check(file, { brand: opt.brand, brandOnly: true });
    if (opt.fix && r.fixes && r.fixes.length) {
      const fixes = r.fixes;
      const ap = await this.apply(file, fixes, { label: 'Brand fixes', partial: true });
      r = await this.check(file, { brand: opt.brand, brandOnly: true });
      r.fixed = ap.applied; r.written = ap.written;
    }
    return r;
  }

  async show(file, o) {
    const abs = this.sandbox.file(file, 'the design');
    return this.exclusive(abs, async () => {
      const op = await this.open(abs);
      const r = await this.engine.call(abs, 'state', { full: !!(o && o.full) });
      if (!r.ok) fail(r);
      return Object.assign({ ok: true, file: abs, rev: op.rev, mode: r.mode }, (o && o.full) ? { text: r.text } : { outline: r.outline }, { problems: r.problems });
    });
  }

  async find(file, query) {
    const abs = this.sandbox.file(file, 'the design');
    return this.exclusive(abs, async () => {
      const op = await this.open(abs);
      const r = await this.engine.call(abs, 'find', { query });
      if (!r.ok) fail(r);
      return { ok: true, file: abs, rev: op.rev, query, matches: r.matches };
    });
  }

  async render(file, o) {
    o = o || {};
    const abs = this.sandbox.file(file, 'the design');
    return this.exclusive(abs, async () => {
      await this.open(abs);
      const t0 = Date.now();
      const page = o.page == null ? 0 : (o.page === 'all' ? 'all' : (/^\d+$/.test(String(o.page)) ? Number(o.page) : String(o.page)));
      const r = await this.engine.call(abs, 'render', { page, scale: o.scale ? Number(o.scale) : 1, format: o.format || 'png', maxEdge: o.maxEdge, transparent: !!o.transparent, quality: o.quality }, 180000);
      if (!r.ok) fail(r);
      r.ms = Date.now() - t0;
      return r;
    });
  }
  /* Writes render output: -o out.png → out.png (one page) or out-<n>.png (several). */
  writeRender(r, out, format) {
    const files = [];
    const ext = { png: '.png', jpg: '.jpg', jpeg: '.jpg', webp: '.webp', pdf: '.pdf' }[format || 'png'];
    r.pages.forEach((p) => {
      let target = out;
      if (r.pages.length > 1) target = out.replace(/(\.[a-z0-9]+)?$/i, (m) => '-' + p.index + (m || ext));
      const abs = this.sandbox.file(target, 'the output');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(p.data, 'base64'));
      files.push({ file: abs, page: p.index, width: p.width, height: p.height, bytes: p.bytes, mime: p.mime });
    });
    return files;
  }

  /* apply(file, ops, { dryRun, partial, ifRev, label }) — the same operations as LEAgent.apply. */
  async apply(file, ops, o) {
    o = o || {};
    const abs = this.sandbox.file(file, 'the design');
    return this.exclusive(abs, async () => {
      const t0 = Date.now();
      const op = await this.open(abs);
      if (o.ifRev && o.ifRev !== op.rev) throw new LEError('conflict', 'The design changed since revision ' + o.ifRev + ' (it is now ' + op.rev + '). Read it again and retry.', { rev: op.rev });
      const img = F.collectImages(this.sandbox, abs, F.opsImageRefs(ops));
      const r = await this.engine.call(abs, 'apply', { ops, files: img.files, partial: !!o.partial, dryRun: !!o.dryRun, label: o.label });
      if (!r || !r.ok) {
        const e = new LEError((r && r.code) || 'invalid', ((r && r.errors && r.errors[0]) ? (r.errors[0].path ? r.errors[0].path + ': ' : '') + r.errors[0].message : 'The operations were refused.'), { errors: (r && r.errors) || [], results: r && r.results });
        throw e;
      }
      const rev = F.rev(r.text);
      const changed = r.text !== op.text;
      if (!o.dryRun && changed) F.writeAtomic(abs, r.text);
      if (!o.dryRun) this.loaded.set(abs, { rev, srcOf: r.srcOf, problems: r.problems, warnings: r.warnings, remote: r.remote, normalized: r.text });
      return {
        ok: true, file: abs, dryRun: !!o.dryRun, written: !o.dryRun && changed, rev: o.dryRun ? op.rev : rev, previousRev: op.rev, applied: r.applied, results: r.results,
        failed: r.errors && r.errors.length ? r.errors : undefined, problems: r.problems, newProblems: r.newProblems, mode: r.mode, ms: Date.now() - t0,
        text: o.returnText ? r.text : undefined
      };
    });
  }

  async catalog(kind, query, o) {
    const r = await this.engine.call('catalog', 'catalog', { kind, query: query || '', limit: (o && o.limit) || 60 });
    if (!r.ok) fail(r);
    return Object.assign({ kind, query: query || '' }, r);
  }

  async make(id, values, out, o) {
    o = o || {};
    const abs = this.sandbox.file(out, 'the new design');
    if (fs.existsSync(abs) && !o.force) throw new LEError('exists', abs + ' already exists (use --force to replace it).');
    const r = await this.engine.call('make', 'make', { id, values: values || {}, style: o.style, size: o.size });
    if (!r.ok) fail(r);
    const loaded = await this.loadText(abs, r.text, abs);
    F.writeAtomic(abs, loaded.text);
    this.loaded.set(abs, { rev: F.rev(loaded.text), srcOf: loaded.srcOf, problems: loaded.problems, warnings: loaded.warnings, remote: loaded.remote, normalized: loaded.text });
    return { ok: true, file: abs, maker: id, rev: F.rev(loaded.text), problems: loaded.problems, warnings: r.warnings };
  }

  /* convert: .ledesign.json ↔ .leproject; images embedded (data URIs) or as an assets/ folder next to the output. */
  async convert(input, output, o) {
    o = o || {};
    const src = this.sandbox.file(input, 'the input');
    const dst = this.sandbox.file(output, 'the output');
    if (fs.existsSync(dst) && !o.force) throw new LEError('exists', dst + ' already exists (use --force to replace it).');
    const key = 'convert:' + src;
    const isProject = /\.leproject$/i.test(src);
    if (isProject) {
      const st = fs.statSync(src);
      if (st.size > 400 * 1024 * 1024) throw new LEError('too-large', 'This project file is too large.');
      const r = await this.engine.call(key, 'importProject', { data: fs.readFileSync(src).toString('base64'), name: path.basename(src) });
      if (!r.ok) fail(r);
    } else {
      const text = F.readDesign(src);
      await this.loadText(key, text, src);
    }
    let result;
    if (/\.leproject$/i.test(dst)) {
      const r = await this.engine.call(key, 'exportProject', {});
      if (!r.ok) fail(r);
      F.writeAtomic(dst, Buffer.from(r.data, 'base64'));
      result = { ok: true, from: src, to: dst, format: 'leproject', bytes: Buffer.from(r.data, 'base64').length };
    } else {
      const images = o.images === 'paths' || o.images === 'assets' ? 'paths' : 'embed';
      const r = await this.engine.call(key, 'exportText', { images });
      if (!r.ok) fail(r);
      const written = [];
      for (const a of r.assets || []) {
        if (a.missing || !a.path) continue;
        const target = path.join(path.dirname(dst), a.path);
        if (!F.inside(path.resolve(target), path.dirname(dst))) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(a.data, 'base64'));
        written.push(path.relative(process.cwd(), target));
      }
      F.writeAtomic(dst, r.text);
      result = { ok: true, from: src, to: dst, format: 'ledesign', images, assets: written, bytes: Buffer.byteLength(r.text) };
    }
    await this.engine.closePage(key);
    return result;
  }

  /* doctor: is a browser there, which versions, can it render the hello-world example, is the network sealed. */
  async doctor() {
    const out = { ok: false, node: process.version, platform: process.platform + ' ' + process.arch, checks: [] };
    const add = (name, ok, detail) => { out.checks.push({ name, ok, detail }); return ok; };
    add('Node 20 or later', Number(process.versions.node.split('.')[0]) >= 20, process.version);
    let browser;
    try { browser = require('./browser-find').findBrowser(this.opts.browser); add('Browser found', true, browser.name + ' at ' + browser.path + ' (' + browser.source + ')'); } catch (e) { add('Browser found', false, e.message); return out; }
    let site;
    try { site = require('./static-server').siteRoot(); add('App files', true, site); } catch (e) { add('App files', false, e.message); return out; }
    const t0 = Date.now();
    try { await this.engine.start(); add('Browser starts headless (' + this.engine.cdp.transport + ' transport)', true, (this.engine.version.product || '') + ' in ' + (Date.now() - t0) + ' ms'); } catch (e) { add('Browser starts headless', false, e.message); return out; }
    const t1 = Date.now();
    let info;
    try { info = await this.engine.call('doctor', 'info'); add('Editor loads', !!info.ready, 'adapter: ' + info.mode + (info.agent ? ', LEAgent protocol ' + JSON.stringify(info.agent.protocol) : ', LEAgent not present (fallback adapter)') + ' in ' + (Date.now() - t1) + ' ms'); } catch (e) { add('Editor loads', false, e.message); return out; }
    try {
      const text = fs.readFileSync(path.join(site, 'examples', 'designs', 'hello-world.ledesign.json'), 'utf8');
      const t2 = Date.now();
      await this.loadText('doctor', text, null);
      const r = await this.engine.call('doctor', 'render', { format: 'png', maxEdge: 540 });
      add('Renders hello-world', !!(r.ok && r.pages && r.pages[0] && r.pages[0].bytes > 1000), r.ok ? r.pages[0].width + '×' + r.pages[0].height + ' PNG, ' + r.pages[0].bytes + ' bytes in ' + (Date.now() - t2) + ' ms' : JSON.stringify(r.errors));
    } catch (e) { add('Renders hello-world', false, e.message); }
    try {
      const s = await this.engine.call('doctor', 'selfTest');
      add('Network sealed (outside requests refused)', !!s.sealed, s.sealed ? 'a test request to example.com was refused' : 'a request left the page!');
    } catch (e) { add('Network sealed', false, e.message); }
    out.ok = out.checks.every((c) => c.ok);
    out.browser = browser;
    out.version = this.engine.version;
    return out;
  }
}

module.exports = { Service, PROBLEM_KINDS, linkCore };
