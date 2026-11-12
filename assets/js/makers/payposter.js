/* Quick maker: "Scan to pay" poster (V19a). A UPI QR built from the person's own UPI ID and name, or any payment
   link they paste. Nothing is invented: without an ID (or link) the poster shows an empty code box. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var UPI_RE = '^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.]{1,63}$';
  var LINK_RE = '^([hH][tT][tT][pP][sS]?|[uU][pP][iI]):\\/\\/\\S{3,}$';

  function amountText(a) { return a ? Number(a).toFixed(2) : ''; }
  /* The standard UPI deep link (NPCI "upi://pay"): pa, pn, am, cu, tn. The ID is kept as typed (validated to a safe
     character set, so @ stays literal); the name and note are percent-encoded. Returns '' when the ID or name is missing. */
  function upiLink(v) {
    var id = String(v.upiId || '').trim(), name = String(v.payee || '').trim();
    if (!id || !name || !new RegExp(UPI_RE).test(id)) return '';
    var s = 'upi://pay?pa=' + id + '&pn=' + encodeURIComponent(name);
    if (v.amount) s += '&am=' + amountText(v.amount);
    s += '&cu=INR';
    if (v.note) s += '&tn=' + encodeURIComponent(v.note);
    return s;
  }
  function payload(v) {
    if ((v.mode || 'upi') === 'link') return v.link && new RegExp(LINK_RE).test(v.link) ? v.link : '';
    return upiLink(v);
  }
  function shortLink(u) { return String(u || '').replace(/^https?:\/\//i, '').replace(/\/$/, ''); }

  var STYLES = {
    counter: { bg: '#0F5F5A', card: '#FFFFFF', ink: '#13201F', muted: '#4A5A58', head: 'Plus Jakarta Sans', body: 'Inter', mono: 'JetBrains Mono', radius: 4, upper: false },
    bold: { bg: '#FFCF3F', card: null, ink: '#16131C', muted: '#3F3A46', head: 'Archivo Black', body: 'Inter', mono: 'JetBrains Mono', radius: 0, upper: true },
    minimal: { bg: '#FFFFFF', card: null, ink: '#111111', muted: '#4D4D4D', head: 'Inter', body: 'Inter', mono: 'IBM Plex Mono', radius: 0, upper: false },
    kraft: { bg: '#E7D8BC', card: '#FFFDF7', ink: '#2F2418', muted: '#5C4C38', head: 'Pacifico', body: 'DM Sans', mono: 'Space Mono', radius: 2, upper: false },
    dark: { bg: '#121216', card: null, ink: '#F4F2EE', muted: '#B9B6C2', head: 'Space Grotesk', body: 'Space Grotesk', mono: 'JetBrains Mono', radius: 3, upper: false }
  };

  LE.makers.register({
    id: 'payposter',
    name: 'Scan to pay',
    category: 'Business',
    summary: 'A counter poster with a UPI code from your own ID, or any payment link.',
    keywords: ['upi', 'pay', 'payment', 'qr', 'scan to pay', 'shop', 'counter', 'india', 'gpay', 'phonepe', 'paytm', 'bhim', 'donation', 'tip'],
    sizes: [
      { id: 'a5', name: 'A5', w: 1240, h: 1754 },
      { id: 'tent', name: 'Tent 4×6', w: 1200, h: 1800 },
      'square'
    ],
    inputs: [
      { key: 'mode', label: 'Code for', type: 'choice', options: [{ id: 'upi', name: 'UPI (India)' }, { id: 'link', name: 'Payment link' }], default: 'upi', hint: 'Check the code with your own payment app before printing.' },
      { key: 'heading', label: 'Heading', type: 'text', max: 28, placeholder: 'Scan to pay' },
      { key: 'payee', label: 'Payee name', type: 'text', max: 50, placeholder: 'Asha’s Kitchen', hint: 'For UPI, the name on your account. People see it in their app before they pay.' },
      { key: 'upiId', label: 'UPI ID', type: 'text', max: 80, placeholder: 'yourname@bank', pattern: UPI_RE, patternHint: 'A UPI ID looks like name@bank: letters, digits, dots or dashes, then @ and your bank’s handle.', worst: 'a.very.long.upi.id.for.a.shop-name.2026@exampleokbank' },
      { key: 'amount', label: 'Fixed amount (₹)', type: 'number', min: 1, max: 100000, step: 0.01, hint: 'UPI only. Leave empty so people type the amount.' },
      { key: 'note', label: 'Payment note', type: 'text', max: 40, placeholder: 'Table 4', hint: 'UPI only. Shown in the payer’s app.' },
      { key: 'link', label: 'Payment link', type: 'text', max: 300, placeholder: 'https://…', pattern: LINK_RE, patternHint: 'Paste a full link that starts with https://', worst: 'https://pay.example.com/checkout/very-long-reference/' + 'a1b2c3d4e5f6g7h8i9j0'.repeat(4) + '?ref=counter-poster&utm=print', hint: 'Payment link only. Paste the link your payment provider gave you.' },
      { key: 'accepted', label: 'Accepted apps', type: 'text', max: 70, placeholder: 'Any UPI app', hint: 'Plain text, for example the names of the apps you accept.' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'counter', name: 'Counter card' },
      { id: 'bold', name: 'Bold' },
      { id: 'minimal', name: 'Print-friendly' },
      { id: 'kraft', name: 'Café' },
      { id: 'dark', name: 'Dark' }
    ],
    sample: { values: { mode: 'upi', payee: 'Asha’s Kitchen', upiId: 'yourname@bank', accepted: 'Any UPI app' } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, style = env.style;
      var S = Object.assign({}, STYLES[style] || STYLES.counter);
      var mode = v.mode || 'upi';
      if (v.accent) {
        if (style === 'counter') S.bg = C.isDark(v.accent) ? v.accent : C.shade(v.accent, 0.45);
        else if (style === 'bold') S.bg = v.accent;
        else if (style === 'dark') S.accent = v.accent;
      }
      var accent = v.accent || (style === 'dark' ? '#7CE0B8' : style === 'kraft' ? '#B5532F' : style === 'minimal' ? '#111111' : S.bg);
      var u = Math.min(W, H * 0.72) / 100;
      var code = payload(v);
      var page = env.page(S.bg);
      var L = [];
      var M = (style === 'minimal' ? 6 : 6.5) * u;
      var card = S.card ? { x: M, y: M, w: W - 2 * M, h: H - 2 * M } : { x: 0, y: 0, w: W, h: H };
      var bgUnder = S.card || S.bg;
      /* bold: the heading sits on the colour, the rest on a white panel below. */
      var pad = (style === 'minimal' ? 10 : 7) * u;
      var inner = { x: card.x + pad, y: card.y + pad, w: card.w - 2 * pad, h: card.h - 2 * pad };
      var ink = C.readable(bgUnder, [S.ink]);
      var muted = C.readable(bgUnder, [S.muted, S.ink]);
      var acc = C.ensure(accent, bgUnder, 4.5);

      function blocks(s, q) {
        var out = [], y = 0, x = inner.x, w = inner.w;
        function push(l, gap) { l.y = y; out.push(l); y += l.h + (gap || 0); return l; }
        var kicker = v.payee || (mode === 'upi' ? '' : '');
        if (kicker && style !== 'kraft') push(env.text({ id: 'payee-top', name: 'Payee', text: kicker, x: x, y: 0, w: w, font: S.body, weight: 700, size: 3.8 * u * s, min: 2 * u, maxLines: 2, uppercase: true, tracking: 0.14, align: 'center', color: style === 'dark' || style === 'bold' ? ink : acc, balance: true }), 1.6 * u * s);
        var hd = v.heading || 'Scan to pay';
        var headSize = (style === 'kraft' ? 12 : style === 'bold' ? 11 : 11) * u * s;
        push(env.text({ id: 'heading', name: 'Heading', text: hd, x: x, y: 0, w: w, font: S.head, weight: 700, size: headSize, min: 4 * u, maxLines: 2, uppercase: S.upper, lineHeight: style === 'kraft' ? 1.3 : 1.05, tracking: style === 'bold' ? -0.01 : -0.02, align: 'center', color: style === 'dark' ? ink : ink, balance: true }), 3.2 * u * s);
        if (style === 'kraft' && kicker) push(env.text({ id: 'payee-top', name: 'Payee', text: kicker, x: x, y: 0, w: w, font: S.body, weight: 700, size: 3.4 * u * s, min: 2 * u, maxLines: 2, align: 'center', color: acc, balance: true }), 2.4 * u * s);
        var qx = x + (w - q) / 2;
        if (code) {
          var qrl = env.qr(code, { id: 'qr', name: mode === 'upi' ? 'UPI QR code' : 'Payment QR code', x: qx, y: 0, w: q, h: q, color: '#111111', background: '#FFFFFF', quiet: 4, level: 'M' });
          if (style === 'dark') {
            var tile = env.rect({ id: 'qr-tile', name: 'Code tile', x: qx - 2 * u, y: y, w: q + 4 * u, h: q + 4 * u, fill: '#FFFFFF', radius: 3 * u });
            out.push(tile); qrl.y = y + 2 * u; out.push(qrl); y += q + 4 * u + 3.4 * u * s;
          } else if (style === 'bold' || style === 'minimal') {
            var fr = env.rect({ id: 'qr-frame', name: 'Code frame', x: qx - 1.2 * u, y: 0, w: q + 2.4 * u, h: q + 2.4 * u, fill: '#FFFFFF', stroke: { width: style === 'bold' ? 1.1 * u : 0.35 * u, color: '#111111' }, radius: style === 'bold' ? 0 : 1.5 * u });
            fr.y = y; out.push(fr); qrl.y = y + 1.2 * u; out.push(qrl); y += q + 2.4 * u + 3.4 * u * s;
          } else { qrl.y = y; out.push(qrl); y += q + 3 * u * s; }
        } else {
          var ph = env.rect({ id: 'qr-placeholder', name: 'Code goes here', x: qx, y: y, w: q, h: q, fill: style === 'minimal' ? '#FFFFFF' : C.mix(bgUnder, ink, 0.04), stroke: { width: 0.4 * u, color: C.mix(bgUnder, ink, 0.35), dash: [1.6 * u, 1.2 * u] }, radius: 2 * u });
          out.push(ph);
          var phBg = style === 'minimal' ? '#FFFFFF' : C.mix(bgUnder, ink, 0.04);
          var pt = env.text({ id: 'qr-hint', name: 'Code hint', text: mode === 'upi' ? 'Add your UPI ID and payee name to make the code' : 'Paste your payment link to make the code', x: qx + q * 0.12, y: 0, w: q * 0.76, font: S.body, weight: 700, size: 3.2 * u, min: 1.8 * u, maxLines: 4, align: 'center', color: C.readable(phBg, [S.muted, S.ink]), balance: true });
          pt.y = y + (q - pt.h) / 2; out.push(pt);
          y += q + 3 * u * s;
        }
        if (mode === 'upi' && v.amount) push(env.text({ id: 'amount', name: 'Amount', text: '₹' + Number(v.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), x: x, y: 0, w: w, font: 'Inter', weight: 700, size: 6.4 * u * s, min: 3 * u, maxLines: 1, align: 'center', color: ink }), 1.2 * u * s);
        if (mode === 'upi' && v.note) push(env.text({ id: 'note', name: 'Note', text: v.note, x: x, y: 0, w: w, font: S.body, weight: 400, size: 3 * u * s, min: 2 * u, maxLines: 2, align: 'center', color: muted, balance: true }), 2.4 * u * s);
        if (mode === 'upi' && v.upiId) {
          push(env.text({ id: 'upi-label', name: 'UPI ID label', text: 'UPI ID', x: x, y: 0, w: w, font: S.body, weight: 700, size: 2.6 * u * s, min: 1.6 * u, maxLines: 1, uppercase: true, tracking: 0.16, align: 'center', color: muted }), 0.6 * u * s);
          push(env.text({ id: 'upi-id', name: 'UPI ID', text: v.upiId, x: x, y: 0, w: w, font: S.mono, weight: 700, size: 5 * u * s, min: 1.5 * u, maxLines: 1, align: 'center', color: ink }), 2.2 * u * s);
        }
        if (mode === 'link' && v.link) push(env.text({ id: 'link', name: 'Link', text: shortLink(v.link), x: x, y: 0, w: w, font: S.mono, weight: 400, size: 3.4 * u * s, min: 1.5 * u, maxLines: 3, align: 'center', color: ink }), 2.2 * u * s);
        if (v.accepted) push(env.text({ id: 'accepted', name: 'Accepted apps', text: v.accepted, x: x, y: 0, w: w, font: S.body, weight: 700, size: 3.6 * u * s, min: 1.8 * u, maxLines: 2, align: 'center', color: style === 'dark' || style === 'bold' ? ink : acc, balance: true }), 1.6 * u * s);
        var foot = mode === 'upi' && v.payee ? 'Check that your app shows “' + v.payee + '” before you pay.' : 'Check the name your app shows before you pay.';
        push(env.text({ id: 'check', name: 'Check line', text: foot, x: x, y: 0, w: w, font: S.body, weight: 400, size: 2.8 * u * s, min: 1.5 * u, maxLines: 3, align: 'center', color: muted, balance: true }));
        return { layers: out, h: y };
      }
      var qMax = Math.min(inner.w * (env.square ? 0.5 : 0.78), 62 * u), qMin = Math.min(inner.w * 0.42, 38 * u);
      var res, s = 1, q = qMax;
      for (var i = 0; i < 14; i++) {
        res = blocks(s, q);
        if (res.h <= inner.h) break;
        if (q > qMin) q = Math.max(qMin, q - (res.h - inner.h));
        else s = Math.max(0.55, s * 0.92);
      }
      var top = inner.y + (inner.h - res.h) / 2;
      res.layers.forEach(function (l) { l.y += top; });
      if (S.card) L.push(env.rect({ id: 'card', name: 'Card', x: card.x, y: card.y, w: card.w, h: card.h, radius: S.radius * u, fill: S.card, shadow: style === 'kraft' ? { color: 'rgba(60,40,10,.18)', blur: 3 * u, x: 0, y: 1 * u } : null }));
      if (style === 'minimal') L.push(env.rect({ id: 'border', name: 'Border', x: 3 * u, y: 3 * u, w: W - 6 * u, h: H - 6 * u, fill: { type: 'none' }, stroke: { width: 0.35 * u, color: '#111111' } }));
      if (style === 'bold') {
        L.push(env.rect({ id: 'band', name: 'Band', x: 0, y: 0, w: W, h: 2.2 * u, fill: ink }));
        L.push(env.rect({ id: 'band-bottom', name: 'Band', x: 0, y: H - 2.2 * u, w: W, h: 2.2 * u, fill: ink }));
      }
      if (style === 'kraft') {
        L.push(env.rect({ id: 'tape', name: 'Tape', x: W / 2 - 9 * u, y: card.y - 2.2 * u, w: 18 * u, h: 4.4 * u, fill: 'rgba(255,255,255,0.55)', rotation: -3 }));
      }
      if (style === 'dark') {
        L.push(env.rect({ id: 'accent-bar', name: 'Accent bar', x: card.x, y: card.y + card.h - 1.6 * u, w: card.w, h: 1.6 * u, fill: accent }));
      }
      L = L.concat(res.layers);
      page.layers = L;
      return { name: (v.heading || 'Scan to pay') + (v.payee ? ' — ' + v.payee : ''), pages: [page] };
    }
  });
  /* Exposed for tests and agents: the exact payload a poster encodes. */
  LE.makers.payPayload = payload;
})();
