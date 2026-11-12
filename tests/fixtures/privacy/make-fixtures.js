#!/usr/bin/env node
/* Builds the synthetic photo-privacy fixtures in this folder: small images with known, made-up EXIF / GPS / XMP / IPTC /
   PNG text / WebP chunks / embedded previews, plus damaged and hostile files. No real photo or person is involved.
   The base pictures are drawn in Chromium (Playwright, preinstalled); the metadata is written byte by byte here.
   Run:  node tests/fixtures/privacy/make-fixtures.js   (rewrites the files and expected.json) */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const OUT = __dirname;

/* ---------- Base pictures ---------- */
async function basePictures() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = await page.evaluate(async () => {
    function draw(w, h, label, color) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
      x.fillStyle = color; x.fillRect(0, 0, Math.round(w / 4), Math.round(h / 4));
      x.fillStyle = '#1040d0'; x.fillRect(Math.round(w * 3 / 4), Math.round(h * 3 / 4), Math.round(w / 4), Math.round(h / 4));
      x.fillStyle = '#222'; x.font = 'bold ' + Math.round(h / 6) + 'px sans-serif'; x.textAlign = 'center'; x.fillText(label, w / 2, h / 2 + h / 16);
      return c;
    }
    async function enc(c, type, q) {
      const b = await new Promise((r) => c.toBlob(r, type, q));
      const buf = new Uint8Array(await b.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return btoa(s);
    }
    const main = draw(320, 240, 'TOP', '#e01010');
    const thumb = draw(160, 120, 'UNCROPPED', '#10a040');
    return {
      jpg: await enc(main, 'image/jpeg', 0.9),
      thumb: await enc(thumb, 'image/jpeg', 0.7),
      png: await enc(main, 'image/png'),
      webp: await enc(main, 'image/webp', 0.9)
    };
  });
  await browser.close();
  const b = (s) => Buffer.from(s, 'base64');
  return { jpg: stripJpeg(b(out.jpg)), thumb: stripJpeg(b(out.thumb)), png: b(out.png), webp: stripWebp(b(out.webp)) };
}
/* The canvas encoders embed an sRGB profile; drop it so the base pictures carry no metadata at all. */
function stripJpeg(buf) {
  const parts = [buf.subarray(0, 2)];
  let o = 2;
  while (o + 4 <= buf.length && buf[o] === 0xFF && buf[o + 1] !== 0xDA) {
    const len = buf.readUInt16BE(o + 2);
    const isIcc = buf[o + 1] === 0xE2 && buf.toString('latin1', o + 4, o + 15) === 'ICC_PROFILE';
    if (!isIcc) parts.push(buf.subarray(o, o + 2 + len));
    o += 2 + len;
  }
  parts.push(buf.subarray(o));
  return Buffer.concat(parts);
}
function stripWebp(buf) {
  const parts = [];
  let o = 12;
  while (o + 8 <= buf.length) {
    const id = buf.toString('latin1', o, o + 4), size = buf.readUInt32LE(o + 4);
    const end = o + 8 + size + (size & 1);
    if (id !== 'ICCP') parts.push(Buffer.from(buf.subarray(o, end)));
    o = end;
  }
  if (parts[0] && parts[0].toString('latin1', 0, 4) === 'VP8X') parts[0][8] &= ~0x20;
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...parts]);
  const head = Buffer.alloc(8); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/* ---------- TIFF writer (fixtures only) ---------- */
