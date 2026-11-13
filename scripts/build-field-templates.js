/* Builds assets/data/templates/fields.json: the ready templates for Fields and Create many (roadmap 2.6).
   Each template is a plain open-format design (.ledesign.json, docs/FORMAT-DESIGN.md) with variables, values and a
   sample list, so "Create many" can be tried in one tap. Original designs; no brand names.
   Run: node scripts/build-field-templates.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const qrSrc = fs.readFileSync(path.join(ROOT, 'assets/vendor/qrcode.js'), 'utf8');
const box = { module: { exports: {} } };
box.exports = box.module.exports;
vm.runInNewContext(qrSrc, box);
const qrcode = box.module.exports;

/* The same QR drawing as the studio (le-variables.js qrMarkup): 4-module quiet zone, dark on light. */
function qr(text, fg, bg) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  const n = code.getModuleCount(), pad = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) d += 'M' + (c + pad) + ' ' + (r + pad) + 'h1v1h-1z';
  const S = n + pad * 2;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S + '" shape-rendering="crispEdges">' + (bg ? '<rect width="' + S + '" height="' + S + '" fill="' + bg + '"/>' : '') + '<path d="' + d + '" fill="' + fg + '"/></svg>';
}
const T = (id, text, x, y, w, h, o) => Object.assign({ id, type: 'text', text, x, y, w, h }, o || {});
const R = (id, x, y, w, h, o) => Object.assign({ id, type: 'shape', shape: 'rectangle', x, y, w, h }, o || {});
const E = (id, x, y, w, h, o) => Object.assign({ id, type: 'shape', shape: 'ellipse', x, y, w, h }, o || {});
function design(name, page, variables, values) {
  return { format: 'localeditor-design', version: 1, name, variables, values, pages: [page] };
}
const csv = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c))).join(',')).join('\n') + '\n';

const templates = [];

/* 1. Certificate (A4 landscape, 300 dpi) */
(function () {
  const W = 3508, H = 2480, ink = '#1E3A34', gold = '#B8935A', goldInk = '#7A5A26';
  const L = [
    R('frame', 90, 90, W - 180, H - 180, { name: 'Frame', stroke: { width: 14, color: ink } }),
    R('frame-in', 132, 132, W - 264, H - 264, { name: 'Inner frame', stroke: { width: 4, color: gold } }),
    T('eyebrow', 'CERTIFICATE OF ACHIEVEMENT', 354, 470, 2800, 90, { name: 'Title', font: 'Montserrat', weight: 700, size: 68, letterSpacing: 18, color: goldInk, align: 'center' }),
    T('presented', 'This certificate is presented to', 354, 670, 2800, 110, { name: 'Line', font: 'Cormorant Garamond', weight: 500, size: 88, color: '#4A4A48', align: 'center' }),
    T('name', '{{name}}', 304, 830, 2900, 420, { name: 'Name', font: 'Great Vibes', weight: 400, size: 330, lineHeight: 1.15, color: ink, align: 'center', overflow: 'shrink', minSize: 150 }),
    R('rule', 904, 1275, 1700, 5, { name: 'Rule', fill: gold }),
    T('for', 'for {{achievement}}', 554, 1345, 2400, 230, { name: 'Achievement', font: 'Cormorant Garamond', weight: 500, size: 84, lineHeight: 1.25, color: '#33332F', align: 'center', overflow: 'shrink', minSize: 50 }),
    T('date', '{{date|date:long}}', 420, 1835, 900, 95, { name: 'Date', font: 'Cormorant Garamond', weight: 600, size: 72, color: '#33332F', align: 'center', overflow: 'shrink' }),
    R('date-line', 470, 1950, 800, 4, { name: 'Date line', fill: ink }),
    T('date-label', 'DATE', 420, 1985, 900, 50, { name: 'Date label', font: 'Montserrat', weight: 700, size: 34, letterSpacing: 8, color: '#5E5E58', align: 'center' }),
    T('signer', '{{signer}}', 2188, 1790, 900, 150, { name: 'Signature', font: 'Allura', weight: 400, size: 128, color: ink, align: 'center', overflow: 'shrink' }),
    R('sign-line', 2238, 1950, 800, 4, { name: 'Signature line', fill: ink }),
    T('signer-title', '{{signer_title|upper}}', 2188, 1985, 900, 50, { name: 'Signer title', font: 'Montserrat', weight: 700, size: 34, letterSpacing: 8, color: '#5E5E58', align: 'center', overflow: 'shrink' }),
    { id: 'seal', name: 'Seal', type: 'shape', shape: 'burst', x: 1584, y: 1720, w: 340, h: 340, fill: gold },
    E('seal-in', 1629, 1765, 250, 250, { name: 'Seal centre', fill: ink }),
    T('seal-year', '{{date|date:year}}', 1629, 1858, 250, 64, { name: 'Seal year', font: 'Montserrat', weight: 700, size: 52, letterSpacing: 4, color: '#F4E9D3', align: 'center' })
  ];
  const vars = [
    { key: 'name', label: 'Name', type: 'text', required: true, sample: 'Priya Raman' },
    { key: 'achievement', label: 'For', type: 'text', sample: 'outstanding work in the school science fair' },
    { key: 'date', label: 'Date', type: 'date', sample: '2026-11-12' },
    { key: 'signer', label: 'Signed by', type: 'text', sample: 'Anita Desai' },
    { key: 'signer_title', label: 'Signer’s title', type: 'text', default: 'Principal', sample: 'Principal' }
  ];
  templates.push({
    id: 'certificate', name: 'Certificate', category: 'Teachers', summary: 'Achievement, course or thank-you certificates on A4.',
    design: design('Certificate', { id: 'certificate', width: W, height: H, background: '#FBF8F1', layers: L }, vars,
      { name: 'Priya Raman', achievement: 'outstanding work in the school science fair', date: '2026-11-12', signer: 'Anita Desai', signer_title: 'Principal' }),
    print: { paper: 'a4-landscape', w: 297, h: 210, dpi: 300 },
    rows: csv([['name', 'achievement', 'date', 'signer', 'signer_title'],
      ['Priya Raman', 'outstanding work in the school science fair', '2026-11-12', 'Anita Desai', 'Principal'],
      ['Mateo Alejandro Fernández-García', 'completing the young coders course', '2026-11-12', 'Anita Desai', 'Principal'],
      ['Aiko Tanaka', 'perfect attendance this term', '2026-11-12', 'Anita Desai', 'Principal'],
      ['Oluwaseun Adebayo', 'leading the school debate team to the regional final', '2026-11-12', 'Anita Desai', 'Principal'],
      ['Liam O’Connor', 'kindness and help in class', '2026-11-12', 'Anita Desai', 'Principal'],
      ['Zara Ahmed', 'first place in the art competition', '2026-11-12', 'Anita Desai', 'Principal']])
  });
})();

