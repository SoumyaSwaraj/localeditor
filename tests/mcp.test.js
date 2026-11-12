'use strict';
/* `localeditor mcp`: the Model Context Protocol server over stdio, driven as a client would drive it
   (newline-delimited JSON-RPC 2.0). Pointed at Playwright's Chromium through LE_BROWSER. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'tools', 'le-cli', 'bin', 'localeditor.js');
const cases = {};

function workdir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'le-mcp-' + tag + '-'));
  fs.mkdirSync(path.join(d, 'tmp'));
  fs.mkdirSync(path.join(d, 'root'));
  return d;
}

/* A tiny MCP client over the child's stdio. */
function client(dir, extraArgs) {
  const c = spawn(process.execPath, [BIN, 'mcp', '--root', path.join(dir, 'root')].concat(extraArgs || []), {
    cwd: dir, env: Object.assign({}, process.env, { LE_BROWSER: require('playwright').chromium.executablePath(), TMPDIR: path.join(dir, 'tmp') }), stdio: ['pipe', 'pipe', 'pipe']
  });
  const waiting = new Map();
  const lines = [];
  let buf = '', stderr = '';
  c.stderr.on('data', (d) => { stderr += d; });
  c.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let msg; try { msg = JSON.parse(line); } catch (e) { lines.push({ bad: line }); continue; }
      lines.push(msg);
      const key = Array.isArray(msg) ? 'batch' : msg.id;
      if (waiting.has(key)) { waiting.get(key)(msg); waiting.delete(key); }
    }
  });
  let id = 0;
  const api = {
    proc: c, lines, stderr: () => stderr,
    raw(text, key) { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('no answer to ' + text.slice(0, 80) + '\n' + stderr.slice(-500))), 90000); waiting.set(key, (m) => { clearTimeout(t); resolve(m); }); c.stdin.write(text + '\n'); }); },
    req(method, params) { const n = ++id; return api.raw(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }), n); },
    notify(method, params) { c.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); },
    async call(name, args) { const r = await api.req('tools/call', { name, arguments: args }); if (r.error) throw new Error('RPC error ' + JSON.stringify(r.error)); return r.result; },
    data(result) { return JSON.parse(result.content[0].text); },
    async close() { c.stdin.end(); await new Promise((r) => { const t = setTimeout(() => { c.kill('SIGKILL'); r(); }, 15000); c.on('close', () => { clearTimeout(t); r(); }); }); }
  };
  return api;
}

/* A minimal JSON Schema sanity check: what a client validator needs from each tool. */
function schemaOk(s, where) {
  if (!s || s.type !== 'object' || typeof s.properties !== 'object') return where + ': inputSchema must be an object schema with properties';
  for (const [k, v] of Object.entries(s.properties)) {
    const types = [].concat(v.type || []);
    if (!types.length) return where + '.' + k + ': missing type';
    if (types.some((t) => !['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'].includes(t))) return where + '.' + k + ': bad type';
    if (types.includes('array') && !v.items) return where + '.' + k + ': array without items';
  }
  for (const r of s.required || []) if (!s.properties[r]) return where + ': required "' + r + '" is not a property';
  return null;
}

