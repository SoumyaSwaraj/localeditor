/* LocalEditor studio panels. Each panel renders into the side panel or phone sheet. */
(function () {
  'use strict';
  var P = window.LEStudioPanels = {};
  var LE = window.LE;

  function tabs(c, body, list, active, onPick) {
    var bar = c.h('<div class="sx-tabs-row" role="tablist"></div>');
    list.forEach(function (t) {
      var b = c.h('<button type="button" role="tab" aria-selected="' + (t[0] === active) + '">' + c.esc(t[1]) + '</button>');
      b.onclick = function () { onPick(t[0]); };
      bar.appendChild(b);
    });
    body.appendChild(bar);
    return bar;
  }
  function searchBox(c, body, placeholder, value, onInput) {
    var wrap = c.h('<div class="sx-search">' + c.ic('search') + '<input type="search" placeholder="' + c.esc(placeholder) + '" aria-label="' + c.esc(placeholder) + '" value="' + c.esc(value || '') + '"></div>');
    var input = wrap.querySelector('input');
    input.addEventListener('input', c.debounce(function () { onInput(input.value.trim()); }, 160));
    body.appendChild(wrap);
    return input;
  }
  function grid(cls) { var g = document.createElement('div'); g.className = 'sx-grid ' + (cls || ''); return g; }
  function btn(c, label, icon, cls, fn) {
    var b = c.h('<button type="button" class="' + (cls || 'btn btn-ghost btn-sm') + '">' + (icon ? c.ic(icon) : '') + '<span>' + c.esc(label) + '</span></button>');
    if (fn) b.onclick = fn;
    return b;
  }
  function note(c, text, cls) { return c.h('<p class="sx-note' + (cls ? ' ' + cls : '') + '">' + c.esc(text) + '</p>'); }
  function needProject(c, body) {
    if (c.S.project) return false;
    body.appendChild(c.ui.empty('Start with a photo or a blank page', 'Open a photo from this device, try the sample, or pick a size in Design.', [
      { label: 'Open photo', gold: true, fn: function () { c.pickFiles('add'); } },
      { label: 'Try sample', fn: function () { c.useSample(); } }
    ]));
    return true;
  }
  /* Object-URL memo caches with a size limit: the least recently used URL is revoked when the cache is full, and every cache
     is emptied when a design closes (P._releaseUrls). Shared with the colour and icon modules. */
  var URL_CACHES = P._urlCaches = {};
  P._urlCache = function (name, max) {
    if (URL_CACHES[name]) return URL_CACHES[name];
    var m = new Map();
    function drop(u) { try { URL.revokeObjectURL(u); } catch (e) {} }
    var c = URL_CACHES[name] = {
      get: function (k) { if (!m.has(k)) return undefined; var v = m.get(k); m.delete(k); m.set(k, v); return v; },
      set: function (k, v) {
        if (m.has(k) && m.get(k) !== v) drop(m.get(k));
        m.delete(k); m.set(k, v);
        while (m.size > (max || 200)) { var f = m.keys().next().value; drop(m.get(f)); m.delete(f); }
        return v;
      },
      clear: function () { m.forEach(drop); m.clear(); },
      size: function () { return m.size; },
      max: max || 200
    };
    return c;
  };
  P._releaseUrls = function () { Object.keys(URL_CACHES).forEach(function (k) { URL_CACHES[k].clear(); }); };
  var svgUrls = P._urlCache('svg', 400);
  function svgUrl(id, color) {
    var key = id + '|' + (color || '');
    var hit = svgUrls.get(key);
    if (hit) return hit;
    var markup = LE.assets.svg(id, color ? { color: color } : {});
    return svgUrls.set(key, URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' })));
  }
  function draggable(node, data) {
    node.draggable = true;
    node.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData(data.asset ? 'text/x-le-asset' : 'text/x-le-el', data.asset || JSON.stringify(data));
      e.dataTransfer.effectAllowed = 'copy';
    });
  }
  function k(c) { return c.doc ? Math.min(c.doc().width, c.doc().height) / 1080 : 1; }
  function sizeArt(w, h, bw, bh) {
    var s = Math.min(bw / w, bh / h);
    return '<span class="sx-size-art"><i style="width:' + Math.max(4, Math.round(w * s)) + 'px;height:' + Math.max(4, Math.round(h * s)) + 'px"></i></span>';
  }
  function when(ts) {
    var d = new Date(ts);
    var diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.round(diff / 60) + ' min ago';
    if (diff < 86400) return Math.round(diff / 3600) + ' h ago';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Text presets ---------- */
  var TEXT = {
    heading: { text: 'Add a heading', size: 96, weight: 800, font: 'Plus Jakarta Sans', name: 'Heading' },
    subheading: { text: 'Add a subheading', size: 56, weight: 600, font: 'Plus Jakarta Sans', name: 'Subheading' },
    body: { text: 'Add a little bit of body text', size: 34, weight: 400, font: 'Plus Jakarta Sans', name: 'Body text', lineHeight: 1.4 }
  };
  var COMBOS = [
    { id: 'serif-accent', name: 'Editorial accent', preview: '<em style="font-family:Instrument Serif;font-size:30px">Summer</em><b style="font:700 11px Plus Jakarta Sans;letter-spacing:.3em">COLLECTION</b>', layers: [
      { text: 'Summer', font: 'Instrument Serif', italic: true, weight: 400, size: 170, w: 820, dy: -40, color: '#17131F' },
      { text: 'COLLECTION 2026', font: 'Plus Jakarta Sans', weight: 700, size: 30, letterSpacing: 12, w: 820, dy: 80, color: '#17131F' }] },
    { id: 'bold-display', name: 'Bold display', preview: '<b style="font-family:Anton;font-size:30px;letter-spacing:.02em">BIG NEWS</b>', layers: [
      { text: 'BIG NEWS', font: 'Anton', weight: 400, size: 190, w: 900, color: '#17131F' }] },
    { id: 'script-sans', name: 'Script + sans', preview: '<em style="font-family:Great Vibes;font-size:32px;color:#B9832F">Thank you</em><b style="font:600 10px Montserrat;letter-spacing:.35em">FOR COMING</b>', layers: [
      { text: 'Thank you', font: 'Great Vibes', weight: 400, size: 160, w: 860, dy: -40, color: '#B9832F' },
      { text: 'FOR CELEBRATING WITH US', font: 'Montserrat', weight: 600, size: 26, letterSpacing: 10, w: 860, dy: 80, color: '#17131F' }] },
    { id: 'outlined', name: 'Outlined', preview: '<b style="font-family:Bebas Neue;font-size:34px;color:transparent;-webkit-text-stroke:1.4px #7457F0">OUTLINE</b>', layers: [
      { text: 'OUTLINE', font: 'Bebas Neue', weight: 400, size: 200, w: 900, color: 'rgba(0,0,0,0)', stroke: { width: 4, color: '#7457F0' } }] },
    { id: 'neon', name: 'Neon glow', preview: '<b style="font-family:Righteous;font-size:28px;color:#fff;text-shadow:0 0 8px #E0668E,0 0 16px #E0668E">neon nights</b>', dark: true, layers: [
      { text: 'neon nights', font: 'Righteous', weight: 400, size: 130, w: 900, color: '#FFFFFF', shadow: { color: 'rgba(224,102,142,1)', blur: 30, x: 0, y: 0 } }] },
    { id: 'retro', name: 'Retro shadow', preview: '<b style="font-family:Bungee;font-size:24px;color:#E2B15A;text-shadow:3px 3px 0 #17131F">RETRO</b>', layers: [
      { text: 'RETRO', font: 'Bungee', weight: 400, size: 150, w: 900, color: '#E2B15A', shadow: { color: 'rgba(23,19,31,1)', blur: 0, x: 10, y: 10 } }] },
    { id: 'label', name: 'Highlighted label', preview: '<b style="font:800 14px Plus Jakarta Sans;background:#F2D594;padding:4px 10px;border-radius:999px">NEW ARRIVAL</b>', layers: [
      { text: 'NEW ARRIVAL', font: 'Plus Jakarta Sans', weight: 800, size: 44, letterSpacing: 6, w: 520, color: '#2C220F', background: { color: '#F2D594', radius: 999, padding: 22 } }] },
    { id: 'curved', name: 'Curved badge', preview: '<b style="font:700 12px Space Grotesk;letter-spacing:.3em;border-top:2px solid currentColor;border-radius:50% 50% 0 0;padding-top:4px">• CURVED •</b>', layers: [
      { text: 'MADE WITH LOVE • SINCE 2026 •', font: 'Space Grotesk', weight: 700, size: 40, letterSpacing: 8, w: 640, curve: 260, color: '#17131F' }] },
    { id: 'gradient', name: 'Gradient headline', preview: '<b style="font-family:Syne;font-size:28px;background:linear-gradient(90deg,#7457F0,#E0668E,#F2CF86);-webkit-background-clip:text;background-clip:text;color:transparent">Aurora</b>', layers: [
      { text: 'Aurora', font: 'Syne', weight: 700, size: 180, w: 900, color: '#7457F0', fill: { type: 'linear', colors: ['#7457F0', '#E0668E', '#F2CF86'], angle: 0 } }] },
    { id: 'minimal', name: 'Minimal editorial', preview: '<em style="font-family:Cormorant Garamond;font-size:26px">the quiet edit</em><span style="font:500 10px DM Sans;letter-spacing:.2em">ISSUE 04</span>', layers: [
      { text: 'the quiet edit', font: 'Cormorant Garamond', italic: true, weight: 400, size: 120, w: 900, dy: -30, color: '#17131F' },
      { text: 'ISSUE 04 — AUTUMN', font: 'DM Sans', weight: 500, size: 26, letterSpacing: 8, w: 900, dy: 70, color: '#6B6577' }] },
    { id: 'note', name: 'Handwritten note', preview: '<span style="font-family:Caveat;font-size:28px;transform:rotate(-4deg);display:inline-block">don\'t forget!</span>', layers: [
      { text: "don't forget!", font: 'Caveat', weight: 700, size: 120, w: 760, rotation: -4, color: '#D07A45' }] },
    { id: 'quote', name: 'Quote', preview: '<em style="font-family:Playfair Display;font-size:18px">“Make it simple.”</em><span style="font:500 10px Inter">— Someone wise</span>', layers: [
      { text: '“Make it simple, but significant.”', font: 'Playfair Display', italic: true, weight: 400, size: 72, w: 860, dy: -30, color: '#17131F', lineHeight: 1.25 },
      { text: '— DON DRAPER', font: 'Inter', weight: 600, size: 26, letterSpacing: 6, w: 860, dy: 110, color: '#6B6577' }] },
    { id: 'tag', name: 'Dark tag', preview: '<b style="font:700 13px Space Grotesk;background:#17131F;color:#F2D594;padding:5px 12px;border-radius:8px">LIMITED · 30% OFF</b>', layers: [
      { text: 'LIMITED · 30% OFF', font: 'Space Grotesk', weight: 700, size: 46, letterSpacing: 4, w: 620, color: '#F2D594', background: { color: '#17131F', radius: 16, padding: 24 } }] }
  ];
  function addCombo(c, combo, at) {
    var list = combo.layers.map(function (l) { return Object.assign({ type: 'text', align: 'center', name: combo.name }, l); });
    c.addLayers(list, { group: list.length > 1, name: combo.name, at: at });
  }
  P._textPreset = function (c, id, at) {
    if (TEXT[id]) { c.addText(Object.assign({}, TEXT[id]), at); return; }
    COMBOS.forEach(function (cb) { if (cb.id === id) addCombo(c, cb, at); });
  };
  P._cmd = function (c, name) {
    if (name === 'editText') { var o = c.one(); if (o) c.startTextEdit(o.id); c.closePop(); }
  };

  /* ---------- Start screen ---------- */
  P._start = function (c, host) {
    host.innerHTML =
      '<div class="sx-start-inner">' +
      '<div class="sx-hero"><span class="sx-eyebrow">' + c.ic('shield') + 'Private studio · works offline</span>' +
      '<h1>Design something <em>beautiful.</em></h1>' +
      '<p>Photos, text, stickers and every social size, made on your device. Nothing is uploaded.</p>' +
      '<div class="sx-hero-act"><button type="button" class="btn btn-gold btn-lg" data-s="open">' + c.ic('image') + '<span>Open a photo</span></button>' +
      '<button type="button" class="btn btn-ghost btn-lg" data-s="sample">' + c.ic('sparkle') + '<span>Try the sample</span></button></div>' +
      '<div class="sx-start-quick"><span>Or make a post from a photo</span><div class="sx-quick-row">' +
      [['ig-post', 'Square post'], ['ig-portrait', 'Portrait post'], ['ig-story', 'Story']].map(function (q) { return '<button type="button" class="sx-quick-chip" data-q="' + q[0] + '">' + c.esc(q[1]) + '</button>'; }).join('') + '</div></div>' +
      '<small class="sx-hero-drop">' + (c.coarse && c.coarse() ? '' : 'Or drop photos anywhere · paste with Ctrl V · ') + '<button type="button" class="sx-link" data-s="import">' + c.ic('file') + 'Open a .leproject file</button></small></div>' +
      '<div class="sx-start-sec"><h2>Start with a size</h2><div class="sx-size-row"></div></div>' +
      '<div class="sx-start-sec sx-start-recent" hidden><div class="sx-sec-head"><h2>Your designs</h2><button type="button" class="sx-link" data-s="all">See all</button></div><div class="sx-proj-row"></div></div>' +
      '</div>';
    host.querySelector('[data-s="open"]').onclick = function () { c.pickFiles('add'); };
    host.querySelector('[data-s="sample"]').onclick = function () { c.useSample(); };
    host.querySelector('[data-s="import"]').onclick = function () { c.pickFiles('project'); };
    host.querySelector('[data-s="all"]').onclick = function () { c.openPanel('projects'); };
    [].forEach.call(host.querySelectorAll('[data-q]'), function (b) {
      var s0 = c.SIZES.filter(function (x) { return x.id === b.getAttribute('data-q'); })[0];
      b.onclick = function () { if (c.photoTo) c.photoTo(s0.w, s0.h, s0.name); else c.pickFiles('add'); };
    });
    var row = host.querySelector('.sx-size-row');
    ['ig-post', 'ig-portrait', 'ig-story', 'yt-thumb', 'fb-cover', 'li-banner', 'pin', 'a4'].forEach(function (id) {
      var s = c.SIZES.filter(function (x) { return x.id === id; })[0];
      var b = c.h('<button type="button" class="sx-size-card">' + sizeArt(s.w, s.h, 92, 60) + '<b>' + c.esc(s.name) + '</b><small>' + s.w + ' × ' + s.h + '</small></button>');
      b.onclick = function () { c.newDesign(s.w, s.h, s.name); };
      row.appendChild(b);
    });
    var custom = c.h('<button type="button" class="sx-size-card"><span class="sx-size-art">' + c.ic('plus') + '</span><b>Custom size</b><small>Any width × height</small></button>');
    custom.onclick = function () { customSizeModal(c, function (w, h) { c.newDesign(w, h, 'Custom design'); }); };
    row.appendChild(custom);
    LE.project.list().then(function (list) {
      if (!list.length) return;
      if (c.coach) c.coach('off');
      var sec = host.querySelector('.sx-start-recent');
      if (!sec) return;
      sec.hidden = false;
      var pr = sec.querySelector('.sx-proj-row');
      list.slice(0, 8).forEach(function (p) { pr.appendChild(projectCard(c, p, true)); });
    });
  };
  function customSizeModal(c, done, w0, h0) {
    var body = c.h('<form class="sx-form"><div class="sx-wh"><label>Width<input class="sx-input" type="number" min="16" max="16000" value="' + (w0 || 1080) + '" required></label><span>×</span><label>Height<input class="sx-input" type="number" min="16" max="16000" value="' + (h0 || 1080) + '" required></label></div><p class="sx-note">Pixels. Up to 16 000 on a side.</p><button type="submit" class="btn btn-gold">Create</button></form>');
    body.onsubmit = function (e) {
      e.preventDefault();
      var ins = body.querySelectorAll('input');
      var w = c.clamp(Math.round(Number(ins[0].value) || 0), 16, 16000), h = c.clamp(Math.round(Number(ins[1].value) || 0), 16, 16000);
      c.closeModal();
      done(w, h);
    };
    c.openModal('Custom <em>size</em>', body);
  }
  function projectCard(c, p, compact) {
    var card = c.h('<div class="sx-proj' + (compact ? ' is-compact' : '') + '"><button type="button" class="sx-proj-art" aria-label="Open ' + c.esc(p.name) + '"><span class="sx-proj-ph">' + c.ic('design') + '</span></button><div class="sx-proj-meta"><b title="' + c.esc(p.name) + '">' + c.esc(p.name) + '</b><small>' + (p.width ? p.width + ' × ' + p.height + ' · ' : '') + when(p.updatedAt) + (p.pages > 1 ? ' · ' + p.pages + ' pages' : '') + '</small></div>' + (compact ? '' : '<button type="button" class="sx-iconbtn sx-proj-more" aria-label="More for ' + c.esc(p.name) + '">' + c.ic('more') + '</button>') + '</div>');
    if (p.thumb) {
      var img = new Image();
      img.alt = '';
      img.src = URL.createObjectURL(p.thumb);
      img.onload = function () { URL.revokeObjectURL(img.src); };
      card.querySelector('.sx-proj-art').appendChild(img);
    }
    if (c.S.project && c.S.project.id === p.id) card.classList.add('is-current');
    card.querySelector('.sx-proj-art').onclick = function () { if (!c.S.project || c.S.project.id !== p.id) c.openProject(p.id); };
    var more = card.querySelector('.sx-proj-more');
    if (more) more.onclick = function () { projectMenu(c, p, more); };
    return card;
  }
  function projectMenu(c, p, anchor) {
    var m = c.h('<div class="sx-menu"><button type="button" data-a="open">' + c.ic('projects') + 'Open</button><button type="button" data-a="rename">' + c.ic('text') + 'Rename</button><button type="button" data-a="dup">' + c.ic('copy') + 'Duplicate</button><button type="button" data-a="export">' + c.ic('share') + 'Export .leproject</button><hr><button type="button" data-a="del" class="is-danger">' + c.ic('trash') + 'Delete</button></div>');
    m.onclick = function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      c.closePop();
      if (a === 'open') c.openProject(p.id);
      else if (a === 'rename') {
        var form = c.h('<form class="sx-form"><label>Name<input class="sx-input" maxlength="120" value="' + c.esc(p.name) + '"></label><button type="submit" class="btn btn-gold">Rename</button></form>');
        form.onsubmit = function (e2) {
          e2.preventDefault();
          var v = form.querySelector('input').value.trim() || p.name;
          c.closeModal();
          LE.project.rename(p.id, v).then(function () {
            if (c.S.project && c.S.project.id === p.id) { c.S.project.name = v; var n = document.getElementById('sx-name'); if (n) n.value = v; }
            c.renderPanel(true);
          });
        };
        c.openModal('Rename <em>design</em>', form);
      } else if (a === 'dup') LE.project.duplicate(p.id).then(function () { c.toast('Duplicated'); c.renderPanel(true); });
      else if (a === 'export') {
        var go = c.S.project && c.S.project.id === p.id ? c.exportProject() : LE.project.open(p.id).then(function (proj) { return LE.project.exportFile(proj, { thumb: p.thumb }); }).then(function (blob) { c.download(blob, c.safeName(p.name) + '.leproject'); });
        Promise.resolve(go).catch(function (err) { c.toast(err.message); });
      } else if (a === 'del') {
        var body = c.h('<div class="sx-form"><p>Delete “' + c.esc(p.name) + '” and its version history from this device? Photos used by other designs are kept.</p><div class="sx-row-end"><button type="button" class="btn btn-ghost" data-n>Cancel</button><button type="button" class="btn btn-danger" data-y>Delete</button></div></div>');
        body.querySelector('[data-n]').onclick = c.closeModal;
        body.querySelector('[data-y]').onclick = function () {
          c.closeModal();
          var current = c.S.project && c.S.project.id === p.id;
          LE.project.remove(p.id).then(function () {
            c.toast('Deleted');
            if (current) { try { localStorage.removeItem('le-studio-last'); } catch (err) {} c.cmd('newDesign'); }
            else c.renderPanel(true);
          });
        };
        c.openModal('Delete <em>design?</em>', body);
      }
    };
    c.openPop(anchor, m, { cls: 'sx-pop-menu' });
  }

  /* ---------- Design: templates + sizes ---------- */
  P.design = {
    title: 'Design', eyebrow: 'Templates & sizes',
    render: function (c, body, o) {
      var tab = o.tab || (c.S.project ? 'sizes' : 'templates');
      tabs(c, body, [['templates', 'Templates'], ['sizes', 'Resize'], ['history', 'Size history']], tab, function (t) { c.size.cancel(); c.openPanel('design', { tab: t }); });
      if (tab === 'templates') return P._templates(c, body);   /* le-studio-panels-more.js, as are Resize and Size history */
      if (tab === 'history') return P._sizeHistory(c, body);
      P._sizes(c, body);
    },
    close: function (c) { if (c.S.preview && c.S.preview.type === 'size') c.size.cancel(); }
  };

  /* ---------- Elements ---------- */
  var ICON_TOPICS = [['star', 'Popular'], ['arrow', 'Arrows'], ['heart', 'Love'], ['sun', 'Weather'], ['camera', 'Photo'], ['shopping', 'Shop'], ['message', 'Social'], ['coffee', 'Food'], ['plane', 'Travel'], ['chart', 'Business'], ['leaf', 'Nature'], ['music', 'Music']];
  var EMOJI_TOPICS = [['smiling face', 'Smileys'], ['heart', 'Hearts'], ['hand', 'Hands'], ['party', 'Party'], ['flower', 'Nature'], ['food', 'Food'], ['cat', 'Animals'], ['car', 'Travel'], ['star', 'Symbols'], ['fire', 'Hot']];
  var STICKERS = ['sale-ribbon', 'corner-ribbon', 'starburst', 'badge-new', 'stamp-approved', 'stamp-draft', 'stamp-confidential', 'stamp-paid', 'speech-round', 'speech-square', 'speech-thought', 'tape-strip', 'tape-diagonal', 'sparkles', 'sparkle', 'arrow-scribble', 'arrow-curved-hand', 'underline-scribble', 'circle-scribble', 'heart', 'heart-outline', 'crown', 'seal', 'price-tag', 'frame', 'frame-corners', 'blob', 'blob-rose', 'wave', 'wave-double', 'burst-rays', 'star', 'check-seal', 'banner-flag', 'label-pill', 'confetti', 'swoosh', 'highlighter', 'flourish', 'medal', 'bookmark', 'washi'];
  var MASKS = [['none', 'None'], ['ellipse', 'Circle'], ['rounded-rectangle', 'Rounded'], ['heart', 'Heart'], ['star', 'Star'], ['hexagon', 'Hexagon'], ['blob', 'Blob'], ['blob-2', 'Blob 2'], ['diamond', 'Diamond'], ['triangle', 'Triangle'], ['burst', 'Burst'], ['speech-round', 'Bubble'], ['cloud', 'Cloud'], ['octagon', 'Octagon'], ['pentagon', 'Pentagon'], ['half-circle', 'Arch']];
  function shapeThumb(c, sp, size) {
    var w = size, h = size;
    var open = c.isOpenShape(sp.id);
    var line = /line|arrow-line/.test(sp.id) && !/polyline/.test(sp.id);
    if (line) h = size * 0.3;
    var d = '';
    try { d = sp.path(w, h, {}); } catch (e) { d = ''; }
    var stroke = open || sp.id === 'ring';
    var vb = '0 0 ' + w + ' ' + h;
    return '<svg viewBox="' + vb + '" width="100%" height="100%" aria-hidden="true" style="overflow:visible"><path d="' + c.esc(d) + '" fill="' + (stroke && sp.id !== 'ring' ? 'none' : 'currentColor') + '" fill-rule="' + (sp.fillRule || 'nonzero') + '" stroke="' + (stroke ? 'currentColor' : 'none') + '" stroke-width="' + (stroke ? 3 : 0) + '" stroke-linecap="round"' + (sp.dash ? ' stroke-dasharray="' + sp.dash.join(' ') + '"' : '') + '/></svg>';
  }
  P.elements = {
    title: 'Elements', eyebrow: 'Shapes, graphics, stickers',
    render: function (c, body, o) {
      var tab = o.tab || 'all';
      var q = o.q || '';
      var bar = c.h('<div class="sx-sticky"></div>');
      body.appendChild(bar);
      searchBox(c, bar, 'Search icons, emoji, stickers', q, function (v) { c.S.panelOpts.q = v; c.S.panelOpts.tab = v ? 'search' : 'all'; draw(); });
      var tb = tabs(c, bar, [['all', 'All'], ['shapes', 'Shapes'], ['lines', 'Lines'], ['icons', 'Icons'], ['emoji', 'Emoji'], ['stickers', 'Stickers'], ['frames', 'Frames']], tab, function (t) { c.S.panelOpts.tab = t; c.S.panelOpts.q = ''; bar.querySelector('input').value = ''; tb.querySelectorAll('button').forEach(function (b, i) { b.setAttribute('aria-selected', ['all', 'shapes', 'lines', 'icons', 'emoji', 'stickers', 'frames'][i] === t); }); draw(); });
      tb.classList.add('is-scroll');
      var host = c.h('<div class="sx-el-host"></div>');
      body.appendChild(host);
      function draw() {
        host.innerHTML = '';
        var t = c.S.panelOpts.tab || 'all';
        var query = c.S.panelOpts.q || '';
        if (query) return searchAll(c, host, query);
        if (t === 'all') {
          recent(c, host);
          shapes(c, host, 8, 'shapes');
          lines(c, host, 4);
          iconTopic(c, host, 'star', 'Icons', 12, 'icons');
          stickers(c, host, 9, 'stickers');
          emojiTopic(c, host, 'smiling face', 'Emoji', 12, 'emoji');
          frames(c, host, 6, 'frames');
        } else if (t === 'shapes') shapes(c, host);
        else if (t === 'lines') lines(c, host);
        else if (t === 'icons') icons(c, host);
        else if (t === 'emoji') emojis(c, host);
        else if (t === 'stickers') stickers(c, host);
        else if (t === 'frames') frames(c, host);
      }
      draw();
    }
  };
  function sec(c, host, title, more) {
    var s = c.ui.section(title, more ? '<button type="button" class="sx-link">See all</button>' : '');
    if (more) s.querySelector('.sx-link').onclick = function () { c.openPanel('elements', { tab: more }); };
    host.appendChild(s);
    return s.querySelector('.sx-sec-body');
  }
  function tile(c, html, label, fn, drag) {
    var b = c.h('<button type="button" class="sx-tile" aria-label="' + c.esc(label) + '" title="' + c.esc(label) + '">' + html + '</button>');
    b.onclick = fn;
    if (drag) draggable(b, drag);
    return b;
  }
  function recent(c, host) {
    var list = c.lsGet('le-studio-recent-el', []);
    if (!list.length) return;
    var g = grid('sx-grid-6');
    var body = sec(c, host, 'Recently used');
    body.appendChild(g);
    list.slice(0, 12).forEach(function (it) {
      if (it.kind === 'shape') {
        var sp = c.shapeSpec(it.id);
        if (sp) g.appendChild(tile(c, shapeThumb(c, sp, 40), sp.name, function () { c.addShape(it.id); }, it));
      } else if (it.kind === 'svg') {
        var set = it.id.split(':')[0];
        var t = tile(c, '<img alt="" data-lazy>', it.id.split(':')[1], function () { addSvgSafe(c, it.id); }, it);
        g.appendChild(t);
        LE.assets.load(set).then(function () { try { t.querySelector('img').src = svgUrl(it.id); } catch (e) { t.remove(); } }).catch(function () { t.remove(); });
      }
    });
  }
  function addSvgSafe(c, id) {
    LE.assets.load(id.split(':')[0]).then(function () { c.addSvg(id); }).catch(function () { c.toast('Graphics are not available offline yet.'); });
  }
  function shapes(c, host, limit, more) {
    var body = sec(c, host, 'Shapes', more);
    var g = grid('sx-grid-4');
    var list = c.shapeList().filter(function (s) { return !c.isOpenShape(s.id) && !/^(arrow-line)$/.test(s.id); });
    (limit ? list.slice(0, limit) : list).forEach(function (sp) {
      g.appendChild(tile(c, shapeThumb(c, sp, 48), sp.name, function () { c.addShape(sp.id); }, { kind: 'shape', id: sp.id }));
    });
    body.appendChild(g);
  }
  function lines(c, host, limit) {
    var body = sec(c, host, 'Lines & arrows', limit ? 'lines' : null);
    var g = grid('sx-grid-4');
    var list = c.shapeList().filter(function (s) { return c.isOpenShape(s.id) || /arrow/.test(s.id); });
    (limit ? list.slice(0, limit) : list).forEach(function (sp) {
      g.appendChild(tile(c, shapeThumb(c, sp, 48), sp.name, function () { c.addShape(sp.id); }, { kind: 'shape', id: sp.id }));
    });
    body.appendChild(g);
  }
  function lazyGrid(c, g, ids, kind) {
    ids.forEach(function (id) {
      var t = tile(c, '<img alt="">', id.split(':')[1].replace(/-/g, ' '), function () { c.addSvg(id); }, { kind: 'svg', id: id });
      t.setAttribute('data-lazy', id);
      t.classList.add('is-' + kind);
      g.appendChild(t);
    });
    c.ui.lazy(g, function (n) {
      try { n.querySelector('img').src = svgUrl(n.getAttribute('data-lazy')); } catch (e) { n.remove(); }
    });
  }
  function loading(c, body) { var n = c.h('<div class="sx-loading">' + c.ic('sparkle') + 'Loading graphics…</div>'); body.appendChild(n); return n; }
  function iconTopic(c, host, q, title, limit, more) {
    var body = sec(c, host, title, more);
    var ld = loading(c, body);
    var set = c.lsGet('le-studio-iconset', 'lucide');
    if (set === 'withicons') set = 'lucide';
    LE.assets.load(set).then(function () {
      ld.remove();
      var g = grid('sx-grid-6');
      lazyGrid(c, g, LE.assets.search(q, { set: set, limit: limit || 60 }).map(function (r) { return r.id; }), 'icon');
      body.appendChild(g);
    }).catch(function () { ld.textContent = 'Icons are not available offline yet.'; });
  }
  function icons(c, host) {
    var styled = !!P._withIcons;
    var set = c.lsGet('le-studio-iconset', styled ? 'withicons' : 'lucide');
    if (set === 'withicons' && !styled) set = 'lucide';
    host.appendChild(c.ui.seg((styled ? [['withicons', '34 styles']] : []).concat([['lucide', 'Lucide'], ['phosphor', 'Phosphor']]), set, function (v) { c.lsSet('le-studio-iconset', v); c.renderPanel(true); }, 'sx-seg-sm sx-seg-fill'));
    if (set === 'withicons') return P._withIcons(c, host);
    var topic = c.S.panelOpts.topic || 'star';
    var chips = c.h('<div class="sx-chips is-scroll"></div>');
    ICON_TOPICS.forEach(function (t) {
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (t[0] === topic) + '">' + c.esc(t[1]) + '</button>');
      b.onclick = function () { c.S.panelOpts.topic = t[0]; c.renderPanel(true); };
      chips.appendChild(b);
    });
    host.appendChild(chips);
    var body = c.h('<div></div>');
    host.appendChild(body);
    var ld = loading(c, body);
    LE.assets.load(set).then(function () {
      ld.remove();
      var g = grid('sx-grid-6');
      lazyGrid(c, g, LE.assets.search(topic, { set: set, limit: 96 }).map(function (r) { return r.id; }), 'icon');
      body.appendChild(g);
      body.appendChild(note(c, 'Tip: search for anything — 3 900 icons are on this device. Icons take any color.'));
    }).catch(function () { ld.textContent = 'Icons are not available offline yet.'; });
  }
  function emojiTopic(c, host, q, title, limit, more) {
    var body = sec(c, host, title, more);
    var ld = loading(c, body);
    LE.assets.load('emoji').then(function () {
      ld.remove();
      var g = grid('sx-grid-6');
      lazyGrid(c, g, LE.assets.search(q, { set: 'emoji', limit: limit || 60 }).map(function (r) { return r.id; }), 'emoji');
      body.appendChild(g);
    }).catch(function () { ld.textContent = 'Emoji are not available offline yet.'; });
  }
  function emojis(c, host) {
    var topic = c.S.panelOpts.topic || EMOJI_TOPICS[0][0];
    var chips = c.h('<div class="sx-chips is-scroll"></div>');
    EMOJI_TOPICS.forEach(function (t) {
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (t[0] === topic) + '">' + c.esc(t[1]) + '</button>');
      b.onclick = function () { c.S.panelOpts.topic = t[0]; c.renderPanel(true); };
      chips.appendChild(b);
    });
    host.appendChild(chips);
    emojiTopic(c, host, topic, 'Emoji', 96);
  }
  function stickers(c, host, limit, more) {
    var body = sec(c, host, 'Stickers', more);
    var ld = loading(c, body);
    LE.assets.load('stickers').then(function () {
      ld.remove();
      var g = grid('sx-grid-3');
      lazyGrid(c, g, (limit ? STICKERS.slice(0, limit) : STICKERS).map(function (n) { return 'stickers:' + n; }), 'sticker');
      body.appendChild(g);
    }).catch(function () { ld.textContent = 'Stickers are not available offline yet.'; });
  }
  function frames(c, host, limit, more) {
    var body = sec(c, host, 'Photo frames', more);
    var g = grid('sx-grid-4');
    MASKS.slice(1, limit ? limit + 1 : undefined).forEach(function (m) {
      var sp = c.shapeSpec(m[0]);
      g.appendChild(tile(c, sp ? '<span class="sx-frame-art">' + shapeThumb(c, sp, 48) + '</span>' : c.ic('frame'), m[1] + ' frame', function () { c.applyMask(m[0]); }));
    });
    body.appendChild(g);
    if (!limit) body.appendChild(note(c, 'Select a photo, then pick a frame. With nothing selected, your latest upload is placed in the frame.'));
    if (!limit && P._grids) P._grids(c, host);
  }
  function searchAll(c, host, q) {
    var ld = loading(c, host);
    Promise.all(['lucide', 'phosphor', 'emoji', 'stickers'].map(function (s) { return LE.assets.load(s).catch(function () {}); })).then(function () {
      ld.remove();
      var lower = q.toLowerCase();
      var sh = c.shapeList().filter(function (s) { return s.name.toLowerCase().indexOf(lower) >= 0 || s.id.indexOf(lower) >= 0; });
      if (sh.length) {
        var gs = grid('sx-grid-4');
        sh.forEach(function (sp) { gs.appendChild(tile(c, shapeThumb(c, sp, 48), sp.name, function () { c.addShape(sp.id); }, { kind: 'shape', id: sp.id })); });
        sec(c, host, 'Shapes').appendChild(gs);
      }
      [['stickers', 'Stickers', 'sx-grid-3', 'sticker'], ['emoji', 'Emoji', 'sx-grid-6', 'emoji'], ['lucide', 'Icons · Lucide', 'sx-grid-6', 'icon'], ['phosphor', 'Icons · Phosphor', 'sx-grid-6', 'icon']].forEach(function (s) {
        var res = LE.assets.search(q, { set: s[0], limit: 48 });
        if (!res.length) return;
        var g = grid(s[2]);
        lazyGrid(c, g, res.map(function (r) { return r.id; }), s[3]);
        sec(c, host, s[1]).appendChild(g);
      });
      if (P._withIconsSearch) P._withIconsSearch(c, host, q);
      else if (!host.children.length) host.appendChild(note(c, 'Nothing found for “' + q + '”. Try a simpler word like heart, star or arrow.'));
    });
  }

  /* ---------- Text ---------- */
  P.text = {
    title: 'Text', eyebrow: 'Type & font combinations',
    render: function (c, body) {
      var add = c.h('<div class="sx-text-add"></div>');
      [['heading', 'Add a heading', 'sx-ta-h'], ['subheading', 'Add a subheading', 'sx-ta-s'], ['body', 'Add a little bit of body text', 'sx-ta-b']].forEach(function (t) {
        var b = c.h('<button type="button" class="sx-ta ' + t[2] + '">' + c.esc(t[1]) + '</button>');
        b.onclick = function () {
          var id = c.addText(Object.assign({}, TEXT[t[0]]));
          setTimeout(function () { c.startTextEdit(id); }, 0);
        };
        draggable(b, { kind: 'text', id: t[0] });
        add.appendChild(b);
      });
      body.appendChild(add);
      var s = c.ui.section('Font combinations');
      var g = grid('sx-grid-2');
      COMBOS.forEach(function (cb) {
        var b = c.h('<button type="button" class="sx-combo' + (cb.dark ? ' is-dark' : '') + '" aria-label="' + c.esc(cb.name) + '"><span class="sx-combo-art">' + cb.preview + '</span><small>' + c.esc(cb.name) + '</small></button>');
        b.onclick = function () { addCombo(c, cb); };
        draggable(b, { kind: 'text', id: cb.id });
        g.appendChild(b);
        cb.layers.forEach(function (l) { if (LE.fonts && LE.fonts.ensurePreview) LE.fonts.ensurePreview(l.font).catch(function () {}); });
      });
      s.querySelector('.sx-sec-body').appendChild(g);
      body.appendChild(s);
      var m = c.ui.section('Meme captions');
      var mb = c.h('<button type="button" class="sx-combo sx-meme-btn"><span class="sx-combo-art"><b style="font-family:Anton;font-size:22px;color:#fff;-webkit-text-stroke:1px #000">TOP TEXT</b><b style="font-family:Anton;font-size:22px;color:#fff;-webkit-text-stroke:1px #000">BOTTOM TEXT</b></span><small>Classic meme</small></button>');
      mb.onclick = function () { c.openPanel('apps', { app: 'meme', back: 'text' }); };
      m.querySelector('.sx-sec-body').appendChild(mb);
      body.appendChild(m);
      body.appendChild(note(c, (c.say ? c.say('Double-click any text on the canvas to edit it in place. Text stays editable forever — it is only flattened when you download.', 'Double-tap any text on the canvas to type. Text stays editable forever — it is only flattened when you download.') : 'Double-click any text on the canvas to edit it in place. Text stays editable forever — it is only flattened when you download.')));
    }
  };

  /* ---------- Fonts ---------- */
  P.fonts = { title: 'Fonts', eyebrow: 'All fonts live on this device' };   /* le-studio-fonts.js */

  /* ---------- Uploads ---------- */
  P.uploads = {
    title: 'Uploads', eyebrow: 'Stored privately on this device',
    render: function (c, body, o) {
      o = o || {};
      var tab = o.tab === 'stock' ? 'stock' : 'device';
      tabs(c, body, [['device', 'This device'], ['stock', 'Stock photos']], tab, function (t) { c.openPanel('uploads', { tab: t }); });
      if (tab === 'stock') {
        var stockHost = document.createElement('div');
        body.appendChild(stockHost);
        if (window.LEStudioCollage && typeof LEStudioCollage.renderStock === 'function') {
          try { LEStudioCollage.renderStock(c, stockHost, { mode: 'add' }); }
          catch (err) { stockHost.appendChild(note(c, 'Stock photos could not open.')); }
        } else stockHost.appendChild(note(c, 'Stock photos are not available yet.'));
        return;
      }
      var top = c.h('<div class="sx-upload-cta"><button type="button" class="btn btn-gold sx-block">' + c.ic('uploads') + '<span>Upload photos</span></button><small>' + c.esc((c.say ? c.say('Drag photos onto the canvas, or paste with Ctrl V. They never leave this device.', 'Choose photos from this phone. They never leave this device.') : 'Drag photos onto the canvas, or paste with Ctrl V. They never leave this device.')) + '</small></div>');
      top.querySelector('button').onclick = function () { c.pickFiles(c.S.project ? 'add' : 'add'); };
      body.appendChild(top);
      var mine = c.ui.section('In this design');
      var mg = grid('sx-grid-3 sx-thumbs');
      mine.querySelector('.sx-sec-body').appendChild(mg);
      body.appendChild(mine);
      var all = c.ui.section('All uploads on this device');
      var ag = grid('sx-grid-3 sx-thumbs');
      all.querySelector('.sx-sec-body').appendChild(ag);
      body.appendChild(all);
      var inDesign = c.S.project ? Object.keys(c.S.project.assets || {}).filter(function (id) { return !/^background-/.test((c.S.project.assets[id] || {}).name || ''); }) : [];
      if (!inDesign.length) mine.hidden = true;
      function thumb(id, name) {
        var t = c.h('<button type="button" class="sx-thumb" aria-label="Add ' + c.esc(name || 'photo') + ' to the design" title="' + c.esc(name || '') + '"><img alt=""></button>');
        c.thumbUrl(id).then(function (u) { if (u) t.querySelector('img').src = u; });
        t.onclick = function () {
          var file = function (blob) { return new File([blob], name || 'photo', { type: blob.type || 'image/png' }); };
          var go;
          if (!c.S.project) go = LE.project.getAsset(id).then(function (blob) { return c.newFromPhoto(file(blob)); });
          else go = (c.mem[id] ? Promise.resolve() : LE.project.getAsset(id).then(function (blob) { return c.ingest(file(blob)); })).then(function () { c.placeImage(id); });
          go.catch(function (err) { c.toast(err.message || 'Could not add that photo.'); });
        };
        draggable(t, { asset: id });
        return t;
      }
      inDesign.forEach(function (id) { mg.appendChild(thumb(id, (c.S.project.assets[id] || {}).name)); });
      LE.project.assets().then(function (list) {
        list = list.filter(function (a) { return inDesign.indexOf(a.id) < 0 && !/^background-removal-mask/.test(a.name || ''); });
        if (!list.length) { all.querySelector('.sx-sec-body').appendChild(note(c, inDesign.length ? 'Photos from your other designs appear here.' : 'No uploads yet.')); return; }
        list.slice(0, 60).forEach(function (a) { ag.appendChild(thumb(a.id, a.name)); });
      });
    }
  };

  /* ---------- Draw ---------- */
  P.draw = {
    title: 'Draw', eyebrow: 'Pen, marker, highlighter',
    render: function (c, body) {
      if (needProject(c, body)) return;
      var d = c.S.draw;
      if (!/^(pen|marker|highlighter|eraser)$/.test(c.scene.tool())) c.setDraw(d.mode || 'pen');
      var modes = c.h('<div class="sx-draw-modes"></div>');
      [['pen', 'Pen', 'pen'], ['marker', 'Marker', 'marker'], ['highlighter', 'Highlighter', 'highlighter'], ['eraser', 'Eraser', 'eraser']].forEach(function (m) {
        var b = c.h('<button type="button" class="sx-draw-mode" aria-pressed="' + (c.scene.tool() === m[0]) + '">' + c.ic(m[2]) + '<span>' + m[1] + '</span></button>');
        b.onclick = function () { c.setDraw(m[0]); c.renderToolbar(); c.renderPanel(true); };
        modes.appendChild(b);
      });
      body.appendChild(modes);
      var cs = c.ui.section('Color');
      var row = c.h('<div class="sx-swatches"></div>');
      c.PALETTE.slice(0, 13).forEach(function (col) {
        var b = c.h('<button type="button" class="sx-chip-color" aria-label="' + col + '" aria-pressed="' + (d.color.toLowerCase() === col.toLowerCase()) + '"></button>');
        b.style.background = col;
        b.onclick = function () { d.color = col; c.lsSet('le-studio-draw', d); c.renderPanel(true); c.renderToolbar(); };
        row.appendChild(b);
      });
      var more = c.h('<button type="button" class="sx-chip-color is-more" aria-label="More colors">' + c.ic('plus') + '</button>');
      more.onclick = function () { c.colorPop(more, { value: d.color, title: 'Pen color', onChange: function (v) { d.color = v; c.lsSet('le-studio-draw', d); c.renderToolbar(); } }); };
      row.appendChild(more);
      cs.querySelector('.sx-sec-body').appendChild(row);
      body.appendChild(cs);
      var ss = c.ui.section('Stroke');
      ss.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Size', min: 1, max: 60, value: d.width, reset: 6, onInput: function (v) { d.width = v; c.lsSet('le-studio-draw', d); } }));
      ss.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Smoothing', min: 0, max: 100, value: Math.round(d.smoothing * 100), reset: 55, onInput: function (v) { d.smoothing = v / 100; c.lsSet('le-studio-draw', d); } }));
      body.appendChild(ss);
      body.appendChild(btn(c, 'Done drawing', 'check', 'btn btn-gold sx-block', function () { c.scene.setTool('select'); c.closePanel(); }));
      body.appendChild(note(c, 'Each stroke is its own layer — move, recolor or delete it later. The eraser removes whole strokes.'));
    }
  };

  /* ---------- Adjust ---------- */
  function noImage(c, body, what) {
    body.appendChild(c.ui.empty('Select a photo', 'Tap a photo on the canvas to ' + what + '.', c.S.project ? [{ label: 'Add a photo', gold: true, fn: function () { c.pickFiles('add'); } }] : [{ label: 'Open photo', gold: true, fn: function () { c.pickFiles('add'); } }, { label: 'Try sample', fn: function () { c.useSample(); } }]));
  }
  P.adjust = {
    title: 'Adjust', eyebrow: 'Live photo edits', select: true,
    render: function (c, body, o) {
      var img = c.targetImage();
      if (!img) return noImage(c, body, 'adjust it');
      var id = img.id;
      if (o.crop && c.scene.tool() !== 'crop') { o.crop = false; c.startCrop(id); }
      var quick = c.h('<div class="sx-quick"></div>');
      [['crop', 'Crop', function () { c.startCrop(id); }], ['rotate', 'Rotate', function () { c.patch(id, { rotation: ((c.L(id).rotation || 0) + 90) % 360 }); }], ['flip', 'Flip', function () { c.patch(id, { flipX: !c.L(id).flipX }); }], ['wand', 'Auto', function () { auto(c, id); }], ['compare', 'Compare', null]].forEach(function (q) {
        var b = c.h('<button type="button" class="sx-quick-btn"' + (q[0] === 'compare' ? ' data-cmd="compareHold"' : '') + '>' + c.ic(q[0]) + '<span>' + q[1] + (q[0] === 'compare' ? ' (hold)' : '') + '</span></button>');
        if (q[2]) b.onclick = q[2];
        quick.appendChild(b);
      });
      body.appendChild(quick);
      var a = img.adjust || {};
      var sliders = [];
      c.ADJ.forEach(function (grp) {
        var s = c.ui.section(grp[1]);
        grp[2].forEach(function (def) {
          var mul = def[5] || 1;
          var node = c.ui.slider({ label: def[1], min: def[2], max: def[3], step: def[4], mul: mul, value: a[def[0]] || 0, onInput: function (v, key) {
            var cur = c.L(id);
            if (!cur) return;
            var next = Object.assign({}, cur.adjust || {});
            next[def[0]] = v;
            c.patch(id, { adjust: next }, key);
          } });
          node.dataset.key = def[0];
          sliders.push(node);
          s.querySelector('.sx-sec-body').appendChild(node);
        });
        body.appendChild(s);
      });
      var row = c.h('<div class="sx-row-between"></div>');
      row.appendChild(btn(c, 'Reset adjustments', 'reset', 'btn btn-ghost btn-sm', function () {
        /* Patches merge, so an empty object would change nothing: clear each key that is set. */
        var cur = (c.scene.layer(id) || {}).adjust || {}, cleared = {};
        Object.keys(cur).forEach(function (k) { cleared[k] = null; });
        c.patch(id, { adjust: cleared }); c.renderPanel(true);
      }));
      row.appendChild(btn(c, 'Filters', 'filters', 'btn btn-ghost btn-sm', function () { c.openPanel('filters'); }));
      body.appendChild(row);
      body.appendChild(note(c, (c.say ? c.say('Edits are live and non-destructive. Double-click a slider label to reset it.', 'Edits are live and non-destructive. Double-tap a slider label to reset it.') : 'Edits are live and non-destructive. Double-click a slider label to reset it.')));
    }
  };
  function auto(c, id) {
    var l = c.L(id);
    var m = c.mem[l.src];
    if (!m) return;
    var small = LE.fit(m.canvas, 160);
    var hst = LE.histogram(small);
    var total = 0, sum = 0, sat = 0;
    for (var i = 0; i < 256; i++) { var n = hst.r[i] + hst.g[i] + hst.b[i]; total += n; sum += n * i; }
    var mean = sum / Math.max(1, total);
    var data = small.getContext('2d').getImageData(0, 0, small.width, small.height).data;
    for (var j = 0; j < data.length; j += 16) { var mx = Math.max(data[j], data[j + 1], data[j + 2]), mn = Math.min(data[j], data[j + 1], data[j + 2]); sat += mx ? (mx - mn) / mx : 0; }
    sat /= Math.max(1, data.length / 16);
    var next = Object.assign({}, l.adjust || {}, {
      exposure: Math.round(c.clamp((118 - mean) / 160, -0.5, 0.5) * 100) / 100,
      contrast: 10, shadows: mean < 110 ? 14 : 6, highlights: mean > 150 ? -16 : -6,
      vibrance: sat < 0.35 ? 18 : 8, sharpness: 12
    });
    c.patch(id, { adjust: next });
    c.renderPanel(true);
    c.toast('Auto-enhanced — fine-tune with the sliders');
  }

  /* ---------- Filters ---------- */
  var FILTER_NAMES = { vivid: 'Vivid', warm: 'Warm', cool: 'Cool', cinematic: 'Cinematic', mono: 'Mono', film: 'Film', fade: 'Fade', golden: 'Golden', noir: 'Noir', portrait: 'Portrait', vintage: 'Vintage' };
  var thumbCache = {};
  P.filters = {
    title: 'Filters', eyebrow: 'Looks with live thumbnails', select: true,
    render: function (c, body) {
      var img = c.targetImage();
      if (!img) return noImage(c, body, 'add a filter');
      var id = img.id;
      var f = img.filter || null;
      var inten = c.ui.slider({ label: 'Intensity', min: 0, max: 100, value: f ? (f.intensity == null ? 100 : f.intensity) : 100, reset: 100, fmt: function (v) { return v + '%'; }, onInput: function (v, key) {
        var cur = c.L(id);
        if (cur && cur.filter) c.patch(id, { filter: { name: cur.filter.name, intensity: v } }, key);
      } });
      var g = grid('sx-grid-3 sx-filters');
      var m = c.mem[img.src];
      var src = null;
      if (m) {
        var cr = img.crop || { x: 0, y: 0, w: 1, h: 1 };
        var sw = m.canvas.width * cr.w, sh = m.canvas.height * cr.h;
        var s = Math.min(1, 220 / Math.max(sw, sh));
        src = document.createElement('canvas');
        src.width = Math.max(1, Math.round(sw * s));
        src.height = Math.max(1, Math.round(sh * s));
        src.getContext('2d').drawImage(m.canvas, m.canvas.width * cr.x, m.canvas.height * cr.y, sw, sh, 0, 0, src.width, src.height);
      }
      [['', 'Original']].concat(Object.keys(LE.presets.filters).map(function (n) { return [n, FILTER_NAMES[n] || n]; })).forEach(function (fl) {
        var on = (f && f.name) === fl[0] || (!f && !fl[0]);
        var b = c.h('<button type="button" class="sx-filter" aria-pressed="' + on + '" data-lazy="' + fl[0] + '"><span class="sx-filter-art"></span><small>' + c.esc(fl[1]) + '</small></button>');
        b.onclick = function () {
          var cur = c.L(id);
          var it = cur && cur.filter ? (cur.filter.intensity == null ? 100 : cur.filter.intensity) : 100;
          c.patch(id, { filter: fl[0] ? { name: fl[0], intensity: it } : null });
          g.querySelectorAll('.sx-filter').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        };
        g.appendChild(b);
      });
      body.appendChild(inten);
      body.appendChild(g);
      var key = img.src + '|' + JSON.stringify(img.crop || null);
      c.ui.lazy(g, function (n) {
        var name = n.getAttribute('data-lazy');
        var art = n.querySelector('.sx-filter-art');
        if (!src) return;
        var ck = key + '|' + name;
        function show(url) { art.style.backgroundImage = 'url(' + url + ')'; }
        if (thumbCache[ck]) { show(thumbCache[ck]); return; }
        if (!name) { thumbCache[ck] = src.toDataURL('image/jpeg', 0.8); show(thumbCache[ck]); return; }
        LE.applySteps(src, [{ operation: 'filter', parameters: { name: name, intensity: 100 } }]).then(function (r) {
          thumbCache[ck] = r.canvas.toDataURL('image/jpeg', 0.8);
          show(thumbCache[ck]);
        }).catch(function () {});
      });
      body.appendChild(note(c, 'Filters stack with your adjustments and can be changed or removed at any time.'));
    }
  };

  /* ---------- Effects ---------- */
  var BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'], ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];
  P.effects = {
    title: 'Effects', eyebrow: 'Shadow, outline, shape', select: true,
    render: function (c, body) {
      var ids = c.sel();
      if (!ids.length) { body.appendChild(c.ui.empty('Select something', 'Effects apply to the selected text, photo, shape or sticker.')); return; }
      var l = c.L(ids[0]);
      var s1 = c.ui.section('Shadow');
      var g = grid('sx-grid-3');
      c.SHADOWS.forEach(function (sh) {
        var on = JSON.stringify(l.shadow || null) === JSON.stringify(sh[2]);
        var b = c.h('<button type="button" class="sx-fx" aria-pressed="' + on + '"><span class="sx-fx-art sx-fx-' + sh[0] + '"><i>Aa</i></span><small>' + sh[1] + '</small></button>');
        b.onclick = function () { c.patch(ids, { shadow: sh[2] ? Object.assign({}, sh[2], { blur: sh[2].blur * k(c), x: sh[2].x * k(c), y: sh[2].y * k(c) }) : null }); c.renderPanel(true); };
        g.appendChild(b);
      });
      s1.querySelector('.sx-sec-body').appendChild(g);
      if (l.shadow) {
        var sb = s1.querySelector('.sx-sec-body');
        sb.appendChild(c.ui.swatchBtn(l.shadow.color, 'Shadow color', function (b) {
          c.colorPop(b, { value: l.shadow.color, title: 'Shadow color', onChange: function (v, key) { var cur = c.L(ids[0]); c.patch(ids, { shadow: Object.assign({}, cur.shadow, { color: v }) }, key); } });
        }));
        [['blur', 'Blur', 0, 120], ['x', 'Offset X', -100, 100], ['y', 'Offset Y', -100, 100]].forEach(function (d) {
          sb.appendChild(c.ui.slider({ label: d[1], min: d[2], max: d[3], value: Math.round(l.shadow[d[0]] / k(c)), onInput: function (v, key) {
            var cur = c.L(ids[0]);
            var next = Object.assign({}, cur.shadow);
            next[d[0]] = v * k(c);
            c.patch(ids, { shadow: next }, key);
          } }));
        });
      }
      body.appendChild(s1);
      if (l.type === 'text') textEffects(c, body, ids, l);
      if (l.type === 'image') imageEffects(c, body, ids, l);
      var s3 = c.ui.section('Layer');
      var sb3 = s3.querySelector('.sx-sec-body');
      sb3.appendChild(c.ui.slider({ label: 'Transparency', min: 0, max: 100, value: Math.round((l.opacity == null ? 1 : l.opacity) * 100), reset: 100, fmt: function (v) { return v + '%'; }, onInput: function (v, key) { c.patch(ids, { opacity: v / 100 }, key); } }));
      var sel = c.h('<label class="sx-select"><span>Blend</span><select class="sx-input"></select></label>');
      BLENDS.forEach(function (b) { var o = document.createElement('option'); o.value = b[0]; o.textContent = b[1]; if ((l.blend || 'source-over') === b[0]) o.selected = true; sel.querySelector('select').appendChild(o); });
      sel.querySelector('select').onchange = function (e) { c.patch(ids, { blend: e.target.value }); };
      sb3.appendChild(sel);
      sb3.appendChild(c.ui.slider({ label: 'Rotation', min: -180, max: 180, value: Math.round(((l.rotation || 0) + 540) % 360 - 180), fmt: function (v) { return v + '°'; }, onInput: function (v, key) { c.patch(ids, { rotation: (v + 360) % 360 }, key); } }));
      body.appendChild(s3);
    }
  };
  function textEffects(c, body, ids, l) {
    var s = c.ui.section('Outline');
    var sb = s.querySelector('.sx-sec-body');
    var st = l.stroke || { width: 0, color: '#17131F' };
    sb.appendChild(c.ui.slider({ label: 'Thickness', min: 0, max: 40, value: Math.round((st.width || 0) / k(c)), onInput: function (v, key) {
      var cur = c.L(ids[0]);
      var next = Object.assign({ color: '#17131F' }, cur.stroke || {}, { width: v * k(c) });
      c.patch(ids, { stroke: v ? next : null }, key);
    } }));
    sb.appendChild(c.ui.swatchBtn(st.color, 'Outline color', function (b) {
      c.colorPop(b, { value: st.color, title: 'Outline color', onChange: function (v, key) { var cur = c.L(ids[0]); c.patch(ids, { stroke: Object.assign({ width: 3 * k(c) }, cur.stroke || {}, { color: v }) }, key); } });
    }));
    body.appendChild(s);
    var s2 = c.ui.section('Background');
    var b2 = s2.querySelector('.sx-sec-body');
    var bg = l.background;
    b2.appendChild(c.ui.toggle('Highlight behind text', !!bg, function (on) { c.patch(ids, { background: on ? { color: '#F2D594', radius: 12 * k(c), padding: 18 * k(c) } : null }); c.renderPanel(true); }));
    if (bg) {
      b2.appendChild(c.ui.swatchBtn(bg.color, 'Highlight color', function (b) {
        c.colorPop(b, { value: bg.color, title: 'Highlight color', onChange: function (v, key) { var cur = c.L(ids[0]); c.patch(ids, { background: Object.assign({}, cur.background, { color: v }) }, key); } });
      }));
      b2.appendChild(c.ui.slider({ label: 'Roundness', min: 0, max: 100, value: bg.radius >= 999 ? 100 : Math.round(bg.radius / k(c) / 0.6), onInput: function (v, key) { var cur = c.L(ids[0]); c.patch(ids, { background: Object.assign({}, cur.background, { radius: v >= 100 ? 999 : v * 0.6 * k(c) }) }, key); } }));
      b2.appendChild(c.ui.slider({ label: 'Spread', min: 0, max: 80, value: Math.round(bg.padding / k(c)), onInput: function (v, key) { var cur = c.L(ids[0]); c.patch(ids, { background: Object.assign({}, cur.background, { padding: v * k(c) }) }, key); } }));
    }
    body.appendChild(s2);
    var s3 = c.ui.section('Shape');
    s3.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Curve', min: -100, max: 100, value: Math.round((l.curve || 0) / 4), fmt: function (v) { return v; }, onInput: function (v, key) {
      var cur = c.L(ids[0]);
      var p = { curve: v * 4 };
      if (v && cur.h < cur.w * 0.6) { p.h = cur.w * 0.8; p.y = cur.y - (p.h - cur.h) / 2; }
      c.patch(ids, p, key);
    } }));
    body.appendChild(s3);
  }
  function imageEffects(c, body, ids, l) {
    var s = c.ui.section('Corners & border');
    var sb = s.querySelector('.sx-sec-body');
    var m = Math.min(l.w, l.h);
    sb.appendChild(c.ui.slider({ label: 'Corner radius', min: 0, max: 50, value: Math.round((l.radius || 0) / m * 100), fmt: function (v) { return v + '%'; }, onInput: function (v, key) { var cur = c.L(ids[0]); c.patch(ids, { radius: v / 100 * Math.min(cur.w, cur.h) }, key); } }));
    var bd = l.border || { width: 0, color: '#FFFFFF' };
    sb.appendChild(c.ui.slider({ label: 'Border', min: 0, max: 60, value: Math.round((bd.width || 0) / k(c)), onInput: function (v, key) { var cur = c.L(ids[0]); c.patch(ids, { border: v ? Object.assign({ color: '#FFFFFF' }, cur.border || {}, { width: v * k(c) }) : null }, key); } }));
    sb.appendChild(c.ui.swatchBtn(bd.color, 'Border color', function (b) {
      c.colorPop(b, { value: bd.color, title: 'Border color', onChange: function (v, key) { var cur = c.L(ids[0]); c.patch(ids, { border: Object.assign({ width: 8 * k(c) }, cur.border || {}, { color: v }) }, key); } });
    }));
    body.appendChild(s);
    var s2 = c.ui.section('Frame shape');
    var g = grid('sx-grid-4');
    MASKS.forEach(function (mk) {
      var sp = c.shapeSpec(mk[0]);
      var b = c.h('<button type="button" class="sx-tile" aria-pressed="' + ((l.mask || 'none') === mk[0]) + '" aria-label="' + mk[1] + '" title="' + mk[1] + '">' + (sp ? '<span class="sx-frame-art">' + shapeThumb(c, sp, 40) + '</span>' : c.ic('x')) + '</button>');
      b.onclick = function () { c.patch(ids, { mask: mk[0] }); c.renderPanel(true); };
      g.appendChild(b);
    });
    s2.querySelector('.sx-sec-body').appendChild(g);
    body.appendChild(s2);
  }

  /* ---------- Edit (type-specific properties) ---------- */
  P.edit = {
    title: function (c) { var l = c.one(); return l ? ({ shape: 'Edit shape', svg: 'Edit graphic', path: 'Edit drawing', text: 'Edit text', image: 'Edit photo', group: 'Group' })[l.type] || 'Edit' : 'Edit'; }, eyebrow: 'Properties', select: true,
    render: function (c, body) {
      var l = c.one();
      if (!l) { body.appendChild(c.ui.empty('Select one item', 'Pick a shape, sticker, drawing or text to edit its properties.')); return; }
      var ids = [l.id];
      if (l.type === 'shape') {
        var s = c.ui.section('Fill');
        var sb = s.querySelector('.sx-sec-body');
        var fill = l.fill || { type: 'solid', color: '#7457F0' };
        sb.appendChild(c.ui.seg([['solid', 'Solid'], ['linear', 'Linear'], ['radial', 'Radial'], ['none', 'None']], fill.type, function (t) {
          var cur = c.L(l.id).fill || {};
          var cols = cur.colors && cur.colors.length > 1 ? cur.colors : [cur.color || '#7457F0', '#E0668E'];
          c.patch(ids, { fill: t === 'solid' ? { type: 'solid', color: cur.color || cols[0] } : t === 'none' ? { type: 'none' } : { type: t, colors: cols, angle: cur.angle || 45 } });
          c.renderPanel(true);
        }, 'sx-seg-sm'));
        if (fill.type === 'solid') sb.appendChild(c.ui.swatchBtn(fill.color, 'Fill color', function (b) { c.colorPop(b, { value: fill.color, title: 'Fill', onChange: function (v, key) { c.patch(ids, { fill: { type: 'solid', color: v } }, key); } }); }));
        else if (fill.type === 'linear' || fill.type === 'radial') {
          var stops = c.h('<div class="sx-stops"></div>');
          (fill.colors || []).forEach(function (col, i) {
            stops.appendChild(c.ui.swatchBtn(col, 'Stop ' + (i + 1), function (b) { c.colorPop(b, { value: col, title: 'Gradient stop', onChange: function (v, key) { var cur = c.L(l.id).fill; var cols = cur.colors.slice(); cols[i] = v; c.patch(ids, { fill: Object.assign({}, cur, { colors: cols }) }, key); } }); }));
          });
          var add = c.h('<button type="button" class="sx-iconbtn" aria-label="Add color stop">' + c.ic('plus') + '</button>');
          add.onclick = function () { var cur = c.L(l.id).fill; if (cur.colors.length >= 5) return; c.patch(ids, { fill: Object.assign({}, cur, { colors: cur.colors.concat(['#F2D594']) }) }); c.renderPanel(true); };
          stops.appendChild(add);
          sb.appendChild(stops);
          if (fill.type === 'linear') sb.appendChild(c.ui.slider({ label: 'Angle', min: 0, max: 360, value: fill.angle || 0, fmt: function (v) { return v + '°'; }, onInput: function (v, key) { var cur = c.L(l.id).fill; c.patch(ids, { fill: Object.assign({}, cur, { angle: v }) }, key); } }));
          var pre = c.h('<div class="sx-swatches"></div>');
          c.GRADIENTS.forEach(function (g) {
            var b = c.h('<button type="button" class="sx-chip-color" aria-label="Gradient"></button>');
            b.style.background = 'linear-gradient(135deg,' + g.join(',') + ')';
            b.onclick = function () { var cur = c.L(l.id).fill; c.patch(ids, { fill: { type: cur.type, colors: g.slice(), angle: cur.angle || 45 } }); c.renderPanel(true); };
            pre.appendChild(b);
          });
          sb.appendChild(pre);
        }
        body.appendChild(s);
        var s2 = c.ui.section('Border');
        var st = l.stroke || { width: 0, color: '#17131F' };
        var b2 = s2.querySelector('.sx-sec-body');
        b2.appendChild(c.ui.slider({ label: 'Weight', min: 0, max: 80, value: Math.round(st.width || 0), onInput: function (v, key) { var cur = c.L(l.id).stroke || { color: '#17131F' }; c.patch(ids, { stroke: v ? Object.assign({}, cur, { width: v }) : (c.isOpenShape(l.shape) ? Object.assign({}, cur, { width: 1 }) : null) }, key); } }));
        b2.appendChild(c.ui.swatchBtn(st.color, 'Border color', function (b) { c.colorPop(b, { value: st.color, title: 'Border color', onChange: function (v, key) { var cur = c.L(l.id).stroke || { width: 4 }; c.patch(ids, { stroke: Object.assign({}, cur, { color: v, width: cur.width || 4 }) }, key); } }); }));
        b2.appendChild(c.ui.seg([['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted']], !st.dash ? 'solid' : st.dash[0] < 1 ? 'dot' : 'dash', function (v) {
          var cur = c.L(l.id).stroke || { color: '#17131F', width: 4 };
          var w = cur.width || 4;
          c.patch(ids, { stroke: Object.assign({}, cur, { width: w, cap: v === 'dot' ? 'round' : cur.cap, dash: v === 'solid' ? null : v === 'dash' ? [w * 3, w * 2] : [0.01, w * 2] }) });
        }, 'sx-seg-sm'));
        body.appendChild(s2);
        var sp = c.shapeSpec(l.shape);
        var keys = sp ? Object.keys(sp.editable || {}).filter(function (kk) { return typeof sp.editable[kk].default === 'number'; }) : [];
        if (keys.length || /rect/.test(l.shape)) {
          var s3 = c.ui.section('Shape');
          keys.forEach(function (kk) {
            var e = sp.editable[kk];
            var val = l.params && l.params[kk] != null ? l.params[kk] : e.default;
            var span = e.max - e.min;
            var step = span <= 2 ? 0.01 : 1;
            s3.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: kk.replace(/([A-Z])/g, ' $1').replace(/^./, function (x) { return x.toUpperCase(); }), min: e.min, max: e.max, step: step, value: val, reset: e.default, onInput: function (v, key) { var cur = c.L(l.id); var p = Object.assign({}, cur.params || {}); p[kk] = v; c.patch(ids, { params: p }, key); } }));
          });
          if (l.shape === 'rectangle' || l.shape === 'rect') s3.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Corner radius', min: 0, max: Math.round(Math.min(l.w, l.h) / 2), value: Math.round(l.radius || 0), onInput: function (v, key) { c.patch(ids, { radius: v }, key); } }));
          body.appendChild(s3);
        }
      } else if (l.type === 'svg') {
        var s4 = c.ui.section('Graphic');
        var tint = /^(lucide|phosphor):/.test(l.assetId || '');
        if (tint) s4.querySelector('.sx-sec-body').appendChild(c.ui.swatchBtn(l.color || '#17131F', 'Color', function (b) { c.colorPop(b, { value: l.color, title: 'Icon color', onChange: function (v, key) { c.patch(ids, { color: v }, key); } }); }));
        if (/^lucide:/.test(l.assetId || '')) s4.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Stroke width', min: 0.5, max: 4, step: 0.25, value: l.strokeWidth || 2, reset: 2, onInput: function (v, key) { c.patch(ids, { strokeWidth: v }, key); } }));
        if (!tint) s4.querySelector('.sx-sec-body').appendChild(note(c, 'Emoji and stickers keep their original colors. Use Effects for shadows and transparency.'));
        body.appendChild(s4);
      } else if (l.type === 'path') {
        var s5 = c.ui.section('Ink');
        var b5 = s5.querySelector('.sx-sec-body');
        b5.appendChild(c.ui.swatchBtn(l.color, 'Ink color', function (b) { c.colorPop(b, { value: l.color, title: 'Ink color', onChange: function (v, key) { c.patch(ids, { color: v }, key); } }); }));
        b5.appendChild(c.ui.slider({ label: 'Width', min: 1, max: 120, value: Math.round(l.width), onInput: function (v, key) { c.patch(ids, { width: v }, key); } }));
        b5.appendChild(c.ui.slider({ label: 'Smoothing', min: 0, max: 100, value: Math.round((l.smoothing == null ? 0.5 : l.smoothing) * 100), onInput: function (v, key) { c.patch(ids, { smoothing: v / 100 }, key); } }));
        body.appendChild(s5);
      } else if (l.type === 'text') {
        var s6 = c.ui.section('Text');
        var b6 = s6.querySelector('.sx-sec-body');
        var fb = c.h('<button type="button" class="sx-font-pick"><span style="font-family:' + c.esc(c.fontCss(l.font)) + '">' + c.esc(l.font) + '</span>' + c.ic('right') + '</button>');
        fb.onclick = function () { c.openPanel('fonts', { back: 'edit' }); };
        b6.appendChild(fb);
        b6.appendChild(c.ui.slider({ label: 'Size', min: 6, max: 600, value: Math.round(l.size), onInput: function (v, key) { c.patch(ids, { size: v }, key); } }));
        b6.appendChild(c.ui.slider({ label: 'Letter spacing', min: -10, max: 60, value: Math.round((l.letterSpacing || 0) / l.size * 100), onInput: function (v, key) { var cur = c.L(l.id); c.patch(ids, { letterSpacing: v / 100 * cur.size }, key); } }));
        b6.appendChild(c.ui.slider({ label: 'Line height', min: 70, max: 250, value: Math.round((l.lineHeight || 1.2) * 100), reset: 120, fmt: function (v) { return (v / 100).toFixed(2); }, onInput: function (v, key) { c.patch(ids, { lineHeight: v / 100 }, key); } }));
        b6.appendChild(c.ui.seg([['left', 'Left', 'alignL'], ['center', 'Center', 'alignC'], ['right', 'Right', 'alignR']], l.align || 'center', function (v) { c.patch(ids, { align: v }); }, 'sx-seg-sm'));
        b6.appendChild(c.ui.swatchBtn(l.fill || l.color, 'Text color', function (b) { c.colorPop(b, { value: l.fill || l.color, gradient: true, title: 'Text color', onChange: function (v, key) { if (typeof v === 'string') c.patch(ids, { color: v, fill: null }, key); else if (v && v.colors) c.patch(ids, { fill: { type: v.type, colors: v.colors, angle: v.angle || 0 }, color: v.colors[0] }, key); } }); }));
        body.appendChild(s6);
        body.appendChild(btn(c, 'Edit text on canvas', 'text', 'btn btn-ghost sx-block', function () { c.startTextEdit(l.id); }));
      } else if (l.type === 'image') {
        var q = c.h('<div class="sx-quick"></div>');
        [['adjust', 'Adjust', function () { c.openPanel('adjust'); }], ['filters', 'Filters', function () { c.openPanel('filters'); }], ['crop', 'Crop', function () { c.startCrop(l.id); }], ['replace', (l.slot || !l.src) ? 'Replace photo' : 'Replace', function () { if (c.openReplace) c.openReplace(); else c.pickFiles('replace'); }], ['background', 'As background', function () { c.setAsBackground(); }], ['wand', 'Remove bg', function () { c.openPanel('background', { section: 'remove' }); }], ['reset', 'Reset', function () { c.resetLayer(c.L(l.id)); }]].forEach(function (x) {
          var b = c.h('<button type="button" class="sx-quick-btn">' + c.ic(x[0]) + '<span>' + x[1] + '</span></button>');
          b.onclick = x[2];
          q.appendChild(b);
        });
        body.appendChild(q);
        imageEffects(c, body, ids, l);
      } else {
        body.appendChild(note(c, 'Groups move and scale together. Ungroup to edit items one by one.'));
        body.appendChild(btn(c, 'Ungroup', 'ungroup', 'btn btn-ghost sx-block', function () { c.scene.ungroup(l.id); }));
      }
    }
  };

  /* ---------- Background ---------- */
  P.background = { title: 'Background', eyebrow: 'Page color, gradient, photo' };   /* le-studio-color.js, le-studio-background.js */
  function removeBg(c, body, o) {
    var img = c.targetImage();
    var s = c.ui.section('Remove flat background');
    var sb = s.querySelector('.sx-sec-body');
    if (o && o.section === 'remove') setTimeout(function () { s.scrollIntoView({ block: 'start', behavior: c.reduced() ? 'auto' : 'smooth' }); }, 60);
    if (!img) { sb.appendChild(note(c, 'Select a photo to clear a plain studio or sky background.')); body.appendChild(s); return; }
    var rb = img.removeBg;
    sb.appendChild(c.ui.toggle('Remove a color', !!rb, function (on) {
      c.patch(img.id, { removeBg: on ? { color: guessBg(c, img) || '#ffffff', tolerance: 28 } : null });
      c.renderPanel(true);
    }, 'Works best on plain backgrounds.'));
    if (rb) {
      var row = c.h('<div class="sx-row"></div>');
      row.appendChild(c.ui.swatchBtn(rb.color, 'Color to remove', function (b) { c.colorPop(b, { value: rb.color, title: 'Color to remove', onChange: function (v, key) { var cur = c.L(img.id); c.patch(img.id, { removeBg: Object.assign({}, cur.removeBg, { color: v }) }, key); } }); }));
      row.appendChild(btn(c, 'Pick from photo', 'pipette', 'btn btn-ghost btn-sm', function () {
        if (c.isPhone()) c.closePanel();
        c.startPick(function (hex) { var cur = c.L(img.id); c.patch(img.id, { removeBg: Object.assign({}, cur.removeBg, { color: hex }) }); if (c.S.panel === 'background') c.renderPanel(true); else c.openPanel('background', { section: 'remove' }); }, 'Tap the background color to remove');
      }));
      sb.appendChild(row);
      sb.appendChild(c.ui.slider({ label: 'Tolerance', min: 0, max: 100, value: rb.tolerance == null ? 28 : rb.tolerance, reset: 28, onInput: function (v, key) { var cur = c.L(img.id); c.patch(img.id, { removeBg: Object.assign({}, cur.removeBg, { tolerance: v }) }, key); } }));
    }
    var msg = LE.capabilities.message('background-ai', LE.device.tier());
    sb.appendChild(note(c, 'AI cut-outs: ' + msg.split('. ').slice(0, 1).join('') + '.', 'is-muted'));
    body.appendChild(s);
  }
  function guessBg(c, img) {
    var m = c.mem[img.src];
    if (!m) return null;
    var t = LE.fit(m.canvas, 64);
    var d = t.getContext('2d').getImageData(0, 0, t.width, t.height).data;
    var pts = [[0, 0], [t.width - 1, 0], [0, t.height - 1], [t.width - 1, t.height - 1]];
    var r = 0, g = 0, b = 0;
    pts.forEach(function (p) { var i = (p[1] * t.width + p[0]) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; });
    return '#' + [r / 4, g / 4, b / 4].map(function (n) { return ('0' + Math.round(n).toString(16)).slice(-2); }).join('');
  }

  /* ---------- Layers / Position ---------- */
  P.layers = { title: 'Position', eyebrow: 'Arrange & layers' };   /* le-studio-panels-more.js */

  /* ---------- Recipes ---------- */
  P.recipes = { title: 'Recipes', eyebrow: 'Reusable looks (.leworkflow)' };   /* le-studio-recipes.js */

  /* ---------- Projects ---------- */
  P.projects = { title: 'Your designs', eyebrow: 'Saved on this device' };   /* le-studio-panels-more.js */

  /* ---------- History (versions) ---------- */
  P.history = { title: 'Version history', eyebrow: 'Autosaves & checkpoints' };   /* le-studio-panels-more.js */

  /* ---------- Export ---------- */
  P.export = { title: 'Download', eyebrow: 'Share your design' };   /* le-studio-export.js */

  /* ---------- Settings ---------- */
  P.settings = { title: 'Performance', eyebrow: 'Speed, quality & storage' };   /* le-studio-panels-more.js */

  /* ---------- Apps ---------- */
  var APPS = P._apps = [
    ['collage', 'Collage', 'grid', 'Layouts, spacing & styles'], ['watermark', 'Watermark', 'stamp', 'Text or logo, tiled'], ['meme', 'Meme', 'meme', 'Top & bottom captions'],
    ['palette', 'Palette', 'palette', 'Extract brand colors'], ['metadata', 'Metadata', 'metadata', 'EXIF & location'], ['compare', 'Before / after', 'compare', 'Side-by-side image'],
    ['batch', 'Batch', 'batch', 'Apply a look to many'], ['upscale', 'Upscale', 'upscale', 'Bigger exports'], ['contact', 'Contact sheet', 'sheet', 'All uploads on one page'],
    ['make', 'Make', 'wand', 'A form in, a finished design out']
  ];
  P.apps = {
    title: function (c, o) { var a = APPS.filter(function (x) { return x[0] === o.app; })[0]; return a ? a[1] : 'Apps'; }, eyebrow: 'Extra tools',
    render: function (c, body, o) {
      if (!o.app) {
        var g = grid('sx-grid-2 sx-apps');
        APPS.forEach(function (a) {
          var b = c.h('<button type="button" class="sx-app"><span class="ic ic-' + ['violet', 'rose', 'sapphire', 'jade', 'copper', 'gold'][APPS.indexOf(a) % 6] + '">' + c.ic(a[2]) + '</span><b>' + a[1] + '</b><small>' + a[3] + '</small></button>');
          b.onclick = function () { c.openPanel('apps', { app: a[0], back: 'apps' }); };
          g.appendChild(b);
        });
        body.appendChild(g);
        return;
      }
      if (!o.back) c.S.panelOpts.back = 'apps';
      var fn = APP_RENDER[o.app] || (P._appRender || {})[o.app];
      if (fn) fn(c, body, o);
    }
  };
  var APP_RENDER = {
    collage: function (c, body, o) {
      if (window.LEStudioCollage && LEStudioCollage.renderApp) { LEStudioCollage.renderApp(c, body, o); return; }
      body.appendChild(note(c, 'Collage could not load. Reload the studio.'));
    }
  };   /* the other small apps register on P._appRender from le-studio-panels-more.js */
  function copy(c, text) {
    var p = window.IT && IT.copy ? IT.copy(text) : navigator.clipboard.writeText(text);
    Promise.resolve(p).then(function () { c.toast('Copied'); }).catch(function () { c.toast('Copy failed'); });
  }
  P._u = {
    tabs: tabs, searchBox: searchBox, grid: grid, btn: btn, note: note, needProject: needProject, svgUrl: svgUrl, draggable: draggable,
    sec: sec, tile: tile, lazyGrid: lazyGrid, loading: loading, removeBg: removeBg, guessBg: guessBg, shapeThumb: shapeThumb, k: k, copy: copy,
    sizeArt: sizeArt, when: when, projectCard: projectCard, noImage: noImage
  };
})();