/* 2. Name badge (4 × 3 in) */
(function () {
  const W = 1200, H = 900;
  const L = [
    R('band', 0, 0, W, 250, { name: 'Colour band', fill: '#1F4FD8', bind: { color: 'colour' } }),
    T('event', '{{event|upper}}', 80, 92, 1040, 70, { name: 'Event', font: 'Montserrat', weight: 700, size: 48, letterSpacing: 5, color: '#FFFFFF', overflow: 'shrink', minSize: 26 }),
    T('name', '{{name}}', 80, 372, 1040, 150, { name: 'Name', font: 'Poppins', weight: 700, size: 124, lineHeight: 1.05, color: '#14141A', overflow: 'shrink', minSize: 64 }),
    T('role', '{{role}}', 80, 556, 1040, 70, { name: 'Role', font: 'Inter', weight: 400, size: 54, color: '#4B4B57', overflow: 'shrink', minSize: 30 }),
    T('company', '{{company}}', 80, 636, 1040, 70, { name: 'Company', font: 'Inter', weight: 700, size: 54, color: '#14141A', overflow: 'shrink', minSize: 30 }),
    R('foot', 0, H - 26, W, 26, { name: 'Bottom stripe', fill: '#1F4FD8', bind: { color: 'colour' } })
  ];
  const vars = [
    { key: 'name', label: 'Name', type: 'text', required: true, sample: 'Grace Okafor' },
    { key: 'role', label: 'Role', type: 'text', sample: 'Data engineer' },
    { key: 'company', label: 'Company', type: 'text', sample: 'Riverside Labs' },
    { key: 'event', label: 'Event', type: 'text', sample: 'Open Data Summit 2026', default: 'Open Data Summit 2026' },
    { key: 'colour', label: 'Badge colour', type: 'colour', sample: '#1F4FD8', default: '#1F4FD8' }
  ];
  templates.push({
    id: 'name-badge', name: 'Name badge', category: 'Events', summary: 'Conference and staff badges, 4 × 3 in, six to a sheet.',
    design: design('Name badge', { id: 'badge', width: W, height: H, background: '#FFFFFF', layers: L }, vars, { name: 'Grace Okafor', role: 'Data engineer', company: 'Riverside Labs', event: 'Open Data Summit 2026', colour: '#1F4FD8' }),
    print: { paper: '', w: 101.6, h: 76.2, dpi: 300 },
    rows: csv([['name', 'role', 'company', 'event', 'colour'],
      ['Grace Okafor', 'Data engineer', 'Riverside Labs', 'Open Data Summit 2026', '#1F4FD8'],
      ['Arjun Mehta', 'Speaker', 'Northwind University', 'Open Data Summit 2026', '#C2410C'],
      ['Sofia Lindqvist', 'Product designer', 'Lumen Studio', 'Open Data Summit 2026', '#1F4FD8'],
      ['Kwame Mensah', 'Volunteer', '', 'Open Data Summit 2026', '#15803D'],
      ['Hana Kobayashi-Whitfield', 'Head of research partnerships', 'Pacific Institute for Civic Technology', 'Open Data Summit 2026', '#1F4FD8'],
      ['Diego Ramos', 'Organiser', 'Open Data Collective', 'Open Data Summit 2026', '#7C3AED']])
  });
})();

