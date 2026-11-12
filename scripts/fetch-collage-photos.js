#!/usr/bin/env node
/* Downloads a small CC0 / CC-BY JPEG pool for collage slots.
   Openverse anonymous search is limited to one request every 4 seconds.
   Sized Flickr, StockSnap, and Wikimedia thumbs are preferred. ffmpeg fits outliers.
   Run: node scripts/fetch-collage-photos.js
*/
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var execFile = require('child_process').execFile;
var pool = require('./collage-pool');

var ROOT = path.resolve(__dirname, '..');
var DIR = path.join(ROOT, 'assets', 'photos', 'collage');
var OUT = path.join(ROOT, 'assets', 'data', 'collages', 'photos.json');
var UA = 'LocalEditorCollagePool/1.0 (educational local catalog; +https://localeditor.net)';
var BAD = /\b(nude|nudes|naked|sex|sexual|porn|erotic|xxx|lingerie|bikini|nipple|boobs|fetish|nsfw|underwear|explicit)\b/i;

var lastCall = 0;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  var i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xFF) { i++; continue; }
    var marker = buf[i + 1];
    if (marker === 0xD8 || marker === 0x01) { i += 2; continue; }
    if (marker === 0xD9) break;
    var len = buf.readUInt16BE(i + 2);
    if (len < 2) break;
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function acceptable(buf) {
  var dim = jpegSize(buf);
  if (!dim) return null;
  var edge = Math.max(dim.w, dim.h);
  if (edge > 1200 || edge < 480) return null;
  if (buf.length < 40000 || buf.length > 150000) return null;
  return dim;
}

function run(cmd, args) {
  return new Promise(function (resolve, reject) {
    execFile(cmd, args, { windowsHide: true }, function (err, stdout, stderr) {
      if (err) reject(new Error(String(stderr || err.message).slice(0, 500)));
      else resolve();
    });
  });
}

function tagText(hit) {
  var tags = hit.tags || [];
  return tags.map(function (t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    return t.name || t.slug || '';
  }).join(' ');
}

function risky(hit) {
  var blob = (hit.title || '') + ' ' + tagText(hit) + ' ' + JSON.stringify(hit.unstable__sensitivity || '');
  return BAD.test(blob);
}

function keyOf(hit) {
  var url = hit.url || '';
  var m = url.match(/\/(\d{6,})_/);
  if (m) return 'flickr:' + m[1];
  return hit.id || url;
}

function wikiFile(url) {
  try {
    var u = new URL(url);
    if (u.hostname === 'commons.wikimedia.org') {
      var m = decodeURIComponent(u.pathname).match(/\/wiki\/(?:File|Image):(.+)$/i);
      if (m) return m[1];
    }
    if (u.hostname === 'upload.wikimedia.org') {
      var parts = u.pathname.split('/').map(function (p) { return decodeURIComponent(p); });
      var thumb = parts.indexOf('thumb');
      if (thumb >= 0 && parts[thumb + 3]) return parts[thumb + 3];
      return parts[parts.length - 1] || '';
    }
  } catch (e) { /* ignore */ }
  return '';
}

function candidates(hit) {
  var url = hit.url || '';
  if (/staticflickr\.com/i.test(url) && /_[a-z]\.jpe?g$/i.test(url)) {
    var ext = url.match(/\.jpe?g$/i)[0];
    var base = url.replace(/_[a-z]\.jpe?g$/i, '');
    return ['z', 'c', 'b'].map(function (s) { return base + '_' + s + ext; });
  }
  var file = wikiFile(url);
  if (file) {
    return [720, 960, 1100].map(function (w) {
      return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=' + w;
    });
  }
  return [url];
}

function rank(hit) {
  var url = hit.url || '';
  if (/staticflickr\.com/i.test(url)) return 0;
  if (/stocksnap\.io/i.test(url)) return 1;
  if (/wikimedia|commons/i.test(url)) return 2;
  if (/rawpixel/i.test(url)) return 3;
  return 4;
}

function usable(hit, seen) {
  if (!hit || !hit.url) return false;
  if (hit.mature) return false;
  if (hit.license !== 'cc0' && hit.license !== 'by') return false;
  if (hit.category && hit.category !== 'photograph') return false;
  var ft = String(hit.filetype || '').toLowerCase();
  if (ft && ft !== 'jpg' && ft !== 'jpeg') return false;
  if (risky(hit)) return false;
  if (hit.width && hit.height) {
    var aspect = hit.width / hit.height;
    if (aspect < 0.45 || aspect > 2.4) return false;
  }
  var key = keyOf(hit);
  if (seen[key]) return false;
  return true;
}

async function openverse(q, page) {
  var wait = 4200 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  var url = 'https://api.openverse.org/v1/images/?q=' + encodeURIComponent(q) +
    '&license=cc0,by&mature=false&category=photograph&page_size=20&page=' + page;
  var res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (res.status === 429 || res.status >= 500) {
    await sleep(12000);
    lastCall = Date.now();
    res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000)
    });
  }
  if (!res.ok) throw new Error('Openverse ' + res.status + ' for ' + q);
  return res.json();
}

async function download(url) {
  var res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'image/jpeg,image/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var len = Number(res.headers.get('content-length') || 0);
  if (len > 1200000) throw new Error('too big');
  var buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8000 || buf.length > 1200000) throw new Error('size ' + buf.length);
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('not jpeg');
  return buf;
}

