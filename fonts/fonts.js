/* LocalEditor originals specimen page: lazy font loading, "Try your own text", weight switch,
   and "Use in the studio" links (a template link: the design rides in the URL fragment). */
(function () {
  'use strict';
  var O = window.LE && window.LE.fontsOriginals;
  var cards = [].slice.call(document.querySelectorAll('.fo-card[data-family]'));
  var input = document.getElementById('fo-text');
  var weight = 400;

  function b64url(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* Same shape as examples/designs/*.ledesign.json: one square page, one text layer in the family. */
  function studioLink(card, text) {
    var ink = card.getAttribute('data-tone') === 'ink';
    var design = {
      format: 'localeditor-design', version: 1,
      name: card.getAttribute('data-family') + ' — LocalEditor originals',
      pages: [{
        width: 1080, height: 1080, background: ink ? '#141318' : '#F6F1E7',
        layers: [{
          id: 'title', type: 'text', text: text, font: card.getAttribute('data-family'), weight: weight,
          size: text.length > 28 ? 92 : 128, color: ink ? '#F7F3EA' : '#17131F', align: 'center', w: '84%', x: 'center', y: 'center'
        }]
      }]
    };
    return '../studio/#d=j' + b64url(JSON.stringify(design));
  }

  function sampleOf(card) {
    var t = input && input.value.trim();
    return t || card.getAttribute('data-sample');
  }

  function ready(card, w) {
    if (!O) { card.classList.add('is-ready'); return; }
    O.load(card.getAttribute('data-family'), w).then(function () { card.classList.add('is-ready'); }, function () { card.classList.add('is-ready'); });
  }

  var seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.setAttribute('data-seen', '');
      ready(e.target, weight);
      seen.unobserve(e.target);
    });
  }, { rootMargin: '300px 0px' }) : null;

  cards.forEach(function (card) {
    if (seen) seen.observe(card); else ready(card, weight);
    var link = card.querySelector('[data-studio]');
    if (link) {
      var refresh = function () { link.href = studioLink(card, sampleOf(card)); };
      link.addEventListener('pointerdown', refresh);
      link.addEventListener('focus', refresh);
      link.addEventListener('click', refresh);
    }
  });

  if (input) {
    var t = 0;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        cards.forEach(function (card) {
          var s = card.querySelector('.fo-sample');
          var v = sampleOf(card);
          s.textContent = v;
          if (v.length > 28) card.setAttribute('data-long', ''); else card.removeAttribute('data-long');
        });
      }, 60);
    });
  }

  [].slice.call(document.querySelectorAll('.fo-weight [data-w]')).forEach(function (b) {
    b.addEventListener('click', function () {
      weight = Number(b.getAttribute('data-w'));
      [].slice.call(document.querySelectorAll('.fo-weight [data-w]')).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      cards.forEach(function (card) {
        card.querySelector('.fo-sample').style.fontWeight = String(weight);
        if (card.hasAttribute('data-seen') || !seen) ready(card, weight);
      });
    });
  });
})();
