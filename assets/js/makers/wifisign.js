/* Quick maker: Wi-Fi sign (V19b). The standard WIFI: QR (the ZXing de-facto format) plus the name and password in
   print for people who cannot scan. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  /* Backslash-escape the characters the format reserves: \ ; , " : */
  function esc(s) { return String(s == null ? '' : s).replace(/([\\;,":])/g, '\\$1'); }
  /* WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<password>;H:true;;  P is left out for open networks, H only when hidden.
     Returns '' when a secured network has no password yet. */
  function wifiPayload(v) {
    var sec = v.security || 'WPA';
    if (!v.ssid) return '';
    if (sec !== 'nopass' && !v.password) return '';
    var s = 'WIFI:T:' + sec + ';S:' + esc(v.ssid) + ';';
    if (sec !== 'nopass') s += 'P:' + esc(v.password) + ';';
    if (v.hidden) s += 'H:true;';
    return s + ';';
  }

  var STYLES = {
    cafe: { bg: '#EFE6D6', card: '#FFFBF3', ink: '#2B1E16', muted: '#5E4C3E', accent: '#B4532A', head: 'Fraunces', headW: 700, body: 'DM Sans', mono: 'JetBrains Mono', heading: 'Free Wi-Fi' },
    clean: { bg: '#FFFFFF', card: null, ink: '#15171C', muted: '#555B66', accent: '#2F5BD3', head: 'Plus Jakarta Sans', headW: 700, body: 'Inter', mono: 'JetBrains Mono', heading: 'Wi-Fi' },
    bold: { bg: '#2F5BD3', card: null, ink: '#FFFFFF', muted: '#E4EAFF', accent: '#FFFFFF', head: 'Archivo Black', headW: 400, body: 'Inter', mono: 'JetBrains Mono', heading: 'Wi-Fi', upper: true },
    dark: { bg: '#141418', card: null, ink: '#F4F2EE', muted: '#B5B2BE', accent: '#8BD3FF', head: 'Space Grotesk', headW: 700, body: 'Space Grotesk', mono: 'Space Mono', heading: 'Get online' },
    home: { bg: '#DCE5D3', card: '#F8FAF4', ink: '#24301F', muted: '#4D5B47', accent: '#4F6B3A', head: 'Caveat', headW: 700, body: 'Nunito', mono: 'IBM Plex Mono', heading: 'Make yourself at home' }
  };

  LE.makers.register({
    id: 'wifisign',
    name: 'Wi-Fi sign',
    category: 'Business',
    summary: 'A sign with a code that joins your Wi-Fi, and the password in print.',
    keywords: ['wifi', 'wi-fi', 'wireless', 'password', 'network', 'qr', 'guest', 'cafe', 'airbnb', 'home', 'office', 'sign', 'table tent'],
    sizes: [
      { id: 'tent', name: 'Tent 4×6', w: 1200, h: 1800 },
      { id: 'a5', name: 'A5', w: 1240, h: 1754 },
      'square'
    ],
    inputs: [
      { key: 'ssid', label: 'Network name', type: 'text', required: true, max: 32, placeholder: 'Guest Wi-Fi', hint: 'Exactly as your phone lists it, including capitals and spaces.' },
      { key: 'password', label: 'Password', type: 'text', max: 63, placeholder: 'your password' },
      { key: 'security', label: 'Security', type: 'choice', options: [{ id: 'WPA', name: 'WPA/WPA2/WPA3' }, { id: 'WEP', name: 'WEP (old)' }, { id: 'nopass', name: 'None (open)' }], default: 'WPA' },
      { key: 'hidden', label: 'Hidden network', type: 'toggle', default: false, hint: 'The network does not show up in lists' },
      { key: 'heading', label: 'Heading', type: 'text', max: 32, placeholder: 'Free Wi-Fi' },
      { key: 'note', label: 'Small print', type: 'text', max: 90, placeholder: 'Point your camera at the code to join.' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'cafe', name: 'Café' },
      { id: 'clean', name: 'Clean' },
      { id: 'bold', name: 'Bold' },
      { id: 'dark', name: 'Dark' },
      { id: 'home', name: 'Guest room' }
    ],
    sample: { values: { ssid: 'Corner Café Guests', password: 'flatwhite2026', security: 'WPA' } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, style = env.style;
      var S = Object.assign({}, STYLES[style] || STYLES.cafe);
      if (v.accent) {
        if (style === 'bold') { S.bg = v.accent; S.ink = C.readable(v.accent, ['#FFFFFF', '#16131C']); S.muted = S.ink; S.accent = S.ink; }
        else S.accent = v.accent;
      }
      var sec = v.security || 'WPA';
      var code = wifiPayload(v);
      if (sec === 'WPA' && v.password && v.password.length < 8) env.warn('input', 'WPA passwords are 8 to 63 characters. Check this one.', 'password');
      if (sec === 'WEP' && v.password && [5, 10, 13, 26].indexOf(v.password.length) < 0) env.warn('input', 'WEP keys are 5 or 13 characters (or 10 or 26 hex digits). Check this one.', 'password');
      var u = Math.min(W, H * 0.72) / 100;
      var page = env.page(S.bg), L = [];
      var M = 6.5 * u;
      var card = S.card ? { x: M, y: M, w: W - 2 * M, h: H - 2 * M } : { x: 0, y: 0, w: W, h: H };
      var under = S.card || S.bg;
      var pad = (S.card ? 7 : 10) * u;
      var inner = { x: card.x + pad, y: card.y + pad, w: card.w - 2 * pad, h: card.h - 2 * pad };
      var ink = C.readable(under, [S.ink]), muted = C.readable(under, [S.muted, S.ink]), acc = C.ensure(S.accent, under, 3);
      var accText = C.ensure(S.accent, under, 4.5);

      function blocks(s, q) {
        var out = [], y = 0, x = inner.x, w = inner.w;
        function push(l, gap) { l.y = y; out.push(l); y += l.h + (gap || 0); return l; }
        var ic = 11 * u * s;
        push(env.icon('lucide:wifi', { id: 'wifi-icon', name: 'Wi-Fi icon', x: x + (w - ic) / 2, y: 0, w: ic, h: ic, color: acc, strokeWidth: 2.2 }), 2 * u * s);
        push(env.text({ id: 'heading', name: 'Heading', text: v.heading || S.heading, x: x, y: 0, w: w, font: S.head, weight: S.headW, size: (style === 'home' ? 11 : style === 'bold' ? 13 : 10.5) * u * s, min: 4 * u, maxLines: 2, uppercase: !!S.upper, lineHeight: style === 'home' ? 1.1 : 1.05, tracking: style === 'bold' ? 0 : -0.02, align: 'center', color: ink, balance: true }), 4 * u * s);
        var qx = x + (w - q) / 2;
        if (code) {
          if (S.card) { push(env.qr(code, { id: 'qr', name: 'Wi-Fi QR code', x: qx, y: 0, w: q, h: q, color: '#111111', background: '#FFFFFF', quiet: 4, level: 'M' }), 4 * u * s); }
          else {
            var tw = q + 4 * u;
            out.push(env.rect({ id: 'qr-tile', name: 'Code tile', x: x + (w - tw) / 2, y: y, w: tw, h: tw, fill: '#FFFFFF', radius: style === 'clean' ? 2 * u : 3 * u, stroke: style === 'clean' ? { width: 0.3 * u, color: '#C9CDD4' } : null }));
            var ql = env.qr(code, { id: 'qr', name: 'Wi-Fi QR code', x: qx, y: y + 2 * u, w: q, h: q, color: '#111111', background: '#FFFFFF', quiet: 4, level: 'M' });
            out.push(ql); y += tw + 4 * u * s;
          }
        } else {
          var phc = C.mix(under, ink, 0.05);
          out.push(env.rect({ id: 'qr-placeholder', name: 'Code goes here', x: qx, y: y, w: q, h: q, fill: phc, stroke: { width: 0.4 * u, color: C.mix(under, ink, 0.35), dash: [1.6 * u, 1.2 * u] }, radius: 2 * u }));
          var pt = env.text({ id: 'qr-hint', name: 'Code hint', text: 'Add the password to make the code', x: qx + q * 0.12, y: 0, w: q * 0.76, font: S.body, weight: 700, size: 3.4 * u, min: 1.8 * u, maxLines: 4, align: 'center', color: C.readable(phc, [S.muted, S.ink]), balance: true });
          pt.y = y + (q - pt.h) / 2; out.push(pt); y += q + 4 * u * s;
        }
        function row(label, value, id, big) {
          push(env.text({ id: id + '-label', name: label + ' label', text: label, x: x, y: 0, w: w, font: S.body, weight: 700, size: 2.7 * u * s, min: 1.6 * u, maxLines: 1, uppercase: true, tracking: 0.16, align: 'center', color: accText }), 0.6 * u * s);
          push(env.text({ id: id, name: label, text: value, x: x, y: 0, w: w, font: S.mono, weight: 700, size: (big ? 5.6 : 4.6) * u * s, min: 1.6 * u, maxLines: 2, align: 'center', color: ink }), 2.8 * u * s);
        }
        row('Network', v.ssid || '', 'ssid', false);
        if (sec !== 'nopass') { if (v.password) row('Password', v.password, 'password', true); }
        else row('Password', 'None needed', 'password', false);
        var foot = v.note || (code ? 'Point your phone camera at the code to join.' : '');
        if (foot) push(env.text({ id: 'note', name: 'Small print', text: foot, x: x, y: 0, w: w, font: S.body, weight: 400, size: 2.9 * u * s, min: 1.6 * u, maxLines: 3, align: 'center', color: muted, balance: true }));
        return { layers: out, h: y };
      }
      var qMax = Math.min(inner.w * (env.square ? 0.46 : 0.66), 54 * u), qMin = Math.min(inner.w * 0.4, 34 * u);
      var res, s = 1, q = qMax;
      for (var i = 0; i < 16; i++) {
        res = blocks(s, q);
        if (res.h <= inner.h) break;
        if (q > qMin) q = Math.max(qMin, q - (res.h - inner.h));
        else s = Math.max(0.5, s * 0.92);
      }
      var top = inner.y + (inner.h - res.h) / 2;
      res.layers.forEach(function (l) { l.y += top; });
      if (style === 'cafe') {
        L.push(env.rect({ id: 'card', name: 'Card', x: card.x, y: card.y, w: card.w, h: card.h, radius: 1.5 * u, fill: S.card, shadow: { color: 'rgba(60,40,20,.16)', blur: 3 * u, x: 0, y: 1 * u } }));
        L.push(env.rect({ id: 'rule', name: 'Inner rule', x: card.x + 2.4 * u, y: card.y + 2.4 * u, w: card.w - 4.8 * u, h: card.h - 4.8 * u, fill: { type: 'none' }, stroke: { width: 0.3 * u, color: acc } }));
      } else if (style === 'home') {
        L.push(env.rect({ id: 'card', name: 'Card', x: card.x, y: card.y, w: card.w, h: card.h, radius: 5 * u, fill: S.card }));
        L.push(env.ellipse({ id: 'dot', name: 'Decoration', x: W - 22 * u, y: -10 * u, w: 34 * u, h: 34 * u, fill: C.mix(S.bg, acc, 0.25) }));
        L.unshift(L.pop());
      } else if (style === 'clean') {
        L.push(env.rect({ id: 'accent-bar', name: 'Accent bar', x: 0, y: 0, w: W, h: 1.6 * u, fill: acc }));
      } else if (style === 'bold') {
        L.push(env.ellipse({ id: 'ring', name: 'Decoration', x: W - 18 * u, y: H - 18 * u, w: 40 * u, h: 40 * u, fill: { type: 'none' }, stroke: { width: 1.2 * u, color: C.rgba(S.ink, 0.25) } }));
      } else if (style === 'dark') {
        L.push(env.rect({ id: 'accent-bar', name: 'Accent bar', x: inner.x, y: H - 4 * u, w: inner.w, h: 0.8 * u, fill: acc }));
      }
      L = L.concat(res.layers);
      page.layers = L;
      return { name: 'Wi-Fi — ' + (v.ssid || ''), pages: [page] };
    }
  });
  LE.makers.wifiPayload = wifiPayload;
})();