cases['initialize handshake, version negotiation, tools/list with valid schemas, resources and prompts'] = async ({ h }) => {
  const dir = workdir('init');
  const c = client(dir);
  try {
    const init = await c.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    h.assert(init.result && init.result.protocolVersion === '2025-06-18', 'echoes a supported version');
    h.assert(init.result.serverInfo.name === 'localeditor' && init.result.capabilities.tools, 'server info and capabilities');
    c.notify('notifications/initialized', {});
    const old = await c.req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    h.assert.equal(old.result.protocolVersion, '2024-11-05', 'older version accepted');
    const fut = await c.req('initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    h.assert.equal(fut.result.protocolVersion, '2025-06-18', 'unknown version → our latest');
    const tl = await c.req('tools/list', {});
    const names = tl.result.tools.map((t) => t.name);
    ['design_new', 'design_read', 'design_apply', 'design_check', 'design_render', 'design_find', 'catalog_search', 'design_make', 'design_validate', 'design_link_status', 'notes_read', 'notes_resolve']
      .forEach((n) => h.assert(names.includes(n), 'tool ' + n));
    tl.result.tools.forEach((t) => { const bad = schemaOk(t.inputSchema, t.name); h.assert(!bad, bad); h.assert(t.description && t.description.length > 40, t.name + ' has a real description'); });
    const rl = await c.req('resources/list', {});
    const uris = rl.result.resources.map((r) => r.uri);
    h.assert(uris.includes('localeditor://docs/format') && uris.includes('localeditor://schema/design-1.json') && uris.some((u) => /examples\/hello-world/.test(u)), 'resources: ' + uris.join(', '));
    const rr = await c.req('resources/read', { uri: 'localeditor://schema/design-1.json' });
    h.assert(JSON.parse(rr.result.contents[0].text).$schema, 'schema readable');
    const missing = await c.req('resources/read', { uri: 'localeditor://nope' });
    h.assert(missing.error && missing.error.code === -32002, 'unknown resource is an error');
    const pl = await c.req('prompts/list', {});
    h.assert(pl.result.prompts.length >= 2, 'prompts');
    const pg = await c.req('prompts/get', { name: 'design_from_brief', arguments: { brief: 'A bake sale poster' } });
    h.assert(/bake sale/.test(pg.result.messages[0].content.text), 'prompt text');
    h.assert.equal((await c.req('ping', {})).result && 'ok', 'ok', 'ping');
  } finally { await c.close(); }
};

cases['malformed JSON-RPC is answered with proper error objects'] = async ({ h }) => {
  const dir = workdir('bad');
  const c = client(dir);
  try {
    const pe = await c.raw('{ not json', null);
    h.assert(pe.error && pe.error.code === -32700 && pe.id === null, 'parse error');
    const ir = await c.raw(JSON.stringify({ jsonrpc: '1.0', id: 7, method: 'tools/list' }), 7);
    h.assert(ir.error && ir.error.code === -32600, 'invalid request');
    const mn = await c.req('nope/nothing', {});
    h.assert(mn.error && mn.error.code === -32601, 'method not found');
    const ip = await c.req('tools/call', { name: 'no_such_tool', arguments: {} });
    h.assert(ip.error && ip.error.code === -32602, 'unknown tool → invalid params');
    const bp = await c.raw(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: [1, 2] }), 9);
    h.assert(bp.error && bp.error.code === -32602, 'array params refused');
    const badArgs = await c.call('design_read', { path: 'x.ledesign.json', colour: 'red' });
    h.assert(badArgs.isError && /Unknown argument/.test(badArgs.content[0].text), 'tool argument errors are tool results with isError');
    const batch = await c.raw(JSON.stringify([{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]), 'batch');
    h.assert(Array.isArray(batch) && batch.length === 1 && batch[0].id === 'a', 'batch: one answer for the one request');
    const still = await c.req('ping', {});
    h.assert(still.result, 'server still alive after bad input');
  } finally { await c.close(); }
};

