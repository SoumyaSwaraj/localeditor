/* Verify page: works out the SHA-256 fingerprint of a dropped file on this device and compares it with the fingerprint in
   the link (#sha256=…), from a LocalEditor fingerprint receipt, or one pasted in. Nothing is uploaded or fetched. */
(function () {
  'use strict';
  var IT = window.IT || {};
  function $(id) { return document.getElementById(id); }
  var expected = null, last = null;

  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  /* Fallback when the page is opened without a secure context (crypto.subtle missing). */
  function sha256js(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6, buf = new Uint8Array(total);
    buf.set(bytes); buf[len] = 0x80;
    var dv = new DataView(buf.buffer), bits = len * 8;
    dv.setUint32(total - 4, bits >>> 0); dv.setUint32(total - 8, Math.floor(bits / 4294967296));
    var w = new Uint32Array(64);
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        w[i] = (w[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        var t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (v) { return ('00000000' + v.toString(16)).slice(-8); }).join('');
  }
  function sha256(bytes) {
    var s = window.crypto && window.crypto.subtle;
    if (s && s.digest) return s.digest('SHA-256', bytes).then(function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }, function () { return sha256js(bytes); });
    return Promise.resolve(sha256js(bytes));
  }
  function short(hex) { return hex.slice(0, 16).toUpperCase().replace(/(.{4})(?!$)/g, '$1 '); }
  function spaced(hex) { return hex.replace(/(.{16})/g, '$1 ').trim(); }
  function fromHash() {
    var m = /[#&]sha256=([0-9a-fA-F]{64})(?:&|$)/.exec(location.hash || '');
    return m ? m[1].toLowerCase() : null;
  }
  function size(n) { return IT.formatBytes ? IT.formatBytes(n) + ' (' + n.toLocaleString('en-US') + ' bytes)' : n + ' bytes'; }

  function showExpected() {
    var box = $('vf-expected');
    box.hidden = !expected;
    if (expected) { $('vf-exp-short').textContent = short(expected); $('vf-exp-full').textContent = spaced(expected); }
  }
  function verdict() {
    var box = $('vf-verdict');
    if (!last) return;
    var title = $('vf-verdict-title'), text = $('vf-verdict-text');
    if (!expected) {
      box.className = 'vf-verdict is-info';
      title.textContent = 'This is the file’s fingerprint';
      text.textContent = 'To check it against a receipt, open the receipt’s link or QR code, or paste the fingerprint below.';
    } else if (last.hash === expected) {
      box.className = 'vf-verdict is-match';
      title.textContent = 'This file matches the fingerprint';
      text.textContent = 'It is byte for byte the same file the receipt was made from. That does not show who made it or that its contents are true.';
    } else {
      box.className = 'vf-verdict is-diff';
      title.textContent = 'This file is different';
      text.textContent = 'It is not the file the receipt was made from: at least one byte has changed. Re-saving a document changes its fingerprint even when it looks the same.';
    }
  }
  function check(file) {
    var res = $('vf-result');
    res.hidden = false;
    $('vf-verdict').className = 'vf-verdict is-info';
    $('vf-verdict-title').textContent = 'Working out the fingerprint…';
    $('vf-verdict-text').textContent = '';
    $('vf-name').textContent = file.name || 'File';
    $('vf-size').textContent = size(file.size);
    $('vf-short').textContent = ''; $('vf-full').textContent = '';
    file.arrayBuffer().then(function (buf) { return sha256(new Uint8Array(buf)); }).then(function (hex) {
      last = { hash: hex, name: file.name };
      $('vf-short').textContent = short(hex);
      $('vf-full').textContent = spaced(hex);
      verdict();
    }, function () {
      $('vf-verdict').className = 'vf-verdict is-diff';
      $('vf-verdict-title').textContent = 'This file could not be read';
    });
  }

  var drop = $('vf-drop');
  if (IT.dropzone) IT.dropzone(drop, { onFiles: function (f) { check(f[0]); }, paste: true });
  else $('vf-file').addEventListener('change', function () { if (this.files[0]) check(this.files[0]); });
  $('vf-copy').addEventListener('click', function () { if (last && IT.copy) IT.copy(last.hash); });
  $('vf-again').addEventListener('click', function () { $('vf-file').click(); });
  $('vf-paste').addEventListener('input', function () {
    var v = this.value.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    var msg = $('vf-paste-msg');
    if (!v) { msg.textContent = ''; return; }
    if (v.length !== 64) { msg.textContent = v.length + ' of 64 characters'; return; }
    expected = v;
    msg.textContent = 'Using this fingerprint.';
    showExpected(); verdict();
  });
  window.addEventListener('hashchange', function () { expected = fromHash() || expected; showExpected(); verdict(); });
  expected = fromHash();
  showExpected();
})();