async function compress(buf) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'le-col-'));
  var src = path.join(dir, 'in.jpg');
  var out = path.join(dir, 'out.jpg');
  fs.writeFileSync(src, buf);
  var dim = jpegSize(buf);
  var edge = Math.min(1000, dim ? Math.max(dim.w, dim.h) : 900);
  var q = 8;
  var best = null;
  try {
    for (var i = 0; i < 7; i++) {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf',
        'scale=' + edge + ':' + edge + ':force_original_aspect_ratio=decrease:force_divisible_by=2',
        '-q:v', String(q), out]);
      var b = fs.readFileSync(out);
      var d = acceptable(b);
      if (d) return { buf: b, dim: d };
      if (!best || Math.abs(b.length - 90000) < Math.abs(best.len - 90000)) best = { buf: b, len: b.length };
      if (b.length > 150000) {
        edge = Math.max(520, Math.round(edge * 0.82));
        q = Math.min(16, q + 2);
      } else {
        q = Math.max(3, q - 2);
        edge = Math.min(1200, Math.round(edge * 1.12));
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (best) {
    var ok = acceptable(best.buf);
    if (ok) return { buf: best.buf, dim: ok };
  }
  return null;
}

async function acquire(hit) {
  var urls = candidates(hit);
  var oversize = null;
  for (var i = 0; i < urls.length; i++) {
    var buf;
    try { buf = await download(urls[i]); } catch (e) { continue; }
    var dim = acceptable(buf);
    if (dim) return { buf: buf, dim: dim };
    var raw = jpegSize(buf);
    if (!raw) continue;
    if (buf.length > 150000 || Math.max(raw.w, raw.h) > 1200) {
      if (!oversize || buf.length < oversize.length) oversize = buf;
    }
  }
  if (oversize) return compress(oversize);
  return null;
}

function licenseOf(hit) {
  if (hit.license === 'cc0') return 'CC0';
  return 'CC BY' + (hit.license_version ? (' ' + hit.license_version) : '');
}

function record(item, hit, query, got) {
  var creator = hit.creator || 'Unknown';
  var license = licenseOf(hit);
  return {
    id: item.id,
    file: 'assets/photos/collage/' + item.id + '.jpg',
    w: got.dim.w,
    h: got.dim.h,
    source: 'Openverse (' + (hit.provider || hit.source || 'web') + ')',
    photographer: creator,
    url: hit.foreign_landing_url || hit.url,
    license: license,
    query: query,
    attribution: hit.attribution || ('Photo by ' + creator + ', ' + license)
  };
}

async function collectSafe(query, need, seen, pages) {
  try { return await collect(query, need, seen, pages); }
  catch (err) {
    console.error('search failed: ' + query + ' ' + (err && err.message ? err.message : err));
    return [];
  }
}

async function collect(query, need, seen, pages) {
  var found = [];
  for (var page = 1; page <= pages && found.length < need; page++) {
    var data = await openverse(query, page);
    var rows = (data.results || []).filter(function (hit) { return usable(hit, seen); });
    rows.sort(function (a, b) { return rank(a) - rank(b); });
    rows.forEach(function (hit) {
      if (found.length >= need) return;
      var key = keyOf(hit);
      if (seen[key]) return;
      seen[key] = 1;
      found.push(hit);
    });
  }
  return found;
}

async function fillItem(item, hit, query) {
  var got = await acquire(hit);
  if (!got) return null;
  fs.writeFileSync(path.join(DIR, item.id + '.jpg'), got.buf);
  var row = record(item, hit, query, got);
  console.log(item.id + ' ' + got.buf.length + 'B ' + got.dim.w + 'x' + got.dim.h + ' ' + row.license + ' ' + row.photographer);
  return row;
}

function ffmpegReady() {
  return new Promise(function (resolve, reject) {
    execFile('ffmpeg', ['-version'], { windowsHide: true }, function (err) {
      if (err) reject(new Error('ffmpeg is required to fit collage JPEGs'));
      else resolve();
    });
  });
}

async function main() {
  await ffmpegReady();
  fs.mkdirSync(DIR, { recursive: true });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  var items = pool.allItems();
  if (items.length < 40 || items.length > 56) throw new Error('pool size ' + items.length);
  var seen = {};
  var rows = [];
  var pending = [];

  for (var s = 0; s < pool.searches.length; s++) {
    var search = pool.searches[s];
    var queries = [search.q].concat(search.fallback || []);
    var hits = [];
    for (var qi = 0; qi < queries.length && hits.length < search.items.length; qi++) {
      var more = await collectSafe(queries[qi], search.items.length - hits.length, seen, qi === 0 ? 2 : 1);
      hits = hits.concat(more);
    }
    for (var i = 0; i < search.items.length; i++) {
      if (!hits[i]) { pending.push(search.items[i]); continue; }
      var row = await fillItem(search.items[i], hits[i], search.q);
      if (row) rows.push(row);
      else pending.push(search.items[i]);
    }
  }

  var rescue = ['landscape photograph', 'city street people', 'flowers close up', 'architecture exterior', 'ocean waves', 'open book'];
  var ri = 0;
  while (pending.length && ri < rescue.length) {
    var batch = await collectSafe(rescue[ri], pending.length, seen, 2);
    var left = [];
    for (var p = 0; p < pending.length; p++) {
      if (!batch[p]) { left.push(pending[p]); continue; }
      var saved = await fillItem(pending[p], batch[p], rescue[ri]);
      if (saved) rows.push(saved);
      else left.push(pending[p]);
    }
    pending = left;
    ri++;
  }

  rows.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  var doc = { v: 1, photos: rows };
  fs.writeFileSync(OUT, JSON.stringify(doc));
  var bytes = rows.reduce(function (sum, row) {
    return sum + fs.statSync(path.join(ROOT, row.file)).size;
  }, 0);
  console.log('photos ' + rows.length + ' bytes ' + bytes + ' missing ' + pending.map(function (it) { return it.id; }).join(','));
  if (rows.length < 40 || bytes > 8 * 1024 * 1024) process.exit(1);
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
