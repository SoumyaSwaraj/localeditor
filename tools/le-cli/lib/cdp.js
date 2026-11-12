'use strict';
/* A minimal Chrome DevTools Protocol client.
   Two transports:
   - pipe (default): --remote-debugging-pipe, NUL-delimited JSON on file descriptors 3 (to Chrome) and 4 (from Chrome).
     No debugging port is opened at all. Works on Node 20 and later.
   - port: --remote-debugging-port=0 on 127.0.0.1, spoken over the WebSocket that Node 22 ships as a global.
   Sessions are "flat" (Target.attachToTarget { flatten: true }), so one connection carries every page. */
const { EventEmitter } = require('events');

class CDP extends EventEmitter {
  constructor(send) {
    super();
    this.setMaxListeners(0);
    this._send = send;
    this._id = 0;
    this._pending = new Map();
    this.closed = false;
  }
  _onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (msg.id != null && this._pending.has(msg.id)) {
      const p = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        const err = new Error(msg.error.message + (msg.error.data ? ' (' + msg.error.data + ')' : ''));
        err.cdp = msg.error; err.method = p.method;
        p.reject(err);
      } else p.resolve(msg.result || {});
      return;
    }
    if (msg.method) this.emit(msg.method, msg.params || {}, msg.sessionId || null);
  }
  _onClose(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this._pending.values()) { clearTimeout(p.timer); p.reject(new Error('The browser connection closed' + (reason ? ' (' + reason + ')' : '') + '.')); }
    this._pending.clear();
    this.emit('close', reason);
  }
  /* send(method, params, sessionId, timeoutMs) */
  send(method, params, sessionId, timeout) {
    if (this.closed) return Promise.reject(new Error('The browser connection is closed.'));
    const id = ++this._id;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    const ms = timeout || 60000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('The browser did not answer ' + method + ' within ' + Math.round(ms / 1000) + ' s.'));
      }, ms);
      if (timer.unref) timer.unref();
      this._pending.set(id, { resolve, reject, timer, method });
      try { this._send(JSON.stringify(msg)); } catch (e) { clearTimeout(timer); this._pending.delete(id); reject(e); }
    });
  }
}

/* Pipe transport over child.stdio[3] (we write) and child.stdio[4] (we read). */
function pipeTransport(child) {
  const out = child.stdio[3], inp = child.stdio[4];
  const cdp = new CDP((text) => { out.write(text + '\0'); });
  let buf = [];
  inp.on('data', (chunk) => {
    let start = 0;
    for (;;) {
      const end = chunk.indexOf(0, start);
      if (end < 0) { if (start < chunk.length) buf.push(chunk.subarray(start)); break; }
      buf.push(chunk.subarray(start, end));
      const text = Buffer.concat(buf).toString('utf8');
      buf = [];
      cdp._onMessage(text);
      start = end + 1;
    }
  });
  inp.on('close', () => cdp._onClose('pipe closed'));
  inp.on('error', () => cdp._onClose('pipe error'));
  out.on('error', () => cdp._onClose('pipe error'));
  cdp.transport = 'pipe';
  return cdp;
}

/* WebSocket transport (Node 22+ global WebSocket). */
function wsTransport(url) {
  return new Promise((resolve, reject) => {
    if (typeof globalThis.WebSocket !== 'function') { reject(new Error('This Node has no built-in WebSocket; use the pipe transport (the default) or Node 22+.')); return; }
    const ws = new globalThis.WebSocket(url);
    const cdp = new CDP((text) => ws.send(text));
    cdp.transport = 'port';
    let open = false;
    ws.addEventListener('open', () => { open = true; resolve(cdp); });
    ws.addEventListener('message', (ev) => cdp._onMessage(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')));
    ws.addEventListener('close', () => { cdp._onClose('socket closed'); if (!open) reject(new Error('Could not connect to the browser.')); });
    ws.addEventListener('error', () => { if (!open) reject(new Error('Could not connect to the browser.')); });
    cdp.closeSocket = () => { try { ws.close(); } catch (e) {} };
  });
}

module.exports = { CDP, pipeTransport, wsTransport };