/* 3. Place card (3.5 × 2 in) with a vegetarian tag shown by a yes / no column */
(function () {
  const W = 1050, H = 600, gold = '#8A6A35';
  const L = [
    R('border', 26, 26, W - 52, H - 52, { name: 'Border', stroke: { width: 3, color: '#C9B37E' } }),
    R('border-in', 40, 40, W - 80, H - 80, { name: 'Inner border', stroke: { width: 1.5, color: '#C9B37E' } }),
    T('name', '{{name}}', 70, 150, 910, 200, { name: 'Guest', font: 'Great Vibes', weight: 400, size: 150, lineHeight: 1.2, color: '#2E2A24', align: 'center', overflow: 'shrink', minSize: 70 }),
    T('table', 'TABLE {{table}}', 70, 382, 910, 48, { name: 'Table', font: 'Montserrat', weight: 700, size: 34, letterSpacing: 9, color: gold, align: 'center' }),
    { id: 'veg-pill', name: 'Vegetarian tag', type: 'shape', shape: 'rounded-rectangle', params: { radius: 28 }, x: 395, y: 452, w: 260, h: 56, fill: '#E6EFE0', bind: { show: 'veg' } },
    T('veg', 'Vegetarian', 395, 465, 260, 32, { name: 'Vegetarian', font: 'Montserrat', weight: 700, size: 25, letterSpacing: 2, color: '#2F5D2A', align: 'center', bind: { show: 'veg' } })
  ];
  const vars = [
    { key: 'name', label: 'Guest', type: 'text', required: true, sample: 'Amelia Brooks' },
    { key: 'table', label: 'Table', type: 'text', sample: '4' },
    { key: 'veg', label: 'Vegetarian', type: 'boolean', sample: 'no' }
  ];
  templates.push({
    id: 'place-card', name: 'Place card', category: 'Events', summary: 'Wedding and dinner place cards with table numbers.',
    design: design('Place card', { id: 'place', width: W, height: H, background: '#FFFDF8', layers: L }, vars, { name: 'Amelia Brooks', table: '4', veg: true }),
    print: { paper: '', w: 88.9, h: 50.8, dpi: 300 },
    rows: csv([['name', 'table', 'veg'], ['Amelia Brooks', '4', 'no'], ['Rohan & Meera Kapoor', '4', 'yes'], ['Father Thomas Whitaker', '1', 'no'], ['Lucía Hernández', '2', 'yes'], ['Mr and Mrs Oyelaran-Thompson', '7', 'no'], ['Chen Wei', '3', 'yes']])
  });
})();

