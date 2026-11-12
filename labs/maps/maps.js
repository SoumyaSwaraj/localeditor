/* LocalEditor maps, lab entry: a thin re-export of the product module assets/js/le-maps.js (X6 promoted the S2 prototype that
   lived here). The labs keep loading this path; LE.maps, its function shapes and its worker are the product's. */
(function () {
  'use strict';
  if (window.LE && window.LE.maps && window.LE.maps.shared) return;
  var here = (document.currentScript && document.currentScript.src) || location.href;
  var src = new URL('../../assets/js/le-maps.js', here).href;
  /* Synchronous while the page is parsing, so the lab scripts after this tag find LE.maps at once. */
  if (document.readyState === 'loading') document.write('<script src="' + src + '"><\/script>');
  else { var s = document.createElement('script'); s.src = src; document.head.appendChild(s); }
})();
