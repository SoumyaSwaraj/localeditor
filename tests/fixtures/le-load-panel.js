/* Test fixture for tests/loading.test.js: a studio module loaded later with LE.modules.defer. It registers a panel,
   an 'init' hook, a rail entry, a queued handler (S.onLoadTestFile) and a view inside the Apps panel. */
(function () {
  'use strict';
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var HOOKS = P._hooks = P._hooks || {};
  (HOOKS.init = HOOKS.init || []).push(function (c) { window.__loadTestInit = (window.__loadTestInit || 0) + 1; window.__loadTestCtx = !!(c && c.scene); });
  P.loadtest = {
    title: 'Load test', eyebrow: 'Fixture', rail: { label: 'Load test', icon: 'apps', order: 9999 },
    render: function (c, body) {
      c.S.onLoadTestFile = function (f) { window.__loadTestFiles = (window.__loadTestFiles || []).concat([f]); };
      body.insertAdjacentHTML('beforeend', '<p class="le-load-real">The real panel</p>');
    }
  };
  var apps = P.apps;
  if (apps && typeof apps.render === 'function') {
    var orig = apps.render;
    apps.render = function (c, body, o) {
      if (o && o.app === 'loadtest') { body.insertAdjacentHTML('beforeend', '<p class="le-load-app">The real app view</p>'); return; }
      return orig.apply(this, arguments);
    };
  }
  window.__loadTestLoaded = true;
})();
