'use strict';
/* localeditor serve / link — the app for people on 127.0.0.1, a small JSON API for agents under /api/<token>/, and the
   live-link bridge between a design file on disk and open studio tabs.

   Security: bound to 127.0.0.1 only; every request must carry our own Host (and Origin, when a browser sends one) and
   must not be marked cross-site by Fetch metadata; every API path carries the per-run token, compared in constant
   time; bodies are JSON only and capped; files are limited to the served folder. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const staticServer = require('./static-server');
const F = require('./files');
const { LEError } = F;

const MAX_BODY = 24 * 1024 * 1024;

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, staticServer.securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') { reject(new LEError('invalid', 'Send JSON with Content-Type: application/json.')); req.resume(); return; }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new LEError('too-large', 'The request body is larger than 24 MB.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new LEError('invalid', 'The body is not valid JSON.')); } });
    req.on('error', reject);
  });
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const STATUS = { invalid: 422, conflict: 409, 'not-found': 404, sandbox: 403, 'too-large': 413, exists: 409, unsupported: 501, 'no-session': 404,
  'consent-refused': 403, 'consent-cancelled': 403, 'consent-timeout': 504, 'consent-tab-closed': 409, 'consent-no-tab': 409 };
function fail(res, e) {
  const code = e.code || 'error';
  json(res, STATUS[code] || (code === 'no-browser' ? 503 : 500), { ok: false, code, message: e.message, errors: e.errors || [{ path: '', message: e.message }], results: e.results, url: e.url });
}
function sse(res) {
  res.writeHead(200, staticServer.securityHeaders({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }));
  res.write('retry: 1500\n\n');
  const send = (event, data) => { try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* closed */ } };
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
  ping.unref();
  res.on('close', () => clearInterval(ping));
  return send;
}

/* Watches one file: fs.watch on its folder (survives an editor's write-then-rename save) plus a slow poll. */
class Watcher {
  constructor(file, onChange) {
    this.file = file;
    this.onChange = onChange;
    this.timer = null;
    this.sig = this.signature();
    const dir = path.dirname(file), base = path.basename(file);
    try {
      this.w = fs.watch(dir, { persistent: false }, (ev, name) => { if (!name || name === base) this.kick(); });
      this.w.on('error', () => {});
    } catch (e) { this.w = null; }
    this.poll = setInterval(() => { if (this.signature() !== this.sig) this.kick(); }, 600);
    this.poll.unref();
  }
  signature() { try { const s = fs.statSync(this.file); return s.size + ':' + s.mtimeMs + ':' + s.ino; } catch (e) { return 'gone'; } }
  kick() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.sig = this.signature(); this.onChange(this.sig); }, 120);
  }
  close() { clearTimeout(this.timer); clearInterval(this.poll); if (this.w) this.w.close(); }
}

/* ------------------------------------------------------------------ the live link */
class Link {
  constructor(hub, abs) {
    this.hub = hub;
    this.svc = hub.svc;
    this.abs = abs;
    this.id = crypto.randomBytes(9).toString('base64url');
    this.clients = new Map(); /* client id → send */
    this.history = new Map();
    this.base = null; this.rev = null; this.srcOf = {};
    this.lastWritten = null;
    this.chain = Promise.resolve();
    this.gone = false;
    this.lastConflicts = [];
    this.errors = [];
    this.seq = 0;
  }
  get name() { return path.basename(this.abs); }
  serial(fn) { const p = this.chain.then(fn, fn); this.chain = p.catch(() => {}); return p; }
  remember(rev, doc) {
    this.history.set(rev, doc);
    while (this.history.size > 40) this.history.delete(this.history.keys().next().value);
  }
  async start() {
    await this.serial(() => this.loadFromDisk(true));
    this.watcher = new Watcher(this.abs, () => this.serial(() => this.loadFromDisk(false)));
    return this;
  }
  broadcast(event, data, except) { for (const [cid, send] of this.clients) if (cid !== except) send(event, data); }

