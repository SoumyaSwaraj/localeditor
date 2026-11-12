#!/usr/bin/env node
/* Downloads optional text-recognition language packs into assets/models/ocr/more/ (git-ignored) for local use of labs/pdf-ocr/
 * and to stage them for S3. The English pack (assets/models/ocr/eng.traineddata) is committed and not fetched here.
 *
 *   node scripts/fetch-ocr-data.js                 # list
 *   node scripts/fetch-ocr-data.js hin spa         # fetch by language id
 *   node scripts/fetch-ocr-data.js all             # every pack in the table (about 12 MB)
 *   node scripts/fetch-ocr-data.js --best hin      # tessdata_best instead of tessdata_fast (about 10x larger, evaluation only)
 *
 * Source: https://github.com/tesseract-ocr/tessdata_fast (and tessdata_best), Apache-2.0 (licence text in
 * assets/vendor/licenses/tessdata_fast-LICENSE.txt). raw.githubusercontent.com is reachable from the build environment;
 * jsDelivr and Hugging Face are not. Findings: docs/research/pdf-ocr-scan.md.
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'assets', 'models', 'ocr', 'more');
const BASE = 'https://raw.githubusercontent.com/tesseract-ocr/';

/* bytes: size of the tessdata_fast file when written, checked after download. */
const PACKS = [
  { id: 'spa', label: 'Spanish', bytes: 2294433 },
  { id: 'por', label: 'Portuguese', bytes: 1982756 },
  { id: 'fra', label: 'French', bytes: 1130365 },
  { id: 'deu', label: 'German', bytes: 1525436 },
  { id: 'hin', label: 'Hindi (Devanagari)', bytes: 1122751 },
  { id: 'ara', label: 'Arabic', bytes: 1432056 }
];

function get(url, redirects) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'localeditor-fetch-ocr-data' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if ((redirects || 0) > 5) return reject(new Error('Too many redirects'));
        return resolve(get(new URL(res.headers.location, url).href, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  const args = process.argv.slice(2);
  const best = args.includes('--best');
  const want = args.filter((a) => !a.startsWith('--'));
  if (!want.length) {
    console.log('Optional packs (tessdata_fast):');
    PACKS.forEach((p) => console.log('  ' + p.id.padEnd(5) + p.label.padEnd(22) + (p.bytes / 1048576).toFixed(1) + ' MB'));
    console.log('\nUsage: node scripts/fetch-ocr-data.js <id ...> | all   [--best]');
    return;
  }
  const list = want.includes('all') ? PACKS : PACKS.filter((p) => want.includes(p.id));
  if (!list.length) throw new Error('No pack matches: ' + want.join(', '));
  fs.mkdirSync(DEST, { recursive: true });
  for (const p of list) {
    const url = BASE + (best ? 'tessdata_best' : 'tessdata_fast') + '/main/' + p.id + '.traineddata';
    process.stdout.write('Fetching ' + p.id + ' ... ');
    const buf = await get(url);
    if (!best && buf.length !== p.bytes) console.log('(size differs from the table: ' + buf.length + ' vs ' + p.bytes + '; update LANGS in assets/js/le-pdf-ocr.js)');
    if (buf.slice(0, 4).toString('hex') === '00000000' || buf.length < 100000) throw new Error('Unexpected file for ' + p.id);
    fs.writeFileSync(path.join(DEST, p.id + '.traineddata'), buf);
    console.log(buf.length + ' bytes, sha256 ' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
