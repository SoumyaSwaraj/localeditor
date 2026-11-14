'use strict';
/* Styled QR codes (docs/QR.md): the engine (LE.qr), the tool page, the studio's QR element, makers, agents and
   "Make many". Every code the engine can draw is read back with the vendored decoder. */

const fs = require('fs');
const path = require('path');
const cases = {};
const ROOT = path.join(__dirname, '..');
const URL = 'https://localeditor.net/qr-code-generator/';
/* A small picture with a clear subject, made in the page (no fixture file needed). */
const PICTURE = `(() => { const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 160, 160); gr.addColorStop(0, '#f97316'); gr.addColorStop(1, '#7c3aed'); g.fillStyle = gr; g.fillRect(0, 0, 160, 160); g.fillStyle = '#fff'; g.beginPath(); g.arc(80, 80, 44, 0, 7); g.fill(); g.fillStyle = '#111827'; g.fillRect(60, 60, 40, 40); return c.toDataURL('image/png'); })()`;

async function engine(browser, base, h) {
  const page = await h.open(browser, base, '/about/', 'desktop');
  await page.addScriptTag({ url: base + '/assets/vendor/qrcode.js' });
  await page.addScriptTag({ url: base + '/assets/js/le-qr.js' });
  await page.evaluate(() => LE.qr.decoder());
  return page;
}
const report = (page, spec) => page.evaluate((s) => LE.qr.check(s), spec);

cases['engine: every preset passes the check and decodes at two sizes'] = async ({ browser, base, h }) => {
  const page = await engine(browser, base, h);
  const out = await page.evaluate(async (text) => {
    const res = [];
    for (const p of LE.qr.presets({ colors: ['#0369DA', '#EF8C57', '#17131F'] })) {
      const r = await LE.qr.check(LE.qr.withStyle(text, p.style));
      res.push({ id: p.id, ok: r.ok, decoded: r.decoded, sizes: r.sizes, bad: r.notes.filter((n) => n.level !== 'info').map((n) => n.code) });
    }
    return res;
  }, URL);
  h.assert(out.length >= 17 && out[0].id === 'brand', 'at least 16 presets plus the brand one: ' + out.length);
  out.forEach((r) => h.assert(r.ok && r.decoded === true && !r.bad.length && r.sizes.length === 2 && r.sizes[0] < r.sizes[1], 'preset ' + r.id + ': ' + JSON.stringify(r)));
  h.assert((await page.evaluate(() => LE.qr.presets().map((p) => p.id))).indexOf('brand') < 0, 'no brand preset without a brand kit');
  h.assert.noErrors(page);
};

cases['engine: every module shape and every eye shape decodes at two sizes'] = async ({ browser, base, h }) => {
  const page = await engine(browser, base, h);
  const out = await page.evaluate(async (text) => {
    const res = [], Q = LE.qr;
    const run = async (name, style) => { const r = await Q.check(Object.assign({ text, fg: '#17131f', bg: '#ffffff' }, style)); res.push({ name, ok: r.ok, decoded: r.decoded }); };
    for (const s of Q.SHAPES) await run('shape ' + s, { shape: s });
    const used = { o: {}, i: {} };
    for (const s of Q.SHAPES) for (const o of Q.EYES.outer) for (const i of Q.EYES.pairs[o]) { used.o[o] = used.i[i] = 1; for (const t of [text, 'https://a.co', text + '?' + 'abc123'.repeat(24)]) await run(s + ' with eye ' + o + '/' + i + ' (' + t.length + ')', { shape: s, eye: { outer: o, inner: i }, text: t }); }
    res.push({ name: 'every eye shape is in a pair', ok: Object.keys(used.o).length === Q.EYES.outer.length && Object.keys(used.i).length === Q.EYES.inner.length, decoded: true });
    return res;
  }, URL);
  h.assert.equal(out.length, 7 + 7 * 8 * 3 + 1);
  const bad = out.filter((r) => !(r.ok && r.decoded === true)).map((r) => r.name);
  h.assert(!bad.length, 'do not decode: ' + bad.join(', '));
};