  async loadFromDisk(first) {
    let text;
    try { text = F.readDesign(this.abs); } catch (e) {
      if (!this.gone) {
        this.gone = true;
        this.lastFileText = null;
        this.lastWritten = null;
        this.broadcast('gone', { file: this.name });
        this.writeStatus({ ok: false, errors: [{ path: '', message: 'The design file was deleted or moved. The last good version is still open in the browser.' }] });
      }
      if (first) throw e;
      return;
    }
    this.gone = false;
    /* An editor (or an agent) may be half-way through writing: give a file that is not JSON yet one more look. */
    if (!first) { try { JSON.parse(text); } catch (e) { await new Promise((r) => setTimeout(r, 350)); try { text = F.readDesign(this.abs); } catch (e2) { return; } } }
    if (!first && text === this.lastWritten) return;
    if (!first && this.lastFileText === text) return;
    this.lastFileText = text;
    let r;
    try { r = await this.svc.open(this.abs); } catch (e) {
      this.errors = e.errors || [{ path: '', message: e.message }];
      this.writeStatus({ ok: false, errors: this.errors, warnings: e.warnings || [] });
      this.broadcast('status', { ok: false, errors: this.errors });
      if (first) throw e;
      return;
    }
    this.errors = [];
    const normalized = r.state.normalized;
    this.srcOf = Object.assign({}, this.srcOf, r.state.srcOf || {});
    this.base = JSON.parse(normalized);
    this.rev = F.rev(normalized);
    this.baseText = normalized;
    this.remember(this.rev, this.base);
    this.seq++;
    this.lastConflicts = [];
    if (!first) this.broadcast('doc', { rev: this.rev, seq: this.seq, text: normalized, srcOf: this.srcOf, from: 'file' });
    await this.feedback(r.state.problems);
  }

  /* status.json and preview-<page>.png next to the design, after every sync. */
  writeStatus(extra) {
    const dir = F.statusDir(this.abs);
    const notes = this.base && Array.isArray(this.base.notes) ? this.base.notes : [];
    /* Each write starts from the last status (so a tab connecting does not hide an error), then refreshes the rest. */
    const st = Object.assign({ ok: true, errors: [], warnings: [] }, this.lastStatus || {}, extra || {}, {
      rev: this.rev, file: this.name, updated: new Date().toISOString(), tabs: this.clients.size, conflicts: this.lastConflicts,
      notes: { open: notes.filter((n) => n.status !== 'done').length, list: notes.filter((n) => n.status !== 'done') }
    });
    st.linked = extra && extra.linked === false ? false : !this.hub.closed;
    this.lastStatus = st;
    try { F.writeAtomic(path.join(dir, 'status.json'), JSON.stringify(st, null, 2) + '\n'); } catch (e) { /* folder not writable */ }
    return st;
  }
  async feedback(problems) {
    this.writeStatus({ ok: true, errors: [], warnings: problems || [] });
    if (this.hub.opts.previews === false) return;
    try {
      const r = await this.svc.render(this.abs, { page: 'all', maxEdge: 1080, format: 'png' });
      const dir = F.statusDir(this.abs);
      fs.mkdirSync(dir, { recursive: true });
      r.pages.forEach((p) => F.writeAtomic(path.join(dir, 'preview-' + p.index + '.png'), Buffer.from(p.data, 'base64')));
      for (const f of fs.readdirSync(dir)) { const m = /^preview-(\d+)\.png$/.exec(f); if (m && Number(m[1]) >= r.pages.length) fs.unlinkSync(path.join(dir, f)); }
      this.broadcast('status', { ok: true, rev: this.rev, previews: r.pages.length });
    } catch (e) { /* the status file already says ok; previews are best effort */ }
  }

