/* LocalEditor: loads the effect renderer when a document needs it. See docs/EXPERT-MODE.md and docs/FX-AUTHORING.md.
   Stays tiny: everything else is in assets/js/fx/, fetched on first use. */
(function () {
  'use strict';
  var LE = window.LE = window.LE || {}, job = null, scenes = [];
  var src = (document.currentScript ? document.currentScript.src.replace(/le-fx-boot\.js.*$/, '') : '../assets/js/') + 'fx/le-fx.js';
  function has(l) { return !!l && (l.type === 'adjust' || (l.fx && l.fx.length > 0) || !!l.fxMask || !!l.transform || !!l.retouch); }
  function needs(x) { return !!x && (Array.isArray(x.layers) ? x.layers.some(has) : has(x)); }
  function redraw() { scenes = scenes.filter(function (s) { return !s._dead; }); scenes.forEach(function (s) { s._mark(); }); }
  function load(scene) {
    if (scene && scenes.indexOf(scene) < 0) scenes.push(scene);
    if (!job) {
      job = LE.lazy(src).then(function () { return LE.fx.ready; }).then(function (fx) { fx.on(redraw); redraw(); return fx; });
      job.catch(function () { job = null; });
    }
    return job;
  }
  LE.fxBoot = {
    needs: needs, load: load,
    /* Part of LE.Scene's bitmap cache key: every expert field, what the frame clip and scale depend on, and the renderer's state. */
    key: function (l) { return has(l) ? JSON.stringify([l.fx, l.fxMask, l.transform, l.retouch, l.maps, l.mask, l.maskPath, l.radius, l.w, l.h]) + (LE.fx && LE.fx.stamp ? LE.fx.stamp() : '') : 0; },
    layer: function (scene, layer, target, preview) {
      return load(scene).then(function (fx) { return fx.layer(scene, layer, target, preview); }, function () {
        var raw = {};
        Object.keys(layer).forEach(function (k) { raw[k] = layer[k]; });
        raw._fxRaw = true;
        return scene._processImage(raw, target, preview);
      });
    },
    draw: function (scene, ctx, layer, opts) {
      if (opts._fxOn === undefined) opts._fxOn = needs(scene._doc);
      if (!opts._fxOn || opts.fxInner) return false;
      if (LE.fx && LE.fx.draw) return LE.fx.draw(scene, ctx, layer, opts);
      load(scene).catch(function () {});
      return layer.type === 'adjust';
    },
    prepare: function (scene) { return needs(scene._doc) ? load(scene).then(function (fx) { return fx.prepare(scene); }, function () {}) : null; }
  };
})();
