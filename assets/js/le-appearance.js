/* LocalEditor appearance picker: theme cards with live miniatures, Light / Dark / Auto, and the Appearance sheet.
   Loaded on first use by LE.appearance.load() (app.js keeps only the tiny core that applies the choice). */
(function () {
  'use strict';
  var LEX = window.LE, A = LEX && LEX.appearance;
  if (!A || A.picker) return;
  var SKINS = A.skins;
  A.picker = function (opts) {
      opts = opts || {};
      var wrap = document.createElement('div');
      wrap.className = 'ap';
      function draw() {
        var st = LEX.appearance.state();
        var hc = window.matchMedia && matchMedia('(prefers-contrast: more)').matches && st.skin !== 'contrast';
        wrap.innerHTML =
          '<div class="ap-mode seg" role="group" aria-label="Light or dark">' +
            [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']].map(function (m) { return '<button type="button" data-ap-mode="' + m[0] + '" aria-pressed="' + (st.mode === m[0]) + '">' + m[1] + '</button>'; }).join('') +
          '</div>' +
          (hc ? '<p class="ap-hint">This device asks for more contrast. <button type="button" class="btn-link" data-ap-skin="contrast">Try Contrast</button></p>' : '') +
          '<div class="ap-grid" role="radiogroup" aria-label="Theme">' +
            SKINS.map(function (k) {
              return '<button type="button" class="ap-card" role="radio" aria-checked="' + (st.skin === k.id) + '" data-ap-skin="' + k.id + '">' +
                '<span class="ap-prev" data-skin-preview="' + k.id + '" aria-hidden="true"><i class="ap-bar"></i><b class="ap-title">Aa</b><i class="ap-line"></i><i class="ap-line ap-short"></i><span class="ap-btns"><i class="ap-pri"></i><i class="ap-sec"></i></span></span>' +
                '<span class="ap-name">' + k.name + '</span><small>' + k.note + '</small></button>';
            }).join('') +
          '</div>';
      }
      draw();
      wrap.addEventListener('click', function (e) {
        var m = e.target.closest('[data-ap-mode]'), k = e.target.closest('[data-ap-skin]');
        if (m) LEX.appearance.setMode(m.getAttribute('data-ap-mode'));
        else if (k) LEX.appearance.setSkin(k.getAttribute('data-ap-skin'));
        else return;
        draw();
        var again = wrap.querySelector(m ? '[data-ap-mode="' + m.getAttribute('data-ap-mode') + '"]' : '[data-ap-skin="' + k.getAttribute('data-ap-skin') + '"].ap-card');
        if (again) again.focus();
        if (opts.onChange) opts.onChange();
      });
      return wrap;
  };
  A.open = function () {
      var d = document.getElementById('le-appearance');
      if (!d) {
        d = document.createElement('dialog');
        d.id = 'le-appearance';
        d.className = 'le-dialog le-appear';
        d.setAttribute('aria-labelledby', 'le-appearance-title');
        d.innerHTML = '<div class="ap-head"><h2 id="le-appearance-title">Appearance</h2><button type="button" class="le-icon" data-ap-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>';
        d.appendChild(LEX.appearance.picker());
        d.addEventListener('click', function (e) { if (e.target === d || e.target.closest('[data-ap-close]')) d.close(); });
        document.body.appendChild(d);
      }
      if (d.open) return;
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
      var on = d.querySelector('.ap-card[aria-checked="true"]');
      if (on) on.focus();
    };
})();