  /* The person edited in a tab. Three-way merge against the base the tab started from; the person wins per layer. */
  edit(body, client) {
    return this.serial(async () => {
      if (!body || typeof body !== 'object' || !body.doc || typeof body.doc !== 'object') throw new LEError('invalid', 'Send { baseRev, doc, assets }.');
      /* The agent may have written the file a moment ago and the watcher not fired yet: read it first. */
      await this.loadFromDisk(false).catch(() => {});
      const ours = JSON.parse(JSON.stringify(body.doc));
      this.storeAssets(body.assets || {});
      mapSrc(ours, this.srcOf);
      const base0 = this.history.get(body.baseRev) || this.base;
      const core = require('./link-core');
      const m = core.merge(strip(base0), strip(ours), strip(this.base));
      const merged = m.doc;
      /* Notes: the tab may have added some; merge already unioned them. */
      const r = await this.svc.loadText(this.abs, JSON.stringify(merged), this.abs).catch((e) => { throw e; });
      const text = r.text;
      this.lastWritten = text;
      this.lastFileText = text;
      F.writeAtomic(this.abs, text);
      this.svc.loaded.set(this.abs, { rev: F.rev(text), srcOf: r.srcOf, problems: r.problems, warnings: r.warnings, remote: r.remote, normalized: text });
      this.srcOf = Object.assign({}, this.srcOf, r.srcOf || {});
      this.base = JSON.parse(text);
      this.baseText = text;
      this.rev = F.rev(text);
      this.remember(this.rev, this.base);
      this.seq++;
      this.lastConflicts = m.conflicts.map((c) => ({ page: c.page, layer: c.layer, field: c.field, kind: c.kind, kept: 'person', agent: c.agent, message: c.layer ? 'The person changed "' + c.layer + '" while you did; their version was kept. Yours is in "agent".' : 'The person and you both changed ' + (c.field || 'a page') + '; theirs was kept.' }));
      const mergedFromAgent = !core.same(strip(JSON.parse(text)), strip(ours));
      this.broadcast('doc', { rev: this.rev, seq: this.seq, text, srcOf: this.srcOf, from: 'tab' }, client);
      this.feedback(r.problems).catch(() => {});
      return { ok: true, rev: this.rev, seq: this.seq, text, srcOf: this.srcOf, conflicts: this.lastConflicts, merged: mergedFromAgent, problems: r.problems };
    });
  }
  storeAssets(assets) {
    for (const id of Object.keys(assets)) {
      if (!/^[0-9a-f]{64}$/.test(id) || this.srcOf[id]) continue;
      const m = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/=]+)$/.exec(String(assets[id] || ''));
      if (!m) continue;
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 80 * 1024 * 1024) continue;
      if (crypto.createHash('sha256').update(buf).digest('hex') !== id) continue;
      const rel = 'assets/' + id.slice(0, 16) + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
      const target = path.join(path.dirname(this.abs), rel);
      if (!fs.existsSync(target)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, buf); }
      this.srcOf[id] = rel;
    }
  }
  note(body) {
    return this.serial(async () => {
      const text = String((body && body.text) || '').trim();
      if (!text) throw new LEError('invalid', 'A note needs text.');
      const op = { op: 'note.add', note: { text, layer: body.layer || undefined, page: typeof body.page === 'number' ? body.page : undefined, by: 'person', at: new Date().toISOString(), status: 'open' } };
      Object.keys(op.note).forEach((k) => op.note[k] === undefined && delete op.note[k]);
      const r = await this.svc.apply(this.abs, [op], { label: 'note', returnText: true });
      this.lastWritten = r.text; this.lastFileText = r.text;
      this.base = JSON.parse(r.text); this.baseText = r.text; this.rev = r.rev; this.remember(this.rev, this.base);
      this.seq++;
      this.broadcast('doc', { rev: this.rev, seq: this.seq, text: r.text, srcOf: this.srcOf, from: 'note' });
      this.writeStatus({ ok: true, errors: [], warnings: r.problems || [] });
      return { ok: true, rev: this.rev, seq: this.seq, notes: this.base.notes || [] };
    });
  }
  file(rel, res) {
    const got = this.svc.sandbox.image(this.abs, rel);
    if (got.error) { json(res, got.missing ? 404 : 403, { ok: false, code: got.missing ? 'not-found' : 'sandbox', message: got.error }); return; }
    const ext = path.extname(got.abs).toLowerCase();
    const type = staticServer.TYPES[ext];
    if (!type || !/^image\//.test(type) || ext === '.svg') { json(res, 415, { ok: false, code: 'unsupported', message: 'Only images are served.' }); return; }
    res.writeHead(200, staticServer.securityHeaders({ 'Content-Type': type }));
    fs.createReadStream(got.abs).pipe(res);
  }
  close() {
    if (this.watcher) this.watcher.close();
    this.broadcast('bye', { reason: 'The local server stopped.' });
    for (const send of this.clients.values()) { try { send.res.end(); } catch (e) { /* gone */ } }
    this.writeStatus({ linked: false });
  }
}
function strip(d) { const o = JSON.parse(JSON.stringify(d || {})); delete o.$schema; return o; }
function mapSrc(o, srcOf) {
  if (Array.isArray(o)) { o.forEach((x) => mapSrc(x, srcOf)); return; }
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    if (k === 'src' && typeof o[k] === 'string' && /^[0-9a-f]{64}$/.test(o[k]) && srcOf[o[k]]) o[k] = srcOf[o[k]];
    else mapSrc(o[k], srcOf);
  }
}

