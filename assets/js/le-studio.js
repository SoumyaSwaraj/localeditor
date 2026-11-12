/* LocalEditor photo studio: a live, layered design editor on LE.Scene. Originals are never changed. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.Scene || !LE.project) return;
  var PANELS = window.LEStudioPanels || {};
  var HOOKS = PANELS._hooks = PANELS._hooks || {};
  function fire(name, a, b) {
    var out;
    (HOOKS[name] || []).forEach(function (f) {
      try { var r = f(ctx, a, b); if (r) out = r; } catch (err) { console.error(err); }
    });
    return out;
  }
  /* For hooks where every module contributes markup (toolbar-add): all non-empty strings, in registration order. */
  function fireAll(name, a, b) {
    var out = '';
    (HOOKS[name] || []).forEach(function (f) {
      try { var r = f(ctx, a, b); if (typeof r === 'string') out += r; } catch (err) { console.error(err); }
    });
    return out;
  }

  function byId(id) { return document.getElementById(id); }
  var root = byId('sx');
  var E = {
    head: byId('sx-head'), rail: byId('sx-rail'), panel: byId('sx-panel'), panelHead: byId('sx-panel-head'), panelBody: byId('sx-panel-body'),
    grip: byId('sx-grip'), main: byId('sx-main'), tool: byId('sx-tool'), stage: byId('sx-stage'), sceneEl: byId('sx-scene'), mini: byId('sx-mini'),
    bar: byId('sx-bar'), pick: byId('sx-pick'), drop: byId('sx-drop'), start: byId('sx-start'), foot: byId('sx-foot'), tabs: byId('sx-tabs'),
    pop: byId('sx-pop'), modal: byId('sx-modal'), toast: byId('sx-toast'), file: byId('sx-file'), fileProject: byId('sx-file-project'),
    fileRecipe: byId('sx-file-recipe'), fileBatch: byId('sx-file-batch')
  };

  /* ---------- Icons ---------- */
  var I = {
    design: '<rect x="3" y="3" width="18" height="7" rx="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.6"/><rect x="14" y="13" width="7" height="8" rx="1.6"/>',
    elements: '<circle cx="7.5" cy="7.5" r="4"/><rect x="13" y="13" width="8" height="8" rx="1.6"/><path d="M17 3.5l3.8 6.5h-7.6z"/><path d="M4 20l3.5-6 3.5 6z"/>',
    text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
    uploads: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    draw: '<path d="M4 20l1.2-4.4L16.6 4.2a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.4 18.8z"/><path d="M14.5 6.3l3.2 3.2"/>',
    adjust: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    filters: '<circle cx="9" cy="9.5" r="5.5"/><circle cx="15" cy="9.5" r="5.5"/><circle cx="12" cy="14.5" r="5.5"/>',
    background: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 15.5l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8" r="1.5"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
    recipes: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v3h3M9 11h6M9 15h4"/>',
    projects: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    apps: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="3.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M17 13.5v7M13.5 17h7"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l.9 12.1A2 2 0 0 0 8.4 21h7.2a2 2 0 0 0 2-1.9L18.5 7M9 7V4.5h6V7"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.5 6.8C4 8.5 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    crop: '<path d="M6.5 2.5v13a2 2 0 0 0 2 2h13"/><path d="M17.5 21.5v-13a2 2 0 0 0-2-2h-13"/>',
    flip: '<path d="M12 3v18"/><path d="M8.5 7.5L3.5 12l5 4.5zM15.5 7.5l5 4.5-5 4.5z"/>',
    flipV: '<path d="M3 12h18"/><path d="M7.5 8.5L12 3.5l4.5 5zM7.5 15.5l4.5 5 4.5-5z"/>',
    rotate: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1L20.5 8"/><path d="M20.5 3.5V8H16"/>',
    opacity: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 7h5.6M12 11h8.4M12 15h7.7M12 19h3.5"/>',
    position: '<rect x="3.5" y="3.5" width="11" height="11" rx="2.5"/><path d="M9.5 20.5h9a2 2 0 0 0 2-2v-9"/>',
    group: '<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="3 3"/><rect x="7" y="7" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/>',
    ungroup: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/><path d="M15 3.5h3.5a2 2 0 0 1 2 2V9M9 20.5H5.5a2 2 0 0 1-2-2V15"/>',
    alignL: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
    alignC: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
    alignR: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
    bold: '<path d="M7 4.5h6.2a3.7 3.7 0 0 1 0 7.5H7zM7 12h7.3a3.8 3.8 0 0 1 0 7.5H7z"/>',
    italic: '<path d="M19 4.5h-8M13 19.5H5M15 4.5l-6 15"/>',
    underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20.5h14"/>',
    strike: '<path d="M16.5 6.5A4.5 4.5 0 0 0 12 4C9.5 4 8 5.5 8 7.4c0 1.7 1.2 2.7 3 3.4M7.5 17a4.8 4.8 0 0 0 4.5 3c2.7 0 4.5-1.5 4.5-3.6 0-1.1-.4-1.9-1.1-2.6M4 12h16"/>',
    upper: '<path d="M3 18l4-11 4 11M4.6 14h4.8M14 18V7h3.4a2.7 2.7 0 0 1 0 5.4H14M14 12.4h4a2.8 2.8 0 0 1 0 5.6h-4"/>',
    list: '<path d="M9.5 6h11M9.5 12h11M9.5 18h11"/><circle cx="4.8" cy="6" r="1.1"/><circle cx="4.8" cy="12" r="1.1"/><circle cx="4.8" cy="18" r="1.1"/>',
    spacing: '<path d="M4 4v16M20 4v16M8 12h8M10.5 9L8 12l2.5 3M13.5 9l2.5 3-2.5 3"/>',
    sparkle: '<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 15.5L16.5 11 7 19"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    back: '<path d="M14.5 18l-6-6 6-6"/>',
    chev: '<path d="M7 10l5 5 5-5"/>',
    right: '<path d="M9.5 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
    gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13l4-4"/><circle cx="12" cy="13" r="1.2"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5M12 7.5V12l3 2"/>',
    compare: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 2.5v19"/><path d="M3 15l4.5-4 4.5 4" />',
    pipette: '<path d="M14.5 4.5l5 5M16.8 2.2a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L19 10l-5-5zM14 7.5l-9 9V20h3.5l9-9"/>',
    replace: '<path d="M4 7.5h12.5l-3-3M20 16.5H7.5l3 3"/>',
    reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
    front: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5" fill="currentColor" fill-opacity=".18"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    back2: '<rect x="3.5" y="3.5" width="12" height="12" rx="2.5" fill="currentColor" fill-opacity=".18"/><path d="M8.5 15.5V18a2.5 2.5 0 0 0 2.5 2.5h7a2.5 2.5 0 0 0 2.5-2.5v-7A2.5 2.5 0 0 0 18 8.5h-2.5"/>',
    file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
    share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 12.5V18a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18v-5.5"/>',
    clip: '<rect x="6" y="4.5" width="12" height="16.5" rx="2.5"/><path d="M9 4.5V3h6v1.5"/>',
    pages: '<rect x="4" y="3" width="12" height="15" rx="2"/><path d="M8.5 21H18a2 2 0 0 0 2-2V7.5"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-1 2-2 0-1.3-1-1.6-1-2.8 0-1 .8-1.7 1.8-1.7H17a3.5 3.5 0 0 0 3.5-3.5c0-3.9-3.8-7-8.5-7z"/><circle cx="7.5" cy="11" r="1.1"/><circle cx="10" cy="7.5" r="1.1"/><circle cx="14.5" cy="7.5" r="1.1"/>',
    resize: '<path d="M14.5 3.5h6v6M9.5 20.5h-6v-6M20.5 3.5l-7 7M3.5 20.5l7-7"/>',
    pen: '<path d="M4 20l1.2-4.4L16.6 4.2a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.4 18.8z"/>',
    marker: '<path d="M14.5 3.5l6 6-8.5 8.5-6-6zM6 12l-2.5 8.5L12 18"/>',
    highlighter: '<path d="M9 11l-6 6v3.5h8.5l3-3M21.5 11.5l-4.6 4.6a2 2 0 0 1-2.8 0L8 10a2 2 0 0 1 0-2.8l4.6-4.6"/>',
    eraser: '<path d="M7 20.5h11M4.8 14.6l9.5-10.1a1.8 1.8 0 0 1 2.6 0l3 3a1.8 1.8 0 0 1 0 2.6L11.2 20.5H8.2z"/>',
    hand: '<path d="M7.5 11.5V6a1.5 1.5 0 0 1 3 0v5M10.5 10V4.5a1.5 1.5 0 0 1 3 0V10M13.5 10V5.5a1.5 1.5 0 0 1 3 0V12M16.5 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7l-2.6-4a1.5 1.5 0 0 1 2.5-1.7l1.1 1.4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8h.01"/>',
    alL: '<path d="M4 3v18M8 7h11v4H8zM8 13h7v4H8z"/>', alC: '<path d="M12 3v18M6 7h12v4H6zM8 13h8v4H8z"/>', alR: '<path d="M20 3v18M5 7h11v4H5zM9 13h7v4H9z"/>',
    alT: '<path d="M3 4h18M7 8v11h4V8zM13 8v7h4V8z"/>', alM: '<path d="M3 12h18M7 6v12h4V6zM13 8v8h4V8z"/>', alB: '<path d="M3 20h18M7 5v11h4V5zM13 9v7h4V9z"/>',
    distH: '<path d="M4 3v18M20 3v18M9.5 7.5h5v9h-5z"/>', distV: '<path d="M3 4h18M3 20h18M7.5 9.5h9v5h-9z"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.4 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    wand: '<path d="M15 4V2.5M15 9.5V8M11.5 6H10M20 6h-1.5M17.5 3.5l1-1M17.5 8.5l1 1M12.5 3.5l-1-1M3.5 20.5l11-11 1.5 1.5-11 11z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    upscale: '<path d="M4 20V4h16"/><path d="M8 16l8-8M11 8h5v5"/>',
    stamp: '<path d="M9 13V9.5a3 3 0 1 1 6 0V13M5 13h14v4H5zM6.5 20.5h11"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    meme: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 8h10M7 16h10"/>',
    metadata: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 9.5h4M7 13h7M15.5 9.5h2"/>',
    batch: '<rect x="7" y="7" width="13" height="13" rx="2.5"/><path d="M4 16.5V6.5A2.5 2.5 0 0 1 6.5 4h10"/>',
    sheet: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9h17M3.5 15h17M9 3.5v17M15 3.5v17"/>',
    save: '<path d="M5 3.5h11l3.5 3.5v12A1.5 1.5 0 0 1 18 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z"/><path d="M8 3.5v5h7v-5M8 20.5v-6h8v6"/>',
    cloudOff: '<path d="M3 3l18 18M7 7a5.5 5.5 0 0 0 0 11h10a3.5 3.5 0 0 0 1.4-.3M10.5 5.6A6 6 0 0 1 17.3 10 3.5 3.5 0 0 1 20.6 15"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    frame: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><rect x="7.5" y="7.5" width="9" height="9" rx="4.5"/>',
    line: '<path d="M4 20L20 4"/>',
    emoji: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
    shapes: '<circle cx="8" cy="8" r="4.5"/><rect x="11.5" y="11.5" width="9" height="9" rx="1.5"/>',
    brush: '<path d="M14.5 3.5l6 6-7 7-6-6z"/><path d="M7.5 10.5L5 13a3 3 0 0 0 0 4.2l1.8 1.8A3 3 0 0 0 11 19l2.5-2.5"/>',
    ruler: '<path d="M3.5 15.5l12-12 5 5-12 12z"/><path d="M7 12l2 2M9.5 9.5l1.5 1.5M12 7l2 2M14.5 4.5l1.5 1.5"/>',
    magnet: '<path d="M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0z"/><path d="M5 8h4M15 8h4"/>',
    qr: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 20.5h2"/>',
    swap: '<path d="M7 4.5L3.5 8 7 11.5M3.5 8h13M17 12.5l3.5 3.5-3.5 3.5M20.5 16h-13"/>',
    brand: '<path d="M12 3.5l2.3 4.7 5.2.8-3.8 3.6.9 5.2L12 15.4l-4.6 2.4.9-5.2-3.8-3.6 5.2-.8z"/><path d="M5 21h14"/>',
    effect: '<path d="M4 18c3-1 4-4 4-8M8 10c0 4 2.5 7 6 8M14 18c3.5 0 6-3 6-7"/><circle cx="8" cy="6" r="2"/><circle cx="18" cy="7" r="2"/>',
    chart: '<path d="M4 20V4M4 20h16"/><rect x="7" y="11" width="3" height="6" rx=".8"/><rect x="12" y="7" width="3" height="10" rx=".8"/><rect x="17" y="13" width="3" height="4" rx=".8"/>'
  };
  function ic(name, cls) {
    return '<svg class="sx-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || I.info) + '</svg>';
  }

  /* ---------- Small helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function h(html) { var t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstChild; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function r6(n) { return Math.round(n * 1e6) / 1e6; }
  function fmtBytes(b) { return LE.formatBytes ? LE.formatBytes(b) : Math.round(b / 1024) + ' KB'; }
  function mq(q) { return window.matchMedia ? window.matchMedia(q).matches : false; }
  function isPhone() { return mq('(max-width: 767px)'); }
  function isTablet() { return mq('(min-width: 768px) and (max-width: 1023px)'); }
  function reduced() { return mq('(prefers-reduced-motion: reduce)'); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function newId(p) { return (p || 'l') + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- Constants ---------- */
  var RAIL = [
    ['design', 'Design', 'design'], ['elements', 'Elements', 'elements'], ['text', 'Text', 'text'], ['uploads', 'Uploads', 'uploads'],
    ['draw', 'Draw', 'draw'], ['adjust', 'Adjust', 'adjust'], ['filters', 'Filters', 'filters'], ['background', 'Background', 'background'],
    ['layers', 'Layers', 'layers'], ['recipes', 'Recipes', 'recipes'], ['projects', 'Projects', 'projects'], ['apps', 'Apps', 'apps']
  ];
  var SIZES = [
    { id: 'ig-post', group: 'Social', name: 'Instagram post', w: 1080, h: 1080 },
    { id: 'ig-portrait', group: 'Social', name: 'Instagram portrait', w: 1080, h: 1350 },
    { id: 'ig-story', group: 'Social', name: 'Story / Reel', w: 1080, h: 1920 },
    { id: 'yt-thumb', group: 'Social', name: 'YouTube thumbnail', w: 1280, h: 720 },
    { id: 'fb-post', group: 'Social', name: 'Facebook post', w: 1200, h: 630 },
    { id: 'fb-cover', group: 'Social', name: 'Facebook cover', w: 1640, h: 624 },
    { id: 'li-post', group: 'Social', name: 'LinkedIn post', w: 1200, h: 1200 },
    { id: 'li-banner', group: 'Social', name: 'LinkedIn banner', w: 1584, h: 396 },
    { id: 'x-post', group: 'Social', name: 'X post', w: 1600, h: 900 },
    { id: 'x-header', group: 'Social', name: 'X header', w: 1500, h: 500 },
    { id: 'pin', group: 'Social', name: 'Pinterest pin', w: 1000, h: 1500 },
    { id: 'a4', group: 'Print', name: 'A4 poster', w: 2480, h: 3508 },
    { id: 'letter', group: 'Print', name: 'US Letter', w: 2550, h: 3300 },
    { id: 'card', group: 'Print', name: 'Business card', w: 1050, h: 600 },
    { id: 'slide', group: 'Screen', name: 'Presentation 16:9', w: 1920, h: 1080 },
    { id: 'wall', group: 'Screen', name: 'Phone wallpaper', w: 1170, h: 2532 }
  ];
  var PALETTE = ['#17131F', '#FFFFFF', '#FBF8F3', '#6B6577', '#E6E1EC', '#000000', '#7457F0', '#2F6BFF', '#17A37A', '#F2D594', '#E2B15A', '#E0668E', '#D07A45', '#2A1A3E', '#FF4D4D', '#FFB020', '#22C55E', '#06B6D4'];
  var GRADIENTS = [
    ['#7457F0', '#E0668E', '#F2CF86'], ['#F8E3AE', '#E2B15A', '#B9832F'], ['#2F6BFF', '#7457F0'], ['#17A37A', '#2F6BFF'],
    ['#E0668E', '#D07A45'], ['#110F17', '#2A1A3E'], ['#FBF8F3', '#F2D594'], ['#06B6D4', '#3B82F6', '#8B5CF6'],
    ['#FF9A8B', '#FF6A88', '#FF99AC'], ['#0F2027', '#203A43', '#2C5364'], ['#FDFCFB', '#E2D1C3'], ['#43E97B', '#38F9D7']
  ];
  var SHADOWS = [
    ['none', 'None', null], ['soft', 'Soft', { color: 'rgba(23,19,31,.28)', blur: 24, x: 0, y: 10 }],
    ['lift', 'Lift', { color: 'rgba(23,19,31,.4)', blur: 48, x: 0, y: 24 }], ['hard', 'Hard', { color: 'rgba(23,19,31,.9)', blur: 0, x: 10, y: 10 }],
    ['glow', 'Glow', { color: 'rgba(242,213,148,.95)', blur: 36, x: 0, y: 0 }], ['neon', 'Neon', { color: 'rgba(224,102,142,1)', blur: 28, x: 0, y: 0 }]
  ];
  var ADJ = [
    ['light', 'Light', [['brightness', 'Brightness', -100, 100, 1], ['contrast', 'Contrast', -100, 100, 1], ['exposure', 'Exposure', -100, 100, 1, 0.01], ['highlights', 'Highlights', -100, 100, 1], ['shadows', 'Shadows', -100, 100, 1]]],
    ['color', 'Color', [['saturation', 'Saturation', -100, 100, 1], ['vibrance', 'Vibrance', -100, 100, 1], ['warmth', 'Warmth', -60, 60, 1], ['tint', 'Tint', -60, 60, 1], ['hue', 'Hue', -180, 180, 1]]],
    ['texture', 'Texture', [['sharpness', 'Sharpness', 0, 100, 1], ['blur', 'Blur', 0, 40, 1], ['vignette', 'Vignette', 0, 100, 1, 0.01], ['grain', 'Grain', 0, 100, 1, 0.5]]]
  ];
  var MAX_EDGE = { older: 4096, modern: 8192, desktop: 16384 };

  /* ---------- State ---------- */
  var S = {
    project: null, mem: {}, baseId: null, sel: [], panel: null, panelOpts: {}, view: { zoom: 1, panX: 0, panY: 0 },
    tool: 'select', editing: false, dirty: false, silent: false, preview: null, pointer: false, autoFit: true, fitting: false,
    gesture: 0, known: {}, draw: lsGet('le-studio-draw', { mode: 'pen', color: '#17131F', width: 6, smoothing: 0.55 }),
    exportOpts: lsGet('le-studio-export', { format: 'png', quality: 0.92, scale: 1, transparent: false, pages: 'current' }),
    recentColors: lsGet('le-studio-colors', []), lastSnap: 0, saveTimer: 0, thumbs: {}, pageThumbs: {}, chain: false, sheet: 0, canUndo: false, canRedo: false
  };

  var scene = new LE.Scene({ el: E.sceneEl, width: 1080, height: 1080, background: { type: 'color', color: '#ffffff' } });
  S.scene = scene;

  function L(id) { return id ? scene.layer(id) : null; }
  function sel() { return scene.selection(); }
  function one() { var s = sel(); return s.length === 1 ? L(s[0]) : null; }
  function doc() { return scene.toJSON(); }
  function studio() { return S.project ? (S.project.meta.studio = S.project.meta.studio || {}) : {}; }
  function baseLayer() { var b = S.baseId && L(S.baseId); return b && b.type === 'image' ? b : null; }
  function targetImage() {
    var o = one();
    if (o && o.type === 'image') return o;
    if (o && o.type === 'group') return null;
    if (!sel().length) return baseLayer() || firstImage();
    return null;
  }
  function firstImage() { var ls = scene.layers(); for (var i = ls.length - 1; i >= 0; i--) if (ls[i].type === 'image') return ls[i]; return null; }
  function gesture() { return 'g' + (++S.gesture); }
  function patch(ids, p, key) {
    if (!ids) return;
    if (typeof ids === 'string') ids = [ids];
    var opts = key ? { coalesce: key } : null;
    ids.forEach(function (id) { scene.update(id, p, opts); });
  }
  function batch(fn) {
    var hist = scene._hist;
    var n = hist ? hist.undo.length : 0;
    var out = fn();
    if (hist && hist.undo.length > n + 1) hist.undo.splice(n + 1);
    if (scene._endHist) scene._endHist();
    onHistory({ canUndo: scene.canUndo(), canRedo: scene.canRedo() });
    return out;
  }
  function replaceDoc(d, history) {
    if (typeof scene.replace === 'function') { scene.replace(d, { history: !!history }); return; }
    var json = JSON.stringify(d);
    if (history) { scene._before(null); scene._restore(json, true); scene._after(); }
    else scene._restore(json, true);
  }
  function fit() { S.fitting = true; scene.fit(); S.fitting = false; S.autoFit = true; }
  function startCrop(id) {
    var layer = scene._find ? scene._find(id) : null;
    if (layer && typeof scene._beginCrop === 'function') { scene.select([id]); scene._beginCrop(layer); return; }
    var r = scene.screenRect(id);
    if (!r) return;
    scene.select([id]);
    E.sceneEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  }
  function startTextEdit(id) {
    var layer = scene._find ? scene._find(id) : null;
    if (layer && typeof scene._startEdit === 'function') scene._startEdit(layer);
  }
  function keyEvent(key) { E.sceneEl.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true })); }

  /* ---------- Toast, popover, modal ---------- */
  function toast(msg, opts) {
    opts = opts || {};
    var t = E.toast;
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (opts.action ? '<button type="button" class="sx-toast-act">' + esc(opts.action.label) + '</button>' : '');
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('is-on'); });
    if (opts.action) t.querySelector('button').onclick = function () { hideToast(); opts.action.fn(); };
    clearTimeout(t._t);
    t._t = setTimeout(hideToast, opts.ms || (opts.action ? 6500 : 2600));
  }
  function hideToast() { E.toast.classList.remove('is-on'); setTimeout(function () { if (!E.toast.classList.contains('is-on')) E.toast.hidden = true; }, 240); }

  var popAnchor = null;
  function openPop(anchor, content, opts) {
    opts = opts || {};
    closePop();
    var p = E.pop;
    p.innerHTML = '';
    p.className = 'sx-pop' + (opts.cls ? ' ' + opts.cls : '');
    if (opts.title) p.appendChild(h('<div class="sx-pop-head"><strong>' + esc(opts.title) + '</strong><button type="button" class="sx-iconbtn sx-pop-x" aria-label="Close">' + ic('x') + '</button></div>'));
    var body = document.createElement('div');
    body.className = 'sx-pop-body';
    if (typeof content === 'string') body.innerHTML = content; else body.appendChild(content);
    p.appendChild(body);
    p.hidden = false;
    popAnchor = anchor || null;
    var x = p.querySelector('.sx-pop-x');
    if (x) x.onclick = closePop;
    placePop();
    requestAnimationFrame(function () { p.classList.add('is-on'); });
    return body;
  }
  function placePop() {
    var p = E.pop;
    if (p.hidden) return;
    if (isPhone() || !popAnchor) { p.classList.add('is-sheet'); p.style.left = p.style.top = ''; return; }
    p.classList.remove('is-sheet');
    var r = popAnchor.getBoundingClientRect();
    var pw = p.offsetWidth, ph = p.offsetHeight;
    var x = clamp(r.left + r.width / 2 - pw / 2, 8, innerWidth - pw - 8);
    var y = r.bottom + 8;
    if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 8);
    p.style.left = x + 'px';
    p.style.top = y + 'px';
  }
  function closePop() {
    if (E.pop.hidden) return;
    E.pop.classList.remove('is-on');
    E.pop.hidden = true;
    E.pop.innerHTML = '';
    popAnchor = null;
  }
  function openModal(title, content, opts) {
    opts = opts || {};
    var m = E.modal;
    m.innerHTML = '<div class="sx-modal-card' + (opts.wide ? ' is-wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="sx-modal-head"><h2>' + title + '</h2><button type="button" class="sx-iconbtn" data-close aria-label="Close">' + ic('x') + '</button></div><div class="sx-modal-body"></div></div>';
    var body = m.querySelector('.sx-modal-body');
    if (typeof content === 'string') body.innerHTML = content; else body.appendChild(content);
    m.hidden = false;
    requestAnimationFrame(function () { m.classList.add('is-on'); });
    m.querySelector('[data-close]').onclick = closeModal;
    m.onclick = function (e) { if (e.target === m) closeModal(); };
    var f = m.querySelector('button, input');
    if (f) setTimeout(function () { f.focus(); }, 30);
    return body;
  }
  function closeModal() { E.modal.classList.remove('is-on'); E.modal.hidden = true; E.modal.innerHTML = ''; if (S.onModalClose) { var f = S.onModalClose; S.onModalClose = null; f(); } }

  /* ---------- UI builders shared with panels ---------- */
  var ui = {
    section: function (title, extra) {
      return h('<div class="sx-sec"><div class="sx-sec-head"><h3>' + esc(title) + '</h3>' + (extra || '') + '</div><div class="sx-sec-body"></div></div>');
    },
    slider: function (o) {
      var mul = o.mul || 1;
      var v = o.value == null ? 0 : o.value;
      var shown = Math.round(v / mul * 100) / 100;
      var node = h('<div class="sx-slider"><div class="sx-slider-row"><label title="Double-click to reset">' + esc(o.label) + '</label><output class="sx-val" tabindex="0" role="button" aria-label="' + esc(o.label) + ' value — click to type">' + esc(o.fmt ? o.fmt(shown) : shown) + '</output></div><div class="sx-range"><input type="range" min="' + o.min + '" max="' + o.max + '" step="' + (o.step || 1) + '" value="' + shown + '" aria-label="' + esc(o.label) + '"></div></div>');
      var input = node.querySelector('input');
      var out = node.querySelector('output');
      var dflt = o.reset == null ? (o.min <= 0 && o.max >= 0 ? 0 : null) : o.reset;
      if (dflt != null && dflt > o.min && dflt < o.max) {
        var tick = document.createElement('i');
        tick.className = 'sx-tick';
        tick.style.setProperty('--d', String((dflt - o.min) / (o.max - o.min)));
        node.querySelector('.sx-range').appendChild(tick);
      }
      function editVal() {
        if (node.querySelector('.sx-val-in')) return;
        var ed = document.createElement('input');
        ed.className = 'sx-val-in';
        ed.type = 'number';
        ed.min = o.min; ed.max = o.max; ed.step = o.step || 1;
        ed.value = input.value;
        ed.setAttribute('aria-label', o.label);
        out.hidden = true;
        out.parentNode.appendChild(ed);
        ed.focus();
        ed.select();
        var done = false;
        function finish(apply) {
          if (done) return;
          done = true;
          var n = Number(ed.value);
          ed.remove();
          out.hidden = false;
          if (!apply || !isFinite(n)) return;
          key = gesture();
          input.value = clamp(n, o.min, o.max);
          input.dispatchEvent(new Event('input'));
          input.dispatchEvent(new Event('change'));
          out.focus();
        }
        ed.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
        ed.addEventListener('blur', function () { finish(true); });
      }
      out.addEventListener('click', editVal);
      out.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editVal(); } });
      var pending = null, raf = 0, key = null;
      function paintFill() {
        var t = (Number(input.value) - o.min) / ((o.max - o.min) || 1);
        input.style.setProperty('--t', (t * 100) + '%');
        if (o.min < 0) {
          var z = (0 - o.min) / (o.max - o.min);
          input.style.setProperty('--z', (z * 100) + '%');
          node.classList.add('is-bi');
        }
      }
      function flush() {
        raf = 0;
        if (pending == null) return;
        var val = pending;
        pending = null;
        o.onInput(r6(val * mul), key || (key = gesture()));
      }
      input.addEventListener('pointerdown', function () { key = gesture(); });
      input.addEventListener('input', function () {
        var n = Number(input.value);
        out.textContent = o.fmt ? o.fmt(n) : n;
        paintFill();
        pending = n;
        if (!raf) raf = requestAnimationFrame(flush);
      });
      input.addEventListener('change', function () {
        if (raf) { cancelAnimationFrame(raf); flush(); }
        key = null;
        if (o.onEnd) o.onEnd();
      });
      function resetVal() {
        var d = o.reset == null ? 0 : o.reset;
        key = gesture();
        input.value = d;
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('change'));
      }
      node.querySelector('label').addEventListener('dblclick', resetVal);
      input.addEventListener('dblclick', resetVal);
      node.set = function (val) { var s = Math.round(val / mul * 100) / 100; input.value = s; out.textContent = o.fmt ? o.fmt(s) : s; paintFill(); };
      paintFill();
      return node;
    },
    seg: function (options, value, onPick, cls) {
      var node = h('<div class="sx-seg' + (cls ? ' ' + cls : '') + '" role="group"><i class="sx-seg-thumb" aria-hidden="true"></i></div>');
      var thumb = node.firstChild;
      function place(animate) {
        var on = node.querySelector('button[aria-pressed="true"]');
        if (!on || !on.offsetWidth) { node.classList.remove('has-thumb'); return; }
        if (!animate) thumb.style.transition = 'none';
        thumb.style.width = on.offsetWidth + 'px';
        thumb.style.transform = 'translateX(' + on.offsetLeft + 'px)';
        thumb.style.height = on.offsetHeight + 'px';
        thumb.style.top = on.offsetTop + 'px';
        node.classList.add('has-thumb');
        if (!animate) { void thumb.offsetWidth; thumb.style.transition = ''; }
      }
      options.forEach(function (op) {
        var b = h('<button type="button" aria-pressed="' + (op[0] === value) + '">' + (op[2] ? ic(op[2]) : '') + '<span>' + esc(op[1]) + '</span></button>');
        b.onclick = function () {
          node.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          place(true);
          onPick(op[0]);
        };
        node.appendChild(b);
      });
      if (window.ResizeObserver) new ResizeObserver(function () { place(false); }).observe(node);
      else requestAnimationFrame(function () { place(false); });
      return node;
    },
    toggle: function (label, checked, onChange, hint) {
      var node = h('<label class="sx-toggle"><span><b>' + esc(label) + '</b>' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</span><input type="checkbox"' + (checked ? ' checked' : '') + '><i aria-hidden="true"></i></label>');
      node.querySelector('input').onchange = function (e) { onChange(e.target.checked); };
      return node;
    },
    swatchBtn: function (value, label, onClick) {
      var b = h('<button type="button" class="sx-swatch-btn" aria-label="' + esc(label) + '"><i></i><span>' + esc(label) + '</span></button>');
      paintSwatch(b.querySelector('i'), value);
      b.onclick = function () { onClick(b); };
      return b;
    },
    empty: function (title, text, actions) {
      var n = h('<div class="sx-empty"><div class="sx-empty-art">' + ic('image') + '</div><strong>' + esc(title) + '</strong><p>' + esc(text) + '</p><div class="sx-empty-act"></div></div>');
      (actions || []).forEach(function (a) {
        var b = h('<button type="button" class="btn ' + (a.gold ? 'btn-gold' : '') + ' btn-sm">' + esc(a.label) + '</button>');
        b.onclick = a.fn;
        n.querySelector('.sx-empty-act').appendChild(b);
      });
      return n;
    },
    lazy: function (container, onShow) {
      if (!('IntersectionObserver' in window)) { container.querySelectorAll('[data-lazy]').forEach(onShow); return null; }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          onShow(en.target);
        });
      }, { root: E.panelBody, rootMargin: '200px 0px' });
      container.querySelectorAll('[data-lazy]').forEach(function (n) { io.observe(n); });
      return io;
    }
  };
  function cssFill(v) {
    if (!v) return 'transparent';
    if (typeof v === 'string') return v;
    if (v.type === 'none') return 'transparent';
    var cols = v.colors && v.colors.length ? v.colors : [v.color || '#7457F0'];
    if (v.type === 'linear' || v.kind === 'linear' || (v.type === 'gradient' && v.kind !== 'radial')) return 'linear-gradient(' + ((v.angle || 0) + 90) + 'deg,' + (cols.length > 1 ? cols.join(',') : cols[0] + ',' + cols[0]) + ')';
    if (v.type === 'radial' || v.kind === 'radial') return 'radial-gradient(circle,' + (cols.length > 1 ? cols.join(',') : cols[0] + ',' + cols[0]) + ')';
    return v.color || cols[0];
  }
  function paintSwatch(node, v) {
    node.style.background = cssFill(v);
    node.classList.toggle('is-clear', !v || v === 'transparent' || (v && v.type === 'none'));
  }

  /* ---------- Colors ---------- */
  function docColors() {
    var seen = {}, out = [];
    function add(c) { if (typeof c === 'string' && /^#|^rgb|^hsl/i.test(c) && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; out.push(c); } }
    var d = doc();
    if (d.background) { add(d.background.color); (d.background.colors || []).forEach(add); }
    d.layers.forEach(function (l) {
      add(l.color);
      if (l.fill) { add(l.fill.color); (l.fill.colors || []).forEach(add); }
      if (l.stroke) add(l.stroke.color);
      if (l.background) add(l.background.color);
    });
    ((studio().docColors) || []).forEach(add);
    return out.slice(0, 18);
  }
  function addRecent(c) {
    if (typeof c !== 'string') return;
    S.recentColors = [c].concat(S.recentColors.filter(function (x) { return x.toLowerCase() !== c.toLowerCase(); })).slice(0, 12);
    lsSet('le-studio-colors', S.recentColors);
  }
  function toHex(c) {
    if (typeof c !== 'string') return '#7457f0';
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(function (x) { return x + x; }).join('');
    var cv = document.createElement('canvas').getContext('2d');
    cv.fillStyle = '#000';
    cv.fillStyle = c;
    var v = cv.fillStyle;
    return /^#/.test(v) ? v : '#7457f0';
  }
  function colorPop(anchor, o) {
    if (PANELS._colorPop) return PANELS._colorPop(ctx, anchor, o);
    return colorPopBasic(anchor, o);
  }
  function colorPopBasic(anchor, o) {
    var body = h('<div class="sx-colors"></div>');
    var key = gesture();
    function pick(v, end) {
      o.onChange(v, key);
      if (end) { if (typeof v === 'string') addRecent(v); key = gesture(); }
    }
    function row(title, list, isGrad) {
      if (!list.length) return;
      var sec = h('<div class="sx-colors-sec"><span>' + esc(title) + '</span><div class="sx-colors-grid"></div></div>');
      list.forEach(function (c) {
        var val = isGrad ? { type: 'linear', colors: c, angle: 45 } : c;
        var b = h('<button type="button" class="sx-chip-color" aria-label="' + esc(isGrad ? 'Gradient ' + c.join(' to ') : c) + '"></button>');
        paintSwatch(b, val);
        b.onclick = function () { pick(val, true); };
        sec.lastChild.appendChild(b);
      });
      body.appendChild(sec);
    }
    var cur = typeof o.value === 'string' ? o.value : (o.value && (o.value.color || (o.value.colors && o.value.colors[0]))) || '#7457F0';
    var custom = h('<div class="sx-colors-custom"><label class="sx-colorwell"><input type="color" value="' + toHex(cur) + '" aria-label="Custom color"><i></i></label><input class="sx-input sx-hex" value="' + esc(toHex(cur)) + '" aria-label="Hex color" maxlength="9" spellcheck="false">' + (window.EyeDropper ? '<button type="button" class="sx-iconbtn" data-eye aria-label="Pick a color from the screen">' + ic('pipette') + '</button>' : '') + (o.none ? '<button type="button" class="sx-iconbtn" data-none aria-label="No color">' + ic('x') + '</button>' : '') + '</div>');
    var well = custom.querySelector('input[type=color]');
    var hexIn = custom.querySelector('.sx-hex');
    custom.querySelector('i').style.background = toHex(cur);
    var raf = 0, pend = null;
    well.addEventListener('input', function () {
      pend = well.value;
      hexIn.value = well.value;
      custom.querySelector('i').style.background = well.value;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; pick(pend, false); });
    });
    well.addEventListener('change', function () { pick(well.value, true); });
    hexIn.addEventListener('change', function () {
      var v = hexIn.value.trim();
      if (!/^#/.test(v)) v = '#' + v;
      if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) pick(v, true);
    });
    var eye = custom.querySelector('[data-eye]');
    if (eye) eye.onclick = function () { new window.EyeDropper().open().then(function (r) { pick(r.sRGBHex, true); }).catch(function () {}); };
    var none = custom.querySelector('[data-none]');
    if (none) none.onclick = function () { pick(o.none === 'null' ? null : { type: 'none' }, true); };
    body.appendChild(custom);
    if (o.gradient && o.value && typeof o.value === 'object' && (o.value.type === 'linear' || o.value.type === 'radial')) {
      var g = o.value;
      var gs = h('<div class="sx-colors-sec"><span>Gradient</span></div>');
      gs.appendChild(ui.seg([['linear', 'Linear'], ['radial', 'Radial']], g.type, function (t) { g = Object.assign({}, g, { type: t }); pick(g, true); }));
      gs.appendChild(ui.slider({ label: 'Angle', min: 0, max: 360, value: g.angle || 0, onInput: function (v, k) { g = Object.assign({}, g, { angle: v }); o.onChange(g, k); } }));
      body.appendChild(gs);
    }
    row('Document colors', docColors());
    row('Recent', S.recentColors);
    row('LocalEditor palette', PALETTE);
    if (o.gradient) row('Gradients', GRADIENTS, true);
    return openPop(anchor, body, { title: o.title || 'Color', cls: 'sx-pop-colors' });
  }

  /* ---------- Shell ---------- */
  function renderHead() {
    var name = S.project ? S.project.name : 'Untitled design';
    E.head.innerHTML =
      '<a class="sx-brand" href="../" aria-label="LocalEditor home"><span class="sx-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><defs><linearGradient id="sx-foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F8E3AE"/><stop offset=".55" stop-color="#E2B15A"/><stop offset="1" stop-color="#B9832F"/></linearGradient></defs><rect width="32" height="32" rx="10" fill="url(#sx-foil)"/><circle cx="16" cy="16" r="7.5" fill="none" stroke="#2C220F" stroke-width="1.8"/><circle cx="16" cy="16" r="1.8" fill="#2C220F"/><circle cx="21.5" cy="10.5" r="1.3" fill="#fff" fill-opacity=".85"/></svg></span><span class="sx-brand-txt"><strong>LocalEditor</strong><em>Studio</em></span></a>' +
      '<button type="button" class="sx-headbtn sx-file-btn" data-cmd="fileMenu" aria-haspopup="menu">' + ic('menu') + '<span>File</span></button>' +
      '<label class="sx-name"><span class="sr">Design name</span><input id="sx-name" value="' + esc(name) + '" maxlength="120" spellcheck="false" aria-label="Design name"></label>' +
      '<span class="sx-save" id="sx-save" data-state="' + (S.dirty ? 'dirty' : 'saved') + '"><i aria-hidden="true"></i><span>' + (S.project ? (S.dirty ? 'Saving…' : 'Saved on this device') : 'On this device') + '</span></span>' +
      '<span class="sx-grow"></span>' +
      '<button type="button" class="sx-iconbtn" data-cmd="undo" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)"' + (S.canUndo ? '' : ' disabled') + '>' + ic('undo') + '</button>' +
      '<button type="button" class="sx-iconbtn" data-cmd="redo" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)"' + (S.canRedo ? '' : ' disabled') + '>' + ic('redo') + '</button>' +
      '<span class="sx-sep sx-hide-phone"></span>' +
      '<button type="button" class="sx-iconbtn sx-hide-phone" data-cmd="history" aria-label="Version history" title="Version history">' + ic('history') + '</button>' +
      '<button type="button" class="sx-iconbtn sx-hide-phone" data-cmd="settings" aria-label="Performance settings" title="Performance">' + ic('gauge') + '</button>' +
      '<button type="button" class="sx-iconbtn sx-hide-phone" data-theme-toggle aria-label="Switch color theme" title="Theme">' + ic('moon') + '</button>' +
      '<button type="button" class="sx-iconbtn sx-hide-phone" data-cmd="shortcuts" aria-label="Keyboard shortcuts (?)" title="Shortcuts (?)">' + ic('keyboard') + '</button>' +
      '<button type="button" class="btn btn-gold sx-download" data-cmd="export" aria-label="Download">' + ic('download') + '<span>Download</span></button>';
    var input = byId('sx-name');
    input.addEventListener('change', function () {
      if (!S.project) return;
      S.project.name = input.value.trim() || 'Untitled design';
      markDirty();
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
  }
  function setSave(state) {
    var n = byId('sx-save');
    if (!n) return;
    n.setAttribute('data-state', state);
    n.lastChild.textContent = state === 'dirty' ? 'Saving…' : state === 'error' ? 'Not saved — storage full?' : state === 'preview' ? 'Previewing' : 'Saved on this device';
  }
  function renderRail() {
    var html = '';
    RAIL.forEach(function (r) {
      html += '<button type="button" class="sx-rail-btn" data-panel-btn="' + r[0] + '" aria-label="' + r[1] + '" aria-pressed="' + (S.panel === r[0]) + '"><span class="sx-rail-ic">' + ic(r[2]) + '</span><span class="sx-rail-lb">' + r[1] + '</span></button>';
    });
    E.rail.innerHTML = html;
    E.tabs.innerHTML = html + '<button type="button" class="sx-rail-btn" data-panel-btn="export" aria-label="Download" aria-pressed="' + (S.panel === 'export') + '"><span class="sx-rail-ic">' + ic('download') + '</span><span class="sx-rail-lb">Download</span></button>';
  }
  function markRail() {
    root.querySelectorAll('[data-panel-btn]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-panel-btn') === S.panel ? 'true' : 'false'); });
  }

  /* ---------- Panels ---------- */
  function openPanel(id, opts) {
    var spec = PANELS[id];
    if (!spec) return;
    closePop();
    var was = S.panel;
    if (was === 'draw' && id !== 'draw') stopDraw();
    if (was) fire('panel-close', was);
    S.panel = id;
    S.panelOpts = opts || {};
    root.setAttribute('data-panel', id);
    E.panel.hidden = false;
    root.classList.add('has-panel');
    markRail();
    renderPanel();
    if (isPhone()) openSheet(S.panelOpts.full ? 1 : 0);
    try {
      var url = new URL(location.href);
      url.searchParams.set('tool', id);
      history.replaceState(null, '', url.pathname + url.search);
    } catch (e) {}
    if (!was) refitSoon();
  }
  function closePanel() {
    if (!S.panel) return;
    if (S.panel === 'draw') stopDraw();
    fire('panel-close', S.panel);
    if (S.panelSpec && S.panelSpec.close) S.panelSpec.close(ctx);
    S.panel = null;
    S.panelSpec = null;
    root.setAttribute('data-panel', '');
    root.classList.remove('has-panel');
    E.panel.hidden = true;
    E.panelBody.innerHTML = '';
    markRail();
    closeSheet();
    try {
      var url = new URL(location.href);
      url.searchParams.delete('tool');
      history.replaceState(null, '', url.pathname + url.search);
    } catch (e) {}
    refitSoon();
  }
  function renderPanel(keepScroll) {
    var spec = PANELS[S.panel];
    if (!spec) return;
    if (S.panelSpec && S.panelSpec !== spec && S.panelSpec.close) S.panelSpec.close(ctx);
    S.panelSpec = spec;
    var top = keepScroll ? E.panelBody.scrollTop : 0;
    var title = typeof spec.title === 'function' ? spec.title(ctx, S.panelOpts) : spec.title;
    E.panelHead.innerHTML = (S.panelOpts.back ? '<button type="button" class="sx-iconbtn" data-cmd="panelBack" aria-label="Back">' + ic('back') + '</button>' : '') +
      '<div class="sx-panel-title"><span class="sx-eyebrow">' + esc(spec.eyebrow || 'Studio') + '</span><h2>' + esc(title) + '</h2></div>' +
      '<button type="button" class="sx-iconbtn" data-cmd="closePanel" aria-label="Close panel">' + ic('x') + '</button>';
    E.panelBody.innerHTML = '';
    try { spec.render(ctx, E.panelBody, S.panelOpts); } catch (err) {
      console.error(err);
      E.panelBody.appendChild(ui.empty('Something went wrong', 'This panel could not open. Your design is safe.'));
    }
    E.panelBody.scrollTop = top;
  }
  var refreshPanelSoon = debounce(function () {
    var spec = PANELS[S.panel];
    if (!spec || !spec.doc || S.pointer || S.preview) return;
    if (E.panel.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (S.panelDrag) return;
    if (typeof spec.doc === 'function') spec.doc(ctx, E.panelBody); else renderPanel(true);
  }, 260);

  /* ---------- Phone sheet ---------- */
  function sheetSnaps() {
    var avail = innerHeight - (E.tabs.offsetHeight || 64) - (E.head.offsetHeight || 52);
    return [Math.round(avail * 0.46), Math.round(avail * 0.9)];
  }
  function setSheet(px, animate) {
    root.classList.toggle('sheet-drag', !animate);
    root.style.setProperty('--sheet-h', px + 'px');
  }
  function openSheet(i) {
    var snaps = sheetSnaps();
    S.sheet = i;
    root.classList.add('sheet-open');
    setSheet(snaps[i], true);
    refitSoon(320);
  }
  function closeSheet() {
    root.classList.remove('sheet-open', 'sheet-drag');
    root.style.setProperty('--sheet-h', '0px');
  }
  (function bindSheet() {
    var start = null;
    function down(e) {
      if (!isPhone() || !S.panel) return;
      if (e.target.closest('button, input, select, a')) return;
      start = { y: e.clientY, h: E.panel.offsetHeight };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function move(e) {
      if (!start) return;
      var hgt = clamp(start.h - (e.clientY - start.y), 80, sheetSnaps()[1] + 20);
      setSheet(hgt, false);
    }
    function up(e) {
      if (!start) return;
      var hgt = start.h - (e.clientY - start.y);
      var moved = Math.abs(e.clientY - start.y);
      start = null;
      var snaps = sheetSnaps();
      if (moved < 6) { openSheet(S.sheet === 0 ? 1 : 0); return; }
      if (hgt < snaps[0] * 0.62) { closePanel(); return; }
      openSheet(Math.abs(hgt - snaps[0]) < Math.abs(hgt - snaps[1]) ? 0 : 1);
    }
    [E.grip, E.panelHead].forEach(function (n) {
      n.addEventListener('pointerdown', down);
      n.addEventListener('pointermove', move);
      n.addEventListener('pointerup', up);
      n.addEventListener('pointercancel', up);
    });
  })();
  var refitSoon = function (ms) {
    clearTimeout(refitSoon.t);
    refitSoon.t = setTimeout(function () { if (S.autoFit) fit(); placeMini(); }, ms || 60);
  };

  /* ---------- Toolbar ---------- */
  function tb(cmd, icon, label, o) {
    o = o || {};
    return '<button type="button" class="sx-tb' + (o.text ? ' has-text' : '') + (o.cls ? ' ' + o.cls : '') + '" data-cmd="' + cmd + '" aria-label="' + esc(o.aria || label) + '" title="' + esc(o.title || label) + '"' + (o.pressed != null ? ' aria-pressed="' + !!o.pressed + '"' : '') + (o.disabled ? ' disabled' : '') + '>' + (icon ? ic(icon) : '') + (o.text !== false && (o.text || o.label) ? '<span>' + esc(o.text === true ? label : (o.text || label)) + '</span>' : '') + '</button>';
  }
  function swatch(cmd, value, label) {
    return '<button type="button" class="sx-tb sx-tb-swatch" data-cmd="' + cmd + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"><i style="background:' + esc(cssFill(value)) + '"></i></button>';
  }
  var SEP = '<span class="sx-tb-sep" aria-hidden="true"></span>';
  function common(l) {
    return SEP + tb('opacity', 'opacity', 'Transparency') + tb('position', 'position', 'Position', { text: true }) + tb('copyStyle', 'brush', S.painterArmed ? 'Click another item to paste this style (Esc to stop)' : 'Copy style (Ctrl+Alt+C)', { pressed: !!S.painterArmed }) + SEP +
      tb(l && l.locked ? 'unlock' : 'lock', l && l.locked ? 'lock' : 'unlock', l && l.locked ? 'Unlock' : 'Lock', { pressed: !!(l && l.locked) }) +
      tb('dup', 'copy', 'Duplicate (Ctrl+D)') + tb('del', 'trash', 'Delete (Del)');
  }
  function renderToolbar() {
    if (E.tool.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    var ids = sel();
    var html = '';
    var kind = 'page';
    if (S.preview && S.preview.type === 'size') kind = 'preview';
    else if (S.tool === 'crop') kind = 'crop';
    else if (/^(pen|marker|highlighter|eraser)$/.test(S.tool)) kind = 'draw';
    else if (ids.length > 1) kind = 'multi';
    else if (ids.length === 1) { var l0 = L(ids[0]); kind = l0 ? l0.type : 'page'; }
    var l = ids.length === 1 ? L(ids[0]) : null;
    if (kind === 'crop') {
      html = '<span class="sx-tb-label">' + ic('crop') + 'Crop</span>' +
        [['free', 'Free'], ['1', '1:1'], ['0.8', '4:5'], ['1.5', '3:2'], ['1.7778', '16:9'], ['0.5625', '9:16']].map(function (r) { return tb('ratio:' + r[0], null, r[1], { text: true, cls: 'sx-tb-chip' }); }).join('') +
        SEP + tb('cropReset', 'reset', 'Reset crop', { text: true }) + '<span class="sx-grow"></span>' + tb('cropCancel', 'x', 'Cancel', { text: true }) + tb('cropDone', 'check', 'Done', { text: true, cls: 'is-primary' });
    } else if (kind === 'draw') {
      var d = S.draw;
      html = [['pen', 'Pen', 'pen'], ['marker', 'Marker', 'marker'], ['highlighter', 'Highlighter', 'highlighter'], ['eraser', 'Eraser', 'eraser']].map(function (m) {
        return tb('drawMode:' + m[0], m[2], m[1], { text: true, pressed: S.tool === m[0] });
      }).join('') + SEP + swatch('drawColor', d.color, 'Pen color') + '<span class="sx-grow"></span>' + tb('drawDone', 'check', 'Done', { text: true, cls: 'is-primary' });
    } else if (kind === 'preview') {
      html = '<span class="sx-tb-label">' + ic('resize') + 'Previewing size</span>';
    } else if (kind === 'image') {
      var repl = (l && (l.slot || !l.src)) ? 'Replace photo' : 'Replace';
      html = tb('adjust', 'adjust', 'Edit photo', { text: true }) + tb('filters', 'filters', 'Filters', { text: true }) + tb('effects', 'sparkle', 'Effects', { text: true }) + (fire('photo-tools', l) || '') + SEP +
        tb('crop', 'crop', 'Crop', { text: true }) + tb('flipMenu', 'flip', 'Flip', { text: true }) + tb('replace', 'replace', repl, { text: repl, cls: (l && l.slot) ? 'is-primary' : '' }) + common(l) + tb('more', 'more', 'More options');
    } else if (kind === 'text') {
      var fam = l.font || 'Plus Jakarta Sans';
      html = '<button type="button" class="sx-tb sx-tb-font" data-cmd="font" aria-label="Font: ' + esc(fam) + '" title="Font"><span style="font-family:' + esc(fontCss(fam)) + '">' + esc(fam) + '</span>' + ic('chev') + '</button>' +
        '<span class="sx-tb-size"><button type="button" class="sx-tb" data-cmd="size:-" aria-label="Smaller">' + ic('minus') + '</button><input type="number" id="sx-fsize" min="4" max="2000" value="' + Math.round(l.size) + '" aria-label="Font size"><button type="button" class="sx-tb" data-cmd="size:+" aria-label="Bigger">' + ic('plus') + '</button></span>' +
        swatch('textColor', l.fill || l.color, 'Text color') + SEP +
        tb('bold', 'bold', 'Bold (Ctrl+B)', { pressed: (l.weight || 400) >= 600 }) + tb('italic', 'italic', 'Italic (Ctrl+I)', { pressed: !!l.italic }) +
        tb('underline', 'underline', 'Underline (Ctrl+U)', { pressed: !!l.underline }) + tb('strike', 'strike', 'Strikethrough', { pressed: !!l.strike }) +
        tb('upper', 'upper', 'Uppercase', { pressed: !!l.uppercase }) +
        tb('align', l.align === 'center' ? 'alignC' : l.align === 'right' ? 'alignR' : 'alignL', 'Alignment') + tb('list', 'list', 'Bulleted list') + tb('spacing', 'spacing', 'Spacing') + SEP +
        tb('effects', 'sparkle', 'Effects', { text: true }) + common(l);
    } else if (kind === 'shape') {
      html = swatch('fill', l.fill, 'Fill color') + tb('stroke', null, 'Border', { text: true }) + tb('edit', 'adjust', 'Edit shape', { text: true }) + tb('effects', 'sparkle', 'Effects', { text: true }) + tb('flipMenu', 'flip', 'Flip') + common(l);
    } else if (kind === 'svg') {
      var tint = /^(lucide|phosphor):/.test(l.assetId || '') || (!l.assetId && l.color);
      var wi = /^withicons:/.test(l.assetId || '');
      var qr = /^qr:/.test(l.assetId || '');
      html = (wi ? tb('iconColors', 'palette', 'Colours', { text: true }) + tb('swapStyle', 'swap', 'Swap style', { text: true }) : qr ? tb('editQr', 'qr', 'Edit QR code', { text: 'Edit QR' }) : tint ? swatch('svgColor', l.color || '#17131F', 'Icon color') : tb('tintSticker', 'palette', 'Tint', { text: true })) +
        (qr ? '' : tb('edit', 'adjust', 'Edit', { text: true })) + tb('effects', 'sparkle', 'Effects', { text: true }) + tb('flipMenu', 'flip', 'Flip') + common(l);
    } else if (kind === 'path') {
      html = swatch('pathColor', l.color, 'Ink color') + tb('edit', 'adjust', 'Edit drawing', { text: true }) + common(l);
    } else if (kind === 'group') {
      html = tb('ungroup', 'ungroup', 'Ungroup (Ctrl+Shift+G)', { text: true }) + tb('effects', 'sparkle', 'Effects', { text: true }) + common(l);
    } else if (kind === 'multi') {
      html = tb('group', 'group', 'Group (Ctrl+G)', { text: true }) + tb('alignMenu', 'alC', 'Align', { text: true }) + SEP + tb('opacity', 'opacity', 'Transparency') + tb('position', 'position', 'Position', { text: true }) + SEP + tb('dup', 'copy', 'Duplicate') + tb('del', 'trash', 'Delete');
    } else {
      var bg = doc().background || {};
      html = S.project ? tb('resize', 'resize', 'Resize', { text: true }) + swatch('pageBg', bg.type === 'gradient' ? { type: 'gradient', kind: bg.kind, colors: bg.colors, angle: bg.angle } : (bg.color || '#ffffff'), 'Background color') + (fire('toolbar', 'page') || '') + SEP +
        tb('addPhoto', 'image', 'Add photo', { text: true }) + tb('addText', 'text', 'Add text', { text: true }) + tb('elements', 'elements', 'Elements', { text: true }) + SEP +
        tb('replaceAll', 'swap', 'Replace colours & fonts', { text: 'Replace all' }) + tb('pagesPanel', 'pages', 'Pages') + '<span class="sx-grow"></span>' + tb('compareHold', 'compare', 'Hold to compare', { cls: 'sx-hold' }) : '<span class="sx-tb-label">' + ic('shield') + 'Private by design — nothing leaves this device</span>';
    }
    html += fireAll('toolbar-add', kind, l);
    var custom = fire('toolbar', kind, l);
    if (typeof custom === 'string') html = custom;
    E.tool.innerHTML = html;
    E.tool.setAttribute('data-kind', kind);
    var fs = byId('sx-fsize');
    if (fs) fs.addEventListener('change', function () { var v = clamp(Number(fs.value) || 12, 4, 2000); patch(sel(), { size: v }, gesture()); });
  }
  var renderToolbarSoon = debounce(function () { if (!S.pointer) renderToolbar(); }, 120);

  /* ---------- Mini toolbar ---------- */
  function placeMini() {
    var ids = sel();
    var m = E.mini;
    if (!ids.length || S.pointer || S.tool !== 'select' || S.editing || S.preview || !S.project) { m.hidden = true; return; }
    var rect = null;
    ids.forEach(function (id) {
      var r = scene.screenRect(id);
      if (!r) return;
      if (!rect) rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      else { rect.left = Math.min(rect.left, r.left); rect.top = Math.min(rect.top, r.top); rect.right = Math.max(rect.right, r.right); rect.bottom = Math.max(rect.bottom, r.bottom); }
    });
    if (!rect) { m.hidden = true; return; }
    var l = ids.length === 1 ? L(ids[0]) : null;
    var key = ids.join(',') + (l && l.locked ? 'L' : '');
    if (m._key !== key) {
      m.innerHTML = tb('dup', 'copy', 'Duplicate') + tb('del', 'trash', 'Delete') + tb(l && l.locked ? 'unlock' : 'lock', l && l.locked ? 'lock' : 'unlock', l && l.locked ? 'Unlock' : 'Lock') + tb('more', 'more', 'More');
      m._key = key;
      m.classList.remove('is-pop');
      void m.offsetWidth;
      m.classList.add('is-pop');
    }
    m.hidden = false;
    var sr = E.stage.getBoundingClientRect();
    var mw = m.offsetWidth || 168, mh = m.offsetHeight || 44;
    var x = (rect.left + rect.right) / 2 - sr.left - mw / 2;
    var y = rect.bottom - sr.top + 14;
    if (y + mh > sr.height - 8) y = rect.top - sr.top - mh - 52;
    if (y < 8) y = clamp(rect.top - sr.top + 12, 8, sr.height - mh - 8);
    m.style.transform = 'translate(' + Math.round(clamp(x, 8, sr.width - mw - 8)) + 'px,' + Math.round(clamp(y, 8, sr.height - mh - 8)) + 'px)';
    var le = E.sceneEl.querySelector('.le-sel');
    if (le && S.pulseKey !== ids.join(',')) {
      S.pulseKey = ids.join(',');
      le.classList.remove('sx-pulse');
      void le.offsetWidth;
      le.classList.add('sx-pulse');
    }
  }

  /* ---------- Footer ---------- */
  function renderFoot() {
    var d = doc();
    var p = S.project;
    var pages = p ? p.pages.length : 1;
    E.foot.innerHTML =
      '<button type="button" class="sx-footbtn" data-cmd="pages" aria-label="Pages">' + ic('pages') + '<span>Page ' + ((p ? p.activePage : 0) + 1) + ' / ' + pages + '</span></button>' +
      '<button type="button" class="sx-footbtn" data-cmd="resize" aria-label="Page size, resize">' + ic('resize') + '<span id="sx-dims">' + d.width + ' × ' + d.height + ' px</span></button>' +
      '<span class="sx-grow"></span>' +
      '<button type="button" class="sx-footbtn sx-hold" data-cmd="compareHold" aria-label="Hold to compare with the original">' + ic('compare') + '<span>Hold to compare</span></button>' +
      '<span class="sx-grow"></span>' +
      '<button type="button" class="sx-iconbtn" data-cmd="zoomOut" aria-label="Zoom out">' + ic('minus') + '</button>' +
      '<input type="range" id="sx-zoom" min="0" max="100" step="1" aria-label="Zoom">' +
      '<button type="button" class="sx-iconbtn" data-cmd="zoomIn" aria-label="Zoom in">' + ic('plus') + '</button>' +
      '<button type="button" class="sx-footbtn sx-zoomlabel" data-cmd="zoomMenu" aria-label="Zoom presets"><span id="sx-zoomv">100%</span></button>' +
      '<button type="button" class="sx-iconbtn" data-cmd="guidesMenu" aria-label="Rulers, guides, grid and snapping" title="Rulers & grid (Shift+R)" aria-pressed="' + !!(S.ov && (S.ov.rulers || S.ov.grid)) + '">' + ic('ruler') + '</button>' +
      '<button type="button" class="sx-iconbtn" data-cmd="fit" aria-label="Fit to screen (Ctrl+0)" title="Fit (Ctrl+0)">' + ic('fit') + '</button>' +
      '<button type="button" class="sx-iconbtn" data-cmd="layers" aria-label="Layers" title="Layers">' + ic('layers') + '</button>';
    var z = byId('sx-zoom');
    z.addEventListener('input', function () {
      var zz = Math.exp(Math.log(0.05) + (Math.log(8) - Math.log(0.05)) * Number(z.value) / 100);
      S.fitting = true; scene.zoomTo(zz); S.fitting = false; S.autoFit = false;
    });
    paintZoom();
  }
  function paintZoom() {
    var z = byId('sx-zoom'), v = byId('sx-zoomv');
    var zz = scene.zoom();
    if (z && document.activeElement !== z) {
      var t = (Math.log(zz) - Math.log(0.05)) / (Math.log(8) - Math.log(0.05)) * 100;
      z.value = Math.round(t);
      z.style.setProperty('--t', t + '%');
    }
    if (v) v.textContent = Math.round(zz * 100) + '%';
  }

  /* ---------- Assets ---------- */
  function makeThumb(canvas, max, type) {
    var c = LE.fit(canvas, max || 240);
    return LE.toBlob(c, type || 'image/jpeg', 0.82);
  }
  var urlCache = {};
  function thumbUrl(id) {
    if (urlCache[id]) return Promise.resolve(urlCache[id]);
    return LE.project.assetRecord(id).then(function (rec) {
      if (!rec) return '';
      urlCache[id] = URL.createObjectURL(rec.thumb || rec.blob);
      return urlCache[id];
    }).catch(function () { return ''; });
  }
  function decode(blob, name) {
    return LE.load(new File([blob], name || 'image', { type: blob.type || 'image/png' }));
  }
  /* Resolution policy for local photos (QA-015): keep the original pixels up to a device-class ceiling; the editor
     works on a downscaled preview (le-objects), export renders from the original. `saver` keeps the old aggressive rules. */
  var INGEST_CEIL = { older: 4096, modern: 6000, desktop: 8000 };
  var INGEST_UP = { older: 'modern', modern: 'desktop', desktop: 'huge' };
  var REENCODE_BYTES = 25 * 1024 * 1024;
  function ingestPolicy() {
    var mode = (LE.perf && typeof LE.perf.mode === 'function') ? LE.perf.mode() : 'auto';
    var pm = (LE.perf && typeof LE.perf.previewMax === 'function') ? LE.perf.previewMax() : 2400;
    if (mode === 'saver') return { mode: mode, trigger: Math.round(pm * 1.4), target: pm, bytes: 8 * 1024 * 1024, quality: 0.82 };
    var tier = (LE.device && LE.device.tier) ? LE.device.tier() : 'desktop';
    var cls = mode === 'quality' ? INGEST_UP[tier] : tier;
    var ceil = cls === 'huge' ? 12000 : (INGEST_CEIL[cls] || 8000);
    return { mode: mode, trigger: ceil, target: ceil, bytes: REENCODE_BYTES, quality: 0.92 };
  }
  function hasAlphaCanvas(canvas) {
    try {
      var ctx = canvas.getContext('2d'), step = 256, w = canvas.width;
      for (var y = 0; y < canvas.height; y += step) {
        var d = ctx.getImageData(0, y, w, Math.min(step, canvas.height - y)).data;
        for (var i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
      }
    } catch (e) { return true; }
    return false;
  }
  function reencode(src, canvas, edge, quality) {
    var type = (/jpe?g/i.test(src.type || '') || !hasAlphaCanvas(canvas)) ? 'image/jpeg' : 'image/png';
    var c = edge && Math.max(canvas.width, canvas.height) > edge ? LE.fit(canvas, edge) : canvas;
    return LE.toBlob(c, type, type === 'image/jpeg' ? quality : undefined).then(function (blob) {
      var base = String(src.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
      var next = new File([blob], base + (type === 'image/png' ? '.png' : '.jpg'), { type: type });
      if (src.source) next.source = src.source;
      next._leResized = true;
      return { file: next, canvas: c };
    });
  }
  function ingest(file) {
    if (!file) return Promise.reject(new Error('No file'));
    if (file.type && !/^image\//.test(file.type)) return Promise.reject(new Error('Choose an image file.'));
    var cap = LE.project.LIMITS.assetBytes;
    var pol = ingestPolicy();
    var tooBig = function () { return new Error('That photo is too large for this browser.'); };
    var name = file.name || 'photo';
    return decode(file, name).then(function (canvas) {
      if (!canvas || !canvas.width) throw new Error('Could not read that image.');
      var edge = Math.max(canvas.width, canvas.height);
      var shrink = edge > pol.trigger;
      var heavy = file.size > pol.bytes || file.size > cap;
      if (file._leResized || !LE.toBlob || (!shrink && !heavy)) {
        if (file.size > cap) throw tooBig();
        return { file: file, canvas: canvas };
      }
      var target = shrink ? pol.target : edge;
      return reencode(file, canvas, shrink ? target : 0, pol.quality).then(function (out) {
        if (out.canvas !== canvas) { try { canvas.width = 1; canvas.height = 1; } catch (e) {} }
        if (out.file.size <= cap) return out;
        return reencode(file, out.canvas, 0, 0.8).then(function (again) { if (again.file.size > cap) throw tooBig(); return again; });
      }, function () {
        if (file.size > cap) throw tooBig();
        return { file: file, canvas: canvas };
      }).then(function (out) {
        if (out.file !== file) {
          out.note = shrink
            ? 'This photo was reduced to ' + Math.max(out.canvas.width, out.canvas.height) + ' px ' + (out.canvas.width >= out.canvas.height ? 'wide' : 'tall') + ' to fit this device.'
            : 'This photo was compressed to keep the file under ' + Math.round(pol.bytes / 1048576) + ' MB; its pixel size is unchanged.';
        }
        return out;
      });
    }).then(function (pair) {
      if (pair.note) toast(pair.note);
      var blob = pair.file;
      var source = blob.source || file.source;
      return makeThumb(pair.canvas, 240).then(function (thumb) {
        var info = { blob: blob, name: blob.name || name, type: blob.type || 'image/png', width: pair.canvas.width, height: pair.canvas.height, thumb: thumb };
        if (source) info.source = source;
        return LE.project.putAsset(info);
      }).then(function (meta) {
        S.mem[meta.id] = { meta: meta, canvas: pair.canvas };
        scene.addAsset(meta.id, pair.canvas);
        if (S.project) S.project.assets[meta.id] = meta;
        return meta;
      });
    });
  }
  function assetMeta(rec, canvas) {
    var meta = { id: rec.id, type: rec.type, name: rec.name, width: canvas.width, height: canvas.height, bytes: rec.bytes, original: true };
    var s = rec.source;
    if (s && typeof s === 'object') {
      var source = {};
      if (s.provider) source.provider = String(s.provider).slice(0, 40);
      if (s.photographer) source.photographer = String(s.photographer).slice(0, 160);
      if (s.pageUrl && /^https?:\/\//i.test(s.pageUrl)) source.pageUrl = String(s.pageUrl).slice(0, 500);
      if (s.photographerUrl && /^https?:\/\//i.test(s.photographerUrl)) source.photographerUrl = String(s.photographerUrl).slice(0, 500);
      if (s.license) source.license = String(s.license).slice(0, 80);
      if (s.attribution) source.attribution = String(s.attribution).slice(0, 600);
      if (source.provider || source.photographer || source.pageUrl || source.license || source.attribution) meta.source = source;
    }
    return meta;
  }
  function ensureAssets(ids) {
    return Promise.all(ids.map(function (id) {
      if (S.mem[id]) { scene.addAsset(id, S.mem[id].canvas); return null; }
      return LE.project.assetRecord(id).then(function (rec) {
        if (!rec) return 'missing';
        return decode(rec.blob, rec.name).then(function (canvas) {
          S.mem[id] = { meta: assetMeta(rec, canvas), canvas: canvas };
          scene.addAsset(id, canvas);
          return null;
        });
      }).catch(function () { return 'missing'; });
    })).then(function (r) { return r.filter(Boolean).length; });
  }
  function pickFiles(mode) {
    if (mode === 'project') { E.fileProject.click(); return; }
    if (mode === 'recipe') { E.fileRecipe.click(); return; }
    if (mode === 'batch') { E.fileBatch.click(); return; }
    E.file.dataset.mode = mode || 'add';
    E.file.click();
  }
  E.file.addEventListener('change', function () {
    var files = [].slice.call(E.file.files || []);
    var mode = E.file.dataset.mode || 'add';
    E.file.value = '';
    if (mode === 'replace') { replaceImage(files[0]); return; }
    if (mode === 'tray') { addFiles(files, { trayOnly: true }); return; }
    addFiles(files);
  });
  E.fileProject.addEventListener('change', function () {
    var f = E.fileProject.files && E.fileProject.files[0];
    E.fileProject.value = '';
    if (f) importProject(f);
  });
  E.fileRecipe.addEventListener('change', function () {
    var f = E.fileRecipe.files && E.fileRecipe.files[0];
    E.fileRecipe.value = '';
    if (f && S.onRecipeFile) S.onRecipeFile(f);
  });
  E.fileBatch.addEventListener('change', function () {
    var fs = [].slice.call(E.fileBatch.files || []);
    E.fileBatch.value = '';
    if (S.onBatchFiles) S.onBatchFiles(fs);
  });

  function addFiles(files, opts) {
    opts = opts || {};
    files = (files || []).filter(Boolean);
    var design = LE.design && LE.design.isDesignFile ? files.filter(LE.design.isDesignFile)[0] : null;
    if (design) { LE.design.studioImport(ctx, design); return Promise.resolve(); }
    var proj =files.filter(function (f) { return /\.leproject$/i.test(f.name) || f.type === 'application/zip'; });
    if (proj.length) { importProject(proj[0]); return Promise.resolve(); }
    var imgs = files.filter(function (f) { return !f.type || /^image\//.test(f.type); });
    if (!imgs.length) { toast('Choose an image file.'); return Promise.resolve(); }
    var chain = Promise.resolve();
    var added = [];
    if (!S.project && !opts.trayOnly) {
      var first = imgs.shift();
      chain = chain.then(function () { return newFromPhoto(first); });
    }
    imgs.forEach(function (f) {
      chain = chain.then(function () {
        return ingest(f).then(function (meta) {
          if (!S.project) newBlankFromMeta(meta);
          if (!opts.trayOnly) added.push(placeImage(meta.id, opts.at));
        });
      }).catch(function (err) { toast(err.message || 'Could not read that image.'); });
    });
    return chain.then(function () {
      if (added.length > 1) scene.select(added);
      if (opts.trayOnly) toast('Added to Uploads');
      markDirty();
      if (S.panel === 'uploads') renderPanel(true);
    }).catch(function (err) { toast(err.message || 'Could not read that image.'); });
  }
  function placeImage(id, at) {
    var m = S.mem[id];
    if (!m) return null;
    var d = doc();
    var s = Math.min(d.width * 0.62 / m.canvas.width, d.height * 0.62 / m.canvas.height);
    var w = m.canvas.width * s, hh = m.canvas.height * s;
    var x = at ? at.x - w / 2 : (d.width - w) / 2;
    var y = at ? at.y - hh / 2 : (d.height - hh) / 2;
    scene.setTool('select');
    return scene.add({ type: 'image', src: id, x: x, y: y, w: w, h: hh, name: (m.meta.name || 'Photo').replace(/\.[^.]+$/, '').slice(0, 40) });
  }
  function replaceSpec(input) {
    if (!input) return null;
    if (typeof input === 'string') return /^[a-f0-9]{64}$/.test(input) ? { id: input } : null;
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      var file = input instanceof File ? input : new File([input], 'photo.jpg', { type: input.type || 'image/jpeg' });
      return { file: file };
    }
    var blob = input.file || input.blob;
    if (typeof Blob !== 'undefined' && blob instanceof Blob) {
      var named = blob instanceof File ? blob : new File([blob], input.name || 'photo.jpg', { type: blob.type || 'image/jpeg' });
      if (input.source && !named.source) named.source = input.source;
      return { file: named };
    }
    if (input.id && /^[a-f0-9]{64}$/.test(input.id)) return { id: input.id };
    return null;
  }
  function loadStored(id) {
    if (S.mem[id] && S.mem[id].canvas) return Promise.resolve(S.mem[id].meta);
    return LE.project.assetRecord(id).then(function (rec) {
      if (!rec || !rec.blob) throw new Error('That photo is not on this device.');
      return decode(rec.blob, rec.name).then(function (canvas) {
        var meta = assetMeta(rec, canvas);
        S.mem[id] = { meta: meta, canvas: canvas };
        scene.addAsset(id, canvas);
        if (S.project) S.project.assets[id] = Object.assign({}, S.project.assets[id] || {}, meta);
        return meta;
      });
    });
  }
  function replaceImage(input) {
    var l = one();
    if (!l || l.type !== 'image') return Promise.resolve(null);
    var spec = replaceSpec(input);
    if (!spec) return Promise.resolve(null);
    var layerId = l.id;
    var ready = spec.id ? loadStored(spec.id) : ingest(spec.file);
    return ready.then(function (meta) {
      var mem = meta && S.mem[meta.id];
      var cur = L(layerId);
      if (!mem || !mem.canvas || !cur || cur.type !== 'image') throw new Error('Could not read that image.');
      var crop = coverCrop(mem.canvas.width, mem.canvas.height, null, cur.w, cur.h, null);
      var name = String(meta.name || 'Photo').replace(/\.[^.]+$/, '').slice(0, 40);
      patch(layerId, { src: meta.id, crop: crop, name: name });
      if (layerId === S.baseId) studio().baseRegion = { x: 0, y: 0, w: 1, h: 1 };
      toast('Image replaced — edits kept');
      return meta;
    }).catch(function (err) { toast((err && err.message) || 'Could not replace that photo.'); return null; });
  }
  function openReplace() {
    var l = one();
    if (!l || l.type !== 'image') { toast('Select a photo to replace.'); return; }
    if (window.LEStudioCollage && typeof LEStudioCollage.openReplace === 'function') { LEStudioCollage.openReplace(ctx); return; }
    pickFiles('replace');
  }

  /* ---------- Geometry ---------- */
  function coverCrop(iw, ih, reg, W, H, focal) {
    reg = reg || { x: 0, y: 0, w: 1, h: 1 };
    focal = focal || { x: 0.5, y: 0.5 };
    var rw = iw * reg.w, rh = ih * reg.h;
    var A = rw / rh, T = W / H;
    var c = { x: reg.x, y: reg.y, w: reg.w, h: reg.h };
    if (A > T) {
      c.w = reg.w * (T / A);
      c.x = clamp(reg.x + reg.w * focal.x - c.w / 2, reg.x, reg.x + reg.w - c.w);
    } else {
      c.h = reg.h * (A / T);
      c.y = clamp(reg.y + reg.h * focal.y - c.h / 2, reg.y, reg.y + reg.h - c.h);
    }
    return { x: r6(c.x), y: r6(c.y), w: r6(c.w), h: r6(c.h) };
  }
  function scaleLayer(l, w0, h0, W, H, s, scaleContent) {
    var cx = (l.x + l.w / 2) / w0 * W, cy = (l.y + l.h / 2) / h0 * H;
    if (!scaleContent) { l.x = r3(cx - l.w / 2); l.y = r3(cy - l.h / 2); return; }
    l.w = r3(l.w * s); l.h = r3(l.h * s);
    l.x = r3(cx - l.w / 2); l.y = r3(cy - l.h / 2);
    if (l.shadow) { l.shadow.blur = r3(l.shadow.blur * s); l.shadow.x = r3(l.shadow.x * s); l.shadow.y = r3(l.shadow.y * s); }
    if (l.type === 'text') {
      l.size = r3(l.size * s);
      l.letterSpacing = r3((l.letterSpacing || 0) * s);
      if (l.stroke) l.stroke.width = r3(l.stroke.width * s);
      if (l.background) { l.background.padding = r3(l.background.padding * s); if (l.background.radius < 999) l.background.radius = r3(l.background.radius * s); }
    } else if (l.type === 'shape') {
      if (l.stroke) { l.stroke.width = r3(l.stroke.width * s); if (l.stroke.dash) l.stroke.dash = l.stroke.dash.map(function (d) { return r3(d * s); }); }
      l.radius = r3((l.radius || 0) * s);
      if (l.params && l.params.radius != null) l.params.radius = r3(l.params.radius * s);
    } else if (l.type === 'image') {
      l.radius = r3((l.radius || 0) * s);
      if (l.border) l.border.width = r3(l.border.width * s);
    } else if (l.type === 'path') {
      l.points = l.points.map(function (p) { return [r3(p[0] * s), r3(p[1] * s), p[2]]; });
      l.width = r3(l.width * s);
    }
  }
  function reframeBase(l, W, H, o, s) {
    var m = S.mem[l.src];
    if (!m) return false;
    var iw = m.canvas.width, ih = m.canvas.height;
    var reg = o.region || { x: 0, y: 0, w: 1, h: 1 };
    l.rotation = 0;
    if (o.fit === 'contain') {
      l.crop = clone(reg);
      var rw = iw * reg.w, rh = ih * reg.h, k = Math.min(W / rw, H / rh);
      l.w = r3(rw * k); l.h = r3(rh * k);
      l.x = r3((W - l.w) / 2); l.y = r3((H - l.h) / 2);
    } else if (o.fit === 'stretch') {
      l.crop = clone(reg);
      l.x = 0; l.y = 0; l.w = W; l.h = H;
    } else {
      l.crop = coverCrop(iw, ih, reg, W, H, o.focal);
      l.x = 0; l.y = 0; l.w = W; l.h = H;
    }
    if (o.scaleContent) {
      l.radius = r3((l.radius || 0) * s);
      if (l.border) l.border.width = r3(l.border.width * s);
    }
    return true;
  }
  function computeResize(from, W, H, o) {
    var d = clone(from);
    var w0 = d.width, h0 = d.height;
    W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
    d.width = W; d.height = H;
    var s = Math.min(W / w0, H / h0);
    var groups = [];
    d.layers.forEach(function (l) {
      if (l.type === 'group') { groups.push(l); return; }
      if (o.baseId && l.id === o.baseId && l.type === 'image' && reframeBase(l, W, H, o, s)) return;
      scaleLayer(l, w0, h0, W, H, s, o.scaleContent);
    });
    groups.forEach(function (g) {
      var kids = d.layers.filter(function (l) { return l.groupId === g.id && l.type !== 'group'; });
      if (!kids.length) { scaleLayer(g, w0, h0, W, H, s, o.scaleContent); return; }
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      kids.forEach(function (k) { x0 = Math.min(x0, k.x); y0 = Math.min(y0, k.y); x1 = Math.max(x1, k.x + k.w); y1 = Math.max(y1, k.y + k.h); });
      g.x = r3(x0); g.y = r3(y0); g.w = r3(x1 - x0); g.h = r3(y1 - y0);
    });
    return d;
  }
  function fp(d) { return LE.project.fingerprint(JSON.stringify(d)); }
  function resizeSource(cur, chain) {
    var st = studio();
    var base = S.baseId && cur.layers.filter(function (l) { return l.id === S.baseId; })[0];
    if (chain) return { from: cur, region: base ? clone(base.crop) : null, source: 'current' };
    var from = st.anchor && st.lastResult && st.lastResult === fp(cur) ? st.anchor : cur;
    return { from: from, region: clone(st.baseRegion || { x: 0, y: 0, w: 1, h: 1 }), source: 'original' };
  }
  function sizeOpts(extra) {
    var st = studio();
    return Object.assign({ fit: st.fit || 'cover', focal: st.focal || { x: 0.5, y: 0.5 }, scaleContent: st.scaleContent !== false, baseId: baseLayer() ? S.baseId : null }, extra || {});
  }
  function previewSize(W, H, label, extra) {
    if (!S.project) return;
    if (S.preview && S.preview.type !== 'size') return;
    if (!S.preview) { S.preview = { type: 'size', pre: doc(), sel: sel() }; S.silent = true; setSave('preview'); }
    var o = sizeOpts(extra);
    var src = resizeSource(S.preview.pre, S.chain);
    o.region = src.region;
    var d = computeResize(src.from, W, H, o);
    S.preview.doc = d;
    S.preview.target = { W: Math.round(W), H: Math.round(H), label: label || (Math.round(W) + ' × ' + Math.round(H)), o: o, src: src };
    replaceDoc(d, false);
    scene.select([]);
    fit();
    showSizeBar();
    renderToolbar();
  }
  function cancelPreview() {
    var p = S.preview;
    if (!p) return;
    S.preview = null;
    replaceDoc(p.pre, false);
    S.silent = false;
    if (p.sel) scene.select(p.sel);
    fit();
    hideBar();
    setSave(S.dirty ? 'dirty' : 'saved');
    renderToolbar();
    renderFoot();
    if (p.type === 'size' && S.panel === 'design') renderPanel(true);
  }
  function commitSize() {
    var p = S.preview;
    if (!p || p.type !== 'size' || !p.target) return;
    var t = p.target;
    S.preview = null;
    replaceDoc(p.pre, false);
    S.silent = false;
    replaceDoc(p.doc, true);
    var st = studio();
    st.anchor = t.src.from;
    st.lastResult = fp(doc());
    st.fit = t.o.fit;
    st.focal = t.o.focal;
    st.scaleContent = t.o.scaleContent;
    pushSize({ type: 'resize', label: t.label, from: { w: p.pre.width, h: p.pre.height }, to: { w: t.W, h: t.H }, fit: t.o.fit, source: t.src.source, scaleContent: t.o.scaleContent, before: p.pre });
    fit();
    hideBar();
    renderFoot();
    renderToolbar();
    markDirty();
    toast('Resized to ' + t.W + ' × ' + t.H + (t.src.source === 'original' ? ' from the original' : ' from the current result'));
    fire('resize');
    if (S.panel === 'design') renderPanel(true);
  }
  function pushSize(entry) {
    entry.id = newId('s');
    entry.at = Date.now();
    var list = S.project.sizeHistory = S.project.sizeHistory || [];
    list.push(entry);
    if (list.length > 50) list.splice(0, list.length - 50);
    LE.project.log(entry.type === 'revert' ? 'size-reverted' : 'resized', S.project.id, { label: entry.label, from: entry.from, to: entry.to, fit: entry.fit, source: entry.source });
  }
  function applySizeNow(W, H, label, extra) {
    previewSize(W, H, label, extra);
    commitSize();
  }
  function resetSize() {
    var st = studio();
    var os = st.originalSize || (S.project.sizeHistory[0] && S.project.sizeHistory[0].from);
    if (!os) { toast('This design is already at its original size.'); return; }
    var chain = S.chain;
    S.chain = false;
    previewSize(os.w, os.h, 'Original size');
    commitSize();
    S.chain = chain;
  }
  function revertSize(entryId) {
    var list = (S.project && S.project.sizeHistory) || [];
    var e = list.filter(function (x) { return x.id === entryId; })[0];
    if (!e || !e.before) return;
    var cur = doc();
    replaceDoc(e.before, true);
    e.reverted = true;
    var st = studio();
    st.anchor = null;
    st.lastResult = '';
    pushSize({ type: 'revert', label: 'Reverted ' + (e.label || 'resize'), from: { w: cur.width, h: cur.height }, to: { w: e.before.width, h: e.before.height }, fit: e.fit, source: 'original', scaleContent: e.scaleContent, before: cur });
    fit();
    renderFoot();
    markDirty();
    toast('Back to ' + e.before.width + ' × ' + e.before.height);
    fire('resize');
    if (S.panel === 'design' || S.panel === 'history') renderPanel(true);
  }
  function showSizeBar() {
    var p = S.preview;
    if (!p || !p.target) return;
    var st = sizeOpts();
    var t = p.target;
    E.bar.hidden = false;
    E.bar.className = 'sx-bar is-size';
    E.bar.innerHTML = '<div class="sx-bar-info"><span class="sx-eyebrow">Previewing</span><strong>' + esc(t.label) + '</strong><small>' + t.W + ' × ' + t.H + ' px · from ' + (t.src.source === 'original' ? 'original' : 'current result') + '</small></div>' +
      '<div class="sx-bar-fit"></div><div class="sx-bar-act"><button type="button" class="btn btn-sm btn-ghost" data-cmd="sizeCancel">Cancel</button><button type="button" class="btn btn-sm btn-gold" data-cmd="sizeUse">' + ic('check') + 'Use this size</button></div>';
    var fitHost = E.bar.querySelector('.sx-bar-fit');
    if (baseLayer()) {
      fitHost.appendChild(ui.seg([['cover', 'Fill'], ['contain', 'Fit'], ['stretch', 'Stretch']], t.o.fit, function (v) {
        studio().fit = v;
        previewSize(t.W, t.H, t.label, { fit: v });
      }, 'sx-seg-sm'));
    }
    var tog = h('<label class="sx-mini-toggle"><input type="checkbox"' + (st.scaleContent ? ' checked' : '') + '><span>Scale content</span></label>');
    tog.querySelector('input').onchange = function (e) { studio().scaleContent = e.target.checked; previewSize(t.W, t.H, t.label, { scaleContent: e.target.checked }); };
    fitHost.appendChild(tog);
  }
  function hideBar() { E.bar.hidden = true; E.bar.innerHTML = ''; }

  function hiddenRender(d, scale, opts) {
    opts = opts || {};
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:96px;height:96px;pointer-events:none;';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    var sc = new LE.Scene({ el: host, width: d.width, height: d.height });
    Object.keys(S.mem).forEach(function (id) {
      var m = S.mem[id];
      if (opts.small) {
        if (!m.small) m.small = LE.fit(m.canvas, 900);
        sc.addAsset(id, m.small);
      } else sc.addAsset(id, m.canvas);
    });
    sc.load(d);
    function done() { try { sc.destroy(); } catch (e) {} host.remove(); }
    return sc.render(scale, { includeBackground: opts.includeBackground !== false }).then(function (c) { done(); return c; }, function (err) { done(); throw err; });
  }
  function compareSizes(list) {
    var src = resizeSource(doc(), S.chain);
    var o = sizeOpts({ region: src.region });
    return Promise.all(list.map(function (sz) {
      var d = computeResize(src.from, sz.w, sz.h, o);
      var scale = Math.min(1, 360 / Math.max(sz.w, sz.h));
      return hiddenRender(d, scale, { small: true }).then(function (c) { return { size: sz, canvas: c }; });
    }));
  }

  /* ---------- Artboard capture (cheap preview pixels) ---------- */
  function artboard(maxEdge) {
    var c = E.sceneEl.querySelector('canvas.le-view');
    var d = doc();
    if (!c || !c.clientWidth) return null;
    var k = c.width / c.clientWidth;
    var z = scene.zoom();
    var sx = S.view.panX * k, sy = S.view.panY * k, sw = d.width * z * k, sh = d.height * z * k;
    var x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(c.width, sx + sw), y1 = Math.min(c.height, sy + sh);
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    var scale = Math.min(1, (maxEdge || 360) / Math.max(sw, sh));
    var out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw * scale));
    out.height = Math.max(1, Math.round(sh * scale));
    var ctx2 = out.getContext('2d');
    ctx2.drawImage(c, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * scale, (y0 - sy) * scale, (x1 - x0) * scale, (y1 - y0) * scale);
    return out;
  }

  /* ---------- Project lifecycle ---------- */
  function setProject(p) {
    S.project = p;
    S.baseId = (p.meta && p.meta.studio && p.meta.studio.baseId) || null;
    S.known = {};
    S.pageThumbs = {};
    try { localStorage.setItem('le-studio-last', p.id); } catch (e) {}
    renderHead();
  }
  function loadPage(i) {
    var p = S.project;
    p.activePage = clamp(i, 0, p.pages.length - 1);
    S.silent = true;
    scene.load(p.pages[p.activePage]);
    S.silent = false;
    S.autoFit = true;
    fit();
    hideStart();
    renderToolbar();
    renderFoot();
    onHistory({ canUndo: false, canRedo: false });
    fire('page', p.activePage);
  }
  function newFromPhoto(file) {
    return ingest(file).then(function (meta) { newBlankFromMeta(meta, true); });
  }
  function newBlankFromMeta(meta, withBase) {
    var m = S.mem[meta.id];
    var w = m.canvas.width, hh = m.canvas.height;
    var baseId = newId('base');
    var page = LE.project.blankPage(w, hh);
    if (withBase !== false) page.layers.push({ id: baseId, type: 'image', name: 'Photo', src: meta.id, x: 0, y: 0, w: w, h: hh, crop: { x: 0, y: 0, w: 1, h: 1 } });
    var assets = {};
    assets[meta.id] = meta;
    var p = LE.project.create({
      name: (meta.name || 'Photo').replace(/\.[^.]+$/, '').slice(0, 80) || 'Photo design', pages: [page], assets: assets,
      studio: { baseId: withBase !== false ? baseId : null, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scaleContent: true, originalSize: { w: w, h: hh }, baseRegion: { x: 0, y: 0, w: 1, h: 1 } }
    });
    setProject(p);
    loadPage(0);
    if (withBase !== false) scene.select([baseId]);
    saveNow({ created: true });
  }
  function newDesign(w, hh, name) {
    cancelPreview();
    var p = LE.project.create({ name: name || 'Untitled design', width: w, height: hh, studio: { originalSize: { w: w, h: hh }, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scaleContent: true } });
    setProject(p);
    loadPage(0);
    saveNow({ created: true });
  }
  function useSample() {
    var c = LE.sample('scene');
    return LE.toBlob(c, 'image/png').then(function (blob) {
      return newFromPhoto(new File([blob], 'Sample scene.png', { type: 'image/png' }));
    });
  }
  function openProject(id, opts) {
    opts = opts || {};
    flushSave();
    return LE.project.open(id).then(function (p) { return startProject(p, opts); }).catch(function (err) { toast(err.message || 'Could not open that design.'); throw err; });
  }
  function startProject(p, opts) {
    opts = opts || {};
    cancelPreview();
    return ensureAssets(LE.project.assetIds(p)).then(function (missing) {
      Object.keys(p.assets || {}).forEach(function (id) { if (S.mem[id]) p.assets[id] = S.mem[id].meta; });
      setProject(p);
      loadPage(p.activePage || 0);
      if (missing) toast(missing + ' photo' + (missing > 1 ? 's are' : ' is') + ' missing from this device.');
      else if (opts.toast) toast(opts.toast, opts.action ? { action: opts.action } : null);
      if (S.panel) renderPanel(true);
      return p;
    });
  }
  function importProject(file) {
    if (LE.design && LE.design.isDesignFile && LE.design.isDesignFile(file)) return LE.design.studioImport(ctx, file);
    toast('Importing ' + (file.name || 'project') + '…', { ms: 1600 });
    return LE.project.importFile(file).then(function (p) {
      var warn = p.warnings || [];
      delete p.warnings;
      return startProject(p, { toast: 'Imported “' + p.name + '”' + (warn.length ? ' — ' + warn[0] : '') });
    }).catch(function (err) { toast(err.message || 'That project could not be imported.'); });
  }
  function exportProject() {
    if (!S.project) return Promise.resolve();
    syncProject();
    var thumb = artboard(512);
    var tp = thumb ? LE.toBlob(thumb, 'image/png') : Promise.resolve(null);
    return tp.then(function (t) { return LE.project.exportFile(S.project, { thumb: t }); }).then(function (blob) {
      download(blob, safeName(S.project.name) + '.leproject');
      return blob;
    }).catch(function (err) { toast(err.message || 'Could not export the project.'); });
  }
  function safeName(n) { return String(n || 'design').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'design'; }
  function download(blob, name) { if (window.IT && IT.download) IT.download(blob, name); else { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); } }

  function syncProject() {
    var p = S.project;
    if (!p) return;
    if (!S.preview) p.pages[p.activePage] = doc();
    var st = studio();
    st.baseId = baseLayer() ? S.baseId : null;
    if (!st.baseId) S.baseId = null;
  }
  function markDirty() {
    if (!S.project || S.preview) return;
    S.dirty = true;
    setSave('dirty');
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveNow, 700);
  }
  function saveNow(opts) {
    opts = opts || {};
    clearTimeout(S.saveTimer);
    if (!S.project || S.preview) return Promise.resolve();
    syncProject();
    var thumbCanvas = artboard(360);
    var tp = thumbCanvas ? LE.toBlob(thumbCanvas, 'image/jpeg', 0.8) : Promise.resolve(null);
    var p = S.project;
    return tp.then(function (thumb) {
      if (thumb) S.thumbs[p.id] = thumb;
      return LE.project.save(p, { thumb: thumb, created: opts.created }).then(function () {
        if (S.project !== p) return;
        S.dirty = false;
        setSave('saved');
        if (Date.now() - S.lastSnap > 30000 || opts.snapshot) {
          S.lastSnap = Date.now();
          LE.project.snapshot(p.id, opts.label || '', { project: p, thumb: thumb }).catch(function () {});
        }
      });
    }).catch(function (err) { setSave('error'); if (window.LEPwa) LEPwa.reportQuotaError(err); });
  }
  function flushSave() { if (S.dirty) saveNow(); }
  function checkpoint(label) {
    if (!S.project) return Promise.resolve();
    return saveNow().then(function () {
      syncProject();
      var t = S.thumbs[S.project.id] || null;
      return LE.project.snapshot(S.project.id, label || ('Version ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), { project: S.project, thumb: t });
    }).then(function () { toast('Version saved on this device'); if (S.panel === 'history') renderPanel(true); });
  }
  function previewVersion(v) {
    if (!S.project || !v || !v.doc) return;
    cancelPreview();
    var vd = v.doc;
    ensureAssets(LE.project.assetIds(vd)).then(function () {
      var page = vd.pages[clamp(vd.activePage || 0, 0, vd.pages.length - 1)];
      S.preview = { type: 'version', pre: doc(), sel: sel(), version: v };
      S.silent = true;
      setSave('preview');
      replaceDoc(page, false);
      scene.select([]);
      fit();
      E.bar.hidden = false;
      E.bar.className = 'sx-bar is-version';
      E.bar.innerHTML = '<div class="sx-bar-info"><span class="sx-eyebrow">Version preview</span><strong>' + esc(v.label || 'Autosave') + '</strong><small>' + new Date(v.at).toLocaleString() + '</small></div><div class="sx-bar-act"><button type="button" class="btn btn-sm btn-ghost" data-cmd="versionCancel">Cancel</button><button type="button" class="btn btn-sm btn-gold" data-cmd="versionRestore">' + ic('reset') + 'Restore this version</button></div>';
    });
  }
  function restoreVersion() {
    var p = S.preview;
    if (!p || p.type !== 'version') return;
    var v = p.version;
    cancelPreview();
    saveNow().then(function () {
      return LE.project.snapshot(S.project.id, 'Before restoring', { project: S.project, thumb: S.thumbs[S.project.id] });
    }).then(function () { return LE.project.restore(S.project.id, v.id); }).then(function (proj) {
      return startProject(proj, { toast: 'Version restored' });
    }).catch(function (err) { toast(err.message || 'Could not restore.'); });
  }
  function showStart() {
    E.start.hidden = false;
    root.classList.add('is-start');
    if (PANELS._start) PANELS._start(ctx, E.start);
    renderToolbar();
  }
  function hideStart() {
    if (E.start.hidden) return;
    E.start.hidden = true;
    root.classList.remove('is-start');
    E.start.innerHTML = '';
  }

  /* ---------- Pages ---------- */
  function remapIds(d) {
    var map = {};
    d.layers.forEach(function (l) { map[l.id] = newId('l'); });
    d.layers.forEach(function (l) { l.id = map[l.id]; if (l.groupId) l.groupId = map[l.groupId] || null; });
    return d;
  }
  function addPage(dup) {
    if (!S.project) return;
    syncProject();
    var p = S.project;
    var cur = p.pages[p.activePage];
    var d = dup ? remapIds(clone(cur)) : LE.project.blankPage(cur.width, cur.height, clone(cur.background && cur.background.type === 'color' ? cur.background : { type: 'color', color: '#ffffff' }));
    S.pageThumbs[p.activePage] = artboard(160);
    p.pages.splice(p.activePage + 1, 0, d);
    loadPage(p.activePage + 1);
    markDirty();
  }
  function switchPage(i) {
    if (!S.project || i === S.project.activePage) return;
    syncProject();
    S.pageThumbs[S.project.activePage] = artboard(160);
    loadPage(i);
    markDirty();
  }
  function deletePage(i) {
    var p = S.project;
    if (!p || p.pages.length < 2) { toast('A design needs at least one page.'); return; }
    syncProject();
    p.pages.splice(i, 1);
    S.pageThumbs = {};
    loadPage(Math.min(i, p.pages.length - 1));
    markDirty();
  }

  /* ---------- Adding things ---------- */
  function center() { var d = doc(); return { x: d.width / 2, y: d.height / 2, W: d.width, H: d.height, k: Math.min(d.width, d.height) / 1080 }; }
  function textHeight(text, size, lh) { return Math.ceil(String(text).split('\n').length * size * (lh || 1.2) * 1.06 + 4); }
  function addText(spec, at) {
    if (!S.project) newDesign(1080, 1080, 'Untitled design');
    var c = center();
    var size = (spec.size || 48) * c.k;
    var w = Math.min(c.W * 0.86, (spec.w || 760) * c.k);
    var layer = Object.assign({ type: 'text', text: 'Text', font: 'Plus Jakarta Sans', weight: 700, align: 'center', color: '#17131F', lineHeight: 1.2 }, spec, { size: size, w: w });
    if (layer.letterSpacing) layer.letterSpacing *= c.k;
    if (layer.stroke) layer.stroke = Object.assign({}, layer.stroke, { width: layer.stroke.width * c.k });
    if (layer.background) layer.background = Object.assign({}, layer.background, { padding: (layer.background.padding || 8) * c.k });
    if (layer.shadow) layer.shadow = Object.assign({}, layer.shadow, { blur: layer.shadow.blur * c.k, x: layer.shadow.x * c.k, y: layer.shadow.y * c.k });
    layer.h = spec.curve ? w : textHeight(layer.text, size, layer.lineHeight);
    layer.x = (at ? at.x : c.x) - w / 2 + (spec.dx || 0) * c.k;
    layer.y = (at ? at.y : c.y) - layer.h / 2 + (spec.dy || 0) * c.k;
    delete layer.dx; delete layer.dy;
    scene.setTool('select');
    return scene.add(layer);
  }
  function addLayers(list, opts) {
    opts = opts || {};
    return batch(function () {
      var ids = list.map(function (spec) { return spec.type === 'text' ? addText(spec, opts.at) : scene.add(spec); });
      var gid = opts.group && ids.length > 1 ? scene.group(ids) : null;
      if (gid && opts.name) patch(gid, { name: opts.name });
      scene.select(gid ? [gid] : ids);
      return gid || ids;
    });
  }
  function shapeSpec(id) {
    var list = shapeList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function shapeList() {
    try { if (LE.assets && LE.assets.shapes) { var s = LE.assets.shapes(); if (s && s.length) return s; } } catch (e) {}
    return [{ id: 'rect', name: 'Rectangle', path: function (w, hh) { return 'M0 0H' + w + 'V' + hh + 'H0Z'; } }, { id: 'ellipse', name: 'Circle', path: function (w, hh) { return 'M' + w + ' ' + hh / 2 + 'A' + w / 2 + ' ' + hh / 2 + ' 0 1 1 0 ' + hh / 2 + 'A' + w / 2 + ' ' + hh / 2 + ' 0 1 1 ' + w + ' ' + hh / 2 + 'Z'; } }];
  }
  function isOpenShape(id) {
    var sp = shapeSpec(id);
    return !!(sp && (sp.closed === false || sp.strokeOnly)) || id === 'line' || id === 'dashed-line' || id === 'arc' || id === 'polyline' || id === 'curve';
  }
  function addShape(id, at) {
    if (!S.project) newDesign(1080, 1080, 'Untitled design');
    var c = center();
    var sp = shapeSpec(id) || { id: id, editable: {} };
    var params = {};
    Object.keys(sp.editable || {}).forEach(function (k) { var e = sp.editable[k]; if (e && typeof e.default === 'number') params[k] = e.default; });
    var lineLike = /line|arrow-line|arrow-right|arrow-double|chevron/.test(id) && !/polyline/.test(id);
    var size = c.k * 300;
    var w = lineLike ? size * 1.5 : size, hh = lineLike ? (id === 'line' || id === 'dashed-line' ? size * 0.12 : size * 0.5) : size;
    if (/speech|cloud|cylinder|parallelogram|trapezoid/.test(id)) { w = size * 1.3; hh = size; }
    var layer = { type: 'shape', shape: id, name: sp.name || 'Shape', params: params, x: (at ? at.x : c.x) - w / 2, y: (at ? at.y : c.y) - hh / 2, w: w, h: hh, fill: { type: 'solid', color: '#7457F0' } };
    if (id === 'ring') {
      layer.shape = 'ellipse';
      layer.name = 'Ring';
      layer.fill = { type: 'none' };
      layer.stroke = { width: Math.round(size * 0.1), color: '#7457F0', cap: 'round', join: 'round' };
    } else if (isOpenShape(id)) {
      layer.fill = { type: 'none' };
      layer.stroke = { width: Math.max(3, Math.round(c.k * 8)), color: '#17131F', cap: 'round', join: 'round', dash: id === 'dashed-line' ? [c.k * 24, c.k * 18] : null };
    }
    scene.setTool('select');
    rememberEl({ kind: 'shape', id: id });
    return scene.add(layer);
  }
  function svgAspect(markup) {
    var m = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(markup || '');
    return m ? Number(m[1]) / Number(m[2]) || 1 : 1;
  }
  function addSvg(assetId, at, opts) {
    if (!S.project) newDesign(1080, 1080, 'Untitled design');
    var set = assetId.split(':')[0];
    var markup = '';
    try { markup = (opts && opts.markup) || LE.assets.svg(assetId, opts && opts.svg); } catch (e) { toast('That graphic is still loading.'); return null; }
    if (!markup) { toast('That graphic is still loading.'); return null; }
    var c = center();
    var icon = set === 'lucide' || set === 'phosphor';
    var size = c.k * (icon || set === 'withicons' || set === 'qr' ? 220 : 300);
    var a = svgAspect(markup);
    var w = a >= 1 ? size : size * a, hh = a >= 1 ? size / a : size;
    var layer = { type: 'svg', assetId: assetId, svg: markup, name: assetId.split(':')[1].replace(/-/g, ' ').slice(0, 40), x: (at ? at.x : c.x) - w / 2, y: (at ? at.y : c.y) - hh / 2, w: w, h: hh };
    if (icon) { layer.color = (opts && opts.color) || '#17131F'; if (set === 'lucide') layer.strokeWidth = 2; }
    if (opts && opts.name) layer.name = opts.name;
    scene.setTool('select');
    if (!opts || !opts.noRecent) rememberEl({ kind: 'svg', id: assetId });
    var id = scene.add(layer);
    fire('added-svg', id, opts);
    return id;
  }
  function rememberEl(item) {
    var list = lsGet('le-studio-recent-el', []).filter(function (x) { return !(x.kind === item.kind && x.id === item.id); });
    list.unshift(item);
    lsSet('le-studio-recent-el', list.slice(0, 16));
  }
  function applyMask(maskId) {
    var l = one();
    if (l && l.type === 'image') { patch(l.id, { mask: maskId, radius: maskId === 'rounded-rectangle' ? Math.min(l.w, l.h) * 0.12 : l.radius }, gesture()); return; }
    var ids = Object.keys(S.project ? S.project.assets : {}).filter(function (id) { return !/^background-/.test((S.project.assets[id] || {}).name || ''); });
    if (!ids.length) { toast('Upload a photo first, then pick a frame.'); pickFiles('add'); return; }
    var id = ids[ids.length - 1];
    var c = center();
    var size = Math.min(c.W, c.H) * 0.5;
    var m = S.mem[id];
    var crop = coverCrop(m.canvas.width, m.canvas.height, null, size, size, null);
    scene.add({ type: 'image', src: id, x: c.x - size / 2, y: c.y - size / 2, w: size, h: size, crop: crop, mask: maskId, name: 'Frame' });
  }
  function setBackground(bg) {
    if (!S.project) return;
    scene.setBackground(bg);
    renderToolbarSoon();
  }
  function setAsBackground() {
    var l = one();
    if (!l || l.type !== 'image') return;
    if (window.LEStudioBackground && LEStudioBackground.fromLayer) { LEStudioBackground.fromLayer(ctx, l.id); return; }
    batch(function () {
      scene.setBackground({ type: 'image', src: l.src, fit: 'cover', color: '#ffffff' });
      scene.remove([l.id]);
    });
    toast('Set as page background');
  }

  /* ---------- Looks (adjust + filter) ---------- */
  function lookSteps(layer) {
    var a = (layer && layer.adjust) || {};
    var steps = [];
    var pack = {};
    ['brightness', 'contrast', 'saturation', 'tint', 'exposure', 'highlights', 'shadows', 'vibrance', 'vignette', 'grain', 'hue'].forEach(function (k) { if (a[k]) pack[k] = a[k]; });
    if (a.warmth || a.temperature) pack.temperature = a.temperature || a.warmth;
    if (Object.keys(pack).length) steps.push({ operation: 'adjust', parameters: pack });
    if (layer && layer.filter && layer.filter.name) steps.push({ operation: 'filter', parameters: { name: layer.filter.name, intensity: layer.filter.intensity == null ? 100 : layer.filter.intensity } });
    if (a.sharpness) steps.push({ operation: 'sharpen', parameters: { amount: a.sharpness } });
    if (a.blur) steps.push({ operation: 'blur', parameters: { radius: a.blur, type: 'gaussian' } });
    return steps;
  }
  function recipeLook(steps) {
    var adjust = {}, filter = null, skipped = [];
    var map = { exposure: 'exposure', brightness: 'brightness', contrast: 'contrast', saturation: 'saturation', vibrance: 'vibrance', temperature: 'warmth', tint: 'tint', hue: 'hue', highlights: 'highlights', shadows: 'shadows' };
    (steps || []).forEach(function (s) {
      var p = s.parameters || {};
      if (map[s.operation]) adjust[map[s.operation]] = (adjust[map[s.operation]] || 0) + Number(p.value || 0);
      else if (s.operation === 'vignette') adjust.vignette = Number(p.amount != null ? p.amount : p.value || 0);
      else if (s.operation === 'grain') adjust.grain = Number(p.amount != null ? p.amount : p.value || 0);
      else if (s.operation === 'sharpness' || s.operation === 'sharpen') adjust.sharpness = Number(p.amount != null ? p.amount : p.value || 0);
      else if (s.operation === 'blur' && (!p.type || p.type === 'gaussian')) adjust.blur = Number(p.radius || 0);
      else if (s.operation === 'filter') filter = { name: p.name, intensity: p.intensity == null ? 100 : p.intensity };
      else if (s.operation === 'adjust' || s.operation === 'levels') {
        Object.keys(p).forEach(function (k) {
          var dest = k === 'temperature' ? 'warmth' : k;
          if (typeof p[k] === 'number' && /^(brightness|contrast|saturation|warmth|tint|exposure|highlights|shadows|vibrance|vignette|grain|hue|sharpness)$/.test(dest)) adjust[dest] = (adjust[dest] || 0) + p[k];
        });
      } else skipped.push(s.label || s.operation);
    });
    Object.keys(adjust).forEach(function (k) { adjust[k] = r3(adjust[k]); });
    return { adjust: adjust, filter: filter, skipped: skipped };
  }
  function compareHold(on) {
    if (on) {
      if (S.preview || !S.project) return;
      var pre = doc();
      var d = clone(pre);
      var any = false;
      d.layers.forEach(function (l) {
        if (l.type !== 'image') return;
        if ((l.adjust && Object.keys(l.adjust).some(function (k) { return l.adjust[k]; })) || l.filter || l.removeBg) any = true;
        l.adjust = {}; l.filter = null; l.removeBg = null;
      });
      if (!any) { toast('No photo edits to compare yet.'); return; }
      S.preview = { type: 'compare', pre: pre, sel: sel() };
      S.silent = true;
      replaceDoc(d, false);
      root.classList.add('is-comparing');
      E.bar.hidden = false;
      E.bar.className = 'sx-bar is-compare';
      E.bar.innerHTML = '<div class="sx-bar-info"><strong>Original</strong><small>Release to see your edits</small></div>';
    } else if (S.preview && S.preview.type === 'compare') {
      var p = S.preview;
      S.preview = null;
      replaceDoc(p.pre, false);
      S.silent = false;
      if (p.sel) scene.select(p.sel);
      root.classList.remove('is-comparing');
      hideBar();
    }
  }

  /* ---------- Draw ---------- */
  function setDraw(mode) {
    if (!S.project) newDesign(1080, 1080, 'Untitled design');
    S.draw.mode = mode;
    lsSet('le-studio-draw', S.draw);
    S.known = {};
    scene.layers().forEach(function (l) { if (l.type === 'path') S.known[l.id] = 1; });
    scene.setTool(mode);
  }
  function stopDraw() { if (/^(pen|marker|highlighter|eraser)$/.test(scene.tool())) scene.setTool('select'); }
  function styleNewPaths() {
    var t = scene.tool();
    if (!/^(pen|marker|highlighter)$/.test(t)) return;
    scene.layers().forEach(function (l) {
      if (l.type !== 'path' || S.known[l.id]) return;
      S.known[l.id] = 1;
      scene.update(l.id, { color: S.draw.color, width: t === 'highlighter' ? S.draw.width * 3 : t === 'marker' ? S.draw.width * 2 : S.draw.width, smoothing: S.draw.smoothing }, { coalesce: 'pointer' });
    });
  }

  /* ---------- Export ---------- */
  function maxEdge() { return MAX_EDGE[LE.device.tier()] || 8192; }
  var MAX_AREA = { older: 17000000, modern: 48000000, desktop: 120000000 };
  function maxScale() { var d = doc(); return Math.min(4, maxEdge() / Math.max(d.width, d.height), Math.sqrt((MAX_AREA[LE.device.tier()] || 48000000) / (d.width * d.height))); }
  function exportCanvas(o, pageIndex) {
    var p = S.project;
    var scale = Math.min(o.scale || 1, maxScale());
    var transparent = !!o.transparent && o.format !== 'jpeg';
    if (pageIndex == null || pageIndex === p.activePage) return scene.render(scale, { includeBackground: !transparent });
    syncProject();
    return hiddenRender(p.pages[pageIndex], scale, { includeBackground: !transparent });
  }
  function encode(canvas, o) {
    return LE.exportImage(canvas, { format: o.format, quality: o.quality });
  }
  function exportImage(o) {
    o = Object.assign({}, S.exportOpts, o || {});
    if (o.clipboard) o.format = 'png';
    if (!S.project) { toast('Open a photo or start a design first.'); return Promise.resolve(null); }
    var p = S.project;
    var ext = o.format === 'jpeg' ? 'jpg' : o.format;
    var base = safeName(o.name || p.name);
    syncProject();
    if (o.format === 'pdf') return exportPdf(o, base);
    if (o.pages === 'all' && p.pages.length > 1) {
      var files = [];
      var chain = Promise.resolve();
      p.pages.forEach(function (pg, i) {
        chain = chain.then(function () { return exportCanvas(o, i); }).then(function (c) { return encode(c, o); }).then(function (b) { return b.arrayBuffer(); }).then(function (buf) { files.push({ name: base + '-page-' + (i + 1) + '.' + ext, data: new Uint8Array(buf) }); });
      });
      return chain.then(function () {
        var z = LE.zip(files);
        download(z, base + '.zip');
        LE.project.log('exported', p.id, { format: o.format, pages: files.length });
        return z;
      });
    }
    return exportCanvas(o).then(function (c) { return encode(c, o).then(function (blob) { return { blob: blob, canvas: c }; }); }).then(function (r) {
      if (o.clipboard) {
        var png = o.format === 'png' ? Promise.resolve(r.blob) : LE.toBlob(r.canvas, 'image/png');
        return png.then(function (pb) { return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': pb })]); }).then(function () { toast('Copied to clipboard'); return r.blob; });
      }
      if (!o.dryRun) {
        download(r.blob, base + '.' + ext);
        if (r.canvas.width < Math.round(doc().width * (o.scale || 1)) - 1) toast('Downloaded at ' + r.canvas.width + ' × ' + r.canvas.height + ' px, the largest this device can export.');
        LE.project.log('exported', p.id, { format: o.format, bytes: r.blob.size, width: r.canvas.width, height: r.canvas.height });
      }
      S.lastExport = { blob: r.blob, width: r.canvas.width, height: r.canvas.height };
      return r.blob;
    }).catch(function (err) { toast(err.message || 'Export failed.'); return null; });
  }
  function exportPdf(o, base) {
    var p = S.project;
    var idx = o.pages === 'all' ? p.pages.map(function (x, i) { return i; }) : [p.activePage];
    var root = document.documentElement.getAttribute('data-root') || '';
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    var ready = LE.pdf && LE.pdf.fromImages ? Promise.resolve() : LE.lazy(root + 'assets/js/le-pdf.js');
    var canvases = [];
    var chain = Promise.resolve();
    idx.forEach(function (i) {
      chain = chain.then(function () { return exportCanvas({ scale: o.scale, transparent: false, format: 'jpeg' }, i); }).then(function (c) { canvases.push(c); });
    });
    return Promise.all([ready, chain]).then(function () {
      if (!LE.pdf || !LE.pdf.fromImages) throw new Error('PDF export is not available offline yet.');
      return LE.pdf.fromImages(canvases, { pageSize: 'fit', margin: 0, metadata: { title: p.name } });
    }).then(function (bytes) {
      var blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' });
      if (!o.dryRun) {
        download(blob, base + '.pdf');
        LE.project.log('exported', p.id, { format: 'pdf', pages: canvases.length, bytes: blob.size });
      }
      return blob;
    }).catch(function (err) { toast(err.message || 'PDF export failed.'); return null; });
  }
  function estimate(o) {
    o = Object.assign({}, S.exportOpts, o || {});
    if (o.format === 'pdf') o = Object.assign({}, o, { format: 'jpeg' });
    var d = doc();
    var scale = Math.min(o.scale || 1, maxScale());
    var W = Math.round(d.width * scale), H = Math.round(d.height * scale);
    var a = artboard(720);
    if (!a) return Promise.resolve({ width: W, height: H, bytes: null });
    if (o.transparent && o.format !== 'jpeg') {
      var bgc = d.background;
      if (!bgc || bgc.type === 'color') { void 0; }
    }
    return LE.exportImage(a, { format: o.format, quality: o.quality }).then(function (b) {
      var ratio = (W * H) / (a.width * a.height);
      var k = o.format === 'png' ? Math.pow(ratio, 0.93) : Math.pow(ratio, 0.86);
      return { width: W, height: H, bytes: Math.round(b.size * k) };
    }).catch(function () { return { width: W, height: H, bytes: null }; });
  }

  /* ---------- Commands ---------- */
  function cmd(name, el, e) {
    var arg = '';
    var i = name.indexOf(':');
    if (i > 0) { arg = name.slice(i + 1); name = name.slice(0, i); }
    var ids = sel();
    var l = ids.length === 1 ? L(ids[0]) : null;
    switch (name) {
      case 'undo': scene.undo(); break;
      case 'redo': scene.redo(); break;
      case 'export': openPanel('export'); break;
      case 'closePanel': closePanel(); break;
      case 'panelBack': if (S.panelOpts.back) openPanel(S.panelOpts.back, S.panelOpts.backOpts); break;
      case 'fileMenu': fileMenu(el); break;
      case 'history': openPanel('history'); break;
      case 'settings': openPanel('settings'); break;
      case 'shortcuts': shortcuts(); break;
      case 'fit': fit(); break;
      case 'zoomIn': S.fitting = true; scene.zoomTo(scene.zoom() * 1.25); S.fitting = false; S.autoFit = false; break;
      case 'zoomOut': S.fitting = true; scene.zoomTo(scene.zoom() / 1.25); S.fitting = false; S.autoFit = false; break;
      case 'zoomMenu': zoomMenu(el); break;
      case 'zoomTo': if (arg === 'fit') fit(); else { S.fitting = true; scene.zoomTo(Number(arg)); S.fitting = false; S.autoFit = false; } closePop(); break;
      case 'layers': openPanel('layers', { tab: 'layers' }); break;
      case 'pages': pagesMenu(el); break;
      case 'resize': openPanel('design', { tab: 'sizes' }); break;
      case 'addPhoto': pickFiles('add'); break;
      case 'addText': openPanel('text'); break;
      case 'elements': openPanel('elements'); break;
      case 'pageBg':
        colorPop(el, { value: doc().background.type === 'gradient' ? { type: doc().background.kind === 'radial' ? 'radial' : 'linear', colors: doc().background.colors, angle: doc().background.angle } : doc().background.color, gradient: true, title: 'Background', onChange: function (v, k) {
          void k;
          if (typeof v === 'string') setBackground({ type: 'color', color: v });
          else if (v && v.colors) setBackground({ type: 'gradient', kind: v.type === 'radial' ? 'radial' : 'linear', colors: v.colors, angle: v.angle || 0 });
        } });
        break;
      case 'dup': if (ids.length) scene.duplicate(ids); break;
      case 'del': if (ids.length) scene.remove(ids.filter(function (id) { var x = L(id); return x && !x.locked; })); closePop(); break;
      case 'lock': ids.forEach(function (id) { scene.lock(id, true); }); renderToolbar(); placeMini(); break;
      case 'unlock': ids.forEach(function (id) { scene.lock(id, false); }); renderToolbar(); placeMini(); break;
      case 'flipMenu':
        openPop(el, '<div class="sx-menu"><button type="button" data-cmd="flipH">' + ic('flip') + 'Flip horizontal</button><button type="button" data-cmd="flipV">' + ic('flipV') + 'Flip vertical</button><button type="button" data-cmd="rot90">' + ic('rotate') + 'Rotate 90°</button></div>', { cls: 'sx-pop-menu' });
        break;
      case 'flipH': ids.forEach(function (id) { var x = L(id); patch(id, { flipX: !x.flipX }); }); closePop(); break;
      case 'flipV': ids.forEach(function (id) { var x = L(id); patch(id, { flipY: !x.flipY }); }); closePop(); break;
      case 'rot90': ids.forEach(function (id) { var x = L(id); patch(id, { rotation: ((x.rotation || 0) + 90) % 360 }); }); closePop(); break;
      case 'crop': if (l && l.type === 'image') startCrop(l.id); break;
      case 'cropDone': scene.setTool('select'); break;
      case 'cropCancel': keyEvent('Escape'); break;
      case 'cropReset': cropRatio(null, true); break;
      case 'ratio': cropRatio(arg === 'free' ? null : Number(arg)); break;
      case 'replace': openReplace(); break;
      case 'adjust': openPanel('adjust'); break;
      case 'filters': openPanel('filters'); break;
      case 'effects': openPanel('effects'); break;
      case 'edit': openPanel('edit'); break;
      case 'position': openPanel('layers', { tab: 'arrange' }); break;
      case 'font': openPanel('fonts'); break;
      case 'opacity': opacityPop(el); break;
      case 'more': moreMenu(el); break;
      case 'group': if (ids.length > 1) scene.group(ids); break;
      case 'ungroup': if (l) scene.ungroup(l.id); break;
      case 'alignMenu': alignMenu(el); break;
      case 'align2': scene.align(ids, arg, ids.length > 1 ? 'selection' : 'page'); closePop(); break;
      case 'alignPage': scene.align(ids, arg, 'page'); break;
      case 'dist': scene.distribute(ids, arg); closePop(); break;
      case 'order': ids.forEach(function (id) { scene.order(id, arg); }); closePop(); break;
      case 'setBg': setAsBackground(); closePop(); break;
      case 'resetLayer': resetLayer(l); closePop(); break;
      case 'removeBg': openPanel('background', { section: 'remove' }); closePop(); break;
      case 'size': if (l && l.type === 'text') patch(ids, { size: Math.max(4, Math.round(l.size * (arg === '+' ? 1.1 : 1 / 1.1))) }, 'size' + S.gesture); renderToolbarSoon(); break;
      case 'textColor': colorPop(el, { value: l.fill || l.color, gradient: true, title: 'Text color', onChange: function (v, k) { if (typeof v === 'string') patch(ids, { color: v, fill: null }, k); else if (v && v.colors) patch(ids, { fill: { type: v.type, colors: v.colors, angle: v.angle || 0 }, color: v.colors[0] }, k); renderToolbarSoon(); } }); break;
      case 'bold': patch(ids, { weight: (l.weight || 400) >= 600 ? 400 : 700 }); renderToolbar(); break;
      case 'italic': patch(ids, { italic: !l.italic }); renderToolbar(); break;
      case 'underline': patch(ids, { underline: !l.underline }); renderToolbar(); break;
      case 'strike': patch(ids, { strike: !l.strike }); renderToolbar(); break;
      case 'upper': patch(ids, { uppercase: !l.uppercase }); renderToolbar(); break;
      case 'align': patch(ids, { align: l.align === 'left' ? 'center' : l.align === 'center' ? 'right' : 'left' }); renderToolbar(); break;
      case 'list': toggleList(l); break;
      case 'spacing': spacingPop(el, l); break;
      case 'fill': colorPop(el, { value: l.fill, gradient: true, none: true, title: 'Fill', onChange: function (v, k) { patch(ids, { fill: typeof v === 'string' ? { type: 'solid', color: v } : v }, k); renderToolbarSoon(); } }); break;
      case 'stroke': strokePop(el, l); break;
      case 'svgColor': colorPop(el, { value: l.color, title: 'Icon color', onChange: function (v, k) { patch(ids, { color: v }, k); renderToolbarSoon(); } }); break;
      case 'pathColor': colorPop(el, { value: l.color, title: 'Ink color', onChange: function (v, k) { patch(ids, { color: v }, k); renderToolbarSoon(); } }); break;
      case 'drawMode': setDraw(arg); renderToolbar(); if (S.panel === 'draw') renderPanel(true); break;
      case 'drawColor': colorPop(el, { value: S.draw.color, title: 'Pen color', onChange: function (v) { S.draw.color = v; lsSet('le-studio-draw', S.draw); renderToolbarSoon(); if (S.panel === 'draw') renderPanel(true); } }); break;
      case 'drawDone': scene.setTool('select'); if (S.panel === 'draw') closePanel(); break;
      case 'compareHold': break;
      case 'sizeUse': commitSize(); break;
      case 'sizeCancel': cancelPreview(); break;
      case 'versionRestore': restoreVersion(); break;
      case 'versionCancel': cancelPreview(); break;
      case 'newDesign': closePop(); flushSave(); S.project = null; scene.load(LE.Scene.blank(1080, 1080)); renderHead(); showStart(); break;
      case 'openPhoto': closePop(); pickFiles('add'); break;
      case 'importProject': closePop(); pickFiles('project'); break;
      case 'exportProject': closePop(); exportProject(); break;
      case 'openDesignFile': case 'saveDesignFile': case 'shareTemplate': closePop(); if (LE.design) LE.design.studioCmd(ctx, name); break;
      case 'checkpoint': closePop(); checkpoint(); break;
      case 'projects': closePop(); openPanel('projects'); break;
      case 'addPage': closePop(); addPage(false); break;
      case 'dupPage': closePop(); addPage(true); break;
      case 'delPage': closePop(); deletePage(S.project.activePage); break;
      case 'page': closePop(); switchPage(Number(arg)); break;
      case 'replaceAll': closePop(); openPanel('replace'); break;
      case 'pagesPanel': closePop(); openPanel('pages'); break;
      case 'brandKit': closePop(); openPanel('brand'); break;
      default:
        if (PANELS._cmds && PANELS._cmds[name]) PANELS._cmds[name](ctx, arg, el, e);
        else if (PANELS._cmd) PANELS._cmd(ctx, name, arg, el, e);
    }
  }
  function resetLayer(l) {
    if (!l) return;
    var p = { opacity: 1, blend: 'source-over', shadow: null, rotation: 0, flipX: false, flipY: false };
    if (l.type === 'image') Object.assign(p, { adjust: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0, vibrance: 0, sharpness: 0, blur: 0, vignette: 0, grain: 0, hue: 0 }, filter: null, removeBg: null, radius: 0, border: null, mask: 'none' });
    patch(l.id, p);
    toast('Layer reset — original kept');
  }
  function cropRatio(r, reset) {
    var l = one();
    if (!l || l.type !== 'image') return;
    var wasCrop = scene.tool() === 'crop';
    if (wasCrop) scene.setTool('select');
    l = L(l.id);
    var m = S.mem[l.src];
    if (!m) return;
    var iw = m.canvas.width, ih = m.canvas.height;
    var c = l.crop || { x: 0, y: 0, w: 1, h: 1 };
    var cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    var next, w = l.w, hh = l.h;
    if (reset) {
      next = { x: 0, y: 0, w: 1, h: 1 };
      var k = Math.sqrt((l.w * l.h) / (iw * c.w * ih * c.h)) || 1;
      w = iw * k; hh = ih * k;
    } else if (r) {
      var pw = c.w * iw, ph = c.h * ih;
      var nw = pw, nh = ph;
      if (pw / ph > r) nw = ph * r; else nh = pw / r;
      next = { x: clamp(c.x + (c.w - nw / iw) / 2, 0, 1 - nw / iw), y: clamp(c.y + (c.h - nh / ih) / 2, 0, 1 - nh / ih), w: nw / iw, h: nh / ih };
      hh = w / r;
    } else { if (wasCrop) startCrop(l.id); return; }
    patch(l.id, { crop: { x: r6(next.x), y: r6(next.y), w: r6(next.w), h: r6(next.h) }, w: w, h: hh, x: cx - w / 2, y: cy - hh / 2 });
    if (l.id === S.baseId) { studio().baseRegion = clone(L(l.id).crop); studio().anchor = null; }
    if (wasCrop) startCrop(l.id);
  }
  function toggleList(l) {
    if (!l) return;
    var lines = String(l.text || '').split('\n');
    var on = lines.every(function (x) { return /^• /.test(x) || !x; });
    var next = lines.map(function (x) { return on ? x.replace(/^• /, '') : (x && !/^• /.test(x) ? '• ' + x : x); }).join('\n');
    patch(l.id, { text: next, align: on ? l.align : 'left' });
  }
  function opacityPop(el) {
    var ids = sel();
    if (!ids.length) return;
    var l = L(ids[0]);
    var body = h('<div class="sx-pop-pad"></div>');
    body.appendChild(ui.slider({ label: 'Transparency', min: 0, max: 100, value: Math.round((l.opacity == null ? 1 : l.opacity) * 100), reset: 100, fmt: function (v) { return v + '%'; }, onInput: function (v, k) { patch(ids, { opacity: v / 100 }, k); } }));
    openPop(el, body, { title: 'Transparency' });
  }
  function spacingPop(el, l) {
    var ids = sel();
    var body = h('<div class="sx-pop-pad"></div>');
    body.appendChild(ui.slider({ label: 'Letter spacing', min: -10, max: 60, value: Math.round((l.letterSpacing || 0) / (l.size || 48) * 100), fmt: function (v) { return v; }, onInput: function (v, k) { patch(ids, { letterSpacing: v / 100 * l.size }, k); } }));
    body.appendChild(ui.slider({ label: 'Line height', min: 70, max: 250, value: Math.round((l.lineHeight || 1.2) * 100), reset: 120, fmt: function (v) { return (v / 100).toFixed(2); }, onInput: function (v, k) { patch(ids, { lineHeight: v / 100 }, k); } }));
    openPop(el, body, { title: 'Spacing' });
  }
  function strokePop(el, l) {
    var ids = sel();
    var body = h('<div class="sx-pop-pad"></div>');
    var st = l.stroke || { width: 0, color: '#17131F' };
    var sw = ui.swatchBtn(st.color, 'Border color', function (b) {
      colorPop(b, { value: st.color, title: 'Border color', onChange: function (v, k) { st = Object.assign({}, st, { color: v }); if (!st.width) st.width = 4; patch(ids, { stroke: st }, k); } });
    });
    body.appendChild(ui.seg([['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted']], !st.dash ? 'solid' : st.dash[0] > st.width * 1.5 ? 'dash' : 'dot', function (v) {
      var w = st.width || 4;
      st = Object.assign({}, st, { width: w, dash: v === 'solid' ? null : v === 'dash' ? [w * 3, w * 2] : [0.01, w * 2], cap: v === 'dot' ? 'round' : st.cap || 'round' });
      patch(ids, { stroke: st }, gesture());
    }));
    body.appendChild(ui.slider({ label: 'Border weight', min: 0, max: 80, value: Math.round(st.width || 0), onInput: function (v, k) { st = Object.assign({}, st, { width: v }); if (st.dash) st.dash = st.dash[0] < 1 ? [0.01, v * 2] : [v * 3, v * 2]; patch(ids, { stroke: v ? st : null }, k); } }));
    body.appendChild(sw);
    openPop(el, body, { title: 'Border' });
  }
  function alignMenu(el) {
    var many = sel().length > 1;
    openPop(el, '<div class="sx-align-grid">' +
      [['left', 'alL', 'Left'], ['center', 'alC', 'Center'], ['right', 'alR', 'Right'], ['top', 'alT', 'Top'], ['middle', 'alM', 'Middle'], ['bottom', 'alB', 'Bottom']].map(function (a) {
        return '<button type="button" data-cmd="align2:' + a[0] + '">' + ic(a[1]) + '<span>' + a[2] + '</span></button>';
      }).join('') + (sel().length > 2 ? '<button type="button" data-cmd="dist:h">' + ic('distH') + '<span>Space evenly ↔</span></button><button type="button" data-cmd="dist:v">' + ic('distV') + '<span>Space evenly ↕</span></button>' : '') + '</div><p class="sx-note">' + (many ? 'Aligns to the selection.' : 'Aligns to the page.') + '</p>', { title: 'Align', cls: 'sx-pop-menu' });
  }
  function moreMenu(el) {
    var ids = sel();
    var l = ids.length === 1 ? L(ids[0]) : null;
    var html = '<div class="sx-menu">' +
      '<button type="button" data-cmd="order:front">' + ic('front') + 'Bring to front<kbd>]</kbd></button>' +
      '<button type="button" data-cmd="order:forward">' + ic('front') + 'Bring forward</button>' +
      '<button type="button" data-cmd="order:backward">' + ic('back2') + 'Send backward<kbd>[</kbd></button>' +
      '<button type="button" data-cmd="order:back">' + ic('back2') + 'Send to back</button><hr>';
    if (l && l.type === 'image') {
      html += '<button type="button" data-cmd="crop">' + ic('crop') + 'Crop<kbd>dbl-click</kbd></button><button type="button" data-cmd="replace">' + ic('replace') + ((l.slot || !l.src) ? 'Replace photo' : 'Replace image') + '</button><button type="button" data-cmd="setBg">' + ic('background') + 'Set as background</button><button type="button" data-cmd="removeBg">' + ic('wand') + 'Remove flat background</button><button type="button" data-cmd="resetLayer">' + ic('reset') + 'Reset edits</button><hr>';
    }
    if (l && l.type === 'text') html += '<button type="button" data-cmd="editText">' + ic('text') + 'Edit text<kbd>Enter</kbd></button><hr>';
    if (ids.length > 1) html += '<button type="button" data-cmd="group">' + ic('group') + 'Group<kbd>Ctrl G</kbd></button>';
    if (l && l.type === 'group') html += '<button type="button" data-cmd="ungroup">' + ic('ungroup') + 'Ungroup</button>';
    html += '<button type="button" data-cmd="alignMenu">' + ic('alC') + 'Align…</button><button type="button" data-cmd="flipMenu">' + ic('flip') + 'Flip…</button><button type="button" data-cmd="dup">' + ic('copy') + 'Duplicate<kbd>Ctrl D</kbd></button><button type="button" data-cmd="del" class="is-danger">' + ic('trash') + 'Delete<kbd>Del</kbd></button></div>';
    openPop(el, html, { cls: 'sx-pop-menu' });
  }
  function fileMenu(el) {
    openPop(el, '<div class="sx-menu">' +
      '<button type="button" data-cmd="newDesign">' + ic('plus') + 'New design</button>' +
      '<button type="button" data-cmd="openPhoto">' + ic('image') + 'Add photos…<kbd>Ctrl O</kbd></button>' +
      '<button type="button" data-cmd="projects">' + ic('projects') + 'Your designs</button><hr>' +
      '<button type="button" data-cmd="checkpoint"' + (S.project ? '' : ' disabled') + '>' + ic('save') + 'Save a version<kbd>Ctrl S</kbd></button>' +
      '<button type="button" data-cmd="history">' + ic('history') + 'Version history</button>' +
      '<button type="button" data-cmd="replaceAll"' + (S.project ? '' : ' disabled') + '>' + ic('swap') + 'Replace colours & fonts…</button>' +
      '<button type="button" data-cmd="pagesPanel"' + (S.project ? '' : ' disabled') + '>' + ic('pages') + 'Pages…</button>' +
      '<button type="button" data-cmd="brandKit">' + ic('brand') + 'Brand kit</button><hr>' +
      '<button type="button" data-cmd="importProject">' + ic('file') + 'Import .leproject…</button>' +
      '<button type="button" data-cmd="exportProject"' + (S.project ? '' : ' disabled') + '>' + ic('share') + 'Export .leproject</button>' +
      (LE.design ? '<button type="button" data-cmd="openDesignFile">' + ic('file') + 'Open design file (.ledesign.json)…</button>' +
        '<button type="button" data-cmd="saveDesignFile"' + (S.project ? '' : ' disabled') + '>' + ic('save') + 'Save as design file (.ledesign.json)</button>' +
        '<button type="button" data-cmd="shareTemplate"' + (S.project ? '' : ' disabled') + '>' + ic('share') + 'Share as template link</button>' : '') +
      '<button type="button" data-cmd="export"' + (S.project ? '' : ' disabled') + '>' + ic('download') + 'Download image…<kbd>Ctrl E</kbd></button><hr>' +
      '<button type="button" data-cmd="settings">' + ic('gauge') + 'Performance</button>' +
      '<button type="button" data-theme-toggle>' + ic('moon') + (document.documentElement.getAttribute('data-theme') === 'dark' ? 'Light mode' : 'Dark mode') + '</button>' +
      '<button type="button" data-cmd="shortcuts">' + ic('keyboard') + 'Shortcuts<kbd>?</kbd></button>' +
      '<a href="../recipes/">' + ic('recipes') + 'Recipe library</a><a href="../">' + ic('apps') + 'All tools</a></div>', { cls: 'sx-pop-menu' });
  }
  function zoomMenu(el) {
    openPop(el, '<div class="sx-menu">' + [['fit', 'Fit to screen'], ['0.5', '50%'], ['1', '100%'], ['2', '200%'], ['4', '400%']].map(function (z) { return '<button type="button" data-cmd="zoomTo:' + z[0] + '">' + z[1] + '</button>'; }).join('') + '</div>', { cls: 'sx-pop-menu' });
  }
  function pagesMenu(el) {
    if (!S.project) return;
    var p = S.project;
    S.pageThumbs[p.activePage] = artboard(160);
    var html = '<div class="sx-pages">';
    p.pages.forEach(function (pg, i) {
      var t = S.pageThumbs[i];
      html += '<button type="button" class="sx-page' + (i === p.activePage ? ' is-on' : '') + '" data-cmd="page:' + i + '" aria-label="Page ' + (i + 1) + '"><span class="sx-page-art" style="aspect-ratio:' + pg.width + '/' + pg.height + '">' + (t ? '<img alt="" src="' + t.toDataURL('image/jpeg', 0.7) + '">' : '<b>' + (i + 1) + '</b>') + '</span><small>Page ' + (i + 1) + '</small></button>';
    });
    html += '</div><div class="sx-menu sx-menu-row"><button type="button" data-cmd="addPage">' + ic('plus') + 'Add page</button><button type="button" data-cmd="dupPage">' + ic('copy') + 'Duplicate</button><button type="button" data-cmd="delPage" class="is-danger"' + (p.pages.length < 2 ? ' disabled' : '') + '>' + ic('trash') + 'Delete</button><button type="button" data-cmd="pagesPanel">' + ic('pages') + 'All pages…</button></div>';
    openPop(el, html, { title: 'Pages', cls: 'sx-pop-pages' });
  }
  function shortcuts() {
    var rows = [
      ['Undo / Redo', 'Ctrl Z · Ctrl Shift Z'], ['Duplicate', 'Ctrl D'], ['Delete', 'Del'], ['Group / Ungroup', 'Ctrl G · Ctrl Shift G'],
      ['Copy / Paste layers', 'Ctrl C · Ctrl V'], ['Nudge', 'Arrows (Shift ×10)'], ['Layer order', '[ · ]'], ['Edit text / crop photo', 'Double-click'],
      ['Finish text or crop', 'Esc · Enter'], ['Pan', 'Space + drag · scroll'], ['Zoom', 'Ctrl + scroll · pinch'], ['Fit to screen', 'Ctrl 0'],
      ['Add text', 'T'], ['Rectangle / Circle / Line', 'R · C · L'], ['Draw', 'P'], ['Compare with original', 'Hold \\'],
      ['Save a version', 'Ctrl S'], ['Download', 'Ctrl E'], ['Add photos', 'Ctrl O'], ['Copy / paste style', 'Ctrl Alt C · Ctrl Alt V'],
      ['Rulers & guides', 'Shift R'], ['Grid', "Shift '"], ['Lock aspect while resizing', 'Shift + drag corner'], ['Next / previous page', 'Alt ↓ · Alt ↑'], ['This sheet', '?']
    ];
    openModal('Keyboard <em>shortcuts</em>', '<div class="sx-keys">' + rows.map(function (r) { return '<div><span>' + esc(r[0]) + '</span><kbd>' + esc(r[1]) + '</kbd></div>'; }).join('') + '</div>');
  }

  /* ---------- Events ---------- */
  function onSelect() {
    var ids = sel();
    var key = ids.join(',');
    renderToolbar();
    placeMini();
    if (key !== S.selKey) {
      S.selKey = key;
      fire('select', ids);
      var spec = PANELS[S.panel];
      if (spec && spec.select && !S.preview) renderPanel(true);
    }
  }
  function onChange() {
    if (S.silent || S.preview) return;
    styleNewPaths();
    markDirty();
    renderToolbarSoon();
    if (!S.pointer) placeMini();
    refreshPanelSoon();
    var dims = byId('sx-dims');
    if (dims) { var d = doc(); dims.textContent = d.width + ' × ' + d.height + ' px'; }
    fire('change');
  }
  function onHistory(e) {
    S.canUndo = !!e.canUndo;
    S.canRedo = !!e.canRedo;
    fire('history', e);
    var u = E.head.querySelector('[data-cmd="undo"]'), r = E.head.querySelector('[data-cmd="redo"]');
    if (u) u.disabled = !S.canUndo;
    if (r) r.disabled = !S.canRedo;
  }
  function onZoom(e) {
    S.view = { zoom: e.zoom, panX: e.panX, panY: e.panY };
    if (!S.fitting) S.autoFit = false;
    paintZoom();
    placeMini();
    fire('zoom', e);
  }
  function onTool(e) {
    var prev = S.tool;
    S.tool = e.tool;
    root.setAttribute('data-tool', e.tool);
    if (e.tool === 'crop') {
      var l = one();
      S.cropStart = l ? { id: l.id, crop: JSON.stringify(l.crop) } : null;
    } else if (prev === 'crop' && S.cropStart) {
      var after = L(S.cropStart.id);
      if (after && S.cropStart.id === S.baseId && JSON.stringify(after.crop) !== S.cropStart.crop) {
        studio().baseRegion = clone(after.crop);
        studio().anchor = null;
      }
      S.cropStart = null;
    }
    renderToolbar();
    placeMini();
  }
  scene.on('select', onSelect);
  scene.on('change', onChange);
  scene.on('history', onHistory);
  scene.on('zoom', onZoom);
  scene.on('tool', onTool);
  scene.on('edit-text', function (e) { S.editing = !!e.editing; placeMini(); renderToolbar(); });

  E.sceneEl.addEventListener('pointerdown', function () { S.pointer = true; E.mini.hidden = true; closePop(); }, true);
  window.addEventListener('pointerup', function () {
    if (!S.pointer) return;
    S.pointer = false;
    setTimeout(function () { placeMini(); renderToolbar(); refreshPanelSoon(); }, 0);
  });
  window.addEventListener('pointercancel', function () { S.pointer = false; });

  root.addEventListener('click', function (e) {
    var p = e.target.closest('[data-panel-btn]');
    if (p) {
      var id = p.getAttribute('data-panel-btn');
      if (S.panel === id) closePanel(); else openPanel(id);
      return;
    }
    var c = e.target.closest('[data-cmd]');
    if (c && !c.disabled) cmd(c.getAttribute('data-cmd'), c, e);
  });
  E.pop.addEventListener('click', function (e) {
    var c = e.target.closest('[data-cmd]');
    if (c && !c.disabled) cmd(c.getAttribute('data-cmd'), c, e);
    else if (e.target.closest('[data-theme-toggle]')) setTimeout(closePop, 0);
  });
  document.addEventListener('pointerdown', function (e) {
    if (E.pop.hidden) return;
    if (E.pop.contains(e.target) || (popAnchor && popAnchor.contains(e.target))) return;
    closePop();
  });
  function holdBind() {
    function down(e) { var b = e.target.closest('[data-cmd="compareHold"]'); if (!b) return; e.preventDefault(); compareHold(true); }
    function up() { compareHold(false); }
    root.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  }
  holdBind();

  /* drag & drop */
  var dragDepth = 0;
  function docPoint(cx, cy) {
    var r = E.sceneEl.getBoundingClientRect();
    return { x: (cx - r.left - S.view.panX) / S.view.zoom, y: (cy - r.top - S.view.panY) / S.view.zoom };
  }
  E.stage.addEventListener('dragenter', function (e) {
    var types = [].slice.call(e.dataTransfer.types || []);
    if (types.indexOf('Files') < 0 && types.indexOf('text/x-le-el') < 0 && types.indexOf('text/x-le-asset') < 0) return;
    e.preventDefault();
    dragDepth++;
    if (types.indexOf('Files') >= 0) E.drop.hidden = false;
  });
  E.stage.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  E.stage.addEventListener('dragleave', function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) E.drop.hidden = true; });
  E.stage.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    E.drop.hidden = true;
    var at = S.project ? docPoint(e.clientX, e.clientY) : null;
    var el = e.dataTransfer.getData('text/x-le-el');
    var asset = e.dataTransfer.getData('text/x-le-asset');
    var dropFiles = [].slice.call(e.dataTransfer.files || []);
    if (at && fire('drop', { at: at, el: el, asset: asset, files: dropFiles })) return;
    if (el) {
      try {
        var item = JSON.parse(el);
        if (item.kind === 'shape') addShape(item.id, at);
        else if (item.kind === 'svg') addSvg(item.id, at);
        else if (item.kind === 'text' && PANELS._textPreset) PANELS._textPreset(ctx, item.id, at);
      } catch (err) {}
      return;
    }
    if (asset) { if (S.mem[asset]) { if (!S.project) newBlankFromMeta(S.mem[asset].meta, true); else placeImage(asset, at); } return; }
    if (dropFiles.length) addFiles(dropFiles, { at: at });
  });
  document.addEventListener('paste', function (e) {
    var t = e.target;
    if (t && (/INPUT|TEXTAREA/.test(t.tagName) || t.isContentEditable)) return;
    var files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) { e.preventDefault(); addFiles([].slice.call(files)); }
  });

  /* keyboard */
  function typing(t) { return t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable); }
  window.addEventListener('keydown', function (e) {
    var t = e.target;
    var mod = e.ctrlKey || e.metaKey;
    var k = e.key;
    if (k === 'Escape') {
      if (!E.modal.hidden) { closeModal(); return; }
      if (!E.pop.hidden) { closePop(); return; }
      if (S.preview && S.preview.type !== 'compare') { cancelPreview(); return; }
      if (S.pick) { endPick(); return; }
      if (fire('escape', e)) return;
      if (typing(t) || S.editing || S.tool === 'crop') return;
      if (/^(pen|marker|highlighter|eraser)$/.test(S.tool)) { scene.setTool('select'); return; }
      if (!sel().length && S.panel) closePanel();
      return;
    }
    if (typing(t) || S.editing) {
      if (mod && (k === 'b' || k === 'i' || k === 'u') && S.editing) {
        e.preventDefault();
        cmd(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
      }
      return;
    }
    if (!E.modal.hidden) return;
    if (fire('key', e)) return;
    if (mod && (k === 's' || k === 'S')) { e.preventDefault(); checkpoint(); return; }
    if (mod && (k === 'e' || k === 'E')) { e.preventDefault(); openPanel('export'); return; }
    if (mod && (k === 'o' || k === 'O')) { e.preventDefault(); pickFiles('add'); return; }
    if (mod && k === '0') { e.preventDefault(); fit(); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); cmd('zoomIn'); return; }
    if (mod && k === '-') { e.preventDefault(); cmd('zoomOut'); return; }
    if (mod && one() && one().type === 'text' && (k === 'b' || k === 'i' || k === 'u')) { e.preventDefault(); cmd(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline'); return; }
    if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); shortcuts(); return; }
    if (k === '\\' && !e.repeat) { compareHold(true); return; }
    var inScene = t === document.body || t === document.documentElement || E.sceneEl.contains(t);
    if (!inScene && root.contains(t)) {
      if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) scene.redo(); else scene.undo(); return; }
      if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); scene.redo(); return; }
      if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); cmd('dup'); return; }
      if ((k === 'Delete' || k === 'Backspace') && sel().length && !t.closest('.sx-panel')) { e.preventDefault(); cmd('del'); return; }
    }
    if (mod || e.altKey) return;
    if (k === 'Enter' && one() && one().type === 'text' && inScene) { e.preventDefault(); startTextEdit(one().id); return; }
    if (!S.project) return;
    var lk = k.toLowerCase();
    if (lk === 't') { e.preventDefault(); addText({ text: 'Your text', size: 64 }); setTimeout(function () { var o = one(); if (o) startTextEdit(o.id); }, 0); }
    else if (lk === 'r') addShape('rectangle');
    else if (lk === 'c') addShape('ellipse');
    else if (lk === 'l') addShape('line');
    else if (lk === 'p') openPanel('draw');
  });
  window.addEventListener('keyup', function (e) { if (e.key === '\\') compareHold(false); });

  /* eyedropper on canvas */
  function startPick(fn, hint) {
    S.pick = fn;
    E.pick.hidden = false;
    E.pick.innerHTML = '<span class="sx-pick-hint">' + ic('pipette') + esc(hint || 'Tap the photo to pick a color') + '</span>';
    root.classList.add('is-picking');
  }
  function endPick() { S.pick = null; E.pick.hidden = true; root.classList.remove('is-picking'); }
  E.pick.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var c = E.sceneEl.querySelector('canvas.le-view');
    var fn = S.pick;
    endPick();
    if (!c || !fn) return;
    var r = c.getBoundingClientRect();
    var px = Math.round((e.clientX - r.left) * c.width / r.width), py = Math.round((e.clientY - r.top) * c.height / r.height);
    var d = c.getContext('2d').getImageData(clamp(px, 0, c.width - 1), clamp(py, 0, c.height - 1), 1, 1).data;
    fn('#' + [d[0], d[1], d[2]].map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join(''));
  });

  /* theme + resize */
  new MutationObserver(function () {
    try {
      var bg = getComputedStyle(E.sceneEl).getPropertyValue('--sx-workspace') || getComputedStyle(document.documentElement).getPropertyValue('--bg');
      if (bg && bg.trim()) { scene._workspace = bg.trim(); scene._dirty = true; }
    } catch (e) {}
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.ResizeObserver) new ResizeObserver(function () { if (S.autoFit) { clearTimeout(S.roT); S.roT = setTimeout(fit, 30); } placeMini(); placePop(); }).observe(E.stage);
  window.addEventListener('resize', debounce(function () { if (S.panel && isPhone()) openSheet(S.sheet || 0); else if (!isPhone()) closeSheet(); placePop(); }, 150));

  window.addEventListener('beforeunload', function (e) {
    if (S.dirty && S.project) { saveNow(); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushSave(); });
  window.addEventListener('pagehide', flushSave);

  /* A photo the person added, as opposed to a working mask (cut-out masks are assets named "background-*",
     the convention the cut-out module documents, and are referenced from layer.cutout.asset). Every photo picker
     (collage slots, replace, uploads) should list only these. Takes an asset id or an asset meta object. */
  function isUserPhoto(a) {
    var p = S.project;
    var id = typeof a === 'string' ? a : a && a.id;
    var m = typeof a === 'string' ? (p && p.assets && p.assets[a]) || (S.mem[a] && S.mem[a].meta) : a;
    if (!m || !id) return false;
    if (/^background-/.test(m.name || '') || m.role === 'mask') return false;
    var asMask = function (l) { return !!(l && l.cutout && l.cutout.asset === id); };
    if (scene.layers().some(asMask)) return false;
    return !(p && (p.pages || []).some(function (pg) { return (pg.layers || []).some(asMask); }));
  }

  /* ---------- Context for panels ---------- */
  var ctx = {
    S: S, scene: scene, LE: LE, E: E, ic: ic, esc: esc, h: h, ui: ui, clamp: clamp, clone: clone, debounce: debounce, fmtBytes: fmtBytes,
    SIZES: SIZES, PALETTE: PALETTE, GRADIENTS: GRADIENTS, SHADOWS: SHADOWS, ADJ: ADJ,
    isPhone: isPhone, isTablet: isTablet, reduced: reduced, L: L, sel: sel, one: one, doc: doc, studio: studio, baseLayer: baseLayer, targetImage: targetImage,
    patch: patch, gesture: gesture, batch: batch, replaceDoc: replaceDoc, fit: fit, cssFill: cssFill, paintSwatch: paintSwatch,
    openPanel: openPanel, closePanel: closePanel, renderPanel: renderPanel, renderToolbar: renderToolbar, toast: toast, openPop: openPop, closePop: closePop,
    openModal: openModal, closeModal: closeModal, colorPop: colorPop, cmd: cmd, docColors: docColors, addRecent: addRecent,
    addText: addText, addLayers: addLayers, addShape: addShape, addSvg: addSvg, shapeList: shapeList, shapeSpec: shapeSpec, isOpenShape: isOpenShape,
    placeImage: placeImage, applyMask: applyMask, setBackground: setBackground, setAsBackground: setAsBackground, coverCrop: coverCrop, rememberEl: rememberEl,
    pickFiles: pickFiles, addFiles: addFiles, ingest: ingest, isUserPhoto: isUserPhoto, replaceImage: replaceImage, openReplace: openReplace, thumbUrl: thumbUrl, mem: S.mem, startCrop: startCrop, cropRatio: cropRatio, startTextEdit: startTextEdit,
    size: {
      preview: previewSize, commit: commitSize, cancel: cancelPreview, apply: applySizeNow, reset: resetSize, revert: revertSize, compare: compareSizes, compute: computeResize,
      source: resizeSource, opts: sizeOpts, setChain: function (v) { S.chain = !!v; }, chain: function () { return S.chain; }
    },
    newDesign: newDesign, newFromPhoto: newFromPhoto, useSample: useSample, openProject: openProject, startProject: startProject, importProject: importProject,
    exportProject: exportProject, checkpoint: checkpoint, previewVersion: previewVersion, saveNow: saveNow, syncProject: syncProject, markDirty: markDirty,
    showStart: showStart, hideStart: hideStart, artboard: artboard, hiddenRender: hiddenRender, lookSteps: lookSteps, recipeLook: recipeLook, compareHold: compareHold,
    setDraw: setDraw, stopDraw: stopDraw, exportImage: exportImage, estimate: estimate, maxScale: maxScale, download: download, safeName: safeName,
    startPick: startPick, endPick: endPick, addPage: addPage, switchPage: switchPage, fontCss: fontCss, lsGet: lsGet, lsSet: lsSet, resetLayer: resetLayer,
    deletePage: deletePage, loadPage: loadPage, center: center, svgAspect: svgAspect, docPoint: docPoint, renderFoot: renderFoot, placeMini: placeMini,
    fire: fire, I: I, newId: newId, colorPopBasic: colorPopBasic, renderHead: renderHead, placePop: placePop, toHex: toHex, onHistory: onHistory
  };
  window.LEStudio = ctx;

  function fontCss(f) { return LE.fonts && LE.fonts.css ? LE.fonts.css(f) : '"' + f + '", sans-serif'; }

  /* ---------- Boot ---------- */
  var TOOL_MAP = {
    crop: ['adjust', { crop: true }], adjust: 'adjust', color: 'adjust', blur: 'adjust', rotate: ['layers', { tab: 'arrange' }], filters: 'filters', effects: 'effects',
    frame: ['elements', { tab: 'frames' }], frames: ['elements', { tab: 'frames' }], shapes: 'elements', elements: 'elements', icons: ['elements', { tab: 'icons' }],
    stickers: ['elements', { tab: 'stickers' }], emoji: ['elements', { tab: 'emoji' }], text: 'text', fonts: 'fonts', meme: ['apps', { app: 'meme' }],
    watermark: ['apps', { app: 'watermark' }], collage: ['apps', { app: 'collage' }], contact: ['apps', { app: 'contact' }], palette: ['apps', { app: 'palette' }],
    metadata: ['apps', { app: 'metadata' }], compare: ['apps', { app: 'compare' }], batch: ['apps', { app: 'batch' }], upscale: ['apps', { app: 'upscale' }],
    background: 'background', draw: 'draw', layers: 'layers', position: ['layers', { tab: 'arrange' }], recipes: 'recipes', export: 'export', download: 'export',
    resize: ['design', { tab: 'sizes' }], social: ['design', { tab: 'sizes' }], design: 'design', templates: ['design', { tab: 'templates' }], history: 'history',
    uploads: 'uploads', projects: 'projects', apps: 'apps', settings: 'settings', edit: 'edit'
  };
  function applyToolParam() {
    var t = new URLSearchParams(location.search).get('tool');
    if (!t || !TOOL_MAP[t]) return;
    var m = TOOL_MAP[t];
    var id = typeof m === 'string' ? m : m[0];
    var opts = typeof m === 'string' ? {} : m[1];
    openPanel(id, opts);
    if (opts.crop && S.project) { var b = targetImage(); if (b) startCrop(b.id); }
  }

  fire('init');
  renderHead();
  renderRail();
  renderToolbar();
  renderFoot();
  E.sceneEl.style.setProperty('--sx-workspace', '');

  function boot() {
    var handoff = LE.handoff ? LE.handoff.take().catch(function () { return null; }) : Promise.resolve(null);
    return handoff.then(function (ho) {
      if (ho && ho.blob) {
        var name = (ho.meta && ho.meta.name) || 'photo.png';
        return newFromPhoto(new File([ho.blob], name, { type: ho.blob.type || 'image/png' })).then(function () {
          if (ho.meta && ho.meta.recipe) {
            var v = LE.recipes.validate(ho.meta.recipe);
            if (v.ok) { S.handoffRecipe = v.workflow; openPanel('recipes', { recipe: v.workflow.metadata.id }); return 'panel'; }
          }
          return 'ok';
        });
      }
      var last = null;
      try { last = localStorage.getItem('le-studio-last'); } catch (e) {}
      if (!last) return null;
      return openProject(last, {
        toast: 'Restored your last design',
        action: { label: 'Start new', fn: function () { cmd('newDesign'); } }
      }).then(function () { return 'ok'; }, function () { return null; });
    }).then(function (r) {
      if (!S.project) showStart();
      if (r !== 'panel') applyToolParam();
      fire('ready', r);
    }).catch(function (err) {
      console.error(err);
      showStart();
    });
  }
  /* Template links (#d=…) open a preview sheet once the studio is ready; design files share the project picker. */
  if (E.fileProject && LE.design) E.fileProject.accept = '.leproject,application/zip,.ledesign.json,.json,application/json';
  boot().then(function () { if (LE.design && LE.design.studioBoot) LE.design.studioBoot(ctx); });

  /* Install hooks (le-pwa.js): files opened from the system or shared to the app, saving before an update,
     and the memory guard that lets big bitmaps go while the tab is in the background. */
  function pwaHooks(P) {
    if (!P || !P.registerEditor) return;
    P.onLaunchFiles(function (files) {
      var recipe = files.filter(function (f) { return /\.leworkflow$/i.test(f.name); })[0];
      var rest = files.filter(function (f) { return f !== recipe; });
      if (rest.length) addFiles(rest);
      if (recipe) { openPanel('recipes'); if (S.onRecipeFile) S.onRecipeFile(recipe); }
    });
    P.registerEditor({
      name: 'Photo studio',
      isBusy: function () { return !!S.project; },
      save: function () { return S.dirty ? saveNow() : null; },
      discard: function () { clearTimeout(S.saveTimer); S.dirty = false; try { localStorage.removeItem('le-studio-last'); } catch (e) {} },
      release: function () { if (scene._clearBitmaps) scene._clearBitmaps(); },
      restore: function () { if (scene._mark) scene._mark(); },
      stats: function () {
        var n = 0, px = 0;
        Object.keys(S.mem).forEach(function (k) { var c = S.mem[k] && S.mem[k].canvas; if (c) { n++; px += c.width * c.height; } });
        return { photos: n, bytes: px * 4, text: n ? n + ' photo' + (n > 1 ? 's' : '') + ' open, about ' + Math.round(px * 4 / 1048576) + ' MB of image memory' : 'No photos open' };
      }
    });
  }
  if (window.LEPwa) pwaHooks(window.LEPwa); else window.addEventListener('le-pwa-ready', function () { pwaHooks(window.LEPwa); }, { once: true });
  var checks = LE.recipes && LE.recipes.selfCheck ? LE.recipes.selfCheck() : [];
  checks.forEach(function (c) { if (!c.ok) console.warn(c.name, c.errors); });
})();
