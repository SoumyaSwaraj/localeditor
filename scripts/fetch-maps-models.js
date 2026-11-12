#!/usr/bin/env node
/* Downloads the source weights for the depth and face maps (labs/maps/, docs/research/depth-face-maps.md) into
 * assets/models/maps/local/src/ (git-ignored), checks their SHA-256, and can derive the shipped files from them.
 *
 *   node scripts/fetch-maps-models.js                 # list sources and what is already present
 *   node scripts/fetch-maps-models.js depth face      # fetch by id (substring match)
 *   node scripts/fetch-maps-models.js all             # everything below (about 330 MB with the fp32 depth model and the MediaPipe WASM)
 *   node scripts/fetch-maps-models.js --derive        # run labs/maps/tools/derive.py (needs python3 with onnx, onnxruntime, numpy) into assets/models/maps/
 *
 * Hosts: huggingface.co, storage.googleapis.com (Google's MediaPipe model bucket), registry.npmjs.org. Every file is checked against a
 * pinned hash, so a changed or substituted upstream file is refused. Licences are Apache-2.0 for everything listed; see
 * assets/vendor/LICENSES.md. The Depth Anything V2 Base, Large and Giant models are CC-BY-NC-4.0 and are deliberately not listed.
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'assets', 'models', 'maps', 'local', 'src');
const HF = 'https://huggingface.co/';
const GCS = 'https://storage.googleapis.com/mediapipe-models/';

const SOURCES = [
  { id: 'depth-fp32', file: 'depth_anything_v2_small_fp32.onnx', url: HF + 'onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx', bytes: 99060839,
    sha256: 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c', note: 'Depth Anything V2 Small, float32 ONNX export (Apache-2.0). Input for derive.py.' },
  { id: 'depth-published-int8', file: 'depth_anything_v2_small_published_int8.onnx', url: HF + 'onnx-community/depth-anything-v2-small/resolve/main/onnx/model_int8.onnx', bytes: 27258801,
    sha256: '01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001', note: 'The community 8-bit file as published (27.3 MB, over the 25 MB repository limit). Ours is 25.7 MB with float16-stored constants.' },
  { id: 'face-task', file: 'face_landmarker.task', url: GCS + 'face_landmarker/face_landmarker/float16/1/face_landmarker.task', bytes: 3758596,
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff', note: 'Google MediaPipe Face Landmarker bundle: zip of face_detector, face_landmarks_detector, face_blendshapes .tflite (Apache-2.0).' },
  { id: 'face-onnx-detector', file: 'face_detector.onnx', url: HF + 't9749/mediapipe-face-landmarker-onnx/resolve/main/face_detector.onnx', bytes: 418475,
    sha256: 'c0a93c2f5bbe0fafeb24c0ae3443f9f941f0e3e9019e0ac69453a2e638cb3242', note: 'tf2onnx conversion of the .task detector by a third party; outputs match the official tflite to 2e-4 (labs/maps/tools/verify_face.py).' },
  { id: 'face-onnx-landmarks', file: 'face_landmarks_detector.onnx', url: HF + 't9749/mediapipe-face-landmarker-onnx/resolve/main/face_landmarks_detector.onnx', bytes: 4921016,
    sha256: '3cdfb2d9d9b3cfea1420e399e4a580b020083f91440ca68d3682bd0f2626a2e3', note: 'same, landmark network' },
  { id: 'face-onnx-blend', file: 'face_blendshapes.onnx', url: HF + 't9749/mediapipe-face-landmarker-onnx/resolve/main/face_blendshapes.onnx', bytes: 1883829,
    sha256: '3f2e7be8748d33766f8078f7165ab1da72aad0c90956ad56b0046eca96134715', note: 'same, blendshape network' },
  { id: 'parts-onnx', file: 'selfie_multiclass.onnx', url: HF + 'senty-au/selfie_multiclass_256x256-ONNX/resolve/main/onnx/model.onnx', bytes: 16454560,
    sha256: '35ec1ecd9ee7f85073c99c00020b7f6751b69506eeacf683bc8665f6117f85b0', note: 'MediaPipe multi-class selfie segmenter converted to ONNX; outputs match the official tflite to 3e-5.' },
  { id: 'parts-tflite', file: 'selfie_multiclass_256x256.tflite', url: GCS + 'image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite', bytes: 16371837,
    sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0', note: 'Google original, for verification only.' },
  { id: 'mptv', file: 'mediapipe-tasks-vision-1.2.3.tgz', url: 'https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.2.3.tgz', bytes: 0,
    sha256: '469602650dab70256df387983ea44e85fa66020335bae85a54fa8fda062ca0a0', note: 'MediaPipe Tasks Vision (Apache-2.0): 14.7 MB WASM. NOT used at runtime; only for checking our pipeline against Google\'s.' }
];

function sha(file) { const h = crypto.createHash('sha256'); h.update(fs.readFileSync(file)); return h.digest('hex'); }
function get(url, dest, redirects) {
  /* Behind an HTTPS proxy (CI, sandboxes) Node's https module ignores it; curl honours it. */
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !redirects) {
    const r = cp.spawnSync('curl', ['-sfL', '--retry', '2', '-o', dest + '.part', url], { stdio: 'inherit' });
    if (r.status !== 0) return Promise.reject(new Error(url + ' -> curl exit ' + r.status));
    fs.renameSync(dest + '.part', dest);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'localeditor-fetch-maps' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if ((redirects || 0) > 6) return reject(new Error('Too many redirects'));
        return resolve(get(new URL(res.headers.location, url).href, dest, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(url + ' -> HTTP ' + res.statusCode)); }
      const tmp = dest + '.part', out = fs.createWriteStream(tmp);
      let got = 0; const total = +res.headers['content-length'] || 0;
      res.on('data', (c) => { got += c.length; if (total) process.stdout.write('\r  ' + (got / 1048576).toFixed(0) + ' / ' + (total / 1048576).toFixed(0) + ' MB   '); });
      res.pipe(out);
      out.on('finish', () => { fs.renameSync(tmp, dest); process.stdout.write('\r' + ' '.repeat(40) + '\r'); resolve(); });
      res.on('error', reject); out.on('error', reject);
    }).on('error', reject);
  });
}
async function fetchOne(s) {
  fs.mkdirSync(DEST, { recursive: true });
  const dest = path.join(DEST, s.file);
  if (fs.existsSync(dest) && sha(dest) === s.sha256) { console.log(s.id + ': present, hash ok'); return; }
  console.log(s.id + ': downloading ' + s.file);
  await get(s.url, dest);
  const got = sha(dest);
  if (got !== s.sha256) { fs.unlinkSync(dest); throw new Error(s.id + ': hash mismatch (' + got + '), file removed. The upstream file changed; review before updating the pin.'); }
  console.log(s.id + ': ok (' + (fs.statSync(dest).size / 1e6).toFixed(1) + ' MB)');
}
function derive() {
  const src = path.join(ROOT, 'assets', 'models', 'maps', 'local', 'derive-in');
  const tf = path.join(src, 'da2s'), tm = path.join(src, 't9749'), ts = path.join(src, 'selfie');
  [tf, tm, ts].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const link = (from, to) => { try { fs.copyFileSync(path.join(DEST, from), to); } catch (e) { console.log('missing ' + from + ' (run the fetch first)'); } };
  link('depth_anything_v2_small_fp32.onnx', path.join(tf, 'model.onnx'));
  link('face_detector.onnx', path.join(tm, 'face_detector.onnx')); link('face_landmarks_detector.onnx', path.join(tm, 'face_landmarks_detector.onnx')); link('face_blendshapes.onnx', path.join(tm, 'face_blendshapes.onnx'));
  link('selfie_multiclass.onnx', path.join(ts, 'model.onnx'));
  const outDir = path.join(ROOT, 'assets', 'models', 'maps', 'local', 'derived');
  const r = cp.spawnSync('python3', [path.join(ROOT, 'labs', 'maps', 'tools', 'derive.py'), src, outDir], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  const r2 = cp.spawnSync('python3', [path.join(ROOT, 'labs', 'maps', 'tools', 'derive_q4.py'), path.join(tf, 'model.onnx'), path.join(outDir, 'depth_anything_v2_small_q4.onnx')], { stdio: 'inherit' });
  if (r2.status !== 0) process.exit(r2.status || 1);
  console.log('Derived files are in ' + outDir + '. Copy the small ones into assets/models/maps/ (committed) and the 25.7 MB int8 into assets/models/maps/local/ (git-ignored, S3 only).');
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--derive')) return derive();
  if (!args.length) {
    SOURCES.forEach((s) => console.log((fs.existsSync(path.join(DEST, s.file)) ? '[x] ' : '[ ] ') + s.id.padEnd(22) + (s.bytes ? (s.bytes / 1e6).toFixed(1) + ' MB' : '').padEnd(10) + ' ' + s.note));
    console.log('\nUsage: node scripts/fetch-maps-models.js <id...> | all | --derive');
    return;
  }
  const want = args.includes('all') ? SOURCES : SOURCES.filter((s) => args.some((a) => s.id.includes(a)));
  if (!want.length) { console.log('No source matches ' + args.join(', ')); process.exit(1); }
  for (const s of want) await fetchOne(s);
})().catch((e) => { console.error(e.message); process.exit(1); });