const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7 };
function enc(le) {
  return {
    ascii: (s) => ({ type: T.ASCII, data: Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]) }),
    utf16: (s) => { const b = Buffer.alloc(s.length * 2 + 2); for (let i = 0; i < s.length; i++) b.writeUInt16LE(s.charCodeAt(i), i * 2); return { type: T.BYTE, data: b }; },
    short: (...v) => { const b = Buffer.alloc(v.length * 2); v.forEach((n, i) => (le ? b.writeUInt16LE(n, i * 2) : b.writeUInt16BE(n, i * 2))); return { type: T.SHORT, data: b }; },
    long: (...v) => { const b = Buffer.alloc(v.length * 4); v.forEach((n, i) => (le ? b.writeUInt32LE(n, i * 4) : b.writeUInt32BE(n, i * 4))); return { type: T.LONG, data: b }; },
    rat: (...v) => { const b = Buffer.alloc(v.length * 8); v.forEach(([n, d], i) => { if (le) { b.writeUInt32LE(n, i * 8); b.writeUInt32LE(d, i * 8 + 4); } else { b.writeUInt32BE(n, i * 8); b.writeUInt32BE(d, i * 8 + 4); } }); return { type: T.RATIONAL, data: b }; },
    byte: (...v) => ({ type: T.BYTE, data: Buffer.from(v) }),
    undef: (buf) => ({ type: T.UNDEFINED, data: Buffer.from(buf) })
  };
}
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
/* ifds: { ifd0: [[tag, value]], exif: [...], gps: [...], ifd1: [...], thumb: Buffer } */
function tiff(le, ifds) {
  const order = ['ifd0', 'exif', 'gps', 'ifd1'].filter((k) => ifds[k] && ifds[k].length);
  const lists = {};
  order.forEach((k) => { lists[k] = ifds[k].slice(); });
  if (lists.exif) lists.ifd0.push([0x8769, { ptr: 'exif' }]);
  if (lists.gps) lists.ifd0.push([0x8825, { ptr: 'gps' }]);
  if (ifds.thumb && lists.ifd1) { lists.ifd1.push([0x0201, { ptr: 'thumb' }]); lists.ifd1.push([0x0202, enc(le).long(ifds.thumb.length)]); }
  order.forEach((k) => lists[k].sort((a, b) => a[0] - b[0]));
  const size = (list) => 2 + list.length * 12 + 4 + list.reduce((s, [, v]) => { const n = v.ptr ? 4 : v.data.length; return s + (n > 4 ? n + (n & 1) : 0); }, 0);
  const at = {};
  let off = 8;
  order.forEach((k) => { at[k] = off; off += size(lists[k]); });
  if (ifds.thumb) { at.thumb = off; off += ifds.thumb.length; }
  const out = Buffer.alloc(off);
  const w16 = (o, v) => (le ? out.writeUInt16LE(v, o) : out.writeUInt16BE(v, o));
  const w32 = (o, v) => (le ? out.writeUInt32LE(v, o) : out.writeUInt32BE(v, o));
  out.write(le ? 'II' : 'MM', 0, 'latin1'); w16(2, 42); w32(4, 8);
  order.forEach((k) => {
    const list = lists[k], base = at[k];
    let data = base + 2 + list.length * 12 + 4;
    w16(base, list.length);
    list.forEach(([tag, v], i) => {
      const e = base + 2 + i * 12;
      w16(e, tag);
      if (v.ptr) { w16(e + 2, T.LONG); w32(e + 4, 1); w32(e + 8, at[v.ptr]); return; }
      w16(e + 2, v.type); w32(e + 4, v.data.length / SIZE[v.type]);
      if (v.data.length <= 4) v.data.copy(out, e + 8);
      else { w32(e + 8, data); v.data.copy(out, data); data += v.data.length + (v.data.length & 1); }
    });
    w32(base + 2 + list.length * 12, k === 'ifd0' && lists.ifd1 ? at.ifd1 : 0);
  });
  if (ifds.thumb) ifds.thumb.copy(out, at.thumb);
  return out;
}

/* ---------- Containers ---------- */
function seg(marker, payload) {
  const h = Buffer.alloc(4);
  h[0] = 0xFF; h[1] = marker; h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
}
/* Splits a JPEG after SOI (and after APP0/JFIF when present) and inserts segments there. */
function jpegWith(base, segs, trailer) {
  let o = 2;
  if (base[2] === 0xFF && base[3] === 0xE0) o = 4 + base.readUInt16BE(4);
  return Buffer.concat([base.subarray(0, o), ...segs, base.subarray(o), trailer || Buffer.alloc(0)]);
}
function exifSeg(t) { return seg(0xE1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t])); }
function xmpSeg(xml) { return seg(0xE1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xml, 'utf8')])); }
function iptcSeg(records) {
  const iim = Buffer.concat(records.map(([ds, val]) => { const v = Buffer.from(val, 'utf8'); const h = Buffer.from([0x1C, 2, ds, 0, 0]); h.writeUInt16BE(v.length, 3); return Buffer.concat([h, v]); }));
  const res = Buffer.alloc(12);
  res.write('8BIM', 0, 'latin1'); res.writeUInt16BE(0x0404, 4); res[6] = 0; res[7] = 0; res.writeUInt32BE(iim.length, 8);
  const pad = iim.length & 1 ? Buffer.from([0]) : Buffer.alloc(0);
  return seg(0xED, Buffer.concat([Buffer.from('Photoshop 3.0\0', 'latin1'), res, iim, pad]));
}
function iccProfile(desc) {
  const text = Buffer.from(desc + '\0', 'latin1');
  const descTag = Buffer.alloc(12 + text.length);
  descTag.write('desc', 0, 'latin1'); descTag.writeUInt32BE(text.length, 8); text.copy(descTag, 12);
  const head = Buffer.alloc(144);
  head.writeUInt32BE(144 + descTag.length, 0);
  head.write('mntrRGB XYZ ', 12, 'latin1'); head.write('acsp', 36, 'latin1');
  head.writeUInt32BE(1, 128); head.write('desc', 132, 'latin1'); head.writeUInt32BE(144, 136); head.writeUInt32BE(descTag.length, 140);
  return Buffer.concat([head, descTag]);
}
function iccSeg(profile) { return seg(0xE2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), profile])); }
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function pngWith(base, extra) {
  /* inserts chunks right after IHDR */
  const ihdrEnd = 8 + 12 + base.readUInt32BE(8);
  return Buffer.concat([base.subarray(0, ihdrEnd), ...extra, base.subarray(ihdrEnd)]);
}
function riffChunk(id, data) {
  const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, data.length & 1 ? Buffer.from([0]) : Buffer.alloc(0)]);
}
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

