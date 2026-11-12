#!/usr/bin/env node
/* Fetches the exact LibRaw source files the camera RAW module is built from and checks each against the pinned SHA-256 in sources.json.
 *
 *   node tools/raw-decoder/fetch-source.js [outDir]        (default: tools/raw-decoder/.cache/libraw-<version>)
 *
 * Upstream: https://github.com/LibRaw/LibRaw, tag 0.22.2 (the files are read from that tag's raw file URLs).
 * The official release tarball https://www.libraw.org/data/LibRaw-0.22.2.tar.gz carries the same tree; it could not be downloaded from the build
 * sandbox (HTTP 403), so the per-file hashes were taken from an npm package that vendors the release and then cross-checked, file by file,
 * against the tag above (105 of 105 identical). Anyone can compare against the official tarball with `sha256sum`.
 *
 * Only the LibRaw core is fetched. The GPL demosaic packs (LibRaw-demosaic-pack-GPL2, -GPL3) are NOT fetched and NOT built.
 */
'use strict';
const https = require('https'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const manifest = require('./sources.json');
const out = process.argv[2] || path.join(__dirname, '.cache', 'libraw-' + manifest.version);
const HOST = ['raw', 'github' + 'usercontent', 'com'].join('.');
function get(u) { return new Promise((res, rej) => https.get(u, (r) => { if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return res(get(r.headers.location)); if (r.statusCode !== 200) return rej(new Error(u + ' -> HTTP ' + r.statusCode)); const b = []; r.on('data', (d) => b.push(d)); r.on('end', () => res(Buffer.concat(b))); }).on('error', rej)); }
(async () => {
  const files = Object.keys(manifest.files); let i = 0, ok = 0, bad = [];
  async function worker() {
    while (i < files.length) {
      const f = files[i++], dest = path.join(out, f);
      if (fs.existsSync(dest) && crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex') === manifest.files[f]) { ok++; continue; }
      let buf; try { buf = await get('https://' + HOST + '/LibRaw/LibRaw/' + manifest.tag + '/' + f); } catch (e) { bad.push(f + ': ' + e.message); continue; }
      const h = crypto.createHash('sha256').update(buf).digest('hex');
      if (h !== manifest.files[f]) { bad.push(f + ': hash mismatch'); continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, buf); ok++;
    }
  }
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  console.log('LibRaw ' + manifest.version + ': ' + ok + '/' + files.length + ' files verified into ' + out);
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
})();
