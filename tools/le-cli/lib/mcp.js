'use strict';
/* localeditor mcp — a Model Context Protocol server over stdio, written directly on JSON-RPC 2.0 (no SDK).
   Messages are newline-delimited JSON on stdin/stdout; logs go to stderr. Only files under the root folder
   (--root, default: the folder the server was started in) can be read or written. */
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const F = require('./files');

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const PATH = { type: 'string', description: 'Path of the design file (.ledesign.json), relative to the server root folder.' };
const OPS_DOC = 'A list of operations, applied atomically (all or nothing). Layers are addressed by their id. Examples: ' +
  '{"op":"add","layer":{"id":"title","type":"text","text":"Hello","font":"Anton","size":120,"x":"center","y":80,"w":"90%","h":240,"fit":"shrink","color":"#17131F"}}; ' +
  '{"op":"add","layer":{"id":"hero","type":"image","slot":true,"x":0,"y":400,"w":1080,"h":600}}; ' +
  '{"op":"add","layer":{"id":"badge","type":"shape","shape":"ellipse","fill":"#E0B354","x":800,"y":60,"w":200,"h":200}}; ' +
  '{"op":"update","id":"title","set":{"color":"#FFFFFF","text":"New words","h":"auto"}} (null removes a field); {"op":"remove","id":"badge"}; ' +
  '{"op":"reorder","id":"title","to":"front"}; {"op":"page.background","background":"#14213D"}; {"op":"page.add","width":1080,"height":1350,"id":"slide-2"}; ' +
  '{"op":"page.resize","width":1080,"height":1920}; {"op":"text.replace","find":"2025","replace":"2026","page":"all"}; {"op":"image.fill","id":"hero","src":"assets/beach.jpg"}; ' +
  '{"op":"align","ids":["title"],"edge":"center"}; {"op":"note.resolve","id":"note-1","reply":"Made it warmer"}. ' +
  'Positions accept numbers (px), "50%", or left/center/right (x) and top/center/bottom (y). Text without "h" is measured; "fit":"shrink" needs "h". ' +
  'Expert effects (non-destructive, on any layer; types and parameters from catalog_search kind "fx"): ' +
  '{"op":"fx.add","layer":"hero","entry":{"type":"exposure","p":{"ev":0.4}}}; {"op":"fx.update","layer":"hero","id":"exposure","p":{"ev":0.2},"amount":0.8} (id: the entry id, or its type when the layer has one of that kind); ' +
  '{"op":"fx.remove","layer":"hero","id":"exposure"}; {"op":"fx.reorder","layer":"hero","id":"grain","index":0}; ' +
  '{"op":"mask.set","layer":"hero","fx":"gaussian-blur","mask":{"parts":[{"kind":"radial","cx":0.5,"cy":0.4,"rx":0.3,"ry":0.3,"feather":0.5,"invert":true}]}} (without fx: the layer mask); ' +
  '{"op":"adjust.add","fx":[{"type":"contrast","p":{"amount":15}}],"above":"hero"}; {"op":"transform.set","layer":"hero","quad":[[0,40],[1000,0],[1000,800],[0,760]]}. ' +
  '{"op":"fx.call","layer":"hero","name":"composite.stage","args":{"preset":"soft-table-reflection"}} runs a helper that answers with effect operations (catalog_search kind "fx", query "actions" lists them; the helper sees the design as it was before this batch). ' +
  'map.generate, raw.open, hdr.merge, raw.settings and raw.autoTone need the design open in the studio (agent mode), not a file. ' +
  'Fonts, icons, shapes, recipes and effects must come from catalog_search.';