/* 4. Price tag (2 × 3.5 in) */
(function () {
  const W = 600, H = 1050;
  const L = [
    E('hole', 272, 52, 56, 56, { name: 'Punch hole', stroke: { width: 3, color: '#C9C9D1' } }),
    T('product', '{{product}}', 50, 160, 500, 140, { name: 'Product', font: 'Inter', weight: 700, size: 56, lineHeight: 1.15, color: '#141418', align: 'center', overflow: 'shrink', minSize: 30 }),
    T('detail', '{{detail}}', 50, 312, 500, 92, { name: 'Detail', font: 'Inter', weight: 400, size: 32, lineHeight: 1.35, color: '#55555F', align: 'center', overflow: 'ellipsis' }),
    T('price', '{{price|currency:INR}}', 30, 520, 540, 140, { name: 'Price', font: 'Poppins', weight: 700, size: 112, color: '#141418', align: 'center', overflow: 'shrink', minSize: 50 }),
    T('was', 'was {{was|currency:INR}}', 30, 672, 540, 52, { name: 'Was', font: 'Poppins', weight: 400, size: 40, color: '#6A6A74', align: 'center', strike: true, bind: { show: 'sale' } }),
    R('sale-band', 0, 770, W, 96, { name: 'Sale band', fill: '#C81E3A', bind: { show: 'sale' } }),
    T('sale', 'SALE', 0, 790, W, 58, { name: 'Sale', font: 'Poppins', weight: 700, size: 50, letterSpacing: 14, color: '#FFFFFF', align: 'center', bind: { show: 'sale' } }),
    T('sku', '{{sku}}', 50, 950, 500, 40, { name: 'Code', font: 'JetBrains Mono', weight: 500, size: 28, color: '#55555F', align: 'center' })
  ];
  const vars = [
    { key: 'product', label: 'Product', type: 'text', required: true, sample: 'Linen tote bag' },
    { key: 'detail', label: 'Detail', type: 'text', sample: 'Natural, 38 × 42 cm' },
    { key: 'price', label: 'Price', type: 'number', required: true, sample: '899' },
    { key: 'was', label: 'Was', type: 'number', sample: '1299' },
    { key: 'sale', label: 'On sale', type: 'boolean', sample: 'yes' },
    { key: 'sku', label: 'Item code', type: 'text', sample: 'TB-0381' }
  ];
  templates.push({
    id: 'price-tag', name: 'Price tag', category: 'Business', summary: 'Hang tags with a sale band that shows only on sale items.',
    design: design('Price tag', { id: 'tag', width: W, height: H, background: '#FFFFFF', layers: L }, vars, { product: 'Linen tote bag', detail: 'Natural, 38 × 42 cm', price: 899, was: 1299, sale: true, sku: 'TB-0381' }),
    print: { paper: '', w: 50.8, h: 88.9, dpi: 300 },
    rows: csv([['product', 'detail', 'price', 'was', 'sale', 'sku'],
      ['Linen tote bag', 'Natural, 38 × 42 cm', '899', '1299', 'yes', 'TB-0381'],
      ['Hand-thrown mug', 'Stoneware, 350 ml', '650', '', 'no', 'MG-0112'],
      ['Block-print cushion cover', 'Cotton, 45 × 45 cm, indigo', '1,150', '1,450', 'yes', 'CC-2210'],
      ['Beeswax candle', 'Burns about 30 hours', '420', '', 'no', 'CN-0007'],
      ['Notebook', 'A5, dotted, 160 pages', '299', '', 'no', 'NB-0544'],
      ['Woven basket', 'Seagrass, medium', '1,800', '2,400', 'yes', 'BK-0090']])
  });
})();

/* 5. Product card (social 4:5) with a photo per row */
(function () {
  const W = 1080, H = 1350, ink = '#2B2118';
  const L = [
    { id: 'photo', name: 'Photo', type: 'image', src: 'assets/photos/collage/still-01.jpg', slot: { id: 'photo', label: 'Product photo' }, x: 60, y: 60, w: 960, h: 820, radius: 36, bind: { content: 'photo' } },
    T('product', '{{product}}', 60, 940, 690, 90, { name: 'Product', font: 'Fraunces', weight: 700, size: 74, lineHeight: 1.1, color: ink, overflow: 'shrink', minSize: 40 }),
    { id: 'price-pill', name: 'Price pill', type: 'shape', shape: 'rounded-rectangle', params: { radius: 48 }, x: 780, y: 930, w: 240, h: 96, fill: ink },
    T('price', '{{price|currency:INR}}', 790, 952, 220, 54, { name: 'Price', font: 'Poppins', weight: 700, size: 44, color: '#FFFFFF', align: 'center', overflow: 'shrink', minSize: 24 }),
    T('blurb', '{{blurb}}', 60, 1060, 960, 140, { name: 'Description', font: 'Inter', weight: 400, size: 34, lineHeight: 1.4, color: '#5A4E44', overflow: 'ellipsis' }),
    T('shop', '{{shop|upper}}', 60, 1258, 960, 40, { name: 'Shop', font: 'Inter', weight: 700, size: 28, letterSpacing: 5, color: '#7A6B5E' })
  ];
  const vars = [
    { key: 'product', label: 'Product', type: 'text', required: true, sample: 'Masala chai' },
    { key: 'price', label: 'Price', type: 'number', required: true, sample: '120' },
    { key: 'blurb', label: 'Description', type: 'text', sample: 'Slow-brewed with ginger, cardamom and fresh milk.' },
    { key: 'photo', label: 'Photo', type: 'image', sample: 'still-01.jpg' },
    { key: 'shop', label: 'Shop name', type: 'text', default: 'Corner Café', sample: 'Corner Café' }
  ];
  templates.push({
    id: 'product-card', name: 'Product card', category: 'Business', summary: 'A photo, name and price for each item on your menu or shelf.',
    design: design('Product card', { id: 'product', width: W, height: H, background: '#F6F1EA', layers: L }, vars, { product: 'Masala chai', price: 120, blurb: 'Slow-brewed with ginger, cardamom and fresh milk.', shop: 'Corner Café' }),
    photos: ['still-01.jpg', 'still-02.jpg', 'garden-02.jpg'],
    rows: csv([['product', 'price', 'blurb', 'photo', 'shop'],
      ['Masala chai', '120', 'Slow-brewed with ginger, cardamom and fresh milk.', 'still-01.jpg', 'Corner Café'],
      ['Iced coffee', '180', 'Cold-brewed for twelve hours, served over ice with a splash of oat milk.', 'Still-02', 'Corner Café'],
      ['Wildflower honey cake', '210', 'A soft sponge baked with local wildflower honey and topped with toasted almonds, cream and a little lemon zest for brightness.', 'garden-02.JPG', 'Corner Café']])
  });
})();