/* ------------------------------------------------------------------ the hub: static app + API + links */
class Hub {
  constructor(opts) {
    this.opts = opts;
    const { Service } = require('./service');
    this.root = path.resolve(opts.root || process.cwd());
    this.svc = opts.service || new Service({ root: this.root, browser: opts.browser, transport: opts.transport, allowHosts: opts.allowHosts, allowPaths: opts.allowPaths, verbose: opts.verbose, adapter: opts.adapter });
    this.token = opts.token && /^[\w-]{16,64}$/.test(opts.token) ? opts.token : staticServer.token(24);
    this.links = new Map(); /* id → Link */
    this.byFile = new Map(); /* abs → Link */
    this.watchers = new Map();
    this.attaches = new Map(); /* request id → a tool waiting for a person's answer in an open tab */
    this.closed = false;
  }

  /* ---------- consent: driving a tab that is already open ----------
     A tab the command opened itself carries the token in its address (#lt=…): opening it is the person's own act.
     A tab that is already open on another design of this server is different: before it switches to a file a tool
     names, the person is asked in that tab (Allow once / Allow for this session / Refuse). The tool waits here.
     attach(file, { tool, timeout }) → Promise<{ ok, consent: 'once' | 'session' | 'linked', link, file, tab }>, or an
     LEError: consent-refused, consent-cancelled, consent-timeout, consent-tab-closed, consent-no-tab. Nothing is
     remembered on this side; "for this session" is kept by the tab, in memory, until it closes or reloads. */
  connected(cid) { for (const l of this.links.values()) if (l.clients.has(cid)) return l.clients.get(cid); return null; }
  attach(file, opts) {
    opts = opts || {};
    let rid = null;
    const p = (async () => {
      const abs = this.svc.sandbox.file(file, 'the design');
      const l = await this.link(abs);
      const info = { link: l.id, file: path.relative(this.root, abs), url: this.urlFor(l) };
      if (l.clients.size) return Object.assign({ ok: true, consent: 'linked', tabs: l.clients.size }, info);
      const targets = new Map();
      for (const o of this.links.values()) for (const [cid, send] of o.clients) targets.set(cid, send);
      if (!targets.size) throw new LEError('consent-no-tab', 'No open tab is connected to this server. Ask the person to open the address in "url".', { url: info.url });
      const seconds = Math.max(1, Math.min(600, Number(opts.timeout) || 120));
      rid = crypto.randomBytes(9).toString('base64url');
      const tool = String(opts.tool || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 60) || 'A program on this computer';
      return new Promise((resolve, reject) => {
        const req = { rid, tool, folder: this.root, file: info.file, link: l.id, targets, refused: new Set() };
        req.done = (err, val) => {
          if (this.attaches.get(rid) !== req) return;
          clearTimeout(req.timer);
          this.attaches.delete(rid);
          for (const cid of targets.keys()) { const send = this.connected(cid); if (send) send('attach-done', { rid, reason: err ? err.code : 'allowed', by: val ? val.tab : null }); }
          if (err) reject(err); else resolve(Object.assign({ ok: true }, val, info));
        };
        req.timer = setTimeout(() => req.done(new LEError('consent-timeout', 'Nobody answered in the open tab within ' + seconds + ' s. The request was withdrawn; ask the person before trying again.')), seconds * 1000);
        this.attaches.set(rid, req);
        for (const send of targets.values()) send('attach', this.attachInfo(req));
      });
    })();
    p.withdraw = () => { const req = rid && this.attaches.get(rid); if (req) req.done(new LEError('consent-cancelled', 'The tool stopped waiting.')); };
    return p;
  }
  attachInfo(req) { return { rid: req.rid, tool: req.tool, folder: req.folder, file: req.file, link: req.link }; }
  /* A tab's answer: { rid, answer: 'once' | 'session' | 'refuse' | 'cancel' }. */
  answer(cid, body) {
    const req = this.attaches.get(String((body && body.rid) || ''));
    if (!req || !req.targets.has(cid)) throw new LEError('not-found', 'This request is no longer waiting for an answer.');
    const a = body.answer;
    if (a === 'once' || a === 'session') { req.done(null, { consent: a, tab: cid }); return { ok: true, link: req.link }; }
    if (a === 'cancel') { req.done(new LEError('consent-cancelled', 'The person cancelled the request in the tab.')); return { ok: true }; }
    if (a !== 'refuse') throw new LEError('invalid', 'answer is "once", "session", "refuse" or "cancel".');
    req.refused.add(cid);
    this.settle(req);
    return { ok: true };
  }
  /* Refused when every tab that was asked said no; "tab closed" when the tabs went away without an answer. */
  settle(req) {
    const open = [...req.targets.keys()].filter((cid) => !req.refused.has(cid));
    if (open.length) return;
    if (req.refused.size) req.done(new LEError('consent-refused', 'The person refused in the open tab. Do not ask again unless they ask you to.'));
    else req.done(new LEError('consent-tab-closed', 'The tab was closed before anyone answered.'));
  }
  tabOpened(cid, send) { for (const req of this.attaches.values()) if (!req.targets.has(cid)) { req.targets.set(cid, send); send('attach', this.attachInfo(req)); } }
  /* A dropped connection may be a reconnect, so wait a moment before calling the tab closed. */
  tabClosed(cid) {
    if (!this.attaches.size) return;
    const t = setTimeout(() => {
      if (this.connected(cid)) return;
      for (const req of [...this.attaches.values()]) if (req.targets.delete(cid)) this.settle(req);
    }, 2500);
    t.unref();
  }
  async start() {
    this.server = await staticServer.start({ root: staticServer.siteRoot(), prefix: '', swNoop: true, port: Number(this.opts.port) || 0, handler: (req, res, url) => this.route(req, res, url) });
    this.origin = this.server.origin;
    this.api = this.origin + '/api/' + this.token;
    return this;
  }
  async link(file) {
    const abs = this.svc.sandbox.file(file, 'the design');
    if (this.byFile.has(abs)) return this.byFile.get(abs);
    const l = new Link(this, abs);
    await l.start();
    this.links.set(l.id, l);
    this.byFile.set(abs, l);
    return l;
  }
  urlFor(l) { return this.origin + '/studio/?link=' + l.id + '#lt=' + this.token; }

