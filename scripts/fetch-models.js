#!/usr/bin/env node
/* Downloads the larger background-remover candidates into assets/models/local/ (git-ignored) for local evaluation
 * with labs/bg-remove/, and builds the three shipped "pro" models into assets/models/pro/ (git-ignored, uploaded to S3 by
 * scripts/deploy.sh; each is over GitHub's 100 MB limit, so they are never committed).
 *
 *   node scripts/fetch-models.js                 # list
 *   node scripts/fetch-models.js u2net isnet     # fetch evaluation candidates by id (substring match)
 *   node scripts/fetch-models.js all             # every evaluation candidate (~800 MB)
 *   node scripts/fetch-models.js pro             # build assets/models/pro/* (needs Python, see below; ~1.3 GB of sources)
 *   node scripts/fetch-models.js pro --only=ben2 # one of birefnet-lite, birefnet, ben2
 *   node scripts/fetch-models.js --webgpu        # re-fetch the onnxruntime-web WebGPU build (already vendored in assets/vendor/ort-webgpu/)
 *
 * "pro" downloads the sources into assets/models/local/pro-src/, checks their SHA-256, then runs
 * scripts/models/build_pro.py with $PYTHON (default python3) from a venv made with scripts/models/requirements.txt.
 * Details and measurements: docs/research/background-remover-pro.md.
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
const ORT_VERSION = '1.31.1';
const HF = 'https://huggingface.co/';

/* Sources of the shipped pro models: exact bytes and SHA-256 as downloaded on 12 Nov 2026. */
const PRO_SRC = [
  { id: 'birefnet-lite', file: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.pth', url: BIREF + 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.pth', bytes: 177791685,
    sha256: '6a1e050c6ec2697e5ed268455df544782b023acf8643ab771250979094875ab1', licence: 'MIT (github.com/ZhengPeng7/BiRefNet LICENSE)' },
  { id: 'birefnet', file: 'BiRefNet-general-epoch_244.pth', url: BIREF + 'BiRefNet-general-epoch_244.pth', bytes: 885082437,
    sha256: '11341a6a1c12646627e8d28da025bfec8aad027929d377cbe8fd4759636cc77c', licence: 'MIT (github.com/ZhengPeng7/BiRefNet LICENSE)' },
  { id: 'ben2', file: 'BEN2_Base.onnx', url: HF + 'PramaLLC/BEN2/resolve/e48a20765fb421d19dcdb0bf3cc61e802ca5ec8f/BEN2_Base.onnx', bytes: 222932053,
    sha256: '22cea62108ff53b7ccc20f7a008bf30494228d84b1687f29ecbe76936a998101', licence: 'MIT (huggingface.co/PramaLLC/BEN2 model card; github.com/PramaLLC/BEN2 LICENSE)' }
];
/* What build_pro.py produced here (torch 2.15.0, onnxslim 0.1.99, onnxconverter-common 1.16.0). Must match the bytes in
   assets/js/le-bgremove-pro.js, which the app checks after download. A different toolchain may give different bytes:
   then update both. */
const PRO_OUT = {
  'birefnet-lite': { file: 'birefnet-lite-1024-fp16.onnx', bytes: 108834041, sha256: '6e2bf49837725020dd4c0b669302ced96f0260e86138a832aa8fc068894d9150' },
  birefnet: { file: 'birefnet-1024-fp16.onnx', bytes: 480500583, sha256: '47f878549b4a5486e5d67613d7bd06193a39fb2fabdb725afa8c5ce30ac65bcc' },
  ben2: { file: 'ben2-1024-fp16.onnx', bytes: 222932053, sha256: '22cea62108ff53b7ccc20f7a008bf30494228d84b1687f29ecbe76936a998101' }
};

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

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = require('crypto').createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function buildPro(only) {
  const srcDir = path.join(ROOT, 'assets', 'models', 'local', 'pro-src');
  const outDir = path.join(ROOT, 'assets', 'models', 'pro');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const ids = only.length ? only : PRO_SRC.map((s) => s.id);
  for (const s of PRO_SRC.filter((x) => ids.includes(x.id))) {
    const dest = path.join(srcDir, s.file);
    if (!(fs.existsSync(dest) && fs.statSync(dest).size === s.bytes)) {
      console.log(s.id + ' source: ' + (s.bytes / 1048576).toFixed(0) + ' MB, ' + s.licence);
      await get(s.url, dest);
    }
    const got = await sha256(dest);
    if (got !== s.sha256) throw new Error(s.file + ': SHA-256 ' + got + ' does not match ' + s.sha256 + '. Delete it and try again.');
  }
  const py = process.env.PYTHON || 'python3';
  cp.execFileSync(py, [path.join(__dirname, 'models', 'build_pro.py'), '--src', srcDir, '--out', outDir, '--only', ids.join(',')], { stdio: 'inherit' });
  for (const id of ids) {
    const o = PRO_OUT[id], f = path.join(outDir, o.file);
    const size = fs.statSync(f).size, sum = await sha256(f);
    const same = size === o.bytes && sum === o.sha256;
    console.log((same ? 'ok    ' : 'DIFFERS ') + o.file + ' ' + size + ' bytes ' + sum);
    if (!same) console.log('        expected ' + o.bytes + ' bytes ' + o.sha256 + ': update PRO_OUT here and BYTES in assets/js/le-bgremove-pro.js');
  }
}

async function fetchWebgpu() {
  const out = path.join(ROOT, 'assets', 'vendor', 'ort-webgpu');
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ort-'));
  const tgz = path.join(tmp, 'ort.tgz');
  console.log('onnxruntime-web ' + ORT_VERSION + ' (npm)');
  await get('https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-' + ORT_VERSION + '.tgz', tgz);
  cp.execFileSync('tar', ['xzf', tgz, '-C', tmp]);
  ['ort.webgpu.min.js', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'].forEach((f) => {
    fs.copyFileSync(path.join(tmp, 'package', 'dist', f), path.join(out, f.replace(/\.mjs$/, '.module.js')));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('WebGPU runtime copied to assets/vendor/ort-webgpu/');
}

(async () => {
  const args = process.argv.slice(2);
  const want = args.filter((a) => !a.startsWith('--'));
  if (want.includes('pro')) {
    const only = (args.find((a) => a.startsWith('--only=')) || '--only=').slice(7).split(',').filter(Boolean);
    await buildPro(only);
    return;
  }
  if (!want.length && !args.includes('--webgpu')) {
    console.log('Candidates (saved to assets/models/local/):');
    MODELS.forEach((m) => console.log('  ' + m.id.padEnd(20) + (m.bytes / 1048576).toFixed(0).padStart(5) + ' MB'));
    console.log('Shipped large models (built into assets/models/pro/ by "pro"):');
    PRO_SRC.forEach((m) => console.log('  ' + m.id.padEnd(20) + (PRO_OUT[m.id].bytes / 1048576).toFixed(0).padStart(5) + ' MB  from ' + m.file));
    console.log('\nUsage: node scripts/fetch-models.js <id...> | all | pro [--only=id,...] | --webgpu');
    return;
  }
  const list = want.includes('all') ? MODELS : MODELS.filter((m) => want.some((w) => m.id.indexOf(w) >= 0));
  if (want.length && !list.length) throw new Error('No model matches: ' + want.join(', '));
  for (const m of list) await fetchModel(m);
  if (args.includes('--webgpu')) await fetchWebgpu();
})().catch((e) => { console.error(e.message); process.exit(1); });