/* 6. Event ticket with a QR code per row */
(function () {
  const W = 2100, H = 750, gold = '#F2B544';
  const L = [
    R('accent', 0, 0, 24, H, { name: 'Accent', fill: gold }),
    T('admit', 'ADMIT ONE', 90, 70, 800, 46, { name: 'Admit one', font: 'Montserrat', weight: 700, size: 32, letterSpacing: 9, color: gold }),
    T('event', '{{event}}', 90, 130, 1330, 170, { name: 'Event', font: 'Bebas Neue', weight: 400, size: 160, lineHeight: 1.05, color: '#FFFFFF', overflow: 'shrink', minSize: 70 }),
    T('when', '{{date|date:long}} · {{time}}', 90, 320, 1330, 62, { name: 'When', font: 'Inter', weight: 400, size: 46, color: '#C9D2E3', overflow: 'shrink' }),
    T('venue', '{{venue}}', 90, 392, 1330, 62, { name: 'Venue', font: 'Inter', weight: 700, size: 46, color: '#FFFFFF', overflow: 'shrink' }),
    T('name-label', 'NAME', 90, 530, 600, 40, { name: 'Name label', font: 'Montserrat', weight: 700, size: 28, letterSpacing: 6, color: '#9AA6BB' }),
    T('name', '{{name}}', 90, 575, 820, 70, { name: 'Name', font: 'Inter', weight: 700, size: 52, color: '#FFFFFF', overflow: 'shrink', minSize: 30 }),
    T('seat-label', 'SEAT', 1000, 530, 400, 40, { name: 'Seat label', font: 'Montserrat', weight: 700, size: 28, letterSpacing: 6, color: '#9AA6BB' }),
    T('seat', '{{seat|default:Open seating}}', 1000, 575, 420, 70, { name: 'Seat', font: 'Inter', weight: 700, size: 52, color: '#FFFFFF', overflow: 'shrink', minSize: 30 }),
    { id: 'perf', name: 'Perforation', type: 'shape', shape: 'line', x: 1530, y: 40, w: 4, h: H - 80, stroke: { width: 4, color: '#3A4558', dash: [14, 12] } },
    { id: 'stub', name: 'Stub', type: 'shape', shape: 'rounded-rectangle', params: { radius: 28 }, x: 1600, y: 90, w: 440, h: 440, fill: '#FFFFFF' },
    { id: 'qr', name: 'QR code', type: 'svg', svg: qr('https://example.org/t/OD26-0001', '#101826', '#FFFFFF'), x: 1620, y: 110, w: 400, h: 400, bind: { content: 'ticket_url' } },
    T('ticket', '{{ticket}}', 1570, 565, 500, 50, { name: 'Ticket number', font: 'JetBrains Mono', weight: 700, size: 36, color: '#E7ECF5', align: 'center' }),
    T('scan', 'Scan at the door', 1570, 625, 500, 40, { name: 'Scan note', font: 'Inter', weight: 400, size: 28, color: '#9AA6BB', align: 'center' })
  ];
  const vars = [
    { key: 'event', label: 'Event', type: 'text', required: true, sample: 'Monsoon Jazz Night' },
    { key: 'date', label: 'Date', type: 'date', sample: '2026-12-05' },
    { key: 'time', label: 'Time', type: 'text', sample: '7:30 pm' },
    { key: 'venue', label: 'Venue', type: 'text', sample: 'Harbour Hall, Kochi' },
    { key: 'name', label: 'Name', type: 'text', required: true, sample: 'Nikhil Varma' },
    { key: 'seat', label: 'Seat', type: 'text', sample: 'B 14' },
    { key: 'ticket', label: 'Ticket number', type: 'text', sample: 'MJN-0001' },
    { key: 'ticket_url', label: 'QR code text', type: 'url', required: true, sample: 'https://example.org/t/MJN-0001' }
  ];
  const ev = ['Monsoon Jazz Night', '2026-12-05', '7:30 pm', 'Harbour Hall, Kochi'];
  templates.push({
    id: 'event-ticket', name: 'Event ticket', category: 'Events', summary: 'Tickets with a QR code, a seat and a number for every guest.',
    design: design('Event ticket', { id: 'ticket', width: W, height: H, background: '#101826', layers: L }, vars, { event: ev[0], date: ev[1], time: ev[2], venue: ev[3], name: 'Nikhil Varma', seat: 'B 14', ticket: 'MJN-0001', ticket_url: 'https://example.org/t/MJN-0001' }),
    print: { paper: '', w: 177.8, h: 63.5, dpi: 300 },
    rows: csv([['event', 'date', 'time', 'venue', 'name', 'seat', 'ticket', 'ticket_url']].concat(
      [['Nikhil Varma', 'B 14'], ['Fatima Al-Sayed', 'B 15'], ['Jonas Becker', 'C 2'], ['Ama Owusu', ''], ['Isabella Rossi-Montgomery', 'A 1'], ['Tenzin Norbu', 'C 3']]
        .map((r, i) => ev.concat([r[0], r[1], 'MJN-000' + (i + 1), 'https://example.org/t/MJN-000' + (i + 1)]))))
  });
})();