  route(req, res, url) {
    const u = new URL(url, this.origin);
    if (!u.pathname.startsWith('/api/')) return false;
    const rest = u.pathname.slice(5);
    const slash = rest.indexOf('/');
    const tok = slash < 0 ? rest : rest.slice(0, slash);
    if (!safeEqual(tok, this.token)) { json(res, 401, { ok: false, code: 'unauthorized', message: 'Missing or wrong API token.' }); return true; }
    const sub = slash < 0 ? '' : rest.slice(slash + 1);
    this.api_(req, res, sub, u).catch((e) => fail(res, e));
    return true;
  }
  file(u, body) { const f = (body && body.file) || u.searchParams.get('file'); if (!f) throw new LEError('invalid', 'Name the design with "file" (relative to ' + this.root + ').'); return f; }

  async api_(req, res, sub, u) {
    const m = req.method;
    const lm = /^link\/([\w-]{4,64})\/(doc|file|events|edit|note|status|consent)$/.exec(sub);
    if (lm) {
      const l = this.links.get(lm[1]);
      if (!l) { json(res, 404, { ok: false, code: 'not-found', message: 'This link is not active (the server may have restarted). Run localeditor link again.' }); return; }
      const what = lm[2];
      if (what === 'doc' && m === 'GET') { json(res, 200, { ok: true, file: l.name, rev: l.rev, seq: l.seq, text: l.baseText, srcOf: l.srcOf, errors: l.errors }); return; }
      if (what === 'file' && m === 'GET') { l.file(u.searchParams.get('path') || '', res); return; }
      if (what === 'events' && m === 'GET') {
        const send = sse(res);
        send.res = res;
        const cid = /^[\w-]{4,64}$/.test(u.searchParams.get('client') || '') ? u.searchParams.get('client') : crypto.randomBytes(6).toString('hex');
        l.clients.set(cid, send);
        send('hello', { rev: l.rev, file: l.name });
        l.writeStatus();
        this.tabOpened(cid, send);
        res.on('close', () => { if (l.clients.get(cid) === send) l.clients.delete(cid); l.writeStatus(); this.tabClosed(cid); });
        return;
      }
      if (what === 'consent' && m === 'POST') { const b = await readBody(req); json(res, 200, this.answer(u.searchParams.get('client') || '', b)); return; }
      if (what === 'edit' && m === 'POST') { const b = await readBody(req); json(res, 200, await l.edit(b, u.searchParams.get('client'))); return; }
      if (what === 'note' && m === 'POST') { const b = await readBody(req); json(res, 200, await l.note(b)); return; }
      if (what === 'status' && m === 'POST') { await readBody(req); json(res, 200, { ok: true }); return; }
      json(res, 405, { ok: false, code: 'invalid', message: 'Method not allowed.' });
      return;
    }
    if (sub === '' && m === 'GET') { json(res, 200, { ok: true, name: 'localeditor', root: this.root, endpoints: ['GET state?file=', 'POST apply {file, ops, dryRun, partial, ifRev}', 'GET check?file=', 'GET render?file=&page=&scale=&format=', 'GET events?file=', 'GET catalog?kind=&q=', 'POST new {file, size|preset|from}', 'POST link {file}', 'GET links'] }); return; }
    if (sub === 'state' && m === 'GET') { const f = this.file(u); json(res, 200, await this.svc.show(f, { full: u.searchParams.get('full') === '1' })); return; }
    if (sub === 'check' && m === 'GET') { json(res, 200, await this.svc.check(this.file(u))); return; }
    if (sub === 'find' && m === 'GET') { json(res, 200, await this.svc.find(this.file(u), u.searchParams.get('q') || '')); return; }
    if (sub === 'catalog' && m === 'GET') { json(res, 200, await this.svc.catalog(u.searchParams.get('kind') || '', u.searchParams.get('q') || '')); return; }
    if (sub === 'render' && m === 'GET') {
      const fmt = (u.searchParams.get('format') || 'png').toLowerCase();
      const r = await this.svc.render(this.file(u), { page: u.searchParams.get('page') || 0, scale: u.searchParams.get('scale') || 1, maxEdge: Number(u.searchParams.get('maxEdge')) || undefined, format: fmt });
      const p = r.pages[0];
      const buf = Buffer.from(p.data, 'base64');
      res.writeHead(200, staticServer.securityHeaders({ 'Content-Type': p.mime, 'Content-Length': buf.length, 'X-Page': String(p.index), 'X-Width': String(p.width || ''), 'X-Height': String(p.height || '') }));
      res.end(buf);
      return;
    }
    if (sub === 'apply' && m === 'POST') {
      const b = await readBody(req);
      const f = this.file(u, b);
      const r = await this.svc.apply(f, b.ops, { dryRun: !!b.dryRun, partial: !!b.partial, ifRev: b.ifRev, label: 'API' });
      json(res, 200, r);
      return;
    }
    if (sub === 'new' && m === 'POST') { const b = await readBody(req); json(res, 200, await this.svc.newDesign(this.file(u, b), { size: b.size, preset: b.preset, from: b.from, name: b.name, force: !!b.force })); return; }
    if (sub === 'attach' && m === 'POST') {
      const b = await readBody(req);
      const p = this.attach(this.file(u, b), { tool: b.tool, timeout: b.timeout });
      res.on('close', () => { if (!res.writableEnded) p.withdraw(); });
      json(res, 200, await p);
      return;
    }
    if (sub === 'link' && m === 'POST') { const b = await readBody(req); const l = await this.link(this.file(u, b)); json(res, 200, { ok: true, id: l.id, url: this.urlFor(l), file: l.name }); return; }
    if (sub === 'links' && m === 'GET') { json(res, 200, { ok: true, links: [...this.links.values()].map((l) => ({ id: l.id, file: path.relative(this.root, l.abs), rev: l.rev, tabs: l.clients.size })) }); return; }
    if (sub === 'events' && m === 'GET') {
      const abs = this.svc.sandbox.file(this.file(u), 'the design');
      const send = sse(res);
      const w = new Watcher(abs, async (sig) => {
        if (sig === 'gone') { send('gone', { file: path.relative(this.root, abs) }); return; }
        try { const r = await this.svc.check(abs); send('change', { file: path.relative(this.root, abs), rev: r.rev, problems: r.problems }); } catch (e) { send('invalid', { file: path.relative(this.root, abs), errors: e.errors || [{ path: '', message: e.message }] }); }
      });
      send('hello', { file: path.relative(this.root, abs) });
      res.on('close', () => w.close());
      return;
    }
    json(res, 404, { ok: false, code: 'not-found', message: 'No such endpoint. GET /api/<token>/ lists them.' });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.links.values()) l.close();
    await new Promise((r) => setTimeout(r, 150));
    if (this.server) await this.server.close();
    await this.svc.close();
  }
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]] : ['xdg-open', [url]];
  try { const c = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); return true; } catch (e) { return false; }
}