const NSDECL = 'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#" xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"';
const xmp = (inner, attrs) => '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ' + NSDECL + '><rdf:Description rdf:about="" ' + (attrs || '') + '>' + inner + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

(async () => {
  const base = await basePictures();
  const expected = {};
  const write = (name, buf, exp) => { fs.writeFileSync(path.join(OUT, name), buf); if (exp) expected[name] = exp; };

  /* full.jpg: everything a phone and an editor can leave behind. Little-endian EXIF. */
  {
    const e = enc(true);
    const t = tiff(true, {
      ifd0: [[0x010E, e.ascii('Synthetic test caption')], [0x010F, e.ascii('Pixelfone')], [0x0110, e.ascii('PF-7 Pro')], [0x0112, e.short(6)], [0x0131, e.ascii('PF Camera 3.1')], [0x0132, e.ascii('2024:05:02 10:15:00')], [0x013B, e.ascii('Test Artist')], [0x8298, e.ascii('Test Copyright 2024')], [0x9C9D, e.utf16('Test XP Author')]],
      exif: [[0x829A, e.rat([1, 120])], [0x829D, e.rat([18, 10])], [0x8827, e.short(100)], [0x9003, e.ascii('2024:05:01 18:42:07')], [0x9004, e.ascii('2024:05:01 18:42:07')], [0x9011, e.ascii('+05:30')], [0x920A, e.rat([42, 10])],
        [0x927C, e.undef(Buffer.concat([Buffer.from('Apple iOS\0', 'latin1'), Buffer.alloc(54)]))], [0x9286, e.undef(Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from('Synthetic user comment', 'latin1')]))],
        [0xA420, e.ascii('a1b2c3d4e5f60718293a4b5c6d7e8f90')], [0xA430, e.ascii('Test Owner')], [0xA431, e.ascii('SN-0042-TEST')], [0xA434, e.ascii('PF-7 back camera 4.2mm f/1.8')]],
      gps: [[0, e.byte(2, 3, 0, 0)], [1, e.ascii('N')], [2, e.rat([48, 1], [51, 1], [2960, 100])], [3, e.ascii('E')], [4, e.rat([2, 1], [17, 1], [4020, 100])], [5, e.byte(0)], [6, e.rat([355, 10])], [7, e.rat([13, 1], [12, 1], [7, 1])], [0x10, e.ascii('T')], [0x11, e.rat([2715, 10])], [0x1D, e.ascii('2024:05:01')]],
      ifd1: [[0x0103, e.short(6)]], thumb: base.thumb
    });
    const xml = xmp('<dc:creator><rdf:Seq><rdf:li>XMP Test Creator</rdf:li></rdf:Seq></dc:creator><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">XMP Test Rights</rdf:li></rdf:Alt></dc:rights><dc:subject><rdf:Bag><rdf:li>alpha</rdf:li><rdf:li>beta</rdf:li></rdf:Bag></dc:subject>' +
      '<xmpMM:History><rdf:Seq><rdf:li stEvt:action="saved" stEvt:softwareAgent="Test Editor 2.0" stEvt:when="2024-05-03T09:00:00+05:30"/><rdf:li stEvt:action="saved" stEvt:softwareAgent="Test Editor 2.0"/></rdf:Seq></xmpMM:History>' +
      '<mwg-rs:Regions rdf:parseType="Resource"><mwg-rs:RegionList><rdf:Bag><rdf:li rdf:parseType="Resource"><mwg-rs:Name>Test Person A</mwg-rs:Name><mwg-rs:Type>Face</mwg-rs:Type></rdf:li></rdf:Bag></mwg-rs:RegionList></mwg-rs:Regions>',
    'xmp:CreatorTool="PF Camera 3.1" xmpMM:DocumentID="xmp.did:test-0001"');
    const icc = iccProfile('Test RGB Profile');
    const mpfT = tiff(true, { ifd0: [[0xB000, enc(true).undef(Buffer.from('0100', 'latin1'))], [0xB001, enc(true).long(2)], [0xB002, enc(true).undef(Buffer.alloc(32))]] });
    const segs = [
      exifSeg(t), xmpSeg(xml), iccSeg(icc), seg(0xE2, Buffer.concat([Buffer.from('MPF\0', 'latin1'), mpfT])),
      iptcSeg([[80, 'IPTC Test Author'], [90, 'Testville'], [101, 'Testland'], [120, 'IPTC test caption'], [25, 'kw1'], [25, 'kw2'], [116, 'IPTC Test Copyright'], [55, '20240501'], [60, '184207+0530']]),
      seg(0xEB, Buffer.concat([Buffer.from('JP\0\0\0\0\0\x01\0\0\0\x20jumb\0\0\0\x18jumdc2pa', 'latin1'), Buffer.alloc(8)])),
      seg(0xFE, Buffer.from('Synthetic comment', 'latin1'))
    ];
    const buf = jpegWith(base.jpg, segs, base.thumb);
    write('full.jpg', buf, {
      'exif.description': 'Synthetic test caption', 'exif.make': 'Pixelfone', 'exif.model': 'PF-7 Pro', 'exif.software': 'PF Camera 3.1', 'exif.modified': '2024-05-02 10:15:00',
      'exif.artist': 'Test Artist', 'exif.copyright': 'Test Copyright 2024', 'exif.xpauthor': 'Test XP Author', 'exif.taken': '2024-05-01 18:42:07', 'exif.digitized': '2024-05-01 18:42:07',
      'exif.tz': 'UTC+05:30', 'exif.settings': '1/120 s · f/1.8 · ISO 100 · 4.2 mm', 'exif.makernote': '64 B of camera-specific data (Apple iOS)', 'exif.comment': 'Synthetic user comment',
      'exif.uid': 'a1b2c3d4e5f60718293a4b5c6d7e8f90', 'exif.owner': 'Test Owner', 'exif.serial': 'SN-0042-TEST', 'exif.lens': 'PF-7 back camera 4.2mm f/1.8',
      'gps.position': '48.85822° N, 2.29450° E', 'gps.altitude': '35.5 m above sea level', 'gps.direction': '271.5° (west)', 'gps.time': '2024-05-01 13:12:07 UTC',
      thumbnail: '160 × 120 JPEG preview, ' + fmtBytes(base.thumb.length),
      'xmp.creator': 'XMP Test Creator', 'xmp.rights': 'XMP Test Rights', 'xmp.keywords': 'alpha, beta', 'xmp.tool': 'PF Camera 3.1', 'xmp.history': '2 recorded steps (Test Editor 2.0)',
      'xmp.ids': '1 identifier that can link copies of this file', 'xmp.people': 'Test Person A',
      'iptc.byline': 'IPTC Test Author', 'iptc.city': 'Testville', 'iptc.country': 'Testland', 'iptc.caption': 'IPTC test caption', 'iptc.keywords': 'kw1 · kw2', 'iptc.copyright': 'IPTC Test Copyright', 'iptc.date': '2024-05-01 18:42:07',
      icc: 'Test RGB Profile · ' + fmtBytes(icc.length), 'jpeg.comment': 'Synthetic comment', c2pa: 'Present: a signed record of how the image was made or edited',
      'jpeg.mpf': '1 more image stored with this one', 'jpeg.trailer': fmtBytes(base.thumb.length) + ' — more images (e.g. a depth map or second camera)',
      _region: 'Europe · Northern and Eastern hemispheres', _orientation: 6
    });
  }
  /* gps-only.jpg: big-endian EXIF with a southern / western position and nothing else. */
  {
    const e = enc(false);
    const t = tiff(false, { ifd0: [[0x0112, e.short(1)]], gps: [[1, e.ascii('S')], [2, e.rat([22, 1], [57, 1], [684, 100])], [3, e.ascii('W')], [4, e.rat([43, 1], [12, 1], [3780, 100])]] });
    write('gps-only.jpg', jpegWith(base.jpg, [exifSeg(t)]), { 'gps.position': '22.95190° S, 43.21050° W', _region: 'South America · Southern and Western hemispheres' });
  }
  write('clean.jpg', base.jpg, {});
  {
    const e = enc(false);
    write('orient6.jpg', jpegWith(base.jpg, [exifSeg(tiff(false, { ifd0: [[0x0112, e.short(6)]] }))]), { _orientation: 6 });
  }
  /* meta.png: text chunks (plain, compressed, international), XMP, eXIf with GPS, tIME and a colour profile. */
  {
    const e = enc(false);
    const ex = tiff(false, { ifd0: [[0x0110, e.ascii('PNG Cam')]], gps: [[1, e.ascii('N')], [2, e.rat([35, 1], [41, 1], [2220, 100])], [3, e.ascii('E')], [4, e.rat([139, 1], [41, 1], [3012, 100])]] });
    const icc = iccProfile('Test RGB Profile');
    const itxt = Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'latin1'), Buffer.from(xmp('<dc:creator><rdf:Seq><rdf:li>PNG XMP Creator</rdf:li></rdf:Seq></dc:creator>'), 'utf8')]);
    const time = Buffer.from([0x07, 0xE8, 5, 2, 10, 15, 0]);
    const buf = pngWith(base.png, [
      chunk('iCCP', Buffer.concat([Buffer.from('Test\0\0', 'latin1'), zlib.deflateSync(icc)])),
      chunk('tEXt', Buffer.from('Author\0PNG Test Author', 'latin1')), chunk('tEXt', Buffer.from('Comment\0PNG test comment', 'latin1')),
      chunk('zTXt', Buffer.concat([Buffer.from('Description\0\0', 'latin1'), zlib.deflateSync(Buffer.from('PNG compressed description', 'latin1'))])),
      chunk('iTXt', itxt), chunk('tEXt', Buffer.from('parameters\0a test prompt, steps: 20', 'latin1')), chunk('tIME', time), chunk('eXIf', ex)
    ]);
    write('meta.png', buf, {
      'png.author': 'PNG Test Author', 'png.comment': 'PNG test comment', 'png.description': 'PNG compressed description', 'xmp.creator': 'PNG XMP Creator',
      'png.parameters': 'a test prompt, steps: 20', 'png.time': '2024-05-02 10:15:00 UTC', 'exif.model': 'PNG Cam', 'gps.position': '35.68950° N, 139.69170° E',
      icc: 'Test RGB Profile · ' + fmtBytes(icc.length), _region: 'Asia · Northern and Eastern hemispheres'
    });
  }
  /* meta.webp: extended WebP with EXIF, XMP and ICC chunks. */
  {
    const e = enc(true);
    const riff = base.webp;
    const first = riff.toString('latin1', 12, 16);
    /* The canvas encoder may already write VP8X (with an alpha chunk); keep its flags and image chunks. */
    const hasX = first === 'VP8X';
    const bitstream = hasX ? riff.subarray(12 + 8 + 10) : riff.subarray(12);
    const w = 320, h = 240;
    const vp8x = Buffer.alloc(10);
    vp8x[0] = (hasX ? riff[20] : 0) | 0x20 | 0x08 | 0x04;
    vp8x.writeUIntLE(w - 1, 4, 3); vp8x.writeUIntLE(h - 1, 7, 3);
    const ex = tiff(true, { ifd0: [[0x010F, e.ascii('WebCam Co')]], exif: [[0x9003, e.ascii('2023:12:24 08:00:00')]], gps: [[1, e.ascii('S')], [2, e.rat([33, 1], [51, 1], [2448, 100])], [3, e.ascii('E')], [4, e.rat([151, 1], [12, 1], [5508, 100])]] });
    const icc = iccProfile('Test RGB Profile');
    const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), riffChunk('VP8X', vp8x), riffChunk('ICCP', icc), bitstream, riffChunk('EXIF', ex), riffChunk('XMP ', Buffer.from(xmp('<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">WebP Rights</rdf:li></rdf:Alt></dc:rights>'), 'utf8'))]);
    const head = Buffer.alloc(8); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length, 4);
    write('meta.webp', Buffer.concat([head, body]), {
      'exif.make': 'WebCam Co', 'exif.taken': '2023-12-24 08:00:00', 'gps.position': '33.85680° S, 151.21530° E', 'xmp.rights': 'WebP Rights',
      icc: 'Test RGB Profile · ' + fmtBytes(icc.length), _region: 'Oceania'
    });
  }
  /* fake.heic: an ISO-BMFF header with an EXIF block inside. Read best-effort; cannot be cleaned without converting. */
  {
    const e = enc(false);
    const ftyp = Buffer.alloc(24); ftyp.writeUInt32BE(24, 0); ftyp.write('ftypheic', 4, 'latin1'); ftyp.write('mif1heic', 16, 'latin1');
    const ex = tiff(false, { ifd0: [[0x010F, e.ascii('HeicCam')]], gps: [[1, e.ascii('N')], [2, e.rat([40, 1], [42, 1], [4608, 100])], [3, e.ascii('W')], [4, e.rat([74, 1], [0, 1], [2160, 100])]] });
    write('fake.heic', Buffer.concat([ftyp, Buffer.alloc(40), Buffer.from('Exif\0\0', 'latin1'), ex, Buffer.alloc(64)]), { 'exif.make': 'HeicCam', 'gps.position': '40.71280° N, 74.00600° W', _unsupported: true });
  }

  /* ---------- Damaged and hostile files ---------- */
  {
    const e = enc(false);
    const t = tiff(false, { ifd0: [[0x010F, e.ascii('<img src=x onerror="window.__pwned=1">')], [0x0110, e.ascii('<script>window.__pwned=1</script>')]] });
    const xml = xmp('<dc:creator><rdf:Seq><rdf:li>&lt;img src=x onerror=window.__pwned=1&gt;</rdf:li></rdf:Seq></dc:creator>');
    write('hostile-xss.jpg', jpegWith(base.jpg, [exifSeg(t), xmpSeg(xml), seg(0xFE, Buffer.from('‮gnp.exe', 'utf8'))]), {
      'exif.make': '<img src=x onerror="window.__pwned=1">', 'exif.model': '<script>window.__pwned=1</script>', 'xmp.creator': '<img src=x onerror=window.__pwned=1>', 'jpeg.comment': 'gnp.exe'
    });
  }
  {
    /* IFD loops: IFD0 points at itself as its Exif IFD, GPS IFD and next IFD. */
    const t = Buffer.alloc(8 + 2 + 3 * 12 + 4);
    t.write('MM', 0, 'latin1'); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4);
    t.writeUInt16BE(3, 8);
    [[0x8769, 8], [0x8825, 8], [0x010F, 0xFFFFFF00]].forEach(([tag, v], i) => { const o = 10 + i * 12; t.writeUInt16BE(tag, o); t.writeUInt16BE(tag === 0x010F ? 2 : 4, o + 2); t.writeUInt32BE(tag === 0x010F ? 0xFFFFFFFF : 1, o + 4); t.writeUInt32BE(v, o + 8); });
    t.writeUInt32BE(8, 10 + 36);
    write('hostile-loop.jpg', jpegWith(base.jpg, [exifSeg(t)]));
  }
  {
    /* An IFD that claims 65535 entries in a 30-byte block, and an IPTC resource that claims 4 GB. */
    const t = Buffer.alloc(30); t.write('II', 0, 'latin1'); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4); t.writeUInt16LE(0xFFFF, 8);
    const irb = Buffer.concat([Buffer.from('Photoshop 3.0\0' + '8BIM', 'latin1'), Buffer.from([0x04, 0x04, 0, 0, 0xFF, 0xFF, 0xFF, 0xF0]), Buffer.alloc(16)]);
    write('hostile-count.jpg', jpegWith(base.jpg, [exifSeg(t), seg(0xED, irb)]));
  }
  write('hostile-trunc.jpg', fs.readFileSync(path.join(OUT, 'full.jpg')).subarray(0, 300));
  write('hostile-entity.jpg', jpegWith(base.jpg, [xmpSeg('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ' + NSDECL + '><rdf:Description><dc:creator>&lol3;</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>')]));
  write('hostile-bomb.png', pngWith(base.png, [chunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0', 'latin1'), zlib.deflateSync(Buffer.alloc(40 * 1024 * 1024, 0x41))]))]));
  {
    let seed = 7;
    const rnd = Buffer.alloc(4096).map(() => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed & 255; });
    write('hostile-garbage.jpg', Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10]), rnd]));
  }
  fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify(expected, null, 1) + '\n');
  console.log('Wrote ' + fs.readdirSync(OUT).filter((f) => !f.endsWith('.js')).length + ' files to ' + path.relative(process.cwd(), OUT));
})();
