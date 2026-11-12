'use strict';
/* A small static server for the LocalEditor site, bound to 127.0.0.1 only.
   - Every request must carry Host 127.0.0.1:<port> or localhost:<port> (DNS-rebinding protection);
     a request with an Origin header must come from that same origin.
   - Optional path prefix (a random per-run token): only /<token>/… is served.
   - Dotfiles, .git, node_modules and the CLI package itself are never served. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.traineddata': 'application/octet-stream'
};

/* The site root: <package>/site (filled by `npm pack` via scripts/prepack.js) or the repository checkout two levels up. */
function siteRoot() {
  const pkg = path.resolve(__dirname, '..');
  const candidates = [path.join(pkg, 'site'), path.resolve(pkg, '..', '..')];
  if (process.env.LE_SITE_ROOT) candidates.unshift(path.resolve(process.env.LE_SITE_ROOT));
  for (const c of candidates) if (fs.existsSync(path.join(c, 'studio', 'index.html')) && fs.existsSync(path.join(c, 'assets', 'js', 'le-design.js'))) return c;
  const err = new Error('The LocalEditor app files were not found (looked in ' + candidates.join(', ') + ').');
  err.code = 'no-site';
  throw err;
}

const token = (n) => crypto.randomBytes(n || 18).toString('base64url');

function hostOk(req, port) {
  const host = String(req.headers.host || '').toLowerCase();
  if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) return false;
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && origin !== 'http://127.0.0.1:' + port && origin !== 'http://localhost:' + port) return false;
  if (origin === 'null') return false;
  /* Fetch metadata: refuse anything a browser marks as cross-site. */
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

function securityHeaders(extra) {
  return Object.assign({
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN'
  }, extra || {});
}

const DENY = /(^|\/)(\.[^/]*|node_modules|tools\/le-cli)(\/|$)/;

/* Serves a file from root for a URL path (already without the prefix). Returns true when handled. */
function serveFile(root, urlPath, req, res, opts) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch (e) { res.writeHead(400, securityHeaders()); res.end(); return true; }
  if (p.indexOf('\0') >= 0) { res.writeHead(400, securityHeaders()); res.end(); return true; }
  if (p.endsWith('/')) p += 'index.html';
  const rel = path.posix.normalize(p).replace(/^\/+/, '');
  if (rel.startsWith('..') || DENY.test(rel) || (opts && opts.deny && opts.deny.test(rel))) { res.writeHead(404, securityHeaders()); res.end('Not found'); return true; }
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) { res.writeHead(404, securityHeaders()); res.end('Not found'); return true; }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { res.writeHead(301, securityHeaders({ Location: (opts && opts.prefix || '') + '/' + rel + '/' })); res.end(); return; }
    if (err || !st.isFile()) { res.writeHead(404, securityHeaders({ 'Content-Type': 'text/plain' })); res.end('Not found'); return; }
    res.writeHead(200, securityHeaders({ 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size }));
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
  return true;
}

/* start({ root, prefix: true|string|'' , port: 0, handler(req, res, url) → bool, deny }) → { server, port, origin, base, prefix, close } */
function start(opts) {
  opts = opts || {};
  const root = opts.root || siteRoot();
  const prefix = opts.prefix === true ? '/' + token(18) : (opts.prefix ? '/' + String(opts.prefix).replace(/^\/+/, '') : '');
  return new Promise((resolve, reject) => {
    let port = 0;
    const server = http.createServer((req, res) => {
      if (!hostOk(req, port)) { res.writeHead(403, securityHeaders({ 'Content-Type': 'text/plain' })); res.end('Forbidden: wrong Host or Origin.'); return; }
      const url = req.url || '/';
      if (opts.handler) {
        let handled = false;
        try { handled = opts.handler(req, res, url); } catch (e) { if (!res.headersSent) { res.writeHead(500, securityHeaders()); } res.end(); return; }
        if (handled) return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, securityHeaders()); res.end(); return; }
      if (opts.swNoop && url.split('?')[0] === prefix + '/sw.js') {
        res.writeHead(200, securityHeaders({ 'Content-Type': 'text/javascript; charset=utf-8' }));
        res.end("self.addEventListener('install',function(){self.skipWaiting()});self.addEventListener('activate',function(e){e.waitUntil(self.registration.unregister())});");
        return;
      }
      if (prefix) {
        if (url !== prefix && url.indexOf(prefix + '/') !== 0) { res.writeHead(404, securityHeaders()); res.end('Not found'); return; }
        serveFile(root, url.slice(prefix.length) || '/', req, res, { prefix, deny: opts.deny });
      } else serveFile(root, url, req, res, { prefix: '', deny: opts.deny });
    });
    server.on('error', reject);
    server.keepAliveTimeout = 2000;
    server.listen(opts.port || 0, '127.0.0.1', () => {
      port = server.address().port;
      const origin = 'http://127.0.0.1:' + port;
      resolve({
        server, port, origin, prefix, root, base: origin + prefix,
        close: () => new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); })
      });
    });
  });
}

module.exports = { start, siteRoot, token, hostOk, securityHeaders, serveFile, TYPES };
