/* Quick maker: photobooth strips (2.10). A classic strip of four or three frames (2 × 6 in), a 2 × 2 print (4 × 6 in) or
   a wide strip (6 × 2 in), from picked photos or from the camera (countdown, flash, retake a frame). Every frame is a
   photo slot; the look is data on the photo layers (LE.presets filter names), never baked. "Two on a sheet" adds a
   4 × 6 in print page with two copies and a cut line. The camera stream lives only while its panel is open and is
   stopped the moment the panel or the maker closes. Frames are saved the right way round unless "Mirror" is on. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var MK = LE.makers;

  var IN = 300; /* px per inch: print sizes at 300 dpi */
  function pm(paper, wIn, hIn) { return { v: 1, paper: paper, w: Math.round(wIn * 25.4 * 100) / 100, h: Math.round(hIn * 25.4 * 100) / 100, dpi: 300 }; }
  var SIZES = [
    { id: 'four', name: 'Strip of 4', w: 2 * IN, h: 6 * IN, print: pm('strip-2x6', 2, 6), frames: 4 },
    { id: 'three', name: 'Strip of 3', w: 2 * IN, h: 6 * IN, print: pm('strip-2x6', 2, 6), frames: 3 },
    { id: 'grid', name: '2 × 2', w: 4 * IN, h: 6 * IN, print: pm('photo-4x6', 4, 6), frames: 4 },
    { id: 'wide', name: 'Wide', w: 6 * IN, h: 2 * IN, print: pm('strip-6x2', 6, 2), frames: 4 }
  ];
  function framesFor(sizeId) { for (var i = 0; i < SIZES.length; i++) if (SIZES[i].id === sizeId) return SIZES[i].frames; return 4; }
  var LOOKS = [
    { id: 'natural', name: 'Natural' }, { id: 'mono', name: 'Black and white' }, { id: 'noir', name: 'High contrast black and white' },
    { id: 'warm', name: 'Warm' }, { id: 'film', name: 'Film' }, { id: 'vintage', name: 'Vintage' }, { id: 'fade', name: 'Faded' }
  ];
  var STYLE = {
    classic: { bg: '#FFFFFF', ink: '#1B1B1D', sub: '#5C5C63', capFont: 'Fraunces', capWeight: 700, capItalic: true, dateFont: 'Space Mono', radius: 0, border: null },
    black: { bg: '#121212', ink: '#F4F4F2', sub: '#A9A9A6', capFont: 'Bebas Neue', capWeight: 400, upper: true, dateFont: 'Space Mono', radius: 0, border: null },
    pastel: { bg: '#F8DCE3', ink: '#5B2638', sub: '#7C4558', capFont: 'Caveat', capWeight: 700, dateFont: 'DM Sans', radius: 0.035, border: '#FFFFFF' },
    film: { bg: '#161412', ink: '#F2EDE4', sub: '#E9A35B', capFont: 'Space Mono', capWeight: 700, upper: true, dateFont: 'Space Mono', radius: 0.012, border: null, film: true }
  };

  MK.photoboothFrames = framesFor;

  MK.register({
    id: 'photobooth',
    name: 'Photobooth strip',
    category: 'Photo',
    summary: 'A strip of three or four frames, a 2 × 2 print or a wide strip, from your camera or your photos.',
    keywords: ['photobooth', 'photo booth', 'strip', 'photo strip', 'booth', 'camera', 'selfie', 'party', 'wedding', 'print', '2x6', '4x6', 'frames', 'countdown'],
    sizes: SIZES.map(function (s) { return { id: s.id, name: s.name, w: s.w, h: s.h, print: s.print }; }),
    maxPages: 2,
    inputs: [
      { key: 'photos', label: 'Photos', type: 'photos', max: 4, hint: 'Take them with the camera above, or pick up to four. Frames fill in order.' },
      { key: 'caption', label: 'Caption', type: 'text', max: 40, placeholder: 'Saturday night' },
      { key: 'dateLine', label: 'Date line', type: 'toggle', default: true, hint: 'Show the date under the caption' },
      { key: 'date', label: 'Date', type: 'date', today: true, hint: 'Today when left empty' },
      { key: 'look', label: 'Look on every frame', type: 'choice', options: LOOKS, default: 'natural' },
      { key: 'mirror', label: 'Mirror', type: 'toggle', default: false, hint: 'Flip the frames like a mirror' },
      { key: 'sheet', label: 'Print sheet', type: 'toggle', default: false, hint: 'Add a 4 × 6 in page with two copies and a cut line' }
    ],
    styles: [
      { id: 'classic', name: 'Classic white' },
      { id: 'black', name: 'Black' },
      { id: 'pastel', name: 'Pastel' },
      { id: 'film', name: 'Film edge' }
    ],
    sample: { values: { photos: ['sample:people-08', 'sample:people-07', 'sample:people-06', 'sample:people-01'], caption: 'Saturday night', dateLine: true, date: '2026-11-07', look: 'natural', mirror: false, sheet: false } },
    ui: ui,
    build: build
  });

  function build(v, env) {
    var C = env.color, sid = env.size.id, n = framesFor(sid);
    var S = STYLE[env.style] || STYLE.classic;
    var photos = (v.photos || []).slice(0, n);
    var look = v.look && v.look !== 'natural' && (!LE.presets || !LE.presets.filters || LE.presets.filters[v.look]) ? { name: v.look, intensity: 100 } : null;
    var dateText = v.dateLine === false ? '' : env.date.format(v.date || env.today, S.film ? 'DD.MM.YYYY' : 'D MMMM YYYY');
    var ink = C.ensure(S.ink, S.bg, 4.6), sub = C.ensure(S.sub, S.bg, 4.6);

    /* One strip (or print) in the box { x, y, w, h }. ids are made unique by env, so a sheet can hold two copies. */
    function strip(ox, oy, W, H, copy) {
      var L = [];
      var tag = copy ? ' (copy ' + copy + ')' : '';
      var wide = sid === 'wide', grid = sid === 'grid';
      var m = Math.round((wide ? 0.07 * H : 0.075 * W)), g = Math.round(wide ? 0.04 * H : grid ? 0.025 * W : 0.045 * W);
      var cells = [], footer;
      if (S.film) m = Math.round(wide ? 0.13 * H : grid ? 0.085 * W : 0.13 * W);
      if (wide) {
        var panel = Math.round(0.19 * W);
        var fh = H - 2 * m, fw = (W - 2 * m - panel - (n - 1) * g) / n;
        for (var i = 0; i < n; i++) cells.push({ x: ox + m + i * (fw + g), y: oy + m, w: fw, h: fh });
        footer = { x: ox + W - m - panel + g, y: oy + m, w: panel - g, h: fh };
      } else if (grid) {
        var gw = (W - 2 * m - g) / 2, gh = gw * 1.25;
        for (var k = 0; k < 4; k++) cells.push({ x: ox + m + (k % 2) * (gw + g), y: oy + m + Math.floor(k / 2) * (gh + g), w: gw, h: gh });
        var fy = oy + m + 2 * gh + g;
        footer = { x: ox + m, y: fy, w: W - 2 * m, h: oy + H - m - fy };
      } else {
        var fw2 = W - 2 * m, minFoot = Math.round(0.24 * W);
        var fh2 = Math.min(fw2 / (n === 3 ? 1.08 : 1.3), (H - 2 * m - minFoot - (n - 1) * g) / n);
        for (var j = 0; j < n; j++) cells.push({ x: ox + m, y: oy + m + j * (fh2 + g), w: fw2, h: fh2 });
        var fy2 = oy + m + n * fh2 + (n - 1) * g;
        footer = { x: ox + m, y: fy2, w: fw2, h: oy + H - m * (S.film ? 0.6 : 0.5) - fy2 };
      }
      if (S.film) L = L.concat(filmEdge(ox, oy, W, H, wide, m, copy));
      cells.forEach(function (cl, ci) {
        var r = S.radius ? Math.round(S.radius * Math.min(cl.w, cl.h) * 3) : 0;
        if (S.border) L.push(env.rect({ id: 'mat', name: 'Frame mat ' + (ci + 1) + tag, x: cl.x - 0.012 * W, y: cl.y - 0.012 * W, w: cl.w + 0.024 * W, h: cl.h + 0.024 * W, radius: r + 0.012 * W, fill: S.border }));
        var ph = env.photo({ id: 'frame', name: 'Frame ' + (ci + 1) + tag, src: photos[ci], x: cl.x, y: cl.y, w: cl.w, h: cl.h, radius: r, label: 'Photo ' + (ci + 1), slot: 'frame' + (ci + 1), filter: look, focus: { x: 0.5, y: 0.42 } });
        if (v.mirror) ph.flipX = true;
        L.push(ph);
      });
      L = L.concat(words(footer, wide, copy));
      return L;
    }
    function words(box, wide, copy) {
      var out = [], tag = copy ? ' (copy ' + copy + ')' : '';
      var cap = v.caption || '';
      var unit = wide ? box.h : box.w;
      var bits = [];
      if (cap) bits.push(env.text({ id: 'caption', name: 'Caption' + tag, text: cap, x: box.x, y: box.y, w: box.w, font: S.capFont, weight: S.capWeight, italic: !!S.capItalic, uppercase: !!S.upper,
        size: Math.round((wide ? 0.2 : sid === 'grid' ? 0.085 : 0.13) * unit * (S.capFont === 'Caveat' ? 1.25 : S.upper ? 1.15 : 1)), min: Math.round(0.05 * unit), maxLines: wide ? 3 : 2, lineHeight: 1.05, align: 'center', balance: true, tracking: S.upper ? 0.04 : 0, color: ink }));
      if (dateText) {
        var dt = env.text({ id: 'date', name: 'Date' + tag, text: dateText, x: box.x, y: 0, w: box.w, font: S.dateFont, weight: 400, uppercase: S.dateFont !== 'Space Mono',
          size: Math.round((wide ? 0.075 : sid === 'grid' ? 0.03 : 0.05) * unit), min: Math.round(0.025 * unit), maxLines: 1, align: 'center', tracking: 0.12, color: sub });
        dt.y = bits.length ? bits[0].y + bits[0].h + Math.round(0.02 * unit) : box.y;
        bits.push(dt);
      }
      if (!bits.length) return out;
      env.place(bits, box, 'middle');
      return out.concat(bits);
    }
    /* Film edge: sprocket holes down both long sides and frame numbers, as one graphic per side. */
    function filmEdge(ox, oy, W, H, wide, m, copy) {
      var out = [], hole = '#2C2824', num = '#E9A35B';
      var long = wide ? W : H, band = m;
      var pitch = Math.round(band * 0.62), hw = Math.round(band * 0.34), hh = Math.round(band * 0.42);
      var count = Math.floor(long / pitch);
      var off = (long - count * pitch) / 2 + (pitch - hw) / 2;
      var d = '';
      for (var i = 0; i < count; i++) {
        var a = Math.round(off + i * pitch);
        d += wide ? '<rect x="' + a + '" y="' + Math.round((band - hh) * 0.35) + '" width="' + hw + '" height="' + hh + '" rx="' + Math.round(hw * 0.22) + '"/>'
          : '<rect x="' + Math.round((band - hh) * 0.35) + '" y="' + a + '" width="' + hh + '" height="' + hw + '" rx="' + Math.round(hw * 0.22) + '"/>';
      }
      var vb = wide ? '0 0 ' + long + ' ' + band : '0 0 ' + band + ' ' + long;
      var mk = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" fill="' + hole + '">' + d + '</svg>';
      var tag = copy ? ' (copy ' + copy + ')' : '';
      if (wide) {
        out.push(env.svg({ id: 'sprockets', name: 'Sprocket holes top' + tag, markup: mk, x: ox, y: oy, w: long, h: band }));
        out.push(env.svg({ id: 'sprockets', name: 'Sprocket holes bottom' + tag, markup: mk, x: ox, y: oy + H - band, w: long, h: band, rotation: 180 }));
      } else {
        out.push(env.svg({ id: 'sprockets', name: 'Sprocket holes left' + tag, markup: mk, x: ox, y: oy, w: band, h: long }));
        out.push(env.svg({ id: 'sprockets', name: 'Sprocket holes right' + tag, markup: mk, x: ox + W - band, y: oy, w: band, h: long, rotation: 180 }));
      }
      /* Edge numbers in the band, between the holes, like markings printed on film stock. */
      var fs = Math.round(band * 0.2);
      for (var f = 0; f < framesFor(sid); f++) {
        var label = (f * 2 + 12) + '  ▸  ' + (f * 2 + 12) + 'A';
        var t = env.text({ id: 'edge-number', name: 'Edge number ' + (f + 1) + tag, text: label, x: 0, y: 0, w: Math.round(band * 4), font: 'Space Mono', weight: 700, size: fs, min: fs, maxLines: 1, color: num, opacity: 0.85 });
        if (wide) { t.x = Math.round(ox + band + f * (W - 2 * band) / framesFor(sid) + band * 0.4); t.y = Math.round(oy + H - band + (band * 0.86 - t.h)); }
        else { t.rotation = 90; t.x = Math.round(ox + W - band * 0.2 - t.w / 2 - t.h / 2); t.y = Math.round(oy + band + f * (H - 2.8 * band) / framesFor(sid) + band * 0.5 + t.w / 2 - t.h / 2); }
        out.push(t);
      }
      return out;
    }

    var W = env.W, H = env.H;
    var page = env.page(S.bg);
    page.layers = strip(0, 0, W, H, 0);
    var pages = [page];
    if (v.sheet) {
      if (sid === 'grid') env.warn('input', 'This layout already fills a 4 × 6 in print, so no extra sheet is added.', 'sheet');
      else {
        /* Two copies on a 4 × 6 in print (6 × 4 in for wide strips), with a dashed cut line between them. */
        var wide = sid === 'wide';
        var SW = wide ? 6 * IN : 4 * IN, SH = wide ? 4 * IN : 6 * IN;
        var sheet = env.page(S.bg, { w: SW, h: SH, print: wide ? pm('photo-6x4', 6, 4) : pm('photo-4x6', 4, 6) });
        var L = [];
        if (wide) { L = L.concat(strip(0, 0, W, H, 1), strip(0, H, W, H, 2)); }
        else { L = L.concat(strip(0, 0, W, H, 1), strip(W, 0, W, H, 2)); }
        var cut = C.contrast('#000000', S.bg) > C.contrast('#FFFFFF', S.bg) ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)';
        var guides = wide ? env.line({ id: 'cut', name: 'Cut line', x: 0, y: H - 1, w: SW, width: 2, color: cut, dash: [14, 10] })
          : env.line({ id: 'cut', name: 'Cut line', x: W - SH / 2, y: SH / 2 - 1, w: SH, width: 2, color: cut, dash: [14, 10], rotation: 90 });
        L = L.concat(env.print.group('Cut marks', [guides], 'cut-marks'));
        sheet.layers = L;
        pages.push(sheet);
      }
    }
    return { name: 'Photobooth — ' + (v.caption || 'strip'), pages: pages };
  }

  /* ---------- Camera, in the studio form ---------- */
  function svgIcon(d) { return '<svg class="sx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
  var ICON_CAM = '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>';
  var ICON_SWITCH = '<path d="M4 9h13l-3-3M20 15H7l3 3"/>';
  var ICON_X = '<path d="M6 6l12 12M18 6L6 18"/>';
  function stopStream(st) { if (st) try { st.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }

  function ui(F, api) {
    var c = F.c;
    if (!c || !F.node) return null;
    loadCss('photobooth');
    var host = F.node.querySelector('.mk-body');
    var bar = document.createElement('div');
    bar.className = 'mkp-bar';
    var can = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    bar.innerHTML = '<button type="button" class="btn btn-primary mkp-open">' + svgIcon(ICON_CAM) + '<span>Use the camera</span></button>' +
      '<p class="mkp-note" role="status">' + (can ? 'Countdown, flash, and you can retake any frame. Or pick photos below.' : 'This browser cannot use a camera here. Pick photos below instead.') + '</p>';
    host.insertBefore(bar, F.form);
    var openBtn = bar.querySelector('.mkp-open'), note = bar.querySelector('.mkp-note');
    if (!can) openBtn.disabled = true;
    var cam = null;
    openBtn.onclick = function () { cam = openCamera(F, api, note, function () { cam = null; openBtn.focus(); }); };
    return function () { if (cam) cam.close(); };
  }

  function openCamera(F, api, note, onClose) {
    var c = F.c, n = framesFor(F.size);
    var ov = document.createElement('div');
    ov.className = 'mkp-cam';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Camera');
    ov.innerHTML = '<div class="mkp-head"><b class="mkp-count" aria-live="polite">Frame 1 of ' + n + '</b>' +
      '<button type="button" class="sx-iconbtn mkp-flipcam" aria-label="Switch camera" hidden>' + svgIcon(ICON_SWITCH) + '</button>' +
      '<button type="button" class="sx-iconbtn mkp-x" aria-label="Close the camera">' + svgIcon(ICON_X) + '</button></div>' +
      '<div class="mkp-view"><video class="mkp-video" playsinline muted autoplay></video><span class="mkp-num" aria-hidden="true"></span><span class="mkp-flash" aria-hidden="true"></span>' +
      '<p class="mkp-msg" hidden></p></div>' +
      '<div class="mkp-thumbs" role="group" aria-label="Frames taken"></div>' +
      '<div class="mkp-actions"><label class="mk-toggle mkp-mirror"><input type="checkbox"><span>Save mirrored</span></label>' +
      '<button type="button" class="btn btn-primary mkp-shoot">Start</button><button type="button" class="btn mkp-done" disabled>Use these</button></div>';
    F.node.querySelector('.mk-card-sheet').appendChild(ov);
    var video = ov.querySelector('video'), numEl = ov.querySelector('.mkp-num'), flash = ov.querySelector('.mkp-flash'), msg = ov.querySelector('.mkp-msg');
    var shoot = ov.querySelector('.mkp-shoot'), done = ov.querySelector('.mkp-done'), thumbs = ov.querySelector('.mkp-thumbs'), countEl = ov.querySelector('.mkp-count');
    var mirrorBox = ov.querySelector('.mkp-mirror input'), switchBtn = ov.querySelector('.mkp-flipcam');
    var S = { stream: null, facing: 'user', shots: [], target: -1, timer: 0, busy: false, closed: false };
    function setCount() {
      var next = S.target >= 0 ? S.target : S.shots.filter(Boolean).length;
      countEl.textContent = S.shots.filter(Boolean).length >= n && S.target < 0 ? 'All ' + n + ' frames taken' : 'Frame ' + Math.min(n, next + 1) + ' of ' + n;
      done.disabled = !S.shots.filter(Boolean).length;
      shoot.textContent = S.target >= 0 ? 'Retake frame ' + (S.target + 1) : S.shots.filter(Boolean).length >= n ? 'Take them again' : S.shots.length ? 'Next frame' : 'Start';
    }
    function drawThumbs() {
      thumbs.innerHTML = '';
      for (var i = 0; i < n; i++) (function (i) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'mkp-thumb' + (S.target === i ? ' is-on' : '');
        b.setAttribute('aria-label', S.shots[i] ? 'Retake frame ' + (i + 1) : 'Frame ' + (i + 1) + ', not taken yet');
        b.setAttribute('aria-pressed', String(S.target === i));
        if (S.shots[i]) { var t = document.createElement('canvas'); t.width = 120; t.height = Math.round(120 * S.shots[i].height / S.shots[i].width); t.getContext('2d').drawImage(S.shots[i], 0, 0, t.width, t.height); b.appendChild(t); }
        else b.textContent = String(i + 1);
        b.onclick = function () { if (!S.shots[i]) return; S.target = S.target === i ? -1 : i; drawThumbs(); setCount(); };
        thumbs.appendChild(b);
      })(i);
    }
    function fail(err) {
      var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      var text = denied ? 'Camera access was not allowed. You can pick photos below instead.' : 'No camera was found or it could not start. You can pick photos below instead.';
      note.textContent = text;
      close();
      if (c.toast) c.toast(text);
    }
    function start() {
      stopStream(S.stream); S.stream = null;
      var want = { video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false };
      return navigator.mediaDevices.getUserMedia(want).then(function (st) {
        if (S.closed) { stopStream(st); return; }
        S.stream = st;
        video.srcObject = st;
        var s = st.getVideoTracks()[0] && st.getVideoTracks()[0].getSettings ? st.getVideoTracks()[0].getSettings() : {};
        var front = s.facingMode ? s.facingMode === 'user' : S.facing === 'user';
        /* Front cameras preview like a mirror; frames are saved the right way round unless "Save mirrored" is on. */
        video.classList.toggle('is-mirror', front);
        if (navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices().then(function (ds) {
          switchBtn.hidden = ds.filter(function (d) { return d.kind === 'videoinput'; }).length < 2;
        }).catch(function () {});
        return video.play && video.play().catch(function () {});
      }).catch(fail);
    }
    function grab() {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      var cv = document.createElement('canvas');
      cv.width = vw; cv.height = vh;
      var g = cv.getContext('2d');
      if (mirrorBox.checked) { g.translate(vw, 0); g.scale(-1, 1); }
      g.drawImage(video, 0, 0, vw, vh);
      return cv;
    }
    function countdown(k, then) {
      if (S.closed) return;
      if (k === 0) { numEl.textContent = ''; then(); return; }
      numEl.textContent = String(k);
      numEl.classList.remove('is-pop'); void numEl.offsetWidth; numEl.classList.add('is-pop');
      S.timer = setTimeout(function () { countdown(k - 1, then); }, 800);
    }
    function takeOne(i, chain) {
      countdown(3, function () {
        var cv = grab();
        flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on');
        if (cv) { if (S.shots[i]) S.shots[i].width = 0; S.shots[i] = cv; }
        drawThumbs(); setCount();
        if (chain && i + 1 < n && !S.closed) S.timer = setTimeout(function () { takeOne(i + 1, true); }, 900);
        else { S.busy = false; shoot.disabled = false; S.target = -1; drawThumbs(); setCount(); }
      });
    }
    shoot.onclick = function () {
      if (S.busy || !S.stream) return;
      S.busy = true; shoot.disabled = true;
      if (S.target >= 0) { takeOne(S.target, false); return; }
      var have = S.shots.filter(Boolean).length;
      if (have >= n) { S.shots.forEach(function (cv) { if (cv) cv.width = 0; }); S.shots = []; have = 0; drawThumbs(); }
      takeOne(have, true);
    };
    done.onclick = function () {
      var list = S.shots.filter(Boolean);
      if (!list.length) return;
      done.disabled = true; done.textContent = 'Adding…';
      var ids = [], chain = Promise.resolve();
      list.forEach(function (cv, i) {
        chain = chain.then(function () {
          return new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.92); }).then(function (blob) {
            if (!blob) return null;
            return c.ingest(new File([blob], 'booth-' + (i + 1) + '.jpg', { type: 'image/jpeg' })).then(function (meta) { ids.push(meta.id); });
          });
        });
      });
      chain.then(function () {
        close();
        if (!ids.length) return;
        F.values.photos = ids.slice(0, 4);
        if (mirrorBox.checked) F.values.mirror = false;
        api.refresh();
      }).catch(function (err) { done.disabled = false; done.textContent = 'Use these'; if (c.toast) c.toast((err && err.message) || 'Could not add those frames.'); });
    };
    switchBtn.onclick = function () { S.facing = S.facing === 'user' ? 'environment' : 'user'; start(); };
    function close() {
      if (S.closed) return;
      S.closed = true;
      clearTimeout(S.timer);
      stopStream(S.stream); S.stream = null;
      try { video.pause(); video.srcObject = null; } catch (e) {}
      S.shots.forEach(function (cv) { if (cv) cv.width = 0; });
      S.shots = [];
      document.removeEventListener('visibilitychange', onHide);
      ov.remove();
      onClose();
    }
    function onHide() { if (document.hidden) close(); }
    document.addEventListener('visibilitychange', onHide);
    ov.querySelector('.mkp-x').onclick = close;
    ov.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    drawThumbs(); setCount();
    start();
    requestAnimationFrame(function () { shoot.focus({ preventScroll: true }); });
    return { close: close, state: S };
  }
  function loadCss(id) {
    if (document.querySelector('link[data-mk-css="' + id + '"]')) return;
    var root = document.documentElement.getAttribute('data-root') || '';
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = root + 'assets/css/makers-' + id + '.css'; l.setAttribute('data-mk-css', id);
    document.head.appendChild(l);
  }
})();
