'use strict';
/* The engine host: a headless Chromium running the real LocalEditor studio, kept warm, spoken to over the
   Chrome DevTools Protocol. One page per open design. The page is sealed: every request that does not go to our own
   127.0.0.1 origin is refused (Fetch interception, plus a dead proxy for anything that slips past it), unless the
   caller allowed that host. The browser and its throwaway profile are removed on close, on exit and on signals. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { findBrowser } = require('./browser-find');
const { pipeTransport, wsTransport } = require('./cdp');
const staticServer = require('./static-server');

const ADAPTER = fs.readFileSync(path.join(__dirname, 'page-adapter.js'), 'utf8');
const live = new Set();

function cleanupSync() {
  for (const e of live) e._killSync();
}
let hooked = false;
function hookProcess() {
  if (hooked) return;
  hooked = true;
  process.on('exit', cleanupSync);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      cleanupSync();
      /* Re-raise the default behaviour unless someone else is listening (serve and mcp install their own handlers). */
      if (process.listenerCount(sig) <= 1) process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  }
}

class Engine {
  /* opts: { browser, transport: 'pipe'|'port', allowHosts: [], verbose, timeout } */
  constructor(opts) {
    this.opts = Object.assign({ transport: 'pipe', allowHosts: [], timeout: 60000 }, opts || {});
    this.pages = new Map();
    this.blocked = [];
    this.console = [];
    this.child = null;
    this.cdp = null;
    this.server = null;
    this.profile = null;
    this.starting = null;
    this.restarts = 0;
    this.timings = {};
  }

  log(...a) { if (this.opts.verbose) process.stderr.write('[engine] ' + a.join(' ') + '\n'); }

