#!/usr/bin/env node
/* Downloads a few freely licensed RAW sample files into labs/raw/samples/ (git-ignored, never committed) for trying the RAW lab with real camera files.
 *
 *   node scripts/fetch-raw-samples.js            # the two public-domain Nikon files (25 MB)
 *   node scripts/fetch-raw-samples.js --all      # also the tiny ExifTool test fixtures (metadata only, truncated pixel data)
 *
 * Sources and licences, as stated by their publishers on 12 November 2026:
 *   immich-app/test-assets: "All assets are public domain" (README of the repository; the repository's code licence is AGPL-3.0 and does not cover the photos).
 *     formats/raw/Nikon/D80/glarus.nef  (9,057,784 bytes)   formats/raw/Nikon/D700/philadelphia.nef (15,856,335 bytes)
 *   exiftool/exiftool t/images/*: test fixtures of the ExifTool project (Perl licence: Artistic or GPL). They are truncated files for testing metadata readers;
 *     used here only to check that the decoder fails gracefully. Not redistributed by us.
 * raw.pixls.us (the large CC0 camera sample archive) is not reachable from the build sandbox; on a normal machine it is the best source of real files.
 */
'use strict';
const https = require('https'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const HOST = ['raw', 'github' + 'usercontent', 'com'].join('.');
const out = path.join(__dirname, '..', 'labs', 'raw', 'samples');
const FILES = [
  { name: 'nikon-d80-glarus.nef', path: 'immich-app/test-assets/main/formats/raw/Nikon/D80/glarus.nef', bytes: 9057784, licence: 'public domain (immich-app/test-assets README)' },
  { name: 'nikon-d700-philadelphia.nef', path: 'immich-app/test-assets/main/formats/raw/Nikon/D700/philadelphia.nef', bytes: 15856335, licence: 'public domain (immich-app/test-assets README)' }
];
const EXTRA = [
  { name: 'exiftool-DNG.dng', path: 'exiftool/exiftool/master/t/images/DNG.dng', bytes: 13662, licence: 'ExifTool test fixture (Artistic or GPL)' },
  { name: 'exiftool-CanonRaw.cr2', path: 'exiftool/exiftool/master/t/images/CanonRaw.cr2', bytes: 8724, licence: 'ExifTool test fixture' },
  { name: 'exiftool-Panasonic.rw2', path: 'exiftool/exiftool/master/t/images/Panasonic.rw2', bytes: 12344, licence: 'ExifTool test fixture' },
  { name: 'exiftool-FujiFilm.raf', path: 'exiftool/exiftool/master/t/images/FujiFilm.raf', bytes: 38452, licence: 'ExifTool test fixture' }
];
function get(u) { return new Promise((res, rej) => https.get(u, (r) => { if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return res(get(r.headers.location)); if (r.statusCode !== 200) return rej(new Error(u + ' -> HTTP ' + r.statusCode)); const b = []; r.on('data', (d) => b.push(d)); r.on('end', () => res(Buffer.concat(b))); }).on('error', rej)); }
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const list = process.argv.includes('--all') ? FILES.concat(EXTRA) : FILES;
  for (const f of list) {
    const dest = path.join(out, f.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size === f.bytes) { console.log('have', f.name); continue; }
    const buf = await get('https://' + HOST + '/' + f.path);
    if (buf.length !== f.bytes) throw new Error(f.name + ': expected ' + f.bytes + ' bytes, got ' + buf.length);
    fs.writeFileSync(dest, buf); console.log('saved', f.name, buf.length + ' bytes', 'sha256 ' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16), '|', f.licence);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
