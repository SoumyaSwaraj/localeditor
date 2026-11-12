/* LocalEditor: photo privacy. LE.privacy reads what a photo file reveals (EXIF, GPS, XMP, IPTC, PNG text, WebP
   chunks, ICC, embedded previews, Content Credentials, data after the image) and writes a clean copy without
   re-encoding the image data. Everything runs on this device; nothing is fetched.

   Every byte is untrusted: reads are bounds-checked, counts, offsets, recursion and inflated sizes are capped, and
   all strings come back as plain text (control and bidi characters removed). Callers must still insert them with
   textContent. Nothing here throws past inspect() / clean(); a damaged file gives a partial report with warnings. */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};

  var LIM = { str: 2000, show: 600, entries: 600, ifds: 24, items: 300, xmp: 1024 * 1024, inflate: 1024 * 1024, segs: 4096, chunks: 4096, thumb: 512 * 1024, list: 60 };
  var GROUPS = [
    ['where', 'Where'], ['when', 'When'], ['device', 'What took it'], ['extras', 'Hidden extras'], ['file', 'File facts']
  ];

  /* ---------- Bytes ---------- */
  function u16be(b, o) { return o >= 0 && o + 2 <= b.length ? (b[o] << 8) | b[o + 1] : -1; }
  function u32be(b, o) { return o >= 0 && o + 4 <= b.length ? b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) : -1; }
  function u32le(b, o) { return o >= 0 && o + 4 <= b.length ? b[o + 3] * 16777216 + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) : -1; }
  function u24le(b, o) { return o >= 0 && o + 3 <= b.length ? (b[o + 2] << 16) | (b[o + 1] << 8) | b[o] : -1; }
  function latin1(b, o, n) {
    var s = '';
    var end = Math.min(b.length, o + Math.min(n, LIM.str));
    for (var i = Math.max(0, o); i < end; i++) { if (!b[i]) break; s += String.fromCharCode(b[i]); }
    return s;
  }
  function fourcc(b, o) { return o >= 0 && o + 4 <= b.length ? String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) : ''; }
  var DEC = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null;
  function utf8(b, o, n) {
    o = Math.max(0, o); n = Math.max(0, Math.min(n, b.length - o));
    if (!DEC) return latin1(b, o, n);
    return DEC.decode(b.subarray(o, o + n));
  }
  function ucs2le(b, o, n) {
    var s = '';
    var end = Math.min(b.length, o + Math.min(n, LIM.str * 2));
    for (var i = Math.max(0, o); i + 1 < end; i += 2) { var c = b[i] | (b[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
    return s;
  }
  function startsWith(b, o, str) {
    if (o < 0 || o + str.length > b.length) return false;
    for (var i = 0; i < str.length; i++) if (b[o + i] !== str.charCodeAt(i)) return false;
    return true;
  }
  function indexOf(b, str, from, to) {
    var first = str.charCodeAt(0);
    to = Math.min(b.length - str.length, to == null ? b.length : to);
    for (var i = Math.max(0, from || 0); i <= to; i++) {
      if (b[i] !== first) continue;
      var ok = true;
      for (var j = 1; j < str.length; j++) if (b[i + j] !== str.charCodeAt(j)) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }
  /* Plain, safe display text: no control or bidi-override characters, trimmed, capped. */
  function text(s, max) {
    s = String(s == null ? '' : s);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    max = max || LIM.show;
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }
  function fmtBytes(n) {
    if (!(n >= 0)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function concat(parts) {
    var size = 0;
    parts.forEach(function (p) { size += p.length; });
    var out = new Uint8Array(size), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  var CRC = null;
  function crc32(bytes) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* zlib inflate through DecompressionStream, stopped at LIM.inflate bytes. Resolves null when unavailable. */
  function inflate(bytes, raw) {
    if (typeof DecompressionStream === 'undefined' || !bytes || !bytes.length) return Promise.resolve(null);
    var ds;
    try { ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate'); } catch (e) { return Promise.resolve(null); }
    var writer = ds.writable.getWriter();
    writer.write(bytes).catch(function () {});
    writer.close().catch(function () {});
    var reader = ds.readable.getReader();
    var parts = [], total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return concat(parts);
        total += r.value.length;
        if (total > LIM.inflate) {
          parts.push(r.value.subarray(0, Math.max(0, r.value.length - (total - LIM.inflate))));
          reader.cancel().catch(function () {});
          var out = concat(parts);
          out.truncated = true;
          return out;
        }
        parts.push(r.value);
        return pump();
      });
    }
    return pump().catch(function () { return parts.length ? concat(parts) : null; });
  }

  /* ---------- Report ---------- */
  function Report(meta) {
    this.name = text(meta.name || 'photo', 200);
    this.mime = text(meta.type || '', 60);
    this.bytes = meta.bytes || 0;
    this.container = 'unknown';
    this.format = 'Unknown';
    this.supported = false;
    this.items = [];
    this.warnings = [];
    this.notes = [];
    this.flags = {};
    this.gps = null;
    this.thumbnail = null;
    this.orientation = 1;
    this.width = 0;
    this.height = 0;
    this._raw = {};
  }
  Report.prototype.add = function (group, key, label, value, o) {
    o = o || {};
    value = text(value);
    if (!value || this.items.length >= LIM.items) return null;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.key === key) {
        if (it.value.split(' · ').indexOf(value) < 0) it.value = text(it.value + ' · ' + value);
        return it;
      }
    }
    var item = { group: group, key: key, label: label, value: value, cat: o.cat || group, sensitive: o.sensitive !== false };
    if (o.derived) item.derived = true;
    if (o.note) item.note = text(o.note);
    this.items.push(item);
    return item;
  };
  Report.prototype.warn = function (msg) { if (this.warnings.indexOf(msg) < 0 && this.warnings.length < 20) this.warnings.push(msg); };

  /* ---------- TIFF / EXIF ---------- */
  var TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
  function tiffReader(b) {
    if (!b || b.length < 8) return null;
    var le;
    if (b[0] === 0x49 && b[1] === 0x49) le = true;
    else if (b[0] === 0x4D && b[1] === 0x4D) le = false;
    else return null;
    var t = {
      b: b, le: le,
      u16: function (o) { if (o < 0 || o + 2 > b.length) return NaN; return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; },
      u32: function (o) { if (o < 0 || o + 4 > b.length) return NaN; return le ? b[o] + b[o + 1] * 256 + b[o + 2] * 65536 + b[o + 3] * 16777216 : b[o] * 16777216 + b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3]; }
    };
    if (t.u16(2) !== 42) return null;
    t.first = t.u32(4);
    t.seen = {};
    t.count = 0;
    return t;
  }
  function readIfd(t, off) {
    if (!(off >= 8) || off + 2 > t.b.length || t.seen[off] || t.count >= LIM.ifds) return null;
    t.seen[off] = 1;
    t.count++;
    var n = t.u16(off);
    n = Math.min(n, LIM.entries, Math.floor((t.b.length - off - 2) / 12));
    var entries = [];
    for (var i = 0; i < n; i++) {
      var e = off + 2 + i * 12;
      var type = t.u16(e + 2), count = t.u32(e + 4);
      var size = (TSIZE[type] || 1) * count;
      var at = size > 4 ? t.u32(e + 8) : e + 8;
      entries.push({ tag: t.u16(e), type: type, count: count, size: size, at: at, entry: e, ok: size >= 0 && at >= 0 && at + size <= t.b.length });
    }
    return { off: off, n: n, entries: entries, next: t.u32(off + 2 + n * 12) };
  }
  function tStr(t, e) { return e.ok ? latin1(t.b, e.at, e.count) : ''; }
  function tNum(t, e, i) {
    i = i || 0;
    if (!e.ok || i >= e.count) return NaN;
    var o = e.at + i * (TSIZE[e.type] || 1);
    if (e.type === 3) return t.u16(o);
    if (e.type === 8) { var s = t.u16(o); return s > 32767 ? s - 65536 : s; }
    if (e.type === 4) return t.u32(o);
    if (e.type === 9) { var v = t.u32(o); return v > 2147483647 ? v - 4294967296 : v; }
    if (e.type === 1 || e.type === 7) return t.b[o];
    if (e.type === 5 || e.type === 10) {
      var a = t.u32(o), d = t.u32(o + 4);
      if (e.type === 10) { if (a > 2147483647) a -= 4294967296; if (d > 2147483647) d -= 4294967296; }
      return d ? a / d : NaN;
    }
    return NaN;
  }
  function exifDate(s) {
    s = text(s, 40);
    var m = /^(\d{4})[:\-](\d\d)[:\-](\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?/.exec(s);
    if (!m) return s;
    if (m[1] === '0000' || (m[2] === '00' && m[3] === '00')) return '';
    return m[1] + '-' + m[2] + '-' + m[3] + (m[4] ? ' ' + m[4] + ':' + m[5] + (m[6] ? ':' + m[6] : '') : '');
  }
  function isoDate(s) {
    s = text(s, 60);
    var m = /^(\d{4})-(\d\d)(?:-(\d\d))?(?:T(\d\d):(\d\d)(?::(\d\d))?(?:\.\d+)?)?(Z|[+\-]\d\d:?\d\d)?/.exec(s);
    if (!m) return s;
    var out = m[1] + '-' + m[2] + (m[3] ? '-' + m[3] : '') + (m[4] ? ' ' + m[4] + ':' + m[5] + (m[6] ? ':' + m[6] : '') : '');
    if (m[7]) out += m[7] === 'Z' ? ' (UTC)' : ' (UTC' + m[7] + ')';
    return out;
  }
  function settingsLine(s) {
    var p = [];
    if (s.exposure > 0) p.push(s.exposure >= 1 ? (Math.round(s.exposure * 10) / 10) + ' s' : '1/' + Math.round(1 / s.exposure) + ' s');
    if (s.fnumber > 0) p.push('f/' + (Math.round(s.fnumber * 10) / 10));
    if (s.iso > 0) p.push('ISO ' + s.iso);
    if (s.focal > 0) p.push((Math.round(s.focal * 10) / 10) + ' mm');
    return p.join(' · ');
  }
  function userComment(t, e) {
    if (!e.ok || e.count < 8) return '';
    var code = latin1(t.b, e.at, 8);
    if (/^UNICODE/.test(code)) {
      var s = '';
      for (var i = e.at + 8; i + 1 < e.at + Math.min(e.count, LIM.str * 2); i += 2) {
        var c = t.le ? t.b[i] | (t.b[i + 1] << 8) : (t.b[i] << 8) | t.b[i + 1];
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s;
    }
    if (/^ASCII/.test(code) || !t.b[e.at]) return latin1(t.b, e.at + 8, e.count - 8);
    return '';
  }

  var IFD0_TAGS = {
    0x010E: ['extras', 'exif.description', 'Caption', 'note'],
    0x010F: ['device', 'exif.make', 'Make', 'device'],
    0x0110: ['device', 'exif.model', 'Model', 'device'],
    0x0131: ['device', 'exif.software', 'Software', 'history'],
    0x0132: ['when', 'exif.modified', 'Last changed', 'time', 'date'],
    0x013B: ['extras', 'exif.artist', 'Author', 'people'],
    0x013C: ['device', 'exif.host', 'Computer', 'device'],
    0x8298: ['extras', 'exif.copyright', 'Copyright', 'people'],
    0x9C9B: ['extras', 'exif.xptitle', 'Title', 'note', 'ucs2'],
    0x9C9C: ['extras', 'exif.xpcomment', 'Comment', 'note', 'ucs2'],
    0x9C9D: ['extras', 'exif.xpauthor', 'Author', 'people', 'ucs2'],
    0x9C9E: ['extras', 'exif.xpkeywords', 'Keywords', 'note', 'ucs2'],
    0x9C9F: ['extras', 'exif.xpsubject', 'Subject', 'note', 'ucs2']
  };
  var EXIF_TAGS = {
    0x9003: ['when', 'exif.taken', 'Taken', 'time', 'date'],
    0x9004: ['when', 'exif.digitized', 'Digitised', 'time', 'date'],
    0xA430: ['device', 'exif.owner', 'Owner name', 'people'],
    0xA431: ['device', 'exif.serial', 'Camera serial number', 'device'],
    0xA433: ['device', 'exif.lensMake', 'Lens make', 'device'],
    0xA434: ['device', 'exif.lens', 'Lens', 'device'],
    0xA435: ['device', 'exif.lensSerial', 'Lens serial number', 'device'],
    0xA420: ['extras', 'exif.uid', 'Unique image ID', 'id']
  };

  /* Reads a TIFF/EXIF block (b holds the whole TIFF, from its byte-order mark). */
  function readExif(b, rep, where) {
    var t = tiffReader(b);
    if (!t) { rep.warn('The EXIF block is damaged and could not be read.'); return; }
    rep.flags.exif = true;
    rep._exifSeen = (rep._exifSeen || 0) + 1;
    var ifd0 = readIfd(t, t.first);
    if (!ifd0) { rep.warn('The EXIF block is damaged and could not be read.'); return; }
    var settings = {};
    var tz = {};
    function take(map, e) {
      var spec = map[e.tag];
      if (!spec) return false;
      var v = spec[4] === 'ucs2' ? (e.ok ? ucs2le(t.b, e.at, e.count) : '') : tStr(t, e);
      if (spec[4] === 'date') { rep._raw[spec[1]] = text(v, 40); v = exifDate(v); }
      rep.add(spec[0], spec[1], spec[2], v, { cat: spec[3] });
      return true;
    }
    ifd0.entries.forEach(function (e) {
      if (take(IFD0_TAGS, e)) return;
      if (e.tag === 0x0112) { var o = tNum(t, e); if (o >= 1 && o <= 8) rep.orientation = o; }
      else if (e.tag === 0x8769) readSub(tNum(t, e));
      else if (e.tag === 0x8825) readGps(t, tNum(t, e), rep);
    });
    function readSub(off) {
      var ifd = readIfd(t, off);
      if (!ifd) return;
      ifd.entries.forEach(function (e) {
        if (take(EXIF_TAGS, e)) return;
        if (e.tag === 0x829A) settings.exposure = tNum(t, e);
        else if (e.tag === 0x829D) settings.fnumber = tNum(t, e);
        else if (e.tag === 0x8827) settings.iso = tNum(t, e);
        else if (e.tag === 0x920A) settings.focal = tNum(t, e);
        else if (e.tag === 0x9010) tz.any = tStr(t, e);
        else if (e.tag === 0x9011) tz.original = tStr(t, e);
        else if (e.tag === 0x9012) tz.digitized = tStr(t, e);
        else if (e.tag === 0xA002) rep._raw.pixelW = tNum(t, e);
        else if (e.tag === 0xA003) rep._raw.pixelH = tNum(t, e);
        else if (e.tag === 0x927C) {
          rep.flags.makerNote = true;
          var brand = e.ok ? latin1(t.b, e.at, 12).replace(/[^\w ]/g, '').trim() : '';
          rep.add('extras', 'exif.makernote', 'Maker notes', fmtBytes(e.size) + ' of camera-specific data' + (brand ? ' (' + brand + ')' : ''), { cat: 'device', note: 'Can include serial numbers and settings. Removed by the clean copy.' });
        } else if (e.tag === 0x9286) rep.add('extras', 'exif.comment', 'Comment', userComment(t, e), { cat: 'note' });
      });
    }
    var tzv = text(tz.original || tz.any || tz.digitized || '', 12);
    if (/^[+\-]\d\d:\d\d$/.test(tzv)) { rep._raw.tz = tzv; rep.add('when', 'exif.tz', 'Time zone', 'UTC' + tzv, { cat: 'time' }); }
    var line = settingsLine(settings);
    if (line) rep.add('device', 'exif.settings', 'Camera settings', line, { cat: 'device', sensitive: false });
    /* IFD1: the embedded preview. */
    var ifd1 = readIfd(t, ifd0.next);
    if (ifd1) {
      var off = NaN, len = NaN;
      ifd1.entries.forEach(function (e) {
        if (e.tag === 0x0201) off = tNum(t, e);
        else if (e.tag === 0x0202) len = tNum(t, e);
      });
      if (off > 0 && len > 0 && len <= LIM.thumb && off + len <= t.b.length && t.b[off] === 0xFF && t.b[off + 1] === 0xD8) {
        setThumb(rep, t.b.slice(off, off + len), 'EXIF preview' + (where ? ' (' + where + ')' : ''));
      }
    }
  }
  function setThumb(rep, bytes, source) {
    if (rep.thumbnail) return;
    var dim = jpegSize(bytes);
    rep.thumbnail = { bytes: bytes, type: 'image/jpeg', width: dim.w, height: dim.h, source: source };
    rep.flags.thumbnail = true;
    rep.add('extras', 'thumbnail', 'Hidden preview', (dim.w ? dim.w + ' × ' + dim.h + ' ' : '') + 'JPEG preview, ' + fmtBytes(bytes.length), { cat: 'preview', note: 'A small copy of the photo stored inside the file. It can still show what was cropped or edited out.' });
  }
  function dms(t, e) {
    var a = tNum(t, e, 0), b = tNum(t, e, 1), c = tNum(t, e, 2);
    if (!isFinite(a)) return NaN;
    return a + (isFinite(b) ? b / 60 : 0) + (isFinite(c) ? c / 3600 : 0);
  }
  var COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  function compass(deg) { return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }
  function fmtCoord(lat, lon) {
    return Math.abs(lat).toFixed(5) + '° ' + (lat < 0 ? 'S' : 'N') + ', ' + Math.abs(lon).toFixed(5) + '° ' + (lon < 0 ? 'W' : 'E');
  }
  function setPosition(rep, lat, lon, key, label) {
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    if (lat === 0 && lon === 0) {
      rep.add('where', key, label, '0°, 0° (a blank placeholder, not a real place)', { cat: 'other', sensitive: false });
      return;
    }
    rep.add('where', key, label, fmtCoord(lat, lon), { cat: 'location', note: 'Precise enough to find a street or a house.' });
    if (!rep.gps) {
      rep.gps = { lat: lat, lon: lon };
      var reg = region(lat, lon);
      rep.add('where', 'gps.region', 'Roughly', reg.text, { cat: 'location', derived: true });
    }
  }
  function readGps(t, off, rep) {
    var ifd = readIfd(t, off);
    if (!ifd) return;
    rep._raw.gpsIfd = off;
    var g = {};
    ifd.entries.forEach(function (e) {
      switch (e.tag) {
        case 1: g.latRef = tStr(t, e); break;
        case 2: g.lat = dms(t, e); break;
        case 3: g.lonRef = tStr(t, e); break;
        case 4: g.lon = dms(t, e); break;
        case 5: g.altRef = tNum(t, e); break;
        case 6: g.alt = tNum(t, e); break;
        case 7: g.time = [tNum(t, e, 0), tNum(t, e, 1), tNum(t, e, 2)]; break;
        case 0x0C: g.speedRef = tStr(t, e); break;
        case 0x0D: g.speed = tNum(t, e); break;
        case 0x10: g.dirRef = tStr(t, e); break;
        case 0x11: g.dir = tNum(t, e); break;
        case 0x1B: g.method = e.ok ? latin1(t.b, e.at + (startsWith(t.b, e.at, 'ASCII') ? 8 : 0), e.count) : ''; break;
        case 0x1D: g.date = tStr(t, e); break;
        case 0x1F: g.err = tNum(t, e); break;
        default: break;
      }
    });
    if (isFinite(g.lat) && isFinite(g.lon)) {
      var lat = /S/i.test(g.latRef || '') ? -g.lat : g.lat;
      var lon = /W/i.test(g.lonRef || '') ? -g.lon : g.lon;
      rep.flags.gps = true;
      setPosition(rep, lat, lon, 'gps.position', 'Coordinates');
      if (rep.gps && rep.gps.lat === lat) {
        if (isFinite(g.alt)) rep.gps.alt = g.altRef === 1 ? -g.alt : g.alt;
        if (isFinite(g.dir)) rep.gps.dir = g.dir;
      }
    }
    if (isFinite(g.alt)) {
      var alt = Math.round(g.alt * 10) / 10;
      rep.add('where', 'gps.altitude', 'Altitude', alt + ' m ' + (g.altRef === 1 ? 'below' : 'above') + ' sea level', { cat: 'location' });
      rep.flags.gps = true;
    }
    if (isFinite(g.dir)) {
      rep.add('where', 'gps.direction', 'Facing', (Math.round(g.dir * 10) / 10) + '° (' + compass(g.dir) + ')', { cat: 'location' });
      rep.flags.gps = true;
    }
    if (isFinite(g.speed) && g.speed > 0) {
      var unit = /M/i.test(g.speedRef || '') ? 'mph' : /N/i.test(g.speedRef || '') ? 'knots' : 'km/h';
      rep.add('where', 'gps.speed', 'Moving at', (Math.round(g.speed * 10) / 10) + ' ' + unit, { cat: 'location' });
    }
    if (isFinite(g.err) && g.err > 0) rep.add('where', 'gps.accuracy', 'Accuracy', '± ' + (Math.round(g.err * 10) / 10) + ' m', { cat: 'location' });
    var method = text(g.method || '', 40);
    if (method) rep.add('where', 'gps.method', 'Location source', method, { cat: 'location' });
    if (g.date || (g.time && isFinite(g.time[0]))) {
      var d = exifDate(g.date || '');
      var tm = g.time && isFinite(g.time[0]) ? [g.time[0], g.time[1], Math.floor(g.time[2] || 0)].map(function (n) { n = Math.floor(n || 0); return (n < 10 ? '0' : '') + n; }).join(':') : '';
      var v = (d + ' ' + tm).trim();
      if (v) rep.add('when', 'gps.time', 'Satellite time', v + ' UTC', { cat: 'time' });
    }
  }

  /* ---------- XMP ---------- */
  var NS = {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    dc: 'http://purl.org/dc/elements/1.1/',
    xmp: 'http://ns.adobe.com/xap/1.0/',
    xmpMM: 'http://ns.adobe.com/xap/1.0/mm/',
    stEvt: 'http://ns.adobe.com/xap/1.0/sType/ResourceEvent#',
    photoshop: 'http://ns.adobe.com/photoshop/1.0/',
    exif: 'http://ns.adobe.com/exif/1.0/',
    exifEX: 'http://cipa.jp/exif/1.0/',
    tiff: 'http://ns.adobe.com/tiff/1.0/',
    aux: 'http://ns.adobe.com/exif/1.0/aux/',
    core: 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/',
    ext: 'http://iptc.org/std/Iptc4xmpExt/2008-02-29/',
    mwg: 'http://www.metadataworkinggroup.com/schemas/regions/',
    mpreg: 'http://ns.microsoft.com/photo/1.2/t/Region#',
    gcam: 'http://ns.google.com/photos/1.0/camera/'
  };
  function xmlVals(doc, ns, local) {
    var out = [];
    var all = doc.getElementsByTagName('*');
    for (var i = 0; i < all.length && i < 5000 && out.length < LIM.list; i++) {
      var a = all[i].getAttributeNS(ns, local);
      if (a) out.push(a);
    }
    var els = doc.getElementsByTagNameNS(ns, local);
    for (var j = 0; j < els.length && out.length < LIM.list; j++) {
      var el = els[j];
      var lis = el.getElementsByTagNameNS(NS.rdf, 'li');
      if (lis.length) {
        var alt = el.getElementsByTagNameNS(NS.rdf, 'Alt').length;
        for (var k = 0; k < lis.length && out.length < LIM.list; k++) {
          if (lis[k].children && lis[k].children.length) continue;
          out.push(lis[k].textContent);
          if (alt) break;
        }
      } else if (!(el.children && el.children.length)) out.push(el.textContent);
    }
    return out.map(function (s) { return text(s, 300); }).filter(Boolean);
  }
  function xmpGps(s) {
    var m = /^\s*(\d{1,3})(?:,(\d{1,2}(?:\.\d+)?))?(?:,(\d{1,2}(?:\.\d+)?))?\s*([NSEW])\s*$/i.exec(s || '');
    if (!m) return NaN;
    var v = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0) + (m[3] ? Number(m[3]) / 3600 : 0);
    return /[SW]/i.test(m[4]) ? -v : v;
  }
  var XMP_FIELDS = [
    ['dc', 'creator', 'extras', 'xmp.creator', 'Author', 'people'],
    ['dc', 'rights', 'extras', 'xmp.rights', 'Copyright', 'people'],
    ['dc', 'description', 'extras', 'xmp.description', 'Caption', 'note'],
    ['dc', 'title', 'extras', 'xmp.title', 'Title', 'note'],
    ['dc', 'subject', 'extras', 'xmp.keywords', 'Keywords', 'note', ', '],
    ['photoshop', 'City', 'where', 'xmp.city', 'City', 'location'],
    ['photoshop', 'State', 'where', 'xmp.state', 'Region', 'location'],
    ['photoshop', 'Country', 'where', 'xmp.country', 'Country', 'location'],
    ['core', 'Location', 'where', 'xmp.sublocation', 'Place', 'location'],
    ['core', 'CountryCode', 'where', 'xmp.countryCode', 'Country code', 'location'],
    ['xmp', 'CreatorTool', 'device', 'xmp.tool', 'Made with', 'history'],
    ['xmp', 'CreateDate', 'when', 'xmp.created', 'Created', 'time', null, 'iso'],
    ['xmp', 'ModifyDate', 'when', 'xmp.modified', 'Modified', 'time', null, 'iso'],
    ['photoshop', 'DateCreated', 'when', 'xmp.dateCreated', 'Date created', 'time', null, 'iso'],
    ['exif', 'DateTimeOriginal', 'when', 'xmp.taken', 'Taken', 'time', null, 'iso'],
    ['tiff', 'Make', 'device', 'xmp.make', 'Make', 'device'],
    ['tiff', 'Model', 'device', 'xmp.model', 'Model', 'device'],
    ['aux', 'SerialNumber', 'device', 'xmp.serial', 'Camera serial number', 'device'],
    ['exifEX', 'BodySerialNumber', 'device', 'xmp.serial', 'Camera serial number', 'device'],
    ['aux', 'Lens', 'device', 'xmp.lens', 'Lens', 'device'],
    ['exifEX', 'LensModel', 'device', 'xmp.lens', 'Lens', 'device'],
    ['aux', 'OwnerName', 'device', 'xmp.owner', 'Owner name', 'people'],
    ['exifEX', 'CameraOwnerName', 'device', 'xmp.owner', 'Owner name', 'people'],
    ['photoshop', 'Credit', 'extras', 'xmp.credit', 'Credit', 'people'],
    ['photoshop', 'AuthorsPosition', 'extras', 'xmp.position', 'Author’s job title', 'people']
  ];
  var XMP_LOCATION = /GPSLatitude|GPSLongitude|photoshop:(City|State|Country)\b|Iptc4xmpCore:(Location|CountryCode)\b|LocationShown|LocationCreated|exif:GPS/;
  function readXmp(xml, rep, source) {
    rep.flags.xmp = true;
    if (!xml) return;
    if (xml.length > LIM.xmp) { rep.warn('The XMP block is very large; only its start was read.'); xml = xml.slice(0, LIM.xmp); }
    if (XMP_LOCATION.test(xml)) rep._xmpLocation = true;
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
      rep.warn('The XMP block declares entities, so it was not opened.');
      rep.add('extras', 'xmp.unreadable', 'XMP data', 'Present, but not readable here', { cat: 'other' });
      return;
    }
    var a = xml.indexOf('<x:xmpmeta'), z = xml.lastIndexOf('</x:xmpmeta>');
    if (a < 0) { a = xml.indexOf('<rdf:RDF'); z = xml.lastIndexOf('</rdf:RDF>'); if (z >= 0) z += 10; }
    else z = z >= 0 ? z + 12 : -1;
    if (a >= 0 && z > a) xml = xml.slice(a, z);
    if (typeof DOMParser === 'undefined') { rep.add('extras', 'xmp.unreadable', 'XMP data', 'Present', { cat: 'other' }); return; }
    var doc;
    try { doc = new DOMParser().parseFromString(xml, 'application/xml'); } catch (e) { doc = null; }
    if (!doc || doc.getElementsByTagName('parsererror').length) {
      rep.warn('The XMP block is damaged.');
      rep.add('extras', 'xmp.unreadable', 'XMP data', 'Present, but damaged', { cat: 'other' });
      return;
    }
    XMP_FIELDS.forEach(function (f) {
      var vals = xmlVals(doc, NS[f[0]], f[1]);
      if (!vals.length) return;
      if (f[7] === 'iso') vals = vals.map(isoDate);
      if (f[3] === 'xmp.created' || f[3] === 'xmp.taken' || f[3] === 'xmp.dateCreated') rep._raw.xmpDate = rep._raw.xmpDate || vals[0];
      rep.add(f[2], f[3], f[4], vals.join(f[6] || ' · '), { cat: f[5] });
    });
    var la = xmlVals(doc, NS.exif, 'GPSLatitude')[0], lo = xmlVals(doc, NS.exif, 'GPSLongitude')[0];
    if (la && lo) { rep.flags.gps = true; setPosition(rep, xmpGps(la), xmpGps(lo), 'xmp.gps', 'Coordinates (XMP)'); }
    /* People: face regions and tags. */
    var people = xmlVals(doc, NS.mwg, 'Name').concat(xmlVals(doc, NS.mpreg, 'PersonDisplayName'), xmlVals(doc, NS.ext, 'PersonInImage'));
    var seen = {};
    people = people.filter(function (p) { if (seen[p]) return false; seen[p] = 1; return true; });
    if (people.length) rep.add('extras', 'xmp.people', 'People tagged', people.join(', '), { cat: 'people' });
    var regions = doc.getElementsByTagNameNS(NS.mwg, 'Area').length;
    if (regions && !people.length) rep.add('extras', 'xmp.faces', 'Face areas', regions + ' marked', { cat: 'people' });
    /* Contact details of the author. */
    var contact = ['CiEmailWork', 'CiTelWork', 'CiUrlWork', 'CiAdrExtadr', 'CiAdrCity', 'CiAdrRegion', 'CiAdrPcode', 'CiAdrCtry'].reduce(function (acc, k) { return acc.concat(xmlVals(doc, NS.core, k)); }, []);
    if (contact.length) rep.add('extras', 'xmp.contact', 'Author contact details', contact.join(', '), { cat: 'people' });
    /* Edit history. */
    var hist = doc.getElementsByTagNameNS(NS.xmpMM, 'History');
    if (hist.length) {
      var steps = hist[0].getElementsByTagNameNS(NS.rdf, 'li').length;
      var agents = xmlVals(doc, NS.stEvt, 'softwareAgent');
      var uniq = agents.filter(function (x, i) { return agents.indexOf(x) === i; });
      if (steps || uniq.length) rep.add('extras', 'xmp.history', 'Edit history', (steps || uniq.length) + ' recorded step' + ((steps || uniq.length) === 1 ? '' : 's') + (uniq.length ? ' (' + uniq.slice(0, 4).join(', ') + ')' : ''), { cat: 'history' });
    }
    var ids = xmlVals(doc, NS.xmpMM, 'DocumentID').concat(xmlVals(doc, NS.xmpMM, 'OriginalDocumentID'), xmlVals(doc, NS.xmpMM, 'InstanceID'));
    if (ids.length) rep.add('extras', 'xmp.ids', 'Document IDs', ids.length + ' identifier' + (ids.length === 1 ? '' : 's') + ' that can link copies of this file', { cat: 'id' });
    var motion = xmlVals(doc, NS.gcam, 'MotionPhoto')[0];
    if (motion === '1' || /MicroVideo|MotionPhoto="1"/.test(xml)) { rep.flags.motion = true; rep.add('extras', 'xmp.motion', 'Motion Photo', 'A short video is attached to this photo', { cat: 'extra' }); }
  }

  /* ---------- IPTC (Photoshop APP13) ---------- */
  var IIM = {
    5: ['extras', 'iptc.title', 'Title', 'note'], 25: ['extras', 'iptc.keywords', 'Keywords', 'note'],
    80: ['extras', 'iptc.byline', 'Author', 'people'], 85: ['extras', 'iptc.bylineTitle', 'Author’s job title', 'people'],
    90: ['where', 'iptc.city', 'City', 'location'], 92: ['where', 'iptc.sublocation', 'Place', 'location'],
    95: ['where', 'iptc.state', 'Region', 'location'], 101: ['where', 'iptc.country', 'Country', 'location'],
    100: ['where', 'iptc.countryCode', 'Country code', 'location'],
    105: ['extras', 'iptc.headline', 'Headline', 'note'], 110: ['extras', 'iptc.credit', 'Credit', 'people'],
    116: ['extras', 'iptc.copyright', 'Copyright', 'people'], 118: ['extras', 'iptc.contact', 'Contact', 'people'],
    120: ['extras', 'iptc.caption', 'Caption', 'note'], 122: ['extras', 'iptc.writer', 'Caption writer', 'people'],
    40: ['extras', 'iptc.instructions', 'Instructions', 'note'], 103: ['extras', 'iptc.reference', 'Job reference', 'id']
  };
  function readIrb(b, rep) {
    var o = 0, guard = 0;
    while (o + 12 <= b.length && guard++ < 512) {
      if (!startsWith(b, o, '8BIM')) break;
      var id = u16be(b, o + 4);
      var nameLen = b[o + 6];
      var p = o + 6 + 1 + nameLen;
      if ((1 + nameLen) % 2) p++;
      var size = u32be(b, p);
      if (size < 0 || p + 4 + size > b.length) { rep.warn('The IPTC block is damaged.'); break; }
      var data = b.subarray(p + 4, p + 4 + size);
      if (id === 0x0404) readIim(data, rep);
      else if ((id === 0x040C || id === 0x0409) && size > 28 && data[28] === 0xFF && data[29] === 0xD8 && size - 28 <= LIM.thumb) setThumb(rep, data.slice(28), 'Photoshop preview');
      o = p + 4 + size + (size % 2);
    }
  }
  function readIim(b, rep) {
    rep.flags.iptc = true;
    var o = 0, guard = 0, date = '', time = '';
    while (o + 5 <= b.length && guard++ < 2000) {
      if (b[o] !== 0x1C) break;
      var rec = b[o + 1], ds = b[o + 2], size = u16be(b, o + 3);
      if (size & 0x8000) break;
      var start = o + 5;
      if (start + size > b.length) { rep.warn('The IPTC block is damaged.'); break; }
      if (rec === 2) {
        var v = utf8(b, start, Math.min(size, LIM.str));
        if (IIM[ds]) { var s = IIM[ds]; rep.add(s[0], s[1], s[2], v, { cat: s[3] }); if (s[0] === 'where') rep._iptcLocation = true; }
        else if (ds === 55) date = v;
        else if (ds === 60) time = v;
      }
      o = start + size;
    }
    if (date) {
      var d = /^(\d{4})(\d\d)(\d\d)$/.exec(date);
      var tm = /^(\d\d)(\d\d)(\d\d)/.exec(time || '');
      rep.add('when', 'iptc.date', 'Date created', (d ? d[1] + '-' + d[2] + '-' + d[3] : date) + (tm ? ' ' + tm[1] + ':' + tm[2] + ':' + tm[3] : ''), { cat: 'time' });
    }
  }

  /* ---------- ICC ---------- */
  function iccName(b) {
    if (!b || b.length < 132) return '';
    var n = Math.min(u32be(b, 128), 100);
    for (var i = 0; i < n; i++) {
      var e = 132 + i * 12;
      if (fourcc(b, e) !== 'desc') continue;
      var off = u32be(b, e + 4), size = u32be(b, e + 8);
      if (off < 0 || off + Math.min(size, 12) > b.length) return '';
      var type = fourcc(b, off);
      if (type === 'desc') return latin1(b, off + 12, Math.min(u32be(b, off + 8), 200));
      if (type === 'mluc') {
        var recs = u32be(b, off + 8);
        if (recs < 1) return '';
        var len = u32be(b, off + 20), at = u32be(b, off + 24);
        var s = '';
        for (var j = off + at; j + 1 < Math.min(b.length, off + at + Math.min(len, 400)); j += 2) { var c = (b[j] << 8) | b[j + 1]; if (!c) break; s += String.fromCharCode(c); }
        return s;
      }
      return '';
    }
    return '';
  }
  function addIcc(rep, b) {
    rep.flags.icc = true;
    var name = text(iccName(b), 80);
    rep.add('extras', 'icc', 'Colour profile', (name || 'Embedded') + (b ? ' · ' + fmtBytes(b.length) : ''), { cat: 'other', sensitive: false, note: 'Describes the colours. Harmless; kept by default so colours stay right.' });
  }

  /* ---------- JPEG ---------- */
  function jpegSize(b) {
    var o = 2, guard = 0;
    if (u16be(b, 0) !== 0xFFD8) return { w: 0, h: 0 };
    while (o + 9 < b.length && guard++ < LIM.segs) {
      if (b[o] !== 0xFF) return { w: 0, h: 0 };
      var m = b[o + 1];
      if (m === 0xFF) { o++; continue; }
      if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { o += 2; continue; }
      var len = u16be(b, o + 2);
      if (len < 2) return { w: 0, h: 0 };
      if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { w: u16be(b, o + 7), h: u16be(b, o + 5), progressive: m === 0xC2 };
      if (m === 0xDA || m === 0xD9) break;
      o += 2 + len;
    }
    return { w: 0, h: 0 };
  }
  var APP_NAMES = { 0xE1: 'APP1', 0xE2: 'APP2', 0xE3: 'APP3', 0xE4: 'APP4', 0xE5: 'APP5', 0xE6: 'APP6', 0xE7: 'APP7', 0xE8: 'APP8', 0xE9: 'APP9', 0xEA: 'APP10', 0xEB: 'APP11', 0xEC: 'APP12', 0xED: 'APP13', 0xEF: 'APP15' };
  function parseJpeg(b, rep) {
    rep.container = 'jpeg'; rep.format = 'JPEG'; rep.supported = true;
    var segs = [{ kind: 'soi', start: 0, end: 2 }];
    var o = 2, guard = 0, iccParts = [], other = {}, xmpExt = 0, scan = false, sawEoi = false;
    while (o < b.length && guard++ < LIM.segs * 4) {
      if (scan) {
        /* Entropy-coded data: runs to the next marker that is not a stuffed byte, a restart marker or fill. */
        var q = o;
        while (q + 1 < b.length) {
          if (b[q] === 0xFF) { var nx = b[q + 1]; if (nx !== 0 && nx !== 0xFF && !(nx >= 0xD0 && nx <= 0xD7)) break; }
          q++;
        }
        if (q + 1 >= b.length) { o = b.length; break; }
        segs[segs.length - 1].end = q; scan = false; o = q;
      }
      if (b[o] !== 0xFF) { rep.warn('The file is damaged after ' + fmtBytes(o) + '.'); break; }
      var m = b[o + 1];
      if (m === undefined) break;
      if (m === 0xFF) { o++; continue; }
      if (m === 0xD9) { segs.push({ kind: 'eoi', start: o, end: o + 2 }); o += 2; sawEoi = true; break; }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xD8) { segs.push({ kind: 'mark', start: o, end: o + 2 }); o += 2; continue; }
      var len = u16be(b, o + 2);
      if (len < 2 || o + 2 + len > b.length) { rep.warn('The file is cut short or damaged.'); segs.push({ kind: 'broken', start: o, end: b.length }); o = b.length; break; }
      var p = o + 4, n = len - 2, end = o + 2 + len;
      var seg = { kind: 'struct', marker: m, start: o, end: end };
      if (m === 0xE0) seg.kind = startsWith(b, p, 'JFIF\0') ? 'jfif' : 'app-other';
      else if (m === 0xE1) {
        if (startsWith(b, p, 'Exif\0')) {
          seg.kind = 'exif'; seg.tiff = p + 6;
          if (!rep._exifSeg) { rep._exifSeg = seg; readExif(b.subarray(p + 6, end), rep, ''); }
        } else if (startsWith(b, p, 'http://ns.adobe.com/xap/1.0/\0')) {
          seg.kind = 'xmp';
          readXmp(utf8(b, p + 29, n - 29), rep, 'jpeg');
        } else if (startsWith(b, p, 'http://ns.adobe.com/xmp/extension/\0')) {
          seg.kind = 'xmp'; xmpExt += n;
          if (/GPS|City|Country|Location/.test(utf8(b, p, Math.min(n, 65535)))) rep._xmpLocation = true;
        } else seg.kind = 'app-other';
      } else if (m === 0xE2) {
        if (startsWith(b, p, 'ICC_PROFILE\0')) {
          seg.kind = 'icc';
          if (!iccParts.some(function (x) { return x.seq === b[p + 12]; })) iccParts.push({ seq: b[p + 12], data: b.subarray(p + 14, end) });
        }
        else if (startsWith(b, p, 'MPF\0')) { seg.kind = 'mpf'; rep.flags.mpf = true; readMpf(b.subarray(p + 4, end), rep); }
        else seg.kind = 'app-other';
      } else if (m === 0xEB) {
        seg.kind = indexOf(b, 'c2pa', p, end - 4) >= 0 || indexOf(b, 'jumb', p, end - 4) >= 0 ? 'c2pa' : 'app-other';
        if (seg.kind === 'c2pa') { rep.flags.c2pa = true; rep.add('extras', 'c2pa', 'Content Credentials', 'Present: a signed record of how the image was made or edited', { cat: 'history', note: 'Can name the creator and the apps used.' }); }
      } else if (m === 0xED) {
        seg.kind = 'iptc';
        if (startsWith(b, p, 'Photoshop 3.0\0')) readIrb(b.subarray(p + 14, end), rep);
      } else if (m === 0xEE) seg.kind = startsWith(b, p, 'Adobe') ? 'adobe' : 'app-other';
      else if (m === 0xFE) {
        seg.kind = 'com';
        rep.flags.comment = true;
        rep.add('extras', 'jpeg.comment', 'Comment', utf8(b, p, Math.min(n, LIM.str)), { cat: 'note' });
      } else if (m >= 0xE0 && m <= 0xEF) seg.kind = 'app-other';
      else if (m === 0xDA) { seg.kind = 'sos'; scan = true; }
      else if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { rep.height = u16be(b, p + 1); rep.width = u16be(b, p + 3); rep._progressive = m === 0xC2; }
      if (seg.kind === 'app-other') {
        var name = APP_NAMES[m] || 'APP0';
        var id = latin1(b, p, 12).replace(/[^\w .-]/g, '');
        if (!/^(Ducky)$/.test(id)) other[name + (id ? ' “' + text(id, 20) + '”' : '')] = (other[name + (id ? ' “' + text(id, 20) + '”' : '')] || 0) + n;
      }
      segs.push(seg);
      if (scan) { segs.push({ kind: 'scan', start: end, end: end }); }
      o = end;
    }
    if (scan) segs[segs.length - 1].end = b.length;
    if (iccParts.length) {
      iccParts.sort(function (x, y) { return x.seq - y.seq; });
      addIcc(rep, concat(iccParts.map(function (x) { return x.data; })));
    }
    if (xmpExt) rep.add('extras', 'xmp.extended', 'Extended XMP', fmtBytes(xmpExt) + ' of extra metadata', { cat: 'other' });
    Object.keys(other).slice(0, 8).forEach(function (k) {
      rep.add('extras', 'jpeg.other', 'Other hidden data', k + ' block, ' + fmtBytes(other[k]), { cat: 'other' });
    });
    var trailer = sawEoi ? b.length - o : 0;
    if (trailer > 0) {
      var tail = b.subarray(o);
      var zeros = true;
      for (var i = 0; i < Math.min(tail.length, 64); i++) if (tail[i]) { zeros = false; break; }
      if (!(zeros && tail.length <= 64)) {
        var video = indexOf(tail, 'ftyp', 0, Math.min(tail.length, 1 << 20)) >= 0;
        var image = tail[0] === 0xFF && tail[1] === 0xD8 || indexOf(tail, '\xFF\xD8\xFF', 0, 64) >= 0;
        rep.flags.trailer = true;
        rep.add('extras', 'jpeg.trailer', 'Data after the photo', fmtBytes(trailer) + (video ? ' — a short video (Motion Photo)' : image ? ' — more images (e.g. a depth map or second camera)' : ' of extra data'), { cat: 'extra' });
      }
    }
    if (!sawEoi && !rep.warnings.length) rep.warn('The photo ends early; it may be cut short.');
    rep._segs = segs;
    rep._eoi = o;
    if (!rep.width) { var d = jpegSize(b); rep.width = d.w; rep.height = d.h; }
  }
  function readMpf(b, rep) {
    var t = tiffReader(b);
    if (!t) return;
    var ifd = readIfd(t, t.first);
    if (!ifd) return;
    ifd.entries.forEach(function (e) { if (e.tag === 0xB001) rep._mpfImages = tNum(t, e); });
    if (rep._mpfImages > 1) rep.add('extras', 'jpeg.mpf', 'Extra images', (rep._mpfImages - 1) + ' more image' + (rep._mpfImages > 2 ? 's' : '') + ' stored with this one', { cat: 'extra' });
  }

  /* ---------- PNG ---------- */
  var PNG_KEEP = { IHDR: 1, PLTE: 1, IDAT: 1, IEND: 1, tRNS: 1, gAMA: 1, cHRM: 1, sRGB: 1, sBIT: 1, bKGD: 1, hIST: 1, pHYs: 1, sPLT: 1, acTL: 1, fcTL: 1, fdAT: 1, cICP: 1, mDCv: 1, cLLi: 1, iCCP: 1 };
  var PNG_TEXT = {
    title: ['extras', 'Title', 'note'], author: ['extras', 'Author', 'people'], description: ['extras', 'Description', 'note'],
    copyright: ['extras', 'Copyright', 'people'], 'creation time': ['when', 'Created', 'time'], software: ['device', 'Made with', 'history'],
    disclaimer: ['extras', 'Disclaimer', 'note'], warning: ['extras', 'Warning', 'note'], source: ['device', 'Source device', 'device'],
    comment: ['extras', 'Comment', 'note'], parameters: ['extras', 'AI generation settings', 'history'], prompt: ['extras', 'AI generation settings', 'history'],
    workflow: ['extras', 'AI generation settings', 'history'], dream: ['extras', 'AI generation settings', 'history'], 'sd-metadata': ['extras', 'AI generation settings', 'history']
  };
  function pngText(rep, keyword, value) {
    var k = text(keyword, 79);
    var lk = k.toLowerCase();
    if (lk === 'xml:com.adobe.xmp') { readXmp(value, rep, 'png'); return; }
    if (/^raw profile type (exif|app1)$/.test(lk)) {
      var hex = String(value || '').split('\n').slice(3).join('').replace(/[^0-9a-f]/gi, '');
      var bytes = new Uint8Array(Math.min(hex.length >> 1, 1 << 20));
      for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      var at = startsWith(bytes, 0, 'Exif\0\0') ? 6 : 0;
      readExif(bytes.subarray(at), rep, 'PNG text');
      return;
    }
    if (/^raw profile type /.test(lk)) { rep.add('extras', 'png.raw', 'Embedded profile', k.slice(17), { cat: 'other' }); return; }
    if (/^date:/.test(lk)) { rep.add('when', 'png.' + lk.replace(/[^a-z]/g, ''), 'File date (' + k.slice(5) + ')', isoDate(value), { cat: 'time' }); return; }
    var spec = PNG_TEXT[lk];
    if (spec) rep.add(spec[0], 'png.' + lk.replace(/[^a-z]/g, ''), spec[1], spec[2] === 'time' ? isoDate(value) : value, { cat: spec[2] });
    else rep.add('extras', 'png.text.' + lk.replace(/[^a-z0-9]/g, '').slice(0, 30), 'Text note “' + k + '”', value, { cat: 'note' });
  }
  function parsePng(b, rep) {
    rep.container = 'png'; rep.format = 'PNG'; rep.supported = true;
    var chunks = [], o = 8, guard = 0, jobs = [], other = [];
    while (o + 12 <= b.length && guard++ < LIM.chunks) {
      var len = u32be(b, o), type = fourcc(b, o + 4);
      if (len < 0 || len > 0x7FFFFFFF || o + 12 + len > b.length || !/^[A-Za-z]{4}$/.test(type)) { rep.warn('The file is cut short or damaged.'); break; }
      var d = b.subarray(o + 8, o + 8 + len);
      chunks.push({ type: type, start: o, end: o + 12 + len });
      if (type === 'IHDR') { rep.width = u32be(d, 0); rep.height = u32be(d, 4); rep._alpha = d[9] === 4 || d[9] === 6; }
      else if (type === 'tEXt') {
        rep.flags.text = true;
        var z = d.indexOf(0);
        if (z > 0) pngText(rep, latin1(d, 0, z), latin1(d, z + 1, len - z - 1).slice(0, LIM.str));
      } else if (type === 'zTXt') {
        rep.flags.text = true;
        (function (d) {
          var z = d.indexOf(0);
          if (z <= 0) return;
          var kw = latin1(d, 0, z);
          jobs.push(inflate(d.subarray(z + 2)).then(function (u) {
            if (u) pngText(rep, kw, latin1(u, 0, u.length));
            else rep.add('extras', 'png.text.' + kw.toLowerCase().replace(/[^a-z0-9]/g, ''), 'Text note “' + text(kw, 79) + '”', 'Compressed text (not readable here)', { cat: 'note' });
          }));
        })(d);
      } else if (type === 'iTXt') {
        rep.flags.text = true;
        (function (d) {
          var z = d.indexOf(0);
          if (z <= 0 || z + 3 > d.length) return;
          var kw = latin1(d, 0, z), comp = d[z + 1];
          var l1 = d.indexOf(0, z + 3); if (l1 < 0) return;
          var l2 = d.indexOf(0, l1 + 1); if (l2 < 0) return;
          var body = d.subarray(l2 + 1);
          if (comp === 1) jobs.push(inflate(body).then(function (u) { if (u) pngText(rep, kw, utf8(u, 0, u.length)); }));
          else pngText(rep, kw, utf8(body, 0, body.length));
        })(d);
      } else if (type === 'eXIf') readExif(d, rep, 'PNG');
      else if (type === 'iCCP') {
        (function (d) {
          var z = d.indexOf(0);
          jobs.push((z > 0 ? inflate(d.subarray(z + 2)) : Promise.resolve(null)).then(function (u) { addIcc(rep, u); }));
        })(d);
      } else if (type === 'tIME' && len >= 7) {
        var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
        rep.add('when', 'png.time', 'Last changed', u16be(d, 0) + '-' + p2(d[2]) + '-' + p2(d[3]) + ' ' + p2(d[4]) + ':' + p2(d[5]) + ':' + p2(d[6]) + ' UTC', { cat: 'time' });
      } else if (type === 'caBX') {
        rep.flags.c2pa = true;
        rep.add('extras', 'c2pa', 'Content Credentials', 'Present: a signed record of how the image was made or edited', { cat: 'history', note: 'Can name the creator and the apps used.' });
      } else if (!PNG_KEEP[type] && /^[a-z]/.test(type)) other.push(type);
      o += 12 + len;
      if (type === 'IEND') break;
    }
    if (other.length) rep.add('extras', 'png.other', 'Other hidden data', other.slice(0, 8).map(function (x) { return text(x, 4); }).join(', ') + ' chunk' + (other.length === 1 ? '' : 's'), { cat: 'other' });
    if (o < b.length && chunks.length && chunks[chunks.length - 1].type === 'IEND') {
      rep.flags.trailer = true;
      rep.add('extras', 'png.trailer', 'Data after the image', fmtBytes(b.length - o) + ' of extra data', { cat: 'extra' });
    }
    rep._chunks = chunks;
    return Promise.all(jobs);
  }

  /* ---------- WebP ---------- */
  function parseWebp(b, rep) {
    rep.container = 'webp'; rep.format = 'WebP'; rep.supported = true;
    var chunks = [], o = 12, guard = 0, other = [];
    var riffEnd = Math.min(b.length, 8 + u32le(b, 4));
    while (o + 8 <= riffEnd && guard++ < LIM.chunks) {
      var id = fourcc(b, o), size = u32le(b, o + 4);
      if (size < 0 || o + 8 + size > b.length) { rep.warn('The file is cut short or damaged.'); break; }
      var d = b.subarray(o + 8, o + 8 + size);
      var end = Math.min(b.length, o + 8 + size + (size & 1));
      chunks.push({ id: id, start: o, end: end });
      if (id === 'VP8X') { rep._vp8x = d[0]; rep.width = 1 + u24le(d, 4); rep.height = 1 + u24le(d, 7); }
      else if (id === 'VP8 ' && !rep.width) { rep.width = u16be([d[7], d[6]], 0) & 0x3FFF; rep.height = u16be([d[9], d[8]], 0) & 0x3FFF; }
      else if (id === 'VP8L' && !rep.width && size >= 5) { var bits = d[1] | (d[2] << 8) | (d[3] << 16) | (d[4] << 24); rep.width = (bits & 0x3FFF) + 1; rep.height = ((bits >> 14) & 0x3FFF) + 1; }
      else if (id === 'EXIF') readExif(startsWith(d, 0, 'Exif\0\0') ? d.subarray(6) : d, rep, 'WebP');
      else if (id === 'XMP ') readXmp(utf8(d, 0, d.length), rep, 'webp');
      else if (id === 'ICCP') addIcc(rep, d);
      else if (id === 'C2PA' || id === 'c2pa') { rep.flags.c2pa = true; rep.add('extras', 'c2pa', 'Content Credentials', 'Present: a signed record of how the image was made or edited', { cat: 'history' }); }
      else if (!/^(VP8 |VP8L|ALPH|ANIM|ANMF)$/.test(id)) other.push(id);
      o = end;
    }
    if (other.length) rep.add('extras', 'webp.other', 'Other hidden data', other.slice(0, 8).map(function (x) { return text(x, 4); }).join(', ') + ' chunk' + (other.length === 1 ? '' : 's'), { cat: 'other' });
    rep._chunks = chunks;
  }

  /* ---------- HEIC / AVIF / TIFF / others (best effort, read only) ---------- */
  function scanLoose(b, rep) {
    var at = indexOf(b, 'Exif\0\0', 0, Math.min(b.length, 8 << 20));
    if (at >= 0) readExif(b.subarray(at + 6), rep, '');
    var x = indexOf(b, '<x:xmpmeta', 0, Math.min(b.length, 8 << 20));
    if (x >= 0) {
      var z = indexOf(b, '</x:xmpmeta>', x, Math.min(b.length, x + LIM.xmp));
      if (z > x) readXmp(utf8(b, x, z + 12 - x), rep, 'loose');
    }
  }
  function detect(b, meta) {
    if (u16be(b, 0) === 0xFFD8) return 'jpeg';
    if (b.length >= 8 && b[0] === 0x89 && startsWith(b, 1, 'PNG\r\n\x1A\n')) return 'png';
    if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'webp';
    if (startsWith(b, 4, 'ftyp')) {
      var brands = latin1(b, 8, Math.min(32, u32be(b, 0) - 8));
      if (/avif|avis/.test(brands)) return 'avif';
      if (/hei[cmsx]|hev[cmsx]|mif1|msf1/.test(brands)) return 'heic';
      return 'video';
    }
    if (startsWith(b, 0, 'II*\0') || startsWith(b, 0, 'MM\0*')) return 'tiff';
    if (startsWith(b, 0, 'GIF8')) return 'gif';
    if (startsWith(b, 0, 'BM')) return 'bmp';
    return /heic|heif/i.test((meta && meta.type) || '') ? 'heic' : 'unknown';
  }
  var HONEST = {
    heic: ['HEIC', 'HEIC photos (the iPhone default) are read here on a best-effort basis. This page cannot remove details from a HEIC file without converting it.'],
    avif: ['AVIF', 'AVIF images are read here on a best-effort basis. This page cannot remove details from an AVIF file without converting it.'],
    tiff: ['TIFF', 'TIFF files are read here, but this page cannot write a clean TIFF. Convert it to JPEG or PNG first.'],
    gif: ['GIF', 'GIF files rarely carry camera details, and this page does not read GIF comments.'],
    bmp: ['BMP', 'BMP files have no room for camera or location details.'],
    video: ['Video', 'This looks like a video, not a photo. This page only checks photos.'],
    unknown: ['Unknown', 'This file type is not recognised as a photo.']
  };

  /* ---------- Region (offline, coarse) ---------- */
  /* Hand-simplified outlines [lon, lat, lon, lat, …] of the land masses, good to a degree or two. Used for the small
     map and to name a continent; never for anything precise. */
  var LAND = [
    ['North America', [-168, 66, -162, 70, -156, 71.3, -140, 69.6, -128, 70, -115, 68.5, -95, 72, -82, 73, -80, 63, -94, 59, -92, 57, -82, 55, -79, 51.5, -76, 56, -77, 62, -70, 61, -64, 60, -61, 56, -56, 52, -60, 47, -66, 44.5, -70, 42, -74, 40.5, -76, 35, -81, 31, -80, 25.3, -82, 27, -84, 30, -89, 30.2, -94, 29.5, -97, 26, -97.5, 22, -95, 18.5, -91, 18.5, -90, 21.5, -87, 21.5, -88, 16, -84, 15, -83.5, 11, -81.5, 9, -77.5, 8.5, -79.5, 7.3, -83, 8.3, -85.7, 10, -87.5, 13, -92, 14.5, -96, 15.7, -105, 19.5, -105.7, 22.5, -109.5, 23.2, -112, 28, -114.8, 31.5, -112.5, 29, -110, 24, -114, 27.5, -117, 32.5, -120.6, 34.5, -124.3, 40.3, -124, 46.3, -124.7, 48.4, -127.5, 50.5, -130.5, 54.5, -136, 58, -140, 59.8, -147, 61, -152, 59, -158, 57, -163, 54.8, -157.5, 58.5, -162, 60, -165, 62.5, -164.7, 64.5]],
    ['North America', [-62, 66, -68, 70, -80, 73.5, -90, 72, -85, 69.5, -78, 64.5, -66, 62]],
    ['North America', [-90, 76, -75, 79, -62, 82, -75, 83, -95, 81]],
    ['North America', [-118, 69, -101, 68, -101, 73, -118, 73]],
    ['North America', [-73, 78, -60, 82, -30, 83.5, -20, 81.5, -18, 76.5, -22, 70, -32, 68, -41, 63, -44, 60, -48, 61, -52, 64.5, -54, 68.5, -55, 71, -58, 75.5, -68, 76.5]],
    ['the Caribbean', [-84.9, 21.9, -82, 23.2, -77.2, 21.6, -74.1, 20.2, -77.7, 19.9, -80.6, 21.5]],
    ['the Caribbean', [-74.4, 18.4, -72.8, 19.9, -69.9, 19.7, -68.3, 18.6, -71.4, 17.6]],
    ['South America', [-77, 8.5, -71.5, 12.4, -64, 10.6, -60, 8.5, -52, 5, -50, 0, -44, -2.5, -35, -5.2, -34.8, -8, -39, -15, -40.5, -21.5, -48.5, -26, -53, -33.7, -58, -34.5, -57, -38.5, -62, -39, -65, -42, -63.8, -46, -68, -50.5, -68.5, -53, -70, -55, -74, -52, -75.5, -46, -73.5, -40, -71.6, -30, -70.3, -18.4, -76, -14, -81.2, -6, -80, -1.5, -79.8, 2, -77.3, 4, -77.8, 7.2]],
    ['Eurasia', [-9.5, 37, -8.8, 42, -9.3, 43.2, -1.5, 43.4, -1.2, 46, -4.6, 48.4, -1.5, 48.7, 1.5, 50.9, 4, 51.5, 8.5, 53.6, 8.6, 57, 10.5, 57.7, 10.9, 56.4, 12.5, 55.6, 11.2, 58.9, 10.6, 59.9, 8, 58, 5.5, 58.8, 5, 62, 8, 63.5, 12, 66, 15, 68.5, 19, 70, 25, 71.1, 31, 70.3, 33, 69.3, 41, 67.8, 40.5, 64.5, 44, 66.2, 53, 68.5, 59, 68.7, 66, 69.5, 68.5, 72.5, 73, 72.8, 80, 72.4, 87, 74.8, 100, 76.3, 105, 77.6, 113, 73.7, 127, 73.5, 140, 72.5, 150, 71.5, 160, 69.7, 170, 70, 180, 69, 180, 65, 178, 64.5, 172, 61, 163, 60, 160, 57, 156, 51, 156, 57.5, 163, 62.5, 152, 59.2, 142, 59.2, 135, 54.6, 141, 52.5, 140, 48, 135.5, 43.5, 131, 42.6, 129.5, 40.9, 128, 38.6, 129.4, 35.5, 126.5, 34.4, 126.2, 37.7, 124.7, 39.6, 121.5, 39, 122, 40.5, 117.7, 39, 119, 37.2, 122.5, 37, 119.2, 34.4, 121.9, 31, 122, 29.8, 119.6, 25.5, 117, 23.5, 113.5, 22.2, 110.2, 20.5, 108.5, 21.6, 106, 19.5, 105.6, 18.3, 108.9, 15.3, 109.2, 11.6, 106.6, 9.9, 104.8, 8.6, 104.8, 10.5, 103, 11.6, 100.5, 13.5, 99.2, 10, 100.3, 8, 103.4, 4.2, 104.2, 1.4, 103.4, 1.3, 100.4, 3.7, 98.3, 8, 98.5, 13, 97.6, 16.6, 94.6, 16.2, 94, 19.5, 92.4, 21, 91.7, 22.6, 89, 21.8, 87, 21, 86.9, 20, 85, 19.2, 82.3, 16.6, 80.3, 15.8, 80.2, 13, 79.9, 10.3, 77.5, 8.1, 76.2, 9.8, 74.6, 13.9, 72.8, 19.2, 72.6, 21.4, 70.2, 20.9, 68.8, 22.6, 66.6, 25.4, 61.6, 25.2, 57.3, 25.8, 56.4, 27.2, 54.6, 26.5, 51.5, 27.9, 50.1, 30.2, 48, 30, 48.6, 28.1, 50.2, 26.6, 51.6, 25.2, 51.6, 24.2, 54, 24.2, 56, 26.2, 56.4, 24.7, 58.7, 23.6, 59.8, 22.4, 57.6, 18.9, 56.3, 17.9, 52.2, 15.9, 45, 12.8, 43.3, 12.7, 42.7, 15.7, 40.8, 19.8, 38.7, 22.5, 37, 25.7, 35, 28, 34.5, 29.6, 34.9, 32.4, 35.9, 35.2, 36, 36.8, 32.6, 36.1, 30.6, 36.7, 27.3, 37, 26.3, 39.5, 26, 40.8, 23, 40.4, 24, 38, 22.5, 36.4, 21.1, 38.3, 19.4, 40.4, 19.5, 41.8, 16, 43.5, 13.6, 45.1, 12.3, 45.3, 12.4, 44.2, 14, 42.6, 16, 41.4, 18.5, 40.2, 16, 38, 15.6, 38.2, 15.6, 40, 12, 41.9, 10.5, 42.9, 9.7, 44.1, 7.5, 43.8, 4.5, 43.4, 3.1, 42.4, 3.2, 41.9, 0.8, 41, -0.3, 39.4, 0.2, 38.7, -0.8, 37.6, -2.1, 36.7, -4.4, 36.7, -5.6, 36, -6.4, 36.8, -7.4, 37.2, -8.9, 37]],
    ['Europe', [-5.7, 50, -3, 50.6, 1.4, 51.2, 1.7, 52.7, 0.2, 53.4, -0.1, 54.5, -1.6, 55.6, -2, 57.6, -3.6, 58.6, -5, 58.6, -6.2, 57.5, -5.6, 56.1, -4.9, 55, -3, 54.9, -3.4, 54.2, -3, 53.4, -4.6, 53.3, -4.2, 52.3, -5.3, 51.7, -3.2, 51.4]],
    ['Europe', [-6, 52.2, -6.2, 53.9, -5.6, 54.6, -7.3, 55.3, -8.6, 54.6, -10, 53.9, -9.5, 52.6, -10.4, 51.6, -8.2, 51.6]],
    ['Europe', [-22.7, 63.9, -24.5, 65.5, -22.4, 66.4, -16.1, 66.5, -13.6, 65.1, -14.9, 64.3, -18.7, 63.4]],
    ['Africa', [-5.9, 35.8, -2, 35.1, 3, 36.8, 10, 37.3, 11, 35.6, 10.1, 34.2, 11.1, 33.2, 15.2, 32.3, 19.9, 30.9, 20.1, 32.2, 23, 32.6, 25, 31.6, 29, 30.9, 32.3, 31.3, 32.6, 29.9, 33.9, 27.3, 35.6, 23.9, 37.2, 21, 38.6, 18, 39.7, 15.1, 41.7, 13.6, 43.3, 12.4, 43.2, 11.5, 44.5, 10.4, 47, 11.1, 51.3, 11.8, 51, 10.4, 49.8, 8, 48, 4.6, 46, 2, 43.4, -0.6, 41.5, -1.8, 39.7, -4.4, 39.2, -7.5, 39.8, -10, 40.6, -14.5, 40.5, -15.9, 37.6, -17.8, 35.3, -20.6, 35.5, -24, 32.9, -25.9, 32.5, -28.5, 30.1, -31.3, 27.5, -33.3, 25.6, -33.8, 22.6, -33.9, 20, -34.8, 18.4, -34.2, 17.9, -31.5, 16.5, -28.6, 15.2, -26.9, 14.5, -22.6, 11.8, -17.3, 12.2, -13.8, 13.8, -10.8, 12.3, -6.1, 11.9, -3.3, 9.6, -0.6, 9.4, 2.9, 9.8, 4.1, 8.5, 4.5, 6.1, 4.3, 4.4, 6.3, 1.2, 6.1, -2, 4.7, -4.6, 5.2, -7.5, 4.4, -9.3, 5.5, -11.4, 6.9, -13.2, 8.9, -15, 11, -16.7, 12.4, -17.5, 14.7, -16.5, 16.3, -16.1, 18.5, -17, 21, -15.1, 24, -14.5, 26.1, -12.7, 27.9, -9.8, 29.6, -9.7, 32, -6.8, 34]],
    ['Africa', [49.3, -12, 50.4, -15.4, 49.6, -17.2, 48.3, -21.6, 47, -25, 45.2, -25.5, 43.7, -23.5, 43.3, -21.2, 44.4, -19.3, 44, -17.2, 46.3, -15.9, 48, -13.9]],
    ['Asia', [130, 31.3, 131.4, 31.4, 132, 33.2, 135.1, 33.6, 136.8, 34.3, 138.9, 34.6, 140.9, 35.7, 141, 38.3, 142, 39.6, 141.4, 41.4, 140, 41.4, 140, 40, 139.9, 39, 138.6, 37.8, 136.7, 37.3, 135.4, 35.6, 132.6, 35.4, 130.9, 34.1]],
    ['Asia', [140, 41.5, 141.2, 41.8, 143.3, 42, 145.5, 43.3, 144.6, 44, 141.7, 45.4, 141.4, 43.4, 140, 42.5]],
    ['Asia', [120.6, 18.5, 122.2, 18.5, 122.1, 16.3, 124, 13, 123.3, 13, 120.6, 14.2, 119.9, 16.1]],
    ['Asia', [122, 7, 125.4, 9.8, 126.6, 7.3, 125.4, 5.6, 124, 6.3]],
    ['Asia', [95.3, 5.6, 97.5, 5.2, 100.4, 2.2, 103.8, -1, 106, -3, 105.9, -5.8, 104.6, -5.9, 102.6, -4.2, 100.9, -2.1, 98.6, 1.7]],
    ['Asia', [105.2, -6.8, 108.6, -6.7, 112.8, -6.9, 114.6, -7.8, 114.4, -8.7, 108.5, -7.8, 105.4, -7]],
    ['Asia', [109.6, 1.9, 111.2, 2.6, 113, 3.2, 115.5, 5.4, 117.2, 7, 119.3, 5.3, 118, 4.3, 117.6, 1.1, 116.5, -1.5, 116.2, -3.8, 114.6, -3.6, 111.7, -3, 110.1, -2.4, 109.1, -0.5, 109, 1.5]],
    ['Asia', [119.4, -5.5, 120.4, -5.5, 121, -2.6, 123.3, -0.9, 120.9, 1.3, 124.9, 1.6, 119.8, 0.4, 119.4, -3.5]],
    ['Asia', [79.9, 6.8, 81.3, 6.2, 81.9, 7.6, 80.2, 9.8, 79.7, 8.2]],
    ['Oceania', [131, -1.4, 134, -0.9, 137.9, -1.5, 141, -2.6, 145.8, -5, 147.6, -6.1, 147.2, -7.4, 150.7, -10.6, 146, -8.1, 143.3, -9.1, 142.6, -9.3, 141, -9.1, 138.9, -8.3, 137.6, -5.2, 133.6, -4.2, 132, -2.8]],
    ['Oceania', [113.5, -22, 114.2, -26.3, 115, -29.5, 115.7, -33.6, 117.9, -35.1, 122, -33.9, 124.2, -32.9, 126, -32.3, 131.3, -31.5, 134.2, -32.5, 135.7, -34.9, 137.7, -33, 138, -34.8, 139.6, -36.1, 140.6, -38, 143.5, -38.8, 146.3, -39.1, 150, -37.4, 150.9, -34.3, 153.1, -31, 153.5, -28.1, 153.1, -26, 150.8, -22.6, 149.1, -21, 146.3, -18.9, 145.4, -15, 143.5, -14, 142.5, -10.7, 141.5, -13.6, 141.6, -16.5, 140.2, -17.7, 137.9, -16.3, 135.9, -15, 136.9, -12.2, 132.6, -11.5, 131, -12.2, 129.5, -14.9, 126.1, -14.1, 124.4, -16.3, 122.2, -18.2, 121, -19.7, 117.4, -20.7, 114.6, -21.8]],
    ['Oceania', [144.7, -40.7, 148.3, -40.9, 148, -43.2, 146, -43.6]],
    ['Oceania', [172.6, -34.4, 174.3, -35.3, 175.9, -37.3, 178.5, -37.7, 177, -39.3, 176.9, -40, 175.2, -41.6, 174.6, -41.2, 174.6, -39.9, 173.8, -39.2, 174.6, -37.5]],
    ['Oceania', [172.7, -40.5, 174.3, -41.3, 173.1, -43, 171.2, -44.4, 169.3, -46.6, 166.5, -46, 166.8, -45.2, 168.3, -44, 170.6, -42.9, 172.1, -41]],
    ['Antarctica', [-180, -84, -150, -77, -120, -74, -100, -73, -75, -73, -60, -64, -56, -63, -62, -70, -60, -75, -35, -78, -10, -71, 10, -70, 40, -69, 70, -68, 100, -66, 130, -66, 160, -70, 170, -72, 165, -78, 180, -84, 180, -90, -180, -90]]
  ];
  function inPoly(pts, x, y) {
    var inside = false;
    for (var i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      var xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function polyDist(pts, x, y) {
    var k = Math.cos(y * Math.PI / 180), best = Infinity;
    for (var i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      var ax = pts[j] * k, ay = pts[j + 1], bx = pts[i] * k, by = pts[i + 1], px = x * k;
      var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      var t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (y - ay) * dy) / L)) : 0;
      var ex = ax + t * dx - px, ey = ay + t * dy - y;
      best = Math.min(best, Math.sqrt(ex * ex + ey * ey));
    }
    return best;
  }
  function continentName(name, lat, lon) {
    if (name === 'Eurasia') {
      if (lon <= 26 || (lon < 30 && lat > 40.5) || (lon < 60 && lat >= 44)) return 'Europe';
      return 'Asia';
    }
    if (name === 'North America' && lat < 17 && lon > -92) return 'Central America';
    return name;
  }
  function region(lat, lon) {
    var hs = [lat > 0 ? 'Northern' : lat < 0 ? 'Southern' : '', lon > 0 ? 'Eastern' : lon < 0 ? 'Western' : ''].filter(Boolean);
    var hemi = hs.length === 2 ? hs[0] + ' and ' + hs[1] + ' hemispheres' : hs.length ? hs[0] + ' hemisphere' : 'On the equator';
    var hit = null, near = null, nd = Infinity;
    for (var i = 0; i < LAND.length; i++) {
      if (inPoly(LAND[i][1], lon, lat)) { hit = LAND[i][0]; break; }
      var d = polyDist(LAND[i][1], lon, lat);
      if (d < nd) { nd = d; near = LAND[i][0]; }
    }
    var place;
    if (hit) place = continentName(hit, lat, lon);
    else if (nd < 3.5) place = continentName(near, lat, lon) + ', near the coast';
    else if (lat > 66) place = 'the Arctic Ocean';
    else if (lat < -60) place = 'the Southern Ocean';
    else if (lon > -70 && lon < 20 && !(lat < -35 && lon > 10)) place = 'the Atlantic Ocean';
    else if (lon >= 20 && lon < 120 && lat < 25) place = 'the Indian Ocean';
    else place = 'the Pacific Ocean';
    return { place: place, hemispheres: hemi, text: place.charAt(0).toUpperCase() + place.slice(1) + ' · ' + hemi };
  }
  /* A small SVG world outline with a pin. Plain markup built from numbers only. */
  function mapSvg(lat, lon, opts) {
    opts = opts || {};
    var paths = LAND.map(function (l) {
      var p = l[1], d = '';
      for (var i = 0; i < p.length; i += 2) d += (i ? 'L' : 'M') + (p[i] + 180).toFixed(1) + ' ' + (90 - p[i + 1]).toFixed(1);
      return d + 'Z';
    }).join('');
    var pin = '';
    if (isFinite(lat) && isFinite(lon)) {
      var x = (Number(lon) + 180).toFixed(2), y = (90 - Number(lat)).toFixed(2);
      pin = '<line class="pp-map-cross" x1="' + x + '" y1="0" x2="' + x + '" y2="180"/><line class="pp-map-cross" x1="0" y1="' + y + '" x2="360" y2="' + y + '"/>' +
        '<circle class="pp-map-halo" cx="' + x + '" cy="' + y + '" r="9"/><circle class="pp-map-pin" cx="' + x + '" cy="' + y + '" r="3.6"/>';
    }
    return '<svg class="pp-map" viewBox="0 6 360 150" role="img" aria-label="' + (opts.label ? String(opts.label).replace(/[<>&"]/g, '') : 'World map with a pin') + '"><rect class="pp-map-sea" x="0" y="6" width="360" height="150" rx="6"/><path class="pp-map-land" d="' + paths + '"/>' + pin + '</svg>';
  }

  /* ---------- Inspect ---------- */
  function counted(it) { return it.group !== 'file' && !it.derived; }
  function finish(rep) {
    var f = rep.flags;
    var o = rep.orientation;
    var shown = o >= 5 ? [rep.height, rep.width] : [rep.width, rep.height];
    rep.add('file', 'file.format', 'Format', rep.format + (rep._progressive ? ' (progressive)' : ''), { sensitive: false });
    rep.add('file', 'file.size', 'Size', fmtBytes(rep.bytes), { sensitive: false });
    if (rep.width > 0 && rep.height > 0) rep.add('file', 'file.dims', 'Dimensions', shown[0] + ' × ' + shown[1] + ' px', { sensitive: false });
    if (o > 1) rep.add('file', 'file.orientation', 'Orientation', ['', '', 'Mirrored', 'Upside down', 'Upside down, mirrored', 'Turned and mirrored', 'Turned 90° clockwise', 'Turned and mirrored', 'Turned 90° anticlockwise'][o] + ' when shown', { sensitive: false });
    var cats = {};
    rep.items.forEach(function (it) { if (counted(it) && it.sensitive) cats[it.cat] = true; });
    rep.reveals = cats;
    rep.count = rep.items.filter(counted).length;
    rep.sensitiveCount = rep.items.filter(function (it) { return counted(it) && it.sensitive; }).length;
    rep.level = cats.location ? 'high' : rep.sensitiveCount ? 'some' : 'none';
    rep.summary = summary(rep);
    rep.groups = GROUPS.map(function (g) { return { id: g[0], title: g[1], items: rep.items.filter(function (it) { return it.group === g[0]; }) }; });
    return rep;
  }
  function list(parts) { return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]; }
  function summary(rep) {
    var c = rep.reveals || {};
    if (!rep.supported && !rep.count) return 'This page cannot fully check ' + (rep.format === 'Unknown' ? 'this kind of file' : rep.format + ' files') + '.';
    if (!rep.sensitiveCount && rep.warnings.length && !rep.count) return 'Nothing could be read, but this file is damaged, so details may be hidden in the damaged part.';
    if (!rep.sensitiveCount) return 'Nothing sensitive found. This photo carries no location, time or device details.';
    var parts = [];
    if (c.location && c.time) parts.push('where and when it was taken');
    else if (c.location) parts.push('where it was taken');
    else if (c.time) parts.push('when it was taken');
    if (c.device) parts.push('the device that took it');
    if (c.people) parts.push('names of people');
    if (c.preview) parts.push('a hidden preview image');
    if (c.history) parts.push('how it was edited');
    if (c.extra) parts.push('extra images or video');
    if (c.id) parts.push('IDs that can link copies');
    if (c.note) parts.push('captions or notes');
    if (!parts.length) parts.push('some hidden details');
    if (parts.length > 4) parts = parts.slice(0, 3).concat([(parts.length - 3) + ' other kinds of detail']);
    return 'This photo reveals ' + list(parts) + '.';
  }

  function parseBytes(bytes, meta) {
    meta = meta || {};
    var rep = new Report({ name: meta.name, type: meta.type, bytes: bytes.length });
    var kind = detect(bytes, meta);
    var job = Promise.resolve();
    try {
      if (kind === 'jpeg') parseJpeg(bytes, rep);
      else if (kind === 'png') job = parsePng(bytes, rep);
      else if (kind === 'webp') parseWebp(bytes, rep);
      else {
        rep.container = kind;
        rep.format = HONEST[kind] ? HONEST[kind][0] : 'Unknown';
        rep.notes.push(HONEST[kind] ? HONEST[kind][1] : HONEST.unknown[1]);
        if (kind === 'tiff') readExif(bytes, rep, '');
        else if (kind === 'heic' || kind === 'avif') scanLoose(bytes, rep);
      }
    } catch (e) {
      rep.warn('Part of this file is damaged; what could be read is shown.');
    }
    return Promise.race([
      Promise.resolve(job).catch(function () { rep.warn('Part of this file is damaged; what could be read is shown.'); }),
      new Promise(function (res) { setTimeout(function () { rep.warn('Some compressed text took too long to read and was skipped.'); res(); }, 4000); })
    ]).then(function () { return finish(rep); });
  }
  function readBytes(file) {
    if (file instanceof Uint8Array) return Promise.resolve(file);
    if (file instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(file));
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return Promise.reject(new Error('Not a file'));
  }
  function inspect(file, meta) {
    meta = meta || {};
    return readBytes(file).then(function (bytes) {
      return parseBytes(bytes, { name: meta.name || (file && file.name) || 'photo', type: meta.type || (file && file.type) || '' });
    }).catch(function () {
      var rep = new Report({ name: file && file.name, type: file && file.type, bytes: (file && file.size) || 0 });
      rep.warn('This file could not be read.');
      return finish(rep);
    });
  }

  /* ---------- Clean copy ---------- */
  function tiffWriter(fields) {
    /* Big-endian TIFF with IFD0 (orientation) and an Exif IFD (date, time zone). fields: { orientation, taken, tz } */
    var ifd0 = [], exif = [];
    if (fields.orientation > 1 && fields.orientation <= 8) ifd0.push({ tag: 0x0112, type: 3, value: fields.orientation });
    if (fields.taken) exif.push({ tag: 0x9003, type: 2, str: fields.taken.slice(0, 19) });
    if (fields.tz) exif.push({ tag: 0x9011, type: 2, str: fields.tz.slice(0, 6) });
    if (!ifd0.length && !exif.length) return null;
    if (exif.length) ifd0.push({ tag: 0x8769, type: 4, value: 0 });
    var size0 = 2 + ifd0.length * 12 + 4;
    var exifOff = 8 + size0;
    var size1 = exif.length ? 2 + exif.length * 12 + 4 : 0;
    var dataOff = exifOff + size1;
    var data = [];
    exif.forEach(function (e) { e.bytes = new TextEncoder().encode(e.str + '\0'); e.off = dataOff; dataOff += e.bytes.length + (e.bytes.length & 1); });
    var out = new Uint8Array(dataOff);
    var v = new DataView(out.buffer);
    out[0] = 0x4D; out[1] = 0x4D; v.setUint16(2, 42); v.setUint32(4, 8);
    function writeIfd(at, list) {
      v.setUint16(at, list.length);
      list.forEach(function (e, i) {
        var p = at + 2 + i * 12;
        v.setUint16(p, e.tag); v.setUint16(p + 2, e.type);
        if (e.type === 3) { v.setUint32(p + 4, 1); v.setUint16(p + 8, e.value); }
        else if (e.type === 4) { v.setUint32(p + 4, 1); v.setUint32(p + 8, e.tag === 0x8769 ? exifOff : e.value); }
        else { v.setUint32(p + 4, e.bytes.length); if (e.bytes.length <= 4) out.set(e.bytes, p + 8); else v.setUint32(p + 8, e.off); }
      });
      v.setUint32(at + 2 + list.length * 12, 0);
    }
    writeIfd(8, ifd0);
    if (exif.length) {
      writeIfd(exifOff, exif);
      exif.forEach(function (e) { if (e.bytes.length > 4) out.set(e.bytes, e.off); });
    }
    return out;
  }
  function keepFields(rep, opts) {
    var f = { orientation: rep.orientation };
    if (opts.keep === 'date') {
      var raw = rep._raw['exif.taken'] || rep._raw['exif.digitized'] || rep._raw['exif.modified'];
      if (!raw && rep._raw.xmpDate) {
        var m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)(?::(\d\d))?/.exec(rep._raw.xmpDate);
        if (m) raw = m[1] + ':' + m[2] + ':' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
      }
      if (raw && /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/.test(raw)) f.taken = raw.slice(0, 19);
      if (f.taken && rep._raw.tz) f.tz = rep._raw.tz;
    }
    return f;
  }
  /* Wipes the GPS IFD inside a copy of an EXIF TIFF: its entries and their values are zeroed and its count set to 0. */
  function wipeGps(tiff) {
    var t = tiffReader(tiff);
    if (!t) return tiff;
    var ifd0 = readIfd(t, t.first);
    if (!ifd0) return tiff;
    ifd0.entries.forEach(function (e) {
      if (e.tag !== 0x8825) return;
      var off = tNum(t, e);
      t.seen = {}; t.count = 0;
      var g = readIfd(t, off);
      if (!g) return;
      g.entries.forEach(function (x) { if (x.ok && x.size > 4) tiff.fill(0, x.at, x.at + x.size); });
      tiff.fill(0, off, Math.min(tiff.length, off + 2 + g.n * 12 + 4));
    });
    return tiff;
  }
  function app1(tiff) {
    var len = tiff.length + 8;
    if (len > 65535) return null;
    var head = new Uint8Array([0xFF, 0xE1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
    return concat([head, tiff]);
  }
  function cleanJpeg(b, rep, opts) {
    var noLoc = opts.keep === 'nolocation';
    var out = [], inserted = false;
    var fresh = noLoc ? null : tiffWriter(keepFields(rep, opts));
    var freshSeg = fresh ? app1(fresh) : null;
    var dropped = {};
    rep._segs.forEach(function (s, i) {
      var keep;
      switch (s.kind) {
        case 'icc': keep = opts.keepIcc !== false; break;
        case 'exif':
          if (noLoc && s === rep._exifSeg) {
            var seg = b.slice(s.start, s.end);
            wipeGps(seg.subarray(s.tiff - s.start));
            out.push(seg); inserted = true; keep = false;
          } else keep = false;
          break;
        case 'xmp': keep = noLoc && !rep._xmpLocation; break;
        case 'iptc': keep = noLoc && !rep._iptcLocation; break;
        case 'com': keep = noLoc; break;
        case 'mpf': case 'c2pa': case 'app-other': keep = false; break;
        case 'broken': keep = false; break;
        default: keep = true;
      }
      if (!keep && s.kind !== 'exif') dropped[s.kind] = 1;
      if (keep) out.push(b.subarray(s.start, s.end));
      if (!inserted && freshSeg && (s.kind === 'jfif' || (s.kind === 'soi' && !(rep._segs[i + 1] && rep._segs[i + 1].kind === 'jfif')))) { out.push(freshSeg); inserted = true; }
    });
    return concat(out);
  }
  function pngChunk(type, data) {
    var head = new Uint8Array(8);
    var v = new DataView(head.buffer);
    v.setUint32(0, data.length);
    for (var i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
    var body = concat([head.subarray(4), data]);
    var crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32(body));
    return concat([head.subarray(0, 4), body, crc]);
  }
  function cleanPng(b, rep, opts) {
    var noLoc = opts.keep === 'nolocation';
    var parts = [b.subarray(0, 8)];
    var fresh = tiffWriter(keepFields(rep, opts));
    var inserted = false;
    rep._chunks.forEach(function (c) {
      var keep = !!PNG_KEEP[c.type] || /^[A-Z]/.test(c.type);
      if (c.type === 'iCCP') keep = opts.keepIcc !== false;
      if (noLoc) {
        if (c.type === 'eXIf') { var copy = b.slice(c.start + 8, c.end - 4); wipeGps(copy); parts.push(pngChunk('eXIf', copy)); inserted = true; return; }
        if (c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt' || c.type === 'tIME') {
          var kw = latin1(b, c.start + 8, 80).toLowerCase();
          keep = !(/^raw profile type|^xml:com\.adobe\.xmp$/.test(kw) && (rep._xmpLocation || rep.flags.gps));
        }
      }
      if (!inserted && fresh && !noLoc && (c.type === 'IDAT' || c.type === 'IEND')) { parts.push(pngChunk('eXIf', fresh)); inserted = true; }
      if (keep) parts.push(b.subarray(c.start, c.end));
    });
    return concat(parts);
  }
  function cleanWebp(b, rep, opts) {
    var noLoc = opts.keep === 'nolocation';
    var fresh = noLoc ? null : tiffWriter(keepFields(rep, opts));
    var parts = [], flags = rep._vp8x || 0, vp8xAt = -1;
    var keepIcc = opts.keepIcc !== false;
    var hasExif = false, hasXmp = false, hasIcc = false;
    rep._chunks.forEach(function (c) {
      var keep = /^(VP8X|VP8 |VP8L|ALPH|ANIM|ANMF)$/.test(c.id);
      if (c.id === 'ICCP') { keep = keepIcc; hasIcc = keep; }
      if (noLoc && c.id === 'EXIF') {
        var d = b.slice(c.start + 8, c.end);
        var at = startsWith(d, 0, 'Exif\0\0') ? 6 : 0;
        wipeGps(d.subarray(at));
        var hdr = b.slice(c.start, c.start + 8);
        parts.push(concat([hdr, d])); hasExif = true; return;
      }
      if (noLoc && c.id === 'XMP ' && !rep._xmpLocation) { keep = true; hasXmp = true; }
      if (c.id === 'VP8X') vp8xAt = parts.length;
      if (keep) parts.push(b.slice(c.start, c.end));
    });
    if (fresh && vp8xAt >= 0) {
      var size = fresh.length;
      var hdr2 = new Uint8Array(8 + size + (size & 1));
      hdr2.set([0x45, 0x58, 0x49, 0x46]);
      new DataView(hdr2.buffer).setUint32(4, size, true);
      hdr2.set(fresh, 8);
      parts.push(hdr2); hasExif = true;
    }
    if (vp8xAt >= 0) {
      var x = parts[vp8xAt];
      var f = flags & ~(0x20 | 0x08 | 0x04);
      if (hasIcc) f |= 0x20;
      if (hasExif) f |= 0x08;
      if (hasXmp) f |= 0x04;
      x[8] = f;
    }
    var body = concat(parts);
    var head = new Uint8Array(12);
    head.set([0x52, 0x49, 0x46, 0x46]);
    new DataView(head.buffer).setUint32(4, body.length + 4, true);
    head.set([0x57, 0x45, 0x42, 0x50], 8);
    return concat([head, body]);
  }
  function reencode(file) {
    if (typeof createImageBitmap !== 'function') return Promise.resolve(null);
    return createImageBitmap(file).then(function (bmp) {
      var c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      return new Promise(function (res) { c.toBlob(function (bl) { res(bl); }, 'image/jpeg', 0.92); });
    }).then(function (blob) { return blob ? readBytes(blob) : null; }).catch(function () { return null; });
  }
  /* The compressed image data of a JPEG: everything from the first start-of-scan marker to the end-of-image marker. */
  function scanData(b) {
    var rep = new Report({});
    try { parseJpeg(b, rep); } catch (e) { return null; }
    var first = null, last = null;
    rep._segs.forEach(function (s) { if (s.kind === 'sos' && !first) first = s; if (s.kind === 'eoi') last = s; });
    if (!first) return null;
    return b.subarray(first.start, last ? last.end : b.length);
  }
  function sameBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  /* Only write a copy when the picture itself is all there. */
  function intact(rep) {
    if (rep.container === 'jpeg') return rep._segs.some(function (s) { return s.kind === 'sos'; }) && rep._segs.some(function (s) { return s.kind === 'eoi'; }) && !rep._segs.some(function (s) { return s.kind === 'broken'; });
    if (rep.container === 'png') return rep._chunks.some(function (c) { return c.type === 'IDAT'; }) && rep._chunks.some(function (c) { return c.type === 'IEND'; });
    if (rep.container === 'webp') return rep._chunks.some(function (c) { return /^(VP8 |VP8L|ANMF)$/.test(c.id); });
    return true;
  }
  function allowed(it, opts) {
    if (!counted(it)) return true;
    if (it.key === 'icc') return opts.keepIcc !== false;
    if (opts.keep === 'date') return it.key === 'exif.taken' || it.key === 'exif.tz';
    if (opts.keep === 'nolocation') return it.group !== 'where';
    return false;
  }
  function extOf(rep, name) {
    var e = { jpeg: '.jpg', png: '.png', webp: '.webp' }[rep.container];
    var base = String(name || 'photo').replace(/\.[^.]+$/, '').replace(/[\\\/:*?"<>|\u0000-\u001F]+/g, '-').slice(0, 80) || 'photo';
    return base + '-clean' + (e || '.jpg');
  }
  function clean(file, opts) {
    opts = opts || {};
    opts = { keep: opts.keep === 'date' || opts.keep === 'nolocation' ? opts.keep : 'none', keepIcc: opts.keepIcc !== false, reencode: opts.reencode !== false };
    var name = (file && file.name) || 'photo';
    return readBytes(file).then(function (bytes) {
      return parseBytes(bytes, { name: name, type: file && file.type }).then(function (before) {
        var out = null, method = 'lossless';
        try {
          if (!intact(before)) throw new Error('damaged');
          if (before.container === 'jpeg') out = cleanJpeg(bytes, before, opts);
          else if (before.container === 'png') out = cleanPng(bytes, before, opts);
          else if (before.container === 'webp') out = cleanWebp(bytes, before, opts);
        } catch (e) { out = null; }
        var job = out ? Promise.resolve(out) : (opts.reencode && /heic|avif|tiff|bmp/.test(before.container) ? reencode(file instanceof Blob ? file : new Blob([bytes])).then(function (r) { method = r ? 'reencoded' : 'none'; return r; }) : Promise.resolve(null));
        return job.then(function (outBytes) {
          if (!outBytes) {
            return { ok: false, before: before, after: null, method: 'none', removed: 0, verified: false, leftovers: [], bytesBefore: bytes.length, bytesAfter: 0, blob: null, name: null, reason: before.notes[0] || (before.supported ? 'This file is damaged, so no clean copy was made.' : 'This file could not be cleaned.') };
          }
          var type = method === 'reencoded' ? 'image/jpeg' : ({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[before.container]);
          var outName = method === 'reencoded' ? String(name).replace(/\.[^.]+$/, '') + '-clean.jpg' : extOf(before, name);
          return parseBytes(outBytes, { name: outName, type: type }).then(function (after) {
            var leftovers = after.items.filter(function (it) { return !allowed(it, opts); });
            var identical = null;
            if (method === 'lossless' && before.container === 'jpeg') identical = sameBytes(scanData(bytes), scanData(outBytes));
            else if (method === 'lossless') identical = true;
            var blob = new Blob([outBytes], { type: type });
            return {
              ok: true, before: before, after: after, method: method, identical: identical,
              removed: Math.max(0, before.count - after.count), kept: after.items.filter(counted).map(function (it) { return it.label; }),
              leftovers: leftovers, verified: !leftovers.length, bytesBefore: bytes.length, bytesAfter: outBytes.length,
              blob: blob, bytes: outBytes, name: outName, keep: opts.keep, keepIcc: opts.keepIcc
            };
          });
        });
      });
    }).catch(function () {
      return { ok: false, before: null, after: null, method: 'none', removed: 0, verified: false, leftovers: [], blob: null, reason: 'This file could not be read.' };
    });
  }
  function zip(results) {
    var used = {};
    var files = results.filter(function (r) { return r && r.ok && r.bytes; }).map(function (r) {
      var n = r.name || 'photo-clean.jpg', base = n.replace(/(\.[^.]+)$/, ''), ext = (/(\.[^.]+)$/.exec(n) || ['', ''])[1], i = 1;
      while (used[n.toLowerCase()]) n = base + '-' + (++i) + ext;
      used[n.toLowerCase()] = 1;
      return { name: n, data: r.bytes };
    });
    if (!LE.zip) return null;
    return LE.zip(files);
  }

  /* ---------- Share card ---------- */
  var KIND_WORDS = { location: 'Location', time: 'Date & time', device: 'Phone or camera', people: 'Names', preview: 'Hidden preview', history: 'Edit history', extra: 'Extra images', id: 'Tracking IDs', note: 'Captions' };
  /* A shareable image that says which KINDS of details were found and removed — never the values. */
  function card(results, opts) {
    opts = opts || {};
    var kinds = {}, removed = 0, photos = 0;
    (results || []).forEach(function (r) {
      if (!r || !r.before) return;
      photos++;
      removed += r.removed || 0;
      Object.keys(r.before.reveals || {}).forEach(function (k) { if (KIND_WORDS[k]) kinds[k] = 1; });
    });
    var dark = !!opts.dark;
    var c = document.createElement('canvas');
    c.width = 1080; c.height = 1080;
    var x = c.getContext('2d');
    var bg = dark ? '#0F0E13' : '#F7F6F3', ink = dark ? '#F2EFE9' : '#16131C', muted = dark ? '#ABA5B4' : '#5E5967', line = dark ? 'rgba(255,255,255,.12)' : 'rgba(22,19,28,.10)';
    x.fillStyle = bg; x.fillRect(0, 0, 1080, 1080);
    x.fillStyle = dark ? '#18171D' : '#FFFFFF';
    x.strokeStyle = line; x.lineWidth = 2;
    if (x.roundRect) { x.beginPath(); x.roundRect(72, 72, 936, 936, 40); x.fill(); x.stroke(); } else { x.fillRect(72, 72, 936, 936); x.strokeRect(72, 72, 936, 936); }
    var font = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
    x.fillStyle = muted; x.font = '700 30px ' + font; x.fillText('PHOTO PRIVACY CHECK', 144, 186);
    x.fillStyle = ink; x.font = '720 66px ' + font;
    var head = photos > 1 ? 'My ' + photos + ' photos were' : 'My photo was';
    x.fillText(head, 144, 290);
    x.fillText('carrying hidden details.', 144, 368);
    var list = Object.keys(KIND_WORDS).filter(function (k) { return kinds[k]; });
    x.font = '600 40px ' + font;
    var y = 470;
    if (!list.length) { x.fillStyle = muted; x.fillText('Nothing sensitive found.', 144, y); y += 70; }
    list.slice(0, 6).forEach(function (k) {
      x.fillStyle = '#1B7F54';
      x.beginPath(); x.arc(162, y - 14, 18, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 5; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(153, y - 14); x.lineTo(160, y - 6); x.lineTo(172, y - 22); x.stroke();
      x.fillStyle = ink; x.fillText(KIND_WORDS[k] + ' — removed', 200, y);
      y += 74;
    });
    x.fillStyle = muted; x.font = '500 32px ' + font;
    x.fillText(removed + ' detail' + (removed === 1 ? '' : 's') + ' removed. Image quality unchanged.', 144, 900);
    x.fillStyle = ink; x.font = '700 32px ' + font;
    x.fillText('Checked on my device with LocalEditor', 144, 950);
    return c;
  }

  LE.privacy = {
    LIMITS: LIM, GROUPS: GROUPS,
    inspect: inspect, parse: parseBytes, clean: clean, zip: zip, card: card,
    summary: summary, region: region, mapSvg: mapSvg, scanData: scanData, sameBytes: sameBytes,
    fmtBytes: fmtBytes, text: text, detect: detect, crc32: crc32, tiffWriter: tiffWriter
  };
})(typeof window !== 'undefined' ? window : this);
