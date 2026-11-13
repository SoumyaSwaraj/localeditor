'use strict';
/* Design as code (docs/DESIGN-AS-CODE.md). Build it:
     localeditor build examples/code/bake-sale.design.js -o out/
   That writes bake-sale.ledesign.json next to this file (plain data, open it in the studio) and out/bake-sale-0.png, -1.png. */
const { design } = require('localeditor/dsl');

const brand = { navy: '#14213D', crust: '#E0B354', flour: '#FFF8EC', ink: '#17131F' };

/* A piece used on both pages: composition is ordinary functions. */
function footer(d, page) {
  d.text('Harbour Bakery · 12 Quay Street', { id: 'footer-' + page, font: 'Inter', weight: 400, size: 30, color: page === 1 ? brand.flour : brand.ink, align: 'center', x: 'center', y: 1250, w: '86%' });
}

module.exports = design({ name: 'Bake sale', size: [1080, 1350], brand: 'brand.lebrand.json' })
  .page({ id: 'cover', background: brand.navy })
    .text('Bake sale\nSaturday 10 am', { id: 'title', font: 'Anton', weight: 400, size: 150, color: brand.flour, align: 'center', x: 'center', y: 110, w: '86%', h: 380, fit: 'shrink' })
    .slot({ id: 'hero', x: 90, y: 540, w: 900, h: 600, radius: 32 })
    .shape('burst', { id: 'badge', fill: brand.crust, x: 800, y: 1010, w: 220, h: 220 })
    .icon('lucide:cake', { id: 'cake', color: brand.ink, x: 870, y: 1080, w: 80 })
    .use(footer, 1)
  .page({ id: 'details', background: brand.flour })
    .text('What we are baking', { id: 'details-title', font: 'Anton', weight: 400, size: 96, color: brand.navy, x: 90, y: 110, w: 900 })
    .text('Sourdough and rye\nCinnamon buns\nLemon drizzle cake\nCoffee, all morning', { id: 'details-list', font: 'Inter', weight: 400, size: 54, lineHeight: 1.5, color: brand.ink, x: 90, y: 300, w: 900 })
    .shape('rect', { id: 'rule', fill: brand.crust, x: 90, y: 760, w: 240, h: 12 })
    .use(footer, 2);
