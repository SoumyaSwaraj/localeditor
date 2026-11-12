#!/usr/bin/env node
/* Downloads the larger background-remover candidates into assets/models/local/ (git-ignored) for local evaluation
 * with labs/bg-remove/. None of these files are committed or shipped.
 *
 *   node scripts/fetch-models.js                 # list
 *   node scripts/fetch-models.js u2net isnet     # fetch by id (substring match)
 *   node scripts/fetch-models.js all             # everything (~800 MB)
 *   node scripts/fetch-models.js --webgpu        # also fetch the onnxruntime-web WebGPU build from npm into assets/vendor/ort-webgpu/ (git-ignored)
 *
 * Sources are GitHub release assets and the npm registry. Licence notes are in docs/research/background-remover.md;
 * several of these are for evaluation only and must not be shipped without a licence review.
 */
'use strict';
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'assets', 'models', 'local');
const REMBG = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/';
const BIREF = 'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/';
const ORT_VERSION = '1.22.0';

const MODELS = [
  { id: 'silueta', file: 'silueta.onnx', url: REMBG + 'silueta.onnx', bytes: 44173029 },
  { id: 'u2net', file: 'u2net.onnx', url: REMBG + 'u2net.onnx', bytes: 175997641 },
  { id: 'u2net_human_seg', file: 'u2net_human_seg.onnx', url: REMBG + 'u2net_human_seg.onnx', bytes: 175997641 },
  { id: 'isnet-general-use', file: 'isnet-general-use.onnx', url: REMBG + 'isnet-general-use.onnx', bytes: 178648008 },
  { id: 'birefnet-lite', file: 'BiRefNet-swin-tiny.onnx', url: BIREF + 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', bytes: 224005088 }
];

function get(url, dest, redirects) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'localeditor-fetch-models' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if ((redirects || 0) > 5) return reject(new Error('Too many redirects'));
        return resolve(get(new URL(res.headers.location, url).href, dest, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(url + ' -> HTTP ' + res.statusCode)); }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      let got = 0; const total = +res.headers['content-length'] || 0, t0 = Date.now();
      res.on('data', (c) => { got += c.length; if (total) process.stdout.write('\r  ' + (got / 1048576).toFixed(0) + ' / ' + (total / 1048576).toFixed(0) + ' MB   '); });
      res.pipe(out);
      out.on('finish', () => { fs.renameSync(tmp, dest); process.stdout.write('\r  done in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s          \n'); resolve(); });
      res.on('error', reject); out.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchModel(m) {
  fs.mkdirSync(DEST, { recursive: true });
  const dest = path.join(DEST, m.file);
  if (fs.existsSync(dest) && fs.statSync(dest).size === m.bytes) { console.log(m.id + ': already present'); return; }
  console.log(m.id + ': ' + (m.bytes / 1048576).toFixed(0) + ' MB');
  await get(m.url, dest);
}

async function fetchWebgpu() {
  const out = path.join(ROOT, 'assets', 'vendor', 'ort-webgpu');
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ort-'));
  const tgz = path.join(tmp, 'ort.tgz');
  console.log('onnxruntime-web ' + ORT_VERSION + ' (npm)');
  await get('https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-' + ORT_VERSION + '.tgz', tgz);
  cp.execFileSync('tar', ['xzf', tgz, '-C', tmp]);
  ['ort.webgpu.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'].forEach((f) => {
    fs.copyFileSync(path.join(tmp, 'package', 'dist', f), path.join(out, f.replace(/\.mjs$/, '.module.js')));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('WebGPU runtime copied to assets/vendor/ort-webgpu/');
}

(async () => {
  const args = process.argv.slice(2);
  const want = args.filter((a) => !a.startsWith('--'));
  if (!want.length && !args.includes('--webgpu')) {
    console.log('Candidates (saved to assets/models/local/):');
    MODELS.forEach((m) => console.log('  ' + m.id.padEnd(20) + (m.bytes / 1048576).toFixed(0).padStart(5) + ' MB'));
    console.log('\nUsage: node scripts/fetch-models.js <id...> | all | --webgpu');
    return;
  }
  const list = want.includes('all') ? MODELS : MODELS.filter((m) => want.some((w) => m.id.indexOf(w) >= 0));
  if (want.length && !list.length) throw new Error('No model matches: ' + want.join(', '));
  for (const m of list) await fetchModel(m);
  if (args.includes('--webgpu')) await fetchWebgpu();
})().catch((e) => { console.error(e.message); process.exit(1); });
