/* LocalEditor background remover: the large "pro" options (graphics-card models). window.LE.bgRemovePro
 *
 * Loaded by the studio's cut-out chooser only when the person opens "Other quality options"; nothing here is fetched or
 * probed before that. Registers three options with the LE.bgRemove registry (see the contract in le-bgremove.js) and
 * declares their LE.support features. The models themselves are NOT in the repository (each is over 100 MB): they are
 * built by scripts/fetch-models.js into assets/models/pro/ and uploaded by scripts/deploy.sh. A copy of the app without
 * them shows the options as "Not available on this copy of the app" (see available()).
 *
 * All three run on onnxruntime-web's WebGPU provider (assets/vendor/ort-webgpu/) in half precision, which needs a
 * graphics adapter with the 'shader-f16' feature. Technical facts stay in `about`; the chooser shows plain words only.
 *
 *   LE.bgRemovePro.ids                 -> ['birefnet-lite', 'birefnet', 'ben2']
 *   LE.bgRemovePro.gpu()               -> Promise<{ adapter: bool|null, f16: bool|null }>   (cached; null = cannot tell)
 *   LE.bgRemovePro.available(id)       -> Promise<bool>   same-origin HEAD request for the model file (cached per page)
 *   LE.bgRemovePro.check(id)           -> Promise<{ status, reasons, canForce, available }>   LE.bgRemove.support + the two checks above
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  if (LE.bgRemovePro) return;

  var NEEDS = ['wasm', 'wasm-simd', 'worker', 'webgpu'];
  var DEFS = [
    {
      id: 'birefnet-lite', label: 'Fine detail', level: 'better', rank: 10, quality: 2,
      bestFor: 'Best for hair and fine edges, like flowers or people in a crowd',
      speed: 'medium', example: 'assets/img/cutout/fine.jpg',
      supportId: 'cutout.fine', tier: 'pro', runtime: 'webgpu', fp16: true, warmup: false, minmax: false, subject: 'general',
      path: 'assets/models/pro/birefnet-lite-1024-fp16.onnx', bytes: 0, downloadMB: 0, size: 1024, memoryMB: 1500, bufferMB: 256,
      about: { model: 'BiRefNet lite (Swin-T backbone), 1024 px input, half precision; exported by LocalEditor', licence: 'MIT (code and weights)', source: 'github.com/ZhengPeng7/BiRefNet', notes: 'Trained on DIS5K, DUTS, HRSOD, UHRSD, P3M and others; some of these datasets are for research use only. Needs a graphics card (WebGPU).' }
    },
    {
      id: 'birefnet', label: 'Best detail', level: 'best', rank: 10, quality: 3,
      bestFor: 'Sharpest edges for products, plants and busy photos',
      speed: 'slow', example: 'assets/img/cutout/best.jpg',
      supportId: 'cutout.best', tier: 'pro', runtime: 'webgpu', fp16: true, warmup: false, minmax: false, subject: 'general',
      path: 'assets/models/pro/birefnet-1024-fp16.onnx', bytes: 0, downloadMB: 0, size: 1024, memoryMB: 4000, bufferMB: 512,
      about: { model: 'BiRefNet (Swin-L backbone), 1024 px input, half precision; exported by LocalEditor', licence: 'MIT (code and weights)', source: 'github.com/ZhengPeng7/BiRefNet', notes: 'Trained on DIS5K, DUTS, HRSOD, UHRSD, P3M and others; some of these datasets are for research use only. Needs a recent graphics card with plenty of memory.' }
    },
    {
      id: 'ben2', label: 'Best for people', level: 'best', rank: 5, quality: 3,
      bestFor: 'Best for portraits and loose hair. Less reliable on objects and busy scenes',
      speed: 'slow', example: 'assets/img/cutout/hair.jpg',
      supportId: 'cutout.hair', tier: 'pro', runtime: 'webgpu', fp16: true, warmup: false, minmax: false, subject: 'general',
      path: 'assets/models/pro/ben2-1024-fp16.onnx', bytes: 0, downloadMB: 0, size: 1024, memoryMB: 3000, bufferMB: 256,
      norm: { mean: [0, 0, 0], std: [1, 1, 1] },
      about: { model: 'BEN2 base (Background Erase Network), 1024 px input, half precision; converted by LocalEditor', licence: 'MIT (code and weights)', source: 'huggingface.co/PramaLLC/BEN2', notes: 'Trained on DIS5K and a private dataset of the authors; DIS5K is for research use only. Needs a recent graphics card.' }
    }
  ];
  /* Exact artefact sizes (scripts/fetch-models.js writes these files; keep both in step). */
  var BYTES = { 'birefnet-lite': 108834041, birefnet: 480500583, ben2: 222932053 };
  DEFS.forEach(function (d) {
    d.bytes = BYTES[d.id];
    d.downloadMB = Math.max(1, Math.round(d.bytes / 1e6));
    d.needs = NEEDS.slice();
    /* LE.support feature, declared here so the device check knows the real needs (le-bgremove.js would declare a
       generic one otherwise). The WebGPU probe is asynchronous; LE.bgRemove.support() uses checkAsync. */
    var defs = global.LE_SUPPORT_DEFS = global.LE_SUPPORT_DEFS || [];
    var sdef = { id: d.supportId, name: 'Background remover: ' + d.label.toLowerCase(), group: 'On-device AI', needs: NEEDS.slice(), wants: ['device-memory-4gb', 'cache-storage'],
      memoryMB: d.memoryMB, downloadMB: d.downloadMB, note: d.bestFor + '. Uses the graphics card.' };
    if (!defs.some(function (x) { return x && x.id === sdef.id; })) defs.push(sdef);   /* le-support.js turns push() into define() */
  });
  DEFS.forEach(function (d) {
    if (LE.bgRemove && typeof LE.bgRemove.register === 'function') LE.bgRemove.register(d);
    else (global.LE_BGREMOVE_MODELS = global.LE_BGREMOVE_MODELS || []).push(d);
  });

  var gpuP = null, availP = {};
  function gpu() {
    if (gpuP) return gpuP;
    gpuP = Promise.resolve().then(function () {
      if (!global.navigator || !navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') return { adapter: false, f16: false };
      return navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (a) {
        var lim = a && a.limits ? Math.min(a.limits.maxStorageBufferBindingSize || 0, a.limits.maxBufferSize || 0) : 0;
        return { adapter: !!a, f16: a ? !!(a.features && a.features.has('shader-f16')) : false, bufferMB: lim ? Math.floor(lim / 1048576) : null };
      });
    }).catch(function () { return { adapter: null, f16: null }; });
    return gpuP;
  }
  function find(id) { return LE.bgRemove && LE.bgRemove.model(id); }
  function available(id) {
    if (availP[id]) return availP[id];
    var m = find(id);
    if (!m) return Promise.resolve(false);
    availP[id] = fetch(m.url, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      var type = r.headers.get('content-type') || '';
      var len = +r.headers.get('content-length') || 0;
      return r.ok && !/text\/html/i.test(type) && (!len || !m.bytes || Math.abs(len - m.bytes) <= 16);
    }).catch(function () { return false; });
    return availP[id];
  }
  function check(id) {
    var m = find(id);
    if (!m) return Promise.resolve({ status: 'unknown', reasons: [], canForce: false, available: false });
    return Promise.all([LE.bgRemove.support(id), gpu(), available(id)]).then(function (r) {
      var s = Object.assign({}, r[0]), g = r[1];
      s.available = r[2];
      s.reasons = (s.reasons || []).slice();
      if (s.status !== 'unsupported' && m.fp16 && g.adapter === true && g.f16 === false) {
        s.status = 'unsupported'; s.canForce = false;
        s.reasons.unshift('The graphics chip in this device is too old for this option.');
      }
      /* The largest single tensor (the full-resolution decoder layer) must fit one GPU buffer. */
      if (s.status !== 'unsupported' && m.bufferMB && g.bufferMB != null && g.bufferMB < m.bufferMB) {
        s.status = 'unsupported'; s.canForce = false;
        s.reasons.unshift('The graphics chip in this device cannot hold this option\u2019s working data.');
      }
      if (g.adapter === false || (s.missing || []).indexOf('webgpu') >= 0) {
        /* LE.support's generic WebGPU sentence says "uses the processor instead": not true for these options. */
        s.status = 'unsupported'; s.canForce = false;
        s.reasons = ['This option needs a graphics card that this browser can use, and none was found.'].concat(s.reasons.filter(function (r) { return !/graphics chip/.test(r); }));
      }
      return s;
    });
  }

  LE.bgRemovePro = { ids: DEFS.map(function (d) { return d.id; }), gpu: gpu, available: available, check: check };
})(window);