/* 7. Gift voucher (6 × 3 in) */
(function () {
  const W = 1800, H = 900, gold = '#D4B26A', cream = '#F5EBDD', soft = '#B9CCC4';
  const L = [
    R('frame', 40, 40, W - 80, H - 80, { name: 'Frame', stroke: { width: 3, color: gold } }),
    T('eyebrow', 'GIFT VOUCHER', 110, 112, 900, 52, { name: 'Title', font: 'Montserrat', weight: 700, size: 38, letterSpacing: 12, color: gold }),
    T('amount', '{{amount|currency:INR}}', 100, 180, 1100, 250, { name: 'Amount', font: 'Playfair Display', weight: 700, size: 210, color: cream, overflow: 'shrink', minSize: 90 }),
    T('for', 'For {{name}}', 110, 460, 1080, 84, { name: 'For', font: 'Playfair Display', weight: 400, size: 66, color: cream, overflow: 'shrink', minSize: 36 }),
    T('from', 'With love from {{from}}', 110, 558, 1080, 56, { name: 'From', font: 'Inter', weight: 400, size: 40, color: soft, overflow: 'shrink', bind: { show: 'from' } }),
    T('code', 'CODE  {{code}}', 110, 700, 800, 52, { name: 'Code', font: 'JetBrains Mono', weight: 700, size: 38, letterSpacing: 2, color: gold }),
    T('valid', 'Valid until {{expires|date:long}}', 110, 760, 1000, 46, { name: 'Valid until', font: 'Inter', weight: 400, size: 32, color: soft }),
    E('ring', 1270, 220, 420, 420, { name: 'Ring', stroke: { width: 3, color: gold } }),
    { id: 'gift', name: 'Gift icon', type: 'icon', icon: 'lucide:gift', color: gold, strokeWidth: 1.25, x: 1350, y: 300, w: 260, h: 260 }
  ];
  const vars = [
    { key: 'amount', label: 'Amount', type: 'number', required: true, sample: '2500' },
    { key: 'name', label: 'For', type: 'text', required: true, sample: 'Meera' },
    { key: 'from', label: 'From', type: 'text', sample: 'the team at Green Leaf Spa' },
    { key: 'code', label: 'Code', type: 'text', sample: 'GLS-7Q4K' },
    { key: 'expires', label: 'Valid until', type: 'date', sample: '2027-03-31' }
  ];
  templates.push({
    id: 'gift-voucher', name: 'Gift voucher', category: 'Business', summary: 'Numbered vouchers with an amount, a code and an expiry date.',
    design: design('Gift voucher', { id: 'voucher', width: W, height: H, background: '#13322B', layers: L }, vars, { amount: 2500, name: 'Meera', from: 'the team at Green Leaf Spa', code: 'GLS-7Q4K', expires: '2027-03-31' }),
    print: { paper: '', w: 152.4, h: 76.2, dpi: 300 },
    rows: csv([['amount', 'name', 'from', 'code', 'expires'], ['2500', 'Meera', 'the team at Green Leaf Spa', 'GLS-7Q4K', '31/03/2027'], ['1000', 'Daniel', '', 'GLS-2M9X', '31/03/2027'], ['5000', 'Grandma Josephine', 'all of us', 'GLS-8R1T', '2027-06-30'], ['1500', 'Samira', 'Arjun', 'GLS-4C6P', '2027-03-31']])
  });
})();

