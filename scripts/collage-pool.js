'use strict';

/* Photo ids shared by scripts/fetch-collage-photos.js and scripts/build-collages.js.
   CC0 / CC-BY searches only. The fetch script assigns one JPEG per item. */

function seq(cat, from, to) {
  var out = [];
  for (var i = from; i <= to; i++) {
    out.push({ id: cat + '-' + (i < 10 ? '0' : '') + i, cat: cat });
  }
  return out;
}

var searches = [
  { q: 'portrait person face', fallback: ['adult portrait photograph'], items: seq('people', 1, 4) },
  { q: 'friends smiling outdoor adults', fallback: ['people laughing park'], items: seq('people', 5, 8) },
  { q: 'street fashion urban', fallback: ['city street style clothing'], items: seq('street', 1, 4) },
  { q: 'travel city landmark', fallback: ['historic city square'], items: seq('travel', 1, 4) },
  { q: 'beach ocean coast', fallback: ['tropical shoreline'], items: seq('travel', 5, 8) },
  { q: 'wildflower meadow garden', fallback: ['flower garden'], items: seq('garden', 1, 4) },
  { q: 'cottage countryside house', fallback: ['country house garden'], items: seq('garden', 5, 6) },
  { q: 'forest path trees', fallback: ['woodland trail'], items: seq('nature', 1, 2) },
  { q: 'library books reading', fallback: ['bookshelf library'], items: seq('books', 1, 4) },
  { q: 'coffee cup table', fallback: ['cafe table cup'], items: seq('still', 1, 2) },
  { q: 'vintage camera film', fallback: ['film camera'], items: seq('still', 3, 4) },
  { q: 'desert landscape dunes', fallback: ['arid landscape'], items: seq('sky', 1, 2) },
  { q: 'sunset sky clouds', fallback: ['blue sky clouds'], items: seq('sky', 3, 4) },
  { q: 'marble statue museum', fallback: ['stone sculpture outdoor'], items: seq('arch', 1, 2) },
  { q: 'palm trees tropical', fallback: ['palm tree beach'], items: seq('arch', 3, 3) },
  { q: 'modern architecture facade', fallback: ['building exterior'], items: seq('arch', 4, 4) },
  { q: 'newspaper print paper', fallback: ['printed newspaper close'], items: seq('paper', 1, 2) },
  { q: 'pink flowers soft light', fallback: ['pastel flowers'], items: seq('soft', 1, 2) }
];

function allItems() {
  var out = [];
  searches.forEach(function (s) { s.items.forEach(function (it) { out.push(it); }); });
  return out;
}

function byCat() {
  var map = {};
  allItems().forEach(function (it) {
    if (!map[it.cat]) map[it.cat] = [];
    map[it.cat].push(it.id);
  });
  return map;
}

module.exports = { searches: searches, allItems: allItems, byCat: byCat };
