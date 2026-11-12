// CloudFront Function (runtime cloudfront-js-2.0), viewer-request event, attached to the default behavior.
// 1. Directory indexes: /studio/ -> /studio/index.html (S3 REST origins do not do this themselves).
// 2. Folder without a slash: /studio -> 301 /studio/ (keeps the query string), so relative links work.
// 3. Share target before the app is installed: the Android share sheet POSTs to /studio/?share-target=1.
//    Once installed, the service worker answers that POST on the device and nothing reaches CloudFront.
//    If it does reach us (worker not running yet), send people to the studio instead of an S3 error.
//    This only runs if the behavior allows POST; see docs/DEPLOY.md.
function handler(event) {
  var req = event.request;
  var uri = req.uri;

  if (req.method === 'POST') {
    if (uri === '/studio/' || uri === '/studio/index.html') {
      return { statusCode: 303, statusDescription: 'See Other', headers: { location: { value: '/studio/?shared=failed' }, 'cache-control': { value: 'no-store' } } };
    }
    return { statusCode: 405, statusDescription: 'Method Not Allowed', headers: { allow: { value: 'GET, HEAD' } } };
  }

  if (uri.charAt(uri.length - 1) === '/') {
    req.uri = uri + 'index.html';
    return req;
  }

  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) {
    var qs = [];
    var q = req.querystring || {};
    for (var key in q) {
      var v = q[key];
      if (v.multiValue) { for (var i = 0; i < v.multiValue.length; i++) qs.push(key + (v.multiValue[i].value ? '=' + v.multiValue[i].value : '')); }
      else qs.push(key + (v.value ? '=' + v.value : ''));
    }
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: uri + '/' + (qs.length ? '?' + qs.join('&') : '') } } };
  }
  return req;
}
