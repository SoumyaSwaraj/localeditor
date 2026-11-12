/* Depth lab: photo -> depth map (LE.maps.depth) -> three WebGL2 demos that need nothing but the depth and the photo. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var photoCanvas = null, srcImage = null, depthRaw = null, depthRef = null, depthColor = false, normCanvas = null, GL = {}, abortCtl = null;
  var MAXW = 1024;

  /* ---------- pool picker, models ---------- */
  var POOL = ['people-07', 'people-08', 'people-06', 'people-01', 'street-02', 'travel-05', 'garden-02', 'garden-03', 'books-02', 'still-02', 'arch-01', 'street-03', 'travel-03', 'nature-01', 'sky-03', 'still-01', 'travel-06', 'garden-05'];
  POOL.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; $('pool').appendChild(o); });
  LE.maps.models().filter(function (m) { return m.kind === 'depth'; }).forEach(function (m) {
    var o = document.createElement('option'); o.value = m.id; o.textContent = m.label + (m.tier === 'standard' ? '' : ' [' + m.tier + ']') + ' (' + m.downloadMB + ' MB)'; $('model').appendChild(o);
  });
  function status(t) { $('status').textContent = t; }

  function loadImage(src) {
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('Could not open that image')); }; i.src = src; });
  }
  async function setPhoto(img, name) {
    srcImage = img; depthRaw = null; depthRef = null;
    var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAXW / Math.max(w, h));
    photoCanvas = document.createElement('canvas'); photoCanvas.width = Math.round(w * k); photoCanvas.height = Math.round(h * k);
    photoCanvas.getContext('2d').drawImage(img, 0, 0, photoCanvas.width, photoCanvas.height);
    $('srcinfo').textContent = (name || 'Photo') + ': ' + w + ' x ' + h + ' px (demos use ' + photoCanvas.width + ' x ' + photoCanvas.height + ')';
    $('go').disabled = false; ['maps', 'demoBlur', 'demoLight', 'demoFog'].forEach(function (i) { $(i).hidden = true; });
    window.__depthDone = false;
  }
  $('file').addEventListener('change', async function (e) { var f = e.target.files[0]; if (!f) return; var u = URL.createObjectURL(f); await setPhoto(await loadImage(u), f.name); });
  $('pool').addEventListener('change', async function () { await setPhoto(await loadImage('../../assets/photos/collage/' + $('pool').value + '.jpg'), $('pool').value); });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', async function (e) { var f = e.dataTransfer.files[0]; if (f) await setPhoto(await loadImage(URL.createObjectURL(f)), f.name); });

  /* ---------- run ---------- */
  $('go').addEventListener('click', async function () {
    if (!srcImage) return;
    abortCtl = new AbortController(); window.__depthError = null; window.__depthDone = false;
    $('go').disabled = true; $('cancel').classList.remove('hidden'); $('bar').classList.remove('hidden'); $('bar').value = 0;
    try {
      var r = await LE.maps.gate('depth', { run: function () {
        return LE.maps.depth(srcImage, { model: $('model').value, maxSide: +$('side').value, refine: $('refine').checked, signal: abortCtl.signal,
          onProgress: function (p) { $('bar').value = p.fraction || 0; status(p.stage === 'download' ? 'Downloading the depth model (one time)...' : p.stage === 'starting' ? 'Starting the engine...' : 'Working out the depth...'); } });
      } });
      if (!r) { status('Cancelled.'); return; }
      depthRaw = r; depthRef = r.refined ? r : null;
      window.__depthResult = { width: r.width, height: r.height, min: Math.min.apply(null, r.depth.slice(0, 1)), timings: r.timings, model: r.model };
      showMaps(); window.__depthDone = true;
      var t = r.timings; status('Done: ' + r.width + ' x ' + r.height + ' depth, ' + Math.round(t.inferMs) + ' ms inference, ' + Math.round(t.wallMs) + ' ms total.');
      var tb = $('timings'); tb.classList.remove('hidden');
      tb.innerHTML = '<tr><th>Model</th><td>' + r.model + '</td><th>Start (read + session)</th><td>' + Math.round(t.startMs) + ' ms</td><th>Inference</th><td>' + Math.round(t.inferMs) + ' ms</td><th>Refine</th><td>' + (t.refineMs ? Math.round(t.refineMs) + ' ms' : 'off') + '</td></tr>';
    } catch (e) {
      window.__depthError = e.message || String(e); status(e.code === 'cancelled' ? 'Cancelled.' : 'Could not make the depth map: ' + (e.message || e));
    } finally { $('go').disabled = false; $('cancel').classList.add('hidden'); $('bar').classList.add('hidden'); }
  });
  $('cancel').addEventListener('click', function () { if (abortCtl) abortCtl.abort(); });

  /* ---------- the maps panel ---------- */
  function drawDepth() {
    var c = $('cDepth'), r = depthRaw, w = r.width, h = r.height; c.width = w; c.height = h;
    var x = c.getContext('2d'), img = x.createImageData(w, h);
    for (var i = 0; i < w * h; i++) {
      var v = r.depth[i], j = i * 4;
      if (depthColor) { var t = v; img.data[j] = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)))); img.data[j + 1] = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)))); img.data[j + 2] = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)))); }
      else img.data[j] = img.data[j + 1] = img.data[j + 2] = Math.round(v * 255);
      img.data[j + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }
  var normTimer = 0;
  function updateNormals() {
    if (!depthRaw) return;
    var d = depthRef || depthRaw;
    normCanvas = LE.maps.normals(d, { strength: +$('nStrength').value, smooth: +$('nSmooth').value });
    var c = $('cNormals'); c.width = normCanvas.width; c.height = normCanvas.height; c.getContext('2d').drawImage(normCanvas, 0, 0);
    if (GL.light) GL.light.setNormals(normCanvas);
    redrawAll();
  }
  function showMaps() {
    ['maps', 'demoBlur', 'demoLight', 'demoFog'].forEach(function (i) { $(i).hidden = false; });
    var c = $('cPhoto'); c.width = photoCanvas.width; c.height = photoCanvas.height; c.getContext('2d').drawImage(photoCanvas, 0, 0);
    drawDepth(); initGL(); updateNormals();
    $('bRefined').checked = !!depthRef; $('fRefined').checked = !!depthRef;
  }
  $('colormap').addEventListener('change', function () { depthColor = this.checked; if (depthRaw) drawDepth(); });
  ['nStrength', 'nSmooth'].forEach(function (id) { $(id).addEventListener('input', function () { clearTimeout(normTimer); normTimer = setTimeout(updateNormals, 60); }); });

  /* ---------- WebGL2 plumbing ---------- */
  var VS = '#version 300 es\nout vec2 v; void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); v = vec2(p.x, 1.0-p.y); gl_Position = vec4(p*2.0-1.0, 0, 1); }';
  var HEAD = '#version 300 es\nprecision highp float; in vec2 v; out vec4 o;\nuniform sampler2D uPhoto, uDepth, uNorm; uniform vec2 uPx; uniform float uAspect;\n' +
    'vec3 lin(vec3 c){ return pow(c, vec3(2.2)); } vec3 enc(vec3 c){ return pow(max(c,0.0), vec3(1.0/2.2)); }\n' +
    'float D(vec2 p){ return texture(uDepth, p).r; }\n';
  var FS_BLUR = HEAD + 'uniform float uFocus, uMaxR, uRange, uShow; \n' +
    'float coc(float d){ float e = max(abs(d - uFocus) - uRange, 0.0); return clamp(e * 3.0, 0.0, 1.0) * uMaxR; }\n' +
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\n' +
    'void main(){ float dc = D(v); float c0 = coc(dc); vec3 col = lin(texture(uPhoto, v).rgb); float wsum = 1.0; vec3 acc = col;\n' +
    ' if (uShow > 0.5) { o = vec4(vec3(c0 / max(uMaxR, 0.001)), 1); return; }\n' +
    ' float rot = hash(gl_FragCoord.xy) * 6.2831;\n' +
    ' for (int i = 0; i < 72; i++) { float f = (float(i) + 0.5) / 72.0; float r = sqrt(f); float a = float(i) * 2.39996 + rot; vec2 off = r * vec2(cos(a), sin(a)) * uMaxR; vec2 s = v + off * uPx;\n' +
    '   float ds = D(s); float cs = coc(ds); float dist = r * uMaxR;\n' +
    '   /* a sample behind the centre can only reach it through the centre\'s own blur disc; a sample in front reaches it through its own */\n' +
    '   float w = (ds < dc - 0.01) ? clamp(c0 - dist + 1.0, 0.0, 1.0) : clamp(cs - dist + 1.0, 0.0, 1.0);\n' +
    '   acc += lin(texture(uPhoto, s).rgb) * w; wsum += w; }\n' +
    ' o = vec4(enc(acc / wsum), 1); }';
  var FS_LIGHT = HEAD + 'uniform vec3 uLight; uniform float uGain, uAmb, uRim; uniform int uView;\n' +
    'void main(){ vec3 base = lin(texture(uPhoto, v).rgb); vec3 n = texture(uNorm, v).rgb * 2.0 - 1.0; n = normalize(n); float d = D(v);\n' +
    ' vec3 P = vec3(v.x * uAspect, 1.0 - v.y, d * 0.45); vec3 Lp = vec3(uLight.x * uAspect, 1.0 - uLight.y, uLight.z);\n' +
    ' vec3 L = normalize(Lp - P); float lam = max(dot(n, L), 0.0);\n' +
    ' /* distance falloff, soft */ float fall = 1.0 / (1.0 + 0.9 * length(Lp - P) * length(Lp - P));\n' +
    ' vec2 toL = normalize((Lp - P).xy + 1e-4); float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 1.6) * clamp(dot(normalize(n.xy + 1e-4), toL) * 0.5 + 0.5, 0.0, 1.0);\n' +
    ' float shade = uAmb + uGain * 2.2 * lam * fall; vec3 lit = base * shade + vec3(1.0, 0.95, 0.85) * rim * uRim * 0.8 * fall * 2.0;\n' +
    ' if (uView == 1) { o = vec4(enc(vec3(shade + rim * uRim * 0.8) * 0.5), 1); return; } if (uView == 2) { o = vec4(n * 0.5 + 0.5, 1); return; }\n' +
    ' o = vec4(enc(lit), 1); }';
  var FS_FOG = HEAD + 'uniform float uDens, uStart, uBright;\n' +
    'void main(){ vec3 c = lin(texture(uPhoto, v).rgb); float far = 1.0 - D(v); float t = max(far - uStart, 0.0); float f = 1.0 - exp(-uDens * 3.0 * t);\n' +
    ' vec3 fog = vec3(uBright) * vec3(0.92, 0.96, 1.0); o = vec4(enc(mix(c, fog, clamp(f, 0.0, 1.0))), 1); }';

  function mkProgram(gl, fs) {
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function uploadDepth(gl, unit, tex, d) {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, d.width, d.height, 0, gl.RED, gl.FLOAT, d.depth);
  }
  function mkDemo(canvasId, fs, unifs) {
    var c = $(canvasId); c.width = photoCanvas.width; c.height = photoCanvas.height;
    var gl = c.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    gl.getExtension('EXT_color_buffer_float'); gl.getExtension('OES_texture_float_linear');
    var prog = mkProgram(gl, fs), demo = { gl: gl, canvas: c, prog: prog, hold: false };
    demo.photo = (function () { var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, photoCanvas); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; })();
    demo.depthTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, demo.depthTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    demo.normTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, demo.normTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    demo.setDepth = function (d) { uploadDepth(gl, 1, demo.depthTex, d); };
    demo.setNormals = function (cv) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, demo.normTex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); };
    demo.draw = function () {
      gl.viewport(0, 0, c.width, c.height); gl.useProgram(prog);
      gl.uniform1i(gl.getUniformLocation(prog, 'uPhoto'), 0); gl.uniform1i(gl.getUniformLocation(prog, 'uDepth'), 1); gl.uniform1i(gl.getUniformLocation(prog, 'uNorm'), 2);
      gl.uniform2f(gl.getUniformLocation(prog, 'uPx'), 1 / c.width, 1 / c.height); gl.uniform1f(gl.getUniformLocation(prog, 'uAspect'), c.width / c.height);
      unifs(gl, prog, demo);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    return demo;
  }
  function u1(gl, p, n, v) { gl.uniform1f(gl.getUniformLocation(p, n), v); }

  function pickDepth(refinedBox) { return (refinedBox.checked && depthRef) ? depthRef : depthRaw; }
  async function ensureRefined() {
    if (depthRef || !depthRaw) return;
    status('Refining edges with the photo...');
    depthRef = await LE.maps.refineDepth(depthRaw, srcImage, { maxSide: MAXW });
    status('Edge refinement: ' + Math.round(depthRef.timings.refineMs) + ' ms at ' + depthRef.width + ' x ' + depthRef.height + '.');
    updateNormals();
  }

  function initGL() {
    try {
      GL.blur = mkDemo('gBlur', FS_BLUR, function (gl, p, d) {
        var showHold = d.hold;
        u1(gl, p, 'uFocus', +$('bFocus').value); u1(gl, p, 'uMaxR', showHold ? 0 : (+$('bAper').value) * 0.03 * d.canvas.width); u1(gl, p, 'uRange', +$('bRange').value); u1(gl, p, 'uShow', $('bShowCoc').checked ? 1 : 0);
      });
      GL.light = mkDemo('gLight', FS_LIGHT, function (gl, p, d) {
        var l = d.light || (d.light = { x: 0.2, y: 0.25 });
        gl.uniform3f(gl.getUniformLocation(p, 'uLight'), l.x, l.y, +$('lHeight').value); u1(gl, p, 'uGain', d.hold ? 0 : +$('lGain').value); u1(gl, p, 'uAmb', d.hold ? 1 : +$('lAmb').value); u1(gl, p, 'uRim', d.hold ? 0 : +$('lRim').value);
        gl.uniform1i(gl.getUniformLocation(p, 'uView'), d.hold ? 0 : +$('lView').value);
      });
      GL.fog = mkDemo('gFog', FS_FOG, function (gl, p, d) { u1(gl, p, 'uDens', d.hold ? 0 : +$('fDens').value); u1(gl, p, 'uStart', +$('fStart').value); u1(gl, p, 'uBright', +$('fBright').value); });
      $('gpuinfo').textContent = 'Renderer: ' + (function () { var gl = GL.blur.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'WebGL2'; })();
    } catch (e) { status('The demos need WebGL2: ' + e.message); window.__depthError = e.message; return; }
    redrawAll();
  }
  function redrawAll() {
    if (!GL.blur || !depthRaw) return;
    GL.blur.setDepth(pickDepth($('bRefined'))); GL.light.setDepth(depthRef || depthRaw); GL.fog.setDepth(pickDepth($('fRefined')));
    if (normCanvas) GL.light.setNormals(normCanvas);
    GL.blur.draw(); GL.light.draw(); GL.fog.draw();
  }
  ['bFocus', 'bAper', 'bRange', 'bShowCoc'].forEach(function (id) { $(id).addEventListener('input', function () { if (GL.blur) GL.blur.draw(); }); });
  ['lHeight', 'lGain', 'lAmb', 'lRim', 'lView'].forEach(function (id) { $(id).addEventListener('input', function () { if (GL.light) GL.light.draw(); }); });
  ['fDens', 'fStart', 'fBright'].forEach(function (id) { $(id).addEventListener('input', function () { if (GL.fog) GL.fog.draw(); }); });
  $('bRefined').addEventListener('change', async function () { if (this.checked) await ensureRefined(); redrawAll(); });
  $('fRefined').addEventListener('change', async function () { if (this.checked) await ensureRefined(); redrawAll(); });
  function holdBtn(id, key) {
    var b = $(id), on = function (e) { e.preventDefault(); if (GL[key]) { GL[key].hold = true; GL[key].draw(); } }, off = function () { if (GL[key]) { GL[key].hold = false; GL[key].draw(); } };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  }
  holdBtn('bHold', 'blur'); holdBtn('lHold', 'light'); holdBtn('fHold', 'fog');
  /* Click to focus, drag to move the light. */
  function uvOf(ev, cv) { var r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)) }; }
  $('gBlur').addEventListener('pointerdown', function (e) {
    if (!depthRaw) return; var p = uvOf(e, this), d = pickDepth($('bRefined')), x = Math.min(d.width - 1, Math.floor(p.x * d.width)), y = Math.min(d.height - 1, Math.floor(p.y * d.height));
    $('bFocus').value = d.depth[y * d.width + x]; GL.blur.draw();
  });
  var dragging = false;
  $('gLight').addEventListener('pointerdown', function (e) { dragging = true; this.setPointerCapture(e.pointerId); var p = uvOf(e, this); GL.light.light = p; GL.light.draw(); });
  $('gLight').addEventListener('pointermove', function (e) { if (!dragging) return; GL.light.light = uvOf(e, this); GL.light.draw(); });
  $('gLight').addEventListener('pointerup', function () { dragging = false; });
  $('gLight').style.touchAction = 'none';

  /* Test hook: pixel statistics of a demo canvas, so tests need no screenshots. */
  window.__labReady = true;
})();