/* 8. Class award (A5 portrait) */
(function () {
  const W = 1748, H = 2480, navy = '#1D3557', red = '#C1272D';
  const dots = [[150, 160, '#E63946'], [1520, 240, '#2A9D8F'], [260, 620, '#FFC93C'], [1460, 700, '#457B9D'], [120, 1320, '#2A9D8F'], [1600, 1420, '#E63946'], [180, 2260, '#457B9D'], [1540, 2280, '#FFC93C'], [880, 140, '#457B9D']];
  const L = dots.map((d, i) => E('dot-' + (i + 1), d[0], d[1], 46, 46, { name: 'Confetti', fill: d[2] })).concat([
    { id: 'star', name: 'Star', type: 'shape', shape: 'star', params: { points: 5, innerRatio: 0.48 }, x: 574, y: 230, w: 600, h: 580, fill: '#FFC93C' },
    T('award', '{{award|upper}}', 124, 900, 1500, 140, { name: 'Award', font: 'Nunito', weight: 800, size: 116, letterSpacing: 4, color: navy, align: 'center', overflow: 'shrink', minSize: 50 }),
    T('goes', 'This award goes to', 124, 1075, 1500, 90, { name: 'Line', font: 'Nunito', weight: 400, size: 70, color: '#3E5874', align: 'center' }),
    T('name', '{{name}}', 104, 1180, 1540, 400, { name: 'Name', font: 'Pacifico', weight: 400, size: 280, lineHeight: 1.3, color: red, align: 'center', overflow: 'shrink', minSize: 90 }),
    T('reason', 'for {{reason}}', 174, 1610, 1400, 300, { name: 'Reason', font: 'Nunito', weight: 400, size: 84, lineHeight: 1.3, color: navy, align: 'center', overflow: 'shrink', minSize: 40 }),
    T('teacher', '{{teacher}}', 174, 1990, 650, 110, { name: 'Teacher', font: 'Caveat', weight: 700, size: 92, color: navy, align: 'center', overflow: 'shrink' }),
    R('t-line', 214, 2110, 570, 4, { name: 'Teacher line', fill: navy }),
    T('t-label', 'Teacher', 174, 2130, 650, 54, { name: 'Teacher label', font: 'Nunito', weight: 700, size: 40, color: '#3E5874', align: 'center' }),
    T('date', '{{date|date:long}}', 924, 2018, 650, 76, { name: 'Date', font: 'Nunito', weight: 700, size: 56, color: navy, align: 'center', overflow: 'shrink' }),
    R('d-line', 964, 2110, 570, 4, { name: 'Date line', fill: navy }),
    T('d-label', 'Date', 924, 2130, 650, 54, { name: 'Date label', font: 'Nunito', weight: 700, size: 40, color: '#3E5874', align: 'center' })
  ]);
  const vars = [
    { key: 'name', label: 'Name', type: 'text', required: true, sample: 'Leo' },
    { key: 'reason', label: 'For', type: 'text', sample: 'always helping a friend' },
    { key: 'teacher', label: 'Teacher', type: 'text', sample: 'Ms Fernandes' },
    { key: 'date', label: 'Date', type: 'date', sample: '2026-11-13' },
    { key: 'award', label: 'Award', type: 'text', default: 'Star of the week', sample: 'Star of the week' }
  ];
  templates.push({
    id: 'class-award', name: 'Class award', category: 'Teachers', summary: 'Star of the week, reading champion, kindness awards on A5.',
    design: design('Class award', { id: 'award', width: W, height: H, background: '#FFF8E7', layers: L }, vars, { name: 'Leo', reason: 'always helping a friend', teacher: 'Ms Fernandes', date: '2026-11-13', award: 'Star of the week' }),
    print: { paper: 'a5', w: 148, h: 210, dpi: 300 },
    rows: csv([['name', 'reason', 'teacher', 'date', 'award'], ['Leo', 'always helping a friend', 'Ms Fernandes', '13/11/2026', 'Star of the week'], ['Anaya', 'reading twenty books this term', 'Ms Fernandes', '13/11/2026', 'Reading champion'], ['Maximilian', 'brilliant questions in science', 'Ms Fernandes', '13/11/2026', ''], ['Sara', 'being kind to everyone', 'Ms Fernandes', '13/11/2026', 'Kindness award'], ['Kofi', 'never giving up on hard maths', 'Ms Fernandes', '13/11/2026', '']])
  });
})();

