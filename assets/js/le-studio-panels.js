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
  var svgUrls = {};
  function svgUrl(id, color) {
    var key = id + '|' + (color || '');
    if (svgUrls[key]) return svgUrls[key];
    var markup = LE.assets.svg(id, color ? { color: color } : {});
    svgUrls[key] = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    return svgUrls[key];
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
      '<p>Layers, text, stickers, filters and every social size — edited live on your device. Nothing is uploaded, ever.</p>' +
      '<div class="sx-hero-act"><button type="button" class="btn btn-gold btn-lg" data-s="open">' + c.ic('image') + '<span>Open a photo</span></button>' +
      '<button type="button" class="btn btn-ghost btn-lg" data-s="sample">' + c.ic('sparkle') + '<span>Try the sample</span></button>' +
      '<button type="button" class="btn btn-ghost btn-lg" data-s="import">' + c.ic('file') + '<span>Import .leproject</span></button></div>' +
      '<small class="sx-hero-drop">or drop photos anywhere · paste with Ctrl V</small></div>' +
      '<div class="sx-start-sec"><h2>Start with a size</h2><div class="sx-size-row"></div></div>' +
      '<div class="sx-start-sec sx-start-recent" hidden><div class="sx-sec-head"><h2>Your designs</h2><button type="button" class="sx-link" data-s="all">See all</button></div><div class="sx-proj-row"></div></div>' +
      '</div>';
    host.querySelector('[data-s="open"]').onclick = function () { c.pickFiles('add'); };
    host.querySelector('[data-s="sample"]').onclick = function () { c.useSample(); };
    host.querySelector('[data-s="import"]').onclick = function () { c.pickFiles('project'); };
    host.querySelector('[data-s="all"]').onclick = function () { c.openPanel('projects'); };
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
  var TEMPLATES = [
    { id: 'caption', name: 'Bold caption', build: function (W, H, s) {
      return [
        { type: 'shape', shape: 'rectangle', name: 'Shade', x: 0, y: H * 0.55, w: W, h: H * 0.45, fill: { type: 'linear', colors: ['rgba(17,15,23,0)', 'rgba(17,15,23,.82)'], angle: 90 } },
        { type: 'text', text: 'Weekend in the hills', font: 'Plus Jakarta Sans', weight: 800, size: 84, w: 900, color: '#FFFFFF', align: 'left', abs: { x: W * 0.07, y: H * 0.74 } },
        { type: 'text', text: 'A few quiet days, written down.', font: 'Instrument Serif', italic: true, weight: 400, size: 44, w: 900, color: '#F2D594', align: 'left', abs: { x: W * 0.07, y: H * 0.86 } }
      ];
    } },
    { id: 'polaroid', name: 'Polaroid frame', build: function (W, H) {
      var m = Math.min(W, H);
      return [
        { type: 'shape', shape: 'rectangle', name: 'Frame', x: 0, y: 0, w: W, h: H, fill: { type: 'none' }, stroke: { width: m * 0.09, color: '#FBF8F3', join: 'miter' } },
        { type: 'shape', shape: 'rectangle', name: 'Frame bottom', x: 0, y: H - m * 0.2, w: W, h: m * 0.2, fill: { type: 'solid', color: '#FBF8F3' } },
        { type: 'text', text: 'summer ’26', font: 'Caveat', weight: 700, size: 70, w: 700, color: '#17131F', abs: { x: W / 2 - 350 * m / 1080, y: H - m * 0.15 } }
      ];
    } },
    { id: 'quote', name: 'Quote card', build: function (W, H) {
      return [
        { type: 'shape', shape: 'rounded-rectangle', name: 'Card', params: { radius: 40 * Math.min(W, H) / 1080 }, x: W * 0.08, y: H * 0.22, w: W * 0.84, h: H * 0.56, fill: { type: 'solid', color: 'rgba(251,248,243,.92)' }, shadow: { color: 'rgba(23,19,31,.25)', blur: 40, x: 0, y: 18 } },
        { type: 'text', text: '“Simplicity is the ultimate sophistication.”', font: 'Playfair Display', italic: true, weight: 400, size: 64, w: 760, color: '#17131F', lineHeight: 1.25, dy: -30 },
        { type: 'text', text: '— LEONARDO', font: 'Plus Jakarta Sans', weight: 700, size: 26, letterSpacing: 8, w: 760, color: '#B9832F', dy: 130 }
      ];
    } },
    { id: 'sale', name: 'Sale post', build: function (W, H) {
      var m = Math.min(W, H);
      return [
        { type: 'shape', shape: 'burst', name: 'Burst', params: {}, x: W - m * 0.42, y: m * 0.05, w: m * 0.36, h: m * 0.36, fill: { type: 'solid', color: '#E0668E' } },
        { type: 'text', text: '50%\nOFF', font: 'Anton', weight: 400, size: 74, w: 300, color: '#FFFFFF', lineHeight: 1, abs: { x: W - m * 0.42 + m * 0.18 - 150 * m / 1080, y: m * 0.05 + m * 0.18 - 74 * m / 1080 } },
        { type: 'text', text: 'SUMMER SALE', font: 'Bebas Neue', weight: 400, size: 180, w: 1000, color: '#FFFFFF', shadow: { color: 'rgba(23,19,31,.45)', blur: 24, x: 0, y: 8 }, dy: 260 }
      ];
    } },
    { id: 'event', name: 'Event poster', build: function (W, H) {
      return [
        { type: 'shape', shape: 'rectangle', name: 'Tint', x: 0, y: 0, w: W, h: H, fill: { type: 'linear', colors: ['rgba(42,26,62,.75)', 'rgba(116,87,240,.35)'], angle: 90 } },
        { type: 'text', text: 'LIVE IN CONCERT', font: 'Plus Jakarta Sans', weight: 700, size: 30, letterSpacing: 14, w: 900, color: '#F2D594', dy: -200 },
        { type: 'text', text: 'Midnight\nAurora', font: 'Instrument Serif', italic: true, weight: 400, size: 190, w: 960, color: '#FFFFFF', lineHeight: 0.95, dy: -10 },
        { type: 'text', text: 'FRI 14 NOV · THE HALL', font: 'Space Grotesk', weight: 700, size: 34, letterSpacing: 6, w: 900, color: '#FFFFFF', dy: 240 }
      ];
    } },
    { id: 'thumb', name: 'Thumbnail punch', build: function (W, H) {
      var m = Math.min(W, H);
      return [
        { type: 'text', text: 'I TRIED IT', font: 'Anton', weight: 400, size: 200, w: 1000, color: '#FFFFFF', stroke: { width: 10, color: '#17131F' }, rotation: -3, abs: { x: W * 0.05, y: H * 0.08 } },
        { type: 'shape', shape: 'arrow-curved', name: 'Arrow', params: {}, x: W * 0.55, y: H * 0.5, w: m * 0.32, h: m * 0.32, fill: { type: 'solid', color: '#FFB020' } }
      ];
    } },
    { id: 'minimal', name: 'Minimal title', build: function (W, H) {
      return [
        { type: 'text', text: 'the quiet edit', font: 'Cormorant Garamond', italic: true, weight: 400, size: 130, w: 960, color: '#FFFFFF', shadow: { color: 'rgba(0,0,0,.35)', blur: 24, x: 0, y: 4 }, dy: -10 },
        { type: 'shape', shape: 'line', name: 'Rule', x: W / 2 - 80 * Math.min(W, H) / 1080, y: H / 2 + 80 * Math.min(W, H) / 1080, w: 160 * Math.min(W, H) / 1080, h: 10, fill: { type: 'none' }, stroke: { width: 3, color: '#FFFFFF', cap: 'round' } }
      ];
    } },
    { id: 'story', name: 'Story announcement', build: function (W, H) {
      var m = Math.min(W, H);
      return [
        { type: 'text', text: 'NEW', font: 'Plus Jakarta Sans', weight: 800, size: 40, letterSpacing: 10, w: 420, color: '#2C220F', background: { color: '#F2D594', radius: 999, padding: 20 }, abs: { x: W / 2 - 210 * m / 1080, y: H * 0.12 } },
        { type: 'text', text: 'Swipe up\nfor the drop', font: 'Syne', weight: 700, size: 120, w: 960, color: '#FFFFFF', lineHeight: 1, fill: { type: 'linear', colors: ['#FFFFFF', '#F2D594'], angle: 90 }, abs: { x: W / 2 - 480 * m / 1080, y: H * 0.7 } }
      ];
    } }
  ];
  function applyTemplate(c, t) {
    var d = c.doc();
    var W = d.width, H = d.height, s = Math.min(W, H) / 1080;
    var list = t.build(W, H, s);
    c.batch(function () {
      var ids = list.map(function (l) {
        if (l.type === 'text') {
          var spec = Object.assign({ align: 'center' }, l);
          var abs = spec.abs;
          delete spec.abs;
          var id = c.addText(spec);
          if (abs) c.patch(id, { x: abs.x, y: abs.y });
          return id;
        }
        return c.scene.add(l);
      });
      var gid = c.scene.group(ids);
      c.patch(gid, { name: t.name });
      c.scene.select([gid]);
    });
    c.toast('Template added — everything stays editable');
  }
  P.design = {
    title: 'Design', eyebrow: 'Templates & sizes',
    render: function (c, body, o) {
      var tab = o.tab || (c.S.project ? 'sizes' : 'templates');
      tabs(c, body, [['templates', 'Templates'], ['sizes', 'Resize'], ['history', 'Size history']], tab, function (t) { c.size.cancel(); c.openPanel('design', { tab: t }); });
      if (tab === 'templates') return renderTemplates(c, body);
      if (tab === 'history') return renderSizeHistory(c, body);
      renderSizes(c, body);
    },
    close: function (c) { if (c.S.preview && c.S.preview.type === 'size') c.size.cancel(); }
  };
  function renderTemplates(c, body) {
    if (window.LEStudioCollage && typeof LEStudioCollage.renderCatalog === 'function') {
      try {
        LEStudioCollage.renderCatalog(c, body, { surface: 'design', textTemplates: TEMPLATES, applyText: applyTemplate });
        return;
      } catch (err) { /* keep the original text layouts if the catalog cannot render */ }
    }
    var sec = c.ui.section('Layouts for this page');
    var g = grid('sx-grid-2');
    TEMPLATES.forEach(function (t) {
      var b = c.h('<button type="button" class="sx-tpl sx-tpl-' + t.id + '"><span class="sx-tpl-art" aria-hidden="true"><i></i><i></i><i></i></span><b>' + c.esc(t.name) + '</b></button>');
      b.onclick = function () { if (!c.S.project) { c.useSample().then(function () { applyTemplate(c, t); }); return; } applyTemplate(c, t); };
      g.appendChild(b);
    });
    sec.querySelector('.sx-sec-body').appendChild(g);
    body.appendChild(sec);
    var sec2 = c.ui.section('New design');
    var g2 = grid('sx-grid-2');
    c.SIZES.slice(0, 10).forEach(function (s) {
      var b = c.h('<button type="button" class="sx-size-mini">' + sizeArt(s.w, s.h, 32, 32) + '<span><b>' + c.esc(s.name) + '</b><small>' + s.w + ' × ' + s.h + '</small></span></button>');
      b.onclick = function () { c.newDesign(s.w, s.h, s.name); };
      g2.appendChild(b);
    });
    sec2.querySelector('.sx-sec-body').appendChild(g2);
    body.appendChild(sec2);
  }
  function renderSizes(c, body) {
    if (needProject(c, body)) return;
    var d = c.doc();
    var st = c.studio();
    var opts = c.size.opts();
    var base = c.baseLayer();
    var orig = st.originalSize;
    var head = c.h('<div class="sx-cur-size"><div><span class="sx-eyebrow">Current page</span><strong>' + d.width + ' × ' + d.height + ' px</strong>' + (orig ? '<small>Original ' + orig.w + ' × ' + orig.h + '</small>' : '') + '</div></div>');
    head.appendChild(btn(c, 'Reset to original', 'reset', 'btn btn-ghost btn-sm', function () { c.size.reset(); }));
    body.appendChild(head);
    var how = c.ui.section('How content adapts');
    var hb = how.querySelector('.sx-sec-body');
    if (base) {
      hb.appendChild(c.ui.seg([['cover', 'Fill', 'fit'], ['contain', 'Fit', 'frame'], ['stretch', 'Stretch', 'resize']], opts.fit, function (v) {
        st.fit = v;
        if (c.S.preview && c.S.preview.target) c.size.preview(c.S.preview.target.W, c.S.preview.target.H, c.S.preview.target.label, { fit: v });
        focal.hidden = v !== 'cover';
      }));
      var focal = focalPad(c, st);
      focal.hidden = opts.fit !== 'cover';
      hb.appendChild(focal);
    }
    hb.appendChild(c.ui.toggle('Scale content', opts.scaleContent, function (v) {
      st.scaleContent = v;
      if (c.S.preview && c.S.preview.target) c.size.preview(c.S.preview.target.W, c.S.preview.target.H, c.S.preview.target.label, { scaleContent: v });
    }, 'Text, shapes and stickers grow or shrink with the page.'));
    hb.appendChild(c.ui.toggle('Resize from current result', c.size.chain(), function (v) { c.size.setChain(v); }, 'Off: every size is rendered fresh from your original photo.'));
    body.appendChild(how);

    var presets = c.ui.section('Sizes', '<button type="button" class="sx-link" data-compare>Compare sizes</button>');
    presets.querySelector('[data-compare]').onclick = function () { compareModal(c); };
    var pb = presets.querySelector('.sx-sec-body');
    var groups = {};
    c.SIZES.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s); });
    var hoverT = 0;
    var pinned = c.S.preview && c.S.preview.target ? c.S.preview.target.label : null;
    Object.keys(groups).forEach(function (gname) {
      pb.appendChild(c.h('<h4 class="sx-sub">' + c.esc(gname) + '</h4>'));
      var g = grid('sx-grid-2 sx-sizes');
      groups[gname].forEach(function (s) {
        var cur = s.w === d.width && s.h === d.height;
        var b = c.h('<button type="button" class="sx-size-mini' + (cur ? ' is-current' : '') + (pinned === s.name ? ' is-pinned' : '') + '">' + sizeArt(s.w, s.h, 32, 32) + '<span><b>' + c.esc(s.name) + '</b><small>' + s.w + ' × ' + s.h + (cur ? ' · current' : '') + '</small></span></button>');
        b.addEventListener('mouseenter', function (e) {
          if (e.pointerType === 'touch' || !window.matchMedia('(hover: hover)').matches) return;
          if (pinned) return;
          clearTimeout(hoverT);
          hoverT = setTimeout(function () { c.size.preview(s.w, s.h, s.name); }, 220);
        });
        b.addEventListener('mouseleave', function () {
          clearTimeout(hoverT);
          if (!pinned && c.S.preview && c.S.preview.type === 'size') hoverT = setTimeout(function () { if (!pinned) c.size.cancel(); }, 160);
        });
        b.onclick = function () {
          clearTimeout(hoverT);
          pinned = s.name;
          g.parentNode.querySelectorAll('.is-pinned').forEach(function (x) { x.classList.remove('is-pinned'); });
          b.classList.add('is-pinned');
          c.size.preview(s.w, s.h, s.name);
        };
        g.appendChild(b);
      });
      pb.appendChild(g);
    });
    body.appendChild(presets);

    var custom = c.ui.section('Custom size');
    var form = c.h('<form class="sx-form"><div class="sx-wh"><label>Width<input class="sx-input" type="number" min="16" max="16000" value="' + d.width + '"></label><button type="button" class="sx-iconbtn sx-ratio-lock" aria-pressed="true" aria-label="Lock aspect ratio">' + c.ic('lock') + '</button><label>Height<input class="sx-input" type="number" min="16" max="16000" value="' + d.height + '"></label></div><div class="sx-row-end"><button type="submit" class="btn btn-gold btn-sm">Preview size</button></div></form>');
    var ins = form.querySelectorAll('input');
    var lock = form.querySelector('.sx-ratio-lock');
    var ratio = d.width / d.height;
    lock.onclick = function () { lock.setAttribute('aria-pressed', lock.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); ratio = Number(ins[0].value) / Number(ins[1].value) || 1; };
    ins[0].addEventListener('input', function () { if (lock.getAttribute('aria-pressed') === 'true') ins[1].value = Math.round(Number(ins[0].value) / ratio) || ''; });
    ins[1].addEventListener('input', function () { if (lock.getAttribute('aria-pressed') === 'true') ins[0].value = Math.round(Number(ins[1].value) * ratio) || ''; });
    form.onsubmit = function (e) {
      e.preventDefault();
      var w = c.clamp(Math.round(Number(ins[0].value) || 0), 16, 16000), h = c.clamp(Math.round(Number(ins[1].value) || 0), 16, 16000);
      pinned = 'Custom';
      c.size.preview(w, h, 'Custom ' + w + ' × ' + h);
    };
    custom.querySelector('.sx-sec-body').appendChild(form);
    body.appendChild(custom);
    body.appendChild(note(c, 'Hover a size to preview it, tap to pin it, then choose “Use this size”. Your original photo is never changed.'));
  }
  function focalPad(c, st) {
    var base = c.baseLayer();
    var wrap = c.h('<div class="sx-focal"><div class="sx-focal-pad" role="slider" tabindex="0" aria-label="Focal point — drag to choose what stays in frame"><canvas></canvas><i class="sx-focal-dot"></i></div><small>Drag the dot to choose what stays in frame when filling a new size.</small></div>');
    var m = base && c.mem[base.src];
    var cv = wrap.querySelector('canvas');
    if (m) {
      var reg = st.baseRegion || { x: 0, y: 0, w: 1, h: 1 };
      var sw = m.canvas.width * reg.w, sh = m.canvas.height * reg.h;
      var s = Math.min(240 / sw, 140 / sh);
      cv.width = Math.max(1, Math.round(sw * s));
      cv.height = Math.max(1, Math.round(sh * s));
      cv.getContext('2d').drawImage(m.canvas, m.canvas.width * reg.x, m.canvas.height * reg.y, sw, sh, 0, 0, cv.width, cv.height);
    }
    var pad = wrap.querySelector('.sx-focal-pad');
    var dot = wrap.querySelector('.sx-focal-dot');
    var f = st.focal || { x: 0.5, y: 0.5 };
    function paint() { dot.style.left = (f.x * 100) + '%'; dot.style.top = (f.y * 100) + '%'; }
    function apply() {
      st.focal = { x: Math.round(f.x * 1000) / 1000, y: Math.round(f.y * 1000) / 1000 };
      var p = c.S.preview;
      if (p && p.target) c.size.preview(p.target.W, p.target.H, p.target.label, { focal: st.focal });
    }
    var raf = 0;
    function at(e) {
      var r = cv.getBoundingClientRect();
      f = { x: c.clamp((e.clientX - r.left) / r.width, 0, 1), y: c.clamp((e.clientY - r.top) / r.height, 0, 1) };
      paint();
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; apply(); });
    }
    var down = false;
    pad.addEventListener('pointerdown', function (e) { down = true; pad.setPointerCapture(e.pointerId); at(e); });
    pad.addEventListener('pointermove', function (e) { if (down) at(e); });
    pad.addEventListener('pointerup', function () { down = false; });
    pad.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 0.1 : 0.02;
      if (e.key === 'ArrowLeft') f.x = c.clamp(f.x - step, 0, 1);
      else if (e.key === 'ArrowRight') f.x = c.clamp(f.x + step, 0, 1);
      else if (e.key === 'ArrowUp') f.y = c.clamp(f.y - step, 0, 1);
      else if (e.key === 'ArrowDown') f.y = c.clamp(f.y + step, 0, 1);
      else return;
      e.preventDefault();
      paint();
      apply();
    });
    paint();
    return wrap;
  }
  function compareModal(c) {
    var picks = ['ig-post', 'ig-story', 'yt-thumb', 'pin'];
    var body = c.h('<div class="sx-compare"><div class="sx-chips"></div><div class="sx-compare-grid"></div><p class="sx-note">Every option is rendered from the same document and your original photo.</p></div>');
    var chips = body.querySelector('.sx-chips');
    var out = body.querySelector('.sx-compare-grid');
    c.SIZES.forEach(function (s) {
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (picks.indexOf(s.id) >= 0) + '">' + c.esc(s.name) + '</button>');
      b.onclick = function () {
        var on = picks.indexOf(s.id) >= 0;
        if (on) picks = picks.filter(function (x) { return x !== s.id; });
        else { if (picks.length >= 4) picks.shift(); picks.push(s.id); }
        chips.querySelectorAll('.sx-chip').forEach(function (x, i) { x.setAttribute('aria-pressed', picks.indexOf(c.SIZES[i].id) >= 0); });
        run();
      };
      chips.appendChild(b);
    });
    var token = 0;
    function run() {
      var my = ++token;
      out.innerHTML = '<div class="sx-loading">Rendering…</div>';
      var list = picks.map(function (id) { return c.SIZES.filter(function (s) { return s.id === id; })[0]; });
      c.size.compare(list).then(function (res) {
        if (my !== token) return;
        out.innerHTML = '';
        res.forEach(function (r) {
          var card = c.h('<figure class="sx-compare-card"><div class="sx-compare-art"></div><figcaption><b>' + c.esc(r.size.name) + '</b><small>' + r.size.w + ' × ' + r.size.h + '</small></figcaption></figure>');
          r.canvas.className = 'sx-compare-img';
          card.querySelector('.sx-compare-art').appendChild(r.canvas);
          var use = btn(c, 'Use this', 'check', 'btn btn-gold btn-sm', function () { c.closeModal(); c.size.apply(r.size.w, r.size.h, r.size.name); });
          card.querySelector('figcaption').appendChild(use);
          out.appendChild(card);
        });
      }).catch(function (err) { out.innerHTML = ''; out.appendChild(note(c, err.message || 'Could not render previews.')); });
    }
    c.openModal('Compare <em>sizes</em>', body, { wide: true });
    run();
  }
  function renderSizeHistory(c, body) {
    if (needProject(c, body)) return;
    var list = (c.S.project.sizeHistory || []).slice().reverse();
    var top = c.h('<div class="sx-row-between"></div>');
    top.appendChild(btn(c, 'Reset to original size', 'reset', 'btn btn-ghost btn-sm', function () { c.size.reset(); }));
    body.appendChild(top);
    if (!list.length) { body.appendChild(note(c, 'No resizes yet. Each size you apply is recorded here so you can step back to any of them.')); return; }
    var ul = c.h('<ol class="sx-hist"></ol>');
    list.forEach(function (e) {
      var li = c.h('<li class="sx-hist-item' + (e.reverted ? ' is-reverted' : '') + '"><span class="sx-hist-ic">' + c.ic(e.type === 'revert' ? 'reset' : 'resize') + '</span><span class="sx-hist-txt"><b>' + c.esc(e.label || 'Resize') + '</b><small>' + e.from.w + '×' + e.from.h + ' → ' + e.to.w + '×' + e.to.h + ' · ' + ({ cover: 'Fill', contain: 'Fit', stretch: 'Stretch' }[e.fit] || 'Fill') + ' · from ' + (e.source === 'current' ? 'current result' : 'original') + ' · ' + when(e.at) + '</small></span></li>');
      if (e.before) li.appendChild(btn(c, e.reverted ? 'Reverted' : 'Revert', null, 'btn btn-ghost btn-sm', function () { c.size.revert(e.id); }));
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }

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
      body.appendChild(note(c, 'Double-click any text on the canvas to edit it in place. Text stays editable forever — it is only flattened when you download.'));
    }
  };

  /* ---------- Fonts ---------- */
  var CAT = { sans: 'Sans serif', serif: 'Serif', display: 'Display', handwriting: 'Script & hand', mono: 'Monospace' };
  P.fonts = {
    title: 'Fonts', eyebrow: 'All fonts live on this device', select: true,
    render: function (c, body) {
      var l = c.one();
      var cur = l && l.type === 'text' ? l.font : null;
      var bar = c.h('<div class="sx-sticky"></div>');
      body.appendChild(bar);
      var list = (LE.fonts && LE.fonts.list ? LE.fonts.list() : []).slice();
      var host = c.h('<div></div>');
      body.appendChild(host);
      searchBox(c, bar, 'Search ' + list.length + ' fonts', '', function (q) { draw(q); });
      var cats = c.h('<div class="sx-chips is-scroll"></div>');
      var catOn = '';
      [['', 'All']].concat(Object.keys(CAT).map(function (k) { return [k, CAT[k]]; })).forEach(function (t) {
        var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (t[0] === '') + '">' + c.esc(t[1]) + '</button>');
        b.onclick = function () { catOn = t[0]; cats.querySelectorAll('.sx-chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); draw(bar.querySelector('input').value.trim()); };
        cats.appendChild(b);
      });
      bar.appendChild(cats);
      function row(f) {
        var on = f.family === cur;
        var b = c.h('<button type="button" class="sx-font' + (on ? ' is-on' : '') + '" data-lazy="' + c.esc(f.family) + '"><span class="sx-font-name">' + c.esc(f.family) + '</span><small>' + c.esc(CAT[f.category] || f.category) + ' · ' + (f.weights || []).length + ' weight' + ((f.weights || []).length === 1 ? '' : 's') + (f.italic ? ' · italic' : '') + '</small>' + (on ? c.ic('check', 'sx-font-check') : '') + '</button>');
        b.onclick = function () { pick(f); };
        return b;
      }
      function pick(f) {
        var ids = c.sel().filter(function (id) { var x = c.L(id); return x && x.type === 'text'; });
        var recentF = c.lsGet('le-studio-fonts', []).filter(function (x) { return x !== f.family; });
        recentF.unshift(f.family);
        c.lsSet('le-studio-fonts', recentF.slice(0, 8));
        if (!ids.length) { var id = c.addText({ text: f.family, font: f.family, weight: (f.weights || [400]).indexOf(700) >= 0 ? 700 : f.weights[0], size: 90 }); c.scene.select([id]); return; }
        ids.forEach(function (id) {
          var x = c.L(id);
          var w = x.weight || 400;
          var ws = f.weights || [400];
          if (ws.indexOf(w) < 0) w = ws.reduce(function (a, b) { return Math.abs(b - w) < Math.abs(a - w) ? b : a; }, ws[0]);
          c.patch(id, { font: f.family, weight: w, italic: x.italic && !!f.italic });
        });
        if (LE.fonts.load) LE.fonts.load(f.family, 400, false).catch(function () { c.toast('That font is not available offline yet.'); });
        c.renderPanel(true);
      }
      function draw(q) {
        host.innerHTML = '';
        q = (q || '').toLowerCase();
        var recentF = c.lsGet('le-studio-fonts', []);
        var show = list.filter(function (f) { return (!q || f.family.toLowerCase().indexOf(q) >= 0) && (!catOn || f.category === catOn); });
        if (!q && !catOn && recentF.length) {
          var rs = c.ui.section('Recently used');
          recentF.forEach(function (fam) { var f = list.filter(function (x) { return x.family === fam; })[0]; if (f) rs.querySelector('.sx-sec-body').appendChild(row(f)); });
          host.appendChild(rs);
        }
        var groups = {};
        show.forEach(function (f) { (groups[f.category] = groups[f.category] || []).push(f); });
        Object.keys(CAT).forEach(function (k) {
          if (!groups[k]) return;
          var s = c.ui.section(CAT[k]);
          groups[k].forEach(function (f) { s.querySelector('.sx-sec-body').appendChild(row(f)); });
          host.appendChild(s);
        });
        if (!show.length) host.appendChild(note(c, 'No fonts match “' + q + '”.'));
        c.ui.lazy(host, function (n) {
          var fam = n.getAttribute('data-lazy');
          var name = n.querySelector('.sx-font-name');
          var go = LE.fonts.ensurePreview ? LE.fonts.ensurePreview(fam) : Promise.resolve();
          go.then(function () { name.style.fontFamily = c.fontCss(fam); }).catch(function () { name.style.fontFamily = c.fontCss(fam); });
        });
      }
      draw('');
      if (l && l.type === 'text') {
        var f = list.filter(function (x) { return x.family === l.font; })[0];
        if (f && (f.weights || []).length > 1) {
          var ws = c.ui.section('Weight');
          ws.querySelector('.sx-sec-body').appendChild(c.ui.seg(f.weights.map(function (w) { return [w, ({ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra', 900: 'Black' })[w] || String(w)]; }), l.weight, function (w) { c.patch(c.sel(), { weight: w }); }, 'sx-seg-sm'));
          body.insertBefore(ws, host);
        }
      }
    }
  };

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
      var top = c.h('<div class="sx-upload-cta"><button type="button" class="btn btn-gold sx-block">' + c.ic('uploads') + '<span>Upload photos</span></button><small>Drag photos onto the canvas, or paste with Ctrl V. They never leave this device.</small></div>');
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
      body.appendChild(note(c, 'Edits are live and non-destructive. Double-click a slider label to reset it.'));
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
  P.background = {
    title: 'Background', eyebrow: 'Page color, gradient, photo', select: true,
    render: function (c, body, o) {
      if (needProject(c, body)) return;
      var bg = c.doc().background || { type: 'color', color: '#ffffff' };
      var s = c.ui.section('Page color');
      var sb = s.querySelector('.sx-sec-body');
      var row = c.h('<div class="sx-swatches"></div>');
      var clear = c.h('<button type="button" class="sx-chip-color is-clear" aria-label="Transparent" title="Transparent (PNG)"></button>');
      clear.onclick = function () { c.setBackground({ type: 'color', color: 'rgba(0,0,0,0)' }); c.S.exportOpts.transparent = true; c.lsSet('le-studio-export', c.S.exportOpts); c.toast('Transparent — export as PNG or WebP'); };
      row.appendChild(clear);
      c.PALETTE.forEach(function (col) {
        var b = c.h('<button type="button" class="sx-chip-color" aria-label="' + col + '" aria-pressed="' + (bg.type === 'color' && String(bg.color).toLowerCase() === col.toLowerCase()) + '"></button>');
        b.style.background = col;
        b.onclick = function () { c.setBackground({ type: 'color', color: col }); c.renderPanel(true); };
        row.appendChild(b);
      });
      var more = c.h('<button type="button" class="sx-chip-color is-more" aria-label="Custom color">' + c.ic('plus') + '</button>');
      more.onclick = function () { c.colorPop(more, { value: bg.color || '#ffffff', title: 'Page color', onChange: function (v) { c.setBackground({ type: 'color', color: v }); } }); };
      row.appendChild(more);
      sb.appendChild(row);
      body.appendChild(s);
      var s2 = c.ui.section('Gradients');
      var g = c.h('<div class="sx-swatches is-lg"></div>');
      c.GRADIENTS.forEach(function (cols, i) {
        var b = c.h('<button type="button" class="sx-chip-color" aria-label="Gradient ' + (i + 1) + '"></button>');
        b.style.background = 'linear-gradient(135deg,' + cols.join(',') + ')';
        b.onclick = function () { c.setBackground({ type: 'gradient', kind: 'linear', colors: cols.slice(), angle: 45 }); c.renderPanel(true); };
        g.appendChild(b);
      });
      s2.querySelector('.sx-sec-body').appendChild(g);
      if (bg.type === 'gradient') {
        s2.querySelector('.sx-sec-body').appendChild(c.ui.seg([['linear', 'Linear'], ['radial', 'Radial']], bg.kind || 'linear', function (v) { var cur = c.doc().background; c.setBackground(Object.assign({}, cur, { kind: v })); }, 'sx-seg-sm'));
        s2.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Angle', min: 0, max: 360, value: bg.angle || 0, fmt: function (v) { return v + '°'; }, onInput: function (v) { var cur = c.doc().background; c.setBackground(Object.assign({}, cur, { angle: v })); } }));
      }
      body.appendChild(s2);
      var s3 = c.ui.section('Photo background');
      var b3 = s3.querySelector('.sx-sec-body');
      var gg = grid('sx-grid-4 sx-thumbs');
      Object.keys(c.S.project.assets || {}).filter(function (id) { return !/^background-/.test((c.S.project.assets[id] || {}).name || ''); }).forEach(function (id) {
        var t = c.h('<button type="button" class="sx-thumb" aria-label="Use as background"><img alt=""></button>');
        c.thumbUrl(id).then(function (u) { if (u) t.querySelector('img').src = u; });
        t.onclick = function () { c.setBackground({ type: 'image', src: id, fit: 'cover', color: '#ffffff' }); c.toast('Photo set as page background'); };
        gg.appendChild(t);
      });
      if (gg.children.length) b3.appendChild(gg);
      var one = c.one();
      if (one && one.type === 'image') b3.appendChild(btn(c, 'Use selected photo as background', 'background', 'btn btn-ghost btn-sm sx-block', function () { c.setAsBackground(); }));
      if (!gg.children.length) b3.appendChild(btn(c, 'Upload a photo', 'uploads', 'btn btn-ghost btn-sm', function () { c.pickFiles('tray'); }));
      body.appendChild(s3);
      removeBg(c, body, o);
    }
  };
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
  var TYPE_IC = { image: 'image', text: 'text', shape: 'shapes', svg: 'emoji', path: 'pen', group: 'group' };
  P.layers = {
    title: 'Position', eyebrow: 'Arrange & layers', select: true, doc: true,
    render: function (c, body, o) {
      var tab = o.tab || 'layers';
      tabs(c, body, [['arrange', 'Arrange'], ['layers', 'Layers']], tab, function (t) { c.S.panelOpts.tab = t; c.renderPanel(true); });
      if (needProject(c, body)) return;
      if (tab === 'arrange') return arrange(c, body);
      layerList(c, body);
    }
  };
  function arrange(c, body) {
    var ids = c.sel();
    if (!ids.length) { body.appendChild(note(c, 'Select something on the canvas to align, order or position it.')); return; }
    var s = c.ui.section('Layer order');
    var g = grid('sx-grid-2');
    [['front', 'Bring to front', 'front'], ['forward', 'Forward', 'front'], ['backward', 'Backward', 'back2'], ['back', 'Send to back', 'back2']].forEach(function (x) {
      g.appendChild(btn(c, x[1], x[2], 'sx-arr', function () { ids.forEach(function (id) { c.scene.order(id, x[0]); }); }));
    });
    s.querySelector('.sx-sec-body').appendChild(g);
    body.appendChild(s);
    var s2 = c.ui.section(ids.length > 1 ? 'Align to selection' : 'Align to page');
    var g2 = grid('sx-grid-3');
    [['left', 'Left', 'alL'], ['center', 'Center', 'alC'], ['right', 'Right', 'alR'], ['top', 'Top', 'alT'], ['middle', 'Middle', 'alM'], ['bottom', 'Bottom', 'alB']].forEach(function (x) {
      g2.appendChild(btn(c, x[1], x[2], 'sx-arr', function () { c.scene.align(ids, x[0], ids.length > 1 ? 'selection' : 'page'); }));
    });
    s2.querySelector('.sx-sec-body').appendChild(g2);
    if (ids.length > 2) {
      var g3 = grid('sx-grid-2');
      g3.appendChild(btn(c, 'Space horizontally', 'distH', 'sx-arr', function () { c.scene.distribute(ids, 'h'); }));
      g3.appendChild(btn(c, 'Space vertically', 'distV', 'sx-arr', function () { c.scene.distribute(ids, 'v'); }));
      s2.querySelector('.sx-sec-body').appendChild(g3);
    }
    body.appendChild(s2);
    if (ids.length === 1) {
      var l = c.L(ids[0]);
      var forced = l.type === 'image' || l.type === 'svg' || l.type === 'group';
      var lockAsp = forced || c.lsGet('le-studio-lockaspect', false);
      var s3 = c.ui.section('Size & position', '<button type="button" class="sx-iconbtn sx-lockasp" aria-pressed="' + lockAsp + '" aria-label="Lock aspect ratio" title="' + (forced ? 'Photos and graphics always keep their proportions' : 'Lock aspect ratio') + '"' + (forced ? ' disabled' : '') + '>' + c.ic(lockAsp ? 'lock' : 'unlock') + '</button>');
      var lk = s3.querySelector('.sx-lockasp');
      lk.onclick = function () { lockAsp = !lockAsp; c.lsSet('le-studio-lockaspect', lockAsp); lk.setAttribute('aria-pressed', lockAsp); lk.innerHTML = c.ic(lockAsp ? 'lock' : 'unlock'); };
      var f = c.h('<div class="sx-xywh"></div>');
      [['w', 'W'], ['h', 'H'], ['x', 'X'], ['y', 'Y'], ['rotation', '°']].forEach(function (x) {
        var lab = c.h('<label><span>' + x[1] + '</span><input class="sx-input" type="number" step="1" inputmode="decimal" data-k="' + x[0] + '" aria-label="' + ({ w: 'Width', h: 'Height', x: 'X position', y: 'Y position', rotation: 'Rotation in degrees' })[x[0]] + '" value="' + Math.round(l[x[0]] || 0) + '"></label>');
        lab.querySelector('input').addEventListener('change', function (e) {
          var v = Number(e.target.value);
          if (!isFinite(v)) return;
          var p = {};
          if (x[0] === 'w' || x[0] === 'h') {
            var cur = c.L(ids[0]);
            var r = cur.w / cur.h;
            v = Math.max(1, v);
            if (lockAsp) { p.w = x[0] === 'w' ? v : v * r; p.h = x[0] === 'h' ? v : v / r; }
            else p[x[0]] = v;
          } else p[x[0]] = x[0] === 'rotation' ? ((v % 360) + 360) % 360 : v;
          c.patch(ids, p);
          var now = c.L(ids[0]);
          f.querySelectorAll('input').forEach(function (inp) { if (inp !== e.target) inp.value = Math.round(now[inp.getAttribute('data-k')] || 0); });
        });
        f.appendChild(lab);
      });
      s3.querySelector('.sx-sec-body').appendChild(f);
      var fl = c.h('<div class="sx-row"></div>');
      fl.appendChild(btn(c, 'Flip horizontal', 'flip', 'btn btn-ghost btn-sm', function () { var cur = c.L(ids[0]); c.patch(ids, { flipX: !cur.flipX }); }));
      fl.appendChild(btn(c, 'Flip vertical', 'flipV', 'btn btn-ghost btn-sm', function () { var cur = c.L(ids[0]); c.patch(ids, { flipY: !cur.flipY }); }));
      s3.querySelector('.sx-sec-body').appendChild(fl);
      body.appendChild(s3);
    }
  }
  function layerList(c, body) {
    var d = c.doc();
    var selIds = c.sel();
    var ul = c.h('<ol class="sx-layers" aria-label="Layers, top first"></ol>');
    var byGroup = {};
    d.layers.forEach(function (l) { if (l.groupId) (byGroup[l.groupId] = byGroup[l.groupId] || []).push(l); });
    var top = d.layers.filter(function (l) { return !l.groupId; }).reverse();
    function item(l, depth) {
      var li = c.h('<li class="sx-layer' + (selIds.indexOf(l.id) >= 0 ? ' is-on' : '') + (l.visible === false ? ' is-hidden' : '') + '" data-id="' + c.esc(l.id) + '" style="--depth:' + depth + '"><span class="sx-layer-grip" aria-hidden="true">⋮⋮</span><span class="sx-layer-thumb">' + c.ic(TYPE_IC[l.type] || 'layers') + '</span><button type="button" class="sx-layer-name">' + c.esc(shownName(l)) + '</button><button type="button" class="sx-iconbtn sx-layer-eye" aria-label="' + (l.visible === false ? 'Show' : 'Hide') + ' layer" aria-pressed="' + (l.visible !== false) + '">' + c.ic(l.visible === false ? 'eyeOff' : 'eye') + '</button><button type="button" class="sx-iconbtn sx-layer-lock" aria-label="' + (l.locked ? 'Unlock' : 'Lock') + ' layer" aria-pressed="' + !!l.locked + '">' + c.ic(l.locked ? 'lock' : 'unlock') + '</button></li>');
      if (l.type === 'image') c.thumbUrl(l.src).then(function (u) { if (u) li.querySelector('.sx-layer-thumb').innerHTML = '<img alt="" src="' + u + '">'; });
      if (l.type === 'text') li.querySelector('.sx-layer-thumb').innerHTML = '<b style="font-family:' + c.esc(c.fontCss(l.font)) + '">Aa</b>';
      if (l.type === 'shape' || l.type === 'path') li.querySelector('.sx-layer-thumb').style.color = l.type === 'path' ? l.color : (l.fill && (l.fill.color || (l.fill.colors && l.fill.colors[0]))) || '';
      var nameBtn = li.querySelector('.sx-layer-name');
      nameBtn.onclick = function (e) {
        var cur = c.sel();
        if (e.shiftKey || e.ctrlKey || e.metaKey) c.scene.select(cur.indexOf(l.id) >= 0 ? cur.filter(function (x) { return x !== l.id; }) : cur.concat([l.id]));
        else c.scene.select([l.id]);
      };
      nameBtn.ondblclick = function () {
        var input = c.h('<input class="sx-input sx-layer-rename" maxlength="60" value="' + c.esc(shownName(l)) + '" aria-label="Layer name">');
        nameBtn.replaceWith(input);
        input.focus();
        input.select();
        function done() { var v = input.value.trim(); if (v) c.patch(l.id, { name: v }); c.renderPanel(true); }
        input.addEventListener('blur', done);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = ''; input.blur(); } });
      };
      li.querySelector('.sx-layer-eye').onclick = function () { c.patch(l.id, { visible: l.visible === false }); };
      li.querySelector('.sx-layer-lock').onclick = function () { c.scene.lock(l.id, !l.locked); c.renderPanel(true); };
      ul.appendChild(li);
      if (l.type === 'group') (byGroup[l.id] || []).slice().reverse().forEach(function (k2) { item(k2, depth + 1); });
    }
    top.forEach(function (l) { item(l, 0); });
    if (!d.layers.length) body.appendChild(note(c, 'Nothing on this page yet.'));
    body.appendChild(ul);
    reorder(c, ul);
    var tools = c.h('<div class="sx-row-between"></div>');
    if (selIds.length > 1) tools.appendChild(btn(c, 'Group', 'group', 'btn btn-ghost btn-sm', function () { c.scene.group(selIds); }));
    var one = c.one();
    if (one && one.type === 'group') tools.appendChild(btn(c, 'Ungroup', 'ungroup', 'btn btn-ghost btn-sm', function () { c.scene.ungroup(one.id); }));
    if (tools.children.length) body.appendChild(tools);
    body.appendChild(note(c, 'Drag to reorder. Double-click a name to rename. Shift-click to select several.'));
  }
  function labelOf(l) {
    if (l.type === 'text') return String(l.text || 'Text').split('\n')[0].slice(0, 28);
    return ({ image: 'Photo', shape: 'Shape', svg: 'Graphic', path: 'Drawing', group: 'Group' })[l.type] || 'Layer';
  }
  function shownName(l) {
    if (l.type === 'text' && (!l.name || /^Text \d+$/.test(l.name))) return labelOf(l);
    return l.name || labelOf(l);
  }
  function reorder(c, ul) {
    var drag = null;
    ul.addEventListener('pointerdown', function (e) {
      var grip = e.target.closest('.sx-layer-grip');
      if (!grip) return;
      var li = grip.closest('.sx-layer');
      if (li.style.getPropertyValue('--depth') !== '0') return;
      e.preventDefault();
      drag = { li: li, id: li.getAttribute('data-id'), y: e.clientY };
      c.S.panelDrag = true;
      li.classList.add('is-drag');
      ul.setPointerCapture(e.pointerId);
    });
    ul.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.li.style.transform = 'translateY(' + (e.clientY - drag.y) + 'px)';
      var items = [].slice.call(ul.querySelectorAll('.sx-layer')).filter(function (x) { return x !== drag.li && x.style.getPropertyValue('--depth') === '0'; });
      items.forEach(function (x) { x.classList.remove('is-over-top', 'is-over-bottom'); });
      var tgt = items.filter(function (x) { var r = x.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; })[0];
      if (tgt) { var r = tgt.getBoundingClientRect(); tgt.classList.add(e.clientY < r.top + r.height / 2 ? 'is-over-top' : 'is-over-bottom'); }
      drag.target = tgt || null;
      drag.after = tgt ? e.clientY >= tgt.getBoundingClientRect().top + tgt.getBoundingClientRect().height / 2 : false;
    });
    function end() {
      if (!drag) return;
      var d = drag;
      drag = null;
      c.S.panelDrag = false;
      if (d.target) {
        var layers = c.doc().layers;
        var tid = d.target.getAttribute('data-id');
        var ti = -1;
        layers.forEach(function (l, i) { if (l.id === tid) ti = i; });
        var fi = -1;
        layers.forEach(function (l, i) { if (l.id === d.id) fi = i; });
        if (ti >= 0 && fi >= 0) {
          var dest = d.after ? ti : ti + 1;
          if (fi < dest) dest -= 1;
          if (d.after && fi > ti) dest = ti;
          if (!d.after && fi < ti) dest = ti;
          if (d.after && fi < ti) dest = ti - 1;
          c.scene.order(d.id, c.clamp(dest, 0, layers.length - 1));
        }
      }
      c.renderPanel(true);
    }
    ul.addEventListener('pointerup', end);
    ul.addEventListener('pointercancel', end);
  }

  /* ---------- Recipes ---------- */
  P.recipes = {
    title: 'Recipes', eyebrow: 'Reusable looks (.leworkflow)', select: true,
    render: function (c, body, o) {
      var img = c.targetImage();
      var all = LE.recipes.builtins.concat(LE.userRecipes.all());
      if (c.S.handoffRecipe && !all.some(function (r) { return r.metadata.id === c.S.handoffRecipe.metadata.id; })) all.unshift(c.S.handoffRecipe);
      var active = o.recipe || (c.S.lastRecipe && c.S.lastRecipe.id);
      var top = c.h('<div class="sx-row-between"></div>');
      top.appendChild(btn(c, 'Import .leworkflow', 'file', 'btn btn-ghost btn-sm', function () { c.pickFiles('recipe'); }));
      top.appendChild(btn(c, 'Browse library', 'recipes', 'btn btn-ghost btn-sm', function () { location.href = '../recipes/'; }));
      body.appendChild(top);
      c.S.onRecipeFile = function (file) {
        if (file.size > 2000000) { c.toast('That recipe file is too large.'); return; }
        file.text().then(function (txt) {
          var v = LE.recipes.validate(txt);
          if (!v.ok) { c.toast(v.errors[0] || 'That is not a valid recipe.'); return; }
          LE.userRecipes.save(v.workflow);
          c.toast('Imported “' + v.workflow.metadata.name + '”');
          c.openPanel('recipes', { recipe: v.workflow.metadata.id });
        });
      };
      if (!img) { noImage(c, body, 'apply a recipe'); }
      var list = c.h('<div class="sx-recipes"></div>');
      all.forEach(function (r) {
        var on = r.metadata.id === active;
        var card = c.h('<div class="sx-recipe' + (on ? ' is-on' : '') + '"><button type="button" class="sx-recipe-main"><b>' + c.esc(r.metadata.name) + '</b><small>' + c.esc(r.metadata.description || '') + '</small><span class="sx-recipe-tags">' + r.steps.map(function (s) { return '<i>' + c.esc(s.label || s.operation) + '</i>'; }).join('') + '</span></button></div>');
        card.querySelector('.sx-recipe-main').onclick = function () { if (img) apply(c, img.id, r, null); c.S.lastRecipe = { id: r.metadata.id }; c.openPanel('recipes', { recipe: r.metadata.id }); };
        if (on && img) {
          var p = r.parameters && r.parameters[0];
          var ctl = c.h('<div class="sx-recipe-ctl"></div>');
          ctl.appendChild(c.ui.slider({ label: p ? p.label : 'Intensity', min: 0, max: 100, value: c.S.lastRecipe && c.S.lastRecipe.intensity != null ? c.S.lastRecipe.intensity : (p ? p.default : 100), fmt: function (v) { return v + '%'; }, onInput: function (v, key) { apply(c, img.id, r, v, key); } }));
          var row = c.h('<div class="sx-row-between"></div>');
          row.appendChild(btn(c, 'Remove look', 'reset', 'btn btn-ghost btn-sm', function () { c.patch(img.id, { adjust: {}, filter: null }); c.S.lastRecipe = null; c.openPanel('recipes'); }));
          row.appendChild(btn(c, 'Export', 'share', 'btn btn-ghost btn-sm', function () { c.download(new Blob([LE.recipes.stringify ? LE.recipes.stringify(r) : JSON.stringify(r, null, 2)], { type: 'application/json' }), c.safeName(r.metadata.name) + '.leworkflow'); }));
          ctl.appendChild(row);
          card.appendChild(ctl);
        }
        list.appendChild(card);
      });
      body.appendChild(list);
      if (img) {
        var s = c.ui.section('Save your look');
        var form = c.h('<form class="sx-form"><label>Name<input class="sx-input" maxlength="60" placeholder="My signature look"></label><div class="sx-row-end"><button type="submit" class="btn btn-ghost btn-sm">Save recipe</button><button type="button" class="btn btn-ghost btn-sm" data-x>Export .leworkflow</button></div></form>');
        function wf() {
          var cur = c.L(img.id);
          var name = form.querySelector('input').value.trim() || 'My look';
          var steps = c.lookSteps(cur).map(function (s2, i) { return Object.assign({ id: 'step-' + (i + 1), label: s2.operation, enabled: true }, s2); });
          var v = LE.recipes.validate({ format: 'localeditor-workflow', version: '1.0', metadata: { id: 'my-' + Date.now().toString(36), name: name, description: 'Saved from the studio.', author: 'You', category: 'personal', tags: ['studio'] }, compatibility: { minimumEditorVersion: '1.0', mobileSupported: true }, parameters: [{ id: 'intensity', label: 'Effect intensity', type: 'slider', min: 0, max: 100, default: 100 }], steps: steps, export: { format: 'jpeg', quality: 90 } });
          if (!v.ok) { c.toast(v.errors[0]); return null; }
          return v.workflow;
        }
        form.onsubmit = function (e) { e.preventDefault(); var w = wf(); if (!w) return; if (!w.steps.length) { c.toast('Adjust the photo first, then save the look.'); return; } LE.userRecipes.save(w); c.toast('Saved to your recipes'); c.openPanel('recipes', { recipe: w.metadata.id }); };
        form.querySelector('[data-x]').onclick = function () { var w = wf(); if (w) c.download(new Blob([JSON.stringify(w, null, 2)], { type: 'application/json' }), c.safeName(w.metadata.name) + '.leworkflow'); };
        s.querySelector('.sx-sec-body').appendChild(form);
        body.appendChild(s);
      }
    }
  };
  function apply(c, id, r, intensity, key) {
    var prep = LE.recipes.prepare(r, { intensity: intensity == null ? undefined : intensity, allowSkip: true });
    var look = c.recipeLook(prep.steps);
    c.patch(id, { adjust: look.adjust, filter: look.filter }, key);
    c.S.lastRecipe = { id: r.metadata.id, intensity: intensity };
    if (intensity == null) {
      var skipped = look.skipped.concat((prep.notices || []).filter(function (n) { return n.level === 'unavailable'; }).map(function (n) { return n.label; }));
      c.toast('Applied “' + r.metadata.name + '” live' + (skipped.length ? ' — skipped: ' + skipped.join(', ') : ''));
    }
  }

  /* ---------- Projects ---------- */
  P.projects = {
    title: 'Your designs', eyebrow: 'Saved on this device',
    render: function (c, body) {
      var top = c.h('<div class="sx-row-between"></div>');
      top.appendChild(btn(c, 'New design', 'plus', 'btn btn-gold btn-sm', function () { c.cmd('newDesign'); }));
      top.appendChild(btn(c, 'Import .leproject', 'file', 'btn btn-ghost btn-sm', function () { c.pickFiles('project'); }));
      body.appendChild(top);
      if (c.S.project) {
        var cur = c.h('<div class="sx-row-between"></div>');
        cur.appendChild(btn(c, 'Save a version', 'save', 'btn btn-ghost btn-sm', function () { c.checkpoint(); }));
        cur.appendChild(btn(c, 'Export this design', 'share', 'btn btn-ghost btn-sm', function () { c.exportProject(); }));
        body.appendChild(cur);
      }
      var g = c.h('<div class="sx-proj-grid"><div class="sx-loading">Loading…</div></div>');
      body.appendChild(g);
      var drop = c.h('<div class="sx-dropzone">' + c.ic('file') + '<span>Drop a <b>.leproject</b> file here to import it</span></div>');
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('is-over'); var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) c.importProject(f); });
      body.appendChild(drop);
      var store = c.ui.section('Storage');
      var sb = store.querySelector('.sx-sec-body');
      body.appendChild(store);
      LE.project.list().then(function (list) {
        g.innerHTML = '';
        if (!list.length) g.appendChild(note(c, 'No saved designs yet. Everything you make is saved here automatically.'));
        list.forEach(function (p) { g.appendChild(projectCard(c, p)); });
      });
      storage(c, sb);
      var lg = c.ui.section('Activity');
      body.appendChild(lg);
      ledger(c, lg.querySelector('.sx-sec-body'), null);
    }
  };
  function storage(c, sb) {
    sb.innerHTML = '<div class="sx-loading">Measuring…</div>';
    LE.project.usage().then(function (u) {
      sb.innerHTML = '';
      var used = u.projects + u.assets + u.versions;
      var pct = u.quota ? Math.min(100, used / u.quota * 100) : 0;
      sb.appendChild(c.h('<div class="sx-usage"><div class="sx-usage-bar"><i style="width:' + Math.max(2, pct).toFixed(1) + '%"></i></div><div class="sx-usage-rows"><span>Designs <b>' + c.fmtBytes(u.projects) + '</b></span><span>Photos <b>' + c.fmtBytes(u.assets) + '</b> (' + u.counts.assets + ')</span><span>Versions <b>' + c.fmtBytes(u.versions) + '</b></span>' + (u.quota ? '<span>Browser space <b>' + c.fmtBytes(u.usage || 0) + ' / ' + c.fmtBytes(u.quota) + '</b></span>' : '') + '</div></div>'));
      sb.appendChild(btn(c, 'Clean up unused photos', 'trash', 'btn btn-ghost btn-sm', function () {
        LE.project.gc({ grace: 0 }).then(function (r) { if (c.S.project) c.saveNow(); c.toast(r.removed ? 'Freed ' + c.fmtBytes(r.freed) + ' (' + r.removed + ' photo' + (r.removed > 1 ? 's' : '') + ')' : 'Nothing to clean up'); storage(c, sb); });
      }));
      if (window.LEPwa) sb.appendChild(btn(c, 'Manage all storage on this device', 'download', 'btn btn-ghost btn-sm', function () { LEPwa.openStorage(); }));
    }).catch(function () { sb.innerHTML = ''; sb.appendChild(note(c, 'Storage details are not available in this browser.')); });
  }
  var LEDGER_TXT = { created: 'Created', opened: 'Opened', autosaved: 'Autosaved', checkpoint: 'Saved a version', exported: 'Exported', imported: 'Imported', deleted: 'Deleted', restored: 'Restored a version', duplicated: 'Duplicated', renamed: 'Renamed', gc: 'Cleaned up storage', resized: 'Resized', 'size-reverted': 'Reverted a resize' };
  function ledger(c, host, id) {
    LE.project.ledger(id).then(function (rows) {
      if (!rows.length) { host.appendChild(note(c, 'No activity yet.')); return; }
      var ul = c.h('<ol class="sx-ledger"></ol>');
      rows.slice(0, 40).forEach(function (r) {
        var d = r.detail || {};
        var extra = d.name ? ' “' + d.name + '”' : '';
        if (r.type === 'exported' && d.format) extra += ' as ' + String(d.format).toUpperCase();
        if (d.label) extra += ' — ' + d.label;
        if (d.to && d.to.w) extra += ' (' + d.to.w + ' × ' + d.to.h + ')';
        ul.appendChild(c.h('<li><span class="sx-ledger-dot sx-ledger-' + c.esc(r.type) + '"></span><span>' + c.esc((LEDGER_TXT[r.type] || r.type) + extra) + '</span><time>' + when(r.at) + '</time></li>'));
      });
      host.appendChild(ul);
    }).catch(function () {});
  }

  /* ---------- History (versions) ---------- */
  P.history = {
    title: 'Version history', eyebrow: 'Autosaves & checkpoints',
    render: function (c, body) {
      if (needProject(c, body)) return;
      var id = c.S.project.id;
      var form = c.h('<form class="sx-form sx-inline"><input class="sx-input" maxlength="60" placeholder="Name this version (optional)" aria-label="Version name"><button type="submit" class="btn btn-gold btn-sm">' + c.ic('save') + 'Save version</button></form>');
      form.onsubmit = function (e) { e.preventDefault(); c.checkpoint(form.querySelector('input').value.trim()); };
      body.appendChild(form);
      var host = c.h('<div class="sx-versions"><div class="sx-loading">Loading…</div></div>');
      body.appendChild(host);
      LE.project.versions(id).then(function (vs) {
        host.innerHTML = '';
        if (!vs.length) { host.appendChild(note(c, 'Versions are saved automatically as you work. Save a named version before big changes.')); return; }
        vs.forEach(function (v) {
          var card = c.h('<button type="button" class="sx-version' + (v.kind === 'checkpoint' ? ' is-check' : '') + '"><span class="sx-version-art"></span><span class="sx-version-txt"><b>' + c.esc(v.label || (v.kind === 'checkpoint' ? 'Version' : 'Autosave')) + '</b><small>' + when(v.at) + (v.doc ? ' · ' + v.doc.pages[0].width + '×' + v.doc.pages[0].height : '') + '</small></span><span class="sx-version-go">Preview</span></button>');
          if (v.thumb) { var im = new Image(); im.alt = ''; im.src = URL.createObjectURL(v.thumb); card.querySelector('.sx-version-art').appendChild(im); }
          card.onclick = function () { if (c.isPhone()) c.closePanel(); c.previewVersion(v); };
          host.appendChild(card);
        });
      });
      var sz = c.ui.section('Size history');
      body.appendChild(sz);
      renderSizeHistory(c, sz.querySelector('.sx-sec-body'));
      var lg = c.ui.section('Activity for this design');
      body.appendChild(lg);
      ledger(c, lg.querySelector('.sx-sec-body'), id);
    }
  };

  /* ---------- Export ---------- */
  P.export = {
    title: 'Download', eyebrow: 'Share your design',
    render: function (c, body) {
      if (needProject(c, body)) return;
      var o = c.S.exportOpts;
      var d = c.doc();
      var maxS = c.maxScale();
      function save() { c.lsSet('le-studio-export', o); }
      var s1 = c.ui.section('File type');
      s1.querySelector('.sx-sec-body').appendChild(c.ui.seg([['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP'], ['pdf', 'PDF']], o.format, function (v) { o.format = v; save(); c.renderPanel(true); }));
      s1.querySelector('.sx-sec-body').appendChild(note(c, o.format === 'png' ? 'Best for graphics and text. Supports transparency.' : o.format === 'jpeg' ? 'Smallest for photos. No transparency — the design is flattened.' : o.format === 'pdf' ? 'One PDF page per design page, sized to your design. Great for printing and sharing.' : 'Modern and small. Supports transparency.'));
      body.appendChild(s1);
      var s2 = c.ui.section('Size');
      var chips = c.h('<div class="sx-chips"></div>');
      [0.5, 1, 1.5, 2, 3, 4].forEach(function (sc) {
        var ok = sc <= maxS + 1e-6;
        var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (o.scale === sc) + '"' + (ok ? '' : ' disabled title="Too large for this device"') + '>' + sc + '×<small>' + Math.round(d.width * sc) + '×' + Math.round(d.height * sc) + '</small></button>');
        b.onclick = function () { o.scale = sc; save(); c.renderPanel(true); };
        chips.appendChild(b);
      });
      s2.querySelector('.sx-sec-body').appendChild(chips);
      if (o.scale > maxS) { o.scale = Math.max(0.5, Math.floor(maxS * 2) / 2); save(); }
      body.appendChild(s2);
      if (o.format !== 'png' && o.format !== 'pdf') {
        var s3 = c.ui.section('Quality');
        s3.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Quality', min: 40, max: 100, value: Math.round(o.quality * 100), fmt: function (v) { return v + '%'; }, onInput: function (v) { o.quality = v / 100; save(); est(); } }));
        body.appendChild(s3);
      }
      var s4 = c.ui.section('Options');
      var b4 = s4.querySelector('.sx-sec-body');
      if (o.format !== 'jpeg' && o.format !== 'pdf') b4.appendChild(c.ui.toggle('Transparent background', !!o.transparent, function (v) { o.transparent = v; save(); est(); }, 'Leaves the page background out.'));
      if (c.S.project.pages.length > 1) b4.appendChild(c.ui.seg([['current', 'This page'], ['all', 'All ' + c.S.project.pages.length + ' pages' + (o.format === 'pdf' ? '' : ' (zip)')]], o.pages || 'current', function (v) { o.pages = v; save(); }, 'sx-seg-sm'));
      var nm = c.h('<label class="sx-field"><span>File name</span><input class="sx-input" maxlength="80" value="' + c.esc(c.safeName(c.S.project.name)) + '"></label>');
      b4.appendChild(nm);
      body.appendChild(s4);
      var info = c.h('<div class="sx-export-info"><span class="sx-eyebrow">Estimated</span><strong>…</strong><small>Flattened on export · metadata (EXIF, GPS) removed · made on this device</small></div>');
      body.appendChild(info);
      var go = c.h('<button type="button" class="btn btn-gold btn-lg sx-block">' + c.ic('download') + '<span>Download</span></button>');
      go.onclick = function () {
        go.disabled = true;
        go.querySelector('span').textContent = 'Preparing…';
        c.exportImage({ name: nm.querySelector('input').value }).then(function (blob) {
          go.disabled = false;
          go.querySelector('span').textContent = 'Download';
          if (blob) c.toast('Downloaded ' + c.fmtBytes(blob.size));
        });
      };
      body.appendChild(go);
      var row = c.h('<div class="sx-row-between"></div>');
      if (navigator.clipboard && window.ClipboardItem) row.appendChild(btn(c, 'Copy image', 'clip', 'btn btn-ghost btn-sm', function () { c.exportImage({ clipboard: true }); }));
      if (navigator.canShare) row.appendChild(btn(c, 'Share…', 'share', 'btn btn-ghost btn-sm', function () {
        c.exportImage({ dryRun: true }).then(function (blob) {
          if (!blob) return;
          var ext = o.format === 'jpeg' ? 'jpg' : o.format;
          var f = new File([blob], c.safeName(c.S.project.name) + '.' + ext, { type: blob.type });
          if (navigator.canShare({ files: [f] })) navigator.share({ files: [f], title: c.S.project.name }).catch(function () {});
          else c.toast('Sharing files is not supported here — use Download.');
        });
      }));
      row.appendChild(btn(c, 'Save as .leproject', 'file', 'btn btn-ghost btn-sm', function () { c.exportProject(); }));
      body.appendChild(row);
      var token = 0;
      function est() {
        var my = ++token;
        info.querySelector('strong').textContent = '…';
        c.estimate().then(function (r) {
          if (my !== token) return;
          info.querySelector('strong').textContent = r.width + ' × ' + r.height + ' px' + (r.bytes ? ' · ~' + c.fmtBytes(r.bytes) : '');
        });
      }
      est();
    }
  };

  /* ---------- Settings ---------- */
  P.settings = {
    title: 'Performance', eyebrow: 'Speed, quality & storage',
    render: function (c, body) {
      var mode = LE.perf ? LE.perf.mode() : 'auto';
      var s = c.ui.section('Mode');
      s.querySelector('.sx-sec-body').appendChild(c.ui.seg([['auto', 'Auto'], ['quality', 'Best quality'], ['saver', 'Battery saver']], mode, function (v) { LE.perf.set(v); c.toast(v === 'saver' ? 'Battery saver — lighter previews, same exports' : v === 'quality' ? 'Best quality previews' : 'Automatic for this device'); c.renderPanel(true); }));
      s.querySelector('.sx-sec-body').appendChild(note(c, 'This device: ' + LE.device.tier() + ' tier. Battery saver uses smaller previews and skips blur and shadows while you edit. Downloads are always full quality.'));
      body.appendChild(s);
      var s2 = c.ui.section('Storage');
      body.appendChild(s2);
      storage(c, s2.querySelector('.sx-sec-body'));
      var s3 = c.ui.section('Offline');
      var b3 = s3.querySelector('.sx-sec-body');
      b3.appendChild(note(c, 'Fonts and graphics are fetched from this site the first time you use them, then cached. Save them all now to work fully offline.'));
      var go = btn(c, 'Save fonts & graphics for offline', 'download', 'btn btn-ghost btn-sm', function () {
        go.disabled = true;
        var p1 = LE.fonts && LE.fonts.saveAllOffline ? LE.fonts.saveAllOffline(function (p) { go.querySelector('span').textContent = 'Fonts ' + p.loaded + '/' + p.total; }) : Promise.resolve();
        p1.then(function () { return LE.assets && LE.assets.saveAllOffline ? LE.assets.saveAllOffline() : null; }).then(function () { go.querySelector('span').textContent = 'Saved for offline'; c.toast('Fonts and graphics are saved for offline use'); }).catch(function () { go.disabled = false; go.querySelector('span').textContent = 'Try again'; c.toast('Could not save everything — check your connection.'); });
      });
      b3.appendChild(go);
      body.appendChild(s3);
      if (window.LE && LE.support && LE.support.studioSettings) LE.support.studioSettings(c, body);
    }
  };

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
    },
    watermark: function (c, body) {
      if (needProject(c, body)) return;
      var st = { text: '© ' + new Date().getFullYear() + ' Your name', pos: 'br', opacity: 55, size: 32, color: '#FFFFFF', logo: '' };
      var form = c.h('<div class="sx-form"><label class="sx-field"><span>Text</span><input class="sx-input" maxlength="80" value="' + c.esc(st.text) + '"></label></div>');
      body.appendChild(form);
      var pos = c.ui.seg([['tl', '↖'], ['tr', '↗'], ['c', '●'], ['bl', '↙'], ['br', '↘'], ['tile', 'Tiled']], st.pos, function (v) { st.pos = v; }, 'sx-seg-sm');
      body.appendChild(pos);
      body.appendChild(c.ui.slider({ label: 'Size', min: 12, max: 120, value: st.size, onInput: function (v) { st.size = v; } }));
      body.appendChild(c.ui.slider({ label: 'Opacity', min: 5, max: 100, value: st.opacity, fmt: function (v) { return v + '%'; }, onInput: function (v) { st.opacity = v; } }));
      var sw = c.ui.swatchBtn(st.color, 'Color', function (b) { c.colorPop(b, { value: st.color, onChange: function (v) { st.color = v; c.paintSwatch(sw.querySelector('i'), v); } }); });
      body.appendChild(sw);
      var ids = Object.keys(c.S.project.assets || {}).filter(function (id) { return !/^background-/.test((c.S.project.assets[id] || {}).name || ''); });
      if (ids.length) {
        var ls = c.ui.section('Logo (optional)');
        var g = grid('sx-grid-4 sx-thumbs');
        ids.forEach(function (id) {
          var t = c.h('<button type="button" class="sx-thumb" aria-pressed="false" aria-label="Use as logo"><img alt=""></button>');
          c.thumbUrl(id).then(function (u) { if (u) t.querySelector('img').src = u; });
          t.onclick = function () { st.logo = st.logo === id ? '' : id; g.querySelectorAll('.sx-thumb').forEach(function (x) { x.setAttribute('aria-pressed', x === t && !!st.logo); }); };
          g.appendChild(t);
        });
        ls.querySelector('.sx-sec-body').appendChild(g);
        body.appendChild(ls);
      }
      body.appendChild(btn(c, 'Add watermark', 'stamp', 'btn btn-gold sx-block', function () {
        st.text = form.querySelector('input').value.trim();
        var d = c.doc();
        var W = d.width, H = d.height, kk = Math.min(W, H) / 1080;
        var size = st.size * kk;
        var mk = function (x, y, rot) {
          if (st.logo && c.mem[st.logo]) {
            var m = c.mem[st.logo];
            var lw = size * 4, lh = lw * m.canvas.height / m.canvas.width;
            return { type: 'image', src: st.logo, name: 'Watermark logo', x: x - lw / 2, y: y - lh / 2, w: lw, h: lh, opacity: st.opacity / 100, rotation: rot || 0 };
          }
          var w = Math.max(size * 2, st.text.length * size * 0.62);
          return { type: 'text', text: st.text, font: 'Plus Jakarta Sans', weight: 600, size: size, align: 'center', color: st.color, name: 'Watermark', x: x - w / 2, y: y - size * 0.7, w: w, h: size * 1.4, opacity: st.opacity / 100, rotation: rot || 0, shadow: { color: 'rgba(0,0,0,.35)', blur: 6 * kk, x: 0, y: 2 * kk } };
        };
        var m0 = 40 * kk;
        var list = [];
        if (st.pos === 'tile') {
          var stepX = Math.max(size * 10, W / 3), stepY = size * 6;
          for (var y = stepY / 2, row = 0; y < H + stepY; y += stepY, row++) for (var x = (row % 2 ? stepX / 2 : 0); x < W + stepX; x += stepX) list.push(mk(x, y, 330));
          list = list.slice(0, 80);
        } else {
          var w0 = Math.max(size * 2, st.text.length * size * 0.62) / 2;
          var px = st.pos === 'c' ? W / 2 : /l$/.test(st.pos) ? m0 + w0 : W - m0 - w0;
          var py = st.pos === 'c' ? H / 2 : /^t/.test(st.pos) ? m0 + size : H - m0 - size;
          list.push(mk(px, py, 0));
        }
        c.batch(function () {
          var made = list.map(function (l) { return c.scene.add(l); });
          var gid = made.length > 1 ? c.scene.group(made) : made[0];
          if (made.length > 1) c.patch(gid, { name: 'Watermark' });
          c.scene.select([gid]);
        });
        c.toast('Watermark added as a layer — edit or move it anytime');
      }));
    },
    meme: function (c, body) {
      if (needProject(c, body)) return;
      var form = c.h('<div class="sx-form"><label class="sx-field"><span>Top text</span><input class="sx-input" maxlength="120" value="WHEN THE EDITOR"></label><label class="sx-field"><span>Bottom text</span><input class="sx-input" maxlength="120" value="RUNS OFFLINE"></label></div>');
      body.appendChild(form);
      body.appendChild(btn(c, 'Add meme captions', 'meme', 'btn btn-gold sx-block', function () {
        var ins = form.querySelectorAll('input');
        var d = c.doc();
        var W = d.width, H = d.height, kk = Math.min(W, H) / 1080;
        var size = 96 * kk;
        var mk = function (t, y) { return { type: 'text', text: t.toUpperCase(), font: 'Anton', weight: 400, size: size, align: 'center', color: '#FFFFFF', stroke: { width: 6 * kk, color: '#000000' }, name: 'Meme caption', x: W * 0.04, y: y, w: W * 0.92, h: size * 1.25, lineHeight: 1.05 }; };
        var list = [];
        if (ins[0].value.trim()) list.push(mk(ins[0].value.trim(), H * 0.03));
        if (ins[1].value.trim()) list.push(mk(ins[1].value.trim(), H * 0.97 - size * 1.25));
        c.batch(function () { var made = list.map(function (l) { return c.scene.add(l); }); c.scene.select(made); });
      }));
      body.appendChild(note(c, 'Captions are normal text layers — double-click to edit.'));
    },
    palette: function (c, body) {
      if (needProject(c, body)) return;
      var art = c.artboard(480);
      if (!art) { body.appendChild(note(c, 'Nothing to sample yet.')); return; }
      var cols = LE.palette.extract(art, 6);
      var g = c.h('<div class="sx-palette"></div>');
      cols.forEach(function (col) {
        var b = c.h('<button type="button" class="sx-pal" aria-label="Copy ' + col.hex + '"><i style="background:' + col.hex + '"></i><b>' + col.hex.toUpperCase() + '</b><small>hsl ' + col.hsl.join(' ') + '</small></button>');
        b.onclick = function () { copy(c, col.hex.toUpperCase()); };
        g.appendChild(b);
      });
      body.appendChild(g);
      var row = c.h('<div class="sx-row-between"></div>');
      row.appendChild(btn(c, 'Copy CSS', 'clip', 'btn btn-ghost btn-sm', function () { copy(c, ':root {\n' + cols.map(function (x, i) { return '  --brand-' + (i + 1) + ': ' + x.hex + ';'; }).join('\n') + '\n}'); }));
      row.appendChild(btn(c, 'Copy JSON', 'clip', 'btn btn-ghost btn-sm', function () { copy(c, JSON.stringify(cols.map(function (x) { return x.hex; }))); }));
      row.appendChild(btn(c, 'Swatch PNG', 'download', 'btn btn-ghost btn-sm', function () { LE.toBlob(LE.palette.swatch(cols), 'image/png').then(function (b) { c.download(b, 'palette.png'); }); }));
      body.appendChild(row);
      body.appendChild(btn(c, 'Add to document colors', 'palette', 'btn btn-gold btn-sm sx-block', function () { var st = c.studio(); st.docColors = cols.map(function (x) { return x.hex; }); c.markDirty(); c.toast('Added to document colors'); }));
    },
    metadata: function (c, body) {
      var img = c.targetImage();
      if (!img) return noImage(c, body, 'read its metadata');
      var host = c.h('<div class="sx-meta"><div class="sx-loading">Reading…</div></div>');
      body.appendChild(host);
      LE.project.getAsset(img.src).then(function (blob) { return LE.exif(blob); }).then(function (x) {
        host.innerHTML = '';
        var rows = [['Camera', [x.make, x.model].filter(Boolean).join(' ')], ['Taken', x.date], ['ISO', x.iso], ['Aperture', x.aperture ? 'f/' + x.aperture : ''], ['Focal length', x.focalLength ? x.focalLength + ' mm' : ''], ['Location', x.latitude != null ? x.latitude.toFixed(5) + ', ' + x.longitude.toFixed(5) : ''], ['Orientation', x.orientation], ['File', (x.type || '') + (x.bytes ? ' · ' + c.fmtBytes(x.bytes) : '')], ['Pixels', c.mem[img.src] ? c.mem[img.src].canvas.width + ' × ' + c.mem[img.src].canvas.height : '']];
        var dl = c.h('<dl class="sx-dl"></dl>');
        var any = false;
        rows.forEach(function (r) { if (r[1] === '' || r[1] == null) return; any = true; dl.appendChild(c.h('<div><dt>' + c.esc(r[0]) + '</dt><dd>' + c.esc(r[1]) + '</dd></div>')); });
        host.appendChild(any ? dl : note(c, 'This photo has no camera metadata.'));
        host.appendChild(note(c, x.latitude != null ? 'This photo contains GPS location. Every download from the studio strips it.' : 'Downloads from the studio never include EXIF or location data.', x.latitude != null ? 'is-warn' : ''));
      }).catch(function () { host.innerHTML = ''; host.appendChild(note(c, 'No metadata could be read from this photo.')); });
    },
    compare: function (c, body) {
      if (needProject(c, body)) return;
      body.appendChild(note(c, 'Press and hold “Hold to compare” (or the \\ key) to flick between your edits and the original photo.'));
      var hold = c.h('<button type="button" class="btn btn-ghost sx-block" data-cmd="compareHold">' + c.ic('compare') + '<span>Hold to compare</span></button>');
      body.appendChild(hold);
      body.appendChild(btn(c, 'Download before / after image', 'download', 'btn btn-gold sx-block', function () {
        var img = c.targetImage();
        if (!img || !c.mem[img.src]) { c.toast('Select a photo first.'); return; }
        var before = LE.fit(c.mem[img.src].canvas, 1600);
        c.scene.render(Math.min(1, 1600 / Math.max(c.doc().width, c.doc().height))).then(function (after) {
          return LE.exportImage(LE.sideBySide(before, after, { before: 'Original', after: 'Edited' }), { format: 'jpeg', quality: 0.9 });
        }).then(function (b) { c.download(b, 'before-after.jpg'); });
      }));
    },
    batch: function (c, body) {
      var img = c.targetImage();
      var steps = img ? c.lookSteps(img) : [];
      body.appendChild(note(c, steps.length ? 'Applies the current look (' + steps.map(function (s) { return s.operation === 'filter' ? s.parameters.name : s.operation; }).join(', ') + ') to many photos, then downloads a zip.' : 'Adjust a photo first — its look will be applied to every photo you pick.'));
      var o = { max: 2048, format: 'jpeg', quality: 0.88 };
      body.appendChild(c.ui.seg([['jpeg', 'JPG'], ['webp', 'WebP'], ['png', 'PNG']], o.format, function (v) { o.format = v; }, 'sx-seg-sm'));
      body.appendChild(c.ui.slider({ label: 'Longest edge', min: 512, max: 6000, step: 64, value: o.max, fmt: function (v) { return v + ' px'; }, onInput: function (v) { o.max = v; } }));
      var prog = c.h('<div class="sx-progress" hidden><i></i><span></span></div>');
      body.appendChild(btn(c, 'Choose photos…', 'batch', 'btn btn-gold sx-block', function () { c.pickFiles('batch'); }));
      body.appendChild(prog);
      c.S.onBatchFiles = function (files) {
        files = files.filter(function (f) { return /^image\//.test(f.type); }).slice(0, 200);
        if (!files.length) return;
        prog.hidden = false;
        var out = [];
        var chain = Promise.resolve();
        files.forEach(function (f, i) {
          chain = chain.then(function () {
            prog.querySelector('span').textContent = (i + 1) + ' / ' + files.length + ' · ' + f.name;
            prog.querySelector('i').style.width = ((i + 1) / files.length * 100) + '%';
            return LE.load(f).then(function (cv) { return LE.applySteps(LE.fit(cv, o.max), steps); }).then(function (r) { return LE.exportImage(r.canvas, { format: o.format, quality: o.quality }); }).then(function (b) { return b.arrayBuffer(); }).then(function (buf) {
              var ext = o.format === 'jpeg' ? 'jpg' : o.format;
              out.push({ name: ('0' + (i + 1)).slice(-2) + '-' + f.name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').slice(0, 40) + '.' + ext, data: new Uint8Array(buf) });
            }).catch(function () {});
          });
        });
        chain.then(function () {
          prog.querySelector('span').textContent = 'Done — ' + out.length + ' photos';
          if (out.length) c.download(LE.zip(out), 'localeditor-batch.zip');
        });
      };
    },
    upscale: function (c, body) {
      var tier = LE.device.tier();
      body.appendChild(note(c, LE.capabilities.message('upscale-ai', tier)));
      body.appendChild(note(c, 'You can still export at up to ' + Math.floor(c.maxScale() * 10) / 10 + '× using high-quality resampling. Text, shapes and stickers are re-rendered sharply at the bigger size.'));
      body.appendChild(btn(c, 'Export at 2×', 'upscale', 'btn btn-gold sx-block', function () { c.S.exportOpts.scale = Math.min(2, Math.floor(c.maxScale() * 2) / 2); c.lsSet('le-studio-export', c.S.exportOpts); c.openPanel('export'); }));
    },
    contact: function (c, body) {
      if (needProject(c, body)) return;
      var ids = Object.keys(c.S.project.assets || {}).filter(function (id) { return !/^background-/.test((c.S.project.assets[id] || {}).name || ''); });
      var cols = 3;
      body.appendChild(c.ui.slider({ label: 'Columns', min: 1, max: 6, value: cols, onInput: function (v) { cols = v; } }));
      body.appendChild(btn(c, 'Download contact sheet', 'sheet', 'btn btn-gold sx-block', function () {
        if (!ids.length) { c.toast('Upload some photos first.'); return; }
        var imgs = ids.filter(function (id) { return c.mem[id]; }).map(function (id) { var cv = LE.fit(c.mem[id].canvas, 600); cv.name = c.mem[id].meta.name; return { canvas: cv, name: c.mem[id].meta.name }; });
        LE.exportImage(LE.contactSheet(imgs, { columns: cols, names: true }), { format: 'jpeg', quality: 0.9 }).then(function (b) { c.download(b, 'contact-sheet.jpg'); });
      }));
      body.appendChild(note(c, ids.length + ' photo' + (ids.length === 1 ? '' : 's') + ' in this design.'));
    }
  };
  function copy(c, text) {
    var p = window.IT && IT.copy ? IT.copy(text) : navigator.clipboard.writeText(text);
    Promise.resolve(p).then(function () { c.toast('Copied'); }).catch(function () { c.toast('Copy failed'); });
  }
  P._u = {
    tabs: tabs, searchBox: searchBox, grid: grid, btn: btn, note: note, needProject: needProject, svgUrl: svgUrl, draggable: draggable,
    sec: sec, tile: tile, lazyGrid: lazyGrid, loading: loading, removeBg: removeBg, guessBg: guessBg, shapeThumb: shapeThumb, k: k, copy: copy
  };
})();