const TOOLS = [
  {
    name: 'design_new', title: 'Create a design',
    description: 'Create a new .ledesign.json design file with one empty page, or a copy of a built-in example. Then add layers with design_apply. Fails if the file exists unless overwrite is true.',
    inputSchema: { type: 'object', properties: {
      path: PATH,
      width: { type: 'integer', minimum: 16, maximum: 20000, description: 'Page width in px (default 1080).' },
      height: { type: 'integer', minimum: 16, maximum: 20000, description: 'Page height in px (default 1080).' },
      preset: { type: 'string', description: 'A size preset instead of width/height, e.g. "instagram-portrait", "story-reel", "youtube-thumbnail" (catalog_search kind "sizes").' },
      from_example: { type: 'string', description: 'Start from a built-in example: hello-world, quote-card, summer-sale-post, sale-banner, travel-story, youtube-thumbnail, photo-collage, tips-carousel, event-invite, certificate.' },
      name: { type: 'string', description: 'Design name.' },
      background: { type: 'string', description: 'Page colour, e.g. "#FFF3E2".' },
      overwrite: { type: 'boolean', default: false }
    }, required: ['path'], additionalProperties: false }
  },
  {
    name: 'design_read', title: 'Read a design',
    description: 'Read a design. mode "outline" (default) lists pages and every layer with its id, type, text and box — use it before changing anything. mode "full" returns the whole normalised file. Also returns the revision (rev) and current problems.',
    inputSchema: { type: 'object', properties: { path: PATH, mode: { type: 'string', enum: ['outline', 'full'], default: 'outline' } }, required: ['path'], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'design_apply', title: 'Change a design',
    description: 'Apply a batch of operations to a design and write it back (normalised). Returns the new rev, per-operation results and any NEW problems the change caused (overflowing text, off-page layers, low contrast…). ' +
      'Atomic: if one operation is invalid nothing is written and the error names the operation (/ops/<i>/…). Set render:true to get a picture of the result in the same call.',
    inputSchema: { type: 'object', properties: {
      path: PATH,
      ops: { type: 'array', items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] }, minItems: 1, maxItems: 2000, description: OPS_DOC },
      dry_run: { type: 'boolean', default: false, description: 'Check the operations and report problems without writing.' },
      partial: { type: 'boolean', default: false, description: 'Keep the operations that work and list the ones that failed.' },
      if_rev: { type: 'string', description: 'Only apply if the file is still at this rev (from design_read); otherwise error "conflict".' },
      render: { type: 'boolean', default: false, description: 'Also return an image of the first changed page.' }
    }, required: ['path', 'ops'], additionalProperties: false }
  },
  {
    name: 'design_check', title: 'Check a design for problems',
    description: 'List problems in a design: text overflowing its box, text running past the page edge, layers off the page, low text contrast, missing or remote images, unknown fonts, icons or shapes. Each has a kind, the layer id and a JSON pointer. Fix them with design_apply and check again.',
    inputSchema: { type: 'object', properties: { path: PATH }, required: ['path'], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'design_render', title: 'Look at a design',
    description: 'Render a page with the real editor and return it as an image, downscaled to max_edge (default 1024 px) so you can see your work. Optionally also save the full-size file with save_to.',
    inputSchema: { type: 'object', properties: {
      path: PATH,
      page: { type: ['integer', 'string'], description: 'Page index from 0, or a page id. Default 0.' },
      max_edge: { type: 'integer', minimum: 64, maximum: 4096, default: 1024 },
      format: { type: 'string', enum: ['png', 'jpg', 'webp'], default: 'png' },
      save_to: { type: 'string', description: 'Optional output path (png, jpg, webp or pdf) under the root folder, written at full size.' }
    }, required: ['path'], additionalProperties: false },
    annotations: { readOnlyHint: false }
  },
  {
    name: 'design_find', title: 'Find layers',
    description: 'Find layers whose id, name, type, text, font or image path contains the query. Returns ids, pages, JSON pointers and boxes.',
    inputSchema: { type: 'object', properties: { path: PATH, query: { type: 'string' } }, required: ['path', 'query'], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'catalog_search', title: 'Search the catalogues',
    description: 'What exists offline: fonts (families and weights), icons (ids like "lucide:sun"; needs a query), shapes, recipes (photo looks), makers (guided designs and their inputs), layouts (collage layouts; query = photo count) sizes (page presets) and fx (expert effects: query a word for the index, an effect id for its parameters and an example entry, "schema" for blends, mask kinds and limits). Use only names from here.',
    inputSchema: { type: 'object', properties: {
      kind: { type: 'string', enum: ['fonts', 'icons', 'shapes', 'recipes', 'makers', 'layouts', 'sizes', 'fx'] },
      query: { type: 'string', description: 'Optional words to filter by (required for icons).' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 40 }
    }, required: ['kind'], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'design_make', title: 'Make a design from a maker',
    description: 'Build a finished, editable design from a quick maker (quote card, review card, receipt list, milestone…) and form values. List makers and their inputs with catalog_search kind "makers". Photo inputs become empty slots.',
    inputSchema: { type: 'object', properties: {
      maker: { type: 'string' }, path: PATH, values: { type: 'object', description: 'Form values by input key.' },
      style: { type: 'string' }, size: { type: 'string' }, overwrite: { type: 'boolean', default: false }
    }, required: ['maker', 'path'], additionalProperties: false }
  },
  {
    name: 'design_validate', title: 'Validate a design',
    description: 'Validate a design file (path) or design JSON text (text) without changing anything. Unsafe or malformed input is refused with { path, message } errors (JSON pointers).',
    inputSchema: { type: 'object', properties: { path: PATH, text: { type: 'string', description: 'Design JSON to validate instead of a file.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'design_link_status', title: 'Live link status',
    description: 'When a person has the design open live (localeditor link / serve --open), the bridge writes <name>.le/status.json after every sync: { ok, rev, errors, warnings, conflicts, notes }. This returns it, plus open notes. Conflicts list your changes that lost to the person editing the same layer.',
    inputSchema: { type: 'object', properties: { path: PATH }, required: ['path'], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'notes_read', title: 'Read notes from the person',
    description: 'Notes the person pinned in the studio ("make this warmer"), each with an id, text, the layer it points at and status open|done. Read them, make the change with design_apply, then notes_resolve.',
    inputSchema: { type: 'object', properties: { path: PATH, status: { type: 'string', enum: ['open', 'done', 'all'], default: 'open' } }, required: ['path'], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'notes_resolve', title: 'Mark a note done',
    description: 'Mark a note as done (or reopen it) with an optional short reply the person sees.',
    inputSchema: { type: 'object', properties: { path: PATH, id: { type: 'string' }, reply: { type: 'string', maxLength: 2000 }, status: { type: 'string', enum: ['done', 'open'], default: 'done' } }, required: ['path', 'id'], additionalProperties: false }
  }
];

const PROMPTS = [
  {
    name: 'design_from_brief', title: 'Design from a brief',
    description: 'Create a LocalEditor design from a short brief, check it and look at it.',
    arguments: [{ name: 'brief', description: 'What to make, for whom, with which words.', required: true }, { name: 'path', description: 'Where to save it (default design.ledesign.json).', required: false }, { name: 'size', description: 'A preset or WxH (default instagram-portrait).', required: false }]
  },
  {
    name: 'fix_problems', title: 'Fix a design\'s problems',
    description: 'Check a design, fix every problem with one batch of operations, and confirm with a render.',
    arguments: [{ name: 'path', description: 'The design file.', required: true }]
  }
];

function siteFile(rel) { return path.join(require('./static-server').siteRoot(), rel); }
function resources() {
  const list = [
    { uri: 'localeditor://docs/format', name: 'format', title: 'The open design format (.ledesign.json)', mimeType: 'text/markdown', file: 'docs/FORMAT-DESIGN.md' },
    { uri: 'localeditor://docs/agent-cli', name: 'agent-cli', title: 'Working fast: CLI, MCP and the write → check → render loop', mimeType: 'text/markdown', file: 'docs/AGENT-CLI.md' },
    { uri: 'localeditor://schema/design-1.json', name: 'schema', title: 'JSON Schema, format 1', mimeType: 'application/schema+json', file: 'schema/design-1.json' }
  ];
  try {
    fs.readdirSync(siteFile('examples/designs')).filter((f) => f.endsWith('.ledesign.json')).sort().forEach((f) => {
      const n = f.replace('.ledesign.json', '');
      list.push({ uri: 'localeditor://examples/' + n, name: 'example-' + n, title: 'Example: ' + n, mimeType: 'application/json', file: 'examples/designs/' + f });
    });
  } catch (e) { /* no examples */ }
  return list.filter((r) => fs.existsSync(siteFile(r.file)));
}

class RpcError extends Error { constructor(code, message, data) { super(message); this.rpc = code; this.data = data; } }

class McpServer {
  constructor(opts) {
    this.opts = opts || {};
    this.root = path.resolve(this.opts.root || process.cwd());
    this.svc = null;
    this.initialized = false;
    this.protocol = VERSIONS[0];
    this.write = this.opts.write || ((obj) => process.stdout.write(JSON.stringify(obj) + '\n'));
  }
  service() {
    if (!this.svc) {
      const { Service } = require('./service');
      this.svc = new Service({ root: this.root, browser: this.opts.browser, transport: this.opts.transport, allowHosts: this.opts.allowHosts, allowPaths: this.opts.allowPaths, verbose: this.opts.verbose, adapter: this.opts.adapter });
    }
    return this.svc;
  }
  async close() { if (this.svc) await this.svc.close(); }

  async handleLine(line) {
    line = line.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { this.write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: ' + e.message } }); return; }
    if (Array.isArray(msg)) {
      if (!msg.length) { this.write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: empty batch' } }); return; }
      const outs = (await Promise.all(msg.map((m) => this.handle(m)))).filter(Boolean);
      if (outs.length) this.write(outs);
      return;
    }
    const out = await this.handle(msg);
    if (out) this.write(out);
  }

  async handle(msg) {
    const isReq = msg && typeof msg === 'object' && !Array.isArray(msg) && msg.jsonrpc === '2.0' && typeof msg.method === 'string';
    const id = msg && typeof msg === 'object' && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null;
    if (!isReq) {
      if (msg && typeof msg === 'object' && msg.jsonrpc === '2.0' && ('result' in msg || 'error' in msg)) return null; /* a response to us; we send no requests */
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request: expected { "jsonrpc": "2.0", "method": … }' } };
    }
    const notification = !('id' in msg);
    if (!notification && id === null) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: id must be a string or a number' } };
    try {
      const result = await this.dispatch(msg.method, msg.params == null ? {} : msg.params, notification);
      if (notification) return null;
      return { jsonrpc: '2.0', id, result };
    } catch (e) {
      if (notification) return null;
      if (e instanceof RpcError) return { jsonrpc: '2.0', id, error: Object.assign({ code: e.rpc, message: e.message }, e.data ? { data: e.data } : {}) };
      return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error: ' + (e && e.message || e) } };
    }
  }

  async dispatch(method, params, notification) {
    if (typeof params !== 'object' || Array.isArray(params)) throw new RpcError(-32602, 'Invalid params: expected an object');
    switch (method) {
      case 'initialize': {
        const want = params.protocolVersion;
        this.protocol = VERSIONS.includes(want) ? want : VERSIONS[0];
        this.client = params.clientInfo || null;
        return {
          protocolVersion: this.protocol,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false }, logging: {} },
          serverInfo: { name: 'localeditor', title: 'LocalEditor', version: pkg.version },
          instructions: 'LocalEditor designs are plain JSON files (.ledesign.json). Loop: design_read (outline) → design_apply (small batches, layers by id) → design_check → design_render to look → fix. ' +
            'Use only fonts/icons/shapes from catalog_search. Read notes_read for requests from the person. Files are limited to ' + this.root + '. Format guide: resource localeditor://docs/format.'
        };
      }
      case 'notifications/initialized': this.initialized = true; return {};
      case 'notifications/cancelled': return {};
      case 'ping': return {};
      case 'logging/setLevel': return {};
      case 'tools/list': return { tools: TOOLS };
      case 'tools/call': return this.callTool(params.name, params.arguments || {});
      case 'resources/list': return { resources: resources().map((r) => ({ uri: r.uri, name: r.name, title: r.title, mimeType: r.mimeType })) };
      case 'resources/templates/list': return { resourceTemplates: [] };
      case 'resources/read': {
        const r = resources().find((x) => x.uri === params.uri);
        if (!r) throw new RpcError(-32002, 'Resource not found', { uri: params.uri });
        return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: fs.readFileSync(siteFile(r.file), 'utf8') }] };
      }
      case 'prompts/list': return { prompts: PROMPTS };
      case 'prompts/get': return this.prompt(params.name, params.arguments || {});
      default:
        if (notification) return {};
        throw new RpcError(-32601, 'Method not found: ' + method);
    }
  }

  prompt(name, a) {
    if (name === 'design_from_brief') {
      if (!a.brief) throw new RpcError(-32602, 'Missing argument: brief');
      const p = a.path || 'design.ledesign.json';
      return { description: 'Design from a brief', messages: [{ role: 'user', content: { type: 'text', text:
        'Make a LocalEditor design for this brief: ' + a.brief + '\n\n' +
        '1. design_new path "' + p + '" with preset "' + (a.size || 'instagram-portrait') + '".\n' +
        '2. catalog_search for fonts and icons you want; use only those names.\n' +
        '3. design_apply one batch: background, then layers back to front, each with a short readable id. Prefer "x":"center", "w":"90%", text "fit":"shrink" with a fixed "h".\n' +
        '4. design_check; fix every problem with design_apply.\n' +
        '5. design_render and look. Adjust spacing and hierarchy until it is clean, then summarise what you made.' } }] };
    }
    if (name === 'fix_problems') {
      if (!a.path) throw new RpcError(-32602, 'Missing argument: path');
      return { description: 'Fix problems', messages: [{ role: 'user', content: { type: 'text', text:
        'Run design_check on "' + a.path + '". For each problem, decide the smallest fix (shorter text, "fit":"shrink" with a fixed "h", move a layer back on the page, a darker or lighter colour for contrast). ' +
        'Apply all fixes in one design_apply batch, run design_check again until it is clean, then design_render and confirm visually. Also read notes_read and handle open notes.' } }] };
    }
    throw new RpcError(-32602, 'Unknown prompt: ' + name);
  }

  text(obj) { return { type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }; }
  ok(obj, extra) { return { content: [this.text(obj)].concat(extra || []), structuredContent: typeof obj === 'object' ? obj : undefined, isError: false }; }
  err(e) {
    const body = { ok: false, code: e.code || 'error', message: e.message, errors: e.errors || undefined, results: e.results || undefined };
    return { content: [this.text(body)], isError: true };
  }

  async callTool(name, a) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new RpcError(-32602, 'Unknown tool: ' + name);
    if (typeof a !== 'object' || Array.isArray(a)) throw new RpcError(-32602, 'Invalid params: arguments must be an object');
    const bad = checkArgs(tool.inputSchema, a);
    if (bad) return this.err({ code: 'invalid', message: bad });
    const svc = this.service();
    try {
      switch (name) {
        case 'design_new': {
          const size = a.width || a.height ? (a.width || 1080) + 'x' + (a.height || 1080) : null;
          const r = await svc.newDesign(a.path, { size, preset: a.preset, from: a.from_example, name: a.name, background: a.background, force: a.overwrite });
          return this.ok(Object.assign(r, { file: this.rel(r.file) }));
        }
        case 'design_read': {
          const r = await svc.show(a.path, { full: a.mode === 'full' });
          return this.ok(Object.assign(r, { file: this.rel(r.file) }));
        }
        case 'design_apply': {
          const r = await svc.apply(a.path, a.ops, { dryRun: a.dry_run, partial: a.partial, ifRev: a.if_rev, label: 'MCP' });
          r.file = this.rel(r.file);
          if (!a.render) return this.ok(r);
          const pages = (r.results || []).map((x) => x.page).filter((x) => typeof x === 'number');
          const img = await svc.render(a.path, { page: pages.length ? pages[pages.length - 1] : 0, maxEdge: 768, format: 'png' });
          const p = img.pages[0];
          return this.ok(r, [{ type: 'image', data: p.data, mimeType: p.mime }]);
        }
        case 'design_check': {
          const r = await svc.check(a.path);
          return this.ok(Object.assign(r, { file: this.rel(r.file) }));
        }
        case 'design_render': {
          const maxEdge = a.max_edge || 1024;
          const r = await svc.render(a.path, { page: a.page == null ? 0 : a.page, maxEdge, format: a.format || 'png' });
          const p = r.pages[0];
          const info = { ok: true, page: p.index, width: p.width, height: p.height, mime: p.mime, bytes: p.bytes, ms: r.ms };
          if (a.save_to) {
            const fmt = (/\.(png|jpe?g|webp|pdf)$/i.exec(a.save_to) || [, 'png'])[1].toLowerCase().replace('jpeg', 'jpg');
            const full = await svc.render(a.path, { page: a.page == null ? 0 : a.page, format: fmt });
            info.saved = svc.writeRender(full, a.save_to, fmt).map((f) => this.rel(f.file));
          }
          return this.ok(info, [{ type: 'image', data: p.data, mimeType: p.mime }]);
        }
        case 'design_find': {
          const r = await svc.find(a.path, a.query);
          return this.ok(Object.assign(r, { file: this.rel(r.file) }));
        }
        case 'catalog_search': {
          const r = await svc.catalog(a.kind, a.query || '', { limit: a.limit || 40 });
          if (Array.isArray(r.items)) r.items = r.items.slice(0, a.limit || 40);
          if (Array.isArray(r.templates)) r.templates = r.templates.slice(0, 60);
          return this.ok(r);
        }
        case 'design_make': {
          const values = Object.assign({}, a.values || {});
          const r = await svc.make(a.maker, values, a.path, { style: a.style, size: a.size, force: a.overwrite });
          return this.ok(Object.assign(r, { file: this.rel(r.file) }));
        }
        case 'design_validate': {
          if (a.text != null) {
            const r = await svc.engine.call('validate', 'validate', { text: String(a.text), files: {} });
            return this.ok({ ok: !!r.ok, errors: r.errors || [], warnings: r.warnings || [], problems: r.problems || [] });
          }
          if (!a.path) return this.err({ code: 'invalid', message: 'Give "path" or "text".' });
          const r = await svc.validate([a.path]);
          return this.ok(r.files[0]);
        }
        case 'design_link_status': {
          const abs = svc.sandbox.file(a.path, 'the design');
          const dir = F.statusDir(abs);
          let status = null;
          try { status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')); } catch (e) { /* none yet */ }
          const notes = readNotes(abs).filter((n) => n.status !== 'done');
          let previews = [];
          try { previews = fs.readdirSync(dir).filter((f) => /^preview-\d+\.png$/.test(f)).map((f) => this.rel(path.join(dir, f))); } catch (e) { /* none */ }
          return this.ok({ ok: true, linked: !!(status && status.linked), status, openNotes: notes, previews, statusFile: this.rel(path.join(dir, 'status.json')) });
        }
        case 'notes_read': {
          const abs = svc.sandbox.file(a.path, 'the design');
          const want = a.status || 'open';
          const notes = readNotes(abs).filter((n) => want === 'all' || (want === 'done' ? n.status === 'done' : n.status !== 'done'));
          return this.ok({ ok: true, file: this.rel(abs), notes });
        }
        case 'notes_resolve': {
          const r = await svc.apply(a.path, [{ op: 'note.resolve', id: a.id, reply: a.reply, status: a.status || 'done' }], { label: 'MCP' });
          return this.ok({ ok: true, file: this.rel(r.file), rev: r.rev, note: a.id, status: a.status || 'done' });
        }
      }
    } catch (e) {
      return this.err(e);
    }
    return this.err({ code: 'unsupported', message: 'Not implemented: ' + name });
  }
  rel(p) { const r = path.relative(this.root, p); return r || '.'; }
}

function readNotes(abs) {
  try {
    const d = JSON.parse(F.readDesign(abs));
    return Array.isArray(d.notes) ? d.notes : [];
  } catch (e) { return []; }
}

/* A small JSON Schema check for tool arguments (types, required, enums, additionalProperties). */
function checkArgs(schema, a) {
  for (const k of schema.required || []) if (a[k] == null) return 'Missing required argument "' + k + '".';
  for (const k of Object.keys(a)) {
    const s = schema.properties[k];
    if (!s) { if (schema.additionalProperties === false) return 'Unknown argument "' + k + '". Arguments: ' + Object.keys(schema.properties).join(', ') + '.'; continue; }
    const v = a[k];
    if (v == null) continue;
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const ok = types.some((t) => (t === 'integer' ? Number.isInteger(v) : t === 'array' ? Array.isArray(v) : t === 'object' ? (typeof v === 'object' && !Array.isArray(v)) : typeof v === t));
    if (!ok) return 'Argument "' + k + '" must be ' + types.join(' or ') + '.';
    if (s.enum && !s.enum.includes(v)) return 'Argument "' + k + '" must be one of: ' + s.enum.join(', ') + '.';
    if (typeof v === 'number' && ((s.minimum != null && v < s.minimum) || (s.maximum != null && v > s.maximum))) return 'Argument "' + k + '" is out of range.';
    if (Array.isArray(v) && ((s.minItems && v.length < s.minItems) || (s.maxItems && v.length > s.maxItems))) return 'Argument "' + k + '" has the wrong number of items.';
  }
  return null;
}

async function run(args) {
  const server = new McpServer({
    root: args.root || process.cwd(), browser: args.browser, transport: args.transport, allowHosts: args['allow-host'], allowPaths: args['allow-path'], verbose: !!args.verbose,
    adapter: args.adapter || process.env.LE_CLI_ADAPTER
  });
  let buf = '';
  let chain = Promise.resolve();
  let closing = false;
  const finish = async (code) => {
    if (closing) return;
    closing = true;
    await chain.catch(() => {});
    await server.close().catch(() => {});
    process.exit(code || 0);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      /* Requests are handled concurrently; the service serialises work per file. */
      const p = server.handleLine(line).catch((e) => process.stderr.write('mcp: ' + e.message + '\n'));
      chain = chain.then(() => p);
    }
    if (buf.length > 64 * 1024 * 1024) { buf = ''; server.write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large' } }); }
  });
  process.stdin.on('end', () => { if (buf.trim()) chain = chain.then(() => server.handleLine(buf)); finish(0); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => finish(0));
  process.on('unhandledRejection', (e) => process.stderr.write('mcp: ' + (e && e.message || e) + '\n'));
  process.stderr.write('localeditor MCP server ' + pkg.version + ' on stdio · root ' + server.root + '\n');
  return null;
}

module.exports = { run, McpServer, TOOLS, PROMPTS, VERSIONS, checkArgs };