/* 9. Quote card (square), colour per row and a series counter */
(function () {
  const W = 1080, H = 1080;
  const L = [
    R('bg', 0, 0, W, H, { name: 'Background colour', fill: '#23395B', bind: { color: 'colour' } }),
    T('mark', '“', 92, 30, 300, 360, { name: 'Quote mark', font: 'Playfair Display', weight: 700, size: 300, color: '#FFFFFF', opacity: 0.28 }),
    T('quote', '{{quote}}', 110, 280, 860, 500, { name: 'Quote', font: 'Playfair Display', weight: 600, size: 70, lineHeight: 1.22, color: '#FFFFFF', overflow: 'shrink', minSize: 34 }),
    T('author', '— {{author}}', 110, 810, 860, 56, { name: 'Author', font: 'Inter', weight: 700, size: 40, color: '#FFFFFF', opacity: 0.9, overflow: 'shrink' }),
    T('count', '{{#}} / {{#total}}', 110, 960, 300, 40, { name: 'Counter', font: 'Inter', weight: 700, size: 28, color: '#FFFFFF', opacity: 0.75 }),
    T('handle', '{{handle}}', 540, 960, 430, 40, { name: 'Handle', font: 'Inter', weight: 700, size: 28, color: '#FFFFFF', opacity: 0.75, align: 'right', overflow: 'shrink' })
  ];
  const vars = [
    { key: 'quote', label: 'Quote', type: 'text', required: true, sample: 'Small steps every day add up to big changes.' },
    { key: 'author', label: 'Author', type: 'text', sample: 'Ana Lucía' },
    { key: 'colour', label: 'Colour', type: 'colour', default: '#23395B', sample: '#23395B' },
    { key: 'handle', label: 'Your handle', type: 'text', default: '@dailynotes', sample: '@dailynotes' }
  ];
  templates.push({
    id: 'quote-card', name: 'Quote series', category: 'Social', summary: 'A numbered series of quote posts, one colour per post.',
    design: design('Quote series', { id: 'quote', width: W, height: H, background: '#23395B', layers: L }, vars, { quote: 'Small steps every day add up to big changes.', author: 'Ana Lucía', colour: '#23395B', handle: '@dailynotes', '#': 1, '#total': 5 }),
    rows: csv([['quote', 'author', 'colour', 'handle'],
      ['Small steps every day add up to big changes.', 'Ana Lucía', '#23395B', '@dailynotes'],
      ['Rest is part of the work.', 'Kenji', '#7A2E3B', '@dailynotes'],
      ['Write it down. Then do the next small thing, and the next, until the page is full and the day is done.', 'Grandmother’s notebook', '#2F5D50', '@dailynotes'],
      ['You do not have to see the whole staircase. Just take the first step.', 'Unknown', '#4B3F72', '@dailynotes'],
      ['Done is a gift you give your future self.', 'Ama', '#8A4B12', '@dailynotes']])
  });
})();

/* 10. Shelf label (70 × 37 mm), 12 to an A4 sheet */
(function () {
  const W = 827, H = 437;
  const L = [
    R('bar', 0, 0, 22, H, { name: 'Accent', fill: '#0F766E' }),
    T('product', '{{product}}', 56, 34, 740, 128, { name: 'Product', font: 'Inter', weight: 700, size: 52, lineHeight: 1.15, color: '#141418', overflow: 'shrink', minSize: 30 }),
    T('price', '{{price|currency:INR}}', 56, 196, 520, 128, { name: 'Price', font: 'Poppins', weight: 700, size: 112, color: '#141418', overflow: 'shrink', minSize: 50 }),
    T('unit', '{{unit}}', 56, 350, 470, 44, { name: 'Unit price', font: 'Inter', weight: 400, size: 30, color: '#55555F', overflow: 'ellipsis' }),
    T('code', '{{code}}', 520, 354, 276, 40, { name: 'Code', font: 'JetBrains Mono', weight: 500, size: 28, color: '#55555F', align: 'right' })
  ];
  const vars = [
    { key: 'product', label: 'Product', type: 'text', required: true, sample: 'Basmati rice, aged' },
    { key: 'price', label: 'Price', type: 'number', required: true, sample: '245' },
    { key: 'unit', label: 'Unit price', type: 'text', sample: '₹245 per kg' },
    { key: 'code', label: 'Code', type: 'text', sample: '8901-2234' }
  ];
  templates.push({
    id: 'shelf-label', name: 'Shelf label', category: 'Business', summary: 'Shelf-edge labels, 70 × 37 mm, twelve to an A4 sheet.',
    design: design('Shelf label', { id: 'shelf', width: W, height: H, background: '#FFFFFF', layers: L }, vars, { product: 'Basmati rice, aged', price: 245, unit: '₹245 per kg', code: '8901-2234' }),
    print: { paper: '', w: 70, h: 37, dpi: 300 },
    rows: csv([['product', 'price', 'unit', 'code'], ['Basmati rice, aged', '245', '₹245 per kg', '8901-2234'], ['Toor dal', '178', '₹178 per kg', '8901-1120'], ['Cold-pressed groundnut oil', '389', '₹389 per litre', '8901-7781'], ['Jaggery powder', '96', '₹192 per kg', '8901-4410'], ['Green tea, 25 bags', '210', '₹8.40 per bag', '8901-3302'], ['Whole wheat atta', '62', '₹62 per kg', '8901-0091'], ['Rolled oats', '145', '₹290 per kg', '8901-6604'], ['Cashews, whole', '420', '₹1,680 per kg', '8901-5503']])
  });
})();

/* The physical size goes on the page ("print", docs/FORMAT-DESIGN.md), so PDF and print sheets come out at real size. */
templates.forEach((t) => { if (t.print) { const pg = t.design.pages[0]; const o = {}; Object.keys(pg).forEach((k) => { if (k === 'layers') o.print = t.print; o[k] = pg[k]; }); t.design.pages[0] = o; } delete t.print; });
const out = { v: 1, generated: 'scripts/build-field-templates.js', templates };
const file = path.join(ROOT, 'assets/data/templates/fields.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out) + '\n');
console.log('Wrote', path.relative(ROOT, file), (fs.statSync(file).size / 1024).toFixed(1) + ' KB,', templates.length, 'templates');