  async start() {
    if (this.cdp && !this.cdp.closed) return this;
    if (this.starting) return this.starting;
    this.starting = this._start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async _start() {
    const t0 = Date.now();
    hookProcess();
    live.add(this);
    this.browser = findBrowser(this.opts.browser);
    if (!this.server) this.server = await staticServer.start({ prefix: true, swNoop: true });
    /* Chrome puts its singleton socket in TMPDIR and gives up when that path is long (> ~100 bytes): keep it short,
       and point the browser's TMPDIR into the profile so everything it writes goes when the profile goes. */
    let base = os.tmpdir();
    if (process.platform !== 'win32' && base.length > 60) base = '/tmp';
    this.profile = fs.mkdtempSync(path.join(base, 'localeditor-engine-'));
    const transport = this.opts.transport === 'port' ? 'port' : 'pipe';
    const allow = (this.opts.allowHosts || []).filter((h) => /^[a-z0-9.-]+(:\d+)?$/i.test(h));
    const args = [
      '--headless=new', '--user-data-dir=' + this.profile,
      transport === 'pipe' ? '--remote-debugging-pipe' : '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync',
      '--disable-component-update', '--disable-default-apps', '--disable-domain-reliability', '--disable-client-side-phishing-detection',
      '--disable-breakpad', '--metrics-recording-only', '--mute-audio', '--password-store=basic', '--use-mock-keychain',
      '--disable-features=Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions,AutofillServerCommunication,CertificateTransparencyComponentUpdater',
      '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none',
      /* Anything not on 127.0.0.1 goes to a proxy that does not exist: a second seal behind request interception. */
      '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=' + (allow.length ? allow.join(';') : '127.0.0.1'),
      '--window-size=1280,900', 'about:blank'
    ];
    if (process.platform === 'linux') {
      args.push('--disable-dev-shm-usage');
      if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox');
    }
    const stdio = transport === 'pipe' ? ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'];
    this.log('launch', this.browser.path, transport);
    const childEnv = Object.assign({}, process.env, process.platform === 'win32' ? { TEMP: this.profile, TMP: this.profile } : { TMPDIR: this.profile });
    const child = spawn(this.browser.path, args, { stdio, env: childEnv, detached: process.platform !== 'win32', windowsHide: true });
    this.child = child;
    let stderr = '';
    child.stderr.on('data', (d) => { if (stderr.length < 20000) stderr += d.toString(); });
    child.on('exit', (code, sig) => {
      this.log('browser exited', code, sig);
      if (this.child === child) { this.child = null; this.pages.clear(); }
    });
    child.on('error', () => {});
    try {
      if (transport === 'pipe') this.cdp = pipeTransport(child);
      else {
        const ws = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('The browser did not start within 30 s.\n' + stderr.slice(-2000))), 30000);
          const on = () => { const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr); if (m) { clearTimeout(timer); child.stderr.off('data', on); resolve(m[1]); } };
          child.stderr.on('data', on);
          child.on('exit', () => { clearTimeout(timer); reject(new Error('The browser exited during start.\n' + stderr.slice(-2000))); });
        });
        if (!/^ws:\/\/127\.0\.0\.1:\d+\//.test(ws)) throw new Error('The browser offered a debugging address that is not 127.0.0.1.');
        this.cdp = await wsTransport(ws);
      }
      this.cdp.on('close', () => { this.pages.clear(); });
      this.cdp.on('Fetch.requestPaused', (p, sid) => this._onRequest(p, sid));
      this.cdp.on('Target.attachedToTarget', (p, sid) => this._onAttached(p, sid));
      this.cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' && this.console.length < 200) this.console.push((p.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 400)); });
      this.cdp.on('Runtime.exceptionThrown', (p) => { if (this.console.length < 200) this.console.push('exception: ' + ((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || '').slice(0, 400)); });
      const v = await this.cdp.send('Browser.getVersion', {}, null, 30000).catch((e) => { throw new Error('The browser did not answer: ' + e.message + '\n' + (stderr.length > 2400 ? stderr.slice(0, 1200) + '\n…\n' + stderr.slice(-1200) : stderr)); });
      this.version = v;
    } catch (e) {
      this._killSync();
      throw e;
    }
    this.timings.launch = Date.now() - t0;
    this.log('ready', this.version.product, this.timings.launch + 'ms');
    return this;
  }

  _allowed(url) {
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return true;
    let u;
    try { u = new URL(url); } catch (e) { return false; }
    if (u.origin === this.server.origin && (u.pathname === this.server.prefix || u.pathname.startsWith(this.server.prefix + '/'))) return true;
    if (u.protocol === 'https:' && (this.opts.allowHosts || []).includes(u.host)) return true;
    return false;
  }
  _onRequest(p, sid) {
    const url = p.request && p.request.url || '';
    if (this._allowed(url)) {
      this.cdp.send('Fetch.continueRequest', { requestId: p.requestId }, sid).catch(() => {});
    } else {
      let host = '';
      try { host = new URL(url).host; } catch (e) {}
      if (this.blocked.length < 500) this.blocked.push({ url: url.slice(0, 300), host, at: new Date().toISOString() });
      this.cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }, sid).catch(() => {});
    }
  }
  /* Workers and iframes of a page: seal them too, then let them run. */
  async _onAttached(p, parentSid) {
    const sid = p.sessionId;
    try {
      await this.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sid).catch(() => {});
      await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid).catch(() => {});
    } finally {
      this.cdp.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {});
    }
  }

  /* A warm page for a key (usually a design file path). The studio is opened headless and the adapter installed. */
  async page(key) {
    await this.start();
    key = key || 'default';
    const have = this.pages.get(key);
    if (have && !have.closed) { have.used = Date.now(); return have.ready; }
    if (this.pages.size >= (this.opts.maxPages || 8)) {
      const oldest = [...this.pages.values()].sort((a, b) => a.used - b.used)[0];
      if (oldest) await this.closePage(oldest.key);
    }
    const pg = { key, used: Date.now(), closed: false };
    pg.ready = this._openPage(pg);
    this.pages.set(key, pg);
    try { await pg.ready; } catch (e) { this.pages.delete(key); throw e; }
    return pg.ready;
  }

  async _openPage(pg) {
    const t0 = Date.now();
    const cdp = this.cdp;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    pg.targetId = targetId; pg.sessionId = sessionId;
    const s = (m, p, t) => cdp.send(m, p, sessionId, t);
    await s('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }).catch(() => {});
    const pre = 'window.LE_AGENT_HEADLESS = true;' + (this.opts.adapter === 'fallback' ? 'window.LE_CLI_ADAPTER = "fallback";' : '') +
      'try { localStorage.setItem("le-theme", "light"); } catch (e) {}';
    await s('Page.addScriptToEvaluateOnNewDocument', { source: pre });
    const loaded = new Promise((resolve) => {
      const on = (p, sid) => { if (sid === sessionId) { cdp.off('Page.loadEventFired', on); resolve(); } };
      cdp.on('Page.loadEventFired', on);
    });
    const nav = await s('Page.navigate', { url: this.server.base + '/studio/?agent=headless' });
    if (nav.errorText) throw new Error('The studio did not open: ' + nav.errorText);
    await Promise.race([loaded, new Promise((_, rej) => setTimeout(() => rej(new Error('The studio did not load within 45 s.')), 45000).unref())]);
    const deadline = Date.now() + 45000;
    for (;;) {
      const r = await s('Runtime.evaluate', { expression: '!!(window.LE && window.LE.design && window.LE.Scene && window.LE.link && window.LE.project && window.LEStudio && window.LEStudio.scene)', returnByValue: true });
      if (r.result && r.result.value === true) break;
      if (Date.now() > deadline) throw new Error('The editor did not become ready in the headless browser.');
      await new Promise((r2) => setTimeout(r2, 40));
    }
    const inst = await s('Runtime.evaluate', { expression: ADAPTER + '\n;true', returnByValue: true });
    if (inst.exceptionDetails) throw new Error('The engine adapter failed to install: ' + (inst.exceptionDetails.exception && inst.exceptionDetails.exception.description || inst.exceptionDetails.text));
    this.timings.page = Date.now() - t0;
    pg.call = (fn, arg, timeout) => this._call(pg, fn, arg, timeout);
    return pg;
  }

  async _call(pg, fn, arg, timeout) {
    if (pg.closed || !this.cdp || this.cdp.closed) throw Object.assign(new Error('The engine page is closed.'), { code: 'interrupted' });
    const expr = 'window.__lecli.' + fn + '(' + JSON.stringify(arg === undefined ? {} : arg) + ')';
    const r = await this.cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pg.sessionId, timeout || this.opts.timeout);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('Engine error: ' + ((d.exception && d.exception.description) || d.text || 'unknown').slice(0, 600));
    }
    return r.result ? r.result.value : undefined;
  }

  /* Evaluate arbitrary code in a page (tests and doctor only). */
  async evaluate(key, expression) {
    const pg = await this.page(key);
    const r = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, pg.sessionId);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result && r.result.value;
  }

  /* call(key, fn, arg): runs an adapter function on the warm page for key; restarts the browser once if it died. */
  async call(key, fn, arg, timeout) {
    let pg;
    try {
      pg = await this.page(key);
      return await pg.call(fn, arg, timeout);
    } catch (e) {
      if ((this.cdp && this.cdp.closed) || !this.child) {
        if (this.restarts++ > 3) throw e;
        this.log('browser died; restarting');
        await this._restart();
        pg = await this.page(key);
        const out = await pg.call(fn, arg, timeout);
        if (out && typeof out === 'object') out.restarted = true;
        return out;
      }
      throw e;
    }
  }
  has(key) { const p = this.pages.get(key); return !!(p && !p.closed); }

  async _restart() {
    this._killSync(true);
    this.cdp = null;
    this.pages.clear();
    await this.start();
  }

  async closePage(key) {
    const pg = this.pages.get(key);
    if (!pg) return;
    this.pages.delete(key);
    pg.closed = true;
    if (pg.targetId && this.cdp && !this.cdp.closed) await this.cdp.send('Target.closeTarget', { targetId: pg.targetId }, null, 5000).catch(() => {});
  }

  _killSync(keepServer) {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode == null) {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) {} }
    }
    if (this.cdp && this.cdp.closeSocket) this.cdp.closeSocket();
    if (this.profile) {
      const dir = this.profile;
      this.profile = null;
      for (let i = 0; i < 5; i++) {
        try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { const until = Date.now() + 100; while (Date.now() < until) { /* wait for the browser to let go */ } }
      }
    }
    if (!keepServer && this.server) { try { this.server.server.close(); if (this.server.server.closeAllConnections) this.server.server.closeAllConnections(); } catch (e) {} this.server = null; }
    if (!keepServer) live.delete(this);
  }

  async close() {
    const child = this.child;
    if (this.cdp && !this.cdp.closed && child) {
      await Promise.race([
        this.cdp.send('Browser.close', {}, null, 3000).catch(() => {}),
        new Promise((r) => setTimeout(r, 3000).unref())
      ]);
      await new Promise((r) => { if (!child || child.exitCode != null) return r(); const t = setTimeout(r, 2000); t.unref(); child.once('exit', () => { clearTimeout(t); r(); }); });
    }
    this._killSync();
  }
}

module.exports = { Engine };
