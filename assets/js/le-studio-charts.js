/* LocalEditor studio: the Chart panel (docs/CHARTS.md). Engine: assets/js/le-charts.js (LE.charts).
   Loaded on demand through the loader map (le-studio-lazy.js): the Chart panel, Apps → Chart, ?tool=chart and the
   "Edit chart" chip. A design that contains a chart draws without this file: a chart's parts are ordinary layers.
   Data is read on this device (CSV, TSV, Excel through LE.variables.parseFile; cells are text, nothing is run). */
(function () {
  'use strict';
  var LE = window.LE;
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  if (!LE || !LE.Scene || !LE.charts) return;
  var C = LE.charts;
  var ST = { view: 'start', table: null, file: null, tab: 'chart', notes: [], warned: {}, job: 0, kit: null, grid: null, seq: 0, status: '' };
  var TXT = { warn: 'Editing a chart redraws it from its data. Changes made by hand to single bars or labels were replaced. Undo brings them back.' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function el(html) { var t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstChild; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function vars() { return LE.variables ? Promise.resolve(LE.variables) : LE.varBoot.ready(); }
  try { if (LE.project && LE.project.brandKit) LE.project.brandKit().then(function (k) { ST.kit = k && k.colors && k.colors.length ? k : null; }).catch(function () {}); } catch (e) { /* no kit */ }

  /* ---------- the document ---------- */
  function cx(c) {
    var b = null;
    try { var st = c.S.project && c.S.project.meta && c.S.project.meta.studio; b = st && st.brand && st.brand.data ? st.brand.data : null; } catch (e) { b = null; }
    return { brand: b || ST.kit || null };
  }
  function current(c) {
    var sel = c.scene.selection(), layers = c.scene.layers(), by = {};
    layers.forEach(function (l) { by[l.id] = l; });
    for (var i = 0; i < sel.length; i++) { var l = by[sel[i]]; if (l && l.type === 'group' && l.chart) return l; if (l && l.groupId && by[l.groupId] && by[l.groupId].chart) return by[l.groupId]; }
    return null;
  }
  function sig(layers, gid) { return layers.filter(function (l) { return l.groupId === gid; }).map(function (l) { return l.type === 'text' ? 't' + l.text + l.color : 's' + (l.fill && l.fill.color || ''); }).join('|'); }
  /* Redraws the chart group from changed data or settings: one undo step. */
  function change(c, gid, fn, done) {
    var doc = c.scene.toJSON(), g = doc.layers.filter(function (l) { return l.id === gid && l.chart; })[0];
    if (!g) return;
    var before = sig(doc.layers, gid), was = C.regenerate(doc, gid, cx(c)), my = ++ST.seq;
    var edited = was && sig(was.layers, gid) !== before;
    fn(g.chart, g);
    g.chart = C.sanitize(g.chart);
    C.ready(g.chart, cx(c)).then(function () {
      if (my !== ST.seq) return;
      var r = C.regenerate(doc, gid, cx(c));
      doc.layers = r.layers;
      c.replaceDoc(doc, true);
      c.scene.select([gid]);
      ST.notes = r.notes;
      if (edited && !ST.warned[gid]) { ST.warned[gid] = 1; c.toast(TXT.warn); }
      if (done) done(); else refresh(c);
    });
  }
  function insert(c, chart) {
    if (!c.S.project) { c.toast('Start a design first: pick a size, then add the chart.'); return; }
    var theme = chart.theme || c.lsGet('le-chart-theme', 'clean');
    chart = C.sanitize(Object.assign({}, chart, { theme: theme }));
    C.ready(chart, cx(c)).then(function () {
      var res = C.ops.apply(c.scene.toJSON(), { op: 'chart.add', type: chart.type, data: chart.data, map: chart.map, theme: chart.theme, options: chart.options }, cx(c));
      if (!res.ok) { c.toast(res.errors[0].message); return; }
      c.replaceDoc(res.doc, true);
      c.scene.select([res.id]);
      ST.notes = res.warnings; ST.view = 'edit'; ST.tab = 'chart'; ST.table = null;
      if (c.S.panel === 'chart') c.renderPanel(true); else c.openPanel('chart');
      c.toast('Chart added. Every bar and label is an ordinary layer you can still edit.');
    });
  }
  function refresh(c) { if (c.S.panel === 'chart') c.renderPanel(true); }

  /* ---------- thumbnails: the real chart, small ---------- */
  function thumb(chart, w, h, c) {
    return C.ready(chart, cx(c)).then(function () {
      var r = C.render(chart, { x: 0, y: 0, w: w, h: h }, Object.assign({ id: 't' }, cx(c)));
      var host = el('<div aria-hidden="true" style="position:fixed;left:-10000px;top:0;width:64px;height:64px;pointer-events:none"></div>');
      document.body.appendChild(host);
      var sc = new LE.Scene({ el: host, width: w, height: h });
      sc.load({ v: 1, width: w, height: h, background: { type: 'color', color: r.theme.card }, layers: r.layers });
      var end = function () { try { sc.destroy(); } catch (e) { /* gone */ } host.remove(); };
      return sc.render(1, { includeBackground: true }).then(function (cv) { end(); return cv; }, function (e) { end(); throw e; });
    });
  }
  /* Thumbnails are drawn one after another, and only while this render of the panel is still showing. */
  function queue(c, items) {
    var job = ++ST.job, i = 0;
    function next() {
      if (job !== ST.job || i >= items.length) return;
      var it = items[i++];
      if (!it.node.isConnected) return next();
      thumb(it.chart, 360, 240, c).then(function (cv) { if (job === ST.job && it.node.isConnected) { cv.className = 'cx-thumb-cv'; it.node.innerHTML = ''; it.node.appendChild(cv); } }, function () {}).then(function () { setTimeout(next, 0); });
    }
    next();
  }
  function card(name, why, extra) {
    return el('<button type="button" class="cx-card' + (extra || '') + '"><span class="cx-thumb" aria-hidden="true"></span><span class="cx-card-t"><b>' + esc(name) + '</b>' + (why ? '<small>' + esc(why) + '</small>' : '') + '</span></button>');
  }

  /* ---------- data in ---------- */
  function setTable(c, t, name) {
    var data = C.fromTable(t), ft = C.fit(data);
    ST.table = { data: ft.data, note: ft.note, warnings: (t.warnings || []).slice(), name: name || '', sheets: t.sheets || [], sheet: t.sheet || '' };
  }
  function readFile(c, f, sheet, then) {
    if (!f) return;
    ST.status = 'Reading ' + f.name + '…';
    var s = document.querySelector('.cx-status'); if (s) s.textContent = ST.status;
    vars().then(function (V) { return V.parseFile(f, { sheet: sheet || undefined, maxRows: 20000 }); }).then(function (t) {
      ST.file = f; ST.status = '';
      setTable(c, t, f.name);
      then();
    }, function (e) { ST.status = e && e.message || 'That file could not be read.'; var s2 = document.querySelector('.cx-status'); if (s2) s2.textContent = ST.status; });
  }
  function dataBox(c, onTable) {
    var box = el('<div class="cx-drop"><label class="cx-label" for="cx-paste">Paste from a spreadsheet</label><textarea id="cx-paste" class="sx-input cx-paste" rows="4" spellcheck="false" autocomplete="off" placeholder="Month&#9;Sales&#10;Jan&#9;420&#10;Feb&#9;380"></textarea>' +
      '<div class="cx-row"><label class="btn cx-btn">' + c.ic('file') + '<span>Choose a file</span><input type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,text/csv,text/tab-separated-values" hidden></label>' +
      '<button type="button" class="btn btn-ghost cx-btn" data-a="type">Type it here</button></div>' +
      '<p class="cx-hint">CSV, TSV or Excel. The first row names the columns. Read on this device, never uploaded.</p><p class="cx-status" role="status" aria-live="polite">' + esc(ST.status) + '</p></div>');
    var ta = box.querySelector('textarea'), t = 0;
    ta.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (!ta.value.trim()) return;
        if (ta.value.length > 2000000) { box.querySelector('.cx-status').textContent = 'That is too much to paste here. Save it as a CSV file and choose it instead.'; return; }
        vars().then(function (V) { setTable(c, V.parseCSV(ta.value, { maxRows: 20000 }), ''); ST.file = null; onTable(); });
      }, 250);
    });
    box.querySelector('input[type=file]').onchange = function (e) { readFile(c, e.target.files && e.target.files[0], null, onTable); };
    box.addEventListener('dragover', function (e) { e.preventDefault(); box.classList.add('is-over'); });
    box.addEventListener('dragleave', function () { box.classList.remove('is-over'); });
    box.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); box.classList.remove('is-over'); readFile(c, e.dataTransfer.files && e.dataTransfer.files[0], null, onTable); });
    box.querySelector('[data-a=type]').onclick = function () { ST.grid = { data: { columns: ['Label', 'Value'], rows: [['', ''], ['', ''], ['', '']] }, gid: null }; ST.view = 'grid'; refresh(c); };
    return box;
  }
  function kindWord(a) { return a.kind === 'number' ? 'numbers' : a.kind === 'percent' ? 'percentages' : a.kind === 'currency' ? 'money' : a.kind === 'date' ? 'dates' : a.kind === 'empty' ? 'empty' : 'words'; }
  /* Cells that are not what their column holds, each with "Fix here". */
  function badCells(c, data, gid) {
    var A = C.analyse(data), list = [];
    A.forEach(function (a, ci) { a.bad.forEach(function (ri) { list.push({ r: ri, c: ci, what: a.kind === 'date' ? 'a date' : 'a number' }); }); });
    if (!list.length) return null;
    var box = el('<div class="cx-bad"><b>' + plural(list.length, 'cell') + ' to check</b><ul></ul></div>'), ul = box.querySelector('ul');
    list.slice(0, 6).forEach(function (b) {
      var li = el('<li><span>Row ' + (b.r + 1) + ', ' + esc(data.columns[b.c]) + ': “' + esc(String(data.rows[b.r][b.c]).slice(0, 24)) + '” is not ' + b.what + '. It is left out.</span><button type="button" class="btn btn-ghost btn-sm cx-fix">Fix here</button></li>');
      li.querySelector('button').onclick = function () { ST.grid = { data: clone(data), gid: gid || null, focus: [b.r, b.c] }; ST.view = 'grid'; refresh(c); };
      ul.appendChild(li);
    });
    if (list.length > 6) ul.appendChild(el('<li><span>…and ' + (list.length - 6) + ' more.</span></li>'));
    return box;
  }

  /* ---------- views ---------- */
  function viewStart(c, body) {
    body.appendChild(el('<p class="cx-lead">Turn numbers into a chart. Bring your own data, or try an example and put your numbers in after.</p>'));
    body.appendChild(dataBox(c, function () { ST.view = 'suggest'; refresh(c); }));
    var sec = c.ui.section('Try one with example data'), g = el('<div class="cx-grid"></div>'), items = [];
    C.types().forEach(function (t) {
      var b = card(t.name, '');
      b.setAttribute('data-type', t.id);
      b.onclick = function () { insert(c, C.sample(t.id, c.lsGet('le-chart-theme', 'clean'))); };
      items.push({ node: b.querySelector('.cx-thumb'), chart: C.sample(t.id, c.lsGet('le-chart-theme', 'clean')) });
      g.appendChild(b);
    });
    sec.querySelector('.sx-sec-body').appendChild(g);
    body.appendChild(sec);
    queue(c, items);
  }
  function viewSuggest(c, body) {
    var T = ST.table, data = T.data, A = C.analyse(data);
    var head = el('<div class="cx-sum"><b>' + plural(data.rows.length, 'row') + ' · ' + plural(data.columns.length, 'column') + (T.name ? ' · ' + esc(T.name) : '') + '</b><p>' +
      A.slice(0, 8).map(function (a) { return esc(a.name) + ' <i>(' + kindWord(a) + ')</i>'; }).join(', ') + (A.length > 8 ? ', …' : '') + '</p></div>');
    body.appendChild(head);
    if (T.sheets.length > 1 && ST.file) {
      var sp = el('<label class="cx-field"><span>Sheet</span><select class="sx-input"></select></label>'), se = sp.querySelector('select');
      T.sheets.forEach(function (n) { var o = document.createElement('option'); o.value = o.textContent = n; se.appendChild(o); });
      se.value = T.sheet;
      se.onchange = function () { readFile(c, ST.file, se.value, function () { refresh(c); }); };
      body.appendChild(sp);
    }
    T.warnings.concat(T.note ? [T.note] : []).forEach(function (w) { body.appendChild(el('<p class="sx-note is-warn">' + esc(w) + '</p>')); });
    var bad = badCells(c, data, null);
    if (bad) body.appendChild(bad);
    var sec = c.ui.section('Charts that fit this data'), g = el('<div class="cx-list"></div>'), items = [], theme = c.lsGet('le-chart-theme', 'clean');
    C.suggest(data).forEach(function (s, i) {
      var t = C.types().filter(function (x) { return x.id === s.type; })[0], chart = { v: 1, type: s.type, data: data, map: s.map, theme: theme, options: s.options };
      var name = t.name + (s.options.mode === 'stacked' ? ', stacked' : s.options.stem === false ? ', dots' : '');
      var b = card(name, s.why, ' cx-wide' + (i ? '' : ' is-best'));
      b.setAttribute('data-type', s.type);
      b.onclick = function () { insert(c, chart); };
      items.push({ node: b.querySelector('.cx-thumb'), chart: chart });
      g.appendChild(b);
    });
    sec.querySelector('.sx-sec-body').appendChild(g);
    body.appendChild(sec);
    var row = el('<div class="cx-row"><button type="button" class="btn btn-ghost cx-btn" data-a="edit">Edit the data</button><button type="button" class="btn btn-ghost cx-btn" data-a="over">Use other data</button></div>');
    row.querySelector('[data-a=edit]').onclick = function () { ST.grid = { data: clone(data), gid: null }; ST.view = 'grid'; refresh(c); };
    row.querySelector('[data-a=over]').onclick = function () { ST.table = null; ST.view = 'start'; refresh(c); };
    body.appendChild(row);
    queue(c, items);
  }
  /* A small grid to type in: a table on wide screens, one card per row on a phone (the CSS does that). 60 rows at a time. */
  function viewGrid(c, body) {
    var G = ST.grid, d = G.data, shown = Math.min(d.rows.length, G.shown || 60);
    body.appendChild(el('<p class="cx-lead">' + (G.gid ? 'Change the numbers, then choose Done. The chart is redrawn.' : 'Type your labels and numbers. The first row names the columns.') + '</p>'));
    var wrap = el('<div class="cx-gridwrap"><table class="cx-table"><thead><tr></tr></thead><tbody></tbody></table></div>'), hr = wrap.querySelector('thead tr'), tb = wrap.querySelector('tbody');
    d.columns.forEach(function (col, ci) {
      var th = el('<th><input class="sx-input cx-cell cx-head" aria-label="Column ' + (ci + 1) + ' name" value="' + esc(col) + '"></th>');
      th.firstChild.oninput = function (e) { d.columns[ci] = e.target.value; tb.querySelectorAll('td:nth-child(' + (ci + 1) + ')').forEach(function (td) { td.setAttribute('data-label', e.target.value); }); };
      hr.appendChild(th);
    });
    for (var ri = 0; ri < shown; ri++) (function (ri) {
      var tr = el('<tr></tr>');
      d.columns.forEach(function (col, ci) {
        var td = el('<td data-label="' + esc(col) + '"><input class="sx-input cx-cell" aria-label="' + esc(col) + ', row ' + (ri + 1) + '" value="' + esc(d.rows[ri][ci] == null ? '' : d.rows[ri][ci]) + '"></td>');
        td.firstChild.oninput = function (e) { d.rows[ri][ci] = e.target.value; };
        if (G.focus && G.focus[0] === ri && G.focus[1] === ci) setTimeout(function () { td.firstChild.focus(); td.firstChild.select(); td.firstChild.classList.add('is-bad'); }, 30);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    })(ri);
    body.appendChild(wrap);
    if (d.rows.length > shown) { var more = el('<button type="button" class="btn btn-ghost cx-btn">Show ' + Math.min(60, d.rows.length - shown) + ' more rows</button>'); more.onclick = function () { G.shown = shown + 60; G.focus = null; refresh(c); }; body.appendChild(more); }
    var row = el('<div class="cx-row"><button type="button" class="btn btn-ghost cx-btn" data-a="row">Add a row</button><button type="button" class="btn btn-ghost cx-btn" data-a="col">Add a column</button></div>');
    row.querySelector('[data-a=row]').onclick = function () { if ((d.rows.length + 1) * d.columns.length > C.CAP.cells) return c.toast('A chart keeps up to 5,000 cells.'); d.rows.push(d.columns.map(function () { return ''; })); G.shown = Math.max(shown + 1, d.rows.length); G.focus = [d.rows.length - 1, 0]; refresh(c); };
    row.querySelector('[data-a=col]').onclick = function () { if (d.columns.length >= 20) return c.toast('That is as many columns as fit here. Import a file for more.'); d.columns.push('Column ' + (d.columns.length + 1)); d.rows.forEach(function (r) { r.push(''); }); G.focus = null; refresh(c); };
    body.appendChild(row);
    var act = el('<div class="cx-row cx-actions"><button type="button" class="btn btn-primary cx-btn" data-a="done">Done</button><button type="button" class="btn btn-ghost cx-btn" data-a="cancel">Cancel</button></div>');
    act.querySelector('[data-a=cancel]').onclick = function () { ST.view = G.gid ? 'edit' : ST.table ? 'suggest' : 'start'; ST.grid = null; refresh(c); };
    act.querySelector('[data-a=done]').onclick = function () {
      var rows = d.rows.filter(function (r) { return r.some(function (v) { return String(v == null ? '' : v).trim() !== ''; }); });
      if (!rows.length) return c.toast('Type at least one row first.');
      var data = C.fromTable({ columns: d.columns, rows: rows }), gid = G.gid;
      ST.grid = null;
      if (gid) { ST.view = 'edit'; change(c, gid, function (ch, g) { var old = clone(ch); ch.data = data; var same = old.data.columns.join('\u0001') === data.columns.join('\u0001'); if (!same) ch.map = {}; }); }
      else { ST.table = { data: data, note: '', warnings: [], name: '', sheets: [], sheet: '' }; ST.view = 'suggest'; refresh(c); }
    };
    body.appendChild(act);
  }

  function chips(list, on, pick) {
    var w = el('<div class="cx-chips" role="group"></div>');
    list.forEach(function (it) { var b = el('<button type="button" class="cx-chip" aria-pressed="' + (on(it[0]) ? 'true' : 'false') + '">' + esc(it[1]) + '</button>'); b.onclick = function () { pick(it[0]); }; w.appendChild(b); });
    return w;
  }
  function field(label, value, onInput, ph) {
    var f = el('<label class="cx-field"><span>' + esc(label) + '</span><input class="sx-input" value="' + esc(value == null ? '' : value) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></label>'), t = 0;
    f.querySelector('input').oninput = function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { onInput(v); }, 350); };
    return f;
  }
  function pick(label, options, value, onChange) {
    var f = el('<label class="cx-field"><span>' + esc(label) + '</span><select class="sx-input"></select></label>'), s = f.querySelector('select');
    options.forEach(function (o) { var op = document.createElement('option'); op.value = String(o[0]); op.textContent = o[1]; s.appendChild(op); });
    s.value = String(value);
    s.onchange = function () { onChange(s.value); };
    return f;
  }
  function viewEdit(c, body, g) {
    var ch = g.chart, gid = g.id, o = ch.options, type = C.types().filter(function (t) { return t.id === ch.type; })[0] || C.types()[0];
    var Pp = C.prepare(ch), A = Pp.A, multi = Pp.series.length > 1;
    var set = function (k, v) { change(c, gid, function (x) { if (v == null || v === '') delete x.options[k]; else x.options[k] = v; }); };
    body.appendChild(el('<div class="cx-sum"><b>' + esc(type.name) + '</b><p class="cx-alt">' + esc(C.summary(ch)) + '</p></div>'));
    body.appendChild(c.ui.seg([['chart', 'Chart'], ['data', 'Data'], ['text', 'Words']], ST.tab, function (t) { ST.tab = t; refresh(c); }, 'cx-tabs'));
    ST.notes.forEach(function (n) { body.appendChild(el('<p class="sx-note cx-note">' + esc(n) + '</p>')); });

    if (ST.tab === 'chart') {
      /* Highlight: the single most useful control, one tap. */
      var names = multi && !(ch.type === 'heatmap' || ch.type === 'sparkline' || ch.type === 'table' || ch.type === 'slope') ? Pp.series.map(function (s) { return s.name; }) : Pp.cats;
      if (names.length > 1 && ch.type !== 'heatmap' && ch.type !== 'histogram' && ch.type !== 'combo' && ch.type !== 'radar' && ch.type !== 'waterfall') {
        var hs = c.ui.section('Highlight one'), cur = String(o.highlight == null ? '' : o.highlight);
        hs.querySelector('.sx-sec-body').appendChild(chips([['', 'None']].concat(names.slice(0, 14).map(function (n) { return [n, n]; })), function (v) { return v === cur; }, function (v) { set('highlight', v || null); }));
        body.appendChild(hs);
      }
      var ts = c.ui.section('Theme'), tg = el('<div class="cx-themes"></div>');
      C.themes(cx(c)).forEach(function (t) {
        var b = el('<button type="button" class="cx-theme" aria-pressed="' + (t.id === ch.theme) + '" data-theme="' + t.id + '"><i style="background:' + t.card + ';border-color:' + t.border + '">' + t.palette.slice(0, 4).map(function (p) { return '<u style="background:' + p + '"></u>'; }).join('') + '</i><span>' + esc(t.name) + '</span></button>');
        b.onclick = function () { c.lsSet('le-chart-theme', t.id); change(c, gid, function (x) { x.theme = t.id; }); };
        tg.appendChild(b);
      });
      ts.querySelector('.sx-sec-body').appendChild(tg);
      body.appendChild(ts);
      var os = c.ui.section('Options'), ob = os.querySelector('.sx-sec-body'), T = ch.type;
      if ((T === 'bar' || T === 'column') && multi) ob.appendChild(c.ui.seg([['grouped', 'Side by side'], ['stacked', 'Stacked'], ['percent', '100%']], o.mode || 'grouped', function (v) { set('mode', v === 'grouped' ? null : v); }));
      if (T === 'area' && multi) ob.appendChild(c.ui.seg([['', 'Overlapping'], ['stacked', 'Stacked'], ['percent', '100%']], o.mode || '', function (v) { set('mode', v || null); }));
      if (Pp.catKind !== 'date' && !/^(scatter|bubble|histogram|table|gauge|stat|sparkline|heatmap)$/.test(T)) ob.appendChild(pick('Order', [['', 'As in the data'], ['desc', 'Largest first'], ['asc', 'Smallest first']], o.sort || '', function (v) { set('sort', v || null); }));
      if (!/^(table|stat|gauge|sparkline|radar|slope|bullet|pictogram|treemap)$/.test(T)) ob.appendChild(c.ui.toggle('Numbers on the chart', o.labels !== 'off', function (v) { set('labels', v ? null : 'off'); }));
      if (T === 'bar' && !multi) { ob.appendChild(c.ui.toggle('Names above the bars', o.labelsAt === 'above', function (v) { set('labelsAt', v ? 'above' : null); })); ob.appendChild(c.ui.toggle('Numbers inside the bars', o.labelPosition === 'inside', function (v) { set('labelPosition', v ? 'inside' : null); })); }
      if (T === 'line' || T === 'area' || T === 'combo') ob.appendChild(c.ui.toggle('Smooth lines', o.smooth === true, function (v) { set('smooth', v || null); }));
      if (T === 'line') ob.appendChild(c.ui.toggle('Start the axis at zero', o.zero !== false, function (v) { set('zero', v ? null : false); }, 'Off zooms in on the change and says so under the chart.'));
      if (T === 'pie' || T === 'donut') ob.appendChild(c.ui.seg([['percent', 'Percent'], ['value', 'Numbers']], o.show === 'value' ? 'value' : 'percent', function (v) { set('show', v === 'value' ? 'value' : null); }));
      if (T === 'scatter' || T === 'bubble') ob.appendChild(c.ui.toggle('Trend line', o.trend === true, function (v) { set('trend', v || null); }));
      if (T === 'gauge') ob.appendChild(c.ui.toggle('Full ring', o.shape === 'ring', function (v) { set('shape', v ? 'ring' : null); }));
      if (T === 'lollipop') ob.appendChild(c.ui.toggle('Stems', o.stem !== false, function (v) { set('stem', v ? null : false); }));
      if (T === 'waterfall') ob.appendChild(c.ui.toggle('Total at the end', o.total !== false, function (v) { set('total', v ? null : false); }));
      ob.appendChild(c.ui.toggle('Card behind the chart', o.card !== false, function (v) { set('card', v ? null : false); }));
      ob.appendChild(pick('Text size', [['0.85', 'Small'], ['1', 'Medium'], ['1.2', 'Large']], String(o.textScale || 1), function (v) { set('textScale', v === '1' ? null : Number(v)); }));
      body.appendChild(os);
      var ys = c.ui.section('Chart type'), yg = el('<div class="cx-grid"></div>'), items = [];
      C.types().forEach(function (t) {
        var b = card(t.name, '', t.id === ch.type ? ' is-on' : ''), probe = Object.assign({}, ch, { type: t.id, options: Object.assign({}, o, { title: '', subtitle: '', source: '', note: '' }) });
        b.setAttribute('data-type', t.id); b.setAttribute('aria-pressed', t.id === ch.type ? 'true' : 'false');
        b.onclick = function () { change(c, gid, function (x) { var special = /^(scatter|bubble|bullet|gauge|histogram)$/; if (special.test(t.id) || special.test(x.type)) x.map = {}; x.type = t.id; }); };
        items.push({ node: b.querySelector('.cx-thumb'), chart: probe });
        yg.appendChild(b);
      });
      ys.querySelector('.sx-sec-body').appendChild(yg);
      body.appendChild(ys);
      queue(c, items);
    } else if (ST.tab === 'data') {
      var row = el('<div class="cx-row"><button type="button" class="btn cx-btn" data-a="edit">Edit the numbers</button><button type="button" class="btn btn-ghost cx-btn" data-a="new">Use other data</button></div>');
      row.querySelector('[data-a=edit]').onclick = function () { ST.grid = { data: clone(ch.data), gid: gid }; ST.view = 'grid'; refresh(c); };
      row.querySelector('[data-a=new]').onclick = function () { ST.replace = !ST.replace; refresh(c); };
      body.appendChild(row);
      if (ST.replace) body.appendChild(dataBox(c, function () {
        var T2 = ST.table; ST.table = null; ST.replace = false;
        change(c, gid, function (x) { var same = x.data.columns.join('\u0001') === T2.data.columns.join('\u0001'); x.data = T2.data; if (!same) x.map = {}; });
        if (T2.note) c.toast(T2.note);
      }));
      var bad = badCells(c, ch.data, gid);
      if (bad) body.appendChild(bad);
      var ms = c.ui.section('What goes where'), mb = ms.querySelector('.sx-sec-body'), colsAll = ch.data.columns.map(function (n, i) { return [i, n]; }), numCols = colsAll.filter(function (x) { return A[x[0]].numeric; });
      var setMap = function (k, v) { change(c, gid, function (x) { var m = Object.assign({}, Pp.map); delete m.label; m[k] = v; x.map = m; }); };
      if (ch.type === 'scatter' || ch.type === 'bubble') {
        mb.appendChild(pick('Across', numCols, Pp.map.x, function (v) { setMap('x', Number(v)); }));
        mb.appendChild(pick('Up', numCols, Pp.map.y, function (v) { setMap('y', Number(v)); }));
        if (ch.type === 'bubble') mb.appendChild(pick('Size', [[-1, 'All the same']].concat(numCols), Pp.map.size, function (v) { setMap('size', Number(v)); }));
        mb.appendChild(pick('Names', [[-1, 'None']].concat(colsAll.filter(function (x) { return !A[x[0]].numeric; })), Pp.map.category, function (v) { setMap('category', Number(v)); }));
      } else {
        mb.appendChild(pick('Labels', [[-1, 'Row numbers']].concat(colsAll), Pp.map.category, function (v) { setMap('category', Number(v)); }));
        var vb = el('<div class="cx-field"><span>Numbers</span><div class="cx-chips"></div></div>');
        numCols.forEach(function (x) {
          var on = Pp.map.series.indexOf(x[0]) >= 0, b = el('<button type="button" class="cx-chip" aria-pressed="' + on + '">' + esc(x[1]) + '</button>');
          b.onclick = function () { var s = Pp.map.series.filter(function (i) { return i !== x[0]; }); if (!on) s.push(x[0]); s.sort(function (a, b2) { return a - b2; }); if (!s.length) return c.toast('A chart needs at least one column of numbers.'); setMap('series', s); };
          vb.lastChild.appendChild(b);
        });
        if (numCols.length) mb.appendChild(vb);
        var catCols = colsAll.filter(function (x) { return !A[x[0]].numeric && x[0] !== Pp.map.category; });
        if (catCols.length) mb.appendChild(pick('Split into series by', [[-1, 'Nothing']].concat(catCols), Pp.map.group, function (v) { setMap('group', Number(v)); }));
        if (ch.type === 'bullet' || ch.type === 'gauge') mb.appendChild(pick(ch.type === 'gauge' ? 'Out of' : 'Target', [[-1, 'None']].concat(numCols), Pp.map.target, function (v) { setMap('target', Number(v)); }));
        mb.appendChild(pick('Rows with the same label', [['', 'Add up'], ['mean', 'Average'], ['count', 'Count'], ['min', 'Smallest'], ['max', 'Largest']], o.aggregate || '', function (v) { set('aggregate', v || null); }));
        mb.appendChild(pick('Keep', [['', 'Every row'], ['3', 'Top 3 + Other'], ['5', 'Top 5 + Other'], ['8', 'Top 8 + Other'], ['10', 'Top 10 + Other']], o.top ? String(o.top) : '', function (v) { set('top', v ? Number(v) : null); }));
        if (multi || o.swap) mb.appendChild(c.ui.toggle('Swap rows and columns', o.swap === true, function (v) { set('swap', v || null); }));
      }
      body.appendChild(ms);
      if (Pp.map.category >= 0 && ch.type !== 'scatter' && ch.type !== 'bubble') {
        var all = [], seen = {}, ex = (o.exclude || []).map(String);
        ch.data.rows.forEach(function (r) { var k = String(r[Pp.map.category] == null ? '' : r[Pp.map.category]).trim(); if (k && !seen[k]) { seen[k] = 1; all.push(k); } });
        if (all.length > 1 && all.length <= 40) {
          var fs = c.ui.section('Rows shown');
          fs.querySelector('.sx-sec-body').appendChild(chips(all.map(function (n) { return [n, n]; }), function (v) { return ex.indexOf(v) < 0; }, function (v) { var nx = ex.indexOf(v) < 0 ? ex.concat([v]) : ex.filter(function (q) { return q !== v; }); if (nx.length >= all.length) return c.toast('Keep at least one row.'); set('exclude', nx.length ? nx : null); }));
          body.appendChild(fs);
        }
      }
    } else {
      var ws = c.ui.section('Words on the chart'), wb = ws.querySelector('.sx-sec-body');
      wb.appendChild(field('Title', o.title, function (v) { set('title', v); }, 'Say what the chart shows'));
      wb.appendChild(field('Line under the title', o.subtitle, function (v) { set('subtitle', v); }));
      wb.appendChild(field('Note', o.note, function (v) { set('note', v); }));
      wb.appendChild(field('Source', o.source, function (v) { set('source', v); }, 'Source: where the numbers come from'));
      wb.appendChild(field('Unit after numbers', o.unit == null ? Pp.f.suf : o.unit, function (v) { change(c, gid, function (x) { x.options.unit = v; }); }, 'kg, %, people'));
      body.appendChild(ws);
      var an = (o.annotations || []).filter(function (a) { return a && a.type === 'line'; })[0] || null;
      if (/^(bar|column|line|area|combo|scatter|bubble)$/.test(ch.type)) {
        var rs = c.ui.section('Reference line'), rb = rs.querySelector('.sx-sec-body');
        var put = function (val, label) { change(c, gid, function (x) { var rest = (x.options.annotations || []).filter(function (a) { return !a || a.type !== 'line'; }); var n = C.number(val); if (n != null) rest.push({ type: 'line', value: n, label: label || '' }); if (rest.length) x.options.annotations = rest; else delete x.options.annotations; }); };
        rb.appendChild(field('At the value', an ? an.value : '', function (v) { put(v, an ? an.label : ''); }, 'A target or an average'));
        rb.appendChild(field('Its label', an ? an.label : '', function (v) { if (an) put(an.value, v); }, 'Target'));
        body.appendChild(rs);
      }
      var alt = el('<div class="cx-sum"><b>In a sentence</b><p class="cx-alt">' + esc(C.summary(ch)) + '</p><button type="button" class="btn btn-ghost btn-sm cx-fix">Copy</button></div>');
      alt.querySelector('button').onclick = function () { try { navigator.clipboard.writeText(C.summary(ch)).then(function () { c.toast('Copied'); }, function () { c.toast('Copy failed'); }); } catch (e) { c.toast('Copy failed'); } };
      body.appendChild(alt);
    }
    var foot = el('<div class="cx-row cx-foot"><button type="button" class="btn btn-ghost cx-btn">Add another chart</button></div>');
    foot.firstChild.onclick = function () { c.scene.select([]); ST.view = 'start'; refresh(c); };
    body.appendChild(foot);
  }

  function render(c, host, o) {
    ST.job++;
    var body = el('<div class="cx"></div>');
    host.appendChild(body);
    var g = c.scene ? current(c) : null;
    if (ST.view === 'grid' && ST.grid) return viewGrid(c, body);
    if (g && ST.view !== 'suggest') { ST.view = 'edit'; return viewEdit(c, body, g); }
    if (ST.view === 'edit' || ST.view === 'grid') ST.view = 'start';
    if (ST.view === 'suggest' && ST.table) return viewSuggest(c, body);
    ST.view = 'start';
    viewStart(c, body);
  }

  /* ---------- registration ---------- */
  var H = P._hooks = P._hooks || {};
  P.chart = { eyebrow: 'Data', title: 'Chart', sheet: 'full', render: render, close: function () { ST.job++; } };
  (P._cmds = P._cmds || {}).chart = function (c, arg) { if (arg === 'edit') { ST.view = 'edit'; ST.tab = 'chart'; } c.openPanel('chart'); };
  (P._appRender = P._appRender || {}).chart = function (c) { setTimeout(function () { c.openPanel('chart'); }, 0); };
  (H.select = H.select || []).push(function (c) {
    if (c.S.panel !== 'chart' || ST.view === 'grid' || ST.view === 'suggest') return;
    var g = current(c), id = g ? g.id : '';
    if (id !== ST.shown) setTimeout(function () { if (c.S.panel === 'chart') { ST.notes = []; c.renderPanel(true); } }, 0);
  });
  var baseRender = P.chart.render;
  P.chart.render = function (c, body, o) { var g = c.scene ? current(c) : null; ST.shown = g ? g.id : ''; return baseRender(c, body, o); };

  window.LEStudioCharts = {
    state: function () { return ST; },
    add: function (chart) { return insert(window.LEStudio, chart); },
    setTable: function (table, name) { setTable(window.LEStudio, table, name); ST.view = 'suggest'; refresh(window.LEStudio); },
    thumb: function (chart, w, h) { return thumb(chart, w || 360, h || 240, window.LEStudio); }
  };
})();
