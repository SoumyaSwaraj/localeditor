/* LocalEditor studio hook for camera RAW files and HDR merges (Expert step X5). About 5 KB; the only RAW code the studio page loads up
 * front. It downloads nothing until a RAW file is opened: then it loads assets/js/raw/le-raw-layer.js (and through it raw.js; the
 * optional Camera RAW support module only for non-DNG formats, through LE.downloads).
 *
 * Opening RAW: the studio's "Add photos" chooser and drops on the canvas accept RAW files; they are taken here (capture phase) and the
 * rest go on to the studio as before. The embedded JPEG preview appears at once, the developed picture replaces it when the decode
 * is done, and the layer keeps layer.raw (+ develop entries in layer.fx) so Expert mode can develop it. Simple mode shows the default
 * development ("open and it looks right").
 *
 * Commands (LEStudioPanels._cmds, usable as data-cmd): rawOpen, hdrMerge (asks for 2-9 files), rawLicence.
 * API: LE.rawStudio.open(files, at) / .mergeHdr(files, opts) / .isRaw(file) / .licence() / .accept
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  if (LE.rawStudio) return;
  var EXTS = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'sr2', 'srf', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'srw', 'mrw', 'iiq', '3fr', 'x3f', 'erf', 'kdc', 'dcr', 'mef', 'arq'];
  var ACCEPT = EXTS.map(function (e) { return '.' + e; }).join(',');
  var BASE = (function () { try { var s = document.currentScript; if (s && s.src) return s.src.replace(/[^/]*$/, ''); } catch (e) { } return '../assets/js/raw/'; })();
  var LICENCE_URL = BASE.replace(/assets\/js\/raw\/$/, '') + 'licenses/#libraw';
  function isRaw(f) { return !!f && EXTS.indexOf(String(f.name || '').toLowerCase().split('.').pop()) >= 0; }
  function ctx() { return global.LEStudio || null; }
  function say(msg, o) { var c = ctx(); if (c && c.toast) c.toast(msg, o); }
  function module() { return (LE.lazy ? LE.lazy(BASE + 'le-raw-layer.js') : Promise.reject(new Error('The loader is missing.'))).then(function () { return LE.rawLayer.ready(); }); }
  function licence() { try { global.open(LICENCE_URL, '_blank', 'noopener'); } catch (e) { } }
  function fileOf(blob, name, type) { return new File([blob], name, { type: type || blob.type || 'image/jpeg' }); }
  /* Adds the result of LE.raw.open / LE.hdr.mergeFiles to the design: assets to the designs database, then the layer. */
  function place(res, at, replaceId) {
    var c = ctx(); if (!c) return Promise.reject(new Error('The studio is not ready.'));
    var a = res.assets, extra = a.raw || a.hdr;
    var srcFile = fileOf(a.src.blob, a.src.name, 'image/jpeg');
    srcFile._leResized = true;   /* already sized by the working copy; keep it as it is */
    var store = extra ? LE.project.putAsset({ blob: extra.blob, name: extra.name, type: 'image/png', width: extra.width, height: extra.height }) : Promise.resolve(null);
    return store.then(function (meta) {
      if (meta && c.S.project) c.S.project.assets[meta.id] = meta;
      var job = !c.S.project
        ? c.newFromPhoto(srcFile).then(function () { var b = c.baseLayer && c.baseLayer(); return b ? { id: b.id } : null; })
        : c.ingest(srcFile).then(function (m) { return replaceId ? { id: replaceId, src: m.id } : { id: c.placeImage(m.id, at) }; });
      return job.then(function (r) {
        if (meta && c.S.project) c.S.project.assets[meta.id] = meta;
        var l = r && r.id ? c.L(r.id) : null;
        if (!l) return null;
        var patch = { raw: res.layer.raw, fx: res.layer.fx };
        if (r.src) { patch.src = r.src; patch.h = l.w * a.src.height / a.src.width; patch.crop = { x: 0, y: 0, w: 1, h: 1 }; }
        c.scene.update(r.id, patch);
        if (c.markDirty) c.markDirty();
        return r.id;
      });
    });
  }
  function open(files, at) {
    var list = [].slice.call(files || []).filter(isRaw);
    if (!list.length) return Promise.resolve([]);
    var out = [], chain = Promise.resolve();
    list.forEach(function (f) {
      chain = chain.then(function () {
        say('Opening ' + f.name + '…', { ms: 60000 });
        var placed = null;
        /* E7: the device check (with "Try anyway") before the optional camera module is fetched and run; DNG opens with our own reader
           and needs no question (it works at half size on small devices). */
        var gate = !/\.dng$/i.test(f.name) && LE.support && LE.support.gate ? function (run) { return LE.support.gate('raw.camera', { title: 'Camera RAW support', run: run, onCancel: function () { } }); } : function (run) { return run(); };
        return gate(module).then(function () {
          return LE.raw.open(f, {
            onPreview: function (pv) {
              var c = ctx(); if (!c || !c.S.project || !pv || Math.max(pv.width, pv.height) < 800) return;
              placed = c.ingest(fileOf(pv.blob, f.name.replace(/\.[^.]+$/, '') + ' preview.jpg', 'image/jpeg')).then(function (m) { return c.placeImage(m.id, at); }).catch(function () { return null; });
            }
          });
        }).then(function (res) {
          return Promise.resolve(placed).then(function (pid) { return place(res, at, pid || null); }).then(function (id) {
            out.push(id);
            var warn = res.info.warnings && res.info.warnings[0];
            say(warn || ('Opened ' + f.name + (res.info.halfSize ? ' (working at half size; export uses the full file)' : '')), { ms: warn ? 8000 : 2600 });
          });
        }).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          var camera = err && (err.code === 'decoder' || err.code === 'declined');
          say((err && err.message) || 'This RAW file could not be opened.', camera ? { ms: 9000, action: { label: 'Camera RAW support · licence', fn: licence } } : { ms: 7000 });
        });
      });
    });
    return chain.then(function () { return out; });
  }
  function mergeHdr(files, o) {
    o = o || {};
    var c = ctx(), ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    say('Merging ' + files.length + ' photos to HDR…', { ms: 120000, action: ctrl ? { label: 'Cancel', fn: function () { ctrl.abort(); } } : null });
    return module().then(function () {
      return LE.hdr.mergeFiles(files, Object.assign({ signal: ctrl && ctrl.signal }, o));
    }).then(function (res) { return place(res, null, null).then(function (id) { say('HDR merge ready. ' + res.info.limit, { ms: 4000 }); return id; }); }, function (err) {
      if (!(err && err.name === 'AbortError')) say((err && err.message) || 'The photos could not be merged.', { ms: 7000 });
      return null;
    });
  }
  /* Capture RAW files before the studio's own handlers (which only know browser image formats). */
  function takeRaw(list) { return list.some(isRaw); }
  global.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.id !== 'sx-file' || !t.files) return;
    var all = [].slice.call(t.files), mode = t.dataset.mode || 'add';
    if (mode === 'hdr') t.dataset.mode = 'add';
    if (mode !== 'hdr' && !takeRaw(all)) return;
    e.stopImmediatePropagation(); e.stopPropagation();
    t.value = '';
    if (mode === 'hdr') { mergeHdr(all); return; }
    var rest = all.filter(function (f) { return !isRaw(f); }), c = ctx();
    open(all).then(function () { if (rest.length && c) c.addFiles(rest); });
  }, true);
  global.addEventListener('drop', function (e) {
    var t = e.target, stage = document.getElementById('sx-stage');
    if (!stage || !t || !stage.contains(t) || !e.dataTransfer) return;
    var all = [].slice.call(e.dataTransfer.files || []);
    if (!takeRaw(all)) return;
    e.preventDefault(); e.stopPropagation();
    var drop = document.getElementById('sx-drop'); if (drop) drop.hidden = true;
    var c = ctx(), at = c && c.S.project && c.docPoint ? c.docPoint(e.clientX, e.clientY) : null, rest = all.filter(function (f) { return !isRaw(f); });
    open(all, at).then(function () { if (rest.length && c) c.addFiles(rest, { at: at }); });
  }, true);
  /* The chooser lists RAW files too. */
  function widen() { var inp = document.getElementById('sx-file'); if (inp && inp.accept.indexOf('.dng') < 0) inp.accept = (inp.accept ? inp.accept + ',' : '') + ACCEPT; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', widen); else widen();
  /* The camera module's licence line, in the studio's own toast. */
  global.addEventListener('le-raw:licence', function (e) {
    if (!ctx()) return;
    e.preventDefault();
    say(e.detail.text, { ms: 9000, action: { label: 'Licence and source', fn: licence } });
  });
  var P = global.LEStudioPanels = global.LEStudioPanels || {}, CMDS = P._cmds = P._cmds || {};
  function pick(mode) { var inp = document.getElementById('sx-file'); if (!inp) return; widen(); inp.dataset.mode = mode; inp.click(); }
  CMDS.rawOpen = function () { pick('add'); };
  CMDS.hdrMerge = function () { pick('hdr'); };
  CMDS.rawLicence = licence;
  LE.rawStudio = { open: open, mergeHdr: mergeHdr, isRaw: isRaw, licence: licence, licenceUrl: LICENCE_URL, accept: ACCEPT, extensions: EXTS.slice() };
})(window);
