/* Background remover lab: adds the evaluation-only models to the shared LE.bgRemove registry
 * (assets/js/le-bgremove.js, which also owns the worker). These files are not shipped; fetch them with
 * `node scripts/fetch-models.js` into assets/models/local/ (git-ignored). Licence notes: docs/research/background-remover.md.
 */
(function () {
  'use strict';
  var bg = window.LE && window.LE.bgRemove;
  if (!bg) return;
  var IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };
  var HALF = { mean: [0.5, 0.5, 0.5], std: [1, 1, 1] };
  [
    { id: 'u2netp-int8', label: 'u2netp int8 (breaks the output)', tier: 'eval', size: 320, bytes: 1321751, path: 'assets/models/local/u2netp-int8.onnx', norm: IMAGENET, licence: 'Apache-2.0 (derived)' },
    { id: 'isnet-int8', label: 'IS-Net general int8', tier: 'eval', size: 1024, bytes: 46360717, path: 'assets/models/local/isnet-general-use-int8.onnx', norm: HALF, licence: 'Apache-2.0 code; weights trained on non-commercial DIS5K' },
    { id: 'silueta', label: 'silueta (u2net, reduced)', tier: 'eval', size: 320, bytes: 44173029, path: 'assets/models/local/silueta.onnx', norm: IMAGENET, licence: 'unverified' },
    { id: 'u2net', label: 'u2net (full)', tier: 'eval', size: 320, bytes: 175997641, path: 'assets/models/local/u2net.onnx', norm: IMAGENET, licence: 'Apache-2.0' },
    { id: 'u2net_human_seg', label: 'u2net human seg', tier: 'eval', size: 320, bytes: 175997641, path: 'assets/models/local/u2net_human_seg.onnx', norm: IMAGENET, subject: 'people', licence: 'Apache-2.0' },
    { id: 'isnet-general-use', label: 'IS-Net general use', tier: 'eval', size: 1024, bytes: 178648008, path: 'assets/models/local/isnet-general-use.onnx', norm: HALF, licence: 'Apache-2.0 code; weights trained on non-commercial DIS5K' },
    { id: 'birefnet-lite', label: 'BiRefNet (Swin-tiny)', tier: 'quality', size: 1024, bytes: 224005088, path: 'assets/models/local/BiRefNet-swin-tiny.onnx', norm: IMAGENET, sigmoid: true, licence: 'MIT code; training data caveats' }
  ].forEach(function (m) { bg.register(m); });
})();