async function serve(args, linkFile) {
  const root = path.resolve(args._[0] && !linkFile ? args._[0] : (linkFile ? path.dirname(path.resolve(linkFile)) : process.cwd()));
  const hub = new Hub({ root, port: args.port, token: args.token, browser: args.browser, transport: args.transport, allowHosts: args['allow-host'], allowPaths: args['allow-path'], verbose: !!args.verbose, previews: args['no-previews'] ? false : true, adapter: args.adapter || process.env.LE_CLI_ADAPTER });
  await hub.start();
  const file = linkFile || args.open;
  let l = null;
  if (file) {
    try { l = await hub.link(path.resolve(file)); } catch (e) { await hub.close(); throw e; }
  }
  const info = { ready: true, url: l ? hub.urlFor(l) : hub.origin + '/studio/', app: hub.origin + '/', api: hub.api + '/', token: hub.token, root, link: l ? { id: l.id, file: l.name, statusDir: F.statusDir(l.abs) } : null };
  if (args.json) process.stdout.write(JSON.stringify(info) + '\n');
  else {
    process.stdout.write('LocalEditor is running at ' + info.app + ' (only this computer can reach it)\n');
    process.stdout.write('API for agents (token printed once): ' + info.api + '\n');
    if (l) process.stdout.write('Linked ' + l.name + ' — open: ' + info.url + '\nFeedback for agents: ' + path.relative(process.cwd(), info.link.statusDir) + '/status.json and preview-<page>.png\n');
    process.stdout.write('Stop with Ctrl+C.\n');
  }
  if (file && !args['no-open'] && !process.env.LE_NO_OPEN) openBrowser(info.url);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await hub.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  process.on('unhandledRejection', (e) => process.stderr.write('serve: ' + (e && e.message || e) + '\n'));
  process.stdin.on('end', () => { if (args['exit-on-stdin-end']) stop(); });
  return null;
}
/* Asks a running `localeditor serve` / `link` (its API base, with the token) to show a design in a tab that is already
   open, and waits for the person's answer there. → the server's answer, or an LEError with its code. */
