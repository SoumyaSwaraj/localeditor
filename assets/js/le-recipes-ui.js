(function () {
  'use strict';
  if (!window.LE) return;
  var builtin = document.getElementById('builtin');
  var mine = document.getElementById('mine');
  var detail = document.getElementById('detail');
  var current = null;
  var userImage = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function card(recipe) {
    var a = document.createElement('button');
    a.type = 'button';
    a.className = 'tool-card';
    a.id = recipe.metadata.id;
    var count = recipe.steps.length;
    a.innerHTML = '<span class="ti">' + esc(recipe.metadata.name.slice(0, 1)) + '</span><span><h3>' + esc(recipe.metadata.name) + '</h3><p>' + esc(recipe.metadata.category) + ' · ' + esc(recipe.metadata.difficulty) + ' · ' + count + (count === 1 ? ' step' : ' steps') + '</p></span>';
    a.addEventListener('click', function () { openRecipe(recipe); });
    return a;
  }

  function paintLists() {
    builtin.innerHTML = '';
    LE.recipes.builtins.forEach(function (r) { builtin.appendChild(card(r)); });
    mine.innerHTML = '';
    var saved = LE.userRecipes.all();
    if (!saved.length) {
      var p = document.createElement('p');
      p.textContent = 'Recipes you import or save in the studio show up here, on this device only.';
      mine.appendChild(p);
    } else saved.forEach(function (r) {
      var check = LE.recipes.validate(r);
      if (check.ok) mine.appendChild(card(check.workflow));
    });
  }

  function sampleFor(recipe) {
    var cat = recipe.metadata.category;
    return LE.sample(cat === 'portrait' ? 'portrait' : 'scene');
  }

  function openRecipe(recipe) {
    current = recipe;
    renderPreview.allow = false;
    var saved = LE.userRecipes.savedIds()[recipe.metadata.id];
    var vote = LE.userRecipes.votes()[recipe.metadata.id] || 0;
    detail.innerHTML =
      '<p class="kicker">' + esc(recipe.metadata.category) + ' · ' + esc(recipe.metadata.difficulty) + '</p>' +
      '<h2>' + esc(recipe.metadata.name) + '</h2>' +
      '<p>' + esc(recipe.metadata.description) + '</p>' +
      '<p>' + esc(recipe.metadata.author) + '</p>' +
      '<div class="compare"><canvas id="before"></canvas><canvas id="after"></canvas></div>' +
      '<label class="slider"><span class="row"><span>Intensity</span><output id="iv">' + recipe.parameters[0].default + '</output></span><input id="intensity" type="range" min="0" max="100" value="' + recipe.parameters[0].default + '"></label>' +
      '<ol>' + recipe.steps.map(function (s) { return '<li><strong>' + esc(s.label) + '</strong>' + (s.description ? ' — ' + esc(s.description) : '') + '</li>'; }).join('') + '</ol>' +
      '<div id="gate"></div>' +
      '<label class="field">Your photo<input class="input" id="own" type="file" accept="image/*"></label>' +
      '<div class="actions"><button class="btn btn-gold" type="button" id="use">Download result</button><button class="btn" type="button" id="studio">Open in studio</button></div>' +
      '<div class="actions"><button class="btn" type="button" id="file">Download recipe</button><button class="btn" type="button" id="save">' + (saved ? 'Saved' : 'Save here') + '</button></div>' +
      '<div class="stars" aria-label="Your rating">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-star="' + n + '" aria-pressed="' + (vote >= n) + '">' + n + '</button>'; }).join('') + '</div>' +
      '<div id="qr"></div>';
    renderPreview();
    detail.querySelector('#intensity').addEventListener('input', function (e) {
      detail.querySelector('#iv').textContent = e.target.value;
      renderPreview();
    });
    detail.querySelector('#own').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      LE.load(file).then(function (canvas) { userImage = { canvas: canvas, file: file }; renderPreview(); });
    });
    detail.querySelector('#use').addEventListener('click', downloadResult);
    detail.querySelector('#studio').addEventListener('click', sendStudio);
    detail.querySelector('#file').addEventListener('click', function () {
      var blob = new Blob([LE.recipes.stringify(recipe)], { type: 'application/json' });
      IT.download(blob, recipe.metadata.id + '.leworkflow');
    });
    detail.querySelector('#save').addEventListener('click', function () {
      var on = LE.userRecipes.bookmark(recipe.metadata.id);
      this.textContent = on ? 'Saved' : 'Save here';
    });
    detail.querySelectorAll('[data-star]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var n = Number(btn.getAttribute('data-star'));
        LE.userRecipes.rate(recipe.metadata.id, n);
        detail.querySelectorAll('[data-star]').forEach(function (b) { b.setAttribute('aria-pressed', Number(b.getAttribute('data-star')) <= n); });
      });
    });
    var json = LE.recipes.stringify(recipe);
    if (json.length < 900 && window.qrcode) {
      try {
        var qr = qrcode(0, 'M');
        qr.addData(json);
        qr.make();
        detail.querySelector('#qr').innerHTML = '<p>QR for a short recipe</p>' + qr.createImgTag(3, 8);
      } catch (err) {}
    }
    if (location.hash !== '#' + recipe.metadata.id) history.replaceState(null, '', '#' + recipe.metadata.id);
  }

  function intensity() {
    var input = document.getElementById('intensity');
    return input ? Number(input.value) : 75;
  }

  function baseCanvas() {
    return userImage ? userImage.canvas : sampleFor(current);
  }

  function renderPreview() {
    if (!current) return;
    var source = baseCanvas();
    var before = document.getElementById('before');
    if (before) {
      before.width = source.width; before.height = source.height;
      before.getContext('2d').drawImage(source, 0, 0);
    }
    var prepared = LE.recipes.prepare(current, { intensity: intensity() });
    var gate = document.getElementById('gate');
    if (prepared.blocked) {
      if (gate) gate.innerHTML = prepared.notices.map(function (n) { return '<div class="notice-bad">' + esc(n.message) + '</div>'; }).join('') + '<button class="btn" type="button" id="anyway">Continue without those steps</button>';
      var anyway = document.getElementById('anyway');
      if (anyway) anyway.onclick = function () { renderPreview.allow = true; renderPreview(); };
      return;
    }
    if (gate) gate.innerHTML = prepared.notices.filter(function (n) { return n.level === 'optimized' || n.level === 'skipped'; }).map(function (n) { return '<div class="notice-soft">' + esc(n.message) + '</div>'; }).join('');
    var steps = prepared.blocked ? [] : prepared.steps;
    if (renderPreview.allow) steps = LE.recipes.prepare(current, { intensity: intensity(), allowSkip: true }).steps;
    LE.applySteps(source, steps).then(function (res) {
      var after = document.getElementById('after');
      if (!after) return;
      after.width = res.canvas.width; after.height = res.canvas.height;
      after.getContext('2d').drawImage(res.canvas, 0, 0);
      current._last = res.canvas;
    });
  }

  function downloadResult() {
    if (!current || !current._last) return;
    LE.exportImage(current._last, { format: (current.export && current.export.format) || 'jpeg', quality: ((current.export && current.export.quality) || 90) / 100 }).then(function (blob) {
      IT.download(blob, current.metadata.id + '.jpg');
    });
  }

  function sendStudio() {
    var source = userImage ? userImage.canvas : sampleFor(current);
    LE.toBlob(source, 'image/png').then(function (blob) {
      return LE.handoff.put(blob, { name: userImage && userImage.file ? userImage.file.name : 'sample.png', recipe: current });
    }).then(function () { location.href = '../studio/?tool=recipes'; });
  }

  document.getElementById('import').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    file.text().then(function (text) {
      var result = LE.recipes.validate(text);
      if (!result.ok) { IT.say(result.errors[0]); return; }
      LE.userRecipes.save(result.workflow);
      paintLists();
      openRecipe(result.workflow);
      IT.say('Recipe added on this device');
    });
  });

  paintLists();
  var hash = location.hash.replace('#', '');
  var found = LE.recipes.builtins.concat(LE.userRecipes.all()).filter(function (r) { return r.metadata && r.metadata.id === hash; })[0];
  if (found) openRecipe(LE.recipes.validate(found).workflow || found);
  else if (LE.recipes.builtins[0]) openRecipe(LE.recipes.builtins[0]);
})();
