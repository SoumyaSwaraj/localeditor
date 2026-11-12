/* Loads the collage index, then one style pack. Cache is the le-assets fetch cache.
   Recipes paint background, then photo slots, then decor so tape and type sit on top. */
(function () {
  'use strict';

  var CACHE = 'le-assets-v1';
  var DIR = 'assets/data/collages/';
  var indexData = null;
  var indexFlight = null;
  var photoData = null;
  var photoFlight = null;
  var packs = {};
  var flights = {};

  function base() {
    var root = document.documentElement.getAttribute('data-root') || '';
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root;
  }

  function abs(rel) {
    return new URL(base() + String(rel || '').replace(/^\//, ''), document.baseURI).href;
  }

  function readJson(rel) {
    var href = abs(rel);
    function fromNet() {
      return fetch(href).then(function (res) {
        if (!res.ok) throw new Error('Collage data failed (' + res.status + ')');
        var copy = res.clone();
        var put = window.caches
          ? caches.open(CACHE).then(function (cache) { return cache.put(href, copy); }).catch(function () {})
          : Promise.resolve();
        return put.then(function () { return res.json(); });
      });
    }
    if (!window.caches) return fromNet();
    return caches.open(CACHE).then(function (cache) {
      return cache.match(href).then(function (hit) { return hit ? hit.json() : fromNet(); });
    }).catch(fromNet);
  }

  function index() {
    if (indexData) return Promise.resolve(indexData);
    if (indexFlight) return indexFlight;
    indexFlight = readJson(DIR + 'index.json').then(function (data) {
      indexData = data;
      indexFlight = null;
      return data;
    }, function (err) {
      indexFlight = null;
      throw err;
    });
    return indexFlight;
  }

  function loadStyle(id) {
    var key = String(id || '');
    if (!/^[a-z0-9-]{1,48}$/.test(key)) return Promise.reject(new Error('Unknown collage style'));
    if (packs[key]) return Promise.resolve(packs[key]);
    if (flights[key]) return flights[key];
    flights[key] = index().then(function () {
      return readJson(DIR + key + '.json');
    }).then(function (data) {
      packs[key] = data;
      delete flights[key];
      return data;
    }, function (err) {
      delete flights[key];
      throw err;
    });
    return flights[key];
  }

  function photos() {
    if (photoData) return Promise.resolve(photoData);
    if (photoFlight) return photoFlight;
    photoFlight = readJson(DIR + 'photos.json').then(function (data) {
      photoData = data;
      photoFlight = null;
      return data;
    }, function (err) {
      photoFlight = null;
      throw err;
    });
    return photoFlight;
  }

  window.LE = window.LE || {};
  window.LE.collage = { index: index, loadStyle: loadStyle, photos: photos };
})();
