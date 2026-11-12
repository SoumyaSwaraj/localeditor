/* Builds the PDF security test fixtures with pdf-lib, in the page (needs window.PDFLib and a canvas).
   Every planted item carries a unique marker string so tests can look for it in the output bytes.
   In a page: await SecFixtures.all() -> { name: Uint8Array }. To write them to disk: node tests/fixtures/pdf-security/make-fixtures.js */
(function (global) {
  'use strict';

  function L() { return global.PDFLib; }
  function N(n) { return L().PDFName.of(n); }
  function S(s) { return L().PDFString.of(s); }
  function te(s) { return new TextEncoder().encode(s); }
  function concat(parts) {
    var n = 0; parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n); var o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }
  function latin1(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }

  /* Verhoeff check digit, to plant a valid and an invalid Aadhaar number. */
  var VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  var VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  var VINV = [0,4,3,2,1,5,6,7,8,9];
  function verhoeffDigit(num) {
    var c = 0; var digits = String(num).split('').reverse();
    for (var i = 0; i < digits.length; i++) c = VD[c][VP[(i + 1) % 8][+digits[i]]];
    return VINV[c];
  }
  function aadhaar(valid) {
    var base = '23412341234';
    var d = verhoeffDigit(base);
    if (!valid) d = (d + 1) % 10;
    var s = base + d;
    return s.slice(0, 4) + ' ' + s.slice(4, 8) + ' ' + s.slice(8);
  }

  function addContent(doc, page, text, compress) {
    var ctx = doc.context;
    var stream = compress === false ? ctx.stream(text) : ctx.flateStream(text);
    var ref = ctx.register(stream);
    page.node.addContentStream(ref);
    return ref;
  }

  function fontKey(page, font) { return page.node.newFontDictionary('F', font.ref).asString().slice(1); }

  async function jpegWithExif(color) {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 48;
    var g = c.getContext('2d');
    g.fillStyle = color || '#3366aa'; g.fillRect(0, 0, 64, 48);
    g.fillStyle = '#ffcc00'; g.fillRect(8, 8, 20, 20);
    var blob = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.9); });
    var jpg = new Uint8Array(await blob.arrayBuffer());
    /* Minimal big-endian TIFF: IFD0 with Make, Software, Artist and a GPS IFD pointer. */
    var make = 'SecretCam X100\0', soft = 'PhotoTool 9\0', artist = 'EXIF-ARTIST-HOTEL\0';
    var ifdStart = 8, entries = 4, ifdLen = 2 + entries * 12 + 4;
    var dataStart = ifdStart + ifdLen;
    var gpsIfd = dataStart + make.length + soft.length + artist.length;
    var tiff = new Uint8Array(gpsIfd + 2 + 12 + 4);
    var dv = new DataView(tiff.buffer);
    tiff.set(te('MM'), 0); dv.setUint16(2, 42); dv.setUint32(4, ifdStart);
    dv.setUint16(ifdStart, entries);
    var off = ifdStart + 2, dataOff = dataStart;
    function ascii(tag, str) {
      dv.setUint16(off, tag); dv.setUint16(off + 2, 2); dv.setUint32(off + 4, str.length); dv.setUint32(off + 8, dataOff);
      tiff.set(te(str), dataOff); dataOff += str.length; off += 12;
    }
    ascii(0x010F, make); ascii(0x0131, soft); ascii(0x013B, artist);
    dv.setUint16(off, 0x8825); dv.setUint16(off + 2, 4); dv.setUint32(off + 4, 1); dv.setUint32(off + 8, gpsIfd); off += 12;
    dv.setUint32(off, 0);
    dv.setUint16(gpsIfd, 1);
    dv.setUint16(gpsIfd + 2, 1); dv.setUint16(gpsIfd + 4, 2); dv.setUint32(gpsIfd + 6, 2); tiff.set(te('N\0'), gpsIfd + 10);
    var payload = concat([te('Exif\0\0'), tiff]);
    var seg = new Uint8Array(4 + payload.length);
    seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = (payload.length + 2) >> 8; seg[3] = (payload.length + 2) & 255;
    seg.set(payload, 4);
    return concat([jpg.subarray(0, 2), seg, jpg.subarray(2)]);
  }

  /* Appends a classic incremental update: replacement objects, an xref table and a trailer with /Prev. */
  function appendUpdate(bytes, objects, trailerExtra) {
    var text = latin1(bytes);
    var sx = text.lastIndexOf('startxref');
    var prev = parseInt(text.slice(sx + 9).trim(), 10);
    var size = 0;
    var sm = text.match(/\/Size\s+(\d+)/g) || [];
    sm.forEach(function (s) { size = Math.max(size, +s.replace(/\D+/g, '')); });
    var root = /\/Root\s+(\d+ \d+ R)/.exec(text);
    var info = /\/Info\s+(\d+ \d+ R)/.exec(text);
    var parts = [bytes, te('\n')];
    var pos = bytes.length + 1;
    var offsets = [];
    objects.forEach(function (o) {
      var chunk = te(o.num + ' 0 obj\n' + o.body + '\nendobj\n');
      offsets.push({ num: o.num, at: pos });
      parts.push(chunk); pos += chunk.length;
      if (o.num >= size) size = o.num + 1;
    });
    var xrefAt = pos;
    var x = 'xref\n';
    offsets.sort(function (a, b) { return a.num - b.num; }).forEach(function (o) {
      x += o.num + ' 1\n' + String(o.at).padStart(10, '0') + ' 00000 n \n';
    });
    x += 'trailer\n<< /Size ' + size + ' /Root ' + root[1] + (info ? ' /Info ' + info[1] : '') + ' /Prev ' + prev + (trailerExtra || '') + ' >>\nstartxref\n' + xrefAt + '\n%%EOF\n';
    parts.push(te(x));
    return concat(parts);
  }

  /* ---------- reveal.pdf: everything D3 should find ---------- */
  async function reveal() {
    var P = L();
    var doc = await P.PDFDocument.create({ updateMetadata: false });
    doc.setTitle('Q3 Salary Review TITLE-SECRET-INDIA');
    doc.setAuthor('Jane AUTHOR-SECRET-JULIET');
    doc.setSubject('Compensation SUBJECT-SECRET');
    doc.setKeywords(['salary', 'KEYWORD-SECRET']);
    doc.setCreator('Microsoft Word for Office 365');
    doc.setProducer('Acme PDF Writer 2.1 PRODUCER-SECRET');
    doc.setCreationDate(new Date(Date.UTC(2024, 2, 14, 9, 30, 0)));
    doc.setModificationDate(new Date(Date.UTC(2024, 5, 2, 17, 5, 0)));
    var ctx = doc.context;
    var xmp = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">' +
      '<dc:creator><rdf:Seq><rdf:li>XMP-CREATOR-KILO</rdf:li></rdf:Seq></dc:creator><xmp:CreatorTool>Microsoft Word XMP-TOOL</xmp:CreatorTool><pdf:Producer>Acme XMP</pdf:Producer>' +
      '<xmpMM:DocumentID>uuid:XMP-DOCID-LIMA</xmpMM:DocumentID></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
    var meta = ctx.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(N('Metadata'), ctx.register(meta));
    ctx.trailerInfo.ID = ctx.obj([P.PDFHexString.of('DEADBEEF00112233'), P.PDFHexString.of('DEADBEEF00112233')]);

    var font = await doc.embedFont(P.StandardFonts.Helvetica);
    var p1 = doc.addPage([595.28, 841.89]);
    var p2 = doc.addPage([612, 792]);
    var f1 = fontKey(p1, font);
    p1.drawText('Visible heading for the review', { x: 50, y: 790, size: 16, font: font });

    var jpg = await jpegWithExif();
    var img = await doc.embedJpg(jpg);
    var imgMeta = ctx.register(ctx.stream('<x:xmpmeta>IMAGE-XMP-MIKE</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' }));
    var ocRef = ctx.register(ctx.obj({ Type: 'OCG', Name: S('Draft notes LAYER-NAME') }));
    var imName = p1.node.newXObject('Im', img.ref).asString().slice(1);
    var props = ctx.obj({}); props.set(N('OC1'), ocRef);
    p1.node.Resources().set(N('Properties'), props);
    var content = [
      'BT /' + f1 + ' 12 Tf 50 700 Td 3 Tr (INVISIBLE-SECRET-ALPHA) Tj 0 Tr ET',
      'BT /' + f1 + ' 12 Tf 1 1 1 rg 50 680 Td (WHITE-SECRET-BRAVO) Tj 0 g ET',
      'BT /' + f1 + ' 0.4 Tf 50 660 Td (TINY-SECRET-CHARLIE) Tj ET',
      'BT /' + f1 + ' 12 Tf -900 400 Td (OFFPAGE-SECRET-DELTA) Tj ET',
      'BT /' + f1 + ' 12 Tf 60 520 Td (UNDER-IMAGE-ECHO) Tj ET',
      'q 200 0 0 150 50 470 cm /' + imName + ' Do Q',
      '/OC /OC1 BDC BT /' + f1 + ' 12 Tf 50 420 Td (LAYER-SECRET-FOXTROT) Tj ET EMC',
      'BT /' + f1 + ' 12 Tf 0 g 50 380 Td (Normal visible body text stays.) Tj ET',
      'BT /' + f1 + ' 12 Tf 50 340 Td (FAKE-BLACKOUT-ZETA) Tj ET 0 g 46 334 170 18 re f'
    ].join('\n');
    addContent(doc, p1, content);
    await img.embed();
    ctx.lookup(img.ref).dict.set(N('Metadata'), imgMeta);
    doc.catalog.set(N('OCProperties'), ctx.obj({ OCGs: [ocRef], D: { Order: [ocRef], OFF: [ocRef] } }));

    var thumb = ctx.register(ctx.stream(new Uint8Array(12), { Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
    p1.node.set(N('Thumb'), thumb);
    p1.node.set(N('PieceInfo'), ctx.obj({ Illustrator: { Private: S('PIECEINFO-SECRET') } }));

    var popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [300, 600, 500, 700], Open: false }));
    var noteRef = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 700, 320, 720], T: S('COMMENT-AUTHOR-NOVEMBER'),
      Contents: S('Do not share these figures COMMENT-TEXT-OSCAR'), M: S('D:20240601120000Z'), Popup: popup, Name: 'Comment' }));
    ctx.lookup(popup).set(N('Parent'), noteRef);
    var hl = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [48, 785, 300, 808], QuadPoints: [48, 808, 300, 808, 48, 785, 300, 785],
      C: [1, 1, 0], T: S('Reviewer PAPA'), Contents: S('HIGHLIGHT-NOTE-QUEBEC'), M: S('D:20240602120000Z') }));
    var link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 300, 250, 320], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: S('https://intranet.example.com/hr/LINK-SECRET-ROMEO') } }));
    p1.node.set(N('Annots'), ctx.obj([noteRef, popup, hl, link]));

    var form = doc.getForm();
    var tf = form.createTextField('employee.name');
    tf.setText('FORM-VALUE-SIERRA');
    tf.addToPage(p2, { x: 50, y: 650, width: 220, height: 24 });
    var hidden = form.createTextField('internal.code');
    hidden.setText('HIDDEN-FIELD-TANGO');
    hidden.addToPage(p2, { x: 50, y: 600, width: 220, height: 24 });
    hidden.acroField.getWidgets()[0].dict.set(N('F'), P.PDFNumber.of(2));
    var cb = form.createCheckBox('approved');
    cb.addToPage(p2, { x: 50, y: 550, width: 18, height: 18 });
    cb.check();
    p2.drawText('Second page of the review', { x: 50, y: 720, size: 14, font: font });

    await doc.attach(te('name,salary\nUma,ATTACHMENT-SECRET-UNIFORM\n'), 'payroll-2024.csv', { mimeType: 'text/csv', description: 'Payroll export' });
    return doc.save({ useObjectStreams: false });
  }

  /* revisions.pdf: a base revision with a secret, then a hand-appended update that hides it. */
  async function revisions() {
    var P = L();
    var doc = await P.PDFDocument.create({ updateMetadata: false });
    doc.setTitle('Draft OLD-TITLE-VICTOR');
    doc.setAuthor('Original Author');
    var font = await doc.embedFont(P.StandardFonts.Helvetica);
    var page = doc.addPage([595.28, 841.89]);
    var fk = fontKey(page, font);
    var cref = addContent(doc, page, 'BT /' + fk + ' 14 Tf 50 760 Td (Contract value REVISION-SECRET-WHISKEY) Tj ET', false);
    var infoRef = doc.context.trailerInfo.Info;
    var base = await doc.save({ useObjectStreams: false });
    var newContent = 'BT /' + fk + ' 14 Tf 50 760 Td (Contract value withheld) Tj ET';
    return appendUpdate(base, [
      { num: cref.objectNumber, body: '<< /Length ' + newContent.length + ' >>\nstream\n' + newContent + '\nendstream' },
      { num: infoRef.objectNumber, body: '<< /Title (Final contract) /Author (Legal team) >>' }
    ]);
  }

  /* ---------- active.pdf: everything D4 should flag ---------- */
  async function active() {
    var P = L();
    var doc = await P.PDFDocument.create({ updateMetadata: false });
    var ctx = doc.context;
    var font = await doc.embedFont(P.StandardFonts.Helvetica);
    var page = doc.addPage([595.28, 841.89]);
    page.drawText('Invoice 2291', { x: 50, y: 780, size: 18, font: font });
    var js1 = ctx.register(ctx.obj({ Type: 'Action', S: 'JavaScript', JS: S('app.alert("OPENACTION-JS-ALPHA")') }));
    doc.catalog.set(N('OpenAction'), js1);
    var docJs = ctx.register(ctx.obj({ S: 'JavaScript', JS: ctx.register(ctx.stream('var x = "DOCLEVEL-JS-BRAVO";')) }));
    doc.catalog.set(N('Names'), ctx.obj({ JavaScript: { Names: [S('init'), docJs] } }));
    doc.catalog.set(N('AA'), ctx.obj({ WC: { S: 'JavaScript', JS: S('this.closeDoc("CATALOG-AA-CHARLIE")') } }));
    page.node.set(N('AA'), ctx.obj({ O: { S: 'JavaScript', JS: S('console.println("PAGE-AA-DELTA")') } }));
    var launch = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 700, 200, 720], A: { S: 'Launch', F: S('calc.exe LAUNCH-ECHO') } }));
    var gotor = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 670, 200, 690], A: { S: 'GoToR', F: S('other-file.pdf'), D: [0, 'Fit'] } }));
    var uri = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 640, 200, 660], A: { S: 'URI', URI: S('http://tracker.example.org/pixel') } }));
    var imp = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 610, 200, 630], A: { S: 'ImportData', F: S('data.fdf') } }));
    var rich = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'RichMedia', Rect: [300, 600, 500, 700], RichMediaContent: { Assets: { Names: [] } } }));
    var ext = ctx.register(ctx.stream('', { F: S('http://evil.example.com/payload.bin'), FFilter: 'FlateDecode' }));
    page.node.set(N('PieceInfo'), ctx.obj({ App: { Private: ext } }));
    var form = doc.getForm();
    var tf = form.createTextField('amount');
    tf.addToPage(page, { x: 300, y: 760, width: 150, height: 22 });
    tf.acroField.getWidgets()[0].dict.set(N('AA'), ctx.obj({ K: { S: 'JavaScript', JS: S('event.rc = true; FIELD-AA-FOXTROT') } }));
    var submitBtn = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [300, 700, 450, 720],
      A: { S: 'SubmitForm', F: { FS: 'URL', F: S('https://collect.example.net/submit') }, Next: { S: 'JavaScript', JS: S('NEXT-JS-GOLF') } } }));
    var annots = page.node.Annots();
    [launch, gotor, uri, imp, rich, submitBtn].forEach(function (r) { annots.push(r); });
    doc.catalog.lookup(N('AcroForm')).set(N('XFA'), ctx.register(ctx.stream('<xdp:xdp>XFA-HOTEL</xdp:xdp>')));
    await doc.attach(te('MZ fake'), 'invoice.exe', { mimeType: 'application/octet-stream' });
    await doc.attach(te('hello'), 'notes.txt', { mimeType: 'text/plain' });
    var base = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    var n = ctx.largestObjectNumber + 5;
    return appendUpdate(base, [{ num: n, body: '<< /S /J#61vaScript /JS (DISGUISED-JS-INDIA) >>' }]);
  }

  /* ---------- sensitive.pdf: D2 hits and misses ---------- */
  var SENSITIVE_LINES = [
    'Email: priya.raman@example.co.uk',
    'Phone: +44 20 7946 0958',
    'Mobile: (415) 555-0132',
    'India: +91 98765 43210',
    'Website: https://www.example.org/path?q=1',
    'Server IP 192.168.10.42 and bad 999.1.1.1',
    'Date of birth: 14/03/1987',
    'Card good: 4111 1111 1111 1111',
    'Card bad: 4111 1111 1111 1112',
    'IBAN good: GB82 WEST 1234 5698 7654 32',
    'IBAN bad: GB82 WEST 1234 5698 7654 33',
    'SSN: 219-09-9999 and invalid 000-12-3456',
    'Aadhaar good: ' + aadhaar(true),
    'Aadhaar bad: ' + aadhaar(false),
    'PAN: ABCPE1234F',
    'Passport No: K1234567',
    'Sort code: 12-34-56  Account number: 31926819',
    'Routing number: 021000021',
    'Order total 1234 5678 is not a card'
  ];
  async function sensitive() {
    var P = L();
    var doc = await P.PDFDocument.create({ updateMetadata: false });
    var font = await doc.embedFont(P.StandardFonts.Helvetica);
    var p1 = doc.addPage([595.28, 841.89]);
    var y = 800;
    SENSITIVE_LINES.forEach(function (l) { p1.drawText(l, { x: 50, y: y, size: 11, font: font }); y -= 22; });
    var p2 = doc.addPage([595.28, 841.89]);
    p2.drawText('Reviewed by Priya Raman on Monday.', { x: 60, y: 700, size: 12, font: font });
    p2.drawText('Contact priya.raman@example.co.uk for details.', { x: 60, y: 670, size: 12, font: font });
    var p3 = doc.addPage([595.28, 841.89]);
    var img = await doc.embedJpg(await jpegWithExif('#dddddd'));
    p3.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    return doc.save();
  }

  /* ---------- redact.pdf: D1 ---------- */
  async function redact() {
    var P = L();
    var doc = await P.PDFDocument.create({ updateMetadata: false });
    doc.setTitle('Case file for REDACT-NAME-ZULU');
    var ctx = doc.context;
    var font = await doc.embedFont(P.StandardFonts.Helvetica);
    var p1 = doc.addPage([595.28, 841.89]);
    p1.drawText('Account holder: REDACT-NAME-ZULU', { x: 50, y: 760, size: 14, font: font });
    p1.drawText('Salary: 98,500 REDACT-AMOUNT-YANKEE', { x: 50, y: 730, size: 14, font: font });
    p1.drawText('Keep this line visible.', { x: 50, y: 700, size: 14, font: font });
    var img = await doc.embedJpg(await jpegWithExif('#aa3344'));
    p1.drawImage(img, { x: 320, y: 600, width: 160, height: 120 });
    var c1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [160, 755, 180, 775], T: S('Clerk'), Contents: S('Comment about REDACT-NOTE-XRAY') }));
    var l1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 400, 200, 420], A: { S: 'URI', URI: S('https://example.com/keep') } }));
    p1.node.set(N('Annots'), ctx.obj([c1, l1]));
    var p2 = doc.addPage([595.28, 841.89]);
    p2.drawText('Page two mentions REDACT-NAME-ZULU again.', { x: 50, y: 760, size: 14, font: font });
    var p3 = doc.addPage([841.89, 595.28]);
    p3.drawText('Page three is landscape and untouched.', { x: 50, y: 500, size: 14, font: font });
    return doc.save();
  }

  /* Boxes (top-left origin, points) over planted strings in redact.pdf page 1. */
  var REDACT_BOXES = {
    name: { page: 0, x: 152, y: 841.89 - 776, w: 270, h: 22 },
    amount: { page: 0, x: 46, y: 841.89 - 746, w: 330, h: 22 },
    image: { page: 0, x: 330, y: 841.89 - 710, w: 80, h: 60 }
  };

  /* ---------- locked.pdf: RC4 40-bit (R2) with an empty user password and an owner password ---------- */
  function md5(bytes) {
    var K = [], r = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    var n = bytes.length, total = ((n + 8) >> 6) + 1, words = new Uint32Array(total * 16);
    for (i = 0; i < n; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
    words[n >> 2] |= 0x80 << ((n % 4) * 8);
    words[total * 16 - 2] = (n * 8) >>> 0;
    words[total * 16 - 1] = Math.floor(n / 536870912) >>> 0;
    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (var blk = 0; blk < total; blk++) {
      var A = a0, B = b0, C = c0, D = d0;
      for (var j = 0; j < 64; j++) {
        var F, g;
        if (j < 16) { F = (B & C) | (~B & D); g = j; }
        else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
        else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * j) % 16; }
        var tmp = D; D = C; C = B;
        var x = (A + F + K[j] + words[blk * 16 + g]) >>> 0;
        var sft = r[(j >> 4) * 4 + (j % 4)];
        B = (B + ((x << sft) | (x >>> (32 - sft)))) >>> 0;
        A = tmp;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    var out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach(function (v, k) { for (var q = 0; q < 4; q++) out[k * 4 + q] = (v >>> (q * 8)) & 255; });
    return out;
  }
  function rc4(key, data) {
    var S0 = new Uint8Array(256), i, j = 0, t;
    for (i = 0; i < 256; i++) S0[i] = i;
    for (i = 0; i < 256; i++) { j = (j + S0[i] + key[i % key.length]) & 255; t = S0[i]; S0[i] = S0[j]; S0[j] = t; }
    var out = new Uint8Array(data.length); i = 0; j = 0;
    for (var k = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + S0[i]) & 255; t = S0[i]; S0[i] = S0[j]; S0[j] = t; out[k] = data[k] ^ S0[(S0[i] + S0[j]) & 255]; }
    return out;
  }
  var PAD = new Uint8Array([0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);
  function hexOf(b) { var s = ''; for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2); return s; }
  async function locked() {
    var P = L();
    var doc = await P.PDFDocument.create({ updateMetadata: false });
    doc.setTitle('LOCKED-TITLE-KAPPA');
    doc.setAuthor('LOCKED-AUTHOR-MU');
    var font = await doc.embedFont(P.StandardFonts.Helvetica);
    var page = doc.addPage([595.28, 841.89]);
    page.drawText('A locked file', { x: 50, y: 760, size: 18, font: font });
    var ctx = doc.context;
    var note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 700, 320, 720], T: S('LOCKED-AUTHOR-MU'), Contents: S('LOCKED-NOTE-LAMBDA') }));
    page.node.set(N('Annots'), ctx.obj([note]));
    var id = new Uint8Array(16); for (var q = 0; q < 16; q++) id[q] = q * 13 + 7;
    var ownerKey = md5(concat([te('owner'), PAD]).subarray(0, 32)).subarray(0, 5);
    var O = rc4(ownerKey, PAD);
    var perm = -3904;
    var pb = new Uint8Array([perm & 255, (perm >> 8) & 255, (perm >> 16) & 255, (perm >> 24) & 255]);
    var key = md5(concat([PAD, O, pb, id])).subarray(0, 5);
    var U = rc4(key, PAD);
    function objKey(ref) {
      var n = ref.objectNumber, g = ref.generationNumber;
      return md5(concat([key, new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255])])).subarray(0, 10);
    }
    function encValue(v, k) {
      if (v instanceof P.PDFString || v instanceof P.PDFHexString) return P.PDFHexString.of(hexOf(rc4(k, v.asBytes())));
      if (v instanceof P.PDFArray) { for (var i = 0; i < v.size(); i++) v.set(i, encValue(v.get(i), k)); return v; }
      if (v instanceof P.PDFDict) { v.entries().forEach(function (kv) { v.set(kv[0], encValue(kv[1], k)); }); return v; }
      return v;
    }
    await doc.flush();
    ctx.enumerateIndirectObjects().forEach(function (kv) {
      var ref = kv[0], obj = kv[1], k = objKey(ref);
      if (obj instanceof P.PDFStream) {
        encValue(obj.dict, k);
        var raw = obj.getContents();
        var ns = P.PDFRawStream.of(obj.dict, rc4(k, raw));
        ctx.assign(ref, ns);
      } else encValue(obj, k);
    });
    var enc = ctx.register(ctx.obj({ Filter: 'Standard', V: 1, R: 2, O: P.PDFHexString.of(hexOf(O)), U: P.PDFHexString.of(hexOf(U)), P: perm }));
    ctx.trailerInfo.Encrypt = enc;
    ctx.trailerInfo.ID = ctx.obj([P.PDFHexString.of(hexOf(id)), P.PDFHexString.of(hexOf(id))]);
    return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  }

  /* Hostile and malformed inputs. */
  async function hostile() {
    var out = {};
    out.random = (function () { var b = new Uint8Array(4096); for (var i = 0; i < b.length; i++) b[i] = (i * 7919 + 13) & 255; return b; })();
    out.empty = new Uint8Array(0);
    out.headerOnly = te('%PDF-1.7\n%%EOF\n');
    var good = await sensitive();
    out.truncated = good.slice(0, Math.floor(good.length / 2));
    out.deep = te('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Deep ' + '['.repeat(20000) + ']'.repeat(20000) + ' >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Kids [2 0 R] >>\nendobj\n' +
      'trailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n');
    out.loops = te('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /JavaScript 4 0 R >> /OpenAction 5 0 R /AcroForm << /Fields [6 0 R] >> >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [7 0 R] >>\nendobj\n' +
      '4 0 obj\n<< /Kids [4 0 R] >>\nendobj\n5 0 obj\n<< /S /JavaScript /JS (x) /Next 5 0 R >>\nendobj\n6 0 obj\n<< /T (a) /Kids [6 0 R] >>\nendobj\n' +
      '7 0 obj\n<< /Subtype /Link /Rect [0 0 1 1] /A 5 0 R /Popup 7 0 R >>\nendobj\n' +
      'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 8 /Prev 9 >>\nstartxref\n9\n%%EOF\n');
    /* A drawing stream that inflates to 64 MB of spaces: decoding must stop at the cap, not exhaust memory. */
    var zeros = new Uint8Array(64 * 1024 * 1024).fill(32);
    var cs = new Blob([zeros]).stream().pipeThrough(new CompressionStream('deflate'));
    var packed = new Uint8Array(await new Response(cs).arrayBuffer());
    var bdoc = await L().PDFDocument.create();
    var bp = bdoc.addPage([200, 200]);
    var bomb = bdoc.context.stream(packed, { Filter: 'FlateDecode' });
    bp.node.set(N('Contents'), bdoc.context.register(bomb));
    out.bomb = await bdoc.save();
    out.badXref = te('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>\nendobj\nxref\n0 4\nGARBAGE\ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n999999\n%%EOF\n');
    return out;
  }

  async function all() {
    return { reveal: await reveal(), revisions: await revisions(), active: await active(), sensitive: await sensitive(), redact: await redact() };
  }

  global.SecFixtures = {
    all: all, reveal: reveal, revisions: revisions, active: active, sensitive: sensitive, redact: redact, hostile: hostile, locked: locked,
    appendUpdate: appendUpdate, jpegWithExif: jpegWithExif, aadhaar: aadhaar, SENSITIVE_LINES: SENSITIVE_LINES, REDACT_BOXES: REDACT_BOXES
  };
})(window);