cases['every tool end to end over stdio; render returns an image block; notes round trip'] = async ({ h }) => {
  const dir = workdir('tools');
  const c = client(dir);
  try {
    await c.req('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    c.notify('notifications/initialized', {});
    let r = await c.call('design_new', { path: 'poster.ledesign.json', preset: 'instagram-portrait', name: 'Poster' });
    h.assert(!r.isError && c.data(r).file === 'poster.ledesign.json', 'design_new: ' + r.content[0].text);
    r = await c.call('catalog_search', { kind: 'fonts', query: 'display' });
    h.assert(!r.isError && c.data(r).items.length > 0, 'catalog fonts');
    r = await c.call('catalog_search', { kind: 'icons', query: 'heart', limit: 5 });
    h.assert(c.data(r).items.length > 0 && c.data(r).items.length <= 5, 'catalog icons with a limit');
    r = await c.call('design_apply', { path: 'poster.ledesign.json', ops: [
      { op: 'page.background', background: '#14213D' },
      { op: 'add', layer: { id: 'title', type: 'text', text: 'Bake sale', font: 'Anton', size: 160, color: '#FFFFFF', x: 'center', y: 100, w: '86%', h: 240, fit: 'shrink', align: 'center' } },
      { op: 'add', layer: { id: 'badge', type: 'shape', shape: 'ellipse', fill: '#E0B354', x: 800, y: 1100, w: 200, h: 200 } }
    ], render: true });
    h.assert(!r.isError, 'design_apply: ' + r.content[0].text.slice(0, 300));
    const d = c.data(r);
    h.assert(d.applied === 3 && d.rev, 'applied with a rev');
    const img = r.content.find((x) => x.type === 'image');
    h.assert(img && img.mimeType === 'image/png' && Buffer.from(img.data, 'base64').length > 1000, 'render:true returns an image block');
    r = await c.call('design_read', { path: 'poster.ledesign.json' });
    h.assert.equal(c.data(r).outline.pages[0].layers.map((l) => l.id).join(','), 'title,badge', 'design_read outline');
    const rev = c.data(r).rev;
    r = await c.call('design_read', { path: 'poster.ledesign.json', mode: 'full' });
    h.assert(JSON.parse(c.data(r).text).format === 'localeditor-design', 'design_read full');
    r = await c.call('design_find', { path: 'poster.ledesign.json', query: 'bake' });
    h.assert.equal(c.data(r).matches[0].id, 'title', 'design_find');
    r = await c.call('design_check', { path: 'poster.ledesign.json' });
    h.assert(!r.isError && c.data(r).problems.length === 0, 'design_check clean: ' + r.content[0].text.slice(0, 300));
    r = await c.call('design_render', { path: 'poster.ledesign.json', max_edge: 512, save_to: 'out/poster.png' });
    const block = r.content.find((x) => x.type === 'image');
    h.assert(block && block.mimeType === 'image/png', 'design_render returns an image block');
    const buf = Buffer.from(block.data, 'base64');
    h.assert.equal(h.imageInfo(buf).h, 512, 'downscaled to max_edge');
    h.assert.equal(h.imageInfo(fs.readFileSync(path.join(dir, 'root', 'out', 'poster.png'))).h, 1350, 'save_to writes full size');
    r = await c.call('design_apply', { path: 'poster.ledesign.json', ops: [{ op: 'update', id: 'title', set: { x: 0 } }], if_rev: 'stale0000000000' });
    h.assert(r.isError && c.data(r).code === 'conflict', 'if_rev conflict');
    r = await c.call('design_apply', { path: 'poster.ledesign.json', ops: [{ op: 'update', id: 'title', set: { color: '#FEFEFE' } }], if_rev: rev });
    h.assert(!r.isError, 'if_rev current works');
    r = await c.call('design_apply', { path: 'poster.ledesign.json', ops: [{ op: 'remove', id: 'ghost' }] });
    h.assert(r.isError && c.data(r).errors[0].path === '/ops/0/id', 'operation errors name the op');
    r = await c.call('design_validate', { text: JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ layers: [{ id: 'x', type: 'text', text: '<script>' }] }] }) });
    h.assert(!c.data(r).ok && c.data(r).errors[0].path === '/pages/0/layers/0/text', 'design_validate text');
    r = await c.call('design_validate', { path: 'poster.ledesign.json' });
    h.assert(c.data(r).ok, 'design_validate file');
    r = await c.call('catalog_search', { kind: 'makers' });
    const maker = c.data(r).items[0];
    const values = {};
    maker.inputs.forEach((i) => { if (i.type === 'text' || i.type === 'longtext') values[i.key] = 'Hi'; });
    r = await c.call('design_make', { maker: maker.id, path: 'made.ledesign.json', values });
    h.assert(!r.isError && fs.existsSync(path.join(dir, 'root', 'made.ledesign.json')), 'design_make: ' + r.content[0].text.slice(0, 300));
    /* A note the person pinned (written into the file as the bridge does), read and resolved by the agent. */
    const f = path.join(dir, 'root', 'poster.ledesign.json');
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    doc.notes = [{ id: 'note-1', text: 'Make the badge bigger', layer: 'badge', status: 'open', by: 'person' }];
    fs.writeFileSync(f, JSON.stringify(doc, null, 2));
    r = await c.call('notes_read', { path: 'poster.ledesign.json' });
    h.assert(c.data(r).notes.length === 1 && c.data(r).notes[0].layer === 'badge', 'notes_read');
    r = await c.call('notes_resolve', { path: 'poster.ledesign.json', id: 'note-1', reply: 'Done, 260 px now' });
    h.assert(!r.isError, 'notes_resolve: ' + r.content[0].text);
    r = await c.call('notes_read', { path: 'poster.ledesign.json', status: 'all' });
    h.assert(c.data(r).notes[0].status === 'done' && /260/.test(c.data(r).notes[0].reply), 'note done with reply');
    r = await c.call('design_link_status', { path: 'poster.ledesign.json' });
    h.assert(!r.isError && c.data(r).linked === false, 'link status without a link');
  } finally { await c.close(); }
  h.assert.equal(fs.readdirSync(path.join(dir, 'tmp')).filter((x) => x.startsWith('localeditor-engine-')).length, 0, 'engine profile removed when the client closes stdin');
};

cases['the sandbox root is enforced: traversal, absolute paths and symlink escapes are refused'] = async ({ h }) => {
  const dir = workdir('sandbox');
  fs.writeFileSync(path.join(dir, 'outside.ledesign.json'), JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ layers: [] }] }));
  fs.symlinkSync(dir, path.join(dir, 'root', 'escape'));
  const c = client(dir);
  try {
    await c.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    for (const p of ['../outside.ledesign.json', path.join(dir, 'outside.ledesign.json'), 'escape/outside.ledesign.json', 'escape/new.ledesign.json']) {
      const r = await c.call(p.endsWith('new.ledesign.json') ? 'design_new' : 'design_read', { path: p });
      h.assert(r.isError && c.data(r).code === 'sandbox', p + ' refused: ' + r.content[0].text.slice(0, 200));
    }
    h.assert(!fs.existsSync(path.join(dir, 'new.ledesign.json')), 'nothing written outside the root');
    await c.call('design_new', { path: 'x.ledesign.json' });
    const r = await c.call('design_render', { path: 'x.ledesign.json', save_to: '../x.png' });
    h.assert(r.isError && c.data(r).code === 'sandbox' && !fs.existsSync(path.join(dir, 'x.png')), 'outputs outside the root refused too');
  } finally { await c.close(); }
};

module.exports = cases;
