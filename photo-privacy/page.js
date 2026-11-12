/* Photo privacy check page: drop photos, see what they reveal (LE.privacy.inspect), write clean copies
   (LE.privacy.clean) and download, zip or share them. Every value from a file is inserted with textContent. */
(function () {
  'use strict';
  var LE = window.LE, IT = window.IT;
  if (!LE || !LE.privacy) return;
  var P = LE.privacy;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  var ICON = {
    where: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>',
    when: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    device: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    extras: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'
  };
  function svg(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>'; }

  var drop = $('pp-drop'), app = $('pp-app'), list = $('pp-list'), total = $('pp-total'), go = $('pp-go');
  var shareAll = $('pp-share-all'), cardBox = $('pp-cardbox'), cardImg = $('pp-card-img');
  var items = [];
  var opts = { keep: 'none', keepIcc: true };
  var seq = 0;
  var cardBlob = null;
  var canShareFiles = !!(navigator.canShare && window.File);

  var input = IT.dropzone(drop, { accept: 'image/*,.heic,.heif,.avif', multiple: true, paste: true, onFiles: add });
  $('pp-more').addEventListener('click', function () { input.click(); });
  $('pp-clear').addEventListener('click', reset);
  $('pp-keep').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    this.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    opts.keep = b.getAttribute('data-v');
    staleAll();
  });
  $('pp-icc').addEventListener('change', function () { opts.keepIcc = this.checked; staleAll(); });
  go.addEventListener('click', primary);
  shareAll.addEventListener('click', function () { share(items.filter(function (it) { return it.result && it.result.ok; }).map(function (it) { return it.result; })); });
  $('pp-card-dl').addEventListener('click', function () { if (cardBlob) IT.download(cardBlob, 'photo-privacy-check.png'); });
  $('pp-card-share').addEventListener('click', function () {
    if (!cardBlob) return;
    var f = new File([cardBlob], 'photo-privacy-check.png', { type: 'image/png' });
    if (canShareFiles && navigator.canShare({ files: [f] })) navigator.share({ files: [f], title: 'Photo privacy check' }).catch(function () {});
  });

  function add(files) {
    files = files.filter(function (f) { return /^image\//.test(f.type) || /\.(heic|heif|avif|jpe?g|png|webp|tiff?)$/i.test(f.name || ''); });
    if (!files.length) { IT.toast('Please choose photos'); return; }
    drop.classList.add('hidden');
    app.classList.remove('hidden');
    files.slice(0, 200).forEach(function (f) {
      var it = { id: ++seq, file: f, report: null, result: null, urls: [] };
      items.push(it);
      it.li = el('li', 'pp-photo is-loading');
      it.li.appendChild(el('p', 'pp-reading', 'Reading ' + P.text(f.name || 'photo', 80) + '…'));
      list.appendChild(it.li);
      P.inspect(f).then(function (rep) { it.report = rep; render(it); overview(); });
    });
    overview();
  }
  function reset() {
    items.forEach(release);
    items = [];
    list.innerHTML = '';
    cardBox.hidden = true;
    app.classList.add('hidden');
    drop.classList.remove('hidden');
    overview();
  }
  function release(it) { it.urls.forEach(function (u) { URL.revokeObjectURL(u); }); it.urls = []; }
  function url(it, blob) { var u = URL.createObjectURL(blob); it.urls.push(u); return u; }
  function remove(it) {
    release(it);
    it.li.remove();
    items = items.filter(function (x) { return x !== it; });
    if (!items.length) reset(); else overview();
  }
  function staleAll() {
    var had = false;
    items.forEach(function (it) { if (it.result) { it.result = null; had = true; renderResult(it); } });
    if (had) clean();
    overview();
  }

  /* ---------- One photo ---------- */
  function render(it) {
    var rep = it.report;
    var li = it.li;
    li.className = 'pp-photo';
    li.innerHTML = '';
    var head = el('div', 'pp-head');
    var thumb = el('div', 'pp-thumb');
    var img = el('img');
    img.alt = '';
    img.decoding = 'async';
    img.onerror = function () { thumb.classList.add('is-empty'); img.remove(); };
    img.src = url(it, it.file);
    thumb.appendChild(img);
    head.appendChild(thumb);
    var meta = el('div', 'pp-meta');
    var name = el('h3', 'pp-name', rep.name);
    name.title = rep.name;
    meta.appendChild(name);
    var lvl = rep.level;
    var badge = el('span', 'pp-badge is-' + (lvl === 'high' ? 'high' : lvl === 'some' ? 'some' : 'none'), lvl === 'high' ? 'Reveals location' : lvl === 'some' ? (rep.sensitiveCount + ' detail' + (rep.sensitiveCount === 1 ? '' : 's') + ' found') : (rep.supported ? 'Nothing sensitive' : 'Partly checked'));
    meta.appendChild(badge);
    meta.appendChild(el('p', 'pp-sum', rep.summary));
    head.appendChild(meta);
    var x = el('button', 'btn btn-ghost btn-sm pp-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove ' + rep.name + ' from the list');
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    x.onclick = function () { remove(it); };
    head.appendChild(x);
    li.appendChild(head);

    rep.notes.concat(rep.warnings).forEach(function (n) { li.appendChild(el('p', 'pp-note', n)); });

    var groups = el('div', 'pp-groups');
    rep.groups.forEach(function (g) {
      if (!g.items.length) return;
      var sec = el('section', 'pp-group pp-g-' + g.id);
      var h = el('h4', 'pp-gh');
      h.innerHTML = svg(g.id);
      h.appendChild(el('span', '', g.title));
      if (g.id !== 'file') h.appendChild(el('small', '', String(g.items.filter(function (i) { return !i.derived; }).length)));
      sec.appendChild(h);
      if (g.id === 'where' && rep.gps) {
        var map = el('div', 'pp-mapbox');
        map.innerHTML = P.mapSvg(rep.gps.lat, rep.gps.lon, { label: 'World map with a pin where the photo was taken' });
        sec.appendChild(map);
      }
      var dl = el('dl', 'pp-dl');
      g.items.forEach(function (i) {
        var row = el('div', 'pp-row' + (i.sensitive && g.id !== 'file' ? ' is-sensitive' : '') + (i.derived ? ' is-derived' : ''));
        row.setAttribute('data-key', i.key);
        row.appendChild(el('dt', '', i.label));
        var dd = el('dd');
        dd.appendChild(el('span', 'pp-val', i.value));
        if (i.note) dd.appendChild(el('small', '', i.note));
        row.appendChild(dd);
        dl.appendChild(row);
      });
      sec.appendChild(dl);
      if (g.id === 'extras' && rep.thumbnail) sec.appendChild(preview(it));
      groups.appendChild(sec);
    });
    li.appendChild(groups);
    var foot = el('div', 'pp-result');
    it.resultEl = foot;
    li.appendChild(foot);
    renderResult(it);
  }
  function preview(it) {
    var rep = it.report, th = rep.thumbnail;
    var fig = el('figure', 'pp-preview');
    var im = el('img');
    im.alt = 'The hidden preview stored inside this photo';
    im.src = url(it, new Blob([th.bytes], { type: 'image/jpeg' }));
    im.onerror = function () { fig.remove(); };
    fig.appendChild(im);
    var cap = 'The hidden preview, as stored. ';
    var o = rep.orientation >= 5;
    var w = o ? rep.height : rep.width, h = o ? rep.width : rep.height;
    var tw = th.width, tH = th.height;
    if (o) { var t = tw; tw = tH; tH = t; }
    if (w && h && tw && tH && Math.abs(w / h - tw / tH) > 0.05) cap += 'It has a different shape from the photo, so it may show parts that were cropped out.';
    else cap += 'If an app edited the photo without updating it, it can still show the original.';
    fig.appendChild(el('figcaption', '', cap));
    return fig;
  }
  function renderResult(it) {
    var box = it.resultEl;
    if (!box) return;
    box.innerHTML = '';
    var r = it.result;
    var rep = it.report;
    if (!r) {
      if (!rep.supported && !rep.count) return;
      box.appendChild(el('p', 'pp-hint', rep.sensitiveCount ? 'Tap “Remove hidden details” to make a clean copy.' : 'You can share it as it is, or make a copy without the technical details.'));
      return;
    }
    if (r.pending) { box.appendChild(el('p', 'pp-hint', 'Cleaning…')); return; }
    if (!r.ok) { box.appendChild(el('p', 'pp-note', r.reason || 'No clean copy could be made.')); return; }
    var ok = el('div', 'pp-done');
    var line = el('p', 'pp-done-line');
    line.innerHTML = svg('check');
    var quality = r.method === 'lossless' ? (r.identical ? 'image quality unchanged' : 'image data kept') : 'converted to JPEG';
    line.appendChild(el('span', '', r.removed + ' detail' + (r.removed === 1 ? '' : 's') + ' removed, ' + quality + ', ' + P.fmtBytes(r.bytesBefore) + ' → ' + P.fmtBytes(r.bytesAfter)));
    ok.appendChild(line);
    var verify = r.verified ? 'Checked: the clean copy was read again and ' + (r.kept.length ? 'only keeps what you chose (' + r.kept.join(', ') + ').' : 'carries no hidden details.') : 'Some details could not be removed: ' + r.leftovers.map(function (l) { return l.label; }).join(', ') + '.';
    ok.appendChild(el('p', r.verified ? 'pp-verify' : 'pp-note', verify));
    var acts = el('div', 'pp-acts');
    var dl = el('button', 'btn btn-sm', 'Download');
    dl.type = 'button';
    dl.onclick = function () { IT.download(r.blob, r.name); };
    acts.appendChild(dl);
    if (canShareFiles) {
      var sh = el('button', 'btn btn-sm btn-ghost', 'Share');
      sh.type = 'button';
      sh.onclick = function () { share([r]); };
      if (navigator.canShare({ files: [new File([r.blob], r.name, { type: r.blob.type })] })) acts.appendChild(sh);
    }
    ok.appendChild(acts);
    box.appendChild(ok);
  }

  /* ---------- All photos ---------- */
  function overview() {
    var ready = items.filter(function (it) { return it.report; });
    var n = items.length;
    var where = ready.filter(function (it) { return it.report.reveals && it.report.reveals.location; }).length;
    var some = ready.filter(function (it) { return it.report.sensitiveCount; }).length;
    var cleaned = items.filter(function (it) { return it.result && it.result.ok; });
    var cleanable = ready.filter(function (it) { return it.report.supported || it.report.count; });
    var txt;
    if (!n) txt = '';
    else if (ready.length < n) txt = 'Reading ' + n + ' photo' + (n === 1 ? '' : 's') + '…';
    else if (n === 1) txt = some ? (where ? 'This photo shows where it was taken. Nothing has left your device.' : 'This photo has some hidden details. Nothing has left your device.') : 'This photo looks clean. Nothing has left your device.';
    else txt = n + ' photos checked. ' + (where ? where + ' show' + (where === 1 ? 's' : '') + ' where they were taken. ' : '') + (some ? some + ' carr' + (some === 1 ? 'ies' : 'y') + ' hidden details.' : 'None carry sensitive details.');
    total.textContent = txt;
    var done = cleaned.length && cleaned.length === items.filter(function (it) { return it.result; }).length && !items.some(function (it) { return it.result && it.result.pending; });
    go.disabled = !cleanable.length || ready.length < n;
    go.textContent = done ? (cleaned.length > 1 ? 'Download all (' + cleaned.length + ') as zip' : 'Download clean copy') : (n > 1 ? 'Remove hidden details from all' : 'Remove hidden details');
    shareAll.hidden = !(done && canShareFiles);
    cardBox.hidden = !done;
    if (done) makeCard(cleaned.map(function (it) { return it.result; }));
  }
  function primary() {
    var cleaned = items.filter(function (it) { return it.result && it.result.ok; });
    if (cleaned.length && !items.some(function (it) { return it.result && it.result.pending; }) && cleaned.length === items.filter(function (it) { return it.result; }).length) {
      if (cleaned.length === 1) IT.download(cleaned[0].result.blob, cleaned[0].result.name);
      else { var z = P.zip(cleaned.map(function (it) { return it.result; })); if (z) IT.download(z, 'clean-photos.zip'); }
      return;
    }
    clean();
  }
  function clean() {
    var todo = items.filter(function (it) { return it.report && !it.result && (it.report.supported || it.report.count); });
    todo.forEach(function (it) { it.result = { pending: true }; renderResult(it); });
    overview();
    var o = { keep: opts.keep, keepIcc: opts.keepIcc };
    return todo.reduce(function (p, it) {
      return p.then(function () {
        return P.clean(it.file, o).then(function (r) {
          if (!it.result || !it.result.pending) return;
          it.result = r;
          renderResult(it);
        });
      });
    }, Promise.resolve()).then(function () {
      overview();
      var ok = items.filter(function (it) { return it.result && it.result.ok; }).length;
      if (ok) IT.say(ok === 1 ? 'Clean copy ready' : ok + ' clean copies ready');
    });
  }
  function share(results) {
    var files = results.filter(function (r) { return r && r.ok; }).map(function (r) { return new File([r.blob], r.name, { type: r.blob.type }); });
    if (!files.length || !canShareFiles || !navigator.canShare({ files: files })) { IT.toast('Sharing files is not supported here. Download instead.'); return; }
    navigator.share({ files: files }).catch(function () {});
  }
  function makeCard(results) {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var c = P.card(results, { dark: dark });
    c.toBlob(function (b) {
      if (!b) return;
      cardBlob = b;
      if (cardImg.src) URL.revokeObjectURL(cardImg.src);
      cardImg.src = URL.createObjectURL(b);
      var f = new File([b], 'photo-privacy-check.png', { type: 'image/png' });
      $('pp-card-share').hidden = !(canShareFiles && navigator.canShare({ files: [f] }));
    }, 'image/png');
  }

  window.LEPhotoPrivacy = { items: function () { return items; }, add: add, clean: clean, reset: reset, opts: opts };
})();