async function attachVia(api, file, opts) {
  opts = opts || {};
  const m = /^(http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\/api\/[\w-]{16,64})\/?$/.exec(String(api || '').trim());
  if (!m) throw new LEError('invalid', 'Give the API address that "localeditor serve" printed: http://127.0.0.1:<port>/api/<token>/');
  let r;
  try {
    r = await fetch(m[1] + '/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: path.resolve(file), tool: opts.tool, timeout: opts.timeout }) });
  } catch (e) { throw new LEError('not-found', 'No LocalEditor server answers at that address. Is "localeditor serve" still running?'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new LEError(j.code || 'error', j.message || ('The server answered ' + r.status + '.'), { url: j.url });
  return j;
}
async function link(args) {
  const file = args._[0];
  if (!file) { const e = new Error('localeditor link <file>'); e.code = 'usage'; throw e; }
  if (args.attach) {
    const r = await attachVia(args.attach, file, { tool: args.tool || 'localeditor (command line)', timeout: args.timeout });
    if (args.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    else process.stdout.write(r.consent === 'linked' ? r.file + ' is already open in a tab.\n' : 'Allowed (' + (r.consent === 'session' ? 'for this session' : 'once') + '): ' + r.file + ' is now open in the tab.\n');
    return 0;
  }
  return serve(args, file);
}

module.exports = { serve, link, attachVia, Hub, Link, Watcher };
