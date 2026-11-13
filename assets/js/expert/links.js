/* LocalEditor Expert: deep links (docs/EXPERT-UI.md "Links"). The studio's boot hook reads the address once, opens Expert
 * for the visit and hands the rest here:
 *   /studio/?mode=expert&tab=develop|mask|layers|scopes     bring that panel forward (a pane on desktop, a tab elsewhere)
 *   /studio/?mode=expert&tool=heal|clone|patch|redeye|dodge|liquify|light|brush|gradient
 *   /studio/?mode=expert&add=<effect id>                    add that effect to the photo
 * A tool or an effect needs a photo: with none open the link waits for the first one (the effect says so in one line).
 * Unknown values are ignored without a message. Nothing here is remembered. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X) return;
  var TOOLS = ['heal', 'clone', 'patch', 'redeye', 'dodge', 'liquify', 'light', 'brush', 'gradient'];
  var pending = null, timer = 0;

  function photo() {
    var c = global.LEStudio, W = X.workspace, id = W && W.target && W.target(), l = id && X.doc.layer(id);
    if (l && l.type === 'image') return l;
    var b = c && c.S && c.S.project && c.targetImage && c.targetImage();
    return b && b.type === 'image' ? b : null;
  }
  function run() {
    var p = pending, l = photo();
    if (!p || !l || !X.workspace.active()) return;
    pending = null;
    if (p.add) {
      var d = X.def(p.add), fxId = X.doc.addFx(l.id, p.add, { append: true }, X.gesture());
      var dev = X.workspace.components().develop;
      if (dev && d) dev.open(d.section, true);
      X.emit('fx-select', { layerId: l.id, type: p.add, fxId: fxId });
    }
    if (p.tool) X.tools.activate(p.tool);
  }
  /* A new design is announced before its photo is in place, so the wait is a light poll (two property reads) that ends
     with the first photo, or with the workspace. */
  function wait() {
    if (timer) return;
    timer = setInterval(function () { if (!pending || !X.workspace.active()) { clearInterval(timer); timer = 0; return; } run(); if (!pending) { clearInterval(timer); timer = 0; } }, 300);
  }
  X.links = function (o) {
    o = o || {};
    var W = X.workspace, c = global.LEStudio;
    if (!W || !W.active()) return;
    var tool = o.tool && TOOLS.indexOf(String(o.tool)) >= 0 && X.tools.get(String(o.tool)) && !X.tools.get(String(o.tool)).placeholder ? String(o.tool) : null;
    /* After the effect library: its arrival rebuilds the panels, which would undo a focus or a scroll. */
    var ready = global.LE.fxBoot && global.LE.fxBoot.load ? global.LE.fxBoot.load().catch(function () {}) : Promise.resolve();
    return ready.then(function () {
      if (!W.active()) return;
      if (o.tab) W.show(String(o.tab));
      var d = o.add ? X.def(String(o.add)) : null;
      if (!d && !tool) return;
      pending = { add: d ? d.id : null, tool: tool };
      if (photo()) { run(); return; }
      wait();
      if (d && c && c.toast) c.toast('Open a photo: “' + (d.name || d.id) + '” will be added to it.', { ms: 7000 });
    });
  };
  X.on('leave', function () { pending = null; });
})(window);