cases['engine: each content type encodes the exact string and reads back as it'] = async ({ browser, base, h }) => {
  const page = await engine(browser, base, h);
  const want = {
    link: [{ url: 'example.com/menu' }, 'https://example.com/menu'],
    text: [{ text: 'Grüße, 你好 & <b>' }, 'Grüße, 你好 & <b>'],
    wifi: [{ ssid: 'Café;Guests', password: 'p:a"ss', security: 'WPA', hidden: true }, 'WIFI:T:WPA;S:Café\\;Guests;P:p\\:a\\"ss;H:true;;'],
    contact: [{ first: 'Ana', last: 'Li', org: 'Corner, Ltd', phone: '+44 20 7946 0000', email: 'ana@example.com' }, 'BEGIN:VCARD\nVERSION:3.0\nN:Li;Ana;;;\nFN:Ana Li\nORG:Corner\\, Ltd\nTEL;TYPE=CELL:+44 20 7946 0000\nEMAIL:ana@example.com\nEND:VCARD'],
    email: [{ to: 'hi@example.com', subject: 'Table for two', body: 'At 8?' }, 'mailto:hi@example.com?subject=Table%20for%20two&body=At%208%3F'],
    phone: [{ phone: '+1 (555) 010-0199' }, 'tel:+15550100199'],
    sms: [{ phone: '+15550100199', message: 'On my way' }, 'SMSTO:+15550100199:On my way'],
    chat: [{ link: 'https://chat.example/u/ana?text=hello' }, 'https://chat.example/u/ana?text=hello'],
    location: [{ lat: '51.5007', lng: '-0.1246', label: 'Big clock' }, 'geo:51.5007,-0.1246?q=Big%20clock'],
    event: [{ title: 'Launch; party', start: '2026-12-01T18:30', end: '2026-12-01T21:00', location: 'Hall 2' }, 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Launch\\; party\nDTSTART:20261201T183000\nDTEND:20261201T210000\nLOCATION:Hall 2\nEND:VEVENT\nEND:VCALENDAR'],
    pay: [{ upiId: 'ana@okbank', payee: 'Ana Li', amount: '120', note: 'Table 4' }, 'upi://pay?pa=ana@okbank&pn=Ana%20Li&am=120.00&cu=INR&tn=Table%204']
  };
  const out = await page.evaluate(async (want) => {
    const res = {};
    for (const t of LE.qr.TYPES) {
      const e = LE.qr.encode(t.id, want[t.id][0]);
      const cv = await LE.qr.canvas(LE.qr.withStyle(e.text, 'ocean'), 700);
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      const r = window.jsQR(d.data, d.width, d.height);
      res[t.id] = { text: e.text, error: e.error, read: r && new TextDecoder().decode(new Uint8Array(r.binaryData)) };
    }
    res.bad = [LE.qr.encode('pay', { upiId: 'not an id', payee: 'x' }), LE.qr.encode('chat', { link: 'http://plain.example' }), LE.qr.encode('location', { lat: '123', lng: '5' }), LE.qr.encode('wifi', { ssid: 'x' }), LE.qr.encode('text', { text: 'x'.repeat(5000) }), LE.qr.encode('nope', {})];
    return res;
  }, want);
  h.assert.equal(Object.keys(want).length, 11);
  Object.keys(want).forEach((k) => { h.assert.equal(out[k].text, want[k][1], k + ' payload'); h.assert.equal(out[k].read, want[k][1], k + ' read back'); h.assert(!out[k].error, k + ' has no error'); });
  out.bad.forEach((b, i) => h.assert(b.error && (i === 4 ? b.text.length === 1200 : b.text === ''), 'bad input ' + i + ' is refused with a reason'));
};

cases['engine: the Wi-Fi and payment strings are the makers\' own'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await h.need(page, ['makers']);
  await page.evaluate(() => LE.makers.ready().then(() => Promise.all([LE.makers.build('wifisign', { ssid: 'a', password: 'b' }), LE.makers.build('payposter', { upiId: 'ana@okbank', payee: 'c' })])));
  await page.addScriptTag({ url: base + '/assets/js/le-qr.js' });
  const out = await page.evaluate(() => {
    const w = { ssid: 'My; "Net"', password: 'se:cr\\et', security: 'WPA', hidden: true }, p = { upiId: 'shop.one@okbank', payee: 'Corner Café', amount: 49.5, note: 'Order #12' };
    return [LE.qr.encode('wifi', w).text, LE.makers.wifiPayload(w), LE.qr.encode('pay', p).text, LE.makers.payPayload(p), LE.qr.encode('wifi', { ssid: 'Open', security: 'nopass' }).text, LE.makers.wifiPayload({ ssid: 'Open', security: 'nopass' })];
  });
  h.assert(out[0] && out[0] === out[1], 'Wi-Fi: ' + out[0] + ' vs ' + out[1]);
  h.assert(out[2] && out[2] === out[3], 'payment: ' + out[2] + ' vs ' + out[3]);
  h.assert.equal(out[4], out[5]);
};

cases['guard: a picture that is too large and a pale colour pair are caught, each with the one fix'] = async ({ browser, base, h }) => {
  const page = await engine(browser, base, h);
  const pic = await page.evaluate(PICTURE);
  let r = await report(page, { text: URL, fg: '#17131f', bg: '#ffffff', shape: 'rounded', image: { src: pic, size: 0.42 } });
  let n = r.notes.find((x) => x.code === 'logo');
  h.assert(!r.ok && n && n.level === 'fail' && n.fix.label === 'Make the picture smaller' && r.logoCover > 0.12, 'too-large picture: ' + JSON.stringify(r.notes));
  h.assert.equal(r.ec, 'H', 'a centre picture raises error correction to H');
  r = await page.evaluate(async (a) => LE.qr.check(LE.qr.applyFix(a.spec, a.patch)), { spec: { text: URL, fg: '#17131f', bg: '#ffffff', shape: 'rounded', image: { src: pic, size: 0.42 } }, patch: n.fix.patch });
  h.assert(r.ok && r.decoded === true && r.logoCover <= 0.12, 'the fix makes it pass: ' + JSON.stringify(r.notes));
  const pale = { text: URL, fg: '#f2d9a0', bg: '#fff7e0', shape: 'dots' };
  r = await report(page, pale);
  n = r.notes.find((x) => x.code === 'contrast');
  h.assert(!r.ok && n && n.level === 'fail' && n.fix.label === 'Make the dots darker' && r.contrast < 2.5, 'light on light: ' + JSON.stringify(r));
  r = await page.evaluate(async (a) => LE.qr.check(LE.qr.applyFix(a.spec, a.patch)), { spec: pale, patch: n.fix.patch });
  h.assert(r.ok && r.decoded === true && r.contrast >= 4.5, 'darker dots pass: ' + JSON.stringify(r));
  r = await report(page, { text: URL, fg: '#8a8f98', bg: '#ffffff' });
  h.assert(r.notes.some((x) => x.code === 'contrast' && x.level === 'warn'), 'a mid grey is warned about');
  r = await report(page, { text: URL, fg: '#ffffff', bg: '#111827', shape: 'rounded' });
  n = r.notes.find((x) => x.code === 'inverted');
  h.assert(n && n.level === 'warn' && n.fix.label === 'Swap the colours', 'inverted codes are warned about');
  r = await report(page, { text: URL, fg: '#111111', bg: '#ffffff', shape: 'square', quiet: 0 });
  h.assert(r.quiet === 0 && r.notes.some((x) => x.code === 'quiet' && x.fix.patch.quiet === 4), 'no margin is warned about');
  r = await report(page, { text: 'x'.repeat(1300), fg: '#111111', bg: '#ffffff', shape: 'dots' });
  h.assert.equal(r.version > 20 && r.notes.some((x) => x.code === 'dense'), true, 'dense note');
  r = await report(page, { text: URL, fg: '#111111', bg: '#ffffff', shape: 'square', eye: { outer: 'square', inner: 'dot', outerColor: '#0b3d91' } });
  n = r.notes.find((x) => x.code === 'decode');
  h.assert(!r.ok && r.decoded === false && n.fix.label === 'Match the corner centres', 'a round centre in a square corner fails the test scan: ' + JSON.stringify(r.notes));
  r = await page.evaluate(async (a) => { const s = LE.qr.applyFix(a.spec, a.patch); return Object.assign(await LE.qr.check(s), { eye: s.eye }); }, { spec: { text: URL, fg: '#111111', bg: '#ffffff', shape: 'square', eye: { outer: 'square', inner: 'dot', outerColor: '#0b3d91' } }, patch: n.fix.patch });
  h.assert(r.ok && r.decoded && r.eye.inner === 'square' && r.eye.outer === 'square' && r.eye.outerColor === '#0b3d91', 'the fix keeps the frame and its colour');
  r = await report(page, { text: '  ', fg: '#111111', bg: '#ffffff' });
  h.assert(!r.ok && r.notes[0].code === 'empty', 'empty content');
};

cases['engine: gradients, transparent backgrounds, a centre picture, a picture background and every frame decode'] = async ({ browser, base, h }) => {
  const page = await engine(browser, base, h);
  const pic = await page.evaluate(PICTURE);
  const specs = {
    linear3: { text: URL, shape: 'connected', bg: '#ffffff', fg: { type: 'linear', angle: 200, stops: ['#0f766e', '#0369a1', '#4338ca'] } },
    radial: { text: URL, shape: 'dots', bg: '#ffffff', fg: { type: 'radial', stops: [{ at: 0, color: '#be185d' }, { at: 1, color: '#6b21a8' }] } },
    transparent: { text: URL, shape: 'rounded', bg: null, fg: '#14532d' },
    transparentLight: { text: URL, shape: 'square', bg: null, fg: '#ffffff' },
    logo: { text: URL, shape: 'rounded', bg: '#ffffff', fg: '#0b3d91', image: { src: pic, size: 0.26 } },
    photo: { text: URL, shape: 'dots', bg: '#ffffff', fg: '#17131f', picture: { src: pic } },
    photoLogo: { text: URL, bg: '#ffffff', fg: '#17131f', picture: { src: pic, dim: 0.5 }, image: { src: pic, size: 0.2, fit: 'cover', round: 0.5 } }
  };
  ['label', 'tab', 'badge', 'ticket'].forEach((s) => { specs['frame-' + s] = { text: URL, shape: 'rounded', bg: '#ffffff', fg: '#1e3a8a', radius: 0.06, frame: { style: s, text: s === 'tab' ? 'Menu' : 'Pay here' } }; });
  const out = await page.evaluate(async (specs) => {
    const res = {};
    for (const k of Object.keys(specs)) { const r = await LE.qr.check(specs[k]); const s = LE.qr.svg(specs[k]); res[k] = { ok: r.ok, decoded: r.decoded, ec: r.ec, notes: r.notes.map((n) => n.level + ':' + n.code), svg: s }; }
    const cv = await LE.qr.canvas(specs.transparent, 300);
    res.alpha = cv.getContext('2d').getImageData(2, 2, 1, 1).data[3];
    const fr = await LE.qr.canvas(specs['frame-label'], 400);
    res.frameSize = [fr.width, fr.height];
    return res;
  }, specs);
  Object.keys(specs).forEach((k) => h.assert(out[k].decoded === true && (out[k].ok || k === 'transparentLight'), k + ': ' + JSON.stringify(out[k].notes)));
  h.assert(/<linearGradient /.test(out.linear3.svg) && (out.linear3.svg.match(/<stop /g) || []).length === 3, 'three stops');
  h.assert(/<radialGradient /.test(out.radial.svg), 'radial gradient');
  h.assert.equal(out.alpha, 0, 'a transparent background stays transparent');
  h.assert(out.transparent.notes.indexOf('info:transparent') >= 0, 'transparent note');
  h.assert.equal(out.logo.ec, 'H');
  h.assert(/>Pay here<\/text>/.test(out['frame-badge'].svg) && />Menu<\/text>/.test(out['frame-tab'].svg), 'call to action text');
  h.assert(out.frameSize[1] > out.frameSize[0], 'a label frame is taller than wide');
};

cases['engine: SVG output is well-formed, has no script, and hostile input stays text'] = async ({ browser, base, h }) => {
  const page = await engine(browser, base, h);
  await page.addScriptTag({ url: base + '/assets/js/le-engine.js' });
  await page.addScriptTag({ url: base + '/assets/js/le-project.js' });
  const out = await page.evaluate(async (pic) => {
    const res = [];
    const hostile = { text: '"><script>alert(1)</script>', fg: '"/><script>x</script>', bg: 'url(javascript:1)', shape: 'dots"><script>', eye: { outer: '<svg onload=1>', inner: 'dot', outerColor: 'red;}' },
      image: { src: 'javascript:alert(1)' }, picture: { src: 'https://example.com/x.png' }, frame: { style: 'label', text: '</text><script>alert(2)</script> & "q"', color: 'expression(1)' }, onload: 'x', __proto__: { polluted: 1 } };
    const list = LE.qr.presets().map((p) => LE.qr.withStyle('https://example.com/?a=1&b=<2>', p.style)).concat([hostile, { text: 'plain', fg: '#17131f', bg: '#ffffff', ec: 'M' }, { text: 'pic', bg: '#ffffff', fg: '#111111', image: { src: pic }, picture: { src: pic }, frame: { style: 'tab', text: 'Scan <me>' } }]);
    for (const spec of list) {
      const s = LE.qr.svg(spec, { caption: 'Row <1> & co' });
      const d = new DOMParser().parseFromString(s, 'image/svg+xml');
      const bad = [...d.querySelectorAll('*')].filter((n) => /^(script|foreignobject|iframe|a|use)$/i.test(n.localName) || [...n.attributes].some((a) => /^on/i.test(a.name) || (/href$/i.test(a.name) && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(a.value)) || /javascript:|expression\(/i.test(a.value)));
      const clean = LE.project.sanitizeSvg(s);
      res.push({ parse: !d.querySelector('parsererror') && d.documentElement.localName === 'svg', bad: bad.length, script: /<script|javascript:|\son\w+=/i.test(s), kept: clean.length > s.length * 0.9, len: s.length });
    }
    const c = LE.qr.clean(hostile);
    return { list: res, clean: { c, polluted: ({}).polluted, text: new DOMParser().parseFromString(LE.qr.svg(hostile), 'image/svg+xml').querySelector('text').textContent } };
  }, await page.evaluate(PICTURE));
  out.list.forEach((r, i) => h.assert(r.parse && !r.bad && !r.script && r.kept, 'svg ' + i + ': ' + JSON.stringify(r)));
  const c = out.clean.c;
  h.assert(c.fg === '#17131f' && c.bg === '#ffffff' && c.shape === 'square' && c.eye.outer === 'square' && !c.eye.outerColor && !c.image && !c.picture && !c.frame.color && !('onload' in c), 'the spec is whitelisted: ' + JSON.stringify(c));
  h.assert.equal(out.clean.text, '</text><script>alert(2)</script>', 'frame text is escaped text, cut at 32 characters');
  h.assert.equal(out.clean.polluted, undefined);
};

/* The studio's QR renderer as it was before LE.qr (le-studio-tools.js, qrSvg), kept here to prove old entries are unchanged. */
const OLD_RENDERER = `(text, fg, bg, ec) => {
  var q = window.qrcode;
  if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
  var qr = q(0, ec || 'M');
  qr.addData(text || ' ', 'Byte');
  qr.make();
  var n = qr.getModuleCount(), m = 4, size = n + m * 2;
  var d = '';
  for (var r = 0; r < n; r++) {
    var run = -1;
    for (var col = 0; col <= n; col++) {
      var dark = col < n && qr.isDark(r, col);
      if (dark && run < 0) run = col;
      if (!dark && run >= 0) { d += 'M' + (run + m) + ' ' + (r + m) + 'h' + (col - run) + 'v1h-' + (col - run) + 'z'; run = -1; }
    }
  }
  var hex6 = (c) => String(c).toLowerCase().slice(0, 7);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' + (bg ? '<rect width="' + size + '" height="' + size + '" fill="' + hex6(bg) + '"/>' : '') + '<path d="' + d + '" fill="' + hex6(fg) + '"/></svg>';
}`;
cases['old studio QR entries are drawn exactly as before (markup and pixels)'] = async ({ browser, base, h }) => {
  const page = await engine(browser, base, h);
  const out = await page.evaluate(async (src) => {
    const old = (0, eval)('(' + src + ')');
    const entries = [{ text: 'https://', fg: '#17131f', bg: '#ffffff', ec: 'M' }, { text: 'https://example.com/a-long-path?with=query&and=more', fg: '#0b3d91', bg: null, ec: 'H' }, { text: 'Grüße 你好', fg: '#7C2D12', bg: '#FFF7ED', ec: 'Q' }, { text: '', fg: '#000000', bg: '#ffffff', ec: 'L' }];
    const px = async (svg) => { const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg width="435" height="435" ')); await img.decode(); const c = document.createElement('canvas'); c.width = c.height = 435; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, 435, 435).data; };
    const res = [];
    for (const e of entries) {
      const a = old(e.text, e.fg, e.bg, e.ec), b = LE.qr.svg(e);
      const pa = await px(a), pb = await px(b);
      let diff = 0;
      for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) diff++;
      res.push({ same: a === b, diff, plain: LE.qr.isPlain(e), styled: LE.qr.svg(Object.assign({ shape: 'square' }, e)) !== b });
    }
    return res;
  }, OLD_RENDERER);
  out.forEach((r, i) => h.assert(r.same && r.diff === 0 && r.plain && r.styled, 'entry ' + i + ': ' + JSON.stringify(r)));
};

module.exports = cases;
